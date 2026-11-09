// Sign-in: User ID (e.g. U008) + password (scrypt), signed session cookie, lockout, forced password change.
//
// AUTH_MODE=password (default) – every request needs a session (cookie "wp_session" or "Authorization: Bearer").
// AUTH_MODE=dev                – no passwords; the X-User-Id header picks the user (automated tests / local demos).
//
// Users carry: passwordHash ("scrypt$N$salt$hash"), mustChangePassword, failedLogins, lockedUntil, sessionVersion.
// A session token is "userId.version.expiry.signature" (HMAC-SHA256). Signing out everywhere bumps sessionVersion.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MODE = () => (process.env.AUTH_MODE || 'password').toLowerCase();
const COOKIE = 'wp_session';
const TTL_MS = 12 * 3600 * 1000; // a working day
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const SECRET_FIELDS = ['passwordHash', 'failedLogins', 'lockedUntil', 'sessionVersion'];

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 32, { N: 16384 }).toString('hex');
  return `scrypt$16384$${salt}$${hash}`;
}
function verifyPassword(pw, stored) {
  if (!stored) return false;
  const [algo, n, salt, hash] = String(stored).split('$');
  if (algo !== 'scrypt') return false;
  const test = crypto.scryptSync(String(pw), salt, 32, { N: Number(n) });
  const want = Buffer.from(hash, 'hex');
  return want.length === test.length && crypto.timingSafeEqual(want, test);
}
/** At least 10 characters with a letter and a number. */
function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'Password must be at least 10 characters';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Password must contain letters and numbers';
  if (pw.length > 200) return 'Password is too long';
  return null;
}
const randomPassword = () => crypto.randomBytes(9).toString('base64').replace(/[+/=]/g, '').slice(0, 10) + Math.floor(10 + Math.random() * 89);

function secretOf(db) {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (!db.meta.sessionSecret) db.meta.sessionSecret = crypto.randomBytes(32).toString('hex');
  return db.meta.sessionSecret;
}
const sign = (db, payload) => crypto.createHmac('sha256', secretOf(db)).update(payload).digest('base64url');
function makeToken(db, user) {
  const payload = `${user.id}.${user.sessionVersion || 0}.${Date.now() + TTL_MS}`;
  return `${payload}.${sign(db, payload)}`;
}
function readToken(db, token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 4) return null;
  const payload = parts.slice(0, 3).join('.');
  const want = Buffer.from(sign(db, payload));
  const got = Buffer.from(parts[3]);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  const [id, ver, exp] = parts;
  if (Number(exp) < Date.now()) return null;
  const u = db.users.find((x) => x.id === id);
  if (!u || u.active === false || String(u.sessionVersion || 0) !== ver) return null;
  return u;
}
const cookieOf = (req, name) => (String(req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(name + '=')) || '').slice(name.length + 1);
function sessionCookie(req, token, maxAgeSec) {
  const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted || process.env.COOKIE_SECURE === '1';
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
}
/** Remove password data before a user record leaves the server. */
const publicUser = (u) => { if (!u) return u; const o = Object.assign({}, u); SECRET_FIELDS.forEach((k) => delete o[k]); o.hasPassword = !!u.passwordHash; return o; };

/**
 * First start in password mode: make sure an administrator can sign in.
 * Uses ADMIN_PASSWORD if set; otherwise generates a one-off password, prints it to the
 * server console and writes it to data/initial-admin-password.txt (delete after first use).
 */
function bootstrap(db, dataDir, isAdmin) {
  if (MODE() !== 'password') return false;
  if (db.users.some((u) => u.passwordHash && isAdmin(u))) return false;
  const admin = db.users.find((u) => isAdmin(u));
  if (!admin) return false;
  const pw = process.env.ADMIN_PASSWORD || randomPassword();
  admin.passwordHash = hashPassword(pw);
  admin.mustChangePassword = true;
  if (!process.env.ADMIN_PASSWORD) {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(path.join(dataDir, 'initial-admin-password.txt'), `Workshop Pro – first sign-in\nUser ID:  ${admin.id}\nPassword: ${pw}\n\nYou will be asked to choose a new password. Delete this file afterwards.\n`, { mode: 0o600 });
    } catch {}
    console.log(`\n*** First sign-in: User ID ${admin.id} – one-off password written to ${path.join(dataDir, 'initial-admin-password.txt')} ***\n`);
  }
  return true;
}

