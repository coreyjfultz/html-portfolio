// Fire extinguisher records and fire inspection reports.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'secureops-insp-'));
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
  return { get: u => call('GET', u), post: (u, b = {}) => call('POST', u, b), put: (u, b = {}) => call('PUT', u, b), del: u => call('DELETE', u) };
}
const owner = client(), tech = client();
const ids = {};
const PNG = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Buffer.alloc(40)]).toString('base64');

test('setup', async () => {
  await owner.post('/api/auth/setup', { name: 'Olivia Owner', email: 'owner@example.com', password: 'password123', company_name: 'Fire Co' });
  ids.tech = (await owner.post('/api/r/technicians', { name: 'Fred Fire' })).data.id;
  await owner.post('/api/users', { name: 'Fred', email: 'fred@example.com', password: 'password123', role: 'technician', technician_id: ids.tech });
  await tech.post('/api/auth/login', { email: 'fred@example.com', password: 'password123' });
  ids.cust = (await owner.post('/api/r/customers', { name: 'Rosie’s Diner', type: 'commercial', email: 'rosie@example.com' })).data.id;
  ids.other = (await owner.post('/api/r/customers', { name: 'Other Place', type: 'commercial' })).data.id;
});

test('extinguisher dates: 6-year for stored-pressure dry chemical, hydro from manufacture, 12-year life for disposables', async () => {
  const abc = (await owner.post('/api/r/extinguishers', { customer_id: ids.cust, tag_number: 'A100', location: 'Front door', ext_type: 'ABC dry chemical', size: '10 lb', manufacture_date: '2020-04-01', rating: '4-A:80-B:C' })).data;
  assert.equal(abc.next_6yr, '2026-04-01');
  assert.equal(abc.next_hydro, '2032-04-01');
  assert.equal(abc.hydro_interval_years, 12);
  const co2 = (await owner.post('/api/r/extinguishers', { customer_id: ids.cust, tag_number: 'C200', location: 'Office', ext_type: 'CO2', size: '5 lb', manufacture_date: '2022-01-15' })).data;
  assert.equal(co2.next_6yr, null, 'no 6-year for CO2');
  assert.equal(co2.next_hydro, '2027-01-15', 'CO2 hydro every 5 years');
  const disp = (await owner.post('/api/r/extinguishers', { customer_id: ids.cust, tag_number: 'D300', location: 'Storage', ext_type: 'ABC dry chemical', size: '2.5 lb', pressure_type: 'disposable', manufacture_date: '2015-06-01' })).data;
  assert.deepEqual([disp.next_6yr, disp.next_hydro, disp.replace_by], [null, null, '2027-06-01']);
  // A hydro test restarts the 6-year clock
  const after = (await owner.put(`/api/r/extinguishers/${abc.id}`, { last_hydro: '2025-02-01' })).data;
  assert.equal(after.next_6yr, '2031-02-01');
  assert.equal(after.next_hydro, '2037-02-01');
  ids.abc = abc.id; ids.co2 = co2.id; ids.disp = disp.id;
  const due = (await owner.get('/api/maintenance?days=800')).data;
  assert.ok(due.some(m => m.key === 'ext_replace'), 'disposable replacement shows in Maintenance Due');
});

