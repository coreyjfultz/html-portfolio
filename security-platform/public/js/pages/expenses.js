import { html, mount, $, $$, money, money0, fmtDate, dataTable, openForm, todayStr } from '../ui.js';
import { R } from '../api.js';
import { RESOURCES } from '../schema.js';

const CATS = RESOURCES.expenses.fields.find(f => f.name === 'category').options;

export async function render(view, _, query) {
  const t = todayStr();
  const f = { from: query.from || t.slice(0, 8) + '01', to: query.to || t, category: '', q: '' };
  mount(view, html`
    <div class="page-head"><div><h1>Expenses</h1><div class="sub">Fuel, parts, payroll, insurance — everything that feeds the profit & loss report</div></div>
      <div class="actions"><a class="btn" href="/api/export/expenses">Export CSV</a><button class="btn primary" data-new>+ Add expense</button></div></div>
    <div class="filters">
      <label class="small">From <input type="date" data-from value="${f.from}"></label>
      <label class="small">To <input type="date" data-to value="${f.to}"></label>
      <select data-cat aria-label="Category"><option value="">All categories</option>${CATS.map(c => html`<option>${c}</option>`)}</select>
      <input type="search" placeholder="Vendor, description" data-q aria-label="Search expenses">
    </div>
    <div class="grid g3">
      <div class="card span2"><div class="card-body flush" data-table></div></div>
      <div class="card"><div class="card-head"><h2>By category</h2></div><div class="card-body" data-cats></div></div>
    </div>`);
  const load = async () => {
    const rows = await R.list('expenses', f);
    const total = rows.reduce((s, e) => s + e.amount, 0);
    const by = {};
    rows.forEach(e => { by[e.category] = (by[e.category] || 0) + e.amount; });
    const cats = Object.entries(by).sort((a, b) => b[1] - a[1]);
    const max = cats[0]?.[1] || 1;
    mount($('[data-cats]', view), cats.length ? html`<div class="small muted" style="margin-bottom:8px">Total ${money(total)}</div>${cats.map(([c, v]) => html`
      <div style="margin-bottom:9px"><div class="row" style="justify-content:space-between"><span>${c}</span><b class="num">${money0(v)}</b></div>
      <div class="load-bar" style="height:8px"><span style="width:${Math.max(2, v / max * 100)}%"></span></div></div>`)}` : html`<div class="muted">No expenses.</div>`);
    mount($('[data-table]', view), dataTable({
      rows, empty: 'No expenses in this range.',
      columns: [
        { label: 'Date', render: e => fmtDate(e.date) },
        { label: 'Category', key: 'category' },
        { label: 'Vendor / description', render: e => html`${e.vendor || '—'}<div class="small muted">${e.description || ''}</div>` },
        { label: 'Linked to', render: e => [e.vehicle_id_label, e.technician_id_label, e.service_call_id_label].filter(Boolean).join(' · ') || '—' },
        { label: 'Amount', render: e => money(e.amount), cls: 'num' },
        { label: '', cls: 'actions-cell', render: e => html`<button class="btn sm ghost" data-edit="${e.id}">Edit</button>` },
      ],
      foot: rows.length ? html`<tr><td colspan="4">${rows.length} expenses</td><td class="num">${money(total)}</td><td></td></tr>` : null,
    }));
    $$('[data-edit]', view).forEach(b => b.addEventListener('click', () => openForm('expenses', { record: rows.find(e => e.id === Number(b.dataset.edit)), onSaved: load, onDeleted: load })));
  };
  $('[data-from]', view).addEventListener('change', e => { f.from = e.target.value; load(); });
  $('[data-to]', view).addEventListener('change', e => { f.to = e.target.value; load(); });
  $('[data-cat]', view).addEventListener('change', e => { f.category = e.target.value; load(); });
  let tm;
  $('[data-q]', view).addEventListener('input', e => { clearTimeout(tm); tm = setTimeout(() => { f.q = e.target.value; load(); }, 250); });
  $('[data-new]', view).addEventListener('click', () => openForm('expenses', { onSaved: load }));
  await load();
}
