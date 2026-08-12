import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../lib/store.jsx';
import { useCallEngine } from '../lib/calls.js';
import { api } from '../lib/api.js';
import { clockTime, dayLabel, lastActiveLabel, formatDuration, formatSize } from '../lib/format.js';
import { MessageBubble } from './MessageBubble.jsx';
import { Composer } from './Composer.jsx';
import { Avatar, Drawer, Dropdown, Modal, Switch, Spinner, EmptyState } from './ui.jsx';
import {
  IconBack, IconPhone, IconVideo, IconSearch, IconMore, IconDownload, IconPin, IconBellOff,
  IconTrash, IconShield, IconChevron, IconInfo, IconForward,
} from './icons.jsx';

function convName(conv) {
  if (conv?.title) return conv.title;
  return conv?.peer?.displayName || (conv?.type === 'group' ? 'Group' : 'Unknown');
}

function convAvatar(conv) {
  return conv?.type === 'group' ? null : conv?.peer || null;
}

const dayGapMs = (a, b) => !b || new Date(a).toDateString() !== new Date(b).toDateString();

export function ChatWindow({ conversation, onBack }) {
  const { state, openConversation, loadMessages, sendTyping, forwardMessage, toast } = useApp();
  const engine = useCallEngine(
    () => state.config,
    () => state.user
  );
  const conv = conversation;
  const me = state.user;
  const msgs = state.messages[conv?.id];
  const items = msgs?.items || [];
  const [replyTo, setReplyTo] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [mediaTab, setMediaTab] = useState('media');
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [forwarding, setForwarding] = useState(false);
  const [forwardList, setForwardList] = useState(new Set());
  const [forwardPicker, setForwardPicker] = useState(false);
  const [newMsgPill, setNewMsgPill] = useState(false);
  const listRef = useRef(null);
  const bottomRef = useRef(null);
  const nearBottomRef = useRef(true);
  const scrolledFor = useRef(null);
  const prevConvId = useRef(null);
  const lastReadAt = state.readAt[conv?.id]?.[me?.id];
  const typingUsers = state.typing[conv?.id];
  const typingNames = typingUsers ? Object.values(typingUsers).map((t) => t.displayName) : [];
  const pinned = state.pinned[conv?.id] || [];

  // ------------------------------------------------------------------
  // load + join
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!conv?.id) return;
    if (prevConvId.current !== conv.id) {
      prevConvId.current = conv.id;
      setReplyTo(null);
      setForwarding(false);
      setForwardList(new Set());
      setSearchQuery('');
      setSearchResults([]);
      setSearchOpen(false);
      setInfoOpen(false);
    }
    openConversation(conv.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv?.id]);

  // scroll to bottom on first load
  const hasLoaded = !!msgs?.loading || items.length === 0;
  useLayoutEffect(() => {
    if (!hasLoaded && items.length > 0 && scrolledFor.current !== conv.id) {
      scrolledFor.current = conv.id;
      bottomRef.current?.scrollIntoView({ block: 'end' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgs?.loading, items.length]);

  // auto scroll on new message if near bottom
  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    nearBottomRef.current = near;
    if (near) setNewMsgPill(false);
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [onScroll]);

  useEffect(() => {
    if (!conv?.id) return;
    const last = items[items.length - 1];
    if (last && nearBottomRef.current && last.senderId !== me?.id) {
      bottomRef.current?.scrollIntoView({ block: 'end' });
    }
    if (last && last.senderId !== me?.id && !nearBottomRef.current) setNewMsgPill(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  // mark read on visibility / message arrival handled by store

  const loadEarlier = async () => {
    if (!msgs?.hasMore || msgs?.loading) return;
    const first = items[0];
    const prevHeight = listRef.current?.scrollHeight || 0;
    await loadMessages(conv.id, { before: first?.id });
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight - prevHeight;
    });
  };

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
    setNewMsgPill(false);
  };

  const startCall = (callType) => {
    engine?.startCall(conv.id, callType);
  };

  // ------------------------------------------------------------------
  // Info panel data
  // ------------------------------------------------------------------
  const sharedMedia = useMemo(() => {
    if (!conv?.id) return [];
    const list = [];
    for (const m of items) {
      if (m.type === 'image' || m.type === 'video' || m.type === 'file' || m.type === 'audio') list.push(m);
    }
    return list.slice(-80).reverse();
  }, [conv?.id, items]);

  const doSearch = (q) => {
    setSearchQuery(q);
    if (!q.trim()) return setSearchResults([]);
    const needle = q.trim().toLowerCase();
    const hits = items.filter((m) => (m.content || '').toLowerCase().includes(needle)).slice(-40).reverse();
    setSearchResults(hits);
  };

  const jumpToMessage = (id) => {
    const el = listRef.current?.querySelector(`[data-mid="${id}"]`);
    el?.scrollIntoView({ block: 'center' });
  };

  const clearChat = async () => {
    if (!confirm('Clear this conversation on all devices?')) return;
    try {
      await api(`/conversations/${conv.id}`, { method: 'DELETE' });
      toast('Conversation cleared', 'success');
      onBack?.();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const blockUser = async () => {
    const peerId = conv?.peer?.id;
    if (!peerId) return;
    try {
      await api(`/connections/${peerId}/block`, { method: 'POST' });
      toast('Contact blocked', 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const muteConv = async () => {
    try {
      const data = await api(`/conversations/${conv.id}/mute`, { method: 'POST', body: { muted: !conv.muted } });
      toast(data.muted ? 'Notifications muted' : 'Notifications unmuted', 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const setDisappearing = async (ms) => {
    try {
      await api(`/conversations/${conv.id}`, { method: 'PATCH', body: { type: 'disappearing', ms } });
      toast(ms ? `Messages disappear after ${formatDuration(ms)}` : 'Disappearing messages off', 'success');
      openConversation(conv.id);
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  // ------------------------------------------------------------------
  // render
  // ------------------------------------------------------------------
  if (!conv) {
    return (
      <div className="chat-empty">
        <EmptyState icon={<IconInfo />} title="No conversation" text="Pick a chat from the list to start messaging." />
      </div>
    );
  }

  const statusLine = typingNames.length
    ? `${typingNames.join(', ')} ${typingNames.length === 1 ? 'is' : 'are'} typing…`
    : conv.type === 'group'
    ? `${conv.memberCount || 0} members`
    : state.presence[conv.peer?.id]?.online
    ? 'Online'
    : conv.peer?.lastSeen
    ? lastActiveLabel(conv.peer.lastSeen, false)
    : '';

  const isTyping = typingNames.length > 0;

  const moreItems = [
    { key: 'info', icon: <IconInfo />, label: 'Conversation info', onClick: () => setInfoOpen(true) },
    { key: 'search', icon: <IconSearch />, label: 'Search in chat', onClick: () => setSearchOpen(true) },
    { key: 'mute', icon: <IconBellOff />, label: conv?.muted ? 'Unmute notifications' : 'Mute notifications', onClick: muteConv },
    { key: 'pinned', icon: <IconPin />, label: `${pinned.length ? 'View' : 'No'} pinned messages`, disabled: !pinned.length, onClick: () => setPinnedOpen(true) },
    { key: 'forward', icon: <IconForward />, label: 'Forward messages', onClick: () => setForwarding(!forwarding) },
    ...(conv.type === 'group' ? [{ key: 'leave', icon: <IconShield />, label: 'Leave group', danger: true }] : []),
    { key: 'block', icon: <IconShield />, label: 'Block contact', danger: true, onClick: blockUser },
    { key: 'clear', icon: <IconTrash />, label: 'Clear conversation', danger: true, onClick: clearChat },
  ];

  return (
    <div className="chat-window">
      {/* header */}
      <header className="chat-head">
        <button className="btn btn-icon back-btn" onClick={onBack} aria-label="Back">
          <IconBack />
        </button>
        <button
          className="chat-avatar"
          onClick={() => setInfoOpen(true)}
          title="Conversation info"
          aria-label="Open conversation info"
        >
          <Avatar user={convAvatar(conv)} name={convName(conv)} size={40} online={conv.type !== 'group' && !!state.presence[conv.peer?.id]?.online} />
        </button>
        <div className="info" onClick={() => setInfoOpen(true)} role="button">
          <div className="name">{convName(conv)}</div>
          <div className={`status ${isTyping ? 'typing' : ''}`}>
            {isTyping ? (
              <>
                <span className="typing-dots"><i /><i /><i /></span>
                {statusLine}
              </>
            ) : (
              statusLine
            )}
          </div>
        </div>
        <div className="chat-actions">
          <button className="btn btn-icon" onClick={() => startCall('audio')} aria-label="Start audio call" title="Voice call">
            <IconPhone />
          </button>
          <button className="btn btn-icon" onClick={() => startCall('video')} aria-label="Start video call" title="Video call">
            <IconVideo />
          </button>
          <button className="btn btn-icon" onClick={() => setSearchOpen(!searchOpen)} aria-label="Search in chat" title="Search">
            <IconSearch />
          </button>
          <button
            className="btn btn-icon"
            onClick={(e) => { setMenuAnchor(e.currentTarget); setMenuOpen(true); }}
            aria-label="More options"
          >
            <IconMore />
          </button>
        </div>
      </header>

      {menuOpen && (
        <Dropdown items={moreItems} anchor={menuAnchor} onClose={() => setMenuOpen(false)} />
      )}

      {/* forward mode banner */}
      {forwarding && (
        <div className="forward-bar">
          <span>{forwardList.size > 0 ? `${forwardList.size} message${forwardList.size > 1 ? 's' : ''} selected` : 'Tap messages to forward'}</span>
          <button className="btn btn-sm" onClick={() => { setForwardList(new Set()); setForwarding(false); }}>Cancel</button>
          {forwardList.size > 0 && (
            <button className="btn btn-sm btn-primary" onClick={() => setForwardPicker(true)}>Forward</button>
          )}
        </div>
      )}

      {/* forward picker */}
      <Modal open={forwardPicker} onClose={() => setForwardPicker(false)} title="Forward to…">
        <div className="conv-picker">
          {state.conversations.filter((c) => c.id !== conv.id).map((c) => (
            <button
              key={c.id}
              className="conv-pick-row"
              onClick={async () => {
                setForwardPicker(false);
                for (const mid of forwardList) {
                  try {
                    await forwardMessage(c.id, mid);
                  } catch (e) {
                    toast(e.message, 'error');
                    break;
                  }
                }
                toast(`Forwarded to ${c.title || c.peer?.displayName || 'conversation'}`, 'success');
                setForwardList(new Set());
                setForwarding(false);
              }}
            >
              <Avatar user={c.type === 'group' ? null : c.peer} name={c.title || c.peer?.displayName || 'Group'} size={40} />
              <span className="grow" style={{ textAlign: 'left' }}>{c.title || c.peer?.displayName || 'Group'}</span>
              <IconForward style={{ width: 16, height: 16, color: 'var(--text-3)' }} />
            </button>
          ))}
        </div>
      </Modal>

      {/* search bar */}
      {searchOpen && (
        <div className="search-bar">
          <input
            className="input"
            autoFocus
            placeholder="Search in chat…"
            value={searchQuery}
            onChange={(e) => doSearch(e.target.value)}
          />
          <button className="btn btn-icon" onClick={() => setSearchOpen(false)} aria-label="Close search"><IconX /></button>
          <div className="search-results">
            {searchQuery && searchResults.length === 0 ? (
              <div className="empty" style={{ padding: 20 }}><p>No results in loaded messages</p></div>
            ) : (
              searchResults.map((m) => (
                <button key={m.id} className="search-result" onClick={() => { jumpToMessage(m.id); setSearchOpen(false); }}>
                  <Avatar user={conv.type === 'group' ? { displayName: m.senderId === me?.id ? 'You' : 'Member' } : undefined} name={m.senderId === me?.id ? 'You' : convName(conv)} size={32} />
                  <span className="grow" style={{ textAlign: 'left' }}>
                    <b>{m.senderId === me?.id ? 'You' : convName(conv)}</b>
                    <span className="text-2" style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                      {m.type === 'text' ? m.content : `📎 ${m.type}`}
                    </span>
                  </span>
                  <span className="tiny text-3">{clockTime(m.createdAt)}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* pinned banner */}
      {pinned.length > 0 && !pinnedOpen && (
        <button className="pinned-banner" onClick={() => setPinnedOpen(true)} title="View pinned messages">
          <IconPin style={{ color: 'var(--accent)' }} />
          <span className="grow">
            <b>{pinned.length} pinned</b>
            <span className="text-2" style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
              {pinned[0].type === 'text' ? pinned[0].content : `📎 ${pinned[0].type}`}
            </span>
          </span>
          <IconChevron style={{ width: 14, height: 14 }} />
        </button>
      )}

      {/* pinned drawer */}
      {pinnedOpen && (
        <div className="pinned-panel">
          <div className="panel-head">
            <span><IconPin /> Pinned messages</span>
            <button className="btn btn-icon" onClick={() => setPinnedOpen(false)} aria-label="Close"><IconX /></button>
          </div>
          <div className="panel-body">
            {pinned.map((m) => (
              <button key={m.id} className="search-result" onClick={() => { jumpToMessage(m.id); setPinnedOpen(false); }}>
                <IconPin style={{ color: 'var(--accent)', width: 16, height: 16 }} />
                <span className="grow" style={{ textAlign: 'left' }}>
                  <b>{m.senderId === me?.id ? 'You' : 'Member'}</b>
                  <span className="text-2" style={{ display: 'block' }}>{m.type === 'text' ? m.content : `📎 ${m.type}`}</span>
                </span>
                <span className="tiny text-3">{clockTime(m.createdAt)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* messages */}
      <div className="chat-body" ref={listRef} onScroll={onScroll}>
        <div className="inner">
          {msgs?.loading && <Spinner />}

          {msgs?.hasMore && (
            <button className="load-earlier" onClick={loadEarlier}>
              <IconChevron style={{ transform: 'rotate(180deg)' }} />
              Load earlier
            </button>
          )}

          {items.length === 0 && !msgs?.loading && (
            <div className="empty" style={{ padding: 48 }}>
              <p>No messages yet. Say hi! 👋</p>
            </div>
          )}

          {items.map((m, i) => {
            const prev = items[i - 1];
            const next = items[i + 1];
            const newDay = dayGapMs(m.createdAt, prev?.createdAt);
            const showSender = conv.type === 'group' && m.senderId !== me?.id && (!next || next.senderId !== m.senderId);
            return (
              <React.Fragment key={m.id}>
                {newDay && (
                  <div className="day-sep">
                    <span>{dayLabel(m.createdAt)}</span>
                  </div>
                )}
                {m.deletedAt ? (
                  <div className="deleted-msg">
                    {m.senderId === me?.id ? 'You deleted this message' : 'This message was deleted'}
                    {m.meta?.reason ? ` — ${m.meta.reason}` : ''}
                  </div>
                ) : (
                  <MessageBubble
                    msg={m}
                    conversation={conv}
                    showSender={showSender}
                    onReply={() => {
                      const senderName = m.senderId === me?.id ? 'You' : conv.members?.find((mm) => mm.id === m.senderId)?.displayName || convName(conv);
                      setReplyTo({ id: m.id, type: m.type, content: m.content, senderName });
                    }}
                    onScrollTo={(id) => jumpToMessage(id)}
                    onForward={(msg) => {
                      setForwarding(true);
                      setForwardList(new Set([msg.id]));
                    }}
                  />
                )}
              </React.Fragment>
            );
          })}

          {/* typing indicator */}
          {isTyping && (
            <div className="typing-bubble">
              <span className="typing-dots"><i /><i /><i /></span>
              <span className="text-3">{typingNames.join(', ')} {typingNames.length === 1 ? 'is' : 'are'} typing…</span>
            </div>
          )}

          {/* read marker */}
          {lastReadAt && !typingNames.length && (
            <div className="read-marker" style={{ textAlign: 'right', padding: '4px 8px' }}>
              <span className="text-3 tiny">Read up to {clockTime(lastReadAt)}</span>
            </div>
          )}

          <div ref={bottomRef} style={{ height: 1 }} />
        </div>
      </div>

      {/* new message pill */}
      {newMsgPill && (
        <button className="new-msg-pill" onClick={scrollToBottom} aria-label="Jump to newest message">
          <IconChevron />
        </button>
      )}

      {/* disappearing timer bar */}
      {conv?.disappearingMs > 0 && items.length > 0 && (
        <div className="disappear-bar">
          <span className="dot" style={{ background: 'var(--amber)' }} />
          Messages disappear after {formatDuration(conv.disappearingMs)}
        </div>
      )}

      <Composer
        conversation={conv}
        replyTo={replyTo}
        onReplyDismiss={() => setReplyTo(null)}
        onScrollToMessage={jumpToMessage}
      />
      <Drawer open={infoOpen} onClose={() => setInfoOpen(false)} title="Conversation info">
        <div className="info-profile">
          <Avatar user={convAvatar(conv)} name={convName(conv)} size={84} online={conv.type !== 'group' && !!state.presence[conv.peer?.id]?.online} showDot={conv.type !== 'group'} />
          <h3>{convName(conv)}</h3>
          <p className="text-3">
            {conv.type === 'group' ? `${conv.memberCount || 0} members` : `@${conv.peer?.username || 'unknown'}`}
          </p>
        </div>

        <div className="tabs" role="tablist">
          {[['media', 'Media'], ['files', 'Files'], ['members', 'Members']].map(([key, label]) => (
            <button key={key} role="tab" aria-selected={mediaTab === key} className={mediaTab === key ? 'active' : ''} onClick={() => setMediaTab(key)}>
              {label}
            </button>
          ))}
        </div>

        {mediaTab === 'media' && (
          <div className="media-grid">
            {sharedMedia.filter((m) => m.type === 'image' || m.type === 'video').length === 0 ? (
              <div className="empty" style={{ padding: 32 }}><p>No shared media yet</p></div>
            ) : (
              sharedMedia.filter((m) => m.type === 'image' || m.type === 'video').map((m) => (
                <a key={m.id} href={m.attachment?.url} target="_blank" rel="noreferrer">
                  <img src={m.attachment?.url} alt="" loading="lazy" />
                </a>
              ))
            )}
          </div>
        )}

        {mediaTab === 'files' && (
          <div className="link-list">
            {sharedMedia.filter((m) => m.type === 'file' || m.type === 'audio').length === 0 ? (
              <div className="empty" style={{ padding: 32 }}><p>No files yet</p></div>
            ) : (
              sharedMedia.filter((m) => m.type === 'file' || m.type === 'audio').map((m) => (
                <a key={m.id} className="file-row" href={m.attachment?.url} target="_blank" rel="noreferrer">
                  <span className="file-ic">📄</span>
                  <span className="grow">
                    <b>{m.attachment?.name || m.type}</b>
                    <span className="text-3 tiny">{formatSize(m.attachment?.size || 0)}</span>
                  </span>
                  <IconDownload style={{ width: 16, height: 16 }} />
                </a>
              ))
            )}
          </div>
        )}

        {mediaTab === 'members' && conv.type === 'group' && (
          <div className="member-list">
            {(conv.members || []).map((mm) => (
              <div className="member-row" key={mm.user?.id || mm.id}>
                <Avatar user={mm.user} name={mm.user?.displayName || mm.displayName} size={36} online={!!state.presence[mm.user?.id || mm.id]?.online} />
                <span className="grow">
                  <b>{mm.user?.displayName || mm.displayName}</b>
                  {mm.role === 'owner' && <span className="badge">Owner</span>}
                </span>
                <span className="text-3 tiny">{state.presence[mm.user?.id || mm.id]?.online ? 'Online' : mm.user?.lastSeen ? lastActiveLabel(mm.user.lastSeen, false) : ''}</span>
              </div>
            ))}
          </div>
        )}

        <div className="info-actions">
          {conv.disappearingMs > 0 && (
            <div className="setting-row">
              <span className="grow">
                <b>Disappearing messages</b>
                <span className="text-3" style={{ display: 'block' }}>Messages auto-delete after {formatDuration(conv.disappearingMs)}</span>
              </span>
              <button className="btn btn-sm" onClick={() => setDisappearing(0)}>Disable</button>
            </div>
          )}
          {conv.type !== 'group' && (
            <div className="setting-row">
              <span className="grow"><b>Notifications</b></span>
              <Switch checked={!conv.muted} onChange={() => muteConv()} label="Mute notifications" />
            </div>
          )}
        </div>
      </Drawer>
    </div>
  );

}
