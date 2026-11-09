/* Workshop Pro – parts stock: on hand (FIFO batches), stock inward (goods receipt), stock count and write-off */
'use strict';

App.route('/stock', async (p, q) => {
  const tab = q.get('tab') || 'onhand';
  const st = (App.ui.stock = App.ui.stock || { q: '', filter: '' });
  const [stock, inwards, adjustments] = await Promise.all([api('GET', '/stock'), api('GET', '/stock/inwards'), api('GET', '/stock/adjustments')]);
  window.__stock = stock;
  const extra = tab === 'orders' ? await purchaseOrdersPane() : tab === 'bills' ? await payablesPane() : '';
  const kpi = (l, v, s) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
  return {
    title: 'Parts stock',
    nav: 'stock',
    html: `
    <div class="row between wrap" style="gap:12px;margin-bottom:14px">
      <div style="max-width:720px"><h1>Parts stock</h1><div class="muted small" style="margin-top:4px">Stock comes in through goods receipts (inward) and goes out to job cards first-in, first-out: the oldest batch is always issued first and its cost goes to the job card.</div></div>
      <div class="row wrap" style="gap:8px">${App.can('stock.adjust') ? `<button class="btn" onclick="countSheet()">${ic('clipboard', 'sm')}Stock count</button><button class="btn" onclick="writeoffModal()">${ic('trash', 'sm')}Write off</button>` : ''}${App.can('stock.inward') ? `<button class="btn primary" onclick="inwardModal()">${ic('plus', 'sm')}New stock inward</button>` : ''}</div>
    </div>
    <div class="kpis" style="margin-bottom:16px">
      ${kpi('Stock value (FIFO cost)', money(stock.totals.value), `${stock.totals.parts} parts`)}
      ${kpi('Below reorder level', stock.totals.lowStock, 'parts to reorder')}
      ${kpi('Goods receipts', inwards.length, inwards[0] ? 'last ' + fmtDT(inwards[0].at) : 'none yet')}
    </div>
    <div class="tabs" style="margin-bottom:14px">
      <button class="${tab === 'onhand' ? 'on' : ''}" onclick="App.go('#/stock')">${ic('box', 'sm')}Stock on hand</button>
      <button class="${tab === 'inwards' ? 'on' : ''}" onclick="App.go('#/stock?tab=inwards')">${ic('clipboard', 'sm')}Goods receipts<span class="n">${inwards.length}</span></button>
      <button class="${tab === 'adjustments' ? 'on' : ''}" onclick="App.go('#/stock?tab=adjustments')">${ic('refresh', 'sm')}Adjustments<span class="n">${adjustments.length}</span></button>
      <button class="${tab === 'orders' ? 'on' : ''}" onclick="App.go('#/stock?tab=orders')">${ic('clipboard', 'sm')}Purchase orders</button>
      ${App.can('purchasing.pay') || App.can('stock.inward') ? `<button class="${tab === 'bills' ? 'on' : ''}" onclick="App.go('#/stock?tab=bills')">${ic('receipt', 'sm')}Supplier bills</button>` : ''}
    </div>
    ${tab === 'onhand' ? `
      <div class="row wrap" style="gap:10px;margin-bottom:12px">
        <label class="gsearch" style="display:flex;width:min(340px,100%)">${ic('search', 'sm')}<input id="skQ" placeholder="Search parts…" value="${esc(st.q)}"></label>
        <div class="seg">${[['', 'All'], ['low', 'Low stock'], ['out', 'Out of stock']].map(([v, l]) => `<button class="${st.filter === v ? 'on' : ''}" onclick="App.ui.stock.filter='${v}';drawStock()">${l}</button>`).join('')}</div>
      </div>
      <div class="card" style="overflow:hidden" id="skTable"></div>`
    : tab === 'adjustments' ? adjustmentsList(adjustments)
    : tab === 'orders' || tab === 'bills' ? extra
    : `<div class="card" style="overflow:hidden">${inwards.length ? `<div class="tbl-wrap"><table class="tbl rt"><thead><tr><th>Receipt</th><th>Supplier</th><th>Invoice</th><th class="num">Lines</th><th class="num">Value</th><th class="hide-sm"></th></tr></thead><tbody>
        ${inwards.map((g) => `<tr class="click" onclick="inwardView('${esc(g.id)}')"><td class="lead" data-l="Receipt"><b>${esc(g.id)}</b><div class="small muted">${fmtDT(g.at)} · ${esc(g.by)}</div></td><td data-l="Supplier">${esc(g.supplier)}</td><td data-l="Invoice"><span class="mono">${esc(g.invoiceNo)}</span><div class="small muted">${new Date(g.invoiceDate).toLocaleDateString('en-AU')}</div></td><td class="num" data-l="Lines">${g.lineCount} <span class="muted small">(${g.qty} qty)</span></td><td class="num" data-l="Value"><b>${money(g.total)}</b></td><td class="hide-sm" style="width:30px;color:var(--faint)">${ic('chevron', 'sm')}</td></tr>`).join('')}
        </tbody></table></div>` : `<div class="empty"><div class="ic">${ic('clipboard', 'lg')}</div><h3>No goods receipts yet</h3><p>Record parts received from a supplier with “New stock inward”. Opening stock was loaded as batches.</p></div>`}</div>`}`,
    after() {
      if (tab !== 'onhand') return;
      $('#skQ').addEventListener('input', (e) => { st.q = e.target.value; drawStock(); });
      drawStock();
    },
  };
});

