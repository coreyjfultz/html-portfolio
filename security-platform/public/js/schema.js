// Shared data model. Imported by BOTH the server (to build tables and validate
// writes) and the browser (to build forms and tables). One source of truth.
//
// Field types: text, email, tel, textarea, number, money, date, datetime,
// select, ref, checkbox, secret (encrypted at rest), color, location.

export const ROLES = ['admin', 'office', 'technician'];
const ALL = ['admin', 'office', 'technician'];
const OFFICE = ['admin', 'office'];

const today = () => new Date().toISOString().slice(0, 10);

const customerRef = { name: 'customer_id', label: 'Customer', type: 'ref', ref: 'customers', required: true, list: true, onDelete: 'cascade' };

export const RESOURCES = {
  customers: {
    label: 'Customers', singular: 'Customer', labelExpr: 'name',
    read: ALL, write: OFFICE, order: 'name COLLATE NOCASE',
    search: ['name', 'contact_name', 'email', 'phone', 'alt_phone', 'billing_address', 'service_address', 'account_number', 'city'],
    fields: [
      { name: 'type', label: 'Type', type: 'select', options: ['residential', 'commercial'], required: true, default: 'residential', list: true },
      { name: 'name', label: 'Name / Business name', type: 'text', required: true, list: true },
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
      { name: 'service_address', label: 'Service address (if different)', type: 'text', full: true },
      { name: 'service_city', label: 'Service city', type: 'text' },
      { name: 'service_state', label: 'Service state', type: 'text' },
      { name: 'service_zip', label: 'Service ZIP', type: 'text' },
      { name: 'preferred_payment', label: 'Preferred payment', type: 'select', options: ['check', 'card', 'ach', 'cash'], default: 'check' },
      { name: 'tax_exempt', label: 'Tax exempt', type: 'checkbox' },
      { name: 'gate_code', label: 'Gate / door code', type: 'secret' },
      { name: 'access_notes', label: 'Site access notes (keys, pets, hours)', type: 'textarea', full: true },
      { name: 'notes', label: 'Notes', type: 'textarea', full: true },
    ],
  },

  contacts: {
    label: 'Contacts', singular: 'Contact', labelExpr: 'name',
    read: ALL, write: OFFICE, order: 'is_primary DESC, name',
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
    read: OFFICE, write: OFFICE, order: 'id',
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
      { name: 'location', label: 'Location / building', type: 'text', list: true },
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
      { name: 'location', label: 'Location / building', type: 'text', list: true },
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
      { name: 'system_type', label: 'System type', type: 'select', options: ['fire alarm', 'sprinkler', 'kitchen hood suppression', 'clean agent suppression', 'fire pump', 'emergency lighting', 'other'], default: 'fire alarm', list: true },
      { name: 'location', label: 'Location / building', type: 'text', list: true },
      { name: 'panel_brand', label: 'Panel / equipment brand', type: 'text' },
      { name: 'panel_model', label: 'Model', type: 'text' },
      { name: 'monitoring_account', label: 'Monitoring account #', type: 'text' },
      { name: 'panel_code', label: 'Panel access code', type: 'secret' },
      { name: 'device_count', label: '# of devices / heads', type: 'number' },
      { name: 'ahj', label: 'AHJ (fire marshal / jurisdiction)', type: 'text' },
      { name: 'install_date', label: 'Installed', type: 'date' },
      { name: 'last_inspection', label: 'Last inspection', type: 'date' },
      { name: 'next_inspection', label: 'Next inspection due', type: 'date', list: true },
      { name: 'inspection_interval_months', label: 'Inspection interval (months)', type: 'number', default: 12, help: '6 for kitchen hoods, 12 for most alarm/sprinkler' },
      { name: 'notes', label: 'Notes', type: 'textarea', full: true },
    ],
  },

  extinguishers: {
    label: 'Fire extinguishers', singular: 'Fire extinguisher', labelExpr: "COALESCE(NULLIF(location,''), ext_type)",
    read: ALL, write: ALL, order: 'location',
    fields: [
      customerRef,
      { name: 'location', label: 'Location (e.g. Kitchen by exit)', type: 'text', list: true },
      { name: 'ext_type', label: 'Type', type: 'select', options: ['ABC dry chemical', 'BC dry chemical', 'CO2', 'Class K (wet chemical)', 'Water', 'Clean agent', 'Class D'], default: 'ABC dry chemical', list: true },
      { name: 'size', label: 'Size', type: 'text', list: true, help: 'e.g. 5 lb, 10 lb' },
      { name: 'serial', label: 'Serial #', type: 'text' },
      { name: 'manufacture_date', label: 'Manufacture date', type: 'date' },
      { name: 'status', label: 'Status', type: 'select', options: ['in service', 'needs service', 'out of service', 'removed'], default: 'in service', list: true },
      { name: 'last_annual', label: 'Last annual inspection', type: 'date' },
      { name: 'next_annual', label: 'Next annual due', type: 'date', list: true },
      { name: 'last_6yr', label: 'Last 6-year maintenance', type: 'date' },
      { name: 'last_hydro', label: 'Last hydrostatic test', type: 'date' },
      { name: 'next_hydro', label: 'Next hydro test due', type: 'date', list: true },
      { name: 'hydro_interval_years', label: 'Hydro interval (years)', type: 'number', default: 12, help: '5 for CO2/water/Class K, 12 for dry chemical' },
      { name: 'notes', label: 'Notes', type: 'textarea', full: true },
    ],
  },

  technicians: {
    label: 'Technicians', singular: 'Technician', labelExpr: 'name',
    read: ALL, write: OFFICE, order: 'active DESC, name',
    search: ['name', 'phone', 'email', 'skills'],
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, list: true },
      { name: 'phone', label: 'Phone', type: 'tel', list: true },
      { name: 'email', label: 'Email', type: 'email', list: true },
      { name: 'skills', label: 'Skills / certifications', type: 'text', list: true, help: 'e.g. NICET II, cameras, access control' },
      { name: 'color', label: 'Calendar color', type: 'color', default: '#2563eb' },
      { name: 'hourly_cost', label: 'Hourly cost to company', type: 'money', help: 'Wage + taxes/benefits. Used for profit estimates.' },
      { name: 'bill_rate', label: 'Default billing rate / hr', type: 'money' },
      { name: 'active', label: 'Active', type: 'checkbox', default: 1, list: true },
      { name: 'notes', label: 'Notes', type: 'textarea', full: true },
    ],
  },

  vehicles: {
    label: 'Vehicles', singular: 'Vehicle', labelExpr: 'unit_name',
    read: ALL, write: OFFICE, order: 'unit_name',
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
      { name: 'next_service_miles', label: 'Next service at (miles)', type: 'number' },
      { name: 'next_service_date', label: 'Next service date', type: 'date' },
      { name: 'registration_expires', label: 'Registration expires', type: 'date' },
      { name: 'insurance_expires', label: 'Insurance expires', type: 'date' },
      { name: 'notes', label: 'Notes', type: 'textarea', full: true },
    ],
  },

  inventory_items: {
    label: 'Inventory items', singular: 'Inventory item', labelExpr: "name || CASE WHEN COALESCE(sku,'') <> '' THEN ' (' || sku || ')' ELSE '' END",
    read: ALL, write: OFFICE, order: 'category, name',
    search: ['sku', 'name', 'manufacturer', 'category'],
    fields: [
      { name: 'sku', label: 'SKU / part #', type: 'text', list: true },
      { name: 'name', label: 'Item name', type: 'text', required: true, list: true },
      { name: 'category', label: 'Category', type: 'select', options: ['cameras', 'recorders', 'alarm panels', 'sensors & detectors', 'fire alarm devices', 'extinguishers', 'access control', 'cable & wire', 'power & batteries', 'networking', 'hardware', 'other'], default: 'other', list: true },
      { name: 'manufacturer', label: 'Manufacturer', type: 'text' },
      { name: 'unit_cost', label: 'Unit cost', type: 'money', list: true },
      { name: 'unit_price', label: 'Sell price', type: 'money', list: true },
      { name: 'reorder_level', label: 'Reorder when total below', type: 'number', default: 0 },
      { name: 'vendor_skus', label: 'Distributor part #s', type: 'text', full: true, help: 'Other part numbers this item appears under on supplier invoices, comma-separated. Learned automatically when you match an invoice line.' },
      { name: 'active', label: 'Active', type: 'checkbox', default: 1 },
      { name: 'notes', label: 'Notes', type: 'textarea', full: true },
    ],
  },

  // Supplier invoices / packing slips that arrive by email or are scanned in.
  purchase_invoices: {
    label: 'Supplier invoices', singular: 'Supplier invoice', labelExpr: "COALESCE(NULLIF(vendor,''), 'Supplier') || ' #' || COALESCE(invoice_number, id)",
    read: ['admin', 'office'], write: ['admin', 'office'], order: 'id DESC', dateField: 'invoice_date',
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
    read: ['admin', 'office'], write: ['admin', 'office'], order: 'id',
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

  service_calls: {
    label: 'Service calls', singular: 'Service call', labelExpr: "'SC-' || number || ' ' || title",
    read: ALL, write: ALL, order: 'COALESCE(scheduled_start, created_at) DESC', dateField: 'scheduled_start',
    search: ['number', 'title', 'description', 'resolution'],
    fields: [
      { name: 'number', label: 'Call #', type: 'text', readonly: true, list: true },
      customerRef,
      { name: 'title', label: 'Summary', type: 'text', required: true, list: true, full: true },
      { name: 'call_type', label: 'Call type', type: 'select', options: ['service', 'installation', 'maintenance', 'inspection', 'estimate', 'warranty'], default: 'service', list: true },
      { name: 'system_type', label: 'System', type: 'select', options: ['camera', 'alarm', 'fire alarm', 'sprinkler', 'extinguisher', 'access control', 'other'], default: 'alarm' },
      { name: 'priority', label: 'Priority', type: 'select', options: ['low', 'normal', 'high', 'emergency'], default: 'normal', list: true },
      { name: 'status', label: 'Status', type: 'select', options: ['new', 'scheduled', 'in progress', 'on hold', 'completed', 'cancelled'], default: 'new', list: true },
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
      { name: 'method', label: 'Method', type: 'select', options: ['check', 'card', 'ach', 'cash', 'other'], default: 'check', list: true },
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
  vehicle_service: { table: 'vehicles', due: 'next_service_date', label: 'Vehicle service', vehicle: true },
  vehicle_registration: { table: 'vehicles', due: 'registration_expires', label: 'Vehicle registration renewal', vehicle: true },
  vehicle_insurance: { table: 'vehicles', due: 'insurance_expires', label: 'Vehicle insurance renewal', vehicle: true },
};
