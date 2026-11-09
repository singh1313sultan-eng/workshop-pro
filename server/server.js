// Workshop Management System – REST API + static file server.
// Zero dependencies: run with `node server/server.js` (Node 18+).
// Storage: Supabase (Postgres) when SUPABASE_URL + SUPABASE_SERVICE_KEY are set
// (in the environment or in a .env file); otherwise data/db.json.

const http = require('http');
const fs = require('fs');
const path = require('path');
const seed = require('./seed');
const registerMasters = require('./masters');
const { migrate } = require('./masters');
const SupabaseStore = require('./store/supabase');
const access = require('./access');
const au = require('./au');
const registration = require('./registration');
const stock = require('./stock');
const billingMod = require('./billing');
const purchasing = require('./purchasing');
const reports = require('./reports');
const auth = require('./auth');
const messaging = require('./messaging');
const workshopFloor = require('./workshop');
const extras = require('./extras');
const mastersEngine = require('./masters').engine;

const ROOT = path.join(__dirname, '..');
loadEnvFile(path.join(ROOT, '.env'));
const PORT = Number(process.env.PORT) || 4300;
const PUBLIC = path.join(ROOT, 'public');
// Serverless hosts (Vercel) run several short-lived copies of this server and only /tmp is writable.
const SERVERLESS = !!(process.env.VERCEL || process.env.SERVERLESS);
const DATA_DIR = process.env.DATA_DIR || (SERVERLESS ? '/tmp/workshop-pro' : path.join(ROOT, 'data'));
const DB_FILE = path.join(DATA_DIR, 'db.json');
const STORAGE = process.env.STORAGE || (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY ? 'supabase' : 'file');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const val = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (!(m[1] in process.env)) process.env[m[1]] = val;
  }
}

const STAGES = [
  { key: 'checked_in', label: 'Checked in' },
  { key: 'in_progress', label: 'Work in progress' },
  { key: 'ready_invoice', label: 'Ready for invoicing' },
  { key: 'ready_delivery', label: 'Ready for delivery' },
  { key: 'delivered', label: 'Delivered' },
];
const STAGE_KEYS = STAGES.map((s) => s.key);

/* ------------------------------------------------------------------ storage */
let db;
let dirty = false;
const store = STORAGE === 'supabase' ? new SupabaseStore({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_KEY }) : null;

const isOldIndianDemo = (d) => d && d.workshop && d.workshop.name === 'Isuzu Motors Visakhapatnam' && !(d.meta && d.meta.version >= 2);
async function load() {
  if (store) {
    db = await store.load();
    if (isOldIndianDemo(db)) {
      console.log('Replacing the old Indian demo data with the Australian sample data');
      db = freshDb();
      auth.bootstrap(db, DATA_DIR, (u) => access.isAdminUser(db, u));
      await store.flush(db);
      return;
    }
    if (!db) {
      console.log('Supabase database is empty – loading sample data');
      db = freshDb();
      await store.flush(db);
    } else if (migrate(db, seed())) await store.flush(db);
    if (auth.bootstrap(db, DATA_DIR, (u) => access.isAdminUser(db, u))) await store.flush(db);
    return;
  }
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    db = freshDb();
    writeFile();
  } else {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (isOldIndianDemo(db)) { db = freshDb(); auth.bootstrap(db, DATA_DIR, (u) => access.isAdminUser(db, u)); writeFile(); return; }
    if (migrate(db, seed())) writeFile();
  }
  if (auth.bootstrap(db, DATA_DIR, (u) => access.isAdminUser(db, u))) writeFile();
}
function freshDb() {
  const d = seed();
  migrate(d, seed());
  return d;
}
function writeFile() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}
// Handlers call save() after changing `db`; the request wrapper persists before replying.
function save() {
  if (store) dirty = true;
  else writeFile();
}
async function persist() {
  if (!store || !dirty) return;
  dirty = false;
  try {
    await store.flush(db);
  } catch (e) {
    // keep memory consistent with the database: reload what is actually stored
    console.error('Save failed, reloading from database:', e.message);
    try { db = (await store.load()) || db; } catch (e2) { console.error('Reload failed:', e2.message); }
    throw Object.assign(new Error(`Could not save to the database. Your last change was not saved. (${e.message})`), { status: 503 });
  }
}
// On a serverless host another copy of the server may have changed the data since we loaded it,
// so every API request starts from what is in the database.
let loadedAt = 0;
async function refresh() {
  if (!SERVERLESS || !store) return;
  if (Date.now() - loadedAt < 50) return; // just loaded (cold start)
  db = (await store.load()) || db;
  loadedAt = Date.now();
}
// One write request at a time, so a change and its database write are never interleaved.
let queue = Promise.resolve();
function exclusive(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

/* ------------------------------------------------------------------ helpers */
class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
const bad = (msg, details) => new HttpError(400, msg, details);
const notFound = (what) => new HttpError(404, `${what} not found`);
const conflict = (msg, details) => new HttpError(409, msg, details);

const round2 = (n) => Math.round(n * 100) / 100;
const now = () => new Date().toISOString();
const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v, { min = -Infinity, max = Infinity } = {}) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : NaN;
};
function requireStr(body, key, label = key) {
  const v = str(body[key]);
  if (!v) throw bad(`${label} is required`, { field: key });
  return v;
}
function validDate(v, label) {
  const d = new Date(v);
  if (!v || isNaN(d)) throw bad(`${label} must be a valid date/time`);
  return d.toISOString();
}

const part = (no) => db.catalog.parts.find((p) => p.no === no);
const labour = (code) => db.catalog.labour.find((l) => l.code === code);
const vehicle = (vin) => db.vehicles.find((v) => v.vin === vin);
/* ---------- branches (outlets) ----------
   The browser sends X-Outlet-Id with the branch the user is working at ('all' = every branch).
   Users with outletIds can only work at those branches. Parts stock is shared by all branches. */
let currentOutlet = null; // outlet id, or null = all branches
const allowedOutlets = (u) => (u && Array.isArray(u.outletIds) && u.outletIds.length ? u.outletIds : null);
const defaultOutletId = () => (db.workshop && db.workshop.defaultOutletId) || ((db.outlets || []).find((o) => o.active !== false) || {}).id || null;
function resolveOutlet(req, u) {
  const want = String(req.headers['x-outlet-id'] || '');
  const allowed = allowedOutlets(u);
  const active = (db.outlets || []).filter((o) => o.active !== false).map((o) => o.id);
  if (want === 'all' || !want) return allowed ? (allowed.find((id) => active.includes(id)) || allowed[0]) : want === 'all' ? null : null;
  if (!active.includes(want)) return allowed ? allowed[0] : null;
  if (allowed && !allowed.includes(want)) throw new HttpError(403, 'You are not set up to work at that branch');
  return want;
}
const inOutlet = (j) => !currentOutlet || (j.outletId || defaultOutletId()) === currentOutlet;
const jobsHere = () => db.jobcards.filter(inOutlet);
const findJob = (id) => {
  const j = db.jobcards.find((x) => x.id === id);
  if (!j) throw notFound('Job card');
  const allowed = allowedOutlets(actor);
  if (allowed && !allowed.includes(j.outletId || defaultOutletId())) throw new HttpError(403, `${j.id} belongs to another branch`);
  return j;
};
const activeJobFor = (vin) => db.jobcards.find((j) => j.vin === vin && j.status !== 'closed');
const nextId = (arr) => arr.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1;

let actor = null; // user making the current write request
function log(job, text, by = actor ? actor.name : 'System') {
  job.activity.unshift({ at: now(), by, text });
}
function assertOpen(job) {
  if (job.status === 'closed') throw conflict('This job card is closed. Reopen it to make changes.');
}

