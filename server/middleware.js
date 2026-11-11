'use strict';
const jwt = require('jsonwebtoken');
const config = require('./config');
const db = require('./database');

const COOKIE_NAME = 'hp_admin';
const SESSION_MS = 8 * 60 * 60 * 1000; // normal sign in: 8 hours, and the cookie ends when the browser closes
const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000; // "Keep me signed in": 30 days

/** Wraps async route handlers so rejected promises reach the Express error handler. */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Error with an HTTP status that is safe to show to the client. */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function cookieOptions(remember = false) {
  const options = {
    httpOnly: true, // not readable by page scripts, which limits XSS damage
    sameSite: 'strict', // blocks cross-site requests, which is the CSRF defence for this API
    secure: config.isProd,
    path: '/',
  };
  // Without "remember" there is no maxAge, so it is a session cookie that the browser drops on close.
  if (remember) options.maxAge = REMEMBER_MS;
  return options;
}

// `v` is the admin's session_version. Changing the password raises it, which makes every older token invalid.
// `rem` remembers whether this was a "keep me signed in" session, so a new token can keep the same lifetime.
function issueSession(res, admin, remember = false) {
  const token = jwt.sign({ sub: admin.id, email: admin.email, v: admin.session_version ?? 0, rem: remember }, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: Math.round((remember ? REMEMBER_MS : SESSION_MS) / 1000),
  });
  res.cookie(COOKIE_NAME, token, cookieOptions(remember));
}

// Checks the cookie AND the database: the admin must still exist and the token's session version must match.
// That is what ends old sessions after a password change, and rejects tokens left over from a reset database.
const requireAdmin = asyncHandler(async (req, _res, next) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) throw new HttpError(401, 'Sign in required.');
  let payload;
  try {
    // Pin the algorithm so a forged "alg: none" token is rejected.
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    throw new HttpError(401, 'Session expired. Sign in again.');
  }
  const { data: admin, error } = await db.from('admins').select('id, email, session_version').eq('id', payload.sub).maybeSingle();
  if (error) throw error;
  if (!admin || admin.session_version !== (payload.v ?? 0)) throw new HttpError(401, 'Session expired. Sign in again.');
  req.admin = { sub: admin.id, email: admin.email, version: admin.session_version, remember: payload.rem === true };
  next();
});

module.exports = { COOKIE_NAME, asyncHandler, HttpError, issueSession, requireAdmin, cookieOptions };