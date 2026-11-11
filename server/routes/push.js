'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../database');
const push = require('../push');
const { asyncHandler, HttpError, requireAdmin } = require('../middleware');

const router = express.Router();

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Try again later.' },
});

/** Checks the shape of a browser PushSubscription and returns only the fields we store. */
function readSubscription(body) {
  const sub = body?.subscription;
  const endpoint = typeof sub?.endpoint === 'string' ? sub.endpoint : '';
  const p256dh = typeof sub?.keys?.p256dh === 'string' ? sub.keys.p256dh : '';
  const auth = typeof sub?.keys?.auth === 'string' ? sub.keys.auth : '';
  if (!/^https:\/\//i.test(endpoint) || endpoint.length > 1000 || !p256dh || p256dh.length > 200 || !auth || auth.length > 100) {
    throw new HttpError(400, 'Invalid notification subscription.');
  }
  return { endpoint, p256dh, auth };
}

// The public key is meant to be public. The browser needs it to create a subscription.
router.get('/key', (_req, res) => {
  if (!push.enabled) throw new HttpError(503, 'Notifications are not set up on this server yet.');
  res.json({ publicKey: push.publicKey });
});

// A student device. If this device was already saved as the admin's, it stays the admin's.
router.post('/subscribe', limiter, asyncHandler(async (req, res) => {
  const row = readSubscription(req.body);
  const { data: existing, error: readError } = await db.from('push_subscriptions').select('id, role').eq('endpoint', row.endpoint).maybeSingle();
  if (readError) throw readError;
  const query = db.from('push_subscriptions');
  const { error } = await (existing
    ? query.update({ p256dh: row.p256dh, auth: row.auth }).eq('id', existing.id)
    : query.insert({ ...row, role: 'student' }));
  if (error) throw error;
  res.status(existing ? 200 : 201).json({ ok: true });
}));

// The admin's device. Only a signed-in admin can create one, so students can never receive the admin alerts.
router.post('/subscribe-admin', limiter, requireAdmin, asyncHandler(async (req, res) => {
  const row = readSubscription(req.body);
  const { error } = await db.from('push_subscriptions').upsert({ ...row, role: 'admin' }, { onConflict: 'endpoint' });
  if (error) throw error;
  res.json({ ok: true });
}));

router.post('/unsubscribe', limiter, asyncHandler(async (req, res) => {
  const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint : '';
  if (!endpoint || endpoint.length > 1000) throw new HttpError(400, 'Invalid endpoint.');
  const { error } = await db.from('push_subscriptions').delete().eq('endpoint', endpoint);
  if (error) throw error;
  res.json({ ok: true });
}));

module.exports = router;