function lineAmount(l) {
  return round2(l.qty * l.rate * (1 - (l.discountPct || 0) / 100));
}
function lineTaxPct(l) {
  if (l.taxPct != null) return Number(l.taxPct);
  const item = l.kind === 'part' ? part(l.code) : labour(l.code);
  return item && item.gstPct != null ? Number(item.gstPct) : Number(db.workshop.gstPct) || 0;
}
const tz = () => (db && db.workshop && db.workshop.timezone) || 'Australia/Sydney';
function campaignPct(job) {
  return (job.campaigns || []).filter((c) => c.applied).reduce((s, c) => s + ((db.catalog.campaigns.find((x) => x.id === c.id) || {}).discountPct || 0), 0);
}
function totals(job, mode) {
  // mode: 'estimate' (everything not declined) or 'billing' (approved only)
  const lines = job.lines.filter((l) => (mode === 'billing' ? l.status === 'approved' : l.status !== 'declined'));
  const parts = round2(lines.filter((l) => l.kind === 'part').reduce((s, l) => s + lineAmount(l), 0));
  const lab = round2(lines.filter((l) => l.kind === 'labour').reduce((s, l) => s + lineAmount(l), 0));
  const pct = job.campaigns
    .filter((c) => c.applied)
    .reduce((s, c) => s + ((db.catalog.campaigns.find((x) => x.id === c.id) || {}).discountPct || 0), 0);
  const campaignDiscount = round2((parts * pct) / 100);
  const taxable = round2(parts + lab - campaignDiscount);
  // GST per line (10% or GST-free), campaign discount spread over the part lines
  const tax = round2(lines.reduce((s, l) => s + (lineAmount(l) * (l.kind === 'part' ? 1 - pct / 100 : 1) * lineTaxPct(l)) / 100, 0));
  return { parts, labour: lab, campaignDiscount, taxable, gstPct: db.workshop.gstPct, tax, total: round2(taxable + tax), lineCount: lines.length };
}
function vehicleBrief(v) {
  return v && { vin: v.vin, reg: v.reg, model: v.model, variant: v.variant, color: v.color, hex: v.hex, ownerName: v.owner.name, ownerPhone: v.owner.phone };
}
function jobSummary(j) {
  const v = vehicle(j.vin);
  return {
    id: j.id,
    vin: j.vin,
    vehicle: vehicleBrief(v),
    status: j.status,
    stage: j.stage,
    jobType: j.jobType,
    advisor: j.advisor,
    technician: j.technician,
    bay: j.bay,
    customerWaiting: j.customerWaiting,
    arrivedAt: j.arrivedAt,
    promisedAt: j.promisedAt,
    overdue: j.status !== 'closed' && new Date(j.promisedAt) < new Date(),
    pendingApprovals: j.lines.filter((l) => l.status === 'pending').length,
    estimateTotal: totals(j, 'estimate').total,
  };
}
function jobFull(j) {
  const v = vehicle(j.vin);
  return Object.assign({}, j, {
    vehicle: v,
    summary: jobSummary(j),
    lines: j.lines.map((l) => Object.assign({}, l, { amount: lineAmount(l), stock: l.kind === 'part' ? (part(l.code) || {}).stock ?? null : null })),
    estimate: totals(j, 'estimate'),
    billing: totals(j, 'billing'),
    stages: STAGES,
  });
}
function buildLine(job, { kind, code, qty, discountPct, concernId, status }) {
  if (kind !== 'part' && kind !== 'labour') throw bad('kind must be "part" or "labour"');
  const item = kind === 'part' ? part(code) : labour(code);
  if (!item) throw bad(`Unknown ${kind} code: ${code}`);
  if (item.active === false) throw bad(`${kind === 'part' ? 'Part' : 'Labour operation'} ${code} is inactive in the master`);
  const q = kind === 'labour' ? 1 : num(qty ?? 1, { min: 0.1, max: 999 });
  if (isNaN(q)) throw bad('qty must be a number');
  const d = num(discountPct ?? 0, { min: 0, max: 100 });
  return {
    id: nextId(job.lines),
    kind,
    code,
    description: item.description,
    qty: q,
    rate: kind === 'part' ? item.mrp : item.rate,
    taxPct: item.gstPct != null ? Number(item.gstPct) : Number(db.workshop.gstPct) || 0,
    discountPct: isNaN(d) ? 0 : d,
    status: ['pending', 'approved', 'declined'].includes(status) ? status : 'pending',
    blocked: false,
    remarks: '',
    concernId: concernId ?? null,
    ...(job.claim ? { payer: 'claim' } : {}),
  };
}
function expandPackage(job, code, concernId, status) {
  const pkg = db.catalog.packages.find((p) => p.code === code);
  if (!pkg) throw bad(`Unknown package: ${code}`);
  const out = [];
  for (const [no, q] of pkg.parts) {
    const l = buildLine(job, { kind: 'part', code: no, qty: q, concernId, status });
    job.lines.push(l);
    out.push(l);
  }
  for (const c of pkg.labour) {
    const l = buildLine(job, { kind: 'labour', code: c, concernId, status });
    job.lines.push(l);
    out.push(l);
  }
  return out;
}

/* ------------------------------------------------------------------ routes */
const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$');
  routes.push({ method, re, keys, handler });
};

route('GET', '/api/health', () => ({ ok: true, time: now(), storage: store ? 'supabase' : 'file' }));

