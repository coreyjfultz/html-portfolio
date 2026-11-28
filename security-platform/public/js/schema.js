// Shared data model. Imported by BOTH the server (to build tables and validate
// writes) and the browser (to build forms and tables). One source of truth.
//
// Field types: text, email, tel, textarea, number, money, date, datetime,
// select, ref, checkbox, secret (encrypted at rest), color, location.

// ---------------------------------------------------------------- roles & permissions
// Every check in the app asks "is this person's role in permission group X?" (G.manage,
// G.billing…). Built-in roles have fixed groups; custom roles (Settings → Roles) pick their own.
// applyRoles() rebuilds the group lists IN PLACE, so every screen and route that holds a
// reference to G.something sees custom roles too.
export const ROLES = ['owner', 'admin', 'sales', 'accounting', 'technician', 'hr'];
export const BUILTIN_ROLES = ['owner', 'admin', 'sales', 'accounting', 'technician', 'hr'];
export const ROLE_INFO = {
  owner: { label: 'Owner / Global admin', desc: 'Everything, including managing other admins, backups and integrations' },
  admin: { label: 'Administrator', desc: 'Runs the business day to day: customers, scheduling, billing, inventory, team (but not owner accounts or backups)' },
  sales: { label: 'Sales', desc: 'Leads, pipeline, proposals and agreements, site surveys and estimates; no invoices or financial reports' },
  accounting: { label: 'Accounting', desc: 'Invoices, payments, expenses, receiving, reports and QuickBooks; pay stubs & benefits; read-only scheduling' },
  technician: { label: 'Technician', desc: 'Their jobs, schedule, customer systems & passwords, photos, signatures, truck inventory; no billing' },
  hr: { label: 'HR', desc: 'Time off for everyone, balances, holidays, users & supervisors, pay stubs & benefits, chat records; no customers, jobs or billing' },
};

// What a custom role can be given. `key` is the permission group.
export const PERMISSIONS = [
  { key: 'staff', label: 'Office basics', desc: 'Pipeline, alerts, exports, support contacts, address & drive-time lookups' },
  { key: 'customers', label: 'Edit customers', desc: 'Add and change customers, sites and contacts; customer portal invites' },
  { key: 'sales', label: 'Sales', desc: 'Leads, proposals and agreements, site surveys and estimates' },
  { key: 'billing', label: 'Billing & accounting', desc: 'Invoices, payments, expenses, receiving, reports, QuickBooks, truck stock admin' },
  { key: 'manage', label: 'Operations admin', desc: 'Everything an Administrator can do: scheduling for everyone, settings, live map, ratings, overrides' },
  { key: 'hr', label: 'Time off for everyone', desc: 'Approve or deny anyone’s time off, set balances and company holidays' },
  { key: 'people', label: 'Users & supervisors', desc: 'Add and edit users, job titles and who reports to whom (not owners or administrators)' },
  { key: 'payAdmin', label: 'Pay & benefits admin', desc: 'Post pay stubs and tax forms, manage benefit plans (when the add-on is on)' },
  { key: 'records', label: 'Chat records', desc: 'Review any conversation after an incident (logged; owners are alerted)' },
];
// Which customers a role can see: every customer, only those on their own schedule (field
// technicians: also My Day, truck stock and vehicle checks), or none at all.
export const CUSTOMER_ACCESS = { all: 'All customers and jobs', schedule: 'Only customers on their own schedule (field technician)', none: 'No customers or jobs' };

const BUILTIN_GROUPS = {
  owner: ['staff', 'customers', 'sales', 'billing', 'manage', 'hr', 'people', 'payAdmin', 'records', 'owner'],
  admin: ['staff', 'customers', 'sales', 'billing', 'manage', 'hr', 'people', 'records'],
  sales: ['staff', 'customers', 'sales'],
  accounting: ['staff', 'customers', 'billing', 'payAdmin'],
  technician: [],
  hr: ['hr', 'people', 'payAdmin', 'records'],
};
const BUILTIN_ACCESS = { owner: 'all', admin: 'all', sales: 'all', accounting: 'all', technician: 'schedule', hr: 'none' };

// Permission groups used throughout the server and the screens.
export const G = {
  all: ROLES, owner: [], staff: [], customers: [], sales: [], billing: [], manage: [],
  hr: [], people: [], payAdmin: [], records: [],
  salesOrBilling: [], // sales or billing
  settings: [],       // can open Settings (manage, hr or people)
};
const ACCESS = {};
let CUSTOM = [];

/** Rebuild the permission groups from the built-in roles plus the custom roles. */
export function applyRoles(custom = []) {
  CUSTOM = custom.filter(r => r && r.key && !BUILTIN_ROLES.includes(r.key));
  ROLES.splice(0, ROLES.length, ...BUILTIN_ROLES, ...CUSTOM.map(r => r.key));
  for (const k of Object.keys(ROLE_INFO)) if (!BUILTIN_ROLES.includes(k)) delete ROLE_INFO[k];
  for (const k of Object.keys(ACCESS)) delete ACCESS[k];
  const groupsOf = {};
  for (const r of BUILTIN_ROLES) { groupsOf[r] = BUILTIN_GROUPS[r]; ACCESS[r] = BUILTIN_ACCESS[r]; }
  for (const r of CUSTOM) {
    const perms = (r.permissions || []).filter(p => PERMISSIONS.some(x => x.key === p));
    groupsOf[r.key] = perms;
    ACCESS[r.key] = CUSTOMER_ACCESS[r.customer_access] ? r.customer_access : 'none';
    ROLE_INFO[r.key] = { label: r.name, desc: r.description || 'Custom role', custom: true };
  }
  for (const g of Object.keys(G)) {
    if (g === 'all') continue;
    const members = ROLES.filter(role => {
      const p = groupsOf[role] || [];
      if (g === 'salesOrBilling') return p.includes('sales') || p.includes('billing');
      if (g === 'settings') return p.includes('manage') || p.includes('hr') || p.includes('people');
      return p.includes(g);
    });
    G[g].splice(0, G[g].length, ...members);
  }
}
applyRoles();

export const customRoles = () => CUSTOM;
/** 'all' | 'schedule' | 'none' — which customers this role can see. */
export const customerAccess = role => ACCESS[role] || 'none';
/** Field technicians (built-in or custom): scoped to their schedule; My Day, truck stock, vehicle checks. */
export const isFieldRole = role => customerAccess(role) === 'schedule';
/** True if a user with this role can be given `role2` by someone who only has 'people' rights. */
export const isPrivilegedRole = role => role === 'owner' || G.manage.includes(role);

// Customer lifecycle stages (pipeline), in order.
export const STAGES = ['lead', 'site survey', 'bid', 'accepted', 'installation', 'active', 'lost'];
export const STAGE_INFO = {
  lead: { label: 'Lead', desc: 'New inquiry' },
  'site survey': { label: 'Site survey', desc: 'Visit scheduled or done' },
  bid: { label: 'Bid sent', desc: 'Proposal out for signature' },
  accepted: { label: 'Accepted', desc: 'Signed, ready to schedule' },
  installation: { label: 'Installation', desc: 'Install scheduled / in progress' },
  active: { label: 'Active customer', desc: 'Installed, monitored / serviced' },
  lost: { label: 'Lost', desc: 'Declined or went elsewhere' },
};
export const PAYMENT_METHODS = { cash: 'Cash', check: 'Check', card: 'Credit card', ach: 'Bank ACH', other: 'Other' };

const ALL = G.all;
const OFFICE = G.billing;

const today = () => new Date().toISOString().slice(0, 10);

const customerRef = { name: 'customer_id', label: 'Customer', type: 'ref', ref: 'customers', required: true, list: true, onDelete: 'cascade' };

