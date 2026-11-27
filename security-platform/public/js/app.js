import { html, mount, $, $$, toast, initials, esc, installGlobalHandlers, icon } from './ui.js';
import { api, GET, POST } from './api.js';
import { G, ROLE_INFO } from './schema.js';

export const state = { user: null, settings: {}, company: '' };
export const can = {
  // Permission groups (same as the server's, from schema.js).
  manage: () => G.manage.includes(state.user?.role),
  billing: () => G.billing.includes(state.user?.role),
  sales: () => G.sales.includes(state.user?.role),
  customers: () => G.customers.includes(state.user?.role),
  staff: () => G.staff.includes(state.user?.role),
  owner: () => state.user?.role === 'owner',
  tech: () => state.user?.role === 'technician',
};

const NAV = [
  { section: null },
  { href: '#/', label: 'Dashboard', ico: 'layout-dashboard' },
  { href: '#/myday', label: 'My Day', ico: 'sun', roles: ['technician'] },
  { href: '#/timeclock', label: 'Time clock', ico: 'clock' },
  { section: 'Customers' },
  { href: '#/customers', label: 'Customers', ico: 'users' },
  { href: '#/pipeline', label: 'Pipeline', ico: 'kanban', roles: G.staff },
  { href: '#/proposals', label: 'Proposals', ico: 'file-signature', roles: G.salesOrBilling },
  { href: '#/monitoring', label: 'Monitoring', ico: 'shield-check' },
  { href: '#/maintenance', label: 'Maintenance Due', ico: 'alarm-clock' },
  { section: 'Field work' },
  { href: '#/calls', label: 'Service Calls', ico: 'wrench' },
  { href: '#/calendar', label: 'Calendar', ico: 'calendar-days' },
  { href: '#/schedule', label: 'Dispatch board', ico: 'calendar-range' },
  { href: '#/technicians', label: 'Technicians', ico: 'hard-hat' },
  { section: 'Billing', roles: G.billing },
  { href: '#/invoices', label: 'Invoices', ico: 'receipt', roles: G.billing },
  { href: '#/payments', label: 'Payments', ico: 'banknote', roles: G.billing },
  { href: '#/expenses', label: 'Expenses', ico: 'credit-card', roles: G.billing },
  { section: 'Operations' },
  { href: '#/inventory', label: 'Inventory', ico: 'package' },
  { href: '#/receiving', label: 'Receiving', ico: 'inbox', roles: G.billing },
  { href: '#/truck-stock', label: 'Truck stock', ico: 'package-check', roles: G.billing },
  { href: '#/tools', label: 'Tools', ico: 'hammer' },
  { href: '#/vehicles', label: 'Vehicles', ico: 'truck' },
  { section: 'Insights', roles: G.billing },
  { href: '#/reports', label: 'Reports', ico: 'chart-line', roles: G.billing },
  { href: '#/accounting', label: 'Accounting', ico: 'book-open', roles: G.billing },
  { href: '#/settings', label: 'Settings', ico: 'settings', roles: G.manage },
];

// path pattern -> [module, export]
const ROUTES = [
  [/^$/, 'dashboard'],
  [/^myday$/, 'myday'],
  [/^timeclock$/, 'timeclock'],
  [/^customers$/, 'customers', 'list'],
  [/^pipeline$/, 'pipeline'],
  [/^monitoring$/, 'monitoring', 'list'],
  [/^monitoring\/(\d+)$/, 'monitoring', 'detail'],
  [/^monitoring-stations$/, 'monitoring', 'stations'],
  [/^proposals$/, 'proposals', 'list'],
  [/^proposals\/(\d+)$/, 'proposals', 'detail'],
  [/^customers\/(\d+)$/, 'customers', 'detail'],
  [/^calls$/, 'calls', 'list'],
  [/^calls\/(\d+)$/, 'calls', 'detail'],
  [/^schedule$/, 'schedule'],
  [/^calendar$/, 'calendar'],
  [/^maintenance$/, 'maintenance'],
  [/^invoices$/, 'invoices', 'list'],
  [/^invoices\/(\d+)$/, 'invoices', 'detail'],
  [/^payments$/, 'invoices', 'payments'],
  [/^expenses$/, 'expenses'],
  [/^inventory$/, 'inventory', 'list'],
  [/^inventory\/(\d+)$/, 'inventory', 'detail'],
  [/^receiving$/, 'receiving', 'list'],
  [/^receiving\/(\d+)$/, 'receiving', 'detail'],
  [/^truck-stock$/, 'truckstock', 'overview'],
  [/^tools$/, 'truckstock', 'tools'],
  [/^vehicles$/, 'vehicles', 'list'],
  [/^vehicles\/(\d+)$/, 'vehicles', 'detail'],
  [/^technicians$/, 'technicians'],
  [/^reports$/, 'reports'],
  [/^accounting$/, 'accounting'],
  [/^settings$/, 'settings'],
  [/^account$/, 'settings', 'account'],
];

