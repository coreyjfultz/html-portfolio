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
export const getBase = () => base;
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

test('on-call rotation: shifts can’t overlap, land on the tech’s calendar feed, and invites go out', async () => {
  const start = (() => { const d = new Date(Date.now() - 2 * 86400e3); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; })();
  assert.equal((await tech.post('/api/oncall/rotation', { technician_ids: [ids.tech], start })).status, 403);
  const r = await owner.post('/api/oncall/rotation', { technician_ids: [ids.tech, ids.tech2], start, handoff: '08:00', days: 7, shifts: 4 });
  assert.equal(r.data.created, 4);
  const shifts = (await owner.get('/api/r/on_call_shifts')).data;
  assert.equal(shifts[0].technician_id, ids.tech);
  assert.equal(shifts[0].backup_technician_id, ids.tech2);
  assert.equal(shifts[1].technician_id, ids.tech2);
  const overlap = await owner.post('/api/r/on_call_shifts', { technician_id: ids.tech2, starts_at: `${start}T12:00`, ends_at: `${start}T18:00` });
  assert.equal(overlap.status, 409);
  const now = (await tech.get('/api/oncall/now')).data;
  assert.equal(now.current.tech_name, 'Tess');
  assert.equal(now.current.tech_phone, undefined, 'phone numbers are not exposed');
  await notifyIdle();
  const invite = db.prepare("SELECT * FROM notifications WHERE related_type = 'on_call' AND channel = 'email' AND to_addr = 'tess@example.com'").get();
  assert.match(invite.subject, /You're on call/);
  assert.ok(db.prepare("SELECT 1 FROM notifications WHERE related_type = 'on_call' AND channel = 'sms'").get(), 'tech gets a text too');
  const token = db.prepare('SELECT calendar_token FROM technicians WHERE id = ?').get(ids.tech).calendar_token;
  const ics = await (await fetch(`${base}/api/cal/tech-${token}.ics`)).text();
  assert.match(ics, /SUMMARY:On call — Field Co/);
  assert.match(ics, /SUMMARY:On-call backup — Field Co/);
  ids.shift = shifts[0].id;
});

test('company phone: after-hours calls ring the on-call tech (press 1), then the backup, then voicemail; signatures are checked', async () => {
  const { twilioSignature } = await import('../server/phone.js');
  const twilioCalls = [];
  const http = await import('node:http');
  const fake = http.createServer((req, res) => { let b = ''; req.on('data', c => b += c); req.on('end', () => { twilioCalls.push({ url: req.url, body: Object.fromEntries(new URLSearchParams(b)) }); res.writeHead(201, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ sid: 'CA' + twilioCalls.length })); }); });
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  process.env.TWILIO_API_BASE = `http://127.0.0.1:${fake.address().port}`;
  try {
    // Office closed all week so the on-call path runs regardless of when the test runs.
    await owner.put('/api/settings', { twilio_sid: 'AC123', twilio_token: 'tok_abc', twilio_from: '+15555550100', voice_enabled: '1', public_url: base, office_days: '', office_phone: '555-555-0199' });
    const setup = (await owner.get('/api/phone/setup')).data;
    assert.equal(setup.ok, true);
    const hookBase = setup.incoming_url.replace(/\/incoming$/, '');
    const twilio = async (path, params, { sign = true } = {}) => {
      const url = `${hookBase}${path}`;
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(sign ? { 'X-Twilio-Signature': twilioSignature('tok_abc', url, params) } : {}) }, body: new URLSearchParams(params) });
      return { status: res.status, xml: await res.text() };
    };
    assert.equal((await twilio('/incoming', { CallSid: 'CA9', From: '+15553010001', To: '+15555550100' }, { sign: false })).status, 403, 'unsigned requests are refused');
    const bad = await fetch(`${hookBase}/incoming`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': 'nope' }, body: 'From=1' });
    assert.equal(bad.status, 403);

    // Harbor Dental calls after hours
    let r = await twilio('/incoming', { CallSid: 'CA100', From: '+15553010001', To: '+15555550100' });
    assert.equal(r.status, 200);
    assert.match(r.xml, /Our office is closed/);
    assert.match(r.xml, /<Number url="[^"]*whisper\?call=\d+&amp;tech=\d+">\+15552010001<\/Number>/, 'rings Tess (on call)');
    const callId = Number(r.xml.match(/call=(\d+)/)[1]);
    const row = () => db.prepare('SELECT * FROM phone_calls WHERE id = ?').get(callId);
    assert.equal(row().customer_id, ids.cust, 'caller recognised');
    // Whisper asks the tech to press 1
    r = await twilio(`/whisper?call=${callId}&tech=${ids.tech}`, {});
    assert.match(r.xml, /After hours call from Harbor Dental\. Press 1 to accept/);
    // Tess doesn't answer → Bo (backup)
    r = await twilio(`/dial-result?call=${callId}&step=0`, { DialCallStatus: 'no-answer' });
    assert.match(r.xml, /\+15552010002/);
    // Voicemail picks up on Bo's phone but nobody pressed 1 → still not answered → voicemail
    r = await twilio(`/dial-result?call=${callId}&step=1`, { DialCallStatus: 'completed' });
    assert.match(r.xml, /<Record /);
    r = await twilio(`/voicemail?call=${callId}`, { RecordingUrl: 'https://api.twilio.com/rec/RE1', RecordingDuration: '22' });
    assert.equal(row().status, 'voicemail');
    assert.ok((await owner.get('/api/alerts')).data.find(a => a.kind === 'voicemail' && /Harbor Dental/.test(a.title)));

    // Second call: Tess presses 1 → answered and she gets access to the customer for a day
    r = await twilio('/incoming', { CallSid: 'CA101', From: '+15553010001', To: '+15555550100' });
    const id2 = Number(r.xml.match(/call=(\d+)/)[1]);
    db.prepare('DELETE FROM tech_access_grants').run();
    db.prepare("UPDATE service_calls SET technician_id = ? WHERE customer_id = ?").run(ids.tech2, ids.cust);
    assert.equal((await tech.get(`/api/r/customers/${ids.cust}`)).status, 404, 'not on Tess’s schedule now');
    r = await twilio(`/accept?call=${id2}&tech=${ids.tech}`, { Digits: '1' });
    assert.match(r.xml, /Connecting/);
    r = await twilio(`/dial-result?call=${id2}&step=0`, { DialCallStatus: 'completed' });
    assert.match(r.xml, /<Hangup\/>/);
    assert.equal(db.prepare('SELECT answered_by FROM phone_calls WHERE id = ?').get(id2).answered_by, 'Tess');
    assert.equal((await tech.get(`/api/r/customers/${ids.cust}`)).status, 200, 'answering grants access');
    db.prepare("UPDATE service_calls SET technician_id = ? WHERE customer_id = ?").run(ids.tech, ids.cust);

    // Office hours → office line
    await owner.put('/api/settings', { office_days: '0,1,2,3,4,5,6', office_open: '00:00', office_close: '23:59' });
    r = await twilio('/incoming', { CallSid: 'CA102', From: '+15559998888', To: '+15555550100' });
    assert.match(r.xml, /<Number>\+15555550199<\/Number>/);
    assert.doesNotMatch(r.xml, /Our office is closed/);

    // Per-tech number rings that tech directly, any time
    await owner.put(`/api/r/technicians/${ids.tech2}`, { twilio_number: '555-555-0177' });
    r = await twilio('/incoming', { CallSid: 'CA103', From: '+15559998888', To: '+15555550177' });
    assert.match(r.xml, /\+15552010002/);

    // Click-to-call: rings the tech's phone, then bridges to the customer with the company number
    r = await tech.post('/api/phone/call', { customer_id: ids.cust, phone: '555-999-0000' });
    assert.equal(r.status, 403, 'techs can only dial numbers on file');
    r = await tech.post('/api/phone/call', { customer_id: ids.cust });
    assert.equal(r.status, 200);
    const out = twilioCalls.at(-1);
    assert.match(out.url, /\/Accounts\/AC123\/Calls\.json$/);
    assert.equal(out.body.To, '+15552010001', 'rings Tess first');
    assert.equal(out.body.From, '+15555550100');
    const bridge = await twilio(new URL(out.body.Url).pathname.replace(/.*\/voice\/[^/]+/, '') + new URL(out.body.Url).search, {});
    assert.match(bridge.xml, /Connecting you to Harbor Dental/);
    assert.match(bridge.xml, /<Dial callerId="\+15555550100"[^>]*>\+15553010001<\/Dial>/);
    // Office user without a phone is asked for one
    r = await owner.post('/api/phone/call', { phone: '555-999-0000' });
    assert.equal(r.data.code, 'need_phone');
    await owner.put('/api/phone/my-number', { phone: '555-123-4567' });
    assert.equal((await owner.post('/api/phone/call', { phone: '555-999-0000' })).status, 200, 'office can dial any number');
    const log = (await tech.get('/api/phone/calls')).data;
    assert.ok(log.some(c => c.direction === 'outbound' && c.user_id));
    assert.ok(!log.some(c => c.to_number === '+15559990000'), 'techs only see their own calls');
  } finally {
    delete process.env.TWILIO_API_BASE;
    await owner.put('/api/settings', { voice_enabled: '0', office_days: '1,2,3,4,5', office_open: '08:00', office_close: '17:00' });
    fake.close();
  }
});

