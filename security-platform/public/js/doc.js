// Renders a proposal / agreement as a clean, printable document. Used by the
// staff app (preview) and the customer's public signing page, so both show the same thing.
import { html, money, fmtDate } from './ui.js';

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
