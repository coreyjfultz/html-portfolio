// Vehicle checklist on the phone, and its history on the vehicle page.
import { html, mount, $, $$, fmtDateTime, badge, openModal, toast, pickPhotos, resizeImage, num } from '../ui.js';
import { GET, POST } from '../api.js';
import { can } from '../app.js';
import { VEHICLE_CHECK, VEHICLE_ITEMS, TIRES } from '../vehicle-checks.js';

const LABEL = Object.fromEntries(VEHICLE_ITEMS.map(i => [i.id, i.text]));

const showErr = (el, msg) => { const b = $('[data-err]', el); b.textContent = msg; b.classList.remove('hidden'); b.scrollIntoView({ block: 'nearest' }); };

export async function vehicleCheckDialog(v, onDone) {
  const info = await GET(`/api/vehicles/${v.id}/checks`);
  const photos = [];
  const { el, close } = openModal({
    title: `Vehicle check — ${v.unit_name}`,
    body: html`<div class="err-box hidden" data-err></div>
      <div class="field"><label for="vc_odo">Odometer (miles)</label><input id="vc_odo" type="number" inputmode="numeric" placeholder="${v.mileage ? `last ${num(v.mileage)}` : ''}"></div>
      <div class="stack ir-form" style="gap:12px;margin-top:12px">${VEHICLE_CHECK.map(sec => html`<div><h3 style="margin:6px 0">${sec.title}</h3><div class="stack" style="gap:8px">
        ${sec.items.map(i => i.kind === 'tires' ? html`<div class="ir-item" data-tires><div class="ir-q">${i.text}${info.tire_psi ? html` <span class="small muted">(target ${info.tire_psi} psi)</span>` : ''}</div>
            <div class="tire-grid">${Object.entries(TIRES).map(([k, l]) => html`<label class="small">${l}<input type="number" inputmode="decimal" data-psi="${k}" aria-label="${l} psi"></label>`)}</div></div>`
          : html`<div class="ir-item" data-vc="${i.id}" data-name="${i.text}"><div class="ir-q">${i.text}</div>
            <span class="seg"><label class="pass"><input type="radio" name="vc_${i.id}" value="ok"> OK</label><label class="fail"><input type="radio" name="vc_${i.id}" value="issue"> Problem</label></span>
            <input type="text" class="ir-note hidden" data-note placeholder="What’s wrong?" aria-label="What's wrong with ${i.text}"></div>`)}</div></div>`)}</div>
      <div class="field" style="margin-top:12px"><label>Photos <span class="muted small">(required for damage)</span></label>
        <div class="row"><button type="button" class="btn sm" data-photo>📷 Add photos</button><span class="small muted" data-pcount>None yet</span></div></div>
      <div class="field" style="margin-top:12px"><label for="vc_notes">Other notes</label><input id="vc_notes" type="text"></div>`,
    foot: html`<button class="btn" data-close>Cancel</button><button class="btn primary" data-go>Submit check</button>`,
  });
  $$('[data-vc]', el).forEach(row => row.addEventListener('change', () => {
    const issue = $('input:checked', row)?.value === 'issue';
    row.classList.toggle('failed', issue);
    $('[data-note]', row).classList.toggle('hidden', !issue);
    if (issue) $('[data-note]', row).focus();
  }));
  $('[data-photo]', el).addEventListener('click', async () => {
    for (const f of await pickPhotos()) photos.push(await resizeImage(f));
    $('[data-pcount]', el).textContent = `${photos.length} photo${photos.length === 1 ? '' : 's'} ready`;
  });
  $('[data-go]', el).addEventListener('click', async () => {
    const items = {};
    for (const row of $$('[data-vc]', el)) {
      const r = $('input:checked', row)?.value;
      if (!r) return showErr(el, `Answer every item (${row.dataset.name})`);
      items[row.dataset.vc] = { r, note: $('[data-note]', row).value };
    }
    items.tire_psi = { psi: Object.fromEntries($$('[data-psi]', el).map(i => [i.dataset.psi, i.value])) };
    $('[data-go]', el).disabled = true;
    try {
      const r = await POST(`/api/vehicles/${v.id}/checks`, { items, odometer: $('#vc_odo', el).value, photos, notes: $('#vc_notes', el).value });
      close();
      toast(r.status === 'ok' ? 'Vehicle check done — all good' : `Vehicle check sent — ${r.issues.length} problem(s) reported to the office`, r.status === 'ok' ? '' : 'error');
      onDone?.();
    } catch (e) { showErr(el, e.message); $('[data-go]', el).disabled = false; }
  });
}

/** Vehicle page card: due status + history. */
export async function vehicleChecksCard(card, v, { canCheck = false } = {}) {
  const d = await GET(`/api/vehicles/${v.id}/checks`).catch(() => null);
  if (!d) { card.classList.add('hidden'); return; }
  mount(card, html`<div class="card-head"><div><h2>Vehicle checks</h2><div class="small muted">${d.frequency === 'off' ? 'Turned off' : `${d.frequency === 'weekly' ? 'Weekly' : 'Daily'} — oil, tires, lights, damage walk-around, clean truck`}</div></div>
      <div class="row">${d.due ? badge('due', 'warn') : badge('done', 'good')}${canCheck ? html`<button class="btn sm primary" data-check>Do vehicle check</button>` : ''}</div></div>
    <div class="card-body stack" style="gap:8px">${d.checks.length ? d.checks.slice(0, 10).map(c => html`<div class="alert-row ${c.status === 'ok' ? 'info' : 'bad'}">
        <div><b>${fmtDateTime(c.created_at.replace(' ', 'T'))}</b> · ${c.user_name}${c.odometer ? ` · ${num(c.odometer)} mi` : ''}
          ${c.status === 'ok' ? html`<div class="small muted">All OK</div>` : html`<ul class="small" style="margin:4px 0 0;padding-left:18px">${Object.entries(c.items).filter(([, a]) => a.r === 'issue').map(([k, a]) => html`<li><b>${LABEL[k] || k}</b>${a.psi ? ` — ${Object.entries(a.psi).map(([t, n]) => `${TIRES[t]} ${n}`).join(', ')} psi` : ''}${a.note ? ` — ${a.note}` : ''}</li>`)}</ul>`}
          ${c.photos.length ? html`<div class="photo-grid" style="margin-top:6px">${c.photos.map(u => html`<figure class="photo"><a href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="Vehicle check photo" loading="lazy"></a></figure>`)}</div>` : ''}
          ${c.reviewed_by ? html`<div class="small muted">Reviewed by ${c.reviewed_by}</div>` : ''}</div>
        ${c.status !== 'ok' && !c.reviewed_by && can.manage() ? html`<button class="btn sm ghost" data-review="${c.id}">Mark reviewed</button>` : ''}</div>`)
      : html`<div class="muted">No checks yet.</div>`}</div>`);
  $('[data-check]', card)?.addEventListener('click', () => vehicleCheckDialog(v, () => vehicleChecksCard(card, v, { canCheck })));
  $$('[data-review]', card).forEach(b => b.addEventListener('click', async () => { await POST(`/api/vehicle-checks/${b.dataset.review}/review`); vehicleChecksCard(card, v, { canCheck }); }));
}

