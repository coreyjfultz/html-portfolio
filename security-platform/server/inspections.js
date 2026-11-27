// Fire inspection reports: fill in on the phone, complete with the customer's signature,
// then email a link to the customer and the fire marshal (AHJ). Completing a report updates
// the fire system's and each extinguisher's service dates, and can open a follow-up job for
// the deficiencies.
import crypto from 'node:crypto';
import { G } from '../public/js/schema.js';
import { REPORT_TYPES, UNIT_RESULTS, UNIT_SERVICES, RESULTS, allItems, deficiencies, unanswered, reportTypeForSystem } from '../public/js/inspections.js';
import { getSettings, tx, nextNumber } from './db.js';
import { HttpError, create, update, techCustomerIds, assertCustomerVisible, todayLocal, nowLocal, registerHooks } from './resources.js';
import { audit } from './security.js';
import { decodeImage, saveImage, sendImage } from './media.js';
import { queue, sendEmail, appUrl } from './notify.js';

const STAFF_WRITE = G.all; // techs fill them in; scoping limits them to their customers
const MANAGE = G.manage;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const json = (v, d) => { try { return JSON.parse(v); } catch { return d; } };

function rowOr404(db, id, user) {
  const r = db.prepare('SELECT * FROM inspection_reports WHERE id = ?').get(Number(id));
  if (!r) throw new HttpError(404, 'Report not found');
  assertCustomerVisible(db, user, r.customer_id);
  return r;
}
const parse = r => ({ ...r, checklist: json(r.checklist, {}), devices: json(r.devices, []), units: json(r.units, []), custom_items: json(r.custom_items, []) });

/** Everything needed to show or print a report. */
export function fullReport(db, r) {
  const x = parse(r);
  const s = getSettings(db);
  const t = REPORT_TYPES[x.report_type] || REPORT_TYPES.other;
  const customer = db.prepare('SELECT id, name, contact_name, email, phone, billing_address, service_address, city, state, zip FROM customers WHERE id = ?').get(x.customer_id);
  const site = x.site_id ? db.prepare('SELECT id, name, address, city, state, zip FROM locations WHERE id = ?').get(x.site_id) : null;
  const system = x.fire_system_id ? db.prepare('SELECT id, system_type, location, panel_brand, panel_model, device_count, ahj FROM fire_systems WHERE id = ?').get(x.fire_system_id) : null;
  return {
    ...x, type_label: t.label, standard: t.standard, template: t, items: allItems(x.report_type, x.custom_items),
    deficiency_list: deficiencies(x), result_label: RESULTS[x.result] || null,
    customer, site, system,
    company: { name: s.company_name, phone: s.company_phone, email: s.company_email, address: s.company_address, license: s.company_license, logo: !!s.logo_key },
  };
}

/** Units for an extinguisher report: every active extinguisher at the customer (or just this site). */
function unitRows(db, customerId, siteId) {
  return db.prepare(`SELECT id, tag_number, location, floor, ext_type, size, serial, manufacture_date, next_6yr, next_hydro, replace_by, pressure_type FROM extinguishers
    WHERE customer_id = ? AND status <> 'removed' ${siteId ? 'AND (site_id = ? OR site_id IS NULL)' : ''} ORDER BY floor, location, id`).all(customerId, ...(siteId ? [siteId] : []))
    .map(e => {
      const today = todayLocal();
      const due = [e.next_6yr && e.next_6yr <= today && '6-year', e.next_hydro && e.next_hydro <= today && 'hydro'].filter(Boolean);
      return { extinguisher_id: e.id, label: [e.tag_number && `#${e.tag_number}`, e.size, e.ext_type].filter(Boolean).join(' '), location: [e.floor, e.location].filter(Boolean).join(' — '),
        due, replace_due: !!(e.replace_by && e.replace_by <= today), result: '', services: ['annual'], note: '' };
    });
}

