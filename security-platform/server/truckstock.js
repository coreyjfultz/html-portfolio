// Truck stock discipline and job materials:
//  * Standard truck stock (min / max per item) with per-vehicle exceptions, so every truck
//    carries the basics plus a spare or two — and not a pile of extras.
//  * Weekly truck counts (parts AND tools) with variance, alerts and restock / return lists.
//  * Job materials: equipment planned for a job, checked out of the warehouse onto the truck.
//  * Start-of-day readiness check: before the first job, the tech confirms they have what
//    today's jobs need. Only an administrator can let them skip it.
import { G } from '../public/js/schema.js';
import { getSettings, tx } from './db.js';
import { HttpError, adjustStock, registerHooks, todayLocal, round2 } from './resources.js';
import { audit } from './security.js';
import { raiseAlert } from './alerts.js';
import { queue, sendEmail, sendSms } from './notify.js';

const OFFICE = G.billing; // owner, admin, accounting run inventory
const MANAGE = G.manage;
const isOffice = u => OFFICE.includes(u?.role);

function vehicleOr404(db, id) {
  const v = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(Number(id));
  if (!v) throw new HttpError(404, 'Vehicle not found');
  return v;
}
/** Technicians may only count / load their own truck. */
function assertVehicleAccess(db, user, v) {
  if (isOffice(user) || user.role !== 'technician') return;
  if (!user.technician_id || v.assigned_technician_id !== user.technician_id) throw new HttpError(403, 'You can only do this for the vehicle assigned to you');
}
export const vehicleForTech = (db, techId) => techId
  ? db.prepare("SELECT * FROM vehicles WHERE assigned_technician_id = ? AND status = 'in service' ORDER BY id LIMIT 1").get(techId) : null;

// ---------------------------------------------------------------- par levels
/** Every item this truck should carry or does carry, with what's short and what's extra. */
export function truckStock(db, vehicleId) {
  const rows = db.prepare(`
    SELECT i.id AS item_id, i.name, i.sku, i.category, i.unit_cost, i.truck_min, i.truck_max,
      p.min_qty AS ov_min, p.max_qty AS ov_max, p.id AS exception_id,
      COALESCE((SELECT qty FROM stock s WHERE s.item_id = i.id AND s.location_id = ?), 0) AS on_hand,
      COALESCE((SELECT qty FROM stock s WHERE s.item_id = i.id AND s.location_id = 0), 0) AS warehouse_qty
    FROM inventory_items i LEFT JOIN truck_par p ON p.item_id = i.id AND p.vehicle_id = ?
    WHERE i.active = 1 OR EXISTS (SELECT 1 FROM stock s WHERE s.item_id = i.id AND s.location_id = ? AND s.qty <> 0)
    ORDER BY i.category, i.name`).all(vehicleId, vehicleId, vehicleId);
  const out = [];
  for (const r of rows) {
    const min = r.exception_id ? Number(r.ov_min) || 0 : Number(r.truck_min) || 0;
    const maxRaw = r.exception_id ? r.ov_max : r.truck_max;
    const max = maxRaw == null || maxRaw === '' ? (min > 0 ? min + 1 : 0) : Math.max(Number(maxRaw), min);
    if (!min && !r.on_hand) continue;
    const need = Math.max(0, min - r.on_hand);
    const extra = Math.max(0, r.on_hand - max);
    out.push({
      item_id: r.item_id, name: r.name, sku: r.sku, category: r.category, unit_cost: r.unit_cost,
      min, max, on_hand: r.on_hand, warehouse_qty: r.warehouse_qty, need, extra, exception_id: r.exception_id || null,
      standard: min > 0, status: r.on_hand < 0 ? 'negative' : need ? 'short' : extra ? 'extra' : min ? 'ok' : 'not standard',
    });
  }
  return out;
}

