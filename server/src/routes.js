import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { db, publicUser, ownProfile, logEvent } from './db.js';
import { config, log } from './config.js';
import { authMiddleware, adminMiddleware, createSession, deleteSession, deleteAllSessions, adminToken, setSessionCookie, sessionTokenFromRequest, resolveToken } from './auth.js';
import {
  now, uid, sparklineCode, groupInviteCode, sanitizeText, safeJsonParse, ipKey, rateLimiters, contentTypeOf,
} from './util.js';
import {
  rt, createCallEntry, activeOrRecentCallFor, MAX_MESH_PARTICIPANTS, notifyConnectionRequest,
} from './realtime.js';

export const api = Router();

const LIMITS = {
  image: config.maxUploadImage,
  video: config.maxUploadVideo,
  audio: config.maxUploadAudio,
  doc: config.maxUploadDoc,
};

const MAGIC = {
  png: [[0x89, 0x50, 0x4e, 0x47]],
  jpg: [[0xff, 0xd8, 0xff]],
  gif: [[0x47, 0x49, 0x46, 0x38]],
  webp: [[0x52, 0x49, 0x46, 0x46]],
  mp4: [[0x00, 0x00, 0x00], [0x66, 0x74, 0x79, 0x70]],
  webm: [[0x1a, 0x45, 0xdf, 0xa3]],
  mp3: [[0x49, 0x44, 0x33]],
  wav: [[0x52, 0x49, 0x46, 0x46]],
  ogg: [[0x4f, 0x67, 0x67, 0x53]],
  pdf: [[0x25, 0x50, 0x44, 0x46]],
  zip: [[0x50, 0x4b, 0x03, 0x04]],
  opus: [[0x4f, 0x70, 0x75, 0x73]],
};

function sniff(buf) {
  for (const [ext, sigs] of Object.entries(MAGIC)) {
    for (const sig of sigs) {
      if (buf.length >= sig.length && sig.every((b, i) => buf[i] === b)) return ext;
    }
  }
  return null;
}

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'];
const VIDEO_EXTS = ['mp4', 'webm', 'mov', 'mkv'];
const AUDIO_EXTS = ['mp3', 'wav', 'ogg', 'opus', 'm4a', 'aac', 'flac', 'webm_audio'];
const SAFE_EXT_BY_MIME = {
  'image/png': ['png'], 'image/jpeg': ['jpg', 'jpeg'], 'image/gif': ['gif'], 'image/webp': ['webp'], 'image/avif': ['avif'],
  'video/mp4': ['mp4'], 'video/webm': ['webm'], 'video/quicktime': ['mov'], 'video/x-matroska': ['mkv'],
  'audio/mpeg': ['mp3'], 'audio/wav': ['wav'], 'audio/ogg': ['ogg'], 'audio/opus': ['opus'],
  'audio/mp4': ['m4a'], 'audio/aac': ['aac'], 'audio/flac': ['flac'], 'audio/webm': ['webm_audio'],
  'application/pdf': ['pdf'], 'application/zip': ['zip'],
  'text/plain': ['txt'], 'text/markdown': ['md'], 'text/csv': ['csv'], 'application/json': ['json'],
  'application/msword': ['doc'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'application/vnd.ms-excel': ['xls'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
  'application/vnd.ms-powerpoint': ['ppt'], 'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx'],
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, config.uploadDir),
    filename: (req, file, cb) => cb(null, `${uid(24)}${path.extname(file.originalname || '').slice(0, 10)}`),
  }),
  limits: { fileSize: config.maxUploadVideo, files: 1 },
});

function userVisible(user, viewerId) {
  // At least one accepted connection is required to see detailed presence
  return publicUser(user);
}

function isConnected(a, b) {
  return db.prepare(
    "SELECT 1 AS x FROM connections WHERE status = 'accepted' AND ((requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?)) LIMIT 1"
  ).get(a, b, b, a) != null;
}

function isBlocked(a, b) {
  return db.prepare(
    "SELECT 1 AS x FROM connections WHERE status = 'blocked' AND ((requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?)) LIMIT 1"
  ).get(a, b, b, a) != null;
}

function relationship(userA, userB) {
  const rel = db.prepare(
    `SELECT * FROM connections WHERE (requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?) LIMIT 1`
  ).get(userA, userB, userB, userA);
  if (!rel) return 'none';
  return rel.status;
}

function fail(res, status, code, message) {
  return res.status(status).json({ ok: false, error: { code, message } });
}

function conversationFor(userId, conversationId) {
  return db.prepare(
    `SELECT c.*, cm.role, cm.last_read_at, cm.muted, cm.archived, cm.joined_at
     FROM conversations c JOIN conversation_members cm ON cm.conversation_id = c.id
     WHERE c.id = ? AND cm.user_id = ?`
  ).get(conversationId, userId);
}

function lastPresenceFor(userId) {
  const s = db.prepare('SELECT MAX(last_presence) AS last_presence FROM sessions WHERE user_id = ?').get(userId);
  return s?.last_presence || 0;
}

function userPresence(userId, online) {
  return {
    userId,
    online,
    lastSeen: online ? now() : lastPresenceFor(userId),
  };
}

// ---------------------------------------------------------------------------
// Message serialization
// ---------------------------------------------------------------------------
function reactionsFor(messageId) {
  return db.prepare(
    `SELECT emoji, COUNT(*) AS count FROM message_reactions WHERE message_id = ? GROUP BY emoji`
  ).all(messageId).map((r) => ({ emoji: r.emoji, count: r.count }));
}

function attachmentFor(messageId) {
  const f = db.prepare(
    'SELECT f.id, f.name, f.mime, f.size, f.stored_name FROM files f JOIN messages m ON m.attachment_id = f.id WHERE m.id = ?'
  ).get(messageId);
  if (!f) return null;
  return {
    id: f.id,
    name: f.name,
    mime: f.mime,
    size: f.size,
    url: `/api/files/${f.id}`,
  };
}

export function messageRow(msg, viewerId) {
  let content = msg.content;
  let meta = null;
  if (msg.content.startsWith('{') && msg.content.endsWith('}')) {
    const parsed = safeJsonParse(msg.content);
    if (parsed?.kind === 'attachment' && msg.type !== 'text') {
      meta = parsed;
      content = parsed.caption || '';
    } else if (parsed?.kind === 'rich' && msg.type === 'text') {
      meta = parsed;
      content = parsed.text || '';
    }
  }
  let reply = null;
  if (msg.reply_to) {
    const r = db.prepare('SELECT * FROM messages WHERE id = ?').get(msg.reply_to);
    if (r && !r.deleted_at) {
      reply = {
        id: r.id,
        type: r.type,
        content: r.type === 'text' ? r.content.slice(0, 300) : '',
        senderName: db.prepare('SELECT display_name FROM users WHERE id = ?').get(r.sender_id)?.display_name || 'Unknown',
      };
    }
  }
  return {
    id: msg.id,
    conversationId: msg.conversation_id,
    senderId: msg.sender_id,
    type: msg.type,
    content,
    meta,
    attachment: attachmentFor(msg.id),
    replyTo: reply,
    edited: !!msg.edited,
    pinned: !!msg.pinned,
    createdAt: msg.created_at,
    updatedAt: msg.updated_at,
    deletedAt: msg.deleted_at,
    reactions: msg.deleted_at ? [] : reactionsFor(msg.id),
  };
}

// ---------------------------------------------------------------------------
// Onboarding / profile
// ---------------------------------------------------------------------------
api.post('/onboard', (req, res) => {
  const limit = rateLimiters.http.check(`onboard:${ipKey(req)}`, 10, 3600_000);
  if (!limit.allowed) return fail(res, 429, 'rate_limited', 'Too many sign-ups from this network. Try again later.');
  const displayName = sanitizeText(req.body?.displayName, 60);
  const status = sanitizeText(req.body?.status, 120);
  const about = sanitizeText(req.body?.about, 400);
  if (!displayName) return fail(res, 400, 'invalid_name', 'Please enter a display name.');
  let code = sparklineCode();
  while (db.prepare('SELECT 1 FROM users WHERE code = ?').get(code)) code = sparklineCode();
  const id = uid(16);
  const nowMs = now();
  db.prepare(
    'INSERT INTO users (id, code, display_name, avatar, status, about, created_at, updated_at, banned) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)'
  ).run(id, code, displayName, null, status || null, about || null, nowMs, nowMs);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  const { token, sessionId } = createSession(user.id, req.get('user-agent') || null);
  setSessionCookie(res, token);
  // personal "Saved messages" conversation
  const convId = uid(16);
  db.prepare("INSERT INTO conversations (id, type, owner_id, title, created_at, updated_at) VALUES (?, 'saved', ?, 'Saved Messages', ?, ?)")
    .run(convId, user.id, nowMs, nowMs);
  db.prepare('INSERT INTO conversation_members (conversation_id, user_id, role, joined_at, last_read_at, muted, archived) VALUES (?, ?, ?, ?, ?, 0, 0)')
    .run(convId, user.id, 'admin', nowMs, nowMs);
  logEvent('user:onboard', user.id, { code });
  res.json({ ok: true, data: { user: ownProfile(user), token } });
});

api.get('/me', authMiddleware, (req, res) => {
  res.json({ ok: true, data: { user: ownProfile(req.user) } });
});

