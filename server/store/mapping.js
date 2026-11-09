// Maps the app's in-memory data model to Postgres rows (supabase/schema.sql) and back.
//   toRows(db)        -> { table: [row, ...] }   (also assigns ids to activity/audit entries)
//   fromTables(rows)  -> db
// Every entity keeps fields the schema doesn't know about in an `extra` jsonb column,
// so nothing the app stores is lost on a round trip.

const crypto = require('crypto');

// field types: s = text ('' <-> null), r = optional reference/unique text ('' <-> null),
// n = number, i = nullable number, b = boolean, t = timestamp, j = json
const conv = {
  s: { out: (v) => (v === undefined || v === null || v === '' ? null : String(v)), in: (v) => (v == null ? '' : v) },
  r: { out: (v) => (v === undefined || v === null || v === '' ? null : String(v)), in: (v) => (v == null ? '' : v) },
  n: { out: (v) => (v === undefined || v === null || v === '' || isNaN(Number(v)) ? 0 : Number(v)), in: (v) => (v == null ? 0 : Number(v)) },
  i: { out: (v) => (v === undefined || v === null || v === '' || isNaN(Number(v)) ? null : Number(v)), in: (v) => (v == null ? null : Number(v)) },
  b: { out: (v) => !!v, in: (v) => !!v },
  t: { out: (v) => (v ? new Date(v).toISOString() : null), in: (v) => (v ? new Date(v).toISOString() : null) },
  j: { out: (v) => (v === undefined ? null : v), in: (v) => (v === undefined ? null : v) },
};

