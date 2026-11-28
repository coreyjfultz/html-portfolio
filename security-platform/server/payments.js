// Online payments with Stripe (credit/debit cards and US bank ACH).
// Card and bank numbers are entered on Stripe's own pages and never touch this server.
import crypto from 'node:crypto';
import { getSettings, tx } from './db.js';
import { HttpError, create, round2, todayLocal } from './resources.js';
import { decrypt, audit } from './security.js';
import { queue, sendEmail, appUrl } from './notify.js';

export function stripeConfig(db) {
  const s = getSettings(db);
  const dec = v => { try { return v ? decrypt(v) : ''; } catch { return ''; } };
  const key = process.env.STRIPE_SECRET_KEY || dec(s.stripe_secret);
  return {
    key, webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || dec(s.stripe_webhook_secret),
    api: process.env.STRIPE_API_BASE || 'https://api.stripe.com',
    ok: !!key, test: key.startsWith('sk_test_') || key.startsWith('rk_test_'),
    ach: s.stripe_ach !== '0',
  };
}

// Stripe takes form-encoded bodies with bracketed keys: line_items[0][price_data][currency]=usd
function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => typeof x === 'object' ? form(x, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(x)));
    else if (typeof v === 'object') form(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

async function stripe(db, method, path, params, { idempotencyKey } = {}) {
  const cfg = stripeConfig(db);
  if (!cfg.ok) throw new HttpError(400, 'Online payments are not set up yet (Settings → Payments).');
  const url = `${cfg.api}/v1${path}${method === 'GET' && params ? '?' + form(params) : ''}`;
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': '2024-06-20', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
    body: method === 'GET' ? undefined : form(params || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(res.status === 402 ? 402 : 400, data.error?.message || `Stripe error ${res.status}`);
  return data;
}

const methods = cfg => cfg.ach ? ['card', 'us_bank_account'] : ['card'];

export async function ensureStripeCustomer(db, customerId) {
  const c = db.prepare('SELECT id, name, email, phone, stripe_customer_id FROM customers WHERE id = ?').get(customerId);
  if (!c) throw new HttpError(404, 'Customer not found');
  if (c.stripe_customer_id) return c.stripe_customer_id;
  const sc = await stripe(db, 'POST', '/customers', { name: c.name, email: c.email || undefined, phone: c.phone || undefined, metadata: { secureops_customer_id: c.id } }, { idempotencyKey: `cust-${c.id}` });
  db.prepare('UPDATE customers SET stripe_customer_id = ? WHERE id = ?').run(sc.id, c.id);
  return sc.id;
}

function invoiceBalance(db, invoiceId) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!inv) throw new HttpError(404, 'Invoice not found');
  const paid = db.prepare('SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE invoice_id = ?').get(invoiceId).s;
  return { inv, balance: round2((inv.total || 0) - paid) };
}

export function ensurePayToken(db, invoiceId) {
  const inv = db.prepare('SELECT pay_token FROM invoices WHERE id = ?').get(invoiceId);
  if (inv?.pay_token) return inv.pay_token;
  const t = crypto.randomBytes(20).toString('base64url');
  db.prepare('UPDATE invoices SET pay_token = ? WHERE id = ?').run(t, invoiceId);
  return t;
}
export const payLink = (db, invoiceId) => `${appUrl(db)}/api/public/pay/${ensurePayToken(db, invoiceId)}`;

/** Hosted Stripe Checkout page to pay one invoice's balance by card or bank. */
export async function checkoutForInvoice(db, invoiceId, { returnUrl } = {}) {
  const cfg = stripeConfig(db);
  const { inv, balance } = invoiceBalance(db, invoiceId);
  if (inv.status === 'void' || inv.status === 'draft') throw new HttpError(400, 'This invoice is not open for payment');
  if (!(balance > 0)) throw new HttpError(400, 'This invoice is already paid');
  const customer = await ensureStripeCustomer(db, inv.customer_id);
  const company = getSettings(db).company_name;
  const back = returnUrl || `${appUrl(db)}/portal#/invoices/${inv.id}`;
  const session = await stripe(db, 'POST', '/checkout/sessions', {
    mode: 'payment', customer, payment_method_types: methods(cfg),
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: Math.round(balance * 100), product_data: { name: `${company} — Invoice #${inv.number}` } } }],
    payment_intent_data: { metadata: { invoice_id: inv.id }, setup_future_usage: 'off_session' },
    metadata: { invoice_id: inv.id, kind: 'invoice' },
    success_url: `${back}${back.includes('?') ? '&' : '?'}paid=1`, cancel_url: back,
  });
  return { url: session.url, id: session.id };
}

