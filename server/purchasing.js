// Purchasing: purchase orders, reorder suggestions, supplier bills (= goods receipts
// with the supplier's GST), supplier payments, returns to supplier and payables.
//
//   db.suppliers        master (see masters.js)
//   db.purchaseOrders   [{ id, supplierId, supplierName, at, expectedAt, status: draft|sent|part-received|received|cancelled, lines: [{ partNo, description, qty, unitCost, receivedQty }], notes, by, subtotal, gst, total }]
//   db.stockInwards     goods receipts – also the supplier's tax invoice (bill): total ex GST, gst, totalInc, dueAt, paid, credits
//   db.supplierPayments [{ id, at, inwardId, amount, method, reference, by }]
//   db.purchaseReturns  [{ id, at, inwardId, supplier, reason, lines: [{ batchId, partNo, qty, unitCost, taxPct, value, gst }], value, gst, totalInc, by }]

const au = require('./au');
const stock = require('./stock');
const r2 = au.round2;

const PAY_METHODS = ['Bank transfer', 'BPAY', 'Credit card', 'Cheque', 'Cash'];
const RETURN_REASONS = ['Wrong part supplied', 'Damaged in transit', 'Faulty / warranty', 'Ordered in error', 'Surplus stock'];

function ensure(db) {
  db.suppliers = db.suppliers || [];
  db.purchaseOrders = db.purchaseOrders || [];
  db.supplierPayments = db.supplierPayments || [];
  db.purchaseReturns = db.purchaseReturns || [];
  db.meta.nextPo = db.meta.nextPo || 1;
  db.meta.nextSupPay = db.meta.nextSupPay || 1;
  db.meta.nextPrn = db.meta.nextPrn || 1;
}
const seq = (db, key, prefix) => `${prefix}-${String(db.meta[key]++).padStart(6, '0')}`;
const billOf = (g) => {
  const totalInc = g.totalInc != null ? g.totalInc : r2(g.total * 1.1);
  const balance = r2(totalInc - (g.credits || 0) - (g.paid || 0));
  return { totalInc, balance, status: balance <= 0.004 ? 'paid' : (g.paid || 0) > 0 || (g.credits || 0) > 0 ? 'part-paid' : 'unpaid' };
};

