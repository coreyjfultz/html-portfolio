import { html, mount, $, $$, fmtTime, todayStr, addDays, openForm, toast, loading, saveWithConflictCheck } from '../ui.js';
import { R } from '../api.js';

const OPEN = 'new,scheduled,in progress,on hold';
const mondayOf = d => { const dt = new Date(d + 'T12:00:00'); const wd = (dt.getDay() + 6) % 7; return addDays(d, -wd); };

export async function render(view, _, query) {
  let start = mondayOf(query.week || todayStr());
  mount(view, html`
    <div class="page-head"><div><h1>Technician schedule</h1><div class="sub" data-range></div></div>
      <div class="actions">
        <button class="btn" data-prev aria-label="Previous week">‹ Prev</button><button class="btn" data-today>This week</button><button class="btn" data-next aria-label="Next week">Next ›</button>
        <button class="btn primary" data-new>+ Service call</button></div></div>
    <div data-body></div>`);
  const body = $('[data-body]', view);

  const load = async () => {
    loading(body);
    const end = addDays(start, 6);
    const days = [...Array(7)].map((_, i) => addDays(start, i));
    $('[data-range]', view).textContent = `Week of ${new Date(start + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} · drag jobs between technicians and days to reschedule`;
    const [techs, calls, unscheduled] = await Promise.all([
      R.list('technicians', { active: 1 }),
      R.list('service_calls', { from: start, to: end, status__not: 'cancelled' }),
      R.list('service_calls', { scheduled_start__null: '1', status__in: OPEN }),
    ]);
    const today = todayStr();
    const lanes = [...techs.map(t => ({ id: t.id, name: t.name, color: t.color })), { id: null, name: 'Unassigned', color: '#94a3b8' }];
    const cellJobs = (techId, day) => calls.filter(c => (c.technician_id ?? null) === techId && c.scheduled_start?.slice(0, 10) === day)
      .sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start));
    const job = c => html`<a class="job ${c.status === 'completed' ? 'done' : ''} ${c.priority === 'emergency' ? 'emergency' : ''}" style="--c:${c.technician_color || '#94a3b8'}"
        href="#/calls/${c.id}" draggable="true" data-job="${c.id}">
        <span class="tm">${c.scheduled_start ? fmtTime(c.scheduled_start) : ''}</span> ${c.priority === 'emergency' ? '🚨 ' : ''}${c.customer_id_label}
        <div class="muted">${c.title}${c.duration_hours ? ` · ${c.duration_hours}h` : ''}${c.status === 'completed' ? ' · ✓' : ''}</div></a>`;

    const mobile = window.innerWidth < 860;
    if (mobile) {
      mount(body, html`<div class="day-list">${days.map(d => {
        const jobs = calls.filter(c => c.scheduled_start?.slice(0, 10) === d).sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start));
        return html`<div class="day"><h3 style="${d === today ? 'color:var(--primary)' : ''}">${new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</h3>
          ${jobs.length ? jobs.map(c => html`${job(c)}<div class="small muted" style="margin:-3px 0 8px 8px">${c.technician_id_label || 'Unassigned'}</div>`) : html`<div class="muted small">No jobs</div>`}</div>`;
      })}</div>${unscheduledBlock(unscheduled, job)}`);
      return;
    }
    mount(body, html`<div class="sched-scroll"><div class="sched">
        <div class="hd">Technician</div>
        ${days.map(d => html`<div class="hd ${d === today ? 'today' : ''}">${new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' })}</div>`)}
        ${lanes.map(l => {
          const hours = calls.filter(c => (c.technician_id ?? null) === l.id).reduce((s, c) => s + (c.duration_hours || 0), 0);
          const pct = Math.min(100, Math.round(hours / 40 * 100));
          return html`<div class="tech"><span><span class="dot" style="background:${l.color}"></span> ${l.name}</span>
              ${l.id ? html`<div class="small muted">${hours} h booked / 40</div><div class="load-bar ${hours > 40 ? 'over' : ''}"><span style="width:${pct}%"></span></div>` : ''}</div>
            ${days.map(d => html`<div class="cell ${d === today ? 'today' : ''}" data-tech="${l.id ?? ''}" data-day="${d}" title="Double-click to add a job">${cellJobs(l.id, d).map(job)}</div>`)}`;
        })}
      </div></div>
      ${unscheduledBlock(unscheduled, job)}`);

    // drag & drop rescheduling
    $$('[data-job]', body).forEach(a => a.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', a.dataset.job); e.dataTransfer.effectAllowed = 'move'; }));
    $$('.cell', body).forEach(cell => {
      cell.addEventListener('dragover', e => { e.preventDefault(); cell.classList.add('drop'); });
      cell.addEventListener('dragleave', () => cell.classList.remove('drop'));
      cell.addEventListener('drop', async e => {
        e.preventDefault();
        cell.classList.remove('drop');
        const id = Number(e.dataTransfer.getData('text/plain'));
        const c = [...calls, ...unscheduled].find(x => x.id === id);
        if (!c) return;
        const time = c.scheduled_start?.slice(11, 16) || '08:00';
        const techId = cell.dataset.tech ? Number(cell.dataset.tech) : null;
        try {
          await saveWithConflictCheck(d => R.update('service_calls', id, d), { technician_id: techId, scheduled_start: `${cell.dataset.day}T${time}`, ...(c.status === 'new' && techId ? { status: 'scheduled' } : {}) });
          toast(`SC-${c.number} moved`);
          load();
        } catch (err) { toast(err.message, 'error'); }
      });
      cell.addEventListener('dblclick', e => {
        if (e.target.closest('.job')) return;
        openForm('service_calls', { defaults: { technician_id: cell.dataset.tech ? Number(cell.dataset.tech) : null, scheduled_start: `${cell.dataset.day}T08:00`, status: 'scheduled' }, onSaved: load });
      });
    });
  };

  $('[data-prev]', view).addEventListener('click', () => { start = addDays(start, -7); load(); });
  $('[data-next]', view).addEventListener('click', () => { start = addDays(start, 7); load(); });
  $('[data-today]', view).addEventListener('click', () => { start = mondayOf(todayStr()); load(); });
  $('[data-new]', view).addEventListener('click', () => openForm('service_calls', { defaults: { scheduled_start: `${todayStr()}T08:00` }, onSaved: load }));
  await load();
}

function unscheduledBlock(rows, job) {
  return html`<div class="card" style="margin-top:16px"><div class="card-head"><div><h2>Needs scheduling (${rows.length})</h2>
      <div class="small muted">Open calls with no date. ${window.innerWidth >= 860 ? 'Drag one onto a technician and day.' : 'Open a call and set its date to schedule it.'}</div></div></div>
    <div class="card-body">${rows.length ? html`<div class="unassigned">${rows.map(job)}</div>` : html`<div class="muted">Everything is scheduled.</div>`}</div></div>`;
}
