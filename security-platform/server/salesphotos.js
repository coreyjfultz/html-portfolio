// Photos for sales: a picture on each inventory item (shown on proposals if wanted), and
// site-survey photos — taken by whoever is putting a quote together, marked up to show where
// things go, with a title and notes — kept on the customer and optionally shown on a proposal.
import { G } from '../public/js/schema.js';
import { HttpError, assertCustomerVisible, registerHooks, todayLocal } from './resources.js';
import { decodeImage, saveImage, removeImage, sendImage } from './media.js';
import { audit } from './security.js';

const SALES_READ = G.salesOrBilling;
const SALES_WRITE = G.sales;
const signedProposal = (db, id) => id ? db.prepare("SELECT status FROM proposals WHERE id = ?").get(id)?.status === 'signed' : false;

// Recurring charges: the first billing month must look like 2026-03; blank = this month.
registerHooks('recurring_charges', {
  beforeSave(db, data, { existing }) {
    if ('start_month' in data) {
      const v = String(data.start_month || '').trim();
      if (v && !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) throw new HttpError(400, 'Enter the first billing month like 2026-03');
      data.start_month = v || null;
    }
    const m = { ...existing, ...data };
    if (!m.start_month) data.start_month = todayLocal().slice(0, 7);
  },
});

// Removing an inventory item removes its photo file too.
registerHooks('inventory_items', { afterDelete(db, row) { removeImage('photos', row.photo_key); } });

function surveyRow(db, id) {
  const r = db.prepare('SELECT * FROM survey_photos WHERE id = ?').get(Number(id));
  if (!r) throw new HttpError(404, 'Photo not found');
  return r;
}
const view = r => ({ id: r.id, customer_id: r.customer_id, site_id: r.site_id, proposal_id: r.proposal_id, title: r.title, note: r.note, show_on_proposal: !!r.show_on_proposal,
  sort: r.sort, created_by: r.created_by, created_at: r.created_at, updated_at: r.updated_at, url: `/api/survey-photos/${r.id}/image?v=${encodeURIComponent(r.photo_key)}` });

/** Survey photos shown on a proposal document (in order). */
export function proposalSurveyPhotos(db, proposalId) {
  return db.prepare('SELECT id, title, note FROM survey_photos WHERE proposal_id = ? AND show_on_proposal = 1 ORDER BY sort, id').all(proposalId);
}

