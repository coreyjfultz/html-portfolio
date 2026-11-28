// The HR role and custom roles built from permissions.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'secureops-roles-'));
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
  return { get: u => call('GET', u), post: (u, b = {}) => call('POST', u, b), put: (u, b = {}) => call('PUT', u, b), del: u => call('DELETE', u) };
}
const owner = client(), admin = client(), hr = client(), tess = client(), asst = client(), lead = client();
const ids = {};
const day = n => addDays(todayLocal(), n);
const login = (c, email) => c.post('/api/auth/login', { email, password: 'password123' });

test('setup', async () => {
  await owner.post('/api/auth/setup', { name: 'Olivia Owner', email: 'owner@example.com', password: 'password123', company_name: 'Roles Co' });
  ids.tech = (await owner.post('/api/r/technicians', { name: 'Tess' })).data.id;
  for (const [c, name, email, role, extra] of [[admin, 'Al Admin', 'al@example.com', 'admin', {}], [hr, 'Hana HR', 'hana@example.com', 'hr', {}], [tess, 'Tess Tech', 'tess@example.com', 'technician', { technician_id: ids.tech }]]) {
    const r = await owner.post('/api/users', { name, email, password: 'password123', role, ...extra });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    ids[name] = r.data.id;
    await login(c, email);
  }
  ids.cust = (await owner.post('/api/r/customers', { name: 'Acme Plaza', type: 'commercial' })).data.id;
  ids.call = (await owner.post('/api/r/service_calls', { customer_id: ids.cust, title: 'Panel trouble', technician_id: ids.tech, scheduled_start: `${day(1)}T09:00` })).data.id;
  await owner.post('/api/r/customer_passwords', { customer_id: ids.cust, label: 'Alarm', secret: '4455' }).catch(() => {});
});

test('HR: people, time off, holidays, pay & records; no customers, jobs or billing', async () => {
  // No customers or jobs at all
  assert.deepEqual((await hr.get('/api/r/customers')).data, []);
  assert.equal((await hr.get(`/api/r/customers/${ids.cust}`)).status, 404);
  assert.deepEqual((await hr.get('/api/r/service_calls')).data, []);
  assert.equal((await hr.get(`/api/r/service_calls/${ids.call}`)).status, 404);
  assert.equal((await hr.post('/api/r/customers', { name: 'Nope' })).status, 403);
  assert.equal((await hr.get('/api/r/invoices')).status, 403);
  assert.equal((await hr.get('/api/pipeline')).status, 403);
  assert.equal((await hr.get('/api/dashboard')).data.no_customers, true);
  const search = await hr.get('/api/search?q=Acme');
  assert.ok(!JSON.stringify(search.data || {}).includes('Acme Plaza'));
  // Everyone's time off
  const req = await tess.post('/api/time-off', { kind: 'vacation', start_date: day(10), end_date: day(10) });
  assert.match(db.prepare('SELECT title FROM push_notes WHERE user_id = ? ORDER BY id DESC').get(ids['Hana HR']).title, /Tess Tech asked for time off/);
  assert.ok((await hr.get('/api/time-off')).data.find(x => x.id === req.data.id).can_decide);
  assert.equal((await hr.post(`/api/time-off/${req.data.id}/decide`, { decision: 'approve' })).status, 200);
  assert.equal((await hr.get('/api/pto/balances?all=1')).status, 200);
  assert.equal((await hr.put(`/api/pto/allowances/${ids['Tess Tech']}`, { year: Number(day(0).slice(0, 4)), vacation: 120, sick: 40, personal: 16, carry_vacation: 0, carry_sick: 0, carry_personal: 0 })).status, 200);
  assert.equal((await hr.post('/api/holidays', { date: day(40), name: 'Company picnic' })).status, 200);
  // HR settings yes, everything else no
  assert.equal((await hr.put('/api/settings', { pto_default_vacation: '96' })).status, 200);
  assert.equal((await hr.put('/api/settings', { company_name: 'Hacked' })).status, 403);
  assert.equal((await hr.put('/api/settings', { pto_default_sick: '50', tax_rate: '0' })).status, 403);
  // Users & supervisors, but not admin accounts
  const u = await hr.post('/api/users', { name: 'New Tech', email: 'newtech@example.com', password: 'password123', role: 'technician', supervisor_id: ids['Hana HR'] });
  assert.equal(u.status, 200, JSON.stringify(u.data));
  assert.equal((await hr.post('/api/users', { name: 'Sneaky', email: 'sneaky@example.com', password: 'password123', role: 'admin' })).status, 403);
  assert.equal((await hr.put(`/api/users/${ids['Al Admin']}`, { job_title: 'x' })).status, 403);
  assert.equal((await hr.put(`/api/users/${u.data.id}`, { role: 'admin' })).status, 403);
  assert.equal((await hr.put(`/api/users/${u.data.id}`, { job_title: 'Installer' })).status, 200);
  // Pay & benefits admin, chat records
  await owner.put('/api/settings', { addon_pay: '1' });
  assert.equal((await hr.get('/api/pay/config')).data.can_manage, true);
  assert.equal((await hr.post('/api/r/benefit_plans', { name: 'Dental', kind: 'dental' })).status, 200);
  assert.equal((await hr.post('/api/chat/records/review', { reason: 'Harassment complaint #12' })).status, 200);
  assert.match(db.prepare("SELECT title FROM alerts WHERE kind = 'chat_review' ORDER BY id DESC").get().title, /Hana HR started reviewing/);
  // Roles: HR can see them, not change them
  assert.equal((await hr.get('/api/roles')).status, 200);
  assert.equal((await hr.post('/api/roles', { name: 'X' })).status, 403);
});

