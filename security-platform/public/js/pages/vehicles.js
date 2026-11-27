import { html, mount, $, money, num, fmtDate, badge, relDays, dataTable, openForm, loading } from '../ui.js';
import { R, GET } from '../api.js';
import { can, refresh } from '../app.js';
import { transferStock, countStock, movesTable } from './inventory.js';

const due = d => d ? html`<span style="${d < new Date().toISOString().slice(0, 10) ? 'color:var(--bad);font-weight:600' : ''}">${fmtDate(d)}</span><div class="small muted">${relDays(d)}</div>` : '—';

export async function list(view) {
  const office = can.office();
  const rows = await R.list('vehicles');
  mount(view, html`
    <div class="page-head"><div><h1>Vehicles</h1><div class="sub">Fleet, assignments, renewals and on-board inventory</div></div>
      <div class="actions">${office ? html`<button class="btn primary" data-new>+ New vehicle</button>` : ''}</div></div>
    <div class="card"><div class="card-body flush">${dataTable({
      rows, href: v => `#/vehicles/${v.id}`, empty: 'No vehicles yet.',
      columns: [
        { label: 'Vehicle', render: v => html`<b>${v.unit_name}</b><div class="small muted">${[v.year, v.make, v.model].filter(Boolean).join(' ')} ${v.plate ? `· ${v.plate}` : ''}</div>` },
        { label: 'Assigned to', render: v => v.assigned_technician_id_label || html`<span class="muted">—</span>` },
        { label: 'Mileage', render: v => num(v.mileage), cls: 'num' },
        { label: 'Next service', render: v => due(v.next_service_date) },
        { label: 'Registration', render: v => due(v.registration_expires) },
        { label: 'Insurance', render: v => due(v.insurance_expires) },
        { label: 'Stock on board', render: v => html`${num(v.stock_units)} units${office ? html`<div class="small muted">${money(v.stock_value)}</div>` : ''}`, cls: 'num' },
        { label: 'Status', render: v => badge(v.status) },
      ] })}</div></div>`);
  $('[data-new]', view)?.addEventListener('click', () => openForm('vehicles', { onSaved: v => { location.hash = `#/vehicles/${v.id}`; } }));
}

export async function detail(view, [id]) {
  loading(view);
  const office = can.office();
  const [v, stock, moves, items, expenses] = await Promise.all([
    R.get('vehicles', id), GET('/api/stock', { location_id: id }), GET('/api/stock/movements', { location_id: id }),
    R.list('inventory_items', { active: 1 }), office ? R.list('expenses', { vehicle_id: id }) : Promise.resolve([]),
  ]);
  const onBoard = stock.filter(s => s.qty !== 0);
  mount(view, html`
    <div class="crumbs"><a href="#/vehicles">Vehicles</a> /</div>
    <div class="page-head"><div><h1>${v.unit_name} ${badge(v.status)}</h1><div class="sub">${[v.year, v.make, v.model, v.plate].filter(Boolean).join(' · ')}</div></div>
      <div class="actions">${office ? html`<button class="btn" data-edit>Edit</button>` : ''}
        <button class="btn" data-unload>Unload to warehouse</button><button class="btn primary" data-load>Load from warehouse</button></div></div>
    <div class="grid g3">
      <div class="card"><div class="card-head"><h2>Vehicle</h2></div><div class="card-body"><dl class="dl">
        <dt>Assigned to</dt><dd>${v.assigned_technician_id_label || '—'}</dd>
        <dt>VIN</dt><dd class="mono">${v.vin || '—'}</dd>
        <dt>Mileage</dt><dd>${num(v.mileage)}</dd>
        <dt>Next service</dt><dd>${due(v.next_service_date)}${v.next_service_miles ? html`<div class="small">or at ${num(v.next_service_miles)} mi</div>` : ''}</dd>
        <dt>Registration</dt><dd>${due(v.registration_expires)}</dd>
        <dt>Insurance</dt><dd>${due(v.insurance_expires)}</dd>
        ${v.notes ? html`<dt>Notes</dt><dd>${v.notes}</dd>` : ''}</dl></div></div>
      <div class="card span2"><div class="card-head"><div><h2>Inventory on this vehicle</h2><div class="small muted">${num(v.stock_units)} units${office ? ` · ${money(v.stock_value)} at cost` : ''}</div></div></div>
        <div class="card-body flush">${dataTable({
          rows: onBoard, empty: 'Nothing on board. Use "Load from warehouse".',
          columns: [
            { label: 'Item', render: s => html`<a href="#/inventory/${s.item_id}">${s.name}</a><div class="small muted">${s.sku || ''}</div>` },
            { label: 'Qty', render: s => html`<b style="${s.qty < 0 ? 'color:var(--bad)' : ''}">${num(s.qty)}</b>`, cls: 'num' },
            ...(office ? [{ label: 'Value', render: s => money(s.qty * (s.unit_cost || 0)), cls: 'num' }] : []),
            { label: '', cls: 'actions-cell', render: s => html`${office ? html`<button class="btn sm ghost" data-cnt="${s.item_id}">Count</button>` : ''}` },
          ] })}</div></div>
      ${office ? html`<div class="card span2" style="grid-column:1/-1"><div class="card-head"><h2>Vehicle expenses</h2>
          <button class="btn sm" data-exp>+ Expense</button></div><div class="card-body flush">${dataTable({
        rows: expenses, empty: 'No expenses recorded for this vehicle.',
        columns: [{ label: 'Date', render: e => fmtDate(e.date) }, { label: 'Category', key: 'category' }, { label: 'Vendor', render: e => e.vendor || '—' },
          { label: 'Description', render: e => e.description || '—' }, { label: 'Amount', render: e => money(e.amount), cls: 'num' }],
        foot: expenses.length ? html`<tr><td colspan="4">Total</td><td class="num">${money(expenses.reduce((s, e) => s + e.amount, 0))}</td></tr>` : null,
      })}</div></div>` : ''}
      <div class="card" style="grid-column:1/-1"><div class="card-head"><h2>Stock movements</h2></div><div class="card-body flush">${movesTable(moves, true)}</div></div>
    </div>`);
  $('[data-edit]', view)?.addEventListener('click', () => openForm('vehicles', { record: v, onSaved: refresh, onDeleted: () => { location.hash = '#/vehicles'; } }));
  $('[data-load]', view).addEventListener('click', () => transferStock(items, null, refresh, { from: 0, to: v.id }));
  $('[data-unload]', view).addEventListener('click', () => transferStock(items, onBoard[0]?.item_id, refresh, { from: v.id, to: 0 }));
  $('[data-exp]', view)?.addEventListener('click', () => openForm('expenses', { defaults: { vehicle_id: v.id, category: 'Vehicle maintenance' }, onSaved: refresh }));
  view.querySelectorAll('[data-cnt]').forEach(b => b.addEventListener('click', () => countStock(items.find(i => i.id === Number(b.dataset.cnt)) || { id: Number(b.dataset.cnt), name: 'item' }, refresh, v.id)));
}