function register({ route, getDb, save, bad, conflict, str, HttpError, audit, actorFn }) {
  const db = () => getDb();

  route('GET', '/api/auth/mode', () => ({ mode: MODE() }));

  route('POST', '/api/auth/login', (req, q, p, body, res) => {
    if (MODE() !== 'password') throw bad('Sign-in is switched off (AUTH_MODE=dev)');
    const d = db();
    const userId = str(body.userId, 40).trim().toUpperCase();
    const u = userId ? d.users.find((x) => String(x.id).toUpperCase() === userId) : null;
    const fail = () => new HttpError(401, 'User ID or password is incorrect');
    if (!u || u.active === false || !u.passwordHash) { crypto.scryptSync('x', 'y', 32, { N: 16384 }); throw fail(); } // same timing either way
    if (u.lockedUntil && Date.parse(u.lockedUntil) > Date.now()) throw new HttpError(423, `Too many attempts. Try again after ${new Date(u.lockedUntil).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}, or ask an administrator to reset your password.`);
    if (!verifyPassword(String(body.password || ''), u.passwordHash)) {
      u.failedLogins = (u.failedLogins || 0) + 1;
      if (u.failedLogins >= MAX_FAILS) { u.lockedUntil = new Date(Date.now() + LOCK_MS).toISOString(); u.failedLogins = 0; audit(`Sign-in locked for ${u.name} after ${MAX_FAILS} failed attempts`, u.name); }
      save();
      throw fail();
    }
    u.failedLogins = 0;
    delete u.lockedUntil;
    u.lastLoginAt = new Date().toISOString();
    save();
    res.setHeader('Set-Cookie', sessionCookie(req, makeToken(d, u), TTL_MS / 1000));
    return { user: publicUser(u), mustChangePassword: !!u.mustChangePassword };
  });

  route('POST', '/api/auth/logout', (req, q, p, body, res) => {
    const u = actorFn();
    if (u && body && body.everywhere) { u.sessionVersion = (u.sessionVersion || 0) + 1; save(); }
    res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
    return { ok: true };
  });

  route('POST', '/api/auth/change-password', (req, q, p, body, res) => {
    const u = actorFn();
    if (!u) throw new HttpError(401, 'Sign in first');
    if (u.passwordHash && !verifyPassword(String(body.current || ''), u.passwordHash)) throw bad('Current password is incorrect', { field: 'current' });
    const problem = passwordProblem(body.next);
    if (problem) throw bad(problem, { field: 'next' });
    if (u.passwordHash && verifyPassword(body.next, u.passwordHash)) throw bad('Choose a password different from the current one', { field: 'next' });
    u.passwordHash = hashPassword(body.next);
    u.mustChangePassword = false;
    u.sessionVersion = (u.sessionVersion || 0) + 1; // signs out other devices
    audit(`${u.name} changed their password`, u.name);
    save();
    res.setHeader('Set-Cookie', sessionCookie(req, makeToken(db(), u), TTL_MS / 1000));
    return { ok: true };
  });

  // administrators set a temporary password (the user must change it at next sign-in)
  route('POST', '/api/users/:id/password', (req, q, p, body) => {
    const d = db();
    const u = d.users.find((x) => x.id === p.id);
    if (!u) throw new HttpError(404, 'User not found');
    const problem = passwordProblem(body.password);
    if (problem) throw bad(problem, { field: 'password' });
    u.passwordHash = hashPassword(body.password);
    u.mustChangePassword = true;
    u.failedLogins = 0;
    delete u.lockedUntil;
    u.sessionVersion = (u.sessionVersion || 0) + 1;
    const a = actorFn();
    audit(`Temporary password set for ${u.name}`, a ? a.name : 'System');
    save();
    return { ok: true, mustChangePassword: true };
  });
}

/** Who is making this request? Returns a user, or null (password mode, not signed in). */
function requestUser(req, db, { defaultUser, HttpError }) {
  if (MODE() === 'dev') {
    const id = req.headers['x-user-id'];
    if (!id) return defaultUser(db);
    const u = db.users.find((x) => x.id === String(id));
    if (!u || u.active === false) throw new HttpError(401, 'Your user is unknown or inactive. Choose a user again.');
    return u;
  }
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : cookieOf(req, COOKIE);
  return token ? readToken(db, token) : null;
}

module.exports = { MODE, register, requestUser, bootstrap, publicUser, hashPassword, verifyPassword, passwordProblem, SECRET_FIELDS };
