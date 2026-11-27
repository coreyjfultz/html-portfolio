import { html, raw, mount, $, $$, dataTable, promptForm, toast, badge, loading, confirmDialog } from '../ui.js';
import { GET, PUT, POST, R } from '../api.js';
import { ROLES, ROLE_INFO } from '../schema.js';
import { state, refresh } from '../app.js';

const SETTINGS = [
  ['company_name', 'Company name'], ['company_phone', 'Phone'], ['company_email', 'Email'], ['company_license', 'License #'],
  ['company_address', 'Address (printed on invoices)', 'textarea'],
  ['tax_rate', 'Sales tax rate %', 'number'], ['payment_terms_days', 'Payment terms (days)', 'number'], ['default_labor_rate', 'Default labor rate / hr', 'number'],
  ['invoice_next_number', 'Next invoice #', 'number'], ['call_next_number', 'Next service call #', 'number'],
  ['invoice_footer', 'Invoice footer (payment instructions)', 'textarea'],
];

export async function render(view, _, query) {
  const tab = query.tab || 'company';
  mount(view, html`<div class="page-head"><div><h1>Settings</h1><div class="sub">Company, users and data</div></div></div>
    <div class="tabs">${[['company', 'Company & billing'], ['calendars', 'Calendars'], ['receiving', 'Receiving'], ['users', 'Users & logins'], ['audit', 'Activity log'], ['data', 'Backup & data']].map(([k, l]) => html`<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${l}</button>`)}</div>
    <div data-pane></div>`);
  $$('[data-tab]', view).forEach(b => b.addEventListener('click', () => { location.hash = `#/settings?tab=${b.dataset.tab}`; }));
  const pane = $('[data-pane]', view);
  loading(pane);

  if (tab === 'company') {
    const s = await GET('/api/settings');
    mount(pane, html`<div class="card"><div class="card-body"><form class="form-grid" data-form>
      ${SETTINGS.map(([k, l, t]) => html`<div class="field ${t === 'textarea' ? 'full' : ''}"><label for="s_${k}">${l}</label>
        ${t === 'textarea' ? html`<textarea id="s_${k}" name="${k}">${s[k]}</textarea>` : html`<input id="s_${k}" name="${k}" type="${t || 'text'}" step="any" value="${s[k]}">`}</div>`)}
      </form><div class="row" style="margin-top:16px"><button class="btn primary" data-save>Save settings</button></div></div></div>`);
    $('[data-save]', pane).addEventListener('click', async () => {
      const data = Object.fromEntries(new FormData($('[data-form]', pane)));
      state.settings = await PUT('/api/settings', data);
      toast('Settings saved');
      $('.sidebar .brand span').textContent = state.settings.company_name;
    });
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
      <div class="card"><div class="card-head"><h2>Export to spreadsheet</h2></div><div class="card-body">
        <p>CSV files open in Excel or Google Sheets. Passwords are never exported.</p>
        <div class="row">${['customers', 'contacts', 'invoices', 'payments', 'expenses', 'service_calls', 'inventory_items', 'camera_systems', 'fire_systems', 'extinguishers', 'vehicles'].map(r =>
          html`<a class="btn sm" href="/api/export/${r}">${r.replace(/_/g, ' ')}</a>`)}</div></div></div>
    </div>`);
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
