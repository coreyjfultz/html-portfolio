// Backups: encryption, off-site copies (S3-compatible, with Object Lock), restore tests,
// password changes, retention, alerts, disaster recovery and recovering a deleted customer.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'secureops-bk-'));
process.env.DATA_DIR = tmp;
process.env.S3_PART_BYTES = String(64 * 1024); // small parts so multipart uploads are exercised
const { openDb } = await import('../server/db.js');
const { createServer } = await import('../server/server.js');
const bk = await import('../server/backup.js');
const { signV4 } = await import('../server/s3.js');

// ---- A fake S3-compatible service that checks signatures, MD5s and Object Lock headers.
const store = new Map(); // key -> { body, lockMode, lockUntil }
const uploads = new Map();
const seen = [];
const KEY_ID = 'AKIDTEST', SECRET = 'test-secret-key';
let s3, s3url;
function s3Handler(req, res) {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, 'http://x');
    const [, bucket, ...rest] = url.pathname.split('/').map(decodeURIComponent);
    const key = rest.join('/');
    seen.push({ method: req.method, key, query: Object.fromEntries(url.searchParams), headers: req.headers });
    // Check the signature with the same date and headers.
    const auth = req.headers.authorization || '';
    const signedNames = (auth.match(/SignedHeaders=([^,]+)/) || [])[1]?.split(';') || [];
    const headers = Object.fromEntries(signedNames.filter(n => !['host', 'x-amz-date', 'x-amz-content-sha256'].includes(n)).map(n => [n, req.headers[n]]));
    const d = req.headers['x-amz-date'];
    const date = new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${d.slice(9, 11)}:${d.slice(11, 13)}:${d.slice(13, 15)}Z`);
    const expect = signV4({ method: req.method, host: req.headers.host, path: url.pathname.split('/').map(decodeURIComponent).join('/'), query: Object.fromEntries(url.searchParams), headers, payloadHash: req.headers['x-amz-content-sha256'], region: 'us-east-1', accessKeyId: KEY_ID, secretAccessKey: SECRET, date }).authorization;
    const fail = (code, status = 403) => { res.writeHead(status, { 'Content-Type': 'application/xml' }); res.end(`<?xml version="1.0"?><Error><Code>${code}</Code><Message>${code}</Message></Error>`); };
    if (auth !== expect) return fail('SignatureDoesNotMatch');
    if (bucket !== 'company-backups') return fail('NoSuchBucket', 404);
    if (req.headers['x-amz-content-sha256'] !== crypto.createHash('sha256').update(body).digest('hex')) return fail('XAmzContentSHA256Mismatch', 400);
    const md5ok = () => !req.headers['content-md5'] || req.headers['content-md5'] === crypto.createHash('md5').update(body).digest('base64');
    if (req.method === 'GET' && !key) {
      const prefix = url.searchParams.get('prefix') || '';
      const items = [...store.entries()].filter(([k]) => k.startsWith(prefix));
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      return res.end(`<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated>${items.map(([k, v]) => `<Contents><Key>${k}</Key><Size>${v.body.length}</Size><LastModified>2026-01-01T00:00:00Z</LastModified></Contents>`).join('')}</ListBucketResult>`);
    }
    if (req.method === 'GET') { const o = store.get(key); if (!o) return fail('NoSuchKey', 404); res.writeHead(200); return res.end(o.body); }
    const lock = { lockMode: req.headers['x-amz-object-lock-mode'], lockUntil: req.headers['x-amz-object-lock-retain-until-date'] };
    if (req.method === 'PUT' && url.searchParams.has('retention')) {
      if (!md5ok() || !req.headers['content-md5']) return fail('InvalidRequest', 400);
      const o = store.get(key); if (!o) return fail('NoSuchKey', 404);
      o.lockMode = (body.toString().match(/<Mode>(\w+)<\/Mode>/) || [])[1];
      o.lockUntil = (body.toString().match(/<RetainUntilDate>([^<]+)</) || [])[1];
      o.retentionSet = true;
      res.writeHead(200); return res.end();
    }
    if (req.method === 'PUT' && url.searchParams.has('partNumber')) {
      if (!md5ok()) return fail('BadDigest', 400);
      const u = uploads.get(url.searchParams.get('uploadId'));
      u.parts[Number(url.searchParams.get('partNumber'))] = body;
      res.writeHead(200, { ETag: `"${crypto.createHash('md5').update(body).digest('hex')}"` });
      return res.end();
    }
    if (req.method === 'PUT') {
      if (!md5ok()) return fail('BadDigest', 400);
      if (lock.lockMode && !req.headers['content-md5']) return fail('InvalidRequest', 400);
      store.set(key, { body, ...lock });
      res.writeHead(200);
      return res.end();
    }
    if (req.method === 'POST' && url.searchParams.has('uploads')) {
      const id = `u${uploads.size + 1}`;
      uploads.set(id, { key, parts: [], ...lock });
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      return res.end(`<?xml version="1.0"?><InitiateMultipartUploadResult><Bucket>${bucket}</Bucket><Key>${key}</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`);
    }
    if (req.method === 'POST' && url.searchParams.has('uploadId')) {
      const u = uploads.get(url.searchParams.get('uploadId'));
      const n = (body.toString().match(/<Part>/g) || []).length;
      store.set(key, { body: Buffer.concat(u.parts.slice(1, n + 1)), lockMode: u.lockMode, lockUntil: u.lockUntil, multipart: n });
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      return res.end('<?xml version="1.0"?><CompleteMultipartUploadResult><Key>k</Key></CompleteMultipartUploadResult>');
    }
    if (req.method === 'DELETE') return fail('AccessDenied');
    return fail('NotImplemented', 501);
  });
}

let server, base, db, cookie = '';
before(async () => {
  s3 = http.createServer(s3Handler);
  await new Promise(r => s3.listen(0, '127.0.0.1', r));
  s3url = `http://127.0.0.1:${s3.address().port}`;
  db = openDb(path.join(tmp, 'secureops.db'));
  server = createServer(db);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); s3.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
