// Parts inventory: stock inward (goods receipt) creates batches; parts are issued to
// job cards FIFO – oldest batch first – and returns go back to the batches they came from.
//
//   db.stockInwards  [{ id, at, supplier, invoiceNo, invoiceDate, by, remarks, total }]
//   db.stockBatches  [{ id, partNo, inwardId, receivedAt, qty, remaining, unitCost, supplier }]
//   db.stockIssues   [{ id, at, kind: 'issue'|'return', jobId, lineId, partNo, qty, cost, by, reason, allocations: [{ batchId, qty, unitCost }] }]
//   db.stockAdjustments [{ id, at, type: 'count'|'writeoff', reason, remarks, by, value, lines: [{ partNo, systemQty, countedQty, qty, value, allocations }] }]
//     – decreases take stock FIFO (oldest batch first); increases add a batch at the latest cost
//
// part.stock is kept equal to the sum of its batches' remaining quantity.
// Job card part lines carry issuedQty and issueCost.

const round2 = (n) => Math.round(n * 100) / 100;
const qtyRound = (n) => Math.round(n * 1000) / 1000;

function ensure(db) {
  db.stockInwards = db.stockInwards || [];
  db.stockBatches = db.stockBatches || [];
  db.stockIssues = db.stockIssues || [];
  db.stockAdjustments = db.stockAdjustments || [];
  db.meta.nextAdj = db.meta.nextAdj || db.stockAdjustments.length + 1;
  db.meta.nextGrn = db.meta.nextGrn || db.stockInwards.length + 1;
  db.meta.nextBatch = db.meta.nextBatch || db.stockBatches.length + 1;
  db.meta.nextIssue = db.meta.nextIssue || db.stockIssues.length + 1;
}
const fifo = (a, b) => new Date(a.receivedAt) - new Date(b.receivedAt) || (a.id > b.id ? 1 : -1);
const batchesOf = (db, partNo) => db.stockBatches.filter((b) => b.partNo === partNo).sort(fifo);
function syncPartStock(db, partNo) {
  const p = db.catalog.parts.find((x) => x.no === partNo);
  if (p) p.stock = qtyRound(batchesOf(db, partNo).reduce((s, b) => s + b.remaining, 0));
}
const newBatchId = (db) => 'B' + String(db.meta.nextBatch++).padStart(6, '0');
const newIssueId = (db) => 'ISS-' + String(db.meta.nextIssue++).padStart(6, '0');

/** Quantity of a part held by reservations on open job cards (optionally ignoring one job). */
function reservedQty(db, partNo, exceptJobId) {
  let n = 0;
  for (const j of db.jobcards) {
    if (j.status === 'closed' || j.id === exceptJobId) continue;
    for (const l of j.lines) if (l.kind === 'part' && l.code === partNo && l.blocked && l.status !== 'declined') n += Math.max(0, l.qty - (l.issuedQty || 0));
  }
  return qtyRound(n);
}

