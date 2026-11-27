import {
  html, mount, $, $$, money, money0, fmtDate, badge, typeBadge, relDays, dataTable, openForm, openModal, loading, toast, confirmDialog, todayStr, addDays,
} from '../ui.js';
import { R, GET, POST } from '../api.js';
import { state, refresh } from '../app.js';

export async function list(view, _, query) {
  const f = { status: query.status || 'open', kind: '', q: '' };
  mount(view, html`
    <div class="page-head"><div><h1>Invoices</h1><div class="sub">Monthly monitoring bills, service and installation invoices</div></div>
      <div class="actions">
        <a class="btn" href="/api/export/invoices">Export CSV</a>
        <button class="btn" data-drafts>Mark drafts sent</button>
        <button class="btn" data-billing>Run monthly billing</button>
        <button class="btn primary" data-new>+ New invoice</button></div></div>
    <div class="kpis" data-kpis></div>
    <div class="filters">
      <div class="seg" data-status>${[['open', 'Open'], ['overdue', 'Overdue'], ['draft', 'Drafts'], ['paid', 'Paid'], ['void', 'Void'], ['all', 'All']].map(([v, l]) => html`<button data-v="${v}">${l}</button>`)}</div>
      <select data-kind aria-label="Kind"><option value="">All kinds</option><option value="monthly">Monthly</option><option value="service">Service</option><option value="installation">Installation</option><option value="other">Other</option></select>
      <input type="search" placeholder="Invoice # or period" data-q aria-label="Search invoices">
    </div>
    <div class="card"><div class="card-body flush" data-table></div></div>`);

  const load = async () => {
    $$('[data-status] button', view).forEach(b => b.classList.toggle('on', b.dataset.v === f.status));
    const q = { kind: f.kind, q: f.q };
    if (f.status === 'open' || f.status === 'overdue') q.status__in = 'sent,partial';
    else if (f.status !== 'all') q.status = f.status;
    let rows = await R.list('invoices', q);
    if (f.status === 'overdue') rows = rows.filter(i => i.display_status === 'overdue');
    if (f.status === 'open') rows = rows.filter(i => i.balance > 0);
    const all = await R.list('invoices', { status__in: 'sent,partial,draft' });
    const open = all.filter(i => i.status !== 'draft' && i.balance > 0);
    mount($('[data-kpis]', view), html`
      <div class="kpi"><div class="label">Outstanding</div><div class="value">${money0(open.reduce((s, i) => s + i.balance, 0))}</div><div class="hint">${open.length} open invoices</div></div>
      <div class="kpi ${open.some(i => i.display_status === 'overdue') ? 'alert' : ''}"><div class="label">Overdue</div><div class="value">${money0(open.filter(i => i.display_status === 'overdue').reduce((s, i) => s + i.balance, 0))}</div><div class="hint">${open.filter(i => i.display_status === 'overdue').length} invoices</div></div>
      <div class="kpi"><div class="label">Drafts</div><div class="value">${all.filter(i => i.status === 'draft').length}</div><div class="hint">not yet sent</div></div>`);
    const total = rows.reduce((s, i) => s + (i.total || 0), 0);
    const bal = rows.reduce((s, i) => s + (i.balance || 0), 0);
    mount($('[data-table]', view), invoiceTable(rows, rows.length ? html`<tr><td colspan="5">${rows.length} invoices</td><td class="num">${money(total)}</td><td class="num">${money(bal)}</td></tr>` : null));
  };
  $('[data-status]', view).addEventListener('click', e => { if (e.target.dataset.v) { f.status = e.target.dataset.v; load(); } });
  $('[data-kind]', view).addEventListener('change', e => { f.kind = e.target.value; load(); });
  let t;
  $('[data-q]', view).addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { f.q = e.target.value; load(); }, 250); });
  $('[data-new]', view).addEventListener('click', () => openForm('invoices', { onSaved: i => { location.hash = `#/invoices/${i.id}`; } }));
  $('[data-billing]', view).addEventListener('click', () => billingRun(load));
  $('[data-drafts]', view).addEventListener('click', async () => {
    if (!(await confirmDialog('Mark every draft invoice as sent? Do this after you have reviewed, printed or emailed them.', { okLabel: 'Mark sent' }))) return;
    const r = await POST('/api/invoices/send-drafts');
    toast(`${r.count} invoice(s) marked sent`);
    load();
  });
  await load();
  if (query.billing) billingRun(load);
}

