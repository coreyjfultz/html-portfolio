// Team chat screen: conversations on the left, the open conversation on the right
// (on a phone: the list, then the conversation full screen).
import { html, mount, $, $$, fmtDate, fmtTime, toast, openModal, pickPhotos, resizeImage, initials, confirmDialog } from '../ui.js';
import { GET, POST, api } from '../api.js';
import { state } from '../app.js';
import { listeners, refreshBadge, pushState, enablePush, disablePush } from '../chat-live.js';

const KIND_ICON = { team: '📣', group: '👥', direct: '', job: '🔧' };
let unsubscribe = null;

const when = t => {
  if (!t) return '';
  const d = t.slice(0, 10), today = new Date().toISOString().slice(0, 10);
  return d === today ? fmtTime(t.replace(' ', 'T')) : fmtDate(d);
};

export async function render(view, params = []) {
  unsubscribe?.();
  const openId = Number(params[0]) || null;
  const chans = await GET('/api/chat/channels');
  const push = await pushState().catch(() => 'unsupported');
  mount(view, html`<div class="chat ${openId ? 'has-open' : ''}">
    <aside class="chat-list card">
      <div class="card-head"><h2>Team chat</h2><button class="btn sm primary" data-new>+ New</button></div>
      ${push === 'off' ? html`<div class="note small chat-push">🔔 Get a notification on this device for new messages. <button class="btn sm" data-push>Turn on</button></div>`
        : push === 'blocked' ? html`<div class="note small chat-push">Notifications are blocked for this site in your browser settings.</div>` : ''}
      <nav class="chat-chans">${chans.map(c => html`<a href="#/chat/${c.id}" class="chat-chan ${c.id === openId ? 'on' : ''}">
        <span class="avatar sm">${KIND_ICON[c.kind] || initials(c.title)}</span>
        <span class="chat-chan-main"><span class="row" style="justify-content:space-between;gap:6px"><b class="ellipsis">${c.title}</b><span class="small muted">${when(c.last?.at)}</span></span>
          <span class="small muted ellipsis">${c.last ? `${c.last.user_name.split(' ')[0]}: ${c.last.text}` : 'No messages yet'}</span></span>
        ${c.unread ? html`<span class="chat-unread">${c.unread}</span>` : c.muted ? html`<span class="small muted" title="Muted">🔕</span>` : ''}</a>`)}</nav>
      ${push === 'on' ? html`<div class="small muted" style="padding:10px 16px">🔔 Notifications on for this device · <a href="#" data-pushoff>turn off</a></div>` : ''}
    </aside>
    <section class="chat-main card" data-main>${openId ? '' : html`<div class="empty">Pick a conversation, or start one with “+ New”.</div>`}</section></div>`);
  $('[data-new]', view).addEventListener('click', newDialog);
  $('[data-push]', view)?.addEventListener('click', async () => { try { await enablePush(); toast('Notifications on for this device'); render(view, params); } catch (e) { toast(e.message, 'error'); } });
  $('[data-pushoff]', view)?.addEventListener('click', async e => { e.preventDefault(); await disablePush(); render(view, params); });
  if (openId) await conversation($('[data-main]', view), openId, () => render(view, params));
}

