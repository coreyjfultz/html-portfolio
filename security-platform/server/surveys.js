// Post-job customer survey and technician ratings.
// A while after a job is completed the customer gets a short link by text/email (per their
// preferences). Low scores alert the owner; managers see each technician's ratings.
import crypto from 'node:crypto';
import { G } from '../public/js/schema.js';
import { getSettings, DEFAULT_TEMPLATES as SURVEY_TEMPLATES } from './db.js';
import { HttpError, nowLocal, todayLocal, addDays } from './resources.js';
import { audit } from './security.js';
import { queue, sendSms, sendEmail, appUrl, fill } from './notify.js';
import { raiseAlert } from './alerts.js';

const MANAGE = G.manage;
const TOKEN = /^[A-Za-z0-9_-]{24,64}$/;
const localStamp = d => { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };


/** Create (but don't send) a survey for a completed job. */
export function createSurvey(db, callId) {
  const c = db.prepare('SELECT id, customer_id, technician_id FROM service_calls WHERE id = ?').get(callId);
  if (!c) throw new HttpError(404, 'Service call not found');
  const existing = db.prepare('SELECT * FROM job_surveys WHERE service_call_id = ?').get(c.id);
  if (existing) return existing;
  const id = Number(db.prepare('INSERT INTO job_surveys (service_call_id, customer_id, technician_id, token) VALUES (?,?,?,?)')
    .run(c.id, c.customer_id, c.technician_id, crypto.randomBytes(24).toString('base64url')).lastInsertRowid);
  return db.prepare('SELECT * FROM job_surveys WHERE id = ?').get(id);
}

async function deliver(db, survey) {
  const s = getSettings(db);
  const call = db.prepare(`SELECT sc.*, t.name AS tech_name FROM service_calls sc LEFT JOIN technicians t ON t.id = sc.technician_id WHERE sc.id = ?`).get(survey.service_call_id);
  const cust = db.prepare('SELECT * FROM customers WHERE id = ?').get(survey.customer_id);
  const link = `${appUrl(db)}/survey/${survey.token}`;
  const vars = {
    company: s.company_name, customer: cust.contact_name || cust.name, tech: call.tech_name ? call.tech_name.split(' ')[0] : 'our technician', link,
    type: { installation: 'installation', inspection: 'inspection', maintenance: 'maintenance visit', warranty: 'service visit' }[call.call_type] || 'service call',
  };
  const related = { type: 'survey', id: survey.id };
  const site = call.site_id ? db.prepare('SELECT phone FROM locations WHERE id = ?').get(call.site_id) : null;
  const sent = [];
  if (cust.notify_sms && (site?.phone || cust.phone) && await sendSms(db, { to: site?.phone || cust.phone, body: fill(s.tpl_survey_sms || SURVEY_TEMPLATES.tpl_survey_sms, vars), related })) sent.push('text');
  if (cust.notify_email && cust.email && await sendEmail(db, { to: cust.email, subject: `How did we do? — ${s.company_name}`, text: fill(s.tpl_survey_email || SURVEY_TEMPLATES.tpl_survey_email, vars), related })) sent.push('email');
  db.prepare('UPDATE job_surveys SET sent_at = ?, channel = ? WHERE id = ?').run(nowLocal(), sent.join(' + ') || 'not delivered', survey.id);
}

/** Every few minutes: survey jobs completed at least `survey_delay_hours` ago (within the last 3 days). */
export function sendDueSurveys(db, now = new Date()) {
  const s = getSettings(db);
  if (s.survey_enabled !== '1') return 0;
  const delayH = Math.max(0, Number(s.survey_delay_hours) || 0);
  const cutoff = localStamp(new Date(now.getTime() - delayH * 3600e3));
  const oldest = localStamp(new Date(now.getTime() - 3 * 86400e3));
  const skipTypes = String(s.survey_skip_types || '').split(',').map(x => x.trim()).filter(Boolean);
  const gap = Math.max(0, Number(s.survey_min_days) || 0);
  const calls = db.prepare(`SELECT sc.id, sc.customer_id, sc.call_type FROM service_calls sc JOIN customers c ON c.id = sc.customer_id
    WHERE sc.status = 'completed' AND sc.completed_at IS NOT NULL AND sc.completed_at <= ? AND sc.completed_at >= ? AND sc.technician_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM job_surveys j WHERE j.service_call_id = sc.id) AND COALESCE(c.no_surveys, 0) = 0`).all(cutoff, oldest);
  let n = 0;
  for (const c of calls) {
    if (skipTypes.includes(c.call_type)) continue;
    // Don't pester: at most one survey per customer every `survey_min_days` days.
    if (gap && db.prepare('SELECT 1 FROM job_surveys WHERE customer_id = ? AND sent_at >= ?').get(c.customer_id, addDays(todayLocal(), -gap))) continue;
    const sv = createSurvey(db, c.id);
    db.prepare("UPDATE job_surveys SET sent_at = ? WHERE id = ?").run(nowLocal(), sv.id); // claim it now so it's never sent twice
    queue(() => deliver(db, sv));
    n++;
  }
  return n;
}

