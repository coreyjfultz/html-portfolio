import {
  html, mount, $, $$, money, fmtDate, fmtDateTime, badge, typeBadge, relDays, dataTable, openForm, promptForm, loading, toast, confirmDialog,
  openModal, signaturePad, resizeImage, pickPhotos,
} from '../ui.js';
import { R, POST, GET, api } from '../api.js';
import { can, refresh, state } from '../app.js';

const OPEN = 'new,scheduled,in progress,on hold';

export async function list(view, _, query) {
  const techs = await R.list('technicians', { active: 1 });
  const f = {
    group: query.status === 'completed' ? 'completed' : query.group || (can.tech() ? 'mine' : 'open'),
    priority: query.priority || '', technician_id: query.technician_id || '', q: '', uninvoiced: query.uninvoiced === '1',
  };
  mount(view, html`
    <div class="page-head"><div><h1>Service calls</h1><div class="sub">Work orders, installs, inspections and repairs</div></div>
      <div class="actions">${can.staff() ? html`<a class="btn" href="/api/export/service_calls">Export CSV</a>` : ''}<button class="btn primary" data-new>+ New service call</button></div></div>
    <div class="filters">
      <div class="seg" data-group>
        ${state.user.technician_id ? html`<button data-v="mine">My calls</button>` : ''}
        <button data-v="open">Open</button><button data-v="unassigned">Unassigned</button><button data-v="completed">Completed</button><button data-v="all">All</button></div>
      <select data-priority aria-label="Priority"><option value="">Any priority</option>${['emergency', 'high', 'normal', 'low'].map(p => html`<option value="${p}">${p}</option>`)}</select>
      <select data-tech aria-label="Technician"><option value="">All technicians</option>${techs.map(t => html`<option value="${t.id}">${t.name}</option>`)}</select>
      <input type="search" placeholder="Call #, summary…" data-q aria-label="Search calls">
      <label class="row small ${can.billing() ? '' : 'hidden'}"><input type="checkbox" data-uninv> Not invoiced</label>
    </div>
    <div class="card"><div class="card-body flush" data-table></div></div>`);
  $('[data-priority]', view).value = f.priority;
  $('[data-tech]', view).value = f.technician_id;
  $('[data-uninv]', view).checked = f.uninvoiced;
  const load = async () => {
    $$('[data-group] button', view).forEach(b => b.classList.toggle('on', b.dataset.v === f.group));
    const q = { q: f.q, priority: f.priority, technician_id: f.technician_id };
    if (f.group === 'open') q.status__in = OPEN;
    if (f.group === 'completed') q.status = 'completed';
    if (f.group === 'unassigned') { q.status__in = OPEN; q.technician_id__null = '1'; }
    if (f.group === 'mine') { q.status__in = OPEN; q.technician_id = state.user.technician_id; }
    if (f.uninvoiced) { q.status = 'completed'; q.billable = 1; q.invoice_id__null = '1'; delete q.status__in; }
    let rows = await R.list('service_calls', q);
    if (f.group === 'open' || f.group === 'mine') {
      const pr = { emergency: 0, high: 1, normal: 2, low: 3 };
      rows.sort((a, b) => (pr[a.priority] - pr[b.priority]) || (a.scheduled_start || '9').localeCompare(b.scheduled_start || '9'));
    }
    mount($('[data-table]', view), callsTable(rows));
  };
  $('[data-group]', view).addEventListener('click', e => { if (e.target.dataset.v) { f.group = e.target.dataset.v; f.uninvoiced = false; $('[data-uninv]', view).checked = false; load(); } });
  $('[data-priority]', view).addEventListener('change', e => { f.priority = e.target.value; load(); });
  $('[data-tech]', view).addEventListener('change', e => { f.technician_id = e.target.value; load(); });
  $('[data-uninv]', view).addEventListener('change', e => { f.uninvoiced = e.target.checked; load(); });
  let t;
  $('[data-q]', view).addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { f.q = e.target.value; load(); }, 250); });
  $('[data-new]', view).addEventListener('click', () => newCall());
  await load();
  if (query.new) newCall();
}

