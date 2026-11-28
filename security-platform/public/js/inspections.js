// Fire inspection checklists, shared by the server (validation, report document) and the
// phone screens. Items are written in plain language and organised the way the NFPA
// standards group them, as a practical starting point. They are NOT the standards' own
// forms: check them against the editions your AHJ enforces and edit here as needed.
//
// Item kinds: 'pf' = Pass / Fail / N/A (default), 'value' = something to write down (a reading).

export const REPORT_TYPES = {
  fire_alarm: {
    label: 'Fire alarm system', standard: 'NFPA 72', systemTypes: ['fire alarm'], devices: true, frequencies: ['annual', 'semi-annual', 'quarterly'],
    sections: [
      { id: 'panel', title: 'Control panel & power', items: [
        { id: 'panel_normal', text: 'Panel shows normal — no alarms, troubles or supervisory signals on arrival' },
        { id: 'lamp_test', text: 'LED / lamp test and display work' },
        { id: 'primary_power', text: 'Dedicated circuit breaker is locked and labeled' },
        { id: 'battery_date', text: 'Battery install date', kind: 'value', placeholder: 'e.g. 03/2024' },
        { id: 'battery_voltage', text: 'Battery voltage (on standby)', kind: 'value', placeholder: 'e.g. 26.8 V' },
        { id: 'battery_load', text: 'Battery load test / charger test passes' },
        { id: 'ground_fault', text: 'Ground fault and open-circuit supervision report a trouble' },
        { id: 'event_log', text: 'Event history reviewed and cleared' },
      ] },
      { id: 'comm', title: 'Monitoring & communication', items: [
        { id: 'station_alarm', text: 'Alarm signal received by the central station' },
        { id: 'station_trouble', text: 'Trouble signal received by the central station' },
        { id: 'station_supervisory', text: 'Supervisory signal received by the central station' },
        { id: 'dual_path', text: 'Both communication paths (phone / cellular / IP) report' },
        { id: 'station_operator', text: 'Central station operator / confirmation #', kind: 'value' },
      ] },
      { id: 'functions', title: 'Functions & annunciation', items: [
        { id: 'annunciators', text: 'Remote annunciators show the correct zone/point' },
        { id: 'door_release', text: 'Door holders release on alarm' },
        { id: 'elevator_recall', text: 'Elevator recall / shunt trip functions operate' },
        { id: 'hvac_shutdown', text: 'HVAC / damper shutdown operates' },
        { id: 'audibility', text: 'Notification is audible and visible throughout' },
        { id: 'docs_on_site', text: 'Record of completion and as-built drawings on site' },
        { id: 'restored', text: 'System restored to normal and central station told back in service' },
      ] },
    ],
  },
  sprinkler: {
    label: 'Sprinkler system', standard: 'NFPA 25', systemTypes: ['sprinkler'], frequencies: ['annual', 'quarterly', 'monthly'],
    sections: [
      { id: 'valves', title: 'Valves & supervision', items: [
        { id: 'control_open', text: 'Control valves open and sealed, locked or electrically supervised' },
        { id: 'tamper', text: 'Tamper switches report a supervisory signal' },
        { id: 'valve_access', text: 'Valves accessible and identified' },
        { id: 'backflow', text: 'Backflow preventer condition', kind: 'pf' },
      ] },
      { id: 'water', title: 'Water flow & pressure', items: [
        { id: 'static_psi', text: 'System (static) pressure', kind: 'value', placeholder: 'psi' },
        { id: 'main_drain', text: 'Main drain test — static / residual', kind: 'value', placeholder: 'e.g. 80 / 62 psi' },
        { id: 'flow_alarm', text: 'Waterflow alarm (inspector’s test) operates within 90 seconds' },
        { id: 'gauges', text: 'Gauges in good condition (replaced or calibrated within 5 years)' },
      ] },
      { id: 'heads', title: 'Sprinklers & piping', items: [
        { id: 'heads_ok', text: 'Sprinklers free of damage, paint, corrosion and loading' },
        { id: 'clearance', text: '18 in. clearance below sprinkler deflectors' },
        { id: 'spares', text: 'Spare sprinklers and wrench in the cabinet' },
        { id: 'pipe_hangers', text: 'Pipe and hangers in good condition, no leaks' },
        { id: 'fdc', text: 'Fire department connection visible, accessible, caps in place' },
        { id: 'heat', text: 'Areas with wet pipe kept above 40 °F' },
        { id: 'signs', text: 'Hydraulic placard and signs in place' },
      ] },
    ],
  },
  kitchen_hood: {
    label: 'Kitchen suppression (hood)', standard: 'NFPA 96 / NFPA 17A', systemTypes: ['kitchen hood suppression'], frequencies: ['semi-annual'],
    sections: [
      { id: 'agent', title: 'Agent & cylinders', items: [
        { id: 'cyl_pressure', text: 'Agent cylinder pressure / weight correct', },
        { id: 'cyl_date', text: 'Cylinder manufacture / hydro date', kind: 'value' },
        { id: 'cartridge', text: 'Expellant cartridge weighed or replaced', },
      ] },
      { id: 'detection', title: 'Detection & release', items: [
        { id: 'links', text: 'Fusible links replaced (date them)' },
        { id: 'detection_line', text: 'Detection line, pulleys and conduit in good condition' },
        { id: 'manual_pull', text: 'Manual pull station accessible and operates' },
        { id: 'fuel_shutoff', text: 'Gas / electric shut-off to appliances operates' },
        { id: 'alarm_tie', text: 'Building fire alarm is signaled when the system trips' },
        { id: 'makeup_air', text: 'Make-up air shuts down / exhaust fan stays on as designed' },
      ] },
      { id: 'nozzles', title: 'Nozzles & coverage', items: [
        { id: 'nozzle_caps', text: 'Nozzles clean with blow-off caps in place' },
        { id: 'nozzle_aim', text: 'Nozzles aimed correctly for the current appliance layout' },
        { id: 'appliances_moved', text: 'No appliances added or moved outside coverage' },
      ] },
      { id: 'area', title: 'Kitchen', items: [
        { id: 'class_k', text: 'Class K extinguisher within 30 ft of cooking' },
        { id: 'grease', text: 'Hood, filters and duct free of heavy grease build-up (cleaning recommended if not)' },
        { id: 'placard', text: 'Operating instructions posted; inspection tag updated' },
      ] },
    ],
  },
  suppression: {
    label: 'Fire suppression (special hazard)', standard: 'NFPA 2001 / 12 / 17 / 750', devices: true, frequencies: ['semi-annual', 'annual'],
    systemTypes: ['clean agent suppression', 'CO2 suppression', 'dry chemical suppression', 'water mist suppression'],
    sections: [
      { id: 'hazard', title: 'Protected area', items: [
        { id: 'agent_type', text: 'Agent (FM-200, Novec 1230, Inergen, CO2, dry chemical…)', kind: 'value' },
        { id: 'hazard_same', text: 'Room use and hazard unchanged since the system was designed' },
        { id: 'enclosure', text: 'Enclosure integrity — no new openings, penetrations sealed, doors close' },
        { id: 'obstructions', text: 'Nothing blocking nozzles or added in the protected space' },
      ] },
      { id: 'containers', title: 'Agent containers', items: [
        { id: 'container_weight', text: 'Agent weight / pressure within limits (record readings)', kind: 'value', placeholder: 'e.g. 2 × 360 psi @ 70 °F' },
        { id: 'container_mount', text: 'Containers secured; no damage, corrosion or leaks' },
        { id: 'container_hydro', text: 'Cylinder hydro / retest dates current', kind: 'value' },
        { id: 'hoses', text: 'Discharge hoses and check valves in good condition' },
      ] },
      { id: 'control', title: 'Detection & releasing panel', items: [
        { id: 'panel_normal', text: 'Releasing panel normal; batteries tested' },
        { id: 'detectors', text: 'Detectors tested (see device list); cross-zoning works' },
        { id: 'pre_discharge', text: 'Pre-discharge alarm and time delay operate' },
        { id: 'abort', text: 'Abort switch operates (and resets the delay as designed)' },
        { id: 'manual_release', text: 'Manual release station operates' },
        { id: 'actuator', text: 'Releasing circuit tested with the actuator removed / isolated (no discharge)' },
      ] },
      { id: 'interlocks', title: 'Shutdowns & safety', items: [
        { id: 'hvac_damper', text: 'HVAC shuts down and dampers close on release' },
        { id: 'power_shutdown', text: 'Equipment power shutdown operates, if provided' },
        { id: 'building_alarm', text: 'Building fire alarm / central station receives alarm and supervisory signals' },
        { id: 'signs', text: 'Warning and instruction signs at entrances and release stations' },
        { id: 'lockout', text: 'Lock-out valve / maintenance switch in place (required for CO2)' },
        { id: 'restored', text: 'Actuators reinstalled, system armed and back in service; monitoring notified' },
      ] },
    ],
  },
  extinguishers: {
    label: 'Fire extinguishers', standard: 'NFPA 10', systemTypes: [], units: true, frequencies: ['annual'],
    sections: [
      { id: 'general', title: 'Placement', items: [
        { id: 'visible', text: 'Extinguishers visible, accessible and unobstructed' },
        { id: 'height', text: 'Mounted at the correct height (top no higher than 5 ft; 3.5 ft if over 40 lb)' },
        { id: 'signage', text: 'Location signs where extinguishers are not in plain view' },
        { id: 'coverage', text: 'Travel distance / coverage adequate for the hazard' },
        { id: 'cabinets', text: 'Cabinets in good condition, glass intact, doors open' },
        { id: 'kitchen_k', text: 'Class K unit present in commercial kitchens' },
      ] },
    ],
    // Per extinguisher, in the walk-through:
    unitChecks: ['Pressure gauge in the green', 'Pin and tamper seal intact', 'Hose / nozzle clear', 'No damage, rust or leaks', 'Label readable', 'Tag updated'],
  },
  emergency_lighting: {
    label: 'Emergency lighting & exit signs', standard: 'NFPA 101', systemTypes: ['emergency lighting'], devices: true, frequencies: ['annual', 'monthly'],
    sections: [
      { id: 'tests', title: 'Tests', items: [
        { id: 'monthly_30s', text: '30-second functional test of every unit' },
        { id: 'annual_90m', text: '90-minute battery duration test (annual)' },
        { id: 'exit_lit', text: 'Exit signs illuminated and legible' },
        { id: 'heads_aimed', text: 'Lamp heads aimed at the path of egress' },
        { id: 'log', text: 'Test log on site and up to date' },
      ] },
    ],
  },
  other: {
    label: 'Other fire system', standard: '', systemTypes: ['fire pump', 'other'], custom: true, frequencies: ['annual', 'semi-annual', 'quarterly', 'monthly'],
    sections: [
      { id: 'general', title: 'General', items: [
        { id: 'normal', text: 'System normal on arrival' },
        { id: 'restored', text: 'System restored to normal on departure; monitoring notified' },
      ] },
    ],
  },
};

