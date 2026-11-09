// Customer messages (SMS / email), templates, outbox and public customer links.
//
// Providers (set in .env; without them messages are kept in the outbox as "not sent"):
//   SMS   – ClickSend:  CLICKSEND_USERNAME, CLICKSEND_API_KEY, SMS_FROM (sender name, max 11 chars)
//   Email – Resend:     RESEND_API_KEY, EMAIL_FROM ("Workshop <service@your-domain.com.au>")
//   PUBLIC_URL         – address customers use to open links, e.g. https://service.your-domain.com.au
//
// Spam Act 2003: service reminders are commercial messages – only sent to customers who agreed
// (smsOptIn / emailOptIn) and always include the business name and an opt-out.

const crypto = require('crypto');
const au = require('./au');

const TEMPLATES = {
  estimate: { label: 'Quote – approve online', marketing: false, subject: 'Your quote from {workshop}', sms: 'Hi {first}, your quote for the {vehicle} ({rego}) from {workshop} is ready: {total} incl GST. Review and approve here: {link} Questions? Call {phone}.' },
  ready: { label: 'Vehicle ready for collection', marketing: false, subject: 'Your {vehicle} is ready', sms: 'Hi {first}, your {vehicle} ({rego}) is ready for collection at {workshop}. {balanceLine} Questions? Call {phone}.' },
  invoice: { label: 'Tax invoice', marketing: false, subject: 'Tax invoice {invoice} from {workshop}', sms: 'Hi {first}, your tax invoice {invoice} from {workshop} for {total} is here: {link} {payLine}' },
  reminder: { label: 'Service reminder', marketing: true, subject: 'Your {vehicle} is due for a service', sms: 'Hi {first}, your {vehicle} ({rego}) is due for its logbook service{dueText}. Call {phone} to book. {workshop}. Reply STOP to opt out.' },
  appointment: { label: 'Appointment reminder', marketing: false, subject: 'Your booking at {workshop}', sms: 'Reminder: your {vehicle} ({rego}) is booked in at {workshop} on {date} at {time}. Need to change it? Call {phone}.' },
  custom: { label: 'Custom message', marketing: false, subject: 'Message from {workshop}', sms: '' },
};

const firstName = (n) => String(n || '').split(/\s+/)[0] || 'there';
const e164 = (p) => { const n = au.normPhone(p); return n && n.startsWith('0') ? '+61' + n.slice(1) : n; };
const fill = (t, v) => String(t || '').replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? String(v[k]) : ''));
const publicBase = (req) => process.env.PUBLIC_URL || (req ? `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}` : 'http://localhost:4300');

async function sendSms(to, body) {
  const u = process.env.CLICKSEND_USERNAME, k = process.env.CLICKSEND_API_KEY;
  if (!u || !k) return { status: 'not-configured', provider: 'none', error: 'SMS provider not set up (CLICKSEND_USERNAME / CLICKSEND_API_KEY)' };
  try {
    const r = await fetch('https://rest.clicksend.com/v3/sms/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(`${u}:${k}`).toString('base64') },
      body: JSON.stringify({ messages: [{ source: 'workshop-pro', from: process.env.SMS_FROM || undefined, to, body }] }),
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json().catch(() => ({}));
    const m = j.data && j.data.messages && j.data.messages[0];
    if (!r.ok || (m && m.status !== 'SUCCESS')) return { status: 'failed', provider: 'clicksend', error: (m && m.status) || j.response_msg || r.statusText };
    return { status: 'sent', provider: 'clicksend', providerId: m && m.message_id };
  } catch (e) { return { status: 'failed', provider: 'clicksend', error: e.message }; }
}
async function sendEmail(to, subject, text) {
  const k = process.env.RESEND_API_KEY, from = process.env.EMAIL_FROM;
  if (!k || !from) return { status: 'not-configured', provider: 'none', error: 'Email provider not set up (RESEND_API_KEY / EMAIL_FROM)' };
  try {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + k }, body: JSON.stringify({ from, to: [to], subject, text }), signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { status: 'failed', provider: 'resend', error: j.message || r.statusText };
    return { status: 'sent', provider: 'resend', providerId: j.id };
  } catch (e) { return { status: 'failed', provider: 'resend', error: e.message }; }
}

