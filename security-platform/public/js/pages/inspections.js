// Fire inspection reports: list, the phone-friendly form, completion and sending.
import { html, raw, mount, $, $$, fmtDate, badge, dataTable, openForm, openModal, promptForm, loading, toast, confirmDialog, signaturePad, todayStr } from '../ui.js';
import { R, GET, POST, PUT, api } from '../api.js';
import { can, refresh } from '../app.js';
import { REPORT_TYPES, DEVICE_TYPES, UNIT_RESULTS, UNIT_SERVICES, deficiencies, unanswered } from '../inspections.js';
import { renderInspectionReport } from '../doc.js';

const RESULT_BADGE = { pass: 'good', deficiencies: 'warn', fail: 'bad' };
const STATUS_BADGE = { draft: 'warn', completed: 'info', sent: 'good' };
const showErr = (el, e) => { const b = $('[data-err]', el); b.textContent = e.message; b.classList.remove('hidden'); };

// ---------------------------------------------------------------- list (#/inspections)
export async function list(view, _, query) {
  loading(view);
  const rows = await GET('/api/inspections', query.customer_id ? { customer_id: query.customer_id } : {});
  const f = { status: query.status || '', type: '' };
  mount(view, html`<div class="page-head"><div><h1>Fire inspections</h1><div class="sub">Fire alarm, sprinkler, kitchen and special-hazard suppression, extinguishers and emergency lighting reports</div></div>
      <div class="actions"><button class="btn primary" data-new>+ New inspection</button></div></div>
    <div class="kpis">
      <div class="kpi ${rows.some(r => r.status === 'draft') ? 'alert' : ''}"><div class="label">In progress</div><div class="value">${rows.filter(r => r.status === 'draft').length}</div></div>
      <div class="kpi"><div class="label">Completed, not sent</div><div class="value">${rows.filter(r => r.status === 'completed').length}</div></div>
      <div class="kpi"><div class="label">With deficiencies (12 mo)</div><div class="value">${rows.filter(r => ['deficiencies', 'fail'].includes(r.result) && r.inspection_date >= new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10)).length}</div></div>
    </div>
    <div class="filters"><select data-status aria-label="Status"><option value="">Any status</option><option value="draft">In progress</option><option value="completed">Completed</option><option value="sent">Sent</option></select>
      <select data-type aria-label="Type"><option value="">All types</option>${Object.entries(REPORT_TYPES).map(([k, t]) => html`<option value="${k}">${t.label}</option>`)}</select></div>
    <div class="card"><div class="card-body flush" data-table></div></div>`);
  $('[data-status]', view).value = f.status;
  const draw = () => mount($('[data-table]', view), dataTable({
    rows: rows.filter(r => (!f.status || r.status === f.status) && (!f.type || r.report_type === f.type)), href: r => `#/inspections/${r.id}`,
    empty: 'No inspection reports yet. Start one from a fire system on the customer’s Systems tab, from an inspection job, or with “New inspection”.',
    columns: [
      { label: 'Report', render: r => html`<b>FIR-${r.number}</b><div class="small muted">${fmtDate(r.inspection_date)}</div>` },
      { label: 'Customer', render: r => html`${r.customer}${r.site ? html`<div class="small muted">${r.site}</div>` : ''}` },
      { label: 'Type', render: r => html`${r.type_label}<div class="small muted">${r.frequency}</div>` },
      { label: 'Inspector', render: r => r.inspector_name || '—' },
      { label: 'Result', render: r => r.result ? badge(r.result_label, RESULT_BADGE[r.result]) : '—' },
      { label: 'Status', render: r => badge(r.status === 'draft' ? 'in progress' : r.status, STATUS_BADGE[r.status]) },
    ] }));
  $('[data-status]', view).addEventListener('change', e => { f.status = e.target.value; draw(); });
  $('[data-type]', view).addEventListener('change', e => { f.type = e.target.value; draw(); });
  $('[data-new]', view).addEventListener('click', () => startDialog({ customer_id: query.customer_id }));
  draw();
}

