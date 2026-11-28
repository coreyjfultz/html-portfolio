// Team chat: an "Everyone" channel, one-to-one and group conversations, and a thread per job
// (tech ↔ office). Messages arrive live over Server-Sent Events while the app is open, and as
// a push notification on phones/computers that allowed notifications when it isn't.
import { G } from '../public/js/schema.js';
import { getSettings } from './db.js';
import { HttpError, nowLocal } from './resources.js';
import { decodeImage, saveImage, sendImage } from './media.js';
import { notifyPush } from './push.js';

const MANAGE = G.manage;
const isManager = u => MANAGE.includes(u?.role);

export function ensureTeamChannel(db) {
  if (!db.prepare("SELECT 1 FROM chat_channels WHERE kind = 'team'").get()) db.prepare("INSERT INTO chat_channels (kind, name) VALUES ('team', 'Everyone')").run();
}

// ---------------------------------------------------------------- who's in a channel
function channelOr404(db, id) {
  const c = db.prepare('SELECT * FROM chat_channels WHERE id = ?').get(Number(id));
  if (!c) throw new HttpError(404, 'Conversation not found');
  return c;
}
/** Active user ids who belong to a channel. */
export function memberIds(db, c) {
  if (c.kind === 'team') return db.prepare('SELECT id FROM users WHERE active = 1').all().map(r => r.id);
  const ids = new Set(db.prepare('SELECT user_id FROM chat_members WHERE channel_id = ?').all(c.id).map(r => r.user_id));
  if (c.kind === 'job') {
    for (const u of db.prepare("SELECT id FROM users WHERE active = 1 AND role IN ('owner','admin')").all()) ids.add(u.id);
    const call = db.prepare('SELECT technician_id FROM service_calls WHERE id = ?').get(c.service_call_id);
    if (call?.technician_id) for (const u of db.prepare('SELECT id FROM users WHERE active = 1 AND technician_id = ?').all(call.technician_id)) ids.add(u.id);
  }
  const active = new Set(db.prepare('SELECT id FROM users WHERE active = 1').all().map(r => r.id));
  return [...ids].filter(id => active.has(id));
}
function assertMember(db, c, user) {
  if (!memberIds(db, c).includes(user.id)) throw new HttpError(404, 'Conversation not found');
}

function channelTitle(db, c, user) {
  if (c.kind === 'direct') {
    const other = db.prepare('SELECT u.name FROM chat_members m JOIN users u ON u.id = m.user_id WHERE m.channel_id = ? AND m.user_id <> ?').get(c.id, user.id);
    return other?.name || 'Direct message';
  }
  if (c.kind === 'job') {
    const call = db.prepare('SELECT sc.number, cu.name FROM service_calls sc JOIN customers cu ON cu.id = sc.customer_id WHERE sc.id = ?').get(c.service_call_id);
    return call ? `SC-${call.number} · ${call.name}` : c.name || 'Job';
  }
  return c.name;
}

function summary(db, c, user) {
  const last = db.prepare('SELECT id, user_name, body, photo_key, created_at FROM chat_messages WHERE channel_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1').get(c.id);
  const read = db.prepare('SELECT last_read_id, muted FROM chat_members WHERE channel_id = ? AND user_id = ?').get(c.id, user.id);
  const unread = db.prepare('SELECT COUNT(*) AS n FROM chat_messages WHERE channel_id = ? AND id > ? AND user_id <> ? AND deleted_at IS NULL').get(c.id, read?.last_read_id || 0, user.id).n;
  return {
    id: c.id, kind: c.kind, title: channelTitle(db, c, user), service_call_id: c.service_call_id, unread, muted: !!read?.muted,
    last: last ? { user_name: last.user_name, text: last.body || (last.photo_key ? '📷 Photo' : ''), at: last.created_at } : null,
    members: c.kind === 'group' ? memberIds(db, c).length : undefined,
  };
}

