// Time-off requests, approval, and scheduling blocks.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'secureops-off-'));
process.env.DATA_DIR = tmp;
process.env.SMTP_HOST = 'json';
const { openDb } = await import('../server/db.js');
const { createServer } = await import('../server/server.js');
const { notifyIdle } = await import('../server/notify.js');

let server, base, db;
before(async () => {
  db = openDb(':memory:');
  server = createServer(db);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

function client() {
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { cookie, 'X-Requested-With': 'SecureOps', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  return { get: u => call('GET', u), post: (u, b = {}) => call('POST', u, b), put: (u, b = {}) => call('PUT', u, b) };
}
const owner = client(), tess = client();
const ids = {};
const day = n => { const d = new Date(Date.now() + n * 864e5); const p = x => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

test('setup', async () => {
  await owner.post('/api/auth/setup', { name: 'Olivia Owner', email: 'owner@example.com', password: 'password123', company_name: 'Off Co' });
  ids.tech = (await owner.post('/api/r/technicians', { name: 'Tess', phone: '555-201-0001' })).data.id;
  ids.user = (await owner.post('/api/users', { name: 'Tess Tech', email: 'tess@example.com', password: 'password123', role: 'technician', technician_id: ids.tech })).data.id;
  await tess.post('/api/auth/login', { email: 'tess@example.com', password: 'password123' });
  ids.cust = (await owner.post('/api/r/customers', { name: 'Acme', type: 'commercial' })).data.id;
  ids.job = (await owner.post('/api/r/service_calls', { customer_id: ids.cust, title: 'Already booked', technician_id: ids.tech, scheduled_start: `${day(10)}T09:00`, duration_hours: 2 })).data.id;
});

test('a tech requests time off; the office sees the clash with a booked job and approves', async () => {
  assert.equal((await tess.post('/api/time-off', { kind: 'vacation', start_date: day(12), end_date: day(10) })).status, 400, 'end before start');
  const r = await tess.post('/api/time-off', { kind: 'vacation', start_date: day(10), end_date: day(12), note: 'Family trip' });
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'pending');
  assert.equal(r.data.clashes.jobs.length, 1, 'the booked job is flagged');
  ids.req = r.data.id;
  assert.equal((await tess.post('/api/time-off', { kind: 'personal', start_date: day(11), end_date: day(11) })).status, 409, 'no overlapping requests');
  const alert = (await owner.get('/api/alerts')).data.find(a => a.kind === 'time_off');
  assert.match(alert.title, /Tess Tech requested time off/);
  assert.match(alert.body, /1 job\(s\) already booked/);
  assert.equal((await tess.post(`/api/time-off/${ids.req}/decide`, { decision: 'approve' })).status, 403, 'techs can’t approve');
  const list = (await owner.get('/api/time-off')).data;
  assert.equal(list.find(x => x.id === ids.req).clashes.jobs[0].title, 'Already booked');
  const d = (await owner.post(`/api/time-off/${ids.req}/decide`, { decision: 'approve', note: 'Enjoy!' })).data;
  assert.equal(d.status, 'approved');
  assert.equal(d.clashes.jobs.length, 1, 'reminds the office to reassign');
  assert.ok(!(await owner.get('/api/alerts')).data.some(a => a.kind === 'time_off'));
  await notifyIdle();
  assert.ok(db.prepare("SELECT 1 FROM notifications WHERE related_type = 'time_off' AND body LIKE '%was approved — Enjoy!%'").get(), 'the tech is told');
});

test('approved time off blocks booking (owners can override), shows on calendars, and who’s out', async () => {
  let r = await owner.post('/api/r/service_calls', { customer_id: ids.cust, title: 'New job', technician_id: ids.tech, scheduled_start: `${day(11)}T13:00`, duration_hours: 1 });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /Tess Tech is off \(vacation\)/);
  assert.equal(r.data.canOverride, true);
  r = await owner.post('/api/r/service_calls', { customer_id: ids.cust, title: 'New job', technician_id: ids.tech, scheduled_start: `${day(11)}T13:00`, duration_hours: 1, allow_conflict: true });
  assert.equal(r.status, 200, 'book anyway');
  assert.equal((await owner.post('/api/r/service_calls', { customer_id: ids.cust, title: 'After', technician_id: ids.tech, scheduled_start: `${day(13)}T09:00` })).status, 200, 'fine the day after');
  const out = (await tess.get(`/api/time-off/out?from=${day(9)}&to=${day(14)}`)).data;
  assert.equal(out.length, 1);
  assert.equal(out[0].user_name, 'Tess Tech');
  assert.equal(out[0].note, undefined, 'everyone sees who’s out, not why');
  const token = db.prepare('SELECT calendar_token FROM technicians WHERE id = ?').get(ids.tech).calendar_token;
  const ics = await (await fetch(`${base}/api/cal/tech-${token}.ics`)).text();
  assert.match(ics, /SUMMARY:Time off \(vacation\)/);
  assert.match(ics, new RegExp(`DTSTART;VALUE=DATE:${day(10).replace(/-/g, '')}`));
});

test('part-day requests, denial, cancelling, and the office adding time off directly', async () => {
  const r = (await tess.post('/api/time-off', { kind: 'personal', all_day: false, starts_at: `${day(20)}T13:00`, ends_at: `${day(20)}T17:00`, note: 'Dentist' })).data;
  assert.equal(r.all_day, 0);
  await owner.post(`/api/time-off/${r.id}/decide`, { decision: 'deny', note: 'Big install that day' });
  assert.equal((await owner.post('/api/r/service_calls', { customer_id: ids.cust, title: 'Install', technician_id: ids.tech, scheduled_start: `${day(20)}T14:00` })).status, 200, 'denied requests don’t block');
  const mine = (await tess.get('/api/time-off')).data;
  assert.equal(mine.find(x => x.id === r.id).status, 'denied');
  assert.equal(mine.find(x => x.id === r.id).decision_note, 'Big install that day');
  // Cancel the approved vacation
  assert.equal((await tess.post(`/api/time-off/${ids.req}/cancel`)).status, 200);
  assert.equal((await owner.post('/api/r/service_calls', { customer_id: ids.cust, title: 'Now free', technician_id: ids.tech, scheduled_start: `${day(12)}T09:00` })).status, 200);
  // Office adds sick time for her, approved straight away
  const sick = (await owner.post('/api/time-off', { user_id: ids.user, kind: 'sick', start_date: day(30), end_date: day(30), approve: true })).data;
  assert.equal(sick.status, 'approved');
  assert.equal(sick.decided_by, 'Olivia Owner');
});
