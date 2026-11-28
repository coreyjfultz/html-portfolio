// Who reports to whom. Each person can have a supervisor; supervisors approve time off for the
// people under them (directly or further down), and see their team's tasks. Owners and admins
// can still do everything.
import { G } from '../public/js/schema.js';
import { HttpError } from './resources.js';
import { onlineUserIds } from './chat.js';

const MANAGE = G.manage;

/** Everyone below this person (their reports, their reports' reports, …). */
export function reportIds(db, uid) {
  return db.prepare(`WITH RECURSIVE t(id, depth) AS (
      SELECT id, 1 FROM users WHERE supervisor_id = ? AND active = 1
      UNION SELECT u.id, t.depth + 1 FROM users u JOIN t ON u.supervisor_id = t.id WHERE u.active = 1 AND t.depth < 20)
    SELECT DISTINCT id FROM t`).all(uid).map(r => r.id);
}
export const isAbove = (db, uid, target) => !!target && target !== uid && reportIds(db, uid).includes(target);

/** The direct supervisor (if active). */
export function supervisorOf(db, uid) {
  return db.prepare(`SELECT s.id, s.name, s.email, s.job_title, s.role FROM users u JOIN users s ON s.id = u.supervisor_id
    WHERE u.id = ? AND s.active = 1`).get(uid) || null;
}

/** Can `user` approve/deny time off for `targetId`? Your own requests go up the chain (owners excepted). */
export function canApprove(db, user, targetId) {
  if (targetId === user.id) return user.role === 'owner';
  return MANAGE.includes(user.role) || isAbove(db, user.id, targetId);
}

/** Setting someone's supervisor: must be an active person, and not themselves or someone under them. */
export function checkSupervisor(db, userId, supervisorId) {
  if (!supervisorId) return null;
  const sid = Number(supervisorId);
  if (sid === userId) throw new HttpError(400, 'Someone can’t be their own supervisor');
  if (!db.prepare('SELECT 1 FROM users WHERE id = ? AND active = 1').get(sid)) throw new HttpError(400, 'Choose an active person as supervisor');
  if (userId && reportIds(db, userId).includes(sid)) throw new HttpError(400, 'That person reports to them already (directly or further down), so they can’t be their supervisor');
  return sid;
}

export function registerOrgRoutes(r) {
  // The org chart: everyone can see names, titles and who reports to whom.
  r('GET', '/api/org', G.all, ({ db }) => {
    const on = new Set(onlineUserIds());
    const out = new Set(db.prepare(`SELECT DISTINCT user_id FROM time_off WHERE status = 'approved'
      AND starts_at <= strftime('%Y-%m-%dT%H:%M','now','localtime') AND ends_at >= strftime('%Y-%m-%dT%H:%M','now','localtime')`).all().map(x => x.user_id));
    return db.prepare(`SELECT id, name, role, job_title, supervisor_id, technician_id FROM users WHERE active = 1 ORDER BY name`).all()
      .map(u => ({ ...u, online: on.has(u.id), out_today: out.has(u.id) }));
  });
  // My place in it: who I report to, who reports to me, and requests waiting for me.
  r('GET', '/api/org/me', G.all, ({ db, user }) => {
    const team = reportIds(db, user.id);
    const direct = db.prepare('SELECT id, name, role, job_title FROM users WHERE supervisor_id = ? AND active = 1 ORDER BY name').all(user.id);
    const pendingIds = MANAGE.includes(user.role)
      ? db.prepare("SELECT id FROM time_off WHERE status = 'pending' AND user_id <> ?").all(user.id).map(x => x.id)
      : team.length ? db.prepare(`SELECT id FROM time_off WHERE status = 'pending' AND user_id IN (${team.map(() => '?').join(',')})`).all(...team).map(x => x.id) : [];
    return { supervisor: supervisorOf(db, user.id), direct_reports: direct, team_ids: team, is_supervisor: team.length > 0, pending_time_off: pendingIds.length };
  });
}
