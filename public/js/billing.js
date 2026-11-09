/* Workshop Pro – billing (Australia): tax invoices, credit notes, payments, debtors, gate pass, claims, workshop profile */
'use strict';

const PAYER_BADGE = { customer: ['Customer', 'b-blue'], insurer: ['Insurer', 'b-violet'], manufacturer: ['Warranty', 'b-teal'] };
const PAY_BADGE = { paid: ['Paid', 'b-green'], 'part-paid': ['Part paid', 'b-amber'], unpaid: ['Unpaid', 'b-red'], credited: ['Credited', 'b-slate'], issued: ['Issued', 'b-slate'] };
const badge = ([t, c]) => `<span class="badge ${c}">${t}</span>`;
const CLAIM_STEPS = ['lodged', 'assessed', 'authorised', 'invoiced', 'paid'];

/* ================= job card: Billing tab ================= */
function tabBilling() {
  setTimeout(loadBillingPane, 0);
  return `<div id="billingPane"><div class="loading"><div class="skel"></div><div class="skel"></div></div></div>`;
}
async function loadBillingPane(tries = 0) {
  const el = $('#billingPane');
  if (!el) { if (tries < 20) setTimeout(() => loadBillingPane(tries + 1), 50); return; }
  let b;
  try { b = await api('GET', `/jobcards/${J.id}/billing`); } catch (e) { el.innerHTML = `<div class="alert err">${esc(e.message)}</div>`; return; }
  window.__bill = b;
  const closed = J.status === 'closed';
  const approved = J.lines.filter((l) => l.status === 'approved');
  const live = b.invoices.filter((i) => i.kind === 'invoice' && i.status === 'issued');
  const others = b.invoices.filter((i) => !(i.kind === 'invoice' && i.status === 'issued'));
  const invRow = (i) => `<div class="lrow" style="flex-wrap:wrap;gap:10px">
      <span class="vicon">${ic('receipt')}</span>
      <div class="grow" style="min-width:180px"><div class="t"><a href="#/invoices/${esc(i.id)}">${esc(i.id)}</a> ${badge(PAYER_BADGE[i.payer] || ['', ''])} ${i.kind === 'credit' ? badge(['Credit note', 'b-slate']) : badge(PAY_BADGE[i.payStatus] || ['', ''])}${i.overdue ? ' ' + badge(['Overdue', 'b-red']) : ''}</div>
        <div class="small muted">${esc(i.billTo.name)}${i.claimNo ? ' · claim ' + esc(i.claimNo) : ''} · ${fmtDT(i.issuedAt)}${i.kind === 'invoice' && i.status === 'issued' && i.termsDays ? ` · due ${fmtDate(i.dueAt)}` : ''}${i.creditFor ? ' · credits ' + esc(i.creditFor) : ''}${i.creditedBy ? ' · credited by ' + esc(i.creditedBy) : ''}</div></div>
      <div class="right"><b>${money(i.total)}</b>${i.kind === 'invoice' && i.status === 'issued' ? `<div class="small ${i.balance > 0 ? '' : 'muted'}" ${i.balance > 0 ? 'style="color:var(--red)"' : ''}>${i.balance > 0 ? money(i.balance) + ' owing' : 'paid'}</div>` : ''}</div>
      <div class="row" style="gap:6px">
        <a class="btn sm" href="#/invoices/${esc(i.id)}">${ic('print', 'sm')}View</a>
        ${i.kind === 'invoice' && i.status === 'issued' && i.balance > 0 && App.can('billing.payments') ? `<button class="btn sm primary" onclick="paymentModal('${esc(i.id)}', ${i.balance})">${ic('check', 'sm')}Take payment</button>` : ''}
        ${i.paid > 0 && App.can('billing.override') ? `<button class="btn sm ghost" onclick="refundModal('${esc(i.id)}', ${i.paid})">Refund</button>` : ''}
      </div></div>`;
  el.innerHTML = `<div class="split"><div class="stack">
      ${claimCard(b.claim, closed)}
      ${b.invoices.length ? `<div class="card" style="overflow:hidden"><div class="card-h"><h2>Tax invoices</h2><span class="small muted">${live.length} current</span></div>${live.map(invRow).join('')}${others.length ? `<details style="border-top:1px solid var(--line-2)"><summary class="small muted" style="padding:10px 16px;cursor:pointer">Credit notes and credited invoices (${others.length})</summary>${others.map(invRow).join('')}</details>` : ''}</div>` : ''}
      <div class="card" style="overflow:hidden"><div class="card-h"><h2>Approved work</h2><span class="small muted">${approved.length} line(s)</span></div>
        ${approved.length ? `<div class="tbl-wrap"><table class="tbl rt"><thead><tr><th>Description</th>${J.claim ? '<th>Paid by</th>' : ''}<th class="num">Qty</th><th class="num">Price ex GST</th><th class="num">Amount</th></tr></thead><tbody>
        ${approved.map((l) => `<tr><td class="lead" data-l="Item"><b>${esc(l.description)}</b><div class="small muted"><span class="mono">${esc(l.code)}</span> · ${l.kind === 'part' ? 'Part' : 'Labour'}${Number(l.taxPct ?? 10) ? '' : ' · GST-free'}</div></td>${J.claim ? `<td data-l="Paid by">${l.payer === 'customer' ? badge(['Customer', 'b-blue']) : badge([J.claim.type === 'insurance' ? 'Insurer' : 'Warranty', 'b-violet'])}</td>` : ''}<td data-l="Qty" class="num">${l.qty}</td><td data-l="Price" class="num">${money(l.rate)}</td><td data-l="Amount" class="num"><b>${money(l.amount)}</b></td></tr>`).join('')}</tbody></table></div>`
        : `<div class="empty">Nothing approved yet. Approve work on the <a href="#/jobs/${J.id}?tab=work">Work & estimate</a> tab.</div>`}
      </div></div>
    <div class="stack">
      <div class="card"><div class="card-h"><h3>${closed ? 'Invoiced' : 'Bill summary'}</h3></div><div class="card-b">${totalsHtml(J.billing)}${J.claim && J.claim.type === 'insurance' && J.claim.excess ? `<div class="small muted" style="margin-top:8px">The customer pays the ${money(J.claim.excess)} excess; ${esc(J.claim.payer)} pays the rest.</div>` : ''}</div></div>
      ${closed ? releaseCard(b) : `
      <div class="card"><div class="card-h"><h3>Quote</h3></div><div class="lrow"><span class="vicon">${ic('receipt')}</span><div class="grow"><div class="t">Customer quote</div><div class="small muted">${J.proforma ? `Prepared ${fmtDT(J.proforma.at)} · ${money(J.proforma.total)} incl. GST` : 'Not prepared yet'}</div></div>${App.can('billing.proforma') ? `<button class="btn sm" onclick="jobCall(this,'POST','/proforma',null,'Quote prepared')">${J.proforma ? 'Update' : 'Prepare'}</button>` : ''}${J.proforma ? `<button class="btn sm ghost" onclick="printJob(false)">${ic('print', 'sm')}</button>` : ''}</div></div>
      ${App.can('jobs.close') ? `<button class="btn primary lg" onclick="statusModal('close')">${ic('check')}Close & issue tax invoice</button>` : ''}`}
    </div></div>`;
}