// [jsKey, column, type]
// [db key, table, sort] for the collections added in migration 005
const SIMPLE = [
  ['invoices', 'invoices', 'issued_at'], ['payments', 'payments', 'at'], ['suppliers', 'suppliers', 'id'],
  ['purchaseOrders', 'purchase_orders', 'at'], ['supplierPayments', 'supplier_payments', 'at'], ['purchaseReturns', 'purchase_returns', 'at'],
  ['messages', 'messages', 'at'], ['publicLinks', 'public_links', 'created_at'], ['appointments', 'appointments', 'at'], ['timeEntries', 'time_entries', 'started_at'], ['attachments', 'attachments', 'at'],
];
const SPECS = {
  invoices: { key: 'id', fields: [['id', 'id', 's'], ['kind', 'kind', 's'], ['jobId', 'job_id', 'r'], ['payer', 'payer', 's'], ['issuedAt', 'issued_at', 't'], ['dueAt', 'due_at', 't'], ['status', 'status', 's'], ['subtotal', 'subtotal', 'n'], ['gst', 'gst', 'n'], ['total', 'total', 'n'], ['billTo', 'bill_to', 'j'], ['lines', 'lines', 'j']] },
  payments: { key: 'id', fields: [['id', 'id', 's'], ['at', 'at', 't'], ['invoiceId', 'invoice_id', 's'], ['kind', 'kind', 's'], ['method', 'method', 's'], ['amount', 'amount', 'n']] },
  suppliers: { key: 'id', fields: [['id', 'id', 's'], ['name', 'name', 's'], ['abn', 'abn', 'r'], ['phone', 'phone', 's'], ['email', 'email', 's'], ['active', 'active', 'b']] },
  purchase_orders: { key: 'id', fields: [['id', 'id', 's'], ['supplierId', 'supplier_id', 's'], ['at', 'at', 't'], ['status', 'status', 's'], ['lines', 'lines', 'j']] },
  supplier_payments: { key: 'id', fields: [['id', 'id', 's'], ['at', 'at', 't'], ['inwardId', 'inward_id', 's'], ['amount', 'amount', 'n'], ['method', 'method', 's']] },
  purchase_returns: { key: 'id', fields: [['id', 'id', 's'], ['at', 'at', 't'], ['inwardId', 'inward_id', 's'], ['totalInc', 'total_inc', 'n'], ['lines', 'lines', 'j']] },
  messages: { key: 'id', fields: [['id', 'id', 's'], ['at', 'at', 't'], ['channel', 'channel', 's'], ['to', 'recipient', 's'], ['status', 'status', 's'], ['jobId', 'job_id', 'r'], ['body', 'body', 's']] },
  public_links: { key: 'token', fields: [['token', 'token', 's'], ['kind', 'kind', 's'], ['ref', 'ref', 's'], ['createdAt', 'created_at', 't'], ['expiresAt', 'expires_at', 't']] },
  appointments: { key: 'id', fields: [['id', 'id', 's'], ['at', 'at', 't'], ['vin', 'vin', 'r'], ['rego', 'rego', 's'], ['customerName', 'customer_name', 's'], ['status', 'status', 's'], ['jobId', 'job_id', 'r']] },
  attachments: { key: 'id', fields: [['id', 'id', 's'], ['jobId', 'job_id', 's'], ['vin', 'vin', 'r'], ['name', 'name', 's'], ['type', 'type', 's'], ['size', 'size', 'n'], ['path', 'path', 's'], ['at', 'at', 't']] },
  time_entries: { key: 'id', fields: [['id', 'id', 's'], ['jobId', 'job_id', 's'], ['userId', 'user_id', 's'], ['start', 'started_at', 't'], ['end', 'ended_at', 't']] },
  repair_types: { key: 'id', fields: [['id', 'id', 's'], ['name', 'name', 's'], ['code', 'code', 's'], ['description', 'description', 's'], ['active', 'active', 'b']] },
  fuel_types: { key: 'id', fields: [['id', 'id', 's'], ['name', 'name', 's'], ['active', 'active', 'b']] },
  transmission_types: { key: 'id', fields: [['id', 'id', 's'], ['name', 'name', 's'], ['description', 'description', 's'], ['active', 'active', 'b']] },
  stock_inwards: { key: 'id', fields: [['id', 'id', 's'], ['at', 'at', 't'], ['supplier', 'supplier', 's'], ['invoiceNo', 'invoice_no', 's'], ['invoiceDate', 'invoice_date', 't'], ['by', 'by', 's'], ['remarks', 'remarks', 's'], ['total', 'total', 'n']] },
  stock_batches: { key: 'id', fields: [['id', 'id', 's'], ['partNo', 'part_no', 's'], ['inwardId', 'inward_id', 'r'], ['receivedAt', 'received_at', 't'], ['qty', 'qty', 'n'], ['remaining', 'remaining', 'n'], ['unitCost', 'unit_cost', 'n'], ['supplier', 'supplier', 's']] },
  stock_adjustments: { key: 'id', fields: [['id', 'id', 's'], ['at', 'at', 't'], ['type', 'type', 's'], ['reason', 'reason', 's'], ['remarks', 'remarks', 's'], ['by', 'by', 's'], ['value', 'value', 'n'], ['lines', 'lines', 'j']] },
  stock_issues: { key: 'id', fields: [['id', 'id', 's'], ['at', 'at', 't'], ['kind', 'kind', 's'], ['jobId', 'job_id', 's'], ['lineId', 'line_id', 'n'], ['partNo', 'part_no', 's'], ['qty', 'qty', 'n'], ['cost', 'cost', 'n'], ['by', 'by', 's'], ['reason', 'reason', 's'], ['allocations', 'allocations', 'j']] },
  rights: { key: 'code', fields: [['code', 'code', 's'], ['module', 'module', 's'], ['name', 'name', 's'], ['description', 'description', 's'], ['system', 'system', 'b'], ['active', 'active', 'b']] },
  roles: { key: 'id', fields: [['id', 'id', 's'], ['name', 'name', 's'], ['description', 'description', 's'], ['system', 'system', 'b'], ['active', 'active', 'b']], skip: ['rights'] },
  users: { key: 'id', fields: [['id', 'id', 's'], ['name', 'name', 's'], ['role', 'role', 's'], ['phone', 'phone', 's'], ['email', 'email', 's'], ['active', 'active', 'b']] },
  provinces: { key: 'id', fields: [['id', 'id', 's'], ['name', 'name', 's'], ['code', 'code', 's'], ['gstStateCode', 'gst_state_code', 's'], ['country', 'country', 's'], ['active', 'active', 'b']] },
  cities: { key: 'id', fields: [['id', 'id', 's'], ['name', 'name', 's'], ['provinceId', 'province_id', 'r'], ['active', 'active', 'b']] },
  dealers: { key: 'id', fields: [['id', 'id', 's'], ['name', 'name', 's'], ['code', 'code', 's'], ['gstin', 'gstin', 'r'], ['provinceId', 'province_id', 'r'], ['cityId', 'city_id', 'r'], ['address', 'address', 's'], ['contactPerson', 'contact_person', 's'], ['phone', 'phone', 's'], ['email', 'email', 's'], ['active', 'active', 'b']] },
  outlets: { key: 'id', fields: [['id', 'id', 's'], ['name', 'name', 's'], ['code', 'code', 's'], ['dealerId', 'dealer_id', 'r'], ['type', 'type', 's'], ['cityId', 'city_id', 'r'], ['address', 'address', 's'], ['phone', 'phone', 's'], ['bays', 'bays', 'n'], ['active', 'active', 'b']] },
  insurers: { key: 'id', fields: [['id', 'id', 's'], ['name', 'name', 's'], ['code', 'code', 's'], ['contactPerson', 'contact_person', 's'], ['phone', 'phone', 's'], ['email', 'email', 's'], ['address', 'address', 's'], ['gstin', 'gstin', 'r'], ['cashless', 'cashless', 'b'], ['active', 'active', 'b']] },
  parts: { key: 'part_no', fields: [['no', 'part_no', 's'], ['description', 'description', 's'], ['unit', 'unit', 's'], ['category', 'category', 's'], ['brand', 'brand', 's'], ['source', 'source', 's'], ['mrp', 'mrp', 'n'], ['hsn', 'hsn', 'r'], ['gstPct', 'gst_pct', 'n'], ['stock', 'stock', 'n'], ['reorderLevel', 'reorder_level', 'n'], ['supersededBy', 'superseded_by', 'r'], ['alternateFor', 'alternate_for', 'r'], ['active', 'active', 'b']] },
  labour_ops: { key: 'code', fields: [['code', 'code', 's'], ['group', 'op_group', 's'], ['description', 'description', 's'], ['minutes', 'minutes', 'n'], ['rate', 'rate', 'n'], ['sacCode', 'sac_code', 'r'], ['active', 'active', 'b']] },
  packages: { key: 'code', fields: [['code', 'code', 's'], ['name', 'name', 's'], ['group', 'pkg_group', 's']], skip: ['parts', 'labour'] },
  campaigns: { key: 'id', fields: [['id', 'id', 's'], ['name', 'name', 's'], ['type', 'type', 's'], ['validTill', 'valid_till', 't'], ['discountPct', 'discount_pct', 'n']] },
  customers: { key: 'id', fields: [['customerId', 'id', 's'], ['name', 'name', 's'], ['phone', 'phone', 's'], ['phone2', 'phone2', 's'], ['email', 'email', 's'], ['email2', 'email2', 's'], ['address', 'address', 's'], ['type', 'type', 's'], ['entity', 'entity', 's'], ['vip', 'vip', 'b']] },
  vehicles: { key: 'vin', fields: [['vin', 'vin', 's'], ['reg', 'reg', 'r'], ['model', 'model', 's'], ['variant', 'variant', 's'], ['color', 'color', 's'], ['hex', 'hex', 's'], ['engine', 'engine', 's'], ['fuel', 'fuel', 's'], ['transmission', 'transmission', 's'], ['saleDate', 'sale_date', 't'], ['warrantyTill', 'warranty_till', 't'], ['sellingDealer', 'selling_dealer', 's'], ['alerts', 'alerts', 'j'], ['plans', 'plans', 'j'], ['tickets', 'tickets', 'j']], skip: ['owner', 'insurance', 'history'] },
  service_history: { key: ['vin', 'job_number'], fields: [['jobNumber', 'job_number', 's'], ['dealer', 'dealer', 's'], ['location', 'location', 's'], ['type', 'type', 's'], ['odometer', 'odometer', 'i'], ['openedAt', 'opened_at', 't'], ['closedAt', 'closed_at', 't'], ['advisor', 'advisor', 's'], ['rating', 'rating', 'i'], ['amount', 'amount', 'i'], ['parts', 'parts', 'j'], ['labour', 'labour', 'j'], ['remarks', 'remarks', 's']] },
  job_cards: { key: 'id', fields: [['id', 'id', 's'], ['vin', 'vin', 's'], ['status', 'status', 's'], ['stage', 'stage', 's'], ['jobType', 'job_type', 's'], ['odometer', 'odometer', 'i'], ['odometerFaulty', 'odometer_faulty', 'b'], ['fuelLevel', 'fuel_level', 'i'], ['drivenBy', 'driven_by', 's'], ['customerWaiting', 'customer_waiting', 'b'], ['repeatRepair', 'repeat_repair', 'b'], ['lift', 'lift', 'b'], ['serviceVan', 'service_van', 's'], ['advisor', 'advisor', 's'], ['technician', 'technician', 's'], ['bay', 'bay', 's'], ['arrivedAt', 'arrived_at', 't'], ['promisedAt', 'promised_at', 't'], ['extras', 'extras', 'j'], ['campaigns', 'campaigns', 'j'], ['inspection', 'inspection', 'j'], ['damages', 'damages', 'j'], ['feedback', 'feedback', 'j'], ['proforma', 'proforma', 'j'], ['invoice', 'invoice', 'j'], ['approval', 'approval', 'j']], skip: ['concerns', 'lines', 'activity'] },
  job_concerns: { key: ['job_id', 'id'], fields: [['id', 'id', 'n'], ['kind', 'kind', 's'], ['text', 'text', 's'], ['observation', 'observation', 's']] },
  job_lines: { key: ['job_id', 'id'], fields: [['id', 'id', 'n'], ['kind', 'kind', 's'], ['code', 'code', 's'], ['description', 'description', 's'], ['qty', 'qty', 'n'], ['rate', 'rate', 'n'], ['discountPct', 'discount_pct', 'n'], ['status', 'status', 's'], ['blocked', 'blocked', 'b'], ['remarks', 'remarks', 's'], ['reason', 'reason', 's'], ['concernId', 'concern_id', 'i'], ['issuedQty', 'issued_qty', 'n'], ['issueCost', 'issue_cost', 'i']] },
  job_activity: { key: 'id', fields: [['id', 'id', 's'], ['at', 'at', 't'], ['by', 'by', 's'], ['text', 'text', 's']] },
  audit_log: { key: 'id', fields: [['id', 'id', 's'], ['at', 'at', 't'], ['by', 'by', 's'], ['text', 'text', 's']] },
};
const KEYS = { settings: ['key'], role_rights: ['role_id', 'right_code'], package_items: ['package_code', 'kind', 'item_code'] };
for (const [t, s] of Object.entries(SPECS)) KEYS[t] = [].concat(s.key);

