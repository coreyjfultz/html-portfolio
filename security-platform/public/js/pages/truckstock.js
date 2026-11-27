// Truck stock, weekly counts, tools, job materials and the start-of-day check.
import { html, mount, $, $$, money, num, fmtDate, fmtDateTime, fmtTime, badge, dataTable, openForm, openModal, promptForm, loading, toast, confirmDialog } from '../ui.js';
import { R, GET, POST } from '../api.js';
import { can, refresh } from '../app.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const STATUS_BADGE = { short: ['Short', 'bad'], extra: ['Too many', 'warn'], ok: ['OK', 'good'], negative: ['Count it', 'bad'], 'not standard': ['Extra item', ''] };
const stockBadge = s => badge(STATUS_BADGE[s.status]?.[0] || s.status, STATUS_BADGE[s.status]?.[1] ?? '');
const showErr = (el, e) => { const b = $('[data-err]', el); b.textContent = e.message; b.classList.remove('hidden'); };

// ---------------------------------------------------------------- office overview (#/truck-stock)
export async function overview(view) {
  loading(view);
  const [ov, items, alerts, board] = await Promise.all([
    GET('/api/truck-stock'), R.list('inventory_items', { active: 1 }), GET('/api/alerts').catch(() => []),
    can.manage() ? GET('/api/readiness/today').catch(() => []) : Promise.resolve([]),
  ]);
  const standard = items.filter(i => i.truck_min > 0);
  const countAlerts = alerts.filter(a => ['truck_count', 'count_overdue', 'readiness_short'].includes(a.kind));
  const due = ov.vehicles.filter(v => v.due);
  mount(view, html`
    <div class="page-head"><div><h1>Truck stock</h1><div class="sub">Standard stock on every truck, weekly counts every ${DAYS[Number(ov.settings.truck_count_day)] || 'week'}, and what each truck needs</div></div>
      <div class="actions"><a class="btn" href="#/tools">Tools</a><button class="btn" data-std>+ Add to standard truck stock</button></div></div>
    <div class="kpis">
      <div class="kpi ${due.length ? 'alert' : ''}"><div class="label">Counts due / overdue</div><div class="value">${due.length}</div><div class="hint">of ${ov.vehicles.length} trucks in service</div></div>
      <div class="kpi"><div class="label">Trucks short on standard stock</div><div class="value">${ov.vehicles.filter(v => v.short).length}</div></div>
      <div class="kpi"><div class="label">Trucks carrying too many extras</div><div class="value">${ov.vehicles.filter(v => v.extra).length}</div></div>
      <div class="kpi"><div class="label">Stock on trucks (cost)</div><div class="value">${money(ov.vehicles.reduce((s, v) => s + v.value, 0))}</div></div>
    </div>
    ${countAlerts.length ? html`<div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Needs a look</h2></div><div class="card-body stack" style="gap:8px">${countAlerts.map(a => alertRow(a))}</div></div>` : ''}
    ${board.length ? html`<div class="card" style="margin-bottom:16px"><div class="card-head"><div><h2>Start-of-day checks today</h2><div class="small muted">Technicians can't start jobs until they've confirmed their equipment (or you approve)</div></div></div>
      <div class="card-body flush">${dataTable({
        rows: board,
        columns: [
          { label: 'Technician', render: t => html`<span class="dot" style="background:${t.color}"></span> ${t.name}` },
          { label: 'Jobs', render: t => t.jobs, cls: 'num' },
          { label: 'Check', render: t => badge(t.status, { ready: 'good', approved: 'info', short: 'bad', 'not done': 'warn' }[t.status]) },
          { label: 'Missing', render: t => t.missing.length ? t.missing.map(m => m.name).join(', ') : t.short_lines ? html`<span class="muted">${t.short_lines} line(s) short on truck</span>` : '—' },
          { label: '', cls: 'actions-cell', render: t => ['ready', 'approved'].includes(t.status) ? '' : html`<button class="btn sm" data-approve="${t.technician_id}" data-name="${t.name}">Approve start</button>` },
        ] })}</div></div>` : ''}
    <div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Weekly counts</h2></div><div class="card-body flush">${dataTable({
      rows: ov.vehicles, href: v => `#/vehicles/${v.vehicle_id}`, empty: 'No vehicles in service.',
      columns: [
        { label: 'Truck', render: v => html`<b>${v.unit_name}</b><div class="small muted">${v.tech_name || 'Unassigned'}</div>` },
        { label: 'Last count', render: v => v.last_count ? html`${fmtDate(v.last_count.slice(0, 10))}<div class="small muted">${v.days_since === 0 ? 'today' : `${v.days_since} days ago`} · ${v.last_by}</div>` : html`<span class="muted">Never</span>` },
        { label: 'Status', render: v => v.due ? badge(v.days_since == null || v.days_since >= 8 ? 'overdue' : 'due', v.days_since == null || v.days_since >= 8 ? 'bad' : 'warn') : badge('counted', 'good') },
        { label: 'Last result', render: v => v.last_count_id ? html`${v.last_variance_lines ? `${v.last_variance_lines} off (${money(v.last_variance_value)})` : 'Matched'}${v.last_missing_tools ? html`<div class="small" style="color:var(--bad)">${v.last_missing_tools} tool issue(s)</div>` : ''}${v.last_variance_lines || v.last_missing_tools ? html`<div class="small muted">${v.reviewed ? 'Reviewed' : 'Not reviewed'}</div>` : ''}` : '—' },
        { label: 'Short', render: v => v.short ? html`<b style="color:var(--bad)">${v.short}</b>` : '0', cls: 'num' },
        { label: 'Extras', render: v => v.extra ? html`<b style="color:var(--warn)">${v.extra}</b>` : '0', cls: 'num' },
        { label: 'Value', render: v => money(v.value), cls: 'num' },
      ] })}</div></div>
    <div class="card"><div class="card-head"><div><h2>Standard truck stock</h2><div class="small muted">Every truck carries at least the minimum — including a spare or two — and no more than the maximum. Set exceptions per truck on the vehicle page.</div></div></div>
      <div class="card-body flush">${dataTable({
        rows: standard, href: i => `#/inventory/${i.id}`, empty: 'Nothing yet. Add batteries, contacts, wire, connectors… everything a tech should always have.',
        columns: [
          { label: 'Item', render: i => html`<b>${i.name}</b><div class="small muted">${[i.sku, i.category].filter(Boolean).join(' · ')}</div>` },
          { label: 'Min per truck', render: i => num(i.truck_min), cls: 'num' },
          { label: 'Max per truck', render: i => num(i.truck_max ?? i.truck_min + 1), cls: 'num' },
          { label: 'Warehouse', render: i => num(i.warehouse_qty), cls: 'num' },
          { label: 'Needed to fill all trucks', render: i => num(i.truck_min * ov.vehicles.length), cls: 'num' },
        ] })}</div></div>`);
  $('[data-std]', view).addEventListener('click', () => promptForm({
    title: 'Standard truck stock',
    intro: html`<p class="muted" style="margin-top:0">Every truck should carry this item.</p>`,
    fields: [
      { name: 'item_id', label: 'Item', type: 'select', options: items.map(i => ({ value: i.id, label: i.name })), required: true },
      { name: 'truck_min', label: 'Keep at least (include a spare)', type: 'number', value: 2, required: true },
      { name: 'truck_max', label: 'Most to keep', type: 'number', value: '' },
    ],
    onSubmit: async d => { await R.update('inventory_items', d.item_id, { truck_min: d.truck_min, truck_max: d.truck_max === '' ? null : d.truck_max }); toast('Added to standard truck stock'); refresh(); },
  }));
  wireAlerts(view);
  $$('[data-approve]', view).forEach(b => b.addEventListener('click', () => approveDialog(Number(b.dataset.approve), b.dataset.name, refresh)));
}

export function alertRow(a) {
  return html`<div class="alert-row ${a.severity}"><div><b>${a.title}</b>${a.body ? html`<div class="small muted" style="white-space:pre-wrap">${a.body}</div>` : ''}<div class="small muted">${fmtDateTime(a.created_at.replace(' ', 'T'))}</div></div>
    <div class="row">${a.link ? html`<a class="btn sm" href="${a.link}">Open</a>` : ''}<button class="btn sm ghost" data-resolve="${a.id}">Dismiss</button></div></div>`;
}
export function wireAlerts(root, onDone = refresh) {
  $$('[data-resolve]', root).forEach(b => b.addEventListener('click', async () => { await POST(`/api/alerts/${b.dataset.resolve}/resolve`); onDone(); }));
}

export function approveDialog(techId, name, onDone) {
  promptForm({
    title: `Let ${name} start without a complete check`,
    intro: html`<p class="muted" style="margin-top:0">Recorded with your name. Use this when someone is bringing the missing equipment, or the job doesn't need it.</p>`,
    fields: [{ name: 'reason', label: 'Reason', type: 'text', required: true }],
    submitLabel: 'Approve start',
    onSubmit: async d => { await POST('/api/readiness/approve', { technician_id: techId, reason: d.reason }); toast('Approved'); onDone?.(); },
  });
}

