import React, { createContext, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { api, getToken, setToken, clearToken } from './api.js';
import { connectSocket, disconnectSocket, onSocketEvent, emit } from './socket.js';
import { navigate } from './router.js';
import { showNotification } from './device.js';

class MiniBus {
  constructor() {
    this.map = new Map();
  }
  on(ev, fn) {
    if (!this.map.has(ev)) this.map.set(ev, new Set());
    this.map.get(ev).add(fn);
    return () => this.map.get(ev)?.delete(fn);
  }
  emit(ev, data) {
    for (const fn of [...(this.map.get(ev) || [])]) fn(data);
  }
}

export const callBus = new MiniBus();

const initialState = {
  booted: false,
  user: null,
  token: getToken(),
  conversations: [],
  conversationsLoaded: false,
  messages: {}, // convId -> { items, hasMore, loading }
  typing: {}, // convId -> { userId: { displayName, until } }
  readAt: {}, // convId -> { userId: lastReadAt }
  delivered: {}, // messageId -> true
  connections: { accepted: [], pending: [], requested: [], blocked: [] },
  notifications: [],
  callHistory: [],
  presence: {}, // userId -> { online, lastSeen }
  config: null,
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  socketState: 'disconnected',
  activeConvId: null,
  pinned: {}, // convId -> messages[]
  toasts: [],
  theme: 'system',
};

function reducer(state, action) {
  switch (action.type) {
    case 'BOOTED':
      return { ...state, booted: true };
    case 'LOGIN':
      return { ...state, user: action.user, token: action.token };
    case 'LOGOUT':
      return { ...initialState, booted: true, theme: readTheme() };
    case 'SESSION_EXPIRED':
      clearToken();
      return { ...initialState, booted: true, theme: readTheme() };
    case 'CONFIG':
      return { ...state, config: action.config };
    case 'ONLINE':
      return { ...state, online: action.online };
    case 'SOCKET_STATE':
      return { ...state, socketState: action.state };
    case 'CONVERSATIONS':
      return { ...state, conversations: action.list, conversationsLoaded: true };
    case 'CONVERSATION_UPDATE': {
      const upd = action.conversation;
      if (!upd?.id) return state;
      const existing = state.conversations.find((c) => c.id === upd.id);
      let list;
      if (existing) {
        list = state.conversations.map((c) => (c.id === upd.id ? { ...c, ...upd, peer: { ...c.peer, ...(upd.peer || {}) } } : c));
      } else {
        list = [upd, ...state.conversations];
      }
      if (action.touch) {
        const moved = list.find((c) => c.id === upd.id);
        if (moved) list = [moved, ...list.filter((c) => c.id !== upd.id)];
      }
      return { ...state, conversations: list };
    }
    case 'CONVERSATION_REMOVED':
      return { ...state, conversations: state.conversations.filter((c) => c.id !== action.conversationId) };
    case 'ACTIVE_CONV':
      return { ...state, activeConvId: action.conversationId };
    case 'MESSAGES_LOADED': {
      const conv = state.messages[action.conversationId] || { items: [], hasMore: false, loading: false };
      return {
        ...state,
        messages: {
          ...state.messages,
          [action.conversationId]: { ...conv, items: mergeMessages(conv.items, action.messages), hasMore: action.hasMore, loading: false },
        },
      };
    }
    case 'MESSAGES_PREPEND': {
      const conv = state.messages[action.conversationId] || { items: [], hasMore: false, loading: false };
      return {
        ...state,
        messages: {
          ...state.messages,
          [action.conversationId]: { ...conv, items: mergeMessages(action.messages, conv.items), hasMore: action.hasMore, loading: false },
        },
      };
    }
    case 'MESSAGE_ADD': {
      const conv = state.messages[action.conversationId] || { items: [], hasMore: false, loading: false };
      return {
        ...state,
        messages: { ...state.messages, [action.conversationId]: { ...conv, items: mergeMessages(conv.items, [action.message]) } },
      };
    }
    case 'MESSAGE_REPLACE': {
      const conv = state.messages[action.conversationId];
      if (!conv) return state;
      return {
        ...state,
        messages: {
          ...state.messages,
          [action.conversationId]: { ...conv, items: conv.items.map((m) => (m.id === action.from ? action.message : m)) },
        },
      };
    }
    case 'MESSAGE_UPDATE': {
      const conv = state.messages[action.conversationId];
      if (!conv) return state;
      return {
        ...state,
        messages: {
          ...state.messages,
          [action.conversationId]: { ...conv, items: conv.items.map((m) => (m.id === action.message.id ? { ...m, ...action.message } : m)) },
        },
      };
    }
    case 'MESSAGE_DELETE': {
      const conv = state.messages[action.conversationId];
      if (!conv) return state;
      return {
        ...state,
        messages: {
          ...state.messages,
          [action.conversationId]: { ...conv, items: conv.items.map((m) => (m.id === action.messageId ? { ...m, deletedAt: action.deletedAt || Date.now() } : m)) },
        },
      };
    }
    case 'MESSAGE_DELIVERED':
      return { ...state, delivered: { ...state.delivered, [action.messageId]: true } };
    case 'READ_AT':
      return {
        ...state,
        readAt: {
          ...state.readAt,
          [action.conversationId]: { ...(state.readAt[action.conversationId] || {}), [action.userId]: action.upTo },
        },
        conversations: state.conversations.map((c) =>
          c.id === action.conversationId && c.peer && c.peer.id === action.userId && (c.peer.lastReadAt || 0) < action.upTo
            ? { ...c, peer: { ...c.peer, lastReadAt: action.upTo } }
            : c
        ),
      };
    case 'TYPING_START':
      return {
        ...state,
        typing: {
          ...state.typing,
          [action.conversationId]: {
            ...(state.typing[action.conversationId] || {}),
            [action.userId]: { displayName: action.displayName, until: Date.now() + 4000 },
          },
        },
      };
    case 'TYPING_STOP': {
      const conv = state.typing[action.conversationId];
      if (!conv || !conv[action.userId]) return state;
      const next = { ...conv };
      delete next[action.userId];
      return { ...state, typing: { ...state.typing, [action.conversationId]: next } };
    }
    case 'CONNECTIONS':
      return { ...state, connections: action.data };
    case 'CONNECTION_UPSERT': {
      const { kind, entry } = action;
      const others = state.connections[kind].filter((e) => e.user.id !== entry.user.id);
      return { ...state, connections: { ...state.connections, [kind]: [entry, ...others] } };
    }
    case 'CONNECTION_REMOVE': {
      if (!action.userId) return state;
      const entries = {};
      for (const [k, v] of Object.entries(state.connections)) {
        entries[k] = v.filter((e) => e.user.id !== action.userId);
      }
      return { ...state, connections: entries };
    }
    case 'NOTIFICATIONS':
      return { ...state, notifications: action.list };
    case 'NOTIFICATION_ADD':
      return { ...state, notifications: [action.notification, ...state.notifications].slice(0, 200) };
    case 'NOTIFICATION_READ': {
      const ids = action.ids ? new Set(action.ids) : null;
      return {
        ...state,
        notifications: state.notifications.map((n) => (ids === null || ids.has(n.id) ? { ...n, read: true } : n)),
      };
    }
    case 'CALL_HISTORY':
      return { ...state, callHistory: action.list };
    case 'PRESENCE':
      return { ...state, presence: { ...state.presence, [action.userId]: action.data } };
    case 'PINNED':
      return { ...state, pinned: { ...state.pinned, [action.conversationId]: action.messages } };
    case 'TOAST_PUSH':
      return { ...state, toasts: [...state.toasts, action.toast] };
    case 'TOAST_POP':
      return { ...state, toasts: state.toasts.filter((t) => t.id !== action.id) };
    case 'THEME':
      return { ...state, theme: action.theme };
    default:
      return state;
  }
}

function mergeMessages(existing, incoming) {
  const byId = new Map();
  for (const m of existing) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, { ...(byId.get(m.id) || {}), ...m });
  return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt).slice(-500);
}

