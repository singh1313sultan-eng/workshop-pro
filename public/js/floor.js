/* Workshop Pro – workshop board, bookings & reminders, technician "My jobs", time clock, customer messages */
'use strict';

const sinceText = (d) => { const m = Math.round((Date.now() - Date.parse(d)) / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
App.loadClock = async () => { if (!App.can('jobs.clock')) { App.clock = null; return; } try { App.clock = await api('GET', '/timeclock/me'); } catch { App.clock = null; } };

/* ---------- time clock ---------- */
function clockButton(jobId, closed) {
  if (!App.can('jobs.clock') || closed) return '';
  const on = App.clock && App.clock.open && App.clock.open.jobId === jobId;
  return `<button class="btn ${on ? 'danger' : ''}" onclick="toggleClock('${jobId}', ${on})" title="${on ? 'Stop timing your work on this job' : 'Start timing your work on this job'}">${ic('clock', 'sm')}${on ? `Clock off (${sinceText(App.clock.open.start)})` : 'Clock on'}</button>`;
}
async function toggleClock(jobId, on) {
  if (!on && App.clock && App.clock.open && App.clock.open.jobId !== jobId && !(await confirmBox('Switch jobs?', `You are clocked on to ${App.clock.open.jobId}. You will be clocked off there and on to ${jobId}.`, 'Switch'))) return;
  const r = await act(null, () => api('POST', `/jobcards/${jobId}/clock`, { action: on ? 'off' : 'on' }), on ? 'Clocked off' : 'Clocked on');
  if (r) { await App.loadClock(); App.refresh(); }
}

/* ---------- customer messages ---------- */
async function messageModal(ctx) {
  const [templates, providers] = await Promise.all([api('GET', '/messages/templates'), api('GET', '/messages/providers')]);
  const avail = templates.filter((t) => (ctx.invoiceId ? ['invoice', 'custom'] : ctx.appointmentId ? ['appointment', 'custom'] : ['estimate', 'ready', 'custom', 'reminder']).includes(t.key));
  let template = ctx.template || avail[0].key, channel = ctx.channel || 'sms';
  openModal({
    title: 'Message customer',
    wide: true,
    body: `${!providers.sms || !providers.email ? `<div class="alert info" style="margin-bottom:12px">${ic('info')}<div>${!providers.sms ? 'SMS' : ''}${!providers.sms && !providers.email ? ' and ' : ''}${!providers.email ? 'email' : ''} sending is not set up yet – messages are saved in the outbox but not delivered. Add the provider keys in the server's .env file (see README).</div></div>` : ''}
      <div class="grid g2"><label class="f"><span>Message</span><select class="inp" id="msT">${avail.map((t) => `<option value="${t.key}" ${t.key === template ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></label>
      <label class="f"><span>Send by</span><div class="seg" id="msC"><button type="button" data-c="sms" class="${channel === 'sms' ? 'on' : ''}">SMS</button><button type="button" data-c="email" class="${channel === 'email' ? 'on' : ''}">Email</button></div></label>
      <label class="f" style="grid-column:1/-1"><span>To</span><input class="inp" id="msTo"></label>
      <label class="f" style="grid-column:1/-1"><span>Text <span class="hint" id="msLen"></span></span><textarea class="inp" id="msB" rows="5"></textarea></label></div>
      <div class="small" id="msWarn" style="color:var(--red)"></div>`,
    foot: '<button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="msGo">Send</button>',
  });
  const load = async () => {
    try {
      const p = await api('POST', '/messages/preview', Object.assign({}, ctx, { template, channel, body: template === 'custom' ? $('#msB').value || ' ' : undefined }));
      $('#msTo').value = p.to; if (template !== 'custom') $('#msB').value = p.body;
      $('#msWarn').textContent = p.optedOut ? 'This customer has not agreed to receive service reminders this way – the message will not be sent.' : '';
      $('#msLen').textContent = channel === 'sms' ? `· ${$('#msB').value.length} characters (${Math.max(1, Math.ceil($('#msB').value.length / 153))} SMS)` : '';
    } catch {}
  };
  $('#msT').onchange = () => { template = $('#msT').value; if (template === 'custom') $('#msB').value = ''; load(); };
  $$('#msC button').forEach((b) => (b.onclick = () => { channel = b.dataset.c; $$('#msC button').forEach((x) => x.classList.toggle('on', x === b)); load(); }));
  $('#msB').oninput = () => { $('#msLen').textContent = channel === 'sms' ? `· ${$('#msB').value.length} characters (${Math.max(1, Math.ceil($('#msB').value.length / 153))} SMS)` : ''; };
  await load();
  $('#msGo').onclick = async (e) => {
    const r = await act(e.currentTarget, () => api('POST', '/messages/send', Object.assign({}, ctx, { template, channel, to: $('#msTo').value, body: $('#msB').value })));
    if (r) { closeModal(); toast(r.status === 'sent' ? `${channel === 'sms' ? 'SMS' : 'Email'} sent` : r.status === 'not-configured' ? 'Saved to outbox – sending is not set up yet' : `Failed: ${r.error}`, r.status === 'failed' ? 'err' : undefined); App.refresh(); }
  };
}
function sendDocModal(kind, id) { return messageModal(kind === 'invoice' ? { invoiceId: id, template: 'invoice', channel: 'email' } : { jobId: id }); }

/* ---------- workshop board ---------- */
App.route('/board', async () => {
  const b = await api('GET', '/board');
  const jobCard = (j) => `<a class="bj" href="#/jobs/${esc(j.id)}"><div class="row between"><b>${esc(j.vehicle?.reg || '')}</b>${stageBadge(j.stage)}</div><div class="small muted">${esc(j.vehicle?.model || '')} · ${esc(j.jobType)}</div>
    ${j.onNow.length ? `<div class="small" style="color:var(--green)">${ic('clock', 'sm')} ${j.onNow.map((x) => `${esc(x.name)} · ${sinceText(x.since)}`).join(', ')}</div>` : j.technician ? `<div class="small muted">${ic('user', 'sm')} ${esc(j.technician)}</div>` : ''}
    ${j.waiting ? `<span class="badge b-amber" style="margin-top:4px">${esc(j.waiting)}</span>` : ''}</a>`;
  return {
    title: 'Workshop board',
    nav: 'board',
    html: `<div class="row wrap" style="gap:8px;margin-bottom:14px">${b.technicians.map((t) => `<span class="badge ${t.clockedOn ? 'b-green' : 'b-slate'}" style="padding:6px 10px">${ic('user', 'sm')} ${esc(t.name)} · ${t.clockedOn ? `on ${esc(t.clockedOn.jobId)} (${sinceText(t.clockedOn.since)})` : 'not clocked on'}</span>`).join('')}</div>
      <div class="board">${b.bays.map((x) => `<div class="bcol"><div class="bh">${esc(x.bay)} <span class="muted small">${x.jobs.length}</span></div>${x.jobs.map(jobCard).join('') || '<div class="small muted" style="padding:8px">Free</div>'}</div>`).join('')}
        <div class="bcol"><div class="bh">No bay yet <span class="muted small">${b.unassigned.length}</span></div>${b.unassigned.map(jobCard).join('') || '<div class="small muted" style="padding:8px">—</div>'}</div>
        <div class="bcol"><div class="bh">Ready to release <span class="muted small">${b.readyToRelease.length}</span></div>${b.readyToRelease.map(jobCard).join('') || '<div class="small muted" style="padding:8px">—</div>'}</div></div>`,
    after() { clearTimeout(window.__boardT); window.__boardT = setTimeout(() => { if (location.hash === '#/board') App.refresh(); }, 60000); },
  };
});

/* ---------- technician: my jobs ---------- */
App.route('/my', async () => {
  await App.loadClock();
  const c = App.clock || { jobs: [] };
  return {
    title: 'My jobs',
    nav: 'my',
    html: `<div class="card" style="margin-bottom:14px"><div class="card-b row wrap" style="gap:14px"><span class="vicon">${ic('clock')}</span><div class="grow"><b>${c.open ? `Clocked on to ${esc(c.open.jobId)} for ${sinceText(c.open.start)}` : 'Not clocked on'}</b><div class="small muted">${c.todayHours || 0} h recorded today</div></div>${c.open ? `<button class="btn danger lg" onclick="toggleClock('${esc(c.open.jobId)}', true)">Clock off</button>` : ''}</div></div>
      ${c.jobs.length ? c.jobs.map((j) => `<div class="card" style="margin-bottom:10px"><div class="lrow" style="flex-wrap:wrap"><div class="grow" style="min-width:200px"><a href="#/jobs/${esc(j.id)}?tab=work"><b>${esc(j.vehicle?.reg || '')}</b> ${esc(j.vehicle?.model || '')}</a><div class="small muted">${esc(j.id)} · ${esc(j.jobType)} · due ${fmtDT(j.promisedAt)}</div></div>${stageBadge(j.stage)}
        ${c.open && c.open.jobId === j.id ? `<button class="btn danger" onclick="toggleClock('${esc(j.id)}', true)">${ic('clock', 'sm')}Clock off</button>` : `<button class="btn primary" onclick="toggleClock('${esc(j.id)}', false)">${ic('clock', 'sm')}Clock on</button>`}</div></div>`).join('')
        : `<div class="card empty"><div class="ic">${ic('wrench', 'lg')}</div><h3>No jobs assigned to you</h3><p>Ask your service advisor, or open a job from the <a href="#/board">workshop board</a>.</p></div>`}`,
  };
});

/* ---------- bookings & service reminders ---------- */
App.route('/appointments', async (p, q) => {
  const tab = q.get('tab') || 'diary';
  const st = (App.ui.appt = App.ui.appt || { days: 7 });
  if (tab === 'reminders') {
    const due = await api('GET', `/reminders?days=${st.remDays || 30}`).catch(() => null);
    return {
      title: 'Bookings', nav: 'appointments',
      html: apptTabs(tab) + (due === null ? '<div class="card empty">You need the right “Send customer messages” to see reminders.</div>' : `<div class="row between wrap" style="gap:10px;margin-bottom:12px"><div class="seg">${[[30, 'Due in 30 days'], [60, '60 days'], [3650, 'All overdue / due']].map(([d, l]) => `<button class="${(st.remDays || 30) === d ? 'on' : ''}" onclick="App.ui.appt.remDays=${d};App.refresh()">${l}</button>`).join('')}</div>
        <button class="btn primary" onclick="sendReminders()">${ic('mail', 'sm')}SMS reminders to selected</button></div>
        <div class="card" style="overflow:hidden">${due.length ? `<div class="tbl-wrap"><table class="tbl rt"><thead><tr><th style="width:30px"><input type="checkbox" id="rmAll"></th><th>Vehicle</th><th>Customer</th><th>Last service</th><th>Due</th><th>Last reminder</th></tr></thead><tbody>
        ${due.map((r) => `<tr><td data-l=""><input type="checkbox" class="rmC" value="${esc(r.vin)}" ${r.smsOptIn && !r.booked ? '' : 'disabled'}></td><td class="lead" data-l="Vehicle"><a href="#/vehicles/${esc(r.vin)}"><b>${esc(r.rego)}</b></a> ${esc(r.vehicle)}${r.booked ? ' <span class="badge b-green">Booked</span>' : ''}</td><td data-l="Customer">${esc(r.customer)}<div class="small muted">${esc(fmtPhone(r.phone))}${r.smsOptIn ? '' : ' · <span style="color:var(--red)">no SMS consent</span>'}</div></td><td data-l="Last service">${fmtDate(r.lastServiceAt)}<div class="small muted">${Number(r.lastKm).toLocaleString('en-AU')} km</div></td><td data-l="Due"><b style="color:${r.daysLeft < 0 ? 'var(--red)' : 'inherit'}">${r.daysLeft < 0 ? `${-r.daysLeft} days overdue` : `in ${r.daysLeft} days`}</b><div class="small muted">by ${r.reason} · ~${Number(r.estKm).toLocaleString('en-AU')} km now</div></td><td data-l="Reminder">${r.lastReminderAt ? fmtDate(r.lastReminderAt) : '—'}</td></tr>`).join('')}
        </tbody></table></div>` : '<div class="empty">No vehicles due in this period.</div>'}</div>`),
      after() { const a = $('#rmAll'); if (a) a.onchange = () => $$('.rmC:not(:disabled)').forEach((x) => (x.checked = a.checked)); },
    };
  }
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + st.days * 86400000);
  const list = await api('GET', `/appointments?from=${from.toISOString()}&to=${to.toISOString()}`);
  const days = [...Array(st.days).keys()].map((i) => new Date(from.getTime() + i * 86400000));
  const AB = { booked: 'b-blue', confirmed: 'b-teal', arrived: 'b-green', 'no-show': 'b-red', cancelled: 'b-slate' };
  return {
    title: 'Bookings', nav: 'appointments',
    html: apptTabs(tab) + `<div class="row between wrap" style="gap:10px;margin-bottom:12px"><div class="seg">${[[7, 'Next 7 days'], [14, '14 days']].map(([d, l]) => `<button class="${st.days === d ? 'on' : ''}" onclick="App.ui.appt.days=${d};App.refresh()">${l}</button>`).join('')}</div>${App.can('appointments.manage') ? `<button class="btn primary" onclick="apptModal()">${ic('plus', 'sm')}New booking</button>` : ''}</div>
      ${days.map((d) => { const items = list.filter((a) => new Date(a.at).toDateString() === d.toDateString()); return `<div class="card" style="margin-bottom:10px;overflow:hidden"><div class="card-h"><h3>${d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}</h3><span class="small muted">${items.filter((a) => !['cancelled', 'no-show'].includes(a.status)).length} booking(s)</span></div>
        ${items.map((a) => `<div class="lrow" style="flex-wrap:wrap;gap:10px;opacity:${['cancelled', 'no-show'].includes(a.status) ? 0.55 : 1}"><b style="min-width:64px">${fmtTime(a.at)}</b><div class="grow" style="min-width:200px"><div class="t">${a.vin ? `<a href="#/vehicles/${esc(a.vin)}">${esc(a.rego)}</a>` : esc(a.rego || '—')} · ${esc(a.vehicle || '')} · ${esc(a.customerName)}</div><div class="small muted">${esc(a.repairType)} · ${a.durationMin} min · ${esc(fmtPhone(a.phone))}${a.notes ? ' · ' + esc(a.notes) : ''}${a.reminderSentAt ? ' · reminded ' + fmtDate(a.reminderSentAt) : ''}</div></div>
          <span class="badge ${AB[a.status]}">${esc(a.status)}</span>
          ${['booked', 'confirmed'].includes(a.status) ? `<div class="row" style="gap:4px">${a.vin ? `<a class="btn sm primary" href="#/new/${esc(a.vin)}">Check in</a>` : `<a class="btn sm primary" href="#/new?q=${encodeURIComponent(a.rego || a.phone)}" onclick="App.ui.wiz=null">Check in</a>`}${App.can('messages.send') ? `<button class="btn sm" onclick="apptRemind('${a.id}')">${ic('mail', 'sm')}</button>` : ''}${App.can('appointments.manage') ? `<button class="btn sm ghost" onclick="apptStatus('${a.id}')">More</button>` : ''}</div>` : a.jobId ? `<a class="btn sm" href="#/jobs/${esc(a.jobId)}">${esc(a.jobId)}</a>` : ''}</div>`).join('') || '<div class="small muted" style="padding:10px 16px">No bookings</div>'}</div>`; }).join('')}`,
  };
});
const apptTabs = (tab) => `<div class="tabs" style="margin-bottom:14px"><button class="${tab === 'diary' ? 'on' : ''}" onclick="App.go('#/appointments')">${ic('clock', 'sm')}Diary</button>${App.can('messages.send') ? `<button class="${tab === 'reminders' ? 'on' : ''}" onclick="App.go('#/appointments?tab=reminders')">${ic('mail', 'sm')}Service reminders</button>` : ''}</div>`;

async function apptModal() {
  const types = App.meta.lookups.jobTypes || [];
  const t = new Date(Date.now() + 86400000); t.setHours(8, 0, 0, 0);
  const local = new Date(t.getTime() - t.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  openModal({
    title: 'New booking',
    wide: true,
    body: `<div class="grid g2"><label class="f" style="grid-column:1/-1"><span>Vehicle on file <span class="hint">· rego, VIN, phone or name – or leave blank for a new customer</span></span><input class="inp" id="apQ" autocomplete="off"><div id="apR"></div></label>
      <label class="f"><span>Customer name</span><input class="inp" id="apN"></label><label class="f"><span>Mobile</span><input class="inp" id="apP" type="tel" placeholder="04xx xxx xxx"></label>
      <label class="f"><span>Rego</span><input class="inp" id="apRego" style="text-transform:uppercase"></label><label class="f"><span>Vehicle</span><input class="inp" id="apV" placeholder="e.g. D-Max SX"></label>
      <label class="f"><span>Date & time</span><input class="inp" id="apAt" type="datetime-local" value="${local}"></label><label class="f"><span>Duration</span><select class="inp" id="apD">${[30, 60, 90, 120, 180, 240, 480].map((m) => `<option value="${m}" ${m === 60 ? 'selected' : ''}>${m < 60 ? m + ' min' : m / 60 + ' h'}</option>`).join('')}</select></label>
      <label class="f"><span>Repair type</span><select class="inp" id="apT">${types.map((x) => `<option>${esc(x)}</option>`).join('')}</select></label><label class="f"><span>Notes</span><input class="inp" id="apNo"></label></div>`,
    foot: '<button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="apOk">Book</button>',
  });
  let vin = '';
  let tmr;
  $('#apQ').oninput = () => { clearTimeout(tmr); tmr = setTimeout(async () => {
    const term = $('#apQ').value.trim();
    if (term.length < 2) { $('#apR').innerHTML = ''; return; }
    const res = await api('GET', '/vehicles?q=' + encodeURIComponent(term));
    $('#apR').innerHTML = res.slice(0, 5).map((v) => `<div class="lrow click" data-v="${esc(v.vin)}" style="padding:6px 4px"><b>${esc(v.reg)}</b> ${esc(v.model)} · ${esc(v.ownerName)}</div>`).join('') || '<div class="small muted">Not on file – fill in the customer below.</div>';
    $$('#apR [data-v]').forEach((el) => (el.onclick = () => { vin = el.dataset.v; const v = res.find((x) => x.vin === vin); $('#apQ').value = `${v.reg} – ${v.ownerName}`; $('#apR').innerHTML = ''; $('#apN').value = v.ownerName; $('#apP').value = fmtPhone(v.ownerPhone); $('#apRego').value = v.reg; $('#apV').value = v.model; }));
  }, 250); };
  $('#apOk').onclick = async (e) => {
    const body = { at: new Date($('#apAt').value).toISOString(), durationMin: Number($('#apD').value), repairType: $('#apT').value, notes: $('#apNo').value };
    if (vin) body.vin = vin; else Object.assign(body, { customerName: $('#apN').value, phone: $('#apP').value, rego: $('#apRego').value, vehicle: $('#apV').value });
    if (await act(e.currentTarget, () => api('POST', '/appointments', body), 'Booked')) { closeModal(); App.refresh(); }
  };
}
async function apptRemind(id) { const r = await act(null, () => api('POST', `/appointments/${id}/remind`, {})); if (r) { toast(r.message.status === 'sent' ? 'Reminder sent' : 'Saved to outbox – SMS not set up yet'); App.refresh(); } }
function apptStatus(id) {
  openModal({ title: 'Update booking', body: `<div class="stack"><button class="btn" data-s="confirmed">Customer confirmed</button><button class="btn" data-s="no-show">No-show</button><label class="f">Cancel – reason<input class="inp" id="asR"></label><button class="btn danger" data-s="cancelled">Cancel booking</button></div>`, foot: '<button class="btn" onclick="closeModal()">Close</button>' });
  $$('#layer [data-s]').forEach((b) => (b.onclick = async () => { if (await act(b, () => api('POST', `/appointments/${id}/status`, { status: b.dataset.s, reason: $('#asR').value }), 'Updated')) { closeModal(); App.refresh(); } }));
}
async function sendReminders() {
  const vins = $$('.rmC:checked').map((x) => x.value);
  if (!vins.length) { toast('Tick the vehicles to remind', 'err'); return; }
  if (!(await confirmBox('Send service reminders?', `${vins.length} SMS reminder(s) will be sent. Customers without SMS consent are skipped.`, 'Send'))) return;
  const r = await act(null, () => api('POST', '/reminders/send', { vins, channel: 'sms' }));
  if (r) { const by = (s) => r.results.filter((x) => x.status === s).length; toast(`${by('sent')} sent · ${by('not-configured')} saved (SMS not set up) · ${by('skipped')} skipped`); App.refresh(); }
}

/* ---------- outbox ---------- */
App.route('/messages', async () => {
  const [list, prov] = await Promise.all([api('GET', '/messages'), api('GET', '/messages/providers')]);
  const SB = { sent: 'b-green', 'not-configured': 'b-amber', failed: 'b-red' };
  return {
    title: 'Messages', nav: 'messages',
    html: `<div class="row wrap" style="gap:8px;margin-bottom:12px"><span class="badge ${prov.sms ? 'b-green' : 'b-amber'}">SMS: ${prov.sms ? 'ClickSend connected' : 'not set up'}</span><span class="badge ${prov.email ? 'b-green' : 'b-amber'}">Email: ${prov.email ? 'Resend connected' : 'not set up'}</span>${prov.publicUrl ? '' : '<span class="badge b-slate">PUBLIC_URL not set – links use this server address</span>'}</div>
      <div class="card" style="overflow:hidden">${list.length ? `<div class="tbl-wrap"><table class="tbl rt"><thead><tr><th>When</th><th>To</th><th>Message</th><th>Status</th></tr></thead><tbody>
      ${list.map((m) => `<tr><td class="lead" data-l="When">${fmtDT(m.at)}<div class="small muted">${esc(m.by)}</div></td><td data-l="To">${m.channel === 'sms' ? 'SMS' : 'Email'} · ${esc(m.channel === 'sms' ? fmtPhone(m.to) : m.to)}${m.jobId ? `<div class="small"><a href="#/jobs/${esc(m.jobId)}">${esc(m.jobId)}</a></div>` : ''}</td><td data-l="Message" class="small" style="max-width:420px;white-space:normal">${esc(m.body)}</td><td data-l="Status"><span class="badge ${SB[m.status] || 'b-slate'}">${m.status === 'not-configured' ? 'Not sent' : esc(m.status)}</span>${m.error ? `<div class="small muted">${esc(m.error)}</div>` : ''}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">No messages yet.</div>'}</div>`,
  };
});
