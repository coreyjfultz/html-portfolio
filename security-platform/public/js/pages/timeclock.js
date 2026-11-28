// Time clock for everyone, plus timesheets for the office.
import { html, mount, $, $$, fmtDate, fmtTime, num, badge, dataTable, promptForm, loading, toast, todayStr, addDays, confirmDialog } from '../ui.js';
import { GET, POST, PUT, api } from '../api.js';
import { can, state, refresh } from '../app.js';

const FLAG = { office: ['At office', 'good'], 'job site': ['At job site', 'good'], away: ['Away from office', 'bad'], 'no location': ['No location', 'warn'], manual: ['Manual', 'info'], 'no office set': ['Office not set', ''] };
const flagBadge = (f, where) => f ? html`${badge(FLAG[f]?.[0] || f, FLAG[f]?.[1] ?? '')}${where && f === 'job site' ? html`<div class="small muted">${where}</div>` : ''}` : '';
const hrs = h => `${Math.floor(h)}h ${String(Math.round((h % 1) * 60)).padStart(2, '0')}m`;

/** Ask the browser/phone where we are. Resolves null if not allowed / unavailable. */
export function getPosition(timeout = 12000) {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => resolve(null), { enableHighAccuracy: true, timeout, maximumAge: 30000 });
  });
}

/** Compact clock in/out card used on the dashboard, My Day and the Time clock page. */
export async function clockWidget(el, { onChange, big = false } = {}) {
  const me = await GET('/api/timeclock/me');
  const since = me.open ? me.open.clock_in : null;
  mount(el, html`<div class="clock-card ${me.open ? 'on' : ''} ${big ? 'big' : ''}">
    <div><div class="clock-state">${me.open ? html`On the clock since <b>${fmtTime(since)}</b>` : 'Off the clock'}</div>
      <div class="small muted">Today ${hrs(me.today_hours)} · this week ${hrs(me.week_hours)}</div></div>
    <button class="btn ${me.open ? '' : 'primary'} ${big ? 'lg' : ''}" data-punch>${me.open ? 'Clock out' : 'Clock in'}</button></div>`);
  $('[data-punch]', el).addEventListener('click', async e => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'Getting location…';
    const pos = await getPosition();
    try {
      const r = await POST(`/api/timeclock/${me.open ? 'out' : 'in'}`, pos || {});
      const where = { office: 'at the office', 'job site': `at ${r.where}`, away: 'away from the office — the owner has been notified', 'no location': 'without a location — the owner has been notified' }[r.flag] || '';
      toast(`${me.open ? 'Clocked out' : 'Clocked in'}${where ? ` ${where}` : ''}`, ['away', 'no location'].includes(r.flag) ? 'error' : '');
    } catch (err) { toast(err.message, 'error'); }
    clockWidget(el, { onChange, big }); onChange?.();
  });
  return me;
}

