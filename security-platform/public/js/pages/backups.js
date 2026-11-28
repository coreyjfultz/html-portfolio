// Settings → Backup & data (owner): local backups, off-site copies, history, recovery.
import { html, mount, $, $$, badge, dataTable, openModal, toast, confirmDialog } from '../ui.js';
import { GET, POST } from '../api.js';

const mb = n => n == null ? '—' : n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${(n / 1e6).toFixed(1)} MB`;
const when = t => t ? new Date(String(t).replace(' ', 'T')).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const nameDate = n => { const m = n.match(/(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : n; };
const PROVIDERS = [
  ['b2', 'Backblaze B2', 'https://s3.us-west-004.backblazeb2.com', 'Shown on the bucket page as “Endpoint”.'],
  ['s3', 'Amazon S3', 'https://s3.us-east-1.amazonaws.com', 'Use your bucket’s region.'],
  ['r2', 'Cloudflare R2', 'https://<account id>.r2.cloudflarestorage.com', 'R2 → Manage R2 API tokens shows the address.'],
  ['wasabi', 'Wasabi', 'https://s3.us-east-1.wasabisys.com', 'Use your bucket’s region.'],
  ['other', 'Other S3-compatible', 'https://…', ''],
];

export async function backupPane(pane, { settingsCards, wireSettingsCards }) {
  const [d, s] = await Promise.all([GET('/api/admin/backups'), GET('/api/settings')]);
  const redraw = () => backupPane(pane, { settingsCards, wireSettingsCards });
  const lastLocal = d.last.backup, lastOff = d.last.offsite, lastVerify = d.last.verify;
  const ageH = t => t ? (Date.now() - new Date(String(t).replace(' ', 'T'))) / 3600e3 : Infinity;
  const health = [];
  if (!lastLocal) health.push(['warn', 'No backup has been made yet. Click “Back up now”, or wait for tonight’s.']);
  else if (ageH(lastLocal.finished_at) > 48) health.push(['bad', `The last backup was ${when(lastLocal.finished_at)}. Backups may have stopped.`]);
  if (!d.encrypted) health.push(['warn', 'No backup password: backups aren’t encrypted, and off-site copies can’t be turned on.']);
  if (!d.offsite.enabled) health.push(['warn', 'No off-site copy: if this server is lost or broken into, the backups go with it.']);
  else if (!lastOff || ageH(lastOff.finished_at) > 48) health.push(['bad', 'No off-site copy in the last 2 days. Check the storage settings and use “Test connection”.']);
  if (d.offsite.enabled && (!lastVerify || ageH(lastVerify.finished_at) > 24 * 40)) health.push(['warn', 'No restore test in the last 40 days. Run one below.']);
  const good = !health.length;
  const prov = PROVIDERS.find(p => p[0] === (s.offsite_provider || 'b2')) || PROVIDERS[0];

  mount(pane, html`
    <div class="banner ${good ? 'good' : health.some(h => h[0] === 'bad') ? 'bad' : 'warn'}" style="margin-bottom:16px">
      ${good ? html`✅ Backups look healthy. Last backup ${when(lastLocal.finished_at)} (${mb(lastLocal.size)}) · off-site ${when(lastOff.finished_at)} · restore test ${when(lastVerify.finished_at)}.`
        : html`<b>Backups need attention</b><ul style="margin:6px 0 0 18px;padding:0">${health.map(h => html`<li>${h[1]}</li>`)}</ul>`}</div>
    ${settingsCards(s, [
      { title: 'Backups on this server', intro: html`<p class="small muted" style="margin-top:0">Every night: the database plus photos, signatures, invoices, HR documents and manuals, in one file.
          ${d.dir_from_env ? html`Folder set by BACKUP_DIR: <span class="mono">${d.dir}</span>.` : html`Saved in <span class="mono">${d.dir}</span>${d.free_bytes != null ? ` (${mb(d.free_bytes)} free)` : ''}. Use a second disk or network drive if the server has one.`}</p>`,
        fields: [
          ...(d.dir_from_env ? [] : [['backup_local_dir', 'Backup folder on the server (blank = default)', 'text', d.default_dir]]),
          ['backup_hour', 'Time of the nightly backup', 'select', [...Array(24).keys()].map(h => [String(h), new Date(2000, 0, 1, h).toLocaleTimeString('en-US', { hour: 'numeric' })])],
          ['backup_keep_daily', 'Keep every backup from the last … days', 'number'],
          ['backup_keep_weekly', 'Then one per week for … weeks', 'number'],
          ['backup_keep_monthly', 'And one per month for … months', 'number'],
          ...(d.passphrase_from_env ? [] : [['backup_passphrase', 'Backup password (12+ characters) — encrypts every backup', 'secret']]),
        ],
        note: html`<b>Write the backup password down</b> (password manager, plus a paper copy in a safe). It’s the only way to open a backup on a new server — nobody, including us, can recover it. Changing it later is fine; older backups still open.` },
      { title: 'Off-site copy', intro: html`<p class="small muted" style="margin-top:0">Each night’s backup is also uploaded, encrypted, to storage at a different company, and locked so nobody can delete it — not even someone who breaks into this server. ${d.offsite.from_env ? 'Set by OFFSITE_* environment variables.' : ''}</p>`,
        fields: d.offsite.from_env ? [] : [
          ['offsite_enabled', 'Upload every backup off-site', 'check'],
          ['offsite_provider', 'Storage company', 'select', PROVIDERS.map(p => [p[0], p[1]])],
          ['offsite_endpoint', `Storage address (S3 endpoint)${prov[3] ? ` — ${prov[3]}` : ''}`, 'text', prov[2]],
          ['offsite_bucket', 'Bucket name', 'text', 'e.g. acme-secureops-backups'],
          ['offsite_prefix', 'Folder in the bucket', 'text', 'secureops'],
          ['offsite_key_id', 'Key ID (application key ID / access key)', 'text'],
          ['offsite_secret', 'Secret key', 'secret'],
          ['offsite_lock_days', 'Lock each backup against deletion for … days (0 = no lock)', 'number'],
          ['offsite_lock_mode', 'Lock type', 'select', [['compliance', 'Compliance — nobody can delete early (recommended)'], ['governance', 'Governance — the storage account owner can override']]],
          ['offsite_region', 'Region (optional; worked out from the address)', 'text'],
        ],
        extra: html`<div class="row" style="margin-top:12px;flex-wrap:wrap"><button class="btn sm" data-testoff ${d.offsite.ready ? '' : 'disabled'}>Test connection</button>
            <button class="btn sm" data-listoff ${d.offsite.ready ? '' : 'disabled'}>Show off-site backups</button><a class="small" href="#" data-howto>How to set up storage</a></div>
          <div class="small" data-offresult style="margin-top:8px"></div>` },
    ])}
    <div class="card" style="margin-top:16px"><div class="card-head"><div><h2>Backups</h2><div class="small muted">Download one, send one off-site, test a restore, or bring back a customer that was deleted.</div></div>
      <div class="row"><button class="btn sm" data-verify>Run a restore test</button><button class="btn sm primary" data-now>Back up now</button></div></div>
      <div class="card-body flush">${dataTable({
        rows: d.backups, empty: 'No backups yet.',
        columns: [
          { label: 'Backup', render: b => html`<b>${nameDate(b.name)}</b><div class="small muted mono">${b.name}</div>` },
          { label: 'Type', render: b => html`${(b.reason || '').startsWith('manual') ? 'manual' : b.reason || ''}${b.format === 'folder' ? html` ${badge('older format', '')}` : ''}` },
          { label: 'Size', cls: 'num', render: b => mb(b.size) },
          { label: 'Protection', render: b => b.encrypted ? badge('encrypted', 'good') : badge('not encrypted', 'warn') },
          { label: '', cls: 'actions-cell', render: b => html`<div class="row" style="justify-content:flex-end;flex-wrap:wrap;gap:4px">
            ${b.format === 'file' ? html`<a class="btn sm ghost" href="/api/admin/backups/${b.name}/download">Download</a>` : ''}
            ${d.offsite_names.includes(b.name) ? html`<span class="small" style="color:var(--good)">✓ off-site</span>` : b.format === 'file' && b.encrypted && d.offsite.ready ? html`<button class="btn sm ghost" data-up="${b.name}">Send off-site</button>` : ''}
            <button class="btn sm ghost" data-recover="${b.name}">Recover a customer…</button></div>` },
        ] })}</div></div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><div class="card-head"><h2>History</h2></div><div class="card-body flush">${dataTable({
        rows: d.runs.slice(0, 15), empty: 'Nothing yet.',
        columns: [
          { label: 'When', render: r => when(r.finished_at) },
          { label: 'What', render: r => ({ backup: 'Backup', offsite: 'Off-site upload', verify: 'Restore test' })[r.kind] || r.kind },
          { label: 'Result', render: r => html`${badge(r.status === 'ok' ? 'ok' : 'failed', r.status === 'ok' ? 'good' : 'bad')}<div class="small muted" style="max-width:340px;overflow-wrap:anywhere">${r.detail || ''}</div>` },
        ] })}</div></div>
      <div class="card"><div class="card-head"><h2>If you need to restore everything</h2></div><div class="card-body small">
        <p style="margin-top:0"><b>On this server</b> (bad change, damaged data): stop the app, then<br><span class="mono">docker compose run --rm app npm run restore -- &lt;backup name&gt;</span><br>and start it again. The data that was there is kept aside, not deleted.</p>
        <p><b>On a new server</b> (this one is gone): install the app (deploy/GO-LIVE.md), put the off-site settings and the backup password in <span class="mono">.env</span> (OFFSITE_ENDPOINT, OFFSITE_BUCKET, OFFSITE_PREFIX, OFFSITE_KEY_ID, OFFSITE_SECRET, BACKUP_PASSPHRASE), then<br><span class="mono">docker compose run --rm app npm run restore -- --offsite latest</span></p>
        <p style="margin-bottom:0"><b>One customer deleted by mistake:</b> use “Recover a customer…” on a backup from before it happened. Nothing else is rolled back.</p></div></div>
    </div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h2>Export to spreadsheet</h2></div><div class="card-body">
      <p class="small muted" style="margin-top:0">CSV files open in Excel or Google Sheets. Passwords are never exported.</p>
      <div class="row" style="flex-wrap:wrap">${['customers', 'contacts', 'invoices', 'payments', 'expenses', 'service_calls', 'inventory_items', 'camera_systems', 'fire_systems', 'extinguishers', 'vehicles'].map(r => html`<a class="btn sm" href="/api/export/${r}">${r.replace(/_/g, ' ')}</a>`)}</div></div></div>`);

  wireSettingsCards(pane, redraw);
  const offBox = $('[data-offresult]', pane);
  $('select[name=offsite_provider]', pane)?.addEventListener('change', e => { const p = PROVIDERS.find(x => x[0] === e.target.value); const inp = $('input[name=offsite_endpoint]', pane); if (inp && p) inp.placeholder = p[2]; });
  $('[data-testoff]', pane)?.addEventListener('click', async e => {
    e.target.disabled = true; mount(offBox, html`<span class="muted">Testing…</span>`);
    try { const r = await POST('/api/admin/backups/test-offsite'); mount(offBox, html`<span style="color:var(--good)">✅ Connected (region ${r.region}). A test file was written and read back.</span>`); }
    catch (err) { mount(offBox, html`<span style="color:var(--bad)">${err.message}</span>`); }
    e.target.disabled = false;
  });
  $('[data-listoff]', pane)?.addEventListener('click', async e => {
    e.target.disabled = true; mount(offBox, html`<span class="muted">Loading…</span>`);
    try {
      const list = await GET('/api/admin/backups/offsite');
      const local = new Set(d.backups.map(b => b.name));
      mount(offBox, list.length ? html`<div class="stack" style="gap:4px">${list.slice(0, 30).map(o => html`<div class="row" style="justify-content:space-between"><span>${nameDate(o.name)} <span class="muted">${mb(o.size)}</span></span>${local.has(o.name) ? html`<span class="muted">also on this server</span>` : html`<button class="btn sm ghost" data-fetch="${o.name}">Copy to this server</button>`}</div>`)}</div>` : html`<span class="muted">No off-site backups yet.</span>`);
      $$('[data-fetch]', offBox).forEach(b => b.addEventListener('click', async () => { b.disabled = true; try { await POST(`/api/admin/backups/offsite/${b.dataset.fetch}/fetch`); toast('Copied to this server'); redraw(); } catch (err) { toast(err.message, 'error'); b.disabled = false; } }));
    } catch (err) { mount(offBox, html`<span style="color:var(--bad)">${err.message}</span>`); }
    e.target.disabled = false;
  });
  $('[data-howto]', pane)?.addEventListener('click', e => { e.preventDefault(); howTo(); });
  $('[data-now]', pane).addEventListener('click', async e => {
    e.target.disabled = true; e.target.textContent = 'Backing up…';
    try {
      const r = await POST('/api/admin/backups');
      toast(r.offsite?.error ? `Saved here (${mb(r.size)}), but the off-site upload failed: ${r.offsite.error}` : `Backup saved (${mb(r.size)})${r.offsite ? ' and sent off-site' : ''}`, r.offsite?.error ? 'error' : '');
    } catch (err) { toast(err.message, 'error'); }
    redraw();
  });
  $('[data-verify]', pane).addEventListener('click', async e => {
    e.target.disabled = true; e.target.textContent = 'Testing…';
    try { const r = await POST('/api/admin/backups/verify', { offsite: d.offsite.ready }); toast(`Restore test passed: ${r.name} — ${r.counts.customers ?? 0} customers, ${r.files} files`); }
    catch (err) { toast(err.message, 'error'); }
    redraw();
  });
  $$('[data-up]', pane).forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await POST(`/api/admin/backups/${b.dataset.up}/upload`); toast('Sent off-site'); } catch (err) { toast(err.message, 'error'); }
    redraw();
  }));
  $$('[data-recover]', pane).forEach(b => b.addEventListener('click', () => recoverDialog(b.dataset.recover)));
}

async function recoverDialog(name) {
  const { el, close } = openModal({ title: 'Recover a deleted customer', size: 'sm', body: html`<div class="muted">Opening the backup…</div>`, foot: html`<button class="btn" data-close>Close</button>` });
  const body = $('.modal-body', el) || el;
  try {
    const list = await GET(`/api/admin/backups/${name}/deleted-customers`);
    mount(body, html`<p class="small muted" style="margin-top:0">Customers in the backup from ${nameDate(name)} that have since been deleted. Recovering one brings back its sites, contacts, systems, passwords, jobs, invoices and photos, without changing anything else.</p>
      ${list.length ? html`<div class="stack" style="gap:6px">${list.map(c => html`<div class="row" style="justify-content:space-between"><span><b>${c.name}</b><span class="small muted"> ${[c.type, c.city].filter(Boolean).join(' · ')}</span></span><button class="btn sm primary" data-rc="${c.id}" data-n="${c.name}">Recover</button></div>`)}</div>`
        : html`<div class="muted">No customers have been deleted since this backup.</div>`}`);
    $$('[data-rc]', body).forEach(b => b.addEventListener('click', async () => {
      if (!(await confirmDialog(`Bring back ${b.dataset.n} from this backup?`, { okLabel: 'Recover' }))) return;
      try {
        const r = await POST(`/api/admin/backups/${name}/recover`, { customer_id: Number(b.dataset.rc) });
        close();
        toast(`${r.name} recovered (${Object.entries(r.restored).map(([t, n]) => `${n} ${t.replace(/_/g, ' ')}`).join(', ')}${r.files ? `, ${r.files} files` : ''})`);
        location.hash = `#/customers/${b.dataset.rc}`;
      } catch (err) { toast(err.message, 'error'); }
    }));
  } catch (err) { mount(body, html`<div class="err-box">${err.message}</div>`); }
}

function howTo() {
  openModal({
    title: 'Setting up off-site storage', size: 'sm',
    body: html`<div class="small">
      <p style="margin-top:0"><b>Backblaze B2</b> (inexpensive and simple; Amazon S3, Cloudflare R2 and Wasabi work the same way):</p>
      <ol style="padding-left:18px">
        <li>Create a Backblaze account with a company email and turn on two-step sign-in.</li>
        <li><b>Buckets → Create a bucket</b>: private, <b>Object Lock: enabled</b>. (It can only be turned on when the bucket is made.)</li>
        <li><b>Lifecycle settings</b>: keep only the last version, delete after e.g. 400 days. This is what removes old backups — the app never deletes anything off-site.</li>
        <li><b>Application keys → Add a new key</b>: only this bucket, with <b>read and write, but no delete</b> permission if offered. Copy the key ID and key (shown once).</li>
        <li>Paste the bucket’s endpoint, bucket name, key ID and key here, set a backup password, tick “Upload every backup off-site”, Save, then <b>Test connection</b>.</li>
      </ol>
      <p>Keep the storage account’s password and the backup password somewhere other than this server.</p></div>`,
    foot: html`<button class="btn primary" data-close>Got it</button>`,
  });
}