function drawStock() {
  const st = App.ui.stock, t = st.q.toLowerCase().trim();
  const rows = window.__stock.rows
    .filter((r) => !t || [r.no, r.description, r.category].join(' ').toLowerCase().includes(t))
    .filter((r) => !st.filter || (st.filter === 'low' ? r.lowStock : r.onHand <= 0));
  $$('.seg button').forEach((b) => b.classList.toggle('on', b.getAttribute('onclick')?.includes(`'${st.filter}'`)));
  $('#skTable').innerHTML = rows.length
    ? `<div class="tbl-wrap"><table class="tbl rt"><thead><tr><th>Part</th><th class="num">On hand</th><th>FIFO</th><th class="num">Value</th><th class="hide-sm"></th></tr></thead><tbody>
      ${rows.map((r) => `<tr class="click" onclick="stockPart('${esc(r.no)}')">
        <td class="lead" data-l="Part"><b>${esc(r.description)}</b><div class="small muted"><span class="mono">${esc(r.no)}</span> · ${esc(r.category || '')}${r.active ? '' : ' · inactive'}</div></td>
        <td class="num" data-l="On hand"><b style="color:${r.lowStock ? 'var(--red)' : 'inherit'}">${r.onHand} ${esc(r.unit)}</b><div class="small ${r.lowStock ? '' : 'muted'}" ${r.lowStock ? 'style="color:var(--red)"' : ''}>${r.lowStock ? 'Below reorder level ' + r.reorderLevel : 'Reorder at ' + r.reorderLevel}</div>${r.reserved ? `<div class="small" style="color:var(--amber)">${r.reserved} reserved · ${r.available} free</div>` : ''}</td>
        <td data-l="FIFO">${r.batches ? `${r.batches} batch${r.batches === 1 ? '' : 'es'} · next @ ${money(r.nextCost)}<div class="small muted">oldest ${new Date(r.oldestBatch).toLocaleDateString('en-AU')}</div>` : '<span class="muted small">No stock</span>'}</td>
        <td class="num" data-l="Value"><b>${money(r.value)}</b>${r.onHand ? `<div class="small muted">avg ${money(r.avgCost)}</div>` : ''}</td>
        <td class="hide-sm" style="width:30px;color:var(--faint)">${ic('chevron', 'sm')}</td></tr>`).join('')}
      </tbody></table></div>`
    : `<div class="empty"><div class="ic">${ic('box', 'lg')}</div><h3>No parts match</h3><p>Try clearing the search or filter.</p></div>`;
}