/* who am I, and what may I do */
function requestUser(req) {
  return auth.requestUser(req, db, { defaultUser: access.defaultUser, HttpError });
}
// routes anyone may call without signing in
const PUBLIC_ROUTES = [/^\/api\/health$/, /^\/api\/auth\/(mode|login|logout)$/, /^\/api\/public\//];
route('GET', '/api/me', (req) => {
  const user = requestUser(req);
  const role = access.roleOf(db, user) || null;
  return { outletIds: allowedOutlets(user), currentOutlet: user ? resolveOutlet(req, user) : null, user: auth.publicUser(user), mustChangePassword: !!(user && user.mustChangePassword) && auth.MODE() === 'password', authMode: auth.MODE(), role: role && { id: role.id, name: role.name, system: !!role.system }, rights: access.rightsOf(db, user) };
});

/* workshop profile: legal name, ABN, address, bank / PayID, invoice terms … */
const WORKSHOP_FIELDS = {
  name: { label: 'Trading name', required: true, max: 100 }, legalName: { label: 'Legal entity name', required: true, max: 120 }, code: { label: 'Short code', max: 12 },
  abn: { label: 'ABN', type: 'abn', required: true }, address: { label: 'Street address', required: true, max: 150 }, suburb: { label: 'Suburb', required: true, max: 60 },
  state: { label: 'State', type: 'state', required: true }, postcode: { label: 'Postcode', type: 'postcode', required: true }, phone: { label: 'Phone', type: 'phone', required: true },
  email: { label: 'Email', type: 'email', required: true, max: 120 }, website: { label: 'Website', max: 120 }, mvrl: { label: 'Motor vehicle repairer licence', max: 40 },
  labourRate: { label: 'Labour rate per hour (ex GST)', type: 'number', min: 0, max: 10000 }, quoteValidityDays: { label: 'Quotes valid for (days)', type: 'int', min: 1, max: 365 },
  bankName: { label: 'Bank', max: 60 }, bsb: { label: 'BSB', type: 'bsb' }, accountNo: { label: 'Account number', max: 20 }, accountName: { label: 'Account name', max: 120 }, payId: { label: 'PayID', max: 120 },
  invoiceTerms: { label: 'Invoice terms', max: 1500 },
  serviceIntervalMonths: { label: 'Service interval (months)', type: 'int', min: 1, max: 36 }, serviceIntervalKm: { label: 'Service interval (km)', type: 'int', min: 1000, max: 100000 }, logo: { label: 'Logo', type: 'image' }, timezone: { label: 'Time zone', type: 'tz' },
};
route('GET', '/api/settings/workshop', () => db.workshop);
route('PATCH', '/api/settings/workshop', (req, q, p, body) => {
  const next = Object.assign({}, db.workshop);
  for (const [k, f] of Object.entries(WORKSHOP_FIELDS)) {
    if (!(k in body)) continue;
    let v = body[k];
    if (typeof v === 'string') v = v.trim();
    if ((v === '' || v == null) && f.required) throw bad(`${f.label} is required`, { field: k });
    if (v === '' || v == null) { next[k] = ''; continue; }
    switch (f.type) {
      case 'abn': if (!au.validAbn(v)) throw bad('ABN is not valid (11 digits, failed the ATO check)', { field: k }); v = au.formatAbn(v); break;
      case 'state': v = String(v).toUpperCase(); if (!au.STATES.includes(v)) throw bad('State must be one of ' + au.STATES.join(', '), { field: k }); break;
      case 'postcode': if (!/^\d{4}$/.test(String(v))) throw bad('Postcode must be 4 digits', { field: k }); break;
      case 'phone': { const n = au.normPhone(v); if (!n) throw bad('Phone is not a valid Australian number', { field: k }); v = au.formatPhone(n); break; }
      case 'email': if (!/^\S+@\S+\.\S+$/.test(v)) throw bad('Email is not valid', { field: k }); break;
      case 'bsb': { const d = String(v).replace(/\D/g, ''); if (d.length !== 6) throw bad('BSB must be 6 digits', { field: k }); v = d.slice(0, 3) + '-' + d.slice(3); break; }
      case 'number': case 'int': { const n = Number(v); if (!Number.isFinite(n) || n < f.min || n > f.max || (f.type === 'int' && !Number.isInteger(n))) throw bad(`${f.label} must be between ${f.min} and ${f.max}`, { field: k }); v = n; break; }
      case 'image': if (!/^data:image\/(png|jpeg|svg\+xml|webp);base64,/.test(v) || v.length > 400000) throw bad('Logo must be a PNG, JPG, SVG or WebP image under 300 KB', { field: k }); break;
      case 'tz': try { new Intl.DateTimeFormat('en-AU', { timeZone: v }); } catch { throw bad('Unknown time zone', { field: k }); } break;
      default: v = String(v).slice(0, f.max || 200);
    }
    if (k === 'postcode' || k === 'state') { /* checked together below */ }
    next[k] = v;
  }
  if (next.state && next.postcode && !au.validPostcode(next.state, next.postcode)) throw bad(`Postcode ${next.postcode} is not in ${next.state}`, { field: 'postcode' });
  db.workshop = next;
  db.audit = db.audit || [];
  db.audit.unshift({ at: now(), by: actor ? actor.name : 'System', text: 'Workshop profile updated' });
  save();
  return db.workshop;
});

route('GET', '/api/meta', () => {
  const active = db.users.filter((u) => u.active !== false);
  return {
    workshop: db.workshop,
    users: active.map(auth.publicUser),
    outlets: (db.outlets || []).filter((o) => o.active !== false).map((o) => ({ id: o.id, name: o.name, code: o.code })),
    defaultOutletId: defaultOutletId(),
    lookups: Object.assign({}, db.lookups, {
      jobTypes: registration.activeNames(db.repairTypes, db.lookups.jobTypes),
      fuels: registration.activeNames(db.fuelTypes, registration.FUELS),
      transmissions: registration.activeNames(db.transmissions, registration.TRANSMISSIONS),
      technicians: active.filter((u) => u.role === 'Technician').map((u) => u.name),
      advisors: active.filter((u) => u.role === 'Service Advisor').map((u) => u.name),
      insurers: db.insurers.filter((i) => i.active !== false).map((i) => i.name),
    }),
    stages: STAGES,
    campaigns: db.catalog.campaigns,
  };
});

route('GET', '/api/dashboard', () => {
  const open = jobsHere().filter((j) => j.status !== 'closed');
  const today = new Date().toDateString();
  const byStage = Object.fromEntries(STAGE_KEYS.map((k) => [k, jobsHere().filter((j) => j.stage === k).length]));
  const nowD = new Date();
  const revenueMonth = (db.invoices || [])
    .filter((i) => { const d = new Date(i.issuedAt); return d.getMonth() === nowD.getMonth() && d.getFullYear() === nowD.getFullYear(); })
    .reduce((s, i) => s + i.total, 0);
  const owing = (db.invoices || []).filter((i) => i.kind === 'invoice' && i.status === 'issued').reduce((s, i) => s + Math.max(0, billingMod.settle(db, i).balance), 0);
  return {
    kpis: {
      openJobs: open.length,
      dueToday: open.filter((j) => new Date(j.promisedAt).toDateString() === today).length,
      overdue: open.filter((j) => new Date(j.promisedAt) < new Date()).length,
      pendingApprovals: open.reduce((s, j) => s + j.lines.filter((l) => l.status === 'pending').length, 0),
      waitingCustomers: open.filter((j) => j.customerWaiting).length,
      revenueMonth: round2(revenueMonth),
      receivables: round2(owing),
      readyToRelease: jobsHere().filter((j) => j.status === 'closed' && !j.gatePass).length,
      lowStockParts: db.catalog.parts.filter((p) => p.active !== false && p.stock <= (p.reorderLevel || 0)).length,
      openEstimateValue: round2(open.reduce((s, j) => s + totals(j, 'estimate').total, 0)),
    },
    byStage,
    stages: STAGES,
    deliveries: open
      .filter((j) => new Date(j.promisedAt) < new Date(Date.now() + 86400000))
      .sort((a, b) => new Date(a.promisedAt) - new Date(b.promisedAt))
      .map(jobSummary),
    approvals: open.filter((j) => j.lines.some((l) => l.status === 'pending')).map(jobSummary),
    recent: jobsHere()
      .flatMap((j) => j.activity.slice(0, 3).map((a) => Object.assign({ jobId: j.id, reg: vehicle(j.vin)?.reg }, a)))
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, 8),
  };
});

/* vehicles */
/* customers (stored as vehicle owners) and registering a new vehicle */
route('GET', '/api/customers', (req, q) => {
  const term = str(q.get('q')).toLowerCase().replace(/s+/g, '');
  const list = registration.customers(db);
  if (term.length < 2) return [];
  return list
    .filter((c) => [c.customerId, c.name, c.phone, c.phone2, c.email].join('|').toLowerCase().replace(/s+/g, '').includes(term))
    .slice(0, 20);
});
route('POST', '/api/vehicles/check', (req, q, p, body) => {
  const r = registration.buildRegistration(db, body.newVehicle, body.customer, { bad, conflict, str });
  return { ok: true, vin: r.vehicle.vin, reg: r.vehicle.reg, isNewCustomer: r.isNewCustomer, customerId: r.isNewCustomer ? null : r.customer.customerId, customerName: r.customer.name, warnings: r.warnings };
});
route('GET', '/api/vehicles/registration-options', () => ({
  fuels: registration.activeNames(db.fuelTypes, registration.FUELS), transmissions: registration.activeNames(db.transmissions, registration.TRANSMISSIONS), customerTypes: registration.CUSTOMER_TYPES, entities: registration.ENTITIES,
  models: [...new Set(db.vehicles.map((v) => v.model).filter(Boolean))].sort(),
  dealers: db.dealers.filter((d) => d.active !== false).map((d) => d.name),
  insurers: db.insurers.filter((i) => i.active !== false).map((i) => i.name),
}));

