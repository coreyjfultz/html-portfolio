// Customer portal (separate from the staff app).
import { html, mount, $, $$, money, fmtDate, fmtDateTime, toast, openModal, confirmDialog, todayStr, addDays, esc } from './ui.js';
import { PAYMENT_METHODS } from './schema.js';

const root = document.getElementById('root');
const S = { user: null, accounts: [], account: null, company: {} };

async function api(method, url, body) {
  const res = await fetch(url, { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'SecureOps', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.includes('/login')) { S.user = null; location.hash = '#/login'; }
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}
const acct = (u, extra = {}) => { const q = new URLSearchParams({ ...(S.account ? { account: S.account } : {}), ...extra }); return `${u}?${q}`; };

const STATUS = { paid: 'good', partial: 'warn', overdue: 'bad', sent: 'info', completed: 'good', scheduled: 'info', 'en route': 'primary', 'in progress': 'primary', new: '', signed: 'good', sent_: 'info', viewed: 'info' };
const pill = s => html`<span class="badge ${STATUS[s] || ''}">${s === 'new' ? 'requested' : s}</span>`;

// ------------------------------------------------------------------ boot & routing
async function boot() {
  const st = await api('GET', '/api/portal/state').catch(() => ({ user: null, company: {} }));
  S.company = st.company || {};
  S.user = st.user; S.accounts = st.accounts || [];
  S.account = S.accounts.find(a => String(a.id) === localStorage.getItem('portal_account'))?.id || S.accounts[0]?.id || null;
  document.title = `${S.company.name || ''} — Customer portal`;
  window.onhashchange = route;
  route();
}

const PUBLIC = ['login', 'signup', 'forgot', 'verify', 'accept', 'reset'];
function route() {
  const [page, arg] = location.hash.replace(/^#\/?/, '').split('?')[0].split('/');
  if (PUBLIC.includes(page)) return authPage(page, arg);
  if (!S.user) return authPage('login');
  if (!S.user.verified) return verifyPending();
  shell(page || 'home', arg);
}

function brand() {
  return html`<div class="p-brand">${S.company.logo ? html`<img src="/api/public/logo" alt="">` : html`<img src="/icons/icon.svg" alt="" style="width:28px">`}<span>${S.company.name || 'Customer portal'}</span></div>`;
}

// ------------------------------------------------------------------ sign in / sign up
function authPage(page, token) {
  const titles = { login: 'Sign in', signup: 'Create your account', forgot: 'Reset your password', verify: 'Confirming your email…', accept: 'Set your password', reset: 'Choose a new password' };
  mount(root, html`<div class="login-wrap"><div class="login-card">${brand()}
    <h2 style="margin:0 0 4px">${titles[page]}</h2>
    <p class="muted small" style="margin:0 0 16px">${{
      login: 'View invoices, pay online, request service and more.',
      signup: 'New customer or already with us? Create a login with the email you use with us.',
      forgot: "We'll email you a link to choose a new password.",
      accept: 'Welcome! Choose a password to open your portal.', reset: '', verify: '' }[page]}</p>
    <div class="err-box hidden" data-err></div><div class="note hidden" data-ok></div>
    <form data-form class="stack" style="gap:12px">${{
      login: html`<div class="field"><label for="e">Email</label><input id="e" name="email" type="email" autocomplete="username" required></div>
        <div class="field"><label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" required></div>
        <button class="btn primary">Sign in</button>
        <div class="row small" style="justify-content:space-between"><a href="#/forgot">Forgot password?</a><a href="#/signup">Create an account</a></div>`,
      signup: html`<div class="field"><label for="n">Your name or business name</label><input id="n" name="name" autocomplete="name" required></div>
        <div class="field"><label for="e">Email</label><input id="e" name="email" type="email" autocomplete="email" required></div>
        <div class="field"><label for="ph">Mobile phone</label><input id="ph" name="phone" type="tel" autocomplete="tel"></div>
        <div class="field"><label for="ad">Service address</label><input id="ad" name="address" autocomplete="street-address"></div>
        <div class="seg" data-type><button type="button" class="on" data-v="residential">Home</button><button type="button" data-v="commercial">Business</button></div>
        <div class="field"><label for="p">Password (8+ characters)</label><input id="p" name="password" type="password" autocomplete="new-password" minlength="8" required></div>
        <button class="btn primary">Create account</button><div class="small"><a href="#/login">I already have an account</a></div>`,
      forgot: html`<div class="field"><label for="e">Email</label><input id="e" name="email" type="email" required></div><button class="btn primary">Send reset link</button><div class="small"><a href="#/login">Back to sign in</a></div>`,
      accept: html`<div class="field"><label for="p">New password (8+ characters)</label><input id="p" name="password" type="password" autocomplete="new-password" minlength="8" required></div><button class="btn primary">Continue</button>`,
      reset: html`<div class="field"><label for="p">New password (8+ characters)</label><input id="p" name="password" type="password" autocomplete="new-password" minlength="8" required></div><button class="btn primary">Save password</button>`,
      verify: html`<div class="empty">One moment…</div>` }[page]}</form></div></div>`);
  const form = $('[data-form]');
  const err = m => { const e = $('[data-err]'); e.textContent = m; e.classList.remove('hidden'); };
  const ok = m => { const e = $('[data-ok]'); e.textContent = m; e.classList.remove('hidden'); form.classList.add('hidden'); };
  let type = 'residential';
  $('[data-type]')?.addEventListener('click', e => { if (e.target.dataset.v) { type = e.target.dataset.v; $$('[data-type] button').forEach(b => b.classList.toggle('on', b === e.target)); } });
  if (page === 'verify') {
    api('POST', '/api/portal/verify', { token }).then(() => { location.hash = '#/'; boot(); }).catch(e => { err(e.message); form.classList.add('hidden'); });
    return;
  }
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form));
    try {
      if (page === 'login') { await api('POST', '/api/portal/login', d); location.hash = '#/'; boot(); }
      if (page === 'signup') ok((await api('POST', '/api/portal/signup', { ...d, type })).message);
      if (page === 'forgot') ok((await api('POST', '/api/portal/forgot', d)).message);
      if (page === 'accept' || page === 'reset') { await api('POST', '/api/portal/accept', { token, password: d.password }); location.hash = '#/'; boot(); }
    } catch (x) { err(x.message); }
  });
  form.querySelector('input')?.focus();
}

