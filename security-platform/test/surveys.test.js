// Post-job customer surveys and technician ratings.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'secureops-survey-'));
process.env.DATA_DIR = tmp;
process.env.SMTP_HOST = 'json';
const { openDb } = await import('../server/db.js');
const { createServer } = await import('../server/server.js');
const { notifyIdle } = await import('../server/notify.js');
const { sendDueSurveys } = await import('../server/surveys.js');

let server, base, db;
before(async () => {
  db = openDb(':memory:');
  server = createServer(db);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

let cookie = '';
const call = async (method, url, body, { auth = true } = {}) => {
  const res = await fetch(base + url, { method, headers: { ...(auth ? { cookie } : {}), 'X-Requested-With': 'SecureOps', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie');
  if (sc && auth) cookie = sc.split(';')[0];
  return { status: res.status, data: await res.json().catch(() => null) };
};
const ids = {};
const stamp = h => { const d = new Date(Date.now() - h * 3600e3); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const doneJob = async (customer, tech, hoursAgo) => {
  const j = (await call('POST', '/api/r/service_calls', { customer_id: customer, title: 'Repair', technician_id: tech })).data;
  db.prepare("UPDATE service_calls SET status = 'completed', completed_at = ? WHERE id = ?").run(stamp(hoursAgo), j.id);
  return j.id;
};
const linkFor = jobId => db.prepare('SELECT token FROM job_surveys WHERE service_call_id = ?').get(jobId)?.token;

test('setup', async () => {
  await call('POST', '/api/auth/setup', { name: 'Owner', email: 'owner@example.com', password: 'password123', company_name: 'Survey Co' });
  await call('PUT', '/api/settings', { review_url: 'https://g.page/r/example/review' });
  ids.tess = (await call('POST', '/api/r/technicians', { name: 'Tess Tech' })).data.id;
  ids.bo = (await call('POST', '/api/r/technicians', { name: 'Bo Tech' })).data.id;
  ids.a = (await call('POST', '/api/r/customers', { name: 'Amy Adams', email: 'amy@example.com', notify_sms: 0 })).data.id;
  ids.b = (await call('POST', '/api/r/customers', { name: 'Ben Brown', email: 'ben@example.com', notify_sms: 0 })).data.id;
  ids.c = (await call('POST', '/api/r/customers', { name: 'No Surveys Inc', email: 'x@example.com', no_surveys: 1 })).data.id;
});

test('surveys go out a while after the job — once per job, not too often per customer, never to opted-out customers', async () => {
  ids.j1 = await doneJob(ids.a, ids.tess, 3);
  const tooSoon = await doneJob(ids.b, ids.bo, 0.5);
  await doneJob(ids.c, ids.tess, 5);
  assert.equal(sendDueSurveys(db), 1, 'only the job finished 2+ hours ago, and not the opted-out customer');
  await notifyIdle();
  const mail = db.prepare("SELECT * FROM notifications WHERE related_type = 'survey'").get();
  assert.equal(mail.to_addr, 'amy@example.com');
  assert.match(mail.body, /How did Tess do on your service call\?/);
  assert.match(mail.body, /\/survey\/[A-Za-z0-9_-]+/);
  assert.equal(sendDueSurveys(db), 0, 'never twice');
  assert.equal(linkFor(tooSoon), undefined);
  // Another job for Amy the same week isn't surveyed (30-day gap)
  await doneJob(ids.a, ids.bo, 3);
  assert.equal(sendDueSurveys(db), 0);
});

test('customer answers: stars, on time, comment; 5 stars offers the review link; low scores alert the owner', async () => {
  const t1 = linkFor(ids.j1);
  let v = (await call('GET', `/api/public/survey/${t1}`, undefined, { auth: false })).data;
  assert.equal(v.tech, 'Tess');
  assert.equal(v.answered, false);
  assert.equal((await call('POST', `/api/public/survey/${t1}`, { rating: 9 }, { auth: false })).status, 400);
  v = (await call('POST', `/api/public/survey/${t1}`, { rating: 5, tech_rating: 5, on_time: 'yes', comment: 'Tess was great!' }, { auth: false })).data;
  assert.equal(v.answered, true);
  assert.equal(v.review_url, 'https://g.page/r/example/review');
  assert.equal((await call('POST', `/api/public/survey/${t1}`, { rating: 1 }, { auth: false })).status, 409, 'one answer per survey');

  // Bo gets a bad one
  const j2 = await doneJob(ids.b, ids.bo, 4);
  sendDueSurveys(db);
  const t2 = linkFor(j2);
  v = (await call('POST', `/api/public/survey/${t2}`, { rating: 2, tech_rating: 3, on_time: 'no', comment: 'Showed up 2 hours late', contact_ok: true }, { auth: false })).data;
  assert.equal(v.review_url, null, 'only happy customers are sent to the review site');
  const alert = (await call('GET', '/api/alerts')).data.find(a => a.kind === 'survey_low');
  assert.match(alert.title, /★★☆☆☆ from Ben Brown/);
  assert.match(alert.body, /NOT on time.*Showed up 2 hours late.*OK to contact/s);
  ids.bad = db.prepare('SELECT id FROM job_surveys WHERE service_call_id = ?').get(j2).id;
  assert.equal((await call('GET', `/api/public/survey/${'x'.repeat(30)}`, undefined, { auth: false })).status, 404);
});

test('manager view: per-tech averages, response rate, on-time, comments; follow-up clears the alert; office can resend', async () => {
  const r = (await call('GET', '/api/ratings?days=90')).data;
  const tess = r.technicians.find(t => t.name === 'Tess Tech');
  const bo = r.technicians.find(t => t.name === 'Bo Tech');
  assert.deepEqual([tess.answered, tess.tech_avg, tess.on_time], [1, 5, 100]);
  assert.deepEqual([bo.answered, bo.tech_avg, bo.on_time, bo.low], [1, 3, 0, 1]);
  assert.equal(r.company.answered, 2);
  assert.equal(r.responses.length, 2);
  assert.equal((await call('POST', `/api/ratings/${ids.bad}/follow-up`, {})).status, 400);
  await call('POST', `/api/ratings/${ids.bad}/follow-up`, { note: 'Called Ben, apologized, credited the trip charge' });
  assert.ok(!(await call('GET', '/api/alerts')).data.some(a => a.kind === 'survey_low'));
  // Manual send for a job that wasn't surveyed automatically
  const j = await doneJob(ids.a, ids.tess, 1);
  assert.equal((await call('POST', `/api/service_calls/${j}/survey`)).status, 200);
  assert.ok(linkFor(j));
  assert.ok((await call('GET', `/api/service_calls/${j}/survey`)).data.sent_at);
  assert.equal((await fetch(`${base}/survey/${linkFor(j)}`)).status, 200, 'the survey page is served');
});