export const DEVICE_TYPES = ['Smoke detector', 'Heat detector', 'Duct detector', 'Pull station', 'Horn/strobe', 'Horn', 'Strobe', 'Speaker', 'Waterflow switch', 'Tamper switch', 'CO detector', 'Beam detector', 'Relay / module', 'Emergency light', 'Exit sign', 'Other'];
export const UNIT_RESULTS = { pass: 'Pass', fail: 'Fail', replaced: 'Replaced', removed: 'Removed', missing: 'Missing' };
export const UNIT_SERVICES = { annual: 'Annual', '6-year': '6-year maint.', hydro: 'Hydro test', recharge: 'Recharged' };
export const RESULTS = { pass: 'Pass', deficiencies: 'Deficiencies found', fail: 'Fail — impairment' };

/** Which report fits a fire system record. */
export function reportTypeForSystem(systemType) {
  return Object.entries(REPORT_TYPES).find(([, t]) => t.systemTypes.includes(systemType))?.[0] || 'other';
}

/** All checklist items for a report (template + any custom items added on the report). */
export function allItems(type, custom = []) {
  const t = REPORT_TYPES[type] || REPORT_TYPES.other;
  return [...t.sections.flatMap(s => s.items.map(i => ({ ...i, section: s.title }))), ...custom.map(c => ({ id: c.id, text: c.text, kind: c.kind || 'pf', section: 'Additional items' }))];
}

