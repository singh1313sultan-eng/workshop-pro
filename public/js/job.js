/* Workshop Pro – job card (active job card) screen */
'use strict';

const FUEL = ['Empty', '¼', '½', '¾', 'Full'];
const MARKS = { damage: ['Damage', '#dc2626', 'D'], scratch: ['Scratch', '#d97706', 'S'], dent: ['Dent', '#7c3aed', 'N'], missing: ['Missing', '#0f172a', 'M'], corrosion: ['Corrosion', '#92400e', 'C'] };
const SECTION_LABEL = { reception: 'Reception', interior: 'Interior', exterior: 'Exterior', engine: 'Engine bay', boot: 'Boot' };
let J = null; // the job card currently on screen

/* call the API for the current job, then re-render */
async function jobCall(btn, method, path, body, okMsg) {
  const res = await act(btn, () => api(method, `/jobcards/${J.id}${path}`, body), okMsg);
  if (res) { closeModal(); App.updateBadges(); await App.refresh(); }
  return res;
}

App.route('/jobs/:id', async ({ id }, q) => {
  J = await api('GET', '/jobcards/' + encodeURIComponent(id));
  const tab = q.get('tab') || 'overview';
  const v = J.vehicle, s = J.summary, closed = J.status === 'closed', hold = J.status === 'on_hold';
  const pending = J.lines.filter((l) => l.status === 'pending').length;
  const stageIdx = J.stages.findIndex((x) => x.key === J.stage);
  const t = (k, l, n, cls = '') => `<button class="${tab === k ? 'on' : ''}" onclick="App.go('#/jobs/${J.id}?tab=${k}')">${l}${n ? `<span class="n ${cls}">${n}</span>` : ''}</button>`;
  const notIssued = toIssue().length + labourToIssue().length;
  const bodies = { overview: tabOverview, work: tabWork, issue: tabIssue, inspection: tabInspection, billing: tabBilling, feedback: tabFeedback, files: () => tabFiles(), activity: tabActivity };
  return {
    title: J.id,
    nav: 'jobs',
    back: '#/jobs',
    html: `
    <div class="card"><div class="card-b">
      <div class="row between wrap" style="gap:14px;align-items:flex-start">
        <div style="min-width:0">
          <div class="row wrap" style="gap:8px"><h1>${esc(J.id)}</h1>${statusBadge(J.status)}${stageBadge(J.stage)}${J.customerWaiting && !closed ? '<span class="badge b-blue">Customer waiting</span>' : ''}</div>
          <div class="row wrap" style="margin-top:6px;gap:14px">${vehLine(v)}<span class="muted">${esc(v.variant)}</span><span>${ic('user', 'sm')} ${esc(v.owner.name)}</span><a href="tel:${esc(v.owner.phone)}">${ic('phone', 'sm')} ${esc(fmtPhone(v.owner.phone))}</a></div>
        </div>
        <div class="row wrap no-print" style="gap:8px">
          <button class="btn" onclick="vehicleDrawer()">${ic('info', 'sm')}<span class="hide-sm">Vehicle & customer</span></button>
          <button class="btn icon" title="Print job card" onclick="printJob()">${ic('print', 'sm')}</button>
          ${App.can('messages.send') ? `<button class="btn icon" title="Message customer (SMS / email)" onclick="messageModal({ jobId: '${J.id}' })">${ic('mail', 'sm')}</button>` : ''}
          ${clockButton(J.id, closed)}
          ${(closed ? App.can('jobs.reopen') : App.can('jobs.hold') || App.can('jobs.close')) ? `<button class="btn primary" onclick="statusModal()">${closed ? ic('unlock', 'sm') + 'Reopen' : 'Update status'}</button>` : ''}
        </div>
      </div>
      <dl class="kv" style="margin-top:16px;grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">
        <div><dt>Job type</dt><dd>${esc(J.jobType)}</dd></div>
        <div><dt>Checked in</dt><dd>${fmtDT(J.arrivedAt)}</dd></div>
        <div><dt>Promised delivery</dt><dd style="${s.overdue ? 'color:var(--red)' : ''}">${fmtDT(J.promisedAt)} ${!closed && App.can('jobs.edit') ? `<button class="btn ghost sm icon no-print" title="Reschedule" onclick="rescheduleModal()">${ic('edit', 'sm')}</button>` : ''}${s.overdue ? '<div class="small">Overdue</div>' : ''}</dd></div>
        <div><dt>Advisor</dt><dd>${esc(J.advisor)}</dd></div>
        <div><dt>Technician / bay</dt><dd>${esc(J.technician || 'Not assigned')}${J.bay ? ' · ' + esc(J.bay) : ''}</dd></div>
        <div><dt>Estimate</dt><dd>${money(J.estimate.total)}${pending ? ` <span class="badge b-amber">${pending} pending</span>` : ''}</dd></div>
      </dl>
    </div>
    <div class="card-b no-print" style="border-top:1px solid var(--line-2);padding-top:14px">
      <div class="stepper">${J.stages.map((st, i) => `<button class="${i < stageIdx ? 'done' : i === stageIdx ? 'cur' : ''}" ${closed || hold || st.key === 'delivered' || i === stageIdx ? 'disabled' : ''} onclick="moveStage('${st.key}','${esc(st.label)}')" title="${i === stageIdx ? 'Current stage' : st.key === 'delivered' ? 'Close the job card to deliver' : 'Move to ' + esc(st.label)}"><i></i>${esc(st.label)}</button>`).join('')}</div>
    </div></div>

    ${closed ? `<div class="alert ok" style="margin-top:12px">${ic('check')}<div style="flex:1">Delivered and closed${J.invoice ? ` · Invoice <b>${esc(J.invoice.number)}</b> for ${money(J.invoice.total)}` : ''}. Reopen the job card to make changes.</div></div>` : ''}
    ${hold ? `<div class="alert warn" style="margin-top:12px">${ic('clock')}<div style="flex:1">This job card is <b>on hold</b>. Work is paused until it is resumed.</div><button class="btn sm" onclick="statusModal()">Resume</button></div>` : ''}
    ${v.alerts.map((al) => `<div class="alert ${al.level === 'critical' ? 'crit' : 'warn'}" style="margin-top:12px">${ic('alert')}<div>${esc(al.text)}</div></div>`).join('')}

    <div class="tabs no-print" style="margin:16px 0">
      ${t('overview', 'Overview')}${t('work', 'Work & estimate', pending || '', 'b-amber')}${t('issue', 'Parts & labour issue', notIssued || '', 'b-amber')}${t('inspection', 'Inspection', countIssues() || '')}${t('billing', J.claim ? 'Billing & claim' : 'Billing')}${t('feedback', 'Feedback')}${t('files', 'Photos & files')}${t('activity', 'Activity', J.activity.length)}
    </div>
    <div id="jobTab">${(bodies[tab] || tabOverview)()}</div>`,
    after: tab === 'inspection' ? bindInspection : undefined,
  };
});
function countIssues() { return Object.values(J.inspection).flat().filter((x) => !x.ok).length + J.damages.length; }

