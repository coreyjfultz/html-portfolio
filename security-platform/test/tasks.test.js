// Tasks for people, including repeating tasks.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'secureops-tasks-'));
process.env.DATA_DIR = tmp;
const { openDb } = await import('../server/db.js');
const { createServer } = await import('../server/server.js');
const { nextOccurrence, describeRepeat, runRecurring, taskReminders } = await import('../server/tasks.js');
const { todayLocal } = await import('../server/resources.js');

let server, base, db;
before(async () => {
  db = openDb(':memory:');
  server = createServer(db);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

function client() {
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { cookie, 'X-Requested-With': 'SecureOps', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  return { get: u => call('GET', u), post: (u, b = {}) => call('POST', u, b), put: (u, b = {}) => call('PUT', u, b), del: u => call('DELETE', u) };
}
const owner = client(), tess = client(), bo = client(), ann = client();
const ids = {};
const today = todayLocal();
const plus = n => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

test('setup', async () => {
  await owner.post('/api/auth/setup', { name: 'Olivia Owner', email: 'owner@example.com', password: 'password123', company_name: 'Task Co' });
  for (const [c, name, email, role] of [[tess, 'Tess Tech', 'tess@example.com', 'technician'], [bo, 'Bo Tech', 'bo@example.com', 'technician'], [ann, 'Ann Accounting', 'ann@example.com', 'accounting']]) {
    ids[name] = (await owner.post('/api/users', { name, email, password: 'password123', role })).data.id;
    await c.post('/api/auth/login', { email, password: 'password123' });
  }
  ids.owner = db.prepare("SELECT id FROM users WHERE email = 'owner@example.com'").get().id;
});

test('repeat rules', () => {
  const s = (o) => ({ every_n: 1, starts_on: '2026-11-02', ends_on: null, ...o }); // Mon Nov 2 2026
  assert.equal(nextOccurrence(s({ freq: 'daily' }), '2026-11-05'), '2026-11-05');
  assert.equal(nextOccurrence(s({ freq: 'daily', every_n: 3 }), '2026-11-03'), '2026-11-05');
  assert.equal(nextOccurrence(s({ freq: 'weekdays' }), '2026-11-07'), '2026-11-09'); // Sat → Mon
  assert.equal(nextOccurrence(s({ freq: 'weekly', weekdays: '5' }), '2026-11-02'), '2026-11-06'); // Fridays
  assert.equal(nextOccurrence(s({ freq: 'weekly', weekdays: '1,4', every_n: 2 }), '2026-11-06'), '2026-11-16'); // every other week
  assert.equal(nextOccurrence(s({ freq: 'monthly', month_day: 31 }), '2026-11-03'), '2026-11-30'); // short month → last day
  assert.equal(nextOccurrence(s({ freq: 'monthly', month_day: 15, every_n: 3 }), '2026-11-16'), '2027-02-15');
  assert.equal(nextOccurrence(s({ freq: 'daily', ends_on: '2026-11-04' }), '2026-11-05'), null);
  assert.equal(describeRepeat(s({ freq: 'weekly', weekdays: '1,5' })), 'Every week on Mon, Fri');
  assert.equal(describeRepeat(s({ freq: 'monthly', month_day: 1, every_n: 2 })), 'Every 2 months on the 1st');
  assert.equal(describeRepeat(s({ freq: 'monthly', month_day: 22 })), 'Every month on the 22nd');
  assert.equal(describeRepeat(s({ freq: 'monthly', month_day: 12 })), 'Every month on the 12th');
});

test('one-time tasks: assign, see, complete, notify', async () => {
  const r = await owner.post('/api/tasks', { title: 'Pick up the IQ4 panels from ADI', assigned_to: ids['Tess Tech'], due_date: today, priority: 'high', location: 'ADI Dayton will-call' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  ids.t1 = r.data.id;
  // Assignee gets a phone note
  const note = db.prepare('SELECT * FROM push_notes WHERE user_id = ? ORDER BY id DESC').get(ids['Tess Tech']);
  assert.match(note.title, /New task from Olivia Owner/);
  assert.match(note.body, /IQ4 panels/);
  const latest = await tess.get('/api/push/latest');
  assert.match(latest.data.title, /New task/);
  assert.equal((await tess.get('/api/push/latest')).data, null); // shown once
  // Email queued (task_email on by default)
  await new Promise(r2 => setTimeout(r2, 50));
  assert.ok(db.prepare("SELECT 1 FROM notifications WHERE related_type = 'task' AND related_id = ?").get(ids.t1));

  const mine = await tess.get('/api/tasks');
  assert.equal(mine.data.length, 1);
  assert.equal(mine.data[0].assigned_name, 'Tess Tech');
  assert.equal((await bo.get('/api/tasks')).data.length, 0);
  assert.equal((await bo.get(`/api/tasks/${ids.t1}`)).status, 404); // not Bo's
  assert.equal((await bo.post(`/api/tasks/${ids.t1}/done`)).status, 403);
  assert.deepEqual((await tess.get('/api/tasks/summary')).data, { open: 1, due_today: 1, overdue: 0, due: 1 });

  // Techs can make their own tasks (default: assigned to themselves) and assign to others
  const own = await bo.post('/api/tasks', { title: 'Return Amazon order', due_date: plus(-1) });
  assert.equal(db.prepare('SELECT assigned_to FROM tasks WHERE id = ?').get(own.data.id).assigned_to, ids['Bo Tech']);
  assert.equal((await bo.get('/api/tasks/summary')).data.overdue, 1);
  const ask = await bo.post('/api/tasks', { title: 'Order more 18/4 wire', assigned_to: ids['Ann Accounting'] });
  assert.equal((await bo.get('/api/tasks?view=assigned')).data[0].id, ask.data.id);
  assert.equal((await ann.del(`/api/tasks/${ask.data.id}`)).status, 403); // assignee can't delete
  assert.equal((await ann.put(`/api/tasks/${ask.data.id}`, { due_date: plus(2) })).status, 200); // but can change the date

  // Complete → creator is told
  assert.equal((await tess.post(`/api/tasks/${ids.t1}/done`, { note: 'In the truck' })).status, 200);
  const back = db.prepare('SELECT * FROM push_notes WHERE user_id = ? ORDER BY id DESC').get(ids.owner);
  assert.match(back.title, /Tess Tech finished a task/);
  assert.match(back.body, /In the truck/);
  assert.equal((await tess.get('/api/tasks/summary')).data.open, 0);
  assert.equal((await tess.get('/api/tasks')).data[0].status, 'done'); // done today still shows
  assert.equal((await owner.get('/api/tasks?view=done')).data.length, 1);
  await tess.post(`/api/tasks/${ids.t1}/reopen`);
  assert.equal((await tess.get('/api/tasks/summary')).data.open, 1);
  await tess.post(`/api/tasks/${ids.t1}/done`);

  // Managers see everything open; others can't use that view
  assert.ok((await owner.get('/api/tasks?view=all')).data.length >= 2);
  assert.ok((await tess.get('/api/tasks?view=all')).data.every(t => t.assigned_to === ids['Tess Tech']));
  // Reassigning tells the new person
  await owner.put(`/api/tasks/${own.data.id}`, { assigned_to: ids['Tess Tech'] });
  assert.match(db.prepare('SELECT title FROM push_notes WHERE user_id = ? ORDER BY id DESC').get(ids['Tess Tech']).title, /New task/);
  assert.equal((await owner.post('/api/tasks', { title: '' })).status, 400);
  assert.equal((await owner.post('/api/tasks', { title: 'x', assigned_to: 9999 })).status, 400);
});

test('repeating tasks: created on schedule, not piled up, stop', async () => {
  // Starts today, every day → today's task is made right away
  const r = await owner.post('/api/tasks', { title: 'Deposit checks at the bank', assigned_to: ids['Ann Accounting'], repeat: { freq: 'daily', starts_on: today } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  ids.series = r.data.series_id;
  assert.ok(r.data.id);
  assert.equal(r.data.repeat, 'Every day');
  let t = (await ann.get('/api/tasks')).data.find(x => x.series_id === ids.series);
  assert.equal(t.due_date, today);
  assert.equal(t.repeat, 'Every day');
  // Running again the same day makes nothing new
  assert.equal(runRecurring(db, today), 0);
  // Next day, previous still open → not duplicated
  assert.equal(runRecurring(db, plus(1)), 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE series_id = ?').get(ids.series).n, 1);
  // Done → the next run makes the next one
  await ann.post(`/api/tasks/${t.id}/done`);
  assert.equal(runRecurring(db, plus(2)), 1);
  t = db.prepare("SELECT * FROM tasks WHERE series_id = ? AND status = 'open'").get(ids.series);
  assert.equal(t.due_date, plus(2));
  assert.equal(db.prepare('SELECT next_date FROM task_series WHERE id = ?').get(ids.series).next_date, plus(3));

  // Weekly in the future: nothing yet
  const w = await owner.post('/api/tasks', { title: 'Truck wash', assigned_to: ids['Bo Tech'], repeat: { freq: 'weekly', weekdays: '5', starts_on: plus(1) } });
  assert.equal(w.data.id, null);
  assert.ok(w.data.next_date > today);
  // Bad schedule
  assert.equal((await owner.post('/api/tasks', { title: 'x', repeat: { freq: 'hourly' } })).status, 400);
  assert.equal((await owner.post('/api/tasks', { title: 'x', repeat: { freq: 'daily', starts_on: plus(5), ends_on: plus(1) } })).status, 400);

  // Series list and edit (only creator/manager)
  const list = await ann.get('/api/task-series');
  assert.equal(list.data.length, 1); // Ann sees the one assigned to her
  assert.equal((await ann.put(`/api/task-series/${ids.series}`, { title: 'Hack' })).status, 404);
  assert.equal((await owner.put(`/api/task-series/${ids.series}`, { title: 'Deposit checks (Fifth Third)', repeat: { freq: 'weekdays' } })).status, 200);
  assert.equal(db.prepare("SELECT title FROM tasks WHERE series_id = ? AND status = 'open'").get(ids.series).title, 'Deposit checks (Fifth Third)');
  assert.equal((await owner.get('/api/task-series')).data.find(s => s.id === ids.series).repeat, 'Every weekday');
  // Stop repeating removes the open to-do
  assert.equal((await owner.del(`/api/task-series/${ids.series}`)).status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE series_id = ? AND status = 'open'").get(ids.series).n, 0);
});

test('daily reminder goes once per person', () => {
  const at8 = new Date(); at8.setHours(8);
  const at5 = new Date(); at5.setHours(5);
  db.prepare("INSERT INTO tasks (title, assigned_to, due_date) VALUES ('Overdue thing', ?, ?)").run(ids['Bo Tech'], plus(-3));
  assert.equal(taskReminders(db, at5), 0);
  const n = taskReminders(db, at8);
  assert.ok(n >= 1);
  assert.equal(taskReminders(db, at8), 0);
  const note = db.prepare("SELECT * FROM push_notes WHERE user_id = ? AND tag LIKE 'tasks-daily-%'").get(ids['Bo Tech']);
  assert.match(note.body, /overdue/);
});
