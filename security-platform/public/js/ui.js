import { RESOURCES, fieldDefault, STAGE_INFO } from './schema.js';
import { R, api } from './api.js';

// ---------------------------------------------------------------- safe HTML
// Every interpolated value is escaped unless it is a Safe (from html`` or raw()).
export class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = s => new Safe(String(s ?? ''));
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const val = v => v instanceof Safe ? v.s : Array.isArray(v) ? v.map(val).join('') : (v == null || v === false) ? '' : esc(v);
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => { out += val(v) + strings[i + 1]; });
  return new Safe(out);
}
export const mount = (el, content) => { el.innerHTML = content instanceof Safe ? content.s : esc(content); return el; };
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------------------------------------------------------------- formatting
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
export const money = n => n == null || n === '' ? '—' : usd.format(Number(n));
export const money0 = n => usd0.format(Number(n) || 0);
export const num = n => n == null || n === '' ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
export function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d.length === 10 ? d + 'T12:00:00' : d);
  return isNaN(dt) ? d : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
export function fmtDateTime(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return isNaN(dt) ? d : dt.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
export const fmtTime = d => d ? new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
export const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export function relDays(d) {
  if (!d) return '';
  const days = Math.round((new Date(d.slice(0, 10) + 'T12:00:00') - new Date(todayStr() + 'T12:00:00')) / 864e5);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}
export const initials = name => String(name || '?').split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();

const BADGE = {
  active: 'good', paid: 'good', completed: 'good', 'in service': 'good',
  sent: 'info', scheduled: 'info', 'in progress': 'primary', partial: 'warn',
  new: 'primary', 'on hold': 'warn', prospect: 'warn', 'needs service': 'warn', draft: '', high: 'warn',
  overdue: 'bad', emergency: 'bad', void: 'bad', cancelled: '', inactive: '', 'out of service': 'bad', removed: '', low: '', normal: '',
  'en route': 'primary', signed: 'good', accepted: 'good', declined: 'bad', expired: '', viewed: 'info',
};
const STAGE_CLS = { lead: 'stage-lead', 'site survey': 'stage-survey', bid: 'stage-bid', accepted: 'stage-accepted', installation: 'stage-install', active: 'good', lost: '' };
export const stageBadge = s => s ? html`<span class="badge ${STAGE_CLS[s] || ''}">${STAGE_INFO[s]?.label || s}</span>` : '';
const optLabel = (f, o) => f.optionLabels?.[o] || (o ? o[0].toUpperCase() + o.slice(1) : o);
export const badge = (v, cls) => v ? html`<span class="badge ${cls ?? BADGE[v] ?? ''}">${v}</span>` : '';
export const typeBadge = t => t ? html`<span class="badge ${t === 'commercial' ? 'type-com' : 'type-res'}">${t === 'commercial' ? 'Commercial' : 'Residential'}</span>` : '';

export function renderValue(f, row, resource) {
  const v = row[f.name];
  switch (f.type) {
    case 'ref': case 'location': return row[`${f.name}_label`] ?? (v == null ? '—' : v);
    case 'money': return money(v);
    case 'number': return num(v);
    case 'date': return fmtDate(v);
    case 'datetime': return fmtDateTime(v);
    case 'checkbox': return v ? '✓' : '';
    case 'color': return html`<span class="dot" style="background:${v || '#64748b'}"></span>`;
    case 'secret': return resource ? secretView(resource, row.id, f.name, row[`${f.name}__set`]) : (row[`${f.name}__set`] ? '••••••' : '—');
    case 'select':
      if (f.name === 'type' && (v === 'commercial' || v === 'residential')) return typeBadge(v);
      if (f.name === 'stage') return stageBadge(v);
      if (['status', 'priority'].includes(f.name)) return badge(v);
      return v ? optLabel(f, v) : '—';
    case 'email': return v ? html`<a href="mailto:${v}">${v}</a>` : '—';
    case 'tel': return v ? html`<a href="tel:${v}">${v}</a>` : '—';
    default: return v || '—';
  }
}

// A masked secret with Show / Copy buttons (handled by a global click delegate).
export function secretView(resource, id, field, isSet) {
  if (!isSet) return html`<span class="muted">not set</span>`;
  return html`<span class="secret-row"><span class="mono" data-secret-out>••••••••</span>
    <button class="btn sm ghost" data-reveal="${resource}" data-id="${id}" data-field="${field}">Show</button></span>`;
}

// ---------------------------------------------------------------- toast & modal
export function toast(msg, kind = '') {
  let box = $('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.append(box); }
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = msg;
  box.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 6000 : 3000);
}

export function openModal({ title, body, foot, size = '', onMount }) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  mount(back, html`<div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${title}">
    <div class="modal-head"><h2>${title}</h2><button class="btn ghost sm" data-close aria-label="Close">✕</button></div>
    <div class="modal-body">${body}</div>
    ${foot ? html`<div class="modal-foot">${foot}</div>` : ''}
  </div>`);
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  back.addEventListener('mousedown', e => { if (e.target === back) close(); });
  back.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
  document.body.append(back);
  onMount?.(back, close);
  back.querySelector('input:not([type=hidden]):not([readonly]), select, textarea')?.focus();
  return { el: back, close };
}

