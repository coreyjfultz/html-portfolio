// Training library (videos, manuals, how-tos), support contacts, and the optional help assistant.
import { html, mount, $, $$, raw, icon, badge, dataTable, openForm, openModal, loading, toast, confirmDialog } from '../ui.js';
import { GET, POST, R, api } from '../api.js';
import { state, refresh } from '../app.js';
import { G, RESOURCES } from '../schema.js';

const KIND_ICON = { video: 'play', manual: 'file-text', article: 'book-open', link: 'external-link' };
const KIND_LABEL = RESOURCES.training_resources.fields.find(f => f.name === 'kind').optionLabels;
const CATEGORIES = RESOURCES.training_resources.fields.find(f => f.name === 'category').options;
const toB64 = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f); });
const canManage = () => G.manage.includes(state.user.role);

// YouTube / Vimeo links play inside the app (privacy-enhanced YouTube embeds).
export function embedUrl(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.replace(/^www\.|^m\./, '');
  let id = null;
  if (host === 'youtu.be') id = u.pathname.slice(1);
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') id = u.searchParams.get('v') || u.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]+)/)?.[1];
  if (id && /^[\w-]{6,20}$/.test(id)) return `https://www.youtube-nocookie.com/embed/${id}`;
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const v = u.pathname.match(/(?:^|\/)(\d{5,12})(?:\/|$)/)?.[1];
    if (v) return `https://player.vimeo.com/video/${v}`;
  }
  return null;
}

