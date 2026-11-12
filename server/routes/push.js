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

// ===== TEMPORARY DIAGNOSTIC (remove after the notification problem is found) =====
// Open while signed in as admin:
//   /api/push/diagnose          -> checks keys and counts saved devices (sends nothing)
//   /api/push/diagnose?send=1   -> also sends one test notification to every saved device and shows each result
const crypto = require('node:crypto');
const webpush = require('web-push');
const config = require('../config');

router.get('/diagnose', requireAdmin, asyncHandler(async (req, res) => {
  const { publicKey, privateKey, subject } = config.vapid;
  const report = {
    push_enabled: push.enabled,
    public_key_present: Boolean(publicKey),
    private_key_present: Boolean(privateKey),
    subject_value: subject,
    subject_valid: /^(mailto:.+@.+|https:\/\/.+)/i.test(subject),
  };

  // Do the public and private key belong to the same pair?
  try {
    const fromB64Url = (v) => Buffer.from(v.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.setPrivateKey(fromB64Url(privateKey));
    report.keys_match = ecdh.getPublicKey().equals(fromB64Url(publicKey));
  } catch (err) {
    report.keys_match = false;
    report.keys_error = err.message;
  }

  const { data: subs, error } = await db.from('push_subscriptions').select('id, role, endpoint, p256dh, auth, created_at').limit(5000);
  if (error) { report.database_error = error.message; return res.json(report); }
  report.saved_devices = { admin: subs.filter((s) => s.role === 'admin').length, student: subs.filter((s) => s.role === 'student').length };

  if (req.query.send === '1' && push.enabled) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    const outcomes = {};
    const details = [];
    await Promise.all(subs.map(async (s) => {
      let result;
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title: 'Test notification', body: 'If you see this, push works for this device.', url: '/', tag: 'diagnose' }),
          { TTL: 300, urgency: 'high' },
        );
        result = 'OK 201';
      } catch (err) {
        result = `FAILED ${err.statusCode ?? ''} ${String(err.body ?? err.message).slice(0, 120)}`.trim();
      }
      outcomes[result] = (outcomes[result] || 0) + 1;
      details.push({ id: s.id, role: s.role, service: new URL(s.endpoint).host, saved: s.created_at, result });
    }));
    report.send_summary = outcomes;
    report.send_details = details.sort((a, b) => b.id - a.id).slice(0, 30);
  } else {
    report.hint = 'Add ?send=1 to the address to send a real test notification to every saved device.';
  }
  res.type('application/json').send(JSON.stringify(report, null, 2));
}));
// ===== END TEMPORARY DIAGNOSTIC =====

module.exports = router;