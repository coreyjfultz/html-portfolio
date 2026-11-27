import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './db.js';

// ---- Encryption for stored secrets (camera passwords, alarm codes, gate codes)
// AES-256-GCM. Key comes from APP_SECRET (64 hex chars) or data/secret.key,
// which is created on first run. BACK THIS KEY UP: without it, saved
// passwords cannot be decrypted.
function loadKey() {
  if (process.env.APP_SECRET) {
    const k = Buffer.from(process.env.APP_SECRET, 'hex');
    if (k.length !== 32) throw new Error('APP_SECRET must be 64 hex characters (32 bytes)');
    return k;
  }
  const file = path.join(DATA_DIR, 'secret.key');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
}
let KEY;
const key = () => (KEY ||= loadKey());

export function encrypt(plain) {
  if (plain == null || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${data.toString('base64')}`;
}

export function decrypt(blob) {
  if (!blob) return '';
  const [v, iv, tag, data] = String(blob).split(':');
  if (v !== 'v1') throw new Error('Unknown secret format');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}

// ---- Password hashing (scrypt)
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(pw, stored) {
  const [alg, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(pw, Buffer.from(salt, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual);
}

export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Password must be at least 8 characters';
  return null;
}

// ---- Sessions
const SESSION_DAYS = 14;
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

export function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?,?,?)')
    .run(sha(token), userId, Date.now() + SESSION_DAYS * 864e5);
  db.prepare("UPDATE users SET last_login = datetime('now','localtime') WHERE id = ?").run(userId);
  return token;
}

export function sessionUser(db, token) {
  if (!token) return null;
  const row = db.prepare(`SELECT u.id, u.name, u.email, u.role, u.technician_id, u.active, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(sha(token));
  if (!row || !row.active || row.expires_at < Date.now()) return null;
  // Sliding expiry: extend if more than a day has passed.
  if (row.expires_at - Date.now() < (SESSION_DAYS - 1) * 864e5) {
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(Date.now() + SESSION_DAYS * 864e5, sha(token));
  }
  delete row.expires_at;
  return row;
}

export function destroySession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
}

export function purgeSessions(db) {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}

// ---- Simple login rate limiting (per IP + email)
const attempts = new Map();
export function loginAllowed(keyStr) {
  const now = Date.now();
  const a = (attempts.get(keyStr) || []).filter(t => now - t < 15 * 60e3);
  attempts.set(keyStr, a);
  return a.length < 10;
}
export function recordFailedLogin(keyStr) {
  const a = attempts.get(keyStr) || [];
  a.push(Date.now());
  attempts.set(keyStr, a);
}
export function clearLogins(keyStr) { attempts.delete(keyStr); }

export function audit(db, user, action, resource, recordId, detail) {
  db.prepare('INSERT INTO audit_log(user_id, user_name, action, resource, record_id, detail) VALUES (?,?,?,?,?,?)')
    .run(user?.id ?? null, user?.name ?? null, action, resource ?? null, recordId ?? null, detail ?? null);
}
