// API tests: starts the server on a free port with a throw-away data folder.
// Run with `npm test` (Node 18+ built-in test runner). TEST_STORAGE=supabase runs them
// against the Supabase database from .env instead – it changes that data, so reset afterwards.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 4399;
const BASE = `http://localhost:${PORT}/api`;
const r2 = (n) => Math.round(n * 100) / 100;
let proc, tmp;

async function api(method, url, body, user) {
  const headers = { 'Content-Type': 'application/json' };
  if (user) headers['X-User-Id'] = user;
  const r = await fetch(BASE + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wms-'));
  proc = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env: Object.assign({}, process.env, { PORT, DATA_DIR: tmp, STORAGE: process.env.TEST_STORAGE || 'file', AUTH_MODE: 'dev' }), stdio: 'ignore' });
  for (let i = 0; i < 200; i++) {
    try { if ((await fetch(BASE + '/health')).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
});
after(() => { proc.kill(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('meta and dashboard', async () => {
  const m = await api('GET', '/meta');
  assert.equal(m.status, 200);
  assert.equal(m.body.stages.length, 5);
  const d = await api('GET', '/dashboard');
  assert.equal(d.status, 200);
  assert.ok(d.body.kpis.openJobs >= 4);
});

test('vehicle search finds by reg, VIN and engine', async () => {
  assert.equal((await api('GET', '/vehicles?q=dx84tr')).body.length, 1);
  assert.equal((await api('GET', '/vehicles?q=M3GTGS664J8AC1419')).body.length, 1);
  assert.equal((await api('GET', '/vehicles?q=4JJ3-464819')).body.length, 1);
  assert.equal((await api('GET', '/vehicles/NOPE')).status, 404);
});

test('cannot open a second job card for a vehicle with an active one', async () => {
  const r = await api('POST', '/jobcards', { vin: 'MPATFS86JHT010963', jobType: 'Paid service', odometer: 100, promisedAt: new Date(Date.now() + 86400000).toISOString(), concerns: [{ text: 'x' }], approval: { clientUnavailable: true } });
  assert.equal(r.status, 409);
});

test('walk-in creates a job card with package lines and validation', async () => {
  const promisedAt = new Date(Date.now() + 86400000).toISOString();
  const missingSig = await api('POST', '/jobcards', { vin: 'M3GTGS664J8AC1419', jobType: 'Periodic service', odometer: 22100, promisedAt, concerns: [{ text: 'Service' }] });
  assert.equal(missingSig.status, 400);
  const r = await api('POST', '/jobcards', {
    vin: 'M3GTGS664J8AC1419', jobType: 'Periodic service', odometer: 22100, fuelLevel: 3, promisedAt,
    concerns: [
      { kind: 'voice', text: '20,000 km service', packages: ['PMS-20K'], decision: 'approved' },
      { kind: 'advice', text: 'Front brakes worn', lines: [{ kind: 'part', code: '8973697471', qty: 1 }, { kind: 'labour', code: 'H0140' }] },
    ],
    approval: { signature: 'data:image/png;base64,xx' },
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.status, 'active');
  assert.equal(r.body.stage, 'checked_in');
  assert.equal(r.body.lines.filter((l) => l.status === 'approved').length, 5);
  assert.equal(r.body.lines.filter((l) => l.status === 'pending').length, 2);
  assert.ok(r.body.estimate.total > r.body.billing.total);
});

test('approvals, stage gate, close and reopen', async () => {
  const id = 'RO-2026-00564';
  let j = (await api('GET', `/jobcards/${id}`)).body;
  assert.equal((await api('POST', `/jobcards/${id}/stage`, { stage: 'ready_invoice' })).status, 409);
  assert.equal((await api('PATCH', `/jobcards/${id}/lines/1`, { status: 'declined' })).status, 400);
  await api('PATCH', `/jobcards/${id}/lines/1`, { status: 'approved' });
  await api('PATCH', `/jobcards/${id}/lines/2`, { status: 'declined', reason: 'Too expensive' });
  assert.equal((await api('POST', `/jobcards/${id}/stage`, { stage: 'ready_invoice' })).status, 200);
  const closed = await api('POST', `/jobcards/${id}/status`, { action: 'close', remarks: 'Done' });
  assert.equal(closed.status, 200);
  assert.equal(closed.body.status, 'closed');
  assert.ok(closed.body.invoice.number.startsWith('INV'));
  assert.equal((await api('POST', `/jobcards/${id}/concerns`, { text: 'x' })).status, 409);
  const re = await api('POST', `/jobcards/${id}/status`, { action: 'reopen', remarks: 'Add part' });
  assert.equal(re.body.status, 'active');
});

test('part replacement and delivery change', async () => {
  const id = 'RO-2026-00563';
  const alt = await api('GET', `/jobcards/${id}/lines/4/alternatives`);
  assert.equal(alt.body.superseded[0].no, '8974460951');
  assert.equal((await api('POST', `/jobcards/${id}/lines/4/replace`, { partNo: '8974460951' })).status, 400);
  const r = await api('POST', `/jobcards/${id}/lines/4/replace`, { partNo: '8974460951', reason: 'Original part superseded' });
  assert.equal(r.body.lines.find((l) => l.id === 4).code, '8974460951');
  const d = await api('POST', `/jobcards/${id}/promised`, { promisedAt: new Date(Date.now() + 2 * 86400000).toISOString(), reason: 'Parts not available' });
  assert.equal(d.status, 200);
});

test('reset restores the original sample data', async () => {
  await api('POST', '/jobcards/RO-2026-00563/status', { action: 'hold', remarks: 'Waiting for parts' });
  assert.equal((await api('GET', '/jobcards/RO-2026-00563')).body.status, 'on_hold');
  await api('POST', '/admin/reset');
  const j = (await api('GET', '/jobcards/RO-2026-00563')).body;
  assert.equal(j.status, 'active');
  assert.equal(j.lines.find((l) => l.id === 4).code, '8974460950');
});

test('masters: users CRUD, validation, uniqueness, in-use rules', async () => {
  const list = await api('GET', '/masters/users');
  assert.ok(list.body.length >= 6);
  assert.equal((await api('POST', '/masters/users', { name: 'X' })).status, 400); // role & phone required
  assert.equal((await api('POST', '/masters/users', { name: 'New Tech', role: 'Wizard', phone: '0412000999' })).status, 400);
  assert.equal((await api('POST', '/masters/users', { name: 'Arun Kumar', role: 'Technician', phone: '0412000999' })).status, 409);
  const u = await api('POST', '/masters/users', { name: 'Deepa V', role: 'Technician', phone: '0412000201', email: 'deepa@example.com' });
  assert.equal(u.status, 200);
  assert.match(u.body.id, /^U\d{3}$/);
  assert.ok((await api('GET', '/meta')).body.lookups.technicians.includes('Deepa V'));
  // renaming cascades into job cards
  await api('PATCH', '/masters/users/U002', { name: 'Suresh Mani' });
  assert.equal((await api('GET', '/jobcards/RO-2026-00563')).body.technician, 'Suresh Mani');
  // in-use users cannot be deleted or deactivated
  assert.equal((await api('DELETE', '/masters/users/U002')).status, 409);
  assert.equal((await api('PATCH', '/masters/users/U002', { active: false })).status, 409);
  assert.equal((await api('DELETE', `/masters/users/${u.body.id}`)).status, 200);
});

test('masters: parts and labour', async () => {
  assert.equal((await api('POST', '/masters/parts', { no: 'bad part!', description: 'x', category: 'x', brand: 'x', source: 'OEM', unit: 'EA', mrp: 1 })).status, 400);
  assert.equal((await api('POST', '/masters/parts', { no: 'NEW-1', description: 'x', category: 'x', brand: 'x', source: 'OEM', unit: 'EA', mrp: -5 })).status, 400);
  assert.equal((await api('POST', '/masters/parts', { no: 'NEW-1', description: 'x', category: 'x', brand: 'x', source: 'OEM', unit: 'EA', mrp: 10, supersededBy: 'NOPE' })).status, 400);
  const p = await api('POST', '/masters/parts', { no: 'new-1', description: 'Horn assembly', category: 'Electrical', brand: 'Isuzu', source: 'OEM', unit: 'EA', mrp: 850, stock: 1, reorderLevel: 2 });
  assert.equal(p.body.no, 'NEW-1');
  assert.equal(p.body.lowStock, true);
  assert.equal((await api('POST', '/masters/parts', { no: 'NEW-1', description: 'dup', category: 'x', brand: 'x', source: 'OEM', unit: 'EA', mrp: 1 })).status, 409);
  assert.equal((await api('DELETE', '/masters/parts/8981436420')).status, 409); // used in packages
  // inactive parts disappear from the catalogue and cannot be added to estimates
  await api('PATCH', '/masters/parts/NEW-1', { active: false });
  assert.equal((await api('GET', '/catalog/parts?q=horn')).body.length, 0);
  assert.equal((await api('POST', '/jobcards/RO-2026-00563/lines', { kind: 'part', code: 'NEW-1', qty: 1 })).status, 400);
  assert.equal((await api('DELETE', '/masters/parts/NEW-1')).status, 200);
  const l = await api('POST', '/masters/labour', { code: 'X100', description: 'Headlamp alignment', group: 'Electrical', minutes: 20, rate: 300 });
  assert.equal(l.status, 200);
  assert.equal((await api('POST', '/masters/labour', { code: 'X101', description: 'x', group: 'x', minutes: 0, rate: 1 })).status, 400);
  assert.equal((await api('DELETE', '/masters/labour/H0127')).status, 409);
});

test('masters: insurers and vehicle insurance', async () => {
  assert.equal((await api('POST', '/masters/insurers', { name: 'Go Digit', code: 'DIGIT', abn: '123' })).status, 400);
  const i = await api('POST', '/masters/insurers', { name: 'Go Digit', code: 'digit', cashless: true });
  assert.match(i.body.id, /^INS\d{3}$/);
  assert.equal((await api('DELETE', '/masters/insurers/INS001')).status, 409); // vehicles linked
  const v = await api('PATCH', '/vehicles/M3GTGS664J8AC1419/insurance', { company: 'Go Digit', policyNo: 'dg-123', validTill: new Date(Date.now() + 3e10).toISOString() });
  assert.equal(v.body.insurance.policyNo, 'DG-123');
  assert.equal((await api('PATCH', '/vehicles/M3GTGS664J8AC1419/insurance', { company: 'Unknown Co', policyNo: 'x', validTill: new Date().toISOString() })).status, 400);
  await api('PATCH', `/masters/insurers/${i.body.id}`, { name: 'Go Digit General' });
  assert.equal((await api('GET', '/vehicles/M3GTGS664J8AC1419')).body.insurance.company, 'Go Digit General');
});

test('masters: state → city → dealer → outlet hierarchy', async () => {
  const p = await api('POST', '/masters/provinces', { name: 'Norfolk Island', code: 'nfk' });
  assert.equal(p.status, 200);
  assert.equal(p.body.code, 'NFK');
  assert.equal(p.body.country, 'Australia');
  assert.equal((await api('POST', '/masters/provinces', { name: 'X', code: 'NSW' })).status, 409); // code taken
  assert.equal((await api('POST', '/masters/provinces', { name: 'Y', code: 'ABCD' })).status, 400); // too long
  const c = await api('POST', '/masters/cities', { name: 'Kingston', provinceId: p.body.id });
  assert.equal(c.body.provinceIdName, 'Norfolk Island');
  assert.equal((await api('POST', '/masters/cities', { name: 'kingston', provinceId: p.body.id })).status, 400); // dup in state
  assert.equal((await api('POST', '/masters/cities', { name: 'Nowhere', provinceId: 'PRV999' })).status, 400);
  // dealer: city must be in the state, ABN must pass the ATO check
  const base = { name: 'Norfolk Motors', code: 'NFM', provinceId: p.body.id, cityId: c.body.id };
  assert.equal((await api('POST', '/masters/dealers', Object.assign({}, base, { cityId: 'CTY001' }))).status, 400);
  assert.equal((await api('POST', '/masters/dealers', Object.assign({}, base, { abn: '12 345 678 901' }))).status, 400);
  const d = await api('POST', '/masters/dealers', Object.assign({}, base, { abn: '33104711805', phone: '+61 2 9555 0100' }));
  assert.equal(d.status, 200);
  assert.equal(d.body.abn, '33 104 711 805');
  assert.equal(d.body.phone, '0295550100');
  assert.equal((await api('POST', '/masters/dealers', Object.assign({}, base, { name: 'Other', code: 'OTH', abn: '33 104 711 805' }))).status, 409); // ABN taken
  const o = await api('POST', '/masters/outlets', { name: 'Kingston Service', code: 'nfm-ks', dealerId: d.body.id, type: 'Service centre', cityId: c.body.id, bays: 4 });
  assert.equal(o.body.dealerIdName, 'Norfolk Motors');
  assert.equal((await api('POST', '/masters/outlets', { name: 'Z', code: 'Z1', dealerId: d.body.id, type: 'Garage', cityId: c.body.id })).status, 400);
  // in-use protection down the chain
  assert.equal((await api('DELETE', `/masters/provinces/${p.body.id}`)).status, 409);
  assert.equal((await api('DELETE', `/masters/cities/${c.body.id}`)).status, 409);
  assert.equal((await api('DELETE', `/masters/dealers/${d.body.id}`)).status, 409);
  // inactive city can't be newly linked
  const c2 = await api('POST', '/masters/cities', { name: 'Burnt Pine', provinceId: p.body.id });
  await api('PATCH', `/masters/cities/${c2.body.id}`, { active: false });
  assert.equal((await api('PATCH', `/masters/outlets/${o.body.id}`, { cityId: c2.body.id })).status, 400);
  // delete bottom-up works
  assert.equal((await api('DELETE', `/masters/outlets/${o.body.id}`)).status, 200);
  assert.equal((await api('DELETE', `/masters/dealers/${d.body.id}`)).status, 200);
});

test('feedback validation', async () => {
  assert.equal((await api('POST', '/jobcards/RO-2026-00531/feedback', { scores: [5, 5] })).status, 400);
  assert.equal((await api('POST', '/jobcards/RO-2026-00531/feedback', { scores: [5, 4, 4, 5], comment: 'Good' })).status, 200);
});

test('roles & rights: masters, /me and permission checks', async () => {
  await api('POST', '/admin/reset');
  // default user (no header) is the administrator with every right
  const me = (await api('GET', '/me')).body;
  assert.equal(me.role.name, 'Administrator');
  const rights = (await api('GET', '/masters/rights')).body;
  assert.ok(rights.length >= 20);
  assert.deepEqual(me.rights.length, rights.filter((r) => r.active).length);
  const roles = (await api('GET', '/masters/roles')).body;
  assert.ok(roles.find((r) => r.name === 'Technician').userCount >= 3);

  // technician U002: may view and move stages, may not open job cards or edit masters
  assert.equal((await api('GET', '/jobcards', null, 'U002')).status, 200);
  const deny = await api('POST', '/jobcards', { vin: 'M3GTGS664J8AC1419' }, 'U002');
  assert.equal(deny.status, 403);
  assert.match(deny.body.error, /Open job cards/);
  assert.equal((await api('POST', '/masters/parts', { no: 'X1' }, 'U002')).status, 403);
  assert.equal((await api('GET', '/masters/users', null, 'U002')).status, 403);
  assert.equal((await api('POST', '/admin/reset', null, 'U001')).status, 403);
  // inactive / unknown user
  assert.equal((await api('GET', '/jobcards', null, 'U007')).status, 401);
  assert.equal((await api('GET', '/jobcards', null, 'NOPE')).status, 401);

  // parts manager: may change quantity (estimate) but not record approval
  assert.equal((await api('PATCH', '/jobcards/RO-2026-00564/lines/2', { qty: 2 }, 'U006')).status, 200);
  assert.equal((await api('PATCH', '/jobcards/RO-2026-00564/lines/2', { status: 'approved' }, 'U006')).status, 403);
  assert.equal((await api('PATCH', '/jobcards/RO-2026-00564/lines/2', { status: 'approved' }, 'U001')).status, 200);

  // activity records who did it
  const j = (await api('GET', '/jobcards/RO-2026-00564')).body;
  assert.ok(j.activity.some((a) => a.by === 'Arun Kumar'));

  // custom role with a custom right
  assert.equal((await api('POST', '/masters/rights', { code: 'Bad Code', module: 'Other', name: 'X' })).status, 400);
  const cr = await api('POST', '/masters/rights', { code: 'reports.export', module: 'Other', name: 'Export reports' });
  assert.equal(cr.status, 200);
  assert.equal((await api('POST', '/masters/roles', { name: 'Receptionist', rights: ['jobs.view', 'nope.right'] })).status, 400);
  const role = await api('POST', '/masters/roles', { name: 'Receptionist', description: 'Front desk', rights: ['dashboard.view', 'jobs.view', 'vehicles.view', 'reports.export'] });
  assert.equal(role.status, 200);
  assert.match(role.body.id, /^R[0-9]{3}$/);
  const u = (await api('POST', '/masters/users', { name: 'Front Desk', role: 'receptionist', phone: '0412000277' })).body;
  assert.equal(u.role, 'Receptionist');
  assert.equal((await api('GET', '/vehicles?q=dx84', null, u.id)).status, 200);
  assert.equal((await api('PATCH', '/vehicles/MPATFS86JHT010963/owner', { name: 'X' }, u.id)).status, 403);
  // grant vehicles.edit -> allowed (validation may still reject the body, but not with 403)
  await api('PATCH', `/masters/roles/${role.body.id}`, { rights: ['dashboard.view', 'jobs.view', 'vehicles.view', 'vehicles.edit'] });
  assert.notEqual((await api('PATCH', '/vehicles/MPATFS86JHT010963/owner', { name: 'Ganesh Raman' }, u.id)).status, 403);
  // custom right no longer used -> can be deleted; built-in rights cannot
  assert.equal((await api('DELETE', '/masters/rights/reports.export')).status, 200);
  assert.equal((await api('DELETE', '/masters/rights/jobs.view')).status, 409);
  // role in use cannot be deleted; renaming moves its users
  assert.equal((await api('DELETE', `/masters/roles/${role.body.id}`)).status, 409);
  await api('PATCH', `/masters/roles/${role.body.id}`, { name: 'Front Office' });
  assert.equal((await api('GET', `/masters/users/${u.id}`)).body.role, 'Front Office');
  // deactivating a role with active users is blocked; inactive roles cannot be assigned
  assert.equal((await api('PATCH', '/masters/roles/R003', { active: false })).status, 400); // technicians are still active
  assert.equal((await api('PATCH', '/masters/roles/R006', { active: false })).status, 200); // only an inactive user is a cashier
  assert.equal((await api('PATCH', '/masters/users/U001', { role: 'Cashier' })).status, 400); // inactive role cannot be assigned
});

test('roles & rights: administrator safeguards', async () => {
  await api('POST', '/admin/reset');
  assert.equal((await api('PATCH', '/masters/roles/R001', { name: 'Boss' })).status, 400);
  assert.equal((await api('PATCH', '/masters/roles/R001', { active: false })).status, 400);
  assert.equal((await api('DELETE', '/masters/roles/R001')).status, 409);
  // the last administrator cannot be demoted, deactivated or deleted
  assert.equal((await api('PATCH', '/masters/users/U008', { role: 'Technician' })).status, 400);
  assert.equal((await api('PATCH', '/masters/users/U008', { active: false })).status, 400);
  assert.equal((await api('DELETE', '/masters/users/U008')).status, 409);
  // once there is a second administrator, the first one can be changed
  await api('PATCH', '/masters/users/U005', { role: 'Administrator' });
  assert.equal((await api('PATCH', '/masters/users/U008', { role: 'Workshop Manager' })).status, 200);
  // a manager without roles.manage cannot grant rights
  assert.equal((await api('PATCH', '/masters/roles/R003', { rights: ['admin.reset'] }, 'U008')).status, 403);
  await api('POST', '/admin/reset');
});

test('register a new vehicle and customer together with the job card', async () => {
  await api('POST', '/admin/reset');
  const promisedAt = new Date(Date.now() + 86400000).toISOString();
  const base = { jobType: 'Paid service', odometer: 1200, promisedAt, concerns: [{ text: 'First service', packages: ['PMS-10K'], decision: 'approved' }], approval: { clientUnavailable: true } };
  const nv = { vin: 'MPATFS86JKT099001', reg: 'ab 12 cd', model: 'D-Max', variant: 'V-Cross Z', color: 'Splash White', fuel: 'Diesel', transmission: 'Manual', saleDate: '2026-10-01T12:00:00.000Z' };
  const newCust = { name: 'Priya Natarajan', phone: '0412555234', email: 'priya@example.com', type: 'Private', entity: 'Individual' };

  // validation
  assert.equal((await api('POST', '/vehicles/check', { newVehicle: Object.assign({}, nv, { vin: 'SHORT' }), customer: newCust })).status, 400);
  assert.equal((await api('POST', '/vehicles/check', { newVehicle: Object.assign({}, nv, { vin: 'MPATFS86JKT09900I' }), customer: newCust })).status, 400); // letter I not allowed
  assert.equal((await api('POST', '/vehicles/check', { newVehicle: nv, customer: Object.assign({}, newCust, { phone: '12345' }) })).status, 400);
  const dupVin = await api('POST', '/vehicles/check', { newVehicle: Object.assign({}, nv, { vin: 'MPATFS86JHT010963' }), customer: newCust });
  assert.equal(dupVin.status, 409);
  assert.equal(dupVin.body.details.vin, 'MPATFS86JHT010963');
  assert.equal((await api('POST', '/vehicles/check', { newVehicle: Object.assign({}, nv, { reg: 'DX84TR' }), customer: newCust })).status, 409);
  // mobile already belongs to a customer -> 409 with that customer, unless confirmed
  const dupPhone = await api('POST', '/vehicles/check', { newVehicle: nv, customer: Object.assign({}, newCust, { phone: '0412 555 018' }) });
  assert.equal(dupPhone.status, 409);
  assert.equal(dupPhone.body.details.existingCustomer.customerId, 'C-12418');
  assert.equal((await api('POST', '/vehicles/check', { newVehicle: nv, customer: Object.assign({}, newCust, { phone: '0412555018', allowDuplicatePhone: true }) })).status, 200);
  const ok = await api('POST', '/vehicles/check', { newVehicle: nv, customer: newCust });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.isNewCustomer, true);
  // nothing saved by the check
  assert.equal((await api('GET', '/vehicles?q=MPATFS86JKT099001')).body.length, 0);

  // a failing job card saves nothing (all or nothing)
  const fail = await api('POST', '/jobcards', Object.assign({}, base, { newVehicle: nv, customer: newCust, concerns: [] }));
  assert.equal(fail.status, 400);
  assert.equal((await api('GET', '/vehicles?q=MPATFS86JKT099001')).body.length, 0);

  // rights: a technician cannot register vehicles
  assert.equal((await api('POST', '/vehicles/check', { newVehicle: nv, customer: newCust }, 'U002')).status, 403);

  // create vehicle + new customer + job card
  const job = await api('POST', '/jobcards', Object.assign({}, base, { newVehicle: nv, customer: newCust }, ), 'U001');
  assert.equal(job.status, 201);
  const v = (await api('GET', '/vehicles/MPATFS86JKT099001')).body;
  assert.equal(v.reg, 'AB12CD');
  assert.match(v.owner.customerId, /^C-\d{5}$/);
  assert.equal(v.owner.name, 'Priya Natarajan');
  assert.ok(v.warrantyTill.startsWith('2032-10-01'));
  assert.equal(v.activeJob.id, job.body.id);
  assert.ok(job.body.activity.some((a) => /Vehicle registered with new customer Priya Natarajan/.test(a.text)));

  // second vehicle for the same (existing) customer
  const cust = (await api('GET', '/customers?q=natarajan')).body;
  assert.equal(cust.length, 1);
  const job2 = await api('POST', '/jobcards', Object.assign({}, base, { newVehicle: { vin: 'MPAUCR85HKT099002', reg: 'CD56EF', model: 'MU-X', transmission: 'Automatic' }, customer: { customerId: cust[0].customerId } }));
  assert.equal(job2.status, 201);
  const again = (await api('GET', '/customers?q=' + cust[0].customerId)).body[0];
  assert.equal(again.vehicles.length, 2);
  await api('POST', '/admin/reset');
});

test('stock: inward creates batches, issue is FIFO, return goes back to the same batches', async () => {
  await api('POST', '/admin/reset');
  // brake pad set 8973697471: opening stock 4 = 2 older (cheaper) + 2 newer
  const before = (await api('GET', '/stock/parts/8973697471')).body;
  assert.equal(before.onHand, 4);
  const [older, newer] = before.fifo;
  assert.ok(new Date(older.receivedAt) < new Date(newer.receivedAt));

  // inward: validation, then a new batch at a third cost
  assert.equal((await api('POST', '/stock/inwards', { supplier: 'Isuzu Parts Depot', invoiceNo: 'A1', lines: [] })).status, 400);
  assert.equal((await api('POST', '/stock/inwards', { supplier: 'Isuzu Parts Depot', invoiceNo: 'A1', lines: [{ partNo: 'NOPE', qty: 1, unitCost: 1 }] })).status, 400);
  assert.equal((await api('POST', '/stock/inwards', { supplier: 'Isuzu Parts Depot', invoiceNo: 'A1', lines: [{ partNo: '8973697471', qty: 1.5, unitCost: 1 }] })).status, 400); // SET must be whole
  assert.equal((await api('POST', '/stock/inwards', { supplier: 'Isuzu Parts Depot', invoiceNo: 'A1', lines: [{ partNo: '8973697471', qty: 3, unitCost: 1600 }] }, 'U002')).status, 403); // technician
  const grn = await api('POST', '/stock/inwards', { supplier: 'Isuzu Parts Depot', invoiceNo: 'inv-7781', lines: [{ partNo: '8973697471', qty: 3, unitCost: 1600 }, { partNo: '8980645060', qty: 2, unitCost: 4500 }] }, 'U006');
  assert.equal(grn.status, 200);
  assert.match(grn.body.id, /^GRN-\d{4}-\d{5}$/);
  assert.equal(grn.body.total, 3 * 1600 + 2 * 4500);
  assert.equal((await api('POST', '/stock/inwards', { supplier: 'isuzu parts depot', invoiceNo: 'INV-7781', lines: [{ partNo: '8973697471', qty: 1, unitCost: 1 }] })).status, 409); // same invoice twice
  assert.equal((await api('GET', '/stock/parts/8973697471')).body.onHand, 7);
  // stock cannot be typed into the parts master any more
  await api('PATCH', '/masters/parts/8973697471', { stock: 999 });
  assert.equal((await api('GET', '/masters/parts/8973697471')).body.stock, 7);

  // job card line for 5 brake pad sets, approved
  const id = 'RO-2026-00564';
  const j = (await api('POST', `/jobcards/${id}/lines`, { kind: 'part', code: '8973697471', qty: 5 })).body;
  const line = j.lines[j.lines.length - 1];
  assert.equal((await api('POST', `/jobcards/${id}/lines/${line.id}/issue`, {})).status, 409); // not approved yet
  await api('PATCH', `/jobcards/${id}/lines/${line.id}`, { status: 'approved' }, 'U001');
  assert.equal((await api('POST', `/jobcards/${id}/lines/${line.id}/issue`, {}, 'U002')).status, 403); // technician has no stock.issue
  const iss = await api('POST', `/jobcards/${id}/lines/${line.id}/issue`, {}, 'U006');
  assert.equal(iss.status, 200);
  const l2 = iss.body.lines.find((x) => x.id === line.id);
  assert.equal(l2.issuedQty, 5);
  // FIFO: 2 from the oldest batch, 2 from the next, 1 from the new inward
  assert.equal(l2.issueCost, Math.round((2 * older.unitCost + 2 * newer.unitCost + 1 * 1600) * 100) / 100);
  const after = (await api('GET', '/stock/parts/8973697471')).body;
  assert.equal(after.onHand, 2);
  assert.equal(after.fifo.filter((b) => b.remaining > 0).length, 1);
  assert.equal(after.fifo.find((b) => b.remaining > 0).unitCost, 1600);

  // an issued line cannot be removed, declined or reduced
  assert.equal((await api('DELETE', `/jobcards/${id}/lines/${line.id}`)).status, 409);
  assert.equal((await api('PATCH', `/jobcards/${id}/lines/${line.id}`, { status: 'declined', reason: 'Too expensive' })).status, 409);
  assert.equal((await api('PATCH', `/jobcards/${id}/lines/${line.id}`, { qty: 3 })).status, 409);
  // not enough stock for a further issue
  await api('PATCH', `/jobcards/${id}/lines/${line.id}`, { qty: 8 });
  assert.equal((await api('POST', `/jobcards/${id}/lines/${line.id}/issue`, {})).status, 409);

  // return 2: goes back to the batches issued last (the 1600 batch first, then the newer opening batch)
  assert.equal((await api('POST', `/jobcards/${id}/lines/${line.id}/return`, { qty: 2 })).status, 400); // reason required
  const ret = await api('POST', `/jobcards/${id}/lines/${line.id}/return`, { qty: 2, reason: 'Wrong part issued' });
  assert.equal(ret.status, 200);
  assert.equal(ret.body.lines.find((x) => x.id === line.id).issuedQty, 3);
  const back = (await api('GET', '/stock/parts/8973697471')).body;
  assert.equal(back.onHand, 4);
  assert.equal(back.fifo.find((b) => b.id === newer.id).remaining, 1);
  assert.equal(back.fifo.find((b) => b.unitCost === 1600).remaining, 3);
  assert.ok(back.movements.some((m) => m.kind === 'return'));

  // closing needs every approved part issued
  await api('PATCH', `/jobcards/${id}/lines/${line.id}`, { qty: 3 });
  await api('PATCH', `/jobcards/${id}/lines/1`, { status: 'approved' });
  await api('PATCH', `/jobcards/${id}/lines/2`, { status: 'approved' });
  const notIssued = await api('POST', `/jobcards/${id}/status`, { action: 'close', remarks: 'Done' });
  assert.equal(notIssued.status, 409);
  assert.match(notIssued.body.error, /8980937150/);
  assert.equal((await api('POST', `/jobcards/${id}/issue-parts`, {})).status, 200);
  assert.equal((await api('POST', `/jobcards/${id}/status`, { action: 'close', remarks: 'Done' })).status, 200);
  await api('POST', '/admin/reset');
});

test('repair type, fuel type and transmission type masters', async () => {
  await api('POST', '/admin/reset');
  const rt = (await api('GET', '/masters/repairTypes')).body;
  assert.ok(rt.find((r) => r.name === 'Periodic service' && r.code === 'PMS'));
  assert.equal((await api('GET', '/meta')).body.lookups.jobTypes.length, rt.length);
  // add, use, rename (cascades to job cards), protect while in use
  const nt = await api('POST', '/masters/repairTypes', { name: 'Body & paint', code: 'BP', description: 'Denting and painting' });
  assert.equal(nt.status, 200);
  assert.equal((await api('POST', '/masters/repairTypes', { name: 'body & paint', code: 'BP2' })).status, 409);
  const promisedAt = new Date(Date.now() + 86400000).toISOString();
  const job = await api('POST', '/jobcards', { vin: 'M3GTGS664J8AC1419', jobType: 'Body & paint', odometer: 5000, promisedAt, concerns: [{ text: 'Scratch on door' }], approval: { clientUnavailable: true } });
  assert.equal(job.status, 201);
  assert.equal((await api('POST', '/jobcards', { vin: 'MPAUCR85HJT000321', jobType: 'Teleportation', odometer: 5000, promisedAt, concerns: [{ text: 'x' }], approval: { clientUnavailable: true } })).status, 400);
  await api('PATCH', `/masters/repairTypes/${nt.body.id}`, { name: 'Body shop' });
  assert.equal((await api('GET', `/jobcards/${job.body.id}`)).body.jobType, 'Body shop');
  assert.equal((await api('DELETE', `/masters/repairTypes/${nt.body.id}`)).status, 409);
  // inactive repair type cannot be used for new job cards
  await api('PATCH', '/masters/repairTypes/RT007', { active: false });
  assert.ok(!(await api('GET', '/meta')).body.lookups.jobTypes.includes('PDI'));

  // fuel & transmission masters drive vehicle registration
  const ft = await api('POST', '/masters/fuelTypes', { name: 'CNG' });
  assert.equal(ft.status, 200);
  const tt = (await api('GET', '/masters/transmissions')).body;
  assert.ok(tt.some((t) => t.name === 'AMT'));
  const nv = { vin: 'MPATFS86JKT055501', reg: 'KA01AB', model: 'D-Max', fuel: 'CNG', transmission: 'AMT' };
  const cust = { name: 'Test Owner', phone: '0412555345' };
  assert.equal((await api('POST', '/vehicles/check', { newVehicle: Object.assign({}, nv, { fuel: 'Steam' }), customer: cust })).status, 400);
  assert.equal((await api('POST', '/vehicles/check', { newVehicle: nv, customer: cust })).status, 200);
  await api('PATCH', `/masters/fuelTypes/${ft.body.id}`, { active: false });
  assert.equal((await api('POST', '/vehicles/check', { newVehicle: nv, customer: cust })).status, 400);
  // a fuel type used by vehicles cannot be deleted; renaming updates the vehicles
  const diesel = (await api('GET', '/masters/fuelTypes')).body.find((f) => f.name === 'Diesel');
  assert.equal((await api('DELETE', `/masters/fuelTypes/${diesel.id}`)).status, 409);
  await api('PATCH', `/masters/fuelTypes/${diesel.id}`, { name: 'Diesel (BS6)' });
  assert.equal((await api('GET', '/vehicles/MPATFS86JHT010963')).body.fuel, 'Diesel (BS6)');
  // technicians cannot change setup masters
  assert.equal((await api('POST', '/masters/fuelTypes', { name: 'Hydrogen' }, 'U002')).status, 403);
  await api('POST', '/admin/reset');
});

test('stock adjustments: physical count and write-off follow FIFO', async () => {
  await api('POST', '/admin/reset');
  // engine oil 8980186710: opening 140 L = 70 older (cheaper) + 70 newer
  const oil = (await api('GET', '/stock/parts/8980186710')).body;
  const [older, newer] = oil.fifo;
  assert.equal(oil.onHand, 140);

  // rights: technician and advisor cannot adjust; parts manager can
  assert.equal((await api('POST', '/stock/adjustments', { type: 'writeoff', reason: 'Damaged', lines: [{ partNo: '8980186710', qty: 1 }] }, 'U002')).status, 403);
  assert.equal((await api('POST', '/stock/adjustments', { type: 'writeoff', reason: 'Damaged', lines: [{ partNo: '8980186710', qty: 1 }] }, 'U001')).status, 403);

  // write-off validation
  assert.equal((await api('POST', '/stock/adjustments', { type: 'writeoff', lines: [{ partNo: '8980186710', qty: 1 }] })).status, 400); // reason
  assert.equal((await api('POST', '/stock/adjustments', { type: 'writeoff', reason: 'Other', lines: [{ partNo: '8980186710', qty: 1 }] })).status, 400); // remarks for Other
  assert.equal((await api('POST', '/stock/adjustments', { type: 'writeoff', reason: 'Damaged', lines: [{ partNo: '8980186710', qty: 500 }] })).status, 409); // more than stock
  assert.equal((await api('POST', '/stock/adjustments', { type: 'writeoff', reason: 'Damaged', lines: [{ partNo: '8972186330', qty: 0.5 }] })).status, 400); // SET whole numbers
  assert.equal((await api('POST', '/stock/adjustments', { type: 'shrug', lines: [] })).status, 400);

  // write off 72 L: all 70 of the older batch + 2 of the newer one
  const wo = await api('POST', '/stock/adjustments', { type: 'writeoff', reason: 'Damaged', remarks: 'Drums leaked', lines: [{ partNo: '8980186710', qty: 72 }] }, 'U006');
  assert.equal(wo.status, 200);
  assert.match(wo.body.id, /^ADJ-\d{4}-\d{5}$/);
  assert.equal(wo.body.lines[0].qty, -72);
  assert.deepEqual(wo.body.lines[0].allocations.map((a) => [a.batchId, a.qty]), [[older.id, 70], [newer.id, 2]]);
  assert.equal(wo.body.value, -Math.round((70 * older.unitCost + 2 * newer.unitCost) * 100) / 100);
  const afterWo = (await api('GET', '/stock/parts/8980186710')).body;
  assert.equal(afterWo.onHand, 68);
  assert.ok(afterWo.movements.some((m) => m.kind === 'write-off' && m.qty === -72));

  // stock count: stale system quantity is refused
  const stale = await api('POST', '/stock/adjustments', { type: 'count', lines: [{ partNo: '8980186710', countedQty: 60, systemQty: 140 }] });
  assert.equal(stale.status, 409);
  // count: oil short by 8, filter surplus of 2, washer fluid matches
  const filter = (await api('GET', '/stock/parts/8981436420')).body;
  const cnt = await api('POST', '/stock/adjustments', { type: 'count', remarks: 'Month-end', lines: [
    { partNo: '8980186710', countedQty: 60, systemQty: 68 },
    { partNo: '8981436420', countedQty: filter.onHand + 2, systemQty: filter.onHand },
    { partNo: 'HBA096036', countedQty: 60, systemQty: 60 },
  ] });
  assert.equal(cnt.status, 200);
  assert.equal(cnt.body.lines.find((l) => l.partNo === '8980186710').qty, -8);
  assert.equal(cnt.body.lines.find((l) => l.partNo === 'HBA096036').qty, 0);
  const surplus = cnt.body.lines.find((l) => l.partNo === '8981436420');
  assert.equal(surplus.qty, 2);
  // surplus is a new batch valued at the latest batch cost
  const latestFilterCost = filter.fifo[filter.fifo.length - 1].unitCost;
  assert.equal(surplus.allocations[0].unitCost, latestFilterCost);
  assert.equal((await api('GET', '/stock/parts/8980186710')).body.onHand, 60);
  assert.equal((await api('GET', '/stock/parts/8981436420')).body.onHand, filter.onHand + 2);
  assert.equal((await api('GET', '/masters/parts/8981436420')).body.stock, filter.onHand + 2);
  // list and detail
  const list = (await api('GET', '/stock/adjustments')).body;
  assert.equal(list.length, 2);
  assert.equal(list[0].id, cnt.body.id);
  const detail = (await api('GET', `/stock/adjustments/${wo.body.id}`)).body;
  assert.equal(detail.lines[0].description, 'Engine oil 5W-30 (1 L)');
  await api('POST', '/admin/reset');
});

test('billing: tax invoice with 10% GST, payments, gate pass, credit note and re-invoice', async () => {
  await api('POST', '/admin/reset');
  // seed: the closed job already has INV-000001, paid
  const seeded = (await api('GET', '/invoices/INV-000001')).body;
  assert.equal(seeded.payStatus, 'paid');
  assert.equal(seeded.seller.abn, '51 824 753 556');

  const id = 'RO-2026-00564'; // A/C regas $145 + cabin filter $42, customer Coastal Plumbing (account customer)
  await api('PATCH', `/jobcards/${id}/lines/1`, { status: 'approved' });
  await api('PATCH', `/jobcards/${id}/lines/2`, { status: 'approved' });
  await api('POST', `/jobcards/${id}/issue-parts`, {});
  const closed = await api('POST', `/jobcards/${id}/status`, { action: 'close', remarks: 'Done' });
  assert.equal(closed.status, 200);
  assert.equal(closed.body.stage, 'ready_delivery');
  const invId = closed.body.invoice.number;
  assert.match(invId, /^INV-\d{6}$/);
  const inv = (await api('GET', `/invoices/${invId}`)).body;
  assert.equal(inv.subtotal, 187);
  assert.equal(inv.gst, 18.7);
  assert.equal(inv.total, 205.7);
  assert.equal(inv.billTo.abn, '33 102 407 376');
  assert.equal(inv.termsDays, 30); // account customer
  assert.equal(inv.payStatus, 'unpaid');

  // account customer can be released without paying
  const gp = await api('POST', `/jobcards/${id}/gatepass`, {}, 'U001');
  assert.equal(gp.status, 200);
  assert.match(gp.body.gatePass.number, /^GP-\d{6}$/);
  assert.equal(gp.body.stage, 'delivered');
  const debtors = (await api('GET', '/debtors')).body;
  assert.equal(debtors.rows.find((r) => r.name === 'Coastal Plumbing Pty Ltd').total, 205.7);

  // payments: method + amount checks, part payment then full
  assert.equal((await api('POST', `/invoices/${invId}/payments`, { method: 'Bitcoin', amount: 10 })).status, 400);
  assert.equal((await api('POST', `/invoices/${invId}/payments`, { method: 'EFTPOS', amount: 500 })).status, 409);
  assert.equal((await api('POST', `/invoices/${invId}/payments`, { method: 'EFTPOS', amount: 100 }, 'U002')).status, 403); // technician
  const p1 = await api('POST', `/invoices/${invId}/payments`, { method: 'Bank transfer', amount: 100, reference: 'CBA 7781' }, 'U001');
  assert.equal(p1.body.payStatus, 'part-paid');
  assert.equal(p1.body.balance, 105.7);
  assert.match(p1.body.receipt.id, /^RCT-\d{6}$/);
  const p2 = await api('POST', `/invoices/${invId}/payments`, { method: 'PayID', amount: 105.7 });
  assert.equal(p2.body.payStatus, 'paid');

  // refunds need the override right and a reason
  assert.equal((await api('POST', `/invoices/${invId}/refunds`, { method: 'EFTPOS', amount: 5, reason: 'x' }, 'U001')).status, 403);
  assert.equal((await api('POST', `/invoices/${invId}/refunds`, { method: 'EFTPOS', amount: 5 })).status, 400);

  // reopen: credit note for the full amount, the paid money moves to the new invoice on re-close
  const re = await api('POST', `/jobcards/${id}/status`, { action: 'reopen', remarks: 'Comeback – A/C noisy' });
  assert.equal(re.body.status, 'active');
  assert.ok(!re.body.gatePass);
  const old = (await api('GET', `/invoices/${invId}`)).body;
  assert.equal(old.status, 'credited');
  const cn = (await api('GET', `/invoices/${old.creditedBy}`)).body;
  assert.equal(cn.kind, 'credit');
  assert.equal(cn.total, -205.7);
  const again = await api('POST', `/jobcards/${id}/status`, { action: 'close', remarks: 'Re-done' });
  const newInv = (await api('GET', `/invoices/${again.body.invoice.number}`)).body;
  assert.notEqual(newInv.id, invId);
  assert.equal(newInv.payStatus, 'paid'); // credit carried over
  assert.ok(newInv.payments.some((p) => p.method === 'Transfer'));
  await api('POST', '/admin/reset');
});

test('billing: a private customer must pay before the vehicle is released', async () => {
  await api('POST', '/admin/reset');
  const id = 'RO-2026-00549'; // wheel alignment $129, Jason Nguyen (not on account)
  const closed = await api('POST', `/jobcards/${id}/status`, { action: 'close', remarks: 'Done' });
  const invId = closed.body.invoice.number;
  assert.equal((await api('GET', `/invoices/${invId}`)).body.total, 141.9);
  const blocked = await api('POST', `/jobcards/${id}/gatepass`, {});
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /141\.90/);
  assert.equal((await api('POST', `/jobcards/${id}/gatepass`, { override: true }, 'U001')).status, 403); // advisor cannot override
  assert.equal((await api('POST', `/jobcards/${id}/gatepass`, { override: true })).status, 400); // reason needed
  await api('POST', `/invoices/${invId}/payments`, { method: 'Cash', amount: 141.9 });
  assert.equal((await api('POST', `/jobcards/${id}/gatepass`, {})).status, 200);
  assert.equal((await api('POST', `/jobcards/${id}/gatepass`, {})).status, 409); // only once
  await api('POST', '/admin/reset');
});

test('claims: insurer pays the repair, customer pays the excess; warranty billed to the manufacturer', async () => {
  await api('POST', '/admin/reset');
  const id = 'RO-2026-00558'; // accident repair: diagnostic $165 + wipers $54 = $219 ex GST, $240.90 incl
  assert.equal((await api('PUT', `/jobcards/${id}/claim`, { type: 'insurance', insurerId: 'INS999', claimNo: 'A1' })).status, 400);
  const c = await api('PUT', `/jobcards/${id}/claim`, { type: 'insurance', insurerId: 'INS001', claimNo: 'nrma-778812', excess: 100, assessor: 'J. Patel' });
  assert.equal(c.status, 200);
  assert.equal(c.body.claim.status, 'lodged');
  assert.ok(c.body.lines.every((l) => l.payer === 'claim'));
  await api('POST', `/jobcards/${id}/issue-parts`, {});
  // cannot invoice before the insurer authorises
  const early = await api('POST', `/jobcards/${id}/status`, { action: 'close', remarks: 'x' });
  assert.equal(early.status, 409);
  assert.match(early.body.error, /authorised/);
  assert.equal((await api('POST', `/jobcards/${id}/claim/status`, { status: 'authorised' })).status, 400); // amount needed
  await api('POST', `/jobcards/${id}/claim/status`, { status: 'authorised', authorisedAmount: 240.9, authorityNo: 'auth-55' });
  const closed = await api('POST', `/jobcards/${id}/status`, { action: 'close', remarks: 'Repair complete' });
  assert.equal(closed.status, 200);
  const invs = closed.body.invoice.invoices;
  assert.equal(invs.length, 2);
  const ins = (await api('GET', `/invoices/${invs.find((i) => i.payer === 'insurer').id}`)).body;
  const cust = (await api('GET', `/invoices/${invs.find((i) => i.payer === 'customer').id}`)).body;
  assert.equal(ins.billTo.name, 'NRMA Insurance');
  assert.equal(ins.claimNo, 'NRMA-778812');
  assert.equal(cust.total, 100);
  assert.equal(cust.gst, 9.09);
  assert.equal(ins.total, 140.9);
  assert.equal(r2(ins.total + cust.total), 240.9);
  // customer pays excess -> can leave; insurer pays later -> claim paid
  await api('POST', `/invoices/${cust.id}/payments`, { method: 'EFTPOS', amount: 100 });
  assert.equal((await api('POST', `/jobcards/${id}/gatepass`, {})).status, 200);
  await api('POST', `/invoices/${ins.id}/payments`, { method: 'Bank transfer', amount: 140.9, reference: 'NRMA EFT' });
  assert.equal((await api('GET', `/jobcards/${id}`)).body.claim.status, 'paid');

  // warranty: manufacturer pays, a customer-paid extra goes on the customer invoice
  const w = 'RO-2026-00563';
  await api('PUT', `/jobcards/${w}/claim`, { type: 'warranty', claimNo: 'w-26-0091' });
  await api('PATCH', `/jobcards/${w}/lines/6`, { payer: 'customer' }); // mirror is not covered
  for (const l of [4, 5, 6]) await api('PATCH', `/jobcards/${w}/lines/${l}`, { status: 'approved' });
  await api('POST', '/stock/inwards', { supplier: 'Isuzu Australia Parts', invoiceNo: 'W1', lines: [{ partNo: '8974460950', qty: 2, unitCost: 100 }] });
  await api('POST', `/jobcards/${w}/issue-parts`, {});
  const wc = await api('POST', `/jobcards/${w}/status`, { action: 'close', remarks: 'Done' });
  assert.equal(wc.status, 200);
  const wInvs = wc.body.invoice.invoices;
  assert.deepEqual(wInvs.map((i) => i.payer).sort(), ['customer', 'manufacturer']);
  const manu = (await api('GET', `/invoices/${wInvs.find((i) => i.payer === 'manufacturer').id}`)).body;
  assert.equal(manu.billTo.name, 'Isuzu Australia Limited');
  assert.ok(!manu.lines.some((l) => l.code === '8980645060'));
  const wcust = (await api('GET', `/invoices/${wInvs.find((i) => i.payer === 'customer').id}`)).body;
  assert.deepEqual(wcust.lines.map((l) => l.code), ['8980645060']);
  assert.equal(wcust.total, 533.5);
  await api('POST', '/admin/reset');
});

test('workshop profile: ABN, postcode and BSB validation', async () => {
  await api('POST', '/admin/reset');
  assert.equal((await api('PATCH', '/settings/workshop', { abn: '12 345 678 901' })).status, 400);
  assert.equal((await api('PATCH', '/settings/workshop', { state: 'VIC', postcode: '2144' })).status, 400);
  assert.equal((await api('PATCH', '/settings/workshop', { bsb: '12-34' })).status, 400);
  assert.equal((await api('PATCH', '/settings/workshop', { name: 'X' }, 'U001')).status, 403);
  const ok = await api('PATCH', '/settings/workshop', { bsb: '062 111', phone: '+61 2 9748 1100', postcode: '2144', state: 'NSW' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.bsb, '062-111');
  assert.equal(ok.body.phone, '(02) 9748 1100');
  await api('POST', '/admin/reset');
});

test('purchasing: reorder → PO → part receipt with GST → return → supplier payment', async () => {
  await api('POST', '/admin/reset');
  // rotor 8974460950 has 0 in stock (reorder level 2) -> suggested
  const sug = (await api('GET', '/purchasing/reorder')).body;
  const rotor = sug.find((r) => r.partNo === '8974460950');
  assert.ok(rotor && rotor.suggestQty >= 4);
  // suppliers master with ABN check
  assert.equal((await api('POST', '/masters/suppliers', { name: 'Bad ABN Pty Ltd', abn: '11 111 111 111' })).status, 400);
  assert.equal((await api('POST', '/masters/suppliers', { name: 'X' }, 'U001')).status, 403); // advisor
  // create PO (parts manager), validation
  assert.equal((await api('POST', '/purchase-orders', { supplierId: 'SUP999', lines: [{ partNo: '8974460950', qty: 1, unitCost: 1 }] })).status, 400);
  assert.equal((await api('POST', '/purchase-orders', { supplierId: 'SUP001', lines: [{ partNo: '8974460950', qty: 1.5, unitCost: 1 }] })).status, 400);
  const po = await api('POST', '/purchase-orders', { supplierId: 'SUP001', lines: [{ partNo: '8974460950', qty: 4, unitCost: 98 }, { partNo: '8973697471', qty: 2, unitCost: 120 }] }, 'U006');
  assert.equal(po.status, 200);
  assert.match(po.body.id, /^PO-\d{6}$/);
  assert.equal(po.body.subtotal, 632);
  assert.equal(po.body.gst, 63.2);
  assert.equal((await api('GET', '/purchasing/reorder')).body.find((r) => r.partNo === '8974460950').onOrder, 4);
  assert.equal((await api('POST', `/purchase-orders/${po.body.id}/send`, {})).body.status, 'sent');
  assert.equal((await api('PATCH', `/purchase-orders/${po.body.id}`, { notes: 'x' })).status, 409); // sent POs are locked

  // receive part of it against the PO: GST captured, terms from the supplier (30 days)
  assert.equal((await api('POST', '/stock/inwards', { supplierId: 'SUP001', poId: po.body.id, invoiceNo: 'IA-1001', lines: [{ partNo: '8974460950', qty: 5, unitCost: 98 }] })).status, 409); // more than ordered
  assert.equal((await api('POST', '/stock/inwards', { supplierId: 'SUP002', poId: po.body.id, invoiceNo: 'IA-1001', lines: [{ partNo: '8974460950', qty: 1, unitCost: 98 }] })).status, 400); // wrong supplier
  const g = await api('POST', '/stock/inwards', { supplierId: 'SUP001', poId: po.body.id, invoiceNo: 'IA-1001', invoiceDate: new Date().toISOString(), lines: [{ partNo: '8974460950', qty: 4, unitCost: 98 }] });
  assert.equal(g.status, 200);
  assert.equal(g.body.total, 392);
  assert.equal(g.body.gst, 39.2);
  assert.equal(g.body.totalInc, 431.2);
  assert.equal((await api('GET', `/purchase-orders/${po.body.id}`)).body.status, 'part-received');

  // return 1 damaged rotor to the supplier -> credit reduces what we owe
  const bill = (await api('GET', `/stock/inwards/${g.body.id}/bill`)).body;
  const batch = (await api('GET', '/stock/parts/8974460950')).body.fifo.find((b) => b.inwardId === g.body.id);
  assert.equal((await api('POST', '/stock/returns', { inwardId: g.body.id, reason: 'Damaged in transit', lines: [{ batchId: batch.id, qty: 9 }] })).status, 409);
  const ret = await api('POST', '/stock/returns', { inwardId: g.body.id, reason: 'Damaged in transit', lines: [{ batchId: batch.id, qty: 1 }] });
  assert.equal(ret.status, 200);
  assert.equal(ret.body.totalInc, 107.8);
  assert.equal((await api('GET', '/stock/parts/8974460950')).body.onHand, 3);
  assert.equal(bill.balance, 431.2);
  const payables = (await api('GET', '/payables')).body;
  assert.equal(payables.rows.find((r) => r.supplierId === 'SUP001').total, 323.4);

  // pay the supplier
  assert.equal((await api('POST', `/stock/inwards/${g.body.id}/payments`, { method: 'Bank transfer', amount: 400 })).status, 409);
  assert.equal((await api('POST', `/stock/inwards/${g.body.id}/payments`, { method: 'Bank transfer', amount: 10 }, 'U006')).status, 403); // parts manager can't pay
  const pay = await api('POST', `/stock/inwards/${g.body.id}/payments`, { method: 'Bank transfer', amount: 323.4, reference: 'EFT 8812' });
  assert.equal(pay.body.status, 'paid');
  assert.equal((await api('GET', '/payables')).body.rows.length, 0);

  // close the PO short (the brake pads never came)
  assert.equal((await api('POST', `/purchase-orders/${po.body.id}/cancel`, { reason: 'Pads on back order' })).body.status, 'received');
  // a supplier with history can't be deleted
  assert.equal((await api('DELETE', '/masters/suppliers/SUP001')).status, 409);
  await api('POST', '/admin/reset');
});

test('reports: GST/BAS summary, sales, payments, CSV export', async () => {
  await api('POST', '/admin/reset');
  // sale: wheel alignment $129 + GST = $141.90, paid by EFTPOS
  const c = await api('POST', '/jobcards/RO-2026-00549/status', { action: 'close', remarks: 'Done' });
  await api('POST', `/invoices/${c.body.invoice.number}/payments`, { method: 'EFTPOS', amount: 141.9 });
  // purchase: 2 cabin filters at $30 + GST
  await api('POST', '/stock/inwards', { supplierId: 'SUP002', invoiceNo: 'R-1', lines: [{ partNo: '8980937150', qty: 2, unitCost: 30 }] });
  const today = new Date().toLocaleDateString('en-CA');
  const gst = (await api('GET', `/reports/gst?from=${today}&to=${today}`)).body;
  const v = (code) => gst.rows.find((r) => r.code === code).amount;
  assert.equal(v('G1'), 141.9);
  assert.equal(v('1A'), 12.9);
  assert.equal(v('G11'), 66);
  assert.equal(v('1B'), 6);
  assert.equal(v('NET'), 6.9);
  const sales = (await api('GET', `/reports/sales?from=${today}&to=${today}`)).body;
  assert.equal(sales.totals.labour, 129);
  assert.equal(sales.totals.total, 141.9);
  const pays = (await api('GET', `/reports/payments?from=${today}&to=${today}`)).body;
  assert.equal(pays.totals.EFTPOS, 141.9);
  // CSV
  const r = await fetch(`${BASE}/reports/sales?from=${today}&to=${today}&format=csv`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/csv/);
  const csv = await r.text();
  assert.match(csv, /Total incl GST/);
  assert.match(csv, /141\.9/);
  // other reports run
  for (const name of ['debtors', 'purchases', 'jobs', 'technicians', 'satisfaction', 'parts', 'stock', 'adjustments']) {
    const x = await api('GET', `/reports/${name}?from=2020-01-01&to=${today}`);
    assert.equal(x.status, 200, name);
    assert.ok(Array.isArray(x.body.rows), name);
  }
  assert.equal((await api('GET', '/reports/nope')).status, 404);
  assert.equal((await api('GET', '/reports/gst', null, 'U001')).status, 403); // advisors don't see reports
  assert.equal((await api('GET', '/reports/gst?from=2026-02-30x')).status, 400);
  await api('POST', '/admin/reset');
});

test('messaging: quote link, customer approves online, outbox, Spam Act consent', async () => {
  await api('POST', '/admin/reset');
  const prev = await api('POST', '/messages/preview', { template: 'estimate', channel: 'sms', jobId: 'RO-2026-00563' });
  assert.equal(prev.status, 200);
  assert.match(prev.body.body, /Hi Daniel, your quote for the D-Max \(DX84TR\)/);
  assert.equal(prev.body.to, '0412 555 018');
  // no SMS provider in tests -> kept in the outbox as not sent
  const sent = await api('POST', '/messages/send', { template: 'estimate', channel: 'sms', jobId: 'RO-2026-00563' });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.status, 'not-configured');
  assert.equal(sent.body.to, '0412555018');
  const token = sent.body.body.match(/\/p\/([A-Za-z0-9_-]+)/)[1];
  // the customer opens the link (no sign-in) and approves the rotors, declines the mirror
  const pub = await fetch(`${BASE}/public/${token}`);
  assert.equal(pub.status, 200);
  const q = await pub.json();
  assert.equal(q.kind, 'estimate');
  assert.equal(q.shop.abn, '51 824 753 556');
  assert.ok(q.lines.some((l) => l.id === 4 && l.status === 'pending'));
  const post = (b) => fetch(`${BASE}/public/${token}/decision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  assert.equal((await post({ decisions: [{ lineId: 4, decision: 'approved' }] })).status, 400); // name required
  assert.equal((await post({ name: 'Daniel Murphy', decisions: [{ lineId: 4, decision: 'approved' }, { lineId: 5, decision: 'approved' }, { lineId: 6, decision: 'declined' }] })).status, 200);
  const j = (await api('GET', '/jobcards/RO-2026-00563')).body;
  assert.equal(j.lines.find((l) => l.id === 4).status, 'approved');
  assert.equal(j.lines.find((l) => l.id === 6).status, 'declined');
  assert.ok(j.activity.some((a) => /Customer \(Daniel Murphy\) online/.test(a.text)));
  assert.equal((await fetch(`${BASE}/public/not-a-real-token`)).status, 404);
  // outbox
  const box = (await api('GET', '/messages?jobId=RO-2026-00563')).body;
  assert.equal(box.length, 1);
  // service reminders need marketing consent
  await api('PATCH', '/vehicles/MPAUCR85HJT000321/owner', { smsOptIn: false });
  const rem = await api('POST', '/reminders/send', { vins: ['MPAUCR85HJT000321'], channel: 'sms' });
  assert.equal(rem.body.results[0].status, 'skipped');
  assert.equal((await api('POST', '/messages/send', { template: 'custom', channel: 'sms', jobId: 'RO-2026-00563', body: 'Hello', to: '12345' })).status, 400);
  assert.equal((await api('POST', '/messages/send', { template: 'estimate', channel: 'sms', jobId: 'RO-2026-00563' }, 'U002')).status, 403); // technician
  await api('POST', '/admin/reset');
});

test('time clock, workshop board, appointments', async () => {
  await api('POST', '/admin/reset');
  // technician clocks on to a job (moves it to in progress), then to another one
  const on = await api('POST', '/jobcards/RO-2026-00564/clock', { action: 'on' }, 'U003');
  assert.equal(on.status, 200);
  assert.deepEqual(on.body.onNow, ['Ravi P']);
  assert.equal((await api('GET', '/jobcards/RO-2026-00564')).body.stage, 'in_progress');
  assert.equal((await api('POST', '/jobcards/RO-2026-00564/clock', { action: 'on' }, 'U003')).status, 409);
  await api('POST', '/jobcards/RO-2026-00563/clock', { action: 'on' }, 'U003'); // auto clocks off 564
  assert.equal((await api('GET', '/jobcards/RO-2026-00564/time')).body.onNow.length, 0);
  const me = (await api('GET', '/timeclock/me', null, 'U003')).body;
  assert.equal(me.open.jobId, 'RO-2026-00563');
  assert.equal((await api('POST', '/jobcards/RO-2026-00563/clock', { action: 'on' }, 'U001')).status, 403); // advisors don't clock
  const board = (await api('GET', '/board')).body;
  assert.equal(board.technicians.find((t) => t.name === 'Ravi P').clockedOn.jobId, 'RO-2026-00563');
  assert.ok(board.bays.find((b) => b.bay === 'Bay 2').jobs.some((x) => x.id === 'RO-2026-00563'));
  assert.equal((await api('POST', '/jobcards/RO-2026-00563/clock', { action: 'off' }, 'U003')).status, 200);

  // appointments
  const at = new Date(Date.now() + 2 * 86400000); at.setHours(9, 0, 0, 0);
  assert.equal((await api('POST', '/appointments', { at: at.toISOString(), customerName: 'Walk Up', phone: '123' })).status, 400);
  const a = await api('POST', '/appointments', { at: at.toISOString(), customerName: 'Sam Taylor', phone: '0412 555 777', rego: 'abc12d', vehicle: 'D-Max', repairType: 'Paid service' });
  assert.equal(a.status, 200);
  assert.equal(a.body.rego, 'ABC12D');
  const b = await api('POST', '/appointments', { at: at.toISOString(), vin: 'MPAUCR85HJT000321', repairType: 'Periodic service' });
  assert.equal(b.body.customerName, 'Emma Wilson');
  assert.equal((await api('POST', '/appointments', { at: new Date(at.getTime() + 3600000).toISOString(), vin: 'MPAUCR85HJT000321' })).status, 409); // double booking
  const list = (await api('GET', `/appointments?from=${new Date().toISOString()}&to=${new Date(Date.now() + 7 * 86400000).toISOString()}`)).body;
  assert.ok(list.length >= 3);
  assert.equal((await api('POST', `/appointments/${a.body.id}/status`, { status: 'cancelled' })).status, 400); // reason
  assert.equal((await api('POST', `/appointments/${a.body.id}/status`, { status: 'cancelled', reason: 'Customer sold the car' })).body.status, 'cancelled');
  const rem = await api('POST', `/appointments/${b.body.id}/remind`, {});
  assert.equal(rem.body.message.status, 'not-configured');
  assert.match(rem.body.message.body, /Reminder: your MU-X \(1HKR210\) is booked in at Harbour City Isuzu Service/);
  // opening a job card for a vehicle booked in today links the booking
  const today = new Date(Date.now() + 3600000);
  const c = await api('POST', '/appointments', { at: today.toISOString(), vin: 'M3GTGS664J8AC1419', repairType: 'Paid service' });
  const job = await api('POST', '/jobcards', { vin: 'M3GTGS664J8AC1419', jobType: 'Paid service', odometer: 30000, promisedAt: new Date(Date.now() + 86400000).toISOString(), concerns: [{ text: 'Service' }], approval: { clientUnavailable: true } });
  assert.equal(job.status, 201);
  const linked = (await api('GET', `/appointments?from=${new Date(Date.now() - 86400000).toISOString()}&to=${new Date(Date.now() + 9 * 86400000).toISOString()}`)).body.find((x) => x.jobId === job.body.id);
  assert.ok(linked, 'booking linked to the new job card');
  // service reminders list
  assert.ok(Array.isArray((await api('GET', '/reminders?days=400')).body));
  await api('POST', '/admin/reset');
});

test('photos & files, dropdown lists, audit', async () => {
  await api('POST', '/admin/reset');
  // a 1x1 PNG
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  assert.equal((await api('POST', '/jobcards/RO-2026-00558/attachments', { name: 'x.exe', type: 'application/x-msdownload', data: 'AAAA' })).status, 400);
  const a = await api('POST', '/jobcards/RO-2026-00558/attachments', { name: 'bumper.png', type: 'image/png', data: png, caption: 'Front bumper', category: 'Damage photo' });
  assert.equal(a.status, 200);
  const list = (await api('GET', '/jobcards/RO-2026-00558/attachments')).body;
  assert.equal(list.length, 1);
  const file = await fetch(`${BASE}/attachments/${a.body.id}/file`);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('content-type'), 'image/png');
  assert.equal((await file.arrayBuffer()).byteLength, a.body.size);
  assert.equal((await api('POST', '/jobcards/RO-2026-00558/attachments', { name: 'b.png', type: 'image/png', data: png }, 'U006')).status, 403); // parts manager can't edit jobs
  assert.equal((await api('DELETE', `/attachments/${a.body.id}`)).status, 200);
  // lists
  const lists = (await api('GET', '/settings/lists')).body;
  assert.ok(lists.find((l) => l.key === 'bays').values.includes('Bay 1'));
  assert.equal((await api('PUT', '/settings/lists/bays', { values: ['Bay 1', 'bay 1'] })).status, 400); // duplicates
  assert.equal((await api('PUT', '/settings/lists/bays', { values: ['Bay 9'] })).status, 409); // bays in use by open jobs
  assert.equal((await api('PUT', '/settings/lists/declineReasons', { values: ['Too expensive', 'Will do it myself'] })).status, 200);
  assert.ok((await api('GET', '/meta')).body.lookups.declineReasons.includes('Will do it myself'));
  assert.equal((await api('PUT', '/settings/lists/declineReasons', { values: ['x'] }, 'U001')).status, 403);
  // audit
  const audit = (await api('GET', '/audit?q=decline')).body;
  assert.ok(audit.some((x) => /Decline reasons/.test(x.text)));
  assert.equal((await api('GET', '/audit', null, 'U001')).status, 403);
  await api('POST', '/admin/reset');
});

test('CSV import: dry run, errors, commit', async () => {
  await api('POST', '/admin/reset');
  const parts = [
    { partNo: '8981111111', description: 'Spark plug', category: 'Engine', brand: 'Isuzu', source: 'OEM', unit: 'EA', sellPrice: '12.50', gstPct: '10', reorderLevel: '4', openingQty: '20', unitCost: '7.80' },
    { partNo: '8981436420', description: 'dup', sellPrice: '1' }, // already exists
  ];
  const dry = (await api('POST', '/import/parts', { rows: parts })).body;
  assert.equal(dry.ok, 1);
  assert.equal(dry.failed, 1);
  assert.equal((await api('GET', '/stock/parts/8981111111')).status, 404); // dry run saved nothing
  assert.equal((await api('POST', '/import/parts', { rows: parts, commit: true })).status, 400); // errors block commit
  const ok = await api('POST', '/import/parts', { rows: [parts[0]], commit: true });
  assert.equal(ok.body.committed, true);
  assert.equal((await api('GET', '/stock/parts/8981111111')).body.onHand, 20);
  // customers & vehicles: one new customer, one added to an existing customer by mobile
  const veh = [
    { rego: 'NEW01A', regState: 'NSW', vin: 'MPATFS86JKT044401', model: 'D-Max', customerName: 'Jane Citizen', mobile: '0412 345 678', email: 'jane@example.com' },
    { rego: 'NEW02B', regState: 'NSW', vin: 'MPATFS86JKT044402', model: 'MU-X', customerName: 'Daniel M', mobile: '0412555018' },
    { rego: 'BAD', vin: 'SHORT', model: 'X', customerName: 'Y', mobile: '0412000000' },
  ];
  const vdry = (await api('POST', '/import/customers-vehicles', { rows: veh })).body;
  assert.equal(vdry.failed, 1);
  assert.match(vdry.results[1].note, /existing customer C-12418/);
  await api('POST', '/import/customers-vehicles', { rows: veh.slice(0, 2), commit: true });
  assert.equal((await api('GET', '/vehicles/MPATFS86JKT044402')).body.owner.customerId, 'C-12418');
  // labour
  assert.equal((await api('POST', '/import/labour', { rows: [{ code: 'X200', group: 'Electrical', description: 'Headlight alignment', minutes: '20', price: '55' }], commit: true })).status, 200);
  assert.equal((await api('POST', '/import/parts', { rows: parts }, 'U001')).status, 403);
  await api('POST', '/admin/reset');
});

test('backup and restore', async () => {
  await api('POST', '/admin/reset');
  const r = await fetch(`${BASE}/admin/backup`);
  assert.equal(r.status, 200);
  const backup = await r.json();
  assert.equal(backup.format, 'workshop-pro-backup');
  // change something, then restore
  await api('PATCH', '/masters/users/U001', { name: 'Arun K (changed)' });
  assert.equal((await api('POST', '/admin/restore', Object.assign({}, backup))).status, 400); // needs RESTORE
  assert.equal((await api('POST', '/admin/restore', { format: 'nope' })).status, 400);
  assert.equal((await api('POST', '/admin/restore', Object.assign({}, backup, { confirm: 'RESTORE' }), 'U001')).status, 403);
  const ok = await api('POST', '/admin/restore', Object.assign({}, backup, { confirm: 'RESTORE' }));
  assert.equal(ok.status, 200);
  assert.equal((await api('GET', '/masters/users/U001')).body.name, 'Arun Kumar');
  await api('POST', '/admin/reset');
});

test('packages & campaigns masters, branches, stock reservations', async () => {
  await api('POST', '/admin/reset');
  // packages
  assert.equal((await api('POST', '/masters/packages', { code: 'EMPTY', name: 'Empty' })).status, 400);
  assert.equal((await api('POST', '/masters/packages', { code: 'P1', name: 'Bad', parts: [['NOPE', 1]] })).status, 400);
  const pk = await api('POST', '/masters/packages', { code: 'brk-r', name: 'Rear brake service', group: 'Wear & tear', parts: [['BO-PAD-7781', 1]], labour: ['H0140'] });
  assert.equal(pk.status, 200);
  assert.ok((await api('GET', '/catalog/packages')).body.some((p) => p.code === 'BRK-R'));
  await api('PATCH', '/masters/packages/BRK-R', { active: false });
  assert.ok(!(await api('GET', '/catalog/packages')).body.some((p) => p.code === 'BRK-R'));
  // campaigns: expired ones are not offered on new job cards
  const cmp = await api('POST', '/masters/campaigns', { name: 'Old offer', type: 'Offer', validTill: '2020-01-01', discountPct: 10 });
  assert.match(cmp.body.id, /^CMP\d{3}$/);
  const promisedAt = new Date(Date.now() + 86400000).toISOString();
  const job = await api('POST', '/jobcards', { vin: 'M3GTGS664J8AC1419', jobType: 'Paid service', odometer: 5000, promisedAt, concerns: [{ text: 'x' }], approval: { clientUnavailable: true } });
  assert.ok(!job.body.campaigns.some((c) => c.id === cmp.body.id));

  // branches: the new job is at the default branch; a user limited to Parramatta can't see it
  assert.equal(job.body.outletId, 'OUT001');
  await api('PATCH', '/masters/users/U004', { outletIds: ['OUT002'] });
  const imran = await fetch(`${BASE}/jobcards`, { headers: { 'X-User-Id': 'U004' } }).then((r) => r.json());
  assert.equal(imran.length, 0);
  assert.equal((await api('GET', `/jobcards/${job.body.id}`, null, 'U004')).status, 403);
  const pj = await fetch(`${BASE}/jobcards`, { headers: { 'X-User-Id': 'U008', 'X-Outlet-Id': 'OUT002' } }).then((r) => r.json());
  assert.equal(pj.length, 0);
  const all = await fetch(`${BASE}/jobcards`, { headers: { 'X-User-Id': 'U008', 'X-Outlet-Id': 'all' } }).then((r) => r.json());
  assert.ok(all.length >= 5);
  assert.equal((await fetch(`${BASE}/jobcards`, { headers: { 'X-User-Id': 'U004', 'X-Outlet-Id': 'OUT001' } })).status, 403);

  // reservations hold stock: only 1 mirror in stock, reserved for 563 -> 564 can't issue it
  await api('PATCH', '/jobcards/RO-2026-00563/lines/6', { status: 'approved' });
  assert.equal((await api('PATCH', '/jobcards/RO-2026-00563/lines/6', { blocked: true })).status, 200);
  const l = (await api('POST', '/jobcards/RO-2026-00564/lines', { kind: 'part', code: '8980645060', qty: 1 })).body.lines.pop();
  await api('PATCH', `/jobcards/RO-2026-00564/lines/${l.id}`, { status: 'approved' });
  assert.equal((await api('PATCH', `/jobcards/RO-2026-00564/lines/${l.id}`, { blocked: true })).status, 409);
  const iss = await api('POST', `/jobcards/RO-2026-00564/lines/${l.id}/issue`, {});
  assert.equal(iss.status, 409);
  assert.match(iss.body.error, /reserved/);
  assert.equal((await api('POST', '/jobcards/RO-2026-00563/lines/6/issue', {})).status, 200); // the reserving job can
  const st = (await api('GET', '/stock?q=8980645060')).body.rows[0];
  assert.equal(st.reserved, 0);
  await api('POST', '/admin/reset');
});
