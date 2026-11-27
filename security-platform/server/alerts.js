// Alerts for the owner / office: inventory variances, missed truck counts, clock-ins away
// from the office, techs short on equipment. Shown on the dashboard and (optionally)
// emailed/texted to the owner right away.
import { getSettings } from './db.js';
import { queue, sendEmail, sendSms, appUrl } from './notify.js';

/**
 * @param {object} a  { kind, title, body, link, severity: 'info'|'warn'|'bad', roles: 'owner,admin', notify: true,
 *                      dedupeHours: skip if the same kind+link was raised this recently }
 */
export function raiseAlert(db, a) {
  if (a.dedupeHours) {
    const dup = db.prepare(`SELECT id FROM alerts WHERE kind = ? AND COALESCE(link,'') = ? AND created_at > datetime('now','localtime', ?)`)
      .get(a.kind, a.link || '', `-${Number(a.dedupeHours)} hours`);
    if (dup) return dup.id;
  }
  const id = Number(db.prepare('INSERT INTO alerts (kind, severity, title, body, link, roles) VALUES (?,?,?,?,?,?)')
    .run(a.kind, a.severity || 'warn', a.title, a.body || null, a.link || null, a.roles || 'owner,admin').lastInsertRowid);
  if (a.notify !== false) queue(() => deliver(db, id, a));
  return id;
}

async function deliver(db, id, a) {
  const s = getSettings(db);
  const link = a.link ? `${appUrl(db)}/${a.link}` : appUrl(db);
  const text = `${a.title}${a.body ? `\n\n${a.body}` : ''}${link ? `\n\n${link}` : ''}`;
  const related = { type: 'alert', id };
  const roles = String(a.roles || 'owner,admin').split(',');
  // Owners always; admins only if the alert is for them and it's not owner-only.
  const people = db.prepare(`SELECT name, email, role FROM users WHERE active = 1 AND role IN (${roles.map(() => '?').join(',')})`).all(...roles);
  const extra = a.alsoUserIds?.length
    ? db.prepare(`SELECT name, email, role FROM users WHERE active = 1 AND id IN (${a.alsoUserIds.map(() => '?').join(',')})`).all(...a.alsoUserIds) : [];
  const emails = [...new Set([...people, ...extra].filter(p => p.role === 'owner' || a.emailAll || extra.includes(p)).map(p => p.email).filter(Boolean))];
  if (s.alert_email === '1') for (const to of emails) await sendEmail(db, { to, subject: `[${s.company_name || 'SecureOps'}] ${a.title}`, text, related });
  if (s.alert_sms === '1' && s.alert_phone && a.severity !== 'info') await sendSms(db, { to: s.alert_phone, body: `${a.title}${a.body ? ` — ${a.body}` : ''}`.slice(0, 300), related });
}

export function openAlerts(db, role, limit = 50) {
  return db.prepare(`SELECT * FROM alerts WHERE resolved_at IS NULL AND (',' || roles || ',') LIKE ? ORDER BY id DESC LIMIT ?`).all(`%,${role},%`, limit);
}

export function resolveAlert(db, id, user) {
  db.prepare("UPDATE alerts SET resolved_at = datetime('now','localtime'), resolved_by = ? WHERE id = ? AND resolved_at IS NULL").run(user.name, Number(id));
}
