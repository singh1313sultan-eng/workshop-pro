/* Workshop Pro – new job card wizard (walk-in check-in), incl. registering a vehicle/customer not on file */
'use strict';

const WSTEPS = ['Check-in', 'Concerns', 'Work', 'Review & sign'];
const WSTEPS_NEW = ['Vehicle & customer', ...WSTEPS];
const NEW_VIN = '__new__';
const QUICK_CONCERNS = ['Periodic service due', 'Brake noise', 'AC not cooling', 'Vehicle pulls to one side', 'Engine warning light', 'Battery / starting issue', 'Wash & interior cleaning'];

async function catalogCache() {
  if (!App.catalog) {
    const [packages, parts, labour] = await Promise.all([api('GET', '/catalog/packages'), api('GET', '/catalog/parts'), api('GET', '/catalog/labour')]);
    App.catalog = { packages, parts, labour };
  }
  return App.catalog;
}
function wizItemPrice(it) {
  const c = App.catalog;
  if (it.packageCode) { const p = c.packages.find((x) => x.code === it.packageCode); return p ? p.partsAmount + p.labourAmount : 0; }
  if (it.kind === 'part') { const p = c.parts.find((x) => x.no === it.code); return p ? p.mrp * it.qty : 0; }
  const l = c.labour.find((x) => x.code === it.code); return l ? l.rate : 0;
}
function wizItemName(it) {
  const c = App.catalog;
  if (it.packageCode) return (c.packages.find((x) => x.code === it.packageCode) || {}).name || it.packageCode;
  if (it.kind === 'part') { const p = c.parts.find((x) => x.no === it.code); return `${p?.description || it.code} × ${it.qty}`; }
  return (c.labour.find((x) => x.code === it.code) || {}).description || it.code;
}
const concernTotal = (c) => c.items.reduce((s, it) => s + wizItemPrice(it), 0);
const gst = (n) => Math.round(n * (1 + (App.meta.workshop.gstPct || 0) / 100) * 100) / 100;

App.route('/new', async (p, q) => wizardView(null, q));
App.route('/new/:vin', async ({ vin }, q) => wizardView(vin, q));

