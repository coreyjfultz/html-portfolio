// Vehicle tracking, maps and travel time.
//
//  * GPS: pulls vehicle locations from the company's tracking provider (Samsara built in,
//    or any provider through a simple JSON feed / push webhook) every couple of minutes.
//  * Geocoding: customer & site addresses → map coordinates (OpenStreetMap Nominatim or Google).
//  * Routing: drive time between jobs (OSRM or Google, with a straight-line estimate fallback),
//    used to stop booking a tech somewhere they can't reach in time, and for live ETAs.
import crypto from 'node:crypto';
import { G } from '../public/js/schema.js';
import { getSettings, DEFAULT_SETTINGS } from './db.js';
import { HttpError, registerHooks, nowLocal, todayLocal } from './resources.js';
import { decrypt } from './security.js';
import { audit } from './security.js';
import { distanceM, officePoint } from './timeclock.js';

const MANAGE = G.manage;
const secret = (db, k, env) => process.env[env] || (() => { const v = getSettings(db)[k]; try { return v ? decrypt(v) : ''; } catch { return ''; } })();
const UA = 'SecureOps field-service app (self-hosted)';

// ---------------------------------------------------------------- GPS providers
export const PROVIDERS = {
  none: { label: 'Not connected' },
  samsara: { label: 'Samsara' },
  feed: { label: 'Other provider (JSON feed or webhook)' },
};