export const RESOURCES = {
  customers: {
    label: 'Customers', singular: 'Customer', labelExpr: 'name',
    read: ALL, write: G.customers, order: 'name COLLATE NOCASE',
    search: ['name', 'contact_name', 'email', 'phone', 'alt_phone', 'billing_address', 'service_address', 'account_number', 'city'],
    fields: [
      { name: 'type', label: 'Type', type: 'select', options: ['residential', 'commercial'], required: true, default: 'residential', list: true },
      { name: 'name', label: 'Name / Business name', type: 'text', required: true, list: true },
      { name: 'stage', label: 'Stage', type: 'select', options: STAGES, default: 'lead', list: true },
      { name: 'parent_id', label: 'Parent account / owner', type: 'ref', ref: 'customers', onDelete: 'set null', help: 'Link businesses or properties owned by the same person or company' },
      { name: 'contact_name', label: 'Primary contact', type: 'text', help: 'For commercial accounts' },
      { name: 'email', label: 'Email', type: 'email', list: true },
      { name: 'phone', label: 'Phone', type: 'tel', list: true },
      { name: 'alt_phone', label: 'Alt. phone', type: 'tel' },
      { name: 'account_number', label: 'Monitoring account #', type: 'text' },
      { name: 'status', label: 'Status', type: 'select', options: ['active', 'inactive', 'prospect'], default: 'active', list: true },
      { name: 'billing_address', label: 'Billing address', type: 'text', full: true },
      { name: 'city', label: 'City', type: 'text', list: true },
      { name: 'state', label: 'State', type: 'text' },
      { name: 'zip', label: 'ZIP', type: 'text' },
      { name: 'lat', label: 'Latitude', type: 'number', hidden: true },
      { name: 'lng', label: 'Longitude', type: 'number', hidden: true },
      { name: 'geocode_failed', label: 'Address not found on map', type: 'checkbox', hidden: true },
      { name: 'service_address', label: 'Service address (if different)', type: 'text', full: true },
      { name: 'service_city', label: 'Service city', type: 'text' },
      { name: 'service_state', label: 'Service state', type: 'text' },
      { name: 'service_zip', label: 'Service ZIP', type: 'text' },
      { name: 'preferred_payment', label: 'Preferred payment', type: 'select', options: ['check', 'card', 'ach', 'cash'], optionLabels: PAYMENT_METHODS, default: 'check' },
      { name: 'notify_email', label: 'Email appointment updates', type: 'checkbox', default: 1 },
      { name: 'notify_sms', label: 'Text appointment updates', type: 'checkbox', default: 1 },
      { name: 'stripe_customer_id', label: 'Stripe customer', type: 'text', readonly: true, hidden: true },
      { name: 'portal_invite', label: 'Invite to the customer portal (emails a sign-in link)', type: 'checkbox', default: 1 },
      { name: 'no_surveys', label: 'Don’t send this customer satisfaction surveys', type: 'checkbox' },
      { name: 'no_signature_needed', label: 'Usually nobody on site to sign — jobs don’t need a customer signature', type: 'checkbox', roles: G.manage, help: 'Owners/admins only. E.g. commercial sites serviced after hours. Applies to new jobs for this customer.' },
      { name: 'lead_source', label: 'Lead source', type: 'select', options: ['referral', 'website', 'google', 'facebook', 'yard sign', 'builder / contractor', 'repeat customer', 'portal sign-up', 'other'] },
      { name: 'tax_exempt', label: 'Tax exempt', type: 'checkbox' },
      { name: 'gate_code', label: 'Gate / door code', type: 'secret' },
      { name: 'access_notes', label: 'Site access notes (keys, pets, hours)', type: 'textarea', full: true },
      { name: 'notes', label: 'Notes', type: 'textarea', full: true },
    ],
  },

  locations: {
    label: 'Locations', singular: 'Location', labelExpr: "name || CASE WHEN COALESCE(address,'') <> '' THEN ' — ' || address ELSE '' END",
    read: ALL, write: G.customers, order: 'name COLLATE NOCASE', search: ['name', 'address', 'city', 'site_contact', 'phone'],
    fields: [
      { name: 'customer_id', label: 'Customer', type: 'ref', ref: 'customers', required: true, onDelete: 'cascade' },
      { name: 'name', label: 'Location name', type: 'text', required: true, list: true, help: 'e.g. Main store, Warehouse, Lake house' },
      { name: 'address', label: 'Address', type: 'text', list: true, full: true },
      { name: 'city', label: 'City', type: 'text', list: true },
      { name: 'state', label: 'State', type: 'text' },
      { name: 'zip', label: 'ZIP', type: 'text' },
      { name: 'lat', label: 'Latitude', type: 'number', hidden: true },
      { name: 'lng', label: 'Longitude', type: 'number', hidden: true },
      { name: 'geocode_failed', label: 'Address not found on map', type: 'checkbox', hidden: true },
      { name: 'site_contact', label: 'Site contact', type: 'text', list: true },
      { name: 'phone', label: 'Site phone', type: 'tel', list: true },
      { name: 'gate_code', label: 'Gate / door code', type: 'secret' },
      { name: 'access_notes', label: 'Access notes', type: 'textarea', full: true },
      { name: 'active', label: 'Active', type: 'checkbox', default: 1 },
    ],
  },

  contacts: {
    label: 'Contacts', singular: 'Contact', labelExpr: 'name',
    read: ALL, write: G.customers, order: 'is_primary DESC, name',
    search: ['name', 'email', 'phone'],
    fields: [
      customerRef,
      { name: 'name', label: 'Name', type: 'text', required: true, list: true },
      { name: 'role', label: 'Role', type: 'text', list: true, help: 'e.g. Owner, Facility manager, Billing' },
      { name: 'email', label: 'Email', type: 'email', list: true },
      { name: 'phone', label: 'Phone', type: 'tel', list: true },
      { name: 'is_primary', label: 'Primary contact', type: 'checkbox', list: true },
      { name: 'receives_invoices', label: 'Receives invoices', type: 'checkbox' },
      { name: 'notes', label: 'Notes', type: 'textarea', full: true },
    ],
  },

  recurring_charges: {
    label: 'Recurring charges', singular: 'Recurring charge', labelExpr: 'description',
    read: G.salesOrBilling, write: G.billing, order: 'id',
    fields: [
      customerRef,
      { name: 'description', label: 'Description', type: 'text', required: true, list: true, help: 'e.g. 24/7 alarm monitoring, Cloud video storage' },
      { name: 'amount', label: 'Monthly amount', type: 'money', required: true, list: true },
      { name: 'taxable', label: 'Taxable', type: 'checkbox', list: true },
      { name: 'active', label: 'Active', type: 'checkbox', default: 1, list: true },
    ],
  },

  camera_systems: {
    label: 'Camera systems', singular: 'Camera system', labelExpr: "COALESCE(NULLIF(location,''), brand, 'Camera system')",
    read: ALL, write: ALL, order: 'id',
    fields: [
      customerRef,
      { name: 'site_id', label: 'Site', type: 'ref', ref: 'locations', dependsOn: 'customer_id', onDelete: 'set null', list: true },
      { name: 'location', label: 'Area / building', type: 'text', list: true },
      { name: 'recorder_type', label: 'Recorder', type: 'select', options: ['NVR', 'DVR', 'Cloud', 'Hybrid'], default: 'NVR', list: true },
      { name: 'brand', label: 'Brand', type: 'text', list: true },
      { name: 'model', label: 'Model', type: 'text' },
      { name: 'serial', label: 'Serial #', type: 'text' },
      { name: 'camera_count', label: '# of cameras', type: 'number', list: true },
      { name: 'ip_address', label: 'IP address', type: 'text' },
      { name: 'http_port', label: 'HTTP port', type: 'number' },
      { name: 'remote_access', label: 'Remote access (DDNS / P2P ID)', type: 'text' },
      { name: 'app_name', label: 'Viewing app', type: 'text' },
      { name: 'admin_username', label: 'Admin username', type: 'text' },
      { name: 'admin_password', label: 'Admin password', type: 'secret' },
      { name: 'viewer_username', label: 'Customer/viewer username', type: 'text' },
      { name: 'viewer_password', label: 'Customer/viewer password', type: 'secret' },
      { name: 'storage_tb', label: 'Storage (TB)', type: 'number' },
      { name: 'retention_days', label: 'Retention (days)', type: 'number' },
      { name: 'install_date', label: 'Installed', type: 'date' },
      { name: 'warranty_expires', label: 'Warranty expires', type: 'date' },
      { name: 'last_service', label: 'Last service', type: 'date' },
      { name: 'next_service', label: 'Next service due', type: 'date', list: true },
      { name: 'service_interval_months', label: 'Service interval (months)', type: 'number', default: 12 },
      { name: 'notes', label: 'Notes', type: 'textarea', full: true },
    ],
  },

  alarm_systems: {
    label: 'Alarm systems', singular: 'Alarm / intrusion system', labelExpr: "COALESCE(NULLIF(location,''), panel_brand, 'Alarm system')",
    read: ALL, write: ALL, order: 'id',
    fields: [
      customerRef,
      { name: 'site_id', label: 'Site', type: 'ref', ref: 'locations', dependsOn: 'customer_id', onDelete: 'set null', list: true },
      { name: 'location', label: 'Area / building', type: 'text', list: true },
      { name: 'panel_brand', label: 'Panel brand', type: 'text', list: true },
      { name: 'panel_model', label: 'Panel model', type: 'text' },
      { name: 'monitoring_center', label: 'Monitoring center', type: 'text' },
      { name: 'monitoring_account', label: 'Monitoring account #', type: 'text', list: true },
      { name: 'communicator', label: 'Communicator', type: 'select', options: ['cellular', 'ip', 'dual path', 'phone line', 'none'], default: 'cellular' },
      { name: 'zones', label: '# of zones', type: 'number' },
      { name: 'master_code', label: 'Master code', type: 'secret' },
      { name: 'installer_code', label: 'Installer code', type: 'secret' },
      { name: 'install_date', label: 'Installed', type: 'date' },
      { name: 'battery_replaced', label: 'Battery replaced', type: 'date' },
      { name: 'last_test', label: 'Last test / inspection', type: 'date' },
      { name: 'next_test', label: 'Next test due', type: 'date', list: true },
      { name: 'test_interval_months', label: 'Test interval (months)', type: 'number', default: 12 },
      { name: 'notes', label: 'Notes', type: 'textarea', full: true },
    ],
  },

  fire_systems: {
    label: 'Fire systems', singular: 'Fire system', labelExpr: "COALESCE(NULLIF(location,''), system_type)",
    read: ALL, write: ALL, order: 'id',
    fields: [
      customerRef,
      { name: 'site_id', label: 'Site', type: 'ref', ref: 'locations', dependsOn: 'customer_id', onDelete: 'set null', list: true },
      { name: 'system_type', label: 'System type', type: 'select', options: ['fire alarm', 'sprinkler', 'kitchen hood suppression', 'clean agent suppression', 'CO2 suppression', 'dry chemical suppression', 'water mist suppression', 'fire pump', 'emergency lighting', 'other'], optionLabels: { 'kitchen hood suppression': 'Kitchen suppression (hood)', 'clean agent suppression': 'Clean agent suppression (FM-200, Novec…)', 'CO2 suppression': 'CO2 suppression', 'dry chemical suppression': 'Dry chemical suppression (industrial)', 'water mist suppression': 'Water mist suppression' }, default: 'fire alarm', list: true },
      { name: 'location', label: 'Area / building', type: 'text', list: true },
      { name: 'panel_brand', label: 'Panel / equipment brand', type: 'text' },
      { name: 'panel_model', label: 'Model', type: 'text' },
      { name: 'monitoring_account', label: 'Monitoring account #', type: 'text' },
      { name: 'panel_code', label: 'Panel access code', type: 'secret' },
      { name: 'device_count', label: '# of devices / heads', type: 'number' },
      { name: 'ahj', label: 'AHJ (fire marshal / jurisdiction)', type: 'text' },
      { name: 'install_date', label: 'Installed', type: 'date' },
      { name: 'last_inspection', label: 'Last inspection', type: 'date' },
      { name: 'next_inspection', label: 'Next inspection due', type: 'date', list: true },
      { name: 'inspection_interval_months', label: 'Inspection interval (months)', type: 'number', default: 12, help: '6 for kitchen and special-hazard suppression, 12 for most alarm/sprinkler' },
      { name: 'notes', label: 'Notes', type: 'textarea', full: true },
    ],
  },

  extinguishers: {
    label: 'Fire extinguishers', singular: 'Fire extinguisher', labelExpr: "COALESCE(NULLIF(location,''), ext_type)",
    read: ALL, write: ALL, order: 'location',
    fields: [
      customerRef,
      { name: 'site_id', label: 'Site', type: 'ref', ref: 'locations', dependsOn: 'customer_id', onDelete: 'set null', list: true },
      { name: 'tag_number', label: 'Tag / barcode #', type: 'text', list: true, help: 'The number on your inspection tag or barcode sticker' },
      { name: 'location', label: 'Spot (e.g. Kitchen by exit)', type: 'text', list: true },
      { name: 'floor', label: 'Building / floor', type: 'text' },
      { name: 'ext_type', label: 'Type', type: 'select', options: ['ABC dry chemical', 'BC dry chemical', 'CO2', 'Class K (wet chemical)', 'Water', 'Clean agent', 'Class D'], default: 'ABC dry chemical', list: true },
      { name: 'size', label: 'Size', type: 'text', list: true, help: 'e.g. 5 lb, 10 lb' },
      { name: 'rating', label: 'UL rating', type: 'text', help: 'e.g. 4-A:60-B:C' },
      { name: 'brand', label: 'Brand', type: 'text' },
      { name: 'serial', label: 'Serial #', type: 'text' },
      { name: 'manufacture_date', label: 'Manufacture date', type: 'date', help: 'From the label or cylinder stamp. Used to work out 6-year and hydro dates' },
      { name: 'pressure_type', label: 'Kind', type: 'select', options: ['stored pressure', 'cartridge operated', 'disposable'], optionLabels: { 'stored pressure': 'Stored pressure (rechargeable)', 'cartridge operated': 'Cartridge operated', disposable: 'Disposable (non-rechargeable)' }, default: 'stored pressure' },
      { name: 'mount', label: 'Mounting', type: 'select', options: ['wall hook', 'bracket', 'cabinet', 'floor stand', 'vehicle', 'other'], default: 'wall hook' },
      { name: 'status', label: 'Status', type: 'select', options: ['in service', 'needs service', 'out of service', 'removed'], default: 'in service', list: true },
      { name: 'last_annual', label: 'Last annual inspection', type: 'date' },
      { name: 'next_annual', label: 'Next annual due', type: 'date', list: true },
      { name: 'last_6yr', label: 'Last 6-year maintenance', type: 'date' },
      { name: 'next_6yr', label: 'Next 6-year maintenance due', type: 'date', help: 'Stored-pressure dry chemical only. Worked out from the last 6-year, hydro or manufacture date' },
      { name: 'last_hydro', label: 'Last hydrostatic test', type: 'date' },
      { name: 'next_hydro', label: 'Next hydro test due', type: 'date', list: true },
      { name: 'hydro_interval_years', label: 'Hydro interval (years)', type: 'number', default: 12, help: '5 for CO2/water/Class K, 12 for dry chemical' },
      { name: 'last_recharge', label: 'Last recharged', type: 'date' },
      { name: 'replace_by', label: 'Replace by (disposable units)', type: 'date', help: '12 years from manufacture for disposable units' },
      { name: 'notes', label: 'Notes', type: 'textarea', full: true },
    ],
  },

  technicians: {
    label: 'Technicians', singular: 'Technician', labelExpr: 'name',
    read: ALL, write: G.manage, order: 'active DESC, name',
    search: ['name', 'phone', 'email', 'skills'],
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, list: true },
      { name: 'phone', label: 'Phone', type: 'tel', list: true },
      { name: 'email', label: 'Email', type: 'email', list: true },
      { name: 'skills', label: 'Skills / certifications', type: 'text', list: true, help: 'e.g. NICET II, cameras, access control' },
      { name: 'color', label: 'Calendar color', type: 'color', default: '#2563eb' },
      { name: 'calendar_token', label: 'Calendar feed key', type: 'text', readonly: true, hidden: true },
      { name: 'twilio_number', label: 'Direct business number (optional)', type: 'tel', help: 'A Twilio number just for this tech. Calls to it ring their phone, and calls they make from the app show it. Leave blank to use the shared company number.' },
      { name: 'hourly_cost', label: 'Hourly cost to company', type: 'money', help: 'Wage + taxes/benefits. Used for profit estimates.' },
      { name: 'bill_rate', label: 'Default billing rate / hr', type: 'money' },
      { name: 'active', label: 'Active', type: 'checkbox', default: 1, list: true },
      { name: 'notes', label: 'Notes', type: 'textarea', full: true },
    ],
  },

  // On-call rotation: who answers after-hours calls. Shows on the tech's calendar.
  on_call_shifts: {
    label: 'On-call shifts', singular: 'On-call shift', labelExpr: "'On call'",
    read: ALL, write: G.manage, order: 'starts_at', dateField: 'starts_at',
    fields: [
      { name: 'technician_id', label: 'On call', type: 'ref', ref: 'technicians', required: true, onDelete: 'cascade', list: true },
      { name: 'backup_technician_id', label: 'Backup', type: 'ref', ref: 'technicians', onDelete: 'set null', list: true },
      { name: 'starts_at', label: 'Starts', type: 'datetime', required: true, list: true },
      { name: 'ends_at', label: 'Ends', type: 'datetime', required: true, list: true },
      { name: 'notes', label: 'Notes', type: 'text', full: true },
      { name: 'cal_sequence', label: 'Calendar revision', type: 'number', default: 0, hidden: true },
    ],
  },

  vehicles: {
    label: 'Vehicles', singular: 'Vehicle', labelExpr: 'unit_name',
    read: ALL, write: G.manage, order: 'unit_name',
    search: ['unit_name', 'make', 'model', 'vin', 'plate'],
    fields: [
      { name: 'unit_name', label: 'Unit # / name', type: 'text', required: true, list: true },
      { name: 'year', label: 'Year', type: 'number', list: true },
      { name: 'make', label: 'Make', type: 'text', list: true },
      { name: 'model', label: 'Model', type: 'text', list: true },
      { name: 'plate', label: 'Plate', type: 'text', list: true },
      { name: 'vin', label: 'VIN', type: 'text' },
      { name: 'assigned_technician_id', label: 'Assigned technician', type: 'ref', ref: 'technicians', list: true, onDelete: 'set null' },
      { name: 'status', label: 'Status', type: 'select', options: ['in service', 'out of service', 'sold'], default: 'in service', list: true },
      { name: 'mileage', label: 'Current mileage', type: 'number' },
      { name: 'tire_psi', label: 'Tire pressure target (psi)', type: 'number', help: 'From the sticker in the driver’s door. Vehicle checks flag tires more than 5 psi under it.' },
      { name: 'tracker_id', label: 'GPS tracker / vehicle ID', type: 'text', help: 'The vehicle’s ID in your tracking system (e.g. Samsara). Blank = match by unit name.' },
      { name: 'tracking_url', label: 'Tracking page link', type: 'text', help: 'Link to this vehicle in your tracking provider (live location, trips).' },
      { name: 'camera_url', label: 'Dash cam link', type: 'text', help: 'Link to this vehicle’s dash cam / live view in your camera or tracking provider.' },
      { name: 'next_service_miles', label: 'Next service at (miles)', type: 'number' },
      { name: 'next_service_date', label: 'Next service date', type: 'date' },
      { name: 'registration_expires', label: 'Registration expires', type: 'date' },
      { name: 'insurance_expires', label: 'Insurance expires', type: 'date' },
      { name: 'notes', label: 'Notes', type: 'textarea', full: true },
    ],
  },

  inventory_items: {
    label: 'Inventory items', singular: 'Inventory item', labelExpr: "name || CASE WHEN COALESCE(sku,'') <> '' THEN ' (' || sku || ')' ELSE '' END",
    read: ALL, write: G.billing, order: 'category, name',
    search: ['sku', 'name', 'manufacturer', 'category'],
    fields: [
      { name: 'sku', label: 'SKU / part #', type: 'text', list: true },
      { name: 'name', label: 'Item name', type: 'text', required: true, list: true },
      { name: 'category', label: 'Category', type: 'select', options: ['cameras', 'recorders', 'alarm panels', 'sensors & detectors', 'fire alarm devices', 'extinguishers', 'access control', 'cable & wire', 'power & batteries', 'networking', 'hardware', 'other'], default: 'other', list: true },
      { name: 'manufacturer', label: 'Manufacturer', type: 'text' },
      { name: 'unit_cost', label: 'Unit cost', type: 'money', list: true },
      { name: 'unit_price', label: 'Sell price', type: 'money', list: true },
      { name: 'reorder_level', label: 'Reorder when total below', type: 'number', default: 0 },
      { name: 'serialized', label: 'Track serial numbers (cameras, recorders, panels…)', type: 'checkbox', help: 'Each one used on a job needs its serial # and a photo of the label / warranty info.' },
      { name: 'warranty_months', label: 'Manufacturer warranty (months)', type: 'number' },
      { name: 'truck_min', label: 'Standard truck stock (per vehicle)', type: 'number', default: 0, help: 'Every truck should carry at least this many. 0 = not standard truck stock.' },
      { name: 'truck_max', label: 'Most to keep on a truck', type: 'number', help: 'Keeps extras low: more than this gets flagged to go back to the warehouse. Blank = standard + 1.' },
      { name: 'vendor_skus', label: 'Distributor part #s', type: 'text', full: true, help: 'Other part numbers this item appears under on supplier invoices, comma-separated. Learned automatically when you match an invoice line.' },
      { name: 'active', label: 'Active', type: 'checkbox', default: 1 },
      { name: 'notes', label: 'Notes', type: 'textarea', full: true },
    ],
  },

  // Per-vehicle exceptions to the standard truck stock (e.g. the fire truck carries more pull stations).
  truck_par: {
    label: 'Truck stock exceptions', singular: 'Truck stock exception', labelExpr: "'exception'",
    read: ALL, write: G.billing, order: 'id',
    fields: [
      { name: 'vehicle_id', label: 'Vehicle', type: 'ref', ref: 'vehicles', required: true, onDelete: 'cascade', list: true },
      { name: 'item_id', label: 'Item', type: 'ref', ref: 'inventory_items', required: true, onDelete: 'cascade', list: true },
      { name: 'min_qty', label: 'Keep at least', type: 'number', required: true, default: 1, list: true, help: '0 = this truck does not carry it' },
      { name: 'max_qty', label: 'Most to keep', type: 'number', list: true, help: 'Blank = at least + 1' },
    ],
  },

  // Tools & equipment the company owns (ladders, meters, drills). Counted weekly with the truck.
  tools: {
    label: 'Tools', singular: 'Tool', labelExpr: "name || CASE WHEN COALESCE(tag,'') <> '' THEN ' #' || tag ELSE '' END",
    read: ALL, write: G.billing, order: 'name', search: ['name', 'tag', 'serial', 'category', 'notes'],
    fields: [
      { name: 'name', label: 'Tool', type: 'text', required: true, list: true },
      { name: 'tag', label: 'Asset tag', type: 'text', list: true },
      { name: 'category', label: 'Category', type: 'select', options: ['hand tools', 'power tools', 'meters & testers', 'ladders & lifts', 'fire service', 'network & camera', 'safety', 'other'], default: 'hand tools', list: true },
      { name: 'vehicle_id', label: 'Kept on vehicle', type: 'ref', ref: 'vehicles', onDelete: 'set null', list: true, help: 'Blank = warehouse / shop' },
      { name: 'qty', label: 'Qty', type: 'number', default: 1, list: true },
      { name: 'status', label: 'Status', type: 'select', options: ['in service', 'needs repair', 'missing', 'retired'], default: 'in service', list: true },
      { name: 'serial', label: 'Serial #', type: 'text' },
      { name: 'purchase_date', label: 'Purchased', type: 'date' },
      { name: 'cost', label: 'Cost', type: 'money' },
      { name: 'last_counted', label: 'Last counted', type: 'date', readonly: true, list: true },
      { name: 'notes', label: 'Notes', type: 'textarea', full: true },
    ],
  },

  // Supplier invoices / packing slips that arrive by email or are scanned in.
  purchase_invoices: {
    label: 'Supplier invoices', singular: 'Supplier invoice', labelExpr: "COALESCE(NULLIF(vendor,''), 'Supplier') || ' #' || COALESCE(invoice_number, id)",
    read: G.billing, write: G.billing, order: 'id DESC', dateField: 'invoice_date',
    search: ['vendor', 'invoice_number', 'from_email', 'subject', 'file_name'],
    fields: [
      { name: 'vendor', label: 'Vendor / distributor', type: 'text', list: true },
      { name: 'invoice_number', label: 'Invoice #', type: 'text', list: true },
      { name: 'invoice_date', label: 'Invoice date', type: 'date', list: true },
      { name: 'status', label: 'Status', type: 'select', options: ['processing', 'needs review', 'received', 'rejected', 'error'], default: 'processing', readonly: true, list: true },
      { name: 'source', label: 'Source', type: 'select', options: ['email', 'upload'], readonly: true, list: true },
      { name: 'location_id', label: 'Receive into', type: 'location' },
      { name: 'subtotal', label: 'Subtotal', type: 'money' },
      { name: 'tax', label: 'Tax', type: 'money' },
      { name: 'shipping', label: 'Shipping', type: 'money' },
      { name: 'total', label: 'Invoice total', type: 'money', list: true },
      { name: 'from_email', label: 'From', type: 'text', readonly: true },
      { name: 'subject', label: 'Email subject', type: 'text', readonly: true },
      { name: 'file_name', label: 'File', type: 'text', readonly: true },
      { name: 'file_type', label: 'File type', type: 'text', readonly: true, hidden: true },
      { name: 'file_key', label: 'Stored file', type: 'text', readonly: true, hidden: true },
      { name: 'review_note', label: 'Why it needs review', type: 'text', readonly: true },
      { name: 'received_at', label: 'Received', type: 'datetime', readonly: true },
      { name: 'expense_id', label: 'Expense', type: 'ref', ref: 'expenses', readonly: true, onDelete: 'set null' },
      { name: 'notes', label: 'Notes', type: 'textarea', full: true },
    ],
  },

  purchase_invoice_lines: {
    label: 'Invoice lines', singular: 'Invoice line', labelExpr: 'description',
    read: G.billing, write: G.billing, order: 'id',
    fields: [
      { name: 'purchase_invoice_id', label: 'Supplier invoice', type: 'ref', ref: 'purchase_invoices', required: true, onDelete: 'cascade' },
      { name: 'line_sku', label: 'Part #', type: 'text', list: true },
      { name: 'description', label: 'Description', type: 'text', list: true },
      { name: 'qty', label: 'Qty', type: 'number', default: 1, list: true },
      { name: 'unit_cost', label: 'Unit cost', type: 'money', list: true },
      { name: 'item_id', label: 'Inventory item', type: 'ref', ref: 'inventory_items', onDelete: 'set null', list: true },
      { name: 'match', label: 'Matched by', type: 'select', options: ['part #', 'distributor part #', 'name', 'AI suggestion', 'manual', 'skip', 'none'], default: 'none' },
    ],
  },

  // ---------------------------------------------------------------- alarm monitoring
  monitoring_stations: {
    label: 'Monitoring stations', singular: 'Monitoring station', labelExpr: 'name',
    read: ALL, write: G.manage, order: 'name COLLATE NOCASE',
    fields: [
      { name: 'name', label: 'Station name', type: 'text', required: true, list: true, help: 'e.g. CMS, your in-house central station' },
      { name: 'platform', label: 'Automation software', type: 'select', options: ['Manitou', 'MASterMind', 'stages', 'SIMS / Microkey', 'Monitoring Works', 'other / unknown'], default: 'other / unknown', list: true, help: 'What the station runs; decides which connector can be added later' },
      { name: 'connector', label: 'Connection', type: 'select', options: ['manual'], optionLabels: { manual: 'Manual (not connected yet)' }, default: 'manual', list: true, readonly: false },
      { name: 'operator_phone', label: 'Operator / dealer line', type: 'tel', list: true },
      { name: 'dealer_number', label: 'Our dealer number', type: 'text', list: true },
      { name: 'dealer_portal', label: 'Dealer web portal', type: 'text', help: 'Address of the station’s dealer website' },
      { name: 'receiver_numbers', label: 'Receiver phone numbers / IP receivers', type: 'textarea', help: 'What panels are programmed to report to' },
      { name: 'account_prefix', label: 'Account number prefix', type: 'text', help: 'e.g. C1- or blank' },
      { name: 'next_account_number', label: 'Next account number', type: 'number', help: 'Used to assign numbers automatically. Leave blank if the station assigns them.' },
      { name: 'account_digits', label: 'Digits (zero-padded)', type: 'number', default: 4 },
      { name: 'active', label: 'Active', type: 'checkbox', default: 1 },
      { name: 'notes', label: 'Notes', type: 'textarea', full: true },
      { name: 'inbound_token', label: 'Signal feed key', type: 'text', readonly: true, hidden: true },
    ],
  },

  monitoring_accounts: {
    label: 'Monitoring accounts', singular: 'Monitoring account', labelExpr: "account_number",
    read: ALL, write: ALL, del: G.manage, order: 'id DESC',
    search: ['account_number', 'comm_id', 'permit_number'],
    fields: [
      customerRef,
      { name: 'site_id', label: 'Site', type: 'ref', ref: 'locations', dependsOn: 'customer_id', onDelete: 'set null', list: true },
      { name: 'station_id', label: 'Monitoring station', type: 'ref', ref: 'monitoring_stations', required: true, list: true, onDelete: 'restrict' },
      { name: 'account_number', label: 'Account number', type: 'text', list: true, help: 'Leave blank to assign the station’s next number' },
      { name: 'status', label: 'Status', type: 'select', options: ['pending', 'active', 'on test', 'out of service', 'cancelled'], default: 'pending', list: true },
      { name: 'service_type', label: 'Monitored for', type: 'select', options: ['burglary', 'fire', 'burglary + fire', 'video', 'medical', 'environmental'], default: 'burglary', list: true },
      { name: 'alarm_system_id', label: 'Alarm system', type: 'ref', ref: 'alarm_systems', dependsOn: 'customer_id', onDelete: 'set null' },
      { name: 'panel', label: 'Panel (make/model)', type: 'text' },
      { name: 'communicator', label: 'Communicator', type: 'select', options: ['cellular', 'IP', 'dual path', 'POTS', 'radio'], default: 'cellular' },
      { name: 'comm_id', label: 'Communicator / radio ID', type: 'text', help: 'e.g. Alarm.com, Telguard, StarLink serial' },
      { name: 'receiver_line', label: 'Receiver / line #', type: 'text' },
      { name: 'passcode', label: 'Customer passcode (verbal)', type: 'secret' },
      { name: 'duress_code', label: 'Duress word / code', type: 'secret' },
      { name: 'permit_number', label: 'Alarm permit #', type: 'text' },
      { name: 'permit_expires', label: 'Permit expires', type: 'date' },
      { name: 'monitoring_start', label: 'Monitoring started', type: 'date' },
      { name: 'test_until', label: 'On test until', type: 'datetime', readonly: true },
      { name: 'test_reason', label: 'Test reason', type: 'text', readonly: true },
      { name: 'test_by', label: 'Put on test by', type: 'text', readonly: true },
      { name: 'status_before_test', label: 'Status before test', type: 'text', readonly: true, hidden: true },
      { name: 'station_synced', label: 'Confirmed with station', type: 'checkbox', readonly: true },
      { name: 'dispatch_notes', label: 'Dispatch / special instructions', type: 'textarea', full: true },
      { name: 'notes', label: 'Internal notes', type: 'textarea', full: true },
    ],
  },

  monitoring_zones: {
    label: 'Zones & sensors', singular: 'Zone', labelExpr: "'Zone ' || zone_number || ' ' || COALESCE(description,'')",
    read: ALL, write: ALL, del: G.manage, order: 'active DESC, zone_number',
    fields: [
      { name: 'account_id', label: 'Monitoring account', type: 'ref', ref: 'monitoring_accounts', required: true, onDelete: 'cascade' },
      { name: 'zone_number', label: 'Zone #', type: 'number', required: true, list: true },
      { name: 'description', label: 'Description', type: 'text', required: true, list: true, help: 'What the operator hears, e.g. “Front door”' },
      { name: 'zone_type', label: 'Type', type: 'select', options: ['entry/exit', 'perimeter', 'interior / motion', 'smoke', 'heat', 'carbon monoxide', 'glass break', 'panic', 'medical', 'water / flood', 'low temperature', 'tamper', 'keypad / key fob', 'other'], default: 'perimeter', list: true },
      { name: 'device', label: 'Device (make/model)', type: 'text', list: true },
      { name: 'serial', label: 'Serial / TX ID', type: 'text' },
      { name: 'location', label: 'Where it is', type: 'text' },
      { name: 'active', label: 'In service', type: 'checkbox', default: 1, list: true },
      { name: 'added_on', label: 'Added', type: 'date', readonly: true },
      { name: 'removed_on', label: 'Removed', type: 'date', readonly: true },
      { name: 'station_synced', label: 'Confirmed with station', type: 'checkbox', readonly: true },
    ],
  },

  monitoring_contacts: {
    label: 'Call list', singular: 'Call list contact', labelExpr: 'name',
    read: ALL, write: G.staff, del: G.staff, order: 'sequence, id',
    fields: [
      { name: 'account_id', label: 'Monitoring account', type: 'ref', ref: 'monitoring_accounts', required: true, onDelete: 'cascade' },
      { name: 'sequence', label: 'Call order', type: 'number', default: 1, list: true },
      { name: 'name', label: 'Name', type: 'text', required: true, list: true },
      { name: 'relation', label: 'Relation', type: 'text', list: true, help: 'Owner, manager, neighbor…' },
      { name: 'phone', label: 'Phone', type: 'tel', list: true },
      { name: 'has_key', label: 'Has key', type: 'checkbox', list: true },
      { name: 'notes', label: 'Notes', type: 'text', full: true },
    ],
  },

  // Sales proposals and customer agreements, signed electronically.
  proposals: {
    label: 'Proposals & agreements', singular: 'Proposal', labelExpr: "'P-' || number || ' ' || title",
    read: G.salesOrBilling, write: G.sales, del: G.sales, order: 'id DESC', dateField: 'created_at',
    search: ['number', 'title', 'signed_by'],
    fields: [
      { name: 'number', label: 'Number', type: 'text', readonly: true, list: true },
      { name: 'customer_id', label: 'Customer', type: 'ref', ref: 'customers', required: true, list: true, onDelete: 'restrict' },
      { name: 'site_id', label: 'Site', type: 'ref', ref: 'locations', dependsOn: 'customer_id', onDelete: 'set null' },
      { name: 'kind', label: 'Document type', type: 'select', options: ['proposal', 'installation agreement', 'monitoring agreement', 'service agreement'], default: 'proposal', list: true },
      { name: 'title', label: 'Title', type: 'text', required: true, list: true, full: true, help: 'e.g. 8-camera system with cloud monitoring' },
      { name: 'status', label: 'Status', type: 'select', options: ['draft', 'sent', 'viewed', 'signed', 'declined', 'expired'], default: 'draft', readonly: true, list: true },
      { name: 'valid_until', label: 'Valid until', type: 'date' },
      { name: 'intro', label: 'Scope of work / summary', type: 'textarea', full: true },
      { name: 'monthly_amount', label: 'Monthly service fee', type: 'money', help: 'Monitoring / cloud / service plan, billed monthly once signed' },
      { name: 'monthly_description', label: 'Monthly fee description', type: 'text', default: '24/7 monitoring service' },
      { name: 'term_months', label: 'Agreement term (months)', type: 'number' },
      { name: 'deposit_percent', label: 'Deposit due at signing (%)', type: 'number', help: 'Creates a deposit invoice when signed' },
      { name: 'tax_rate', label: 'Tax rate %', type: 'number', help: 'Blank = company default' },
      { name: 'terms', label: 'Terms & conditions', type: 'textarea', full: true, help: 'Blank = your default terms from Settings' },
      { name: 'subtotal', label: 'Subtotal', type: 'money', readonly: true },
      { name: 'tax', label: 'Tax', type: 'money', readonly: true },
      { name: 'total', label: 'One-time total', type: 'money', readonly: true, list: true },
      { name: 'sales_user', label: 'Prepared by', type: 'text', readonly: true },
      { name: 'sent_at', label: 'Sent', type: 'datetime', readonly: true },
      { name: 'viewed_at', label: 'First viewed', type: 'datetime', readonly: true },
      { name: 'signed_by', label: 'Signed by', type: 'text', readonly: true, list: true },
      { name: 'signed_title', label: 'Signer title', type: 'text', readonly: true },
      { name: 'signed_email', label: 'Signer email', type: 'text', readonly: true },
      { name: 'signed_at', label: 'Signed', type: 'datetime', readonly: true },
      { name: 'signed_ip', label: 'Signed from IP', type: 'text', readonly: true },
      { name: 'signed_agent', label: 'Signer device', type: 'text', readonly: true, hidden: true },
      { name: 'doc_hash', label: 'Document fingerprint (SHA-256)', type: 'text', readonly: true },
      { name: 'signature_key', label: 'Signature image', type: 'text', readonly: true, hidden: true },
      { name: 'public_token', label: 'Signing link key', type: 'text', readonly: true, hidden: true },
      { name: 'declined_reason', label: 'Reason declined', type: 'text', readonly: true },
      { name: 'invoice_id', label: 'Deposit invoice', type: 'ref', ref: 'invoices', readonly: true, onDelete: 'set null' },
      { name: 'service_call_id', label: 'Installation job', type: 'ref', ref: 'service_calls', readonly: true, onDelete: 'set null' },
    ],
  },

  proposal_items: {
    label: 'Proposal lines', singular: 'Line item', labelExpr: 'description',
    read: G.salesOrBilling, write: G.sales, del: G.sales, order: 'sort, id',
    fields: [
      { name: 'proposal_id', label: 'Proposal', type: 'ref', ref: 'proposals', required: true, onDelete: 'cascade' },
      { name: 'item_id', label: 'From inventory (optional)', type: 'ref', ref: 'inventory_items', onDelete: 'set null' },
      { name: 'description', label: 'Description', type: 'text', list: true, full: true, help: 'Leave blank to use the inventory item name' },
      { name: 'qty', label: 'Qty', type: 'number', default: 1, required: true, list: true },
      { name: 'unit_price', label: 'Unit price', type: 'money', list: true, help: 'Leave blank to use the item sell price' },
      { name: 'taxable', label: 'Taxable', type: 'checkbox', default: 1, list: true },
      { name: 'sort', label: 'Order', type: 'number', default: 0, hidden: true },
    ],
  },

  service_calls: {
    label: 'Service calls', singular: 'Service call', labelExpr: "'SC-' || number || ' ' || title",
    read: ALL, write: ALL, order: 'COALESCE(scheduled_start, created_at) DESC', dateField: 'scheduled_start',
    search: ['number', 'title', 'description', 'resolution'],
    fields: [
      { name: 'number', label: 'Call #', type: 'text', readonly: true, list: true },
      customerRef,
      { name: 'site_id', label: 'Site', type: 'ref', ref: 'locations', dependsOn: 'customer_id', onDelete: 'set null', list: true },
      { name: 'title', label: 'Summary', type: 'text', required: true, list: true, full: true },
      { name: 'call_type', label: 'Call type', type: 'select', options: ['service', 'installation', 'maintenance', 'inspection', 'estimate', 'warranty'], default: 'service', list: true },
      { name: 'system_type', label: 'System', type: 'select', options: ['camera', 'alarm', 'fire alarm', 'sprinkler', 'extinguisher', 'access control', 'other'], default: 'alarm' },
      { name: 'priority', label: 'Priority', type: 'select', options: ['low', 'normal', 'high', 'emergency'], default: 'normal', list: true },
      { name: 'status', label: 'Status', type: 'select', options: ['new', 'scheduled', 'en route', 'in progress', 'on hold', 'completed', 'cancelled'], default: 'new', list: true },
      { name: 'technician_id', label: 'Technician', type: 'ref', ref: 'technicians', list: true, onDelete: 'set null' },
      { name: 'scheduled_start', label: 'Scheduled for', type: 'datetime', list: true },
      { name: 'duration_hours', label: 'Est. duration (hours)', type: 'number', default: 1 },
      { name: 'description', label: 'Problem / work requested', type: 'textarea', full: true },
      { name: 'labor_hours', label: 'Actual labor hours', type: 'number' },
      { name: 'labor_rate', label: 'Labor rate / hr', type: 'money' },
      { name: 'billable', label: 'Billable', type: 'checkbox', default: 1 },
      { name: 'resolution', label: 'Work performed / resolution', type: 'textarea', full: true },
      { name: 'completed_at', label: 'Completed', type: 'datetime', readonly: true },
      { name: 'invoice_id', label: 'Invoice', type: 'ref', ref: 'invoices', readonly: true, onDelete: 'set null' },
      { name: 'cal_sequence', label: 'Calendar revision', type: 'number', readonly: true, hidden: true },
      { name: 'signature_waived', label: 'Customer won’t be on site — no signature needed', type: 'checkbox', roles: G.manage, help: 'Owners/admins only: approves completing this job without the customer’s signature.' },
      { name: 'signature_waived_by', label: 'No-signature approved by', type: 'text', readonly: true },
      { name: 'no_parts_used', label: 'No parts used', type: 'checkbox', readonly: true },
      { name: 'completion_override', label: 'Completion rule override', type: 'text', readonly: true },
      { name: 'signed_by', label: 'Signed off by', type: 'text', readonly: true },
      { name: 'signed_at', label: 'Signed', type: 'datetime', readonly: true },
      { name: 'signature_key', label: 'Signature image', type: 'text', readonly: true, hidden: true },
    ],
  },

  // Training library: videos, manuals (PDF), how-to articles and links for the team.
  training_resources: {
    label: 'Training library', singular: 'Training item', labelExpr: 'title',
    read: ALL, write: G.manage, order: 'category, title', search: ['title', 'category', 'manufacturer', 'model', 'tags', 'body'],
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true, list: true, full: true },
      { name: 'kind', label: 'Type', type: 'select', options: ['video', 'manual', 'article', 'link'], optionLabels: { video: 'Video', manual: 'Manual (PDF)', article: 'How-to article', link: 'Web link' }, default: 'video', list: true },
      { name: 'category', label: 'Category', type: 'select', options: ['alarm panels', 'cameras & NVRs', 'fire alarm', 'sprinkler & suppression', 'extinguishers', 'access control', 'networking', 'wiring & tools', 'safety', 'company policies', 'using SecureOps', 'other'], default: 'other', list: true },
      { name: 'manufacturer', label: 'Manufacturer', type: 'text', list: true },
      { name: 'model', label: 'Model(s)', type: 'text' },
      { name: 'url', label: 'Video or web link', type: 'text', full: true, help: 'YouTube and Vimeo videos play right in the app. For a manual, upload the PDF after saving.' },
      { name: 'body', label: 'Article / notes', type: 'textarea', full: true, help: 'Step-by-step instructions, tips, part numbers…' },
      { name: 'tags', label: 'Search words', type: 'text', full: true, help: 'e.g. zone programming, default code, reset' },
      { name: 'file_key', label: 'File', type: 'text', hidden: true, readonly: true },
      { name: 'file_name', label: 'File name', type: 'text', readonly: true },
    ],
  },

  // Who to call for help: manufacturer tech support, distributor reps, RMA desks, software helpdesks.
  vendor_contacts: {
    label: 'Support contacts', singular: 'Support contact', labelExpr: "company || COALESCE(' — ' || NULLIF(department,''), '')",
    read: ALL, write: G.staff, order: 'company, department', search: ['company', 'department', 'contact_name', 'phone', 'email', 'notes', 'products'],
    fields: [
      { name: 'company', label: 'Company', type: 'text', required: true, list: true },
      { name: 'department', label: 'Department', type: 'select', options: ['tech support', 'warranty / RMA', 'sales rep', 'customer service', 'billing', 'central station', 'software / IT helpdesk', 'other'], default: 'tech support', list: true },
      { name: 'products', label: 'For (products / systems)', type: 'text', list: true, help: 'e.g. Qolsys panels, Hikvision cameras' },
      { name: 'contact_name', label: 'Contact name', type: 'text' },
      { name: 'phone', label: 'Phone', type: 'tel', list: true },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'website', label: 'Website / portal', type: 'text' },
      { name: 'account_number', label: 'Our account / dealer #', type: 'text' },
      { name: 'hours', label: 'Hours', type: 'text', help: 'e.g. M–F 8–8 ET, 24/7' },
      { name: 'notes', label: 'Notes', type: 'textarea', full: true, help: 'Phone tree shortcuts, what to have ready…' },
    ],
  },

  // Pay & benefits add-on: the company's benefit plans (everyone can read; owner/accounting edit).
  benefit_plans: {
    label: 'Benefit plans', singular: 'Benefit plan', labelExpr: 'name',
    read: ALL, write: G.payAdmin, order: 'sort, name',
    fields: [
      { name: 'name', label: 'Plan', type: 'text', required: true, list: true, help: 'e.g. Blue Cross PPO, 401(k) with match' },
      { name: 'kind', label: 'Type', type: 'select', options: ['health', 'dental', 'vision', 'life', 'disability', 'retirement', 'HSA / FSA', 'other'], default: 'health', list: true },
      { name: 'provider', label: 'Provider', type: 'text', list: true },
      { name: 'summary', label: 'What’s covered / company contribution', type: 'textarea', full: true },
      { name: 'member_phone', label: 'Member services phone', type: 'tel' },
      { name: 'website', label: 'Member website', type: 'text' },
      { name: 'group_number', label: 'Group #', type: 'text' },
      { name: 'enrollment', label: 'Enrollment (when / how)', type: 'text', full: true },
      { name: 'sort', label: 'Order', type: 'number', default: 0, hidden: true },
    ],
  },

  // Equipment installed at a customer: serial numbers, where it is, warranty, photos of labels.
  installed_equipment: {
    label: 'Installed equipment', singular: 'Equipment', labelExpr: "COALESCE(NULLIF(description,''), 'Equipment') || CASE WHEN COALESCE(serial_number,'') <> '' THEN ' S/N ' || serial_number ELSE '' END",
    read: ALL, write: ALL, del: G.manage, order: 'install_date DESC, id DESC', search: ['description', 'serial_number', 'mac_address', 'location', 'model'],
    fields: [
      customerRef,
      { name: 'site_id', label: 'Site', type: 'ref', ref: 'locations', dependsOn: 'customer_id', onDelete: 'set null', list: true },
      { name: 'item_id', label: 'Inventory item', type: 'ref', ref: 'inventory_items', onDelete: 'set null' },
      { name: 'description', label: 'Equipment', type: 'text', required: true, list: true },
      { name: 'model', label: 'Model', type: 'text' },
      { name: 'serial_number', label: 'Serial #', type: 'text', list: true },
      { name: 'mac_address', label: 'MAC address', type: 'text' },
      { name: 'location', label: 'Installed where', type: 'text', list: true, help: 'e.g. Front porch, Rack in IT closet' },
      { name: 'install_date', label: 'Installed', type: 'date', default: today, list: true },
      { name: 'warranty_months', label: 'Warranty (months)', type: 'number' },
      { name: 'warranty_expires', label: 'Warranty ends', type: 'date', list: true },
      { name: 'status', label: 'Status', type: 'select', options: ['installed', 'replaced', 'removed', 'sent for RMA'], default: 'installed', list: true },
      { name: 'service_call_id', label: 'Installed on job', type: 'ref', ref: 'service_calls', onDelete: 'set null', readonly: true },
      { name: 'part_id', label: 'Job part line', type: 'number', hidden: true, readonly: true },
      { name: 'notes', label: 'Notes', type: 'textarea', full: true },
    ],
  },

  // Equipment planned for a job: picked from the warehouse onto the tech's truck before the day starts.
  job_materials: {
    label: 'Job materials', singular: 'Material', labelExpr: "'material'",
    read: ALL, write: ALL, order: 'id',
    fields: [
      { name: 'service_call_id', label: 'Service call', type: 'ref', ref: 'service_calls', required: true, onDelete: 'cascade' },
      { name: 'item_id', label: 'Item', type: 'ref', ref: 'inventory_items', required: true, list: true },
      { name: 'qty', label: 'Qty needed', type: 'number', required: true, default: 1, list: true },
      { name: 'status', label: 'Status', type: 'select', options: ['needed', 'checked out', 'returned'], default: 'needed', list: true, readonly: true },
      { name: 'checked_out_qty', label: 'Checked out', type: 'number', default: 0, readonly: true },
      { name: 'checked_out_to', label: 'Checked out to', type: 'location', readonly: true },
      { name: 'checked_out_by', label: 'Checked out by', type: 'text', readonly: true },
      { name: 'notes', label: 'Notes', type: 'text' },
    ],
  },

  service_call_parts: {
    label: 'Parts used', singular: 'Part used', labelExpr: "'part'",
    read: ALL, write: ALL, order: 'id', noUpdate: true,
    fields: [
      { name: 'service_call_id', label: 'Service call', type: 'ref', ref: 'service_calls', required: true, onDelete: 'cascade' },
      { name: 'item_id', label: 'Item', type: 'ref', ref: 'inventory_items', required: true, list: true },
      { name: 'location_id', label: 'Taken from', type: 'location', list: true },
      { name: 'qty', label: 'Qty', type: 'number', required: true, default: 1, list: true },
      { name: 'unit_price', label: 'Price each (blank = item price)', type: 'money', list: true },
      { name: 'unit_cost', label: 'Cost each', type: 'money', readonly: true },
    ],
  },

  invoices: {
    label: 'Invoices', singular: 'Invoice', labelExpr: "'#' || number",
    read: OFFICE, write: OFFICE, order: 'issue_date DESC, id DESC', dateField: 'issue_date',
    search: ['number', 'notes', 'period'],
    fields: [
      { name: 'number', label: 'Invoice #', type: 'text', readonly: true, list: true },
      { ...customerRef, onDelete: 'restrict' },
      { name: 'kind', label: 'Kind', type: 'select', options: ['monthly', 'service', 'installation', 'other'], default: 'service', list: true },
      { name: 'period', label: 'Billing period (YYYY-MM)', type: 'text', help: 'For monthly invoices' },
      { name: 'issue_date', label: 'Issue date', type: 'date', default: today, list: true },
      { name: 'due_date', label: 'Due date', type: 'date', help: 'Blank = issue date + payment terms', list: true },
      { name: 'status', label: 'Status', type: 'select', options: ['draft', 'sent', 'partial', 'paid', 'void'], default: 'draft', list: true },
      { name: 'tax_rate', label: 'Tax rate %', type: 'number', help: 'Blank = company default' },
      { name: 'subtotal', label: 'Subtotal', type: 'money', readonly: true },
      { name: 'tax', label: 'Tax', type: 'money', readonly: true },
      { name: 'total', label: 'Total', type: 'money', readonly: true, list: true },
      { name: 'service_call_id', label: 'Service call', type: 'ref', ref: 'service_calls', readonly: true, onDelete: 'set null' },
      { name: 'notes', label: 'Notes (printed on invoice)', type: 'textarea', full: true },
      { name: 'pay_token', label: 'Online payment link key', type: 'text', readonly: true, hidden: true },
    ],
  },

  invoice_items: {
    label: 'Line items', singular: 'Line item', labelExpr: 'description',
    read: OFFICE, write: OFFICE, order: 'id',
    fields: [
      { name: 'invoice_id', label: 'Invoice', type: 'ref', ref: 'invoices', required: true, onDelete: 'cascade' },
      { name: 'description', label: 'Description', type: 'text', required: true, list: true, full: true },
      { name: 'qty', label: 'Qty', type: 'number', default: 1, required: true, list: true },
      { name: 'unit_price', label: 'Unit price', type: 'money', required: true, list: true },
      { name: 'taxable', label: 'Taxable', type: 'checkbox', list: true },
    ],
  },

  payments: {
    label: 'Payments', singular: 'Payment', labelExpr: "'payment'",
    read: OFFICE, write: OFFICE, order: 'date DESC, id DESC', dateField: 'date',
    search: ['reference', 'notes'],
    fields: [
      { name: 'invoice_id', label: 'Invoice', type: 'ref', ref: 'invoices', required: true, list: true, onDelete: 'restrict' },
      { name: 'customer_id', label: 'Customer', type: 'ref', ref: 'customers', readonly: true, list: true, onDelete: 'restrict' },
      { name: 'date', label: 'Date', type: 'date', default: today, required: true, list: true },
      { name: 'amount', label: 'Amount', type: 'money', required: true, list: true },
      { name: 'method', label: 'Method', type: 'select', options: ['cash', 'check', 'card', 'ach', 'other'], optionLabels: PAYMENT_METHODS, default: 'check', list: true },
      { name: 'reference', label: 'Check # / reference', type: 'text', list: true },
      { name: 'notes', label: 'Notes', type: 'textarea', full: true },
    ],
  },

  expenses: {
    label: 'Expenses', singular: 'Expense', labelExpr: 'description',
    read: OFFICE, write: OFFICE, order: 'date DESC, id DESC', dateField: 'date',
    search: ['vendor', 'description', 'category', 'notes'],
    fields: [
      { name: 'date', label: 'Date', type: 'date', default: today, required: true, list: true },
      { name: 'category', label: 'Category', type: 'select', required: true, list: true, default: 'Parts & equipment', options: EXPENSE_CATEGORIES() },
      { name: 'vendor', label: 'Vendor', type: 'text', list: true },
      { name: 'description', label: 'Description', type: 'text', list: true },
      { name: 'amount', label: 'Amount', type: 'money', required: true, list: true },
      { name: 'payment_method', label: 'Paid with', type: 'select', options: ['card', 'check', 'ach', 'cash', 'other'], default: 'card' },
      { name: 'vehicle_id', label: 'Vehicle', type: 'ref', ref: 'vehicles', onDelete: 'set null', list: true },
      { name: 'technician_id', label: 'Technician', type: 'ref', ref: 'technicians', onDelete: 'set null' },
      { name: 'service_call_id', label: 'Service call', type: 'ref', ref: 'service_calls', onDelete: 'set null' },
      { name: 'notes', label: 'Notes', type: 'textarea', full: true },
    ],
  },
};