/** Items used from this truck recently that aren't on its standard list — candidates to add. */
function suggestions(db, vehicleId, stock) {
  const listed = new Set(stock.filter(s => s.standard).map(s => s.item_id));
  return db.prepare(`SELECT m.item_id, i.name, SUM(m.qty) AS used, COUNT(DISTINCT m.service_call_id) AS jobs
    FROM stock_movements m JOIN inventory_items i ON i.id = m.item_id
    WHERE m.kind = 'used on job' AND m.from_location = ? AND m.created_at > datetime('now','localtime','-90 days')
    GROUP BY m.item_id HAVING jobs >= 2 ORDER BY jobs DESC LIMIT 10`).all(vehicleId).filter(r => !listed.has(r.item_id));
}

// ---------------------------------------------------------------- weekly counts
export function countStatus(db) {
  const vehicles = db.prepare(`SELECT v.*, t.name AS tech_name FROM vehicles v LEFT JOIN technicians t ON t.id = v.assigned_technician_id
    WHERE v.status = 'in service' ORDER BY v.unit_name`).all();
  return vehicles.map(v => {
    const last = db.prepare('SELECT * FROM truck_counts WHERE vehicle_id = ? ORDER BY id DESC LIMIT 1').get(v.id);
    const stock = truckStock(db, v.id);
    const days = last ? Math.floor((Date.now() - new Date(last.created_at.replace(' ', 'T')).getTime()) / 86400e3) : null;
    return {
      vehicle_id: v.id, unit_name: v.unit_name, tech_name: v.tech_name, technician_id: v.assigned_technician_id,
      last_count: last?.created_at || null, last_by: last?.user_name || null, days_since: days, due: days == null || days >= 7,
      last_variance_lines: last?.variance_lines || 0, last_variance_value: last?.variance_value || 0, last_missing_tools: last?.missing_tools || 0,
      last_count_id: last?.id || null, reviewed: !!last?.reviewed_at,
      short: stock.filter(s => s.need).length, extra: stock.filter(s => s.extra).length,
      value: round2(stock.reduce((t, s) => t + Math.max(0, s.on_hand) * (s.unit_cost || 0), 0)),
    };
  });
}

export function countSheet(db, v) {
  const items = truckStock(db, v.id).map(s => ({ item_id: s.item_id, name: s.name, sku: s.sku, category: s.category, expected: s.on_hand, min: s.min, max: s.max }));
  const tools = db.prepare("SELECT id AS tool_id, name, tag, qty, status, category FROM tools WHERE vehicle_id = ? AND status <> 'retired' ORDER BY name").all(v.id);
  return { vehicle: { id: v.id, unit_name: v.unit_name }, items, tools };
}

