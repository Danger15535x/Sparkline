import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../lib/store.jsx';
import { api, uploadFile } from '../lib/api.js';
import { VoiceRecorder, resizeImageFile, computePeaks } from '../lib/media.js';
import { formatSeconds } from '../lib/format.js';
import {
  IconSend, IconSmile, IconPaperclip, IconMic, IconStop, IconX, IconPause, IconPlay,
  IconImage, IconVideo, IconMusic, IconFile, IconGif, IconGrid, IconTrash, IconCheck,
} from './icons.jsx';
import { useOutsideClick } from './ui.jsx';

const EMOJI_SET = [
  '😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😎', '🤩', '🥳', '😇', '🙂',
  '😉', '😌', '😋', '😜', '🤪', '😏', '😒', '😔', '😢', '😭', '😤', '😡',
  '🤬', '🥺', '😳', '😱', '🤯', '😴', '🤔', '🤫', '🫡', '🤝', '👍', '👎',
  '👏', '🙏', '💪', '✌️', '🤞', '👌', '❤️', '🧡', '💛', '💚', '💙', '💜',
  '🖤', '💯', '🔥', '✨', '🎉', '🎊', '🥳', '🚀', '⚡', '💥', '⭐', '🌟',
  '☀️', '🌙', '🌈', '⚡', '🍀', '🏆', '🎵', '🎶', '📱', '💬', '📞', '🎥',
];

const STICKERS = ['🚀', '🔥', '❤️', '😂', '👍', '👏', '💯', '🎉', '😎', '🙌', '✨', '💪', '🤝', '🫡', '🥳', '😍'];