const call = async (method, url, body) => {
  const res = await fetch(base + url, { method, headers: { cookie, 'X-Requested-With': 'SecureOps', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const buf = Buffer.from(await res.arrayBuffer());
  let data = null; try { data = JSON.parse(buf.toString()); } catch { /* binary */ }
  return { status: res.status, data, buf };
};
const ids = {};

test('setup: some data, photos and a saved alarm code', async () => {
  await call('POST', '/api/auth/setup', { name: 'Olivia Owner', email: 'owner@example.com', password: 'password123', company_name: 'Backup Co' });
  ids.cust = (await call('POST', '/api/r/customers', { name: 'Rosie’s Diner', type: 'commercial' })).data.id;
  ids.keep = (await call('POST', '/api/r/customers', { name: 'Keeper Hardware', type: 'commercial' })).data.id;
  ids.call = (await call('POST', '/api/r/service_calls', { customer_id: ids.cust, title: 'Smoke detector chirping' })).data.id;
  ids.contact = (await call('POST', '/api/r/contacts', { customer_id: ids.cust, name: 'Rosie', phone: '555-0101' })).data?.id;
  fs.mkdirSync(path.join(tmp, 'photos'), { recursive: true });
  for (let i = 0; i < 6; i++) fs.writeFileSync(path.join(tmp, 'photos', `job-${i}.jpg`), crypto.randomBytes(40000)); // ~240 KB, forces multipart
});

test('owner-only settings; a backup password is required before off-site', async () => {
  const r = await call('PUT', '/api/settings', { offsite_enabled: '1' });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /backup password first/);
  assert.equal((await call('PUT', '/api/settings', { backup_passphrase: 'short' })).status, 400);
  assert.equal((await call('PUT', '/api/settings', { backup_local_dir: 'relative/path' })).status, 400);
  const dir = path.join(tmp, 'second-disk', 'backups');
  assert.equal((await call('PUT', '/api/settings', { backup_local_dir: dir, backup_passphrase: 'correct horse battery staple' })).status, 200);
  const s = (await call('GET', '/api/settings')).data;
  assert.equal(s.backup_passphrase, undefined);
  assert.equal(s.backup_passphrase__set, true);
  assert.equal(bk.backupDir(db), dir);
});

test('encrypted backups carry the key; the wrong password is refused', async () => {
  fs.writeFileSync(path.join(tmp, 'secret.key'), crypto.randomBytes(32));
  const r = await call('POST', '/api/admin/backups');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  ids.b1 = r.data.name;
  assert.equal(r.data.encrypted, true);
  const file = path.join(bk.backupDir(db), ids.b1);
  const raw = fs.readFileSync(file);
  assert.ok(!raw.includes(Buffer.from('Rosie')), 'customer names are not readable in the file');
  const { header } = bk.readHeader(file);
  assert.equal(header.encrypted, true);
  assert.equal(header.includes_key, true);
  await assert.rejects(bk.extractArchive(file, path.join(tmp, 'x1'), { passphrase: 'wrong wrong wrong' }), /Wrong backup password/);
  await assert.rejects(bk.extractArchive(file, path.join(tmp, 'x1b')), /encrypted/);
  const { manifest } = await bk.extractArchive(file, path.join(tmp, 'x2'), { passphrase: 'correct horse battery staple' });
  assert.equal(manifest.files.length, 6);
  assert.ok(fs.readFileSync(path.join(tmp, 'x2', 'secret.key')).equals(fs.readFileSync(path.join(tmp, 'secret.key'))));
  // Tampering is detected
  const bad = path.join(tmp, 'tampered.sobak');
  const copy = Buffer.from(raw); copy[copy.length - 100] ^= 0xff; fs.writeFileSync(bad, copy);
  await assert.rejects(bk.extractArchive(bad, path.join(tmp, 'x3'), { passphrase: 'correct horse battery staple' }), /damaged|Wrong|incorrect header|invalid/i);
  // Downloadable by the owner
  const dl = await call('GET', `/api/admin/backups/${ids.b1}/download`);
  assert.equal(dl.status, 200);
  assert.equal(dl.buf.length, raw.length);
});

test('off-site: test connection, upload with Object Lock (multipart), list, restore test', async () => {
  const set = await call('PUT', '/api/settings', { offsite_enabled: '1', offsite_provider: 'other', offsite_endpoint: s3url, offsite_bucket: 'company-backups', offsite_prefix: 'backup-co', offsite_key_id: KEY_ID, offsite_secret: SECRET, offsite_lock_days: '30', offsite_lock_mode: 'compliance' });
  assert.equal(set.status, 200, JSON.stringify(set.data));
  const t = await call('POST', '/api/admin/backups/test-offsite');
  assert.equal(t.status, 200, JSON.stringify(t.data));
  // Bad keys are reported clearly
  await call('PUT', '/api/settings', { offsite_secret: 'nope' });
  const bad = await call('POST', '/api/admin/backups/test-offsite');
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /SignatureDoesNotMatch/);
  await call('PUT', '/api/settings', { offsite_secret: SECRET });
  // A new backup goes off-site automatically
  const r = await call('POST', '/api/admin/backups');
  assert.equal(r.status, 200);
  assert.ok(!r.data.offsite?.error, JSON.stringify(r.data.offsite));
  ids.b2 = r.data.name;
  const obj = store.get(`backup-co/${ids.b2}`);
  assert.ok(obj, 'uploaded under the folder prefix');
  assert.ok(obj.multipart > 1, 'large backups go up in parts');
  assert.equal(obj.lockMode, 'COMPLIANCE');
  assert.ok(obj.retentionSet, 'the lock is also set explicitly after a multi-part upload');
  const until = new Date(obj.lockUntil);
  assert.ok(until - Date.now() > 29 * 864e5 && until - Date.now() < 31 * 864e5, 'locked for 30 days');
  assert.ok(obj.body.equals(fs.readFileSync(path.join(bk.backupDir(db), ids.b2))), 'the off-site copy is byte-for-byte the same');
  assert.ok(!seen.some(s => s.method === 'DELETE' && !s.query.uploadId), 'nothing is ever deleted off-site');
  const list = (await call('GET', '/api/admin/backups/offsite')).data;
  assert.ok(list.some(o => o.name === ids.b2));
  // Restore test from the off-site copy
  const v = await call('POST', '/api/admin/backups/verify', { offsite: true });
  assert.equal(v.status, 200, JSON.stringify(v.data));
  assert.equal(v.data.counts.customers, 2);
  assert.equal(v.data.files, 6);
  const status = (await call('GET', '/api/admin/backups')).data;
  assert.equal(status.last.offsite.status, 'ok');
  assert.equal(status.last.verify.status, 'ok');
  assert.equal(status.offsite.secret_set, true);
  assert.equal(status.offsite.key_id, KEY_ID);
});

test('changing the backup password still opens older backups', async () => {
  assert.equal((await call('PUT', '/api/settings', { backup_passphrase: 'a brand new long password' })).status, 200);
  const v = await call('POST', '/api/admin/backups/verify', { name: ids.b1 });
  assert.equal(v.status, 200, JSON.stringify(v.data));
  const r = await call('POST', '/api/admin/backups');
  const { header } = bk.readHeader(path.join(bk.backupDir(db), r.data.name));
  await bk.extractArchive(path.join(bk.backupDir(db), r.data.name), path.join(tmp, 'x4'), { passphrase: 'a brand new long password', want: n => n === 'manifest.json' });
  assert.ok(header.kc);
});

test('failures alert the owner; the nightly job does backup → off-site → monthly restore test', async () => {
  await call('PUT', '/api/settings', { offsite_bucket: 'wrong-bucket' });
  await bk.nightly(db, { now: new Date(2026, 0, 2, 2) });
  const alert = db.prepare("SELECT * FROM alerts WHERE kind = 'backup' ORDER BY id DESC").get();
  assert.match(alert.title, /Off-site backup upload failed/);
  assert.match(alert.body, /NoSuchBucket/);
  assert.equal(db.prepare("SELECT status FROM backup_runs WHERE kind = 'offsite' ORDER BY id DESC").get().status, 'failed');
  await call('PUT', '/api/settings', { offsite_bucket: 'company-backups' });
  const before = db.prepare("SELECT COUNT(*) AS n FROM backup_runs WHERE kind = 'verify'").get().n;
  await bk.nightly(db, { now: new Date(2026, 0, 1, 2) }); // the 1st = restore-test day
  assert.equal(db.prepare("SELECT status FROM backup_runs WHERE kind = 'offsite' ORDER BY id DESC").get().status, 'ok');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM backup_runs WHERE kind = 'verify'").get().n, before + 1);
  // Stale off-site backups are flagged
  db.prepare("UPDATE backup_runs SET finished_at = datetime('now','localtime','-3 days') WHERE kind = 'offsite'").run();
  db.prepare("DELETE FROM alerts WHERE kind = 'backup'").run();
  await bk.staleCheck(db);
  assert.match(db.prepare("SELECT title FROM alerts WHERE kind = 'backup' ORDER BY id DESC").get().title, /No off-site backup in the last 2 days/);
});

test('retention keeps daily, weekly and monthly backups', () => {
  const dir = bk.backupDir(db);
  for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true, recursive: true });
  const src = path.join(tmp, 'tampered.sobak');
  const start = new Date(2026, 0, 1, 2);
  for (let i = 0; i < 120; i++) { // 120 days of nightly backups
    const d = new Date(start); d.setDate(d.getDate() + i);
    const p = n => String(n).padStart(2, '0');
    fs.copyFileSync(path.join(tmp, 'x2', 'secureops.db'), path.join(dir, `x.tmp`));
    fs.renameSync(path.join(dir, 'x.tmp'), path.join(dir, `secureops-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_020000.sobak`));
    fs.copyFileSync(src, path.join(dir, `secureops-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_020000.sobak`));
  }
  bk.pruneBackups(db, { daily: 7, weekly: 4, monthly: 3 });
  const left = bk.listBackups(db).map(b => b.name.slice(10, 20));
  assert.ok(left.length >= 7 && left.length <= 14, `kept ${left.length}`);
  assert.equal(new Set(left).size, left.length);
  assert.equal(left[0], '2026-04-30');
  assert.ok(left.includes('2026-04-24'), 'last 7 days');
  assert.ok(left.some(d => d.startsWith('2026-03')), 'a monthly one');
  assert.ok(!left.includes('2026-01-15'), 'old dailies are gone');
});

