// Click-to-call: any <a href="tel:…" data-dial data-customer="…"> calls through the company
// number when the phone system is set up (your phone rings, then the customer — they see the
// business number, not yours). Otherwise it's a normal phone link.
import { POST, PUT } from './api.js';
import { toast, promptForm } from './ui.js';

let voiceOn = null;
export const setVoiceOn = v => { voiceOn = v; };

async function dial(a) {
  const body = { phone: a.getAttribute('href').replace(/^tel:/, ''), customer_id: a.dataset.customer || undefined, service_call_id: a.dataset.call || undefined };
  try {
    const r = await POST('/api/phone/call', body);
    toast(`Calling your phone (${r.ringing}) — answer to be connected`);
  } catch (e) {
    if (e.code === 'need_phone') {
      promptForm({
        title: 'Your mobile number', intro: 'The app rings this phone first, then connects you to the customer. Customers see the company number.',
        fields: [{ name: 'phone', label: 'Mobile number', type: 'tel', required: true }], submitLabel: 'Save & call',
        onSubmit: async d => { await PUT('/api/phone/my-number', d); dial(a); },
      });
    } else if (e.code === 'voice_off') { voiceOn = false; location.href = a.getAttribute('href'); }
    else toast(e.message, 'error');
  }
}

export function installDialer() {
  document.addEventListener('click', e => {
    const a = e.target.closest?.('a[data-dial]');
    if (!a || voiceOn === false || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    dial(a);
  });
}
