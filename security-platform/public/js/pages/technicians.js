import { html, mount, $, $$, money, dataTable, openForm, todayStr, addDays } from '../ui.js';
import { R } from '../api.js';
import { can, refresh } from '../app.js';

export async function render(view) {
  const office = can.office();
  const from = todayStr(), to = addDays(from, 6);
  const [techs, upcoming, open, vehicles] = await Promise.all([
    R.list('technicians'), R.list('service_calls', { from, to, status__not: 'cancelled' }),
    R.list('service_calls', { status__in: 'new,scheduled,in progress,on hold' }), R.list('vehicles'),
  ]);
  mount(view, html`
    <div class="page-head"><div><h1>Technicians</h1><div class="sub">Team, vehicles and workload for the next 7 days</div></div>
      <div class="actions">${office ? html`<a class="btn" href="#/reports?tab=techs">Workload report</a><button class="btn primary" data-new>+ New technician</button>` : ''}</div></div>
    <div class="card"><div class="card-body flush">${dataTable({
      rows: techs, empty: 'No technicians yet. Add your team here, then give them a login under Settings → Users.',
      columns: [
        { label: 'Name', render: t => html`<span class="dot" style="background:${t.color}"></span> <b>${t.name}</b> ${t.active ? '' : html`<span class="badge">inactive</span>`}<div class="small muted">${t.skills || ''}</div>` },
        { label: 'Phone', render: t => t.phone ? html`<a href="tel:${t.phone}">${t.phone}</a>` : '—' },
        { label: 'Vehicle', render: t => vehicles.filter(v => v.assigned_technician_id === t.id).map(v => v.unit_name).join(', ') || '—' },
        { label: 'Next 7 days', render: t => { const h = upcoming.filter(c => c.technician_id === t.id).reduce((s, c) => s + (c.duration_hours || 0), 0); return html`${upcoming.filter(c => c.technician_id === t.id).length} jobs · ${h} h`; } },
        { label: 'Open backlog', render: t => open.filter(c => c.technician_id === t.id).length, cls: 'num' },
        ...(office ? [{ label: 'Cost / Bill rate', render: t => html`${money(t.hourly_cost)} / ${money(t.bill_rate)}`, cls: 'num' },
          { label: '', cls: 'actions-cell', render: t => html`<a class="btn sm ghost" href="#/calls?group=all&technician_id=${t.id}">Calls</a><button class="btn sm ghost" data-edit="${t.id}">Edit</button>` }] : []),
      ] })}</div></div>`);
  $('[data-new]', view)?.addEventListener('click', () => openForm('technicians', { onSaved: refresh }));
  $$('[data-edit]', view).forEach(b => b.addEventListener('click', () => openForm('technicians', { record: techs.find(t => t.id === Number(b.dataset.edit)), onSaved: refresh, onDeleted: refresh })));
}
