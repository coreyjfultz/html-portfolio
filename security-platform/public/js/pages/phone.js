// On-call rotation and the company phone line.
import { html, mount, $, $$, fmtDateTime, badge, dataTable, openForm, promptForm, loading, toast, todayStr } from '../ui.js';
import { GET, POST, R } from '../api.js';
import { can, refresh } from '../app.js';

const dur = s => s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '';
const STATUS = { answered: 'good', completed: 'good', voicemail: 'warn', missed: 'bad', failed: 'bad', 'no-answer': 'bad', busy: 'warn' };

export async function render(view, _, query) {
  const tab = query.tab || 'oncall';
  const manage = can.manage();
  mount(view, html`<div class="page-head"><div><h1>On-call & phone</h1><div class="sub">Who answers after hours, and calls through the company number</div></div>
      <div class="actions">${manage && tab === 'oncall' ? html`<button class="btn" data-rotation>Build rotation</button><button class="btn primary" data-shift>+ Shift</button>` : ''}</div></div>
    <div class="tabs">${[['oncall', 'On-call schedule'], ['calls', 'Call log']].map(([k, l]) => html`<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${l}</button>`)}</div>
    <div data-pane></div>`);
  $$('[data-tab]', view).forEach(b => b.addEventListener('click', () => { location.hash = `#/phone?tab=${b.dataset.tab}`; }));
  const pane = $('[data-pane]', view);
  loading(pane);

  if (tab === 'calls') {
    const calls = await GET('/api/phone/calls');
    mount(pane, html`<div class="card"><div class="card-body flush">${dataTable({
      rows: calls, empty: 'No calls yet. Calls to the company number and calls made from the app show here.',
      columns: [
        { label: 'When', render: c => fmtDateTime(c.created_at.replace(' ', 'T')) },
        { label: '', render: c => c.direction === 'inbound' ? html`<span title="Incoming">↙ In</span>` : html`<span title="Outgoing">↗ Out</span>` },
        { label: 'Customer', render: c => c.customer_id ? html`<a href="#/customers/${c.customer_id}">${c.customer_name}</a>` : html`<span class="muted">${c.direction === 'inbound' ? c.from_number || 'Unknown' : c.to_number}</span>` },
        { label: 'Route', render: c => html`${c.route || ''}<div class="small muted">${c.direction === 'outbound' ? `by ${c.user_name || ''}` : c.routed_to || ''}</div>` },
        { label: 'Answered by', render: c => c.answered_by || '—' },
        { label: 'Status', render: c => html`${badge(c.status, STATUS[c.status] ?? '')} ${c.duration ? html`<span class="small muted">${dur(c.duration)}</span>` : ''}` },
        { label: 'Voicemail', render: c => c.voicemail_url ? html`<audio controls preload="none" src="${c.voicemail_url}.mp3" style="height:32px;max-width:220px"></audio>` : '' },
      ] })}</div></div>`);
    return;
  }

  const [now, shifts] = await Promise.all([GET('/api/oncall/now'), R.list('on_call_shifts')]);
  const upcoming = shifts.filter(s => s.ends_at >= todayStr()).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const cur = now.current;
  mount(pane, html`
    ${!now.voice.ok && manage ? html`<div class="note" style="margin-bottom:16px">📞 The company phone line isn't connected yet — it needs ${now.voice.missing.join(', ')}. <a href="#/settings?tab=phone">Set it up</a>. The on-call schedule and calendar invites work without it.</div>` : ''}
    <div class="grid g2" style="margin-bottom:16px">
      <div class="card"><div class="card-body">
        <div class="small muted">ON CALL NOW</div>
        ${cur ? html`<div style="font-size:22px;font-weight:700;margin:4px 0">${cur.tech_name}</div>
          <div class="muted">until ${fmtDateTime(cur.ends_at)}${cur.backup_name ? ` · backup ${cur.backup_name}` : ''}</div>`
        : html`<div style="font-size:18px;font-weight:600;margin:4px 0">Nobody</div><div class="muted">After-hours calls go to voicemail.</div>`}
        <div class="row" style="margin-top:10px">${badge(now.office_open ? 'office open' : 'office closed', now.office_open ? 'good' : '')}
          ${now.voice.number ? html`<span class="small muted">Company line ${now.voice.number}</span>` : ''}</div></div></div>
      <div class="card"><div class="card-body">
        <div class="small muted">NEXT HANDOFF</div>
        ${now.next ? html`<div style="font-size:18px;font-weight:600;margin:4px 0">${now.next.tech_name}</div><div class="muted">${fmtDateTime(now.next.starts_at)} – ${fmtDateTime(now.next.ends_at)}${now.next.backup_name ? ` · backup ${now.next.backup_name}` : ''}</div>`
        : html`<div class="muted" style="margin-top:6px">Nothing scheduled${manage ? ' — use “Build rotation”' : ''}.</div>`}
        <p class="small muted" style="margin-bottom:0">Shifts appear on each tech’s calendar (their calendar link and an emailed invite), and they get a text before it starts.</p></div></div>
    </div>
    <div class="card"><div class="card-head"><h2>Schedule</h2></div><div class="card-body flush">${dataTable({
      rows: upcoming, empty: 'No upcoming on-call shifts.',
      columns: [
        { label: 'On call', render: s => html`<b>${s.technician_id_label}</b>` },
        { label: 'Backup', render: s => s.backup_technician_id_label || '—' },
        { label: 'From', render: s => fmtDateTime(s.starts_at) },
        { label: 'To', render: s => fmtDateTime(s.ends_at) },
        { label: '', render: s => cur?.id === s.id ? badge('now', 'good') : '' },
        ...(manage ? [{ label: '', cls: 'actions-cell', render: s => html`<button class="btn sm ghost" data-edit="${s.id}">Edit</button>` }] : []),
      ] })}</div></div>`);
  $$('[data-edit]', pane).forEach(b => b.addEventListener('click', () => openForm('on_call_shifts', { record: upcoming.find(s => s.id === Number(b.dataset.edit)), onSaved: refresh, onDeleted: refresh, allowDelete: true })));
  $('[data-shift]', view)?.addEventListener('click', () => openForm('on_call_shifts', { onSaved: refresh }));
  $('[data-rotation]', view)?.addEventListener('click', async () => {
    const techs = (await R.list('technicians', { active: 1 }));
    const { el } = promptForm({
      title: 'Build an on-call rotation',
      intro: html`<p class="muted" style="margin-top:0">Each technician takes a turn; the next person in line is their backup. Everyone gets a calendar invite.</p>
        <div class="field"><label>Who's in the rotation (in order)</label><div class="stack" style="gap:4px" data-techs>${techs.map(t => html`<label class="row"><input type="checkbox" value="${t.id}" checked> ${t.name}</label>`)}</div></div>`,
      fields: [
        { name: 'start', label: 'First shift starts', type: 'date', value: todayStr(), required: true },
        { name: 'handoff', label: 'Handoff time', type: 'time', value: '08:00' },
        { name: 'days', label: 'Days per shift', type: 'number', value: 7 },
        { name: 'shifts', label: 'How many shifts', type: 'number', value: 8 },
        { name: 'replace', label: 'Replace shifts already scheduled in that period', type: 'checkbox', value: false },
      ],
      submitLabel: 'Create shifts', size: '',
      onSubmit: async d => {
        const ids = $$('[data-techs] input:checked', el).map(i => Number(i.value));
        const r = await POST('/api/oncall/rotation', { ...d, technician_ids: ids });
        toast(`${r.created} shifts created`); refresh();
      },
    });
  });
}