export function listChannels(db, user) {
  ensureTeamChannel(db);
  const rows = db.prepare(`SELECT * FROM chat_channels c WHERE archived = 0 AND (
      kind = 'team' OR EXISTS (SELECT 1 FROM chat_members m WHERE m.channel_id = c.id AND m.user_id = ?)
      OR (kind = 'job' AND (? OR EXISTS (SELECT 1 FROM service_calls sc JOIN users u ON u.technician_id = sc.technician_id WHERE sc.id = c.service_call_id AND u.id = ?))))`)
    .all(user.id, isManager(user) ? 1 : 0, user.id);
  return rows.map(c => summary(db, c, user)).sort((a, b) => (b.last?.at || '').localeCompare(a.last?.at || '') || a.title.localeCompare(b.title));
}
export const unreadTotal = (db, user) => listChannels(db, user).filter(c => !c.muted).reduce((t, c) => t + c.unread, 0);

const shape = m => ({ id: m.id, channel_id: m.channel_id, user_id: m.user_id, user_name: m.user_name, body: m.deleted_at ? null : m.body, photo: m.photo_key && !m.deleted_at ? `/api/chat/photos/${m.id}` : null, created_at: m.created_at, deleted: !!m.deleted_at });

// ---------------------------------------------------------------- live updates (Server-Sent Events)
const streams = new Map(); // userId -> Set(res)
function publish(userIds, event) {
  const data = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const id of userIds) for (const res of streams.get(id) || []) res.write(data);
}
export const onlineUserIds = () => [...streams.keys()].filter(id => streams.get(id)?.size);

export function postMessage(db, c, user, { body, photo }) {
  const text = String(body || '').trim().slice(0, 4000);
  const img = photo ? decodeImage(photo, { maxBytes: 8 * 1024 * 1024 }) : null;
  if (!text && !img) throw new HttpError(400, 'Type a message');
  const key = img ? saveImage('photos', img) : null;
  const id = Number(db.prepare('INSERT INTO chat_messages (channel_id, user_id, user_name, body, photo_key) VALUES (?,?,?,?,?)').run(c.id, user.id, user.name, text || null, key).lastInsertRowid);
  // The sender has read everything up to their own message.
  db.prepare(`INSERT INTO chat_members (channel_id, user_id, last_read_id) VALUES (?,?,?)
    ON CONFLICT(channel_id, user_id) DO UPDATE SET last_read_id = excluded.last_read_id`).run(c.id, user.id, id);
  db.prepare('UPDATE chat_channels SET last_message_at = ? WHERE id = ?').run(nowLocal(), c.id);
  const msg = shape(db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(id));
  const members = memberIds(db, c);
  publish(members, { type: 'message', channel_id: c.id, title: channelTitle(db, c, { id: 0 }), message: msg });
  // Push to everyone else who isn't muted (their phone shows it if the app isn't open).
  const muted = new Set(db.prepare('SELECT user_id FROM chat_members WHERE channel_id = ? AND muted = 1').all(c.id).map(r => r.user_id));
  notifyPush(db, members.filter(u => u !== user.id && !muted.has(u)));
  return msg;
}

