// In-app calls: ringing, answering, passing connection details, call log, relay settings.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'secureops-calls-'));
process.env.DATA_DIR = tmp;
process.env.CALL_RING_SECONDS = '1';
const { openDb } = await import('../server/db.js');
const { createServer } = await import('../server/server.js');

let server, base, db;
before(async () => {
  db = openDb(':memory:');
  server = createServer(db);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { streams.forEach(s => s.abort()); server.close(); server.closeAllConnections?.(); fs.rmSync(tmp, { recursive: true, force: true }); });

function client() {
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { cookie, 'X-Requested-With': 'SecureOps', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  return { cookie: () => cookie, get: u => call('GET', u), post: (u, b = {}) => call('POST', u, b), put: (u, b = {}) => call('PUT', u, b) };
}
const streams = [];
// Opens the live chat stream for a user and collects 'call' events.
async function listen(c) {
  const ctl = new AbortController(); streams.push(ctl);
  const res = await fetch(`${base}/api/chat/stream`, { headers: { cookie: c.cookie() }, signal: ctl.signal });
  const events = [];
  const waiters = [];
  (async () => {
    const reader = res.body.getReader(); let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += Buffer.from(value).toString();
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const type = chunk.match(/^event: (.*)$/m)?.[1]; const data = chunk.match(/^data: (.*)$/m)?.[1];
          if (type && data) { events.push({ type, ...JSON.parse(data) }); waiters.splice(0).forEach(w => w()); }
        }
      }
    } catch { /* aborted */ }
  })();
  const next = async (pred, ms = 3000) => {
    const t0 = Date.now();
    for (;;) {
      const i = events.findIndex(pred);
      if (i >= 0) return events.splice(i, 1)[0];
      if (Date.now() - t0 > ms) throw new Error('timed out waiting for event');
      await new Promise(r => { waiters.push(r); setTimeout(r, 100); });
    }
  };
  return { events, next };
}
const owner = client(), tess = client(), bo = client();
const ids = {};

test('setup', async () => {
  await owner.post('/api/auth/setup', { name: 'Olivia Owner', email: 'owner@example.com', password: 'password123', company_name: 'Call Co' });
  for (const [c, name, email] of [[tess, 'Tess Tech', 'tess@example.com'], [bo, 'Bo Tech', 'bo@example.com']]) {
    ids[name] = (await owner.post('/api/users', { name, email, password: 'password123', role: 'technician' })).data.id;
    await c.post('/api/auth/login', { email, password: 'password123' });
  }
});

