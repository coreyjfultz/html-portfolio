// Proposals & agreements: building them, sending a signing link, electronic
// signature with an audit trail, and what happens automatically once signed.
import { materialsFromProposal } from './truckstock.js';
import crypto from 'node:crypto';
import { getSettings, nextNumber, tx } from './db.js';
import { HttpError, registerHooks, create, get, list, round2, nowLocal, todayLocal, addDays, setStage } from './resources.js';
import { decodeImage, saveImage } from './media.js';
import { audit } from './security.js';
import { queue, sendEmail, sendSms, appUrl } from './notify.js';

const raw = (db, id) => db.prepare('SELECT * FROM proposals WHERE id = ?').get(Number(id));

export function recalcProposal(db, id) {
  const p = raw(db, id);
  if (!p) return;
  const items = db.prepare('SELECT qty, unit_price, taxable FROM proposal_items WHERE proposal_id = ?').all(id);
  const subtotal = round2(items.reduce((t, i) => t + i.qty * i.unit_price, 0));
  const tax = round2(items.filter(i => i.taxable).reduce((t, i) => t + i.qty * i.unit_price, 0) * (Number(p.tax_rate) || 0) / 100);
  db.prepare('UPDATE proposals SET subtotal = ?, tax = ?, total = ? WHERE id = ?').run(subtotal, tax, round2(subtotal + tax), id);
}

const locked = p => p && ['signed', 'declined'].includes(p.status);

registerHooks('proposals', {
  beforeSave(db, data, { isCreate, existing, user }) {
    if (locked(existing)) throw new HttpError(409, `This ${existing.kind} was ${existing.status} and can't be changed. Duplicate it to make a new version.`);
    const s = getSettings(db);
    if (isCreate) {
      data.number = nextNumber(db, 'proposal_next_number');
      data.sales_user = user?.name || null;
      data.status = 'draft';
      if (!data.valid_until) data.valid_until = addDays(todayLocal(), Number(s.proposal_valid_days) || 30);
      if (data.tax_rate == null) {
        const c = db.prepare('SELECT tax_exempt FROM customers WHERE id = ?').get(data.customer_id);
        data.tax_rate = c?.tax_exempt ? 0 : Number(s.tax_rate) || 0;
      }
    }
  },
  afterSave(db, row) { recalcProposal(db, row.id); },
  beforeDelete(db, row) { if (row.status === 'signed') throw new HttpError(409, 'Signed agreements are kept for your records and cannot be deleted.'); },
});

registerHooks('proposal_items', {
  beforeSave(db, data, { existing }) {
    const p = raw(db, data.proposal_id ?? existing?.proposal_id);
    if (locked(p)) throw new HttpError(409, `This ${p.kind} was ${p.status} and can't be changed.`);
    if (data.item_id && (data.unit_price == null || !data.description)) {
      const item = db.prepare('SELECT name, sku, unit_price FROM inventory_items WHERE id = ?').get(data.item_id);
      if (item) {
        data.description ||= item.name;
        if (data.unit_price == null) data.unit_price = item.unit_price ?? 0;
      }
    }
    const desc = 'description' in data ? data.description : existing?.description;
    if (!desc) throw new HttpError(400, 'Enter a description or pick an inventory item');
    if (data.unit_price == null && !existing) data.unit_price = 0;
  },
  afterSave(db, row, { existing }) { recalcProposal(db, row.proposal_id); if (existing && existing.proposal_id !== row.proposal_id) recalcProposal(db, existing.proposal_id); },
  beforeDelete(db, row) { const p = raw(db, row.proposal_id); if (locked(p)) throw new HttpError(409, `This ${p.kind} can't be changed.`); },
  afterDelete(db, row) { recalcProposal(db, row.proposal_id); },
});

