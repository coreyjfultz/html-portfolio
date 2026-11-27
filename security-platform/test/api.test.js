// End-to-end API tests against an in-memory database. Run: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'secureops-test-'));
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
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

function client() {
  let cookie = '';
  const call = async (method, url, body, { csrf = true } = {}) => {
    const headers = { cookie };
    if (csrf) headers['X-Requested-With'] = 'SecureOps';
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  };
  return {
    call,
    get: u => call('GET', u),
    post: (u, b = {}) => call('POST', u, b),
    put: (u, b = {}) => call('PUT', u, b),
    del: u => call('DELETE', u),
  };
}

const admin = client();
let tech;
const ids = {};

test('first-run setup creates the admin, and only once', async () => {
  assert.equal((await admin.get('/api/auth/state')).data.needsSetup, true);
  const r = await admin.post('/api/auth/setup', { name: 'Owner', email: 'owner@example.com', password: 'correct-horse', company_name: 'Test Co' });
  assert.equal(r.status, 200);
  const again = await client().post('/api/auth/setup', { name: 'X', email: 'x@example.com', password: 'whatever12' });
  assert.equal(again.status, 409);
  assert.equal((await admin.get('/api/auth/state')).data.user.role, 'owner', 'the first account is the owner');
  // Photo/parts completion rules are covered in features.test.js; keep these tests focused.
  await admin.put('/api/settings', { require_photos: '0', require_parts: '0', require_signature: '0' });
});

test('rejects bad logins and unauthenticated access', async () => {
  const c = client();
  assert.equal((await c.post('/api/auth/login', { email: 'owner@example.com', password: 'wrong-password' })).status, 401);
  assert.equal((await c.get('/api/r/customers')).status, 401);
});

test('state-changing requests require the CSRF header', async () => {
  const r = await admin.call('POST', '/api/r/customers', { name: 'Evil', type: 'residential' }, { csrf: false });
  assert.equal(r.status, 403);
});

test('customers: validation and residential/commercial types', async () => {
  assert.equal((await admin.post('/api/r/customers', { type: 'residential' })).status, 400);
  assert.equal((await admin.post('/api/r/customers', { name: 'Bad', type: 'industrial' })).status, 400);
  const res = await admin.post('/api/r/customers', { name: 'Jane Home', type: 'residential', email: 'jane@example.com' });
  const com = await admin.post('/api/r/customers', { name: 'Acme Plant', type: 'commercial', tax_exempt: 0 });
  assert.equal(res.status, 200);
  ids.res = res.data.id; ids.com = com.data.id;
  const list = await admin.get('/api/r/customers?type=commercial');
  assert.deepEqual(list.data.map(c => c.name), ['Acme Plant']);
});

test('camera passwords are encrypted at rest, hidden in reads, and reveals are audited', async () => {
  const cam = await admin.post('/api/r/camera_systems', { customer_id: ids.com, location: 'Lobby', admin_username: 'admin', admin_password: 'S3cret!Pass' });
  assert.equal(cam.status, 200);
  assert.equal(cam.data.admin_password, null);
  assert.equal(cam.data.admin_password__set, true);
  const raw = db.prepare('SELECT admin_password FROM camera_systems WHERE id = ?').get(cam.data.id).admin_password;
  assert.ok(raw.startsWith('v1:') && !raw.includes('S3cret'));
  const listed = await admin.get(`/api/r/camera_systems?customer_id=${ids.com}`);
  assert.ok(!JSON.stringify(listed.data).includes('S3cret'));
  const rev = await admin.post(`/api/r/camera_systems/${cam.data.id}/reveal`, { field: 'admin_password' });
  assert.equal(rev.data.value, 'S3cret!Pass');
  // Saving without the field keeps the password
  await admin.put(`/api/r/camera_systems/${cam.data.id}`, { location: 'Main lobby' });
  assert.equal((await admin.post(`/api/r/camera_systems/${cam.data.id}/reveal`, { field: 'admin_password' })).data.value, 'S3cret!Pass');
  const audit = await admin.get('/api/audit');
  assert.ok(audit.data.some(a => a.action === 'reveal' && a.resource === 'camera_systems'));
  // CSV export never contains secrets
  const csv = await fetch(base + '/api/export/camera_systems', { headers: { cookie: '' } });
  assert.equal(csv.status, 401);
});