api.patch('/me', authMiddleware, (req, res) => {
  const displayName = req.body?.displayName !== undefined ? sanitizeText(req.body.displayName, 60) : null;
  const status = req.body?.status !== undefined ? sanitizeText(req.body.status, 120) : null;
  const about = req.body?.about !== undefined ? sanitizeText(req.body.about, 400) : null;
  if (displayName === null || !displayName) return fail(res, 400, 'invalid_name', 'Display name cannot be empty.');
  db.prepare('UPDATE users SET display_name = ?, status = ?, about = ?, updated_at = ? WHERE id = ?')
    .run(displayName, status, about, now(), req.user.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  rt.emitToUsers(connectedUserIds(req.user.id), 'profile:update', { userId: user.id, profile: publicUser(user) });
  res.json({ ok: true, data: { user: ownProfile(user) } });
});

api.post('/me/avatar', authMiddleware, upload.single('file'), (req, res) => {
  const file = req.file;
  if (!file || file.size > LIMITS.image) return fail(res, 400, 'invalid_file', 'Image too large (max 15 MB).');
  const head = fs.readFileSync(file.path).subarray(0, 16);
  const sniffed = sniff(head);
  if (!sniffed || !['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(sniffed)) {
    fs.unlinkSync(file.path);
    return fail(res, 400, 'invalid_file', 'Unsupported image format.');
  }
  const stored = `${uid(20)}${path.extname(file.originalname).toLowerCase() || '.png'}`;
  fs.mkdirSync(path.join(config.uploadDir, 'avatars'), { recursive: true });
  fs.renameSync(file.path, path.join(config.uploadDir, 'avatars', stored));
  db.prepare('UPDATE users SET avatar = ?, updated_at = ? WHERE id = ?').run(`/api/files/avatar/${stored}`, now(), req.user.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ ok: true, data: { user: ownProfile(user) } });
});

api.post('/me/sessions/revoke', authMiddleware, (req, res) => {
  const target = sanitizeText(req.body?.sessionId, 64);
  if (!target) return fail(res, 400, 'invalid_session', 'Missing session id.');
  if (target === req.session.id) return fail(res, 400, 'invalid_session', 'Use logout for the current session.');
  deleteSession(target);
  res.json({ ok: true, data: { revoked: true } });
});

api.post('/logout', authMiddleware, (req, res) => {
  deleteSession(req.session.id);
  res.json({ ok: true, data: { loggedOut: true } });
});

// ---------------------------------------------------------------------------
// Users lookup
// ---------------------------------------------------------------------------
api.get('/users/lookup', authMiddleware, (req, res) => {
  const limiter = rateLimiters.http.check(`lookup:${req.user.id}`, 30, 60_000);
  if (!limiter.allowed) return fail(res, 429, 'rate_limited', 'Too many lookups. Try again in a moment.');
  const code = sanitizeText(String(req.query.code || ''), 32).toUpperCase();
  if (!code) return fail(res, 400, 'invalid_code', 'Enter a Sparkline code.');
  const user = db.prepare('SELECT * FROM users WHERE code = ?').get(code);
  if (!user || user.banned || isBlocked(req.user.id, user.id)) {
    return fail(res, 404, 'not_found', 'Sparkline code not found.');
  }
  if (user.id === req.user.id) return fail(res, 400, 'self', "That's your own code.");
  const rel = relationship(req.user.id, user.id);
  res.json({
    ok: true,
    data: {
      user: userVisible(user, req.user.id),
      relationship: rel,
      online: rt.isOnline(user.id),
      lastSeen: lastPresenceFor(user.id),
    },
  });
});

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------
function connectedUserIds(userId) {
  return db.prepare(
    `SELECT DISTINCT CASE WHEN requester_id = ? THEN recipient_id ELSE requester_id END AS other
     FROM connections WHERE status = 'accepted' AND (requester_id = ? OR recipient_id = ?)`
  ).all(userId, userId, userId).map((r) => r.other);
}

api.get('/connections', authMiddleware, (req, res) => {
  const rows = db.prepare(
    `SELECT c.id, c.requester_id, c.recipient_id, c.created_at, c.updated_at,
            c.status AS conn_status,
            u.display_name, u.avatar, u.status, u.code, u.about
     FROM connections c JOIN users u ON u.id = CASE WHEN c.requester_id = ? THEN c.recipient_id ELSE c.requester_id END
     WHERE c.requester_id = ? OR c.recipient_id = ?
     ORDER BY c.updated_at DESC`
  ).all(req.user.id, req.user.id, req.user.id);
  const data = {
    accepted: [],
    pending: [],
    requested: [],
    blocked: [],
  };
  for (const row of rows) {
    const entry = {
      id: row.id,
      user: { id: row.id === row.recipient_id ? row.requester_id : row.recipient_id, displayName: row.display_name, avatar: row.avatar, status: row.status, code: row.code, about: row.about },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
    if (row.conn_status === 'accepted') data.accepted.push(entry);
    else if (row.conn_status === 'pending' && row.recipient_id === req.user.id) data.pending.push(entry); // incoming
    else if (row.conn_status === 'pending' && row.requester_id === req.user.id) data.requested.push(entry); // outgoing
    else if (row.conn_status === 'blocked') data.blocked.push(entry);
  }
  res.json({ ok: true, data });
});

api.post('/connections', authMiddleware, (req, res) => {
  const code = sanitizeText(String(req.body?.code || ''), 32).toUpperCase();
  if (!code) return fail(res, 400, 'invalid_code', 'Enter a Sparkline code.');
  const target = db.prepare('SELECT * FROM users WHERE code = ?').get(code);
  if (!target || target.banned || isBlocked(req.user.id, target.id)) {
    return fail(res, 404, 'not_found', 'Sparkline code not found.');
  }
  if (target.id === req.user.id) return fail(res, 400, 'self', "That's your own code.");
  const rel = relationship(req.user.id, target.id);
  if (rel === 'accepted') return fail(res, 409, 'already_connected', 'You are already connected.');
  if (rel === 'pending') return fail(res, 409, 'already_pending', 'A connection request is already pending.');
  if (rel === 'blocked') return fail(res, 403, 'blocked', 'This connection is not possible.');
  const limit = rateLimiters.http.check(`conn:${req.user.id}`, config.rateConnectMax, config.rateConnectWindowMs);
  if (!limit.allowed) return fail(res, 429, 'rate_limited', 'Too many connection requests. Try again later.');
  const pendingIncoming = db.prepare("SELECT COUNT(*) AS c FROM connections WHERE recipient_id = ? AND status = 'pending'").get(target.id).c;
  if (pendingIncoming >= 50) return fail(res, 429, 'rate_limited', 'This user has many pending requests right now.');
  const id = uid(16);
  const nowMs = now();
  db.prepare('INSERT INTO connections (id, requester_id, recipient_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, req.user.id, target.id, 'pending', nowMs, nowMs);
  notifyConnectionRequest(req.user, target);
  logEvent('connection:request', req.user.id, { target: target.id });
  res.json({ ok: true, data: { connectionId: id } });
});

function loadConnection(req, connectionId) {
  const row = db.prepare('SELECT * FROM connections WHERE id = ? AND (requester_id = ? OR recipient_id = ?)').get(connectionId, req.user.id, req.user.id);
  return row;
}

api.post('/connections/:id/accept', authMiddleware, (req, res) => {
  const row = loadConnection(req, req.params.id);
  if (!row || row.status !== 'pending') return fail(res, 404, 'not_found', 'Connection request not found.');
  if (row.recipient_id !== req.user.id) return fail(res, 403, 'forbidden', 'Only the recipient can accept this request.');
  db.prepare('UPDATE connections SET status = ?, updated_at = ? WHERE id = ?').run('accepted', now(), row.id);
  const other = row.requester_id;
  const me = publicUser(req.user);
  const otherUser = db.prepare('SELECT * FROM users WHERE id = ?').get(other);
  const convId = uid(16);
  const nowMs = now();
  db.prepare("INSERT INTO conversations (id, type, title, created_at, updated_at) VALUES (?, 'dm', NULL, ?, ?)").run(convId, nowMs, nowMs);
  db.prepare('INSERT INTO conversation_members (conversation_id, user_id, role, joined_at, last_read_at, muted, archived) VALUES (?, ?, ?, ?, ?, 0, 0)')
    .run(convId, req.user.id, 'admin', nowMs, nowMs);
  db.prepare('INSERT INTO conversation_members (conversation_id, user_id, role, joined_at, last_read_at, muted, archived) VALUES (?, ?, ?, ?, ?, 0, 0)')
    .run(convId, other, 'member', nowMs, nowMs);
  rt.emitToUser(other, 'connection:accepted', {
    connectionId: row.id,
    user: publicUser(req.user),
    conversationId: convId,
    text: `${me.displayName} accepted your connection request.`,
  });
  logEvent('connection:accepted', req.user.id, { other });
  res.json({ ok: true, data: { connectionId: row.id, conversationId: convId } });
});

api.post('/connections/:id/decline', authMiddleware, (req, res) => {
  const row = loadConnection(req, req.params.id);
  if (!row || row.status !== 'pending') return fail(res, 404, 'not_found', 'Connection request not found.');
  if (row.recipient_id !== req.user.id) return fail(res, 403, 'forbidden', 'Only the recipient can decline this request.');
  db.prepare('UPDATE connections SET status = ?, updated_at = ? WHERE id = ?').run('declined', now(), row.id);
  rt.emitToUser(row.requester_id, 'connection:declined', { connectionId: row.id, userId: req.user.id });
  res.json({ ok: true, data: { declined: true } });
});

api.post('/connections/:id/cancel', authMiddleware, (req, res) => {
  const row = loadConnection(req, req.params.id);
  if (!row || row.status !== 'pending' || row.requester_id !== req.user.id) {
    return fail(res, 404, 'not_found', 'Pending request not found.');
  }
  db.prepare('DELETE FROM connections WHERE id = ?').run(row.id);
  res.json({ ok: true, data: { canceled: true } });
});

api.post('/connections/:id/remove', authMiddleware, (req, res) => {
  let row = loadConnection(req, req.params.id);
  if (!row) {
    // allow removal via user id pairs
    const userId = sanitizeText(String(req.body?.userId), 64);
    row = db.prepare(
      `SELECT * FROM connections WHERE status = 'accepted' AND ((requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?))`
    ).get(req.user.id, userId, userId, req.user.id);
  }
  if (!row || row.status !== 'accepted') return fail(res, 404, 'not_found', 'Connection not found.');
  const other = row.requester_id === req.user.id ? row.recipient_id : row.requester_id;
  const convs = db.prepare(
    `SELECT m.conversation_id FROM conversation_members m
     WHERE m.user_id = ? AND m.conversation_id IN (
       SELECT conversation_id FROM conversation_members WHERE user_id = ?
     ) AND m.conversation_id IN (SELECT id FROM conversations WHERE type = 'dm')`
  ).all(req.user.id, other);
  for (const c of convs) {
    db.prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?').run(c.conversation_id, req.user.id);
    db.prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?').run(c.conversation_id, other);
    db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now(), c.conversation_id);
  }
  db.prepare('DELETE FROM connections WHERE id = ?').run(row.id);
  rt.emitToUser(other, 'connection:removed', { userId: req.user.id });
  res.json({ ok: true, data: { removed: true } });
});

api.post('/connections/:id/block', authMiddleware, (req, res) => {
  const userId = sanitizeText(String(req.body?.userId), 64) || req.params.id;
  let row = db.prepare(
    `SELECT * FROM connections WHERE ((requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?)) LIMIT 1`
  ).get(req.user.id, userId, userId, req.user.id);
  if (row && row.status === 'blocked') return res.json({ ok: true, data: { blocked: true } });
  if (row) {
    db.prepare('UPDATE connections SET status = ?, updated_at = ? WHERE id = ?').run('blocked', now(), row.id);
  } else {
    db.prepare('INSERT INTO connections (id, requester_id, recipient_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(uid(16), req.user.id, userId, 'blocked', now(), now());
  }
  const convs = db.prepare(
    `SELECT m.conversation_id FROM conversation_members m
     WHERE m.user_id = ? AND m.conversation_id IN (
       SELECT conversation_id FROM conversation_members WHERE user_id = ?
     ) AND m.conversation_id IN (SELECT id FROM conversations WHERE type = 'dm')`
  ).all(req.user.id, userId);
  for (const c of convs) {
    db.prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?').run(c.conversation_id, req.user.id);
    db.prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?').run(c.conversation_id, userId);
  }
  rt.emitToUser(userId, 'connection:blocked', { userId: req.user.id });
  logEvent('user:block', req.user.id, { target: userId });
  res.json({ ok: true, data: { blocked: true } });
});

api.post('/connections/:id/unblock', authMiddleware, (req, res) => {
  const userId = sanitizeText(String(req.body?.userId), 64) || req.params.id;
  const row = db.prepare(
    `SELECT * FROM connections WHERE status = 'blocked' AND ((requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?)) LIMIT 1`
  ).get(req.user.id, userId, userId, req.user.id);
  if (row) db.prepare('DELETE FROM connections WHERE id = ?').run(row.id);
  res.json({ ok: true, data: { unblocked: true } });
});

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------
function conversationRow(row, viewerId, extra = {}) {
  if (!row) return null;
  const members = db.prepare(
    `SELECT u.id, u.display_name, u.avatar, u.status, u.code, cm.role, cm.joined_at, cm.last_read_at, cm.muted
     FROM conversation_members cm JOIN users u ON u.id = cm.user_id WHERE cm.conversation_id = ?`
  ).all(row.id).map((m) => ({
    id: m.id,
    displayName: m.display_name,
    avatar: m.avatar,
    status: m.status,
    code: m.code,
    role: m.role,
    joinedAt: m.joined_at,
    lastReadAt: m.last_read_at,
  }));
  const last = db.prepare(
    'SELECT id, sender_id, type, content, created_at, deleted_at FROM messages WHERE conversation_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1'
  ).get(row.id);
  let unread = 0;
  if (row.last_read_at && last && last.created_at > row.last_read_at && last.sender_id !== viewerId) {
    unread = db.prepare(
      'SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ? AND created_at > ? AND sender_id != ? AND deleted_at IS NULL'
    ).get(row.id, row.last_read_at, viewerId).c;
  }
  let peer = null;
  if (row.type === 'dm') {
    const other = members.find((m) => m.id !== viewerId);
    if (other) peer = { ...other, online: rt.isOnline(other.id), lastSeen: lastPresenceFor(other.id) };
  }
  return {
    id: row.id,
    type: row.type,
    title: row.type === 'saved' ? 'Saved Messages' : row.title,
    description: row.description,
    inviteCode: row.invite_code,
    avatar: row.avatar,
    disappearingMs: row.disappearing_ms,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    role: row.role,
    muted: !!row.muted,
    archived: !!row.archived,
    lastReadAt: row.last_read_at,
    members,
    peer,
    unread,
    lastMessage: last ? {
      id: last.id,
      senderId: last.sender_id,
      type: last.type,
      content: last.content,
      createdAt: last.created_at,
      deleted: !!last.deleted_at,
    } : null,
    ...extra,
  };
}

api.get('/conversations', authMiddleware, (req, res) => {
  const includeArchived = req.query.archived === '1';
  const rows = db.prepare(
    `SELECT c.*, cm.role, cm.last_read_at, cm.muted, cm.archived, cm.joined_at
     FROM conversations c JOIN conversation_members cm ON cm.conversation_id = c.id
     WHERE cm.user_id = ? ${includeArchived ? '' : "AND cm.archived = 0"}
     ORDER BY COALESCE((SELECT created_at FROM messages m WHERE m.conversation_id = c.id AND m.deleted_at IS NULL ORDER BY m.created_at DESC LIMIT 1), c.updated_at) DESC`
  ).all(req.user.id);
  res.json({ ok: true, data: rows.map((r) => conversationRow(r, req.user.id)) });
});

api.get('/conversations/:id', authMiddleware, (req, res) => {
  const row = conversationFor(req.user.id, req.params.id);
  if (!row) return fail(res, 404, 'not_found', 'Conversation not found.');
  if (row.archived) {
    db.prepare('UPDATE conversation_members SET archived = 0 WHERE conversation_id = ? AND user_id = ?').run(row.id, req.user.id);
    row.archived = 0;
  }
  const pinned = db.prepare('SELECT * FROM messages WHERE conversation_id = ? AND pinned = 1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 20')
    .all(req.params.id);
  res.json({
    ok: true,
    data: {
      conversation: conversationRow(row, req.user.id),
      pinned: pinned.map((m) => messageRow(m, req.user.id)),
    },
  });
});

api.post('/conversations', authMiddleware, (req, res) => {
  const userId = sanitizeText(String(req.body?.userId), 64);
  if (!userId) return fail(res, 400, 'invalid_user', 'Missing user.');
  if (userId === req.user.id) return fail(res, 400, 'self', 'You cannot chat with yourself. Use Saved Messages.');
  if (!isConnected(req.user.id, userId) && !relationship(req.user.id, userId)) {
    return fail(res, 403, 'forbidden', 'Connect with this person before chatting.');
  }
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!target || target.banned || isBlocked(req.user.id, userId)) {
    return fail(res, 404, 'not_found', 'User not found.');
  }
  const existing = db.prepare(
    `SELECT c.id FROM conversations c
     JOIN conversation_members a ON a.conversation_id = c.id AND a.user_id = ?
     JOIN conversation_members b ON b.conversation_id = c.id AND b.user_id = ?
     WHERE c.type = 'dm' LIMIT 1`
  ).get(req.user.id, userId);
  if (existing) {
    db.prepare('UPDATE conversation_members SET archived = 0 WHERE conversation_id = ? AND user_id = ?').run(existing.id, req.user.id);
    return res.json({ ok: true, data: { conversationId: existing.id, created: false } });
  }
  const convId = uid(16);
  const nowMs = now();
  db.prepare("INSERT INTO conversations (id, type, title, created_at, updated_at) VALUES (?, 'dm', NULL, ?, ?)").run(convId, nowMs, nowMs);
  db.prepare('INSERT INTO conversation_members (conversation_id, user_id, role, joined_at, last_read_at, muted, archived) VALUES (?, ?, ?, ?, ?, 0, 0)')
    .run(convId, req.user.id, 'admin', nowMs, nowMs);
  db.prepare('INSERT INTO conversation_members (conversation_id, user_id, role, joined_at, last_read_at, muted, archived) VALUES (?, ?, ?, ?, ?, 0, 0)')
    .run(convId, userId, 'member', nowMs, nowMs);
  rt.emitToUser(userId, 'conversation:new', { conversation: conversationRow(conversationFor(userId, convId), userId) });
  res.json({ ok: true, data: { conversationId: convId, created: true } });
});

api.patch('/conversations/:id', authMiddleware, (req, res) => {
  const row = conversationFor(req.user.id, req.params.id);
  if (!row) return fail(res, 404, 'not_found', 'Conversation not found.');
  const type = req.body?.type;
  if (type === 'disappearing') {
    const ms = Number(req.body?.ms) || 0;
    const allowed = [0, 5000, 60_000, 300_000, 3600_000, 86400_000];
    if (!allowed.includes(ms)) return fail(res, 400, 'invalid', 'Invalid disappearing interval.');
    db.prepare('UPDATE conversations SET disappearing_ms = ?, updated_at = ? WHERE id = ?').run(ms, now(), row.id);
  } else if (row.type === 'group' && row.role === 'admin') {
    if (req.body?.title !== undefined) {
      const title = sanitizeText(req.body.title, 120);
      if (!title) return fail(res, 400, 'invalid', 'Title cannot be empty.');
      db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?').run(title, now(), row.id);
    }
    if (req.body?.description !== undefined) {
      db.prepare('UPDATE conversations SET description = ?, updated_at = ? WHERE id = ?').run(sanitizeText(req.body.description, 500), now(), row.id);
    }
  }
  const fresh = db.prepare('SELECT * FROM conversations WHERE id = ?').get(row.id);
  rt.emitToConversation(row.id, 'conversation:update', { conversationId: row.id, conversation: conversationRow(fresh ? { ...fresh, ...db.prepare('SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(row.id, req.user.id) } : null, req.user.id) });
  const me = db.prepare('SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(row.id, req.user.id);
  res.json({ ok: true, data: { conversation: conversationRow({ ...fresh, ...me }, req.user.id) } });
});

api.post('/conversations/:id/archive', authMiddleware, (req, res) => {
  const row = conversationFor(req.user.id, req.params.id);
  if (!row) return fail(res, 404, 'not_found', 'Conversation not found.');
  db.prepare('UPDATE conversation_members SET archived = ? WHERE conversation_id = ? AND user_id = ?')
    .run(req.body?.archive === false ? 0 : 1, row.id, req.user.id);
  res.json({ ok: true, data: { archived: req.body?.archive === false ? false : true } });
});

api.post('/conversations/:id/mute', authMiddleware, (req, res) => {
  const row = conversationFor(req.user.id, req.params.id);
  if (!row) return fail(res, 404, 'not_found', 'Conversation not found.');
  db.prepare('UPDATE conversation_members SET muted = ? WHERE conversation_id = ? AND user_id = ?')
    .run(req.body?.muted ? 1 : 0, row.id, req.user.id);
  res.json({ ok: true, data: { muted: !!req.body?.muted } });
});

api.post('/conversations/:id/read', authMiddleware, (req, res) => {
  const row = conversationFor(req.user.id, req.params.id);
  if (!row) return fail(res, 404, 'not_found', 'Conversation not found.');
  const upTo = Number(req.body?.upTo) || now();
  db.prepare('UPDATE conversation_members SET last_read_at = ? WHERE conversation_id = ? AND user_id = ?')
    .run(upTo, row.id, req.user.id);
  rt.emitToConversation(row.id, 'message:read', { conversationId: row.id, userId: req.user.id, upTo });
  res.json({ ok: true, data: { upTo } });
});

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------
function buildMessagePayload(user, conversation, body) {
  const type = sanitizeText(body?.type, 16);
  const allowedTypes = ['text', 'image', 'video', 'audio', 'voice', 'file'];
  if (!allowedTypes.includes(type)) return { error: 'Unsupported message type.' };
  let content = '';
  let attachmentId = null;
  if (type === 'text') {
    content = sanitizeText(body?.content, 4000);
    if (!content) return { error: 'Message cannot be empty.' };
  } else {
    const attachment = body?.attachment;
    const file = attachment?.id ? db.prepare('SELECT * FROM files WHERE id = ?').get(attachment.id) : null;
    if (!file) return { error: 'Attachment is missing.' };
    if (file.owner_id !== user.id || file.conversation_id !== conversation.id) {
      return { error: 'Attachment does not belong to this conversation.' };
    }
    attachmentId = file.id;
    content = JSON.stringify({
      kind: 'attachment',
      fileId: file.id,
      name: file.name,
      mime: file.mime,
      size: file.size,
      caption: sanitizeText(String(attachment?.caption || ''), 2000),
      duration: Number(attachment?.duration) || 0,
      peaks: Array.isArray(attachment?.peaks) ? attachment.peaks.slice(0, 400).map(Number) : null,
    });
  }
  let replyTo = null;
  if (body?.replyTo) {
    const r = db.prepare('SELECT * FROM messages WHERE id = ?').get(sanitizeText(String(body.replyTo), 64));
    if (r && r.conversation_id === conversation.id && !r.deleted_at) replyTo = r.id;
  }
  return { type, content, replyTo, attachmentId };
}

function deliverMessage(conversation, msgRow) {
  const payload = messageRow(msgRow, msgRow.sender_id);
  rt.emitToConversation(conversation.id, 'message:new', payload);
  // delivered receipt to sender's other devices
  rt.emitToUser(msgRow.sender_id, 'message:delivered', { messageId: msgRow.id, conversationId: conversation.id });
  // notifications for other members (their own devices handle popup)
  const sender = db.prepare('SELECT display_name FROM users WHERE id = ?').get(msgRow.sender_id);
  for (const memberId of db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ?').all(conversation.id, msgRow.sender_id).map((r) => r.user_id)) {
    const member = db.prepare('SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(conversation.id, memberId);
    if (member?.muted) continue;
    db.prepare('INSERT INTO notifications (id, user_id, type, data, read, created_at) VALUES (?, ?, ?, ?, 0, ?)')
      .run(uid(16), memberId, 'message', JSON.stringify({
        conversationId: conversation.id,
        messageId: msgRow.id,
        text: conversation.type === 'group' ? `${sender?.display_name}: ${previewText(msgRow)}` : previewText(msgRow),
        conversationTitle: conversation.type === 'group' ? conversation.title : sender?.display_name,
      }), now());
  }
  return payload;
}

function previewText(msgRow) {
  if (msgRow.type === 'text') return msgRow.content.slice(0, 200);
  if (msgRow.type === 'image') return '📷 Photo';
  if (msgRow.type === 'video') return '🎥 Video';
  if (msgRow.type === 'voice') return '🎤 Voice message';
  if (msgRow.type === 'audio') return '🎵 Audio';
  if (msgRow.type === 'file') {
    const meta = safeJsonParse(msgRow.content) || {};
    return `📎 ${meta.name || 'File'}`;
  }
  return '';
}

api.get('/conversations/:id/messages', authMiddleware, (req, res) => {
  const row = conversationFor(req.user.id, req.params.id);
  if (!row) return fail(res, 404, 'not_found', 'Conversation not found.');
  const before = Number(req.query.before) || now() + 1;
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const rows = db.prepare(
    'SELECT * FROM messages WHERE conversation_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?'
  ).all(row.id, before, limit);
  const hasMore = rows.length === limit;
  res.json({
    ok: true,
    data: {
      messages: rows.reverse().map((m) => messageRow(m, req.user.id)),
      hasMore,
    },
  });
});

api.post('/conversations/:id/messages', authMiddleware, (req, res) => {
  const row = conversationFor(req.user.id, req.params.id);
  if (!row) return fail(res, 404, 'not_found', 'Conversation not found.');
  if (row.type !== 'saved') {
    for (const memberId of db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?').all(row.id).map((r) => r.user_id)) {
      if (isBlocked(req.user.id, memberId)) {
        return fail(res, 403, 'blocked', 'You cannot message this person.');
      }
    }
  }
  const limit = rateLimiters.http.check(`msg:${req.user.id}`, config.rateMsgMax, config.rateMsgWindowMs);
  if (!limit.allowed) return fail(res, 429, 'rate_limited', 'You are sending messages too quickly. Slow down.');
  const built = buildMessagePayload(req.user, row, req.body);
  if (built.error) return fail(res, 400, 'invalid_message', built.error);
  const id = uid(18);
  const nowMs = now();
  db.prepare(
    'INSERT INTO messages (id, conversation_id, sender_id, type, content, attachment_id, reply_to, edited, pinned, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, NULL)'
  ).run(id, row.id, req.user.id, built.type, built.content, built.attachmentId, built.replyTo, nowMs, nowMs);
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(nowMs, row.id);
  const msgRow = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
  const payload = deliverMessage(row, msgRow);
  if (row.type === 'dm') {
    const peer = db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ?').get(row.id, req.user.id);
    if (peer) rt.emitToUser(peer.user_id, 'conversation:update', { conversationId: row.id });
  }
  // update the sender's own conversation list
  rt.emitToUser(req.user.id, 'conversation:update', { conversationId: row.id });
  logEvent('message:send', req.user.id, { conversationId: row.id, type: built.type });
  res.json({ ok: true, data: { message: payload } });
});

api.patch('/messages/:id', authMiddleware, (req, res) => {
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
  if (!msg || msg.sender_id !== req.user.id || msg.deleted_at) return fail(res, 404, 'not_found', 'Message not found.');
  const row = conversationFor(req.user.id, msg.conversation_id);
  if (!row) return fail(res, 404, 'not_found', 'Conversation not found.');
  let content = sanitizeText(req.body?.content, 4000);
  if (!content || content.length > 4000 - 500) {
    const meta = safeJsonParse(msg.content);
    if (meta?.kind === 'attachment') {
      meta.caption = sanitizeText(String(req.body?.content || ''), 2000);
      content = JSON.stringify(meta);
    } else {
      return fail(res, 400, 'invalid_message', 'Message cannot be empty.');
    }
  }
  db.prepare('UPDATE messages SET content = ?, edited = 1, updated_at = ? WHERE id = ?').run(content, now(), msg.id);
  const fresh = db.prepare('SELECT * FROM messages WHERE id = ?').get(msg.id);
  rt.emitToConversation(msg.conversation_id, 'message:edit', { message: messageRow(fresh, req.user.id) });
  res.json({ ok: true, data: { message: messageRow(fresh, req.user.id) } });
});

api.delete('/messages/:id', authMiddleware, (req, res) => {
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
  if (!msg || msg.deleted_at) return fail(res, 404, 'not_found', 'Message not found.');
  const row = conversationFor(req.user.id, msg.conversation_id);
  if (!row) return fail(res, 404, 'not_found', 'Conversation not found.');
  const isAdmin = row.role === 'admin';
  if (msg.sender_id !== req.user.id && !isAdmin) return fail(res, 403, 'forbidden', 'You can only delete your own messages.');
  // allow edit window: delete after 7 days only for own messages
  if (!isAdmin && now() - msg.created_at > 7 * 86400_000) {
    return fail(res, 403, 'forbidden', 'Messages cannot be deleted after 7 days.');
  }
  db.prepare('UPDATE messages SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), msg.id);
  if (row.type === 'saved') {
    db.prepare('DELETE FROM saved_messages WHERE message_id = ?').run(msg.id);
  }
  rt.emitToConversation(msg.conversation_id, 'message:delete', { messageId: msg.id, conversationId: msg.conversation_id });
  res.json({ ok: true, data: { deleted: true } });
});

api.post('/messages/:id/reactions', authMiddleware, (req, res) => {
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
  if (!msg || msg.deleted_at) return fail(res, 404, 'not_found', 'Message not found.');
  const row = conversationFor(req.user.id, msg.conversation_id);
  if (!row) return fail(res, 404, 'not_found', 'Conversation not found.');
  if (row.type !== 'saved') {
    const memberIds = db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?').all(row.id).map((r) => r.user_id);
    if (!memberIds.includes(req.user.id)) return fail(res, 403, 'forbidden', 'Not a member.');
  }
  const emoji = sanitizeText(String(req.body?.emoji || req.body?.reaction || '👍'), 16);
  if (!emoji || [...emoji].length > 8) return fail(res, 400, 'invalid', 'Invalid reaction.');
  const existing = db.prepare('SELECT * FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?')
    .get(msg.id, req.user.id, emoji);
  if (existing) {
    db.prepare('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').run(msg.id, req.user.id, emoji);
  } else {
    db.prepare('INSERT INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)')
      .run(msg.id, req.user.id, emoji, now());
  }
  const fresh = db.prepare('SELECT * FROM messages WHERE id = ?').get(msg.id);
  rt.emitToConversation(msg.conversation_id, 'message:reaction', { message: messageRow(fresh, req.user.id) });
  res.json({ ok: true, data: { message: messageRow(fresh, req.user.id) } });
});

api.post('/messages/:id/pin', authMiddleware, (req, res) => {
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
  if (!msg || msg.deleted_at) return fail(res, 404, 'not_found', 'Message not found.');
  const row = conversationFor(req.user.id, msg.conversation_id);
  if (!row || row.type === 'saved') return fail(res, 404, 'not_found', 'Conversation not found.');
  if (req.body?.pin === false) {
    db.prepare('UPDATE messages SET pinned = 0 WHERE id = ?').run(msg.id);
  } else {
    const pinnedCount = db.prepare('SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ? AND pinned = 1').get(row.id).c;
    if (pinnedCount >= 20) return fail(res, 400, 'limit', 'Maximum 20 pinned messages per conversation.');
    db.prepare('UPDATE messages SET pinned = 1 WHERE id = ?').run(msg.id);
  }
  const fresh = db.prepare('SELECT * FROM messages WHERE id = ?').get(msg.id);
  rt.emitToConversation(msg.conversation_id, 'message:pin', { message: messageRow(fresh, req.user.id) });
  res.json({ ok: true, data: { message: messageRow(fresh, req.user.id) } });
});

api.get('/conversations/:id/pinned', authMiddleware, (req, res) => {
  const row = conversationFor(req.user.id, req.params.id);
  if (!row) return fail(res, 404, 'not_found', 'Conversation not found.');
  const rows = db.prepare('SELECT * FROM messages WHERE conversation_id = ? AND pinned = 1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 20')
    .all(row.id);
  res.json({ ok: true, data: { pinned: rows.map((m) => messageRow(m, req.user.id)) } });
});

// ---------------------------------------------------------------------------
// Saved messages
// ---------------------------------------------------------------------------
function savedConversationFor(userId) {
  return db.prepare("SELECT * FROM conversations WHERE type = 'saved' AND owner_id = ?").get(userId);
}

api.get('/saved', authMiddleware, (req, res) => {
  const conv = savedConversationFor(req.user.id);
  const rows = db.prepare(
    `SELECT m.* FROM saved_messages sm JOIN messages m ON m.id = sm.message_id
     WHERE sm.user_id = ? AND m.deleted_at IS NULL ORDER BY sm.created_at DESC LIMIT 200`
  ).all(req.user.id);
  res.json({ ok: true, data: { conversationId: conv?.id, messages: rows.map((m) => messageRow(m, req.user.id)) } });
});

api.post('/messages/:id/save', authMiddleware, (req, res) => {
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
  if (!msg || msg.deleted_at) return fail(res, 404, 'not_found', 'Message not found.');
  if (req.body?.save === false) {
    db.prepare('DELETE FROM saved_messages WHERE user_id = ? AND message_id = ?').run(req.user.id, msg.id);
    return res.json({ ok: true, data: { saved: false } });
  }
  db.prepare('INSERT OR IGNORE INTO saved_messages (user_id, message_id, created_at) VALUES (?, ?, ?)')
    .run(req.user.id, msg.id, now());
  res.json({ ok: true, data: { saved: true } });
});

api.post('/messages/:id/forward', authMiddleware, (req, res) => {
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
  if (!msg || msg.deleted_at) return fail(res, 404, 'not_found', 'Message not found.');
  const targetConvId = sanitizeText(String(req.body?.conversationId), 64);
  const target = conversationFor(req.user.id, targetConvId);
  if (!target) return fail(res, 404, 'not_found', 'Conversation not found.');
  const sourceConv = conversationFor(req.user.id, msg.conversation_id);
  if (!sourceConv && msg.sender_id !== req.user.id) return fail(res, 403, 'forbidden', 'No access to this message.');
  // text messages forward directly
  let type = msg.type;
  let content = msg.content;
  let attachmentId = null;
  if (msg.attachment_id) {
    const file = db.prepare('SELECT * FROM files WHERE id = ?').get(msg.attachment_id);
    if (!file) return fail(res, 404, 'not_found', 'Attachment no longer available.');
    // clone the file row into the target conversation so access rules hold
    const newId = uid(20);
    db.prepare('INSERT INTO files (id, owner_id, conversation_id, name, mime, size, stored_name, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(newId, req.user.id, target.id, file.name, file.mime, file.size, file.stored_name, file.sha256, now());
    attachmentId = newId;
  }
  if (msg.type === 'system') return fail(res, 400, 'invalid', 'System messages cannot be forwarded.');
  const id = uid(18);
  const nowMs = now();
  db.prepare(
    'INSERT INTO messages (id, conversation_id, sender_id, type, content, attachment_id, reply_to, edited, pinned, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, NULL, 0, 0, ?, ?, NULL)'
  ).run(id, target.id, req.user.id, type, content, attachmentId, nowMs, nowMs);
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(nowMs, target.id);
  const msgRow = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
  const payload = deliverMessage(target, msgRow);
  rt.emitToUser(req.user.id, 'conversation:update', { conversationId: target.id });
  res.json({ ok: true, data: { message: payload } });
});

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------
api.post('/groups', authMiddleware, (req, res) => {
  const title = sanitizeText(req.body?.title, 120);
  if (!title) return fail(res, 400, 'invalid_title', 'Group name is required.');
  const description = sanitizeText(req.body?.description, 500);
  const limit = rateLimiters.http.check(`groups:${req.user.id}`, 10, 3600_000);
  if (!limit.allowed) return fail(res, 429, 'rate_limited', 'Too many groups created. Try again later.');
  const convId = uid(16);
  const nowMs = now();
  let invite = groupInviteCode();
  while (db.prepare('SELECT 1 FROM conversations WHERE invite_code = ?').get(invite)) invite = groupInviteCode();
  db.prepare(
    "INSERT INTO conversations (id, type, owner_id, title, description, invite_code, created_at, updated_at) VALUES (?, 'group', ?, ?, ?, ?, ?, ?)"
  ).run(convId, req.user.id, title, description, invite, nowMs, nowMs);
  db.prepare('INSERT INTO conversation_members (conversation_id, user_id, role, joined_at, last_read_at, muted, archived) VALUES (?, ?, ?, ?, ?, 0, 0)')
    .run(convId, req.user.id, 'admin', nowMs, nowMs);
  logEvent('group:create', req.user.id, { conversationId: convId });
  res.json({ ok: true, data: { conversation: conversationRow(conversationFor(req.user.id, convId), req.user.id) } });
});

api.get('/conv-invites', authMiddleware, (req, res) => {
  const convId = sanitizeText(String(req.query.conversationId), 64);
  const row = conversationFor(req.user.id, convId);
  if (!row || row.type !== 'group') return fail(res, 404, 'not_found', 'Group not found.');
  res.json({ ok: true, data: { inviteCode: row.invite_code, url: `${config.publicUrl}/#/join/${row.invite_code}` } });
});

api.post('/groups/join', authMiddleware, (req, res) => {
  const code = sanitizeText(String(req.body?.code || ''), 32).toUpperCase();
  if (!code) return fail(res, 400, 'invalid', 'Enter a group invite code.');
  const conv = db.prepare('SELECT * FROM conversations WHERE invite_code = ?').get(code);
  if (!conv || conv.type !== 'group') return fail(res, 404, 'not_found', 'Group invite not found.');
  const existing = db.prepare('SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(conv.id, req.user.id);
  if (existing) return res.json({ ok: true, data: { conversation: conversationRow(conversationFor(req.user.id, conv.id), req.user.id), alreadyMember: true } });
  const limit = rateLimiters.http.check(`join:${req.user.id}`, 10, 600_000);
  if (!limit.allowed) return fail(res, 429, 'rate_limited', 'Too many group joins. Try again later.');
  const nowMs = now();
  db.prepare('INSERT INTO conversation_members (conversation_id, user_id, role, joined_at, last_read_at, muted, archived) VALUES (?, ?, ?, ?, ?, 0, 0)')
    .run(conv.id, req.user.id, 'member', nowMs, nowMs);
  const memberNames = db.prepare(
    'SELECT COUNT(*) AS c FROM conversation_members WHERE conversation_id = ?'
  ).get(conv.id).c;
  const sysId = uid(18);
  db.prepare('INSERT INTO messages (id, conversation_id, sender_id, type, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(sysId, conv.id, req.user.id, 'system', `${req.user.display_name} joined the group`, nowMs, nowMs);
  rt.emitToConversation(conv.id, 'message:new', messageRow(db.prepare('SELECT * FROM messages WHERE id = ?').get(sysId), req.user.id));
  rt.emitToConversation(conv.id, 'conversation:update', { conversationId: conv.id, memberCount: memberNames });
  rt.emitToUser(req.user.id, 'conversation:new', { conversation: conversationRow(conversationFor(req.user.id, conv.id), req.user.id) });
  logEvent('group:join', req.user.id, { conversationId: conv.id });
  res.json({ ok: true, data: { conversation: conversationRow(conversationFor(req.user.id, conv.id), req.user.id), alreadyMember: false } });
});

api.post('/conversations/:id/members', authMiddleware, (req, res) => {
  const row = conversationFor(req.user.id, req.params.id);
  if (!row || row.type !== 'group') return fail(res, 404, 'not_found', 'Group not found.');
  if (row.role !== 'admin') return fail(res, 403, 'forbidden', 'Only group admins can add members.');
  const userId = sanitizeText(String(req.body?.userId), 64);
  const target = userId ? db.prepare('SELECT * FROM users WHERE id = ?').get(userId) : null;
  if (!target) return fail(res, 404, 'not_found', 'User not found.');
  if (isBlocked(req.user.id, target.id)) return fail(res, 403, 'blocked', 'Cannot add this user.');
  const exists = db.prepare('SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(row.id, target.id);
  if (exists) return res.json({ ok: true, data: { alreadyMember: true } });
  const nowMs = now();
  db.prepare('INSERT INTO conversation_members (conversation_id, user_id, role, joined_at, last_read_at, muted, archived) VALUES (?, ?, ?, ?, ?, 0, 0)')
    .run(row.id, target.id, 'member', nowMs, nowMs);
  const sysId = uid(18);
  db.prepare('INSERT INTO messages (id, conversation_id, sender_id, type, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(sysId, row.id, req.user.id, 'system', `${req.user.display_name} added ${target.display_name}`, nowMs, nowMs);
  rt.emitToConversation(row.id, 'message:new', messageRow(db.prepare('SELECT * FROM messages WHERE id = ?').get(sysId), req.user.id));
  rt.emitToUser(target.id, 'conversation:new', { conversation: conversationRow(conversationFor(target.id, row.id), target.id) });
  res.json({ ok: true, data: { added: true } });
});

api.delete('/conversations/:id/members/:userId', authMiddleware, (req, res) => {
  const row = conversationFor(req.user.id, req.params.id);
  if (!row || row.type !== 'group') return fail(res, 404, 'not_found', 'Group not found.');
  if (row.role !== 'admin') return fail(res, 403, 'forbidden', 'Only group admins can remove members.');
  if (req.params.userId === req.user.id) return fail(res, 400, 'invalid', 'Use leave to exit the group.');
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.userId);
  db.prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?').run(row.id, req.params.userId);
  const sysId = uid(18);
  const nowMs = now();
  db.prepare('INSERT INTO messages (id, conversation_id, sender_id, type, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(sysId, row.id, req.user.id, 'system', `${target?.display_name || 'A member'} was removed`, nowMs, nowMs);
  rt.emitToConversation(row.id, 'message:new', messageRow(db.prepare('SELECT * FROM messages WHERE id = ?').get(sysId), req.user.id));
  rt.emitToUser(req.params.userId, 'group:removed', { conversationId: row.id });
  res.json({ ok: true, data: { removed: true } });
});

api.post('/conversations/:id/leave', authMiddleware, (req, res) => {
  const row = conversationFor(req.user.id, req.params.id);
  if (!row || row.type !== 'group') return fail(res, 404, 'not_found', 'Group not found.');
  db.prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?').run(row.id, req.user.id);
  const remaining = db.prepare('SELECT COUNT(*) AS c FROM conversation_members WHERE conversation_id = ?').get(row.id).c;
  let sysMessage;
  if (remaining > 0) {
    const sysId = uid(18);
    const nowMs = now();
    db.prepare('INSERT INTO messages (id, conversation_id, sender_id, type, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(sysId, row.id, req.user.id, 'system', `${req.user.display_name} left the group`, nowMs, nowMs);
    sysMessage = messageRow(db.prepare('SELECT * FROM messages WHERE id = ?').get(sysId), req.user.id);
    rt.emitToConversation(row.id, 'message:new', sysMessage);
    const admins = db.prepare("SELECT user_id FROM conversation_members WHERE conversation_id = ? AND role = 'admin'").all(row.id);
    if (admins.length === 0) {
      const next = db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ? ORDER BY joined_at LIMIT 1').get(row.id);
      if (next) db.prepare("UPDATE conversation_members SET role = 'admin' WHERE conversation_id = ? AND user_id = ?").run(row.id, next.user_id);
    }
  } else {
    db.prepare('DELETE FROM conversations WHERE id = ?').run(row.id);
  }
  res.json({ ok: true, data: { left: true } });
});

api.post('/conversations/:id/members/:userId/promote', authMiddleware, (req, res) => {
  const row = conversationFor(req.user.id, req.params.id);
  if (!row || row.type !== 'group') return fail(res, 404, 'not_found', 'Group not found.');
  if (row.role !== 'admin') return fail(res, 403, 'forbidden', 'Only group admins can promote members.');
  const target = db.prepare('SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(row.id, req.params.userId);
  if (!target) return fail(res, 404, 'not_found', 'Member not found.');
  db.prepare("UPDATE conversation_members SET role = ? WHERE conversation_id = ? AND user_id = ?")
    .run(target.role === 'admin' ? 'member' : 'admin', row.id, req.params.userId);
  res.json({ ok: true, data: { role: target.role === 'admin' ? 'member' : 'admin' } });
});

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------
api.post('/files', authMiddleware, upload.single('file'), (req, res) => {
  const convId = sanitizeText(String(req.body?.conversationId || ''), 64);
  const conversation = conversationFor(req.user.id, convId);
  if (!req.file || !conversation) {
    if (req.file) fs.unlinkSync(req.file.path);
    return fail(res, 400, 'invalid_upload', 'Missing file or conversation.');
  }
  const buf = fs.readFileSync(req.file.path);
  const sniffed = sniff(buf.subarray(0, 16));
  const ext = (req.file.originalname.split('.').pop() || '').toLowerCase();
  const safeExts = SAFE_EXT_BY_MIME[req.file.mimetype] || [];
  const isImage = IMAGE_EXTS.includes(ext);
  const isVideo = VIDEO_EXTS.includes(ext);
  const isAudio = AUDIO_EXTS.includes(ext);
  let maxSize = LIMITS.doc;
  let kind = 'doc';
  if (isImage) { maxSize = LIMITS.image; kind = 'image'; }
  else if (isVideo) { maxSize = LIMITS.video; kind = 'video'; }
  else if (isAudio) { maxSize = LIMITS.audio; kind = 'audio'; }
  if (req.file.size > maxSize) {
    fs.unlinkSync(req.file.path);
    return fail(res, 413, 'too_large', 'File exceeds the allowed size.');
  }
  if (isImage && ext !== 'avif' && !sniffed) {
    fs.unlinkSync(req.file.path);
    return fail(res, 400, 'invalid_file', 'Unsupported or corrupted image.');
  }
  if (!isImage && !isVideo && !isAudio && !safeExts.includes(ext)) {
    fs.unlinkSync(req.file.path);
    return fail(res, 400, 'invalid_file', 'This file type is not allowed.');
  }
  const storedName = `${uid(24)}${ext ? '.' + ext : ''}`;
  fs.renameSync(req.file.path, path.join(config.uploadDir, storedName));
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const id = uid(20);
  db.prepare(
    'INSERT INTO files (id, owner_id, conversation_id, name, mime, size, stored_name, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, req.user.id, conversation.id, (req.file.originalname || 'file').slice(0, 200), req.file.mimetype || contentTypeOf(req.file.originalname), req.file.size, storedName, sha256, now());
  logEvent('file:upload', req.user.id, { conversationId: conversation.id, kind, size: req.file.size });
  res.json({
    ok: true,
    data: {
      id, name: (req.file.originalname || 'file').slice(0, 200), mime: req.file.mimetype, size: req.file.size,
      url: `/api/files/${id}`,
    },
  });
});

function fileAccessAllowed(req, fileRow) {
  const token = sessionTokenFromRequest(req);
  const resolved = token ? resolveToken(token) : null;
  const userId = resolved?.scope === 'user' ? resolved.user.id : req.user?.id || null;
  if (!userId) return null;
  if (fileRow.owner_id === userId) return true;
  const member = db.prepare('SELECT 1 AS x FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(fileRow.conversation_id, userId);
  return member ? true : false;
}

api.get('/files/:id', (req, res) => {
  const fileRow = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id);
  if (!fileRow) return fail(res, 404, 'not_found', 'File not found.');
  const resolved = fileAccessAllowed(req, fileRow);
  if (resolved === null) {
    // no valid session at all -> send logged-out users to the app (they may be able to sign in)
    const hasToken = (req.headers.authorization || req.cookies?.spk_s || req.query.t) ? true : false;
    if (!hasToken) return res.redirect('/');
    return fail(res, 401, 'unauthorized', 'Please sign in to view this file.');
  }
  if (resolved !== true) return fail(res, 403, 'forbidden', 'No access.');
  const full = path.join(config.uploadDir, fileRow.stored_name);
  if (!fs.existsSync(full)) return fail(res, 404, 'not_found', 'File missing on server.');
  const previewTypes = /^image\//.test(fileRow.mime) || /^video\//.test(fileRow.mime) || /^audio\//.test(fileRow.mime) || fileRow.mime === 'application/pdf';
  res.setHeader('Content-Type', fileRow.mime || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.setHeader('Content-Disposition', previewTypes ? 'inline' : `attachment; filename*=UTF-8''${encodeURIComponent(fileRow.name)}`);
  fs.createReadStream(full).pipe(res);
});

api.get('/files/avatar/:name', (req, res) => {
  const name = path.basename(req.params.name);
  const full = path.join(config.uploadDir, 'avatars', name);
  if (!fs.existsSync(full)) return res.status(404).end();
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  fs.createReadStream(full).pipe(res);
});

// ---------------------------------------------------------------------------
// Calls (REST)
// ---------------------------------------------------------------------------
api.get('/calls', authMiddleware, (req, res) => {
  const rows = db.prepare(
    `SELECT * FROM calls WHERE conversation_id IN (
       SELECT conversation_id FROM conversation_members WHERE user_id = ?
     ) ORDER BY started_at DESC LIMIT 100`
  ).all(req.user.id);
  const convNames = new Map();
  for (const row of rows) {
    if (!convNames.has(row.conversation_id)) {
      const c = db.prepare('SELECT * FROM conversations WHERE id = ?').get(row.conversation_id);
      let label = c?.title;
      if (c?.type === 'dm') {
        const peer = db.prepare(
          'SELECT u.id, u.display_name, u.avatar, u.code FROM conversation_members cm JOIN users u ON u.id = cm.user_id WHERE cm.conversation_id = ? AND cm.user_id != ? LIMIT 1'
        ).get(row.conversation_id, req.user.id);
        label = peer?.display_name;
      }
      convNames.set(row.conversation_id, { label, type: c?.type });
    }
  }
  res.json({
    ok: true,
    data: rows.map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      callerId: row.caller_id,
      callType: row.call_type,
      status: row.status,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      outcome: row.outcome,
      missedByMe: row.caller_id !== req.user.id && row.status === 'ended' && !row.ended_at,
      peer: convNames.get(row.conversation_id),
    })),
  });
});

api.post('/calls', authMiddleware, (req, res) => {
  const conversationId = sanitizeText(String(req.body?.conversationId), 64);
  const callType = sanitizeText(String(req.body?.callType), 16);
  if (!['audio', 'video'].includes(callType)) return fail(res, 400, 'invalid', 'Invalid call type.');
  const conv = conversationFor(req.user.id, conversationId);
  if (!conv) return fail(res, 404, 'not_found', 'Conversation not found.');
  if (conv.type !== 'dm' && conv.type !== 'group') return fail(res, 400, 'invalid', 'Calls are available in direct and group chats.');
  if (conv.type === 'group') {
    const count = db.prepare('SELECT COUNT(*) AS c FROM conversation_members WHERE conversation_id = ?').get(conv.id).c;
    if (count > MAX_MESH_PARTICIPANTS) {
      return fail(res, 400, 'call_size', `Group calls support up to ${MAX_MESH_PARTICIPANTS} participants.`);
    }
    if (count < 2) return fail(res, 400, 'call_size', 'Invite someone to the group first.');
  } else {
    const peer = db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ? LIMIT 1').get(conv.id, req.user.id);
    if (!peer) return fail(res, 400, 'call_size', conversationId.includes('saved') ? 'Calls are not available here.' : 'Connection no longer active.');
    if (isBlocked(req.user.id, peer.user_id)) return fail(res, 403, 'blocked', 'You cannot call this person.');
  }
  const active = activeOrRecentCallFor(conv.id);
  if (active && active.status === 'ringing') return fail(res, 409, 'call_active', 'A call is already in progress in this conversation.');
  const call = createCallEntry(req.user.id, conv.id, callType);
  const data = {
    call: {
      id: call.id,
      conversationId: call.conversation_id,
      callerId: call.caller_id,
      callType: call.call_type,
      status: call.status,
      startedAt: call.started_at,
      participants: db.prepare('SELECT user_id FROM call_participants WHERE call_id = ?').all(call.id).map((p) => ({ userId: p.user_id })),
    },
  };
  for (const memberId of db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ?').all(conv.id, req.user.id).map((r) => r.user_id)) {
    rt.emitToUser(memberId, 'call:incoming', data);
  }
  rt.emitToUser(req.user.id, 'call:outgoing', data);
  res.json({ ok: true, data });
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
api.get('/search', authMiddleware, (req, res) => {
  const q = sanitizeText(String(req.query.q || ''), 200).toLowerCase();
  if (!q || q.length < 2) return res.json({ ok: true, data: { users: [], messages: [], files: [] } });
  const limiter = rateLimiters.http.check(`search:${req.user.id}`, 30, 60_000);
  if (!limiter.allowed) return fail(res, 429, 'rate_limited', 'Searching too quickly. Try again in a moment.');
  const like = `%${q.replace(/[%_]/g, '\\$&')}%`;
  const users = db.prepare(
    `SELECT id, display_name, avatar, status, code FROM users
     WHERE (LOWER(display_name) LIKE ? ESCAPE '\\' OR LOWER(code) LIKE ? ESCAPE '\\')
     AND id != ? AND banned = 0 ORDER BY LOWER(display_name) LIMIT 10`
  ).all(like, like, req.user.id).map((u) => ({
    id: u.id, displayName: u.display_name, avatar: u.avatar, status: u.status, code: u.code,
    relationship: relationship(req.user.id, u.id),
    online: rt.isOnline(u.id),
    lastSeen: lastPresenceFor(u.id),
  }));
  const myConvs = db.prepare(
    'SELECT conversation_id FROM conversation_members WHERE user_id = ? AND archived = 0'
  ).all(req.user.id).map((r) => r.conversation_id);
  if (myConvs.length === 0) return res.json({ ok: true, data: { users, messages: [], files: [] } });
  const placeholders = myConvs.map(() => '?').join(',');
  const messages = db.prepare(
    `SELECT m.* FROM messages m WHERE m.conversation_id IN (${placeholders})
     AND m.deleted_at IS NULL AND m.type = 'text' AND LOWER(m.content) LIKE ? ESCAPE '\\'
     ORDER BY m.created_at DESC LIMIT 20`
  ).all(...myConvs, like).map((m) => messageRow(m, req.user.id));
  const files = db.prepare(
    `SELECT f.*, m.id AS message_id, m.created_at AS message_created FROM files f
     JOIN messages m ON m.attachment_id = f.id
     WHERE f.conversation_id IN (${placeholders}) AND m.deleted_at IS NULL AND LOWER(f.name) LIKE ? ESCAPE '\\'
     ORDER BY m.created_at DESC LIMIT 20`
  ).all(...myConvs, like).map((f) => ({
    id: f.id, name: f.name, mime: f.mime, size: f.size, url: `/api/files/${f.id}`,
    messageId: f.message_id, createdAt: f.message_created,
  }));
  res.json({ ok: true, data: { users, messages, files } });
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
function notificationsFor(userId, limit = 50) {
  return db.prepare(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(userId, limit).map((n) => ({ id: n.id, type: n.type, data: safeJsonParse(n.data, {}), read: !!n.read, createdAt: n.created_at }));
}

api.get('/notifications', authMiddleware, (req, res) => {
  res.json({ ok: true, data: { notifications: notificationsFor(req.user.id) } });
});

api.post('/notifications/read', authMiddleware, (req, res) => {
  const id = sanitizeText(String(req.body?.id || ''), 64);
  if (id) {
    db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND id = ?').run(req.user.id, id);
  } else {
    db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.user.id);
  }
  res.json({ ok: true, data: { read: true } });
});

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
api.post('/report', authMiddleware, (req, res) => {
  const targetType = sanitizeText(String(req.body?.targetType), 16);
  const targetId = sanitizeText(String(req.body?.targetId), 64);
  const reason = sanitizeText(String(req.body?.reason), 500);
  if (!['user', 'message', 'group'].includes(targetType) || !targetId || !reason) {
    return fail(res, 400, 'invalid', 'Missing report details.');
  }
  const limiter = rateLimiters.http.check(`report:${req.user.id}`, 20, 3600_000);
  if (!limiter.allowed) return fail(res, 429, 'rate_limited', 'Too many reports. Try again later.');
  db.prepare('INSERT INTO reports (id, reporter_id, target_type, target_id, reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(uid(16), req.user.id, targetType, targetId, reason, 'open', now());
  logEvent('report:create', req.user.id, { targetType, targetId });
  res.json({ ok: true, data: { reported: true } });
});

// ---------------------------------------------------------------------------
// QR
// ---------------------------------------------------------------------------
api.get('/qr', authMiddleware, (req, res) => {
  const text = sanitizeText(String(req.query.text || ''), 300);
  const code = sanitizeText(String(req.query.code || ''), 32).toUpperCase();
  const limiter = rateLimiters.http.check(`qr:${req.user.id}`, 60, 60_000);
  if (!limiter.allowed) return fail(res, 429, 'rate_limited', 'Too many QR requests.');
  let payload = text;
  if (!payload && code) payload = `${config.publicUrl}/#/connect/${code}`;
  if (!payload) return fail(res, 400, 'invalid', 'Missing QR payload.');
  QRCode.toDataURL(payload, {
    margin: 1,
    width: 480,
    color: { dark: '#101828', light: '#ffffff' },
  })
    .then((dataUrl) => res.json({ ok: true, data: { dataUrl } }))
    .catch(() => fail(res, 500, 'qr_failed', 'Could not generate QR code.'));
});

// ---------------------------------------------------------------------------
// Link previews
// ---------------------------------------------------------------------------
const PREVIEW_TTL = 3600_000;
const previewCache = new Map();

function isPrivateIp(host) {
  const parts = host.split('.').map(Number);
  if (parts.length === 4 && !parts.some(isNaN)) {
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 0 || parts[0] === 100) return true;
  }
  return false;
}

api.post('/link-preview', authMiddleware, async (req, res) => {
  let url = sanitizeText(String(req.body?.url || ''), 500);
  if (!/^https?:\/\//i.test(url)) return fail(res, 400, 'invalid_url', 'Only http(s) links are supported.');
  const limit = rateLimiters.http.check(`preview:${req.user.id}`, 20, 60_000);
  if (!limit.allowed) return fail(res, 429, 'rate_limited', 'Too many link previews.');
  const cached = previewCache.get(url);
  if (cached && now() - cached.t < PREVIEW_TTL) return res.json({ ok: true, data: cached });
  try {
    const u = new URL(url);
    if (isPrivateIp(u.hostname)) return fail(res, 400, 'invalid_url', 'This link cannot be previewed.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'SparklinePreview/1.0' },
      redirect: 'follow',
    });
    clearTimeout(timer);
    if (!response.ok) return res.json({ ok: true, data: null });
    if (!/text\/html/.test(response.headers.get('content-type') || '')) return res.json({ ok: true, data: null });
    const html = (await response.text()).slice(0, 300_000);
    const og = (name) => {
      const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']+)["']`, 'i'))
        || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${name}["']`, 'i'));
      return m ? m[1].replaceAll('&amp;', '&').slice(0, 500) : null;
    };
    const title = og('og:title') || (html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.slice(0, 200)) || u.hostname;
    const description = og('og:description') || og('description');
    const image = og('og:image') || og('twitter:image');
    const data = {
      url, host: u.hostname,
      title: sanitizeText(title, 200),
      description: sanitizeText(description, 400),
      image: isPrivateIp(new URL(image, u.origin).hostname) ? null : new URL(image, u.origin).toString(),
    };
    previewCache.set(url, data);
    res.json({ ok: true, data });
  } catch {
    res.json({ ok: true, data: null });
  }
});

// ---------------------------------------------------------------------------
// GIPHY (only when configured)
// ---------------------------------------------------------------------------
api.get('/giphy/search', authMiddleware, (req, res) => {
  if (!config.giphyApiKey) return fail(res, 404, 'not_configured', 'GIF search is not configured on this server.');
  const q = sanitizeText(String(req.query.q || ''), 100);
  if (!q) return fail(res, 400, 'invalid', 'Missing query.');
  const limit = rateLimiters.http.check(`giphy:${req.user.id}`, 30, 60_000);
  if (!limit.allowed) return fail(res, 429, 'rate_limited', 'Too many GIF searches.');
  fetch(`https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(config.giphyApiKey)}&q=${encodeURIComponent(q)}&limit=25&rating=g`)
    .then((r) => r.json())
    .then((json) => {
      const items = (json.data || []).map((g) => {
        const preview = g.images?.fixed_width || g.images?.preview_gif || {};
        const original = g.images?.original || {};
        return {
          id: g.id, url: original.url, title: g.title?.slice(0, 200),
          previewUrl: preview.url, previewWidth: preview.width, previewHeight: preview.height,
          width: original.width, height: original.height,
        };
      });
      res.json({ ok: true, data: { items } });
    })
    .catch(() => fail(res, 502, 'giphy_failed', 'GIF service unavailable.'));
});

// ---------------------------------------------------------------------------
// Public info
// ---------------------------------------------------------------------------
api.get('/public/config', (req, res) => {
  res.json({
    ok: true,
    data: {
      name: 'Sparkline',
      iceServers: config.iceServers.map((s) => ({ urls: s.urls, username: s.username, credential: s.credential })),
      stunUrls: config.stunUrls,
      giphyEnabled: !!config.giphyApiKey,
      groupCallLimit: MAX_MESH_PARTICIPANTS,
      publicUrl: config.publicUrl,
    },
  });
});

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
const admin = Router();
api.use('/admin', admin);

admin.post('/login', (req, res) => {
  if (!config.adminKey) return fail(res, 503, 'not_configured', 'Admin access is not configured on this server.');
  const key = String(req.body?.key || '');
  const a = Buffer.from(key);
  const b = Buffer.from(config.adminKey);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) return fail(res, 401, 'unauthorized', 'Invalid admin key.');
  res.json({ ok: true, data: { token: adminToken() } });
});

admin.get('/overview', adminMiddleware, (req, res) => {
  const users = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  const banned = db.prepare('SELECT COUNT(*) AS c FROM users WHERE banned = 1').get().c;
  const active24h = db.prepare('SELECT COUNT(DISTINCT user_id) AS c FROM sessions WHERE last_presence > ?').get(now() - 86400_000).c;
  const active30d = db.prepare('SELECT COUNT(DISTINCT user_id) AS c FROM sessions WHERE last_presence > ?').get(now() - 30 * 86400_000).c;
  const connections = db.prepare("SELECT COUNT(*) AS c FROM connections WHERE status = 'accepted'").get().c;
  const conversations = db.prepare('SELECT COUNT(*) AS c FROM conversations').get().c;
  const messages = db.prepare('SELECT COUNT(*) AS c FROM messages WHERE deleted_at IS NULL').get().c;
  const messages24h = db.prepare('SELECT COUNT(*) AS c FROM messages WHERE created_at > ?').get(now() - 86400_000).c;
  const calls = db.prepare('SELECT COUNT(*) AS c FROM calls').get().c;
  const callsToday = db.prepare('SELECT COUNT(*) AS c FROM calls WHERE started_at > ?').get(new Date().setHours(0, 0, 0, 0)).c;
  const avgCallDur = db.prepare("SELECT AVG(ended_at - started_at) AS a FROM calls WHERE status = 'ended' AND ended_at IS NOT NULL").get().a || 0;
  const files = db.prepare('SELECT COUNT(*) AS c, COALESCE(SUM(size), 0) AS bytes FROM files').get();
  const reportsOpen = db.prepare("SELECT COUNT(*) AS c FROM reports WHERE status = 'open'").get().c;
  let storageBytes = files.bytes;
  try {
    storageBytes += fs.readdirSync(config.uploadDir).reduce((acc, f) => acc + (fs.statSync(path.join(config.uploadDir, f)).size || 0), 0);
  } catch { /* ignore */ }
  res.json({
    ok: true,
    data: {
      users, banned, active24h, active30d, connections, conversations, messages, messages24h,
      calls, callsToday, avgCallDur, reportsOpen,
      files: files.c, storageBytes,
      online: rt.isOnline ? undefined : undefined,
      fs: {
        sqlitePath: config.dbPath, uploadDir: config.uploadDir,
      },
      featureFlags: {
        giphyEnabled: !!config.giphyApiKey,
        groupCallLimit: MAX_MESH_PARTICIPANTS,
        stunServers: config.stunUrls.length,
        turnConfigured: !!config.turnUrl,
      },
    },
  });
});

admin.get('/users', adminMiddleware, (req, res) => {
  const q = sanitizeText(String(req.query.q || ''), 100).toLowerCase();
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = 25;
  let where = '1=1';
  const params = [];
  if (q) {
    where = '(LOWER(display_name) LIKE ? ESCAPE \'\\\' OR LOWER(code) LIKE ? ESCAPE \'\\\' OR id LIKE ?)';
    const like = `%${q.replace(/[%_]/g, '\\$&')}%`;
    params.push(like, like, `%${q}%`);
  }
  const total = db.prepare(`SELECT COUNT(*) AS c FROM users WHERE ${where}`).get(...params).c;
  const rows = db.prepare(
    `SELECT u.*, (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id) AS sessions,
            (SELECT COUNT(*) FROM connections c WHERE (c.requester_id = u.id OR c.recipient_id = u.id) AND c.status = 'accepted') AS connections
     FROM users u WHERE ${where} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, pageSize, (page - 1) * pageSize).map((u) => ({
    id: u.id, code: u.code, displayName: u.display_name, avatar: u.avatar, status: u.status,
    createdAt: u.created_at, banned: !!u.banned, sessions: u.sessions, connections: u.connections, about: u.about,
  }));
  res.json({ ok: true, data: { users: rows, total, page, pageSize } });
});

admin.post('/users/:id/ban', adminMiddleware, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return fail(res, 404, 'not_found', 'User not found.');
  db.prepare('UPDATE users SET banned = ? WHERE id = ?').run(1, user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  db.prepare('DELETE FROM notifications WHERE user_id = ?').run(user.id);
  logEvent('user:ban', null, { target: user.id, by: 'admin' });
  res.json({ ok: true, data: { banned: true } });
});

admin.post('/users/:id/unban', adminMiddleware, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return fail(res, 404, 'not_found', 'User not found.');
  db.prepare('UPDATE users SET banned = 0 WHERE id = ?').run(user.id);
  logEvent('user:unban', null, { target: user.id, by: 'admin' });
  res.json({ ok: true, data: { banned: false } });
});

admin.get('/reports', adminMiddleware, (req, res) => {
  const status = sanitizeText(String(req.query.status || 'open'), 16);
  const rows = db.prepare(
    `SELECT r.*, u.display_name AS reporter_name FROM reports r JOIN users u ON u.id = r.reporter_id
     WHERE r.status = ? ORDER BY r.created_at DESC LIMIT 100`
  ).all(status);
  const enrich = rows.map((r) => {
    let target = null;
    if (r.target_type === 'user') {
      const t = db.prepare('SELECT id, display_name, code, avatar, banned FROM users WHERE id = ?').get(r.target_id);
      if (t) target = { id: t.id, displayName: t.display_name, code: t.code, avatar: t.avatar, banned: !!t.banned };
    } else if (r.target_type === 'group') {
      const t = db.prepare('SELECT * FROM conversations WHERE id = ?').get(r.target_id);
      if (t) target = { id: t.id, title: t.title, avatar: t.avatar };
    } else if (r.target_type === 'message') {
      const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(r.target_id);
      if (m) {
        const sender = db.prepare('SELECT display_name FROM users WHERE id = ?').get(m.sender_id);
        target = { id: m.id, content: m.content.slice(0, 500), type: m.type, createdAt: m.created_at, senderName: sender?.display_name };
      }
    }
    return { ...r, target };
  });
  res.json({ ok: true, data: { reports: enrich } });
});

admin.post('/reports/:id', adminMiddleware, (req, res) => {
  const status = sanitizeText(String(req.body?.status || ''), 16);
  if (!['resolved', 'dismissed'].includes(status)) return fail(res, 400, 'invalid', 'Invalid status.');
  db.prepare('UPDATE reports SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ?')
    .run(status, now(), 'admin', req.params.id);
  res.json({ ok: true, data: { status } });
});

admin.get('/events', adminMiddleware, (req, res) => {
  const days = Math.min(30, Math.max(1, Number(req.query.days) || 7));
  const since = now() - days * 86400_000;
  const rows = db.prepare(
    'SELECT event, COUNT(*) AS count FROM events_log WHERE created_at > ? GROUP BY event ORDER BY count DESC'
  ).all(since);
  const activity = db.prepare(
    `SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS day,
            COUNT(*) AS events,
            SUM(CASE WHEN event LIKE 'message:%' THEN 1 ELSE 0 END) AS messages,
            SUM(CASE WHEN event LIKE 'call:%' THEN 1 ELSE 0 END) AS calls,
            SUM(CASE WHEN event LIKE 'connection:%' THEN 1 ELSE 0 END) AS connections,
            COUNT(DISTINCT user_id) AS active_users
     FROM events_log WHERE created_at > ? GROUP BY day ORDER BY day`
  ).all(since);
  res.json({ ok: true, data: { events: rows, activity } });
});

admin.get('/health', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ ok: true, data: { status: 'ok', uptime: process.uptime(), memory: process.memoryUsage().rss, now: now() } });
  } catch (e) {
    res.status(500).json({ ok: false, error: { code: 'db_error', message: 'Database unreachable.' } });
  }
});

api.get('/health', (req, res) => res.json({ ok: true, data: { status: 'ok', now: now() } }));