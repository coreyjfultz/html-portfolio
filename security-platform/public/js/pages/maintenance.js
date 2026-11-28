import { html, mount, $, $$, fmtDate, relDays, typeBadge, dataTable, openForm, promptForm, toast, todayStr, loading } from '../ui.js';
import { GET, POST } from '../api.js';

export function completeMaintenance(item, onDone) {
  const isVehicle = !!item.vehicle_id;
  promptForm({
    title: `Mark done: ${item.label}`,
    intro: html`<p class="muted" style="margin-top:0">${item.customer || 'Fleet'} — ${item.what}${item.count > 1 ? ` (${item.count} items)` : ''}</p>`,
    fields: [
      { name: 'date', label: 'Date completed', type: 'date', value: todayStr() },
      { name: 'next_date', label: isVehicle ? 'Next due date' : 'Next due date (leave blank to use the interval)', type: 'date', value: '' },
    ],
    submitLabel: 'Mark complete',
    onSubmit: async d => {
      await POST('/api/maintenance/complete', { key: item.key, ids: item.ids, date: d.date, next_date: d.next_date || undefined });
      toast('Updated — next due date set');
      onDone?.();
    },
  });
}

export function scheduleFromMaintenance(item) {
  openForm('service_calls', {
    title: 'Schedule maintenance call',
    defaults: {
      customer_id: item.customer_id, call_type: /inspection|test/i.test(item.label) ? 'inspection' : 'maintenance',
      system_type: item.system, title: `${item.label} — ${item.what}`, priority: item.overdue ? 'high' : 'normal',
      duration_hours: item.count > 10 ? 3 : item.count > 3 ? 2 : 1,
    },
    onSaved: s => { location.hash = `#/calls/${s.id}`; },
  });
}

export function maintenanceTable(el, rows, { showCustomer = true, onChange } = {}) {
  mount(el, dataTable({
    rows, empty: 'Nothing due in this window. 🎉',
    columns: [
      { label: 'Due', render: m => html`<b style="${m.overdue ? 'color:var(--bad)' : ''}">${fmtDate(m.due)}</b><div class="small muted">${m.overdue ? 'OVERDUE · ' : ''}${relDays(m.due)}</div>` },
      { label: 'Task', render: m => html`${m.label}<div class="small muted">${m.what}</div>` },
      ...(showCustomer ? [{ label: 'Customer', render: m => m.customer ? html`<a href="#/customers/${m.customer_id}?tab=systems">${m.customer}</a> ${typeBadge(m.customer_type)}${m.phone ? html`<div class="small"><a href="tel:${m.phone}">${m.phone}</a></div>` : ''}` : html`<a href="#/vehicles/${m.vehicle_id}">Fleet vehicle</a>` }] : []),
      { label: '', cls: 'actions-cell', render: (m) => html`${m.customer_id ? html`<button class="btn sm" data-sched="${rows.indexOf(m)}">Schedule</button>` : ''}
          <button class="btn sm primary" data-done="${rows.indexOf(m)}">Mark done</button>` },
    ],
  }));
  $$('[data-done]', el).forEach(b => b.addEventListener('click', () => completeMaintenance(rows[b.dataset.done], onChange)));
  $$('[data-sched]', el).forEach(b => b.addEventListener('click', () => scheduleFromMaintenance(rows[b.dataset.sched])));
}

export async function render(view, _, query) {
  let days = Number(query.days) || 60;
  let kind = query.kind || 'all';
  mount(view, html`
    <div class="page-head"><div><h1>Maintenance & inspections due</h1>
      <div class="sub">Camera service, alarm tests, fire inspections, extinguisher annuals & hydro tests, and fleet renewals</div></div></div>
    <div class="filters">
      <div class="seg" data-days>${[30, 60, 90, 180, 365].map(d => html`<button data-v="${d}">${d} days</button>`)}</div>
      <select data-kind aria-label="Kind">
        <option value="all">Everything</option><option value="fire">Fire & extinguishers</option><option value="camera">Cameras</option>
        <option value="alarm">Alarms</option><option value="fleet">Vehicles</option></select>
      <span class="muted small" data-count></span>
    </div>
    <div class="kpis" data-kpis></div>
    <div class="card"><div class="card-body flush" data-table></div></div>`);
  const kindSel = $('[data-kind]', view);
  kindSel.value = kind;
  const load = async () => {
    $$('[data-days] button', view).forEach(b => b.classList.toggle('on', Number(b.dataset.v) === days));
    loading($('[data-table]', view));
    let rows = await GET('/api/maintenance', { days });
    const match = { fire: m => ['fire_systems', 'extinguishers'].includes(m.table), camera: m => m.table === 'camera_systems', alarm: m => m.table === 'alarm_systems', fleet: m => m.table === 'vehicles' }[kind];
    if (match) rows = rows.filter(match);
    const overdue = rows.filter(r => r.overdue);
    const week = rows.filter(r => !r.overdue && r.days <= 7);
    mount($('[data-kpis]', view), html`
      <div class="kpi ${overdue.length ? 'alert' : ''}"><div class="label">Overdue</div><div class="value">${overdue.length}</div></div>
      <div class="kpi"><div class="label">Due in next 7 days</div><div class="value">${week.length}</div></div>
      <div class="kpi"><div class="label">Due in ${days} days</div><div class="value">${rows.length}</div></div>
      <div class="kpi"><div class="label">Extinguishers due</div><div class="value">${rows.filter(r => r.table === 'extinguishers').reduce((s, r) => s + r.count, 0)}</div></div>`);
    $('[data-count]', view).textContent = `${rows.length} item${rows.length === 1 ? '' : 's'}`;
    maintenanceTable($('[data-table]', view), rows, { onChange: load });
  };
  $('[data-days]', view).addEventListener('click', e => { if (e.target.dataset.v) { days = Number(e.target.dataset.v); load(); } });
  kindSel.addEventListener('change', () => { kind = kindSel.value; load(); });
  await load();
}