function ensure(db) {
  db.messages = db.messages || [];
  db.publicLinks = db.publicLinks || [];
  db.meta.nextMsg = db.meta.nextMsg || 1;
}

function register(ctx) {
  const { route, getDb, save, bad, notFound, conflict, str, actorName, findJob, vehicle, jobFull, totals, log } = ctx;
  const db = () => { const d = getDb(); ensure(d); return d; };

  function linkFor(d, kind, ref, req) {
    const days = Number(d.workshop.quoteValidityDays) || 14;
    let l = d.publicLinks.find((x) => x.kind === kind && x.ref === ref && Date.parse(x.expiresAt) > Date.now() + 86400000);
    if (!l) {
      l = { token: crypto.randomBytes(18).toString('base64url'), kind, ref, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + days * 86400000).toISOString(), opened: 0 };
      d.publicLinks.unshift(l);
    }
    return `${publicBase(req)}/p/${l.token}`;
  }

  /** Build the message for a template + context. */
  function compose(d, template, c, req) {
    const t = TEMPLATES[template];
    if (!t) throw bad('Unknown template', { field: 'template' });
    const w = d.workshop;
    let job = c.jobId ? d.jobcards.find((j) => j.id === c.jobId) : null;
    const inv = c.invoiceId ? (d.invoices || []).find((i) => i.id === c.invoiceId) : null;
    if (inv && !job) job = d.jobcards.find((j) => j.id === inv.jobId);
    const appt = c.appointmentId ? (d.appointments || []).find((a) => a.id === c.appointmentId) : null;
    const vin = c.vin || (job && job.vin) || (appt && appt.vin);
    const v = vin ? vehicle(vin) : null;
    const owner = (v && v.owner) || (appt ? { name: appt.customerName, phone: appt.phone, email: appt.email, smsOptIn: true, emailOptIn: true } : {});
    const vals = { workshop: w.name, phone: w.phone, first: firstName(owner.name), name: owner.name, vehicle: v ? `${v.model}` : appt ? appt.vehicle || 'vehicle' : 'vehicle', rego: v ? v.reg : appt ? appt.rego : '' };
    if (template === 'estimate') {
      if (!job) throw bad('Choose a job card');
      vals.total = au.money(totals(job, 'estimate').total);
      vals.link = linkFor(d, 'estimate', job.id, req);
    }
    if (template === 'ready') {
      if (!job) throw bad('Choose a job card');
      const owing = (d.invoices || []).filter((i) => i.jobId === job.id && i.kind === 'invoice' && i.status === 'issued' && i.payer === 'customer').reduce((s, i) => s + Math.max(0, i.balance ?? i.total), 0);
      vals.balanceLine = owing > 0 ? `Amount due ${au.money(owing)}.` : job.status === 'closed' ? 'Nothing to pay.' : '';
    }
    if (template === 'invoice') {
      if (!inv) throw bad('Choose an invoice');
      vals.invoice = inv.id; vals.total = au.money(inv.total);
      vals.link = linkFor(d, 'invoice', inv.id, req);
      vals.payLine = w.bsb ? `Pay by bank transfer BSB ${w.bsb} Acc ${w.accountNo}${w.payId ? ` or PayID ${w.payId}` : ''}, ref ${inv.id}.` : '';
    }
    if (template === 'reminder') vals.dueText = c.dueText || '';
    if (template === 'appointment') {
      if (!appt) throw bad('Choose an appointment');
      const at = new Date(appt.at);
      vals.date = at.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: w.timezone || 'Australia/Sydney' });
      vals.time = at.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: w.timezone || 'Australia/Sydney' });
    }
    const body = template === 'custom' ? str(c.body, 1500) : fill(t.sms, vals).replace(/\s+/g, ' ').trim();
    if (!body) throw bad('Write the message', { field: 'body' });
    return { template, marketing: t.marketing, subject: fill(t.subject, vals), body, owner, job, inv, appt, v };
  }

  async function deliver(d, msg, channel, to, opts = {}) {
    if (msg.marketing && ((channel === 'sms' && msg.owner.smsOptIn === false) || (channel === 'email' && msg.owner.emailOptIn === false))) {
      throw conflict(`${msg.owner.name || 'This customer'} has not agreed to receive service reminders by ${channel === 'sms' ? 'SMS' : 'email'}`);
    }
    const r = channel === 'sms' ? await sendSms(e164(to), msg.body) : await sendEmail(to, msg.subject, msg.body + `\n\n${d.workshop.legalName} · ABN ${d.workshop.abn}\n${d.workshop.address}, ${d.workshop.suburb} ${d.workshop.state} ${d.workshop.postcode} · ${d.workshop.phone}${msg.marketing ? '\nTo stop receiving these emails, reply UNSUBSCRIBE.' : ''}`);
    const rec = { id: `MSG-${String(d.meta.nextMsg++).padStart(6, '0')}`, at: new Date().toISOString(), channel, to, subject: channel === 'email' ? msg.subject : '', body: msg.body, template: msg.template, status: r.status, provider: r.provider, providerId: r.providerId || null, error: r.error || '', jobId: msg.job ? msg.job.id : null, invoiceId: msg.inv ? msg.inv.id : null, appointmentId: msg.appt ? msg.appt.id : null, vin: msg.v ? msg.v.vin : null, by: actorName() };
    d.messages.unshift(rec);
    if (d.messages.length > 5000) d.messages.length = 5000;
    if (msg.job && !opts.quiet) log(msg.job, `${channel === 'sms' ? 'SMS' : 'Email'} to ${to} (${TEMPLATES[msg.template].label}): ${rec.status === 'sent' ? 'sent' : rec.status === 'not-configured' ? 'NOT sent – provider not set up' : 'FAILED – ' + rec.error}`);
    return rec;
  }
  ctx.exportSend = async (template, channel, c, req) => {
    const d = db();
    const m = compose(d, template, c, req);
    const to = channel === 'sms' ? m.owner.phone : m.owner.email;
    if (!to) return null;
    return deliver(d, m, channel, to, { quiet: true });
  };

  route('GET', '/api/messages/templates', () => Object.entries(TEMPLATES).map(([k, t]) => ({ key: k, label: t.label, marketing: t.marketing })));
  route('GET', '/api/messages/providers', () => ({ sms: !!(process.env.CLICKSEND_USERNAME && process.env.CLICKSEND_API_KEY), email: !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM), publicUrl: process.env.PUBLIC_URL || '' }));
  route('GET', '/api/messages', (req, q) => {
    const d = db();
    const jobId = str(q.get('jobId'));
    return d.messages.filter((m) => !jobId || m.jobId === jobId).slice(0, 300);
  });
  route('POST', '/api/messages/preview', (req, q, p, body) => {
    const d = db();
    const m = compose(d, str(body.template), body, req);
    const channel = body.channel === 'email' ? 'email' : 'sms';
    return { subject: m.subject, body: m.body, to: channel === 'sms' ? au.formatPhone(m.owner.phone || '') : m.owner.email || '', marketing: m.marketing, optedOut: m.marketing && (channel === 'sms' ? m.owner.smsOptIn === false : m.owner.emailOptIn === false), segments: Math.ceil(m.body.length / 153) };
  });
  route('POST', '/api/messages/send', async (req, q, p, body) => {
    const d = db();
    const channel = body.channel === 'email' ? 'email' : 'sms';
    const m = compose(d, str(body.template), body, req);
    if (str(body.body) && body.template !== 'custom') m.body = str(body.body, 1500); // edited before sending
    let to = str(body.to) || (channel === 'sms' ? m.owner.phone : m.owner.email);
    if (channel === 'sms') { if (!au.isMobile(to)) throw bad('A valid Australian mobile number is needed for SMS', { field: 'to' }); to = au.normPhone(to); }
    else if (!/^\S+@\S+\.\S+$/.test(to || '')) throw bad('A valid email address is needed', { field: 'to' });
    const rec = await deliver(d, m, channel, to);
    save();
    return rec;
  });

  /* ---------- public customer pages (no sign-in; the link is the key) ---------- */
  const linkByToken = (d, token) => {
    const l = d.publicLinks.find((x) => x.token === token);
    if (!l) throw notFound('Link');
    if (Date.parse(l.expiresAt) < Date.now()) throw Object.assign(new Error('This link has expired. Please contact the workshop for a new one.'), { status: 410 });
    return l;
  };
  route('GET', '/api/public/:token', (req, q, p) => {
    const d = db();
    const l = linkByToken(d, p.token);
    l.opened = (l.opened || 0) + 1;
    l.lastOpenedAt = new Date().toISOString();
    const w = d.workshop;
    const shop = { name: w.name, legalName: w.legalName, abn: w.abn, phone: w.phone, email: w.email, address: `${w.address}, ${w.suburb} ${w.state} ${w.postcode}`, logo: w.logo || '' };
    if (l.kind === 'estimate') {
      const j = d.jobcards.find((x) => x.id === l.ref);
      if (!j) throw notFound('Quote');
      const v = vehicle(j.vin) || {};
      const lines = j.lines.filter((x) => x.status !== 'declined' || x.reason === 'Declined online').map((x) => {
        const net = Math.round(x.qty * x.rate * (1 - (x.discountPct || 0) / 100) * 100) / 100;
        const tax = Number(x.taxPct ?? 10);
        return { id: x.id, description: x.description, kind: x.kind, qty: x.qty, status: x.status, priceInc: Math.round(net * (1 + tax / 100) * 100) / 100, concern: (j.concerns.find((c) => c.id === x.concernId) || {}).text || '' };
      });
      return { kind: 'estimate', shop, jobId: j.id, closed: j.status === 'closed', customer: firstName(v.owner && v.owner.name), vehicle: `${v.model || ''} ${v.variant || ''}`.trim(), rego: v.reg, lines, total: totals(j, 'estimate').total, expiresAt: l.expiresAt };
    }
    if (l.kind === 'invoice') {
      const inv = (d.invoices || []).find((x) => x.id === l.ref);
      if (!inv) throw notFound('Invoice');
      const { by, ...safe } = inv;
      return Object.assign({ kind: 'invoice', shop }, safe);
    }
    throw notFound('Link');
  });
  route('POST', '/api/public/:token/decision', (req, q, p, body) => {
    const d = db();
    const l = linkByToken(d, p.token);
    if (l.kind !== 'estimate') throw bad('This link is not a quote');
    const j = d.jobcards.find((x) => x.id === l.ref);
    if (!j || j.status === 'closed') throw conflict('This job is already finished');
    const name = str(body.name, 80);
    if (!name) throw bad('Please type your name to confirm', { field: 'name' });
    const decisions = Array.isArray(body.decisions) ? body.decisions : [];
    const changed = [];
    for (const dcs of decisions) {
      const line = j.lines.find((x) => x.id === Number(dcs.lineId));
      if (!line || line.status !== 'pending') continue;
      if (!['approved', 'declined'].includes(dcs.decision)) continue;
      line.status = dcs.decision;
      line.reason = dcs.decision === 'declined' ? 'Declined online' : '';
      line.approvedOnline = { by: name, at: new Date().toISOString() };
      changed.push(`${dcs.decision === 'approved' ? 'approved' : 'declined'} "${line.description}"`);
    }
    if (!changed.length) throw bad('Nothing to update – choose approve or decline for the items waiting on you');
    log(j, `Customer (${name}) online: ${changed.join('; ')}`, `${name} (online)`);
    save();
    return { ok: true, updated: changed.length };
  });
}

module.exports = { register, TEMPLATES, sendSms, sendEmail, e164 };
