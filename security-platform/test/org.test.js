// Supervisors: who reports to whom, and supervisors approving their team's time off.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'secureops-org-'));
process.env.DATA_DIR = tmp;
const { openDb } = await import('../server/db.js');
const { createServer } = await import('../server/server.js');
const { todayLocal, addDays } = await import('../server/resources.js');

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
const owner = client(), lead = client(), tess = client(), bo = client(), al = client();
const ids = {};
const day = n => addDays(todayLocal(), n);

test('setup: owner → lead tech → two techs; an admin beside them', async () => {
  await owner.post('/api/auth/setup', { name: 'Olivia Owner', email: 'owner@example.com', password: 'password123', company_name: 'Org Co' });
  ids.owner = db.prepare("SELECT id FROM users WHERE email = 'owner@example.com'").get().id;
  const add = async (c, name, email, role, extra = {}) => {
    const r = await owner.post('/api/users', { name, email, password: 'password123', role, ...extra });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    await c.post('/api/auth/login', { email, password: 'password123' });
    return r.data.id;
  };
  ids.lead = await add(lead, 'Lee Lead', 'lee@example.com', 'technician', { supervisor_id: ids.owner, job_title: 'Lead Technician' });
  ids.tess = await add(tess, 'Tess Tech', 'tess@example.com', 'technician', { supervisor_id: ids.lead });
  ids.bo = await add(bo, 'Bo Tech', 'bo@example.com', 'technician');
  ids.al = await add(al, 'Al Admin', 'al@example.com', 'admin', { supervisor_id: ids.owner });
  // Set Bo's supervisor afterwards, and his title
  assert.equal((await owner.put(`/api/users/${ids.bo}`, { supervisor_id: ids.lead, job_title: 'Installer' })).status, 200);
  const users = (await owner.get('/api/users')).data;
  assert.equal(users.find(u => u.id === ids.bo).supervisor_name, 'Lee Lead');
  assert.equal(users.find(u => u.id === ids.lead).job_title, 'Lead Technician');
});

test('no loops: someone can’t report to themselves or to someone under them', async () => {
  assert.equal((await owner.put(`/api/users/${ids.lead}`, { supervisor_id: ids.lead })).status, 400);
  const r = await owner.put(`/api/users/${ids.lead}`, { supervisor_id: ids.tess });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /reports to them already/);
  assert.equal((await lead.put(`/api/users/${ids.tess}`, { supervisor_id: ids.bo })).status, 403); // only owners/admins edit users
});

test('org chart and "my team"', async () => {
  const org = (await tess.get('/api/org')).data;
  assert.equal(org.find(u => u.id === ids.tess).supervisor_id, ids.lead);
  const meLead = (await lead.get('/api/org/me')).data;
  assert.equal(meLead.supervisor.name, 'Olivia Owner');
  assert.deepEqual(meLead.direct_reports.map(u => u.name).sort(), ['Bo Tech', 'Tess Tech']);
  assert.equal(meLead.is_supervisor, true);
  const meOwner = (await owner.get('/api/org/me')).data;
  assert.ok(meOwner.team_ids.includes(ids.tess)); // further down counts too
  assert.equal((await tess.get('/api/org/me')).data.is_supervisor, false);
});