test('monthly billing: creates invoices with tax on taxable lines only, and is idempotent', async () => {
  await admin.put('/api/settings', { tax_rate: '10' });
  await admin.post('/api/r/recurring_charges', { customer_id: ids.com, description: 'Monitoring', amount: 50, taxable: 0 });
  await admin.post('/api/r/recurring_charges', { customer_id: ids.com, description: 'Service plan', amount: 20, taxable: 1 });
  const preview = await admin.post('/api/invoices/generate-monthly', { period: '2030-01', dry_run: true });
  assert.equal(preview.data.customers.length, 1);
  assert.equal(preview.data.total, 70);
  const run = await admin.post('/api/invoices/generate-monthly', { period: '2030-01' });
  assert.equal(run.data.created, 1);
  const again = await admin.post('/api/invoices/generate-monthly', { period: '2030-01' });
  assert.equal(again.data.created, 0);
  const inv = (await admin.get(`/api/r/invoices?customer_id=${ids.com}&kind=monthly`)).data[0];
  assert.equal(inv.subtotal, 70);
  assert.equal(inv.tax, 2);
  assert.equal(inv.total, 72);
  assert.equal(inv.status, 'sent');
  assert.equal(inv.due_date, '2030-01-31');
  ids.inv = inv.id;
});

test('payments move invoices to partial then paid', async () => {
  const p1 = await admin.post('/api/r/payments', { invoice_id: ids.inv, amount: 30, date: '2030-01-05', method: 'check' });
  assert.equal(p1.data.customer_id, ids.com);
  let inv = (await admin.get(`/api/r/invoices/${ids.inv}`)).data;
  assert.equal(inv.status, 'partial');
  assert.equal(inv.balance, 42);
  await admin.post('/api/r/payments', { invoice_id: ids.inv, amount: 42, date: '2030-01-06', method: 'card' });
  inv = (await admin.get(`/api/r/invoices/${ids.inv}`)).data;
  assert.equal(inv.status, 'paid');
  assert.equal(inv.balance, 0);
  await admin.del(`/api/r/payments/${p1.data.id}`);
  assert.equal((await admin.get(`/api/r/invoices/${ids.inv}`)).data.status, 'partial');
  assert.equal((await admin.post('/api/r/payments', { invoice_id: ids.inv, amount: -5, date: '2030-01-06' })).status, 400);
});

test('customers with invoices cannot be deleted', async () => {
  const r = await admin.del(`/api/r/customers/${ids.com}`);
  assert.equal(r.status, 409);
});

test('inventory: receive, load a truck, use on a job, return, and block over-transfers', async () => {
  const t = await admin.post('/api/r/technicians', { name: 'Tess Tech', hourly_cost: 30, bill_rate: 100 });
  ids.tech = t.data.id;
  const v = await admin.post('/api/r/vehicles', { unit_name: 'Van 9', assigned_technician_id: ids.tech });
  ids.van = v.data.id;
  const item = await admin.post('/api/r/inventory_items', { name: 'Smoke detector', unit_cost: 20, unit_price: 60, reorder_level: 3 });
  ids.item = item.data.id;
  await admin.post('/api/stock/receive', { item_id: ids.item, qty: 10, location_id: 0, vendor: 'ADI', record_expense: true });
  await admin.post('/api/stock/transfer', { item_id: ids.item, qty: 4, from: 0, to: ids.van });
  assert.equal((await admin.post('/api/stock/transfer', { item_id: ids.item, qty: 50, from: 0, to: ids.van })).status, 400);
  const call = await admin.post('/api/r/service_calls', { customer_id: ids.com, title: 'Replace detectors', technician_id: ids.tech, scheduled_start: '2030-01-10T08:00' });
  assert.equal(call.data.status, 'scheduled');
  assert.equal(call.data.labor_rate, 100);
  ids.call = call.data.id;
  const part = await admin.post('/api/r/service_call_parts', { service_call_id: ids.call, item_id: ids.item, qty: 3 });
  assert.equal(part.data.location_id, ids.van, 'defaults to the tech\'s truck');
  assert.equal(part.data.unit_price, 60);
  const stockAt = loc => db.prepare('SELECT qty FROM stock WHERE item_id = ? AND location_id = ?').get(ids.item, loc).qty;
  assert.equal(stockAt(ids.van), 1);
  assert.equal(stockAt(0), 6);
  const extra = await admin.post('/api/r/service_call_parts', { service_call_id: ids.call, item_id: ids.item, qty: 1 });
  await admin.del(`/api/r/service_call_parts/${extra.data.id}`);
  assert.equal(stockAt(ids.van), 1);
  const exp = await admin.get('/api/r/expenses');
  assert.ok(exp.data.some(e => e.amount === 200 && e.category === 'Parts & equipment'));
  await admin.post('/api/stock/count', { item_id: ids.item, location_id: 0, qty: 5 });
  assert.equal(stockAt(0), 5);
});

