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
  await owner.put('/api/settings', { require_photos: '0', require_parts: '0', require_signature: '0' }); // switched on in their own tests
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

test('texts and emails: booking confirmations, tech calendar invites, on-my-way', async () => {
  const http = await import('node:http');
  const texts = [];
  const twilio = http.createServer((req, res) => {
    let b = ''; req.on('data', c => { b += c; });
    req.on('end', () => {
      texts.push({ auth: req.headers.authorization, url: req.url, ...Object.fromEntries(new URLSearchParams(b)) });
      res.writeHead(201, { 'Content-Type': 'application/json' }); res.end('{"sid":"SM1"}');
    });
  });
  await new Promise(r => twilio.listen(0, '127.0.0.1', r));
  Object.assign(process.env, { SMTP_HOST: 'json', MAIL_FROM: 'office@test.example', TWILIO_ACCOUNT_SID: 'AC123', TWILIO_AUTH_TOKEN: 'tok', TWILIO_FROM: '+15550001111', TWILIO_API_BASE: `http://127.0.0.1:${twilio.address().port}` });
  const { notifyIdle } = await import('../server/notify.js');
  try {
    await owner.put(`/api/r/technicians/${ids.tech}`, { email: 'tess@example.com' });
    const cust = (await owner.post('/api/r/customers', { name: 'Pat Home', type: 'residential', email: 'pat@example.com', phone: '(555) 222-3333', notify_sms: 1, notify_email: 1 })).data;
    const soon = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
    const job = (await owner.post('/api/r/service_calls', { customer_id: cust.id, title: 'Keypad', technician_id: ids.tech, scheduled_start: `${soon}T14:00` })).data;
    await notifyIdle();
    let msgs = (await owner.get(`/api/notifications?related_type=service_call&related_id=${job.id}`)).data;
    const custEmail = msgs.find(m => m.channel === 'email' && m.to_addr === 'pat@example.com');
    assert.equal(custEmail?.status, 'sent');
    assert.match(custEmail.subject, /Confirmed/);
    assert.match(custEmail.body, /2:00 PM/);
    assert.equal(msgs.find(m => m.channel === 'sms')?.to_addr, '+15552223333', 'US numbers normalized for texting');
    assert.match(texts[0].Body, /scheduled for .* at 2:00 PM with Tess/);
    assert.match(texts[0].url, /\/Accounts\/AC123\/Messages\.json/);
    assert.equal(texts[0].auth, 'Basic ' + Buffer.from('AC123:tok').toString('base64'));
    const invite = msgs.find(m => m.to_addr === 'tess@example.com');
    assert.equal(invite?.status, 'sent', 'technician gets a calendar invite');

    // Moving it sends updates; reassigning cancels the old tech's invite
    await owner.put(`/api/r/service_calls/${job.id}`, { scheduled_start: `${soon}T16:00`, technician_id: ids.tech2 });
    await notifyIdle();
    msgs = (await owner.get(`/api/notifications?related_type=service_call&related_id=${job.id}`)).data;
    assert.ok(msgs.some(m => m.subject?.startsWith('Updated:')), 'customer told about the new time');
    assert.ok(msgs.some(m => m.to_addr === 'tess@example.com' && m.subject.startsWith('Cancelled')), 'old tech gets a cancellation');

    // On my way
    const before = texts.length;
    const r = await owner.post(`/api/service_calls/${job.id}/on-my-way`, { eta_minutes: 20 });
    assert.equal(r.data.status, 'en route');
    await notifyIdle();
    assert.match(texts[before].Body, /Bo is on the way and should arrive in about 20 minutes/);

    // Customer preferences are respected
    await owner.put(`/api/r/customers/${cust.id}`, { notify_sms: 0 });
    const n = texts.length;
    await owner.post(`/api/service_calls/${job.id}/resend-confirmation`);
    await notifyIdle();
    assert.equal(texts.length, n, 'no text when the customer opted out');

    // Settings: secrets are write-only
    await owner.put('/api/settings', { smtp_pass: 'super-secret', twilio_token: 'also-secret' });
    const s = (await owner.get('/api/settings')).data;
    assert.equal(s.smtp_pass, undefined);
    assert.equal(s.smtp_pass__set, true);
    assert.ok(!db.prepare("SELECT value FROM settings WHERE key = 'smtp_pass'").get().value.includes('super-secret'), 'stored encrypted');
  } finally {
    twilio.close();
    for (const k of ['SMTP_HOST', 'MAIL_FROM', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM', 'TWILIO_API_BASE']) delete process.env[k];
  }
});

test('without email/text set up, messages are logged as not sent (nothing breaks)', async () => {
  const { notifyIdle } = await import('../server/notify.js');
  const cust = (await owner.post('/api/r/customers', { name: 'No Setup', type: 'residential', email: 'x@example.com', phone: '5551112222' })).data;
  const soon = new Date(Date.now() + 9 * 864e5).toISOString().slice(0, 10);
  const job = await owner.post('/api/r/service_calls', { customer_id: cust.id, title: 'Test', technician_id: ids.tech, scheduled_start: `${soon}T10:00` });
  assert.equal(job.status, 200);
  await notifyIdle();
  const msgs = (await owner.get(`/api/notifications?related_type=service_call&related_id=${job.data.id}`)).data;
  assert.ok(msgs.length >= 2);
  assert.ok(msgs.every(m => m.status === 'skipped'));
  assert.match(msgs.find(m => m.channel === 'sms').error, /not set up/);
});

// 1x1 PNG / JPEG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Buffer.alloc(200)]).toString('base64');

test('before/after photos and customer sign-off on completion', async () => {
  const job = (await owner.post('/api/r/service_calls', { customer_id: ids.cust, title: 'Replace keypad' })).data;
  assert.equal((await owner.post(`/api/service_calls/${job.id}/photos`, { kind: 'before', data: JPG, caption: 'Old keypad' })).status, 200);
  assert.equal((await owner.post(`/api/service_calls/${job.id}/photos`, { kind: 'after', data: 'data:image/jpeg;base64,' + JPG })).status, 200);
  assert.equal((await owner.post(`/api/service_calls/${job.id}/photos`, { kind: 'after', data: Buffer.from('<script>alert(1)</script>').toString('base64') })).status, 400, 'only real images');
  const photos = (await owner.get(`/api/service_calls/${job.id}/photos`)).data;
  assert.deepEqual(photos.map(p => p.kind), ['before', 'after']);
  const img = await owner.call('GET', `/api/photos/${photos[0].id}`, undefined, { raw: true });
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  assert.equal((await fetch(`${base}/api/photos/${photos[0].id}`)).status, 401, 'photos need a login');

  // Technicians can delete their own photos but not someone else's
  await owner.post('/api/users', { name: 'Tess', email: 'tess-login@example.com', password: 'password123', role: 'technician', technician_id: ids.tech });
  const tech = client();
  await tech.post('/api/auth/login', { email: 'tess-login@example.com', password: 'password123' });
  assert.equal((await tech.del(`/api/photos/${photos[0].id}`)).status, 403);
  const mine = (await tech.post(`/api/service_calls/${job.id}/photos`, { kind: 'after', data: JPG })).data;
  assert.equal((await tech.del(`/api/photos/${mine.id}`)).status, 200);

  // Sign-off
  await tech.put(`/api/r/service_calls/${job.id}`, { status: 'completed', labor_hours: 1, resolution: 'Replaced keypad' });
  assert.equal((await tech.post(`/api/service_calls/${job.id}/signature`, { name: 'A', image: PNG })).status, 400, 'needs a name');
  assert.equal((await tech.post(`/api/service_calls/${job.id}/signature`, { name: 'Pat Customer', image: JPG })).status, 400, 'signature must be a PNG');
  const signed = await tech.post(`/api/service_calls/${job.id}/signature`, { name: 'Pat Customer', image: PNG });
  assert.equal(signed.data.signed_by, 'Pat Customer');
  assert.ok(signed.data.signed_at);
  const sig = await owner.call('GET', `/api/service_calls/${job.id}/signature`, undefined, { raw: true });
  assert.equal(sig.headers.get('content-type'), 'image/png');
  // The signature can't be forged through a normal edit
  await owner.put(`/api/r/service_calls/${job.id}`, { signed_by: 'Someone else' });
  assert.equal((await owner.get(`/api/r/service_calls/${job.id}`)).data.signed_by, 'Pat Customer');
});

test('proposals: build, send, view, e-sign with audit trail, then billing + install job + deposit', async () => {
  const cust = (await owner.post('/api/r/customers', { name: 'Riverside Café', type: 'commercial', email: 'owner@riverside.example', contact_name: 'Dana Lee' })).data;
  ids.cafe = cust.id;
  const item = (await owner.post('/api/r/inventory_items', { name: '4K camera', sku: 'CAM4K', unit_price: 200 })).data;
  const p = (await owner.post('/api/r/proposals', { customer_id: cust.id, kind: 'installation agreement', title: '4 cameras + monitoring', monthly_amount: 30, monthly_description: 'Video monitoring', term_months: 12, deposit_percent: 50, tax_rate: 10 })).data;
  assert.equal(p.status, 'draft');
  assert.ok(p.valid_until > new Date().toISOString().slice(0, 10));
  const empty = (await owner.post('/api/r/proposals', { customer_id: cust.id, title: 'Empty' })).data;
  assert.equal((await owner.post(`/api/proposals/${empty.id}/send`)).status, 400, "can't send an empty proposal");
  await owner.post('/api/r/proposal_items', { proposal_id: p.id, item_id: item.id, qty: 4 });
  await owner.post('/api/r/proposal_items', { proposal_id: p.id, description: 'Installation labor', qty: 4, unit_price: 100, taxable: 0 });
  const priced = (await owner.get(`/api/r/proposals/${p.id}`)).data;
  assert.equal(priced.subtotal, 1200, 'inventory price filled in automatically');
  assert.equal(priced.tax, 80);
  assert.equal(priced.total, 1280);

  const sent = (await owner.post(`/api/proposals/${p.id}/send`, { email: false })).data;
  assert.match(sent.url, /\/sign\/[A-Za-z0-9_-]{30,}$/);
  const token = sent.url.split('/').pop();
  assert.equal(db.prepare('SELECT stage FROM customers WHERE id = ?').get(cust.id).stage, 'bid');

  // The public page (no login)
  const pub = client();
  const page = await pub.call('GET', `/sign/${token}`, undefined, { raw: true });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /sign\.js/);
  const view = (await pub.get(`/api/public/proposals/${token}`)).data;
  assert.equal(view.total, 1280);
  assert.equal(view.deposit, 640);
  assert.equal(view.customer.name, 'Riverside Café');
  assert.equal(view.customer.id, undefined, 'no internal ids leak to the public page');
  assert.equal((await owner.get(`/api/r/proposals/${p.id}`)).data.status, 'viewed');
  assert.equal((await pub.get('/api/public/proposals/not-a-real-token-123456789')).status, 404);

  // Signing rules
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  assert.equal((await pub.post(`/api/public/proposals/${token}/sign`, { name: 'Dana Lee', image: PNG })).status, 400, 'must agree');
  assert.equal((await pub.call('POST', `/api/public/proposals/${token}/sign`, { name: 'Dana Lee', image: PNG, agree: true }, { csrf: false })).status, 403, 'CSRF header still required');
  const signed = await pub.post(`/api/public/proposals/${token}/sign`, { name: 'Dana Lee', title: 'Owner', email: 'dana@riverside.example', image: PNG, agree: true });
  assert.equal(signed.status, 200, JSON.stringify(signed.data));
  assert.equal(signed.data.status, 'signed');
  assert.equal((await pub.post(`/api/public/proposals/${token}/sign`, { name: 'X', image: PNG, agree: true })).status, 409, 'cannot sign twice');

  const after = (await owner.get(`/api/r/proposals/${p.id}`)).data;
  assert.equal(after.signed_by, 'Dana Lee');
  assert.match(after.doc_hash, /^[a-f0-9]{64}$/);
  assert.ok(after.signed_ip);
  assert.equal(db.prepare('SELECT stage FROM customers WHERE id = ?').get(cust.id).stage, 'accepted');
  assert.equal((await owner.get(`/api/r/recurring_charges?customer_id=${cust.id}`)).data[0].amount, 30, 'monthly billing started');
  const job = (await owner.get(`/api/r/service_calls/${after.service_call_id}`)).data;
  assert.equal(job.call_type, 'installation');
  const dep = (await owner.get(`/api/r/invoices/${after.invoice_id}`)).data;
  assert.equal(dep.total, 640);
  // Locked once signed
  assert.equal((await owner.put(`/api/r/proposals/${p.id}`, { title: 'Changed' })).status, 409);
  assert.equal((await owner.post('/api/r/proposal_items', { proposal_id: p.id, description: 'Extra', qty: 1, unit_price: 1 })).status, 409);
  assert.equal((await owner.del(`/api/r/proposals/${p.id}`)).status, 409);
  const doc = (await owner.get(`/api/proposals/${p.id}/document`)).data;
  assert.equal(doc.signed.hash, after.doc_hash, 'document still matches what was signed');
  // Duplicate makes an editable new version
  const copy = (await owner.post(`/api/proposals/${p.id}/duplicate`)).data;
  assert.equal(copy.status, 'draft');
  assert.equal(copy.total, 1280);
});

test('proposals: decline and expiry; technicians have no access', async () => {
  const p = (await owner.post('/api/r/proposals', { customer_id: ids.cafe, title: 'Fire alarm upgrade' })).data;
  await owner.post('/api/r/proposal_items', { proposal_id: p.id, description: 'Panel', qty: 1, unit_price: 3000 });
  const token = (await owner.post(`/api/proposals/${p.id}/send`, { email: false })).data.url.split('/').pop();
  const pub = client();
  assert.equal((await pub.post(`/api/public/proposals/${token}/decline`, { reason: 'Too expensive' })).status, 200);
  assert.equal((await owner.get(`/api/r/proposals/${p.id}`)).data.declined_reason, 'Too expensive');

  const old = (await owner.post('/api/r/proposals', { customer_id: ids.cafe, title: 'Old quote', valid_until: '2020-01-01' })).data;
  await owner.post('/api/r/proposal_items', { proposal_id: old.id, description: 'X', qty: 1, unit_price: 1 });
  db.prepare("UPDATE proposals SET public_token = 'expired-token-abcdefghijklmnop', status = 'sent' WHERE id = ?").run(old.id);
  assert.equal((await pub.get('/api/public/proposals/expired-token-abcdefghijklmnop')).data.status, 'expired');
  assert.equal((await pub.post('/api/public/proposals/expired-token-abcdefghijklmnop/sign', { name: 'A B', image: 'x', agree: true })).status, 410);

  await owner.post('/api/users', { name: 'Tech2', email: 'tech2@example.com', password: 'password123', role: 'technician' });
  const t = client();
  await t.post('/api/auth/login', { email: 'tech2@example.com', password: 'password123' });
  assert.equal((await t.get('/api/r/proposals')).status, 403);
});

test('online payments (Stripe): pay link, signed webhook records payment once, charge saved card', async () => {
  const http = await import('node:http');
  const crypto = await import('node:crypto');
  const calls = [];
  const fake = http.createServer((req, res) => {
    let b = ''; req.on('data', c => { b += c; });
    req.on('end', () => {
      const params = Object.fromEntries(new URLSearchParams(b));
      calls.push({ method: req.method, url: req.url, params, auth: req.headers.authorization });
      const send = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      const u = req.url.split('?')[0];
      if (u === '/v1/customers' && req.method === 'POST') return send({ id: 'cus_1' });
      if (u === '/v1/checkout/sessions') return send({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' });
      if (u === '/v1/checkout/sessions/cs_1') return send({ id: 'cs_1', payment_intent: { id: 'pi_1', payment_method: { type: 'us_bank_account' } } });
      if (u === '/v1/customers/cus_1/payment_methods') return send({ data: [{ id: 'pm_card', type: 'card', card: { brand: 'visa', last4: '4242', exp_month: 4, exp_year: 2030 } }] });
      if (u === '/v1/customers/cus_1') return send({ id: 'cus_1', invoice_settings: { default_payment_method: 'pm_card' } });
      if (u === '/v1/payment_intents') return send({ id: 'pi_2', status: 'succeeded', amount_received: Number(params.amount) });
      res.writeHead(404); res.end('{}');
    });
  });
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  Object.assign(process.env, { STRIPE_SECRET_KEY: 'sk_test_123', STRIPE_WEBHOOK_SECRET: 'whsec_abc', STRIPE_API_BASE: `http://127.0.0.1:${fake.address().port}` });
  try {
    const inv = (await owner.post('/api/r/invoices', { customer_id: ids.cafe, status: 'sent', tax_rate: 0 })).data;
    await owner.post('/api/r/invoice_items', { invoice_id: inv.id, description: 'Service', qty: 1, unit_price: 150 });
    assert.equal((await owner.get('/api/payments/config')).data.test, true);
    const link = (await owner.post(`/api/invoices/${inv.id}/pay-link`)).data.url;
    const redirect = await fetch(link.replace(/^https?:\/\/[^/]+/, base), { redirect: 'manual' });
    assert.equal(redirect.status, 303);
    assert.equal(redirect.headers.get('location'), 'https://checkout.stripe.test/cs_1');
    const checkout = calls.find(c => c.url === '/v1/checkout/sessions');
    assert.equal(checkout.params['line_items[0][price_data][unit_amount]'], '15000', 'charges the balance in cents');
    assert.equal(checkout.params['payment_method_types[1]'], 'us_bank_account', 'bank ACH offered');
    assert.equal(checkout.params['metadata[invoice_id]'], String(inv.id));
    assert.equal(checkout.auth, 'Bearer sk_test_123');

    // Webhook: forged signature rejected; real one records the payment exactly once
    const event = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_1', mode: 'payment', payment_status: 'paid', amount_total: 15000, metadata: { invoice_id: String(inv.id) } } } });
    const t = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac('sha256', 'whsec_abc').update(`${t}.${event}`).digest('hex');
    const post = s => fetch(`${base}/api/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': s }, body: event });
    assert.equal((await post(`t=${t},v1=${'0'.repeat(64)}`)).status, 400);
    assert.equal((await post(`t=${t},v1=${sig}`)).status, 200);
    assert.equal((await post(`t=${t},v1=${sig}`)).status, 200, 'Stripe retries are harmless');
    const pays = (await owner.get(`/api/r/payments?invoice_id=${inv.id}`)).data;
    assert.equal(pays.length, 1);
    assert.equal(pays[0].method, 'ach');
    assert.equal(pays[0].amount, 150);
    assert.equal((await owner.get(`/api/r/invoices/${inv.id}`)).data.status, 'paid');

    // Saved card: list, then charge a second invoice
    const pm = (await owner.get(`/api/customers/${ids.cafe}/payment-methods`)).data;
    assert.equal(pm.methods[0].label, 'VISA •••• 4242');
    const inv2 = (await owner.post('/api/r/invoices', { customer_id: ids.cafe, status: 'sent', tax_rate: 0 })).data;
    await owner.post('/api/r/invoice_items', { invoice_id: inv2.id, description: 'Monitoring', qty: 1, unit_price: 30 });
    const charged = (await owner.post(`/api/invoices/${inv2.id}/charge`, {})).data;
    assert.equal(charged.status, 'paid');
    assert.equal(calls.find(c => c.url === '/v1/payment_intents').params.off_session, 'true');
    assert.equal((await owner.get(`/api/r/invoices/${inv2.id}`)).data.status, 'paid');
    // Secrets never come back to the browser
    await owner.put('/api/settings', { stripe_secret: 'sk_live_should_not_leak' });
    assert.ok(!JSON.stringify((await owner.get('/api/settings')).data).includes('sk_live_should_not_leak'));
  } finally {
    fake.close();
    for (const k of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_API_BASE']) delete process.env[k];
  }
});

test('customer portal: sign-up → verify email → lands in portal as a new lead', async () => {
  process.env.SMTP_HOST = 'json'; process.env.MAIL_FROM = 'office@test.example';
  const { notifyIdle } = await import('../server/notify.js');
  try {
    const p = client();
    const r = await p.post('/api/portal/signup', { name: 'Jordan Fox', email: 'jordan@example.com', password: 'longpassword1', phone: '555-777-8888', address: '12 Pine St', type: 'residential' });
    assert.equal(r.status, 200);
    assert.match(r.data.message, /Check your email/);
    await notifyIdle();
    const mail = db.prepare("SELECT body FROM notifications WHERE to_addr = 'jordan@example.com' ORDER BY id DESC").get();
    const token = mail.body.match(/#\/verify\/([A-Za-z0-9_-]+)/)[1];
    // Can sign in, but nothing is visible until the email is confirmed
    await p.post('/api/portal/login', { email: 'jordan@example.com', password: 'longpassword1' });
    assert.equal((await p.get('/api/portal/dashboard')).status, 403);
    assert.equal((await p.post('/api/portal/verify', { token })).status, 200);
    assert.equal((await p.post('/api/portal/verify', { token })).status, 400, 'links work once');
    const st = (await p.get('/api/portal/state')).data;
    assert.equal(st.user.verified, true);
    const cust = db.prepare('SELECT * FROM customers WHERE id = ?').get(st.accounts[0].id);
    assert.equal(cust.stage, 'lead');
    assert.equal(cust.lead_source, 'portal sign-up');
    assert.equal(cust.phone, '555-777-8888');
    assert.equal((await p.get('/api/portal/dashboard')).status, 200);
    ids.portalCust = cust.id;
    ids.portalClient = p;
    // Signing up again with the same email doesn't reveal the account exists
    assert.match((await client().post('/api/portal/signup', { name: 'Jo F', email: 'jordan@example.com', password: 'longpassword1' })).data.message, /Check your email/);
  } finally { delete process.env.SMTP_HOST; delete process.env.MAIL_FROM; }
});

test('customer portal: staff invite, isolation between customers, requests, child accounts', async () => {
  // Invite an existing customer (Riverside Café, which has invoices and a signed agreement)
  await owner.put(`/api/r/customers/${ids.cafe}`, { email: 'owner@riverside.example' });
  const { link } = (await owner.post(`/api/customers/${ids.cafe}/portal-invite`, {})).data;
  const token = link.match(/#\/accept\/(.+)$/)[1];
  const cafe = client();
  assert.equal((await cafe.post('/api/portal/accept', { token, password: 'short' })).status, 400);
  assert.equal((await cafe.post('/api/portal/accept', { token, password: 'cafe-password-1' })).status, 200);
  const invs = (await cafe.get('/api/portal/invoices')).data;
  assert.ok(invs.length >= 2);
  const one = (await cafe.get(`/api/portal/invoices/${invs[0].id}`)).data;
  assert.equal(one.customer.name, 'Riverside Café');
  assert.ok((await cafe.get('/api/portal/agreements')).data.some(a => a.status === 'signed'));

  // Jordan (the other portal user) can't see the café's data
  const jordan = ids.portalClient;
  assert.equal((await jordan.get(`/api/portal/invoices/${invs[0].id}`)).status, 404);
  assert.equal((await jordan.get(`/api/portal/invoices?account=${ids.cafe}`)).status, 404);
  const photo = db.prepare('SELECT id FROM job_photos LIMIT 1').get();
  assert.equal((await jordan.call('GET', `/api/portal/photos/${photo.id}`, undefined, { raw: true })).status, 404);
  // Portal logins can't use staff endpoints, and vice versa
  assert.equal((await cafe.get('/api/r/customers')).status, 401);
  assert.equal((await cafe.get('/api/dashboard')).status, 401);
  assert.equal((await owner.get('/api/portal/dashboard')).status, 401);

  // Requests
  const sr = await cafe.post('/api/portal/service-requests', { title: 'Camera 2 offline', system_type: 'camera', preferred_date: '2099-01-02', window: 'morning', urgent: true });
  assert.equal(sr.status, 200);
  const call = db.prepare("SELECT * FROM service_calls WHERE title = 'Camera 2 offline'").get();
  assert.equal(call.customer_id, ids.cafe);
  assert.equal(call.status, 'new');
  assert.equal(call.priority, 'high');
  assert.match(call.description, /Preferred: .* morning/);
  assert.equal((await cafe.post('/api/portal/equipment-requests', { what: 'Two more cameras for the patio' })).status, 200);
  const draft = db.prepare("SELECT * FROM proposals WHERE title LIKE 'Request: Two more cameras%'").get();
  assert.equal(draft.status, 'draft');
  assert.equal(draft.customer_id, ids.cafe);

  // A business listed under the café's account shows up for them
  const child = (await owner.post('/api/r/customers', { name: 'Riverside Catering', type: 'commercial', parent_id: ids.cafe, portal_invite: 0 })).data;
  const st = (await cafe.get('/api/portal/state')).data;
  assert.deepEqual(st.accounts.map(a => a.name).sort(), ['Riverside Café', 'Riverside Catering']);
  assert.equal((await cafe.get(`/api/portal/invoices?account=${child.id}`)).status, 200);
  assert.equal((await jordan.get(`/api/portal/invoices?account=${child.id}`)).status, 404);

  // Profile: notification preferences
  await cafe.put('/api/portal/profile', { phone: '555-000-1234', notify_sms: false });
  const c = db.prepare('SELECT phone, notify_sms FROM customers WHERE id = ?').get(ids.cafe);
  assert.equal(c.phone, '555-000-1234');
  assert.equal(c.notify_sms, 0);
  // Staff can disable a portal login
  const pu = (await owner.get(`/api/customers/${ids.cafe}/portal-users`)).data[0];
  await owner.put(`/api/portal-users/${pu.id}`, { active: false });
  assert.equal((await cafe.get('/api/portal/dashboard')).status, 401);
});

test('QuickBooks Online: connect, sync customers/invoices/payments once, update and void; export files', async () => {
  const http = await import('node:http');
  const seen = [];
  let nextId = 100;
  const fake = http.createServer((req, res) => {
    let b = ''; req.on('data', c => { b += c; });
    req.on('end', () => {
      const send = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      const u = new URL(req.url, 'http://x');
      seen.push({ method: req.method, path: u.pathname, search: u.search, body: b ? (req.headers['content-type']?.includes('json') ? JSON.parse(b) : Object.fromEntries(new URLSearchParams(b))) : null, auth: req.headers.authorization });
      if (u.pathname === '/oauth2/v1/tokens/bearer') return send({ access_token: 'acc-1', refresh_token: 'ref-1', expires_in: 3600 });
      if (u.pathname === '/revoke') return send({});
      if (u.pathname.endsWith('/companyinfo/9130')) return send({ CompanyInfo: { CompanyName: 'Test Co Books' } });
      if (u.pathname.endsWith('/query')) {
        const q = u.searchParams.get('query');
        if (/from Item/.test(q)) return send({ QueryResponse: { Item: [{ Id: '1', Name: 'Services', Type: 'Service' }, { Id: '7', Name: 'Sales Tax', Type: 'Service' }] } });
        return send({ QueryResponse: {} });
      }
      if (/\/customer$/.test(u.pathname)) return send({ Customer: { Id: String(nextId++), SyncToken: '0' } });
      if (/\/invoice\/\d+$/.test(u.pathname)) return send({ Invoice: { Id: u.pathname.split('/').pop(), SyncToken: '3' } });
      if (/\/invoice$/.test(u.pathname)) return send({ Invoice: { Id: b && JSON.parse(b).Id || String(nextId++), SyncToken: '0' } });
      if (/\/payment$/.test(u.pathname)) return send({ Payment: { Id: String(nextId++), SyncToken: '0' } });
      res.writeHead(404); res.end('{}');
    });
  });
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  const fb = `http://127.0.0.1:${fake.address().port}`;
  Object.assign(process.env, { QBO_OAUTH_BASE: fb, QBO_API_BASE: fb, QBO_REVOKE_URL: `${fb}/revoke` });
  try {
    assert.equal((await owner.post('/api/qbo/connect')).status, 400, 'needs app keys first');
    await owner.put('/api/qbo/settings', { qbo_client_id: 'client-1', qbo_client_secret: 'secret-1' });
    const { url } = (await owner.post('/api/qbo/connect')).data;
    const auth = new URL(url);
    assert.equal(auth.searchParams.get('scope'), 'com.intuit.quickbooks.accounting');
    assert.match(auth.searchParams.get('redirect_uri'), /\/api\/qbo\/callback$/);
    const state = auth.searchParams.get('state');
    // Forged state is rejected
    let cb = await fetch(`${base}/api/qbo/callback?code=x&realmId=9130&state=forged`, { redirect: 'manual' });
    assert.match(cb.headers.get('location'), /qbo_error/);
    cb = await fetch(`${base}/api/qbo/callback?code=abc&realmId=9130&state=${state}`, { redirect: 'manual' });
    assert.equal(cb.headers.get('location'), '/#/accounting?qbo=connected');
    const tokenCall = seen.find(s => s.path === '/oauth2/v1/tokens/bearer');
    assert.equal(tokenCall.auth, 'Basic ' + Buffer.from('client-1:secret-1').toString('base64'));
    assert.equal(tokenCall.body.grant_type, 'authorization_code');
    const st = (await owner.get('/api/qbo/status')).data;
    assert.equal(st.connected, true);
    assert.equal(st.company, 'Test Co Books');
    assert.equal(st.item_id, '1', 'picks the "Services" item');
    assert.ok(!JSON.stringify((await owner.get('/api/settings')).data).includes('acc-1'), 'tokens never sent to the browser');

    // A taxed invoice with a payment
    const cust = (await owner.post('/api/r/customers', { name: "O'Brien Hardware", type: 'commercial', email: 'ob@example.com', billing_address: '5 Elm', city: 'Dayton', state: 'OH', portal_invite: 0 })).data;
    const inv = (await owner.post('/api/r/invoices', { customer_id: cust.id, status: 'sent', tax_rate: 7, issue_date: '2031-04-01' })).data;
    await owner.post('/api/r/invoice_items', { invoice_id: inv.id, description: 'Camera', qty: 2, unit_price: 100, taxable: 1 });
    await owner.post('/api/r/invoice_items', { invoice_id: inv.id, description: 'Labor', qty: 1, unit_price: 50, taxable: 0 });
    await owner.post('/api/r/payments', { invoice_id: inv.id, amount: 100, date: '2031-04-05', method: 'check', reference: '1234' });
    const r1 = (await owner.post('/api/qbo/sync')).data;
    assert.deepEqual(r1.errors, []);
    assert.ok(r1.invoices >= 1 && r1.payments >= 1);
    const custQuery = seen.find(s => s.path.endsWith('/query') && decodeURIComponent(s.search).includes('Brien'));
    assert.match(decodeURIComponent(custQuery.search), /DisplayName = 'O\\'Brien Hardware'/, 'names are escaped in queries');
    const invPost = seen.filter(s => s.path.endsWith('/invoice') && s.method === 'POST').find(s => s.body.DocNumber === String(inv.number));
    const sum = invPost.body.Line.reduce((t, l) => t + l.Amount, 0);
    assert.equal(Math.round(sum * 100) / 100, 264, 'QuickBooks total matches ours (250 + 14 tax)');
    assert.equal(invPost.body.Line.at(-1).Description, 'Sales tax (7%)');
    const payPost = seen.find(s => s.path.endsWith('/payment') && s.body.PaymentRefNum === '1234');
    assert.equal(payPost.body.Line[0].LinkedTxn[0].TxnType, 'Invoice');
    assert.equal(payPost.body.PaymentRefNum, '1234');

    // Nothing new → nothing sent again
    const before = seen.length;
    const r2 = (await owner.post('/api/qbo/sync')).data;
    assert.equal(r2.invoices + r2.payments, 0);
    assert.equal(seen.filter((s, i) => i >= before && s.method === 'POST').length, 0);

    // Edit → update with SyncToken; void → void operation
    await owner.post('/api/r/invoice_items', { invoice_id: inv.id, description: 'Extra', qty: 1, unit_price: 10 });
    await owner.post('/api/qbo/sync');
    const upd = seen.filter(s => s.path.endsWith('/invoice') && s.method === 'POST').at(-1);
    assert.equal(upd.body.SyncToken, '3');
    assert.ok(upd.body.Id);
    const inv2 = (await owner.post('/api/r/invoices', { customer_id: cust.id, status: 'sent', tax_rate: 0 })).data;
    await owner.post('/api/r/invoice_items', { invoice_id: inv2.id, description: 'X', qty: 1, unit_price: 5 });
    await owner.post('/api/qbo/sync');
    await owner.post(`/api/invoices/${inv2.id}/status`, { status: 'void' });
    await owner.post('/api/qbo/sync');
    assert.ok(seen.some(s => s.search.includes('operation=void')), 'voided invoices are voided in QuickBooks');

    // Exports
    const q = await owner.call('GET', '/api/accounting/export?format=qbo-invoices&from=2031-01-01&to=2031-12-31', undefined, { raw: true });
    const qtext = await q.text();
    assert.match(qtext, /InvoiceNo","Customer","InvoiceDate"/);
    assert.match(qtext, /"O'Brien Hardware","04\/01\/2031"/);
    const iif = await (await owner.call('GET', '/api/accounting/export?format=iif&from=2031-01-01&to=2031-12-31', undefined, { raw: true })).text();
    assert.match(iif, /^!TRNS\tTRNSTYPE/);
    assert.match(iif, /\nTRNS\tINVOICE\t04\/01\/2031\tAccounts Receivable\tO'Brien Hardware\t274\.00/);
    assert.match(iif, /\nENDTRNS/);
    const xero = await (await owner.call('GET', '/api/accounting/export?format=xero-invoices&from=2031-01-01&to=2031-12-31', undefined, { raw: true })).text();
    assert.match(xero, /\*ContactName/);
    // Technicians and sales can't reach accounting
    const sales = client();
    await sales.post('/api/auth/login', { email: 'sal@example.com', password: 'password123' });
    assert.equal((await sales.get('/api/qbo/status')).status, 403);
    // Disconnect revokes the token
    await owner.post('/api/qbo/disconnect');
    assert.ok(seen.some(s => s.path === '/revoke'));
    assert.equal((await owner.get('/api/qbo/status')).data.connected, false);
  } finally {
    fake.close();
    for (const k of ['QBO_OAUTH_BASE', 'QBO_API_BASE', 'QBO_REVOKE_URL']) delete process.env[k];
  }
});

test('alarm monitoring: stations, auto account numbers, zones, call list, test mode, station signal feed', async () => {
  const st = (await owner.post('/api/r/monitoring_stations', { name: 'CMS', operator_phone: '800-555-0199', account_prefix: 'C1-', next_account_number: 42, account_digits: 4 })).data;
  const site = (await owner.post('/api/r/locations', { customer_id: ids.cafe, name: 'Riverside main', address: '1 River Rd' })).data;
  const acct = (await owner.post('/api/r/monitoring_accounts', { customer_id: ids.cafe, site_id: site.id, station_id: st.id, service_type: 'burglary + fire', passcode: 'bluebird' })).data;
  assert.equal(acct.account_number, 'C1-0042', 'next number assigned from the station');
  assert.equal(acct.passcode, null, 'passcode is encrypted and hidden');
  assert.equal(acct.site_id_label.split(' — ')[0], 'Riverside main');
  assert.equal((await owner.get(`/api/r/monitoring_stations/${st.id}`)).data.next_account_number, 43);
  assert.equal((await owner.post('/api/r/monitoring_accounts', { customer_id: ids.cafe, station_id: st.id, account_number: 'c1-0042' })).status, 409, 'no duplicate numbers at a station');

  // Zones: add, block a clash, remove (kept as history), reuse the number
  const z1 = (await owner.post('/api/r/monitoring_zones', { account_id: acct.id, zone_number: 1, description: 'Front door', zone_type: 'entry/exit' })).data;
  assert.equal(z1.added_on, new Date().toISOString().slice(0, 10).slice(0, 4) + z1.added_on.slice(4));
  assert.equal((await owner.post('/api/r/monitoring_zones', { account_id: acct.id, zone_number: 1, description: 'Dup' })).status, 409);
  await owner.put(`/api/r/monitoring_zones/${z1.id}`, { active: false });
  const removed = (await owner.get(`/api/r/monitoring_zones/${z1.id}`)).data;
  assert.ok(removed.removed_on);
  assert.equal((await owner.post('/api/r/monitoring_zones', { account_id: acct.id, zone_number: 1, description: 'Front door (new contact)', zone_type: 'entry/exit' })).status, 200);
  await owner.post('/api/r/monitoring_zones', { account_id: acct.id, zone_number: 3, description: 'Kitchen smoke', zone_type: 'smoke' });
  await owner.post('/api/r/monitoring_contacts', { account_id: acct.id, sequence: 1, name: 'Dana Lee', phone: '555-0101', has_key: 1 });

  // Test mode: must go through "Put on test"; technicians can do it
  assert.equal((await owner.put(`/api/r/monitoring_accounts/${acct.id}`, { status: 'on test' })).status, 400);
  await owner.put(`/api/r/monitoring_accounts/${acct.id}`, { status: 'active' });
  const tech = client();
  await tech.post('/api/auth/login', { email: 'tess-login@example.com', password: 'password123' });
  assert.equal((await tech.post(`/api/monitoring/${acct.id}/test`, { minutes: 120 })).status, 404, 'not on their schedule yet');
  const today = new Date().toISOString().slice(0, 10);
  await owner.post('/api/r/service_calls', { customer_id: ids.cafe, title: 'Smoke detector swap', technician_id: ids.tech, scheduled_start: `${today}T23:00`, duration_hours: 0.5, allow_conflict: true });
  const t = await tech.post(`/api/monitoring/${acct.id}/test`, { minutes: 120, reason: 'Replacing kitchen smoke' });
  assert.equal(t.status, 200, JSON.stringify(t.data));
  assert.equal(t.data.account.status, 'on test');
  assert.equal(t.data.station_confirmed, false, 'manual station: not confirmed automatically');
  assert.equal(t.data.station.operator_phone, '800-555-0199', 'UI gets the number to call');
  assert.equal((await tech.post(`/api/monitoring/${acct.id}/test`, { minutes: 5 })).status, 400, 'minimum test period');

  // Station signal feed
  const feed = (await owner.get(`/api/monitoring-stations/${st.id}/feed`)).data.url;
  const push = b => fetch(feed.replace(/^https?:\/\/[^/]+/, base), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
  const r1 = await push({ events: [
    { account: 'C1-0042', time: '2031-05-01T02:10:00', code: 'E111', zone: 3, id: 'ev-1' },
    { account: 'C1-0042', time: '2031-05-01T02:14:00', code: 'R111', zone: 3, disposition: 'Tech on site, test', id: 'ev-2' },
    { account: 'C1-0042', time: '2031-05-01T07:00:00', code: 'OP', description: 'Opened by user 2', id: 'ev-3' },
    { account: 'NOPE-1', code: 'BA', id: 'ev-4' },
  ] });
  assert.deepEqual(r1, { added: 3, duplicates: 0, unknown_accounts: ['NOPE-1'] });
  assert.equal((await push({ account: 'C1-0042', code: 'E111', zone: 3, id: 'ev-1' })).duplicates, 1, 'resends are ignored');
  assert.equal((await fetch(`${base}/api/inbound/monitoring/wrong-token-abcdefghijklmnopqrstuv`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 404);
  const events = (await owner.get(`/api/monitoring/${acct.id}/events`)).data;
  const fire = events.find(e => e.code === 'E111');
  assert.equal(fire.event_type, 'alarm');
  assert.equal(fire.zone_description, 'Kitchen smoke', 'zone name filled in from the zone list');
  assert.equal(fire.on_test, 1, 'flagged because the account was on test');
  assert.equal(events.find(e => e.code === 'R111').event_type, 'restore');
  assert.equal(events.find(e => e.code === 'OP').event_type, 'open/close');
  assert.ok(events.some(e => /Zone 1 “Front door” \(entry\/exit\) removed/.test(e.description)), 'sensor changes are in the activity log');
  assert.ok(events.some(e => /Placed on test/.test(e.description)));

  // Test ends on its own
  const { expireTests } = await import('../server/monitoring.js');
  db.prepare("UPDATE monitoring_accounts SET test_until = '2000-01-01T00:00' WHERE id = ?").run(acct.id);
  assert.equal(await expireTests(db), 1);
  assert.equal((await owner.get(`/api/r/monitoring_accounts/${acct.id}`)).data.status, 'active');

  // Customer portal: activity and zones, never passcodes or internal notes
  const cafe = client();
  await owner.put(`/api/portal-users/${(await owner.get(`/api/customers/${ids.cafe}/portal-users`)).data[0].id}`, { active: true });
  await cafe.post('/api/portal/login', { email: 'owner@riverside.example', password: 'cafe-password-1' });
  const mon = (await cafe.get('/api/portal/monitoring')).data;
  assert.equal(mon[0].account_number, 'C1-0042');
  assert.ok(mon[0].events.some(e => e.code === 'E111'));
  assert.ok(!mon[0].events.some(e => e.event_type === 'system'), 'internal changes are not shown to customers');
  assert.ok(!JSON.stringify(mon).includes('bluebird'));
  assert.deepEqual(mon[0].zones.map(z => z.zone_number), [1, 3]);
});

test('alarm monitoring: import existing alarm systems into monitoring accounts', async () => {
  const cust = (await owner.post('/api/r/customers', { name: 'Legacy Alarm Co', type: 'residential', portal_invite: 0 })).data;
  await owner.post('/api/r/alarm_systems', { customer_id: cust.id, monitoring_center: 'Central Station A', monitoring_account: 'A-777', communicator: 'cellular' });
  const r = (await owner.post('/api/monitoring/import-alarm-systems')).data;
  assert.ok(r.created >= 1);
  const acct = (await owner.get(`/api/r/monitoring_accounts?customer_id=${cust.id}`)).data[0];
  assert.equal(acct.account_number, 'A-777');
  assert.equal(acct.station_id_label, 'Central Station A');
  assert.equal((await owner.post('/api/monitoring/import-alarm-systems')).data.created, 0, 'running it again adds nothing');
});

test('a job can only be completed with before/after photos and parts (or "no parts used"); admins can override', async () => {
  await owner.put('/api/settings', { require_photos: '1', require_parts: '1' });
  try {
    const JPGX = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Buffer.alloc(100)]).toString('base64');
    const today = new Date().toISOString().slice(0, 10);
    const job = (await owner.post('/api/r/service_calls', { customer_id: ids.cafe, title: 'Rules job', technician_id: ids.tech, scheduled_start: `${today}T22:30`, duration_hours: 0.25, allow_conflict: true })).data;
    const tech = client();
    await tech.post('/api/auth/login', { email: 'tess-login@example.com', password: 'password123' });
    let r = await tech.put(`/api/r/service_calls/${job.id}`, { status: 'completed' });
    assert.equal(r.status, 400);
    assert.equal(r.data.code, 'completion_rules');
    assert.match(r.data.error, /“before” photo.*“after” photo.*parts used/);
    assert.equal(r.data.canOverride, false);
    assert.equal((await tech.put(`/api/r/service_calls/${job.id}`, { status: 'completed', override_reason: 'trust me' })).status, 400, 'technicians cannot override');
    await tech.post(`/api/service_calls/${job.id}/photos`, { kind: 'before', data: JPGX });
    await tech.post(`/api/service_calls/${job.id}/photos`, { kind: 'after', data: JPGX });
    r = await tech.put(`/api/r/service_calls/${job.id}`, { status: 'completed' });
    assert.match(r.data.error, /parts used/);
    r = await tech.put(`/api/r/service_calls/${job.id}`, { status: 'completed', no_parts_used: true });
    assert.equal(r.status, 200);
    assert.equal(r.data.no_parts_used, 1);
    // Admin override is recorded
    const job2 = (await owner.post('/api/r/service_calls', { customer_id: ids.cafe, title: 'Override job' })).data;
    const ov = await owner.put(`/api/r/service_calls/${job2.id}`, { status: 'completed', override_reason: 'Customer refused photos inside the vault' });
    assert.equal(ov.status, 200);
    assert.match(ov.data.completion_override, /Owner: Customer refused photos/);
    // Site surveys don't need photos or parts
    const est = (await owner.post('/api/r/service_calls', { customer_id: ids.cafe, title: 'Survey', call_type: 'estimate' })).data;
    assert.equal((await owner.put(`/api/r/service_calls/${est.id}`, { status: 'completed' })).status, 200);
  } finally {
    await owner.put('/api/settings', { require_photos: '0', require_parts: '0' });
  }
});

test('customer sign-off is required to complete a job unless an owner/admin pre-approves it (per job, or per customer)', async () => {
  await owner.put('/api/settings', { require_signature: '1' });
  const PNGX = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Buffer.alloc(40)]).toString('base64');
  try {
    const tech = client();
    await tech.post('/api/auth/login', { email: 'tess-login@example.com', password: 'password123' });
    const today = new Date().toISOString().slice(0, 10);
    const job = (await owner.post('/api/r/service_calls', { customer_id: ids.cafe, title: 'Sign-off job', technician_id: ids.tech, scheduled_start: `${today}T21:00`, duration_hours: 0.25, allow_conflict: true })).data;
    let r = await tech.put(`/api/r/service_calls/${job.id}`, { status: 'completed' });
    assert.equal(r.data.code, 'completion_rules');
    assert.match(r.data.error, /customer’s signature/);
    // A tech can't approve it for themselves
    await tech.put(`/api/r/service_calls/${job.id}`, { signature_waived: 1 });
    assert.ok(!db.prepare('SELECT signature_waived FROM service_calls WHERE id = ?').get(job.id).signature_waived, 'ignored for technicians');
    // Signing first, then completing, works
    assert.equal((await tech.post(`/api/service_calls/${job.id}/signature`, { name: 'Cafe Manager', image: PNGX })).status, 200);
    assert.equal((await tech.put(`/api/r/service_calls/${job.id}`, { status: 'completed' })).status, 200);

    // Office pre-approves a job where nobody will be on site
    const job2 = (await owner.post('/api/r/service_calls', { customer_id: ids.cafe, title: 'After-hours job', technician_id: ids.tech, scheduled_start: `${today}T21:30`, duration_hours: 0.25, allow_conflict: true })).data;
    const appr = (await owner.put(`/api/r/service_calls/${job2.id}`, { signature_waived: 1 })).data;
    assert.equal(appr.signature_waived_by, 'Owner');
    assert.equal((await tech.put(`/api/r/service_calls/${job2.id}`, { status: 'completed' })).status, 200);

    // Customer-level setting: new jobs start pre-approved
    const tech2 = client();
    await tech2.post('/api/auth/login', { email: 'tess-login@example.com', password: 'password123' });
    await tech.put(`/api/r/customers/${ids.cafe}`, { no_signature_needed: 1 });
    assert.ok(!db.prepare('SELECT no_signature_needed FROM customers WHERE id = ?').get(ids.cafe).no_signature_needed, 'techs can’t change it');
    await owner.put(`/api/r/customers/${ids.cafe}`, { no_signature_needed: 1 });
    const job3 = (await owner.post('/api/r/service_calls', { customer_id: ids.cafe, title: 'Night service' })).data;
    assert.equal(job3.signature_waived, 1);
    assert.match(job3.signature_waived_by, /Customer setting/);
    await owner.put(`/api/r/customers/${ids.cafe}`, { no_signature_needed: 0 });
    // Estimates don't need one; admins can still override at completion with a reason
    const est = (await owner.post('/api/r/service_calls', { customer_id: ids.cafe, title: 'Survey', call_type: 'estimate' })).data;
    assert.equal((await owner.put(`/api/r/service_calls/${est.id}`, { status: 'completed' })).status, 200);
    const job4 = (await owner.post('/api/r/service_calls', { customer_id: ids.cafe, title: 'Override' })).data;
    assert.equal((await owner.put(`/api/r/service_calls/${job4.id}`, { status: 'completed', override_reason: 'Signed paper ticket instead' })).status, 200);
  } finally {
    await owner.put('/api/settings', { require_signature: '0' });
  }
});

export { owner, ids, db, base };
