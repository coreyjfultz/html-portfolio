// Generic, schema-driven CRUD with business-rule hooks.
import { RESOURCES, MAINTENANCE, STAGES, fieldDefault, customerAccess, isFieldRole, G } from '../public/js/schema.js';
import { encrypt, decrypt, audit } from './security.js';
import { getSettings, nextNumber, tx, DATA_DIR } from './db.js';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { queue, notifyScheduled, sendTechInvite, appUrl } from './notify.js';
import path from 'node:path';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}


const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

export const nowLocal = () => {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
export const todayLocal = () => nowLocal().slice(0, 10);

export function addMonths(dateStr, months) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + Number(months), 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}
export const addDays = (dateStr, days) => {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d.toISOString().slice(0, 10);
};

// Extra computed columns for list/get queries.
const EXTRAS = {
  customers: [
    `(SELECT COUNT(*) FROM locations l WHERE l.customer_id = t.id AND l.active = 1) AS location_count`,
    `(SELECT COUNT(*) FROM customers k WHERE k.parent_id = t.id) AS child_count`,
    `(SELECT created_at FROM customer_stage_log g WHERE g.customer_id = t.id ORDER BY g.id DESC LIMIT 1) AS stage_since`,
    `(SELECT COALESCE(SUM(amount),0) FROM recurring_charges rc WHERE rc.customer_id = t.id AND rc.active = 1) AS mrr`,
    `(SELECT COALESCE(SUM(i.total),0) FROM invoices i WHERE i.customer_id = t.id AND i.status NOT IN ('void','draft'))
      - (SELECT COALESCE(SUM(p.amount),0) FROM payments p JOIN invoices i ON i.id = p.invoice_id
         WHERE i.customer_id = t.id AND i.status NOT IN ('void','draft')) AS balance`,
  ],
  invoices: [
    `(SELECT COALESCE(SUM(amount),0) FROM payments p WHERE p.invoice_id = t.id) AS paid`,
    `(SELECT type FROM customers c WHERE c.id = t.customer_id) AS customer_type`,
    `(SELECT email FROM customers c WHERE c.id = t.customer_id) AS customer_email`,
  ],
  inventory_items: [
    `(SELECT COALESCE(SUM(qty),0) FROM stock s WHERE s.item_id = t.id) AS total_qty`,
    `(SELECT COALESCE(SUM(qty),0) FROM stock s WHERE s.item_id = t.id AND s.location_id = 0) AS warehouse_qty`,
  ],
  service_calls: [
    `(SELECT color FROM technicians x WHERE x.id = t.technician_id) AS technician_color`,
    `(SELECT type FROM customers c WHERE c.id = t.customer_id) AS customer_type`,
    `(SELECT phone FROM customers c WHERE c.id = t.customer_id) AS customer_phone`,
    `COALESCE((SELECT l.address || COALESCE(', ' || NULLIF(l.city,''), '') FROM locations l WHERE l.id = t.site_id AND COALESCE(l.address,'') <> ''),
       (SELECT COALESCE(NULLIF(service_address,''), billing_address) || ', ' || COALESCE(NULLIF(service_city,''), city, '')
       FROM customers c WHERE c.id = t.customer_id)) AS customer_address`,
    `(SELECT email FROM customers c WHERE c.id = t.customer_id) AS customer_email`,
    `(SELECT stage FROM customers c WHERE c.id = t.customer_id) AS customer_stage`,
  ],
  service_call_parts: [
    `CASE WHEN t.location_id = 0 THEN 'Warehouse' ELSE (SELECT unit_name FROM vehicles v WHERE v.id = t.location_id) END AS location_id_label`,
  ],
  vehicles: [
    `(SELECT COALESCE(SUM(s.qty),0) FROM stock s WHERE s.location_id = t.id) AS stock_units`,
    `(SELECT COALESCE(SUM(s.qty * COALESCE(i.unit_cost,0)),0) FROM stock s JOIN inventory_items i ON i.id = s.item_id WHERE s.location_id = t.id) AS stock_value`,
  ],
};

function selectSql(name) {
  const def = RESOURCES[name];
  const cols = ['t.*'];
  for (const f of def.fields) {
    if (f.type === 'ref') {
      cols.push(`(SELECT ${RESOURCES[f.ref].labelExpr} FROM "${f.ref}" r WHERE r.id = t."${f.name}") AS "${f.name}_label"`);
    }
  }
  cols.push(...(EXTRAS[name] || []));
  return `SELECT ${cols.join(', ')} FROM "${name}" t`;
}