function register(ctx) {
  const { route, getDb, save, bad, notFound, conflict, str, num, actorName, audit } = ctx;
  const db = () => { const d = getDb(); ensure(d); stock.ensure(d); return d; };
  const supplierOf = (d, id) => d.suppliers.find((s) => s.id === id);
  const totalsOf = (lines) => {
    const subtotal = r2(lines.reduce((s, l) => s + l.qty * l.unitCost, 0));
    const gst = r2(lines.reduce((s, l) => s + r2((l.qty * l.unitCost * (l.taxPct ?? 10)) / 100), 0));
    return { subtotal, gst, total: r2(subtotal + gst) };
  };

  function cleanLines(d, lines) {
    if (!Array.isArray(lines) || !lines.length) throw bad('Add at least one part', { field: 'lines' });
    const seen = new Set();
    return lines.map((l, i) => {
      const part = d.catalog.parts.find((x) => x.no.toLowerCase() === str(l.partNo).toLowerCase());
      if (!part) throw bad(`Line ${i + 1}: unknown part number ${str(l.partNo) || '(blank)'}`, { field: 'lines', line: i });
      if (part.active === false) throw bad(`Line ${i + 1}: ${part.no} is inactive`, { field: 'lines', line: i });
      if (seen.has(part.no)) throw bad(`${part.no} is listed twice`, { field: 'lines', line: i });
      seen.add(part.no);
      const qty = num(l.qty, { min: 0, max: 1000000 });
      if (!(qty > 0)) throw bad(`Line ${i + 1}: quantity must be more than 0`, { field: 'lines', line: i });
      if (['EA', 'SET', 'PAIR'].includes(part.unit) && !Number.isInteger(qty)) throw bad(`Line ${i + 1}: ${part.unit} quantities must be whole numbers`, { field: 'lines', line: i });
      const unitCost = num(l.unitCost, { min: 0, max: 10000000 });
      if (isNaN(unitCost) || l.unitCost === '' || l.unitCost == null) throw bad(`Line ${i + 1}: unit cost is required`, { field: 'lines', line: i });
      return { partNo: part.no, description: part.description, unit: part.unit, qty, unitCost: r2(unitCost), taxPct: part.gstPct != null ? Number(part.gstPct) : 10, receivedQty: 0 };
    });
  }

  /* ---------- reorder suggestions ---------- */
  route('GET', '/api/purchasing/reorder', () => {
    const d = db();
    const onOrder = (no) => d.purchaseOrders.filter((p) => ['draft', 'sent', 'part-received'].includes(p.status)).reduce((s, p) => s + p.lines.filter((l) => l.partNo === no).reduce((t, l) => t + (l.qty - (l.receivedQty || 0)), 0), 0);
    return d.catalog.parts.filter((p) => p.active !== false && p.stock <= (p.reorderLevel || 0)).map((p) => {
      const last = d.stockBatches.filter((b) => b.partNo === p.no && b.inwardId).sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt))[0];
      const lastInward = last ? d.stockInwards.find((g) => g.id === last.inwardId) : null;
      const ordered = onOrder(p.no);
      const target = Math.max(1, (p.reorderLevel || 0) * 2);
      return { partNo: p.no, description: p.description, unit: p.unit, onHand: p.stock, reorderLevel: p.reorderLevel || 0, onOrder: ordered, suggestQty: Math.max(0, target - p.stock - ordered), lastCost: last ? last.unitCost : r2(p.mrp * 0.7), lastSupplierId: lastInward ? lastInward.supplierId : null, lastSupplier: last ? last.supplier : '' };
    }).filter((r) => r.suggestQty > 0 || r.onOrder > 0);
  });

  /* ---------- purchase orders ---------- */
  const poBrief = (d, p) => Object.assign({}, p, totalsOf(p.lines), { lineCount: p.lines.length, outstanding: p.lines.reduce((s, l) => s + Math.max(0, l.qty - (l.receivedQty || 0)), 0) });
  route('GET', '/api/purchase-orders', (req, q) => {
    const d = db();
    const st = str(q.get('status'));
    return d.purchaseOrders.filter((p) => !st || (st === 'open' ? ['draft', 'sent', 'part-received'].includes(p.status) : p.status === st)).map((p) => poBrief(d, p));
  });
  route('GET', '/api/purchase-orders/:id', (req, q, p) => {
    const d = db();
    const po = d.purchaseOrders.find((x) => x.id === p.id);
    if (!po) throw notFound('Purchase order');
    return Object.assign(poBrief(d, po), { supplier: supplierOf(d, po.supplierId) || null, receipts: d.stockInwards.filter((g) => g.poId === po.id).map((g) => ({ id: g.id, at: g.at, invoiceNo: g.invoiceNo, total: g.total })) });
  });
  route('POST', '/api/purchase-orders', (req, q, p, body) => {
    const d = db();
    const sup = supplierOf(d, str(body.supplierId));
    if (!sup) throw bad('Choose a supplier', { field: 'supplierId' });
    if (sup.active === false) throw bad(`${sup.name} is inactive`, { field: 'supplierId' });
    const lines = cleanLines(d, body.lines);
    const expectedAt = body.expectedAt ? new Date(body.expectedAt) : null;
    if (expectedAt && isNaN(expectedAt)) throw bad('Expected date is not valid', { field: 'expectedAt' });
    const po = { id: seq(d, 'nextPo', 'PO'), supplierId: sup.id, supplierName: sup.name, at: new Date().toISOString(), expectedAt: expectedAt ? expectedAt.toISOString() : null, status: 'draft', lines, notes: str(body.notes, 500), by: actorName() };
    d.purchaseOrders.unshift(po);
    audit(`Purchase order ${po.id} created for ${sup.name} (${lines.length} line(s))`);
    save();
    return poBrief(d, po);
  });
  route('PATCH', '/api/purchase-orders/:id', (req, q, p, body) => {
    const d = db();
    const po = d.purchaseOrders.find((x) => x.id === p.id);
    if (!po) throw notFound('Purchase order');
    if (po.status !== 'draft') throw conflict('Only draft purchase orders can be edited');
    if ('lines' in body) po.lines = cleanLines(d, body.lines);
    if ('notes' in body) po.notes = str(body.notes, 500);
    if ('expectedAt' in body) po.expectedAt = body.expectedAt ? new Date(body.expectedAt).toISOString() : null;
    save();
    return poBrief(d, po);
  });
  route('POST', '/api/purchase-orders/:id/send', (req, q, p) => {
    const d = db();
    const po = d.purchaseOrders.find((x) => x.id === p.id);
    if (!po) throw notFound('Purchase order');
    if (po.status !== 'draft') throw conflict(`${po.id} is already ${po.status}`);
    po.status = 'sent';
    po.sentAt = new Date().toISOString();
    audit(`Purchase order ${po.id} sent to ${po.supplierName}`);
    save();
    return poBrief(d, po);
  });
  route('POST', '/api/purchase-orders/:id/cancel', (req, q, p, body) => {
    const d = db();
    const po = d.purchaseOrders.find((x) => x.id === p.id);
    if (!po) throw notFound('Purchase order');
    if (po.status === 'cancelled' || po.status === 'received') throw conflict(`${po.id} is already ${po.status}`);
    if (po.lines.some((l) => (l.receivedQty || 0) > 0)) {
      // close the rest of a part-received order instead
      po.status = 'received';
      po.closedShort = true;
    } else po.status = 'cancelled';
    po.cancelReason = str(body.reason, 200);
    audit(`Purchase order ${po.id} ${po.status === 'cancelled' ? 'cancelled' : 'closed short'}${po.cancelReason ? ': ' + po.cancelReason : ''}`);
    save();
    return poBrief(d, po);
  });

  /* ---------- supplier bills & payments ---------- */
  route('GET', '/api/payables', () => {
    const d = db();
    const now = Date.now();
    const rows = new Map();
    for (const g of d.stockInwards) {
      const b = billOf(g);
      if (b.balance <= 0.004) continue;
      const key = g.supplierId || g.supplier;
      if (!rows.has(key)) rows.set(key, { supplier: g.supplier, supplierId: g.supplierId, current: 0, overdue: 0, total: 0, bills: [] });
      const r = rows.get(key);
      const late = g.dueAt && Date.parse(g.dueAt) < now;
      r[late ? 'overdue' : 'current'] = r2(r[late ? 'overdue' : 'current'] + b.balance);
      r.total = r2(r.total + b.balance);
      r.bills.push({ id: g.id, invoiceNo: g.invoiceNo, dueAt: g.dueAt, balance: b.balance, overdue: !!late });
    }
    const list = [...rows.values()].sort((a, b) => b.total - a.total);
    return { rows: list, totals: { current: r2(list.reduce((s, r) => s + r.current, 0)), overdue: r2(list.reduce((s, r) => s + r.overdue, 0)), total: r2(list.reduce((s, r) => s + r.total, 0)) } };
  });
  route('GET', '/api/stock/inwards/:id/bill', (req, q, p) => {
    const d = db();
    const g = d.stockInwards.find((x) => x.id === p.id);
    if (!g) throw notFound('Goods receipt');
    return Object.assign({}, g, billOf(g), { payments: d.supplierPayments.filter((x) => x.inwardId === g.id), returns: d.purchaseReturns.filter((x) => x.inwardId === g.id) });
  });
  route('POST', '/api/stock/inwards/:id/payments', (req, q, p, body) => {
    const d = db();
    const g = d.stockInwards.find((x) => x.id === p.id);
    if (!g) throw notFound('Goods receipt');
    const b = billOf(g);
    const method = str(body.method);
    if (!PAY_METHODS.includes(method)) throw bad(`Method must be one of ${PAY_METHODS.join(', ')}`, { field: 'method' });
    const amount = r2(num(body.amount, { min: 0, max: 10000000 }));
    if (!(amount > 0)) throw bad('Amount must be more than $0', { field: 'amount' });
    if (amount > b.balance + 0.004) throw conflict(`Amount is more than the ${au.money(b.balance)} owing to ${g.supplier}`);
    const pay = { id: seq(d, 'nextSupPay', 'SPAY'), at: new Date().toISOString(), inwardId: g.id, supplier: g.supplier, amount, method, reference: str(body.reference, 60), by: actorName() };
    d.supplierPayments.unshift(pay);
    g.paid = r2((g.paid || 0) + amount);
    audit(`Supplier payment ${pay.id}: ${au.money(amount)} to ${g.supplier} for ${g.invoiceNo}`);
    save();
    return Object.assign({}, g, billOf(g), { payment: pay });
  });

  /* ---------- returns to supplier ---------- */
  route('GET', '/api/stock/returns', () => db().purchaseReturns);
  route('GET', '/api/stock/return-reasons', () => RETURN_REASONS);
  route('POST', '/api/stock/returns', (req, q, p, body) => {
    const d = db();
    const g = d.stockInwards.find((x) => x.id === str(body.inwardId));
    if (!g) throw bad('Choose the goods receipt the parts came in on', { field: 'inwardId' });
    const reason = str(body.reason, 100);
    if (!RETURN_REASONS.includes(reason)) throw bad('Choose a reason for the return', { field: 'reason' });
    const lines = Array.isArray(body.lines) ? body.lines.filter((l) => Number(l.qty) > 0) : [];
    if (!lines.length) throw bad('Enter a quantity to return for at least one part', { field: 'lines' });
    const plan = lines.map((l, i) => {
      const b = d.stockBatches.find((x) => x.id === str(l.batchId) && x.inwardId === g.id);
      if (!b) throw bad(`Line ${i + 1}: batch is not from ${g.id}`, { field: 'lines', line: i });
      const qty = stock.qtyRound(Number(l.qty));
      if (qty > b.remaining + 1e-9) throw conflict(`Only ${b.remaining} of ${b.partNo} from this receipt is still in stock (the rest has been issued)`);
      return { b, qty };
    });
    const out = plan.map(({ b, qty }) => {
      b.remaining = stock.qtyRound(b.remaining - qty);
      b.returned = stock.qtyRound((b.returned || 0) + qty);
      stock.syncPartStock(d, b.partNo);
      const value = r2(qty * b.unitCost);
      const taxPct = b.taxPct != null ? b.taxPct : 10;
      return { batchId: b.id, partNo: b.partNo, qty, unitCost: b.unitCost, taxPct, value, gst: r2((value * taxPct) / 100) };
    });
    const ret = { id: seq(d, 'nextPrn', 'PRN'), at: new Date().toISOString(), inwardId: g.id, supplier: g.supplier, supplierId: g.supplierId, invoiceNo: g.invoiceNo, reason, remarks: str(body.remarks, 300), lines: out, value: r2(out.reduce((s, l) => s + l.value, 0)), gst: r2(out.reduce((s, l) => s + l.gst, 0)), by: actorName() };
    ret.totalInc = r2(ret.value + ret.gst);
    d.purchaseReturns.unshift(ret);
    g.credits = r2((g.credits || 0) + ret.totalInc);
    audit(`Return to supplier ${ret.id}: ${out.length} line(s) to ${g.supplier} (${reason}), credit ${au.money(ret.totalInc)}`);
    save();
    return ret;
  });
}

module.exports = { register, ensure, billOf, PAY_METHODS, RETURN_REASONS };
