// End-to-end smoke test of the Sparkline API (run from sparkline-build/server)
// Usage: node scripts/e2e.js [baseUrl]
const BASE = process.argv[2] || 'http://localhost:3000';

let failures = 0;
function check(name, cond, extra) {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${extra ? ` — ${JSON.stringify(extra)}` : ''}`);
  }
}

async function req(method, path, { token, body, raw } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

async function main() {
  console.log(`E2E against ${BASE}`);

  const a = await req('POST', '/api/onboard', { body: { displayName: 'Alice' } });
  check('onboard Alice', a.status === 200 && a.json.data.user.code.startsWith('SPK-'), a.json);
  const tokenA = a.json.data.token;

  const b = await req('POST', '/api/onboard', { body: { displayName: 'Bob', status: 'busy' } });
  check('onboard Bob', b.status === 200, b.json);
  const tokenB = b.json.data.token;
  const bob = b.json.data.user;

  const me = await req('GET', '/api/me', { token: tokenA });
  check('me', me.status === 200 && me.json.data.user.code === a.json.data.user.code);

  const bad = await req('GET', '/api/me', { token: 'spk_bogus' });
  check('bad token rejected', bad.status === 401);

  const nf = await req('GET', '/api/users/lookup?code=SPK-XXXXXX', { token: tokenA });
  check('invalid code -> not found', nf.status === 404);

  const lookup = await req('GET', `/api/users/lookup?code=${bob.code}`, { token: tokenA });
  check('lookup Bob', lookup.status === 200 && lookup.json.data.user.displayName === 'Bob', lookup.json);
  check('relationship none', lookup.json.data.relationship === 'none');

  const dup = await req('POST', '/api/connections', { token: tokenA, body: { code: bob.code } });
  check('request connection', dup.status === 200, dup.json);
  const dup2 = await req('POST', '/api/connections', { token: tokenA, body: { code: bob.code } });
  check('duplicate request rejected', dup2.status === 409);

  const conns = await req('GET', '/api/connections', { token: tokenA });
  check('pending request visible', conns.json.data.requested.length === 1, conns.json.data);

  const pending = conns.json.data.requested[0];
  const accept = await req('POST', `/api/connections/${pending.id}/accept`, { token: tokenB });
  check('accept connection', accept.status === 200, accept.json);

  const convsA = await req('GET', '/api/conversations', { token: tokenA });
  check('dm conversation auto-created', convsA.json.data.some((c) => c.type === 'dm' && c.peer?.displayName === 'Bob'), convsA.json);

  const dm = convsA.json.data.find((c) => c.type === 'dm');
  const msg = await req('POST', `/api/conversations/${dm.id}/messages`, { token: tokenA, body: { type: 'text', content: 'Hey Bob!' } });
  check('send message', msg.status === 200 && msg.json.data.message.content === 'Hey Bob!', msg.json);

  const msgsA = await req('GET', `/api/conversations/${dm.id}/messages`, { token: tokenA });
  check('fetch messages', msgsA.json.data.messages.length === 1);

  const edit = await req('PATCH', `/api/messages/${msg.json.data.message.id}`, { token: tokenA, body: { content: 'Hey Bob!!' } });
  check('edit message', edit.status === 200 && edit.json.data.message.edited === true);

  const react = await req('POST', `/api/messages/${msg.json.data.message.id}/reactions`, { token: tokenB, body: { emoji: '👍' } });
  check('react to message', react.status === 200 && react.json.data.message.reactions[0]?.count === 1, react.json);

  const save = await req('POST', `/api/messages/${msg.json.data.message.id}/save`, { token: tokenB, body: { save: true } });
  check('save message', save.status === 200 && save.json.data.saved === true);
  const saved = await req('GET', '/api/saved', { token: tokenB });
  check('saved list', saved.json.data.messages.length === 1);

  const grp = await req('POST', '/api/groups', { token: tokenA, body: { title: 'Team Rocket', description: 'testing' } });
  check('create group', grp.status === 200 && grp.json.data.conversation.inviteCode.startsWith('SPK-GROUP-'), grp.json);
  const group = grp.json.data.conversation;

  const join = await req('POST', '/api/groups/join', { token: tokenB, body: { code: group.inviteCode } });
  check('join group', join.status === 200 && join.json.data.alreadyMember === false, join.json);

  const gmsg = await req('POST', `/api/conversations/${group.id}/messages`, { token: tokenA, body: { type: 'text', content: 'Welcome to the group!' } });
  check('group message', gmsg.status === 200);

  const search = await req('GET', `/api/search?q=${encodeURIComponent('Bob')}`, { token: tokenA });
  check('search users', search.status === 200 && search.json.data.users.length >= 1, search.json);

  const searchMsg = await req('GET', `/api/search?q=${encodeURIComponent('Hey Bob')}`, { token: tokenA });
  check('search messages', searchMsg.status === 200 && searchMsg.json.data.messages.length >= 1);

  // calls
  const call = await req('POST', '/api/calls', { token: tokenA, body: { conversationId: dm.id, callType: 'audio' } });
  check('create call', call.status === 200 && call.json.data.call.status === 'ringing', call.json);

  // files
  const fd = new FormData();
  fd.append('conversationId', dm.id);
  fd.append('file', new Blob([Buffer.from('hello file')], { type: 'text/plain' }), 'notes.txt');
  const fileRes = await fetch(`${BASE}/api/files`, { method: 'POST', headers: { authorization: `Bearer ${tokenA}` }, body: fd });
  const fileJson = await fileRes.json();
  check('upload file', fileRes.status === 200 && fileJson.data.id, fileJson);
  const fmsg = await req('POST', `/api/conversations/${dm.id}/messages`, { token: tokenA, body: { type: 'file', attachment: { id: fileJson.data.id, name: 'notes.txt' } } });
  check('file message', fmsg.status === 200 && fmsg.json.data.message.attachment?.name === 'notes.txt', fmsg.json);

  const dl = await fetch(`${BASE}/files/${fileJson.data.id}?t=${tokenB}`);
  check('file download by recipient', dl.status === 200 && (await dl.text()) === 'hello file', dl.status);

  const dlOther = await fetch(`${BASE}/files/${fileJson.data.id}?t=${tokenB}`);
  const stranger = await req('POST', '/api/onboard', { body: { displayName: 'Stranger' } });
  const dlStranger = await fetch(`${BASE}/files/${fileJson.data.id}?t=${stranger.json.data.token}`);
  check('stranger cannot access file', dlStranger.status === 403, dlStranger.status);

  // admin
  const adminKey = process.env.E2E_ADMIN_KEY;
  if (adminKey) {
    const login = await req('POST', '/api/admin/login', { body: { key: adminKey } });
    check('admin login', login.status === 200 && login.json.data.token?.startsWith('spkx_'), login.json);
    const at = login.json.data.token;
    const overview = await req('GET', '/api/admin/overview', { token: at });
    check('admin overview', overview.status === 200 && overview.json.data.users >= 3, overview.json);
    const users = await req('GET', '/api/admin/users?q=Bob', { token: at });
    check('admin users search', users.status === 200 && users.json.data.users.length === 1);
    const ban = await req('POST', `/api/admin/users/${stranger.json.data.user.id}/ban`, { token: at });
    check('ban user', ban.status === 200 && ban.json.data.banned === true);
    const strangerMe = await req('GET', '/api/me', { token: stranger.json.data.token });
    check('banned session killed', strangerMe.status === 401);
    const unban = await req('POST', `/api/admin/users/${stranger.json.data.user.id}/unban`, { token: at });
    check('unban user', unban.status === 200);
  } else {
    console.log('  skip admin tests (set E2E_ADMIN_KEY)');
  }

  // blocks
  const block = await req('POST', `/api/connections/${pending.id}/block`, { token: tokenA, body: { userId: bob.id } });
  // pending connection was accepted; use bob id block
  check('block user', block.status === 200 && block.json.data.blocked === true);
  const msgAfterBlock = await req('POST', `/api/conversations/${dm.id}/messages`, { token: tokenA, body: { type: 'text', content: 'x' } });
  check('dm blocked -> cannot message', msgAfterBlock.status !== 200);
  const unblock = await req('POST', `/api/connections/${pending.id}/unblock`, { token: tokenA, body: { userId: bob.id } });
  check('unblock user', unblock.status === 200);

  // groups via invite code & leave
  const leave = await req('POST', `/api/conversations/${group.id}/leave`, { token: tokenB });
  check('leave group', leave.status === 200 && leave.json.data.left === true);

  // report
  const report = await req('POST', '/api/report', { token: tokenA, body: { targetType: 'user', targetId: bob.id, reason: 'spam' } });
  check('report', report.status === 200);

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('E2E crashed:', e);
  process.exit(1);
});
