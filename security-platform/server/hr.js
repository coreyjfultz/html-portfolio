// HR basics: company holidays and paid-time-off balances.
// Balances are per calendar year: allowance + carryover − approved time off (pending shown separately).
import { G } from '../public/js/schema.js';
import { getSettings } from './db.js';
import { HttpError, registerHooks, todayLocal, addDays } from './resources.js';
import { audit } from './security.js';

const MANAGE = G.hr; // time off, balances and holidays for everyone
export const PTO_KINDS = ['vacation', 'sick', 'personal'];
const D = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------- holidays
const pad = n => String(n).padStart(2, '0');
const nthWeekday = (y, m, wd, n) => { const d = new Date(Date.UTC(y, m - 1, 1)); let c = 0; while (true) { if (d.getUTCDay() === wd && ++c === n) return d; d.setUTCDate(d.getUTCDate() + 1); } };
const lastWeekday = (y, m, wd) => { const d = new Date(Date.UTC(y, m, 0)); while (d.getUTCDay() !== wd) d.setUTCDate(d.getUTCDate() - 1); return d; };
const iso = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
/** Fixed-date holidays falling on a weekend are observed on the Friday before / Monday after. */
const observed = (y, m, day) => { const d = new Date(Date.UTC(y, m - 1, day)); if (d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1); if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1); return d; };
export function usHolidays(y) {
  return [
    ['new_year', 'New Year’s Day', observed(y, 1, 1)], ['mlk', 'Martin Luther King Jr. Day', nthWeekday(y, 1, 1, 3)], ['presidents', 'Presidents’ Day', nthWeekday(y, 2, 1, 3)],
    ['memorial', 'Memorial Day', lastWeekday(y, 5, 1)], ['juneteenth', 'Juneteenth', observed(y, 6, 19)], ['independence', 'Independence Day', observed(y, 7, 4)],
    ['labor', 'Labor Day', nthWeekday(y, 9, 1, 1)], ['columbus', 'Columbus / Indigenous Peoples’ Day', nthWeekday(y, 10, 1, 2)], ['veterans', 'Veterans Day', observed(y, 11, 11)],
    ['thanksgiving', 'Thanksgiving', nthWeekday(y, 11, 4, 4)], ['day_after_thanksgiving', 'Day after Thanksgiving', new Date(nthWeekday(y, 11, 4, 4).getTime() + 864e5)],
    ['christmas_eve', 'Christmas Eve', observed(y, 12, 24)], ['christmas', 'Christmas Day', observed(y, 12, 25)], ['new_years_eve', 'New Year’s Eve', observed(y, 12, 31)],
  ].map(([key, name, d]) => ({ key, name, date: iso(d) }));
}
export const holidaysBetween = (db, from, to) => db.prepare('SELECT * FROM company_holidays WHERE date BETWEEN ? AND ? ORDER BY date').all(from, to);

// Booking on a company holiday asks for confirmation (owners/admins can book anyway).
registerHooks('service_calls', {
  beforeSave(db, data, { existing, isCreate, user, body }) {
    if (body?.allow_conflict || getSettings(db).holiday_blocks !== '1') return;
    const m = { ...existing, ...data };
    if (!m.scheduled_start || ['cancelled', 'completed'].includes(m.status) || m.priority === 'emergency') return;
    if (!(isCreate || ('scheduled_start' in data && data.scheduled_start !== existing?.scheduled_start))) return;
    const h = db.prepare('SELECT name FROM company_holidays WHERE date = ?').get(m.scheduled_start.slice(0, 10));
    if (!h) return;
    const canOverride = G.manage.includes(user?.role);
    const e = new HttpError(409, `${m.scheduled_start.slice(0, 10)} is a company holiday (${h.name}).${canOverride ? ' Book anyway?' : ' Pick another day, or ask the office.'}`);
    e.code = 'conflict'; e.canOverride = canOverride; e.kind = 'holiday';
    throw e;
  },
});

// ---------------------------------------------------------------- PTO hours & balances
/** Hours a request uses: whole days = workdays (Mon–Fri, not holidays) × hours per day; part days = the hours, up to a workday. */
export function requestHours(db, { starts_at, ends_at, all_day }) {
  const per = Math.max(1, Number(getSettings(db).workday_hours) || 8);
  if (!all_day) return Math.min(per, Math.round((new Date(ends_at) - new Date(starts_at)) / 36e5 * 4) / 4);
  const hol = new Set(holidaysBetween(db, starts_at.slice(0, 10), ends_at.slice(0, 10)).map(h => h.date));
  let n = 0;
  for (let d = starts_at.slice(0, 10); d <= ends_at.slice(0, 10); d = addDays(d, 1)) {
    const wd = new Date(d + 'T12:00:00Z').getUTCDay();
    if (wd !== 0 && wd !== 6 && !hol.has(d)) n++;
  }
  return n * per;
}