async function conversation(box, id, rerender) {
  let info;
  try { info = await GET(`/api/chat/channels/${id}`); } catch (e) { mount(box, html`<div class="empty">${e.message}</div>`); return; }
  let msgs = await GET(`/api/chat/channels/${id}/messages`, { limit: 60 });
  const me = state.user.id;
  mount(box, html`<div class="chat-head"><a class="btn ghost sm chat-back" href="#/chat" aria-label="Back to conversations">←</a>
      <div style="min-width:0"><b class="ellipsis">${KIND_ICON[info.kind] ? `${KIND_ICON[info.kind]} ` : ''}${info.title}</b>
        <div class="small muted ellipsis">${info.kind === 'team' ? 'Everyone in the company' : info.people.map((p, i) => html`${i ? ', ' : ''}${p.name.split(' ')[0]}${info.online.includes(p.id) ? html` <span class="online-dot" title="Online now"></span>` : ''}`)}</div></div>
      <div class="row" style="margin-left:auto">${info.service_call_id ? html`<a class="btn sm" href="#/calls/${info.service_call_id}">Open job</a>` : ''}
        ${info.kind === 'group' ? html`<button class="btn sm ghost" data-members>Members</button>` : ''}
        <button class="btn sm ghost" data-mute title="${info.muted ? 'Unmute' : 'Mute'}">${info.muted ? '🔕' : '🔔'}</button></div></div>
    <div class="chat-msgs" data-msgs></div>
    <form class="chat-compose" data-form><button type="button" class="btn ghost" data-photo aria-label="Attach photo" title="Photo">📷</button>
      <textarea rows="1" data-text placeholder="Message${info.kind === 'team' ? ' everyone' : ''}…" aria-label="Message"></textarea>
      <button class="btn primary" type="submit">Send</button></form>`);
  const list = $('[data-msgs]', box);
  const bubble = (m, prev) => {
    const mine = m.user_id === me;
    const newDay = !prev || prev.created_at.slice(0, 10) !== m.created_at.slice(0, 10);
    const grouped = prev && !newDay && prev.user_id === m.user_id;
    return html`${newDay ? html`<div class="chat-day">${fmtDate(m.created_at.slice(0, 10))}</div>` : ''}
      <div class="chat-msg ${mine ? 'mine' : ''} ${grouped ? 'grouped' : ''}" data-id="${m.id}">
        ${!mine && !grouped ? html`<div class="chat-from">${m.user_name}</div>` : ''}
        <div class="chat-bubble">${m.deleted ? html`<i class="muted">Message deleted</i>` : html`${m.photo ? html`<a href="${m.photo}" target="_blank" rel="noopener"><img src="${m.photo}" alt="Photo from ${m.user_name}" loading="lazy"></a>` : ''}${m.body ? html`<div class="chat-text">${m.body}</div>` : ''}`}
          <span class="chat-time">${fmtTime(m.created_at.replace(' ', 'T'))}</span>
          ${mine && !m.deleted ? html`<button class="chat-del" data-del="${m.id}" aria-label="Delete message" title="Delete">✕</button>` : ''}</div></div>`;
  };
  const draw = (stick = true) => {
    mount(list, msgs.length ? html`${msgs.length >= 60 ? html`<div class="center"><button class="btn sm ghost" data-older>Show older</button></div>` : ''}${msgs.map((m, i) => bubble(m, msgs[i - 1]))}`
      : html`<div class="empty">No messages yet. Say hello 👋</div>`);
    if (stick) list.scrollTop = list.scrollHeight;
    $('[data-older]', list)?.addEventListener('click', async () => {
      const older = await GET(`/api/chat/channels/${id}/messages`, { before: msgs[0].id, limit: 60 });
      const h = list.scrollHeight; msgs = [...older, ...msgs]; draw(false); list.scrollTop = list.scrollHeight - h;
    });
    $$('[data-del]', list).forEach(b => b.addEventListener('click', async () => {
      if (!(await confirmDialog('Delete this message for everyone?', { okLabel: 'Delete', danger: true }))) return;
      try { await api('DELETE', `/api/chat/messages/${b.dataset.del}`); } catch (e) { toast(e.message, 'error'); }
    }));
  };
  draw();
  const markRead = () => POST(`/api/chat/channels/${id}/read`, { last_id: msgs.at(-1)?.id }).then(refreshBadge).catch(() => {});
  markRead();
  // Live updates for this conversation
  const onEvent = ev => {
    if (ev.channel_id !== id) { if (ev.type === 'message') rerenderList(); return; }
    if (ev.type === 'message' && !msgs.some(m => m.id === ev.message.id)) {
      const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
      msgs.push(ev.message); draw(atBottom || ev.message.user_id === me);
      if (!document.hidden) markRead();
    }
    if (ev.type === 'deleted') { const m = msgs.find(x => x.id === ev.message_id); if (m) { m.deleted = true; draw(false); } }
  };
  let listTimer;
  const rerenderList = () => { clearTimeout(listTimer); listTimer = setTimeout(() => { if (location.hash === `#/chat/${id}`) rerender(); }, 400); };
  listeners.add(onEvent);
  unsubscribe = () => listeners.delete(onEvent);
  window.addEventListener('hashchange', () => unsubscribe?.(), { once: true });

  const text = $('[data-text]', box);
  const send = async (payload) => {
    try { await POST(`/api/chat/channels/${id}/messages`, payload); } catch (e) { toast(e.message, 'error'); return false; }
    return true;
  };
  text.addEventListener('input', () => { text.style.height = 'auto'; text.style.height = `${Math.min(text.scrollHeight, 140)}px`; });
  text.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(pointer:fine)').matches) { e.preventDefault(); $('[data-form]', box).requestSubmit(); } });
  $('[data-form]', box).addEventListener('submit', async e => {
    e.preventDefault();
    const body = text.value.trim();
    if (!body) return;
    text.value = ''; text.style.height = 'auto';
    if (!(await send({ body }))) text.value = body;
    text.focus();
  });
  $('[data-photo]', box).addEventListener('click', async () => {
    const files = await pickPhotos();
    for (const f of files) await send({ photo: await resizeImage(f), body: '' });
  });
  $('[data-mute]', box).addEventListener('click', async () => { await POST(`/api/chat/channels/${id}/mute`, { muted: !info.muted }); rerender(); });
  $('[data-members]', box)?.addEventListener('click', () => membersDialog(info, rerender));
  if (matchMedia('(pointer:fine)').matches) text.focus();
}

