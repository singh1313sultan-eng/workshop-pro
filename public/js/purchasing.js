/* Workshop Pro – purchasing: purchase orders, reorder, supplier bills & payments, returns to supplier */
'use strict';

const PO_BADGE = { draft: ['Draft', 'b-slate'], sent: ['Sent', 'b-blue'], 'part-received': ['Part received', 'b-amber'], received: ['Received', 'b-green'], cancelled: ['Cancelled', 'b-slate'] };

async function purchaseOrdersPane() {
  const [pos, reorder] = await Promise.all([api('GET', '/purchase-orders'), api('GET', '/purchasing/reorder')]);
  const sugg = reorder.filter((r) => r.suggestQty > 0);
  return `${sugg.length && App.can('purchasing.order') ? `<div class="alert info" style="margin-bottom:12px">${ic('info')}<div style="flex:1"><b>${sugg.length} part(s)</b> are at or below their reorder level: ${sugg.slice(0, 4).map((r) => esc(r.description)).join(', ')}${sugg.length > 4 ? '…' : ''}</div><button class="btn sm primary" onclick="poModal(true)">Create order from suggestions</button></div>` : ''}
    <div class="row between wrap" style="gap:8px;margin-bottom:12px"><div class="muted small">Order parts from suppliers, then receive them with <b>Receive</b> on the order.</div>${App.can('purchasing.order') ? `<button class="btn sm primary" onclick="poModal(false)">${ic('plus', 'sm')}New purchase order</button>` : ''}</div>
    <div class="card" style="overflow:hidden">${pos.length ? `<div class="tbl-wrap"><table class="tbl rt"><thead><tr><th>Order</th><th>Supplier</th><th class="num">Lines</th><th class="num">Total incl GST</th><th>Status</th></tr></thead><tbody>
    ${pos.map((p) => `<tr class="click" onclick="poView('${esc(p.id)}')"><td class="lead" data-l="Order"><b>${esc(p.id)}</b><div class="small muted">${fmtDate(p.at)} · ${esc(p.by)}${p.expectedAt ? ' · due ' + fmtDate(p.expectedAt) : ''}</div></td><td data-l="Supplier">${esc(p.supplierName)}</td><td class="num" data-l="Lines">${p.lineCount}${p.outstanding && p.status !== 'cancelled' ? ` <span class="small muted">(${p.outstanding} to come)</span>` : ''}</td><td class="num" data-l="Total"><b>${money(p.total)}</b></td><td data-l="Status">${badge(PO_BADGE[p.status] || ['', ''])}</td></tr>`).join('')}
    </tbody></table></div>` : `<div class="empty"><div class="ic">${ic('clipboard', 'lg')}</div><h3>No purchase orders yet</h3><p>Create one from the reorder suggestions or from scratch.</p></div>`}</div>`;
}

async function payablesPane() {
  const [pay, inwards] = await Promise.all([api('GET', '/payables').catch(() => null), api('GET', '/stock/inwards')]);
  const t = pay ? pay.totals : null;
  return `${t ? `<div class="kpis" style="margin-bottom:14px"><div class="kpi"><div class="l">Owed to suppliers</div><div class="v">${money(t.total)}</div></div><div class="kpi"><div class="l">Overdue</div><div class="v" ${t.overdue ? 'style="color:var(--red)"' : ''}>${money(t.overdue)}</div></div><div class="kpi"><div class="l">Not yet due</div><div class="v">${money(t.current)}</div></div></div>` : ''}
    <div class="card" style="overflow:hidden"><div class="card-h"><h2>Supplier bills</h2><span class="small muted">each goods receipt is the supplier's tax invoice</span></div>${inwards.length ? `<div class="tbl-wrap"><table class="tbl rt"><thead><tr><th>Bill</th><th>Supplier</th><th class="num">Ex GST</th><th class="num">GST</th><th class="num">Total</th><th>Status</th></tr></thead><tbody>
    ${inwards.map((g) => { const bal = Math.round(((g.totalInc ?? g.total) - (g.credits || 0) - (g.paid || 0)) * 100) / 100; const overdue = bal > 0 && g.dueAt && new Date(g.dueAt) < new Date(); return `<tr class="click" onclick="billView('${esc(g.id)}')"><td class="lead" data-l="Bill"><b>${esc(g.invoiceNo)}</b><div class="small muted">${esc(g.id)} · ${fmtDate(g.invoiceDate)}${g.dueAt ? ' · due ' + fmtDate(g.dueAt) : ''}</div></td><td data-l="Supplier">${esc(g.supplier)}${g.poId ? `<div class="small muted">${esc(g.poId)}</div>` : ''}</td><td class="num" data-l="Ex GST">${money(g.total)}</td><td class="num" data-l="GST">${money(g.gst ?? 0)}</td><td class="num" data-l="Total"><b>${money(g.totalInc ?? g.total)}</b></td><td data-l="Status">${bal <= 0 ? badge(['Paid', 'b-green']) : overdue ? badge([money(bal) + ' overdue', 'b-red']) : badge([money(bal) + ' owing', 'b-amber'])}</td></tr>`; }).join('')}
    </tbody></table></div>` : '<div class="empty">No supplier bills yet.</div>'}</div>`;
}

