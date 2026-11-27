import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RESOURCES } from '../public/js/schema.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
export const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'secureops.db');

const SQL_TYPES = {
  text: 'TEXT', email: 'TEXT', tel: 'TEXT', textarea: 'TEXT', select: 'TEXT', date: 'TEXT', datetime: 'TEXT',
  color: 'TEXT', secret: 'TEXT', number: 'REAL', money: 'REAL', checkbox: 'INTEGER', ref: 'INTEGER', location: 'INTEGER',
};

export const DEFAULT_SETTINGS = {
  company_name: 'My Security Company',
  company_address: '',
  company_phone: '',
  company_email: '',
  company_license: '',
  tax_rate: '0',
  payment_terms_days: '30',
  default_labor_rate: '95',
  invoice_next_number: '1001',
  call_next_number: '1001',
  invoice_footer: 'Thank you for your business!',
  // Supplier invoice intake
  auto_receive: '1',
  receiving_update_costs: '1',
  trusted_vendor_domains: '',
  inbound_token: '',
};
// Settings that are never sent to non-admin users or editable through PUT /api/settings.
export const PRIVATE_SETTINGS = new Set(['inbound_token']);

function columnSql(f) {
  let sql = `"${f.name}" ${SQL_TYPES[f.type] || 'TEXT'}`;
  if (f.type === 'ref') {
    const action = { cascade: 'CASCADE', 'set null': 'SET NULL', restrict: 'RESTRICT' }[f.onDelete || 'restrict'];
    sql += ` REFERENCES "${f.ref}"(id) ON DELETE ${action}`;
  }
  return sql;
}

export function openDb(file = DB_PATH) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(db) {
  // Tables generated from the shared schema. New fields added to schema.js are
  // added to existing databases automatically (ALTER TABLE ADD COLUMN).
  for (const [table, def] of Object.entries(RESOURCES)) {
    const cols = def.fields.map(columnSql);
    db.exec(`CREATE TABLE IF NOT EXISTS "${table}" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ${cols.join(',\n      ')},
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )`);
    const existing = new Set(db.prepare(`PRAGMA table_info("${table}")`).all().map(c => c.name));
    for (const f of def.fields) {
      if (!existing.has(f.name)) {
        // SQLite can't add a REFERENCES column with a non-null default; plain add is fine.
        db.exec(`ALTER TABLE "${table}" ADD COLUMN ${columnSql(f)}`);
      }
    }
    for (const f of def.fields.filter(f => f.type === 'ref')) {
      db.exec(`CREATE INDEX IF NOT EXISTS "idx_${table}_${f.name}" ON "${table}"("${f.name}")`);
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin','office','technician')),
      technician_id INTEGER REFERENCES technicians(id) ON DELETE SET NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      last_login TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
    -- location_id 0 = main warehouse/shop, otherwise a vehicle id
    CREATE TABLE IF NOT EXISTS stock (
      item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
      location_id INTEGER NOT NULL,
      qty REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (item_id, location_id)
    );
    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
      from_location INTEGER,
      to_location INTEGER,
      qty REAL NOT NULL,
      kind TEXT NOT NULL,
      note TEXT,
      service_call_id INTEGER,
      user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_moves_item ON stock_movements(item_id);
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      user_name TEXT,
      action TEXT NOT NULL,
      resource TEXT,
      record_id INTEGER,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_service_calls_sched ON service_calls(scheduled_start);
    CREATE INDEX IF NOT EXISTS idx_invoices_period ON invoices(customer_id, kind, period);
  `);

  const ins = db.prepare('INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) ins.run(k, v);
  // Secret for the inbound-email webhook URL.
  db.prepare("UPDATE settings SET value = ? WHERE key = 'inbound_token' AND (value IS NULL OR value = '')").run(randomBytes(24).toString('base64url'));
}

export function getSettings(db) {
  const out = { ...DEFAULT_SETTINGS };
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
  return out;
}

export function nextNumber(db, key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  const n = parseInt(row?.value || '1001', 10);
  db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(String(n + 1), key);
  return String(n);
}

// Transaction helper; nested calls become savepoints.
let depth = 0;
export function tx(db, fn) {
  const sp = `sp${depth}`;
  db.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
  depth++;
  try {
    const r = fn();
    depth--;
    db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
    return r;
  } catch (e) {
    depth--;
    db.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
    throw e;
  }
}
