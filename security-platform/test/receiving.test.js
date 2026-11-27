// Supplier-invoice intake: CSV, email webhook, matching, auto-receive rules, and the Claude call.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'secureops-recv-'));
process.env.DATA_DIR = tmp;
delete process.env.ANTHROPIC_API_KEY;
const { openDb } = await import('../server/db.js');
const { createServer } = await import('../server/server.js');
const { setExtractor } = await import('../server/receiving.js');
const { processingIdle } = await import('../server/routes.js');

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
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  return { call, get: u => call('GET', u), post: (u, b = {}) => call('POST', u, b), put: (u, b = {}) => call('PUT', u, b) };
}
const admin = client();
const b64 = s => Buffer.from(s).toString('base64');
const stock = (itemId, loc = 0) => db.prepare('SELECT qty FROM stock WHERE item_id = ? AND location_id = ?').get(itemId, loc)?.qty ?? 0;
const inv = id => db.prepare('SELECT * FROM purchase_invoices WHERE id = ?').get(id);
const ids = {};
let token;

test('setup: admin, items', async () => {
  await admin.post('/api/auth/setup', { name: 'Owner', email: 'o@example.com', password: 'password123' });
  ids.cam = (await admin.post('/api/r/inventory_items', { sku: 'IPC-4K-T', name: '4K turret camera', unit_cost: 80 })).data.id;
  ids.smoke = (await admin.post('/api/r/inventory_items', { sku: 'FA-SMK', name: 'Smoke detector', unit_cost: 30 })).data.id;
  ids.cable = (await admin.post('/api/r/inventory_items', { sku: 'CAT6-1K', name: 'Cat6 cable 1000ft', unit_cost: 100 })).data.id;
  token = db.prepare("SELECT value FROM settings WHERE key = 'inbound_token'").get().value;
  assert.ok(token.length >= 30, 'an inbound token is generated on first run');
});

test('CSV upload with all parts matched is received automatically', async () => {
  const csv = 'Invoice,INV-77\nItem Number,Description,Qty Ordered,Qty Shipped,Unit Price,Ext\nIPC-4K-T,4K Turret,12,10,"$85.50",855\nfa-smk,Photo smoke,6,6,32.00,192\n';
  const r = await admin.post('/api/receiving/upload', { files: [{ name: 'adi.csv', type: 'text/csv', data: b64(csv) }] });
  assert.equal(r.status, 200);
  await processingIdle();
  const row = inv(r.data.ids[0]);
  assert.equal(row.status, 'received', row.review_note);
  assert.equal(stock(ids.cam), 10, 'uses Qty Shipped, not Qty Ordered');
  assert.equal(stock(ids.smoke), 6, 'part # matching ignores case and punctuation');
  assert.equal(db.prepare('SELECT unit_cost FROM inventory_items WHERE id = ?').get(ids.cam).unit_cost, 85.5, 'cost updated');
  const exp = db.prepare('SELECT * FROM expenses WHERE id = ?').get(row.expense_id);
  assert.equal(exp.amount, 1047);
  assert.equal(exp.category, 'Parts & equipment');
});