const newId = (p) => p + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');

function rowOf(table, obj, add = {}) {
  const s = SPECS[table];
  const row = {};
  const known = new Set([...s.fields.map((f) => f[0]), ...(s.skip || [])]);
  for (const [k, col, type] of s.fields) row[col] = conv[type].out(obj[k]);
  const extra = {};
  for (const k of Object.keys(obj)) if (!known.has(k) && obj[k] !== undefined) extra[k] = obj[k];
  row.extra = extra;
  return Object.assign(row, add);
}
function objOf(table, row) {
  const s = SPECS[table];
  const obj = {};
  for (const [k, col, type] of s.fields) obj[k] = conv[type].in(row[col]);
  return Object.assign(obj, row.extra || {});
}

const COLLECTIONS = ['attachments', 'invoices', 'payments', 'suppliers', 'purchaseOrders', 'supplierPayments', 'purchaseReturns', 'messages', 'publicLinks', 'appointments', 'timeEntries', 'repairTypes', 'fuelTypes', 'transmissions', 'stockInwards', 'stockBatches', 'stockIssues', 'stockAdjustments', 'rights', 'roles', 'users', 'provinces', 'cities', 'dealers', 'outlets', 'insurers', 'vehicles', 'jobcards', 'audit', 'catalog'];
const CATALOG = ['parts', 'labour', 'packages', 'campaigns'];

