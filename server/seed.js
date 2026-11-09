// Seed data for the Workshop Management System – Australian workshop (NSW).
// Everything here is sample data; it is written to the database on first run
// (or when POST /api/admin/reset is called). Prices are in AUD excluding GST.
// ABNs below are fictional but pass the ATO checksum.

const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();
const ago = (days, h = 0) => iso(Date.now() - days * DAY - h * 3600000);
const ahead = (days, h = 0) => iso(Date.now() + days * DAY + h * 3600000);

const P = (no, description, unit, category, brand, source, mrp, stock, extra = {}) =>
  Object.assign({ no, description, unit, category, brand, source, mrp, stock, supersededBy: '', alternateFor: '', hsn: '', gstPct: 10, reorderLevel: 2, active: true }, extra);
const L = (code, group, description, minutes, rate) => ({ code, group, description, minutes, rate, sacCode: '', gstPct: 10, active: true });

const catalog = {
  parts: [
    P('8974460950', 'Rotor, disc brake, front', 'EA', 'Brakes', 'Isuzu', 'OEM', 145, 0, { supersededBy: '8974460951' }),
    P('8974460951', 'Rotor, disc brake, front (rev. B)', 'EA', 'Brakes', 'Isuzu', 'OEM', 152, 6),
    P('AL-ROTOR-FR', 'Rotor, disc brake, front – aftermarket', 'EA', 'Brakes', 'DBA', 'Aftermarket', 118, 10, { alternateFor: '8974460950' }),
    P('8973697471', 'Brake pad set, front', 'SET', 'Brakes', 'Isuzu', 'OEM', 189, 4),
    P('BO-PAD-7781', 'Brake pad set, front – aftermarket', 'SET', 'Brakes', 'Bendix', 'Aftermarket', 129, 9, { alternateFor: '8973697471' }),
    P('8981436420', 'Oil filter element', 'EA', 'Engine', 'Isuzu', 'OEM', 24.5, 22),
    P('8980186710', 'Engine oil 5W-30 (1 L)', 'L', 'Lubricants', 'Isuzu', 'OEM', 14.8, 140),
    P('8981400910', 'Air filter element', 'EA', 'Engine', 'Isuzu', 'OEM', 58, 8),
    P('8981628920', 'Fuel filter cartridge', 'EA', 'Fuel', 'Isuzu', 'OEM', 96, 5),
    P('8980937150', 'Cabin air filter', 'EA', 'Air conditioning', 'Isuzu', 'OEM', 42, 11),
    P('HBA096036', 'Windscreen washer fluid (1 L)', 'L', 'Consumables', 'Isuzu', 'OEM', 6.5, 60),
    P('8972186330', 'Wiper blade set', 'SET', 'Body', 'Isuzu', 'OEM', 54, 3),
    P('8980645060', 'Exterior mirror assembly, LH', 'EA', 'Body', 'Isuzu', 'OEM', 485, 1),
    P('8981234560', 'Coolant, long life (1 L)', 'L', 'Lubricants', 'Isuzu', 'OEM', 18.9, 30),
  ],
  labour: [
    L('L-PMS10', 'Logbook service', 'Logbook service – 15,000 km / 12 months', 90, 247.5),
    L('L-PMS20', 'Logbook service', 'Logbook service – 30,000 km / 24 months', 120, 330),
    L('D0360', 'Air conditioning & heating', 'Heater control assembly – remove & refit', 75, 206.25),
    L('D0412', 'Air conditioning & heating', 'A/C regas and leak test', 40, 145),
    L('W0110', 'Wheels & tyres', 'Wheel alignment and balance', 60, 129),
    L('C0201', 'Clutch', 'Clutch kit replacement', 180, 495),
    L('H0127', 'Brakes', 'Front rotors – remove & refit both sides', 75, 206.25),
    L('H0140', 'Brakes', 'Front brake pad replacement', 45, 123.75),
    L('E0510', 'Engine', 'Diagnostic scan and fault finding', 60, 165),
    L('B0220', 'Body', 'Exterior mirror replacement', 30, 82.5),
  ],
  packages: [
    { code: 'PMS-10K', name: 'Logbook service – 15,000 km', group: 'Logbook servicing', parts: [['8981436420', 1], ['8980186710', 7], ['HBA096036', 1]], labour: ['L-PMS10'] },
    { code: 'PMS-20K', name: 'Logbook service – 30,000 km', group: 'Logbook servicing', parts: [['8981436420', 1], ['8980186710', 7], ['8981400910', 1], ['8981628920', 1]], labour: ['L-PMS20'] },
    { code: 'WT-BRK-F', name: 'Front brake overhaul', group: 'Wear & tear', parts: [['8974460950', 2], ['8973697471', 1]], labour: ['H0127', 'H0140'] },
    { code: 'AC-CARE', name: 'Air-conditioning service', group: 'Comfort', parts: [['8980937150', 1]], labour: ['D0412'] },
    { code: 'ALIGN', name: 'Wheel alignment & balance', group: 'Wear & tear', parts: [], labour: ['W0110'] },
  ],
  campaigns: [
    { id: 'CMP-WSS26', name: 'Wheel speed sensor inspection (safety recall 2026)', type: 'Recall', validTill: ahead(120), discountPct: 0 },
    { id: 'CMP-AC5', name: 'Summer A/C check – 5% off parts', type: 'Offer', validTill: ahead(60), discountPct: 5 },
  ],
};

