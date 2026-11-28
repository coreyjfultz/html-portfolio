// Backups: a consistent copy of the database (taken while the app runs) plus uploaded files
// (job photos, signatures, supplier invoices, logo). Runs nightly inside the server and can be
// run by hand:  npm run backup        restore:  npm run restore -- <backup folder>
//
// The encryption key (DATA_DIR/secret.key) is NOT copied by default: whoever holds a backup
// and the key can read stored camera passwords and alarm codes. Keep the key somewhere safe
// and separate (a password manager). Set BACKUP_INCLUDE_KEY=1 to include it anyway.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR, DB_PATH, openDb } from './db.js';

export const BACKUP_DIR = process.env.BACKUP_DIR || path.join(DATA_DIR, 'backups');
const FILE_DIRS = ['photos', 'signatures', 'branding', 'invoices', 'hrdocs', 'library'];
const keep = () => Math.max(1, Number(process.env.BACKUP_KEEP) || 14);
const stamp = (d = new Date()) => {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
const dirSize = dir => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).reduce((s, e) => s + (e.isDirectory() ? dirSize(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0) : 0;

export function runBackup(db, { reason = 'nightly' } = {}) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const name = stamp();
  const tmp = path.join(BACKUP_DIR, `.${name}.partial`);
  fs.mkdirSync(tmp, { recursive: true });
  try {
    db.exec(`VACUUM INTO '${path.join(tmp, 'secureops.db').replace(/'/g, "''")}'`); // consistent snapshot, even mid-write
    for (const d of FILE_DIRS) {
      const src = path.join(DATA_DIR, d);
      if (fs.existsSync(src)) fs.cpSync(src, path.join(tmp, d), { recursive: true });
    }
    const withKey = process.env.BACKUP_INCLUDE_KEY === '1' && fs.existsSync(path.join(DATA_DIR, 'secret.key'));
    if (withKey) fs.copyFileSync(path.join(DATA_DIR, 'secret.key'), path.join(tmp, 'secret.key'));
    fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify({ created: new Date().toISOString(), reason, includes_key: withKey, app: 'secureops' }, null, 2));
    fs.renameSync(tmp, path.join(BACKUP_DIR, name));
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
  prune();
  return { name, size: dirSize(path.join(BACKUP_DIR, name)) };
}

export function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.') && fs.existsSync(path.join(BACKUP_DIR, e.name, 'secureops.db')))
    .map(e => {
      let m = {};
      try { m = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, e.name, 'manifest.json'), 'utf8')); } catch { /* older backup */ }
      return { name: e.name, created: m.created || null, reason: m.reason || null, includes_key: !!m.includes_key, size: dirSize(path.join(BACKUP_DIR, e.name)) };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

function prune() {
  for (const b of listBackups().slice(keep())) fs.rmSync(path.join(BACKUP_DIR, b.name), { recursive: true, force: true });
}

/** Run once a night at BACKUP_HOUR (server local time, default 2 AM). */
export function scheduleBackups(db) {
  if (process.env.BACKUP_DISABLED === '1') return;
  const hour = Number(process.env.BACKUP_HOUR ?? 2);
  let lastDay = listBackups().find(b => b.reason === 'nightly')?.name.slice(0, 10) || null;
  setInterval(() => {
    const now = new Date();
    const today = stamp(now).slice(0, 10);
    if (now.getHours() !== hour || lastDay === today) return;
    lastDay = today;
    try { const b = runBackup(db); console.log(`Backup saved: ${b.name}`); } catch (e) { console.error('Backup failed:', e.message); }
  }, 5 * 60e3).unref();
}

/** Put a backup back in place. Run with the app stopped. The current data is kept aside first. */
export function restore(name) {
  const src = path.isAbsolute(name) ? name : path.join(BACKUP_DIR, name);
  if (!fs.existsSync(path.join(src, 'secureops.db'))) throw new Error(`No backup found at ${src}`);
  const aside = path.join(DATA_DIR, `before-restore-${stamp()}`);
  fs.mkdirSync(aside, { recursive: true });
  for (const f of ['secureops.db', 'secureops.db-wal', 'secureops.db-shm']) {
    const p = path.join(path.dirname(DB_PATH), f.replace('secureops.db', path.basename(DB_PATH)));
    if (fs.existsSync(p)) fs.renameSync(p, path.join(aside, f));
  }
  fs.copyFileSync(path.join(src, 'secureops.db'), DB_PATH);
  for (const d of FILE_DIRS) {
    if (!fs.existsSync(path.join(src, d))) continue;
    if (fs.existsSync(path.join(DATA_DIR, d))) fs.renameSync(path.join(DATA_DIR, d), path.join(aside, d));
    fs.cpSync(path.join(src, d), path.join(DATA_DIR, d), { recursive: true });
  }
  if (fs.existsSync(path.join(src, 'secret.key')) && !fs.existsSync(path.join(DATA_DIR, 'secret.key'))) fs.copyFileSync(path.join(src, 'secret.key'), path.join(DATA_DIR, 'secret.key'));
  return { restored: src, previous_data: aside };
}

// CLI: node server/backup.js [restore <name>]
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === 'restore') {
      if (!process.argv[3]) { console.log('Usage: npm run restore -- <backup folder name or path>\n\nBackups:\n' + listBackups().map(b => `  ${b.name}`).join('\n')); process.exit(1); }
      const r = restore(process.argv[3]);
      console.log(`Restored ${r.restored}\nThe data that was there before is in ${r.previous_data}\nStart the app again.`);
    } else {
      const db = openDb();
      const b = runBackup(db, { reason: 'manual' });
      db.close();
      console.log(`Backup saved to ${path.join(BACKUP_DIR, b.name)} (${(b.size / 1e6).toFixed(1)} MB)`);
    }
  } catch (e) { console.error(e.message); process.exit(1); }
}
