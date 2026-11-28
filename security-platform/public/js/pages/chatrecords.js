// Incident review of team chat (owners/admins). Every conversation opened is logged with the reason.
import { html, mount, $, fmtDate, fmtDateTime, badge, loading, toast } from '../ui.js';
import { GET, POST } from '../api.js';

let reason = '';

export async function render(view, _, query) {
  loading(view);
  const people = await GET('/api/users').catch(() => []);
  const head = html`<div class="crumbs"><a href="#/chat">Team chat</a> /</div>
    <div class="page-head"><div><h1>Chat records</h1><div class="sub">Recover any conversation — including direct messages and deleted messages — when there’s an incident. Each conversation you open is written to the activity log with your reason.</div></div></div>`;
  let list;
  try { list = await GET('/api/chat/records/channels', { q: query.q || '', user_id: query.user || '' }); }
  catch (e) {
    if (e.code !== 'review_required') throw e;
    mount(view, html`${head}<div class="card" style="max-width:620px"><div class="card-head"><h2>Start a review</h2></div><div class="card-body">
      <div class="err-box hidden" data-err></div>
      <div class="field"><label for="rv_reason">What happened / why are you reviewing?</label><input id="rv_reason" type="text" placeholder="e.g. Customer complaint about Jen’s visit on 11/20" value="${reason}"></div>
      <p class="small muted">The review stays open for 30 minutes. Owners are alerted when an administrator starts one.</p>
      <button class="btn primary" data-start>Start review</button></div></div>`);
    $('[data-start]', view).addEventListener('click', async () => {
      reason = $('#rv_reason', view).value;
      try { await POST('/api/chat/records/review', { reason }); render(view, _, query); }
      catch (err) { const b = $('[data-err]', view); b.textContent = err.message; b.classList.remove('hidden'); }
    });
    return;
  }
  mount(view, html`${head}
    <div class="filters"><input type="search" data-q placeholder="Search message text (incl. deleted)" value="${query.q || ''}" aria-label="Search messages">
      <select data-user aria-label="Person"><option value="">Anyone</option>${people.map(p => html`<option value="${p.id}" ${String(p.id) === query.user ? 'selected' : ''}>${p.name}</option>`)}</select>
      <button class="btn" data-go>Search</button></div>
    <div class="grid g2 records">
      <div class="card"><div class="card-head"><h2>Conversations (${list.length})</h2></div><div class="card-body stack" style="gap:6px">${list.length ? list.map(c => html`<a class="alert-row info" href="#/chat-records?${new URLSearchParams({ ...query, open: c.id })}" style="color:inherit;text-decoration:none${String(c.id) === query.open ? ';box-shadow:0 0 0 2px var(--primary)' : ''}">
          <div><b>${c.title}</b><div class="small muted">${c.people || ''}</div>
            <div class="small muted">${c.messages} messages${c.deleted ? html` · ${badge(`${c.deleted} deleted`, 'warn')}` : ''}${c.matches ? ` · ${c.matches} match${c.matches > 1 ? 'es' : ''}` : ''}${c.last ? ` · last ${fmtDate(c.last.slice(0, 10))}` : ''}</div></div></a>`)
        : html`<div class="muted">Nothing found.</div>`}</div></div>
      <div class="card" data-transcript>${query.open ? '' : html`<div class="empty">Open a conversation to read it.</div>`}</div></div>`);
  const go = () => { location.hash = `#/chat-records?${new URLSearchParams({ q: $('[data-q]', view).value, user: $('[data-user]', view).value })}`; };
  $('[data-go]', view).addEventListener('click', go);
  $('[data-q]', view).addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  if (query.open) {
    const box = $('[data-transcript]', view);
    try {
      const t = await GET(`/api/chat/records/channels/${query.open}`);
      const q = (query.q || '').toLowerCase();
      mount(box, html`<div class="card-head"><div><h2>${t.title}</h2><div class="small muted">${t.people.join(', ')}</div></div>
          <a class="btn sm" href="/api/chat/records/channels/${t.id}/export">Export CSV</a></div>
        <div class="card-body stack" style="gap:8px">${t.messages.map(m => html`<div class="record-msg ${m.deleted_at ? 'deleted' : ''} ${q && m.body?.toLowerCase().includes(q) ? 'match' : ''}">
          <div class="small muted"><b>${m.user_name}</b> · ${fmtDateTime(m.created_at.replace(' ', 'T'))}${m.deleted_at ? html` · ${badge(`deleted ${fmtDateTime(m.deleted_at.replace(' ', 'T'))}`, 'warn')}` : ''}</div>
          ${m.photo ? html`<a href="${m.photo}" target="_blank" rel="noopener"><img src="${m.photo}" alt="Photo" loading="lazy" style="max-width:220px;border-radius:8px;margin-top:4px"></a>` : ''}
          ${m.body ? html`<div style="white-space:pre-wrap">${m.body}</div>` : ''}</div>`)}</div>`);
    } catch (e) { mount(box, html`<div class="empty">${e.message}</div>`); toast(e.message, 'error'); }
  }
}
