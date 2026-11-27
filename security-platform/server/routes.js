// Custom (non-CRUD) endpoints: auth, users, settings, dashboard, billing runs,
// inventory moves, maintenance, reports, search, export, backup.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { RESOURCES, MAINTENANCE } from '../public/js/schema.js';
import { getSettings, DEFAULT_SETTINGS, PRIVATE_SETTINGS, SECRET_SETTINGS, INTERNAL_SETTINGS, tx, DATA_DIR } from './db.js';
import { markInvoiceDirty, qboConfig, qboConnected, authorizeUrl, handleCallback, disconnect as qboDisconnect, listItems as qboItems, syncAll as qboSync, exportFile } from './quickbooks.js';
import { queue, notifyOnMyWay, notifyScheduled, sendEmail, sendSms, mailConfig, smsConfig, appUrl } from './notify.js';
import { ingest, processInvoice, receive, saveReview, parseInboundEmail, filePath } from './receiving.js';
import { aiConfigured } from './extract.js';
import { callToEvent, buildCalendar } from './calendar.js';
import { decodeImage, saveImage, sendImage, removeImage } from './media.js';
import { sendForSignature, duplicate, publicView, byToken, markViewed, sign, decline, signingUrl } from './proposals.js';
import { registerPortalRoutes, invite as portalInvite } from './portal.js';
import { registerTruckStockRoutes } from './truckstock.js';
import { openAlerts, resolveAlert } from './alerts.js';
import { putOnTest, clearTest, markConfirmed, logEvent, ingestSignals, stationInfo, CONNECTORS } from './monitoring.js';
import { stripeConfig, checkoutForInvoice, checkoutForSetup, listMethods, removeMethod, setDefaultMethod, chargeSaved, payLink, handleWebhook } from './payments.js';

/** For technicians, keep only rows about customers on their schedule (rows with no customer, like vehicles, stay). */
function scoped(db, user, rows, key = 'customer_id') {
  const ids = techCustomerIds(db, user);
  return ids ? rows.filter(r => r[key] == null || ids.has(r[key])) : rows;
}
function callCustomerCheck(db, user, callId) {
  const call = db.prepare('SELECT customer_id FROM service_calls WHERE id = ?').get(Number(callId));
  if (!call) throw new HttpError(404, 'Service call not found');
  assertCustomerVisible(db, user, call.customer_id);
}

export function baseUrl(db, req) {
  const s = getSettings(db);
  if (s.public_url) return s.public_url.replace(/\/$/, '');
  const proto = req?.headers['x-forwarded-proto'] || (req?.socket?.encrypted ? 'https' : 'http');
  return `${proto}://${req?.headers['x-forwarded-host'] || req?.headers.host || 'localhost'}`;
}
import {
  HttpError, list, get, create, update, adjustStock, techCustomerIds, assertCustomerVisible, grantAccess, recalcInvoice, round2, todayLocal, nowLocal, addMonths, addDays,
} from './resources.js';
import {
  hashPassword, verifyPassword, validatePassword, createSession, destroySession, audit, encrypt,
  loginAllowed, recordFailedLogin, clearLogins,
} from './security.js';

import { G, ROLES } from '../public/js/schema.js';
const ALL = G.all;
const MANAGE = G.manage;
const BILLING = G.billing;

const monthLabel = p => new Date(p + '-15T00:00:00Z').toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const monthsBetween = (from, to) => {
  const out = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while ((y < ty || (y === ty && m <= tm)) && out.length < 120) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
};
const monthStart = () => todayLocal().slice(0, 8) + '01';
const monthEnd = d => addDays(addMonths(d.slice(0, 8) + '01', 1), -1);

function requireStr(v, label) {
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `${label} is required`);
  return v.trim();
}

function publicUser(u) {
  return u && { id: u.id, name: u.name, email: u.email, role: u.role, technician_id: u.technician_id };
}