function verifyPending() {
  mount(root, html`<div class="login-wrap"><div class="login-card">${brand()}<h2>Confirm your email</h2>
    <p>We sent a link to <b>${S.user.email}</b>. Open it to finish setting up your portal.</p>
    <div class="row"><button class="btn" data-resend>Send it again</button><button class="btn ghost" data-out>Sign out</button></div></div></div>`);
  $('[data-resend]').addEventListener('click', async () => { await api('POST', '/api/portal/resend-verification'); toast('Sent — check your inbox'); });
  $('[data-out]').addEventListener('click', logout);
}
async function logout() { await api('POST', '/api/portal/logout'); S.user = null; location.hash = '#/login'; boot(); }

// ------------------------------------------------------------------ signed-in shell
const NAV = [['home', 'Home', '🏠'], ['invoices', 'Invoices', '🧾'], ['service', 'Service', '🔧'], ['payment-methods', 'Payment', '💳'], ['more', 'More', '☰']];
function shell(page, arg) {
  mount(root, html`<header class="p-top">${brand()}
      <div class="row">${S.accounts.length > 1 ? html`<select data-acct aria-label="Account" style="width:auto;min-height:34px">${S.accounts.map(a => html`<option value="${a.id}" ${a.id === S.account ? 'selected' : ''}>${a.name}</option>`)}</select>` : ''}
        <button class="btn ghost sm p-out" data-out>Sign out</button></div></header>
    <nav class="p-nav">${NAV.map(([k, l, i]) => html`<a href="#/${k === 'home' ? '' : k}" class="${(page === k || (k === 'more' && ['agreements', 'systems', 'profile', 'equipment'].includes(page))) ? 'on' : ''}"><span>${i}</span>${l}</a>`)}</nav>
    <main class="p-main" id="pview"><div class="empty">Loading…</div></main>`);
  $('[data-out]').addEventListener('click', logout);
  $('[data-acct]')?.addEventListener('change', e => { S.account = Number(e.target.value); try { localStorage.setItem('portal_account', S.account); } catch {} route(); });
  const view = $('#pview');
  const pages = { home, invoices: arg ? () => invoice(view, arg) : invoices, service, 'request': requestService, 'payment-methods': paymentMethods, more, agreements, systems, profile, equipment };
  (pages[page] || home)(view).catch(e => mount(view, html`<div class="card"><div class="empty">${e.message}</div></div>`));
}

