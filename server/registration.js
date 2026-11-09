// Registering a vehicle that is not on file yet, for an existing or a new customer.
// Used by the new job card wizard: POST /api/vehicles/check validates the details
// (step 1), and POST /api/jobcards with `newVehicle` + `customer` saves the vehicle,
// the customer and the job card together.

const FUELS = ['Diesel', 'Unleaded 91', 'Premium unleaded 95/98', 'E10', 'LPG', 'Hybrid', 'Electric'];
const TRANSMISSIONS = ['Manual', 'Automatic'];
const CUSTOMER_TYPES = ['Private', 'Commercial'];
const ENTITIES = ['Individual', 'Sole trader', 'Partnership', 'Company', 'Trust', 'Government'];
const au = require('./au');
const COLOR_HEX = { white: '#d6dae0', silver: '#8b93a1', grey: '#6b7280', gray: '#6b7280', black: '#1f2937', blue: '#1f4fa8', red: '#b91c1c', brown: '#7c4a2d', green: '#166534', orange: '#c2410c', yellow: '#ca8a04', beige: '#d6c7a1', gold: '#b08d3c' };

/** Active names from a master, or the built-in list when the master does not exist yet. */
const activeNames = (list, fallback) => (Array.isArray(list) ? list.filter((x) => x.active !== false).map((x) => x.name) : fallback);
const normReg = (r) => String(r || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const tidyReg = (r) => String(r || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const digits = (p) => String(p || '').replace(/\D/g, '').slice(-10);

/** All customers on file (customers are stored as vehicle owners). */
function customers(db) {
  const map = new Map();
  for (const v of db.vehicles) {
    const o = v.owner;
    if (!o || !o.customerId) continue;
    if (!map.has(o.customerId)) map.set(o.customerId, Object.assign({}, o, { vehicles: [] }));
    map.get(o.customerId).vehicles.push({ vin: v.vin, reg: v.reg, model: v.model });
  }
  return [...map.values()];
}

function nextCustomerId(db) {
  const n = customers(db).reduce((m, c) => Math.max(m, Number(String(c.customerId).replace(/\D/g, '')) || 0), 10000) + 1;
  return 'C-' + String(n).padStart(5, '0');
}

/**
 * Validates and builds (does not save) a vehicle + customer.
 * @returns {{ vehicle, customer, isNewCustomer, warnings: string[] }}
 */
function buildRegistration(db, nv, cust, h) {
  const { bad, conflict, str } = h;
  if (!nv || typeof nv !== 'object') throw bad('Vehicle details are required', { field: 'newVehicle' });
  if (!cust || typeof cust !== 'object') throw bad('Choose an existing customer or enter a new one', { field: 'customer' });
  const warnings = [];

  // ---- vehicle
  const vin = str(nv.vin).toUpperCase().replace(/\s+/g, '');
  if (!vin) throw bad('VIN is required', { field: 'vin' });
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) throw bad('VIN must be 17 letters/numbers (the letters I, O and Q are not used in VINs)', { field: 'vin' });
  const dupVin = db.vehicles.find((v) => v.vin === vin);
  if (dupVin) throw conflict(`VIN ${vin} is already registered (${dupVin.reg}, ${dupVin.owner?.name || 'unknown owner'}). Search for it instead.`, { field: 'vin', vin });
  const reg = tidyReg(nv.reg).replace(/\s+/g, '');
  const regState = str(nv.regState).toUpperCase();
  if (regState && !au.STATES.includes(regState)) throw bad('Rego state must be one of ' + au.STATES.join(', '), { field: 'regState' });
  if (!reg) throw bad('Registration number is required', { field: 'reg' });
  if (normReg(reg).length < 2 || normReg(reg).length > 9) throw bad('Rego looks wrong (2–9 letters/numbers)', { field: 'reg' });
  const dupReg = db.vehicles.find((v) => normReg(v.reg) === normReg(reg));
  if (dupReg) throw conflict(`Registration ${reg} is already on file for VIN ${dupReg.vin}. Search for it instead.`, { field: 'reg', vin: dupReg.vin });
  const model = str(nv.model, 60);
  if (!model) throw bad('Model is required', { field: 'model' });
  const fuels = activeNames(db.fuelTypes, FUELS), gears = activeNames(db.transmissions, TRANSMISSIONS);
  const fuel = str(nv.fuel) || fuels[0];
  if (!fuels.includes(fuel)) throw bad(`Fuel must be one of ${fuels.join(', ')}`, { field: 'fuel' });
  const transmission = str(nv.transmission) || gears[0];
  if (!gears.includes(transmission)) throw bad(`Transmission must be one of ${gears.join(', ')}`, { field: 'transmission' });
  const engine = str(nv.engine, 30).toUpperCase();
  if (engine && db.vehicles.some((v) => String(v.engine).toUpperCase() === engine)) warnings.push(`Engine number ${engine} is already on another vehicle – please double-check it.`);
  const date = (val, label, field) => {
    if (!val) return '';
    const d = new Date(val);
    if (isNaN(d)) throw bad(`${label} is not a valid date`, { field });
    return d.toISOString();
  };
  const saleDate = date(nv.saleDate, 'Sale date', 'saleDate');
  if (saleDate && new Date(saleDate) > new Date()) throw bad('Sale date cannot be in the future', { field: 'saleDate' });
  let warrantyTill = date(nv.warrantyTill, 'Warranty valid till', 'warrantyTill');
  if (!warrantyTill && saleDate) { const w = new Date(saleDate); w.setFullYear(w.getFullYear() + 6); warrantyTill = w.toISOString(); }
  const color = str(nv.color, 40);
  const hex = /^#[0-9a-f]{6}$/i.test(str(nv.hex)) ? str(nv.hex) : COLOR_HEX[Object.keys(COLOR_HEX).find((k) => color.toLowerCase().includes(k))] || '#64748b';

  let insurance = null;
  const ins = nv.insurance || {};
  if (str(ins.company) || str(ins.policyNo)) {
    const company = str(ins.company);
    const master = db.insurers.find((i) => i.name === company);
    if (!master) throw bad('Choose the insurance company from the list', { field: 'insurance.company' });
    if (master.active === false) throw bad(`${company} is inactive in the insurance master`, { field: 'insurance.company' });
    if (!str(ins.policyNo)) throw bad('Policy number is required when an insurer is chosen', { field: 'insurance.policyNo' });
    insurance = { company, policyNo: str(ins.policyNo, 40).toUpperCase(), validTill: date(ins.validTill, 'Policy valid till', 'insurance.validTill') };
    if (!insurance.validTill) throw bad('Policy expiry date is required', { field: 'insurance.validTill' });
    if (new Date(insurance.validTill) < new Date()) warnings.push('The insurance policy has already expired.');
  }

  // ---- customer
  let customer;
  let isNewCustomer = false;
  if (str(cust.customerId)) {
    const found = customers(db).find((c) => c.customerId === str(cust.customerId));
    if (!found) throw bad(`Customer ${str(cust.customerId)} not found`, { field: 'customerId' });
    const { vehicles, ...owner } = found;
    customer = owner;
  } else {
    const name = str(cust.name, 80);
    if (!name) throw bad('Customer name is required', { field: 'customer.name' });
    const phone = au.normPhone(cust.phone);
    if (!phone || !au.isMobile(phone)) throw bad('Enter a valid Australian mobile number, e.g. 0412 345 678', { field: 'customer.phone' });
    const phone2 = str(cust.phone2) ? au.normPhone(cust.phone2) : '';
    if (str(cust.phone2) && !phone2) throw bad('Other phone is not a valid Australian number', { field: 'customer.phone2' });
    const abn = str(cust.abn);
    if (abn && !au.validAbn(abn)) throw bad('ABN is not valid (11 digits, failed the ATO check)', { field: 'customer.abn' });
    const email = str(cust.email, 80).toLowerCase();
    if (email && !/^\S+@\S+\.\S+$/.test(email)) throw bad('Email is not valid', { field: 'customer.email' });
    const type = str(cust.type) || 'Private';
    if (!CUSTOMER_TYPES.includes(type)) throw bad('Customer type must be Private or Commercial', { field: 'customer.type' });
    const entity = str(cust.entity) || 'Individual';
    if (!ENTITIES.includes(entity)) throw bad(`Entity must be one of ${ENTITIES.join(', ')}`, { field: 'customer.entity' });
    const same = customers(db).find((c) => digits(c.phone) === digits(phone) || (c.phone2 && digits(c.phone2) === digits(phone)));
    if (same && !cust.allowDuplicatePhone) {
      throw conflict(`Mobile ${phone} already belongs to ${same.name} (${same.customerId}). Use the existing customer, or confirm this is a different person.`, { field: 'customer.phone', existingCustomer: { customerId: same.customerId, name: same.name, phone: same.phone } });
    }
    isNewCustomer = true;
    customer = { customerId: nextCustomerId(db), name, phone, phone2, email, email2: '', address: str(cust.address, 300), type, entity, abn: abn ? au.formatAbn(abn) : '', vip: !!cust.vip, smsOptIn: cust.smsOptIn !== false, emailOptIn: cust.emailOptIn !== false, accountCustomer: false, paymentTermsDays: 0 };
  }

  const vehicle = {
    vin, reg, regState, model, variant: str(nv.variant, 60), color, hex, engine, fuel, transmission,
    saleDate, warrantyTill, sellingDealer: str(nv.sellingDealer, 100),
    owner: customer, insurance, alerts: [], plans: [], tickets: [], history: [],
    registeredAt: new Date().toISOString(),
  };
  return { vehicle, customer, isNewCustomer, warnings };
}

module.exports = { activeNames, customers, buildRegistration, nextCustomerId, FUELS, TRANSMISSIONS, CUSTOMER_TYPES, ENTITIES };