function publicView(db, sv) {
  const s = getSettings(db);
  const call = db.prepare(`SELECT sc.title, sc.completed_at, sc.call_type, t.name AS tech_name FROM service_calls sc LEFT JOIN technicians t ON t.id = sc.technician_id WHERE sc.id = ?`).get(sv.service_call_id);
  return {
    company: { name: s.company_name, phone: s.company_phone, logo: !!s.logo_key },
    tech: call?.tech_name ? call.tech_name.split(' ')[0] : null, job: call?.title, date: call?.completed_at?.slice(0, 10),
    answered: !!sv.responded_at, rating: sv.rating, review_url: sv.responded_at && sv.rating >= 5 ? s.review_url || null : null,
  };
}

export function registerSurveyRoutes(r) {
  // Customer side (no login; unguessable link)
  const byToken = (db, t) => {
    const sv = TOKEN.test(t) && db.prepare('SELECT * FROM job_surveys WHERE token = ?').get(t);
    if (!sv) throw new HttpError(404, 'This survey link is not valid');
    return sv;
  };
  r('GET', '/api/public/survey/:token', null, ({ db, params }) => {
    const sv = byToken(db, params.token);
    if (!sv.opened_at) db.prepare('UPDATE job_surveys SET opened_at = ? WHERE id = ?').run(nowLocal(), sv.id);
    return publicView(db, sv);
  });
  r('POST', '/api/public/survey/:token', null, ({ db, params, body, ip }) => {
    const sv = byToken(db, params.token);
    if (sv.responded_at) throw new HttpError(409, 'Thanks — we already have your answers.');
    const rating = Math.round(Number(body.rating));
    if (!(rating >= 1 && rating <= 5)) throw new HttpError(400, 'Choose 1 to 5 stars');
    const tech = body.tech_rating == null || body.tech_rating === '' ? null : Math.round(Number(body.tech_rating));
    if (tech != null && !(tech >= 1 && tech <= 5)) throw new HttpError(400, 'Choose 1 to 5 stars for the technician');
    const onTime = body.on_time === true || body.on_time === 'yes' ? 1 : body.on_time === false || body.on_time === 'no' ? 0 : null;
    const comment = String(body.comment || '').trim().slice(0, 2000) || null;
    db.prepare('UPDATE job_surveys SET rating = ?, tech_rating = ?, on_time = ?, comment = ?, contact_ok = ?, responded_at = ?, ip = ? WHERE id = ?')
      .run(rating, tech, onTime, comment, body.contact_ok ? 1 : 0, nowLocal(), String(ip || '').slice(0, 64), sv.id);
    const s = getSettings(db);
    const low = Math.min(rating, tech ?? 5) <= (Number(s.survey_alert_below) || 3) || onTime === 0;
    if (low) {
      const info = db.prepare(`SELECT c.name, sc.number, t.name AS tech FROM job_surveys j JOIN customers c ON c.id = j.customer_id JOIN service_calls sc ON sc.id = j.service_call_id
        LEFT JOIN technicians t ON t.id = j.technician_id WHERE j.id = ?`).get(sv.id);
      raiseAlert(db, {
        kind: 'survey_low', severity: rating <= 2 ? 'bad' : 'warn', link: `#/ratings?survey=${sv.id}`, roles: 'owner,admin',
        title: `${'★'.repeat(rating)}${'☆'.repeat(5 - rating)} from ${info.name} (SC-${info.number}, ${info.tech || 'no tech'})`,
        body: `${onTime === 0 ? 'Said the technician was NOT on time. ' : ''}${comment ? `“${comment}”` : 'No comment.'}${body.contact_ok ? '\nOK to contact them about it.' : ''}`,
      });
    }
    return publicView(db, db.prepare('SELECT * FROM job_surveys WHERE id = ?').get(sv.id));
  });

  // Office side
  r('POST', '/api/service_calls/:id/survey', MANAGE, ({ db, params, user }) => {
    const call = db.prepare('SELECT id, status FROM service_calls WHERE id = ?').get(Number(params.id));
    if (!call) throw new HttpError(404, 'Service call not found');
    if (call.status !== 'completed') throw new HttpError(400, 'Complete the job first');
    const sv = createSurvey(db, call.id);
    if (sv.responded_at) throw new HttpError(409, 'The customer already answered this survey');
    db.prepare('UPDATE job_surveys SET sent_at = ? WHERE id = ?').run(nowLocal(), sv.id);
    queue(() => deliver(db, sv));
    audit(db, user, 'send survey', 'service_calls', call.id);
    return { ok: true };
  });
  r('GET', '/api/service_calls/:id/survey', G.staff, ({ db, params }) => db.prepare('SELECT id, sent_at, channel, opened_at, responded_at, rating, tech_rating, on_time, comment FROM job_surveys WHERE service_call_id = ?').get(Number(params.id)) || null);

  r('GET', '/api/ratings', MANAGE, ({ db, query }) => {
    const days = Math.min(Math.max(Number(query.days) || 90, 7), 3650);
    const from = addDays(todayLocal(), -days);
    const techs = db.prepare('SELECT id, name, color, active FROM technicians ORDER BY active DESC, name').all();
    const stats = id => {
      const where = `technician_id ${id ? '= ?' : 'IS NOT NULL'} AND sent_at >= ?`;
      const args = id ? [id, from] : [from];
      const a = db.prepare(`SELECT COUNT(*) AS sent, COUNT(responded_at) AS answered, AVG(rating) AS avg, AVG(COALESCE(tech_rating, rating)) AS tech_avg,
          AVG(CASE WHEN on_time IS NULL THEN NULL ELSE on_time END) AS on_time, SUM(CASE WHEN rating <= 3 THEN 1 ELSE 0 END) AS low FROM job_surveys WHERE ${where}`).get(...args);
      const trend = db.prepare(`SELECT substr(responded_at,1,7) AS month, AVG(COALESCE(tech_rating, rating)) AS avg, COUNT(*) AS n FROM job_surveys
        WHERE ${id ? 'technician_id = ? AND' : ''} responded_at >= ? GROUP BY month ORDER BY month`).all(...(id ? [id] : []), addDays(todayLocal(), -183));
      const r1 = x => (x == null ? null : Math.round(x * 10) / 10);
      return { sent: a.sent, answered: a.answered, response_rate: a.sent ? Math.round(a.answered / a.sent * 100) : null, avg: r1(a.avg), tech_avg: r1(a.tech_avg),
        on_time: a.on_time == null ? null : Math.round(a.on_time * 100), low: a.low || 0, trend: trend.map(t => ({ month: t.month, avg: r1(t.avg), n: t.n })) };
    };
    const responses = db.prepare(`SELECT j.*, c.name AS customer, sc.number, sc.title, t.name AS tech FROM job_surveys j JOIN customers c ON c.id = j.customer_id
      JOIN service_calls sc ON sc.id = j.service_call_id LEFT JOIN technicians t ON t.id = j.technician_id
      WHERE j.responded_at IS NOT NULL AND j.responded_at >= ? ${query.technician_id ? 'AND j.technician_id = ?' : ''} ORDER BY j.responded_at DESC LIMIT 300`)
      .all(from, ...(query.technician_id ? [Number(query.technician_id)] : []));
    return { days, company: stats(null), technicians: techs.map(t => ({ ...t, ...stats(t.id) })).filter(t => t.active || t.sent), responses };
  });
  r('POST', '/api/ratings/:id/follow-up', MANAGE, ({ db, params, body, user }) => {
    const note = String(body.note || '').trim();
    if (!note) throw new HttpError(400, 'Write what was done');
    db.prepare('UPDATE job_surveys SET followed_up_by = ?, followed_up_at = ?, follow_up_note = ? WHERE id = ?').run(user.name, nowLocal(), note.slice(0, 1000), Number(params.id));
    db.prepare("UPDATE alerts SET resolved_at = datetime('now','localtime'), resolved_by = ? WHERE kind = 'survey_low' AND link = ? AND resolved_at IS NULL").run(user.name, `#/ratings?survey=${Number(params.id)}`);
    audit(db, user, 'survey follow-up', 'job_surveys', Number(params.id), note.slice(0, 200));
    return { ok: true };
  });
}
