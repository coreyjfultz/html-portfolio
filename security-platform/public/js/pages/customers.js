import { RESOURCES } from '../schema.js';
import {
  html, mount, $, $$, money, fmtDate, badge, typeBadge, relDays, dataTable, fieldColumns, openForm, renderValue,
  loading, toast, secretView, confirmDialog,
} from '../ui.js';
import { R, GET, POST } from '../api.js';
import { can, refresh } from '../app.js';
import { completeMaintenance, scheduleFromMaintenance, maintenanceTable } from './maintenance.js';

export async function list(view, _, query) {
  const office = can.office();
  let filter = { type: query.type || '', status: query.status ?? 'active', q: query.q || '' };
  mount(view, html`
    <div class="page-head"><div><h1>Customers</h1><div class="sub">Residential and commercial accounts</div></div>
      <div class="actions">${office ? html`<a class="btn" href="/api/export/customers">Export CSV</a><button class="btn primary" data-new>+ New customer</button>` : ''}</div></div>
    <div class="filters">
      <div class="seg" data-type>
        <button data-v="">All</button><button data-v="residential">Residential</button><button data-v="commercial">Commercial</button></div>
      <select data-status aria-label="Status"><option value="">Any status</option><option value="active">Active</option><option value="prospect">Prospects</option><option value="inactive">Inactive</option></select>
      <input type="search" placeholder="Name, phone, email, address, account #" data-q aria-label="Search customers">
      <span class="muted small" data-count></span>
    </div>
    <div class="card"><div class="card-body flush" data-table></div></div>`);
  const statusSel = $('[data-status]', view);
  statusSel.value = filter.status;
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
        { label: 'Phone', render: c => c.phone ? html`<a href="tel:${c.phone}">${c.phone}</a>` : '—' },
        { label: 'Email', render: c => c.email ? html`<a href="mailto:${c.email}">${c.email}</a>` : '—' },
        { label: 'City', render: c => c.service_city || c.city || '—' },
        ...(office ? [
          { label: 'Monthly', render: c => c.mrr ? money(c.mrr) : '—', cls: 'num' },
          { label: 'Balance', render: c => c.balance > 0 ? html`<b>${money(c.balance)}</b>` : '—', cls: 'num' },
        ] : []),
        { label: 'Status', render: c => badge(c.status) },
      ],
    }));
  };
  $('[data-type]', view).addEventListener('click', e => { if (e.target.dataset.v !== undefined) { filter.type = e.target.dataset.v; load(); } });
  statusSel.addEventListener('change', () => { filter.status = statusSel.value; load(); });
  let t;
  $('[data-q]', view).addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { filter.q = e.target.value; load(); }, 250); });
  $('[data-new]', view)?.addEventListener('click', () => newCustomer());
  await load();
  if (query.new && office) newCustomer();
}

function newCustomer() {
  openForm('customers', { onSaved: c => { location.hash = `#/customers/${c.id}`; } });
}

const SYSTEM_TYPES = [
  ['camera_systems', '📹', 'Camera systems'],
  ['alarm_systems', '🔔', 'Alarm / intrusion systems'],
  ['fire_systems', '🔥', 'Fire systems'],
];

