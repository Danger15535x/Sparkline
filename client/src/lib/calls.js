// WebRTC call engine: 1:1 and small-group mesh audio/video calls.
// Uses the perfect negotiation pattern to avoid SDP glare, with
// bandwidth adaptation via RTCRtpSender parameters and ICE restart.
import React from 'react';
import { api } from './api.js';
import { emit, getSocket, onSocketEvent } from './socket.js';
import { acquireMedia, stopStream } from './media.js';
import { callBus } from './store.jsx';

const QUALITY_TIERS = [null, 700_000, 350_000, 160_000];

class CallEngine {
  constructor(getConfig, getUser) {
    this.getConfig = getConfig;
    this.getUser = getUser;
    this.state = {
      call: null, // server call object
      phase: 'idle', // ringing-in | ringing-out | connecting | active | ended
      reason: '',
      localStream: null,
      remoteStreams: {}, // userId -> MediaStream
      participants: [], // ordered participant summaries
      media: { mic: true, cam: true, speaker: true },
      quality: { rating: 'good', packetLoss: 0, rtt: 0, bitrateKbps: 0 },
      error: null,
      durationMs: 0,
    };
    this.pcs = new Map(); // userId -> RTCPeerConnection
    this.bus = callBus;
    this.startedAt = 0;
    this._statsTimer = null;
    this._durationTimer = null;
    this._listeners = new Set();
    this._iceServers = [];
  }

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit() {
    for (const fn of this._listeners) fn(this.state);
    this.bus.emit('call:state', this.state);
  }

  _set(patch) {
    this.state = { ...this.state, ...patch };
    this._emit();
  }

  _peerFor(userId) {
    return this.pcs.get(userId) || null;
  }

  async _ensureIce() {
    if (this._iceServers.length) return this._iceServers;
    const cfg = this.getConfig();
    const list = [
      ...(cfg?.iceServers || []),
      ...(cfg?.stunUrls || ['stun:stun.l.google.com:19302']).map((urls) => ({ urls })),
    ];
    this._iceServers = list;
    return list;
  }

  // -----------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------
  async startCall(conversationId, callType) {
    if (this.state.phase !== 'idle') return;
    this._set({ phase: 'connecting', reason: '', error: null, call: { conversationId, callType } });
    try {
      const media = await this._acquire(callType);
      this._set({ localStream: media, media: { mic: true, cam: callType === 'video', speaker: true } });
      const data = await api('/calls', { method: 'POST', body: { conversationId, callType } });
      const call = data.call;
      this._set({ call, phase: 'ringing-out', participants: call.participants || [{ userId: this.getUser()?.id }] });
      this.startedAt = Date.now();
      // wait for the ring (server sends call:state to everyone once someone accepts)
    } catch (e) {
      this._cleanupStreams();
      this._set({ phase: 'idle', error: e.message || 'The call could not connect. Check your network and try again.' });
    }
  }

  acceptCall(call) {
    if (this.state.phase !== 'idle') return;
    this._set({ call, phase: 'connecting', error: null });
    emit('call:accept', call.id);
  }

  rejectCall(call) {
    emit('call:reject', call.id);
    this._set({ phase: 'idle', reason: 'rejected' });
  }

  cancelCall() {
    if (this.state.call) emit('call:cancel', this.state.call.id);
    this.endLocal();
  }

  endCall() {
    if (this.state.call) emit('call:end', this.state.call.id);
    this.endLocal();
  }

  endLocal() {
    this._cleanupStreams();
    this._closePeers();
    this._set({ phase: 'idle', reason: this.state.phase === 'ringing-out' ? 'ended' : '', remoteStreams: {}, participants: [] });
  }

  async toggleMic() {
    const track = this.state.localStream?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !this.state.media.mic;
    this._set({ media: { ...this.state.media, mic: track.enabled } });
  }

