/* Workshop Pro – dashboard, job list, walk-in, vehicle, API & settings */
'use strict';

/* ================= Dashboard ================= */
App.route('/', async () => {
  const d = await api('GET', '/dashboard');
  const k = d.kpis;
  const max = Math.max(1, ...Object.values(d.byStage));
  const hr = new Date().getHours();
  const kpi = (label, value, sub, icon, href, cls = '') =>
    `<a class="kpi ${cls}" href="${href}" style="text-decoration:none;color:inherit"><span class="k">${ic(icon, 'sm')}${label}</span><span class="v">${value}</span><span class="s">${sub}</span></a>`;
  const jobRow = (j, right) => `<div class="lrow click" onclick="App.go('#/jobs/${j.id}')">
      <span class="vicon">${ic('car')}</span>
      <div class="grow"><div class="t">${esc(j.vehicle.reg)} · ${esc(j.vehicle.model)}</div><div class="small muted">${esc(j.id)} · ${esc(j.vehicle.ownerName)}</div></div>
      <div class="right">${right}</div></div>`;
  return {
    title: 'Dashboard',
    nav: 'dash',
    html: `
    <div class="row between wrap" style="margin-bottom:18px">
      <div><h1>Good ${hr < 12 ? 'morning' : hr < 17 ? 'afternoon' : 'evening'}, ${esc((App.me?.user.name || '').split(' ')[0])}</h1><div class="muted">${new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })} · ${esc(App.meta?.workshop.name || '')}</div></div>
    </div>
    <div class="kpis">
      ${kpi('Open job cards', k.openJobs, `${money(k.openEstimateValue)} in estimates`, 'clipboard', '#/jobs?status=open')}
      ${kpi('Due today', k.dueToday, 'Promised for delivery', 'calendar', '#/jobs?status=open')}
      ${kpi('Overdue', k.overdue, k.overdue ? 'Past promised time' : 'All on track', 'clock', '#/jobs?status=open&overdue=1', k.overdue ? 'bad' : '')}
      ${kpi('Awaiting approval', k.pendingApprovals, 'Estimate lines', 'chat', '#/jobs?status=open&approvals=1', k.pendingApprovals ? 'warn' : '')}
      ${kpi('Customers waiting', k.waitingCustomers, 'In the lounge', 'user', '#/jobs?status=open')}
      ${kpi('Revenue this month', money(k.revenueMonth), 'Invoiced, incl. GST', 'receipt', '#/jobs?status=closed')}
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-h"><h2>Workshop pipeline</h2><a href="#/jobs" class="small">View all job cards</a></div>
      <div class="card-b"><div class="pipe">${d.stages.map((s) => `<button onclick="App.go('#/jobs?stage=${s.key}')"><span class="small muted" style="font-weight:600">${s.label}</span><b>${d.byStage[s.key]}</b><span class="bar"><i style="width:${(d.byStage[s.key] / max) * 100}%"></i></span></button>`).join('')}</div></div>
    </div>

    <div class="grid g2" style="margin-top:16px">
      <div class="card"><div class="card-h"><h2>Deliveries due</h2><span class="badge b-slate">${d.deliveries.length}</span></div>
        ${d.deliveries.length ? d.deliveries.map((j) => jobRow(j, `${j.overdue ? '<span class="badge b-red">Overdue</span>' : stageBadge(j.stage)}<div class="small muted" style="margin-top:4px">${fmtDT(j.promisedAt)}</div>`)).join('') : `<div class="empty">No deliveries due in the next 24 hours.</div>`}
      </div>
      <div class="card"><div class="card-h"><h2>Waiting for customer approval</h2><span class="badge b-amber">${d.approvals.length}</span></div>
        ${d.approvals.length ? d.approvals.map((j) => jobRow(j, `<span class="badge b-amber">${j.pendingApprovals} line${j.pendingApprovals > 1 ? 's' : ''}</span><div class="small muted" style="margin-top:4px">${money(j.estimateTotal)}</div>`)).join('') : `<div class="empty">Nothing waiting – all estimates are approved.</div>`}
      </div>
    </div>

    <div class="card" style="margin-top:16px"><div class="card-h"><h2>Recent activity</h2></div>
      <div class="card-b"><div class="tl">${d.recent.map((a) => `<div class="e"><div><a href="#/jobs/${a.jobId}"><b>${esc(a.reg || a.jobId)}</b></a> · ${esc(a.text)}</div><div class="m">${esc(a.by)} · ${rel(a.at)}</div></div>`).join('')}</div></div>
    </div>`,
  };
});

