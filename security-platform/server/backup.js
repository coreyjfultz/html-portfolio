// Backups.
//
// Each backup is ONE file (secureops-<date>_<time>.sobak): a consistent copy of the database
// (taken while the app runs) plus uploaded files (photos, signatures, supplier invoices, HR
// documents, manuals, logo). With a backup password set (Settings → Backup & data) the file is
// encrypted (AES-256-GCM, key from the password via scrypt) and also carries the app's
// encryption key, so the password alone restores everything. Without one, the file is only
// compressed and the key is left out.
//
//   Local:    kept in a folder on this server (Settings, or BACKUP_DIR), daily/weekly/monthly.
//   Off-site: each backup is also uploaded to S3-compatible storage (Backblaze B2, Amazon S3,
//             Cloudflare R2, Wasabi…) with Object Lock, so nobody can delete it for N days.
//   Checks:   failures and stale backups alert the owner; once a month the newest backup is
//             restored into a scratch folder and checked.
//
// CLI:  npm run backup                       make one now
//       npm run restore -- <name|file|folder> put one back (app stopped)
//       npm run restore -- --offsite latest   new server: fetch from off-site storage and restore
//         (BACKUP_PASSPHRASE, and OFFSITE_ENDPOINT/OFFSITE_BUCKET/OFFSITE_KEY_ID/OFFSITE_SECRET
//          [/OFFSITE_PREFIX/OFFSITE_REGION] when there's no database yet)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR, DB_PATH, openDb, getSettings } from './db.js';
import { decrypt } from './security.js';
import { s3Client } from './s3.js';

export const DEFAULT_BACKUP_DIR = path.join(DATA_DIR, 'backups');
export const FILE_DIRS = ['photos', 'signatures', 'branding', 'invoices', 'hrdocs', 'library'];
const MAGIC = 'SOBAK1';
const NAME_RE = /^secureops-(\d{4}-\d{2}-\d{2})_(\d{6})(?:-\d+)?\.sobak$/;
const KDF = { N: 32768, r: 8, p: 1 };

const stamp = (d = new Date()) => {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
const dirSize = dir => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).reduce((s, e) => s + (e.isDirectory() ? dirSize(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0) : 0;
const walk = (dir, rel = '') => !fs.existsSync(dir) ? [] : fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name), `${rel}${e.name}/`) : e.isFile() ? [`${rel}${e.name}`] : []);
const safeDecrypt = v => { try { return v ? decrypt(v) : ''; } catch { return ''; } };

// ---------------------------------------------------------------- settings
/** Where local backups go: BACKUP_DIR (env) wins, then Settings, then <data>/backups. */
export function backupDir(db) {
  if (process.env.BACKUP_DIR) return process.env.BACKUP_DIR;
  const s = db ? getSettings(db) : {};
  return s.backup_local_dir?.trim() || DEFAULT_BACKUP_DIR;
}
export function backupConfig(db) {
  const s = db ? getSettings(db) : {};
  const n = (env, key, def) => Math.max(0, Number(process.env[env] ?? s[key] ?? def) || 0);
  return {
    dir: backupDir(db),
    hour: Math.min(23, n('BACKUP_HOUR', 'backup_hour', 2)),
    daily: Math.max(1, n('BACKUP_KEEP', 'backup_keep_daily', 14)),
    weekly: n('BACKUP_KEEP_WEEKLY', 'backup_keep_weekly', 8),
    monthly: n('BACKUP_KEEP_MONTHLY', 'backup_keep_monthly', 12),
    verifyDay: Math.min(28, Math.max(1, Number(s.backup_verify_day) || 1)),
    passphrase: process.env.BACKUP_PASSPHRASE || safeDecrypt(s.backup_passphrase),
    // Earlier passwords, so backups made before a password change can still be opened.
    passphrases: [process.env.BACKUP_PASSPHRASE, safeDecrypt(s.backup_passphrase), ...(() => { try { return JSON.parse(safeDecrypt(s.backup_passphrase_history) || '[]'); } catch { return []; } })()].filter(Boolean),
    disabled: process.env.BACKUP_DISABLED === '1',
  };
}
export function offsiteConfig(db) {
  const s = db ? getSettings(db) : {};
  const env = k => process.env[`OFFSITE_${k}`];
  const cfg = {
    enabled: env('ENDPOINT') ? true : s.offsite_enabled === '1',
    provider: s.offsite_provider || 'other',
    endpoint: env('ENDPOINT') || s.offsite_endpoint || '',
    region: env('REGION') || s.offsite_region || '',
    bucket: env('BUCKET') || s.offsite_bucket || '',
    prefix: (env('PREFIX') ?? s.offsite_prefix ?? 'secureops').replace(/^\/+|\/+$/g, ''),
    accessKeyId: env('KEY_ID') || s.offsite_key_id || '',
    secretAccessKey: env('SECRET') || safeDecrypt(s.offsite_secret),
    lockDays: Math.max(0, Number(env('LOCK_DAYS') ?? s.offsite_lock_days ?? 30) || 0),
    lockMode: s.offsite_lock_mode === 'governance' ? 'governance' : 'compliance',
  };
  cfg.ready = !!(cfg.endpoint && cfg.bucket && cfg.accessKeyId && cfg.secretAccessKey);
  return cfg;
}
const remoteKey = (cfg, name) => (cfg.prefix ? `${cfg.prefix}/${name}` : name);
const client = cfg => s3Client({ endpoint: cfg.endpoint, region: cfg.region, bucket: cfg.bucket, accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey });

