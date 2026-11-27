import { html, raw, mount, $, $$, money, money0, num, fmtDate, typeBadge, dataTable, todayStr, addDays, esc, loading } from '../ui.js';

const compact = v => v >= 1000 ? `$${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k` : `$${v}`;
import { GET } from '../api.js';

const TABS = [['pnl', 'Profit & loss'], ['techs', 'Technician workload'], ['segments', 'Residential vs commercial'], ['aging', 'Accounts receivable'], ['jobs', 'Job profitability']];
const monthsAgo = n => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

export async function render(view, _, query) {
  const tab = query.tab || 'pnl';
  mount(view, html`
    <div class="page-head"><div><h1>Reports</h1><div class="sub">Profit, workload and customer insights</div></div></div>
    <div class="tabs">${TABS.map(([k, l]) => html`<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${l}</button>`)}</div>
    <div data-pane></div>`);
  $$('[data-tab]', view).forEach(b => b.addEventListener('click', () => { location.hash = `#/reports?tab=${b.dataset.tab}`; }));
  const pane = $('[data-pane]', view);
  await ({ pnl, techs, segments, aging, jobs })[tab](pane);
}

// ------------------------------------------------------------------ P&L
async function pnl(pane) {
  const f = { from: monthsAgo(5), to: monthsAgo(0), labor: false };
  mount(pane, html`<div class="filters">
      <label class="small">From <input type="month" data-from value="${f.from}"></label>
      <label class="small">To <input type="month" data-to value="${f.to}"></label>
      <label class="row small"><input type="checkbox" data-labor> Subtract estimated labor cost (use if payroll isn't entered as an expense)</label>
    </div><div data-body></div>`);
  const body = $('[data-body]', pane);
  const load = async () => {
    loading(body);
    const r = await GET('/api/reports/pnl', { from: f.from, to: f.to });
    const T = r.totals;
    const net = f.labor ? T.netWithLabor : T.net;
    const margin = T.revenue ? Math.round(net / T.revenue * 100) : 0;
    mount(body, html`
      <div class="kpis">
        <div class="kpi"><div class="label">Revenue (invoiced)</div><div class="value">${money0(T.revenue)}</div><div class="hint">${money0(T.recurring)} recurring · ${money0(T.revenue - T.recurring)} service/install</div></div>
        <div class="kpi"><div class="label">Collected</div><div class="value">${money0(T.collected)}</div><div class="hint">payments received</div></div>
        <div class="kpi"><div class="label">Expenses</div><div class="value">${money0(T.expenses + (f.labor ? T.laborEst : 0))}</div><div class="hint">${f.labor ? `incl. ${money0(T.laborEst)} est. labor` : `est. labor ${money0(T.laborEst)} not included`}</div></div>
        <div class="kpi ${net < 0 ? 'alert' : ''}"><div class="label">${net < 0 ? 'Net loss' : 'Net profit'}</div><div class="value" style="color:${net < 0 ? 'var(--bad)' : 'var(--good)'}">${money0(net)}</div><div class="hint">${margin}% margin</div></div>
      </div>
      <div class="grid g3">
        <div class="card span2"><div class="card-head"><h2>Revenue vs expenses by month</h2></div><div class="card-body">
          <div class="legend"><span><span class="sw" style="background:var(--series-1)"></span>Revenue</span><span><span class="sw" style="background:var(--series-2)"></span>Expenses${f.labor ? ' + est. labor' : ''}</span></div>
          ${barChart(r.months.map(m => ({ label: m.label.split(' ')[0].slice(0, 3), full: m.label, a: m.revenue, b: m.expenses + (f.labor ? m.laborEst : 0), net: f.labor ? m.netWithLabor : m.net })))}
        </div></div>
        <div class="card"><div class="card-head"><h2>Expenses by category</h2></div><div class="card-body flush">${dataTable({
          rows: r.categories, empty: 'No expenses in range.',
          columns: [{ label: 'Category', key: 'category' }, { label: 'Total', render: c => money(c.total), cls: 'num' }, { label: 'Share', render: c => T.expenses ? Math.round(c.total / T.expenses * 100) + '%' : '', cls: 'num' }],
        })}</div></div>
        <div class="card" style="grid-column:1/-1"><div class="card-head"><h2>Monthly detail</h2></div><div class="card-body flush">${dataTable({
          rows: r.months,
          columns: [
            { label: 'Month', render: m => m.label },
            { label: 'Residential', render: m => money(m.residential), cls: 'num' },
            { label: 'Commercial', render: m => money(m.commercial), cls: 'num' },
            { label: 'Revenue', render: m => html`<b>${money(m.revenue)}</b>`, cls: 'num' },
            { label: 'Collected', render: m => money(m.collected), cls: 'num' },
            { label: 'Expenses', render: m => money(m.expenses), cls: 'num' },
            { label: 'Est. labor', render: m => money(m.laborEst), cls: 'num' },
            { label: 'Parts used (cost)', render: m => money(m.partsUsedCost), cls: 'num' },
            { label: 'Net', render: m => { const n = f.labor ? m.netWithLabor : m.net; return html`<b style="color:${n < 0 ? 'var(--bad)' : 'var(--good)'}">${money(n)}</b>`; }, cls: 'num' },
          ],
          foot: html`<tr><td>Total</td><td class="num">${money(T.residential)}</td><td class="num">${money(T.commercial)}</td><td class="num">${money(T.revenue)}</td><td class="num">${money(T.collected)}</td>
            <td class="num">${money(T.expenses)}</td><td class="num">${money(T.laborEst)}</td><td class="num">${money(T.partsUsedCost)}</td><td class="num">${money(net)}</td></tr>`,
        })}</div></div>
      </div>
      <p class="small muted">Revenue counts sent/paid invoices by issue date (drafts and voids excluded). Expenses come from the Expenses page — parts purchases are recorded there when stock is received.
        "Est. labor" multiplies each completed job's labor hours by the technician's hourly cost; turn it on only if payroll isn't already entered as an expense, or it will be counted twice.</p>`);
    attachTooltips(body);
  };
  $('[data-from]', pane).addEventListener('change', e => { f.from = e.target.value; load(); });
  $('[data-to]', pane).addEventListener('change', e => { f.to = e.target.value; load(); });
  $('[data-labor]', pane).addEventListener('change', e => { f.labor = e.target.checked; load(); });
  await load();
}

