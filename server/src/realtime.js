import { Server } from 'socket.io';
import { db, logEvent, publicUser } from './db.js';
import { config, log } from './config.js';
import { resolveToken } from './auth.js';
import { now, rateLimiters, uid, safeJsonParse } from './util.js';

const MAX_MESH_PARTICIPANTS = 4;
const RING_TIMEOUT_MS = 60_000;

let io = null;

// socket -> { userId, sessionId }
const sockets = new Map();

const presenceTimers = new Map();
const PRESENCE_BROADCAST_MS = 10_000;

export const rt = {
  emitToUser(userId, event, data) {
    io.to(`user:${userId}`).emit(event, data);
  },
  emitToUsers(userIds, event, data) {
    for (const id of userIds) io.to(`user:${id}`).emit(event, data);
  },
  emitToConversation(conversationId, event, data) {
    io.to(`conv:${conversationId}`).emit(event, data);
  },
  isOnline(userId) {
    return io ? io.of('/').adapter.sockets.size > 0 && io.sockets.adapter.rooms.has(`user:${userId}`) : false;
  },
};

function membersOf(conversationId) {
  return db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?').all(conversationId).map((r) => r.user_id);
}

function blockedBetween(a, b) {
  return db.prepare(
    `SELECT 1 AS x FROM connections WHERE status = 'blocked' AND ((requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?)) LIMIT 1`
  ).get(a, b, b, a) != null;
}

function conversationFor(user, conversationId) {
  return db.prepare(
    `SELECT c.*, cm.role, cm.last_read_at, cm.muted, cm.archived, cm.joined_at
     FROM conversations c JOIN conversation_members cm ON cm.conversation_id = c.id
     WHERE c.id = ? AND cm.user_id = ?`
  ).get(conversationId, user.id);
}

