import { html, mount, $, $$, money, fmtDate, fmtDateTime, badge, dataTable, openForm, openModal, loading, toast, confirmDialog, typeBadge } from '../ui.js';
import { R, GET, POST } from '../api.js';
import { can, refresh } from '../app.js';
import { BILLING_FREQ } from '../schema.js';
import { renderDocument } from '../doc.js';

const STATUS_CLS = { draft: '', sent: 'info', viewed: 'primary', signed: 'good', declined: 'bad', expired: 'warn' };
export const pBadge = s => badge(s, STATUS_CLS[s] ?? '');

export function proposalsTable(rows, empty = 'No proposals yet.') {
  return dataTable({
    rows, href: p => `#/proposals/${p.id}`, empty,
    columns: [
      { label: 'No.', render: p => html`<b>P-${p.number}</b>` },
      { label: 'Customer', render: p => p.customer_id_label },
      { label: 'Title', render: p => html`${p.title}<div class="small muted">${p.kind}</div>` },
      { label: 'Status', render: p => html`${pBadge(p.status)}${p.status === 'signed' ? html`<div class="small muted">${fmtDate(p.signed_at?.slice(0, 10))}</div>` : p.sent_at ? html`<div class="small muted">sent ${fmtDate(p.sent_at.slice(0, 10))}</div>` : ''}` },
      { label: 'One-time', render: p => money(p.total), cls: 'num' },
      { label: 'Monthly', render: p => p.monthly_amount ? money(p.monthly_amount) : '—', cls: 'num' },
    ],
  });
}

export function newProposal(defaults = {}) {
  return openForm('proposals', { title: 'New proposal or agreement', defaults, onSaved: p => { location.hash = `#/proposals/${p.id}`; } });
}

export async function list(view, _, query) {
  let status = query.status || 'open';
  mount(view, html`
    <div class="page-head"><div><h1>Proposals & agreements</h1><div class="sub">Quotes, installation, monitoring and service agreements, signed online</div></div>
      <div class="actions">${can.sales() ? html`<button class="btn primary" data-new>+ New proposal</button>` : ''}</div></div>
    <div class="kpis" data-kpis></div>
    <div class="filters"><div class="seg" data-status>${[['open', 'Open'], ['signed', 'Signed'], ['closed', 'Declined / expired'], ['all', 'All']].map(([v, l]) => html`<button data-v="${v}">${l}</button>`)}</div></div>
    <div class="card"><div class="card-body flush" data-table></div></div>`);
  const load = async () => {
    $$('[data-status] button', view).forEach(b => b.classList.toggle('on', b.dataset.v === status));
    const all = await R.list('proposals');
    const pick = { open: p => ['draft', 'sent', 'viewed'].includes(p.status), signed: p => p.status === 'signed', closed: p => ['declined', 'expired'].includes(p.status), all: () => true }[status];
    const open = all.filter(p => ['sent', 'viewed'].includes(p.status));
    const month = new Date().toISOString().slice(0, 7);
    const signedMonth = all.filter(p => p.status === 'signed' && p.signed_at?.startsWith(month));
    const decided = all.filter(p => ['signed', 'declined'].includes(p.status));
    mount($('[data-kpis]', view), html`
      <div class="kpi"><div class="label">Out for signature</div><div class="value">${open.length}</div><div class="hint">${money(open.reduce((t, p) => t + (p.total || 0), 0))} one-time</div></div>
      <div class="kpi"><div class="label">Signed this month</div><div class="value">${signedMonth.length}</div><div class="hint">${money(signedMonth.reduce((t, p) => t + (p.total || 0), 0))} + ${money(signedMonth.reduce((t, p) => t + (p.monthly_amount || 0), 0))}/mo</div></div>
      <div class="kpi"><div class="label">Close rate</div><div class="value">${decided.length ? Math.round(decided.filter(p => p.status === 'signed').length / decided.length * 100) : 0}%</div><div class="hint">signed vs declined</div></div>`);
    mount($('[data-table]', view), proposalsTable(all.filter(pick)));
  };
  $('[data-status]', view).addEventListener('click', e => { if (e.target.dataset.v) { status = e.target.dataset.v; load(); } });
  $('[data-new]', view)?.addEventListener('click', () => newProposal());
  await load();
  if (query.new && can.sales()) newProposal(query.customer ? { customer_id: Number(query.customer) } : {});
}

