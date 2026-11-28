// Customer satisfaction survey (public link from the text / email after a job).
import { html, mount, $, $$ } from './ui.js';

const token = location.pathname.split('/').pop();
const root = document.getElementById('root');
const call = async (method, body) => {
  const res = await fetch(`/api/public/survey/${token}`, { method, headers: { 'X-Requested-With': 'SecureOps', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || 'Something went wrong');
  return d;
};
const stars = name => html`<div class="stars" role="radiogroup" aria-label="${name}">${[1, 2, 3, 4, 5].map(n => html`<label><input type="radio" name="${name}" value="${n}"><span aria-hidden="true">★</span><span class="sr">${n} star${n > 1 ? 's' : ''}</span></label>`)}</div>`;
const header = d => d.company.logo ? html`<img class="survey-logo" src="/api/public/logo" alt="${d.company.name}">` : html`<h2>${d.company.name}</h2>`;

function thanks(d) {
  mount(root, html`<div class="public-card survey-card">${header(d)}
    <h1>Thank you!</h1>
    <p>Your feedback goes straight to the owner${d.rating <= 3 ? ' — we’ll be in touch to make it right' : ''}.</p>
    ${d.review_url ? html`<p>Would you share that on Google? It really helps a local business.</p><a class="btn primary lg" href="${d.review_url}" target="_blank" rel="noopener">Leave a review</a>` : ''}
    ${d.company.phone ? html`<p class="small muted" style="margin-top:18px">Questions? Call ${d.company.phone}</p>` : ''}</div>`);
}

(async () => {
  let d;
  try { d = await call('GET'); } catch (e) { mount(root, html`<div class="public-card"><h2>Survey not available</h2><p>${e.message}</p></div>`); return; }
  if (d.answered) return thanks(d);
  const tech = d.tech || 'our technician';
  mount(root, html`<form class="public-card survey-card" data-form>${header(d)}
    <h1>How did we do?</h1>
    <p class="muted">${d.job || 'Your service visit'}${d.date ? ` · ${new Date(d.date + 'T12:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}` : ''}</p>
    <div class="err-box hidden" data-err></div>
    <div class="survey-q"><b>Overall, how happy are you with the visit?</b>${stars('rating')}</div>
    <div class="survey-q"><b>How was ${tech}?</b>${stars('tech_rating')}</div>
    <div class="survey-q"><b>Did ${tech} arrive on time?</b><div class="seg survey-seg"><label class="pass"><input type="radio" name="on_time" value="yes"> Yes</label><label class="fail"><input type="radio" name="on_time" value="no"> No</label></div></div>
    <div class="survey-q"><label for="sv_c"><b>Anything you’d like to tell us?</b> <span class="muted small">(optional)</span></label><textarea id="sv_c" name="comment" rows="3"></textarea></div>
    <label class="check-row"><input type="checkbox" name="contact_ok"> <span>It’s OK to contact me about my answers</span></label>
    <button class="btn primary lg" type="submit" style="margin-top:14px;width:100%">Send</button></form>`);
  const form = $('[data-form]', root);
  $$('.stars', form).forEach(g => g.addEventListener('change', () => {
    const v = Number($('input:checked', g)?.value || 0);
    $$('label', g).forEach((l, i) => l.classList.toggle('on', i < v));
  }));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(form);
    const err = $('[data-err]', form);
    if (!f.get('rating')) { err.textContent = 'Tap the stars to rate the visit.'; err.classList.remove('hidden'); return; }
    try { thanks(await call('POST', { rating: f.get('rating'), tech_rating: f.get('tech_rating'), on_time: f.get('on_time'), comment: f.get('comment'), contact_ok: !!f.get('contact_ok') })); }
    catch (ex) { err.textContent = ex.message; err.classList.remove('hidden'); }
  });
})();
