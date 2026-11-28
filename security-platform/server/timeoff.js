// Time-off requests: anyone asks, owners/admins approve or deny. Approved time off blocks
// scheduling (like double-booking, overridable by owners/admins) and shows on calendars.
import { G } from '../public/js/schema.js';
import { getSettings } from './db.js';
import { HttpError, registerHooks, nowLocal, todayLocal, addDays } from './resources.js';
import { audit } from './security.js';
import { raiseAlert } from './alerts.js';
import { queue, sendEmail, sendSms, mailConfig } from './notify.js';
import { zonedToUtc } from './calendar.js';
import { requestHours, balances, PTO_KINDS } from './hr.js';
import { canApprove, reportIds, supervisorOf } from './org.js';
import { notifyPush } from './push.js';

const MANAGE = G.manage;
export const KINDS = ['vacation', 'sick', 'personal', 'training', 'other'];
const DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const D = /^\d{4}-\d{2}-\d{2}$/;

const fmt = (s, e, allDay) => {
  const d = x => new Date(x).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const t = x => new Date(x).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (allDay) return s.slice(0, 10) === e.slice(0, 10) ? d(s) : `${d(s)} – ${d(e)}`;
  return s.slice(0, 10) === e.slice(0, 10) ? `${d(s)} ${t(s)}–${t(e)}` : `${d(s)} ${t(s)} – ${d(e)} ${t(e)}`;
};
const row = (db, id) => db.prepare(`SELECT o.*, u.name AS user_name, u.email AS user_email, t.phone AS tech_phone FROM time_off o JOIN users u ON u.id = o.user_id
  LEFT JOIN technicians t ON t.id = o.technician_id WHERE o.id = ?`).get(Number(id));

/** Jobs and on-call shifts already booked for this person during the time off. */
export function clashes(db, r) {
  if (!r.technician_id) return { jobs: [], oncall: [] };
  const jobs = db.prepare(`SELECT sc.id, sc.number, sc.title, sc.scheduled_start, sc.duration_hours, c.name AS customer FROM service_calls sc JOIN customers c ON c.id = sc.customer_id
    WHERE sc.technician_id = ? AND sc.status NOT IN ('cancelled','completed') AND sc.scheduled_start IS NOT NULL AND sc.scheduled_start < ? AND sc.scheduled_start >= date(?, '-1 day')
    ORDER BY sc.scheduled_start`).all(r.technician_id, r.ends_at, r.starts_at)
    .filter(j => new Date(new Date(j.scheduled_start).getTime() + (Number(j.duration_hours) || 1) * 3600e3) > new Date(r.starts_at));
  const oncall = db.prepare(`SELECT id, starts_at, ends_at, technician_id = ? AS primary_role FROM on_call_shifts WHERE (technician_id = ? OR backup_technician_id = ?) AND starts_at < ? AND ends_at > ? ORDER BY starts_at`)
    .all(r.technician_id, r.technician_id, r.technician_id, r.ends_at, r.starts_at);
  return { jobs, oncall };
}

/** Approved time off overlapping a job window, if any. */
export function timeOffDuring(db, techId, start, end) {
  return db.prepare(`SELECT o.*, u.name AS user_name FROM time_off o JOIN users u ON u.id = o.user_id
    WHERE o.technician_id = ? AND o.status = 'approved' AND o.starts_at < ? AND o.ends_at > ? LIMIT 1`).get(techId, end, start) || null;
}

