// Billing frequency (monthly / quarterly / 6-month / yearly), product photos, site-survey
// photos on customers and proposals, and HR access to timesheets.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'secureops-sp-'));
process.env.DATA_DIR = tmp;
const { openDb } = await import('../server/db.js');
const { createServer } = await import('../server/server.js');
const { todayLocal } = await import('../server/resources.js');

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
    const buf = Buffer.from(await res.arrayBuffer());
    let data = null; try { data = JSON.parse(buf.toString()); } catch { /* image */ }
    return { status: res.status, data, buf, type: res.headers.get('content-type') };
  };
  return { get: u => call('GET', u), post: (u, b = {}) => call('POST', u, b), put: (u, b = {}) => call('PUT', u, b), del: u => call('DELETE', u) };
}
const owner = client(), sales = client(), tech = client(), hr = client(), pub = client();
const ids = {};
// A tiny valid PNG.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const month = (n = 0) => { const d = new Date(Number(todayLocal().slice(0, 4)), Number(todayLocal().slice(5, 7)) - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

test('setup', async () => {
  await owner.post('/api/auth/setup', { name: 'Olivia Owner', email: 'owner@example.com', password: 'password123', company_name: 'Photo Co' });
  for (const [c, name, email, role] of [[sales, 'Sal Sales', 'sal@example.com', 'sales'], [tech, 'Tess Tech', 'tess@example.com', 'technician'], [hr, 'Hana HR', 'hana@example.com', 'hr']]) {
    await owner.post('/api/users', { name, email, password: 'password123', role });
    await c.post('/api/auth/login', { email, password: 'password123' });
  }
  ids.cust = (await owner.post('/api/r/customers', { name: 'Harbor Dental', type: 'commercial', status: 'active' })).data.id;
  ids.cust2 = (await owner.post('/api/r/customers', { name: 'Elm St Home', type: 'residential', status: 'active' })).data.id;
});

test('billing frequency: quarterly and yearly charges are billed only in their months, for the whole period', async () => {
  const m = await owner.post('/api/r/recurring_charges', { customer_id: ids.cust, description: 'Alarm monitoring', amount: 40, frequency: 'monthly' });
  assert.equal(m.status, 200, JSON.stringify(m.data));
  assert.equal(db.prepare('SELECT start_month FROM recurring_charges WHERE id = ?').get(m.data.id).start_month, month(0), 'blank start = this month');
  await owner.post('/api/r/recurring_charges', { customer_id: ids.cust, description: 'Cloud video', amount: 25, frequency: 'quarterly', start_month: month(0) });
  await owner.post('/api/r/recurring_charges', { customer_id: ids.cust2, description: 'Annual inspection plan', amount: 10, frequency: 'annual', start_month: month(1) });
  assert.equal((await owner.post('/api/r/recurring_charges', { customer_id: ids.cust2, description: 'x', amount: 1, start_month: '2026/3' })).status, 400);

  // This month: monthly + quarterly for Harbor; nothing for Elm St (annual starts next month)
  let pv = (await owner.post('/api/invoices/generate-monthly', { period: month(0), dry_run: true })).data;
  assert.deepEqual(pv.customers.map(c => [c.name, c.amount]), [['Harbor Dental', 40 + 75]]);
  assert.match(pv.customers[0].detail, /Cloud video \(quarterly\)/);
  const run = await owner.post('/api/invoices/generate-monthly', { period: month(0) });
  assert.equal(run.data.created, 1);
  const inv = db.prepare("SELECT id FROM invoices WHERE customer_id = ? AND period = ?").get(ids.cust, month(0));
  const lines = db.prepare('SELECT description, unit_price FROM invoice_items WHERE invoice_id = ? ORDER BY id').all(inv.id);
  assert.equal(lines.length, 2);
  assert.equal(lines[1].unit_price, 75);
  assert.match(lines[1].description, /Cloud video — .* to .* \(3 months × \$25\.00\)/);
  // Next month: only monthly for Harbor; annual for Elm St = 12 × 10
  pv = (await owner.post('/api/invoices/generate-monthly', { period: month(1), dry_run: true })).data;
  assert.deepEqual(pv.customers.map(c => [c.name, c.amount]).sort(), [['Elm St Home', 120], ['Harbor Dental', 40]]);
  // Three months on: quarterly again
  pv = (await owner.post('/api/invoices/generate-monthly', { period: month(3), dry_run: true })).data;
  assert.equal(pv.customers.find(c => c.name === 'Harbor Dental').amount, 115);
  // Elm St's annual isn't billed again until 12 months after its start
  pv = (await owner.post('/api/invoices/generate-monthly', { period: month(2), dry_run: true })).data;
  assert.ok(!pv.customers.some(c => c.name === 'Elm St Home'));
  pv = (await owner.post('/api/invoices/generate-monthly', { period: month(13), dry_run: true })).data;
  assert.equal(pv.customers.find(c => c.name === 'Elm St Home').amount, 120);
});

test('product photos: upload, list, remove; only billing roles change them', async () => {
  ids.item = (await owner.post('/api/r/inventory_items', { name: '4MP Turret Camera', sku: 'CAM-4T', unit_price: 189 })).data.id;
  assert.equal((await tech.post(`/api/inventory/${ids.item}/photo`, { photo: PNG })).status, 403);
  assert.equal((await owner.post(`/api/inventory/${ids.item}/photo`, { photo: 'data:text/plain;base64,aGVsbG8=' })).status, 400);
  assert.equal((await owner.post(`/api/inventory/${ids.item}/photo`, { photo: PNG })).status, 200);
  const img = await tech.get(`/api/inventory/${ids.item}/photo`);
  assert.equal(img.status, 200);
  assert.equal(img.type, 'image/png');
  ids.item2 = (await owner.post('/api/r/inventory_items', { name: 'Labor', sku: 'LAB', unit_price: 95 })).data.id;
});