test('fire alarm report: checklist + devices, can’t complete with blanks, failures become deficiencies and a follow-up job; locked after', async () => {
  const sys = (await owner.post('/api/r/fire_systems', { customer_id: ids.cust, system_type: 'fire alarm', location: 'Main panel', ahj: 'Springfield FD' })).data;
  ids.sys = sys.id;
  const today = new Date().toISOString().slice(0, 10);
  // Put the customer on Fred's schedule so he can see it
  await owner.post('/api/r/service_calls', { customer_id: ids.cust, title: 'Annual fire inspection', call_type: 'inspection', technician_id: ids.tech, scheduled_start: `${today}T08:00`, duration_hours: 2, allow_conflict: true });
  const { id } = (await tech.post('/api/inspections', { customer_id: ids.cust, fire_system_id: sys.id })).data;
  let r = (await tech.get(`/api/inspections/${id}`)).data;
  assert.equal(r.report_type, 'fire_alarm');
  assert.equal(r.ahj, 'Springfield FD');
  assert.equal(r.inspector_name, 'Fred Fire');
  assert.ok(r.items.length > 15);
  assert.equal(r.number, 1001);
  // Answer everything as pass, but a pull station fails
  const checklist = Object.fromEntries(r.items.map(i => [i.id, i.kind === 'value' ? { v: '26.9 V' } : { r: 'pass' }]));
  checklist.battery_load = { r: 'fail', note: 'Batteries dated 2019, failed load test' };
  const devices = [
    { type: 'Smoke detector', location: 'Lobby', address: '1-001', result: 'pass' },
    { type: 'Pull station', location: 'Rear exit', address: '1-002', result: 'fail', note: 'Broken glass rod' },
    { type: 'Horn/strobe', location: 'Kitchen', address: '', result: '' },
  ];
  await tech.put(`/api/inspections/${id}`, { checklist, devices });
  let c = await tech.post(`/api/inspections/${id}/complete`, {});
  assert.equal(c.status, 400);
  assert.equal(c.data.code, 'incomplete');
  assert.match(c.data.error, /Device 3 \(Kitchen\)/);
  devices[2].result = 'pass';
  await tech.put(`/api/inspections/${id}`, { devices, ahj_email: 'marshal@springfield.example' });
  assert.equal((await tech.put(`/api/inspections/${id}`, { ahj_email: 'not-an-email' })).status, 400);
  c = await tech.post(`/api/inspections/${id}/complete`, { signed_by: 'Rosie Smith', signature: PNG, create_followup: true });
  assert.equal(c.status, 200);
  assert.equal(c.data.result, 'deficiencies');
  const follow = (await owner.get(`/api/r/service_calls/${c.data.followup_call_id}`)).data;
  assert.match(follow.title, /Correct deficiencies — FIR-1001/);
  assert.match(follow.description, /Pull station.*Broken glass rod/s);
  assert.match(follow.description, /Batteries dated 2019/);
  r = (await owner.get(`/api/inspections/${id}`)).data;
  assert.equal(r.status, 'completed');
  assert.equal(r.deficiency_list.length, 2);
  assert.equal(r.signed_by, 'Rosie Smith');
  const s2 = (await owner.get(`/api/r/fire_systems/${sys.id}`)).data;
  assert.equal(s2.last_inspection, r.inspection_date);
  assert.ok(s2.next_inspection > r.inspection_date, 'next inspection rolled forward');
  assert.equal((await tech.put(`/api/inspections/${id}`, { notes: 'late edit' })).status, 409, 'locked');
  assert.equal((await tech.post(`/api/inspections/${id}/reopen`, { reason: 'x' })).status, 403);

  // Next year: the device list carries over with blank results
  const next = (await owner.post('/api/inspections', { customer_id: ids.cust, fire_system_id: sys.id })).data.id;
  const nr = (await owner.get(`/api/inspections/${next}`)).data;
  assert.deepEqual(nr.devices.map(d => [d.location, d.result]), [['Lobby', ''], ['Rear exit', ''], ['Kitchen', '']]);
  assert.equal((await owner.del(`/api/inspections/${next}`)).status, 200, 'drafts can be deleted');
  ids.report = id;
});