test('unmatched line waits for review; matching it teaches the distributor part #', async () => {
  const csv = 'Part #,Description,Qty,Unit Cost\nADI-CBL6-1000,Cat 6 CMR 1000ft box,2,110\nIPC-4K-T,4K Turret,1,85.5\n';
  const r = await admin.post('/api/receiving/upload', { files: [{ name: 'po2.csv', type: 'text/csv', data: b64(csv) }] });
  await processingIdle();
  const id = r.data.ids[0];
  assert.equal(inv(id).status, 'needs review');
  assert.match(inv(id).review_note, /1 line/);
  assert.equal(stock(ids.cam), 10, 'nothing received yet');
  const lines = (await admin.get(`/api/r/purchase_invoice_lines?purchase_invoice_id=${id}`)).data;
  const cableLine = lines.find(l => l.line_sku === 'ADI-CBL6-1000');
  assert.equal(cableLine.item_id, null);
  // Receiving with an unmatched line is refused
  assert.equal((await admin.post(`/api/receiving/${id}/receive`)).status, 400);
  await admin.put(`/api/receiving/${id}`, { vendor: 'ADI', invoice_number: 'A-100', location_id: 0, lines: lines.map(l => ({ ...l, item_id: l.id === cableLine.id ? ids.cable : l.item_id })) });
  const rec = await admin.post(`/api/receiving/${id}/receive`);
  assert.equal(rec.status, 200, JSON.stringify(rec.data));
  assert.equal(stock(ids.cable), 2);
  assert.equal(stock(ids.cam), 11);
  assert.match(db.prepare('SELECT vendor_skus FROM inventory_items WHERE id = ?').get(ids.cable).vendor_skus, /ADI-CBL6-1000/);
  // Next time the same distributor part # matches on its own and is auto-received
  const r2 = await admin.post('/api/receiving/upload', { files: [{ name: 'po3.csv', type: 'text/csv', data: b64('Part #,Description,Qty,Unit Cost\nADI-CBL6-1000,Cat 6,3,110\n') }] });
  await processingIdle();
  assert.equal(inv(r2.data.ids[0]).status, 'received');
  assert.equal(stock(ids.cable), 5);
  // Received invoices can't be received twice or edited
  assert.equal((await admin.post(`/api/receiving/${id}/receive`)).status, 409);
  assert.equal((await admin.put(`/api/receiving/${id}`, { vendor: 'X' })).status, 409);
});

test('email webhook: secret URL, no login, untrusted senders wait for review', async () => {
  setExtractor(async ({ kind, items }) => {
    assert.equal(kind, 'pdf');
    assert.ok(items.some(i => i.sku === 'FA-SMK'), 'catalog is passed to the reader');
    return { is_invoice: true, vendor: 'Anixter', invoice_number: 'AX-5001', invoice_date: '2030-02-03', subtotal: 120, tax: 7.2, shipping: 10, total: 137.2,
      lines: [{ sku: 'FA-SMK', description: 'Smoke det', qty: 4, unit_cost: 30, suggested_item_id: null }] };
  });
  const email = { From: 'Anixter Billing <billing@anixter.com>', Subject: 'Invoice AX-5001', TextBody: 'Attached.',
    Attachments: [{ Name: 'AX-5001.pdf', ContentType: 'application/pdf', Content: b64('%PDF-1.4 fake') }] };
  assert.equal((await fetch(`${base}/api/inbound/email/wrong-token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(email) })).status, 404);
  const res = await fetch(`${base}/api/inbound/email/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(email) });
  assert.equal(res.status, 200, 'works without a session or CSRF header');
  await processingIdle();
  const first = db.prepare("SELECT * FROM purchase_invoices WHERE invoice_number = 'AX-5001'").get();
  assert.equal(first.status, 'needs review');
  assert.match(first.review_note, /trusted distributor/);
  assert.equal(first.from_email, 'billing@anixter.com');
  assert.equal(stock(ids.smoke), 6);

  // Trust the domain: the next invoice from them goes straight into stock
  await admin.put('/api/settings', { trusted_vendor_domains: 'adiglobal.com, anixter.com' });
  setExtractor(async () => ({ is_invoice: true, vendor: 'Anixter', invoice_number: 'AX-5002', invoice_date: '2030-02-04', subtotal: 60, tax: null, shipping: null, total: 60,
    lines: [{ sku: 'FA-SMK', description: 'Smoke det', qty: 2, unit_cost: 30, suggested_item_id: null }] }));
  await fetch(`${base}/api/inbound/email/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...email, Subject: 'Invoice AX-5002' }) });
  await processingIdle();
  assert.equal(db.prepare("SELECT status FROM purchase_invoices WHERE invoice_number = 'AX-5002'").get().status, 'received');
  assert.equal(stock(ids.smoke), 8);

  // The same invoice arriving again is flagged as a duplicate, not double-counted
  await fetch(`${base}/api/inbound/email/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(email) });
  await processingIdle();
  const dup = db.prepare("SELECT * FROM purchase_invoices WHERE invoice_number = 'AX-5002' AND status <> 'received'").get();
  assert.equal(dup.status, 'needs review');
  assert.match(dup.review_note, /duplicate/i);
  assert.equal((await admin.post(`/api/receiving/${dup.id}/receive`)).status, 409);
  assert.equal(stock(ids.smoke), 8);
});

