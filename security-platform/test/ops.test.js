// Running in production: health check, reverse-proxy headers, backups and restore.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'secureops-ops-'));
process.env.DATA_DIR = tmp;
const { openDb } = await import('../server/db.js');
const { createServer } = await import('../server/server.js');
const { runBackup, listBackups, restore, BACKUP_DIR } = await import('../server/backup.js');

let server, base, db, cookie = '';
before(async () => {
  db = openDb(path.join(tmp, 'secureops.db'));
  server = createServer(db);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const call = async (method, url, body, headers = {}) => {
  const res = await fetch(base + url, { method, headers: { cookie, 'X-Requested-With': 'SecureOps', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  return { status: res.status, data: await res.json().catch(() => null), res };
};

test('health check needs no login and reveals nothing', async () => {
  const r = await call('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { ok: true });
});

test('forwarded headers are ignored unless TRUST_PROXY=1 (no faking an IP past the login limit)', async () => {
  await call('POST', '/api/auth/setup', { name: 'Owner', email: 'o@example.com', password: 'password123', company_name: 'Ops Co' });
  cookie = '';
  // Spoofing a new X-Forwarded-For on every attempt must not reset the limit.
  let blocked = false;
  for (let i = 0; i < 12 && !blocked; i++) {
    const r = await call('POST', '/api/auth/login', { email: 'o@example.com', password: 'wrong-password' }, { 'X-Forwarded-For': `203.0.113.${i}` });
    if (r.status === 429) blocked = true;
  }
  assert.equal(blocked, true, 'rate limit applies to the real connection');
  // Behind a trusted proxy, the forwarded address is used and the cookie is marked Secure on https.
  process.env.TRUST_PROXY = '1';
  try {
    const r = await call('POST', '/api/auth/login', { email: 'o@example.com', password: 'password123' }, { 'X-Forwarded-For': '198.51.100.7', 'X-Forwarded-Proto': 'https' });
    assert.equal(r.status, 200);
    assert.match(r.res.headers.get('set-cookie'), /; Secure/);
  } finally { delete process.env.TRUST_PROXY; }
  const plain = await call('POST', '/api/auth/login', { email: 'o@example.com', password: 'password123' }, { 'X-Forwarded-For': '198.51.100.8' });
  assert.equal(plain.status, 429, 'without TRUST_PROXY the forwarded address is ignored again');
  const { isHttps, requestOrigin } = await import('../server/net.js');
  const fake = { headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'evil.example', host: 'app.example' }, socket: {} };
  assert.equal(isHttps(fake), false, 'a client cannot claim https without a trusted proxy');
  assert.equal(requestOrigin(fake), 'http://app.example', 'nor change the site address used in emailed links');
});

test('backups: database + files, kept N days, never the encryption key unless asked; restore keeps the old data aside', async () => {
  // Some data and an uploaded file
  await call('POST', '/api/r/customers', { name: 'Backup Bakery', type: 'commercial' });
  fs.mkdirSync(path.join(tmp, 'photos'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'photos', 'p1.jpg'), 'jpeg-bytes');

  const viaApi = await call('POST', '/api/admin/backups');
  assert.equal(viaApi.status, 200);
  const dir = path.join(BACKUP_DIR, viaApi.data.name);
  assert.ok(fs.existsSync(path.join(dir, 'secureops.db')));
  assert.equal(fs.readFileSync(path.join(dir, 'photos', 'p1.jpg'), 'utf8'), 'jpeg-bytes');
  assert.equal(fs.existsSync(path.join(dir, 'secret.key')), false, 'the encryption key is kept out of backups by default');
  const list = (await call('GET', '/api/admin/backups')).data;
  assert.equal(list.backups[0].name, viaApi.data.name);

  // Retention
  process.env.BACKUP_KEEP = '2';
  try {
    for (let i = 0; i < 3; i++) { await new Promise(r => setTimeout(r, 1100)); runBackup(db); }
    assert.equal(listBackups().length, 2);
  } finally { delete process.env.BACKUP_KEEP; }

  // Restore (normally with the app stopped): data changes after the backup are rolled back
  const name = listBackups()[0].name;
  db.prepare("UPDATE customers SET name = 'Changed later' WHERE name = 'Backup Bakery'").run();
  db.close();
  const r = restore(name);
  assert.ok(fs.existsSync(path.join(r.previous_data, 'secureops.db')), 'the replaced data is kept aside');
  db = openDb(path.join(tmp, 'secureops.db'));
  assert.ok(db.prepare("SELECT 1 FROM customers WHERE name = 'Backup Bakery'").get());
  server.close();
  server = createServer(db);
  await new Promise(res => server.listen(0, '127.0.0.1', res));
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await call('GET', '/api/health')).status, 200);
});

test('only the owner can make or list backups', async () => {
  const r = await call('POST', '/api/users', { name: 'Ann', email: 'ann@example.com', password: 'password123', role: 'admin' });
  assert.equal(r.status, 200);
  const owner = cookie;
  cookie = '';
  await call('POST', '/api/auth/login', { email: 'ann@example.com', password: 'password123' });
  assert.equal((await call('POST', '/api/admin/backups')).status, 403);
  assert.equal((await call('GET', '/api/admin/backups')).status, 403);
  cookie = owner;
});
