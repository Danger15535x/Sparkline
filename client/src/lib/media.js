// Media helpers: camera/mic, voice recording, waveforms, image resizing

export async function acquireMedia(kind, { video = false, audio = false } = {}) {
  const constraints = { audio: audio || kind === 'audio' || false, video: video || kind === 'video' || false };
  if (constraints.video === true) {
    // prefer a decent default camera
  }
  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    const name = err?.name || '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      throw new Error('Permission denied. Allow camera/microphone access for this site and try again.');
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      throw new Error('No camera or microphone was found on this device.');
    }
    if (name === 'NotReadableError') {
      throw new Error('The camera or microphone is in use by another app.');
    }
    throw new Error('Could not access the camera or microphone. Check your device settings and try again.');
  }
}

export function stopStream(stream) {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
}

export function streamActive(stream) {
  return !!stream && stream.getTracks().some((t) => t.readyState === 'live');
}

// ---------------------------------------------------------------------------
// Recordings
// ---------------------------------------------------------------------------
export function supportedMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  for (const c of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(c)) return c;
  }
  return '';
}

export class VoiceRecorder {
  constructor(onState) {
    this.mime = supportedMimeType();
    this.onState = onState;
    this.chunks = [];
    this.recorder = null;
    this.stream = null;
    this.durationMs = 0;
    this._timer = null;
    this.analyser = null;
    this.livePeaks = [];
    this.state = 'idle';
  }

  async start() {
    if (!this.mime || !window.MediaRecorder) throw new Error('Voice recording is not supported in this browser.');
    this.chunks = [];
    this.durationMs = 0;
    this.livePeaks = [];
    this.stream = await acquireMedia('audio', { audio: true });
    try {
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(this.stream);
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);
      this._sampleTimer = setInterval(() => this._sample(), 50);
    } catch { /* analyser optional */ }
    this.recorder = new MediaRecorder(this.stream, this.mime ? { mimeType: this.mime } : undefined);
    this.recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.onstop = () => this._stopStream();
    this.recorder.start(250);
    this.state = 'recording';
    this._timer = setInterval(() => {
      this.durationMs += 250;
      this.onState?.({ state: this.state, durationMs: this.durationMs, peaks: this.livePeaks });
    }, 250);
    this.onState?.({ state: this.state, durationMs: 0, peaks: [] });
  }

  _sample() {
    if (!this.analyser || this.state !== 'recording') return;
    const buf = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i += 4) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / (buf.length / 4));
    this.livePeaks.push(Math.min(1, rms * 4));
    if (this.livePeaks.length > 500) this.livePeaks.shift();
  }

  pause() {
    if (this.recorder && this.state === 'recording') {
      this.recorder.pause();
      this.state = 'paused';
      clearInterval(this._timer);
      this.onState?.({ state: this.state, durationMs: this.durationMs, peaks: this.livePeaks });
    }
  }

  resume() {
    if (this.recorder && this.state === 'paused') {
      this.recorder.resume();
      this.state = 'recording';
      this._timer = setInterval(() => {
        this.durationMs += 250;
        this.onState?.({ state: this.state, durationMs: this.durationMs, peaks: this.livePeaks });
      }, 250);
      this.onState?.({ state: this.state, durationMs: this.durationMs, peaks: this.livePeaks });
    }
  }

  cancel() {
    if (this.recorder && this.state !== 'idle') {
      this.recorder.onstop = null;
      try { this.recorder.stop(); } catch { /* already stopped */ }
      this._stopStream();
    }
    clearInterval(this._timer);
    if (this._sampleTimer) clearInterval(this._sampleTimer);
    this.chunks = [];
    this.state = 'idle';
    this.onState?.({ state: 'idle', durationMs: 0, peaks: [] });
  }

  _stopStream() {
    stopStream(this.stream);
    this.stream = null;
  }

  stopRecording() {
    clearInterval(this._timer);
    if (this._sampleTimer) clearInterval(this._sampleTimer);
    this.state = 'stopped';
    return new Promise((resolve) => {
      if (!this.recorder || this.recorder.state === 'inactive') return resolve(null);
      this.recorder.onstop = () => {
        this._stopStream();
        const type = this.mime || 'audio/webm';
        const blob = new Blob(this.chunks, { type });
        resolve({ blob, durationMs: this.durationMs, peaks: this.livePeaks.slice(0, 200) });
      };
      try { this.recorder.stop(); } catch { resolve(null); }
    });
  }
}

// Compute a small waveform from an audio blob (client-side, cached by URL)
const waveformCache = new Map();

export async function computePeaks(blob, buckets = 60) {
  const key = blob;
  if (waveformCache.has(key)) return waveformCache.get(key);
  try {
    const arrayBuf = await blob.arrayBuffer();
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuf = await ctx.decodeAudioData(arrayBuf);
    const channel = audioBuf.getChannelData(0);
    const step = Math.floor(channel.length / buckets) || 1;
    const peaks = [];
    for (let i = 0; i < buckets; i++) {
      let max = 0;
      const from = i * step;
      const to = Math.min(channel.length, from + step);
      for (let j = from; j < to; j++) {
        const abs = Math.abs(channel[j]);
        if (abs > max) max = abs;
      }
      peaks.push(Math.max(0.02, Math.min(1, max * 3)));
    }
    ctx.close();
    const result = { peaks, duration: audioBuf.duration * 1000 };
    waveformCache.set(key, result);
    return result;
  } catch {
    return { peaks: Array(buckets).fill(0.35), duration: 0 };
  }
}

// ---------------------------------------------------------------------------
// Image resize (avatars + image previews before upload)
// ---------------------------------------------------------------------------
export function resizeImageFile(file, maxDim) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          if (blob) {
            resolve(new File([blob], file.name || 'image.png', { type: blob.type || 'image/png' }));
          } else reject(new Error('Could not process image.'));
        }, 'image/jpeg', 0.9);
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read image file.'));
    };
    img.src = url;
  });
}