function niceMax(v) {
  if (v <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map(m => m * p).find(m => m >= v);
}

// Grouped bar chart: two series (a = revenue, b = expenses), one y-axis.
function barChart(rows) {
  const W = 760, H = 260, L = 56, B = 26, T = 10, R = 8;
  const max = niceMax(Math.max(...rows.map(r => Math.max(r.a, r.b)), 1));
  const plotW = W - L - R, plotH = H - B - T;
  const gw = plotW / rows.length;
  const bw = Math.min(28, gw / 2 - 6);
  const y = v => T + plotH - (v / max) * plotH;
  const ticks = [0, .25, .5, .75, 1].map(t => t * max);
  const bar = (x, v, cls) => {
    const h = Math.max(0, plotH - (y(v) - T));
    if (h < 0.5) return '';
    const r = Math.min(4, bw / 2, h);
    const top = y(v);
    // rounded top, square at the baseline
    return `<path class="bar ${cls}" d="M${x},${T + plotH} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${T + plotH} Z" stroke="var(--surface)" stroke-width="2" paint-order="stroke"/>`;
  };
  const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Revenue and expenses by month">
    ${ticks.map(t => `<line class="gridline" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${esc(compact(t))}</text>`).join('')}
    <line class="axis" x1="${L}" x2="${W - R}" y1="${T + plotH}" y2="${T + plotH}"/>
    ${rows.map((r, i) => {
      const gx = L + i * gw;
      const x1 = gx + gw / 2 - bw - 1, x2 = gx + gw / 2 + 1;
      const tip = esc(JSON.stringify({ t: r.full, rows: [['Revenue', money(r.a)], ['Expenses', money(r.b)], ['Net', money(r.net)]] }));
      return `<g class="hit" data-tip="${tip}"><rect class="hitbox" x="${gx}" y="${T}" width="${gw}" height="${plotH}"/>
        ${bar(x1, r.a, 's1')}${bar(x2, r.b, 's2')}
        <text x="${gx + gw / 2}" y="${H - 8}" text-anchor="middle">${esc(r.label)}</text></g>`;
    }).join('')}
  </svg>`;
  return html`<div class="chart">${raw(svg)}</div>`;
}

function attachTooltips(root) {
  let tip = document.querySelector('.tooltip');
  if (!tip) { tip = document.createElement('div'); tip.className = 'tooltip hidden'; document.body.append(tip); }
  $$('[data-tip]', root).forEach(g => {
    g.addEventListener('mousemove', e => {
      const d = JSON.parse(g.dataset.tip);
      tip.innerHTML = `<b>${esc(d.t)}</b>${d.rows.map(([k, v]) => `<div class="row"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}`;
      tip.classList.remove('hidden');
      const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 10);
      tip.style.left = x + 'px';
      tip.style.top = (e.clientY - tip.offsetHeight - 12) + 'px';
    });
    g.addEventListener('mouseleave', () => tip.classList.add('hidden'));
  });
}

