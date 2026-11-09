// Reports for an Australian workshop. Every report returns
//   { title, period, columns: [{ key, label, type: 'text'|'money'|'num'|'date'|'pct' }], rows, totals?, notes? }
// and can be downloaded as CSV with ?format=csv.

const au = require('./au');
const r2 = au.round2;

const REPORTS = {
  gst: { title: 'GST / BAS summary', group: 'Finance', desc: 'G1, G3, 1A, G11 and 1B for the period (accruals basis).' },
  sales: { title: 'Sales by day', group: 'Finance', desc: 'Tax invoices and credit notes issued, split into parts and labour.' },
  payments: { title: 'Payments received', group: 'Finance', desc: 'Money received by method – for banking and EFTPOS reconciliation.' },
  debtors: { title: 'Aged debtors', group: 'Finance', desc: 'Who owes money and for how long.' },
  purchases: { title: 'Purchases and returns', group: 'Finance', desc: 'Supplier bills and returns by supplier, with GST credits.' },
  jobs: { title: 'Job turnaround', group: 'Workshop', desc: 'Time from check-in to invoice, and whether the promised time was met.' },
  technicians: { title: 'Technician productivity', group: 'Workshop', desc: 'Labour hours sold, hours clocked and efficiency per technician.' },
  satisfaction: { title: 'Customer satisfaction', group: 'Workshop', desc: 'Average feedback scores per question and advisor.' },
  parts: { title: 'Parts sales and margin', group: 'Parts', desc: 'Parts issued to job cards with FIFO cost, sale value and margin.' },
  stock: { title: 'Stock valuation', group: 'Parts', desc: 'Stock on hand at FIFO cost (as at today).' },
  adjustments: { title: 'Stock adjustments', group: 'Parts', desc: 'Stock counts and write-offs with their value.' },
};

function period(q) {
  const now = new Date();
  const from = q.get('from') ? new Date(q.get('from')) : new Date(now.getFullYear(), now.getMonth(), 1);
  const toRaw = q.get('to') ? new Date(q.get('to')) : now;
  const to = new Date(toRaw); to.setHours(23, 59, 59, 999);
  if (isNaN(from) || isNaN(to)) throw Object.assign(new Error('from / to must be dates (YYYY-MM-DD)'), { status: 400 });
  if (from > to) throw Object.assign(new Error('from must be before to'), { status: 400 });
  return { from, to, label: `${from.toLocaleDateString('en-AU')} – ${to.toLocaleDateString('en-AU')}` };
}
const inP = (d, p) => { const t = new Date(d); return t >= p.from && t <= p.to; };
const day = (d) => new Date(d).toLocaleDateString('en-CA'); // YYYY-MM-DD in local time

