// Outgoing email (SMTP via nodemailer) and text messages (Twilio), with a log of
// everything sent. Sending happens after the database change is saved and never
// blocks or breaks the request that triggered it.
import { getSettings, DEFAULT_TEMPLATES } from './db.js';
import { decrypt } from './security.js';
import { callToEvent, buildCalendar } from './calendar.js';

// Remember the address people use to reach the app, for links in messages.
let rememberedBase = '';
export function setBaseUrl(u) { if (u) rememberedBase = u; }
export function appUrl(db) { return (getSettings(db).public_url || rememberedBase || '').replace(/\/$/, ''); }

// ---------------------------------------------------------------- configuration
// Environment variables win over values saved in Settings (handy for secrets).
export function mailConfig(db) {
  const s = getSettings(db);
  const pass = process.env.SMTP_PASS || (s.smtp_pass ? safeDecrypt(s.smtp_pass) : '');
  const cfg = {
    host: process.env.SMTP_HOST || s.smtp_host,
    port: Number(process.env.SMTP_PORT || s.smtp_port) || 587,
    user: process.env.SMTP_USER || s.smtp_user,
    pass,
    from: process.env.MAIL_FROM || s.mail_from || s.company_email,
  };
  cfg.ok = !!(cfg.host && cfg.from) || process.env.SMTP_HOST === 'json';
  return cfg;
}
export function smsConfig(db) {
  const s = getSettings(db);
  const cfg = {
    sid: process.env.TWILIO_ACCOUNT_SID || s.twilio_sid,
    token: process.env.TWILIO_AUTH_TOKEN || (s.twilio_token ? safeDecrypt(s.twilio_token) : ''),
    from: process.env.TWILIO_FROM || s.twilio_from,
    api: process.env.TWILIO_API_BASE || 'https://api.twilio.com',
  };
  cfg.ok = !!(cfg.sid && cfg.token && cfg.from);
  return cfg;
}
function safeDecrypt(v) { try { return decrypt(v); } catch { return ''; } }

let transporter = null, transporterKey = '';
async function getTransport(cfg) {
  const key = JSON.stringify([cfg.host, cfg.port, cfg.user, cfg.pass]);
  if (!transporter || key !== transporterKey) {
    const nodemailer = (await import('nodemailer')).default;
    transporter = cfg.host === 'json' || process.env.SMTP_HOST === 'json'
      ? nodemailer.createTransport({ jsonTransport: true }) // tests / dry run
      : nodemailer.createTransport({ host: cfg.host, port: cfg.port, secure: cfg.port === 465, auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined });
    transporterKey = key;
  }
  return transporter;
}

// ---------------------------------------------------------------- background queue
let chain = Promise.resolve();
/** Run a send task after the current request finishes; failures are logged, not thrown. */
export function queue(task) {
  chain = chain.then(() => new Promise(r => setImmediate(r))).then(task).catch(e => console.error('notify:', e.message));
  return chain;
}
export const notifyIdle = () => chain;

function log(db, { channel, to, subject, body, status, error, related }) {
  db.prepare(`INSERT INTO notifications (channel, to_addr, subject, body, status, error, related_type, related_id)
    VALUES (?,?,?,?,?,?,?,?)`).run(channel, to || '', subject || null, body || '', status, error || null, related?.type || null, related?.id || null);
}

// ---------------------------------------------------------------- senders
export function normalizePhone(p) {
  const d = String(p || '').replace(/[^\d+]/g, '');
  if (d.startsWith('+') && d.length >= 11) return d;
  const digits = d.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

export async function sendEmail(db, { to, subject, text, html, icalEvent, attachments, related }) {
  const cfg = mailConfig(db);
  if (!to) return log(db, { channel: 'email', to, subject, body: text, status: 'skipped', error: 'No email address', related });
  if (!cfg.ok) return log(db, { channel: 'email', to, subject, body: text, status: 'skipped', error: 'Email is not set up (Settings → Notifications)', related });
  try {
    const t = await getTransport(cfg);
    const name = getSettings(db).company_name;
    await t.sendMail({ from: { name, address: cfg.from }, to, subject, text, html: html || emailHtml(db, text), icalEvent, attachments });
    log(db, { channel: 'email', to, subject, body: text, status: 'sent', related });
    return true;
  } catch (e) {
    log(db, { channel: 'email', to, subject, body: text, status: 'failed', error: e.message, related });
    return false;
  }
}

export async function sendSms(db, { to, body, related }) {
  const cfg = smsConfig(db);
  const phone = normalizePhone(to);
  if (!phone) return log(db, { channel: 'sms', to, body, status: 'skipped', error: 'No valid mobile number', related });
  if (!cfg.ok) return log(db, { channel: 'sms', to: phone, body, status: 'skipped', error: 'Texting is not set up (Settings → Notifications)', related });
  try {
    const res = await fetch(`${cfg.api}/2010-04-01/Accounts/${encodeURIComponent(cfg.sid)}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`${cfg.sid}:${cfg.token}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: phone, From: cfg.from, Body: body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `Twilio error ${res.status}`);
    log(db, { channel: 'sms', to: phone, body, status: 'sent', related });
    return true;
  } catch (e) {
    log(db, { channel: 'sms', to: phone, body, status: 'failed', error: e.message, related });
    return false;
  }
}

const escHtml = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function emailHtml(db, text, { button } = {}) {
  const s = getSettings(db);
  const body = escHtml(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#1d4ed8">$1</a>').replace(/\n/g, '<br>');
  return `<!doctype html><html><body style="margin:0;background:#f4f6f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <div style="background:#0f1b2d;color:#fff;padding:16px 20px;border-radius:12px 12px 0 0;font-weight:700;font-size:16px">${escHtml(s.company_name)}</div>
    <div style="background:#fff;padding:22px 20px;border-radius:0 0 12px 12px;line-height:1.55;font-size:15px">${body}
      ${button ? `<p style="margin:22px 0 4px"><a href="${escHtml(button.url)}" style="background:#1d4ed8;color:#fff;padding:11px 18px;border-radius:8px;text-decoration:none;font-weight:600">${escHtml(button.label)}</a></p>` : ''}</div>
    <div style="color:#64748b;font-size:12px;text-align:center;padding:14px">${escHtml([s.company_phone, s.company_email].filter(Boolean).join(' · '))}</div>
  </div></body></html>`;
}

// ---------------------------------------------------------------- templates
export { DEFAULT_TEMPLATES } from './db.js';
export function fill(tpl, vars) {
  return String(tpl).replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? ''));
}