test('a call rings, connects, passes connection details and is logged in the chat', async () => {
  const tl = await listen(tess), bl = await listen(bo);
  const r = await tess.post('/api/calls', { user_id: ids['Bo Tech'] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.online, true);
  const id = r.data.call.id;
  const ring = await bl.next(e => e.type === 'call' && e.action === 'ring');
  assert.equal(ring.call.caller_name, 'Tess Tech');
  // Push note for the phone, in case the app is closed
  assert.match(db.prepare('SELECT title FROM push_notes WHERE user_id = ? ORDER BY id DESC').get(ids['Bo Tech']).title, /Tess Tech is calling/);
  // Only the callee can answer; a third person can't touch it
  assert.equal((await tess.post(`/api/calls/${id}/answer`)).status, 403);
  assert.equal((await owner.post(`/api/calls/${id}/signal`, { data: { x: 1 } })).status, 404);
  assert.equal((await bo.post(`/api/calls/${id}/answer`, { device: 'phone1' })).status, 200);
  const ans = await tl.next(e => e.action === 'answered');
  assert.equal(ans.device, 'phone1');
  // Answering twice (another device) is refused
  assert.equal((await bo.post(`/api/calls/${id}/answer`, { device: 'laptop' })).status, 409);
  // Offer from the caller reaches the callee only
  await tess.post(`/api/calls/${id}/signal`, { data: { sdp: { type: 'offer', sdp: 'v=0 fake' } }, device: 'tessphone' });
  const sig = await bl.next(e => e.action === 'signal');
  assert.equal(sig.data.sdp.type, 'offer');
  assert.equal(sig.from, ids['Tess Tech']);
  assert.ok(!tl.events.some(e => e.action === 'signal'));
  await bo.post(`/api/calls/${id}/signal`, { data: { candidate: { candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host', sdpMid: '0' } } });
  assert.ok((await tl.next(e => e.action === 'signal')).data.candidate);
  // Too big / empty signals are refused
  assert.equal((await tess.post(`/api/calls/${id}/signal`, { data: 'x'.repeat(120000) })).status, 400);
  // Busy: someone else calling Bo now gets told
  const busy = await owner.post('/api/calls', { user_id: ids['Bo Tech'] });
  assert.equal(busy.status, 409);
  assert.match(busy.data.error, /on another call/);
  // Hang up → both told, chat log written
  await bo.post(`/api/calls/${id}/hangup`);
  const ended = await tl.next(e => e.action === 'ended');
  assert.equal(ended.call.status, 'ended');
  assert.equal(ended.by, ids['Bo Tech']);
  const log = db.prepare('SELECT body FROM chat_messages WHERE channel_id = ? ORDER BY id DESC').get(r.data.channel_id);
  assert.match(log.body, /📞 Call · 0:0\d/);
  assert.equal((await tess.post(`/api/calls/${id}/signal`, { data: { x: 1 } })).status, 409);
  // The call is in both people's direct chat
  const chans = (await bo.get('/api/chat/channels')).data;
  assert.ok(chans.some(c => c.id === r.data.channel_id && c.kind === 'direct'));
});

test('declined, cancelled and missed calls', async () => {
  const bl = await listen(bo), tl = await listen(tess);
  let r = await tess.post('/api/calls', { user_id: ids['Bo Tech'] });
  await bl.next(e => e.action === 'ring');
  await bo.post(`/api/calls/${r.data.call.id}/decline`);
  assert.equal((await tl.next(e => e.action === 'ended')).call.status, 'declined');
  assert.equal(db.prepare('SELECT body FROM chat_messages WHERE channel_id = ? ORDER BY id DESC').get(r.data.channel_id).body, '📞 Call declined');
  // Caller hangs up while ringing → cancelled (shows as a missed call)
  r = await tess.post('/api/calls', { user_id: ids['Bo Tech'] });
  await tess.post(`/api/calls/${r.data.call.id}/hangup`);
  assert.equal((await bl.next(e => e.action === 'ended' && e.call.id === r.data.call.id)).call.status, 'cancelled');
  // Nobody answers → missed after the ring time (1 s in tests), with a notification
  r = await tess.post('/api/calls', { user_id: ids['Bo Tech'] });
  const ended = await tl.next(e => e.action === 'ended' && e.call.id === r.data.call.id, 4000);
  assert.equal(ended.call.status, 'missed');
  assert.match(db.prepare('SELECT title FROM push_notes WHERE user_id = ? ORDER BY id DESC').get(ids['Bo Tech']).title, /Missed call from Tess Tech/);
  // Calling someone who isn't online still rings (notification), and says so
  const off = await bo.post('/api/calls', { user_id: ids['Olivia Owner'] ?? db.prepare("SELECT id FROM users WHERE email='owner@example.com'").get().id });
  assert.equal(off.data.online, false);
  await bo.post(`/api/calls/${off.data.call.id}/hangup`);
  // History
  const h = await tess.get('/api/calls/history');
  assert.ok(h.data.length >= 4);
  // Turned off → no calls
  await owner.put('/api/settings', { app_calls_enabled: '0' });
  assert.equal((await tess.post('/api/calls', { user_id: ids['Bo Tech'] })).status, 404);
  await owner.put('/api/settings', { app_calls_enabled: '1' });
  assert.equal((await tess.post('/api/calls', { user_id: ids['Tess Tech'] })).status, 400);
});

test('relay settings: none, own coturn, Twilio', async () => {
  let cfg = (await tess.get('/api/calls/config')).data;
  assert.equal(cfg.enabled, true);
  assert.deepEqual(cfg.ice, [{ urls: ['stun:stun.l.google.com:19302'] }]);
  // Own relay: time-limited username + HMAC password from the shared secret
  await owner.put('/api/settings', { app_call_relay: 'custom', turn_urls: 'turn:turn.example.com:3478', turn_secret: 's3cret' });
  assert.equal((await tess.get('/api/settings')).data.turn_secret, undefined); // never sent to the browser
  cfg = (await tess.get('/api/calls/config')).data;
  const turn = cfg.ice.find(s => String(s.urls).startsWith('turn:'));
  assert.ok(turn);
  assert.match(turn.username, /^\d+:\d+$/);
  assert.equal(turn.credential, crypto.createHmac('sha1', 's3cret').update(turn.username).digest('base64'));
  // Twilio relay (fake Twilio)
  let seen;
  const fake = http.createServer((req, res) => { let b = ''; req.on('data', d => { b += d; }); req.on('end', () => { seen = { url: req.url, auth: req.headers.authorization, body: b }; res.writeHead(201, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ice_servers: [{ urls: 'stun:global.stun.twilio.com:3478' }, { urls: 'turn:global.turn.twilio.com:3478?transport=udp', username: 'u1', credential: 'c1' }] })); }); });
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  process.env.TWILIO_API_BASE = `http://127.0.0.1:${fake.address().port}`;
  try {
    await owner.put('/api/settings', { app_call_relay: 'twilio', twilio_sid: 'AC123', twilio_token: 'tok', app_call_stun: '' });
    cfg = (await tess.get('/api/calls/config')).data;
    assert.equal(seen.url, '/2010-04-01/Accounts/AC123/Tokens.json');
    assert.equal(seen.auth, `Basic ${Buffer.from('AC123:tok').toString('base64')}`);
    assert.deepEqual(cfg.ice, [{ urls: 'turn:global.turn.twilio.com:3478?transport=udp', username: 'u1', credential: 'c1' }]);
  } finally { fake.close(); delete process.env.TWILIO_API_BASE; }
});
