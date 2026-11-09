// Roles & rights: the built-in rights catalogue, default roles, which right each
// API endpoint needs, and the permission check.
//
// A user has exactly one role (users.role = role name). A role holds a list of right
// codes. The built-in Administrator role (system: true) always has every right.

const MODULES = ['Dashboard', 'Job cards', 'Billing', 'Vehicles', 'Inventory', 'Reports', 'Masters', 'Administration', 'Other'];

// [code, module, name, description]
const RIGHTS = [
  ['dashboard.view', 'Dashboard', 'View dashboard', 'KPIs, workshop pipeline, deliveries and recent activity'],
  ['jobs.view', 'Job cards', 'View job cards', 'Open the job card list and job card details'],
  ['jobs.create', 'Job cards', 'Open job cards', 'Walk-in check-in and the new job card wizard'],
  ['jobs.edit', 'Job cards', 'Edit job cards', 'Job details, technician, concerns, inspection, body damage, campaigns, delivery time, notes and emails'],
  ['jobs.estimate', 'Job cards', 'Edit estimates', 'Add, change, remove and replace estimate lines'],
  ['jobs.approve', 'Job cards', 'Record customer approval', 'Mark estimate lines approved or declined'],
  ['jobs.stage', 'Job cards', 'Move job stage', 'Move a job card through the workshop stages'],
  ['jobs.hold', 'Job cards', 'Hold and resume', 'Put job cards on hold and resume them'],
  ['jobs.feedback', 'Job cards', 'Record feedback', 'Save the customer feedback survey'],
  ['jobs.clock', 'Job cards', 'Clock on / off jobs', 'Technician time clocking on job cards'],
  ['appointments.manage', 'Job cards', 'Manage bookings', 'Book, change and cancel appointments'],
  ['messages.send', 'Job cards', 'Send customer messages', 'SMS and email customers (quotes, vehicle ready, invoices, reminders) and see the outbox'],
  ['billing.proforma', 'Billing', 'Quotes', 'Prepare quotes (estimates) for customers'],
  ['billing.view', 'Billing', 'View invoices', 'Tax invoices, credit notes, payments and debtors'],
  ['billing.payments', 'Billing', 'Take payments', 'Record EFTPOS, card, cash, bank transfer, PayID and BPAY payments and issue gate passes'],
  ['billing.override', 'Billing', 'Refunds, accounts and unpaid release', 'Refund payments, set up account customers and release a vehicle with money owing'],
  ['jobs.close', 'Billing', 'Close and invoice', 'Close job cards and issue the tax invoice'],
  ['jobs.reopen', 'Billing', 'Reopen job cards', 'Reopen closed job cards (issues a credit note)'],
  ['vehicles.view', 'Vehicles', 'View vehicles', 'Vehicle search and vehicle profile'],
  ['vehicles.create', 'Vehicles', 'Register vehicles and customers', 'Add a vehicle that is not on file, for an existing or a new customer, while opening a job card'],
  ['vehicles.edit', 'Vehicles', 'Edit vehicles', 'Owner details, insurance and data-correction tickets'],
  ['stock.view', 'Inventory', 'View stock', 'Stock on hand, FIFO batches, stock value and goods receipts'],
  ['stock.inward', 'Inventory', 'Record stock inward', 'Receive parts from suppliers (creates FIFO batches)'],
  ['stock.issue', 'Inventory', 'Issue and return parts', 'Issue approved parts to job cards (FIFO) and take returns back into stock'],
  ['purchasing.order', 'Inventory', 'Raise purchase orders', 'Create, send and cancel purchase orders; manage suppliers; return parts to suppliers'],
  ['purchasing.pay', 'Inventory', 'Pay suppliers', 'Record payments against supplier bills; see what is owed to suppliers'],
  ['stock.adjust', 'Inventory', 'Adjust stock', 'Post physical stock counts and write off damaged, expired or lost parts'],
  ['reports.view', 'Reports', 'View reports', 'Sales, GST/BAS, payments, debtors, purchases, productivity, parts margin and stock reports (incl. CSV export)'],
  ['masters.view', 'Masters', 'View masters', 'Open master data screens'],
  ['users.manage', 'Masters', 'Manage users', 'Add, edit, deactivate and delete users'],
  ['parts.manage', 'Masters', 'Manage parts', 'Add, edit, deactivate and delete parts'],
  ['labour.manage', 'Masters', 'Manage labour', 'Add, edit, deactivate and delete labour operations'],
  ['insurers.manage', 'Masters', 'Manage insurance companies', 'Add, edit, deactivate and delete insurers'],
  ['network.manage', 'Masters', 'Manage dealer network', 'Provinces, cities, dealers and outlets'],
  ['setup.manage', 'Masters', 'Manage service setup', 'Repair types, fuel types and transmission types'],
  ['roles.manage', 'Administration', 'Manage roles and rights', 'Create roles, assign rights and edit the rights list'],
  ['settings.manage', 'Administration', 'Manage workshop profile', 'Business name, ABN, address, bank / PayID details and invoice terms'],
  ['admin.data', 'Administration', 'Import, backup and restore', 'Import customers, vehicles, parts and labour from CSV; download backups; restore a backup'],
  ['audit.view', 'Administration', 'View audit log', 'See who changed what in masters, stock, billing and settings'],
  ['admin.reset', 'Administration', 'Reset demo data', 'Restore the sample data (erases all changes)'],
];