const ADVISORS = ['Chloe Bennett', 'Tom Hughes', 'Arun Kumar'];
function history(km, seed) {
  return [0, 1, 2].map((i) => ({
    jobNumber: `RO-2025-${String(4200 + seed * 7 + i).padStart(5, '0')}`,
    dealer: 'Harbour City Isuzu',
    location: 'Auburn NSW',
    type: i % 2 ? 'Running repair' : 'Periodic service',
    odometer: Math.max(800, km - (i + 1) * 14500),
    openedAt: ago(180 * (i + 1) + 2),
    closedAt: ago(180 * (i + 1)),
    advisor: ADVISORS[i],
    rating: 5 - (i % 2),
    amount: [489.5, 312, 655.4][i],
    parts: [['8981436420', 'Oil filter element', 1], ['8980186710', 'Engine oil 5W-30 (1 L)', 7]],
    labour: [['L-PMS10', 'Logbook service – 15,000 km / 12 months', 247.5]],
    remarks: 'Next logbook service due in 15,000 km or 12 months. Front brake pads at 40%.',
  }));
}

function vehicle(v) {
  return Object.assign(
    {
      alerts: [],
      plans: [],
      tickets: [],
      history: [],
      sellingDealer: 'Harbour City Isuzu',
      insurance: { company: 'NRMA Insurance', policyNo: 'MOT' + Math.floor(1e7 + Math.random() * 9e7), validTill: ahead(140) },
    },
    v
  );
}
const owner = (o) => Object.assign({ phone2: '', email2: '', type: 'Private', entity: 'Individual', abn: '', vip: false, smsOptIn: true, emailOptIn: true, accountCustomer: false, paymentTermsDays: 0 }, o);

