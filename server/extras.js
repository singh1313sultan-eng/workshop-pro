// Attachments (photos / documents), editable dropdown lists, CSV import, backup & restore, audit log.
//
// Files: Supabase Storage bucket "attachments" (private) when SUPABASE_URL + key are set, otherwise data/files/.
//   db.attachments [{ id, jobId, vin, name, type, size, path, caption, at, by }]

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const au = require('./au');

const MAX_BYTES = 8 * 1024 * 1024;
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'application/pdf': 'pdf' };
const LISTS = {
  bays: 'Workshop bays', drivenBy: 'Driven in by', delayReasons: 'Delay reasons', declineReasons: 'Decline reasons',
  replaceReasons: 'Part replacement reasons', serviceVans: 'Courtesy / service vans', feedbackQuestions: 'Feedback questions',
};

/* ---------- file storage ---------- */
function fileStore(dataDir) {
  const url = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY && process.env.STORAGE !== 'file' ? process.env.SUPABASE_URL.replace(/\/+$/, '') : null;
  const key = process.env.SUPABASE_SERVICE_KEY;
  const headers = (extra = {}) => Object.assign({ apikey: key }, key && key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}, extra);
  let bucketReady = false;
  async function ensureBucket() {
    if (bucketReady || !url) return;
    const r = await fetch(`${url}/storage/v1/bucket`, { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ id: 'attachments', name: 'attachments', public: false, file_size_limit: MAX_BYTES }) });
    if (!r.ok && r.status !== 409 && r.status !== 400) throw new Error(`Could not prepare file storage (${r.status})`);
    bucketReady = true;
  }
  return {
    kind: url ? 'supabase' : 'file',
    async put(p, buf, type) {
      if (!url) { const f = path.join(dataDir, 'files', p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf); return; }
      await ensureBucket();
      const r = await fetch(`${url}/storage/v1/object/attachments/${p}`, { method: 'POST', headers: headers({ 'Content-Type': type, 'x-upsert': 'true' }), body: buf });
      if (!r.ok) throw new Error(`Upload failed (${r.status} ${(await r.text()).slice(0, 120)})`);
    },
    async get(p) {
      if (!url) { const f = path.join(dataDir, 'files', p); return fs.existsSync(f) ? fs.readFileSync(f) : null; }
      const r = await fetch(`${url}/storage/v1/object/attachments/${p}`, { headers: headers() });
      return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
    },
    async del(p) {
      if (!url) { const f = path.join(dataDir, 'files', p); if (fs.existsSync(f)) fs.unlinkSync(f); return; }
      await fetch(`${url}/storage/v1/object/attachments`, { method: 'DELETE', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ prefixes: [p] }) });
    },
  };
}