/** Settings → Phone & on-call */
export async function settingsPane(pane, { settingsCards, wireSettingsCards }) {
  const [s, setup] = await Promise.all([GET('/api/settings'), GET('/api/phone/setup')]);
  mount(pane, settingsCards(s, [
    { title: 'Company phone line (Twilio)', intro: html`<p class="muted" style="margin-top:0">${setup.ok ? html`${badge('connected', 'good')} Calls to ${setup.number} are routed by the app.` : html`${badge('not connected', 'warn')} Needs: ${setup.missing.join(', ')}.`}</p>`,
      fields: [
        ['voice_enabled', 'Route calls through the app (office hours → office, after hours → on call)', 'check'],
        ['voice_number', 'Company Twilio number (blank = the texting number)', 'tel'],
        ['office_phone', 'Office phone to ring during business hours', 'tel'],
        ['office_days', 'Office days (0 = Sun … 6 = Sat)', 'text', '1,2,3,4,5'],
        ['office_open', 'Opens', 'time'], ['office_close', 'Closes', 'time'],
      ],
      extra: html`<div class="note small" style="margin-top:12px">In the Twilio console, open your number → <b>Voice configuration</b> → “A call comes in”: Webhook, HTTP POST:
        <div class="row" style="margin-top:6px"><input readonly class="mono" value="${setup.incoming_url || 'Set the public web address first (Calendars tab)'}" style="flex:1;min-width:240px"><button class="btn sm" data-copy>Copy</button></div>
        Set “Call status changes” to <span class="mono">${setup.status_url || '…/status'}</span>. Every request is checked against your Twilio auth token. <a href="#" data-reset>Make a new link</a></div>` },
    { title: 'Messages callers hear', fields: [
      ['voice_greeting', 'Greeting ({company} = your company name)', 'text'],
      ['voice_after_hours', 'After hours', 'text'],
      ['voice_voicemail', 'Voicemail prompt', 'text'],
    ] },
    { title: 'On-call', fields: [
      ['voice_whisper', 'Announce the caller to the tech, who presses 1 to accept (so their voicemail can’t answer)', 'check'],
      ['voice_grant_hours', 'Hours the answering tech can see that customer in the app', 'number'],
      ['oncall_notify', 'Email calendar invites and text techs about their on-call shifts', 'check'],
    ], note: 'Technicians can give each tech their own Twilio number on the Technicians page; calls to it ring that tech directly.' },
  ]));
  wireSettingsCards(pane, () => settingsPane(pane, { settingsCards, wireSettingsCards }));
  $('[data-copy]', pane)?.addEventListener('click', () => navigator.clipboard?.writeText(setup.incoming_url).then(() => toast('Copied')));
  $('[data-reset]', pane)?.addEventListener('click', async e => { e.preventDefault(); await POST('/api/phone/reset-link'); toast('New link created — update it in Twilio'); settingsPane(pane, { settingsCards, wireSettingsCards }); });
}