// ---------------------------------------------------------------- vehicle page card
export async function truckCard(card, v, { office = can.billing(), mine = false } = {}) {
  const d = await GET(`/api/vehicles/${v.id}/truck-stock`);
  const short = d.stock.filter(s => s.need), extra = d.stock.filter(s => s.extra);
  const canAct = office || mine;
  mount(card, html`<div class="card-head"><div><h2>Truck stock</h2><div class="small muted">${short.length} short · ${extra.length} with too many · last count ${d.counts[0] ? fmtDate(d.counts[0].created_at.slice(0, 10)) : 'never'}</div></div>
      <div class="row">${canAct ? html`<button class="btn sm primary" data-count>Weekly count</button>
        ${short.length ? html`<button class="btn sm" data-restock>Restock ${short.length} from warehouse</button>` : ''}
        ${extra.length ? html`<button class="btn sm" data-return>Return extras</button>` : ''}` : ''}
        ${office ? html`<button class="btn sm ghost" data-exception>+ Exception</button>` : ''}</div></div>
    <div class="card-body flush">${dataTable({
      rows: d.stock, empty: 'No standard truck stock set yet (Operations → Truck stock).',
      columns: [
        { label: 'Item', render: s => html`${s.name}<div class="small muted">${s.sku || ''}${s.exception_id ? ' · exception for this truck' : ''}</div>` },
        { label: 'On truck', render: s => html`<b>${num(s.on_hand)}</b>`, cls: 'num' },
        { label: 'Min / max', render: s => s.standard ? `${num(s.min)} / ${num(s.max)}` : '—', cls: 'num' },
        { label: '', render: s => html`${stockBadge(s)}${s.need ? html`<div class="small muted">needs ${num(s.need)}${s.warehouse_qty < s.need ? ` (warehouse has ${num(s.warehouse_qty)})` : ''}</div>` : s.extra ? html`<div class="small muted">${num(s.extra)} to return</div>` : ''}` },
        ...(office ? [{ label: '', cls: 'actions-cell', render: s => s.exception_id ? html`<button class="btn sm ghost" data-editex="${s.exception_id}">Edit exception</button>` : '' }] : []),
      ] })}
      ${d.suggestions.length && office ? html`<div class="note" style="margin:12px">💡 Used on several jobs from this truck but not standard stock: ${d.suggestions.map((x, i) => html`${i ? ', ' : ''}<b>${x.name}</b> (${x.jobs} jobs)`)}. Consider adding them.</div>` : ''}
    </div>
    <div class="card-head" style="border-top:1px solid var(--border)"><h2>Tools on this truck</h2>${office ? html`<button class="btn sm ghost" data-addtool>+ Tool</button>` : ''}</div>
    <div class="card-body flush">${dataTable({
      rows: d.tools, empty: 'No tools assigned to this truck.',
      columns: [
        { label: 'Tool', render: t => html`${t.name}${t.tag ? html` <span class="mono small">#${t.tag}</span>` : ''}` },
        { label: 'Qty', render: t => num(t.qty), cls: 'num' },
        { label: 'Status', render: t => badge(t.status, { 'in service': 'good', 'needs repair': 'warn', missing: 'bad' }[t.status] || '') },
        { label: 'Last counted', render: t => t.last_counted ? fmtDate(t.last_counted) : '—' },
      ] })}</div>
    ${d.counts.length ? html`<div class="card-head" style="border-top:1px solid var(--border)"><h2>Count history</h2></div><div class="card-body flush">${dataTable({
      rows: d.counts,
      columns: [
        { label: 'When', render: c => html`<a href="#" data-countview="${c.id}">${fmtDateTime(c.created_at.replace(' ', 'T'))}</a>` },
        { label: 'By', render: c => c.user_name },
        { label: 'Result', render: c => c.variance_lines || c.missing_tools ? html`<span style="color:var(--bad)">${c.variance_lines} off${c.missing_tools ? `, ${c.missing_tools} tool issue(s)` : ''}</span>` : html`<span style="color:var(--good)">Matched</span>` },
        ...(office ? [{ label: 'Variance', render: c => money(c.variance_value), cls: 'num' }] : []),
        { label: '', render: c => c.reviewed_by ? html`<span class="small muted">Reviewed by ${c.reviewed_by}</span>` : '' },
      ] })}</div>` : ''}`);
  const again = () => truckCard(card, v, { office, mine });
  $('[data-count]', card)?.addEventListener('click', () => countDialog(v, again));
  $('[data-restock]', card)?.addEventListener('click', () => moveDialog(v, 'load', short, again));
  $('[data-return]', card)?.addEventListener('click', () => moveDialog(v, 'return', extra, again));
  $('[data-exception]', card)?.addEventListener('click', () => openForm('truck_par', { defaults: { vehicle_id: v.id }, hide: ['vehicle_id'], onSaved: again }));
  $$('[data-editex]', card).forEach(b => b.addEventListener('click', async () => openForm('truck_par', { record: await R.get('truck_par', b.dataset.editex), hide: ['vehicle_id'], onSaved: again, onDeleted: again, allowDelete: true })));
  $('[data-addtool]', card)?.addEventListener('click', () => openForm('tools', { defaults: { vehicle_id: v.id }, onSaved: again }));
  $$('[data-countview]', card).forEach(a => a.addEventListener('click', e => { e.preventDefault(); countView(Number(a.dataset.countview), again); }));
  const open = new URLSearchParams(location.hash.split('?')[1] || '').get('count');
  if (open && !card.dataset.opened) { card.dataset.opened = '1'; countView(Number(open), again); }
}