export function newCall(defaults = {}) {
  return openForm('service_calls', { defaults, onSaved: s => { location.hash = `#/calls/${s.id}`; } });
}

export function callsTable(rows, empty = 'No service calls match.') {
  return dataTable({
    rows, href: c => `#/calls/${c.id}`, empty,
    columns: [
      { label: 'Call', render: c => html`<b>SC-${c.number}</b>` },
      { label: 'Customer', render: c => html`${c.customer_id_label} ${typeBadge(c.customer_type)}<div class="small muted">${c.title}</div>` },
      { label: 'Type', render: c => html`${c.call_type}<div class="small muted">${c.system_type || ''}</div>` },
      { label: 'Priority', render: c => badge(c.priority) },
      { label: 'Technician', render: c => c.technician_id_label ? html`<span class="dot" style="background:${c.technician_color || '#64748b'}"></span> ${c.technician_id_label}` : html`<span class="muted">Unassigned</span>` },
      { label: 'Scheduled', render: c => c.scheduled_start ? html`${fmtDateTime(c.scheduled_start)}<div class="small muted">${relDays(c.scheduled_start)}</div>` : html`<span class="muted">—</span>` },
      { label: 'Status', render: c => html`${badge(c.status)}${c.invoice_id ? html` <span class="badge good">invoiced</span>` : ''}` },
    ],
  });
}