function invoiceTable(rows, foot) {
  return dataTable({
    rows, href: i => `#/invoices/${i.id}`, empty: 'No invoices here.', foot,
    columns: [
      { label: 'Invoice', render: i => html`<b>#${i.number}</b><div class="small muted">${i.kind}${i.period ? ' · ' + i.period : ''}</div>` },
      { label: 'Customer', render: i => html`${i.customer_id_label} ${typeBadge(i.customer_type)}` },
      { label: 'Issued', render: i => fmtDate(i.issue_date) },
      { label: 'Due', render: i => html`${fmtDate(i.due_date)}${i.display_status === 'overdue' ? html`<div class="small" style="color:var(--bad)">${relDays(i.due_date)}</div>` : ''}` },
      { label: 'Status', render: i => badge(i.display_status) },
      { label: 'Total', render: i => money(i.total), cls: 'num' },
      { label: 'Balance', render: i => i.balance > 0 && i.status !== 'void' ? html`<b>${money(i.balance)}</b>` : money(0), cls: 'num' },
    ],
  });
}

function nextPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function billingRun(onDone) {
  const { el, close } = openModal({
    title: 'Run monthly billing',
    body: html`<p class="muted" style="margin-top:0">Creates one invoice per active customer from their recurring charges (monitoring, cloud video, service plans).
        Customers already billed for the month are skipped, so it is safe to run more than once.</p>
      <div class="row" style="margin-bottom:12px"><label for="period"><b>Billing month</b></label><input type="month" id="period" value="${nextPeriod()}" style="width:auto">
        <label class="row small"><input type="checkbox" data-draft> Create as drafts for review</label></div>
      <div data-preview><div class="empty">Loading preview…</div></div>`,
    foot: html`<button class="btn" data-close>Cancel</button><button class="btn primary" data-go disabled>Create invoices</button>`,
  });
  const preview = async () => {
    const period = $('#period', el).value;
    const p = await POST('/api/invoices/generate-monthly', { period, dry_run: true });
    mount($('[data-preview]', el), p.customers.length ? html`
      <div class="note" style="margin-bottom:10px">${p.customers.length} invoice(s) for <b>${p.label}</b> totaling <b>${money(p.total)}</b> (before tax)</div>
      <div class="table-wrap" style="max-height:320px;overflow-y:auto"><table class="t"><thead><tr><th>Customer</th><th>Type</th><th class="num">Charges</th><th class="num">Amount</th></tr></thead>
      <tbody>${p.customers.map(c => html`<tr><td>${c.name}</td><td>${typeBadge(c.type)}</td><td class="num">${c.lines}</td><td class="num">${money(c.amount)}</td></tr>`)}</tbody></table></div>`
      : html`<div class="empty">Everyone with recurring charges is already billed for ${p.label}.</div>`);
    $('[data-go]', el).disabled = !p.customers.length;
  };
  $('#period', el).addEventListener('change', preview);
  $('[data-go]', el).addEventListener('click', async () => {
    $('[data-go]', el).disabled = true;
    try {
      const r = await POST('/api/invoices/generate-monthly', { period: $('#period', el).value, as_draft: $('[data-draft]', el).checked });
      close();
      toast(`${r.created} monthly invoice(s) created`);
      onDone?.();
    } catch (e) { toast(e.message, 'error'); $('[data-go]', el).disabled = false; }
  });
  preview();
}

