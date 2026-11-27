import { RESOURCES, STAGES, STAGE_INFO, PAYMENT_METHODS } from '../schema.js';
import {
  html, raw, icon, mount, $, $$, money, fmtDate, badge, typeBadge, stageBadge, relDays, dataTable, fieldColumns, openForm, renderValue,
  loading, toast, secretView, confirmDialog, openModal, fmtDateTime,
} from '../ui.js';
import { R, GET, POST, api } from '../api.js';
import { can, refresh } from '../app.js';
import { completeMaintenance, scheduleFromMaintenance, maintenanceTable } from './maintenance.js';

export async function list(view, _, query) {
  const office = can.billing();
  const editor = can.customers();
  let filter = { type: query.type || '', status: query.status ?? (query.stage ? '' : 'active'), stage: query.stage || '', q: query.q || '' };
  mount(view, html`
    <div class="page-head"><div><h1>Customers</h1><div class="sub">Residential and commercial accounts</div></div>
      <div class="actions">${editor ? html`<a class="btn" href="/api/export/customers">Export CSV</a><button class="btn primary" data-new>+ New customer</button>` : ''}</div></div>
    <div class="filters">
      <div class="seg" data-type>
        <button data-v="">All</button><button data-v="residential">Residential</button><button data-v="commercial">Commercial</button></div>
      <select data-status aria-label="Status"><option value="">Any status</option><option value="active">Active</option><option value="prospect">Prospects</option><option value="inactive">Inactive</option></select>
      <select data-stage aria-label="Stage"><option value="">Any stage</option>${STAGES.map(st => html`<option value="${st}">${STAGE_INFO[st].label}</option>`)}</select>
      <input type="search" placeholder="Name, phone, email, address, account #" data-q aria-label="Search customers">
      <span class="muted small" data-count></span>
    </div>
    <div class="card"><div class="card-body flush" data-table></div></div>`);
  const statusSel = $('[data-status]', view);
  statusSel.value = filter.status;
  $('[data-stage]', view).value = filter.stage;
  $('[data-stage]', view).addEventListener('change', e => { filter.stage = e.target.value; load(); });
  $('[data-q]', view).value = filter.q;
  const load = async () => {
    $$('[data-type] button', view).forEach(b => b.classList.toggle('on', b.dataset.v === filter.type));
    const rows = await R.list('customers', filter);
    $('[data-count]', view).textContent = `${rows.length} customer${rows.length === 1 ? '' : 's'}`;
    mount($('[data-table]', view), dataTable({
      rows, href: c => `#/customers/${c.id}`, empty: 'No customers match.',
      columns: [
        { label: 'Name', render: c => html`<b>${c.name}</b>${c.contact_name ? html`<div class="small muted">${c.contact_name}</div>` : ''}` },
        { label: 'Type', render: c => typeBadge(c.type) },
        { label: 'Phone', render: c => c.phone ? html`<a href="tel:${c.phone}" data-dial data-customer="${c.id}">${c.phone}</a>` : '—' },
        { label: 'Email', render: c => c.email ? html`<a href="mailto:${c.email}">${c.email}</a>` : '—' },
        { label: 'City', render: c => c.service_city || c.city || '—' },
        ...(office ? [
          { label: 'Monthly', render: c => c.mrr ? money(c.mrr) : '—', cls: 'num' },
          { label: 'Balance', render: c => c.balance > 0 ? html`<b>${money(c.balance)}</b>` : '—', cls: 'num' },
        ] : []),
        { label: 'Stage', render: c => html`${stageBadge(c.stage)}${c.status !== 'active' ? html` ${badge(c.status)}` : ''}` },
      ],
    }));
  };
  $('[data-type]', view).addEventListener('click', e => { if (e.target.dataset.v !== undefined) { filter.type = e.target.dataset.v; load(); } });
  statusSel.addEventListener('change', () => { filter.status = statusSel.value; load(); });
  let t;
  $('[data-q]', view).addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { filter.q = e.target.value; load(); }, 250); });
  $('[data-new]', view)?.addEventListener('click', () => newCustomer());
  await load();
  if (query.new && editor) newCustomer();
}

function newCustomer() {
  openForm('customers', { onSaved: c => { location.hash = `#/customers/${c.id}`; } });
}

const SYSTEM_TYPES = [
  ['camera_systems', 'camera', 'Camera systems'],
  ['alarm_systems', 'bell', 'Alarm / intrusion systems'],
  ['fire_systems', 'flame', 'Fire systems'],
];

