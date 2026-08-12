import React, { useEffect, useRef, useState, useLayoutEffect } from 'react';
import { useApp } from '../lib/store.jsx';
import { avatarColor, initials } from '../lib/format.js';
import { IconX } from './icons.jsx';

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------
export function Avatar({ user, name, size = 42, online, showDot = true, src }) {
  const [err, setErr] = useState(false);
  const displayName = name || user?.displayName || '?';
  const avatarSrc = src || user?.avatar;
  const color = user?.avatarColor || avatarColor(displayName);
  useEffect(() => setErr(false), [avatarSrc]);
  return (
    <span className="avatar" style={{ width: size, height: size, background: color, fontSize: size * 0.38 }} aria-label={displayName}>
      {avatarSrc && !err ? (
        <img src={avatarSrc} alt="" onError={() => setErr(true)} loading="lazy" />
      ) : (
        initials(displayName)
      )}
      {online && showDot && <span className="dot" />}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------
export function Modal({ open, onClose, title, children, width, footer }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${width === 'xl' ? 'modal-xl' : ''}`} role="dialog" aria-modal="true">
        {title !== undefined && (
          <div className="modal-head">
            <span>{title}</span>
            <button className="btn btn-icon" onClick={onClose} aria-label="Close">
              <IconX />
            </button>
          </div>
        )}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-body" style={{ paddingTop: 0 }}>{footer}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drawer
// ---------------------------------------------------------------------------
export function Drawer({ open, onClose, title, children }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()} />
      <div className="drawer" role="dialog" aria-modal="true">
        <div className="drawer-head">
          <button className="btn btn-icon" onClick={onClose} aria-label="Close"><IconX /></button>
          <span>{title}</span>
        </div>
        <div className="drawer-body">{children}</div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Dropdown (context menu)
// ---------------------------------------------------------------------------
export function Dropdown({ items, anchor, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const w = 220;
    const h = items.length * 40 + 20;
    let left = r.right - w;
    let top = r.bottom + 6;
    if (left < 8) left = 8;
    if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    setPos({ top, left });
  }, [anchor, items.length]);

  useEffect(() => {
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onClose, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  return (
    <div className="dropdown" ref={ref} style={pos} role="menu">
      {items.map((item, i) =>
        item.sep ? (
          <div className="menu-sep" key={`s${i}`} />
        ) : (
          <button
            key={item.key || i}
            className={`menu-item ${item.danger ? 'danger' : ''}`}
            role="menuitem"
            onClick={() => {
              onClose();
              item.onClick?.();
            }}
            disabled={item.disabled}
          >
            {item.icon}
            {item.label}
          </button>
        )
      )}
    </div>
  );
}

export function useContextMenu() {
  const [menu, setMenu] = useState(null); // { anchor: element }
  const close = () => setMenu(null);
  const open = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ anchor: e.currentTarget });
  };
  return { menu, close, open };
}

// ---------------------------------------------------------------------------
// Switch
// ---------------------------------------------------------------------------
export function Switch({ checked, onChange, label, disabled }) {
  return (
    <label className="switch" aria-label={label}>
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      <span className="track" />
      <span className="thumb" />
    </label>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
export function Tabs({ tabs, active, onChange, className = '' }) {
  return (
    <div className={`tabs ${className}`} role="tablist">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={active === t.key} className={active === t.key ? 'active' : ''} onClick={() => onChange(t.key)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
export function Toasts() {
  const { state } = useApp();
  return (
    <div className="toasts" aria-live="polite">
      {state.toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          {t.kind === 'error' ? '⚠️ ' : t.kind === 'success' ? '✓ ' : 'ℹ️ '}
          {t.message}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------
export function EmptyState({ icon, title, text, action }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      {title && <h3>{title}</h3>}
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

export function Spinner({ large }) {
  return (
    <div className="center-spin">
      <div className={`spinner ${large ? 'spinner-lg' : ''}`} role="status" aria-label="Loading" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton rows
// ---------------------------------------------------------------------------
export function SkeletonList({ rows = 5 }) {
  return (
    <div className="flex-col" style={{ padding: 10 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div className="flex" key={i} style={{ padding: 6 }}>
          <div className="skeleton" style={{ width: 46, height: 46, borderRadius: '50%', flex: 'none' }} />
          <div className="grow">
            <div className="skeleton" style={{ width: '55%', height: 13, marginBottom: 8 }} />
            <div className="skeleton" style={{ width: '85%', height: 11 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hook: outside click
// ---------------------------------------------------------------------------
export function useOutsideClick(onClick, active = true) {
  const ref = useRef(null);
  useEffect(() => {
    if (!active) return;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClick();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClick, active]);
  return ref;
}