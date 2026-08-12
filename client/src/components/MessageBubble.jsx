import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useApp } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { clockTime, formatSize, formatSeconds, detectLinks } from '../lib/format.js';
import { computePeaks } from '../lib/media.js';
import {
  IconCheck, IconCheckDouble, IconClock, IconPlay, IconPause, IconDownload,
  IconMusic, IconFile, IconX, IconReply, IconStar, IconPin, IconEdit, IconTrash,
  IconForward, IconCopy, IconFlag, IconSmile, IconMore,
} from './icons.jsx';
import { Avatar, Modal, useOutsideClick } from './ui.jsx';

// ---------------------------------------------------------------------------
// Link preview
// ---------------------------------------------------------------------------
const previewCache = new Map();

function LinkPreview({ url }) {
  const { state } = useApp();
  const [data, setData] = useState(() => previewCache.get(url) ?? null);
  const [tried, setTried] = useState(() => previewCache.has(url));

  useEffect(() => {
    if (tried || !state.user) return;
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        const res = await api('/link-preview', { method: 'POST', body: { url } });
        if (alive) {
          previewCache.set(url, res);
          setData(res);
        }
      } catch { /* ignore */ }
      if (alive) setTried(true);
    }, 700);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [url, tried, state.user]);

  if (!data) return null;
  return (
    <a href={data.url} target="_blank" rel="noopener noreferrer" className="link-preview" onClick={(e) => e.stopPropagation()}>
      {data.image && <img src={data.image} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.display = 'none')} />}
      <div className="lp-body">
        <div className="lp-host">{data.host}</div>
        <div className="lp-title">{data.title}</div>
        {data.description && <div className="lp-desc">{data.description}</div>}
      </div>
    </a>
  );
}

