// Time off: request, approve / deny, who's out.
import { html, raw, mount, $, $$, fmtDate, fmtDateTime, badge, dataTable, openModal, promptForm, loading, toast, todayStr, addDays } from '../ui.js';
import { GET, POST, api } from '../api.js';
import { can, refresh, state } from '../app.js';

const KINDS = { vacation: '🏖️ Vacation', sick: '🤒 Sick', personal: 'Personal', training: '🎓 Training', other: 'Other' };
const STATUS = { pending: 'warn', approved: 'good', denied: 'bad', cancelled: '' };

export async function render(view, _, query) {
  loading(view);
  const manage = can.hr();
  const org = await GET('/api/org/me').catch(() => ({ team_ids: [] }));
  const lead = manage || org.is_supervisor; // can approve for others
  const [mine, all, out, users, bal, hols, team] = await Promise.all([
    GET('/api/time-off', { mine: '1' }), lead ? GET('/api/time-off') : [], GET('/api/time-off/out', { from: todayStr(), to: addDays(todayStr(), 27) }),
    manage ? GET('/api/users') : org.is_supervisor ? GET('/api/org').then(p => p.filter(u => org.team_ids.includes(u.id)).map(u => ({ ...u, active: 1 }))) : [],
    GET('/api/pto/balances'), GET('/api/holidays', { from: todayStr(), to: addDays(todayStr(), 366) }),
    manage ? GET('/api/pto/balances', { all: '1' }) : [],
  ]);
  const per = bal.workday_hours || 8;
  const hd = h => `${Math.round(h * 10) / 10} h${h ? ` (${Math.round(h / per * 10) / 10} day${h / per === 1 ? '' : 's'})` : ''}`;
  const pending = all.filter(x => x.status === 'pending' && x.can_decide);
  const othersPending = all.filter(x => x.status === 'pending' && !x.can_decide && x.user_id !== state.user.id);
  mount(view, html`<div class="page-head"><div><h1>Time off</h1><div class="sub">Request days off; approved time off blocks scheduling and shows on calendars</div></div>
      <div class="actions"><button class="btn primary" data-req>Request time off</button>${lead && users.length ? html`<button class="btn" data-add>+ Add for ${manage ? 'someone' : 'my team'}</button>` : ''}</div></div>
    <div class="kpis">${['vacation', 'sick', 'personal'].map(k => { const b = bal.balances[k]; return html`<div class="kpi ${b.remaining < 0 ? 'alert' : ''}"><div class="label">${KINDS[k]} left (${bal.year})</div>
        <div class="value">${Math.round(b.remaining / per * 10) / 10} <span style="font-size:15px;font-weight:500">days</span></div>
        <div class="hint">${b.remaining} h of ${b.total} h${b.carryover ? ` (incl. ${b.carryover} carried over)` : ''}${b.pending ? ` · ${b.pending} h pending` : ''}</div></div>`; })}
      <div class="kpi"><div class="label">Next holiday</div><div class="value" style="font-size:18px">${hols[0] ? hols[0].name : '—'}</div><div class="hint">${hols[0] ? fmtDate(hols[0].date) : ''}</div></div></div>
    ${lead ? html`<div class="card" style="margin-bottom:16px"><div class="card-head"><div><h2>Waiting for ${manage ? '' : 'your '}approval (${pending.length})</h2>${!manage ? html`<div class="small muted">Requests from people who report to you</div>` : ''}</div></div><div class="card-body stack" style="gap:8px">
      ${pending.length ? pending.map(x => html`<div class="alert-row warn ${Number(query.req) === x.id ? 'hl-row' : ''}">
        <div><b>${x.user_name}</b> · ${KINDS[x.kind] || x.kind} · <b>${x.when}</b>${x.note ? html`<div class="small">“${x.note}”</div>` : ''}${manage && x.supervisor_name ? html`<div class="small muted">Reports to ${x.supervisor_name}</div>` : ''}
          <div class="small muted">Asked ${fmtDateTime(x.created_at.replace(' ', 'T'))}</div>
          ${x.clashes?.jobs.length ? html`<div class="small" style="color:var(--bad);margin-top:4px">Already booked then: ${x.clashes.jobs.map((j, i) => html`${i ? ', ' : ''}<a href="#/calls/${j.id}">SC-${j.number} ${j.customer}</a>`)}</div>` : html`<div class="small muted" style="margin-top:4px">No jobs booked then.</div>`}
          ${x.clashes?.oncall.length ? html`<div class="small" style="color:var(--warn)">On call during part of it — <a href="#/phone">adjust the rotation</a></div>` : ''}</div>
        <div class="row"><button class="btn sm" data-deny="${x.id}">Deny</button><button class="btn sm primary" data-approve="${x.id}">Approve</button></div></div>`)
      : html`<div class="muted">Nothing waiting.</div>`}
      ${othersPending.length ? html`<div class="small muted">Also waiting (for their own supervisor): ${othersPending.map(x => `${x.user_name} ${x.when}`).join(' · ')}</div>` : ''}</div></div>` : ''}
    <div class="grid g2">
      <div class="card"><div class="card-head"><h2>Who’s out (next 4 weeks)</h2></div><div class="card-body flush">${dataTable({
        rows: out, empty: 'Everyone’s in.',
        columns: [{ label: 'Who', render: x => html`<b>${x.user_name}</b>` }, { label: 'When', render: x => x.when }],
      })}</div></div>
      <div class="card"><div class="card-head"><h2>My requests</h2></div><div class="card-body flush">${dataTable({
        rows: mine, empty: 'No requests yet.',
        columns: [
          { label: 'When', render: x => html`<b>${x.when}</b><div class="small muted">${KINDS[x.kind] || x.kind}${x.note ? ` · ${x.note}` : ''}</div>` },
          { label: 'Status', render: x => html`${badge(x.status, STATUS[x.status])}${x.decision_note ? html`<div class="small muted">${x.decided_by}: ${x.decision_note}</div>` : ''}` },
          { label: '', cls: 'actions-cell', render: x => ['pending', 'approved'].includes(x.status) && x.ends_at >= todayStr() ? html`<button class="btn sm ghost" data-cancel="${x.id}">Cancel</button>` : '' },
        ] })}</div></div>
      <div class="card"><div class="card-head"><h2>Company holidays</h2>${manage ? html`<a class="small" href="#/settings?tab=hr">Manage</a>` : ''}</div><div class="card-body flush">${dataTable({
        rows: hols.slice(0, 12), empty: 'No holidays set yet.',
        columns: [{ label: 'Date', render: h => fmtDate(h.date) }, { label: 'Holiday', render: h => html`<b>${h.name}</b>` }, { label: '', render: h => h.paid ? badge('paid', 'good') : '' }],
      })}</div></div>
      ${manage ? html`<div class="card"><div class="card-head"><h2>Balances (${bal.year})</h2></div><div class="card-body flush">${dataTable({
        rows: team,
        columns: [
          { label: 'Person', render: u => html`<b>${u.name}</b><div class="small muted">${u.role}</div>` },
          ...['vacation', 'sick', 'personal'].map(k => ({ label: k[0].toUpperCase() + k.slice(1), cls: 'num', render: u => html`<span style="${u.balances[k].remaining < 0 ? 'color:var(--bad);font-weight:600' : ''}">${u.balances[k].remaining}</span><span class="small muted"> / ${u.balances[k].total} h</span>` })),
          { label: '', cls: 'actions-cell', render: u => html`<button class="btn sm ghost" data-allow="${u.id}">Set</button>` },
        ] })}</div></div>` : ''}
      ${lead ? html`<div class="card" style="grid-column:1/-1"><div class="card-head"><h2>${manage ? 'Everyone’s' : 'My team’s'} upcoming & recent</h2></div><div class="card-body flush">${dataTable({
        rows: all.filter(x => x.status !== 'pending'), empty: 'Nothing yet.',
        columns: [
          { label: 'Who', render: x => x.user_name },
          { label: 'When', render: x => html`${x.when}<div class="small muted">${KINDS[x.kind] || x.kind}</div>` },
          { label: 'Status', render: x => html`${badge(x.status, STATUS[x.status])}<div class="small muted">${x.decided_by || ''}</div>` },
          { label: '', cls: 'actions-cell', render: x => x.status === 'approved' && x.ends_at >= todayStr() ? html`<button class="btn sm ghost" data-cancel="${x.id}">Cancel</button>` : '' },
        ] })}</div></div>` : ''}
    </div>`);
  $('[data-req]', view).addEventListener('click', () => requestDialog({ bal, per, supervisor: org.supervisor }));
  $$('[data-allow]', view).forEach(b => b.addEventListener('click', () => {
    const u = team.find(x => x.id === Number(b.dataset.allow));
    const f = (k, l) => ({ name: k, label: l, type: 'number', value: k.startsWith('carry_') ? u.balances[k.slice(6)].carryover : u.balances[k].allowance });
    promptForm({
      title: `${u.name} — ${bal.year} time off (hours)`,
      fields: [f('vacation', 'Vacation hours / year'), f('sick', 'Sick hours / year'), f('personal', 'Personal hours / year'), f('carry_vacation', 'Vacation carried over'), f('carry_sick', 'Sick carried over'), f('carry_personal', 'Personal carried over')],
      submitLabel: 'Save',
      onSubmit: async x => { await api('PUT', `/api/pto/allowances/${u.id}`, { ...x, year: bal.year }); toast('Saved'); refresh(); },
    });
  }));
  $('[data-add]', view)?.addEventListener('click', () => requestDialog({ users: users.filter(u => u.active) }));
  $$('[data-approve]', view).forEach(b => b.addEventListener('click', async () => {
    const r = await POST(`/api/time-off/${b.dataset.approve}/decide`, { decision: 'approve' });
    toast(r.clashes.jobs.length ? `Approved — reassign ${r.clashes.jobs.length} job(s) booked then` : 'Approved');
    refresh();
  }));
  $$('[data-deny]', view).forEach(b => b.addEventListener('click', () => promptForm({
    title: 'Deny time off', fields: [{ name: 'note', label: 'Reason (they’ll see this)', type: 'text' }], submitLabel: 'Deny',
    onSubmit: async x => { await POST(`/api/time-off/${b.dataset.deny}/decide`, { decision: 'deny', note: x.note }); toast('Denied'); refresh(); },
  })));
  $$('[data-cancel]', view).forEach(b => b.addEventListener('click', async () => { await POST(`/api/time-off/${b.dataset.cancel}/cancel`); toast('Cancelled'); refresh(); }));
  if (query.req) document.querySelector('.hl-row')?.scrollIntoView({ block: 'center' });
}