/* ================= Job card list ================= */
App.route('/jobs', async (p, q) => {
  const ui = (App.ui.jobs = App.ui.jobs || { q: '' });
  const stage = q.get('stage') || '';
  const status = q.get('status') || (stage ? '' : 'open');
  const all = await api('GET', '/jobcards?' + new URLSearchParams({ status: status === 'all' ? '' : status }));
  let list = stage ? all.filter((j) => j.stage === stage) : all;
  if (q.get('overdue')) list = list.filter((j) => j.overdue);
  if (q.get('approvals')) list = list.filter((j) => j.pendingApprovals);
  const counts = Object.fromEntries((App.meta?.stages || []).map((s) => [s.key, all.filter((j) => j.stage === s.key).length]));
  const qs = (o) => '#/jobs?' + new URLSearchParams(Object.fromEntries(Object.entries(Object.assign({ status, stage }, o)).filter(([, v]) => v)));
  const rows = (l) => l.map((j) => `<tr class="click" onclick="App.go('#/jobs/${j.id}')" data-s="${esc((j.id + j.vehicle.reg + j.vehicle.ownerName + j.vehicle.model).toLowerCase().replace(/\s/g, ''))}">
      <td class="lead" data-l="Vehicle"><div>${vehLine(j.vehicle)}</div><div class="small muted" style="margin-top:2px">${esc(j.id)} · ${esc(j.jobType)}</div></td>
      <td data-l="Customer">${esc(j.vehicle.ownerName)}${j.customerWaiting ? ' <span class="badge b-blue" title="Customer waiting">Waiting</span>' : ''}</td>
      <td data-l="Stage">${j.status === 'on_hold' ? statusBadge(j.status) : stageBadge(j.stage)}</td>
      <td data-l="Promised">${promisedCell(j)}</td>
      <td data-l="Approvals">${j.pendingApprovals ? `<span class="badge b-amber">${j.pendingApprovals} pending</span>` : '<span class="muted">—</span>'}</td>
      <td data-l="Estimate" class="num"><b>${money(j.estimateTotal)}</b></td>
      <td class="hide-sm" style="width:30px;color:var(--faint)">${ic('chevron', 'sm')}</td></tr>`).join('');
  return {
    title: 'Job cards',
    nav: 'jobs',
    html: `
    <div class="row between wrap" style="margin-bottom:14px;gap:12px">
      <div class="seg">${[['open', 'Open'], ['closed', 'Closed'], ['all', 'All']].map(([k, l]) => `<button class="${status === k ? 'on' : ''}" onclick="App.go('${qs({ status: k, stage: '' })}')">${l}</button>`).join('')}</div>
      <label class="gsearch" style="display:flex;width:min(340px,100%)">${ic('search', 'sm')}<input id="jq" placeholder="Filter by RO, reg no, customer…" value="${esc(ui.q)}"></label>
    </div>
    <div class="chips" style="margin-bottom:14px">
      <button class="chip ${!stage ? 'on' : ''}" onclick="App.go('${qs({ stage: '' })}')">All stages <span class="n">${all.length}</span></button>
      ${(App.meta?.stages || []).filter((s) => status !== 'open' || s.key !== 'delivered').map((s) => `<button class="chip ${stage === s.key ? 'on' : ''}" onclick="App.go('${qs({ stage: s.key })}')">${s.label} <span class="n">${counts[s.key]}</span></button>`).join('')}
    </div>
    ${q.get('overdue') || q.get('approvals') ? `<div class="alert info" style="margin-bottom:14px">${ic('info')}<div style="flex:1">Showing only ${q.get('overdue') ? 'overdue job cards' : 'job cards waiting for customer approval'}.</div><a href="#/jobs">Clear filter</a></div>` : ''}
    <div class="card" style="overflow:hidden">
      ${list.length ? `<div class="tbl-wrap"><table class="tbl rt" id="jobTable"><thead><tr><th>Vehicle</th><th>Customer</th><th>Stage</th><th>Promised</th><th>Approvals</th><th class="num">Estimate</th><th class="hide-sm"></th></tr></thead><tbody>${rows(list)}</tbody></table></div>
      <div class="empty hide" id="jEmpty">No job cards match “<span id="jTerm"></span>”.</div>`
      : `<div class="empty"><div class="ic">${ic('clipboard', 'lg')}</div><h3>No job cards here</h3><p>Try another stage, or start a new job card from walk-in.</p><a class="btn primary" href="#/walkin">${ic('plus')}New job card</a></div>`}
    </div>`,
    after() {
      const inp = $('#jq');
      const apply = () => {
        ui.q = inp.value;
        const t = inp.value.toLowerCase().replace(/\s/g, '');
        let shown = 0;
        $$('#jobTable tbody tr').forEach((tr) => { const ok = !t || tr.dataset.s.includes(t); tr.classList.toggle('hide', !ok); shown += ok; });
        $('#jEmpty')?.classList.toggle('hide', shown > 0);
        if ($('#jTerm')) $('#jTerm').textContent = inp.value;
      };
      inp?.addEventListener('input', apply);
      apply();
    },
  };
});