route('GET', '/api/vehicles', (req, q) => {
  const term = str(q.get('q')).toLowerCase().replace(/\s+/g, '');
  const list = term
    ? db.vehicles.filter((v) => [v.vin, v.reg, v.engine, v.owner.name, v.owner.phone].join('|').toLowerCase().replace(/\s+/g, '').includes(term))
    : db.vehicles;
  return list.map((v) => Object.assign(vehicleBrief(v), { engine: v.engine, activeJob: activeJobFor(v.vin) ? jobSummary(activeJobFor(v.vin)) : null }));
});
route('GET', '/api/vehicles/:vin', (req, q, p) => {
  const v = vehicle(p.vin);
  if (!v) throw notFound('Vehicle');
  const a = activeJobFor(v.vin);
  return Object.assign({}, v, {
    activeJob: a ? jobSummary(a) : null,
    jobcards: db.jobcards.filter((j) => j.vin === v.vin).map(jobSummary),
    campaigns: db.catalog.campaigns,
  });
});
route('PATCH', '/api/vehicles/:vin/owner', (req, q, p, body) => {
  const v = vehicle(p.vin);
  if (!v) throw notFound('Vehicle');
  const o = v.owner;
  if ('name' in body) o.name = requireStr(body, 'name', 'Owner name');
  for (const k of ['phone', 'phone2']) if (k in body) {
    const raw = str(body[k], 20);
    const ph = raw ? au.normPhone(raw) : '';
    if (raw && !ph) throw bad(`${k === 'phone' ? 'Mobile' : 'Other phone'} is not a valid Australian number`, { field: k });
    if (k === 'phone' && !ph) throw bad('Mobile is required', { field: k });
    o[k] = ph;
  }
  if ('abn' in body) {
    const a = str(body.abn, 20);
    if (a && !au.validAbn(a)) throw bad('ABN is not valid (11 digits, failed the ATO check)', { field: 'abn' });
    o.abn = a ? au.formatAbn(a) : '';
  }
  for (const k of ['smsOptIn', 'emailOptIn']) if (k in body) o[k] = !!body[k];
  if ('accountCustomer' in body || 'paymentTermsDays' in body) {
    if (!access.can(db, actor, 'billing.override')) throw new HttpError(403, 'Setting up account customers needs the right “Release unpaid vehicles / accounts”');
    if ('accountCustomer' in body) o.accountCustomer = !!body.accountCustomer;
    if ('paymentTermsDays' in body) {
      const t = num(body.paymentTermsDays, { min: 0, max: 120 });
      if (isNaN(t) || !Number.isInteger(t)) throw bad('Payment terms must be 0–120 days', { field: 'paymentTermsDays' });
      o.paymentTermsDays = t;
    }
  }
  for (const k of ['email', 'email2']) if (k in body) {
    const e = str(body[k], 120);
    if (e && !/^\S+@\S+\.\S+$/.test(e)) throw bad('Email is not valid', { field: k });
    o[k] = e;
  }
  if ('address' in body) o.address = str(body.address, 300);
  const a = activeJobFor(v.vin);
  if (a) log(a, 'Owner details updated');
  save();
  return v;
});
route('PATCH', '/api/vehicles/:vin/insurance', (req, q, p, body) => {
  const v = vehicle(p.vin);
  if (!v) throw notFound('Vehicle');
  const company = requireStr(body, 'company', 'Insurance company');
  const ins = db.insurers.find((i) => i.name === company);
  if (!ins) throw bad('Choose an insurance company from the master', { field: 'company' });
  if (ins.active === false) throw bad(`${company} is inactive in the insurance master`, { field: 'company' });
  const policyNo = requireStr(body, 'policyNo', 'Policy number');
  const validTill = validDate(body.validTill, 'Valid till');
  v.insurance = { company, policyNo: policyNo.toUpperCase(), validTill };
  const a = activeJobFor(v.vin);
  if (a) log(a, `Insurance updated: ${company}, policy ${v.insurance.policyNo}, valid till ${new Date(validTill).toLocaleDateString('en-AU', { timeZone: tz() })}`);
  save();
  return v;
});
route('POST', '/api/vehicles/:vin/tickets', (req, q, p, body) => {
  const v = vehicle(p.vin);
  if (!v) throw notFound('Vehicle');
  const t = { id: nextId(v.tickets), field: requireStr(body, 'field', 'Field'), details: requireStr(body, 'details', 'Details'), status: 'open', at: now() };
  v.tickets.push(t);
  save();
  return t;
});

/* job cards */
route('GET', '/api/jobcards', (req, q) => {
  const stage = q.get('stage');
  const status = q.get('status');
  const term = str(q.get('q')).toLowerCase().replace(/\s+/g, '');
  return jobsHere()
    .filter((j) => !stage || j.stage === stage)
    .filter((j) => !status || (status === 'open' ? j.status !== 'closed' : j.status === status))
    .filter((j) => {
      if (!term) return true;
      const v = vehicle(j.vin);
      return [j.id, j.vin, v?.reg, v?.owner.name, v?.model].join('|').toLowerCase().replace(/\s+/g, '').includes(term);
    })
    .sort((a, b) => new Date(b.arrivedAt) - new Date(a.arrivedAt))
    .map(jobSummary);
});

route('POST', '/api/jobcards', (req, q, p, body) => {
  // either an existing vehicle (vin) or a new one registered together with the job card
  const reg = body.newVehicle ? registration.buildRegistration(db, body.newVehicle, body.customer, { bad, conflict, str }) : null;
  const v = reg ? reg.vehicle : vehicle(str(body.vin));
  if (!v) throw bad('A valid vehicle (vin) is required', { field: 'vin' });
  const existing = activeJobFor(v.vin);
  if (existing) throw conflict(`Vehicle already has an open job card (${existing.id})`);
  const jobType = requireStr(body, 'jobType', 'Repair type');
  if (!registration.activeNames(db.repairTypes, db.lookups.jobTypes).includes(jobType)) throw bad(`${jobType} is not an active repair type`, { field: 'jobType' });
  const odometer = num(body.odometer, { min: 0, max: 2000000 });
  if (!body.odometerFaulty && (isNaN(odometer) || odometer <= 0)) throw bad('Odometer reading is required', { field: 'odometer' });
  const promisedAt = validDate(body.promisedAt, 'Promised delivery');
  if (new Date(promisedAt) < new Date(Date.now() - 60000)) throw bad('Promised delivery must be in the future', { field: 'promisedAt' });
  const concerns = Array.isArray(body.concerns) ? body.concerns : [];
  if (!concerns.length) throw bad('Add at least one customer concern or recommendation', { field: 'concerns' });
  const approval = body.approval || {};
  if (!approval.signature && !approval.clientUnavailable) throw bad('Customer signature is required (or mark the customer as unavailable)', { field: 'approval' });

  const id = `RO-${new Date().getFullYear()}-${String(db.meta.nextJob++).padStart(5, '0')}`;
  const job = {
    id,
    outletId: currentOutlet || (allowedOutlets(actor) || [])[0] || defaultOutletId(),
    vin: v.vin,
    status: 'active',
    stage: 'checked_in',
    jobType,
    repeatRepair: !!body.repeatRepair,
    lift: body.lift !== false,
    odometer: isNaN(odometer) ? 0 : odometer,
    odometerFaulty: !!body.odometerFaulty,
    fuelLevel: num(body.fuelLevel ?? 2, { min: 0, max: 4 }) || 0,
    drivenBy: str(body.drivenBy) || 'Owner',
    customerWaiting: !!body.customerWaiting,
    extras: { wash: !!body.extras?.wash, interiorClean: !!body.extras?.interiorClean },
    serviceVan: str(body.serviceVan),
    advisor: actor ? actor.name : '',
    technician: '',
    bay: '',
    arrivedAt: now(),
    promisedAt,
    concerns: [],
    lines: [],
    campaigns: db.catalog.campaigns.filter((c) => c.active !== false && (!c.validTill || new Date(c.validTill) > new Date())).map((c) => ({ id: c.id, name: c.name, applied: false })),
    inspection: JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(db.lookups.inspectionSections).map(([k, items]) => [k, items.map((item) => ({ item, ok: true, action: '' }))])))),
    damages: [],
    feedback: null,
    proforma: null,
    invoice: null,
    approval: { signature: approval.signature ? String(approval.signature).slice(0, 400000) : null, clientUnavailable: !!approval.clientUnavailable, remarks: str(approval.remarks, 1000), at: now() },
    activity: [],
  };
  concerns.forEach((c, i) => {
    const text = str(c.text, 200);
    if (!text) throw bad(`Concern ${i + 1} needs a description`);
    const cid = i + 1;
    job.concerns.push({ id: cid, kind: c.kind === 'advice' ? 'advice' : 'voice', text, observation: str(c.observation, 500) });
    const status = c.decision === 'declined' ? 'declined' : c.decision === 'approved' ? 'approved' : 'pending';
    (c.packages || []).forEach((code) => expandPackage(job, code, cid, status));
    (c.lines || []).forEach((l) => job.lines.push(buildLine(job, Object.assign({}, l, { concernId: cid, status }))));
  });
  for (const [i, c] of concerns.entries()) if (!str(c.text, 200)) throw bad(`Concern ${i + 1} needs a description`); // checked above too; keeps saves all-or-nothing
  if (reg) {
    db.vehicles.push(reg.vehicle);
    log(job, `Vehicle registered${reg.isNewCustomer ? ` with new customer ${reg.customer.name} (${reg.customer.customerId})` : ` for existing customer ${reg.customer.name} (${reg.customer.customerId})`}`);
    db.audit = db.audit || [];
    db.audit.unshift({ at: now(), by: actor ? actor.name : 'System', text: `Vehicle ${reg.vehicle.reg} (${reg.vehicle.vin}) registered${reg.isNewCustomer ? `; customer ${reg.customer.customerId} created` : ''}` });
  }
  log(job, `Job card opened (${jobType}). Estimate ${totals(job, 'estimate').total.toFixed(2)} incl. GST${approval.clientUnavailable ? ' – customer approval taken over phone' : ' – signed by customer'}.`);
  db.jobcards.unshift(job);
  const appt = floor.linkAppointment(job);
  if (appt) log(job, `Booking ${appt.id} marked arrived`);
  save();
  return jobFull(job);
});

