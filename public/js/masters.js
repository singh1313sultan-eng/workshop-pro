/* Workshop Pro – master data screens: users, roles & rights, parts, labour, insurers, dealer network */
'use strict';

const ROLE_STYLE = { 'Service Advisor': 'b-teal', Technician: 'b-violet', 'Workshop Manager': 'b-blue', 'Parts Manager': 'b-amber', Cashier: 'b-slate', Administrator: 'b-dark' };
// right needed to change each master (same rule as the server)
const MANAGE_RIGHT = { users: 'users.manage', roles: 'roles.manage', rights: 'roles.manage', parts: 'parts.manage', labour: 'labour.manage', insurers: 'insurers.manage', provinces: 'network.manage', cities: 'network.manage', dealers: 'network.manage', outlets: 'network.manage' };
const GROUP_TITLE = { service: 'Masters', setup: 'Service setup', network: 'Dealer network', access: 'Access control' };
MANAGE_RIGHT.repairTypes = MANAGE_RIGHT.fuelTypes = MANAGE_RIGHT.transmissions = 'setup.manage';
MANAGE_RIGHT.suppliers = 'purchasing.order';
MANAGE_RIGHT.packages = MANAGE_RIGHT.campaigns = 'setup.manage';

const MASTER_UI = {
  packages: {
    group: 'setup', title: 'Service packages', single: 'package', icon: 'box', key: 'code',
    intro: 'Bundles of parts and labour added to a job card in one go – logbook services, brake overhauls and so on. Prices come from the parts and labour masters.',
    columns: [
      ['Package', (r) => `<b>${esc(r.name)}</b><div class="small muted mono">${esc(r.code)}</div>`, 'lead'],
      ['Group', (r) => esc(r.group || '—')],
      ['Contents', (r) => `${(r.parts || []).length} part(s) · ${(r.labour || []).length} labour`],
    ],
    form: [
      { name: 'code', label: 'Package code', required: true, keyField: true },
      { name: 'name', label: 'Name', required: true },
      { name: 'group', label: 'Group', list: 'group', span: 2 },
      { name: 'parts', label: 'Parts', type: 'pkgparts', span: 2 },
      { name: 'labour', label: 'Labour', type: 'multi', ref: 'labour', valueKey: 'code', textKey: 'description', span: 2 },
    ],
    filters: (rows) => [...new Set(rows.map((r) => r.group).filter(Boolean))].map((g) => [g, (x) => x.group === g]),
  },
  campaigns: {
    group: 'setup', title: 'Campaigns', single: 'campaign', icon: 'flag', key: 'id',
    intro: 'Safety recalls, service campaigns and offers. Active campaigns that have not expired are offered on new job cards; an offer can discount parts.',
    columns: [
      ['Campaign', (r) => `<b>${esc(r.name)}</b><div class="small muted">${esc(r.id)}</div>`, 'lead'],
      ['Type', (r) => `<span class="badge ${r.type === 'Recall' ? 'b-red' : r.type === 'Offer' ? 'b-green' : 'b-slate'}">${esc(r.type)}</span>`],
      ['Valid until', (r) => `${fmtDate(r.validTill)}${new Date(r.validTill) < new Date() ? ' <span class="badge b-slate">Expired</span>' : ''}`],
      ['Discount', (r) => (r.discountPct ? r.discountPct + '% on parts' : '—')],
    ],
    form: [
      { name: 'name', label: 'Campaign name', required: true, span: 2 },
      { name: 'type', label: 'Type', type: 'select', options: ['Recall', 'Service campaign', 'Offer'], required: true, def: 'Service campaign' },
      { name: 'validTill', label: 'Valid until', type: 'date', required: true },
      { name: 'discountPct', label: 'Parts discount %', type: 'number', min: 0, def: 0 },
    ],
    filters: () => [['Current', (x) => new Date(x.validTill) >= new Date()], ['Expired', (x) => new Date(x.validTill) < new Date()]],
  },
  repairTypes: {
    group: 'setup', title: 'Repair types', single: 'repair type', icon: 'wrench', key: 'id',
    intro: 'Types of work a job card can be opened for (shown as "Job type"). Only active repair types can be chosen on new job cards.',
    columns: [
      ['Repair type', (r) => `<b>${esc(r.name)}</b><div class="small muted">${esc(r.description || r.id)}</div>`, 'lead'],
      ['Code', (r) => `<span class="badge b-slate">${esc(r.code)}</span>`],
      ['In use', (r) => (r.inUse ? `<span class="small">${esc(r.inUse)}</span>` : '<span class="muted small">—</span>')],
    ],
    form: [
      { name: 'name', label: 'Repair type', required: true },
      { name: 'code', label: 'Short code', required: true, hint: 'e.g. PMS' },
      { name: 'description', label: 'Description', type: 'textarea', span: 2 },
    ],
    filters: () => [],
  },
  fuelTypes: {
    group: 'setup', title: 'Fuel types', single: 'fuel type', icon: 'flag', key: 'id',
    intro: 'Fuel options for vehicles. Used when registering a new vehicle.',
    columns: [
      ['Fuel type', (r) => `<b>${esc(r.name)}</b><div class="small muted">${esc(r.id)}</div>`, 'lead'],
      ['Vehicles', (r) => (r.inUse ? `<span class="small">${esc(r.inUse)}</span>` : '<span class="muted small">None</span>')],
    ],
    form: [{ name: 'name', label: 'Fuel type', required: true, span: 2 }],
    filters: () => [],
  },
  transmissions: {
    group: 'setup', title: 'Transmission types', single: 'transmission type', icon: 'settings', key: 'id',
    intro: 'Gearbox options for vehicles. Used when registering a new vehicle.',
    columns: [
      ['Transmission', (r) => `<b>${esc(r.name)}</b><div class="small muted">${esc(r.description || r.id)}</div>`, 'lead'],
      ['Vehicles', (r) => (r.inUse ? `<span class="small">${esc(r.inUse)}</span>` : '<span class="muted small">None</span>')],
    ],
    form: [{ name: 'name', label: 'Transmission type', required: true }, { name: 'description', label: 'Description' }],
    filters: () => [],
  },
  roles: {
    group: 'access', title: 'Roles', single: 'role', icon: 'shield', key: 'id',
    intro: 'A role is a named set of rights. Every user has one role. The built-in Administrator role always has every right.',
    columns: [
      ['Role', (r) => `<b>${esc(r.name)}</b>${r.system ? ' <span class="badge b-dark" style="margin-left:4px">Built in</span>' : ''}<div class="small muted">${esc(r.description || r.id)}</div>`, 'lead'],
      ['Rights', (r) => (r.system ? '<span class="badge b-green">All rights</span>' : `<b>${r.rightCount}</b> <span class="muted small">right${r.rightCount === 1 ? '' : 's'}</span>`)],
      ['Modules', (r) => roleModules(r)],
      ['Users', (r) => `<a href="#/masters/users" onclick="event.stopPropagation();App.ui.m_users={q:'',active:'',filter:'${esc(r.name)}'}">${r.userCount} user${r.userCount === 1 ? '' : 's'}</a>`, 'num'],
    ],
    form: [
      { name: 'name', label: 'Role name', required: true, span: 2 },
      { name: 'description', label: 'Description', type: 'textarea', span: 2 },
      { name: 'rights', label: 'Rights', type: 'rights', span: 2 },
    ],
    filters: () => [['Built in', (x) => x.system], ['Custom', (x) => !x.system], ['Without users', (x) => !x.userCount]],
  },
  rights: {
    group: 'access', title: 'Rights', single: 'right', icon: 'check', key: 'code',
    intro: 'Every action the app protects. Built-in rights are checked by the server on each request; add your own for future features or reporting. Deactivating a right removes it from every role except Administrator.',
    columns: [
      ['Right', (r) => `<b>${esc(r.name)}</b>${r.system ? '' : ' <span class="badge b-amber" style="margin-left:4px">Custom</span>'}<div class="small muted mono">${esc(r.code)}</div>`, 'lead'],
      ['Module', (r) => `<span class="badge b-slate">${esc(r.module)}</span>`],
      ['What it allows', (r) => `<span class="small">${esc(r.description || '—')}</span>`],
      ['Roles', (r) => `<b>${r.roleCount}</b>`, 'num'],
    ],
    form: [
      { name: 'code', label: 'Right code', required: true, keyField: true, hint: 'lowercase, e.g. reports.export' },
      { name: 'module', label: 'Module', type: 'select', options: ['Dashboard', 'Job cards', 'Billing', 'Vehicles', 'Masters', 'Administration', 'Other'], required: true, def: 'Other' },
      { name: 'name', label: 'Name', required: true, span: 2 },
      { name: 'description', label: 'What it allows', type: 'textarea', span: 2 },
    ],
    filters: (rows) => [['Built in', (x) => x.system], ['Custom', (x) => !x.system], ...[...new Set(rows.map((r) => r.module))].map((m) => [m, (x) => x.module === m])],
  },
  users: {
    title: 'Users', single: 'user', icon: 'user', key: 'id',
    intro: 'Staff who can be assigned to job cards. Technicians appear in the technician picker; deactivated users can no longer be assigned.',
    columns: [
      ['Name', (r) => `<div class="row" style="gap:10px"><span class="avatar" style="width:32px;height:32px;font-size:12px">${initials(r.name)}</span><div><b>${esc(r.name)}</b><div class="small muted">${esc(r.id)}</div></div></div>`, 'lead'],
      ['Role', (r) => `<span class="badge ${ROLE_STYLE[r.role] || ''}">${esc(r.role)}</span>`],
      ['Mobile', (r) => r.phone ? `<a href="tel:${esc(r.phone)}" onclick="event.stopPropagation()">${esc(fmtPhone(r.phone))}</a>` : '—'],
      ['Email (sign-in)', (r) => `${esc(r.email || '—')}${App.authMode === 'password' ? (r.hasPassword ? '' : ' <span class="badge b-amber">No password</span>') : ''}`],
    ],
    form: [
      { name: 'name', label: 'Full name', required: true, span: 2 },
      { name: 'role', label: 'Role', type: 'ref', ref: 'roles', valueKey: 'name', required: true, hint: 'Rights come from the role' },
      { name: 'phone', label: 'Mobile', type: 'tel', required: true },
      { name: 'email', label: 'Email', type: 'email', span: 2 },
      { name: 'outletIds', label: 'Branches (leave all unticked to allow every branch)', type: 'multi', ref: 'outlets', span: 2 },
    ],
    filters: (rows) => [...new Set(rows.map((r) => r.role))].map((r) => [r, (x) => x.role === r]),
  },
  parts: {
    title: 'Parts', single: 'part', icon: 'box', key: 'no',
    intro: 'Parts catalogue with price, tax and stock. Only active parts can be added to estimates. Link superseded and alternate numbers to enable part replacement.',
    columns: [
      ['Part', (r) => `<b>${esc(r.description)}</b><div class="small muted"><span class="mono">${esc(r.no)}</span> · ${esc(r.brand)}</div>`, 'lead'],
      ['Category', (r) => `${esc(r.category)} <span class="badge ${r.source === 'OEM' ? 'b-teal' : 'b-slate'}" style="margin-left:4px">${esc(r.source)}</span>`],
      ['Stock', (r) => `<span style="font-weight:600;color:${r.lowStock ? 'var(--red)' : 'inherit'}">${r.stock} ${esc(r.unit)}</span>${r.lowStock ? '<div class="small" style="color:var(--red)">Below reorder level</div>' : `<div class="small muted">Reorder at ${r.reorderLevel}</div>`}`],
      ['Price (ex GST)', (r) => `<b>${money(r.mrp)}</b><div class="small muted">${Number(r.gstPct) ? 'GST ' + r.gstPct + '%' : 'GST-free'}</div>`, 'num'],
      ['Links', (r) => [r.supersededBy && `<span class="badge b-teal" title="Superseded by">→ ${esc(r.supersededBy)}</span>`, r.alternateFor && `<span class="badge b-slate" title="Alternate for">≈ ${esc(r.alternateFor)}</span>`].filter(Boolean).join(' ') || '<span class="muted">—</span>'],
    ],
    form: [
      { name: 'no', label: 'Part number', required: true, keyField: true, hint: 'Letters, numbers, - _ / .' },
      { name: 'source', label: 'Source', type: 'select', options: ['OEM', 'Aftermarket'], required: true, def: 'OEM' },
      { name: 'description', label: 'Description', required: true, span: 2 },
      { name: 'category', label: 'Category', required: true, list: 'category' },
      { name: 'brand', label: 'Brand', required: true, list: 'brand' },
      { name: 'unit', label: 'Unit', type: 'select', options: ['EA', 'SET', 'PAIR', 'L', 'KG', 'M'], required: true, def: 'EA' },
      { name: 'mrp', label: 'Sell price ex GST ($)', type: 'number', step: '0.01', min: 0, required: true },
      { name: 'gstPct', label: 'GST', type: 'select', options: [10, 0], def: 10, hint: '0 = GST-free' },
      { name: 'stock', label: 'Stock on hand', type: 'number', min: 0, def: 0, readonly: true, hint: 'changes through Stock inward and job card issues' },
      { name: 'reorderLevel', label: 'Reorder level', type: 'number', min: 0, def: 0 },
      { name: 'supersededBy', label: 'Superseded by', list: 'no', hint: 'Newer part number that replaces this one' },
      { name: 'alternateFor', label: 'Alternate for', list: 'no', hint: 'Part this can be used instead of' },
    ],
    filters: (rows) => [['Low stock', (x) => x.lowStock], ['OEM', (x) => x.source === 'OEM'], ['Aftermarket', (x) => x.source === 'Aftermarket'], ...[...new Set(rows.map((r) => r.category))].map((c) => [c, (x) => x.category === c])],
  },
  labour: {
    title: 'Labour', single: 'labour operation', icon: 'wrench', key: 'code',
    intro: 'Standard labour operations with time and rate. Only active operations can be added to estimates.',
    columns: [
      ['Operation', (r) => `<b>${esc(r.description)}</b><div class="small muted mono">${esc(r.code)}</div>`, 'lead'],
      ['Group', (r) => esc(r.group)],
      ['Standard time', (r) => `${r.minutes} min <span class="muted small">(${(r.minutes / 60).toFixed(1)} h)</span>`],
      ['GST', (r) => (Number(r.gstPct ?? 10) ? `${r.gstPct ?? 10}%` : 'GST-free')],
      ['Rate', (r) => `<b>${money(r.rate)}</b>`, 'num'],
    ],
    form: [
      { name: 'code', label: 'Operation code', required: true, keyField: true },
      { name: 'group', label: 'Group', required: true, list: 'group' },
      { name: 'description', label: 'Description', required: true, span: 2 },
      { name: 'minutes', label: 'Standard time (minutes)', type: 'number', min: 1, required: true },
      { name: 'rate', label: 'Price ex GST ($)', type: 'number', step: '0.01', min: 0, required: true },
      { name: 'gstPct', label: 'GST', type: 'select', options: [10, 0], def: 10, hint: '0 = GST-free' },
    ],
    filters: (rows) => [...new Set(rows.map((r) => r.group))].map((g) => [g, (x) => x.group === g]),
  },
  provinces: {
    group: 'network', title: 'States & territories', single: 'state / territory', icon: 'flag', key: 'id',
    intro: 'Australian states and territories where dealers and outlets operate.',
    columns: [
      ['State / territory', (r) => `<b>${esc(r.name)}</b><div class="small muted">${esc(r.id)}</div>`, 'lead'],
      ['Code', (r) => `<span class="badge b-slate">${esc(r.code)}</span>`],
      ['Cities', (r) => `<a href="#/masters/cities" onclick="event.stopPropagation();App.ui.m_cities={q:'',active:'',filter:'${esc(r.name)}'}">${r.cityCount} ${r.cityCount === 1 ? 'city' : 'cities'}</a>`],
      ['Country', (r) => esc(r.country || '—')],
    ],
    form: [
      { name: 'name', label: 'State / territory name', required: true, span: 2 },
      { name: 'code', label: 'Short code', required: true, hint: 'e.g. NSW' },
      { name: 'country', label: 'Country', def: 'Australia' },
    ],
    filters: () => [],
  },
  cities: {
    group: 'network', title: 'Cities', single: 'city', icon: 'grid', key: 'id',
    intro: 'Cities and regions within each state. Dealers and outlets are located in a city.',
    columns: [
      ['City', (r) => `<b>${esc(r.name)}</b><div class="small muted">${esc(r.id)}</div>`, 'lead'],
      ['State', (r) => esc(r.provinceIdName)],
    ],
    form: [
      { name: 'name', label: 'City name', required: true },
      { name: 'provinceId', label: 'State', type: 'ref', ref: 'provinces', required: true },
    ],
    filters: (rows) => [...new Set(rows.map((r) => r.provinceIdName))].sort().map((p) => [p, (x) => x.provinceIdName === p]),
  },
  dealers: {
    group: 'network', title: 'Dealers', single: 'dealer', icon: 'box', key: 'id',
    intro: 'Dealer companies in the network. The city must be in the selected state, and the ABN is checked against the ATO check digits.',
    columns: [
      ['Dealer', (r) => `<b>${esc(r.name)}</b><div class="small muted">${esc(r.code)} · ${esc(r.id)}</div>`, 'lead'],
      ['Location', (r) => `${esc(r.cityIdName)}<div class="small muted">${esc(r.provinceIdName)}</div>`],
      ['ABN', (r) => `<span class="mono">${esc(r.abn || '—')}</span>`],
      ['Contact', (r) => `${esc(r.contactPerson || '—')}<div class="small muted">${esc(fmtPhone(r.phone || ''))}</div>`],
      ['Outlets', (r) => `<a href="#/masters/outlets" onclick="event.stopPropagation();App.ui.m_outlets={q:'',active:'',filter:'${esc(r.name)}'}">${r.outletCount} outlet${r.outletCount === 1 ? '' : 's'}</a>`],
    ],
    form: [
      { name: 'name', label: 'Dealer name', required: true, span: 2 },
      { name: 'code', label: 'Dealer code', required: true },
      { name: 'abn', label: 'ABN', hint: '11 digits' },
      { name: 'provinceId', label: 'State', type: 'ref', ref: 'provinces', required: true },
      { name: 'cityId', label: 'City', type: 'ref', ref: 'cities', required: true, dependsOn: 'provinceId', match: 'provinceId' },
      { name: 'contactPerson', label: 'Contact person' },
      { name: 'phone', label: 'Phone', type: 'tel' },
      { name: 'email', label: 'Email', type: 'email', span: 2 },
      { name: 'address', label: 'Address', type: 'textarea', span: 2 },
    ],
    filters: (rows) => [...new Set(rows.map((r) => r.provinceIdName))].sort().map((p) => [p, (x) => x.provinceIdName === p]),
  },
  outlets: {
    group: 'network', title: 'Outlets', single: 'outlet', icon: 'wrench', key: 'id',
    intro: 'Physical sites run by each dealer – dealerships, service centres, body shops and more.',
    columns: [
      ['Outlet', (r) => `<b>${esc(r.name)}</b><div class="small muted">${esc(r.code)} · ${esc(r.id)}</div>`, 'lead'],
      ['Dealer', (r) => esc(r.dealerIdName)],
      ['Type', (r) => `<span class="badge ${r.type.startsWith('Dealership') ? 'b-teal' : r.type === 'Body shop' ? 'b-amber' : 'b-slate'}">${esc(r.type)}</span>`],
      ['City', (r) => esc(r.cityIdName)],
      ['Bays', (r) => `<b>${r.bays}</b>`, 'num'],
    ],
    form: [
      { name: 'name', label: 'Outlet name', required: true, span: 2 },
      { name: 'code', label: 'Outlet code', required: true },
      { name: 'type', label: 'Type', type: 'select', options: ['Dealership (sales, service, parts)', 'Service centre', 'Body shop', 'Showroom', 'Parts outlet'], required: true, def: 'Service centre' },
      { name: 'dealerId', label: 'Dealer', type: 'ref', ref: 'dealers', required: true },
      { name: 'cityId', label: 'City', type: 'ref', ref: 'cities', required: true, groupBy: 'provinceIdName' },
      { name: 'phone', label: 'Phone', type: 'tel' },
      { name: 'bays', label: 'Service bays', type: 'number', min: 0, def: 0 },
      { name: 'address', label: 'Address', type: 'textarea', span: 2 },
    ],
    filters: (rows) => [...[...new Set(rows.map((r) => r.type))].map((t) => [t, (x) => x.type === t]), ...[...new Set(rows.map((r) => r.dealerIdName))].map((d) => [d, (x) => x.dealerIdName === d])],
  },
  suppliers: {
    title: 'Suppliers', single: 'supplier', icon: 'box', key: 'id',
    intro: 'Parts suppliers. Purchase orders and goods receipts are linked to a supplier; payment terms set when their bills fall due.',
    columns: [
      ['Supplier', (r) => `<b>${esc(r.name)}</b><div class="small muted">${esc(r.id)}${r.accountNo ? ' · our acc ' + esc(r.accountNo) : ''}</div>`, 'lead'],
      ['ABN', (r) => `<span class="mono">${esc(r.abn || '—')}</span>`],
      ['Contact', (r) => `${esc(r.contactPerson || '—')}<div class="small muted">${esc(fmtPhone(r.phone || ''))}</div>`],
      ['Terms', (r) => `${r.paymentTermsDays} days`],
    ],
    form: [
      { name: 'name', label: 'Supplier name', required: true, span: 2 },
      { name: 'abn', label: 'ABN', hint: '11 digits' },
      { name: 'accountNo', label: 'Our account number' },
      { name: 'contactPerson', label: 'Contact person' },
      { name: 'phone', label: 'Phone', type: 'tel' },
      { name: 'email', label: 'Orders email', type: 'email' },
      { name: 'paymentTermsDays', label: 'Payment terms (days)', type: 'number', min: 0, def: 30 },
      { name: 'address', label: 'Address', type: 'textarea', span: 2 },
    ],
    filters: () => [],
  },
  insurers: {
    title: 'Insurance companies', single: 'insurance company', icon: 'shield', key: 'id',
    intro: 'Insurers used on vehicle policies and accident repair claims. Insurers that pay the repairer directly are billed for the claim; the customer pays the excess.',
    columns: [
      ['Company', (r) => `<b>${esc(r.name)}</b><div class="small muted">${esc(r.code)} · ${esc(r.id)}</div>`, 'lead'],
      ['Claims', (r) => (r.cashless ? '<span class="badge b-green">Pays repairer</span>' : '<span class="badge b-slate">Customer reimbursed</span>')],
      ['Contact', (r) => `${esc(r.contactPerson || '—')}<div class="small muted">${esc(r.phone || '')}</div>`],
      ['Email', (r) => esc(r.email || '—')],
      ['ABN', (r) => `<span class="mono">${esc(r.abn || '—')}</span>`],
    ],
    form: [
      { name: 'name', label: 'Company name', required: true, span: 2 },
      { name: 'code', label: 'Short code', required: true },
      { name: 'cashless', label: 'Pays repairer directly', type: 'checkbox', def: true },
      { name: 'contactPerson', label: 'Contact person' },
      { name: 'phone', label: 'Phone', type: 'tel' },
      { name: 'email', label: 'Claims email', type: 'email' },
      { name: 'abn', label: 'ABN', hint: '11 digits' },
      { name: 'address', label: 'Address', type: 'textarea', span: 2 },
    ],
    filters: () => [['Pays repairer', (x) => x.cashless], ['Customer reimbursed', (x) => !x.cashless]],
  },
};