export function createReport(db, body, user) {
  const customer = db.prepare('SELECT id, name, contact_name, email FROM customers WHERE id = ?').get(Number(body.customer_id));
  if (!customer) throw new HttpError(400, 'Choose a customer');
  assertCustomerVisible(db, user, customer.id);
  const system = body.fire_system_id ? db.prepare('SELECT * FROM fire_systems WHERE id = ? AND customer_id = ?').get(Number(body.fire_system_id), customer.id) : null;
  if (body.fire_system_id && !system) throw new HttpError(400, 'That system belongs to a different customer');
  const type = REPORT_TYPES[body.report_type] ? body.report_type : system ? reportTypeForSystem(system.system_type) : null;
  if (!type) throw new HttpError(400, 'Choose what is being inspected');
  const t = REPORT_TYPES[type];
  const siteId = Number(body.site_id) || system?.site_id || null;
  if (siteId && !db.prepare('SELECT 1 FROM locations WHERE id = ? AND customer_id = ?').get(siteId, customer.id)) throw new HttpError(400, 'That location belongs to a different customer');
  const callId = Number(body.service_call_id) || null;
  if (callId && !db.prepare('SELECT 1 FROM service_calls WHERE id = ? AND customer_id = ?').get(callId, customer.id)) throw new HttpError(400, 'That job belongs to a different customer');
  // Carry the device list over from the last report on this system, so next year is quick.
  const last = system ? db.prepare("SELECT devices FROM inspection_reports WHERE fire_system_id = ? AND status <> 'draft' ORDER BY inspection_date DESC, id DESC LIMIT 1").get(system.id) : null;
  const devices = t.devices ? json(last?.devices, []).map(d => ({ type: d.type, location: d.location, address: d.address || '', result: '', note: '' })) : [];
  const tech = user.technician_id ? db.prepare('SELECT name FROM technicians WHERE id = ?').get(user.technician_id) : null;
  const s = getSettings(db);
  return tx(db, () => {
    const id = Number(db.prepare(`INSERT INTO inspection_reports (number, token, customer_id, site_id, service_call_id, fire_system_id, report_type, frequency, inspection_date,
        inspector_name, inspector_license, technician_id, ahj, ahj_email, contact_name, contact_email, devices, units, created_by, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'))`).run(
      Number(nextNumber(db, 'inspection_next_number')), crypto.randomBytes(24).toString('base64url'), customer.id, siteId, callId, system?.id || null, type,
      t.frequencies.includes(body.frequency) ? body.frequency : t.frequencies[0], DATE.test(body.inspection_date || '') ? body.inspection_date : todayLocal(),
      tech?.name || user.name, s.inspector_license || null, user.technician_id || null, system?.ahj || null, null, customer.contact_name || customer.name, customer.email || null,
      JSON.stringify(devices), JSON.stringify(t.units ? unitRows(db, customer.id, siteId) : []), user.name).lastInsertRowid);
    audit(db, user, 'start inspection report', 'customers', customer.id, `${t.label}`);
    return id;
  });
}

