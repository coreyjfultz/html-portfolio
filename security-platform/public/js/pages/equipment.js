// Installed equipment: serial numbers, where it's installed, warranty, label photos.
import { html, mount, $, $$, fmtDate, badge, dataTable, openForm, openModal, toast, pickPhotos, resizeImage, todayStr } from '../ui.js';
import { R, GET, POST, api } from '../api.js';

const warrantyCell = e => {
  if (!e.warranty_expires) return html`<span class="muted">—</span>`;
  const left = e.warranty_expires >= todayStr();
  return html`${badge(left ? 'in warranty' : 'expired', left ? 'good' : '')}<div class="small muted">${fmtDate(e.warranty_expires)}</div>`;
};

async function addPhotos(e, after) {
  const files = await pickPhotos();
  if (!files.length) return;
  toast('Uploading…');
  try { for (const f of files) await POST(`/api/equipment/${e.id}/photos`, { data: await resizeImage(f), caption: 'Label / warranty' }); toast('Photo saved'); }
  catch (err) { toast(err.message, 'error'); }
  after?.();
}

export async function photosDialog(e, onChange) {
  const photos = await GET(`/api/equipment/${e.id}/photos`);
  const { el, close } = openModal({
    title: `${e.description}${e.serial_number ? ` · S/N ${e.serial_number}` : ''}`,
    body: html`<dl class="dl small" style="margin-bottom:12px"><dt>Installed</dt><dd>${fmtDate(e.install_date)}${e.location ? ` — ${e.location}` : ''}</dd>
        <dt>Warranty</dt><dd>${warrantyCell(e)}</dd>${e.mac_address ? html`<dt>MAC</dt><dd class="mono">${e.mac_address}</dd>` : ''}</dl>
      ${photos.length ? html`<div class="photo-grid">${photos.map(p => html`<figure class="photo"><a href="/api/equipment-photos/${p.id}" target="_blank" rel="noopener"><img src="/api/equipment-photos/${p.id}" alt="Label photo" loading="lazy"></a>
        <button class="photo-del" data-del="${p.id}" aria-label="Delete photo">✕</button></figure>`)}</div>` : html`<div class="muted">No photos yet.</div>`}`,
    foot: html`<button class="btn" data-close>Close</button><button class="btn primary" data-add>📷 Add photo</button>`,
  });
  const again = () => { close(); onChange?.(); photosDialog(e, onChange); };
  $('[data-add]', el).addEventListener('click', () => addPhotos(e, again));
  $$('[data-del]', el).forEach(b => b.addEventListener('click', async () => { await api('DELETE', `/api/equipment-photos/${b.dataset.del}`); again(); }));
}