test('custom roles: an owner builds them; they work everywhere', async () => {
  assert.equal((await admin.post('/api/roles', { name: 'Office assistant' })).status, 403); // owner only
  const r = await owner.post('/api/roles', { name: 'Office assistant', description: 'Phones and customer records', customer_access: 'all', permissions: ['staff', 'customers', 'bogus'] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  ids.asstRole = r.data.key;
  assert.equal((await owner.post('/api/roles', { name: 'office assistant' })).status, 409); // names are unique
  assert.equal((await owner.post('/api/roles', { name: 'HR' })).status, 409);
  const listed = (await tess.get('/api/roles')).data.roles.find(x => x.key === ids.asstRole);
  assert.deepEqual(listed.permissions, ['staff', 'customers']);
  // Give it to someone
  const u = await owner.post('/api/users', { name: 'Ava Assistant', email: 'ava@example.com', password: 'password123', role: ids.asstRole });
  assert.equal(u.status, 200, JSON.stringify(u.data));
  await login(asst, 'ava@example.com');
  assert.ok((await asst.get('/api/r/customers')).data.some(c => c.id === ids.cust));
  assert.equal((await asst.post('/api/r/customers', { name: 'New Co' })).status, 200);
  assert.equal((await asst.get('/api/pipeline')).status, 200);
  assert.equal((await asst.get('/api/r/invoices')).status, 403);
  assert.equal((await asst.put('/api/settings', { company_name: 'x' })).status, 403);
  // Change the role: take away editing customers; it applies right away
  assert.equal((await owner.put(`/api/roles/${ids.asstRole}`, { permissions: ['staff', 'billing'] })).status, 200);
  assert.equal((await asst.post('/api/r/customers', { name: 'Newer Co' })).status, 403);
  assert.equal((await asst.get('/api/r/invoices')).status, 200);
  // Built-in roles can't be edited; a role in use can't be deleted
  assert.equal((await owner.put('/api/roles/admin', { permissions: [] })).status, 400);
  assert.equal((await owner.del(`/api/roles/${ids.asstRole}`)).status, 409);
});

test('custom field role: a lead tech who sees only their schedule but approves everyone’s time off', async () => {
  const r = await owner.post('/api/roles', { name: 'Lead technician', customer_access: 'schedule', permissions: ['hr'] });
  const lt = await owner.post('/api/users', { name: 'Lee Lead', email: 'lee@example.com', password: 'password123', role: r.data.key });
  await login(lead, 'lee@example.com');
  // Scoped like a technician: no jobs of their own yet → no customers
  assert.deepEqual((await lead.get('/api/r/customers')).data, []);
  // …but sees and decides everyone's time off
  const req = await tess.post('/api/time-off', { kind: 'personal', start_date: day(20), end_date: day(20) });
  assert.equal((await lead.post(`/api/time-off/${req.data.id}/decide`, { decision: 'approve' })).status, 200);
  // HR (people permission only) can't hand out a role that has admin rights
  const big = await owner.post('/api/roles', { name: 'Ops manager', customer_access: 'all', permissions: ['manage'] });
  assert.equal((await hr.post('/api/users', { name: 'X', email: 'x@example.com', password: 'password123', role: big.data.key })).status, 403);
  assert.equal((await hr.put(`/api/users/${lt.data.id}`, { role: big.data.key })).status, 403);
  // Deleting an unused role works
  assert.equal((await owner.del(`/api/roles/${big.data.key}`)).status, 200);
  assert.ok(!(await owner.get('/api/roles')).data.roles.some(x => x.key === big.data.key));
  assert.equal((await owner.post('/api/users', { name: 'Y', email: 'y@example.com', password: 'password123', role: big.data.key })).status, 400);
});