test('time off goes to the supervisor, who approves it; others can’t', async () => {
  const req = await tess.post('/api/time-off', { kind: 'personal', start_date: day(20), end_date: day(20), note: 'Dentist' });
  assert.equal(req.status, 200, JSON.stringify(req.data));
  const id = req.data.id;
  // The lead is told
  assert.match(db.prepare('SELECT title FROM push_notes WHERE user_id = ? ORDER BY id DESC').get(ids.lead).title, /Tess Tech asked for time off/);
  assert.match(db.prepare("SELECT title FROM alerts WHERE kind = 'time_off' ORDER BY id DESC").get().title, /Lee is their supervisor/);
  // Owners/admins get every request too (on by default)
  assert.match(db.prepare('SELECT title FROM push_notes WHERE user_id = ? ORDER BY id DESC').get(ids.owner).title, /Tess Tech asked for time off/);
  assert.match(db.prepare('SELECT title FROM push_notes WHERE user_id = ? ORDER BY id DESC').get(ids.al).title, /Tess Tech asked for time off/);
  // The lead sees it with can_decide; a peer doesn't see it; Tess can't approve her own
  const leadList = (await lead.get('/api/time-off')).data;
  assert.ok(leadList.find(x => x.id === id).can_decide);
  assert.ok(!(await bo.get('/api/time-off')).data.some(x => x.id === id));
  assert.equal((await bo.post(`/api/time-off/${id}/decide`, { decision: 'approve' })).status, 403);
  assert.equal((await tess.post(`/api/time-off/${id}/decide`, { decision: 'approve' })).status, 403);
  assert.equal((await lead.get('/api/org/me')).data.pending_time_off, 1);
  // Lead approves
  const ok = await lead.post(`/api/time-off/${id}/decide`, { decision: 'approve' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(db.prepare('SELECT status, decided_by FROM time_off WHERE id = ?').get(id).decided_by, 'Lee Lead');
  // The lead's own request goes to the owner; the lead can't approve it
  const own = await lead.post('/api/time-off', { kind: 'vacation', start_date: day(30), end_date: day(31) });
  assert.equal((await lead.post(`/api/time-off/${own.data.id}/decide`, { decision: 'approve' })).status, 403);
  assert.ok((await owner.get('/api/time-off')).data.find(x => x.id === own.data.id).can_decide);
  // Admins can still decide anyone's (except their own)
  const alsReq = await al.post('/api/time-off', { kind: 'vacation', start_date: day(40), end_date: day(40) });
  assert.equal((await al.post(`/api/time-off/${alsReq.data.id}/decide`, { decision: 'approve' })).status, 403);
  assert.equal((await al.post(`/api/time-off/${own.data.id}/decide`, { decision: 'deny', note: 'Busy week' })).status, 200);
  assert.equal((await owner.post(`/api/time-off/${alsReq.data.id}/decide`, { decision: 'approve' })).status, 200);
  // The lead can add approved time off for someone on the team, not for others
  const added = await lead.post('/api/time-off', { user_id: ids.bo, kind: 'sick', start_date: day(1), end_date: day(1), approve: true });
  assert.equal(added.status, 200, JSON.stringify(added.data));
  assert.equal(added.data.status, 'approved');
  assert.equal((await lead.post('/api/time-off', { user_id: ids.al, kind: 'sick', start_date: day(2), end_date: day(2) })).status, 403);
  // …and cancel a team member's request
  const t2 = await tess.post('/api/time-off', { kind: 'personal', start_date: day(50), end_date: day(50) });
  assert.equal((await lead.post(`/api/time-off/${t2.data.id}/cancel`)).status, 200);
  assert.equal((await bo.post(`/api/time-off/${t2.data.id}/cancel`)).status, 403);
});

test('settings: supervisors only — owners/admins not told and can’t decide (unless no supervisor)', async () => {
  await owner.put('/api/settings', { timeoff_notify_managers: '0', timeoff_managers_decide: '0' });
  const before = db.prepare('SELECT COUNT(*) AS n FROM push_notes WHERE user_id = ?').get(ids.al).n;
  const req = await tess.post('/api/time-off', { kind: 'personal', start_date: day(60), end_date: day(60) });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM push_notes WHERE user_id = ?').get(ids.al).n, before); // admin not told
  assert.match(db.prepare('SELECT title FROM push_notes WHERE user_id = ? ORDER BY id DESC').get(ids.lead).title, /Tess Tech asked/); // supervisor is
  assert.equal((await al.post(`/api/time-off/${req.data.id}/decide`, { decision: 'approve' })).status, 403);
  assert.ok(!(await al.get('/api/time-off')).data.find(x => x.id === req.data.id).can_decide);
  // The owner is above Tess in the chart, so can still decide
  assert.ok((await owner.get('/api/time-off')).data.find(x => x.id === req.data.id).can_decide);
  // Someone with no supervisor always goes to owners/admins
  await owner.put(`/api/users/${ids.bo}`, { supervisor_id: '' });
  const bReq = await bo.post('/api/time-off', { kind: 'personal', start_date: day(61), end_date: day(61) });
  assert.match(db.prepare('SELECT title FROM push_notes WHERE user_id = ? ORDER BY id DESC').get(ids.al).title, /Bo Tech asked/);
  assert.equal((await al.post(`/api/time-off/${bReq.data.id}/decide`, { decision: 'approve' })).status, 200);
  await owner.put(`/api/users/${ids.bo}`, { supervisor_id: ids.lead });
  await owner.put('/api/settings', { timeoff_notify_managers: '1', timeoff_managers_decide: '1' });
  assert.equal((await al.post(`/api/time-off/${req.data.id}/decide`, { decision: 'approve' })).status, 200);
});

test('supervisors see and help with their team’s tasks', async () => {
  const t = await owner.post('/api/tasks', { title: 'Return ladder to rental shop', assigned_to: ids.tess, due_date: day(1) });
  assert.equal((await lead.get(`/api/tasks/${t.data.id}`)).status, 200);
  assert.ok((await lead.get('/api/tasks?view=team')).data.some(x => x.id === t.data.id));
  assert.equal((await bo.get(`/api/tasks/${t.data.id}`)).status, 404);
  assert.equal((await lead.post(`/api/tasks/${t.data.id}/done`, { note: 'Did it on my way' })).status, 200);
  assert.deepEqual((await tess.get('/api/tasks?view=team')).data, []);
});

test('when a supervisor leaves, their team moves up a level', async () => {
  assert.equal((await owner.put(`/api/users/${ids.lead}`, { active: false })).status, 200);
  assert.equal(db.prepare('SELECT supervisor_id FROM users WHERE id = ?').get(ids.tess).supervisor_id, ids.owner);
  assert.equal(db.prepare('SELECT supervisor_id FROM users WHERE id = ?').get(ids.bo).supervisor_id, ids.owner);
});
