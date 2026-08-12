import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import { config, log } from './config.js';
import { db, logEvent } from './db.js';
import { initRealtime } from './realtime.js';
import { api } from './routes.js';
import { ipKey, rateLimiters } from './util.js';
import { resolveToken, setSessionCookie } from './auth.js';

if (!config.adminKey) {
  config.adminKey = `sk_${crypto.randomBytes(24).toString('base64url')}`;
  log.warn(`ADMIN_KEY not set — generated a random one for this boot: ${config.adminKey}`);
  log.warn('Set ADMIN_KEY in your environment to make admin access stable.');
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// --- tiny cookie parser (avoid dependency) ---
app.use((req, res, next) => {
  const header = req.headers.cookie || '';
  const cookies = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > -1) {
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      if (k) cookies[k] = decodeURIComponent(v);
    }
  }
  req.cookies = cookies;
  next();
});

// --- security headers ---
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  // NOTE: script-src allows the inline theme script in index.html by sha256 hash.
  // If that script changes, recompute: crypto.createHash('sha256').update(script).digest('base64')
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'sha256-47FkrlgbBubic8e5tW9afmH05tKrQj+URhCZUxKGfdA='; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob: data: https:; connect-src 'self' ws: wss: https: http://localhost:*; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
  next();
});

// --- JSON body ---
app.use(express.json({ limit: '1mb' }));

// --- global rate limit per IP ---
app.use((req, res, next) => {
  if (req.path.startsWith('/api/admin') && req.path !== '/api/admin/login') return next();
  const limit = rateLimiters.http.check(`ip:${ipKey(req)}`, 600, 60_000);
  if (!limit.allowed) return res.status(429).json({ ok: false, error: { code: 'rate_limited', message: 'Too many requests. Please slow down.' } });
  next();
});

// --- optional auth hydration ---
app.use((req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : (req.cookies?.spk_s || null);
  const resolved = token ? resolveToken(token) : null;
  if (resolved?.scope === 'user') {
    req.user = resolved.user;
    req.session = resolved.session;
  }
  next();
});

app.use('/api', api);

// --- analytics collector (privacy-conscious aggregate events) ---
app.post('/api/analytics', (req, res) => {
  const event = String(req.body?.event || '').slice(0, 80);
  if (!event) return res.json({ ok: true });
  const data = req.body?.data && typeof req.body.data === 'object' ? JSON.stringify(req.body.data).slice(0, 500) : '{}';
  const userId = req.user?.id || null;
  const limit = rateLimiters.http.check(`analytics:${ipKey(req)}`, 120, 60_000);
  if (!limit.allowed) return res.status(429).json({ ok: true });
  logEvent(event, userId, { ...(userId ? {} : {}), ...safeData(req.body?.data) });
  res.json({ ok: true });
});

function safeData(data) {
  if (!data || typeof data !== 'object') return {};
  const pick = {};
  for (const k of ['page', 'action', 'durationMs', 'outcome', 'quality']) {
    if (data[k] !== undefined) pick[k] = data[k];
  }
  return pick;
}

// --- media/avatars are served by /api routes; static client ---
if (config.serveClient) {
  log.info(`serving client build from ${config.clientDir}`);
  // service worker must never be cached, or redeploys break the shell
  app.use('/sw.js', (req, res, next) => {
    res.set('cache-control', 'no-store, max-age=0');
    next();
  });
  app.use(express.static(config.clientDir, { index: false, maxAge: '1h', etag: true }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/files')) return next();
    res.sendFile(path.join(config.clientDir, 'index.html'));
  });
} else {
  log.warn(`no client build found at ${config.clientDir} — API only. Run the client build (npm run build --prefix client) to serve the app from this server.`);
}

// --- error handling ---
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      ok: false,
      error: { code: 'upload_failed', message: err.code === 'LIMIT_FILE_SIZE' ? 'File exceeds the allowed size.' : 'Upload failed. Try again.' },
    });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ ok: false, error: { code: 'payload_too_large', message: 'Request too large.' } });
  }
  log.error('unhandled error', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ ok: false, error: { code: 'internal', message: 'Something went wrong. Please try again.' } });
});

const server = http.createServer(app);
initRealtime(server);

server.listen(config.port, config.host, () => {
  log.info(`Sparkline server listening on http://${config.host}:${config.port}`);
  log.info(`public url: ${config.publicUrl}`);
  log.info(`admin: ${config.adminKey ? 'enabled' : 'disabled'}${config.adminKey ? '' : ''}`);
  if (!config.turnUrl) {
    log.warn('TURN server not configured — calls may fail between strict NATs. See .env.example.');
  }
});

// Graceful shutdown
function shutdown() {
  log.info('shutting down...');
  server.close(() => {
    try { db.close(); } catch { /* ignore */ }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export default app;