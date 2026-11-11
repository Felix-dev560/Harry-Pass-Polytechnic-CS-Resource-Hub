'use strict';
const crypto = require('node:crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../database');
const config = require('../config');
const { COOKIE_NAME, asyncHandler, HttpError, issueSession, requireAdmin, cookieOptions } = require('../middleware');

const router = express.Router();
const BCRYPT_COST = 12;
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_COST);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in 15 minutes.' },
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;

function checkPassword(password) {
  if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
    throw new HttpError(400, `Password must be at least ${MIN_PASSWORD} characters.`);
  }
}

/** Compares the typed setup key with ADMIN_SETUP_KEY in constant time. False when no key is configured. */
function setupKeyMatches(given) {
  if (!config.adminSetupKey || typeof given !== 'string') return false;
  const digest = (value) => crypto.createHash('sha256').update(value).digest();
  return crypto.timingSafeEqual(digest(given), digest(config.adminSetupKey));
}

function readRegistrationData(body) {
  const first_name = typeof body?.first_name === 'string' ? body.first_name.trim() : '';
  const last_name = typeof body?.last_name === 'string' ? body.last_name.trim() : '';
  // Emails are stored and matched in lower case, so sign in does not depend on how it was typed.
  const email = (typeof body?.email === 'string' ? body.email.trim() : '').toLowerCase();
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!first_name || first_name.length > 50) throw new HttpError(400, 'Valid first name is required.');
  if (!last_name || last_name.length > 50) throw new HttpError(400, 'Valid last name is required.');
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Invalid email format.');
  checkPassword(password);
  return { first_name, last_name, email, password };
}

async function adminCount() {
  const { count, error } = await db.from('admins').select('id', { count: 'exact', head: true });
  if (error) throw error;
  return count ?? 0;
}

// Registration is only offered when there is no admin yet AND the server has a setup key to check it against.
router.get('/status', asyncHandler(async (_req, res) => {
  res.json({ registrationOpen: Boolean(config.adminSetupKey) && (await adminCount()) === 0 });
}));

router.post('/register', authLimiter, asyncHandler(async (req, res) => {
  const { first_name, last_name, email, password } = readRegistrationData(req.body);

  if ((await adminCount()) > 0) {
    throw new HttpError(403, 'An admin account already exists. Sign in instead.');
  }
  // Without the setup key, whoever opened /admin/ first after a database reset could take over the site.
  if (!config.adminSetupKey) throw new HttpError(403, 'Registration is switched off. Set ADMIN_SETUP_KEY on the server first.');
  if (!setupKeyMatches(req.body?.setup_key)) throw new HttpError(403, 'The setup key is not correct.');

  const password_hash = await bcrypt.hash(password, BCRYPT_COST);
  const { data, error } = await db.from('admins').insert({
    first_name,
    last_name,
    email,
    password_hash,
  }).select('id, email, session_version').single();

  if (error) {
    if (error.code === '23505') throw new HttpError(403, 'An admin account or email already exists.');
    throw error;
  }
  issueSession(res, data);
  res.status(201).json({ ok: true });
}));

router.post('/login', authLimiter, asyncHandler(async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!email || !password || password.length > 128) throw new HttpError(400, 'Enter your email and password.');

  const { data: admin, error } = await db.from('admins').select('id, email, password_hash, session_version').eq('email', email).maybeSingle();
  if (error) throw error;

  const ok = await bcrypt.compare(password, admin?.password_hash ?? DUMMY_HASH);
  if (!admin || !ok) throw new HttpError(401, 'Invalid credentials.');

  issueSession(res, admin, req.body?.remember === true);
  res.json({ ok: true });
}));

router.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE_NAME, cookieOptions());
  res.json({ ok: true });
});

router.get('/me', requireAdmin, (req, res) => {
  res.json({ email: req.admin.email });
});

// Changes the signed in admin's password. The new password has to be typed twice.
// Raising session_version signs out every other device; this device gets a fresh session straight away.
router.put('/password', requireAdmin, asyncHandler(async (req, res) => {
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const confirm = typeof req.body?.confirm_password === 'string' ? req.body.confirm_password : '';
  checkPassword(password);
  if (password !== confirm) throw new HttpError(400, 'The two passwords do not match.');

  const password_hash = await bcrypt.hash(password, BCRYPT_COST);
  const { data, error } = await db.from('admins')
    .update({ password_hash, session_version: req.admin.version + 1 })
    .eq('id', req.admin.sub).eq('session_version', req.admin.version) // only if nothing changed meanwhile
    .select('id, email, session_version').maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(409, 'Your session changed. Sign in again and retry.');
  issueSession(res, data, req.admin.remember);
  res.json({ ok: true });
}));

// Forgot password. There is no email service, so the proof of ownership is the ADMIN_SETUP_KEY that only the
// person who controls the server settings knows. Every old session is ended and the admin is signed in.
router.post('/reset', authLimiter, asyncHandler(async (req, res) => {
  if (!config.adminSetupKey) throw new HttpError(403, 'Password recovery is not set up. Add ADMIN_SETUP_KEY to the server settings.');
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const confirm = typeof req.body?.confirm_password === 'string' ? req.body.confirm_password : '';
  checkPassword(password);
  if (password !== confirm) throw new HttpError(400, 'The two passwords do not match.');

  const { data: admin, error: readError } = await db.from('admins').select('id, email, session_version').eq('email', email).maybeSingle();
  if (readError) throw readError;
  // One message for a wrong key and a wrong email, so this cannot be used to discover the admin's email.
  if (!setupKeyMatches(req.body?.setup_key) || !admin) throw new HttpError(403, 'The email or the setup key is not correct.');

  const password_hash = await bcrypt.hash(password, BCRYPT_COST);
  const { data: updated, error } = await db.from('admins')
    .update({ password_hash, session_version: admin.session_version + 1 })
    .eq('id', admin.id).select('id, email, session_version').single();
  if (error) throw error;
  issueSession(res, updated);
  res.json({ ok: true });
}));

module.exports = router;