/* ================= Walk-in / vehicle search ================= */
App.route('/walkin', async (p, q) => {
  const term = q.get('q') || '';
  const results = term ? await api('GET', '/vehicles?q=' + encodeURIComponent(term)) : null;
  const card = (v) => `<div class="lrow click" onclick="App.go('#/vehicles/${v.vin}')">
      <span class="vicon" style="background:${esc(v.hex)}22;color:${esc(v.hex)}">${ic('car')}</span>
      <div class="grow"><div class="t">${esc(v.reg)} · ${esc(v.model)} <span class="muted" style="font-weight:400">${esc(v.variant)}</span></div>
        <div class="small muted">${esc(v.ownerName)} · ${esc(fmtPhone(v.ownerPhone))} · VIN ${esc(v.vin)}</div></div>
      ${v.activeJob ? `<span class="badge b-teal"><span class="dot"></span>Open job ${esc(v.activeJob.id)}</span>` : '<span class="badge b-slate">No open job</span>'}
      <span class="hide-sm" style="color:var(--faint)">${ic('chevron')}</span></div>`;
  return {
    title: 'Walk-in',
    nav: 'walkin',
    html: `
    <div class="card" style="max-width:860px;margin:0 auto">
      <div class="card-b">
        <h2>Find the vehicle</h2>
        <div class="row between wrap" style="gap:8px;margin:4px 0 14px"><p class="muted" style="margin:0;flex:1;min-width:240px">Search by registration number, VIN, engine number or the owner's phone. You'll see its history and open job card, or start a new one.</p>${App.can('vehicles.create') && App.can('jobs.create') ? `<a class="btn sm" href="#/new" onclick="App.ui.wiz=null">${ic('plus', 'sm')}New vehicle</a>` : ''}</div>
        <form class="row" id="wiForm" style="gap:8px">
          <label class="gsearch" style="display:flex;flex:1;width:auto;height:46px">${ic('search')}<input name="q" id="wiQ" value="${esc(term)}" placeholder="e.g. DX84TR, MPAT…, 0412 555 018" autocomplete="off" style="font-size:15px"></label>
          <button type="button" class="btn lg icon" title="Scan VIN barcode" onclick="scanDemo()">${ic('scan')}</button>
          <button class="btn primary lg">Search</button>
        </form>
      </div>
      ${results ? `<div style="border-top:1px solid var(--line-2)">${results.length ? results.map(card).join('') : `<div class="empty"><div class="ic">${ic('car', 'lg')}</div><h3>No vehicle found</h3><p>Check the number and try again. If this vehicle has never been here, register it with its customer and open the job card in one go.</p>${App.can('vehicles.create') && App.can('jobs.create') ? `<a class="btn primary" href="#/new?q=${encodeURIComponent(term)}" onclick="App.ui.wiz=null">${ic('plus')}Register vehicle &amp; open job card</a>` : '<p class="small muted">Ask a user with the right “Register vehicles and customers” to add it.</p>'}</div>`}</div>`
      : `<div style="border-top:1px solid var(--line-2);padding:14px 18px" class="small muted">Try <a href="#/walkin?q=ZTR914">ZTR914</a> (no open job) or <a href="#/walkin?q=DX84TR">DX84TR</a> (job in progress).</div>`}
    </div>`,
    after() {
      $('#wiForm').onsubmit = (e) => { e.preventDefault(); const v = $('#wiQ').value.trim(); if (v) App.go('#/walkin?q=' + encodeURIComponent(v)); };
      if (!term) $('#wiQ').focus();
    },
  };
});
function scanDemo() {
  openModal({ title: 'Scan VIN', body: `<div class="alert info">${ic('info')}<div>Point the tablet camera at the VIN plate. Camera scanning needs a barcode service on the device; in this demo you can pick a sample VIN.</div></div>
    <div class="stack" style="margin-top:14px">${['MPATFS86JHT010963', 'M3GTGS664J8AC1419', 'MPAUCR85HKT000877'].map((v) => `<button class="btn" onclick="closeModal();App.go('#/walkin?q=${v}')">${ic('scan', 'sm')}<span class="mono">${v}</span></button>`).join('')}</div>` });
}