function callVars(db, call, extra = {}) {
  const s = getSettings(db);
  const d = call.scheduled_start ? new Date(call.scheduled_start) : null;
  return {
    customer: call.customer_contact || call.customer_id_label,
    company: s.company_name, company_phone: s.company_phone,
    tech: call.technician_id_label ? call.technician_id_label.split(' ')[0] : 'our technician',
    date: d ? d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : '',
    time: d ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '',
    address: (call.customer_address || '').replace(/^, |, $/g, ''),
    type: { installation: 'installation', inspection: 'inspection', maintenance: 'maintenance visit', estimate: 'site visit', warranty: 'service visit' }[call.call_type] || 'service visit',
    call_number: `SC-${call.number}`,
    ...extra,
  };
}

// ---------------------------------------------------------------- events
/** Customer confirmation (email/text per their preferences) when a job is booked or moved. */
export async function notifyScheduled(db, call, { reason = 'scheduled' } = {}) {
  const s = getSettings(db);
  const cust = db.prepare('SELECT * FROM customers WHERE id = ?').get(call.customer_id);
  if (!cust || s.notify_on_schedule !== '1') return;
  const vars = callVars(db, { ...call, customer_contact: cust.contact_name || cust.name });
  const related = { type: 'service_call', id: call.id };
  const site = call.site_id ? db.prepare('SELECT phone FROM locations WHERE id = ?').get(call.site_id) : null;
  if (cust.notify_email) {
    await sendEmail(db, { to: cust.email, subject: `${reason === 'rescheduled' ? 'Updated' : 'Confirmed'}: ${vars.type} on ${vars.date}`, text: fill(s.tpl_scheduled_email || DEFAULT_TEMPLATES.tpl_scheduled_email, vars), related });
  }
  if (cust.notify_sms) await sendSms(db, { to: site?.phone || cust.phone, body: fill(s.tpl_scheduled_sms || DEFAULT_TEMPLATES.tpl_scheduled_sms, vars), related });
}

export async function notifyOnMyWay(db, call, { etaMinutes } = {}) {
  const s = getSettings(db);
  const cust = db.prepare('SELECT * FROM customers WHERE id = ?').get(call.customer_id);
  if (!cust) return;
  const eta = etaMinutes ? ` and should arrive in about ${etaMinutes} minutes` : '';
  const vars = callVars(db, { ...call, customer_contact: cust.contact_name || cust.name }, { eta });
  const related = { type: 'service_call', id: call.id };
  const site = call.site_id ? db.prepare('SELECT phone FROM locations WHERE id = ?').get(call.site_id) : null;
  if (cust.notify_sms) await sendSms(db, { to: site?.phone || cust.phone, body: fill(s.tpl_onway_sms || DEFAULT_TEMPLATES.tpl_onway_sms, vars), related });
  if (cust.notify_email) await sendEmail(db, { to: cust.email, subject: `${vars.tech} is on the way`, text: fill(s.tpl_onway_email || DEFAULT_TEMPLATES.tpl_onway_email, vars), related });
}

/** Calendar invite (or cancellation) emailed to the technician so it lands in Outlook/Gmail. */
export async function sendTechInvite(db, call, techId, { cancel = false, baseUrl = '' } = {}) {
  const tech = db.prepare('SELECT id, name, email FROM technicians WHERE id = ?').get(techId);
  if (!tech?.email || !call.scheduled_start) return;
  const s = getSettings(db);
  const cfg = mailConfig(db);
  const ev = callToEvent({ ...call, status: cancel ? 'cancelled' : call.status }, { tz: s.timezone, baseUrl, organizer: { name: s.company_name, email: cfg.from || 'no-reply@example.com' }, attendee: { name: tech.name, email: tech.email } });
  const method = cancel ? 'CANCEL' : 'REQUEST';
  const ics = buildCalendar([ev], { method });
  const when = new Date(call.scheduled_start).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  await sendEmail(db, {
    to: tech.email,
    subject: `${cancel ? 'Cancelled' : 'Job'}: ${call.customer_id_label} — ${call.title} (${when})`,
    text: cancel ? `SC-${call.number} for ${call.customer_id_label} on ${when} has been cancelled or reassigned.`
      : `You're booked for SC-${call.number}.\n\n${call.customer_id_label} — ${call.title}\n${when} (${call.duration_hours || 1} h)\n${(call.customer_address || '').replace(/^, |, $/g, '')}\n${baseUrl ? `\n${baseUrl}/#/calls/${call.id}` : ''}`,
    icalEvent: { method, content: ics },
    related: { type: 'service_call', id: call.id },
  });
}