async function wizardView(vin, q) {
  const isNew = !vin;
  if (isNew) vin = NEW_VIN;
  const [v] = await Promise.all([isNew ? null : api('GET', '/vehicles/' + encodeURIComponent(vin)), catalogCache()]);
  if (v && v.activeJob) {
    return { title: 'New job card', nav: 'walkin', back: `#/vehicles/${vin}`, html: `<div class="card empty"><div class="ic">${ic('clipboard', 'lg')}</div><h3>This vehicle already has an open job card</h3><p>${esc(v.activeJob.id)} · ${esc(v.activeJob.jobType)}</p><a class="btn primary" href="#/jobs/${v.activeJob.id}">Open job card</a></div>` };
  }
  let W = App.ui.wiz;
  if (!W || W.vin !== vin) {
    W = App.ui.wiz = {
      vin, step: 0, isNew, reg: isNew ? newRegState(q.get('q') || '') : null,
      d: { jobType: 'Periodic service', odometer: '', odometerFaulty: false, fuelLevel: 2, drivenBy: 'Owner', lift: true, repeatRepair: false, customerWaiting: false, extras: { wash: true, interiorClean: false }, serviceVan: '', promisedAt: toLocalInput(Date.now() + 8 * 3600000) },
      concerns: [], approval: { signature: null, clientUnavailable: false, remarks: '' },
    };
  }
  const L = App.meta.lookups;
  const opt = (arr, cur) => arr.map((o) => `<option ${o === cur ? 'selected' : ''}>${esc(o)}</option>`).join('');
  const steps = isNew ? WSTEPS_NEW : WSTEPS;
  const s = W.step - (isNew ? 1 : 0); // content step: -1 = vehicle & customer
  if (isNew && !W.opts) W.opts = await api('GET', '/vehicles/registration-options');
  let body = '';
  if (s === -1) body = regBody(W);
  if (s === 0) body = `
    <div class="card"><div class="card-h"><h2>Check-in details</h2></div><div class="card-b grid g2">
      <label class="f">Job type<select class="inp" data-k="jobType">${opt(L.jobTypes, W.d.jobType)}</select></label>
      <label class="f">Promised delivery<input class="inp" type="datetime-local" name="promisedAt" data-k="promisedAt" value="${W.d.promisedAt}"></label>
      <label class="f">Odometer (km)<input class="inp" type="number" inputmode="numeric" name="odometer" data-k="odometer" value="${esc(W.d.odometer)}" placeholder="Current reading" ${W.d.odometerFaulty ? 'disabled' : ''}></label>
      <label class="f">Driven in by<select class="inp" data-k="drivenBy">${opt(L.drivenBy, W.d.drivenBy)}</select></label>
      <label class="f" style="grid-column:1/-1">Fuel level<div class="fuel" id="wFuel">${FUEL.map((f, i) => `<button type="button" class="${W.d.fuelLevel === i ? 'on' : ''}" data-v="${i}">${f}</button>`).join('')}</div></label>
      <div class="stack" style="grid-column:1/-1;gap:10px">
        <label class="check"><input type="checkbox" data-k="odometerFaulty" ${W.d.odometerFaulty ? 'checked' : ''}>Odometer not working</label>
        <label class="check"><input type="checkbox" data-k="customerWaiting" ${W.d.customerWaiting ? 'checked' : ''}>Customer will wait at the workshop</label>
        <label class="check"><input type="checkbox" data-k="lift" ${W.d.lift ? 'checked' : ''}>Needs a lift</label>
        <label class="check"><input type="checkbox" data-k="repeatRepair" ${W.d.repeatRepair ? 'checked' : ''}>Repeat repair (back for the same issue)</label>
        <label class="check"><input type="checkbox" data-x="wash" ${W.d.extras.wash ? 'checked' : ''}>Exterior wash</label>
        <label class="check"><input type="checkbox" data-x="interiorClean" ${W.d.extras.interiorClean ? 'checked' : ''}>Interior cleaning</label>
      </div></div></div>`;
  if (s === 1) body = `
    <div class="card"><div class="card-h"><h2>What does the customer report?</h2></div><div class="card-b">
      <form id="cAdd" class="stack" style="gap:10px">
        <div class="seg" id="wKind"><button type="button" class="on" data-k="voice">Customer concern</button><button type="button" data-k="advice">Advisor recommendation</button></div>
        <div class="row wrap" style="gap:8px"><input class="inp" id="wcText" placeholder="Describe the concern in the customer's words" style="flex:2;min-width:220px"><input class="inp" id="wcObs" placeholder="Your observation (optional)" style="flex:2;min-width:200px"><button class="btn primary">${ic('plus', 'sm')}Add</button></div>
        <div class="chips">${QUICK_CONCERNS.map((q) => `<button type="button" class="chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
      </form></div>
      ${W.concerns.length ? W.concerns.map((c, i) => `<div class="lrow"><span class="badge ${c.kind === 'voice' ? 'b-blue' : 'b-violet'}">${c.kind === 'voice' ? 'Customer' : 'Advisor'}</span><div class="grow"><div class="t" style="white-space:normal">${esc(c.text)}</div>${c.observation ? `<div class="small muted">Observation: ${esc(c.observation)}</div>` : ''}</div><button class="btn ghost sm icon" title="Remove" onclick="App.ui.wiz.concerns.splice(${i},1);App.refresh()">${ic('trash', 'sm')}</button></div>`).join('') : `<div class="empty small" style="border-top:1px solid var(--line-2)">No concerns yet. Add at least one to continue.</div>`}
    </div>`;
  if (s === 2) body = `<div class="split"><div>
    ${W.concerns.map((c, i) => `<div class="concern"><div class="concern-h"><span class="badge ${c.kind === 'voice' ? 'b-blue' : 'b-violet'}">${c.kind === 'voice' ? 'Customer' : 'Advisor'}</span><div class="grow"><b>${esc(c.text)}</b></div><b>${money(concernTotal(c))}</b><button class="btn sm" onclick="wizAddWork(${i})">${ic('plus', 'sm')}Add work</button></div>
      <div class="lines">${c.items.length ? c.items.map((it, k) => `<div class="lrow" style="padding:10px 16px"><span class="badge ${it.packageCode ? 'b-teal' : 'b-slate'}">${it.packageCode ? 'Package' : it.kind === 'part' ? 'Part' : 'Labour'}</span><div class="grow"><div class="t" style="white-space:normal;font-weight:500">${esc(wizItemName(it))}</div></div><b>${money(wizItemPrice(it))}</b><button class="btn ghost sm icon" title="Remove" onclick="App.ui.wiz.concerns[${i}].items.splice(${k},1);App.refresh()">${ic('trash', 'sm')}</button></div>`).join('') : '<div class="empty small" style="padding:14px">No work yet – add a package, parts or labour. You can also leave it for diagnosis.</div>'}</div></div>`).join('')}
    </div><div class="card" style="position:sticky;top:80px"><div class="card-h"><h3>Estimate</h3></div><div class="card-b">${wizTotals(W)}</div></div></div>`;
  if (s === 3) {
    const pre = W.concerns.reduce((s, c) => s + concernTotal(c), 0);
    body = `<div class="split"><div class="stack">
      <div class="card"><div class="card-h"><h2>Customer decision</h2><span class="small muted">per concern</span></div>
        ${W.concerns.map((c, i) => `<div class="lrow" style="flex-wrap:wrap"><div class="grow" style="min-width:200px"><div class="t" style="white-space:normal">${esc(c.text)}</div><div class="small muted">${c.items.length} item(s) · ${money(gst(concernTotal(c)))} incl. GST</div></div>
          <div class="approve"><button class="ap ${c.decision === 'approved' ? 'on' : ''}" onclick="wizDecide(${i},'approved')">Approve</button><button class="pd ${c.decision === 'pending' ? 'on' : ''}" onclick="wizDecide(${i},'pending')">Later</button><button class="dc ${c.decision === 'declined' ? 'on' : ''}" onclick="wizDecide(${i},'declined')">Decline</button></div></div>`).join('')}
      </div>
      <div class="card"><div class="card-h"><h2>Customer signature</h2><button class="btn sm" id="sigClear">${ic('refresh', 'sm')}Clear</button></div><div class="card-b">
        <canvas class="sig" id="wSig" aria-label="Signature pad"></canvas>
        <label class="check" style="margin-top:12px"><input type="checkbox" id="wUnavail" ${W.approval.clientUnavailable ? 'checked' : ''}>Customer not present – approval taken over the phone</label>
        <label class="f" style="margin-top:12px">Remarks<textarea class="inp" id="wRem" placeholder="Anything agreed with the customer">${esc(W.approval.remarks)}</textarea></label>
      </div></div></div>
      <div class="stack" style="position:sticky;top:80px">
        <div class="card"><div class="card-h"><h3>Summary</h3></div><div class="card-b"><dl class="kv" style="grid-template-columns:1fr 1fr">
          <div><dt>Job type</dt><dd>${esc(W.d.jobType)}</dd></div><div><dt>Promised</dt><dd>${fmtDT(W.d.promisedAt)}</dd></div>
          <div><dt>Odometer</dt><dd>${W.d.odometerFaulty ? 'Not working' : Number(W.d.odometer).toLocaleString('en-AU') + ' km'}</dd></div><div><dt>Fuel</dt><dd>${FUEL[W.d.fuelLevel]}</dd></div></dl>
          <div style="margin-top:16px">${wizTotals(W)}</div>
          <div class="totals" style="margin-top:10px"><div class="r"><span>Approved now (incl. GST)</span><b style="color:var(--green)">${money(gst(W.concerns.filter((c) => c.decision === 'approved').reduce((s, c) => s + concernTotal(c), 0)))}</b></div></div>
          ${pre === 0 ? `<div class="alert info" style="margin-top:12px">${ic('info')}<div>No work priced yet. The job card will be created for diagnosis and you can add the estimate later.</div></div>` : ''}
        </div></div></div></div>`;
  }
  const last = steps.length - 1;
  const cancelTo = isNew ? '#/walkin' : `#/vehicles/${vin}`;
  return {
    title: isNew ? 'New vehicle & job card' : 'New job card',
    nav: 'walkin',
    back: cancelTo,
    html: `
    ${isNew ? (s >= 0 ? newVehicleHeader(W) : '') : `<div class="card" style="margin-bottom:16px"><div class="card-b row wrap" style="gap:14px"><span class="vicon" style="background:${esc(v.hex)}22;color:${esc(v.hex)}">${ic('car')}</span><div style="flex:1;min-width:200px"><b style="font-size:16px">${esc(v.reg)}</b> <span class="muted">${esc(v.model)} ${esc(v.variant)}</span><div class="small muted">${esc(v.owner.name)} · ${esc(fmtPhone(v.owner.phone))} · VIN ${esc(v.vin)}</div></div>${v.alerts.map((a) => `<span class="badge ${a.level === 'critical' ? 'b-red' : 'b-amber'}">${ic('alert', 'sm')} ${esc(a.text)}</span>`).join('')}</div></div>`}
    <div class="wizard-steps">${steps.map((t, i) => `<div class="wstep ${i === W.step ? 'on' : i < W.step ? 'done' : ''}"><b>${i < W.step ? '✓' : i + 1}</b>${t}</div>`).join('')}</div>
    ${body}
    <div class="wfoot"><button class="btn" onclick="${W.step ? 'wizGo(-1)' : `App.ui.wiz=null;App.go('${cancelTo}')`}">${W.step ? 'Back' : 'Cancel'}</button><div style="flex:1"></div>
      ${W.step < last ? `<button class="btn primary lg" id="wNext" onclick="wizGo(1)">Continue ${ic('arrow', 'sm')}</button>` : `<button class="btn primary lg" id="wCreate">${ic('check', 'sm')}Create job card</button>`}</div>`,
    after: () => wizBind(W),
  };
}

