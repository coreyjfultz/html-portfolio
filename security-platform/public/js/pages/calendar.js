import { html, mount, $, $$, fmtTime, todayStr, addDays, openForm, toast, loading } from '../ui.js';
import { R, GET } from '../api.js';
import { state, can } from '../app.js';

const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export async function render(view, _, query) {
  const today = todayStr();
  let month = (query.month || today).slice(0, 7);
  const techs = await R.list('technicians', { active: 1 });
  const mine = state.user.technician_id;
  let selected = new Set(query.tech ? [Number(query.tech)] : can.tech() && mine ? [mine] : techs.map(t => t.id));
  let includeUnassigned = !can.tech();

  mount(view, html`
    <div class="page-head"><div><h1>Calendar</h1><div class="sub" data-title></div></div>
      <div class="actions">
        <button class="btn" data-prev aria-label="Previous month">‹</button><button class="btn" data-today>Today</button><button class="btn" data-next aria-label="Next month">›</button>
        <button class="btn" data-sync>Sync to Outlook / Google</button>
        <a class="btn" href="#/schedule">Dispatch board</a>
        <button class="btn primary" data-new>+ Service call</button></div></div>
    <div class="filters" data-chips></div>
    <div class="cal-wrap"><div class="cal" data-cal></div></div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h2 data-day-title></h2></div><div class="card-body flush" data-day></div></div>`);

  const chips = () => mount($('[data-chips]', view), html`
    <button class="chip ${selected.size === techs.length ? 'on' : ''}" data-all>Everyone</button>
    ${techs.map(t => html`<button class="chip ${selected.has(t.id) ? 'on' : ''}" data-tech="${t.id}"><span class="dot" style="background:${t.color}"></span> ${t.name}${t.id === mine ? ' (me)' : ''}</button>`)}
    <button class="chip ${includeUnassigned ? 'on' : ''}" data-unassigned><span class="dot" style="background:#94a3b8"></span> Unassigned</button>`);

  let calls = [];
  let focusDay = today.slice(0, 7) === month ? today : `${month}-01`;
  const visible = () => calls.filter(c => c.technician_id ? selected.has(c.technician_id) : includeUnassigned);

  const showDay = day => {
    focusDay = day;
    $$('.cal-day', view).forEach(d => d.classList.toggle('sel', d.dataset.day === day));
    const jobs = visible().filter(c => c.scheduled_start.slice(0, 10) === day).sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start));
    $('[data-day-title]', view).textContent = new Date(day + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    mount($('[data-day]', view), jobs.length ? html`${jobs.map(c => html`<a class="agenda-row" href="#/calls/${c.id}">
        <span class="agenda-time">${fmtTime(c.scheduled_start)}<div class="small muted">${c.duration_hours || 1} h</div></span>
        <span class="dot" style="background:${c.technician_color || '#94a3b8'};margin-top:6px"></span>
        <span style="flex:1"><b>${c.customer_id_label}</b> — ${c.title}<div class="small muted">${c.technician_id_label || 'Unassigned'} · ${c.customer_address?.replace(/^, |, $/g, '') || ''}</div></span>
        <span class="badge ${c.status === 'completed' ? 'good' : c.priority === 'emergency' ? 'bad' : 'info'}">${c.status}</span></a>`)}`
      : html`<div class="empty">Nothing scheduled.</div>`);
  };

  const draw = () => {
    const first = new Date(month + '-01T12:00:00');
    const start = addDays(ymd(first), -((first.getDay() + 6) % 7)); // Monday-start grid
    const days = [...Array(42)].map((_, i) => addDays(start, i));
    $('[data-title]', view).textContent = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const v = visible();
    mount($('[data-cal]', view), html`
      ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => html`<div class="cal-hd">${d}</div>`)}
      ${days.map(d => {
        const jobs = v.filter(c => c.scheduled_start.slice(0, 10) === d).sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start));
        return html`<div class="cal-day ${d.slice(0, 7) !== month ? 'out' : ''} ${d === today ? 'today' : ''}" data-day="${d}" tabindex="0">
          <div class="cal-num">${Number(d.slice(8))}</div>
          ${jobs.slice(0, 3).map(c => html`<div class="cal-ev ${c.status === 'completed' ? 'done' : ''}" style="--c:${c.technician_color || '#94a3b8'}">${fmtTime(c.scheduled_start).replace(':00', '').replace(' ', '').toLowerCase()} ${c.customer_id_label}</div>`)}
          ${jobs.length > 3 ? html`<div class="cal-more">+${jobs.length - 3} more</div>` : ''}</div>`;
      })}`);
    $$('.cal-day', view).forEach(el => {
      el.addEventListener('click', () => showDay(el.dataset.day));
      el.addEventListener('dblclick', () => openForm('service_calls', { defaults: { scheduled_start: `${el.dataset.day}T08:00`, technician_id: selected.size === 1 ? [...selected][0] : null }, onSaved: load }));
    });
    showDay(days.includes(focusDay) ? focusDay : `${month}-01`);
  };

  const load = async () => {
    loading($('[data-cal]', view));
    const first = new Date(month + '-01T12:00:00');
    const from = addDays(ymd(first), -7), to = addDays(ymd(new Date(first.getFullYear(), first.getMonth() + 1, 0, 12)), 14);
    calls = (await R.list('service_calls', { from, to, status__not: 'cancelled', limit: 3000 })).filter(c => c.scheduled_start);
    chips();
    draw();
  };

  $('[data-chips]', view).addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.all !== undefined) { selected = new Set(techs.map(t => t.id)); includeUnassigned = true; }
    else if (b.dataset.unassigned !== undefined) includeUnassigned = !includeUnassigned;
    else { const id = Number(b.dataset.tech); selected.has(id) ? selected.delete(id) : selected.add(id); }
    chips(); draw();
  });
  const shift = n => { const d = new Date(month + '-15T12:00:00'); d.setMonth(d.getMonth() + n); month = ymd(d).slice(0, 7); load(); };
  $('[data-prev]', view).addEventListener('click', () => shift(-1));
  $('[data-next]', view).addEventListener('click', () => shift(1));
  $('[data-today]', view).addEventListener('click', () => { month = today.slice(0, 7); focusDay = today; load(); });
  $('[data-new]', view).addEventListener('click', () => openForm('service_calls', { defaults: { scheduled_start: `${focusDay}T08:00` }, onSaved: load }));
  $('[data-sync]', view).addEventListener('click', () => syncDialog());
  await load();
}

