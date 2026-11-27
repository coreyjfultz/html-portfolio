// Supplier invoice intake: email/scan -> read line items -> match to inventory -> receive stock.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR, getSettings, tx } from './db.js';
import { HttpError, adjustStock, create, round2, nowLocal, todayLocal } from './resources.js';
import { audit } from './security.js';
import { extractWithClaude, aiConfigured } from './extract.js';

export const FILES_DIR = path.join(DATA_DIR, 'invoices');
const MAX_FILE = 20 * 1024 * 1024;
const TYPES = {
  'application/pdf': 'pdf', 'image/jpeg': 'image', 'image/jpg': 'image', 'image/png': 'image', 'image/webp': 'image', 'image/gif': 'image',
  'text/csv': 'csv', 'application/vnd.ms-excel': 'csv', 'text/plain': 'text',
};
const EXT_TYPES = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.csv': 'text/csv', '.txt': 'text/plain' };

// Replaceable for tests.
let extractor = extractWithClaude;
export function setExtractor(fn) { extractor = fn || extractWithClaude; }

export const normSku = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export function fileTypeOf(name, type) {
  const t = String(type || '').toLowerCase().split(';')[0].trim();
  if (TYPES[t]) return t === 'image/jpg' ? 'image/jpeg' : t;
  return EXT_TYPES[path.extname(String(name || '')).toLowerCase()] || null;
}

/**
 * Take in one email (or one upload batch). Each usable attachment becomes its own
 * supplier invoice; an email with no attachment is read from its text body.
 * Returns the new ids. Reading happens in the background (see processInvoice).
 */
export function ingest(db, { source, fromEmail = '', subject = '', bodyText = '', files = [], user = null }) {
  const docs = [];
  for (const f of files) {
    const type = fileTypeOf(f.name, f.type);
    if (!type) continue; // signatures, logos in odd formats, etc.
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data || ''), 'base64');
    if (!data.length) continue;
    if (data.length > MAX_FILE) throw new HttpError(413, `${f.name} is larger than 20 MB`);
    // Skip tiny inline images (email signatures / logos).
    if (TYPES[type] === 'image' && data.length < 15_000 && source === 'email') continue;
    docs.push({ name: String(f.name || 'invoice').slice(0, 200), type, data });
  }
  if (!docs.length && bodyText.trim().length > 40) {
    docs.push({ name: 'email-body.txt', type: 'text/plain', data: Buffer.from(bodyText.slice(0, 200_000), 'utf8') });
  }
  if (!docs.length) return [];
  fs.mkdirSync(FILES_DIR, { recursive: true });
  const ids = [];
  for (const d of docs) {
    const key = `${crypto.randomBytes(12).toString('hex')}${path.extname(d.name).toLowerCase().replace(/[^.a-z0-9]/g, '') || ''}`;
    fs.writeFileSync(path.join(FILES_DIR, key), d.data, { mode: 0o600 });
    const info = db.prepare(`INSERT INTO purchase_invoices (status, source, from_email, subject, file_name, file_type, file_key, location_id, review_note, notes)
      VALUES ('processing', ?, ?, ?, ?, ?, ?, 0, NULL, NULL)`).run(source, fromEmail.slice(0, 300), subject.slice(0, 300), d.name, d.type, key);
    const id = Number(info.lastInsertRowid);
    audit(db, user || { name: source === 'email' ? 'email intake' : 'upload' }, 'supplier invoice in', 'purchase_invoices', id, `${source}: ${d.name}`);
    ids.push(id);
  }
  return ids;
}

export function filePath(row) {
  const p = path.join(FILES_DIR, path.basename(row.file_key || ''));
  if (!row.file_key || !fs.existsSync(p)) throw new HttpError(404, 'File not found');
  return p;
}