test('site survey photos: sales adds marked-up photos with notes; techs can’t see them', async () => {
  const r = await sales.post(`/api/customers/${ids.cust}/survey-photos`, { photo: PNG, title: 'Front entry — camera 1', note: 'Mount above door, 9 ft. Outlet inside closet.' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  ids.sp1 = r.data.id;
  ids.sp2 = (await sales.post(`/api/customers/${ids.cust}/survey-photos`, { photo: PNG, title: 'Back office — NVR spot' })).data.id;
  const list = (await sales.get(`/api/customers/${ids.cust}/survey-photos`)).data;
  assert.equal(list.length, 2);
  assert.equal(list[0].note, 'Mount above door, 9 ft. Outlet inside closet.');
  assert.equal((await sales.get(list[0].url)).status, 200);
  assert.equal((await tech.get(`/api/customers/${ids.cust}/survey-photos`)).status, 403);
  assert.equal((await hr.get(`/api/customers/${ids.cust}/survey-photos`)).status, 403);
  // Edit notes and replace the image (marked up)
  assert.equal((await sales.put(`/api/survey-photos/${ids.sp1}`, { note: 'Mount above door at 9 ft; run cable through attic.', photo: PNG })).status, 200);
});

test('proposals: product photos and chosen survey photos appear on the customer’s document; locked once signed', async () => {
  const p = await sales.post('/api/r/proposals', { customer_id: ids.cust, title: 'Camera upgrade', kind: 'proposal', monthly_amount: 30, monthly_description: 'Cloud video', billing_frequency: 'quarterly' });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  ids.p = p.data.id;
  await sales.post('/api/r/proposal_items', { proposal_id: ids.p, item_id: ids.item, description: '4MP Turret Camera', qty: 4, unit_price: 189 });
  await sales.post('/api/r/proposal_items', { proposal_id: ids.p, item_id: ids.item2, description: 'Installation labor', qty: 6, unit_price: 95 });
  // Pick survey photo 1 for this proposal
  assert.equal((await sales.put(`/api/survey-photos/${ids.sp1}`, { proposal_id: ids.p, show_on_proposal: true })).status, 200);
  const doc = (await sales.get(`/api/proposals/${ids.p}/document`)).data;
  assert.equal(doc.items[0].photo_item, ids.item);
  assert.equal(doc.items[1].photo_item, undefined, 'no photo → no key, document unchanged');
  assert.deepEqual(doc.survey.map(x => x.title), ['Front entry — camera 1']);
  assert.equal(doc.billing_frequency, 'quarterly');
  // The customer's public link serves exactly those photos, nothing else
  const send = await sales.post(`/api/proposals/${ids.p}/send`, { email: false, sms: false });
  const token = send.data.url.split('/').pop();
  assert.equal((await pub.get(`/api/public/proposals/${token}/item-photo/${ids.item}`)).status, 200);
  assert.equal((await pub.get(`/api/public/proposals/${token}/survey-photo/${ids.sp1}`)).status, 200);
  assert.equal((await pub.get(`/api/public/proposals/${token}/survey-photo/${ids.sp2}`)).status, 404, 'not chosen for the proposal');
  assert.equal((await pub.get(`/api/public/proposals/wrongtoken123456789/item-photo/${ids.item}`)).status, 404);
  // Turning product photos off hides them
  await sales.put(`/api/r/proposals/${ids.p}`, { show_item_photos: 0 });
  assert.equal((await sales.get(`/api/proposals/${ids.p}/document`)).data.items[0].photo_item, undefined);
  assert.equal((await pub.get(`/api/public/proposals/${token}/item-photo/${ids.item}`)).status, 404);
  await sales.put(`/api/r/proposals/${ids.p}`, { show_item_photos: 1 });
  // Sign → quarterly recurring charge; photos on it are locked
  const signed = await pub.post(`/api/public/proposals/${token}/sign`, { name: 'Dr. Ana Ruiz', title: 'Owner', email: 'ana@example.com', agree: true, image: PNG });
  assert.equal(signed.status, 200, JSON.stringify(signed.data));
  const rc = db.prepare("SELECT * FROM recurring_charges WHERE customer_id = ? AND description = 'Cloud video' ORDER BY id DESC").get(ids.cust);
  assert.equal(rc.frequency, 'quarterly');
  assert.equal(rc.amount, 30);
  assert.equal((await sales.put(`/api/survey-photos/${ids.sp1}`, { note: 'changed' })).status, 409);
  assert.equal((await sales.del(`/api/survey-photos/${ids.sp1}`)).status, 409);
  assert.equal((await sales.post(`/api/customers/${ids.cust}/survey-photos`, { photo: PNG, proposal_id: ids.p })).status, 409);
  // Unrelated photos can still be deleted
  assert.equal((await sales.del(`/api/survey-photos/${ids.sp2}`)).status, 200);
  // The signed fingerprint still matches the document
  const p2 = (await sales.get(`/api/r/proposals/${ids.p}`)).data;
  assert.equal((await sales.get(`/api/proposals/${ids.p}/document`)).data.signed.hash, p2.doc_hash);
});

test('HR can see and export timesheets', async () => {
  assert.equal((await hr.get('/api/timeclock/timesheet')).status, 200);
  assert.equal((await tech.get('/api/timeclock/timesheet')).status, 403);
});