export async function detail(view, [id]) {
  loading(view);
  const inv = await R.get('invoices', id);
  const [cust, items, payments] = await Promise.all([R.get('customers', inv.customer_id), R.list('invoice_items', { invoice_id: id }), R.list('payments', { invoice_id: id })]);
  const job = inv.service_call_id ? await R.get('service_calls', inv.service_call_id).catch(() => null) : null;
  const s = state.settings;
  const reload = () => refresh();
  const addr = [cust.billing_address, [cust.city, cust.state].filter(Boolean).join(', ') + (cust.zip ? ' ' + cust.zip : '')].filter(x => x && x.trim());
  const mail = cust.email ? `mailto:${cust.email}?subject=${encodeURIComponent(`Invoice #${inv.number} from ${s.company_name}`)}&body=${encodeURIComponent(
    `Hello ${cust.contact_name || cust.name},\n\nYour invoice #${inv.number} for ${money(inv.total)} is ${inv.balance > 0 ? `due ${fmtDate(inv.due_date)}. Balance due: ${money(inv.balance)}` : 'paid in full. Thank you!'}.\n\n${items.map(i => `• ${i.description}: ${money(i.qty * i.unit_price)}`).join('\n')}\n\n${s.invoice_footer || ''}\n\n${s.company_name}\n${s.company_phone || ''}`)}` : null;

  mount(view, html`
    <div class="crumbs no-print"><a href="#/invoices">Invoices</a> / <a href="#/customers/${cust.id}?tab=billing">${cust.name}</a></div>
    <div class="page-head no-print"><div><h1>Invoice #${inv.number} ${badge(inv.display_status)}</h1>
        <div class="sub">${inv.kind}${inv.period ? ' · ' + inv.period : ''} · Balance ${money(inv.balance)}</div></div>
      <div class="actions">
        <button class="btn" data-edit>Edit details</button>
        ${inv.status !== 'void' ? html`<button class="btn" data-additem>+ Line item</button>` : ''}
        ${inv.status === 'draft' ? html`<button class="btn" data-sent>Mark sent</button>` : ''}
        ${mail ? html`<a class="btn" href="${mail}">Email</a>` : ''}
        <button class="btn" data-print>Print / PDF</button>
        ${inv.balance > 0 && inv.status !== 'void' ? html`<button class="btn" data-online>Get paid online ▾</button><button class="btn primary" data-pay>Record payment</button>` : ''}
      </div></div>
    <div class="grid g3">
      <div class="span2">
        <div class="invoice-paper">
          <div class="head">
            <div><h2 style="font-size:20px">${s.company_name}</h2>
              <div style="white-space:pre-wrap;color:#555">${s.company_address}</div>
              <div style="color:#555">${[s.company_phone, s.company_email].filter(Boolean).join(' · ')}</div>
              ${s.company_license ? html`<div style="color:#555">License ${s.company_license}</div>` : ''}</div>
            <div style="text-align:right"><h1>INVOICE</h1>
              <div><b>#${inv.number}</b></div><div>Issued ${fmtDate(inv.issue_date)}</div><div>Due ${fmtDate(inv.due_date)}</div>
              ${inv.period ? html`<div>Period ${inv.period}</div>` : ''}
              ${['paid', 'void', 'overdue'].includes(inv.display_status) ? html`<div style="margin-top:10px"><span class="stamp ${inv.display_status}">${inv.display_status}</span></div>` : ''}</div>
          </div>
          <div style="margin-top:24px"><div style="font-size:12px;color:#555;text-transform:uppercase;letter-spacing:.04em">Bill to</div>
            <div><b>${cust.name}</b></div>${cust.contact_name ? html`<div>Attn: ${cust.contact_name}</div>` : ''}
            ${addr.map(a => html`<div>${a}</div>`)}${cust.account_number ? html`<div>Account ${cust.account_number}</div>` : ''}</div>
          <table><thead><tr><th>Description</th><th style="text-align:right">Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th></tr></thead>
            <tbody>${items.length ? items.map(i => html`<tr class="${inv.status !== 'void' ? 'click' : ''}" data-item="${i.id}" title="Click to edit">
              <td>${i.description}${i.taxable ? html` <span style="color:#888;font-size:11px">T</span>` : ''}</td><td style="text-align:right">${i.qty}</td>
              <td style="text-align:right">${money(i.unit_price)}</td><td style="text-align:right">${money(i.qty * i.unit_price)}</td></tr>`)
              : html`<tr><td colspan="4" style="color:#888">No line items yet — add one.</td></tr>`}</tbody></table>
          <div class="totals">
            <div><span>Subtotal</span><span>${money(inv.subtotal)}</span></div>
            <div><span>Tax (${inv.tax_rate || 0}%)</span><span>${money(inv.tax)}</span></div>
            <div class="grand"><span>Total</span><span>${money(inv.total)}</span></div>
            ${inv.paid ? html`<div><span>Paid</span><span>−${money(inv.paid)}</span></div>` : ''}
            <div style="font-weight:700"><span>Balance due</span><span>${money(inv.balance)}</span></div>
          </div>
          ${inv.notes ? html`<div style="margin-top:20px;white-space:pre-wrap">${inv.notes}</div>` : ''}
          ${job?.signed_by ? html`<div class="doc-sign"><div class="doc-sign-label">Work completed and accepted</div>
            <img src="/api/service_calls/${job.id}/signature" alt="Customer signature">
            <div>${job.signed_by} · ${new Date(job.signed_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })} · SC-${job.number}</div></div>` : ''}
          ${s.invoice_footer ? html`<div style="margin-top:28px;color:#555;white-space:pre-wrap;border-top:1px solid #ddd;padding-top:12px">${s.invoice_footer}</div>` : ''}
        </div>
      </div>
      <div class="stack no-print">
        <div class="card"><div class="card-head"><h2>Payments</h2></div><div class="card-body flush">${dataTable({
          rows: payments, empty: 'No payments yet.',
          columns: [{ label: 'Date', render: p => fmtDate(p.date) }, { label: 'Method', render: p => html`${p.method}<div class="small muted">${p.reference || ''}</div>` },
            { label: 'Amount', render: p => money(p.amount), cls: 'num' }, { label: '', cls: 'actions-cell', render: p => html`<button class="btn sm ghost" data-editpay="${p.id}">Edit</button>` }],
        })}</div></div>
        <div class="card"><div class="card-body"><dl class="dl small">
          <dt>Customer</dt><dd><a href="#/customers/${cust.id}">${cust.name}</a></dd>
          ${inv.service_call_id ? html`<dt>Service call</dt><dd><a href="#/calls/${inv.service_call_id}">${inv.service_call_id_label}</a></dd>` : ''}
          <dt>Created</dt><dd>${inv.created_at}</dd></dl>
          ${inv.status !== 'void' ? html`<button class="btn sm danger" style="margin-top:12px" data-void>Void invoice</button>`
            : html`<button class="btn sm" style="margin-top:12px" data-unvoid>Restore (un-void)</button>`}</div></div>
      </div>
    </div>`);

  $('[data-print]', view).addEventListener('click', () => window.print());
  $('[data-edit]', view).addEventListener('click', () => openForm('invoices', { record: inv, onSaved: reload, onDeleted: () => { location.hash = '#/invoices'; } }));
  $('[data-additem]', view)?.addEventListener('click', () => openForm('invoice_items', { defaults: { invoice_id: inv.id }, hide: ['invoice_id'], onSaved: reload }));
  $$('[data-item]', view).forEach(tr => tr.addEventListener('click', () => {
    if (inv.status === 'void') return;
    openForm('invoice_items', { record: items.find(i => i.id === Number(tr.dataset.item)), hide: ['invoice_id'], onSaved: reload, onDeleted: reload });
  }));
  $('[data-online]', view)?.addEventListener('click', () => onlinePayDialog(inv, cust, reload));
  $('[data-pay]', view)?.addEventListener('click', () => openForm('payments', { defaults: { invoice_id: inv.id, amount: inv.balance, method: cust.preferred_payment || 'check' }, hide: ['invoice_id'], onSaved: reload }));
  $$('[data-editpay]', view).forEach(b => b.addEventListener('click', () => openForm('payments', { record: payments.find(p => p.id === Number(b.dataset.editpay)), hide: ['invoice_id'], onSaved: reload, onDeleted: reload })));
  $('[data-sent]', view)?.addEventListener('click', async () => { await POST(`/api/invoices/${id}/status`, { status: 'sent' }); toast('Marked as sent'); reload(); });
  $('[data-void]', view)?.addEventListener('click', async () => {
    if (inv.paid > 0) return toast('This invoice has payments. Delete or move the payments before voiding it.', 'error');
    if (!(await confirmDialog('Void this invoice? It will no longer count toward revenue or the balance due.', { okLabel: 'Void', danger: true }))) return;
    await POST(`/api/invoices/${id}/status`, { status: 'void' }); toast('Invoice voided'); reload();
  });
  $('[data-unvoid]', view)?.addEventListener('click', async () => { await POST(`/api/invoices/${id}/status`, { status: 'sent' }); toast('Invoice restored'); reload(); });
}

export async function payments(view, _, query) {
  const f = { from: query.from || addDays(todayStr(), -90), to: query.to || todayStr(), method: '' };
  mount(view, html`
    <div class="page-head"><div><h1>Payments received</h1><div class="sub">Every payment recorded against an invoice</div></div>
      <div class="actions"><a class="btn" href="/api/export/payments">Export CSV</a></div></div>
    <div class="filters">
      <label class="small">From <input type="date" data-from value="${f.from}"></label>
      <label class="small">To <input type="date" data-to value="${f.to}"></label>
      <select data-method aria-label="Method"><option value="">All methods</option>${['check', 'card', 'ach', 'cash', 'other'].map(m => html`<option>${m}</option>`)}</select>
    </div>
    <div class="kpis" data-kpis></div>
    <div class="card"><div class="card-body flush" data-table></div></div>`);
  const load = async () => {
    const rows = await R.list('payments', f);
    const total = rows.reduce((s, p) => s + p.amount, 0);
    const byMethod = {};
    rows.forEach(p => { byMethod[p.method] = (byMethod[p.method] || 0) + p.amount; });
    mount($('[data-kpis]', view), html`<div class="kpi"><div class="label">Total collected</div><div class="value">${money(total)}</div><div class="hint">${rows.length} payments</div></div>
      ${Object.entries(byMethod).map(([m, v]) => html`<div class="kpi"><div class="label">${m.toUpperCase()}</div><div class="value">${money0(v)}</div></div>`)}`);
    mount($('[data-table]', view), dataTable({
      rows, href: p => `#/invoices/${p.invoice_id}`, empty: 'No payments in this range.',
      columns: [
        { label: 'Date', render: p => fmtDate(p.date) }, { label: 'Customer', render: p => p.customer_id_label },
        { label: 'Invoice', render: p => p.invoice_id_label }, { label: 'Method', key: 'method' },
        { label: 'Reference', render: p => p.reference || '—' }, { label: 'Amount', render: p => money(p.amount), cls: 'num' },
      ],
      foot: rows.length ? html`<tr><td colspan="5">Total</td><td class="num">${money(total)}</td></tr>` : null,
    }));
  };
  $('[data-from]', view).addEventListener('change', e => { f.from = e.target.value; load(); });
  $('[data-to]', view).addEventListener('change', e => { f.to = e.target.value; load(); });
  $('[data-method]', view).addEventListener('change', e => { f.method = e.target.value; load(); });
  await load();
}

