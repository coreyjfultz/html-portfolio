// In-app voice calls between team members (WebRTC). The server only rings the other person and
// passes connection details along the chat stream; the audio goes directly between devices
// (or through the relay server when a network blocks that).
import { html, mount, $, toast, initials } from './ui.js';
import { GET, POST } from './api.js';

const DEVICE = (() => { try { let d = sessionStorage.getItem('so-device'); if (!d) { d = Math.random().toString(36).slice(2, 12); sessionStorage.setItem('so-device', d); } return d; } catch { return Math.random().toString(36).slice(2, 12); } })();
let me = null;
let cur = null; // { call, role: 'caller'|'callee', state, pc, stream, pending: [], remoteSet, startedAt }
let ui = null;

export function initCalls(user) { me = user; checkRinging(); }

// Opened from a "📞 … is calling" notification: show the call if it's still ringing.
async function checkRinging() {
  const c = await GET('/api/calls/active').catch(() => null);
  if (c && c.status === 'ringing' && c.callee_id === me.id && !cur) incoming(c);
}

// ---------------------------------------------------------------- the call screen
function draw() {
  if (!cur) { ui?.remove(); ui = null; stopRing(); return; }
  if (!ui) { ui = document.createElement('div'); ui.className = 'call-ui'; ui.setAttribute('role', 'dialog'); ui.setAttribute('aria-label', 'Call'); document.body.append(ui); }
  const other = cur.role === 'caller' ? cur.call.callee_name : cur.call.caller_name;
  const s = cur.state;
  const label = s === 'incoming' ? 'is calling you…' : s === 'calling' ? 'Ringing…' : s === 'connecting' ? 'Connecting…' : s === 'active' ? '' : s === 'reconnecting' ? 'Reconnecting…' : '';
  mount(ui, html`<div class="call-card">
    <div class="call-avatar ${s === 'incoming' || s === 'calling' ? 'pulse' : ''}">${initials(other)}</div>
    <div class="call-name">${other}</div>
    <div class="call-status" data-status>${s === 'active' ? '0:00' : label}</div>
    ${cur.note ? html`<div class="call-note small">${cur.note}</div>` : ''}
    <div class="call-actions">
      ${s === 'incoming' ? html`<button class="call-btn decline" data-decline aria-label="Decline">✕<span>Decline</span></button><button class="call-btn answer" data-answer aria-label="Answer">📞<span>Answer</span></button>`
        : html`<button class="call-btn mute ${cur.muted ? 'on' : ''}" data-mute aria-pressed="${cur.muted ? 'true' : 'false'}" aria-label="${cur.muted ? 'Unmute' : 'Mute'}">${cur.muted ? '🔇' : '🎙️'}<span>${cur.muted ? 'Unmute' : 'Mute'}</span></button>
               <button class="call-btn decline" data-hangup aria-label="Hang up">✕<span>Hang up</span></button>`}
    </div><audio data-remote autoplay playsinline></audio></div>`);
  $('[data-answer]', ui)?.addEventListener('click', answer);
  $('[data-decline]', ui)?.addEventListener('click', () => { POST(`/api/calls/${cur.call.id}/decline`).catch(() => {}); end(); });
  $('[data-hangup]', ui)?.addEventListener('click', hangup);
  $('[data-mute]', ui)?.addEventListener('click', () => { cur.muted = !cur.muted; cur.stream?.getAudioTracks().forEach(t => { t.enabled = !cur.muted; }); draw(); });
  if (cur.remote) { const a = $('[data-remote]', ui); a.srcObject = cur.remote; a.play?.().catch(() => {}); }
}
let clock = null;
function tick() {
  clearInterval(clock);
  clock = setInterval(() => {
    if (!cur || cur.state !== 'active') return;
    const s = Math.floor((Date.now() - cur.startedAt) / 1000);
    const el = ui && $('[data-status]', ui);
    if (el) el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 1000);
}

// A soft ring made in the browser (no sound file). Phones may only play it after a tap.
let ring = null;
function startRing(kind) {
  stopRing();
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const beep = () => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = kind === 'out' ? 440 : 620; g.gain.value = 0.0001;
      o.connect(g); g.connect(ctx.destination); o.start();
      g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (kind === 'out' ? 1.2 : 0.8));
      o.stop(ctx.currentTime + 1.3);
    };
    beep();
    ring = { ctx, t: setInterval(beep, kind === 'out' ? 3000 : 1800) };
    if (kind === 'in') navigator.vibrate?.([400, 300, 400]);
  } catch { /* no audio */ }
}
function stopRing() { if (ring) { clearInterval(ring.t); ring.ctx.close().catch(() => {}); ring = null; } navigator.vibrate?.(0); }

