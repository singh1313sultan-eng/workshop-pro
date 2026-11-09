// Billing for Australian workshops: tax invoices, credit notes, payments/refunds,
// account customers, debtors, gate passes – and insurance / warranty claims, which
// decide who is billed.
//
//   db.invoices  [{ id, kind: 'invoice'|'credit', jobId, vin, rego, payer: 'customer'|'insurer'|'manufacturer',
//                   billTo: { name, address, abn, email, phone, customerId? }, issuedAt, dueAt, lines: [...],
//                   subtotal, gst, total, paid, balance, status: 'issued'|'credited'|'void', creditFor?, creditedBy?, seller: {…} }]
//   db.payments  [{ id, at, invoiceId, kind: 'payment'|'refund'|'transfer', method, amount, reference, reason, by }]
//   job.claim    { type: 'insurance'|'warranty', payer, insurerId?, claimNo, assessor, excess, authorisedAmount, status, notes, history }
//   job.gatePass { number, at, by, override, reason }

const au = require('./au');
const r2 = au.round2;

const METHODS = ['EFTPOS', 'Credit card', 'Cash', 'Bank transfer', 'PayID', 'BPAY', 'Cheque'];
const CLAIM_STATUSES = ['lodged', 'assessed', 'authorised', 'declined', 'invoiced', 'paid'];
const MANUFACTURER = { name: 'Isuzu Australia Limited', address: '858 Lorimer Street, Port Melbourne VIC 3207', abn: '' };

function ensure(db) {
  db.invoices = db.invoices || [];
  db.payments = db.payments || [];
  db.meta.nextInvoice = db.meta.nextInvoice || 1;
  db.meta.nextCredit = db.meta.nextCredit || 1;
  db.meta.nextReceipt = db.meta.nextReceipt || 1;
  db.meta.nextGatePass = db.meta.nextGatePass || 1;
}
const endOfDay = (d) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x.getTime(); };
const seq = (db, key, prefix) => `${prefix}-${String(db.meta[key]++).padStart(6, '0')}`;
const sellerOf = (w) => ({ name: w.name, legalName: w.legalName, abn: w.abn, address: `${w.address}, ${w.suburb} ${w.state} ${w.postcode}`, phone: w.phone, email: w.email, mvrl: w.mvrl || '', bankName: w.bankName, bsb: w.bsb, accountNo: w.accountNo, accountName: w.accountName, payId: w.payId, terms: w.invoiceTerms });
const payerLabel = { customer: 'Customer', insurer: 'Insurer', manufacturer: 'Manufacturer (warranty)' };

/** Recalculate paid / balance / status of an invoice from its payments. */
function settle(db, inv) {
  const ps = db.payments.filter((p) => p.invoiceId === inv.id);
  inv.paid = r2(ps.reduce((s, p) => s + (p.kind === 'refund' ? -p.amount : p.amount), 0));
  inv.balance = r2((inv.kind === 'credit' ? 0 : inv.total) - inv.paid);
  if (inv.status === 'issued') inv.payStatus = inv.balance <= 0.004 ? 'paid' : inv.paid > 0 ? 'part-paid' : 'unpaid';
  else inv.payStatus = inv.status;
  return inv;
}