export function confirmDialog(message, { okLabel = 'Confirm', danger = false } = {}) {
  return new Promise(resolve => {
    let done = false;
    const { el, close } = openModal({
      title: 'Please confirm', size: 'sm', body: html`<p style="margin:0">${message}</p>`,
      foot: html`<button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'danger solid' : 'primary'}" data-ok>${okLabel}</button>`,
    });
    el.querySelector('[data-ok]').addEventListener('click', () => { done = true; close(); resolve(true); });
    new MutationObserver((_, obs) => { if (!el.isConnected) { obs.disconnect(); if (!done) resolve(false); } }).observe(document.body, { childList: true });
  });
}

// ---------------------------------------------------------------- tables
// columns: [{ label, render(row) | key, cls }]
export function dataTable({ columns, rows, href, empty = 'Nothing here yet.', foot }) {
  if (!rows.length) return html`<div class="empty">${empty}</div>`;
  return html`<div class="table-wrap"><table class="t responsive">
    <thead><tr>${columns.map(c => html`<th class="${c.cls || ''}">${c.label}</th>`)}</tr></thead>
    <tbody>${rows.map(r => html`<tr class="${href ? 'click' : ''}" ${href ? raw(`data-href="${esc(href(r))}"`) : ''}>
      ${columns.map(c => html`<td class="${c.cls || ''}" data-label="${c.label}"><div class="cv">${c.render ? c.render(r) : r[c.key] ?? ''}</div></td>`)}</tr>`)}
    </tbody>${foot ? html`<tfoot>${foot}</tfoot>` : ''}</table></div>`;
}

export function fieldColumns(resource, names) {
  const def = RESOURCES[resource];
  const fields = names ? names.map(n => def.fields.find(f => f.name === n)).filter(Boolean) : def.fields.filter(f => f.list);
  return fields.map(f => ({ label: f.label.replace(/ \(.*\)$/, ''), render: r => renderValue(f, r, resource), cls: ['money', 'number'].includes(f.type) ? 'num' : '' }));
}

// ---------------------------------------------------------------- forms
const optionCache = new Map();
export function invalidateOptions(resource) { optionCache.delete(resource); }
async function refOptions(ref) {
  if (!optionCache.has(ref)) {
    const q = ['technicians', 'inventory_items', 'locations'].includes(ref) ? { active: 1 } : ref === 'customers' ? { status__not: 'inactive' } : {};
    optionCache.set(ref, R.list(ref, q).catch(e => { optionCache.delete(ref); throw e; }));
  }
  return optionCache.get(ref);
}
async function locationOptions() {
  const vehicles = await refOptions('vehicles');
  return [{ id: 0, label: 'Warehouse / shop' }, ...vehicles.filter(v => v.status !== 'sold').map(v => ({ id: v.id, label: v.unit_name + (v.assigned_technician_id_label ? ` (${v.assigned_technician_id_label})` : '') }))];
}
export const getLocations = locationOptions;