export async function render(view, _, query) {
  loading(view);
  const office = can.billing(), manage = can.manage();
  const range = { from: query.from || addDays(todayStr(), -13), to: query.to || todayStr() };
  const [me, now, ts, entries, users] = await Promise.all([
    GET('/api/timeclock/me'), manage ? GET('/api/timeclock/now') : [], office ? GET('/api/timeclock/timesheet', range) : null,
    office ? GET('/api/timeclock/entries', { ...range, user_id: query.user || '' }) : [], manage ? GET('/api/users') : [],
  ]);
  mount(view, html`
    <div class="page-head"><div><h1>Time clock</h1><div class="sub">Clock in when you start, out when you finish. Your location is recorded with each punch.</div></div>
      <div class="actions">${office ? html`<a class="btn" href="/api/timeclock/export?from=${range.from}&to=${range.to}">Export timesheets (CSV)</a>` : ''}
        ${manage ? html`<button class="btn" data-add>+ Manual entry</button>` : ''}</div></div>
    <div class="card" style="margin-bottom:16px"><div class="card-body" data-clock></div></div>
    ${!me.office_set && manage ? html`<div class="note" style="margin-bottom:16px">Set the office location under <a href="#/settings?tab=field">Settings → Field rules</a> so clock-ins away from the office are flagged.</div>` : ''}
    ${manage ? html`<div class="card" style="margin-bottom:16px"><div class="card-head"><h2>On the clock now (${now.length})</h2></div><div class="card-body flush">${dataTable({
      rows: now, empty: 'Nobody is clocked in.',
      columns: [
        { label: 'Who', render: e => html`<b>${e.user_name}</b><div class="small muted">${e.role}</div>` },
        { label: 'Since', render: e => fmtTime(e.clock_in) },
        { label: 'Hours', render: e => hrs(e.hours), cls: 'num' },
        { label: 'Clocked in', render: e => html`${flagBadge(e.in_flag, e.in_where)}${e.in_lat != null ? html` <a class="small" target="_blank" rel="noopener" href="https://www.google.com/maps?q=${e.in_lat},${e.in_lng}">map ↗</a>` : ''}` },
      ] })}</div></div>` : ''}
    ${office ? html`<div class="filters"><label class="small">From <input type="date" data-from value="${range.from}"></label><label class="small">To <input type="date" data-to value="${range.to}"></label></div>
      <div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Timesheets</h2><span class="small muted">${fmtDate(ts.from)} – ${fmtDate(ts.to)}</span></div><div class="card-body flush">${dataTable({
        rows: ts.people, empty: 'No time recorded in this range.',
        columns: [
          { label: 'Employee', render: p => html`<a href="#/timeclock?user=${p.user_id}&from=${range.from}&to=${range.to}">${p.name}</a><div class="small muted">${p.role}</div>` },
          { label: 'Days', render: p => p.days, cls: 'num' },
          { label: 'Regular', render: p => num(p.regular), cls: 'num' },
          { label: 'Overtime', render: p => p.overtime ? html`<b style="color:var(--warn)">${num(p.overtime)}</b>` : '0', cls: 'num' },
          { label: 'Total', render: p => html`<b>${num(p.hours)}</b>`, cls: 'num' },
          { label: '', render: p => html`${p.flagged ? badge(`${p.flagged} flagged`, 'warn') : ''} ${p.open ? badge('clocked in', 'info') : ''}` },
        ] })}</div></div>` : ''}
    <div class="card"><div class="card-head"><h2>${office ? (query.user ? 'Punches — ' + (entries[0]?.user_name || '') : 'All punches') : 'My recent punches'}</h2>${query.user ? html`<a class="small" href="#/timeclock?from=${range.from}&to=${range.to}">Show everyone</a>` : ''}</div><div class="card-body flush">${dataTable({
      rows: office ? entries : me.recent, empty: 'No punches yet.',
      columns: [
        ...(office ? [{ label: 'Who', render: e => e.user_name }] : []),
        { label: 'Date', render: e => fmtDate(e.clock_in.slice(0, 10)) },
        { label: 'In', render: e => html`${fmtTime(e.clock_in)} ${flagBadge(e.in_flag, e.in_where)}${office && e.in_lat != null ? html` <a class="small" target="_blank" rel="noopener" href="https://www.google.com/maps?q=${e.in_lat},${e.in_lng}">map ↗</a>` : ''}` },
        { label: 'Out', render: e => e.clock_out ? html`${fmtTime(e.clock_out)}${e.clock_out.slice(0, 10) !== e.clock_in.slice(0, 10) ? html` <span class="small muted">${fmtDate(e.clock_out.slice(0, 10))}</span>` : ''} ${flagBadge(e.out_flag, e.out_where)}` : badge('open', 'info') },
        { label: 'Hours', render: e => hrs(e.hours), cls: 'num' },
        { label: 'Notes', render: e => html`${e.note || ''}${e.edited_by ? html`<div class="small muted">Edited by ${e.edited_by}: ${e.edit_reason}</div>` : ''}` },
        ...(manage ? [{ label: '', cls: 'actions-cell', render: e => html`<button class="btn sm ghost" data-edit="${e.id}">Edit</button>` }] : []),
      ] })}</div></div>`);
  clockWidget($('[data-clock]', view), { big: true, onChange: () => manage && setTimeout(refresh, 300) });
  const go = () => { location.hash = `#/timeclock?from=${$('[data-from]', view).value}&to=${$('[data-to]', view).value}${query.user ? `&user=${query.user}` : ''}`; };
  $('[data-from]', view)?.addEventListener('change', go);
  $('[data-to]', view)?.addEventListener('change', go);
  const people = users.filter(u => u.active).map(u => ({ value: u.id, label: u.name }));
  $('[data-add]', view)?.addEventListener('click', () => promptForm({
    title: 'Manual time entry', fields: [
      { name: 'user_id', label: 'Employee', type: 'select', options: people },
      { name: 'clock_in', label: 'Clock in', type: 'datetime-local', required: true },
      { name: 'clock_out', label: 'Clock out', type: 'datetime-local' },
      { name: 'reason', label: 'Reason (kept in the activity log)', type: 'text', required: true },
    ], submitLabel: 'Add entry',
    onSubmit: async d => { await POST('/api/timeclock/entries', d); toast('Entry added'); refresh(); },
  }));
  $$('[data-edit]', view).forEach(b => b.addEventListener('click', () => {
    const e = entries.find(x => x.id === Number(b.dataset.edit));
    const { el } = promptForm({
      title: `Edit ${e.user_name}'s punch`, fields: [
        { name: 'clock_in', label: 'Clock in', type: 'datetime-local', value: e.clock_in.slice(0, 16), required: true },
        { name: 'clock_out', label: 'Clock out (blank = still clocked in)', type: 'datetime-local', value: e.clock_out?.slice(0, 16) || '' },
        { name: 'reason', label: 'Reason (kept in the activity log)', type: 'text', required: true },
      ], submitLabel: 'Save',
      onSubmit: async d => { await PUT(`/api/timeclock/entries/${e.id}`, d); toast('Saved'); refresh(); },
    });
    const del = document.createElement('button');
    del.className = 'btn ghost danger'; del.textContent = 'Delete'; del.style.marginRight = 'auto';
    del.addEventListener('click', async () => { if (await confirmDialog('Delete this punch?', { okLabel: 'Delete', danger: true })) { await api('DELETE', `/api/timeclock/entries/${e.id}`); toast('Deleted'); refresh(); } });
    $('.modal-foot', el).prepend(del);
  }));
}