// ---------------------------------------------------------------- placing / answering
async function micStream() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser can’t make calls. Use Chrome, Safari or Edge, and open the app over https.');
  try { return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }); }
  catch (e) { throw new Error(e.name === 'NotAllowedError' ? 'Microphone access is off for this site. Allow it in the browser or phone settings, then try again.' : 'Couldn’t use the microphone.'); }
}

export async function startCall(userId, name) {
  if (cur) { toast('You’re already on a call', 'error'); return; }
  let stream;
  try { stream = await micStream(); } catch (e) { toast(e.message, 'error'); return; }
  cur = { call: { callee_name: name, caller_name: me.name }, role: 'caller', state: 'calling', stream, pending: [] };
  draw();
  try {
    const r = await POST('/api/calls', { user_id: userId });
    if (!cur) { POST(`/api/calls/${r.call.id}/hangup`).catch(() => {}); return; } // hung up while dialing
    cur.call = r.call;
    if (!r.online) cur.note = `${name.split(' ')[0]} doesn’t have the app open. They’ll get a notification if it’s turned on.`;
    startRing('out'); draw();
  } catch (e) { end(); toast(e.message, 'error'); }
}

function incoming(call) {
  cur = { call, role: 'callee', state: 'incoming', pending: [] };
  draw(); startRing('in');
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    try { const n = new Notification(`📞 ${call.caller_name} is calling`, { body: 'Tap to answer', tag: `call-${call.id}`, icon: '/icons/icon-192.png', requireInteraction: true }); n.onclick = () => window.focus(); } catch { /* not allowed */ }
  }
}

async function answer() {
  stopRing();
  try { cur.stream = await micStream(); } catch (e) { toast(e.message, 'error'); POST(`/api/calls/${cur.call.id}/decline`).catch(() => {}); end(); return; }
  cur.state = 'connecting'; draw();
  try {
    await setupPeer();
    await POST(`/api/calls/${cur.call.id}/answer`, { device: DEVICE });
  } catch (e) { toast(e.message, 'error'); end(); }
}

async function setupPeer() {
  const cfg = await GET('/api/calls/config');
  const pc = new RTCPeerConnection({ iceServers: cfg.ice || [] });
  cur.pc = pc;
  cur.stream.getTracks().forEach(t => pc.addTrack(t, cur.stream));
  pc.onicecandidate = e => { if (e.candidate && cur) signal({ candidate: e.candidate.toJSON() }); };
  pc.ontrack = e => { if (!cur) return; cur.remote = e.streams[0]; const a = ui && $('[data-remote]', ui); if (a) { a.srcObject = cur.remote; a.play?.().catch(() => {}); } };
  pc.onconnectionstatechange = () => {
    if (!cur || cur.pc !== pc) return;
    const st = pc.connectionState;
    if (st === 'connected') { if (cur.state !== 'active') { cur.state = 'active'; cur.startedAt ||= Date.now(); cur.note = ''; draw(); tick(); } else if (cur.state === 'reconnecting') { cur.state = 'active'; draw(); } clearTimeout(cur.dropT); }
    if (st === 'disconnected') { cur.state = 'reconnecting'; draw(); clearTimeout(cur.dropT); cur.dropT = setTimeout(() => { if (cur?.pc === pc && pc.connectionState !== 'connected') failed(); }, 12000); }
    if (st === 'failed') failed();
  };
  // Give up if the devices can't reach each other within 20 seconds.
  cur.connectT = setTimeout(() => { if (cur?.pc === pc && pc.connectionState !== 'connected') failed(); }, 20000);
}

