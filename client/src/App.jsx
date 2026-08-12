import React, { useEffect, useRef, useState } from 'react';
import { useApp } from './lib/store.jsx';
import { api } from './lib/api.js';
import { useRoute, navigate, matchRoute } from './lib/router.js';
import { useCallEngine } from './lib/calls.js';
import { timeAgo, lastActiveLabel, formatSize, formatDuration, initials, formatCode, isValidCode } from './lib/format.js';
import { qrScanSupported, copyText, detectDevice } from './lib/device.js';
import { ChatWindow } from './components/ChatWindow.jsx';
import { Avatar, Drawer, Modal, Tabs, Switch, Spinner, EmptyState, SkeletonList, Toasts } from './components/ui.jsx';
import {
  IconChat, IconUsers, IconSearch, IconPlus, IconQR, IconSettings, IconStar, IconPhone,
  IconBack, IconLogo, IconBolt, IconShield, IconZap, IconShare, IconHash, IconX,
  IconGlobe, IconKey, IconLock, IconCheck, IconBell, IconLogout, IconMoon, IconSun,
  IconInfo, IconActivity, IconMic, IconVideo, IconMore, IconChevron,
} from './components/icons.jsx';

// ===========================================================================
// Splash
// ===========================================================================
function Splash() {
  return (
    <div className="splash">
      <div className="splash-logo"><IconLogo /></div>
      <div className="spinner" />
    </div>
  );
}