export async function detail(view, [id], query) {
  loading(view);
  const office = can.billing();
  const editor = can.customers();
  const [c, contacts, cams, alarms, fires, exts, calls, maint] = await Promise.all([
    R.get('customers', id), R.list('contacts', { customer_id: id }),
    R.list('camera_systems', { customer_id: id }), R.list('alarm_systems', { customer_id: id }),
    R.list('fire_systems', { customer_id: id }), R.list('extinguishers', { customer_id: id }),
    R.list('service_calls', { customer_id: id }), GET('/api/maintenance', { customer_id: id, days: 60 }),
  ]);
  const [locs, children, stageLog] = await Promise.all([
    R.list('locations', { customer_id: id }), R.list('customers', { parent_id: id }), GET(`/api/customers/${id}/stage-log`),
  ]);
  const parent = c.parent_id ? await R.get('customers', c.parent_id).catch(() => null) : null;
  const billing = office ? await Promise.all([R.list('recurring_charges', { customer_id: id }), R.list('invoices', { customer_id: id }), R.list('payments', { customer_id: id })]) : null;
  const systems = { camera_systems: cams, alarm_systems: alarms, fire_systems: fires };
  const openCalls = calls.filter(x => !['completed', 'cancelled'].includes(x.status));
  const tab = query.tab || 'overview';
  const tabs = [
    ['overview', 'Overview'],
    ['systems', 'Systems', cams.length + alarms.length + fires.length + exts.length],
    ['locations', 'Locations', locs.length || null],
    ['monitoring', 'Monitoring'],
    ...(can.staff() ? [['proposals', 'Proposals']] : []),
    ['calls', 'Service calls', openCalls.length || null],
    ...(office ? [['billing', 'Billing', billing[1].filter(i => i.balance > 0 && i.status !== 'draft').length || null]] : []),
    ['contacts', 'Contacts', contacts.length || null],
  ];
  const addr = (a, city, st, zip) => [a, [city, st].filter(Boolean).join(', ') + (zip ? ' ' + zip : '')].filter(x => x && x.trim()).join(', ');
  const billingAddr = addr(c.billing_address, c.city, c.state, c.zip);
  const serviceAddr = c.service_address ? addr(c.service_address, c.service_city, c.service_state, c.service_zip) : billingAddr;
  const mapUrl = serviceAddr ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(serviceAddr)}` : null;

  const reload = () => refresh();
  const newCall = defaults => openForm('service_calls', { defaults: { customer_id: c.id, ...defaults }, hide: ['customer_id'], onSaved: s => { location.hash = `#/calls/${s.id}`; } });

  mount(view, html`
    <div class="crumbs"><a href="#/customers">Customers</a> /</div>
    <div class="page-head"><div>
        <h1>${c.name} ${typeBadge(c.type)} ${c.status !== 'active' ? badge(c.status) : ''}</h1>
        <div class="row" style="margin-top:8px">${editor ? html`<label class="small muted" for="stageSel">Stage</label>
          <select id="stageSel" data-stage-sel style="width:auto;min-height:32px;padding:4px 8px">${STAGES.map(st => html`<option value="${st}" ${st === c.stage ? raw('selected') : ''}>${STAGE_INFO[st].label}</option>`)}</select>`
          : stageBadge(c.stage)}
          ${parent ? html`<span class="small muted">Part of <a href="#/customers/${parent.id}">${parent.name}</a></span>` : ''}</div>
        <div class="sub">${[c.contact_name, c.account_number ? `Acct ${c.account_number}` : ''].filter(Boolean).join(' · ')}${c.phone ? html`${c.contact_name || c.account_number ? ' · ' : ''}<a href="tel:${c.phone}" data-dial data-customer="${c.id}">📞 ${c.phone}</a>` : ''}</div></div>
      <div class="actions">
        ${editor ? html`<button class="btn" data-edit>Edit</button>` : ''}
        <button class="btn" data-newcall>+ Service call</button>
        ${editor ? html`<button class="btn" data-portal>Portal access</button>` : ''}
        ${can.manage() ? html`<button class="btn" data-techaccess title="Technicians only see customers on their schedule">Tech access</button>` : ''}
        ${can.sales() ? html`<button class="btn" data-newprop>+ Proposal</button>` : ''}
        ${office ? html`<button class="btn primary" data-newinv>+ Invoice</button>` : ''}
      </div></div>
    <div class="tabs">${tabs.map(([k, l, n]) => html`<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${l}${n ? html`<span class="count">${n}</span>` : ''}</button>`)}</div>
    <div data-pane></div>`);

  $$('[data-tab]', view).forEach(b => b.addEventListener('click', () => { location.hash = `#/customers/${id}?tab=${b.dataset.tab}`; }));
  $('[data-edit]', view)?.addEventListener('click', () => openForm('customers', { record: c, onSaved: reload, onDeleted: () => { location.hash = '#/customers'; } }));
  $('[data-newcall]', view).addEventListener('click', () => newCall({}));
  $('[data-portal]', view)?.addEventListener('click', () => portalDialog(c));
  $('[data-techaccess]', view)?.addEventListener('click', () => techAccessDialog(c));
  $('[data-newprop]', view)?.addEventListener('click', async () => (await import('./proposals.js')).newProposal({ customer_id: c.id }));
  $('[data-stage-sel]', view)?.addEventListener('change', async e => {
    try { await R.update('customers', c.id, { stage: e.target.value }); toast(`Moved to ${STAGE_INFO[e.target.value].label}`); reload(); }
    catch (err) { toast(err.message, 'error'); }
  });
  $('[data-newinv]', view)?.addEventListener('click', () => openForm('invoices', { defaults: { customer_id: c.id }, hide: ['customer_id'], onSaved: i => { location.hash = `#/invoices/${i.id}`; } }));
  const pane = $('[data-pane]', view);

  if (tab === 'overview') {
    const balance = c.balance || 0;
    mount(pane, html`<div class="grid g3">
      <div class="card span2"><div class="card-head"><h2>Account details</h2></div><div class="card-body">
        <dl class="dl">
          <dt>Type</dt><dd>${typeBadge(c.type)}</dd>
          ${c.contact_name ? html`<dt>Primary contact</dt><dd>${c.contact_name}</dd>` : ''}
          <dt>Phone</dt><dd>${renderValue({ type: 'tel', name: 'phone' }, c)}${c.alt_phone ? html` · ${renderValue({ type: 'tel', name: 'alt_phone' }, c)}` : ''}</dd>
          <dt>Email</dt><dd>${renderValue({ type: 'email', name: 'email' }, c)}</dd>
          <dt>Billing address</dt><dd>${billingAddr || '—'}</dd>
          <dt>Service address</dt><dd>${serviceAddr || '—'} ${mapUrl ? html`<a href="${mapUrl}" target="_blank" rel="noopener" class="small">Map ↗</a>` : ''}</dd>
          ${c.account_number ? html`<dt>Monitoring acct #</dt><dd>${c.account_number}</dd>` : ''}
          <dt>Gate / door code</dt><dd>${secretView('customers', c.id, 'gate_code', c.gate_code__set)}</dd>
          ${office ? html`<dt>Preferred payment</dt><dd>${c.preferred_payment || '—'}${c.tax_exempt ? ' · Tax exempt' : ''}</dd>` : ''}
          ${c.access_notes ? html`<dt>Site access</dt><dd style="white-space:pre-wrap">${c.access_notes}</dd>` : ''}
          ${c.notes ? html`<dt>Notes</dt><dd style="white-space:pre-wrap">${c.notes}</dd>` : ''}
          <dt>Customer since</dt><dd>${fmtDate(c.created_at?.slice(0, 10))}</dd>
        </dl></div></div>
      <div class="stack">
        ${office ? html`<div class="kpi"><div class="label">Monthly recurring</div><div class="value">${money(c.mrr)}</div></div>
          <div class="kpi ${balance > 0 ? 'alert' : ''}"><div class="label">Balance due</div><div class="value">${money(balance)}</div></div>` : ''}
        <div class="kpi"><div class="label">Open service calls</div><div class="value">${openCalls.length}</div></div>
        <div class="kpi"><div class="label">Systems on file</div><div class="value">${cams.length + alarms.length + fires.length}</div><div class="hint">${exts.length} fire extinguishers</div></div>
      </div>
      <div class="card span2"><div class="card-head"><h2>Upcoming maintenance (60 days)</h2></div><div class="card-body flush" data-maint></div></div>
      <div class="card"><div class="card-head"><h2>Related accounts</h2>${editor ? html`<button class="btn sm" data-add-child>+ Add business</button>` : ''}</div><div class="card-body">
        ${parent ? html`<div class="small muted">Parent / owner</div><div style="margin-bottom:10px"><a href="#/customers/${parent.id}">${parent.name}</a> ${typeBadge(parent.type)}</div>` : ''}
        ${children.length ? html`<div class="small muted">Businesses & properties under this account</div>${children.map(k => html`<div style="padding:4px 0"><a href="#/customers/${k.id}">${k.name}</a> ${typeBadge(k.type)} ${stageBadge(k.stage)}</div>`)}`
          : !parent ? html`<div class="muted small">None. Use “Add business” for other companies or properties owned by ${c.name}.</div>` : ''}</div></div>
      <div class="card span2"><div class="card-head"><h2>Stage history</h2></div><div class="card-body flush">${dataTable({
        rows: stageLog, empty: 'No stage changes yet.',
        columns: [{ label: 'When', render: g => g.created_at }, { label: 'Stage', render: g => html`${g.from_stage ? html`${stageBadge(g.from_stage)} → ` : ''}${stageBadge(g.to_stage)}` },
          { label: 'Why', render: g => g.reason || '—' }, { label: 'By', render: g => g.user_name || 'system' }] })}</div></div>
      <div class="card"><div class="card-head"><h2>Open calls</h2></div><div class="card-body flush">${dataTable({
        rows: openCalls, href: x => `#/calls/${x.id}`, empty: 'No open calls.',
        columns: [{ label: 'Call', render: x => html`<b>SC-${x.number}</b> ${x.title}<div class="small muted">${x.scheduled_start ? relDays(x.scheduled_start) : 'not scheduled'}</div>` }, { label: 'Status', render: x => badge(x.status) }],
      })}</div></div>
    </div>`);
    maintenanceTable($('[data-maint]', pane), maint, { showCustomer: false, onChange: reload });
    $('[data-add-child]', pane)?.addEventListener('click', () => openForm('customers', { title: `New business under ${c.name}`,
      defaults: { parent_id: c.id, type: 'commercial', phone: c.phone, email: c.email, contact_name: c.contact_name || c.name, stage: c.stage },
      onSaved: k => { location.hash = `#/customers/${k.id}`; } }));
  }

  if (tab === 'monitoring') {
    const m = await import('./monitoring.js');
    const rows = await R.list('monitoring_accounts', { customer_id: id });
    mount(pane, html`<div class="card"><div class="card-head"><div><h2>Monitoring accounts</h2><div class="small muted">Central-station accounts for this customer${locs.length ? ' and its locations' : ''}</div></div>
        ${can.staff() ? html`<button class="btn sm primary" data-nm>+ Monitoring account</button>` : ''}</div>
      <div class="card-body flush">${m.accountsTable(rows, 'Not monitored yet. Add an account to link this customer to their central-station account.')}</div></div>`);
    $('[data-nm]', pane)?.addEventListener('click', () => m.newAccount({ customer_id: c.id }));
  }

  if (tab === 'proposals') {
    const { proposalsTable, newProposal } = await import('./proposals.js');
    const rows = await R.list('proposals', { customer_id: id }).catch(() => []);
    mount(pane, html`<div class="card"><div class="card-head"><h2>Proposals & agreements</h2>${can.sales() ? html`<button class="btn sm primary" data-np>+ Proposal</button>` : ''}</div>
      <div class="card-body flush">${proposalsTable(rows, 'No proposals for this customer yet.')}</div></div>`);
    $('[data-np]', pane)?.addEventListener('click', () => newProposal({ customer_id: c.id }));
  }

  if (tab === 'locations') {
    mount(pane, html`<div class="card"><div class="card-head"><div><h2>Locations</h2><div class="small muted">Each site can have its own systems, service calls and access details</div></div>
        ${editor ? html`<button class="btn sm primary" data-addloc>+ Add location</button>` : ''}</div>
      <div class="card-body flush">${dataTable({
        rows: locs, empty: 'No extra locations. The customer’s service address is used.',
        columns: [
          { label: 'Location', render: l => html`<b>${l.name}</b>${l.active ? '' : html` <span class="badge">inactive</span>`}` },
          { label: 'Address', render: l => html`${[l.address, l.city, l.state].filter(Boolean).join(', ') || '—'}${l.address ? html` <a class="small" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([l.address, l.city, l.state, l.zip].filter(Boolean).join(' '))}">Map ↗</a>` : ''}` },
          { label: 'Site contact', render: l => html`${l.site_contact || '—'}${l.phone ? html`<div class="small"><a href="tel:${l.phone}" data-dial data-customer="${l.customer_id}">${l.phone}</a></div>` : ''}` },
          { label: 'Gate code', render: l => secretView('locations', l.id, 'gate_code', l.gate_code__set) },
          { label: 'Systems', render: l => [...cams, ...alarms, ...fires].filter(x => x.site_id === l.id).length + ' systems · ' + exts.filter(x => x.site_id === l.id).length + ' ext.' },
          ...(editor ? [{ label: '', cls: 'actions-cell', render: l => html`<button class="btn sm ghost" data-editloc="${l.id}">Edit</button>` }] : []),
        ] })}</div></div>`);
    $('[data-addloc]', pane)?.addEventListener('click', () => openForm('locations', { defaults: { customer_id: c.id, state: c.state }, hide: ['customer_id'], onSaved: reload }));
    $$('[data-editloc]', pane).forEach(b => b.addEventListener('click', () => openForm('locations', { record: locs.find(l => l.id === Number(b.dataset.editloc)), hide: ['customer_id'], onSaved: reload, onDeleted: reload })));
  }

  if (tab === 'systems') {
    mount(pane, html`
      ${maint.length ? html`<div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Due soon</h2></div><div class="card-body flush" data-maint></div></div>` : ''}
      <div class="stack">
      ${SYSTEM_TYPES.map(([res, ico, label]) => html`<div class="card"><div class="card-head"><h2 class="row" style="gap:8px">${icon(ico)} ${label}</h2>
          <button class="btn sm" data-add="${res}">+ Add</button></div>
        <div class="card-body">${systems[res].length ? html`<div class="grid g2">${systems[res].map(s => systemCard(res, s))}</div>` : html`<div class="muted">None on file.</div>`}</div></div>`)}
      <div class="card"><div class="card-head"><h2 class="row" style="gap:8px">${icon('fire-extinguisher')} Fire extinguishers <span class="muted small">(${exts.length})</span></h2>
          <div class="actions">${exts.length ? html`<button class="btn sm" data-inspect-all>Mark selected inspected today</button>` : ''}<button class="btn sm" data-add="extinguishers">+ Add</button></div></div>
        <div class="card-body flush">${exts.length ? html`<div class="table-wrap"><table class="t responsive"><thead><tr>
            <th><input type="checkbox" data-all aria-label="Select all"></th><th>Location</th><th>Type</th><th>Size</th><th>Status</th><th>Next annual</th><th>Next hydro</th><th>Serial</th><th></th></tr></thead>
          <tbody>${exts.map(x => html`<tr>
            <td data-label="Select"><input type="checkbox" data-ext="${x.id}" aria-label="Select"></td>
            <td data-label="Location">${x.location || '—'}</td><td data-label="Type">${x.ext_type}</td><td data-label="Size">${x.size || '—'}</td>
            <td data-label="Status">${badge(x.status)}</td>
            <td data-label="Next annual">${dueCell(x.next_annual)}</td><td data-label="Next hydro">${dueCell(x.next_hydro)}</td>
            <td data-label="Serial" class="small">${x.serial || ''}</td>
            <td class="actions-cell"><button class="btn sm ghost" data-edit-sys="extinguishers" data-id="${x.id}">Edit</button></td></tr>`)}</tbody></table></div>`
          : html`<div class="empty">No extinguishers on file.</div>`}</div></div>
      </div>`);
    if (maint.length) maintenanceTable($('[data-maint]', pane), maint, { showCustomer: false, onChange: reload });
    const all = { ...systems, extinguishers: exts };
    $$('[data-add]', pane).forEach(b => b.addEventListener('click', () => openForm(b.dataset.add, { defaults: { customer_id: c.id }, hide: ['customer_id'], onSaved: reload })));
    $$('[data-edit-sys]', pane).forEach(b => b.addEventListener('click', () => {
      const rec = all[b.dataset.editSys].find(s => s.id === Number(b.dataset.id));
      openForm(b.dataset.editSys, { record: rec, hide: ['customer_id'], onSaved: reload, onDeleted: reload });
    }));
    $$('[data-svc]', pane).forEach(b => b.addEventListener('click', () => newCall({ title: `Service — ${b.dataset.label}`, system_type: b.dataset.svc })));
    $('[data-all]', pane)?.addEventListener('change', e => $$('[data-ext]', pane).forEach(x => { x.checked = e.target.checked; }));
    $('[data-inspect-all]', pane)?.addEventListener('click', async () => {
      const ids = $$('[data-ext]:checked', pane).map(x => Number(x.dataset.ext));
      if (!ids.length) return toast('Select extinguishers first (use the checkbox in the header to select all)', 'error');
      if (!(await confirmDialog(`Mark ${ids.length} extinguisher(s) as inspected today? Next annual will be set one year out.`, { okLabel: 'Mark inspected' }))) return;
      await POST('/api/maintenance/complete', { key: 'ext_annual', ids });
      toast(`${ids.length} extinguisher(s) updated`);
      reload();
    });
  }

  if (tab === 'calls') {
    mount(pane, html`<div class="card"><div class="card-head"><h2>Service history</h2><button class="btn sm" data-nc>+ Service call</button></div>
      <div class="card-body flush">${dataTable({
        rows: calls, href: x => `#/calls/${x.id}`, empty: 'No service calls yet.',
        columns: [
          { label: 'Call #', render: x => html`<b>SC-${x.number}</b>` },
          { label: 'Summary', render: x => html`${x.title}<div class="small muted">${x.call_type} · ${x.system_type || ''}</div>` },
          { label: 'Scheduled', render: x => x.scheduled_start ? fmtDate(x.scheduled_start.slice(0, 10)) : '—' },
          { label: 'Technician', render: x => x.technician_id_label || '—' },
          { label: 'Status', render: x => html`${badge(x.status)} ${x.priority === 'emergency' ? badge('emergency') : ''}` },
        ] })}</div></div>`);
    $('[data-nc]', pane).addEventListener('click', () => newCall({}));
  }

  if (tab === 'billing' && office) {
    const [charges, invoices, payments] = billing;
    const mrr = charges.filter(x => x.active).reduce((s, x) => s + x.amount, 0);
    mount(pane, html`<div class="stack">
      <div class="card"><div class="card-head"><div><h2>Recurring monthly charges</h2><div class="small muted">Billed automatically by "Run monthly billing" on the Invoices page</div></div>
        <button class="btn sm" data-add-charge>+ Add charge</button></div>
        <div class="card-body flush">${dataTable({
          rows: charges, empty: 'No recurring charges. Add monitoring, cloud video or service-plan fees here.',
          columns: [
            { label: 'Description', key: 'description' },
            { label: 'Taxable', render: x => x.taxable ? 'Yes' : 'No' },
            { label: 'Status', render: x => x.active ? badge('active') : badge('inactive') },
            { label: 'Amount / mo', render: x => money(x.amount), cls: 'num' },
            { label: '', render: x => html`<button class="btn sm ghost" data-charge="${x.id}">Edit</button>`, cls: 'actions-cell' },
          ],
          foot: charges.length ? html`<tr><td colspan="3">Total monthly (active)</td><td class="num">${money(mrr)}</td><td></td></tr>` : null,
        })}</div></div>
      <div class="card"><div class="card-head"><h2>Invoices</h2><div class="actions">
          <button class="btn sm" data-pay>Record payment</button><button class="btn sm primary" data-ni>+ Invoice</button></div></div>
        <div class="card-body flush">${dataTable({
          rows: invoices, href: i => `#/invoices/${i.id}`, empty: 'No invoices yet.',
          columns: [
            { label: 'Invoice', render: i => html`<b>#${i.number}</b><div class="small muted">${i.kind}${i.period ? ' · ' + i.period : ''}</div>` },
            { label: 'Issued', render: i => fmtDate(i.issue_date) },
            { label: 'Due', render: i => fmtDate(i.due_date) },
            { label: 'Status', render: i => badge(i.display_status) },
            { label: 'Total', render: i => money(i.total), cls: 'num' },
            { label: 'Balance', render: i => i.balance > 0 ? html`<b>${money(i.balance)}</b>` : money(0), cls: 'num' },
          ] })}</div></div>
      <div class="card" data-pm-card><div class="card-head"><h2>Saved cards & bank accounts</h2></div><div class="card-body"><div class="muted small">Loading…</div></div></div>
      <div class="card"><div class="card-head"><h2>Payments</h2></div><div class="card-body flush">${dataTable({
        rows: payments, empty: 'No payments recorded.', href: p => `#/invoices/${p.invoice_id}`,
        columns: [
          { label: 'Date', render: p => fmtDate(p.date) }, { label: 'Invoice', render: p => p.invoice_id_label },
          { label: 'Method', render: p => PAYMENT_METHODS[p.method] || p.method }, { label: 'Reference', render: p => p.reference || '—' },
          { label: 'Amount', render: p => money(p.amount), cls: 'num' }] })}</div></div>
    </div>`);
    drawPaymentMethods($('[data-pm-card]', pane), c);
    $('[data-add-charge]', pane).addEventListener('click', () => openForm('recurring_charges', { defaults: { customer_id: c.id }, hide: ['customer_id'], onSaved: reload }));
    $$('[data-charge]', pane).forEach(b => b.addEventListener('click', () => openForm('recurring_charges', { record: charges.find(x => x.id === Number(b.dataset.charge)), hide: ['customer_id'], onSaved: reload, onDeleted: reload })));
    $('[data-ni]', pane).addEventListener('click', () => openForm('invoices', { defaults: { customer_id: c.id }, hide: ['customer_id'], onSaved: i => { location.hash = `#/invoices/${i.id}`; } }));
    $('[data-pay]', pane).addEventListener('click', () => {
      const open = invoices.filter(i => i.balance > 0 && i.status !== 'void');
      if (!open.length) return toast('This customer has no open invoices', 'error');
      openForm('payments', { defaults: { invoice_id: open[open.length - 1].id, amount: open[open.length - 1].balance }, onSaved: reload,
        onMount: (el, form) => {
          // Limit the invoice dropdown to this customer's open invoices.
          const sel = form.elements.invoice_id;
          [...sel.options].forEach(o => { if (o.value && !open.some(i => String(i.id) === o.value)) o.remove(); });
          sel.addEventListener('change', () => { const i = open.find(x => String(x.id) === sel.value); if (i) form.elements.amount.value = i.balance; });
        } });
    });
  }

  if (tab === 'contacts') {
    mount(pane, html`<div class="card"><div class="card-head"><h2>Contacts</h2><button class="btn sm" data-addc ${editor ? '' : 'disabled'}>+ Add contact</button></div>
      <div class="card-body flush">${dataTable({
        rows: contacts, empty: 'No additional contacts.',
        columns: [...fieldColumns('contacts'), ...(editor ? [{ label: '', render: x => html`<button class="btn sm ghost" data-ec="${x.id}">Edit</button>`, cls: 'actions-cell' }] : [])],
      })}</div></div>`);
    $('[data-addc]', pane).addEventListener('click', () => openForm('contacts', { defaults: { customer_id: c.id }, hide: ['customer_id'], onSaved: reload }));
    $$('[data-ec]', pane).forEach(b => b.addEventListener('click', () => openForm('contacts', { record: contacts.find(x => x.id === Number(b.dataset.ec)), hide: ['customer_id'], onSaved: reload, onDeleted: reload })));
  }
}