// ---------------------------------------------------------------- the .sobak format
// "SOBAK1\n" + header JSON + "\n" + body. Body = gzip(entries), encrypted with AES-256-GCM when
// a password is used (header is the GCM associated data; the 16-byte tag is at the very end).
// Entries: one JSON line {"n": name, "s": size} then `size` bytes; ends with {"end": true}.
function keyFrom(passphrase, salt) {
  return crypto.scryptSync(String(passphrase).normalize('NFKC'), salt, 32, { ...KDF, maxmem: 128 * 1024 * 1024 });
}
// A short fingerprint of the key, so the right password can be picked without decrypting.
const keyCheck = key => crypto.createHmac('sha256', key).update('sobak-key-check').digest('base64').slice(0, 12);

async function writeArchive(dest, entries, { passphrase, meta }) {
  const header = { ...meta, v: 1, encrypted: !!passphrase };
  let cipher = null;
  if (passphrase) {
    const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
    const key = keyFrom(passphrase, salt);
    Object.assign(header, { kdf: 'scrypt', ...KDF, salt: salt.toString('base64'), iv: iv.toString('base64'), kc: keyCheck(key) });
    cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  }
  const headLine = Buffer.from(`${MAGIC}\n${JSON.stringify(header)}\n`);
  cipher?.setAAD(headLine);
  async function* gen() {
    for (const e of entries) {
      const size = e.buffer ? e.buffer.length : fs.statSync(e.file).size;
      yield Buffer.from(`${JSON.stringify({ n: e.name, s: size })}\n`);
      if (e.buffer) yield e.buffer;
      else for await (const chunk of fs.createReadStream(e.file)) yield chunk;
    }
    yield Buffer.from('{"end":true}\n');
  }
  const tmp = `${dest}.partial`;
  fs.writeFileSync(tmp, headLine, { mode: 0o600 });
  const out = fs.createWriteStream(tmp, { flags: 'a' });
  await pipeline(Readable.from(gen()), zlib.createGzip({ level: 6 }), ...(cipher ? [cipher] : []), out);
  if (cipher) fs.appendFileSync(tmp, cipher.getAuthTag());
  fs.renameSync(tmp, dest);
}

/** Reads the plain-text header of a backup file (when it was made, encrypted or not…). */
export function readHeader(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(8192);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const text = buf.subarray(0, n).toString('utf8');
    const first = text.indexOf('\n'), second = text.indexOf('\n', first + 1);
    if (text.slice(0, first) !== MAGIC || second < 0) throw new Error('Not a SecureOps backup file');
    return { header: JSON.parse(text.slice(first + 1, second)), headLen: Buffer.byteLength(text.slice(0, second + 1)) };
  } finally { fs.closeSync(fd); }
}