function wizTotals(W) {
  const sub = W.concerns.reduce((s, c) => s + concernTotal(c), 0);
  const tax = Math.round(sub * (App.meta.workshop.gstPct / 100) * 100) / 100;
  return `<div class="totals"><div class="r"><span>Work (before GST)</span><b>${money(sub)}</b></div><div class="r"><span>GST ${App.meta.workshop.gstPct}%</span><b>${money(tax)}</b></div><div class="r t"><span style="color:var(--ink)">Estimate</span><span>${money(sub + tax)}</span></div></div>`;
}
function wizDecide(i, d) { App.ui.wiz.concerns[i].decision = d; App.refresh(); }
function wizAddWork(i) {
  const c = App.ui.wiz.concerns[i];
  addWorkPicker({ title: 'Add work · ' + esc(c.text), onPick: (item) => { c.items.push(item); toast('Added: ' + wizItemName(item)); App.refresh(); } });
}
async function wizGo(dir) {
  const W = App.ui.wiz;
  const s = W.step - (W.isNew ? 1 : 0);
  if (dir > 0 && s === -1 && !(await regCheck(W))) return;
  if (dir > 0 && s === 0) {
    if (!W.d.odometerFaulty && !(Number(W.d.odometer) > 0)) { toast('Enter the odometer reading (or tick "Odometer not working")', 'err'); $('[name=odometer]')?.classList.add('err'); return; }
    if (!W.d.promisedAt || new Date(W.d.promisedAt) < new Date()) { toast('Promised delivery must be in the future', 'err'); $('[name=promisedAt]')?.classList.add('err'); return; }
  }
  if (dir > 0 && s === 1 && !W.concerns.length) { toast('Add at least one concern', 'err'); return; }
  W.step = Math.max(0, Math.min(W.isNew ? 4 : 3, W.step + dir));
  App.refresh().then(() => window.scrollTo(0, 0));
}
function wizBind(W) {
  /* step 0 inputs write straight into the wizard state */
  $$('[data-k]').forEach((el) => {
    const k = el.dataset.k;
    el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', () => {
      W.d[k] = el.type === 'checkbox' ? el.checked : el.value;
      el.classList.remove('err');
      if (k === 'odometerFaulty') App.refresh();
    });
  });
  $$('[data-x]').forEach((el) => el.addEventListener('change', () => (W.d.extras[el.dataset.x] = el.checked)));
  $$('#wFuel button').forEach((b) => b.addEventListener('click', () => (W.d.fuelLevel = Number(b.dataset.v))));
  if ($('#regForm')) regBind(W);
  /* step 1 */
  const f = $('#cAdd');
  if (f) {
    $$('#wKind button').forEach((b) => (b.onclick = () => $$('#wKind button').forEach((x) => x.classList.toggle('on', x === b))));
    const add = (text) => {
      if (!text.trim()) { toast('Describe the concern first', 'err'); return; }
      W.concerns.push({ kind: $('#wKind .on').dataset.k, text: text.trim(), observation: $('#wcObs').value.trim(), items: [], decision: 'approved' });
      App.refresh().then(() => $('#wcText')?.focus());
    };
    f.onsubmit = (e) => { e.preventDefault(); add($('#wcText').value); };
    $$('[data-q]').forEach((b) => (b.onclick = () => add(b.dataset.q)));
  }
  /* step 3: signature pad + create */
  const c = $('#wSig');
  if (c) {
    const r = c.getBoundingClientRect();
    c.width = r.width * devicePixelRatio; c.height = r.height * devicePixelRatio;
    const g = c.getContext('2d');
    g.scale(devicePixelRatio, devicePixelRatio); g.lineWidth = 2.2; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#0f172a';
    const hint = () => { g.fillStyle = '#94a3b8'; g.font = '13px Segoe UI, sans-serif'; g.fillText('Customer signs here', 14, r.height - 14); };
    if (W.approval.signature) { const im = new Image(); im.onload = () => g.drawImage(im, 0, 0, r.width, r.height); im.src = W.approval.signature; } else hint();
    let drawing = false, blank = !W.approval.signature;
    const pt = (e) => { const b = c.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
    c.onpointerdown = (e) => { if (blank) { g.clearRect(0, 0, r.width, r.height); blank = false; } drawing = true; c.setPointerCapture(e.pointerId); g.beginPath(); g.moveTo(...pt(e)); };
    c.onpointermove = (e) => { if (drawing) { g.lineTo(...pt(e)); g.stroke(); } };
    c.onpointerup = () => { if (drawing) { drawing = false; W.approval.signature = c.toDataURL('image/png'); } };
    $('#sigClear').onclick = () => { W.approval.signature = null; g.clearRect(0, 0, r.width, r.height); blank = true; hint(); };
    $('#wUnavail').onchange = (e) => (W.approval.clientUnavailable = e.target.checked);
    $('#wRem').oninput = (e) => (W.approval.remarks = e.target.value);
    $('#wCreate').onclick = async (e) => {
      if (!W.approval.signature && !W.approval.clientUnavailable) { toast('Get the customer to sign, or tick "Customer not present"', 'err'); return; }
      const body = Object.assign({}, W.d, W.isNew ? regPayload(W) : { vin: W.vin }, {
        odometer: Number(W.d.odometer) || 0,
        promisedAt: new Date(W.d.promisedAt).toISOString(),
        concerns: W.concerns.map((cn) => ({ kind: cn.kind, text: cn.text, observation: cn.observation, decision: cn.decision, packages: cn.items.filter((x) => x.packageCode).map((x) => x.packageCode), lines: cn.items.filter((x) => !x.packageCode) })),
        approval: W.approval,
      });
      const job = await act(e.currentTarget, () => api('POST', '/jobcards', body));
      if (job) {
        if (W.isNew) toast(`Vehicle ${W.reg.v.reg.toUpperCase()} registered${W.reg.mode === 'new' ? ' with a new customer ID' : ''}`);
        App.ui.wiz = null;
        App.updateBadges();
        toast(`Job card ${job.id} created`);
        App.go('#/jobs/' + job.id);
      }
    };
  }
}