// ------------------------------------------------------------------ technicians
async function techs(pane) {
  const t = todayStr();
  const f = { from: t.slice(0, 8) + '01', to: addDays(addDays(t.slice(0, 8) + '01', 32).slice(0, 8) + '01', -1) };
  mount(pane, html`<div class="filters">
      <label class="small">From <input type="date" data-from value="${f.from}"></label>
      <label class="small">To <input type="date" data-to value="${f.to}"></label>
      <div class="seg" data-preset><button data-v="week">This week</button><button data-v="month">This month</button><button data-v="90">Last 90 days</button></div>
    </div><div data-body></div>`);
  const body = $('[data-body]', pane);
  const load = async () => {
    $('[data-from]', pane).value = f.from; $('[data-to]', pane).value = f.to;
    const r = await GET('/api/reports/technicians', f);
    const rows = r.technicians.filter(x => x.active || x.calls);
    const maxH = Math.max(r.capacity, ...rows.map(x => x.scheduled_hours), 1);
    const busiest = rows[0];
    mount(body, html`
      <div class="kpis">
        <div class="kpi"><div class="label">Busiest technician</div><div class="value" style="font-size:20px">${busiest?.calls ? busiest.name : '—'}</div><div class="hint">${busiest ? `${busiest.scheduled_hours} h · ${busiest.calls} calls` : ''}</div></div>
        <div class="kpi"><div class="label">Calls in range</div><div class="value">${rows.reduce((s, x) => s + x.calls, 0)}</div><div class="hint">${rows.reduce((s, x) => s + x.completed, 0)} completed</div></div>
        <div class="kpi"><div class="label">Labor billed</div><div class="value">${money0(rows.reduce((s, x) => s + x.labor_billed, 0))}</div></div>
        <div class="kpi ${r.unassigned ? 'alert' : ''}"><div class="label">Unassigned open calls</div><div class="value">${r.unassigned}</div></div>
      </div>
      <div class="card" style="margin-bottom:16px"><div class="card-head"><div><h2>Booked hours vs capacity</h2>
        <div class="small muted">${r.workdays} workdays × 8 h = ${r.capacity} h capacity per technician (marker)</div></div></div>
        <div class="card-body">${rows.length ? rows.map(x => html`<div class="hbar" title="${x.name}: ${x.scheduled_hours} h booked of ${r.capacity} h">
            <span><span class="dot" style="background:${x.color}"></span> ${x.name}</span>
            <div class="track"><div class="fill" style="width:${x.scheduled_hours / maxH * 100}%;${x.scheduled_hours > r.capacity ? 'background:var(--bad)' : ''}"></div>
              <div class="cap" style="left:${r.capacity / maxH * 100}%"></div></div>
            <b class="num">${x.utilization}%</b></div>`) : html`<div class="muted">No technicians.</div>`}</div></div>
      <div class="card"><div class="card-body flush">${dataTable({
        rows,
        columns: [
          { label: 'Technician', render: x => html`<span class="dot" style="background:${x.color}"></span> <b>${x.name}</b>` },
          { label: 'Calls', key: 'calls', cls: 'num' }, { label: 'Completed', key: 'completed', cls: 'num' },
          { label: 'Installs', key: 'installs', cls: 'num' }, { label: 'Emergencies', key: 'emergencies', cls: 'num' },
          { label: 'Booked hrs', render: x => num(x.scheduled_hours), cls: 'num' }, { label: 'Labor hrs', render: x => num(x.labor_hours), cls: 'num' },
          { label: 'Labor billed', render: x => money(x.labor_billed), cls: 'num' }, { label: 'Parts billed', render: x => money(x.parts_billed), cls: 'num' },
          { label: 'Labor cost', render: x => money(x.labor_cost), cls: 'num' },
          { label: 'Utilization', render: x => `${x.utilization}%`, cls: 'num' }, { label: 'Open backlog', key: 'open_backlog', cls: 'num' },
        ] })}</div></div>`);
  };
  $('[data-from]', pane).addEventListener('change', e => { f.from = e.target.value; load(); });
  $('[data-to]', pane).addEventListener('change', e => { f.to = e.target.value; load(); });
  $('[data-preset]', pane).addEventListener('click', e => {
    const v = e.target.dataset.v; if (!v) return;
    const d = new Date(t + 'T12:00:00');
    if (v === 'week') { const mon = addDays(t, -((d.getDay() + 6) % 7)); f.from = mon; f.to = addDays(mon, 6); }
    if (v === 'month') { f.from = t.slice(0, 8) + '01'; f.to = addDays(addDays(f.from, 32).slice(0, 8) + '01', -1); }
    if (v === '90') { f.from = addDays(t, -90); f.to = t; }
    load();
  });
  await load();
}