function dueCell(d) {
  if (!d) return '—';
  const over = d < new Date().toISOString().slice(0, 10);
  return html`<span style="${over ? 'color:var(--bad);font-weight:600' : ''}">${fmtDate(d)}</span>`;
}

function systemCard(res, s) {
  const def = RESOURCES[res];
  const skip = new Set(['customer_id', 'notes']);
  const shown = def.fields.filter(f => !skip.has(f.name) && (f.type === 'secret' ? s[`${f.name}__set`] : s[f.name] != null && s[f.name] !== ''));
  const title = s.location || s.system_type || s.brand || def.singular;
  const sys = res === 'camera_systems' ? 'camera' : res === 'alarm_systems' ? 'alarm' : s.system_type === 'sprinkler' ? 'sprinkler' : 'fire alarm';
  return html`<div class="card" style="box-shadow:none"><div class="card-head"><div><h3>${title}</h3>
      <div class="small muted">${[s.site_id_label ? '📍 ' + s.site_id_label.split(' — ')[0] : '', s.brand || s.panel_brand, s.model || s.panel_model, s.system_type && res === 'fire_systems' ? s.system_type : ''].filter(Boolean).join(' · ')}</div></div>
    <div class="actions"><button class="btn sm ghost" data-svc="${sys}" data-label="${title}">Service</button><button class="btn sm" data-edit-sys="${res}" data-id="${s.id}">Edit</button></div></div>
    <div class="card-body"><dl class="dl small">${shown.filter(f => f.name !== 'location').map(f => html`<dt>${f.label}</dt><dd>${f.type === 'date' && /next/.test(f.name) ? dueCell(s[f.name]) : renderValue(f, s, res)}</dd>`)}</dl>
    ${s.notes ? html`<div class="small" style="margin-top:10px;white-space:pre-wrap">${s.notes}</div>` : ''}</div></div>`;
}