async function fieldHtml(f, value, record) {
  const id = `f_${f.name}`;
  const req = f.required ? html`<span class="req">*</span>` : '';
  const help = f.help ? html`<span class="help">${f.help}</span>` : '';
  const label = html`<label for="${id}">${f.label} ${req}</label>`;
  const full = f.full || f.type === 'textarea' ? 'full' : '';
  if (f.readonly) {
    return html`<div class="field ${full}">${html`<label>${f.label}</label>`}<div style="padding:8px 0">${renderValue(f, record || {})}</div></div>`;
  }
  let input;
  switch (f.type) {
    case 'textarea': input = html`<textarea id="${id}" name="${f.name}">${value ?? ''}</textarea>`; break;
    case 'select':
      input = html`<select id="${id}" name="${f.name}" ${f.required ? raw('required') : ''}>
        ${f.required ? '' : html`<option value="">—</option>`}
        ${f.options.map(o => html`<option value="${o}" ${o === value ? raw('selected') : ''}>${f.name === 'stage' ? STAGE_INFO[o]?.label : optLabel(f, o)}</option>`)}</select>`;
      break;
    case 'ref': {
      const opts = await refOptions(f.ref);
      const labelKey = { customers: 'name', technicians: 'name', vehicles: 'unit_name', inventory_items: 'name', invoices: 'number', service_calls: 'title', locations: 'name', expenses: 'description' }[f.ref];
      const fmt = o => f.ref === 'invoices' ? `#${o.number} — ${o.customer_id_label} (${money(o.total)})` : f.ref === 'service_calls' ? `SC-${o.number} ${o.title}` : f.ref === 'inventory_items' ? `${o.name}${o.sku ? ` (${o.sku})` : ''}` : o[labelKey];
      const has = opts.some(o => o.id === value);
      input = html`<select id="${id}" name="${f.name}" ${f.required ? raw('required') : ''}>
        <option value="">${f.required ? 'Select…' : '— none —'}</option>
        ${!has && value != null ? html`<option value="${value}" selected>${record?.[`${f.name}_label`] ?? `#${value}`}</option>` : ''}
        ${opts.map(o => html`<option value="${o.id}" ${o.id === value ? raw('selected') : ''} ${f.dependsOn ? raw(`data-parent="${o[f.dependsOn]}"`) : ''}>${fmt(o)}</option>`)}</select>`;
      break;
    }
    case 'location': {
      const opts = await locationOptions();
      input = html`<select id="${id}" name="${f.name}"><option value="">Auto (tech's vehicle, else warehouse)</option>
        ${opts.map(o => html`<option value="${o.id}" ${o.id === value ? raw('selected') : ''}>${o.label}</option>`)}</select>`;
      break;
    }
    case 'checkbox':
      return html`<div class="field check"><input type="checkbox" id="${id}" name="${f.name}" ${value ? raw('checked') : ''}><label for="${id}">${f.label}</label></div>`;
    case 'secret': {
      const isSet = record?.[`${f.name}__set`];
      input = html`<div class="secret-row"><input type="password" id="${id}" name="${f.name}" autocomplete="new-password"
          placeholder="${isSet ? 'Saved — leave blank to keep' : ''}">
        <button type="button" class="btn sm" data-toggle-pw="${id}">👁</button></div>
        ${isSet ? html`<label class="help"><input type="checkbox" name="${f.name}__clear"> Remove saved value</label>` : ''}`;
      break;
    }
    case 'money': input = html`<input type="number" step="0.01" id="${id}" name="${f.name}" value="${value ?? ''}" ${f.required ? raw('required') : ''}>`; break;
    case 'number': input = html`<input type="number" step="any" id="${id}" name="${f.name}" value="${value ?? ''}" ${f.required ? raw('required') : ''}>`; break;
    case 'date': input = html`<input type="date" id="${id}" name="${f.name}" value="${value ?? ''}" ${f.required ? raw('required') : ''}>`; break;
    case 'datetime': input = html`<input type="datetime-local" id="${id}" name="${f.name}" value="${value ?? ''}">`; break;
    case 'color': input = html`<input type="color" id="${id}" name="${f.name}" value="${value || '#2563eb'}">`; break;
    default: input = html`<input type="${f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : 'text'}" id="${id}" name="${f.name}" value="${value ?? ''}" ${f.required ? raw('required') : ''}>`;
  }
  return html`<div class="field ${full}">${label}${input}${help}</div>`;
}