async function home(view) {
  const d = await api('GET', acct('/api/portal/dashboard'));
  const name = S.accounts.find(a => a.id === S.account)?.name || S.user.name;
  mount(view, html`<h1 class="p-h1">Hi, ${S.user.name.split(' ')[0]}</h1><p class="muted" style="margin-top:2px">${name}</p>
    ${d.to_sign.length ? d.to_sign.map(p => html`<a class="p-alert" href="${p.url}"><b>✍ Ready for your signature:</b> ${p.title} <span>Review & sign →</span></a>`) : ''}
    <div class="p-tiles">
      <a class="p-tile ${d.overdue ? 'bad' : ''}" href="#/invoices"><div class="label">Balance due</div><div class="value">${money(d.balance)}</div><div class="hint">${d.open_invoices ? `${d.open_invoices} open invoice${d.open_invoices > 1 ? 's' : ''}${d.overdue ? ` · ${d.overdue} overdue` : ''}` : 'All paid up — thank you!'}</div></a>
      <a class="p-tile" href="#/service"><div class="label">Next visit</div><div class="value" style="font-size:18px">${d.next_visit ? fmtDateTime(d.next_visit.scheduled_start) : 'None scheduled'}</div><div class="hint">${d.next_visit ? `${d.next_visit.title}${d.next_visit.technician ? ` · ${d.next_visit.technician}` : ''}` : ''}</div></a>
      <div class="p-tile"><div class="label">Monthly service</div><div class="value">${money(d.monthly)}</div><div class="hint">monitoring & service plans</div></div>
    </div>
    <div class="p-actions">
      ${d.balance > 0 && S.company.online_payments ? html`<a class="p-action primary" href="#/invoices">💳<span>Pay my bill</span></a>` : ''}
      <a class="p-action" href="#/request">🔧<span>Request service</span></a>
      <a class="p-action" href="#/equipment">📦<span>Request equipment</span></a>
      <a class="p-action" href="#/payment-methods">💳<span>Payment method</span></a>
    </div>
    ${d.open_requests.length ? html`<div class="card" style="margin-top:16px"><div class="card-head"><h2>Your requests</h2></div><div class="card-body">${d.open_requests.map(r => html`<div style="padding:4px 0">${r.title} <span class="muted small">· we'll call to confirm a time</span></div>`)}</div></div>` : ''}
    <p class="small muted" style="text-align:center;margin-top:24px">Need help now? ${S.company.phone ? html`Call <a href="tel:${S.company.phone}">${S.company.phone}</a>` : ''}</p>`);
}

async function invoices(view) {
  const rows = await api('GET', acct('/api/portal/invoices'));
  const paid = new URLSearchParams(location.hash.split('?')[1] || '').get('paid');
  mount(view, html`<h1 class="p-h1">Invoices</h1>${paid ? html`<div class="banner good">Thank you! Your payment is being processed.</div>` : ''}
    <div class="p-list">${rows.length ? rows.map(i => html`<a class="p-row" href="#/invoices/${i.id}">
      <div><b>Invoice #${i.number}</b><div class="small muted">${i.period ? `Monthly · ${i.period}` : i.kind} · ${fmtDate(i.issue_date)}</div></div>
      <div class="right"><b>${money(i.balance > 0 ? i.balance : i.total)}</b><div>${pill(i.status)}</div></div></a>`) : html`<div class="empty">No invoices yet.</div>`}</div>`);
}