/** Issue `qty` of a job card part line, FIFO. Throws if stock is short. */
function issueLine(db, job, line, qty, by, err) {
  ensure(db);
  if (line.kind !== 'part') throw err.bad('Only part lines can be issued from stock');
  if (line.status !== 'approved') throw err.conflict('Only approved part lines can be issued. Record the customer approval first.');
  const open = qtyRound(line.qty - (line.issuedQty || 0));
  if (open <= 0) throw err.conflict(`${line.description} is already fully issued`);
  const want = qty == null || qty === '' ? open : Number(qty);
  if (!(want > 0)) throw err.bad('Quantity to issue must be more than 0');
  if (want > open + 1e-9) throw err.bad(`Only ${open} still to issue for this line`);
  const batches = batchesOf(db, line.code).filter((b) => b.remaining > 0);
  const onHand = qtyRound(batches.reduce((s, b) => s + b.remaining, 0));
  if (onHand + 1e-9 < want) throw err.conflict(`Not enough stock of ${line.code}: ${onHand} on hand, ${want} needed. Record a stock inward first.`, { partNo: line.code, onHand, needed: want });
  const heldElsewhere = reservedQty(db, line.code, job.id);
  if (onHand - heldElsewhere + 1e-9 < want) throw err.conflict(`Only ${qtyRound(onHand - heldElsewhere)} of ${line.code} is free – ${heldElsewhere} is reserved for other job cards.`, { partNo: line.code, onHand, reserved: heldElsewhere });
  let left = want;
  const allocations = [];
  for (const b of batches) {
    if (left <= 1e-9) break;
    const take = qtyRound(Math.min(b.remaining, left));
    b.remaining = qtyRound(b.remaining - take);
    left = qtyRound(left - take);
    allocations.push({ batchId: b.id, qty: take, unitCost: b.unitCost });
  }
  const cost = round2(allocations.reduce((s, a) => s + a.qty * a.unitCost, 0));
  line.issuedQty = qtyRound((line.issuedQty || 0) + want);
  line.issueCost = round2((line.issueCost || 0) + cost);
  const rec = { id: newIssueId(db), at: new Date().toISOString(), kind: 'issue', jobId: job.id, lineId: line.id, partNo: line.code, qty: want, cost, by, reason: '', allocations };
  db.stockIssues.unshift(rec);
  syncPartStock(db, line.code);
  return rec;
}

/** Return issued quantity of a line to stock – back into the batches it was issued from (newest first). */
function returnLine(db, job, line, qty, reason, by, err) {
  ensure(db);
  const issued = qtyRound(line.issuedQty || 0);
  if (issued <= 0) throw err.conflict(`${line.description} has nothing issued to return`);
  const want = qty == null || qty === '' ? issued : Number(qty);
  if (!(want > 0) || want > issued + 1e-9) throw err.bad(`Return quantity must be between 0 and ${issued}`);
  if (!reason) throw err.bad('A reason is required for a parts return', { field: 'reason' });
  // walk this line's issue allocations newest-first, net of earlier returns
  const net = new Map(); // batchId -> {qty, unitCost}
  const order = [];
  for (const r of [...db.stockIssues].reverse().filter((x) => x.jobId === job.id && x.lineId === line.id)) {
    for (const a of r.allocations) {
      if (!net.has(a.batchId)) { net.set(a.batchId, { qty: 0, unitCost: a.unitCost }); order.push(a.batchId); }
      net.get(a.batchId).qty = qtyRound(net.get(a.batchId).qty + (r.kind === 'issue' ? a.qty : -a.qty));
    }
  }
  let left = want;
  const allocations = [];
  for (const batchId of order.reverse()) {
    if (left <= 1e-9) break;
    const n = net.get(batchId);
    if (n.qty <= 0) continue;
    const back = qtyRound(Math.min(n.qty, left));
    let b = db.stockBatches.find((x) => x.id === batchId);
    if (!b) { // legacy / removed batch: create a returns batch so the stock is not lost
      b = { id: newBatchId(db), partNo: line.code, inwardId: null, receivedAt: new Date().toISOString(), qty: 0, remaining: 0, unitCost: n.unitCost, supplier: 'Returned from job card' };
      db.stockBatches.push(b);
    }
    b.remaining = qtyRound(b.remaining + back);
    if (b.remaining > b.qty) b.qty = b.remaining;
    left = qtyRound(left - back);
    allocations.push({ batchId: b.id, qty: back, unitCost: n.unitCost });
  }
  if (left > 1e-9) {
    // issued before stock tracking existed: put it back as a new batch at zero cost
    const b = { id: newBatchId(db), partNo: line.code, inwardId: null, receivedAt: new Date().toISOString(), qty: left, remaining: left, unitCost: 0, supplier: 'Returned from job card' };
    db.stockBatches.push(b);
    allocations.push({ batchId: b.id, qty: left, unitCost: 0 });
  }
  const cost = round2(allocations.reduce((s, a) => s + a.qty * a.unitCost, 0));
  line.issuedQty = qtyRound(issued - want);
  line.issueCost = round2(Math.max(0, (line.issueCost || 0) - cost));
  if (!line.issuedQty) delete line.issueLegacy;
  const rec = { id: newIssueId(db), at: new Date().toISOString(), kind: 'return', jobId: job.id, lineId: line.id, partNo: line.code, qty: want, cost, by, reason, allocations };
  db.stockIssues.unshift(rec);
  syncPartStock(db, line.code);
  return rec;
}