/* ---------------- Overview ---------------- */
function tabOverview() {
  const e = App.ui.editCheckin && !J.status.includes('closed');
  const L = App.meta.lookups;
  const opt = (arr, cur) => arr.map((o) => `<option ${o === cur ? 'selected' : ''}>${esc(o)}</option>`).join('');
  const checkin = e ? `
    <form id="ciForm" class="grid g2">
      <label class="f">Job type<select class="inp" name="jobType">${opt(L.jobTypes, J.jobType)}</select></label>
      <label class="f">Odometer (km)<input class="inp" name="odometer" type="number" inputmode="numeric" value="${J.odometer}"></label>
      <label class="f" style="grid-column:1/-1">Fuel level<div class="fuel" id="fuelSel">${FUEL.map((f, i) => `<button type="button" class="${J.fuelLevel === i ? 'on' : ''}" data-v="${i}">${f}</button>`).join('')}</div></label>
      <label class="f">Driven in by<select class="inp" name="drivenBy">${opt(L.drivenBy, J.drivenBy)}</select></label>
      <label class="f">Service van<select class="inp" name="serviceVan"><option value="">Not used</option>${opt(L.serviceVans, J.serviceVan)}</select></label>
      <label class="f">Technician<select class="inp" name="technician"><option value="">Not assigned</option>${opt(L.technicians, J.technician)}</select></label>
      <label class="f">Bay<select class="inp" name="bay"><option value="">Not assigned</option>${opt(L.bays, J.bay)}</select></label>
      <div class="stack" style="grid-column:1/-1;gap:10px">
        <label class="check"><input type="checkbox" name="odometerFaulty" ${J.odometerFaulty ? 'checked' : ''}>Odometer not working</label>
        <label class="check"><input type="checkbox" name="customerWaiting" ${J.customerWaiting ? 'checked' : ''}>Customer is waiting at the workshop</label>
        <label class="check"><input type="checkbox" name="lift" ${J.lift ? 'checked' : ''}>Needs a lift</label>
        <label class="check"><input type="checkbox" name="repeatRepair" ${J.repeatRepair ? 'checked' : ''}>Repeat repair (came back for the same issue)</label>
        <label class="check"><input type="checkbox" name="wash" ${J.extras.wash ? 'checked' : ''}>Exterior wash</label>
        <label class="check"><input type="checkbox" name="interiorClean" ${J.extras.interiorClean ? 'checked' : ''}>Interior cleaning</label>
      </div>
    </form>` : `
    <dl class="kv">
      <div><dt>Odometer</dt><dd>${J.odometerFaulty ? 'Not working' : Number(J.odometer).toLocaleString('en-AU') + ' km'}</dd></div>
      <div><dt>Fuel level</dt><dd>${FUEL[J.fuelLevel]}</dd></div>
      <div><dt>Driven in by</dt><dd>${esc(J.drivenBy)}</dd></div>
      <div><dt>Lift</dt><dd>${J.lift ? 'Yes' : 'No'}</dd></div>
      <div><dt>Repeat repair</dt><dd>${J.repeatRepair ? 'Yes' : 'No'}</dd></div>
      <div><dt>Service van</dt><dd>${esc(J.serviceVan || 'Not used')}</dd></div>
      <div><dt>Extras</dt><dd>${[J.extras.wash && 'Exterior wash', J.extras.interiorClean && 'Interior cleaning'].filter(Boolean).join(', ') || 'None'}</dd></div>
      <div><dt>Customer waiting</dt><dd>${J.customerWaiting ? 'Yes' : 'No'}</dd></div>
    </dl>`;
  const ap = J.approval;
  return `<div class="split">
    <div class="stack">
      <div class="card"><div class="card-h"><h2>Check-in details</h2>${J.status === 'closed' || !App.can('jobs.edit') ? '' : e ? `<button class="btn sm" onclick="App.ui.editCheckin=false;App.refresh()">Cancel</button><button class="btn sm primary" onclick="saveCheckin(this)">Save</button>` : `<button class="btn sm" onclick="App.ui.editCheckin=true;App.refresh()">${ic('edit', 'sm')}Edit</button>`}</div><div class="card-b">${checkin}</div></div>
      <div class="card"><div class="card-h"><h2>Customer concerns</h2><a class="small" href="#/jobs/${J.id}?tab=work">Manage work</a></div>
        ${J.concerns.map((c) => `<div class="lrow"><span class="badge ${c.kind === 'voice' ? 'b-blue' : 'b-violet'}">${c.kind === 'voice' ? 'Customer' : 'Advisor'}</span><div class="grow"><div class="t">${esc(c.text)}</div>${c.observation ? `<div class="small muted">Observation: ${esc(c.observation)}</div>` : ''}</div></div>`).join('') || '<div class="empty small">No concerns recorded.</div>'}
      </div>
    </div>
    <div class="stack">
      <div class="card"><div class="card-h"><h3>Customer</h3><a class="small" href="#/vehicles/${J.vin}">Vehicle profile</a></div><div class="card-b"><dl class="kv" style="grid-template-columns:1fr">
        <div><dt>Name</dt><dd>${esc(J.vehicle.owner.name)}</dd></div><div><dt>Mobile</dt><dd><a href="tel:${esc(J.vehicle.owner.phone)}">${esc(fmtPhone(J.vehicle.owner.phone))}</a></dd></div>
        <div><dt>Email</dt><dd>${esc(J.vehicle.owner.email || '—')}</dd></div><div><dt>Address</dt><dd>${esc(J.vehicle.owner.address)}</dd></div></dl></div></div>
      <div class="card"><div class="card-h"><h3>Campaigns</h3></div>${J.campaigns.map((c) => { const meta = App.meta.campaigns.find((x) => x.id === c.id) || {}; return `<div class="lrow"><div class="grow"><div class="t" style="white-space:normal">${esc(c.name)}</div><div class="small muted">${esc(meta.type || '')}${meta.discountPct ? ` · ${meta.discountPct}% off parts` : ''}</div></div>
        <label class="switch" title="${c.applied ? 'Remove' : 'Apply'}"><input type="checkbox" ${c.applied ? 'checked' : ''} ${J.status === 'closed' ? 'disabled' : ''} onchange="jobCall(null,'POST','/campaigns/${c.id}',{applied:this.checked},this.checked?'Campaign applied':'Campaign removed')"><span></span></label></div>`; }).join('')}</div>
      ${ap ? `<div class="card"><div class="card-h"><h3>Customer authorisation</h3></div><div class="card-b">${ap.signature ? `<img src="${ap.signature}" alt="Customer signature" style="width:100%;max-height:120px;object-fit:contain;border:1px solid var(--line);border-radius:10px;background:#fff">` : `<div class="alert info">${ic('phone')}<div>Approved over the phone – customer was not present.</div></div>`}<div class="small muted" style="margin-top:8px">${fmtDT(ap.at)}${ap.remarks ? ' · ' + esc(ap.remarks) : ''}</div></div></div>` : ''}
    </div></div>`;
}
async function saveCheckin(btn) {
  const f = $('#ciForm');
  const fd = Object.fromEntries(new FormData(f));
  const body = { jobType: fd.jobType, odometer: fd.odometer, drivenBy: fd.drivenBy, serviceVan: fd.serviceVan, technician: fd.technician, bay: fd.bay,
    fuelLevel: Number($('#fuelSel .on')?.dataset.v ?? J.fuelLevel), odometerFaulty: !!fd.odometerFaulty, customerWaiting: !!fd.customerWaiting, lift: !!fd.lift, repeatRepair: !!fd.repeatRepair,
    extras: { wash: !!fd.wash, interiorClean: !!fd.interiorClean } };
  if (await act(btn, () => api('PATCH', `/jobcards/${J.id}`, body), 'Check-in details saved')) { App.ui.editCheckin = false; App.refresh(); }
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('#fuelSel button, #wFuel button');
  if (b) { b.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); }
});

