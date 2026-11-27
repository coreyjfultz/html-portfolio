// Alarm monitoring: central-station accounts per customer/site, zones (sensors),
// call lists, signal activity and test mode.
//
// Station connectors: every action goes through a connector so a real central
// station (CMS or any station running Manitou, MASterMind, stages, …) can be
// plugged in later without changing the screens. Today the only connector is
// "manual": changes are recorded here, and the UI tells staff to confirm them with
// the station by phone or the station's dealer portal.
import crypto from 'node:crypto';
import { tx } from './db.js';
import { HttpError, registerHooks, get, nowLocal, todayLocal } from './resources.js';
import { audit } from './security.js';

// ------------------------------------------------------------------ connectors
/**
 * A connector implements (all async, all optional):
 *   createAccount(station, account)          -> { synced, account_number? }
 *   updateAccount(station, account)          -> { synced }
 *   saveZone(station, account, zone)         -> { synced }
 *   removeZone(station, account, zone)       -> { synced }
 *   putOnTest(station, account, minutes)     -> { synced }
 *   clearTest(station, account)              -> { synced }
 *   fetchEvents(station, account, since)     -> [{ time, code, type, zone, description, disposition, id }]
 * and sets `connected: true`. Return { synced: false } when the change still has to be made at the station by hand.
 */
export const CONNECTORS = {
  manual: {
    label: 'Manual (not connected yet)',
    connected: false,
  },
};
const connectorFor = station => CONNECTORS[station?.connector] || CONNECTORS.manual;

async function callConnector(db, accountId, method, extra) {
  const acct = db.prepare('SELECT * FROM monitoring_accounts WHERE id = ?').get(accountId);
  const station = acct && db.prepare('SELECT * FROM monitoring_stations WHERE id = ?').get(acct.station_id);
  const c = connectorFor(station);
  if (!c.connected || typeof c[method] !== 'function') return { synced: false };
  try { return await c[method](station, acct, extra); } catch (e) { logEvent(db, accountId, { type: 'system', description: `Station update failed: ${e.message}` }); return { synced: false, error: e.message }; }
}

export function stationInfo(db, stationId) {
  const s = db.prepare('SELECT id, name, operator_phone, dealer_number, dealer_portal, connector, platform FROM monitoring_stations WHERE id = ?').get(stationId);
  return s ? { ...s, connected: !!connectorFor(s).connected } : null;
}

// ------------------------------------------------------------------ events
const CID = { 1: 'alarm', 3: 'trouble', 4: 'open/close', 6: 'test' };
const SIA = { BA: 'alarm', FA: 'alarm', PA: 'alarm', MA: 'alarm', HA: 'alarm', GA: 'alarm', WA: 'alarm', TA: 'trouble', BT: 'trouble', FT: 'trouble', YT: 'trouble', AT: 'trouble', YS: 'trouble',
  BR: 'restore', FR: 'restore', TR: 'restore', YR: 'restore', AR: 'restore', OP: 'open/close', CL: 'open/close', RP: 'test', TX: 'test', TS: 'test', TE: 'test' };
const TYPES = ['alarm', 'trouble', 'restore', 'open/close', 'test', 'supervisory', 'cancel', 'note', 'system', 'other'];

/** Works out the event type from Contact ID (e.g. "E130") or SIA (e.g. "BA") codes when the feed doesn't say. */
export function classify(code) {
  const c = String(code || '').trim().toUpperCase();
  const cid = c.match(/^([ER])?([1-9])\d{2}$/);
  if (cid) return cid[1] === 'R' && cid[2] !== '4' ? 'restore' : (CID[cid[2]] || (cid[2] === '2' ? 'supervisory' : 'other'));
  if (SIA[c.slice(0, 2)]) return SIA[c.slice(0, 2)];
  return 'other';
}