export function registerChatRoutes(r) {
  r('GET', '/api/chat/channels', G.all, ({ db, user }) => listChannels(db, user));
  r('GET', '/api/chat/unread', G.all, ({ db, user }) => {
    const chans = listChannels(db, user).filter(c => c.unread && !c.muted);
    return { total: chans.reduce((t, c) => t + c.unread, 0), latest: chans[0] ? { channel_id: chans[0].id, title: chans[0].title, from: chans[0].last?.user_name, text: chans[0].last?.text } : null };
  });
  r('GET', '/api/chat/people', G.all, ({ db, user }) => db.prepare("SELECT id, name, role FROM users WHERE active = 1 AND id <> ? ORDER BY name").all(user.id));

  r('POST', '/api/chat/channels', G.all, ({ db, user, body }) => {
    if (body.kind === 'direct') {
      const other = db.prepare('SELECT id FROM users WHERE id = ? AND active = 1').get(Number(body.user_id));
      if (!other || other.id === user.id) throw new HttpError(400, 'Choose someone to message');
      const found = db.prepare(`SELECT c.id FROM chat_channels c WHERE kind = 'direct'
        AND EXISTS (SELECT 1 FROM chat_members WHERE channel_id = c.id AND user_id = ?) AND EXISTS (SELECT 1 FROM chat_members WHERE channel_id = c.id AND user_id = ?)`).get(user.id, other.id);
      if (found) return { id: found.id };
      const id = Number(db.prepare("INSERT INTO chat_channels (kind, created_by) VALUES ('direct', ?)").run(user.id).lastInsertRowid);
      for (const u of [user.id, other.id]) db.prepare('INSERT INTO chat_members (channel_id, user_id) VALUES (?,?)').run(id, u);
      return { id };
    }
    if (body.kind === 'group') {
      const name = String(body.name || '').trim().slice(0, 60);
      if (!name) throw new HttpError(400, 'Name the group');
      const ids = new Set([user.id, ...(Array.isArray(body.member_ids) ? body.member_ids.map(Number) : [])]);
      const valid = db.prepare(`SELECT id FROM users WHERE active = 1 AND id IN (${[...ids].map(() => '?').join(',')})`).all(...ids).map(x => x.id);
      if (valid.length < 2) throw new HttpError(400, 'Add at least one other person');
      const id = Number(db.prepare("INSERT INTO chat_channels (kind, name, created_by) VALUES ('group', ?, ?)").run(name, user.id).lastInsertRowid);
      for (const u of valid) db.prepare('INSERT INTO chat_members (channel_id, user_id) VALUES (?,?)').run(id, u);
      return { id };
    }
    throw new HttpError(400, 'Unknown conversation type');
  });
  r('PUT', '/api/chat/channels/:id/members', G.all, ({ db, params, body, user }) => {
    const c = channelOr404(db, params.id);
    assertMember(db, c, user);
    if (c.kind !== 'group') throw new HttpError(400, 'Only groups have editable members');
    if (c.created_by !== user.id && !isManager(user)) throw new HttpError(403, 'Only whoever made the group (or an admin) can change who’s in it');
    const ids = [...new Set((Array.isArray(body.member_ids) ? body.member_ids : []).map(Number))];
    const keep = new Set(db.prepare(`SELECT id FROM users WHERE active = 1 AND id IN (${ids.map(() => '?').join(',') || 'NULL'})`).all(...ids).map(x => x.id));
    db.prepare(`DELETE FROM chat_members WHERE channel_id = ? AND user_id NOT IN (${[...keep].map(() => '?').join(',') || 'NULL'})`).run(c.id, ...keep);
    for (const u of keep) db.prepare('INSERT OR IGNORE INTO chat_members (channel_id, user_id) VALUES (?,?)').run(c.id, u);
    return { ok: true, members: keep.size };
  });
  r('GET', '/api/chat/channels/:id', G.all, ({ db, params, user }) => {
    const c = channelOr404(db, params.id);
    assertMember(db, c, user);
    const people = db.prepare(`SELECT id, name, role FROM users WHERE id IN (${memberIds(db, c).map(() => '?').join(',') || 'NULL'}) ORDER BY name`).all(...memberIds(db, c));
    return { ...summary(db, c, user), created_by: c.created_by, people, online: onlineUserIds().filter(id => people.some(p => p.id === id)) };
  });
  r('GET', '/api/chat/channels/:id/messages', G.all, ({ db, params, user, query }) => {
    const c = channelOr404(db, params.id);
    assertMember(db, c, user);
    const before = Number(query.before) || 1e15;
    const limit = Math.min(Number(query.limit) || 50, 200);
    return db.prepare('SELECT * FROM chat_messages WHERE channel_id = ? AND id < ? ORDER BY id DESC LIMIT ?').all(c.id, before, limit).reverse().map(shape);
  });
  r('POST', '/api/chat/channels/:id/messages', G.all, ({ db, params, user, body }) => {
    const c = channelOr404(db, params.id);
    assertMember(db, c, user);
    return postMessage(db, c, user, body);
  });
  r('POST', '/api/chat/channels/:id/read', G.all, ({ db, params, user, body }) => {
    const c = channelOr404(db, params.id);
    assertMember(db, c, user);
    const last = Number(body.last_id) || db.prepare('SELECT MAX(id) AS m FROM chat_messages WHERE channel_id = ?').get(c.id).m || 0;
    db.prepare(`INSERT INTO chat_members (channel_id, user_id, last_read_id) VALUES (?,?,?)
      ON CONFLICT(channel_id, user_id) DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id)`).run(c.id, user.id, last);
    publish([user.id], { type: 'read', channel_id: c.id });
    return { ok: true };
  });
  r('POST', '/api/chat/channels/:id/mute', G.all, ({ db, params, user, body }) => {
    const c = channelOr404(db, params.id);
    assertMember(db, c, user);
    db.prepare(`INSERT INTO chat_members (channel_id, user_id, muted) VALUES (?,?,?) ON CONFLICT(channel_id, user_id) DO UPDATE SET muted = excluded.muted`).run(c.id, user.id, body.muted ? 1 : 0);
    return { ok: true };
  });
  r('DELETE', '/api/chat/messages/:id', G.all, ({ db, params, user }) => {
    const m = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(Number(params.id));
    if (!m) throw new HttpError(404, 'Not found');
    const c = channelOr404(db, m.channel_id);
    assertMember(db, c, user);
    const fresh = Date.now() - new Date(m.created_at.replace(' ', 'T')).getTime() < 15 * 60e3;
    if (!(m.user_id === user.id && fresh) && !isManager(user)) throw new HttpError(403, 'You can delete your own messages for 15 minutes');
    db.prepare("UPDATE chat_messages SET deleted_at = datetime('now','localtime') WHERE id = ?").run(m.id);
    publish(memberIds(db, c), { type: 'deleted', channel_id: c.id, message_id: m.id });
    return { ok: true };
  });
  r('GET', '/api/chat/photos/:id', G.all, ({ db, params, user, res }) => {
    const m = db.prepare('SELECT * FROM chat_messages WHERE id = ? AND deleted_at IS NULL').get(Number(params.id));
    if (!m?.photo_key) throw new HttpError(404, 'Not found');
    assertMember(db, channelOr404(db, m.channel_id), user);
    sendImage(res, 'photos', m.photo_key);
    return undefined;
  });

  // A thread for a job: the tech and the office talk about it in one place.
  r('POST', '/api/service_calls/:id/chat', G.all, ({ db, params, user }) => {
    const call = db.prepare('SELECT id, technician_id FROM service_calls WHERE id = ?').get(Number(params.id));
    if (!call) throw new HttpError(404, 'Service call not found');
    if (user.role === 'technician' && call.technician_id !== user.technician_id) throw new HttpError(403, 'This job is assigned to someone else');
    let c = db.prepare("SELECT * FROM chat_channels WHERE kind = 'job' AND service_call_id = ?").get(call.id);
    if (!c) {
      const id = Number(db.prepare("INSERT INTO chat_channels (kind, service_call_id, created_by) VALUES ('job', ?, ?)").run(call.id, user.id).lastInsertRowid);
      c = db.prepare('SELECT * FROM chat_channels WHERE id = ?').get(id);
    }
    db.prepare('INSERT OR IGNORE INTO chat_members (channel_id, user_id) VALUES (?,?)').run(c.id, user.id);
    return { id: c.id };
  });

  // Live stream of chat events for this user.
  r('GET', '/api/chat/stream', G.all, ({ user, res, req }) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 5000\n\n');
    if (!streams.has(user.id)) streams.set(user.id, new Set());
    streams.get(user.id).add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); streams.get(user.id)?.delete(res); });
    return undefined;
  });
}