/* ---------------- Work & estimate ---------------- */
function tabWork() {
  const closed = J.status === 'closed';
  const groups = [...J.concerns.map((c) => ({ c, lines: J.lines.filter((l) => l.concernId === c.id) })), { c: null, lines: J.lines.filter((l) => !J.concerns.some((c) => c.id === l.concernId)) }].filter((g) => g.c || g.lines.length);
  const lineHtml = (l) => `<div class="lineitem">
      <div class="d"><b title="${esc(l.description)}">${esc(l.description)}</b><span class="small muted"><span class="mono">${esc(l.code)}</span> · ${l.kind === 'part' ? 'Part' : 'Labour'}${l.kind === 'part' ? ` · ${l.stock > 0 ? `<span style="color:var(--green)">${l.stock} in stock</span>` : '<span style="color:var(--red)">Out of stock</span>'}` : ''}${l.blocked ? ' · <span class="badge b-dark" style="height:18px">Stock reserved</span>' : ''}${issueBadge(l)}${J.claim ? ` · <button class="badge payer-tag ${l.payer === 'customer' ? 'b-blue' : 'b-violet'}" style="height:18px" title="Click to change who pays" ${closed ? 'disabled' : `onclick="jobCall(null,'PATCH','/lines/${l.id}',{payer:'${l.payer === 'customer' ? 'claim' : 'customer'}'},'Updated')"`}>${l.payer === 'customer' ? 'Customer pays' : J.claim.type === 'insurance' ? 'Insurer pays' : 'Warranty'}</button>` : ''}${l.reason ? ` · ${esc(l.reason)}` : ''}</span></div>
      <div class="q">${l.kind === 'part' ? `<input class="qty" type="number" min="0.1" step="any" value="${l.qty}" ${closed || !App.can('jobs.estimate') ? 'disabled' : ''} onchange="jobCall(null,'PATCH','/lines/${l.id}',{qty:this.value},'Quantity updated')" aria-label="Quantity">` : '<span class="muted small">1 job</span>'}</div>
      <div class="a right"><b>${money(l.amount)}</b>${l.discountPct ? `<div class="small muted">−${l.discountPct}%</div>` : ''}</div>
      <div class="s"><div class="approve" role="group" aria-label="Customer approval">
        <button class="pd ${l.status === 'pending' ? 'on' : ''}" ${closed || !App.can('jobs.approve') ? 'disabled' : ''} onclick="setLine(${l.id},'pending')">Pending</button>
        <button class="ap ${l.status === 'approved' ? 'on' : ''}" ${closed || !App.can('jobs.approve') ? 'disabled' : ''} onclick="setLine(${l.id},'approved')">Approve</button>
        <button class="dc ${l.status === 'declined' ? 'on' : ''}" ${closed || !App.can('jobs.approve') ? 'disabled' : ''} onclick="setLine(${l.id},'declined')">Decline</button></div></div>
      <div class="x row" style="gap:4px">${closed ? '' : `
        ${l.kind === 'part' && App.can('jobs.estimate') ? `<button class="btn ghost sm icon" title="Replace part" onclick="replaceModal(${l.id})">${ic('swap', 'sm')}</button>
        <button class="btn ghost sm icon" title="${l.blocked ? 'Release stock' : 'Reserve stock'}" onclick="jobCall(this,'PATCH','/lines/${l.id}',{blocked:${!l.blocked}},'${l.blocked ? 'Stock released' : 'Stock reserved'}')">${ic(l.blocked ? 'lock' : 'unlock', 'sm')}</button>` : ''}
        ${App.can('jobs.estimate') ? `<button class="btn ghost sm icon" title="Remove line" onclick="removeLine(${l.id})">${ic('trash', 'sm')}</button>` : ''}`}</div>
    </div>`;
  const total = (ls) => ls.filter((l) => l.status !== 'declined').reduce((s, l) => s + l.amount, 0);
  return `<div class="split">
    <div>
      <div class="row between wrap" style="margin-bottom:12px;gap:8px">
        <div class="muted small">Group work under each customer concern. Approve or decline each line with the customer.</div>
        ${closed ? '' : `<div class="row wrap" style="gap:8px">${toIssue().length + labourToIssue().length ? `<a class="btn sm" href="#/jobs/${J.id}?tab=issue">${ic('box', 'sm')}Issue parts & labour (${toIssue().length + labourToIssue().length})</a>` : ''}${J.lines.some((l) => l.status === 'pending') && App.can('jobs.approve') ? `<button class="btn sm" onclick="approveAll(this)">${ic('check', 'sm')}Approve all pending</button>` : ''}<button class="btn sm primary" onclick="concernModal()" ${App.can('jobs.edit') ? '' : 'hidden'}>${ic('plus', 'sm')}Add concern</button></div>`}
      </div>
      ${groups.map(({ c, lines }) => `<div class="concern">
        <div class="concern-h">
          ${c ? `<span class="badge ${c.kind === 'voice' ? 'b-blue' : 'b-violet'}">${c.kind === 'voice' ? 'Customer' : 'Advisor'}</span>` : '<span class="badge b-slate">Other</span>'}
          <div class="grow"><b>${esc(c ? c.text : 'Additional work')}</b>${c?.observation ? `<div class="small muted">Observation: ${esc(c.observation)}</div>` : ''}</div>
          <div class="right"><b>${money(total(lines))}</b><div class="small muted">${lines.length} line${lines.length === 1 ? '' : 's'}</div></div>
          ${closed || !App.can('jobs.edit') ? '' : `<div class="row" style="gap:4px">${c ? `<button class="btn ghost sm icon" title="Edit concern" onclick="concernModal(${c.id})">${ic('edit', 'sm')}</button><button class="btn ghost sm icon" title="Remove concern" onclick="removeConcern(${c.id})">${ic('trash', 'sm')}</button>` : ''}<button class="btn sm" onclick="addWorkModal(${c ? c.id : 'null'})">${ic('plus', 'sm')}Add work</button></div>`}
        </div>
        ${lines.length ? `<div class="lines">${lines.map(lineHtml).join('')}</div>` : `<div class="lines"><div class="empty small" style="padding:16px">No work added yet.</div></div>`}
      </div>`).join('') || `<div class="card empty"><h3>No work yet</h3><p>Add a customer concern, then add packages, parts or labour to it.</p></div>`}
    </div>
    <div class="stack" style="position:sticky;top:80px">
      <div class="card"><div class="card-h"><h3>Estimate</h3><span class="small muted">excl. declined</span></div><div class="card-b">${totalsHtml(J.estimate)}</div></div>
      <div class="card"><div class="card-h"><h3>Approved so far</h3></div><div class="card-b">${totalsHtml(J.billing)}</div></div>
    </div></div>`;
}
function totalsHtml(t) {
  return `<div class="totals"><div class="r"><span>Parts</span><b>${money(t.parts)}</b></div><div class="r"><span>Labour</span><b>${money(t.labour)}</b></div>
    ${t.campaignDiscount ? `<div class="r"><span>Campaign discount</span><b style="color:var(--green)">− ${money(t.campaignDiscount)}</b></div>` : ''}
    <div class="r"><span>GST ${t.gstPct}%</span><b>${money(t.tax)}</b></div><div class="r t"><span style="color:var(--ink)">Total</span><span>${money(t.total)}</span></div></div>`;
}
/* ---- issue: parts from stock (FIFO), labour to the workshop ---- */
const toIssue = () => J.lines.filter((l) => l.kind === 'part' && l.status === 'approved' && (l.issuedQty || 0) < l.qty);
const labourToIssue = () => J.lines.filter((l) => l.kind === 'labour' && l.status === 'approved' && !l.labourIssue);
function issueBadge(l) {
  if (l.status !== 'approved') return '';
  if (l.kind === 'labour') return l.labourIssue ? ` · <span class="badge b-green" style="height:18px">Issued${l.labourIssue.to ? ' to ' + esc(l.labourIssue.to) : ''}</span>` : ' · <span class="badge b-amber" style="height:18px">Not issued</span>';
  const iq = l.issuedQty || 0;
  if (iq >= l.qty) return ` · <span class="badge b-green" style="height:18px" title="${l.issueLegacy ? 'Issued before stock tracking' : 'FIFO cost ' + money(l.issueCost || 0)}">Issued${l.issueCost ? ' · cost ' + money(l.issueCost) : ''}</span>`;
  return ` · <span class="badge b-amber" style="height:18px">${iq ? `Issued ${iq} of ${l.qty}` : 'Not issued'}</span>`;
}
function issueStatus(l) {
  if (l.kind === 'labour') return l.labourIssue ? '<span class="badge b-green">Issued</span>' : '<span class="badge b-amber">Not issued</span>';
  const iq = l.issuedQty || 0;
  return iq >= l.qty ? '<span class="badge b-green">Issued</span>' : iq ? `<span class="badge b-amber">Part issued · ${iq} of ${l.qty}</span>` : '<span class="badge b-amber">Not issued</span>';
}
function tabIssue() {
  const closed = J.status === 'closed';
  const approved = J.lines.filter((l) => l.status === 'approved');
  const parts = approved.filter((l) => l.kind === 'part');
  const labour = approved.filter((l) => l.kind === 'labour');
  const waiting = J.lines.filter((l) => l.status === 'pending').length;
  const techs = (App.meta.users || []).filter((u) => u.active !== false && /technician/i.test(u.role || ''));
  const canParts = App.can('stock.issue') && !closed, canLab = App.can('jobs.edit') && !closed;
  const techSel = (l) => `<select class="inp" id="tech${l.id}" style="height:34px;min-width:140px" aria-label="Technician"><option value="">${J.technician ? 'Job technician (' + esc(J.technician) + ')' : 'No technician'}</option>${techs.map((u) => `<option>${esc(u.name)}</option>`).join('')}</select>`;
  const partRow = (l) => {
    const iq = l.issuedQty || 0;
    return `<tr><td><b>${esc(l.description)}</b><div class="small muted mono">${esc(l.code)}</div></td>
      <td class="right">${l.qty}</td><td class="right">${iq}</td>
      <td>${l.stock == null ? '—' : l.stock > 0 ? `<span style="color:var(--green)">${l.stock}</span>` : '<span style="color:var(--red)">0</span>'}</td>
      <td>${issueStatus(l)}${iq && l.issueCost ? `<div class="small muted">FIFO cost ${money(l.issueCost)}</div>` : ''}</td>
      <td class="right"><div class="row" style="gap:6px;justify-content:flex-end">${canParts && iq < l.qty ? `<button class="btn sm primary" onclick="jobCall(this,'POST','/lines/${l.id}/issue',{},'Issued from stock')">${ic('box', 'sm')}Issue</button>` : ''}${canParts && iq > 0 ? `<button class="btn sm" onclick="returnModal(${l.id})">${ic('refresh', 'sm')}Return</button>` : ''}</div></td></tr>`;
  };
  const labRow = (l) => `<tr><td><b>${esc(l.description)}</b><div class="small muted mono">${esc(l.code)}</div></td>
      <td>${issueStatus(l)}</td>
      <td>${l.labourIssue ? `${esc(l.labourIssue.to || '—')}<div class="small muted">${fmtDT(l.labourIssue.at)} · by ${esc(l.labourIssue.by)}</div>` : canLab ? techSel(l) : '—'}</td>
      <td class="right"><div class="row" style="gap:6px;justify-content:flex-end">${canLab ? (l.labourIssue ? `<button class="btn sm" onclick="jobCall(this,'POST','/lines/${l.id}/unissue-labour',{},'Set back to not issued')">Set to not issued</button>` : `<button class="btn sm primary" onclick="jobCall(this,'POST','/lines/${l.id}/issue-labour',{technician:$('#tech${l.id}').value},'Labour issued')">${ic('wrench', 'sm')}Issue</button>`) : ''}</div></td></tr>`;
  const head = (title, n, done, btn) => `<div class="card-h"><h2>${title}</h2><span class="small muted">${done} of ${n} issued</span><div class="grow"></div>${btn}</div>`;
  return `<div class="stack">
    ${waiting ? `<div class="alert info">${ic('info')}<div>${waiting} line(s) are waiting for customer approval on the <a href="#/jobs/${J.id}?tab=work">Work & estimate</a> tab. Only approved work can be issued.</div></div>` : ''}
    <div class="card">${head('Parts', parts.length, parts.filter((l) => (l.issuedQty || 0) >= l.qty).length, canParts && toIssue().length ? `<button class="btn sm primary" onclick="issueAll(this)">${ic('box', 'sm')}Issue all parts (${toIssue().length})</button>` : '')}
      ${parts.length ? `<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Part</th><th class="right">Qty</th><th class="right">Issued</th><th>In stock</th><th>Status</th><th></th></tr></thead><tbody>${parts.map(partRow).join('')}</tbody></table></div>` : '<div class="empty small" style="padding:16px">No approved parts.</div>'}
      <div class="card-b small muted" style="border-top:1px solid var(--line-2)">Parts are issued from stock oldest batch first (FIFO). Returned parts go back into the batches they came from.</div></div>
    <div class="card">${head('Labour', labour.length, labour.filter((l) => l.labourIssue).length, canLab && labourToIssue().length ? `<button class="btn sm primary" onclick="issueAllLabour(this)">${ic('wrench', 'sm')}Issue all labour (${labourToIssue().length})</button>` : '')}
      ${labour.length ? `<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Labour</th><th>Status</th><th>Technician</th><th></th></tr></thead><tbody>${labour.map(labRow).join('')}</tbody></table></div>` : '<div class="empty small" style="padding:16px">No approved labour.</div>'}</div>
  </div>`;
}
async function issueAllLabour(btn) {
  const ls = labourToIssue();
  if (!(await confirmBox('Issue all labour?', `${ls.length} labour line(s) will be issued${J.technician ? ' to ' + esc(J.technician) : ''}:<br>${ls.map((l) => '• ' + esc(l.description)).join('<br>')}`, 'Issue labour'))) return;
  jobCall(btn, 'POST', '/issue-labour', {}, 'Labour issued');
}
async function issueAll(btn) {
  const ls = toIssue();
  if (!(await confirmBox('Issue approved parts?', `${ls.length} part line(s) will be issued from stock, oldest batches first (FIFO):<br>${ls.map((l) => `• ${esc(l.description)} × ${l.qty - (l.issuedQty || 0)}`).join('<br>')}`, 'Issue parts'))) return;
  jobCall(btn, 'POST', '/issue-parts', {}, 'Parts issued from stock');
}
function returnModal(id) {
  const l = J.lines.find((x) => x.id === id);
  openModal({
    title: 'Return parts to stock',
    body: `<p class="muted" style="margin-top:0">${esc(l.description)} · <span class="mono">${esc(l.code)}</span> · ${l.issuedQty} issued</p>
      <div class="grid g2"><label class="f">Quantity to return<input class="inp" id="rtQ" type="number" min="0.1" step="any" max="${l.issuedQty}" value="${l.issuedQty}"></label>
      <label class="f">Reason<select class="inp" id="rtR"><option value="">Select…</option><option>Customer declined after issue</option><option>Wrong part issued</option><option>Not needed after diagnosis</option><option>Part damaged / defective</option></select></label></div>
      <div class="small muted" style="margin-top:8px">Returned parts go back into the batches they were issued from.</div>`,
    foot: `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="rtOk">Return to stock</button>`,
  });
  $('#rtOk').onclick = (e) => jobCall(e.currentTarget, 'POST', `/lines/${id}/return`, { qty: Number($('#rtQ').value), reason: $('#rtR').value }, 'Returned to stock');
}
function setLine(id, status) {
  if (status !== 'declined') return jobCall(null, 'PATCH', `/lines/${id}`, { status }, status === 'approved' ? 'Marked approved' : 'Marked pending');
  const l = J.lines.find((x) => x.id === id);
  openModal({
    title: 'Customer declined',
    body: `<p class="muted" style="margin-top:0">${esc(l.description)} · ${money(l.amount)}</p><label class="f">Reason<select class="inp" id="dcR" name="reason"><option value="">Select a reason</option>${App.meta.lookups.declineReasons.map((r) => `<option>${esc(r)}</option>`).join('')}</select></label>`,
    foot: `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn danger" id="dcOk">Mark declined</button>`,
  });
  $('#dcOk').onclick = (e) => jobCall(e.currentTarget, 'PATCH', `/lines/${id}`, { status: 'declined', reason: $('#dcR').value }, 'Marked declined');
}
async function approveAll(btn) {
  const pend = J.lines.filter((l) => l.status === 'pending');
  if (!(await confirmBox('Approve all pending work?', `${pend.length} line(s) worth ${money(pend.reduce((s, l) => s + l.amount, 0))} (before GST) will be marked as approved by the customer.`, 'Approve all'))) return;
  const ok = await act(btn, async () => { for (const l of pend) await api('PATCH', `/jobcards/${J.id}/lines/${l.id}`, { status: 'approved' }); return true; }, 'All pending lines approved');
  if (ok) { App.updateBadges(); App.refresh(); }
}
async function removeLine(id) {
  const l = J.lines.find((x) => x.id === id);
  if (await confirmBox('Remove line?', `Remove “${esc(l.description)}” from the estimate?`, 'Remove', true)) jobCall(null, 'DELETE', `/lines/${id}`, null, 'Line removed');
}
async function removeConcern(id) {
  const c = J.concerns.find((x) => x.id === id);
  if (await confirmBox('Remove concern?', `“${esc(c.text)}” and all of its estimate lines will be removed.`, 'Remove', true)) jobCall(null, 'DELETE', `/concerns/${id}`, null, 'Concern removed');
}
function concernModal(id) {
  const c = id ? J.concerns.find((x) => x.id === id) : null;
  openModal({
    title: c ? 'Edit concern' : 'Add concern',
    body: `<div class="stack">${c ? '' : `<div class="seg" id="ckind"><button class="on" data-k="voice" type="button">Customer concern</button><button data-k="advice" type="button">Advisor recommendation</button></div>`}
      <label class="f">Description<input class="inp" id="cText" name="text" value="${esc(c?.text || '')}" placeholder="e.g. Brake noise when stopping"></label>
      <label class="f">Observation <span class="hint">What you found on inspection (optional)</span><textarea class="inp" id="cObs">${esc(c?.observation || '')}</textarea></label></div>`,
    foot: `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="cSave">${c ? 'Save' : 'Add concern'}</button>`,
  });
  $$('#ckind button').forEach((b) => (b.onclick = () => $$('#ckind button').forEach((x) => x.classList.toggle('on', x === b))));
  $('#cSave').onclick = (e) => c
    ? jobCall(e.currentTarget, 'PATCH', `/concerns/${c.id}`, { text: $('#cText').value, observation: $('#cObs').value }, 'Concern updated')
    : jobCall(e.currentTarget, 'POST', '/concerns', { kind: $('#ckind .on').dataset.k, text: $('#cText').value, observation: $('#cObs').value }, 'Concern added');
}

