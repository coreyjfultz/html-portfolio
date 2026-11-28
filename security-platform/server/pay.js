// Optional "Pay & benefits" add-on (Settings → HR & time off → turn on).
// Employees get one place for: a link to the payroll provider's employee site (QuickBooks
// Workforce by default — pay stubs, W-2s, direct deposit and tax withholding live there),
// the company's benefit plans, and private documents the office posts for them.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { G } from '../public/js/schema.js';
import { getSettings, DATA_DIR } from './db.js';
import { HttpError } from './resources.js';
import { audit } from './security.js';

// Pay documents are seen only by the person, the owner and accounting.
const PAY_ADMIN = G.payAdmin;
const DIR = path.join(DATA_DIR, 'hrdocs');
export const PROVIDERS = {
  quickbooks: { label: 'QuickBooks Workforce', url: 'https://workforce.intuit.com' },
  gusto: { label: 'Gusto', url: 'https://app.gusto.com/login' },
  adp: { label: 'ADP', url: 'https://my.adp.com' },
  paychex: { label: 'Paychex Flex', url: 'https://myapps.paychex.com' },
  other: { label: 'Payroll site', url: '' },
};
export const DOC_KINDS = ['pay stub', 'W-2', 'benefits', 'tax form', 'other'];

const enabled = db => getSettings(db).addon_pay === '1';
const need = db => { if (!enabled(db)) throw new HttpError(404, 'Pay & benefits isn’t turned on'); };

function detect(buf) {
  if (buf.subarray(0, 5).toString() === '%PDF-') return { type: 'application/pdf', ext: '.pdf' };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { type: 'image/jpeg', ext: '.jpg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { type: 'image/png', ext: '.png' };
  return null;
}

export function registerPayRoutes(r) {
  r('GET', '/api/pay/config', G.all, ({ db, user }) => {
    const s = getSettings(db);
    if (!enabled(db)) return { enabled: false };
    const p = PROVIDERS[s.payroll_provider] || PROVIDERS.quickbooks;
    return {
      enabled: true, provider: s.payroll_provider || 'quickbooks', provider_label: s.payroll_provider === 'other' && s.payroll_label ? s.payroll_label : p.label,
      portal_url: s.payroll_portal_url || p.url, contact: s.payroll_contact || '', note: s.payroll_note || '',
      can_manage: PAY_ADMIN.includes(user.role),
    };
  });
  r('GET', '/api/pay/people', PAY_ADMIN, ({ db }) => { need(db); return db.prepare('SELECT id, name, role, active FROM users WHERE active = 1 ORDER BY name').all(); });
  r('GET', '/api/pay/documents', G.all, ({ db, user, query }) => {
    need(db);
    const all = PAY_ADMIN.includes(user.role) && query.mine !== '1';
    const uid = all && query.user_id ? Number(query.user_id) : all ? null : user.id;
    return db.prepare(`SELECT d.id, d.user_id, u.name AS user_name, d.kind, d.title, d.period, d.file_name, d.size, d.uploaded_by, d.created_at, d.viewed_at
      FROM employee_documents d JOIN users u ON u.id = d.user_id ${uid ? 'WHERE d.user_id = ?' : ''} ORDER BY COALESCE(d.period, d.created_at) DESC, d.id DESC LIMIT 500`).all(...(uid ? [uid] : []));
  });
  r('POST', '/api/pay/documents', PAY_ADMIN, ({ db, user, body }) => {
    need(db);
    const target = db.prepare('SELECT id, name FROM users WHERE id = ?').get(Number(body.user_id));
    if (!target) throw new HttpError(400, 'Choose the employee');
    const buf = Buffer.from(String(body.data || '').replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (!buf.length) throw new HttpError(400, 'Choose a file');
    if (buf.length > 15 * 1024 * 1024) throw new HttpError(413, 'Files can be up to 15 MB');
    const kind = detect(buf);
    if (!kind) throw new HttpError(400, 'Upload a PDF, JPG or PNG');
    fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
    const key = crypto.randomBytes(16).toString('hex') + kind.ext;
    fs.writeFileSync(path.join(DIR, key), buf, { mode: 0o600 });
    const id = Number(db.prepare('INSERT INTO employee_documents (user_id, kind, title, period, file_key, file_name, content_type, size, uploaded_by) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(target.id, DOC_KINDS.includes(body.kind) ? body.kind : 'other', String(body.title || body.file_name || 'Document').slice(0, 120),
        /^\d{4}-\d{2}-\d{2}$/.test(body.period || '') ? body.period : null, key, String(body.file_name || '').slice(0, 120) || null, kind.type, buf.length, user.name).lastInsertRowid);
    audit(db, user, 'post employee document', 'users', target.id, `${body.kind || 'other'}: ${body.title || ''}`);
    return { id };
  });
  r('GET', '/api/pay/documents/:id/file', G.all, ({ db, user, params, res }) => {
    need(db);
    const d = db.prepare('SELECT * FROM employee_documents WHERE id = ?').get(Number(params.id));
    if (!d || (d.user_id !== user.id && !PAY_ADMIN.includes(user.role))) throw new HttpError(404, 'Not found');
    if (d.user_id === user.id && !d.viewed_at) db.prepare("UPDATE employee_documents SET viewed_at = datetime('now','localtime') WHERE id = ?").run(d.id);
    if (d.user_id !== user.id) audit(db, user, 'view employee document', 'users', d.user_id, d.title);
    const p = path.join(DIR, path.basename(d.file_key));
    if (!fs.existsSync(p)) throw new HttpError(404, 'File missing');
    res.writeHead(200, { 'Content-Type': d.content_type, 'Content-Disposition': `inline; filename="${(d.file_name || 'document').replace(/[^\w. -]/g, '_')}"`, 'Cache-Control': 'private, no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; object-src 'self'", 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(p).pipe(res);
    return undefined;
  });
  r('DELETE', '/api/pay/documents/:id', PAY_ADMIN, ({ db, user, params }) => {
    need(db);
    const d = db.prepare('SELECT * FROM employee_documents WHERE id = ?').get(Number(params.id));
    if (!d) throw new HttpError(404, 'Not found');
    db.prepare('DELETE FROM employee_documents WHERE id = ?').run(d.id);
    fs.rmSync(path.join(DIR, path.basename(d.file_key)), { force: true });
    audit(db, user, 'remove employee document', 'users', d.user_id, d.title);
    return { ok: true };
  });
}