function releaseCard(b) {
  const gp = b.gatePass, r = b.release || {};
  if (gp) return `<div class="card"><div class="card-h"><h3>Vehicle released</h3>${badge(['Gate pass', 'b-green'])}</div><div class="card-b"><dl class="kv"><div><dt>Gate pass</dt><dd class="mono">${esc(gp.number)}</dd></div><div><dt>Released</dt><dd>${fmtDT(gp.at)} · ${esc(gp.by)}</dd></div>${gp.override ? `<div><dt>Override</dt><dd style="color:var(--red)">${money(gp.owing)} owing – ${esc(gp.reason)}</dd></div>` : ''}${gp.account && gp.owing > 0 ? '<div><dt>Account</dt><dd>Released on account</dd></div>' : ''}</dl>
    <button class="btn sm" style="margin-top:10px" onclick="printGatePass()">${ic('print', 'sm')}Print gate pass</button></div></div>`;
  return `<div class="card"><div class="card-h"><h3>Release vehicle</h3>${r.ok ? badge(['Ready', 'b-green']) : badge([money(r.owing) + ' owing', 'b-red'])}</div><div class="card-b">
    <p class="small muted" style="margin-top:0">${r.ok ? (r.owing > 0 ? 'Account customer – the vehicle can be released and the invoice paid on terms.' : 'All customer invoices are paid.') : 'Take payment before the vehicle leaves, or release it on manager override.'}</p>
    ${App.can('billing.payments') ? `<button class="btn ${r.ok ? 'primary' : ''}" onclick="gatePassModal(${r.ok}, ${r.owing || 0})">${ic('check', 'sm')}Issue gate pass</button>` : ''}</div></div>`;
}

