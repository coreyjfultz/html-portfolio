// On-call rotation and the company phone line (Twilio Voice).
//
// On call: shifts (primary + backup) land on the tech's calendar (feed + emailed invite)
// and they get a text before the shift starts.
//
// Inbound: one shared company number (and optional per-tech numbers). During office hours
// calls ring the office; after hours they ring the on-call tech, then the backup, then go
// to voicemail. The tech hears who's calling first ("press 1 to accept"), and accepting
// gives them access to that customer in the app for a day.
//
// Outbound (click-to-call): the app rings the user's own phone, then connects them to the
// customer showing the company number, so personal numbers stay private.
import crypto from 'node:crypto';
import { G } from '../public/js/schema.js';
import { getSettings } from './db.js';
import { HttpError, registerHooks, nowLocal, todayLocal, addDays, grantAccess, assertCustomerVisible, isScoped } from './resources.js';
import { audit } from './security.js';
import { smsConfig, normalizePhone, queue, sendSms, sendEmail, mailConfig, appUrl } from './notify.js';
import { zonedToUtc, buildCalendar } from './calendar.js';
import { raiseAlert } from './alerts.js';

const MANAGE = G.manage;

// ---------------------------------------------------------------- on-call shifts
export function onCallAt(db, at = nowLocal()) {
  return db.prepare(`SELECT s.*, t.name AS tech_name, t.phone AS tech_phone, b.name AS backup_name, b.phone AS backup_phone
    FROM on_call_shifts s JOIN technicians t ON t.id = s.technician_id LEFT JOIN technicians b ON b.id = s.backup_technician_id
    WHERE s.starts_at <= ? AND s.ends_at > ? ORDER BY s.starts_at DESC LIMIT 1`).get(at, at) || null;
}

registerHooks('on_call_shifts', {
  beforeSave(db, data, { existing, isCreate }) {
    const m = { ...existing, ...data };
    if (!(m.ends_at > m.starts_at)) throw new HttpError(400, 'The shift must end after it starts');
    if (m.backup_technician_id && m.backup_technician_id === m.technician_id) throw new HttpError(400, 'The backup must be someone else');
    const clash = db.prepare(`SELECT s.id, t.name FROM on_call_shifts s JOIN technicians t ON t.id = s.technician_id
      WHERE s.id <> ? AND s.starts_at < ? AND s.ends_at > ?`).get(existing?.id || 0, m.ends_at, m.starts_at);
    if (clash) throw new HttpError(409, `That overlaps ${clash.name}'s on-call shift. Shorten one of them first.`);
    if (!isCreate && ['technician_id', 'backup_technician_id', 'starts_at', 'ends_at'].some(k => k in data && data[k] !== existing[k])) data.cal_sequence = (existing.cal_sequence || 0) + 1;
  },
  afterSave(db, row, { existing }) {
    if (getSettings(db).oncall_notify !== '1') return;
    const changed = !existing || ['technician_id', 'backup_technician_id', 'starts_at', 'ends_at'].some(k => row[k] !== existing[k]);
    if (!changed) return;
    queue(async () => {
      for (const [techId, role] of [[row.technician_id, 'primary'], [row.backup_technician_id, 'backup']]) if (techId) await sendShiftInvite(db, row, techId, role);
      // Whoever was taken off the shift gets a cancellation.
      for (const [old, now, role] of [[existing?.technician_id, row.technician_id, 'primary'], [existing?.backup_technician_id, row.backup_technician_id, 'backup']]) {
        if (old && old !== now) await sendShiftInvite(db, row, old, role, { cancel: true });
      }
    });
  },
  afterDelete(db, row) {
    if (getSettings(db).oncall_notify !== '1') return;
    queue(async () => {
      for (const [techId, role] of [[row.technician_id, 'primary'], [row.backup_technician_id, 'backup']]) if (techId) await sendShiftInvite(db, row, techId, role, { cancel: true });
    });
  },
});

