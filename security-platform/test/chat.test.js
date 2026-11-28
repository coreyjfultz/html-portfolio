// Team chat, live updates and push notifications.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'secureops-chat-'));
process.env.DATA_DIR = tmp;
const { openDb } = await import('../server/db.js');
const { createServer } = await import('../server/server.js');

let server, base, db;
before(async () => {
  db = openDb(':memory:');
  server = createServer(db);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.closeAllConnections?.(); server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

function client() {
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { cookie, 'X-Requested-With': 'SecureOps', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  return { cookie: () => cookie, get: u => call('GET', u), post: (u, b = {}) => call('POST', u, b), put: (u, b = {}) => call('PUT', u, b), del: u => call('DELETE', u) };
}
const owner = client(), tess = client(), bo = client(), sal = client();
const ids = {};

test('setup', async () => {
  await owner.post('/api/auth/setup', { name: 'Olivia Owner', email: 'owner@example.com', password: 'password123', company_name: 'Chat Co' });
  ids.tTess = (await owner.post('/api/r/technicians', { name: 'Tess' })).data.id;
  ids.tBo = (await owner.post('/api/r/technicians', { name: 'Bo' })).data.id;
  for (const [c, name, email, role, tech] of [[tess, 'Tess Tech', 'tess@example.com', 'technician', ids.tTess], [bo, 'Bo Tech', 'bo@example.com', 'technician', ids.tBo], [sal, 'Sal Sales', 'sal@example.com', 'sales', null]]) {
    ids[name] = (await owner.post('/api/users', { name, email, password: 'password123', role, technician_id: tech })).data.id;
    assert.equal((await c.post('/api/auth/login', { email, password: 'password123' })).status, 200);
  }
});

test('everyone channel: post, unread counts, mark read', async () => {
  const chans = (await tess.get('/api/chat/channels')).data;
  const everyone = chans.find(c => c.kind === 'team');
  assert.equal(everyone.title, 'Everyone');
  ids.everyone = everyone.id;
  assert.equal((await owner.post(`/api/chat/channels/${everyone.id}/messages`, { body: '' })).status, 400);
  const m = (await owner.post(`/api/chat/channels/${everyone.id}/messages`, { body: 'Team meeting at 7:30 tomorrow' })).data;
  assert.equal(m.user_name, 'Olivia Owner');
  assert.equal((await tess.get('/api/chat/unread')).data.total, 1);
  assert.equal((await owner.get('/api/chat/unread')).data.total, 0, 'your own messages aren’t unread');
  const msgs = (await tess.get(`/api/chat/channels/${everyone.id}/messages`)).data;
  assert.equal(msgs.at(-1).body, 'Team meeting at 7:30 tomorrow');
  await tess.post(`/api/chat/channels/${everyone.id}/read`);
  assert.equal((await tess.get('/api/chat/unread')).data.total, 0);
  await bo.post(`/api/chat/channels/${everyone.id}/mute`, { muted: true });
  assert.equal((await bo.get('/api/chat/unread')).data.total, 0, 'muted channels don’t count');
});

test('direct messages are private and reused; groups have members', async () => {
  const dm = (await tess.post('/api/chat/channels', { kind: 'direct', user_id: ids['Bo Tech'] })).data.id;
  assert.equal((await bo.post('/api/chat/channels', { kind: 'direct', user_id: ids['Tess Tech'] })).data.id, dm, 'same conversation both ways');
  await tess.post(`/api/chat/channels/${dm}/messages`, { body: 'Got a spare 12V battery?' });
  assert.equal((await bo.get('/api/chat/channels')).data.find(c => c.id === dm).title, 'Tess Tech');
  assert.equal((await sal.get(`/api/chat/channels/${dm}/messages`)).status, 404, 'others can’t read it');
  assert.equal((await owner.get(`/api/chat/channels/${dm}/messages`)).status, 404, 'not even the owner');
  assert.ok(!(await owner.get('/api/chat/channels')).data.some(c => c.id === dm));

  assert.equal((await sal.post('/api/chat/channels', { kind: 'group', name: 'Install crew', member_ids: [] })).status, 400);
  const g = (await sal.post('/api/chat/channels', { kind: 'group', name: 'Install crew', member_ids: [ids['Tess Tech']] })).data.id;
  assert.equal((await tess.get(`/api/chat/channels/${g}`)).data.people.length, 2);
  assert.equal((await bo.get(`/api/chat/channels/${g}/messages`)).status, 404);
  assert.equal((await tess.put(`/api/chat/channels/${g}/members`, { member_ids: [ids['Tess Tech'], ids['Bo Tech']] })).status, 403, 'only the creator or an admin');
  await sal.put(`/api/chat/channels/${g}/members`, { member_ids: [ids['Sal Sales'], ids['Tess Tech'], ids['Bo Tech']] });
  assert.equal((await bo.get(`/api/chat/channels/${g}/messages`)).status, 200);
});

test('job threads: the assigned tech and the office; photos; delete own message', async () => {
  const cust = (await owner.post('/api/r/customers', { name: 'Harbor Dental', type: 'commercial' })).data.id;
  const job = (await owner.post('/api/r/service_calls', { customer_id: cust, title: 'Panel trouble', technician_id: ids.tTess })).data;
  assert.equal((await bo.post(`/api/service_calls/${job.id}/chat`)).status, 403);
  const ch = (await tess.post(`/api/service_calls/${job.id}/chat`)).data.id;
  assert.equal((await tess.post(`/api/service_calls/${job.id}/chat`)).data.id, ch, 'one thread per job');
  const JPG = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Buffer.alloc(80)]).toString('base64');
  const m = (await tess.post(`/api/chat/channels/${ch}/messages`, { body: 'Panel shows a ground fault — OK to replace the board?', photo: JPG })).data;
  assert.ok(m.photo);
  assert.equal((await owner.get('/api/chat/channels')).data.find(c => c.id === ch).title, `SC-${job.number} · Harbor Dental`);
  assert.equal((await owner.get(`/api/chat/channels/${ch}/messages`)).status, 200, 'admins/owners are in every job thread');
  assert.equal((await bo.get(`/api/chat/channels/${ch}/messages`)).status, 404);
  const photo = await fetch(base + m.photo, { headers: { cookie: owner.cookie() } });
  assert.equal(photo.status, 200);
  assert.equal((await bo.del(`/api/chat/messages/${m.id}`)).status, 404);
  assert.equal((await tess.del(`/api/chat/messages/${m.id}`)).status, 200);
  assert.equal((await owner.get(`/api/chat/channels/${ch}/messages`)).data.at(-1).deleted, true);
});

test('live stream delivers new messages to members only', async () => {
  const listen = c => new Promise(resolve => {
    const req = http.get(`${base}/api/chat/stream`, { headers: { cookie: c.cookie() } }, res => {
      let buf = '';
      res.on('data', d => { buf += d; if (buf.includes('event: message')) { req.destroy(); resolve(buf); } });
    });
    setTimeout(() => { req.destroy(); resolve(null); }, 1500);
  });
  const got = listen(tess), notGot = listen(sal);
  await new Promise(r => setTimeout(r, 100));
  const dm = (await owner.post('/api/chat/channels', { kind: 'direct', user_id: ids['Tess Tech'] })).data.id;
  await owner.post(`/api/chat/channels/${dm}/messages`, { body: 'Call me when you can' });
  const evt = await got;
  assert.match(evt, /Call me when you can/);
  assert.equal(await notGot, null, 'not delivered to people outside the conversation');
});

test('push notifications: subscribe, signed VAPID push with no message text, dead subscriptions removed', async () => {
  const hits = [];
  let status = 201;
  const fake = http.createServer((req, res) => { let b = ''; req.on('data', d => { b += d; }); req.on('end', () => { hits.push({ headers: req.headers, body: b }); res.writeHead(status); res.end(); }); });
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  const endpoint = `http://127.0.0.1:${fake.address().port}/push/abc`;
  try {
    assert.equal((await bo.post('/api/push/subscribe', { endpoint })).status, 400, 'only real push services');
    process.env.PUSH_ALLOW_ANY = '1';
    assert.equal((await bo.post('/api/push/subscribe', { endpoint })).status, 200);
    const key = (await bo.get('/api/push/key')).data.key;
    assert.equal(Buffer.from(key, 'base64url').length, 65);
    const dm = (await tess.post('/api/chat/channels', { kind: 'direct', user_id: ids['Bo Tech'] })).data.id;
    await tess.post(`/api/chat/channels/${dm}/messages`, { body: 'Secret gate code is 1234' });
    for (let i = 0; i < 20 && !hits.length; i++) await new Promise(r => setTimeout(r, 50));
    assert.equal(hits.length, 1);
    assert.equal(hits[0].body, '', 'no message text goes through the push service');
    const [, jwt, k] = hits[0].headers.authorization.match(/^vapid t=([^,]+), k=(.+)$/);
    assert.equal(k, key);
    const [h, c, sig] = jwt.split('.');
    const pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: Buffer.from(key, 'base64url').subarray(1, 33).toString('base64url'), y: Buffer.from(key, 'base64url').subarray(33).toString('base64url') }, format: 'jwk' });
    assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')), 'valid ES256 signature');
    assert.equal(JSON.parse(Buffer.from(c, 'base64url')).aud, new URL(endpoint).origin);
    // A gone subscription is cleaned up
    status = 410;
    await tess.post(`/api/chat/channels/${dm}/messages`, { body: 'again' });
    for (let i = 0; i < 20 && db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get().n; i++) await new Promise(r => setTimeout(r, 50));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get().n, 0);
  } finally { delete process.env.PUSH_ALLOW_ANY; fake.close(); }
});

