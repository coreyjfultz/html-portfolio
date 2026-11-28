import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
// Loads realistic DEMO data so you can try the system. Refuses to run if the
// database already has customers. Usage: npm run seed
import { openDb, DB_PATH, DATA_DIR, tx } from './db.js';
import { create, update, adjustStock, todayLocal, addDays, addMonths } from './resources.js';
import { hashPassword } from './security.js';
import { ingest, processInvoice } from './receiving.js';
import { sendForSignature } from './proposals.js';
import { submitCount, countSheet } from './truckstock.js';
import { createReport, completeReport } from './inspections.js';
import * as chatApi from './chat.js';
import * as hrApi from './hr.js';
import { allItems } from '../public/js/inspections.js';
import { VEHICLE_ITEMS } from '../public/js/vehicle-checks.js';
import { logEvent, putOnTest } from './monitoring.js';

const db = openDb();
if (db.prepare('SELECT COUNT(*) AS n FROM customers').get().n > 0) {
  console.error(`Database ${DB_PATH} already has customers — not seeding.`);
  process.exit(1);
}
const sys = { id: null, name: 'Sam Sales', role: 'owner' };
const today = todayLocal();
const day = n => addDays(today, n);
const monday = (() => { const d = new Date(today + 'T12:00:00Z'); const wd = (d.getUTCDay() + 6) % 7; return addDays(today, -wd); })();
const at = (offset, time) => `${addDays(monday, offset)}T${time}`;
// n-th business day from today (0 = today)
const biz = (n, time) => {
  let d = today, left = n;
  while (left > 0) { d = addDays(d, 1); const wd = new Date(d + 'T12:00:00Z').getUTCDay(); if (wd > 0 && wd < 6) left--; }
  return `${d}T${time}`;
};
const C = (res, data) => create(db, res, data, sys);

