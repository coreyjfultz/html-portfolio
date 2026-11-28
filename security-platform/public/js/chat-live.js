// Keeps one live connection to the server for chat: updates the unread badges, lets the chat
// page append messages as they arrive, and pops a small notice elsewhere in the app.
import { toast } from './ui.js';
import { GET, POST, api } from './api.js';

let source = null;
let myId = null;
export const listeners = new Set();

export async function refreshBadge() {
  const u = await GET('/api/chat/unread').catch(() => null);
  const n = u?.total || 0;
  document.querySelectorAll('[data-chat-badge]').forEach(b => { b.textContent = n > 99 ? '99+' : String(n); b.hidden = !n; });
  return n;
}

export function startChat(user) {
  myId = user.id;
  stopChat();
  refreshBadge();
  if (!('EventSource' in window)) return;
  source = new EventSource('/api/chat/stream');
  source.addEventListener('message', e => {
    const ev = JSON.parse(e.data);
    listeners.forEach(fn => fn(ev));
    refreshBadge();
    const mine = ev.message.user_id === myId;
    const viewing = location.hash === `#/chat/${ev.channel_id}`;
    if (mine || viewing) return;
    const text = ev.message.body || '📷 Photo';
    toast(`💬 ${ev.message.user_name}: ${text.slice(0, 80)}`);
    // Desktop notice when the tab is in the background (phones get push notifications instead).
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try { const n = new Notification(ev.message.user_name, { body: text.slice(0, 140), tag: `chat-${ev.channel_id}`, icon: '/icons/icon-192.png' }); n.onclick = () => { window.focus(); location.hash = `#/chat/${ev.channel_id}`; }; } catch { /* not allowed here */ }
    }
  });
  for (const t of ['read', 'deleted']) source.addEventListener(t, e => { const ev = JSON.parse(e.data); listeners.forEach(fn => fn({ ...ev, type: t })); refreshBadge(); });
}
export function stopChat() { source?.close(); source = null; }

// ---------------------------------------------------------------- push notifications on this device
const urlB64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
export async function pushState() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const reg = await navigator.serviceWorker.ready;
  return (await reg.pushManager.getSubscription()) ? 'on' : 'off';
}
export async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications were not allowed. You can turn them on in the browser’s site settings.');
  const reg = await navigator.serviceWorker.ready;
  const { key } = await GET('/api/push/key');
  const sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(key) });
  await POST('/api/push/subscribe', { endpoint: sub.endpoint, user_agent: navigator.userAgent });
}
export async function disablePush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) { await api('DELETE', `/api/push/subscribe?endpoint=${encodeURIComponent(sub.endpoint)}`); await sub.unsubscribe(); }
}