const WRITEOFF_REASONS = ['Damaged', 'Expired / shelf life over', 'Lost / missing', 'Theft', 'Used internally (workshop)', 'Other'];

/** Take qty out of a part's batches, oldest first. */
function takeFifo(db, partNo, qty) {
  let left = qty;
  const allocations = [];
  for (const b of batchesOf(db, partNo).filter((x) => x.remaining > 0)) {
    if (left <= 1e-9) break;
    const take = qtyRound(Math.min(b.remaining, left));
    b.remaining = qtyRound(b.remaining - take);
    left = qtyRound(left - take);
    allocations.push({ batchId: b.id, qty: take, unitCost: b.unitCost });
  }
  return allocations;
}
/** Add found stock as a new batch, valued at the latest known cost (or the given cost). */
function addBatch(db, part, qty, unitCost, label) {
  const latest = batchesOf(db, part.no).slice(-1)[0];
  const cost = unitCost != null && unitCost !== '' && !isNaN(Number(unitCost)) ? round2(Number(unitCost)) : latest ? latest.unitCost : round2(part.mrp * 0.7);
  const b = { id: newBatchId(db), partNo: part.no, inwardId: null, receivedAt: new Date().toISOString(), qty, remaining: qty, unitCost: cost, supplier: label };
  db.stockBatches.push(b);
  return [{ batchId: b.id, qty, unitCost: cost }];
}

/** Block changes that would leave issued parts unaccounted for. */
function assertNotIssued(line, what, err) {
  if ((line.issuedQty || 0) > 0) throw err.conflict(`${line.description} has ${line.issuedQty} issued from stock. Return the parts to stock before you ${what}.`);
}

