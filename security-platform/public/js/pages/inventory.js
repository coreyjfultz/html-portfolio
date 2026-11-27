import { html, mount, $, $$, money, num, dataTable, openForm, promptForm, loading, toast, getLocations, typeBadge } from '../ui.js';
import { R, GET, POST } from '../api.js';
import { can, refresh, state } from '../app.js';
import { RESOURCES } from '../schema.js';

const CATS = RESOURCES.inventory_items.fields.find(f => f.name === 'category').options;

export async function list(view, _, query) {
  const office = can.office();
  const [items, stock, vehicles] = await Promise.all([R.list('inventory_items', { active: 1 }), GET('/api/stock'), R.list('vehicles', { status__not: 'sold' })]);
  const f = { cat: query.cat || '', q: '', low: false };
  const qty = new Map(stock.map(s => [`${s.item_id}|${s.location_id}`, s.qty]));
  mount(view, html`
    <div class="page-head"><div><h1>Inventory</h1><div class="sub">Warehouse stock plus what's on each truck</div></div>
      <div class="actions">
        ${office ? html`<a class="btn" href="/api/export/inventory_items">Export CSV</a>` : ''}
        <button class="btn" data-transfer>Transfer / load truck</button>
        ${office ? html`<button class="btn" data-receive>Receive stock</button><button class="btn primary" data-new>+ New item</button>` : ''}</div></div>
    <div class="kpis">
      <div class="kpi"><div class="label">Items tracked</div><div class="value">${items.length}</div></div>
      ${office ? html`<div class="kpi"><div class="label">Stock value (at cost)</div><div class="value">${money(stock.reduce((s, x) => s + x.qty * (x.unit_cost || 0), 0))}</div></div>` : ''}
      <div class="kpi"><div class="label">On trucks</div><div class="value">${num(stock.filter(s => s.location_id).reduce((s, x) => s + x.qty, 0))}</div><div class="hint">units across ${vehicles.length} vehicles</div></div>
      <div class="kpi ${items.some(i => i.total_qty < i.reorder_level) ? 'alert' : ''}"><div class="label">Below reorder level</div><div class="value">${items.filter(i => i.total_qty < i.reorder_level).length}</div></div>
    </div>
    <div class="filters">
      <select data-cat aria-label="Category"><option value="">All categories</option>${CATS.map(c => html`<option value="${c}">${c}</option>`)}</select>
      <input type="search" placeholder="Name, SKU, manufacturer" data-q aria-label="Search inventory">
      <label class="row small"><input type="checkbox" data-low> Low stock only</label>
    </div>
    <div class="card"><div class="card-body flush" data-table></div></div>`);
  $('[data-cat]', view).value = f.cat;
  const draw = () => {
    const q = f.q.toLowerCase();
    const rows = items.filter(i => (!f.cat || i.category === f.cat) && (!f.low || i.total_qty < i.reorder_level)
      && (!q || [i.name, i.sku, i.manufacturer].some(x => x?.toLowerCase().includes(q))));
    mount($('[data-table]', view), dataTable({
      rows, href: i => `#/inventory/${i.id}`, empty: 'No items match.',
      columns: [
        { label: 'Item', render: i => html`<b>${i.name}</b><div class="small muted">${[i.sku, i.category].filter(Boolean).join(' · ')}</div>` },
        { label: 'Warehouse', render: i => fmtQty(qty.get(`${i.id}|0`) || 0), cls: 'num' },
        ...vehicles.map(v => ({ label: v.unit_name, render: i => fmtQty(qty.get(`${i.id}|${v.id}`) || 0, true), cls: 'num' })),
        { label: 'Total', render: i => html`<b style="${i.total_qty < i.reorder_level ? 'color:var(--bad)' : ''}">${num(i.total_qty)}</b>${i.total_qty < i.reorder_level ? html`<div class="small" style="color:var(--bad)">reorder (${i.reorder_level})</div>` : ''}`, cls: 'num' },
        ...(office ? [{ label: 'Cost', render: i => money(i.unit_cost), cls: 'num' }, { label: 'Price', render: i => money(i.unit_price), cls: 'num' }] : []),
      ],
    }));
  };
  $('[data-cat]', view).addEventListener('change', e => { f.cat = e.target.value; draw(); });
  $('[data-q]', view).addEventListener('input', e => { f.q = e.target.value; draw(); });
  $('[data-low]', view).addEventListener('change', e => { f.low = e.target.checked; draw(); });
  $('[data-new]', view)?.addEventListener('click', () => openForm('inventory_items', { onSaved: i => { location.hash = `#/inventory/${i.id}`; } }));
  $('[data-receive]', view)?.addEventListener('click', () => receiveStock(items, null, refresh));
  $('[data-transfer]', view).addEventListener('click', () => transferStock(items, null, refresh));
  draw();
}

