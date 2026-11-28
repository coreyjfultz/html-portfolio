// QuickBooks Online sync (customers, invoices, payments) over Intuit's OAuth 2.0 API,
// plus export files for QuickBooks Desktop (IIF), QuickBooks Online import (CSV), Xero and others.
import crypto from 'node:crypto';
import { getSettings } from './db.js';
import { HttpError, round2, todayLocal, registerHooks } from './resources.js';
import { encrypt, decrypt, audit } from './security.js';
import { appUrl, queue } from './notify.js';

const AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const OAUTH = () => process.env.QBO_OAUTH_BASE || 'https://oauth.platform.intuit.com';
const REVOKE = () => process.env.QBO_REVOKE_URL || 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
const API = env => process.env.QBO_API_BASE || (env === 'production' ? 'https://quickbooks.api.intuit.com' : 'https://sandbox-quickbooks.api.intuit.com');
const MINOR = 'minorversion=75';

const put = (db, key, value) => db.prepare('INSERT INTO settings(key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value == null ? '' : String(value));
const dec = v => { try { return v ? decrypt(v) : ''; } catch { return ''; } };

export function qboConfig(db) {
  const s = getSettings(db);
  return {
    clientId: process.env.QBO_CLIENT_ID || s.qbo_client_id,
    clientSecret: process.env.QBO_CLIENT_SECRET || dec(s.qbo_client_secret),
    env: s.qbo_environment || 'sandbox',
    realm: s.qbo_realm_id, company: s.qbo_company_name,
    access: dec(s.qbo_access), refresh: dec(s.qbo_refresh), accessExpires: Number(s.qbo_access_expires) || 0,
    itemId: s.qbo_item_id, taxItemId: s.qbo_tax_item_id, autoSync: s.qbo_auto_sync === '1', lastSync: s.qbo_last_sync,
    redirectUri: `${appUrl(db)}/api/qbo/callback`,
  };
}
export const qboConnected = db => { const c = qboConfig(db); return !!(c.realm && c.refresh); };

// ------------------------------------------------------------------ OAuth
const pendingStates = new Map(); // state -> expires
export function authorizeUrl(db) {
  const c = qboConfig(db);
  if (!c.clientId || !c.clientSecret) throw new HttpError(400, 'Add your Intuit app Client ID and Client Secret first.');
  const state = crypto.randomBytes(16).toString('hex');
  pendingStates.set(state, Date.now() + 15 * 60e3);
  const q = new URLSearchParams({ client_id: c.clientId, response_type: 'code', scope: 'com.intuit.quickbooks.accounting', redirect_uri: c.redirectUri, state });
  return `${AUTH_URL}?${q}`;
}

async function tokenRequest(db, params) {
  const c = qboConfig(db);
  const res = await fetch(`${OAUTH()}/oauth2/v1/tokens/bearer`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(400, `QuickBooks sign-in failed: ${data.error_description || data.error || res.status}`);
  put(db, 'qbo_access', encrypt(data.access_token));
  if (data.refresh_token) put(db, 'qbo_refresh', encrypt(data.refresh_token));
  put(db, 'qbo_access_expires', Date.now() + (Number(data.expires_in) || 3600) * 1000 - 60e3);
  return data;
}

export async function handleCallback(db, { code, state, realmId }) {
  const exp = pendingStates.get(state);
  pendingStates.delete(state);
  if (!exp || exp < Date.now()) throw new HttpError(400, 'This QuickBooks connection link expired. Start again from Settings.');
  if (!code || !realmId) throw new HttpError(400, 'QuickBooks did not return an authorization code.');
  await tokenRequest(db, { grant_type: 'authorization_code', code, redirect_uri: qboConfig(db).redirectUri });
  put(db, 'qbo_realm_id', realmId);
  try {
    const info = await qbo(db, 'GET', `/companyinfo/${realmId}`);
    put(db, 'qbo_company_name', info.CompanyInfo?.CompanyName || '');
  } catch { /* name is cosmetic */ }
  if (!qboConfig(db).itemId) await pickDefaultItem(db).catch(() => {});
  audit(db, { name: 'QuickBooks' }, 'connected', 'settings', null, realmId);
}

export async function disconnect(db, user) {
  const c = qboConfig(db);
  if (c.refresh) {
    await fetch(REVOKE(), { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64'), 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ token: c.refresh }) }).catch(() => {});
  }
  for (const k of ['qbo_realm_id', 'qbo_access', 'qbo_refresh', 'qbo_access_expires', 'qbo_company_name']) put(db, k, '');
  audit(db, user, 'disconnected', 'settings', null, 'QuickBooks');
}

async function accessToken(db) {
  const c = qboConfig(db);
  if (!c.realm || !c.refresh) throw new HttpError(400, 'QuickBooks is not connected.');
  if (c.access && c.accessExpires > Date.now()) return c.access;
  const d = await tokenRequest(db, { grant_type: 'refresh_token', refresh_token: c.refresh });
  return d.access_token;
}

async function qbo(db, method, path, body, { query } = {}) {
  const c = qboConfig(db);
  const token = await accessToken(db);
  const url = `${API(c.env)}/v3/company/${c.realm}${path}${path.includes('?') ? '&' : '?'}${MINOR}${query ? `&query=${encodeURIComponent(query)}` : ''}`;
  const res = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const f = data.Fault?.Error?.[0];
    throw new HttpError(400, f ? `${f.Message}${f.Detail ? ': ' + f.Detail : ''}` : `QuickBooks error ${res.status}`);
  }
  return data;
}
const qboQuery = (db, sql) => qbo(db, 'GET', '/query', null, { query: sql }).then(d => d.QueryResponse || {});
const qstr = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export async function listItems(db) {
  const r = await qboQuery(db, "select Id, Name, Type from Item where Active = true maxresults 200");
  return (r.Item || []).filter(i => ['Service', 'NonInventory', 'Inventory'].includes(i.Type)).map(i => ({ id: i.Id, name: i.Name, type: i.Type }));
}
async function pickDefaultItem(db) {
  const items = await listItems(db);
  const pick = items.find(i => /^services?$/i.test(i.name)) || items.find(i => /sales/i.test(i.name)) || items[0];
  if (pick) put(db, 'qbo_item_id', pick.id);
}

// ------------------------------------------------------------------ sync
function mapGet(db, type, localId) { return db.prepare('SELECT * FROM qbo_map WHERE entity = ? AND local_id = ?').get(type, localId); }
function mapSet(db, type, localId, qboId, syncToken, error = null) {
  db.prepare(`INSERT INTO qbo_map (entity, local_id, qbo_id, sync_token, synced_at, error) VALUES (?,?,?,?,datetime('now','localtime'),?)
    ON CONFLICT(entity, local_id) DO UPDATE SET qbo_id = COALESCE(excluded.qbo_id, qbo_id), sync_token = COALESCE(excluded.sync_token, sync_token), synced_at = excluded.synced_at, error = excluded.error, dirty = 0`)
    .run(type, localId, qboId, syncToken, error);
}

async function syncCustomer(db, id) {
  const m = mapGet(db, 'customer', id);
  if (m?.qbo_id) return m.qbo_id;
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  // Reuse a QuickBooks customer with the same name (names must be unique there).
  const found = (await qboQuery(db, `select Id, SyncToken from Customer where DisplayName = '${qstr(c.name)}'`)).Customer?.[0];
  if (found) { mapSet(db, 'customer', id, found.Id, found.SyncToken); return found.Id; }
  const body = {
    DisplayName: c.name.slice(0, 100),
    ...(c.type === 'commercial' ? { CompanyName: c.name.slice(0, 100) } : {}),
    ...(c.email ? { PrimaryEmailAddr: { Address: c.email } } : {}),
    ...(c.phone ? { PrimaryPhone: { FreeFormNumber: c.phone } } : {}),
    ...(c.billing_address ? { BillAddr: { Line1: c.billing_address, City: c.city || undefined, CountrySubDivisionCode: c.state || undefined, PostalCode: c.zip || undefined } } : {}),
    Notes: `SecureOps customer #${c.id}${c.account_number ? `, monitoring acct ${c.account_number}` : ''}`,
  };
  const r = await qbo(db, 'POST', '/customer', body);
  mapSet(db, 'customer', id, r.Customer.Id, r.Customer.SyncToken);
  return r.Customer.Id;
}

async function syncInvoice(db, id) {
  const cfg = qboConfig(db);
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
  const m = mapGet(db, 'invoice', id);
  if (inv.status === 'void') {
    if (m?.qbo_id) {
      const cur = (await qbo(db, 'GET', `/invoice/${m.qbo_id}`)).Invoice;
      await qbo(db, 'POST', '/invoice?operation=void', { Id: m.qbo_id, SyncToken: cur.SyncToken });
      mapSet(db, 'invoice', id, m.qbo_id, null);
    }
    return;
  }
  if (!cfg.itemId) throw new HttpError(400, 'Choose the QuickBooks product/service to post sales to (Settings → Accounting).');
  const customerRef = await syncCustomer(db, inv.customer_id);
  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id').all(id);
  const Line = items.map(i => ({
    DetailType: 'SalesItemLineDetail', Amount: round2(i.qty * i.unit_price), Description: i.description.slice(0, 4000),
    SalesItemLineDetail: { ItemRef: { value: cfg.itemId }, Qty: i.qty, UnitPrice: i.unit_price },
  }));
  // Our tax is already calculated; post it as its own line so totals match exactly.
  if (inv.tax > 0) Line.push({ DetailType: 'SalesItemLineDetail', Amount: inv.tax, Description: `Sales tax (${inv.tax_rate}%)`, SalesItemLineDetail: { ItemRef: { value: cfg.taxItemId || cfg.itemId }, Qty: 1, UnitPrice: inv.tax } });
  const body = { CustomerRef: { value: customerRef }, DocNumber: String(inv.number), TxnDate: inv.issue_date, DueDate: inv.due_date || undefined, Line, PrivateNote: `SecureOps invoice #${inv.number}${inv.notes ? ` — ${inv.notes.slice(0, 900)}` : ''}` };
  let r;
  if (m?.qbo_id) {
    const cur = (await qbo(db, 'GET', `/invoice/${m.qbo_id}`)).Invoice;
    r = await qbo(db, 'POST', '/invoice', { ...body, Id: m.qbo_id, SyncToken: cur.SyncToken, sparse: false });
  } else r = await qbo(db, 'POST', '/invoice', body);
  mapSet(db, 'invoice', id, r.Invoice.Id, r.Invoice.SyncToken);
}

async function syncPayment(db, id) {
  if (mapGet(db, 'payment', id)?.qbo_id) return;
  const p = db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
  await syncInvoice(db, p.invoice_id);
  const invRef = mapGet(db, 'invoice', p.invoice_id).qbo_id;
  const customerRef = await syncCustomer(db, p.customer_id);
  const r = await qbo(db, 'POST', '/payment', {
    CustomerRef: { value: customerRef }, TotalAmt: p.amount, TxnDate: p.date,
    PaymentRefNum: (p.reference || '').slice(0, 21) || undefined, PrivateNote: `${p.method} payment from SecureOps`,
    Line: [{ Amount: p.amount, LinkedTxn: [{ TxnId: invRef, TxnType: 'Invoice' }] }],
  });
  mapSet(db, 'payment', id, r.Payment.Id, r.Payment.SyncToken);
}

/** Send every new/changed invoice and payment to QuickBooks. Safe to run as often as you like. */
export async function syncAll(db, { user } = {}) {
  const result = { invoices: 0, payments: 0, errors: [] };
  const invoices = db.prepare(`SELECT i.id, i.number FROM invoices i LEFT JOIN qbo_map m ON m.entity = 'invoice' AND m.local_id = i.id
    WHERE i.status <> 'draft' AND (m.local_id IS NULL OR m.error IS NOT NULL OR m.dirty = 1)
      AND NOT (i.status = 'void' AND m.qbo_id IS NULL) ORDER BY i.id LIMIT 500`).all();
  for (const i of invoices) {
    try { await syncInvoice(db, i.id); result.invoices++; } catch (e) { mapSet(db, 'invoice', i.id, null, null, e.message); result.errors.push(`Invoice #${i.number}: ${e.message}`); }
  }
  const payments = db.prepare(`SELECT p.id FROM payments p LEFT JOIN qbo_map m ON m.entity = 'payment' AND m.local_id = p.id
    WHERE m.qbo_id IS NULL ORDER BY p.id LIMIT 500`).all();
  for (const p of payments) {
    try { await syncPayment(db, p.id); result.payments++; } catch (e) { mapSet(db, 'payment', p.id, null, null, e.message); result.errors.push(`Payment ${p.id}: ${e.message}`); }
  }
  put(db, 'qbo_last_sync', new Date().toISOString());
  audit(db, user || { name: 'QuickBooks sync' }, 'quickbooks sync', null, null, `${result.invoices} invoices, ${result.payments} payments, ${result.errors.length} errors`);
  return result;
}

let autoTimer = null;
/** With auto-sync on, changes are pushed a little after they happen (batched). */
export function scheduleAutoSync(db) {
  if (!qboConnected(db) || !qboConfig(db).autoSync || autoTimer) return;
  autoTimer = setTimeout(() => { autoTimer = null; queue(() => syncAll(db).catch(e => console.error('QuickBooks sync:', e.message))); }, 15000);
  autoTimer.unref?.();
}

// ------------------------------------------------------------------ export files
const csvCell = v => {
  const s = v == null ? '' : String(v);
  return `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};
const csv = rows => '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
const mdy = d => d ? `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}` : '';

function invoiceRows(db, { from, to }) {
  return db.prepare(`SELECT i.*, c.name AS customer, c.email, c.billing_address, c.city, c.state, c.zip, it.description, it.qty, it.unit_price, it.taxable
    FROM invoices i JOIN customers c ON c.id = i.customer_id JOIN invoice_items it ON it.invoice_id = i.id
    WHERE i.status NOT IN ('draft','void') AND i.issue_date BETWEEN ? AND ? ORDER BY i.number, it.id`).all(from, to);
}

export function exportFile(db, format, { from = '2000-01-01', to = todayLocal() } = {}) {
  const s = getSettings(db);
  const rows = invoiceRows(db, { from, to });
  if (format === 'qbo-invoices') {
    // QuickBooks Online: Sales → Invoices → Import invoices
    const out = [['InvoiceNo', 'Customer', 'InvoiceDate', 'DueDate', 'Memo', 'Item(Product/Service)', 'ItemDescription', 'ItemQuantity', 'ItemRate', 'ItemAmount', 'Taxable', 'TaxRate']];
    for (const r of rows) out.push([r.number, r.customer, mdy(r.issue_date), mdy(r.due_date), r.notes || '', 'Services', r.description, r.qty, r.unit_price, round2(r.qty * r.unit_price), r.taxable ? 'Y' : 'N', r.taxable ? `${r.tax_rate || 0}%` : '']);
    return { name: `quickbooks-online-invoices-${from}-to-${to}.csv`, type: 'text/csv; charset=utf-8', body: csv(out) };
  }
  if (format === 'xero-invoices') {
    // Xero: Business → Invoices → Import
    const out = [['*ContactName', 'EmailAddress', 'POAddressLine1', 'POCity', 'PORegion', 'POPostalCode', '*InvoiceNumber', '*InvoiceDate', '*DueDate', '*Description', '*Quantity', '*UnitAmount', '*AccountCode', '*TaxType']];
    for (const r of rows) out.push([r.customer, r.email || '', r.billing_address || '', r.city || '', r.state || '', r.zip || '', r.number, mdy(r.issue_date), mdy(r.due_date), r.description, r.qty, r.unit_price, s.export_income_account || '200', r.taxable ? 'Tax on Sales' : 'Tax Exempt']);
    return { name: `xero-invoices-${from}-to-${to}.csv`, type: 'text/csv; charset=utf-8', body: csv(out) };
  }
  if (format === 'generic-invoices') {
    // FreshBooks, Wave, Zoho, Sage or a spreadsheet: one row per invoice line
    const out = [['Invoice Number', 'Invoice Date', 'Due Date', 'Status', 'Customer', 'Customer Email', 'Description', 'Quantity', 'Unit Price', 'Line Amount', 'Taxable', 'Tax Rate %', 'Invoice Subtotal', 'Invoice Tax', 'Invoice Total']];
    for (const r of rows) out.push([r.number, r.issue_date, r.due_date || '', r.status, r.customer, r.email || '', r.description, r.qty, r.unit_price, round2(r.qty * r.unit_price), r.taxable ? 'yes' : 'no', r.tax_rate || 0, r.subtotal, r.tax, r.total]);
    return { name: `invoices-${from}-to-${to}.csv`, type: 'text/csv; charset=utf-8', body: csv(out) };
  }
  if (format === 'payments') {
    const pays = db.prepare(`SELECT p.*, i.number, c.name AS customer FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN customers c ON c.id = p.customer_id
      WHERE p.date BETWEEN ? AND ? ORDER BY p.date`).all(from, to);
    const out = [['Date', 'Customer', 'Invoice Number', 'Amount', 'Method', 'Reference']];
    for (const p of pays) out.push([p.date, p.customer, p.number, p.amount, p.method, p.reference || '']);
    return { name: `payments-${from}-to-${to}.csv`, type: 'text/csv; charset=utf-8', body: csv(out) };
  }
  if (format === 'iif') {
    // QuickBooks Desktop: File → Utilities → Import → IIF Files
    const income = s.export_income_account || 'Sales';
    const tab = a => a.map(v => String(v ?? '').replace(/[\t\r\n]/g, ' ')).join('\t');
    const lines = [
      tab(['!TRNS', 'TRNSTYPE', 'DATE', 'ACCNT', 'NAME', 'AMOUNT', 'DOCNUM', 'MEMO', 'DUEDATE']),
      tab(['!SPL', 'TRNSTYPE', 'DATE', 'ACCNT', 'NAME', 'AMOUNT', 'DOCNUM', 'MEMO', 'QNTY', 'PRICE']),
      tab(['!ENDTRNS']),
    ];
    const byInv = new Map();
    for (const r of rows) { if (!byInv.has(r.id)) byInv.set(r.id, []); byInv.get(r.id).push(r); }
    for (const items of byInv.values()) {
      const h = items[0];
      lines.push(tab(['TRNS', 'INVOICE', mdy(h.issue_date), 'Accounts Receivable', h.customer, h.total.toFixed(2), h.number, h.notes || '', mdy(h.due_date)]));
      for (const i of items) lines.push(tab(['SPL', 'INVOICE', mdy(h.issue_date), income, h.customer, (-round2(i.qty * i.unit_price)).toFixed(2), h.number, i.description, -i.qty, i.unit_price]));
      if (h.tax > 0) lines.push(tab(['SPL', 'INVOICE', mdy(h.issue_date), s.export_tax_account || 'Sales Tax Payable', h.customer, (-h.tax).toFixed(2), h.number, `Sales tax ${h.tax_rate}%`, '', '']));
      lines.push(tab(['ENDTRNS']));
    }
    return { name: `quickbooks-desktop-invoices-${from}-to-${to}.iif`, type: 'text/plain; charset=utf-8', body: lines.join('\r\n') + '\r\n' };
  }
  throw new HttpError(400, 'Unknown export format');
}

/** Flag an invoice as changed so the next sync sends it again. */
export function markInvoiceDirty(db, invoiceId) {
  db.prepare("UPDATE qbo_map SET dirty = 1 WHERE entity = 'invoice' AND local_id = ?").run(invoiceId);
  scheduleAutoSync(db);
}
// Every change to an invoice, its lines or its payments marks it for re-sync.
registerHooks('invoices', { afterSave: (db, row) => markInvoiceDirty(db, row.id) });
for (const name of ['invoice_items', 'payments']) {
  registerHooks(name, { afterSave: (db, row) => markInvoiceDirty(db, row.invoice_id), afterDelete: (db, row) => markInvoiceDirty(db, row.invoice_id) });
}