const root = document.getElementById('root');

async function boot() {
  installGlobalHandlers();
  window.addEventListener('auth-lost', () => { if (state.user) { state.user = null; toast('Your session ended. Please sign in again.', 'error'); boot(); } });
  try {
    const s = await GET('/api/auth/state');
    state.company = s.company;
    state.logo = s.logo;
    if (s.needsSetup) return renderSetup();
    if (!s.user) return renderLogin();
    state.user = s.user;
    state.settings = await GET('/api/settings');
    renderShell();
  } catch (e) {
    mount(root, html`<div class="login-wrap"><div class="login-card"><h2>Can't connect</h2><p>${e.message}</p><button class="btn primary" data-retry>Retry</button></div></div>`);
    $('[data-retry]').addEventListener('click', () => location.reload());
  }
}

function brand(name, { useLogo = false } = {}) {
  if (useLogo && state.logo) return html`<img class="login-logo" src="/api/public/logo?v=${state.logo}" alt="${name || ''}">`;
  return html`<div class="brand"><img src="/icons/icon.svg" alt=""><span>${name || 'SecureOps'}</span></div>`;
}

function renderLogin() {
  mount(root, html`<div class="login-wrap"><div class="login-card">
    ${brand(state.company, { useLogo: true })}
    <form data-login>
      <div class="err-box hidden" data-err></div>
      <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required></div>
      <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>
      <button class="btn primary" type="submit">Sign in</button>
    </form></div></div>`);
  const form = $('[data-login]');
  form.email.focus();
  form.addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await POST('/api/auth/login', { email: form.email.value, password: form.password.value });
      boot();
    } catch (err) { const box = $('[data-err]'); box.textContent = err.message; box.classList.remove('hidden'); }
  });
}

function renderSetup() {
  mount(root, html`<div class="login-wrap"><div class="login-card">
    ${brand('Welcome to SecureOps')}
    <p class="muted" style="margin-top:0">Create the owner/admin account to get started.</p>
    <form data-setup>
      <div class="err-box hidden" data-err></div>
      <div class="field"><label for="company_name">Company name</label><input id="company_name" name="company_name" required></div>
      <div class="field"><label for="name">Your name</label><input id="name" name="name" required></div>
      <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required></div>
      <div class="field"><label for="password">Password (8+ characters)</label><input id="password" name="password" type="password" autocomplete="new-password" minlength="8" required></div>
      <button class="btn primary" type="submit">Create account</button>
    </form></div></div>`);
  const form = $('[data-setup]');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await POST('/api/auth/setup', Object.fromEntries(new FormData(form)));
      boot();
    } catch (err) { const box = $('[data-err]'); box.textContent = err.message; box.classList.remove('hidden'); }
  });
}