function failed() {
  if (!cur) return;
  const id = cur.call.id;
  POST(`/api/calls/${id}/hangup`, { reason: 'failed' }).catch(() => {});
  end();
  toast('The call couldn’t connect. One of the networks may be blocking it; an owner can turn on a relay server under Settings → Phone & on-call.', 'error');
}

const signal = data => cur?.call.id && POST(`/api/calls/${cur.call.id}/signal`, { data, device: DEVICE }).catch(() => {});

async function onSignal(ev) {
  if (!cur || !cur.pc || ev.call.id !== cur.call.id) return;
  const pc = cur.pc, d = ev.data;
  try {
    if (d.sdp) {
      await pc.setRemoteDescription(d.sdp);
      cur.remoteSet = true;
      for (const c of cur.pending.splice(0)) await pc.addIceCandidate(c).catch(() => {});
      if (d.sdp.type === 'offer') { const ans = await pc.createAnswer(); await pc.setLocalDescription(ans); signal({ sdp: pc.localDescription.toJSON() }); }
    } else if (d.candidate) {
      if (cur.remoteSet) await pc.addIceCandidate(d.candidate).catch(() => {});
      else cur.pending.push(d.candidate);
    }
  } catch (e) { console.error('call signal', e); }
}

function hangup() {
  if (cur?.call.id) POST(`/api/calls/${cur.call.id}/hangup`).catch(() => {});
  end();
}

function end() {
  if (!cur) return;
  clearTimeout(cur.connectT); clearTimeout(cur.dropT); clearInterval(clock);
  try { cur.pc?.close(); } catch { /* closed */ }
  cur.stream?.getTracks().forEach(t => t.stop());
  cur = null; draw();
}

// ---------------------------------------------------------------- events from the chat stream
export async function onCallEvent(ev) {
  if (!me) return;
  const c = ev.call;
  if (ev.action === 'ring') {
    if (c.callee_id === me.id && !cur) incoming(c);
    else if (c.callee_id === me.id && cur) POST(`/api/calls/${c.id}/decline`).catch(() => {}); // already on a call
    return;
  }
  if (!cur || cur.call.id !== c.id) return;
  if (ev.action === 'answered') {
    stopRing();
    if (cur.role === 'callee') {
      if (ev.device && ev.device !== DEVICE && cur.state === 'incoming') { end(); toast('Answered on another device'); }
      return;
    }
    // Caller: the other person picked up. Start the connection.
    cur.state = 'connecting'; cur.note = ''; draw();
    try {
      await setupPeer();
      const offer = await cur.pc.createOffer();
      await cur.pc.setLocalDescription(offer);
      signal({ sdp: cur.pc.localDescription.toJSON() });
    } catch (e) { toast(e.message, 'error'); hangup(); }
  } else if (ev.action === 'signal') {
    if (cur.role === 'callee' && ev.device === DEVICE) return;
    onSignal(ev);
  } else if (ev.action === 'ended') {
    const st = c.status;
    const who = cur.role === 'caller' ? c.callee_name : c.caller_name;
    const mine = ev.by === me.id;
    end();
    if (!mine) toast(st === 'declined' ? `${who.split(' ')[0]} can’t talk right now` : st === 'missed' ? (c.callee_id === me.id ? `Missed call from ${who}` : 'No answer') : st === 'failed' ? 'The call couldn’t connect' : 'Call ended');
  }
}