/* ================= Vehicle profile ================= */
App.route('/vehicles/:vin', async ({ vin }, q) => {
  const v = await api('GET', '/vehicles/' + encodeURIComponent(vin));
  const tab = q.get('tab') || 'overview';
  const a = v.activeJob;
  const t = (k, l, n) => `<button class="${tab === k ? 'on' : ''}" onclick="App.go('#/vehicles/${v.vin}?tab=${k}')">${l}${n != null ? `<span class="n">${n}</span>` : ''}</button>`;
  const warrantyOk = new Date(v.warrantyTill) > new Date();
  let body = '';
  if (tab === 'overview') body = `
    <div class="split">
      <div class="card"><div class="card-h"><h2>Owner</h2><button class="btn sm" onclick="ownerModal('${v.vin}')">${ic('edit', 'sm')}Edit</button><button class="btn sm" onclick="ticketModal('${v.vin}')">Change request</button></div>
        <div class="card-b"><dl class="kv">
          <div><dt>Name</dt><dd>${esc(v.owner.name)} ${v.owner.vip ? '<span class="badge b-amber">VIP</span>' : ''}</dd></div>
          <div><dt>Customer ID</dt><dd>${esc(v.owner.customerId)}</dd></div>
          <div><dt>Primary mobile</dt><dd><a href="tel:${esc(v.owner.phone)}">${esc(fmtPhone(v.owner.phone))}</a></dd></div>
          <div><dt>Secondary mobile</dt><dd>${esc(v.owner.phone2 || '—')}</dd></div>
          <div><dt>Email</dt><dd>${v.owner.email ? `<a href="mailto:${esc(v.owner.email)}">${esc(v.owner.email)}</a>` : '—'}</dd></div>
          <div><dt>Type</dt><dd>${esc(v.owner.type)} · ${esc(v.owner.entity)}</dd></div>
          <div style="grid-column:1/-1"><dt>Address</dt><dd>${esc(v.owner.address)}</dd></div>
        </dl>${v.tickets.length ? `<div class="alert info" style="margin-top:14px">${ic('info')}<div>${v.tickets.length} open change request${v.tickets.length > 1 ? 's' : ''}: ${v.tickets.map((x) => esc(x.field)).join(', ')}</div></div>` : ''}</div></div>
      <div class="stack">
        <div class="card"><div class="card-h"><h3>Warranty & insurance</h3><button class="btn sm" onclick="insuranceModal('${v.vin}')">${ic('edit', 'sm')}Edit insurance</button></div><div class="card-b"><dl class="kv" style="grid-template-columns:1fr 1fr">
          <div><dt>Warranty till</dt><dd>${fmtDate(v.warrantyTill)} ${warrantyOk ? '<span class="badge b-green">Active</span>' : '<span class="badge b-slate">Expired</span>'}</dd></div>
          <div><dt>Insurance till</dt><dd>${fmtDate(v.insurance.validTill)} ${new Date(v.insurance.validTill) < new Date() ? '<span class="badge b-red">Expired</span>' : new Date(v.insurance.validTill) < new Date(Date.now() + 30 * 864e5) ? '<span class="badge b-amber">Expiring</span>' : ''}</dd></div>
          <div><dt>Insurer</dt><dd>${esc(v.insurance.company)}</dd></div>
          <div><dt>Policy no.</dt><dd class="mono">${esc(v.insurance.policyNo || '—')}</dd></div>
          <div><dt>Sold by</dt><dd>${esc(v.sellingDealer)}</dd></div></dl></div></div>
        <div class="card"><div class="card-h"><h3>Service plans</h3></div>${v.plans.length ? v.plans.map((pl) => `<div class="lrow"><span class="vicon">${ic('shield')}</span><div class="grow"><div class="t">${esc(pl.name)}</div><div class="small muted">Valid till ${fmtDate(pl.validTill)} · ${esc(pl.usage)}</div></div></div>`).join('') : '<div class="empty small">No active service plans.</div>'}</div>
      </div>
    </div>`;
  if (tab === 'history') body = `<div class="card" style="overflow:hidden"><table class="tbl rt"><thead><tr><th>Job</th><th>Type</th><th>Odometer</th><th>Advisor</th><th>Rating</th><th class="num">Amount</th></tr></thead><tbody>
    ${[...v.jobcards.filter((j) => j.status === 'closed').map((j) => `<tr class="click" onclick="App.go('#/jobs/${j.id}')"><td class="lead" data-l="Job"><b>${esc(j.id)}</b><div class="small muted">${fmtDate(j.arrivedAt)}</div></td><td data-l="Type">${esc(j.jobType)}</td><td data-l="Odometer">—</td><td data-l="Advisor">${esc(j.advisor)}</td><td data-l="Rating">—</td><td data-l="Amount" class="num">${money(j.estimateTotal)}</td></tr>`),
      ...v.history.map((h, i) => `<tr class="click" onclick="historyModal('${v.vin}',${i})"><td class="lead" data-l="Job"><b>${esc(h.jobNumber)}</b><div class="small muted">${fmtDate(h.openedAt)} · ${esc(h.dealer)}</div></td><td data-l="Type">${esc(h.type)}</td><td data-l="Odometer">${h.odometer.toLocaleString('en-AU')} km</td><td data-l="Advisor">${esc(h.advisor)}</td><td data-l="Rating"><span style="color:var(--amber)">${'★'.repeat(h.rating)}</span><span class="faint">${'★'.repeat(5 - h.rating)}</span></td><td data-l="Amount" class="num">${money(h.amount)}</td></tr>`)].join('')}
    </tbody></table></div>`;
  if (tab === 'campaigns') body = `<div class="card">${v.campaigns.map((c) => `<div class="lrow"><span class="vicon">${ic('flag')}</span><div class="grow"><div class="t">${esc(c.name)}</div><div class="small muted">${esc(c.type)} · valid till ${fmtDate(c.validTill)}</div></div><span class="badge b-green">Applicable</span></div>`).join('')}</div>`;
  window.__veh = v;
  return {
    title: v.reg,
    nav: 'walkin',
    back: '#/walkin',
    html: `
    <div class="card"><div class="card-b hero">
      <div class="pic">${carSvg(v.hex, 118)}</div>
      <div class="meta"><h1>${esc(v.reg)} <span class="badge b-slate">${esc(v.model)} ${esc(v.variant)}</span></h1>
        <div class="muted" style="margin-top:4px">${esc(v.owner.name)} · <a href="tel:${esc(v.owner.phone)}">${esc(fmtPhone(v.owner.phone))}</a></div>
        <dl class="kv" style="margin-top:12px;grid-template-columns:repeat(auto-fill,minmax(140px,1fr))">
          <div><dt>VIN</dt><dd class="mono">${esc(v.vin)}</dd></div><div><dt>Engine</dt><dd>${esc(v.engine)}</dd></div>
          <div><dt>Colour</dt><dd><span class="swatch" style="background:${esc(v.hex)}"></span> ${esc(v.color)}</dd></div><div><dt>Fuel / gearbox</dt><dd>${esc(v.fuel)} · ${esc(v.transmission)}</dd></div>
          <div><dt>Sold on</dt><dd>${fmtDate(v.saleDate)}</dd></div></dl></div>
    </div></div>
    ${v.alerts.map((al) => `<div class="alert ${al.level === 'critical' ? 'crit' : 'warn'}" style="margin-top:12px">${ic('alert')}<div><b>${al.level === 'critical' ? 'Critical alert' : 'Alert'}:</b> ${esc(al.text)}</div></div>`).join('')}
    ${a ? `<div class="card" style="margin-top:12px;border-color:var(--primary-600);box-shadow:0 0 0 3px var(--primary-50)"><div class="card-b row wrap" style="gap:14px">
        <span class="vicon" style="background:var(--primary-50);color:var(--primary-700)">${ic('clipboard')}</span>
        <div style="flex:1;min-width:200px"><div class="small muted" style="font-weight:600">Active job card</div><div style="font-size:16px;font-weight:700">${esc(a.id)} · ${esc(a.jobType)}</div>
          <div class="row wrap small" style="margin-top:4px">${stageBadge(a.stage)} <span class="muted">Promised ${fmtDT(a.promisedAt)}</span>${a.pendingApprovals ? `<span class="badge b-amber">${a.pendingApprovals} awaiting approval</span>` : ''}</div></div>
        <a class="btn primary" href="#/jobs/${a.id}">Open job card ${ic('arrow', 'sm')}</a></div></div>`
      : `<div class="card" style="margin-top:12px"><div class="card-b row wrap" style="gap:14px"><span class="vicon">${ic('plus')}</span><div style="flex:1;min-width:200px"><b>No open job card</b><div class="small muted">Check the vehicle in to create a job card and estimate.</div></div><a class="btn primary" href="#/new/${v.vin}">${ic('plus', 'sm')}Start job card</a></div></div>`}
    <div class="tabs" style="margin:18px 0 16px">${t('overview', 'Overview')}${t('history', 'Service history', v.history.length + v.jobcards.filter((j) => j.status === 'closed').length)}${t('campaigns', 'Campaigns', v.campaigns.length)}</div>
    ${body}`,
  };
});

