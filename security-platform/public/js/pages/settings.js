import { html, raw, mount, $, $$, dataTable, promptForm, toast, badge, loading, confirmDialog, pickPhotos, resizeImage } from '../ui.js';
import { GET, PUT, POST, R, api } from '../api.js';
import { ROLES, ROLE_INFO } from '../schema.js';
import { state, refresh } from '../app.js';

const SETTINGS = [
  ['company_name', 'Company name'], ['company_phone', 'Phone'], ['company_email', 'Email'], ['company_license', 'License #'],
  ['company_address', 'Address (printed on invoices)', 'textarea'],
  ['tax_rate', 'Sales tax rate %', 'number'], ['payment_terms_days', 'Payment terms (days)', 'number'], ['default_labor_rate', 'Default labor rate / hr', 'number'],
  ['invoice_next_number', 'Next invoice #', 'number'], ['call_next_number', 'Next service call #', 'number'],
  ['invoice_footer', 'Invoice footer (payment instructions)', 'textarea'],
  ['proposal_valid_days', 'Proposals valid for (days)', 'number'], ['proposal_next_number', 'Next proposal #', 'number'],
  ['proposal_terms', 'Default terms & conditions for proposals and agreements (have your attorney review)', 'textarea'],
];

export async function render(view, _, query) {
  const tab = query.tab || 'company';
  mount(view, html`<div class="page-head"><div><h1>Settings</h1><div class="sub">Company, users and data</div></div></div>
    <div class="tabs">${[['company', 'Company & billing'], ['payments', 'Payments'], ['notifications', 'Texts & email'], ['calendars', 'Calendars'], ['receiving', 'Receiving'], ['field', 'Field rules'], ['phone', 'Phone & on-call'], ['tracking', 'Tracking & maps'], ['users', 'Users & logins'], ['audit', 'Activity log'], ['data', 'Backup & data']].map(([k, l]) => html`<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${l}</button>`)}</div>
    <div data-pane></div>`);
  $$('[data-tab]', view).forEach(b => b.addEventListener('click', () => { location.hash = `#/settings?tab=${b.dataset.tab}`; }));
  const pane = $('[data-pane]', view);
  loading(pane);

  if (tab === 'company') {
    const s = await GET('/api/settings');
    mount(pane, html`<div class="card"><div class="card-body"><form class="form-grid" data-form>
      ${SETTINGS.map(([k, l, t]) => html`<div class="field ${t === 'textarea' ? 'full' : ''}"><label for="s_${k}">${l}</label>
        ${t === 'textarea' ? html`<textarea id="s_${k}" name="${k}" rows="${k === 'proposal_terms' ? 12 : 3}">${s[k]}</textarea>` : html`<input id="s_${k}" name="${k}" type="${t || 'text'}" step="any" value="${s[k]}">`}</div>`)}
      </form><div class="row" style="margin-top:16px"><button class="btn primary" data-save>Save settings</button></div></div></div>
      <div class="card" style="margin-top:16px"><div class="card-head"><div><h2>Logo</h2><div class="small muted">Shown on invoices, proposals, the customer portal and the app. PNG or JPG, ideally wide and on a transparent or white background.</div></div></div>
        <div class="card-body row" style="gap:16px">${state.logo ? html`<img src="/api/public/logo?v=${state.logo}" alt="Current logo" style="max-height:64px;max-width:220px;background:#fff;padding:6px;border:1px solid var(--border);border-radius:8px">` : html`<span class="muted">No logo yet</span>`}
          <button class="btn" data-logo>Upload logo</button>${state.logo ? html`<button class="btn ghost danger" data-nologo>Remove</button>` : ''}</div></div>`);
    $('[data-logo]', pane).addEventListener('click', async () => {
      const [file] = await pickPhotos({ camera: false, multiple: false });
      if (!file) return;
      try {
        const data = file.type === 'image/png' ? await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); }) : await resizeImage(file, 800, 0.9);
        await POST('/api/settings/logo', { data });
        toast('Logo updated'); location.reload();
      } catch (e) { toast(e.message, 'error'); }
    });
    $('[data-nologo]', pane)?.addEventListener('click', async () => { await api('DELETE', '/api/settings/logo'); toast('Logo removed'); location.reload(); });
    $('[data-save]', pane).addEventListener('click', async () => {
      const data = Object.fromEntries(new FormData($('[data-form]', pane)));
      state.settings = await PUT('/api/settings', data);
      toast('Settings saved');
      $('.sidebar .brand span').textContent = state.settings.company_name;
    });
  }

  if (tab === 'payments') {
    const [s2, cfg] = await Promise.all([GET('/api/settings'), GET('/api/payments/config')]);
    mount(pane, html`<div class="grid g2">
      <div class="card"><div class="card-head"><h2>Accepted payment methods</h2></div><div class="card-body small">
        <p>✔ <b>Cash</b> and ✔ <b>Check</b>: record them on the invoice with “Record payment”.</p>
        <p>✔ <b>Credit card</b> and ✔ <b>Bank ACH</b>: customers pay online from a “Pay now” link or the customer portal, or you charge a card/bank they've saved. Payments post to the invoice automatically.</p>
        <p class="muted">Online payments run through Stripe (about 2.9% + 30¢ per card payment; ACH 0.8%, capped at $5). Card and bank numbers stay with Stripe and never touch this system.</p></div></div>
      <div class="card"><div class="card-head"><h2>Stripe connection</h2>${cfg.ok ? html`<span class="badge good">${cfg.test ? 'Connected (test mode)' : 'Connected'}</span>` : html`<span class="badge warn">Not connected</span>`}</div>
        <div class="card-body"><form class="stack" data-pform style="gap:12px">
          <div class="field"><label for="sk">Secret key</label><input id="sk" type="password" name="stripe_secret" placeholder="${s2.stripe_secret__set ? 'Saved — leave blank to keep' : 'sk_live_… (Stripe Dashboard → Developers → API keys)'}" autocomplete="off"></div>
          <div class="field"><label for="wh">Webhook signing secret</label><input id="wh" type="password" name="stripe_webhook_secret" placeholder="${s2.stripe_webhook_secret__set ? 'Saved — leave blank to keep' : 'whsec_…'}" autocomplete="off">
            <span class="help">In Stripe: Developers → Webhooks → Add endpoint <span class="mono">${cfg.webhook_url}</span> with events <span class="mono">checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed, payment_intent.succeeded, payment_intent.payment_failed</span>, then paste its signing secret here.</span></div>
          <label class="row"><input type="checkbox" name="stripe_ach" ${s2.stripe_ach !== '0' ? raw('checked') : ''}> Offer bank (ACH) payments as well as cards</label>
          <div><button class="btn primary">Save</button></div></form></div></div></div>`);
    $('[data-pform]', pane).addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target;
      await PUT('/api/settings', { stripe_secret: f.stripe_secret.value.trim(), stripe_webhook_secret: f.stripe_webhook_secret.value.trim(), stripe_ach: f.stripe_ach.checked ? '1' : '0' });
      toast('Saved'); refresh();
    });
  }

  if (tab === 'notifications') {
    const [s2, log] = await Promise.all([GET('/api/settings'), GET('/api/notifications')]);
    const chk = (k, label) => html`<label class="row"><input type="checkbox" name="${k}" ${s2[k] === '1' ? raw('checked') : ''}> ${label}</label>`;
    const inp = (k, label, extra = {}) => html`<div class="field"><label for="n_${k}">${label}</label><input id="n_${k}" name="${k}" type="${extra.type || 'text'}" value="${extra.type === 'password' ? '' : s2[k] ?? ''}" placeholder="${extra.ph || ''}" autocomplete="off">${extra.help ? html`<span class="help">${extra.help}</span>` : ''}</div>`;
    mount(pane, html`<form data-nform class="stack">
      <div class="grid g2">
        <div class="card"><div class="card-head"><h2>Email (SMTP)</h2>${s2.email_ready ? html`<span class="badge good">Ready</span>` : html`<span class="badge warn">Not set up</span>`}</div><div class="card-body form-grid">
          ${inp('smtp_host', 'SMTP server', { ph: 'smtp.office365.com or smtp.gmail.com' })}${inp('smtp_port', 'Port', { ph: '587' })}
          ${inp('smtp_user', 'Username', { ph: 'office@yourcompany.com' })}${inp('smtp_pass', 'Password / app password', { type: 'password', ph: s2.smtp_pass__set ? 'Saved — leave blank to keep' : '' })}
          ${inp('mail_from', 'Send from address', { ph: 'office@yourcompany.com', help: 'Microsoft 365: use an account with SMTP AUTH enabled. Gmail: create an app password.' })}
          <div class="field"><label>&nbsp;</label><button type="button" class="btn" data-test="email">Send test email</button></div></div></div>
        <div class="card"><div class="card-head"><h2>Text messages (Twilio)</h2>${s2.sms_ready ? html`<span class="badge good">Ready</span>` : html`<span class="badge warn">Not set up</span>`}</div><div class="card-body form-grid">
          ${inp('twilio_sid', 'Account SID', { ph: 'AC…' })}${inp('twilio_token', 'Auth token', { type: 'password', ph: s2.twilio_token__set ? 'Saved — leave blank to keep' : '' })}
          ${inp('twilio_from', 'Texting number', { ph: '+15555550100', help: 'A Twilio number registered for business texting (A2P 10DLC).' })}
          <div class="field"><label>&nbsp;</label><button type="button" class="btn" data-test="sms">Send test text</button></div></div></div>
      </div>
      <div class="card"><div class="card-head"><h2>When to send</h2></div><div class="card-body stack" style="gap:10px">
        ${chk('notify_on_schedule', 'Confirm with the customer when a job is scheduled or moved (email and/or text, per customer)')}
        ${chk('notify_on_way', 'Text/email the customer when the technician taps “On my way”')}
        ${chk('notify_tech_invites', 'Email technicians a calendar invite (Outlook/Gmail) when they’re booked, moved or unassigned')}
        <p class="small muted" style="margin:0">Each customer can be set to email only, text only, both or neither on their profile.</p></div></div>
      <div class="card"><div class="card-head"><div><h2>Message wording</h2><div class="small muted">Placeholders: {customer} {company} {company_phone} {tech} {date} {time} {type} {address} {eta} {call_number}</div></div></div>
        <div class="card-body form-grid">
          ${[['tpl_scheduled_sms', 'Appointment text'], ['tpl_onway_sms', 'On-my-way text'], ['tpl_scheduled_email', 'Appointment email'], ['tpl_onway_email', 'On-my-way email']].map(([k, l]) =>
            html`<div class="field"><label for="n_${k}">${l}</label><textarea id="n_${k}" name="${k}" rows="${k.endsWith('email') ? 7 : 3}">${s2[k]}</textarea></div>`)}</div></div>
      <div><button class="btn primary">Save</button></div></form>
      <div class="card" style="margin-top:16px"><div class="card-head"><h2>Recent messages</h2></div><div class="card-body flush">${dataTable({
        rows: log, empty: 'Nothing sent yet.',
        columns: [{ label: 'When', key: 'created_at' }, { label: 'Type', render: m => m.channel === 'sms' ? 'Text' : 'Email' }, { label: 'To', render: m => m.to_addr },
          { label: 'Subject / message', render: m => (m.subject || m.body || '').slice(0, 90) },
          { label: 'Status', render: m => html`${badge(m.status, m.status === 'sent' ? 'good' : m.status === 'failed' ? 'bad' : '')}${m.error ? html`<div class="small muted">${m.error}</div>` : ''}` }],
      })}</div></div>`);
    const form = $('[data-nform]', pane);
    const collect = () => {
      const d = Object.fromEntries(new FormData(form));
      for (const k of ['notify_on_schedule', 'notify_on_way', 'notify_tech_invites']) d[k] = form.elements[k].checked ? '1' : '0';
      return d;
    };
    form.addEventListener('submit', async e => { e.preventDefault(); await PUT('/api/settings', collect()); toast('Saved'); refresh(); });
    $$('[data-test]', pane).forEach(b => b.addEventListener('click', async () => {
      await PUT('/api/settings', collect());
      const channel = b.dataset.test;
      promptForm({
        title: channel === 'sms' ? 'Send a test text' : 'Send a test email',
        fields: [{ name: 'to', label: channel === 'sms' ? 'Mobile number' : 'Email address', type: channel === 'sms' ? 'tel' : 'email', value: channel === 'sms' ? '' : state.user.email }],
        submitLabel: 'Send',
        onSubmit: async d => { await POST('/api/notifications/test', { channel, to: d.to }); toast('Sent!'); },
      });
    }));
  }

  if (tab === 'calendars') {
    const [f, s2] = await Promise.all([GET('/api/calendar/feeds'), GET('/api/settings')]);
    mount(pane, html`<div class="grid g2">
      <div class="card"><div class="card-head"><h2>Time zone</h2></div><div class="card-body"><form class="stack" data-tz style="gap:12px">
        <div class="field"><label for="tz">Company time zone (used for Outlook/Google calendars)</label>
          <select id="tz" name="timezone">${['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu'].map(z => html`<option ${z === s2.timezone ? raw('selected') : ''}>${z}</option>`)}</select></div>
        <div class="field"><label for="pu">Public web address (optional)</label><input id="pu" type="text" name="public_url" placeholder="https://app.yourcompany.com" value="${s2.public_url}">
          <span class="help">Used in calendar links, texts and emails. Leave blank to use the address you're on now.</span></div>
        <div><button class="btn primary">Save</button></div></form></div></div>
      <div class="card"><div class="card-head"><h2>How it works</h2></div><div class="card-body small">
        <p>• Every technician gets an <b>email invite</b> when a job is booked, moved or cancelled, so it lands in their Outlook or Gmail calendar right away.</p>
        <p>• Anyone can also <b>subscribe</b> to a live calendar feed (below, or the “Sync to Outlook / Google” button on the Calendar page).</p>
        <p class="muted">Feeds are read-only: make changes in SecureOps and they flow out to the calendars.</p></div></div>
      <div class="card" style="grid-column:1/-1"><div class="card-head"><h2>Calendar feeds</h2></div><div class="card-body flush">${dataTable({
        rows: [...(f.central ? [{ id: 'central', name: 'Central — all technicians', url: f.central }] : []), ...f.technicians],
        columns: [{ label: 'Calendar', render: r => html`${r.color ? html`<span class="dot" style="background:${r.color}"></span> ` : ''}<b>${r.name}</b>` },
          { label: 'Link', render: r => html`<span class="mono small" style="word-break:break-all">${r.url}</span>` },
          { label: '', cls: 'actions-cell', render: r => html`<button class="btn sm" data-copy="${r.url}">Copy</button> <button class="btn sm ghost danger" data-reset="${r.id}">Reset link</button>` }],
      })}</div></div></div>`);
    $('[data-tz]', pane).addEventListener('submit', async e => { e.preventDefault(); await PUT('/api/settings', { timezone: e.target.timezone.value, public_url: e.target.public_url.value.trim() }); toast('Saved'); });
    $$('[data-copy]', pane).forEach(b => b.addEventListener('click', () => navigator.clipboard?.writeText(b.dataset.copy).then(() => toast('Copied'))));
    $$('[data-reset]', pane).forEach(b => b.addEventListener('click', async () => {
      if (!(await confirmDialog('Make a new link? The old link stops working, so anyone subscribed must subscribe again.', { okLabel: 'Reset link', danger: true }))) return;
      await POST(`/api/calendar/reset/${b.dataset.reset}`); toast('New link created'); refresh();
    }));
  }

  if (tab === 'receiving') {
    const [s, info] = await Promise.all([GET('/api/settings'), GET('/api/receiving/info')]);
    const url = `${location.origin}${info.inbound_path}`;
    mount(pane, html`<div class="grid g2">
      <div class="card"><div class="card-head"><h2>Automatic receiving</h2></div><div class="card-body"><form class="stack" data-form style="gap:14px">
        <label class="row"><input type="checkbox" name="auto_receive" ${s.auto_receive === '1' ? raw('checked') : ''}> <span><b>Add stock automatically</b> when every line on an invoice matches a part # you already stock</span></label>
        <label class="row"><input type="checkbox" name="receiving_update_costs" ${s.receiving_update_costs === '1' ? raw('checked') : ''}> <span>Update each item's unit cost to the price on the latest invoice</span></label>
        <div class="field"><label for="tvd">Trusted distributor email domains</label>
          <input id="tvd" name="trusted_vendor_domains" value="${s.trusted_vendor_domains}" placeholder="adiglobal.com, anixter.com, wesco.com">
          <span class="help">Emailed invoices are only received automatically when they come from one of these domains. Anything else waits for review, so a fake email can't change your stock.</span></div>
        <div><button class="btn primary" type="submit">Save</button></div></form></div></div>
      <div class="card"><div class="card-head"><h2>Reading PDFs & photos</h2></div><div class="card-body">
        ${info.ai ? html`<p><span class="badge good">On</span> PDFs, photos and emails are read with Claude (AI).</p>`
          : html`<p><span class="badge warn">Not set up</span> Add a Claude API key to the server as <span class="mono">ANTHROPIC_API_KEY</span> and restart it. Until then, CSV files are still read automatically, and PDFs/photos can be entered by hand on the review screen.</p>`}
        <p class="small muted">Get a key at console.anthropic.com. A typical one-page invoice costs a few cents to read.</p></div></div>
      <div class="card" style="grid-column:1/-1"><div class="card-head"><h2>Email intake</h2></div><div class="card-body">
        <p>Distributor invoices can flow in by email. Use an inbound-email service (for example Postmark's free "Inbound" stream) or an automation (Zapier, Make, or Microsoft Power Automate) to send each email to this private address:</p>
        <div class="row"><input readonly value="${url}" class="mono" data-url style="flex:1;min-width:260px"><button class="btn" data-copy>Copy</button><button class="btn danger" data-regen>Make a new address</button></div>
        <p class="small muted">Then add a rule in your mailbox that forwards emails from your distributors to that service. Full steps are in the README under “Supplier invoices”. Keep this address private: anyone who has it can send documents into your Receiving inbox (they still can't change stock unless they also come from a trusted domain).</p>
      </div></div></div>`);
    $('[data-form]', pane).addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target;
      state.settings = await PUT('/api/settings', { auto_receive: f.auto_receive.checked ? '1' : '0', receiving_update_costs: f.receiving_update_costs.checked ? '1' : '0', trusted_vendor_domains: f.trusted_vendor_domains.value });
      toast('Receiving settings saved');
    });
    $('[data-copy]', pane).addEventListener('click', () => navigator.clipboard?.writeText(url).then(() => toast('Copied')));
    $('[data-regen]', pane).addEventListener('click', async () => {
      if (!(await confirmDialog('Make a new private email address? The old one stops working immediately, so update your email service afterwards.', { okLabel: 'Make new address', danger: true }))) return;
      await POST('/api/receiving/token'); toast('New address created'); refresh();
    });
  }

  if (tab === 'tracking') await (await import('./map.js')).settingsPane(pane, { settingsCards, wireSettingsCards });
  if (tab === 'phone') await (await import('./phone.js')).settingsPane(pane, { settingsCards, wireSettingsCards });

  if (tab === 'field') {
    const [s, users] = await Promise.all([GET('/api/settings'), GET('/api/users')]);
    mount(pane, settingsCards(s, [
      { title: 'Completing a job', fields: [
        ['require_photos', 'Require at least one “before” and one “after” photo', 'check'],
        ['photo_exempt_types', 'Job types that don’t need photos (comma-separated)', 'text', 'e.g. estimate, warranty'],
        ['require_parts', 'Require the parts used to be recorded, or “No parts used” ticked', 'check'],
      ], note: 'Owners and administrators can still complete a job without them by giving a reason, which is saved on the job.' },
      { title: 'Truck stock', fields: [
        ['truck_count_day', 'Weekly truck count day', 'select', ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => [String(i), d])],
        ['truck_count_reminders', 'Text each tech a reminder on count day; flag trucks that are overdue', 'check'],
        ['inventory_manager_id', 'Inventory manager (also gets count results)', 'select', [['', '— Owner only —'], ...users.filter(u => u.active).map(u => [String(u.id), `${u.name} (${u.role})`])]],
      ] },
      { title: 'Start-of-day check', fields: [
        ['readiness_required', 'Technicians must confirm their equipment before starting their first job', 'check'],
        ['readiness_spares', 'Spares to carry beyond what the jobs need', 'number'],
      ], note: 'Only an owner or administrator can let a technician start without a completed check (Truck stock → Start-of-day checks).' },
      { title: 'Alerts to the owner', fields: [
        ['alert_email', 'Email alerts to the owner(s)', 'check'],
        ['alert_sms', 'Also text important alerts', 'check'],
        ['alert_phone', 'Owner mobile for alert texts', 'tel'],
      ], note: 'Alerts: truck count differences and missing tools, techs short on equipment, clock-ins away from the office.' },
      { title: 'Time clock & office location', wide: true, fields: [
        ['office_address', 'Office address', 'text'],
        ['office_lat', 'Office latitude', 'number'], ['office_lng', 'Office longitude', 'number'],
        ['office_radius_m', 'Counts as “at the office” within (metres)', 'number'],
        ['clock_alert', 'Alert the owner when someone clocks in away from the office or without a location', 'check'],
        ['clock_alert_out', 'Also alert on clock-outs away from the office', 'check'],
        ['clock_allow_jobsite', 'Clocking in at a job you’re scheduled for today is OK (no alert)', 'check'],
      ], extra: html`<div class="row" style="margin-top:10px"><button class="btn sm" data-here>Use this device’s location</button><button class="btn sm" data-geo>Look up the address</button></div>` },
    ]));
    wireSettingsCards(pane);
    const setLL = (lat, lng) => { pane.querySelector('[name=office_lat]').value = lat.toFixed(6); pane.querySelector('[name=office_lng]').value = lng.toFixed(6); toast('Location filled in — press Save'); };
    $('[data-here]', pane).addEventListener('click', async () => {
      const p = await (await import('./timeclock.js')).getPosition();
      if (p) setLL(p.lat, p.lng); else toast('This device did not share a location', 'error');
    });
    $('[data-geo]', pane).addEventListener('click', async () => {
      try { const g = await POST('/api/geocode', { address: pane.querySelector('[name=office_address]').value }); setLL(g.lat, g.lng); }
      catch (e) { toast(e.message, 'error'); }
    });
  }

  if (tab === 'users') {
    const [users, techs] = await Promise.all([GET('/api/users'), R.list('technicians')]);
    const techOpts = [{ value: '', label: '— not a technician —' }, ...techs.map(t => ({ value: t.id, label: t.name }))];
    const roleOpts = ROLES.filter(r => r !== 'owner' || state.user.role === 'owner').map(r => ({ value: r, label: `${ROLE_INFO[r].label} — ${ROLE_INFO[r].desc}` }));
    mount(pane, html`<div class="card"><div class="card-head"><div><h2>Users</h2><div class="small muted">Everyone who can sign in. Link technicians to their technician profile so "My Day" shows their jobs.</div></div>
        <button class="btn primary sm" data-new>+ Add user</button></div>
      <div class="card-body flush">${dataTable({
        rows: users,
        columns: [
          { label: 'Name', render: u => html`<b>${u.name}</b><div class="small muted">${u.email}</div>` },
          { label: 'Role', render: u => badge(ROLE_INFO[u.role]?.label || u.role, u.role === 'owner' ? 'primary' : u.role === 'admin' ? 'info' : '') },
          { label: 'Technician profile', render: u => u.technician_name || '—' },
          { label: 'Last sign-in', render: u => u.last_login || 'never' },
          { label: 'Status', render: u => u.active ? badge('active') : badge('inactive') },
          { label: '', cls: 'actions-cell', render: u => html`<button class="btn sm ghost" data-edit="${u.id}">Edit</button>` },
        ] })}</div></div>`);
    $('[data-new]', pane).addEventListener('click', () => promptForm({
      title: 'Add user', size: '',
      fields: [
        { name: 'name', label: 'Name', required: true }, { name: 'email', label: 'Email (used to sign in)', type: 'email' },
        { name: 'password', label: 'Temporary password (8+ characters)', type: 'password', autocomplete: 'new-password' },
        { name: 'role', label: 'Role', type: 'select', options: roleOpts, value: 'technician' },
        { name: 'technician_id', label: 'Technician profile', type: 'select', options: techOpts, value: '' },
      ],
      submitLabel: 'Create user',
      onSubmit: async d => { await POST('/api/users', d); toast('User created — share the temporary password with them'); refresh(); },
    }));
    $$('[data-edit]', pane).forEach(b => b.addEventListener('click', () => {
      const u = users.find(x => x.id === Number(b.dataset.edit));
      promptForm({
        title: `Edit ${u.name}`, size: '',
        fields: [
          { name: 'name', label: 'Name', value: u.name }, { name: 'email', label: 'Email', type: 'email', value: u.email },
          { name: 'role', label: 'Role', type: 'select', options: roleOpts, value: u.role },
          { name: 'technician_id', label: 'Technician profile', type: 'select', options: techOpts, value: u.technician_id ?? '' },
          { name: 'password', label: 'Reset password (leave blank to keep)', type: 'password', autocomplete: 'new-password' },
          { name: 'active', label: 'Active (uncheck to block sign-in)', type: 'checkbox', value: !!u.active },
        ],
        onSubmit: async d => { if (!d.password) delete d.password; await PUT(`/api/users/${u.id}`, d); toast('User updated'); refresh(); },
      });
    }));
  }

  if (tab === 'audit') {
    const rows = await GET('/api/audit', { limit: 500 });
    mount(pane, html`<div class="card"><div class="card-head"><div><h2>Activity log</h2><div class="small muted">Sign-ins, changes, deletes and every time a stored password/code is revealed</div></div></div>
      <div class="card-body flush">${dataTable({
        rows,
        columns: [{ label: 'When', key: 'created_at' }, { label: 'User', render: r => r.user_name || '—' },
          { label: 'Action', render: r => r.action === 'reveal' ? html`<span class="badge warn">reveal</span>` : r.action === 'delete' ? html`<span class="badge bad">delete</span>` : r.action },
          { label: 'Record', render: r => r.resource ? `${r.resource}${r.record_id ? ' #' + r.record_id : ''}` : '—' }, { label: 'Detail', render: r => r.detail || '' }],
      })}</div></div>`);
  }

  if (tab === 'data') {
    mount(pane, html`<div class="grid g2">
      <div class="card"><div class="card-head"><h2>Backup</h2></div><div class="card-body">
        <p>Download a complete copy of the database. Do this regularly (weekly at least) and keep copies off-site.</p>
        <p class="note small">Stored camera passwords and alarm codes are encrypted with the server's secret key (<span class="mono">data/secret.key</span> or the <span class="mono">APP_SECRET</span> setting).
          Back that key up separately and keep it safe — a backup can't decrypt those passwords without it.</p>
        ${state.user.role === 'owner' ? html`<a class="btn primary" href="/api/admin/backup">Download backup</a>` : html`<p class="muted">Only an owner can download backups.</p>`}</div></div>
      ${state.user.role === 'owner' ? html`<div class="card" style="grid-column:1/-1" data-serverbackups></div>` : ''}
      <div class="card"><div class="card-head"><h2>Export to spreadsheet</h2></div><div class="card-body">
        <p>CSV files open in Excel or Google Sheets. Passwords are never exported.</p>
        <div class="row">${['customers', 'contacts', 'invoices', 'payments', 'expenses', 'service_calls', 'inventory_items', 'camera_systems', 'fire_systems', 'extinguishers', 'vehicles'].map(r =>
          html`<a class="btn sm" href="/api/export/${r}">${r.replace(/_/g, ' ')}</a>`)}</div></div></div>
    </div>`);
    const box = $('[data-serverbackups]', pane);
    const drawBackups = async () => {
      const b = await GET('/api/admin/backups');
      const mb = n => `${(n / 1e6).toFixed(1)} MB`;
      mount(box, html`<div class="card-head"><div><h2>Automatic backups on the server</h2><div class="small muted">${b.disabled ? 'Nightly backups are turned off (BACKUP_DISABLED).' : `Every night at ${b.hour}:00 — the database plus job photos, signatures and supplier invoices. The last ${b.keep} are kept.`}</div></div>
        <button class="btn sm" data-backupnow>Back up now</button></div>
        <div class="card-body flush">${dataTable({
          rows: b.backups, empty: 'No backups yet — the first one runs tonight.',
          columns: [
            { label: 'Backup', render: x => html`<span class="mono">${x.name}</span>` },
            { label: 'Type', render: x => x.reason || '' },
            { label: 'Size', render: x => mb(x.size), cls: 'num' },
            { label: 'Key', render: x => x.includes_key ? badge('includes key', 'warn') : html`<span class="small muted">key not included</span>` },
          ] })}</div>
        <div class="card-body"><p class="small muted" style="margin:0">These sit on the same server. Copy them somewhere else too (see “Off-site copies” in deploy/GO-LIVE.md), or download one above every week.</p></div>`);
      $('[data-backupnow]', box).addEventListener('click', async e => {
        e.target.disabled = true;
        try { const r = await POST('/api/admin/backups'); toast(`Backup saved (${mb(r.size)})`); } catch (err) { toast(err.message, 'error'); }
        drawBackups();
      });
    };
    if (box) drawBackups();
  }
}