export function registerSalesPhotoRoutes(r) {
  // ---- Product photos (one per inventory item)
  r('POST', '/api/inventory/:id/photo', G.billing, ({ db, user, params, body }) => {
    const it = db.prepare('SELECT id, name, photo_key FROM inventory_items WHERE id = ?').get(Number(params.id));
    if (!it) throw new HttpError(404, 'Item not found');
    const key = saveImage('photos', decodeImage(body.photo, { maxBytes: 8 * 1024 * 1024 }));
    db.prepare("UPDATE inventory_items SET photo_key = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(key, it.id);
    removeImage('photos', it.photo_key);
    audit(db, user, 'item photo', 'inventory_items', it.id, it.name);
    return { ok: true, photo_key: key };
  });
  r('DELETE', '/api/inventory/:id/photo', G.billing, ({ db, params }) => {
    const it = db.prepare('SELECT id, photo_key FROM inventory_items WHERE id = ?').get(Number(params.id));
    if (!it) throw new HttpError(404, 'Item not found');
    removeImage('photos', it.photo_key);
    db.prepare('UPDATE inventory_items SET photo_key = NULL WHERE id = ?').run(it.id);
    return { ok: true };
  });
  r('GET', '/api/inventory/:id/photo', G.all, ({ db, params, res }) => {
    const it = db.prepare('SELECT photo_key FROM inventory_items WHERE id = ?').get(Number(params.id));
    if (!it?.photo_key) throw new HttpError(404, 'No photo');
    sendImage(res, 'photos', it.photo_key);
    return undefined;
  });

  // ---- Site survey photos (on the customer; optionally shown on one proposal)
  r('GET', '/api/customers/:id/survey-photos', SALES_READ, ({ db, user, params, query }) => {
    assertCustomerVisible(db, user, Number(params.id));
    const where = ['customer_id = ?']; const args = [Number(params.id)];
    if (query.proposal_id) { where.push('(proposal_id = ? OR proposal_id IS NULL)'); args.push(Number(query.proposal_id)); }
    return db.prepare(`SELECT * FROM survey_photos WHERE ${where.join(' AND ')} ORDER BY sort, id`).all(...args).map(view);
  });
  r('POST', '/api/customers/:id/survey-photos', SALES_WRITE, ({ db, user, params, body }) => {
    const c = db.prepare('SELECT id FROM customers WHERE id = ?').get(Number(params.id));
    if (!c) throw new HttpError(404, 'Customer not found');
    const pid = body.proposal_id ? Number(body.proposal_id) : null;
    if (pid && !db.prepare('SELECT 1 FROM proposals WHERE id = ? AND customer_id = ?').get(pid, c.id)) throw new HttpError(400, 'That proposal is for another customer');
    if (signedProposal(db, pid)) throw new HttpError(409, 'That proposal is signed; photos on it can’t change');
    const key = saveImage('photos', decodeImage(body.photo, { maxBytes: 10 * 1024 * 1024 }));
    const sort = (db.prepare('SELECT MAX(sort) AS m FROM survey_photos WHERE customer_id = ?').get(c.id).m || 0) + 1;
    const id = Number(db.prepare(`INSERT INTO survey_photos (customer_id, site_id, proposal_id, photo_key, title, note, show_on_proposal, sort, created_by)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(c.id, body.site_id ? Number(body.site_id) : null, pid, key, String(body.title || '').trim().slice(0, 120) || null,
      String(body.note || '').trim().slice(0, 2000) || null, pid && body.show_on_proposal !== false ? 1 : 0, sort, user.name).lastInsertRowid);
    return view(surveyRow(db, id));
  });
  r('PUT', '/api/survey-photos/:id', SALES_WRITE, ({ db, params, body }) => {
    const p = surveyRow(db, params.id);
    if (signedProposal(db, p.proposal_id) && p.show_on_proposal) throw new HttpError(409, 'This photo is part of a signed proposal and can’t change');
    const pid = 'proposal_id' in body ? (body.proposal_id ? Number(body.proposal_id) : null) : p.proposal_id;
    if (pid && !db.prepare('SELECT 1 FROM proposals WHERE id = ? AND customer_id = ?').get(pid, p.customer_id)) throw new HttpError(400, 'That proposal is for another customer');
    if (pid !== p.proposal_id && signedProposal(db, pid)) throw new HttpError(409, 'That proposal is signed; photos on it can’t change');
    let key = p.photo_key;
    if (body.photo) { key = saveImage('photos', decodeImage(body.photo, { maxBytes: 10 * 1024 * 1024 })); removeImage('photos', p.photo_key); }
    db.prepare(`UPDATE survey_photos SET title = ?, note = ?, site_id = ?, proposal_id = ?, show_on_proposal = ?, sort = ?, photo_key = ?, updated_at = datetime('now','localtime') WHERE id = ?`).run(
      'title' in body ? String(body.title || '').trim().slice(0, 120) || null : p.title,
      'note' in body ? String(body.note || '').trim().slice(0, 2000) || null : p.note,
      'site_id' in body ? (body.site_id ? Number(body.site_id) : null) : p.site_id,
      pid, 'show_on_proposal' in body ? (body.show_on_proposal && pid ? 1 : 0) : (pid ? p.show_on_proposal : 0),
      'sort' in body ? Number(body.sort) || 0 : p.sort, key, p.id);
    return view(surveyRow(db, p.id));
  });
  r('DELETE', '/api/survey-photos/:id', SALES_WRITE, ({ db, params }) => {
    const p = surveyRow(db, params.id);
    if (signedProposal(db, p.proposal_id) && p.show_on_proposal) throw new HttpError(409, 'This photo is part of a signed proposal and can’t be deleted');
    db.prepare('DELETE FROM survey_photos WHERE id = ?').run(p.id);
    removeImage('photos', p.photo_key);
    return { ok: true };
  });
  r('GET', '/api/survey-photos/:id/image', SALES_READ, ({ db, user, params, res }) => {
    const p = surveyRow(db, params.id);
    assertCustomerVisible(db, user, p.customer_id);
    sendImage(res, 'photos', p.photo_key);
    return undefined;
  });

  // ---- Photos on proposal documents (staff preview)
  r('GET', '/api/proposals/:id/item-photo/:itemId', SALES_READ, ({ db, params, res }) => sendProposalItemPhoto(db, Number(params.id), params.itemId, res));
  r('GET', '/api/proposals/:id/survey-photo/:photoId', SALES_READ, ({ db, params, res }) => sendProposalSurveyPhoto(db, Number(params.id), params.photoId, res));
}

// Only photos that are actually on that proposal can be fetched through it.
export function sendProposalItemPhoto(db, proposalId, itemId, res) {
  const it = db.prepare(`SELECT i.photo_key FROM proposal_items pi JOIN inventory_items i ON i.id = pi.item_id JOIN proposals p ON p.id = pi.proposal_id
    WHERE pi.proposal_id = ? AND pi.item_id = ? AND p.show_item_photos = 1`).get(proposalId, Number(itemId));
  if (!it?.photo_key) throw new HttpError(404, 'No photo');
  sendImage(res, 'photos', it.photo_key, { cache: 'private, max-age=3600' });
  return undefined;
}
export function sendProposalSurveyPhoto(db, proposalId, photoId, res) {
  const p = db.prepare('SELECT photo_key FROM survey_photos WHERE id = ? AND proposal_id = ? AND show_on_proposal = 1').get(Number(photoId), proposalId);
  if (!p) throw new HttpError(404, 'No photo');
  sendImage(res, 'photos', p.photo_key, { cache: 'private, max-age=3600' });
  return undefined;
}
