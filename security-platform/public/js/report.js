// Read-only fire inspection report for the customer and the fire marshal (AHJ).
import { html, mount, $ } from './ui.js';
import { renderInspectionReport } from './doc.js';

const token = location.pathname.split('/').pop();
const root = document.getElementById('root');
(async () => {
  const res = await fetch(`/api/public/report/${token}`);
  const d = await res.json().catch(() => ({}));
  if (!res.ok) { mount(root, html`<div class="public-card"><h2>Report not available</h2><p>${d.error || 'This link is not valid.'}</p></div>`); return; }
  document.title = `Inspection report FIR-${d.number} — ${d.customer.name}`;
  mount(root, html`<div class="public-actions no-print"><button class="btn" data-print>Print / save PDF</button></div>
    ${renderInspectionReport(d, { signatureUrl: d.signed_by ? `/api/public/report/${token}/signature` : null, logoUrl: d.company.logo ? '/api/public/logo' : null })}`);
  $('[data-print]', root).addEventListener('click', () => window.print());
})();