const fmtQty = (n, faint) => n < 0 ? html`<b style="color:var(--bad)" title="Used more than recorded — count this location">${num(n)}</b>` : n === 0 && faint ? html`<span class="muted">·</span>` : num(n);

async function locOptions() {
  return (await getLocations()).map(l => ({ value: l.id, label: l.label }));
}
const itemOptions = items => items.map(i => ({ value: i.id, label: `${i.name}${i.sku ? ` (${i.sku})` : ''}` }));

export async function receiveStock(items, itemId, onDone) {
  const locs = await locOptions();
  promptForm({
    title: 'Receive stock (purchase / delivery)',
    fields: [
      { name: 'item_id', label: 'Item', type: 'select', options: itemOptions(items), value: itemId },
      { name: 'qty', label: 'Quantity received', type: 'number', value: 1 },
      { name: 'location_id', label: 'Received into', type: 'select', options: locs, value: 0 },
      { name: 'unit_cost', label: 'Unit cost (blank = item cost)', type: 'number', step: '0.01', value: '' },
      { name: 'vendor', label: 'Vendor / supplier', value: '' },
      { name: 'update_cost', label: 'Update the item\'s unit cost to this price', type: 'checkbox', value: false },
      { name: 'record_expense', label: 'Also record this purchase as an expense', type: 'checkbox', value: true },
    ],
    submitLabel: 'Receive',
    onSubmit: async d => { await POST('/api/stock/receive', d); toast('Stock received'); onDone?.(); },
  });
}

export async function transferStock(items, itemId, onDone, preset = {}) {
  const locs = await locOptions();
  const myVeh = state.user.technician_id ? (await R.list('vehicles', { assigned_technician_id: state.user.technician_id }))[0] : null;
  promptForm({
    title: 'Transfer stock',
    intro: html`<p class="muted" style="margin-top:0">Move parts between the warehouse and trucks (e.g. loading a van for tomorrow's install).</p>`,
    fields: [
      { name: 'item_id', label: 'Item', type: 'select', options: itemOptions(items), value: itemId },
      { name: 'qty', label: 'Quantity', type: 'number', value: 1 },
      { name: 'from', label: 'From', type: 'select', options: locs, value: preset.from ?? 0 },
      { name: 'to', label: 'To', type: 'select', options: locs, value: preset.to ?? myVeh?.id ?? locs[1]?.value ?? 0 },
      { name: 'note', label: 'Note (optional)', value: '' },
    ],
    submitLabel: 'Transfer',
    onSubmit: async d => { await POST('/api/stock/transfer', d); toast('Stock transferred'); onDone?.(); },
  });
}

export async function countStock(item, onDone, locationId = 0) {
  const locs = await locOptions();
  promptForm({
    title: `Physical count — ${item.name}`,
    fields: [
      { name: 'location_id', label: 'Location counted', type: 'select', options: locs, value: locationId },
      { name: 'qty', label: 'Quantity actually on hand', type: 'number', value: '' },
      { name: 'note', label: 'Note (optional)', value: '' },
    ],
    submitLabel: 'Save count',
    onSubmit: async d => { const r = await POST('/api/stock/count', { ...d, item_id: item.id }); toast(r.delta ? `Adjusted by ${r.delta > 0 ? '+' : ''}${r.delta}` : 'Count matches'); onDone?.(); },
  });
}