function openItem(it, onChange) {
  const embed = it.url ? embedUrl(it.url) : null;
  const { el, close } = openModal({
    title: it.title, size: embed ? 'lg' : '',
    body: html`<div class="small muted" style="margin-bottom:10px">${[KIND_LABEL[it.kind], it.category, it.manufacturer, it.model].filter(Boolean).join(' · ')}</div>
      ${embed ? html`<div class="video-frame"><iframe src="${embed}" title="${it.title}" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" loading="lazy"></iframe></div>` : ''}
      ${it.file_key ? html`<p><a class="btn primary" href="/api/library/${it.id}/file" target="_blank" rel="noopener">${icon('file-text')} Open ${it.file_name || 'manual'}</a></p>` : ''}
      ${it.url && !embed ? html`<p><a class="btn" href="${it.url}" target="_blank" rel="noopener noreferrer">${icon('external-link')} Open link</a></p>` : ''}
      ${it.body ? html`<div class="article-body">${it.body}</div>` : ''}
      ${!it.body && !it.url && !it.file_key ? html`<div class="muted">Nothing added to this item yet.</div>` : ''}
      ${it.tags ? html`<div class="small muted" style="margin-top:12px">Search words: ${it.tags}</div>` : ''}`,
    foot: html`${canManage() ? html`<button class="btn" data-edit>Edit</button><button class="btn" data-file>${it.file_key ? 'Replace file' : 'Upload PDF'}</button>${it.file_key ? html`<button class="btn ghost danger" data-rmfile>Remove file</button>` : ''}` : ''}<button class="btn primary" data-close>Done</button>`,
  });
  $('[data-edit]', el)?.addEventListener('click', () => { close(); openForm('training_resources', { record: it, onSaved: onChange, onDeleted: onChange, allowDelete: true }); });
  $('[data-file]', el)?.addEventListener('click', () => { close(); uploadFile(it, onChange); });
  $('[data-rmfile]', el)?.addEventListener('click', async () => {
    if (!(await confirmDialog('Remove the file from this item?', { okLabel: 'Remove', danger: true }))) return;
    await api('DELETE', `/api/library/${it.id}/file`); close(); onChange();
  });
}

function uploadFile(it, onChange) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'application/pdf,image/jpeg,image/png';
  input.addEventListener('change', async () => {
    const f = input.files[0];
    if (!f) return;
    if (f.size > 30 * 1024 * 1024) { toast('Files can be up to 30 MB', 'error'); return; }
    toast('Uploading…');
    try { await POST(`/api/library/${it.id}/file`, { data: await toB64(f), file_name: f.name }); toast('File added'); onChange(); }
    catch (e) { toast(e.message, 'error'); }
  });
  input.click();
}

// ---- Help assistant (a small conversation on the library page) ----
const convo = []; // kept while the app is open
function assistantCard(st) {
  if (!st.enabled) return '';
  if (!st.configured) return canManage() ? html`<div class="card" style="margin-bottom:16px"><div class="card-body small muted">${icon('sparkles')} The help assistant is turned on but the server has no API key yet (ANTHROPIC_API_KEY). See the README.</div></div>` : '';
  return html`<div class="card assistant" style="margin-bottom:16px"><div class="card-head"><div><h2>${icon('sparkles')} Ask the help assistant</h2>
      <div class="small muted">Answers from our library, manuals and support contacts, plus general know-how. Double-check anything life-safety. Don’t type customer names, codes or passwords.</div></div>
      ${convo.length ? html`<button class="btn sm ghost" data-clear>New question</button>` : ''}</div>
    <div class="card-body"><div class="assistant-log" data-log>${convo.map(turn)}</div>
      <form class="row assistant-ask" data-ask><input type="text" name="q" placeholder="e.g. How do I default a Qolsys IQ4 installer code?" autocomplete="off" aria-label="Your question" maxlength="2000"><button class="btn primary" type="submit">Ask</button></form>
      <div class="small muted" data-left>${st.limit ? `${Math.max(0, st.limit - st.used)} of ${st.limit} questions left today` : ''}</div></div></div>`;
}
const turn = t => html`<div class="assistant-q">${t.q}</div><div class="assistant-a"><div class="assistant-text">${t.a ?? html`<span class="muted">Thinking…</span>`}</div>
  ${t.sources?.length ? html`<div class="assistant-src small">From the library: ${t.sources.map((s, i) => html`${i ? ', ' : ''}<a href="#" data-src="${s.id}">${s.title}</a>`)}</div>` : ''}
  ${t.id ? html`<div class="row assistant-fb">${t.fb == null ? html`<span class="small muted">Helpful?</span><button class="btn sm ghost" data-fb="1" data-id="${t.id}" aria-label="Helpful">${icon('thumbs-up')}</button><button class="btn sm ghost" data-fb="0" data-id="${t.id}" aria-label="Not helpful">${icon('thumbs-down')}</button>` : html`<span class="small muted">Thanks for the feedback</span>`}</div>` : ''}</div>`;

function wireAssistant(view, st, items, onChange) {
  const form = $('[data-ask]', view);
  if (!form) return;
  const redraw = () => {
    mount($('[data-log]', view), html`${convo.map(turn)}`);
    $$('[data-src]', view).forEach(a => a.addEventListener('click', e => { e.preventDefault(); const it = items.find(x => x.id === Number(a.dataset.src)); if (it) openItem(it, onChange); }));
    $$('[data-fb]', view).forEach(b => b.addEventListener('click', async () => {
      const t = convo.find(x => x.id === Number(b.dataset.id));
      await POST(`/api/assistant/${t.id}/feedback`, { helpful: b.dataset.fb === '1' }); t.fb = b.dataset.fb === '1'; redraw();
    }));
  };
  redraw();
  $('[data-clear]', view)?.addEventListener('click', () => { convo.length = 0; onChange(); });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const q = form.q.value.trim();
    if (q.length < 3) return;
    const history = convo.filter(t => t.a && t.id).slice(-4).map(t => ({ q: t.q, a: t.a }));
    const t = { q }; convo.push(t); form.q.value = ''; form.querySelector('button').disabled = true; redraw();
    try {
      const r = await POST('/api/assistant/ask', { question: q, history });
      Object.assign(t, { a: r.answer, sources: r.sources, id: r.id });
      if (r.limit) $('[data-left]', view).textContent = `${Math.max(0, r.limit - r.used)} of ${r.limit} questions left today`;
    } catch (err) { t.a = `⚠️ ${err.message}`; }
    form.querySelector('button').disabled = false; redraw(); form.q.focus();
  });
}

export async function render(view, _, query) {
  loading(view);
  const [items, st] = await Promise.all([R.list('training_resources'), GET('/api/assistant/status')]);
  const q = (query.q || '').toLowerCase().trim(), cat = query.cat || '', kind = query.kind || '';
  const shown = items.filter(it => (!cat || it.category === cat) && (!kind || it.kind === kind)
    && (!q || [it.title, it.manufacturer, it.model, it.tags, it.body, it.category].join(' ').toLowerCase().includes(q)));
  const counts = Object.fromEntries(CATEGORIES.map(c => [c, items.filter(i => i.category === c).length]));
  const go = p => { const s = new URLSearchParams({ ...(q ? { q } : {}), ...(cat ? { cat } : {}), ...(kind ? { kind } : {}), ...p }); for (const [k, v] of [...s]) if (!v) s.delete(k); location.hash = `#/library${s.toString() ? `?${s}` : ''}`; };
  const groups = cat || q ? [[cat || 'Results', shown]] : CATEGORIES.map(c => [c, shown.filter(i => i.category === c)]).filter(([, l]) => l.length);
  mount(view, html`<div class="page-head"><div><h1>Training library</h1><div class="sub">How-to videos, manuals and tips for the field</div></div>
      <div class="actions"><a class="btn" href="#/support">${icon('life-buoy')} Support contacts</a>${canManage() ? html`<button class="btn primary" data-add>+ Add</button>` : ''}</div></div>
    ${assistantCard(st)}
    <div class="filters"><input type="search" data-q value="${query.q || ''}" placeholder="Search: panel model, “zone programming”, reset…" aria-label="Search the library">
      <select data-cat aria-label="Category"><option value="">All categories</option>${CATEGORIES.filter(c => counts[c]).map(c => html`<option value="${c}" ${c === cat ? 'selected' : ''}>${c} (${counts[c]})</option>`)}</select>
      <select data-kind aria-label="Type"><option value="">All types</option>${Object.entries(KIND_LABEL).map(([k, l]) => html`<option value="${k}" ${k === kind ? 'selected' : ''}>${l}</option>`)}</select></div>
    ${!items.length ? html`<div class="card"><div class="empty">The library is empty.${canManage() ? ' Add a YouTube video, a manual PDF or a quick how-to.' : ' Ask the office to add videos and manuals.'}</div></div>`
      : !shown.length ? html`<div class="card"><div class="empty">Nothing matches. Try fewer words${st.enabled && st.configured ? ', or ask the help assistant above' : ''}.</div></div>`
      : groups.map(([g, list]) => html`<h3 class="lib-group">${g}</h3><div class="lib-grid">${list.map(it => html`<button class="lib-card" data-open="${it.id}">
          <span class="lib-ico kind-${it.kind}">${icon(KIND_ICON[it.kind] || 'book-open')}</span>
          <span class="lib-text"><b>${it.title}</b><span class="small muted">${[KIND_LABEL[it.kind], it.manufacturer, it.model].filter(Boolean).join(' · ')}</span>
          ${it.file_key ? html`<span class="small">${badge('PDF', 'info')}</span>` : ''}</span></button>`)}</div>`)}`);
  const onChange = () => refresh();
  $('[data-add]', view)?.addEventListener('click', () => openForm('training_resources', { onSaved: row => { if (row?.kind === 'manual' && row.id) toast('Saved. Open it and tap “Upload PDF” to add the manual.'); onChange(); } }));
  $$('[data-open]', view).forEach(b => b.addEventListener('click', () => openItem(items.find(i => i.id === Number(b.dataset.open)), onChange)));
  let t;
  $('[data-q]', view).addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => go({ q: e.target.value }), 350); });
  $('[data-cat]', view).addEventListener('change', e => go({ cat: e.target.value }));
  $('[data-kind]', view).addEventListener('change', e => go({ kind: e.target.value }));
  if (query.q) { const i = $('[data-q]', view); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  wireAssistant(view, st, items, onChange);
}