const fmtWhen = s => new Date(s).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function shiftEvent(db, shift, techId, role, { cancel = false, organizer, attendee } = {}) {
  const s = getSettings(db);
  const stamp = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = v => String(v ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const other = role === 'primary' ? shift.backup_name || db.prepare('SELECT name FROM technicians WHERE id = ?').get(shift.backup_technician_id)?.name
    : db.prepare('SELECT name FROM technicians WHERE id = ?').get(shift.technician_id)?.name;
  const number = s.voice_number || s.twilio_from;
  return [
    'BEGIN:VEVENT', `UID:oncall-${shift.id}-${techId}@secureops`, `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(zonedToUtc(shift.starts_at, s.timezone))}`, `DTEND:${stamp(zonedToUtc(shift.ends_at, s.timezone))}`,
    `SEQUENCE:${shift.cal_sequence || 0}`,
    `SUMMARY:${esc(role === 'primary' ? `On call — ${s.company_name}` : `On-call backup — ${s.company_name}`)}`,
    `DESCRIPTION:${esc(`${role === 'primary' ? `You're the on-call technician. After-hours calls to ${number || 'the company line'} ring your phone first.` : `You're the backup. Calls ring you if the on-call tech doesn't answer.`}${other ? `\n${role === 'primary' ? 'Backup' : 'On call'}: ${other}` : ''}${shift.notes ? `\n\n${shift.notes}` : ''}`)}`,
    'TRANSP:TRANSPARENT', `STATUS:${cancel ? 'CANCELLED' : 'CONFIRMED'}`, 'CATEGORIES:On call',
    organizer ? `ORGANIZER;CN=${esc(organizer.name)}:mailto:${organizer.email}` : null,
    attendee ? `ATTENDEE;CN=${esc(attendee.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE:mailto:${attendee.email}` : null,
    'END:VEVENT',
  ].filter(Boolean);
}

/** On-call shifts for a calendar feed (one tech, or everyone). */
export function onCallFeedEvents(db, techId = null) {
  const from = addDays(todayLocal(), -30), to = addDays(todayLocal(), 365);
  const rows = db.prepare(`SELECT s.*, b.name AS backup_name FROM on_call_shifts s LEFT JOIN technicians b ON b.id = s.backup_technician_id
    WHERE s.ends_at >= ? AND s.starts_at <= ? ${techId ? 'AND (s.technician_id = ? OR s.backup_technician_id = ?)' : ''}`).all(from, to, ...(techId ? [techId, techId] : []));
  return rows.flatMap(r => techId
    ? [shiftEvent(db, r, techId, r.technician_id === techId ? 'primary' : 'backup')]
    : [shiftEvent(db, r, r.technician_id, 'primary').map(l => l.startsWith('SUMMARY:') ? `SUMMARY:On call: ${db.prepare('SELECT name FROM technicians WHERE id = ?').get(r.technician_id)?.name}` : l)]);
}

async function sendShiftInvite(db, shift, techId, role, { cancel = false } = {}) {
  const tech = db.prepare('SELECT id, name, email, phone FROM technicians WHERE id = ?').get(techId);
  if (!tech) return;
  const s = getSettings(db);
  const when = `${fmtWhen(shift.starts_at)} – ${fmtWhen(shift.ends_at)}`;
  const label = role === 'primary' ? 'on call' : 'on-call backup';
  const related = { type: 'on_call', id: shift.id };
  if (tech.email) {
    const cfg = mailConfig(db);
    const ev = shiftEvent(db, shift, techId, role, { cancel, organizer: { name: s.company_name, email: cfg.from || 'no-reply@example.com' }, attendee: { name: tech.name, email: tech.email } });
    await sendEmail(db, {
      to: tech.email, subject: `${cancel ? 'Cancelled: ' : ''}You're ${label}: ${when}`,
      text: cancel ? `You're no longer ${label} for ${when}.` : `You're ${label} ${when}.\n\nAfter-hours calls ${role === 'primary' ? 'ring your phone first' : 'ring you if the on-call tech doesn’t pick up'}. Press 1 when you hear the announcement to take the call.\n${appUrl(db) ? `\n${appUrl(db)}/#/phone` : ''}`,
      icalEvent: { method: cancel ? 'CANCEL' : 'REQUEST', content: buildCalendar([ev], { method: cancel ? 'CANCEL' : 'REQUEST' }) }, related,
    });
  }
  if (tech.phone) await sendSms(db, { to: tech.phone, body: cancel ? `${s.company_name}: you're no longer ${label} for ${when}.` : `${s.company_name}: you're ${label} ${when}. It's on your calendar.`, related });
}

/** Hourly: remind whoever's shift starts in the next 12 hours (once). */
export function onCallReminders(db) {
  if (getSettings(db).oncall_notify !== '1') return;
  const now = nowLocal();
  const soon = new Date(Date.now() + 12 * 3600e3);
  const p = n => String(n).padStart(2, '0');
  const until = `${soon.getFullYear()}-${p(soon.getMonth() + 1)}-${p(soon.getDate())}T${p(soon.getHours())}:${p(soon.getMinutes())}`;
  for (const sh of db.prepare('SELECT s.*, t.phone, t.name FROM on_call_shifts s JOIN technicians t ON t.id = s.technician_id WHERE s.starts_at > ? AND s.starts_at <= ?').all(now, until)) {
    if (db.prepare("SELECT 1 FROM notifications WHERE related_type = 'on_call_reminder' AND related_id = ?").get(sh.id)) continue;
    queue(() => sendSms(db, { to: sh.phone, body: `Reminder: you're on call from ${fmtWhen(sh.starts_at)} to ${fmtWhen(sh.ends_at)}. Keep your phone on loud.`, related: { type: 'on_call_reminder', id: sh.id } }));
  }
}

/** Build a simple rotation: each tech takes a block in turn; the next person in line is backup. */
function buildRotation(db, body, user) {
  const techs = (Array.isArray(body.technician_ids) ? body.technician_ids : []).map(Number).filter(Boolean);
  if (techs.length < 1) throw new HttpError(400, 'Choose at least one technician');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.start || '')) throw new HttpError(400, 'Choose a start date');
  const time = /^\d{2}:\d{2}$/.test(body.handoff || '') ? body.handoff : '08:00';
  const days = Math.min(Math.max(Number(body.days) || 7, 1), 31);
  const count = Math.min(Math.max(Number(body.shifts) || 4, 1), 52);
  const first = `${body.start}T${time}`;
  const last = `${addDays(body.start, days * count)}T${time}`;
  if (body.replace) {
    db.prepare('DELETE FROM on_call_shifts WHERE starts_at >= ? AND starts_at < ?').run(first, last);
    db.prepare('UPDATE on_call_shifts SET ends_at = ? WHERE starts_at < ? AND ends_at > ?').run(first, first, first);
  }
  const { create } = RESOURCES_API;
  const made = [];
  for (let i = 0; i < count; i++) {
    const start = `${addDays(body.start, days * i)}T${time}`;
    const end = `${addDays(body.start, days * (i + 1))}T${time}`;
    const tech = techs[i % techs.length];
    const backup = body.backup === false || techs.length < 2 ? null : techs[(i + 1) % techs.length];
    made.push(create(db, 'on_call_shifts', { technician_id: tech, backup_technician_id: backup, starts_at: start, ends_at: end }, user).id);
  }
  audit(db, user, 'build on-call rotation', 'on_call_shifts', null, `${count} shifts from ${first}`);
  return { created: made.length };
}
let RESOURCES_API = {};
export function setResourceApi(api) { RESOURCES_API = api; }