function getUser(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function broadcastPresence(userId, online) {
  const user = getUser(userId);
  if (!user) return;
  const viewers = db.prepare(
    `SELECT DISTINCT
       CASE WHEN requester_id = ? THEN recipient_id ELSE requester_id END AS other
     FROM connections
     WHERE status = 'accepted' AND (requester_id = ? OR recipient_id = ?)`
  ).all(userId, userId, userId).map((r) => r.other);
  const data = {
    userId,
    online,
    lastSeen: online ? now() : now(),
  };
  for (const viewer of viewers) {
    rt.emitToUser(viewer, 'presence:update', data);
  }
}

function queuePresence(userId, online) {
  const prev = presenceTimers.get(userId);
  if (prev) clearTimeout(prev);
  presenceTimers.set(
    userId,
    setTimeout(() => {
      presenceTimers.delete(userId);
      broadcastPresence(userId, online);
    }, online ? PRESENCE_BROADCAST_MS : PRESENCE_BROADCAST_MS / 2)
  );
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------
const ringTimers = new Map();

function callPayload(call) {
  const participants = db.prepare(
    `SELECT cp.*, u.display_name, u.status, u.avatar, u.code, u.updated_at AS last_seen
     FROM call_participants cp JOIN users u ON u.id = cp.user_id
     WHERE cp.call_id = ? ORDER BY cp.joined_at`
  ).all(call.id).map((p) => ({
    userId: p.user_id,
    joinedAt: p.joined_at,
    displayName: p.display_name,
    avatar: p.avatar,
    code: p.code,
  }));
  return {
    id: call.id,
    conversationId: call.conversation_id,
    callerId: call.caller_id,
    callType: call.call_type,
    status: call.status,
    startedAt: call.started_at,
    endedAt: call.ended_at,
    participants,
  };
}

function endCall(callId, reason) {
  const call = db.prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  if (!call || call.status === 'ended') return;
  db.prepare('UPDATE calls SET status = ?, ended_at = ? WHERE id = ?').run('ended', now(), callId);
  db.prepare('UPDATE call_participants SET left_at = ? WHERE call_id = ? AND left_at IS NULL').run(now(), callId);
  clearTimeout(ringTimers.get(callId));
  ringTimers.delete(callId);
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(call.conversation_id);
  if (conv) {
    for (const m of membersOf(conv.id)) {
      rt.emitToUser(m, 'call:ended', { callId, reason });
    }
  }
  const caller = getUser(call.caller_id);
  const callerName = caller ? caller.display_name : 'Someone';
  if (reason === 'missed') {
    insertNotification(call.caller_id, 'missed_call', {
      callId, conversationId: call.conversation_id, callType: call.call_type,
      text: 'Your call was not answered',
    });
  } else if (reason === 'rejected') {
    insertNotification(call.caller_id, 'missed_call', {
      callId, conversationId: call.conversation_id, callType: call.call_type,
      text: 'Your call was declined',
    });
  }
  logEvent('call:end', call.caller_id, { callId, reason, callType: call.call_type, conversationId: call.conversation_id });
}

function insertNotification(userId, type, data) {
  db.prepare('INSERT INTO notifications (id, user_id, type, data, read, created_at) VALUES (?, ?, ?, ?, 0, ?)')
    .run(uid(16), userId, type, JSON.stringify(data), now());
  rt.emitToUser(userId, 'notification:new', { id: uid(16), type, data, read: 0, createdAt: now() });
}

function startRingTimeout(callId) {
  const call = db.prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  if (!call) return;
  ringTimers.set(
    callId,
    setTimeout(() => {
      const c = db.prepare('SELECT * FROM calls WHERE id = ?').get(callId);
      if (!c || c.status !== 'ringing') return;
      endCall(callId, 'missed');
    }, RING_TIMEOUT_MS)
  );
}

function sendIncomingNotifications(callId) {
  const call = db.prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  if (!call) return;
  const caller = getUser(call.caller_id);
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(call.conversation_id);
  if (!conv) return;
  for (const userId of membersOf(conv.id)) {
    if (userId === call.caller_id) continue;
    const user = getUser(userId);
    if (!user) continue;
    insertNotification(userId, 'incoming_call', {
      callId, conversationId: call.conversation_id, callType: call.call_type,
      caller: { id: caller?.id, displayName: caller?.display_name, avatar: caller?.avatar, code: caller?.code },
      text: `${caller?.display_name || 'Someone'} is calling you`,
    });
  }
}

function callForUserValidation(user, callId) {
  const call = db.prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  if (!call) return null;
  const conv = conversationFor(user, call.conversation_id);
  if (!conv) return null;
  return { call, conv };
}

export function initRealtime(server) {
  io = new Server(server, {
    path: '/socket.io',
    serveClient: false,
    cors: {
      origin: true,
      credentials: true,
    },
    maxHttpBufferSize: 1e6,
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    const resolved = resolveToken(token);
    if (!resolved || resolved.scope !== 'user') return next(new Error('unauthorized'));
    socket.data.user = resolved.user;
    socket.data.session = resolved.session;
    next();
  });

  io.on('connection', (socket) => {
    const { user, session } = socket.data;
    sockets.set(socket.id, { userId: user.id, sessionId: session.id });
    socket.join(`user:${user.id}`);

    db.prepare('UPDATE sessions SET last_presence = ? WHERE id = ?').run(now(), session.id);
    queuePresence(user.id, true);

    socket.on('presence:ping', () => {
      db.prepare('UPDATE sessions SET last_presence = ? WHERE id = ?').run(now(), session.id);
    });

    socket.on('conversation:join', (conversationId) => {
      if (typeof conversationId !== 'string') return;
      const conv = conversationFor(user, conversationId);
      if (conv) socket.join(`conv:${conversationId}`);
    });

    socket.on('conversation:leave', (conversationId) => {
      if (typeof conversationId !== 'string') return;
      socket.leave(`conv:${conversationId}`);
    });

    // --- typing (throttled server-side too) ---
    socket.on('typing:start', (conversationId) => {
      if (typeof conversationId !== 'string') return;
      const conv = conversationFor(user, conversationId);
      if (!conv) return;
      const limiter = rateLimiters.socket.check(`typing:${user.id}`, 10, 10_000);
      if (!limiter.allowed) return;
      socket.to(`conv:${conversationId}`).emit('typing:start', { conversationId, userId: user.id, displayName: user.display_name });
    });

    socket.on('typing:stop', (conversationId) => {
      if (typeof conversationId !== 'string') return;
      socket.to(`conv:${conversationId}`).emit('typing:stop', { conversationId, userId: user.id });
    });

    // --- read receipts ---
    socket.on('message:read', (payload) => {
      const conversationId = payload?.conversationId;
      const upTo = Number(payload?.upTo) || now();
      if (typeof conversationId !== 'string') return;
      const conv = conversationFor(user, conversationId);
      if (!conv) return;
      if (upTo <= conv.last_read_at) return;
      db.prepare('UPDATE conversation_members SET last_read_at = ? WHERE conversation_id = ? AND user_id = ?')
        .run(upTo, conversationId, user.id);
      socket.to(`conv:${conversationId}`).emit('message:read', { conversationId, userId: user.id, upTo });
    });

    // --- calls ---
    socket.on('call:accept', (callId) => {
      if (typeof callId !== 'string') return;
      const v = callForUserValidation(user, callId);
      if (!v || v.call.status !== 'ringing') return;
      const existing = db.prepare('SELECT * FROM call_participants WHERE call_id = ? AND user_id = ?').get(callId, user.id);
      const started = db.prepare('SELECT COUNT(*) AS c FROM call_participants WHERE call_id = ?').get(callId).c;
      if (!existing && started >= MAX_MESH_PARTICIPANTS) return;
      if (!existing) {
        db.prepare('INSERT INTO call_participants (call_id, user_id, joined_at, left_at) VALUES (?, ?, ?, NULL)')
          .run(callId, user.id, now());
      }
      const call = db.prepare('SELECT * FROM calls WHERE id = ?').get(callId);
      if (call.status === 'ringing') {
        clearTimeout(ringTimers.get(callId));
        db.prepare('UPDATE calls SET status = ? WHERE id = ?').run('active', callId);
        logEvent('call:start', user.id, { callId, conversationId: call.conversation_id, callType: call.call_type });
      }
      const fresh = db.prepare('SELECT * FROM calls WHERE id = ?').get(callId);
      for (const m of membersOf(fresh.conversation_id)) {
        rt.emitToUser(m, 'call:state', { call: callPayload(fresh), actorId: user.id });
      }
    });

    socket.on('call:reject', (callId) => {
      if (typeof callId !== 'string') return;
      const v = callForUserValidation(user, callId);
      if (!v) return;
      if (v.call.status === 'ringing' && v.call.caller_id !== user.id) {
        endCall(callId, 'rejected');
      }
    });

    socket.on('call:cancel', (callId) => {
      if (typeof callId !== 'string') return;
      const v = callForUserValidation(user, callId);
      if (!v || v.call.caller_id !== user.id || v.call.status !== 'ringing') return;
      endCall(callId, 'canceled');
    });

    socket.on('call:end', (callId) => {
      if (typeof callId !== 'string') return;
      const v = callForUserValidation(user, callId);
      if (!v || v.call.status !== 'active') return;
      endCall(callId, 'ended');
    });

    socket.on('call:signal', (payload) => {
      const callId = payload?.callId;
      const to = payload?.to;
      if (typeof callId !== 'string' || typeof to !== 'string') return;
      const v = callForUserValidation(user, callId);
      if (!v) return;
      const participant = db.prepare('SELECT * FROM call_participants WHERE call_id = ? AND user_id = ?')
        .get(callId, user.id);
      if (!participant || participant.left_at) return;
      const recipient = db.prepare('SELECT * FROM call_participants WHERE call_id = ? AND user_id = ?')
        .get(callId, to);
      if (!recipient || recipient.left_at) return;
      rt.emitToUser(to, 'call:signal', {
        callId,
        from: user.id,
        data: {
          type: payload.data?.type,
          sdp: payload.data?.sdp,
          candidate: payload.data?.candidate,
        },
      });
    });

    socket.on('disconnect', () => {
      sockets.delete(socket.id);
      db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(now(), session.id);
      queuePresence(user.id, false);
    });
  });

  log.info(`realtime ready (max mesh participants: ${MAX_MESH_PARTICIPANTS})`);
}

export { MAX_MESH_PARTICIPANTS };
export function createCallEntry(callerId, conversationId, callType) {
  const id = uid(16);
  db.prepare(
    'INSERT INTO calls (id, conversation_id, caller_id, call_type, status, started_at, ended_at, outcome) VALUES (?, ?, ?, ?, ?, ?, NULL, 0)'
  ).run(id, conversationId, callerId, callType, 'ringing', now());
  db.prepare('INSERT INTO call_participants (call_id, user_id, joined_at, left_at) VALUES (?, ?, ?, NULL)')
    .run(id, callerId, now());
  const call = db.prepare('SELECT * FROM calls WHERE id = ?').get(id);
  startRingTimeout(id);
  sendIncomingNotifications(id);
  logEvent('call:create', callerId, { callId: id, conversationId, callType });
  return call;
}

export function activeOrRecentCallFor(conversationId) {
  return db.prepare(
    "SELECT * FROM calls WHERE conversation_id = ? AND status != 'ended' ORDER BY started_at DESC LIMIT 1"
  ).get(conversationId) || null;
}

export function emitMessageEvents(conversationId, event, data) {
  rt.emitToConversation(conversationId, event, data);
}

export function notifyConnectionRequest(requester, recipient) {
  const data = {
    id: uid(16),
    type: 'connection_request',
    data: {
      requester: {
        id: requester.id,
        displayName: requester.display_name,
        avatar: requester.avatar,
        status: requester.status,
        code: requester.code,
      },
      text: `${requester.display_name} wants to connect with you.`,
    },
    read: 0,
    createdAt: now(),
  };
  db.prepare('INSERT INTO notifications (id, user_id, type, data, read, created_at) VALUES (?, ?, ?, ?, 0, ?)')
    .run(data.id, recipient.id, 'connection_request', JSON.stringify(data.data), now());
  rt.emitToUser(recipient.id, 'connection:request', data);
}

export default initRealtime;