test('AI suggestions and subtotal mismatches are never auto-received', async () => {
  setExtractor(async () => ({ is_invoice: true, vendor: 'ADI', invoice_number: 'Z-1', invoice_date: '', subtotal: 500, tax: null, shipping: null, total: 500,
    lines: [{ sku: 'XYZ-999', description: 'Turret cam', qty: 1, unit_cost: 85, suggested_item_id: ids.cam }] }));
  const r = await admin.post('/api/receiving/upload', { files: [{ name: 'photo.jpg', type: 'image/jpeg', data: b64('x'.repeat(20000)) }] });
  await processingIdle();
  const row = inv(r.data.ids[0]);
  assert.equal(row.status, 'needs review');
  const line = db.prepare('SELECT * FROM purchase_invoice_lines WHERE purchase_invoice_id = ?').get(row.id);
  assert.equal(line.item_id, ids.cam);
  assert.equal(line.match, 'AI suggestion');
  setExtractor(null);
});

test('without an API key, PDFs wait for manual entry', async () => {
  const r = await admin.post('/api/receiving/upload', { files: [{ name: 'scan.pdf', type: 'application/pdf', data: b64('%PDF-1.4') }] });
  await processingIdle();
  const row = inv(r.data.ids[0]);
  assert.equal(row.status, 'needs review');
  assert.match(row.review_note, /not set up/);
  const file = await fetch(`${base}/api/receiving/${row.id}/file`);
  assert.equal(file.status, 401, 'files need a login');
});

test('technicians cannot see receiving or the inbound token', async () => {
  const tech = client();
  await admin.post('/api/users', { name: 'T', email: 't@example.com', password: 'password123', role: 'technician' });
  await tech.post('/api/auth/login', { email: 't@example.com', password: 'password123' });
  assert.equal((await tech.get('/api/r/purchase_invoices')).status, 403);
  assert.equal((await tech.get('/api/receiving/info')).status, 403);
  assert.equal((await tech.post('/api/receiving/upload', { files: [] })).status, 403);
  assert.equal((await tech.get('/api/settings')).data.inbound_token, undefined);
  assert.ok((await admin.get('/api/settings')).data.inbound_token);
  // and it can't be overwritten through the settings form
  await admin.put('/api/settings', { inbound_token: 'hacked' });
  assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'inbound_token'").get().value, token);
});

test('the Claude request is well-formed and its answer is parsed (local stand-in API)', async () => {
  let seen;
  const fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      seen = { url: req.url, headers: req.headers, body: JSON.parse(body) };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
        content: [{ type: 'text', text: JSON.stringify({ is_invoice: true, vendor: 'ADI', invoice_number: 'R-9', invoice_date: '2030-03-01', subtotal: 85, tax: null, shipping: null, total: 85,
          lines: [{ sku: 'IPC-4K-T', description: '4K turret', qty: 1, unit_cost: 85, suggested_item_id: null }] }) }],
      }));
    });
  });
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  process.env.ANTHROPIC_API_KEY = 'test-key';
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${fake.address().port}`;
  try {
    const before = stock(ids.cam);
    const r = await admin.post('/api/receiving/upload', { files: [{ name: 'adi.pdf', type: 'application/pdf', data: b64('%PDF-1.4 real-ish') }] });
    await processingIdle();
    const row = inv(r.data.ids[0]);
    assert.equal(row.status, 'received', row.review_note);
    assert.equal(stock(ids.cam), before + 1);
    assert.equal(seen.url.split('?')[0], '/v1/messages');
    assert.equal(seen.body.model, 'claude-opus-5-5');
    assert.equal(seen.body.fallbacks, 'default');
    assert.match(String(seen.headers['anthropic-beta']), /server-side-fallback-2026-07-01/);
    assert.equal(seen.body.output_config.format.type, 'json_schema');
    assert.equal(seen.body.messages[0].content[0].type, 'document');
    assert.equal(seen.body.messages[0].content[0].source.media_type, 'application/pdf');
    assert.match(seen.body.messages[0].content[1].text, /IPC-4K-T/);
  } finally {
    fake.close();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_BASE_URL;
  }
});