/** Normalise one provider record into { key, name, lat, lng, speed, heading, time, address }. */
const point = r => {
  const lat = Number(r.lat ?? r.latitude), lng = Number(r.lng ?? r.lon ?? r.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { key: String(r.id ?? r.vehicle_id ?? r.vehicle ?? r.name ?? ''), name: r.name ?? r.vehicle ?? null, lat, lng,
    speed: Number(r.speed ?? r.speed_mph ?? r.speedMilesPerHour) || 0, heading: Number(r.heading) || null,
    time: r.time ?? r.timestamp ?? r.recorded_at ?? null, address: r.address ?? null };
};

async function fetchSamsara(db) {
  const token = secret(db, 'samsara_token', 'SAMSARA_API_TOKEN');
  if (!token) throw new Error('Add your Samsara API token');
  const base = process.env.SAMSARA_API_BASE || 'https://api.samsara.com';
  const res = await fetch(`${base}/fleet/vehicles/locations`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Samsara ${res.status}`);
  const data = await res.json();
  return (data.data || []).map(v => point({ id: v.id, name: v.name, latitude: v.location?.latitude, longitude: v.location?.longitude,
    speed: v.location?.speed, heading: v.location?.heading, time: v.location?.time, address: v.location?.reverseGeo?.formattedLocation })).filter(Boolean);
}
async function fetchFeed(db) {
  const s = getSettings(db);
  if (!s.tracking_feed_url) return [];
  const token = secret(db, 'tracking_feed_token', 'TRACKING_FEED_TOKEN');
  const res = await fetch(s.tracking_feed_url, { headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  if (!res.ok) throw new Error(`Tracking feed ${res.status}`);
  const data = await res.json();
  return (Array.isArray(data) ? data : data.vehicles || data.data || []).map(point).filter(Boolean);
}

/** Match provider records to our vehicles (by tracker ID, else by unit name) and store the latest position. */
export function storePositions(db, points, source) {
  const vehicles = db.prepare("SELECT id, unit_name, tracker_id FROM vehicles WHERE status <> 'sold'").all();
  const up = db.prepare(`INSERT INTO vehicle_positions (vehicle_id, lat, lng, speed_mph, heading, recorded_at, address, source) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(vehicle_id) DO UPDATE SET lat = excluded.lat, lng = excluded.lng, speed_mph = excluded.speed_mph, heading = excluded.heading,
      recorded_at = excluded.recorded_at, address = excluded.address, source = excluded.source`);
  let n = 0;
  for (const p of points) {
    const v = vehicles.find(v => v.tracker_id && String(v.tracker_id) === p.key) || vehicles.find(v => p.name && v.unit_name.toLowerCase() === String(p.name).toLowerCase());
    if (!v) continue;
    const t = p.time ? new Date(p.time) : new Date();
    const pad = x => String(x).padStart(2, '0');
    const local = isNaN(t) ? nowLocal() : `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`;
    up.run(v.id, p.lat, p.lng, p.speed, p.heading, local, p.address, source);
    n++;
  }
  return n;
}

let lastPoll = { at: null, error: null, count: 0 };
export async function pollPositions(db) {
  const provider = getSettings(db).tracking_provider;
  if (!provider || provider === 'none') return lastPoll;
  try {
    const pts = provider === 'samsara' ? await fetchSamsara(db) : await fetchFeed(db);
    lastPoll = { at: nowLocal(), error: null, count: storePositions(db, pts, provider) };
  } catch (e) { lastPoll = { at: nowLocal(), error: e.message, count: 0 }; }
  return lastPoll;
}

// ---------------------------------------------------------------- geocoding
export async function geocode(db, address) {
  const s = getSettings(db);
  const q = String(address || '').trim();
  if (!q) throw new HttpError(400, 'Enter an address');
  if (s.geocoder === 'google') {
    const key = secret(db, 'google_maps_key', 'GOOGLE_MAPS_KEY');
    const base = process.env.GOOGLE_MAPS_BASE || 'https://maps.googleapis.com';
    const r = await (await fetch(`${base}/maps/api/geocode/json?address=${encodeURIComponent(q)}&key=${encodeURIComponent(key)}`)).json();
    const loc = r.results?.[0]?.geometry?.location;
    if (!loc) throw new HttpError(404, 'Address not found');
    return { lat: loc.lat, lng: loc.lng };
  }
  if (s.geocoder === 'nominatim') {
    const base = process.env.NOMINATIM_BASE || 'https://nominatim.openstreetmap.org';
    const r = await (await fetch(`${base}/search?format=json&limit=1&q=${encodeURIComponent(q)}`, { headers: { 'User-Agent': UA } })).json();
    if (!r?.[0]) throw new HttpError(404, 'Address not found');
    return { lat: Number(r[0].lat), lng: Number(r[0].lon) };
  }
  throw new HttpError(400, 'Address lookup is off. Turn it on under Settings → Tracking & maps.');
}

const addrOf = r => [r.address ?? r.service_address ?? r.billing_address, r.city, r.state, r.zip].filter(Boolean).join(', ');
/** Fill in map coordinates for customers / sites that don't have them yet (a few at a time; Nominatim allows 1/sec). */
export async function geocodeMissing(db, limit = 10) {
  if (!['nominatim', 'google'].includes(getSettings(db).geocoder)) return 0;
  let n = 0;
  for (const table of ['locations', 'customers']) {
    const addrCol = table === 'customers' ? "COALESCE(NULLIF(service_address,''), billing_address)" : 'address';
    const rows = db.prepare(`SELECT id, ${addrCol} AS address, city, state, zip FROM ${table} WHERE lat IS NULL AND COALESCE(${addrCol},'') <> '' AND COALESCE(geocode_failed,0) = 0 LIMIT ?`).all(limit - n);
    for (const r of rows) {
      try { const g = await geocode(db, addrOf(r)); db.prepare(`UPDATE ${table} SET lat = ?, lng = ? WHERE id = ?`).run(g.lat, g.lng, r.id); n++; }
      catch { db.prepare(`UPDATE ${table} SET geocode_failed = 1 WHERE id = ?`).run(r.id); }
      await new Promise(res => setTimeout(res, getSettings(db).geocoder === 'nominatim' ? 1100 : 50));
    }
  }
  return n;
}

// Moving an address clears its coordinates so they're looked up again.
for (const table of ['customers', 'locations']) {
  registerHooks(table, {
    beforeSave(db, data, { existing, body }) {
      if (!existing || 'lat' in body) return;
      const keys = table === 'customers' ? ['service_address', 'billing_address', 'city', 'state', 'zip'] : ['address', 'city', 'state', 'zip'];
      if (keys.some(k => k in data && data[k] !== existing[k])) { data.lat = null; data.lng = null; }
    },
  });
}

// ---------------------------------------------------------------- routing / travel time
const key = p => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
/** Straight-line distance × 1.3 for roads, at an average speed. Always available. */
export function estimateMinutes(db, a, b) {
  const mph = Math.max(10, Number(getSettings(db).avg_speed_mph) || 30);
  const miles = distanceM(a, b) / 1609.34 * 1.3;
  return Math.round(miles / mph * 60);
}
/** Best known drive time: a cached route if we have one, else the estimate. Synchronous (used while saving). */
export function knownMinutes(db, a, b) {
  const c = db.prepare("SELECT minutes FROM route_cache WHERE from_key = ? AND to_key = ? AND updated_at > datetime('now','localtime','-30 days')").get(key(a), key(b));
  return c ? { minutes: c.minutes, source: 'route' } : { minutes: estimateMinutes(db, a, b), source: 'estimate' };
}
/** Ask the routing service for a real drive time (cached). Falls back to the estimate. */
export async function routeMinutes(db, a, b) {
  const s = getSettings(db);
  try {
    let seconds = null;
    if (s.routing === 'osrm') {
      const base = (process.env.OSRM_BASE || s.osrm_url || 'https://router.project-osrm.org').replace(/\/$/, '');
      const r = await (await fetch(`${base}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false`, { headers: { 'User-Agent': UA } })).json();
      seconds = r.routes?.[0]?.duration;
    } else if (s.routing === 'google') {
      const k = secret(db, 'google_maps_key', 'GOOGLE_MAPS_KEY');
      const base = process.env.GOOGLE_MAPS_BASE || 'https://maps.googleapis.com';
      const r = await (await fetch(`${base}/maps/api/distancematrix/json?origins=${a.lat},${a.lng}&destinations=${b.lat},${b.lng}&departure_time=now&key=${encodeURIComponent(k)}`)).json();
      const el = r.rows?.[0]?.elements?.[0];
      seconds = el?.duration_in_traffic?.value ?? el?.duration?.value;
    }
    if (Number.isFinite(seconds)) {
      const minutes = Math.round(seconds / 60);
      db.prepare(`INSERT INTO route_cache (from_key, to_key, minutes, source, updated_at) VALUES (?,?,?,?,datetime('now','localtime'))
        ON CONFLICT(from_key, to_key) DO UPDATE SET minutes = excluded.minutes, source = excluded.source, updated_at = excluded.updated_at`).run(key(a), key(b), minutes, s.routing);
      return { minutes, source: s.routing };
    }
  } catch { /* fall through to estimate */ }
  return { minutes: estimateMinutes(db, a, b), source: 'estimate' };
}

/** Where is this job? Site coordinates, else the customer's. */
export function jobPoint(db, call) {
  const r = db.prepare(`SELECT COALESCE(l.lat, c.lat) AS lat, COALESCE(l.lng, c.lng) AS lng FROM customers c LEFT JOIN locations l ON l.id = ?
    WHERE c.id = ?`).get(call.site_id || 0, call.customer_id);
  return r && r.lat != null && r.lng != null ? { lat: r.lat, lng: r.lng } : null;
}

const toMin = s => { const [d, t] = s.split('T'); const [h, m] = t.split(':').map(Number); return Math.round(new Date(d + 'T00:00:00Z').getTime() / 60000) + h * 60 + m; };
const hhmm = m => { const d = new Date(m * 60000); return d.toISOString().slice(11, 16); };
const fmt12 = hm => { const [h, m] = hm.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };

/** Can the tech get from the job before to this one (and from this one to the next) in time? */
export function travelProblem(db, call) {
  const s = getSettings(db);
  if (s.travel_check === 'off' || !call.technician_id || !call.scheduled_start || ['cancelled', 'completed'].includes(call.status)) return null;
  const here = jobPoint(db, call);
  if (!here) return null;
  const buffer = Math.max(0, Number(s.travel_buffer_min) || 0);
  const start = toMin(call.scheduled_start), end = start + Math.max(0.25, Number(call.duration_hours) || 1) * 60;
  const sameDay = db.prepare(`SELECT sc.*, c.name AS customer FROM service_calls sc JOIN customers c ON c.id = sc.customer_id
    WHERE sc.technician_id = ? AND sc.id <> ? AND substr(sc.scheduled_start,1,10) = ? AND sc.status NOT IN ('cancelled')`).all(call.technician_id, call.id || 0, call.scheduled_start.slice(0, 10));
  const prev = sameDay.filter(o => toMin(o.scheduled_start) < start).sort((a, b) => b.scheduled_start.localeCompare(a.scheduled_start))[0];
  const next = sameDay.filter(o => toMin(o.scheduled_start) >= end).sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start))[0];
  if (prev) {
    const p = jobPoint(db, prev);
    if (p) {
      const t = knownMinutes(db, p, here);
      const free = toMin(prev.scheduled_start) + Math.max(0.25, Number(prev.duration_hours) || 1) * 60;
      if (free + t.minutes + buffer > start) return { minutes: t.minutes, source: t.source, message: `Not enough travel time: SC-${prev.number} (${prev.customer}) ends at ${fmt12(hhmm(free))} and it's about ${t.minutes} min${t.source === 'estimate' ? ' (estimated)' : ''} to get here${buffer ? ` plus a ${buffer}-min buffer` : ''}. Earliest arrival is ${fmt12(hhmm(free + t.minutes + buffer))}.` };
    }
  }
  if (next) {
    const n = jobPoint(db, next);
    if (n) {
      const t = knownMinutes(db, here, n);
      if (end + t.minutes + buffer > toMin(next.scheduled_start)) return { minutes: t.minutes, source: t.source, message: `Not enough travel time to the next job: SC-${next.number} (${next.customer}) starts at ${fmt12(next.scheduled_start.slice(11, 16))}, and it's about ${t.minutes} min${t.source === 'estimate' ? ' (estimated)' : ''} from here after this job ends at ${fmt12(hhmm(end))}.` };
    }
  }
  return null;
}