// ---------------------------------------------------------------- technician scope
// Technicians only see customers on their own schedule (a week back to two weeks
// ahead, plus any open job assigned to them) and customers they were granted
// temporary access to (e.g. an after-hours call routed to them while on call).
const SCOPE_SQL = {
  customers: 't.id',
  monitoring_zones: '(SELECT customer_id FROM monitoring_accounts m WHERE m.id = t.account_id)',
  monitoring_contacts: '(SELECT customer_id FROM monitoring_accounts m WHERE m.id = t.account_id)',
  service_call_parts: '(SELECT customer_id FROM service_calls s WHERE s.id = t.service_call_id)',
  job_materials: '(SELECT customer_id FROM service_calls s WHERE s.id = t.service_call_id)',
};
// Anyone who can't see every customer: field technicians (their schedule) and roles with no customer access.
export const isScoped = user => !!user && customerAccess(user.role) !== 'all';
function scopeExpr(name) {
  if (SCOPE_SQL[name]) return SCOPE_SQL[name];
  return RESOURCES[name]?.fields.some(f => f.name === 'customer_id') ? 't.customer_id' : null;
}
export function techCustomerIds(db, user) {
  if (!isScoped(user)) return null;
  if (customerAccess(user.role) === 'none') return new Set();
  const now = nowLocal();
  const ids = new Set();
  if (user.technician_id) {
    for (const r of db.prepare(`SELECT DISTINCT customer_id FROM service_calls WHERE technician_id = ? AND status <> 'cancelled' AND (
        (status NOT IN ('completed') AND (scheduled_start IS NULL OR scheduled_start >= datetime(?, '-7 days')))
        OR (scheduled_start BETWEEN datetime(?, '-7 days') AND datetime(?, '+14 days')))`).all(user.technician_id, now, now, now)) ids.add(r.customer_id);
  }
  for (const r of db.prepare('SELECT customer_id FROM tech_access_grants WHERE user_id = ? AND expires_at > ?').all(user.id, now)) ids.add(r.customer_id);
  return ids;
}
/** Give a technician temporary access to one customer (e.g. an after-hours call). */
export function grantAccess(db, { userId, customerId, hours = 24, reason = null, by = null }) {
  const d = new Date(Date.now() + Math.min(Math.max(Number(hours) || 24, 1), 24 * 14) * 3600e3);
  const p = n => String(n).padStart(2, '0');
  const until = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  db.prepare('INSERT INTO tech_access_grants (user_id, customer_id, reason, granted_by, expires_at) VALUES (?,?,?,?,?)').run(userId, customerId, reason, by, until);
  return until;
}
/** Throws 404 (not 403, so nothing is revealed) if a technician asks for a customer outside their schedule. */
export function assertCustomerVisible(db, user, customerId) {
  const ids = techCustomerIds(db, user);
  if (ids && !ids.has(Number(customerId))) throw new HttpError(404, 'Not found — this customer is not on your schedule');
}
function customerOf(db, name, row) {
  if (!row) return null;
  if (name === 'customers') return row.id;
  if (name === 'monitoring_zones' || name === 'monitoring_contacts') return db.prepare('SELECT customer_id FROM monitoring_accounts WHERE id = ?').get(row.account_id)?.customer_id;
  if (name === 'service_call_parts') return db.prepare('SELECT customer_id FROM service_calls WHERE id = ?').get(row.service_call_id)?.customer_id;
  return row.customer_id;
}
function assertRowVisible(db, name, row, user) {
  if (!isScoped(user) || !scopeExpr(name)) return;
  assertCustomerVisible(db, user, customerOf(db, name, row));
}

export function getDef(name) {
  const def = RESOURCES[name];
  if (!def) throw new HttpError(404, 'Unknown resource');
  return def;
}

export function canRead(def, user) { return def.read.includes(user.role); }
export function canWrite(def, user) { return def.write.includes(user.role); }
function canDelete(name, def, user) {
  if (def.del) return def.del.includes(user.role);
  if (name === 'service_call_parts') return canWrite(def, user);
  return G.billing.includes(user.role) && canWrite(def, user);
}

export function present(name, row) {
  if (!row) return row;
  const def = RESOURCES[name];
  for (const f of def.fields) {
    if (f.type === 'secret') {
      row[`${f.name}__set`] = !!row[f.name];
      row[f.name] = null;
    }
  }
  if (name === 'invoices') {
    row.balance = round2((row.total || 0) - (row.paid || 0));
    row.display_status = row.status;
    if (['sent', 'partial'].includes(row.status) && row.due_date && row.due_date < todayLocal() && row.balance > 0) {
      row.display_status = 'overdue';
    }
  }
  if (name === 'customers') row.balance = round2(row.balance || 0);
  return row;
}

export const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

export function list(db, name, query = {}, user) {
  const def = getDef(name);
  const where = [];
  const params = [];
  const fieldNames = new Set(['id', ...def.fields.map(f => f.name)]);
  for (const [rawKey, value] of Object.entries(query)) {
    const [key, op] = rawKey.split('__');
    if (!fieldNames.has(key) || value === '') continue;
    if (op === 'in' || op === 'not') {
      const vals = String(value).split(',');
      where.push(`t."${key}" ${op === 'not' ? 'NOT IN' : 'IN'} (${vals.map(() => '?').join(',')})`);
      params.push(...vals);
    } else if (op === 'null') {
      where.push(`t."${key}" IS ${value === '1' ? '' : 'NOT'} NULL`);
    } else if (!op) {
      where.push(`t."${key}" = ?`);
      params.push(value);
    }
  }
  if (query.q && def.search) {
    where.push(`(${def.search.map(s => `t."${s}" LIKE ?`).join(' OR ')})`);
    params.push(...def.search.map(() => `%${query.q}%`));
  }
  if (def.dateField) {
    if (query.from) { where.push(`t."${def.dateField}" >= ?`); params.push(query.from); }
    if (query.to) { where.push(`t."${def.dateField}" <= ?`); params.push(query.to + (def.dateField.includes('start') ? 'T23:59' : '')); }
  }
  // Technicians only see their own service calls unless asking for everything.
  if (name === 'service_calls' && isFieldRole(user?.role) && query.mine === '1' && user.technician_id) {
    where.push('t.technician_id = ?');
    params.push(user.technician_id);
  }
  const expr = isScoped(user) && scopeExpr(name);
  if (expr) {
    const ids = [...techCustomerIds(db, user)];
    where.push(ids.length ? `${expr} IN (${ids.map(() => '?').join(',')})` : '0');
    params.push(...ids);
  }
  const limit = Math.min(parseInt(query.limit, 10) || 1000, 5000);
  const sql = `${selectSql(name)} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${def.order || 't.id DESC'} LIMIT ${limit}`;
  return db.prepare(sql).all(...params).map(r => present(name, r));
}

