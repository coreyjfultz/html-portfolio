// Renders a proposal / agreement as a clean, printable document. Used by the
// staff app (preview) and the customer's public signing page, so both show the same thing.
import { html, raw, money, fmtDate } from './ui.js';

const KIND = { proposal: 'Proposal', 'installation agreement': 'Installation Agreement', 'monitoring agreement': 'Monitoring Agreement', 'service agreement': 'Service Agreement' };

export function renderDocument(d, { signatureUrl, logoUrl } = {}) {
  const addr = x => x ? [x.address || x.billing_address, [x.city, x.state].filter(Boolean).join(', ') + (x.zip ? ' ' + x.zip : '')].filter(v => v && v.trim()) : [];
  return html`<article class="doc">
    <header class="doc-head">
      <div class="doc-brand">${logoUrl ? html`<img class="doc-logo" src="${logoUrl}" alt="">` : ''}
        <div><div class="doc-company">${d.company.name}</div>
          <div class="doc-muted">${[d.company.phone, d.company.email].filter(Boolean).join(' · ')}</div>
          ${d.company.license ? html`<div class="doc-muted">License ${d.company.license}</div>` : ''}</div></div>
      <div class="doc-meta"><div class="doc-kind">${KIND[d.kind] || 'Proposal'}</div>
        <div>No. P-${d.number}</div>${d.valid_until && !d.signed ? html`<div>Valid until ${fmtDate(d.valid_until)}</div>` : ''}</div>
    </header>
    <section class="doc-parties">
      <div><div class="doc-label">Prepared for</div><b>${d.customer.name}</b>${d.customer.contact_name && d.customer.contact_name !== d.customer.name ? html`<div>Attn: ${d.customer.contact_name}</div>` : ''}
        ${addr(d.customer).map(l => html`<div>${l}</div>`)}</div>
      ${d.site ? html`<div><div class="doc-label">Location</div><b>${d.site.name}</b>${addr(d.site).map(l => html`<div>${l}</div>`)}</div>` : ''}
      <div><div class="doc-label">Prepared by</div>${d.prepared_by || d.company.name}<div class="doc-muted">${d.company.address || ''}</div></div>
    </section>
    <h1 class="doc-title">${d.title}</h1>
    ${d.intro ? html`<div class="doc-intro">${d.intro}</div>` : ''}
    ${d.items.length ? html`<table class="doc-table"><thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Amount</th></tr></thead>
      <tbody>${d.items.map(i => html`<tr><td>${i.description}</td><td class="r">${i.qty}</td><td class="r">${money(i.unit_price)}</td><td class="r">${money(i.qty * i.unit_price)}</td></tr>`)}</tbody></table>
      <div class="doc-totals">
        <div><span>Subtotal</span><span>${money(d.subtotal)}</span></div>
        ${d.tax ? html`<div><span>Tax (${d.tax_rate}%)</span><span>${money(d.tax)}</span></div>` : ''}
        <div class="grand"><span>Total</span><span>${money(d.total)}</span></div>
        ${d.deposit ? html`<div class="doc-deposit"><span>Due at signing (${d.deposit_percent}% deposit)</span><span>${money(d.deposit)}</span></div>` : ''}
      </div>` : ''}
    ${d.monthly_amount ? html`<div class="doc-monthly"><div><div class="doc-label">Monthly service</div><b>${d.monthly_description || 'Monthly service'}</b>
        ${d.term_months ? html`<div class="doc-muted">${d.term_months}-month term, then month to month</div>` : ''}</div>
      <div class="doc-monthly-amt">${money(d.monthly_amount)}<span>/month</span></div></div>` : ''}
    <section class="doc-terms"><div class="doc-label">Terms & conditions</div><div class="doc-terms-body">${d.terms}</div></section>
    ${d.signed ? html`<section class="doc-signed">
      <div class="doc-sigline">${signatureUrl ? html`<img src="${signatureUrl}" alt="Signature of ${d.signed.by}">` : ''}</div>
      <div><b>${d.signed.by}</b>${d.signed.title ? html`, ${d.signed.title}` : ''} — signed electronically ${new Date(d.signed.at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</div>
      <div class="doc-muted doc-hash">Document fingerprint (SHA-256): ${d.signed.hash}</div></section>` : ''}
  </article>`;
}

/**
 * Invoice in the same style as proposals. d = { number, issue_date, due_date, period, status, notes, subtotal, tax, tax_rate,
 * total, paid, balance, items[], customer{}, company{}, signed{by, at, number} }. Rows get data-item for click-to-edit.
 */
export function renderInvoice(d, { logoUrl, signatureUrl, editable = false } = {}) {
  const addr = x => [x.billing_address, [x.city, x.state].filter(Boolean).join(', ') + (x.zip ? ' ' + x.zip : '')].filter(v => v && v.trim());
  const stamp = ['paid', 'void', 'overdue'].includes(d.status) ? d.status : null;
  return html`<article class="doc">
    <header class="doc-head">
      <div class="doc-brand">${logoUrl ? html`<img class="doc-logo" src="${logoUrl}" alt="">` : ''}
        <div><div class="doc-company">${d.company.name}</div>
          <div class="doc-muted" style="white-space:pre-wrap">${d.company.address || ''}</div>
          <div class="doc-muted">${[d.company.phone, d.company.email].filter(Boolean).join(' · ')}</div>
          ${d.company.license ? html`<div class="doc-muted">License ${d.company.license}</div>` : ''}</div></div>
      <div class="doc-meta"><div class="doc-kind">Invoice</div><div>No. ${d.number}</div>
        ${stamp ? html`<div class="doc-status"><span class="stamp ${stamp}">${stamp}</span></div>` : ''}</div>
    </header>
    <section class="doc-parties">
      <div><div class="doc-label">Bill to</div><b>${d.customer.name}</b>${d.customer.contact_name && d.customer.contact_name !== d.customer.name ? html`<div>Attn: ${d.customer.contact_name}</div>` : ''}
        ${addr(d.customer).map(l => html`<div>${l}</div>`)}${d.customer.account_number ? html`<div class="doc-muted">Account ${d.customer.account_number}</div>` : ''}</div>
      <div><div class="doc-label">Issued</div>${fmtDate(d.issue_date)}${d.period ? html`<div class="doc-muted">Service period ${d.period}</div>` : ''}</div>
      <div><div class="doc-label">Due</div><b>${fmtDate(d.due_date)}</b></div>
      <div><div class="doc-label">Amount due</div><b style="font-size:18px">${money(d.balance)}</b></div>
    </section>
    <table class="doc-table"><thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead>
      <tbody>${d.items.length ? d.items.map(i => html`<tr ${editable && i.id ? raw(`class="click" data-item="${i.id}" title="Click to edit"`) : ''}>
          <td>${i.description}${i.taxable ? html` <span class="doc-muted" title="Taxable">·T</span>` : ''}</td><td class="r">${i.qty}</td><td class="r">${money(i.unit_price)}</td><td class="r">${money(i.qty * i.unit_price)}</td></tr>`)
        : html`<tr><td colspan="4" class="doc-muted">No line items yet.</td></tr>`}</tbody></table>
    <div class="doc-totals">
      <div><span>Subtotal</span><span>${money(d.subtotal)}</span></div>
      ${d.tax ? html`<div><span>Tax (${d.tax_rate || 0}%)</span><span>${money(d.tax)}</span></div>` : ''}
      <div class="grand"><span>Total</span><span>${money(d.total)}</span></div>
      ${d.paid ? html`<div><span>Paid</span><span>−${money(d.paid)}</span></div>` : ''}
      <div class="doc-deposit"><span>Balance due</span><span>${money(d.balance)}</span></div>
    </div>
    ${d.notes ? html`<div class="doc-intro" style="margin-top:20px">${d.notes}</div>` : ''}
    ${d.signed ? html`<section class="doc-signed"><div class="doc-label">Work completed and accepted</div>
      <div class="doc-sigline">${signatureUrl ? html`<img src="${signatureUrl}" alt="Customer signature">` : ''}</div>
      <div><b>${d.signed.by}</b> — ${new Date(d.signed.at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}${d.signed.number ? ` · job SC-${d.signed.number}` : ''}</div></section>` : ''}
    ${d.company.footer ? html`<footer class="doc-terms"><div class="doc-terms-body" style="columns:1">${d.company.footer}</div></footer>` : ''}
  </article>`;
}

// ---------------------------------------------------------------- fire inspection report
const RCLS = { pass: 'pass', fail: 'fail', na: 'na' };
const RTXT = { pass: 'Pass', fail: 'Fail', na: 'N/A', replaced: 'Replaced', removed: 'Removed', missing: 'Missing' };
/** Printable inspection report, shared by the staff app and the customer / fire-marshal link. */
export function renderInspectionReport(d, { signatureUrl, logoUrl } = {}) {
  const addr = x => x ? [x.address || x.service_address || x.billing_address, [x.city, x.state].filter(Boolean).join(', ') + (x.zip ? ' ' + x.zip : '')].filter(v => v && v.trim()) : [];
  const sections = [...new Set(d.items.map(i => i.section))];
  const resultCls = { pass: 'pass', deficiencies: 'warn', fail: 'fail' }[d.result] || '';
  return html`<article class="doc ir">
    <header class="doc-head">
      <div class="doc-brand">${logoUrl ? html`<img class="doc-logo" src="${logoUrl}" alt="">` : ''}
        <div><div class="doc-company">${d.company.name}</div>
          <div class="doc-muted">${[d.company.phone, d.company.email].filter(Boolean).join(' · ')}</div>
          ${d.company.license ? html`<div class="doc-muted">License ${d.company.license}</div>` : ''}</div></div>
      <div class="doc-meta"><div class="doc-kind">Inspection report</div><div>No. FIR-${d.number}</div><div>${fmtDate(d.inspection_date)}</div></div>
    </header>
    <h1 class="doc-title">${d.type_label}${d.standard ? html` <span class="ir-std">${d.standard}</span>` : ''}</h1>
    <section class="doc-parties">
      <div><div class="doc-label">Property</div><b>${d.customer.name}</b>${d.site ? html`<div>${d.site.name}</div>` : ''}${addr(d.site || d.customer).map(l => html`<div>${l}</div>`)}</div>
      <div><div class="doc-label">System</div>${d.system ? html`<b>${d.system.location || d.system.system_type}</b><div>${[d.system.panel_brand, d.system.panel_model].filter(Boolean).join(' ')}</div>` : html`<b>${d.type_label}</b>`}
        <div>${d.frequency[0].toUpperCase() + d.frequency.slice(1)} inspection</div></div>
      <div><div class="doc-label">Inspector</div><b>${d.inspector_name || '—'}</b>${d.inspector_license ? html`<div>License / cert. ${d.inspector_license}</div>` : ''}
        ${d.ahj ? html`<div class="doc-muted" style="margin-top:6px">AHJ: ${d.ahj}</div>` : ''}</div>
    </section>
    ${d.result ? html`<div class="ir-result ${resultCls}"><span>Result</span><b>${d.result_label}</b>${d.deficiency_list.length ? html`<span>${d.deficiency_list.length} deficienc${d.deficiency_list.length === 1 ? 'y' : 'ies'}</span>` : ''}</div>` : html`<div class="ir-result"><span>Status</span><b>Draft — not completed</b></div>`}
    ${d.deficiency_list.length ? html`<section class="ir-sec"><div class="doc-label">Deficiencies</div>
      <ol class="ir-defs">${d.deficiency_list.map(x => html`<li><b>${x.what}</b>${x.where ? html` <span class="doc-muted">(${x.where})</span>` : ''}${x.note ? html`<div>${x.note}</div>` : ''}</li>`)}</ol></section>` : ''}
    ${sections.map(sec => html`<section class="ir-sec"><div class="doc-label">${sec}</div>
      <table class="doc-table ir-table"><tbody>${d.items.filter(i => i.section === sec).map(i => {
        const a = d.checklist[i.id] || {};
        return html`<tr><td>${i.text}${a.note ? html`<div class="doc-muted">${a.note}</div>` : ''}</td>
          <td class="r ir-cell">${i.kind === 'value' ? (a.r === 'na' ? 'N/A' : a.v || '—') : a.r ? html`<span class="ir-r ${RCLS[a.r]}">${RTXT[a.r]}</span>` : '—'}</td></tr>`;
      })}</tbody></table></section>`)}
    ${d.devices.length ? html`<section class="ir-sec"><div class="doc-label">Devices tested (${d.devices.length}) — ${d.devices.filter(x => x.result === 'pass').length} passed, ${d.devices.filter(x => x.result === 'fail').length} failed</div>
      <table class="doc-table ir-table"><thead><tr><th>Device</th><th>Location</th><th>Address</th><th class="r">Result</th></tr></thead>
      <tbody>${d.devices.map(x => html`<tr><td>${x.type}</td><td>${x.location}${x.note ? html`<div class="doc-muted">${x.note}</div>` : ''}</td><td>${x.address || ''}</td>
        <td class="r">${x.result ? html`<span class="ir-r ${RCLS[x.result]}">${RTXT[x.result]}</span>` : '—'}</td></tr>`)}</tbody></table></section>` : ''}
    ${d.units.length ? html`<section class="ir-sec"><div class="doc-label">Extinguishers (${d.units.length})</div>
      <table class="doc-table ir-table"><thead><tr><th>Unit</th><th>Location</th><th>Service</th><th class="r">Result</th></tr></thead>
      <tbody>${d.units.map(u => html`<tr><td>${u.label}${u.result === 'replaced' && u.new_serial ? html`<div class="doc-muted">New S/N ${u.new_serial}</div>` : ''}</td><td>${u.location}${u.note ? html`<div class="doc-muted">${u.note}</div>` : ''}</td>
        <td>${(u.services || []).join(', ')}</td><td class="r">${u.result ? html`<span class="ir-r ${u.result === 'pass' ? 'pass' : ['fail', 'missing'].includes(u.result) ? 'fail' : 'na'}">${RTXT[u.result]}</span>` : '—'}</td></tr>`)}</tbody></table></section>` : ''}
    ${d.recommendations ? html`<section class="ir-sec"><div class="doc-label">Recommendations</div><div style="white-space:pre-wrap">${d.recommendations}</div></section>` : ''}
    ${d.notes ? html`<section class="ir-sec"><div class="doc-label">Notes</div><div style="white-space:pre-wrap">${d.notes}</div></section>` : ''}
    <section class="doc-signed ir-sign">
      <div><div class="doc-label">Inspected by</div><b>${d.inspector_name || ''}</b>${d.completed_at ? html`<div class="doc-muted">Completed ${new Date(d.completed_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</div>` : ''}</div>
      <div><div class="doc-label">Customer representative</div>${d.signed_by ? html`<div class="doc-sigline">${signatureUrl ? html`<img src="${signatureUrl}" alt="Signature of ${d.signed_by}">` : ''}</div><b>${d.signed_by}</b>`
        : html`<div class="doc-muted">Not signed on site</div>`}</div>
    </section>
    <p class="doc-muted ir-foot">This report reflects the condition of the systems listed at the time of inspection. Deficiencies should be corrected promptly; impairments must be reported to the AHJ and monitoring company as required.</p>
  </article>`;
}
