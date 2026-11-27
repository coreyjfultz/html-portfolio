import {
  html, mount, $, $$, money, fmtDate, fmtDateTime, badge, typeBadge, relDays, dataTable, openForm, promptForm, loading, toast, confirmDialog,
} from '../ui.js';
import { R, POST } from '../api.js';
import { can, refresh, state } from '../app.js';

const OPEN = 'new,scheduled,in progress,on hold';

export async function list(view, _, query) {
  const techs = await R.list('technicians', { active: 1 });
  const f = {
    group: query.status === 'completed' ? 'completed' : query.group || (state.user.role === 'technician' ? 'mine' : 'open'),
    priority: query.priority || '', technician_id: query.technician_id || '', q: '', uninvoiced: query.uninvoiced === '1',
  };
  mount(view, html`
    <div class="page-head"><div><h1>Service calls</h1><div class="sub">Work orders, installs, inspections and repairs</div></div>
      <div class="actions">${can.staff() ? html`<a class="btn" href="/api/export/service_calls">Export CSV</a>` : ''}<button class="btn primary" data-new>+ New service call</button></div></div>
    <div class="filters">
      <div class="seg" data-group>
        ${state.user.technician_id ? html`<button data-v="mine">My calls</button>` : ''}
        <button data-v="open">Open</button><button data-v="unassigned">Unassigned</button><button data-v="completed">Completed</button><button data-v="all">All</button></div>
      <select data-priority aria-label="Priority"><option value="">Any priority</option>${['emergency', 'high', 'normal', 'low'].map(p => html`<option value="${p}">${p}</option>`)}</select>
      <select data-tech aria-label="Technician"><option value="">All technicians</option>${techs.map(t => html`<option value="${t.id}">${t.name}</option>`)}</select>
      <input type="search" placeholder="Call #, summary…" data-q aria-label="Search calls">
      <label class="row small ${can.billing() ? '' : 'hidden'}"><input type="checkbox" data-uninv> Not invoiced</label>
    </div>
    <div class="card"><div class="card-body flush" data-table></div></div>`);
  $('[data-priority]', view).value = f.priority;
  $('[data-tech]', view).value = f.technician_id;
  $('[data-uninv]', view).checked = f.uninvoiced;
  const load = async () => {
    $$('[data-group] button', view).forEach(b => b.classList.toggle('on', b.dataset.v === f.group));
    const q = { q: f.q, priority: f.priority, technician_id: f.technician_id };
    if (f.group === 'open') q.status__in = OPEN;
    if (f.group === 'completed') q.status = 'completed';
    if (f.group === 'unassigned') { q.status__in = OPEN; q.technician_id__null = '1'; }
    if (f.group === 'mine') { q.status__in = OPEN; q.technician_id = state.user.technician_id; }
    if (f.uninvoiced) { q.status = 'completed'; q.billable = 1; q.invoice_id__null = '1'; delete q.status__in; }
    let rows = await R.list('service_calls', q);
    if (f.group === 'open' || f.group === 'mine') {
      const pr = { emergency: 0, high: 1, normal: 2, low: 3 };
      rows.sort((a, b) => (pr[a.priority] - pr[b.priority]) || (a.scheduled_start || '9').localeCompare(b.scheduled_start || '9'));
    }
    mount($('[data-table]', view), callsTable(rows));
  };
  $('[data-group]', view).addEventListener('click', e => { if (e.target.dataset.v) { f.group = e.target.dataset.v; f.uninvoiced = false; $('[data-uninv]', view).checked = false; load(); } });
  $('[data-priority]', view).addEventListener('change', e => { f.priority = e.target.value; load(); });
  $('[data-tech]', view).addEventListener('change', e => { f.technician_id = e.target.value; load(); });
  $('[data-uninv]', view).addEventListener('change', e => { f.uninvoiced = e.target.checked; load(); });
  let t;
  $('[data-q]', view).addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { f.q = e.target.value; load(); }, 250); });
  $('[data-new]', view).addEventListener('click', () => newCall());
  await load();
  if (query.new) newCall();
}

export function newCall(defaults = {}) {
  return openForm('service_calls', { defaults, onSaved: s => { location.hash = `#/calls/${s.id}`; } });
}