/** Choose what to inspect, create the draft, open it. */
export async function startDialog({ customer_id, site_id, service_call_id, fire_system_id } = {}) {
  const customers = customer_id ? [] : await R.list('customers', { status__not: 'cancelled' }).catch(() => R.list('customers'));
  const { el, close } = openModal({
    title: 'Start an inspection report', size: 'sm',
    body: html`<div class="err-box hidden" data-err></div>
      ${customer_id ? '' : html`<div class="field"><label for="ins_c">Customer</label><select id="ins_c"><option value="">Choose…</option>${customers.map(c => html`<option value="${c.id}">${c.name}</option>`)}</select></div>`}
      <div class="field" style="margin-top:10px"><label for="ins_w">What are you inspecting?</label><select id="ins_w" disabled><option>Choose a customer first</option></select></div>
      <div class="field" style="margin-top:10px"><label for="ins_d">Inspection date</label><input id="ins_d" type="date" value="${todayStr()}"></div>`,
    foot: html`<button class="btn" data-close>Cancel</button><button class="btn primary" data-go>Start</button>`,
  });
  const what = $('#ins_w', el);
  const fill = async cid => {
    if (!cid) return;
    const systems = await R.list('fire_systems', { customer_id: cid });
    mount(what, html`${systems.map(s => html`<option value="sys:${s.id}" ${s.id === Number(fire_system_id) ? raw('selected') : ''}>${s.location || s.system_type} — ${s.system_type}${s.site_id_label ? ` (${s.site_id_label.split(' — ')[0]})` : ''}</option>`)}
      <option value="type:extinguishers" ${!fire_system_id && !systems.length ? raw('selected') : ''}>Fire extinguishers (walk-through of every unit)</option>
      ${Object.entries(REPORT_TYPES).filter(([k]) => k !== 'extinguishers').map(([k, t]) => html`<option value="type:${k}">${t.label} — not on file yet</option>`)}`);
    what.disabled = false;
  };
  if (customer_id) fill(customer_id);
  $('#ins_c', el)?.addEventListener('change', e => fill(e.target.value));
  $('[data-go]', el).addEventListener('click', async () => {
    const cid = customer_id || $('#ins_c', el)?.value;
    const [kind, val] = (what.value || '').split(':');
    if (!cid || !kind) return showErr(el, new Error('Choose the customer and what you’re inspecting'));
    try {
      const r = await POST('/api/inspections', { customer_id: cid, site_id, service_call_id, inspection_date: $('#ins_d', el).value, ...(kind === 'sys' ? { fire_system_id: val } : { report_type: val }) });
      close(); location.hash = `#/inspections/${r.id}`;
    } catch (e) { showErr(el, e); }
  });
}

// ---------------------------------------------------------------- detail (#/inspections/:id)
export async function detail(view, [id]) {
  loading(view);
  const d = await GET(`/api/inspections/${id}`);
  if (d.status === 'draft') return form(view, d);
  return showReport(view, d);
}

function showReport(view, d) {
  const manage = can.manage();
  mount(view, html`<div class="crumbs no-print"><a href="#/inspections">Fire inspections</a> / <a href="#/customers/${d.customer_id}?tab=systems">${d.customer.name}</a> /</div>
    <div class="page-head no-print"><div><h1>FIR-${d.number} ${badge(d.result_label, RESULT_BADGE[d.result])}</h1>
      <div class="sub">${d.type_label} · ${fmtDate(d.inspection_date)}${d.sent_at ? ` · sent to ${d.sent_to}` : ' · not sent yet'}</div></div>
      <div class="actions"><button class="btn" data-print>Print / PDF</button>
        ${manage ? html`<button class="btn" data-reopen>Reopen</button>` : ''}
        ${d.followup_call_id ? html`<a class="btn" href="#/calls/${d.followup_call_id}">Follow-up job</a>` : ''}
        <button class="btn primary" data-send>${d.sent_at ? 'Send again' : 'Send report'}</button></div></div>
    ${d.reopened_reason ? html`<div class="note no-print" style="margin-bottom:12px">Reopened earlier — ${d.reopened_reason}</div>` : ''}
    <div class="doc-frame">${renderInspectionReport(d, { signatureUrl: d.signed_by ? `/api/inspections/${d.id}/signature` : null, logoUrl: d.company.logo ? '/api/public/logo' : null })}</div>`);
  $('[data-print]', view).addEventListener('click', () => window.print());
  $('[data-send]', view).addEventListener('click', () => promptForm({
    title: `Send FIR-${d.number}`,
    intro: html`<p class="muted" style="margin-top:0">They get an email with the summary and a private link to view or print the full report.</p>`,
    fields: [
      { name: 'customer', label: 'Customer email', type: 'email', value: d.contact_email || d.customer.email || '' },
      { name: 'ahj', label: `Fire marshal / AHJ email${d.ahj ? ` (${d.ahj})` : ''}`, type: 'email', value: d.ahj_email || '' },
      { name: 'other', label: 'Also send to (optional)', type: 'email', value: '' },
    ],
    submitLabel: 'Send',
    onSubmit: async x => { const r = await POST(`/api/inspections/${d.id}/send`, { to: [x.customer, x.ahj, x.other].filter(Boolean) }); toast(`Sent to ${r.to.join(', ')}`); refresh(); },
  }));
  $('[data-reopen]', view)?.addEventListener('click', () => promptForm({
    title: 'Reopen this report', intro: html`<p class="muted" style="margin-top:0">It goes back to “in progress” so it can be corrected. The reason is kept on the report and in the activity log. Dates already updated on the systems stay as they are.</p>`,
    fields: [{ name: 'reason', label: 'Reason', type: 'text', required: true }], submitLabel: 'Reopen',
    onSubmit: async x => { await POST(`/api/inspections/${d.id}/reopen`, x); toast('Reopened'); refresh(); },
  }));
}