const JOB_ALL = ['jobs.view', 'jobs.create', 'jobs.edit', 'jobs.estimate', 'jobs.approve', 'jobs.stage', 'jobs.hold', 'jobs.feedback', 'appointments.manage', 'messages.send'];
// [id, name, description, rights, system]
const ROLES = [
  ['R001', 'Administrator', 'Full access to everything, including roles and rights. Built in – cannot be changed or removed.', [], true],
  ['R002', 'Service Advisor', 'Receives vehicles, opens job cards, builds estimates and takes customer approval.', ['dashboard.view', ...JOB_ALL, 'billing.proforma', 'billing.view', 'billing.payments', 'vehicles.view', 'vehicles.create', 'vehicles.edit', 'stock.view', 'masters.view']],
  ['R003', 'Technician', 'Works on assigned jobs: inspection, observations and stage updates.', ['dashboard.view', 'jobs.view', 'jobs.edit', 'jobs.stage', 'jobs.clock', 'vehicles.view']],
  ['R004', 'Workshop Manager', 'Runs the workshop: all job card and billing work plus users and master data.', ['dashboard.view', ...JOB_ALL, 'billing.proforma', 'billing.view', 'billing.payments', 'billing.override', 'jobs.close', 'jobs.reopen', 'jobs.clock', 'vehicles.view', 'vehicles.create', 'vehicles.edit', 'stock.view', 'stock.inward', 'stock.issue', 'stock.adjust', 'purchasing.order', 'purchasing.pay', 'reports.view', 'audit.view', 'masters.view', 'users.manage', 'parts.manage', 'labour.manage', 'insurers.manage', 'network.manage', 'setup.manage']],
  ['R005', 'Parts Manager', 'Maintains the parts and labour catalogue and helps with estimates.', ['dashboard.view', 'jobs.view', 'jobs.estimate', 'vehicles.view', 'stock.view', 'stock.inward', 'stock.issue', 'stock.adjust', 'purchasing.order', 'masters.view', 'parts.manage', 'labour.manage']],
  ['R006', 'Cashier', 'Raises proforma and final invoices and closes job cards.', ['dashboard.view', 'jobs.view', 'billing.proforma', 'billing.view', 'billing.payments', 'jobs.close', 'messages.send', 'vehicles.view']],
];

const seedRights = () => RIGHTS.map(([code, module, name, description]) => ({ code, module, name, description, system: true, active: true }));
const seedRoles = () => ROLES.map(([id, name, description, rights, system]) => ({ id, name, description, rights: [...rights], system: !!system, active: true }));

// Which right a master type needs for changes
const MANAGE = { users: 'users.manage', roles: 'roles.manage', rights: 'roles.manage', parts: 'parts.manage', labour: 'labour.manage', insurers: 'insurers.manage', provinces: 'network.manage', cities: 'network.manage', dealers: 'network.manage', outlets: 'network.manage', suppliers: 'purchasing.order', repairTypes: 'setup.manage', packages: 'setup.manage', campaigns: 'setup.manage', fuelTypes: 'setup.manage', transmissions: 'setup.manage' };