function allowance(db, userId, year) {
  const s = getSettings(db);
  const row = db.prepare('SELECT * FROM pto_allowances WHERE user_id = ? AND year = ?').get(userId, year);
  const def = k => Number(s[`pto_default_${k}`]) || 0;
  return Object.fromEntries(PTO_KINDS.map(k => [k, { allowance: row ? Number(row[k]) || 0 : def(k), carryover: row ? Number(row[`carry_${k}`]) || 0 : 0, custom: !!row }]));
}

export function balances(db, userId, year = Number(todayLocal().slice(0, 4))) {
  const a = allowance(db, userId, year);
  const rows = db.prepare(`SELECT kind, status, SUM(hours) AS h FROM time_off WHERE user_id = ? AND status IN ('approved','pending') AND substr(starts_at,1,4) = ? GROUP BY kind, status`).all(userId, String(year));
  const sum = (k, st) => Number(rows.find(r => r.kind === k && r.status === st)?.h || 0);
  return Object.fromEntries(PTO_KINDS.map(k => {
    const total = a[k].allowance + a[k].carryover;
    const used = sum(k, 'approved'), pending = sum(k, 'pending');
    return [k, { ...a[k], total, used, pending, remaining: Math.round((total - used) * 100) / 100, available: Math.round((total - used - pending) * 100) / 100 }];
  }));
}

export function registerHrRoutes(r) {
  r('GET', '/api/holidays', G.all, ({ db, query }) => {
    const from = D.test(query.from || '') ? query.from : `${todayLocal().slice(0, 4)}-01-01`;
    const to = D.test(query.to || '') ? query.to : addDays(from, 400);
    return holidaysBetween(db, from, to);
  });
  r('GET', '/api/holidays/presets', MANAGE, ({ db, query }) => {
    const y = Number(query.year) || Number(todayLocal().slice(0, 4));
    const have = new Set(db.prepare('SELECT date FROM company_holidays WHERE substr(date,1,4) = ?').all(String(y)).map(h => h.date));
    return usHolidays(y).map(h => ({ ...h, added: have.has(h.date) }));
  });
  r('POST', '/api/holidays', MANAGE, ({ db, user, body }) => {
    const list = Array.isArray(body.holidays) ? body.holidays : [body];
    let n = 0;
    for (const h of list) {
      if (!D.test(h.date || '') || !String(h.name || '').trim()) throw new HttpError(400, 'Each holiday needs a date and a name');
      n += db.prepare('INSERT OR IGNORE INTO company_holidays (date, name, paid) VALUES (?,?,?)').run(h.date, String(h.name).trim().slice(0, 80), h.paid === false ? 0 : 1).changes;
    }
    audit(db, user, 'add holidays', 'company_holidays', null, `${n} added`);
    return { added: n };
  });
  r('DELETE', '/api/holidays/:id', MANAGE, ({ db, user, params }) => {
    db.prepare('DELETE FROM company_holidays WHERE id = ?').run(Number(params.id));
    audit(db, user, 'remove holiday', 'company_holidays', Number(params.id));
    return { ok: true };
  });

  r('GET', '/api/pto/balances', G.all, ({ db, user, query }) => {
    const year = Number(query.year) || Number(todayLocal().slice(0, 4));
    if (query.all === '1') {
      if (!MANAGE.includes(user.role)) throw new HttpError(403, 'Only people who manage time off can see everyone’s balances');
      return db.prepare('SELECT id, name, role FROM users WHERE active = 1 ORDER BY name').all().map(u => ({ ...u, year, balances: balances(db, u.id, year) }));
    }
    return { year, workday_hours: Number(getSettings(db).workday_hours) || 8, balances: balances(db, user.id, year) };
  });
  r('PUT', '/api/pto/allowances/:userId', MANAGE, ({ db, user, params, body }) => {
    const u = db.prepare('SELECT id, name FROM users WHERE id = ?').get(Number(params.userId));
    if (!u) throw new HttpError(404, 'Person not found');
    const year = Number(body.year) || Number(todayLocal().slice(0, 4));
    const v = k => { const n = Number(body[k]); if (!Number.isFinite(n) || n < 0 || n > 2000) throw new HttpError(400, `Check ${k.replace('carry_', 'carryover ')} hours`); return n; };
    const vals = [...PTO_KINDS.map(k => v(k)), ...PTO_KINDS.map(k => v(`carry_${k}`))];
    db.prepare(`INSERT INTO pto_allowances (user_id, year, vacation, sick, personal, carry_vacation, carry_sick, carry_personal) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(user_id, year) DO UPDATE SET vacation = excluded.vacation, sick = excluded.sick, personal = excluded.personal,
        carry_vacation = excluded.carry_vacation, carry_sick = excluded.carry_sick, carry_personal = excluded.carry_personal`).run(u.id, year, ...vals);
    audit(db, user, 'set time-off allowance', 'users', u.id, `${year}: ${vals.join('/')}`);
    return balances(db, u.id, year);
  });
}