export function moveDialog(v, direction, rows, onDone) {
  const load = direction === 'load';
  const { el, close } = openModal({
    title: load ? `Restock ${v.unit_name} from the warehouse` : `Return extras from ${v.unit_name}`, size: 'sm',
    body: html`<div class="err-box hidden" data-err></div><p class="muted" style="margin-top:0">${load ? 'Brings the truck up to its standard stock.' : 'Takes the truck back down to its maximum.'} Adjust if needed.</p>
      <div class="stack" style="gap:8px">${rows.map(s => html`<div class="row" style="justify-content:space-between"><span>${s.name}${load && s.warehouse_qty < s.need ? html`<div class="small" style="color:var(--bad)">Warehouse only has ${num(s.warehouse_qty)}</div>` : ''}</span>
        <input type="number" min="0" step="1" style="width:90px" data-line="${s.item_id}" value="${load ? Math.min(s.need, Math.max(0, s.warehouse_qty)) : s.extra}" aria-label="Qty for ${s.name}"></div>`)}</div>`,
    foot: html`<button class="btn" data-close>Cancel</button><button class="btn primary" data-go>${load ? 'Load truck' : 'Return to warehouse'}</button>`,
  });
  $('[data-go]', el).addEventListener('click', async () => {
    const lines = $$('[data-line]', el).map(i => ({ item_id: Number(i.dataset.line), qty: Number(i.value) })).filter(l => l.qty > 0);
    try { const r = await POST(`/api/vehicles/${v.id}/restock`, { direction, lines }); toast(`${r.moved} item${r.moved === 1 ? '' : 's'} moved`); close(); onDone?.(); }
    catch (e) { showErr(el, e); }
  });
}