/** Everything that failed, in plain words — the deficiency list. */
export function deficiencies(r) {
  const out = [];
  for (const i of allItems(r.report_type, r.custom_items)) {
    const a = r.checklist?.[i.id];
    if (i.kind !== 'value' && a?.r === 'fail') out.push({ what: i.text, where: i.section, note: a.note || '' });
  }
  for (const d of r.devices || []) if (d.result === 'fail') out.push({ what: `${d.type}${d.address ? ` (${d.address})` : ''} failed`, where: d.location || '', note: d.note || '' });
  for (const u of r.units || []) if (['fail', 'missing'].includes(u.result)) out.push({ what: `Extinguisher ${u.label || ''} — ${u.result === 'missing' ? 'missing' : 'failed'}`, where: u.location || '', note: u.note || '' });
  return out;
}

/** What still needs an answer before the report can be completed. */
export function unanswered(r) {
  const missing = [];
  for (const i of allItems(r.report_type, r.custom_items)) {
    const a = r.checklist?.[i.id];
    if (i.kind === 'value' ? !(a?.v || a?.r === 'na') : !a?.r) missing.push(i.text);
  }
  (r.devices || []).forEach((d, n) => { if (!d.result) missing.push(`Device ${n + 1}${d.location ? ` (${d.location})` : ''}`); });
  (r.units || []).forEach(u => { if (!u.result) missing.push(`Extinguisher ${u.label || ''}`); });
  return missing;
}