function toRows(db) {
  const t = {};
  t.settings = Object.keys(db).filter((k) => !COLLECTIONS.includes(k)).map((k) => ({ key: k, value: db[k] }));
  for (const k of Object.keys(db.catalog || {})) if (!CATALOG.includes(k)) t.settings.push({ key: 'catalog.' + k, value: db.catalog[k] });
  t.repair_types = (db.repairTypes || []).map((o) => rowOf('repair_types', o));
  t.fuel_types = (db.fuelTypes || []).map((o) => rowOf('fuel_types', o));
  t.transmission_types = (db.transmissions || []).map((o) => rowOf('transmission_types', o));
  t.stock_inwards = (db.stockInwards || []).map((o) => rowOf('stock_inwards', o));
  t.stock_batches = (db.stockBatches || []).map((o) => rowOf('stock_batches', o));
  t.stock_issues = (db.stockIssues || []).map((o) => rowOf('stock_issues', o));
  t.stock_adjustments = (db.stockAdjustments || []).map((o) => rowOf('stock_adjustments', o));
  for (const [k, table] of SIMPLE) t[table] = (db[k] || []).map((o) => rowOf(table, o));
  t.rights = (db.rights || []).map((o, i) => rowOf('rights', o, { pos: i }));
  t.roles = (db.roles || []).map((o) => rowOf('roles', o));
  t.role_rights = (db.roles || []).flatMap((r) => [...new Set(r.rights || [])].map((c) => ({ role_id: r.id, right_code: c })));
  for (const m of ['users', 'provinces', 'cities', 'dealers', 'outlets', 'insurers']) t[m] = (db[m] || []).map((o) => rowOf(m, o));
  const cat = db.catalog || {};
  t.parts = (cat.parts || []).map((o) => rowOf('parts', o));
  t.labour_ops = (cat.labour || []).map((o) => rowOf('labour_ops', o));
  t.packages = (cat.packages || []).map((o) => rowOf('packages', o));
  t.package_items = (cat.packages || []).flatMap((p) => [
    ...(p.parts || []).map(([no, qty], i) => ({ package_code: p.code, kind: 'part', item_code: no, qty: Number(qty) || 1, pos: i })),
    ...(p.labour || []).map((code, i) => ({ package_code: p.code, kind: 'labour', item_code: code, qty: 1, pos: 100 + i })),
  ]);
  t.campaigns = (cat.campaigns || []).map((o) => rowOf('campaigns', o));

  const insurerByName = new Map((db.insurers || []).map((i) => [String(i.name).toLowerCase(), i.id]));
  const customers = new Map();
  t.vehicles = [];
  t.service_history = [];
  for (const v of db.vehicles || []) {
    const owner = v.owner || {};
    if (!owner.customerId) owner.customerId = 'C-' + v.vin;
    if (!v.owner) v.owner = owner;
    customers.set(owner.customerId, rowOf('customers', owner));
    const ins = v.insurance || {};
    t.vehicles.push(rowOf('vehicles', v, {
      customer_id: owner.customerId,
      insurer_id: ins.company ? insurerByName.get(String(ins.company).toLowerCase()) || null : null,
      insurance_company: ins.company || null,
      policy_no: ins.policyNo || null,
      insurance_valid_till: conv.t.out(ins.validTill),
    }));
    (v.history || []).forEach((h, i) => t.service_history.push(rowOf('service_history', h, { vin: v.vin, pos: i })));
  }
  // drop duplicate history keys (keep first) – the table key is (vin, job_number)
  const seenH = new Set();
  t.service_history = t.service_history.filter((r) => { const k = r.vin + '|' + r.job_number; if (seenH.has(k)) return false; seenH.add(k); return true; });
  t.customers = [...customers.values()];

  const userByName = new Map((db.users || []).map((u) => [String(u.name).toLowerCase(), u.id]));
  const uid = (n) => (n ? userByName.get(String(n).toLowerCase()) || null : null);
  t.job_cards = [];
  t.job_concerns = [];
  t.job_lines = [];
  t.job_activity = [];
  for (const j of db.jobcards || []) {
    t.job_cards.push(rowOf('job_cards', j, { advisor_id: uid(j.advisor), technician_id: uid(j.technician) }));
    for (const c of j.concerns || []) t.job_concerns.push(rowOf('job_concerns', c, { job_id: j.id }));
    for (const l of j.lines || []) t.job_lines.push(rowOf('job_lines', l, { job_id: j.id }));
    for (const a of j.activity || []) {
      if (!a.id) a.id = newId('A');
      t.job_activity.push(rowOf('job_activity', a, { job_id: j.id }));
    }
  }
  t.audit_log = (db.audit || []).map((a) => {
    if (!a.id) a.id = newId('L');
    return rowOf('audit_log', a);
  });
  return t;
}

