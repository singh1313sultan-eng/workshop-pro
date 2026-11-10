/* Workshop Pro – photos & files on job cards, branch picker, dropdown lists, CSV import, backup/restore, audit log */
'use strict';

/* ================= job card: photos & files ================= */
function tabFiles() {
  setTimeout(loadFiles, 0);
  return `<div id="filesPane"><div class="loading"><div class="skel"></div></div></div>`;
}
async function loadFiles(tries = 0) {
  const el = $('#filesPane');
  if (!el) { if (tries < 20) setTimeout(() => loadFiles(tries + 1), 50); return; }
  const list = await api('GET', `/jobcards/${J.id}/attachments`).catch(() => []);
  const canAdd = App.can('jobs.edit') && J.status !== 'closed';
  const src = (a) => `/api/attachments/${encodeURIComponent(a.id)}/file`;
  el.innerHTML = `${canAdd ? `<div class="card" style="margin-bottom:14px"><div class="card-b row wrap" style="gap:10px">
      <label class="btn primary" style="cursor:pointer">${ic('plus', 'sm')}Take / add photos<input type="file" id="fUp" accept="image/*" capture="environment" multiple hidden></label>
      <label class="btn" style="cursor:pointer">${ic('clipboard', 'sm')}Add PDF / document<input type="file" id="fDoc" accept="application/pdf,image/*" multiple hidden></label>
      <select class="inp" id="fCat" style="width:auto"><option>Photo</option><option>Damage photo</option><option>Before repair</option><option>After repair</option><option>Insurance document</option><option>Assessor report</option><option>Document</option></select>
      <input class="inp" id="fCap" placeholder="Caption (optional)" style="flex:1;min-width:160px">
      <span class="small muted">Up to 8 MB each · stored privately</span></div></div>` : ''}
    ${list.length ? `<div class="gallery">${list.map((a) => `<figure class="gitem">${a.type.startsWith('image/') ? `<a href="${src(a)}" target="_blank" rel="noopener"><img src="${src(a)}" alt="${esc(a.caption || a.name)}" loading="lazy"></a>` : `<a class="gdoc" href="${src(a)}" target="_blank" rel="noopener">${ic('clipboard', 'lg')}<span>${esc(a.name)}</span></a>`}
        <figcaption><span class="badge b-slate">${esc(a.category)}</span> ${esc(a.caption || '')}<div class="small muted">${fmtDT(a.at)} · ${esc(a.by)} · ${Math.round(a.size / 1024)} KB</div>${canAdd ? `<button class="btn ghost sm" onclick="removeFile('${esc(a.id)}')">${ic('trash', 'sm')}Remove</button>` : ''}</figcaption></figure>`).join('')}</div>`
      : `<div class="card empty"><div class="ic">${ic('clipboard', 'lg')}</div><h3>No photos or files yet</h3><p>Add damage photos at check-in, before/after shots, insurance documents and assessor reports.</p></div>`}`;
  const up = async (files) => {
    for (const f of files) {
      if (f.size > 8 * 1024 * 1024) { toast(`${f.name} is larger than 8 MB`, 'err'); continue; }
      const data = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
      const type = f.type || (f.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
      await act(null, () => api('POST', `/jobcards/${J.id}/attachments`, { name: f.name, type, data, caption: $('#fCap')?.value || '', category: $('#fCat')?.value }), `${f.name} added`);
    }
    loadFiles();
  };
  $('#fUp') && ($('#fUp').onchange = (e) => up([...e.target.files]));
  $('#fDoc') && ($('#fDoc').onchange = (e) => up([...e.target.files]));
}
async function removeFile(id) {
  if (!(await confirmBox('Remove this file?', 'It will be deleted from the job card.', 'Remove', true))) return;
  if (await act(null, () => api('DELETE', `/attachments/${id}`), 'Removed')) loadFiles();
}

/* ================= branch picker ================= */
function initBranchPicker() {
  const outlets = (App.meta && App.meta.outlets) || [];
  const allowed = App.me && App.me.outletIds;
  const mine = allowed ? outlets.filter((o) => allowed.includes(o.id)) : outlets;
  const el = $('#branchSel');
  if (!el) return;
  if (outlets.length < 2 && !allowed) { el.classList.add('hide'); return; }
  const cur = localStorage.getItem('wpOutlet') || (allowed ? allowed[0] : 'all');
  el.innerHTML = `${allowed ? '' : `<option value="all" ${cur === 'all' ? 'selected' : ''}>All branches</option>`}${mine.map((o) => `<option value="${esc(o.id)}" ${o.id === cur ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}`;
  el.classList.remove('hide');
  el.onchange = () => { localStorage.setItem('wpOutlet', el.value); updateBrandbar(); App.updateBadges(); App.refresh(); toast(el.value === 'all' ? 'Showing all branches' : `Working at ${el.options[el.selectedIndex].text}`); };
}

/* ================= settings: lists, import, backup, audit ================= */
App.route('/admin/lists', async () => {
  const lists = await api('GET', '/settings/lists');
  const canEdit = App.can('setup.manage');
  return {
    title: 'Dropdown lists', nav: 'settings', back: '#/settings',
    html: `<p class="muted" style="margin-top:0">The choices offered in drop-downs across the app. One entry per line.</p><div class="grid g2">${lists.map((l) => `<div class="card"><div class="card-h"><h3>${esc(l.label)}</h3><span class="small muted">${l.values.length}</span></div><div class="card-b">
      <textarea class="inp" rows="${Math.min(10, l.values.length + 2)}" id="ls_${l.key}" ${canEdit ? '' : 'disabled'}>${esc(l.values.join('\n'))}</textarea>
      ${canEdit ? `<button class="btn sm primary" style="margin-top:8px" onclick="saveList('${l.key}', this)">Save</button>` : ''}</div></div>`).join('')}</div>`,
  };
});
async function saveList(key, btn) {
  const values = $('#ls_' + key).value.split('\n').map((x) => x.trim()).filter(Boolean);
  if (await act(btn, () => api('PUT', `/settings/lists/${key}`, { values }), 'List saved')) App.reloadMeta();
}

/* simple CSV parser (quotes, commas, CRLF) */
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const clean = rows.filter((r) => r.some((x) => x.trim()));
  if (!clean.length) return [];
  const head = clean[0].map((h) => h.trim());
  return clean.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
}

App.route('/admin/import', async () => {
  const tpls = await api('GET', '/import/templates');
  return {
    title: 'Import data', nav: 'settings', back: '#/settings',
    html: `<p class="muted" style="margin-top:0">Bring in existing customers, vehicles, parts and labour from a spreadsheet saved as CSV. Rows are checked first – nothing is saved until every row is valid and you press Import.</p>
      <div class="grid g3" style="margin-bottom:14px">${tpls.map((t) => `<div class="card"><div class="card-b"><b>${esc(t.label)}</b><div class="small muted mono" style="margin:6px 0;word-break:break-word">${t.columns.join(', ')}</div><button class="btn sm" onclick="csvTemplate('${t.key}')">${ic('download', 'sm')}Template</button> <label class="btn sm primary" style="cursor:pointer">Choose CSV<input type="file" accept=".csv,text/csv" hidden onchange="importFile('${t.key}', this.files[0])"></label></div></div>`).join('')}</div>
      <div id="impOut"></div>`,
  };
});
function csvTemplate(key) {
  api('GET', '/import/templates').then((t) => {
    const x = t.find((y) => y.key === key);
    const sample = { 'customers-vehicles': 'AB12CD,NSW,MPATFS86JKT012345,D-Max,SX 4x2,Mineral White,Diesel,Manual,4JJ3-123456,2024-05-01,Jane Citizen,0412 345 678,jane@example.com,"1 George St, Sydney NSW 2000",,Private', parts: '8981111111,Spark plug,Engine,Isuzu,OEM,EA,12.50,10,4,20,7.80', labour: 'X200,Electrical,Headlight alignment,20,55,10' }[key];
    const blob = new Blob(['﻿' + x.columns.join(',') + '\r\n' + sample + '\r\n'], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `import-${key}.csv`; a.click();
  });
}
async function importFile(kind, file) {
  if (!file) return;
  const rows = parseCsv(await file.text());
  window.__imp = { kind, rows };
  const res = await act(null, () => api('POST', `/import/${kind}`, { rows, commit: false }));
  if (!res) return;
  $('#impOut').innerHTML = `<div class="card" style="overflow:hidden"><div class="card-h"><h2>${esc(file.name)}</h2><span class="badge ${res.failed ? 'b-red' : 'b-green'}">${res.ok} OK · ${res.failed} with errors</span></div>
    <div class="tbl-wrap" style="max-height:50vh;overflow:auto"><table class="tbl"><thead><tr><th>Line</th><th>Result</th></tr></thead><tbody>${res.results.map((r) => `<tr><td>${r.line}</td><td>${r.ok ? `<span style="color:var(--green)">✓ ${esc(r.key)}</span> <span class="small muted">${esc(r.note || '')}</span>` : `<span style="color:var(--red)">${esc(r.error)}</span>`}</td></tr>`).join('')}</tbody></table></div>
    <div class="card-b">${res.failed ? '<span class="muted small">Fix the rows in red in your spreadsheet and choose the file again.</span>' : `<button class="btn primary" onclick="importCommit(this)">Import ${res.ok} row(s)</button>`}</div></div>`;
}
async function importCommit(btn) {
  const { kind, rows } = window.__imp;
  const res = await act(btn, () => api('POST', `/import/${kind}`, { rows, commit: true }));
  if (res) { $('#impOut').innerHTML = `<div class="alert info">${ic('check')}<div>${res.ok} row(s) imported.</div></div>`; App.reloadMeta(); }
}

App.route('/admin/backup', async () => ({
  title: 'Backup & restore', nav: 'settings', back: '#/settings',
  html: `<div class="grid g2"><div class="card"><div class="card-h"><h2>Download a backup</h2></div><div class="card-b"><p class="muted" style="margin-top:0">A complete copy of all data (job cards, invoices, stock, customers, settings and users) as one JSON file. Keep it somewhere safe – it contains customer details. Photos and files are stored separately and are not inside this file.</p>
      <button class="btn primary" onclick="downloadBackup(this)">${ic('download', 'sm')}Download backup</button></div></div>
    <div class="card"><div class="card-h"><h2>Restore a backup</h2></div><div class="card-b"><div class="alert err" style="margin-bottom:10px">${ic('alert')}<div>Restoring <b>replaces everything</b> with the contents of the backup. Download a fresh backup first.</div></div>
      <input type="file" id="rsF" accept="application/json,.json"><label class="f" style="margin-top:10px">Type RESTORE to confirm<input class="inp" id="rsC" autocomplete="off"></label>
      <button class="btn danger" style="margin-top:10px" onclick="restoreBackup(this)">Restore</button></div></div></div>`,
}));
async function downloadBackup(btn) {
  btn.disabled = true;
  try {
    const r = await fetch('/api/admin/backup', { headers: App.authMode === 'dev' && localStorage.getItem('wpUser') ? { 'X-User-Id': localStorage.getItem('wpUser') } : {} });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Backup failed');
    const blob = await r.blob();
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = (r.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'workshop-pro-backup.json';
    a.click(); toast('Backup downloaded');
  } catch (e) { toast(e.message, 'err'); } finally { btn.disabled = false; }
}
async function restoreBackup(btn) {
  const f = $('#rsF').files[0];
  if (!f) { toast('Choose a backup file', 'err'); return; }
  let body;
  try { body = JSON.parse(await f.text()); } catch { toast('That file is not valid JSON', 'err'); return; }
  body.confirm = $('#rsC').value;
  const r = await act(btn, () => api('POST', '/admin/restore', body));
  if (r) { toast(`Restored: ${r.jobs} job cards, ${r.vehicles} vehicles`); setTimeout(() => location.reload(), 800); }
}

App.route('/admin/audit', async (p, q) => {
  const term = q.get('q') || '';
  const list = await api('GET', '/audit?q=' + encodeURIComponent(term));
  return {
    title: 'Audit log', nav: 'settings', back: '#/settings',
    html: `<form class="row" style="gap:8px;margin-bottom:12px" onsubmit="event.preventDefault();App.go('#/admin/audit?q='+encodeURIComponent($('#auQ').value))"><label class="gsearch" style="display:flex;width:min(360px,100%)">${ic('search', 'sm')}<input id="auQ" value="${esc(term)}" placeholder="Search changes or people…"></label></form>
      <div class="card" style="overflow:hidden">${list.length ? `<div class="tbl-wrap"><table class="tbl rt"><thead><tr><th>When</th><th>Who</th><th>What changed</th></tr></thead><tbody>${list.map((a) => `<tr><td class="lead" data-l="When">${fmtDT(a.at)}</td><td data-l="Who">${esc(a.by)}</td><td data-l="What">${esc(a.text)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Nothing found.</div>'}</div>
      <p class="small muted">Job card changes are in each job card's Activity tab.</p>`,
  };
});
