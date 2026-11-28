// Staff sign-in/session and owner-only staff account management.
// The three staff-profile endpoints are registered by worker/staff-profiles.js,
// which index.js calls directly; they are deliberately not registered here.

import { randomBytes, scryptSync } from 'node:crypto';
import { json } from '../http.js';
import { safeEq } from '../env.js';
import { sameOrigin, setSessionCookie, clearSessionCookie } from '../auth.js';
import { audit, currentStaff, isStaffAdmin, isStaffOwner } from './misc.js';

const STAFF_MIN_PASSWORD = 8;
const STAFF_ROLES = ['owner', 'staff', 'viewer'];
const STAFF_USERNAME_RE = /^[a-z0-9][a-z0-9_.-]{2,31}$/;

function cleanStaffRole(role) { return STAFF_ROLES.includes(role) ? role : 'staff'; }
function cleanUsername(v) { return String(v || '').trim().toLowerCase(); }

function hashStaffPassword(password, saltHex) {
  const salt = Buffer.from(saltHex, 'hex');
  return scryptSync(String(password), salt, 64).toString('hex');
}

function makeStaffAccount(username, password, role = 'staff', createdBy = '') {
  const salt = randomBytes(16).toString('hex');
  return {
    id: 'stf_' + randomBytes(10).toString('hex'),
    username: String(username || '').trim().toLowerCase(),
    role: cleanStaffRole(role),
    salt,
    hash: hashStaffPassword(password, salt),
    active: true,
    createdAt: new Date().toISOString(),
    createdBy: String(createdBy || ''),
    lastLoginAt: '',
  };
}

function setStaffPassword(acct, password) {
  acct.salt = randomBytes(16).toString('hex');
  acct.hash = hashStaffPassword(password, acct.salt);
}

function verifyStaffPassword(acct, password) {
  if (!acct || !acct.salt || !acct.hash) return false;
  let got;
  try { got = hashStaffPassword(password, acct.salt); } catch { return false; }
  return safeEq(got, acct.hash);
}

function publicStaffAccount(a) {
  return {
    id: a.id, username: a.username, role: a.role,
    active: a.active !== false, createdAt: a.createdAt || '',
    createdBy: a.createdBy || '', lastLoginAt: a.lastLoginAt || '',
  };
}

async function ownerGuard(c) {
  if (!await isStaffAdmin(c)) return json({ error: 'Sign in first.' }, 401);
  if (!await isStaffOwner(c)) return json({ error: 'Only the owner can manage staff accounts.' }, 403);
  return null;
}

export function register(router) {
  router.post('/api/staff/signin', async c => {
    if (!sameOrigin(c.req)) return json({ error: 'Bad origin' }, 403);
    const db = c.db;
    const b = c.body && typeof c.body === 'object' ? c.body : {};
    const username = cleanUsername(b.username);
    const password = String(b.password || '');
    if (!username || !password) return json({ error: 'Enter your username and password.' }, 400);
    const acct = (db.staffAccounts || []).find(a => a.active !== false && a.username === username);
    if (!acct || !verifyStaffPassword(acct, password)) {
      return json({ error: 'Wrong username or password.' }, 401);
    }
    acct.lastLoginAt = new Date().toISOString();
    audit(c, 'staff_signin', acct.id);
    await c.store.save();
    const res = json({ ok: true, username: acct.username, role: acct.role });
    return setSessionCookie(res, c.env, 'staff', acct.id, c.req);
  });

  router.post('/api/staff/signout', c => {
    if (!sameOrigin(c.req)) return json({ error: 'Bad origin' }, 403);
    const res = json({ ok: true });
    return clearSessionCookie(res, 'staff', c.req);
  });

  router.get('/api/staff/session', c => {
    const acct = currentStaff(c);
    if (!acct) return json({ error: 'Not signed in.' }, 401);
    return json({ staff: true, username: acct.username, role: acct.role });
  });

  router.get('/api/admin/staff', async c => {
    const denied = await ownerGuard(c); if (denied) return denied;
    return json({ accounts: (c.db.staffAccounts || []).map(publicStaffAccount) });
  });

  router.post('/api/admin/staff', async c => {
    const denied = await ownerGuard(c); if (denied) return denied;
    const db = c.db;
    const b = c.body && typeof c.body === 'object' ? c.body : {};
    const username = cleanUsername(b.username);
    const password = String(b.password || '');
    const role = cleanStaffRole(b.role);
    if (!STAFF_USERNAME_RE.test(username)) {
      return json({ error: 'Username must be 3–32 characters: letters, numbers, _ . -' }, 400);
    }
    if (password.length < STAFF_MIN_PASSWORD) {
      return json({ error: 'Password must be at least ' + STAFF_MIN_PASSWORD + ' characters.' }, 400);
    }
    if ((db.staffAccounts || []).some(a => a.username === username)) {
      return json({ error: 'That username already exists.' }, 409);
    }
    const actor = currentStaff(c);
    const acct = makeStaffAccount(username, password, role, actor ? actor.username : 'owner');
    db.staffAccounts.push(acct);
    audit(c, 'staff_account_add', acct.username);
    await c.store.save();
    return json({ ok: true, account: publicStaffAccount(acct) });
  });

  router.post('/api/admin/staff/:id/password', async c => {
    const denied = await ownerGuard(c); if (denied) return denied;
    const db = c.db;
    const acct = (db.staffAccounts || []).find(a => a.id === c.params.id);
    if (!acct) return json({ error: 'No such staff account.' }, 404);
    const b = c.body && typeof c.body === 'object' ? c.body : {};
    const password = String(b.password || '');
    if (password.length < STAFF_MIN_PASSWORD) {
      return json({ error: 'Password must be at least ' + STAFF_MIN_PASSWORD + ' characters.' }, 400);
    }
    setStaffPassword(acct, password);
    audit(c, 'staff_account_password', acct.username);
    await c.store.save();
    return json({ ok: true, account: publicStaffAccount(acct) });
  });

  router.post('/api/admin/staff/:id/role', async c => {
    const denied = await ownerGuard(c); if (denied) return denied;
    const db = c.db;
    const acct = (db.staffAccounts || []).find(a => a.id === c.params.id);
    if (!acct) return json({ error: 'No such staff account.' }, 404);
    const b = c.body && typeof c.body === 'object' ? c.body : {};
    const role = String(b.role || '');
    if (!STAFF_ROLES.includes(role)) return json({ error: 'Unknown access level.' }, 400);
    const owners = db.staffAccounts.filter(a => a.role === 'owner' && a.active !== false);
    if (acct.role === 'owner' && role !== 'owner' && owners.length <= 1) {
      return json({ error: 'Keep at least one owner account.' }, 400);
    }
    acct.role = role;
    audit(c, 'staff_account_role', acct.username);
    await c.store.save();
    return json({ ok: true, account: publicStaffAccount(acct) });
  });

  router.delete('/api/admin/staff/:id', async c => {
    const denied = await ownerGuard(c); if (denied) return denied;
    const db = c.db;
    const idx = (db.staffAccounts || []).findIndex(a => a.id === c.params.id);
    if (idx < 0) return json({ error: 'No such staff account.' }, 404);
    const target = db.staffAccounts[idx];
    const owners = db.staffAccounts.filter(a => a.role === 'owner' && a.active !== false);
    if (target.role === 'owner' && owners.length <= 1) {
      return json({ error: 'Keep at least one owner account.' }, 400);
    }
    db.staffAccounts.splice(idx, 1);
    audit(c, 'staff_account_remove', target.username);
    await c.store.save();
    return json({ ok: true });
  });
}

export { publicStaffAccount };
