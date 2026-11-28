// Time clock: everyone clocks in and out from the app (phone or computer). The browser's
// location is recorded; clocking in away from the office (or a job you're scheduled at
// today) or without a location alerts the owner. Office managers edit entries (with a
// reason, kept in the audit log) and export timesheets for payroll.
import { G } from '../public/js/schema.js';
import { getSettings, tx } from './db.js';
import { HttpError, nowLocal, todayLocal, addDays, round2 } from './resources.js';
import { audit } from './security.js';
import { raiseAlert } from './alerts.js';

const MANAGE = G.manage;
const OFFICE = G.timesheets; // owners, admins, accounting, HR

/** Great-circle distance in metres. */
export function distanceM(a, b) {
  const R = 6371000, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const num = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
export const officePoint = s => (num(s.office_lat) != null && num(s.office_lng) != null ? { lat: Number(s.office_lat), lng: Number(s.office_lng) } : null);

/** Where was this punch? 'office', 'job site', 'away' or 'no location'. */
export function classify(db, user, pos) {
  if (!pos) return { flag: 'no location', dist: null, where: null };
  const s = getSettings(db);
  const radius = Math.max(50, Number(s.office_radius_m) || 300);
  const slack = Math.min(pos.accuracy || 0, 150); // don't punish a fuzzy phone fix too hard
  const office = officePoint(s);
  const dist = office ? Math.round(distanceM(office, pos)) : null;
  if (office && dist - slack <= radius) return { flag: 'office', dist, where: 'Office' };
  // A job the tech is scheduled at today counts as a fine place to clock in.
  if (user.technician_id && s.clock_allow_jobsite === '1') {
    const sites = db.prepare(`SELECT c.number, cu.name, COALESCE(l.lat, cu.lat) AS lat, COALESCE(l.lng, cu.lng) AS lng
      FROM service_calls c JOIN customers cu ON cu.id = c.customer_id LEFT JOIN locations l ON l.id = c.site_id
      WHERE c.technician_id = ? AND substr(c.scheduled_start,1,10) = ? AND c.status <> 'cancelled'`).all(user.technician_id, todayLocal());
    for (const j of sites) {
      if (j.lat == null || j.lng == null) continue;
      if (distanceM({ lat: j.lat, lng: j.lng }, pos) - slack <= Math.max(radius, 400)) return { flag: 'job site', dist, where: `${j.name} (SC-${j.number})` };
    }
  }
  return { flag: office ? 'away' : 'no office set', dist, where: null };
}

function readPos(body) {
  const lat = num(body.lat), lng = num(body.lng);
  if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng, accuracy: Math.max(0, num(body.accuracy) || 0) };
}
const openEntry = (db, userId) => db.prepare('SELECT * FROM time_entries WHERE user_id = ? AND clock_out IS NULL ORDER BY id DESC LIMIT 1').get(userId);
const hours = e => {
  const end = e.clock_out || nowLocal();
  return Math.max(0, (new Date(end) - new Date(e.clock_in)) / 3600e3);
};
const mapLink = p => `https://www.google.com/maps?q=${p.lat},${p.lng}`;

function alertIfNeeded(db, user, kind, c, pos, entryId) {
  const s = getSettings(db);
  if (s.clock_alert !== '1' || ['office', 'job site', 'no office set'].includes(c.flag)) return;
  if (kind === 'out' && s.clock_alert_out !== '1') return;
  const verb = kind === 'in' ? 'clocked in' : 'clocked out';
  raiseAlert(db, {
    kind: 'clock_location', severity: 'warn', link: `#/timeclock?entry=${entryId}`, roles: 'owner,admin',
    title: c.flag === 'no location' ? `${user.name} ${verb} without sharing a location` : `${user.name} ${verb} ${c.dist >= 1609 ? `${(c.dist / 1609).toFixed(1)} mi` : `${c.dist} m`} from the office`,
    body: `${nowLocal().replace('T', ' ')}${pos ? `\nLocation: ${mapLink(pos)} (±${Math.round(pos.accuracy)} m)` : '\nThe phone or browser did not share a location (permission denied or unavailable).'}`,
  });
}