async function drawPaymentMethods(card, c) {
  const cfg = await GET('/api/payments/config').catch(() => ({ ok: false }));
  if (!cfg.ok) {
    mount(card, html`<div class="card-head"><h2>Saved cards & bank accounts</h2></div><div class="card-body small muted">Connect Stripe under Settings → Payments to save cards and bank accounts and take payments online. Preferred method on file: <b>${c.preferred_payment || '—'}</b>.</div>`);
    return;
  }
  const pm = await GET(`/api/customers/${c.id}/payment-methods`).catch(e => ({ methods: [], error: e.message }));
  mount(card, html`<div class="card-head"><div><h2>Saved cards & bank accounts</h2><div class="small muted">Stored securely by Stripe; used for “Charge now” and autopay</div></div>
      <div class="actions"><button class="btn sm" data-pmlink>Email link to add one</button><button class="btn sm ghost" data-pmcopy>Copy link</button></div></div>
    <div class="card-body flush">${dataTable({
      rows: pm.methods, empty: pm.error || 'Nothing saved yet. Email the customer a secure link to add a card or bank account.',
      columns: [
        { label: 'Method', render: m => html`<b>${m.label}</b>${m.id === pm.default ? html` <span class="badge good">default</span>` : ''}` },
        { label: 'Details', render: m => m.detail },
        { label: '', cls: 'actions-cell', render: m => html`${m.id !== pm.default ? html`<button class="btn sm ghost" data-pmdef="${m.id}">Make default</button>` : ''}<button class="btn sm ghost danger" data-pmdel="${m.id}">Remove</button>` },
      ] })}</div>`);
  const again = () => drawPaymentMethods(card, c);
  card.querySelector('[data-pmlink]').addEventListener('click', async () => { try { await POST(`/api/customers/${c.id}/payment-methods/link`, { email: true }); toast('Secure link emailed to the customer'); } catch (e) { toast(e.message, 'error'); } });
  card.querySelector('[data-pmcopy]').addEventListener('click', async () => { try { const r = await POST(`/api/customers/${c.id}/payment-methods/link`, {}); await navigator.clipboard?.writeText(r.url); toast('Link copied (works for 24 hours)'); } catch (e) { toast(e.message, 'error'); } });
  card.querySelectorAll('[data-pmdef]').forEach(b => b.addEventListener('click', async () => { await POST(`/api/customers/${c.id}/payment-methods/${b.dataset.pmdef}/default`); toast('Default updated'); again(); }));
  card.querySelectorAll('[data-pmdel]').forEach(b => b.addEventListener('click', async () => {
    if (!(await confirmDialog('Remove this saved payment method?', { okLabel: 'Remove', danger: true }))) return;
    await api('DELETE', `/api/customers/${c.id}/payment-methods/${b.dataset.pmdel}`); toast('Removed'); again();
  }));
}