function claimCard(c, closed) {
  if (!c) {
    if (closed || !App.can('jobs.edit')) return '';
    const hint = /accident/i.test(J.jobType) ? 'Accident repair – record the insurer and claim number so they are billed.' : /warranty/i.test(J.jobType) ? 'Warranty repair – record the claim so the manufacturer is billed.' : 'Billed to an insurer or the manufacturer? Record the claim.';
    return `<div class="card"><div class="lrow"><span class="vicon">${ic('shield')}</span><div class="grow"><div class="t">Insurance / warranty claim</div><div class="small muted">${hint}</div></div><button class="btn sm" onclick="claimModal()">${ic('plus', 'sm')}Add claim</button></div></div>`;
  }
  const idx = CLAIM_STEPS.indexOf(c.status);
  return `<div class="card"><div class="card-h"><h2>${c.type === 'insurance' ? 'Insurance claim' : 'Warranty claim'}</h2>${badge([c.status[0].toUpperCase() + c.status.slice(1), c.status === 'declined' ? 'b-red' : c.status === 'paid' ? 'b-green' : 'b-violet'])}</div><div class="card-b">
    <dl class="kv"><div><dt>${c.type === 'insurance' ? 'Insurer' : 'Billed to'}</dt><dd>${esc(c.payer)}</dd></div><div><dt>Claim no.</dt><dd class="mono">${esc(c.claimNo || '—')}</dd></div>
      ${c.type === 'insurance' ? `<div><dt>Excess (customer)</dt><dd>${money(c.excess || 0)}</dd></div><div><dt>Assessor</dt><dd>${esc(c.assessor || '—')}</dd></div>` : ''}
      <div><dt>Authorised</dt><dd>${c.authorisedAmount ? money(c.authorisedAmount) : '—'}${c.authorityNo ? ' · ' + esc(c.authorityNo) : ''}</dd></div></dl>
    ${c.status !== 'declined' ? `<div class="row" style="gap:4px;margin:12px 0;flex-wrap:wrap">${CLAIM_STEPS.map((s, i) => `<span class="badge ${i <= idx ? 'b-teal' : 'b-slate'}" style="opacity:${i <= idx ? 1 : 0.55}">${i + 1}. ${s}</span>`).join('')}</div>` : ''}
    ${c.notes ? `<p class="small" style="margin:6px 0">${esc(c.notes)}</p>` : ''}
    ${!closed && !['invoiced', 'paid'].includes(c.status) && App.can('jobs.edit') ? `<div class="row wrap" style="gap:6px">
      ${c.status === 'lodged' ? `<button class="btn sm" onclick="claimStatus('assessed')">Mark assessed</button>` : ''}
      ${['lodged', 'assessed'].includes(c.status) ? `<button class="btn sm primary" onclick="claimAuthorise()">Record authority</button>` : ''}
      ${c.status !== 'declined' ? `<button class="btn sm ghost" onclick="claimStatus('declined')">Declined</button>` : ''}
      <button class="btn sm ghost" onclick="claimModal()">${ic('edit', 'sm')}Edit</button>
      <button class="btn sm ghost" onclick="claimRemove()">${ic('trash', 'sm')}Remove</button></div>` : ''}
    ${(c.history || []).length ? `<details style="margin-top:10px"><summary class="small muted" style="cursor:pointer">History</summary>${c.history.map((h) => `<div class="small" style="padding:4px 0"><b>${esc(h.status)}</b> · ${fmtDT(h.at)} · ${esc(h.by)}${h.note ? ' – ' + esc(h.note) : ''}</div>`).join('')}</details>` : ''}
  </div></div>`;
}

