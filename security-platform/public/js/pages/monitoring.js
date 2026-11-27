import { html, raw, mount, $, $$, badge, typeBadge, dataTable, openForm, openModal, promptForm, loading, toast, confirmDialog, secretView, fmtDateTime, fmtDate, renderValue, icon } from '../ui.js';
import { R, GET, POST } from '../api.js';
import { can, refresh } from '../app.js';
import { RESOURCES } from '../schema.js';

const STATUS_CLS = { active: 'good', pending: 'info', 'on test': 'warn', 'out of service': 'bad', cancelled: '' };
export const mBadge = s => badge(s, STATUS_CLS[s] ?? '');
const EV = {
  alarm: ['bad', 'Alarm'], trouble: ['warn', 'Trouble'], restore: ['good', 'Restore'], 'open/close': ['info', 'Open/close'], test: ['primary', 'Test'],
  supervisory: ['warn', 'Supervisory'], cancel: ['', 'Cancel'], note: ['', 'Note'], system: ['', 'Change'], other: ['', 'Other'],
};
const evBadge = t => badge(EV[t]?.[1] || t, EV[t]?.[0] ?? '');
const DURATIONS = [[30, '30 minutes'], [60, '1 hour'], [120, '2 hours'], [240, '4 hours'], [480, '8 hours'], [1440, '24 hours'], [2880, '48 hours']];

export function accountsTable(rows, empty = 'No monitoring accounts yet.') {
  return dataTable({
    rows, href: a => `#/monitoring/${a.id}`, empty,
    columns: [
      { label: 'Account', render: a => html`<b class="mono">${a.account_number || 'pending'}</b><div class="small muted">${a.station_id_label}</div>` },
      { label: 'Customer / site', render: a => html`${a.customer_id_label}${a.site_id_label ? html`<div class="small muted">${a.site_id_label.split(' — ')[0]}</div>` : ''}` },
      { label: 'Monitored for', render: a => a.service_type },
      { label: 'Status', render: a => html`${mBadge(a.status)}${a.status === 'on test' ? html`<div class="small muted">until ${fmtDateTime(a.test_until)}</div>` : ''}${!a.station_synced ? html`<div class="small" style="color:var(--warn)">not confirmed with station</div>` : ''}` },
    ],
  });
}

export function newAccount(defaults = {}, onSaved) {
  return R.list('monitoring_stations', { active: 1 }).then(st => {
    if (!st.length) { toast('Add a monitoring station first (Monitoring → Stations)', 'error'); return; }
    return openForm('monitoring_accounts', { title: 'New monitoring account', defaults: { station_id: st[0].id, ...defaults }, hide: defaults.customer_id ? ['customer_id'] : [],
      onSaved: onSaved || (a => { location.hash = `#/monitoring/${a.id}`; }) });
  });
}

// ------------------------------------------------------------------ list
export async function list(view, _, query) {
  const f = { status: query.status || '', station_id: '', q: '' };
  const stations = await R.list('monitoring_stations');
  mount(view, html`
    <div class="page-head"><div><h1>Alarm monitoring</h1><div class="sub">Central-station accounts, zones, call lists, activity and test mode</div></div>
      <div class="actions">${can.manage() ? html`<a class="btn" href="#/monitoring-stations">Stations</a><button class="btn" data-import>Import from alarm systems</button>` : ''}
        ${can.staff() ? html`<button class="btn primary" data-new>+ Monitoring account</button>` : ''}</div></div>
    <div class="kpis" data-kpis></div>
    <div class="filters">
      <div class="seg" data-status>${[['', 'All'], ['active', 'Active'], ['on test', 'On test'], ['pending', 'Pending'], ['out of service', 'Out of service'], ['cancelled', 'Cancelled']].map(([v, l]) => html`<button data-v="${v}">${l}</button>`)}</div>
      ${stations.length > 1 ? html`<select data-station aria-label="Station"><option value="">All stations</option>${stations.map(s => html`<option value="${s.id}">${s.name}</option>`)}</select>` : ''}
      <input type="search" placeholder="Account #, communicator ID, permit #" data-q aria-label="Search accounts">
    </div>
    <div class="card"><div class="card-body flush" data-table></div></div>`);
  const load = async () => {
    $$('[data-status] button', view).forEach(b => b.classList.toggle('on', b.dataset.v === f.status));
    const [rows, all] = await Promise.all([R.list('monitoring_accounts', f), R.list('monitoring_accounts')]);
    const n = s => all.filter(a => a.status === s).length;
    mount($('[data-kpis]', view), html`
      <div class="kpi"><div class="label">Active accounts</div><div class="value">${n('active')}</div></div>
      <a class="kpi ${n('on test') ? 'alert' : ''}" href="#/monitoring?status=on%20test"><div class="label">On test right now</div><div class="value">${n('on test')}</div></a>
      <div class="kpi"><div class="label">Pending setup</div><div class="value">${n('pending')}</div></div>
      <div class="kpi ${all.some(a => !a.station_synced) ? 'alert' : ''}"><div class="label">Changes to confirm with station</div><div class="value">${all.filter(a => !a.station_synced && a.status !== 'cancelled').length}</div></div>`);
    mount($('[data-table]', view), accountsTable(rows, stations.length ? 'No accounts match.' : 'Start by adding your monitoring station under “Stations”.'));
  };
  $('[data-status]', view).addEventListener('click', e => { if (e.target.dataset.v !== undefined) { f.status = e.target.dataset.v; load(); } });
  $('[data-station]', view)?.addEventListener('change', e => { f.station_id = e.target.value; load(); });
  let t;
  $('[data-q]', view).addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { f.q = e.target.value; load(); }, 250); });
  $('[data-new]', view)?.addEventListener('click', () => newAccount());
  $('[data-import]', view)?.addEventListener('click', async () => {
    if (!(await confirmDialog('Create monitoring accounts from the “monitoring center” and “account #” already entered on alarm systems? Ones already linked are skipped.', { okLabel: 'Import' }))) return;
    const r = await POST('/api/monitoring/import-alarm-systems'); toast(`${r.created} account(s) created`); load();
  });
  await load();
}