App.route('/masters', async () => App.routes.find((r) => r.re.test('/masters/users')).view({ type: 'users' }, new URLSearchParams()));

App.route('/masters/:type', async ({ type }, q) => {
  const cfg = MASTER_UI[type];
  if (!cfg) throw Object.assign(new Error('Unknown master'), { status: 404 });
  const st = (App.ui['m_' + type] = App.ui['m_' + type] || { q: '', active: 'true', filter: '' });
  const [rows, summary] = await Promise.all([api('GET', `/masters/${type}`), api('GET', '/masters')]);
  if (type === 'roles') window.__rightsIndex = Object.fromEntries((await api('GET', '/masters/rights')).map((r) => [r.code, r.module]));
  window.__mrows = rows;
  const filters = cfg.filters(rows);
  const group = cfg.group || 'service';
  const tabs = Object.entries(MASTER_UI).filter(([, c]) => (c.group || 'service') === group).map(([k, c]) => `<button class="${k === type ? 'on' : ''}" onclick="App.go('#/masters/${k}')">${ic(c.icon, 'sm')}${c.title}<span class="n">${summary[k].active}</span></button>`).join('');
  return {
    title: GROUP_TITLE[group] || 'Masters',
    nav: 'm_' + type,
    html: `
    <div class="tabs" style="margin-bottom:16px">${tabs}</div>
    <div class="row between wrap" style="gap:12px;margin-bottom:14px">
      <div style="max-width:720px"><h1>${cfg.title}</h1><div class="muted small" style="margin-top:4px">${cfg.intro}</div></div>
      ${App.can(MANAGE_RIGHT[type]) ? `<button class="btn primary" onclick="masterForm('${type}')">${ic('plus', 'sm')}Add ${cfg.single}</button>` : '<span class="badge b-slate">View only</span>'}
    </div>
    <div class="row wrap" style="gap:10px;margin-bottom:12px">
      <label class="gsearch" style="display:flex;width:min(340px,100%)">${ic('search', 'sm')}<input id="mq" placeholder="Search ${cfg.title.toLowerCase()}…" value="${esc(st.q)}"></label>
      <div class="seg">${[['true', 'Active'], ['false', 'Inactive'], ['', 'All']].map(([v, l]) => `<button class="${st.active === v ? 'on' : ''}" onclick="App.ui.m_${type}.active='${v}';drawMaster('${type}')">${l}</button>`).join('')}</div>
    </div>
    <div class="chips" style="margin-bottom:14px" id="mchips"></div>
    <div class="card" style="overflow:hidden" id="mtable"></div>`,
    after() {
      $('#mq').addEventListener('input', (e) => { st.q = e.target.value; drawMaster(type); });
      drawMaster(type);
    },
  };
});