export async function detail(view, [id]) {
  loading(view);
  const office = can.billing();
  const c = await R.get('service_calls', id);
  const [cust, parts, messages] = await Promise.all([R.get('customers', c.customer_id), R.list('service_call_parts', { service_call_id: id }),
    GET('/api/notifications', { related_type: 'service_call', related_id: id }).catch(() => [])]);
  const reload = () => refresh();
  const partsBilled = parts.reduce((s, p) => s + p.qty * (p.unit_price || 0), 0);
  const partsCost = parts.reduce((s, p) => s + p.qty * (p.unit_cost || 0), 0);
  const laborBilled = (c.labor_hours || 0) * (c.labor_rate || 0);
  const closed = ['completed', 'cancelled'].includes(c.status);
  const addr = c.customer_address?.replace(/^, |, $/g, '');

  mount(view, html`
    <div class="crumbs"><a href="#/calls">Service calls</a> /</div>
    <div class="page-head"><div>
        <h1>SC-${c.number} · ${c.title}</h1>
        <div class="sub row">${badge(c.status)} ${badge(c.priority)} <span>${c.call_type} · ${c.system_type || ''}</span></div></div>
      <div class="actions">
        <button class="btn" data-edit>Edit</button>
        ${['new', 'scheduled', 'on hold'].includes(c.status) && c.technician_id ? html`<button class="btn" data-onway>🚗 On my way</button>` : ''}
        ${['new', 'scheduled', 'on hold', 'en route'].includes(c.status) ? html`<button class="btn" data-start>Start job</button>` : ''}
        ${can.staff() && c.scheduled_start && !closed ? html`<button class="btn ghost" data-resend title="Email/text the customer their appointment details again">Resend confirmation</button>` : ''}
        ${!closed ? html`<button class="btn primary" data-complete>Complete job</button>` : ''}
        ${c.status === 'completed' && !c.signed_by ? html`<button class="btn" data-sign>Get customer signature</button>` : ''}
        <button class="btn" data-jobchat title="Message about this job">💬 ${can.tech() ? 'Message the office' : 'Job chat'}</button>
        ${office && c.status === 'completed' && c.billable && !c.invoice_id ? html`<button class="btn primary" data-invoice>Create invoice</button>` : ''}
        ${office && c.invoice_id ? html`<a class="btn" href="#/invoices/${c.invoice_id}">View invoice ${c.invoice_id_label}</a>` : ''}
      </div></div>
    <div class="grid g3">
      <div class="card span2"><div class="card-head"><h2>Job details</h2></div><div class="card-body"><dl class="dl">
        <dt>Customer</dt><dd><a href="#/customers/${cust.id}">${cust.name}</a> ${typeBadge(cust.type)}</dd>
        <dt>Phone</dt><dd>${cust.phone ? html`<a href="tel:${cust.phone}" data-dial data-customer="${cust.id}" data-call="${c.id}">${cust.phone}</a>` : '—'}</dd>
        <dt>Address</dt><dd>${addr || '—'} ${addr ? html`<a class="small" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr)}">Directions ↗</a>` : ''}</dd>
        ${cust.access_notes ? html`<dt>Site access</dt><dd style="white-space:pre-wrap">${cust.access_notes}</dd>` : ''}
        <dt>Technician</dt><dd>${c.technician_id_label ? html`<span class="dot" style="background:${c.technician_color}"></span> ${c.technician_id_label}` : html`<span class="muted">Unassigned</span>`}</dd>
        <dt>Scheduled</dt><dd>${c.scheduled_start ? fmtDateTime(c.scheduled_start) : '—'} ${c.duration_hours ? html`<span class="muted">(${c.duration_hours} h est.)</span>` : ''}</dd>
        <dt>Problem / request</dt><dd style="white-space:pre-wrap">${c.description || '—'}</dd>
        ${c.status === 'completed' ? html`<dt>Completed</dt><dd>${fmtDateTime(c.completed_at)}</dd>
          <dt>Labor</dt><dd>${c.labor_hours ?? 0} h${office ? html` × ${money(c.labor_rate)}` : ''}</dd>
          <dt>Work performed</dt><dd style="white-space:pre-wrap">${c.resolution || '—'}</dd>
          ${c.no_parts_used ? html`<dt>Parts</dt><dd>Tech confirmed no parts were used</dd>` : ''}
          ${c.completion_override ? html`<dt>Rule override</dt><dd>${badge('override', 'warn')} ${c.completion_override}</dd>` : ''}` : ''}
        <dt>Billable</dt><dd>${c.billable ? 'Yes' : 'No (warranty / estimate / no charge)'}</dd>
        ${c.status === 'completed' && can.manage() ? html`<div data-survey style="display:contents"></div>` : ''}
        ${!c.signed_by && c.signature_waived ? html`<dt>Customer sign-off</dt><dd>${badge('not needed', 'info')} <span class="small muted">approved by ${c.signature_waived_by || 'the office'}</span></dd>` : ''}
        ${c.signed_by ? html`<dt>Customer sign-off</dt><dd><div class="sig-box"><img src="/api/service_calls/${c.id}/signature?v=${encodeURIComponent(c.signed_at)}" alt="Signature of ${c.signed_by}"></div>
          <div class="small muted">${c.signed_by} · ${fmtDateTime(c.signed_at)}</div></dd>` : ''}
      </dl>
      <div class="row" style="margin-top:14px"><a class="btn sm" href="#/customers/${cust.id}?tab=systems">View customer's systems & passwords</a></div>
      </div></div>
      ${office ? html`<div class="stack">
        <div class="kpi"><div class="label">Labor billed</div><div class="value">${money(laborBilled)}</div></div>
        <div class="kpi"><div class="label">Parts billed</div><div class="value">${money(partsBilled)}</div><div class="hint">Cost ${money(partsCost)}</div></div>
        <div class="kpi"><div class="label">Est. job profit</div><div class="value">${money(laborBilled + partsBilled - partsCost)}</div><div class="hint">Before labor cost</div></div>
      </div>` : html`<div></div>`}
      <div class="card span2"><div class="card-head"><div><h2>Parts & equipment used</h2><div class="small muted">Taken out of the truck or warehouse inventory automatically</div></div>
        <button class="btn sm" data-addpart>+ Add part</button></div>
        <div class="card-body flush">${dataTable({
          rows: parts, empty: 'No parts recorded.',
          columns: [
            { label: 'Item', render: p => p.item_id_label },
            { label: 'From', render: p => p.location_id_label || 'Warehouse' },
            { label: 'Qty', key: 'qty', cls: 'num' },
            ...(office ? [{ label: 'Price', render: p => money(p.unit_price), cls: 'num' }, { label: 'Line', render: p => money(p.qty * p.unit_price), cls: 'num' }] : []),
            { label: '', cls: 'actions-cell', render: p => html`<button class="btn sm ghost danger" data-rmpart="${p.id}" title="Remove and return to stock">Remove</button>` },
          ] })}</div></div>
      ${['inspection', 'maintenance'].includes(c.call_type) || /fire|sprinkler|extinguisher|suppression/.test(c.system_type || '') ? html`<div class="card span2" data-inspections-card></div>` : ''}
      <div class="card span2" data-equipment-card></div>
      <div class="card span2" data-materials-card></div>
      <div class="card" data-photos-card></div>
      <div class="card hidden" data-mon-card></div>
      <div class="card span2"><div class="card-head"><div><h2>Messages to customer & tech</h2><div class="small muted">Texts, emails and calendar invites sent for this job</div></div></div>
        <div class="card-body flush">${dataTable({
          rows: messages, empty: 'Nothing sent yet. Confirmations go out when the job is scheduled with a technician.',
          columns: [
            { label: 'When', render: m => m.created_at },
            { label: 'Type', render: m => m.channel === 'sms' ? '💬 Text' : '✉️ Email' },
            { label: 'To', render: m => m.to_addr || '—' },
            { label: 'Message', render: m => html`${m.subject ? html`<b>${m.subject}</b><br>` : ''}<span class="small" style="white-space:pre-wrap">${(m.body || '').slice(0, 220)}</span>` },
            { label: 'Status', render: m => html`${badge(m.status, m.status === 'sent' ? 'good' : m.status === 'failed' ? 'bad' : '')}${m.error ? html`<div class="small muted">${m.error}</div>` : ''}` },
          ] })}</div></div>
    </div>`);

  $('[data-edit]', view).addEventListener('click', () => openForm('service_calls', { record: c, onSaved: reload, onDeleted: () => { location.hash = '#/calls'; }, allowDelete: office }));
  $('[data-onway]', view)?.addEventListener('click', () => promptForm({
    title: 'Let the customer know you’re on the way',
    intro: html`<p class="muted" style="margin-top:0">${cust.name} gets a text${cust.email ? ' and email' : ''} (per their preferences).</p>`,
    fields: [{ name: 'eta_minutes', label: 'Arriving in about (minutes, optional)', type: 'number', value: '' }],
    submitLabel: 'Send “On my way”',
    onSubmit: async d => {
      try { await POST(`/api/service_calls/${id}/on-my-way`, d); } catch (e) { if (e.code === 'readiness_required') { readinessBlocked(e); return; } throw e; }
      toast('Customer notified'); setTimeout(reload, 800);
    },
  }));
  $('[data-resend]', view)?.addEventListener('click', async () => { await POST(`/api/service_calls/${id}/resend-confirmation`); toast('Confirmation sent'); setTimeout(reload, 800); });
  $('[data-start]', view)?.addEventListener('click', async () => {
    try { await R.update('service_calls', id, { status: 'in progress' }); toast('Job started'); reload(); }
    catch (e) { if (e.code === 'readiness_required') readinessBlocked(e); else toast(e.message, 'error'); }
  });
  $('[data-jobchat]', view)?.addEventListener('click', async () => {
    try { const r = await POST(`/api/service_calls/${id}/chat`); location.hash = `#/chat/${r.id}`; } catch (e) { toast(e.message, 'error'); }
  });
  $('[data-sign]', view)?.addEventListener('click', () => completeDialog(c, cust, { signOnly: true, onDone: reload }));
  drawPhotos($('[data-photos-card]', view), c);
  import('./truckstock.js').then(m => m.materialsCard($('[data-materials-card]', view), c));
  import('./equipment.js').then(m => m.jobEquipmentCard($('[data-equipment-card]', view), c));
  if ($('[data-survey]', view)) import('./ratings.js').then(m => m.jobSurveyBlock($('[data-survey]', view), c));
  if ($('[data-inspections-card]', view)) import('./inspections.js').then(m => m.reportsCard($('[data-inspections-card]', view), { customer_id: c.customer_id, service_call_id: c.id, site_id: c.site_id, title: 'Inspection reports for this job' }));
  drawMonitoring($('[data-mon-card]', view), c, reload);
  $('[data-complete]', view)?.addEventListener('click', () => completeDialog(c, cust, { office, partsCount: parts.length, onDone: reload }));
  $('[data-invoice]', view)?.addEventListener('click', async () => {
    const r = await POST(`/api/service_calls/${id}/invoice`);
    toast('Draft invoice created');
    location.hash = `#/invoices/${r.id}`;
  });
  $('[data-addpart]', view).addEventListener('click', () => openForm('service_call_parts', { defaults: { service_call_id: Number(id) }, hide: ['service_call_id', ...(office ? [] : ['unit_price'])], onSaved: reload }));
  $$('[data-rmpart]', view).forEach(b => b.addEventListener('click', async () => {
    if (!(await confirmDialog('Remove this part from the job? It will be returned to the stock location it came from.', { okLabel: 'Remove' }))) return;
    await R.del('service_call_parts', b.dataset.rmpart);
    toast('Part removed and returned to stock');
    reload();
  }));
}