registerHooks('service_calls', {
  beforeSave(db, data, { existing, isCreate, user, body }) {
    if (body?.allow_conflict) return;
    const touched = isCreate || ['technician_id', 'scheduled_start', 'duration_hours', 'site_id', 'customer_id', 'status'].some(k => k in data && data[k] !== existing?.[k]);
    if (!touched) return;
    const merged = { ...existing, ...data, id: existing?.id };
    if (!isCreate && 'status' in data && !['technician_id', 'scheduled_start', 'duration_hours'].some(k => k in data && data[k] !== existing[k])) return; // status-only changes
    const p = travelProblem(db, merged);
    if (!p) return;
    const canOverride = ['owner', 'admin'].includes(user?.role);
    const e = new HttpError(409, p.message + (canOverride ? ' Pick another time or tech, or book anyway.' : ' Pick another time or technician.'));
    e.code = 'conflict'; e.canOverride = canOverride; e.kind = 'travel';
    throw e;
  },
});

// ---------------------------------------------------------------- live view
function positions(db) {
  return db.prepare(`SELECT v.id AS vehicle_id, v.unit_name, v.tracking_url, v.camera_url, v.assigned_technician_id AS technician_id,
      t.name AS tech_name, t.color, p.lat, p.lng, p.speed_mph, p.heading, p.recorded_at, p.address, p.source
    FROM vehicles v LEFT JOIN technicians t ON t.id = v.assigned_technician_id LEFT JOIN vehicle_positions p ON p.vehicle_id = v.id
    WHERE v.status = 'in service' ORDER BY v.unit_name`).all();
}

