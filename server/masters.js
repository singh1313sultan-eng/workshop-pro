// Master data: users, roles, rights, parts, labour, insurers and the dealer network.
// One schema per master drives validation, uniqueness, search, rename cascades
// and "in use" protection, so all four share the same CRUD endpoints:
//   GET    /api/masters/:type?q=&active=true|false
//   GET    /api/masters/:type/:key
//   POST   /api/masters/:type
//   PATCH  /api/masters/:type/:key
//   DELETE /api/masters/:type/:key       (blocked while the record is in use – deactivate instead)

const access = require('./access');
const au = require('./au');
const UNITS = ['EA', 'SET', 'PAIR', 'L', 'KG', 'M'];
const SOURCES = ['OEM', 'Aftermarket'];
const GST = [10, 0]; // 10% GST or GST-free
const OUTLET_TYPES = ['Dealership (sales, service, parts)', 'Service centre', 'Body shop', 'Showroom', 'Parts outlet'];

function schemas(getDb) {
  const db = () => getDb();
  const openJobs = () => db().jobcards.filter((j) => j.status !== 'closed');
  const otherAdmin = (u) => db().users.some((x) => x !== u && x.id !== u.id && access.isAdminUser(db(), x));
  return {
    packages: {
      label: 'Service package',
      key: 'code',
      list: () => db().catalog.packages,
      search: ['code', 'name', 'group'],
      fields: {
        code: { type: 'code', required: true, max: 20, label: 'Package code' },
        name: { type: 'string', required: true, max: 100, unique: true },
        group: { type: 'string', max: 60, default: 'Service' },
        parts: { type: 'partlist', default: [], label: 'Parts' },
        labour: { type: 'list', ref: 'labour', default: [], label: 'Labour' },
        active: { type: 'bool', default: true },
      },
      check(r) { if (!(r.parts || []).length && !(r.labour || []).length) return 'A package needs at least one part or labour operation'; },
      inUse: () => null,
    },
    campaigns: {
      label: 'Campaign',
      key: 'id',
      autoKey: 'CMP',
      list: () => db().catalog.campaigns,
      search: ['id', 'name', 'type'],
      fields: {
        name: { type: 'string', required: true, max: 120, unique: true },
        type: { type: 'enum', values: ['Recall', 'Service campaign', 'Offer'], required: true },
        validTill: { type: 'date', required: true, label: 'Valid until' },
        discountPct: { type: 'number', min: 0, max: 50, default: 0, label: 'Parts discount %' },
        active: { type: 'bool', default: true },
      },
      inUse(c) {
        const n = openJobs().filter((j) => (j.campaigns || []).some((x) => x.id === c.id && x.applied)).length;
        return n ? `Applied on ${n} open job card(s)` : null;
      },
    },
    suppliers: {
      label: 'Supplier',
      key: 'id',
      autoKey: 'SUP',
      list: () => db().suppliers,
      search: ['id', 'name', 'abn', 'contactPerson', 'phone', 'email'],
      fields: {
        name: { type: 'string', required: true, max: 100, unique: true },
        abn: { type: 'abn', unique: true, label: 'ABN' },
        contactPerson: { type: 'string', max: 80, label: 'Contact person' },
        phone: { type: 'phone' },
        email: { type: 'email' },
        address: { type: 'string', max: 300 },
        accountNo: { type: 'string', max: 30, label: 'Our account no.' },
        paymentTermsDays: { type: 'int', min: 0, max: 120, default: 30, label: 'Payment terms (days)' },
        active: { type: 'bool', default: true },
      },
      inUse(s) {
        const po = (db().purchaseOrders || []).filter((p) => p.supplierId === s.id).length;
        const g = (db().stockInwards || []).filter((x) => x.supplierId === s.id).length;
        return po || g ? `${s.name} has ${po} purchase order(s) and ${g} goods receipt(s)` : null;
      },
      onRename(old, now) { (db().purchaseOrders || []).forEach((p) => { if (p.supplierId === now.id) p.supplierName = now.name; }); },
    },
    repairTypes: {
      label: 'Repair type',
      key: 'id',
      autoKey: 'RT',
      list: () => db().repairTypes,
      search: ['id', 'name', 'code', 'description'],
      fields: {
        name: { type: 'string', required: true, max: 60, unique: true },
        code: { type: 'code', required: true, max: 10, unique: true, label: 'Short code' },
        description: { type: 'string', max: 300 },
        active: { type: 'bool', default: true },
      },
      inUse(r) {
        const n = openJobs().filter((j) => j.jobType === r.name).length;
        return n ? `${n} open job card(s) use ${r.name}` : null;
      },
      onRename(old, now) { db().jobcards.forEach((j) => { if (j.jobType === old.name) j.jobType = now.name; }); },
    },
    fuelTypes: {
      label: 'Fuel type',
      key: 'id',
      autoKey: 'FT',
      list: () => db().fuelTypes,
      search: ['id', 'name'],
      fields: {
        name: { type: 'string', required: true, max: 30, unique: true },
        active: { type: 'bool', default: true },
      },
      inUse(r) {
        const n = db().vehicles.filter((v) => v.fuel === r.name).length;
        return n ? `${n} vehicle(s) use ${r.name}` : null;
      },
      onRename(old, now) { db().vehicles.forEach((v) => { if (v.fuel === old.name) v.fuel = now.name; }); },
    },
    transmissions: {
      label: 'Transmission type',
      key: 'id',
      autoKey: 'TT',
      list: () => db().transmissions,
      search: ['id', 'name', 'description'],
      fields: {
        name: { type: 'string', required: true, max: 30, unique: true },
        description: { type: 'string', max: 200 },
        active: { type: 'bool', default: true },
      },
      inUse(r) {
        const n = db().vehicles.filter((v) => v.transmission === r.name).length;
        return n ? `${n} vehicle(s) use ${r.name}` : null;
      },
      onRename(old, now) { db().vehicles.forEach((v) => { if (v.transmission === old.name) v.transmission = now.name; }); },
    },
    roles: {
      label: 'Role',
      key: 'id',
      autoKey: 'R',
      list: () => db().roles,
      search: ['id', 'name', 'description'],
      fields: {
        name: { type: 'string', required: true, max: 60, unique: true },
        description: { type: 'string', max: 300 },
        rights: { type: 'list', ref: 'rights', default: [] },
        active: { type: 'bool', default: true },
      },
      check(r, existing) {
        if (existing && existing.system) {
          if (r.name !== existing.name) return 'The Administrator role is built in and cannot be renamed';
          if (r.active === false) return 'The Administrator role is built in and cannot be deactivated';
        }
        if (existing && r.active === false && existing.active !== false && db().users.some((u) => u.active !== false && u.role === existing.name)) return `Active users still have the ${existing.name} role. Move them to another role first.`;
      },
      inUse(r) {
        if (r.system) return 'This is the built-in Administrator role';
        const n = db().users.filter((u) => u.role === r.name).length;
        return n ? `${n} user(s) have this role` : null;
      },
      onRename(old, now) {
        db().users.forEach((u) => { if (u.role === old.name) u.role = now.name; });
      },
    },
    rights: {
      label: 'Right',
      key: 'code',
      list: () => db().rights,
      search: ['code', 'name', 'module', 'description'],
      fields: {
        code: { type: 'slug', required: true, max: 40, label: 'Right code' },
        module: { type: 'enum', values: access.MODULES, required: true },
        name: { type: 'string', required: true, max: 80, unique: true },
        description: { type: 'string', max: 300 },
        active: { type: 'bool', default: true },
      },
      inUse(r) {
        const n = db().roles.filter((x) => !x.system && (x.rights || []).includes(r.code)).length;
        if (r.system) return `Built-in right checked by the app${n ? ` and assigned to ${n} role(s)` : ''}`;
        return n ? `Assigned to ${n} role(s)` : null;
      },
    },
    users: {
      label: 'User',
      key: 'id',
      autoKey: 'U',
      list: () => db().users,
      search: ['id', 'name', 'role', 'phone', 'email'],
      fields: {
        name: { type: 'string', required: true, max: 80, unique: true },
        role: { type: 'ref', ref: 'roles', by: 'name', required: true },
        phone: { type: 'phone', required: true },
        email: { type: 'email', unique: true },
        outletIds: { type: 'list', ref: 'outlets', default: [], label: 'Branches (leave empty for all)' },
        active: { type: 'bool', default: true },
      },
      check(u, existing) {
        // never lock everyone out: keep at least one active administrator
        if (existing && access.isAdminUser(db(), existing) && !access.isAdminUser(db(), u) && !otherAdmin(existing)) return 'This is the last active Administrator. Give another user the Administrator role first.';
      },
      inUse(u) {
        if (access.isAdminUser(db(), u) && !otherAdmin(u)) return `${u.name} is the last active Administrator`;
        const n = openJobs().filter((j) => j.advisor === u.name || j.technician === u.name).length;
        return n ? `${u.name} is assigned to ${n} open job card(s)` : null;
      },
      onRename(old, now) {
        db().jobcards.forEach((j) => {
          if (j.advisor === old.name) j.advisor = now.name;
          if (j.technician === old.name) j.technician = now.name;
        });
      },
    },
    parts: {
      label: 'Part',
      key: 'no',
      list: () => db().catalog.parts,
      search: ['no', 'description', 'category', 'brand'],
      fields: {
        no: { type: 'code', required: true, max: 30, label: 'Part number' },
        description: { type: 'string', required: true, max: 120 },
        category: { type: 'string', required: true, max: 40 },
        brand: { type: 'string', required: true, max: 40 },
        source: { type: 'enum', values: SOURCES, required: true },
        unit: { type: 'enum', values: UNITS, required: true },
        gstPct: { type: 'enum', values: GST, number: true, default: 10, label: 'GST %' },
        mrp: { type: 'number', required: true, min: 0, max: 10000000, label: 'Sell price (ex GST)' },
        stock: { type: 'int', min: 0, max: 1000000, default: 0, readonly: true },
        reorderLevel: { type: 'int', min: 0, max: 100000, default: 0, label: 'Reorder level' },
        supersededBy: { type: 'ref', ref: 'parts', label: 'Superseded by' },
        alternateFor: { type: 'ref', ref: 'parts', label: 'Alternate for' },
        active: { type: 'bool', default: true },
      },
      inUse(p) {
        const pk = db().catalog.packages.filter((k) => k.parts.some(([no]) => no === p.no)).map((k) => k.name);
        if (pk.length) return `Part is used in package(s): ${pk.join(', ')}`;
        const n = openJobs().filter((j) => j.lines.some((l) => l.kind === 'part' && l.code === p.no)).length;
        if (n) return `Part is on ${n} open job card estimate(s)`;
        if (db().catalog.parts.some((x) => x.supersededBy === p.no || x.alternateFor === p.no)) return 'Other parts point to this part as superseded/alternate';
        return null;
      },
    },
    labour: {
      label: 'Labour operation',
      key: 'code',
      list: () => db().catalog.labour,
      search: ['code', 'description', 'group'],
      fields: {
        code: { type: 'code', required: true, max: 20, label: 'Operation code' },
        description: { type: 'string', required: true, max: 120 },
        group: { type: 'string', required: true, max: 40 },
        minutes: { type: 'int', required: true, min: 1, max: 6000, label: 'Standard time (min)' },
        rate: { type: 'number', required: true, min: 0, max: 1000000 },
        gstPct: { type: 'enum', values: GST, number: true, default: 10, label: 'GST %' },
        active: { type: 'bool', default: true },
      },
      inUse(l) {
        const pk = db().catalog.packages.filter((k) => k.labour.includes(l.code)).map((k) => k.name);
        if (pk.length) return `Operation is used in package(s): ${pk.join(', ')}`;
        const n = openJobs().filter((j) => j.lines.some((x) => x.kind === 'labour' && x.code === l.code)).length;
        return n ? `Operation is on ${n} open job card estimate(s)` : null;
      },
    },
    provinces: {
      label: 'State / territory',
      key: 'id',
      autoKey: 'PRV',
      list: () => db().provinces,
      search: ['id', 'name', 'code'],
      fields: {
        name: { type: 'string', required: true, max: 60, unique: true },
        code: { type: 'code', required: true, max: 3, unique: true, label: 'Short code' },
        country: { type: 'string', max: 40, default: 'Australia' },
        active: { type: 'bool', default: true },
      },
      inUse(p) {
        const c = db().cities.filter((x) => x.provinceId === p.id).length;
        const d = db().dealers.filter((x) => x.provinceId === p.id).length;
        return c || d ? `${p.name} has ${c} city(ies) and ${d} dealer(s)` : null;
      },
    },
    cities: {
      label: 'City',
      key: 'id',
      autoKey: 'CTY',
      list: () => db().cities,
      search: ['id', 'name'],
      fields: {
        name: { type: 'string', required: true, max: 60 },
        provinceId: { type: 'ref', ref: 'provinces', required: true, label: 'State' },
        active: { type: 'bool', default: true },
      },
      check(r, self) {
        const dup = db().cities.find((c) => c !== self && c.provinceId === r.provinceId && c.name.toLowerCase() === r.name.toLowerCase());
        if (dup) return `${r.name} already exists in this state`;
      },
      inUse(c) {
        const d = db().dealers.filter((x) => x.cityId === c.id).length;
        const o = db().outlets.filter((x) => x.cityId === c.id).length;
        return d || o ? `${c.name} has ${d} dealer(s) and ${o} outlet(s)` : null;
      },
    },
    dealers: {
      label: 'Dealer',
      key: 'id',
      autoKey: 'DLR',
      list: () => db().dealers,
      search: ['id', 'name', 'code', 'abn', 'contactPerson', 'phone'],
      fields: {
        name: { type: 'string', required: true, max: 100, unique: true },
        code: { type: 'code', required: true, max: 12, unique: true, label: 'Dealer code' },
        abn: { type: 'abn', unique: true, label: 'ABN' },
        provinceId: { type: 'ref', ref: 'provinces', required: true, label: 'State' },
        cityId: { type: 'ref', ref: 'cities', required: true, label: 'City' },
        address: { type: 'string', max: 300 },
        contactPerson: { type: 'string', max: 80, label: 'Contact person' },
        phone: { type: 'phone' },
        email: { type: 'email' },
        active: { type: 'bool', default: true },
      },
      check(r) {
        const city = db().cities.find((c) => c.id === r.cityId);
        if (city && city.provinceId !== r.provinceId) return `${city.name} is not in the selected state`;
      },
      inUse(d) {
        const n = db().outlets.filter((o) => o.dealerId === d.id).length;
        return n ? `${d.name} has ${n} outlet(s)` : null;
      },
    },
    outlets: {
      label: 'Outlet',
      key: 'id',
      autoKey: 'OUT',
      list: () => db().outlets,
      search: ['id', 'name', 'code', 'type', 'phone'],
      fields: {
        name: { type: 'string', required: true, max: 100 },
        code: { type: 'code', required: true, max: 16, unique: true, label: 'Outlet code' },
        dealerId: { type: 'ref', ref: 'dealers', required: true, label: 'Dealer' },
        type: { type: 'enum', values: OUTLET_TYPES, required: true },
        cityId: { type: 'ref', ref: 'cities', required: true, label: 'City' },
        address: { type: 'string', max: 300 },
        phone: { type: 'phone' },
        bays: { type: 'int', min: 0, max: 200, default: 0, label: 'Service bays' },
        active: { type: 'bool', default: true },
      },
      check(r, self) {
        const dup = db().outlets.find((o) => o !== self && o.dealerId === r.dealerId && o.name.toLowerCase() === r.name.toLowerCase());
        if (dup) return `${r.name} already exists for this dealer`;
        const dealer = db().dealers.find((x) => x.id === r.dealerId);
        if (dealer && dealer.active === false) return `${dealer.name} is inactive`;
      },
      inUse: () => null,
    },
    insurers: {
      label: 'Insurance company',
      key: 'id',
      autoKey: 'INS',
      list: () => db().insurers,
      search: ['id', 'name', 'code', 'contactPerson', 'phone', 'email'],
      fields: {
        name: { type: 'string', required: true, max: 80, unique: true },
        code: { type: 'code', required: true, max: 12, unique: true, label: 'Short code' },
        contactPerson: { type: 'string', max: 80, label: 'Contact person' },
        phone: { type: 'phone' },
        email: { type: 'email' },
        address: { type: 'string', max: 300 },
        abn: { type: 'abn', label: 'ABN' },
        cashless: { type: 'bool', default: true, label: 'Pays repairer directly' },
        active: { type: 'bool', default: true },
      },
      inUse(ins) {
        const n = db().vehicles.filter((v) => v.insurance?.company === ins.name).length;
        return n ? `${n} vehicle(s) are insured with ${ins.name}` : null;
      },
      onRename(old, now) {
        db().vehicles.forEach((v) => { if (v.insurance?.company === old.name) v.insurance.company = now.name; });
      },
    },
  };
}

