import { html, mount, $, $$, typeBadge, openForm, toast, relDays, loading } from '../ui.js';
import { GET, R } from '../api.js';
import { can } from '../app.js';
import { STAGES, STAGE_INFO } from '../schema.js';

export async function render(view, _, query) {
  let type = query.type || '';
  mount(view, html`
    <div class="page-head"><div><h1>Sales pipeline</h1><div class="sub">Every customer's stage, from first call to installed. Drag a card to move it.</div></div>
      <div class="actions">
        <div class="seg" data-type><button data-v="">All</button><button data-v="residential">Residential</button><button data-v="commercial">Commercial</button></div>
        ${can.customers() ? html`<button class="btn primary" data-new>+ New lead</button>` : ''}</div></div>
    <div data-board></div>`);
  const board = $('[data-board]', view);

  const load = async () => {
    $$('[data-type] button', view).forEach(b => b.classList.toggle('on', b.dataset.v === type));
    loading(board);
    const rows = await GET('/api/pipeline', { type });
    mount(board, html`<div class="pipeline">${STAGES.map(st => {
      const cards = rows.filter(r => r.stage === st);
      return html`<section class="pipe-col" data-stage="${st}">
        <header><b>${STAGE_INFO[st].label}</b> <span class="count">${cards.length}</span><div class="small muted">${st === 'active' ? 'Won in the last 30 days' : STAGE_INFO[st].desc}</div></header>
        <div class="pipe-cards">${cards.map(c => html`<a class="pipe-card" href="#/customers/${c.id}" draggable="${can.customers() ? 'true' : 'false'}" data-id="${c.id}">
          <b>${c.name}</b><div class="row" style="gap:6px;margin-top:4px">${typeBadge(c.type)}${c.lead_source ? html`<span class="small muted">${c.lead_source}</span>` : ''}</div>
          <div class="small muted" style="margin-top:4px">${[c.city, c.phone].filter(Boolean).join(' · ')}</div>
          ${c.stage_since ? html`<div class="small muted">in stage since ${relDays(c.stage_since.slice(0, 10))}</div>` : ''}</a>`)}
          ${cards.length ? '' : html`<div class="pipe-empty">Nothing here</div>`}</div></section>`;
    })}</div>`);
    if (!can.customers()) return;
    $$('.pipe-card', board).forEach(card => card.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', card.dataset.id); }));
    $$('.pipe-col', board).forEach(col => {
      col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('drop'); });
      col.addEventListener('dragleave', () => col.classList.remove('drop'));
      col.addEventListener('drop', async e => {
        e.preventDefault();
        col.classList.remove('drop');
        const id = Number(e.dataTransfer.getData('text/plain'));
        const row = rows.find(r => r.id === id);
        if (!row || row.stage === col.dataset.stage) return;
        try { await R.update('customers', id, { stage: col.dataset.stage }); toast(`${row.name} → ${STAGE_INFO[col.dataset.stage].label}`); load(); }
        catch (err) { toast(err.message, 'error'); }
      });
    });
  };
  $('[data-type]', view).addEventListener('click', e => { if (e.target.dataset.v !== undefined) { type = e.target.dataset.v; load(); } });
  $('[data-new]', view)?.addEventListener('click', () => openForm('customers', { title: 'New lead', defaults: { stage: 'lead', status: 'prospect' }, onSaved: c => { location.hash = `#/customers/${c.id}`; } }));
  await load();
}