function register({ route, getDb, save, bad, notFound, conflict, str, num, actorName, audit }) {
  const db = () => { ensure(getDb()); return getDb(); };
  const err = { bad, conflict };
  const partSummary = (p) => {
    const bs = batchesOf(db(), p.no);
    const live = bs.filter((b) => b.remaining > 0);
    const value = round2(live.reduce((s, b) => s + b.remaining * b.unitCost, 0));
    return {
      no: p.no, description: p.description, category: p.category, unit: p.unit, mrp: p.mrp, active: p.active !== false,
      onHand: p.stock, reserved: reservedQty(db(), p.no), available: qtyRound(p.stock - reservedQty(db(), p.no)), reorderLevel: p.reorderLevel || 0, lowStock: p.active !== false && p.stock <= (p.reorderLevel || 0),
      value, avgCost: p.stock ? round2(value / p.stock) : 0, batches: live.length,
      oldestBatch: live[0] ? live[0].receivedAt : null, nextCost: live[0] ? live[0].unitCost : null,
    };
  };

  route('GET', '/api/stock', (req, q) => {
    const term = str(q.get('q')).toLowerCase();
    const rows = db().catalog.parts
      .filter((p) => !term || [p.no, p.description, p.category, p.brand].join('|').toLowerCase().includes(term))
      .map(partSummary);
    return { totals: { parts: rows.length, value: round2(rows.reduce((s, r) => s + r.value, 0)), lowStock: rows.filter((r) => r.lowStock).length }, rows };
  });

  route('GET', '/api/stock/parts/:no', (req, q, p) => {
    const part = db().catalog.parts.find((x) => x.no.toLowerCase() === p.no.toLowerCase());
    if (!part) throw notFound('Part');
    const inwards = new Map(db().stockInwards.map((g) => [g.id, g]));
    return Object.assign(partSummary(part), {
      fifo: batchesOf(db(), part.no).map((b) => Object.assign({}, b, { invoiceNo: inwards.get(b.inwardId)?.invoiceNo || '' })),
      movements: [
        ...db().stockBatches.filter((b) => b.partNo === part.no && b.inwardId).map((b) => ({ at: b.receivedAt, kind: 'inward', qty: b.qty, ref: b.inwardId, detail: `${inwards.get(b.inwardId)?.supplier || ''} · inv ${inwards.get(b.inwardId)?.invoiceNo || '—'} @ ${b.unitCost}` })),
        ...db().stockAdjustments.flatMap((a) => a.lines.filter((l) => l.partNo === part.no && l.qty !== 0).map((l) => ({ at: a.at, kind: a.type === 'count' ? 'count' : 'write-off', qty: l.qty, ref: a.id, detail: `${a.reason}${l.countedQty != null ? ` · counted ${l.countedQty}, system ${l.systemQty}` : ''}${a.remarks ? ' · ' + a.remarks : ''}`, by: a.by }))),
        ...db().stockIssues.filter((r) => r.partNo === part.no).map((r) => ({ at: r.at, kind: r.kind, qty: r.kind === 'issue' ? -r.qty : r.qty, ref: r.jobId, detail: `${r.allocations.map((a) => `${a.qty} from ${a.batchId} @ ${a.unitCost}`).join(', ')}${r.reason ? ' · ' + r.reason : ''}`, by: r.by })),
      ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 100),
    });
  });

  route('GET', '/api/stock/adjustments', () => db().stockAdjustments.map((a) => Object.assign({}, a, { lineCount: a.lines.length })));
  route('GET', '/api/stock/adjustments/:id', (req, q, p) => {
    const a = db().stockAdjustments.find((x) => x.id === p.id);
    if (!a) throw notFound('Stock adjustment');
    return Object.assign({}, a, { lines: a.lines.map((l) => Object.assign({}, l, { description: (db().catalog.parts.find((x) => x.no === l.partNo) || {}).description || '' })) });
  });
  route('GET', '/api/stock/writeoff-reasons', () => WRITEOFF_REASONS);

  // type 'count': lines [{ partNo, countedQty, systemQty }] – systemQty is what the counter saw; a change since then is refused
  // type 'writeoff': reason + lines [{ partNo, qty }]
  route('POST', '/api/stock/adjustments', (req, q, p, body) => {
    const d = db();
    const type = str(body.type);
    if (!['count', 'writeoff'].includes(type)) throw bad('type must be "count" or "writeoff"', { field: 'type' });
    const lines = Array.isArray(body.lines) ? body.lines : [];
    if (!lines.length) throw bad(type === 'count' ? 'Enter at least one counted quantity' : 'Add at least one part to write off', { field: 'lines' });
    let reason = str(body.reason, 100);
    if (type === 'writeoff' && !WRITEOFF_REASONS.includes(reason)) throw bad('Choose a reason for the write-off', { field: 'reason' });
    if (type === 'count') reason = reason || 'Physical stock count';
    const remarks = str(body.remarks, 300);
    if (type === 'writeoff' && reason === 'Other' && !remarks) throw bad('Add remarks when the reason is "Other"', { field: 'remarks' });
    const seen = new Set();
    const plan = lines.map((l, i) => {
      const part = d.catalog.parts.find((x) => x.no.toLowerCase() === str(l.partNo).toLowerCase());
      if (!part) throw bad(`Line ${i + 1}: unknown part number ${str(l.partNo) || '(blank)'}`, { field: 'lines', line: i });
      if (seen.has(part.no)) throw bad(`${part.no} is listed twice`, { field: 'lines', line: i });
      seen.add(part.no);
      const whole = ['EA', 'NOS', 'SET', 'PAIR'].includes(part.unit);
      if (type === 'count') {
        const counted = num(l.countedQty, { min: 0, max: 10000000 });
        if (isNaN(counted) || l.countedQty === '' || l.countedQty == null) throw bad(`Line ${i + 1}: counted quantity is required`, { field: 'lines', line: i });
        if (whole && !Number.isInteger(counted)) throw bad(`${part.no}: ${part.unit} quantities must be whole numbers`, { field: 'lines', line: i });
        if (l.systemQty != null && l.systemQty !== '' && qtyRound(Number(l.systemQty)) !== qtyRound(part.stock)) {
          throw conflict(`Stock of ${part.no} changed from ${l.systemQty} to ${part.stock} while you were counting (an issue, return or inward happened). Refresh and count it again.`, { partNo: part.no, systemQty: part.stock });
        }
        return { part, systemQty: part.stock, countedQty: qtyRound(counted), qty: qtyRound(counted - part.stock) };
      }
      const n = num(l.qty, { min: 0, max: 10000000 });
      if (!(n > 0)) throw bad(`Line ${i + 1}: quantity must be more than 0`, { field: 'lines', line: i });
      if (whole && !Number.isInteger(n)) throw bad(`${part.no}: ${part.unit} quantities must be whole numbers`, { field: 'lines', line: i });
      if (n > part.stock + 1e-9) throw conflict(`Cannot write off ${n} of ${part.no}: only ${part.stock} in stock`, { partNo: part.no });
      return { part, systemQty: part.stock, countedQty: null, qty: -qtyRound(n) };
    });
    const changes = plan.filter((x) => x.qty !== 0);
    if (type === 'count' && !changes.length) {
      // nothing to post – the count matched; still worth recording that it was checked
    }
    const id = `ADJ-${new Date().getFullYear()}-${String(d.meta.nextAdj++).padStart(5, '0')}`;
    const out = [];
    for (const x of plan) {
      let allocations = [];
      if (x.qty < 0) allocations = takeFifo(d, x.part.no, -x.qty);
      else if (x.qty > 0) allocations = addBatch(d, x.part, x.qty, null, type === 'count' ? `Stock count surplus (${id})` : 'Stock adjustment');
      const value = round2(allocations.reduce((s, a) => s + a.qty * a.unitCost, 0) * (x.qty < 0 ? -1 : 1));
      syncPartStock(d, x.part.no);
      out.push({ partNo: x.part.no, systemQty: x.systemQty, countedQty: x.countedQty, qty: x.qty, value, allocations });
    }
    const adj = { id, at: new Date().toISOString(), type, reason, remarks, by: actorName(), value: round2(out.reduce((s, l) => s + l.value, 0)), lines: out };
    d.stockAdjustments.unshift(adj);
    audit(`Stock ${type === 'count' ? 'count' : 'write-off'} ${id}: ${changes.length} part(s) changed, value ${adj.value.toFixed(2)}${type === 'writeoff' ? ` – ${reason}` : ''}`);
    save();
    return adj;
  });

  route('GET', '/api/stock/inwards', () => db().stockInwards.map((g) => {
    const lines = db().stockBatches.filter((b) => b.inwardId === g.id);
    return Object.assign({}, g, { lineCount: lines.length, qty: qtyRound(lines.reduce((s, b) => s + b.qty, 0)) });
  }));

  route('GET', '/api/stock/inwards/:id', (req, q, p) => {
    const g = db().stockInwards.find((x) => x.id === p.id);
    if (!g) throw notFound('Stock inward');
    const lines = db().stockBatches.filter((b) => b.inwardId === g.id).map((b) => {
      const part = db().catalog.parts.find((x) => x.no === b.partNo) || {};
      return { batchId: b.id, partNo: b.partNo, description: part.description || '', unit: part.unit || '', qty: b.qty, remaining: b.remaining, unitCost: b.unitCost, amount: round2(b.qty * b.unitCost) };
    });
    return Object.assign({}, g, { lines });
  });

  route('POST', '/api/stock/inwards', (req, q, p, body) => {
    const d = db();
    // supplier from the master (preferred) or typed in
    d.suppliers = d.suppliers || [];
    const sup = body.supplierId ? d.suppliers.find((x) => x.id === str(body.supplierId)) : d.suppliers.find((x) => x.name.toLowerCase() === str(body.supplier).toLowerCase());
    if (body.supplierId && !sup) throw bad('Unknown supplier', { field: 'supplierId' });
    if (sup && sup.active === false) throw bad(`${sup.name} is inactive`, { field: 'supplierId' });
    const supplier = sup ? sup.name : str(body.supplier, 100);
    if (!supplier) throw bad('Supplier is required', { field: 'supplier' });
    // optional purchase order being received
    const po = body.poId ? (d.purchaseOrders || []).find((x) => x.id === str(body.poId)) : null;
    if (body.poId && !po) throw bad('Unknown purchase order', { field: 'poId' });
    if (po && ['cancelled', 'received'].includes(po.status)) throw conflict(`${po.id} is ${po.status}`);
    if (po && sup && po.supplierId !== sup.id) throw bad(`${po.id} was ordered from ${po.supplierName}`, { field: 'poId' });
    const invoiceNo = str(body.invoiceNo, 40).toUpperCase();
    if (!invoiceNo) throw bad('Supplier invoice number is required', { field: 'invoiceNo' });
    if (d.stockInwards.some((g) => g.supplier.toLowerCase() === supplier.toLowerCase() && g.invoiceNo === invoiceNo)) throw conflict(`Invoice ${invoiceNo} from ${supplier} is already recorded`);
    const invoiceDate = body.invoiceDate ? new Date(body.invoiceDate) : new Date();
    if (isNaN(invoiceDate)) throw bad('Invoice date is not valid', { field: 'invoiceDate' });
    if (invoiceDate > new Date(Date.now() + 86400000)) throw bad('Invoice date cannot be in the future', { field: 'invoiceDate' });
    const lines = Array.isArray(body.lines) ? body.lines : [];
    if (!lines.length) throw bad('Add at least one part', { field: 'lines' });
    const clean = lines.map((l, i) => {
      const part = d.catalog.parts.find((x) => x.no.toLowerCase() === str(l.partNo).toLowerCase());
      if (!part) throw bad(`Line ${i + 1}: unknown part number ${str(l.partNo) || '(blank)'}`, { field: 'lines', line: i });
      if (part.active === false) throw bad(`Line ${i + 1}: ${part.no} is inactive in the parts master`, { field: 'lines', line: i });
      const qty = num(l.qty, { min: 0, max: 1000000 });
      if (!(qty > 0)) throw bad(`Line ${i + 1}: quantity must be more than 0`, { field: 'lines', line: i });
      if (['EA', 'NOS', 'SET', 'PAIR'].includes(part.unit) && !Number.isInteger(qty)) throw bad(`Line ${i + 1}: ${part.unit} quantities must be whole numbers`, { field: 'lines', line: i });
      const unitCost = num(l.unitCost, { min: 0, max: 10000000 });
      if (isNaN(unitCost) || l.unitCost === '' || l.unitCost == null) throw bad(`Line ${i + 1}: unit cost is required`, { field: 'lines', line: i });
      const taxPct = l.taxPct != null && l.taxPct !== '' ? Number(l.taxPct) : part.gstPct != null ? Number(part.gstPct) : 10;
      if (![0, 10].includes(taxPct)) throw bad(`Line ${i + 1}: GST must be 10% or 0 (GST-free)`, { field: 'lines', line: i });
      let poLine = null;
      if (po) {
        poLine = po.lines.find((x) => x.partNo === part.no);
        if (!poLine) throw bad(`Line ${i + 1}: ${part.no} is not on ${po.id}`, { field: 'lines', line: i });
        const open = qtyRound(poLine.qty - (poLine.receivedQty || 0));
        if (qty > open + 1e-9) throw conflict(`Line ${i + 1}: only ${open} of ${part.no} still to receive on ${po.id}`);
      }
      return { part, qty: qtyRound(qty), unitCost: round2(unitCost), taxPct, poLine };
    });
    const id = `GRN-${new Date().getFullYear()}-${String(d.meta.nextGrn++).padStart(5, '0')}`;
    const at = new Date().toISOString();
    const total = round2(clean.reduce((s, l) => s + l.qty * l.unitCost, 0));
    const gst = round2(clean.reduce((s, l) => s + round2((l.qty * l.unitCost * l.taxPct) / 100), 0));
    const terms = sup ? Number(sup.paymentTermsDays) || 0 : 30;
    const g = { id, at, supplier, supplierId: sup ? sup.id : null, poId: po ? po.id : null, invoiceNo, invoiceDate: invoiceDate.toISOString(), by: actorName(), remarks: str(body.remarks, 300),
      total, gst, totalInc: round2(total + gst), dueAt: new Date(invoiceDate.getTime() + terms * 86400000).toISOString(), paid: 0, credits: 0 };
    d.stockInwards.unshift(g);
    for (const l of clean) {
      d.stockBatches.push({ id: newBatchId(d), partNo: l.part.no, inwardId: id, receivedAt: at, qty: l.qty, remaining: l.qty, unitCost: l.unitCost, taxPct: l.taxPct, supplier });
      if (l.poLine) l.poLine.receivedQty = qtyRound((l.poLine.receivedQty || 0) + l.qty);
      syncPartStock(d, l.part.no);
    }
    if (po) po.status = po.lines.every((x) => (x.receivedQty || 0) + 1e-9 >= x.qty) ? 'received' : 'part-received';
    audit(`Stock inward ${id}: ${clean.length} line(s) from ${supplier}, invoice ${invoiceNo}${po ? ` against ${po.id}` : ''}`);
    save();
    return Object.assign({}, g, { lines: clean.map((l) => ({ partNo: l.part.no, qty: l.qty, unitCost: l.unitCost, onHand: l.part.stock })) });
  });
}