// ---------------------------------------------------------------- voice configuration
export function voiceConfig(db) {
  const s = getSettings(db);
  const sms = smsConfig(db);
  const number = normalizePhone(s.voice_number || sms.from);
  const base = (s.public_url || '').replace(/\/$/, '');
  const cfg = { enabled: s.voice_enabled === '1', sid: sms.sid, token: sms.token, api: sms.api, number, base, hookBase: base ? `${base}/api/inbound/voice/${s.voice_token}` : '' };
  cfg.ok = !!(cfg.enabled && cfg.sid && cfg.token && cfg.number && cfg.base);
  cfg.missing = [!cfg.enabled && 'turn it on', !(cfg.sid && cfg.token) && 'Twilio account SID & auth token (Texts & email tab)', !cfg.number && 'a Twilio phone number', !cfg.base && 'the public web address (Calendars tab)'].filter(Boolean);
  return cfg;
}

/** Twilio's request signature: HMAC-SHA1 over the full URL + sorted POST params. */
export function twilioSignature(token, url, params = {}) {
  const data = url + Object.keys(params).sort().map(k => k + params[k]).join('');
  return crypto.createHmac('sha1', token).update(Buffer.from(data, 'utf8')).digest('base64');
}
function verifyTwilio(db, req, body) {
  const cfg = voiceConfig(db);
  const url = `${cfg.base}${req.url}`;
  const expected = twilioSignature(cfg.token || '', url, body);
  const got = String(req.headers['x-twilio-signature'] || '');
  const a = Buffer.from(expected), b = Buffer.from(got);
  if (!cfg.token || a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new HttpError(403, 'Bad signature');
  return cfg;
}

const xml = s => String(s ?? '').replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
const twiml = (res, inner) => { res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`); };
const say = t => t ? `<Say voice="Polly.Joanna">${xml(t)}</Say>` : '';

/** Is the office open right now (in the company's time zone)? */
export function officeOpen(db, date = new Date()) {
  const s = getSettings(db);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: s.timezone || undefined, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).map(p => [p.type, p.value]));
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  const hm = `${parts.hour}:${parts.minute}`;
  return String(s.office_days || '').split(',').map(Number).includes(day) && hm >= (s.office_open || '08:00') && hm < (s.office_close || '17:00');
}

const last10 = p => String(p || '').replace(/\D/g, '').slice(-10);
/** Who is calling? Matches customer, site and contact phone numbers. */
export function matchCaller(db, from) {
  const d = last10(from);
  if (d.length < 10) return null;
  const digits = col => `substr(replace(replace(replace(replace(replace(replace(COALESCE(${col},''),'(',''),')',''),'-',''),' ',''),'.',''),'+',''), -10)`;
  return db.prepare(`SELECT id, name FROM customers WHERE ${digits('phone')} = ? OR ${digits('alt_phone')} = ?`).get(d, d)
    || db.prepare(`SELECT c.id, c.name, l.name AS site FROM locations l JOIN customers c ON c.id = l.customer_id WHERE ${digits('l.phone')} = ?`).get(d)
    || db.prepare(`SELECT c.id, c.name, k.name AS contact FROM contacts k JOIN customers c ON c.id = k.customer_id WHERE ${digits('k.phone')} = ?`).get(d)
    || null;
}

const callRow = (db, id) => db.prepare('SELECT * FROM phone_calls WHERE id = ?').get(Number(id));
const setCall = (db, id, fields) => {
  const keys = Object.keys(fields);
  db.prepare(`UPDATE phone_calls SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = datetime('now','localtime') WHERE id = ?`).run(...keys.map(k => fields[k]), id);
};

/** The list of people to ring for an inbound call, in order. */
function routeFor(db, to) {
  const direct = db.prepare('SELECT id, name, phone, twilio_number FROM technicians WHERE active = 1 AND twilio_number IS NOT NULL AND twilio_number <> ?').all('')
    .find(t => normalizePhone(t.twilio_number) === normalizePhone(to));
  if (direct) return { route: 'direct', steps: [{ tech: direct.id, name: direct.name, phone: direct.phone }] };
  const s = getSettings(db);
  if (officeOpen(db) && normalizePhone(s.office_phone)) return { route: 'office', steps: [{ name: 'Office', phone: s.office_phone }] };
  const sh = onCallAt(db);
  if (!sh) return { route: 'after hours', steps: [] };
  return { route: 'on call', steps: [{ tech: sh.technician_id, name: sh.tech_name, phone: sh.tech_phone }, ...(sh.backup_technician_id ? [{ tech: sh.backup_technician_id, name: sh.backup_name, phone: sh.backup_phone }] : [])].filter(x => normalizePhone(x.phone)) };
}

function dialStep(db, cfg, call, step) {
  const plan = routeFor(db, call.to_number);
  const target = plan.steps[step];
  if (!target) return voicemail(cfg, call);
  setCall(db, call.id, { routed_to: [call.routed_to, target.name].filter(Boolean).join(' → ') });
  const whisper = getSettings(db).voice_whisper === '1' && target.tech;
  const numberAttrs = whisper ? ` url="${xml(`${cfg.hookBase}/whisper?call=${call.id}&tech=${target.tech}`)}"` : '';
  return `<Dial callerId="${xml(call.from_number || cfg.number)}" timeout="${step === 0 ? 25 : 20}" action="${xml(`${cfg.hookBase}/dial-result?call=${call.id}&step=${step}`)}"><Number${numberAttrs}>${xml(normalizePhone(target.phone))}</Number></Dial>`;
}
const voicemail = (cfg, call) => `${say(cfg.voicemailText)}<Record maxLength="180" playBeep="true" action="${xml(`${cfg.hookBase}/voicemail?call=${call.id}`)}"/>${say('We did not get a message. Goodbye.')}<Hangup/>`;

// ---------------------------------------------------------------- click-to-call
async function twilioPost(cfg, path, params) {
  const res = await fetch(`${cfg.api}/2010-04-01/Accounts/${encodeURIComponent(cfg.sid)}${path}`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${cfg.sid}:${cfg.token}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, `Phone service error: ${data.message || res.status}`);
  return data;
}

function customerNumbers(db, customerId) {
  const c = db.prepare('SELECT phone, alt_phone FROM customers WHERE id = ?').get(customerId) || {};
  const nums = [c.phone, c.alt_phone,
    ...db.prepare('SELECT phone FROM locations WHERE customer_id = ?').all(customerId).map(r => r.phone),
    ...db.prepare('SELECT phone FROM contacts WHERE customer_id = ?').all(customerId).map(r => r.phone)];
  return new Set(nums.map(normalizePhone).filter(Boolean));
}

export async function clickToCall(db, user, body) {
  const cfg = voiceConfig(db);
  if (!cfg.ok) throw Object.assign(new HttpError(400, `Calling from the app isn't set up yet (${cfg.missing.join(', ')}).`), { code: 'voice_off' });
  const customerId = Number(body.customer_id) || null;
  if (customerId) assertCustomerVisible(db, user, customerId);
  const tech = user.technician_id ? db.prepare('SELECT * FROM technicians WHERE id = ?').get(user.technician_id) : null;
  const myPhone = normalizePhone(db.prepare('SELECT phone FROM users WHERE id = ?').get(user.id)?.phone || tech?.phone);
  if (!myPhone) throw Object.assign(new HttpError(400, 'Add your mobile number first so the app can ring you.'), { code: 'need_phone' });
  const target = normalizePhone(body.phone || (customerId && db.prepare('SELECT phone FROM customers WHERE id = ?').get(customerId)?.phone));
  if (!target) throw new HttpError(400, 'No valid phone number to call');
  // Technicians may only call numbers on file for customers they can see; the office can dial any number.
  if (isScoped(user) && !(customerId && customerNumbers(db, customerId).has(target))) throw new HttpError(403, 'You can call customers on your schedule from here');
  const from = normalizePhone(tech?.twilio_number) || cfg.number;
  const id = Number(db.prepare(`INSERT INTO phone_calls (direction, from_number, to_number, customer_id, service_call_id, user_id, technician_id, route, routed_to, status, dial_number)
    VALUES ('outbound', ?, ?, ?, ?, ?, ?, 'click to call', ?, 'ringing you', ?)`).run(from, target, customerId, Number(body.service_call_id) || null, user.id, user.technician_id || null, user.name, myPhone).lastInsertRowid);
  try {
    const r = await twilioPost(cfg, '/Calls.json', {
      To: myPhone, From: from,
      Url: `${cfg.hookBase}/bridge?call=${id}`, StatusCallback: `${cfg.hookBase}/status?call=${id}`, StatusCallbackEvent: 'completed',
    });
    setCall(db, id, { call_sid: r.sid || null });
  } catch (e) { setCall(db, id, { status: 'failed' }); throw e; }
  audit(db, user, 'click to call', 'customers', customerId, target.slice(0, -4) + '••••');
  return { id, ringing: myPhone.slice(0, -4).replace(/\d/g, '•') + myPhone.slice(-4) };
}

// ---------------------------------------------------------------- routes
export function registerPhoneRoutes(r, { create }) {
  setResourceApi({ create });
  r('GET', '/api/oncall/now', G.all, ({ db }) => {
    const sh = onCallAt(db);
    const next = db.prepare(`SELECT s.*, t.name AS tech_name, b.name AS backup_name FROM on_call_shifts s JOIN technicians t ON t.id = s.technician_id
      LEFT JOIN technicians b ON b.id = s.backup_technician_id WHERE s.starts_at > ? ORDER BY s.starts_at LIMIT 1`).get(nowLocal()) || null;
    const cfg = voiceConfig(db);
    return { current: sh && { ...sh, tech_phone: undefined, backup_phone: undefined }, next, office_open: officeOpen(db), voice: { ok: cfg.ok, number: cfg.number, missing: cfg.missing } };
  });
  r('POST', '/api/oncall/rotation', MANAGE, ({ db, body, user }) => buildRotation(db, body, user));

  r('GET', '/api/phone/calls', G.all, ({ db, user, query }) => {
    const where = [], params = [];
    if (isScoped(user)) { where.push('(p.user_id = ? OR p.technician_id = ? OR p.answered_by = ?)'); params.push(user.id, user.technician_id || 0, user.name); }
    if (query.customer_id) { where.push('p.customer_id = ?'); params.push(Number(query.customer_id)); }
    return db.prepare(`SELECT p.*, c.name AS customer_name, u.name AS user_name FROM phone_calls p LEFT JOIN customers c ON c.id = p.customer_id LEFT JOIN users u ON u.id = p.user_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.id DESC LIMIT 200`).all(...params)
      .map(p => (isScoped(user) && p.customer_id == null ? { ...p, from_number: p.from_number?.slice(0, -4).replace(/\d/g, '•') + (p.from_number || '').slice(-4) } : p));
  });
  r('POST', '/api/phone/call', G.all, ({ db, user, body }) => clickToCall(db, user, body));
  r('PUT', '/api/phone/my-number', G.all, ({ db, user, body }) => {
    const p = normalizePhone(body.phone);
    if (!p) throw new HttpError(400, 'Enter a valid mobile number');
    db.prepare('UPDATE users SET phone = ? WHERE id = ?').run(p, user.id);
    return { ok: true };
  });
  r('GET', '/api/phone/my-number', G.all, ({ db, user }) => {
    const tech = user.technician_id ? db.prepare('SELECT phone FROM technicians WHERE id = ?').get(user.technician_id) : null;
    return { phone: db.prepare('SELECT phone FROM users WHERE id = ?').get(user.id)?.phone || tech?.phone || '' };
  });
  r('GET', '/api/phone/setup', MANAGE, ({ db }) => {
    const cfg = voiceConfig(db);
    return { ...cfg, token: undefined, sid: cfg.sid ? `${cfg.sid.slice(0, 6)}…` : '', incoming_url: cfg.hookBase ? `${cfg.hookBase}/incoming` : '', status_url: cfg.hookBase ? `${cfg.hookBase}/status` : '' };
  });
  r('POST', '/api/phone/reset-link', MANAGE, ({ db, user }) => {
    db.prepare("UPDATE settings SET value = ? WHERE key = 'voice_token'").run(crypto.randomBytes(18).toString('base64url'));
    audit(db, user, 'reset phone webhook link', 'settings', null);
    return { ok: true };
  });

  // ---- Twilio webhooks (signed by Twilio; no login) ----
  const hook = (name, fn) => r('POST', `/api/inbound/voice/:token/${name}`, null, ctx => {
    const s = getSettings(ctx.db);
    if (!s.voice_token || ctx.params.token !== s.voice_token) throw new HttpError(404, 'Not found');
    const cfg = verifyTwilio(ctx.db, ctx.req, ctx.body);
    cfg.voicemailText = s.voice_voicemail;
    return fn({ ...ctx, cfg, s });
  });

  hook('incoming', ({ db, body, res, cfg, s }) => {
    if (!cfg.enabled) return twiml(res, `${say(`Thank you for calling ${s.company_name}. Please call back during business hours.`)}<Hangup/>`);
    const who = matchCaller(db, body.From);
    const plan = routeFor(db, body.To);
    const id = Number(db.prepare(`INSERT INTO phone_calls (direction, call_sid, from_number, to_number, customer_id, route, status) VALUES ('inbound', ?, ?, ?, ?, ?, 'ringing')`)
      .run(body.CallSid || null, normalizePhone(body.From) || body.From || null, normalizePhone(body.To) || body.To || null, who?.id || null, plan.route).lastInsertRowid);
    const call = callRow(db, id);
    const greeting = say(String(s.voice_greeting || '').replace('{company}', s.company_name)) + (plan.route === 'on call' ? say(s.voice_after_hours) : '');
    return twiml(res, greeting + dialStep(db, cfg, call, 0));
  });

  hook('dial-result', ({ db, query, body, res, cfg, s }) => {
    const call = callRow(db, query.call);
    if (!call) return twiml(res, '<Hangup/>');
    // With the whisper on, a call only counts as answered once the tech pressed 1 (so their voicemail can't take it).
    const answered = body.DialCallStatus === 'completed' && (call.answered_by || call.route === 'office' || s.voice_whisper !== '1');
    if (answered) {
      setCall(db, call.id, { status: 'answered', answered_by: call.answered_by || (call.route === 'office' ? 'Office' : call.routed_to?.split(' → ').pop() || 'Answered') });
      return twiml(res, '<Hangup/>');
    }
    return twiml(res, dialStep(db, cfg, call, Number(query.step) + 1));
  });

  // The tech's leg: announce the caller and require a key press, so a tech's voicemail can't "answer".
  hook('whisper', ({ db, query, res, cfg }) => {
    const call = callRow(db, query.call);
    const cust = call?.customer_id ? db.prepare('SELECT name FROM customers WHERE id = ?').get(call.customer_id) : null;
    const from = call?.from_number ? call.from_number.slice(-10).split('').join(' ') : 'an unknown number';
    return twiml(res, `<Gather numDigits="1" timeout="8" action="${xml(`${cfg.hookBase}/accept?call=${query.call}&tech=${Number(query.tech)}`)}">${say(`${call?.route === 'direct' ? 'Business call' : 'After hours call'} from ${cust ? cust.name : from}. Press 1 to accept.`)}</Gather>${say('Call not accepted.')}<Hangup/>`);
  });

  hook('accept', ({ db, query, body, res, s }) => {
    const call = callRow(db, query.call);
    if (!call || String(body.Digits) !== '1') return twiml(res, '<Hangup/>');
    const tech = db.prepare('SELECT id, name FROM technicians WHERE id = ?').get(Number(query.tech));
    setCall(db, call.id, { answered_by: tech?.name || 'Technician', technician_id: tech?.id || null, status: 'answered' });
    // The tech gets the customer's history and system info in the app for the next day.
    if (call.customer_id && tech) {
      for (const u of db.prepare("SELECT id FROM users WHERE technician_id = ? AND active = 1 AND role = 'technician'").all(tech.id)) {
        grantAccess(db, { userId: u.id, customerId: call.customer_id, hours: Number(s.voice_grant_hours) || 24, reason: `Answered ${call.route} call`, by: 'Phone system' });
      }
    }
    return twiml(res, say('Connecting.'));
  });

  hook('voicemail', ({ db, query, body, res, s }) => {
    const call = callRow(db, query.call);
    if (call && body.RecordingUrl) {
      setCall(db, call.id, { voicemail_url: body.RecordingUrl, voicemail_seconds: Number(body.RecordingDuration) || null, status: 'voicemail' });
      const cust = call.customer_id ? db.prepare('SELECT name FROM customers WHERE id = ?').get(call.customer_id) : null;
      const who = cust?.name || call.from_number || 'Unknown caller';
      const sh = onCallAt(db);
      raiseAlert(db, { kind: 'voicemail', severity: 'warn', title: `Voicemail from ${who}`, body: `${call.from_number || ''} · ${body.RecordingDuration || '?'} seconds\nListen: ${body.RecordingUrl}.mp3`, link: '#/phone?tab=calls', roles: 'owner,admin', notify: true });
      if (sh?.tech_phone && call.route === 'on call') queue(() => sendSms(db, { to: sh.tech_phone, body: `${s.company_name}: voicemail from ${who} (${call.from_number}). Listen in the app: ${appUrl(db)}/#/phone?tab=calls`, related: { type: 'phone_call', id: call.id } }));
    }
    return twiml(res, `${say('Thank you. We will call you back as soon as possible. Goodbye.')}<Hangup/>`);
  });

  hook('status', ({ db, query, body, res }) => {
    const call = callRow(db, query.call) || (body.CallSid ? db.prepare('SELECT * FROM phone_calls WHERE call_sid = ?').get(body.CallSid) : null);
    if (call) {
      const fields = { duration: Number(body.CallDuration) || call.duration || null };
      if (!['answered', 'voicemail'].includes(call.status) || call.direction === 'outbound') fields.status = body.CallStatus || call.status;
      if (call.direction === 'outbound' && body.CallStatus === 'completed') fields.status = 'completed';
      setCall(db, call.id, fields);
      if (call.direction === 'inbound' && !call.answered_by && !call.voicemail_url && ['completed', 'no-answer', 'busy', 'canceled'].includes(body.CallStatus)) {
        const cust = call.customer_id ? db.prepare('SELECT name FROM customers WHERE id = ?').get(call.customer_id) : null;
        setCall(db, call.id, { status: 'missed' });
        raiseAlert(db, { kind: 'missed_call', severity: 'warn', title: `Missed call from ${cust?.name || call.from_number || 'unknown'}`, body: `${call.route} · ${call.routed_to || 'nobody available'}`, link: '#/phone?tab=calls', notify: false });
      }
    }
    return twiml(res, '');
  });

  // Click-to-call: the user picked up — now dial the customer, showing the business number.
  hook('bridge', ({ db, query, res, cfg }) => {
    const call = callRow(db, query.call);
    if (!call || call.direction !== 'outbound') return twiml(res, '<Hangup/>');
    const cust = call.customer_id ? db.prepare('SELECT name FROM customers WHERE id = ?').get(call.customer_id) : null;
    setCall(db, call.id, { status: 'connecting' });
    return twiml(res, `${say(`Connecting you to ${cust?.name || 'the customer'}.`)}<Dial callerId="${xml(call.from_number || cfg.number)}" timeout="30">${xml(call.to_number)}</Dial>`);
  });
}