function build(db, name, q) {
  const p = period(q);
  const invs = (db.invoices || []).filter((i) => inP(i.issuedAt, p));
  switch (name) {
    case 'gst': {
      // accruals basis: invoices / credit notes issued and supplier bills dated in the period
      const sales = invs.reduce((s, i) => s + i.total, 0);
      const gstFree = invs.reduce((s, i) => s + i.lines.filter((l) => !Number(l.taxPct)).reduce((t, l) => t + l.total, 0), 0);
      const gstSales = invs.reduce((s, i) => s + i.gst, 0);
      const bills = (db.stockInwards || []).filter((g) => inP(g.invoiceDate || g.at, p));
      const rets = (db.purchaseReturns || []).filter((r) => inP(r.at, p));
      const purchases = bills.reduce((s, g) => s + (g.totalInc != null ? g.totalInc : g.total), 0) - rets.reduce((s, r) => s + r.totalInc, 0);
      const gstPurch = bills.reduce((s, g) => s + (g.gst || 0), 0) - rets.reduce((s, r) => s + r.gst, 0);
      const rows = [
        { label: 'G1 Total sales (incl. GST)', code: 'G1', amount: r2(sales) },
        { label: 'G3 Other GST-free sales', code: 'G3', amount: r2(gstFree) },
        { label: '1A GST on sales', code: '1A', amount: r2(gstSales) },
        { label: 'G11 Non-capital purchases (incl. GST) – parts', code: 'G11', amount: r2(purchases) },
        { label: '1B GST on purchases – parts', code: '1B', amount: r2(gstPurch) },
        { label: 'Net GST payable (1A − 1B)', code: 'NET', amount: r2(gstSales - gstPurch) },
      ];
      return { title: REPORTS.gst.title, period: p.label, columns: [{ key: 'code', label: 'Label', type: 'text' }, { key: 'label', label: 'Description', type: 'text' }, { key: 'amount', label: 'Amount', type: 'money' }], rows,
        notes: ['Accruals basis: invoices and credit notes by issue date, supplier bills by invoice date.', 'Purchases only include parts bought through goods receipts. Add other business expenses (rent, power, tools) from your accounting system before lodging.', 'Check with your BAS agent or accountant before lodging.'] };
    }
    case 'sales': {
      const by = new Map();
      for (const i of invs) {
        const k = day(i.issuedAt);
        if (!by.has(k)) by.set(k, { date: k, invoices: 0, credits: 0, parts: 0, labour: 0, other: 0, net: 0, gst: 0, total: 0 });
        const r = by.get(k);
        r[i.kind === 'credit' ? 'credits' : 'invoices']++;
        for (const l of i.lines) r[l.kind === 'part' ? 'parts' : l.kind === 'labour' ? 'labour' : 'other'] = r2(r[l.kind === 'part' ? 'parts' : l.kind === 'labour' ? 'labour' : 'other'] + l.net);
        r.net = r2(r.net + i.subtotal); r.gst = r2(r.gst + i.gst); r.total = r2(r.total + i.total);
      }
      const rows = [...by.values()].sort((a, b) => a.date.localeCompare(b.date));
      const tot = (k) => r2(rows.reduce((s, r) => s + r[k], 0));
      return { title: REPORTS.sales.title, period: p.label, columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'invoices', label: 'Invoices', type: 'num' }, { key: 'credits', label: 'Credit notes', type: 'num' }, { key: 'parts', label: 'Parts ex GST', type: 'money' }, { key: 'labour', label: 'Labour ex GST', type: 'money' }, { key: 'other', label: 'Other ex GST', type: 'money' }, { key: 'net', label: 'Total ex GST', type: 'money' }, { key: 'gst', label: 'GST', type: 'money' }, { key: 'total', label: 'Total incl GST', type: 'money' }],
        rows, totals: { date: 'Total', invoices: rows.reduce((s, r) => s + r.invoices, 0), credits: rows.reduce((s, r) => s + r.credits, 0), parts: tot('parts'), labour: tot('labour'), other: tot('other'), net: tot('net'), gst: tot('gst'), total: tot('total') } };
    }
    case 'payments': {
      const ps = (db.payments || []).filter((x) => inP(x.at, p) && x.method !== 'Transfer');
      const methods = [...new Set(ps.map((x) => x.method))].sort();
      const by = new Map();
      for (const x of ps) {
        const k = day(x.at);
        if (!by.has(k)) by.set(k, Object.assign({ date: k, total: 0 }, Object.fromEntries(methods.map((m) => [m, 0]))));
        const r = by.get(k);
        const v = x.kind === 'refund' ? -x.amount : x.amount;
        r[x.method] = r2(r[x.method] + v); r.total = r2(r.total + v);
      }
      const rows = [...by.values()].sort((a, b) => a.date.localeCompare(b.date));
      return { title: REPORTS.payments.title, period: p.label, columns: [{ key: 'date', label: 'Date', type: 'date' }, ...methods.map((m) => ({ key: m, label: m, type: 'money' })), { key: 'total', label: 'Total', type: 'money' }],
        rows, totals: Object.assign({ date: 'Total' }, Object.fromEntries([...methods, 'total'].map((m) => [m, r2(rows.reduce((s, r) => s + r[m], 0))]))), notes: ['Refunds are shown as negative amounts.'] };
    }
    case 'debtors': {
      const now = Date.now();
      const rows = [];
      for (const i of (db.invoices || []).filter((x) => x.kind === 'invoice' && x.status === 'issued')) {
        const paid = (db.payments || []).filter((x) => x.invoiceId === i.id).reduce((s, x) => s + (x.kind === 'refund' ? -x.amount : x.amount), 0);
        const bal = r2(i.total - paid);
        if (bal <= 0.004) continue;
        const late = Math.max(0, Math.floor((now - Date.parse(i.dueAt || i.issuedAt)) / 86400000));
        rows.push({ invoice: i.id, date: day(i.issuedAt), debtor: i.billTo.name, payer: i.payer, rego: i.rego, due: day(i.dueAt || i.issuedAt), daysOverdue: late, balance: bal });
      }
      rows.sort((a, b) => b.daysOverdue - a.daysOverdue);
      return { title: REPORTS.debtors.title, period: 'As at today', columns: [{ key: 'invoice', label: 'Invoice', type: 'text' }, { key: 'date', label: 'Date', type: 'date' }, { key: 'debtor', label: 'Debtor', type: 'text' }, { key: 'payer', label: 'Type', type: 'text' }, { key: 'rego', label: 'Rego', type: 'text' }, { key: 'due', label: 'Due', type: 'date' }, { key: 'daysOverdue', label: 'Days overdue', type: 'num' }, { key: 'balance', label: 'Balance', type: 'money' }],
        rows, totals: { invoice: 'Total', balance: r2(rows.reduce((s, r) => s + r.balance, 0)) } };
    }
    case 'purchases': {
      const by = new Map();
      const row = (name) => { if (!by.has(name)) by.set(name, { supplier: name, bills: 0, net: 0, gst: 0, total: 0, returns: 0, paid: 0 }); return by.get(name); };
      for (const g of (db.stockInwards || []).filter((x) => inP(x.invoiceDate || x.at, p))) {
        const r = row(g.supplier);
        r.bills++; r.net = r2(r.net + g.total); r.gst = r2(r.gst + (g.gst || 0)); r.total = r2(r.total + (g.totalInc != null ? g.totalInc : g.total));
      }
      for (const x of (db.purchaseReturns || []).filter((y) => inP(y.at, p))) { const r = row(x.supplier); r.returns = r2(r.returns + x.totalInc); }
      for (const x of (db.supplierPayments || []).filter((y) => inP(y.at, p))) { const r = row(x.supplier); r.paid = r2(r.paid + x.amount); }
      const rows = [...by.values()].sort((a, b) => b.total - a.total);
      const tot = (k) => r2(rows.reduce((s, r) => s + r[k], 0));
      return { title: REPORTS.purchases.title, period: p.label, columns: [{ key: 'supplier', label: 'Supplier', type: 'text' }, { key: 'bills', label: 'Bills', type: 'num' }, { key: 'net', label: 'Ex GST', type: 'money' }, { key: 'gst', label: 'GST credit', type: 'money' }, { key: 'total', label: 'Total', type: 'money' }, { key: 'returns', label: 'Returns (credit)', type: 'money' }, { key: 'paid', label: 'Paid in period', type: 'money' }],
        rows, totals: { supplier: 'Total', bills: rows.reduce((s, r) => s + r.bills, 0), net: tot('net'), gst: tot('gst'), total: tot('total'), returns: tot('returns'), paid: tot('paid') } };
    }
    case 'jobs': {
      const rows = (db.jobcards || []).filter((j) => j.invoice && inP(j.invoice.at, p)).map((j) => {
        const v = (db.vehicles || []).find((x) => x.vin === j.vin) || {};
        const hours = r2((Date.parse(j.invoice.at) - Date.parse(j.arrivedAt)) / 3600000);
        return { job: j.id, rego: v.reg || '', type: j.jobType, advisor: j.advisor, technician: j.technician || '', arrived: day(j.arrivedAt), invoiced: day(j.invoice.at), hours, onTime: Date.parse(j.invoice.at) <= Date.parse(j.promisedAt) ? 'Yes' : 'No', total: j.invoice.total };
      });
      const onTime = rows.filter((r) => r.onTime === 'Yes').length;
      return { title: REPORTS.jobs.title, period: p.label, columns: [{ key: 'job', label: 'Job card', type: 'text' }, { key: 'rego', label: 'Rego', type: 'text' }, { key: 'type', label: 'Repair type', type: 'text' }, { key: 'advisor', label: 'Advisor', type: 'text' }, { key: 'technician', label: 'Technician', type: 'text' }, { key: 'arrived', label: 'Checked in', type: 'date' }, { key: 'invoiced', label: 'Invoiced', type: 'date' }, { key: 'hours', label: 'Hours in workshop', type: 'num' }, { key: 'onTime', label: 'On time', type: 'text' }, { key: 'total', label: 'Invoiced incl GST', type: 'money' }],
        rows, totals: { job: `${rows.length} jobs`, hours: rows.length ? r2(rows.reduce((s, r) => s + r.hours, 0) / rows.length) : 0, onTime: rows.length ? `${Math.round((onTime / rows.length) * 100)}%` : '—', total: r2(rows.reduce((s, r) => s + r.total, 0)) },
        notes: ['Hours in workshop (total row) is the average per job.'] };
    }
    case 'technicians': {
      const techs = (db.users || []).filter((u) => /technician/i.test(u.role));
      const labourMin = (code) => ((db.catalog.labour || []).find((l) => l.code === code) || {}).minutes || 0;
      const entries = (db.timeEntries || []).filter((t) => t.end && inP(t.start, p));
      const rows = techs.map((t) => {
        const jobs = (db.jobcards || []).filter((j) => j.technician === t.name && j.invoice && inP(j.invoice.at, p));
        const lines = jobs.flatMap((j) => j.lines.filter((l) => l.kind === 'labour' && l.status === 'approved'));
        const sold = r2(lines.reduce((s, l) => s + (labourMin(l.code) * l.qty) / 60, 0));
        const revenue = r2(lines.reduce((s, l) => s + l.qty * l.rate * (1 - (l.discountPct || 0) / 100), 0));
        const clocked = r2(entries.filter((e) => e.userId === t.id).reduce((s, e) => s + (Date.parse(e.end) - Date.parse(e.start)) / 3600000, 0));
        return { technician: t.name, jobs: jobs.length, soldHours: sold, clockedHours: clocked, efficiency: clocked ? Math.round((sold / clocked) * 100) : null, labourRevenue: revenue };
      });
      return { title: REPORTS.technicians.title, period: p.label, columns: [{ key: 'technician', label: 'Technician', type: 'text' }, { key: 'jobs', label: 'Jobs invoiced', type: 'num' }, { key: 'soldHours', label: 'Hours sold', type: 'num' }, { key: 'clockedHours', label: 'Hours clocked', type: 'num' }, { key: 'efficiency', label: 'Efficiency %', type: 'pct' }, { key: 'labourRevenue', label: 'Labour ex GST', type: 'money' }],
        rows, notes: ['Hours sold = standard time of the labour operations invoiced. Hours clocked come from technician time clocking on job cards. Efficiency = sold ÷ clocked.'] };
    }
    case 'satisfaction': {
      const qs = (db.lookups && db.lookups.feedbackQuestions) || [];
      const fbs = (db.jobcards || []).filter((j) => j.feedback && inP(j.feedback.at, p));
      const rows = qs.map((qn, i) => { const sc = fbs.map((j) => j.feedback.scores[i]).filter((x) => x > 0); return { item: qn, responses: sc.length, average: sc.length ? r2(sc.reduce((s, x) => s + x, 0) / sc.length) : null }; });
      const advisors = [...new Set(fbs.map((j) => j.advisor))];
      for (const a of advisors) { const sc = fbs.filter((j) => j.advisor === a).flatMap((j) => j.feedback.scores.filter((x) => x > 0)); rows.push({ item: `Advisor: ${a}`, responses: fbs.filter((j) => j.advisor === a).length, average: sc.length ? r2(sc.reduce((s, x) => s + x, 0) / sc.length) : null }); }
      return { title: REPORTS.satisfaction.title, period: p.label, columns: [{ key: 'item', label: 'Question / advisor', type: 'text' }, { key: 'responses', label: 'Responses', type: 'num' }, { key: 'average', label: 'Average (out of 5)', type: 'num' }], rows };
    }
    case 'parts': {
      const by = new Map();
      for (const x of (db.stockIssues || []).filter((y) => inP(y.at, p))) {
        const j = (db.jobcards || []).find((jj) => jj.id === x.jobId);
        const l = j && j.lines.find((ll) => ll.id === x.lineId);
        const part = (db.catalog.parts || []).find((pp) => pp.no === x.partNo) || {};
        if (!by.has(x.partNo)) by.set(x.partNo, { partNo: x.partNo, description: part.description || '', qty: 0, cost: 0, sale: 0 });
        const r = by.get(x.partNo);
        const sign = x.kind === 'issue' ? 1 : -1;
        r.qty = r2(r.qty + sign * x.qty);
        r.cost = r2(r.cost + sign * x.cost);
        const unitSale = l ? l.rate * (1 - (l.discountPct || 0) / 100) : part.mrp || 0;
        r.sale = r2(r.sale + sign * x.qty * unitSale);
      }
      const rows = [...by.values()].map((r) => Object.assign(r, { margin: r2(r.sale - r.cost), marginPct: r.sale ? Math.round(((r.sale - r.cost) / r.sale) * 100) : null })).sort((a, b) => b.sale - a.sale);
      const tot = (k) => r2(rows.reduce((s, r) => s + r[k], 0));
      return { title: REPORTS.parts.title, period: p.label, columns: [{ key: 'partNo', label: 'Part', type: 'text' }, { key: 'description', label: 'Description', type: 'text' }, { key: 'qty', label: 'Qty', type: 'num' }, { key: 'sale', label: 'Sale ex GST', type: 'money' }, { key: 'cost', label: 'FIFO cost', type: 'money' }, { key: 'margin', label: 'Margin', type: 'money' }, { key: 'marginPct', label: 'Margin %', type: 'pct' }],
        rows, totals: { partNo: 'Total', sale: tot('sale'), cost: tot('cost'), margin: tot('margin'), marginPct: tot('sale') ? Math.round((tot('margin') / tot('sale')) * 100) : null }, notes: ['Parts issued before stock tracking started have no cost and are not included.'] };
    }
    case 'stock': {
      const rows = (db.catalog.parts || []).map((pt) => {
        const bs = (db.stockBatches || []).filter((b) => b.partNo === pt.no && b.remaining > 0);
        const value = r2(bs.reduce((s, b) => s + b.remaining * b.unitCost, 0));
        return { partNo: pt.no, description: pt.description, category: pt.category, onHand: pt.stock, reorderLevel: pt.reorderLevel || 0, value, avgCost: pt.stock ? r2(value / pt.stock) : 0, sellPrice: pt.mrp };
      }).sort((a, b) => b.value - a.value);
      return { title: REPORTS.stock.title, period: 'As at today', columns: [{ key: 'partNo', label: 'Part', type: 'text' }, { key: 'description', label: 'Description', type: 'text' }, { key: 'category', label: 'Category', type: 'text' }, { key: 'onHand', label: 'On hand', type: 'num' }, { key: 'reorderLevel', label: 'Reorder at', type: 'num' }, { key: 'avgCost', label: 'Avg cost', type: 'money' }, { key: 'value', label: 'Value (FIFO)', type: 'money' }, { key: 'sellPrice', label: 'Sell ex GST', type: 'money' }],
        rows, totals: { partNo: 'Total', value: r2(rows.reduce((s, r) => s + r.value, 0)) } };
    }
    case 'adjustments': {
      const rows = (db.stockAdjustments || []).filter((a) => inP(a.at, p)).flatMap((a) => a.lines.filter((l) => l.qty !== 0).map((l) => ({ id: a.id, date: day(a.at), type: a.type === 'count' ? 'Stock count' : 'Write-off', reason: a.reason, partNo: l.partNo, qty: l.qty, value: l.value, by: a.by })));
      return { title: REPORTS.adjustments.title, period: p.label, columns: [{ key: 'id', label: 'Adjustment', type: 'text' }, { key: 'date', label: 'Date', type: 'date' }, { key: 'type', label: 'Type', type: 'text' }, { key: 'reason', label: 'Reason', type: 'text' }, { key: 'partNo', label: 'Part', type: 'text' }, { key: 'qty', label: 'Qty', type: 'num' }, { key: 'value', label: 'Value', type: 'money' }, { key: 'by', label: 'By', type: 'text' }],
        rows, totals: { id: 'Total', value: r2(rows.reduce((s, r) => s + r.value, 0)) } };
    }
    default:
      throw Object.assign(new Error('Report not found'), { status: 404 });
  }
}

function toCsv(rep) {
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [[rep.title], [rep.period], [], rep.columns.map((c) => c.label)];
  for (const r of rep.rows) lines.push(rep.columns.map((c) => r[c.key]));
  if (rep.totals) lines.push(rep.columns.map((c) => rep.totals[c.key] ?? ''));
  for (const n of rep.notes || []) lines.push([], [n]);
  return '﻿' + lines.map((l) => l.map(esc).join(',')).join('\r\n');
}

function register({ route, getDb }) {
  route('GET', '/api/reports', () => Object.entries(REPORTS).map(([key, r]) => Object.assign({ key }, r)));
  route('GET', '/api/reports/:name', (req, q, p) => {
    const rep = build(getDb(), p.name, q);
    if (q.get('format') === 'csv') return { __file: true, type: 'text/csv; charset=utf-8', name: `${p.name}-${new Date().toISOString().slice(0, 10)}.csv`, body: toCsv(rep) };
    return rep;
  });
}

module.exports = { register, build, REPORTS };