const vehicles = [
  vehicle({ vin: 'MPATFS86JHT010963', reg: 'DX84TR', regState: 'NSW', model: 'D-Max', variant: 'X-Terrain 4x4 Auto', color: 'Cobalt Blue', hex: '#1f4fa8', engine: '4JJ3-464819', fuel: 'Diesel', transmission: 'Automatic', saleDate: ago(610), warrantyTill: ahead(1215),
    owner: owner({ customerId: 'C-12418', name: 'Daniel Murphy', phone: '0412555018', email: 'daniel.murphy@example.com', address: '14 Kent Street, Auburn NSW 2144' }),
    alerts: [{ level: 'warning', text: 'Wheel speed sensor recall pending' }],
    plans: [{ name: 'Isuzu capped price servicing – 7 years', validTill: ahead(1950), usage: '2 of 7 services used' }],
    history: history(18400, 1) }),
  vehicle({ vin: 'MPAUCR85HKT000877', reg: '1QX7LM', regState: 'VIC', model: 'MU-X', variant: 'LS-T 4x2 Auto', color: 'Cobalt Blue', hex: '#203d78', engine: 'RZ4E-551203', fuel: 'Diesel', transmission: 'Automatic', saleDate: ago(1390), warrantyTill: ahead(1150),
    owner: owner({ customerId: 'C-10077', name: 'Priya Sharma', phone: '0423555077', phone2: '0398765077', email: 'priya.sharma@example.com', address: '8 Wattle Avenue, Glen Waverley VIC 3150', vip: true }),
    alerts: [{ level: 'critical', text: 'Aftermarket wiring found at last visit – inspect harness' }],
    insurance: { company: 'RACV', policyNo: 'MOT51716335', validTill: ahead(200) },
    history: history(64200, 2) }),
  vehicle({ vin: 'MPATFS86JGT004120', reg: 'EQ12KZ', regState: 'NSW', model: 'D-Max', variant: 'SX Space Cab Ute', color: 'Mineral White', hex: '#d6dae0', engine: '4JJ3-228190', fuel: 'Diesel', transmission: 'Manual', saleDate: ago(820), warrantyTill: ahead(1000),
    owner: owner({ customerId: 'C-11502', name: 'Coastal Plumbing Pty Ltd', phone: '0434555502', email: 'accounts@coastalplumbing.example', address: '3/21 Industrial Drive, Mayfield West NSW 2304', type: 'Commercial', entity: 'Company', abn: '33 102 407 376', accountCustomer: true, paymentTermsDays: 30 }),
    history: history(41500, 3) }),
  vehicle({ vin: 'MPATFS86JHT011155', reg: '512KXT', regState: 'QLD', model: 'D-Max', variant: 'SX Single Cab Chassis', color: 'Mercury Silver', hex: '#8b93a1', engine: '4JJ3-230044', fuel: 'Diesel', transmission: 'Manual', saleDate: ago(1260), warrantyTill: ahead(1290),
    owner: owner({ customerId: 'C-10931', name: 'Jason Nguyen', phone: '0450555931', email: 'jason.nguyen@example.com', address: '22 Orchid Street, Sunnybank QLD 4109', type: 'Commercial', entity: 'Sole trader', abn: '33 103 230 952' }),
    insurance: { company: 'Suncorp', policyNo: 'MOT42130041', validTill: ahead(90) },
    history: history(88200, 4) }),
  vehicle({ vin: 'MPAUCR85HJT000321', reg: '1HKR210', regState: 'WA', model: 'MU-X', variant: 'LS-U 4x4 Auto', color: 'Basalt Black', hex: '#1f2937', engine: 'RZ4E-540901', fuel: 'Diesel', transmission: 'Automatic', saleDate: ago(1850), warrantyTill: ahead(705),
    owner: owner({ customerId: 'C-09810', name: 'Emma Wilson', phone: '0466555810', email: 'emma.wilson@example.com', address: '5 Banksia Court, Joondalup WA 6027' }),
    insurance: { company: 'AAMI', policyNo: 'MOT65333907', validTill: ahead(260) },
    history: history(102300, 5) }),
  vehicle({ vin: 'M3GTGS664J8AC1419', reg: 'ZTR914', regState: 'VIC', model: 'D-Max', variant: 'SX Cab Chassis Tray', color: 'Mineral White', hex: '#d6dae0', engine: '4JJ3-A1E903', fuel: 'Diesel', transmission: 'Manual', saleDate: ago(640), warrantyTill: ahead(1185),
    owner: owner({ customerId: 'C-12136', name: 'Murray Station Supplies', phone: '0478555136', email: 'office@murraystation.example', address: '41 Sturt Highway, Mildura VIC 3500', type: 'Commercial', entity: 'Sole trader', abn: '33 103 246 790' }),
    alerts: [{ level: 'warning', text: 'Insurance expires within 6 months' }],
    insurance: { company: 'Allianz', policyNo: 'MOT35212748', validTill: ahead(150) },
    plans: [{ name: 'Extended warranty – 2 years / 50,000 km', validTill: ahead(1100), usage: 'Active' }],
    history: history(22100, 6) }),
];

const SECTIONS = {
  reception: ['Customer concerns recorded', 'Service history reviewed', 'Warranty eligibility checked', 'Valuables removed from vehicle', 'Spare key received'],
  interior: ['Dashboard warning lights', 'A/C and heater operation', 'Infotainment & speakers', 'Seat belts', 'Power windows', 'Interior lights'],
  exterior: ['Body panels – scratches / dents', 'Windscreen', 'Mouldings & trims', 'Wheels & tyres', 'Head & tail lights'],
  engine: ['Engine oil level', 'Coolant level', 'Brake fluid level', 'Battery terminals', 'Drive belts', 'Leaks under engine bay'],
  boot: ['Spare wheel', 'Jack & wheel brace', 'Warning triangle', 'First-aid kit'],
};