function register(ctx) {
  const { route, getDb, save, bad, notFound, conflict, str, num, actorName, audit, findJob, vehicle, lineAmount, campaignPct, lineTaxPct, log, jobFull } = ctx;
  const db = () => { ensure(getDb()); return getDb(); };

  /* ---------- invoice building ---------- */
  function buildLines(job, lines) {
    const pct = campaignPct(job);
    const out = lines.map((l) => {
      const gross = lineAmount(l); // qty × rate less line discount
      const net = r2(l.kind === 'part' && pct ? gross * (1 - pct / 100) : gross);
      const taxPct = lineTaxPct(l);
      const gst = r2((net * taxPct) / 100);
      return { code: l.code, kind: l.kind, description: l.description + (l.kind === 'part' && pct ? ` (incl. ${pct}% campaign discount)` : ''), qty: l.qty, unitPrice: l.rate, discountPct: l.discountPct || 0, net, taxPct, gst, total: r2(net + gst), jobLineId: l.id };
    });
    return out;
  }
  const sum = (lines) => ({ subtotal: r2(lines.reduce((s, l) => s + l.net, 0)), gst: r2(lines.reduce((s, l) => s + l.gst, 0)), total: r2(lines.reduce((s, l) => s + l.total, 0)) });

  function newInvoice(d, job, payer, billTo, lines, extra = {}) {
    const v = vehicle(job.vin) || {};
    const issuedAt = new Date().toISOString();
    const termsDays = payer === 'customer' && v.owner && v.owner.accountCustomer ? Number(v.owner.paymentTermsDays) || 30 : payer === 'customer' ? 0 : 30;
    const inv = Object.assign({
      id: seq(d, 'nextInvoice', 'INV'), kind: 'invoice', jobId: job.id, vin: job.vin, rego: v.reg || '', vehicleDesc: [v.model, v.variant].filter(Boolean).join(' '), odometer: job.odometer, payer, billTo,
      issuedAt, dueAt: new Date(Date.parse(issuedAt) + termsDays * 86400000).toISOString(), termsDays, lines, status: 'issued', by: actorName(), seller: sellerOf(d.workshop),
    }, sum(lines), extra);
    d.invoices.unshift(inv);
    settle(d, inv);
    return inv;
  }
  const customerBillTo = (v) => ({ name: v.owner.name, address: v.owner.address || '', abn: v.owner.abn || '', email: v.owner.email || '', phone: v.owner.phone || '', customerId: v.owner.customerId });

  /** Issue the tax invoice(s) for a job: split between the customer and the claim payer. */
  function issueForJob(job) {
    const d = db();
    const v = vehicle(job.vin);
    const approved = job.lines.filter((l) => l.status === 'approved');
    const claim = job.claim && job.claim.status !== 'declined' ? job.claim : null;
    if (claim) {
      if (claim.type === 'insurance' && !['authorised', 'invoiced', 'paid'].includes(claim.status)) throw conflict('The insurer has not authorised the repair yet. Record the authority on the Claim tab first.');
      if (claim.type === 'warranty' && !claim.claimNo) throw conflict('Enter the warranty claim number before invoicing.');
    }
    const claimLines = claim ? approved.filter((l) => l.payer !== 'customer') : [];
    const custLines = claim ? approved.filter((l) => l.payer === 'customer') : approved;
    const created = [];
    if (claimLines.length) {
      const lines = buildLines(job, claimLines);
      let billTo;
      if (claim.type === 'insurance') {
        const ins = d.insurers.find((i) => i.id === claim.insurerId) || d.insurers.find((i) => i.name === claim.payer) || {};
        billTo = { name: ins.name || claim.payer, address: ins.address || '', abn: ins.abn || '', email: ins.email || '', phone: ins.phone || '', claimNo: claim.claimNo };
        const excess = r2(Number(claim.excess) || 0);
        if (excess > 0) {
          // the insured pays the excess; it is part of the price of the repair (GST-inclusive)
          const exNet = r2(excess / 1.1), exGst = r2(excess - exNet);
          lines.push({ code: 'EXCESS', kind: 'adjustment', description: `Less: excess payable by the insured (claim ${claim.claimNo})`, qty: 1, unitPrice: -exNet, discountPct: 0, net: -exNet, taxPct: 10, gst: -exGst, total: -excess });
        }
        created.push(newInvoice(d, job, 'insurer', billTo, lines, { claimNo: claim.claimNo }));
        if (excess > 0) {
          const exNet = r2(excess / 1.1);
          created.push(newInvoice(d, job, 'customer', customerBillTo(v), [{ code: 'EXCESS', kind: 'adjustment', description: `Insurance excess – ${billTo.name} claim ${claim.claimNo}`, qty: 1, unitPrice: exNet, discountPct: 0, net: exNet, taxPct: 10, gst: r2(excess - exNet), total: excess }], { claimNo: claim.claimNo }));
        }
      } else {
        billTo = Object.assign({}, MANUFACTURER, { name: claim.payer || MANUFACTURER.name, claimNo: claim.claimNo });
        created.push(newInvoice(d, job, 'manufacturer', billTo, lines, { claimNo: claim.claimNo }));
      }
      claim.status = 'invoiced';
      (claim.history = claim.history || []).unshift({ at: new Date().toISOString(), by: actorName(), status: 'invoiced', note: created.map((i) => i.id).join(', ') });
    }
    if (custLines.length) {
      // customer invoice; merge with an excess invoice if one was just made
      const exc = created.find((i) => i.payer === 'customer');
      const lines = buildLines(job, custLines);
      if (exc) { exc.lines.push(...lines); Object.assign(exc, sum(exc.lines)); settle(d, exc); }
      else created.push(newInvoice(d, job, 'customer', customerBillTo(v), lines));
    }
    if (!created.length) throw conflict('Nothing approved to invoice');
    // carry over money paid on earlier (credited) invoices of this job
    for (const old of d.invoices.filter((i) => i.jobId === job.id && i.status === 'credited' && i.kind === 'invoice')) {
      settle(d, old);
      let credit = r2(old.paid);
      for (const inv of created.filter((i) => i.payer === old.payer)) {
        if (credit <= 0) break;
        const amt = r2(Math.min(credit, inv.balance));
        if (amt <= 0) continue;
        transfer(d, old, inv, amt);
        credit = r2(credit - amt);
      }
    }
    job.invoiceIds = [...(job.invoiceIds || []), ...created.map((i) => i.id)];
    const main = created.find((i) => i.payer === 'customer') || created[0];
    job.invoice = { number: main.id, at: main.issuedAt, total: r2(created.reduce((s, i) => s + i.total, 0)), invoices: created.map((i) => ({ id: i.id, payer: i.payer, total: i.total })) };
    return created;
  }

  function transfer(d, from, to, amount) {
    const at = new Date().toISOString();
    d.payments.unshift({ id: seq(d, 'nextReceipt', 'RCT'), at, invoiceId: from.id, kind: 'refund', method: 'Transfer', amount, reference: `to ${to.id}`, reason: 'Credit moved to replacement invoice', by: actorName() });
    d.payments.unshift({ id: seq(d, 'nextReceipt', 'RCT'), at, invoiceId: to.id, kind: 'payment', method: 'Transfer', amount, reference: `from ${from.id}`, reason: '', by: actorName() });
    settle(d, from); settle(d, to);
  }

  /** Credit every live invoice of a job (on reopen). */
  function creditForJob(job, reason) {
    const d = db();
    const live = d.invoices.filter((i) => i.jobId === job.id && i.kind === 'invoice' && i.status === 'issued');
    const notes = live.map((inv) => {
      const lines = inv.lines.map((l) => Object.assign({}, l, { qty: -l.qty, net: -l.net, gst: -l.gst, total: -l.total }));
      const cn = { id: seq(d, 'nextCredit', 'CN'), kind: 'credit', creditFor: inv.id, jobId: job.id, vin: inv.vin, rego: inv.rego, vehicleDesc: inv.vehicleDesc, payer: inv.payer, billTo: inv.billTo, issuedAt: new Date().toISOString(), dueAt: null, lines, status: 'issued', reason, by: actorName(), seller: sellerOf(d.workshop), subtotal: -inv.subtotal, gst: -inv.gst, total: -inv.total };
      d.invoices.unshift(cn);
      inv.status = 'credited';
      inv.creditedBy = cn.id;
      settle(d, inv); settle(d, cn);
      return cn;
    });
    if (job.claim && job.claim.status === 'invoiced') job.claim.status = 'authorised';
    if (job.invoice) job.invoice = Object.assign({}, job.invoice, { cancelledAt: new Date().toISOString(), creditNotes: notes.map((n) => n.id) });
    return notes;
  }

  /** Can the vehicle leave? */
  function releaseCheck(job) {
    const d = db();
    const v = vehicle(job.vin) || { owner: {} };
    const owing = d.invoices.filter((i) => i.jobId === job.id && i.kind === 'invoice' && i.status === 'issued' && i.payer === 'customer').map((i) => settle(d, i)).filter((i) => i.balance > 0.004);
    const amount = r2(owing.reduce((s, i) => s + i.balance, 0));
    return { owing: amount, invoices: owing.map((i) => i.id), account: !!v.owner.accountCustomer, ok: amount <= 0.004 || !!v.owner.accountCustomer };
  }

  /* ---------- claims ---------- */
  route('PUT', '/api/jobcards/:id/claim', (req, q, p, body) => {
    const d = db();
    const j = findJob(p.id);
    if (j.status === 'closed') throw conflict('This job card is closed. Reopen it to change the claim.');
    const type = str(body.type);
    if (!['insurance', 'warranty'].includes(type)) throw bad('Claim type must be insurance or warranty', { field: 'type' });
    const claimNo = str(body.claimNo, 40).toUpperCase();
    const c = Object.assign({ history: [] }, j.claim || {}, { type, claimNo, assessor: str(body.assessor, 80), notes: str(body.notes, 1000) });
    if (type === 'insurance') {
      const ins = d.insurers.find((i) => i.id === str(body.insurerId) || i.name === str(body.payer));
      if (!ins) throw bad('Choose the insurer from the list', { field: 'insurerId' });
      if (ins.active === false) throw bad(`${ins.name} is inactive`, { field: 'insurerId' });
      if (!claimNo) throw bad('Claim number is required', { field: 'claimNo' });
      const excess = num(body.excess ?? 0, { min: 0, max: 100000 });
      if (isNaN(excess)) throw bad('Excess must be a number', { field: 'excess' });
      Object.assign(c, { insurerId: ins.id, payer: ins.name, excess: r2(excess) });
    } else {
      Object.assign(c, { insurerId: null, payer: str(body.payer, 100) || MANUFACTURER.name, excess: 0 });
    }
    if (body.authorisedAmount !== undefined && body.authorisedAmount !== '') {
      const a = num(body.authorisedAmount, { min: 0, max: 10000000 });
      if (isNaN(a)) throw bad('Authorised amount must be a number', { field: 'authorisedAmount' });
      c.authorisedAmount = r2(a);
    }
    if (!j.claim) {
      c.status = 'lodged';
      c.history.unshift({ at: new Date().toISOString(), by: actorName(), status: 'lodged', note: `${type === 'insurance' ? c.payer : 'Warranty'} claim ${claimNo || ''}`.trim() });
      // by default the claim pays for every line already on the job
      j.lines.forEach((l) => { if (!l.payer) l.payer = 'claim'; });
    }
    j.claim = c;
    log(j, `${type === 'insurance' ? 'Insurance' : 'Warranty'} claim ${j.claim.history.length > 1 ? 'updated' : 'lodged'}: ${c.payer}${claimNo ? ' #' + claimNo : ''}${c.excess ? `, excess ${au.money(c.excess)}` : ''}`);
    save();
    return jobFull(j);
  });
  route('POST', '/api/jobcards/:id/claim/status', (req, q, p, body) => {
    const j = findJob(p.id);
    if (!j.claim) throw notFound('Claim');
    const status = str(body.status);
    if (!['lodged', 'assessed', 'authorised', 'declined'].includes(status)) throw bad('Status must be lodged, assessed, authorised or declined', { field: 'status' });
    if (j.claim.status === 'invoiced' || j.claim.status === 'paid') throw conflict('The claim has been invoiced. Reopen the job card to change it.');
    if (status === 'authorised') {
      const a = num(body.authorisedAmount ?? j.claim.authorisedAmount, { min: 0, max: 10000000 });
      if (isNaN(a) || a <= 0) throw bad('Enter the amount the insurer / manufacturer authorised', { field: 'authorisedAmount' });
      j.claim.authorisedAmount = r2(a);
      if (str(body.authorityNo)) j.claim.authorityNo = str(body.authorityNo, 40).toUpperCase();
    }
    if (status === 'declined' && !str(body.note)) throw bad('Add a note explaining why the claim was declined', { field: 'note' });
    j.claim.status = status;
    if (status === 'declined') j.lines.forEach((l) => { if (l.payer === 'claim') l.payer = 'customer'; });
    j.claim.history.unshift({ at: new Date().toISOString(), by: actorName(), status, note: str(body.note, 500) });
    log(j, `Claim ${status}${status === 'authorised' ? ` – ${au.money(j.claim.authorisedAmount)}` : ''}${body.note ? ': ' + str(body.note, 200) : ''}${status === 'declined' ? ' (all work moved to the customer)' : ''}`);
    save();
    return jobFull(j);
  });
  route('DELETE', '/api/jobcards/:id/claim', (req, q, p) => {
    const j = findJob(p.id);
    if (!j.claim) throw notFound('Claim');
    if (['invoiced', 'paid'].includes(j.claim.status)) throw conflict('The claim has been invoiced and cannot be removed');
    j.lines.forEach((l) => { delete l.payer; });
    log(j, `Claim removed (${j.claim.payer} ${j.claim.claimNo || ''})`);
    delete j.claim;
    save();
    return jobFull(j);
  });

  /* ---------- invoices ---------- */
  const brief = (i) => { settle(db(), i); const { lines, seller, ...rest } = i; return Object.assign(rest, { lineCount: lines.length, overdue: i.kind === 'invoice' && i.status === 'issued' && i.balance > 0.004 && i.dueAt && endOfDay(i.dueAt) < Date.now() }); };
  route('GET', '/api/invoices', (req, q) => {
    const d = db();
    const status = str(q.get('status'));
    const term = str(q.get('q')).toLowerCase().replace(/\s+/g, '');
    return d.invoices.map(brief).filter((i) => {
      if (term && ![i.id, i.jobId, i.rego, i.billTo.name, i.claimNo].join('|').toLowerCase().replace(/\s+/g, '').includes(term)) return false;
      if (!status) return true;
      if (status === 'unpaid') return i.kind === 'invoice' && i.status === 'issued' && i.balance > 0.004;
      if (status === 'overdue') return i.overdue;
      if (status === 'paid') return i.kind === 'invoice' && i.payStatus === 'paid';
      if (status === 'credit') return i.kind === 'credit' || i.status === 'credited';
      return true;
    });
  });
  route('GET', '/api/invoices/:id', (req, q, p) => {
    const d = db();
    const inv = d.invoices.find((i) => i.id === p.id);
    if (!inv) throw notFound('Invoice');
    settle(d, inv);
    const j = d.jobcards.find((x) => x.id === inv.jobId);
    return Object.assign({}, inv, { payments: d.payments.filter((x) => x.invoiceId === inv.id), jobStatus: j && j.status, gatePass: j && j.gatePass, requiresBuyerAbn: inv.kind === 'invoice' && inv.total >= 1000 && inv.payer === 'customer' });
  });
  route('GET', '/api/jobcards/:id/billing', (req, q, p) => {
    const d = db();
    const j = findJob(p.id);
    const invs = d.invoices.filter((i) => i.jobId === j.id).map(brief);
    return { invoices: invs, release: j.status === 'closed' ? releaseCheck(j) : null, gatePass: j.gatePass || null, claim: j.claim || null, methods: METHODS };
  });

  route('POST', '/api/invoices/:id/payments', (req, q, p, body) => {
    const d = db();
    const inv = d.invoices.find((i) => i.id === p.id);
    if (!inv) throw notFound('Invoice');
    if (inv.kind !== 'invoice' || inv.status !== 'issued') throw conflict('Payments can only be taken on a current tax invoice');
    settle(d, inv);
    const method = str(body.method);
    if (!METHODS.includes(method)) throw bad(`Payment method must be one of ${METHODS.join(', ')}`, { field: 'method' });
    const amount = r2(num(body.amount, { min: 0, max: 10000000 }));
    if (!(amount > 0)) throw bad('Amount must be more than $0', { field: 'amount' });
    if (amount > inv.balance + 0.004) throw conflict(`Amount is more than the balance owing (${au.money(inv.balance)})`);
    if (method === 'Cash' && Math.round(amount * 100) % 5 !== 0 && amount < inv.balance) { /* cash is rounded to 5c only on the final total */ }
    const rec = { id: seq(d, 'nextReceipt', 'RCT'), at: new Date().toISOString(), invoiceId: inv.id, kind: 'payment', method, amount, reference: str(body.reference, 60), reason: '', by: actorName() };
    d.payments.unshift(rec);
    settle(d, inv);
    const j = d.jobcards.find((x) => x.id === inv.jobId);
    if (j) {
      log(j, `Payment ${rec.id}: ${au.money(amount)} by ${method} on ${inv.id}${inv.balance > 0 ? ` – ${au.money(inv.balance)} still owing` : ' – paid in full'}`);
      if (j.claim && inv.payer !== 'customer' && inv.balance <= 0.004) { j.claim.status = 'paid'; j.claim.history.unshift({ at: rec.at, by: actorName(), status: 'paid', note: inv.id }); }
    }
    save();
    return Object.assign({}, inv, { receipt: rec });
  });
  route('POST', '/api/invoices/:id/refunds', (req, q, p, body) => {
    const d = db();
    const inv = d.invoices.find((i) => i.id === p.id);
    if (!inv) throw notFound('Invoice');
    settle(d, inv);
    const method = str(body.method);
    if (!METHODS.includes(method)) throw bad(`Refund method must be one of ${METHODS.join(', ')}`, { field: 'method' });
    const amount = r2(num(body.amount, { min: 0, max: 10000000 }));
    if (!(amount > 0)) throw bad('Amount must be more than $0', { field: 'amount' });
    if (amount > inv.paid + 0.004) throw conflict(`Only ${au.money(inv.paid)} has been paid on ${inv.id}`);
    const reason = str(body.reason, 200);
    if (!reason) throw bad('A reason is required for a refund', { field: 'reason' });
    const rec = { id: seq(d, 'nextReceipt', 'RCT'), at: new Date().toISOString(), invoiceId: inv.id, kind: 'refund', method, amount, reference: str(body.reference, 60), reason, by: actorName() };
    d.payments.unshift(rec);
    settle(d, inv);
    const j = d.jobcards.find((x) => x.id === inv.jobId);
    if (j) log(j, `Refund ${rec.id}: ${au.money(amount)} by ${method} on ${inv.id} – ${reason}`);
    save();
    return Object.assign({}, inv, { receipt: rec });
  });

  route('GET', '/api/payments', (req, q) => {
    const d = db();
    const from = q.get('from') ? new Date(q.get('from')) : null, to = q.get('to') ? new Date(q.get('to')) : null;
    return d.payments.filter((p) => (!from || new Date(p.at) >= from) && (!to || new Date(p.at) < to)).map((p) => {
      const inv = d.invoices.find((i) => i.id === p.invoiceId) || {};
      return Object.assign({}, p, { payer: inv.billTo ? inv.billTo.name : '', jobId: inv.jobId, rego: inv.rego });
    });
  });

  route('GET', '/api/debtors', () => {
    const d = db();
    const now = Date.now();
    const rows = new Map();
    for (const inv of d.invoices.filter((i) => i.kind === 'invoice' && i.status === 'issued')) {
      settle(d, inv);
      if (inv.balance <= 0.004) continue;
      const key = (inv.billTo.customerId || inv.billTo.name) + '|' + inv.payer;
      if (!rows.has(key)) rows.set(key, { name: inv.billTo.name, payer: inv.payer, phone: inv.billTo.phone, email: inv.billTo.email, current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0, total: 0, invoices: [] });
      const r = rows.get(key);
      const late = Math.floor((now - Date.parse(inv.dueAt || inv.issuedAt)) / 86400000);
      const bucket = late <= 0 ? 'current' : late <= 30 ? 'd30' : late <= 60 ? 'd60' : late <= 90 ? 'd90' : 'd90plus';
      r[bucket] = r2(r[bucket] + inv.balance);
      r.total = r2(r.total + inv.balance);
      r.invoices.push({ id: inv.id, balance: inv.balance, dueAt: inv.dueAt, daysOverdue: Math.max(0, late) });
    }
    const list = [...rows.values()].sort((a, b) => b.total - a.total);
    const tot = (k) => r2(list.reduce((s, r) => s + r[k], 0));
    return { rows: list, totals: { current: tot('current'), d30: tot('d30'), d60: tot('d60'), d90: tot('d90'), d90plus: tot('d90plus'), total: tot('total') } };
  });

  /* ---------- gate pass ---------- */
  route('POST', '/api/jobcards/:id/gatepass', (req, q, p, body) => {
    const d = db();
    const j = findJob(p.id);
    if (j.status !== 'closed') throw conflict('Close and invoice the job card before releasing the vehicle');
    if (j.gatePass) throw conflict(`Gate pass ${j.gatePass.number} was already issued`);
    const rc = releaseCheck(j);
    const override = !!body.override;
    if (!rc.ok) {
      if (!override) throw conflict(`${au.money(rc.owing)} is still owing on ${rc.invoices.join(', ')}. Take payment, or release on manager override.`, { owing: rc.owing });
      if (!ctx.can('billing.override')) throw Object.assign(new Error('Releasing an unpaid vehicle needs the right “Release unpaid vehicles”'), { status: 403 });
      if (!str(body.reason)) throw bad('A reason is required to release an unpaid vehicle', { field: 'reason' });
    }
    j.gatePass = { number: seq(d, 'nextGatePass', 'GP'), at: new Date().toISOString(), by: actorName(), override: !rc.ok, reason: str(body.reason, 200), owing: rc.owing, account: rc.account };
    j.stage = 'delivered';
    log(j, `Gate pass ${j.gatePass.number} issued – vehicle released${!rc.ok ? ` with ${au.money(rc.owing)} owing (override: ${j.gatePass.reason})` : rc.account && rc.owing > 0 ? ' on account' : ''}`);
    save();
    return jobFull(j);
  });

  return { issueForJob, creditForJob, releaseCheck, settle: (inv) => settle(db(), inv) };
}