route('GET', '/api/jobcards/:id', (req, q, p) => jobFull(findJob(p.id)));

route('PATCH', '/api/jobcards/:id', (req, q, p, body) => {
  const j = findJob(p.id);
  assertOpen(j);
  const changed = [];
  if ('jobType' in body) {
    const jt = requireStr(body, 'jobType', 'Repair type');
    if (jt !== j.jobType && !registration.activeNames(db.repairTypes, db.lookups.jobTypes).includes(jt)) throw bad(`${jt} is not an active repair type`, { field: 'jobType' });
    j.jobType = jt;
    changed.push('repair type');
  }
  if ('odometer' in body) {
    const o = num(body.odometer, { min: 0, max: 2000000 });
    if (isNaN(o)) throw bad('Odometer must be a number', { field: 'odometer' });
    j.odometer = o; changed.push('odometer');
  }
  for (const k of ['odometerFaulty', 'customerWaiting', 'lift', 'repeatRepair']) if (k in body) { j[k] = !!body[k]; changed.push(k); }
  if ('fuelLevel' in body) { j.fuelLevel = num(body.fuelLevel, { min: 0, max: 4 }) || 0; changed.push('fuel level'); }
  for (const k of ['drivenBy', 'serviceVan', 'bay', 'technician']) if (k in body) { j[k] = str(body[k], 60); changed.push(k); }
  if (body.extras) j.extras = { wash: !!body.extras.wash, interiorClean: !!body.extras.interiorClean };
  if (changed.length) log(j, `Check-in details updated (${[...new Set(changed)].join(', ')})`);
  save();
  return jobFull(j);
});

route('POST', '/api/jobcards/:id/stage', (req, q, p, body) => {
  const j = findJob(p.id);
  assertOpen(j);
  const to = str(body.stage);
  const iTo = STAGE_KEYS.indexOf(to);
  if (iTo < 0 || to === 'delivered') throw bad('Use the close action to deliver a vehicle');
  if (to === 'ready_invoice' && j.lines.some((l) => l.status === 'pending')) throw conflict('Resolve all pending customer approvals before moving to invoicing');
  const from = j.stage;
  j.stage = to;
  log(j, `Stage changed: ${STAGES.find((s) => s.key === from).label} → ${STAGES[iTo].label}`);
  save();
  return jobFull(j);
});

route('POST', '/api/jobcards/:id/status', (req, q, p, body) => {
  const j = findJob(p.id);
  const action = str(body.action);
  const remarks = requireStr(body, 'remarks', 'Remarks');
  if (action === 'hold') {
    assertOpen(j);
    j.status = 'on_hold';
  } else if (action === 'resume') {
    if (j.status !== 'on_hold') throw conflict('Job card is not on hold');
    j.status = 'active';
  } else if (action === 'close') {
    assertOpen(j);
    if (j.lines.some((l) => l.status === 'pending')) throw conflict('Resolve all pending customer approvals before closing');
    if (!j.lines.some((l) => l.status === 'approved')) throw conflict('Nothing approved to invoice');
    // everything approved on the estimate must be issued: parts from stock, labour to the workshop
    const notIssued = j.lines.filter((l) => l.status === 'approved' && (l.kind === 'part' ? (l.issuedQty || 0) < l.qty : !l.labourIssue));
    if (notIssued.length) throw conflict(`Issue all approved parts and labour before closing (Parts & labour issue tab). Not issued: ${notIssued.map((l) => `${l.description} (${l.code})`).join(', ')}`, { notIssued: notIssued.map((l) => l.id) });
    const issued = billing.issueForJob(j);
    j.status = 'closed';
    j.stage = 'ready_delivery'; // the gate pass releases the vehicle
    floor.clockOffJob(j);
    j.issuedNow = issued.map((i) => `${i.id} (${i.payer}, ${au.money(i.total)})`).join(', ');
  } else if (action === 'reopen') {
    if (j.status !== 'closed') throw conflict('Only closed job cards can be reopened');
    j.status = 'active';
    j.stage = 'in_progress';
    const notes = billing.creditForJob(j, remarks);
    if (j.gatePass) { (j.previousGatePasses = j.previousGatePasses || []).push(j.gatePass); delete j.gatePass; }
    j.issuedNow = notes.length ? 'credit note ' + notes.map((n) => n.id).join(', ') : '';
  } else throw bad('action must be one of hold, resume, close, reopen');
  log(j, `Status: ${action}${j.issuedNow ? ` – ${action === 'close' ? 'tax invoice ' : ''}${j.issuedNow}` : ''}. ${remarks}`);
  delete j.issuedNow;
  save();
  return jobFull(j);
});

route('POST', '/api/jobcards/:id/promised', (req, q, p, body) => {
  const j = findJob(p.id);
  assertOpen(j);
  const at = validDate(body.promisedAt, 'New delivery time');
  const reason = requireStr(body, 'reason', 'Reason');
  const prev = j.promisedAt;
  j.promisedAt = at;
  log(j, `Promised delivery moved from ${new Date(prev).toLocaleString('en-AU', { timeZone: tz() })} to ${new Date(at).toLocaleString('en-AU', { timeZone: tz() })}. Reason: ${reason}${body.remarks ? '. ' + str(body.remarks) : ''}`);
  save();
  return jobFull(j);
});

