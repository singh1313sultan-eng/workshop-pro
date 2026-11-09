// Workshop floor: technician time clock, workshop board, appointments and service reminders.
//
//   db.timeEntries   [{ id, jobId, lineId, userId, userName, start, end, note }]
//   db.appointments  [{ id, at, durationMin, vin, rego, vehicle, customerName, phone, email, repairType, notes, advisor, status, jobId, reminderSentAt, by, createdAt }]
//   vehicle.lastReminderAt

const au = require('./au');

const APPT_STATUSES = ['booked', 'confirmed', 'arrived', 'no-show', 'cancelled'];

function ensure(db) {
  db.timeEntries = db.timeEntries || [];
  db.appointments = db.appointments || [];
  db.meta.nextTime = db.meta.nextTime || 1;
  db.meta.nextAppt = db.meta.nextAppt || 1;
}
const seq = (db, key, prefix) => `${prefix}-${String(db.meta[key]++).padStart(6, '0')}`;
const hours = (e) => ((e.end ? Date.parse(e.end) : Date.now()) - Date.parse(e.start)) / 3600000;

function register(ctx) {
  const { route, getDb, save, bad, notFound, conflict, str, num, actorFn, findJob, vehicle, jobSummary, log, sendMessage } = ctx;
  const inOutlet = ctx.inOutlet || (() => true);
  const apptHere = (a) => inOutlet({ outletId: a.outletId });
  const db = () => { const d = getDb(); ensure(d); return d; };

  /* ---------- time clock ---------- */
  function clockOff(d, entry, note) {
    entry.end = new Date().toISOString();
    if (note) entry.note = note;
    const j = d.jobcards.find((x) => x.id === entry.jobId);
    if (j) log(j, `${entry.userName} clocked off (${hours(entry).toFixed(2)} h)`, entry.userName);
  }
  ctx.clockOffJob = (job) => { const d = db(); d.timeEntries.filter((e) => e.jobId === job.id && !e.end).forEach((e) => clockOff(d, e, 'Job closed')); };

  route('POST', '/api/jobcards/:id/clock', (req, q, p, body) => {
    const d = db();
    const u = actorFn();
    const j = findJob(p.id);
    const action = str(body.action);
    const open = d.timeEntries.find((e) => e.userId === u.id && !e.end);
    if (action === 'on') {
      if (j.status !== 'active') throw conflict(j.status === 'closed' ? 'This job card is closed' : 'This job card is on hold – resume it first');
      if (open && open.jobId === j.id) throw conflict('You are already clocked on to this job');
      if (open) clockOff(d, open, `Moved to ${j.id}`);
      const lineId = body.lineId != null ? Number(body.lineId) : null;
      if (lineId != null && !j.lines.some((l) => l.id === lineId && l.kind === 'labour')) throw bad('Choose a labour line of this job');
      const e = { id: seq(d, 'nextTime', 'TE'), jobId: j.id, lineId, userId: u.id, userName: u.name, start: new Date().toISOString(), end: null, note: '' };
      d.timeEntries.unshift(e);
      if (j.stage === 'checked_in') j.stage = 'in_progress';
      if (!j.technician) j.technician = u.name;
      log(j, `${u.name} clocked on${lineId != null ? ` – ${j.lines.find((l) => l.id === lineId).description}` : ''}`, u.name);
    } else if (action === 'off') {
      if (!open || open.jobId !== j.id) throw conflict('You are not clocked on to this job');
      clockOff(d, open, str(body.note, 200));
    } else throw bad('action must be on or off');
    save();
    return timeFor(d, j.id);
  });
  function timeFor(d, jobId) {
    const es = d.timeEntries.filter((e) => e.jobId === jobId);
    return { entries: es.map((e) => Object.assign({}, e, { hours: Math.round(hours(e) * 100) / 100 })), totalHours: Math.round(es.reduce((s, e) => s + hours(e), 0) * 100) / 100, onNow: es.filter((e) => !e.end).map((e) => e.userName) };
  }
  route('GET', '/api/jobcards/:id/time', (req, q, p) => timeFor(db(), findJob(p.id).id));
  route('GET', '/api/timeclock/me', () => {
    const d = db();
    const u = actorFn();
    const open = d.timeEntries.find((e) => e.userId === u.id && !e.end);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const mine = d.timeEntries.filter((e) => e.userId === u.id && Date.parse(e.start) >= today.getTime());
    return { open: open || null, todayHours: Math.round(mine.reduce((s, e) => s + hours(e), 0) * 100) / 100, jobs: d.jobcards.filter((j) => j.status !== 'closed' && j.technician === u.name).map(jobSummary) };
  });

  /* ---------- workshop board ---------- */
  route('GET', '/api/board', () => {
    const d = db();
    const open = d.jobcards.filter(inOutlet).filter((j) => j.status !== 'closed' || (j.status === 'closed' && !j.gatePass));
    const onNow = d.timeEntries.filter((e) => !e.end);
    const card = (j) => Object.assign(jobSummary(j), { bay: j.bay, technician: j.technician, onNow: onNow.filter((e) => e.jobId === j.id).map((e) => ({ name: e.userName, since: e.start })), waiting: j.lines.some((l) => l.status === 'pending') ? 'Customer approval' : j.status === 'on_hold' ? 'On hold' : j.lines.some((l) => l.kind === 'part' && l.status === 'approved' && (l.issuedQty || 0) < l.qty) ? 'Parts to issue' : '' });
    const bays = (d.lookups.bays || []).map((b) => ({ bay: b, jobs: open.filter((j) => j.bay === b && j.status !== 'closed').map(card) }));
    const techs = d.users.filter((u) => u.active !== false && /technician/i.test(u.role)).map((u) => { const e = onNow.find((x) => x.userId === u.id); return { name: u.name, clockedOn: e ? { jobId: e.jobId, since: e.start } : null, jobs: open.filter((j) => j.technician === u.name && j.status !== 'closed').length }; });
    return { bays, unassigned: open.filter((j) => !j.bay && j.status !== 'closed').map(card), readyToRelease: open.filter((j) => j.status === 'closed').map(card), technicians: techs };
  });

  /* ---------- appointments ---------- */
  function cleanAppt(d, body, existing) {
    const out = {};
    if (!existing || 'at' in body) {
      const at = new Date(body.at);
      if (isNaN(at)) throw bad('Choose the date and time', { field: 'at' });
      if (!existing && at < new Date(Date.now() - 3600000)) throw bad('The booking time is in the past', { field: 'at' });
      out.at = at.toISOString();
    }
    if (!existing || 'durationMin' in body) {
      const m = num(body.durationMin ?? 60, { min: 15, max: 600 });
      if (isNaN(m)) throw bad('Duration must be 15–600 minutes', { field: 'durationMin' });
      out.durationMin = Math.round(m);
    }
    if (!existing || 'vin' in body || 'customerName' in body) {
      const v = str(body.vin) ? vehicle(str(body.vin)) : null;
      if (str(body.vin) && !v) throw bad('Unknown vehicle', { field: 'vin' });
      if (v) Object.assign(out, { vin: v.vin, rego: v.reg, vehicle: `${v.model} ${v.variant || ''}`.trim(), customerName: v.owner.name, phone: v.owner.phone, email: v.owner.email || '' });
      else {
        const name = str(body.customerName, 80);
        if (!name) throw bad('Choose a vehicle on file, or enter the customer name', { field: 'customerName' });
        const ph = au.normPhone(body.phone);
        if (!ph) throw bad('Enter a valid Australian phone number', { field: 'phone' });
        Object.assign(out, { vin: '', rego: str(body.rego, 12).toUpperCase().replace(/\s+/g, ''), vehicle: str(body.vehicle, 60), customerName: name, phone: ph, email: str(body.email, 120) });
      }
    }
    if (!existing || 'repairType' in body) {
      const rt = str(body.repairType) || 'Periodic service';
      const names = (d.repairTypes || []).filter((r) => r.active !== false).map((r) => r.name);
      if (names.length && !names.includes(rt)) throw bad('Choose a repair type', { field: 'repairType' });
      out.repairType = rt;
    }
    for (const k of ['notes', 'advisor']) if (!existing || k in body) out[k] = str(body[k], k === 'notes' ? 500 : 80);
    return out;
  }
  const overlaps = (d, a, ignoreId) => d.appointments.filter((x) => x.id !== ignoreId && ['booked', 'confirmed'].includes(x.status) && x.vin && x.vin === a.vin && Math.abs(Date.parse(x.at) - Date.parse(a.at)) < 12 * 3600000);

  route('GET', '/api/appointments', (req, q) => {
    const d = db();
    const from = q.get('from') ? new Date(q.get('from')) : new Date(new Date().setHours(0, 0, 0, 0));
    const to = q.get('to') ? new Date(q.get('to')) : new Date(from.getTime() + 7 * 86400000);
    return d.appointments.filter(apptHere).filter((a) => Date.parse(a.at) >= from.getTime() && Date.parse(a.at) < to.getTime()).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  });
  route('POST', '/api/appointments', (req, q, p, body) => {
    const d = db();
    const a = Object.assign({ id: seq(d, 'nextAppt', 'APT'), outletId: ctx.outletFn ? ctx.outletFn() : null, status: 'booked', jobId: null, reminderSentAt: null, by: actorFn().name, createdAt: new Date().toISOString() }, cleanAppt(d, body, null));
    if (overlaps(d, a).length) throw conflict(`${a.rego} already has a booking within 12 hours of that time`);
    d.appointments.push(a);
    save();
    return a;
  });
  route('PATCH', '/api/appointments/:id', (req, q, p, body) => {
    const d = db();
    const a = d.appointments.find((x) => x.id === p.id);
    if (!a) throw notFound('Appointment');
    if (['arrived', 'cancelled', 'no-show'].includes(a.status)) throw conflict(`This booking is ${a.status}`);
    Object.assign(a, cleanAppt(d, body, a));
    if (overlaps(d, a, a.id).length) throw conflict(`${a.rego} already has a booking within 12 hours of that time`);
    save();
    return a;
  });
  route('POST', '/api/appointments/:id/status', (req, q, p, body) => {
    const d = db();
    const a = d.appointments.find((x) => x.id === p.id);
    if (!a) throw notFound('Appointment');
    const s = str(body.status);
    if (!APPT_STATUSES.includes(s)) throw bad(`Status must be one of ${APPT_STATUSES.join(', ')}`);
    if (s === 'cancelled' && !str(body.reason)) throw bad('Give a reason for the cancellation', { field: 'reason' });
    a.status = s;
    if (str(body.reason)) a.reason = str(body.reason, 200);
    if (s === 'arrived') a.arrivedAt = new Date().toISOString();
    save();
    return a;
  });
  route('POST', '/api/appointments/:id/remind', async (req, q, p, body) => {
    const d = db();
    const a = d.appointments.find((x) => x.id === p.id);
    if (!a) throw notFound('Appointment');
    const rec = await sendMessage('appointment', body.channel === 'email' ? 'email' : 'sms', { appointmentId: a.id }, req);
    if (!rec) throw bad('No phone / email on the booking');
    a.reminderSentAt = rec.at;
    a.reminderStatus = rec.status;
    save();
    return Object.assign({}, a, { message: rec });
  });
  // link a new job card to today's booking for the same vehicle
  ctx.linkAppointment = (job) => {
    const d = db();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const a = d.appointments.find((x) => x.vin === job.vin && ['booked', 'confirmed', 'arrived'].includes(x.status) && Date.parse(x.at) >= today.getTime() - 86400000 && Date.parse(x.at) < today.getTime() + 2 * 86400000);
    if (a) { a.status = 'arrived'; a.jobId = job.id; a.arrivedAt = a.arrivedAt || new Date().toISOString(); }
    return a;
  };

  /* ---------- service reminders ---------- */
  function dueList(d, days) {
    const months = Number(d.workshop.serviceIntervalMonths) || 12;
    const kms = Number(d.workshop.serviceIntervalKm) || 15000;
    const now = Date.now();
    return d.vehicles.map((v) => {
      const jobs = d.jobcards.filter((j) => j.vin === v.vin && /service/i.test(j.jobType) && j.invoice).map((j) => ({ at: j.invoice.at, km: j.odometer }));
      const hist = (v.history || []).filter((h) => /service/i.test(h.type)).map((h) => ({ at: h.closedAt, km: h.odometer }));
      const all = [...jobs, ...hist].filter((x) => x.at).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
      const last = all[0];
      if (!last) return null;
      const openJob = d.jobcards.some((j) => j.vin === v.vin && j.status !== 'closed');
      const booked = d.appointments.some((a) => a.vin === v.vin && ['booked', 'confirmed'].includes(a.status) && Date.parse(a.at) > now);
      const dueAt = new Date(last.at); dueAt.setMonth(dueAt.getMonth() + months);
      // estimate today's km from the vehicle's average daily km
      const first = all[all.length - 1];
      const perDay = all.length > 1 ? Math.max(0, (last.km - first.km) / Math.max(1, (Date.parse(last.at) - Date.parse(first.at)) / 86400000)) : 40;
      const estKm = Math.round(last.km + perDay * ((now - Date.parse(last.at)) / 86400000));
      const dueKm = last.km + kms;
      const daysLeftByKm = perDay > 0 ? Math.round((dueKm - estKm) / perDay) : 9999;
      const daysLeft = Math.min(Math.round((dueAt.getTime() - now) / 86400000), daysLeftByKm);
      return { vin: v.vin, rego: v.reg, vehicle: `${v.model} ${v.variant || ''}`.trim(), customer: v.owner.name, phone: v.owner.phone, email: v.owner.email, smsOptIn: v.owner.smsOptIn !== false, emailOptIn: v.owner.emailOptIn !== false, lastServiceAt: last.at, lastKm: last.km, estKm, dueAt: dueAt.toISOString(), dueKm, daysLeft, reason: daysLeft === daysLeftByKm && daysLeftByKm < Math.round((dueAt.getTime() - now) / 86400000) ? 'kilometres' : 'time', lastReminderAt: v.lastReminderAt || null, openJob, booked };
    }).filter((r) => r && r.daysLeft <= days && !r.openJob).sort((a, b) => a.daysLeft - b.daysLeft);
  }
  route('GET', '/api/reminders', (req, q) => dueList(db(), Number(q.get('days')) || 30));
  route('POST', '/api/reminders/send', async (req, q, p, body) => {
    const d = db();
    const channel = body.channel === 'email' ? 'email' : 'sms';
    const vins = Array.isArray(body.vins) ? body.vins : [];
    if (!vins.length) throw bad('Choose at least one vehicle');
    const due = dueList(d, 3650);
    const results = [];
    for (const vin of vins) {
      const r = due.find((x) => x.vin === vin);
      const v = vehicle(vin);
      if (!r || !v) { results.push({ vin, status: 'skipped', reason: 'not due' }); continue; }
      if (channel === 'sms' ? !r.smsOptIn : !r.emailOptIn) { results.push({ vin, status: 'skipped', reason: 'no consent' }); continue; }
      const dueText = r.daysLeft < 0 ? ' (overdue)' : ` by ${new Date(r.dueAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })} or ${r.dueKm.toLocaleString('en-AU')} km`;
      const rec = await sendMessage('reminder', channel, { vin, dueText }, req);
      if (!rec) { results.push({ vin, status: 'skipped', reason: `no ${channel === 'sms' ? 'mobile' : 'email'}` }); continue; }
      v.lastReminderAt = rec.at;
      results.push({ vin, status: rec.status, messageId: rec.id });
    }
    save();
    return { results };
  });
}

module.exports = { register, ensure, APPT_STATUSES };