const byDesc = (k) => (a, b) => String(b[k] || '').localeCompare(String(a[k] || ''));
const byAsc = (k) => (a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0);

function fromTables(t) {
  const db = {};
  for (const s of t.settings || []) {
    if (s.key.startsWith('catalog.')) continue;
    db[s.key] = s.value;
  }
  for (const [table, key, sortKey] of [['repair_types', 'repairTypes', 'id'], ['fuel_types', 'fuelTypes', 'id'], ['transmission_types', 'transmissions', 'id']]) {
    if (t[table] && t[table].length) db[key] = t[table].sort(byAsc(sortKey)).map((r) => objOf(table, r));
  }
  if (t.stock_batches && (t.stock_batches.length || (t.stock_inwards || []).length)) {
    db.stockInwards = (t.stock_inwards || []).sort((a, b) => new Date(b.at) - new Date(a.at)).map((r) => objOf('stock_inwards', r));
    db.stockBatches = t.stock_batches.sort((a, b) => new Date(a.received_at) - new Date(b.received_at) || (a.id > b.id ? 1 : -1)).map((r) => objOf('stock_batches', r));
    db.stockAdjustments = (t.stock_adjustments || []).sort((a, b) => new Date(b.at) - new Date(a.at) || (a.id < b.id ? 1 : -1)).map((r) => objOf('stock_adjustments', r));
    db.stockIssues = (t.stock_issues || []).sort((a, b) => new Date(b.at) - new Date(a.at) || (a.id < b.id ? 1 : -1)).map((r) => objOf('stock_issues', r));
  }
  if (t.rights && t.rights.length) db.rights = t.rights.sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0)).map((r) => objOf('rights', r));
  if (t.roles && t.roles.length) {
    const rr = t.role_rights || [];
    const order = new Map((db.rights || []).map((r, i) => [r.code, i]));
    db.roles = t.roles.sort(byAsc('id')).map((r) => Object.assign(objOf('roles', r), {
      rights: rr.filter((x) => x.role_id === r.id).map((x) => x.right_code).sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999)),
    }));
  }
  for (const m of ['users', 'provinces', 'cities', 'dealers', 'outlets', 'insurers']) db[m] = (t[m] || []).sort(byAsc(SPECS[m].key)).map((r) => objOf(m, r));
  const items = t.package_items || [];
  db.catalog = {
    parts: (t.parts || []).sort(byAsc('part_no')).map((r) => objOf('parts', r)),
    labour: (t.labour_ops || []).sort(byAsc('code')).map((r) => objOf('labour_ops', r)),
    packages: (t.packages || []).sort(byAsc('code')).map((r) => {
      const mine = items.filter((x) => x.package_code === r.code).sort(byAsc('pos'));
      return Object.assign(objOf('packages', r), {
        parts: mine.filter((x) => x.kind === 'part').map((x) => [x.item_code, Number(x.qty)]),
        labour: mine.filter((x) => x.kind === 'labour').map((x) => x.item_code),
      });
    }),
    campaigns: (t.campaigns || []).sort(byAsc('id')).map((r) => objOf('campaigns', r)),
  };
  for (const s of t.settings || []) if (s.key.startsWith('catalog.')) db.catalog[s.key.slice(8)] = s.value;

  const customers = new Map((t.customers || []).map((c) => [c.id, objOf('customers', c)]));
  const history = new Map();
  for (const h of (t.service_history || []).sort(byAsc('pos'))) {
    if (!history.has(h.vin)) history.set(h.vin, []);
    history.get(h.vin).push(objOf('service_history', h));
  }
  db.vehicles = (t.vehicles || []).sort(byAsc('vin')).map((r) => {
    const v = objOf('vehicles', r);
    v.owner = customers.get(r.customer_id) || { customerId: r.customer_id || '', name: '' };
    v.insurance = r.insurance_company || r.policy_no ? { company: r.insurance_company || '', policyNo: r.policy_no || '', validTill: conv.t.in(r.insurance_valid_till) } : null;
    v.history = history.get(r.vin) || [];
    return v;
  });

  const group = (rows, sort) => {
    const m = new Map();
    for (const r of rows.sort(sort)) {
      if (!m.has(r.job_id)) m.set(r.job_id, []);
      m.get(r.job_id).push(r);
    }
    return m;
  };
  const concerns = group(t.job_concerns || [], byAsc('id'));
  const lines = group(t.job_lines || [], byAsc('id'));
  const activity = group(t.job_activity || [], (a, b) => new Date(b.at) - new Date(a.at));
  db.jobcards = (t.job_cards || []).sort((a, b) => new Date(b.arrived_at) - new Date(a.arrived_at)).map((r) => {
    const j = objOf('job_cards', r);
    j.concerns = (concerns.get(r.id) || []).map((x) => objOf('job_concerns', x));
    j.lines = (lines.get(r.id) || []).map((x) => objOf('job_lines', x));
    j.activity = (activity.get(r.id) || []).map((x) => objOf('job_activity', x));
    return j;
  });
  db.audit = (t.audit_log || []).sort((a, b) => new Date(b.at) - new Date(a.at)).map((r) => objOf('audit_log', r));
  for (const [k, table, sortKey] of SIMPLE) {
    if (!t[table]) continue;
    const rows = [...t[table]].sort((a, b) => (sortKey === 'id' ? String(a.id).localeCompare(String(b.id)) : Date.parse(b[sortKey] || 0) - Date.parse(a[sortKey] || 0)));
    db[k] = rows.map((r) => objOf(table, r));
  }
  return db;
}

module.exports = { toRows, fromTables, KEYS, TABLE_ORDER: Object.keys(KEYS) };