async function poModal(fromSuggestions) {
  const [suppliers, parts, reorder] = await Promise.all([api('GET', '/masters/suppliers?active=true'), api('GET', '/masters/parts?active=true'), fromSuggestions ? api('GET', '/purchasing/reorder') : []]);
  const byNo = Object.fromEntries(parts.map((p) => [p.no, p]));
  const sugg = reorder.filter((r) => r.suggestQty > 0);
  const lines = sugg.length ? sugg.map((r) => ({ partNo: r.partNo, qty: r.suggestQty, unitCost: r.lastCost })) : [{ partNo: '', qty: '', unitCost: '' }];
  const supId = (sugg.find((r) => r.lastSupplierId) || {}).lastSupplierId || (suppliers[0] || {}).id || '';
  openModal({
    title: 'New purchase order',
    wide: true,
    body: `<div class="grid g2"><label class="f"><span>Supplier *</span><select class="inp" id="poS">${suppliers.map((s) => `<option value="${esc(s.id)}" ${s.id === supId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
      <label class="f"><span>Expected delivery</span><input class="inp" id="poE" type="date"></label>
      <label class="f" style="grid-column:1/-1"><span>Notes to supplier</span><input class="inp" id="poN"></label></div>
      <datalist id="dlPoParts">${parts.map((p) => `<option value="${esc(p.no)}">${esc(p.description)}</option>`).join('')}</datalist>
      <h3 style="margin:16px 0 8px">Parts</h3><div id="poL"></div>
      <div class="row between" style="margin-top:10px"><button class="btn sm" id="poAdd" type="button">${ic('plus', 'sm')}Add line</button><b id="poT"></b></div>`,
    foot: '<button class="btn" onclick="closeModal()">Cancel</button><button class="btn" id="poDraft">Save draft</button><button class="btn primary" id="poSend">Save & mark sent</button>',
  });
  const draw = () => {
    $('#poL').innerHTML = lines.map((l, i) => { const p = byNo[l.partNo]; return `<div class="row wrap" style="gap:8px;align-items:flex-end;padding:6px 0;border-top:1px solid var(--line-2)">
      <label class="f" style="flex:3;min-width:180px"><span>Part</span><input class="inp mono" list="dlPoParts" data-i="${i}" data-k="partNo" value="${esc(l.partNo)}"><span class="small muted" style="min-height:16px">${p ? `${esc(p.description)} · ${p.stock} in stock` : ''}</span></label>
      <label class="f" style="flex:1;min-width:80px"><span>Qty</span><input class="inp" type="number" min="0" data-i="${i}" data-k="qty" value="${esc(l.qty)}"><span style="min-height:16px"></span></label>
      <label class="f" style="flex:1;min-width:100px"><span>Unit cost ex GST</span><input class="inp" type="number" min="0" step="0.01" data-i="${i}" data-k="unitCost" value="${esc(l.unitCost)}"><span style="min-height:16px"></span></label>
      <button class="btn ghost sm icon" type="button" data-del="${i}" style="margin-bottom:20px" ${lines.length === 1 ? 'disabled' : ''}>${ic('trash', 'sm')}</button></div>`; }).join('');
    const sub = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitCost) || 0), 0);
    $('#poT').textContent = `${money(sub)} ex GST · ${money(sub * 1.1)} incl GST`;
    $$('#poL [data-k]').forEach((el) => (el.onchange = () => { const l = lines[Number(el.dataset.i)]; l[el.dataset.k] = el.dataset.k === 'partNo' ? el.value.trim().toUpperCase() : el.value; if (el.dataset.k === 'partNo' && byNo[l.partNo] && l.unitCost === '') l.unitCost = Math.round(byNo[l.partNo].mrp * 0.7 * 100) / 100; draw(); }));
    $$('#poL [data-del]').forEach((b) => (b.onclick = () => { lines.splice(Number(b.dataset.del), 1); draw(); }));
  };
  draw();
  $('#poAdd').onclick = () => { lines.push({ partNo: '', qty: '', unitCost: '' }); draw(); };
  const save = async (btn, send) => {
    $$('#poL input').forEach((el) => el.dispatchEvent(new Event('change')));
    const body = { supplierId: $('#poS').value, expectedAt: $('#poE').value || null, notes: $('#poN').value, lines: lines.filter((l) => l.partNo).map((l) => ({ partNo: l.partNo, qty: Number(l.qty), unitCost: Number(l.unitCost) })) };
    const po = await act(btn, () => api('POST', '/purchase-orders', body));
    if (!po) return;
    if (send) await act(null, () => api('POST', `/purchase-orders/${po.id}/send`, {}));
    closeModal(); toast(`${po.id} ${send ? 'saved and marked sent' : 'saved as draft'}`); App.go('#/stock?tab=orders'); App.refresh();
  };
  $('#poDraft').onclick = (e) => save(e.currentTarget, false);
  $('#poSend').onclick = (e) => save(e.currentTarget, true);
}

async function poView(id) {
  const po = await api('GET', '/purchase-orders/' + encodeURIComponent(id));
  const open = ['sent', 'part-received'].includes(po.status);
  openModal({
    title: `Purchase order ${po.id}`,
    wide: true,
    body: `<div class="row wrap" style="gap:8px;margin-bottom:12px">${badge(PO_BADGE[po.status])}<span class="badge b-slate">${esc(po.supplierName)}</span>${po.supplier?.accountNo ? `<span class="badge b-slate">Our account ${esc(po.supplier.accountNo)}</span>` : ''}${po.expectedAt ? `<span class="badge b-slate">Expected ${fmtDate(po.expectedAt)}</span>` : ''}</div>
      <div class="tbl-wrap"><table class="tbl rt"><thead><tr><th>Part</th><th class="num">Ordered</th><th class="num">Received</th><th class="num">Unit ex GST</th><th class="num">Amount</th></tr></thead><tbody>
      ${po.lines.map((l) => `<tr><td class="lead" data-l="Part"><b>${esc(l.description)}</b><div class="small muted mono">${esc(l.partNo)}</div></td><td class="num" data-l="Ordered">${l.qty} ${esc(l.unit || '')}</td><td class="num" data-l="Received">${l.receivedQty || 0}</td><td class="num" data-l="Unit">${money(l.unitCost)}</td><td class="num" data-l="Amount">${money(l.qty * l.unitCost)}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="totals" style="margin-top:10px;max-width:320px;margin-left:auto"><div class="r"><span>Ex GST</span><b>${money(po.subtotal)}</b></div><div class="r"><span>GST</span><b>${money(po.gst)}</b></div><div class="r t"><span>Total</span><span>${money(po.total)}</span></div></div>
      ${po.receipts.length ? `<div class="small" style="margin-top:10px"><b>Receipts:</b> ${po.receipts.map((r) => `${esc(r.id)} (inv ${esc(r.invoiceNo)}, ${fmtDate(r.at)})`).join(', ')}</div>` : ''}${po.notes ? `<div class="small muted" style="margin-top:6px">${esc(po.notes)}</div>` : ''}`,
    foot: `<div class="row wrap" style="gap:8px;margin-right:auto">${po.status === 'draft' && App.can('purchasing.order') ? `<button class="btn" id="pvSend">Mark sent</button>` : ''}${['draft', 'sent', 'part-received'].includes(po.status) && App.can('purchasing.order') ? `<button class="btn ghost" id="pvCancel">${po.status === 'part-received' ? 'Close short' : 'Cancel order'}</button>` : ''}<button class="btn ghost" onclick="window.print()">${ic('print', 'sm')}Print</button></div>
      ${open && App.can('stock.inward') ? `<button class="btn primary" id="pvRecv">${ic('box', 'sm')}Receive</button>` : '<button class="btn primary" onclick="closeModal()">Close</button>'}`,
  });
  $('#pvSend') && ($('#pvSend').onclick = async (e) => { if (await act(e.currentTarget, () => api('POST', `/purchase-orders/${po.id}/send`, {}), 'Marked sent')) { closeModal(); App.refresh(); } });
  $('#pvCancel') && ($('#pvCancel').onclick = async () => { if (await confirmBox(po.status === 'part-received' ? 'Close the order short?' : 'Cancel this order?', 'Remaining quantities will no longer be expected.', 'Yes', true)) { if (await act(null, () => api('POST', `/purchase-orders/${po.id}/cancel`, {}), 'Order updated')) App.refresh(); } });
  $('#pvRecv') && ($('#pvRecv').onclick = () => { closeModal(); inwardModal(null, po); });
}

async function billView(id) {
  const b = await api('GET', `/stock/inwards/${encodeURIComponent(id)}/bill`);
  const g = await api('GET', `/stock/inwards/${encodeURIComponent(id)}`);
  openModal({
    title: `Supplier bill ${b.invoiceNo}`,
    wide: true,
    body: `<dl class="kv" style="margin-bottom:12px"><div><dt>Supplier</dt><dd>${esc(b.supplier)}</dd></div><div><dt>Receipt</dt><dd>${esc(b.id)}${b.poId ? ' · ' + esc(b.poId) : ''}</dd></div><div><dt>Invoice date</dt><dd>${fmtDate(b.invoiceDate)}${b.dueAt ? ' · due ' + fmtDate(b.dueAt) : ''}</dd></div><div><dt>Total</dt><dd>${money(b.total)} + GST ${money(b.gst ?? 0)} = <b>${money(b.totalInc)}</b></dd></div><div><dt>Returned (credit)</dt><dd>${money(b.credits || 0)}</dd></div><div><dt>Paid</dt><dd>${money(b.paid || 0)}</dd></div><div><dt>Balance</dt><dd><b style="color:${b.balance > 0 ? 'var(--red)' : 'inherit'}">${money(b.balance)}</b></dd></div></dl>
      <div class="tbl-wrap"><table class="tbl rt"><thead><tr><th>Part</th><th class="num">Qty</th><th class="num">Left</th><th class="num">Unit</th>${App.can('purchasing.order') ? '<th class="num">Return qty</th>' : ''}</tr></thead><tbody>
      ${g.lines.map((l) => `<tr><td class="lead" data-l="Part"><b>${esc(l.description)}</b><div class="small muted mono">${esc(l.partNo)} · ${esc(l.batchId)}</div></td><td class="num" data-l="Qty">${l.qty}</td><td class="num" data-l="Left">${l.remaining}</td><td class="num" data-l="Unit">${money(l.unitCost)}</td>${App.can('purchasing.order') ? `<td class="num" data-l="Return"><input class="inp qty" style="width:80px" type="number" min="0" max="${l.remaining}" data-b="${esc(l.batchId)}" ${l.remaining ? '' : 'disabled'}></td>` : ''}</tr>`).join('')}
      </tbody></table></div>
      ${b.payments.length ? `<div class="small" style="margin-top:10px"><b>Payments:</b> ${b.payments.map((p) => `${esc(p.id)} ${money(p.amount)} by ${esc(p.method)} on ${fmtDate(p.at)}`).join('; ')}</div>` : ''}
      ${b.returns.length ? `<div class="small" style="margin-top:4px"><b>Returns:</b> ${b.returns.map((r) => `${esc(r.id)} ${money(r.totalInc)} (${esc(r.reason)})`).join('; ')}</div>` : ''}`,
    foot: `<div class="row wrap" style="gap:8px;margin-right:auto">${App.can('purchasing.order') ? `<select class="inp" id="rtnR" style="width:auto"><option value="">Return reason…</option><option>Wrong part supplied</option><option>Damaged in transit</option><option>Faulty / warranty</option><option>Ordered in error</option><option>Surplus stock</option></select><button class="btn" id="rtnGo">Return to supplier</button>` : ''}</div>
      ${b.balance > 0 && App.can('purchasing.pay') ? `<button class="btn primary" id="spPay">Pay ${money(b.balance)}</button>` : '<button class="btn primary" onclick="closeModal()">Close</button>'}`,
  });
  $('#rtnGo') && ($('#rtnGo').onclick = async (e) => {
    const lines = $$('#layer [data-b]').filter((x) => Number(x.value) > 0).map((x) => ({ batchId: x.dataset.b, qty: Number(x.value) }));
    const res = await act(e.currentTarget, () => api('POST', '/stock/returns', { inwardId: b.id, reason: $('#rtnR').value, lines }));
    if (res) { closeModal(); toast(`${res.id}: ${money(res.totalInc)} credit from ${res.supplier}`); App.refresh(); }
  });
  $('#spPay') && ($('#spPay').onclick = () => {
    openModal({ title: `Pay ${b.supplier}`, body: `<div class="grid g2"><label class="f">Amount ($)<input class="inp" id="spA" type="number" step="0.01" value="${b.balance.toFixed(2)}"></label><label class="f">Method<select class="inp" id="spM"><option>Bank transfer</option><option>BPAY</option><option>Credit card</option><option>Cheque</option><option>Cash</option></select></label><label class="f" style="grid-column:1/-1">Reference<input class="inp" id="spR" placeholder="e.g. EFT reference"></label></div>`, foot: '<button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="spOk">Record payment</button>' });
    $('#spOk').onclick = async (e) => { const r = await act(e.currentTarget, () => api('POST', `/stock/inwards/${b.id}/payments`, { amount: Number($('#spA').value), method: $('#spM').value, reference: $('#spR').value })); if (r) { closeModal(); toast(`${r.payment.id} recorded`); App.refresh(); } };
  });
}