export function clockIn(db, user, body) {
  if (openEntry(db, user.id)) throw new HttpError(409, 'You are already clocked in');
  const pos = readPos(body);
  const c = classify(db, user, pos);
  const id = Number(db.prepare(`INSERT INTO time_entries (user_id, technician_id, clock_in, in_lat, in_lng, in_acc, in_dist, in_flag, in_where, note)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(user.id, user.technician_id || null, nowLocal(), pos?.lat ?? null, pos?.lng ?? null, pos?.accuracy ?? null, c.dist, c.flag, c.where, String(body.note || '').slice(0, 300) || null).lastInsertRowid);
  alertIfNeeded(db, user, 'in', c, pos, id);
  return { id, flag: c.flag, where: c.where, distance_m: c.dist };
}

export function clockOut(db, user, body) {
  const e = openEntry(db, user.id);
  if (!e) throw new HttpError(409, 'You are not clocked in');
  const pos = readPos(body);
  const c = classify(db, user, pos);
  db.prepare(`UPDATE time_entries SET clock_out = ?, out_lat = ?, out_lng = ?, out_acc = ?, out_dist = ?, out_flag = ?, out_where = ?,
    note = COALESCE(?, note) WHERE id = ?`).run(nowLocal(), pos?.lat ?? null, pos?.lng ?? null, pos?.accuracy ?? null, c.dist, c.flag, c.where, String(body.note || '').slice(0, 300) || null, e.id);
  alertIfNeeded(db, user, 'out', c, pos, e.id);
  return { id: e.id, flag: c.flag, hours: round2(hours({ ...e, clock_out: nowLocal() })) };
}

function entries(db, { from, to, userId }) {
  const where = ['substr(e.clock_in,1,10) BETWEEN ? AND ?'];
  const params = [from, to];
  if (userId) { where.push('e.user_id = ?'); params.push(userId); }
  return db.prepare(`SELECT e.*, u.name AS user_name, u.role FROM time_entries e JOIN users u ON u.id = e.user_id
    WHERE ${where.join(' AND ')} ORDER BY e.clock_in DESC`).all(...params).map(e => ({ ...e, hours: round2(hours(e)), open: !e.clock_out }));
}

/** Per person: total hours, regular / overtime (over 40 per Mon–Sun week), days, flagged punches. */
export function timesheet(db, from, to) {
  const rows = entries(db, { from, to });
  const people = new Map();
  for (const e of rows) {
    const p = people.get(e.user_id) || { user_id: e.user_id, name: e.user_name, role: e.role, hours: 0, days: new Set(), flagged: 0, open: 0, weeks: new Map() };
    p.hours += e.hours; p.days.add(e.clock_in.slice(0, 10));
    if (['away', 'no location'].includes(e.in_flag) || ['away', 'no location'].includes(e.out_flag)) p.flagged++;
    if (e.open) p.open++;
    const d = new Date(e.clock_in.slice(0, 10) + 'T12:00:00Z');
    const wk = addDays(e.clock_in.slice(0, 10), -((d.getUTCDay() + 6) % 7));
    p.weeks.set(wk, (p.weeks.get(wk) || 0) + e.hours);
    people.set(e.user_id, p);
  }
  return [...people.values()].map(p => {
    const ot = [...p.weeks.values()].reduce((s, h) => s + Math.max(0, h - 40), 0);
    return { user_id: p.user_id, name: p.name, role: p.role, hours: round2(p.hours), regular: round2(p.hours - ot), overtime: round2(ot), days: p.days.size, flagged: p.flagged, open: p.open };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

const csvCell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const range = q => {
  const to = DATE.test(q.to || '') ? q.to : todayLocal();
  const from = DATE.test(q.from || '') ? q.from : addDays(to, -13);
  return { from, to };
};

export function registerTimeClockRoutes(r) {
  r('GET', '/api/timeclock/me', G.all, ({ db, user }) => {
    const s = getSettings(db);
    const today = todayLocal();
    const d = new Date(today + 'T12:00:00Z');
    const weekStart = addDays(today, -((d.getUTCDay() + 6) % 7));
    const week = entries(db, { from: weekStart, to: today, userId: user.id });
    return {
      open: openEntry(db, user.id) || null, office_set: !!officePoint(s),
      today: week.filter(e => e.clock_in.startsWith(today)), today_hours: round2(week.filter(e => e.clock_in.startsWith(today)).reduce((t, e) => t + e.hours, 0)),
      week_hours: round2(week.reduce((t, e) => t + e.hours, 0)), recent: entries(db, { from: addDays(today, -13), to: today, userId: user.id }).slice(0, 20),
    };
  });
  r('POST', '/api/timeclock/in', G.all, ({ db, user, body }) => clockIn(db, user, body));
  r('POST', '/api/timeclock/out', G.all, ({ db, user, body }) => clockOut(db, user, body));

  r('GET', '/api/timeclock/now', MANAGE, ({ db }) => db.prepare(`SELECT e.*, u.name AS user_name, u.role FROM time_entries e JOIN users u ON u.id = e.user_id
    WHERE e.clock_out IS NULL ORDER BY e.clock_in`).all().map(e => ({ ...e, hours: round2(hours(e)) })));
  r('GET', '/api/timeclock/entries', OFFICE, ({ db, query }) => entries(db, { ...range(query), userId: Number(query.user_id) || null }));
  r('GET', '/api/timeclock/timesheet', OFFICE, ({ db, query }) => { const { from, to } = range(query); return { from, to, people: timesheet(db, from, to) }; });
  r('GET', '/api/timeclock/export', OFFICE, ({ db, query, res, user }) => {
    const { from, to } = range(query);
    const rows = entries(db, { from, to }).reverse();
    const lines = [['Employee', 'Role', 'Date', 'Clock in', 'Clock out', 'Hours', 'In location', 'Out location', 'Note', 'Edited'].join(',')];
    for (const e of rows) lines.push([e.user_name, e.role, e.clock_in.slice(0, 10), e.clock_in.slice(11), e.clock_out ? e.clock_out.replace('T', ' ') : 'OPEN', e.hours.toFixed(2),
      e.in_where || e.in_flag, e.clock_out ? e.out_where || e.out_flag : '', e.note, e.edited_by ? `${e.edited_by}: ${e.edit_reason}` : ''].map(csvCell).join(','));
    lines.push('', ['Employee', 'Total hours', 'Regular', 'Overtime (>40/wk)', 'Days'].join(','));
    for (const p of timesheet(db, from, to)) lines.push([p.name, p.hours, p.regular, p.overtime, p.days].map(csvCell).join(','));
    audit(db, user, 'export timesheets', 'time_entries', null, `${from}..${to}`);
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="timesheets-${from}-to-${to}.csv"`, 'Cache-Control': 'no-store' });
    res.end(lines.join('\r\n'));
  });
  // Office corrections: forgotten punches, wrong times. Always with a reason.
  const checkTimes = (cin, cout) => {
    if (!DT.test(cin || '')) throw new HttpError(400, 'Clock-in time is required (YYYY-MM-DDTHH:MM)');
    if (cout && !DT.test(cout)) throw new HttpError(400, 'Clock-out time is invalid');
    if (cout && cout <= cin) throw new HttpError(400, 'Clock-out must be after clock-in');
  };
  r('POST', '/api/timeclock/entries', MANAGE, ({ db, user, body }) => {
    const u = db.prepare('SELECT id, technician_id FROM users WHERE id = ?').get(Number(body.user_id));
    if (!u) throw new HttpError(400, 'Choose a person');
    checkTimes(body.clock_in, body.clock_out);
    const reason = String(body.reason || '').trim();
    if (!reason) throw new HttpError(400, 'Give a reason for the manual entry');
    const id = Number(db.prepare("INSERT INTO time_entries (user_id, technician_id, clock_in, clock_out, in_flag, out_flag, edited_by, edit_reason) VALUES (?,?,?,?,'manual',?,?,?)")
      .run(u.id, u.technician_id, body.clock_in, body.clock_out || null, body.clock_out ? 'manual' : null, user.name, reason.slice(0, 300)).lastInsertRowid);
    audit(db, user, 'add time entry', 'time_entries', id, reason);
    return { id };
  });
  r('PUT', '/api/timeclock/entries/:id', MANAGE, ({ db, user, body, params }) => {
    const e = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(Number(params.id));
    if (!e) throw new HttpError(404, 'Entry not found');
    const cin = body.clock_in || e.clock_in, cout = body.clock_out === '' ? null : body.clock_out ?? e.clock_out;
    checkTimes(cin, cout);
    const reason = String(body.reason || '').trim();
    if (!reason) throw new HttpError(400, 'Give a reason for the change');
    db.prepare('UPDATE time_entries SET clock_in = ?, clock_out = ?, edited_by = ?, edit_reason = ? WHERE id = ?').run(cin, cout, user.name, reason.slice(0, 300), e.id);
    audit(db, user, 'edit time entry', 'time_entries', e.id, `${e.clock_in}–${e.clock_out || 'open'} → ${cin}–${cout || 'open'}: ${reason}`);
    return { ok: true };
  });
  r('DELETE', '/api/timeclock/entries/:id', MANAGE, ({ db, user, params }) => {
    tx(db, () => db.prepare('DELETE FROM time_entries WHERE id = ?').run(Number(params.id)));
    audit(db, user, 'delete time entry', 'time_entries', Number(params.id));
    return { ok: true };
  });
}