/* ================= vehicle & customer registration (first wizard step for a vehicle not on file) ================= */
function newRegState(term) {
  const t = term.trim();
  const st = {
    mode: 'new', search: '', existing: null, allowDuplicatePhone: false,
    c: { name: '', phone: '', phone2: '', email: '', address: '', type: 'Private', entity: 'Individual', abn: '' },
    v: { vin: '', reg: '', regState: 'NSW', model: '', variant: '', color: '', fuel: 'Diesel', transmission: 'Manual', engine: '', saleDate: '', sellingDealer: '', insurance: { company: '', policyNo: '', validTill: '' } },
  };
  const compact = t.replace(/\s+/g, '');
  if (/^[A-Za-z0-9]{17}$/.test(compact)) st.v.vin = compact.toUpperCase();
  else if (/^(\+?61|0)4\d{8}$/.test(compact)) { const m = '0' + compact.slice(-9); st.c.phone = m; st.search = m; }
  else if (t) st.v.reg = t.toUpperCase();
  return st;
}
function regPayload(W) {
  const R = W.reg;
  const nv = Object.assign({}, R.v, { insurance: R.v.insurance.company ? Object.assign({}, R.v.insurance, { validTill: R.v.insurance.validTill ? new Date(R.v.insurance.validTill + 'T23:59:00').toISOString() : '' }) : null });
  if (nv.saleDate) nv.saleDate = new Date(nv.saleDate + 'T12:00:00').toISOString();
  return { newVehicle: nv, customer: R.mode === 'existing' && R.existing ? { customerId: R.existing.customerId } : Object.assign({}, R.c, { allowDuplicatePhone: R.allowDuplicatePhone }) };
}
function newVehicleHeader(W) {
  const R = W.reg, c = R.mode === 'existing' && R.existing ? R.existing : R.c;
  return `<div class="card" style="margin-bottom:16px"><div class="card-b row wrap" style="gap:14px"><span class="vicon">${ic('car')}</span><div style="flex:1;min-width:200px"><b style="font-size:16px">${esc(R.v.reg.toUpperCase())}</b> <span class="muted">${esc(R.v.model)} ${esc(R.v.variant)}</span><div class="small muted">${esc(c.name)} · ${esc(fmtPhone(c.phone))} · VIN ${esc(R.v.vin.toUpperCase())}</div></div><span class="badge b-teal">New vehicle</span>${R.mode === 'new' ? '<span class="badge b-violet">New customer</span>' : `<span class="badge b-slate">${esc(R.existing.customerId)}</span>`}</div></div>`;
}
function regBody(W) {
  const R = W.reg, O = W.opts || {};
  const inp = (path, label, attrs = '', req = false, hint = '') => `<label class="f"><span>${label}${req ? ' <span style="color:var(--red)">*</span>' : ''}${hint ? ` <span class="hint">· ${hint}</span>` : ''}</span><input class="inp" data-r="${path}" value="${esc(getPath(R, path))}" ${attrs} autocomplete="off"></label>`;
  const sel = (path, label, list, req = false, blank = false) => `<label class="f"><span>${label}${req ? ' <span style="color:var(--red)">*</span>' : ''}</span><select class="inp" data-r="${path}">${blank ? '<option value="">None</option>' : ''}${list.map((o) => `<option ${o === getPath(R, path) ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
  const cust = R.mode === 'existing'
    ? `<div class="card-b">
        ${R.existing
          ? `<div class="lrow" style="border:1px solid var(--primary);border-radius:10px;background:var(--primary-50)"><span class="avatar">${initials(R.existing.name)}</span><div class="grow"><div class="t">${esc(R.existing.name)} <span class="badge b-slate">${esc(R.existing.customerId)}</span></div><div class="small muted">${esc(fmtPhone(R.existing.phone))}${R.existing.email ? ' · ' + esc(R.existing.email) : ''} · ${R.existing.vehicles.length} vehicle(s): ${esc(R.existing.vehicles.map((x) => x.reg).join(', '))}</div></div><button class="btn sm" type="button" onclick="App.ui.wiz.reg.existing=null;App.refresh()">Change</button></div>`
          : `<label class="gsearch" style="display:flex;width:auto;height:44px">${ic('search')}<input id="rcQ" value="${esc(R.search)}" placeholder="Search by name, mobile or customer ID" autocomplete="off"></label><div id="rcList" style="margin-top:8px"></div>`}
      </div>`
    : `<div class="card-b grid g2">
        ${inp('c.name', 'Customer name', 'data-f="customer.name"', true)}
        ${inp('c.phone', 'Mobile', 'type="tel" inputmode="tel" data-f="customer.phone" placeholder="04xx xxx xxx"', true)}
        ${inp('c.phone2', 'Other phone', 'type="tel" inputmode="tel" data-f="customer.phone2"')}
        ${inp('c.abn', 'ABN (business customers)', 'inputmode="numeric" data-f="customer.abn"', false, 'needed on invoices of $1,000 or more')}
        ${inp('c.email', 'Email', 'type="email" data-f="customer.email"')}
        ${sel('c.type', 'Customer type', O.customerTypes || ['Private', 'Commercial'])}
        ${sel('c.entity', 'Entity', O.entities || ['Individual'])}
        <label class="f" style="grid-column:1/-1"><span>Address</span><textarea class="inp" data-r="c.address">${esc(R.c.address)}</textarea></label>
        <div class="small muted" style="grid-column:1/-1">${ic('info', 'sm')} A customer ID is created automatically when the job card is saved.</div>
      </div>`;
  return `<form id="regForm" class="stack" novalidate onsubmit="return false">
    <div class="card"><div class="card-h"><h2>Customer</h2><div class="seg" id="rcMode"><button type="button" data-m="existing" class="${R.mode === 'existing' ? 'on' : ''}">Existing customer</button><button type="button" data-m="new" class="${R.mode === 'new' ? 'on' : ''}">New customer</button></div></div>${cust}</div>
    <div class="card"><div class="card-h"><h2>Vehicle</h2><span class="small muted">Not on file yet – it will be registered with the job card</span></div><div class="card-b grid g2">
      ${inp('v.vin', 'VIN / chassis number', 'maxlength="17" style="text-transform:uppercase;font-family:var(--mono,ui-monospace,monospace)" data-f="vin"', true, '<span id="vinCount">' + R.v.vin.length + '</span>/17')}
      ${inp('v.reg', 'Rego (plate)', 'style="text-transform:uppercase" data-f="reg" placeholder="e.g. AB12CD"', true)}
      ${sel('v.regState', 'Rego state', ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'])}
      ${inp('v.model', 'Model', 'list="dlModels" data-f="model"', true)}
      ${inp('v.variant', 'Variant')}
      ${inp('v.color', 'Colour', 'list="dlColors"')}
      ${inp('v.engine', 'Engine number', 'style="text-transform:uppercase"')}
      ${sel('v.fuel', 'Fuel', O.fuels || ['Diesel'])}
      ${sel('v.transmission', 'Transmission', O.transmissions || ['Manual'])}
      ${inp('v.saleDate', 'Delivery date', 'type="date" data-f="saleDate"', false, 'warranty defaults to 6 years')}
      ${inp('v.sellingDealer', 'Selling dealer', 'list="dlDealers"')}
    </div></div>
    <div class="card"><div class="card-h"><h2>Insurance</h2><span class="small muted">optional</span></div><div class="card-b grid g2">
      ${sel('v.insurance.company', 'Insurance company', O.insurers || [], false, true)}
      ${inp('v.insurance.policyNo', 'Policy number', 'style="text-transform:uppercase" data-f="insurance.policyNo"')}
      ${inp('v.insurance.validTill', 'Valid till', 'type="date" data-f="insurance.validTill"')}
    </div></div>
    <datalist id="dlModels">${(O.models || []).map((m) => `<option value="${esc(m)}">`).join('')}</datalist>
    <datalist id="dlDealers">${(O.dealers || []).map((m) => `<option value="${esc(m)}">`).join('')}</datalist>
    <datalist id="dlColors">${['Mineral White', 'Mercury Silver', 'Basalt Black', 'Cobalt Blue', 'Granite Grey', 'Valencia Orange', 'Red Spinel'].map((m) => `<option value="${m}">`).join('')}</datalist>
  </form>`;
}
function getPath(o, p) { return p.split('.').reduce((x, k) => (x == null ? '' : x[k]), o) ?? ''; }
function setPath(o, p, val) { const ks = p.split('.'); const last = ks.pop(); ks.reduce((x, k) => x[k], o)[last] = val; }
function regBind(W) {
  const R = W.reg;
  $$('#regForm [data-r]').forEach((el) => el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
    setPath(R, el.dataset.r, el.value);
    el.classList.remove('err');
    if (el.dataset.r === 'v.vin') $('#vinCount').textContent = el.value.replace(/\s+/g, '').length;
    if (el.dataset.r === 'c.phone') R.allowDuplicatePhone = false;
  }));
  $$('#rcMode [data-m]').forEach((b) => (b.onclick = () => { R.mode = b.dataset.m; App.refresh(); }));
  const q = $('#rcQ');
  if (q) {
    let t;
    const run = async () => {
      R.search = q.value;
      const term = q.value.trim();
      if (term.length < 2) { $('#rcList').innerHTML = '<div class="small muted" style="padding:6px 2px">Type at least 2 characters.</div>'; return; }
      const list = await api('GET', '/customers?q=' + encodeURIComponent(term)).catch(() => []);
      if (q.value.trim() !== term) return;
      window.__rcList = list;
      $('#rcList').innerHTML = list.length
        ? list.map((c, i) => `<div class="lrow click" data-i="${i}"><span class="avatar" style="width:34px;height:34px;font-size:12px">${initials(c.name)}</span><div class="grow"><div class="t">${esc(c.name)} <span class="muted small">${esc(c.customerId)}</span></div><div class="small muted">${esc(fmtPhone(c.phone))} · ${esc(c.vehicles.map((x) => x.reg).join(', '))}</div></div>${ic('chevron')}</div>`).join('')
        : `<div class="empty small" style="padding:14px">No customer found. <a href="javascript:void 0" id="rcToNew">Create a new customer</a></div>`;
      $$('#rcList [data-i]').forEach((row) => (row.onclick = () => { R.existing = window.__rcList[Number(row.dataset.i)]; App.refresh(); }));
      const toNew = $('#rcToNew');
      if (toNew) toNew.onclick = () => { R.mode = 'new'; if (/^0?4\d{8}$/.test(term.replace(/\D/g, ''))) R.c.phone = term.replace(/\D/g, ''); else if (!R.c.name) R.c.name = term; App.refresh(); };
    };
    q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 250); });
    if (R.search) run(); else q.focus();
  }
}
async function regCheck(W) {
  const R = W.reg;
  $$('#regForm .err').forEach((x) => x.classList.remove('err'));
  if (R.mode === 'existing' && !R.existing) { toast('Choose the customer, or switch to "New customer"', 'err'); $('#rcQ')?.focus(); return false; }
  const btn = $('#wNext');
  try {
    if (btn) btn.disabled = true;
    const r = await api('POST', '/vehicles/check', regPayload(W));
    (r.warnings || []).forEach((w) => toast(w, 'err'));
    return true;
  } catch (e) {
    if (e.message === 'network') return false;
    const field = e.details?.field;
    if (e.status === 409 && e.details?.existingCustomer) {
      const ex = e.details.existingCustomer;
      const use = await confirmBox('Customer already on file', `The mobile number belongs to <b>${esc(ex.name)}</b> (${esc(ex.customerId)}). Use this existing customer for the new vehicle?`, 'Use existing customer');
      if (use) {
        const list = await api('GET', '/customers?q=' + encodeURIComponent(ex.customerId));
        R.mode = 'existing'; R.existing = list.find((c) => c.customerId === ex.customerId) || null;
        App.refresh();
        return false;
      }
      if (await confirmBox('Create a separate customer?', 'A new customer ID will be created with the same mobile number (for example a family member or a company driver).', 'Yes, create new')) { R.allowDuplicatePhone = true; return regCheck(W); }
      return false;
    }
    toast(e.message, 'err');
    if (e.status === 409 && e.details?.vin && field !== 'customer.phone') {
      if (await confirmBox('Vehicle already registered', esc(e.message), 'Open that vehicle')) { App.ui.wiz = null; App.go('#/vehicles/' + e.details.vin); }
    }
    const el = field && $(`#regForm [data-f="${field}"]`);
    if (el) { el.classList.add('err'); el.focus(); }
    return false;
  } finally {
    if (btn && btn.isConnected) btn.disabled = false;
  }
}
