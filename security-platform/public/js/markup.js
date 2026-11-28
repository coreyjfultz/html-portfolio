// Photo markup: draw on a photo (circles, arrows, "camera here") and add text labels before
// saving it. Used for site-survey photos when putting a quote together.
import { html, mount, $, $$, openModal } from './ui.js';

const COLORS = [['#ef4444', 'Red'], ['#facc15', 'Yellow'], ['#22c55e', 'Green'], ['#3b82f6', 'Blue'], ['#ffffff', 'White']];

/**
 * Opens the editor. `src` is a data URL or image URL. Resolves with
 * { photo (JPEG data URL, or null if unchanged), title, note } — or null if cancelled.
 */
export function markupPhoto(src, { title = '', note = '', heading = 'Mark up the photo', saveLabel = 'Save' } = {}) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    const { el, close } = openModal({
      title: heading, size: 'lg',
      body: html`<div class="markup">
        <div class="markup-tools" role="toolbar" aria-label="Drawing tools">
          <div class="seg" data-mode><button data-v="pen" class="on" aria-pressed="true">✏️ Draw</button><button data-v="arrow" aria-pressed="false">➜ Arrow</button><button data-v="text" aria-pressed="false">Aa Label</button></div>
          <div class="row" data-colors>${COLORS.map(([c, n], i) => html`<button class="swatch ${i === 0 ? 'on' : ''}" data-c="${c}" style="background:${c}" aria-label="${n}" title="${n}"></button>`)}</div>
          <button class="btn sm" data-undo>↶ Undo</button><button class="btn sm ghost" data-clear>Clear marks</button>
        </div>
        <div class="markup-stage"><canvas data-canvas aria-label="Photo — draw on it to mark where things go"></canvas></div>
        <div class="small muted" data-hint>Draw with your finger or mouse. Use Arrow to point at a spot, Label to add text (e.g. "Camera 3", "Keypad here").</div>
        <div class="field" style="margin-top:10px"><label for="mk_t">Title</label><input id="mk_t" type="text" maxlength="120" value="${title}" placeholder="e.g. Front entry — camera 1"></div>
        <div class="field" style="margin-top:8px"><label for="mk_n">Notes</label><textarea id="mk_n" rows="3" maxlength="2000" placeholder="Mount height, cable path, power nearby, ladder needed…">${note}</textarea></div>
      </div>`,
      foot: html`<button class="btn" data-cancel>Cancel</button><button class="btn primary" data-save>${saveLabel}</button>`,
    });
    const canvas = $('[data-canvas]', el);
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.crossOrigin = 'anonymous';
    let mode = 'pen', color = COLORS[0][0];
    const marks = []; // { type, color, width, points:[[x,y]...], text, at:[x,y] }
    let cur = null;
    const draw = () => {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      for (const m of [...marks, ...(cur ? [cur] : [])]) {
        ctx.strokeStyle = m.color; ctx.fillStyle = m.color; ctx.lineWidth = m.width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        if (m.type === 'pen' && m.points.length) {
          ctx.beginPath(); ctx.moveTo(...m.points[0]); for (const p of m.points.slice(1)) ctx.lineTo(...p); ctx.stroke();
        } else if (m.type === 'arrow' && m.points.length > 1) {
          const [a, b] = [m.points[0], m.points[m.points.length - 1]];
          ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke();
          const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), h = m.width * 4;
          ctx.beginPath(); ctx.moveTo(...b);
          ctx.lineTo(b[0] - h * Math.cos(ang - 0.45), b[1] - h * Math.sin(ang - 0.45));
          ctx.lineTo(b[0] - h * Math.cos(ang + 0.45), b[1] - h * Math.sin(ang + 0.45)); ctx.closePath(); ctx.fill();
        } else if (m.type === 'text') {
          const size = Math.round(m.width * 5);
          ctx.font = `bold ${size}px system-ui, sans-serif`;
          const w = ctx.measureText(m.text).width;
          ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillRect(m.at[0] - 6, m.at[1] - size, w + 12, size * 1.35);
          ctx.fillStyle = m.color; ctx.fillText(m.text, m.at[0], m.at[1] + size * 0.15);
        }
      }
    };
    img.onload = () => {
      const s = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      canvas.width = Math.round(img.naturalWidth * s); canvas.height = Math.round(img.naturalHeight * s);
      draw();
    };
    img.src = src;
    const pos = e => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * canvas.width / r.width, (e.clientY - r.top) * canvas.height / r.height]; };
    const lineW = () => Math.max(3, Math.round(canvas.width / 220));
    canvas.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (mode === 'text') {
        const at = pos(e);
        const text = (window.prompt('Label text (e.g. "Camera 3", "Keypad here")') || '').trim().slice(0, 60);
        if (text) { marks.push({ type: 'text', color, width: lineW(), text, at }); draw(); }
        return;
      }
      canvas.setPointerCapture(e.pointerId);
      cur = { type: mode, color, width: lineW(), points: [pos(e)] };
    });
    canvas.addEventListener('pointermove', e => { if (!cur) return; e.preventDefault(); cur.points.push(pos(e)); draw(); });
    const up = () => { if (cur) { if (cur.points.length > 1 || cur.type === 'pen') marks.push(cur); cur = null; draw(); } };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    $$('[data-mode] button', el).forEach(b => b.addEventListener('click', () => {
      mode = b.dataset.v;
      $$('[data-mode] button', el).forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
    }));
    $$('[data-c]', el).forEach(b => b.addEventListener('click', () => { color = b.dataset.c; $$('[data-c]', el).forEach(x => x.classList.toggle('on', x === b)); }));
    $('[data-undo]', el).addEventListener('click', () => { marks.pop(); draw(); });
    $('[data-clear]', el).addEventListener('click', () => { marks.length = 0; draw(); });
    $('[data-cancel]', el).addEventListener('click', () => { close(); finish(null); });
    $('[data-save]', el).addEventListener('click', () => {
      const changed = marks.length > 0 || src.startsWith('data:');
      const out = { photo: changed ? canvas.toDataURL('image/jpeg', 0.85) : null, title: $('#mk_t', el).value.trim(), note: $('#mk_n', el).value.trim() };
      close(); finish(out);
    });
    // Closing with the ✕ or Escape counts as cancel.
    const obs = new MutationObserver(() => { if (!el.isConnected) { obs.disconnect(); finish(null); } });
    obs.observe(document.body, { childList: true, subtree: true });
  });
}