const EDITABLE = ['inspection_date', 'frequency', 'inspector_name', 'inspector_license', 'ahj', 'ahj_email', 'contact_name', 'contact_email', 'notes', 'recommendations'];
function saveDraft(db, r, body, user) {
  if (r.status !== 'draft') throw new HttpError(409, 'This report is completed and locked. An administrator can reopen it.');
  const sets = [], vals = [];
  for (const k of EDITABLE) if (k in body) {
    let v = body[k] == null ? null : String(body[k]).slice(0, k === 'notes' || k === 'recommendations' ? 5000 : 200);
    if (k === 'inspection_date' && !DATE.test(v || '')) throw new HttpError(400, 'Invalid date');
    if (k === 'frequency' && !(REPORT_TYPES[r.report_type]?.frequencies || []).includes(v)) throw new HttpError(400, 'Invalid frequency');
    if (k === 'ahj_email' && v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) throw new HttpError(400, 'Check the fire marshal’s email address');
    sets.push(`${k} = ?`); vals.push(v);
  }
  if (body.checklist && typeof body.checklist === 'object') {
    const ids = new Set(allItems(r.report_type, body.custom_items || json(r.custom_items, [])).map(i => i.id));
    const clean = {};
    for (const [k, a] of Object.entries(body.checklist)) {
      if (!ids.has(k) || !a) continue;
      clean[k] = { r: ['pass', 'fail', 'na'].includes(a.r) ? a.r : '', v: String(a.v || '').slice(0, 120), note: String(a.note || '').slice(0, 500) };
    }
    sets.push('checklist = ?'); vals.push(JSON.stringify(clean));
  }
  if (Array.isArray(body.custom_items)) {
    sets.push('custom_items = ?');
    vals.push(JSON.stringify(body.custom_items.slice(0, 50).map((c, i) => ({ id: /^c_[a-z0-9]{1,12}$/.test(c.id) ? c.id : `c_${i}`, text: String(c.text || '').slice(0, 200), kind: c.kind === 'value' ? 'value' : 'pf' })).filter(c => c.text)));
  }
  if (Array.isArray(body.devices)) {
    sets.push('devices = ?');
    vals.push(JSON.stringify(body.devices.slice(0, 2000).map(d => ({ type: String(d.type || 'Other').slice(0, 40), location: String(d.location || '').slice(0, 120), address: String(d.address || '').slice(0, 30), result: ['pass', 'fail', 'na'].includes(d.result) ? d.result : '', note: String(d.note || '').slice(0, 300) }))));
  }
  if (Array.isArray(body.units)) {
    const mine = new Set(db.prepare('SELECT id FROM extinguishers WHERE customer_id = ?').all(r.customer_id).map(e => e.id));
    sets.push('units = ?');
    vals.push(JSON.stringify(body.units.filter(u => mine.has(Number(u.extinguisher_id))).slice(0, 1000).map(u => ({
      extinguisher_id: Number(u.extinguisher_id), label: String(u.label || '').slice(0, 80), location: String(u.location || '').slice(0, 120), due: Array.isArray(u.due) ? u.due.slice(0, 3) : [], replace_due: !!u.replace_due,
      result: UNIT_RESULTS[u.result] ? u.result : '', services: (Array.isArray(u.services) ? u.services : []).filter(x => UNIT_SERVICES[x]),
      new_serial: String(u.new_serial || '').slice(0, 60), new_manufacture_date: DATE.test(u.new_manufacture_date || '') ? u.new_manufacture_date : '', note: String(u.note || '').slice(0, 300),
    }))));
  }
  if (!sets.length) return;
  db.prepare(`UPDATE inspection_reports SET ${sets.join(', ')}, updated_at = datetime('now','localtime') WHERE id = ?`).run(...vals, r.id);
}