  async toggleCam() {
    if (this.state.call?.callType === 'audio') return;
    const track = this.state.localStream?.getVideoTracks()[0];
    if (track) {
      track.enabled = !this.state.media.cam;
      this._set({ media: { ...this.state.media, cam: track.enabled } });
      return;
    }
    // enable camera mid-call
    try {
      const stream = await acquireMedia('video', { video: true });
      for (const t of stream.getVideoTracks()) {
        t.enabled = true;
        this.state.localStream.addTrack(t);
        for (const pc of this.pcs.values()) {
          if (pc.getSenders().some((s) => s.track?.kind === 'video')) continue;
          pc.addTrack(t, this.state.localStream);
        }
      }
      this._set({ media: { ...this.state.media, cam: true } });
    } catch (e) {
      this._set({ error: e.message });
    }
  }

  async switchCamera() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter((d) => d.kind === 'videoinput');
    if (cams.length < 2) return;
    const current = this.state.localStream?.getVideoTracks()[0]?.getSettings?.().deviceId;
    const next = cams.find((c) => c.deviceId !== current) || cams[0];
    try {
      const stream = await acquireMedia('video', { video: { deviceId: { exact: next.deviceId } } });
      const newTrack = stream.getVideoTracks()[0];
      const oldTrack = this.state.localStream?.getVideoTracks()[0];
      if (oldTrack) {
        this.state.localStream.removeTrack(oldTrack);
        oldTrack.stop();
      }
      this.state.localStream.addTrack(newTrack);
      for (const pc of this.pcs.values()) {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) sender.replaceTrack(newTrack);
      }
    } catch (e) {
      this._set({ error: e.message });
    }
  }

  async toggleSpeaker() {
    const next = !this.state.media.speaker;
    // try to route to speakerphone via output device where supported
    const elements = document.querySelectorAll('.call-audio-output');
    for (const el of elements) {
      try {
        if (el.setSinkId && typeof el.setSinkId === 'function') {
          await el.setSinkId(next ? 'default' : '');
        }
      } catch { /* not supported */ }
    }
    this._set({ media: { ...this.state.media, speaker: next } });
  }

  // -----------------------------------------------------------------
  // Media
  // -----------------------------------------------------------------
  async _acquire(callType) {
    return acquireMedia(callType, { video: callType === 'video', audio: true });
  }

  _cleanupStreams() {
    stopStream(this.state.localStream);
    for (const s of Object.values(this.state.remoteStreams)) stopStream(s);
    clearInterval(this._statsTimer);
    clearInterval(this._durationTimer);
    this._statsTimer = null;
    this._durationTimer = null;
  }

  _closePeers() {
    for (const pc of this.pcs.values()) {
      try {
        pc.onicecandidate = null;
        pc.ontrack = null;
        pc.onconnectionstatechange = null;
        pc.close();
      } catch { /* ignore */ }
    }
    this.pcs.clear();
  }

  // -----------------------------------------------------------------
  // Signaling handling (called from socket events)
  // -----------------------------------------------------------------
  async handleEvent(event, data) {
    switch (event) {
      case 'call:incoming': {
        const call = data.call;
        if (call.conversationId !== this.state.call?.conversationId && this.state.phase !== 'idle') {
          // busy: emit a busy-ish reject
          emit('call:reject', call.id);
          return;
        }
        this._set({ call, phase: 'ringing-in', error: null, participants: call.participants || [] });
        break;
      }
      case 'call:outgoing':
        break;
      case 'call:state': {
        const call = data.call;
        if (this.state.call?.id !== call.id) {
          // call started by someone else (e.g. we joined) — track it
          this._set({ call });
        }
        if (call.status === 'active' && this.state.phase === 'ringing-in' && this.state.localStream) {
          // We already accepted; connect to everyone
          this._set({ phase: 'connecting', participants: call.participants, call });
          await this._connectToAll(call);
        } else if (call.status === 'active' && (this.state.phase === 'ringing-out' || this.state.phase === 'connecting')) {
          this._set({ participants: call.participants, call });
          this.startedAt = Date.now();
          this._set({ phase: 'connecting' });
          await this._connectToAll(call);
        }
        break;
      }
      case 'call:ended': {
        if (data.callId && this.state.call?.id !== data.callId) break;
        const reason = data.reason || 'ended';
        this._cleanupStreams();
        this._closePeers();
        this._set({ phase: 'ended', reason, remoteStreams: {}, participants: [] });
        setTimeout(() => {
          if (this.state.phase === 'ended') {
            this._set({ phase: 'idle' });
          }
        }, 2500);
        break;
      }
      case 'call:signal': {
        if (this.state.call?.id !== data.callId) break;
        await this._handleSignal(data.from, data.data);
        break;
      }
      default:
        break;
    }
  }

  async _connectToAll(call) {
    const me = this.getUser()?.id;
    if (!me) return;
    const targets = call.participants.filter((p) => p.userId !== me);
    for (const p of targets) {
      if (!this.pcs.has(p.userId)) {
        this._createPeer(p.userId, call.id);
      }
    }
    if (this.state.phase === 'connecting') {
      this._set({ phase: 'active' });
      this._startStatsLoop();
      this._durationTimer = setInterval(() => {
        this._set({ durationMs: Date.now() - this.startedAt });
      }, 1000);
    }
  }

  _createPeer(userId, callId) {
    const pc = new RTCPeerConnection({ iceServers: this._iceServers || [], iceCandidatePoolSize: 4 });
    const polite = (this.getUser()?.id || '') < userId;
    pc._polite = polite;
    this.pcs.set(userId, pc);

    for (const track of this.state.localStream?.getTracks() || []) {
      pc.addTrack(track, this.state.localStream);
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        emit('call:signal', { callId, to: userId, data: { type: 'candidate', candidate: e.candidate.toJSON() } });
      }
    };

    pc.ontrack = (e) => {
      const remote = new MediaStream([e.track]);
      this._set({ remoteStreams: { ...this.state.remoteStreams, [userId]: remote } });
    };

    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === 'failed' || st === 'disconnected') {
        // attempt an ICE restart, limited
        if (!pc._restarting) {
          pc._restarting = true;
          setTimeout(async () => {
            try {
              const offer = await pc.createOffer({ iceRestart: true });
              await pc.setLocalDescription(offer);
              emit('call:signal', { callId, to: userId, data: { type: 'offer', sdp: offer.sdp } });
            } catch { /* ignore */ }
          }, 800);
        }
      }
      if (st === 'connected' || st === 'completed') {
        pc._restarting = false;
      }
    };

    pc.onnegotiationneeded = async () => {
      try {
        if (pc.signalingState === 'stable') {
          await pc.setLocalDescription(await pc.createOffer());
          emit('call:signal', { callId, to: userId, data: { type: 'offer', sdp: pc.localDescription.sdp } });
        }
      } catch { /* ignore */ }
    };

    if (polite) {
      pc.onnegotiationneeded({ target: pc });
    } else {
      // impolite peer waits for the offer
    }
    return pc;
  }

  async _handleSignal(from, data) {
    if (!data || !this.state.call) return;
    const pc = this.pcs.get(from);
    if (!pc) return;

    try {
      if (data.type === 'offer') {
        await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        emit('call:signal', { callId: this.state.call.id, to: from, data: { type: 'answer', sdp: pc.localDescription.sdp } });
      } else if (data.type === 'answer') {
        if (pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
        }
      } else if (data.type === 'candidate') {
        try {
          await pc.addIceCandidate(data.candidate);
        } catch { /* raced candidate */ }
      }
    } catch (e) {
      // glare rollback for polite peer
      if (e.name === 'InvalidStateError' && pc._polite && pc.signalingState === 'have-local-offer') {
        try {
          await pc.setLocalDescription({ type: 'rollback' });
          await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          emit('call:signal', { callId: this.state.call.id, to: from, data: { type: 'answer', sdp: pc.localDescription.sdp } });
        } catch { /* ignore */ }
      }
    }
  }

  // -----------------------------------------------------------------
  // Quality adaptation
  // -----------------------------------------------------------------
  _startStatsLoop() {
    clearInterval(this._statsTimer);
    this._statsTimer = setInterval(async () => {
      try {
        let worst = { packetLoss: 0, rtt: 0, bitrate: 0 };
        for (const [userId, pc] of this.pcs) {
          const stats = await pc.getStats();
          let pl = 0;
          let tx = 0;
          let rx = 0;
          let lost = 0;
          for (const s of stats.values()) {
            if (s.type === 'inbound-rtp' && s.kind === 'video') {
              tx = (s.bytesReceived || 0) / 8;
              rx = s.bytesReceived || 0;
              if (s.packetsLost > (pc._lastLost || 0)) pl += s.packetsLost - (pc._lastLost || 0);
              if (s.packetsReceived > 0 && pc._lastReceived) {
                const periodLost = s.packetsLost - (pc._lastLost || 0);
                const periodTotal = s.packetsReceived - pc._lastReceived + periodLost;
                if (periodTotal > 0) worst.packetLoss = Math.max(worst.packetLoss, periodLost / periodTotal);
              }
              pc._lastLost = s.packetsLost;
              pc._lastReceived = s.packetsReceived;
            }
            if (s.type === 'candidate-pair' && s.state === 'succeeded') {
              worst.rtt = Math.max(worst.rtt, s.currentRoundTripTime * 1000 || 0);
            }
            if (s.type === 'outbound-rtp' && s.kind === 'video') {
              worst.bitrate = Math.max(worst.bitrate, s.bytesSent || 0);
            }
          }
        }
        const loss = worst.packetLoss;
        const rtt = worst.rtt;
        let rating = 'good';
        let tier = 0;
        if (loss > 0.15 || rtt > 900) {
          rating = 'poor';
          tier = 3;
        } else if (loss > 0.06 || rtt > 500) {
          rating = 'fair';
          tier = 2;
        } else if (loss > 0.02 || rtt > 250) {
          rating = 'fair';
          tier = 1;
        }
        this._applyBitrate(tier);
        this._set({ quality: { rating, packetLoss: Math.round(loss * 100) / 100, rtt: Math.round(rtt), bitrateKbps: Math.round(worst.bitrate / 1000) } });
      } catch { /* stats unavailable */ }
    }, 3000);
  }

  _applyBitrate(tier) {
    const maxBitrate = QUALITY_TIERS[tier];
    for (const pc of this.pcs.values()) {
      for (const sender of pc.getSenders()) {
        if (sender.track?.kind === 'video' && sender.track?.enabled) {
          const params = sender.getParameters();
          if (maxBitrate === null) {
            delete params.encodings?.[0]?.maxBitrate;
          } else {
            params.encodings = params.encodings?.length ? params.encodings : [{}];
            params.encodings[0].maxBitrate = maxBitrate;
          }
          if (params.degradationPreference !== 'maintain-framerate') {
            params.degradationPreference = 'balanced';
          }
          try {
            sender.setParameters(params);
          } catch { /* ignore */ }
        }
      }
    }
  }

  async requestFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { /* unsupported */ }
  }

  requestPip() {
    try {
      const vid = document.querySelector('.call-remote-video');
      if (vid && typeof vid.requestPictureInPicture === 'function') {
        if (document.pictureInPictureElement) document.exitPictureInPicture();
        else vid.requestPictureInPicture();
      }
    } catch { /* unsupported */ }
  }
}

let engine = null;

export function getCallEngine({ getConfig, getUser } = {}) {
  if (!engine && getConfig && getUser) engine = new CallEngine(getConfig, getUser);
  return engine;
}

export function resetCallEngine() {
  engine = null;
}

export function useCallEngine(getConfig, getUser) {
  const engine = getCallEngine({ getConfig, getUser });
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const unsubBus = engine.bus.on('call:state', () => setTick((t) => t + 1));
    const unsubSocket = onSocketEvent((event, data) => {
      if (event.startsWith('call:')) engine.handleEvent(event, data);
    });
    return () => {
      unsubBus();
      unsubSocket();
    };
  }, [engine]);
  return engine;
}