tx(db, () => {
db.prepare("UPDATE settings SET value = ? WHERE key = ?").run('Demo Security & Fire', 'company_name');
db.prepare("UPDATE settings SET value = ? WHERE key = ?").run('123 Main St, Springfield, OH 45501', 'company_address');
db.prepare("UPDATE settings SET value = ? WHERE key = ?").run('(555) 555-0100', 'company_phone');
db.prepare("UPDATE settings SET value = ? WHERE key = ?").run('7.25', 'tax_rate');

// --- team
const mike = C('technicians', { name: 'Mike Alvarez', phone: '555-0111', email: 'mike@example.com', skills: 'Fire alarm, NICET II', color: '#dc2626', hourly_cost: 38, bill_rate: 95 });
const jen = C('technicians', { name: 'Jen Park', phone: '555-0112', email: 'jen@example.com', skills: 'Cameras, networking, access control', color: '#2563eb', hourly_cost: 34, bill_rate: 95 });
const sam = C('technicians', { name: 'Sam Turner', phone: '555-0113', email: 'sam@example.com', skills: 'Alarm installs, extinguishers', color: '#16a34a', hourly_cost: 28, bill_rate: 85 });
const v1 = C('vehicles', { unit_name: 'Truck 1', year: 2021, make: 'Ford', model: 'Transit 250', plate: 'SEC-101', assigned_technician_id: mike.id, mileage: 48210, next_service_miles: 50000, next_service_date: day(12), registration_expires: day(45), insurance_expires: day(140) });
const v2 = C('vehicles', { unit_name: 'Van 2', year: 2019, make: 'Ram', model: 'ProMaster', plate: 'SEC-102', assigned_technician_id: jen.id, mileage: 77450, next_service_date: day(-3), registration_expires: day(200), insurance_expires: day(140) });
const v3 = C('vehicles', { unit_name: 'Truck 3', year: 2023, make: 'Chevy', model: 'Silverado 2500', plate: 'SEC-103', assigned_technician_id: sam.id, mileage: 15800, next_service_date: day(60), registration_expires: day(300), insurance_expires: day(140) });

const ins = db.prepare("INSERT INTO users(name, email, password_hash, role, technician_id) VALUES (?,?,?,?,?)");
ins.run('Demo Owner', 'owner@demo.local', hashPassword('demo1234'), 'owner', null);
ins.run('Office Admin', 'admin@demo.local', hashPassword('demo1234'), 'admin', null);
ins.run('Sam Sales', 'sales@demo.local', hashPassword('demo1234'), 'sales', null);
ins.run('Ann Accounting', 'accounting@demo.local', hashPassword('demo1234'), 'accounting', null);
ins.run('Jen Park', 'jen@demo.local', hashPassword('demo1234'), 'technician', jen.id);
ins.run('Mike Alvarez', 'mike@demo.local', hashPassword('demo1234'), 'technician', mike.id);
ins.run('Sam Turner', 'sam@demo.local', hashPassword('demo1234'), 'technician', sam.id);

// --- inventory
const items = {};
for (const [key, sku, name, category, cost, price, reorder] of [
  ['cam4k', 'IPC-4K-T', '4K turret IP camera', 'cameras', 89, 219, 10],
  ['cam5mp', 'IPC-5MP-B', '5MP bullet IP camera', 'cameras', 72, 189, 10],
  ['nvr8', 'NVR-8P', '8-channel PoE NVR', 'recorders', 210, 499, 3],
  ['nvr16', 'NVR-16P', '16-channel PoE NVR', 'recorders', 340, 799, 2],
  ['hdd4', 'HDD-4TB', '4TB surveillance hard drive', 'recorders', 85, 159, 4],
  ['panel', 'ALM-PNL-64', 'Wireless alarm panel w/ touchscreen', 'alarm panels', 180, 449, 3],
  ['door', 'SNS-DW', 'Door/window contact', 'sensors & detectors', 14, 45, 30],
  ['pir', 'SNS-PIR', 'Motion detector (PIR)', 'sensors & detectors', 22, 69, 15],
  ['smoke', 'FA-SMK-PH', 'Photoelectric smoke detector (addressable)', 'fire alarm devices', 38, 110, 20],
  ['pull', 'FA-PULL', 'Manual pull station', 'fire alarm devices', 29, 85, 6],
  ['horn', 'FA-HS-W', 'Horn/strobe, wall, white', 'fire alarm devices', 41, 115, 10],
  ['ext10', 'EXT-ABC-10', '10 lb ABC extinguisher', 'extinguishers', 48, 95, 8],
  ['ext5', 'EXT-ABC-5', '5 lb ABC extinguisher', 'extinguishers', 32, 69, 8],
  ['cat6', 'CBL-CAT6-1K', 'Cat6 cable, 1000 ft', 'cable & wire', 115, 210, 4],
  ['bat', 'BAT-12V7', '12V 7Ah backup battery', 'power & batteries', 16, 39, 20],
]) items[key] = C('inventory_items', { sku, name, category, unit_cost: cost, unit_price: price, reorder_level: reorder });
// Standard truck stock: what every truck carries (a spare or two, not a pile of extras).
for (const [k, min, max] of [['bat', 4, 6], ['door', 8, 12], ['pir', 3, 4], ['smoke', 3, 4], ['cat6', 1, 1], ['cam4k', 2, 3]]) update(db, 'inventory_items', items[k].id, { truck_min: min, truck_max: max }, sys);

const stockPlan = { cam4k: [24, 4, 6, 0], cam5mp: [8, 2, 4, 0], nvr8: [4, 0, 1, 0], nvr16: [1, 0, 1, 0], hdd4: [6, 0, 2, 0], panel: [5, 1, 0, 2],
  door: [60, 10, 0, 20], pir: [12, 2, 0, 6], smoke: [30, 12, 0, 2], pull: [4, 3, 0, 0], horn: [6, 6, 0, 0], ext10: [6, 2, 0, 6], ext5: [10, 0, 0, 4], cat6: [3, 1, 2, 1], bat: [25, 6, 2, 8] };
for (const [k, [wh, a, b, c]] of Object.entries(stockPlan)) {
  adjustStock(db, { itemId: items[k].id, locationId: 0, delta: wh + a + b + c, kind: 'received', note: 'opening stock' });
  [[v1, a], [v2, b], [v3, c]].forEach(([v, q]) => q && (adjustStock(db, { itemId: items[k].id, locationId: 0, delta: -q, kind: 'transfer out' }), adjustStock(db, { itemId: items[k].id, locationId: v.id, delta: q, kind: 'transfer in' })));
}

// --- customers
const custs = [];
const addCust = (data, charges = [], extra = () => {}) => {
  const c = C('customers', { state: 'OH', status: 'active', portal_invite: 0, ...data });
  charges.forEach(([description, amount, taxable = 0]) => C('recurring_charges', { customer_id: c.id, description, amount, taxable }));
  extra(c);
  custs.push(c);
  return c;
};

const res1 = addCust({ type: 'residential', name: 'Tom & Linda Becker', email: 'becker@example.com', phone: '555-0201', billing_address: '42 Oak Ridge Dr', city: 'Springfield', zip: '45503', account_number: 'MC-10442', gate_code: '#4821', access_notes: 'Dog in backyard. Key under mat for service.' },
  [['24/7 alarm monitoring', 34.99], ['Cloud video storage (4 cams)', 15]], c => {
    C('alarm_systems', { customer_id: c.id, location: 'Main house', panel_brand: 'Qolsys', panel_model: 'IQ4', monitoring_center: 'Central Station A', monitoring_account: 'MC-10442', zones: 14, master_code: '1984', installer_code: '1111', install_date: '2022-04-10', last_test: addMonths(today, -11), test_interval_months: 12 });
    C('camera_systems', { customer_id: c.id, location: 'House exterior', recorder_type: 'NVR', brand: 'Hikvision', model: 'DS-7608', camera_count: 4, ip_address: '192.168.1.64', http_port: 80, remote_access: 'Hik-Connect SN: J1234567', app_name: 'Hik-Connect', admin_username: 'admin', admin_password: 'Becker!2022', viewer_username: 'tom', viewer_password: 'Linda42', storage_tb: 4, retention_days: 21, install_date: '2022-04-10', last_service: addMonths(today, -12) });
  });
const res2 = addCust({ type: 'residential', name: 'Maria Gonzalez', email: 'mgonzalez@example.com', phone: '555-0202', billing_address: '908 Elm St', city: 'Springfield', zip: '45504', account_number: 'MC-10587' },
  [['24/7 alarm monitoring', 29.99]], c => {
    C('alarm_systems', { customer_id: c.id, location: 'Home', panel_brand: 'DSC', panel_model: 'PowerSeries Neo', monitoring_account: 'MC-10587', zones: 8, master_code: '5520', last_test: addMonths(today, -6), install_date: '2019-08-01', battery_replaced: '2023-02-14' });
  });
const res3 = addCust({ type: 'residential', name: 'Derek Olsen', email: 'derek.olsen@example.com', phone: '555-0203', billing_address: '15 Lakeview Ct', city: 'Urbana', zip: '43078', preferred_payment: 'card' },
  [['Video monitoring + cloud (8 cams)', 49.99]], c => {
    C('camera_systems', { customer_id: c.id, location: 'Home + detached garage', brand: 'Uniview', model: 'NVR302-16', camera_count: 8, ip_address: '10.0.0.20', remote_access: 'EZCloud', app_name: 'EZView', admin_username: 'admin', admin_password: 'Olsen#Cam8', storage_tb: 8, retention_days: 30, install_date: addMonths(today, -2), last_service: addMonths(today, -2), warranty_expires: addMonths(today, 22) });
  });
const res4 = addCust({ type: 'residential', name: 'Priya Natarajan', email: 'priya.n@example.com', phone: '555-0204', billing_address: '330 Maple Ave', city: 'Springfield', zip: '45505', status: 'prospect', notes: 'Wants quote for 6 cameras + doorbell.' });

const com1 = addCust({ type: 'commercial', name: "Rosie's Diner", contact_name: 'Rosie Kim', email: 'rosie@rosiesdiner.example', phone: '555-0301', billing_address: '700 W Main St', city: 'Springfield', zip: '45502', account_number: 'MC-20011', access_notes: 'Kitchen opens 5am. Ask for manager on duty.' },
  [['Fire alarm monitoring', 45], ['Alarm monitoring', 30], ['Camera system service plan', 25, 1]], c => {
    C('contacts', { customer_id: c.id, name: 'Rosie Kim', role: 'Owner', email: 'rosie@rosiesdiner.example', phone: '555-0301', is_primary: 1, receives_invoices: 1 });
    C('contacts', { customer_id: c.id, name: 'Dave Ruiz', role: 'Night manager', phone: '555-0399' });
    C('fire_systems', { customer_id: c.id, system_type: 'kitchen hood suppression', location: 'Kitchen line', panel_brand: 'Ansul', panel_model: 'R-102', ahj: 'Springfield FD', inspection_interval_months: 6, last_inspection: addMonths(day(9), -6) });
    C('fire_systems', { customer_id: c.id, system_type: 'fire alarm', location: 'Whole building', panel_brand: 'Fire-Lite', panel_model: 'ES-50X', monitoring_account: 'MC-20011F', panel_code: '2468', device_count: 18, ahj: 'Springfield FD', last_inspection: addMonths(day(20), -12) });
    for (const [loc, t, s] of [['Kitchen - by back door', 'Class K (wet chemical)', '6 L'], ['Kitchen - grill line', 'ABC dry chemical', '10 lb'], ['Dining room - front', 'ABC dry chemical', '5 lb'], ['Office', 'ABC dry chemical', '5 lb']]) {
      C('extinguishers', { customer_id: c.id, location: loc, ext_type: t, size: s, last_annual: addMonths(day(5), -12), last_hydro: '2016-05-01', manufacture_date: '2016-03-01' });
    }
    C('camera_systems', { customer_id: c.id, location: 'Interior + lot', brand: 'Hikvision', model: 'DS-7616', camera_count: 10, ip_address: '192.168.10.50', remote_access: 'DDNS rosies.example-ddns.net', app_name: 'Hik-Connect', admin_username: 'admin', admin_password: 'R0sie$Diner', storage_tb: 8, retention_days: 30, last_service: addMonths(today, -13) });
  });
const com2 = addCust({ type: 'commercial', name: 'Northgate Self Storage', contact_name: 'Aaron Wells', email: 'manager@northgatestorage.example', phone: '555-0302', billing_address: '2200 Northgate Rd', city: 'Springfield', zip: '45506', account_number: 'MC-20045', preferred_payment: 'ach' },
  [['Video monitoring - 16 cameras', 129], ['Access control cloud license', 40, 1], ['Alarm monitoring', 35]], c => {
    C('contacts', { customer_id: c.id, name: 'Aaron Wells', role: 'Site manager', email: 'manager@northgatestorage.example', phone: '555-0302', is_primary: 1 });
    C('contacts', { customer_id: c.id, name: 'Accounts Payable', role: 'Billing', email: 'ap@northgatecorp.example', receives_invoices: 1 });
    C('camera_systems', { customer_id: c.id, location: 'Facility perimeter + gate', brand: 'Axis', model: 'S3008', camera_count: 16, ip_address: '172.16.0.10', http_port: 8080, remote_access: 'VPN only', admin_username: 'root', admin_password: 'NgStor!16cam', storage_tb: 16, retention_days: 45, install_date: '2021-06-15', last_service: addMonths(today, -10), service_interval_months: 12 });
    C('alarm_systems', { customer_id: c.id, location: 'Office', panel_brand: 'Honeywell', panel_model: 'Vista 20P', monitoring_account: 'MC-20045', zones: 12, master_code: '7310', communicator: 'dual path', last_test: addMonths(today, -12) });
    for (let i = 1; i <= 6; i++) C('extinguishers', { customer_id: c.id, location: `Building ${String.fromCharCode(64 + i)} entrance`, ext_type: 'ABC dry chemical', size: '10 lb', last_annual: addMonths(day(14), -12), last_hydro: '2015-09-01' });
  });
const com3 = addCust({ type: 'commercial', name: 'Springfield Family Dental', contact_name: 'Dr. Helen Cho', email: 'office@sfdental.example', phone: '555-0303', billing_address: '15 Medical Pkwy, Suite 200', city: 'Springfield', zip: '45503', account_number: 'MC-20078' },
  [['Alarm + fire monitoring', 65], ['Camera service plan', 20, 1]], c => {
    C('contacts', { customer_id: c.id, name: 'Karen Lee', role: 'Office manager', email: 'office@sfdental.example', phone: '555-0303', is_primary: 1, receives_invoices: 1 });
    C('fire_systems', { customer_id: c.id, system_type: 'fire alarm', location: 'Suite 200', panel_brand: 'Notifier', panel_model: 'NFS-320', device_count: 24, ahj: 'Springfield FD', last_inspection: addMonths(day(-10), -12) });
    C('fire_systems', { customer_id: c.id, system_type: 'sprinkler', location: 'Building riser room', ahj: 'Springfield FD', last_inspection: addMonths(day(40), -12) });
    C('camera_systems', { customer_id: c.id, location: 'Reception + entrances', brand: 'Hanwha', model: 'XRN-810S', camera_count: 6, admin_username: 'admin', admin_password: 'Dent@l2023', last_service: addMonths(today, -5) });
    for (const loc of ['Reception', 'Sterilization room', 'Break room']) C('extinguishers', { customer_id: c.id, location: loc, ext_type: 'ABC dry chemical', size: '5 lb', last_annual: addMonths(day(-4), -12), last_hydro: '2018-02-01' });
  });
const com4 = addCust({ type: 'commercial', name: 'Miller Manufacturing', contact_name: 'Greg Miller', email: 'facilities@millermfg.example', phone: '555-0304', billing_address: '8800 Industrial Blvd', city: 'Springfield', zip: '45502', account_number: 'MC-20102', tax_exempt: 1 },
  [['Fire alarm monitoring', 55], ['Alarm monitoring', 35], ['Video monitoring - 24 cameras', 175]], c => {
    C('fire_systems', { customer_id: c.id, system_type: 'fire alarm', location: 'Plant + offices', panel_brand: 'Simplex', panel_model: '4100ES', device_count: 96, ahj: 'Clark County FD', last_inspection: addMonths(day(50), -12) });
    C('fire_systems', { customer_id: c.id, system_type: 'fire pump', location: 'Pump house', inspection_interval_months: 12, last_inspection: addMonths(day(25), -12) });
    C('camera_systems', { customer_id: c.id, location: 'Plant floor + yard', brand: 'Avigilon', camera_count: 24, admin_username: 'administrator', admin_password: 'MillerMfg#24', storage_tb: 32, retention_days: 60, last_service: addMonths(today, -3) });
    for (let i = 1; i <= 12; i++) C('extinguishers', { customer_id: c.id, location: `Plant column ${i * 3}`, ext_type: i % 4 === 0 ? 'CO2' : 'ABC dry chemical', size: i % 4 === 0 ? '15 lb' : '20 lb', last_annual: addMonths(day(35), -12), last_hydro: i % 4 === 0 ? addMonths(day(20), -60) : '2017-01-01' });
  });

// --- invoices for the last 3 months (monthly billing) with payments
for (let back = 3; back >= 1; back--) {
  const period = addMonths(today.slice(0, 8) + '01', -back).slice(0, 7);
  for (const c of custs.filter(c => c.status === 'active')) {
    const charges = db.prepare('SELECT * FROM recurring_charges WHERE customer_id = ? AND active = 1').all(c.id);
    if (!charges.length) continue;
    const inv = C('invoices', { customer_id: c.id, kind: 'monthly', period, issue_date: `${period}-01`, status: 'sent' });
    charges.forEach(ch => C('invoice_items', { invoice_id: inv.id, description: ch.description, qty: 1, unit_price: ch.amount, taxable: ch.taxable }));
    const fresh = db.prepare('SELECT total FROM invoices WHERE id = ?').get(inv.id);
    const late = (c.id === res2.id && back === 1) || (c.id === com1.id && back <= 2);
    if (!late) C('payments', { invoice_id: inv.id, date: addDays(`${period}-01`, 9 + (c.id % 10)), amount: fresh.total, method: c.preferred_payment || 'check', reference: c.preferred_payment === 'check' ? String(4000 + inv.id) : '' });
  }
  // A couple of install / service jobs billed each past month
  const jobs = [
    [com2, 'Add 4 cameras to storage aisles', 6, 95, [['4K turret IP camera', 4, 219]]],
    [res2, 'Alarm system upgrade — new panel + sensors', 4, 85, [['Wireless alarm panel w/ touchscreen', 1, 449], ['Door/window contact', 6, 45]]],
    [com4, 'Fire alarm device replacements', 5, 95, [['Photoelectric smoke detector (addressable)', 8, 110], ['Horn/strobe, wall, white', 3, 115]]],
  ];
  const [cust, desc, hrs, rate, lines] = jobs[back - 1];
  const job = C('invoices', { customer_id: cust.id, kind: 'installation', issue_date: `${period}-18`, status: 'sent', notes: desc });
  C('invoice_items', { invoice_id: job.id, description: `Labor — ${desc}`, qty: hrs, unit_price: rate });
  lines.forEach(([d, q, p]) => C('invoice_items', { invoice_id: job.id, description: d, qty: q, unit_price: p, taxable: cust.tax_exempt ? 0 : 1 }));
  const jt = db.prepare('SELECT total FROM invoices WHERE id = ?').get(job.id).total;
  if (back > 1) C('payments', { invoice_id: job.id, date: `${period}-28`, amount: jt, method: 'check', reference: String(5000 + job.id) });
}

// --- service calls this week / last week / next week
const call = (data, parts = []) => {
  const sc = C('service_calls', data);
  parts.forEach(([k, qty]) => C('service_call_parts', { service_call_id: sc.id, item_id: items[k].id, qty }));
  return sc;
};
const done = (sc, hours, resolution) => update(db, 'service_calls', sc.id, { status: 'completed', labor_hours: hours, resolution, override_reason: 'Demo data' }, sys);

const a = call({ customer_id: res3.id, title: 'Install 8-camera system + NVR', call_type: 'installation', system_type: 'camera', technician_id: jen.id, scheduled_start: at(-7, '08:00'), duration_hours: 7 }, [['cam4k', 6], ['cam5mp', 2], ['nvr16', 1], ['hdd4', 2], ['cat6', 1]]);
done(a, 7.5, 'Installed 8 cameras, NVR, configured EZView for customer. Walked through app.');
const b = call({ customer_id: com1.id, title: 'Kitchen hood suppression semi-annual inspection', call_type: 'inspection', system_type: 'fire alarm', technician_id: mike.id, scheduled_start: at(-5, '06:00'), duration_hours: 2 });
done(b, 2, 'Inspected R-102, replaced fusible links, tagged system.');
const c1 = call({ customer_id: res1.id, title: 'Low battery trouble on panel', call_type: 'service', system_type: 'alarm', technician_id: sam.id, scheduled_start: at(-4, '10:00'), duration_hours: 1 }, [['bat', 1]]);
done(c1, 0.75, 'Replaced panel backup battery, tested comm path.');
call({ customer_id: com2.id, title: 'Gate camera offline', call_type: 'service', system_type: 'camera', priority: 'high', technician_id: jen.id, scheduled_start: biz(0, '09:00'), duration_hours: 2, description: 'Camera 14 at main gate not recording since Tuesday.' });
call({ customer_id: com4.id, title: 'Annual fire alarm inspection — plant', call_type: 'inspection', system_type: 'fire alarm', technician_id: mike.id, scheduled_start: biz(1, '07:30'), duration_hours: 8 });
call({ customer_id: com4.id, title: 'Annual fire alarm inspection — offices', call_type: 'inspection', system_type: 'fire alarm', technician_id: mike.id, scheduled_start: biz(2, '07:30'), duration_hours: 4 });
call({ customer_id: res2.id, title: 'Add 2 door contacts to back patio', call_type: 'installation', system_type: 'alarm', technician_id: sam.id, scheduled_start: biz(1, '13:00'), duration_hours: 1.5 });
call({ customer_id: com3.id, title: 'Fire alarm annual inspection', call_type: 'inspection', system_type: 'fire alarm', technician_id: mike.id, scheduled_start: biz(3, '08:00'), duration_hours: 3 });
call({ customer_id: com1.id, title: 'Extinguisher annual inspection (4)', call_type: 'inspection', system_type: 'extinguisher', technician_id: sam.id, scheduled_start: biz(3, '14:00'), duration_hours: 1 });
call({ customer_id: res4.id, title: 'Site survey / estimate — 6 cameras + doorbell', call_type: 'estimate', system_type: 'camera', technician_id: jen.id, scheduled_start: biz(2, '15:00'), duration_hours: 1, billable: 0 });
call({ customer_id: com2.id, title: 'Keypad at office door intermittent', call_type: 'service', system_type: 'access control', priority: 'normal', description: 'Customer reports keypad sometimes ignores codes.' });
call({ customer_id: res1.id, title: 'Customer cannot view cameras on new phone', call_type: 'service', system_type: 'camera', priority: 'low' });
call({ customer_id: com3.id, title: 'Smoke detector trouble — Operatory 3', call_type: 'service', system_type: 'fire alarm', priority: 'emergency', technician_id: mike.id, scheduled_start: biz(0, '13:30'), duration_hours: 1.5 });

// --- expenses
const expRows = [];
for (let back = 3; back >= 0; back--) {
  const p = addMonths(today.slice(0, 8) + '01', -back).slice(0, 7);
  expRows.push(
    [`${p}-03`, 'Rent & utilities', 'Springfield Properties', 'Shop rent', 450],
    [`${p}-05`, 'Insurance', 'Acme Insurance', 'General liability + auto', 240],
    [`${p}-06`, 'Monitoring center fees', 'Central Station A', 'Wholesale monitoring', 96],
    [`${p}-08`, 'Fuel', 'Fuel card', 'Fleet fuel', 180 + back * 10],
    [`${p}-10`, 'Phone & software', 'Various', 'Phones + software subscriptions', 140],
    [`${p}-15`, 'Payroll', 'Payroll', 'Technician payroll (1st half)', 520],
    [`${p}-28`, 'Payroll', 'Payroll', 'Technician payroll (2nd half)', 520],
    [`${p}-12`, 'Parts & equipment', 'ADI Global', 'Camera + alarm stock', 300 + back * 40],
  );
}
for (const [date, category, vendor, description, amount] of expRows) if (date <= today) C('expenses', { date, category, vendor, description, amount });
C('expenses', { date: day(-20), category: 'Vehicle maintenance', vendor: 'Quick Lube', description: 'Oil change + tires', amount: 640, vehicle_id: v2.id });

// A couple of one-off invoices
const inst = C('invoices', { customer_id: res3.id, kind: 'installation', issue_date: day(-6), status: 'sent', notes: '8-camera system installation' });
C('invoice_items', { invoice_id: inst.id, description: 'Camera system installation labor', qty: 7.5, unit_price: 95 });
C('invoice_items', { invoice_id: inst.id, description: '4K turret IP camera', qty: 6, unit_price: 219, taxable: 1 });
C('invoice_items', { invoice_id: inst.id, description: '5MP bullet IP camera', qty: 2, unit_price: 189, taxable: 1 });
C('invoice_items', { invoice_id: inst.id, description: '16-channel PoE NVR + 2×4TB', qty: 1, unit_price: 1117, taxable: 1 });
C('payments', { invoice_id: inst.id, date: day(-6), amount: 1500, method: 'card', reference: 'Deposit' });
db.prepare('UPDATE service_calls SET invoice_id = ? WHERE id = ?').run(inst.id, a.id);

// Alarm monitoring: one central station, accounts with zones, call lists and recent signals
const cs = C('monitoring_stations', { name: 'Central Station A', platform: 'Manitou', operator_phone: '(800) 555-0199', dealer_number: 'D-4471', dealer_portal: 'dealers.example-station.com', account_prefix: 'MC-', next_account_number: 20200, account_digits: 5 });
const at2 = (daysAgo, time) => `${addDays(today, -daysAgo)}T${time}`;
const monitor = (cust, number, service, zones, calls, events, extra = {}) => {
  const alarm = db.prepare('SELECT id FROM alarm_systems WHERE customer_id = ? LIMIT 1').get(cust.id);
  const acc = C('monitoring_accounts', { customer_id: cust.id, station_id: cs.id, account_number: number, status: 'active', service_type: service, alarm_system_id: alarm?.id || null,
    communicator: 'cellular', comm_id: `ADC-${number.replace(/\D/g, '')}`, passcode: 'blue sky', monitoring_start: '2023-03-01', permit_number: `SPD-${number.slice(-4)}`, ...extra });
  zones.forEach(([n, d, t]) => C('monitoring_zones', { account_id: acc.id, zone_number: n, description: d, zone_type: t }));
  calls.forEach(([name, rel, phone, key], i) => C('monitoring_contacts', { account_id: acc.id, sequence: i + 1, name, relation: rel, phone, has_key: key ? 1 : 0 }));
  events.forEach(([ago, time, code, zone, desc, disp]) => logEvent(db, acc.id, { time: at2(ago, time), code, zone, description: desc, disposition: disp, source: 'station' }));
  db.prepare('UPDATE monitoring_accounts SET station_synced = 1 WHERE id = ?').run(acc.id);
  db.prepare('UPDATE monitoring_zones SET station_synced = 1 WHERE account_id = ?').run(acc.id);
  return acc;
};
monitor(res1, 'MC-10442', 'burglary', [[1, 'Front door', 'entry/exit'], [2, 'Back door', 'entry/exit'], [3, 'Living room motion', 'interior / motion'], [4, 'Hallway smoke', 'smoke'], [5, 'Garage entry', 'entry/exit']],
  [['Tom Becker', 'Owner', '555-0201', true], ['Linda Becker', 'Owner', '555-0211', true], ['Sue Park', 'Neighbor', '555-0299', true]],
  [[9, '22:41', 'E130', 3, 'Burglary — living room motion', 'Called premises, owner gave passcode. Cancelled.'], [9, '22:43', 'R130', 3, 'Restore'], [6, '07:12', 'R401', null, 'Disarmed by user 1'], [6, '18:30', 'E401', null, 'Armed away by user 1'],
   [2, '03:15', 'E302', null, 'Low system battery'], [1, '10:05', 'R302', null, 'Battery restored (tech replaced)'], [0, '06:00', 'E602', null, 'Periodic test']]);
monitor(res2, 'MC-10587', 'burglary', [[1, 'Front door', 'entry/exit'], [2, 'Patio slider', 'entry/exit'], [3, 'Hall motion', 'interior / motion']],
  [['Maria Gonzalez', 'Owner', '555-0202', true]], [[3, '08:01', 'R401', null, 'Disarmed by user 1'], [0, '06:00', 'E602', null, 'Periodic test']]);
monitor(com1, 'MC-20011', 'burglary + fire', [[1, 'Front entrance', 'entry/exit'], [2, 'Back door (kitchen)', 'entry/exit'], [3, 'Office motion', 'interior / motion'], [10, 'Kitchen heat', 'heat'], [11, 'Dining smoke', 'smoke'], [12, 'Hood suppression', 'other'], [20, 'Hold-up button (register)', 'panic']],
  [['Rosie Kim', 'Owner', '555-0301', true], ['Dave Ruiz', 'Night manager', '555-0399', true]],
  [[12, '23:58', 'E131', 2, 'Perimeter — back door', 'Police dispatched, door found unsecured. Owner notified.'], [5, '05:02', 'R401', null, 'Opened by user 3 (Dave)'], [5, '22:30', 'E401', null, 'Closed by user 3 (Dave)'], [1, '14:20', 'E373', 11, 'Fire trouble — dining smoke', 'Tech dispatched'], [1, '15:05', 'R373', 11, 'Trouble restored']]);
const m4 = monitor(com3, 'MC-20078', 'burglary + fire', [[1, 'Front door', 'entry/exit'], [2, 'Rear door', 'entry/exit'], [5, 'Server closet motion', 'interior / motion'], [10, 'Lobby smoke', 'smoke'], [11, 'Operatory 3 smoke', 'smoke'], [12, 'Sprinkler flow', 'other']],
  [['Karen Lee', 'Office manager', '555-0303', true], ['Dr. Helen Cho', 'Owner', '555-0313', false]],
  [[0, '07:44', 'E380', 11, 'Fire trouble — Operatory 3 smoke (dirty sensor)', 'Customer called, service call opened']]);
monitor(com4, 'MC-20102', 'burglary + fire', [[1, 'Main entrance', 'entry/exit'], [2, 'Dock door 1', 'perimeter'], [3, 'Dock door 2', 'perimeter'], [10, 'Fire alarm panel (general)', 'smoke'], [11, 'Sprinkler water flow', 'other'], [12, 'Fire pump run', 'other']],
  [['Greg Miller', 'Facilities', '555-0304', true], ['Plant security desk', 'Security', '555-0390', true]],
  [[4, '06:00', 'R401', null, 'Opened by user 5'], [4, '18:10', 'E401', null, 'Closed by user 5'], [0, '06:00', 'E602', null, 'Periodic test']]);
putOnTest(db, m4.id, { minutes: 240, reason: 'Smoke detector replacement in Operatory 3' }, { name: 'Mike Alvarez' }).catch(e => console.error(e));

// Proposals: one out for signature, one draft
  const p1 = C('proposals', { customer_id: res4.id, kind: 'installation agreement', title: '6-camera system with video doorbell', intro: 'Supply and install six 4K turret cameras covering the driveway, front and back entries and backyard, a 4K video doorbell and an 8-channel NVR with 4TB storage. Includes app setup on your phones and a walkthrough.', monthly_amount: 24.99, monthly_description: 'Cloud backup + remote support', term_months: 12, deposit_percent: 30 });
  [['4K turret IP camera', 6, 219, items.cam4k.id], ['8-channel PoE NVR', 1, 499, items.nvr8.id], ['4TB surveillance hard drive', 1, 159, items.hdd4.id], ['Installation labor (cabling, mounting, programming)', 8, 95, null]]
    .forEach(([d, q, pr, it], i) => C('proposal_items', { proposal_id: p1.id, item_id: it, description: d, qty: q, unit_price: pr, taxable: it ? 1 : 0, sort: i }));
  sendForSignature(db, p1.id, sys, { email: false });
  const p2 = C('proposals', { customer_id: com2.id, kind: 'monitoring agreement', title: 'Access control expansion — Building C', intro: 'Add two card readers with door strikes at Building C entrances, tied into the existing access control cloud account.', monthly_amount: 20, monthly_description: 'Additional access control doors', term_months: 36 });
  C('proposal_items', { proposal_id: p2.id, description: 'Card reader + strike + REX, installed', qty: 2, unit_price: 1150, taxable: 1 });
// Tools, a past weekly count and materials picked for an upcoming install.
for (const [name, tag, category, v, cost, status] of [
  ['8 ft fiberglass ladder', 'L-01', 'ladders & lifts', v1, 189, 'in service'], ['28 ft extension ladder', 'L-02', 'ladders & lifts', v2, 420, 'in service'],
  ['Fluke multimeter', 'M-01', 'meters & testers', v1, 260, 'in service'], ['Smoke detector tester (aerosol pole kit)', 'F-01', 'fire service', v1, 340, 'in service'],
  ['Cable tester / toner', 'N-01', 'network & camera', v2, 140, 'in service'], ['Hammer drill', 'P-01', 'power tools', v2, 230, 'needs repair'],
  ['Impact driver', 'P-02', 'power tools', v3, 160, 'in service'], ['Fish tape 100 ft', 'H-01', 'hand tools', v3, 55, 'in service'],
  ['Camera test monitor', 'N-02', 'network & camera', null, 310, 'in service'], ['Scissor lift (rental return)', 'S-01', 'ladders & lifts', null, 0, 'retired'],
]) C('tools', { name, tag, category, vehicle_id: v?.id ?? null, cost, status, purchase_date: addMonths(today, -18) });
{
  const jenUser = { id: db.prepare("SELECT id FROM users WHERE email = 'jen@demo.local'").get()?.id, name: 'Jen Park', role: 'technician', technician_id: jen.id };
  const truck2 = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(v2.id);
  const toolsOn = db.prepare("SELECT id FROM tools WHERE vehicle_id = ? AND status <> 'retired'").all(v2.id);
  submitCount(db, truck2, { items: countSheet(db, truck2).items.map((r, i, all) => ({ item_id: r.item_id, counted: Math.max(0, r.expected - (r === all.find(x => x.expected > 0) ? 1 : 0)) })), tools: toolsOn.map(t => ({ tool_id: t.id, condition: 'ok' })), notes: 'One short — maybe left at the Olsen job' }, jenUser);
  db.prepare("UPDATE truck_counts SET created_at = datetime('now','localtime','-3 days')").run();
  const install = db.prepare("SELECT id FROM service_calls WHERE call_type = 'installation' AND status IN ('scheduled','new') ORDER BY scheduled_start LIMIT 1").get();
  if (install) for (const [k, q] of [['cam4k', 4], ['nvr8', 1], ['hdd4', 1], ['cat6', 1]]) C('job_materials', { service_call_id: install.id, item_id: items[k].id, qty: q });
}

// Northgate's office isn't staffed when techs visit: jobs there don't need a signature.
db.prepare("UPDATE customers SET no_signature_needed = 1 WHERE name = 'Northgate Self Storage'").run();
db.prepare("UPDATE service_calls SET signature_waived = 1, signature_waived_by = 'Customer setting (nobody usually on site)' WHERE customer_id = (SELECT id FROM customers WHERE name = 'Northgate Self Storage') AND status <> 'completed'").run();

// Fire: extinguisher tags & ratings, a clean-agent system, and inspection reports.
{
  db.prepare("UPDATE extinguishers SET tag_number = 'T' || (4100 + id), brand = 'Amerex', mount = CASE WHEN location LIKE '%Kitchen%' THEN 'bracket' ELSE 'wall hook' END, rating = CASE size WHEN '5 lb' THEN '3-A:40-B:C' WHEN '10 lb' THEN '4-A:80-B:C' WHEN '20 lb' THEN '10-A:120-B:C' WHEN '15 lb' THEN '10-B:C' ELSE NULL END").run();
  db.prepare("UPDATE extinguishers SET manufacture_date = COALESCE(manufacture_date, date(last_hydro, '-2 months')) WHERE manufacture_date IS NULL AND last_hydro IS NOT NULL").run();
  for (const e of db.prepare('SELECT id FROM extinguishers').all()) update(db, 'extinguishers', e.id, { notes: null }, sys); // let the date rules fill in 6-year / hydro
  const miller = custs.find(c => c.name === 'Miller Manufacturing');
  if (miller) C('fire_systems', { customer_id: miller.id, system_type: 'clean agent suppression', location: 'Server room', panel_brand: 'Kidde', panel_model: 'ARIES NetLink', ahj: 'Clark County FD', last_inspection: addMonths(day(20), -6) });
  const mikeUser = { id: db.prepare("SELECT id FROM users WHERE email = 'mike@demo.local'").get()?.id, name: 'Mike Alvarez', role: 'owner', technician_id: mike.id };
  db.prepare("UPDATE settings SET value = 'NICET II #118-442' WHERE key = 'inspector_license'").run();
  const passAll = (id, tweak = {}) => {
    const r = db.prepare('SELECT * FROM inspection_reports WHERE id = ?').get(id);
    const items = allItems(r.report_type, []);
    const checklist = Object.fromEntries(items.map(i => [i.id, i.kind === 'value' ? { v: { battery_date: '04/2024', battery_voltage: '27.1 V', station_operator: 'Op. 42, conf. 88213', static_psi: '78 psi', main_drain: '78 / 61 psi', cyl_date: '2019', agent_type: 'FM-200' }[i.id] || 'OK' } : { r: 'pass' }]));
    Object.assign(checklist, tweak);
    db.prepare('UPDATE inspection_reports SET checklist = ? WHERE id = ?').run(JSON.stringify(checklist), id);
  };
  const dental = custs.find(c => c.name === 'Springfield Family Dental');
  const dentalFa = dental && db.prepare("SELECT * FROM fire_systems WHERE customer_id = ? AND system_type = 'fire alarm'").get(dental.id);
  if (dentalFa) {
    const id = createReport(db, { customer_id: dental.id, fire_system_id: dentalFa.id, inspection_date: dentalFa.last_inspection }, mikeUser);
    const devices = [['Smoke detector', 'Reception', '1-001'], ['Smoke detector', 'Hallway A', '1-002'], ['Smoke detector', 'Operatory 1', '1-003'], ['Smoke detector', 'Operatory 2', '1-004'], ['Smoke detector', 'Operatory 3', '1-005'],
      ['Heat detector', 'Break room', '1-006'], ['Duct detector', 'RTU-1', '1-007'], ['Pull station', 'Front exit', '1-008'], ['Pull station', 'Rear exit', '1-009'], ['Horn/strobe', 'Reception', 'NAC 1'], ['Horn/strobe', 'Hallway A', 'NAC 1'], ['Strobe', 'Restroom', 'NAC 2']]
      .map(([type, location, address]) => ({ type, location, address, result: location === 'Operatory 3' ? 'fail' : 'pass', note: location === 'Operatory 3' ? 'Dirty — did not alarm with test smoke; replace head' : '' }));
    db.prepare('UPDATE inspection_reports SET devices = ?, ahj_email = ? WHERE id = ?').run(JSON.stringify(devices), 'fireprevention@springfield-oh.example', id);
    passAll(id);
    completeReport(db, db.prepare('SELECT * FROM inspection_reports WHERE id = ?').get(id), { signed_by: 'Karen Lee', create_followup: false }, mikeUser, 'seed');
    db.prepare("UPDATE inspection_reports SET status = 'sent', completed_at = inspection_date || 'T15:20', sent_at = inspection_date || 'T16:05', sent_to = 'office@sfdental.example, fireprevention@springfield-oh.example', recommendations = 'Replace the smoke detector in Operatory 3. Plan on replacing panel batteries at the next annual (installed 04/2024).' WHERE id = ?").run(id);
  }
  const rosie = custs.find(c => c.name === "Rosie's Diner");
  const hood = rosie && db.prepare("SELECT * FROM fire_systems WHERE customer_id = ? AND system_type = 'kitchen hood suppression'").get(rosie.id);
  if (hood) {
    const id = createReport(db, { customer_id: rosie.id, fire_system_id: hood.id, inspection_date: hood.last_inspection }, mikeUser);
    passAll(id, { grease: { r: 'fail', note: 'Heavy grease in the duct above the fryers — recommend cleaning within 30 days' } });
    completeReport(db, db.prepare('SELECT * FROM inspection_reports WHERE id = ?').get(id), { signed_by: 'Rosie Kim', create_followup: false }, mikeUser, 'seed');
    db.prepare("UPDATE inspection_reports SET completed_at = inspection_date || 'T10:40' WHERE id = ?").run(id);
    // An extinguisher walk-through in progress today
    const job = C('service_calls', { customer_id: rosie.id, title: 'Annual extinguisher inspection', call_type: 'inspection', system_type: 'extinguisher', technician_id: mike.id, scheduled_start: `${today}T07:00`, duration_hours: 1, allow_conflict: true, notify: false });
    createReport(db, { customer_id: rosie.id, report_type: 'extinguishers', service_call_id: job.id }, mikeUser);
  }
}

// Vehicle checks: tire targets, Jen's truck checked this morning, Mike's yesterday with a problem.
{
  db.prepare("UPDATE vehicles SET tire_psi = CASE WHEN unit_name LIKE 'Truck%' THEN 65 ELSE 55 END").run();
  const ok = Object.fromEntries(VEHICLE_ITEMS.map(i => [i.id, i.kind === 'tires' ? { psi: { fl: 55, fr: 55, rl: 56, rr: 55 }, r: 'ok' } : { r: 'ok', note: '' }]));
  const ins = db.prepare('INSERT INTO vehicle_checks (vehicle_id, user_id, user_name, technician_id, odometer, items, photos, issues, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
  ins.run(v2.id, null, 'Jen Park', jen.id, 77462, JSON.stringify(ok), '[]', 0, 'ok', `${today} 07:12:00`);
  const bad = { ...ok, tire_psi: { psi: { fl: 65, fr: 64, rl: 58, rr: 65 }, r: 'issue', note: '' }, wipers: { r: 'issue', note: 'Driver-side wiper blade streaking' } };
  ins.run(v1.id, null, 'Mike Alvarez', mike.id, 48190, JSON.stringify(bad), '[]', 2, 'issues', `${day(-1)} 07:05:00`);
}

// Serial-tracked equipment and what's installed at the Beckers'.
{
  db.prepare("UPDATE inventory_items SET serialized = 1, warranty_months = CASE WHEN sku LIKE 'IPC%' THEN 36 WHEN sku LIKE 'NVR%' THEN 36 WHEN sku LIKE 'HDD%' THEN 36 ELSE 24 END WHERE sku IN ('IPC-4K-T','IPC-5MP-B','NVR-8P','NVR-16P','HDD-4TB','ALM-PNL-64')").run();
  const becker = custs[0];
  const installed = addMonths(today, -14);
  for (const [item, desc, sn, where, warranty] of [
    [items.nvr8.id, '8-channel PoE NVR', 'NVR8-2241-77XK', 'Basement utility shelf', 36],
    [items.cam4k.id, '4K turret IP camera', 'T4K-88123401', 'Front porch', 36],
    [items.cam4k.id, '4K turret IP camera', 'T4K-88123402', 'Driveway (garage corner)', 36],
    [items.cam4k.id, '4K turret IP camera', 'T4K-88123419', 'Back patio', 36],
    [items.panel.id, 'Wireless alarm panel w/ touchscreen', 'IQ4-0098812', 'Kitchen wall', 24],
  ]) C('installed_equipment', { customer_id: becker.id, item_id: item, description: desc, serial_number: sn, location: where, install_date: installed, warranty_months: warranty, status: 'installed' });
}

// Six months of customer survey answers.
{
  const comments = { 5: ['Super professional, explained everything.', 'On time and cleaned up after himself.', 'Fixed it fast — thank you!', ''], 4: ['Good job, a bit late.', 'Great work, had to come back for one camera.', ''], 3: ['Took longer than expected.', ''], 2: ['Arrived two hours late and didn’t call.'] };
  const plan = [[mike, [5, 5, 4, 5, 5, 4, 5, 3]], [jen, [5, 5, 5, 4, 5, 5, 5]], [sam, [4, 2, 3, 5, 4, 4, 5]]];
  const ins = db.prepare(`INSERT INTO job_surveys (service_call_id, customer_id, technician_id, token, sent_at, channel, opened_at, rating, tech_rating, on_time, comment, contact_ok, responded_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  let k = 0;
  for (const [t, ratings] of plan) ratings.forEach((r, i) => {
    const cust = custs[(k++) % custs.length];
    const when = `${day(-(8 + i * 22 + k))}T15:30`;
    const job = C('service_calls', { customer_id: cust.id, title: ['Camera offline', 'Keypad replacement', 'Annual inspection', 'Add motion detector', 'Battery replacement', 'Doorbell install', 'Panel trouble', 'Smoke detector chirping'][(i + k) % 8], call_type: 'service', technician_id: t.id, notify: false });
    db.prepare("UPDATE service_calls SET status = 'completed', scheduled_start = ?, completed_at = ?, labor_hours = 1 WHERE id = ?").run(when, when, job.id);
    const list = comments[r] || [''];
    ins.run(job.id, cust.id, t.id, 'demo' + crypto.randomBytes(18).toString('base64url'), when, 'text', when, Math.min(5, r + (r < 5 && i % 3 === 0 ? 1 : 0)), r, r <= 2 || /late/.test(list[i % list.length]) ? 0 : 1, list[i % list.length] || null, r <= 2 ? 1 : 0, when);
  });
  db.prepare("UPDATE settings SET value = 'https://g.page/r/demo-security/review' WHERE key = 'review_url'").run();
  const bad = db.prepare('SELECT j.id, c.name, sc.number FROM job_surveys j JOIN customers c ON c.id = j.customer_id JOIN service_calls sc ON sc.id = j.service_call_id WHERE j.tech_rating <= 2 LIMIT 1').get();
  if (bad) db.prepare('INSERT INTO alerts (kind, severity, title, body, link) VALUES (?,?,?,?,?)').run('survey_low', 'bad', `★★☆☆☆ from ${bad.name} (SC-${bad.number}, Sam Turner)`, 'Said the technician was NOT on time. “Arrived two hours late and didn’t call.”\nOK to contact them about it.', `#/ratings?survey=${bad.id}`);
}

// Team chat: a few messages so the screen isn't empty.
{
  const { ensureTeamChannel } = chatApi;
  ensureTeamChannel(db);
  const U = email => db.prepare('SELECT id, name FROM users WHERE email = ?').get(email);
  const owner = U('owner@demo.local'), jenU = U('jen@demo.local'), mikeU = U('mike@demo.local'), samU = U('sam@demo.local'), adminU = U('admin@demo.local');
  const team = db.prepare("SELECT id FROM chat_channels WHERE kind = 'team'").get().id;
  const msg = db.prepare('INSERT INTO chat_messages (channel_id, user_id, user_name, body, created_at) VALUES (?,?,?,?,?)');
  const at = (d, t) => `${day(d)} ${t}:00`;
  msg.run(team, owner.id, owner.name, 'Safety meeting Monday 7:30 at the shop — coffee and donuts on me.', at(-2, '16:05'));
  msg.run(team, mikeU.id, mikeU.name, '👍', at(-2, '16:12'));
  msg.run(team, adminU.id, adminU.name, 'Reminder: weekly truck counts are due Friday.', at(-1, '08:02'));
  const dm = Number(db.prepare("INSERT INTO chat_channels (kind, created_by) VALUES ('direct', ?)").run(jenU.id).lastInsertRowid);
  for (const u of [jenU, mikeU]) db.prepare('INSERT INTO chat_members (channel_id, user_id) VALUES (?,?)').run(dm, u.id);
  msg.run(dm, jenU.id, jenU.name, 'Do you have a spare 12V 7Ah battery on Truck 1?', at(0, '09:14'));
  msg.run(dm, mikeU.id, mikeU.name, 'Yep, 4 of them. Swing by the Dental office around 1.', at(0, '09:20'));
  const emergency = db.prepare("SELECT id FROM service_calls WHERE priority = 'emergency' LIMIT 1").get();
  if (emergency) {
    const jc = Number(db.prepare("INSERT INTO chat_channels (kind, service_call_id, created_by) VALUES ('job', ?, ?)").run(emergency.id, mikeU.id).lastInsertRowid);
    msg.run(jc, mikeU.id, mikeU.name, 'Operatory 3 detector is a discontinued model — OK to swap in the new System Sensor head? About $40 more.', at(0, '10:41'));
    msg.run(jc, adminU.id, adminU.name, 'Yes, go ahead. I’ll let Dr. Cho know.', at(0, '10:44'));
  }
  for (const [ch, u] of [[team, owner], [team, mikeU], [team, adminU], [dm, mikeU]]) db.prepare('INSERT OR REPLACE INTO chat_members (channel_id, user_id, last_read_id) VALUES (?,?,(SELECT MAX(id) FROM chat_messages WHERE channel_id = ?))').run(ch, u.id, ch);
  void samU;
}

// Time off: Sam's approved vacation, and a pending request from Mike.
{
  const U = email => db.prepare('SELECT id FROM users WHERE email = ?').get(email).id;
  const ins = db.prepare('INSERT INTO time_off (user_id, technician_id, kind, starts_at, ends_at, all_day, note, status, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
  ins.run(U('sam@demo.local'), sam.id, 'vacation', `${day(9)}T00:00`, `${day(13)}T23:59`, 1, 'Family trip', 'approved', 'Demo Owner', `${day(-6)}T10:00`);
  const req = Number(ins.run(U('mike@demo.local'), mike.id, 'personal', `${day(4)}T12:00`, `${day(4)}T17:00`, 0, 'Kid’s school play', 'pending', null, null).lastInsertRowid);
  // Company holidays (the usual six) for this year and next, and hours on the requests above.
  const { usHolidays, requestHours } = hrApi;
  const yr = Number(today.slice(0, 4));
  const common = new Set(['new_year', 'memorial', 'independence', 'labor', 'thanksgiving', 'day_after_thanksgiving', 'christmas_eve', 'christmas']);
  for (const y of [yr, yr + 1]) for (const h of usHolidays(y)) if (common.has(h.key)) db.prepare('INSERT OR IGNORE INTO company_holidays (date, name) VALUES (?,?)').run(h.date, h.name);
  for (const t of db.prepare('SELECT * FROM time_off').all()) db.prepare('UPDATE time_off SET hours = ? WHERE id = ?').run(requestHours(db, t), t.id);
  db.prepare('INSERT INTO pto_allowances (user_id, year, vacation, sick, personal, carry_vacation, carry_sick, carry_personal) VALUES (?,?,?,?,?,?,?,?)').run(U('mike@demo.local'), yr, 120, 40, 16, 16, 8, 0);
  db.prepare('INSERT INTO alerts (kind, severity, title, body, link) VALUES (?,?,?,?,?)').run('time_off', 'info', `Mike Alvarez requested time off (personal)`, '“Kid’s school play”', `#/time-off?req=${req}`);
}

// Pay & benefits add-on (on in the demo so it can be seen; it's off on a fresh install).
{
  db.prepare("UPDATE settings SET value = '1' WHERE key = 'addon_pay'").run();
  db.prepare("UPDATE settings SET value = 'Ann in accounting · (555) 555-0104' WHERE key = 'payroll_contact'").run();
  db.prepare("UPDATE settings SET value = 'Paid every other Friday by direct deposit. Your Workforce invite comes by email after your first paycheck.' WHERE key = 'payroll_note'").run();
  for (const [name, kind, provider, summary, phone, site, enroll] of [
    ['Medical — PPO', 'health', 'Anthem Blue Cross', 'Company pays 80% of employee premium, 50% for dependents. $1,500 deductible.', '800-555-0110', 'https://www.anthem.com', 'Open enrollment every November; new hires within 30 days'],
    ['Dental', 'dental', 'Delta Dental', 'Two cleanings a year covered 100%.', '800-555-0120', 'https://www.deltadental.com', 'With medical'],
    ['401(k)', 'retirement', 'Guideline', 'Company matches 100% of the first 3% you put in.', '888-555-0130', 'https://www.guideline.com', 'Any time after 90 days'],
  ]) C('benefit_plans', { name, kind, provider, summary, member_phone: phone, website: site, enrollment: enroll });
  const dir = path.join(DATA_DIR, 'hrdocs');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const pdf = t => Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 300]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj 4 0 obj<</Length ${44 + t.length}>>stream\nBT /F1 18 Tf 40 240 Td (DEMO - ${t}) Tj ET\nendstream endobj 5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`);
  const jenId = db.prepare("SELECT id FROM users WHERE email = 'jen@demo.local'").get().id;
  for (const [kind, title, period] of [['pay stub', 'Pay stub — Nov 13', day(-15)], ['pay stub', 'Pay stub — Nov 27', day(-1)], ['W-2', 'W-2 2025', `${Number(today.slice(0, 4)) - 1}-12-31`]]) {
    const key = crypto.randomBytes(16).toString('hex') + '.pdf';
    fs.writeFileSync(path.join(dir, key), pdf(title), { mode: 0o600 });
    db.prepare('INSERT INTO employee_documents (user_id, kind, title, period, file_key, file_name, content_type, size, uploaded_by) VALUES (?,?,?,?,?,?,?,?,?)').run(jenId, kind, title, period, key, `${title}.pdf`, 'application/pdf', 400, 'Ann Accounting');
  }
}

// Training library and support contacts.
{
  const lib = [
    ['Qolsys IQ4 — installer & dealer codes', 'manual', 'alarm panels', 'Qolsys', 'IQ4 NS, IQ4 Hub', '', 'installer code, dealer code, default, programming', 'Installer menu: Settings > Advanced Settings > enter installer code.\nCompany standard: change the installer code at install and record it in the customer’s alarm account notes (never on paper left at the site).\nFor a panel locked out by another dealer, call Qolsys tech support with the panel’s IMEI.'],
    ['Adding a wireless zone (Qolsys IQ4)', 'article', 'alarm panels', 'Qolsys', 'IQ4', '', 'zone programming, learn sensor, wireless', '1. Settings > Advanced > Installation > Devices > Security Sensors > Auto Learn Sensor.\n2. Trip the sensor (pull the tab or tamper it).\n3. Pick the sensor type, group and name, then Add New.\n4. Walk test from the panel, then send a test signal to the central station.\n5. Update the zone list on the customer’s monitoring account in SecureOps.'],
    ['Terminating Cat6 (T568B)', 'article', 'networking', '', '', '', 'crimp, rj45, t568b, ethernet', 'Order: white-orange, orange, white-green, blue, white-blue, green, white-brown, brown.'],
    ['Hikvision NVR — first setup and adding cameras', 'video', 'cameras & NVRs', 'Hikvision', 'DS-7600 series', '', 'nvr, activate, add camera, poe', 'Activate with a strong password, set time zone and NTP first, then add PoE cameras (they show up automatically on the NVR’s own ports).'],
    ['Fire alarm — before you test', 'article', 'fire alarm', '', '', '', 'testing, central station, place on test, ahj', '1. Tell the customer’s on-site contact.\n2. Put the account on test with the central station (Monitoring tab → Put on test) and note the reference number.\n3. Tell the fire department if the AHJ requires it.\n4. When finished: restore every device, clear the panel, take the account off test and confirm signals are received.'],
    ['Kitchen hood suppression — semi-annual inspection checklist', 'article', 'sprinkler & suppression', 'Ansul', 'R-102', '', 'kitchen hood, r-102, fusible links, nfpa 17a, nfpa 96', 'Replace fusible links per manufacturer (at least yearly). Check nozzles and caps, cylinder pressure/weight, manual pull station, gas shut-off and electric shut-off. Tag the system and fill out the Kitchen suppression inspection report in SecureOps.'],
    ['Extinguisher 6-year maintenance and hydro dates', 'article', 'extinguishers', '', '', '', '6 year, hydrostatic, stored pressure, nfpa 10', 'Stored-pressure dry chemical: 6-year internal maintenance and 12-year hydro. Disposable units: replace at 12 years from the date of manufacture. SecureOps shows the due dates on each extinguisher.'],
    ['Ladder safety', 'article', 'safety', '', '', '', 'ladder, fall protection', 'Three points of contact. Never stand on the top two steps of a step ladder. Extension ladders: 1 foot out for every 4 feet up, and 3 feet above the landing.'],
    ['Company vehicle policy', 'manual', 'company policies', '', '', '', 'vehicle, phone use, accident', 'Hands-free only while driving. Do the vehicle check in SecureOps each morning. In an accident: make sure everyone is safe, call 911 if needed, take photos, then call the office.'],
    ['Using SecureOps on your phone', 'article', 'using SecureOps', '', '', '', 'app, install, my day, photos', 'Install it: open the site in Safari (iPhone) or Chrome (Android) and Add to Home Screen. Start each morning on My Day: vehicle check, materials, then your first job.'],
  ];
  const ids = lib.map(([title, kind, category, manufacturer, model, url, tags, body]) => C('training_resources', { title, kind, category, manufacturer, model, url, tags, body }).id);
  // A small demo PDF on the vehicle policy and the IQ4 codes items.
  const dir = path.join(DATA_DIR, 'library');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const pdf = t => Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 300]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj 4 0 obj<</Length ${44 + t.length}>>stream\nBT /F1 18 Tf 40 240 Td (DEMO - ${t}) Tj ET\nendstream endobj 5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`);
  for (const [i, name, text] of [[0, 'IQ4-installer-guide.pdf', 'Qolsys IQ4 installer guide'], [8, 'Vehicle-policy.pdf', 'Company vehicle policy']]) {
    const key = crypto.randomBytes(16).toString('hex') + '.pdf';
    fs.writeFileSync(path.join(dir, key), pdf(text), { mode: 0o600 });
    db.prepare('UPDATE training_resources SET file_key = ?, file_name = ? WHERE id = ?').run(key, name, ids[i]);
  }
  for (const [company, department, products, phone, email, website, hours, account_number, notes] of [
    ['Qolsys', 'tech support', 'IQ panels, sensors', '855-555-0141', 'techsupport@example.com', 'https://qolsys.com', 'M–F 8am–8pm ET', 'Dealer D-4471', 'Have the panel IMEI and software version ready.'],
    ['Alarm.com', 'tech support', 'Alarm.com accounts & modules', '866-555-0142', '', 'https://alarm.com/dealer', '24/7', 'Dealer 31877', 'Press 2 for dealer support, then 1 for technical.'],
    ['Hikvision', 'warranty / RMA', 'Cameras & NVRs', '909-555-0143', 'rma@example.com', 'https://us.hikvision.com', 'M–F 9–5 PT', '', 'Need serial number and proof of purchase (warranty photo in SecureOps).'],
    ['ADI Global', 'sales rep', 'Most parts', '800-555-0144', 'orders@example.com', 'https://adiglobaldistribution.us', 'M–F 7–6', 'ADI 0049213', 'Rep: Dana. Will-call at the Dayton branch.'],
    ['Rapid Response Monitoring', 'central station', 'Monitoring', '800-555-0145', '', '', '24/7', 'Dealer RR-118', 'Have the account number and passcode ready.'],
    ['Ansul / Johnson Controls', 'tech support', 'R-102 kitchen systems', '800-555-0146', '', '', 'M–F 8–5 CT', '', ''],
  ]) C('vendor_contacts', { company, department, products, phone, email, website, hours, account_number, notes });
}

// Map points around Springfield, OH for customers/sites, and live truck positions.
{
  let i = 0;
  for (const c of db.prepare('SELECT id FROM customers ORDER BY id').all()) {
    const ang = i * 2.1, r = 0.02 + (i % 5) * 0.018; i++;
    db.prepare('UPDATE customers SET lat = ?, lng = ? WHERE id = ?').run(+(39.9242 + Math.sin(ang) * r).toFixed(5), +(-83.8088 + Math.cos(ang) * r * 1.3).toFixed(5), c.id);
  }
  for (const l of db.prepare('SELECT id, customer_id FROM locations').all()) {
    const c = db.prepare('SELECT lat, lng FROM customers WHERE id = ?').get(l.customer_id);
    db.prepare('UPDATE locations SET lat = ?, lng = ? WHERE id = ?').run(c.lat + 0.004 * (l.id % 3), c.lng - 0.005 * (l.id % 2), l.id);
  }
  const pos = db.prepare('INSERT INTO vehicle_positions (vehicle_id, lat, lng, speed_mph, heading, recorded_at, address, source) VALUES (?,?,?,?,?,?,?,?)');
  const nowHM = (() => { const d = new Date(); return `${today}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; })();
  pos.run(v1.id, 39.9361, -83.7952, 31, 80, nowHM, 'E Main St & Limestone St, Springfield, OH', 'demo');
  pos.run(v2.id, 39.9102, -83.8301, 0, 0, nowHM, 'Northgate Self Storage, 2200 Northgate Rd', 'demo');
  pos.run(v3.id, 39.9530, -83.7710, 44, 200, nowHM, 'I-70 W near exit 59', 'demo');
  for (const [v, tid] of [[v1, '281474976710655'], [v2, '281474976710656'], [v3, '281474976710657']]) {
    db.prepare('UPDATE vehicles SET tracker_id = ?, tracking_url = ?, camera_url = ? WHERE id = ?').run(tid, `https://cloud.samsara.com/o/demo/devices/${tid}/vehicle`, `https://cloud.samsara.com/o/demo/devices/${tid}/vehicle?cameras=1`, v.id);
  }
}

// On-call rotation (started 3 days ago) and a few calls in the log.
{
  const start = day(-3);
  [[mike, jen], [jen, sam], [sam, mike], [mike, jen], [jen, sam], [sam, mike]].forEach(([t, bk], i) =>
    db.prepare('INSERT INTO on_call_shifts (technician_id, backup_technician_id, starts_at, ends_at, cal_sequence) VALUES (?,?,?,?,0)').run(t.id, bk.id, `${addDays(start, i * 7)}T08:00`, `${addDays(start, (i + 1) * 7)}T08:00`));
  const pc = db.prepare(`INSERT INTO phone_calls (direction, from_number, to_number, customer_id, user_id, technician_id, route, routed_to, answered_by, status, duration, voicemail_url, voicemail_seconds, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  pc.run('inbound', '+15550301', '+15555550100', custs[0]?.id ?? null, null, mike.id, 'on call', 'Mike Alvarez', 'Mike Alvarez', 'answered', 312, null, null, `${day(-1)} 22:14:00`);
  pc.run('inbound', '+15550399', '+15555550100', null, null, null, 'on call', 'Mike Alvarez → Jen Park', null, 'voicemail', 41, 'https://api.twilio.com/demo-recording', 33, `${day(-2)} 06:02:00`);
  pc.run('outbound', '+15555550100', '+15550302', custs[1]?.id ?? null, null, jen.id, 'click to call', 'Jen Park', null, 'completed', 95, null, null, `${today} 09:41:00`);
}

});

// Time clock: office location, two weeks of punches, and one clock-in away from the office today.
{
  const set = db.prepare('UPDATE settings SET value = ? WHERE key = ?');
  set.run('123 Main St, Springfield, OH 45501', 'office_address'); set.run('39.924200', 'office_lat'); set.run('-83.808800', 'office_lng');
  const punch = db.prepare(`INSERT INTO time_entries (user_id, technician_id, clock_in, clock_out, in_lat, in_lng, in_acc, in_dist, in_flag, out_flag) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const staff = db.prepare("SELECT id, name, technician_id FROM users WHERE active = 1").all();
  for (let back = 13; back >= 1; back--) {
    const d = day(-back);
    if ([0, 6].includes(new Date(d + 'T12:00:00Z').getUTCDay())) continue;
    staff.forEach((u, i) => punch.run(u.id, u.technician_id, `${d}T0${7 + (i % 2)}:${String(10 + i * 7).padStart(2, '0')}`, `${d}T${16 + (i % 2)}:${String(5 + i * 9).padStart(2, '0')}`, 39.9243, -83.8087, 12, 15, 'office', 'office'));
  }
  const nowHM = new Date();
  if (nowHM.getHours() >= 8) {
    for (const u of staff.filter(u => u.technician_id)) {
      const away = u.name === 'Sam Turner';
      const id = Number(punch.run(u.id, u.technician_id, `${today}T07:${away ? '52' : '31'}`, null, away ? 39.9611 : 39.9241, away ? -83.7426 : -83.8089, 18, away ? 7200 : 12, away ? 'away' : 'office', null).lastInsertRowid);
      if (away) db.prepare('INSERT INTO alerts (kind, severity, title, body, link) VALUES (?,?,?,?,?)').run('clock_location', 'warn', `${u.name} clocked in 4.5 mi from the office`, `${today} 07:52\nLocation: https://www.google.com/maps?q=39.9611,-83.7426 (±18 m)`, `#/timeclock?entry=${id}`);
    }
  }
}

// A demo customer-portal login (Tom & Linda Becker)
db.prepare('INSERT INTO portal_users (customer_id, name, email, password_hash, email_verified) VALUES (?,?,?,?,1)')
  .run(1, 'Tom Becker', 'becker@example.com', hashPassword('demo1234'));

// Supplier invoices: one received automatically, one waiting for review.
db.prepare("UPDATE settings SET value = 'adiglobal.com, anixter.com' WHERE key = 'trusted_vendor_domains'").run();
const csv1 = 'Part #,Description,Qty Shipped,Unit Price\nBAT-12V7,12V 7Ah battery,24,15.80\nSNS-PIR,PIR motion detector,10,21.50\n';
const [r1] = ingest(db, { source: 'email', fromEmail: 'invoices@adiglobal.com', subject: 'ADI Invoice 447901', files: [{ name: 'ADI-447901.csv', type: 'text/csv', data: Buffer.from(csv1) }] });
db.prepare("UPDATE purchase_invoices SET vendor = 'ADI Global', invoice_number = '447901', invoice_date = ? WHERE id = ?").run(day(-6), r1);
await processInvoice(db, r1);
const csv2 = 'Item Number,Description,Qty Shipped,Unit Price\nFA-HS-W,Horn/strobe wall white,6,40.25\nSYS-RP2,System Sensor RP2 smoke detector,12,36.10\n';
const [r2] = ingest(db, { source: 'email', fromEmail: 'ar@anixter.com', subject: 'Anixter invoice 99120', files: [{ name: 'anixter-99120.csv', type: 'text/csv', data: Buffer.from(csv2) }] });
db.prepare("UPDATE purchase_invoices SET vendor = 'Anixter', invoice_number = '99120', invoice_date = ? WHERE id = ?").run(day(-1), r2);
await processInvoice(db, r2);

console.log(`Demo data loaded into ${DB_PATH}`);
console.log('Sign in with owner@demo.local / demo1234 (also admin@, sales@, accounting@, and technicians jen@, mike@, sam@demo.local)');
console.log('Customer portal (/portal): becker@example.com / demo1234');