export function submitCount(db, v, body, user) {
  const items = Array.isArray(body.items) ? body.items : [];
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const sheet = countSheet(db, v);
  const expected = new Map(sheet.items.map(i => [i.item_id, i]));
  const toolMap = new Map(sheet.tools.map(t => [t.tool_id, t]));
  // Every item and tool on the sheet must be counted — that's the point of the weekly check.
  const countedIds = new Set(items.map(i => Number(i.item_id)));
  const missingLines = sheet.items.filter(i => !countedIds.has(i.item_id));
  if (missingLines.length) throw new HttpError(400, `Count every item on the truck (${missingLines.length} not counted: ${missingLines.slice(0, 3).map(i => i.name).join(', ')}${missingLines.length > 3 ? '…' : ''})`);
  const toolIds = new Set(tools.map(t => Number(t.tool_id)));
  const missingTools = sheet.tools.filter(t => !toolIds.has(t.tool_id));
  if (missingTools.length) throw new HttpError(400, `Check off every tool (${missingTools.map(t => t.name).slice(0, 3).join(', ')} not checked)`);

  return tx(db, () => {
    const countId = Number(db.prepare('INSERT INTO truck_counts (vehicle_id, user_id, user_name, notes) VALUES (?,?,?,?)')
      .run(v.id, user.id, user.name, String(body.notes || '').slice(0, 1000) || null).lastInsertRowid);
    const line = db.prepare('INSERT INTO truck_count_lines (count_id, item_id, tool_id, name, expected, counted, unit_cost, condition) VALUES (?,?,?,?,?,?,?,?)');
    let varianceLines = 0, varianceUnits = 0, varianceValue = 0, toolProblems = 0;
    const variances = [];
    for (const raw of items) {
      const itemId = Number(raw.item_id);
      const counted = Number(raw.counted);
      if (!Number.isFinite(counted) || counted < 0) throw new HttpError(400, 'Counts must be zero or more');
      const item = db.prepare('SELECT id, name, unit_cost FROM inventory_items WHERE id = ?').get(itemId);
      if (!item) throw new HttpError(400, 'Unknown item in count');
      const exp = expected.get(itemId)?.expected ?? (db.prepare('SELECT qty FROM stock WHERE item_id = ? AND location_id = ?').get(itemId, v.id)?.qty || 0);
      line.run(countId, itemId, null, item.name, exp, counted, item.unit_cost, null);
      if (counted !== exp) {
        adjustStock(db, { itemId, locationId: v.id, delta: counted - exp, kind: 'weekly count', note: `Truck count by ${user.name}: counted ${counted}, expected ${exp}`, userId: user.id, allowNegative: true });
        varianceLines++; varianceUnits += counted - exp; varianceValue += (counted - exp) * (item.unit_cost || 0);
        variances.push(`${item.name}: ${counted} (expected ${exp})`);
      }
    }
    for (const raw of tools) {
      const t = toolMap.get(Number(raw.tool_id));
      if (!t) continue;
      const condition = ['ok', 'missing', 'needs repair'].includes(raw.condition) ? raw.condition : 'ok';
      line.run(countId, null, t.tool_id, t.name + (t.tag ? ` #${t.tag}` : ''), t.qty, condition === 'missing' ? 0 : t.qty, null, condition);
      const status = condition === 'missing' ? 'missing' : condition === 'needs repair' ? 'needs repair' : t.status === 'missing' ? 'in service' : t.status;
      db.prepare('UPDATE tools SET last_counted = ?, status = ? WHERE id = ?').run(todayLocal(), status, t.tool_id);
      if (condition !== 'ok') { toolProblems++; variances.push(`Tool ${t.name}${t.tag ? ` #${t.tag}` : ''}: ${condition}`); }
    }
    db.prepare('UPDATE truck_counts SET lines = ?, variance_lines = ?, variance_units = ?, variance_value = ?, missing_tools = ? WHERE id = ?')
      .run(items.length + tools.length, varianceLines, round2(varianceUnits), round2(varianceValue), toolProblems, countId);
    audit(db, user, 'truck count', 'vehicles', v.id, `${varianceLines} variances, ${toolProblems} tool issues`);
    if (varianceLines || toolProblems) {
      const mgr = Number(getSettings(db).inventory_manager_id) || null;
      raiseAlert(db, {
        kind: 'truck_count', severity: toolProblems || Math.abs(varianceValue) >= 100 ? 'bad' : 'warn',
        title: `${v.unit_name} count: ${varianceLines} item${varianceLines === 1 ? '' : 's'} off${toolProblems ? `, ${toolProblems} tool issue${toolProblems === 1 ? '' : 's'}` : ''} (${round2(varianceValue) < 0 ? '-' : ''}$${Math.abs(round2(varianceValue)).toFixed(2)})`,
        body: `Counted by ${user.name}.\n${variances.slice(0, 15).join('\n')}${variances.length > 15 ? `\n…and ${variances.length - 15} more` : ''}`,
        link: `#/vehicles/${v.id}?count=${countId}`, roles: 'owner,admin,accounting', alsoUserIds: mgr ? [mgr] : [],
      });
    }
    const stock = truckStock(db, v.id);
    return { id: countId, variance_lines: varianceLines, variance_value: round2(varianceValue), tool_issues: toolProblems, restock: stock.filter(s => s.need), extras: stock.filter(s => s.extra) };
  });
}

/** Move stock between the warehouse and a truck in one go (restock to standard, or return extras). */
function moveBatch(db, v, { direction, lines, note, serviceCallId }, user) {
  const stock = truckStock(db, v.id);
  if (!Array.isArray(lines) || !lines.length) {
    lines = direction === 'load'
      ? stock.filter(s => s.need && s.warehouse_qty > 0).map(s => ({ item_id: s.item_id, qty: Math.min(s.need, s.warehouse_qty) }))
      : stock.filter(s => s.extra).map(s => ({ item_id: s.item_id, qty: s.extra }));
  }
  const from = direction === 'load' ? 0 : v.id, to = direction === 'load' ? v.id : 0;
  return tx(db, () => {
    let n = 0;
    for (const l of lines) {
      const qty = Number(l.qty);
      if (!(qty > 0)) continue;
      const itemId = Number(l.item_id);
      if (!db.prepare('SELECT 1 FROM inventory_items WHERE id = ?').get(itemId)) throw new HttpError(400, 'Unknown item');
      const kind = direction === 'load' ? 'restock truck' : 'returned to warehouse';
      adjustStock(db, { itemId, locationId: from, delta: -qty, kind, note: note || `${v.unit_name}`, serviceCallId, userId: user.id });
      adjustStock(db, { itemId, locationId: to, delta: qty, kind, note: note || `${v.unit_name}`, serviceCallId, userId: user.id });
      n++;
    }
    return { moved: n };
  });
}

/** Hourly: remind techs on count day, and flag trucks that are overdue. */
export function truckCountReminders(db, now = new Date()) {
  const s = getSettings(db);
  if (s.truck_count_reminders !== '1') return;
  const day = Number(s.truck_count_day ?? 5);
  if (now.getHours() < 8) return;
  for (const v of countStatus(db)) {
    if (!v.due || !v.technician_id) continue;
    if (now.getDay() === day) {
      const sent = db.prepare("SELECT 1 FROM notifications WHERE related_type = 'truck_count' AND related_id = ? AND created_at >= ?").get(v.vehicle_id, todayLocal().replace('T', ' '));
      if (sent) continue;
      const tech = db.prepare('SELECT name, phone, email FROM technicians WHERE id = ?').get(v.technician_id);
      const text = `Weekly truck count is due for ${v.unit_name}. Open SecureOps → My day → Weekly truck count. It takes about 10 minutes.`;
      const related = { type: 'truck_count', id: v.vehicle_id };
      queue(async () => {
        if (tech?.phone) await sendSms(db, { to: tech.phone, body: text, related });
        else await sendEmail(db, { to: tech?.email, subject: `Weekly truck count — ${v.unit_name}`, text, related });
      });
    } else if (v.days_since == null || v.days_since >= 8) {
      raiseAlert(db, { kind: 'count_overdue', title: `${v.unit_name} truck count is overdue`, body: v.last_count ? `Last counted ${v.days_since} days ago by ${v.last_by}.` : 'This truck has never been counted.', link: `#/vehicles/${v.vehicle_id}`, dedupeHours: 24 * 6, roles: 'owner,admin,accounting', notify: false });
    }
  }
}

// ---------------------------------------------------------------- job materials
function callOr404(db, id) {
  const c = db.prepare('SELECT * FROM service_calls WHERE id = ?').get(Number(id));
  if (!c) throw new HttpError(404, 'Service call not found');
  return c;
}
function materialsFor(db, callId) {
  return db.prepare(`SELECT m.*, i.name, i.sku,
      COALESCE((SELECT qty FROM stock s WHERE s.item_id = m.item_id AND s.location_id = 0), 0) AS warehouse_qty
    FROM job_materials m JOIN inventory_items i ON i.id = m.item_id WHERE m.service_call_id = ? ORDER BY m.id`).all(callId);
}

/** Pick materials from the warehouse onto the truck of the tech doing the job. */
export function checkoutMaterials(db, call, body, user) {
  const v = body.vehicle_id ? vehicleOr404(db, body.vehicle_id) : vehicleForTech(db, call.technician_id);
  if (!v) throw new HttpError(400, call.technician_id ? 'The assigned technician has no vehicle. Assign one under Vehicles, or choose a vehicle.' : 'Assign a technician first so we know which truck to load.');
  const wanted = Array.isArray(body.lines) && body.lines.length ? new Map(body.lines.map(l => [Number(l.id), Number(l.qty)])) : null;
  return tx(db, () => {
    let n = 0;
    for (const m of materialsFor(db, call.id)) {
      if (m.status === 'returned') continue;
      const remaining = m.qty - (m.checked_out_qty || 0);
      const qty = wanted ? Math.min(wanted.get(m.id) || 0, Math.max(remaining, 0)) : remaining;
      if (!(qty > 0)) continue;
      adjustStock(db, { itemId: m.item_id, locationId: 0, delta: -qty, kind: 'checked out for job', note: `SC-${call.number} → ${v.unit_name}`, serviceCallId: call.id, userId: user.id });
      adjustStock(db, { itemId: m.item_id, locationId: v.id, delta: qty, kind: 'checked out for job', note: `SC-${call.number}`, serviceCallId: call.id, userId: user.id });
      const out = (m.checked_out_qty || 0) + qty;
      db.prepare("UPDATE job_materials SET checked_out_qty = ?, checked_out_to = ?, checked_out_by = ?, status = CASE WHEN ? >= qty THEN 'checked out' ELSE status END WHERE id = ?")
        .run(out, v.id, user.name, out, m.id);
      n++;
    }
    if (!n) throw new HttpError(400, 'Nothing left to check out for this job');
    audit(db, user, 'check out job materials', 'service_calls', call.id, `${n} lines to ${v.unit_name}`);
    return { ok: true, lines: n, vehicle: v.unit_name };
  });
}

/** After the job: send what wasn't used back to the warehouse. */
function returnMaterials(db, call, body, user) {
  const m = db.prepare('SELECT * FROM job_materials WHERE id = ? AND service_call_id = ?').get(Number(body.id), call.id);
  if (!m || !m.checked_out_to) throw new HttpError(400, 'That line was not checked out');
  const qty = Number(body.qty);
  if (!(qty > 0)) throw new HttpError(400, 'Enter how many to return');
  return tx(db, () => {
    adjustStock(db, { itemId: m.item_id, locationId: m.checked_out_to, delta: -qty, kind: 'returned to warehouse', note: `Unused from SC-${call.number}`, serviceCallId: call.id, userId: user.id });
    adjustStock(db, { itemId: m.item_id, locationId: 0, delta: qty, kind: 'returned to warehouse', note: `Unused from SC-${call.number}`, serviceCallId: call.id, userId: user.id });
    db.prepare("UPDATE job_materials SET status = 'returned', checked_out_qty = MAX(0, checked_out_qty - ?) WHERE id = ?").run(qty, m.id);
    return { ok: true };
  });
}

/** Copy inventory lines from a signed proposal onto the install job. */
export function materialsFromProposal(db, proposalId, callId) {
  const lines = db.prepare('SELECT item_id, SUM(qty) AS qty FROM proposal_items WHERE proposal_id = ? AND item_id IS NOT NULL GROUP BY item_id').all(proposalId);
  const ins = db.prepare("INSERT INTO job_materials (service_call_id, item_id, qty, status, checked_out_qty, notes) VALUES (?,?,?,'needed',0,?)");
  for (const l of lines) if (l.qty > 0) ins.run(callId, l.item_id, l.qty, 'From signed proposal');
  return lines.length;
}

// ---------------------------------------------------------------- start-of-day readiness
export function readiness(db, techId, day = todayLocal()) {
  const s = getSettings(db);
  const spares = Math.max(0, Number(s.readiness_spares) || 0);
  const v = vehicleForTech(db, techId);
  const jobs = db.prepare(`SELECT c.id, c.number, c.title, c.scheduled_start, c.status, cu.name AS customer FROM service_calls c JOIN customers cu ON cu.id = c.customer_id
    WHERE c.technician_id = ? AND substr(c.scheduled_start, 1, 10) = ? AND c.status NOT IN ('cancelled') ORDER BY c.scheduled_start`).all(techId, day);
  const need = new Map();
  for (const j of jobs) {
    j.materials = materialsFor(db, j.id).filter(m => m.status !== 'returned');
    for (const m of j.materials) {
      const cur = need.get(m.item_id) || { item_id: m.item_id, name: m.name, sku: m.sku, needed: 0, jobs: [] };
      cur.needed += m.qty; cur.jobs.push(`SC-${j.number}`);
      need.set(m.item_id, cur);
    }
  }
  const onTruck = id => v ? (db.prepare('SELECT qty FROM stock WHERE item_id = ? AND location_id = ?').get(id, v.id)?.qty || 0) : 0;
  const lines = [...need.values()].map(l => {
    const have = onTruck(l.item_id);
    return { ...l, on_truck: have, short: Math.max(0, l.needed - have), spare_target: l.needed + spares, spare_ok: have >= l.needed + spares };
  });
  // Standard truck stock that's below the minimum is worth grabbing too (batteries, wire, connectors…).
  const lowStandard = v ? truckStock(db, v.id).filter(s => s.need && !need.has(s.item_id)).map(s => ({ item_id: s.item_id, name: s.name, on_truck: s.on_hand, min: s.min, need: s.need, warehouse_qty: s.warehouse_qty })) : [];
  const tools = v ? db.prepare("SELECT id, name, tag, status FROM tools WHERE vehicle_id = ? AND status IN ('in service','needs repair') ORDER BY name").all(v.id) : [];
  const check = db.prepare('SELECT * FROM readiness_checks WHERE technician_id = ? AND day = ? ORDER BY id DESC LIMIT 1').get(techId, day) || null;
  if (check?.missing) try { check.missing = JSON.parse(check.missing); } catch { check.missing = []; }
  return {
    day, required: s.readiness_required === '1', spares, vehicle: v ? { id: v.id, unit_name: v.unit_name } : null,
    jobs, lines, low_standard: lowStandard, tools, check, cleared: !!check && ['ready', 'approved'].includes(check.status),
  };
}

function submitReadiness(db, techId, body, user) {
  const r = readiness(db, techId, body.day || todayLocal());
  if (r.day !== todayLocal()) throw new HttpError(400, 'The start-of-day check is for today');
  const confirmed = new Set((body.confirmed || []).map(Number));
  const missing = (Array.isArray(body.missing) ? body.missing : []).map(m => ({ item_id: Number(m.item_id) || null, name: String(m.name || '').slice(0, 120), note: String(m.note || '').slice(0, 200) }));
  const unanswered = r.lines.filter(l => !confirmed.has(l.item_id) && !missing.some(m => m.item_id === l.item_id));
  if (unanswered.length) throw new HttpError(400, `Confirm or mark missing: ${unanswered.map(l => l.name).join(', ')}`);
  if (!body.tools_ok && r.tools.length && !missing.some(m => !m.item_id)) throw new HttpError(400, 'Confirm your tools are on the truck, or note what’s missing');
  const status = missing.length ? 'short' : 'ready';
  db.prepare('INSERT INTO readiness_checks (technician_id, day, status, missing, user_name, reason) VALUES (?,?,?,?,?,?)')
    .run(techId, r.day, status, missing.length ? JSON.stringify(missing) : null, user.name, String(body.notes || '').slice(0, 500) || null);
  if (status === 'short') {
    const tech = db.prepare('SELECT name FROM technicians WHERE id = ?').get(techId);
    raiseAlert(db, {
      kind: 'readiness_short', severity: 'bad', link: `#/truck-stock?tech=${techId}`, roles: 'owner,admin',
      title: `${tech?.name || 'A technician'} is missing equipment for today's jobs`,
      body: missing.map(m => `• ${m.name || 'Item'}${m.note ? ` — ${m.note}` : ''}`).join('\n') + '\n\nThey can’t start jobs until it’s sorted or an administrator approves.',
    });
  }
  audit(db, user, 'start-of-day check', 'technicians', techId, status);
  return readiness(db, techId, r.day);
}

// Jobs can't be started (on my way / in progress) by a tech before today's check is cleared.
registerHooks('service_calls', {
  beforeSave(db, data, { existing, user }) {
    if (!existing || user?.role !== 'technician') return;
    if (!['en route', 'in progress'].includes(data.status) || ['en route', 'in progress'].includes(existing.status)) return;
    if (getSettings(db).readiness_required !== '1') return;
    const techId = existing.technician_id || user.technician_id;
    if (!techId) return;
    const check = db.prepare("SELECT status FROM readiness_checks WHERE technician_id = ? AND day = ? ORDER BY id DESC LIMIT 1").get(techId, todayLocal());
    if (check && ['ready', 'approved'].includes(check.status)) return;
    const e = new HttpError(400, check?.status === 'short'
      ? 'You reported missing equipment this morning. Load it (or re-run the check), or ask an administrator to approve starting anyway.'
      : 'Do your start-of-day equipment check first (My Day → Start-of-day check). Only an administrator can let you skip it.');
    e.code = 'readiness_required';
    throw e;
  },
});

// ---------------------------------------------------------------- routes
export function registerTruckStockRoutes(r) {
  r('GET', '/api/truck-stock', OFFICE, ({ db }) => ({ vehicles: countStatus(db), settings: pick(getSettings(db), ['truck_count_day', 'truck_count_reminders', 'inventory_manager_id', 'readiness_required', 'readiness_spares']) }));
  r('GET', '/api/vehicles/:id/truck-stock', G.all, ({ db, params }) => {
    const v = vehicleOr404(db, params.id);
    const stock = truckStock(db, v.id);
    const counts = db.prepare('SELECT * FROM truck_counts WHERE vehicle_id = ? ORDER BY id DESC LIMIT 12').all(v.id);
    return { stock, suggestions: suggestions(db, v.id, stock), counts, tools: db.prepare('SELECT * FROM tools WHERE vehicle_id = ? ORDER BY name').all(v.id) };
  });
  r('GET', '/api/vehicles/:id/count-sheet', G.all, ({ db, params, user }) => {
    const v = vehicleOr404(db, params.id);
    assertVehicleAccess(db, user, v);
    return countSheet(db, v);
  });
  r('POST', '/api/vehicles/:id/counts', G.all, ({ db, params, body, user }) => {
    const v = vehicleOr404(db, params.id);
    assertVehicleAccess(db, user, v);
    return submitCount(db, v, body, user);
  });
  r('GET', '/api/truck-counts/:id', G.all, ({ db, params, user }) => {
    const c = db.prepare('SELECT * FROM truck_counts WHERE id = ?').get(Number(params.id));
    if (!c) throw new HttpError(404, 'Count not found');
    assertVehicleAccess(db, user, vehicleOr404(db, c.vehicle_id));
    return { ...c, lines: db.prepare('SELECT * FROM truck_count_lines WHERE count_id = ? ORDER BY tool_id IS NOT NULL, name').all(c.id) };
  });
  r('POST', '/api/truck-counts/:id/review', OFFICE, ({ db, params, user }) => {
    db.prepare("UPDATE truck_counts SET reviewed_by = ?, reviewed_at = datetime('now','localtime') WHERE id = ?").run(user.name, Number(params.id));
    db.prepare("UPDATE alerts SET resolved_at = datetime('now','localtime'), resolved_by = ? WHERE kind = 'truck_count' AND link LIKE ? AND resolved_at IS NULL").run(user.name, `%count=${Number(params.id)}`);
    return { ok: true };
  });
  r('POST', '/api/vehicles/:id/restock', G.all, ({ db, params, body, user }) => {
    const v = vehicleOr404(db, params.id);
    assertVehicleAccess(db, user, v);
    const direction = body.direction === 'return' ? 'return' : 'load';
    const out = moveBatch(db, v, { direction, lines: body.lines, note: body.note }, user);
    audit(db, user, direction === 'load' ? 'restock truck' : 'return extras', 'vehicles', v.id, `${out.moved} lines`);
    return out;
  });

  // Job materials
  r('GET', '/api/service_calls/:id/materials', G.all, ({ db, params }) => materialsFor(db, callOr404(db, params.id).id));
  r('POST', '/api/service_calls/:id/materials/checkout', G.all, ({ db, params, body, user }) => {
    const call = callOr404(db, params.id);
    if (user.role === 'technician' && call.technician_id !== user.technician_id) throw new HttpError(403, 'This job is assigned to someone else');
    return checkoutMaterials(db, call, body, user);
  });
  r('POST', '/api/service_calls/:id/materials/return', G.all, ({ db, params, body, user }) => {
    const call = callOr404(db, params.id);
    if (user.role === 'technician' && call.technician_id !== user.technician_id) throw new HttpError(403, 'This job is assigned to someone else');
    return returnMaterials(db, call, body, user);
  });

  // Start-of-day readiness
  const techParam = (user, q) => {
    if (user.role === 'technician') {
      if (!user.technician_id) throw new HttpError(400, 'Your login is not linked to a technician profile');
      return user.technician_id;
    }
    const id = Number(q.technician_id);
    if (!id) throw new HttpError(400, 'Choose a technician');
    return id;
  };
  r('GET', '/api/readiness', G.all, ({ db, user, query }) => readiness(db, techParam(user, query), DATE_OK(query.day) || todayLocal()));
  r('POST', '/api/readiness', G.all, ({ db, user, body }) => submitReadiness(db, techParam(user, body), body, user));
  r('POST', '/api/readiness/approve', MANAGE, ({ db, user, body }) => {
    const techId = Number(body.technician_id);
    if (!db.prepare('SELECT 1 FROM technicians WHERE id = ?').get(techId)) throw new HttpError(400, 'Choose a technician');
    const reason = String(body.reason || '').trim();
    if (!reason) throw new HttpError(400, 'Give a reason for the override');
    const day = DATE_OK(body.day) || todayLocal();
    db.prepare("INSERT INTO readiness_checks (technician_id, day, status, approved_by, reason, user_name) VALUES (?,?,'approved',?,?,?)").run(techId, day, user.name, reason.slice(0, 300), user.name);
    db.prepare("UPDATE alerts SET resolved_at = datetime('now','localtime'), resolved_by = ? WHERE kind = 'readiness_short' AND link = ? AND resolved_at IS NULL").run(user.name, `#/truck-stock?tech=${techId}`);
    audit(db, user, 'approve start-of-day', 'technicians', techId, reason);
    return readiness(db, techId, day);
  });
  r('GET', '/api/readiness/today', MANAGE, ({ db }) => {
    const techs = db.prepare('SELECT id, name, color FROM technicians WHERE active = 1 ORDER BY name').all();
    return techs.map(t => {
      const rd = readiness(db, t.id);
      return { technician_id: t.id, name: t.name, color: t.color, jobs: rd.jobs.length, status: rd.check?.status || (rd.jobs.length ? 'not done' : 'no jobs'), missing: rd.check?.missing || [], short_lines: rd.lines.filter(l => l.short).length };
    }).filter(t => t.jobs);
  });
}

const DATE_OK = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? d : null;
const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, o[k]]));

// One exception per vehicle + item.
registerHooks('truck_par', {
  beforeSave(db, data, { existing }) {
    const m = { ...existing, ...data };
    const dup = db.prepare('SELECT id FROM truck_par WHERE vehicle_id = ? AND item_id = ? AND id <> ?').get(m.vehicle_id, m.item_id, existing?.id || 0);
    if (dup) throw new HttpError(409, 'This vehicle already has an exception for that item — edit it instead');
  },
});