function historyModal(vin, i) {
  const v = window.__veh, h = v.history[i];
  openModal({
    title: `${esc(h.jobNumber)} · ${esc(h.type)}`,
    wide: true,
    body: `<dl class="kv"><div><dt>Dealer</dt><dd>${esc(h.dealer)}</dd></div><div><dt>Opened</dt><dd>${fmtDate(h.openedAt)}</dd></div><div><dt>Closed</dt><dd>${fmtDate(h.closedAt)}</dd></div><div><dt>Odometer</dt><dd>${h.odometer.toLocaleString('en-AU')} km</dd></div><div><dt>Advisor</dt><dd>${esc(h.advisor)}</dd></div></dl>
      <h3 style="margin:18px 0 8px">Parts</h3><table class="tbl"><thead><tr><th>Part no</th><th>Description</th><th class="num">Qty</th></tr></thead><tbody>${h.parts.map((x) => `<tr><td class="mono">${esc(x[0])}</td><td>${esc(x[1])}</td><td class="num">${x[2]}</td></tr>`).join('')}</tbody></table>
      <h3 style="margin:18px 0 8px">Labour</h3><table class="tbl"><thead><tr><th>Code</th><th>Description</th><th class="num">Amount</th></tr></thead><tbody>${h.labour.map((x) => `<tr><td class="mono">${esc(x[0])}</td><td>${esc(x[1])}</td><td class="num">${money(x[2])}</td></tr>`).join('')}</tbody></table>
      <h3 style="margin:18px 0 8px">Remarks</h3><p class="muted" style="margin:0">${esc(h.remarks)}</p>`,
  });
}
function ownerModal(vin) {
  const o = window.__veh.owner;
  openModal({
    title: 'Edit owner details',
    body: `<form id="ownerF" class="grid g2">
      <label class="f" style="grid-column:1/-1">Owner name<input class="inp" name="name" value="${esc(o.name)}" required></label>
      <label class="f">Mobile<input class="inp" name="phone" inputmode="tel" value="${esc(fmtPhone(o.phone))}" required></label>
      <label class="f">Other phone<input class="inp" name="phone2" inputmode="tel" value="${esc(fmtPhone(o.phone2))}"></label>
      <label class="f">ABN <span class="hint">· business customers</span><input class="inp" name="abn" inputmode="numeric" value="${esc(o.abn || '')}"></label>
      <div class="stack" style="gap:6px;align-self:end"><label class="check"><input type="checkbox" name="smsOptIn" ${o.smsOptIn !== false ? 'checked' : ''}>OK to SMS (reminders, vehicle ready)</label><label class="check"><input type="checkbox" name="emailOptIn" ${o.emailOptIn !== false ? 'checked' : ''}>OK to email</label></div>
      ${App.can('billing.override') ? `<label class="check" style="align-self:end"><input type="checkbox" name="accountCustomer" ${o.accountCustomer ? 'checked' : ''}>Account customer (pays on terms)</label><label class="f">Payment terms (days)<input class="inp" name="paymentTermsDays" type="number" min="0" max="120" value="${o.paymentTermsDays || 30}"></label>` : ''}
      <label class="f">Primary email<input class="inp" name="email" type="email" value="${esc(o.email)}"></label>
      <label class="f">Secondary email<input class="inp" name="email2" type="email" value="${esc(o.email2)}"></label>
      <label class="f" style="grid-column:1/-1">Address<textarea class="inp" name="address">${esc(o.address)}</textarea></label></form>`,
    foot: `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="ownerSave">Save changes</button>`,
  });
  $('#ownerSave').onclick = async (e) => {
    const fd = new FormData($('#ownerF'));
    const body = Object.fromEntries(fd);
    for (const k of ['smsOptIn', 'emailOptIn']) body[k] = fd.has(k);
    if ($('#ownerF [name=accountCustomer]')) { body.accountCustomer = fd.has('accountCustomer'); body.paymentTermsDays = Number(body.paymentTermsDays) || 0; } else { delete body.paymentTermsDays; }
    if (await act(e.currentTarget, () => api('PATCH', `/vehicles/${vin}/owner`, body), 'Owner details saved')) { closeModal(); App.refresh(); }
  };
}
function ticketModal(vin) {
  openModal({
    title: 'Owner change request',
    body: `<p class="muted" style="margin-top:0">Use this when the change needs verification (e.g. ownership transfer). The CRM team will review it.</p>
      <div class="stack"><label class="f">What needs to change?<select class="inp" name="field" id="tkF"><option>Owner name</option><option>Mobile number</option><option>Email</option><option>Address</option><option>Ownership transfer</option></select></label>
      <label class="f">Details<textarea class="inp" name="details" id="tkD" placeholder="New value and any supporting information"></textarea></label></div>`,
    foot: `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="tkSave">Submit request</button>`,
  });
  $('#tkSave').onclick = async (e) => {
    if (await act(e.currentTarget, () => api('POST', `/vehicles/${vin}/tickets`, { field: $('#tkF').value, details: $('#tkD').value }), 'Change request submitted')) { closeModal(); App.refresh(); }
  };
}

