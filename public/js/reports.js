/* Workshop Pro – reports (Australia): BAS/GST, sales, payments, debtors, purchases, productivity, parts, stock */
'use strict';

const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
function presetRange(k) {
  const n = new Date(), y = n.getFullYear(), m = n.getMonth();
  const fyStart = m >= 6 ? y : y - 1; // Australian financial year starts 1 July
  const q0 = Math.floor(m / 3) * 3;
  switch (k) {
    case 'today': return [n, n];
    case 'month': return [new Date(y, m, 1), n];
    case 'lastmonth': return [new Date(y, m - 1, 1), new Date(y, m, 0)];
    case 'quarter': return [new Date(y, q0, 1), n];
    case 'lastquarter': return [new Date(y, q0 - 3, 1), new Date(y, q0, 0)];
    case 'fy': return [new Date(fyStart, 6, 1), n];
    case 'lastfy': return [new Date(fyStart - 1, 6, 1), new Date(fyStart, 5, 30)];
    default: return [new Date(y, m, 1), n];
  }
}
const PRESETS = [['today', 'Today'], ['month', 'This month'], ['lastmonth', 'Last month'], ['quarter', 'This BAS quarter'], ['lastquarter', 'Last BAS quarter'], ['fy', 'This financial year'], ['lastfy', 'Last financial year']];

App.route('/reports', async () => {
  const list = await api('GET', '/reports');
  const groups = [...new Set(list.map((r) => r.group))];
  return {
    title: 'Reports',
    nav: 'reports',
    html: groups.map((g) => `<h2 style="margin:6px 0 10px">${esc(g)}</h2><div class="grid g3" style="margin-bottom:18px">${list.filter((r) => r.group === g).map((r) => `<a class="card click" href="#/reports/${r.key}" style="text-decoration:none;color:inherit"><div class="card-b"><b>${esc(r.title)}</b><div class="small muted" style="margin-top:4px">${esc(r.desc)}</div></div></a>`).join('')}</div>`).join(''),
  };
});

App.route('/reports/:name', async ({ name }, q) => {
  const st = (App.ui['rep_' + name] = App.ui['rep_' + name] || { preset: name === 'gst' ? 'lastquarter' : 'month' });
  let [from, to] = st.from ? [new Date(st.from), new Date(st.to)] : presetRange(st.preset);
  const qs = `from=${iso(from)}&to=${iso(to)}`;
  const rep = await api('GET', `/reports/${name}?${qs}`);
  const fmt = (c, v) => (v == null || v === '' ? '—' : c.type === 'money' ? money(v) : c.type === 'pct' ? v + '%' : c.type === 'date' && /^\d{4}-\d\d-\d\d$/.test(v) ? new Date(v + 'T00:00').toLocaleDateString('en-AU') : esc(v));
  const asAt = ['stock', 'debtors'].includes(name);
  return {
    title: rep.title,
    nav: 'reports',
    back: '#/reports',
    html: `<div class="row between wrap noprint" style="gap:10px;margin-bottom:12px">
        ${asAt ? '<span class="badge b-slate">As at today</span>' : `<div class="row wrap" style="gap:8px"><select class="inp" id="rpP" style="width:auto">${PRESETS.map(([k, l]) => `<option value="${k}" ${!st.from && st.preset === k ? 'selected' : ''}>${l}</option>`).join('')}<option value="custom" ${st.from ? 'selected' : ''}>Custom…</option></select>
          <input class="inp" type="date" id="rpF" value="${iso(from)}" style="width:auto"><span class="muted">to</span><input class="inp" type="date" id="rpT" value="${iso(to)}" style="width:auto"></div>`}
        <div class="row" style="gap:8px"><button class="btn" onclick="downloadReport('${name}','${qs}')">${ic('download', 'sm')}Download CSV</button><button class="btn" onclick="window.print()">${ic('print', 'sm')}Print</button></div></div>
      <div class="card" style="overflow:hidden"><div class="card-h"><h2>${esc(rep.title)}</h2><span class="small muted">${esc(rep.period)}</span></div>
        ${rep.rows.length ? `<div class="tbl-wrap"><table class="tbl rt"><thead><tr>${rep.columns.map((c) => `<th class="${['money', 'num', 'pct'].includes(c.type) ? 'num' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>
        ${rep.rows.map((r) => `<tr>${rep.columns.map((c, i) => `<td class="${i === 0 ? 'lead' : ''} ${['money', 'num', 'pct'].includes(c.type) ? 'num' : ''}" data-l="${esc(c.label)}">${fmt(c, r[c.key])}</td>`).join('')}</tr>`).join('')}
        ${rep.totals ? `<tr style="font-weight:700;background:#f8fafc">${rep.columns.map((c, i) => `<td class="${['money', 'num', 'pct'].includes(c.type) ? 'num' : ''}" data-l="${esc(c.label)}">${rep.totals[c.key] != null ? fmt(c, rep.totals[c.key]) : i === 0 ? 'Total' : ''}</td>`).join('')}</tr>` : ''}
        </tbody></table></div>` : '<div class="empty">Nothing in this period.</div>'}
      </div>
      ${(rep.notes || []).map((n) => `<div class="small muted" style="margin-top:8px">${ic('info', 'sm')} ${esc(n)}</div>`).join('')}`,
    after() {
      const P = $('#rpP');
      if (!P) return;
      P.onchange = () => { if (P.value === 'custom') return; st.preset = P.value; delete st.from; delete st.to; App.refresh(); };
      const custom = () => { st.from = $('#rpF').value; st.to = $('#rpT').value; if (st.from && st.to) App.refresh(); };
      $('#rpF').onchange = custom; $('#rpT').onchange = custom;
    },
  };
});

async function downloadReport(name, qs) {
  const headers = {};
  const uid = localStorage.getItem('wpUser');
  if (uid) headers['X-User-Id'] = uid;
  const tok = localStorage.getItem('wpToken');
  if (tok) headers.Authorization = 'Bearer ' + tok;
  const r = await fetch(`/api/reports/${name}?${qs}&format=csv`, { headers, credentials: 'same-origin' });
  if (!r.ok) { toast('Could not download the report', 'err'); return; }
  const blob = await r.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (r.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || `${name}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