export function readForm(form, fields) {
  const out = {};
  for (const f of fields) {
    if (f.readonly) continue;
    const el = form.elements[f.name];
    if (!el) continue;
    if (f.type === 'checkbox') out[f.name] = el.checked ? 1 : 0;
    else if (f.type === 'secret') {
      if (el.value) out[f.name] = el.value;
      if (form.elements[`${f.name}__clear`]?.checked) out[`${f.name}__clear`] = true;
    } else out[f.name] = el.value === '' ? null : el.value;
  }
  return out;
}

/**
 * Open a create/edit form for any resource defined in schema.js.
 * opts: { record, defaults, hide: [fieldNames], title, onSaved(row), allowDelete }
 */
export async function openForm(resource, opts = {}) {
  const def = RESOURCES[resource];
  const record = opts.record || null;
  const isEdit = !!record?.id;
  const hide = new Set(opts.hide || []);
  const fields = def.fields.filter(f => !f.hidden && !hide.has(f.name) && !(f.readonly && !isEdit));
  const values = {};
  for (const f of def.fields) {
    values[f.name] = isEdit ? record[f.name] : (opts.defaults?.[f.name] ?? fieldDefault(f) ?? null);
  }
  let parts;
  try { parts = await Promise.all(fields.map(f => fieldHtml(f, values[f.name], record))); }
  catch (e) { toast(e.message, 'error'); return; }
  const canDelete = isEdit && opts.allowDelete !== false;
  const { el, close } = openModal({
    title: opts.title || `${isEdit ? 'Edit' : 'New'} ${def.singular.toLowerCase()}`,
    body: html`<div class="err-box hidden" data-err></div><form class="form-grid" data-form novalidate>${parts}</form>`,
    foot: html`${canDelete ? html`<button class="btn danger left" data-del>Delete</button>` : ''}
      <button class="btn" data-close>Cancel</button><button class="btn primary" data-save>${isEdit ? 'Save changes' : 'Create'}</button>`,
  });
  const form = el.querySelector('[data-form]');
  const err = el.querySelector('[data-err]');
  el.querySelectorAll('[data-toggle-pw]').forEach(b => b.addEventListener('click', () => {
    const i = el.querySelector('#' + b.dataset.togglePw); i.type = i.type === 'password' ? 'text' : 'password';
  }));
  // Dependent dropdowns (e.g. Site only lists the chosen customer's locations).
  for (const f of fields.filter(x => x.dependsOn && form.elements[x.name])) {
    const sel = form.elements[f.name];
    const parentEl = form.elements[f.dependsOn];
    const parentVal = () => String(parentEl ? parentEl.value : values[f.dependsOn] ?? '');
    const sync = () => {
      const pv = parentVal();
      let visible = 0;
      [...sel.options].forEach(o => { if (!o.value) return; const show = o.dataset.parent === pv; o.hidden = !show; o.disabled = !show; if (show) visible++; });
      if (sel.selectedOptions[0]?.disabled) sel.value = '';
      sel.closest('.field').classList.toggle('hidden', !visible);
    };
    parentEl?.addEventListener('change', sync);
    sync();
  }
  opts.onMount?.(el, form);
  return new Promise(resolve => {
    const save = async () => {
      const data = readForm(form, fields);
      // Include hidden defaults (e.g. customer_id when opened from a customer page).
      for (const n of hide) if (!isEdit && opts.defaults && n in opts.defaults) data[n] = opts.defaults[n];
      const missing = fields.find(f => f.required && !f.readonly && f.type !== 'secret' && (data[f.name] == null || data[f.name] === ''));
      if (missing) { err.textContent = `${missing.label} is required`; err.classList.remove('hidden'); form.elements[missing.name]?.focus(); return; }
      const btn = el.querySelector('[data-save]');
      btn.disabled = true;
      try {
        const send = d => isEdit ? R.update(resource, record.id, d) : R.create(resource, d);
        const row = await send(data).catch(async e => {
          if (e.code !== 'conflict' || !e.canOverride) throw e;
          if (!(await confirmDialog(e.message, { okLabel: 'Book anyway', danger: true }))) throw e;
          return send({ ...data, allow_conflict: true });
        });
        invalidateOptions(resource);
        close();
        toast(`${def.singular} ${isEdit ? 'saved' : 'created'}`);
        opts.onSaved?.(row);
        resolve(row);
      } catch (e) {
        err.textContent = e.message; err.classList.remove('hidden'); btn.disabled = false;
      }
    };
    el.querySelector('[data-save]').addEventListener('click', save);
    form.addEventListener('submit', e => { e.preventDefault(); save(); });
    form.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); save(); } });
    el.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!(await confirmDialog(`Delete this ${def.singular.toLowerCase()}? This cannot be undone.`, { okLabel: 'Delete', danger: true }))) return;
      try {
        await R.del(resource, record.id);
        invalidateOptions(resource);
        close();
        toast(`${def.singular} deleted`);
        opts.onDeleted?.();
        resolve(null);
      } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); }
    });
  });
}