/** Validation engine for the masters – also used by CSV import on a working copy of the data. */
function engine({ getDb, bad, notFound, conflict }) {
  const S = schemas(getDb);
  const db = () => getDb();
  const def = (type) => {
    const d = S[type];
    if (!d) throw notFound('Master');
    return d;
  };
  const findRec = (d, key) => d.list().find((r) => String(r[d.key]).toLowerCase() === String(key).toLowerCase());

  function coerce(d, name, f, raw, existing) {
    const label = f.label || name[0].toUpperCase() + name.slice(1);
    const empty = raw === undefined || raw === null || raw === '';
    if (f.type === 'bool') return raw === undefined ? undefined : !!raw && raw !== 'false';
    if (empty) {
      if (f.required) throw bad(`${label} is required`, { field: name });
      return f.type === 'number' || f.type === 'int' ? 0 : f.type === 'list' ? [] : '';
    }
    let v = typeof raw === 'string' ? raw.trim() : raw;
    switch (f.type) {
      case 'string':
        v = String(v).slice(0, f.max || 200);
        break;
      case 'code':
        v = String(v).toUpperCase();
        if (!/^[A-Z0-9][A-Z0-9\-_/.]*$/.test(v)) throw bad(`${label} can only contain letters, numbers and - _ / .`, { field: name });
        if (v.length > (f.max || 30)) throw bad(`${label} is too long`, { field: name });
        break;
      case 'enum':
        if (f.number) v = Number(v);
        if (!f.values.includes(v)) throw bad(`${label} must be one of: ${f.values.join(', ')}`, { field: name });
        break;
      case 'number':
      case 'int': {
        const n = Number(v);
        if (!Number.isFinite(n) || (f.type === 'int' && !Number.isInteger(n))) throw bad(`${label} must be a ${f.type === 'int' ? 'whole ' : ''}number`, { field: name });
        if (f.min != null && n < f.min) throw bad(`${label} must be at least ${f.min}`, { field: name });
        if (f.max != null && n > f.max) throw bad(`${label} must be at most ${f.max}`, { field: name });
        v = Math.round(n * 100) / 100;
        break;
      }
      case 'date': {
        const dt = new Date(v);
        if (isNaN(dt)) throw bad(`${label} is not a valid date`, { field: name });
        v = dt.toISOString();
        break;
      }
      case 'partlist': {
        const arr = Array.isArray(v) ? v : [];
        const out = [];
        for (const it of arr) {
          const no = String(Array.isArray(it) ? it[0] : it.partNo || '').trim().toUpperCase();
          const qty = Number(Array.isArray(it) ? it[1] : it.qty);
          if (!no) continue;
          const part = db().catalog.parts.find((x) => x.no.toUpperCase() === no);
          if (!part) throw bad(`Part ${no} does not exist`, { field: name });
          if (part.active === false && !(existing && (existing[name] || []).some((x) => x[0] === part.no))) throw bad(`Part ${no} is inactive`, { field: name });
          if (!(qty > 0)) throw bad(`Quantity for ${no} must be more than 0`, { field: name });
          if (out.some((x) => x[0] === part.no)) throw bad(`${no} is listed twice`, { field: name });
          out.push([part.no, Math.round(qty * 1000) / 1000]);
        }
        v = out;
        break;
      }
      case 'slug':
        v = String(v).toLowerCase();
        if (!/^[a-z][a-z0-9_.-]*$/.test(v)) throw bad(`${label} can only contain lowercase letters, numbers and . _ - (e.g. jobs.view)`, { field: name });
        if (v.length > (f.max || 40)) throw bad(`${label} is too long`, { field: name });
        break;
      case 'list': {
        const arr = Array.isArray(v) ? v : String(v).split(',');
        const had = new Set((existing && existing[name]) || []);
        const out = [];
        for (const raw of arr) {
          const c = String(raw).trim();
          if (!c) continue;
          const target = findRec(S[f.ref], c);
          if (!target) throw bad(`${label}: ${c} does not exist`, { field: name });
          if (target.active === false && !had.has(target[S[f.ref].key])) throw bad(`${label}: ${target.name || c} is inactive`, { field: name });
          if (!out.includes(target[S[f.ref].key])) out.push(target[S[f.ref].key]);
        }
        v = out;
        break;
      }
      case 'phone':
        v = au.normPhone(v);
        if (!v) throw bad(`${label} is not a valid Australian phone number (e.g. 0412 345 678 or 02 9748 1100)`, { field: name });
        break;
      case 'abn':
        if (!au.validAbn(v)) throw bad(`${label} is not a valid ABN (11 digits, failed the ATO check)`, { field: name });
        v = au.formatAbn(v);
        break;
      case 'email':
        v = String(v).toLowerCase();
        if (!/^\S+@\S+\.\S+$/.test(v)) throw bad(`${label} is not a valid email`, { field: name });
        break;
      case 'ref':
        v = f.by ? String(v) : String(v).toUpperCase();
        {
          const target = f.by ? S[f.ref].list().find((r) => String(r[f.by]).toLowerCase() === v.toLowerCase()) : findRec(S[f.ref], v);
          if (!target) throw bad(`${label}: ${v} does not exist`, { field: name });
          if (target.active === false && !(existing && String(existing[name]).toUpperCase() === v)) throw bad(`${label}: ${target.name || target.description || v} is inactive`, { field: name });
          v = target[f.by || S[f.ref].key];
        }
        break;
    }
    if (f.pattern && v && !f.pattern.test(v)) throw bad(f.patternMsg || `${label} is not valid`, { field: name });
    return v;
  }

  function validate(d, body, existing) {
    const out = {};
    for (const [name, f] of Object.entries(d.fields)) {
      if (existing && name === d.key) continue; // keys are immutable
      if (f.readonly) { if (!existing) out[name] = f.default ?? 0; continue; } // maintained by the app (e.g. stock)
      if (existing && !(name in body)) continue; // PATCH: only given fields
      let v = coerce(d, name, f, body[name], existing);
      if (v === undefined) v = existing ? undefined : f.default ?? (f.type === 'bool' ? false : v);
      if (v === undefined) continue;
      if (!existing && v === '' && f.default !== undefined) v = f.default;
      out[name] = v;
    }
    // uniqueness (case-insensitive)
    const keyVal = existing ? existing[d.key] : out[d.key];
    for (const [name, f] of Object.entries(d.fields)) {
      if (!f.unique && name !== d.key) continue;
      const v = out[name];
      if (!v) continue;
      const dup = d.list().find((r) => r !== existing && String(r[name] || '').toLowerCase() === String(v).toLowerCase());
      if (dup) throw conflict(`${f.label || name[0].toUpperCase() + name.slice(1)} "${v}" already exists`);
    }
    if (d.fields.supersededBy && (out.supersededBy === keyVal || out.alternateFor === keyVal) && keyVal) throw bad('A part cannot supersede or replace itself');
    if (d.check) {
      const problem = d.check(Object.assign({}, existing || {}, out), existing);
      if (problem) throw bad(problem);
    }
    return out;
  }

  function nextKey(d) {
    const n = d.list().reduce((m, r) => Math.max(m, Number(String(r[d.key]).replace(/\D/g, '')) || 0), 0) + 1;
    return d.autoKey + String(n).padStart(3, '0');
  }
  /** Validate and add a record (used by import). */
  function create(type, body) {
    const d = def(type);
    const rec = validate(d, body || {}, null);
    if (d.autoKey) rec[d.key] = nextKey(d);
    d.list().push(Object.assign({ [d.key]: rec[d.key] }, rec));
    return rec;
  }
  return { S, def, findRec, coerce, validate, nextKey, create };
}