/** Blind weekly count: the tech enters what's actually on the truck. */
export async function countDialog(v, onDone) {
  const sheet = await GET(`/api/vehicles/${v.id}/count-sheet`);
  const { el, close } = openModal({
    title: `Weekly count — ${v.unit_name}`,
    body: html`<div class="err-box hidden" data-err></div>
      <p class="muted" style="margin-top:0">Count what's physically on the truck — every bin, including batteries, wire and connectors. Enter 0 if there are none.</p>
      <div class="count-grid">${sheet.items.map(i => html`<label class="count-line"><span>${i.name}<span class="small muted">${i.sku ? ` · ${i.sku}` : ''}${i.min ? ` · keep ${i.min}` : ''}</span></span>
        <input type="number" inputmode="numeric" min="0" step="1" data-item="${i.item_id}" aria-label="Count of ${i.name}"></label>`)}</div>
      ${sheet.tools.length ? html`<h3 style="margin:16px 0 8px">Tools</h3><div class="count-grid">${sheet.tools.map(t => html`<label class="count-line"><span>${t.name}${t.tag ? html` <span class="mono small">#${t.tag}</span>` : ''}</span>
        <select data-tool="${t.tool_id}" aria-label="${t.name}"><option value="">—</option><option value="ok">Here, OK</option><option value="needs repair">Needs repair</option><option value="missing">Missing</option></select></label>`)}</div>` : ''}
      <div class="field" style="margin-top:12px"><label for="cnt_notes">Notes (optional)</label><input id="cnt_notes" type="text"></div>`,
    foot: html`<button class="btn" data-close>Cancel</button><button class="btn primary" data-go>Submit count</button>`,
  });
  $('[data-go]', el).addEventListener('click', async () => {
    const items = $$('[data-item]', el).map(i => ({ item_id: Number(i.dataset.item), counted: i.value === '' ? null : Number(i.value) }));
    const tools = $$('[data-tool]', el).map(s => ({ tool_id: Number(s.dataset.tool), condition: s.value }));
    const blank = items.filter(i => i.counted == null).length + tools.filter(t => !t.condition).length;
    if (blank) { showErr(el, new Error(`${blank} line${blank === 1 ? '' : 's'} still blank — count everything (enter 0 if none).`)); return; }
    $('[data-go]', el).disabled = true;
    try {
      const r = await POST(`/api/vehicles/${v.id}/counts`, { items, tools, notes: $('#cnt_notes', el).value });
      close();
      toast(r.variance_lines || r.tool_issues ? 'Count saved — differences sent to the office' : 'Count saved — everything matched');
      if (r.restock.length || r.extras.length) {
        moveDialog(v, r.restock.length ? 'load' : 'return', r.restock.length ? r.restock : r.extras, onDone);
      } else onDone?.();
    } catch (e) { showErr(el, e); $('[data-go]', el).disabled = false; }
  });
}

async function countView(id, onDone) {
  const c = await GET(`/api/truck-counts/${id}`);
  const office = can.billing();
  const { el, close } = openModal({
    title: `Count on ${fmtDateTime(c.created_at.replace(' ', 'T'))}`,
    body: html`<p class="muted" style="margin-top:0">By ${c.user_name}${c.notes ? ` — “${c.notes}”` : ''}</p>${dataTable({
      rows: c.lines,
      columns: [
        { label: 'Item / tool', render: l => l.name },
        { label: 'Expected', render: l => l.tool_id ? '' : num(l.expected), cls: 'num' },
        { label: 'Counted', render: l => l.tool_id ? (l.condition === 'ok' ? 'Here' : html`<b style="color:var(--bad)">${l.condition}</b>`) : html`<b style="${l.counted !== l.expected ? 'color:var(--bad)' : ''}">${num(l.counted)}</b>`, cls: 'num' },
        ...(office ? [{ label: 'Value', render: l => l.tool_id || l.counted === l.expected ? '' : money((l.counted - l.expected) * (l.unit_cost || 0)), cls: 'num' }] : []),
      ] })}`,
    foot: html`<button class="btn" data-close>Close</button>${office && !c.reviewed_at && (c.variance_lines || c.missing_tools) ? html`<button class="btn primary" data-review>Mark reviewed</button>` : ''}`,
  });
  $('[data-review]', el)?.addEventListener('click', async () => { await POST(`/api/truck-counts/${id}/review`); toast('Marked reviewed'); close(); onDone?.(); });
}

// ---------------------------------------------------------------- tools page (#/tools)
export async function tools(view) {
  const office = can.billing();
  const rows = await R.list('tools');
  const f = { q: '', status: '' };
  mount(view, html`
    <div class="page-head"><div><h1>Tools</h1><div class="sub">Ladders, meters, drills and other company equipment — where it is, and whether it's in service</div></div>
      <div class="actions">${office ? html`<a class="btn" href="/api/export/tools">Export CSV</a><button class="btn primary" data-new>+ New tool</button>` : ''}</div></div>
    <div class="kpis">
      <div class="kpi"><div class="label">Tools</div><div class="value">${rows.filter(t => t.status !== 'retired').length}</div></div>
      <div class="kpi ${rows.some(t => t.status === 'missing') ? 'alert' : ''}"><div class="label">Missing</div><div class="value">${rows.filter(t => t.status === 'missing').length}</div></div>
      <div class="kpi"><div class="label">Needs repair</div><div class="value">${rows.filter(t => t.status === 'needs repair').length}</div></div>
      ${office ? html`<div class="kpi"><div class="label">Value</div><div class="value">${money(rows.filter(t => t.status !== 'retired').reduce((s, t) => s + (t.cost || 0) * (t.qty || 1), 0))}</div></div>` : ''}
    </div>
    <div class="filters"><input type="search" placeholder="Name, tag, serial" data-q aria-label="Search tools">
      <select data-status aria-label="Status"><option value="">Any status</option>${['in service', 'needs repair', 'missing', 'retired'].map(s => html`<option>${s}</option>`)}</select></div>
    <div class="card"><div class="card-body flush" data-table></div></div>`);
  const draw = () => {
    const q = f.q.toLowerCase();
    mount($('[data-table]', view), dataTable({
      rows: rows.filter(t => (!f.status || t.status === f.status) && (!q || [t.name, t.tag, t.serial].some(x => x?.toLowerCase().includes(q)))),
      empty: 'No tools yet.',
      columns: [
        { label: 'Tool', render: t => html`<b>${t.name}</b>${t.tag ? html` <span class="mono small">#${t.tag}</span>` : ''}<div class="small muted">${t.category}${t.serial ? ` · S/N ${t.serial}` : ''}</div>` },
        { label: 'Where', render: t => t.vehicle_id_label || 'Warehouse / shop' },
        { label: 'Qty', render: t => num(t.qty), cls: 'num' },
        { label: 'Status', render: t => badge(t.status, { 'in service': 'good', 'needs repair': 'warn', missing: 'bad' }[t.status] || '') },
        { label: 'Last counted', render: t => t.last_counted ? fmtDate(t.last_counted) : '—' },
        ...(office ? [{ label: '', cls: 'actions-cell', render: t => html`<button class="btn sm ghost" data-edit="${t.id}">Edit</button>` }] : []),
      ] }));
    $$('[data-edit]', view).forEach(b => b.addEventListener('click', () => openForm('tools', { record: rows.find(t => t.id === Number(b.dataset.edit)), onSaved: refresh, onDeleted: refresh, allowDelete: true })));
  };
  $('[data-q]', view).addEventListener('input', e => { f.q = e.target.value; draw(); });
  $('[data-status]', view).addEventListener('change', e => { f.status = e.target.value; draw(); });
  $('[data-new]', view)?.addEventListener('click', () => openForm('tools', { onSaved: refresh }));
  draw();
}

// ---------------------------------------------------------------- job materials card (service call page)
export async function materialsCard(card, c, { onChange } = {}) {
  const rows = await GET(`/api/service_calls/${c.id}/materials`).catch(() => []);
  const open = rows.filter(m => m.status !== 'returned' && m.qty > (m.checked_out_qty || 0));
  const closed = ['completed', 'cancelled'].includes(c.status);
  mount(card, html`<div class="card-head"><div><h2>Job materials</h2><div class="small muted">Equipment planned for this job, checked out of the warehouse onto the truck</div></div>
      <div class="row">${!closed ? html`<button class="btn sm" data-addmat>+ Material</button>` : ''}
        ${open.length && !closed ? html`<button class="btn sm primary" data-checkout>Check out ${open.length} to truck</button>` : ''}</div></div>
    <div class="card-body flush">${dataTable({
      rows, empty: 'No materials planned. Signed proposals add their equipment here automatically.',
      columns: [
        { label: 'Item', render: m => html`${m.name}<div class="small muted">${m.sku || ''}${m.notes ? ` · ${m.notes}` : ''}</div>` },
        { label: 'Needed', render: m => num(m.qty), cls: 'num' },
        { label: 'Checked out', render: m => m.checked_out_qty ? html`${num(m.checked_out_qty)}<div class="small muted">${m.checked_out_to_label || ''} · ${m.checked_out_by || ''}</div>` : '—', cls: 'num' },
        { label: 'Warehouse', render: m => html`<span style="${m.warehouse_qty < m.qty - (m.checked_out_qty || 0) ? 'color:var(--bad);font-weight:600' : ''}">${num(m.warehouse_qty)}</span>`, cls: 'num' },
        { label: '', render: m => badge(m.status, { needed: 'warn', 'checked out': 'good', returned: '' }[m.status]) },
        { label: '', cls: 'actions-cell', render: m => html`${m.checked_out_qty > 0 ? html`<button class="btn sm ghost" data-ret="${m.id}" data-max="${m.checked_out_qty}" data-name="${m.name}">Return unused</button>` : ''}
          ${!m.checked_out_qty ? html`<button class="btn sm ghost danger" data-rmmat="${m.id}">Remove</button>` : ''}` },
      ] })}</div>`);
  const again = () => { materialsCard(card, c, { onChange }); onChange?.(); };
  $('[data-addmat]', card)?.addEventListener('click', () => openForm('job_materials', { defaults: { service_call_id: c.id }, hide: ['service_call_id'], onSaved: again }));
  $('[data-checkout]', card)?.addEventListener('click', async () => {
    try { const r = await POST(`/api/service_calls/${c.id}/materials/checkout`, {}); toast(`Checked out to ${r.vehicle}`); again(); }
    catch (e) { toast(e.message, 'error'); }
  });
  $$('[data-ret]', card).forEach(b => b.addEventListener('click', () => promptForm({
    title: `Return unused ${b.dataset.name}`,
    fields: [{ name: 'qty', label: 'How many go back to the warehouse?', type: 'number', value: b.dataset.max, required: true }],
    submitLabel: 'Return',
    onSubmit: async d => { await POST(`/api/service_calls/${c.id}/materials/return`, { id: Number(b.dataset.ret), qty: d.qty }); toast('Returned to warehouse'); again(); },
  })));
  $$('[data-rmmat]', card).forEach(b => b.addEventListener('click', async () => {
    if (!(await confirmDialog('Remove this material from the job?', { okLabel: 'Remove' }))) return;
    await R.del('job_materials', b.dataset.rmmat); again();
  }));
}

// ---------------------------------------------------------------- start-of-day check (My Day)
export async function readinessCard(card, techId, { onDone } = {}) {
  const q = can.tech() ? {} : { technician_id: techId };
  const r = await GET('/api/readiness', q);
  if (!r.jobs.length && !r.check) { card.classList.add('hidden'); return r; }
  card.classList.remove('hidden');
  const st = r.check?.status;
  mount(card, html`<div class="card-head"><div><h2>${r.cleared ? '✅' : '🧰'} Start-of-day check</h2>
      <div class="small muted">${r.cleared ? `${st === 'approved' ? `Approved by ${r.check.approved_by}: ${r.check.reason}` : `Done at ${fmtTime(r.check.created_at.replace(' ', 'T'))}`}` : `Before your first job, confirm you have the equipment for today's ${r.jobs.length} job${r.jobs.length === 1 ? '' : 's'}${r.vehicle ? ` on ${r.vehicle.unit_name}` : ''}.`}</div></div>
      ${!r.cleared ? html`<button class="btn primary" data-check>${st === 'short' ? 'Re-check' : 'Start check'}</button>` : ''}</div>
    ${st === 'short' ? html`<div class="card-body"><div class="err-box" style="margin:0">You reported missing: ${(r.check.missing || []).map(m => m.name).join(', ')}. Load it from the warehouse and re-check, or ask an administrator to approve.</div></div>` : ''}
    ${!r.cleared && (r.lines.length || r.low_standard.length) ? html`<div class="card-body flush">${dataTable({
      rows: r.lines, empty: 'No special materials planned for today’s jobs.',
      columns: [
        { label: 'Needed today', render: l => html`${l.name}<div class="small muted">${l.jobs.join(', ')}</div>` },
        { label: 'Need', render: l => num(l.needed), cls: 'num' },
        { label: 'On truck', render: l => html`<b style="${l.short ? 'color:var(--bad)' : ''}">${num(l.on_truck)}</b>`, cls: 'num' },
        { label: '', render: l => l.short ? badge(`short ${l.short}`, 'bad') : !l.spare_ok ? badge('no spare', 'warn') : badge('ok', 'good') },
      ] })}
      ${r.low_standard.length ? html`<div class="note row" style="margin:12px;justify-content:space-between"><span>Also low on standard truck stock: ${r.low_standard.map((s, i) => html`${i ? ', ' : ''}${s.name} (${num(s.on_truck)} of ${num(s.min)})`)}.</span>
        ${r.vehicle ? html`<button class="btn sm" data-restock>Restock from warehouse</button>` : ''}</div>` : ''}</div>` : ''}`);
  $('[data-restock]', card)?.addEventListener('click', () => moveDialog({ id: r.vehicle.id, unit_name: r.vehicle.unit_name }, 'load', r.low_standard, () => { readinessCard(card, techId, { onDone }); onDone?.(); }));
  $('[data-check]', card)?.addEventListener('click', () => readinessDialog(r, techId, () => { readinessCard(card, techId, { onDone }); onDone?.(); }));
  return r;
}

function readinessDialog(r, techId, onDone) {
  const { el, close } = openModal({
    title: 'Start-of-day check',
    body: html`<div class="err-box hidden" data-err></div>
      <p class="muted" style="margin-top:0">Physically check the truck. Tick what you have; mark anything you don't.${r.spares ? ` Aim for ${r.spares} spare of each.` : ''}</p>
      ${r.jobs.map(j => html`<div class="small muted" style="margin:8px 0 4px">${fmtTime(j.scheduled_start)} · SC-${j.number} ${j.customer} — ${j.title}</div>`)}
      <div class="stack" style="gap:6px;margin-top:10px">${r.lines.map(l => html`<div class="ready-line" data-line="${l.item_id}" data-name="${l.name}">
        <span><b>${l.name}</b> × ${num(l.needed)}${l.short ? html` <span class="small" style="color:var(--bad)">(system shows ${num(l.on_truck)} on truck)</span>` : ''}</span>
        <span class="seg"><label><input type="radio" name="rl_${l.item_id}" value="have"> Have it</label><label><input type="radio" name="rl_${l.item_id}" value="missing"> Missing</label></span></div>`)}
      ${r.tools.length ? html`<div class="ready-line" data-tools><span><b>Tools</b> <span class="small muted">${r.tools.map(t => t.name).join(', ')}</span></span>
        <span class="seg"><label><input type="radio" name="rl_tools" value="have"> All here</label><label><input type="radio" name="rl_tools" value="missing"> Something's missing</label></span></div>` : ''}
      ${!r.lines.length && !r.tools.length ? html`<label class="row"><input type="checkbox" data-plain> I've checked my truck and have what I need for today</label>` : ''}</div>
      <div class="field" style="margin-top:12px"><label for="rd_note">What's missing / notes</label><input id="rd_note" type="text" placeholder="e.g. only 1 battery, ladder left at the shop"></div>`,
    foot: html`<button class="btn" data-close>Cancel</button><button class="btn primary" data-go>Submit check</button>`,
  });
  $('[data-go]', el).addEventListener('click', async () => {
    const confirmed = [], missing = [];
    const note = $('#rd_note', el).value.trim();
    for (const row of $$('[data-line]', el)) {
      const v = $('input:checked', row)?.value;
      if (!v) { showErr(el, new Error(`Answer every line (${row.dataset.name})`)); return; }
      if (v === 'have') confirmed.push(Number(row.dataset.line)); else missing.push({ item_id: Number(row.dataset.line), name: row.dataset.name, note });
    }
    const toolsRow = $('[data-tools]', el);
    const toolsV = toolsRow ? $('input:checked', toolsRow)?.value : 'have';
    if (!toolsV) { showErr(el, new Error('Confirm your tools')); return; }
    if (toolsV === 'missing') missing.push({ item_id: null, name: 'Tools', note });
    if ($('[data-plain]', el) && !$('[data-plain]', el).checked) { showErr(el, new Error('Tick the box once you have checked the truck')); return; }
    try {
      const out = await POST('/api/readiness', { ...(can.tech() ? {} : { technician_id: techId }), confirmed, missing, tools_ok: toolsV === 'have', notes: note });
      close();
      toast(out.cleared ? 'All set — have a good day' : 'Sent to the office. You can start once it’s sorted or approved.', out.cleared ? '' : 'error');
      onDone?.();
    } catch (e) { showErr(el, e); }
  });
}