/** Turn old-style job.invoice (number/total only) into proper invoice records. */
function migrate(db) {
  const helpers = { lineAmount: (l) => r2(l.qty * l.rate * (1 - (l.discountPct || 0) / 100)) };
  if (Array.isArray(db.invoices)) return false;
  ensure(db);
  for (const j of db.jobcards.filter((x) => x.status === 'closed' && x.invoice && !x.invoiceIds)) {
    const v = db.vehicles.find((x) => x.vin === j.vin) || { owner: {} };
    const lines = j.lines.filter((l) => l.status === 'approved').map((l) => {
      const net = r2(helpers.lineAmount(l));
      const taxPct = l.taxPct != null ? l.taxPct : 10;
      const gst = r2((net * taxPct) / 100);
      return { code: l.code, kind: l.kind, description: l.description, qty: l.qty, unitPrice: l.rate, discountPct: l.discountPct || 0, net, taxPct, gst, total: r2(net + gst), jobLineId: l.id };
    });
    const id = /^INV-\d{6}$/.test(j.invoice.number) ? j.invoice.number : `INV-${String(db.meta.nextInvoice++).padStart(6, '0')}`;
    const inv = { id, kind: 'invoice', jobId: j.id, vin: j.vin, rego: v.reg, vehicleDesc: [v.model, v.variant].filter(Boolean).join(' '), odometer: j.odometer, payer: 'customer',
      billTo: { name: v.owner.name, address: v.owner.address || '', abn: v.owner.abn || '', email: v.owner.email || '', phone: v.owner.phone || '', customerId: v.owner.customerId },
      issuedAt: j.invoice.at, dueAt: j.invoice.at, termsDays: 0, lines, status: 'issued', by: 'System', seller: sellerOf(db.workshop),
      subtotal: r2(lines.reduce((s, l) => s + l.net, 0)), gst: r2(lines.reduce((s, l) => s + l.gst, 0)), total: r2(lines.reduce((s, l) => s + l.total, 0)) };
    db.invoices.push(inv);
    db.payments.push({ id: `RCT-${String(db.meta.nextReceipt++).padStart(6, '0')}`, at: j.invoice.at, invoiceId: id, kind: 'payment', method: 'EFTPOS', amount: inv.total, reference: '', reason: '', by: 'System' });
    settle(db, inv);
    j.invoiceIds = [id];
    j.invoice = { number: id, at: j.invoice.at, total: inv.total, invoices: [{ id, payer: 'customer', total: inv.total }] };
    if (j.stage === 'delivered' && !j.gatePass) j.gatePass = { number: `GP-${String(db.meta.nextGatePass++).padStart(6, '0')}`, at: j.invoice.at, by: 'System', override: false, reason: '', owing: 0, account: false };
  }
  return true;
}

module.exports = { register, migrate, METHODS, CLAIM_STATUSES, ensure, settle };
