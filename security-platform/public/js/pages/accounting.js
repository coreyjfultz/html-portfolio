import { html, raw, mount, $, $$, dataTable, toast, confirmDialog, todayStr, addDays, loading } from '../ui.js';
import { GET, POST, PUT } from '../api.js';
import { refresh } from '../app.js';

const FORMATS = [
  ['qbo-invoices', 'QuickBooks Online — invoices (CSV)', 'In QuickBooks Online: + New → Invoice list → Import invoices, then upload this file.'],
  ['iif', 'QuickBooks Desktop — invoices (IIF)', 'In QuickBooks Desktop: File → Utilities → Import → IIF Files.'],
  ['xero-invoices', 'Xero — sales invoices (CSV)', 'In Xero: Business → Invoices → Import. Set the income account code below.'],
  ['generic-invoices', 'Any software (FreshBooks, Wave, Zoho, Sage, Excel) — invoice lines (CSV)', 'One row per invoice line with totals; works with any import tool or spreadsheet.'],
  ['payments', 'Payments received (CSV)', 'Every payment with date, customer, invoice, method and reference.'],
];

export async function render(view, _, query) {
  loading(view);
  const st = await GET('/api/qbo/status');
  const items = st.connected ? await GET('/api/qbo/items').catch(e => ({ error: e.message })) : [];
  const monthStart = todayStr().slice(0, 8) + '01';
  mount(view, html`
    <div class="page-head"><div><h1>Accounting & QuickBooks</h1><div class="sub">Send invoices and payments to your accounting software</div></div></div>
    ${query.qbo === 'connected' ? html`<div class="banner good">✅ QuickBooks connected${st.company ? ` to ${st.company}` : ''}.</div>` : ''}
    ${query.qbo_error ? html`<div class="err-box">${query.qbo_error}</div>` : ''}
    <div class="grid g2">
      <div class="card"><div class="card-head"><div><h2>QuickBooks Online</h2><div class="small muted">Two-way-safe: invoices, customers and payments are created/updated in QuickBooks</div></div>
        ${st.connected ? html`<span class="badge good">Connected</span>` : html`<span class="badge warn">Not connected</span>`}</div>
        <div class="card-body">
        ${st.connected ? html`
          <dl class="dl small"><dt>Company</dt><dd>${st.company || '—'} <span class="muted">(${st.env})</span></dd>
            <dt>Last sync</dt><dd>${st.last_sync ? new Date(st.last_sync).toLocaleString() : 'never'}</dd>
            <dt>Synced</dt><dd>${st.synced.invoice || 0} invoices · ${st.synced.payment || 0} payments · ${st.synced.customer || 0} customers</dd></dl>
          <form class="stack" data-map style="gap:12px;margin-top:14px">
            ${items.error ? html`<div class="err-box">${items.error}</div>` : html`
            <div class="field"><label for="it">Post sales to this QuickBooks product/service</label><select id="it" name="qbo_item_id"><option value="">Choose…</option>${items.map(i => html`<option value="${i.id}" ${i.id === st.item_id ? raw('selected') : ''}>${i.name} (${i.type})</option>`)}</select></div>
            <div class="field"><label for="tx">Post sales tax to</label><select id="tx" name="qbo_tax_item_id"><option value="">Same as above</option>${items.map(i => html`<option value="${i.id}" ${i.id === st.tax_item_id ? raw('selected') : ''}>${i.name}</option>`)}</select>
              <span class="help">Tax calculated here is sent as its own line so totals match exactly. Ask your accountant which item to use.</span></div>`}
            <label class="row"><input type="checkbox" name="qbo_auto_sync" ${st.auto_sync ? raw('checked') : ''}> Sync automatically as invoices and payments change</label>
            <div class="row"><button class="btn primary">Save</button><button type="button" class="btn" data-sync>Sync now</button><button type="button" class="btn ghost danger" data-disc>Disconnect</button></div></form>`
        : html`
          <ol class="small" style="padding-left:18px;margin-top:0">
            <li>Sign in at <b>developer.intuit.com</b> with the company's QuickBooks login → <i>Create an app</i> → QuickBooks Online and Payments (Accounting scope).</li>
            <li>Under <i>Keys & OAuth</i>, add this <b>Redirect URI</b>: <span class="mono" style="word-break:break-all">${st.redirect_uri}</span></li>
            <li>Copy the <b>Client ID</b> and <b>Client Secret</b> below, save, then click <b>Connect to QuickBooks</b>.</li></ol>
          <form class="stack" data-app style="gap:12px">
            <div class="field"><label for="cid">Client ID</label><input id="cid" type="text" name="qbo_client_id" value="${st.client_id || ''}" autocomplete="off"></div>
            <div class="field"><label for="cs">Client Secret</label><input id="cs" type="password" name="qbo_client_secret" placeholder="${st.has_app ? 'Saved — leave blank to keep' : ''}" autocomplete="off"></div>
            <div class="field"><label for="env">Environment</label><select id="env" name="qbo_environment"><option value="sandbox" ${st.env !== 'production' ? raw('selected') : ''}>Sandbox (testing)</option><option value="production" ${st.env === 'production' ? raw('selected') : ''}>Production (real books)</option></select></div>
            <div class="row"><button class="btn">Save</button><button type="button" class="btn primary" data-connect ${st.has_app ? '' : raw('disabled')}>Connect to QuickBooks</button></div></form>`}
        </div></div>

      <div class="card"><div class="card-head"><div><h2>Export for other software</h2><div class="small muted">QuickBooks Desktop, Xero, FreshBooks, Wave, Sage, spreadsheets</div></div></div>
        <div class="card-body"><form class="stack" data-exp style="gap:12px">
          <div class="field"><label for="fmt">Format</label><select id="fmt" name="format">${FORMATS.map(([v, l]) => html`<option value="${v}">${l}</option>`)}</select><span class="help" data-help>${FORMATS[0][2]}</span></div>
          <div class="form-grid"><div class="field"><label for="ef">From</label><input id="ef" type="date" name="from" value="${addDays(monthStart, -1).slice(0, 8) + '01'}"></div>
            <div class="field"><label for="et">To</label><input id="et" type="date" name="to" value="${todayStr()}"></div></div>
          <details class="small"><summary>Account names (optional)</summary><div class="form-grid" style="margin-top:8px">
            <div class="field"><label for="ia">Income account (IIF) / code (Xero)</label><input id="ia" type="text" data-acct="export_income_account" placeholder="Sales / 200"></div>
            <div class="field"><label for="ta">Sales tax account (IIF)</label><input id="ta" type="text" data-acct="export_tax_account" placeholder="Sales Tax Payable"></div></div></details>
          <div><button class="btn primary">Download</button></div></form></div></div>
    </div>
    ${st.errors.length ? html`<div class="card" style="margin-top:16px"><div class="card-head"><h2>Sync problems</h2><span class="small muted">Fix the cause, then “Sync now” retries them</span></div><div class="card-body flush">${dataTable({
      rows: st.errors, href: e => e.entity === 'invoice' ? `#/invoices/${e.local_id}` : '',
      columns: [{ label: 'Record', render: e => `${e.entity} ${e.local_id}` }, { label: 'Problem', key: 'error' }, { label: 'When', key: 'synced_at' }] })}</div></div>` : ''}`);

  $('[data-app]', view)?.addEventListener('submit', async e => {
    e.preventDefault();
    await PUT('/api/qbo/settings', Object.fromEntries(new FormData(e.target)));
    toast('Saved'); refresh();
  });
  $('[data-connect]', view)?.addEventListener('click', async () => { try { location.href = (await POST('/api/qbo/connect')).url; } catch (e) { toast(e.message, 'error'); } });
  $('[data-map]', view)?.addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    await PUT('/api/qbo/settings', { qbo_item_id: f.qbo_item_id?.value, qbo_tax_item_id: f.qbo_tax_item_id?.value, qbo_auto_sync: f.qbo_auto_sync.checked });
    toast('Saved');
  });
  $('[data-sync]', view)?.addEventListener('click', async e => {
    e.target.disabled = true;
    try { const r = await POST('/api/qbo/sync'); toast(`Synced ${r.invoices} invoices and ${r.payments} payments${r.errors.length ? ` — ${r.errors.length} problem(s)` : ''}`, r.errors.length ? 'error' : ''); refresh(); }
    catch (x) { toast(x.message, 'error'); e.target.disabled = false; }
  });
  $('[data-disc]', view)?.addEventListener('click', async () => {
    if (!(await confirmDialog('Disconnect QuickBooks? Nothing already sent is deleted; new changes stop syncing.', { okLabel: 'Disconnect', danger: true }))) return;
    await POST('/api/qbo/disconnect'); toast('Disconnected'); refresh();
  });
  const fmt = $('#fmt', view);
  fmt.addEventListener('change', () => { $('[data-help]', view).textContent = FORMATS.find(f => f[0] === fmt.value)[2]; });
  const s = await GET('/api/settings');
  $$('[data-acct]', view).forEach(i => { i.value = s[i.dataset.acct] || ''; });
  $('[data-exp]', view).addEventListener('submit', async e => {
    e.preventDefault();
    const acct = Object.fromEntries($$('[data-acct]', view).map(i => [i.dataset.acct, i.value]));
    await PUT('/api/qbo/settings', acct).catch(() => {});
    const q = new URLSearchParams(Object.fromEntries(new FormData(e.target)));
    location.href = `/api/accounting/export?${q}`;
  });
}