// ---------------------------------------------------------------------------
// Audio player (voice messages + audio files)
// ---------------------------------------------------------------------------
export function AudioPlayer({ src, meta, mime }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(meta?.duration ? meta.duration / 1000 : 0);
  const [speed, setSpeed] = useState(1);
  const [peaks, setPeaks] = useState(meta?.peaks || null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => {
      if (duration) setProgress((audio.currentTime / duration) * 100);
    };
    const onEnded = () => setPlaying(false);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('ended', onEnded);
    };
  }, [duration]);

  useEffect(() => {
    if (!peaks && meta?.peaks?.length) setPeaks(meta.peaks);
    if (meta?.duration && !duration) setDuration(meta.duration / 1000);
  }, [meta]);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.src && src) audio.src = src;
    if (!duration) {
      try {
        const blob = await (await fetch(src)).blob();
        const { duration: d, peaks: p } = await computePeaks(blob, 60);
        if (d) setDuration(d / 1000);
        if (p?.length) setPeaks(p);
      } catch { /* ignore */ }
    }
    if (audio.paused) {
      try {
        await audio.play();
        setPlaying(true);
      } catch {
        setErr(true);
      }
    } else {
      audio.pause();
      setPlaying(false);
    }
  };

  const seek = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const audio = audioRef.current;
    if (audio && duration) {
      audio.currentTime = ratio * duration;
      setProgress(ratio * 100);
    }
  };

  return (
    <div className="audio-player" onClick={(e) => e.stopPropagation()}>
      <audio ref={audioRef} preload="none" src={src} onError={() => setErr(true)} />
      <button className="play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? <IconPause /> : <IconPlay />}
      </button>
      <div className="grow">
        <div className="wave" onClick={seek} role="slider" aria-label="Seek" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
          {(peaks || Array(30).fill(0.4)).map((p, i) => (
            <span key={i} className={progress >= ((i + 1) / (peaks?.length || 30)) * 100 ? 'played' : ''} style={{ height: `${Math.max(12, p * 34)}px` }} />
          ))}
        </div>
        <div className="flex" style={{ justifyContent: 'space-between', marginTop: 2 }}>
          <span className="time">{formatSeconds((duration * progress) / 100 || 0)}</span>
          <div className="flex" style={{ gap: 6 }}>
            {err && <span className="tiny" style={{ color: 'var(--danger)' }}>can't play</span>}
            {meta?.duration ? (
              <button
                className="btn btn-sm btn-ghost"
                style={{ padding: '1px 6px', fontSize: 11 }}
                onClick={() => {
                  const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
                  setSpeed(next);
                  if (audioRef.current) audioRef.current.playbackRate = next;
                }}
              >
                {speed}x
              </button>
            ) : (
              <span className="time">{formatSeconds(duration)}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Message content renderers
// ---------------------------------------------------------------------------
function MediaViewer({ src, type, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="media-viewer" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="mv-bar">
        <span />
        <button className="btn btn-icon" style={{ color: '#fff' }} onClick={onClose} aria-label="Close preview">
          <IconX />
        </button>
      </div>
      {type === 'video' ? <video src={src} controls autoPlay playsInline /> : <img src={src} alt="" />}
    </div>
  );
}

function AttachContent({ msg, openViewer, my }) {
  const { state } = useApp();
  const [downloadUrl, setDownloadUrl] = useState(null);

  const download = async (e) => {
    e.stopPropagation();
    try {
      const res = await fetch(msg.attachment.url, { credentials: 'same-origin' });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = msg.attachment.name || 'file';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch { /* ignore */ }
  };

  if (!msg.attachment) return null;
  const { mime, name } = msg.attachment;

  if (mime?.startsWith('image/')) {
    return (
      <>
        <div className="media" onClick={(e) => { e.stopPropagation(); openViewer('image'); }}>
          <img src={msg.attachment.url} alt={name || 'image'} loading="lazy" />
        </div>
        {msg.content && <div className="caption">{msg.content}</div>}
      </>
    );
  }
  if (mime?.startsWith('video/')) {
    return (
      <>
        <div className="media" onClick={(e) => { e.stopPropagation(); openViewer('video'); }}>
          <video src={msg.attachment.url} preload="metadata" playsInline muted />
        </div>
        {msg.content && <div className="caption">{msg.content}</div>}
      </>
    );
  }
  if (mime?.startsWith('audio/')) {
    return (
      <>
        <AudioPlayer src={msg.attachment.url} meta={msg.meta} mime={mime} />
        {msg.content && <div className="caption" style={{ marginTop: 6 }}>{msg.content}</div>}
      </>
    );
  }
  return (
    <div className="file-box" onClick={(e) => e.stopPropagation()} title={name}>
      <IconFile style={{ width: 30, height: 30, flex: 'none' }} />
      <div className="grow">
        <div className="fname">{name || 'File'}</div>
        <div className="fsize">{formatSize(msg.attachment.size)}</div>
      </div>
      <button className="btn btn-icon" onClick={download} aria-label="Download file">
        <IconDownload />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick reaction emojis
// ---------------------------------------------------------------------------
const QUICK_EMOJI = ['👍', '❤️', '😂', '🔥', '👏', '😮'];

export function ReactionPicker({ onPick, anchor }) {
  const ref = useOutsideClick(() => onPick(null), true);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  useEffect(() => {
    if (anchor) {
      const r = anchor.getBoundingClientRect();
      let left = r.left;
      let top = r.top - 46;
      if (left + 230 > window.innerWidth - 8) left = window.innerWidth - 250;
      if (top < 8) top = r.bottom + 8;
      setPos({ top, left });
    }
  }, [anchor]);
  return (
    <div className="reaction-pop" ref={ref} style={pos}>
      {QUICK_EMOJI.map((e) => (
        <button key={e} onClick={() => onPick(e)}>{e}</button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Message bubble
// ---------------------------------------------------------------------------
export function MessageBubble({ msg, conversation, showSender, onReply, onScrollTo, onForward }) {
  const { state, dispatch, toggleReaction, togglePin, toggleSave, editMessage, deleteMessage, retryMessage } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [reactOpen, setReactOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [viewer, setViewer] = useState(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const me = state.user;
  const mine = msg.senderId === me?.id;
  const deleted = !!msg.deletedAt;
  const typing = Object.keys(state.typing[conversation?.id] || {}).length > 0;

  const status = msg.status || (mine ? 'sent' : 'none');
  const peer = conversation?.peer;

  // delivery/read state
  const peerReadAt = peer ? state.readAt[conversation.id]?.[peer.id] || peer.lastReadAt || 0 : 0;
  const isRead = mine && peer && msg.createdAt <= peerReadAt;

  const openMenu = (e) => {
    e.stopPropagation();
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    setMenuAnchor(e.currentTarget);
    setMenuOpen(true);
  };

  const parts = useMemo(() => (msg.type === 'text' && msg.content ? detectLinks(msg.content) : []), [msg.content, msg.type]);

  const saveEdit = async () => {
    if (!editText.trim()) return;
    await editMessage(conversation.id, msg.id, editText);
    setEditing(false);
  };

  const menuItems = useMemo(() => {
    const items = [];
    const push = (label, icon, onClick, danger) => items.push({ label, icon, onClick, danger });
    if (!deleted) {
      push('Reply', <IconReply />, () => onReply?.(msg));
      push('React', <IconSmile />, () => setReactOpen(true));
      push('Forward', <IconForward />, () => onForward?.(msg));
      push('Save', <IconStar />, () => toggleSave(msg.id, true));
      push(msg.pinned ? 'Unpin' : 'Pin', <IconPin />, () => togglePin(conversation.id, msg.id, !msg.pinned));
      if (msg.type === 'text') push('Copy', <IconCopy />, () => navigator.clipboard?.writeText(msg.content).then(() => dispatch({ type: 'TOAST_PUSH', toast: { id: Math.random().toString(36).slice(2), message: 'Copied', kind: 'info' } })));
      if (mine) {
        if (msg.type === 'text' || msg.meta?.caption !== undefined) push('Edit', <IconEdit />, () => { setEditText(msg.content || msg.meta?.caption || ''); setEditing(true); });
        push('Delete', <IconTrash />, () => deleteMessage(conversation.id, msg.id), true);
      }
      items.push({ sep: true });
      push('Report', <IconFlag />, () => setReportOpen(true));
    }
    return items;
  }, [msg, deleted, mine, conversation.id, menuOpen]);

  const senderName = conversation?.type === 'group' && !mine ? (state.conversations.find((c) => c.id === conversation.id)?.members?.find((m) => m.id === msg.senderId)?.displayName || '') : '';

  if (msg.type === 'system') {
    return (
      <div className="day-sep" style={{ alignSelf: 'center' }}>
        <span>{msg.content}</span>
      </div>
    );
  }

  return (
    <div className={`msg-row ${mine ? 'me' : ''}`}>
      <div className="msg-actions-row">
        {!deleted && (
          <button className="btn btn-icon" onClick={() => onReply?.(msg)} aria-label="Reply"><IconReply /></button>
        )}
      </div>
      <div className={`msg ${deleted ? 'deleted' : ''} ${status === 'failed' ? 'failed' : ''}`}>
        {editing ? (
          <div className="stack" style={{ minWidth: 260 }}>
            <textarea className="textarea" value={editText} autoFocus onChange={(e) => setEditText(e.target.value)} rows={3} />
            <div className="flex">
              <button className="btn btn-sm btn-primary" onClick={saveEdit}>Save</button>
              <button className="btn btn-sm" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        ) : deleted ? (
          <span className="tiny">Message deleted</span>
        ) : (
          <>
            {showSender && !mine && senderName && <div className="sender">{senderName}</div>}
            {msg.replyTo && (
              <div className="reply-preview" onClick={(e) => { e.stopPropagation(); onScrollTo?.(msg.replyTo.id); }}>
                <div className="rp-name">{msg.replyTo.senderName}</div>
                <div className="rp-text">{msg.replyTo.type === 'text' ? msg.replyTo.content : msg.replyTo.type === 'image' ? 'Photo' : msg.replyTo.type === 'video' ? 'Video' : msg.replyTo.type === 'voice' ? 'Voice message' : 'Message'}</div>
              </div>
            )}
            {msg.attachment && <AttachContent msg={msg} openViewer={setViewer} my={mine} />}
            {msg.type === 'text' && (
              <span>
                {parts.map((p, i) =>
                  p.url ? (
                    <React.Fragment key={i}>
                      <a className="link" href={p.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>{p.text}</a>
                      {i === 0 && <LinkPreview url={p.url} />}
                    </React.Fragment>
                  ) : (
                    <React.Fragment key={i}>{p.text}</React.Fragment>
                  )
                )}
                {!parts.length && msg.content}
              </span>
            )}
            {msg.type === 'voice' && msg.attachment && <AudioPlayer src={msg.attachment.url} meta={msg.meta} />}
            {(msg.meta?.caption && msg.attachment) ? null : msg.content && msg.type !== 'text' && msg.attachment?.mime?.startsWith('image/') ? null : null}
            {msg.reactions?.length > 0 && (
              <div className="reactions">
                {msg.reactions.map((r) => (
                  <button key={r.emoji} className={`reaction-pill`} onClick={() => toggleReaction(conversation.id, msg.id, r.emoji)}>
                    {r.emoji} <span className="cnt">{r.count}</span>
                  </button>
                ))}
                <button className="reaction-pill" onClick={() => setReactOpen(true)}>+</button>
              </div>
            )}
            {msg.pinned && <div className="tiny" style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}><IconPin style={{ width: 11, height: 11 }} />Pinned</div>}
            <div className="mtime">
              <span className="edited-tag">{msg.edited ? 'edited' : ''}</span>
              {clockTime(msg.createdAt)}
              {mine && (
                <span className="ticks" aria-label={status === 'sending' ? 'Sending' : status === 'failed' ? 'Failed' : isRead ? 'Read' : 'Delivered'}>
                  {status === 'sending' && <IconClock style={{ width: 12, height: 12 }} />}
                  {status === 'failed' && (
                    <button className="btn btn-icon" style={{ width: 20, height: 20 }} onClick={() => retryMessage(conversation.id, msg.id)} aria-label="Retry">
                      <IconRefreshMini />
                    </button>
                  )}
                  {(status === 'sent' || status === 'delivered' || !isRead) && status !== 'failed' && status !== 'sending' && <IconCheck style={{ width: 12, height: 12 }} />}
                  {status === 'delivered' && !isRead && <IconCheckDouble style={{ width: 12, height: 12 }} />}
                  {isRead && <IconCheckDouble style={{ width: 12, height: 12, color: 'var(--accent-2)' }} />}
                </span>
              )}
            </div>
          </>
        )}
      </div>
      <button className="btn btn-icon msg-menu-btn" style={{ width: 30, height: 30 }} onClick={openMenu} aria-label="Message actions">
        <IconMore />
      </button>
      {menuOpen && (
        <MenuPopover items={menuItems} anchor={menuAnchor} onClose={() => setMenuOpen(false)} />
      )}
      {reactOpen && <ReactionPicker anchor={menuAnchor} onPick={(emoji) => { if (emoji) toggleReaction(conversation.id, msg.id, emoji); setReactOpen(false); }} />}
      {viewer && <MediaViewer src={msg.attachment.url} type={viewer} onClose={() => setViewer(null)} />}
      {reportOpen && (
        <Modal open onClose={() => setReportOpen(false)} title="Report">
          <div className="stack">
            <p className="muted" style={{ margin: 0 }}>What's wrong with this message?</p>
            <textarea className="textarea" value={reportReason} onChange={(e) => setReportReason(e.target.value)} placeholder="Tell us briefly what happened…" />
            <button
              className="btn btn-danger"
              onClick={async () => {
                try {
                  await api('/report', { method: 'POST', body: { targetType: 'message', targetId: msg.id, reason: reportReason || 'Reported message' } });
                  setReportOpen(false);
                  dispatch({ type: 'TOAST_PUSH', toast: { id: Math.random().toString(36).slice(2), message: 'Thanks — our team will review this.', kind: 'success' } });
                } catch (e) {
                  dispatch({ type: 'TOAST_PUSH', toast: { id: Math.random().toString(36).slice(2), message: e.message, kind: 'error' } });
                }
              }}
            >
              Submit report
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function IconRefreshMini() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

function MenuPopover({ items, anchor, onClose }) {
  const ref = useOutsideClick(onClose, true);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  useEffect(() => {
    if (anchor) {
      const r = anchor.getBoundingClientRect();
      const w = 210;
      let left = r.right - w;
      let top = r.bottom + 4;
      if (left < 8) left = 8;
      if (top + items.length * 38 + 20 > window.innerHeight) top = Math.max(8, r.top - items.length * 38 - 20);
      setPos({ top, left });
    }
  }, [anchor, items.length]);
  return (
    <div className="dropdown" ref={ref} style={pos} role="menu">
      {items.map((it, i) =>
        it.sep ? (
          <div className="menu-sep" key={i} />
        ) : (
          <button key={i} className={`menu-item ${it.danger ? 'danger' : ''}`} onClick={() => { onClose(); it.onClick?.(); }}>
            {it.icon}
            {it.label}
          </button>
        )
      )}
    </div>
  );
}