// ------------------------------------------------------------------ the document
/** Everything the customer sees and agrees to. Its SHA-256 is stored at signing, so later edits are detectable. */
export function documentContent(db, id) {
  const p = raw(db, id);
  if (!p) throw new HttpError(404, 'Not found');
  const s = getSettings(db);
  const c = db.prepare('SELECT name, contact_name, email, phone, billing_address, city, state, zip FROM customers WHERE id = ?').get(p.customer_id);
  const site = p.site_id ? db.prepare('SELECT name, address, city, state, zip FROM locations WHERE id = ?').get(p.site_id) : null;
  const items = db.prepare('SELECT description, qty, unit_price, taxable FROM proposal_items WHERE proposal_id = ? ORDER BY sort, id').all(id);
  return {
    number: p.number, kind: p.kind, title: p.title, intro: p.intro || '', valid_until: p.valid_until,
    company: { name: s.company_name, address: s.company_address, phone: s.company_phone, email: s.company_email, license: s.company_license, logo: !!s.logo_key },
    customer: c, site, items,
    subtotal: p.subtotal, tax_rate: p.tax_rate, tax: p.tax, total: p.total,
    monthly_amount: p.monthly_amount, monthly_description: p.monthly_description, term_months: p.term_months,
    deposit_percent: p.deposit_percent, deposit: p.deposit_percent ? round2((p.total || 0) * p.deposit_percent / 100) : 0,
    terms: p.terms || s.proposal_terms,
    prepared_by: p.sales_user,
  };
}
export const hashDoc = doc => crypto.createHash('sha256').update(JSON.stringify(doc)).digest('hex');

export function publicView(db, p) {
  const doc = documentContent(db, p.id);
  const expired = !['signed', 'declined'].includes(p.status) && p.valid_until && p.valid_until < todayLocal();
  return {
    ...doc, status: expired ? 'expired' : p.status,
    signed: p.status === 'signed' ? { by: p.signed_by, title: p.signed_title, at: p.signed_at, hash: p.doc_hash } : null,
    declined_reason: p.declined_reason,
  };
}

function ensureToken(db, p) {
  if (p.public_token) return p.public_token;
  const t = crypto.randomBytes(24).toString('base64url');
  db.prepare('UPDATE proposals SET public_token = ? WHERE id = ?').run(t, p.id);
  return t;
}
export const signingUrl = (db, token) => `${appUrl(db)}/sign/${token}`;

export function byToken(db, token) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(String(token))) throw new HttpError(404, 'This link is not valid');
  const p = db.prepare('SELECT * FROM proposals WHERE public_token = ?').get(token);
  if (!p) throw new HttpError(404, 'This link is not valid or was replaced by a newer version');
  return p;
}

// ------------------------------------------------------------------ actions
export function sendForSignature(db, id, user, { email = true, sms = false, message = '' } = {}) {
  const p = raw(db, id);
  if (!p) throw new HttpError(404, 'Not found');
  if (locked(p)) throw new HttpError(409, `Already ${p.status}`);
  const items = db.prepare('SELECT COUNT(*) AS n FROM proposal_items WHERE proposal_id = ?').get(id).n;
  if (!items && !(p.monthly_amount > 0)) throw new HttpError(400, 'Add at least one line item or a monthly fee before sending');
  const token = ensureToken(db, p);
  db.prepare(`UPDATE proposals SET status = CASE WHEN status IN ('draft','expired') THEN 'sent' ELSE status END, sent_at = COALESCE(sent_at, ?),
    valid_until = CASE WHEN valid_until < ? THEN ? ELSE valid_until END WHERE id = ?`)
    .run(nowLocal(), todayLocal(), addDays(todayLocal(), Number(getSettings(db).proposal_valid_days) || 30), id);
  setStage(db, p.customer_id, 'bid', { forwardOnly: true, user, reason: `Proposal P-${p.number} sent` });
  audit(db, user, 'send for signature', 'proposals', p.id);
  const url = signingUrl(db, token);
  const c = db.prepare('SELECT name, contact_name, email, phone FROM customers WHERE id = ?').get(p.customer_id);
  const company = getSettings(db).company_name;
  const related = { type: 'proposal', id: p.id };
  if (email) {
    queue(() => sendEmail(db, {
      to: c.email, subject: `${company}: ${p.title} — ready for your signature`, related,
      text: `Hi ${c.contact_name || c.name},\n\n${message ? message + '\n\n' : ''}Your ${p.kind} "${p.title}" is ready to review and sign online:\n\n${url}\n\nIt only takes a minute and works on your phone.\n\nThank you,\n${p.sales_user || company}\n${company}`,
    }));
  }
  if (sms) queue(() => sendSms(db, { to: c.phone, body: `${company}: your ${p.kind} "${p.title}" is ready to review and sign: ${url}`, related }));
  return { url };
}