// ===========================================================================
// Landing / Onboarding
// ===========================================================================
function Landing({ onEntered }) {
  const { state, login, toast, setTheme } = useApp();
  const [name, setName] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [nameError, setNameError] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [joinError, setJoinError] = useState('');
  const [joinInfo, setJoinInfo] = useState(null);
  const [joinBusy, setJoinBusy] = useState(false);
  const nameRef = useRef(null);

  const isDark = state.theme === 'dark' || (state.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const onboard = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError('Pick a name to get your code');
      nameRef.current?.focus();
      return null;
    }
    setCreating(true);
    try {
      const data = await api('/onboard', { method: 'POST', body: { displayName: trimmed, status: status.trim() } });
      login(data.user, data.token);
      onEntered?.();
      toast(`Your code is ${data.user.code} — share it!`, 'success');
      return data.user;
    } catch (e) {
      toast(e.message, 'error');
      return null;
    } finally {
      setCreating(false);
    }
  };

  const joinWithCode = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError('Pick a name first');
      nameRef.current?.focus();
      return;
    }
    if (!isValidCode(joinCode)) {
      setJoinError('Enter a full code — like SPK-8F2KQ7');
      return;
    }
    setJoinBusy(true);
    setJoinError('');
    try {
      const data = await api('/onboard', { method: 'POST', body: { displayName: trimmed, status: status.trim() } });
      login(data.user, data.token);
      onEntered?.();
      let name = null;
      try {
        const found = await api(`/users/lookup?code=${encodeURIComponent(joinCode)}`);
        name = found?.user?.displayName || null;
      } catch { /* code not found — connect will confirm */ }
      setJoinInfo({ code: joinCode, displayName: name });
      await api('/connections', { method: 'POST', body: { code: joinCode } });
      toast(name ? `Request sent to ${name} — they'll see it when online` : `Request sent to ${joinCode} — they'll see it when online`, 'success');
      setJoinCode('');
      setTimeout(() => setJoinInfo(null), 4000);
    } catch (e) {
      setJoinError(e.message);
    } finally {
      setJoinBusy(false);
    }
  };

  return (
    <div className="landing">
      <div className="hero-glow hero-glow-a" />
      <div className="hero-glow hero-glow-b" />

      <nav className="landing-nav">
        <div className="brand"><IconLogo /> <span>Sparkline</span></div>
        <span className="badge badge-green">No signup</span>
        <span className="spacer" />
        <span className="badge version-badge">v1.0</span>
        <button
          className="btn btn-icon theme-toggle"
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          onClick={() => setTheme(isDark ? 'light' : 'dark')}
        >
          {isDark ? <IconSun /> : <IconMoon />}
        </button>
      </nav>

      <header className="hero">
        <div className="hero-copy rise rise-1">
          <div className="eyebrow"><span className="pulse-dot" /> Chat, call &amp; share — without an account</div>
          <h1>Connect instantly.<br /><span className="grad">Talk freely.</span></h1>
          <p className="lead">
            One simple code. No email, no phone, no password — just pick a name and
            start chatting, calling or video calling in seconds.
          </p>

          <div className="connect-card">
            <div className="input input-icon" style={{ maxWidth: 340 }}>
              <IconBolt />
              <input
                ref={nameRef}
                placeholder="Your display name"
                value={name}
                maxLength={60}
                aria-label="Display name"
                aria-invalid={!!nameError}
                className={nameError ? 'has-error' : ''}
                onChange={(e) => { setName(e.target.value); if (nameError) setNameError(''); }}
                onKeyDown={(e) => e.key === 'Enter' && !creating && onboard()}
              />
            </div>
            <button className="btn btn-lg btn-gradient" onClick={onboard} disabled={creating}>
              {creating ? <span className="spinner spinner-sm" /> : null}
              {creating ? 'Creating…' : 'Get your code'}
            </button>
            {nameError && <p className="field-error" role="alert"><IconInfo /> {nameError}</p>}
          </div>

          <div className="join-card">
            <div className="join-head"><span className="join-ico"><IconHash /></span><span>Already have a code? <b>Join a friend</b></span></div>
            <div className="join-row">
              <input
                className={`input input-code ${joinError ? 'has-error' : ''}`}
                placeholder="SPK-XXXXXX"
                value={joinCode}
                onChange={(e) => { setJoinCode(formatCode(e.target.value)); if (joinError) setJoinError(''); }}
                onKeyDown={(e) => e.key === 'Enter' && !joinBusy && joinWithCode()}
                aria-label="Friend's Sparkline code"
              />
              <button className="btn btn-outline" onClick={joinWithCode} disabled={joinBusy || !isValidCode(joinCode)}>
                {joinBusy ? <span className="spinner spinner-sm" /> : null}
                {joinBusy ? 'Joining…' : 'Join'}
              </button>
            </div>
            {joinInfo?.displayName && <p className="join-hint"><IconCheck /> Found {joinInfo.displayName} — ready to connect</p>}
            {joinError && <p className="field-error" role="alert"><IconInfo /> {joinError}</p>}
          </div>

          <div className="trust-row">
            <span className="trust-chip"><IconCheck /> 100% free</span>
            <span className="trust-chip"><IconKey /> No password to forget</span>
            <span className="trust-chip"><IconLock /> Private by design</span>
          </div>
        </div>

        <div className="hero-mock-wrap rise rise-2">
          <div className="hero-mock">
            <div className="mock-chat">
              <div className="mock-row">
                <span className="mock-avatar">A</span>
                <div className="mock-bubble">Hey! I just got my Sparkline code 🚀</div>
              </div>
              <div className="mock-row me">
                <div className="mock-bubble">What's your code?</div>
              </div>
              <div className="mock-row">
                <span className="mock-avatar">A</span>
                <div className="mock-bubble"><b>SPK-8F2KQ7</b></div>
              </div>
              <div className="mock-row me">
                <div className="mock-bubble">Nice, connecting now… <span className="mock-ticks">✓✓</span></div>
              </div>
              <div className="mock-row">
                <span className="mock-avatar">A</span>
                <div className="mock-bubble mock-typing"><span /><span /><span /></div>
              </div>
            </div>
            <div className="mock-callbar">
              <span className="mock-avatar" style={{ width: 34, height: 34 }}>A</span>
              <span className="mock-call-name">Amira</span>
              <span className="grow" />
              <span className="call-dot" />
              <span className="call-timer">0:12</span>
              <IconMic /><IconVideo /><IconPhone className="end" />
            </div>
          </div>
        </div>
      </header>

      <section className="section" id="how">
        <div className="section-head rise">
          <span className="section-kicker">How it works</span>
          <h2>Three steps. Zero friction.</h2>
          <p>From first visit to first message in under a minute.</p>
        </div>
        <div className="steps">
          <div className="step rise"><span className="step-icon"><IconKey /></span><h3>Get your code</h3><p>A unique code like SPK-8F2KQ7, generated for you instantly.</p></div>
          <div className="step rise"><span className="step-icon"><IconShare /></span><h3>Share it</h3><p>Send your code to friends — or scan a QR code in person.</p></div>
          <div className="step rise"><span className="step-icon"><IconPhone /></span><h3>Talk</h3><p>Chat, send files, voice messages, GIFs and make calls.</p></div>
        </div>
      </section>

      <section className="section" style={{ background: 'var(--surface-2)' }}>
        <div className="section-head rise">
          <span className="section-kicker">Why Sparkline</span>
          <h2>Privacy-first by design</h2>
          <p>Built for people who value their time and their data.</p>
        </div>
        <div className="feature-grid">
          <div className="feature rise"><span className="f-icon f-a"><IconShield /></span><h3>No accounts, no passwords</h3><p>Sessions work through secure codes — nothing to remember, nothing to lose.</p></div>
          <div className="feature rise"><span className="f-icon f-b"><IconZap /></span><h3>Fast &amp; lightweight</h3><p>Real-time messaging over WebSockets — responsive even on slow connections.</p></div>
          <div className="feature rise"><span className="f-icon f-c"><IconGlobe /></span><h3>Your server, your rules</h3><p>Run Sparkline on your own infrastructure with a single command.</p></div>
          <div className="feature rise"><span className="f-icon f-d"><IconLock /></span><h3>Encrypted in transit</h3><p>All traffic is TLS-protected; your data stays on your server.</p></div>
        </div>
      </section>

      <section className="section">
        <div className="cta-card rise">
          <div className="cta-inner">
            <h2>Ready to talk?</h2>
            <p>Get your code below and bring someone with you. That's all it takes.</p>
            <button className="btn btn-lg btn-gradient" onClick={() => { nameRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); nameRef.current?.focus(); }}>
              <IconBolt /> Get your code
            </button>
          </div>
        </div>
      </section>

      <footer className="landing-footer">
        <span>Sparkline — open-source, self-hosted messaging.</span>
        <span className="spacer" />
        <span>Made for people who value their time and their data.</span>
      </footer>
    </div>
  );
}