function form(view, d) {
  const t = d.template;
  const st = { checklist: { ...d.checklist }, devices: d.devices.map(x => ({ ...x })), units: d.units.map(x => ({ ...x })), custom_items: [...d.custom_items] };
  const seg = (name, value, opts) => html`<span class="seg" role="radiogroup">${Object.entries(opts).map(([v, l]) => html`<label class="${v}"><input type="radio" name="${name}" value="${v}" ${value === v ? raw('checked') : ''}> ${l}</label>`)}</span>`;
  const PFN = { pass: 'Pass', fail: 'Fail', na: 'N/A' };
  const itemRow = i => {
    const a = st.checklist[i.id] || {};
    return html`<div class="ir-item ${a.r === 'fail' ? 'failed' : ''}" data-item="${i.id}">
      <div class="ir-q">${i.text}</div>
      ${i.kind === 'value' ? html`<div class="row"><input type="text" data-v value="${a.v || ''}" placeholder="${i.placeholder || ''}" aria-label="${i.text}" style="flex:1;min-width:140px"><label class="row small"><input type="checkbox" data-na ${a.r === 'na' ? raw('checked') : ''}> N/A</label></div>`
        : seg(`ci_${i.id}`, a.r, PFN)}
      <input type="text" class="ir-note ${a.r === 'fail' || a.note ? '' : 'hidden'}" data-note value="${a.note || ''}" placeholder="What's wrong / what was done" aria-label="Note for ${i.text}"></div>`;
  };
  const sections = [...new Set(d.items.map(i => i.section))];
  mount(view, html`<div class="crumbs"><a href="#/inspections">Fire inspections</a> / <a href="#/customers/${d.customer_id}?tab=systems">${d.customer.name}</a> /</div>
    <div class="page-head"><div><h1>FIR-${d.number} ${badge('in progress', 'warn')}</h1><div class="sub">${d.type_label}${d.standard ? ` (${d.standard})` : ''} · ${d.customer.name}${d.site ? ` — ${d.site.name}` : ''}${d.system ? ` · ${d.system.location || d.system.system_type}` : ''}</div></div>
      <div class="actions"><span class="small muted" data-saved>Saved</span>${can.manage() ? html`<button class="btn ghost danger" data-del>Delete draft</button>` : ''}<button class="btn primary" data-complete>Complete…</button></div></div>
    ${d.reopened_reason ? html`<div class="note" style="margin-bottom:12px">Reopened — ${d.reopened_reason}</div>` : ''}
    <div class="stack ir-form">
      <div class="card"><div class="card-head"><h2>Details</h2></div><div class="card-body"><div class="form-grid" data-fields>
        <div class="field"><label for="f_date">Inspection date</label><input id="f_date" type="date" name="inspection_date" value="${d.inspection_date}"></div>
        <div class="field"><label for="f_freq">Frequency</label><select id="f_freq" name="frequency">${t.frequencies.map(f => html`<option ${f === d.frequency ? raw('selected') : ''}>${f}</option>`)}</select></div>
        <div class="field"><label for="f_insp">Inspector</label><input id="f_insp" type="text" name="inspector_name" value="${d.inspector_name || ''}"></div>
        <div class="field"><label for="f_lic">License / certification #</label><input id="f_lic" type="text" name="inspector_license" value="${d.inspector_license || ''}"></div>
        <div class="field"><label for="f_ahj">AHJ (fire marshal)</label><input id="f_ahj" type="text" name="ahj" value="${d.ahj || ''}"></div>
        <div class="field"><label for="f_ahje">AHJ email</label><input id="f_ahje" type="email" name="ahj_email" value="${d.ahj_email || ''}"></div>
        <div class="field"><label for="f_cn">Customer contact</label><input id="f_cn" type="text" name="contact_name" value="${d.contact_name || ''}"></div>
        <div class="field"><label for="f_ce">Contact email</label><input id="f_ce" type="email" name="contact_email" value="${d.contact_email || ''}"></div>
      </div></div></div>
      ${sections.map(sec => html`<div class="card" data-section="${sec}"><div class="card-head"><h2>${sec}</h2><button class="btn sm ghost" data-allpass>All pass</button></div>
        <div class="card-body stack" style="gap:8px">${d.items.filter(i => i.section === sec).map(itemRow)}</div></div>`)}
      ${t.custom ? html`<div class="card"><div class="card-head"><h2>Add a checklist item</h2></div><div class="card-body row"><input type="text" data-newitem placeholder="e.g. Fire pump churn test — suction / discharge psi" style="flex:1"><button class="btn sm" data-additem>Add</button></div></div>` : ''}
      ${t.devices ? html`<div class="card"><div class="card-head"><div><h2>Devices</h2><div class="small muted" data-devsum></div></div>
        <div class="row"><button class="btn sm ghost" data-devall>Mark untested as pass</button><button class="btn sm" data-devadd>+ Device</button></div></div>
        <div class="card-body stack" style="gap:8px" data-devices></div></div>` : ''}
      ${t.units ? html`<div class="card"><div class="card-head"><div><h2>Extinguishers</h2><div class="small muted">Check each: ${t.unitChecks.join(' · ')}</div></div>
        <div class="row"><button class="btn sm ghost" data-unitall>Mark unanswered as pass</button><button class="btn sm" data-unitadd>+ Extinguisher</button></div></div>
        <div class="card-body stack" style="gap:8px" data-units></div></div>` : ''}
      <div class="card"><div class="card-head"><h2>Recommendations & notes</h2></div><div class="card-body stack" style="gap:10px">
        <div class="field"><label for="f_rec">Recommendations (printed on the report)</label><textarea id="f_rec" name="recommendations" data-text>${d.recommendations || ''}</textarea></div>
        <div class="field"><label for="f_notes">Notes</label><textarea id="f_notes" name="notes" data-text>${d.notes || ''}</textarea></div></div></div>
      <div class="row" style="justify-content:flex-end"><button class="btn primary lg" data-complete2>Complete inspection…</button></div>
    </div>`);

  // ---- saving (debounced)
  let timer = null, saving = Promise.resolve();
  const savedEl = $('[data-saved]', view);
  const save = (extra = {}) => {
    savedEl.textContent = 'Saving…';
    clearTimeout(timer);
    return new Promise(res => {
      timer = setTimeout(() => {
        const fields = Object.fromEntries($$('[data-fields] [name], [data-text]', view).map(i => [i.name, i.value]));
        saving = PUT(`/api/inspections/${d.id}`, { ...fields, ...st, ...extra })
          .then(() => { savedEl.textContent = 'Saved'; })
          .catch(e => { savedEl.textContent = 'Not saved'; toast(e.message, 'error'); })
          .finally(res);
      }, 600);
    });
  };
  $$('[data-fields] [name], [data-text]', view).forEach(i => i.addEventListener('change', () => save()));

  // ---- checklist
  const readItem = row => {
    const id = row.dataset.item;
    const a = { ...(st.checklist[id] || {}) };
    const r = $('input[type=radio]:checked', row)?.value;
    if (r) a.r = r;
    if ($('[data-v]', row)) { a.v = $('[data-v]', row).value; a.r = $('[data-na]', row).checked ? 'na' : ''; }
    a.note = $('[data-note]', row).value;
    st.checklist[id] = a;
    row.classList.toggle('failed', a.r === 'fail');
    $('[data-note]', row).classList.toggle('hidden', !(a.r === 'fail' || a.note));
    if (a.r === 'fail' && !a.note) $('[data-note]', row).focus();
  };
  $$('[data-item]', view).forEach(row => row.addEventListener('change', () => { readItem(row); save(); }));
  $$('[data-allpass]', view).forEach(b => b.addEventListener('click', () => {
    const card = b.closest('[data-section]');
    $$('[data-item]', card).forEach(row => { const p = $('input[value=pass]', row); if (p && !$('input[type=radio]:checked', row)) { p.checked = true; readItem(row); } });
    save();
  }));
  $('[data-additem]', view)?.addEventListener('click', async () => {
    const text = $('[data-newitem]', view).value.trim();
    if (!text) return;
    st.custom_items.push({ id: `c_${Date.now().toString(36).slice(-8)}`, text, kind: 'pf' });
    await save(); detail(view, [d.id]);
  });

  // ---- devices
  const devBox = $('[data-devices]', view);
  const drawDevices = () => {
    if (!devBox) return;
    const n = st.devices.length, p = st.devices.filter(x => x.result === 'pass').length, f = st.devices.filter(x => x.result === 'fail').length;
    $('[data-devsum]', view).textContent = n ? `${n} devices · ${p} passed · ${f} failed · ${n - p - f - st.devices.filter(x => x.result === 'na').length} to test` : 'Add each device as you test it. Next year’s report starts with this list.';
    mount(devBox, html`${st.devices.map((x, i) => html`<div class="ir-dev ${x.result === 'fail' ? 'failed' : ''}" data-dev="${i}">
      <select data-k="type" aria-label="Device type">${DEVICE_TYPES.map(o => html`<option ${o === x.type ? raw('selected') : ''}>${o}</option>`)}</select>
      <input type="text" data-k="location" value="${x.location}" placeholder="Location" aria-label="Location">
      <input type="text" data-k="address" value="${x.address || ''}" placeholder="Address / zone" aria-label="Address" class="ir-addr">
      ${seg(`dv_${i}`, x.result, PFN)}
      <button class="btn sm ghost danger" data-devrm="${i}" aria-label="Remove device">✕</button>
      <input type="text" data-k="note" value="${x.note || ''}" placeholder="Note" class="ir-note ${x.result === 'fail' || x.note ? '' : 'hidden'}" aria-label="Note"></div>`)}`);
    $$('[data-dev]', devBox).forEach(row => row.addEventListener('change', () => {
      const x = st.devices[Number(row.dataset.dev)];
      $$('[data-k]', row).forEach(i => { x[i.dataset.k] = i.value; });
      x.result = $('input[type=radio]:checked', row)?.value || x.result;
      save(); drawDevices();
    }));
    $$('[data-devrm]', devBox).forEach(b => b.addEventListener('click', () => { st.devices.splice(Number(b.dataset.devrm), 1); save(); drawDevices(); }));
  };
  $('[data-devadd]', view)?.addEventListener('click', () => {
    const lastType = st.devices.at(-1)?.type || DEVICE_TYPES[0];
    st.devices.push({ type: lastType, location: '', address: '', result: '', note: '' });
    drawDevices();
    $$('[data-dev] [data-k=location]', devBox).at(-1)?.focus();
  });
  $('[data-devall]', view)?.addEventListener('click', () => { st.devices.forEach(x => { if (!x.result) x.result = 'pass'; }); save(); drawDevices(); });
  drawDevices();

  // ---- extinguishers
  const unitBox = $('[data-units]', view);
  const drawUnits = () => {
    if (!unitBox) return;
    mount(unitBox, st.units.length ? html`${st.units.map((u, i) => html`<div class="ir-unit ${['fail', 'missing'].includes(u.result) ? 'failed' : ''}" data-unit="${i}">
      <div class="row" style="justify-content:space-between"><div><b>${u.label || 'Extinguisher'}</b><div class="small muted">${u.location}</div></div>
        <div class="row">${u.due.map(x => badge(`${x} due`, 'warn'))}${u.replace_due ? badge('replace (12 yr)', 'bad') : ''}</div></div>
      ${seg(`un_${i}`, u.result, UNIT_RESULTS)}
      ${!['removed', 'missing'].includes(u.result) ? html`<div class="row small">${Object.entries(UNIT_SERVICES).map(([k, l]) => html`<label class="row"><input type="checkbox" data-svc="${k}" ${u.services.includes(k) ? raw('checked') : ''}> ${l}</label>`)}</div>` : ''}
      ${u.result === 'replaced' ? html`<div class="row"><input type="text" data-k="new_serial" value="${u.new_serial || ''}" placeholder="New serial #" aria-label="New serial"><label class="small">New unit made <input type="date" data-k="new_manufacture_date" value="${u.new_manufacture_date || ''}"></label></div>` : ''}
      <input type="text" data-k="note" value="${u.note || ''}" placeholder="Note" class="ir-note ${['fail', 'missing'].includes(u.result) || u.note ? '' : 'hidden'}" aria-label="Note"></div>`)}`
      : html`<div class="muted">No extinguishers on file for this customer. Add them with “+ Extinguisher”.</div>`);
    $$('[data-unit]', unitBox).forEach(row => row.addEventListener('change', () => {
      const u = st.units[Number(row.dataset.unit)];
      u.result = $('input[type=radio]:checked', row)?.value || u.result;
      u.services = $$('[data-svc]', row).filter(c => c.checked).map(c => c.dataset.svc);
      $$('[data-k]', row).forEach(i => { u[i.dataset.k] = i.value; });
      save(); drawUnits();
    }));
  };
  $('[data-unitall]', view)?.addEventListener('click', () => { st.units.forEach(u => { if (!u.result) u.result = 'pass'; }); save(); drawUnits(); });
  $('[data-unitadd]', view)?.addEventListener('click', () => openForm('extinguishers', {
    defaults: { customer_id: d.customer_id, site_id: d.site_id }, hide: ['customer_id', 'status'],
    onSaved: async () => { await save(); await saving; const fresh = await POST(`/api/inspections/${d.id}/refresh-units`); st.units = fresh.units; drawUnits(); },
  }));
  drawUnits();

  // ---- complete
  const complete = async () => {
    await save(); await saving;
    const cur = { ...d, ...st };
    const missing = unanswered(cur);
    const defs = deficiencies(cur);
    const { el, close } = openModal({
      title: `Complete FIR-${d.number}`,
      body: html`<div class="err-box hidden" data-err></div>
        ${missing.length ? html`<div class="err-box">Still to answer (${missing.length}):<ul style="margin:6px 0 0;padding-left:18px">${missing.slice(0, 8).map(m => html`<li>${m}</li>`)}</ul>${missing.length > 8 ? html`…and ${missing.length - 8} more` : ''}</div>`
        : html`<div class="ir-result ${defs.length ? 'warn' : 'pass'}" style="margin-top:0"><span>Result</span><b>${defs.length ? `${defs.length} deficienc${defs.length === 1 ? 'y' : 'ies'}` : 'Pass'}</b></div>
          ${defs.length ? html`<ol class="ir-defs small">${defs.map(x => html`<li>${x.what}${x.note ? ` — ${x.note}` : ''}</li>`)}</ol>
            <div class="field" style="margin-top:10px"><label for="c_res">Overall</label><select id="c_res"><option value="deficiencies">Deficiencies found — system in service</option><option value="fail">Fail — impairment (system not reliable)</option></select></div>
            <label class="check-row" style="margin-top:10px"><input type="checkbox" data-follow checked> <span>Create a follow-up job to correct the deficiencies</span></label>` : ''}
          <div class="sign-area" style="margin-top:14px">
            <div class="row" style="justify-content:space-between"><b>Customer representative</b><button type="button" class="btn sm ghost" data-clear>Clear</button></div>
            <canvas class="sig-pad" data-pad aria-label="Sign here"></canvas>
            <div class="field" style="margin-top:10px"><label for="c_name">Name</label><input id="c_name" type="text" value="${d.contact_name || ''}" autocomplete="off"></div>
            <label class="check-row" style="margin-top:8px"><input type="checkbox" data-nosig> <span>Nobody available to sign</span></label></div>
          <p class="small muted">Completing locks the report and updates the system’s and each extinguisher’s service dates.</p>`}`,
      foot: html`<button class="btn" data-close>${missing.length ? 'Keep working' : 'Cancel'}</button>${missing.length ? '' : html`<button class="btn primary" data-go>Complete</button>`}`,
    });
    if (missing.length) return;
    const pad = signaturePad($('[data-pad]', el));
    $('[data-clear]', el).addEventListener('click', () => pad.clear());
    $('[data-go]', el).addEventListener('click', async () => {
      const noSig = $('[data-nosig]', el).checked;
      if (!noSig && pad.isEmpty()) return showErr(el, new Error('Have the customer sign, or tick “Nobody available to sign”.'));
      $('[data-go]', el).disabled = true;
      try {
        const r = await POST(`/api/inspections/${d.id}/complete`, {
          result: $('#c_res', el)?.value, create_followup: !!$('[data-follow]', el)?.checked,
          ...(noSig ? {} : { signed_by: $('#c_name', el).value, signature: pad.toDataURL() }),
        });
        close(); toast(r.followup_call_id ? 'Report completed — follow-up job created' : 'Report completed');
        detail(view, [d.id]);
      } catch (e) { showErr(el, e); $('[data-go]', el).disabled = false; }
    });
  };
  $('[data-complete]', view).addEventListener('click', complete);
  $('[data-complete2]', view).addEventListener('click', complete);
  $('[data-del]', view)?.addEventListener('click', async () => {
    if (!(await confirmDialog('Delete this draft report?', { okLabel: 'Delete', danger: true }))) return;
    await api('DELETE', `/api/inspections/${d.id}`); location.hash = '#/inspections';
  });
}