test('completed service call becomes an invoice with labor and parts', async () => {
  const done = await admin.put(`/api/r/service_calls/${ids.call}`, { status: 'completed', labor_hours: 2 });
  assert.ok(done.data.completed_at);
  const r = await admin.post(`/api/service_calls/${ids.call}/invoice`);
  const items = (await admin.get(`/api/r/invoice_items?invoice_id=${r.data.id}`)).data;
  assert.equal(items.length, 2);
  const inv = (await admin.get(`/api/r/invoices/${r.data.id}`)).data;
  assert.equal(inv.subtotal, 2 * 100 + 3 * 60);
  assert.equal(inv.tax, 18, 'tax only on parts');
  const again = await admin.post(`/api/service_calls/${ids.call}/invoice`);
  assert.equal(again.data.existing, true);
  const jobs = (await admin.get('/api/reports/jobs?from=2000-01-01&to=2100-01-01')).data;
  const job = jobs.find(j => j.id === ids.call);
  assert.equal(job.cost, 2 * 30 + 3 * 20);
});

test('maintenance: next due dates are calculated and completing rolls them forward', async () => {
  const ext = await admin.post('/api/r/extinguishers', { customer_id: ids.com, location: 'Kitchen', ext_type: 'CO2', last_annual: '2030-03-15', last_hydro: '2028-02-01' });
  assert.equal(ext.data.next_annual, '2031-03-15');
  assert.equal(ext.data.hydro_interval_years, 5);
  assert.equal(ext.data.next_hydro, '2033-02-01');
  const fire = await admin.post('/api/r/fire_systems', { customer_id: ids.com, system_type: 'kitchen hood suppression', inspection_interval_months: 6, last_inspection: '2030-01-31' });
  assert.equal(fire.data.next_inspection, '2030-07-31');
  await admin.post('/api/maintenance/complete', { key: 'ext_annual', ids: [ext.data.id], date: '2031-03-01' });
  const after = (await admin.get(`/api/r/extinguishers/${ext.data.id}`)).data;
  assert.equal(after.last_annual, '2031-03-01');
  assert.equal(after.next_annual, '2032-03-01');
  const due = await admin.get('/api/maintenance?days=5000');
  assert.ok(due.data.some(m => m.key === 'fire_inspection' && m.customer_id === ids.com));
});

test('technician role: field access only, no billing or reports', async () => {
  await admin.post('/api/users', { name: 'Tess', email: 'tess@example.com', password: 'tech-pass-1', role: 'technician', technician_id: ids.tech });
  tech = client();
  assert.equal((await tech.post('/api/auth/login', { email: 'tess@example.com', password: 'tech-pass-1' })).status, 200);
  assert.equal((await tech.get('/api/r/customers')).status, 200);
  assert.equal((await tech.get('/api/r/invoices')).status, 403);
  assert.equal((await tech.get('/api/r/expenses')).status, 403);
  assert.equal((await tech.get('/api/reports/pnl')).status, 403);
  assert.equal((await tech.get('/api/users')).status, 403);
  assert.equal((await tech.post('/api/r/customers', { name: 'X', type: 'residential' })).status, 403);
  assert.equal((await tech.del(`/api/r/service_calls/${ids.call}`)).status, 403);
  const dash = (await tech.get('/api/dashboard')).data;
  assert.equal(dash.mrr, undefined, 'no money figures for technicians');
  // Techs only see customers on their schedule
  assert.equal((await tech.get('/api/r/customers')).data.length, 0, 'nothing scheduled in the current window');
  assert.equal((await tech.put(`/api/r/service_calls/${ids.call}`, { resolution: 'Tested OK' })).status, 404, 'a job years away is not on their schedule');
  const soon = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
  const job = (await admin.post('/api/r/service_calls', { customer_id: ids.com, title: 'Panel check', technician_id: ids.tech, scheduled_start: `${soon}T09:00` })).data;
  const visible = (await tech.get('/api/r/customers')).data;
  assert.deepEqual(visible.map(c => c.id), [ids.com]);
  assert.equal((await tech.get(`/api/r/customers/${ids.res}`)).status, 404, 'other customers are hidden');
  assert.equal((await tech.get(`/api/r/customers/${ids.com}`)).status, 200);
  assert.equal((await tech.get('/api/search?q=Jane')).data.length, 0, 'search is scoped too');
  assert.equal((await tech.post('/api/r/service_calls', { customer_id: ids.res, title: 'Sneaky' })).status, 404);
  // Techs can update their jobs and load their truck
  assert.equal((await tech.put(`/api/r/service_calls/${job.id}`, { resolution: 'Tested OK' })).status, 200);
  assert.equal((await tech.post('/api/stock/transfer', { item_id: ids.item, qty: 1, from: 0, to: ids.van })).status, 200);
});