export async function detail(view, [id], query) {
  loading(view);
  const office = can.office();
  const [c, contacts, cams, alarms, fires, exts, calls, maint] = await Promise.all([
    R.get('customers', id), R.list('contacts', { customer_id: id }),
    R.list('camera_systems', { customer_id: id }), R.list('alarm_systems', { customer_id: id }),
    R.list('fire_systems', { customer_id: id }), R.list('extinguishers', { customer_id: id }),
    R.list('service_calls', { customer_id: id }), GET('/api/maintenance', { customer_id: id, days: 60 }),
  ]);
  const billing = office ? await Promise.all([R.list('recurring_charges', { customer_id: id }), R.list('invoices', { customer_id: id }), R.list('payments', { customer_id: id })]) : null;
  const systems = { camera_systems: cams, alarm_systems: alarms, fire_systems: fires };
  const openCalls = calls.filter(x => !['completed', 'cancelled'].includes(x.status));
  const tab = query.tab || 'overview';
  const tabs = [
    ['overview', 'Overview'],
    ['systems', 'Systems', cams.length + alarms.length + fires.length + exts.length],
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
        <div class="sub">${[c.contact_name, c.phone, c.account_number ? `Acct ${c.account_number}` : ''].filter(Boolean).join(' · ')}</div></div>
      <div class="actions">
        ${office ? html`<button class="btn" data-edit>Edit</button>` : ''}
        <button class="btn" data-newcall>+ Service call</button>
        ${office ? html`<button class="btn primary" data-newinv>+ Invoice</button>` : ''}
      </div></div>
    <div class="tabs">${tabs.map(([k, l, n]) => html`<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${l}${n ? html`<span class="count">${n}</span>` : ''}</button>`)}</div>
    <div data-pane></div>`);

  $$('[data-tab]', view).forEach(b => b.addEventListener('click', () => { location.hash = `#/customers/${id}?tab=${b.dataset.tab}`; }));
  $('[data-edit]', view)?.addEventListener('click', () => openForm('customers', { record: c, onSaved: reload, onDeleted: () => { location.hash = '#/customers'; } }));
  $('[data-newcall]', view).addEventListener('click', () => newCall({}));
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
      <div class="card"><div class="card-head"><h2>Open calls</h2></div><div class="card-body flush">${dataTable({
        rows: openCalls, href: x => `#/calls/${x.id}`, empty: 'No open calls.',
        columns: [{ label: 'Call', render: x => html`<b>SC-${x.number}</b> ${x.title}<div class="small muted">${x.scheduled_start ? relDays(x.scheduled_start) : 'not scheduled'}</div>` }, { label: 'Status', render: x => badge(x.status) }],
      })}</div></div>
    </div>`);
    maintenanceTable($('[data-maint]', pane), maint, { showCustomer: false, onChange: reload });
  }

  if (tab === 'systems') {
    mount(pane, html`
      ${maint.length ? html`<div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Due soon</h2></div><div class="card-body flush" data-maint></div></div>` : ''}
      <div class="stack">
      ${SYSTEM_TYPES.map(([res, ico, label]) => html`<div class="card"><div class="card-head"><h2>${ico} ${label}</h2>
          <button class="btn sm" data-add="${res}">+ Add</button></div>
        <div class="card-body">${systems[res].length ? html`<div class="grid g2">${systems[res].map(s => systemCard(res, s))}</div>` : html`<div class="muted">None on file.</div>`}</div></div>`)}
      <div class="card"><div class="card-head"><h2>🧯 Fire extinguishers <span class="muted small">(${exts.length})</span></h2>
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
      <div class="card"><div class="card-head"><h2>Payments</h2></div><div class="card-body flush">${dataTable({
        rows: payments, empty: 'No payments recorded.', href: p => `#/invoices/${p.invoice_id}`,
        columns: [
          { label: 'Date', render: p => fmtDate(p.date) }, { label: 'Invoice', render: p => p.invoice_id_label },
          { label: 'Method', key: 'method' }, { label: 'Reference', render: p => p.reference || '—' },
          { label: 'Amount', render: p => money(p.amount), cls: 'num' }] })}</div></div>
    </div>`);
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
    mount(pane, html`<div class="card"><div class="card-head"><h2>Contacts</h2><button class="btn sm" data-addc ${office ? '' : 'disabled'}>+ Add contact</button></div>
      <div class="card-body flush">${dataTable({
        rows: contacts, empty: 'No additional contacts.',
        columns: [...fieldColumns('contacts'), ...(office ? [{ label: '', render: x => html`<button class="btn sm ghost" data-ec="${x.id}">Edit</button>`, cls: 'actions-cell' }] : [])],
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
      <div class="small muted">${[s.brand || s.panel_brand, s.model || s.panel_model, s.system_type && res === 'fire_systems' ? s.system_type : ''].filter(Boolean).join(' · ')}</div></div>
    <div class="actions"><button class="btn sm ghost" data-svc="${sys}" data-label="${title}">Service</button><button class="btn sm" data-edit-sys="${res}" data-id="${s.id}">Edit</button></div></div>
    <div class="card-body"><dl class="dl small">${shown.filter(f => f.name !== 'location').map(f => html`<dt>${f.label}</dt><dd>${f.type === 'date' && /next/.test(f.name) ? dueCell(s[f.name]) : renderValue(f, s, res)}</dd>`)}</dl>
    ${s.notes ? html`<div class="small" style="margin-top:10px;white-space:pre-wrap">${s.notes}</div>` : ''}</div></div>`;
}