// ------------------------------------------------------------------ CSV
function parseCsvRows(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}
const money = s => { const n = Number(String(s ?? '').replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : null; };

/** Distributor CSV exports: find the header row and the part/desc/qty/cost columns. */
export function extractFromCsv(text) {
  const rows = parseCsvRows(text.replace(/^﻿/, ''));
  // Patterns are in priority order: the first pattern that matches any column wins.
  const find = (hdr, res, not = /$^/) => { for (const re of res) { const i = hdr.findIndex(h => re.test(h) && !not.test(h)); if (i >= 0) return i; } return -1; };
  for (let h = 0; h < Math.min(rows.length, 15); h++) {
    const hdr = rows[h].map(x => x.trim().toLowerCase());
    const sku = find(hdr, [/^(item|part|sku|mfr|mfg|vendor|catalog|model)[ _#.-]*(no|num|number|#|code|part)?\.?$/, /part ?#|part number|item number|sku|catalog|model/]);
    const qty = find(hdr, [/ship/, /invoiced/, /^(qty|quantity)$/, /qty|quantity/], /order|back|b\/o|remain/);
    const cost = find(hdr, [/^(unit )?(price|cost)( each| ea)?$/, /unit (price|cost)|price each|net price/, /price|cost/], /ext|total|amount|list/);
    const desc = find(hdr, [/desc/, /^(name|item name|product)$/]);
    if (qty < 0 || (sku < 0 && desc < 0)) continue;
    const lines = [];
    for (const r of rows.slice(h + 1)) {
      const q = money(r[qty]);
      if (!q) continue;
      lines.push({ sku: sku >= 0 ? (r[sku] || '').trim() : '', description: desc >= 0 ? (r[desc] || '').trim() : '', qty: q, unit_cost: cost >= 0 ? money(r[cost]) ?? 0 : 0 });
    }
    if (lines.length) {
      // Distributor exports often put "Invoice Number,123" style rows above the table.
      const meta = { vendor: '', invoice_number: '', invoice_date: '' };
      for (const r of rows.slice(0, h)) {
        const k = (r[0] || '').trim().toLowerCase(), v = (r[1] || '').trim();
        if (/invoice ?(no|num|number|#)/.test(k) && v) meta.invoice_number = v;
        else if (/date/.test(k) && v) {
          const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
          meta.invoice_date = m ? `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
        } else if (/vendor|supplier|distributor|sold by|from/.test(k) && v) meta.vendor = v;
        else if (!meta.vendor && k && !v && r.slice(1).every(x => !x.trim())) meta.vendor = r[0].trim();
      }
      const sum = round2(lines.reduce((t, l) => t + l.qty * l.unit_cost, 0));
      return { is_invoice: true, ...meta, subtotal: sum, tax: null, shipping: null, total: sum, lines };
    }
  }
  throw new Error('Could not find part #, quantity and price columns in this CSV');
}

// ------------------------------------------------------------------ matching
function catalog(db) {
  return db.prepare('SELECT id, sku, name, vendor_skus, unit_cost FROM inventory_items WHERE active = 1').all();
}

export function matchLine(items, line) {
  const s = normSku(line.sku);
  if (s) {
    const bySku = items.find(i => normSku(i.sku) === s);
    if (bySku) return { item_id: bySku.id, match: 'part #' };
    const byAlias = items.find(i => String(i.vendor_skus || '').split(',').some(a => normSku(a) === s));
    if (byAlias) return { item_id: byAlias.id, match: 'distributor part #' };
  }
  const d = String(line.description || '').trim().toLowerCase();
  if (d) {
    const byName = items.find(i => i.name.trim().toLowerCase() === d);
    if (byName) return { item_id: byName.id, match: 'name' };
  }
  if (line.suggested_item_id && items.some(i => i.id === line.suggested_item_id)) return { item_id: line.suggested_item_id, match: 'AI suggestion' };
  return { item_id: null, match: 'none' };
}

function senderTrusted(settings, fromEmail) {
  const domain = String(fromEmail).toLowerCase().match(/@([a-z0-9.-]+)/)?.[1];
  if (!domain) return false;
  const list = String(settings.trusted_vendor_domains || '').toLowerCase().split(/[\s,;]+/).filter(Boolean);
  return list.some(d => domain === d || domain.endsWith('.' + d));
}

/** Read the document, store its lines, match them, and auto-receive when it's safe to. */
export async function processInvoice(db, id) {
  const inv = db.prepare('SELECT * FROM purchase_invoices WHERE id = ?').get(id);
  if (!inv) return;
  let data;
  try {
    const buf = fs.readFileSync(filePath(inv));
    if (inv.file_type === 'text/csv') data = extractFromCsv(buf.toString('utf8'));
    else {
      if (!aiConfigured() && extractor === extractWithClaude) {
        db.prepare(`UPDATE purchase_invoices SET status = 'needs review', review_note = ? WHERE id = ?`)
          .run('Automatic reading is not set up (no Claude API key), so enter the lines by hand.', id);
        return;
      }
      data = await extractor({ kind: TYPES[inv.file_type], mediaType: inv.file_type, data: buf, items: catalog(db), fromEmail: inv.from_email, subject: inv.subject });
    }
  } catch (e) {
    console.error(`Supplier invoice ${id}:`, e.message);
    db.prepare(`UPDATE purchase_invoices SET status = 'error', review_note = ? WHERE id = ?`).run(String(e.message).slice(0, 500), id);
    return;
  }

  tx(db, () => {
    db.prepare('DELETE FROM purchase_invoice_lines WHERE purchase_invoice_id = ?').run(id);
    if (data.is_invoice === false && !data.lines?.length) {
      db.prepare(`UPDATE purchase_invoices SET status = 'needs review', review_note = ? WHERE id = ?`).run("This doesn't look like a supplier invoice or packing slip. Reject it or enter lines by hand.", id);
      return;
    }
    const items = catalog(db);
    const ins = db.prepare(`INSERT INTO purchase_invoice_lines (purchase_invoice_id, line_sku, description, qty, unit_cost, item_id, match) VALUES (?,?,?,?,?,?,?)`);
    for (const l of data.lines || []) {
      if (!(Number(l.qty) > 0)) continue;
      const m = matchLine(items, l);
      ins.run(id, String(l.sku || '').slice(0, 100), String(l.description || '').slice(0, 500), Number(l.qty), round2(l.unit_cost), m.item_id, m.match);
    }
    const date = /^\d{4}-\d{2}-\d{2}$/.test(data.invoice_date || '') ? data.invoice_date : null;
    db.prepare(`UPDATE purchase_invoices SET vendor = COALESCE(NULLIF(?, ''), vendor), invoice_number = COALESCE(NULLIF(?, ''), invoice_number),
      invoice_date = COALESCE(?, invoice_date), subtotal = ?, tax = ?, shipping = ?, total = ?, updated_at = datetime('now','localtime') WHERE id = ?`)
      .run(String(data.vendor || '').slice(0, 200), String(data.invoice_number || '').slice(0, 100), date,
        data.subtotal == null ? null : round2(data.subtotal), data.tax == null ? null : round2(data.tax),
        data.shipping == null ? null : round2(data.shipping), data.total == null ? null : round2(data.total), id);
  });

  const fresh = db.prepare('SELECT * FROM purchase_invoices WHERE id = ?').get(id);
  if (fresh.status !== 'processing') return;
  const reason = autoReceiveBlocker(db, fresh);
  if (reason) {
    db.prepare(`UPDATE purchase_invoices SET status = 'needs review', review_note = ? WHERE id = ?`).run(reason, id);
  } else {
    receive(db, id, { name: 'auto-receive' }, { auto: true });
  }
}

/** Returns why an invoice can't be received automatically, or null if it can. */
export function autoReceiveBlocker(db, inv) {
  const s = getSettings(db);
  const lines = db.prepare('SELECT * FROM purchase_invoice_lines WHERE purchase_invoice_id = ?').all(inv.id);
  if (s.auto_receive !== '1') return 'Automatic receiving is turned off. Check the lines and click Receive.';
  if (!lines.length) return 'No line items were found.';
  const unmatched = lines.filter(l => !l.item_id || !['part #', 'distributor part #', 'name'].includes(l.match));
  if (unmatched.length) return `${unmatched.length} line(s) need to be matched to an inventory item.`;
  if (inv.source === 'email' && !senderTrusted(s, inv.from_email)) return `Sender ${inv.from_email || '(unknown)'} isn't on your trusted distributor list.`;
  const dup = findDuplicate(db, inv);
  if (dup) return `Possible duplicate of supplier invoice #${dup.id} (${dup.vendor} ${dup.invoice_number}), which was already received.`;
  const lineSum = lines.reduce((t, l) => t + l.qty * (l.unit_cost || 0), 0);
  if (inv.subtotal != null && Math.abs(lineSum - inv.subtotal) > Math.max(1, inv.subtotal * 0.01)) {
    return `Line items add up to $${lineSum.toFixed(2)} but the invoice subtotal says $${inv.subtotal.toFixed(2)}. Check that every line was read.`;
  }
  return null;
}

function findDuplicate(db, inv) {
  if (!inv.invoice_number) return null;
  return db.prepare(`SELECT id, vendor, invoice_number FROM purchase_invoices WHERE id <> ? AND status = 'received'
    AND lower(invoice_number) = lower(?) AND lower(COALESCE(vendor,'')) = lower(COALESCE(?, ''))`).get(inv.id, inv.invoice_number, inv.vendor || '');
}

/** Put every matched line into stock, update costs, learn part numbers, and log the expense. */
export function receive(db, id, user, { record_expense = true, allowDuplicate = false, auto = false } = {}) {
  return tx(db, () => {
    const inv = db.prepare('SELECT * FROM purchase_invoices WHERE id = ?').get(id);
    if (!inv) throw new HttpError(404, 'Not found');
    if (inv.status === 'received') throw new HttpError(409, 'This invoice was already received');
    if (inv.status === 'processing' && !auto) throw new HttpError(409, 'Still reading this invoice — try again in a moment');
    const dup = findDuplicate(db, inv);
    if (dup && !allowDuplicate) throw new HttpError(409, `Supplier invoice #${dup.id} with the same vendor and invoice number was already received`);
    const s = getSettings(db);
    const lines = db.prepare('SELECT * FROM purchase_invoice_lines WHERE purchase_invoice_id = ?').all(id);
    const todo = lines.filter(l => l.item_id && l.match !== 'skip' && l.qty > 0);
    if (!todo.length) throw new HttpError(400, 'Match at least one line to an inventory item (or mark lines as skipped)');
    const open = lines.filter(l => !l.item_id && l.match !== 'skip');
    if (open.length) throw new HttpError(400, `${open.length} line(s) still need an inventory item, or mark them "skip"`);
    const loc = Number(inv.location_id) || 0;
    const label = `${inv.vendor || 'Supplier'} invoice ${inv.invoice_number || '#' + inv.id}`;
    for (const l of todo) {
      adjustStock(db, { itemId: l.item_id, locationId: loc, delta: l.qty, kind: 'received', note: label, userId: user?.id });
      if (s.receiving_update_costs === '1' && l.unit_cost > 0) {
        db.prepare('UPDATE inventory_items SET unit_cost = ? WHERE id = ?').run(l.unit_cost, l.item_id);
      }
      // Learn the distributor's part number so next time it matches on its own.
      const item = db.prepare('SELECT sku, vendor_skus FROM inventory_items WHERE id = ?').get(l.item_id);
      const n = normSku(l.line_sku);
      if (n && normSku(item.sku) !== n && !String(item.vendor_skus || '').split(',').some(a => normSku(a) === n)) {
        const list = [...String(item.vendor_skus || '').split(',').map(x => x.trim()).filter(Boolean), l.line_sku.trim()];
        db.prepare('UPDATE inventory_items SET vendor_skus = ? WHERE id = ?').run(list.join(', '), l.item_id);
      }
    }
    let expenseId = null;
    if (record_expense) {
      const lineSum = round2(lines.filter(l => l.match !== 'skip').reduce((t, l) => t + l.qty * (l.unit_cost || 0), 0));
      const amount = inv.total > 0 ? inv.total : round2(lineSum + (inv.tax || 0) + (inv.shipping || 0));
      if (amount > 0) {
        const exp = create(db, 'expenses', {
          date: inv.invoice_date || todayLocal(), category: 'Parts & equipment', vendor: inv.vendor || '',
          description: `${label} (${todo.length} line${todo.length === 1 ? '' : 's'})`, amount, payment_method: 'other',
          notes: `Supplier invoice #${inv.id}`,
        }, user?.role ? user : { id: null, name: user?.name || 'auto-receive', role: 'admin' });
        expenseId = exp.id;
      }
    }
    db.prepare(`UPDATE purchase_invoices SET status = 'received', received_at = ?, expense_id = ?, review_note = NULL, updated_at = datetime('now','localtime') WHERE id = ?`)
      .run(nowLocal(), expenseId, id);
    audit(db, user, 'receive supplier invoice', 'purchase_invoices', id, `${todo.length} lines into ${loc ? 'vehicle ' + loc : 'warehouse'}`);
    return { ok: true, lines: todo.length, expense_id: expenseId };
  });
}

/** Save edits from the review screen: header fields plus each line's qty/cost/match. */
export function saveReview(db, id, body, user) {
  return tx(db, () => {
    const inv = db.prepare('SELECT * FROM purchase_invoices WHERE id = ?').get(id);
    if (!inv) throw new HttpError(404, 'Not found');
    if (inv.status === 'received') throw new HttpError(409, 'Already received; changes are locked');
    const str = (v, n = 200) => v == null ? null : String(v).trim().slice(0, n);
    const num = v => v === '' || v == null ? null : (Number.isFinite(Number(v)) ? round2(v) : null);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(body.invoice_date || '') ? body.invoice_date : null;
    const loc = Number(body.location_id) || 0;
    if (loc && !db.prepare('SELECT 1 FROM vehicles WHERE id = ?').get(loc)) throw new HttpError(400, 'Vehicle not found');
    db.prepare(`UPDATE purchase_invoices SET vendor = ?, invoice_number = ?, invoice_date = ?, location_id = ?, subtotal = ?, tax = ?, shipping = ?, total = ?, notes = ?,
      status = CASE WHEN status IN ('error','rejected') THEN 'needs review' ELSE status END, updated_at = datetime('now','localtime') WHERE id = ?`)
      .run(str(body.vendor), str(body.invoice_number, 100), date, loc, num(body.subtotal), num(body.tax), num(body.shipping), num(body.total), str(body.notes, 5000), id);
    if (Array.isArray(body.lines)) {
      const keep = new Set();
      for (const l of body.lines) {
        const qty = Number(l.qty);
        if (!(qty > 0)) throw new HttpError(400, 'Every line needs a quantity greater than zero');
        const itemId = l.item_id ? Number(l.item_id) : null;
        if (itemId && !db.prepare('SELECT 1 FROM inventory_items WHERE id = ?').get(itemId)) throw new HttpError(400, 'Inventory item not found');
        const prev = l.id ? db.prepare('SELECT * FROM purchase_invoice_lines WHERE id = ? AND purchase_invoice_id = ?').get(Number(l.id), id) : null;
        const match = l.skip ? 'skip' : !itemId ? 'none' : prev && prev.item_id === itemId ? (prev.match === 'skip' || prev.match === 'none' ? 'manual' : prev.match) : 'manual';
        if (prev) {
          db.prepare('UPDATE purchase_invoice_lines SET line_sku = ?, description = ?, qty = ?, unit_cost = ?, item_id = ?, match = ? WHERE id = ?')
            .run(str(l.line_sku, 100) || '', str(l.description, 500) || '', qty, num(l.unit_cost) ?? 0, itemId, match, prev.id);
          keep.add(prev.id);
        } else {
          const info = db.prepare('INSERT INTO purchase_invoice_lines (purchase_invoice_id, line_sku, description, qty, unit_cost, item_id, match) VALUES (?,?,?,?,?,?,?)')
            .run(id, str(l.line_sku, 100) || '', str(l.description, 500) || '', qty, num(l.unit_cost) ?? 0, itemId, match);
          keep.add(Number(info.lastInsertRowid));
        }
      }
      for (const old of db.prepare('SELECT id FROM purchase_invoice_lines WHERE purchase_invoice_id = ?').all(id)) {
        if (!keep.has(old.id)) db.prepare('DELETE FROM purchase_invoice_lines WHERE id = ?').run(old.id);
      }
    }
    audit(db, user, 'update', 'purchase_invoices', id, 'review');
    return { ok: true };
  });
}

/** Parse an inbound-email webhook body. Supports Postmark's JSON and a simple generic JSON shape. */
export function parseInboundEmail(body) {
  if (body.FromFull || body.From || body.Attachments) {
    return {
      fromEmail: body.FromFull?.Email || String(body.From || '').match(/[^<\s]+@[^>\s]+/)?.[0] || '',
      subject: body.Subject || '',
      bodyText: body.TextBody || body.StrippedTextReply || '',
      files: (body.Attachments || []).map(a => ({ name: a.Name, type: a.ContentType, data: a.Content })),
    };
  }
  return {
    fromEmail: String(body.from || '').match(/[^<\s]+@[^>\s]+/)?.[0] || '',
    subject: body.subject || '',
    bodyText: body.text || '',
    files: (body.attachments || []).map(a => ({ name: a.filename || a.name, type: a.contentType || a.type, data: a.content || a.data })),
  };
}
