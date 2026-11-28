// In-app calls between team members: voice over the internet, phone to phone or computer,
// no phone numbers. The browsers talk to each other directly (WebRTC); this server only
// rings the other person and passes the connection details along (over the chat stream).
//
// Most of the time two devices can reach each other directly. Some cell networks and office
// firewalls block that, and then the call needs a relay ("TURN") server:
//   - Twilio (uses the Twilio account already set up for texts/phone; pay per use), or
//   - your own relay (coturn) next to the app — see deploy/GO-LIVE.md.
import crypto from 'node:crypto';
import { G } from '../public/js/schema.js';
import { getSettings } from './db.js';
import { decrypt } from './security.js';
import { HttpError } from './resources.js';
import { publish, isOnline, directChannel, logInChat } from './chat.js';
import { notifyPush } from './push.js';
import { smsConfig } from './notify.js';

const RING_SECONDS = Number(process.env.CALL_RING_SECONDS) || 35;
const LIVE = ['ringing', 'active'];
const timers = new Map(); // call id -> ring timeout

const enabled = db => getSettings(db).app_calls_enabled !== '0';
const getCall = (db, id) => db.prepare(`SELECT c.*, a.name AS caller_name, b.name AS callee_name FROM app_calls c
  JOIN users a ON a.id = c.caller_id JOIN users b ON b.id = c.callee_id WHERE c.id = ?`).get(Number(id));
const view = c => ({ id: c.id, status: c.status, caller_id: c.caller_id, caller_name: c.caller_name, callee_id: c.callee_id, callee_name: c.callee_name, created_at: c.created_at, answered_at: c.answered_at, ended_at: c.ended_at, end_reason: c.end_reason });
const tell = (c, action, extra = {}) => publish([c.caller_id, c.callee_id], { type: 'call', action, call: view(c), ...extra });
const mmss = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

function finish(db, c, status, reason, by) {
  clearTimeout(timers.get(c.id)); timers.delete(c.id);
  db.prepare("UPDATE app_calls SET status = ?, end_reason = ?, ended_at = datetime('now','localtime') WHERE id = ? AND status IN ('ringing','active')").run(status, reason || null, c.id);
  const done = getCall(db, c.id);
  tell(done, 'ended', { by: by || null });
  const caller = { id: c.caller_id, name: c.caller_name };
  if (status === 'missed') {
    logInChat(db, c.channel_id, caller, '📞 Missed call');
    notifyPush(db, [c.callee_id], { title: `Missed call from ${c.caller_name}`, body: 'Tap to call back', url: `/#/chat/${c.channel_id}`, tag: `call-${c.id}` });
  } else if (status === 'declined') logInChat(db, c.channel_id, caller, '📞 Call declined');
  else if (status === 'cancelled') logInChat(db, c.channel_id, caller, '📞 Missed call');
  else if (status === 'ended' && done.answered_at) {
    const secs = Math.max(0, (new Date(done.ended_at.replace(' ', 'T')) - new Date(done.answered_at.replace(' ', 'T'))) / 1000);
    logInChat(db, c.channel_id, caller, `📞 Call · ${mmss(secs)}`);
  } else if (status === 'failed') logInChat(db, c.channel_id, caller, '📞 Call couldn’t connect');
  return done;
}