function claimModal() {
  const c = J.claim || { type: /warranty/i.test(J.jobType) ? 'warranty' : 'insurance', excess: '' };
  const ins = (App.meta.lookups.insurers || []);
  openModal({
    title: J.claim ? 'Edit claim' : 'Add claim',
    body: `<div class="seg" id="clT" style="margin-bottom:14px"><button type="button" data-t="insurance" class="${c.type === 'insurance' ? 'on' : ''}">Insurance</button><button type="button" data-t="warranty" class="${c.type === 'warranty' ? 'on' : ''}">Manufacturer warranty</button></div>
      <div class="grid g2">
        <label class="f cl-ins"><span>Insurer <span style="color:var(--red)">*</span></span><select class="inp" id="clIns"><option value="">Select…</option>${ins.map((n) => `<option ${n === c.payer ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
        <label class="f cl-war"><span>Billed to</span><input class="inp" id="clPayer" value="${esc(c.type === 'warranty' ? c.payer || 'Isuzu Australia Limited' : 'Isuzu Australia Limited')}"></label>
        <label class="f"><span>Claim number <span class="cl-ins" style="color:var(--red)">*</span></span><input class="inp" id="clNo" value="${esc(c.claimNo || '')}" style="text-transform:uppercase"></label>
        <label class="f cl-ins"><span>Excess paid by customer ($)</span><input class="inp" id="clEx" type="number" min="0" step="0.01" value="${esc(c.excess ?? '')}"></label>
        <label class="f cl-ins"><span>Assessor</span><input class="inp" id="clAs" value="${esc(c.assessor || '')}"></label>
        <label class="f" style="grid-column:1/-1"><span>Notes</span><textarea class="inp" id="clNotes">${esc(c.notes || '')}</textarea></label>
      </div>
      <div class="small muted" style="margin-top:8px">All work on the job is charged to the claim. Mark lines the customer pays for on the Work & estimate tab.</div>`,
    foot: '<button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="clSave">Save claim</button>',
  });
  let type = c.type;
  const sync = () => { $$('#clT button').forEach((b) => b.classList.toggle('on', b.dataset.t === type)); $$('.cl-ins').forEach((x) => (x.style.display = type === 'insurance' ? '' : 'none')); $$('.cl-war').forEach((x) => (x.style.display = type === 'warranty' ? '' : 'none')); };
  $$('#clT button').forEach((b) => (b.onclick = () => { type = b.dataset.t; sync(); }));
  sync();
  $('#clSave').onclick = async (e) => {
    const insName = $('#clIns').value;
    const body = { type, claimNo: $('#clNo').value, notes: $('#clNotes').value, assessor: $('#clAs').value, excess: $('#clEx').value || 0, payer: type === 'insurance' ? insName : $('#clPayer').value };
    if (await jobCall(e.currentTarget, 'PUT', '/claim', body, 'Claim saved')) App.go(`#/jobs/${J.id}?tab=billing`);
  };
}
function claimStatus(status) {
  if (status !== 'declined') return jobCall(null, 'POST', '/claim/status', { status }, 'Claim updated');
  openModal({ title: 'Claim declined', body: `<p class="muted" style="margin-top:0">All work will be moved to the customer.</p><label class="f">Reason<textarea class="inp" id="cdN"></textarea></label>`, foot: '<button class="btn" onclick="closeModal()">Cancel</button><button class="btn danger" id="cdOk">Mark declined</button>' });
  $('#cdOk').onclick = (e) => jobCall(e.currentTarget, 'POST', '/claim/status', { status: 'declined', note: $('#cdN').value }, 'Claim declined');
}
function claimAuthorise() {
  const est = J.lines.filter((l) => l.status !== 'declined' && l.payer !== 'customer').reduce((s, l) => s + l.amount * (1 + (Number(l.taxPct ?? 10) / 100)), 0);
  openModal({ title: 'Record authority', body: `<div class="grid g2"><label class="f">Authorised amount incl. GST ($)<input class="inp" id="caA" type="number" min="0" step="0.01" value="${(Math.round(est * 100) / 100).toFixed(2)}"></label><label class="f">Authority number<input class="inp" id="caN" style="text-transform:uppercase"></label></div>`, foot: '<button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="caOk">Authorised</button>' });
  $('#caOk').onclick = (e) => jobCall(e.currentTarget, 'POST', '/claim/status', { status: 'authorised', authorisedAmount: Number($('#caA').value), authorityNo: $('#caN').value }, 'Authority recorded');
}
async function claimRemove() {
  if (await confirmBox('Remove claim?', 'All work goes back to the customer.', 'Remove', true)) jobCall(null, 'DELETE', '/claim', null, 'Claim removed');
}

/* ---------- payments ---------- */
function paymentModal(invId, balance) {
  const methods = window.__bill?.methods || ['EFTPOS', 'Credit card', 'Cash', 'Bank transfer', 'PayID', 'BPAY', 'Cheque'];
  openModal({
    title: `Take payment · ${invId}`,
    body: `<div class="alert info" style="margin-bottom:12px">${ic('info')}<div>Balance owing <b>${money(balance)}</b>.</div></div>
      <div class="seg" id="pyM" style="flex-wrap:wrap;margin-bottom:12px">${methods.map((m, i) => `<button type="button" data-m="${esc(m)}" class="${i === 0 ? 'on' : ''}">${esc(m)}</button>`).join('')}</div>
      <div class="grid g2"><label class="f">Amount ($)<input class="inp" id="pyA" type="number" min="0.01" step="0.01" value="${balance.toFixed(2)}"></label>
      <label class="f">Reference <span class="hint">· terminal receipt, bank ref…</span><input class="inp" id="pyR"></label></div>
      <div class="small muted" id="pyCash" style="margin-top:8px;display:none"></div>`,
    foot: `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="pyOk">Record payment</button>`,
  });
  let method = methods[0];
  const cashHint = () => {
    const a = Number($('#pyA').value) || 0;
    const rounded = Math.round(a * 20) / 20; // cash is rounded to the nearest 5c
    $('#pyCash').style.display = method === 'Cash' ? '' : 'none';
    $('#pyCash').textContent = method === 'Cash' && rounded !== a ? `Cash rounding: customer hands over ${money(rounded)} (nearest 5c). Record ${money(a)}.` : 'Cash payment.';
  };
  $$('#pyM button').forEach((b) => (b.onclick = () => { method = b.dataset.m; $$('#pyM button').forEach((x) => x.classList.toggle('on', x === b)); cashHint(); }));
  $('#pyA').oninput = cashHint;
  $('#pyOk').onclick = async (e) => {
    const res = await act(e.currentTarget, () => api('POST', `/invoices/${invId}/payments`, { method, amount: Number($('#pyA').value), reference: $('#pyR').value }));
    if (res) { closeModal(); toast(`${res.receipt.id}: ${money(res.receipt.amount)} received${res.balance > 0 ? ` – ${money(res.balance)} still owing` : ' – paid in full'}`); App.updateBadges(); App.refresh(); }
  };
}
function refundModal(invId, paid) {
  const methods = window.__bill?.methods || ['EFTPOS', 'Credit card', 'Cash', 'Bank transfer', 'PayID'];
  openModal({
    title: `Refund · ${invId}`,
    body: `<div class="grid g2"><label class="f">Amount ($)<input class="inp" id="rfA" type="number" min="0.01" step="0.01" max="${paid}" value="${paid.toFixed(2)}"></label>
      <label class="f">Refund method<select class="inp" id="rfM">${methods.map((m) => `<option>${esc(m)}</option>`).join('')}</select></label>
      <label class="f" style="grid-column:1/-1">Reason<input class="inp" id="rfR" placeholder="e.g. Overpaid, goodwill"></label></div>`,
    foot: '<button class="btn" onclick="closeModal()">Cancel</button><button class="btn danger" id="rfOk">Record refund</button>',
  });
  $('#rfOk').onclick = async (e) => {
    const res = await act(e.currentTarget, () => api('POST', `/invoices/${invId}/refunds`, { method: $('#rfM').value, amount: Number($('#rfA').value), reason: $('#rfR').value }));
    if (res) { closeModal(); toast(`Refund ${res.receipt.id} recorded`); App.refresh(); }
  };
}
function gatePassModal(ok, owing) {
  const canOverride = App.can('billing.override');
  openModal({
    title: 'Issue gate pass',
    body: ok ? `<p style="margin-top:0">The vehicle can be released to the customer.</p>`
      : `<div class="alert err" style="margin-bottom:12px">${ic('alert')}<div><b>${money(owing)}</b> is still owing. Take payment first${canOverride ? ', or release on manager override' : ''}.</div></div>${canOverride ? `<label class="f">Override reason<input class="inp" id="gpR" placeholder="e.g. Fleet customer – PO to follow"></label>` : ''}`,
    foot: `<button class="btn" onclick="closeModal()">Cancel</button>${ok || canOverride ? `<button class="btn ${ok ? 'primary' : 'danger'}" id="gpOk">${ok ? 'Issue gate pass' : 'Release with money owing'}</button>` : ''}`,
  });
  $('#gpOk') && ($('#gpOk').onclick = (e) => jobCall(e.currentTarget, 'POST', '/gatepass', ok ? {} : { override: true, reason: $('#gpR').value }, 'Gate pass issued – vehicle released'));
}
function printGatePass() {
  const gp = J.gatePass, v = J.vehicle || {}, w = App.meta.workshop;
  const win = window.open('', '_blank');
  win.document.write(`<!doctype html><title>${esc(gp.number)}</title><style>body{font:14px system-ui;margin:40px;color:#0f172a}h1{margin:0 0 4px}dl{display:grid;grid-template-columns:160px 1fr;gap:8px 16px}dt{color:#64748b}.box{border:2px dashed #0f766e;padding:24px;border-radius:12px;max-width:560px}</style>
    <div class="box"><h1>Gate pass ${esc(gp.number)}</h1><div style="color:#64748b;margin-bottom:16px">${esc(w.name)} · ${esc(w.address)}, ${esc(w.suburb)} ${esc(w.state)} ${esc(w.postcode)}</div>
    <dl><dt>Vehicle</dt><dd><b>${esc(v.reg)}</b> ${esc(v.model)} ${esc(v.variant)}</dd><dt>VIN</dt><dd>${esc(v.vin)}</dd><dt>Owner</dt><dd>${esc(v.owner?.name)}</dd><dt>Job card</dt><dd>${esc(J.id)}</dd><dt>Released</dt><dd>${new Date(gp.at).toLocaleString('en-AU')} by ${esc(gp.by)}</dd>${gp.override ? `<dt>Override</dt><dd>${money(gp.owing)} owing – ${esc(gp.reason)}</dd>` : ''}</dl>
    <p style="margin-top:32px">Security / gate: ____________________ &nbsp; Time out: ________</p></div><script>print()<\/script>`);
  win.document.close();
}

/* ================= printable tax invoice ================= */
App.route('/invoices/:id', async ({ id }) => {
  const inv = await api('GET', '/invoices/' + encodeURIComponent(id));
  const s = inv.seller, credit = inv.kind === 'credit';
  const gstFree = inv.lines.some((l) => !Number(l.taxPct));
  const logo = App.meta.workshop.logo;
  return {
    title: credit ? `Adjustment note ${inv.id}` : `Tax invoice ${inv.id}`,
    nav: 'billing',
    back: inv.jobId ? `#/jobs/${inv.jobId}?tab=billing` : '#/billing',
    html: `<div class="row wrap noprint" style="gap:8px;margin-bottom:14px">
        <button class="btn primary" onclick="window.print()">${ic('print', 'sm')}Print / save PDF</button>
        ${inv.kind === 'invoice' && inv.status === 'issued' && inv.balance > 0 && App.can('billing.payments') ? `<button class="btn" onclick="paymentModal('${esc(inv.id)}', ${inv.balance})">${ic('check', 'sm')}Take payment</button>` : ''}
        ${inv.billTo.email ? `<button class="btn" onclick="sendDocModal('invoice','${esc(inv.id)}')">${ic('mail', 'sm')}Email to ${esc(inv.billTo.email)}</button>` : ''}
        ${inv.requiresBuyerAbn && !inv.billTo.abn && /pty|ltd|limited|trust|& co/i.test(inv.billTo.name) ? `<span class="badge b-amber">Business customer over $1,000 – add their ABN to the customer record</span>` : ''}
      </div>
      <article class="taxdoc">
        <header class="td-h"><div>${logo ? `<img src="${logo}" alt="" style="max-height:56px;max-width:200px;margin-bottom:8px">` : ''}<div class="td-seller">${esc(s.legalName)}</div><div class="small">${esc(s.name !== s.legalName ? 'Trading as ' + s.name : '')}</div>
          <div class="small">${esc(s.address)}</div><div class="small">${esc(s.phone)} · ${esc(s.email)}</div><div class="small"><b>ABN ${esc(s.abn)}</b>${s.mvrl ? ' · ' + esc(s.mvrl) : ''}</div></div>
          <div class="right"><h1 class="td-title">${credit ? 'Adjustment note' : 'Tax invoice'}</h1><div class="mono" style="font-size:16px">${esc(inv.id)}</div>
          <div class="small">Date: ${fmtDate(inv.issuedAt)}</div>${!credit && inv.termsDays ? `<div class="small">Due: ${fmtDate(inv.dueAt)} (${inv.termsDays} days)</div>` : ''}${credit ? `<div class="small">Adjusts tax invoice ${esc(inv.creditFor)}</div>` : ''}
          ${inv.status === 'credited' ? '<div class="badge b-red" style="margin-top:6px">CREDITED – see ' + esc(inv.creditedBy) + '</div>' : ''}</div></header>
        <section class="td-parties"><div><div class="td-lbl">Bill to</div><b>${esc(inv.billTo.name)}</b>${inv.billTo.abn ? `<div class="small">ABN ${esc(inv.billTo.abn)}</div>` : ''}<div class="small">${esc(inv.billTo.address || '')}</div>${inv.claimNo ? `<div class="small">Claim no. ${esc(inv.claimNo)}</div>` : ''}</div>
          <div><div class="td-lbl">Vehicle</div><b>${esc(inv.rego)}</b> ${esc(inv.vehicleDesc || '')}<div class="small mono">VIN ${esc(inv.vin)}</div><div class="small">Odometer ${Number(inv.odometer || 0).toLocaleString('en-AU')} km · Job ${esc(inv.jobId)}</div></div></section>
        <table class="td-tbl"><thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit ex GST</th><th class="num">Amount ex GST</th><th class="num">GST</th><th class="num">Total</th></tr></thead><tbody>
          ${inv.lines.map((l) => `<tr><td>${esc(l.description)}${!Number(l.taxPct) ? ' *' : ''}<div class="small muted mono">${esc(l.code)}</div></td><td class="num">${l.qty}</td><td class="num">${money(l.unitPrice)}${l.discountPct ? `<div class="small muted">less ${l.discountPct}%</div>` : ''}</td><td class="num">${money(l.net)}</td><td class="num">${money(l.gst)}</td><td class="num">${money(l.total)}</td></tr>`).join('')}
        </tbody></table>
        <div class="td-foot"><div class="small td-notes">${gstFree ? '<div>* GST-free item</div>' : ''}${!credit ? `<div class="td-lbl" style="margin-top:6px">How to pay</div><div>EFTPOS / card / cash at the counter${s.bsb ? `<br>Bank transfer: ${esc(s.accountName)} · BSB ${esc(s.bsb)} · Acc ${esc(s.accountNo)}` : ''}${s.payId ? `<br>PayID: ${esc(s.payId)}` : ''}<br>Reference: ${esc(inv.id)}</div>` : `<div>Reason: ${esc(inv.reason || '')}</div>`}<div style="margin-top:8px">${esc(s.terms || '')}</div></div>
          <div class="td-tot"><div><span>Subtotal (ex GST)</span><span>${money(inv.subtotal)}</span></div><div><span>GST</span><span>${money(inv.gst)}</span></div><div class="big"><span>Total ${credit ? 'credit' : 'incl. GST'}</span><span>${money(inv.total)}</span></div>
          ${!credit ? `<div><span>Paid</span><span>${money(inv.paid)}</span></div><div class="big"><span>Balance due</span><span>${money(Math.max(0, inv.balance))}</span></div>` : ''}<div class="small muted" style="text-align:right">Total price includes GST of ${money(inv.gst)}</div></div></div>
        ${inv.payments.length ? `<div class="small" style="margin-top:12px"><div class="td-lbl">Payments</div>${inv.payments.map((p) => `<div>${fmtDate(p.at)} · ${esc(p.id)} · ${p.kind === 'refund' ? 'Refund' : 'Payment'} by ${esc(p.method)} ${money(p.kind === 'refund' ? -p.amount : p.amount)}${p.reference ? ' · ' + esc(p.reference) : ''}</div>`).join('')}</div>` : ''}
      </article>`,
  };
});

/* ================= Invoices & payments page ================= */
App.route('/billing', async (p, q) => {
  const tab = q.get('tab') || 'invoices';
  const st = (App.ui.billing = App.ui.billing || { status: 'unpaid', q: '' });
  const data = tab === 'invoices' ? await api('GET', `/invoices?status=${st.status}&q=${encodeURIComponent(st.q)}`) : tab === 'payments' ? await api('GET', '/payments') : await api('GET', '/debtors');
  const tabs = [['invoices', 'Invoices', 'receipt'], ['payments', 'Payments', 'check'], ['debtors', 'Debtors', 'alert']].map(([k, l, i]) => `<button class="${tab === k ? 'on' : ''}" onclick="App.go('#/billing${k === 'invoices' ? '' : '?tab=' + k}')">${ic(i, 'sm')}${l}</button>`).join('');
  let body = '';
  if (tab === 'invoices') {
    body = `<div class="row wrap" style="gap:10px;margin-bottom:12px"><label class="gsearch" style="display:flex;width:min(320px,100%)">${ic('search', 'sm')}<input id="bQ" placeholder="Invoice, rego, customer, claim…" value="${esc(st.q)}"></label>
      <div class="seg">${[['unpaid', 'Unpaid'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['credit', 'Credits'], ['', 'All']].map(([v, l]) => `<button class="${st.status === v ? 'on' : ''}" onclick="App.ui.billing.status='${v}';App.refresh()">${l}</button>`).join('')}</div></div>
      <div class="card" style="overflow:hidden">${data.length ? `<div class="tbl-wrap"><table class="tbl rt"><thead><tr><th>Invoice</th><th>Bill to</th><th>Vehicle</th><th class="num">Total</th><th class="num">Balance</th><th>Status</th></tr></thead><tbody>
      ${data.map((i) => `<tr class="click" onclick="App.go('#/invoices/${esc(i.id)}')"><td class="lead" data-l="Invoice"><b>${esc(i.id)}</b><div class="small muted">${fmtDate(i.issuedAt)}${i.kind === 'invoice' && i.termsDays ? ' · due ' + fmtDate(i.dueAt) : ''}</div></td>
        <td data-l="Bill to">${esc(i.billTo.name)} ${badge(PAYER_BADGE[i.payer] || ['', ''])}</td><td data-l="Vehicle">${esc(i.rego)}<div class="small muted">${esc(i.jobId)}</div></td>
        <td class="num" data-l="Total"><b>${money(i.total)}</b></td><td class="num" data-l="Balance">${i.kind === 'invoice' && i.status === 'issued' ? money(i.balance) : '—'}</td>
        <td data-l="Status">${i.kind === 'credit' ? badge(['Credit note', 'b-slate']) : badge(PAY_BADGE[i.payStatus] || ['', ''])}${i.overdue ? ' ' + badge(['Overdue', 'b-red']) : ''}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty"><div class="ic">${ic('receipt', 'lg')}</div><h3>No invoices here</h3><p>Tax invoices are issued when a job card is closed.</p></div>`}</div>`;
  } else if (tab === 'payments') {
    const byMethod = {};
    data.forEach((p) => { byMethod[p.method] = (byMethod[p.method] || 0) + (p.kind === 'refund' ? -p.amount : p.amount); });
    body = `<div class="kpis" style="margin-bottom:14px">${Object.entries(byMethod).filter(([m]) => m !== 'Transfer').map(([m, v]) => `<div class="kpi"><div class="l">${esc(m)}</div><div class="v">${money(v)}</div></div>`).join('') || '<div class="muted">No payments yet.</div>'}</div>
      <div class="card" style="overflow:hidden">${data.length ? `<div class="tbl-wrap"><table class="tbl rt"><thead><tr><th>Receipt</th><th>Paid by</th><th>Invoice</th><th>Method</th><th class="num">Amount</th></tr></thead><tbody>
      ${data.map((p) => `<tr class="click" onclick="App.go('#/invoices/${esc(p.invoiceId)}')"><td class="lead" data-l="Receipt"><b>${esc(p.id)}</b><div class="small muted">${fmtDT(p.at)} · ${esc(p.by)}</div></td><td data-l="Paid by">${esc(p.payer)}</td><td data-l="Invoice">${esc(p.invoiceId)}<div class="small muted">${esc(p.rego || '')}</div></td><td data-l="Method">${esc(p.method)}${p.reference ? `<div class="small muted">${esc(p.reference)}</div>` : ''}</td><td class="num" data-l="Amount"><b style="color:${p.kind === 'refund' ? 'var(--red)' : 'inherit'}">${p.kind === 'refund' ? '−' : ''}${money(p.amount)}</b>${p.reason ? `<div class="small muted">${esc(p.reason)}</div>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No payments yet.</div>'}</div>`;
  } else {
    const t = data.totals;
    body = `<div class="kpis" style="margin-bottom:14px">${[['Current', t.current], ['1–30 days', t.d30], ['31–60 days', t.d60], ['61–90 days', t.d90], ['90+ days', t.d90plus], ['Total owing', t.total]].map(([l, v]) => `<div class="kpi"><div class="l">${l}</div><div class="v" ${v > 0 && l.includes('days') ? 'style="color:var(--red)"' : ''}>${money(v)}</div></div>`).join('')}</div>
      <div class="card" style="overflow:hidden">${data.rows.length ? `<div class="tbl-wrap"><table class="tbl rt"><thead><tr><th>Debtor</th><th class="num">Current</th><th class="num">1–30</th><th class="num">31–60</th><th class="num">61–90</th><th class="num">90+</th><th class="num">Total</th></tr></thead><tbody>
      ${data.rows.map((r) => `<tr><td class="lead" data-l="Debtor"><b>${esc(r.name)}</b> ${badge(PAYER_BADGE[r.payer] || ['', ''])}<div class="small muted">${r.invoices.map((i) => `<a href="#/invoices/${esc(i.id)}">${esc(i.id)}</a>${i.daysOverdue ? ` (${i.daysOverdue}d)` : ''}`).join(', ')}</div></td>${['current', 'd30', 'd60', 'd90', 'd90plus'].map((k) => `<td class="num" data-l="${k}">${r[k] ? money(r[k]) : '—'}</td>`).join('')}<td class="num" data-l="Total"><b>${money(r.total)}</b></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Nobody owes money. 🎉</div>'}</div>`;
  }
  return {
    title: 'Invoices & payments',
    nav: 'billing',
    html: `<div class="tabs" style="margin-bottom:14px">${tabs}</div>${body}`,
    after() { const i = $('#bQ'); if (i) { let t; i.oninput = () => { clearTimeout(t); t = setTimeout(() => { st.q = i.value; App.refresh().then(() => { const n = $('#bQ'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }); }, 300); }; } },
  };
});

/* ================= Workshop profile (Settings) ================= */
async function workshopProfileModal() {
  const w = await api('GET', '/settings/workshop');
  const f = (k, label, attrs = '', span) => `<label class="f" ${span ? 'style="grid-column:1/-1"' : ''}><span>${label}</span><input class="inp" name="${k}" value="${esc(w[k] ?? '')}" ${attrs}></label>`;
  openModal({
    title: 'Workshop profile',
    wide: true,
    body: `<form id="wpF" class="grid g2" onsubmit="return false">
      ${f('name', 'Trading name *')}${f('legalName', 'Legal entity name *')}${f('abn', 'ABN *', 'inputmode="numeric"')}${f('mvrl', 'Repairer licence (e.g. MVRL)')}
      ${f('address', 'Street address *', '', true)}${f('suburb', 'Suburb *')}
      <label class="f"><span>State *</span><select class="inp" name="state">${['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'].map((s) => `<option ${w.state === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      ${f('postcode', 'Postcode *', 'inputmode="numeric" maxlength="4"')}${f('phone', 'Phone *', 'type="tel"')}${f('email', 'Email *', 'type="email"')}${f('website', 'Website')}
      ${f('labourRate', 'Labour rate / hour ex GST ($)', 'type="number" step="0.01"')}${f('quoteValidityDays', 'Quotes valid for (days)', 'type="number"')}
      <div style="grid-column:1/-1" class="td-lbl">Payment details shown on invoices</div>
      ${f('bankName', 'Bank')}${f('accountName', 'Account name')}${f('bsb', 'BSB', 'inputmode="numeric" placeholder="062-000"')}${f('accountNo', 'Account number')}${f('payId', 'PayID', '', true)}
      <label class="f" style="grid-column:1/-1"><span>Invoice terms</span><textarea class="inp" name="invoiceTerms" rows="3">${esc(w.invoiceTerms || '')}</textarea></label>
      <label class="f" style="grid-column:1/-1"><span>Logo <span class="hint">· PNG/JPG/SVG, under 300 KB</span></span><input type="file" id="wpLogo" accept="image/png,image/jpeg,image/svg+xml,image/webp">${w.logo ? `<img src="${w.logo}" alt="Current logo" style="max-height:48px;margin-top:6px">` : ''}</label>
    </form>`,
    foot: '<button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="wpSave">Save profile</button>',
  });
  let logo;
  $('#wpLogo').onchange = (e) => { const file = e.target.files[0]; if (!file) return; if (file.size > 300000) { toast('Logo must be under 300 KB', 'err'); e.target.value = ''; return; } const rd = new FileReader(); rd.onload = () => (logo = rd.result); rd.readAsDataURL(file); };
  $('#wpSave').onclick = async (e) => {
    const body = Object.fromEntries(new FormData($('#wpF')));
    delete body.logo;
    if (logo) body.logo = logo;
    const res = await act(e.currentTarget, () => api('PATCH', '/settings/workshop', body), 'Workshop profile saved');
    if (res) { closeModal(); await App.reloadMeta(); $('#wsName').textContent = res.name; App.refresh(); }
  };
}