export function buildRoutes() {
  const routes = [];
  const r = (method, pattern, roles, handler) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, roles, handler });
  };

  // ------------------------------------------------------------ auth
  r('GET', '/api/auth/state', null, ({ db, user }) => ({
    needsSetup: db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0,
    user: publicUser(user),
    company: getSettings(db).company_name,
    logo: (getSettings(db).logo_key || '').slice(0, 8) || null,
  }));

  r('POST', '/api/auth/setup', null, ({ db, body, setCookie }) => {
    if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) throw new HttpError(409, 'Setup already completed');
    const name = requireStr(body.name, 'Name');
    const email = requireStr(body.email, 'Email').toLowerCase();
    const err = validatePassword(body.password);
    if (err) throw new HttpError(400, err);
    const info = db.prepare("INSERT INTO users(name, email, password_hash, role) VALUES (?,?,?,'owner')").run(name, email, hashPassword(body.password));
    if (body.company_name) db.prepare("UPDATE settings SET value = ? WHERE key = 'company_name'").run(String(body.company_name).trim());
    setCookie(createSession(db, Number(info.lastInsertRowid)));
    audit(db, { id: Number(info.lastInsertRowid), name }, 'setup', 'users', Number(info.lastInsertRowid));
    return { ok: true };
  });

  r('POST', '/api/auth/login', null, ({ db, body, setCookie, ip }) => {
    const email = String(body.email || '').trim().toLowerCase();
    const key = `${ip}|${email}`;
    if (!loginAllowed(key)) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!u || !u.active || !verifyPassword(String(body.password || ''), u.password_hash)) {
      recordFailedLogin(key);
      throw new HttpError(401, 'Invalid email or password');
    }
    clearLogins(key);
    setCookie(createSession(db, u.id));
    audit(db, u, 'login', 'users', u.id);
    return { user: publicUser(u) };
  });

  r('POST', '/api/auth/logout', null, ({ db, token, setCookie }) => {
    destroySession(db, token);
    setCookie(null);
    return { ok: true };
  });

  r('POST', '/api/auth/password', ALL, ({ db, user, body }) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    if (!verifyPassword(String(body.current || ''), u.password_hash)) throw new HttpError(400, 'Current password is incorrect');
    const err = validatePassword(body.password);
    if (err) throw new HttpError(400, err);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(body.password), user.id);
    audit(db, user, 'change password', 'users', user.id);
    return { ok: true };
  });

  // ------------------------------------------------------------ users
  r('GET', '/api/users', MANAGE, ({ db }) => db.prepare(`SELECT u.id, u.name, u.email, u.role, u.technician_id, u.active, u.last_login,
      t.name AS technician_name FROM users u LEFT JOIN technicians t ON t.id = u.technician_id ORDER BY u.active DESC, u.name`).all());

  r('POST', '/api/users', MANAGE, ({ db, body, user }) => {
    const name = requireStr(body.name, 'Name');
    const email = requireStr(body.email, 'Email').toLowerCase();
    if (!ROLES.includes(body.role)) throw new HttpError(400, 'Invalid role');
    if (body.role === 'owner' && user.role !== 'owner') throw new HttpError(403, 'Only an owner can create another owner account');
    const err = validatePassword(body.password);
    if (err) throw new HttpError(400, err);
    try {
      const info = db.prepare('INSERT INTO users(name, email, password_hash, role, technician_id) VALUES (?,?,?,?,?)')
        .run(name, email, hashPassword(body.password), body.role, body.technician_id ? Number(body.technician_id) : null);
      audit(db, user, 'create', 'users', Number(info.lastInsertRowid), body.role);
      return { id: Number(info.lastInsertRowid) };
    } catch (e) {
      if (/UNIQUE/.test(e.message)) throw new HttpError(409, 'A user with that email already exists');
      throw e;
    }
  });

  r('PUT', '/api/users/:id', MANAGE, ({ db, body, user, params }) => {
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(params.id));
    if (!target) throw new HttpError(404, 'Not found');
    const role = body.role ?? target.role;
    const active = body.active === undefined ? target.active : (body.active ? 1 : 0);
    if (!ROLES.includes(role)) throw new HttpError(400, 'Invalid role');
    if ((target.role === 'owner' || role === 'owner') && user.role !== 'owner') throw new HttpError(403, 'Only an owner can change owner accounts');
    if (target.role === 'owner' && (role !== 'owner' || !active)) {
      const owners = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND active = 1").get().n;
      if (owners <= 1) throw new HttpError(400, 'You must keep at least one active owner');
    }
    db.prepare('UPDATE users SET name = ?, email = ?, role = ?, active = ?, technician_id = ? WHERE id = ?').run(
      body.name?.trim() || target.name, body.email?.trim().toLowerCase() || target.email, role, active,
      body.technician_id === undefined ? target.technician_id : (body.technician_id ? Number(body.technician_id) : null), target.id);
    if (body.password) {
      const err = validatePassword(body.password);
      if (err) throw new HttpError(400, err);
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(body.password), target.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
    }
    if (!active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
    audit(db, user, 'update', 'users', target.id, body.password ? 'password reset' : null);
    return { ok: true };
  });

  // ------------------------------------------------------------ settings
  r('GET', '/api/settings', ALL, ({ db, user }) => {
    const s = getSettings(db);
    for (const k of SECRET_SETTINGS) { s[`${k}__set`] = !!s[k]; delete s[k]; }
    for (const k of INTERNAL_SETTINGS) delete s[k];
    if (!MANAGE.includes(user.role)) for (const k of PRIVATE_SETTINGS) delete s[k];
    else { s.email_ready = mailConfig(db).ok; s.sms_ready = smsConfig(db).ok; }
    return s;
  });
  r('PUT', '/api/settings', MANAGE, ({ db, body, user }) => {
    const up = db.prepare('INSERT INTO settings(key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
      if (!(k in body) || INTERNAL_SETTINGS.has(k)) continue;
      if (SECRET_SETTINGS.has(k)) { if (body[k]) up.run(k, encrypt(String(body[k]))); continue; } // blank = keep
      if (!PRIVATE_SETTINGS.has(k)) up.run(k, String(body[k] ?? ''));
    }
    audit(db, user, 'update', 'settings', null);
    return getSettings(db);
  });

  r('POST', '/api/settings/logo', MANAGE, ({ db, body, user }) => {
    const img = decodeImage(body.data, { maxBytes: 2 * 1024 * 1024 });
    const old = getSettings(db).logo_key;
    const key = saveImage('branding', img);
    db.prepare("INSERT INTO settings(key, value) VALUES ('logo_key', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key);
    removeImage('branding', old);
    audit(db, user, 'update logo', 'settings', null);
    return { ok: true };
  });
  r('DELETE', '/api/settings/logo', MANAGE, ({ db, user }) => {
    removeImage('branding', getSettings(db).logo_key);
    db.prepare("UPDATE settings SET value = '' WHERE key = 'logo_key'").run();
    audit(db, user, 'remove logo', 'settings', null);
    return { ok: true };
  });
  // Public: shown on sign-in, invoices, agreements and the customer portal.
  r('GET', '/api/public/logo', null, ({ db, res }) => {
    const key = getSettings(db).logo_key;
    if (!key) throw new HttpError(404, 'No logo');
    sendImage(res, 'branding', key, { cache: 'public, max-age=3600' });
    return undefined;
  });

  r('GET', '/api/audit', MANAGE, ({ db, query }) =>
    db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(Math.min(Number(query.limit) || 300, 2000)));

  // ------------------------------------------------------------ dashboard
  r('GET', '/api/dashboard', ALL, ({ db, user }) => {
    const today = todayLocal();
    const isTech = user.role === 'technician';
    const seesMoney = BILLING.includes(user.role);
    const callWhere = isTech && user.technician_id ? `AND t.technician_id = ${Number(user.technician_id)}` : '';
    const todayCalls = list(db, 'service_calls', { from: today, to: today, limit: 200 }, user)
      .filter(c => !isTech || !user.technician_id || c.technician_id === user.technician_id)
      .sort((a, b) => (a.scheduled_start || '').localeCompare(b.scheduled_start || ''));
    const out = {
      today,
      todayCalls,
      openCalls: db.prepare(`SELECT COUNT(*) AS n FROM service_calls t WHERE status NOT IN ('completed','cancelled') ${callWhere}`).get().n,
      unassignedCalls: db.prepare(`SELECT COUNT(*) AS n FROM service_calls WHERE status NOT IN ('completed','cancelled') AND technician_id IS NULL`).get().n,
      emergencies: db.prepare(`SELECT COUNT(*) AS n FROM service_calls t WHERE status NOT IN ('completed','cancelled') AND priority = 'emergency' ${callWhere}`).get().n,
      customers: db.prepare(`SELECT type, COUNT(*) AS n FROM customers WHERE status = 'active' GROUP BY type`).all(),
      maintenance: scoped(db, user, maintenanceDue(db, 30)),
      lowStock: db.prepare(`SELECT i.id, i.name, i.sku, i.reorder_level, COALESCE(SUM(s.qty),0) AS total_qty
        FROM inventory_items i LEFT JOIN stock s ON s.item_id = i.id WHERE i.active = 1
        GROUP BY i.id HAVING total_qty < i.reorder_level ORDER BY total_qty - i.reorder_level LIMIT 10`).all(),
    };
    if (seesMoney) {
      const m = today.slice(0, 7);
      out.mrr = round2(db.prepare(`SELECT COALESCE(SUM(rc.amount),0) AS s FROM recurring_charges rc JOIN customers c ON c.id = rc.customer_id
        WHERE rc.active = 1 AND c.status = 'active'`).get().s);
      const open = list(db, 'invoices', { status__in: 'sent,partial' }, user).filter(i => i.balance > 0);
      out.arTotal = round2(open.reduce((s, i) => s + i.balance, 0));
      const overdue = open.filter(i => i.display_status === 'overdue');
      out.overdueTotal = round2(overdue.reduce((s, i) => s + i.balance, 0));
      out.overdueInvoices = overdue.sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 8);
      out.monthRevenue = round2(db.prepare(`SELECT COALESCE(SUM(total),0) AS s FROM invoices WHERE status NOT IN ('void','draft') AND substr(issue_date,1,7) = ?`).get(m).s);
      out.monthCollected = round2(db.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE substr(date,1,7) = ?`).get(m).s);
      out.monthExpenses = round2(db.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM expenses WHERE substr(date,1,7) = ?`).get(m).s);
      out.monthlyBilled = !!db.prepare(`SELECT 1 FROM invoices WHERE kind = 'monthly' AND period = ? AND status <> 'void' LIMIT 1`).get(m);
      out.drafts = db.prepare(`SELECT COUNT(*) AS n FROM invoices WHERE status = 'draft'`).get().n;
      out.receivingReview = db.prepare(`SELECT COUNT(*) AS n FROM purchase_invoices WHERE status IN ('needs review','error')`).get().n;
      out.uninvoicedCalls = db.prepare(`SELECT COUNT(*) AS n FROM service_calls WHERE status = 'completed' AND billable = 1 AND invoice_id IS NULL`).get().n;
    }
    return out;
  });

  r('GET', '/api/search', ALL, ({ db, query, user }) => {
    const q = String(query.q || '').trim();
    if (q.length < 2) return [];
    const out = [];
    const push = (kind, rows, toItem) => rows.forEach(x => out.push({ kind, ...toItem(x) }));
    push('Customer', list(db, 'customers', { q, limit: 8 }, user), c => ({ id: c.id, title: c.name, sub: [c.type, c.phone, c.city].filter(Boolean).join(' · '), href: `#/customers/${c.id}` }));
    push('Service call', list(db, 'service_calls', { q, limit: 6 }, user), c => ({ id: c.id, title: `SC-${c.number} ${c.title}`, sub: `${c.customer_id_label} · ${c.status}`, href: `#/calls/${c.id}` }));
    if (BILLING.includes(user.role)) {
      push('Invoice', list(db, 'invoices', { q, limit: 5 }), i => ({ id: i.id, title: `Invoice #${i.number}`, sub: `${i.customer_id_label} · $${i.total}`, href: `#/invoices/${i.id}` }));
    }
    push('Item', list(db, 'inventory_items', { q, limit: 5 }), i => ({ id: i.id, title: i.name, sub: `${i.sku || ''} · ${i.total_qty} on hand`, href: `#/inventory/${i.id}` }));
    push('Vehicle', list(db, 'vehicles', { q, limit: 3 }), v => ({ id: v.id, title: v.unit_name, sub: [v.year, v.make, v.model].filter(Boolean).join(' '), href: `#/vehicles/${v.id}` }));
    push('Technician', list(db, 'technicians', { q, limit: 3 }), t => ({ id: t.id, title: t.name, sub: t.phone || '', href: `#/technicians` }));
    return out;
  });

  // ------------------------------------------------------------ alarm monitoring
  const acctOr404 = (db, id, user) => {
    const a = db.prepare('SELECT * FROM monitoring_accounts WHERE id = ?').get(Number(id));
    if (!a) throw new HttpError(404, 'Monitoring account not found');
    if (user) assertCustomerVisible(db, user, a.customer_id);
    return a;
  };
  r('GET', '/api/monitoring/:id/events', ALL, ({ db, params, query, user }) => {
    acctOr404(db, params.id, user);
    const where = ['account_id = ?'];
    const args = [Number(params.id)];
    if (query.type) { where.push('event_type IN (' + String(query.type).split(',').map(() => '?').join(',') + ')'); args.push(...String(query.type).split(',')); }
    if (query.from) { where.push('occurred_at >= ?'); args.push(query.from); }
    if (query.to) { where.push('occurred_at <= ?'); args.push(query.to + 'T23:59'); }
    return db.prepare(`SELECT * FROM monitoring_events WHERE ${where.join(' AND ')} ORDER BY occurred_at DESC, id DESC LIMIT ?`).all(...args, Math.min(Number(query.limit) || 300, 2000));
  });
  r('POST', '/api/monitoring/:id/events', ALL, ({ db, params, body, user }) => {
    acctOr404(db, params.id, user);
    const description = String(body.description || '').trim();
    if (!description) throw new HttpError(400, 'Describe what happened');
    logEvent(db, Number(params.id), { type: ['note', 'alarm', 'trouble', 'restore', 'test', 'cancel', 'other'].includes(body.type) ? body.type : 'note', code: body.code, zone: body.zone, description, disposition: body.disposition, time: body.time, source: 'manual', user });
    return { ok: true };
  });
  r('GET', '/api/monitoring/:id/station', ALL, ({ db, params, user }) => stationInfo(db, acctOr404(db, params.id, user).station_id));
  r('POST', '/api/monitoring/:id/test', ALL, ({ db, params, body, user }) => { acctOr404(db, params.id, user); return putOnTest(db, params.id, body, user); });
  r('POST', '/api/monitoring/:id/test/clear', ALL, ({ db, params, user }) => { acctOr404(db, params.id, user); return clearTest(db, params.id, user); });
  r('POST', '/api/monitoring/:id/confirmed', ALL, ({ db, params, user }) => { acctOr404(db, params.id, user); markConfirmed(db, params.id, user); return { ok: true }; });
  r('GET', '/api/monitoring-on-test', ALL, ({ db, user }) => scoped(db, user, db.prepare(`SELECT a.id, a.account_number, a.test_until, a.test_reason, a.test_by, a.customer_id, c.name AS customer, s.name AS station
    FROM monitoring_accounts a JOIN customers c ON c.id = a.customer_id JOIN monitoring_stations s ON s.id = a.station_id WHERE a.status = 'on test' ORDER BY a.test_until`).all()));
  r('GET', '/api/monitoring-stations/:id/feed', MANAGE, ({ db, params, req }) => {
    const s = db.prepare('SELECT inbound_token, connector FROM monitoring_stations WHERE id = ?').get(Number(params.id));
    if (!s) throw new HttpError(404, 'Not found');
    return { url: `${baseUrl(db, req)}/api/inbound/monitoring/${s.inbound_token}`, connectors: Object.entries(CONNECTORS).map(([k, v]) => ({ id: k, label: v.label, connected: !!v.connected })) };
  });
  r('POST', '/api/monitoring-stations/:id/feed/reset', MANAGE, ({ db, params, user }) => {
    db.prepare('UPDATE monitoring_stations SET inbound_token = ? WHERE id = ?').run(crypto.randomBytes(20).toString('base64url'), Number(params.id));
    audit(db, user, 'reset signal feed', 'monitoring_stations', Number(params.id));
    return { ok: true };
  });
  // Signals pushed by a central station (or middleware). The secret key in the URL is the credential.
  r('POST', '/api/inbound/monitoring/:token', null, ({ db, params, body }) => ingestSignals(db, params.token, body));
  // Turn the "monitoring center / account #" already typed on alarm systems into linked monitoring accounts.
  r('POST', '/api/monitoring/import-alarm-systems', MANAGE, ({ db, user }) => tx(db, () => {
    const rows = db.prepare(`SELECT a.* FROM alarm_systems a WHERE COALESCE(a.monitoring_account,'') <> ''
      AND NOT EXISTS (SELECT 1 FROM monitoring_accounts m WHERE m.alarm_system_id = a.id)`).all();
    let created = 0;
    for (const a of rows) {
      const name = (a.monitoring_center || 'Central station').trim();
      let st = db.prepare('SELECT id FROM monitoring_stations WHERE lower(name) = lower(?)').get(name);
      if (!st) st = { id: create(db, 'monitoring_stations', { name }, user).id };
      create(db, 'monitoring_accounts', { customer_id: a.customer_id, site_id: a.site_id, station_id: st.id, account_number: a.monitoring_account, alarm_system_id: a.id, status: 'active',
        communicator: { cellular: 'cellular', ip: 'IP', 'dual path': 'dual path', 'phone line': 'POTS' }[a.communicator] || null, service_type: 'burglary' }, user);
      created++;
    }
    return { created };
  }));

  // ------------------------------------------------------------ QuickBooks & accounting exports
  r('GET', '/api/qbo/status', BILLING, ({ db }) => {
    const c = qboConfig(db);
    const errors = db.prepare("SELECT entity, local_id, error, synced_at FROM qbo_map WHERE error IS NOT NULL ORDER BY synced_at DESC LIMIT 50").all();
    const synced = db.prepare("SELECT entity, COUNT(*) AS n FROM qbo_map WHERE qbo_id IS NOT NULL AND error IS NULL GROUP BY entity").all();
    return { has_app: !!(c.clientId && c.clientSecret), client_id: c.clientId, env: c.env, connected: qboConnected(db), company: c.company, item_id: c.itemId, tax_item_id: c.taxItemId,
      auto_sync: c.autoSync, last_sync: c.lastSync, redirect_uri: c.redirectUri, errors, synced: Object.fromEntries(synced.map(x => [x.entity, x.n])) };
  });
  r('PUT', '/api/qbo/settings', BILLING, ({ db, body, user }) => {
    const up = db.prepare('INSERT INTO settings(key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const k of ['qbo_client_id', 'qbo_item_id', 'qbo_tax_item_id', 'export_income_account', 'export_tax_account']) if (k in body) up.run(k, String(body[k] ?? '').trim());
    if ('qbo_environment' in body) up.run('qbo_environment', body.qbo_environment === 'production' ? 'production' : 'sandbox');
    if ('qbo_auto_sync' in body) up.run('qbo_auto_sync', body.qbo_auto_sync ? '1' : '0');
    if (body.qbo_client_secret) up.run('qbo_client_secret', encrypt(String(body.qbo_client_secret).trim()));
    audit(db, user, 'update', 'settings', null, 'QuickBooks');
    return { ok: true };
  });
  r('POST', '/api/qbo/connect', BILLING, ({ db }) => ({ url: authorizeUrl(db) }));
  r('GET', '/api/qbo/callback', null, async ({ db, query, res }) => {
    let to = '/#/accounting?qbo=connected';
    try { await handleCallback(db, query); } catch (e) { to = `/#/accounting?qbo_error=${encodeURIComponent(e.message)}`; }
    res.writeHead(302, { Location: to }); res.end();
    return undefined;
  });
  r('POST', '/api/qbo/disconnect', BILLING, async ({ db, user }) => { await qboDisconnect(db, user); return { ok: true }; });
  r('GET', '/api/qbo/items', BILLING, ({ db }) => qboItems(db));
  r('POST', '/api/qbo/sync', BILLING, ({ db, user }) => qboSync(db, { user }));
  r('GET', '/api/accounting/export', BILLING, ({ db, query, res, user }) => {
    const f = exportFile(db, query.format, { from: query.from || undefined, to: query.to || undefined });
    res.writeHead(200, { 'Content-Type': f.type, 'Content-Disposition': `attachment; filename="${f.name}"` });
    res.end(f.body);
    audit(db, user, 'accounting export', null, null, query.format);
    return undefined;
  });

  // ------------------------------------------------------------ customer portal
  registerPortalRoutes(r);

  // ------------------------------------------------------------ truck stock, job materials, start-of-day check
  registerTruckStockRoutes(r);

  // ------------------------------------------------------------ alerts for the owner / office
  r('GET', '/api/alerts', G.staff, ({ db, user }) => openAlerts(db, user.role));
  r('POST', '/api/alerts/:id/resolve', G.staff, ({ db, params, user }) => { resolveAlert(db, params.id, user); return { ok: true }; });
  r('POST', '/api/customers/:id/portal-invite', G.customers, ({ db, params, body, user }) => portalInvite(db, Number(params.id), user, { email: body.email }));
  r('GET', '/api/customers/:id/portal-users', G.customers, ({ db, params }) =>
    db.prepare('SELECT id, name, email, email_verified, active, last_login, created_at FROM portal_users WHERE customer_id = ? ORDER BY id').all(Number(params.id)));
  r('PUT', '/api/portal-users/:id', G.manage, ({ db, params, body, user }) => {
    db.prepare('UPDATE portal_users SET active = ? WHERE id = ?').run(body.active ? 1 : 0, Number(params.id));
    if (!body.active) db.prepare('DELETE FROM portal_sessions WHERE portal_user_id = ?').run(Number(params.id));
    audit(db, user, body.active ? 'enable portal login' : 'disable portal login', 'portal_users', Number(params.id));
    return { ok: true };
  });

  // ------------------------------------------------------------ online payments (Stripe)
  r('GET', '/api/payments/config', BILLING, ({ db }) => {
    const c = stripeConfig(db);
    return { ok: c.ok, test: c.test, ach: c.ach, webhook_ready: !!c.webhookSecret, webhook_url: `${appUrl(db)}/api/stripe/webhook` };
  });
  r('POST', '/api/invoices/:id/pay-link', BILLING, ({ db, params }) => {
    if (!stripeConfig(db).ok) throw new HttpError(400, 'Online payments are not set up yet (Settings → Payments).');
    return { url: payLink(db, Number(params.id)) };
  });
  r('POST', '/api/invoices/:id/email-pay-link', BILLING, ({ db, params, user }) => {
    if (!stripeConfig(db).ok) throw new HttpError(400, 'Online payments are not set up yet (Settings → Payments).');
    const inv = get(db, 'invoices', params.id);
    if (!(inv.balance > 0)) throw new HttpError(400, 'Nothing is owed on this invoice');
    const c = db.prepare('SELECT name, contact_name, email FROM customers WHERE id = ?').get(inv.customer_id);
    if (!c.email) throw new HttpError(400, 'This customer has no email address');
    const url = payLink(db, inv.id);
    const s = getSettings(db);
    queue(() => sendEmail(db, { to: c.email, related: { type: 'invoice', id: inv.id }, subject: `Invoice #${inv.number} from ${s.company_name} — $${inv.balance.toFixed(2)} due`,
      text: `Hi ${c.contact_name || c.name},

Invoice #${inv.number} for $${inv.balance.toFixed(2)} is due ${inv.due_date || 'now'}.

Pay securely online by card or bank transfer:
${url}

Thank you,
${s.company_name}` }));
    if (inv.status === 'draft') db.prepare("UPDATE invoices SET status = 'sent' WHERE id = ?").run(inv.id);
    audit(db, user, 'email pay link', 'invoices', inv.id);
    return { ok: true, url };
  });
  r('POST', '/api/invoices/:id/charge', BILLING, async ({ db, params, body, user }) => {
    const r2 = await chargeSaved(db, Number(params.id), user, { pmId: body.pm_id });
    audit(db, user, 'charge saved payment method', 'invoices', Number(params.id), r2.status);
    return r2;
  });
  r('GET', '/api/customers/:id/payment-methods', BILLING, ({ db, params }) => listMethods(db, Number(params.id)));
  r('POST', '/api/customers/:id/payment-methods/link', BILLING, async ({ db, params, body, user }) => {
    const { url } = await checkoutForSetup(db, Number(params.id), { returnUrl: `${appUrl(db)}/portal#/payment-methods` });
    if (body.email) {
      const c = db.prepare('SELECT name, contact_name, email FROM customers WHERE id = ?').get(Number(params.id));
      if (!c.email) throw new HttpError(400, 'This customer has no email address');
      const s = getSettings(db);
      queue(() => sendEmail(db, { to: c.email, related: { type: 'customer', id: Number(params.id) }, subject: `${s.company_name}: add or update your payment method`,
        text: `Hi ${c.contact_name || c.name},

Use this secure link to add or update the card or bank account we use for your account (link works for 24 hours):

${url}

Thank you,
${s.company_name}` }));
    }
    audit(db, user, 'payment method link', 'customers', Number(params.id));
    return { url };
  });
  r('DELETE', '/api/customers/:id/payment-methods/:pm', BILLING, ({ db, params }) => removeMethod(db, Number(params.id), params.pm));
  r('POST', '/api/customers/:id/payment-methods/:pm/default', BILLING, ({ db, params }) => setDefaultMethod(db, Number(params.id), params.pm));

  // Public "Pay now" link from emails: sends the customer to Stripe's secure page.
  r('GET', '/api/public/pay/:token', null, async ({ db, params, res }) => {
    const inv = /^[A-Za-z0-9_-]{20,64}$/.test(params.token) && db.prepare('SELECT id, status FROM invoices WHERE pay_token = ?').get(params.token);
    const page = (title, msg) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font-family:system-ui;max-width:480px;margin:60px auto;padding:0 16px;color:#0f172a"><h2>${title}</h2><p>${msg}</p></body>`); };
    if (!inv) return page('Link not valid', 'This payment link is not valid. Please contact us.');
    try {
      const { url } = await checkoutForInvoice(db, inv.id, { returnUrl: `${appUrl(db)}/api/public/pay/${params.token}/done` });
      res.writeHead(303, { Location: url }); res.end();
    } catch (e) { page('Nothing to pay', e.message); }
    return undefined;
  });
  r('GET', '/api/public/pay/:token/done', null, ({ query, res }) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Thank you</title><body style="font-family:system-ui;max-width:480px;margin:60px auto;padding:0 16px;color:#0f172a"><h2>${query.paid ? 'Thank you! Your payment was received.' : 'Payment not completed'}</h2><p>${query.paid ? 'A receipt will be emailed to you. Bank payments can take a few days to clear.' : 'You can use the link in your email to try again.'}</p></body>`);
    return undefined;
  });

  // Stripe → us. Authenticity is checked with the webhook signing secret.
  r('POST', '/api/stripe/webhook', null, async ({ db, req }) => handleWebhook(db, req.rawBody || '', req.headers['stripe-signature']));

  // ------------------------------------------------------------ proposals & agreements
  r('POST', '/api/proposals/:id/send', G.sales, ({ db, params, body, user }) =>
    sendForSignature(db, params.id, user, { email: body.email !== false, sms: !!body.sms, message: String(body.message || '').slice(0, 2000) }));

  r('POST', '/api/proposals/:id/duplicate', G.sales, ({ db, params, user }) => duplicate(db, params.id, user));

  r('GET', '/api/proposals/:id/document', G.salesOrBilling, ({ db, params }) => {
    const p = db.prepare('SELECT * FROM proposals WHERE id = ?').get(Number(params.id));
    if (!p) throw new HttpError(404, 'Not found');
    return { ...publicView(db, p), link: p.public_token ? signingUrl(db, p.public_token) : null };
  });

  r('GET', '/api/proposals/:id/signature', G.salesOrBilling, ({ db, params, res }) => {
    const p = db.prepare('SELECT signature_key FROM proposals WHERE id = ?').get(Number(params.id));
    if (!p?.signature_key) throw new HttpError(404, 'Not signed');
    sendImage(res, 'signatures', p.signature_key);
    return undefined;
  });

  // Public signing page (no login: the long random link is the key).
  r('GET', '/api/public/proposals/:token', null, ({ db, params }) => {
    const p = byToken(db, params.token);
    markViewed(db, p);
    return publicView(db, db.prepare('SELECT * FROM proposals WHERE id = ?').get(p.id));
  });
  r('POST', '/api/public/proposals/:token/sign', null, ({ db, params, body, ip, req }) => {
    sign(db, params.token, body, { ip, agent: req.headers['user-agent'] });
    return publicView(db, byToken(db, params.token));
  });
  r('POST', '/api/public/proposals/:token/decline', null, ({ db, params, body }) => decline(db, params.token, body.reason));
  r('GET', '/api/public/proposals/:token/signature', null, ({ db, params, res }) => {
    const p = byToken(db, params.token);
    if (p.status !== 'signed' || !p.signature_key) throw new HttpError(404, 'Not signed');
    sendImage(res, 'signatures', p.signature_key, { cache: 'private, max-age=3600' });
    return undefined;
  });

  // ------------------------------------------------------------ job photos & sign-off
  const callFor = (db, id, user) => {
    const call = db.prepare('SELECT * FROM service_calls WHERE id = ?').get(Number(id));
    if (!call) throw new HttpError(404, 'Service call not found');
    assertCustomerVisible(db, user, call.customer_id);
    return call;
  };

  r('GET', '/api/service_calls/:id/photos', ALL, ({ db, params, user }) => callFor(db, params.id, user) &&
    db.prepare('SELECT id, kind, caption, user_name, show_customer, created_at FROM job_photos WHERE service_call_id = ? ORDER BY id').all(Number(params.id)));

  r('POST', '/api/service_calls/:id/photos', ALL, ({ db, params, body, user }) => {
    const call = callFor(db, params.id, user);
    const kind = ['before', 'after', 'other'].includes(body.kind) ? body.kind : 'other';
    const img = decodeImage(body.data, { maxBytes: 8 * 1024 * 1024 });
    const key = saveImage('photos', img);
    const info = db.prepare('INSERT INTO job_photos (service_call_id, kind, file_key, caption, user_id, user_name) VALUES (?,?,?,?,?,?)')
      .run(call.id, kind, key, String(body.caption || '').slice(0, 300) || null, user.id, user.name);
    audit(db, user, 'add photo', 'service_calls', call.id, kind);
    return { id: Number(info.lastInsertRowid) };
  });

  r('GET', '/api/photos/:id', ALL, ({ db, params, res, user }) => {
    const p = db.prepare('SELECT file_key, service_call_id FROM job_photos WHERE id = ?').get(Number(params.id));
    if (!p) throw new HttpError(404, 'Not found');
    callCustomerCheck(db, user, p.service_call_id);
    sendImage(res, 'photos', p.file_key);
    return undefined;
  });

  r('PUT', '/api/photos/:id', ALL, ({ db, params, body, user }) => {
    const p = db.prepare('SELECT * FROM job_photos WHERE id = ?').get(Number(params.id));
    if (!p) throw new HttpError(404, 'Not found');
    callCustomerCheck(db, user, p.service_call_id);
    if (p.user_id !== user.id && !MANAGE.includes(user.role)) throw new HttpError(403, 'Only the person who took it or an admin can change this photo');
    db.prepare('UPDATE job_photos SET caption = ?, kind = ?, show_customer = ? WHERE id = ?').run(
      body.caption === undefined ? p.caption : String(body.caption).slice(0, 300),
      ['before', 'after', 'other'].includes(body.kind) ? body.kind : p.kind,
      body.show_customer === undefined ? p.show_customer : (body.show_customer ? 1 : 0), p.id);
    return { ok: true };
  });

  r('DELETE', '/api/photos/:id', ALL, ({ db, params, user }) => {
    const p = db.prepare('SELECT * FROM job_photos WHERE id = ?').get(Number(params.id));
    if (!p) throw new HttpError(404, 'Not found');
    callCustomerCheck(db, user, p.service_call_id);
    if (p.user_id !== user.id && !MANAGE.includes(user.role)) throw new HttpError(403, 'Only the person who took it or an admin can delete this photo');
    db.prepare('DELETE FROM job_photos WHERE id = ?').run(p.id);
    removeImage('photos', p.file_key);
    audit(db, user, 'delete photo', 'service_calls', p.service_call_id);
    return { ok: true };
  });

  // Customer signs on the technician's phone/tablet when the job is done.
  r('POST', '/api/service_calls/:id/signature', ALL, ({ db, params, body, user, ip }) => {
    const call = callFor(db, params.id, user);
    const name = String(body.name || '').trim();
    if (name.length < 2) throw new HttpError(400, "Enter the signer's name");
    const img = decodeImage(body.image, { maxBytes: 1024 * 1024, allowed: ['image/png'] });
    const key = saveImage('signatures', img);
    removeImage('signatures', call.signature_key);
    db.prepare("UPDATE service_calls SET signed_by = ?, signed_at = ?, signature_key = ?, updated_at = datetime('now','localtime') WHERE id = ?")
      .run(name.slice(0, 120), nowLocal(), key, call.id);
    audit(db, user, 'customer signature', 'service_calls', call.id, `${name} from ${ip}`);
    return get(db, 'service_calls', call.id);
  });

  r('GET', '/api/service_calls/:id/signature', G.all, ({ db, params, res, user }) => {
    callCustomerCheck(db, user, params.id);
    const call = db.prepare('SELECT signature_key FROM service_calls WHERE id = ?').get(Number(params.id));
    if (!call?.signature_key) throw new HttpError(404, 'Not signed');
    sendImage(res, 'signatures', call.signature_key, { cache: 'private, no-cache' });
    return undefined;
  });

  // ------------------------------------------------------------ notifications
  r('POST', '/api/service_calls/:id/on-my-way', ALL, ({ db, params, body, user }) => {
    const call = get(db, 'service_calls', params.id, user);
    if (user.role === 'technician' && user.technician_id && call.technician_id && call.technician_id !== user.technician_id) throw new HttpError(403, 'This job is assigned to someone else');
    const eta = Number(body.eta_minutes) > 0 ? Math.round(Number(body.eta_minutes)) : null;
    const updated = update(db, 'service_calls', call.id, { status: 'en route' }, user);
    if (getSettings(db).notify_on_way === '1') queue(() => notifyOnMyWay(db, updated, { etaMinutes: eta }));
    audit(db, user, 'on my way', 'service_calls', call.id, eta ? `ETA ${eta} min` : null);
    return updated;
  });

  r('POST', '/api/service_calls/:id/resend-confirmation', G.staff, ({ db, params, user }) => {
    const call = get(db, 'service_calls', params.id);
    if (!call.scheduled_start) throw new HttpError(400, 'Schedule the job first');
    queue(() => notifyScheduled(db, call, { force: true }));
    audit(db, user, 'resend confirmation', 'service_calls', call.id);
    return { ok: true };
  });

  r('GET', '/api/notifications', ALL, ({ db, query, user }) => {
    if (query.related_type && query.related_id) {
      if (techCustomerIds(db, user)) {
        if (query.related_type !== 'service_call') throw new HttpError(403, 'Not allowed');
        callCustomerCheck(db, user, query.related_id);
      }
      return db.prepare('SELECT * FROM notifications WHERE related_type = ? AND related_id = ? ORDER BY id DESC LIMIT 100').all(query.related_type, Number(query.related_id));
    }
    if (!MANAGE.includes(user.role)) throw new HttpError(403, 'Not allowed');
    return db.prepare('SELECT * FROM notifications ORDER BY id DESC LIMIT 300').all();
  });

  r('POST', '/api/notifications/test', MANAGE, async ({ db, body }) => {
    const company = getSettings(db).company_name;
    const ok = body.channel === 'sms'
      ? await sendSms(db, { to: body.to, body: `${company}: test text from SecureOps. It works!` })
      : await sendEmail(db, { to: body.to, subject: 'SecureOps test email', text: `This is a test email from ${company}. Email is working.` });
    const last = db.prepare('SELECT status, error FROM notifications ORDER BY id DESC LIMIT 1').get();
    if (ok !== true) throw new HttpError(400, last?.error || 'Not sent');
    return { ok: true };
  });

  // ------------------------------------------------------------ calendars
  // Subscription feeds for Outlook / Google / Apple calendars. The secret key in the
  // file name is the only credential (calendar apps can't log in).
  r('GET', '/api/cal/:file', null, ({ db, params, res, req }) => {
    const m = String(params.file).match(/^(central|tech)-([A-Za-z0-9_-]{16,64})\.ics$/);
    if (!m) throw new HttpError(404, 'Not found');
    const s = getSettings(db);
    let tech = null;
    if (m[1] === 'central') {
      if (!s.calendar_token || m[2] !== s.calendar_token) throw new HttpError(404, 'Not found');
    } else {
      tech = db.prepare('SELECT id, name FROM technicians WHERE calendar_token = ?').get(m[2]);
      if (!tech) throw new HttpError(404, 'Not found');
    }
    const from = addDays(todayLocal(), -60), to = addDays(todayLocal(), 365);
    const calls = list(db, 'service_calls', { from, to, scheduled_start__null: '0', ...(tech ? { technician_id: tech.id } : {}), limit: 5000 }, null)
      .filter(c => c.scheduled_start && c.status !== 'cancelled');
    const ics = buildCalendar(calls.map(c => callToEvent(c, { tz: s.timezone, baseUrl: baseUrl(db, req), withTech: !tech })),
      { name: tech ? `${s.company_name} — ${tech.name}` : `${s.company_name} — all technicians` });
    res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-cache', 'Content-Disposition': `inline; filename="${m[1]}.ics"` });
    res.end(ics);
    return undefined;
  });

  r('GET', '/api/calendar/feeds', ALL, ({ db, user, req }) => {
    const base = baseUrl(db, req);
    const s = getSettings(db);
    const techs = db.prepare('SELECT id, name, color, calendar_token FROM technicians WHERE active = 1 ORDER BY name').all()
      .filter(t => MANAGE.includes(user.role) || t.id === user.technician_id);
    return {
      timezone: s.timezone,
      central: MANAGE.includes(user.role) ? `${base}/api/cal/central-${s.calendar_token}.ics` : null,
      technicians: techs.map(t => ({ id: t.id, name: t.name, color: t.color, url: `${base}/api/cal/tech-${t.calendar_token}.ics` })),
    };
  });

  r('POST', '/api/calendar/reset/:which', MANAGE, ({ db, params, user }) => {
    const tok = crypto.randomBytes(18).toString('base64url');
    if (params.which === 'central') db.prepare("UPDATE settings SET value = ? WHERE key = 'calendar_token'").run(tok);
    else db.prepare('UPDATE technicians SET calendar_token = ? WHERE id = ?').run(tok, Number(params.which));
    audit(db, user, 'reset calendar link', 'calendar', null, params.which);
    return { ok: true };
  });

  r('GET', '/api/customers/:id/access', MANAGE, ({ db, params }) => db.prepare(`SELECT g.*, u.name AS user_name FROM tech_access_grants g JOIN users u ON u.id = g.user_id
    WHERE g.customer_id = ? AND g.expires_at > ? ORDER BY g.expires_at DESC`).all(Number(params.id), nowLocal()));
  r('POST', '/api/customers/:id/access', MANAGE, ({ db, params, body, user }) => {
    const tech = db.prepare("SELECT id, name FROM users WHERE id = ? AND role = 'technician' AND active = 1").get(Number(body.user_id));
    if (!tech) throw new HttpError(400, 'Choose a technician');
    const until = grantAccess(db, { userId: tech.id, customerId: Number(params.id), hours: body.hours, reason: String(body.reason || '').slice(0, 200) || 'Granted by office', by: user.name });
    audit(db, user, 'grant customer access', 'customers', Number(params.id), `${tech.name} until ${until}`);
    return { ok: true, until };
  });
  r('DELETE', '/api/customers/:id/access/:grant', MANAGE, ({ db, params, user }) => {
    db.prepare('DELETE FROM tech_access_grants WHERE id = ? AND customer_id = ?').run(Number(params.grant), Number(params.id));
    audit(db, user, 'revoke customer access', 'customers', Number(params.id));
    return { ok: true };
  });

  r('GET', '/api/customers/:id/stage-log', ALL, ({ db, params, user }) => assertCustomerVisible(db, user, params.id) ||
    db.prepare('SELECT * FROM customer_stage_log WHERE customer_id = ? ORDER BY id DESC LIMIT 100').all(Number(params.id)));

  // Pipeline board: open opportunities plus recently won customers.
  r('GET', '/api/pipeline', G.staff, ({ db, query }) => {
    const params = [];
    let where = "(c.stage <> 'active' OR c.updated_at >= date('now','-30 days'))";
    if (query.type) { where += ' AND c.type = ?'; params.push(query.type); }
    return db.prepare(`SELECT c.id, c.name, c.type, c.stage, c.phone, c.city, c.lead_source, c.updated_at,
        (SELECT created_at FROM customer_stage_log g WHERE g.customer_id = c.id ORDER BY g.id DESC LIMIT 1) AS stage_since
      FROM customers c WHERE ${where} ORDER BY c.updated_at DESC LIMIT 1000`).all(...params);
  });

  // ------------------------------------------------------------ maintenance
  r('GET', '/api/maintenance', ALL, ({ db, query, user }) => {
    if (query.customer_id) assertCustomerVisible(db, user, query.customer_id);
    return scoped(db, user, maintenanceDue(db, Number(query.days) || 60, query.customer_id));
  });

  r('POST', '/api/maintenance/complete', ALL, ({ db, body, user }) => {
    const m = MAINTENANCE[body.key];
    if (!m) throw new HttpError(400, 'Unknown maintenance type');
    const ids = (Array.isArray(body.ids) ? body.ids : [body.id]).map(Number).filter(Boolean);
    const date = body.date || todayLocal();
    tx(db, () => {
      for (const id of ids) {
        const row = db.prepare(`SELECT * FROM "${m.table}" WHERE id = ?`).get(id);
        if (!row) continue;
        if (row.customer_id) assertCustomerVisible(db, user, row.customer_id);
        let next = body.next_date;
        if (!next) {
          if (m.intervalYearsField) next = addMonths(date, (Number(row[m.intervalYearsField]) || 12) * 12);
          else if (m.intervalMonths) next = addMonths(date, m.intervalMonths);
          else if (m.intervalField) next = addMonths(date, Number(row[m.intervalField]) || 12);
          else next = addMonths(date, body.key === 'vehicle_service' ? 3 : 12);
        }
        const sets = [`"${m.due}" = ?`];
        const vals = [next];
        if (m.last) { sets.push(`"${m.last}" = ?`); vals.push(date); }
        if (m.table === 'extinguishers' && body.key === 'ext_annual') sets.push(`status = CASE WHEN status = 'needs service' THEN status ELSE 'in service' END`);
        db.prepare(`UPDATE "${m.table}" SET ${sets.join(', ')}, updated_at = datetime('now','localtime') WHERE id = ?`).run(...vals, id);
        audit(db, user, 'maintenance complete', m.table, id, body.key);
      }
    });
    return { ok: true, count: ids.length };
  });

  // ------------------------------------------------------------ billing
  r('POST', '/api/invoices/generate-monthly', BILLING, ({ db, body, user }) => {
    const period = /^\d{4}-\d{2}$/.test(body.period || '') ? body.period : todayLocal().slice(0, 7);
    const issue = todayLocal().slice(0, 7) === period ? todayLocal() : `${period}-01`;
    const customers = db.prepare(`SELECT c.id, c.name, c.type FROM customers c WHERE c.status = 'active'
      AND EXISTS (SELECT 1 FROM recurring_charges rc WHERE rc.customer_id = c.id AND rc.active = 1)
      AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.customer_id = c.id AND i.kind = 'monthly' AND i.period = ? AND i.status <> 'void')
      ORDER BY c.name`).all(period);
    const charges = db.prepare('SELECT * FROM recurring_charges WHERE customer_id = ? AND active = 1 ORDER BY id');
    const preview = customers.map(c => {
      const ch = charges.all(c.id);
      return { customer_id: c.id, name: c.name, type: c.type, amount: round2(ch.reduce((s, x) => s + x.amount, 0)), lines: ch.length };
    });
    if (body.dry_run) return { period, label: monthLabel(period), customers: preview, total: round2(preview.reduce((s, p) => s + p.amount, 0)) };
    const created = tx(db, () => customers.map(c => {
      const inv = create(db, 'invoices', { customer_id: c.id, kind: 'monthly', period, issue_date: issue, status: body.as_draft ? 'draft' : 'sent' }, user);
      for (const ch of charges.all(c.id)) {
        create(db, 'invoice_items', { invoice_id: inv.id, description: `${ch.description} — ${monthLabel(period)}`, qty: 1, unit_price: ch.amount, taxable: ch.taxable }, user);
      }
      return inv.id;
    }));
    audit(db, user, 'monthly billing run', 'invoices', null, `${period}: ${created.length} invoices`);
    return { period, created: created.length };
  });

  r('POST', '/api/service_calls/:id/invoice', BILLING, ({ db, params, user }) => {
    const call = get(db, 'service_calls', params.id);
    if (call.invoice_id) return { id: call.invoice_id, existing: true };
    return tx(db, () => {
      const inv = create(db, 'invoices', { customer_id: call.customer_id, kind: call.call_type === 'installation' ? 'installation' : 'service', status: 'draft', notes: `Service call SC-${call.number}: ${call.title}` }, user);
      db.prepare('UPDATE invoices SET service_call_id = ? WHERE id = ?').run(call.id, inv.id);
      if (call.labor_hours > 0) {
        create(db, 'invoice_items', { invoice_id: inv.id, description: `Labor — ${call.title}${call.technician_id_label ? ` (${call.technician_id_label})` : ''}`, qty: call.labor_hours, unit_price: call.labor_rate || 0, taxable: 0 }, user);
      }
      const parts = db.prepare(`SELECT p.*, i.name, i.sku FROM service_call_parts p JOIN inventory_items i ON i.id = p.item_id WHERE p.service_call_id = ?`).all(call.id);
      for (const p of parts) {
        create(db, 'invoice_items', { invoice_id: inv.id, description: p.sku ? `${p.name} (${p.sku})` : p.name, qty: p.qty, unit_price: p.unit_price || 0, taxable: 1 }, user);
      }
      db.prepare('UPDATE service_calls SET invoice_id = ? WHERE id = ?').run(inv.id, call.id);
      return { id: inv.id };
    });
  });

  r('POST', '/api/invoices/:id/status', BILLING, ({ db, params, body, user }) => {
    if (!['draft', 'sent', 'void'].includes(body.status)) throw new HttpError(400, 'Invalid status');
    db.prepare("UPDATE invoices SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(body.status, Number(params.id));
    recalcInvoice(db, Number(params.id));
    markInvoiceDirty(db, Number(params.id));
    audit(db, user, `invoice ${body.status}`, 'invoices', Number(params.id));
    return get(db, 'invoices', params.id);
  });

  r('POST', '/api/invoices/send-drafts', BILLING, ({ db, user }) => {
    const n = db.prepare("UPDATE invoices SET status = 'sent' WHERE status = 'draft'").run().changes;
    audit(db, user, 'mark drafts sent', 'invoices', null, String(n));
    return { count: n };
  });

  // ------------------------------------------------------------ inventory
  r('GET', '/api/stock', ALL, ({ db, query }) => {
    const where = query.location_id !== undefined && query.location_id !== '' ? 'WHERE s.location_id = ?' : '';
    const params = where ? [Number(query.location_id)] : [];
    return db.prepare(`SELECT s.item_id, s.location_id, s.qty, i.name, i.sku, i.category, i.unit_cost, i.unit_price,
        CASE WHEN s.location_id = 0 THEN 'Warehouse' ELSE v.unit_name END AS location_name
      FROM stock s JOIN inventory_items i ON i.id = s.item_id LEFT JOIN vehicles v ON v.id = s.location_id
      ${where} ORDER BY i.category, i.name`).all(...params);
  });

  r('GET', '/api/stock/movements', ALL, ({ db, query }) => {
    const where = [];
    const params = [];
    if (query.item_id) { where.push('m.item_id = ?'); params.push(Number(query.item_id)); }
    if (query.location_id !== undefined && query.location_id !== '') {
      where.push('(m.from_location = ? OR m.to_location = ?)'); params.push(Number(query.location_id), Number(query.location_id));
    }
    return db.prepare(`SELECT m.*, i.name AS item_name, u.name AS user_name,
        CASE WHEN m.from_location = 0 THEN 'Warehouse' ELSE fv.unit_name END AS from_name,
        CASE WHEN m.to_location = 0 THEN 'Warehouse' ELSE tv.unit_name END AS to_name,
        sc.number AS call_number
      FROM stock_movements m JOIN inventory_items i ON i.id = m.item_id
      LEFT JOIN users u ON u.id = m.user_id
      LEFT JOIN vehicles fv ON fv.id = m.from_location LEFT JOIN vehicles tv ON tv.id = m.to_location
      LEFT JOIN service_calls sc ON sc.id = m.service_call_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY m.id DESC LIMIT 300`).all(...params);
  });

  const locId = v => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) throw new HttpError(400, 'Invalid location');
    return n;
  };
  const checkItem = (db, id) => {
    const item = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(Number(id));
    if (!item) throw new HttpError(400, 'Item not found');
    return item;
  };
  const checkLocation = (db, id) => {
    if (id !== 0 && !db.prepare('SELECT 1 FROM vehicles WHERE id = ?').get(id)) throw new HttpError(400, 'Vehicle not found');
  };

  r('POST', '/api/stock/receive', BILLING, ({ db, body, user }) => {
    const item = checkItem(db, body.item_id);
    const qty = Number(body.qty);
    if (!(qty > 0)) throw new HttpError(400, 'Quantity must be greater than zero');
    const loc = locId(body.location_id ?? 0);
    checkLocation(db, loc);
    return tx(db, () => {
      const cost = body.unit_cost === '' || body.unit_cost == null ? item.unit_cost : round2(body.unit_cost);
      adjustStock(db, { itemId: item.id, locationId: loc, delta: qty, kind: 'received', note: body.vendor ? `from ${body.vendor}` : body.note, userId: user.id });
      if (cost != null && cost !== item.unit_cost && body.update_cost) {
        db.prepare('UPDATE inventory_items SET unit_cost = ? WHERE id = ?').run(cost, item.id);
      }
      if (body.record_expense && cost) {
        create(db, 'expenses', { date: todayLocal(), category: 'Parts & equipment', vendor: body.vendor || '', description: `${qty} × ${item.name}`, amount: round2(qty * cost), payment_method: 'card' }, user);
      }
      return { ok: true };
    });
  });

  r('POST', '/api/stock/transfer', ALL, ({ db, body, user }) => {
    const item = checkItem(db, body.item_id);
    const qty = Number(body.qty);
    if (!(qty > 0)) throw new HttpError(400, 'Quantity must be greater than zero');
    const from = locId(body.from), to = locId(body.to);
    if (from === to) throw new HttpError(400, 'Choose two different locations');
    checkLocation(db, from); checkLocation(db, to);
    return tx(db, () => {
      adjustStock(db, { itemId: item.id, locationId: from, delta: -qty, kind: 'transfer out', note: body.note, userId: user.id });
      adjustStock(db, { itemId: item.id, locationId: to, delta: qty, kind: 'transfer in', note: body.note, userId: user.id });
      return { ok: true };
    });
  });

  r('POST', '/api/stock/count', BILLING, ({ db, body, user }) => {
    const item = checkItem(db, body.item_id);
    const loc = locId(body.location_id ?? 0);
    checkLocation(db, loc);
    const counted = Number(body.qty);
    if (!Number.isFinite(counted) || counted < 0) throw new HttpError(400, 'Enter the counted quantity');
    return tx(db, () => {
      const cur = db.prepare('SELECT qty FROM stock WHERE item_id = ? AND location_id = ?').get(item.id, loc)?.qty || 0;
      if (counted !== cur) adjustStock(db, { itemId: item.id, locationId: loc, delta: counted - cur, kind: 'count adjustment', note: body.note || `counted ${counted} (was ${cur})`, userId: user.id, allowNegative: true });
      return { ok: true, delta: counted - cur };
    });
  });

  // ------------------------------------------------------------ supplier invoices (receiving)
  r('GET', '/api/receiving/info', BILLING, ({ db, user }) => {
    const s = getSettings(db);
    return {
      ai: aiConfigured(), auto_receive: s.auto_receive === '1', update_costs: s.receiving_update_costs === '1',
      trusted_vendor_domains: s.trusted_vendor_domains,
      inbound_path: MANAGE.includes(user.role) ? `/api/inbound/email/${s.inbound_token}` : null,
      counts: Object.fromEntries(db.prepare('SELECT status, COUNT(*) AS n FROM purchase_invoices GROUP BY status').all().map(r => [r.status, r.n])),
    };
  });

  r('POST', '/api/receiving/token', MANAGE, ({ db, user }) => {
    db.prepare("UPDATE settings SET value = ? WHERE key = 'inbound_token'").run(crypto.randomBytes(24).toString('base64url'));
    audit(db, user, 'regenerate inbound email address', 'settings', null);
    return { ok: true };
  });

  r('POST', '/api/receiving/upload', BILLING, ({ db, body, user }) => {
    if (!Array.isArray(body.files) || !body.files.length) throw new HttpError(400, 'Choose a file to upload');
    const ids = ingest(db, { source: 'upload', files: body.files, user });
    if (!ids.length) throw new HttpError(400, 'Upload a PDF, photo (JPG/PNG), or CSV file');
    queueProcessing(db, ids);
    return { ids };
  });

  r('GET', '/api/receiving/:id/file', BILLING, ({ db, params, res }) => {
    const row = db.prepare('SELECT file_key, file_type, file_name FROM purchase_invoices WHERE id = ?').get(Number(params.id));
    if (!row) throw new HttpError(404, 'Not found');
    const p = filePath(row);
    res.writeHead(200, {
      'Content-Type': row.file_type === 'text/csv' || row.file_type === 'text/plain' ? 'text/plain; charset=utf-8' : row.file_type,
      'Content-Disposition': `inline; filename="${String(row.file_name).replace(/[^\w. -]/g, '_')}"`,
      'Cache-Control': 'private, no-store',
      // Allow our own page to show it in a frame; nothing else.
      'X-Frame-Options': 'SAMEORIGIN',
      'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; frame-ancestors 'self'",
    });
    fs.createReadStream(p).pipe(res);
    return undefined;
  });

  r('PUT', '/api/receiving/:id', BILLING, ({ db, params, body, user }) => saveReview(db, Number(params.id), body, user));

  r('POST', '/api/receiving/:id/receive', BILLING, ({ db, params, body, user }) =>
    receive(db, Number(params.id), user, { record_expense: body.record_expense !== false, allowDuplicate: !!body.allow_duplicate }));

  r('POST', '/api/receiving/:id/reread', BILLING, ({ db, params, user }) => {
    const row = db.prepare('SELECT status FROM purchase_invoices WHERE id = ?').get(Number(params.id));
    if (!row) throw new HttpError(404, 'Not found');
    if (row.status === 'received') throw new HttpError(409, 'Already received');
    db.prepare("UPDATE purchase_invoices SET status = 'processing', review_note = NULL WHERE id = ?").run(Number(params.id));
    audit(db, user, 're-read', 'purchase_invoices', Number(params.id));
    queueProcessing(db, [Number(params.id)]);
    return { ok: true };
  });

  r('POST', '/api/receiving/:id/reject', BILLING, ({ db, params, user }) => {
    const n = db.prepare("UPDATE purchase_invoices SET status = 'rejected' WHERE id = ? AND status <> 'received'").run(Number(params.id)).changes;
    if (!n) throw new HttpError(409, 'Received invoices cannot be rejected');
    audit(db, user, 'reject', 'purchase_invoices', Number(params.id));
    return { ok: true };
  });

  // Inbound email webhook (Postmark inbound, or any service / Zapier / Power Automate posting JSON).
  // Authenticated by the secret token in the URL instead of a login.
  r('POST', '/api/inbound/email/:token', null, ({ db, params, body }) => {
    const expected = Buffer.from(getSettings(db).inbound_token || '');
    const given = Buffer.from(String(params.token || ''));
    if (!expected.length || expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) throw new HttpError(404, 'Not found');
    const email = parseInboundEmail(body || {});
    const ids = ingest(db, { source: 'email', ...email });
    queueProcessing(db, ids);
    return { ok: true, received: ids.length };
  });

  // ------------------------------------------------------------ reports
  r('GET', '/api/reports/pnl', BILLING, ({ db, query }) => {
    const to = /^\d{4}-\d{2}$/.test(query.to || '') ? query.to : todayLocal().slice(0, 7);
    const from = /^\d{4}-\d{2}$/.test(query.from || '') ? query.from : addMonths(to + '-01', -5).slice(0, 7);
    const months = monthsBetween(from, to);
    const byMonth = (sql, ...p) => Object.fromEntries(db.prepare(sql).all(...p).map(r => [r.m, r]));
    const rev = byMonth(`SELECT substr(i.issue_date,1,7) AS m, SUM(i.total) AS total,
        SUM(CASE WHEN c.type = 'commercial' THEN i.total ELSE 0 END) AS commercial,
        SUM(CASE WHEN c.type = 'residential' THEN i.total ELSE 0 END) AS residential,
        SUM(CASE WHEN i.kind = 'monthly' THEN i.total ELSE 0 END) AS recurring
      FROM invoices i JOIN customers c ON c.id = i.customer_id
      WHERE i.status NOT IN ('void','draft') AND substr(i.issue_date,1,7) BETWEEN ? AND ? GROUP BY m`, from, to);
    const col = byMonth(`SELECT substr(date,1,7) AS m, SUM(amount) AS total FROM payments WHERE substr(date,1,7) BETWEEN ? AND ? GROUP BY m`, from, to);
    const exp = byMonth(`SELECT substr(date,1,7) AS m, SUM(amount) AS total FROM expenses WHERE substr(date,1,7) BETWEEN ? AND ? GROUP BY m`, from, to);
    const labor = byMonth(`SELECT substr(sc.completed_at,1,7) AS m, SUM(COALESCE(sc.labor_hours,0) * COALESCE(t.hourly_cost,0)) AS total
      FROM service_calls sc LEFT JOIN technicians t ON t.id = sc.technician_id
      WHERE sc.status = 'completed' AND substr(sc.completed_at,1,7) BETWEEN ? AND ? GROUP BY m`, from, to);
    const parts = byMonth(`SELECT substr(sc.completed_at,1,7) AS m, SUM(p.qty * COALESCE(p.unit_cost,0)) AS total
      FROM service_call_parts p JOIN service_calls sc ON sc.id = p.service_call_id
      WHERE sc.status = 'completed' AND substr(sc.completed_at,1,7) BETWEEN ? AND ? GROUP BY m`, from, to);
    const categories = db.prepare(`SELECT category, SUM(amount) AS total FROM expenses WHERE substr(date,1,7) BETWEEN ? AND ? GROUP BY category ORDER BY total DESC`).all(from, to);
    const catByMonth = db.prepare(`SELECT substr(date,1,7) AS m, category, SUM(amount) AS total FROM expenses WHERE substr(date,1,7) BETWEEN ? AND ? GROUP BY m, category`).all(from, to);
    const rows = months.map(m => {
      const revenue = round2(rev[m]?.total || 0);
      const expenses = round2(exp[m]?.total || 0);
      const laborEst = round2(labor[m]?.total || 0);
      return {
        month: m, label: monthLabel(m), revenue,
        commercial: round2(rev[m]?.commercial || 0), residential: round2(rev[m]?.residential || 0), recurring: round2(rev[m]?.recurring || 0),
        collected: round2(col[m]?.total || 0), expenses, laborEst, partsUsedCost: round2(parts[m]?.total || 0),
        net: round2(revenue - expenses), netWithLabor: round2(revenue - expenses - laborEst),
        categories: Object.fromEntries(catByMonth.filter(c => c.m === m).map(c => [c.category, round2(c.total)])),
      };
    });
    const sum = k => round2(rows.reduce((s, r) => s + r[k], 0));
    return {
      from, to, months: rows, categories: categories.map(c => ({ ...c, total: round2(c.total) })),
      totals: Object.fromEntries(['revenue', 'commercial', 'residential', 'recurring', 'collected', 'expenses', 'laborEst', 'partsUsedCost', 'net', 'netWithLabor'].map(k => [k, sum(k)])),
    };
  });

  r('GET', '/api/reports/technicians', BILLING, ({ db, query }) => {
    const from = query.from || monthStart();
    const to = query.to || monthEnd(todayLocal());
    let workdays = 0;
    for (let d = from; d <= to; d = addDays(d, 1)) { const wd = new Date(d + 'T12:00:00Z').getUTCDay(); if (wd > 0 && wd < 6) workdays++; if (workdays > 400) break; }
    const rows = db.prepare(`SELECT t.id, t.name, t.color, t.active, t.hourly_cost,
        COUNT(sc.id) AS calls,
        SUM(CASE WHEN sc.status = 'completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN sc.priority = 'emergency' THEN 1 ELSE 0 END) AS emergencies,
        SUM(CASE WHEN sc.call_type = 'installation' THEN 1 ELSE 0 END) AS installs,
        COALESCE(SUM(sc.duration_hours),0) AS scheduled_hours,
        COALESCE(SUM(CASE WHEN sc.status = 'completed' THEN sc.labor_hours END),0) AS labor_hours,
        COALESCE(SUM(CASE WHEN sc.status = 'completed' THEN sc.labor_hours * sc.labor_rate END),0) AS labor_billed,
        COALESCE(SUM(CASE WHEN sc.status = 'completed' THEN sc.labor_hours END),0) * COALESCE(t.hourly_cost,0) AS labor_cost,
        (SELECT COALESCE(SUM(p.qty * p.unit_price),0) FROM service_call_parts p JOIN service_calls s2 ON s2.id = p.service_call_id
          WHERE s2.technician_id = t.id AND s2.status = 'completed' AND substr(COALESCE(s2.scheduled_start, s2.created_at),1,10) BETWEEN ? AND ?) AS parts_billed,
        (SELECT COUNT(*) FROM service_calls s3 WHERE s3.technician_id = t.id AND s3.status NOT IN ('completed','cancelled')) AS open_backlog
      FROM technicians t
      LEFT JOIN service_calls sc ON sc.technician_id = t.id AND sc.status <> 'cancelled'
        AND substr(COALESCE(sc.scheduled_start, sc.created_at),1,10) BETWEEN ? AND ?
      GROUP BY t.id ORDER BY scheduled_hours DESC, calls DESC`).all(from, to, from, to);
    const capacity = workdays * 8;
    return {
      from, to, workdays, capacity,
      technicians: rows.map(t => ({
        ...t, scheduled_hours: round2(t.scheduled_hours), labor_hours: round2(t.labor_hours), labor_billed: round2(t.labor_billed),
        labor_cost: round2(t.labor_cost), parts_billed: round2(t.parts_billed),
        utilization: capacity ? Math.round((t.scheduled_hours / capacity) * 100) : 0,
      })),
      unassigned: db.prepare(`SELECT COUNT(*) AS n FROM service_calls WHERE technician_id IS NULL AND status NOT IN ('completed','cancelled')`).get().n,
    };
  });

  r('GET', '/api/reports/segments', BILLING, ({ db, query }) => {
    const from = query.from || addMonths(monthStart(), -11);
    const to = query.to || todayLocal();
    return ['residential', 'commercial'].map(type => {
      const q = (sql, ...p) => db.prepare(sql).get(type, ...p);
      const active = q(`SELECT COUNT(*) AS n FROM customers WHERE type = ? AND status = 'active'`).n;
      const mrr = round2(q(`SELECT COALESCE(SUM(rc.amount),0) AS s FROM recurring_charges rc JOIN customers c ON c.id = rc.customer_id WHERE c.type = ? AND c.status = 'active' AND rc.active = 1`).s);
      const revenue = round2(q(`SELECT COALESCE(SUM(i.total),0) AS s FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE c.type = ? AND i.status NOT IN ('void','draft') AND i.issue_date BETWEEN ? AND ?`, from, to).s);
      const billed = q(`SELECT COALESCE(SUM(i.total),0) AS s FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE c.type = ? AND i.status IN ('sent','partial')`).s;
      const paid = q(`SELECT COALESCE(SUM(p.amount),0) AS s FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN customers c ON c.id = i.customer_id WHERE c.type = ? AND i.status IN ('sent','partial')`).s;
      const calls = q(`SELECT COUNT(*) AS n FROM service_calls sc JOIN customers c ON c.id = sc.customer_id WHERE c.type = ? AND substr(COALESCE(sc.scheduled_start, sc.created_at),1,10) BETWEEN ? AND ?`, from, to).n;
      return { type, active, mrr, arr: round2(mrr * 12), revenue, openAR: round2(billed - paid), calls, avgMrr: active ? round2(mrr / active) : 0, from, to };
    });
  });

  r('GET', '/api/reports/aging', BILLING, ({ db, user }) => {
    const today = todayLocal();
    const open = list(db, 'invoices', { status__in: 'sent,partial' }, user).filter(i => i.balance > 0);
    const byCust = new Map();
    const totals = { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0, total: 0 };
    for (const i of open) {
      const days = Math.floor((Date.parse(today) - Date.parse(i.due_date || i.issue_date)) / 864e5);
      const bucket = days <= 0 ? 'current' : days <= 30 ? 'd30' : days <= 60 ? 'd60' : days <= 90 ? 'd90' : 'd90plus';
      const c = byCust.get(i.customer_id) || { customer_id: i.customer_id, name: i.customer_id_label, type: i.customer_type, current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0, total: 0, invoices: 0 };
      c[bucket] = round2(c[bucket] + i.balance); c.total = round2(c.total + i.balance); c.invoices++;
      totals[bucket] = round2(totals[bucket] + i.balance); totals.total = round2(totals.total + i.balance);
      byCust.set(i.customer_id, c);
    }
    return { customers: [...byCust.values()].sort((a, b) => b.total - a.total), totals };
  });

  r('GET', '/api/reports/jobs', BILLING, ({ db, query }) => {
    const from = query.from || monthStart();
    const to = query.to || todayLocal();
    return db.prepare(`SELECT sc.id, sc.number, sc.title, sc.call_type, sc.completed_at, c.name AS customer, c.type AS customer_type, t.name AS technician,
        COALESCE(sc.labor_hours,0) AS labor_hours,
        COALESCE(sc.labor_hours,0) * COALESCE(t.hourly_cost,0) AS labor_cost,
        (SELECT COALESCE(SUM(p.qty * p.unit_cost),0) FROM service_call_parts p WHERE p.service_call_id = sc.id) AS parts_cost,
        COALESCE(i.subtotal, COALESCE(sc.labor_hours,0) * COALESCE(sc.labor_rate,0) + (SELECT COALESCE(SUM(p.qty * p.unit_price),0) FROM service_call_parts p WHERE p.service_call_id = sc.id)) AS billed,
        i.number AS invoice_number, sc.billable
      FROM service_calls sc JOIN customers c ON c.id = sc.customer_id LEFT JOIN technicians t ON t.id = sc.technician_id LEFT JOIN invoices i ON i.id = sc.invoice_id AND i.status <> 'void'
      WHERE sc.status = 'completed' AND substr(sc.completed_at,1,10) BETWEEN ? AND ? ORDER BY sc.completed_at DESC LIMIT 500`).all(from, to)
      .map(j => {
        const billed = j.billable ? round2(j.billed) : 0;
        const cost = round2(j.labor_cost + j.parts_cost);
        return { ...j, billed, labor_cost: round2(j.labor_cost), parts_cost: round2(j.parts_cost), cost, profit: round2(billed - cost), margin: billed ? Math.round(((billed - cost) / billed) * 100) : null };
      });
  });

  // ------------------------------------------------------------ export / backup
  r('GET', '/api/export/:resource', G.staff, ({ db, params, res, user }) => {
    const def = RESOURCES[params.resource];
    if (!def) throw new HttpError(404, 'Unknown resource');
    if (!def.read.includes(user.role)) throw new HttpError(403, 'Your role does not have access to this');
    const rows = list(db, params.resource, { limit: 5000 }, user);
    const fields = def.fields.filter(f => f.type !== 'secret');
    const cell = v => {
      const s = v == null ? '' : String(v);
      // Neutralise spreadsheet formula injection and quote.
      const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const header = ['id', ...fields.map(f => f.label)];
    const lines = [header.map(cell).join(',')];
    for (const row of rows) lines.push([row.id, ...fields.map(f => f.type === 'ref' ? row[`${f.name}_label`] : row[f.name])].map(cell).join(','));
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${params.resource}-${todayLocal()}.csv"` });
    res.end('﻿' + lines.join('\r\n'));
    audit(db, user, 'export', params.resource, null, String(rows.length));
    return undefined;
  });

  r('GET', '/api/admin/backup', G.owner, ({ db, res, user }) => {
    const file = path.join(DATA_DIR, `backup-${crypto.randomBytes(6).toString('hex')}.db`);
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    const buf = fs.readFileSync(file);
    fs.unlinkSync(file);
    audit(db, user, 'backup', null, null);
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="secureops-backup-${todayLocal()}.db"` });
    res.end(buf);
    return undefined;
  });

  return routes;
}

// Read supplier invoices one at a time in the background.
let processingChain = Promise.resolve();
export function queueProcessing(db, ids) {
  for (const id of ids) {
    processingChain = processingChain.then(() => processInvoice(db, id)).catch(e => console.error('processInvoice', id, e));
  }
  return processingChain;
}
export const processingIdle = () => processingChain;

export function maintenanceDue(db, days = 60, customerId) {
  const today = todayLocal();
  const horizon = addDays(today, days);
  const out = [];
  for (const [key, m] of Object.entries(MAINTENANCE)) {
    let rows;
    if (m.vehicle) {
      rows = db.prepare(`SELECT id, unit_name AS label, "${m.due}" AS due FROM vehicles WHERE "${m.due}" IS NOT NULL AND "${m.due}" <= ? AND status <> 'sold'`).all(horizon);
      if (customerId) continue;
      rows.forEach(r => out.push({ key, label: m.label, table: m.table, ids: [r.id], count: 1, due: r.due, what: r.label, vehicle_id: r.id }));
      continue;
    }
    const extra = m.table === 'extinguishers' ? `AND x.status NOT IN ('removed','out of service')` : '';
    rows = db.prepare(`SELECT x.id, x."${m.due}" AS due, x.customer_id, c.name AS customer, c.type AS customer_type, c.phone,
        ${RESOURCES[m.table].labelExpr.replace(/\b(location|brand|panel_brand|system_type|ext_type)\b/g, 'x.$1')} AS what
      FROM "${m.table}" x JOIN customers c ON c.id = x.customer_id
      WHERE x."${m.due}" IS NOT NULL AND x."${m.due}" <= ? AND c.status = 'active' ${extra} ${customerId ? 'AND x.customer_id = ?' : ''}
      ORDER BY x."${m.due}"`).all(...[horizon, ...(customerId ? [Number(customerId)] : [])]);
    if (m.table === 'extinguishers') {
      // Group a customer's extinguishers that are due the same month into one line.
      const groups = new Map();
      for (const r of rows) {
        const g = `${r.customer_id}|${r.due.slice(0, 7)}`;
        const cur = groups.get(g) || { key, label: m.label, table: m.table, ids: [], count: 0, due: r.due, customer_id: r.customer_id, customer: r.customer, customer_type: r.customer_type, phone: r.phone, what: '' };
        cur.ids.push(r.id); cur.count++;
        if (r.due < cur.due) cur.due = r.due;
        cur.what = cur.count === 1 ? r.what : `${cur.count} extinguishers`;
        groups.set(g, cur);
      }
      out.push(...groups.values());
    } else {
      rows.forEach(r => out.push({ key, label: m.label, table: m.table, ids: [r.id], count: 1, due: r.due, customer_id: r.customer_id, customer: r.customer, customer_type: r.customer_type, phone: r.phone, what: r.what, system: m.system }));
    }
  }
  for (const o of out) {
    o.overdue = o.due < today;
    o.days = Math.round((Date.parse(o.due) - Date.parse(today)) / 864e5);
    o.system ||= MAINTENANCE[o.key].system;
  }
  return out.sort((a, b) => a.due.localeCompare(b.due));
}
