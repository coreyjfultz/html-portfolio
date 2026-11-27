// Customer portal: separate logins for customers (never staff), sign-up with
// email verification, invites, and the customer's own invoices, payments,
// service history, requests and agreements. Every query is limited to the
// accounts the signed-in customer owns.
import crypto from 'node:crypto';
import { getSettings, tx } from './db.js';
import { HttpError, create, get, list, registerHooks, todayLocal } from './resources.js';
import { hashPassword, verifyPassword, validatePassword, audit, loginAllowed, recordFailedLogin, clearLogins } from './security.js';
import { queue, sendEmail, appUrl } from './notify.js';
import { checkoutForInvoice, checkoutForSetup, listMethods, removeMethod, setDefaultMethod, stripeConfig } from './payments.js';
import { sendImage } from './media.js';
import { signingUrl } from './proposals.js';

const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const newToken = () => crypto.randomBytes(24).toString('base64url');
const DAYS = 864e5;

// ------------------------------------------------------------------ sessions
function startSession(db, userId, setCookie) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO portal_sessions (token_hash, portal_user_id, expires_at) VALUES (?,?,?)').run(sha(token), userId, Date.now() + 30 * DAYS);
  db.prepare("UPDATE portal_users SET last_login = datetime('now','localtime') WHERE id = ?").run(userId);
  setCookie(token);
}
function cookieOf(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(p => p[0])).psid;
}
export function portalUser(db, req) {
  const t = cookieOf(req);
  if (!t) return null;
  const u = db.prepare(`SELECT u.* FROM portal_sessions s JOIN portal_users u ON u.id = s.portal_user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`).get(sha(t), Date.now());
  return u || null;
}
function need(db, req, { verified = true } = {}) {
  const u = portalUser(db, req);
  if (!u) throw new HttpError(401, 'Please sign in');
  if (verified && (!u.email_verified || !u.customer_id)) throw new HttpError(403, 'Please confirm your email address first');
  return u;
}
/** The customer's own account plus any businesses/properties listed under it. */
function accountIds(db, u) {
  const ids = [u.customer_id, ...db.prepare('SELECT id FROM customers WHERE parent_id = ?').all(u.customer_id).map(r => r.id)];
  return ids;
}
function pickAccount(db, u, requested) {
  const ids = accountIds(db, u);
  const id = Number(requested) || u.customer_id;
  if (!ids.includes(id)) throw new HttpError(404, 'Account not found');
  return id;
}
function ownRecord(db, u, table, id) {
  const row = db.prepare(`SELECT * FROM "${table}" WHERE id = ?`).get(Number(id));
  if (!row || !accountIds(db, u).includes(row.customer_id)) throw new HttpError(404, 'Not found');
  return row;
}

// ------------------------------------------------------------------ invites & verification
function setToken(db, userId, purpose, days) {
  const t = newToken();
  db.prepare('UPDATE portal_users SET token_hash = ?, token_purpose = ?, token_expires = ? WHERE id = ?').run(sha(t), purpose, Date.now() + days * DAYS, userId);
  return t;
}
function takeToken(db, token, purposes) {
  const u = db.prepare('SELECT * FROM portal_users WHERE token_hash = ?').get(sha(token || ''));
  if (!u || !purposes.includes(u.token_purpose) || u.token_expires < Date.now()) throw new HttpError(400, 'This link has expired or was already used. Request a new one.');
  db.prepare('UPDATE portal_users SET token_hash = NULL, token_purpose = NULL, token_expires = NULL WHERE id = ?').run(u.id);
  return u;
}
const portalLink = (db, hash) => `${appUrl(db)}/portal#/${hash}`;