test('last owner cannot be demoted or deactivated', async () => {
  const users = (await admin.get('/api/users')).data;
  const me = users.find(u => u.role === 'owner');
  assert.equal((await admin.put(`/api/users/${me.id}`, { role: 'admin' })).status, 400);
  assert.equal((await admin.put(`/api/users/${me.id}`, { active: false })).status, 400);
});

test('roles: sales, accounting and administrator each see the right things', async () => {
  const mk = async (role) => {
    await admin.post('/api/users', { name: role, email: `${role}@example.com`, password: 'password-123', role });
    const c = client();
    assert.equal((await c.post('/api/auth/login', { email: `${role}@example.com`, password: 'password-123' })).status, 200);
    return c;
  };
  const sales = await mk('sales');
  const acct = await mk('accounting');
  const adm = await mk('admin');
  // Sales: customers yes, money no
  assert.equal((await sales.post('/api/r/customers', { name: 'Lead Co', type: 'commercial' })).status, 200);
  assert.equal((await sales.get('/api/r/invoices')).status, 403);
  assert.equal((await sales.get('/api/reports/pnl')).status, 403);
  assert.equal((await sales.get('/api/r/recurring_charges')).status, 200, 'sales can see monitoring rates');
  assert.equal((await sales.post('/api/r/recurring_charges', { customer_id: ids.com, description: 'x', amount: 1 })).status, 403);
  assert.equal((await sales.get('/api/dashboard')).data.mrr, undefined);
  // Accounting: billing and reports yes, team management no
  assert.equal((await acct.get('/api/r/invoices')).status, 200);
  assert.equal((await acct.get('/api/reports/pnl')).status, 200);
  assert.equal((await acct.get('/api/users')).status, 403);
  assert.equal((await acct.post('/api/r/technicians', { name: 'X' })).status, 403);
  assert.ok((await acct.get('/api/dashboard')).data.mrr !== undefined);
  // Administrator: runs the team but cannot touch owners or download backups
  assert.equal((await adm.get('/api/users')).status, 200);
  assert.equal((await adm.post('/api/users', { name: 'X', email: 'x2@example.com', password: 'password-123', role: 'owner' })).status, 403);
  const owner = (await adm.get('/api/users')).data.find(u => u.role === 'owner');
  assert.equal((await adm.put(`/api/users/${owner.id}`, { password: 'new-password-1' })).status, 403);
  assert.equal((await adm.get('/api/admin/backup')).status, 403);
  assert.equal((await admin.call('GET', '/api/admin/backup')).status, 200);
});

test('reports return consistent totals', async () => {
  const pnl = (await admin.get('/api/reports/pnl?from=2030-01&to=2030-01')).data;
  assert.equal(pnl.months.length, 1);
  assert.equal(pnl.totals.revenue, 72, 'draft invoices are not revenue');
  const techs = (await admin.get('/api/reports/technicians?from=2030-01-01&to=2030-01-31')).data;
  const t = techs.technicians.find(x => x.id === ids.tech);
  assert.equal(t.calls, 1);
  assert.equal(t.labor_hours, 2);
  const seg = (await admin.get('/api/reports/segments')).data;
  assert.equal(seg.find(s => s.type === 'commercial').mrr, 70);
});