const pad = n => String(n).padStart(2, '0');
const addMin = (s, m) => { const d = new Date(new Date(s).getTime() + m * 60e3); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

// Booking a tech during approved time off is blocked (owners/admins can book anyway).
registerHooks('service_calls', {
  beforeSave(db, data, { existing, isCreate, user, body }) {
    if (body?.allow_conflict) return;
    const m = { ...existing, ...data };
    if (!m.technician_id || !m.scheduled_start || ['cancelled', 'completed'].includes(m.status)) return;
    const touched = isCreate || ['technician_id', 'scheduled_start', 'duration_hours'].some(k => k in data && data[k] !== existing?.[k]);
    if (!touched) return;
    const off = timeOffDuring(db, m.technician_id, m.scheduled_start, addMin(m.scheduled_start, (Number(m.duration_hours) || 1) * 60));
    if (!off) return;
    const canOverride = ['owner', 'admin'].includes(user?.role);
    const e = new HttpError(409, `${off.user_name} is off (${off.kind}) ${fmt(off.starts_at, off.ends_at, off.all_day)}.${canOverride ? ' Pick another tech or time, or book anyway.' : ' Pick another tech or time.'}`);
    e.code = 'conflict'; e.canOverride = canOverride; e.kind = 'time_off';
    throw e;
  },
});

async function tell(db, r, text) {
  const s = getSettings(db);
  const related = { type: 'time_off', id: r.id };
  if (r.tech_phone) await sendSms(db, { to: r.tech_phone, body: `${s.company_name}: ${text}`, related });
  if (r.user_email && mailConfig(db).ok) await sendEmail(db, { to: r.user_email, subject: text.split('.')[0], text: `${text}\n\n${s.company_name}`, related });
}

/** Company holidays as all-day calendar events. */
export function holidayEvents(db) {
  const stamp = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return db.prepare('SELECT * FROM company_holidays WHERE date >= ?').all(addDays(todayLocal(), -30)).map(h => [
    'BEGIN:VEVENT', `UID:holiday-${h.id}@secureops`, `DTSTAMP:${stamp(new Date())}`,
    `DTSTART;VALUE=DATE:${h.date.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${addDays(h.date, 1).replace(/-/g, '')}`,
    `SUMMARY:${String(h.name).replace(/[,;]/g, ' ')} — office closed`, 'TRANSP:TRANSPARENT', 'CATEGORIES:Holiday', 'END:VEVENT']);
}

/** Calendar events for approved time off (tech feed: their own; central: everyone). */
export function timeOffEvents(db, techId = null) {
  const s = getSettings(db);
  const stamp = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = v => String(v ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  return db.prepare(`SELECT o.*, u.name AS user_name FROM time_off o JOIN users u ON u.id = o.user_id
    WHERE o.status = 'approved' AND o.ends_at >= ? ${techId ? 'AND o.technician_id = ?' : 'AND o.technician_id IS NOT NULL'}`).all(addDays(todayLocal(), -30), ...(techId ? [techId] : []))
    .map(o => {
      const dates = o.all_day
        ? [`DTSTART;VALUE=DATE:${o.starts_at.slice(0, 10).replace(/-/g, '')}`, `DTEND;VALUE=DATE:${addDays(o.ends_at.slice(0, 10), 1).replace(/-/g, '')}`]
        : [`DTSTART:${stamp(zonedToUtc(o.starts_at, s.timezone))}`, `DTEND:${stamp(zonedToUtc(o.ends_at, s.timezone))}`];
      return ['BEGIN:VEVENT', `UID:timeoff-${o.id}@secureops`, `DTSTAMP:${stamp(new Date())}`, ...dates,
        `SUMMARY:${esc(techId ? `Time off (${o.kind})` : `Off: ${o.user_name} (${o.kind})`)}`, 'TRANSP:OPAQUE', 'STATUS:CONFIRMED', 'CATEGORIES:Time off', 'END:VEVENT'];
    });
}

export function registerTimeOffRoutes(r) {
  // mine=1: my own. Otherwise owners/admins see everyone's; supervisors see their team's.
  r('GET', '/api/time-off', G.all, ({ db, user, query }) => {
    const team = query.mine === '1' ? [] : MANAGE.includes(user.role) ? null : reportIds(db, user.id);
    const who = query.mine === '1' || (team && !team.length) ? 'o.user_id = ?' : team ? `o.user_id IN (${team.map(() => '?').join(',')})` : '1';
    const args = query.mine === '1' || (team && !team.length) ? [user.id] : team || [];
    const rows = db.prepare(`SELECT o.*, u.name AS user_name, s.name AS supervisor_name FROM time_off o JOIN users u ON u.id = o.user_id LEFT JOIN users s ON s.id = u.supervisor_id
      WHERE ${who} AND (o.ends_at >= ? OR o.status = 'pending') ORDER BY o.starts_at LIMIT 500`).all(...args, addDays(todayLocal(), -Number(query.days_back || 60)));
    return rows.map(x => {
      const can = x.status === 'pending' && canApprove(db, user, x.user_id);
      return { ...x, when: fmt(x.starts_at, x.ends_at, x.all_day), can_decide: can, ...(can ? { clashes: clashes(db, x) } : {}) };
    });
  });
  // Who's out (everyone can see who is off, not why)
  r('GET', '/api/time-off/out', G.all, ({ db, query }) => {
    const from = D.test(query.from || '') ? query.from : todayLocal();
    const to = D.test(query.to || '') ? query.to : addDays(from, 13);
    return db.prepare(`SELECT o.id, o.user_id, o.technician_id, o.starts_at, o.ends_at, o.all_day, u.name AS user_name FROM time_off o JOIN users u ON u.id = o.user_id
      WHERE o.status = 'approved' AND o.starts_at <= ? AND o.ends_at >= ? ORDER BY o.starts_at`).all(`${to}T23:59`, `${from}T00:00`)
      .map(x => ({ ...x, when: fmt(x.starts_at, x.ends_at, x.all_day) }));
  });
  r('POST', '/api/time-off', G.all, ({ db, user, body }) => {
    const forOther = body.user_id && Number(body.user_id) !== user.id;
    if (forOther && !MANAGE.includes(user.role) && !reportIds(db, user.id).includes(Number(body.user_id))) throw new HttpError(403, 'You can add time off only for people on your team');
    const forUser = forOther ? db.prepare('SELECT id, name, technician_id FROM users WHERE id = ? AND active = 1').get(Number(body.user_id)) : db.prepare('SELECT id, name, technician_id FROM users WHERE id = ?').get(user.id);
    if (!forUser) throw new HttpError(400, 'Choose a person');
    const kind = KINDS.includes(body.kind) ? body.kind : 'vacation';
    const allDay = body.all_day !== false && body.all_day !== '0';
    let start, end;
    if (allDay) {
      if (!D.test(body.start_date || '') || !D.test(body.end_date || body.start_date || '')) throw new HttpError(400, 'Choose the first and last day');
      start = `${body.start_date}T00:00`; end = `${body.end_date || body.start_date}T23:59`;
    } else {
      if (!DT.test(body.starts_at || '') || !DT.test(body.ends_at || '')) throw new HttpError(400, 'Choose the start and end time');
      start = body.starts_at; end = body.ends_at;
    }
    if (end <= start) throw new HttpError(400, 'The end must be after the start');
    if (end < `${todayLocal()}T00:00` && !MANAGE.includes(user.role)) throw new HttpError(400, 'That’s in the past');
    const overlap = db.prepare("SELECT id FROM time_off WHERE user_id = ? AND status IN ('pending','approved') AND starts_at < ? AND ends_at > ?").get(forUser.id, end, start);
    if (overlap) throw new HttpError(409, 'You already have time off requested for part of that period');
    const byManager = !!body.approve && canApprove(db, user, forUser.id);
    const hours = requestHours(db, { starts_at: start, ends_at: end, all_day: allDay });
    if (PTO_KINDS.includes(kind) && getSettings(db).pto_allow_negative !== '1' && !byManager) {
      const b = balances(db, forUser.id, Number(start.slice(0, 4)))[kind];
      if (hours > b.available) throw new HttpError(400, `That’s ${hours} hours of ${kind} time, and ${b.available} hours are left${b.pending ? ' (counting other pending requests)' : ''}. Talk to the office if you need more.`);
    }
    const id = Number(db.prepare(`INSERT INTO time_off (user_id, technician_id, kind, starts_at, ends_at, all_day, hours, note, status, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(forUser.id, forUser.technician_id || null, kind, start, end, allDay ? 1 : 0, hours, String(body.note || '').slice(0, 500) || null,
        byManager ? 'approved' : 'pending', byManager ? user.name : null, byManager ? nowLocal() : null).lastInsertRowid);
    const x = row(db, id);
    audit(db, user, byManager ? 'add time off' : 'request time off', 'users', forUser.id, `${kind} ${fmt(start, end, allDay)}`);
    if (!byManager) {
      const c = clashes(db, x);
      // The person's supervisor decides. Owners/admins also get every request unless Settings says
      // supervisors only (people with no supervisor always go to them).
      const s = getSettings(db);
      const sup = supervisorOf(db, forUser.id);
      const what = `${fmt(start, end, allDay)} (${kind})`;
      const tellPerson = p => {
        notifyPush(db, [p.id], { title: `${forUser.name} asked for time off`, body: what, url: `/#/time-off?req=${id}`, tag: `timeoff-${id}` });
        if (p.email && mailConfig(db).ok) queue(() => sendEmail(db, { to: p.email, subject: `Time off request: ${forUser.name}, ${fmt(start, end, allDay)}`, text: `${forUser.name} asked for time off: ${what}.${x.note ? `\n\n“${x.note}”` : ''}${sup && p.id !== sup.id ? `\n\nTheir supervisor, ${sup.name}, was asked too.` : ''}\n\nApprove or deny it in SecureOps → Time off.\n\n${s.company_name}`, related: { type: 'time_off', id } }));
      };
      if (sup) tellPerson(sup);
      if (!sup || s.timeoff_notify_managers !== '0') {
        for (const m of db.prepare("SELECT id, name, email FROM users WHERE active = 1 AND role IN ('owner','admin') AND id <> ?").all(forUser.id)) if (m.id !== sup?.id) tellPerson(m);
        raiseAlert(db, {
          kind: 'time_off', severity: 'info', title: `${forUser.name} requested time off: ${what}${sup ? ` · ${sup.name.split(' ')[0]} is their supervisor` : ''}`,
          body: `${x.note ? `“${x.note}”\n` : ''}${c.jobs.length ? `${c.jobs.length} job(s) already booked then.` : 'No jobs booked then.'}${c.oncall.length ? ` On call during part of it.` : ''}`,
          link: `#/time-off?req=${id}`, roles: 'owner,admin', notify: false,
        });
      }
    }
    return { ...x, when: fmt(start, end, allDay), clashes: clashes(db, x) };
  });
  r('POST', '/api/time-off/:id/decide', G.all, ({ db, user, params, body }) => {
    const x = row(db, params.id);
    if (!x) throw new HttpError(404, 'Request not found');
    if (!canApprove(db, user, x.user_id)) throw new HttpError(403, x.user_id === user.id ? 'Your own requests go to your supervisor' : 'Only their supervisor, an owner or an admin can decide this');
    if (x.status !== 'pending') throw new HttpError(409, `Already ${x.status}`);
    const approve = body.decision === 'approve';
    if (!approve && body.decision !== 'deny') throw new HttpError(400, 'Approve or deny');
    db.prepare('UPDATE time_off SET status = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?').run(approve ? 'approved' : 'denied', user.name, nowLocal(), String(body.note || '').slice(0, 500) || null, x.id);
    db.prepare("UPDATE alerts SET resolved_at = datetime('now','localtime'), resolved_by = ? WHERE kind = 'time_off' AND link = ? AND resolved_at IS NULL").run(user.name, `#/time-off?req=${x.id}`);
    audit(db, user, approve ? 'approve time off' : 'deny time off', 'users', x.user_id, `${fmt(x.starts_at, x.ends_at, x.all_day)}${body.note ? `: ${body.note}` : ''}`);
    queue(() => tell(db, x, `Your time off ${fmt(x.starts_at, x.ends_at, x.all_day)} was ${approve ? 'approved' : 'not approved'}${body.note ? ` — ${body.note}` : ''}.`));
    return { ok: true, status: approve ? 'approved' : 'denied', clashes: approve ? clashes(db, x) : { jobs: [], oncall: [] } };
  });
  r('POST', '/api/time-off/:id/cancel', G.all, ({ db, user, params }) => {
    const x = row(db, params.id);
    if (!x) throw new HttpError(404, 'Request not found');
    if (x.user_id !== user.id && !MANAGE.includes(user.role) && !reportIds(db, user.id).includes(x.user_id)) throw new HttpError(403, 'Not your request');
    if (!['pending', 'approved'].includes(x.status)) throw new HttpError(409, `Already ${x.status}`);
    db.prepare("UPDATE time_off SET status = 'cancelled', decided_by = COALESCE(decided_by, ?), decided_at = ? WHERE id = ?").run(user.name, nowLocal(), x.id);
    db.prepare("UPDATE alerts SET resolved_at = datetime('now','localtime'), resolved_by = ? WHERE kind = 'time_off' AND link = ? AND resolved_at IS NULL").run(user.name, `#/time-off?req=${x.id}`);
    audit(db, user, 'cancel time off', 'users', x.user_id, fmt(x.starts_at, x.ends_at, x.all_day));
    if (x.status === 'approved' && x.user_id !== user.id) queue(() => tell(db, x, `Your time off ${fmt(x.starts_at, x.ends_at, x.all_day)} was cancelled by ${user.name}.`));
    return { ok: true };
  });
}