async function newDialog() {
  const people = await GET('/api/chat/people');
  const { el, close } = openModal({
    title: 'New conversation', size: 'sm',
    body: html`<div class="err-box hidden" data-err></div>
      <div class="field"><label>Message one person</label><div class="stack" style="gap:6px">${people.map(p => html`<button class="btn chat-person" data-dm="${p.id}"><span class="avatar sm">${initials(p.name)}</span> ${p.name} <span class="small muted">${p.role}</span></button>`)}</div></div>
      <h3 style="margin:18px 0 6px">…or start a group</h3>
      <div class="field"><label for="g_name">Group name</label><input id="g_name" type="text" placeholder="e.g. Miller install crew"></div>
      <div class="stack" style="gap:4px;margin-top:8px">${people.map(p => html`<label class="check-row"><input type="checkbox" value="${p.id}" data-gm> <span>${p.name}</span></label>`)}</div>`,
    foot: html`<button class="btn" data-close>Cancel</button><button class="btn primary" data-group>Create group</button>`,
  });
  $$('[data-dm]', el).forEach(b => b.addEventListener('click', async () => {
    const r = await POST('/api/chat/channels', { kind: 'direct', user_id: Number(b.dataset.dm) });
    close(); location.hash = `#/chat/${r.id}`;
  }));
  $('[data-group]', el).addEventListener('click', async () => {
    try {
      const r = await POST('/api/chat/channels', { kind: 'group', name: $('#g_name', el).value, member_ids: $$('[data-gm]:checked', el).map(c => Number(c.value)) });
      close(); location.hash = `#/chat/${r.id}`;
    } catch (e) { const b = $('[data-err]', el); b.textContent = e.message; b.classList.remove('hidden'); }
  });
}

async function membersDialog(info, onDone) {
  const people = await GET('/api/chat/people');
  const inIds = new Set(info.people.map(p => p.id));
  const { el, close } = openModal({
    title: `${info.title} — members`, size: 'sm',
    body: html`<div class="err-box hidden" data-err></div><div class="stack" style="gap:4px">${people.map(p => html`<label class="check-row"><input type="checkbox" value="${p.id}" data-gm ${inIds.has(p.id) ? 'checked' : ''}> <span>${p.name}</span></label>`)}</div>`,
    foot: html`<button class="btn" data-close>Cancel</button><button class="btn primary" data-save>Save</button>`,
  });
  $('[data-save]', el).addEventListener('click', async () => {
    try { await api('PUT', `/api/chat/channels/${info.id}/members`, { member_ids: [state.user.id, ...$$('[data-gm]:checked', el).map(c => Number(c.value))] }); close(); onDone(); }
    catch (e) { const b = $('[data-err]', el); b.textContent = e.message; b.classList.remove('hidden'); }
  });
}