/* concerns */
route('POST', '/api/jobcards/:id/concerns', (req, q, p, body) => {
  const j = findJob(p.id);
  assertOpen(j);
  const c = { id: nextId(j.concerns), kind: body.kind === 'advice' ? 'advice' : 'voice', text: requireStr(body, 'text', 'Description'), observation: str(body.observation) };
  j.concerns.push(c);
  log(j, `${c.kind === 'voice' ? 'Customer concern' : 'Advisor recommendation'} added: ${c.text}`);
  save();
  return jobFull(j);
});
route('PATCH', '/api/jobcards/:id/concerns/:cid', (req, q, p, body) => {
  const j = findJob(p.id);
  assertOpen(j);
  const c = j.concerns.find((x) => x.id === Number(p.cid));
  if (!c) throw notFound('Concern');
  if ('text' in body) c.text = requireStr(body, 'text', 'Description');
  if ('observation' in body) c.observation = str(body.observation);
  log(j, `Concern #${c.id} updated`);
  save();
  return jobFull(j);
});
route('DELETE', '/api/jobcards/:id/concerns/:cid', (req, q, p) => {
  const j = findJob(p.id);
  assertOpen(j);
  const cid = Number(p.cid);
  const c = j.concerns.find((x) => x.id === cid);
  if (!c) throw notFound('Concern');
  if (j.lines.some((l) => l.concernId === cid && l.status === 'approved')) throw conflict('This concern has approved work. Decline or remove those lines first.');
  j.concerns = j.concerns.filter((x) => x.id !== cid);
  j.lines = j.lines.filter((l) => l.concernId !== cid);
  log(j, `Concern removed: ${c.text}`);
  save();
  return jobFull(j);
});

/* estimate lines */
route('POST', '/api/jobcards/:id/lines', (req, q, p, body) => {
  const j = findJob(p.id);
  assertOpen(j);
  const concernId = body.concernId != null ? Number(body.concernId) : null;
  if (concernId != null && !j.concerns.some((c) => c.id === concernId)) throw bad('Unknown concern');
  let added;
  if (body.packageCode) added = expandPackage(j, str(body.packageCode), concernId, 'pending');
  else {
    const l = buildLine(j, Object.assign({}, body, { concernId, status: 'pending' }));
    j.lines.push(l);
    added = [l];
  }
  log(j, `Estimate: added ${added.map((l) => l.description).join(', ')}`);
  save();
  return jobFull(j);
});
route('PATCH', '/api/jobcards/:id/lines/:lid', (req, q, p, body) => {
  const j = findJob(p.id);
  assertOpen(j);
  const l = j.lines.find((x) => x.id === Number(p.lid));
  if (!l) throw notFound('Line');
  if ('qty' in body && l.kind === 'part') {
    const n = num(body.qty, { min: 0.1, max: 999 });
    if (isNaN(n)) throw bad('qty must be a number');
    if (n < (l.issuedQty || 0)) throw conflict(`${l.issuedQty} already issued from stock. Return parts before reducing the quantity below that.`);
    l.qty = n;
  }
  if ('discountPct' in body) l.discountPct = num(body.discountPct, { min: 0, max: 100 }) || 0;
  if ('blocked' in body) {
    if (body.blocked && !l.blocked && l.kind === 'part') {
      const p = part(l.code) || { stock: 0 };
      const free = round2(p.stock - stock.reservedQty(db, l.code, j.id) - j.lines.filter((x) => x !== l && x.kind === 'part' && x.code === l.code && x.blocked).reduce((s, x) => s + Math.max(0, x.qty - (x.issuedQty || 0)), 0));
      const need = round2(l.qty - (l.issuedQty || 0));
      if (free + 1e-9 < need) throw conflict(`Only ${Math.max(0, free)} of ${l.code} is free to reserve (${need} needed)`);
    }
    l.blocked = !!body.blocked;
    log(j, `${l.blocked ? 'Blocked' : 'Released'} stock for ${l.description}`);
  }
  if ('status' in body) {
    if (!['pending', 'approved', 'declined'].includes(body.status)) throw bad('status must be pending, approved or declined');
    if (body.status === 'declined' && !str(body.reason)) throw bad('A reason is required when the customer declines', { field: 'reason' });
    if (body.status !== 'approved') stock.assertNotIssued(l, `mark it ${body.status}`, { conflict });
    if (body.status !== 'approved' && l.labourIssue) { delete l.labourIssue; log(j, `Labour "${l.description}" set back to not issued`); }
    l.status = body.status;
    l.reason = str(body.reason);
    log(j, `Customer ${body.status} "${l.description}" (${lineAmount(l).toFixed(2)})${l.reason ? ` – ${l.reason}` : ''}`);
  }
  if ('remarks' in body) l.remarks = str(body.remarks);
  if ('payer' in body) {
    if (!['customer', 'claim'].includes(body.payer)) throw bad('payer must be customer or claim');
    if (body.payer === 'claim' && !j.claim) throw conflict('This job card has no claim');
    l.payer = body.payer;
    log(j, `${l.description}: ${body.payer === 'claim' ? 'charged to the ' + (j.claim.type === 'insurance' ? 'insurer' : 'manufacturer') : 'paid by the customer'}`);
  }
  save();
  return jobFull(j);
});
route('DELETE', '/api/jobcards/:id/lines/:lid', (req, q, p) => {
  const j = findJob(p.id);
  assertOpen(j);
  const l = j.lines.find((x) => x.id === Number(p.lid));
  if (!l) throw notFound('Line');
  stock.assertNotIssued(l, 'remove the line', { conflict });
  j.lines = j.lines.filter((x) => x !== l);
  log(j, `Estimate: removed ${l.description}`);
  save();
  return jobFull(j);
});
route('GET', '/api/jobcards/:id/lines/:lid/alternatives', (req, q, p) => {
  const j = findJob(p.id);
  const l = j.lines.find((x) => x.id === Number(p.lid));
  if (!l || l.kind !== 'part') throw notFound('Part line');
  const orig = part(l.code) || {};
  const superseded = orig.supersededBy ? [part(orig.supersededBy)].filter(Boolean) : [];
  const alternate = db.catalog.parts.filter((x) => x.no !== l.code && (x.alternateFor === l.code || (x.category === orig.category && x.no !== orig.supersededBy)));
  return { original: orig, superseded, alternate };
});
route('POST', '/api/jobcards/:id/lines/:lid/replace', (req, q, p, body) => {
  const j = findJob(p.id);
  assertOpen(j);
  const l = j.lines.find((x) => x.id === Number(p.lid));
  if (!l || l.kind !== 'part') throw notFound('Part line');
  stock.assertNotIssued(l, 'replace the part', { conflict });
  const np = part(str(body.partNo));
  if (!np) throw bad('Choose a replacement part');
  const reason = requireStr(body, 'reason', 'Reason');
  const old = l.code;
  Object.assign(l, { code: np.no, description: np.description, rate: np.mrp, taxPct: np.gstPct != null ? Number(np.gstPct) : l.taxPct, status: 'pending' });
  log(j, `Part ${old} replaced with ${np.no}. Reason: ${reason}${body.comment ? '. ' + str(body.comment) : ''}`);
  save();
  return jobFull(j);
});

/* campaigns, inspection, damages */
route('POST', '/api/jobcards/:id/campaigns/:cid', (req, q, p, body) => {
  const j = findJob(p.id);
  assertOpen(j);
  const c = j.campaigns.find((x) => x.id === p.cid);
  if (!c) throw notFound('Campaign');
  c.applied = !!body.applied;
  log(j, `Campaign ${c.applied ? 'applied' : 'removed'}: ${c.name}`);
  save();
  return jobFull(j);
});
route('PUT', '/api/jobcards/:id/inspection/:section', (req, q, p, body) => {
  const j = findJob(p.id);
  assertOpen(j);
  const sec = j.inspection[p.section];
  if (!sec) throw notFound('Inspection section');
  if (!Array.isArray(body.items) || body.items.length !== sec.length) throw bad('items must match the checklist');
  body.items.forEach((it, i) => {
    sec[i].ok = !!it.ok;
    sec[i].action = sec[i].ok ? '' : str(it.action, 40) || 'Inspect';
  });
  if (Array.isArray(body.tyreDepth)) j.tyreDepth = body.tyreDepth.slice(0, 4).map((x) => num(x, { min: 0, max: 20 }) || null);
  log(j, `Inspection saved: ${p.section} (${sec.filter((s) => !s.ok).length} issue(s))`);
  save();
  return jobFull(j);
});
route('PUT', '/api/jobcards/:id/damages', (req, q, p, body) => {
  const j = findJob(p.id);
  assertOpen(j);
  const types = ['damage', 'scratch', 'dent', 'missing', 'corrosion'];
  if (!Array.isArray(body.damages)) throw bad('damages must be a list');
  j.damages = body.damages.slice(0, 50).map((d) => ({ x: num(d.x, { min: 0, max: 100 }), y: num(d.y, { min: 0, max: 100 }), type: types.includes(d.type) ? d.type : 'damage', note: str(d.note, 120) }));
  log(j, `Body condition saved (${j.damages.length} mark(s))`);
  save();
  return jobFull(j);
});