export async function detail(view, [id]) {
  loading(view);
  const [p, items, doc] = await Promise.all([R.get('proposals', id), R.list('proposal_items', { proposal_id: id }), GET(`/api/proposals/${id}/document`)]);
  const editable = can.sales() && !['signed', 'declined'].includes(p.status);
  const itemPhotos = new Set((await R.list('inventory_items', {})).filter(x => x.photo_key).map(x => x.id));
  const reload = () => refresh();
  mount(view, html`
    <div class="crumbs no-print"><a href="#/proposals">Proposals</a> / <a href="#/customers/${p.customer_id}">${p.customer_id_label}</a></div>
    <div class="page-head no-print"><div><h1>P-${p.number} · ${p.title} ${pBadge(doc.status)}</h1>
        <div class="sub">${p.kind} · prepared by ${p.sales_user || '—'}${p.sent_at ? ` · sent ${fmtDateTime(p.sent_at)}` : ''}${p.viewed_at ? ` · first viewed ${fmtDateTime(p.viewed_at)}` : ''}</div></div>
      <div class="actions">
        ${editable ? html`<button class="btn" data-edit>Edit details</button>` : ''}
        ${can.sales() ? html`<button class="btn" data-dup>Duplicate</button>` : ''}
        <button class="btn" data-print>Print / PDF</button>
        ${doc.link && !['signed', 'declined'].includes(doc.status) ? html`<button class="btn" data-copy>Copy signing link</button><a class="btn" href="${doc.link}" target="_blank" rel="noopener">Sign in person</a>` : ''}
        ${editable ? html`<button class="btn primary" data-send>${p.sent_at ? 'Resend for signature' : 'Send for signature'}</button>` : ''}
      </div></div>
    ${p.status === 'signed' ? html`<div class="card no-print" style="margin-bottom:16px"><div class="card-head"><h2>✅ Signed — what happened next</h2></div><div class="card-body grid g3">
      <dl class="dl small"><dt>Signed by</dt><dd>${p.signed_by}${p.signed_title ? `, ${p.signed_title}` : ''}</dd><dt>When</dt><dd>${fmtDateTime(p.signed_at)}</dd>
        <dt>Email</dt><dd>${p.signed_email || '—'}</dd><dt>From IP</dt><dd>${p.signed_ip || '—'}</dd></dl>
      <dl class="dl small"><dt>Fingerprint</dt><dd class="mono" style="font-size:11px;word-break:break-all">${p.doc_hash}</dd>
        <dt>Integrity</dt><dd>${doc.signed && doc.signed.hash === p.doc_hash ? html`<span class="badge good">matches signed version</span>` : html`<span class="badge bad">changed since signing</span>`}</dd></dl>
      <div class="stack" style="gap:8px">${p.service_call_id ? html`<a class="btn sm" href="#/calls/${p.service_call_id}">Installation job created → schedule it</a>` : ''}
        ${p.invoice_id ? html`<a class="btn sm" href="#/invoices/${p.invoice_id}">Deposit invoice ${p.invoice_id_label}</a>` : ''}
        ${p.monthly_amount ? html`<a class="btn sm" href="#/customers/${p.customer_id}?tab=billing">Monthly billing started (${money(p.monthly_amount)})</a>` : ''}
        <a class="btn sm" href="#/customers/${p.customer_id}">Customer → ${p.customer_id_label}</a></div></div></div>` : ''}
    ${p.status === 'declined' ? html`<div class="err-box no-print">Declined${p.declined_reason ? `: “${p.declined_reason}”` : ''}. Duplicate it to send a revised version.</div>` : ''}
    ${editable ? html`<div class="grid g3 no-print" style="margin-bottom:16px">
      <div class="card span2"><div class="card-head"><h2>Equipment & labor</h2><div class="actions"><button class="btn sm" data-additem>+ Line</button></div></div>
        <div class="card-body flush">${dataTable({
          rows: items, empty: 'No lines yet. Add equipment from inventory or a custom line (labor, programming, permits…).',
          columns: [
            { label: 'Description', render: i => html`<div class="row" style="gap:8px;flex-wrap:nowrap">${i.item_id && itemPhotos.has(i.item_id) ? html`<img class="thumb" src="/api/inventory/${i.item_id}/photo" alt="">` : ''}<span>${i.description}</span></div>` },
            { label: 'Qty', key: 'qty', cls: 'num' }, { label: 'Price', render: i => money(i.unit_price), cls: 'num' },
            { label: 'Amount', render: i => money(i.qty * i.unit_price), cls: 'num' },
            { label: 'Tax', render: i => i.taxable ? '✓' : '' },
            { label: '', cls: 'actions-cell', render: i => html`<button class="btn sm ghost" data-item="${i.id}">Edit</button>` },
          ],
          foot: items.length ? html`<tr><td colspan="3">Total (incl. ${money(p.tax)} tax)</td><td class="num">${money(p.total)}</td><td colspan="2"></td></tr>` : null,
        })}</div></div>
      <div class="card"><div class="card-head"><h2>Monthly & payment</h2><button class="btn sm" data-edit2>Edit</button></div><div class="card-body"><dl class="dl small">
        <dt>Monthly fee</dt><dd>${p.monthly_amount ? html`${money(p.monthly_amount)} — ${p.monthly_description}${p.billing_frequency && p.billing_frequency !== 'monthly' ? html`<div class="small muted">billed ${BILLING_FREQ[p.billing_frequency].adverb} (${money(p.monthly_amount * BILLING_FREQ[p.billing_frequency].months)})</div>` : ''}` : 'None'}</dd>
        <dt>Term</dt><dd>${p.term_months ? `${p.term_months} months` : '—'}</dd>
        <dt>Deposit</dt><dd>${p.deposit_percent ? `${p.deposit_percent}% (${money(doc.deposit)})` : 'None'}</dd>
        <dt>Valid until</dt><dd>${fmtDate(p.valid_until)}</dd></dl>
        <p class="small muted" style="margin-bottom:0">When the customer signs: stage → Accepted${p.monthly_amount ? ', monthly billing starts' : ''}${items.length && !/monitoring|service/.test(p.kind) ? ', an installation job is created' : ''}${p.deposit_percent ? ', a deposit invoice is created' : ''}.</p></div></div>
    </div>` : ''}
    <div class="card no-print" style="margin-bottom:16px" data-survey></div>
    <div class="doc-frame">${renderDocument(doc, { signatureUrl: doc.signed ? `/api/proposals/${id}/signature` : null, logoUrl: doc.company.logo ? '/api/public/logo' : null, photoUrl: (kind, pid) => `/api/proposals/${id}/${kind}-photo/${pid}` })}</div>`);
  import('../survey-photos.js').then(m => R.list('locations', { customer_id: p.customer_id }).then(sites => m.surveyGallery($('[data-survey]', view), { customerId: p.customer_id, proposalId: Number(id), locked: p.status === 'signed', canEdit: can.sales() && p.status !== 'declined', sites, onChange: reload })));

  $('[data-print]', view).addEventListener('click', () => window.print());
  $('[data-copy]', view)?.addEventListener('click', () => navigator.clipboard?.writeText(doc.link).then(() => toast('Signing link copied. Paste it into a text or email.')));
  const editDetails = () => openForm('proposals', { record: p, onSaved: reload, onDeleted: () => { location.hash = '#/proposals'; } });
  $('[data-edit]', view)?.addEventListener('click', editDetails);
  $('[data-edit2]', view)?.addEventListener('click', editDetails);
  $('[data-dup]', view)?.addEventListener('click', async () => { const c = await POST(`/api/proposals/${id}/duplicate`); toast('Copy created as a new draft'); location.hash = `#/proposals/${c.id}`; });
  $('[data-additem]', view)?.addEventListener('click', () => openForm('proposal_items', { defaults: { proposal_id: Number(id), sort: items.length }, hide: ['proposal_id'], onSaved: reload,
    onMount: (el, form) => {
      // Picking an inventory item fills in its name and sell price.
      form.elements.item_id?.addEventListener('change', async () => {
        const itemId = form.elements.item_id.value;
        if (!itemId) return;
        const it = await R.get('inventory_items', itemId);
        if (!form.elements.description.value) form.elements.description.value = it.name;
        if (!form.elements.unit_price.value) form.elements.unit_price.value = it.unit_price ?? '';
      });
    } }));
  $$('[data-item]', view).forEach(b => b.addEventListener('click', () => openForm('proposal_items', { record: items.find(i => i.id === Number(b.dataset.item)), hide: ['proposal_id'], onSaved: reload, onDeleted: reload })));
  $('[data-send]', view)?.addEventListener('click', async () => {
    const cust = await R.get('customers', p.customer_id);
    const { el, close } = openModal({
      title: 'Send for signature', size: 'sm',
      body: html`<div class="err-box hidden" data-err></div><div class="stack" style="gap:12px">
        <label class="row"><input type="checkbox" data-em ${cust.email ? 'checked' : 'disabled'}> Email ${cust.email || '(no email on file)'}</label>
        <label class="row"><input type="checkbox" data-sms ${cust.phone ? '' : 'disabled'}> Text ${cust.phone || '(no phone on file)'}</label>
        <div class="field"><label for="msg">Personal note (optional)</label><textarea id="msg" placeholder="Thanks for meeting with me today…"></textarea></div>
        <p class="small muted" style="margin:0">They'll get a secure link to review and sign on any device. You'll be emailed when it's signed.</p></div>`,
      foot: html`<button class="btn" data-close>Cancel</button><button class="btn primary" data-go>Send</button>`,
    });
    $('[data-go]', el).addEventListener('click', async () => {
      try {
        const r = await POST(`/api/proposals/${id}/send`, { email: $('[data-em]', el).checked, sms: $('[data-sms]', el).checked, message: $('#msg', el).value });
        close();
        await navigator.clipboard?.writeText(r.url).catch(() => {});
        toast('Sent! The signing link is also copied to your clipboard.');
        reload();
      } catch (e) { const er = $('[data-err]', el); er.textContent = e.message; er.classList.remove('hidden'); }
    });
  });
}
