// Locations, related accounts, pipeline stages, scheduling conflicts, calendars,
// notifications, photos/signatures, proposals, payments, portal, QuickBooks.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'secureops-feat-'));
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

export function client(prefix = '') {
  let cookie = '';
  const call = async (method, url, body, { csrf = true, raw = false } = {}) => {
    const headers = { cookie };
    if (csrf) headers['X-Requested-With'] = 'SecureOps';
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + prefix + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    if (raw) return res;
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  return { call, get: u => call('GET', u), post: (u, b = {}) => call('POST', u, b), put: (u, b = {}) => call('PUT', u, b), del: u => call('DELETE', u) };
}
const owner = client();
const ids = {};
const stageOf = id => db.prepare('SELECT stage FROM customers WHERE id = ?').get(id).stage;

test('setup', async () => {
  assert.equal((await owner.post('/api/auth/setup', { name: 'Owner', email: 'owner@example.com', password: 'password123', company_name: 'Test Co' })).status, 200);
  ids.tech = (await owner.post('/api/r/technicians', { name: 'Tess', email: 'tess@example.com' })).data.id;
  ids.tech2 = (await owner.post('/api/r/technicians', { name: 'Bo' })).data.id;
});

test('customers can have several locations, and records are tied to the right one', async () => {
  const c = await owner.post('/api/r/customers', { name: 'Acme Holdings', type: 'commercial', email: 'ops@acme.example', phone: '555-0100' });
  ids.cust = c.data.id;
  assert.equal(c.data.stage, 'lead', 'new customers start as leads');
  const store = await owner.post('/api/r/locations', { customer_id: ids.cust, name: 'Main St store', address: '1 Main St', city: 'Springfield', gate_code: '4321' });
  const yard = await owner.post('/api/r/locations', { customer_id: ids.cust, name: 'Storage yard', address: '99 Industrial Rd', city: 'Springfield' });
  ids.store = store.data.id; ids.yard = yard.data.id;
  assert.equal(store.data.gate_code, null, 'gate codes are encrypted and hidden');
  const cam = await owner.post('/api/r/camera_systems', { customer_id: ids.cust, site_id: ids.yard, location: 'Fence line' });
  assert.equal(cam.data.site_id_label.startsWith('Storage yard'), true);
  const other = (await owner.post('/api/r/customers', { name: 'Other', type: 'residential' })).data.id;
  assert.equal((await owner.post('/api/r/camera_systems', { customer_id: other, site_id: ids.yard })).status, 400, "can't use another customer's location");
  const call = await owner.post('/api/r/service_calls', { customer_id: ids.cust, site_id: ids.store, title: 'Door contact' });
  assert.match(call.data.customer_address, /1 Main St/, 'the job address is the location address');
});

test('businesses can sit under one owner account, without loops', async () => {
  const biz = await owner.post('/api/r/customers', { name: 'Acme Diner', type: 'commercial', parent_id: ids.cust });
  assert.equal(biz.data.parent_id_label, 'Acme Holdings');
  assert.equal((await owner.get(`/api/r/customers?parent_id=${ids.cust}`)).data.length, 1);
  assert.equal((await owner.put(`/api/r/customers/${ids.cust}`, { parent_id: biz.data.id })).status, 400, 'no loops');
  assert.equal((await owner.put(`/api/r/customers/${ids.cust}`, { parent_id: ids.cust })).status, 400);
});

test('stages move with the work and are logged', async () => {
  await owner.post('/api/r/service_calls', { customer_id: ids.cust, title: 'Site survey', call_type: 'estimate', technician_id: ids.tech, scheduled_start: '2031-01-05T09:00' });
  assert.equal(stageOf(ids.cust), 'site survey');
  await owner.put(`/api/r/customers/${ids.cust}`, { stage: 'accepted' });
  const inst = await owner.post('/api/r/service_calls', { customer_id: ids.cust, title: 'Install', call_type: 'installation', technician_id: ids.tech, scheduled_start: '2031-01-12T08:00', duration_hours: 6 });
  assert.equal(stageOf(ids.cust), 'installation');
  await owner.put(`/api/r/service_calls/${inst.data.id}`, { status: 'completed', labor_hours: 6 });
  assert.equal(stageOf(ids.cust), 'active');
  assert.equal(db.prepare('SELECT status FROM customers WHERE id = ?').get(ids.cust).status, 'active');
  // An active customer booking another install stays active
  await owner.post('/api/r/service_calls', { customer_id: ids.cust, title: 'Add cameras', call_type: 'installation', technician_id: ids.tech, scheduled_start: '2031-02-01T08:00' });
  assert.equal(stageOf(ids.cust), 'active');
  const log = (await owner.get(`/api/customers/${ids.cust}/stage-log`)).data;
  assert.deepEqual(log.map(l => l.to_stage).reverse(), ['lead', 'site survey', 'accepted', 'installation', 'active']);
  const board = (await owner.get('/api/pipeline')).data;
  assert.ok(board.some(r => r.id === ids.cust));
});

test('double-booking a technician is blocked (owners/admins may override)', async () => {
  const a = await owner.post('/api/r/service_calls', { customer_id: ids.cust, title: 'Morning job', technician_id: ids.tech2, scheduled_start: '2031-03-03T09:00', duration_hours: 2 });
  assert.equal(a.status, 200);
  ids.morning = a.data.id;
  const clash = await owner.post('/api/r/service_calls', { customer_id: ids.cust, title: 'Overlap', technician_id: ids.tech2, scheduled_start: '2031-03-03T10:30', duration_hours: 1 });
  assert.equal(clash.status, 409);
  assert.equal(clash.data.code, 'conflict');
  assert.match(clash.data.error, /Bo is already booked .* SC-\d+/);
  assert.equal(clash.data.canOverride, true);
  // Back-to-back is fine; another tech is fine
  assert.equal((await owner.post('/api/r/service_calls', { customer_id: ids.cust, title: 'After', technician_id: ids.tech2, scheduled_start: '2031-03-03T11:00', duration_hours: 1 })).status, 200);
  assert.equal((await owner.post('/api/r/service_calls', { customer_id: ids.cust, title: 'Other tech', technician_id: ids.tech, scheduled_start: '2031-03-03T10:30' })).status, 200);
  // Moving an existing job onto a booked slot is blocked too
  const late = await owner.post('/api/r/service_calls', { customer_id: ids.cust, title: 'Late', technician_id: ids.tech2, scheduled_start: '2031-03-03T15:00' });
  assert.equal((await owner.put(`/api/r/service_calls/${late.data.id}`, { scheduled_start: '2031-03-03T09:30' })).status, 409);
  // Override
  assert.equal((await owner.put(`/api/r/service_calls/${late.data.id}`, { scheduled_start: '2031-03-03T09:30', allow_conflict: true })).status, 200);
  // Technicians and sales can't override
  await owner.post('/api/users', { name: 'Sal', email: 'sal@example.com', password: 'password123', role: 'sales' });
  const sales = client();
  await sales.post('/api/auth/login', { email: 'sal@example.com', password: 'password123' });
  const r = await sales.post('/api/r/service_calls', { customer_id: ids.cust, title: 'Survey', call_type: 'estimate', technician_id: ids.tech2, scheduled_start: '2031-03-03T09:15', allow_conflict: false });
  assert.equal(r.status, 409);
  assert.equal(r.data.canOverride, false);
  // Cancelled jobs free the slot
  await owner.put(`/api/r/service_calls/${ids.morning}`, { status: 'cancelled' });
  await owner.put(`/api/r/service_calls/${late.data.id}`, { status: 'cancelled' });
  assert.equal((await sales.post('/api/r/service_calls', { customer_id: ids.cust, title: 'Survey', call_type: 'estimate', technician_id: ids.tech2, scheduled_start: '2031-03-03T09:15' })).status, 200);
});

test('calendar feeds for Outlook/Google: central and per technician, secret links', async () => {
  const soon = new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10);
  await owner.post('/api/r/service_calls', { customer_id: ids.cust, title: 'Panel swap', technician_id: ids.tech, scheduled_start: `${soon}T08:00` });
  await owner.post('/api/r/service_calls', { customer_id: ids.cust, title: 'Camera check', technician_id: ids.tech2, scheduled_start: `${soon}T13:00` });
  const { zonedToUtc } = await import('../server/calendar.js');
  assert.equal(zonedToUtc('2031-01-12T08:00', 'America/New_York').toISOString(), '2031-01-12T13:00:00.000Z', 'EST');
  assert.equal(zonedToUtc('2031-07-12T08:00', 'America/New_York').toISOString(), '2031-07-12T12:00:00.000Z', 'EDT');
  assert.equal(zonedToUtc('2031-07-12T08:00', 'America/Los_Angeles').toISOString(), '2031-07-12T15:00:00.000Z');
  const feeds = (await owner.get('/api/calendar/feeds')).data;
  assert.ok(feeds.central.includes('/api/cal/central-'));
  const tess = feeds.technicians.find(t => t.name === 'Tess');
  const ics = await fetch(tess.url.replace(/^https?:\/\/[^/]+/, base));
  assert.equal(ics.status, 200);
  assert.match(ics.headers.get('content-type'), /text\/calendar/);
  const body = await ics.text();
  assert.match(body, /BEGIN:VCALENDAR/);
  assert.match(body, /SUMMARY:Acme Holdings — Panel swap/);
  assert.ok(!body.includes('Camera check'), "a tech's feed only has their own jobs");
  const central = await (await fetch(feeds.central.replace(/^https?:\/\/[^/]+/, base))).text();
  assert.match(central, /SUMMARY:\[Bo\] Acme Holdings — Camera check/, 'central feed names the tech');
  assert.equal((await fetch(`${base}/api/cal/central-wrongwrongwrongwrong.ics`)).status, 404);
  // Each change bumps the revision so calendar apps update the event
  const job = (await owner.get(`/api/r/service_calls?title=Install`)).data[0];
  const seq = job.cal_sequence || 0;
  await owner.put(`/api/r/service_calls/${job.id}`, { scheduled_start: '2031-01-13T08:00' });
  assert.equal((await owner.get(`/api/r/service_calls/${job.id}`)).data.cal_sequence, seq + 1);
});

export { owner, ids, db, base };
