// Pay & benefits (optional add-on): payroll site link, benefit plans, private documents.
import { html, mount, $, $$, fmtDate, badge, dataTable, openForm, openModal, loading, toast, confirmDialog } from '../ui.js';
import { GET, POST, R, api } from '../api.js';
import { refresh } from '../app.js';

const KIND_ICON = { health: '🩺', dental: '🦷', vision: '👓', life: '🛡️', disability: '♿', retirement: '🏦', 'HSA / FSA': '💳', other: '📄' };
const toB64 = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f); });

export async function render(view) {
  loading(view);
  const cfg = await GET('/api/pay/config');
  if (!cfg.enabled) { mount(view, html`<div class="card"><div class="empty">Pay & benefits isn’t turned on. An owner can turn it on under Settings → HR & time off.</div></div>`); return; }
  const [plans, docs, bal, users] = await Promise.all([R.list('benefit_plans'), GET('/api/pay/documents', { mine: '1' }), GET('/api/pto/balances'), cfg.can_manage ? GET('/api/pay/people') : []]);
  const all = cfg.can_manage ? await GET('/api/pay/documents') : [];
  const per = bal.workday_hours || 8;
  mount(view, html`<div class="page-head"><div><h1>My pay & benefits</h1><div class="sub">Pay stubs, tax forms, direct deposit and your benefits</div></div></div>
    <div class="grid g2" style="margin-bottom:16px">
      <div class="card"><div class="card-body">
        <h2 style="margin-top:0">💵 Pay stubs, W-2s & direct deposit</h2>
        <p class="muted">Your pay stubs and tax forms, and changes to your bank account or tax withholding (W-4), are in ${cfg.provider_label}. Sign in there with your own account.</p>
        ${cfg.portal_url ? html`<a class="btn primary lg" href="${cfg.portal_url}" target="_blank" rel="noopener">Open ${cfg.provider_label} ↗</a>` : html`<p class="muted">Ask the office for the link.</p>`}
        ${cfg.note ? html`<p class="small" style="white-space:pre-wrap;margin-top:12px">${cfg.note}</p>` : ''}
        ${cfg.contact ? html`<p class="small muted">Payroll questions: ${cfg.contact}</p>` : ''}</div></div>
      <div class="card"><div class="card-body"><h2 style="margin-top:0">🌴 Time off left (${bal.year})</h2>
        <div class="stack" style="gap:6px">${['vacation', 'sick', 'personal'].map(k => html`<div class="row" style="justify-content:space-between"><span>${k[0].toUpperCase() + k.slice(1)}</span><b>${Math.round(bal.balances[k].remaining / per * 10) / 10} days <span class="muted small">(${bal.balances[k].remaining} h)</span></b></div>`)}</div>
        <a class="btn sm" href="#/time-off" style="margin-top:12px">Request time off</a></div></div>
    </div>
    <div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Benefits</h2>${cfg.can_manage ? html`<button class="btn sm" data-addplan>+ Plan</button>` : ''}</div>
      <div class="card-body">${plans.length ? html`<div class="grid g2">${plans.map(p => html`<div class="benefit"><div class="row" style="justify-content:space-between"><b>${KIND_ICON[p.kind] || '📄'} ${p.name}</b>${cfg.can_manage ? html`<button class="btn sm ghost" data-editplan="${p.id}">Edit</button>` : ''}</div>
          <div class="small muted">${[p.kind, p.provider, p.group_number ? `Group ${p.group_number}` : ''].filter(Boolean).join(' · ')}</div>
          ${p.summary ? html`<div class="small" style="white-space:pre-wrap;margin-top:6px">${p.summary}</div>` : ''}
          <div class="row small" style="margin-top:8px">${p.member_phone ? html`<a href="tel:${p.member_phone}">📞 ${p.member_phone}</a>` : ''}${p.website ? html`<a href="${p.website}" target="_blank" rel="noopener">Member site ↗</a>` : ''}</div>
          ${p.enrollment ? html`<div class="small muted" style="margin-top:4px">Enrollment: ${p.enrollment}</div>` : ''}</div>`)}</div>` : html`<div class="muted">No benefit plans listed yet.</div>`}</div></div>
    <div class="card" style="margin-bottom:16px"><div class="card-head"><h2>My documents</h2></div><div class="card-body flush">${dataTable({
      rows: docs, empty: 'Nothing posted for you yet.',
      columns: [
        { label: 'Document', render: d => html`<a href="/api/pay/documents/${d.id}/file" target="_blank" rel="noopener"><b>${d.title}</b></a>${!d.viewed_at ? html` ${badge('new', 'info')}` : ''}` },
        { label: 'Type', render: d => d.kind },
        { label: 'For', render: d => d.period ? fmtDate(d.period) : '' },
        { label: 'Posted', render: d => fmtDate(d.created_at.slice(0, 10)) },
      ] })}</div></div>
    ${cfg.can_manage ? html`<div class="card"><div class="card-head"><div><h2>Employee documents</h2><div class="small muted">Only the employee, the owner and accounting can open these</div></div><button class="btn sm primary" data-upload>+ Post documents</button></div>
      <div class="card-body flush">${dataTable({
        rows: all, empty: 'Nothing posted yet.',
        columns: [
          { label: 'Employee', render: d => d.user_name },
          { label: 'Document', render: d => html`<a href="/api/pay/documents/${d.id}/file" target="_blank" rel="noopener">${d.title}</a><div class="small muted">${d.kind}${d.period ? ` · ${fmtDate(d.period)}` : ''}</div>` },
          { label: 'Posted', render: d => html`${fmtDate(d.created_at.slice(0, 10))}<div class="small muted">${d.uploaded_by}</div>` },
          { label: 'Seen', render: d => d.viewed_at ? badge('opened', 'good') : badge('not yet', '') },
          { label: '', cls: 'actions-cell', render: d => html`<button class="btn sm ghost danger" data-deldoc="${d.id}">Remove</button>` },
        ] })}</div></div>` : ''}`);
  $('[data-addplan]', view)?.addEventListener('click', () => openForm('benefit_plans', { onSaved: refresh }));
  $$('[data-editplan]', view).forEach(b => b.addEventListener('click', () => openForm('benefit_plans', { record: plans.find(p => p.id === Number(b.dataset.editplan)), onSaved: refresh, onDeleted: refresh, allowDelete: true })));
  $$('[data-deldoc]', view).forEach(b => b.addEventListener('click', async () => { if (await confirmDialog('Remove this document?', { okLabel: 'Remove', danger: true })) { await api('DELETE', `/api/pay/documents/${b.dataset.deldoc}`); refresh(); } }));
  $('[data-upload]', view)?.addEventListener('click', () => {
    const { el, close } = openModal({
      title: 'Post documents for an employee', size: 'sm',
      body: html`<div class="err-box hidden" data-err></div>
        <div class="field"><label for="pd_u">Employee</label><select id="pd_u">${users.filter(u => u.active).map(u => html`<option value="${u.id}">${u.name}</option>`)}</select></div>
        <div class="field" style="margin-top:10px"><label for="pd_k">Type</label><select id="pd_k">${['pay stub', 'W-2', 'benefits', 'tax form', 'other'].map(k => html`<option>${k}</option>`)}</select></div>
        <div class="field" style="margin-top:10px"><label for="pd_p">Pay date / period (optional)</label><input id="pd_p" type="date"></div>
        <div class="field" style="margin-top:10px"><label for="pd_f">Files (PDF, JPG or PNG)</label><input id="pd_f" type="file" accept="application/pdf,image/jpeg,image/png" multiple></div>`,
      foot: html`<button class="btn" data-close>Cancel</button><button class="btn primary" data-go>Post</button>`,
    });
    $('[data-go]', el).addEventListener('click', async () => {
      const files = [...$('#pd_f', el).files];
      if (!files.length) { const b = $('[data-err]', el); b.textContent = 'Choose at least one file'; b.classList.remove('hidden'); return; }
      $('[data-go]', el).disabled = true;
      try {
        for (const f of files) await POST('/api/pay/documents', { user_id: $('#pd_u', el).value, kind: $('#pd_k', el).value, period: $('#pd_p', el).value, title: f.name.replace(/\.[^.]+$/, ''), file_name: f.name, data: await toB64(f) });
        close(); toast(`${files.length} document${files.length > 1 ? 's' : ''} posted`); refresh();
      } catch (e) { const b = $('[data-err]', el); b.textContent = e.message; b.classList.remove('hidden'); $('[data-go]', el).disabled = false; }
    });
  });
}