/** Unpacks a backup file into `destDir`. `want(name)` can skip entries. Returns the manifest. */
export async function extractArchive(file, destDir, { passphrase, want = () => true } = {}) {
  const { header, headLen } = readHeader(file);
  const size = fs.statSync(file).size;
  let src;
  const streams = [];
  if (header.encrypted) {
    const candidates = (Array.isArray(passphrase) ? passphrase : [passphrase]).filter(Boolean);
    if (!candidates.length) throw new Error('This backup is encrypted. Enter the backup password (BACKUP_PASSPHRASE).');
    const salt = Buffer.from(header.salt, 'base64');
    let key = null;
    for (const p of candidates) { const k = keyFrom(p, salt); if (!header.kc || keyCheck(k) === header.kc) { key = k; break; } }
    if (!key) throw new Error('Wrong backup password for this backup (it may have been made before the password was changed)');
    const fd = fs.openSync(file, 'r');
    const tag = Buffer.alloc(16);
    fs.readSync(fd, tag, 0, 16, size - 16);
    const headBuf = Buffer.alloc(headLen);
    fs.readSync(fd, headBuf, 0, headLen, 0);
    fs.closeSync(fd);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(header.iv, 'base64'));
    decipher.setAAD(headBuf);
    decipher.setAuthTag(tag);
    src = fs.createReadStream(file, { start: headLen, end: size - 17 });
    streams.push(decipher);
  } else src = fs.createReadStream(file, { start: headLen });
  streams.push(zlib.createGunzip());
  fs.mkdirSync(destDir, { recursive: true });
  const rootDir = path.resolve(destDir);
  let manifest = null, ended = false;
  let buf = Buffer.alloc(0), cur = null, fd = null;
  const sink = async function (source) {
    for await (const chunk of source) {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      for (;;) {
        if (!cur) {
          const nl = buf.indexOf(10);
          if (nl < 0) break;
          const head = JSON.parse(buf.subarray(0, nl).toString('utf8'));
          buf = buf.subarray(nl + 1);
          if (head.end) { ended = true; break; }
          const name = String(head.n);
          const target = path.resolve(rootDir, name);
          if (!target.startsWith(rootDir + path.sep) || name.includes('\0')) throw new Error('Backup file contains an unsafe path');
          cur = { name, left: Number(head.s), keep: want(name), target, parts: name === 'manifest.json' ? [] : null };
          if (cur.keep && !cur.parts) { fs.mkdirSync(path.dirname(target), { recursive: true }); fd = fs.openSync(target, 'w', 0o600); }
        }
        if (cur) {
          const take = Math.min(cur.left, buf.length);
          const piece = buf.subarray(0, take);
          if (cur.parts) cur.parts.push(Buffer.from(piece));
          else if (fd !== null) fs.writeSync(fd, piece);
          cur.left -= take;
          buf = buf.subarray(take);
          if (cur.left === 0) {
            if (fd !== null) { fs.closeSync(fd); fd = null; }
            if (cur.parts) manifest = JSON.parse(Buffer.concat(cur.parts).toString('utf8'));
            cur = null;
            continue;
          }
          break;
        }
      }
    }
  };
  try {
    await pipeline(src, ...streams, sink);
  } catch (e) {
    if (fd !== null) fs.closeSync(fd);
    if (/unable to authenticate|Unsupported state/i.test(e.message)) throw new Error('Wrong backup password, or the backup file is damaged');
    throw e;
  }
  if (!ended) throw new Error('The backup file is incomplete');
  return { header, manifest };
}

// ---------------------------------------------------------------- making backups
export function listBackups(db) {
  const dir = backupDir(db);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isFile() && NAME_RE.test(e.name)) {
      try {
        const { header } = readHeader(path.join(dir, e.name));
        out.push({ name: e.name, format: 'file', created: header.created, reason: header.reason, encrypted: !!header.encrypted, includes_key: !!header.includes_key, size: fs.statSync(path.join(dir, e.name)).size });
      } catch { /* not ours / damaged */ }
    } else if (e.isDirectory() && !e.name.startsWith('.') && fs.existsSync(path.join(dir, e.name, 'secureops.db'))) {
      // Older backups were folders.
      let m = {};
      try { m = JSON.parse(fs.readFileSync(path.join(dir, e.name, 'manifest.json'), 'utf8')); } catch { /* older */ }
      out.push({ name: e.name, format: 'folder', created: m.created || null, reason: m.reason || null, encrypted: false, includes_key: !!m.includes_key, size: dirSize(path.join(dir, e.name)) });
    }
  }
  const when = b => { const m = b.name.match(/(\d{4}-\d{2}-\d{2})_(\d{6})(?:-(\d+))?/); return m ? `${m[1]}_${m[2]}_${String(m[3] || 1).padStart(4, '0')}` : ''; };
  return out.sort((a, b) => when(b).localeCompare(when(a)));
}

/** Keep every backup from the last N days that have backups, plus the newest of each of the
 *  last N weeks and N months. */
export function pruneBackups(db, cfg = backupConfig(db)) {
  const all = listBackups(db);
  const keep = new Set();
  const day = b => (b.name.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || '';
  const week = b => { const d = new Date(`${day(b)}T12:00:00Z`); const t = new Date(d); t.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7)); const w1 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4)); return `${t.getUTCFullYear()}-${Math.round(((t - w1) / 864e5 - 3 + ((w1.getUTCDay() + 6) % 7)) / 7) + 1}`; };
  const days = [...new Set(all.map(day).filter(Boolean))].slice(0, cfg.daily);
  for (const b of all) if (days.includes(day(b))) keep.add(b.name);
  for (const [fn, n] of [[week, cfg.weekly], [b => day(b).slice(0, 7), cfg.monthly]]) {
    const seen = new Set();
    for (const b of all) { const k = fn(b); if (!k || seen.has(k)) continue; seen.add(k); if (seen.size <= n) keep.add(b.name); }
  }
  const removed = [];
  for (const b of all) if (!keep.has(b.name)) { fs.rmSync(path.join(backupDir(db), b.name), { recursive: true, force: true }); removed.push(b.name); }
  return removed;
}