test('extinguisher walk-through updates each unit and its history', async () => {
  const { id } = (await tech.post('/api/inspections', { customer_id: ids.cust, report_type: 'extinguishers' })).data;
  let r = (await tech.get(`/api/inspections/${id}`)).data;
  assert.equal(r.units.length, 3);
  // A unit found on site gets added and picked up
  await tech.post('/api/r/extinguishers', { customer_id: ids.cust, tag_number: 'K400', location: 'Cook line', ext_type: 'Class K (wet chemical)', size: '6 L' });
  r = (await tech.post(`/api/inspections/${id}/refresh-units`)).data;
  assert.equal(r.units.length, 4);
  const by = tag => r.units.find(u => u.label.includes(tag));
  const units = r.units.map(u => ({ ...u, result: 'pass' }));
  Object.assign(units.find(u => u === units[r.units.indexOf(by('A100'))]), { services: ['annual', '6-year'] });
  Object.assign(units[r.units.indexOf(by('C200'))], { result: 'fail', note: 'Horn cracked' });
  Object.assign(units[r.units.indexOf(by('D300'))], { result: 'replaced', new_serial: 'NEW-778', new_manufacture_date: '2026-09-01' });
  const checklist = Object.fromEntries(r.items.map(i => [i.id, { r: 'pass' }]));
  await tech.put(`/api/inspections/${id}`, { units, checklist });
  const c = await tech.post(`/api/inspections/${id}/complete`, { result: 'deficiencies' });
  assert.equal(c.data.result, 'deficiencies');
  const date = r.inspection_date;
  const abc = (await owner.get(`/api/r/extinguishers/${ids.abc}`)).data;
  assert.equal(abc.last_annual, date);
  assert.equal(abc.last_6yr, date);
  const co2 = (await owner.get(`/api/r/extinguishers/${ids.co2}`)).data;
  assert.equal(co2.status, 'needs service');
  const disp = (await owner.get(`/api/r/extinguishers/${ids.disp}`)).data;
  assert.deepEqual([disp.serial, disp.manufacture_date, disp.replace_by, disp.status], ['NEW-778', '2026-09-01', '2038-09-01', 'in service']);
  const hist = (await tech.get(`/api/extinguishers/${ids.disp}/history`)).data;
  assert.equal(hist[0].result, 'replaced');
  assert.equal(hist[0].report_number, 1003, 'numbers are never reused (1002 was a deleted draft)');
});

test('send to customer and fire marshal: emailed link to a read-only report page', async () => {
  assert.equal((await owner.post(`/api/inspections/${ids.report}/send`, { to: [] })).status, 400);
  const s = await owner.post(`/api/inspections/${ids.report}/send`, { to: ['rosie@example.com', 'marshal@springfield.example'] });
  assert.equal(s.status, 200);
  await notifyIdle();
  const mails = db.prepare("SELECT * FROM notifications WHERE related_type = 'inspection' AND related_id = ?").all(ids.report);
  assert.equal(mails.length, 2);
  assert.match(mails[0].subject, /Inspection report FIR-1001 — Rosie’s Diner \(Deficiencies found\)/);
  const link = mails[0].body.match(/\/report\/([A-Za-z0-9_-]+)/)[1];
  const pub = await (await fetch(`${base}/api/public/report/${link}`)).json();
  assert.equal(pub.number, 1001);
  assert.equal(pub.token, undefined);
  assert.equal(pub.deficiency_list.length, 2);
  assert.equal((await fetch(`${base}/api/public/report/${link}/signature`)).status, 200);
  assert.equal((await fetch(`${base}/api/public/report/${'x'.repeat(32)}`)).status, 404);
  assert.equal((await fetch(`${base}/report/${link}`)).status, 200, 'the page itself is served');
  assert.equal((await owner.get(`/api/inspections/${ids.report}`)).data.status, 'sent');
});

test('technicians only see reports for customers on their schedule; suppression systems default to 6 months', async () => {
  const theirs = (await owner.post('/api/inspections', { customer_id: ids.other, report_type: 'sprinkler' })).data.id;
  assert.equal((await tech.get(`/api/inspections/${theirs}`)).status, 404);
  assert.ok(!(await tech.get('/api/inspections')).data.some(i => i.id === theirs));
  assert.equal((await tech.post('/api/inspections', { customer_id: ids.other, report_type: 'sprinkler' })).status, 404);
  const sup = (await owner.post('/api/r/fire_systems', { customer_id: ids.cust, system_type: 'clean agent suppression', location: 'Server room' })).data;
  assert.equal(sup.inspection_interval_months, 6);
  const rep = (await owner.post('/api/inspections', { customer_id: ids.cust, fire_system_id: sup.id })).data.id;
  const full = (await owner.get(`/api/inspections/${rep}`)).data;
  assert.equal(full.report_type, 'suppression');
  assert.ok(full.items.some(i => i.id === 'abort'));
  const hood = (await owner.post('/api/r/fire_systems', { customer_id: ids.cust, system_type: 'kitchen hood suppression', location: 'Cook line' })).data;
  assert.equal(hood.inspection_interval_months, 6);
  assert.equal((await owner.get(`/api/inspections/${(await owner.post('/api/inspections', { customer_id: ids.cust, fire_system_id: hood.id })).data.id}`)).data.report_type, 'kitchen_hood');
});