/* ================= API reference ================= */
const API_DOCS = [
  ['Workshop', [['GET', '/api/health', 'Service health check'], ['GET', '/api/meta', 'Workshop, users, lookups (job types, reasons, bays…), stages'], ['GET', '/api/dashboard', 'KPIs, pipeline counts, deliveries due, approvals, recent activity']]],
  ['Vehicles', [['GET', '/api/vehicles?q=', 'Search by reg no, VIN, engine, owner name or phone'], ['GET', '/api/vehicles/:vin', 'Vehicle profile with owner, alerts, plans, history, active job'], ['PATCH', '/api/vehicles/:vin/owner', 'Update owner contact details'], ['POST', '/api/vehicles/:vin/tickets', 'Raise an owner change request']]],
  ['Job cards', [['GET', '/api/jobcards?status=&stage=&q=', 'List job cards (status: open | active | on_hold | closed)'], ['POST', '/api/jobcards', 'Create from walk-in: check-in details, concerns with packages/lines, customer approval'], ['GET', '/api/jobcards/:id', 'Full job card with estimate & billing totals'], ['PATCH', '/api/jobcards/:id', 'Update check-in details, bay, technician'], ['POST', '/api/jobcards/:id/stage', 'Move to another workflow stage'], ['POST', '/api/jobcards/:id/status', 'hold | resume | close (raises invoice) | reopen'], ['POST', '/api/jobcards/:id/promised', 'Reschedule promised delivery with reason']]],
  ['Concerns & estimate', [['POST', '/api/jobcards/:id/concerns', 'Add customer concern or advisor recommendation'], ['PATCH', '/api/jobcards/:id/concerns/:cid', 'Edit concern / observation'], ['DELETE', '/api/jobcards/:id/concerns/:cid', 'Remove concern and its lines'], ['POST', '/api/jobcards/:id/lines', 'Add part, labour or a whole package'], ['PATCH', '/api/jobcards/:id/lines/:lid', 'Qty, discount, approve/decline, block stock'], ['DELETE', '/api/jobcards/:id/lines/:lid', 'Remove an estimate line'], ['GET', '/api/jobcards/:id/lines/:lid/alternatives', 'Superseded and alternate parts'], ['POST', '/api/jobcards/:id/lines/:lid/replace', 'Swap a part with a reason']]],
  ['Inspection & other', [['PUT', '/api/jobcards/:id/inspection/:section', 'Save a checklist section'], ['PUT', '/api/jobcards/:id/damages', 'Save body-condition marks'], ['POST', '/api/jobcards/:id/campaigns/:cid', 'Apply / remove a campaign'], ['POST', '/api/jobcards/:id/feedback', 'Customer feedback scores'], ['POST', '/api/jobcards/:id/activity', 'Add an internal note'], ['POST', '/api/jobcards/:id/proforma', 'Generate proforma invoice'], ['POST', '/api/jobcards/:id/email', 'Email job card (demo: logged only)']]],
  ['Vehicles & customers', [['GET', '/api/customers?q=', 'Find customers by name, mobile or ID (with their vehicles)'], ['GET', '/api/vehicles/registration-options', 'Lists for the registration form (fuel, transmission, models, dealers, insurers)'], ['POST', '/api/vehicles/check', 'Validate a new vehicle + customer without saving'], ['POST', '/api/jobcards', 'With newVehicle + customer (customerId or new details) instead of vin: registers the vehicle and customer and opens the job card in one step']]],
  ['Parts stock (FIFO)', [['GET', '/api/stock?q=', 'Stock on hand per part with FIFO value'], ['GET', '/api/stock/parts/:no', 'FIFO batches and recent movements of a part'], ['GET', '/api/stock/inwards', 'Goods receipts'], ['POST', '/api/stock/inwards', 'Record a goods receipt { supplier, invoiceNo, invoiceDate, lines: [{ partNo, qty, unitCost }] }'], ['POST', '/api/jobcards/:id/lines/:lid/issue', 'Issue an approved part line from stock, oldest batch first'], ['POST', '/api/jobcards/:id/issue-parts', 'Issue all approved part lines (all or nothing)'], ['POST', '/api/jobcards/:id/lines/:lid/return', 'Return issued parts { qty, reason } to the batches they came from'], ['GET', '/api/stock/adjustments', 'Stock counts and write-offs'], ['POST', '/api/stock/adjustments', 'Count: { type: "count", lines: [{ partNo, countedQty, systemQty }] } · Write-off: { type: "writeoff", reason, remarks, lines: [{ partNo, qty }] }'], ['GET', '/api/stock/writeoff-reasons', 'Reasons allowed for write-offs']]],
  ['Access control', [['GET', '/api/me', 'Current user, role and effective rights'], ['HEADER', 'X-User-Id: U001', 'Send on every request to act as that user (default: the first active Administrator)'], ['—', '403', 'Returned when the user’s role lacks the right; the message names the right']]],
  ['Masters (type = users | roles | rights | parts | labour | insurers | repairTypes | fuelTypes | transmissions | provinces | cities | dealers | outlets)', [['GET', '/api/masters', 'Summary of all masters with field definitions'], ['GET', '/api/masters/:type?q=&active=', 'List / search a master (active=true|false)'], ['GET', '/api/masters/:type/:key', 'One record, with where it is in use'], ['POST', '/api/masters/:type', 'Create (validated; duplicates rejected with 409)'], ['PATCH', '/api/masters/:type/:key', 'Update or activate/deactivate; renames cascade to job cards and vehicles'], ['DELETE', '/api/masters/:type/:key', 'Delete – blocked with 409 while in use'], ['PATCH', '/api/vehicles/:vin/insurance', 'Set insurer (from master), policy number and expiry']]],
  ['Catalog & admin', [['GET', '/api/catalog/parts?q=&source=', 'Parts with stock & MRP'], ['GET', '/api/catalog/labour?q=', 'Labour operations'], ['GET', '/api/catalog/packages', 'Service packages with prices and stock'], ['POST', '/api/admin/reset', 'Reset to sample data']]],
];
App.route('/api', async () => ({
  title: 'API reference',
  nav: 'api',
  html: `<div class="alert info" style="margin-bottom:16px">${ic('info')}<div>All endpoints return JSON. Errors use <span class="mono">{ "error": "message", "details": { "field": … } }</span> with 400 (validation), 404 (not found) or 409 (business rule) status codes.</div></div>
    ${API_DOCS.map(([g, list]) => `<div class="card" style="margin-bottom:14px;overflow:hidden"><div class="card-h"><h2>${g}</h2></div><table class="tbl rt"><tbody>${list.map(([m, u, d]) => `<tr><td class="lead" style="width:40%"><span class="badge ${{ GET: 'b-blue', POST: 'b-green', PATCH: 'b-amber', PUT: 'b-violet', DELETE: 'b-red', HEADER: 'b-slate' }[m] || 'b-slate'}" style="min-width:58px;justify-content:center">${m}</span> <span class="mono">${esc(u)}</span></td><td data-l="">${esc(d)}</td></tr>`).join('')}</tbody></table></div>`).join('')}`,
}));