export function markViewed(db, p) {
  if (p.status === 'sent' || (p.status === 'draft' && p.public_token)) {
    db.prepare("UPDATE proposals SET status = 'viewed', viewed_at = COALESCE(viewed_at, ?) WHERE id = ?").run(nowLocal(), p.id);
  }
}

export function sign(db, token, { name, title, email, image, agree }, { ip, agent }) {
  return tx(db, () => {
    const p = byToken(db, token);
    if (p.status === 'signed') throw new HttpError(409, 'This document has already been signed');
    if (p.status === 'declined') throw new HttpError(409, 'This document was declined. Please contact us for a new copy.');
    if (p.valid_until && p.valid_until < todayLocal()) throw new HttpError(410, 'This offer has expired. Please contact us for an updated version.');
    if (agree !== true) throw new HttpError(400, 'Please tick the box to agree to sign electronically');
    const signer = String(name || '').trim();
    if (signer.length < 2) throw new HttpError(400, 'Type your full name');
    const img = decodeImage(image, { maxBytes: 1024 * 1024, allowed: ['image/png'] });
    const doc = documentContent(db, p.id);
    const key = saveImage('signatures', img);
    db.prepare(`UPDATE proposals SET status = 'signed', signed_by = ?, signed_title = ?, signed_email = ?, signed_at = ?, signed_ip = ?, signed_agent = ?,
      doc_hash = ?, signature_key = ? WHERE id = ?`)
      .run(signer.slice(0, 120), String(title || '').slice(0, 120) || null, String(email || '').slice(0, 200) || null, nowLocal(), ip || null, String(agent || '').slice(0, 300), hashDoc(doc), key, p.id);
    audit(db, { name: `${signer} (customer)` }, 'signed', 'proposals', p.id, `from ${ip}`);
    const results = afterSigned(db, p.id);
    queue(() => signedEmails(db, p.id));
    return results;
  });
}

export function decline(db, token, reason) {
  const p = byToken(db, token);
  if (['signed', 'declined'].includes(p.status)) throw new HttpError(409, `Already ${p.status}`);
  db.prepare("UPDATE proposals SET status = 'declined', declined_reason = ? WHERE id = ?").run(String(reason || '').slice(0, 500) || null, p.id);
  audit(db, { name: 'customer' }, 'declined', 'proposals', p.id, reason || null);
  const s = getSettings(db);
  if (s.company_email) queue(() => sendEmail(db, { to: s.company_email, subject: `Declined: P-${p.number} ${p.title}`, text: `The customer declined proposal P-${p.number} "${p.title}".\n\nReason: ${reason || '(none given)'}`, related: { type: 'proposal', id: p.id } }));
  return { ok: true };
}