/** Rights needed for a request (all must be held). [] = any known user. */
function rightsFor(method, path, body = {}) {
  const p = path.replace(/\/+$/, '');
  if (/^\/api\/(health|meta|me)$/.test(p)) return [];
  if (p === '/api/dashboard') return ['dashboard.view'];
  if (p === '/api/admin/reset') return ['admin.reset'];
  if (/^\/api\/users\/[^/]+\/password$/.test(p)) return ['users.manage'];
  if (p.startsWith('/api/auth/')) return [];
  if (p === '/api/settings/workshop') return method === 'GET' ? [] : ['settings.manage'];
  if (p.startsWith('/api/masters')) {
    if (method === 'GET') return ['masters.view'];
    const type = p.split('/')[3];
    return [MANAGE[type] || 'roles.manage'];
  }
  if (p === '/api/customers') return ['vehicles.view'];
  if (p === '/api/vehicles/check') return ['vehicles.create'];
  if (p.startsWith('/api/vehicles')) return method === 'GET' ? ['vehicles.view'] : ['vehicles.edit'];
  if (p.startsWith('/api/catalog')) return ['jobs.view'];
  if (p === '/api/payments' || p === '/api/debtors') return ['billing.view'];
  if (p.startsWith('/api/invoices')) {
    if (method === 'GET') return ['billing.view'];
    if (p.endsWith('/refunds')) return ['billing.override'];
    return ['billing.payments'];
  }
  if (p.startsWith('/api/reports')) return ['reports.view'];
  if (p.startsWith('/api/import') || p.startsWith('/api/admin/backup') || p.startsWith('/api/admin/restore')) return method === 'GET' && p.startsWith('/api/import') ? [] : ['admin.data'];
  if (p === '/api/audit') return ['audit.view'];
  if (p.startsWith('/api/settings/lists')) return method === 'GET' ? [] : ['setup.manage'];
  if (/^\/api\/attachments\/[^/]+\/file$/.test(p)) return ['jobs.view'];
  if (p.startsWith('/api/attachments')) return ['jobs.edit'];
  if (p.startsWith('/api/messages') || p.startsWith('/api/reminders')) return ['messages.send'];
  if (p === '/api/timeclock/me') return [];
  if (p === '/api/board') return ['jobs.view'];
  if (p.startsWith('/api/appointments')) return method === 'GET' ? ['jobs.view'] : p.endsWith('/remind') ? ['messages.send'] : ['appointments.manage'];
  if (p === '/api/payables') return ['purchasing.pay'];
  if (p.startsWith('/api/purchasing') || p.startsWith('/api/purchase-orders')) return method === 'GET' ? ['stock.view'] : ['purchasing.order'];
  if (/^\/api\/stock\/inwards\/[^/]+\/payments$/.test(p)) return ['purchasing.pay'];
  if (p === '/api/stock/returns' && method !== 'GET') return ['purchasing.order'];
  if (p.startsWith('/api/stock')) return method === 'GET' ? ['stock.view'] : p.startsWith('/api/stock/adjustments') ? ['stock.adjust'] : ['stock.inward'];
  if (p.startsWith('/api/jobcards')) {
    if (method === 'GET') return p.endsWith('/billing') ? ['jobs.view'] : ['jobs.view'];
    if (p === '/api/jobcards') return body.newVehicle ? ['jobs.create', 'vehicles.create'] : ['jobs.create'];
    const sub = p.split('/')[4] || '';
    if (sub === '') return ['jobs.edit'];
    if (sub === 'gatepass') return ['billing.payments'];
    if (sub === 'clock') return ['jobs.clock'];
    if (sub === 'attachments') return method === 'GET' ? ['jobs.view'] : ['jobs.edit'];
    if (sub === 'claim') return ['jobs.edit'];
    if (sub === 'issue-parts' || /\/lines\/[^/]+\/(issue|return)$/.test(p)) return ['stock.issue'];
    if (sub === 'issue-labour' || /\/lines\/[^/]+\/(issue|unissue)-labour$/.test(p)) return ['jobs.edit'];
    if (sub === 'stage') return ['jobs.stage'];
    if (sub === 'status') {
      const a = String(body.action || '');
      return [a === 'close' ? 'jobs.close' : a === 'reopen' ? 'jobs.reopen' : 'jobs.hold'];
    }
    if (sub === 'lines') {
      if (method !== 'PATCH') return ['jobs.estimate'];
      const need = [];
      if ('status' in body) need.push('jobs.approve');
      if (Object.keys(body).some((k) => k !== 'status' && k !== 'reason')) need.push('jobs.estimate');
      return need.length ? need : ['jobs.estimate'];
    }
    if (sub === 'feedback') return ['jobs.feedback'];
    if (sub === 'proforma') return ['billing.proforma'];
    return ['jobs.edit']; // concerns, promised, campaigns, inspection, damages, activity, email
  }
  return [];
}

const roleOf = (db, user) => user && (db.roles || []).find((r) => r.name === user.role);
const isAdminUser = (db, user) => !!(user && user.active !== false && roleOf(db, user)?.system && roleOf(db, user).active !== false);

/** Effective right codes of a user. */
function rightsOf(db, user) {
  const role = roleOf(db, user);
  if (!user || user.active === false || !role || role.active === false) return [];
  const active = (db.rights || []).filter((r) => r.active !== false).map((r) => r.code);
  if (role.system) return active;
  return (role.rights || []).filter((c) => active.includes(c));
}
const can = (db, user, right) => rightsOf(db, user).includes(right);

/** User used when a request does not say who it is: the first active administrator. */
const defaultUser = (db) => db.users.find((u) => isAdminUser(db, u)) || db.users.find((u) => u.active !== false);

module.exports = { MODULES, MANAGE, seedRights, seedRoles, rightsFor, rightsOf, can, roleOf, isAdminUser, defaultUser };