/** Staff invites a customer: creates their login (if needed) and emails a set-password link. */
export function invite(db, customerId, user, { email: overrideEmail } = {}) {
  const c = db.prepare('SELECT id, name, contact_name, email FROM customers WHERE id = ?').get(customerId);
  if (!c) throw new HttpError(404, 'Customer not found');
  const email = String(overrideEmail || c.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'This customer needs a valid email address first');
  let u = db.prepare('SELECT * FROM portal_users WHERE email = ?').get(email);
  if (u && u.customer_id && u.customer_id !== c.id) throw new HttpError(409, 'That email already has a portal login for a different customer');
  if (!u) {
    const info = db.prepare('INSERT INTO portal_users (customer_id, name, email) VALUES (?,?,?)').run(c.id, c.contact_name || c.name, email);
    u = { id: Number(info.lastInsertRowid) };
  } else db.prepare('UPDATE portal_users SET customer_id = ? WHERE id = ?').run(c.id, u.id);
  const token = setToken(db, u.id, 'invite', 14);
  const link = portalLink(db, `accept/${token}`);
  const s = getSettings(db);
  queue(() => sendEmail(db, { to: email, related: { type: 'customer', id: c.id }, subject: `Your ${s.company_name} customer portal`,
    text: `Hi ${c.contact_name || c.name},\n\nYou're invited to your ${s.company_name} customer portal. There you can view and pay invoices, update your payment method, see your service history and photos, request service or new equipment, and sign agreements.\n\nSet your password to get started (link valid for 14 days):\n${link}\n\n${s.company_name}${s.company_phone ? '\n' + s.company_phone : ''}` }));
  audit(db, user, 'portal invite', 'customers', c.id, email);
  return { link };
}

// New customers with "Invite to customer portal" ticked get an invite automatically.
registerHooks('customers', {
  afterSave(db, row, { existing, user }) {
    if (!existing && row.portal_invite && row.email) {
      try { invite(db, row.id, user); } catch (e) { console.error('portal invite:', e.message); }
    }
  },
});

/** After email is confirmed, link to an existing customer with the same email or create a new lead. */
function attachCustomer(db, u) {
  if (u.customer_id) return u.customer_id;
  const match = db.prepare("SELECT id FROM customers WHERE lower(email) = lower(?) AND id NOT IN (SELECT customer_id FROM portal_users WHERE customer_id IS NOT NULL) ORDER BY id LIMIT 1").get(u.email);
  let id = match?.id;
  if (!id) {
    const c = create(db, 'customers', {
      name: u.name, type: u.signup_type === 'commercial' ? 'commercial' : 'residential', email: u.email, phone: u.signup_phone || null,
      billing_address: u.signup_address || null, stage: 'lead', status: 'prospect', lead_source: 'portal sign-up', portal_invite: 0,
      notes: 'Signed up through the customer portal.',
    }, { id: null, name: 'customer portal', role: 'owner' });
    id = c.id;
    const s = getSettings(db);
    if (s.company_email) queue(() => sendEmail(db, { to: s.company_email, related: { type: 'customer', id }, subject: `New portal sign-up: ${u.name}`, text: `${u.name} (${u.email}${u.signup_phone ? ', ' + u.signup_phone : ''}) signed up through the customer portal and was added as a new lead.\n\n${appUrl(db)}/#/customers/${id}` }));
  }
  db.prepare('UPDATE portal_users SET customer_id = ? WHERE id = ?').run(id, u.id);
  return id;
}

