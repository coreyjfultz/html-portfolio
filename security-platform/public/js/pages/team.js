// "Our team": the org chart — who reports to whom, with one-tap message and call.
import { html, mount, $$, icon, initials, loading } from '../ui.js';
import { GET, POST } from '../api.js';
import { state, can } from '../app.js';
import { ROLE_INFO } from '../schema.js';

export async function render(view) {
  loading(view);
  const people = await GET('/api/org');
  const byId = new Map(people.map(p => [p.id, p]));
  const kids = id => people.filter(p => p.supervisor_id === id);
  const roots = people.filter(p => !p.supervisor_id || !byId.has(p.supervisor_id));
  const calls = state.settings.app_calls_enabled !== '0';
  const node = (p, depth = 0) => {
    const under = kids(p.id);
    return html`<li class="org-node">
      <div class="org-card ${p.id === state.user.id ? 'me' : ''}">
        <span class="avatar">${initials(p.name)}</span>
        <span class="org-text"><b>${p.name}${p.id === state.user.id ? ' (you)' : ''}</b>
          <span class="small muted">${p.job_title || ROLE_INFO[p.role]?.label || p.role}${under.length ? ` · ${under.length} report${under.length > 1 ? 's' : ''}` : ''}</span>
          <span class="small">${p.online ? html`<span class="online-dot"></span> in the app` : ''}${p.out_today ? html` 🌴 out today` : ''}</span></span>
        ${p.id !== state.user.id ? html`<span class="org-actions"><button class="btn sm ghost" data-msg="${p.id}" aria-label="Message ${p.name}" title="Message">💬</button>${calls ? html`<button class="btn sm ghost" data-call="${p.id}" data-name="${p.name}" aria-label="Call ${p.name}" title="Call in the app">📞</button>` : ''}</span>` : ''}
      </div>
      ${under.length ? html`<ul class="org-list">${under.map(k => node(k, depth + 1))}</ul>` : ''}</li>`;
  };
  const unassigned = roots.filter(p => !kids(p.id).length && p.role !== 'owner');
  const tops = roots.filter(p => !unassigned.includes(p));
  mount(view, html`<div class="page-head"><div><h1>Our team</h1><div class="sub">Who reports to whom. Supervisors approve time off for their team.</div></div>
      ${can.manage() ? html`<div class="actions"><a class="btn" href="#/settings?tab=users">${icon('network')} Set supervisors</a></div>` : ''}</div>
    <div class="card"><div class="card-body"><ul class="org-list root">${tops.map(p => node(p))}</ul>
      ${unassigned.length ? html`<h3 class="lib-group">No supervisor set</h3><ul class="org-list root">${unassigned.map(p => node(p))}</ul>` : ''}</div></div>`);
  $$('[data-msg]', view).forEach(b => b.addEventListener('click', async () => { const r = await POST('/api/chat/channels', { kind: 'direct', user_id: Number(b.dataset.msg) }); location.hash = `#/chat/${r.id}`; }));
  $$('[data-call]', view).forEach(b => b.addEventListener('click', async () => (await import('../call.js')).startCall(Number(b.dataset.call), b.dataset.name)));
}