function readinessBlocked(e) {
  confirmDialog(e.message, { okLabel: 'Go to start-of-day check' }).then(ok => { if (ok) location.hash = '#/myday'; });
}

// ------------------------------------------------------------------ photos
async function drawPhotos(card, c) {
  if (!card) return;
  const photos = await GET(`/api/service_calls/${c.id}/photos`).catch(() => []);
  const group = kind => photos.filter(p => p.kind === kind);
  const grid = (kind, label) => html`<div class="photo-group"><div class="small muted" style="margin-bottom:6px">${label} (${group(kind).length})</div>
    ${group(kind).length ? html`<div class="photo-grid">${group(kind).map(p => html`<figure class="photo">
        <a href="/api/photos/${p.id}" target="_blank" rel="noopener"><img src="/api/photos/${p.id}" alt="${p.caption || label + ' photo'}" loading="lazy"></a>
        <button class="photo-del" data-delphoto="${p.id}" title="Delete photo" aria-label="Delete photo">✕</button>
        ${p.caption ? html`<figcaption>${p.caption}</figcaption>` : ''}</figure>`)}</div>` : html`<div class="muted small">None yet</div>`}</div>`;
  mount(card, html`<div class="card-head"><div><h2>Photos</h2><div class="small muted">Before & after, saved with the job</div></div></div>
    <div class="card-body stack" style="gap:14px">
      <div class="row"><button class="btn sm" data-addphoto="before">📷 Before</button><button class="btn sm" data-addphoto="after">📷 After</button><button class="btn sm ghost" data-addphoto="other">+ Other</button></div>
      ${grid('before', 'Before')}${grid('after', 'After')}${group('other').length ? grid('other', 'Other') : ''}</div>`);
  card.querySelectorAll('[data-addphoto]').forEach(b => b.addEventListener('click', async () => {
    const files = await pickPhotos();
    if (!files.length) return;
    toast(`Uploading ${files.length} photo${files.length > 1 ? 's' : ''}…`);
    try {
      for (const f of files) await POST(`/api/service_calls/${c.id}/photos`, { kind: b.dataset.addphoto, data: await resizeImage(f) });
      toast('Photos saved');
    } catch (e) { toast(e.message, 'error'); }
    drawPhotos(card, c);
  }));
  card.querySelectorAll('[data-delphoto]').forEach(b => b.addEventListener('click', async () => {
    if (!(await confirmDialog('Delete this photo?', { okLabel: 'Delete', danger: true }))) return;
    try { await api('DELETE', `/api/photos/${b.dataset.delphoto}`); } catch (e) { toast(e.message, 'error'); }
    drawPhotos(card, c);
  }));
}

