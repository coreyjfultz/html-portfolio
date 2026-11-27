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
  calendar_token: '',
  timezone: 'America/New_York',
  public_url: '',
  // Notifications
  smtp_host: '', smtp_port: '587', smtp_user: '', smtp_pass: '', mail_from: '',
  twilio_sid: '', twilio_token: '', twilio_from: '',
  notify_on_schedule: '1', notify_on_way: '1', notify_tech_invites: '1',
  proposal_next_number: '1001',
  stripe_secret: '', stripe_webhook_secret: '', stripe_ach: '1',
  qbo_client_id: '', qbo_client_secret: '', qbo_environment: 'sandbox', qbo_realm_id: '', qbo_company_name: '',
  qbo_access: '', qbo_refresh: '', qbo_access_expires: '', qbo_item_id: '', qbo_tax_item_id: '', qbo_auto_sync: '1', qbo_last_sync: '',
  export_income_account: '', export_tax_account: '',
  proposal_valid_days: '30',
  proposal_terms: `1. Scope. We will furnish and install the equipment and services listed above. Work outside this scope will be quoted separately.
2. Payment. The deposit shown is due at signing; the balance is due on completion. Monthly service fees are billed in advance each month.
3. Warranty. Equipment carries the manufacturer's warranty. Our workmanship is warranted for 12 months from installation.
4. Monitoring & service term. Monthly services continue for the term shown, then month to month. Either party may cancel after the term with 30 days' written notice.
5. Access. You will provide reasonable access to the premises, power and network connections needed for the installation.
6. Limitation. Security, camera and fire systems reduce risk but cannot guarantee that loss, injury or damage will not occur. We are not an insurer.
7. Electronic signature. You agree that signing electronically is legally binding, the same as a handwritten signature.`,
};
export const DEFAULT_TEMPLATES = {
  tpl_scheduled_sms: '{company}: your {type} is scheduled for {date} at {time} with {tech}. Questions? Call {company_phone}. Reply STOP to opt out.',
  tpl_scheduled_email: 'Hi {customer},\n\nYour {type} appointment is confirmed:\n\n{date} at {time}\nTechnician: {tech}\nAddress: {address}\n\nIf you need to reschedule, reply to this email or call {company_phone}.\n\nThank you,\n{company}',
  tpl_onway_sms: '{company}: {tech} is on the way{eta}. See you soon!',
  tpl_onway_email: 'Hi {customer},\n\n{tech} from {company} is on the way to {address}{eta}.\n\nThank you,\n{company}',
};
Object.assign(DEFAULT_SETTINGS, DEFAULT_TEMPLATES);
// Settings stored encrypted; never sent back to the browser.
export const SECRET_SETTINGS = new Set(['smtp_pass', 'twilio_token', 'stripe_secret', 'stripe_webhook_secret', 'qbo_client_secret']);
// Managed by the system only: never sent to the browser, never set through the settings form.
export const INTERNAL_SETTINGS = new Set(['qbo_access', 'qbo_refresh', 'qbo_access_expires', 'qbo_realm_id', 'qbo_company_name', 'qbo_last_sync', 'invoice_next_number_lock']);
// Settings that are never sent to non-admin users or editable through PUT /api/settings.
export const PRIVATE_SETTINGS = new Set(['inbound_token', 'calendar_token', 'smtp_pass', 'twilio_token', 'stripe_secret', 'stripe_webhook_secret']);

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
      role TEXT NOT NULL CHECK (role IN ('owner','admin','sales','accounting','technician')),
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
    CREATE TABLE IF NOT EXISTS portal_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
      name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT,
      email_verified INTEGER NOT NULL DEFAULT 0, token_hash TEXT, token_purpose TEXT, token_expires INTEGER,
      signup_type TEXT, signup_phone TEXT, signup_address TEXT,
      active INTEGER NOT NULL DEFAULT 1, last_login TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS portal_sessions (
      token_hash TEXT PRIMARY KEY,
      portal_user_id INTEGER NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS qbo_map (
      entity TEXT NOT NULL, local_id INTEGER NOT NULL, qbo_id TEXT, sync_token TEXT, synced_at TEXT, error TEXT, dirty INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (entity, local_id)
    );
    CREATE TABLE IF NOT EXISTS job_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_call_id INTEGER NOT NULL REFERENCES service_calls(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('before','after','other')),
      file_key TEXT NOT NULL, caption TEXT, user_id INTEGER, user_name TEXT, show_customer INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_job_photos_call ON job_photos(service_call_id);
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT NOT NULL, to_addr TEXT, subject TEXT, body TEXT,
      status TEXT NOT NULL, error TEXT, related_type TEXT, related_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_rel ON notifications(related_type, related_id);
    CREATE TABLE IF NOT EXISTS customer_stage_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      from_stage TEXT, to_stage TEXT NOT NULL, user_name TEXT, reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_stage_log ON customer_stage_log(customer_id);
  `);

  // Roles changed from admin/office/technician to owner/admin/sales/accounting/technician:
  // old admins become owners, old office users become administrators.
  const usersSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get()?.sql || '';
  if (usersSql.includes("'office'")) {
    db.exec(`PRAGMA foreign_keys = OFF; BEGIN;
      CREATE TABLE users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('owner','admin','sales','accounting','technician')),
        technician_id INTEGER REFERENCES technicians(id) ON DELETE SET NULL, active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), last_login TEXT);
      INSERT INTO users_new SELECT id, name, email, password_hash, CASE role WHEN 'admin' THEN 'owner' WHEN 'office' THEN 'admin' ELSE role END,
        technician_id, active, created_at, last_login FROM users;
      DROP TABLE users; ALTER TABLE users_new RENAME TO users;
      COMMIT; PRAGMA foreign_keys = ON;`);
  }

  if (!db.prepare('PRAGMA table_info(qbo_map)').all().some(c => c.name === 'dirty')) db.exec('ALTER TABLE qbo_map ADD COLUMN dirty INTEGER NOT NULL DEFAULT 0');

  // Customers that existed before stages were added get a stage from their status.
  db.exec(`UPDATE customers SET stage = CASE status WHEN 'prospect' THEN 'lead' WHEN 'inactive' THEN 'lost' ELSE 'active' END WHERE stage IS NULL`);

  const ins = db.prepare('INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) ins.run(k, v);
  // Secret for the inbound-email webhook URL.
  db.prepare("UPDATE settings SET value = ? WHERE key = 'inbound_token' AND (value IS NULL OR value = '')").run(randomBytes(24).toString('base64url'));
  db.prepare("UPDATE settings SET value = ? WHERE key = 'calendar_token' AND (value IS NULL OR value = '')").run(randomBytes(18).toString('base64url'));
  for (const t of db.prepare('SELECT id FROM technicians WHERE calendar_token IS NULL').all()) {
    db.prepare('UPDATE technicians SET calendar_token = ? WHERE id = ?').run(randomBytes(18).toString('base64url'), t.id);
  }
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