// ---- Support contacts ----
export async function support(view, _, query) {
  loading(view);
  const rows = await R.list('vendor_contacts');
  const q = (query.q || '').toLowerCase().trim();
  const shown = rows.filter(c => !q || [c.company, c.department, c.products, c.contact_name, c.notes].join(' ').toLowerCase().includes(q));
  const canEdit = G.staff.includes(state.user.role);
  mount(view, html`<div class="page-head"><div><h1>Support contacts</h1><div class="sub">Manufacturer tech support, RMA desks, distributor reps and helpdesks</div></div>
      <div class="actions"><a class="btn" href="#/library">${icon('graduation-cap')} Training library</a>${canEdit ? html`<button class="btn primary" data-add>+ Add contact</button>` : ''}</div></div>
    <div class="filters"><input type="search" data-q value="${query.q || ''}" placeholder="Search company, product…" aria-label="Search contacts"></div>
    ${!shown.length ? html`<div class="card"><div class="empty">${rows.length ? 'Nothing matches.' : 'No support contacts yet.'}</div></div>`
      : html`<div class="lib-grid">${shown.map(c => html`<div class="card contact-card"><div class="card-body">
        <div class="row" style="justify-content:space-between;align-items:flex-start"><div><b>${c.company}</b><div class="small muted">${[c.department, c.products].filter(Boolean).join(' · ')}</div></div>
          ${canEdit ? html`<button class="btn sm ghost" data-edit="${c.id}">Edit</button>` : ''}</div>
        <div class="stack" style="gap:4px;margin-top:8px">
          ${c.phone ? html`<a class="btn sm primary" href="tel:${c.phone.replace(/[^\d+,]/g, '')}">📞 ${c.phone}</a>` : ''}
          ${c.email ? html`<a class="small" href="mailto:${c.email}">${c.email}</a>` : ''}
          ${c.website ? html`<a class="small" href="${/^https?:\/\//.test(c.website) ? c.website : `https://${c.website}`}" target="_blank" rel="noopener noreferrer">${c.website.replace(/^https?:\/\//, '')} ↗</a>` : ''}
          ${c.contact_name ? html`<div class="small">Contact: ${c.contact_name}</div>` : ''}
          ${c.hours ? html`<div class="small muted">Hours: ${c.hours}</div>` : ''}
          ${c.account_number ? html`<div class="small">Our account #: <b>${c.account_number}</b></div>` : ''}
          ${c.notes ? html`<div class="small" style="white-space:pre-wrap">${c.notes}</div>` : ''}</div></div></div>`)}</div>`}`);
  $('[data-add]', view)?.addEventListener('click', () => openForm('vendor_contacts', { onSaved: refresh }));
  $$('[data-edit]', view).forEach(b => b.addEventListener('click', () => openForm('vendor_contacts', { record: rows.find(r => r.id === Number(b.dataset.edit)), onSaved: refresh, onDeleted: refresh, allowDelete: true })));
  let t;
  $('[data-q]', view).addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { location.hash = `#/support${e.target.value ? `?q=${encodeURIComponent(e.target.value)}` : ''}`; }, 350); });
  if (query.q) { const i = $('[data-q]', view); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
}

// ---- Settings tab ----
export async function settingsPane(pane, { settingsCards, wireSettingsCards }) {
  const [s, st, log] = await Promise.all([GET('/api/settings'), GET('/api/assistant/status'), GET('/api/assistant/log')]);
  mount(pane, html`${settingsCards(s, [
    { title: 'Help assistant (optional)', intro: html`<p class="small muted" style="margin-top:0">Techs and staff can ask how-to questions from the Training library page. Answers use Claude (by Anthropic), the same AI service that reads supplier invoices, with your library items, manual PDFs and support contacts as reference. Questions and the matching library items are sent to Anthropic; no customer records are sent.</p>
        <p class="small" style="margin-top:0">${st.configured ? html`${badge('API key set', 'good')}` : html`${badge('No API key', 'warn')} Put ANTHROPIC_API_KEY in the server’s .env file, then restart.`}</p>`,
      fields: [
        ['assistant_enabled', 'Turn on the help assistant', 'check'],
        ['assistant_daily_limit', 'Questions per person per day (0 = no limit)', 'number'],
        ['assistant_effort', 'Answer depth', 'select', [['low', 'Quick (fastest, lowest cost)'], ['medium', 'Balanced'], ['high', 'Thorough (slower)']]],
      ], note: 'Each question costs a few cents at most. Anthropic bills the account the API key belongs to.' },
  ])}
  <div class="card" style="margin-top:16px"><div class="card-head"><div><h2>Recent questions</h2><div class="small muted">See what people ask, to spot what the library is missing</div></div></div>
    <div class="card-body flush">${dataTable({
      rows: log.slice(0, 50), empty: 'No questions yet.',
      columns: [
        { label: 'When', render: l => l.created_at.slice(5, 16).replace(' ', ' at ') },
        { label: 'Who', render: l => l.user_name || '—' },
        { label: 'Question', render: l => html`<details><summary>${l.question}</summary><div class="small" style="white-space:pre-wrap;margin-top:6px">${l.answer || ''}</div></details>` },
        { label: 'Result', render: l => l.status === 'error' ? badge('error', 'bad') : l.status === 'refused' ? badge('declined', 'warn') : l.helpful === 1 ? badge('helpful', 'good') : l.helpful === 0 ? badge('not helpful', 'bad') : '' },
      ] })}</div></div>`);
  wireSettingsCards(pane);
}
