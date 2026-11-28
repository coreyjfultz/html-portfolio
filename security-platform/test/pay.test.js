// Optional Pay & benefits add-on.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'secureops-pay-'));
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
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { cookie, 'X-Requested-With': 'SecureOps', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null), res };
  };
  return { cookie: () => cookie, get: u => call('GET', u), post: (u, b = {}) => call('POST', u, b), put: (u, b = {}) => call('PUT', u, b), del: u => call('DELETE', u) };
}
const owner = client(), acct = client(), admin = client(), tess = client(), bo = client();
const ids = {};
const PDF = Buffer.from('%PDF-1.4\n% pay stub\n').toString('base64');

test('setup', async () => {
  await owner.post('/api/auth/setup', { name: 'Olivia Owner', email: 'owner@example.com', password: 'password123', company_name: 'Pay Co' });
  for (const [c, name, email, role] of [[acct, 'Ann Accounting', 'ann@example.com', 'accounting'], [admin, 'Al Admin', 'al@example.com', 'admin'], [tess, 'Tess Tech', 'tess@example.com', 'technician'], [bo, 'Bo Tech', 'bo@example.com', 'technician']]) {
    ids[name] = (await owner.post('/api/users', { name, email, password: 'password123', role })).data.id;
    await c.post('/api/auth/login', { email, password: 'password123' });
  }
});

test('off by default: nothing is reachable until the owner turns it on', async () => {
  assert.deepEqual((await tess.get('/api/pay/config')).data, { enabled: false });
  assert.equal((await tess.get('/api/pay/documents')).status, 404);
  assert.equal((await acct.post('/api/pay/documents', { user_id: ids['Tess Tech'], data: PDF })).status, 404);
  await owner.put('/api/settings', { addon_pay: '1', payroll_provider: 'quickbooks', payroll_contact: 'Ann in accounting, x204' });
  const c = (await tess.get('/api/pay/config')).data;
  assert.equal(c.enabled, true);
  assert.equal(c.provider_label, 'QuickBooks Workforce');
  assert.equal(c.portal_url, 'https://workforce.intuit.com');
  assert.equal(c.can_manage, false);
  await owner.put('/api/settings', { payroll_provider: 'gusto' });
  assert.equal((await tess.get('/api/pay/config')).data.provider_label, 'Gusto');
});

test('private documents: posted by owner/accounting, seen only by that person (not other techs or admins)', async () => {
  assert.equal((await admin.post('/api/pay/documents', { user_id: ids['Tess Tech'], kind: 'pay stub', data: PDF })).status, 403, 'admins don’t handle pay documents');
  assert.equal((await acct.post('/api/pay/documents', { user_id: ids['Tess Tech'], kind: 'pay stub', data: Buffer.from('<html>').toString('base64') })).status, 400, 'PDF or image only');
  const d = (await acct.post('/api/pay/documents', { user_id: ids['Tess Tech'], kind: 'pay stub', title: 'Pay stub Nov 15', period: '2026-11-15', data: PDF, file_name: 'stub.pdf' })).data;
  const mine = (await tess.get('/api/pay/documents')).data;
  assert.equal(mine.length, 1);
  assert.equal(mine[0].title, 'Pay stub Nov 15');
  assert.equal((await bo.get('/api/pay/documents')).data.length, 0);
  const file = await fetch(`${base}/api/pay/documents/${d.id}/file`, { headers: { cookie: tess.cookie() } });
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('content-type'), 'application/pdf');
  assert.match(await file.text(), /^%PDF/);
  assert.ok(db.prepare('SELECT viewed_at FROM employee_documents WHERE id = ?').get(d.id).viewed_at, 'opened by the employee');
  assert.equal((await fetch(`${base}/api/pay/documents/${d.id}/file`, { headers: { cookie: bo.cookie() } })).status, 404);
  assert.equal((await fetch(`${base}/api/pay/documents/${d.id}/file`, { headers: { cookie: admin.cookie() } })).status, 404);
  assert.equal((await owner.get(`/api/pay/documents?user_id=${ids['Tess Tech']}`)).data.length, 1);
  assert.ok(fs.existsSync(path.join(tmp, 'hrdocs')));
  assert.equal((await acct.del(`/api/pay/documents/${d.id}`)).status, 200);
  assert.equal((await tess.get('/api/pay/documents')).data.length, 0);
});

test('benefit plans: everyone reads, owner/accounting edit', async () => {
  assert.equal((await tess.post('/api/r/benefit_plans', { name: 'X' })).status, 403);
  assert.equal((await acct.post('/api/r/benefit_plans', { name: 'Blue Cross PPO', kind: 'health', provider: 'Blue Cross', summary: 'Company pays 80% of employee premium', member_phone: '800-555-0100' })).status, 200);
  assert.equal((await tess.get('/api/r/benefit_plans')).data[0].name, 'Blue Cross PPO');
});