module.exports = function registerMasters({ route, getDb, save, bad, notFound, conflict, log }) {
  const { S, def, findRec, validate, nextKey } = engine({ getDb, bad, notFound, conflict });

  const decorate = (type, d, r) => {
    const extra = { inUse: d.inUse(r) };
    if (type === 'parts') extra.lowStock = r.active !== false && r.stock <= (r.reorderLevel || 0);
    // readable names for linked records, e.g. cityId → cityIdName
    for (const [n, f] of Object.entries(d.fields)) {
      if (f.type !== 'ref' || f.by || !r[n]) continue;
      const t = findRec(S[f.ref], r[n]);
      extra[n + 'Name'] = t ? t.name || t.description || r[n] : r[n];
    }
    if (type === 'provinces') extra.cityCount = getDb().cities.filter((c) => c.provinceId === r.id).length;
    if (type === 'dealers') extra.outletCount = getDb().outlets.filter((o) => o.dealerId === r.id).length;
    if (type === 'roles') {
      extra.userCount = getDb().users.filter((u) => u.role === r.name).length;
      extra.rightCount = r.system ? getDb().rights.filter((x) => x.active !== false).length : (r.rights || []).length;
    }
    if (type === 'rights') extra.roleCount = getDb().roles.filter((x) => x.system || (x.rights || []).includes(r.code)).length;
    const out = Object.assign({}, r, extra);
    if (type === 'users') { for (const k of ['passwordHash', 'failedLogins', 'lockedUntil', 'sessionVersion']) delete out[k]; out.hasPassword = !!r.passwordHash; }
    return out;
  };

  route('GET', '/api/masters', () =>
    Object.fromEntries(Object.entries(S).map(([k, d]) => [k, { label: d.label, key: d.key, count: d.list().length, active: d.list().filter((r) => r.active !== false).length, fields: Object.fromEntries(Object.entries(d.fields).map(([n, f]) => [n, { type: f.type, required: !!f.required, values: f.values, label: f.label, ref: f.ref, default: f.default }])) }]))
  );

  route('GET', '/api/masters/:type', (req, q, p) => {
    const d = def(p.type);
    const term = String(q.get('q') || '').toLowerCase().trim();
    const active = q.get('active');
    return d.list()
      .filter((r) => active == null || active === '' || String(r.active !== false) === active)
      .filter((r) => !term || d.search.some((k) => String(r[k] ?? '').toLowerCase().includes(term)))
      .map((r) => decorate(p.type, d, r));
  });

  route('GET', '/api/masters/:type/:key', (req, q, p) => {
    const d = def(p.type);
    const r = findRec(d, p.key);
    if (!r) throw notFound(d.label);
    return decorate(p.type, d, r);
  });

  route('POST', '/api/masters/:type', (req, q, p, body) => {
    const d = def(p.type);
    const rec = validate(d, body || {}, null);
    if (d.autoKey) rec[d.key] = nextKey(d);
    const ordered = Object.assign({ [d.key]: rec[d.key] }, rec);
    d.list().push(ordered);
    log(`${d.label} created: ${ordered[d.key]}`);
    save();
    return decorate(p.type, d, ordered);
  });

  route('PATCH', '/api/masters/:type/:key', (req, q, p, body) => {
    const d = def(p.type);
    const r = findRec(d, p.key);
    if (!r) throw notFound(d.label);
    const changes = validate(d, body || {}, r);
    if (r.system && p.type === 'roles') delete changes.rights; // the administrator always has every right
    if (changes.active === false && r.active !== false && p.type === 'users') {
      const why = d.inUse(r);
      if (why) throw conflict(`Cannot deactivate: ${why}. Reassign the work first.`);
    }
    const before = Object.assign({}, r);
    Object.assign(r, changes);
    if (d.onRename && changes.name && changes.name !== before.name) d.onRename(before, r);
    log(`${d.label} updated: ${r[d.key]}`);
    save();
    return decorate(p.type, d, r);
  });

  route('DELETE', '/api/masters/:type/:key', (req, q, p) => {
    const d = def(p.type);
    const r = findRec(d, p.key);
    if (!r) throw notFound(d.label);
    const why = d.inUse(r);
    if (why) throw conflict(`Cannot delete: ${why}. Deactivate it instead.`);
    const list = d.list();
    list.splice(list.indexOf(r), 1);
    log(`${d.label} deleted: ${r[d.key]}`);
    save();
    return { deleted: r[d.key] };
  });

  return S;
};