export function callsTable(rows, empty = 'No service calls match.') {
  return dataTable({
    rows, href: c => `#/calls/${c.id}`, empty,
    columns: [
      { label: 'Call', render: c => html`<b>SC-${c.number}</b>` },
      { label: 'Customer', render: c => html`${c.customer_id_label} ${typeBadge(c.customer_type)}<div class="small muted">${c.title}</div>` },
      { label: 'Type', render: c => html`${c.call_type}<div class="small muted">${c.system_type || ''}</div>` },
      { label: 'Priority', render: c => badge(c.priority) },
      { label: 'Technician', render: c => c.technician_id_label ? html`<span class="dot" style="background:${c.technician_color || '#64748b'}"></span> ${c.technician_id_label}` : html`<span class="muted">Unassigned</span>` },
      { label: 'Scheduled', render: c => c.scheduled_start ? html`${fmtDateTime(c.scheduled_start)}<div class="small muted">${relDays(c.scheduled_start)}</div>` : html`<span class="muted">—</span>` },
      { label: 'Status', render: c => html`${badge(c.status)}${c.invoice_id ? html` <span class="badge good">invoiced</span>` : ''}` },
    ],
  });
}

export async function detail(view, [id]) {
  loading(view);
  const office = can.billing();
  const c = await R.get('service_calls', id);
  const [cust, parts] = await Promise.all([R.get('customers', c.customer_id), R.list('service_call_parts', { service_call_id: id })]);
  const reload = () => refresh();
  const partsBilled = parts.reduce((s, p) => s + p.qty * (p.unit_price || 0), 0);
  const partsCost = parts.reduce((s, p) => s + p.qty * (p.unit_cost || 0), 0);
  const laborBilled = (c.labor_hours || 0) * (c.labor_rate || 0);
  const closed = ['completed', 'cancelled'].includes(c.status);
  const addr = c.customer_address?.replace(/^, |, $/g, '');

  mount(view, html`
    <div class="crumbs"><a href="#/calls">Service calls</a> /</div>
    <div class="page-head"><div>
        <h1>SC-${c.number} · ${c.title}</h1>
        <div class="sub row">${badge(c.status)} ${badge(c.priority)} <span>${c.call_type} · ${c.system_type || ''}</span></div></div>
      <div class="actions">
        <button class="btn" data-edit>Edit</button>
        ${c.status === 'new' || c.status === 'scheduled' || c.status === 'on hold' ? html`<button class="btn" data-start>Start job</button>` : ''}
        ${!closed ? html`<button class="btn primary" data-complete>Complete job</button>` : ''}
        ${office && c.status === 'completed' && c.billable && !c.invoice_id ? html`<button class="btn primary" data-invoice>Create invoice</button>` : ''}
        ${office && c.invoice_id ? html`<a class="btn" href="#/invoices/${c.invoice_id}">View invoice ${c.invoice_id_label}</a>` : ''}
      </div></div>
    <div class="grid g3">
      <div class="card span2"><div class="card-head"><h2>Job details</h2></div><div class="card-body"><dl class="dl">
        <dt>Customer</dt><dd><a href="#/customers/${cust.id}">${cust.name}</a> ${typeBadge(cust.type)}</dd>
        <dt>Phone</dt><dd>${cust.phone ? html`<a href="tel:${cust.phone}">${cust.phone}</a>` : '—'}</dd>
        <dt>Address</dt><dd>${addr || '—'} ${addr ? html`<a class="small" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr)}">Directions ↗</a>` : ''}</dd>
        ${cust.access_notes ? html`<dt>Site access</dt><dd style="white-space:pre-wrap">${cust.access_notes}</dd>` : ''}
        <dt>Technician</dt><dd>${c.technician_id_label ? html`<span class="dot" style="background:${c.technician_color}"></span> ${c.technician_id_label}` : html`<span class="muted">Unassigned</span>`}</dd>
        <dt>Scheduled</dt><dd>${c.scheduled_start ? fmtDateTime(c.scheduled_start) : '—'} ${c.duration_hours ? html`<span class="muted">(${c.duration_hours} h est.)</span>` : ''}</dd>
        <dt>Problem / request</dt><dd style="white-space:pre-wrap">${c.description || '—'}</dd>
        ${c.status === 'completed' ? html`<dt>Completed</dt><dd>${fmtDateTime(c.completed_at)}</dd>
          <dt>Labor</dt><dd>${c.labor_hours ?? 0} h${office ? html` × ${money(c.labor_rate)}` : ''}</dd>
          <dt>Work performed</dt><dd style="white-space:pre-wrap">${c.resolution || '—'}</dd>` : ''}
        <dt>Billable</dt><dd>${c.billable ? 'Yes' : 'No (warranty / estimate / no charge)'}</dd>
      </dl>
      <div class="row" style="margin-top:14px"><a class="btn sm" href="#/customers/${cust.id}?tab=systems">View customer's systems & passwords</a></div>
      </div></div>
      ${office ? html`<div class="stack">
        <div class="kpi"><div class="label">Labor billed</div><div class="value">${money(laborBilled)}</div></div>
        <div class="kpi"><div class="label">Parts billed</div><div class="value">${money(partsBilled)}</div><div class="hint">Cost ${money(partsCost)}</div></div>
        <div class="kpi"><div class="label">Est. job profit</div><div class="value">${money(laborBilled + partsBilled - partsCost)}</div><div class="hint">Before labor cost</div></div>
      </div>` : html`<div></div>`}
      <div class="card span2"><div class="card-head"><div><h2>Parts & equipment used</h2><div class="small muted">Taken out of the truck or warehouse inventory automatically</div></div>
        <button class="btn sm" data-addpart>+ Add part</button></div>
        <div class="card-body flush">${dataTable({
          rows: parts, empty: 'No parts recorded.',
          columns: [
            { label: 'Item', render: p => p.item_id_label },
            { label: 'From', render: p => p.location_id_label || 'Warehouse' },
            { label: 'Qty', key: 'qty', cls: 'num' },
            ...(office ? [{ label: 'Price', render: p => money(p.unit_price), cls: 'num' }, { label: 'Line', render: p => money(p.qty * p.unit_price), cls: 'num' }] : []),
            { label: '', cls: 'actions-cell', render: p => html`<button class="btn sm ghost danger" data-rmpart="${p.id}" title="Remove and return to stock">Remove</button>` },
          ] })}</div></div>
    </div>`);

  $('[data-edit]', view).addEventListener('click', () => openForm('service_calls', { record: c, onSaved: reload, onDeleted: () => { location.hash = '#/calls'; }, allowDelete: office }));
  $('[data-start]', view)?.addEventListener('click', async () => { await R.update('service_calls', id, { status: 'in progress' }); toast('Job started'); reload(); });
  $('[data-complete]', view)?.addEventListener('click', () => promptForm({
    title: 'Complete job', size: '',
    fields: [
      { name: 'labor_hours', label: 'Labor hours', type: 'number', step: '0.25', value: c.labor_hours ?? c.duration_hours ?? 1 },
      { name: 'resolution', label: 'Work performed / notes for the customer', type: 'textarea', value: c.resolution || '' },
    ],
    intro: html`<p class="muted" style="margin-top:0">Add any parts used before or after completing. ${office ? 'You can create the invoice next.' : 'The office will invoice it.'}</p>`,
    submitLabel: 'Mark completed',
    onSubmit: async d => {
      await R.update('service_calls', id, { status: 'completed', labor_hours: d.labor_hours, resolution: d.resolution });
      toast('Job completed');
      reload();
    },
  }));
  $('[data-invoice]', view)?.addEventListener('click', async () => {
    const r = await POST(`/api/service_calls/${id}/invoice`);
    toast('Draft invoice created');
    location.hash = `#/invoices/${r.id}`;
  });
  $('[data-addpart]', view).addEventListener('click', () => openForm('service_call_parts', { defaults: { service_call_id: Number(id) }, hide: ['service_call_id', ...(office ? [] : ['unit_price'])], onSaved: reload }));
  $$('[data-rmpart]', view).forEach(b => b.addEventListener('click', async () => {
    if (!(await confirmDialog('Remove this part from the job? It will be returned to the stock location it came from.', { okLabel: 'Remove' }))) return;
    await R.del('service_call_parts', b.dataset.rmpart);
    toast('Part removed and returned to stock');
    reload();
  }));
}
