import { html, mount, $, fmtTime, fmtDateTime, badge, typeBadge, num, dataTable, todayStr, addDays, loading } from '../ui.js';
import { R, GET } from '../api.js';
import { state } from '../app.js';
import { transferStock } from './inventory.js';
import { readinessCard, countDialog } from './truckstock.js';
import { callsTable } from './calls.js';

export async function render(view) {
  loading(view);
  const techId = state.user.technician_id;
  if (!techId) {
    mount(view, html`<div class="card"><div class="empty">Your login isn't linked to a technician profile yet. Ask an admin to link it under Settings → Users.</div></div>`);
    return;
  }
  const today = todayStr();
  const [calls, upcoming, backlog, vehicles, items] = await Promise.all([
    R.list('service_calls', { technician_id: techId, from: today, to: today }),
    R.list('service_calls', { technician_id: techId, from: addDays(today, 1), to: addDays(today, 7), status__not: 'cancelled' }),
    R.list('service_calls', { technician_id: techId, status__in: 'new,on hold', scheduled_start__null: '1' }),
    R.list('vehicles', { assigned_technician_id: techId }),
    R.list('inventory_items', { active: 1 }),
  ]);
  const truck = vehicles[0];
  const oncall = await GET('/api/oncall/now').catch(() => ({}));
  const myOff = (await GET('/api/time-off', { mine: '1' }).catch(() => [])).filter(x => x.status === 'approved' && x.ends_at >= today).slice(0, 2);
  const myShift = [oncall.current, oncall.next].find(s => s && (s.technician_id === techId || s.backup_technician_id === techId));
  const [stock, lastCount] = truck ? await Promise.all([GET('/api/stock', { location_id: truck.id }), GET(`/api/vehicles/${truck.id}/truck-stock`).then(d => d.counts[0])]) : [[], null];
  const countDue = truck && (!lastCount || (Date.now() - new Date(lastCount.created_at.replace(' ', 'T'))) / 86400e3 >= 7);
  calls.sort((a, b) => (a.scheduled_start || '').localeCompare(b.scheduled_start || ''));
  upcoming.sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start));

  mount(view, html`
    <div class="page-head"><div><h1>My day</h1><div class="sub">${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} · ${calls.length} job${calls.length === 1 ? '' : 's'} today</div></div>
      <div class="actions"><button class="btn" data-sync>Add to my phone calendar</button><a class="btn" href="#/calendar">My calendar</a><a class="btn" href="#/calls?new=1">+ Service call</a></div></div>
    <div class="stack">
      <div class="card"><div class="card-body" data-clock></div></div>
      ${myOff.map(x => html`<div class="banner good">🌴 Time off approved: ${x.when} <a href="#/time-off">Details</a></div>`)}
      ${myShift ? html`<div class="banner ${myShift === oncall.current ? 'warn' : ''}">📟 ${myShift === oncall.current ? 'You’re' : 'Next up: you’re'} ${myShift.technician_id === techId ? 'on call' : 'the on-call backup'} ${myShift === oncall.current ? `until ${fmtDateTime(myShift.ends_at)}` : `from ${fmtDateTime(myShift.starts_at)}`}. <a href="#/phone">Schedule</a></div>` : ''}
      ${truck ? html`<div class="card" data-vcheck></div>` : ''}
      <div class="card hidden" data-ready></div>
      ${countDue ? html`<div class="banner warn row" style="justify-content:space-between">🧮 Weekly truck count is due for ${truck.unit_name}${lastCount ? '' : ' (never counted)'}. <button class="btn sm primary" data-count>Count my truck</button></div>` : ''}
      ${calls.length ? calls.map(c => html`<a class="card" href="#/calls/${c.id}" style="display:block;color:inherit;text-decoration:none;border-left:5px solid ${c.priority === 'emergency' ? 'var(--bad)' : c.technician_color || 'var(--primary)'}">
          <div class="card-body"><div class="row" style="justify-content:space-between">
            <b style="font-size:16px">${fmtTime(c.scheduled_start)} · ${c.customer_id_label}</b><span>${badge(c.status)} ${c.priority !== 'normal' ? badge(c.priority) : ''}</span></div>
            <div style="margin-top:4px">${c.title}</div>
            <div class="small muted" style="margin-top:4px">${c.customer_address?.replace(/^, |, $/g, '') || ''}${c.customer_phone ? ` · ${c.customer_phone}` : ''} ${typeBadge(c.customer_type)}</div></div></a>`)
        : html`<div class="card"><div class="empty">No jobs scheduled for you today.</div></div>`}
      <div class="card"><div class="card-head"><h2>Coming up (next 7 days)</h2></div><div class="card-body flush">${callsTable(upcoming, 'Nothing scheduled yet.')}</div></div>
      ${backlog.length ? html`<div class="card"><div class="card-head"><h2>Assigned to you, not scheduled</h2></div><div class="card-body flush">${callsTable(backlog)}</div></div>` : ''}
      <div class="card"><div class="card-head"><div><h2>On my truck${truck ? ` — ${truck.unit_name}` : ''}</h2></div>
        ${truck ? html`<button class="btn sm" data-load>Load from warehouse</button>` : ''}</div>
        <div class="card-body flush">${truck ? dataTable({
          rows: stock.filter(s => s.qty !== 0), empty: 'Truck is empty.',
          columns: [{ label: 'Item', render: s => html`${s.name}<div class="small muted">${s.sku || ''}</div>` }, { label: 'Qty', render: s => num(s.qty), cls: 'num' }],
        }) : html`<div class="empty">No vehicle assigned to you.</div>`}</div></div>
    </div>`);
  $('[data-sync]', view).addEventListener('click', async () => (await import('./calendar.js')).syncDialog());
  $('[data-load]', view)?.addEventListener('click', () => transferStock(items, null, () => render(view), { from: 0, to: truck.id }));
  $('[data-count]', view)?.addEventListener('click', () => countDialog(truck, () => render(view)));
  readinessCard($('[data-ready]', view), techId);
  if (truck) drawVehicleCheck($('[data-vcheck]', view), truck, () => render(view));
  import('./timeclock.js').then(m => m.clockWidget($('[data-clock]', view)));
}

async function drawVehicleCheck(card, truck, onDone) {
  const d = await GET(`/api/vehicles/${truck.id}/checks`).catch(() => null);
  if (!d || d.frequency === 'off') { card.classList.add('hidden'); return; }
  const last = d.checks[0];
  mount(card, html`<div class="card-head"><div><h2>${d.due ? '🚚' : '✅'} Vehicle check — ${truck.unit_name}</h2>
      <div class="small muted">${d.due ? `${d.frequency === 'weekly' ? 'Weekly' : 'Daily'} check before your first job: oil, tires, lights, walk-around, clean truck.` : `Done ${last ? fmtDateTime(last.created_at.replace(' ', 'T')) : ''}${last?.issues ? ` — ${last.issues} problem(s) reported` : ' — all OK'}`}</div></div>
      ${d.due ? html`<button class="btn primary" data-vc>Start check</button>` : ''}</div>`);
  $('[data-vc]', card)?.addEventListener('click', async () => (await import('./vehiclecheck.js')).vehicleCheckDialog(truck, onDone));
}