/** Lock the report and apply it: system & extinguisher dates, history, follow-up job. */
export function completeReport(db, r, body, user, ip) {
  if (r.status !== 'draft') throw new HttpError(409, 'Already completed');
  const x = parse(r);
  const missing = unanswered(x);
  if (missing.length) throw Object.assign(new HttpError(400, `Still to answer (${missing.length}): ${missing.slice(0, 4).join('; ')}${missing.length > 4 ? '…' : ''}`), { code: 'incomplete' });
  if (!String(x.inspector_name || '').trim()) throw new HttpError(400, 'Enter the inspector’s name');
  const defs = deficiencies(x);
  const result = defs.length ? (body.result === 'fail' ? 'fail' : 'deficiencies') : 'pass';
  const name = String(body.signed_by || '').trim();
  const sig = body.signature ? decodeImage(body.signature, { maxBytes: 1024 * 1024, allowed: ['image/png'] }) : null;
  if (sig && name.length < 2) throw new HttpError(400, 'Enter the name of the person signing');
  return tx(db, () => {
    const key = sig ? saveImage('signatures', sig) : null;
    const date = x.inspection_date;
    // Fire system: last inspection = this one (the hooks set the next due date)
    if (x.fire_system_id) update(db, 'fire_systems', x.fire_system_id, { last_inspection: date }, { ...user, role: 'owner' });
    // Extinguishers
    for (const u of x.units) {
      const e = db.prepare('SELECT * FROM extinguishers WHERE id = ?').get(u.extinguisher_id);
      if (!e) continue;
      const data = {};
      if (u.result === 'removed') data.status = 'removed';
      else if (u.result === 'missing') data.status = 'out of service';
      else if (u.result === 'fail') { data.status = 'needs service'; data.last_annual = date; }
      else {
        data.status = 'in service';
        data.last_annual = date;
        if (u.services.includes('6-year')) data.last_6yr = date;
        if (u.services.includes('hydro')) data.last_hydro = date;
        if (u.services.includes('recharge')) data.last_recharge = date;
        if (u.result === 'replaced') {
          // Same spot, new cylinder: reset its dates from the new unit's manufacture date.
          Object.assign(data, { serial: u.new_serial || null, manufacture_date: u.new_manufacture_date || date, last_6yr: null, last_hydro: null, last_recharge: null, next_hydro: null });
        }
      }
      update(db, 'extinguishers', e.id, data, { ...user, role: 'owner' });
      db.prepare('INSERT INTO extinguisher_events (extinguisher_id, event_date, kind, result, services, note, report_id, user_name) VALUES (?,?,?,?,?,?,?,?)')
        .run(e.id, date, 'inspection', u.result, u.services.join(', '), [u.result === 'replaced' && e.serial ? `Replaced unit S/N ${e.serial}` : '', u.note].filter(Boolean).join(' — ') || null, x.id, x.inspector_name);
    }
    // Follow-up job for the deficiencies
    let followup = null;
    if (defs.length && body.create_followup) {
      followup = create(db, 'service_calls', {
        customer_id: x.customer_id, site_id: x.site_id, title: `Correct deficiencies — FIR-${x.number}`, call_type: 'service', system_type: x.report_type === 'extinguishers' ? 'extinguisher' : 'fire alarm',
        priority: result === 'fail' ? 'high' : 'normal', status: 'new',
        description: `From ${REPORT_TYPES[x.report_type].label} inspection FIR-${x.number} on ${date}:\n${defs.map(d => `• ${d.what}${d.where ? ` (${d.where})` : ''}${d.note ? ` — ${d.note}` : ''}`).join('\n')}`,
      }, user).id;
    }
    db.prepare(`UPDATE inspection_reports SET status = 'completed', result = ?, signed_by = ?, signed_at = ?, signature_key = ?, completed_at = ?, completed_by = ?, followup_call_id = ?,
      updated_at = datetime('now','localtime') WHERE id = ?`).run(result, sig ? name.slice(0, 120) : null, sig ? nowLocal() : null, key, nowLocal(), user.name, followup, x.id);
    audit(db, user, 'complete inspection report', 'customers', x.customer_id, `FIR-${x.number} ${result}${sig ? `, signed by ${name} from ${ip}` : ''}`);
    return { ok: true, result, followup_call_id: followup };
  });
}