async function stockPart(no) {
  const d = await api('GET', '/stock/parts/' + encodeURIComponent(no));
  const live = d.fifo.filter((b) => b.remaining > 0);
  openModal({
    title: `${d.description}`,
    wide: true,
    body: `<div class="row wrap" style="gap:8px;margin-bottom:12px"><span class="badge b-slate mono">${esc(d.no)}</span><span class="badge ${d.lowStock ? 'b-red' : 'b-green'}">${d.onHand} ${esc(d.unit)} on hand</span><span class="badge b-slate">Value ${money(d.value)}</span><span class="badge b-slate">Sell ${money(d.mrp)} ex GST</span></div>
      <h3 style="margin:6px 0 8px">FIFO batches <span class="small muted" style="font-weight:400">– issued top to bottom</span></h3>
      ${live.length ? `<div class="tbl-wrap"><table class="tbl rt"><thead><tr><th>Batch</th><th>Received</th><th>Source</th><th class="num">Remaining</th><th class="num">Unit cost</th></tr></thead><tbody>
        ${live.map((b, i) => `<tr><td class="lead" data-l="Batch"><span class="mono">${esc(b.id)}</span>${i === 0 ? ' <span class="badge b-teal">Next to issue</span>' : ''}</td><td data-l="Received">${new Date(b.receivedAt).toLocaleDateString('en-AU')}</td><td data-l="Source">${esc(b.supplier || '')}${b.invoiceNo ? ` · <span class="mono">${esc(b.invoiceNo)}</span>` : ''}${b.inwardId ? `<div class="small muted">${esc(b.inwardId)}</div>` : ''}</td><td class="num" data-l="Remaining"><b>${b.remaining}</b> <span class="muted small">of ${b.qty}</span></td><td class="num" data-l="Unit cost">${money(b.unitCost)}</td></tr>`).join('')}
        </tbody></table></div>` : '<div class="alert info">' + ic('info') + '<div>No stock left. Record a stock inward to add a batch.</div></div>'}
      <h3 style="margin:16px 0 8px">Recent movements</h3>
      ${d.movements.length ? d.movements.slice(0, 25).map((m) => `<div class="lrow" style="padding:8px 0"><span class="badge ${m.kind === 'inward' ? 'b-green' : m.kind === 'issue' ? 'b-amber' : m.kind === 'write-off' ? 'b-red' : m.kind === 'count' ? 'b-violet' : 'b-blue'}" style="min-width:64px;justify-content:center">${m.kind}</span><div class="grow"><div class="t" style="white-space:normal">${m.qty > 0 ? '+' : ''}${m.qty} · ${m.kind === 'inward' ? esc(m.ref) : m.ref.startsWith('ADJ-') ? `<a href="javascript:void 0" onclick="adjustmentView('${esc(m.ref)}')">${esc(m.ref)}</a>` : `<a href="#/jobs/${esc(m.ref)}" onclick="closeModal()">${esc(m.ref)}</a>`}</div><div class="small muted">${esc(m.detail)}</div></div><span class="small muted">${fmtDT(m.at)}${m.by ? ' · ' + esc(m.by) : ''}</span></div>`).join('') : '<div class="muted small">No movements yet.</div>'}`,
    foot: `<div class="row wrap" style="gap:8px;margin-right:auto">${App.can('stock.inward') ? `<button class="btn" onclick="closeModal();inwardModal('${esc(d.no)}')">${ic('plus', 'sm')}Inward</button>` : ''}${App.can('stock.adjust') && d.onHand > 0 ? `<button class="btn" onclick="closeModal();writeoffModal('${esc(d.no)}')">${ic('trash', 'sm')}Write off</button>` : ''}</div><button class="btn primary" onclick="closeModal()">Close</button>`,
  });
}