/** Each tech today: where they are, what's next, how long to get there, and whether they'll make it. */
export async function teamStatus(db) {
  const now = nowLocal();
  const nowMin = toMin(now);
  const vans = positions(db);
  const techs = db.prepare('SELECT id, name, color, phone FROM technicians WHERE active = 1 ORDER BY name').all();
  const out = [];
  for (const t of techs) {
    const jobs = db.prepare(`SELECT sc.id, sc.number, sc.title, sc.status, sc.scheduled_start, sc.duration_hours, sc.customer_id, sc.site_id, c.name AS customer
      FROM service_calls sc JOIN customers c ON c.id = sc.customer_id WHERE sc.technician_id = ? AND substr(sc.scheduled_start,1,10) = ? AND sc.status <> 'cancelled'
      ORDER BY sc.scheduled_start`).all(t.id, todayLocal()).map(j => ({ ...j, point: jobPoint(db, j) }));
    const van = vans.find(v => v.technician_id === t.id) || null;
    const clock = db.prepare('SELECT clock_in, in_flag FROM time_entries WHERE technician_id = ? AND clock_out IS NULL ORDER BY id DESC LIMIT 1').get(t.id) || null;
    const current = jobs.find(j => ['en route', 'in progress'].includes(j.status)) || null;
    const next = jobs.find(j => j !== current && !['completed', 'in progress'].includes(j.status) && toMin(j.scheduled_start) >= nowMin - 60) || null;
    let eta = null;
    const target = current?.status === 'en route' ? current : next;
    if (van?.lat != null && target?.point) {
      const r = await routeMinutes(db, { lat: van.lat, lng: van.lng }, target.point);
      // If they're still on a job, they leave when it ends.
      const busyUntil = current?.status === 'in progress' ? toMin(current.scheduled_start) + Math.max(0.25, Number(current.duration_hours) || 1) * 60 : nowMin;
      const arrive = Math.max(nowMin, busyUntil) + r.minutes;
      const late = arrive - toMin(target.scheduled_start);
      eta = { job_id: target.id, minutes: r.minutes, source: r.source, arrive: hhmm(arrive), late_minutes: Math.max(0, late), risk: late > 0 ? 'late' : late > -10 ? 'tight' : 'ok' };
    }
    out.push({ technician_id: t.id, name: t.name, color: t.color, phone: t.phone, vehicle: van, clock, jobs: jobs.length, done: jobs.filter(j => j.status === 'completed').length,
      current: current && { id: current.id, number: current.number, customer: current.customer, status: current.status },
      next: next && { id: next.id, number: next.number, customer: next.customer, scheduled_start: next.scheduled_start, point: next.point }, eta });
  }
  return out;
}