function inspection(notOk = []) {
  const out = {};
  for (const [k, items] of Object.entries(SECTIONS)) {
    out[k] = items.map((item) => ({ item, ok: !notOk.includes(item), action: notOk.includes(item) ? 'Repair' : '' }));
  }
  return out;
}

function line(id, kind, code, description, qty, rate, status, extra = {}) {
  return Object.assign({ id, kind, code, description, qty, rate, taxPct: 10, discountPct: 0, status, blocked: false, remarks: '' }, extra);
}

function job(o) {
  return Object.assign(
    {
      status: 'active',
      stage: 'in_progress',
      jobType: 'Periodic service',
      repeatRepair: false,
      lift: true,
      odometerFaulty: false,
      fuelLevel: 2,
      drivenBy: 'Owner',
      customerWaiting: false,
      extras: { wash: true, interiorClean: false },
      serviceVan: '',
      advisor: 'Arun Kumar',
      technician: 'Suresh M',
      bay: 'Bay 3',
      campaigns: catalog.campaigns.map((c) => ({ id: c.id, name: c.name, applied: false })),
      inspection: inspection(['Wheels & tyres']),
      damages: [],
      feedback: null,
      proforma: null,
      invoice: null,
    },
    o
  );
}

const jobcards = [
  job({ id: 'RO-2026-00563', vin: 'MPATFS86JHT010963', stage: 'in_progress', jobType: 'Warranty', odometer: 18400, arrivedAt: ago(1, 3), promisedAt: ahead(1, 2), bay: 'Bay 2',
    concerns: [{ id: 1, kind: 'voice', text: 'Scheduled 30,000 km logbook service', observation: 'Service due as per logbook' }, { id: 2, kind: 'voice', text: 'Brake noise when stopping', observation: 'Front rotor scoring visible' }, { id: 3, kind: 'advice', text: 'Left exterior mirror should be replaced', observation: '' }],
    lines: [
      line(1, 'labour', 'L-PMS20', 'Logbook service – 30,000 km / 24 months', 1, 330, 'approved', { concernId: 1 }),
      line(2, 'part', '8981436420', 'Oil filter element', 1, 24.5, 'approved', { concernId: 1 }),
      line(3, 'part', '8980186710', 'Engine oil 5W-30 (1 L)', 7, 14.8, 'approved', { concernId: 1 }),
      line(4, 'part', '8974460950', 'Rotor, disc brake, front', 2, 145, 'pending', { concernId: 2 }),
      line(5, 'labour', 'H0127', 'Front rotors – remove & refit both sides', 1, 206.25, 'pending', { concernId: 2 }),
      line(6, 'part', '8980645060', 'Exterior mirror assembly, LH', 1, 485, 'pending', { concernId: 3 }),
    ],
    campaigns: [{ id: 'CMP-WSS26', name: catalog.campaigns[0].name, applied: true }, { id: 'CMP-AC5', name: catalog.campaigns[1].name, applied: false }],
    activity: [{ at: ago(1, 3), by: 'Arun Kumar', text: 'Job card opened at check-in' }, { at: ago(1, 2), by: 'Arun Kumar', text: 'Customer approved logbook service lines' }, { at: ago(0, 5), by: 'Suresh M', text: 'Work started in Bay 2' }] }),
  job({ id: 'RO-2026-00564', vin: 'MPATFS86JGT004120', stage: 'checked_in', jobType: 'Paid service', odometer: 41500, arrivedAt: ago(0, 2), promisedAt: ahead(0, 6), bay: '', technician: '', customerWaiting: true,
    concerns: [{ id: 1, kind: 'voice', text: 'A/C not cooling enough', observation: '' }],
    lines: [line(1, 'labour', 'D0412', 'A/C regas and leak test', 1, 145, 'pending', { concernId: 1 }), line(2, 'part', '8980937150', 'Cabin air filter', 1, 42, 'pending', { concernId: 1 })],
    activity: [{ at: ago(0, 2), by: 'Arun Kumar', text: 'Job card opened at check-in' }] }),
  job({ id: 'RO-2026-00558', vin: 'MPAUCR85HKT000877', stage: 'ready_invoice', jobType: 'Accident repair', odometer: 64200, arrivedAt: ago(3, 1), promisedAt: ahead(0, 4), bay: 'Bay 5', technician: 'Ravi P',
    concerns: [{ id: 1, kind: 'voice', text: 'Front bumper damage after minor collision', observation: 'Bumper cracked, LH fog light housing broken' }],
    lines: [line(1, 'labour', 'E0510', 'Diagnostic scan and fault finding', 1, 165, 'approved', { concernId: 1 }), line(2, 'part', '8972186330', 'Wiper blade set', 1, 54, 'approved', { concernId: 1 })],
    damages: [{ x: 38, y: 62, type: 'dent' }, { x: 63, y: 58, type: 'scratch' }],
    activity: [{ at: ago(3, 1), by: 'Arun Kumar', text: 'Job card opened at check-in' }, { at: ago(1), by: 'Ravi P', text: 'Work completed, ready for invoicing' }] }),
  job({ id: 'RO-2026-00549', vin: 'MPATFS86JHT011155', stage: 'ready_delivery', jobType: 'Running repair', odometer: 88200, arrivedAt: ago(4, 2), promisedAt: ago(0, 1), bay: 'Bay 1', technician: 'Suresh M',
    concerns: [{ id: 1, kind: 'voice', text: 'Vehicle pulls to the left', observation: 'Alignment out of spec' }],
    lines: [line(1, 'labour', 'W0110', 'Wheel alignment and balance', 1, 129, 'approved', { concernId: 1 })],
    proforma: { at: ago(1), total: 141.9 },
    activity: [{ at: ago(4, 2), by: 'Arun Kumar', text: 'Job card opened at check-in' }, { at: ago(1), by: 'Arun Kumar', text: 'Quote sent to customer' }] }),
  job({ id: 'RO-2026-00531', vin: 'MPAUCR85HJT000321', status: 'closed', stage: 'delivered', jobType: 'Periodic service', odometer: 102300, arrivedAt: ago(6, 3), promisedAt: ago(5), bay: 'Bay 4', technician: 'Ravi P',
    concerns: [{ id: 1, kind: 'voice', text: '105,000 km logbook service', observation: '' }],
    lines: [line(1, 'labour', 'L-PMS20', 'Logbook service – 30,000 km / 24 months', 1, 330, 'approved', { concernId: 1 }), line(2, 'part', '8981400910', 'Air filter element', 1, 58, 'approved', { concernId: 1 })],
    feedback: { scores: [5, 4, 5, 5], comment: 'Quick and clean work.', at: ago(4) },
    invoice: { number: 'INV-000001', at: ago(5), total: 426.8 },
    activity: [{ at: ago(6, 3), by: 'Arun Kumar', text: 'Job card opened at check-in' }, { at: ago(5), by: 'Arun Kumar', text: 'Job card closed and tax invoice INV-000001 issued' }] }),
];