/* feedback, activity, billing, email */
route('POST', '/api/jobcards/:id/feedback', (req, q, p, body) => {
  const j = findJob(p.id);
  const n = db.lookups.feedbackQuestions.length;
  if (!Array.isArray(body.scores) || body.scores.length !== n || body.scores.some((s) => !(s >= 1 && s <= 5))) throw bad(`Rate all ${n} questions from 1 to 5`);
  j.feedback = { scores: body.scores.map(Number), comment: str(body.comment, 1000), at: now() };
  log(j, `Customer feedback recorded (${(j.feedback.scores.reduce((a, b) => a + b, 0) / n).toFixed(1)} / 5)`);
  save();
  return jobFull(j);
});
route('POST', '/api/jobcards/:id/activity', (req, q, p, body) => {
  const j = findJob(p.id);
  log(j, 'Note: ' + requireStr(body, 'text', 'Comment'));
  save();
  return jobFull(j);
});
route('POST', '/api/jobcards/:id/proforma', (req, q, p) => {
  const j = findJob(p.id);
  assertOpen(j);
  const t = totals(j, 'billing');
  if (!t.lineCount) throw conflict('No approved work to bill yet');
  j.proforma = { at: now(), total: t.total };
  log(j, `Proforma invoice generated (${t.total.toFixed(2)})`);
  save();
  return jobFull(j);
});
route('POST', '/api/jobcards/:id/email', (req, q, p, body) => {
  const j = findJob(p.id);
  const to = requireStr(body, 'to', 'Recipient');
  if (!/^\S+@\S+\.\S+$/.test(to)) throw bad('Recipient email is not valid', { field: 'to' });
  // Demo: no mail server configured – we only record the request.
  log(j, `Job card emailed to ${to} (queued – demo, not actually sent)`);
  save();
  return { queued: true, to };
});

/* catalog */
route('GET', '/api/catalog/parts', (req, q) => {
  const term = str(q.get('q')).toLowerCase();
  const source = q.get('source');
  return db.catalog.parts.filter((x) => x.active !== false && (!source || x.source === source) && (!term || (x.no + ' ' + x.description).toLowerCase().includes(term)));
});
route('GET', '/api/catalog/labour', (req, q) => {
  const term = str(q.get('q')).toLowerCase();
  return db.catalog.labour.filter((x) => x.active !== false && (!term || (x.code + ' ' + x.description + ' ' + x.group).toLowerCase().includes(term)));
});
route('GET', '/api/catalog/packages', () =>
  db.catalog.packages.filter((pk) => pk.active !== false).map((pk) => {
    const parts = pk.parts.map(([no, qty]) => Object.assign({}, part(no), { qty }));
    const lab = pk.labour.map(labour);
    return Object.assign({}, pk, {
      partsDetail: parts,
      labourDetail: lab,
      partsAmount: round2(parts.reduce((s, x) => s + x.mrp * x.qty, 0)),
      labourAmount: round2(lab.reduce((s, x) => s + x.rate, 0)),
      minutes: lab.reduce((s, x) => s + x.minutes, 0),
      inStock: parts.every((x) => x.stock >= x.qty),
    });
  })
);

/* master data (users, parts, labour, insurers) */
/* parts issue to job cards (FIFO) and returns */
const stockErr = { bad, conflict };
function issueOne(j, l, qty) {
  const r = stock.issueLine(db, j, l, qty, actor ? actor.name : 'System', stockErr);
  log(j, `Issued ${r.qty} × ${l.code} from stock (FIFO: ${r.allocations.map((a) => `${a.qty} from ${a.batchId} @ ${a.unitCost}`).join(', ')}) – cost ${r.cost.toFixed(2)}`);
  return r;
}
route('POST', '/api/jobcards/:id/lines/:lid/issue', (req, q, p, body) => {
  const j = findJob(p.id);
  assertOpen(j);
  const l = j.lines.find((x) => x.id === Number(p.lid));
  if (!l) throw notFound('Line');
  issueOne(j, l, body.qty);
  save();
  return jobFull(j);
});
route('POST', '/api/jobcards/:id/issue-parts', (req, q, p) => {
  const j = findJob(p.id);
  assertOpen(j);
  const todo = j.lines.filter((l) => l.kind === 'part' && l.status === 'approved' && (l.issuedQty || 0) < l.qty);
  if (!todo.length) throw conflict('There are no approved parts waiting to be issued');
  // check every line first so the issue is all-or-nothing
  const need = new Map();
  for (const l of todo) need.set(l.code, (need.get(l.code) || 0) + (l.qty - (l.issuedQty || 0)));
  const short = [...need].filter(([code, n]) => ((part(code) || {}).stock || 0) + 1e-9 < n);
  if (short.length) throw conflict(`Not enough stock: ${short.map(([code, n]) => `${code} (need ${n}, have ${(part(code) || {}).stock || 0})`).join('; ')}`, { short: short.map(([code]) => code) });
  todo.forEach((l) => issueOne(j, l));
  save();
  return jobFull(j);
});
/* labour issue: an approved labour line is released to the workshop (to a technician) */
function issueLabour(j, l, to) {
  if (l.kind !== 'labour') throw bad('Only labour lines are issued this way – parts are issued from stock');
  if (l.status !== 'approved') throw conflict('Only approved labour can be issued. Record the customer approval first.');
  if (l.labourIssue) throw conflict(`${l.description} is already issued`);
  const tech = str(to, 60) || j.technician || '';
  if (tech && !db.users.some((u) => u.name === tech && u.active !== false)) throw bad('Unknown technician', { field: 'technician' });
  l.labourIssue = { at: now(), by: actor ? actor.name : 'System', to: tech };
  log(j, `Issued labour "${l.description}"${tech ? ' to ' + tech : ''}`);
}
route('POST', '/api/jobcards/:id/lines/:lid/issue-labour', (req, q, p, body) => {
  const j = findJob(p.id);
  assertOpen(j);
  const l = j.lines.find((x) => x.id === Number(p.lid));
  if (!l) throw notFound('Line');
  issueLabour(j, l, body.technician);
  save();
  return jobFull(j);
});
route('POST', '/api/jobcards/:id/lines/:lid/unissue-labour', (req, q, p) => {
  const j = findJob(p.id);
  assertOpen(j);
  const l = j.lines.find((x) => x.id === Number(p.lid));
  if (!l) throw notFound('Line');
  if (!l.labourIssue) throw conflict(`${l.description} is not issued`);
  delete l.labourIssue;
  log(j, `Labour "${l.description}" set back to not issued`);
  save();
  return jobFull(j);
});
route('POST', '/api/jobcards/:id/issue-labour', (req, q, p, body) => {
  const j = findJob(p.id);
  assertOpen(j);
  const todo = j.lines.filter((l) => l.kind === 'labour' && l.status === 'approved' && !l.labourIssue);
  if (!todo.length) throw conflict('There is no approved labour waiting to be issued');
  todo.forEach((l) => issueLabour(j, l, body.technician));
  save();
  return jobFull(j);
});
route('POST', '/api/jobcards/:id/lines/:lid/return', (req, q, p, body) => {
  const j = findJob(p.id);
  assertOpen(j);
  const l = j.lines.find((x) => x.id === Number(p.lid));
  if (!l) throw notFound('Line');
  const r = stock.returnLine(db, j, l, body.qty, str(body.reason, 200), actor ? actor.name : 'System', stockErr);
  log(j, `Returned ${r.qty} × ${l.code} to stock – ${r.reason}`);
  save();
  return jobFull(j);
});
stock.register({
  route, getDb: () => db, save, bad, notFound, conflict, str, num,
  actorName: () => (actor ? actor.name : 'System'),
  audit: (text) => { db.audit = db.audit || []; db.audit.unshift({ at: now(), by: actor ? actor.name : 'System', text }); },
});