export function get(db, name, id, user) {
  getDef(name);
  const row = db.prepare(`${selectSql(name)} WHERE t.id = ?`).get(Number(id));
  if (!row) throw new HttpError(404, 'Not found');
  if (user) assertRowVisible(db, name, row, user);
  return present(name, row);
}

function raw(db, name, id) {
  return db.prepare(`SELECT * FROM "${name}" WHERE id = ?`).get(Number(id));
}

function coerce(f, v) {
  if (v === undefined) return undefined;
  switch (f.type) {
    case 'number': case 'money': {
      if (v === null || v === '') return null;
      const n = Number(v);
      if (!Number.isFinite(n)) throw new HttpError(400, `${f.label} must be a number`);
      return f.type === 'money' ? round2(n) : n;
    }
    case 'ref': case 'location': {
      if (v === null || v === '') return f.type === 'location' ? null : null;
      const n = parseInt(v, 10);
      if (!Number.isInteger(n) || n < 0) throw new HttpError(400, `${f.label} is invalid`);
      return n;
    }
    case 'checkbox': return v === true || v === 1 || v === '1' || v === 'on' || v === 'true' ? 1 : 0;
    case 'date':
      if (v === null || v === '') return null;
      if (!DATE_RE.test(v)) throw new HttpError(400, `${f.label} must be a date (YYYY-MM-DD)`);
      return v;
    case 'datetime':
      if (v === null || v === '') return null;
      if (!DATETIME_RE.test(v)) throw new HttpError(400, `${f.label} must be a date and time`);
      return v.slice(0, 16);
    case 'select':
      if (v === null || v === '') return null;
      if (!f.options.includes(v)) throw new HttpError(400, `${f.label}: invalid choice`);
      return v;
    default:
      if (v === null) return null;
      return String(v).slice(0, 10000).trim();
  }
}

function cleanInput(def, body, isCreate, user) {
  const data = {};
  for (const f of def.fields) {
    if (f.readonly) continue;
    // Fields only some roles may set (e.g. approving a job without a signature) are ignored for everyone else.
    if (f.roles && user && !f.roles.includes(user.role)) continue;
    if (f.type === 'secret') {
      if (body[`${f.name}__clear`]) data[f.name] = null;
      else if (body[f.name]) data[f.name] = encrypt(String(body[f.name]));
      continue;
    }
    if (!(f.name in body)) {
      if (isCreate && f.default !== undefined) data[f.name] = coerce(f, fieldDefault(f));
      continue;
    }
    data[f.name] = coerce(f, body[f.name]);
  }
  if (isCreate) {
    for (const f of def.fields) {
      if (f.required && !f.readonly && (data[f.name] === null || data[f.name] === undefined || data[f.name] === '')) {
        throw new HttpError(400, `${f.label} is required`);
      }
    }
  } else {
    for (const f of def.fields) {
      if (f.required && f.name in data && (data[f.name] === null || data[f.name] === '')) {
        throw new HttpError(400, `${f.label} is required`);
      }
    }
  }
  return data;
}

