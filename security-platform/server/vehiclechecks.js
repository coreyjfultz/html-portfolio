// Vehicle checklist: oil, tires, lights, walk-around damage (with photos), clean truck.
// Done by the tech on their phone, daily by default, before their first job. Problems alert
// the office; the odometer reading keeps the vehicle's mileage current.
import { G } from '../public/js/schema.js';
import { VEHICLE_ITEMS, TIRES } from '../public/js/vehicle-checks.js';
import { getSettings, tx } from './db.js';
import { HttpError, registerHooks, todayLocal, nowLocal, addDays } from './resources.js';
import { audit } from './security.js';
import { decodeImage, saveImage, sendImage } from './media.js';
import { raiseAlert } from './alerts.js';
import { vehicleForTech } from './truckstock.js';

const OFFICE = G.billing;
const json = (v, d) => { try { return JSON.parse(v); } catch { return d; } };

function vehicleOr404(db, id) {
  const v = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(Number(id));
  if (!v) throw new HttpError(404, 'Vehicle not found');
  return v;
}
function assertAccess(user, v) {
  if (G.billing.includes(user.role) || user.role !== 'technician') return;
  if (!user.technician_id || v.assigned_technician_id !== user.technician_id) throw new HttpError(403, 'You can only check the vehicle assigned to you');
}

/** Is a check due for this vehicle? Daily = once per day; weekly = within the last 7 days. */
export function checkDue(db, vehicleId, day = todayLocal()) {
  const freq = getSettings(db).vehicle_check_frequency || 'daily';
  if (freq === 'off') return { due: false, last: null, frequency: freq };
  const last = db.prepare('SELECT id, status, created_at, user_name, issues FROM vehicle_checks WHERE vehicle_id = ? ORDER BY id DESC LIMIT 1').get(vehicleId) || null;
  const since = freq === 'weekly' ? addDays(day, -6) : day;
  return { due: !last || last.created_at.slice(0, 10) < since, last, frequency: freq };
}

export function submitCheck(db, v, body, user) {
  const s = getSettings(db);
  const answers = body.items && typeof body.items === 'object' ? body.items : {};
  const clean = {};
  const missing = [];
  const issues = [];
  for (const i of VEHICLE_ITEMS) {
    const a = answers[i.id] || {};
    if (i.kind === 'tires') {
      const psi = {};
      for (const k of Object.keys(TIRES)) {
        const n = Number(a.psi?.[k]);
        if (!Number.isFinite(n) || n <= 0 || n > 150) { missing.push(`${TIRES[k]} tire pressure`); continue; }
        psi[k] = n;
      }
      const target = Number(v.tire_psi) || 0;
      const low = target ? Object.entries(psi).filter(([, n]) => n < target - 5).map(([k, n]) => `${TIRES[k]} ${n} psi`) : [];
      clean[i.id] = { psi, r: low.length ? 'issue' : 'ok', note: String(a.note || '').slice(0, 300) };
      if (low.length) issues.push(`Low tire pressure (target ${target} psi): ${low.join(', ')}`);
      continue;
    }
    if (!['ok', 'issue'].includes(a.r)) { missing.push(i.text); continue; }
    const note = String(a.note || '').trim().slice(0, 300);
    if (a.r === 'issue' && !note) throw new HttpError(400, `Say what’s wrong: ${i.text}`);
    clean[i.id] = { r: a.r, note };
    if (a.r === 'issue') issues.push(`${i.text}: ${note}`);
  }
  if (missing.length) throw new HttpError(400, `Answer every item (${missing.length} left: ${missing.slice(0, 3).join('; ')}${missing.length > 3 ? '…' : ''})`);
  const photos = (Array.isArray(body.photos) ? body.photos : []).slice(0, 8).map(p => decodeImage(p, { maxBytes: 6 * 1024 * 1024 }));
  const damage = clean.damage?.r === 'issue';
  if (damage && !photos.length) throw new HttpError(400, 'Take at least one photo of the damage');
  if (s.vehicle_check_photos === 'always' && photos.length < 4) throw new HttpError(400, 'Take a photo of each side of the truck (front, back, left, right)');
  const odo = body.odometer === '' || body.odometer == null ? null : Math.round(Number(body.odometer));
  if (odo != null && (!Number.isFinite(odo) || odo < 0)) throw new HttpError(400, 'Check the odometer reading');
  if (odo != null && v.mileage && odo < v.mileage - 50) throw new HttpError(400, `The odometer can’t be lower than the last reading (${v.mileage.toLocaleString()} mi)`);
  return tx(db, () => {
    const keys = photos.map(img => saveImage('photos', img));
    const id = Number(db.prepare(`INSERT INTO vehicle_checks (vehicle_id, user_id, user_name, technician_id, odometer, items, photos, issues, status, notes)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(v.id, user.id, user.name, user.technician_id || null, odo, JSON.stringify(clean), JSON.stringify(keys),
      issues.length, issues.length ? 'issues' : 'ok', String(body.notes || '').slice(0, 1000) || null).lastInsertRowid);
    if (odo != null && odo > (v.mileage || 0)) db.prepare('UPDATE vehicles SET mileage = ? WHERE id = ?').run(odo, v.id);
    if (issues.length) {
      raiseAlert(db, {
        kind: 'vehicle_check', severity: damage || clean.dash_lights?.r === 'issue' || clean.leaks?.r === 'issue' ? 'bad' : 'warn',
        title: `${v.unit_name}: ${issues.length} problem${issues.length === 1 ? '' : 's'} on today’s vehicle check`,
        body: `Checked by ${user.name}${odo != null ? ` at ${odo.toLocaleString()} mi` : ''}.\n${issues.map(x => `• ${x}`).join('\n')}${keys.length ? `\n${keys.length} photo(s) attached.` : ''}`,
        link: `#/vehicles/${v.id}?check=${id}`, roles: 'owner,admin',
      });
    }
    audit(db, user, 'vehicle check', 'vehicles', v.id, issues.length ? `${issues.length} issues` : 'ok');
    return { id, status: issues.length ? 'issues' : 'ok', issues };
  });
}