test('incident review: owners/admins recover any conversation (incl. deleted messages) with a reason; every look is logged', async () => {
  const admin = client();
  await owner.post('/api/users', { name: 'Ann Admin', email: 'ann@example.com', password: 'password123', role: 'admin' });
  await admin.post('/api/auth/login', { email: 'ann@example.com', password: 'password123' });
  const dm = (await tess.post('/api/chat/channels', { kind: 'direct', user_id: ids['Bo Tech'] })).data.id;
  const m = (await bo.post(`/api/chat/channels/${dm}/messages`, { body: 'Take the extra cable home, nobody counts it' })).data;
  await bo.del(`/api/chat/messages/${m.id}`);
  // Not without a review, not for technicians or sales
  assert.equal((await owner.get(`/api/chat/records/channels/${dm}`)).data.code, 'review_required');
  assert.equal((await tess.post('/api/chat/records/review', { reason: 'curious' })).status, 403);
  assert.equal((await sal.post('/api/chat/records/review', { reason: 'curious' })).status, 403);
  assert.equal((await admin.post('/api/chat/records/review', { reason: 'x' })).status, 400, 'a real reason is required');
  assert.equal((await admin.post('/api/chat/records/review', { reason: 'Truck 2 count variance — missing Cat6 cable' })).status, 200);
  // Find it by text, including the deleted message
  const found = (await admin.get('/api/chat/records/channels?q=extra%20cable')).data;
  assert.equal(found.length, 1);
  assert.equal(found[0].id, dm);
  assert.match(found[0].people, /Bo Tech, Tess Tech/);
  const byPerson = (await admin.get(`/api/chat/records/channels?user_id=${ids['Bo Tech']}`)).data;
  assert.ok(byPerson.some(c => c.id === dm));
  const t = (await admin.get(`/api/chat/records/channels/${dm}`)).data;
  assert.match(t.title, /Direct message: Bo Tech & Tess Tech/);
  const rec = t.messages.find(x => x.id === m.id);
  assert.equal(rec.body, 'Take the extra cable home, nobody counts it', 'deleted messages are recoverable');
  assert.ok(rec.deleted_at);
  const csv = await fetch(`${base}/api/chat/records/channels/${dm}/export`, { headers: { cookie: admin.cookie() } });
  assert.match(await csv.text(), /Take the extra cable home/);
  // Logged, and the owner is told an admin is reviewing
  const log = db.prepare("SELECT action, detail FROM audit_log WHERE user_name = 'Ann Admin' AND action IN ('start chat review','review chat','export chat') ORDER BY id").all();
  assert.deepEqual(log.map(l => l.action), ['start chat review', 'review chat', 'export chat']);
  assert.match(log[1].detail, /Truck 2 count variance/);
  assert.ok((await owner.get('/api/alerts')).data.some(a => a.kind === 'chat_review' && /Ann Admin/.test(a.title)));
  // The people in the chat still see it as deleted
  assert.equal((await tess.get(`/api/chat/channels/${dm}/messages`)).data.find(x => x.id === m.id).body, null);
});