async function invoice(view, id) {
  const d = await api('GET', `/api/portal/invoices/${id}`);
  mount(view, html`<div class="row no-print" style="justify-content:space-between;margin-bottom:12px"><a href="#/invoices">← Invoices</a>
      <div class="row"><button class="btn sm" data-print>Print / PDF</button>${d.balance > 0 && S.company.online_payments ? html`<button class="btn primary" data-pay>Pay ${money(d.balance)}</button>` : ''}</div></div>
    ${d.balance > 0 && !S.company.online_payments ? html`<div class="note no-print">To pay, mail a check or call us${S.company.phone ? ` at ${S.company.phone}` : ''}.</div>` : ''}
    <div class="invoice-paper">
      <div class="head"><div><h2 style="font-size:20px">${d.company.name}</h2><div style="white-space:pre-wrap;color:#555">${d.company.address || ''}</div><div style="color:#555">${[d.company.phone, d.company.email].filter(Boolean).join(' · ')}</div></div>
        <div style="text-align:right"><h1>INVOICE</h1><div><b>#${d.number}</b></div><div>Issued ${fmtDate(d.issue_date)}</div><div>Due ${fmtDate(d.due_date)}</div>
          ${['paid', 'overdue'].includes(d.status) ? html`<div style="margin-top:10px"><span class="stamp ${d.status}">${d.status}</span></div>` : ''}</div></div>
      <div style="margin-top:20px"><div style="font-size:12px;color:#555;text-transform:uppercase">Bill to</div><b>${d.customer.name}</b><div>${d.customer.billing_address || ''}</div><div>${[d.customer.city, d.customer.state].filter(Boolean).join(', ')} ${d.customer.zip || ''}</div></div>
      <table><thead><tr><th>Description</th><th style="text-align:right">Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th></tr></thead>
        <tbody>${d.items.map(i => html`<tr><td>${i.description}</td><td style="text-align:right">${i.qty}</td><td style="text-align:right">${money(i.unit_price)}</td><td style="text-align:right">${money(i.qty * i.unit_price)}</td></tr>`)}</tbody></table>
      <div class="totals"><div><span>Subtotal</span><span>${money(d.subtotal)}</span></div><div><span>Tax</span><span>${money(d.tax)}</span></div>
        <div class="grand"><span>Total</span><span>${money(d.total)}</span></div>${d.paid ? html`<div><span>Paid</span><span>−${money(d.paid)}</span></div>` : ''}<div style="font-weight:700"><span>Balance due</span><span>${money(d.balance)}</span></div></div>
      ${d.signed ? html`<div class="doc-sign"><div class="doc-sign-label">Work completed and accepted</div><img src="/api/portal/service-calls/${d.signed.call_id}/signature" alt="Signature"><div>${d.signed.by} · ${fmtDateTime(d.signed.at)}</div></div>` : ''}
      ${d.payments.length ? html`<div style="margin-top:18px;font-size:13px;color:#555">Payments: ${d.payments.map(p => `${fmtDate(p.date)} ${money(p.amount)} (${PAYMENT_METHODS[p.method] || p.method})`).join(' · ')}</div>` : ''}
      ${d.company.footer ? html`<div style="margin-top:22px;color:#555;white-space:pre-wrap;border-top:1px solid #ddd;padding-top:12px">${d.company.footer}</div>` : ''}</div>`);
  $('[data-print]').addEventListener('click', () => window.print());
  $('[data-pay]')?.addEventListener('click', async () => { try { location.href = (await api('POST', `/api/portal/invoices/${id}/pay`)).url; } catch (e) { toast(e.message, 'error'); } });
}

async function service(view) {
  const rows = await api('GET', acct('/api/portal/service-calls'));
  const today = todayStr();
  const upcoming = rows.filter(c => !['completed'].includes(c.status));
  const past = rows.filter(c => c.status === 'completed');
  const card = c => html`<div class="card p-job"><div class="card-body">
    <div class="row" style="justify-content:space-between"><b>${c.title}</b>${pill(c.status)}</div>
    <div class="small muted">${c.scheduled_start ? fmtDateTime(c.scheduled_start) : 'We’ll call you to schedule'}${c.technician ? ` · ${c.technician}` : ''}${c.site ? ` · ${c.site.split(' — ')[0]}` : ''}</div>
    ${c.resolution ? html`<p style="white-space:pre-wrap;margin:8px 0 0">${c.resolution}</p>` : ''}
    ${c.photos.length ? html`<div class="photo-grid" style="margin-top:10px">${c.photos.map(p => html`<figure class="photo"><a href="/api/portal/photos/${p.id}" target="_blank" rel="noopener"><img src="/api/portal/photos/${p.id}" loading="lazy" alt="${p.kind} photo"></a><figcaption>${p.kind}${p.caption ? ` · ${p.caption}` : ''}</figcaption></figure>`)}</div>` : ''}
    ${c.signed_by ? html`<div class="small muted" style="margin-top:8px">✔ Signed off by ${c.signed_by}</div>` : ''}</div></div>`;
  mount(view, html`<div class="row" style="justify-content:space-between"><h1 class="p-h1">Service</h1><a class="btn primary" href="#/request">+ Request service</a></div>
    <h3 class="p-h3">Upcoming & requested</h3>${upcoming.length ? upcoming.map(card) : html`<div class="muted">Nothing scheduled.</div>`}
    <h3 class="p-h3">History</h3>${past.length ? past.map(card) : html`<div class="muted">No completed visits yet.</div>`}`);
}