// Simple ad-hoc form (not tied to a resource).
export function promptForm({ title, fields, submitLabel = 'Save', onSubmit, intro, size = 'sm' }) {
  const body = html`${intro || ''}<div class="err-box hidden" data-err></div><form class="stack" data-form style="gap:12px">${fields.map(f => {
    const id = `p_${f.name}`;
    if (f.type === 'select') return html`<div class="field"><label for="${id}">${f.label}</label><select id="${id}" name="${f.name}">${f.options.map(o => html`<option value="${o.value}" ${String(o.value) === String(f.value) ? raw('selected') : ''}>${o.label}</option>`)}</select>${f.help ? html`<span class="help">${f.help}</span>` : ''}</div>`;
    if (f.type === 'checkbox') return html`<label class="row"><input type="checkbox" name="${f.name}" ${f.value ? raw('checked') : ''}> ${f.label}</label>`;
    if (f.type === 'textarea') return html`<div class="field"><label for="${id}">${f.label}</label><textarea id="${id}" name="${f.name}">${f.value ?? ''}</textarea></div>`;
    return html`<div class="field"><label for="${id}">${f.label}</label><input id="${id}" name="${f.name}" type="${f.type || 'text'}" ${f.step ? raw(`step="${f.step}"`) : ''} value="${f.value ?? ''}" ${f.required ? raw('required') : ''} autocomplete="${f.autocomplete || 'off'}">${f.help ? html`<span class="help">${f.help}</span>` : ''}</div>`;
  })}</form>`;
  const { el, close } = openModal({ title, size, body, foot: html`<button class="btn" data-close>Cancel</button><button class="btn primary" data-save>${submitLabel}</button>` });
  const form = el.querySelector('[data-form]');
  const err = el.querySelector('[data-err]');
  const go = async () => {
    const data = {};
    for (const f of fields) data[f.name] = f.type === 'checkbox' ? form.elements[f.name].checked : form.elements[f.name].value;
    const btn = el.querySelector('[data-save]');
    btn.disabled = true;
    try { await onSubmit(data); close(); } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); btn.disabled = false; }
  };
  el.querySelector('[data-save]').addEventListener('click', go);
  form.addEventListener('submit', e => { e.preventDefault(); go(); });
  form.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); go(); } });
  return { el, close };
}