function drawMaster(type) {
  const cfg = MASTER_UI[type], st = App.ui['m_' + type], rows = window.__mrows;
  const filters = cfg.filters(rows);
  const t = st.q.toLowerCase().trim();
  const pass = rows
    .filter((r) => st.active === '' || String(r.active !== false) === st.active)
    .filter((r) => !t || JSON.stringify(r).toLowerCase().includes(t))
    .filter((r) => { const f = filters.find(([l]) => l === st.filter); return !f || f[1](r); });
  $('#mchips').innerHTML = `<button class="chip ${!st.filter ? 'on' : ''}" data-f="">All <span class="n">${rows.filter((r) => st.active === '' || String(r.active !== false) === st.active).length}</span></button>` +
    filters.map(([l, fn]) => { const n = rows.filter((r) => (st.active === '' || String(r.active !== false) === st.active) && fn(r)).length; return `<button class="chip ${st.filter === l ? 'on' : ''}" data-f="${esc(l)}">${esc(l)} <span class="n" ${l === 'Low stock' && n ? 'style="color:var(--red)"' : ''}>${n}</span></button>`; }).join('');
  $$('#mchips [data-f]').forEach((b) => (b.onclick = () => { st.filter = b.dataset.f; drawMaster(type); }));
  $('#mtable').innerHTML = pass.length
    ? `<div class="tbl-wrap"><table class="tbl rt"><thead><tr>${cfg.columns.map(([h, , c]) => `<th class="${c === 'num' ? 'num' : ''}">${h}</th>`).join('')}<th>Status</th><th class="hide-sm"></th></tr></thead><tbody>
      ${pass.map((r) => { const key = r[cfg.key]; return `<tr class="click" onclick="masterForm('${type}','${esc(key)}')">${cfg.columns.map(([h, fn, c]) => `<td class="${c === 'lead' ? 'lead' : c === 'num' ? 'num' : ''}" data-l="${h}">${fn(r)}</td>`).join('')}
        <td data-l="Status" onclick="event.stopPropagation()"><label class="row" style="gap:8px;cursor:pointer" title="${r.active !== false ? 'Deactivate' : 'Activate'}"><span class="switch"><input type="checkbox" ${r.active !== false ? 'checked' : ''} ${App.can(MANAGE_RIGHT[type]) && !(type === 'roles' && r.system) ? '' : 'disabled'} onchange="toggleMaster('${type}','${esc(key)}',this)"><span></span></span><span class="small ${r.active !== false ? '' : 'muted'}">${r.active !== false ? 'Active' : 'Inactive'}</span></label></td>
        <td class="hide-sm" style="width:30px;color:var(--faint)">${ic('chevron', 'sm')}</td></tr>`; }).join('')}
      </tbody></table></div>`
    : `<div class="empty"><div class="ic">${ic(cfg.icon, 'lg')}</div><h3>No ${cfg.title.toLowerCase()} found</h3><p>${st.q || st.filter ? 'Try clearing the search or filter.' : `Add your first ${cfg.single}.`}</p></div>`;
}