// Online payment options for one invoice: email a pay link, copy it, or charge a saved card/bank.
async function onlinePayDialog(inv, cust, onDone) {
  const cfg = await GET('/api/payments/config');
  if (!cfg.ok) {
    openModal({ title: 'Get paid online', size: 'sm', body: html`<p>Online card and bank (ACH) payments use Stripe. An owner or admin can connect it under <b>Settings → Payments</b> in a few minutes.</p>
      <p class="muted small">Until then you can record cash, check, card and ACH payments by hand with “Record payment”.</p>`, foot: html`<button class="btn" data-close>Close</button>` });
    return;
  }
  const pm = await GET(`/api/customers/${cust.id}/payment-methods`).catch(() => ({ methods: [] }));
  const { el, close } = openModal({
    title: `Get paid online — ${money(inv.balance)}`, size: 'sm',
    body: html`<div class="err-box hidden" data-err></div><div class="stack" style="gap:14px">
      <div><b>Send a “Pay now” link</b><p class="small muted" style="margin:4px 0 8px">The customer pays by card or bank on Stripe’s secure page; the payment is recorded here automatically.</p>
        <div class="row"><button class="btn primary" data-email ${cust.email ? '' : 'disabled'}>Email link${cust.email ? ` to ${cust.email}` : ' (no email on file)'}</button><button class="btn" data-copylink>Copy link</button></div></div>
      <div><b>Charge a saved payment method</b>
        ${pm.methods.length ? html`<div class="stack" style="gap:6px;margin-top:8px">${pm.methods.map(m => html`<label class="row"><input type="radio" name="pm" value="${m.id}" ${m.id === (pm.default || pm.methods[0].id) ? 'checked' : ''}> ${m.label} <span class="muted small">${m.detail}${m.id === pm.default ? ' · default' : ''}</span></label>`)}</div>
          <button class="btn" data-charge style="margin-top:8px">Charge ${money(inv.balance)} now</button>`
          : html`<p class="small muted" style="margin:4px 0">No saved card or bank account. Send them a link from their Billing tab to add one.</p>`}</div></div>`,
    foot: html`<button class="btn" data-close>Close</button>`,
  });
  const err = msg => { const e = $('[data-err]', el); e.textContent = msg; e.classList.remove('hidden'); };
  $('[data-email]', el).addEventListener('click', async () => { try { await POST(`/api/invoices/${inv.id}/email-pay-link`); close(); toast('Payment link emailed'); onDone(); } catch (e) { err(e.message); } });
  $('[data-copylink]', el).addEventListener('click', async () => { try { const r = await POST(`/api/invoices/${inv.id}/pay-link`); await navigator.clipboard?.writeText(r.url); toast('Link copied — paste it into a text or email'); } catch (e) { err(e.message); } });
  $('[data-charge]', el)?.addEventListener('click', async () => {
    const pmId = $('input[name=pm]:checked', el)?.value;
    if (!(await confirmDialog(`Charge ${money(inv.balance)} to ${pm.methods.find(m => m.id === pmId)?.label}?`, { okLabel: 'Charge now' }))) return;
    try { const r = await POST(`/api/invoices/${inv.id}/charge`, { pm_id: pmId }); close(); toast(r.status === 'paid' ? 'Payment approved and recorded' : r.message); onDone(); } catch (e) { err(e.message); }
  });
}