function record(db, kind, status, { name = null, size = null, detail = null, started } = {}) {
  try {
    db.prepare("INSERT INTO backup_runs (kind, status, name, size, detail, started_at, finished_at) VALUES (?,?,?,?,?,?,datetime('now','localtime'))")
      .run(kind, status, name, size, detail ? String(detail).slice(0, 500) : null, started || null);
  } catch { /* table missing in very old databases */ }
}

/** Makes a backup file in the local backup folder. */
export async function runBackup(db, { reason = 'nightly' } = {}) {
  const cfg = backupConfig(db);
  const started = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const dir = cfg.dir;
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    let name = `secureops-${stamp()}.sobak`;
    for (let i = 2; fs.existsSync(path.join(dir, name)); i++) name = `secureops-${stamp()}-${i}.sobak`;
    const scratch = fs.mkdtempSync(path.join(DATA_DIR, '.backup-'));
    try {
      const dbCopy = path.join(scratch, 'secureops.db');
      db.exec(`VACUUM INTO '${dbCopy.replace(/'/g, "''")}'`); // consistent snapshot, even mid-write
      const files = FILE_DIRS.flatMap(d => walk(path.join(DATA_DIR, d)).map(f => `${d}/${f}`));
      const keyFile = path.join(DATA_DIR, 'secret.key');
      const withKey = fs.existsSync(keyFile) && (!!cfg.passphrase || process.env.BACKUP_INCLUDE_KEY === '1');
      const counts = {};
      const check = new DatabaseSync(dbCopy, { readOnly: true });
      for (const t of ['customers', 'service_calls', 'invoices', 'users']) { try { counts[t] = check.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n; } catch { /* table missing */ } }
      check.close();
      const manifest = { app: 'secureops', created: new Date().toISOString(), reason, includes_key: withKey, db_bytes: fs.statSync(dbCopy).size, files, counts };
      await writeArchive(path.join(dir, name), [
        { name: 'manifest.json', buffer: Buffer.from(JSON.stringify(manifest)) },
        { name: 'secureops.db', file: dbCopy },
        ...(withKey ? [{ name: 'secret.key', file: keyFile }] : []),
        ...files.map(f => ({ name: f, file: path.join(DATA_DIR, f) })),
      ], { passphrase: cfg.passphrase, meta: { app: 'secureops', created: manifest.created, reason, includes_key: withKey, files: files.length } });
      const size = fs.statSync(path.join(dir, name)).size;
      pruneBackups(db, cfg);
      record(db, 'backup', 'ok', { name, size, started, detail: `${reason}${cfg.passphrase ? ', encrypted' : ''}` });
      return { name, size, encrypted: !!cfg.passphrase, path: path.join(dir, name) };
    } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  } catch (e) {
    record(db, 'backup', 'failed', { started, detail: e.message });
    throw e;
  }
}

// ---------------------------------------------------------------- off-site
export async function uploadOffsite(db, name) {
  const cfg = offsiteConfig(db);
  const started = new Date().toISOString().replace('T', ' ').slice(0, 19);
  try {
    if (!cfg.ready) throw new Error('Off-site storage isn’t set up');
    const file = path.join(backupDir(db), name);
    const { header } = readHeader(file);
    if (!header.encrypted) throw new Error('Set a backup password first: off-site copies must be encrypted');
    const until = cfg.lockDays ? new Date(Date.now() + cfg.lockDays * 864e5) : null;
    await client(cfg).uploadFile(remoteKey(cfg, name), file, { lock: until ? { until, mode: cfg.lockMode } : null });
    const size = fs.statSync(file).size;
    record(db, 'offsite', 'ok', { name, size, started, detail: until ? `locked until ${until.toISOString().slice(0, 10)}` : 'no lock' });
    return { key: remoteKey(cfg, name), size, locked_until: until };
  } catch (e) {
    record(db, 'offsite', 'failed', { name, started, detail: e.message });
    throw e;
  }
}
export async function listOffsite(db) {
  const cfg = offsiteConfig(db);
  if (!cfg.ready) return [];
  const prefix = cfg.prefix ? `${cfg.prefix}/` : '';
  return (await client(cfg).list(prefix)).filter(o => NAME_RE.test(o.key.slice(prefix.length)))
    .map(o => ({ ...o, name: o.key.slice(prefix.length) })).sort((a, b) => b.name.localeCompare(a.name));
}
/** Checks the storage settings by writing (and reading back) a small test file. */
export async function testOffsite(db) {
  const cfg = offsiteConfig(db);
  if (!cfg.ready) throw new Error('Fill in the storage address, bucket and keys first');
  const c = client(cfg);
  const key = remoteKey(cfg, '.connection-test');
  const body = `SecureOps off-site test ${new Date().toISOString()}`;
  await c.putObject(key, body, { contentType: 'text/plain' });
  const back = await c.getText(key).catch(e => { throw new Error(`Uploaded, but couldn’t read it back (${e.message}). The key needs read access so backups can be restored and tested.`); });
  if (back !== body) throw new Error('Uploaded, but the file read back didn’t match');
  const list = await c.list(cfg.prefix ? `${cfg.prefix}/` : '').catch(e => { throw new Error(`Uploaded, but couldn’t list files (${e.message}). The key needs list access.`); });
  return { ok: true, region: c.region, files: list.length };
}
export async function fetchOffsite(db, name) {
  if (!NAME_RE.test(name)) throw new Error('Not a backup file name');
  const cfg = offsiteConfig(db);
  const dir = backupDir(db);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const dest = path.join(dir, name);
  if (!fs.existsSync(dest)) await client(cfg).downloadFile(remoteKey(cfg, name), dest);
  return { name, path: dest };
}

