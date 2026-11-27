// Customer-facing page for reviewing and signing a proposal or agreement.
import { html, mount, $, signaturePad, toast } from './ui.js';
import { renderDocument } from './doc.js';

const token = location.pathname.split('/').pop();
const root = document.getElementById('root');
const call = async (method, url, body) => {
  const res = await fetch(url, { method, headers: { 'X-Requested-With': 'SecureOps', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
};

async function load() {
  let d;
  try { d = await call('GET', `/api/public/proposals/${token}`); }
  catch (e) { mount(root, html`<div class="public-card"><h2>Link not available</h2><p>${e.message}</p></div>`); return; }
  document.title = `${d.title} — ${d.company.name}`;
  const status = {
    signed: html`<div class="banner good">✅ Signed by ${d.signed?.by}. Thank you! Keep this link to view or print your signed copy any time.</div>`,
    declined: html`<div class="banner">You declined this ${d.kind}. If that was a mistake, please contact ${d.company.name}${d.company.phone ? ` at ${d.company.phone}` : ''}.</div>`,
    expired: html`<div class="banner warn">This offer has expired. Please contact ${d.company.name}${d.company.phone ? ` at ${d.company.phone}` : ''} for an updated version.</div>`,
  }[d.status] || '';
  const canSign = ['sent', 'viewed', 'draft'].includes(d.status);
  mount(root, html`
    ${status}
    <div class="public-actions no-print"><button class="btn" data-print>Print / save PDF</button></div>
    ${renderDocument(d, { signatureUrl: d.signed ? `/api/public/proposals/${token}/signature` : null, logoUrl: d.company.logo ? '/api/public/logo' : null })}
    ${canSign ? html`<section class="public-card sign-card no-print" id="sign">
      <h2>Accept & sign</h2>
      <div class="err-box hidden" data-err></div>
      <div class="form-grid">
        <div class="field"><label for="s_name">Full name</label><input id="s_name" type="text" autocomplete="name" value="${d.customer.contact_name || ''}"></div>
        <div class="field"><label for="s_title">Title (optional)</label><input id="s_title" type="text" placeholder="Owner, Manager…"></div>
        <div class="field full"><label for="s_email">Email for your signed copy</label><input id="s_email" type="email" autocomplete="email" value="${d.customer.email || ''}"></div>
      </div>
      <div class="row" style="justify-content:space-between;margin-top:14px"><b>Sign below</b><button class="btn sm ghost" data-clear>Clear</button></div>
      <canvas class="sig-pad" data-pad aria-label="Sign here with your finger or mouse"></canvas>
      <label class="row small" style="margin-top:12px;align-items:flex-start"><input type="checkbox" data-agree style="margin-top:3px">
        <span>I have read and agree to this ${d.kind}${d.deposit ? `, including the ${d.deposit_percent}% deposit` : ''}${d.monthly_amount ? ' and the monthly service fee' : ''}. I agree to sign electronically and that my electronic signature is as valid as a handwritten one.</span></label>
      <div class="row" style="margin-top:16px;justify-content:space-between">
        <button class="btn ghost danger" data-decline>Decline</button>
        <button class="btn primary" data-sign style="min-width:180px">Sign ${d.kind}</button></div>
    </section>` : ''}
    <footer class="public-foot">Questions? Contact ${d.company.name}${d.company.phone ? html` · <a href="tel:${d.company.phone}">${d.company.phone}</a>` : ''}${d.company.email ? html` · <a href="mailto:${d.company.email}">${d.company.email}</a>` : ''}</footer>`);
  $('[data-print]').addEventListener('click', () => window.print());
  if (!canSign) return;
  const pad = signaturePad($('[data-pad]'));
  $('[data-clear]').addEventListener('click', () => pad.clear());
  const err = $('[data-err]');
  const fail = m => { err.textContent = m; err.classList.remove('hidden'); err.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  $('[data-sign]').addEventListener('click', async () => {
    if ($('#s_name').value.trim().length < 2) return fail('Please type your full name.');
    if (pad.isEmpty()) return fail('Please sign in the box.');
    if (!$('[data-agree]').checked) return fail('Please tick the box to agree.');
    $('[data-sign]').disabled = true;
    try {
      await call('POST', `/api/public/proposals/${token}/sign`, { name: $('#s_name').value, title: $('#s_title').value, email: $('#s_email').value, image: pad.toDataURL(), agree: true });
      window.scrollTo(0, 0);
      load();
    } catch (e) { fail(e.message); $('[data-sign]').disabled = false; }
  });
  $('[data-decline]').addEventListener('click', async () => {
    const reason = prompt(`Sorry to hear that. Would you like to tell ${d.company.name} why? (optional)`);
    if (reason === null) return;
    try { await call('POST', `/api/public/proposals/${token}/decline`, { reason }); load(); } catch (e) { toast(e.message, 'error'); }
  });
}
load();
