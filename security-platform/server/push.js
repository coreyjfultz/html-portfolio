// Web Push (phone / computer notifications) with VAPID. Pushes carry no data: the app's
// service worker wakes up, asks the server what's new, and shows the notification. That keeps
// message text off the push services and avoids payload encryption entirely.
import crypto from 'node:crypto';
import { G } from '../public/js/schema.js';
import { getSettings } from './db.js';
import { HttpError } from './resources.js';
import { encrypt, decrypt } from './security.js';

// Only the browsers' real push services, so this can never be used to make the server call
// arbitrary addresses.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /\.notify\.windows\.com$/];
const allowedEndpoint = url => {
  try {
    const u = new URL(url);
    if (process.env.PUSH_ALLOW_ANY === '1') return ['https:', 'http:'].includes(u.protocol); // tests
    return u.protocol === 'https:' && PUSH_HOSTS.some(re => re.test(u.hostname));
  } catch { return false; }
};
const b64u = b => Buffer.from(b).toString('base64url');

/** The server's VAPID key pair, created once and kept (private half encrypted) in settings. */
export function vapidKeys(db) {
  const s = getSettings(db);
  if (s.vapid_public && s.vapid_private) return { publicKey: s.vapid_public, privateJwk: JSON.parse(decrypt(s.vapid_private)) };
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const raw = b64u(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]));
  const priv = privateKey.export({ format: 'jwk' });
  const up = db.prepare('INSERT INTO settings(key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  up.run('vapid_public', raw);
  up.run('vapid_private', encrypt(JSON.stringify(priv)));
  return { publicKey: raw, privateJwk: priv };
}

function vapidHeader(db, endpoint) {
  const { publicKey, privateJwk } = vapidKeys(db);
  const s = getSettings(db);
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: s.public_url?.startsWith('https://') ? s.public_url : 'mailto:notifications@secureops.invalid' }));
  const key = crypto.createPrivateKey({ key: privateJwk, format: 'jwk' });
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${publicKey}`;
}

/** Wake up the given users' devices. Failures are quiet; dead subscriptions are removed. */
// `note` (optional) is what the phone should show; the service worker fetches it after the
// (empty) push arrives. Without a note the push is treated as a chat message.
export function notifyPush(db, userIds, note) {
  if (!userIds?.length) return;
  if (note) {
    const ins = db.prepare('INSERT INTO push_notes (user_id, title, body, url, tag) VALUES (?,?,?,?,?)');
    for (const uid of userIds) ins.run(uid, String(note.title).slice(0, 120), String(note.body || '').slice(0, 240), note.url || '/', note.tag || null);
  }
  const subs = db.prepare(`SELECT * FROM push_subscriptions WHERE user_id IN (${userIds.map(() => '?').join(',')})`).all(...userIds);
  for (const sub of subs) {
    if (!allowedEndpoint(sub.endpoint)) continue;
    let auth;
    try { auth = vapidHeader(db, sub.endpoint); } catch (e) { console.error('push', e.message); return; }
    fetch(sub.endpoint, { method: 'POST', headers: { Authorization: auth, TTL: '86400', Urgency: 'high', 'Content-Length': '0' } })
      .then(res => { if (res.status === 404 || res.status === 410) db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id); })
      .catch(() => {});
  }
}

export function registerPushRoutes(r) {
  // The newest note from the last 10 minutes that hasn't been shown yet.
  r('GET', '/api/push/latest', G.all, ({ db, user }) => {
    const n = db.prepare("SELECT id, title, body, url, tag FROM push_notes WHERE user_id = ? AND shown = 0 AND created_at >= datetime('now','localtime','-10 minutes') ORDER BY id DESC LIMIT 1").get(user.id);
    if (n) db.prepare('UPDATE push_notes SET shown = 1 WHERE id = ?').run(n.id);
    db.prepare("DELETE FROM push_notes WHERE created_at < datetime('now','localtime','-30 days')").run();
    return n || null;
  });
  r('GET', '/api/push/key', G.all, ({ db }) => ({ key: vapidKeys(db).publicKey }));
  r('POST', '/api/push/subscribe', G.all, ({ db, user, body }) => {
    const endpoint = String(body.endpoint || '');
    if (!allowedEndpoint(endpoint)) throw new HttpError(400, 'This browser’s notification service isn’t supported');
    db.prepare(`INSERT INTO push_subscriptions (user_id, endpoint, user_agent) VALUES (?,?,?)
      ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, user_agent = excluded.user_agent`).run(user.id, endpoint, String(body.user_agent || '').slice(0, 200));
    return { ok: true };
  });
  r('DELETE', '/api/push/subscribe', G.all, ({ db, user, query }) => {
    db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(user.id, String(query.endpoint || ''));
    return { ok: true };
  });
}