async function inwardView(id) {
  const g = await api('GET', '/stock/inwards/' + encodeURIComponent(id));
  openModal({
    title: `Goods receipt ${g.id}`,
    wide: true,
    body: `<dl class="kv" style="margin-bottom:14px"><div><dt>Supplier</dt><dd>${esc(g.supplier)}</dd></div><div><dt>Invoice</dt><dd class="mono">${esc(g.invoiceNo)} · ${new Date(g.invoiceDate).toLocaleDateString('en-AU')}</dd></div><div><dt>Received</dt><dd>${fmtDT(g.at)} · ${esc(g.by)}</dd></div>${g.remarks ? `<div><dt>Remarks</dt><dd>${esc(g.remarks)}</dd></div>` : ''}</dl>
      <div class="tbl-wrap"><table class="tbl rt"><thead><tr><th>Part</th><th class="num">Qty</th><th class="num">Unit cost</th><th class="num">Amount</th><th class="num">Left in batch</th></tr></thead><tbody>
      ${g.lines.map((l) => `<tr><td class="lead" data-l="Part"><b>${esc(l.description)}</b><div class="small muted mono">${esc(l.partNo)} · ${esc(l.batchId)}</div></td><td class="num" data-l="Qty">${l.qty} ${esc(l.unit)}</td><td class="num" data-l="Unit cost">${money(l.unitCost)}</td><td class="num" data-l="Amount"><b>${money(l.amount)}</b></td><td class="num" data-l="Left">${l.remaining}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="totals" style="margin-top:12px"><div class="r t"><span style="color:var(--ink)">Total</span><span>${money(g.total)}</span></div></div>`,
    foot: '<button class="btn primary" onclick="closeModal()">Close</button>',
  });
}

/* ---------- new stock inward (goods receipt) ---------- */
async function inwardModal(prefillPart, po) {
  const [parts, inwards, supMaster] = await Promise.all([api('GET', '/masters/parts?active=true').catch(() => window.__stock?.rows || []), api('GET', '/stock/inwards'), api('GET', '/masters/suppliers?active=true').catch(() => [])]);
  const suppliers = [...new Set([...supMaster.map((s) => s.name), ...inwards.map((g) => g.supplier)])];
  const byNo = Object.fromEntries(parts.map((p) => [p.no, p]));
  const lastCost = {};
  for (const r of window.__stock?.rows || []) if (r.nextCost != null) lastCost[r.no] = r.nextCost;
  const lines = po ? po.lines.filter((l) => l.qty > (l.receivedQty || 0)).map((l) => ({ partNo: l.partNo, qty: l.qty - (l.receivedQty || 0), unitCost: l.unitCost })) : [{ partNo: prefillPart || '', qty: '', unitCost: prefillPart && lastCost[prefillPart] != null ? lastCost[prefillPart] : '' }];
  const today = new Date().toISOString().slice(0, 10);
  openModal({
    title: po ? `Receive ${po.id}` : 'New stock inward',
    wide: true,
    body: `<div class="grid g2">
        <label class="f"><span>Supplier <span style="color:var(--red)">*</span></span><input class="inp" id="giSup" list="dlSup" autocomplete="off" placeholder="e.g. Isuzu Australia Parts" value="${po ? esc(po.supplierName) : ''}" ${po ? 'readonly' : ''}></label>
        <label class="f"><span>Supplier invoice no. <span style="color:var(--red)">*</span></span><input class="inp" id="giInv" style="text-transform:uppercase" autocomplete="off"></label>
        <label class="f"><span>Invoice date</span><input class="inp" id="giDate" type="date" value="${today}" max="${today}"></label>
        <label class="f"><span>Remarks</span><input class="inp" id="giRem" autocomplete="off"></label>
      </div>
      <datalist id="dlSup">${suppliers.map((s) => `<option value="${esc(s)}">`).join('')}</datalist>
      <datalist id="dlParts">${parts.map((p) => `<option value="${esc(p.no)}">${esc(p.description)}</option>`).join('')}</datalist>
      <h3 style="margin:16px 0 8px">Parts received</h3>
      <div id="giLines"></div>
      <div class="row between wrap" style="gap:8px;margin-top:10px"><button class="btn sm" type="button" id="giAdd">${ic('plus', 'sm')}Add line</button><div class="totals" style="min-width:220px"><div class="r t"><span style="color:var(--ink)">Total</span><span id="giTot">${money(0)}</span></div></div></div>`,
    foot: '<button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="giSave">Save inward</button>',
  });
  const draw = () => {
    $('#giLines').innerHTML = lines.map((l, i) => {
      const p = byNo[l.partNo];
      return `<div class="row wrap gi-line" style="gap:8px;align-items:flex-end;padding:8px 0;border-top:1px solid var(--line-2)">
        <label class="f" style="flex:3;min-width:200px"><span>Part number</span><input class="inp mono" data-i="${i}" data-k="partNo" list="dlParts" value="${esc(l.partNo)}" autocomplete="off" placeholder="Type or pick"><span class="small ${p ? 'muted' : ''}" style="min-height:16px">${p ? `${esc(p.description)} · ${p.stock} ${esc(p.unit)} in stock` : l.partNo ? '<span style="color:var(--red)">Unknown part</span>' : ''}</span></label>
        <label class="f" style="flex:1;min-width:90px"><span>Qty${p ? ` (${esc(p.unit)})` : ''}</span><input class="inp" data-i="${i}" data-k="qty" type="number" min="0" step="any" value="${esc(l.qty)}"><span style="min-height:16px"></span></label>
        <label class="f" style="flex:1;min-width:110px"><span>Unit cost ex GST ($)</span><input class="inp" data-i="${i}" data-k="unitCost" type="number" min="0" step="0.01" value="${esc(l.unitCost)}"><span class="small muted" style="min-height:16px">${p ? 'Sell ' + money(p.mrp) : ''}</span></label>
        <div style="flex:1;min-width:90px;text-align:right;padding-bottom:22px"><b>${money((Number(l.qty) || 0) * (Number(l.unitCost) || 0))}</b></div>
        <button class="btn ghost sm icon" type="button" title="Remove line" data-del="${i}" style="margin-bottom:20px" ${lines.length === 1 ? 'disabled' : ''}>${ic('trash', 'sm')}</button></div>`;
    }).join('');
    $('#giTot').textContent = money(lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitCost) || 0), 0));
    $$('#giLines [data-k]').forEach((el) => {
      el.onchange = () => {
        const l = lines[Number(el.dataset.i)];
        l[el.dataset.k] = el.dataset.k === 'partNo' ? el.value.trim().toUpperCase() : el.value;
        if (el.dataset.k === 'partNo' && byNo[l.partNo] && l.unitCost === '') l.unitCost = lastCost[l.partNo] ?? Math.round(byNo[l.partNo].mrp * 0.7 * 100) / 100;
        draw();
      };
    });
    $$('#giLines [data-del]').forEach((b) => (b.onclick = () => { lines.splice(Number(b.dataset.del), 1); draw(); }));
  };
  draw();
  $('#giAdd').onclick = () => { lines.push({ partNo: '', qty: '', unitCost: '' }); draw(); $$('#giLines [data-k=partNo]').pop().focus(); };
  $('#giSave').onclick = async (e) => {
    $$('#giLines input').forEach((el) => el.dispatchEvent(new Event('change')));
    const body = { poId: po ? po.id : undefined, supplier: $('#giSup').value, invoiceNo: $('#giInv').value, invoiceDate: $('#giDate').value ? new Date($('#giDate').value + 'T12:00:00').toISOString() : '', remarks: $('#giRem').value,
      lines: lines.filter((l) => l.partNo || l.qty).map((l) => ({ partNo: l.partNo, qty: Number(l.qty), unitCost: l.unitCost === '' ? '' : Number(l.unitCost) })) };
    if (!body.supplier.trim()) { toast('Supplier is required', 'err'); $('#giSup').focus(); return; }
    if (!body.invoiceNo.trim()) { toast('Supplier invoice number is required', 'err'); $('#giInv').focus(); return; }
    const res = await act(e.currentTarget, () => api('POST', '/stock/inwards', body));
    if (res) { closeModal(); toast(`${res.id} saved – ${res.lines.length} part line(s) added to stock`); App.updateBadges(); App.reloadMeta?.(); App.go('#/stock?tab=inwards'); App.refresh(); }
  };
}

/* ---------- stock adjustments: list, stock count, write-off ---------- */
function adjustmentsList(list) {
  return `<div class="card" style="overflow:hidden">${list.length ? `<div class="tbl-wrap"><table class="tbl rt"><thead><tr><th>Adjustment</th><th>Type</th><th>Reason</th><th class="num">Parts changed</th><th class="num">Value</th><th class="hide-sm"></th></tr></thead><tbody>
    ${list.map((a) => { const n = a.lines.filter((l) => l.qty !== 0).length; return `<tr class="click" onclick="adjustmentView('${esc(a.id)}')"><td class="lead" data-l="Adjustment"><b>${esc(a.id)}</b><div class="small muted">${fmtDT(a.at)} · ${esc(a.by)}</div></td>
      <td data-l="Type"><span class="badge ${a.type === 'count' ? 'b-violet' : 'b-red'}">${a.type === 'count' ? 'Stock count' : 'Write-off'}</span></td>
      <td data-l="Reason">${esc(a.reason)}${a.remarks ? `<div class="small muted">${esc(a.remarks)}</div>` : ''}</td>
      <td class="num" data-l="Parts changed">${n} <span class="muted small">of ${a.lines.length}</span></td>
      <td class="num" data-l="Value"><b style="color:${a.value < 0 ? 'var(--red)' : a.value > 0 ? 'var(--green)' : 'inherit'}">${a.value > 0 ? '+' : ''}${money(a.value)}</b></td>
      <td class="hide-sm" style="width:30px;color:var(--faint)">${ic('chevron', 'sm')}</td></tr>`; }).join('')}
    </tbody></table></div>` : `<div class="empty"><div class="ic">${ic('refresh', 'lg')}</div><h3>No adjustments yet</h3><p>Use <b>Stock count</b> after a physical check of the shelves, or <b>Write off</b> for damaged, expired or lost parts.</p></div>`}</div>`;
}

async function adjustmentView(id) {
  const a = await api('GET', '/stock/adjustments/' + encodeURIComponent(id));
  openModal({
    title: `${a.type === 'count' ? 'Stock count' : 'Write-off'} ${a.id}`,
    wide: true,
    body: `<dl class="kv" style="margin-bottom:14px"><div><dt>Posted</dt><dd>${fmtDT(a.at)} · ${esc(a.by)}</dd></div><div><dt>Reason</dt><dd>${esc(a.reason)}</dd></div>${a.remarks ? `<div><dt>Remarks</dt><dd>${esc(a.remarks)}</dd></div>` : ''}<div><dt>Net value</dt><dd><b>${money(a.value)}</b></dd></div></dl>
      <div class="tbl-wrap"><table class="tbl rt"><thead><tr><th>Part</th>${a.type === 'count' ? '<th class="num">System</th><th class="num">Counted</th>' : ''}<th class="num">Change</th><th class="num">Value</th><th>Batches</th></tr></thead><tbody>
      ${a.lines.map((l) => `<tr><td class="lead" data-l="Part"><b>${esc(l.description)}</b><div class="small muted mono">${esc(l.partNo)}</div></td>${a.type === 'count' ? `<td class="num" data-l="System">${l.systemQty}</td><td class="num" data-l="Counted">${l.countedQty}</td>` : ''}
        <td class="num" data-l="Change"><b style="color:${l.qty < 0 ? 'var(--red)' : l.qty > 0 ? 'var(--green)' : 'inherit'}">${l.qty > 0 ? '+' : ''}${l.qty}</b></td><td class="num" data-l="Value">${money(l.value)}</td>
        <td data-l="Batches" class="small muted">${l.allocations.length ? l.allocations.map((x) => `${x.qty} ${l.qty < 0 ? 'from' : 'into'} ${esc(x.batchId)} @ ${x.unitCost}`).join('<br>') : 'No change'}</td></tr>`).join('')}
      </tbody></table></div>`,
    foot: '<button class="btn primary" onclick="closeModal()">Close</button>',
  });
}

/* Stock count: list parts with system quantity, type what is on the shelf, post only the differences */
async function countSheet(initial = {}, initialRemarks = '') {
  const stock = await api('GET', '/stock');
  const rows = stock.rows.filter((r) => r.active || r.onHand > 0);
  const cats = [...new Set(rows.map((r) => r.category).filter(Boolean))].sort();
  const counted = Object.assign({}, initial); // partNo -> value typed
  const sys = Object.fromEntries(rows.map((r) => [r.no, r.onHand]));
  const unitCost = Object.fromEntries(rows.map((r) => [r.no, r.onHand ? r.avgCost : r.nextCost || r.mrp * 0.7]));
  openModal({
    title: 'Stock count',
    wide: true,
    body: `<div class="alert info" style="margin-bottom:12px">${ic('info')}<div>Count what is on the shelf and type it in. Leave a part blank if you did not count it. Only differences are posted: shortages leave stock oldest batch first, surpluses are added as a new batch at the latest cost.</div></div>
      <div class="row wrap" style="gap:8px;margin-bottom:10px">
        <label class="gsearch" style="display:flex;flex:1;min-width:180px">${ic('search', 'sm')}<input id="ctQ" placeholder="Search parts…" autocomplete="off"></label>
        <select class="inp" id="ctCat" style="width:auto"><option value="">All categories</option>${cats.map((c) => `<option>${esc(c)}</option>`).join('')}</select>
        <button class="btn sm" type="button" id="ctFill" title="Copy the system quantity into every visible blank row">Fill blanks with system qty</button>
      </div>
      <div id="ctRows" style="max-height:min(52vh,520px);overflow:auto;border:1px solid var(--line);border-radius:10px"></div>
      <div class="grid g2" style="margin-top:12px"><label class="f"><span>Remarks</span><input class="inp" id="ctRem" placeholder="e.g. Month-end count, rack A–D" autocomplete="off" value="${esc(initialRemarks)}"></label>
      <div class="totals" id="ctSum" style="align-self:end"></div></div>`,
    foot: '<button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="ctPost">Post count</button>',
  });
  const visible = () => {
    const t = $('#ctQ').value.toLowerCase().trim(), c = $('#ctCat').value;
    return rows.filter((r) => (!c || r.category === c) && (!t || [r.no, r.description].join(' ').toLowerCase().includes(t)));
  };
  const diffOf = (no) => (counted[no] === undefined || counted[no] === '' ? null : Math.round((Number(counted[no]) - sys[no]) * 1000) / 1000);
  const summary = () => {
    const done = Object.keys(counted).filter((k) => counted[k] !== '' && counted[k] !== undefined);
    const diffs = done.map((k) => [k, diffOf(k)]).filter(([, d]) => d);
    const value = diffs.reduce((s, [k, d]) => s + d * unitCost[k], 0);
    $('#ctSum').innerHTML = `<div class="r"><span>Parts counted</span><b>${done.length} of ${rows.length}</b></div><div class="r"><span>With a difference</span><b>${diffs.length}</b></div><div class="r t"><span style="color:var(--ink)">Approx. value change</span><span style="color:${value < 0 ? 'var(--red)' : value > 0 ? 'var(--green)' : 'inherit'}">${value > 0 ? '+' : ''}${money(Math.round(value * 100) / 100)}</span></div>`;
  };
  const draw = () => {
    const list = visible();
    $('#ctRows').innerHTML = list.length ? `<table class="tbl" style="margin:0"><thead><tr><th>Part</th><th class="num">System</th><th class="num" style="width:120px">Counted</th><th class="num">Difference</th></tr></thead><tbody>
      ${list.map((r) => { const d = diffOf(r.no); return `<tr><td><b>${esc(r.description)}</b><div class="small muted"><span class="mono">${esc(r.no)}</span> · ${esc(r.category || '')}</div></td><td class="num">${r.onHand} <span class="muted small">${esc(r.unit)}</span></td>
        <td class="num"><input class="inp qty" style="width:100px;text-align:right" type="number" min="0" step="any" inputmode="decimal" data-no="${esc(r.no)}" value="${counted[r.no] ?? ''}" aria-label="Counted quantity of ${esc(r.no)}"></td>
        <td class="num" data-diff="${esc(r.no)}">${d == null ? '<span class="muted small">—</span>' : d === 0 ? '<span class="badge b-green">OK</span>' : `<b style="color:${d < 0 ? 'var(--red)' : 'var(--green)'}">${d > 0 ? '+' : ''}${d}</b>`}</td></tr>`; }).join('')}
      </tbody></table>` : '<div class="empty small" style="padding:16px">No parts match.</div>';
    $$('#ctRows input[data-no]').forEach((el) => (el.oninput = () => {
      counted[el.dataset.no] = el.value;
      const d = diffOf(el.dataset.no);
      $(`#ctRows [data-diff="${CSS.escape(el.dataset.no)}"]`).innerHTML = d == null ? '<span class="muted small">—</span>' : d === 0 ? '<span class="badge b-green">OK</span>' : `<b style="color:${d < 0 ? 'var(--red)' : 'var(--green)'}">${d > 0 ? '+' : ''}${d}</b>`;
      summary();
    }));
    summary();
  };
  $('#ctQ').oninput = draw;
  $('#ctCat').onchange = draw;
  $('#ctFill').onclick = () => { visible().forEach((r) => { if (counted[r.no] === undefined || counted[r.no] === '') counted[r.no] = String(r.onHand); }); draw(); };
  draw();
  $('#ctPost').onclick = async (e) => {
    const lines = Object.keys(counted).filter((k) => counted[k] !== '' && counted[k] !== undefined).map((k) => ({ partNo: k, countedQty: Number(counted[k]), systemQty: sys[k] }));
    if (!lines.length) { toast('Type the counted quantity for at least one part', 'err'); return; }
    if (lines.some((l) => l.countedQty < 0 || isNaN(l.countedQty))) { toast('Counted quantities cannot be negative', 'err'); return; }
    const diffs = lines.filter((l) => l.countedQty !== l.systemQty);
    const msg = diffs.length ? `${diffs.length} part(s) will be adjusted to the counted quantity:<br>${diffs.slice(0, 8).map((l) => `• ${esc(l.partNo)}: ${l.systemQty} → ${l.countedQty}`).join('<br>')}${diffs.length > 8 ? '<br>…' : ''}` : `All ${lines.length} counted part(s) match the system. The count will be recorded with no stock change.`;
    const remarks = $('#ctRem').value;
    if (!(await confirmBox('Post stock count?', msg, 'Post count'))) { countSheet(counted, remarks); return; }
    const res = await act(null, () => api('POST', '/stock/adjustments', { type: 'count', remarks, lines }));
    if (res) { toast(`${res.id} posted`); App.go('#/stock?tab=adjustments'); App.refresh(); App.updateBadges(); }
  };
}