// ---- Relay (TURN) / ICE servers ----
let twilioCache = { at: 0, servers: null };
export async function iceServers(db, user) {
  const s = getSettings(db);
  const list = [];
  const stun = (s.app_call_stun ?? 'stun:stun.l.google.com:19302').split(',').map(x => x.trim()).filter(Boolean);
  if (stun.length) list.push({ urls: stun });
  // A relay set up next to the app (deploy/docker-compose.turn.yml) is used automatically.
  let relay = s.app_call_relay || 'none';
  if (relay === 'none' && process.env.TURN_URLS && process.env.TURN_SECRET) relay = 'custom';
  if (relay === 'custom') {
    const urls = (process.env.TURN_URLS || s.turn_urls || '').split(',').map(x => x.trim()).filter(Boolean);
    let secret = process.env.TURN_SECRET || '';
    if (!secret && s.turn_secret) { try { secret = decrypt(s.turn_secret); } catch { secret = ''; } }
    if (urls.length && secret) {
      // coturn "use-auth-secret": short-lived username/password made from the shared secret.
      const username = `${Math.floor(Date.now() / 1000) + 12 * 3600}:${user.id}`;
      list.push({ urls, username, credential: crypto.createHmac('sha1', secret).update(username).digest('base64') });
    }
  } else if (relay === 'twilio') {
    if (twilioCache.servers && Date.now() - twilioCache.at < 50 * 60e3) return [...list, ...twilioCache.servers];
    const t = smsConfig(db);
    if (t.sid && t.token) {
      try {
        const res = await fetch(`${t.api}/2010-04-01/Accounts/${encodeURIComponent(t.sid)}/Tokens.json`, {
          method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${t.sid}:${t.token}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'Ttl=3600',
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) {
          const servers = ((await res.json()).ice_servers || []).filter(x => /^turns?:/.test(x.urls || x.url || '')).map(x => ({ urls: x.urls || x.url, username: x.username, credential: x.credential }));
          twilioCache = { at: Date.now(), servers };
          return [...list, ...servers];
        }
        console.error('twilio relay', res.status);
      } catch (e) { console.error('twilio relay', e.message); }
    }
  }
  return list;
}

export function registerCallRoutes(r) {
  r('GET', '/api/calls/config', G.all, async ({ db, user }) => ({ enabled: enabled(db), ice: enabled(db) ? await iceServers(db, user) : [], ring_seconds: RING_SECONDS }));
  // A call ringing for me right now (e.g. I opened the app from the notification).
  r('GET', '/api/calls/active', G.all, ({ db, user }) => {
    const c = db.prepare(`SELECT id FROM app_calls WHERE (callee_id = ? OR caller_id = ?) AND status IN ('ringing','active') ORDER BY id DESC LIMIT 1`).get(user.id, user.id);
    return c ? view(getCall(db, c.id)) : null;
  });
  r('POST', '/api/calls', G.all, ({ db, user, body }) => {
    if (!enabled(db)) throw new HttpError(404, 'In-app calls are turned off');
    const to = db.prepare('SELECT id, name FROM users WHERE id = ? AND active = 1').get(Number(body.user_id));
    if (!to || to.id === user.id) throw new HttpError(400, 'Choose someone to call');
    // Clean up anything left ringing by a closed app.
    for (const old of db.prepare("SELECT id FROM app_calls WHERE status = 'ringing' AND created_at < datetime('now','localtime', ?)").all(`-${RING_SECONDS + 5} seconds`)) finish(db, getCall(db, old.id), 'missed', 'no answer');
    const busy = db.prepare("SELECT 1 FROM app_calls WHERE status IN ('ringing','active') AND (caller_id IN (?,?) OR callee_id IN (?,?))").get(to.id, user.id, to.id, user.id);
    if (busy) throw new HttpError(409, `${to.name.split(' ')[0]} is on another call. Try again in a bit, or send a message.`);
    const channel = directChannel(db, user.id, to.id);
    const id = Number(db.prepare('INSERT INTO app_calls (caller_id, callee_id, channel_id) VALUES (?,?,?)').run(user.id, to.id, channel).lastInsertRowid);
    const c = getCall(db, id);
    tell(c, 'ring');
    notifyPush(db, [to.id], { title: `📞 ${user.name} is calling`, body: 'Tap to answer in SecureOps', url: `/#/chat/${channel}?call=${id}`, tag: `call-${id}` });
    const tm = setTimeout(() => { const cur = getCall(db, id); if (cur?.status === 'ringing') finish(db, cur, 'missed', 'no answer'); }, RING_SECONDS * 1000);
    tm.unref?.();
    timers.set(id, tm);
    return { call: view(c), online: isOnline(to.id), channel_id: channel };
  });
  const party = (db, id, user) => {
    const c = getCall(db, id);
    if (!c || (c.caller_id !== user.id && c.callee_id !== user.id)) throw new HttpError(404, 'Call not found');
    return c;
  };
  r('POST', '/api/calls/:id/answer', G.all, ({ db, user, params, body }) => {
    const c = party(db, params.id, user);
    if (c.callee_id !== user.id) throw new HttpError(403, 'Only the person being called can answer');
    if (c.status !== 'ringing') throw new HttpError(409, c.status === 'active' ? 'Answered on another device' : 'This call has ended');
    clearTimeout(timers.get(c.id)); timers.delete(c.id);
    db.prepare("UPDATE app_calls SET status = 'active', answered_at = datetime('now','localtime'), callee_device = ? WHERE id = ?").run(String(body.device || '').slice(0, 40) || null, c.id);
    tell(getCall(db, c.id), 'answered', { device: String(body.device || '') });
    return { ok: true };
  });
  r('POST', '/api/calls/:id/decline', G.all, ({ db, user, params }) => {
    const c = party(db, params.id, user);
    if (c.status !== 'ringing') return { ok: true };
    finish(db, c, c.callee_id === user.id ? 'declined' : 'cancelled', null, user.id);
    return { ok: true };
  });
  r('POST', '/api/calls/:id/hangup', G.all, ({ db, user, params, body }) => {
    const c = party(db, params.id, user);
    if (!LIVE.includes(c.status)) return { ok: true };
    const failed = body.reason === 'failed';
    finish(db, c, c.status === 'ringing' ? (c.caller_id === user.id ? 'cancelled' : 'declined') : failed ? 'failed' : 'ended', failed ? 'could not connect' : null, user.id);
    return { ok: true };
  });
  // Connection details (offer/answer/network candidates) passed to the other person.
  r('POST', '/api/calls/:id/signal', G.all, ({ db, user, params, body }) => {
    const c = party(db, params.id, user);
    if (!LIVE.includes(c.status)) throw new HttpError(409, 'This call has ended');
    const data = body.data;
    const size = JSON.stringify(data ?? null).length;
    if (!data || size > 100_000) throw new HttpError(400, 'Bad signal');
    const other = c.caller_id === user.id ? c.callee_id : c.caller_id;
    publish([other], { type: 'call', action: 'signal', call: view(c), from: user.id, device: String(body.device || ''), data });
    return { ok: true };
  });
  r('GET', '/api/calls/history', G.all, ({ db, user }) => db.prepare(`SELECT c.id, c.status, c.created_at, c.answered_at, c.ended_at, c.channel_id,
      c.caller_id, a.name AS caller_name, c.callee_id, b.name AS callee_name FROM app_calls c JOIN users a ON a.id = c.caller_id JOIN users b ON b.id = c.callee_id
    WHERE c.caller_id = ? OR c.callee_id = ? ORDER BY c.id DESC LIMIT 50`).all(user.id, user.id));
}