async function requestService(view) {
  const locs = await api('GET', acct('/api/portal/locations'));
  const min = addDays(todayStr(), 1);
  mount(view, html`<a href="#/service">← Service</a><h1 class="p-h1">Request service</h1>
    <div class="card"><div class="card-body"><div class="err-box hidden" data-err></div><form class="stack" data-f style="gap:12px">
      <div class="field"><label for="t">What do you need help with?</label><input id="t" name="title" placeholder="e.g. Camera 3 is offline, keypad beeping, annual inspection" required></div>
      <div class="field"><label for="sys">System</label><select id="sys" name="system_type">${[['alarm', 'Alarm / security'], ['camera', 'Cameras'], ['fire alarm', 'Fire alarm'], ['sprinkler', 'Sprinkler'], ['extinguisher', 'Fire extinguishers'], ['access control', 'Access control'], ['other', 'Something else']].map(([v, l]) => html`<option value="${v}">${l}</option>`)}</select></div>
      ${locs.length ? html`<div class="field"><label for="loc">Location</label><select id="loc" name="location_id"><option value="">Main address</option>${locs.map(l => html`<option value="${l.id}">${l.name}${l.address ? ` — ${l.address}` : ''}</option>`)}</select></div>` : ''}
      <div class="field"><label for="d">Details (optional)</label><textarea id="d" name="description" placeholder="Anything that helps our technician: what happened, when, error messages…"></textarea></div>
      <div class="form-grid"><div class="field"><label for="pd">Preferred day</label><input id="pd" type="date" name="preferred_date" min="${min}" value="${min}"></div>
        <div class="field"><label for="w">Time of day</label><select id="w" name="window"><option value="any">Any time</option><option value="morning">Morning (8–12)</option><option value="afternoon">Afternoon (12–5)</option></select></div></div>
      <label class="row"><input type="checkbox" name="urgent"> It's urgent (system down / safety issue)</label>
      <button class="btn primary">Send request</button>
      <p class="small muted" style="margin:0">We'll confirm the exact time by text or email.${S.company.phone ? html` For emergencies call <a href="tel:${S.company.phone}">${S.company.phone}</a>.` : ''}</p></form></div></div>`);
  $('[data-f]').addEventListener('submit', async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    try { await api('POST', '/api/portal/service-requests', { ...d, urgent: !!d.urgent, account: S.account }); toast('Request sent. We’ll be in touch to confirm a time.'); location.hash = '#/service'; }
    catch (x) { const b = $('[data-err]'); b.textContent = x.message; b.classList.remove('hidden'); }
  });
}

async function equipment(view) {
  const locs = await api('GET', acct('/api/portal/locations'));
  mount(view, html`<a href="#/more">← More</a><h1 class="p-h1">Request equipment</h1>
    <div class="card"><div class="card-body"><div class="err-box hidden" data-err></div><form class="stack" data-f style="gap:12px">
      <div class="field"><label for="w">What are you interested in?</label><input id="w" name="what" placeholder="e.g. 2 more cameras on the garage, a video doorbell, smoke detectors" required></div>
      ${locs.length ? html`<div class="field"><label for="loc">Location</label><select id="loc" name="location_id"><option value="">Main address</option>${locs.map(l => html`<option value="${l.id}">${l.name}</option>`)}</select></div>` : ''}
      <div class="field"><label for="dt">Anything else we should know?</label><textarea id="dt" name="details"></textarea></div>
      <button class="btn primary">Send request</button><p class="small muted" style="margin:0">Our team will prepare a quote you can review and sign right here.</p></form></div></div>`);
  $('[data-f]').addEventListener('submit', async e => {
    e.preventDefault();
    try { await api('POST', '/api/portal/equipment-requests', { ...Object.fromEntries(new FormData(e.target)), account: S.account }); toast('Thanks! We’ll send you a quote.'); location.hash = '#/'; }
    catch (x) { const b = $('[data-err]'); b.textContent = x.message; b.classList.remove('hidden'); }
  });
}

