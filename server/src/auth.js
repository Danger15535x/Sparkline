import { db } from './db.js';
import { config, log } from './config.js';
import { sha256hex, newSessionToken, now, hmacSign, hmacVerify, uid } from './util.js';

const SESSION_TTL_MS = config.sessionTtlDays * 24 * 60 * 60 * 1000;

export function createSession(userId, device) {
  const token = newSessionToken();
  const id = uid(16);
  db.prepare(
    'INSERT INTO sessions (id, user_id, token_hash, device, created_at, last_seen_at, last_presence) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, userId, sha256hex(token), device || null, now(), now(), now());
  return { token, sessionId: id };
}

// Non-httpOnly cookie so media <img>/<video> requests carry the session.
export function setSessionCookie(res, token) {
  res.cookie('spk_s', token, {
    path: '/',
    maxAge: config.sessionTtlDays * 24 * 60 * 60 * 1000,
    sameSite: 'lax',
    httpOnly: false,
    secure: config.isProd && config.publicUrl.startsWith('https://'),
  });
}

export function sessionTokenFromRequest(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  return req.cookies?.spk_s || req.query?.t || null;
}

export function deleteSession(sessionId) {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function deleteAllSessions(userId, exceptId) {
  if (exceptId) {
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(userId, exceptId);
  } else {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }
}

function loadSession(tokenHash) {
  return db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(tokenHash) || null;
}

export function touchSession(sessionRow) {
  db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(now(), sessionRow.id);
}

// Resolves an Authorization bearer token (user or admin).
export function resolveToken(token) {
  if (!token) return null;
  if (token.startsWith('spk_')) {
    const session = loadSession(sha256hex(token));
    if (!session) return null;
    if (now() - session.created_at > SESSION_TTL_MS) {
      deleteSession(session.id);
      return null;
    }
    touchSession(session);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
    if (!user || user.banned) return null;
    return { scope: 'user', user, session };
  }
  // spkx_ admin token: HMAC-signed payload {sub:'admin', exp}
  if (token.startsWith('spkx_')) {
    const [payload, sig] = token.slice(5).split('.');
    if (!payload || !sig) return null;
    if (!config.adminKey) return null;
    if (!hmacVerify(payload, sig, config.adminKey)) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (data.sub !== 'admin' || data.exp < now()) return null;
    return { scope: 'admin', user: null, session: null };
  }
  return null;
}

export function adminToken() {
  if (!config.adminKey) return null;
  const payload = Buffer.from(
    JSON.stringify({ sub: 'admin', exp: now() + 12 * 60 * 60 * 1000 })
  ).toString('base64url');
  return `spkx_${payload}.${hmacSign(payload, config.adminKey)}`;
}

export function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const resolved = resolveToken(token);
  if (!resolved || resolved.scope !== 'user') {
    return res.status(401).json({ ok: false, error: { code: 'unauthorized', message: 'Session invalid or expired.' } });
  }
  if (resolved.user.banned) {
    return res.status(403).json({ ok: false, error: { code: 'banned', message: 'This account has been suspended.' } });
  }
  req.user = resolved.user;
  req.session = resolved.session;
  next();
}

export function adminMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const resolved = resolveToken(token);
  if (!resolved || resolved.scope !== 'admin') {
    return res.status(401).json({ ok: false, error: { code: 'unauthorized', message: 'Admin access required.' } });
  }
  req.admin = true;
  next();
}

export { log };
export function touchPresence(sessionId, userId) {
  db.prepare('UPDATE sessions SET last_presence = ? WHERE id = ?').run(now(), sessionId);
  db.prepare('UPDATE users SET updated_at = ? WHERE id = ?').run(now(), userId);
}