export function logEvent(db, accountId, { time, type, code, zone, description, disposition, source = 'system', externalId, user } = {}) {
  const acct = db.prepare("SELECT status, test_until FROM monitoring_accounts WHERE id = ?").get(accountId);
  const zoneRow = zone != null && zone !== '' ? db.prepare('SELECT description FROM monitoring_zones WHERE account_id = ? AND zone_number = ? ORDER BY active DESC LIMIT 1').get(accountId, Number(zone)) : null;
  const at = time && !isNaN(Date.parse(time)) ? String(time).replace(' ', 'T').slice(0, 16) : nowLocal();
  const t = TYPES.includes(type) ? type : classify(code);
  const info = db.prepare(`INSERT OR IGNORE INTO monitoring_events (account_id, occurred_at, event_type, code, zone_number, zone_description, description, disposition, source, external_id, on_test, user_name)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(accountId, at, t, code ? String(code).slice(0, 20) : null, zone != null && zone !== '' ? Number(zone) : null, zoneRow?.description || null,
      String(description || '').slice(0, 1000) || null, disposition ? String(disposition).slice(0, 1000) : null, source, externalId ? String(externalId).slice(0, 120) : null,
      acct?.status === 'on test' ? 1 : 0, user?.name || null);
  return info.changes > 0;
}

// ------------------------------------------------------------------ business rules
function nextAccountNumber(db, station) {
  if (station.next_account_number == null || station.next_account_number === '') return null;
  const n = Number(station.next_account_number);
  db.prepare('UPDATE monitoring_stations SET next_account_number = ? WHERE id = ?').run(n + 1, station.id);
  return `${station.account_prefix || ''}${String(n).padStart(Number(station.account_digits) || 0, '0')}`;
}

registerHooks('monitoring_stations', {
  beforeSave(db, data, { isCreate }) { if (isCreate) data.inbound_token = crypto.randomBytes(20).toString('base64url'); },
});

registerHooks('monitoring_accounts', {
  beforeSave(db, data, { isCreate, existing, body }) {
    const stationId = data.station_id ?? existing?.station_id;
    const station = db.prepare('SELECT * FROM monitoring_stations WHERE id = ?').get(stationId);
    if (!station) throw new HttpError(400, 'Choose a monitoring station');
    if ('status' in data && data.status === 'on test' && existing?.status !== 'on test') throw new HttpError(400, 'Use “Put on test” so the test has an end time');
    if (existing?.status === 'on test' && 'status' in data && data.status !== 'on test') {
      data.test_until = null; data.test_reason = null; data.test_by = null; data.status_before_test = null;
    }
    if (isCreate) {
      if (!data.account_number) data.account_number = nextAccountNumber(db, station);
      if (data.alarm_system_id) {
        const a = db.prepare('SELECT panel_brand, panel_model, communicator FROM alarm_systems WHERE id = ?').get(data.alarm_system_id);
        if (a && !data.panel) data.panel = [a.panel_brand, a.panel_model].filter(Boolean).join(' ') || null;
      }
    }
    const num = data.account_number ?? existing?.account_number;
    if (num) {
      const dup = db.prepare('SELECT id FROM monitoring_accounts WHERE station_id = ? AND lower(account_number) = lower(?) AND id <> ?').get(stationId, num, existing?.id ?? 0);
      if (dup) throw new HttpError(409, `Account ${num} already exists at ${station.name}`);
    }
  },
  afterSave(db, row, { existing, user }) {
    if (!existing) {
      logEvent(db, row.id, { type: 'system', description: `Account ${row.account_number || '(number pending from station)'} created`, user });
      if (row.alarm_system_id && row.account_number) db.prepare('UPDATE alarm_systems SET monitoring_account = ? WHERE id = ? AND COALESCE(monitoring_account, \'\') = \'\'').run(row.account_number, row.alarm_system_id);
      callConnector(db, row.id, 'createAccount');
    } else {
      if (existing.status !== row.status) logEvent(db, row.id, { type: 'system', description: `Status changed: ${existing.status} → ${row.status}`, user });
      if (existing.account_number !== row.account_number) logEvent(db, row.id, { type: 'system', description: `Account number changed: ${existing.account_number || '—'} → ${row.account_number || '—'}`, user });
      db.prepare('UPDATE monitoring_accounts SET station_synced = 0 WHERE id = ?').run(row.id);
      callConnector(db, row.id, 'updateAccount');
    }
  },
});

registerHooks('monitoring_zones', {
  beforeSave(db, data, { isCreate, existing }) {
    const acctId = data.account_id ?? existing?.account_id;
    const num = data.zone_number ?? existing?.zone_number;
    const active = 'active' in data ? data.active : (existing?.active ?? 1);
    if (active) {
      const dup = db.prepare('SELECT id FROM monitoring_zones WHERE account_id = ? AND zone_number = ? AND active = 1 AND id <> ?').get(acctId, num, existing?.id ?? 0);
      if (dup) throw new HttpError(409, `Zone ${num} is already in use on this account. Remove the old sensor first or pick another zone number.`);
    }
    if (isCreate) data.added_on = todayLocal();
    if (existing && 'active' in data && data.active !== existing.active) data.removed_on = data.active ? null : todayLocal();
    data.station_synced = 0;
  },
  afterSave(db, row, { existing, user }) {
    const what = `Zone ${row.zone_number} “${row.description}” (${row.zone_type})`;
    if (!existing) logEvent(db, row.account_id, { type: 'system', description: `${what} added`, user });
    else if (existing.active && !row.active) logEvent(db, row.account_id, { type: 'system', description: `${what} removed`, user });
    else if (!existing.active && row.active) logEvent(db, row.account_id, { type: 'system', description: `${what} put back in service`, user });
    else logEvent(db, row.account_id, { type: 'system', description: `${what} updated`, user });
    callConnector(db, row.account_id, row.active ? 'saveZone' : 'removeZone', row);
  },
});

registerHooks('monitoring_contacts', {
  afterSave(db, row, { existing, user }) { logEvent(db, row.account_id, { type: 'system', description: `Call list ${existing ? 'updated' : 'added'}: ${row.sequence}. ${row.name}`, user }); },
  afterDelete(db, row, { user }) { logEvent(db, row.account_id, { type: 'system', description: `Call list removed: ${row.name}`, user }); },
});

// ------------------------------------------------------------------ test mode
const plusMinutes = m => { const d = new Date(Date.now() + m * 60e3); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

export async function putOnTest(db, id, { minutes, reason }, user) {
  const mins = Math.round(Number(minutes));
  if (!(mins >= 15 && mins <= 72 * 60)) throw new HttpError(400, 'Choose a test period between 15 minutes and 72 hours');
  const acct = db.prepare('SELECT * FROM monitoring_accounts WHERE id = ?').get(Number(id));
  if (!acct) throw new HttpError(404, 'Account not found');
  if (['cancelled'].includes(acct.status)) throw new HttpError(400, 'This account is cancelled');
  const until = plusMinutes(mins);
  tx(db, () => {
    db.prepare(`UPDATE monitoring_accounts SET status = 'on test', status_before_test = CASE WHEN status = 'on test' THEN status_before_test ELSE status END,
      test_until = ?, test_reason = ?, test_by = ?, station_synced = 0, updated_at = datetime('now','localtime') WHERE id = ?`)
      .run(until, String(reason || '').slice(0, 300) || null, user?.name || null, acct.id);
    logEvent(db, acct.id, { type: 'test', description: `Placed on test until ${until.replace('T', ' ')}${reason ? ` — ${reason}` : ''}`, user, source: 'manual' });
  });
  audit(db, user, 'monitoring on test', 'monitoring_accounts', acct.id, `${mins} min`);
  const r = await callConnector(db, acct.id, 'putOnTest', mins);
  if (r.synced) db.prepare('UPDATE monitoring_accounts SET station_synced = 1 WHERE id = ?').run(acct.id);
  return { account: get(db, 'monitoring_accounts', acct.id), station_confirmed: !!r.synced, station: stationInfo(db, acct.station_id) };
}

export async function clearTest(db, id, user, { reason = 'Taken off test' } = {}) {
  const acct = db.prepare('SELECT * FROM monitoring_accounts WHERE id = ?').get(Number(id));
  if (!acct) throw new HttpError(404, 'Account not found');
  if (acct.status !== 'on test') return { account: get(db, 'monitoring_accounts', acct.id), station_confirmed: true };
  db.prepare(`UPDATE monitoring_accounts SET status = COALESCE(NULLIF(status_before_test, 'on test'), 'active'), status_before_test = NULL, test_until = NULL, test_reason = NULL, test_by = NULL,
    updated_at = datetime('now','localtime') WHERE id = ?`).run(acct.id);
  logEvent(db, acct.id, { type: 'test', description: reason, user, source: 'manual' });
  audit(db, user, 'monitoring off test', 'monitoring_accounts', acct.id);
  const r = await callConnector(db, acct.id, 'clearTest');
  return { account: get(db, 'monitoring_accounts', acct.id), station_confirmed: !!r.synced, station: stationInfo(db, acct.station_id) };
}

/** Called every minute: tests whose time is up go back to their normal status. */
export async function expireTests(db) {
  const due = db.prepare("SELECT id FROM monitoring_accounts WHERE status = 'on test' AND test_until IS NOT NULL AND test_until <= ?").all(nowLocal());
  for (const a of due) await clearTest(db, a.id, { name: 'system' }, { reason: 'Test period ended' });
  return due.length;
}

/** Mark that the change was confirmed with the station (manual stations). */
export function markConfirmed(db, id, user) {
  db.prepare('UPDATE monitoring_accounts SET station_synced = 1 WHERE id = ?').run(Number(id));
  db.prepare('UPDATE monitoring_zones SET station_synced = 1 WHERE account_id = ? AND station_synced = 0').run(Number(id));
  logEvent(db, Number(id), { type: 'note', description: 'Changes confirmed with the monitoring station', user, source: 'manual' });
}

// ------------------------------------------------------------------ inbound signals from a station
/**
 * A station (or middleware) POSTs signals here. Body: one event or { events: [...] }:
 *   { account: "C1-0042", time: "2031-01-02T03:04:05", code: "E130" | "BA", type?: "alarm", zone?: 3,
 *     description?: "Burglary", disposition?: "Police dispatched", id?: "station-event-id" }
 * Duplicate ids are ignored, so a station can safely resend.
 */
export function ingestSignals(db, stationToken, body) {
  const station = /^[A-Za-z0-9_-]{20,64}$/.test(stationToken || '') && db.prepare('SELECT id FROM monitoring_stations WHERE inbound_token = ?').get(stationToken);
  if (!station) throw new HttpError(404, 'Not found');
  const events = Array.isArray(body?.events) ? body.events : [body];
  let added = 0, duplicates = 0;
  const unknown = [];
  for (const e of events.slice(0, 1000)) {
    const acct = e?.account && db.prepare('SELECT id FROM monitoring_accounts WHERE station_id = ? AND lower(account_number) = lower(?)').get(station.id, String(e.account));
    if (!acct) { unknown.push(e?.account ?? null); continue; }
    const ok = logEvent(db, acct.id, { time: e.time, type: e.type, code: e.code, zone: e.zone, description: e.description, disposition: e.disposition, source: 'station', externalId: e.id ? `${station.id}:${e.id}` : null });
    ok ? added++ : duplicates++;
  }
  return { added, duplicates, unknown_accounts: [...new Set(unknown)] };
}