// Fill in fields added after a database was first created.
module.exports.engine = engine;

module.exports.migrate = function migrate(db, seedDb) {
  let changed = false;
  for (const k of ['insurers', 'provinces', 'cities', 'dealers', 'outlets']) {
    if (!Array.isArray(db[k])) { db[k] = seedDb[k]; changed = true; }
  }
  const seedUsers = Object.fromEntries(seedDb.users.map((u) => [u.name, u]));
  db.users = db.users.map((u) => {
    if (u.phone !== undefined && u.active !== undefined) return u;
    changed = true;
    return Object.assign({ phone: '', email: '', active: true }, seedUsers[u.name] || {}, u, { id: seedUsers[u.name]?.id || u.id });
  });
  for (const t of seedDb.users) if (!db.users.some((u) => u.name === t.name)) { db.users.push(t); changed = true; }
  db.catalog.parts.forEach((p) => {
    if (p.active === undefined) { Object.assign(p, Object.assign({ gstPct: 10, reorderLevel: 2, active: true }, p)); changed = true; }
  });
  db.catalog.labour.forEach((l) => {
    if (l.active === undefined) { Object.assign(l, Object.assign({ gstPct: 10, active: true }, l)); changed = true; }
  });
  if (db.lookups && db.lookups.technicians) { delete db.lookups.technicians; changed = true; }
  // roles & rights
  if (!Array.isArray(db.rights)) { db.rights = seedDb.rights; changed = true; }
  if (!Array.isArray(db.roles)) { db.roles = seedDb.roles; changed = true; }
  for (const r of seedDb.rights) {
    if (db.rights.some((x) => x.code === r.code)) continue;
    // a right added in a newer version: give it to the default roles that have it out of the box
    db.rights.push(r);
    for (const sr of seedDb.roles.filter((x) => (x.rights || []).includes(r.code))) {
      const mine = db.roles.find((x) => x.id === sr.id && x.name === sr.name);
      if (mine && !mine.rights.includes(r.code)) mine.rights.push(r.code);
    }
    changed = true;
  }
  for (const u of db.users) {
    if (u.role && !db.roles.some((r) => r.name === u.role)) {
      const n = db.roles.reduce((m, r) => Math.max(m, Number(String(r.id).replace(/\D/g, '')) || 0), 0) + 1;
      db.roles.push({ id: 'R' + String(n).padStart(3, '0'), name: u.role, description: '', rights: [], system: false, active: true });
      changed = true;
    }
  }
  if (!db.users.some((u) => access.isAdminUser(db, u))) {
    const admin = seedDb.users.find((u) => access.isAdminUser(seedDb, u));
    if (admin) {
      const taken = db.users.some((u) => u.id === admin.id);
      db.users.push(Object.assign({}, admin, taken ? { id: 'U' + String(900 + db.users.length) } : {}));
      changed = true;
    }
  }
  // service setup masters (were fixed lists)
  const mk = (prefix, names, extra = () => ({})) => names.map((n, i) => Object.assign({ id: prefix + String(i + 1).padStart(3, '0'), name: n }, extra(n, i), { active: true }));
  if (!Array.isArray(db.repairTypes)) {
    const codes = { 'Periodic service': 'PMS', 'Paid service': 'PAID', 'Free service': 'FREE', Warranty: 'WTY', 'Running repair': 'RR', 'Accident repair': 'ACC', PDI: 'PDI' };
    const desc = { 'Periodic service': 'Scheduled maintenance as per the service schedule', 'Paid service': 'Customer-paid service outside the free schedule', 'Free service': 'Free services covered by the manufacturer', Warranty: 'Repairs claimed under manufacturer warranty', 'Running repair': 'Breakdowns and general repairs', 'Accident repair': 'Body and mechanical repairs after an accident, often with an insurance claim', PDI: 'Pre-delivery inspection of new vehicles' };
    const names = [...new Set([...(db.lookups?.jobTypes || []), ...db.jobcards.map((j) => j.jobType).filter(Boolean)])];
    db.repairTypes = mk('RT', names, (n, i) => ({ code: codes[n] || 'RT' + (i + 1), description: desc[n] || '' }));
    changed = true;
  }
  if (!Array.isArray(db.fuelTypes)) { db.fuelTypes = mk('FT', [...new Set(['Diesel', 'Unleaded 91', 'Premium unleaded 95/98', 'E10', 'LPG', 'Hybrid', 'Electric', ...db.vehicles.map((v) => v.fuel).filter(Boolean)])]); changed = true; }
  if (!Array.isArray(db.transmissions)) {
    const d = { Manual: 'Manual gearbox with clutch pedal', Automatic: 'Torque-converter automatic', AMT: 'Automated manual transmission', CVT: 'Continuously variable transmission' };
    db.transmissions = mk('TT', [...new Set(['Manual', 'Automatic', 'AMT', 'CVT', ...db.vehicles.map((v) => v.transmission).filter(Boolean)])], (n) => ({ description: d[n] || '' }));
    changed = true;
  }
  if (!Array.isArray(db.suppliers)) {
    db.suppliers = [
      { id: 'SUP001', name: 'Isuzu Australia Parts', abn: '33 104 727 643', contactPerson: 'Dealer parts desk', phone: '1300176123', email: 'parts@isuzu-au.example', address: '858 Lorimer Street, Port Melbourne VIC 3207', accountNo: 'HCI-0042', paymentTermsDays: 30, active: true },
      { id: 'SUP002', name: 'Repco Trade', abn: '33 100 863 171', contactPerson: 'Trade counter', phone: '0297481300', email: 'trade.auburn@repco.example', address: '45 Silverwater Road, Auburn NSW 2144', accountNo: 'T778120', paymentTermsDays: 30, active: true },
      { id: 'SUP003', name: 'Burson Auto Parts', abn: '33 102 407 376', contactPerson: 'Parramatta store', phone: '0296351400', email: 'parramatta@burson.example', address: '2 Victoria Road, Parramatta NSW 2150', accountNo: 'B55120', paymentTermsDays: 14, active: true },
    ];
    changed = true;
  }
  if (!Array.isArray(db.appointments)) {
    // a couple of sample bookings so the diary is not empty
    const at = (days, h) => { const x = new Date(); x.setDate(x.getDate() + days); x.setHours(h, 0, 0, 0); return x.toISOString(); };
    const v = db.vehicles.find((x) => x.vin === 'M3GTGS664J8AC1419');
    db.appointments = v ? [
      { id: 'APT-000001', at: at(1, 8), durationMin: 120, vin: v.vin, rego: v.reg, vehicle: v.model + ' ' + v.variant, customerName: v.owner.name, phone: v.owner.phone, email: v.owner.email, repairType: 'Periodic service', notes: '30,000 km logbook service + check tray lights', advisor: 'Arun Kumar', status: 'booked', jobId: null, reminderSentAt: null, by: 'Arun Kumar', createdAt: new Date().toISOString() },
      { id: 'APT-000002', at: at(2, 10), durationMin: 60, vin: '', rego: 'CXL22B', vehicle: 'MU-X LS-M', customerName: 'Hannah Lee', phone: '0411555220', email: 'hannah.lee@example.com', repairType: 'Running repair', notes: 'New customer – A/C blowing warm', advisor: 'Arun Kumar', status: 'booked', jobId: null, reminderSentAt: null, by: 'Arun Kumar', createdAt: new Date().toISOString() },
    ] : [];
    db.meta.nextAppt = 3;
    changed = true;
  }
  if (db.workshop && !db.workshop.defaultOutletId && (db.outlets || [])[0]) { db.workshop.defaultOutletId = db.outlets[0].id; changed = true; }
  for (const j of db.jobcards) if (!j.outletId && db.workshop && db.workshop.defaultOutletId) { j.outletId = db.workshop.defaultOutletId; changed = true; }
  for (const a of db.appointments || []) if (!a.outletId && db.workshop && db.workshop.defaultOutletId) { a.outletId = db.workshop.defaultOutletId; changed = true; }
  if (db.workshop && db.workshop.serviceIntervalMonths == null) { db.workshop.serviceIntervalMonths = 12; db.workshop.serviceIntervalKm = 15000; changed = true; }
  if (require('./stock').migrate(db)) changed = true;
  if (require('./billing').migrate(db)) changed = true;
  db.audit = db.audit || [];
  return changed;
};
