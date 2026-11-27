// Technician ratings from customer surveys (owners/admins).
import { html, mount, $, $$, fmtDateTime, badge, dataTable, loading, toast, promptForm } from '../ui.js';
import { GET, POST } from '../api.js';
import { refresh } from '../app.js';

export const starsText = n => n == null ? '—' : html`<span class="rating-stars" title="${n} of 5">${'★'.repeat(Math.round(n))}${'☆'.repeat(5 - Math.round(n))}</span> <b>${n}</b>`;
const trend = t => t.length ? html`<span class="trend" title="${t.map(x => `${x.month}: ${x.avg} (${x.n})`).join('\n')}">${t.map(x => html`<span style="height:${Math.max(4, (x.avg / 5) * 28)}px"></span>`)}</span>` : html`<span class="muted small">—</span>`;

export async function render(view, _, query) {
  loading(view);
  const days = Number(query.days) || 90;
  const d = await GET('/api/ratings', { days, ...(query.tech ? { technician_id: query.tech } : {}) });
  const c = d.company;
  mount(view, html`<div class="page-head"><div><h1>Customer ratings</h1><div class="sub">From the short survey customers get after each job</div></div>
      <div class="actions"><select data-days aria-label="Period">${[[30, 'Last 30 days'], [90, 'Last 90 days'], [365, 'Last 12 months'], [3650, 'All time']].map(([v, l]) => html`<option value="${v}" ${v === days ? 'selected' : ''}>${l}</option>`)}</select>
        <a class="btn" href="#/settings?tab=field">Survey settings</a></div></div>
    <div class="kpis">
      <div class="kpi"><div class="label">Average rating</div><div class="value">${c.avg ?? '—'}</div><div class="hint">${c.answered} responses</div></div>
      <div class="kpi"><div class="label">Response rate</div><div class="value">${c.response_rate == null ? '—' : `${c.response_rate}%`}</div><div class="hint">${c.sent} surveys sent</div></div>
      <div class="kpi"><div class="label">On time</div><div class="value">${c.on_time == null ? '—' : `${c.on_time}%`}</div></div>
      <div class="kpi ${c.low ? 'alert' : ''}"><div class="label">3 stars or less</div><div class="value">${c.low}</div></div>
    </div>
    <div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Technicians</h2></div><div class="card-body flush">${dataTable({
      rows: d.technicians, href: t => `#/ratings?tech=${t.id}&days=${days}`, empty: 'No technicians yet.',
      columns: [
        { label: 'Technician', render: t => html`<span class="dot" style="background:${t.color}"></span> <b>${t.name}</b>` },
        { label: 'Rating (tech)', render: t => starsText(t.tech_avg) },
        { label: 'Responses', render: t => `${t.answered} of ${t.sent}`, cls: 'num' },
        { label: 'On time', render: t => t.on_time == null ? '—' : html`<span style="${t.on_time < 90 ? 'color:var(--bad);font-weight:600' : ''}">${t.on_time}%</span>`, cls: 'num' },
        { label: 'Low (≤3★)', render: t => t.low ? html`<b style="color:var(--bad)">${t.low}</b>` : '0', cls: 'num' },
        { label: '6-month trend', render: t => trend(t.trend) },
      ] })}</div></div>
    <div class="card"><div class="card-head"><h2>${query.tech ? `Responses — ${d.technicians.find(t => t.id === Number(query.tech))?.name || ''}` : 'Recent responses'}</h2>
      ${query.tech ? html`<a class="small" href="#/ratings?days=${days}">Show everyone</a>` : ''}</div>
      <div class="card-body stack" style="gap:8px">${d.responses.length ? d.responses.map(r => html`<div class="alert-row survey-row ${r.rating <= 3 || r.on_time === 0 ? 'low' : 'info'} ${Number(query.survey) === r.id ? 'hl' : ''}" id="sv${r.id}">
          <div><div>${starsText(r.rating)} <span class="muted small">overall</span>${r.tech_rating ? html` · ${starsText(r.tech_rating)} <span class="muted small">${r.tech || 'tech'}</span>` : ''}${r.on_time === 0 ? html` · ${badge('late', 'bad')}` : r.on_time === 1 ? html` · ${badge('on time', 'good')}` : ''}</div>
            ${r.comment ? html`<div style="margin-top:4px">“${r.comment}”</div>` : ''}
            <div class="small muted" style="margin-top:4px"><a href="#/customers/${r.customer_id}">${r.customer}</a> · <a href="#/calls/${r.service_call_id}">SC-${r.number}</a> ${r.title} · ${fmtDateTime(r.responded_at)}${r.contact_ok ? ' · OK to contact' : ''}</div>
            ${r.followed_up_at ? html`<div class="small" style="margin-top:4px">✔ Followed up by ${r.followed_up_by}: ${r.follow_up_note}</div>` : ''}</div>
          ${(r.rating <= 3 || r.on_time === 0) && !r.followed_up_at ? html`<button class="btn sm" data-follow="${r.id}">Log follow-up</button>` : ''}</div>`)
        : html`<div class="empty">No responses in this period yet.</div>`}</div></div>`);
  $('[data-days]', view).addEventListener('change', e => { location.hash = `#/ratings?days=${e.target.value}${query.tech ? `&tech=${query.tech}` : ''}`; });
  $$('[data-follow]', view).forEach(b => b.addEventListener('click', () => promptForm({
    title: 'Follow-up', fields: [{ name: 'note', label: 'What was done (call, credit, return visit…)', type: 'text', required: true }], submitLabel: 'Save',
    onSubmit: async x => { await POST(`/api/ratings/${b.dataset.follow}/follow-up`, x); toast('Saved'); refresh(); },
  })));
  if (query.survey) document.getElementById(`sv${query.survey}`)?.scrollIntoView({ block: 'center' });
}

/** Small block on a completed job: survey status, answers, send button. */
export async function jobSurveyBlock(el, c) {
  const s = await GET(`/api/service_calls/${c.id}/survey`).catch(() => null);
  mount(el, html`<dt>Customer survey</dt><dd>${!s ? html`<span class="muted">Not sent</span> <button class="btn sm" data-send>Send now</button>`
    : s.responded_at ? html`${starsText(s.rating)}${s.tech_rating ? html` · tech ${starsText(s.tech_rating)}` : ''}${s.on_time === 0 ? html` ${badge('late', 'bad')}` : ''}${s.comment ? html`<div class="small">“${s.comment}”</div>` : ''}`
    : html`<span class="muted">Sent ${fmtDateTime(s.sent_at)} by ${s.channel || '…'}${s.opened_at ? ' · opened' : ''} · no answer yet</span>`}</dd>`);
  $('[data-send]', el)?.addEventListener('click', async () => {
    try { await POST(`/api/service_calls/${c.id}/survey`); toast('Survey sent'); jobSurveyBlock(el, c); } catch (e) { toast(e.message, 'error'); }
  });
}