/* Write-off: damaged, expired, lost … – taken out FIFO and valued at batch cost */
async function writeoffModal(prefillPart) {
  const [stock, reasons] = await Promise.all([api('GET', '/stock'), api('GET', '/stock/writeoff-reasons')]);
  const inStock = stock.rows.filter((r) => r.onHand > 0);
  const byNo = Object.fromEntries(stock.rows.map((r) => [r.no, r]));
  const lines = [{ partNo: prefillPart || '', qty: '' }];
  openModal({
    title: 'Write off stock',
    wide: true,
    body: `<div class="grid g2">
        <label class="f"><span>Reason <span style="color:var(--red)">*</span></span><select class="inp" id="woR"><option value="">Select…</option>${reasons.map((r) => `<option>${esc(r)}</option>`).join('')}</select></label>
        <label class="f"><span>Remarks</span><input class="inp" id="woRem" placeholder="e.g. Rack collapsed, water damage" autocomplete="off"></label>
      </div>
      <datalist id="dlStock">${inStock.map((p) => `<option value="${esc(p.no)}">${esc(p.description)} (${p.onHand})</option>`).join('')}</datalist>
      <h3 style="margin:16px 0 8px">Parts to write off</h3>
      <div id="woLines"></div>
      <div class="row between wrap" style="gap:8px;margin-top:10px"><button class="btn sm" type="button" id="woAdd">${ic('plus', 'sm')}Add line</button><div class="totals" style="min-width:240px"><div class="r t"><span style="color:var(--ink)">Value written off (FIFO)</span><span id="woTot">${money(0)}</span></div></div></div>`,
    foot: '<button class="btn" onclick="closeModal()">Cancel</button><button class="btn danger" id="woSave">Write off</button>',
  });
  // FIFO value preview: walk the part's batches oldest first
  const fifoCost = {};
  const preview = async (no) => { if (!fifoCost[no] && byNo[no]) fifoCost[no] = (await api('GET', '/stock/parts/' + encodeURIComponent(no))).fifo.filter((b) => b.remaining > 0); };
  const valueOf = (l) => { let left = Number(l.qty) || 0, v = 0; for (const b of fifoCost[l.partNo] || []) { const t = Math.min(left, b.remaining); v += t * b.unitCost; left -= t; if (left <= 0) break; } return Math.round(v * 100) / 100; };
  const draw = () => {
    $('#woLines').innerHTML = lines.map((l, i) => {
      const p = byNo[l.partNo];
      const over = p && Number(l.qty) > p.onHand;
      return `<div class="row wrap" style="gap:8px;align-items:flex-end;padding:8px 0;border-top:1px solid var(--line-2)">
        <label class="f" style="flex:3;min-width:200px"><span>Part number</span><input class="inp mono" data-i="${i}" data-k="partNo" list="dlStock" value="${esc(l.partNo)}" autocomplete="off" placeholder="Type or pick"><span class="small ${p ? 'muted' : ''}" style="min-height:16px">${p ? `${esc(p.description)} · ${p.onHand} ${esc(p.unit)} in stock` : l.partNo ? '<span style="color:var(--red)">Unknown part</span>' : ''}</span></label>
        <label class="f" style="flex:1;min-width:90px"><span>Qty${p ? ` (${esc(p.unit)})` : ''}</span><input class="inp ${over ? 'err' : ''}" data-i="${i}" data-k="qty" type="number" min="0" step="any" value="${esc(l.qty)}"><span class="small" style="min-height:16px;color:var(--red)">${over ? 'More than in stock' : ''}</span></label>
        <div style="flex:1;min-width:90px;text-align:right;padding-bottom:22px"><b>${money(valueOf(l))}</b></div>
        <button class="btn ghost sm icon" type="button" title="Remove line" data-del="${i}" style="margin-bottom:20px" ${lines.length === 1 ? 'disabled' : ''}>${ic('trash', 'sm')}</button></div>`;
    }).join('');
    $('#woTot').textContent = money(lines.reduce((s, l) => s + valueOf(l), 0));
    $$('#woLines [data-k]').forEach((el) => (el.onchange = async () => {
      const l = lines[Number(el.dataset.i)];
      l[el.dataset.k] = el.dataset.k === 'partNo' ? el.value.trim().toUpperCase() : el.value;
      if (el.dataset.k === 'partNo') await preview(l.partNo);
      draw();
    }));
    $$('#woLines [data-del]').forEach((b) => (b.onclick = () => { lines.splice(Number(b.dataset.del), 1); draw(); }));
  };
  if (prefillPart) await preview(prefillPart);
  draw();
  $('#woAdd').onclick = () => { lines.push({ partNo: '', qty: '' }); draw(); $$('#woLines [data-k=partNo]').pop().focus(); };
  $('#woSave').onclick = async (e) => {
    const body = { type: 'writeoff', reason: $('#woR').value, remarks: $('#woRem').value, lines: lines.filter((l) => l.partNo || l.qty).map((l) => ({ partNo: l.partNo, qty: Number(l.qty) })) };
    if (!body.reason) { toast('Choose a reason', 'err'); $('#woR').focus(); return; }
    const res = await act(e.currentTarget, () => api('POST', '/stock/adjustments', body));
    if (res) { closeModal(); toast(`${res.id}: ${money(-res.value)} written off`); App.updateBadges(); App.go('#/stock?tab=adjustments'); App.refresh(); }
  };
}