test('vehicle tracking (Samsara / push feed), address lookup, drive times, and travel-time checks when scheduling', async () => {
  const http = await import('node:http');
  const seen = [];
  const fake = http.createServer((req, res) => {
    seen.push(req.url + ' ' + (req.headers.authorization || ''));
    const send = d => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
    if (req.url.startsWith('/fleet/vehicles/locations')) return send({ data: [
      { id: 'sam-1', name: 'Truck 1', location: { latitude: 39.95, longitude: -83.80, speed: 34, heading: 90, time: new Date().toISOString(), reverseGeo: { formattedLocation: 'Main St, Springfield' } } },
      { id: 'sam-9', name: 'Unknown van', location: { latitude: 1, longitude: 1 } }] });
    if (req.url.startsWith('/search')) return send([{ lat: '39.9300', lon: '-83.8000' }]);
    if (req.url.startsWith('/route/v1/driving/')) return send({ routes: [{ duration: 25 * 60 }] });
    res.writeHead(404); res.end();
  });
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  const fb = `http://127.0.0.1:${fake.address().port}`;
  Object.assign(process.env, { SAMSARA_API_BASE: fb, NOMINATIM_BASE: fb, OSRM_BASE: fb });
  try {
    await owner.put('/api/settings', { tracking_provider: 'samsara', samsara_token: 'samsara-secret', geocoder: 'nominatim', routing: 'osrm', travel_buffer_min: '10', avg_speed_mph: '30' });
    assert.equal((await owner.get('/api/settings')).data.samsara_token, undefined, 'token never sent back');
    const poll = (await owner.post('/api/tracking/refresh')).data;
    assert.equal(poll.error, null);
    assert.equal(poll.count, 1, 'matched Truck 1 by name; unknown vehicles ignored');
    assert.ok(seen.some(u => u.includes('Bearer samsara-secret')));
    const live = (await owner.get('/api/tracking/live')).data;
    const t1 = live.vehicles.find(v => v.vehicle_id === ids.truck);
    assert.equal(t1.lat, 39.95);
    assert.equal(t1.address, 'Main St, Springfield');
    assert.equal((await tech.get('/api/tracking/live')).status, 403, 'only owners/admins see live tracking');

    // Push feed (for other providers)
    await owner.put(`/api/r/vehicles/${ids.truck2}`, { tracker_id: 'GPS-22', camera_url: 'https://cams.example/van2' });
    const tok = db.prepare("SELECT value FROM settings WHERE key = 'tracking_token'").get().value;
    assert.equal((await fetch(`${base}/api/inbound/tracking/wrong`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '[]' })).status, 404);
    const push = await fetch(`${base}/api/inbound/tracking/${tok}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([{ id: 'GPS-22', lat: 39.80, lng: -83.90, speed: 0 }]) });
    assert.equal((await push.json()).stored, 1);

    // Address lookup
    const g = (await owner.post('/api/geocode', { address: '1 Test Rd, Springfield OH' })).data;
    assert.equal(g.lat, 39.93);
    const far = (await owner.post('/api/r/customers', { name: 'Far Away Farm', type: 'commercial', service_address: '9 County Rd', city: 'Xenia' })).data;
    const near = (await owner.post('/api/r/customers', { name: 'Next Door Deli', type: 'commercial', service_address: '2 Main St', city: 'Springfield' })).data;
    db.prepare('UPDATE customers SET lat = ?, lng = ? WHERE id = ?').run(39.68, -83.93, far.id); // ~18 mi south
    db.prepare('UPDATE customers SET lat = ?, lng = ? WHERE id = ?').run(39.9245, -83.8090, near.id);
    await owner.put(`/api/r/customers/${near.id}`, { service_address: '4 Main St' });
    assert.equal(db.prepare('SELECT lat FROM customers WHERE id = ?').get(near.id).lat, null, 'moving the address clears the map point');
    db.prepare('UPDATE customers SET lat = ?, lng = ? WHERE id = ?').run(39.9245, -83.8090, near.id);

    // Travel-time check: Bo has a job at the deli 9–10; booking him at the farm at 10:05 is not possible
    const day = '2031-03-04';
    await owner.post('/api/r/service_calls', { customer_id: near.id, title: 'Keypad', technician_id: ids.tech2, scheduled_start: `${day}T09:00`, duration_hours: 1 });
    let r = await owner.post('/api/r/service_calls', { customer_id: far.id, title: 'Gate', technician_id: ids.tech2, scheduled_start: `${day}T10:05`, duration_hours: 1 });
    assert.equal(r.status, 409);
    assert.equal(r.data.code, 'conflict');
    assert.match(r.data.error, /Not enough travel time: SC-\d+ \(Next Door Deli\) ends at 10:00 AM and it's about \d+ min \(estimated\)/);
    assert.equal(r.data.canOverride, true);
    // Real drive time from the routing service gets cached and used
    const pre = (await owner.post('/api/travel-time', { customer_id: far.id, technician_id: ids.tech2, scheduled_start: `${day}T10:05`, duration_hours: 1 })).data;
    assert.equal(pre.ok, false);
    assert.match(pre.message, /about 25 min to get here plus a 10-min buffer\. Earliest arrival is 10:35 AM/);
    assert.equal((await owner.post('/api/r/service_calls', { customer_id: far.id, title: 'Gate', technician_id: ids.tech2, scheduled_start: `${day}T10:40`, duration_hours: 1 })).status, 200, 'enough time');
    // ...and the job after: 11:40 end + 25 + 10 → a 12:00 job back at the deli is too soon
    r = await owner.post('/api/r/service_calls', { customer_id: near.id, title: 'Follow-up', technician_id: ids.tech2, scheduled_start: `${day}T12:00`, duration_hours: 0.5 });
    assert.equal(r.status, 409);
    assert.match(r.data.error, /Not enough travel time to the next job|ends at 11:40 AM/);
    assert.equal((await owner.post('/api/r/service_calls', { customer_id: near.id, title: 'Follow-up', technician_id: ids.tech2, scheduled_start: `${day}T12:00`, duration_hours: 0.5, allow_conflict: true })).status, 200, 'owner can book anyway');
    await owner.put('/api/settings', { travel_check: 'off' });
    assert.equal((await owner.post('/api/r/service_calls', { customer_id: far.id, title: 'x', technician_id: ids.tech2, scheduled_start: `${day}T13:00`, duration_hours: 0.25 })).status, 200);

    // Team status: Tess (Truck 1) — live ETA to her next job uses the routing service
    const team = live.team.find(t => t.technician_id === ids.tech);
    assert.equal(team.vehicle.unit_name, 'Truck 1');
  } finally {
    for (const k of ['SAMSARA_API_BASE', 'NOMINATIM_BASE', 'OSRM_BASE']) delete process.env[k];
    await owner.put('/api/settings', { tracking_provider: 'none', geocoder: 'off', routing: 'estimate', travel_check: 'on' });
    fake.close();
  }
});

test('vehicle checklist: every item answered, problems need a note (and photos for damage), alerts the office, gates the first job', async () => {
  const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Buffer.alloc(200)]).toString('base64');
  await owner.put(`/api/r/vehicles/${ids.truck}`, { tire_psi: 65, mileage: 40000 });
  db.prepare('DELETE FROM vehicle_checks').run();
  let st = (await tech.get(`/api/vehicles/${ids.truck}/checks`)).data;
  assert.equal(st.due, true);
  assert.equal((await tech.get(`/api/vehicles/${ids.truck2}/checks`)).status, 403, "not someone else's truck");

  // Can't start a job until the truck is checked (start-of-day equipment check already done)
  db.prepare('DELETE FROM readiness_checks WHERE technician_id = ?').run(ids.tech);
  db.prepare("INSERT INTO readiness_checks (technician_id, day, status, user_name) VALUES (?, ?, 'ready', 'Tess')").run(ids.tech, today());
  const job = (await owner.post('/api/r/service_calls', { customer_id: ids.cust, title: 'Vehicle-check gate', technician_id: ids.tech, scheduled_start: `${today()}T23:45`, duration_hours: 0.1, allow_conflict: true })).data;
  let r = await tech.post(`/api/service_calls/${job.id}/on-my-way`, {});
  assert.equal(r.data.code, 'readiness_required');
  assert.match(r.data.error, /vehicle check on Truck 1/);

  const { VEHICLE_ITEMS } = await import('../public/js/vehicle-checks.js');
  const items = Object.fromEntries(VEHICLE_ITEMS.map(i => [i.id, i.kind === 'tires' ? { psi: { fl: 65, fr: 64, rl: 66, rr: 65 } } : { r: 'ok' }]));
  assert.equal((await tech.post(`/api/vehicles/${ids.truck}/checks`, { items: { oil: { r: 'ok' } } })).status, 400, 'everything must be answered');
  assert.match((await tech.post(`/api/vehicles/${ids.truck}/checks`, { items: { ...items, oil: { r: 'issue' } } })).data.error, /Say what’s wrong: Engine oil/);
  assert.match((await tech.post(`/api/vehicles/${ids.truck}/checks`, { items: { ...items, damage: { r: 'issue', note: 'Dent rear bumper' } } })).data.error, /photo of the damage/);
  assert.match((await tech.post(`/api/vehicles/${ids.truck}/checks`, { items, odometer: 39000 })).data.error, /can’t be lower/);
  r = await tech.post(`/api/vehicles/${ids.truck}/checks`, {
    items: { ...items, tire_psi: { psi: { fl: 65, fr: 52, rl: 66, rr: 65 } }, damage: { r: 'issue', note: 'Dent rear bumper' } },
    photos: [JPG], odometer: 41234,
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'issues');
  assert.equal(r.data.issues.length, 2);
  assert.match(r.data.issues[0], /Front right 52 psi/);
  assert.equal(db.prepare('SELECT mileage FROM vehicles WHERE id = ?').get(ids.truck).mileage, 41234, 'mileage updated');
  const alert = (await owner.get('/api/alerts')).data.find(a => a.kind === 'vehicle_check');
  assert.match(alert.title, /Truck 1: 2 problems/);
  assert.equal(alert.severity, 'bad', 'damage is serious');
  st = (await tech.get(`/api/vehicles/${ids.truck}/checks`)).data;
  assert.equal(st.due, false);
  assert.equal((await tech.call('GET', st.checks[0].photos[0], undefined, { raw: true })).status, 200);
  assert.equal((await tech.post(`/api/service_calls/${job.id}/on-my-way`, {})).status, 200, 'checked → can go');
  await owner.post(`/api/vehicle-checks/${st.checks[0].id}/review`);
  assert.ok(!(await owner.get('/api/alerts')).data.some(a => a.kind === 'vehicle_check'));
  const board = (await owner.get('/api/vehicle-checks/today')).data;
  assert.equal(board.find(v => v.vehicle_id === ids.truck).due, false);
  assert.equal(board.find(v => v.vehicle_id === ids.truck2).due, true);
});

test('serialized equipment used on a job needs serial numbers and a label photo; it lands on the customer’s equipment list with warranty dates', async () => {
  await owner.put('/api/settings', { require_signature: '0', require_serials: '1', require_serial_photos: '1' });
  const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Buffer.alloc(200)]).toString('base64');
  const cam = (await owner.post('/api/r/inventory_items', { name: '4K bullet camera', sku: 'CAM-4KB', serialized: 1, warranty_months: 36, unit_cost: 80, unit_price: 199 })).data;
  await owner.post('/api/stock/receive', { item_id: cam.id, qty: 5, location_id: ids.truck });
  const job = (await owner.post('/api/r/service_calls', { customer_id: ids.cust, title: 'Add two cameras', technician_id: ids.tech, scheduled_start: `${today()}T23:50`, duration_hours: 0.1, allow_conflict: true })).data;
  assert.equal((await tech.post('/api/r/service_call_parts', { service_call_id: job.id, item_id: cam.id, qty: 2 })).status, 200);
  let eq = (await tech.get(`/api/r/installed_equipment?service_call_id=${job.id}`)).data;
  assert.equal(eq.length, 2, 'one line per unit');
  assert.equal(eq[0].customer_id, ids.cust);
  assert.equal(eq[0].description, '4K bullet camera');
  let r = await tech.put(`/api/r/service_calls/${job.id}`, { status: 'completed' });
  assert.match(r.data.error, /serial numbers for 2 installed items.*label \/ warranty photo for 2/);
  const a = (await tech.put(`/api/r/installed_equipment/${eq[0].id}`, { serial_number: 'abc123', location: 'Front door' })).data;
  assert.equal(a.serial_number, 'ABC123');
  assert.equal(a.warranty_expires, (() => { const d = new Date(a.install_date + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 36); return d.toISOString().slice(0, 10); })());
  assert.equal((await tech.put(`/api/r/installed_equipment/${eq[1].id}`, { serial_number: 'ABC123' })).status, 409, 'same serial twice is caught');
  await tech.put(`/api/r/installed_equipment/${eq[1].id}`, { serial_number: 'ABC124', location: 'Back door' });
  r = await tech.put(`/api/r/service_calls/${job.id}`, { status: 'completed' });
  assert.match(r.data.error, /label \/ warranty photo for 2/);
  for (const e of eq) assert.equal((await tech.post(`/api/equipment/${e.id}/photos`, { data: JPG, caption: 'Label' })).status, 200);
  assert.equal((await tech.get(`/api/equipment/${eq[0].id}/photos`)).data.length, 1);
  r = await tech.put(`/api/r/service_calls/${job.id}`, { status: 'completed', no_parts_used: false });
  assert.equal(r.status, 200);
  // Searchable by serial
  const found = (await owner.get('/api/search?q=ABC124')).data;
  assert.ok((found.results || found).some(x => x.kind === 'Equipment'));
  // Removing the part from a job removes its unfilled equipment lines
  const job2 = (await owner.post('/api/r/service_calls', { customer_id: ids.cust, title: 'Oops' })).data;
  const part = (await owner.post('/api/r/service_call_parts', { service_call_id: job2.id, item_id: cam.id, qty: 1, location_id: ids.truck })).data;
  assert.equal((await owner.get(`/api/r/installed_equipment?service_call_id=${job2.id}`)).data.length, 1);
  await owner.del(`/api/r/service_call_parts/${part.id}`);
  assert.equal((await owner.get(`/api/r/installed_equipment?service_call_id=${job2.id}`)).data.length, 0);
});

export { owner, tech, ids, db, client, today, notifyIdle };