export function registerTrackingRoutes(r) {
  r('GET', '/api/tracking/live', MANAGE, async ({ db }) => {
    const s = getSettings(db);
    const jobs = db.prepare(`SELECT sc.id, sc.number, sc.title, sc.status, sc.scheduled_start, sc.customer_id, sc.site_id, sc.technician_id, c.name AS customer, t.color, t.name AS tech_name
      FROM service_calls sc JOIN customers c ON c.id = sc.customer_id LEFT JOIN technicians t ON t.id = sc.technician_id
      WHERE substr(sc.scheduled_start,1,10) = ? AND sc.status <> 'cancelled'`).all(todayLocal()).map(j => ({ ...j, point: jobPoint(db, j) }));
    return { vehicles: positions(db), team: await teamStatus(db), jobs, office: officePoint(s), tiles: s.map_tiles || DEFAULT_SETTINGS.map_tiles, provider: s.tracking_provider, last_poll: lastPoll };
  });
  r('POST', '/api/tracking/refresh', MANAGE, async ({ db }) => pollPositions(db));
  r('GET', '/api/tracking/setup', MANAGE, ({ db }) => {
    const s = getSettings(db);
    return { provider: s.tracking_provider, tiles: s.map_tiles || DEFAULT_SETTINGS.map_tiles, last_poll: lastPoll, push_url: `/api/inbound/tracking/${s.tracking_token}`, providers: PROVIDERS,
      missing_coords: db.prepare("SELECT (SELECT COUNT(*) FROM customers WHERE lat IS NULL) + (SELECT COUNT(*) FROM locations WHERE lat IS NULL) AS n").get().n };
  });
  r('POST', '/api/geocode', G.staff, async ({ db, body }) => geocode(db, body.address));
  r('POST', '/api/geocode/missing', MANAGE, async ({ db, user }) => { const n = await geocodeMissing(db, 25); audit(db, user, 'look up map locations', 'customers', null, String(n)); return { found: n }; });
  r('POST', '/api/travel-time', G.staff, async ({ db, body }) => {
    // Preview for the scheduler: real drive time from the previous job (fills the cache the save check uses).
    const call = { id: Number(body.id) || 0, customer_id: Number(body.customer_id), site_id: Number(body.site_id) || null, technician_id: Number(body.technician_id), scheduled_start: body.scheduled_start, duration_hours: Number(body.duration_hours) || 1, status: 'scheduled' };
    const here = call.customer_id && jobPoint(db, call);
    if (!here || !call.technician_id || !call.scheduled_start) return { checked: false };
    const others = db.prepare("SELECT * FROM service_calls WHERE technician_id = ? AND id <> ? AND substr(scheduled_start,1,10) = ? AND status <> 'cancelled'").all(call.technician_id, call.id, call.scheduled_start.slice(0, 10));
    for (const o of others) { const p = jobPoint(db, o); if (p) { await routeMinutes(db, p, here); await routeMinutes(db, here, p); } }
    const problem = travelProblem(db, call);
    return { checked: true, ok: !problem, message: problem?.message || null };
  });
  r('GET', '/api/vehicles/:id/location', MANAGE, ({ db, params }) => db.prepare('SELECT * FROM vehicle_positions WHERE vehicle_id = ?').get(Number(params.id)) || null);

  // Push webhook for providers that send locations instead of being polled.
  r('POST', '/api/inbound/tracking/:token', null, ({ db, params, body }) => {
    const s = getSettings(db);
    const a = Buffer.from(String(params.token)), b = Buffer.from(String(s.tracking_token || ''));
    if (!s.tracking_token || a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new HttpError(404, 'Not found');
    const list = Array.isArray(body) ? body : body.vehicles || body.data || [body];
    return { stored: storePositions(db, list.map(point).filter(Boolean), 'push') };
  });
}
