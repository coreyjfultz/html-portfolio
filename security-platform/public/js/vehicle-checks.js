// Vehicle checklist the technician does on their truck (shared by server and phone screens).
// Kinds: 'ok' = OK / Problem, 'tires' = four tire pressures, 'value' = a reading.
export const VEHICLE_CHECK = [
  { id: 'fluids', title: 'Under the hood', items: [
    { id: 'oil', text: 'Engine oil level (dipstick between the marks)' },
    { id: 'coolant', text: 'Coolant and washer fluid topped up' },
    { id: 'leaks', text: 'No leaks under the truck' },
  ] },
  { id: 'tires', title: 'Tires', items: [
    { id: 'tire_psi', text: 'Tire pressures', kind: 'tires' },
    { id: 'tread', text: 'Tread depth and sidewalls OK (no bulges, cuts or bald spots)' },
  ] },
  { id: 'lights', title: 'Lights', items: [
    { id: 'headlights', text: 'Headlights (low and high beam)' },
    { id: 'brake_lights', text: 'Brake lights' },
    { id: 'turn_signals', text: 'Turn signals and hazards' },
    { id: 'reverse_lights', text: 'Reverse lights / backup alarm' },
    { id: 'work_lights', text: 'Amber / work lights' },
  ] },
  { id: 'body', title: 'Walk-around', items: [
    { id: 'damage', text: 'No new dents, scratches or damage', photosOnProblem: true },
    { id: 'glass', text: 'Windshield, windows and mirrors (no cracks)' },
    { id: 'wipers', text: 'Wipers work' },
    { id: 'dash_lights', text: 'No warning lights on the dashboard' },
    { id: 'rack', text: 'Ladder rack and ladders secured' },
    { id: 'safety', text: 'Fire extinguisher and first-aid kit in the truck' },
  ] },
  { id: 'clean', title: 'Clean truck', items: [
    { id: 'interior', text: 'Cab and cargo area clean and organized' },
    { id: 'exterior', text: 'Outside clean (washed when dirty)' },
  ] },
];
export const VEHICLE_ITEMS = VEHICLE_CHECK.flatMap(s => s.items.map(i => ({ ...i, section: s.title })));
export const TIRES = { fl: 'Front left', fr: 'Front right', rl: 'Rear left', rr: 'Rear right' };