/** Job page card: one line per serialized unit used — serial, where, label photo. */
export async function jobEquipmentCard(card, c, { onChange } = {}) {
  const rows = await R.list('installed_equipment', { service_call_id: c.id }).catch(() => []);
  const counts = Object.fromEntries(await Promise.all(rows.map(async e => [e.id, (await GET(`/api/equipment/${e.id}/photos`).catch(() => [])).length])));
  if (!rows.length) { mount(card, html`<div class="card-head"><div><h2>Equipment & serial numbers</h2><div class="small muted">Cameras, recorders, panels and other serial-tracked items used on this job appear here.</div></div><button class="btn sm" data-addeq>+ Equipment</button></div>`); }
  else {
    const missing = rows.filter(e => !e.serial_number || !counts[e.id]).length;
    mount(card, html`<div class="card-head"><div><h2>Equipment & serial numbers</h2><div class="small muted">${missing ? `${missing} still need a serial # and a label / warranty photo` : 'All recorded'}</div></div><button class="btn sm" data-addeq>+ Equipment</button></div>
      <div class="card-body stack" style="gap:8px">${rows.map(e => html`<div class="ir-item ${!e.serial_number || !counts[e.id] ? 'todo-row' : ''}" data-eq="${e.id}">
        <div class="row" style="justify-content:space-between"><b>${e.description}</b>${badge(counts[e.id] ? `${counts[e.id]} photo${counts[e.id] > 1 ? 's' : ''}` : 'no photo', counts[e.id] ? 'good' : 'warn')}</div>
        <div class="eq-grid"><input type="text" data-k="serial_number" value="${e.serial_number || ''}" placeholder="Serial #" aria-label="Serial number" autocapitalize="characters">
          <input type="text" data-k="location" value="${e.location || ''}" placeholder="Installed where" aria-label="Installed where">
          <button class="btn sm" data-photo>📷 Label photo</button><button class="btn sm ghost" data-view>View</button></div></div>`)}</div>`);
  }
  const again = () => { jobEquipmentCard(card, c, { onChange }); onChange?.(); };
  $$('[data-eq]', card).forEach(row => {
    const e = rows.find(x => x.id === Number(row.dataset.eq));
    $$('[data-k]', row).forEach(i => i.addEventListener('change', async () => {
      try { await R.update('installed_equipment', e.id, { [i.dataset.k]: i.value }); toast('Saved'); }
      catch (err) { toast(err.message, 'error'); i.focus(); }
    }));
    $('[data-photo]', row).addEventListener('click', () => addPhotos(e, again));
    $('[data-view]', row).addEventListener('click', () => photosDialog(e, again));
  });
  $('[data-addeq]', card).addEventListener('click', () => openForm('installed_equipment', { defaults: { customer_id: c.customer_id, site_id: c.site_id }, hide: ['customer_id'], onSaved: again }));
  return rows.map(e => ({ ...e, photos: counts[e.id] }));
}

/** Customer page tab. */
export async function customerEquipmentTab(pane, c) {
  const rows = await R.list('installed_equipment', { customer_id: c.id });
  const f = { q: '', status: 'installed' };
  mount(pane, html`<div class="card"><div class="card-head"><div><h2>Installed equipment</h2><div class="small muted">Serial numbers, where it’s installed, warranty and label photos — for warranty claims and service</div></div>
      <button class="btn sm" data-add>+ Equipment</button></div>
    <div class="filters" style="padding:0 16px"><input type="search" data-q placeholder="Serial, model, location" aria-label="Search equipment">
      <select data-status aria-label="Status"><option value="installed">Installed</option><option value="">All</option><option value="replaced">Replaced</option><option value="removed">Removed</option><option value="sent for RMA">Sent for RMA</option></select></div>
    <div class="card-body flush" data-table></div></div>`);
  const draw = () => {
    const q = f.q.toLowerCase();
    mount($('[data-table]', pane), dataTable({
      rows: rows.filter(e => (!f.status || e.status === f.status) && (!q || [e.serial_number, e.description, e.model, e.location, e.mac_address].some(x => x?.toLowerCase().includes(q)))),
      empty: 'Nothing recorded yet. Serial-tracked items used on jobs are added automatically.',
      columns: [
        { label: 'Equipment', render: e => html`<b>${e.description}</b><div class="small muted">${[e.model, e.site_id_label?.split(' — ')[0]].filter(Boolean).join(' · ')}</div>` },
        { label: 'Serial #', render: e => e.serial_number ? html`<span class="mono">${e.serial_number}</span>` : badge('missing', 'warn') },
        { label: 'Where', render: e => e.location || '—' },
        { label: 'Installed', render: e => html`${fmtDate(e.install_date)}${e.service_call_id ? html`<div class="small"><a href="#/calls/${e.service_call_id}">${e.service_call_id_label || 'job'}</a></div>` : ''}` },
        { label: 'Warranty', render: warrantyCell },
        { label: 'Status', render: e => badge(e.status, { installed: 'good', 'sent for RMA': 'warn' }[e.status] || '') },
        { label: '', cls: 'actions-cell', render: e => html`<button class="btn sm ghost" data-photos="${e.id}">Photos</button><button class="btn sm ghost" data-edit="${e.id}">Edit</button>` },
      ] }));
    $$('[data-photos]', pane).forEach(b => b.addEventListener('click', () => photosDialog(rows.find(e => e.id === Number(b.dataset.photos)))));
    $$('[data-edit]', pane).forEach(b => b.addEventListener('click', () => openForm('installed_equipment', { record: rows.find(e => e.id === Number(b.dataset.edit)), hide: ['customer_id'], onSaved: () => customerEquipmentTab(pane, c), onDeleted: () => customerEquipmentTab(pane, c) })));
  };
  $('[data-q]', pane).addEventListener('input', e => { f.q = e.target.value; draw(); });
  $('[data-status]', pane).addEventListener('change', e => { f.status = e.target.value; draw(); });
  $('[data-add]', pane).addEventListener('click', () => openForm('installed_equipment', { defaults: { customer_id: c.id }, hide: ['customer_id'], onSaved: () => customerEquipmentTab(pane, c) }));
  draw();
}