// ------------------------------------------------------------------ segments
async function segments(pane) {
  const rows = await GET('/api/reports/segments');
  const [res, com] = rows;
  const totalMrr = res.mrr + com.mrr || 1;
  const card = s => html`<div class="card"><div class="card-head"><h2>${typeBadge(s.type)}</h2></div><div class="card-body"><dl class="dl">
      <dt>Active customers</dt><dd><b>${s.active}</b></dd>
      <dt>Monthly recurring</dt><dd><b>${money(s.mrr)}</b> <span class="muted">(${Math.round(s.mrr / totalMrr * 100)}% of total)</span></dd>
      <dt>Annual recurring</dt><dd>${money(s.arr)}</dd>
      <dt>Avg. per customer</dt><dd>${money(s.avgMrr)} / month</dd>
      <dt>Revenue (last 12 mo)</dt><dd>${money(s.revenue)}</dd>
      <dt>Open balance</dt><dd>${money(s.openAR)}</dd>
      <dt>Service calls (12 mo)</dt><dd>${s.calls}</dd></dl></div></div>`;
  mount(pane, html`<div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Share of recurring revenue</h2></div><div class="card-body">
      <div class="legend"><span><span class="sw" style="background:var(--series-1)"></span>Residential ${money0(res.mrr)}/mo</span><span><span class="sw" style="background:var(--series-2)"></span>Commercial ${money0(com.mrr)}/mo</span></div>
      <div style="display:flex;height:22px;border-radius:5px;overflow:hidden;gap:2px">
        <div style="width:${res.mrr / totalMrr * 100}%;background:var(--series-1)" title="Residential ${money(res.mrr)}"></div>
        <div style="width:${com.mrr / totalMrr * 100}%;background:var(--series-2)" title="Commercial ${money(com.mrr)}"></div></div></div></div>
    <div class="grid g2">${card(res)}${card(com)}</div>`);
}