const billing = billingMod.register({
  route, getDb: () => db, save, bad, notFound, conflict, str, num, findJob, vehicle, lineAmount, campaignPct, lineTaxPct, jobFull,
  log: (j, text) => log(j, text),
  actorName: () => (actor ? actor.name : 'System'),
  audit: (text) => { db.audit = db.audit || []; db.audit.unshift({ at: now(), by: actor ? actor.name : 'System', text }); },
  can: (right) => access.can(db, actor, right),
});

reports.register({ route, getDb: () => db });

purchasing.register({
  route, getDb: () => db, save, bad, notFound, conflict, str, num,
  actorName: () => (actor ? actor.name : 'System'),
  audit: (text) => { db.audit = db.audit || []; db.audit.unshift({ at: now(), by: actor ? actor.name : 'System', text }); },
});

const msgCtx = {
  route, getDb: () => db, save, bad, notFound, conflict, str, findJob, vehicle, jobFull, totals,
  log: (j, text, by) => log(j, text, by),
  actorName: () => (actor ? actor.name : 'System'),
};
messaging.register(msgCtx);
const floor = {
  route, getDb: () => db, save, bad, notFound, conflict, str, num, findJob, vehicle, jobSummary, inOutlet, outletFn: () => currentOutlet || (allowedOutlets(actor) || [])[0] || defaultOutletId(),
  log: (j, text, by) => log(j, text, by),
  actorFn: () => actor,
  sendMessage: (t, ch, c, req) => msgCtx.exportSend(t, ch, c, req),
};
workshopFloor.register(floor);

extras.register({
  route, getDb: () => db, setDb: (d) => { db = d; }, save, bad, notFound, conflict, str, num, findJob, vehicle, HttpError, dataDir: DATA_DIR,
  registration, stock, migrate, seed,
  log: (j, text) => log(j, text),
  actorName: () => (actor ? actor.name : 'System'),
  audit: (text) => { db.audit = db.audit || []; db.audit.unshift({ at: now(), by: actor ? actor.name : 'System', text }); },
  masterSchemas: (getDb) => mastersEngine({ getDb, bad, notFound, conflict: (m) => new Error(m) }),
  createMaster: (eng, type, rec) => eng.create(type, rec),
});

auth.register({
  route, getDb: () => db, save, bad, conflict, str, HttpError,
  audit: (text, by) => { db.audit = db.audit || []; db.audit.unshift({ at: now(), by: by || (actor ? actor.name : 'System'), text }); },
  actorFn: () => actor,
});

registerMasters({
  route,
  getDb: () => db,
  save,
  bad,
  notFound,
  conflict,
  log: (text) => { db.audit = db.audit || []; db.audit.unshift({ at: now(), by: actor ? actor.name : 'System', text }); db.audit.length = Math.min(db.audit.length, 500); },
});

route('POST', '/api/admin/reset', () => {
  const keepLogins = db.users.filter((u) => u.passwordHash).map((u) => ({ id: u.id, email: u.email, passwordHash: u.passwordHash, mustChangePassword: u.mustChangePassword }));
  db = freshDb();
  for (const k of keepLogins) { const u = db.users.find((x) => x.id === k.id && x.email === k.email); if (u) Object.assign(u, { passwordHash: k.passwordHash, mustChangePassword: k.mustChangePassword }); }
  auth.bootstrap(db, DATA_DIR, (u) => access.isAdminUser(db, u));
  save();
  return { ok: true };
});

/* ------------------------------------------------------------------ server */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 60_000_000) {
        reject(new HttpError(413, 'Request too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(bad('Body must be valid JSON'));
      }
    });
    req.on('error', reject);
  });
}
function serveStatic(req, res, pathname) {
  let file = path.normalize(path.join(PUBLIC, decodeURIComponent(pathname)));
  if (!file.startsWith(PUBLIC)) return send(res, 403, { error: 'Forbidden' });
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(fs.readFileSync(file));
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE', 'Access-Control-Allow-Headers': 'Content-Type, X-User-Id' });
    return res.end();
  }
  if (/^\/p\/[A-Za-z0-9_-]+$/.test(url.pathname)) return serveStatic(req, res, '/approve.html');
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);
  const started = Date.now();
  try {
    const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
    if (!r) throw notFound('Endpoint');
    const m = url.pathname.match(r.re);
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
    if (req.method === 'GET') await refresh();
    const user = requestUser(req);
    const isPublic = PUBLIC_ROUTES.some((re) => re.test(url.pathname));
    if (!user && !isPublic) throw new HttpError(401, 'Please sign in');
    // until a temporary password is changed, only the change-password call is allowed
    if (user && user.mustChangePassword && auth.MODE() === 'password' && !isPublic && !/^\/api\/(me|meta|auth\/change-password)$/.test(url.pathname)) throw new HttpError(403, 'Choose a new password first', { mustChangePassword: true });
    const missing = isPublic ? null : access.rightsFor(req.method, url.pathname, body).find((rt) => !access.can(db, user, rt));
    if (missing) {
      const rt = (db.rights || []).find((x) => x.code === missing);
      throw new HttpError(403, `${user ? user.name : 'This user'} (${user ? user.role : 'no role'}) does not have the right “${rt ? rt.name : missing}”. Ask an administrator to add it to the role.`, { right: missing });
    }
    if (req.method === 'GET') actor = user; // read-only handlers (e.g. My jobs) need to know who is asking
    if (req.method === 'GET') currentOutlet = user ? resolveOutlet(req, user) : null;
    const out = req.method === 'GET'
      ? await r.handler(req, url.searchParams, params, body, res)
      : await exclusive(async () => {
          await refresh();
          dirty = false;
          actor = requestUser(req);
          currentOutlet = actor ? resolveOutlet(req, actor) : null;
          const result = await r.handler(req, url.searchParams, params, body, res);
          await persist(); // throws 503 (and reloads from the database) if the write fails
          return result;
        });
    if (out && out.__file) {
      res.writeHead(200, { 'Content-Type': out.type, 'Content-Disposition': `${out.inline ? 'inline' : 'attachment'}; filename="${String(out.name).replace(/"/g, '')}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
      return res.end(out.body);
    }
    send(res, req.method === 'POST' && /\/api\/jobcards\/?$/.test(url.pathname) ? 201 : 200, out);
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    send(res, status, { error: e.message || 'Server error', details: e.details });
  } finally {
    console.log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`);
  }
}

let loading = null;
/** Loads the data once per server copy; used by the serverless entry point (api/index.js). */
function ready() {
  if (!loading) loading = load().then(() => { loadedAt = Date.now(); });
  return loading;
}
module.exports = { handle, ready };

if (require.main === module) {
  const server = http.createServer(handle);
  ready()
    .then(() => server.listen(PORT, () => console.log(`Workshop Management System running at http://localhost:${PORT} (storage: ${store ? 'Supabase ' + process.env.SUPABASE_URL : DB_FILE})`)))
    .catch((e) => {
      console.error('Could not load data:', e.message);
      process.exit(1);
    });
}