// Always hand out a deep copy so edits never leak back into the seed objects.
const { seedRights, seedRoles } = require('./access');

module.exports = function seed() {
  return structuredClone({
    rights: seedRights(),
    roles: seedRoles(),
    meta: { version: 2, createdAt: new Date().toISOString(), nextJob: 566, nextInvoice: 2, country: 'AU' },
    workshop: {
      name: 'Harbour City Isuzu Service',
      legalName: 'Harbour City Motors Pty Ltd',
      code: 'HCI-AUB',
      abn: '51 824 753 556',
      address: '120 Parramatta Road',
      suburb: 'Auburn',
      state: 'NSW',
      postcode: '2144',
      phone: '02 9748 1100',
      email: 'service@harbourcityisuzu.example',
      website: 'harbourcityisuzu.example',
      mvrl: 'MVRL 12345',
      gstPct: 10,
      currency: 'AUD',
      locale: 'en-AU',
      timezone: 'Australia/Sydney',
      fyStartMonth: 7,
      labourRate: 165,
      bankName: 'Commonwealth Bank',
      bsb: '062-000',
      accountNo: '1234 5678',
      accountName: 'Harbour City Motors Pty Ltd',
      payId: 'accounts@harbourcityisuzu.example',
      invoiceTerms: 'Payment is due on collection of the vehicle unless you have an approved account (30 days). Parts and labour carry a 12-month / 20,000 km warranty. Your rights under the Australian Consumer Law are not affected.',
      quoteValidityDays: 14,
      logo: '',
    },
    users: [
      { id: 'U001', name: 'Arun Kumar', role: 'Service Advisor', phone: '0412000101', email: 'arun.kumar@example.com', active: true },
      { id: 'U002', name: 'Suresh M', role: 'Technician', phone: '0412000102', email: 'suresh.m@example.com', active: true },
      { id: 'U003', name: 'Ravi P', role: 'Technician', phone: '0412000103', email: 'ravi.p@example.com', active: true },
      { id: 'U004', name: 'Imran K', role: 'Technician', phone: '0412000104', email: 'imran.k@example.com', active: true },
      { id: 'U005', name: 'Meera S', role: 'Workshop Manager', phone: '0412000105', email: 'meera.s@example.com', active: true },
      { id: 'U006', name: 'Kiran D', role: 'Parts Manager', phone: '0412000106', email: 'kiran.d@example.com', active: true },
      { id: 'U007', name: 'Lata R', role: 'Cashier', phone: '0412000107', email: 'lata.r@example.com', active: false },
      { id: 'U008', name: 'Sanjay R', role: 'Administrator', phone: '0412000108', email: 'sanjay.r@example.com', active: true },
    ],
    provinces: [
      { id: 'PRV001', name: 'New South Wales', code: 'NSW', country: 'Australia', active: true },
      { id: 'PRV002', name: 'Victoria', code: 'VIC', country: 'Australia', active: true },
      { id: 'PRV003', name: 'Queensland', code: 'QLD', country: 'Australia', active: true },
      { id: 'PRV004', name: 'Western Australia', code: 'WA', country: 'Australia', active: true },
      { id: 'PRV005', name: 'South Australia', code: 'SA', country: 'Australia', active: true },
      { id: 'PRV006', name: 'Tasmania', code: 'TAS', country: 'Australia', active: true },
      { id: 'PRV007', name: 'Australian Capital Territory', code: 'ACT', country: 'Australia', active: true },
      { id: 'PRV008', name: 'Northern Territory', code: 'NT', country: 'Australia', active: true },
    ],
    cities: [
      { id: 'CTY001', name: 'Sydney', provinceId: 'PRV001', active: true },
      { id: 'CTY002', name: 'Parramatta', provinceId: 'PRV001', active: true },
      { id: 'CTY003', name: 'Newcastle', provinceId: 'PRV001', active: true },
      { id: 'CTY004', name: 'Melbourne', provinceId: 'PRV002', active: true },
      { id: 'CTY005', name: 'Geelong', provinceId: 'PRV002', active: true },
      { id: 'CTY006', name: 'Brisbane', provinceId: 'PRV003', active: true },
      { id: 'CTY007', name: 'Gold Coast', provinceId: 'PRV003', active: true },
      { id: 'CTY008', name: 'Perth', provinceId: 'PRV004', active: true },
      { id: 'CTY009', name: 'Adelaide', provinceId: 'PRV005', active: true },
      { id: 'CTY010', name: 'Hobart', provinceId: 'PRV006', active: true },
      { id: 'CTY011', name: 'Canberra', provinceId: 'PRV007', active: true },
      { id: 'CTY012', name: 'Darwin', provinceId: 'PRV008', active: true },
    ],
    dealers: [
      { id: 'DLR001', name: 'Harbour City Isuzu', code: 'HCI', abn: '51 824 753 556', provinceId: 'PRV001', cityId: 'CTY001', address: '120 Parramatta Road, Auburn NSW 2144', contactPerson: 'Meera S', phone: '0297481100', email: 'service@harbourcityisuzu.example', active: true },
      { id: 'DLR002', name: 'Bayside Isuzu UTE', code: 'BAY', abn: '33 100 483 059', provinceId: 'PRV002', cityId: 'CTY004', address: '455 Nepean Highway, Moorabbin VIC 3189', contactPerson: 'Karen Lee', phone: '0395551200', email: 'service@baysideisuzu.example', active: true },
      { id: 'DLR003', name: 'Gold Coast Isuzu', code: 'GCI', abn: '33 100 696 872', provinceId: 'PRV003', cityId: 'CTY007', address: '88 Southport Nerang Road, Southport QLD 4215', contactPerson: 'Rob Jenkins', phone: '0755550900', email: 'service@gcisuzu.example', active: true },
    ],
    outlets: [
      { id: 'OUT001', name: 'Harbour City – Auburn', code: 'HCI-AUB', dealerId: 'DLR001', type: 'Dealership (sales, service, parts)', cityId: 'CTY001', address: '120 Parramatta Road, Auburn NSW 2144', phone: '0297481100', bays: 8, active: true },
      { id: 'OUT002', name: 'Harbour City – Parramatta Service', code: 'HCI-PAR', dealerId: 'DLR001', type: 'Service centre', cityId: 'CTY002', address: '9 Church Street, Parramatta NSW 2150', phone: '0296351200', bays: 5, active: true },
      { id: 'OUT003', name: 'Bayside – Moorabbin', code: 'BAY-MOO', dealerId: 'DLR002', type: 'Dealership (sales, service, parts)', cityId: 'CTY004', address: '455 Nepean Highway, Moorabbin VIC 3189', phone: '0395551200', bays: 6, active: true },
      { id: 'OUT004', name: 'Gold Coast Body Repairs', code: 'GCI-BR', dealerId: 'DLR003', type: 'Body shop', cityId: 'CTY007', address: '14 Expansion Street, Molendinar QLD 4214', phone: '0755550950', bays: 4, active: true },
    ],
    insurers: [
      { id: 'INS001', name: 'NRMA Insurance', code: 'NRMA', contactPerson: 'Claims team', phone: '132132', email: 'claims@nrma.example', address: 'Sydney NSW', abn: '', cashless: true, active: true },
      { id: 'INS002', name: 'AAMI', code: 'AAMI', contactPerson: 'Claims team', phone: '132244', email: 'claims@aami.example', address: 'Brisbane QLD', abn: '', cashless: true, active: true },
      { id: 'INS003', name: 'Allianz', code: 'ALLIANZ', contactPerson: 'Motor claims', phone: '131000', email: 'motorclaims@allianz.example', address: 'Sydney NSW', abn: '', cashless: true, active: true },
      { id: 'INS004', name: 'Suncorp', code: 'SUNCORP', contactPerson: 'Claims team', phone: '131155', email: 'claims@suncorp.example', address: 'Brisbane QLD', abn: '', cashless: true, active: true },
      { id: 'INS005', name: 'RACV', code: 'RACV', contactPerson: 'Claims team', phone: '131903', email: 'claims@racv.example', address: 'Melbourne VIC', abn: '', cashless: true, active: true },
      { id: 'INS006', name: 'Budget Direct', code: 'BUDGET', contactPerson: '', phone: '1300169006', email: '', address: 'Brisbane QLD', abn: '', cashless: false, active: true },
    ],
    lookups: {
      jobTypes: ['Periodic service', 'Paid service', 'Free service', 'Warranty', 'Running repair', 'Accident repair', 'PDI'],
      drivenBy: ['Owner', 'Driver', 'Family member', 'Pick-up & drop-off'],
      delayReasons: ['Parts on back order', 'Additional work requested', 'Waiting on customer approval', 'Waiting on insurer authority', 'Technician unavailable', 'Sublet work (outside supplier)'],
      declineReasons: ['Too expensive', 'Will do at next service', 'Not required by customer', 'Getting it done elsewhere'],
      replaceReasons: ['Original part superseded', 'Original part on back order', 'Customer preference', 'Cost saving'],
      bays: ['Bay 1', 'Bay 2', 'Bay 3', 'Bay 4', 'Bay 5', 'Wash bay'],
      serviceVans: ['CV54PK', 'DB19RT'],
      inspectionSections: SECTIONS,
      feedbackQuestions: [
        'Service reminders were timely and useful',
        'The advisor explained the work and costs clearly',
        'Vehicle was ready at the promised time',
        'Cleanliness of the vehicle after service',
      ],
    },
    catalog,
    vehicles,
    jobcards,
  });
};