export async function syncDialog() {
  const { openModal } = await import('../ui.js');
  const f = await GET('/api/calendar/feeds');
  const row = (label, url) => html`<div style="margin-bottom:14px"><div><b>${label}</b></div>
    <div class="row" style="margin-top:6px"><input readonly class="mono" value="${url}" style="flex:1;min-width:220px">
      <button class="btn sm" data-copy="${url}">Copy</button>
      <a class="btn sm" href="${url.replace(/^https?:/, 'webcal:')}">Outlook / Apple</a>
      <a class="btn sm" target="_blank" rel="noopener" href="https://calendar.google.com/calendar/r?cid=${encodeURIComponent(url.replace(/^https?:/, 'webcal:'))}">Google</a></div></div>`;
  const { el } = openModal({
    title: 'Show jobs in Outlook or Google Calendar',
    body: html`<p class="muted" style="margin-top:0">Subscribe once and jobs appear in your normal calendar, updating automatically (Outlook checks every hour or so; Google can take several hours). Technicians also get an email invite the moment a job is booked or moved.</p>
      ${f.central ? row('Central calendar — every technician', f.central) : ''}
      ${f.technicians.map(t => row(`${t.name}'s calendar`, t.url))}
      <details class="small"><summary>Manual steps</summary>
        <p><b>Outlook:</b> Calendar → Add calendar → Subscribe from web → paste the link.</p>
        <p><b>Google:</b> Other calendars → + → From URL → paste the link.</p>
        <p><b>iPhone:</b> Settings → Calendar → Accounts → Add subscribed calendar.</p>
        <p>These links are private. If one is shared by mistake, an admin can reset it under Settings → Calendars.</p></details>`,
  });
  $$('[data-copy]', el).forEach(b => b.addEventListener('click', () => navigator.clipboard?.writeText(b.dataset.copy).then(() => toast('Copied'))));
}