/** Save a service-call change; on a double-booking, let managers choose to book anyway. */
export async function saveWithConflictCheck(fn, data) {
  try { return await fn(data); }
  catch (e) {
    if (e.code !== 'conflict') throw e;
    if (!e.canOverride || !(await confirmDialog(e.message, { okLabel: 'Book anyway', danger: true }))) throw e;
    return fn({ ...data, allow_conflict: true });
  }
}

// ---------------------------------------------------------------- signature pad & photos
/** Turns a <canvas> into a finger/mouse signature pad. */
export function signaturePad(canvas) {
  const ctx = canvas.getContext('2d');
  let drawing = false, empty = true, last = null;
  const setup = () => {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, r.width * dpr);
    canvas.height = Math.max(1, r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    Object.assign(ctx, { lineWidth: 2.4, lineCap: 'round', lineJoin: 'round', strokeStyle: '#0f172a' });
    empty = true;
  };
  setup();
  canvas.style.touchAction = 'none';
  const pos = e => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  canvas.addEventListener('pointerdown', e => { drawing = true; last = pos(e); canvas.setPointerCapture?.(e.pointerId); e.preventDefault(); });
  canvas.addEventListener('pointermove', e => {
    if (!drawing) return;
    const p = pos(e);
    ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last = p; empty = false;
  });
  ['pointerup', 'pointercancel'].forEach(t => canvas.addEventListener(t, () => { drawing = false; }));
  return {
    isEmpty: () => empty,
    clear: () => { ctx.clearRect(0, 0, canvas.width, canvas.height); empty = true; },
    // PNG on a white background so it prints and shows in dark mode.
    toDataURL: () => {
      const out = document.createElement('canvas');
      out.width = canvas.width; out.height = canvas.height;
      const o = out.getContext('2d');
      o.fillStyle = '#fff'; o.fillRect(0, 0, out.width, out.height); o.drawImage(canvas, 0, 0);
      return out.toDataURL('image/png');
    },
  };
}

/** Shrink a photo in the browser before upload (phones take 4000px+ pictures). */
export function resizeImage(file, max = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Could not read ${file.name}`)); };
    img.src = url;
  });
}

export function pickPhotos({ camera = true, multiple = true } = {}) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*'; input.multiple = multiple;
    if (camera) input.capture = 'environment';
    input.addEventListener('change', () => resolve([...input.files]));
    input.click();
  });
}

export function loading(view) { mount(view, html`<div class="empty">Loading…</div>`); }
export function errorView(view, e) { mount(view, html`<div class="card"><div class="empty">⚠️ ${e.message}</div></div>`); }

// Reveal-secret delegate, installed once by app.js
export function installGlobalHandlers() {
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-reveal]');
    if (b) {
      e.preventDefault();
      const out = b.parentElement.querySelector('[data-secret-out]');
      if (b.dataset.shown) { out.textContent = '••••••••'; b.textContent = 'Show'; delete b.dataset.shown; b.nextElementSibling?.remove(); return; }
      try {
        const { value } = await api('POST', `/api/r/${b.dataset.reveal}/${b.dataset.id}/reveal`, { field: b.dataset.field });
        out.textContent = value;
        b.textContent = 'Hide';
        b.dataset.shown = '1';
        const copy = document.createElement('button');
        copy.className = 'btn sm ghost'; copy.textContent = 'Copy';
        copy.onclick = () => navigator.clipboard?.writeText(value).then(() => toast('Copied'));
        b.after(copy);
        setTimeout(() => { if (b.dataset.shown) b.click(); }, 30000);
      } catch (err) { toast(err.message, 'error'); }
      return;
    }
    const tr = e.target.closest('tr[data-href]');
    if (tr && !e.target.closest('a, button, input, select')) location.hash = tr.dataset.href;
  });
}