async function toggleMaster(type, key, el) {
  const res = await act(null, () => api('PATCH', `/masters/${type}/${encodeURIComponent(key)}`, { active: el.checked }), el.checked ? 'Activated' : 'Deactivated');
  if (!res) { el.checked = !el.checked; return; }
  Object.assign(window.__mrows.find((r) => r[MASTER_UI[type].key] === key), res);
  drawMaster(type);
  App.reloadMeta();
}

async function masterForm(type, key) {
  const cfg = MASTER_UI[type];
  const rec = key ? window.__mrows.find((r) => String(r[cfg.key]) === String(key)) : null;
  // load options for linked fields (active records, plus the current value even if inactive)
  const refs = {};
  if (cfg.form.some((x) => x.type === 'pkgparts')) refs.parts = refs.parts || await api('GET', '/masters/parts');
  for (const f of cfg.form.filter((x) => x.type === 'ref' || x.type === 'multi')) {
    if (!refs[f.ref]) refs[f.ref] = await api('GET', `/masters/${f.ref}`);
  }
  const refOptions = (f, parentVal) => {
    const cur = rec ? rec[f.name] : '';
    const vk = f.valueKey || 'id';
    let items = (refs[f.ref] || []).filter((x) => x.active !== false || x[vk] === cur);
    if (f.dependsOn) items = items.filter((x) => x[f.match] === parentVal);
    const opt = (x) => `<option value="${esc(x[vk])}" ${x[vk] === cur ? 'selected' : ''}>${esc(x.name)}${x.active === false ? ' (inactive)' : ''}</option>`;
    const head = `<option value="">${f.dependsOn && !parentVal ? `Select ${f.dependsOn.replace('Id', '')} first` : 'Select…'}</option>`;
    if (f.groupBy) {
      const groups = [...new Set(items.map((x) => x[f.groupBy]))].sort();
      return head + groups.map((g) => `<optgroup label="${esc(g)}">${items.filter((x) => x[f.groupBy] === g).map(opt).join('')}</optgroup>`).join('');
    }
    return head + items.map(opt).join('');
  };
  const lists = {};
  cfg.form.filter((f) => f.list).forEach((f) => (lists[f.list] = [...new Set(window.__mrows.map((r) => r[f.list]).filter(Boolean))]));
  const val = (f) => { const v = rec ? rec[f.name] ?? '' : f.def ?? ''; return f.type === 'date' && v ? String(v).slice(0, 10) : v; };
  const field = (f) => {
    const req = f.required ? ' <span style="color:var(--red)">*</span>' : '';
    const span = f.span === 2 ? 'style="grid-column:1/-1"' : '';
    const ro = rec && f.keyField ? 'readonly title="The key cannot be changed"' : f.readonly ? 'readonly disabled' : '';
    if (f.type === 'multi') {
      const vk = f.valueKey || 'id', tk = f.textKey || 'name';
      const cur = new Set(rec ? rec[f.name] || [] : []);
      const items = (refs[f.ref] || []).filter((x) => x.active !== false || cur.has(x[vk]));
      return `<div ${span}><div class="small" style="font-weight:600;margin-bottom:6px">${f.label}</div><div class="multi" data-multi="${f.name}">${items.map((x) => `<label class="check"><input type="checkbox" value="${esc(x[vk])}" ${cur.has(x[vk]) ? 'checked' : ''}>${esc(x[tk])}${tk !== vk ? ` <span class="small muted mono">${esc(x[vk])}</span>` : ''}</label>`).join('')}</div></div>`;
    }
    if (f.type === 'pkgparts') {
      const rows = rec ? rec.parts || [] : [];
      return `<div ${span}><div class="small" style="font-weight:600;margin-bottom:6px">${f.label}</div><div id="pkgP">${rows.map(([no, q]) => pkgRow(no, q)).join('')}</div><button type="button" class="btn sm" onclick="$('#pkgP').insertAdjacentHTML('beforeend', pkgRow('', 1))">${ic('plus', 'sm')}Add part</button>
        <datalist id="dlPkgParts">${(refs.parts || []).filter((p) => p.active !== false).map((p) => `<option value="${esc(p.no)}">${esc(p.description)}</option>`).join('')}</datalist></div>`;
    }
    if (f.type === 'rights') return `<div ${span}><div class="row between" style="margin-bottom:6px"><span class="small" style="font-weight:600">${f.label}</span><span class="small muted" id="rCount"></span></div>${rightsMatrix(allRights, rec)}</div>`;
    if (f.type === 'checkbox') return `<label class="check" ${span} style="align-self:end;height:40px"><input type="checkbox" name="${f.name}" ${val(f) ? 'checked' : ''}>${f.label}</label>`;
    if (f.type === 'ref') {
      const parentVal = f.dependsOn ? (rec ? rec[f.dependsOn] : '') : null;
      return `<label class="f" ${span}><span>${f.label}${req}</span><select class="inp" name="${f.name}" ${f.dependsOn && !parentVal ? 'disabled' : ''}>${refOptions(f, parentVal)}</select></label>`;
    }
    if (f.type === 'select') return `<label class="f" ${span}><span>${f.label}${req}</span><select class="inp" name="${f.name}">${rec || f.def !== undefined ? '' : '<option value="">Select…</option>'}${f.options.map((o) => `<option ${String(o) === String(val(f)) ? 'selected' : ''}>${o}</option>`).join('')}</select></label>`;
    if (f.type === 'textarea') return `<label class="f" ${span}><span>${f.label}${req}</span><textarea class="inp" name="${f.name}">${esc(val(f))}</textarea></label>`;
    return `<label class="f" ${span}><span>${f.label}${req}${f.hint ? ` <span class="hint">· ${f.hint}</span>` : ''}</span><input class="inp" name="${f.name}" type="${f.type || 'text'}" ${f.step ? `step="${f.step}"` : ''} ${f.min != null ? `min="${f.min}"` : ''} ${f.inputmode ? `inputmode="${f.inputmode}"` : ''} ${f.list ? `list="dl_${f.list}"` : ''} value="${esc(val(f))}" ${ro} autocomplete="off"></label>`;
  };
  const canEdit = App.can(MANAGE_RIGHT[type]);
  let allRights = [];
  if (cfg.form.some((x) => x.type === 'rights')) allRights = await api('GET', '/masters/rights');
  const usage = rec?.inUse;
  openModal({
    title: rec ? `Edit ${cfg.single}` : `Add ${cfg.single}`,
    wide: cfg.form.length > 6,
    body: `${usage ? `<div class="alert info" style="margin-bottom:14px">${ic('info')}<div>${esc(usage)}. It can be edited or deactivated but not deleted.</div></div>` : ''}
      <form id="mForm" class="grid g2" novalidate>${cfg.form.map(field).join('')}
      ${rec ? `<label class="check" style="grid-column:1/-1"><input type="checkbox" name="active" ${rec.active !== false ? 'checked' : ''}>Active</label>` : ''}</form>
      ${Object.entries(lists).map(([k, vals]) => `<datalist id="dl_${k}">${vals.map((v) => `<option value="${esc(v)}">`).join('')}</datalist>`).join('')}`,
    foot: canEdit
      ? `${type === 'users' && rec && App.authMode === 'password' ? `<button class="btn" style="margin-right:auto" onclick="setPasswordModal('${esc(rec.id)}','${esc(rec.name)}')">${ic('lock', 'sm')}${rec.hasPassword ? 'Reset password' : 'Set password'}</button>` : ''}${rec && !usage ? `<button class="btn danger" id="mDel" style="${type === 'users' && App.authMode === 'password' ? '' : 'margin-right:auto'}">${ic('trash', 'sm')}Delete</button>` : ''}<button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="mSave">${rec ? 'Save changes' : `Add ${cfg.single}`}</button>`
      : `<span class="small muted" style="margin-right:auto">View only – you need the right “${esc(MANAGE_RIGHT[type])}” to change this.</span><button class="btn" onclick="closeModal()">Close</button>`,
  });
  if (!canEdit) $$('#mForm input, #mForm select, #mForm textarea').forEach((el) => (el.disabled = true));
  if ($('#rmx')) wireRightsMatrix();
  // dependent dropdowns (e.g. City filtered by Province)
  cfg.form.filter((f) => f.dependsOn).forEach((f) => {
    const parent = $(`#mForm [name="${f.dependsOn}"]`), child = $(`#mForm [name="${f.name}"]`);
    parent.addEventListener('change', () => {
      child.innerHTML = refOptions(Object.assign({}, f), parent.value).replace(/ selected/g, '');
      child.disabled = !parent.value;
    });
  });
  if (!canEdit) return;
  $('#mSave').onclick = async (e) => {
    $$('#mForm .err').forEach((x) => x.classList.remove('err'));
    const body = {};
    cfg.form.forEach((f) => {
      const el = $(`#mForm [name="${f.name}"]`);
      if (f.type === 'multi') { body[f.name] = $$(`#mForm [data-multi="${f.name}"] input:checked`).map((x) => x.value); return; }
      if (f.type === 'pkgparts') { body[f.name] = $$('#pkgP .pkg-row').map((r) => [r.querySelector('.pn').value.trim().toUpperCase(), Number(r.querySelector('.pq').value)]).filter((x) => x[0]); return; }
      if (f.type === 'rights') { if ($('#rmx') && !$('#rmx').classList.contains('locked')) body.rights = $$('#rmx input[data-code]:checked').map((x) => x.dataset.code); return; }
      if (!el || (rec && f.keyField) || f.readonly) return;
      body[f.name] = f.type === 'checkbox' ? el.checked : f.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value;
    });
    if (rec) body.active = $('#mForm [name=active]').checked;
    const missing = cfg.form.find((f) => f.required && !(rec && f.keyField) && (body[f.name] === '' || body[f.name] == null));
    if (missing) { toast(`${missing.label} is required`, 'err'); $(`#mForm [name="${missing.name}"]`).classList.add('err'); $(`#mForm [name="${missing.name}"]`).focus(); return; }
    const res = await act(e.currentTarget, () => (rec ? api('PATCH', `/masters/${type}/${encodeURIComponent(key)}`, body) : api('POST', `/masters/${type}`, body)), rec ? 'Changes saved' : `${cfg.single[0].toUpperCase() + cfg.single.slice(1)} added`);
    if (res) { closeModal(); App.reloadMeta(); if (type === 'roles' || type === 'rights' || type === 'users') await App.loadMe(); App.refresh(); }
  };
  $('#mDel') && ($('#mDel').onclick = async () => {
    const label = rec.name || rec.description || key;
    if (!(await confirmBox(`Delete ${cfg.single}?`, `<b>${esc(label)}</b> will be permanently removed. If you might need it later, deactivate it instead.`, 'Delete', true))) return;
    if (await act(null, () => api('DELETE', `/masters/${type}/${encodeURIComponent(key)}`), 'Deleted')) { App.reloadMeta(); App.refresh(); }
  });
}