async function paymentMethods(view) {
  const d = await api('GET', acct('/api/portal/payment-methods'));
  const saved = new URLSearchParams(location.hash.split('?')[1] || '').get('saved');
  mount(view, html`<h1 class="p-h1">Payment method</h1>${saved ? html`<div class="banner good">Saved! Your new payment method is ready.</div>` : ''}
    ${d.online ? html`<div class="card"><div class="card-head"><h2>Cards & bank accounts</h2><button class="btn sm primary" data-add>+ Add / replace</button></div><div class="card-body flush">
      ${d.methods.length ? d.methods.map(m => html`<div class="p-row"><div><b>${m.label}</b><div class="small muted">${m.detail}${m.id === d.default ? ' · used for automatic payments' : ''}</div></div>
        <div class="row">${m.id !== d.default ? html`<button class="btn sm ghost" data-def="${m.id}">Make default</button>` : html`<span class="badge good">default</span>`}<button class="btn sm ghost danger" data-del="${m.id}">Remove</button></div></div>`)
        : html`<div class="empty">No card or bank account saved. Add one to pay faster or set up automatic payments.</div>`}</div></div>
      <p class="small muted">Card and bank details are stored securely by our payment processor (Stripe) — never by us.</p>` : ''}
    <div class="card"><div class="card-head"><h2>How you prefer to pay</h2></div><div class="card-body"><div class="seg" data-pref>
      ${['card', 'ach', 'check', 'cash'].map(m => html`<button data-v="${m}" class="${d.preferred === m ? 'on' : ''}">${PAYMENT_METHODS[m]}</button>`)}</div></div></div>`);
  $('[data-add]')?.addEventListener('click', async () => { try { location.href = (await api('POST', '/api/portal/payment-methods/setup', { account: S.account })).url; } catch (e) { toast(e.message, 'error'); } });
  $$('[data-def]').forEach(b => b.addEventListener('click', async () => { await api('POST', `/api/portal/payment-methods/${b.dataset.def}/default`, { account: S.account }); route(); }));
  $$('[data-del]').forEach(b => b.addEventListener('click', async () => { if (await confirmDialog('Remove this payment method?', { okLabel: 'Remove', danger: true })) { await api('DELETE', acct(`/api/portal/payment-methods/${b.dataset.del}`)); route(); } }));
  $('[data-pref]').addEventListener('click', async e => { if (!e.target.dataset.v) return; await api('PUT', '/api/portal/payment-preference', { preferred_payment: e.target.dataset.v, account: S.account }); toast('Saved'); route(); });
}

async function more(view) {
  mount(view, html`<h1 class="p-h1">More</h1><div class="p-list">
    <a class="p-row" href="#/agreements"><div><b>✍ Agreements & quotes</b><div class="small muted">Review, sign and download</div></div><span>›</span></a>
    <a class="p-row" href="#/systems"><div><b>🛡 My systems</b><div class="small muted">Cameras, alarm, fire protection and upcoming inspections</div></div><span>›</span></a>
    <a class="p-row" href="#/equipment"><div><b>📦 Request equipment</b><div class="small muted">Get a quote for something new</div></div><span>›</span></a>
    <a class="p-row" href="#/profile"><div><b>👤 Contact info & notifications</b><div class="small muted">Phone, address, text/email updates, password</div></div><span>›</span></a></div>`);
}

async function agreements(view) {
  const rows = await api('GET', acct('/api/portal/agreements'));
  mount(view, html`<a href="#/more">← More</a><h1 class="p-h1">Agreements & quotes</h1><div class="p-list">
    ${rows.length ? rows.map(p => html`<a class="p-row" href="${p.url}"><div><b>${p.title}</b><div class="small muted">${p.kind} P-${p.number}${p.signed_at ? ` · signed ${fmtDate(p.signed_at.slice(0, 10))}` : ''}</div></div>
      <div class="right">${p.total ? html`<b>${money(p.total)}</b>` : ''}${p.monthly_amount ? html`<div class="small">${money(p.monthly_amount)}/mo</div>` : ''}<div>${p.status === 'signed' ? pill('signed') : html`<span class="badge warn">needs signature</span>`}</div></div></a>`)
      : html`<div class="empty">Nothing here yet.</div>`}</div>`);
}