export async function account(view) {
  mount(view, html`<div class="page-head"><div><h1>My account</h1><div class="sub">${state.user.name} · ${state.user.email} · ${state.user.role}</div></div></div>
    <div class="grid g2"><div class="card"><div class="card-head"><h2>Change password</h2></div><div class="card-body">
      <form class="stack" data-pw style="gap:12px">
        <div class="field"><label for="cur">Current password</label><input id="cur" type="password" name="current" autocomplete="current-password"></div>
        <div class="field"><label for="np">New password (8+ characters)</label><input id="np" type="password" name="password" autocomplete="new-password"></div>
        <div><button class="btn primary">Update password</button></div></form></div></div>
      <div class="card"><div class="card-head"><h2>Install the app</h2></div><div class="card-body">
        <p><b>iPhone / iPad:</b> open this site in Safari → Share → <i>Add to Home Screen</i>.</p>
        <p><b>Android:</b> open in Chrome → ⋮ menu → <i>Install app</i>.</p>
        <p><b>Windows / Mac:</b> in Chrome or Edge, click the install icon in the address bar.</p>
        <p class="muted small">It then opens full-screen like a regular app, with its own icon.</p></div></div></div>`);
  $('[data-pw]', view).addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    try { await POST('/api/auth/password', { current: f.current.value, password: f.password.value }); toast('Password updated'); f.reset(); }
    catch (err) { toast(err.message, 'error'); }
  });
}