/* vehicle insurance editor (uses the insurance master) */
function insuranceModal(vin) {
  const ins = window.__veh.insurance || {};
  const list = App.meta.lookups.insurers || [];
  openModal({
    title: 'Edit insurance',
    body: `<div class="stack">
      <label class="f">Insurance company <span style="color:var(--red)">*</span><select class="inp" id="iCo" name="company"><option value="">Select…</option>${list.map((n) => `<option ${n === ins.company ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
        <span class="hint">Not listed? Add it in <a href="#/masters/insurers" onclick="closeModal()">Masters → Insurance</a>.</span></label>
      <label class="f">Policy number <span style="color:var(--red)">*</span><input class="inp" id="iNo" name="policyNo" value="${esc(ins.policyNo || '')}"></label>
      <label class="f">Valid till <span style="color:var(--red)">*</span><input class="inp" id="iTill" name="validTill" type="date" value="${ins.validTill ? new Date(ins.validTill).toISOString().slice(0, 10) : ''}"></label></div>`,
    foot: `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="iSave">Save</button>`,
  });
  $('#iSave').onclick = async (e) => {
    const body = { company: $('#iCo').value, policyNo: $('#iNo').value, validTill: $('#iTill').value ? new Date($('#iTill').value + 'T23:59:00').toISOString() : '' };
    if (await act(e.currentTarget, () => api('PATCH', `/vehicles/${vin}/insurance`, body), 'Insurance updated')) { closeModal(); App.refresh(); }
  };
}

App.reloadMeta = async function () {
  try { App.meta = await api('GET', '/meta'); App.catalog = null; } catch {}
  App.updateBadges();
};

/* ---------- roles & rights helpers ---------- */
function roleModules(r) {
  if (r.system) return '<span class="muted small">Everything</span>';
  const all = window.__rightsIndex || {};
  const mods = [...new Set((r.rights || []).map((c) => all[c]).filter(Boolean))];
  return mods.length ? mods.map((m) => `<span class="badge b-slate" style="margin:0 4px 4px 0">${esc(m)}</span>`).join('') : '<span class="muted small">None</span>';
}
function rightsMatrix(rights, rec) {
  const locked = !!(rec && rec.system);
  const have = new Set(rec ? rec.rights || [] : []);
  const mods = [...new Set(rights.map((r) => r.module))];
  return `<div class="rmx ${locked ? 'locked' : ''}" id="rmx">${locked ? `<div class="alert info">${ic('info')}<div>The Administrator role always has every right, including rights added later.</div></div>` : ''}
    ${mods.map((m) => { const list = rights.filter((r) => r.module === m); return `<div class="mod"><div class="mod-h"><span>${esc(m)}</span>${locked ? '' : `<label class="small row" style="gap:6px;cursor:pointer"><input type="checkbox" data-mod="${esc(m)}">All</label>`}</div>
      ${list.map((r) => `<label class="rr"><input type="checkbox" data-code="${esc(r.code)}" data-m="${esc(m)}" ${locked || have.has(r.code) ? 'checked' : ''} ${locked || (r.active === false && !have.has(r.code)) ? 'disabled' : ''}><div><div style="font-weight:600;font-size:13px">${esc(r.name)} <span class="mono small muted">${esc(r.code)}</span>${r.active === false ? ' <span class="badge b-slate">Inactive</span>' : ''}</div><div class="d">${esc(r.description || '')}</div></div></label>`).join('')}</div>`; }).join('')}</div>`;
}
function wireRightsMatrix() {
  const sync = () => {
    $$('#rmx [data-mod]').forEach((m) => { const items = $$(`#rmx [data-m="${m.dataset.mod}"]:not(:disabled)`); const on = items.filter((x) => x.checked).length; m.checked = items.length && on === items.length; m.indeterminate = on > 0 && on < items.length; });
    const n = $$('#rmx input[data-code]:checked').length;
    $('#rCount').textContent = `${n} of ${$$('#rmx input[data-code]').length} selected`;
  };
  $$('#rmx [data-mod]').forEach((m) => (m.onchange = () => { $$(`#rmx [data-m="${m.dataset.mod}"]:not(:disabled)`).forEach((x) => (x.checked = m.checked)); sync(); }));
  $$('#rmx input[data-code]').forEach((x) => (x.onchange = sync));
  sync();
}

/* ---------- user switcher (demo: there is no password login yet) ---------- */
async function userSwitcher() {
  const meta = App.meta || (await api('GET', '/meta'));
  const users = meta.users || [];
  const cur = App.me?.user.id;
  openModal({
    title: 'Switch user',
    body: `<p class="muted small" style="margin-top:0">Choose who is using the app. Menus and actions follow the rights of that user’s role. (Demo mode – add a login before going live.)</p>
      <div class="userpick">${users.map((u) => `<button class="${u.id === cur ? 'on' : ''}" data-u="${esc(u.id)}"><span class="avatar" style="width:34px;height:34px;font-size:12px">${initials(u.name)}</span><div class="grow"><b>${esc(u.name)}</b><div class="small muted">${esc(u.role)}</div></div>${u.id === cur ? ic('check') : ''}</button>`).join('')}</div>`,
    foot: '<button class="btn" onclick="closeModal()">Cancel</button>',
  });
  $$('.userpick [data-u]').forEach((b) => (b.onclick = async () => {
    localStorage.setItem('wpUser', b.dataset.u);
    closeModal();
    await App.loadMe();
    toast(`Now using the app as ${App.me?.user.name}`);
    App.updateBadges();
    App.go(App.can('dashboard.view') ? '#/' : App.can('jobs.view') ? '#/jobs' : '#/settings');
    App.render();
  }));
}

function pkgRow(no, q) {
  return `<div class="row pkg-row" style="gap:8px;margin-bottom:6px"><input class="inp mono pn" list="dlPkgParts" value="${esc(no)}" placeholder="Part number" style="flex:3"><input class="inp pq" type="number" min="0.1" step="any" value="${esc(q)}" style="flex:1;max-width:100px"><button type="button" class="btn ghost sm icon" onclick="this.parentElement.remove()">${ic('trash', 'sm')}</button></div>`;
}
