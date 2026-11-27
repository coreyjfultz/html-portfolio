// Field operations: truck stock & weekly counts, tools, job materials, start-of-day check,
// time clock with geofence, on-call schedule & phone, vehicle tracking & travel time.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'secureops-field-'));
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
  const call = async (method, url, body, { csrf = true, raw = false, headers: extra = {} } = {}) => {
    const headers = { cookie, ...extra };
    if (csrf) headers['X-Requested-With'] = 'SecureOps';
    if (body !== undefined && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body), redirect: 'manual' });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    if (raw) return res;
    const text = await res.text();
    let data = null; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  };
  return { call, get: u => call('GET', u), post: (u, b = {}) => call('POST', u, b), put: (u, b = {}) => call('PUT', u, b), del: u => call('DELETE', u) };
}
const owner = client();
const tech = client();
const ids = {};
const today = () => { const d = new Date(); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const qty = (item, loc) => db.prepare('SELECT qty FROM stock WHERE item_id = ? AND location_id = ?').get(item, loc)?.qty || 0;

test('setup', async () => {
  await owner.post('/api/auth/setup', { name: 'Olivia Owner', email: 'owner@example.com', password: 'password123', company_name: 'Field Co' });
  await owner.put('/api/settings', { require_photos: '0', require_parts: '0' });
  ids.tech = (await owner.post('/api/r/technicians', { name: 'Tess', phone: '555-201-0001', email: 'tess@example.com' })).data.id;
  ids.tech2 = (await owner.post('/api/r/technicians', { name: 'Bo', phone: '555-201-0002' })).data.id;
  await owner.post('/api/users', { name: 'Tess', email: 'tess-login@example.com', password: 'password123', role: 'technician', technician_id: ids.tech });
  assert.equal((await tech.post('/api/auth/login', { email: 'tess-login@example.com', password: 'password123' })).status, 200);
  ids.truck = (await owner.post('/api/r/vehicles', { unit_name: 'Truck 1', assigned_technician_id: ids.tech })).data.id;
  ids.truck2 = (await owner.post('/api/r/vehicles', { unit_name: 'Truck 2', assigned_technician_id: ids.tech2 })).data.id;
  ids.battery = (await owner.post('/api/r/inventory_items', { name: '12V 7Ah battery', category: 'power & batteries', unit_cost: 18, unit_price: 45, truck_min: 3, truck_max: 4 })).data.id;
  ids.contact = (await owner.post('/api/r/inventory_items', { name: 'Door contact', category: 'sensors & detectors', unit_cost: 6, unit_price: 25, truck_min: 6 })).data.id;
  ids.camera = (await owner.post('/api/r/inventory_items', { name: '4MP dome camera', category: 'cameras', unit_cost: 90, unit_price: 249 })).data.id;
  for (const [item, n] of [[ids.battery, 20], [ids.contact, 50], [ids.camera, 10]]) await owner.post('/api/stock/receive', { item_id: item, qty: n, location_id: 0 });
  ids.cust = (await owner.post('/api/r/customers', { name: 'Harbor Dental', type: 'commercial', phone: '555-301-0001', address: '10 Harbor Way', city: 'Springfield' })).data.id;
});

test('standard truck stock: every truck gets the basics, short and extra are flagged, restock and return in one tap', async () => {
  let ts = (await owner.get(`/api/vehicles/${ids.truck}/truck-stock`)).data;
  const bat = ts.stock.find(s => s.item_id === ids.battery);
  assert.deepEqual([bat.min, bat.max, bat.on_hand, bat.need, bat.status], [3, 4, 0, 3, 'short']);
  assert.equal(ts.stock.find(s => s.item_id === ids.contact).max, 7, 'max defaults to standard + 1');
  assert.equal(ts.stock.some(s => s.item_id === ids.camera), false, 'non-standard items not on board are not listed');

  // Restock fills every truck up to its standard from the warehouse
  assert.equal((await tech.post(`/api/vehicles/${ids.truck}/restock`, { direction: 'load' })).data.moved, 2);
  assert.equal(qty(ids.battery, ids.truck), 3);
  assert.equal(qty(ids.battery, 0), 17);
  assert.equal((await tech.post(`/api/vehicles/${ids.truck2}/restock`, { direction: 'load' })).status, 403, "techs can't load someone else's truck");

  // Too many extras get flagged and go back
  await owner.post('/api/stock/transfer', { item_id: ids.contact, qty: 4, from: 0, to: ids.truck });
  ts = (await owner.get(`/api/vehicles/${ids.truck}/truck-stock`)).data;
  assert.equal(ts.stock.find(s => s.item_id === ids.contact).extra, 3);
  await tech.post(`/api/vehicles/${ids.truck}/restock`, { direction: 'return' });
  assert.equal(qty(ids.contact, ids.truck), 7);

  // Per-truck exception
  assert.equal((await owner.post('/api/r/truck_par', { vehicle_id: ids.truck2, item_id: ids.battery, min_qty: 6, max_qty: 8 })).status, 200);
  assert.equal((await owner.post('/api/r/truck_par', { vehicle_id: ids.truck2, item_id: ids.battery, min_qty: 1 })).status, 409);
  ts = (await owner.get(`/api/vehicles/${ids.truck2}/truck-stock`)).data;
  assert.equal(ts.stock.find(s => s.item_id === ids.battery).min, 6);
  assert.equal((await tech.post('/api/r/truck_par', { vehicle_id: ids.truck, item_id: ids.camera, min_qty: 1 })).status, 403, 'only the office sets truck stock');
});

test('weekly truck count covers every item and tool; variances adjust stock and alert the owner', async () => {
  ids.ladder = (await owner.post('/api/r/tools', { name: '8ft ladder', tag: 'L-01', category: 'ladders & lifts', vehicle_id: ids.truck })).data.id;
  ids.meter = (await owner.post('/api/r/tools', { name: 'Multimeter', tag: 'M-07', category: 'meters & testers', vehicle_id: ids.truck })).data.id;
  assert.equal((await tech.post('/api/r/tools', { name: 'Mine now' })).status, 403);
  const sheet = (await tech.get(`/api/vehicles/${ids.truck}/count-sheet`)).data;
  assert.equal(sheet.items.length, 2);
  assert.equal(sheet.tools.length, 2);
  assert.equal((await tech.get(`/api/vehicles/${ids.truck2}/count-sheet`)).status, 403);

  // Incomplete counts are refused
  let r = await tech.post(`/api/vehicles/${ids.truck}/counts`, { items: [{ item_id: ids.battery, counted: 3 }], tools: [] });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /Door contact/);

  r = await tech.post(`/api/vehicles/${ids.truck}/counts`, {
    items: [{ item_id: ids.battery, counted: 1 }, { item_id: ids.contact, counted: 7 }],
    tools: [{ tool_id: ids.ladder, condition: 'ok' }, { tool_id: ids.meter, condition: 'missing' }],
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.variance_lines, 1);
  assert.equal(r.data.variance_value, -36);
  assert.equal(r.data.tool_issues, 1);
  assert.equal(r.data.restock[0].item_id, ids.battery, 'restock list comes back right away');
  assert.equal(qty(ids.battery, ids.truck), 1, 'stock now matches what was counted');
  assert.equal(db.prepare('SELECT status FROM tools WHERE id = ?').get(ids.meter).status, 'missing');
  assert.equal(db.prepare('SELECT last_counted FROM tools WHERE id = ?').get(ids.ladder).last_counted, today());

  const alerts = (await owner.get('/api/alerts')).data;
  const a = alerts.find(x => x.kind === 'truck_count');
  assert.match(a.title, /Truck 1 count: 1 item off, 1 tool issue \(-\$36\.00\)/);
  assert.match(a.body, /Multimeter #M-07: missing/);
  assert.equal((await tech.get('/api/alerts')).status, 403, 'technicians do not see owner alerts');
  await notifyIdle();
  assert.ok(db.prepare("SELECT 1 FROM notifications WHERE related_type = 'alert' AND to_addr = 'owner@example.com'").get(), 'owner is emailed');

  // Office overview: Truck 2 has never been counted
  const ov = (await owner.get('/api/truck-stock')).data.vehicles;
  assert.equal(ov.find(v => v.vehicle_id === ids.truck).due, false);
  assert.equal(ov.find(v => v.vehicle_id === ids.truck2).due, true);
  const detail = (await owner.get(`/api/truck-counts/${r.data.id}`)).data;
  assert.equal(detail.lines.length, 4);
  await owner.post(`/api/truck-counts/${r.data.id}/review`);
  assert.equal((await owner.get('/api/alerts')).data.some(x => x.kind === 'truck_count'), false, 'reviewing clears the alert');
});

test('weekly count reminders go to the tech on count day; overdue trucks are flagged', async () => {
  const { truckCountReminders } = await import('../server/truckstock.js');
  const now = new Date(); now.setHours(9);
  await owner.put('/api/settings', { truck_count_day: String(now.getDay()) });
  truckCountReminders(db, now);
  await notifyIdle();
  const sms = db.prepare("SELECT * FROM notifications WHERE related_type = 'truck_count' AND related_id = ?").all(ids.truck2);
  assert.equal(sms.length, 1);
  assert.match(sms[0].body, /Weekly truck count is due for Truck 2/);
  truckCountReminders(db, now);
  await notifyIdle();
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE related_type = 'truck_count'").get().n, 1, 'once per day');
  await owner.put('/api/settings', { truck_count_day: String((now.getDay() + 3) % 7) });
  truckCountReminders(db, now);
  assert.ok((await owner.get('/api/alerts')).data.find(a => a.kind === 'count_overdue' && /Truck 2/.test(a.title)));
});

test('job materials: planned from the proposal, checked out of the warehouse onto the tech’s truck, unused returned', async () => {
  const job = (await owner.post('/api/r/service_calls', { customer_id: ids.cust, title: 'Camera install', call_type: 'installation', technician_id: ids.tech, scheduled_start: `${today()}T23:00`, duration_hours: 0.5, allow_conflict: true })).data;
  ids.job = job.id;
  assert.equal((await owner.post('/api/r/job_materials', { service_call_id: job.id, item_id: ids.camera, qty: 4 })).status, 200);
  const r = await tech.post(`/api/service_calls/${job.id}/materials/checkout`, {});
  assert.equal(r.status, 200);
  assert.equal(r.data.vehicle, 'Truck 1');
  assert.equal(qty(ids.camera, 0), 6);
  assert.equal(qty(ids.camera, ids.truck), 4);
  const mats = (await tech.get(`/api/service_calls/${job.id}/materials`)).data;
  assert.equal(mats[0].status, 'checked out');
  assert.equal((await tech.post(`/api/service_calls/${job.id}/materials/checkout`, {})).status, 400, 'nothing left to check out');
  await tech.post(`/api/service_calls/${job.id}/materials/return`, { id: mats[0].id, qty: 1 });
  assert.equal(qty(ids.camera, 0), 7);
  // Signed proposals bring their inventory lines over to the install job
  const { materialsFromProposal } = await import('../server/truckstock.js');
  assert.equal(typeof materialsFromProposal, 'function');
});

test('start-of-day check: required before a tech can start a job; short items alert the office; only admins can override', async () => {
  await owner.put(`/api/r/service_calls/${ids.job}`, { status: 'scheduled' });
  await owner.post('/api/r/job_materials', { service_call_id: ids.job, item_id: ids.battery, qty: 2 });
  let rd = (await tech.get('/api/readiness')).data;
  assert.equal(rd.vehicle.unit_name, 'Truck 1');
  assert.equal(rd.cleared, false);
  const bat = rd.lines.find(l => l.item_id === ids.battery);
  assert.deepEqual([bat.needed, bat.on_truck, bat.short, bat.spare_ok], [2, 1, 1, false]);
  assert.equal(rd.tools.length, 1, 'the missing meter is not expected on the truck');

  let r = await tech.post(`/api/service_calls/${ids.job}/on-my-way`, {});
  assert.equal(r.status, 400);
  assert.equal(r.data.code, 'readiness_required');

  assert.equal((await tech.post('/api/readiness', { confirmed: [ids.camera], tools_ok: true })).status, 400, 'every line must be answered');
  rd = (await tech.post('/api/readiness', { confirmed: [ids.camera], missing: [{ item_id: ids.battery, name: '12V 7Ah battery', note: 'only have 1' }], tools_ok: true })).data;
  assert.equal(rd.check.status, 'short');
  assert.ok((await owner.get('/api/alerts')).data.find(a => a.kind === 'readiness_short'));
  assert.equal((await tech.put(`/api/r/service_calls/${ids.job}`, { status: 'in progress' })).data.code, 'readiness_required');

  // Tech can't approve themselves; the admin can, with a reason
  assert.equal((await tech.post('/api/readiness/approve', { technician_id: ids.tech, reason: 'eh' })).status, 403);
  assert.equal((await owner.post('/api/readiness/approve', { technician_id: ids.tech })).status, 400, 'reason required');
  rd = (await owner.post('/api/readiness/approve', { technician_id: ids.tech, reason: 'Bo is meeting him with batteries' })).data;
  assert.equal(rd.cleared, true);
  assert.equal((await owner.get('/api/alerts')).data.some(a => a.kind === 'readiness_short'), false);
  assert.equal((await tech.post(`/api/service_calls/${ids.job}/on-my-way`, {})).status, 200);

  const board = (await owner.get('/api/readiness/today')).data;
  assert.equal(board.find(t => t.technician_id === ids.tech).status, 'approved');
  // Office users aren't blocked (they are the override)
  const job2 = (await owner.post('/api/r/service_calls', { customer_id: ids.cust, title: 'Other', technician_id: ids.tech2, scheduled_start: `${today()}T23:30`, duration_hours: 0.25, allow_conflict: true })).data;
  assert.equal((await owner.put(`/api/r/service_calls/${job2.id}`, { status: 'in progress' })).status, 200);
});

test('time clock: in/out with location; away from the office alerts the owner; job sites are fine; timesheets & export', async () => {
  await owner.put('/api/settings', { office_lat: '39.9242', office_lng: '-83.8088', office_radius_m: '300' });
  // At the office: no alert
  let r = await tech.post('/api/timeclock/in', { lat: 39.9250, lng: -83.8090, accuracy: 20 });
  assert.equal(r.status, 200);
  assert.equal(r.data.flag, 'office');
  assert.equal((await tech.post('/api/timeclock/in', { lat: 39.9250, lng: -83.8090 })).status, 409, 'already clocked in');
  const me = (await tech.get('/api/timeclock/me')).data;
  assert.ok(me.open);
  assert.equal((await owner.get('/api/timeclock/now')).data.length, 1);
  r = await tech.post('/api/timeclock/out', {});
  assert.equal(r.data.flag, 'no location');
  assert.equal((await owner.get('/api/alerts')).data.some(a => a.kind === 'clock_location'), false, 'clock-out alerts are off by default');

  // 5 miles away: owner alerted with a map link
  r = await tech.post('/api/timeclock/in', { lat: 39.99, lng: -83.75, accuracy: 15 });
  assert.equal(r.data.flag, 'away');
  let alert = (await owner.get('/api/alerts')).data.find(a => a.kind === 'clock_location');
  assert.match(alert.title, /Tess clocked in [\d.]+ mi from the office/);
  assert.match(alert.body, /google\.com\/maps\?q=39\.99,-83\.75/);
  await owner.post(`/api/alerts/${alert.id}/resolve`);
  await tech.post('/api/timeclock/out', { lat: 39.99, lng: -83.75 });

  // No location shared: alert
  await tech.post('/api/timeclock/in', {});
  alert = (await owner.get('/api/alerts')).data.find(a => a.kind === 'clock_location');
  assert.match(alert.title, /without sharing a location/);
  await owner.post(`/api/alerts/${alert.id}/resolve`);
  await tech.post('/api/timeclock/out', {});

  // At a job site they're scheduled for today: fine
  await owner.put(`/api/r/customers/${ids.cust}`, { lat: 40.01, lng: -83.70 });
  r = await tech.post('/api/timeclock/in', { lat: 40.0105, lng: -83.7004, accuracy: 30 });
  assert.equal(r.data.flag, 'job site');
  assert.match(r.data.where, /Harbor Dental/);
  assert.equal((await owner.get('/api/alerts')).data.some(a => a.kind === 'clock_location'), false);

  // Office corrections need a reason; techs can't edit
  const entries = (await owner.get(`/api/timeclock/entries?from=${today()}&to=${today()}`)).data;
  assert.equal(entries.length, 4);
  const open = entries.find(e => e.open);
  assert.equal((await tech.put(`/api/timeclock/entries/${open.id}`, { clock_out: `${today()}T23:59`, reason: 'x' })).status, 403);
  assert.equal((await owner.put(`/api/timeclock/entries/${open.id}`, { clock_in: `${today()}T00:01`, clock_out: `${today()}T08:01` })).status, 400);
  assert.equal((await owner.put(`/api/timeclock/entries/${open.id}`, { clock_in: `${today()}T00:01`, clock_out: `${today()}T08:01`, reason: 'Forgot to clock out' })).status, 200);
  const other = (await owner.get('/api/users')).data.find(u => u.role === 'owner').id;
  assert.equal((await owner.post('/api/timeclock/entries', { user_id: other, clock_in: '2026-01-05T08:00', clock_out: '2026-01-05T07:00', reason: 'x' })).status, 400);
  const ts = (await owner.get(`/api/timeclock/timesheet?from=${today()}&to=${today()}`)).data;
  const tess = ts.people.find(p => p.name === 'Tess');
  assert.ok(tess.hours >= 8 && tess.hours < 8.2, `hours ${tess.hours}`);
  assert.equal(tess.flagged, 3, 'away and no-location punches are flagged');
  const csv = await owner.call('GET', `/api/timeclock/export?from=${today()}&to=${today()}`, undefined, { raw: true });
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  const text = await csv.text();
  assert.match(text, /Employee,Role,Date,Clock in/);
  assert.match(text, /Forgot to clock out/);
  assert.equal((await tech.get('/api/timeclock/timesheet')).status, 403);
});

export { owner, tech, ids, db, client, today, notifyIdle };
