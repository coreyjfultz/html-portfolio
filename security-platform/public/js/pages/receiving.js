import { html, raw, mount, $, $$, money, fmtDate, badge, dataTable, openForm, loading, toast, confirmDialog, getLocations, invalidateOptions, esc } from '../ui.js';
import { R, GET, POST, PUT } from '../api.js';
import { refresh } from '../app.js';

const STATUS_CLS = { processing: 'info', 'needs review': 'warn', received: 'good', rejected: '', error: 'bad' };
const sBadge = s => badge(s, STATUS_CLS[s] ?? '');

function readFiles(fileList) {
  return Promise.all([...fileList].map(f => new Promise((resolve, reject) => {
    if (f.size > 20 * 1024 * 1024) return reject(new Error(`${f.name} is larger than 20 MB`));
    const r = new FileReader();
    r.onload = () => resolve({ name: f.name, type: f.type, data: String(r.result).split(',')[1] || '' });
    r.onerror = () => reject(new Error(`Could not read ${f.name}`));
    r.readAsDataURL(f);
  })));
}

export async function uploadPicker(onDone, { camera = false } = {}) {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = !camera;
  input.accept = camera ? 'image/*' : 'application/pdf,image/*,.csv,text/csv';
  if (camera) input.capture = 'environment';
  input.addEventListener('change', async () => {
    if (!input.files.length) return;
    try {
      toast('Uploading…');
      const files = await readFiles(input.files);
      const r = await POST('/api/receiving/upload', { files });
      toast(`${r.ids.length} document(s) uploaded — reading now`);
      onDone?.(r.ids);
    } catch (e) { toast(e.message, 'error'); }
  });
  input.click();
}

export async function list(view, _, query) {
  const info = await GET('/api/receiving/info');
  let status = query.status || (info.counts['needs review'] || info.counts.error ? 'review' : 'all');
  let timer;
  const origin = location.origin;
  mount(view, html`
    <div class="page-head"><div><h1>Receiving</h1><div class="sub">Supplier invoices and packing slips: emailed in or scanned, read automatically, added to inventory</div></div>
      <div class="actions"><button class="btn" data-camera>📷 Photo of slip</button><button class="btn primary" data-upload>Upload invoice (PDF / photo / CSV)</button></div></div>
    <div class="grid g3" style="margin-bottom:16px">
      <div class="card"><div class="card-body small">
        <b>Automatic reading:</b> ${info.ai ? html`<span class="badge good">on</span>` : html`<span class="badge warn">not set up</span>`}
        <div class="muted" style="margin-top:4px">${info.ai ? 'PDFs, photos and emails are read by Claude (AI). CSV files are read directly.'
          : 'CSV files are read directly. To read PDFs and photos, add a Claude API key on the server (see README → Supplier invoices).'}</div></div></div>
      <div class="card"><div class="card-body small">
        <b>Auto-receive:</b> ${info.auto_receive ? html`<span class="badge good">on</span>` : html`<span class="badge">off</span>`}
        <div class="muted" style="margin-top:4px">${info.auto_receive
          ? html`Stock is added automatically when every line matches a part # you already stock${info.trusted_vendor_domains ? html` and an emailed invoice comes from <b>${info.trusted_vendor_domains}</b>` : ' (emailed invoices also need a trusted distributor domain in Settings)'}. Anything else waits here for review.`
          : 'Every invoice waits here for someone to check it and click Receive.'}</div></div></div>
      <div class="card"><div class="card-body small">
        <b>Email address for invoices:</b>
        ${info.inbound_path ? html`<div class="muted" style="margin-top:4px">Point your inbound-email service at this webhook (see README):</div>
            <div class="mono" style="word-break:break-all;margin-top:4px">${origin}${info.inbound_path}</div>`
          : html`<div class="muted" style="margin-top:4px">An admin can see the email setup under Settings → Receiving.</div>`}</div></div>
    </div>
    <div class="filters"><div class="seg" data-status>
      ${[['review', `Needs review (${(info.counts['needs review'] || 0) + (info.counts.error || 0)})`], ['received', 'Received'], ['rejected', 'Rejected'], ['all', 'All']].map(([v, l]) => html`<button data-v="${v}">${l}</button>`)}</div></div>
    <div class="card"><div class="card-body flush" data-table></div></div>`);

  const load = async () => {
    clearTimeout(timer);
    $$('[data-status] button', view).forEach(b => b.classList.toggle('on', b.dataset.v === status));
    const q = status === 'review' ? { status__in: 'needs review,error,processing' } : status === 'all' ? {} : { status };
    const rows = await R.list('purchase_invoices', q);
    if (!view.isConnected) return;
    mount($('[data-table]', view), dataTable({
      rows, href: r => `#/receiving/${r.id}`, empty: status === 'review' ? 'Nothing waiting for review. 🎉' : 'No supplier invoices yet.',
      columns: [
        { label: 'Vendor', render: r => html`<b>${r.vendor || r.file_name}</b><div class="small muted">${r.invoice_number ? `#${r.invoice_number}` : ''} ${r.invoice_date ? fmtDate(r.invoice_date) : ''}</div>` },
        { label: 'Came in', render: r => html`${r.source === 'email' ? '✉️ Email' : '⬆️ Upload'}<div class="small muted">${r.from_email || r.created_at}</div>` },
        { label: 'Status', render: r => html`${sBadge(r.status)}${r.review_note && r.status !== 'received' ? html`<div class="small muted" style="max-width:340px">${r.review_note}</div>` : ''}` },
        { label: 'Total', render: r => money(r.total), cls: 'num' },
      ],
    }));
    // Keep checking while documents are still being read.
    if (rows.some(r => r.status === 'processing')) timer = setTimeout(() => { if (view.isConnected && location.hash.startsWith('#/receiving')) load(); }, 3000);
  };
  $('[data-status]', view).addEventListener('click', e => { if (e.target.dataset.v) { status = e.target.dataset.v; load(); } });
  $('[data-upload]', view).addEventListener('click', () => uploadPicker(ids => { if (ids.length === 1) location.hash = `#/receiving/${ids[0]}`; else { status = 'all'; load(); } }));
  $('[data-camera]', view).addEventListener('click', () => uploadPicker(ids => { location.hash = `#/receiving/${ids[0]}`; }, { camera: true }));
  await load();
}