export function create(db, name, body, user) {
  const def = getDef(name);
  if (!canWrite(def, user)) throw new HttpError(403, 'Not allowed');
  return tx(db, () => {
    const data = cleanInput(def, body, true, user);
    if (isScoped(user) && scopeExpr(name) && name !== 'customers') assertRowVisible(db, name, data, user);
    checkSite(db, data, null);
    HOOKS[name]?.beforeSave?.(db, data, { isCreate: true, existing: null, user, body });
    const keys = Object.keys(data);
    const info = db.prepare(`INSERT INTO "${name}" (${keys.map(k => `"${k}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
      .run(...keys.map(k => data[k]));
    const id = Number(info.lastInsertRowid);
    const row = raw(db, name, id);
    HOOKS[name]?.afterSave?.(db, row, { isCreate: true, existing: null, user });
    audit(db, user, 'create', name, id, null);
    return get(db, name, id);
  });
}

export function update(db, name, id, body, user) {
  const def = getDef(name);
  if (!canWrite(def, user) || def.noUpdate) throw new HttpError(403, 'Not allowed');
  return tx(db, () => {
    const existing = raw(db, name, id);
    if (!existing) throw new HttpError(404, 'Not found');
    assertRowVisible(db, name, existing, user);
    const data = cleanInput(def, body, false, user);
    if (isScoped(user) && 'customer_id' in data) assertCustomerVisible(db, user, data.customer_id);
    checkSite(db, data, existing);
    HOOKS[name]?.beforeSave?.(db, data, { isCreate: false, existing, user, body });
    const keys = Object.keys(data);
    if (keys.length) {
      db.prepare(`UPDATE "${name}" SET ${keys.map(k => `"${k}" = ?`).join(', ')}, updated_at = datetime('now','localtime') WHERE id = ?`)
        .run(...keys.map(k => data[k]), Number(id));
    }
    const row = raw(db, name, id);
    HOOKS[name]?.afterSave?.(db, row, { isCreate: false, existing, user });
    audit(db, user, 'update', name, Number(id), keys.join(','));
    return get(db, name, id);
  });
}

export function remove(db, name, id, user) {
  const def = getDef(name);
  if (!canDelete(name, def, user)) throw new HttpError(403, 'Not allowed');
  return tx(db, () => {
    const existing = raw(db, name, id);
    if (!existing) throw new HttpError(404, 'Not found');
    assertRowVisible(db, name, existing, user);
    HOOKS[name]?.beforeDelete?.(db, existing, { user });
    try {
      db.prepare(`DELETE FROM "${name}" WHERE id = ?`).run(Number(id));
    } catch (e) {
      if (/FOREIGN KEY/i.test(e.message)) {
        throw new HttpError(409, 'This record is linked to invoices, payments or other records and cannot be deleted. Mark it inactive (or void it) instead.');
      }
      throw e;
    }
    HOOKS[name]?.afterDelete?.(db, existing, { user });
    audit(db, user, 'delete', name, Number(id), null);
    return { ok: true };
  });
}

export function reveal(db, name, id, field, user) {
  const def = getDef(name);
  if (!canRead(def, user)) throw new HttpError(403, 'Not allowed');
  const f = def.fields.find(x => x.name === field && x.type === 'secret');
  if (!f) throw new HttpError(400, 'Not a secret field');
  const row = raw(db, name, id);
  if (!row) throw new HttpError(404, 'Not found');
  assertRowVisible(db, name, row, user);
  audit(db, user, 'reveal', name, Number(id), field);
  return { value: decrypt(row[field]) };
}

// A record's site must be one of its own customer's locations.
function checkSite(db, data, existing) {
  if (!('site_id' in data) && !('customer_id' in data)) return;
  const siteId = 'site_id' in data ? data.site_id : existing?.site_id;
  const customerId = 'customer_id' in data ? data.customer_id : existing?.customer_id;
  if (!siteId) return;
  const loc = db.prepare('SELECT customer_id FROM locations WHERE id = ?').get(siteId);
  if (!loc) throw new HttpError(400, 'Location not found');
  if (loc.customer_id !== customerId) {
    if ('site_id' in data) throw new HttpError(400, "That location belongs to a different customer");
    data.site_id = null; // customer changed: drop the old customer's site
  }
}

// ---------------------------------------------------------------- job completion rules
/**
 * A job can't be completed without before & after photos and either recorded parts or
 * an explicit "no parts used". Owners/admins can override with a written reason.
 */
function enforceCompletionRules(db, call, existing, user, body, data) {
  const s = getSettings(db);
  const exempt = String(s.photo_exempt_types || '').split(',').map(x => x.trim()).filter(Boolean);
  const missing = [];
  if (s.require_photos === '1' && !exempt.includes(call.call_type)) {
    const n = kind => existing ? db.prepare('SELECT COUNT(*) AS n FROM job_photos WHERE service_call_id = ? AND kind = ?').get(existing.id, kind).n : 0;
    if (!n('before')) missing.push('a “before” photo');
    if (!n('after')) missing.push('an “after” photo');
  }
  const sigExempt = String(s.signature_exempt_types || '').split(',').map(x => x.trim()).filter(Boolean);
  if (s.require_signature === '1' && !call.signature_waived && !sigExempt.includes(call.call_type) && !existing?.signed_by) {
    missing.push('the customer’s signature (or have an owner/admin approve “Customer won’t be on site”)');
  }
  if (existing && s.require_serials === '1') {
    const eq = db.prepare("SELECT id, description, serial_number, (SELECT COUNT(*) FROM equipment_photos p WHERE p.equipment_id = e.id) AS photos FROM installed_equipment e WHERE service_call_id = ? AND status = 'installed'").all(existing.id);
    const noSerial = eq.filter(e => !e.serial_number).length;
    const noPhoto = s.require_serial_photos === '1' ? eq.filter(e => !e.photos).length : 0;
    if (noSerial) missing.push(`serial numbers for ${noSerial} installed item${noSerial === 1 ? '' : 's'}`);
    if (noPhoto) missing.push(`a label / warranty photo for ${noPhoto} installed item${noPhoto === 1 ? '' : 's'}`);
  }
  if (s.require_parts === '1' && call.call_type !== 'estimate') {
    const parts = existing ? db.prepare('SELECT COUNT(*) AS n FROM service_call_parts WHERE service_call_id = ?').get(existing.id).n : 0;
    if (!parts && !body?.no_parts_used) missing.push('the parts used (or tick “No parts used”)');
    if (!parts && body?.no_parts_used) data.no_parts_used = 1;
  }
  if (!missing.length) return;
  const reason = String(body?.override_reason || '').trim();
  if (reason && G.manage.includes(user?.role)) {
    data.completion_override = `${user.name}: ${reason}`.slice(0, 300);
    return;
  }
  const e = new HttpError(400, `Before completing this job, add ${missing.join(', ')}.`);
  e.code = 'completion_rules';
  e.canOverride = G.manage.includes(user?.role);
  throw e;
}

// ---------------------------------------------------------------- scheduling conflicts
const toMinutes = dt => { const d = new Date(dt.length === 16 ? dt + ':00' : dt); return d.getTime() / 60000; };
const fmtWhen = (start, end) => {
  const s = new Date(start), e = new Date(end * 60000);
  const t = d => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${s.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} ${t(s)}–${t(e)}`;
};
/** Returns the first job that overlaps this one for the same technician, or null. */
export function findConflict(db, { id, technician_id, scheduled_start, duration_hours, status }) {
  if (!technician_id || !scheduled_start || ['cancelled', 'completed'].includes(status)) return null;
  const start = toMinutes(scheduled_start);
  const end = start + Math.max(0.25, Number(duration_hours) || 1) * 60;
  const day = scheduled_start.slice(0, 10);
  const others = db.prepare(`SELECT sc.id, sc.number, sc.scheduled_start, sc.duration_hours, c.name AS customer, t.name AS tech
    FROM service_calls sc JOIN customers c ON c.id = sc.customer_id JOIN technicians t ON t.id = sc.technician_id
    WHERE sc.technician_id = ? AND sc.id <> ? AND sc.status NOT IN ('cancelled', 'completed') AND sc.scheduled_start IS NOT NULL
      AND substr(sc.scheduled_start, 1, 10) BETWEEN date(?, '-1 day') AND date(?, '+1 day')`).all(technician_id, id ?? 0, day, day);
  for (const o of others) {
    const os = toMinutes(o.scheduled_start);
    const oe = os + Math.max(0.25, Number(o.duration_hours) || 1) * 60;
    if (start < oe && os < end) return { ...o, when: fmtWhen(o.scheduled_start, oe) };
  }
  return null;
}

// ---------------------------------------------------------------- appointment notifications
function scheduleNotifications(db, row, existing, body) {
  if (body?.notify === false) return;
  const s = getSettings(db);
  const isNew = !existing;
  const timeChanged = isNew || existing.scheduled_start !== row.scheduled_start || existing.duration_hours !== row.duration_hours;
  const techChanged = isNew || existing.technician_id !== row.technician_id;
  const booked = !!(row.technician_id && row.scheduled_start && row.status === 'scheduled' && row.scheduled_start >= nowLocal());
  const wasBooked = !!(existing?.technician_id && existing?.scheduled_start && !['cancelled', 'completed'].includes(existing.status));
  const cancelled = row.status === 'cancelled' && existing && existing.status !== 'cancelled';
  const tasks = [];
  if (booked && (timeChanged || techChanged || existing?.status === 'new')) {
    const reason = existing?.scheduled_start && existing.scheduled_start !== row.scheduled_start && wasBooked ? 'rescheduled' : 'scheduled';
    tasks.push(call => notifyScheduled(db, call, { reason }));
  }
  if (s.notify_tech_invites === '1') {
    if (wasBooked && (cancelled || (techChanged && existing.technician_id))) {
      const old = { ...existing };
      tasks.push(call => sendTechInvite(db, { ...call, scheduled_start: old.scheduled_start, technician_id: old.technician_id }, old.technician_id, { cancel: true, baseUrl: appUrl(db) }));
    }
    if (booked && (timeChanged || techChanged)) tasks.push(call => sendTechInvite(db, call, call.technician_id, { baseUrl: appUrl(db) }));
  }
  if (!tasks.length) return;
  const id = row.id;
  queue(async () => {
    const call = get(db, 'service_calls', id); // fresh, with names and address, after the save is committed
    for (const t of tasks) await t(call);
  });
}

// ---------------------------------------------------------------- customer stages
/**
 * Move a customer to a pipeline stage and log it. With forwardOnly, a customer is
 * never moved backwards (e.g. an active customer booking a new install stays active).
 */
export function setStage(db, customerId, stage, { forwardOnly = false, user = null, reason = null } = {}) {
  if (!STAGES.includes(stage)) throw new HttpError(400, 'Unknown stage');
  const c = db.prepare('SELECT stage, status FROM customers WHERE id = ?').get(customerId);
  if (!c || c.stage === stage) return false;
  if (forwardOnly) {
    const from = STAGES.indexOf(c.stage), to = STAGES.indexOf(stage);
    if (c.stage === 'active' || (c.stage !== 'lost' && from >= to)) return false;
  }
  db.prepare(`UPDATE customers SET stage = ?, status = CASE WHEN ? = 'active' THEN 'active' WHEN ? = 'lost' AND status = 'prospect' THEN 'inactive' ELSE status END,
    updated_at = datetime('now','localtime') WHERE id = ?`).run(stage, stage, stage, customerId);
  db.prepare('INSERT INTO customer_stage_log (customer_id, from_stage, to_stage, user_name, reason) VALUES (?,?,?,?,?)')
    .run(customerId, c.stage, stage, user?.name ?? null, reason);
  return true;
}

// ---------------------------------------------------------------- stock
export function adjustStock(db, { itemId, locationId, delta, kind, note, serviceCallId, userId, allowNegative = false }) {
  locationId = Number(locationId) || 0;
  const cur = db.prepare('SELECT qty FROM stock WHERE item_id = ? AND location_id = ?').get(itemId, locationId)?.qty || 0;
  if (!allowNegative && cur + delta < 0) {
    const item = db.prepare('SELECT name FROM inventory_items WHERE id = ?').get(itemId);
    throw new HttpError(400, `Only ${cur} of "${item?.name}" on hand at that location`);
  }
  db.prepare(`INSERT INTO stock(item_id, location_id, qty) VALUES (?,?,?)
    ON CONFLICT(item_id, location_id) DO UPDATE SET qty = qty + excluded.qty`).run(itemId, locationId, delta);
  db.prepare(`INSERT INTO stock_movements(item_id, from_location, to_location, qty, kind, note, service_call_id, user_id)
    VALUES (?,?,?,?,?,?,?,?)`).run(itemId, delta < 0 ? locationId : null, delta > 0 ? locationId : null, Math.abs(delta), kind, note ?? null, serviceCallId ?? null, userId ?? null);
}

// ---------------------------------------------------------------- invoices
export function recalcInvoice(db, invoiceId) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!inv) return;
  const items = db.prepare('SELECT qty, unit_price, taxable FROM invoice_items WHERE invoice_id = ?').all(invoiceId);
  const subtotal = round2(items.reduce((s, i) => s + (i.qty || 0) * (i.unit_price || 0), 0));
  const taxableBase = items.filter(i => i.taxable).reduce((s, i) => s + (i.qty || 0) * (i.unit_price || 0), 0);
  const tax = round2(taxableBase * (Number(inv.tax_rate) || 0) / 100);
  const total = round2(subtotal + tax);
  const paid = round2(db.prepare('SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE invoice_id = ?').get(invoiceId).s);
  let status = inv.status;
  if (status !== 'void') {
    if (total > 0 && paid >= total) status = 'paid';
    else if (paid > 0) status = 'partial';
    else if (status === 'paid' || status === 'partial') status = 'sent';
  }
  db.prepare("UPDATE invoices SET subtotal = ?, tax = ?, total = ?, status = ?, updated_at = datetime('now','localtime') WHERE id = ?")
    .run(subtotal, tax, total, status, invoiceId);
}

function applyMaintenanceDefaults(table, data, existing, body) {
  for (const m of Object.values(MAINTENANCE)) {
    if (m.table !== table || !m.last) continue;
    const last = data[m.last];
    if (!last || last === existing?.[m.last]) continue;
    const dueGiven = body[m.due] && body[m.due] !== existing?.[m.due];
    if (dueGiven) continue;
    const src = { ...existing, ...data };
    if (m.intervalYearsField) {
      const yrs = Number(src[m.intervalYearsField]) || 12;
      data[m.due] = addMonths(last, yrs * 12);
    } else {
      const months = m.intervalMonths || Number(src[m.intervalField]) || 12;
      data[m.due] = addMonths(last, months);
    }
  }
}

/**
 * Extinguisher service dates (NFPA 10 rules of thumb; confirm with the current edition and your AHJ):
 *  - stored-pressure dry chemical: 6-year maintenance, counted from the last 6-year, the last hydro, or manufacture
 *  - hydro test: from the last hydro, else from manufacture (5 or 12 years by type)
 *  - disposable (non-rechargeable): no 6-year or hydro; replace 12 years after manufacture
 * Dates typed in by hand are kept.
 */
export function extinguisherDates(d, existing, body = {}) {
  const x = { ...existing, ...d };
  const given = k => k in body && body[k] !== existing?.[k];
  const yearsFrom = (date, y) => (date ? addMonths(date, y * 12) : null);
  const disposable = x.pressure_type === 'disposable';
  const dryChem = /dry chemical/i.test(x.ext_type || '');
  if (!given('next_6yr')) {
    d.next_6yr = !disposable && dryChem && x.pressure_type !== 'cartridge operated'
      ? yearsFrom([x.last_6yr, x.last_hydro, x.manufacture_date].filter(Boolean).sort().pop(), 6) : null;
  }
  if (!given('next_hydro')) {
    if (disposable) d.next_hydro = null;
    else if (!x.last_hydro && x.manufacture_date) d.next_hydro = yearsFrom(x.manufacture_date, Number(x.hydro_interval_years) || 12);
  }
  if (!given('replace_by')) d.replace_by = disposable && x.manufacture_date ? yearsFrom(x.manufacture_date, 12) : null;
}

// ---------------------------------------------------------------- hooks
const HOOKS = {
  technicians: {
    beforeSave(db, data, { isCreate }) {
      if (isCreate) data.calendar_token = randomBytes(18).toString('base64url');
    },
  },
  customers: {
    beforeSave(db, data, { existing }) {
      if (existing && data.parent_id && data.parent_id === existing.id) throw new HttpError(400, 'An account cannot be its own parent');
      if (existing && data.parent_id) {
        // No loops: walk up the parent chain.
        let p = data.parent_id;
        for (let i = 0; p && i < 20; i++) {
          if (p === existing.id) throw new HttpError(400, 'That would make a loop of parent accounts');
          p = db.prepare('SELECT parent_id FROM customers WHERE id = ?').get(p)?.parent_id;
        }
      }
      if (data.stage === 'active') data.status = 'active';
    },
    afterSave(db, row, { existing, user }) {
      if (!existing || existing.stage !== row.stage) {
        db.prepare('INSERT INTO customer_stage_log (customer_id, from_stage, to_stage, user_name, reason) VALUES (?,?,?,?,?)')
          .run(row.id, existing?.stage ?? null, row.stage, user?.name ?? null, existing ? 'changed by hand' : 'created');
      }
    },
  },
  invoices: {
    beforeSave(db, data, { isCreate, existing }) {
      const s = getSettings(db);
      if (isCreate) {
        data.number = nextNumber(db, 'invoice_next_number');
        data.issue_date ||= todayLocal();
        if (data.tax_rate == null) {
          const cust = db.prepare('SELECT tax_exempt FROM customers WHERE id = ?').get(data.customer_id);
          data.tax_rate = cust?.tax_exempt ? 0 : Number(s.tax_rate) || 0;
        }
      }
      const issue = data.issue_date || existing?.issue_date;
      if (('due_date' in data || isCreate) && !data.due_date && issue) {
        data.due_date = addDays(issue, Number(s.payment_terms_days) || 30);
      }
    },
    afterSave(db, row) { recalcInvoice(db, row.id); },
    beforeDelete(db, row) {
      db.prepare('UPDATE service_calls SET invoice_id = NULL WHERE invoice_id = ?').run(row.id);
    },
  },
  invoice_items: {
    afterSave(db, row, { existing }) {
      recalcInvoice(db, row.invoice_id);
      if (existing && existing.invoice_id !== row.invoice_id) recalcInvoice(db, existing.invoice_id);
    },
    afterDelete(db, row) { recalcInvoice(db, row.invoice_id); },
  },
  payments: {
    beforeSave(db, data, { existing }) {
      const invId = data.invoice_id ?? existing?.invoice_id;
      const inv = db.prepare('SELECT customer_id, status FROM invoices WHERE id = ?').get(invId);
      if (!inv) throw new HttpError(400, 'Invoice not found');
      if (inv.status === 'void') throw new HttpError(400, 'Cannot record a payment on a void invoice');
      data.customer_id = inv.customer_id;
      if ('amount' in data && !(data.amount > 0)) throw new HttpError(400, 'Amount must be greater than zero');
    },
    afterSave(db, row, { existing }) {
      recalcInvoice(db, row.invoice_id);
      if (existing && existing.invoice_id !== row.invoice_id) recalcInvoice(db, existing.invoice_id);
    },
    afterDelete(db, row) { recalcInvoice(db, row.invoice_id); },
  },
  service_calls: {
    beforeSave(db, data, { isCreate, existing, user, body }) {
      if (isCreate) {
        data.number = nextNumber(db, 'call_next_number');
        if (data.labor_rate == null) {
          const tech = data.technician_id && db.prepare('SELECT bill_rate FROM technicians WHERE id = ?').get(data.technician_id);
          data.labor_rate = tech?.bill_rate || Number(getSettings(db).default_labor_rate) || null;
        }
      }
      const merged = { ...existing, ...data };
      // Double-booking check: only when the tech, time, length or status changes.
      const touched = isCreate || ['technician_id', 'scheduled_start', 'duration_hours', 'status'].some(k => k in data && data[k] !== existing?.[k]);
      if (touched && !isCreate) data.cal_sequence = (existing.cal_sequence || 0) + 1; // calendar apps need a new revision number
      if (touched && !body?.allow_conflict) {
        const clash = findConflict(db, { id: existing?.id, technician_id: merged.technician_id, scheduled_start: merged.scheduled_start, duration_hours: merged.duration_hours, status: merged.status });
        if (clash) {
          const canOverride = G.manage.includes(user?.role);
          const e = new HttpError(409, `Schedule conflict: ${clash.tech} is already booked ${clash.when} for SC-${clash.number} (${clash.customer}).`
            + (canOverride ? ' Choose another time or technician, or book anyway.' : ' Choose another time or technician.'));
          e.code = 'conflict';
          e.canOverride = canOverride;
          throw e;
        }
      }
      if (merged.status === 'new' && merged.technician_id && merged.scheduled_start) data.status = 'scheduled';
      if ('signature_waived' in data && !!data.signature_waived !== !!existing?.signature_waived) {
        if (!G.manage.includes(user?.role)) throw new HttpError(403, 'Only an owner or administrator can approve completing a job without the customer’s signature');
        data.signature_waived_by = data.signature_waived ? user.name : null;
      }
      if (isCreate && !data.signature_waived && db.prepare('SELECT no_signature_needed FROM customers WHERE id = ?').get(data.customer_id)?.no_signature_needed) {
        data.signature_waived = 1;
        data.signature_waived_by = 'Customer setting (nobody usually on site)';
      }
      if (data.status === 'completed' && existing?.status !== 'completed') enforceCompletionRules(db, { ...existing, ...data }, existing, user, body, data);
      if (data.status === 'completed' && !existing?.completed_at) data.completed_at = nowLocal();
      if (data.status && data.status !== 'completed' && existing?.completed_at) data.completed_at = null;
    },
    afterSave(db, row, { existing, user, body }) {
      scheduleNotifications(db, row, existing, body);
      // Keep the customer's pipeline stage in step with the work.
      if (row.call_type === 'installation') {
        if (row.status === 'completed' && existing?.status !== 'completed') setStage(db, row.customer_id, 'active', { forwardOnly: true, user, reason: `Installation SC-${row.number} completed` });
        else if (row.scheduled_start && !['cancelled', 'completed'].includes(row.status)) setStage(db, row.customer_id, 'installation', { forwardOnly: true, user, reason: `Installation SC-${row.number} scheduled` });
      } else if (row.call_type === 'estimate' && row.scheduled_start && row.status !== 'cancelled') {
        setStage(db, row.customer_id, 'site survey', { forwardOnly: true, user, reason: `Site survey SC-${row.number} scheduled` });
      }
    },
  },
  service_call_parts: {
    beforeSave(db, data, { user }) {
      const item = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(data.item_id);
      if (!item) throw new HttpError(400, 'Item not found');
      const call = db.prepare('SELECT technician_id FROM service_calls WHERE id = ?').get(data.service_call_id);
      if (!call) throw new HttpError(400, 'Service call not found');
      if (!(data.qty > 0)) throw new HttpError(400, 'Quantity must be greater than zero');
      data.unit_cost = item.unit_cost ?? 0;
      if (data.unit_price == null) data.unit_price = item.unit_price ?? 0;
      if (data.location_id == null) {
        const veh = call.technician_id && db.prepare("SELECT id FROM vehicles WHERE assigned_technician_id = ? AND status = 'in service' ORDER BY id LIMIT 1").get(call.technician_id);
        data.location_id = veh?.id || 0;
      }
    },
    afterSave(db, row, { user }) {
      // Field usage may go negative: never block a tech from closing out a job.
      adjustStock(db, { itemId: row.item_id, locationId: row.location_id, delta: -row.qty, kind: 'used on job', serviceCallId: row.service_call_id, userId: user?.id, allowNegative: true });
      const item = db.prepare('SELECT name, sku, serialized, warranty_months FROM inventory_items WHERE id = ?').get(row.item_id);
      if (item?.serialized) {
        const call = db.prepare('SELECT customer_id, site_id FROM service_calls WHERE id = ?').get(row.service_call_id);
        const n = Math.min(Math.max(Math.round(row.qty), 0), 200);
        for (let i = 0; i < n; i++) {
          const e = create(db, 'installed_equipment', { customer_id: call.customer_id, site_id: call.site_id, item_id: row.item_id, description: item.name, model: item.sku, warranty_months: item.warranty_months, status: 'installed' }, { role: 'owner', name: user?.name });
          db.prepare('UPDATE installed_equipment SET service_call_id = ?, part_id = ? WHERE id = ?').run(row.service_call_id, row.id, e.id);
        }
      }
    },
    afterDelete(db, row, { user }) {
      adjustStock(db, { itemId: row.item_id, locationId: row.location_id, delta: row.qty, kind: 'returned from job', serviceCallId: row.service_call_id, userId: user?.id, allowNegative: true });
      db.prepare('DELETE FROM installed_equipment WHERE part_id = ?').run(row.id);
    },
  },
  purchase_invoices: {
    beforeDelete(db, row) {
      if (row.status === 'received') throw new HttpError(409, 'Received supplier invoices are kept for your records and cannot be deleted.');
    },
    afterDelete(db, row) {
      if (row.file_key) fs.rmSync(path.join(DATA_DIR, 'invoices', path.basename(row.file_key)), { force: true });
    },
  },
  installed_equipment: {
    beforeSave(db, d, o) {
      const x = { ...o.existing, ...d };
      if (('install_date' in d || 'warranty_months' in d) && !('warranty_expires' in o.body)) {
        d.warranty_expires = x.install_date && Number(x.warranty_months) > 0 ? addMonths(x.install_date, Number(x.warranty_months)) : null;
      }
      if (d.serial_number) {
        d.serial_number = String(d.serial_number).trim().toUpperCase();
        const dup = db.prepare("SELECT e.id, c.name FROM installed_equipment e JOIN customers c ON c.id = e.customer_id WHERE e.serial_number = ? AND e.id <> ? AND COALESCE(e.item_id, 0) = COALESCE(?, 0) AND e.status = 'installed'").get(d.serial_number, o.existing?.id || 0, x.item_id ?? null);
        if (dup) throw new HttpError(409, `Serial ${d.serial_number} is already recorded as installed at ${dup.name}. Check the number, or mark that one replaced/removed first.`);
      }
    },
  },
  camera_systems: { beforeSave: (db, d, o) => applyMaintenanceDefaults('camera_systems', d, o.existing, o.body) },
  alarm_systems: { beforeSave: (db, d, o) => applyMaintenanceDefaults('alarm_systems', d, o.existing, o.body) },
  fire_systems: { beforeSave: (db, d, o) => applyMaintenanceDefaults('fire_systems', d, o.existing, o.body) },
  extinguishers: {
    beforeSave(db, d, o) {
      if (o.isCreate && !o.body.hydro_interval_years) {
        d.hydro_interval_years = /CO2|Water|Class K/.test(d.ext_type || '') ? 5 : 12;
      }
      applyMaintenanceDefaults('extinguishers', d, o.existing, o.body);
      extinguisherDates(d, o.existing, o.body);
    },
  },
};

/** Lets feature modules (proposals, portal…) add business rules for their own resources. */
export function registerHooks(name, hooks) {
  const cur = HOOKS[name] || {};
  const merged = { ...cur };
  for (const [k, fn] of Object.entries(hooks)) {
    const prev = cur[k];
    merged[k] = prev ? (...args) => { prev(...args); fn(...args); } : fn; // run both, existing first
  }
  HOOKS[name] = merged;
}
