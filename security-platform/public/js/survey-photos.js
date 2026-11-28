// Site survey photos for quotes: a gallery on the customer (and on each proposal) where sales
// adds photos of where things will go, marks them up, writes notes, and picks which ones the
// customer sees on the proposal.
import { html, mount, $, $$, toast, confirmDialog, pickPhotos, resizeImage, icon } from './ui.js';
import { GET, POST, PUT, api } from './api.js';
import { markupPhoto } from './markup.js';

/**
 * box: element to draw into. opts: { customerId, proposalId?, locked?, canEdit, sites? }
 */
export async function surveyGallery(box, opts) {
  const { customerId, proposalId = null, locked = false, canEdit = true, sites = [] } = opts;
  const redraw = () => surveyGallery(box, opts);
  const photos = await GET(`/api/customers/${customerId}/survey-photos`, proposalId ? { proposal_id: proposalId } : {});
  const shown = photos.filter(p => p.proposal_id === Number(proposalId) && p.show_on_proposal);
  const siteName = id => sites.find(s => s.id === id)?.name;
  mount(box, html`<div class="card-head"><div><h2>${icon('camera')} Site survey photos</h2>
      <div class="small muted">${proposalId ? `Photos of where things will go, with notes. Tick “On proposal” to show one to the customer${locked ? ' (locked: signed)' : ''}. ${shown.length} shown.` : 'Photos of where things will go, marked up, with notes. Use them when building the quote.'}</div></div>
      ${canEdit ? html`<div class="row"><button class="btn sm primary" data-take>📷 Take photo</button><button class="btn sm" data-upload>Upload</button></div>` : ''}</div>
    <div class="card-body">${photos.length ? html`<div class="survey-grid">${photos.map(p => html`<figure class="survey-card ${p.show_on_proposal && p.proposal_id === Number(proposalId) ? 'on' : ''}">
        <button class="survey-img" data-open="${p.id}" aria-label="Open ${p.title || 'photo'}"><img src="${p.url}" alt="${p.title || 'Site survey photo'}" loading="lazy"></button>
        <figcaption><b>${p.title || 'Untitled'}</b>${p.site_id && siteName(p.site_id) ? html` <span class="small muted">· ${siteName(p.site_id)}</span>` : ''}
          ${p.note ? html`<div class="small survey-note">${p.note}</div>` : ''}
          <div class="small muted">${p.created_by || ''} · ${String(p.created_at).slice(0, 10)}</div>
          ${proposalId && canEdit ? html`<label class="check-row small"><input type="checkbox" data-show="${p.id}" ${p.show_on_proposal && p.proposal_id === Number(proposalId) ? 'checked' : ''} ${locked ? 'disabled' : ''}> <span>On proposal</span></label>` : ''}
          ${canEdit ? html`<div class="row" style="gap:4px;margin-top:4px"><button class="btn sm ghost" data-edit="${p.id}" ${locked && p.show_on_proposal ? 'disabled' : ''}>Mark up / edit</button><button class="btn sm ghost danger" data-del="${p.id}" ${locked && p.show_on_proposal ? 'disabled' : ''}>Delete</button></div>` : ''}
        </figcaption></figure>`)}</div>`
      : html`<div class="muted">No photos yet.${canEdit ? ' On a site visit, tap “Take photo”, draw where the equipment goes, and add notes.' : ''}</div>`}</div>`);

  const add = async camera => {
    const files = await pickPhotos({ camera, multiple: !camera });
    for (const f of files) {
      const data = await resizeImage(f, 1600, 0.85);
      const r = await markupPhoto(data, { heading: 'New site survey photo', saveLabel: 'Save photo' });
      if (!r) continue;
      try {
        await POST(`/api/customers/${customerId}/survey-photos`, { photo: r.photo || data, title: r.title, note: r.note, proposal_id: proposalId, show_on_proposal: !!proposalId && !locked });
        toast('Photo saved');
      } catch (e) { toast(e.message, 'error'); }
    }
    if (files.length && opts.onChange) opts.onChange(); else redraw();
  };
  $('[data-take]', box)?.addEventListener('click', () => add(true));
  $('[data-upload]', box)?.addEventListener('click', () => add(false));
  const find = id => photos.find(p => p.id === Number(id));
  $$('[data-open]', box).forEach(b => b.addEventListener('click', () => window.open(find(b.dataset.open).url, '_blank', 'noopener')));
  $$('[data-edit]', box).forEach(b => b.addEventListener('click', async () => {
    const p = find(b.dataset.edit);
    const r = await markupPhoto(p.url, { title: p.title || '', note: p.note || '', heading: 'Edit site survey photo' });
    if (!r) return;
    try { await PUT(`/api/survey-photos/${p.id}`, { title: r.title, note: r.note, ...(r.photo ? { photo: r.photo } : {}) }); toast('Saved'); } catch (e) { toast(e.message, 'error'); }
    if (opts.onChange && p.show_on_proposal) opts.onChange(); else redraw();
  }));
  $$('[data-show]', box).forEach(c => c.addEventListener('change', async () => {
    try { await PUT(`/api/survey-photos/${c.dataset.show}`, { proposal_id: proposalId, show_on_proposal: c.checked }); opts.onChange?.(); } catch (e) { toast(e.message, 'error'); }
    redraw();
  }));
  $$('[data-del]', box).forEach(b => b.addEventListener('click', async () => {
    if (!(await confirmDialog('Delete this photo?', { okLabel: 'Delete', danger: true }))) return;
    try { await api('DELETE', `/api/survey-photos/${b.dataset.del}`); opts.onChange?.(); } catch (e) { toast(e.message, 'error'); }
    redraw();
  }));
}