export async function sendReport(db, r, body, user) {
  if (r.status === 'draft') throw new HttpError(400, 'Complete the report first');
  const to = [...new Set((Array.isArray(body.to) ? body.to : [body.to]).map(e => String(e || '').trim().toLowerCase()).filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))].slice(0, 6);
  if (!to.length) throw new HttpError(400, 'Add at least one email address');
  const f = fullReport(db, r);
  const link = `${appUrl(db)}/report/${r.token}`;
  const where = f.site ? `${f.site.name}, ${[f.site.address, f.site.city].filter(Boolean).join(', ')}` : [f.customer.service_address || f.customer.billing_address, f.customer.city].filter(Boolean).join(', ');
  const text = `${f.type_label} inspection report FIR-${f.number}\n${f.customer.name}${where ? `\n${where}` : ''}\nInspected ${f.inspection_date} by ${f.inspector_name}${f.inspector_license ? ` (license ${f.inspector_license})` : ''}\n\nResult: ${f.result_label}${f.deficiency_list.length ? `\n\nDeficiencies:\n${f.deficiency_list.map(d => `• ${d.what}${d.where ? ` (${d.where})` : ''}${d.note ? ` — ${d.note}` : ''}`).join('\n')}` : ''}\n\nView or print the full report:\n${link}\n\n${f.company.name}${f.company.phone ? ` · ${f.company.phone}` : ''}`;
  for (const addr of to) {
    queue(() => sendEmail(db, { to: addr, subject: `Inspection report FIR-${f.number} — ${f.customer.name} (${f.result_label})`, text, related: { type: 'inspection', id: r.id } }));
  }
  db.prepare("UPDATE inspection_reports SET status = 'sent', sent_at = ?, sent_to = ? WHERE id = ?").run(nowLocal(), to.join(', '), r.id);
  audit(db, user, 'send inspection report', 'customers', r.customer_id, `FIR-${r.number} to ${to.join(', ')}`);
  return { ok: true, to };
}

// Kitchen and special-hazard suppression are inspected every 6 months by default.
registerHooks('fire_systems', {
  beforeSave(db, data, { isCreate, body }) {
    if (isCreate && !body.inspection_interval_months && /suppression/.test(data.system_type || '')) data.inspection_interval_months = 6;
  },
});