// ===========================================================================
// Chat list (desktop sidebar + mobile home)
// ===========================================================================
function ChatList({ onOpenChat }) {
  const { state } = useApp();
  const [q, setQ] = useState('');
  const list = state.conversations;

  const filtered = q.trim()
    ? list.filter((c) => (c.title || c.peer?.displayName || '').toLowerCase().includes(q.trim().toLowerCase()))
    : list;

  const summary = (c) => {
    const lm = c.lastMessage;
    if (!lm) return c.type === 'saved' ? 'Your saved messages live here' : c.type === 'group' ? 'No messages yet' : 'Say hello 👋';
    const me = state.user?.id;
    const who = lm.senderId === me ? 'You: ' : c.type === 'group' ? `${lm.senderName || 'Member'}: ` : '';
    if (lm.deleted) return `${who}Message deleted`;
    if (lm.type === 'text') return `${who}${lm.content}`;
    const map = { image: '📷 Photo', video: '🎬 Video', voice: '🎤 Voice message', audio: '🎵 Audio', file: '📎 File', system: lm.content };
    return `${who}${map[lm.type] || lm.type}`;
  };

  return (
    <div className="pane pane-list">
      <div className="page-head">
        <h1 style={{ fontSize: 20 }}>Chats</h1>
        <span className="grow" />
        <button className="btn btn-icon" onClick={() => navigate('/connections')} aria-label="Connections"><IconUsers /></button>
        <button className="btn btn-icon" onClick={() => navigate('/settings')} aria-label="Settings"><IconSettings /></button>
      </div>
      <div className="conv-search">
        <div className="conv-search-wrap">
          <IconSearch style={{ position: 'absolute', left: 10, top: 9, width: 16, height: 16, color: 'var(--text-3)' }} />
          <input className="input" placeholder="Search chats…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="conv-list">
        {!state.conversationsLoaded ? (
          <SkeletonList rows={6} />
        ) : filtered.length === 0 ? (
          <div className="empty" style={{ padding: 40 }}>
            <div className="empty-icon"><IconChat /></div>
            <h3>{q ? 'No chats found' : 'No chats yet'}</h3>
            <p>Connect with someone using their Sparkline code.</p>
            <button className="btn btn-primary" onClick={() => navigate('/new')}>Find people</button>
          </div>
        ) : (
          filtered.map((c) => {
            const unread = (c.unreadCount || 0) > 0;
            const peer = c.type === 'group' ? null : c.peer;
            return (
              <button key={c.id} className={`conv-item ${unread ? 'unread' : ''}`} onClick={() => onOpenChat(c.id)}>
                <Avatar user={peer} name={c.title || peer?.displayName} size={46} online={!!peer && !!state.presence[peer.id]?.online} />
                <div className="meta">
                  <div className="row1">
                    <span className="title">{c.type === 'saved' ? 'Saved Messages' : c.title || peer?.displayName || 'Group'}</span>
                    <span className="time">{c.lastMessage ? timeAgo(c.lastMessage.createdAt) : ''}</span>
                  </div>
                  <div className="last">{summary(c)}</div>
                </div>
                {unread && <span className="counter">{unread}</span>}
              </button>
            );
          })
        )}
      </div>
      <button className="fab" onClick={() => navigate('/new')} aria-label="New chat"><IconPlus /></button>
    </div>
  );
}