// ------------------------------------------------------------------ aging
async function aging(pane) {
  const r = await GET('/api/reports/aging');
  const T = r.totals;
  mount(pane, html`<div class="kpis">
      ${[['Current', 'current'], ['1–30 days', 'd30'], ['31–60 days', 'd60'], ['61–90 days', 'd90'], ['90+ days', 'd90plus'], ['Total', 'total']].map(([l, k]) =>
        html`<div class="kpi ${['d60', 'd90', 'd90plus'].includes(k) && T[k] > 0 ? 'alert' : ''}"><div class="label">${l}</div><div class="value">${money0(T[k])}</div></div>`)}
    </div>
    <div class="card"><div class="card-body flush">${dataTable({
      rows: r.customers, href: c => `#/customers/${c.customer_id}?tab=billing`, empty: 'Nobody owes you anything. 🎉',
      columns: [
        { label: 'Customer', render: c => html`<b>${c.name}</b> ${typeBadge(c.type)}<div class="small muted">${c.invoices} open invoice(s)</div>` },
        ...[['Current', 'current'], ['1–30', 'd30'], ['31–60', 'd60'], ['61–90', 'd90'], ['90+', 'd90plus']].map(([l, k]) => ({ label: l, render: c => c[k] ? money(c[k]) : html`<span class="muted">—</span>`, cls: 'num' })),
        { label: 'Total', render: c => html`<b>${money(c.total)}</b>`, cls: 'num' },
      ] })}</div></div>`);
}

// ------------------------------------------------------------------ jobs
async function jobs(pane) {
  const t = todayStr();
  const f = { from: addDays(t, -30), to: t };
  mount(pane, html`<div class="filters">
      <label class="small">From <input type="date" data-from value="${f.from}"></label><label class="small">To <input type="date" data-to value="${f.to}"></label></div>
    <div data-body></div>`);
  const load = async () => {
    const rows = await GET('/api/reports/jobs', f);
    const sum = k => rows.reduce((s, j) => s + j[k], 0);
    mount($('[data-body]', pane), html`<div class="kpis">
        <div class="kpi"><div class="label">Completed jobs</div><div class="value">${rows.length}</div></div>
        <div class="kpi"><div class="label">Billed</div><div class="value">${money0(sum('billed'))}</div></div>
        <div class="kpi"><div class="label">Labor + parts cost</div><div class="value">${money0(sum('cost'))}</div></div>
        <div class="kpi"><div class="label">Gross profit</div><div class="value" style="color:${sum('profit') < 0 ? 'var(--bad)' : 'var(--good)'}">${money0(sum('profit'))}</div></div></div>
      <div class="card"><div class="card-body flush">${dataTable({
        rows, href: j => `#/calls/${j.id}`, empty: 'No completed jobs in range.',
        columns: [
          { label: 'Job', render: j => html`<b>SC-${j.number}</b> ${j.title}<div class="small muted">${fmtDate(j.completed_at?.slice(0, 10))} · ${j.technician || 'Unassigned'}</div>` },
          { label: 'Customer', render: j => html`${j.customer} ${typeBadge(j.customer_type)}` },
          { label: 'Invoice', render: j => j.invoice_number ? `#${j.invoice_number}` : j.billable ? html`<span class="badge warn">not invoiced</span>` : html`<span class="muted">no charge</span>` },
          { label: 'Billed', render: j => money(j.billed), cls: 'num' }, { label: 'Labor cost', render: j => money(j.labor_cost), cls: 'num' },
          { label: 'Parts cost', render: j => money(j.parts_cost), cls: 'num' },
          { label: 'Profit', render: j => html`<b style="color:${j.profit < 0 ? 'var(--bad)' : 'var(--good)'}">${money(j.profit)}</b>`, cls: 'num' },
          { label: 'Margin', render: j => j.margin == null ? '—' : `${j.margin}%`, cls: 'num' },
        ] })}</div></div>`);
  };
  $('[data-from]', pane).addEventListener('change', e => { f.from = e.target.value; load(); });
  $('[data-to]', pane).addEventListener('change', e => { f.to = e.target.value; load(); });
  await load();
}
