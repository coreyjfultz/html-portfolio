import { html, mount, money, money0, fmtDate, fmtTime, badge, typeBadge, relDays, dataTable, loading } from '../ui.js';
import { GET } from '../api.js';
import { state, can } from '../app.js';

export async function render(view) {
  loading(view);
  const [d, onTest, alerts] = await Promise.all([GET('/api/dashboard'), GET('/api/monitoring-on-test').catch(() => []), can.staff() ? GET('/api/alerts').catch(() => []) : Promise.resolve([])]);
  const { alertRow, wireAlerts } = alerts.length ? await import('./truckstock.js') : {};
  const res = d.customers.find(c => c.type === 'residential')?.n || 0;
  const com = d.customers.find(c => c.type === 'commercial')?.n || 0;
  const overdueMaint = d.maintenance.filter(m => m.overdue);
  const office = can.billing();
  const hour = new Date().getHours();

  mount(view, html`
    <div class="page-head"><div>
      <h1>Good ${hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'}, ${state.user.name.split(' ')[0]}</h1>
      <div class="sub">${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</div></div>
      <div class="actions">
        <a class="btn" href="#/calls?new=1">+ Service call</a>
        ${can.customers() ? html`<a class="btn" href="#/customers?new=1">+ Customer</a>` : ''}
        ${office && !d.monthlyBilled ? html`<a class="btn primary" href="#/invoices?billing=1">Run monthly billing</a>` : ''}
      </div></div>

    ${onTest.length ? html`<div class="banner warn">🧪 ${onTest.length} monitoring account${onTest.length > 1 ? 's are' : ' is'} on test: ${onTest.map((a, i) => html`${i ? ', ' : ''}<a href="#/monitoring/${a.id}">${a.customer} (${a.account_number}) until ${fmtTime(a.test_until)}</a>`)}</div>` : ''}
    ${d.emergencies ? html`<div class="err-box">🚨 ${d.emergencies} open emergency call${d.emergencies > 1 ? 's' : ''}. <a href="#/calls?priority=emergency">View</a></div>` : ''}

    ${alerts.length ? html`<div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Alerts (${alerts.length})</h2></div><div class="card-body stack" style="gap:8px">${alerts.slice(0, 6).map(a => alertRow(a))}${alerts.length > 6 ? html`<div class="small muted">…and ${alerts.length - 6} more</div>` : ''}</div></div>` : ''}

    <div class="kpis">
      ${office ? html`
        <a class="kpi" href="#/reports"><div class="label">Monthly recurring revenue</div><div class="value">${money0(d.mrr)}</div><div class="hint">${money0(d.mrr * 12)} / year</div></a>
        <a class="kpi" href="#/reports?tab=pnl"><div class="label">Billed this month</div><div class="value">${money0(d.monthRevenue)}</div><div class="hint">${money0(d.monthCollected)} collected · ${money0(d.monthExpenses)} expenses</div></a>
        <a class="kpi ${d.overdueTotal > 0 ? 'alert' : ''}" href="#/invoices?status=overdue"><div class="label">Outstanding / overdue</div><div class="value">${money0(d.arTotal)}</div><div class="hint">${money0(d.overdueTotal)} past due</div></a>` : ''}
      <a class="kpi" href="#/customers"><div class="label">Active customers</div><div class="value">${res + com}</div><div class="hint">${res} residential · ${com} commercial</div></a>
      <a class="kpi" href="#/calls"><div class="label">Open service calls</div><div class="value">${d.openCalls}</div><div class="hint">${d.unassignedCalls} unassigned</div></a>
      <a class="kpi ${overdueMaint.length ? 'alert' : ''}" href="#/maintenance"><div class="label">Maintenance overdue</div><div class="value">${overdueMaint.length}</div><div class="hint">${d.maintenance.length - overdueMaint.length} more due in 30 days</div></a>
    </div>

    ${office && (d.drafts || d.uninvoicedCalls || d.receivingReview) ? html`<div class="note" style="margin-bottom:16px">
      ${d.receivingReview ? html`📥 ${d.receivingReview} supplier invoice${d.receivingReview > 1 ? 's need' : ' needs'} a quick check before stock is added. <a href="#/receiving">Review</a>. ` : ''}
      ${d.drafts ? html`📝 ${d.drafts} draft invoice${d.drafts > 1 ? 's' : ''} waiting to be sent. <a href="#/invoices?status=draft">Review</a>. ` : ''}
      ${d.uninvoicedCalls ? html`🔧 ${d.uninvoicedCalls} completed billable call${d.uninvoicedCalls > 1 ? 's' : ''} not invoiced yet. <a href="#/calls?status=completed&uninvoiced=1">Invoice them</a>.` : ''}
    </div>` : ''}

    <div class="grid g2">
      <div class="card"><div class="card-head"><h2>Today's schedule</h2><a href="#/schedule" class="small">Full schedule →</a></div>
        <div class="card-body flush">${dataTable({
          rows: d.todayCalls, href: c => `#/calls/${c.id}`, empty: 'No calls scheduled today.',
          columns: [
            { label: 'Time', render: c => html`<b>${fmtTime(c.scheduled_start)}</b>`, cls: 'nowrap' },
            { label: 'Customer', render: c => html`${c.customer_id_label}<div class="small muted">${c.title}</div>` },
            { label: 'Tech', render: c => c.technician_id_label ? html`<span class="dot" style="background:${c.technician_color || '#64748b'}"></span> ${c.technician_id_label}` : html`<span class="muted">Unassigned</span>` },
            { label: 'Status', render: c => html`${badge(c.status)} ${c.priority === 'emergency' || c.priority === 'high' ? badge(c.priority) : ''}` },
          ] })}</div></div>

      <div class="card"><div class="card-head"><h2>Maintenance & inspections due</h2><a href="#/maintenance" class="small">All →</a></div>
        <div class="card-body flush">${dataTable({
          rows: d.maintenance.slice(0, 8), empty: 'Nothing due in the next 30 days. 🎉',
          href: m => m.customer_id ? `#/customers/${m.customer_id}?tab=systems` : `#/vehicles/${m.vehicle_id}`,
          columns: [
            { label: 'Due', render: m => html`<b class="${m.overdue ? 'nowrap' : 'nowrap'}" style="${m.overdue ? 'color:var(--bad)' : ''}">${fmtDate(m.due)}</b><div class="small muted">${relDays(m.due)}</div>` },
            { label: 'What', render: m => html`${m.label}<div class="small muted">${m.what}</div>` },
            { label: 'Customer', render: m => m.customer ? html`${m.customer} ${typeBadge(m.customer_type)}` : html`<span class="muted">Fleet</span>` },
          ] })}</div></div>

      ${office ? html`<div class="card"><div class="card-head"><h2>Overdue invoices</h2><a href="#/reports?tab=aging" class="small">Aging report →</a></div>
        <div class="card-body flush">${dataTable({
          rows: d.overdueInvoices, href: i => `#/invoices/${i.id}`, empty: 'No overdue invoices.',
          columns: [
            { label: 'Invoice', render: i => html`#${i.number}` },
            { label: 'Customer', render: i => i.customer_id_label },
            { label: 'Due', render: i => html`${fmtDate(i.due_date)}<div class="small muted">${relDays(i.due_date)}</div>` },
            { label: 'Balance', render: i => money(i.balance), cls: 'num' },
          ] })}</div></div>` : ''}

      <div class="card"><div class="card-head"><h2>Low stock</h2><a href="#/inventory" class="small">Inventory →</a></div>
        <div class="card-body flush">${dataTable({
          rows: d.lowStock, href: i => `#/inventory/${i.id}`, empty: 'All items are above their reorder level.',
          columns: [
            { label: 'Item', render: i => html`${i.name}<div class="small muted">${i.sku || ''}</div>` },
            { label: 'On hand', render: i => html`<b style="color:var(--bad)">${i.total_qty}</b>`, cls: 'num' },
            { label: 'Reorder at', key: 'reorder_level', cls: 'num' },
          ] })}</div></div>
    </div>`);
  if (alerts.length) wireAlerts(view, () => render(view));
}