// ------------------------------------------------------------------ detail
export async function detail(view, [id], query) {
  loading(view);
  const [a, station, zones, contacts, events] = await Promise.all([
    R.get('monitoring_accounts', id), GET(`/api/monitoring/${id}/station`), R.list('monitoring_zones', { account_id: id }),
    R.list('monitoring_contacts', { account_id: id }), GET(`/api/monitoring/${id}/events`, { limit: 500 }),
  ]);
  const reload = () => refresh();
  const tab = query.tab || 'overview';
  const activeZones = zones.filter(z => z.active);
  const unconfirmed = !a.station_synced || zones.some(z => !z.station_synced);
  const def = RESOURCES.monitoring_accounts;
  const callStation = station.operator_phone ? html`<a href="tel:${station.operator_phone}"><b>${station.operator_phone}</b></a>` : 'the station';

  mount(view, html`
    <div class="crumbs"><a href="#/monitoring">Monitoring</a> / <a href="#/customers/${a.customer_id}?tab=monitoring">${a.customer_id_label}</a></div>
    <div class="page-head"><div>
        <h1><span class="mono">${a.account_number || 'Number pending'}</span> ${mBadge(a.status)}</h1>
        <div class="sub">${station.name} · ${a.service_type}${a.site_id_label ? ` · ${a.site_id_label.split(' — ')[0]}` : ''} · ${a.customer_id_label}</div></div>
      <div class="actions">
        ${a.status === 'on test' ? html`<button class="btn primary" data-offtest>Take off test</button>` : html`<button class="btn primary" data-ontest ${a.status === 'cancelled' ? raw('disabled') : ''}>Put on test</button>`}
        <button class="btn" data-log>Log activity</button>
        <button class="btn" data-edit>Edit account</button></div></div>
    ${a.status === 'on test' ? html`<div class="banner warn" style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <span>🧪 <b>On test until ${fmtDateTime(a.test_until)}</b>${a.test_reason ? ` — ${a.test_reason}` : ''}${a.test_by ? ` (by ${a.test_by})` : ''}. Signals received now are marked as test.</span></div>` : ''}
    ${!station.connected ? html`<div class="note" style="margin-bottom:16px">
      <b>${station.name} isn't connected to SecureOps yet.</b> Changes made here (tests, zones, call list, account details) are recorded here only. Make them at the station too — call ${callStation}${station.dealer_portal ? html` or use the <a href="${station.dealer_portal.startsWith('http') ? station.dealer_portal : 'https://' + station.dealer_portal}" target="_blank" rel="noopener">dealer portal</a>` : ''}${station.dealer_number ? `, dealer # ${station.dealer_number}` : ''} — then mark it confirmed.
      ${unconfirmed ? html`<div class="row" style="margin-top:8px"><span style="color:var(--warn)">● Changes not yet confirmed with the station</span><button class="btn sm" data-confirm>Confirmed with station</button></div>` : html`<div class="small" style="margin-top:6px">✔ Everything here has been confirmed with the station.</div>`}</div>` : ''}
    <div class="tabs">${[['overview', 'Overview'], ['zones', `Zones (${activeZones.length})`], ['calllist', `Call list (${contacts.length})`], ['activity', 'Activity']].map(([k, l]) => html`<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${l}</button>`)}</div>
    <div data-pane></div>`);

  $$('[data-tab]', view).forEach(b => b.addEventListener('click', () => { location.hash = `#/monitoring/${id}?tab=${b.dataset.tab}`; }));
  $('[data-edit]', view).addEventListener('click', () => openForm('monitoring_accounts', { record: a, hide: ['customer_id'], onSaved: reload, onDeleted: () => { location.hash = '#/monitoring'; }, allowDelete: can.manage() }));
  $('[data-ontest]', view)?.addEventListener('click', () => testDialog(a, station, reload));
  $('[data-offtest]', view)?.addEventListener('click', async () => {
    const r = await POST(`/api/monitoring/${id}/test/clear`);
    toast(r.station_confirmed ? 'Off test at the station' : `Off test here. Remember to tell ${station.name}.`); reload();
  });
  $('[data-confirm]', view)?.addEventListener('click', async () => { await POST(`/api/monitoring/${id}/confirmed`); toast('Marked as confirmed'); reload(); });
  $('[data-log]', view).addEventListener('click', () => promptForm({
    title: 'Log activity', size: '',
    intro: html`<p class="muted" style="margin-top:0">Record a call with the station, an alarm the customer reported, a cancel, etc.</p>`,
    fields: [
      { name: 'type', label: 'Type', type: 'select', value: 'note', options: [['note', 'Note'], ['alarm', 'Alarm'], ['trouble', 'Trouble'], ['restore', 'Restore'], ['cancel', 'Cancel / false alarm'], ['test', 'Test'], ['other', 'Other']].map(([value, label]) => ({ value, label })) },
      { name: 'zone', label: 'Zone # (optional)', type: 'number' },
      { name: 'description', label: 'What happened', type: 'textarea' },
      { name: 'disposition', label: 'Action taken (optional)', value: '' },
    ],
    onSubmit: async d => { await POST(`/api/monitoring/${id}/events`, d); toast('Logged'); reload(); },
  }));

  const pane = $('[data-pane]', view);
  if (tab === 'overview') {
    const show = ['station_id', 'account_number', 'status', 'service_type', 'site_id', 'alarm_system_id', 'panel', 'communicator', 'comm_id', 'receiver_line', 'permit_number', 'permit_expires', 'monitoring_start'];
    const recent = events.filter(e => e.event_type !== 'system').slice(0, 8);
    mount(pane, html`<div class="grid g3">
      <div class="card span2"><div class="card-head"><h2>Account</h2></div><div class="card-body"><dl class="dl">
        ${def.fields.filter(f => show.includes(f.name) && a[f.name] != null && a[f.name] !== '').map(f => html`<dt>${f.label}</dt><dd>${renderValue(f, a, 'monitoring_accounts')}</dd>`)}
        <dt>Passcode</dt><dd>${secretView('monitoring_accounts', a.id, 'passcode', a.passcode__set)}</dd>
        <dt>Duress</dt><dd>${secretView('monitoring_accounts', a.id, 'duress_code', a.duress_code__set)}</dd>
        ${a.dispatch_notes ? html`<dt>Dispatch instructions</dt><dd style="white-space:pre-wrap">${a.dispatch_notes}</dd>` : ''}
        ${a.notes ? html`<dt>Notes</dt><dd style="white-space:pre-wrap">${a.notes}</dd>` : ''}</dl></div></div>
      <div class="stack">
        <div class="card"><div class="card-head"><h2>Station</h2></div><div class="card-body"><dl class="dl small">
          <dt>Name</dt><dd>${station.name}</dd><dt>Operators</dt><dd>${station.operator_phone ? html`<a href="tel:${station.operator_phone}">${station.operator_phone}</a>` : '—'}</dd>
          <dt>Dealer #</dt><dd>${station.dealer_number || '—'}</dd><dt>Software</dt><dd>${station.platform || '—'}</dd>
          <dt>Connection</dt><dd>${station.connected ? html`<span class="badge good">connected</span>` : html`<span class="badge">manual</span>`}</dd></dl></div></div>
        <div class="card"><div class="card-head"><h2>Call list</h2><a class="small" href="#/monitoring/${id}?tab=calllist">Edit</a></div><div class="card-body small">
          ${contacts.length ? contacts.map(c => html`<div style="padding:3px 0">${c.sequence}. <b>${c.name}</b> ${c.relation ? html`<span class="muted">(${c.relation})</span>` : ''} ${c.phone ? html`· <a href="tel:${c.phone}">${c.phone}</a>` : ''}${c.has_key ? ' · 🔑' : ''}</div>`) : html`<span class="muted">No contacts yet.</span>`}</div></div>
      </div>
      <div class="card" style="grid-column:1/-1"><div class="card-head"><h2>Recent signals</h2><a class="small" href="#/monitoring/${id}?tab=activity">All activity →</a></div><div class="card-body flush">${eventsTable(recent)}</div></div>
    </div>`);
  }

  if (tab === 'zones') {
    let showRemoved = false;
    const draw = () => {
      const rows = zones.filter(z => showRemoved || z.active);
      mount(pane, html`<div class="card"><div class="card-head"><div><h2>Zones & sensors</h2><div class="small muted">${activeZones.length} in service · removed sensors stay here as history</div></div>
          <div class="actions"><label class="row small"><input type="checkbox" data-removed ${showRemoved ? raw('checked') : ''}> Show removed</label><button class="btn sm primary" data-addzone>+ Add sensor</button></div></div>
        <div class="card-body flush">${dataTable({
          rows, empty: 'No zones yet. Add each sensor with the zone number programmed in the panel.',
          columns: [
            { label: 'Zone', render: z => html`<b>${z.zone_number}</b>` },
            { label: 'Description', render: z => html`${z.description}${z.location ? html`<div class="small muted">${z.location}</div>` : ''}` },
            { label: 'Type', key: 'zone_type' },
            { label: 'Device', render: z => html`${z.device || '—'}${z.serial ? html`<div class="small muted mono">${z.serial}</div>` : ''}` },
            { label: 'Status', render: z => z.active ? html`${badge('in service', 'good')}${z.station_synced ? '' : html`<div class="small" style="color:var(--warn)">not confirmed</div>`}` : html`${badge('removed')}<div class="small muted">${fmtDate(z.removed_on)}</div>` },
            { label: '', cls: 'actions-cell', render: z => html`<button class="btn sm ghost" data-ez="${z.id}">Edit</button>${z.active ? html`<button class="btn sm ghost danger" data-rz="${z.id}">Remove</button>` : html`<button class="btn sm ghost" data-uz="${z.id}">Restore</button>`}` },
          ] })}</div></div>`);
      $('[data-removed]', pane).addEventListener('change', e => { showRemoved = e.target.checked; draw(); });
      $('[data-addzone]', pane).addEventListener('click', () => openForm('monitoring_zones', { title: 'Add sensor / zone', defaults: { account_id: a.id, zone_number: Math.max(0, ...activeZones.map(z => z.zone_number)) + 1 }, hide: ['account_id'], onSaved: reload }));
      $$('[data-ez]', pane).forEach(b => b.addEventListener('click', () => openForm('monitoring_zones', { record: zones.find(z => z.id === Number(b.dataset.ez)), hide: ['account_id'], onSaved: reload, allowDelete: false })));
      $$('[data-rz]', pane).forEach(b => b.addEventListener('click', async () => {
        const z = zones.find(x => x.id === Number(b.dataset.rz));
        if (!(await confirmDialog(`Remove zone ${z.zone_number} “${z.description}”? It stays in the history${station.connected ? '' : `, and you'll need to remove it at ${station.name} too`}.`, { okLabel: 'Remove', danger: true }))) return;
        await R.update('monitoring_zones', z.id, { active: false }); toast('Sensor removed'); reload();
      }));
      $$('[data-uz]', pane).forEach(b => b.addEventListener('click', async () => {
        try { await R.update('monitoring_zones', Number(b.dataset.uz), { active: true }); toast('Back in service'); reload(); } catch (e) { toast(e.message, 'error'); }
      }));
    };
    draw();
  }

  if (tab === 'calllist') {
    mount(pane, html`<div class="card"><div class="card-head"><div><h2>Call list</h2><div class="small muted">Who the station calls, in order</div></div>${can.staff() ? html`<button class="btn sm primary" data-addc>+ Contact</button>` : ''}</div>
      <div class="card-body flush">${dataTable({
        rows: contacts, empty: 'No contacts. The station needs at least one person to call.',
        columns: [
          { label: '#', key: 'sequence' }, { label: 'Name', render: c => html`<b>${c.name}</b>` }, { label: 'Relation', render: c => c.relation || '—' },
          { label: 'Phone', render: c => c.phone ? html`<a href="tel:${c.phone}">${c.phone}</a>` : '—' }, { label: 'Key', render: c => c.has_key ? 'Yes' : '' },
          { label: 'Notes', render: c => c.notes || '' },
          ...(can.staff() ? [{ label: '', cls: 'actions-cell', render: c => html`<button class="btn sm ghost" data-ec="${c.id}">Edit</button>` }] : []),
        ] })}</div></div>`);
    $('[data-addc]', pane)?.addEventListener('click', () => openForm('monitoring_contacts', { defaults: { account_id: a.id, sequence: contacts.length + 1 }, hide: ['account_id'], onSaved: reload }));
    $$('[data-ec]', pane).forEach(b => b.addEventListener('click', () => openForm('monitoring_contacts', { record: contacts.find(c => c.id === Number(b.dataset.ec)), hide: ['account_id'], onSaved: reload, onDeleted: reload })));
  }

  if (tab === 'activity') {
    let type = '';
    const draw = () => {
      const rows = events.filter(e => !type || (type === 'signals' ? !['system', 'note'].includes(e.event_type) : e.event_type === type));
      mount(pane, html`<div class="filters"><div class="seg" data-type>${[['', 'Everything'], ['signals', 'Signals'], ['alarm', 'Alarms'], ['trouble', 'Troubles'], ['open/close', 'Open/close'], ['test', 'Tests'], ['system', 'Changes']].map(([v, l]) => html`<button data-v="${v}" class="${v === type ? 'on' : ''}">${l}</button>`)}</div>
          <span class="small muted">${station.connected ? 'Signals arrive from the station automatically.' : 'Signals appear here once the station sends them (see Stations → signal feed), plus anything logged by hand.'}</span></div>
        <div class="card"><div class="card-body flush">${eventsTable(rows)}</div></div>`);
      $('[data-type]', pane).addEventListener('click', e => { if (e.target.dataset.v !== undefined) { type = e.target.dataset.v; draw(); } });
    };
    draw();
  }
}

function eventsTable(rows) {
  return dataTable({
    rows, empty: 'No activity yet.',
    columns: [
      { label: 'When', render: e => html`<span class="nowrap">${fmtDateTime(e.occurred_at)}</span>` },
      { label: 'Event', render: e => html`${evBadge(e.event_type)}${e.on_test ? html` <span class="badge primary">on test</span>` : ''}${e.code ? html`<div class="small muted mono">${e.code}</div>` : ''}` },
      { label: 'Zone', render: e => e.zone_number != null ? html`<b>${e.zone_number}</b>${e.zone_description ? html`<div class="small muted">${e.zone_description}</div>` : ''}` : '—' },
      { label: 'Details', render: e => html`${e.description || ''}${e.disposition ? html`<div class="small"><b>Action:</b> ${e.disposition}</div>` : ''}` },
      { label: 'Source', render: e => html`<span class="small muted">${e.source === 'station' ? 'station' : e.user_name || e.source}</span>` },
    ],
  });
}

export function testDialog(a, station, onDone) {
  const { el, close } = openModal({
    title: `Put ${a.account_number || 'account'} on test`, size: 'sm',
    body: html`<div class="err-box hidden" data-err></div>
      <div class="field"><label for="tm">For how long?</label><select id="tm">${DURATIONS.map(([m, l]) => html`<option value="${m}" ${m === 120 ? raw('selected') : ''}>${l}</option>`)}</select></div>
      <div class="field" style="margin-top:12px"><label for="tr">Reason</label><input id="tr" type="text" placeholder="e.g. Replacing smoke detectors, panel swap"></div>
      ${station.connected ? html`<p class="small muted">${station.name} is updated automatically.</p>`
        : html`<div class="note small" style="margin-top:14px"><b>Important:</b> ${station.name} isn't connected, so this does <b>not</b> put the account on test at the station. Call ${station.operator_phone ? html`<a href="tel:${station.operator_phone}">${station.operator_phone}</a>` : 'the station'} (account <b>${a.account_number}</b>) to place it on test, then save here so everyone can see it.</div>`}`,
    foot: html`<button class="btn" data-close>Cancel</button><button class="btn primary" data-go>Put on test</button>`,
  });
  $('[data-go]', el).addEventListener('click', async () => {
    try {
      const r = await POST(`/api/monitoring/${a.id}/test`, { minutes: Number($('#tm', el).value), reason: $('#tr', el).value });
      close();
      toast(r.station_confirmed ? 'On test at the station' : 'Recorded as on test. Make sure the station has it too.');
      onDone?.();
    } catch (e) { const b = $('[data-err]', el); b.textContent = e.message; b.classList.remove('hidden'); }
  });
}

// ------------------------------------------------------------------ stations
export async function stations(view) {
  const rows = await R.list('monitoring_stations');
  mount(view, html`
    <div class="crumbs"><a href="#/monitoring">Monitoring</a> /</div>
    <div class="page-head"><div><h1>Monitoring stations</h1><div class="sub">The central stations your accounts are monitored by</div></div>
      <div class="actions">${can.manage() ? html`<button class="btn primary" data-new>+ Station</button>` : ''}</div></div>
    <div class="card"><div class="card-body flush">${dataTable({
      rows, empty: 'No stations yet. Add the central station you use (for example CMS).',
      columns: [
        { label: 'Station', render: s => html`<b>${s.name}</b><div class="small muted">${s.platform}</div>` },
        { label: 'Operators', render: s => s.operator_phone ? html`<a href="tel:${s.operator_phone}">${s.operator_phone}</a>` : '—' },
        { label: 'Dealer #', render: s => s.dealer_number || '—' },
        { label: 'Next account #', render: s => s.next_account_number != null ? html`<span class="mono">${s.account_prefix || ''}${String(s.next_account_number).padStart(s.account_digits || 0, '0')}</span>` : html`<span class="muted">assigned by station</span>` },
        { label: 'Connection', render: s => html`<span class="badge">manual</span>` },
        ...(can.manage() ? [{ label: '', cls: 'actions-cell', render: s => html`<button class="btn sm ghost" data-feed="${s.id}">Signal feed</button><button class="btn sm ghost" data-edit="${s.id}">Edit</button>` }] : []),
      ] })}</div></div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h2>Connecting a station</h2></div><div class="card-body small">
      <p><b>Today:</b> accounts, zones, call lists and tests are kept here and confirmed with the station by phone or its dealer portal. Signals can already flow in through each station's <b>signal feed</b> (a private web address the station or a middleware service can post alarm events to).</p>
      <p><b>Next step:</b> a direct connection, so creating a customer can create the station account and assign the number, and tests and zone changes go straight to the station. That needs the station's integration access (an API or automation-software interface for dealers). Ask your station what it offers. The connector slot is already built in (see the README, “Connecting a central station”).</p></div></div>`);
  $('[data-new]', view)?.addEventListener('click', () => openForm('monitoring_stations', { onSaved: refresh }));
  $$('[data-edit]', view).forEach(b => b.addEventListener('click', () => openForm('monitoring_stations', { record: rows.find(s => s.id === Number(b.dataset.edit)), onSaved: refresh, onDeleted: refresh })));
  $$('[data-feed]', view).forEach(b => b.addEventListener('click', async () => {
    const f = await GET(`/api/monitoring-stations/${b.dataset.feed}/feed`);
    const { el } = openModal({ title: 'Signal feed', body: html`<p class="muted" style="margin-top:0">Give this private address to the station (or a middleware service) to send alarm, trouble, open/close and test signals into each account's activity. Account numbers must match.</p>
      <div class="row"><input readonly class="mono" value="${f.url}" style="flex:1;min-width:260px"><button class="btn" data-copy>Copy</button></div>
      <p class="small muted">Format: POST JSON <span class="mono">{ "account": "C1-0042", "time": "2031-05-01T02:10:00", "code": "E130", "zone": 3, "description": "Burglary", "disposition": "Police dispatched", "id": "unique-event-id" }</span> (or <span class="mono">{ "events": [ … ] }</span>). Contact ID and SIA codes are recognized automatically.</p>`,
      foot: html`<button class="btn danger" data-reset>Make a new address</button><button class="btn" data-close>Close</button>` });
    $('[data-copy]', el).addEventListener('click', () => navigator.clipboard?.writeText(f.url).then(() => toast('Copied')));
    $('[data-reset]', el).addEventListener('click', async () => { if (await confirmDialog('The old address stops working immediately.', { okLabel: 'Make new address', danger: true })) { await POST(`/api/monitoring-stations/${b.dataset.feed}/feed/reset`); toast('New address created'); el.remove(); } });
  }));
}