function requestDialog({ users, bal, per = 8, supervisor = null } = {}) {
  const { el, close } = openModal({
    title: users ? 'Add time off for someone' : 'Request time off', size: 'sm',
    body: html`<div class="err-box hidden" data-err></div>
      ${users ? html`<div class="field"><label for="to_u">Person</label><select id="to_u">${users.map(u => html`<option value="${u.id}">${u.name}</option>`)}</select></div>` : ''}
      <div class="field" style="margin-top:10px"><label for="to_k">Type</label><select id="to_k">${Object.entries(KINDS).map(([k, l]) => html`<option value="${k}">${l}${bal?.balances[k] ? ` — ${bal.balances[k].available} h available` : ''}</option>`)}</select></div>
      <label class="check-row" style="margin-top:10px"><input type="checkbox" id="to_all" checked> <span>Whole days</span></label>
      <div class="form-grid" data-days style="margin-top:8px"><div class="field"><label for="to_s">First day</label><input id="to_s" type="date" value="${todayStr()}"></div>
        <div class="field"><label for="to_e">Last day</label><input id="to_e" type="date" value="${todayStr()}"></div></div>
      <div class="form-grid hidden" data-times style="margin-top:8px"><div class="field"><label for="to_st">From</label><input id="to_st" type="datetime-local" value="${todayStr()}T13:00"></div>
        <div class="field"><label for="to_et">Until</label><input id="to_et" type="datetime-local" value="${todayStr()}T17:00"></div></div>
      <div class="field" style="margin-top:10px"><label for="to_n">Note (optional)</label><input id="to_n" type="text" placeholder="${users ? '' : 'e.g. Family trip'}"></div>
      ${users ? raw('') : html`<p class="small muted">${supervisor ? `${supervisor.name} (your supervisor) is notified` : 'The office is notified'} and you’ll get a text when it’s decided.</p>`}`,
    foot: html`<button class="btn" data-close>Cancel</button><button class="btn primary" data-go>${users ? 'Add (approved)' : 'Send request'}</button>`,
  });
  $('#to_all', el).addEventListener('change', e => { $('[data-days]', el).classList.toggle('hidden', !e.target.checked); $('[data-times]', el).classList.toggle('hidden', e.target.checked); });
  $('#to_s', el).addEventListener('change', e => { if ($('#to_e', el).value < e.target.value) $('#to_e', el).value = e.target.value; });
  $('[data-go]', el).addEventListener('click', async () => {
    const allDay = $('#to_all', el).checked;
    try {
      await POST('/api/time-off', {
        kind: $('#to_k', el).value, all_day: allDay, note: $('#to_n', el).value,
        ...(allDay ? { start_date: $('#to_s', el).value, end_date: $('#to_e', el).value } : { starts_at: $('#to_st', el).value, ends_at: $('#to_et', el).value }),
        ...(users ? { user_id: $('#to_u', el).value, approve: true } : {}),
      });
      close(); toast(users ? 'Time off added' : 'Request sent'); refresh();
    } catch (e) { const b = $('[data-err]', el); b.textContent = e.message; b.classList.remove('hidden'); }
  });
}