// ------------------------------------------------------------------ completion + signature
async function completeDialog(c, cust, { signOnly = false, office = false, partsCount = 0, onDone } = {}) {
  const photos = signOnly ? [] : await GET(`/api/service_calls/${c.id}/photos`).catch(() => []);
  const equipment = signOnly ? [] : await R.list('installed_equipment', { service_call_id: c.id }).catch(() => []);
  const eqPhotos = await Promise.all(equipment.map(e => GET(`/api/equipment/${e.id}/photos`).then(p => p.length).catch(() => 0)));
  const eqDone = equipment.filter((e, i) => e.serial_number && eqPhotos[i]).length;
  const nPhotos = kind => photos.filter(p => p.kind === kind).length;
  const check = (ok, label) => html`<li class="${ok ? 'ok' : 'todo'}"><span class="mark">${ok ? '✓' : '!'}</span> ${label}</li>`;
  const { el, close } = openModal({
    title: signOnly ? 'Customer sign-off' : 'Complete job',
    body: html`<div class="err-box hidden" data-err></div>
      ${signOnly ? '' : html`<ul class="checklist">
          ${check(nPhotos('before') > 0, `“Before” photos (${nPhotos('before')})`)}
          ${check(nPhotos('after') > 0, `“After” photos (${nPhotos('after')})`)}
          ${check(partsCount > 0, partsCount ? `Parts recorded (${partsCount})` : 'Parts recorded')}
          ${equipment.length ? check(eqDone === equipment.length, `Serial numbers & label photos (${eqDone} of ${equipment.length})`) : ''}
        </ul>
        ${partsCount ? '' : html`<label class="row small" style="margin:-4px 0 12px"><input type="checkbox" data-noparts> No parts or equipment were used on this job</label>`}
        <div class="field hidden" data-override style="margin-bottom:12px"><label for="cd_override">Override reason (recorded on the job)</label><input id="cd_override" type="text" placeholder="e.g. Customer would not allow photos inside"></div>
        <div class="form-grid">
        <div class="field"><label for="cd_hours">Labor hours</label><input id="cd_hours" type="number" step="0.25" value="${c.labor_hours ?? c.duration_hours ?? 1}"></div>
        <div class="field"></div>
        <div class="field full"><label for="cd_res">Work performed (shown to the customer)</label><textarea id="cd_res">${c.resolution || ''}</textarea></div></div>`}
      <div class="sign-area">
        <div class="row" style="justify-content:space-between"><b>Customer signature</b><button type="button" class="btn sm ghost" data-clear>Clear</button></div>
        <p class="small muted" style="margin:4px 0 8px">I confirm the work above was completed to my satisfaction.</p>
        <canvas class="sig-pad" data-pad aria-label="Sign here"></canvas>
        <div class="field" style="margin-top:10px"><label for="cd_name">Signer's name</label><input id="cd_name" type="text" value="${cust.contact_name || cust.name}" autocomplete="off"></div>
        ${signOnly ? '' : c.signature_waived ? html`<div class="note small" style="margin-top:8px">✔ No signature needed — approved by ${c.signature_waived_by || 'the office'}. Get one anyway if someone is there.</div>`
          : can.manage() ? html`<label class="check-row small" style="margin-top:8px"><input type="checkbox" data-nosig> <span>Nobody available to sign — I approve completing without a signature</span></label>`
          : html`<p class="small muted" style="margin:8px 0 0">The customer’s signature is required. If nobody is on site, ask the office to approve “Customer won’t be on site” on this job.</p>`}
      </div>`,
    foot: html`<button class="btn" data-close>Cancel</button><button class="btn primary" data-go>${signOnly ? 'Save signature' : 'Complete job'}</button>`,
  });
  const pad = signaturePad($('[data-pad]', el));
  $('[data-clear]', el).addEventListener('click', () => pad.clear());
  const err = $('[data-err]', el);
  let signedHere = false;
  $('[data-go]', el).addEventListener('click', async () => {
    const noSig = pad.isEmpty() && (c.signature_waived || $('[data-nosig]', el)?.checked);
    const name = $('#cd_name', el).value.trim();
    if (!noSig && pad.isEmpty()) { err.textContent = signOnly ? 'Please sign in the box.' : 'Have the customer sign in the box.'; err.classList.remove('hidden'); return; }
    $('[data-go]', el).disabled = true;
    try {
      // Signature first: completing checks that the customer signed.
      if (!noSig && !signedHere) { await POST(`/api/service_calls/${c.id}/signature`, { name, image: pad.toDataURL() }); signedHere = true; }
      if (!signOnly) {
        const approve = !c.signature_waived && $('[data-nosig]', el)?.checked && pad.isEmpty() ? `${$('#cd_override', el).value.trim() || 'Customer not available to sign'}` : $('#cd_override', el).value.trim();
        await R.update('service_calls', c.id, {
          status: 'completed', labor_hours: $('#cd_hours', el).value, resolution: $('#cd_res', el).value,
          no_parts_used: !!$('[data-noparts]', el)?.checked, override_reason: approve || undefined,
        });
      }
      close();
      toast(signOnly ? 'Signature saved' : noSig ? 'Job completed' : 'Job completed and signed');
      onDone?.();
    } catch (e) {
      err.textContent = e.message; err.classList.remove('hidden'); $('[data-go]', el).disabled = false;
      if (e.code === 'completion_rules') {
        if (e.canOverride) {
          $('[data-override]', el).classList.remove('hidden');
          err.textContent += ' As an administrator you can complete it anyway with a reason.';
          $('[data-go]', el).textContent = 'Complete anyway';
          $('#cd_override', el).focus();
        } else err.textContent += ' Close this, add them on the job page, then complete again (or ask the office to override).';
      }
    }
  });
}

