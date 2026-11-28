// Tasks for people: "pick up the panel from ADI", "return the Amazon order", "deposit checks".
// One-time or repeating (daily, weekdays, weekly on chosen days, monthly, every N days).
// A repeating task makes a new to-do on each due date; if the last one is still open, it
// isn't duplicated (the open one just stays overdue).
import { G } from '../public/js/schema.js';
import { getSettings } from './db.js';
import { HttpError, todayLocal } from './resources.js';
import { notifyPush } from './push.js';
import { queue, sendEmail } from './notify.js';

export const FREQS = ['daily', 'weekdays', 'weekly', 'monthly'];
const PRIORITIES = ['low', 'normal', 'high'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isManager = u => G.manage.includes(u.role);

// ---- Dates (local calendar dates as YYYY-MM-DD) ----
const toD = s => new Date(`${s}T12:00:00Z`);
const fromD = d => d.toISOString().slice(0, 10);
const plusDays = (s, n) => { const d = toD(s); d.setUTCDate(d.getUTCDate() + n); return fromD(d); };
const dow = s => toD(s).getUTCDay();
const daysBetween = (a, b) => Math.round((toD(b) - toD(a)) / 86400e3);
const lastDayOfMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

function matches(s, date) {
  if (date < s.starts_on) return false;
  const n = Math.max(1, s.every_n || 1);
  switch (s.freq) {
    case 'daily': return daysBetween(s.starts_on, date) % n === 0;
    case 'weekdays': return dow(date) >= 1 && dow(date) <= 5;
    case 'weekly': {
      const days = String(s.weekdays || dow(s.starts_on)).split(',').map(Number);
      if (!days.includes(dow(date))) return false;
      const week0 = plusDays(s.starts_on, -dow(s.starts_on));
      return Math.floor(daysBetween(week0, date) / 7) % n === 0;
    }
    case 'monthly': {
      const d = toD(date), st = toD(s.starts_on);
      const months = (d.getUTCFullYear() - st.getUTCFullYear()) * 12 + d.getUTCMonth() - st.getUTCMonth();
      if (months % n !== 0) return false;
      const want = Math.min(s.month_day || st.getUTCDate(), lastDayOfMonth(d.getUTCFullYear(), d.getUTCMonth()));
      return d.getUTCDate() === want;
    }
    default: return false;
  }
}
/** First occurrence on or after `from` (null when the series has ended). */
export function nextOccurrence(s, from) {
  let d = from < s.starts_on ? s.starts_on : from;
  for (let i = 0; i < 800; i++, d = plusDays(d, 1)) {
    if (s.ends_on && d > s.ends_on) return null;
    if (matches(s, d)) return d;
  }
  return null;
}

export function describeRepeat(s) {
  const n = Math.max(1, s.every_n || 1);
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const ord = d => `${d}${d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th'}`;
  let t;
  if (s.freq === 'daily') t = n === 1 ? 'Every day' : `Every ${n} days`;
  else if (s.freq === 'weekdays') t = 'Every weekday';
  else if (s.freq === 'weekly') t = `${n === 1 ? 'Every week' : `Every ${n} weeks`} on ${String(s.weekdays || dow(s.starts_on)).split(',').map(x => names[Number(x)]).join(', ')}`;
  else t = `${n === 1 ? 'Every month' : `Every ${n} months`} on the ${ord(s.month_day || toD(s.starts_on).getUTCDate())}`;
  return s.ends_on ? `${t} until ${s.ends_on}` : t;
}

// ---- Notifications ----
function tell(db, userId, note, email) {
  if (!userId) return;
  notifyPush(db, [userId], note);
  if (email && getSettings(db).task_email === '1') {
    const u = db.prepare('SELECT email FROM users WHERE id = ? AND active = 1').get(userId);
    if (u?.email) queue(() => sendEmail(db, { to: u.email, subject: email.subject, text: email.text, related: { type: 'task', id: email.taskId } }));
  }
}
function announceAssigned(db, task, actor) {
  if (!task.assigned_to || task.assigned_to === actor?.id) return;
  const from = actor?.name || 'SecureOps';
  const due = task.due_date ? ` (due ${task.due_date})` : '';
  tell(db, task.assigned_to, { title: `New task from ${from}`, body: `${task.title}${due}`, url: '/#/tasks', tag: `task-${task.id}` },
    { subject: `New task: ${task.title}`, text: `${from} gave you a task${due}:\n\n${task.title}${task.notes ? `\n\n${task.notes}` : ''}${task.location ? `\n\nWhere: ${task.location}` : ''}\n\nOpen SecureOps → Tasks to mark it done.`, taskId: task.id });
}

// ---- Recurring generation ----
function createTask(db, data, actor) {
  const id = Number(db.prepare(`INSERT INTO tasks (title, notes, assigned_to, created_by, due_date, priority, location, customer_id, series_id)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(data.title, data.notes || null, data.assigned_to || null, data.created_by ?? actor?.id ?? null, data.due_date || null,
    data.priority || 'normal', data.location || null, data.customer_id || null, data.series_id || null).lastInsertRowid);
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
}

/** Make today's task for every repeating series that is due. Safe to run any time. */
export function runRecurring(db, today = todayLocal()) {
  let made = 0;
  for (const s of db.prepare('SELECT * FROM task_series WHERE active = 1 AND next_date IS NOT NULL AND next_date <= ?').all(today)) {
    // If several dates were missed (server off), only the latest one becomes a task.
    let due = s.next_date, n;
    while ((n = nextOccurrence(s, plusDays(due, 1))) && n <= today) due = n;
    const open = db.prepare("SELECT id FROM tasks WHERE series_id = ? AND status = 'open'").get(s.id);
    if (!open && !db.prepare('SELECT 1 FROM tasks WHERE series_id = ? AND due_date = ?').get(s.id, due)) {
      const creator = s.created_by ? db.prepare('SELECT id, name FROM users WHERE id = ?').get(s.created_by) : null;
      const t = createTask(db, { ...s, due_date: due, series_id: s.id, created_by: s.created_by }, creator);
      made++;
      announceAssigned(db, t, creator);
    }
    const next = nextOccurrence(s, plusDays(due, 1));
    db.prepare('UPDATE task_series SET next_date = ?, active = ? WHERE id = ?').run(next, next ? 1 : 0, s.id);
  }
  return made;
}

/** Once a day (after 7am): a push reminder to anyone with tasks due today or overdue. */
export function taskReminders(db, now = new Date()) {
  if (now.getHours() < 7) return 0;
  const today = todayLocal();
  const rows = db.prepare(`SELECT assigned_to AS uid, COUNT(*) AS n, SUM(due_date < ?) AS late FROM tasks
    WHERE status = 'open' AND assigned_to IS NOT NULL AND due_date IS NOT NULL AND due_date <= ? GROUP BY assigned_to`).all(today, today);
  let sent = 0;
  for (const r of rows) {
    const tag = `tasks-daily-${today}`;
    if (db.prepare('SELECT 1 FROM push_notes WHERE user_id = ? AND tag = ?').get(r.uid, tag)) continue;
    notifyPush(db, [r.uid], { title: `${r.n} task${r.n > 1 ? 's' : ''} for today`, body: r.late ? `${r.late} overdue` : 'Tap to see them', url: '/#/tasks', tag });
    sent++;
  }
  return sent;
}

// ---- Access ----
function getTask(db, id) {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(Number(id));
  if (!t) throw new HttpError(404, 'Task not found');
  return t;
}
const canSee = (t, u) => isManager(u) || t.assigned_to === u.id || t.created_by === u.id;
const canEdit = (t, u) => isManager(u) || t.created_by === u.id || t.assigned_to === u.id;
const canDelete = (t, u) => isManager(u) || t.created_by === u.id;

function clean(db, body, partial = false) {
  const out = {};
  if (!partial || 'title' in body) {
    out.title = String(body.title || '').trim().slice(0, 200);
    if (!out.title) throw new HttpError(400, 'What needs to be done?');
  }
  if (!partial || 'notes' in body) out.notes = String(body.notes || '').slice(0, 4000) || null;
  if (!partial || 'location' in body) out.location = String(body.location || '').slice(0, 300) || null;
  if (!partial || 'priority' in body) out.priority = PRIORITIES.includes(body.priority) ? body.priority : 'normal';
  if (!partial || 'due_date' in body) {
    if (body.due_date && !DAY.test(body.due_date)) throw new HttpError(400, 'Due date must be a date');
    out.due_date = body.due_date || null;
  }
  if (!partial || 'assigned_to' in body) {
    out.assigned_to = body.assigned_to ? Number(body.assigned_to) : null;
    if (out.assigned_to && !db.prepare('SELECT 1 FROM users WHERE id = ? AND active = 1').get(out.assigned_to)) throw new HttpError(400, 'Choose someone on the team');
  }
  if (!partial || 'customer_id' in body) {
    out.customer_id = body.customer_id ? Number(body.customer_id) : null;
    if (out.customer_id && !db.prepare('SELECT 1 FROM customers WHERE id = ?').get(out.customer_id)) throw new HttpError(400, 'Customer not found');
  }
  return out;
}
function cleanRepeat(r, startDefault) {
  if (!FREQS.includes(r?.freq)) throw new HttpError(400, 'Choose how often it repeats');
  const s = {
    freq: r.freq, every_n: Math.min(365, Math.max(1, Math.round(Number(r.every_n) || 1))),
    weekdays: null, month_day: null, starts_on: DAY.test(r.starts_on || '') ? r.starts_on : startDefault, ends_on: DAY.test(r.ends_on || '') ? r.ends_on : null,
  };
  if (s.freq === 'weekly') {
    const days = [...new Set(String(r.weekdays ?? '').split(',').filter(x => /^[0-6]$/.test(x.trim())).map(Number))].sort();
    s.weekdays = (days.length ? days : [dow(s.starts_on)]).join(',');
  }
  if (s.freq === 'monthly') s.month_day = Math.min(31, Math.max(1, Math.round(Number(r.month_day) || toD(s.starts_on).getUTCDate())));
  if (s.ends_on && s.ends_on < s.starts_on) throw new HttpError(400, 'The end date is before the start date');
  return s;
}

const SELECT = `SELECT t.*, a.name AS assigned_name, c.name AS created_name, d.name AS done_name, cu.name AS customer_name,
    s.freq, s.every_n, s.weekdays, s.month_day, s.starts_on, s.ends_on, s.active AS series_active
  FROM tasks t LEFT JOIN users a ON a.id = t.assigned_to LEFT JOIN users c ON c.id = t.created_by LEFT JOIN users d ON d.id = t.done_by
  LEFT JOIN customers cu ON cu.id = t.customer_id LEFT JOIN task_series s ON s.id = t.series_id`;
const withRepeat = t => ({ ...t, repeat: t.series_id && t.freq ? describeRepeat(t) : null });

export function listTasks(db, user, view = 'mine') {
  const today = todayLocal();
  let where, args = [];
  if (view === 'assigned') { where = "t.created_by = ? AND (t.assigned_to IS NULL OR t.assigned_to <> ?) AND (t.status = 'open' OR t.done_at >= date(?, '-14 days'))"; args = [user.id, user.id, today]; }
  else if (view === 'all' && isManager(user)) { where = "t.status = 'open'"; }
  else if (view === 'done') { where = `t.status = 'done' AND t.done_at >= date(?, '-60 days')${isManager(user) ? '' : ' AND (t.assigned_to = ? OR t.created_by = ?)'}`; args = isManager(user) ? [today] : [today, user.id, user.id]; }
  else { where = "t.assigned_to = ? AND (t.status = 'open' OR t.done_at >= date(?, 'start of day'))"; args = [user.id, today]; }
  return db.prepare(`${SELECT} WHERE ${where} ORDER BY t.status = 'done', t.due_date IS NULL, t.due_date, t.priority = 'high' DESC, t.id LIMIT 500`).all(...args).map(withRepeat);
}

export function taskSummary(db, user) {
  const today = todayLocal();
  const r = db.prepare(`SELECT COUNT(*) AS open, COALESCE(SUM(due_date = ?), 0) AS today, COALESCE(SUM(due_date < ?), 0) AS overdue
    FROM tasks WHERE status = 'open' AND assigned_to = ?`).get(today, today, user.id);
  return { open: r.open, due_today: r.today, overdue: r.overdue, due: r.today + r.overdue };
}

export function registerTaskRoutes(r) {
  r('GET', '/api/tasks', G.all, ({ db, user, query }) => listTasks(db, user, query.view));
  r('GET', '/api/tasks/summary', G.all, ({ db, user }) => taskSummary(db, user));
  r('GET', '/api/tasks/people', G.all, ({ db }) => db.prepare('SELECT id, name, role FROM users WHERE active = 1 ORDER BY name').all());
  r('GET', '/api/tasks/:id', G.all, ({ db, user, params }) => {
    const t = db.prepare(`${SELECT} WHERE t.id = ?`).get(Number(params.id));
    if (!t || !canSee(t, user)) throw new HttpError(404, 'Task not found');
    return withRepeat(t);
  });
  r('POST', '/api/tasks', G.all, ({ db, user, body }) => {
    const data = clean(db, body);
    if (!('assigned_to' in body)) data.assigned_to = user.id;
    if (body.repeat) {
      const rep = cleanRepeat(body.repeat, data.due_date || todayLocal());
      const first = nextOccurrence(rep, rep.starts_on);
      if (!first) throw new HttpError(400, 'That schedule never comes up. Check the dates.');
      const sid = Number(db.prepare(`INSERT INTO task_series (title, notes, assigned_to, priority, location, customer_id, freq, every_n, weekdays, month_day, starts_on, ends_on, next_date, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(data.title, data.notes, data.assigned_to, data.priority, data.location, data.customer_id,
        rep.freq, rep.every_n, rep.weekdays, rep.month_day, rep.starts_on, rep.ends_on, first, user.id).lastInsertRowid);
      runRecurring(db);
      const made = db.prepare('SELECT id FROM tasks WHERE series_id = ? ORDER BY id DESC').get(sid);
      return { series_id: sid, id: made?.id ?? null, next_date: first, repeat: describeRepeat(rep) };
    }
    const t = createTask(db, data, user);
    announceAssigned(db, t, user);
    return { id: t.id };
  });
  r('PUT', '/api/tasks/:id', G.all, ({ db, user, params, body }) => {
    const t = getTask(db, params.id);
    if (!canEdit(t, user)) throw new HttpError(403, 'Only the person who made this task, the person doing it, or a manager can change it');
    const data = clean(db, body, true);
    const keys = Object.keys(data);
    if (keys.length) db.prepare(`UPDATE tasks SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = datetime('now','localtime') WHERE id = ?`).run(...keys.map(k => data[k]), t.id);
    const after = getTask(db, t.id);
    if (after.assigned_to !== t.assigned_to) announceAssigned(db, after, user);
    return { ok: true };
  });
  r('POST', '/api/tasks/:id/done', G.all, ({ db, user, params, body }) => {
    const t = getTask(db, params.id);
    if (!canEdit(t, user)) throw new HttpError(403, 'Not your task');
    if (t.status === 'done') return { ok: true };
    db.prepare("UPDATE tasks SET status = 'done', done_at = datetime('now','localtime'), done_by = ?, done_note = ? WHERE id = ?").run(user.id, String(body.note || '').slice(0, 1000) || null, t.id);
    if (t.created_by && t.created_by !== user.id) {
      notifyPush(db, [t.created_by], { title: `${user.name} finished a task`, body: `${t.title}${body.note ? ` — ${String(body.note).slice(0, 120)}` : ''}`, url: '/#/tasks?view=assigned', tag: `task-${t.id}` });
    }
    return { ok: true };
  });
  r('POST', '/api/tasks/:id/reopen', G.all, ({ db, user, params }) => {
    const t = getTask(db, params.id);
    if (!canEdit(t, user)) throw new HttpError(403, 'Not your task');
    db.prepare("UPDATE tasks SET status = 'open', done_at = NULL, done_by = NULL, done_note = NULL WHERE id = ?").run(t.id);
    return { ok: true };
  });
  r('DELETE', '/api/tasks/:id', G.all, ({ db, user, params }) => {
    const t = getTask(db, params.id);
    if (!canDelete(t, user)) throw new HttpError(403, 'Only the person who made this task or a manager can delete it');
    db.prepare('DELETE FROM tasks WHERE id = ?').run(t.id);
    return { ok: true };
  });

  // Repeating tasks
  const seriesFor = (db, user) => db.prepare(`SELECT s.*, a.name AS assigned_name, c.name AS created_name FROM task_series s
      LEFT JOIN users a ON a.id = s.assigned_to LEFT JOIN users c ON c.id = s.created_by
      ${isManager(user) ? '' : 'WHERE s.created_by = ? OR s.assigned_to = ?'} ORDER BY s.active DESC, s.title`)
    .all(...(isManager(user) ? [] : [user.id, user.id])).map(s => ({ ...s, repeat: describeRepeat(s) }));
  r('GET', '/api/task-series', G.all, ({ db, user }) => seriesFor(db, user));
  r('PUT', '/api/task-series/:id', G.all, ({ db, user, params, body }) => {
    const s = db.prepare('SELECT * FROM task_series WHERE id = ?').get(Number(params.id));
    if (!s || !(isManager(user) || s.created_by === user.id)) throw new HttpError(404, 'Not found');
    const data = clean(db, { ...s, ...body });
    const rep = body.repeat ? cleanRepeat(body.repeat, s.starts_on) : s;
    const active = body.active === undefined ? s.active : body.active ? 1 : 0;
    const next = active ? nextOccurrence(rep, todayLocal() > rep.starts_on ? todayLocal() : rep.starts_on) : s.next_date;
    db.prepare(`UPDATE task_series SET title=?, notes=?, assigned_to=?, priority=?, location=?, customer_id=?, freq=?, every_n=?, weekdays=?, month_day=?, starts_on=?, ends_on=?, next_date=?, active=? WHERE id = ?`)
      .run(data.title, data.notes, data.assigned_to, data.priority, data.location, data.customer_id, rep.freq, rep.every_n, rep.weekdays, rep.month_day, rep.starts_on, rep.ends_on, next, active && next ? 1 : 0, s.id);
    // Keep the open to-do in step with the new title / person.
    db.prepare("UPDATE tasks SET title = ?, notes = ?, assigned_to = ?, priority = ?, location = ? WHERE series_id = ? AND status = 'open'").run(data.title, data.notes, data.assigned_to, data.priority, data.location, s.id);
    runRecurring(db);
    return { ok: true, next_date: next };
  });
  r('DELETE', '/api/task-series/:id', G.all, ({ db, user, params, query }) => {
    const s = db.prepare('SELECT * FROM task_series WHERE id = ?').get(Number(params.id));
    if (!s || !(isManager(user) || s.created_by === user.id)) throw new HttpError(404, 'Not found');
    // Stop repeating; the open to-do is removed too unless asked to keep it.
    if (query.keep_open !== '1') db.prepare("DELETE FROM tasks WHERE series_id = ? AND status = 'open'").run(s.id);
    db.prepare('DELETE FROM task_series WHERE id = ?').run(s.id);
    return { ok: true };
  });
}
