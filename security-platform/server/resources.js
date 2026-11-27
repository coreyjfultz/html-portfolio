// Generic, schema-driven CRUD with business-rule hooks.
import { RESOURCES, MAINTENANCE, fieldDefault } from '../public/js/schema.js';
import { encrypt, decrypt, audit } from './security.js';
import { getSettings, nextNumber, tx } from './db.js';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const OFFICE = ['admin', 'office'];
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
    `(SELECT COALESCE(NULLIF(service_address,''), billing_address) || ', ' || COALESCE(NULLIF(service_city,''), city, '')
       FROM customers c WHERE c.id = t.customer_id) AS customer_address`,
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

export function getDef(name) {
  const def = RESOURCES[name];
  if (!def) throw new HttpError(404, 'Unknown resource');
  return def;
}

export function canRead(def, user) { return def.read.includes(user.role); }
export function canWrite(def, user) { return def.write.includes(user.role); }
function canDelete(name, def, user) {
  if (name === 'service_call_parts') return canWrite(def, user);
  return OFFICE.includes(user.role) && canWrite(def, user);
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
  if (name === 'service_calls' && user?.role === 'technician' && query.mine === '1' && user.technician_id) {
    where.push('t.technician_id = ?');
    params.push(user.technician_id);
  }
  const limit = Math.min(parseInt(query.limit, 10) || 1000, 5000);
  const sql = `${selectSql(name)} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${def.order || 't.id DESC'} LIMIT ${limit}`;
  return db.prepare(sql).all(...params).map(r => present(name, r));
}

export function get(db, name, id) {
  getDef(name);
  const row = db.prepare(`${selectSql(name)} WHERE t.id = ?`).get(Number(id));
  if (!row) throw new HttpError(404, 'Not found');
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
    const data = cleanInput(def, body, false, user);
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
  audit(db, user, 'reveal', name, Number(id), field);
  return { value: decrypt(row[field]) };
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

// ---------------------------------------------------------------- hooks
const HOOKS = {
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
    beforeSave(db, data, { isCreate, existing }) {
      if (isCreate) {
        data.number = nextNumber(db, 'call_next_number');
        if (data.labor_rate == null) {
          const tech = data.technician_id && db.prepare('SELECT bill_rate FROM technicians WHERE id = ?').get(data.technician_id);
          data.labor_rate = tech?.bill_rate || Number(getSettings(db).default_labor_rate) || null;
        }
      }
      const merged = { ...existing, ...data };
      if (merged.status === 'new' && merged.technician_id && merged.scheduled_start) data.status = 'scheduled';
      if (data.status === 'completed' && !existing?.completed_at) data.completed_at = nowLocal();
      if (data.status && data.status !== 'completed' && existing?.completed_at) data.completed_at = null;
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
    },
    afterDelete(db, row, { user }) {
      adjustStock(db, { itemId: row.item_id, locationId: row.location_id, delta: row.qty, kind: 'returned from job', serviceCallId: row.service_call_id, userId: user?.id, allowNegative: true });
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
    },
  },
};