// ---------------------------------------------------------------- restore test
/** Unpacks a backup into a scratch folder and checks the database opens, passes SQLite's
 *  integrity check, and has the files and record counts the backup says it has. */
export async function verifyBackup(db, { name, offsite = false } = {}) {
  const cfg = backupConfig(db);
  const started = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const scratch = fs.mkdtempSync(path.join(DATA_DIR, '.verify-'));
  let label = name;
  try {
    let file;
    if (offsite) {
      const list = await listOffsite(db);
      const pick = name ? list.find(o => o.name === name) : list[0];
      if (!pick) throw new Error('No off-site backups found');
      label = `${pick.name} (off-site)`;
      file = path.join(scratch, pick.name);
      await client(offsiteConfig(db)).downloadFile(pick.key, file);
    } else {
      const pick = name ? listBackups(db).find(b => b.name === name) : listBackups(db).find(b => b.format === 'file');
      if (!pick || pick.format !== 'file') throw new Error('No backup file to test');
      label = pick.name;
      file = path.join(backupDir(db), pick.name);
    }
    const out = path.join(scratch, 'x');
    const { manifest } = await extractArchive(file, out, { passphrase: cfg.passphrases });
    const t = new DatabaseSync(path.join(out, 'secureops.db'), { readOnly: true });
    const integrity = t.prepare('PRAGMA integrity_check').get();
    const counts = {};
    for (const k of Object.keys(manifest?.counts || {})) counts[k] = t.prepare(`SELECT COUNT(*) AS n FROM ${k}`).get().n;
    t.close();
    const problems = [];
    if (Object.values(integrity)[0] !== 'ok') problems.push(`database check: ${Object.values(integrity)[0]}`);
    for (const [k, v] of Object.entries(manifest?.counts || {})) if (counts[k] !== v) problems.push(`${k}: ${counts[k]} instead of ${v}`);
    const missing = (manifest?.files || []).filter(f => !fs.existsSync(path.join(out, f)));
    if (missing.length) problems.push(`${missing.length} file(s) missing`);
    if (problems.length) throw new Error(problems.join('; '));
    const detail = `${label}: database OK, ${counts.customers ?? 0} customers, ${(manifest?.files || []).length} files`;
    record(db, 'verify', 'ok', { name: label, started, detail });
    return { ok: true, name: label, counts, files: (manifest?.files || []).length };
  } catch (e) {
    record(db, 'verify', 'failed', { name: label, started, detail: e.message });
    throw e;
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}

// ---------------------------------------------------------------- schedule & alerts
let alertFn = null;
async function alertOwner(db, title, body, what = 'backup') {
  try {
    alertFn ||= (await import('./alerts.js')).raiseAlert;
    alertFn(db, { kind: 'backup', severity: 'warn', title, body, link: `#/settings?tab=data&alert=${what}`, roles: 'owner', dedupeHours: 20 });
  } catch (e) { console.error('backup alert', e.message); }
}
const lastOk = (db, kind) => db.prepare("SELECT finished_at FROM backup_runs WHERE kind = ? AND status = 'ok' ORDER BY id DESC LIMIT 1").get(kind)?.finished_at || null;
const hoursSince = t => t ? (Date.now() - new Date(t.replace(' ', 'T')).getTime()) / 3600e3 : Infinity;

/** The nightly job: local backup → off-site upload → (monthly) restore test. */
export async function nightly(db, { now = new Date() } = {}) {
  const cfg = backupConfig(db), off = offsiteConfig(db);
  let b;
  try { b = await runBackup(db, { reason: 'nightly' }); } catch (e) { await alertOwner(db, 'Nightly backup failed', e.message); return; }
  if (off.enabled) {
    try { await uploadOffsite(db, b.name); } catch (e) { await alertOwner(db, 'Off-site backup upload failed', `${e.message}\n\nThe backup is still on this server (${b.name}).`, 'offsite'); }
  }
  if (now.getDate() === cfg.verifyDay) {
    try { await verifyBackup(db, { offsite: off.enabled && off.ready }); } catch (e) { await alertOwner(db, 'Monthly backup restore test failed', e.message, 'verify'); }
  }
}

/** Alerts if backups have quietly stopped (e.g. the server was off, or storage keys expired). */
export async function staleCheck(db) {
  const cfg = backupConfig(db), off = offsiteConfig(db);
  if (cfg.disabled) return;
  const firstRun = db.prepare("SELECT 1 FROM backup_runs LIMIT 1").get();
  if (!firstRun) return;
  if (hoursSince(lastOk(db, 'backup')) > 48) await alertOwner(db, 'No backup in the last 2 days', 'Check Settings → Backup & data.', 'stale');
  if (off.enabled && hoursSince(lastOk(db, 'offsite')) > 48) await alertOwner(db, 'No off-site backup in the last 2 days', 'Check the storage settings under Settings → Backup & data, and use “Test connection”.', 'offsite-stale');
}

/** Runs the nightly job once a day at the backup hour (server local time). */
export function scheduleBackups(db) {
  if (process.env.BACKUP_DISABLED === '1') return;
  let running = false;
  const tick = async () => {
    if (running) return;
    const cfg = backupConfig(db);
    const now = new Date();
    const today = stamp(now).slice(0, 10);
    const doneToday = db.prepare("SELECT 1 FROM backup_runs WHERE kind = 'backup' AND detail LIKE 'nightly%' AND finished_at >= ?").get(today);
    running = true;
    try {
      if (now.getHours() === cfg.hour && !doneToday) await nightly(db, { now });
      if (now.getMinutes() < 6) await staleCheck(db);
    } catch (e) { console.error('backup job', e); } finally { running = false; }
  };
  setInterval(tick, 5 * 60e3).unref();
}

// ---------------------------------------------------------------- restore
/** Puts a backup back in place. Run with the app stopped. The current data is kept aside. */
export async function restore(target, { db = null, passphrase = process.env.BACKUP_PASSPHRASE } = {}) { // passphrase: one or a list
  const dir = backupDir(db);
  const src = path.isAbsolute(target) || target.includes('/') ? path.resolve(target) : path.join(dir, target);
  if (!fs.existsSync(src)) throw new Error(`No backup found at ${src}`);
  let from = src, scratch = null;
  if (fs.statSync(src).isFile()) {
    scratch = fs.mkdtempSync(path.join(DATA_DIR, '.restore-'));
    await extractArchive(src, scratch, { passphrase: [passphrase, ...(db ? backupConfig(db).passphrases : [])].flat().filter(Boolean) });
    from = scratch;
  }
  if (!fs.existsSync(path.join(from, 'secureops.db'))) throw new Error('That backup has no database in it');
  const aside = path.join(DATA_DIR, `before-restore-${stamp()}`);
  fs.mkdirSync(aside, { recursive: true });
  for (const f of ['secureops.db', 'secureops.db-wal', 'secureops.db-shm']) {
    const p = path.join(path.dirname(DB_PATH), f.replace('secureops.db', path.basename(DB_PATH)));
    if (fs.existsSync(p)) fs.renameSync(p, path.join(aside, f));
  }
  fs.copyFileSync(path.join(from, 'secureops.db'), DB_PATH);
  for (const d of FILE_DIRS) {
    if (!fs.existsSync(path.join(from, d))) continue;
    if (fs.existsSync(path.join(DATA_DIR, d))) fs.renameSync(path.join(DATA_DIR, d), path.join(aside, d));
    fs.cpSync(path.join(from, d), path.join(DATA_DIR, d), { recursive: true });
  }
  // The restored database's saved passwords need the key they were encrypted with.
  const keyIn = path.join(from, 'secret.key'), keyHere = path.join(DATA_DIR, 'secret.key');
  if (fs.existsSync(keyIn)) {
    if (fs.existsSync(keyHere) && !fs.readFileSync(keyHere).equals(fs.readFileSync(keyIn))) fs.renameSync(keyHere, path.join(aside, 'secret.key'));
    if (!fs.existsSync(keyHere)) fs.copyFileSync(keyIn, keyHere);
  }
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  return { restored: src, previous_data: aside };
}

// ---------------------------------------------------------------- recover one deleted customer
// Opens a backup's database (read-only, in a scratch folder) and copies back a customer that was
// deleted since, with everything that hung off it (sites, contacts, systems, passwords, jobs,
// invoices…) — without rolling back anyone else's work.
const opened = new Map(); // backup name -> { dir, db, files, at }
async function openBackupDb(db, name) {
  const hit = opened.get(name);
  if (hit && Date.now() - hit.at < 10 * 60e3) return hit;
  if (hit) { try { hit.db.close(); } catch { /* closed */ } fs.rmSync(hit.dir, { recursive: true, force: true }); opened.delete(name); }
  const b = listBackups(db).find(x => x.name === name);
  if (!b) throw new Error('Backup not found');
  const scratch = fs.mkdtempSync(path.join(DATA_DIR, '.browse-'));
  let dbFile, files;
  if (b.format === 'file') {
    const { manifest } = await extractArchive(path.join(backupDir(db), name), scratch, { passphrase: backupConfig(db).passphrases, want: n => n === 'secureops.db' });
    dbFile = path.join(scratch, 'secureops.db');
    files = new Set(manifest?.files || []);
  } else {
    dbFile = path.join(backupDir(db), name, 'secureops.db');
    files = new Set(FILE_DIRS.flatMap(d => walk(path.join(backupDir(db), name, d)).map(f => `${d}/${f}`)));
  }
  const entry = { dir: scratch, db: new DatabaseSync(dbFile, { readOnly: true }), files, format: b.format, at: Date.now() };
  opened.set(name, entry);
  setTimeout(() => { const e = opened.get(name); if (e === entry) { try { e.db.close(); } catch { /* closed */ } fs.rmSync(e.dir, { recursive: true, force: true }); opened.delete(name); } }, 10 * 60e3).unref();
  return entry;
}

export async function deletedCustomers(db, name) {
  const { db: old } = await openBackupDb(db, name);
  const now = new Set(db.prepare('SELECT id FROM customers').all().map(r => r.id));
  return old.prepare('SELECT id, name, type, city, phone, email FROM customers ORDER BY name').all().filter(c => !now.has(c.id));
}

const tableNames = d => d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name);
const columns = (d, t) => d.prepare(`PRAGMA table_info("${t}")`).all();

