// Sign-in tests: runs the server in password mode (AUTH_MODE=password) with a throw-away data folder.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = 4398;
const BASE = `http://localhost:${PORT}/api`;
const ADMIN_EMAIL = 'sanjay.r@example.com';
// generated per run – never a real password
const FIRST = 'T' + crypto.randomBytes(6).toString('hex') + '1';
let proc, tmp;

async function call(method, url, body, cookie) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const r = await fetch(BASE + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const setCookie = r.headers.get('set-cookie');
  return { status: r.status, body: await r.json().catch(() => ({})), cookie: setCookie ? setCookie.split(';')[0] : null, raw: setCookie };
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wms-auth-'));
  proc = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env: Object.assign({}, process.env, { PORT, DATA_DIR: tmp, STORAGE: 'file', AUTH_MODE: 'password', ADMIN_PASSWORD: FIRST }), stdio: 'ignore' });
  for (let i = 0; i < 200; i++) {
    try { if ((await fetch(BASE + '/health')).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
});
after(() => { proc.kill(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('password mode: sign-in, forced change, lockout, admin reset, sign-out', async () => {
  // nothing works without signing in; X-User-Id is ignored
  assert.equal((await call('GET', '/me')).status, 401);
  const viaHeader = await fetch(BASE + '/jobcards', { headers: { 'X-User-Id': 'U008' } });
  assert.equal(viaHeader.status, 401);
  assert.equal((await call('GET', '/health')).status, 200);
  assert.equal((await call('GET', '/auth/mode')).body.mode, 'password');

  // wrong password
  assert.equal((await call('POST', '/auth/login', { email: ADMIN_EMAIL, password: 'nope-12345' })).status, 401);
  assert.equal((await call('POST', '/auth/login', { email: 'nobody@example.com', password: FIRST })).status, 401);

  // first sign-in: must change the password before doing anything else
  const login = await call('POST', '/auth/login', { email: ADMIN_EMAIL.toUpperCase(), password: FIRST });
  assert.equal(login.status, 200);
  assert.ok(login.raw.includes('HttpOnly') && login.raw.includes('SameSite=Lax'));
  assert.equal(login.body.mustChangePassword, true);
  assert.equal(login.body.user.passwordHash, undefined);
  let cookie = login.cookie;
  assert.equal((await call('GET', '/me', null, cookie)).body.mustChangePassword, true);
  assert.equal((await call('GET', '/jobcards', null, cookie)).status, 403);
  assert.equal((await call('POST', '/auth/change-password', { current: FIRST, next: 'short1' }, cookie)).status, 400);
  assert.equal((await call('POST', '/auth/change-password', { current: FIRST, next: 'onlyletterslong' }, cookie)).status, 400);
  assert.equal((await call('POST', '/auth/change-password', { current: 'wrong', next: 'Workshop2026x' }, cookie)).status, 400);
  const NEW = 'W' + crypto.randomBytes(6).toString('hex') + '9';
  const ch = await call('POST', '/auth/change-password', { current: FIRST, next: NEW }, cookie);
  assert.equal(ch.status, 200);
  assert.equal((await call('GET', '/jobcards', null, cookie)).status, 401); // old session ended
  cookie = ch.cookie;
  assert.equal((await call('GET', '/jobcards', null, cookie)).status, 200);

  // password data never leaves the server
  const users = (await call('GET', '/masters/users', null, cookie)).body;
  assert.ok(users.every((u) => u.passwordHash === undefined));
  assert.equal(users.find((u) => u.id === 'U008').hasPassword, true);
  assert.ok((await call('GET', '/meta', null, cookie)).body.users.every((u) => u.passwordHash === undefined));

  // admin sets a temporary password for the advisor
  const TEMP = 'A' + crypto.randomBytes(6).toString('hex') + '7';
  assert.equal((await call('POST', '/users/U001/password', { password: 'weak' }, cookie)).status, 400);
  assert.equal((await call('POST', '/users/U001/password', { password: TEMP }, cookie)).status, 200);
  const adv = await call('POST', '/auth/login', { email: 'arun.kumar@example.com', password: TEMP });
  assert.equal(adv.body.mustChangePassword, true);
  // the advisor cannot reset other people's passwords
  const ADV2 = 'B' + crypto.randomBytes(6).toString('hex') + '3';
  const advCh = await call('POST', '/auth/change-password', { current: TEMP, next: ADV2 }, adv.cookie);
  assert.equal((await call('POST', '/users/U002/password', { password: TEMP }, advCh.cookie)).status, 403);

  // 5 wrong attempts lock the account
  for (let i = 0; i < 5; i++) await call('POST', '/auth/login', { email: 'arun.kumar@example.com', password: 'wrong-pass-1' });
  assert.equal((await call('POST', '/auth/login', { email: 'arun.kumar@example.com', password: ADV2 })).status, 423);
  // an admin reset unlocks it
  await call('POST', '/users/U001/password', { password: TEMP }, cookie);
  assert.equal((await call('POST', '/auth/login', { email: 'arun.kumar@example.com', password: TEMP })).status, 200);

  // sign out everywhere ends every session
  const out = await call('POST', '/auth/logout', { everywhere: true }, cookie);
  assert.equal(out.status, 200);
  assert.ok(out.raw.includes('Max-Age=0'));
  assert.equal((await call('GET', '/jobcards', null, cookie)).status, 401);
});
