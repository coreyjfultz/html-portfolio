// iCalendar (.ics) for Outlook / Google / Apple: subscription feeds and email invites.

/** Convert a wall-clock time ("2031-01-05T09:00") in an IANA time zone to a UTC Date. */
export function zonedToUtc(local, tz) {
  const [d, t = '00:00'] = local.split('T');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  const asUtc = Date.UTC(y, mo - 1, da, h, mi);
  const offsetAt = ms => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(ms)).filter(x => x.type !== 'literal').map(x => [x.type, Number(x.value)]));
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ms;
  };
  let ms = asUtc - offsetAt(asUtc);
  ms = asUtc - offsetAt(ms); // second pass settles DST edges
  return new Date(ms);
}

const stamp = date => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const esc = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// Lines longer than 75 bytes are folded (RFC 5545).
function fold(line) {
  const out = [];
  let cur = '';
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > (out.length ? 74 : 75)) { out.push(cur); cur = ''; }
    cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/**
 * @param {object} call service call row with customer_id_label, technician_id_label, customer_address, customer_phone
 */
export function callToEvent(call, { tz, baseUrl = '', withTech = false, organizer, attendee }) {
  const start = zonedToUtc(call.scheduled_start, tz);
  const end = new Date(start.getTime() + Math.max(0.25, Number(call.duration_hours) || 1) * 3600e3);
  const summary = `${withTech && call.technician_id_label ? `[${call.technician_id_label}] ` : ''}${call.customer_id_label} — ${call.title}`;
  const desc = [
    `Service call SC-${call.number} (${call.call_type}${call.system_type ? ', ' + call.system_type : ''})`,
    call.priority && call.priority !== 'normal' ? `Priority: ${call.priority}` : '',
    call.customer_phone ? `Customer phone: ${call.customer_phone}` : '',
    call.site_id_label ? `Site: ${call.site_id_label}` : '',
    call.description ? `\n${call.description}` : '',
    baseUrl ? `\nOpen in SecureOps: ${baseUrl}/#/calls/${call.id}` : '',
  ].filter(Boolean).join('\n');
  const lines = [
    'BEGIN:VEVENT',
    `UID:sc-${call.id}@secureops`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SEQUENCE:${call.cal_sequence || 0}`,
    `SUMMARY:${esc(summary)}`,
    call.customer_address ? `LOCATION:${esc(call.customer_address.replace(/^, |, $/g, ''))}` : null,
    `DESCRIPTION:${esc(desc)}`,
    `STATUS:${call.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`,
    baseUrl ? `URL:${baseUrl}/#/calls/${call.id}` : null,
    organizer ? `ORGANIZER;CN=${esc(organizer.name)}:mailto:${organizer.email}` : null,
    attendee ? `ATTENDEE;CN=${esc(attendee.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE:mailto:${attendee.email}` : null,
    'END:VEVENT',
  ].filter(Boolean);
  return lines;
}

export function buildCalendar(events, { name, method } = {}) {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SecureOps//Field Service//EN', 'CALSCALE:GREGORIAN',
    method ? `METHOD:${method}` : null,
    name ? `X-WR-CALNAME:${esc(name)}` : null,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H',
    ...events.flat(),
    'END:VCALENDAR',
  ].filter(Boolean);
  return lines.map(fold).join('\r\n') + '\r\n';
}