export function registerInspectionRoutes(r) {
  r('GET', '/api/inspections', G.all, ({ db, user, query }) => {
    const where = [], params = [];
    if (query.customer_id) { where.push('i.customer_id = ?'); params.push(Number(query.customer_id)); }
    if (query.status) { where.push('i.status = ?'); params.push(String(query.status)); }
    if (query.fire_system_id) { where.push('i.fire_system_id = ?'); params.push(Number(query.fire_system_id)); }
    if (query.service_call_id) { where.push('i.service_call_id = ?'); params.push(Number(query.service_call_id)); }
    const ids = techCustomerIds(db, user);
    if (ids) { where.push(`i.customer_id IN (${[...ids].map(() => '?').join(',') || 'NULL'})`); params.push(...ids); }
    return db.prepare(`SELECT i.id, i.number, i.customer_id, i.site_id, i.fire_system_id, i.service_call_id, i.report_type, i.frequency, i.status, i.result, i.inspection_date, i.inspector_name, i.sent_at, i.ahj,
        c.name AS customer, l.name AS site FROM inspection_reports i JOIN customers c ON c.id = i.customer_id LEFT JOIN locations l ON l.id = i.site_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY i.inspection_date DESC, i.id DESC LIMIT 500`).all(...params)
      .map(i => ({ ...i, type_label: REPORT_TYPES[i.report_type]?.label || i.report_type, result_label: RESULTS[i.result] || null }));
  });
  r('POST', '/api/inspections', STAFF_WRITE, ({ db, body, user }) => ({ id: createReport(db, body, user) }));
  r('GET', '/api/inspections/:id', G.all, ({ db, params, user }) => fullReport(db, rowOr404(db, params.id, user)));
  r('PUT', '/api/inspections/:id', STAFF_WRITE, ({ db, params, body, user }) => {
    const row = rowOr404(db, params.id, user);
    saveDraft(db, row, body, user);
    return fullReport(db, rowOr404(db, params.id, user));
  });
  r('POST', '/api/inspections/:id/refresh-units', STAFF_WRITE, ({ db, params, user }) => {
    // Pick up extinguishers added during the walk-through, keeping answers already given.
    const row = rowOr404(db, params.id, user);
    if (row.status !== 'draft') throw new HttpError(409, 'This report is completed and locked');
    const have = new Map(json(row.units, []).map(u => [u.extinguisher_id, u]));
    const units = unitRows(db, row.customer_id, row.site_id).map(u => have.get(u.extinguisher_id) || u);
    db.prepare('UPDATE inspection_reports SET units = ? WHERE id = ?').run(JSON.stringify(units), row.id);
    return fullReport(db, rowOr404(db, params.id, user));
  });
  r('POST', '/api/inspections/:id/complete', STAFF_WRITE, ({ db, params, body, user, ip }) => completeReport(db, rowOr404(db, params.id, user), body, user, ip));
  r('POST', '/api/inspections/:id/reopen', MANAGE, ({ db, params, body, user }) => {
    const row = rowOr404(db, params.id, user);
    const reason = String(body.reason || '').trim();
    if (!reason) throw new HttpError(400, 'Give a reason for reopening');
    db.prepare("UPDATE inspection_reports SET status = 'draft', reopened_reason = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(`${user.name}: ${reason}`.slice(0, 300), row.id);
    audit(db, user, 'reopen inspection report', 'customers', row.customer_id, `FIR-${row.number}: ${reason}`);
    return { ok: true };
  });
  r('DELETE', '/api/inspections/:id', MANAGE, ({ db, params, user }) => {
    const row = rowOr404(db, params.id, user);
    if (row.status !== 'draft') throw new HttpError(409, 'Completed reports are kept for your records');
    db.prepare('DELETE FROM inspection_reports WHERE id = ?').run(row.id);
    audit(db, user, 'delete inspection draft', 'customers', row.customer_id, `FIR-${row.number}`);
    return { ok: true };
  });
  r('POST', '/api/inspections/:id/send', G.all, async ({ db, params, body, user }) => sendReport(db, rowOr404(db, params.id, user), body, user));
  r('GET', '/api/inspections/:id/signature', G.all, ({ db, params, user, res }) => {
    const row = rowOr404(db, params.id, user);
    if (!row.signature_key) throw new HttpError(404, 'Not signed');
    sendImage(res, 'signatures', row.signature_key, { cache: 'private, no-cache' });
    return undefined;
  });
  r('GET', '/api/extinguishers/:id/history', G.all, ({ db, params, user }) => {
    const e = db.prepare('SELECT customer_id FROM extinguishers WHERE id = ?').get(Number(params.id));
    if (!e) throw new HttpError(404, 'Not found');
    assertCustomerVisible(db, user, e.customer_id);
    return db.prepare(`SELECT h.*, i.number AS report_number FROM extinguisher_events h LEFT JOIN inspection_reports i ON i.id = h.report_id
      WHERE h.extinguisher_id = ? ORDER BY h.event_date DESC, h.id DESC`).all(Number(params.id));
  });

  // Public link (customer / fire marshal): read-only, unguessable token.
  const byToken = (db, token) => {
    const row = /^[A-Za-z0-9_-]{24,64}$/.test(token) && db.prepare("SELECT * FROM inspection_reports WHERE token = ? AND status <> 'draft'").get(token);
    if (!row) throw new HttpError(404, 'This report link is not valid');
    return row;
  };
  r('GET', '/api/public/report/:token', null, ({ db, params }) => {
    const f = fullReport(db, byToken(db, params.token));
    delete f.token; delete f.created_by; delete f.contact_email; delete f.signature_key;
    return f;
  });
  r('GET', '/api/public/report/:token/signature', null, ({ db, params, res }) => {
    const row = byToken(db, params.token);
    if (!row.signature_key) throw new HttpError(404, 'Not signed');
    sendImage(res, 'signatures', row.signature_key, { cache: 'private, no-cache' });
    return undefined;
  });
}