/* ================= Settings ================= */
App.route('/settings', async () => ({
  title: 'Settings',
  nav: 'settings',
  html: `<div class="stack" style="max-width:720px">
    <div class="card"><div class="card-h"><h2>Workshop</h2>${App.can('settings.manage') ? `<button class="btn sm" onclick="workshopProfileModal()">${ic('edit', 'sm')}Edit profile</button>` : ''}</div><div class="card-b"><dl class="kv"><div><dt>Trading name</dt><dd>${esc(App.meta?.workshop.name)}</dd></div><div><dt>Legal name</dt><dd>${esc(App.meta?.workshop.legalName || '—')}</dd></div><div><dt>ABN</dt><dd class="mono">${esc(App.meta?.workshop.abn || '—')}</dd></div><div><dt>Address</dt><dd>${esc([App.meta?.workshop.address, App.meta?.workshop.suburb, App.meta?.workshop.state, App.meta?.workshop.postcode].filter(Boolean).join(', '))}</dd></div><div><dt>Phone</dt><dd>${esc(App.meta?.workshop.phone || '—')}</dd></div><div><dt>GST</dt><dd>${App.meta?.workshop.gstPct}% · AUD</dd></div><div><dt>Payments</dt><dd>${App.meta?.workshop.bsb ? `BSB ${esc(App.meta.workshop.bsb)} · Acc ${esc(App.meta.workshop.accountNo)}` : '—'}${App.meta?.workshop.payId ? ` · PayID ${esc(App.meta.workshop.payId)}` : ''}</dd></div></dl></div></div>
    <div class="card"><div class="card-h"><h2>Signed in as</h2><button class="btn sm" onclick="userMenu()">${App.authMode === 'password' ? 'Account' : 'Switch user'}</button></div><div class="lrow"><span class="avatar">${initials(App.me?.user.name || '?')}</span><div class="grow"><div class="t">${esc(App.me?.user.name || '—')}</div><div class="small muted">${esc(App.me?.role?.name || 'No role')} · ${App.me?.rights.length || 0} rights</div></div>${App.can('masters.view') ? '<a class="btn sm ghost" href="#/masters/roles">Roles &amp; rights</a>' : ''}</div></div>
    <div class="card show-sm"><div class="card-h"><h2>Masters</h2></div>
      ${(App.can('masters.view') ? [['users', 'Users', 'user'], ['roles', 'Roles', 'shield'], ['rights', 'Rights', 'check'], ['parts', 'Parts', 'box'], ['labour', 'Labour', 'wrench'], ['insurers', 'Insurance companies', 'shield'], ['repairTypes', 'Repair types', 'wrench'], ['fuelTypes', 'Fuel types', 'flag'], ['transmissions', 'Transmission types', 'settings'], ['dealers', 'Dealers', 'box'], ['outlets', 'Outlets', 'wrench'], ['provinces', 'States & territories', 'flag'], ['cities', 'Cities', 'grid']] : []).map(([k, l, i]) => `<a class="lrow" href="#/masters/${k}" style="color:inherit;text-decoration:none"><span class="vicon">${ic(i)}</span><div class="grow"><div class="t">${l}</div></div>${ic('chevron')}</a>`).join('')}
      ${App.can('stock.view') ? `<a class="lrow" href="#/stock" style="color:inherit;text-decoration:none"><span class="vicon">${ic('box')}</span><div class="grow"><div class="t">Parts stock</div><div class="small muted">Stock on hand, FIFO batches, goods receipts</div></div>${ic('chevron')}</a>` : ''}
      <a class="lrow" href="#/api" style="color:inherit;text-decoration:none"><span class="vicon">${ic('code')}</span><div class="grow"><div class="t">API reference</div></div>${ic('chevron')}</a></div>
    <div class="card"><div class="card-h"><h2>Administration</h2></div>
      ${[['#/admin/lists', 'Dropdown lists', 'Bays, delay and decline reasons, vans, feedback questions', 'menu', true], ['#/admin/import', 'Import data', 'Customers & vehicles, parts with opening stock, labour – from CSV', 'download', App.can('admin.data')], ['#/admin/backup', 'Backup & restore', 'Download a full backup or restore one', 'shield', App.can('admin.data')], ['#/admin/audit', 'Audit log', 'Who changed what', 'clipboard', App.can('audit.view')], ['#/messages', 'Messages outbox', 'SMS and email sent to customers', 'mail', App.can('messages.send')]].filter((x) => x[4]).map(([h, t, d, i]) => `<a class="lrow" href="${h}" style="color:inherit;text-decoration:none"><span class="vicon">${ic(i)}</span><div class="grow"><div class="t">${t}</div><div class="small muted">${d}</div></div>${ic('chevron')}</a>`).join('')}</div>
    <div class="card ${App.can('admin.reset') ? '' : 'hide'}"><div class="card-h"><h2>Demo data</h2></div><div class="card-b"><p class="muted" style="margin-top:0">Restore the sample vehicles and job cards. Everything you changed will be lost.</p><button class="btn danger" onclick="resetData(this)">${ic('refresh', 'sm')}Reset demo data</button></div></div>
  </div>`,
}));
async function resetData(btn) {
  if (!(await confirmBox('Reset demo data?', 'All job cards, vehicles and changes go back to the sample data. This cannot be undone.', 'Reset', true))) return;
  if (await act(btn, () => api('POST', '/admin/reset'), 'Demo data restored')) { App.updateBadges(); App.go('#/'); }
}