// Part of the start-of-day routine: a tech can't start a job before their truck check
// (when required). "Approve start" on the start-of-day check covers this too.
registerHooks('service_calls', {
  beforeSave(db, data, { existing, user }) {
    if (!existing || user?.role !== 'technician') return;
    if (!['en route', 'in progress'].includes(data.status) || ['en route', 'in progress'].includes(existing.status)) return;
    if (getSettings(db).vehicle_check_required !== '1') return;
    const techId = existing.technician_id || user.technician_id;
    const v = vehicleForTech(db, techId);
    if (!v || !checkDue(db, v.id).due) return;
    if (db.prepare("SELECT 1 FROM readiness_checks WHERE technician_id = ? AND day = ? AND status = 'approved'").get(techId, todayLocal())) return;
    const e = new HttpError(400, `Do your vehicle check on ${v.unit_name} first (My Day → Vehicle check). Only an administrator can let you skip it.`);
    e.code = 'readiness_required';
    throw e;
  },
});

const detail = (db, c) => ({ ...c, items: json(c.items, {}), photos: json(c.photos, []).map((_, i) => `/api/vehicle-checks/${c.id}/photo/${i}`) });

export function registerVehicleCheckRoutes(r) {
  r('GET', '/api/vehicles/:id/checks', G.all, ({ db, params, user }) => {
    const v = vehicleOr404(db, params.id);
    assertAccess(user, v);
    return { ...checkDue(db, v.id), tire_psi: v.tire_psi, checks: db.prepare('SELECT * FROM vehicle_checks WHERE vehicle_id = ? ORDER BY id DESC LIMIT 60').all(v.id).map(c => detail(db, c)) };
  });
  r('POST', '/api/vehicles/:id/checks', G.all, ({ db, params, body, user }) => {
    const v = vehicleOr404(db, params.id);
    assertAccess(user, v);
    return submitCheck(db, v, body, user);
  });
  r('GET', '/api/vehicle-checks/:id/photo/:n', G.all, ({ db, params, user, res }) => {
    const c = db.prepare('SELECT * FROM vehicle_checks WHERE id = ?').get(Number(params.id));
    if (!c) throw new HttpError(404, 'Not found');
    assertAccess(user, vehicleOr404(db, c.vehicle_id));
    const key = json(c.photos, [])[Number(params.n)];
    if (!key) throw new HttpError(404, 'Not found');
    sendImage(res, 'photos', key);
    return undefined;
  });
  r('POST', '/api/vehicle-checks/:id/review', G.manage, ({ db, params, user }) => {
    const c = db.prepare('SELECT * FROM vehicle_checks WHERE id = ?').get(Number(params.id));
    if (!c) throw new HttpError(404, 'Not found');
    db.prepare("UPDATE vehicle_checks SET reviewed_by = ?, reviewed_at = ? WHERE id = ?").run(user.name, nowLocal(), c.id);
    db.prepare("UPDATE alerts SET resolved_at = datetime('now','localtime'), resolved_by = ? WHERE kind = 'vehicle_check' AND link LIKE ? AND resolved_at IS NULL").run(user.name, `%check=${c.id}`);
    return { ok: true };
  });
  r('GET', '/api/vehicle-checks/today', OFFICE, ({ db }) => db.prepare(`SELECT v.id AS vehicle_id, v.unit_name, t.name AS tech_name FROM vehicles v LEFT JOIN technicians t ON t.id = v.assigned_technician_id
    WHERE v.status = 'in service' ORDER BY v.unit_name`).all().map(v => ({ ...v, ...checkDue(db, v.vehicle_id) })));
}