async function portalDialog(c) {
  const users = await GET(`/api/customers/${c.id}/portal-users`);
  const { el, close } = openModal({
    title: 'Customer portal access', size: 'sm',
    body: html`<p class="muted" style="margin-top:0">The portal lets ${c.name} see and pay invoices, update their payment method, view service history and photos, request service or equipment, and sign agreements.</p>
      ${users.length ? html`<div class="stack" style="gap:6px;margin-bottom:12px">${users.map(u => html`<div class="row" style="justify-content:space-between"><span><b>${u.name}</b> · ${u.email}<br><span class="small muted">${u.email_verified ? (u.last_login ? `last signed in ${u.last_login}` : 'active, not signed in yet') : 'invited — hasn’t set a password yet'}</span></span>
        ${u.active ? html`<span class="badge good">active</span>` : html`<span class="badge">disabled</span>`}</div>`)}</div>` : html`<p>No portal login yet.</p>`}
      <div class="err-box hidden" data-err></div>
      <div class="field"><label for="pe">Send an invite to</label><input id="pe" type="email" value="${c.email || ''}"></div>`,
    foot: html`<button class="btn" data-close>Close</button><button class="btn" data-copy>Copy invite link</button><button class="btn primary" data-send>Email invite</button>`,
  });
  const go = async copy => {
    try {
      const r = await POST(`/api/customers/${c.id}/portal-invite`, { email: $('#pe', el).value });
      if (copy) { await navigator.clipboard?.writeText(r.link); toast('Invite link copied'); } else toast('Invite sent');
      close();
    } catch (e) { const b = $('[data-err]', el); b.textContent = e.message; b.classList.remove('hidden'); }
  };
  $('[data-send]', el).addEventListener('click', () => go(false));
  $('[data-copy]', el).addEventListener('click', () => go(true));
}