// ------------------------------------------------------------------ routes
export function registerPortalRoutes(r) {
  const cookie = (setCookieHeader, https) => t => setCookieHeader(t
    ? `psid=${t}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${30 * 86400}${https ? '; Secure' : ''}`
    : `psid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${https ? '; Secure' : ''}`);
  const setPortalCookie = (res, req) => cookie(v => res.setHeader('Set-Cookie', v), process.env.COOKIE_SECURE === '1' || req.headers['x-forwarded-proto'] === 'https');
  const company = db => { const s = getSettings(db); return { name: s.company_name, phone: s.company_phone, email: s.company_email, logo: !!s.logo_key, online_payments: stripeConfig(db).ok }; };

  r('GET', '/api/portal/state', null, ({ db, req }) => {
    const u = portalUser(db, req);
    if (!u) return { user: null, company: company(db) };
    const accounts = u.customer_id ? db.prepare(`SELECT id, name, type FROM customers WHERE id IN (${accountIds(db, u).map(() => '?').join(',')}) ORDER BY id = ? DESC, name`).all(...accountIds(db, u), u.customer_id) : [];
    return { user: { name: u.name, email: u.email, verified: !!u.email_verified }, accounts, company: company(db) };
  });

  r('POST', '/api/portal/signup', null, ({ db, body, ip }) => {
    const name = String(body.name || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    if (name.length < 2) throw new HttpError(400, 'Enter your name');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address');
    const err = validatePassword(body.password);
    if (err) throw new HttpError(400, err);
    if (!loginAllowed(`signup|${ip}`)) throw new HttpError(429, 'Too many attempts. Try again later.');
    recordFailedLogin(`signup|${ip}`); // counts sign-ups per IP
    const existing = db.prepare('SELECT * FROM portal_users WHERE email = ?').get(email);
    // Same response either way so the form can't be used to discover who has an account.
    const ok = { ok: true, message: 'Check your email for a link to confirm your address.' };
    if (existing?.email_verified) {
      const t = setToken(db, existing.id, 'reset', 1);
      queue(() => sendEmail(db, { to: email, subject: 'You already have an account', text: `Someone (hopefully you) tried to sign up with this email, but you already have a portal account.\n\nSign in, or reset your password here:\n${portalLink(db, `reset/${t}`)}` }));
      return ok;
    }
    let id = existing?.id;
    if (!id) {
      id = Number(db.prepare('INSERT INTO portal_users (name, email, password_hash, signup_type, signup_phone, signup_address) VALUES (?,?,?,?,?,?)')
        .run(name, email, hashPassword(body.password), body.type === 'commercial' ? 'commercial' : 'residential', String(body.phone || '').slice(0, 40) || null, String(body.address || '').slice(0, 300) || null).lastInsertRowid);
    } else {
      db.prepare('UPDATE portal_users SET name = ?, password_hash = ? WHERE id = ?').run(name, hashPassword(body.password), id);
    }
    const t = setToken(db, id, 'verify', 3);
    const s = getSettings(db);
    queue(() => sendEmail(db, { to: email, subject: `Confirm your email for ${s.company_name}`, text: `Hi ${name},\n\nConfirm your email to open your ${s.company_name} customer portal:\n${portalLink(db, `verify/${t}`)}\n\nThis link is valid for 3 days.` }));
    return ok;
  });

  r('POST', '/api/portal/verify', null, ({ db, body, req, res }) => {
    const u = takeToken(db, body.token, ['verify', 'invite']);
    tx(db, () => {
      db.prepare('UPDATE portal_users SET email_verified = 1 WHERE id = ?').run(u.id);
      attachCustomer(db, { ...u, email_verified: 1 });
    });
    startSession(db, u.id, setPortalCookie(res, req));
    return { ok: true };
  });

  // Invite links: choose a password, then go straight in.
  r('POST', '/api/portal/accept', null, ({ db, body, req, res }) => {
    const err = validatePassword(body.password);
    if (err) throw new HttpError(400, err);
    const u = takeToken(db, body.token, ['invite', 'reset']);
    db.prepare('UPDATE portal_users SET password_hash = ?, email_verified = 1 WHERE id = ?').run(hashPassword(body.password), u.id);
    if (!u.customer_id) attachCustomer(db, u);
    db.prepare('DELETE FROM portal_sessions WHERE portal_user_id = ?').run(u.id);
    startSession(db, u.id, setPortalCookie(res, req));
    return { ok: true };
  });

  r('POST', '/api/portal/login', null, ({ db, body, req, res, ip }) => {
    const email = String(body.email || '').trim().toLowerCase();
    const key = `portal|${ip}|${email}`;
    if (!loginAllowed(key)) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
    const u = db.prepare('SELECT * FROM portal_users WHERE email = ? AND active = 1').get(email);
    if (!u?.password_hash || !verifyPassword(String(body.password || ''), u.password_hash)) { recordFailedLogin(key); throw new HttpError(401, 'Invalid email or password'); }
    clearLogins(key);
    startSession(db, u.id, setPortalCookie(res, req));
    return { ok: true, verified: !!u.email_verified };
  });

  r('POST', '/api/portal/logout', null, ({ db, req, res }) => {
    const t = cookieOf(req);
    if (t) db.prepare('DELETE FROM portal_sessions WHERE token_hash = ?').run(sha(t));
    setPortalCookie(res, req)(null);
    return { ok: true };
  });

  r('POST', '/api/portal/forgot', null, ({ db, body, ip }) => {
    if (!loginAllowed(`forgot|${ip}`)) throw new HttpError(429, 'Too many attempts. Try again later.');
    recordFailedLogin(`forgot|${ip}`);
    const u = db.prepare('SELECT * FROM portal_users WHERE email = ? AND active = 1').get(String(body.email || '').trim().toLowerCase());
    if (u) {
      const t = setToken(db, u.id, 'reset', 1);
      queue(() => sendEmail(db, { to: u.email, subject: 'Reset your password', text: `Use this link to choose a new password (valid for 24 hours):\n${portalLink(db, `reset/${t}`)}\n\nIf you didn't ask for this, ignore this email.` }));
    }
    return { ok: true, message: 'If that email has an account, a reset link is on its way.' };
  });

  r('POST', '/api/portal/resend-verification', null, ({ db, req }) => {
    const u = need(db, req, { verified: false });
    if (u.email_verified) return { ok: true };
    const t = setToken(db, u.id, 'verify', 3);
    queue(() => sendEmail(db, { to: u.email, subject: 'Confirm your email', text: `Confirm your email to open your customer portal:\n${portalLink(db, `verify/${t}`)}` }));
    return { ok: true };
  });

  // ---------------- signed-in customer
  r('GET', '/api/portal/dashboard', null, ({ db, req, query }) => {
    const u = need(db, req);
    const id = pickAccount(db, u, query.account);
    const invoices = list(db, 'invoices', { customer_id: id, status__in: 'sent,partial' }).filter(i => i.balance > 0);
    const calls = list(db, 'service_calls', { customer_id: id, limit: 50 });
    const today = todayLocal();
    const upcoming = calls.filter(c => c.scheduled_start && c.scheduled_start.slice(0, 10) >= today && !['completed', 'cancelled'].includes(c.status))
      .sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start));
    const proposals = db.prepare("SELECT id, number, title, kind, total, monthly_amount, public_token FROM proposals WHERE customer_id = ? AND status IN ('sent','viewed') AND (valid_until IS NULL OR valid_until >= ?)").all(id, today);
    const requests = calls.filter(c => c.status === 'new' && !c.scheduled_start);
    return {
      balance: invoices.reduce((t, i) => t + i.balance, 0), open_invoices: invoices.length,
      overdue: invoices.filter(i => i.display_status === 'overdue').length,
      next_visit: upcoming[0] ? publicCall(upcoming[0]) : null,
      to_sign: proposals.map(p => ({ title: p.title, kind: p.kind, number: p.number, total: p.total, monthly: p.monthly_amount, url: signingUrl(db, p.public_token) })),
      open_requests: requests.map(publicCall),
      monthly: db.prepare('SELECT COALESCE(SUM(amount),0) AS s FROM recurring_charges WHERE customer_id = ? AND active = 1').get(id).s,
    };
  });

  r('GET', '/api/portal/invoices', null, ({ db, req, query }) => {
    const u = need(db, req);
    const id = pickAccount(db, u, query.account);
    return list(db, 'invoices', { customer_id: id, status__not: 'draft,void' }).map(i => ({ id: i.id, number: i.number, kind: i.kind, period: i.period, issue_date: i.issue_date, due_date: i.due_date, total: i.total, balance: i.balance, status: i.display_status }));
  });

  r('GET', '/api/portal/invoices/:id', null, ({ db, req, params }) => {
    const u = need(db, req);
    const inv = ownRecord(db, u, 'invoices', params.id);
    if (['draft', 'void'].includes(inv.status)) throw new HttpError(404, 'Not found');
    const full = get(db, 'invoices', inv.id);
    const items = db.prepare('SELECT description, qty, unit_price FROM invoice_items WHERE invoice_id = ? ORDER BY id').all(inv.id);
    const payments = db.prepare('SELECT date, amount, method FROM payments WHERE invoice_id = ? ORDER BY date').all(inv.id);
    const cust = db.prepare('SELECT name, contact_name, billing_address, city, state, zip, account_number FROM customers WHERE id = ?').get(inv.customer_id);
    const s = getSettings(db);
    const job = inv.service_call_id ? db.prepare('SELECT id, number, signed_by, signed_at FROM service_calls WHERE id = ?').get(inv.service_call_id) : null;
    return {
      number: full.number, issue_date: full.issue_date, due_date: full.due_date, period: full.period, status: full.display_status, notes: full.notes,
      subtotal: full.subtotal, tax: full.tax, tax_rate: full.tax_rate, total: full.total, paid: full.paid, balance: full.balance, items, payments, customer: cust,
      company: { name: s.company_name, address: s.company_address, phone: s.company_phone, email: s.company_email, footer: s.invoice_footer },
      signed: job?.signed_by ? { by: job.signed_by, at: job.signed_at, call_id: job.id, number: job.number } : null,
    };
  });

  r('POST', '/api/portal/invoices/:id/pay', null, async ({ db, req, params }) => {
    const u = need(db, req);
    const inv = ownRecord(db, u, 'invoices', params.id);
    return checkoutForInvoice(db, inv.id, { returnUrl: `${appUrl(db)}/portal#/invoices/${inv.id}` });
  });

  r('GET', '/api/portal/payment-methods', null, async ({ db, req, query }) => {
    const u = need(db, req);
    const id = pickAccount(db, u, query.account);
    const c = db.prepare('SELECT preferred_payment FROM customers WHERE id = ?').get(id);
    return { online: stripeConfig(db).ok, preferred: c.preferred_payment, ...(stripeConfig(db).ok ? await listMethods(db, id) : { methods: [], default: null }) };
  });
  r('POST', '/api/portal/payment-methods/setup', null, async ({ db, req, body }) => {
    const u = need(db, req);
    return checkoutForSetup(db, pickAccount(db, u, body.account), { returnUrl: `${appUrl(db)}/portal#/payment-methods` });
  });
  r('POST', '/api/portal/payment-methods/:pm/default', null, async ({ db, req, params, body }) => setDefaultMethod(db, pickAccount(db, need(db, req), body.account), params.pm));
  r('DELETE', '/api/portal/payment-methods/:pm', null, async ({ db, req, params, query }) => removeMethod(db, pickAccount(db, need(db, req), query.account), params.pm));
  r('PUT', '/api/portal/payment-preference', null, ({ db, req, body }) => {
    const u = need(db, req);
    const id = pickAccount(db, u, body.account);
    if (!['cash', 'check', 'card', 'ach'].includes(body.preferred_payment)) throw new HttpError(400, 'Choose cash, check, card or bank (ACH)');
    db.prepare('UPDATE customers SET preferred_payment = ? WHERE id = ?').run(body.preferred_payment, id);
    return { ok: true };
  });

  const publicCall = c => ({
    id: c.id, number: c.number, title: c.title, call_type: c.call_type, system_type: c.system_type, status: c.status,
    scheduled_start: c.scheduled_start, technician: c.technician_id_label ? c.technician_id_label.split(' ')[0] : null,
    resolution: c.status === 'completed' ? c.resolution : null, completed_at: c.completed_at, site: c.site_id_label, signed_by: c.signed_by,
  });

  r('GET', '/api/portal/service-calls', null, ({ db, req, query }) => {
    const u = need(db, req);
    const id = pickAccount(db, u, query.account);
    const calls = list(db, 'service_calls', { customer_id: id, status__not: 'cancelled', limit: 200 });
    const photos = db.prepare(`SELECT p.id, p.service_call_id, p.kind, p.caption FROM job_photos p JOIN service_calls s ON s.id = p.service_call_id WHERE s.customer_id = ? AND p.show_customer = 1 ORDER BY p.id`).all(id);
    return calls.map(c => ({ ...publicCall(c), photos: photos.filter(p => p.service_call_id === c.id).map(({ id: pid, kind, caption }) => ({ id: pid, kind, caption })) }));
  });

  r('GET', '/api/portal/photos/:id', null, ({ db, req, params, res }) => {
    const u = need(db, req);
    const p = db.prepare('SELECT p.file_key, p.show_customer, s.customer_id FROM job_photos p JOIN service_calls s ON s.id = p.service_call_id WHERE p.id = ?').get(Number(params.id));
    if (!p || !p.show_customer || !accountIds(db, u).includes(p.customer_id)) throw new HttpError(404, 'Not found');
    sendImage(res, 'photos', p.file_key);
    return undefined;
  });

  r('GET', '/api/portal/service-calls/:id/signature', null, ({ db, req, params, res }) => {
    const u = need(db, req);
    const c = ownRecord(db, u, 'service_calls', params.id);
    if (!c.signature_key) throw new HttpError(404, 'Not signed');
    sendImage(res, 'signatures', c.signature_key);
    return undefined;
  });

  r('GET', '/api/portal/locations', null, ({ db, req, query }) => {
    const u = need(db, req);
    const id = pickAccount(db, u, query.account);
    return db.prepare('SELECT id, name, address, city, state, zip FROM locations WHERE customer_id = ? AND active = 1 ORDER BY name').all(id);
  });

  r('GET', '/api/portal/systems', null, ({ db, req, query }) => {
    const u = need(db, req);
    const id = pickAccount(db, u, query.account);
    const q = (t, cols) => db.prepare(`SELECT ${cols} FROM ${t} WHERE customer_id = ?`).all(id);
    return {
      cameras: q('camera_systems', 'location, brand, camera_count, app_name, next_service'),
      alarms: q('alarm_systems', 'location, panel_brand, monitoring_account, next_test'),
      fire: q('fire_systems', 'location, system_type, next_inspection'),
      extinguishers: db.prepare("SELECT COUNT(*) AS n, MIN(next_annual) AS next_annual FROM extinguishers WHERE customer_id = ? AND status NOT IN ('removed')").get(id),
    };
  });

  // "Schedule a service call": the customer picks a preferred day and time window; the office confirms.
  r('POST', '/api/portal/service-requests', null, ({ db, req, body }) => {
    const u = need(db, req);
    const id = pickAccount(db, u, body.account);
    const title = String(body.title || '').trim();
    if (title.length < 3) throw new HttpError(400, 'Tell us briefly what you need help with');
    const site = body.location_id ? db.prepare('SELECT id FROM locations WHERE id = ? AND customer_id = ?').get(Number(body.location_id), id) : null;
    const pref = /^\d{4}-\d{2}-\d{2}$/.test(body.preferred_date || '') && body.preferred_date >= todayLocal() ? body.preferred_date : null;
    const windows = { morning: 'morning (8–12)', afternoon: 'afternoon (12–5)', any: 'any time' };
    const call = create(db, 'service_calls', {
      customer_id: id, site_id: site?.id || null, title: title.slice(0, 200), call_type: 'service',
      system_type: ['camera', 'alarm', 'fire alarm', 'sprinkler', 'extinguisher', 'access control', 'other'].includes(body.system_type) ? body.system_type : 'other',
      priority: body.urgent ? 'high' : 'normal', status: 'new',
      description: `${String(body.description || '').slice(0, 4000)}\n\n— Requested through the customer portal by ${u.name}.${pref ? `\nPreferred: ${new Date(pref + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}, ${windows[body.window] || 'any time'}.` : ''}`,
    }, { id: null, name: `${u.name} (portal)`, role: 'owner' });
    officeAlert(db, `New service request: ${title}`, `${u.name} requested service through the portal.\n\n${title}\n${body.description || ''}${pref ? `\nPreferred: ${pref}, ${windows[body.window] || 'any time'}` : ''}\n\n${appUrl(db)}/#/calls/${call.id}`, { type: 'service_call', id: call.id });
    return { ok: true, number: call.number };
  });

  // "Request equipment": becomes a draft proposal for the sales team to price.
  r('POST', '/api/portal/equipment-requests', null, ({ db, req, body }) => {
    const u = need(db, req);
    const id = pickAccount(db, u, body.account);
    const what = String(body.what || '').trim();
    if (what.length < 3) throw new HttpError(400, 'Tell us what equipment you are interested in');
    const site = body.location_id ? db.prepare('SELECT id FROM locations WHERE id = ? AND customer_id = ?').get(Number(body.location_id), id) : null;
    const p = create(db, 'proposals', {
      customer_id: id, site_id: site?.id || null, kind: 'proposal', title: `Request: ${what}`.slice(0, 200),
      intro: `${String(body.details || '').slice(0, 4000)}\n\n— Requested through the customer portal by ${u.name}.`,
    }, { id: null, name: `${u.name} (portal)`, role: 'owner' });
    officeAlert(db, `Equipment request: ${what}`, `${u.name} asked about: ${what}\n\n${body.details || ''}\n\nA draft proposal was created for you to price:\n${appUrl(db)}/#/proposals/${p.id}`, { type: 'proposal', id: p.id });
    return { ok: true };
  });

  r('GET', '/api/portal/agreements', null, ({ db, req, query }) => {
    const u = need(db, req);
    const id = pickAccount(db, u, query.account);
    return db.prepare("SELECT number, title, kind, status, total, monthly_amount, signed_at, sent_at, public_token FROM proposals WHERE customer_id = ? AND status IN ('sent','viewed','signed') ORDER BY id DESC").all(id)
      .map(({ public_token, ...p }) => ({ ...p, url: signingUrl(db, public_token) }));
  });

  r('GET', '/api/portal/profile', null, ({ db, req, query }) => {
    const u = need(db, req);
    const id = pickAccount(db, u, query.account);
    const c = db.prepare('SELECT name, contact_name, email, phone, alt_phone, billing_address, city, state, zip, notify_email, notify_sms FROM customers WHERE id = ?').get(id);
    return { login_email: u.email, login_name: u.name, ...c };
  });
  r('PUT', '/api/portal/profile', null, ({ db, req, body }) => {
    const u = need(db, req);
    const id = pickAccount(db, u, body.account);
    const s = (v, n = 200) => v == null ? undefined : String(v).trim().slice(0, n);
    const fields = { phone: s(body.phone, 40), alt_phone: s(body.alt_phone, 40), billing_address: s(body.billing_address), city: s(body.city, 80), state: s(body.state, 40), zip: s(body.zip, 20),
      notify_email: body.notify_email === undefined ? undefined : (body.notify_email ? 1 : 0), notify_sms: body.notify_sms === undefined ? undefined : (body.notify_sms ? 1 : 0) };
    const keys = Object.keys(fields).filter(k => fields[k] !== undefined);
    if (keys.length) db.prepare(`UPDATE customers SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = datetime('now','localtime') WHERE id = ?`).run(...keys.map(k => fields[k]), id);
    audit(db, { name: `${u.name} (portal)` }, 'update profile', 'customers', id, keys.join(','));
    return { ok: true };
  });
  r('POST', '/api/portal/password', null, ({ db, req, body }) => {
    const u = need(db, req, { verified: false });
    if (!verifyPassword(String(body.current || ''), u.password_hash || '')) throw new HttpError(400, 'Current password is incorrect');
    const err = validatePassword(body.password);
    if (err) throw new HttpError(400, err);
    db.prepare('UPDATE portal_users SET password_hash = ? WHERE id = ?').run(hashPassword(body.password), u.id);
    return { ok: true };
  });
}

function officeAlert(db, subject, text, related) {
  const s = getSettings(db);
  if (s.company_email) queue(() => sendEmail(db, { to: s.company_email, subject, text, related }));
}