/** Opening stock for databases created before inventory tracking. */
function migrate(db) {
  if (Array.isArray(db.stockBatches)) return false;
  ensure(db);
  const longAgo = Date.now() - 75 * 86400000, lessAgo = Date.now() - 20 * 86400000;
  for (const p of db.catalog.parts) {
    const stock = Number(p.stock) || 0;
    if (stock <= 0) continue;
    // split larger opening stock into an older and a newer lot so FIFO is visible
    const older = stock >= 4 ? Math.floor(stock / 2) : stock;
    db.stockBatches.push({ id: newBatchId(db), partNo: p.no, inwardId: null, receivedAt: new Date(longAgo).toISOString(), qty: older, remaining: older, unitCost: round2(p.mrp * 0.68), supplier: 'Opening stock' });
    if (stock - older > 0) db.stockBatches.push({ id: newBatchId(db), partNo: p.no, inwardId: null, receivedAt: new Date(lessAgo).toISOString(), qty: stock - older, remaining: stock - older, unitCost: round2(p.mrp * 0.72), supplier: 'Opening stock' });
  }
  // approved part lines on jobs already being worked on were issued before tracking existed
  for (const j of db.jobcards) {
    if (j.stage === 'checked_in' && j.status !== 'closed') continue;
    for (const l of j.lines) if (l.kind === 'part' && l.status === 'approved' && !l.issuedQty) { l.issuedQty = l.qty; l.issueCost = null; l.issueLegacy = true; }
  }
  return true;
}

module.exports = { reservedQty, batchesOf, qtyRound, WRITEOFF_REASONS, register, migrate, issueLine, returnLine, assertNotIssued, syncPartStock, ensure };