function EXPENSE_CATEGORIES() {
  return ['Parts & equipment', 'Fuel', 'Vehicle maintenance', 'Payroll', 'Subcontractors', 'Tools', 'Insurance',
    'Rent & utilities', 'Phone & software', 'Monitoring center fees', 'Marketing', 'Office supplies', 'Licenses & permits', 'Other'];
}

export function fieldDefault(f) {
  return typeof f.default === 'function' ? f.default() : f.default;
}

// Items that come due on a schedule. Shared so the UI can label them.
export const MAINTENANCE = {
  camera_service: { table: 'camera_systems', due: 'next_service', last: 'last_service', intervalField: 'service_interval_months', label: 'Camera system service', system: 'camera' },
  alarm_test: { table: 'alarm_systems', due: 'next_test', last: 'last_test', intervalField: 'test_interval_months', label: 'Alarm system test', system: 'alarm' },
  fire_inspection: { table: 'fire_systems', due: 'next_inspection', last: 'last_inspection', intervalField: 'inspection_interval_months', label: 'Fire system inspection', system: 'fire alarm' },
  ext_annual: { table: 'extinguishers', due: 'next_annual', last: 'last_annual', intervalMonths: 12, label: 'Extinguisher annual inspection', system: 'extinguisher' },
  ext_hydro: { table: 'extinguishers', due: 'next_hydro', last: 'last_hydro', intervalYearsField: 'hydro_interval_years', label: 'Extinguisher hydrostatic test', system: 'extinguisher' },
  ext_6yr: { table: 'extinguishers', due: 'next_6yr', last: 'last_6yr', intervalMonths: 72, label: 'Extinguisher 6-year maintenance', system: 'extinguisher' },
  ext_replace: { table: 'extinguishers', due: 'replace_by', intervalMonths: 144, label: 'Disposable extinguisher replacement', system: 'extinguisher' },
  vehicle_service: { table: 'vehicles', due: 'next_service_date', label: 'Vehicle service', vehicle: true },
  vehicle_registration: { table: 'vehicles', due: 'registration_expires', label: 'Vehicle registration renewal', vehicle: true },
  vehicle_insurance: { table: 'vehicles', due: 'insurance_expires', label: 'Vehicle insurance renewal', vehicle: true },
};
