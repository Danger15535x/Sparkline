export function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 10) return 'now';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d}d`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function clockTime(ts) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function fullTime(ts) {
  return new Date(ts).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDuration(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

export function formatSeconds(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function lastActiveLabel(lastSeen, online) {
  if (online) return 'online';
  if (!lastSeen) return 'offline';
  const diff = Date.now() - lastSeen;
  if (diff < 60_000) return 'online';
  if (diff < 3600_000) return `last seen ${Math.max(1, Math.floor(diff / 60_000))}m ago`;
  if (diff < 86400_000) return `last seen ${Math.floor(diff / 3600_000)}h ago`;
  return `last seen ${new Date(lastSeen).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

export function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function initials(name) {
  return (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

// Deterministic avatar colors
export function avatarColor(name) {
  const palette = [
    '#6d5cff', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444',
    '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1',
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Extremely lightweight link detection for message rendering
export function detectLinks(text) {
  const re = /(https?:\/\/[^\s<>"']+)/g;
  const parts = [];
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index) });
    parts.push({ url: m[0], text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}
export function formatCode(raw) {
  let clean = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.startsWith('SPK')) clean = clean.slice(3);
  if (clean.length > 6) clean = clean.slice(0, 6);
  return clean ? `SPK-${clean}` : '';
}

export function isValidCode(c) {
  return /^SPK-[A-Z0-9]{6}$/.test(c || '');
}