/** Once signed: move the customer to Accepted, start monthly billing, create the install job and deposit invoice. */
function afterSigned(db, id) {
  const p = raw(db, id);
  const sys = { id: null, name: 'e-signature', role: 'owner' };
  const out = {};
  setStage(db, p.customer_id, 'accepted', { forwardOnly: true, user: sys, reason: `P-${p.number} signed by ${p.signed_by}` });
  if (p.monthly_amount > 0) {
    create(db, 'recurring_charges', { customer_id: p.customer_id, description: p.monthly_description || 'Monthly service', amount: p.monthly_amount, taxable: 0, active: 1 }, sys);
    db.prepare("UPDATE customers SET status = 'active' WHERE id = ?").run(p.customer_id);
    out.recurring = true;
  }
  const items = db.prepare('SELECT * FROM proposal_items WHERE proposal_id = ?').all(id);
  if (items.length && p.kind !== 'monitoring agreement' && p.kind !== 'service agreement') {
    const call = create(db, 'service_calls', {
      customer_id: p.customer_id, site_id: p.site_id, title: p.title, call_type: 'installation', system_type: 'other', status: 'new',
      description: `From signed ${p.kind} P-${p.number}.\n\n${items.map(i => `• ${i.qty} × ${i.description}`).join('\n')}`,
      duration_hours: 4,
    }, sys);
    db.prepare('UPDATE proposals SET service_call_id = ? WHERE id = ?').run(call.id, id);
    out.service_call_id = call.id;
    materialsFromProposal(db, id, call.id);
  }
  if (p.deposit_percent > 0 && p.total > 0) {
    const amount = round2(p.total * p.deposit_percent / 100);
    const inv = create(db, 'invoices', { customer_id: p.customer_id, kind: 'installation', status: 'sent', tax_rate: 0, notes: `Deposit for ${p.kind} P-${p.number}: ${p.title}` }, sys);
    create(db, 'invoice_items', { invoice_id: inv.id, description: `${p.deposit_percent}% deposit — P-${p.number} ${p.title}`, qty: 1, unit_price: amount, taxable: 0 }, sys);
    db.prepare('UPDATE proposals SET invoice_id = ? WHERE id = ?').run(inv.id, id);
    out.invoice_id = inv.id;
  }
  return out;
}

async function signedEmails(db, id) {
  const p = raw(db, id);
  const s = getSettings(db);
  const c = db.prepare('SELECT name, contact_name, email FROM customers WHERE id = ?').get(p.customer_id);
  const url = signingUrl(db, p.public_token);
  const related = { type: 'proposal', id };
  await sendEmail(db, {
    to: p.signed_email || c.email, related,
    subject: `Signed copy: ${p.title}`,
    text: `Hi ${p.signed_by},\n\nThank you! Your signed ${p.kind} "${p.title}" (P-${p.number}) is saved. You can view or print it any time here:\n\n${url}\n\n${p.deposit_percent > 0 ? `A deposit invoice has been created; you can pay it from your customer portal.\n\n` : ''}We'll be in touch to schedule.\n\n${s.company_name}\n${s.company_phone || ''}`,
  });
  if (s.company_email) {
    await sendEmail(db, { to: s.company_email, related, subject: `✅ Signed: P-${p.number} ${p.title} (${c.name})`, text: `${p.signed_by} signed P-${p.number} "${p.title}" for ${c.name} at ${p.signed_at}.\n\nOne-time total: $${(p.total || 0).toFixed(2)}${p.monthly_amount ? `\nMonthly: $${p.monthly_amount.toFixed(2)}` : ''}\n\n${appUrl(db)}/#/proposals/${p.id}` });
  }
}

export function duplicate(db, id, user) {
  return tx(db, () => {
    const p = raw(db, id);
    if (!p) throw new HttpError(404, 'Not found');
    const copy = create(db, 'proposals', {
      customer_id: p.customer_id, site_id: p.site_id, kind: p.kind, title: p.title, intro: p.intro, monthly_amount: p.monthly_amount,
      monthly_description: p.monthly_description, term_months: p.term_months, deposit_percent: p.deposit_percent, tax_rate: p.tax_rate, terms: p.terms,
    }, user);
    for (const i of db.prepare('SELECT * FROM proposal_items WHERE proposal_id = ? ORDER BY sort, id').all(id)) {
      create(db, 'proposal_items', { proposal_id: copy.id, item_id: i.item_id, description: i.description, qty: i.qty, unit_price: i.unit_price, taxable: i.taxable, sort: i.sort }, user);
    }
    return get(db, 'proposals', copy.id);
  });
}
