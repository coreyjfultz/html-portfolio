import { html, mount, $, $$, dataTable, promptForm, toast, badge, loading } from '../ui.js';
import { GET, PUT, POST, R } from '../api.js';
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
    <div class="tabs">${[['company', 'Company & billing'], ['users', 'Users & logins'], ['audit', 'Activity log'], ['data', 'Backup & data']].map(([k, l]) => html`<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${l}</button>`)}</div>
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

  if (tab === 'users') {
    const [users, techs] = await Promise.all([GET('/api/users'), R.list('technicians')]);
    const techOpts = [{ value: '', label: '— not a technician —' }, ...techs.map(t => ({ value: t.id, label: t.name }))];
    const roleOpts = [{ value: 'technician', label: 'Technician — field work, schedule, systems, inventory (no billing)' }, { value: 'office', label: 'Office — everything except users/settings' }, { value: 'admin', label: 'Admin — full access' }];
    mount(pane, html`<div class="card"><div class="card-head"><div><h2>Users</h2><div class="small muted">Everyone who can sign in. Link technicians to their technician profile so "My Day" shows their jobs.</div></div>
        <button class="btn primary sm" data-new>+ Add user</button></div>
      <div class="card-body flush">${dataTable({
        rows: users,
        columns: [
          { label: 'Name', render: u => html`<b>${u.name}</b><div class="small muted">${u.email}</div>` },
          { label: 'Role', render: u => badge(u.role, u.role === 'admin' ? 'primary' : '') },
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
        <a class="btn primary" href="/api/admin/backup">Download backup</a></div></div>
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
