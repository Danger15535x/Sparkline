import crypto from 'node:crypto';

export const now = () => Date.now();

export function uid(len = 13) {
  // URL-safe random id (no padding)
  return crypto.randomBytes(Math.ceil((len * 6) / 8)).toString('base64url').slice(0, len);
}

// Sparkline code alphabet without ambiguous characters (0/O, 1/I/L)
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function randomCode(len) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

export function sparklineCode() {
  return `SPK-${randomCode(6)}`;
}

export function groupInviteCode() {
  return `SPK-GROUP-${randomCode(4)}`;
}

export function sha256hex(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

export function newSessionToken() {
  return `spk_${crypto.randomBytes(32).toString('base64url')}`;
}

export function hmacSign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

export function hmacVerify(payload, sig, secret) {
  const expected = hmacSign(payload, secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(sig || '');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Simple sliding-window rate limiter. Pure in-memory (resets on restart).
export class RateLimiter {
  constructor() {
    this.buckets = new Map();
    setInterval(() => this.sweep(), 60_000).unref?.();
  }

  sweep() {
    const threshold = now() - 120_000;
    for (const [key, bucket] of this.buckets) {
      bucket.hits = bucket.hits.filter((t) => t > threshold);
      if (bucket.hits.length === 0) this.buckets.delete(key);
    }
  }

  // Returns { allowed, retryAfterMs }
  check(key, max, windowMs) {
    const bucket = this.buckets.get(key) || { hits: [] };
    const cutoff = now() - windowMs;
    bucket.hits = bucket.hits.filter((t) => t > cutoff);
    if (bucket.hits.length >= max) {
      const oldest = bucket.hits[0];
      const retryAfterMs = Math.max(0, oldest + windowMs - now());
      return { allowed: false, retryAfterMs };
    }
    bucket.hits.push(now());
    this.buckets.set(key, bucket);
    return { allowed: true, retryAfterMs: 0 };
  }
}

export const rateLimiters = {
  http: new RateLimiter(),
  socket: new RateLimiter(),
};

export function ipKey(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
}

export function sanitizeText(s, max = 2000) {
  if (typeof s !== 'string') return '';
  return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
}

export function safeJsonParse(s, fallback = null) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

export function contentTypeOf(name) {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const map = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', opus: 'audio/opus', m4a: 'audio/mp4', aac: 'audio/aac',
    flac: 'audio/flac', webm_audio: 'audio/webm',
    pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json',
    zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed', tar: 'application/x-tar', gz: 'application/gzip',
    apk: 'application/vnd.android.package-archive',
  };
  return map[ext] || 'application/octet-stream';
}