import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function env(key, fallback) {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  if (typeof fallback === 'number') {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return v;
}

const PORT = env('PORT', 3000);
const PUBLIC_URL = env('PUBLIC_URL', `http://localhost:${PORT}`);
const UPLOAD_DIR = path.resolve(__dirname, env('UPLOAD_DIR', '../data/uploads'));
const DATA_DIR = path.dirname(UPLOAD_DIR);
const DB_PATH = path.resolve(__dirname, env('DB_PATH', '../data/sparkline.db'));
const CLIENT_DIR = path.resolve(__dirname, env('CLIENT_DIR', '../client/dist'));

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const config = {
  isProd: process.env.NODE_ENV === 'production',
  port: PORT,
  host: env('HOST', '0.0.0.0'),
  publicUrl: PUBLIC_URL.replace(/\/+$/, ''),
  uploadDir: UPLOAD_DIR,
  dbPath: DB_PATH,
  clientDir: CLIENT_DIR,
  serveClient: fs.existsSync(CLIENT_DIR) && fs.existsSync(path.join(CLIENT_DIR, 'index.html')),
  sessionTtlDays: env('SESSION_TTL_DAYS', 90),
  adminKey: env('ADMIN_KEY', null),
  stunUrls: env('STUN_URLS', 'stun:stun.l.google.com:19302').split(',').map((s) => s.trim()).filter(Boolean),
  turnUrl: env('TURN_URL', null),
  turnUsername: env('TURN_USERNAME', null),
  turnCredential: env('TURN_CREDENTIAL', null),
  giphyApiKey: env('GIPHY_API_KEY', null),
  rateMsgMax: env('RATE_MSG_MAX', 30),
  rateMsgWindowMs: env('RATE_MSG_WINDOW', 10000),
  rateConnectMax: env('RATE_CONNECT_MAX', 10),
  rateConnectWindowMs: env('RATE_CONNECT_WINDOW', 3600000),
  maxUploadImage: env('MAX_UPLOAD_IMAGE', 15 * 1024 * 1024),
  maxUploadVideo: env('MAX_UPLOAD_VIDEO', 200 * 1024 * 1024),
  maxUploadAudio: env('MAX_UPLOAD_AUDIO', 25 * 1024 * 1024),
  maxUploadDoc: env('MAX_UPLOAD_DOC', 100 * 1024 * 1024),
  iceServers: [],
  logLevel: env('LOG_LEVEL', 'info'),
};

if (config.turnUrl) {
  config.iceServers.push({
    urls: config.turnUrl,
    username: config.turnUsername || undefined,
    credential: config.turnCredential || undefined,
  });
}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const level = LEVELS[config.logLevel] ?? 20;

function ts() {
  return new Date().toISOString();
}

export const log = {
  debug(...a) { if (level <= 10) console.debug(ts(), '[debug]', ...a); },
  info(...a) { if (level <= 20) console.log(ts(), '[info] ', ...a); },
  warn(...a) { if (level <= 30) console.warn(ts(), '[warn] ', ...a); },
  error(...a) { if (level <= 40) console.error(ts(), '[error]', ...a); },
};