test('recover a deleted customer from a backup without rolling back anything else', async () => {
  for (const f of fs.readdirSync(bk.backupDir(db))) fs.rmSync(path.join(bk.backupDir(db), f), { force: true, recursive: true });
  const b = await call('POST', '/api/admin/backups');
  // Later: Rosie's Diner is deleted (with its job), and other work happens
  db.prepare('DELETE FROM service_calls WHERE customer_id = ?').run(ids.cust);
  assert.equal((await call('DELETE', `/api/r/customers/${ids.cust}`)).status, 200);
  await call('PUT', `/api/r/customers/${ids.keep}`, { name: 'Keeper Hardware & Paint' });
  const gone = await call('GET', `/api/admin/backups/${b.data.name}/deleted-customers`);
  assert.equal(gone.status, 200, JSON.stringify(gone.data));
  assert.deepEqual(gone.data.map(c => c.name), ['Rosie’s Diner']);
  const r = await call('POST', `/api/admin/backups/${b.data.name}/recover`, { customer_id: ids.cust });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.restored.customers, 1);
  assert.equal(r.data.restored.service_calls, 1);
  assert.equal((await call('GET', `/api/r/customers/${ids.cust}`)).data.name, 'Rosie’s Diner');
  assert.equal((await call('GET', `/api/r/service_calls/${ids.call}`)).data.title, 'Smoke detector chirping');
  assert.equal((await call('GET', `/api/r/customers/${ids.keep}`)).data.name, 'Keeper Hardware & Paint', 'later work is kept');
  assert.equal((await call('POST', `/api/admin/backups/${b.data.name}/recover`, { customer_id: ids.cust })).status, 400, 'can’t recover twice');
  assert.match(db.prepare("SELECT detail FROM audit_log WHERE action = 'recover customer from backup'").get().detail, /Rosie/);
});