function register(ctx) {
  const { route, getDb, setDb, save, bad, notFound, conflict, str, num, findJob, vehicle, log, actorName, audit, dataDir, registration, stock, migrate, seed, HttpError } = ctx;
  const db = () => { const d = getDb(); d.attachments = d.attachments || []; return d; };
  const files = fileStore(dataDir);

  /* ---------- attachments ---------- */
  route('GET', '/api/jobcards/:id/attachments', (req, q, p) => db().attachments.filter((a) => a.jobId === findJob(p.id).id));
  route('POST', '/api/jobcards/:id/attachments', async (req, q, p, body) => {
    const d = db();
    const j = findJob(p.id);
    const type = str(body.type);
    if (!TYPES[type]) throw bad('Only photos (JPG, PNG, WebP, HEIC) and PDF files can be attached', { field: 'type' });
    const m = String(body.data || '').match(/^data:[^;]+;base64,(.+)$/);
    const buf = Buffer.from(m ? m[1] : String(body.data || ''), 'base64');
    if (!buf.length) throw bad('The file is empty');
    if (buf.length > MAX_BYTES) throw bad('Files must be 8 MB or smaller');
    const id = 'ATT-' + crypto.randomBytes(6).toString('hex');
    const name = (str(body.name, 120) || `${id}.${TYPES[type]}`).replace(/[^\w .()-]/g, '_');
    const p2 = `${j.id}/${id}.${TYPES[type]}`;
    await files.put(p2, buf, type);
    const a = { id, jobId: j.id, vin: j.vin, name, type, size: buf.length, path: p2, caption: str(body.caption, 200), category: str(body.category, 40) || (type === 'application/pdf' ? 'Document' : 'Photo'), at: new Date().toISOString(), by: actorName() };
    d.attachments.unshift(a);
    log(j, `${a.category} attached: ${a.name}${a.caption ? ' – ' + a.caption : ''}`);
    save();
    return a;
  });
  route('GET', '/api/attachments/:id/file', async (req, q, p) => {
    const a = db().attachments.find((x) => x.id === p.id);
    if (!a) throw notFound('Attachment');
    const buf = await files.get(a.path);
    if (!buf) throw notFound('File');
    return { __file: true, type: a.type, name: a.name, body: buf, inline: true };
  });
  route('DELETE', '/api/attachments/:id', async (req, q, p) => {
    const d = db();
    const a = d.attachments.find((x) => x.id === p.id);
    if (!a) throw notFound('Attachment');
    const j = d.jobcards.find((x) => x.id === a.jobId);
    if (j && j.status === 'closed') throw conflict('The job card is closed – attachments are kept as a record');
    await files.del(a.path);
    d.attachments = d.attachments.filter((x) => x !== a);
    if (j) log(j, `Attachment removed: ${a.name}`);
    save();
    return { deleted: a.id };
  });

  /* ---------- editable dropdown lists ---------- */
  route('GET', '/api/settings/lists', () => Object.entries(LISTS).map(([key, label]) => ({ key, label, values: db().lookups[key] || [] })));
  route('PUT', '/api/settings/lists/:key', (req, q, p, body) => {
    const d = db();
    if (!LISTS[p.key]) throw notFound('List');
    const values = (Array.isArray(body.values) ? body.values : []).map((v) => str(v, 160)).filter(Boolean);
    const uniq = [...new Set(values.map((v) => v.toLowerCase()))];
    if (uniq.length !== values.length) throw bad('The list has duplicates');
    if (!values.length) throw bad('A list needs at least one entry');
    if (p.key === 'feedbackQuestions' && values.length !== (d.lookups.feedbackQuestions || []).length && d.jobcards.some((j) => j.feedback)) {
      // scores are stored by position – adding/removing questions would mix up old answers
      throw conflict('Feedback has already been recorded against these questions. You can reword them, but not add or remove questions.');
    }
    if (p.key === 'bays') {
      const used = d.jobcards.filter((j) => j.status !== 'closed' && j.bay && !values.includes(j.bay)).map((j) => `${j.bay} (${j.id})`);
      if (used.length) throw conflict(`Still in use by open job cards: ${used.join(', ')}`);
    }
    d.lookups[p.key] = values;
    audit(`List “${LISTS[p.key]}” updated (${values.length} entries)`);
    save();
    return { key: p.key, label: LISTS[p.key], values };
  });

  /* ---------- CSV import (rows already parsed by the browser) ---------- */
  const IMPORTS = {
    'customers-vehicles': { label: 'Customers & vehicles', columns: ['rego', 'regState', 'vin', 'model', 'variant', 'colour', 'fuel', 'transmission', 'engine', 'deliveryDate', 'customerName', 'mobile', 'email', 'address', 'abn', 'customerType'] },
    parts: { label: 'Parts (with opening stock)', columns: ['partNo', 'description', 'category', 'brand', 'source', 'unit', 'sellPrice', 'gstPct', 'reorderLevel', 'openingQty', 'unitCost'] },
    labour: { label: 'Labour operations', columns: ['code', 'group', 'description', 'minutes', 'price', 'gstPct'] },
  };
  route('GET', '/api/import/templates', () => Object.entries(IMPORTS).map(([key, x]) => ({ key, label: x.label, columns: x.columns })));
  route('POST', '/api/import/:kind', (req, q, p, body) => {
    const d = db();
    const kind = p.kind;
    if (!IMPORTS[kind]) throw notFound('Import type');
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length) throw bad('The file has no rows');
    if (rows.length > 5000) throw bad('Import at most 5,000 rows at a time');
    const commit = body.commit === true;
    const results = [];
    // work on a copy so a dry run (or a failed commit) changes nothing
    const work = structuredClone(d);
    const S = ctx.masterSchemas(() => work);
    const add = (type, rec) => ctx.createMaster(S, type, rec);
    rows.forEach((r, i) => {
      const line = i + 2; // header is line 1
      try {
        if (kind === 'parts') {
          const no = str(r.partNo, 30).toUpperCase();
          const existing = work.catalog.parts.find((x) => x.no === no);
          if (existing) throw new Error(`part ${no} already exists`);
          add('parts', { no, description: r.description, category: r.category || 'General', brand: r.brand || 'Isuzu', source: r.source || 'OEM', unit: (r.unit || 'EA').toUpperCase(), mrp: r.sellPrice, gstPct: r.gstPct === '' || r.gstPct == null ? 10 : Number(r.gstPct), reorderLevel: r.reorderLevel || 0 });
          const qty = Number(r.openingQty || 0);
          if (qty > 0) {
            const cost = Number(r.unitCost);
            if (!(cost >= 0) || r.unitCost === '' || r.unitCost == null) throw new Error('unitCost is needed when openingQty is given');
            stock.ensure(work);
            work.stockBatches.push({ id: 'B' + String(work.meta.nextBatch++).padStart(6, '0'), partNo: no, inwardId: null, receivedAt: new Date().toISOString(), qty, remaining: qty, unitCost: au.round2(cost), taxPct: 10, supplier: 'Opening stock (import)' });
            stock.syncPartStock(work, no);
          }
          results.push({ line, ok: true, key: no });
        } else if (kind === 'labour') {
          const code = str(r.code, 20).toUpperCase();
          if (work.catalog.labour.find((x) => x.code === code)) throw new Error(`operation ${code} already exists`);
          add('labour', { code, group: r.group || 'General', description: r.description, minutes: r.minutes, rate: r.price, gstPct: r.gstPct === '' || r.gstPct == null ? 10 : Number(r.gstPct) });
          results.push({ line, ok: true, key: code });
        } else {
          const phone = au.normPhone(r.mobile);
          const known = phone && registration.customers(work).find((c) => au.normPhone(c.phone) === phone);
          const reg = registration.buildRegistration(work, { vin: r.vin, reg: r.rego, regState: r.regState, model: r.model, variant: r.variant, color: r.colour, fuel: r.fuel || undefined, transmission: r.transmission || undefined, engine: r.engine, saleDate: r.deliveryDate || '' },
            known ? { customerId: known.customerId } : { name: r.customerName, phone: r.mobile, email: r.email, address: r.address, abn: r.abn, type: r.customerType || (r.abn ? 'Commercial' : 'Private'), entity: r.abn ? 'Company' : 'Individual', allowDuplicatePhone: true }, { bad: (m) => new Error(m), conflict: (m) => new Error(m), str });
          work.vehicles.push(reg.vehicle);
          results.push({ line, ok: true, key: reg.vehicle.reg, note: known ? `added to existing customer ${known.customerId}` : `new customer ${reg.customer.customerId}` });
        }
      } catch (e) { results.push({ line, ok: false, error: e.message }); }
    });
    const failed = results.filter((x) => !x.ok).length;
    if (commit) {
      if (failed) throw bad(`Fix the ${failed} row(s) with errors first – nothing was imported`, { results });
      setDb(work);
      audit(`Imported ${results.length} ${IMPORTS[kind].label.toLowerCase()}`);
      save();
    }
    return { kind, committed: commit, total: results.length, ok: results.length - failed, failed, results };
  });

  /* ---------- backup & restore ---------- */
  route('GET', '/api/admin/backup', () => {
    const d = db();
    const body = JSON.stringify({ format: 'workshop-pro-backup', version: 1, createdAt: new Date().toISOString(), workshop: d.workshop.name, data: d }, null, 1);
    return { __file: true, type: 'application/json', name: `workshop-pro-backup-${new Date().toISOString().slice(0, 10)}.json`, body };
  });
  route('POST', '/api/admin/restore', (req, q, p, body) => {
    if (!body || body.format !== 'workshop-pro-backup' || !body.data) throw bad('This is not a Workshop Pro backup file');
    const data = body.data;
    for (const k of ['meta', 'workshop', 'users', 'catalog', 'vehicles', 'jobcards']) if (!data[k]) throw bad(`The backup is missing “${k}”`);
    if (str(body.confirm) !== 'RESTORE') throw bad('Type RESTORE to confirm – everything will be replaced by the backup', { field: 'confirm' });
    migrate(data, seed());
    setDb(data);
    audit(`Restored backup from ${body.createdAt || 'unknown date'}`);
    save();
    return { ok: true, restoredFrom: body.createdAt, jobs: data.jobcards.length, vehicles: data.vehicles.length };
  });

  /* ---------- audit log ---------- */
  route('GET', '/api/audit', (req, q) => {
    const term = str(q.get('q')).toLowerCase();
    return (getDb().audit || []).filter((a) => !term || `${a.text} ${a.by}`.toLowerCase().includes(term)).slice(0, 500);
  });

  return { files };
}

module.exports = { register, LISTS, TYPES, MAX_BYTES };