function renderShell() {
  const role = state.user.role;
  const nav = NAV.filter(n => !n.roles || n.roles.includes(role));
  mount(root, html`<div class="app">
    <aside class="sidebar">
      ${brand(state.settings.company_name)}
      <nav class="nav">${nav.map(n => n.section === undefined
        ? html`<a href="${n.href}" data-nav="${n.href}">${icon(n.ico)}${n.label}</a>`
        : n.section ? html`<div class="section">${n.section}</div>` : '')}</nav>
    </aside>
    <div class="main">
      <header class="topbar">
        <button class="btn ghost menu-btn" data-menu aria-label="Menu">${icon('menu')}</button>
        <div class="search"><span class="ico">${icon('search')}</span><input type="search" placeholder="Search customers, phone, invoice #, call #, parts…" data-search aria-label="Search">
          <div class="search-results hidden" data-results></div></div>
        <div class="user-menu">
          <a href="#/account" class="row" style="color:inherit" title="My account">
            <span class="uname small">${state.user.name}<br><span class="muted">${ROLE_INFO[role]?.label || role}</span></span><span class="avatar">${initials(state.user.name)}</span></a>
          <button class="btn ghost sm" data-logout title="Sign out">Sign out</button>
        </div>
      </header>
      <main class="view" id="view"></main>
    </div></div>`);
  $('[data-menu]').addEventListener('click', () => $('.app').classList.toggle('nav-open'));
  $('.app').addEventListener('click', e => { if (e.target.classList.contains('app')) $('.app').classList.remove('nav-open'); });
  $('[data-logout]').addEventListener('click', async () => { await POST('/api/auth/logout'); state.user = null; location.hash = '#/'; boot(); });
  setupSearch();
  window.onhashchange = route;
  route();
}

function setupSearch() {
  const input = $('[data-search]');
  const box = $('[data-results]');
  let timer, seq = 0, sel = -1;
  const hide = () => { box.classList.add('hidden'); sel = -1; };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) return hide();
    timer = setTimeout(async () => {
      const my = ++seq;
      const rows = await GET('/api/search', { q }).catch(() => []);
      if (my !== seq) return;
      mount(box, rows.length ? html`${rows.map(r => html`<a href="${r.href}"><div class="kind">${r.kind}</div><div>${r.title}</div><div class="small muted">${r.sub}</div></a>`)}`
        : html`<div class="empty">No matches</div>`);
      box.classList.remove('hidden');
    }, 200);
  });
  input.addEventListener('keydown', e => {
    const links = $$('a', box);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      sel = Math.max(0, Math.min(links.length - 1, sel + (e.key === 'ArrowDown' ? 1 : -1)));
      links.forEach((l, i) => l.classList.toggle('sel', i === sel));
    } else if (e.key === 'Enter' && links.length) {
      location.hash = (links[sel] || links[0]).getAttribute('href'); input.value = ''; hide();
    } else if (e.key === 'Escape') hide();
  });
  box.addEventListener('click', () => { input.value = ''; hide(); });
  document.addEventListener('click', e => { if (!e.target.closest('.search')) hide(); });
}

let routeSeq = 0;
async function route() {
  const path = location.hash.replace(/^#\/?/, '').split('?')[0].replace(/\/$/, '');
  const view = $('#view');
  if (!view) return;
  $('.app')?.classList.remove('nav-open');
  const top = '#/' + path.split('/')[0];
  $$('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === top || (top === '#/' && a.dataset.nav === '#/')));
  const match = ROUTES.map(([re, mod, fn]) => [path.match(re), mod, fn]).find(([m]) => m);
  if (!match) { mount(view, html`<div class="empty">Page not found. <a href="#/">Go to dashboard</a></div>`); return; }
  const [m, mod, fn = 'render'] = match;
  const my = ++routeSeq;
  try {
    const page = await import(`./pages/${mod}.js`);
    if (my !== routeSeq) return;
    window.scrollTo(0, 0);
    await page[fn](view, m.slice(1), queryParams());
  } catch (e) {
    console.error(e);
    mount(view, html`<div class="card"><div class="empty">⚠️ ${e.message}</div></div>`);
  }
}

export function queryParams() {
  const q = location.hash.split('?')[1];
  return Object.fromEntries(new URLSearchParams(q || ''));
}
export function refresh() { route(); }

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
boot();