export async function recoverCustomer(db, name, customerId) {
  const bk = await openBackupDb(db, name);
  const old = bk.db;
  const id = Number(customerId);
  if (!old.prepare('SELECT 1 FROM customers WHERE id = ?').get(id)) throw new Error('That customer isn’t in this backup');
  if (db.prepare('SELECT 1 FROM customers WHERE id = ?').get(id)) throw new Error('That customer still exists');
  const liveTables = new Set(tableNames(db));
  // Child links: table → [{ col, parent }]
  const links = {};
  for (const t of tableNames(old)) {
    if (!liveTables.has(t)) continue;
    const fks = old.prepare(`PRAGMA foreign_key_list("${t}")`).all().map(f => ({ col: f.from, parent: f.table }));
    if (!fks.some(f => f.parent === 'customers') && columns(old, t).some(c => c.name === 'customer_id') && t !== 'customers') fks.push({ col: 'customer_id', parent: 'customers' });
    links[t] = fks;
  }
  // Walk down from the customer: rows in the backup that point at rows we're bringing back.
  const take = { customers: new Map([[id, old.prepare('SELECT * FROM customers WHERE id = ?').get(id)]]) };
  for (let round = 0, grew = true; grew && round < 5; round++) {
    grew = false;
    for (const [t, fks] of Object.entries(links)) {
      if (t === 'users' || t === 'technicians' || t === 'audit_log' || t === 'settings') continue;
      for (const f of fks) {
        const parents = take[f.parent];
        if (!parents?.size) continue;
        const ids = [...parents.keys()];
        for (let i = 0; i < ids.length; i += 500) {
          const chunk = ids.slice(i, i + 500);
          let rows;
          try { rows = old.prepare(`SELECT rowid AS __rid, * FROM "${t}" WHERE "${f.col}" IN (${chunk.map(() => '?').join(',')})`).all(...chunk); } catch { continue; }
          take[t] ||= new Map();
          for (const r of rows) { const k = r.id ?? r.__rid; if (!take[t].has(k)) { take[t].set(k, r); grew = true; } }
        }
      }
    }
  }
  // Insert parents before children.
  const order = [];
  const visit = (t, seen = new Set()) => { if (order.includes(t) || seen.has(t)) return; seen.add(t); for (const f of links[t] || []) if (take[f.parent] && f.parent !== t) visit(f.parent, seen); order.push(t); };
  for (const t of Object.keys(take)) visit(t);
  const summary = {};
  const fileHits = new Set();
  db.exec('BEGIN');
  try {
    for (const t of order) {
      const rows = take[t];
      if (!rows?.size) continue;
      const liveCols = new Set(columns(db, t).map(c => c.name));
      const notNull = new Set(columns(db, t).filter(c => c.notnull).map(c => c.name));
      const fks = db.prepare(`PRAGMA foreign_key_list("${t}")`).all();
      const hasId = liveCols.has('id');
      let n = 0, relinked = 0;
      for (const r of rows.values()) {
        const row = { ...r }; delete row.__rid;
        for (const k of Object.keys(row)) if (!liveCols.has(k)) delete row[k];
        if (hasId && db.prepare(`SELECT 1 FROM "${t}" WHERE id = ?`).get(row.id)) {
          // Still there (e.g. its link was set to empty when the customer was deleted): link it back.
          for (const f of fks) {
            if (take[f.table]?.has(row[f.from]) && db.prepare(`SELECT "${f.from}" AS v FROM "${t}" WHERE id = ?`).get(row.id)?.v == null) {
              db.prepare(`UPDATE "${t}" SET "${f.from}" = ? WHERE id = ?`).run(row[f.from], row.id); relinked++;
            }
          }
          continue;
        }
        // Links to things that no longer exist (a deleted technician…) are cleared, or the row skipped.
        let skip = false;
        for (const f of fks) {
          const v = row[f.from];
          if (v == null || take[f.table]?.has(v)) continue;
          const exists = db.prepare(`SELECT 1 FROM "${f.table}" WHERE "${f.to || 'id'}" = ?`).get(v);
          if (!exists) { if (notNull.has(f.from)) { skip = true; break; } row[f.from] = null; }
        }
        if (skip) continue;
        const cols = Object.keys(row);
        const done = db.prepare(`INSERT OR IGNORE INTO "${t}" (${cols.map(c => `"${c}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map(c => row[c]));
        if (!done.changes) continue;
        n++;
        for (const v of Object.values(row)) if (typeof v === 'string' && v.length < 200) for (const d of FILE_DIRS) if (bk.files.has(`${d}/${v}`)) fileHits.add(`${d}/${v}`);
      }
      if (n || relinked) summary[t] = n + relinked;
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  // Bring back photos/signatures/documents those rows point to, if they're gone.
  const needed = [...fileHits].filter(f => !fs.existsSync(path.join(DATA_DIR, f)));
  if (needed.length) {
    if (bk.format === 'file') {
      const scratch = fs.mkdtempSync(path.join(DATA_DIR, '.recover-'));
      try {
        const want = new Set(needed);
        await extractArchive(path.join(backupDir(db), name), scratch, { passphrase: backupConfig(db).passphrases, want: n => want.has(n) });
        for (const f of needed) if (fs.existsSync(path.join(scratch, f))) { fs.mkdirSync(path.dirname(path.join(DATA_DIR, f)), { recursive: true }); fs.copyFileSync(path.join(scratch, f), path.join(DATA_DIR, f)); }
      } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
    } else {
      for (const f of needed) { const s = path.join(backupDir(db), name, f); if (fs.existsSync(s)) { fs.mkdirSync(path.dirname(path.join(DATA_DIR, f)), { recursive: true }); fs.copyFileSync(s, path.join(DATA_DIR, f)); } }
    }
  }
  return { restored: summary, files: needed.length, name: take.customers.get(id).name };
}

// ---------------------------------------------------------------- CLI
async function cli() {
  const [cmd, arg, arg2] = process.argv.slice(2);
  if (cmd === 'restore') {
    const db = fs.existsSync(DB_PATH) ? openDb() : null;
    try {
      if (!arg) {
        console.log('Usage:\n  npm run restore -- <backup name, file or folder>\n  npm run restore -- --offsite latest|<name>\n\nBackups on this server:\n' + listBackups(db).map(b => `  ${b.name}${b.encrypted ? '  (encrypted)' : ''}`).join('\n'));
        process.exit(1);
      }
      let target = arg;
      if (arg === '--offsite') {
        const cfg = offsiteConfig(db);
        if (!cfg.ready) throw new Error('Set OFFSITE_ENDPOINT, OFFSITE_BUCKET, OFFSITE_KEY_ID and OFFSITE_SECRET (and OFFSITE_PREFIX if you changed it).');
        const list = await listOffsite(db);
        const pick = !arg2 || arg2 === 'latest' ? list[0] : list.find(o => o.name === arg2);
        if (!pick) throw new Error(`No off-site backup found${arg2 && arg2 !== 'latest' ? ` named ${arg2}` : ''}. Available:\n${list.slice(0, 20).map(o => `  ${o.name}`).join('\n')}`);
        console.log(`Downloading ${pick.name} (${(pick.size / 1e6).toFixed(1)} MB)…`);
        target = (await fetchOffsite(db, pick.name)).path;
      }
      const pass = [process.env.BACKUP_PASSPHRASE, ...(db ? backupConfig(db).passphrases : [])].filter(Boolean);
      db?.close();
      const r = await restore(target, { db: null, passphrase: pass });
      console.log(`Restored ${r.restored}\nThe data that was there before is in ${r.previous_data}\nStart the app again.`);
    } catch (e) { db?.close?.(); throw e; }
  } else {
    const db = openDb();
    const b = await runBackup(db, { reason: 'manual' });
    console.log(`Backup saved to ${b.path} (${(b.size / 1e6).toFixed(1)} MB${b.encrypted ? ', encrypted' : ''})`);
    if (offsiteConfig(db).enabled) { const o = await uploadOffsite(db, b.name); console.log(`Uploaded off-site: ${o.key}`); }
    db.close();
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) cli().catch(e => { console.error(e.message); process.exit(1); });
