// Live map + team dashboard (owners/admins): where every truck is, today's jobs, and whether
// each tech will make their next appointment.
import { html, mount, $, $$, fmtTime, fmtDateTime, badge, loading, toast, esc } from '../ui.js';
import { GET, POST } from '../api.js';

let leaflet = null;
export function loadLeaflet() {
  if (leaflet) return leaflet;
  leaflet = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = '/vendor/leaflet/leaflet.css';
    document.head.append(css);
    const s = document.createElement('script');
    s.src = '/vendor/leaflet/leaflet.js';
    s.onload = () => resolve(window.L);
    s.onerror = () => { leaflet = null; reject(new Error('Map failed to load')); };
    document.head.append(s);
  });
  return leaflet;
}

const ago = t => {
  if (!t) return 'no signal';
  const m = Math.round((Date.now() - new Date(t)) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : fmtDateTime(t);
};
const RISK = { ok: ['On time', 'good'], tight: ['Tight', 'warn'], late: ['Running late', 'bad'] };
const pin = (L, color, label, shape = 'truck') => L.divIcon({
  className: 'map-pin', iconSize: [30, 30], iconAnchor: [15, 15],
  html: `<span class="pin ${shape}" style="--c:${esc(color || '#2563eb')}">${esc(label)}</span>`,
});

export async function render(view) {
  loading(view);
  const d = await GET('/api/tracking/live');
  const tracked = d.vehicles.filter(v => v.lat != null);
  mount(view, html`
    <div class="page-head"><div><h1>Live map</h1><div class="sub">${tracked.length} of ${d.vehicles.length} trucks reporting${d.last_poll?.at ? ` · updated ${fmtTime(d.last_poll.at)}` : ''}${d.last_poll?.error ? ` · ⚠️ ${d.last_poll.error}` : ''}</div></div>
      <div class="actions">${d.provider && d.provider !== 'none' ? html`<button class="btn" data-refresh>Refresh now</button>` : ''}<a class="btn" href="#/settings?tab=tracking">Tracking settings</a></div></div>
    ${!d.provider || d.provider === 'none' ? html`<div class="note" style="margin-bottom:16px">🛰️ Connect your GPS tracking (Samsara or another provider) under <a href="#/settings?tab=tracking">Settings → Tracking & maps</a> to see trucks move. Jobs and the office show either way.</div>` : ''}
    <div class="map-layout">
      <div class="card map-card"><div id="livemap" class="livemap" role="region" aria-label="Map of trucks and today's jobs"></div></div>
      <div class="stack" style="gap:10px">${d.team.filter(t => t.jobs || t.vehicle).map(t => html`<div class="card team-card" data-tech="${t.technician_id}">
        <div class="card-body">
          <div class="row" style="justify-content:space-between"><b><span class="dot" style="background:${t.color}"></span> ${t.name}</b>
            ${t.eta ? badge(RISK[t.eta.risk][0], RISK[t.eta.risk][1]) : ''}</div>
          <div class="small muted" style="margin-top:4px">${t.vehicle ? html`${t.vehicle.unit_name} · ${t.vehicle.lat != null ? `${Math.round(t.vehicle.speed_mph || 0)} mph · ${ago(t.vehicle.recorded_at)}` : 'no GPS'}` : 'No truck'}
            · ${t.clock ? `on the clock since ${fmtTime(t.clock.clock_in)}` : 'not clocked in'}</div>
          ${t.current ? html`<div class="small" style="margin-top:6px">${badge(t.current.status)} <a href="#/calls/${t.current.id}">SC-${t.current.number}</a> ${t.current.customer}</div>` : ''}
          ${t.next ? html`<div class="small" style="margin-top:6px">Next: <a href="#/calls/${t.next.id}">${fmtTime(t.next.scheduled_start)} ${t.next.customer}</a>
            ${t.eta ? html`<div class="muted">~${t.eta.minutes} min drive${t.eta.source === 'estimate' ? ' (est.)' : ''} · arrives ${t.eta.arrive}${t.eta.late_minutes ? html` · <b style="color:var(--bad)">${t.eta.late_minutes} min late</b>` : ''}</div>` : ''}</div>`
          : html`<div class="small muted" style="margin-top:6px">${t.done}/${t.jobs} jobs done today</div>`}
          <div class="row" style="margin-top:8px">
            ${t.phone ? html`<a class="btn sm" href="tel:${t.phone}">Call</a>` : ''}
            ${t.vehicle ? html`<a class="btn sm" href="#/vehicles/${t.vehicle.vehicle_id}">Truck</a>` : ''}
            ${t.vehicle?.tracking_url ? html`<a class="btn sm" href="${t.vehicle.tracking_url}" target="_blank" rel="noopener">Tracking ↗</a>` : ''}
            ${t.vehicle?.camera_url ? html`<a class="btn sm" href="${t.vehicle.camera_url}" target="_blank" rel="noopener">Dash cam ↗</a>` : ''}
          </div></div></div>`)}
        ${!d.team.some(t => t.jobs || t.vehicle) ? html`<div class="card"><div class="empty">No technicians scheduled today.</div></div>` : ''}</div>
    </div>`);
  $('[data-refresh]', view)?.addEventListener('click', async () => { const r = await POST('/api/tracking/refresh'); toast(r.error ? r.error : `${r.count} trucks updated`, r.error ? 'error' : ''); render(view); });

  let L;
  try { L = await loadLeaflet(); } catch (e) { mount($('#livemap', view), html`<div class="empty">${e.message}</div>`); return; }
  const el = $('#livemap', view);
  if (!el) return;
  const map = L.map(el, { scrollWheelZoom: true });
  L.tileLayer(d.tiles, { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
  const pts = [];
  if (d.office) { L.marker([d.office.lat, d.office.lng], { icon: pin(L, '#0f172a', '🏢', 'office'), title: 'Office' }).addTo(map).bindPopup('Office'); pts.push([d.office.lat, d.office.lng]); }
  for (const j of d.jobs.filter(j => j.point)) {
    L.marker([j.point.lat, j.point.lng], { icon: pin(L, j.color || '#64748b', '●', `job ${j.status.replace(' ', '-')}`), title: j.customer }).addTo(map)
      .bindPopup(`<b>${esc(j.customer)}</b><br>${esc(fmtTime(j.scheduled_start))} · SC-${j.number} · ${esc(j.status)}<br>${esc(j.tech_name || 'Unassigned')}<br><a href="#/calls/${j.id}">Open job</a>`);
    pts.push([j.point.lat, j.point.lng]);
  }
  const vanMarkers = {};
  for (const v of tracked) {
    vanMarkers[v.technician_id] = L.marker([v.lat, v.lng], { icon: pin(L, v.color || '#2563eb', (v.tech_name || v.unit_name).split(' ').map(x => x[0]).join('').slice(0, 2)), title: v.unit_name, zIndexOffset: 1000 }).addTo(map)
      .bindPopup(`<b>${esc(v.unit_name)}</b> — ${esc(v.tech_name || 'unassigned')}<br>${esc(v.address || '')}<br>${Math.round(v.speed_mph || 0)} mph · ${esc(ago(v.recorded_at))}${v.tracking_url ? `<br><a href="${esc(v.tracking_url)}" target="_blank" rel="noopener">Open in tracking ↗</a>` : ''}${v.camera_url ? ` · <a href="${esc(v.camera_url)}" target="_blank" rel="noopener">Dash cam ↗</a>` : ''}`);
    pts.push([v.lat, v.lng]);
  }
  if (pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 13 }); else map.setView([39.5, -98.35], 4);
  $$('[data-tech]', view).forEach(c => c.addEventListener('click', e => {
    if (e.target.closest('a,button')) return;
    const m = vanMarkers[c.dataset.tech];
    if (m) { map.setView(m.getLatLng(), 14); m.openPopup(); }
  }));
  // Keep it live while the page is open.
  const timer = setInterval(async () => {
    if (!document.body.contains(el)) return clearInterval(timer);
    const fresh = await GET('/api/tracking/live').catch(() => null);
    for (const v of fresh?.vehicles || []) if (v.lat != null && vanMarkers[v.technician_id]) vanMarkers[v.technician_id].setLatLng([v.lat, v.lng]);
  }, 60000);
}

/** Vehicle page card: last position, small map, links to the provider and dash cam. */
export async function vehicleLocationCard(card, v) {
  const p = await GET(`/api/vehicles/${v.id}/location`).catch(() => null);
  mount(card, html`<div class="card-head"><div><h2>Location & cameras</h2><div class="small muted">${p ? `${p.address || `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`} · ${Math.round(p.speed_mph || 0)} mph · ${ago(p.recorded_at)}` : 'No GPS position yet'}</div></div>
      <div class="row">${v.tracking_url ? html`<a class="btn sm" href="${v.tracking_url}" target="_blank" rel="noopener">Open in tracking ↗</a>` : ''}
        ${v.camera_url ? html`<a class="btn sm primary" href="${v.camera_url}" target="_blank" rel="noopener">Dash cam ↗</a>` : ''}
        <a class="btn sm" href="#/map">Live map</a></div></div>
    ${p ? html`<div class="minimap" data-mini></div>` : html`<div class="card-body small muted">Add this truck's tracker ID and links with “Edit”, and connect tracking under Settings → Tracking & maps.</div>`}`);
  if (!p) return;
  try {
    const L = await loadLeaflet();
    const tiles = (await GET('/api/tracking/setup').catch(() => ({}))).tiles;
    const m = L.map($('[data-mini]', card), { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false }).setView([p.lat, p.lng], 14);
    L.tileLayer(tiles || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(m);
    L.marker([p.lat, p.lng], { icon: pin(L, '#2563eb', '🚚') }).addTo(m);
  } catch { /* map optional */ }
}

/** Settings → Tracking & maps */
export async function settingsPane(pane, { settingsCards, wireSettingsCards }) {
  const [s, setup] = await Promise.all([GET('/api/settings'), GET('/api/tracking/setup')]);
  mount(pane, settingsCards(s, [
    { title: 'GPS tracking', intro: html`<p class="muted" style="margin-top:0">${setup.provider !== 'none' ? html`${setup.last_poll?.error ? badge('error', 'bad') : badge('connected', 'good')} ${setup.last_poll?.at ? `Last update ${fmtTime(setup.last_poll.at)} (${setup.last_poll.count} trucks)${setup.last_poll.error ? ` — ${setup.last_poll.error}` : ''}` : 'Waiting for the first update'}` : 'Shows where every truck is on the live map, and live arrival times.'}</p>`,
      fields: [
        ['tracking_provider', 'Tracking provider', 'select', Object.entries(setup.providers).map(([k, p]) => [k, p.label])],
        ['samsara_token', 'Samsara API token (read-only “Vehicles” scope is enough)', 'secret'],
        ['tracking_feed_url', 'Other provider: JSON feed URL', 'text'],
        ['tracking_feed_token', 'Other provider: feed token (optional)', 'secret'],
        ['tracking_poll_minutes', 'Check every (minutes)', 'number'],
      ],
      note: html`Trucks are matched by the tracker ID on each vehicle, or by unit name. Providers that push updates can POST to <span class="mono">${location.origin}${setup.push_url}</span> with <span class="mono">[{"id","lat","lng","speed","time"}]</span>. Dash-cam and tracking links are set per vehicle.` },
    { title: 'Maps & drive times', fields: [
      ['geocoder', 'Find addresses on the map with', 'select', [['off', 'Off'], ['nominatim', 'OpenStreetMap (free, 1 lookup/sec)'], ['google', 'Google Maps (API key)']]],
      ['routing', 'Drive times from', 'select', [['estimate', 'Straight-line estimate'], ['osrm', 'OSRM road routing (free public server or your own)'], ['google', 'Google Maps with live traffic (API key)']]],
      ['google_maps_key', 'Google Maps API key', 'secret'],
      ['osrm_url', 'OSRM server', 'text'],
      ['avg_speed_mph', 'Average speed for estimates (mph)', 'number'],
      ['map_tiles', 'Map tiles URL', 'text'],
    ], extra: html`<div class="row" style="margin-top:10px"><button class="btn sm" data-geo>Look up ${setup.missing_coords} addresses now</button></div>` },
    { title: 'Scheduling', fields: [
      ['travel_check', 'Block booking a tech where they can’t get there in time (owners/admins can book anyway)', 'select', [['on', 'On'], ['off', 'Off']]],
      ['travel_buffer_min', 'Extra minutes between jobs', 'number'],
    ], note: 'Uses the drive time between the job before and the job after on the same day.' },
  ]));
  wireSettingsCards(pane, () => settingsPane(pane, { settingsCards, wireSettingsCards }));
  $('[data-geo]', pane)?.addEventListener('click', async e => {
    e.target.disabled = true; e.target.textContent = 'Looking up…';
    try { const r = await POST('/api/geocode/missing'); toast(`${r.found} addresses found`); } catch (err) { toast(err.message, 'error'); }
    settingsPane(pane, { settingsCards, wireSettingsCards });
  });
}
