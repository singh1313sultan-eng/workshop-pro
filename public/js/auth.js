/* Workshop Pro – sign-in screen, change password, user menu */
'use strict';

function showLogin(message) {
  if ($('#loginScreen')) return;
  const el = document.createElement('div');
  el.id = 'loginScreen';
  el.innerHTML = `<form class="login-card" id="lgF" autocomplete="on" novalidate>
      <div class="brand" style="margin-bottom:18px"><span class="logo">${ic('wrench')}</span><div><b>Workshop Pro</b><span>${esc(App.meta?.workshop?.name || 'Sign in to continue')}</span></div></div>
      <h1 style="font-size:22px;margin:0 0 4px">Sign in</h1><p class="muted small" style="margin:0 0 16px">${esc(message || 'Use your User ID and password.')}</p>
      <label class="f"><span>User ID</span><input class="inp mono" id="lgE" type="text" autocomplete="username" autocapitalize="characters" spellcheck="false" placeholder="e.g. U001" required></label>
      <label class="f" style="margin-top:10px"><span>Password</span><input class="inp" id="lgP" type="password" autocomplete="current-password" required></label>
      <div id="lgErr" class="small" style="color:var(--red);min-height:18px;margin-top:8px"></div>
      <button class="btn primary lg" id="lgGo" style="width:100%;justify-content:center">Sign in</button>
      <p class="small muted" style="margin:14px 0 0">Forgotten your password? Ask your workshop administrator to set a temporary one.</p>
    </form>`;
  document.body.appendChild(el);
  hydrateIcons();
  $('#lgE').focus();
  $('#lgF').onsubmit = async (e) => {
    e.preventDefault();
    $('#lgErr').textContent = '';
    const btn = $('#lgGo');
    btn.disabled = true;
    try {
      const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: $('#lgE').value, password: $('#lgP').value }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { $('#lgErr').textContent = data.error || 'Could not sign in'; btn.disabled = false; $('#lgP').select(); return; }
      el.remove();
      if (data.mustChangePassword) { await changePasswordModal(true); }
      location.reload();
    } catch { $('#lgErr').textContent = 'Cannot reach the server'; btn.disabled = false; }
  };
}

function changePasswordModal(forced) {
  return new Promise((resolve) => {
    openModal({
      title: forced ? 'Choose a new password' : 'Change password',
      body: `${forced ? `<div class="alert info" style="margin-bottom:12px">${ic('info')}<div>You signed in with a temporary password. Choose your own before you continue.</div></div>` : ''}
        <form id="cpF" class="stack" onsubmit="return false">
        <label class="f"><span>Current ${forced ? '(temporary) ' : ''}password</span><input class="inp" id="cpC" type="password" autocomplete="current-password"></label>
        <label class="f"><span>New password <span class="hint">· at least 10 characters, letters and numbers</span></span><input class="inp" id="cpN" type="password" autocomplete="new-password"></label>
        <label class="f"><span>Repeat new password</span><input class="inp" id="cpR" type="password" autocomplete="new-password"></label></form>`,
      foot: `${forced ? '' : '<button class="btn" onclick="closeModal()">Cancel</button>'}<button class="btn primary" id="cpOk">Save password</button>`,
    });
    if (forced) { const x = $('#layer .modal .x, #layer [aria-label=Close]'); if (x) x.remove(); }
    $('#cpOk').onclick = async (e) => {
      if ($('#cpN').value !== $('#cpR').value) { toast('The new passwords do not match', 'err'); return; }
      const ok = await act(e.currentTarget, () => api('POST', '/auth/change-password', { current: $('#cpC').value, next: $('#cpN').value }), 'Password changed');
      if (ok) { closeModal(); resolve(true); }
    };
  });
}

function userMenu() {
  if (App.authMode !== 'password') return userSwitcher();
  const u = App.me?.user || {};
  openModal({
    title: u.name || 'Account',
    body: `<div class="lrow" style="padding:0 0 12px"><span class="avatar">${initials(u.name)}</span><div class="grow"><div class="t">${esc(u.name)}</div><div class="small muted">${esc(App.me?.role?.name || '')} · User ID ${esc(u.id)}</div></div></div>
      <div class="stack" style="gap:8px"><button class="btn" id="umPw">${ic('lock', 'sm')}Change password</button><button class="btn" id="umOut">${ic('back', 'sm')}Sign out</button><button class="btn ghost" id="umAll">Sign out on all devices</button></div>`,
    foot: '<button class="btn" onclick="closeModal()">Close</button>',
  });
  $('#umPw').onclick = () => { closeModal(); changePasswordModal(false); };
  const out = async (everywhere) => { await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ everywhere }) }); location.hash = ''; location.reload(); };
  $('#umOut').onclick = () => out(false);
  $('#umAll').onclick = () => out(true);
}

async function setPasswordModal(userId, name) {
  openModal({
    title: `Temporary password · ${name}`,
    body: `<p class="muted" style="margin-top:0">${esc(name)} signs in with their email and this password, and must choose a new one straight away. Give it to them in person or by phone – not by email.</p>
      <label class="f"><span>Temporary password <span class="hint">· at least 10 characters, letters and numbers</span></span><input class="inp" id="spP" type="text" autocomplete="off"></label>
      <button class="btn sm" type="button" id="spGen" style="margin-top:8px">Generate one</button>`,
    foot: '<button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" id="spOk">Set password</button>',
  });
  $('#spGen').onclick = () => { const a = new Uint8Array(8); crypto.getRandomValues(a); $('#spP').value = 'Wp' + [...a].map((x) => (x % 36).toString(36)).join('') + (10 + (a[0] % 89)); };
  $('#spOk').onclick = async (e) => { if (await act(e.currentTarget, () => api('POST', `/users/${userId}/password`, { password: $('#spP').value }), 'Temporary password set')) closeModal(); };
}