/** Stripe-hosted page where the customer adds or replaces a card or bank account. */
export async function checkoutForSetup(db, customerId, { returnUrl } = {}) {
  const cfg = stripeConfig(db);
  const customer = await ensureStripeCustomer(db, customerId);
  const back = returnUrl || `${appUrl(db)}/portal#/payment-methods`;
  const session = await stripe(db, 'POST', '/checkout/sessions', {
    mode: 'setup', customer, currency: 'usd', payment_method_types: methods(cfg),
    metadata: { customer_id: customerId, kind: 'setup' }, success_url: `${back}${back.includes('?') ? '&' : '?'}saved=1`, cancel_url: back,
  });
  return { url: session.url };
}

export async function listMethods(db, customerId) {
  const c = db.prepare('SELECT stripe_customer_id FROM customers WHERE id = ?').get(customerId);
  if (!c?.stripe_customer_id || !stripeConfig(db).ok) return { methods: [], default: null };
  const [pm, cust] = await Promise.all([
    stripe(db, 'GET', `/customers/${c.stripe_customer_id}/payment_methods`, { limit: 20 }),
    stripe(db, 'GET', `/customers/${c.stripe_customer_id}`),
  ]);
  const def = cust.invoice_settings?.default_payment_method || null;
  return {
    default: def,
    methods: (pm.data || []).map(m => m.type === 'card'
      ? { id: m.id, type: 'card', label: `${(m.card?.brand || 'card').toUpperCase()} •••• ${m.card?.last4}`, detail: `expires ${m.card?.exp_month}/${m.card?.exp_year}` }
      : { id: m.id, type: 'ach', label: `${m.us_bank_account?.bank_name || 'Bank'} •••• ${m.us_bank_account?.last4}`, detail: m.us_bank_account?.account_type || 'bank account' }),
  };
}

async function ownsMethod(db, customerId, pmId) {
  const { methods: list } = await listMethods(db, customerId);
  if (!list.some(m => m.id === pmId)) throw new HttpError(404, 'Payment method not found');
}
export async function setDefaultMethod(db, customerId, pmId) {
  await ownsMethod(db, customerId, pmId);
  const c = db.prepare('SELECT stripe_customer_id FROM customers WHERE id = ?').get(customerId);
  await stripe(db, 'POST', `/customers/${c.stripe_customer_id}`, { invoice_settings: { default_payment_method: pmId } });
  return { ok: true };
}
export async function removeMethod(db, customerId, pmId) {
  await ownsMethod(db, customerId, pmId);
  await stripe(db, 'POST', `/payment_methods/${pmId}/detach`, {});
  return { ok: true };
}

/** Office charges a saved card/bank for an invoice's balance (e.g. monthly monitoring). */
export async function chargeSaved(db, invoiceId, user, { pmId } = {}) {
  const { inv, balance } = invoiceBalance(db, invoiceId);
  if (!(balance > 0)) throw new HttpError(400, 'Nothing is owed on this invoice');
  const { methods: list, default: def } = await listMethods(db, inv.customer_id);
  const pm = list.find(m => m.id === (pmId || def)) || list[0];
  if (!pm) throw new HttpError(400, 'This customer has no saved card or bank account');
  const c = db.prepare('SELECT stripe_customer_id FROM customers WHERE id = ?').get(inv.customer_id);
  const intent = await stripe(db, 'POST', '/payment_intents', {
    amount: Math.round(balance * 100), currency: 'usd', customer: c.stripe_customer_id, payment_method: pm.id,
    payment_method_types: [pm.type === 'card' ? 'card' : 'us_bank_account'], off_session: true, confirm: true,
    description: `Invoice #${inv.number}`, metadata: { invoice_id: inv.id },
  }, { idempotencyKey: `charge-${inv.id}-${Math.round(balance * 100)}-${todayLocal()}` });
  if (intent.status === 'succeeded') {
    recordOnlinePayment(db, { invoiceId: inv.id, amount: intent.amount_received / 100 || balance, method: pm.type, reference: intent.id }, user);
    return { status: 'paid' };
  }
  if (intent.status === 'processing') {
    audit(db, user, 'ach payment pending', 'invoices', inv.id, intent.id);
    return { status: 'processing', message: 'Bank payment started. It usually clears in 3–5 business days and will be recorded automatically.' };
  }
  throw new HttpError(402, 'The payment was not approved. Ask the customer to update their payment method.');
}