export function Composer({ conversation, onReplyDismiss, replyTo, onScrollToMessage }) {
  const { state, sendMessage, sendTyping, toast } = useApp();
  const [text, setText] = useState('');
  const [attachOpen, setAttachOpen] = useState(false);
  const [picker, setPicker] = useState(null); // emoji | stickers | gif
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(null); // {state, durationMs, peaks}
  const [gifQuery, setGifQuery] = useState('');
  const [gifResults, setGifResults] = useState([]);
  const [uploading, setUploading] = useState(null); // {label, progress}
  const taRef = useRef(null);
  const fileRef = useRef(null);
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const docRef = useRef(null);
  const pickerRef = useOutsideClick(() => { setPicker(null); setAttachOpen(false); }, picker || attachOpen);
  const recorderRef = useRef(null);
  const typingTimer = useRef(null);
  const lastTypingSent = useRef(0);

  const disappearing = conversation?.disappearingMs || 0;

  const onTyping = (e) => {
    setText(e.target.value);
    const now = Date.now();
    if (now - lastTypingSent.current > 2500) {
      lastTypingSent.current = now;
      sendTyping(conversation.id, true);
    }
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => sendTyping(conversation.id, false), 1800);
  };

  useEffect(() => () => { clearTimeout(typingTimer.current); sendTyping(conversation.id, false); }, [conversation.id]);

  const autosize = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(130, ta.scrollHeight)}px`;
  };

  useEffect(autosize, [text]);

  const doSendText = async (extra) => {
    const content = (extra?.content ?? text).trim();
    if (!content || sending) return;
    setText('');
    sendTyping(conversation.id, false);
    await sendMessage(conversation.id, { type: 'text', content, replyTo });
    onReplyDismiss?.();
    taRef.current?.focus();
  };

  const uploadAndSend = async (file, { type, label, attachMeta } = {}) => {
    if (!file || sending) return;
    setSending(true);
    const fd = new FormData();
    fd.append('conversationId', conversation.id);
    fd.append('file', file);
    setUploading({ label: label || 'Uploading…', progress: 0 });
    try {
      const data = await uploadFile('/files', fd, { onProgress: (p) => setUploading({ label: label || 'Uploading…', progress: p }) });
      let meta = {};
      if (type === 'voice') {
        const { peaks, duration } = await computePeaks(file, 60);
        meta = { duration, peaks };
      }
      await sendMessage(conversation.id, {
        type: type || (file.type?.startsWith('image/') ? 'image' : file.type?.startsWith('video/') ? 'video' : file.type?.startsWith('audio/') ? 'audio' : 'file'),
        attachment: { id: data.id, name: data.name, mime: data.mime, size: data.size, url: data.url, ...meta, ...(attachMeta || {}) },
        replyTo,
      });
      onReplyDismiss?.();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSending(false);
      setUploading(null);
    }
  };

  const pickFile = async (e, kind) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (kind === 'image') {
      try {
        const resized = file.size > 3 * 1024 * 1024 || file.type === 'image/heic' ? await resizeImageFile(file, 1920) : file;
        await uploadAndSend(resized, { type: 'image', label: 'Uploading photo…' });
      } catch (err) {
        toast(err.message, 'error');
      }
    } else if (kind === 'video') {
      await uploadAndSend(file, { type: 'video', label: 'Uploading video…' });
    } else if (kind === 'audio') {
      await uploadAndSend(file, { type: 'audio', label: 'Uploading audio…' });
    } else {
      await uploadAndSend(file, { type: 'file', label: 'Uploading file…' });
    }
  };

  // ---- voice recording ----
  const startRecording = async () => {
    if (recorderRef.current) return;
    try {
      const rec = new VoiceRecorder((st) => setRecording({ ...st }));
      recorderRef.current = rec;
      await rec.start();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const stopRecording = async () => {
    const rec = recorderRef.current;
    if (!rec) return;
    const result = await rec.stopRecording();
    recorderRef.current = null;
    setRecording(null);
    if (result && result.durationMs > 400) {
      const file = new File([result.blob], 'voice.webm', { type: result.blob.type || 'audio/webm' });
      await uploadAndSend(file, { type: 'voice', label: 'Sending voice message…', attachMeta: { duration: result.durationMs, peaks: result.peaks } });
    } else if (result) {
      toast('Recording too short', 'info');
    }
  };

  const cancelRecording = () => {
    recorderRef.current?.cancel();
    recorderRef.current = null;
    setRecording(null);
  };

  const pauseRecording = () => recorderRef.current?.pause();
  const resumeRecording = () => recorderRef.current?.resume();

  const pickEmoji = (e) => {
    setText((t) => t + e);
    setPicker(null);
    taRef.current?.focus();
  };

  const sendSticker = (s) => {
    sendMessage(conversation.id, { type: 'text', content: s, replyTo });
    setPicker(null);
    onReplyDismiss?.();
  };

  const searchGif = async (q) => {
    setGifQuery(q);
    if (!q.trim()) return setGifResults([]);
    try {
      const data = await api(`/giphy/search?q=${encodeURIComponent(q)}`);
      setGifResults(data.items || []);
    } catch (e) {
      setGifResults([]);
      toast(e.message, 'error');
    }
  };

  return (
    <div className="composer" style={{ marginBottom: recording ? 0 : undefined }}>
      {uploading && (
        <div className="recorder-bar" style={{ bottom: 'calc(100% + 8px)' }}>
          <IconPaperclip style={{ width: 18, height: 18, color: 'var(--accent)' }} />
          <span className="grow">{uploading.label}</span>
          <div style={{ width: 120, height: 6, background: 'var(--surface-3)', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{ width: `${uploading.progress}%`, height: '100%', background: 'var(--accent)' }} />
          </div>
          <span className="tiny">{uploading.progress}%</span>
        </div>
      )}

      {recording && recording.state !== 'idle' && (
        <div className="recorder-bar">
          {recording.state === 'paused' ? <IconPause style={{ width: 18, height: 18, color: 'var(--text-2)' }} /> : <span className="rec-dot" />}
          <span className="rec-time">{formatSeconds(recording.durationMs / 1000)}</span>
          <div className="rec-waves">
            {(recording.peaks && recording.peaks.slice(-30).length ? recording.peaks.slice(-30) : Array(30).fill(0.2)).map((p, i) => (
              <span key={i} style={{ height: `${Math.max(6, p * 32)}px`, animation: recording.state === 'recording' && i % 3 === 0 ? 'spk-pulse 1s infinite' : undefined }} />
            ))}
          </div>
          {recording.state === 'recording' ? (
            <button className="btn-icon" aria-label="Pause recording" onClick={pauseRecording}><IconPause /></button>
          ) : (
            <button className="btn-icon" aria-label="Resume recording" onClick={resumeRecording}><IconPlay /></button>
          )}
          <button className="btn-icon" aria-label="Cancel recording" onClick={cancelRecording}><IconTrash /></button>
          <button className="btn btn-sm btn-primary" style={{ borderRadius: 99 }} onClick={stopRecording} aria-label="Send recording">
            <IconCheck style={{ width: 16, height: 16 }} /> Send
          </button>
        </div>
      )}

      {replyTo && (
        <div className="reply-chip">
          <div className="rt">
            <b>{replyTo.senderName}</b> — {replyTo.type === 'text' ? replyTo.content : replyTo.type === 'image' ? 'Photo' : replyTo.type === 'video' ? 'Video' : replyTo.type === 'voice' ? 'Voice message' : 'Message'}
          </div>
          <button className="btn-icon" style={{ width: 30, height: 30 }} onClick={onReplyDismiss} aria-label="Cancel reply">
            <IconX />
          </button>
        </div>
      )}

      {attachOpen && (
        <div className="attach-pop">
          <button onClick={() => fileRef.current?.click()} aria-label="Send photo">
            <IconImage />
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pickFile(e, 'image')} />
          </button>
          <button onClick={() => videoRef.current?.click()} aria-label="Send video">
            <IconVideo />
            <input ref={videoRef} type="file" accept="video/*" hidden onChange={(e) => pickFile(e, 'video')} />
          </button>
          <button onClick={() => audioRef.current?.click()} aria-label="Send audio">
            <IconMusic />
            <input ref={audioRef} type="file" accept="audio/*" hidden onChange={(e) => pickFile(e, 'audio')} />
          </button>
          <button onClick={() => docRef.current?.click()} aria-label="Send file">
            <IconFile />
            <input ref={docRef} type="file" hidden onChange={(e) => pickFile(e, 'file')} />
          </button>
        </div>
      )}

      {picker && (
        <div className="picker-pop" ref={pickerRef}>
          <div className="picker-tabs">
            <button className={picker === 'emoji' ? 'active' : ''} onClick={() => setPicker('emoji')}><IconSmile /></button>
            <button className={picker === 'stickers' ? 'active' : ''} onClick={() => setPicker('stickers')}><IconGrid /></button>
            <button className={picker === 'gif' ? 'active' : ''} onClick={() => setPicker('gif')}><IconGif /></button>
          </div>
          <div className="picker-body">
            {picker === 'emoji' && (
              <div className="emoji-grid">
                {EMOJI_SET.map((e) => (
                  <button key={e} onClick={() => pickEmoji(e)}>{e}</button>
                ))}
              </div>
            )}
            {picker === 'stickers' && (
              <div className="sticker-grid">
                {STICKERS.map((s) => (
                  <button key={s} onClick={() => sendSticker(s)}>{s}</button>
                ))}
              </div>
            )}
            {picker === 'gif' && (
              <div>
                <input className="input" placeholder="Search GIFs…" value={gifQuery} onChange={(e) => searchGif(e.target.value)} />
                {!state.config?.giphyEnabled ? (
                  <div className="empty" style={{ padding: 24 }}>
                    <p>GIF search isn't configured on this server. The owner can enable it with a GIPHY API key.</p>
                  </div>
                ) : gifResults.length === 0 ? (
                  <div className="empty" style={{ padding: 24 }}><p>{gifQuery ? 'No results' : 'Type to search'}</p></div>
                ) : (
                  <div className="giphy-grid" style={{ maxHeight: 260, overflowY: 'auto' }}>
                    {gifResults.map((g) => (
                      <img key={g.id} src={g.previewUrl} alt={g.title || 'gif'} loading="lazy" onClick={() => { sendMessage(conversation.id, { type: 'text', content: g.url, replyTo }); setPicker(null); }} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <button className="btn-icon" style={{ marginBottom: 8 }} onClick={() => { setAttachOpen(!attachOpen); setPicker(null); }} aria-label="Attach files">
        <IconPaperclip />
      </button>
      <button className="btn-icon" style={{ marginBottom: 8 }} onClick={() => { setPicker(picker === 'emoji' ? null : 'emoji'); setAttachOpen(false); }} aria-label="Emoji">
        <IconSmile />
      </button>
      <textarea
        ref={taRef}
        value={text}
        rows={1}
        placeholder={recording ? 'Recording…' : 'Message…'}
        onChange={onTyping}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            doSendText();
          }
        }}
        aria-label="Message"
      />
      {text.trim() || replyTo ? (
        <button className="send-btn" onClick={() => doSendText()} aria-label="Send message" disabled={sending || !text.trim()}>
          <IconSend />
        </button>
      ) : (
        <button
          className="mic-btn"
          onMouseDown={(e) => {
            e.preventDefault();
            startRecording();
          }}
          onMouseUp={stopRecording}
          onMouseLeave={stopRecording}
          onTouchStart={(e) => {
            e.preventDefault();
            startRecording();
          }}
          onTouchEnd={stopRecording}
          aria-label="Hold to record voice message"
          title="Hold to record a voice message"
        >
          {recording ? <IconStop /> : <IconMic />}
        </button>
      )}

      {disappearing > 0 && (
        <span className="badge badge-amber" style={{ position: 'absolute', bottom: 'calc(100% + 4px)', left: 14 }} title="Messages disappear after this time">
          ⏱ {disappearing >= 86400000 ? `${disappearing / 86400000}d` : disappearing >= 3600000 ? `${disappearing / 3600000}h` : disappearing >= 60000 ? `${disappearing / 60000}m` : `${disappearing / 1000}s`}
        </span>
      )}
    </div>
  );
}