test('disaster recovery: a brand-new server restores from off-site with only the password', async () => {
  const off = (await call('GET', '/api/admin/backups/offsite')).data;
  assert.ok(off.length >= 2);
  // Simulate the CLI on a new machine: env settings only, empty data folder
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'secureops-new-'));
  const env = { ...process.env, DATA_DIR: fresh, OFFSITE_ENDPOINT: s3url, OFFSITE_BUCKET: 'company-backups', OFFSITE_PREFIX: 'backup-co', OFFSITE_KEY_ID: KEY_ID, OFFSITE_SECRET: SECRET, BACKUP_PASSPHRASE: 'a brand new long password' };
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { stdout: out } = await promisify(execFile)(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/backup.js', 'restore', '--offsite', 'latest'], { env, encoding: 'utf8', timeout: 60000 });
  assert.match(out, /Restored/);
  const d2 = openDb(path.join(fresh, 'secureops.db'));
  assert.ok(d2.prepare("SELECT 1 FROM customers WHERE name LIKE 'Keeper%'").get());
  d2.close();
  assert.ok(fs.readFileSync(path.join(fresh, 'secret.key')).equals(fs.readFileSync(path.join(tmp, 'secret.key'))), 'the encryption key comes back too');
  assert.equal(fs.readdirSync(path.join(fresh, 'photos')).length, 6);
  fs.rmSync(fresh, { recursive: true, force: true });
});

test('only the owner', async () => {
  await call('POST', '/api/users', { name: 'Al', email: 'al@example.com', password: 'password123', role: 'admin' });
  const owner = cookie; cookie = '';
  await call('POST', '/api/auth/login', { email: 'al@example.com', password: 'password123' });
  assert.equal((await call('GET', '/api/admin/backups')).status, 403);
  assert.equal((await call('PUT', '/api/settings', { offsite_enabled: '0' })).status, 403);
  assert.equal((await call('PUT', '/api/settings', { backup_hour: '3' })).status, 403);
  cookie = owner;
});