// Small helper for settings tabs that are just a few switches and fields.
export function settingsCards(s, cards) {
  const field = ([k, label, type, opts]) => {
    if (type === 'check') return html`<label class="check-row"><input type="checkbox" name="${k}" ${s[k] === '1' ? raw('checked') : ''}> <span>${label}</span></label>`;
    if (type === 'select') return html`<div class="field"><label for="st_${k}">${label}</label><select id="st_${k}" name="${k}">${opts.map(([v, l]) => html`<option value="${v}" ${String(s[k] ?? '') === v ? raw('selected') : ''}>${l}</option>`)}</select></div>`;
    if (type === 'secret') return html`<div class="field"><label for="st_${k}">${label}</label><input id="st_${k}" name="${k}" type="password" autocomplete="off" placeholder="${s[k] ? '•••••••• (saved — leave blank to keep)' : ''}"></div>`;
    return html`<div class="field"><label for="st_${k}">${label}</label><input id="st_${k}" name="${k}" type="${type || 'text'}" value="${s[k] ?? ''}" ${type === 'number' ? raw('step="any"') : ''} placeholder="${typeof opts === 'string' ? opts : ''}" autocomplete="off"></div>`;
  };
  return html`<div class="grid g2">${cards.map(c => html`<div class="card ${c.wide ? 'span2' : ''}" ${c.wide ? raw('style="grid-column:1/-1"') : ''}><div class="card-head"><h2>${c.title}</h2></div><div class="card-body">
    ${c.intro || ''}<form class="stack" data-settings style="gap:12px">${c.fields.map(field)}
    ${c.note ? html`<p class="small muted" style="margin:0">${c.note}</p>` : ''}
    <div><button class="btn primary" type="submit">Save</button></div></form>${c.extra || ''}</div></div>`)}</div>`;
}
export function wireSettingsCards(pane, onSaved) {
  $$('[data-settings]', pane).forEach(f => f.addEventListener('submit', async e => {
    e.preventDefault();
    const body = {};
    for (const el of f.elements) {
      if (!el.name) continue;
      if (el.type === 'checkbox') body[el.name] = el.checked ? '1' : '0';
      else if (el.type === 'password') { if (el.value) body[el.name] = el.value; }
      else body[el.name] = el.value;
    }
    try { state.settings = await PUT('/api/settings', body); toast('Saved'); onSaved?.(); } catch (err) { toast(err.message, 'error'); }
  }));
}