async function systems(view) {
  const d = await api('GET', acct('/api/portal/systems'));
  const due = x => x ? html`<span class="${x < todayStr() ? 'p-due' : ''}">${fmtDate(x)}</span>` : '—';
  mount(view, html`<a href="#/more">← More</a><h1 class="p-h1">My systems</h1>
    ${d.alarms.map(a => html`<div class="card p-job"><div class="card-body"><b>🔔 Alarm — ${a.location || a.panel_brand || 'System'}</b><div class="small muted">${a.panel_brand || ''} ${a.monitoring_account ? `· Account ${a.monitoring_account}` : ''}</div><div class="small">Next test: ${due(a.next_test)}</div></div></div>`)}
    ${d.cameras.map(c => html`<div class="card p-job"><div class="card-body"><b>📹 Cameras — ${c.location || c.brand || 'System'}</b><div class="small muted">${c.camera_count || '?'} cameras${c.app_name ? ` · view in the ${c.app_name} app` : ''}</div><div class="small">Next service: ${due(c.next_service)}</div></div></div>`)}
    ${d.fire.map(f => html`<div class="card p-job"><div class="card-body"><b>🔥 ${f.system_type} — ${f.location || ''}</b><div class="small">Next inspection: ${due(f.next_inspection)}</div></div></div>`)}
    ${d.extinguishers.n ? html`<div class="card p-job"><div class="card-body"><b>🧯 ${d.extinguishers.n} fire extinguisher${d.extinguishers.n > 1 ? 's' : ''}</b><div class="small">Next annual inspection: ${due(d.extinguishers.next_annual)}</div></div></div>` : ''}
    ${!d.alarms.length && !d.cameras.length && !d.fire.length && !d.extinguishers.n ? html`<div class="empty">No systems on file yet.</div>` : ''}
    <p class="small muted">For your security, passwords and codes are not shown here. Call us if you need them.</p>`);
}

async function profile(view) {
  const p = await api('GET', acct('/api/portal/profile'));
  mount(view, html`<a href="#/more">← More</a><h1 class="p-h1">Contact info</h1>
    <div class="card"><div class="card-body"><form class="form-grid" data-f>
      <div class="field"><label>Name</label><div>${p.name}</div></div><div class="field"><label>Email</label><div>${p.email || p.login_email}</div></div>
      <div class="field"><label for="ph">Phone</label><input id="ph" name="phone" type="tel" value="${p.phone || ''}"></div>
      <div class="field"><label for="ph2">Other phone</label><input id="ph2" name="alt_phone" type="tel" value="${p.alt_phone || ''}"></div>
      <div class="field full"><label for="a">Billing address</label><input id="a" name="billing_address" value="${p.billing_address || ''}"></div>
      <div class="field"><label for="c">City</label><input id="c" name="city" value="${p.city || ''}"></div>
      <div class="field"><label for="st">State / ZIP</label><div class="row" style="flex-wrap:nowrap"><input id="st" name="state" value="${p.state || ''}" style="width:80px"><input name="zip" value="${p.zip || ''}" aria-label="ZIP"></div></div>
      <label class="row field full"><input type="checkbox" name="notify_sms" ${p.notify_sms ? 'checked' : ''}> Text me appointment confirmations and “on my way” alerts</label>
      <label class="row field full"><input type="checkbox" name="notify_email" ${p.notify_email ? 'checked' : ''}> Email me appointment confirmations</label>
      <div class="full"><button class="btn primary">Save</button></div></form></div></div>
    <div class="card"><div class="card-head"><h2>Password</h2></div><div class="card-body"><form class="form-grid" data-pw>
      <div class="field"><label for="cp">Current password</label><input id="cp" type="password" name="current" autocomplete="current-password"></div>
      <div class="field"><label for="np">New password</label><input id="np" type="password" name="password" autocomplete="new-password"></div>
      <div class="full"><button class="btn">Change password</button></div></form></div></div>`);
  $('[data-f]').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    try { await api('PUT', '/api/portal/profile', { ...Object.fromEntries(new FormData(f)), notify_sms: f.notify_sms.checked, notify_email: f.notify_email.checked, account: S.account }); toast('Saved'); } catch (x) { toast(x.message, 'error'); }
  });
  $('[data-pw]').addEventListener('submit', async e => {
    e.preventDefault();
    try { await api('POST', '/api/portal/password', Object.fromEntries(new FormData(e.target))); toast('Password changed'); e.target.reset(); } catch (x) { toast(x.message, 'error'); }
  });
}

boot();