export async function detail(view, [id]) {
  loading(view);
  const [inv, lines, items, locs] = await Promise.all([
    R.get('purchase_invoices', id), R.list('purchase_invoice_lines', { purchase_invoice_id: id }), R.list('inventory_items', { active: 1 }), getLocations(),
  ]);
  if (inv.status === 'processing') {
    mount(view, html`<div class="crumbs"><a href="#/receiving">Receiving</a> /</div>
      <div class="card"><div class="empty">⏳ Reading ${inv.file_name}… this usually takes 10–30 seconds.</div></div>`);
    setTimeout(() => { if (location.hash === `#/receiving/${id}`) refresh(); }, 3000);
    return;
  }
  const locked = inv.status === 'received';
  const fileUrl = `/api/receiving/${id}/file`;
  const isPdf = inv.file_type === 'application/pdf';
  const isImg = /^image\//.test(inv.file_type || '');
  const itemOpts = (sel, skip) => html`<option value="">— choose item —</option>
    <option value="skip" ${skip ? raw('selected') : ''}>Skip (don't stock this line)</option>
    <option value="new">+ Create new inventory item…</option>
    ${items.map(i => html`<option value="${i.id}" ${!skip && i.id === sel ? raw('selected') : ''}>${i.name}${i.sku ? ` (${i.sku})` : ''}</option>`)}`;
  const lineRow = l => html`<tr data-line="${l.id || ''}">
    <td data-label="Part #"><input type="text" data-f="line_sku" value="${l.line_sku || ''}" ${locked ? raw('disabled') : ''} style="min-width:120px"></td>
    <td data-label="Description"><input type="text" data-f="description" value="${l.description || ''}" ${locked ? raw('disabled') : ''} style="min-width:220px"></td>
    <td data-label="Qty"><input data-f="qty" type="number" step="any" value="${l.qty ?? 1}" ${locked ? raw('disabled') : ''} style="width:80px"></td>
    <td data-label="Unit cost"><input data-f="unit_cost" type="number" step="0.01" value="${l.unit_cost ?? ''}" ${locked ? raw('disabled') : ''} style="width:100px"></td>
    <td data-label="Inventory item">${locked ? html`${l.item_id ? html`<a href="#/inventory/${l.item_id}">${l.item_id_label}</a>` : html`<span class="muted">skipped</span>`}`
      : html`<select data-f="item_id" style="min-width:240px">${itemOpts(l.item_id, l.match === 'skip')}</select>`}
      <div class="small muted">${l.match && l.match !== 'none' ? `matched by ${l.match}` : l.item_id ? '' : html`<span style="color:var(--warn)">not matched</span>`}</div></td>
    ${locked ? '' : html`<td class="actions-cell"><button class="btn sm ghost danger" data-rm title="Remove line">✕</button></td>`}</tr>`;

  mount(view, html`
    <div class="crumbs"><a href="#/receiving">Receiving</a> /</div>
    <div class="page-head"><div><h1>${inv.vendor || 'Supplier invoice'} ${inv.invoice_number ? `#${inv.invoice_number}` : ''} ${sBadge(inv.status)}</h1>
        <div class="sub">${inv.source === 'email' ? html`Emailed by ${inv.from_email || 'unknown sender'}${inv.subject ? html` — “${inv.subject}”` : ''}` : 'Uploaded'} · ${inv.file_name}</div></div>
      <div class="actions">
        ${!locked ? html`<button class="btn" data-reread>Read again</button><button class="btn danger" data-reject>Reject</button>
          <button class="btn" data-save>Save</button><button class="btn primary" data-receive>Receive into stock</button>` : ''}
        ${locked && inv.expense_id ? html`<a class="btn" href="#/expenses">Expense recorded</a>` : ''}
      </div></div>
    ${inv.review_note && !locked ? html`<div class="${inv.status === 'error' ? 'err-box' : 'note'}" style="margin-bottom:14px">${inv.status === 'error' ? '⚠️ ' : ''}${inv.review_note}</div>` : ''}
    ${locked ? html`<div class="note" style="margin-bottom:14px">✅ Received ${inv.received_at ? inv.received_at.replace('T', ' ') : ''} into ${locs.find(l => l.id === (inv.location_id || 0))?.label || 'Warehouse'}.</div>` : ''}
    <div class="grid g2">
      <div class="card" style="grid-row:span 2"><div class="card-head"><h2>Document</h2><a class="small" href="${fileUrl}" target="_blank" rel="noopener">Open ↗</a></div>
        <div class="card-body" style="padding:0">
          ${isPdf ? html`<iframe src="${fileUrl}" title="Invoice PDF" style="width:100%;height:62vh;border:0;border-radius:0 0 10px 10px"></iframe>`
            : isImg ? html`<img src="${fileUrl}" alt="Invoice photo" style="width:100%;display:block;border-radius:0 0 10px 10px">`
            : html`<pre class="mono" data-text style="white-space:pre-wrap;margin:0;padding:16px;max-height:62vh;overflow:auto">Loading…</pre>`}</div></div>
      <div class="card"><div class="card-head"><h2>Invoice</h2></div><div class="card-body"><form class="form-grid" data-head>
          <div class="field"><label for="r_vendor">Vendor</label><input type="text" id="r_vendor" name="vendor" value="${inv.vendor || ''}" ${locked ? raw('disabled') : ''}></div>
          <div class="field"><label for="r_num">Invoice #</label><input type="text" id="r_num" name="invoice_number" value="${inv.invoice_number || ''}" ${locked ? raw('disabled') : ''}></div>
          <div class="field"><label for="r_date">Invoice date</label><input id="r_date" type="date" name="invoice_date" value="${inv.invoice_date || ''}" ${locked ? raw('disabled') : ''}></div>
          <div class="field"><label for="r_loc">Receive into</label><select id="r_loc" name="location_id" ${locked ? raw('disabled') : ''}>${locs.map(l => html`<option value="${l.id}" ${l.id === (inv.location_id || 0) ? raw('selected') : ''}>${l.label}</option>`)}</select></div>
          <div class="field"><label for="r_sub">Subtotal</label><input id="r_sub" type="number" step="0.01" name="subtotal" value="${inv.subtotal ?? ''}" ${locked ? raw('disabled') : ''}></div>
          <div class="field"><label for="r_tax">Tax</label><input id="r_tax" type="number" step="0.01" name="tax" value="${inv.tax ?? ''}" ${locked ? raw('disabled') : ''}></div>
          <div class="field"><label for="r_ship">Shipping</label><input id="r_ship" type="number" step="0.01" name="shipping" value="${inv.shipping ?? ''}" ${locked ? raw('disabled') : ''}></div>
          <div class="field"><label for="r_total">Total</label><input id="r_total" type="number" step="0.01" name="total" value="${inv.total ?? ''}" ${locked ? raw('disabled') : ''}></div>
        </form>
        ${locked ? '' : html`<label class="row small" style="margin-top:14px"><input type="checkbox" data-expense checked> Record this invoice as a Parts & equipment expense</label>`}</div></div>
      <div class="card" style="grid-column:1/-1"><div class="card-head"><div><h2>Line items</h2><div class="small muted" data-sum></div></div>
          ${locked ? '' : html`<button class="btn sm" data-addline>+ Line</button>`}</div>
          <div class="card-body flush"><div class="table-wrap"><table class="t responsive"><thead><tr><th>Part #</th><th>Description</th><th>Qty</th><th>Unit cost</th><th>Inventory item</th>${locked ? '' : html`<th></th>`}</tr></thead>
            <tbody data-lines>${lines.map(lineRow)}</tbody></table></div>
            ${!lines.length ? html`<div class="empty" data-nolines>No lines yet. ${locked ? '' : 'Add them with “+ Line”.'}</div>` : ''}</div></div>
    </div>`);

  if (!isPdf && !isImg) {
    fetch(fileUrl, { credentials: 'same-origin' }).then(r => r.text()).then(t => { const pre = $('[data-text]', view); if (pre) pre.textContent = t; });
  }
  if (locked) return;

  const tbody = $('[data-lines]', view);
  const updateSum = () => {
    const rows = $$('tr[data-line]', tbody).filter(tr => tr.querySelector('[data-f=item_id]').value !== 'skip');
    const sum = rows.reduce((s, tr) => s + (Number(tr.querySelector('[data-f=qty]').value) || 0) * (Number(tr.querySelector('[data-f=unit_cost]').value) || 0), 0);
    const open = $$('tr[data-line]', tbody).filter(tr => !tr.querySelector('[data-f=item_id]').value).length;
    const sub = Number($('[name=subtotal]', view).value);
    $('[data-sum]', view).innerHTML = esc(`Lines total ${money(sum)}`) + (sub && Math.abs(sub - sum) > 1 ? ` · <span style="color:var(--warn)">${esc(`subtotal says ${money(sub)}`)}</span>` : '')
      + (open ? ` · <span style="color:var(--warn)">${open} not matched</span>` : '');
  };
  const wire = tr => {
    tr.querySelectorAll('input').forEach(i => i.addEventListener('input', updateSum));
    const sel = tr.querySelector('[data-f=item_id]');
    sel.addEventListener('change', async () => {
      if (sel.value === 'new') {
        sel.value = '';
        const created = await openForm('inventory_items', { title: 'New inventory item', defaults: {
          sku: tr.querySelector('[data-f=line_sku]').value, name: tr.querySelector('[data-f=description]').value,
          unit_cost: tr.querySelector('[data-f=unit_cost]').value || null } });
        if (created) {
          invalidateOptions('inventory_items');
          items.push(created);
          $$('[data-f=item_id]', tbody).forEach(s => { const o = document.createElement('option'); o.value = created.id; o.textContent = `${created.name}${created.sku ? ` (${created.sku})` : ''}`; s.append(o); });
          sel.value = String(created.id);
        }
      }
      updateSum();
    });
    tr.querySelector('[data-rm]').addEventListener('click', () => { tr.remove(); updateSum(); });
  };
  $$('tr[data-line]', tbody).forEach(wire);
  $('[name=subtotal]', view).addEventListener('input', updateSum);
  updateSum();
  $('[data-addline]', view).addEventListener('click', () => {
    $('[data-nolines]', view)?.remove();
    const t = document.createElement('tbody');
    mount(t, lineRow({ qty: 1 }));
    const tr = t.firstElementChild;
    tbody.append(tr);
    wire(tr);
    tr.querySelector('input').focus();
  });

  const collect = () => {
    const head = Object.fromEntries(new FormData($('[data-head]', view)));
    head.lines = $$('tr[data-line]', tbody).map(tr => {
      const v = f => tr.querySelector(`[data-f=${f}]`).value;
      const item = v('item_id');
      return { id: tr.dataset.line ? Number(tr.dataset.line) : undefined, line_sku: v('line_sku'), description: v('description'), qty: v('qty'), unit_cost: v('unit_cost'),
        item_id: item && item !== 'skip' ? Number(item) : null, skip: item === 'skip' };
    });
    return head;
  };
  const save = async () => { await PUT(`/api/receiving/${id}`, collect()); };

  $('[data-save]', view).addEventListener('click', async () => { try { await save(); toast('Saved'); refresh(); } catch (e) { toast(e.message, 'error'); } });
  $('[data-receive]', view).addEventListener('click', async () => {
    try {
      await save();
      const body = { record_expense: $('[data-expense]', view).checked };
      try { await POST(`/api/receiving/${id}/receive`, body); }
      catch (e) {
        if (!/already received/i.test(e.message)) throw e;
        if (!(await confirmDialog(`${e.message}. Receive it anyway?`, { okLabel: 'Receive anyway', danger: true }))) return;
        await POST(`/api/receiving/${id}/receive`, { ...body, allow_duplicate: true });
      }
      toast('Received — inventory updated');
      refresh();
    } catch (e) { toast(e.message, 'error'); }
  });
  $('[data-reread]', view).addEventListener('click', async () => {
    if (!(await confirmDialog('Read the document again? Any lines you edited will be replaced.', { okLabel: 'Read again' }))) return;
    await POST(`/api/receiving/${id}/reread`); refresh();
  });
  $('[data-reject]', view).addEventListener('click', async () => {
    if (!(await confirmDialog('Reject this document? Nothing will be added to inventory.', { okLabel: 'Reject', danger: true }))) return;
    await POST(`/api/receiving/${id}/reject`); toast('Rejected'); location.hash = '#/receiving';
  });
}