// ===========================================================================
// New chat (search people, codes, QR, groups)
// ===========================================================================
function NewChat({ onOpenChat }) {
  const { state, toast } = useApp();
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [code, setCode] = useState('');
  const [codeStatus, setCodeStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [groupTitle, setGroupTitle] = useState('');
  const [groupInvite, setGroupInvite] = useState('');
  const [groupInviteInput, setGroupInviteInput] = useState('');
  const [tab, setTab] = useState('people');
  const [scanSupported, setScanSupported] = useState(false);
  const scanTimer = useRef(null);

  useEffect(() => {
    qrScanSupported().then(setScanSupported);
    return () => clearTimeout(scanTimer.current);
  }, []);

  const search = async (v) => {
    setQ(v);
    if (v.trim().length < 2) return setResults([]);
    try {
      const data = await api(`/search?q=${encodeURIComponent(v.trim())}`);
      setResults(data.users || []);
    } catch { /* ignore */ }
  };

  const connect = async (user) => {
    try {
      await api('/connections', { method: 'POST', body: { code: user.code } });
      toast(`Request sent to ${user.displayName}`, 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const connectByCode = async () => {
    if (!isValidCode(code)) {
      setCodeStatus({ kind: 'error', text: 'Enter a full code — like SPK-8F2KQ7' });
      return;
    }
    setBusy(true);
    setCodeStatus(null);
    try {
      const { connectionId } = await api('/connections', { method: 'POST', body: { code } });
      let name = null;
      try {
        const found = await api(`/users/lookup?code=${encodeURIComponent(code)}`);
        name = found?.user?.displayName || null;
      } catch { /* ignore */ }
      setCodeStatus({ kind: 'ok', text: name ? `Request sent to ${name} — waiting for them to accept` : 'Request sent — waiting for them to accept' });
      setCode('');
    } catch (e) {
      setCodeStatus({ kind: 'error', text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const createGroup = async () => {
    if (!groupTitle.trim()) return toast('Enter a group name', 'error');
    setBusy(true);
    try {
      const data = await api('/groups', { method: 'POST', body: { title: groupTitle.trim() } });
      toast('Group created — share its invite code', 'success');
      setGroupInvite(data.conversation.inviteCode);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const joinGroup = async () => {
    const code = groupInvite.trim();
    if (!code) return toast('Enter a group invite code', 'error');
    setBusy(true);
    try {
      const data = await api('/groups/join', { method: 'POST', body: { code } });
      toast('Joined the group', 'success');
      setGroupInvite('');
      onOpenChat(data.conversation.id);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const myCode = state.user?.code || '';

  return (
    <div className="pane pane-list">
      <div className="page-head">
        <button className="btn btn-icon" onClick={() => navigate('/app')} aria-label="Back"><IconBack /></button>
        <h1 style={{ fontSize: 18 }}>New chat</h1>
      </div>

      <div className="conv-search">
        <button className="code-chip" onClick={() => copyText(myCode).then(() => toast('Code copied', 'success'))} title="Click to copy your code">
          <IconHash /> {myCode} <IconCopyMini />
        </button>
      </div>

      <Tabs
        className="conv-search"
        tabs={[
          { key: 'people', label: 'People' },
          { key: 'code', label: 'Code' },
          { key: 'group', label: 'Groups' },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div className="conv-list">
        {tab === 'people' && (
        <div className="stack" style={{ padding: 12 }}>
          <input className="input" placeholder="Search by name or code…" value={q} onChange={(e) => search(e.target.value)} />

          {results.map((u) => {
            const rel = u.relationship;
            const accepted = rel === 'accepted';
            const conv = state.conversations.find((c) => c.peer?.id === u.id);
            return (
              <div className="list-item" key={u.id}>
                <Avatar user={u} size={42} online={u.online} />
                <div className="grow">
                  <b>{u.displayName}</b>
                  <span className="text-2" style={{ display: 'block', fontSize: 12.5 }}>{u.status || `@${u.code}`}</span>
                </div>
                {accepted ? (
                  <button className="btn btn-sm btn-primary" onClick={() => onOpenChat(conv?.id)}>Chat</button>
                ) : rel === 'pending' ? (
                  <span className="badge">Pending</span>
                ) : rel === 'requested' ? (
                  <span className="badge">Requested</span>
                ) : rel === 'blocked' ? (
                  <span className="badge badge-red">Blocked</span>
                ) : (
                  <button className="btn btn-sm" onClick={() => connect(u)}>Connect</button>
                )}
              </div>
            );
          })}

          {q.trim().length >= 2 && results.length === 0 && (
            <div className="empty" style={{ padding: 24 }}><p>No people found</p></div>
          )}
        </div>
        )}

        {tab === 'code' && (
          <div className="stack" style={{ padding: 12 }}>
            <div className="flex" style={{ gap: 8 }}>
              <input
                className={`input input-code grow ${codeStatus?.kind === 'error' ? 'has-error' : ''}`}
                placeholder="SPK-XXXXXX"
                value={code}
                onChange={(e) => { setCode(formatCode(e.target.value)); if (codeStatus) setCodeStatus(null); }}
                onKeyDown={(e) => e.key === 'Enter' && !busy && connectByCode()}
              />
              <button className="btn btn-primary" onClick={connectByCode} disabled={busy || !isValidCode(code)}>Send</button>
            </div>
            {codeStatus?.kind === 'ok' && <p className="join-hint"><IconCheck /> {codeStatus.text}</p>}
            {codeStatus?.kind === 'error' && <p className="field-error" role="alert"><IconInfo /> {codeStatus.text}</p>}
            <button className="btn btn-outline" onClick={() => copyText(myCode).then(() => toast('Your code copied — share it!', 'success'))}>
              <IconShare /> Share my code: <b>{myCode}</b>
            </button>
          </div>
        )}

        {tab === 'group' && (
          <div className="stack" style={{ padding: 12 }}>
            <input className="input" placeholder="New group name…" value={groupTitle} onChange={(e) => setGroupTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && createGroup()} />
            <button className="btn btn-primary" onClick={createGroup} disabled={busy}>Create group</button>
            {groupInvite && (
              <div className="card" style={{ padding: 12 }}>
                <p className="muted" style={{ margin: '0 0 8px' }}>Share this invite code so people can join:</p>
                <div className="flex" style={{ gap: 8 }}>
                  <code className="code-chip" style={{ fontSize: 15 }}>{groupInvite}</code>
                  <button className="btn btn-sm" onClick={() => copyText(groupInvite).then(() => toast('Invite code copied', 'success'))}><IconCopyMini /> Copy</button>
                </div>
              </div>
            )}
            <hr className="sep" />
            <div className="flex" style={{ gap: 8 }}>
              <input className="input grow" placeholder="Join with invite code…" value={groupInviteInput} onChange={(e) => setGroupInviteInput(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === 'Enter' && joinGroup()} />
              <button className="btn" onClick={joinGroup} disabled={busy}>Join</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function IconCopyMini() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

// ===========================================================================
// Connections
// ===========================================================================
function ConnectionsPage({ onOpenChat }) {
  const { state, toast } = useApp();
  const [tab, setTab] = useState('accepted');
  const { accepted, pending, requested } = state.connections;

  const act = async (path, method, ok) => {
    try {
      await api(path, { method });
      toast(ok, 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const rows = tab === 'accepted' ? accepted : tab === 'pending' ? pending : requested;
  const title = tab === 'accepted' ? 'Connections' : tab === 'pending' ? 'Incoming requests' : 'Sent requests';

  return (
    <div className="pane pane-list">
      <div className="page-head">
        <button className="btn btn-icon" onClick={() => navigate('/app')} aria-label="Back"><IconBack /></button>
        <h1 style={{ fontSize: 18 }}>{title}</h1>
      </div>
      <Tabs
        className="conv-search"
        tabs={[
          { key: 'accepted', label: `Contacts (${accepted.length})` },
          { key: 'pending', label: `Incoming (${pending.length})` },
          { key: 'requested', label: `Sent (${requested.length})` },
        ]}
        active={tab}
        onChange={setTab}
      />
      <div className="conv-list">
        {rows.length === 0 ? (
          <EmptyState icon={<IconUsers />} title="Nothing here" text={tab === 'pending' ? 'No incoming requests.' : 'Find people via the New chat screen.'} />
        ) : (
          rows.map((c) => {
            const conv = state.conversations.find((x) => x.peer?.id === c.user.id);
            return (
              <div className="list-item" key={c.id}>
                <Avatar user={c.user} size={44} online={!!state.presence[c.user.id]?.online} />
                <div className="grow">
                  <b>{c.user.displayName}</b>
                  <span className="text-2" style={{ display: 'block', fontSize: 12.5 }}>{c.user.status || `@${c.user.code}`}</span>
                </div>
                {tab === 'accepted' && (
                  <>
                    <button className="btn btn-sm btn-primary" onClick={() => onOpenChat(conv?.id)}>Chat</button>
                    <button className="btn btn-sm" onClick={() => act(`/connections/${c.id}/remove`, 'POST', 'Connection removed')}>Remove</button>
                  </>
                )}
                {tab === 'pending' && (
                  <>
                    <button className="btn btn-sm btn-primary" onClick={() => act(`/connections/${c.id}/accept`, 'POST', 'Accepted')}>Accept</button>
                    <button className="btn btn-sm" onClick={() => act(`/connections/${c.id}/decline`, 'POST', 'Declined')}>Decline</button>
                  </>
                )}
                {tab === 'requested' && (
                  <button className="btn btn-sm" onClick={() => act(`/connections/${c.id}/cancel`, 'POST', 'Request cancelled')}>Cancel</button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// Saved messages
// ===========================================================================
function SavedPage() {
  const { state } = useApp();
  const savedConv = state.conversations.find((c) => c.type === 'saved');
  if (!savedConv) return <div className="pane pane-list"><div className="page-head"><button className="btn btn-icon" onClick={() => navigate('/app')}><IconBack /></button><h1>Saved</h1></div><Spinner /></div>;
  return (
    <div className="pane pane-chat">
      <ChatWindow conversation={savedConv} onBack={() => navigate('/app')} />
    </div>
  );
}

// ===========================================================================
// Call history
// ===========================================================================
function CallsPage() {
  const { state } = useApp();
  const engine = useCallEngine(() => state.config, () => state.user);
  const calls = state.callHistory;

  const callRow = (c) => {
    const peer = c.user;
    return (
      <div className="list-item" key={c.id}>
        <Avatar user={peer} size={42} online={!!state.presence[peer?.id]?.online} />
        <div className="grow">
          <b>{peer?.displayName || 'Unknown'}</b>
          <span className="text-2" style={{ display: 'block', fontSize: 12.5 }}>
            {c.callType === 'video' ? '🎥' : '📞'} {c.status} · {timeAgo(c.createdAt)}
          </span>
        </div>
        <button className="btn btn-icon" onClick={() => engine?.startCall(c.conversationId, c.callType === 'video' ? 'video' : 'audio')} aria-label="Call again">
          <IconPhone />
        </button>
      </div>
    );
  };

  return (
    <div className="pane pane-list">
      <div className="page-head">
        <button className="btn btn-icon" onClick={() => navigate('/app')} aria-label="Back"><IconBack /></button>
        <h1 style={{ fontSize: 18 }}>Call history</h1>
      </div>
      <div className="conv-list">
        {calls.length === 0 ? (
          <EmptyState icon={<IconPhone />} title="No calls yet" text="Your voice and video calls will show up here." />
        ) : (
          calls.map(callRow)
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// Settings
// ===========================================================================
function SettingsPage() {
  const { state, setTheme, logout, toast } = useApp();
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(state.user?.displayName || '');
  const [statusText, setStatusText] = useState(state.user?.status || '');
  const [about, setAbout] = useState(state.user?.about || '');

  const saveProfile = async () => {
    try {
      const data = await api('/me', { method: 'PATCH', body: { displayName: name.trim(), status: statusText.trim(), about: about.trim() } });
      toast('Profile updated', 'success');
      setEditingName(false);
      return data;
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <div className="pane pane-list">
      <div className="page-head">
        <button className="btn btn-icon" onClick={() => navigate('/app')} aria-label="Back"><IconBack /></button>
        <h1 style={{ fontSize: 18 }}>Settings</h1>
      </div>
      <div className="conv-list">
        <div className="info-profile">
          <Avatar user={state.user} size={80} />
          <h3>{state.user?.displayName}</h3>
          <p className="text-3">My code: <b className="code-chip" style={{ cursor: 'pointer' }} onClick={() => copyText(state.user?.code).then(() => toast('Code copied', 'success'))}>@{state.user?.code}</b></p>
          {state.user?.status && <p className="text-2" style={{ margin: 0 }}>{state.user.status}</p>}
        </div>

        <div className="setting-row">
          <span className="grow"><b>Display name</b></span>
          {editingName ? (
            <div className="stack" style={{ alignItems: 'flex-end', gap: 6 }}>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
              <div className="flex" style={{ gap: 6 }}>
                <button className="btn btn-sm btn-primary" onClick={saveProfile}>Save</button>
                <button className="btn btn-sm" onClick={() => setEditingName(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <button className="btn btn-sm" onClick={() => { setName(state.user?.displayName || ''); setEditingName(true); }}>Edit</button>
          )}
        </div>
        <div className="setting-row">
          <span className="grow"><b>Status</b><span className="text-3" style={{ display: 'block' }}>{statusText || 'Not set'}</span></span>
          <input className="input" style={{ maxWidth: 200 }} placeholder="Your status…" value={statusText} onChange={(e) => setStatusText(e.target.value)} onBlur={saveProfile} />
        </div>
        <div className="setting-row">
          <span className="grow"><b>About</b><span className="text-3" style={{ display: 'block' }}>{about || 'Not set'}</span></span>
          <input className="input" style={{ maxWidth: 200 }} placeholder="About you…" value={about} onChange={(e) => setAbout(e.target.value)} onBlur={saveProfile} />
        </div>

        <div className="setting-row">
          <span className="grow"><b>Appearance</b><span className="text-3" style={{ display: 'block' }}>{state.theme}</span></span>
          <Tabs
            tabs={[
              { key: 'light', label: 'Light' },
              { key: 'dark', label: 'Dark' },
              { key: 'system', label: 'System' },
            ]}
            active={state.theme}
            onChange={setTheme}
          />
        </div>

        <div className="setting-row">
          <span className="grow"><b>My code</b><span className="text-3" style={{ display: 'block' }}>Share to connect</span></span>
          <button className="btn btn-sm" onClick={() => copyText(state.user?.code).then(() => toast('Code copied', 'success'))}><IconShare /> Copy</button>
        </div>

        <div className="setting-row">
          <span className="grow"><b>Account</b><span className="text-3" style={{ display: 'block' }}>Sign out of this device</span></span>
          <button className="btn btn-danger" onClick={logout}><IconLogout /> Sign out</button>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Call overlay (incoming + active)
// ===========================================================================
function CallOverlay() {
  const { state } = useApp();
  const engine = useCallEngine(() => state.config, () => state.user);
  const [call, setCall] = useState(null);

  useEffect(() => {
    if (!engine) return;
    const unsub = engine.subscribe(setCall);
    return unsub;
  }, [engine]);

  if (!call || call.phase === 'idle') return null;

  const peer = call.call?.conversationId
    ? state.conversations.find((c) => c.id === call.call.conversationId)?.peer
    : null;
  const displayName = peer?.displayName || 'Sparkline call';

  if (call.phase === 'ringing-in') {
    return (
      <div className="call-overlay">
        <div className="call-top">
          <button className="btn btn-icon" style={{ color: '#fff' }} onClick={() => engine.rejectCall(call.call)} aria-label="Decline">
            <IconX />
          </button>
          <span style={{ color: '#fff', fontWeight: 600 }}>Incoming call</span>
        </div>
        <div className="call-ring">
          <Avatar user={peer} name={displayName} size={110} showDot={false} />
          <h2 style={{ color: '#fff', margin: 0 }}>{displayName}</h2>
          <p style={{ color: 'rgba(255,255,255,0.7)', margin: 0 }}>
            {call.call?.callType === 'video' ? 'Video call' : 'Voice call'}
          </p>
          <div className="call-controls">
            <button className="call-btn danger" onClick={() => engine.rejectCall(call.call)} aria-label="Decline"><IconPhoneOff /></button>
            <button className="call-btn" onClick={() => engine.acceptCall(call.call)} aria-label="Accept"><IconPhone /></button>
          </div>
        </div>
      </div>
    );
  }

  if (call.phase === 'ringing-out' || call.phase === 'connecting') {
    return (
      <div className="call-overlay">
        <div className="call-top">
          <button className="btn btn-icon" style={{ color: '#fff' }} onClick={() => engine.cancelCall()} aria-label="Cancel">
            <IconX />
          </button>
          <span style={{ color: '#fff', fontWeight: 600 }}>{call.phase === 'ringing-out' ? 'Ringing…' : 'Connecting…'}</span>
        </div>
        <div className="call-ring">
          <Avatar user={peer} name={displayName} size={110} showDot={false} />
          <h2 style={{ color: '#fff', margin: 0 }}>{displayName}</h2>
          <p style={{ color: 'rgba(255,255,255,0.7)', margin: 0 }}>{call.call?.callType === 'video' ? 'Video call' : 'Voice call'}</p>
          <div className="call-controls">
            <button className="call-btn danger" onClick={() => engine.cancelCall()} aria-label="End"><IconPhoneOff /></button>
          </div>
        </div>
      </div>
    );
  }

  if (call.phase === 'active') {
    const remote = Object.values(call.remoteStreams || {})[0];
    const isVideo = call.call?.callType === 'video' || call.media?.cam;
    const seconds = Math.floor(call.durationMs / 1000);
    return (
      <div className="call-overlay">
        {isVideo && remote ? (
          <video className="call-remote-video" srcObject={remote} autoPlay playsInline />
        ) : (
          <div className="call-ring">
            <Avatar user={peer} name={displayName} size={110} showDot={false} />
            <h2 style={{ color: '#fff', margin: 0 }}>{displayName}</h2>
            <p style={{ color: 'rgba(255,255,255,0.7)', margin: 0 }}>{formatDuration(call.durationMs)}</p>
          </div>
        )}
        {call.localStream && isVideo && (
          <div className="call-self">
            <video srcObject={call.localStream} autoPlay playsInline muted />
          </div>
        )}
        <div className="call-controls">
          <button className={`call-btn ${call.media?.mic ? '' : 'off'}`} onClick={() => engine.toggleMic()} aria-label="Toggle microphone">
            {call.media?.mic ? <IconMic /> : <IconMicOff />}
          </button>
          {isVideo && (
            <button className={`call-btn ${call.media?.cam ? '' : 'off'}`} onClick={() => engine.toggleCam()} aria-label="Toggle camera">
              {call.media?.cam ? <IconVideo /> : <IconVideoOff />}
            </button>
          )}
          <button className="call-btn danger" onClick={() => engine.endCall()} aria-label="End call"><IconPhoneOff /></button>
        </div>
      </div>
    );
  }

  return null;
}

// ===========================================================================
// App shell
// ===========================================================================
function AppShell() {
  const route = useRoute();
  const { state } = useApp();
  const { segments, path } = matchRoute(route);
  const isDesktop = detectDevice().isDesktop;

  const activeConvId = segments[0] === 'app' && segments[1] ? decodeURIComponent(segments[1]) : null;
  const activeConv = activeConvId ? state.conversations.find((c) => c.id === activeConvId) : null;

  const openChat = (id) => navigate(`/app/${encodeURIComponent(id)}`);
  const back = () => navigate('/app');

  let pane = null;
  if (path === '/app' || (segments[0] === 'app' && !segments[1])) pane = <ChatList onOpenChat={openChat} />;
  else if (segments[0] === 'app' && segments[1]) pane = <ChatWindow key={activeConvId} conversation={activeConv} onBack={back} />;
  else if (segments[0] === 'new') pane = <NewChat onOpenChat={openChat} />;
  else if (segments[0] === 'connections') pane = <ConnectionsPage onOpenChat={openChat} />;
  else if (segments[0] === 'saved') pane = <SavedPage />;
  else if (segments[0] === 'calls') pane = <CallsPage />;
  else if (segments[0] === 'settings') pane = <SettingsPage />;
  else pane = <ChatList onOpenChat={openChat} />;

  return (
    <div className="app">
      <div className="sidebar">
        <div className="sidebar-nav">
          <button className={!segments[1] && path !== '/new' && path !== '/connections' && path !== '/settings' && path !== '/calls' && path !== '/saved' ? 'active' : ''} onClick={() => navigate('/app')} aria-label="Chats">
            <IconChat />
          </button>
          <button className={segments[0] === 'new' ? 'active' : ''} onClick={() => navigate('/new')} aria-label="New chat"><IconPlus /></button>
          <button className={segments[0] === 'connections' ? 'active' : ''} onClick={() => navigate('/connections')} aria-label="Connections"><IconUsers /></button>
          <button className={segments[0] === 'saved' ? 'active' : ''} onClick={() => navigate('/saved')} aria-label="Saved messages"><IconStar /></button>
          <button className={segments[0] === 'calls' ? 'active' : ''} onClick={() => navigate('/calls')} aria-label="Call history"><IconPhone /></button>
          <span className="grow" />
          <button className={segments[0] === 'settings' ? 'active' : ''} onClick={() => navigate('/settings')} aria-label="Settings"><IconSettings /></button>
        </div>
      </div>

      {pane}

      {isDesktop && segments[0] === 'app' && (
        <div className="pane pane-chat">
          {activeConv ? (
            <ChatWindow key={activeConv.id} conversation={activeConv} onBack={back} />
          ) : (
            <div className="chat-empty">
              <EmptyState icon={<IconChat />} title="Select a chat" text="Pick a conversation to start messaging." />
            </div>
          )}
        </div>
      )}

      <nav className="bottom-nav">
        <button className={segments[0] === 'app' || !segments[0] ? 'active' : ''} onClick={() => navigate('/app')} aria-label="Chats"><IconChat /><span>Chats</span></button>
        <button className={segments[0] === 'connections' ? 'active' : ''} onClick={() => navigate('/connections')} aria-label="Connections"><IconUsers /><span>People</span></button>
        <button className="fab-nav" onClick={() => navigate('/new')} aria-label="New chat"><IconPlus /></button>
        <button className={segments[0] === 'calls' ? 'active' : ''} onClick={() => navigate('/calls')} aria-label="Calls"><IconPhone /><span>Calls</span></button>
        <button className={segments[0] === 'settings' ? 'active' : ''} onClick={() => navigate('/settings')} aria-label="Settings"><IconSettings /><span>More</span></button>
      </nav>
    </div>
  );
}

// ===========================================================================
// Root
// ===========================================================================
export function App() {
  const { state } = useApp();

  useEffect(() => {
    if (state.booted && state.user) navigate('/app', { replace: true });
  }, [state.booted, state.user]);

  if (!state.booted) return <Splash />;

  return (
    <>
      {state.user ? <AppShell /> : <Landing />}
      <CallOverlay />
      <Toasts />
    </>
  );
}