/** Small card for a customer or job page: recent reports + start button. */
export async function reportsCard(card, { customer_id, service_call_id, site_id, title = 'Fire inspection reports' }) {
  const rows = await GET('/api/inspections', service_call_id ? { service_call_id } : { customer_id }).catch(() => []);
  mount(card, html`<div class="card-head"><h2>${title}</h2><button class="btn sm" data-start>+ Start report</button></div>
    <div class="card-body flush">${dataTable({
      rows: rows.slice(0, 10), href: r => `#/inspections/${r.id}`, empty: 'No reports yet.',
      columns: [
        { label: 'Report', render: r => html`<b>FIR-${r.number}</b><div class="small muted">${fmtDate(r.inspection_date)}</div>` },
        { label: 'Type', render: r => r.type_label },
        { label: 'Result', render: r => r.result ? badge(r.result_label, RESULT_BADGE[r.result]) : badge('in progress', 'warn') },
      ] })}</div>`);
  $('[data-start]', card).addEventListener('click', () => startDialog({ customer_id, site_id, service_call_id }));
}

/** Extinguisher history dialog. */
export async function extinguisherHistory(x) {
  const rows = await GET(`/api/extinguishers/${x.id}/history`);
  openModal({
    title: `${x.tag_number ? `#${x.tag_number} ` : ''}${x.location || 'Extinguisher'}`,
    body: html`<dl class="dl small" style="margin-bottom:12px">
        <dt>Type</dt><dd>${[x.size, x.ext_type, x.rating].filter(Boolean).join(' · ')}</dd>
        <dt>Kind</dt><dd>${x.pressure_type || '—'}${x.brand ? ` · ${x.brand}` : ''}</dd>
        <dt>Serial / made</dt><dd>${x.serial || '—'} · ${x.manufacture_date ? fmtDate(x.manufacture_date) : '—'}</dd>
        <dt>Next annual</dt><dd>${x.next_annual ? fmtDate(x.next_annual) : '—'}</dd>
        <dt>Next 6-year</dt><dd>${x.next_6yr ? fmtDate(x.next_6yr) : 'n/a'}</dd>
        <dt>Next hydro</dt><dd>${x.next_hydro ? fmtDate(x.next_hydro) : 'n/a'}</dd>
        ${x.replace_by ? html`<dt>Replace by</dt><dd>${fmtDate(x.replace_by)}</dd>` : ''}</dl>
      ${dataTable({
        rows, empty: 'No inspections recorded yet.',
        columns: [
          { label: 'Date', render: h => fmtDate(h.event_date) },
          { label: 'Result', render: h => badge(h.result, { pass: 'good', fail: 'bad', missing: 'bad', replaced: 'info' }[h.result] || '') },
          { label: 'Service', render: h => h.services || '' },
          { label: 'Report', render: h => h.report_id ? html`<a href="#/inspections/${h.report_id}">FIR-${h.report_number}</a>` : '' },
          { label: 'Notes', render: h => html`<span class="small">${h.note || ''}</span>` },
        ] })}`,
  });
}