export function recordOnlinePayment(db, { invoiceId, amount, method, reference }, user) {
  return tx(db, () => {
    if (db.prepare('SELECT 1 FROM payments WHERE reference = ?').get(reference)) return null; // already recorded
    const p = create(db, 'payments', { invoice_id: invoiceId, date: todayLocal(), amount: round2(amount), method: method === 'ach' ? 'ach' : 'card', reference, notes: 'Paid online (Stripe)' },
      user?.role ? user : { id: null, name: 'Stripe', role: 'owner' });
    queue(() => receiptEmail(db, p.id));
    return p;
  });
}

async function receiptEmail(db, paymentId) {
  const p = db.prepare('SELECT p.*, i.number, c.email, c.name FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN customers c ON c.id = p.customer_id WHERE p.id = ?').get(paymentId);
  if (!p?.email) return;
  const s = getSettings(db);
  await sendEmail(db, { to: p.email, subject: `Payment received — Invoice #${p.number}`, related: { type: 'invoice', id: p.invoice_id },
    text: `Hi ${p.name},\n\nThank you! We received your payment of $${p.amount.toFixed(2)} for invoice #${p.number}.\n\n${s.company_name}` });
}

// ------------------------------------------------------------------ webhook
export function verifySignature(rawBody, header, secret, toleranceSec = 300) {
  if (!secret) throw new HttpError(400, 'Webhook secret not configured');
  const parts = Object.fromEntries(String(header || '').split(',').map(kv => kv.split('=')).map(([k, ...v]) => [k, v.join('=')]));
  const sigs = String(header || '').split(',').filter(x => x.startsWith('v1=')).map(x => x.slice(3));
  const t = Number(parts.t);
  if (!t || !sigs.length) throw new HttpError(400, 'Bad signature header');
  if (Math.abs(Date.now() / 1000 - t) > toleranceSec) throw new HttpError(400, 'Signature too old');
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const ok = sigs.some(s => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
  if (!ok) throw new HttpError(400, 'Signature mismatch');
}

export async function handleWebhook(db, rawBody, signature) {
  verifySignature(rawBody, signature, stripeConfig(db).webhookSecret);
  const event = JSON.parse(rawBody);
  const obj = event.data?.object || {};
  if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type) && obj.mode === 'payment') {
    if (obj.payment_status !== 'paid') return { ok: true, pending: true }; // ACH: wait for async_payment_succeeded
    const invoiceId = Number(obj.metadata?.invoice_id);
    const session = await stripe(db, 'GET', `/checkout/sessions/${obj.id}`, { expand: ['payment_intent.payment_method'] });
    const type = session.payment_intent?.payment_method?.type;
    recordOnlinePayment(db, { invoiceId, amount: (obj.amount_total || 0) / 100, method: type === 'us_bank_account' ? 'ach' : 'card', reference: session.payment_intent?.id || obj.id });
  } else if (event.type === 'checkout.session.completed' && obj.mode === 'setup') {
    // Make the newly saved method the default for future charges.
    const session = await stripe(db, 'GET', `/checkout/sessions/${obj.id}`, { expand: ['setup_intent'] });
    const pm = session.setup_intent?.payment_method;
    if (pm && obj.customer) await stripe(db, 'POST', `/customers/${obj.customer}`, { invoice_settings: { default_payment_method: pm } });
  } else if (event.type === 'payment_intent.succeeded' && obj.metadata?.invoice_id && !obj.metadata?.checkout) {
    // Off-session bank (ACH) charges clear days later.
    const type = (obj.payment_method_types || [])[0] === 'us_bank_account' ? 'ach' : 'card';
    recordOnlinePayment(db, { invoiceId: Number(obj.metadata.invoice_id), amount: (obj.amount_received || obj.amount || 0) / 100, method: type, reference: obj.id });
  } else if (['checkout.session.async_payment_failed', 'payment_intent.payment_failed'].includes(event.type)) {
    audit(db, { name: 'Stripe' }, 'payment failed', 'invoices', Number(obj.metadata?.invoice_id) || null, obj.last_payment_error?.message || event.type);
  }
  return { ok: true };
}