// Monitoring accounts at this job's customer/site, so the tech can put them on test right here.
async function drawMonitoring(card, c, onDone) {
  if (!card) return;
  const rows = (await R.list('monitoring_accounts', { customer_id: c.customer_id }).catch(() => []))
    .filter(a => a.status !== 'cancelled' && (!c.site_id || !a.site_id || a.site_id === c.site_id));
  if (!rows.length) return;
  const m = await import('./monitoring.js');
  card.classList.remove('hidden');
  mount(card, html`<div class="card-head"><div><h2>Alarm monitoring</h2><div class="small muted">Put the system on test before working on it</div></div></div>
    <div class="card-body stack" style="gap:10px">${rows.map(a => html`<div class="row" style="justify-content:space-between">
      <div><a href="#/monitoring/${a.id}" class="mono"><b>${a.account_number || 'pending'}</b></a> ${m.mBadge(a.status)}<div class="small muted">${a.station_id_label}${a.status === 'on test' ? ` · until ${fmtDateTime(a.test_until)}` : ''}</div></div>
      ${a.status === 'on test' ? html`<button class="btn sm" data-off="${a.id}">Take off test</button>` : html`<button class="btn sm primary" data-on="${a.id}">Put on test</button>`}</div>`)}</div>`);
  card.querySelectorAll('[data-on]').forEach(b => b.addEventListener('click', async () => {
    const a = rows.find(x => x.id === Number(b.dataset.on));
    m.testDialog(a, await GET(`/api/monitoring/${a.id}/station`), onDone);
  }));
  card.querySelectorAll('[data-off]').forEach(b => b.addEventListener('click', async () => {
    const r = await POST(`/api/monitoring/${b.dataset.off}/test/clear`);
    toast(r.station_confirmed ? 'Off test' : 'Off test here — tell the station too'); onDone();
  }));
}