function readTheme() {
  try {
    return localStorage.getItem('spk.theme') || 'system';
  } catch {
    return 'system';
  }
}

const Ctx = createContext(null);
export function useApp() {
  return useContext(Ctx);
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, { ...initialState, theme: readTheme() });
  const stateRef = useRef(state);
  stateRef.current = state;
  const actionsRef = useRef(null);

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------
  const actions = useMemo(() => {
    const toast = (message, kind = 'info') => {
      const id = Math.random().toString(36).slice(2);
      dispatch({ type: 'TOAST_PUSH', toast: { id, message, kind } });
      setTimeout(() => dispatch({ type: 'TOAST_POP', id }), kind === 'error' ? 6000 : 3500);
    };

    const loadConversations = async () => {
      try {
        const list = await api('/conversations');
        dispatch({ type: 'CONVERSATIONS', list });
      } catch (e) {
        toast(e.message, 'error');
      }
    };

    const loadMessages = async (convId, { before } = {}) => {
      try {
        const data = await api(`/conversations/${convId}/messages${before ? `?before=${before}` : ''}`);
        dispatch({ type: before ? 'MESSAGES_PREPEND' : 'MESSAGES_LOADED', conversationId: convId, messages: data.messages, hasMore: data.hasMore });
        return data;
      } catch (e) {
        toast(e.message, 'error');
        return null;
      }
    };

    const openConversation = async (convId) => {
      dispatch({ type: 'ACTIVE_CONV', conversationId: convId });
      const existing = stateRef.current.messages[convId];
      if (!existing || existing.items.length === 0) {
        await loadMessages(convId);
      }
      emit('conversation:join', convId);
      try {
        const detail = await api(`/conversations/${convId}`);
        dispatch({ type: 'CONVERSATION_UPDATE', conversation: detail.conversation });
        dispatch({ type: 'PINNED', conversationId: convId, messages: detail.pinned || [] });
      } catch { /* ignore */ }
      markRead(convId);
    };

    const markRead = async (convId) => {
      const me = stateRef.current.user?.id;
      const conv = stateRef.current.messages[convId];
      let upTo = Date.now();
      if (conv?.items?.length) {
        const last = conv.items[conv.items.length - 1];
        if (last.senderId === me) return;
        upTo = last.createdAt;
      }
      emit('message:read', { conversationId: convId, upTo });
      try {
        await api(`/conversations/${convId}/read`, { method: 'POST', body: { upTo } });
      } catch { /* offline fine */ }
      dispatch({ type: 'READ_AT', conversationId: convId, userId: me, upTo });
    };

    const sendTyping = (convId, typing) => {
      if (typing) emit('typing:start', convId);
      else emit('typing:stop', convId);
    };

    const sendMessage = async (convId, { type, content, attachment, replyTo }) => {
      const me = stateRef.current.user?.id;
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const tempMsg = {
        id: tempId,
        conversationId: convId,
        senderId: me,
        type,
        content: content || '',
        meta: attachment ? { name: attachment.name, duration: attachment.duration, peaks: attachment.peaks, caption: attachment.caption } : null,
        attachment: attachment ? { id: attachment.id, name: attachment.name, mime: attachment.mime, size: attachment.size, url: attachment.url } : null,
        replyTo: replyTo ? { id: replyTo.id, type: replyTo.type, content: replyTo.content, senderName: replyTo.senderName } : null,
        edited: false,
        pinned: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deletedAt: null,
        reactions: [],
        status: 'sending',
      };
      dispatch({ type: 'MESSAGE_ADD', conversationId: convId, message: tempMsg });
      dispatch({ type: 'CONVERSATION_UPDATE', conversation: { id: convId }, touch: true });
      try {
        const data = await api(`/conversations/${convId}/messages`, {
          method: 'POST',
          body: {
            type,
            content,
            attachment: attachment?.id ? { id: attachment.id, name: attachment.name, caption: attachment.caption, duration: attachment.duration, peaks: attachment.peaks } : undefined,
            replyTo: replyTo?.id,
          },
        });
        dispatch({ type: 'MESSAGE_REPLACE', conversationId: convId, from: tempId, message: { ...data.message, status: 'sent' } });
        return data.message;
      } catch (e) {
        dispatch({ type: 'MESSAGE_UPDATE', conversationId: convId, message: { id: tempId, status: 'failed' } });
        toast(e.message, 'error');
        return null;
      }
    };

    const retryMessage = async (convId, messageId) => {
      const conv = stateRef.current.messages[convId];
      const msg = conv?.items.find((m) => m.id === messageId);
      if (!msg) return;
      dispatch({ type: 'MESSAGE_UPDATE', conversationId: convId, message: { id: messageId, status: 'sending' } });
      try {
        const data = await api(`/conversations/${convId}/messages`, {
          method: 'POST',
          body: {
            type: msg.type,
            content: msg.content,
            attachment: msg.attachment?.id ? { id: msg.attachment.id, name: msg.attachment.name, caption: msg.meta?.caption } : undefined,
            replyTo: msg.replyTo?.id,
          },
        });
        dispatch({ type: 'MESSAGE_REPLACE', conversationId: convId, from: messageId, message: { ...data.message, status: 'sent' } });
      } catch (e) {
        dispatch({ type: 'MESSAGE_UPDATE', conversationId: convId, message: { id: messageId, status: 'failed' } });
        toast(e.message, 'error');
      }
    };

    const editMessage = async (convId, messageId, content) => {
      try {
        const data = await api(`/messages/${messageId}`, { method: 'PATCH', body: { content } });
        dispatch({ type: 'MESSAGE_UPDATE', conversationId: convId, message: data.message });
        toast('Message updated');
      } catch (e) {
        toast(e.message, 'error');
      }
    };

    const deleteMessage = async (convId, messageId) => {
      try {
        await api(`/messages/${messageId}`, { method: 'DELETE' });
        dispatch({ type: 'MESSAGE_DELETE', conversationId: convId, messageId });
      } catch (e) {
        toast(e.message, 'error');
      }
    };

    const toggleReaction = async (convId, messageId, emoji) => {
      try {
        const data = await api(`/messages/${messageId}/reactions`, { method: 'POST', body: { emoji } });
        dispatch({ type: 'MESSAGE_UPDATE', conversationId: convId, message: data.message });
      } catch (e) {
        toast(e.message, 'error');
      }
    };

    const togglePin = async (convId, messageId, pin) => {
      try {
        const data = await api(`/messages/${messageId}/pin`, { method: 'POST', body: { pin: !!pin } });
        dispatch({ type: 'MESSAGE_UPDATE', conversationId: convId, message: data.message });
        loadPinned(convId);
      } catch (e) {
        toast(e.message, 'error');
      }
    };

    const loadPinned = async (convId) => {
      try {
        const data = await api(`/conversations/${convId}/pinned`);
        dispatch({ type: 'PINNED', conversationId: convId, messages: data.pinned });
      } catch { /* ignore */ }
    };

    const toggleSave = async (messageId, save) => {
      try {
        await api(`/messages/${messageId}/save`, { method: 'POST', body: { save: !!save } });
        toast(save ? 'Saved for later' : 'Removed from saved');
      } catch (e) {
        toast(e.message, 'error');
      }
    };

    const forwardMessage = async (conversationId, messageId) => {
      const data = await api(`/messages/${messageId}/forward`, { method: 'POST', body: { conversationId } });
      dispatch({ type: 'MESSAGE_ADD', conversationId, message: { ...data.message, status: 'sent' } });
      dispatch({ type: 'CONVERSATION_UPDATE', conversation: { id: conversationId }, touch: true });
      if (stateRef.current.activeConvId === conversationId && stateRef.current.messages[conversationId]?.items?.length) {
        markRead(conversationId);
      }
      return data.message;
    };

    const loadConnections = async () => {
      try {
        const data = await api('/connections');
        dispatch({ type: 'CONNECTIONS', data });
      } catch { /* ignore */ }
    };

    const loadNotifications = async () => {
      try {
        const data = await api('/notifications');
        dispatch({ type: 'NOTIFICATIONS', list: data.notifications });
      } catch { /* ignore */ }
    };

    const loadCallHistory = async () => {
      try {
        const data = await api('/calls');
        dispatch({ type: 'CALL_HISTORY', list: data });
      } catch { /* ignore */ }
    };

    const setTheme = (theme) => {
      try {
        localStorage.setItem('spk.theme', theme);
      } catch { /* ignore */ }
      const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      dispatch({ type: 'THEME', theme });
    };

    const login = (user, token) => {
      setToken(token);
      dispatch({ type: 'LOGIN', user, token });
    };

    const logout = async () => {
      try {
        await api('/logout', { method: 'POST' });
      } catch { /* ignore */ }
      disconnectSocket();
      dispatch({ type: 'LOGOUT' });
      navigate('/');
    };

    return {
      toast, loadConversations, loadMessages, openConversation, markRead, sendTyping,
      sendMessage, retryMessage, editMessage, deleteMessage, toggleReaction, togglePin,
      loadPinned, toggleSave, forwardMessage, loadConnections, loadNotifications, loadCallHistory,
      setTheme, login, logout,
    };
  }, []);

  actionsRef.current = actions;

  // ------------------------------------------------------------------
  // Socket lifecycle + events -> store
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!state.user || !state.token) return;

    const socket = connectSocket(state.token);
    const onState = (ev) => dispatch({ type: 'SOCKET_STATE', state: ev });

    const unsub = onSocketEvent((event, data) => {
      switch (event) {
        case 'connect':
          onState('connected');
          if (stateRef.current.activeConvId) emit('conversation:join', stateRef.current.activeConvId);
          break;
        case 'disconnect':
          onState('disconnected');
          break;
        case 'connect_error':
          onState('reconnecting');
          break;
        case 'message:new': {
          const me = stateRef.current.user?.id;
          dispatch({ type: 'MESSAGE_ADD', conversationId: data.conversationId, message: data });
          if (data.senderId !== me) {
            dispatch({ type: 'MESSAGE_DELIVERED', messageId: data.id });
          }
          const conv = stateRef.current.conversations.find((c) => c.id === data.conversationId);
          if (conv) {
            dispatch({ type: 'CONVERSATION_UPDATE', conversation: { ...conv, lastMessage: { id: data.id, senderId: data.senderId, type: data.type, content: data.content, createdAt: data.createdAt, deleted: false }, updatedAt: data.createdAt }, touch: true });
          }
          const isActive = stateRef.current.activeConvId === data.conversationId && document.visibilityState === 'visible';
          if (data.senderId !== me && isActive) {
            setTimeout(() => actionsRef.current.markRead(data.conversationId), 400);
          } else if (data.senderId !== me && !isActive) {
            const title = conv?.type === 'group' ? (conv.title || 'Group') : conv?.peer?.displayName || 'Sparkline';
            const text = data.type === 'text' ? data.content : data.type === 'voice' ? 'Voice message' : data.type === 'image' ? 'Photo' : data.type === 'video' ? 'Video' : data.type === 'file' ? 'File' : 'New message';
            showNotification(title, text);
            try {
              navigator.vibrate?.(60);
            } catch { /* ignore */ }
          }
          break;
        }
        case 'message:delivered':
          dispatch({ type: 'MESSAGE_DELIVERED', messageId: data.messageId });
          break;
        case 'message:edit':
          dispatch({ type: 'MESSAGE_UPDATE', conversationId: data.message.conversationId, message: data.message });
          break;
        case 'message:delete':
          dispatch({ type: 'MESSAGE_DELETE', conversationId: data.conversationId, messageId: data.messageId });
          break;
        case 'message:reaction':
          dispatch({ type: 'MESSAGE_UPDATE', conversationId: data.message.conversationId, message: data.message });
          break;
        case 'message:pin': {
          dispatch({ type: 'MESSAGE_UPDATE', conversationId: data.message.conversationId, message: data.message });
          actionsRef.current.loadPinned(data.message.conversationId);
          break;
        }
        case 'message:read':
          dispatch({ type: 'READ_AT', conversationId: data.conversationId, userId: data.userId, upTo: data.upTo });
          break;
        case 'typing:start':
          if (data.userId !== stateRef.current.user?.id) {
            dispatch({ type: 'TYPING_START', conversationId: data.conversationId, userId: data.userId, displayName: data.displayName });
          }
          break;
        case 'typing:stop':
          dispatch({ type: 'TYPING_STOP', conversationId: data.conversationId, userId: data.userId });
          break;
        case 'presence:update': {
          dispatch({ type: 'PRESENCE', userId: data.userId, data: { online: data.online, lastSeen: data.lastSeen } });
          const conv = stateRef.current.conversations.find((c) => c.peer?.id === data.userId);
          if (conv) {
            dispatch({ type: 'CONVERSATION_UPDATE', conversation: { id: conv.id, peer: { online: data.online, lastSeen: data.lastSeen } } });
          }
          break;
        }
        case 'conversation:update': {
          if (data.conversationId) refreshConversation(data.conversationId);
          break;
        }
        case 'conversation:new':
          if (data.conversation) dispatch({ type: 'CONVERSATION_UPDATE', conversation: data.conversation });
          break;
        case 'connection:request': {
          dispatch({ type: 'NOTIFICATION_ADD', notification: data });
          dispatch({ type: 'CONNECTION_UPSERT', kind: 'pending', entry: { id: data.id, user: data.data.requester, createdAt: data.createdAt, updatedAt: data.createdAt } });
          showNotification('New connection request', `${data.data.requester.displayName} wants to connect with you.`);
          break;
        }
        case 'connection:accepted': {
          dispatch({ type: 'NOTIFICATION_ADD', notification: { id: data.connectionId, type: 'connection_accepted', data: { user: data.user, conversationId: data.conversationId, text: data.text }, read: 0, createdAt: Date.now() } });
          dispatch({ type: 'CONNECTION_UPSERT', kind: 'accepted', entry: { id: data.connectionId, user: data.user, createdAt: Date.now(), updatedAt: Date.now() } });
          dispatch({ type: 'CONNECTION_REMOVE', userId: data.user.id });
          dispatch({ type: 'CONVERSATION_UPDATE', conversation: { id: data.conversationId, type: 'dm', peer: data.user, members: [data.user], createdAt: Date.now(), updatedAt: Date.now() } });
          showNotification('Connected!', `${data.user.displayName} accepted your request.`);
          actionsRef.current.loadConversations();
          break;
        }
        case 'connection:declined':
          dispatch({ type: 'CONNECTION_REMOVE', userId: data.userId });
          actionsRef.current.toast('Connection request declined');
          break;
        case 'connection:removed':
          dispatch({ type: 'CONNECTION_REMOVE', userId: data.userId });
          actionsRef.current.loadConversations();
          break;
        case 'connection:blocked':
          dispatch({ type: 'CONNECTION_REMOVE', userId: data.userId });
          break;
        case 'group:removed':
          dispatch({ type: 'CONVERSATION_REMOVED', conversationId: data.conversationId });
          if (stateRef.current.activeConvId === data.conversationId) navigate('/app');
          actionsRef.current.toast('You were removed from the group');
          break;
        case 'profile:update': {
          const conv = stateRef.current.conversations.find((c) => c.peer?.id === data.userId);
          if (conv) dispatch({ type: 'CONVERSATION_UPDATE', conversation: { id: conv.id, peer: data.profile } });
          const accepted = stateRef.current.connections.accepted.find((c) => c.user.id === data.userId);
          if (accepted) dispatch({ type: 'CONNECTION_UPSERT', kind: 'accepted', entry: { ...accepted, user: data.profile } });
          break;
        }
        case 'notification:new':
          dispatch({ type: 'NOTIFICATION_ADD', notification: data });
          if (data.data?.text) showNotification('Sparkline', data.data.text);
          break;
        default:
          break;
      }
    });

    const refreshConversation = async (convId) => {
      try {
        const conv = await api(`/conversations/${convId}`);
        if (conv?.conversation) dispatch({ type: 'CONVERSATION_UPDATE', conversation: conv.conversation });
      } catch { /* ignore */ }
    };

    const ping = setInterval(() => emit('presence:ping'), 30000);

    return () => {
      clearInterval(ping);
      unsub();
      disconnectSocket();
    };
  }, [state.user?.id]);

  // ------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------
  useEffect(() => {
    (async () => {
      dispatch({ type: 'BOOTED' });
      try {
        const config = await api('/public/config');
        dispatch({ type: 'CONFIG', config });
      } catch { /* offline */ }
      if (stateRef.current.token) {
        try {
          const { user } = await api('/me');
          dispatch({ type: 'LOGIN', user, token: stateRef.current.token });
          await Promise.all([
            actions.loadConversations(),
            actions.loadConnections(),
            actions.loadNotifications(),
            actions.loadCallHistory(),
          ]);
        } catch {
          dispatch({ type: 'SESSION_EXPIRED' });
        }
      }
    })();

    const onOffline = () => dispatch({ type: 'ONLINE', online: false });
    const onOnline = () => {
      dispatch({ type: 'ONLINE', online: true });
      actions.loadConversations();
      actions.loadConnections();
    };
    const onLoggedOut = () => dispatch({ type: 'SESSION_EXPIRED' });
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    window.addEventListener('spk:logged-out', onLoggedOut);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('spk:logged-out', onLoggedOut);
    };
  }, []);

  const value = useMemo(() => ({ state, dispatch, ...actions }), [state, actions]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}