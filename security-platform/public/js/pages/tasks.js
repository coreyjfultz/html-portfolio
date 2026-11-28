// Tasks for people: one-time or repeating to-dos ("pick up panels at ADI", "deposit checks every Friday").
import { html, mount, $, $$, raw, icon, badge, openModal, loading, toast, confirmDialog, todayStr, addDays, saveWithConflictCheck } from '../ui.js';
import { GET, POST, PUT, api } from '../api.js';
import { state, refresh } from '../app.js';
import { G } from '../schema.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const isManager = () => G.manage.includes(state.user.role);
let people = null;
const getPeople = async () => (people ||= await GET('/api/tasks/people'));

const fmtT = t => { const [h, m] = t.split(':').map(Number); return `${(h % 12) || 12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`; };
export const timeText = t => t.start_time ? `${fmtT(t.start_time)}–${fmtT(t.end_time)}` : '';

function dueText(d) {
  if (!d) return '';
  const t = todayStr();
  if (d === t) return 'Today';
  if (d === addDays(t, 1)) return 'Tomorrow';
  if (d === addDays(t, -1)) return 'Yesterday';
  return new Date(`${d}T12:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// Refresh the red count next to "Tasks" in the menu (due today + overdue).
export async function updateTaskBadge() {
  const s = await GET('/api/tasks/summary').catch(() => null);
  $$('[data-task-badge]').forEach(b => { const n = s?.due || 0; b.textContent = n > 99 ? '99+' : String(n); b.hidden = !n; b.classList.toggle('soft', !s?.overdue); });
}

export const taskRow = (t, { showWho = false } = {}) => {
  const late = t.status === 'open' && t.due_date && t.due_date < todayStr();
  const meta = [
    t.due_date ? html`<span class="${late ? 'late' : ''}">${late ? '⚠️ ' : ''}${dueText(t.due_date)}${t.start_time ? ` ${timeText(t)}` : ''}</span>` : '',
    t.block_time ? html`<span class="badge warn" title="No jobs can be booked for them then">⛔ ${t.start_time ? 'time blocked' : 'day blocked'}</span>` : '',
    t.priority === 'high' ? badge('high', 'bad') : '',
    t.repeat ? html`<span title="${t.repeat}">${icon('repeat')} ${t.repeat}</span>` : '',
    t.location ? html`<span>📍 ${t.location}</span>` : '',
    t.customer_name ? html`<span>${t.customer_name}</span>` : '',
    showWho ? html`<span>→ ${t.assigned_name || 'Anyone'}</span>` : t.created_by && t.created_by !== state.user.id && t.created_name ? html`<span>from ${t.created_name}</span>` : '',
    t.status === 'done' ? html`<span>✓ ${t.done_name || ''}${t.done_note ? `: ${t.done_note}` : ''}</span>` : '',
  ].filter(Boolean);
  return html`<div class="task-row ${t.status === 'done' ? 'done' : ''} ${late ? 'is-late' : ''}">
    <button class="task-check" data-toggle="${t.id}" data-status="${t.status}" aria-label="${t.status === 'done' ? 'Mark not done' : 'Mark done'}: ${t.title}">${t.status === 'done' ? icon('circle-check') : ''}</button>
    <button class="task-main" data-open="${t.id}"><span class="task-title">${t.title}</span>
      ${meta.length ? html`<span class="task-meta small muted">${meta.map((m, i) => html`${i ? raw(' · ') : ''}${m}`)}</span>` : ''}</button></div>`;
};

function wireRows(root, tasks, onChange) {
  $$('[data-toggle]', root).forEach(b => b.addEventListener('click', async () => {
    const id = Number(b.dataset.toggle);
    try {
      if (b.dataset.status === 'done') await POST(`/api/tasks/${id}/reopen`);
      else { await POST(`/api/tasks/${id}/done`); toast('Done ✓'); }
      onChange(); updateTaskBadge();
    } catch (e) { toast(e.message, 'error'); }
  }));
  $$('[data-open]', root).forEach(b => b.addEventListener('click', () => openTask(tasks.find(t => t.id === Number(b.dataset.open)), onChange)));
}

// ---- Add / edit form ----
export async function openTask(task, onChange, defaults = {}) {
  const list = await getPeople();
  const t = task || { assigned_to: state.user.id, priority: 'normal', ...defaults };
  const editingSeries = task?.series_id && task.series_active;
  const canDel = task && (isManager() || task.created_by === state.user.id);
  const { el, close } = openModal({
    title: task ? 'Task' : 'New task', size: 'sm',
    body: html`<div class="err-box hidden" data-err></div>
      <form class="stack" style="gap:10px" data-form>
        <div class="field"><label for="tk_t">What needs to be done?</label><input id="tk_t" type="text" name="title" value="${t.title || ''}" required maxlength="200" placeholder="e.g. Pick up 6 panels from ADI"></div>
        <div class="grid g2" style="gap:10px">
          <div class="field"><label for="tk_a">Who</label><select id="tk_a" name="assigned_to"><option value="">Anyone / unassigned</option>${list.map(p => html`<option value="${p.id}" ${p.id === t.assigned_to ? 'selected' : ''}>${p.id === state.user.id ? `Me (${p.name})` : p.name}</option>`)}</select></div>
          <div class="field"><label for="tk_d">Due</label><input id="tk_d" type="date" name="due_date" value="${t.due_date || ''}"></div>
        </div>
        <div class="grid g2" style="gap:10px">
          <div class="field"><label for="tk_st">From (optional)</label><input id="tk_st" type="time" name="start_time" value="${t.start_time || ''}"></div>
          <div class="field"><label for="tk_et">To</label><input id="tk_et" type="time" name="end_time" value="${t.end_time || ''}"></div>
        </div>
        <label class="check-row"><input type="checkbox" name="block_time" ${t.block_time ? 'checked' : ''}> <span><b>Block this time on the calendar</b><span class="small muted" style="display:block">No jobs can be booked for them then. Leave the times empty to block the whole day. Unchecked, the task still shows on the calendar.</span></span></label>
        <div class="grid g2" style="gap:10px">
          <div class="field"><label for="tk_p">Priority</label><select id="tk_p" name="priority">${['low', 'normal', 'high'].map(p => html`<option value="${p}" ${p === t.priority ? 'selected' : ''}>${p[0].toUpperCase() + p.slice(1)}</option>`)}</select></div>
          <div class="field"><label for="tk_l">Where (optional)</label><input id="tk_l" type="text" name="location" value="${t.location || ''}" placeholder="ADI Dayton, bank…"></div>
        </div>
        <div class="field"><label for="tk_n">Notes</label><textarea id="tk_n" name="notes" rows="3">${t.notes || ''}</textarea></div>
        ${!task ? html`<div class="field"><label for="tk_r">Repeat</label><select id="tk_r" name="freq"><option value="">Doesn’t repeat</option><option value="daily">Daily / every few days</option><option value="weekdays">Every weekday (Mon–Fri)</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></div>
          <div class="stack repeat-opts hidden" style="gap:10px" data-repeat>
            <div class="row" data-n><label for="tk_n2" class="small">Every</label><input id="tk_n2" type="number" name="every_n" value="1" min="1" max="365" style="width:72px"><span class="small" data-unit>days</span></div>
            <div class="row day-picks" data-days>${DAYS.map((d, i) => html`<label class="day-pick"><input type="checkbox" name="wd" value="${i}"><span>${d}</span></label>`)}</div>
            <div class="row" data-md><label for="tk_md" class="small">On day</label><input id="tk_md" type="number" name="month_day" min="1" max="31" style="width:72px"><span class="small muted">of the month (31 = last day)</span></div>
            <div class="grid g2" style="gap:10px"><div class="field"><label for="tk_s">Starting</label><input id="tk_s" type="date" name="starts_on" value="${todayStr()}"></div>
              <div class="field"><label for="tk_e">Until (optional)</label><input id="tk_e" type="date" name="ends_on"></div></div>
            <p class="small muted" style="margin:0">A new to-do shows up on each date. If the last one isn’t done yet, it isn’t doubled up.</p>
          </div>` : task.repeat ? html`<div class="small muted">${icon('repeat')} ${task.repeat}${editingSeries ? html` · <a href="#/tasks?view=repeating">Change the schedule</a>` : ''}</div>` : ''}
        ${task ? html`<div class="small muted">Added by ${task.created_name || '—'} · ${task.created_at.slice(0, 16)}${task.status === 'done' ? ` · Done by ${task.done_name || '—'} ${task.done_at?.slice(0, 16) || ''}` : ''}</div>` : ''}
      </form>`,
    foot: html`${canDel ? html`<button class="btn ghost danger" data-del>Delete</button>` : ''}<button class="btn" data-close>Cancel</button>
      ${task && task.status === 'open' ? html`<button class="btn" data-done>Mark done</button>` : ''}<button class="btn primary" data-save>${task ? 'Save' : 'Add task'}</button>`,
  });
  const f = $('[data-form]', el);
  const err = m => { const b = $('[data-err]', el); b.textContent = m; b.classList.remove('hidden'); };
  const syncRepeat = () => {
    const fr = f.freq?.value;
    if (fr === undefined) return;
    $('[data-repeat]', el).classList.toggle('hidden', !fr);
    $('[data-n]', el).classList.toggle('hidden', fr === 'weekdays');
    $('[data-unit]', el).textContent = fr === 'weekly' ? 'week(s)' : fr === 'monthly' ? 'month(s)' : 'day(s)';
    $('[data-days]', el).classList.toggle('hidden', fr !== 'weekly');
    $('[data-md]', el).classList.toggle('hidden', fr !== 'monthly');
    const start = f.starts_on.value || todayStr();
    if (fr === 'weekly' && !$$('[name=wd]:checked', el).length) $(`[name=wd][value="${new Date(`${start}T12:00`).getDay()}"]`, el).checked = true;
    if (fr === 'monthly' && !f.month_day.value) f.month_day.value = Number(start.slice(8));
  };
  f.freq?.addEventListener('change', syncRepeat);
  f.due_date.addEventListener('change', () => { if (f.starts_on && f.due_date.value) f.starts_on.value = f.due_date.value; });
  const save = async () => {
    const body = { title: f.title.value.trim(), assigned_to: f.assigned_to.value || null, due_date: f.due_date.value || null, priority: f.priority.value, location: f.location.value, notes: f.notes.value,
      start_time: f.start_time.value || null, end_time: f.end_time.value || null, block_time: f.block_time.checked };
    if (!body.title) return err('What needs to be done?');
    if ((body.start_time || body.block_time) && !body.due_date && !f.freq?.value) return err(body.block_time ? 'Pick the date to block' : 'Pick a due date for the time');
    if (f.freq?.value) {
      body.repeat = { freq: f.freq.value, every_n: f.every_n.value, weekdays: $$('[name=wd]:checked', el).map(c => c.value).join(','), month_day: f.month_day.value, starts_on: f.starts_on.value, ends_on: f.ends_on.value };
      body.due_date = null;
    }
    try {
      if (task) await saveWithConflictCheck(d => PUT(`/api/tasks/${task.id}`, d), body);
      else {
        const r = await saveWithConflictCheck(d => POST('/api/tasks', d), body);
        if (body.repeat) toast(r.id ? `Repeating task added (${r.repeat})` : `Repeating task set. First one: ${dueText(r.next_date)}`);
        else toast('Task added');
      }
      close(); onChange?.(); updateTaskBadge();
    } catch (e) { err(e.message); }
  };
  f.addEventListener('submit', e => { e.preventDefault(); save(); });
  $('[data-save]', el).addEventListener('click', save);
  $('[data-done]', el)?.addEventListener('click', async () => { await POST(`/api/tasks/${task.id}/done`); close(); toast('Done ✓'); onChange?.(); updateTaskBadge(); });
  $('[data-del]', el)?.addEventListener('click', async () => {
    if (!(await confirmDialog(task.series_id && task.series_active ? 'Delete this to-do? (The repeating schedule keeps going. Stop it under Repeating.)' : 'Delete this task?', { okLabel: 'Delete', danger: true }))) return;
    await api('DELETE', `/api/tasks/${task.id}`); close(); onChange?.(); updateTaskBadge();
  });
  f.title.focus();
}

// ---- Card for My Day / dashboard ----
export async function myTasksCard(box) {
  if (!box) return;
  const tasks = (await GET('/api/tasks').catch(() => [])).filter(t => t.status === 'open');
  const due = tasks.filter(t => !t.due_date || t.due_date <= addDays(todayStr(), 1));
  const draw = () => myTasksCard(box);
  mount(box, html`<div class="card-head"><h2>${icon('list-checks')} My tasks${tasks.length ? ` (${tasks.length})` : ''}</h2><div class="row"><button class="btn sm" data-new>+ Task</button><a class="btn sm ghost" href="#/tasks">All</a></div></div>
    <div class="card-body tight">${due.length ? html`<div class="task-list">${due.slice(0, 8).map(t => taskRow(t))}</div>${due.length > 8 ? html`<div class="small muted" style="margin-top:6px"><a href="#/tasks">${due.length - 8} more…</a></div>` : ''}`
      : html`<div class="muted small">${tasks.length ? `Nothing due today. ${tasks.length} coming up.` : 'No tasks. Nice.'}</div>`}</div>`);
  box.classList.remove('hidden');
  $('[data-new]', box).addEventListener('click', () => openTask(null, draw));
  wireRows(box, due, draw);
}

// ---- Tasks page ----
export async function render(view, _, query) {
  loading(view);
  const tab = query.view || 'mine';
  const tabs = [['mine', 'My tasks'], ['assigned', 'Assigned by me'], ...(isManager() ? [['all', 'Everyone']] : []), ['repeating', 'Repeating'], ['done', 'Done']];
  const head = html`<div class="page-head"><div><h1>Tasks</h1><div class="sub">To-dos for yourself or anyone on the team, one-time or repeating</div></div>
      <div class="actions"><button class="btn primary" data-new>+ New task</button></div></div>
    <div class="tabs">${tabs.map(([k, l]) => html`<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${l}</button>`)}</div>`;
  const onChange = () => refresh();
  let body;
  if (tab === 'repeating') {
    const series = await GET('/api/task-series');
    body = series.length ? html`<div class="card"><div class="card-body tight"><div class="task-list">${series.map(s => html`<div class="task-row ${s.active ? '' : 'done'}">
        <span class="task-check static">${icon('repeat')}</span>
        <button class="task-main" data-series="${s.id}"><span class="task-title">${s.title}</span>
          <span class="task-meta small muted">${s.repeat}${s.start_time ? ` · ${timeText(s)}` : ''}${s.block_time ? ' · ⛔ blocks time' : ''} · ${s.assigned_name || 'Anyone'}${s.active && s.next_date ? ` · next: ${dueText(s.next_date)}` : s.active ? '' : ' · ended'}</span></button></div>`)}</div></div></div>`
      : html`<div class="card"><div class="empty">No repeating tasks. Add one with “+ New task” and choose how often it repeats.</div></div>`;
    mount(view, html`${head}${body}`);
    $$('[data-series]', view).forEach(b => b.addEventListener('click', () => editSeries(series.find(s => s.id === Number(b.dataset.series)), onChange)));
  } else {
    const tasks = await GET('/api/tasks', { view: tab });
    const t0 = todayStr();
    const groups = tab === 'done' ? [['Done (last 60 days)', tasks]] : [
      ['Overdue', tasks.filter(t => t.status === 'open' && t.due_date && t.due_date < t0)],
      ['Today', tasks.filter(t => t.status === 'open' && t.due_date === t0)],
      ['Coming up', tasks.filter(t => t.status === 'open' && t.due_date > t0)],
      ['No date', tasks.filter(t => t.status === 'open' && !t.due_date)],
      ['Done today', tasks.filter(t => t.status === 'done')],
    ].filter(([, l]) => l.length);
    body = tasks.length ? groups.map(([g, l]) => html`<h3 class="lib-group ${g === 'Overdue' ? 'late' : ''}">${g} (${l.length})</h3><div class="card"><div class="card-body tight"><div class="task-list">${l.map(t => taskRow(t, { showWho: tab !== 'mine' }))}</div></div></div>`)
      : html`<div class="card"><div class="empty">${tab === 'mine' ? 'Nothing on your list.' : tab === 'assigned' ? 'You haven’t given anyone a task yet.' : 'Nothing here.'}</div></div>`;
    mount(view, html`${head}${body}`);
    wireRows(view, tasks, onChange);
  }
  $$('[data-tab]', view).forEach(b => b.addEventListener('click', () => { location.hash = `#/tasks${b.dataset.tab === 'mine' ? '' : `?view=${b.dataset.tab}`}`; }));
  $('[data-new]', view).addEventListener('click', () => openTask(null, onChange));
  if (query.new) openTask(null, onChange);
  updateTaskBadge();
}

async function editSeries(s, onChange) {
  const list = await getPeople();
  const canEdit = isManager() || s.created_by === state.user.id;
  const wd = String(s.weekdays || '').split(',');
  const { el, close } = openModal({
    title: 'Repeating task', size: 'sm',
    body: html`<div class="err-box hidden" data-err></div><form class="stack" style="gap:10px" data-form>
      <div class="field"><label for="ts_t">Task</label><input id="ts_t" type="text" name="title" value="${s.title}" ${canEdit ? '' : 'disabled'}></div>
      <div class="field"><label for="ts_a">Who</label><select id="ts_a" name="assigned_to" ${canEdit ? '' : 'disabled'}><option value="">Anyone / unassigned</option>${list.map(p => html`<option value="${p.id}" ${p.id === s.assigned_to ? 'selected' : ''}>${p.name}</option>`)}</select></div>
      <div class="field"><label for="ts_f">Repeats</label><select id="ts_f" name="freq" ${canEdit ? '' : 'disabled'}>${[['daily', 'Daily / every few days'], ['weekdays', 'Every weekday'], ['weekly', 'Weekly'], ['monthly', 'Monthly']].map(([v, l]) => html`<option value="${v}" ${v === s.freq ? 'selected' : ''}>${l}</option>`)}</select></div>
      <div class="row"><label for="ts_n" class="small">Every</label><input id="ts_n" type="number" name="every_n" value="${s.every_n}" min="1" style="width:72px" ${canEdit ? '' : 'disabled'}><span class="small muted">days / weeks / months</span></div>
      <div class="row day-picks">${DAYS.map((d, i) => html`<label class="day-pick"><input type="checkbox" name="wd" value="${i}" ${wd.includes(String(i)) ? 'checked' : ''} ${canEdit ? '' : 'disabled'}><span>${d}</span></label>`)}</div>
      <div class="row"><label for="ts_md" class="small">Day of month</label><input id="ts_md" type="number" name="month_day" value="${s.month_day || ''}" min="1" max="31" style="width:72px" ${canEdit ? '' : 'disabled'}></div>
      <div class="field"><label for="ts_e">Until (optional)</label><input id="ts_e" type="date" name="ends_on" value="${s.ends_on || ''}" ${canEdit ? '' : 'disabled'}></div>
      <div class="grid g2" style="gap:10px"><div class="field"><label for="ts_st">From (optional)</label><input id="ts_st" type="time" name="start_time" value="${s.start_time || ''}" ${canEdit ? '' : 'disabled'}></div>
        <div class="field"><label for="ts_et">To</label><input id="ts_et" type="time" name="end_time" value="${s.end_time || ''}" ${canEdit ? '' : 'disabled'}></div></div>
      <label class="check-row"><input type="checkbox" name="block_time" ${s.block_time ? 'checked' : ''} ${canEdit ? '' : 'disabled'}> <span>Block this time on the calendar (no jobs booked then)</span></label>
      <div class="small muted">${s.repeat}${s.next_date && s.active ? ` · next: ${dueText(s.next_date)}` : ''} · set up by ${s.created_name || '—'}</div></form>`,
    foot: canEdit ? html`<button class="btn ghost danger" data-stop>Stop repeating</button><button class="btn" data-close>Cancel</button><button class="btn primary" data-save>Save</button>` : html`<button class="btn primary" data-close>Close</button>`,
  });
  const f = $('[data-form]', el);
  $('[data-save]', el)?.addEventListener('click', async () => {
    try {
      await PUT(`/api/task-series/${s.id}`, { title: f.title.value, assigned_to: f.assigned_to.value || null, start_time: f.start_time.value || null, end_time: f.end_time.value || null, block_time: f.block_time.checked, repeat: { freq: f.freq.value, every_n: f.every_n.value, weekdays: $$('[name=wd]:checked', el).map(c => c.value).join(','), month_day: f.month_day.value, starts_on: s.starts_on, ends_on: f.ends_on.value } });
      close(); toast('Saved'); onChange();
    } catch (e) { const b = $('[data-err]', el); b.textContent = e.message; b.classList.remove('hidden'); }
  });
  $('[data-stop]', el)?.addEventListener('click', async () => {
    if (!(await confirmDialog('Stop this repeating task? Its open to-do is removed too.', { okLabel: 'Stop repeating', danger: true }))) return;
    await api('DELETE', `/api/task-series/${s.id}`); close(); onChange(); updateTaskBadge();
  });
}
