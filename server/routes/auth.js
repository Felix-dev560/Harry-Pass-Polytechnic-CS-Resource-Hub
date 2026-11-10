'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../database');
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

function readRegistrationData(body) {
  const first_name = typeof body?.first_name === 'string' ? body.first_name.trim() : '';
  const last_name = typeof body?.last_name === 'string' ? body.last_name.trim() : '';
  // Emails are stored and matched in lower case, so sign in does not depend on how it was typed.
  const email = (typeof body?.email === 'string' ? body.email.trim() : '').toLowerCase();
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!first_name || first_name.length > 50) throw new HttpError(400, 'Valid first name is required.');
  if (!last_name || last_name.length > 50) throw new HttpError(400, 'Valid last name is required.');
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Invalid email format.');
  if (password.length < 4 || password.length > 128) {
    throw new HttpError(400, 'Password must be at least 4 characters.');
  }
  return { first_name, last_name, email, password };
}

async function adminCount() {
  const { count, error } = await db.from('admins').select('id', { count: 'exact', head: true });
  if (error) throw error;
  return count ?? 0;
}

router.get('/status', asyncHandler(async (_req, res) => {
  res.json({ registrationOpen: (await adminCount()) === 0 });
}));

router.post('/register', authLimiter, asyncHandler(async (req, res) => {
  const { first_name, last_name, email, password } = readRegistrationData(req.body);

  if ((await adminCount()) > 0) {
    throw new HttpError(403, 'An admin account already exists. Sign in instead.');
  }

  const password_hash = await bcrypt.hash(password, BCRYPT_COST);
  const { data, error } = await db.from('admins').insert({
    first_name,
    last_name,
    email,
    password_hash,
  }).select('id, email').single();

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

  const { data: admin, error } = await db.from('admins').select('id, email, password_hash').eq('email', email).maybeSingle();
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
router.put('/password', requireAdmin, asyncHandler(async (req, res) => {
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const confirm = typeof req.body?.confirm_password === 'string' ? req.body.confirm_password : '';
  if (password.length < 4 || password.length > 128) throw new HttpError(400, 'Password must be at least 4 characters.');
  if (password !== confirm) throw new HttpError(400, 'The two passwords do not match.');

  const password_hash = await bcrypt.hash(password, BCRYPT_COST);
  const { data, error } = await db.from('admins').update({ password_hash }).eq('id', req.admin.sub).select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, 'Admin account not found.');
  res.json({ ok: true });
}));

module.exports = router;