async function techAccessDialog(c) {
  const [grants, users] = await Promise.all([GET(`/api/customers/${c.id}/access`), GET('/api/users')]);
  const techs = users.filter(u => u.role === 'technician' && u.active);
  const { el, close } = openModal({
    title: 'Technician access', size: 'sm',
    body: html`<p class="muted" style="margin-top:0">Technicians automatically see customers on their schedule. Give someone temporary access to ${c.name} for anything else (a phone consult, a backup tech).</p>
      ${grants.length ? html`<div class="stack" style="gap:6px;margin-bottom:12px">${grants.map(g => html`<div class="row" style="justify-content:space-between"><span><b>${g.user_name}</b> until ${fmtDateTime(g.expires_at)}<br><span class="small muted">${g.reason || ''}</span></span><button class="btn sm ghost danger" data-revoke="${g.id}">Revoke</button></div>`)}</div>` : ''}
      <div class="err-box hidden" data-err></div>
      <div class="field"><label for="ta_u">Technician</label><select id="ta_u">${techs.map(u => html`<option value="${u.id}">${u.name}</option>`)}</select></div>
      <div class="field" style="margin-top:10px"><label for="ta_h">For</label><select id="ta_h"><option value="4">4 hours</option><option value="24" selected>24 hours</option><option value="72">3 days</option><option value="168">1 week</option></select></div>
      <div class="field" style="margin-top:10px"><label for="ta_r">Reason</label><input id="ta_r" type="text" placeholder="e.g. covering for Mike"></div>`,
    foot: html`<button class="btn" data-close>Close</button><button class="btn primary" data-grant ${techs.length ? '' : 'disabled'}>Give access</button>`,
  });
  $('[data-grant]', el).addEventListener('click', async () => {
    try { await POST(`/api/customers/${c.id}/access`, { user_id: $('#ta_u', el).value, hours: $('#ta_h', el).value, reason: $('#ta_r', el).value }); toast('Access given'); close(); }
    catch (e) { const b = $('[data-err]', el); b.textContent = e.message; b.classList.remove('hidden'); }
  });
  el.querySelectorAll('[data-revoke]').forEach(b => b.addEventListener('click', async () => { await api('DELETE', `/api/customers/${c.id}/access/${b.dataset.revoke}`); toast('Access removed'); close(); }));
}