export async function detail(view, [id]) {
  loading(view);
  const office = can.office();
  const [item, stock, moves, items] = await Promise.all([R.get('inventory_items', id), GET('/api/stock'), GET('/api/stock/movements', { item_id: id }), R.list('inventory_items', { active: 1 })]);
  const here = stock.filter(s => s.item_id === Number(id));
  mount(view, html`
    <div class="crumbs"><a href="#/inventory">Inventory</a> /</div>
    <div class="page-head"><div><h1>${item.name}</h1><div class="sub">${[item.sku, item.category, item.manufacturer].filter(Boolean).join(' · ')}</div></div>
      <div class="actions">
        ${office ? html`<button class="btn" data-edit>Edit</button><button class="btn" data-count>Physical count</button><button class="btn" data-receive>Receive</button>` : ''}
        <button class="btn primary" data-transfer>Transfer</button></div></div>
    <div class="grid g3">
      <div class="card"><div class="card-head"><h2>Where it is</h2></div><div class="card-body flush">${dataTable({
        rows: here.filter(s => s.qty !== 0), empty: 'None in stock.',
        columns: [{ label: 'Location', render: s => s.location_id ? html`<a href="#/vehicles/${s.location_id}">${s.location_name}</a>` : 'Warehouse' }, { label: 'Qty', render: s => fmtQty(s.qty), cls: 'num' }],
        foot: html`<tr><td>Total</td><td class="num">${num(item.total_qty)}</td></tr>`,
      })}</div></div>
      <div class="card span2"><div class="card-head"><h2>Details</h2></div><div class="card-body"><dl class="dl">
        ${office ? html`<dt>Unit cost</dt><dd>${money(item.unit_cost)}</dd><dt>Sell price</dt><dd>${money(item.unit_price)}${item.unit_cost && item.unit_price ? html` <span class="muted">(${Math.round((1 - item.unit_cost / item.unit_price) * 100)}% margin)</span>` : ''}</dd>` : ''}
        <dt>Reorder level</dt><dd>${item.reorder_level ?? 0} ${item.total_qty < item.reorder_level ? html`<span class="badge bad">reorder now</span>` : ''}</dd>
        ${item.notes ? html`<dt>Notes</dt><dd>${item.notes}</dd>` : ''}</dl></div></div>
      <div class="card span2" style="grid-column:1/-1"><div class="card-head"><h2>Movement history</h2></div><div class="card-body flush">${movesTable(moves)}</div></div>
    </div>`);
  $('[data-edit]', view)?.addEventListener('click', () => openForm('inventory_items', { record: item, onSaved: refresh, onDeleted: () => { location.hash = '#/inventory'; } }));
  $('[data-receive]', view)?.addEventListener('click', () => receiveStock(items, item.id, refresh));
  $('[data-count]', view)?.addEventListener('click', () => countStock(item, refresh));
  $('[data-transfer]', view).addEventListener('click', () => transferStock(items, item.id, refresh));
}

export function movesTable(moves, showItem = false) {
  return dataTable({
    rows: moves, empty: 'No movements yet.',
    columns: [
      { label: 'When', render: m => m.created_at },
      ...(showItem ? [{ label: 'Item', render: m => html`<a href="#/inventory/${m.item_id}">${m.item_name}</a>` }] : []),
      { label: 'What', render: m => html`${m.kind}${m.call_number ? html` <a href="#/calls/${m.service_call_id}">SC-${m.call_number}</a>` : ''}<div class="small muted">${m.note || ''}</div>` },
      { label: 'From', render: m => m.from_name || (m.from_location == null ? '—' : 'Warehouse') },
      { label: 'To', render: m => m.to_name || (m.to_location == null ? '—' : 'Warehouse') },
      { label: 'Qty', render: m => num(m.qty), cls: 'num' },
      { label: 'By', render: m => m.user_name || '—' },
    ],
  });
}
