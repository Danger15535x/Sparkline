import { useSyncExternalStore } from 'react';

let current = '';
const listeners = new Set();

function notify() {
  for (const fn of listeners) fn();
}

export function navigate(to, { replace = false } = {}) {
  const full = `#${to}`;
  if (replace) {
    if (location.hash === full) return;
    window.history.replaceState(null, '', full);
  } else {
    location.hash = full;
  }
}

export function currentHash() {
  return location.hash.slice(1) || '/';
}

export function useRoute() {
  const hash = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => {
      current = currentHash();
      return current;
    }
  );
  return hash;
}

const MAX_HISTORY = 30;
let history = [currentHash()];

window.addEventListener('hashchange', () => {
  current = currentHash();
  history = history.filter((h) => h !== current).concat(current).slice(-MAX_HISTORY);
  notify();
});

window.addEventListener('popstate', () => notify());

export function back() {
  if (history.length > 1) {
    history.pop();
    const prev = history[history.length - 1];
    history = history.slice(0, -1).concat(currentHash());
    navigate(prev, { replace: true });
  } else {
    navigate('/');
  }
}

export function parseQuery(hash) {
  const idx = hash.indexOf('?');
  if (idx === -1) return {};
  const params = new URLSearchParams(hash.slice(idx + 1));
  const out = {};
  for (const [k, v] of params) out[k] = v;
  return out;
}

export function matchRoute(hash) {
  const [path, query] = hash.split('?');
  const parts = path.split('/').filter(Boolean);
  const params = Object.fromEntries(new URLSearchParams(query || ''));
  return { path: '/' + parts.join('/'), segments: parts, params, query };
}