/* add packages / parts / labour (shared with the wizard via a callback) */
async function addWorkPicker({ title, onPick }) {
  const [pkgs, labour] = await Promise.all([api('GET', '/catalog/packages'), api('GET', '/catalog/labour')]);
  let tab = 'packages';
  const draw = async () => {
    let html = '';
    if (tab === 'packages') html = `<div class="stack" style="gap:8px">${pkgs.map((p) => `<button class="pkg" data-pkg="${p.code}"><span class="vicon">${ic('box')}</span><span style="flex:1;min-width:0"><b>${esc(p.name)}</b><div class="small muted">${esc(p.group)} · ${p.partsDetail.length} parts · ${p.minutes} min · ${p.inStock ? '<span style="color:var(--green)">parts in stock</span>' : '<span style="color:var(--red)">some parts out of stock</span>'}</div></span><b>${money(p.partsAmount + p.labourAmount)}</b></button>`).join('')}</div>`;
    if (tab === 'parts') html = `<div class="row" style="gap:8px"><select class="inp" id="pSrc" style="width:130px"><option value="">All</option><option>OEM</option><option>Local</option></select><input class="inp" id="pQ" placeholder="Search part no. or description"></div><div id="pRes" style="margin-top:10px"></div>`;
    if (tab === 'labour') html = `<input class="inp" id="lQ" placeholder="Search labour operations"><div id="lRes" style="margin-top:10px"></div>`;
    $('#awBody').innerHTML = html;
    $$('#awTabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
    if (tab === 'packages') $$('[data-pkg]').forEach((b) => (b.onclick = () => onPick({ packageCode: b.dataset.pkg }, b)));
    if (tab === 'parts') {
      const load = async () => {
        const res = await api('GET', '/catalog/parts?' + new URLSearchParams({ q: $('#pQ').value, source: $('#pSrc').value }));
        $('#pRes').innerHTML = res.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Part</th><th class="num">Stock</th><th class="num">Price ex GST</th><th class="num">Qty</th><th></th></tr></thead><tbody>${res.map((p) => `<tr><td><b>${esc(p.description)}</b><div class="small muted"><span class="mono">${esc(p.no)}</span> · ${esc(p.brand)} · ${esc(p.source)}</div></td><td class="num" style="color:${p.stock ? 'var(--green)' : 'var(--red)'}">${p.stock}</td><td class="num">${money(p.mrp)}</td><td class="num"><input class="qty" type="number" min="1" value="1" id="q_${esc(p.no)}"></td><td><button class="btn sm" data-part="${esc(p.no)}">Add</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty small">No parts found.</div>';
        $$('[data-part]').forEach((b) => (b.onclick = () => onPick({ kind: 'part', code: b.dataset.part, qty: Number($('#q_' + CSS.escape(b.dataset.part)).value) || 1 }, b)));
      };
      $('#pQ').oninput = load; $('#pSrc').onchange = load; load(); $('#pQ').focus();
    }
    if (tab === 'labour') {
      const drawL = () => {
        const t = $('#lQ').value.toLowerCase();
        const list = labour.filter((l) => !t || (l.code + l.description + l.group).toLowerCase().includes(t));
        const groups = [...new Set(list.map((l) => l.group))];
        $('#lRes').innerHTML = groups.map((g) => `<div class="small muted" style="font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin:12px 0 6px">${esc(g)}</div>${list.filter((l) => l.group === g).map((l) => `<div class="lrow" style="padding:10px 0"><div class="grow"><b>${esc(l.description)}</b><div class="small muted"><span class="mono">${esc(l.code)}</span> · ${l.minutes} min</div></div><b>${money(l.rate)}</b><button class="btn sm" data-lab="${esc(l.code)}">Add</button></div>`).join('')}`).join('') || '<div class="empty small">No labour operations found.</div>';
        $$('[data-lab]').forEach((b) => (b.onclick = () => onPick({ kind: 'labour', code: b.dataset.lab }, b)));
      };
      $('#lQ').oninput = drawL; drawL();
    }
  };
  openModal({ title, wide: true, body: `<div class="tabs" id="awTabs" style="margin:-8px 0 14px"><button data-t="packages">Service packages</button><button data-t="parts">Parts</button><button data-t="labour">Labour</button></div><div id="awBody"></div>` });
  $$('#awTabs button').forEach((b) => (b.onclick = () => { tab = b.dataset.t; draw(); }));
  draw();
}
function addWorkModal(concernId) {
  const c = J.concerns.find((x) => x.id === concernId);
  addWorkPicker({
    title: 'Add work' + (c ? ` · ${esc(c.text)}` : ''),
    onPick: (item, btn) => jobCall(btn, 'POST', '/lines', Object.assign({ concernId }, item), 'Added to estimate'),
  });
}
async function replaceModal(lineId) {
  const l = J.lines.find((x) => x.id === lineId);
  const alt = await api('GET', `/jobcards/${J.id}/lines/${lineId}/alternatives`);
  const opts = [...alt.superseded.map((p) => Object.assign({ kind: 'Superseded' }, p)), ...alt.alternate.map((p) => Object.assign({ kind: 'Alternate' }, p))];
  openModal({
    title: 'Replace part',
    wide: true,
    body: `<div class="alert info">${ic('info')}<div>Current: <b>${esc(l.description)}</b> <span class="mono">${esc(l.code)}</span> · ${money(l.rate)} · ${l.stock > 0 ? l.stock + ' in stock' : 'out of stock'}</div></div>
      ${opts.length ? `<div class="tbl-wrap" style="margin-top:12px"><table class="tbl"><thead><tr><th></th><th>Part</th><th>Type</th><th class="num">Stock</th><th class="num">Price ex GST</th></tr></thead><tbody>${opts.map((p, i) => `<tr class="click" onclick="this.querySelector('input').checked=true"><td><input type="radio" name="rp" value="${esc(p.no)}" ${i === 0 ? 'checked' : ''} style="accent-color:var(--primary);width:18px;height:18px"></td><td><b>${esc(p.description)}</b><div class="small muted mono">${esc(p.no)} · ${esc(p.brand)}</div></td><td><span class="badge ${p.kind === 'Superseded' ? 'b-teal' : 'b-slate'}">${p.kind}</span></td><td class="num" style="color:${p.stock ? 'var(--green)' : 'var(--red)'}">${p.stock}</td><td class="num">${money(p.mrp)}</td></tr>`).join('')}</tbody></table></div>
      <div class="grid g2" style="margin-top:14px"><label class="f">Reason<select class="inp" id="rpR" name="reason"><option value="">Select a reason</option>${App.meta.lookups.replaceReasons.map((r) => `<option>${esc(r)}</option>`).join('')}</select></label><label class="f">Comment<input class="inp" id="rpC" placeholder="Optional"></label></div>` : '<div class="empty">No superseded or alternate parts in the catalogue.</div>'}`,
    foot: opts.length ? `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="rpOk">Replace part</button>` : '',
  });
  if (opts.length) $('#rpOk').onclick = (e) => jobCall(e.currentTarget, 'POST', `/lines/${lineId}/replace`, { partNo: $('[name=rp]:checked')?.value, reason: $('#rpR').value, comment: $('#rpC').value }, 'Part replaced – needs customer approval again');
}

/* ---------------- Inspection ---------------- */
function tabInspection() {
  const sec = App.ui.inspSec || 'reception';
  const closed = J.status === 'closed';
  const sections = Object.keys(J.inspection);
  const left = `<div class="card" style="padding:8px"><div class="vlist">${[...sections, 'body'].map((k) => {
    const n = k === 'body' ? J.damages.length : J.inspection[k].filter((x) => !x.ok).length;
    return `<button class="${sec === k ? 'on' : ''}" onclick="App.ui.inspSec='${k}';App.refresh()">${k === 'body' ? 'Body condition' : SECTION_LABEL[k] || k}${n ? `<span class="badge b-red">${n}</span>` : ''}</button>`;
  }).join('')}</div></div>`;
  let right;
  if (sec === 'body') {
    right = `<div class="card"><div class="card-h"><h2>Body condition</h2>${closed ? '' : `<button class="btn sm" id="bmClear">Clear</button><button class="btn sm primary" id="bmSave">Save</button>`}</div><div class="card-b">
      <div class="legend" id="bmLegend">${Object.entries(MARKS).map(([k, [l, c]], i) => `<button type="button" data-t="${k}" class="${i === 0 ? 'on' : ''}"><i style="background:${c}"></i>${l}</button>`).join('')}</div>
      <p class="small muted">Choose a type, then tap the vehicle where the damage is. Tap a mark to remove it.</p>
      <div class="body-map" id="bodyMap">${topViewSvg()}</div></div></div>`;
  } else {
    const items = J.inspection[sec];
    right = `<div class="card"><div class="card-h"><h2>${SECTION_LABEL[sec] || sec}</h2><span class="small muted">${items.filter((x) => !x.ok).length} issue(s)</span>${closed ? '' : `<button class="btn sm primary" id="inspSave">Save section</button>`}</div><div class="card-b" id="inspList">
      ${items.map((it, i) => `<div class="chk-row" data-i="${i}"><div class="grow"><b>${esc(it.item)}</b></div>
        <select class="inp act" style="width:130px;height:34px" ${it.ok || closed ? 'disabled' : ''}>${['Inspect', 'Repair', 'Replace', 'Clean', 'Adjust'].map((a) => `<option ${it.action === a ? 'selected' : ''}>${a}</option>`).join('')}</select>
        <div class="okno"><button type="button" class="ok ${it.ok ? 'on' : ''}" ${closed ? 'disabled' : ''}>OK</button><button type="button" class="no ${!it.ok ? 'on' : ''}" ${closed ? 'disabled' : ''}>Not OK</button></div></div>`).join('')}
      ${sec === 'exterior' ? `<div style="margin-top:14px"><b>Tyre tread depth (mm)</b><div class="grid g4" style="margin-top:8px">${['Front right', 'Rear right', 'Rear left', 'Front left'].map((l, i) => `<label class="f">${l}<input class="inp tyre" type="number" step="0.1" min="0" max="20" value="${J.tyreDepth?.[i] ?? ''}" ${closed ? 'disabled' : ''}></label>`).join('')}</div></div>` : ''}
    </div></div>`;
  }
  return `<div class="insp">${left}${right}</div>`;
}
function bindInspection() {
  const sec = App.ui.inspSec || 'reception';
  if (sec === 'body') {
    let marks = J.damages.map((d) => Object.assign({}, d));
    let type = 'damage';
    const map = $('#bodyMap');
    const draw = () => {
      $$('.mark', map).forEach((m) => m.remove());
      marks.forEach((d, i) => {
        const [l, c, ch] = MARKS[d.type];
        const el = document.createElement('button');
        el.className = 'mark'; el.style.cssText = `left:${d.x}%;top:${d.y}%;background:${c}`; el.textContent = ch; el.title = l + ' – tap to remove';
        el.onclick = (e) => { e.stopPropagation(); if (J.status !== 'closed') { marks.splice(i, 1); draw(); } };
        map.appendChild(el);
      });
    };
    $$('#bmLegend button').forEach((b) => (b.onclick = () => { type = b.dataset.t; $$('#bmLegend button').forEach((x) => x.classList.toggle('on', x === b)); }));
    map.onclick = (e) => {
      if (J.status === 'closed') return;
      const r = map.getBoundingClientRect();
      marks.push({ x: +(((e.clientX - r.left) / r.width) * 100).toFixed(1), y: +(((e.clientY - r.top) / r.height) * 100).toFixed(1), type });
      draw();
    };
    $('#bmClear') && ($('#bmClear').onclick = () => { marks = []; draw(); });
    $('#bmSave') && ($('#bmSave').onclick = (e) => jobCall(e.currentTarget, 'PUT', '/damages', { damages: marks }, 'Body condition saved'));
    draw();
  } else {
    $$('#inspList .chk-row').forEach((row) => {
      row.querySelector('.ok').onclick = () => { row.querySelector('.ok').classList.add('on'); row.querySelector('.no').classList.remove('on'); row.querySelector('.act').disabled = true; };
      row.querySelector('.no').onclick = () => { row.querySelector('.no').classList.add('on'); row.querySelector('.ok').classList.remove('on'); row.querySelector('.act').disabled = false; };
    });
    $('#inspSave') && ($('#inspSave').onclick = (e) => {
      const items = $$('#inspList .chk-row').map((row) => ({ ok: row.querySelector('.ok').classList.contains('on'), action: row.querySelector('.act').value }));
      const body = { items };
      if (sec === 'exterior') body.tyreDepth = $$('.tyre').map((x) => x.value);
      jobCall(e.currentTarget, 'PUT', `/inspection/${sec}`, body, 'Inspection saved');
    });
  }
}
function topViewSvg() {
  const c = J.vehicle.hex;
  return `<svg class="car" viewBox="0 0 400 220" preserveAspectRatio="xMidYMid meet" aria-label="Vehicle top view">
    <rect x="40" y="40" width="320" height="140" rx="46" fill="${esc(c)}" opacity=".18" stroke="${esc(c)}" stroke-width="3"/>
    <rect x="120" y="58" width="150" height="104" rx="22" fill="#fff" stroke="${esc(c)}" stroke-width="2"/>
    <path d="M120 70 L95 60 L95 160 L120 150Z M270 70 L300 58 L300 162 L270 150Z" fill="#dbeafe" stroke="${esc(c)}" stroke-width="2"/>
    <rect x="58" y="22" width="56" height="20" rx="6" fill="#1f2937"/><rect x="286" y="22" width="56" height="20" rx="6" fill="#1f2937"/>
    <rect x="58" y="178" width="56" height="20" rx="6" fill="#1f2937"/><rect x="286" y="178" width="56" height="20" rx="6" fill="#1f2937"/>
    <text x="370" y="114" font-size="11" fill="#64748b" text-anchor="middle" transform="rotate(90 370 110)">FRONT</text>
    <text x="30" y="114" font-size="11" fill="#64748b" text-anchor="middle" transform="rotate(-90 30 110)">REAR</text></svg>`;
}

/* ---------------- Billing ---------------- */
function tabBilling() {
  const closed = J.status === 'closed';
  const approved = J.lines.filter((l) => l.status === 'approved');
  return `<div class="split">
    <div class="card" style="overflow:hidden"><div class="card-h"><h2>Approved work</h2><span class="small muted">${approved.length} line(s)</span></div>
      ${approved.length ? `<div class="tbl-wrap"><table class="tbl rt"><thead><tr><th>Description</th><th>Type</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead><tbody>
      ${approved.map((l) => `<tr><td class="lead" data-l="Item"><b>${esc(l.description)}</b><div class="small muted mono">${esc(l.code)}</div></td><td data-l="Type">${l.kind === 'part' ? 'Part' : 'Labour'}</td><td data-l="Qty" class="num">${l.qty}</td><td data-l="Rate" class="num">${money(l.rate)}</td><td data-l="Amount" class="num"><b>${money(l.amount)}</b></td></tr>`).join('')}</tbody></table></div>`
      : `<div class="empty">Nothing approved yet. Approve work on the <a href="#/jobs/${J.id}?tab=work">Work & estimate</a> tab.</div>`}
    </div>
    <div class="stack">
      <div class="card"><div class="card-h"><h3>Bill summary</h3></div><div class="card-b">${totalsHtml(J.billing)}</div></div>
      <div class="card"><div class="card-h"><h3>Documents</h3></div>
        <div class="lrow"><span class="vicon">${ic('receipt')}</span><div class="grow"><div class="t">Proforma invoice</div><div class="small muted">${J.proforma ? `Generated ${fmtDT(J.proforma.at)} · ${money(J.proforma.total)}` : 'Not generated yet'}</div></div>${closed ? '' : `<button class="btn sm" onclick="jobCall(this,'POST','/proforma',null,'Proforma generated')">${J.proforma ? 'Regenerate' : 'Generate'}</button>`}</div>
        <div class="lrow"><span class="vicon">${ic('receipt')}</span><div class="grow"><div class="t">Tax invoice</div><div class="small muted">${J.invoice ? `${esc(J.invoice.number)} · ${fmtDT(J.invoice.at)} · ${money(J.invoice.total)}${J.invoice.cancelledAt ? ' · <span style="color:var(--red)">cancelled on reopen</span>' : ''}` : 'Raised automatically when the job card is closed'}</div></div>${J.invoice && !J.invoice.cancelledAt ? `<button class="btn sm" onclick="printJob(true)">${ic('print', 'sm')}Print</button>` : ''}</div>
      </div>
      ${!closed ? `<button class="btn primary lg" onclick="statusModal('close')">${ic('check')}Close & deliver</button>` : ''}
    </div></div>`;
}

/* ---------------- Feedback ---------------- */
function tabFeedback() {
  const qs = App.meta.lookups.feedbackQuestions;
  const f = J.feedback;
  const cur = App.ui.fb && App.ui.fb.id === J.id ? App.ui.fb.scores : f ? f.scores.slice() : qs.map(() => 0);
  App.ui.fb = { id: J.id, scores: cur };
  const avg = f ? (f.scores.reduce((a, b) => a + b, 0) / f.scores.length).toFixed(1) : null;
  return `<div class="card" style="max-width:820px"><div class="card-h"><h2>Customer feedback</h2>${avg ? `<span class="badge b-amber">${ic('star', 'sm')} ${avg} / 5</span>` : ''}</div><div class="card-b">
    ${qs.map((q, i) => `<div class="chk-row" style="flex-wrap:wrap"><div class="grow" style="min-width:220px">${esc(q)}</div><div class="row" role="radiogroup" aria-label="${esc(q)}" style="gap:2px">${[1, 2, 3, 4, 5].map((n) => `<button class="btn ghost sm icon" style="color:${cur[i] >= n ? 'var(--amber)' : '#cbd5e1'}" title="${['Very poor', 'Poor', 'Satisfactory', 'Good', 'Very good'][n - 1]}" onclick="App.ui.fb.scores[${i}]=${n};App.refresh()"><svg class="i lg" viewBox="0 0 24 24" style="fill:currentColor;stroke:none">${ICONS.star}</svg></button>`).join('')}</div></div>`).join('')}
    <label class="f" style="margin-top:14px">Comments<textarea class="inp" id="fbC" placeholder="Anything else the customer shared">${esc(f?.comment || '')}</textarea></label>
    <div class="row" style="margin-top:14px;justify-content:flex-end;${App.can('jobs.feedback') ? '' : 'display:none'}"><button class="btn primary" onclick="jobCall(this,'POST','/feedback',{scores:App.ui.fb.scores,comment:$('#fbC').value},'Feedback saved').then(r=>{if(r)App.ui.fb=null})">Save feedback</button></div>
    ${f ? `<div class="small muted" style="margin-top:8px">Last recorded ${fmtDT(f.at)}</div>` : ''}
  </div></div>`;
}

/* ---------------- Activity ---------------- */
function tabActivity() {
  return `<div class="card" style="max-width:860px"><div class="card-b">
    <form class="row" style="gap:8px;margin-bottom:18px" onsubmit="event.preventDefault();jobCall(this.querySelector('button'),'POST','/activity',{text:this.note.value},'Note added')">
      <input class="inp" name="note" placeholder="Add an internal note for the team…"><button class="btn primary">Add</button></form>
    <div class="tl">${J.activity.map((a) => `<div class="e"><div>${esc(a.text)}</div><div class="m">${esc(a.by)} · ${fmtDT(a.at)}</div></div>`).join('')}</div></div></div>`;
}

/* ---------------- header actions ---------------- */
function moveStage(key, label) {
  confirmBox('Change stage?', `Move ${esc(J.id)} to <b>${label}</b>?`, 'Move').then((ok) => ok && jobCall(null, 'POST', '/stage', { stage: key }, `Moved to ${label}`));
}
function statusModal(preset) {
  const actions = J.status === 'closed' ? [['reopen', 'Reopen job card', 'Make changes after delivery. The invoice will be cancelled.']]
    : J.status === 'on_hold' ? [['resume', 'Resume work', 'Continue work on this job card.'], ['close', 'Close & issue tax invoice', 'Issue the tax invoice(s). The vehicle is released with a gate pass once paid.']]
    : [['close', 'Close & issue tax invoice', 'Issue the tax invoice(s). The vehicle is released with a gate pass once paid.'], ['hold', 'Put on hold', 'Pause work, e.g. waiting for parts or customer.']];
  const sel = preset && actions.some((a) => a[0] === preset) ? preset : actions[0][0];
  const pending = J.lines.filter((l) => l.status === 'pending').length;
  const notIssued = toIssue().length + labourToIssue().length;
  openModal({
    title: 'Update status',
    body: `<div class="row" style="margin-bottom:14px"><span class="muted">Current:</span>${statusBadge(J.status)}${stageBadge(J.stage)}</div>
      <div class="stack" style="gap:8px" id="stOpts">${actions.map(([k, l, d]) => `<label class="pkg ${k === sel ? 'on' : ''}" style="cursor:pointer"><input type="radio" name="st" value="${k}" ${k === sel ? 'checked' : ''} style="accent-color:var(--primary);width:18px;height:18px"><span style="flex:1"><b>${l}</b><div class="small muted">${d}</div></span></label>`).join('')}</div>
      ${pending && J.status !== 'closed' ? `<div class="alert warn" style="margin-top:12px">${ic('alert')}<div>${pending} estimate line(s) still need customer approval. Resolve them before closing.</div></div>` : ''}
      ${notIssued && J.status !== 'closed' ? `<div class="alert warn" style="margin-top:12px">${ic('alert')}<div>${notIssued} approved part/labour line(s) are not issued yet. Everything on the estimate must be issued before closing. <a href="#/jobs/${J.id}?tab=issue" onclick="closeModal()">Go to Parts & labour issue</a></div></div>` : ''}
      ${J.status !== 'closed' ? `<div class="totals card-b" style="padding:12px 0 0"><div class="r"><span>Amount to invoice</span><b>${money(J.billing.total)}</b></div></div>` : ''}
      <label class="f" style="margin-top:14px">Remarks<textarea class="inp" id="stR" name="remarks" placeholder="e.g. All work completed and road-tested"></textarea></label>`,
    foot: `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="stOk">Update</button>`,
  });
  $$('#stOpts input').forEach((r) => (r.onchange = () => $$('#stOpts label').forEach((l) => l.classList.toggle('on', l.contains(r) && r.checked))));
  $('#stOk').onclick = (e) => jobCall(e.currentTarget, 'POST', '/status', { action: $('[name=st]:checked').value, remarks: $('#stR').value }, 'Status updated');
}
function rescheduleModal() {
  openModal({
    title: 'Reschedule delivery',
    body: `<div class="stack"><div class="row"><span class="muted">Currently promised</span><b>${fmtDT(J.promisedAt)}</b></div>
      <label class="f">New delivery date & time<input class="inp" type="datetime-local" id="rsAt" name="promisedAt" value="${toLocalInput(new Date(Math.max(Date.now() + 3600000, new Date(J.promisedAt))))}"></label>
      <label class="f">Reason<select class="inp" id="rsR" name="reason"><option value="">Select a reason</option>${App.meta.lookups.delayReasons.map((r) => `<option>${esc(r)}</option>`).join('')}</select></label>
      <label class="f">Note for the customer <span class="hint">(optional)</span><textarea class="inp" id="rsN"></textarea></label></div>`,
    foot: `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="rsOk">Reschedule</button>`,
  });
  $('#rsOk').onclick = (e) => jobCall(e.currentTarget, 'POST', '/promised', { promisedAt: new Date($('#rsAt').value).toISOString(), reason: $('#rsR').value, remarks: $('#rsN').value }, 'Delivery rescheduled');
}
function emailModal() {
  openModal({
    title: 'Email job card',
    body: `<div class="stack"><label class="f">To<input class="inp" id="emTo" name="to" type="email" value="${esc(J.vehicle.owner.email)}"></label>
      <div class="alert info">${ic('info')}<div>The customer receives the job card and current estimate (${money(J.estimate.total)}) as a PDF. <b>Demo:</b> no mail server is configured, so the request is only logged.</div></div></div>`,
    foot: `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="emOk">${ic('mail', 'sm')}Send</button>`,
  });
  $('#emOk').onclick = (e) => jobCall(e.currentTarget, 'POST', '/email', { to: $('#emTo').value }, 'Email queued');
}
function vehicleDrawer() {
  const v = J.vehicle, o = v.owner;
  const sec = (t, rows) => `<h3 style="margin:18px 0 8px">${t}</h3><dl class="kv" style="grid-template-columns:1fr 1fr">${rows.map(([a, b]) => `<div><dt>${a}</dt><dd>${b}</dd></div>`).join('')}</dl>`;
  openDrawer('Vehicle & customer', `<div class="hero" style="flex-direction:column;align-items:flex-start"><div class="pic" style="width:100%">${carSvg(v.hex, 150)}</div><div><h2>${esc(v.reg)}</h2><div class="muted">${esc(v.model)} ${esc(v.variant)}</div></div></div>
    ${sec('Vehicle', [['VIN', `<span class="mono">${esc(v.vin)}</span>`], ['Engine', esc(v.engine)], ['Colour', esc(v.color)], ['Fuel / gearbox', `${esc(v.fuel)} · ${esc(v.transmission)}`]])}
    ${sec('Customer', [['Name', esc(o.name) + (o.vip ? ' <span class="badge b-amber">VIP</span>' : '')], ['Customer ID', esc(o.customerId)], ['Mobile', `<a href="tel:${esc(o.phone)}">${esc(fmtPhone(o.phone))}</a>`], ['Type', `${esc(o.type)} · ${esc(o.entity)}`]])}
    ${sec('Sale & cover', [['Sold on', fmtDate(v.saleDate)], ['Dealer', esc(v.sellingDealer)], ['Warranty till', fmtDate(v.warrantyTill)], ['Insurance till', fmtDate(v.insurance.validTill)], ['Insurer', esc(v.insurance.company)]])}
    ${sec('This job', [['Job card', esc(J.id)], ['Checked in', fmtDT(J.arrivedAt)], ['Odometer', J.odometerFaulty ? 'Not working' : Number(J.odometer).toLocaleString('en-AU') + ' km'], ['Fuel', FUEL[J.fuelLevel]]])}
    <a class="btn" style="margin-top:18px;width:100%" href="#/vehicles/${v.vin}">Open full vehicle profile</a>`);
}
function printJob(invoice) {
  const v = J.vehicle, lines = invoice ? J.lines.filter((l) => l.status === 'approved') : J.lines.filter((l) => l.status !== 'declined');
  const t = invoice ? J.billing : J.estimate;
  const w = window.open('', '_blank');
  if (!w) return toast('Allow pop-ups to print', 'err');
  w.document.write(`<!DOCTYPE html><html><head><title>${esc(invoice ? J.invoice?.number : J.id)}</title><style>
    body{font-family:Segoe UI,system-ui,sans-serif;color:#0f172a;margin:32px;font-size:13px}h1{font-size:20px;margin:0}table{width:100%;border-collapse:collapse;margin-top:16px}
    th,td{padding:7px 8px;border-bottom:1px solid #e5e7eb;text-align:left}th{font-size:11px;text-transform:uppercase;color:#64748b}.r{text-align:right}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px 20px;margin-top:16px}
    .l{color:#64748b;font-size:11px}.tot{margin-left:auto;width:280px;margin-top:12px}.tot div{display:flex;justify-content:space-between;padding:3px 0}.big{font-weight:700;font-size:16px;border-top:1px solid #0f172a;margin-top:4px;padding-top:6px!important}
    .head{display:flex;justify-content:space-between;border-bottom:3px solid #0f766e;padding-bottom:12px}</style></head><body>
    <div class="head"><div><h1>${esc(App.meta.workshop.name)}</h1><div class="l">Workshop code ${esc(App.meta.workshop.code)}</div></div><div style="text-align:right"><h1>${invoice ? 'TAX INVOICE' : 'JOB CARD & ESTIMATE'}</h1><div>${esc(invoice ? J.invoice.number : J.id)} · ${fmtDate(invoice ? J.invoice.at : J.arrivedAt)}</div></div></div>
    <div class="grid">${[['Customer', o(v.owner.name)], ['Mobile', v.owner.phone], ['Vehicle', `${v.reg} · ${v.model}`], ['VIN', v.vin], ['Job type', J.jobType], ['Odometer', J.odometer + ' km'], ['Checked in', fmtDT(J.arrivedAt)], ['Promised', fmtDT(J.promisedAt)], ['Advisor', J.advisor]].map(([a, b]) => `<div><div class="l">${a}</div><b>${esc(b)}</b></div>`).join('')}</div>
    <table><thead><tr><th>#</th><th>Description</th><th>Code</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th>${invoice ? '' : '<th>Approval</th>'}</tr></thead><tbody>
    ${lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.description)}</td><td>${esc(l.code)}</td><td class="r">${l.qty}</td><td class="r">${money(l.rate)}</td><td class="r">${money(l.amount)}</td>${invoice ? '' : `<td>${l.status}</td>`}</tr>`).join('')}</tbody></table>
    <div class="tot"><div><span>Parts</span><span>${money(t.parts)}</span></div><div><span>Labour</span><span>${money(t.labour)}</span></div>${t.campaignDiscount ? `<div><span>Campaign discount</span><span>− ${money(t.campaignDiscount)}</span></div>` : ''}<div><span>GST ${t.gstPct}%</span><span>${money(t.tax)}</span></div><div class="big"><span>Total</span><span>${money(t.total)}</span></div></div>
    <p class="l" style="margin-top:40px">Customer signature ______________________ &nbsp;&nbsp; Advisor signature ______________________</p>
    <script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
  function o(x) { return x; }
}
