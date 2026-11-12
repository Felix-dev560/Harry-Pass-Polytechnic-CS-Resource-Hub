'use strict';
// Sends Web Push notifications. A failure here must never break the request that caused it
// (an upload or a save), so every error is logged and swallowed.
const webpush = require('web-push');
const db = require('./database');
const config = require('./config');

const { publicKey, privateKey, subject } = config.vapid;
const enabled = Boolean(publicKey && privateKey);

if (enabled) {
  webpush.setVapidDetails(subject, publicKey, privateKey);
} else {
  console.warn('Push notifications are off: set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (see .env.example).');
}

/** Sends one payload to every device saved for a role ('admin' or 'student'). Dead subscriptions are removed. */
async function notifyRole(role, payload) {
  if (!enabled) return { sent: 0 };
  try {
    // Photo alerts ('admin') go only to admin devices. New-material alerts ('student') go to every saved device,
    // because a device that was switched to admin (by opening the dashboard) must not lose them.
    let query = db.from('push_subscriptions').select('id, endpoint, p256dh, auth').limit(5000);
    if (role !== 'student') query = query.eq('role', role);
    const { data: subs, error } = await query;
    if (error) throw error;
    if (!subs?.length) return { sent: 0 };

    const body = JSON.stringify(payload);
    const dead = [];
    let sent = 0;
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
          { TTL: 60 * 60 * 24, urgency: 'high' },
        );
        sent++;
      } catch (err) {
        // 404 and 410 mean the device unsubscribed or the browser data was cleared.
        if (err.statusCode === 404 || err.statusCode === 410) dead.push(s.id);
        else console.error('Push send failed:', err.statusCode ?? '', err.body ?? err.message);
      }
    }));
    if (dead.length) await db.from('push_subscriptions').delete().in('id', dead);
    return { sent };
  } catch (err) {
    console.error('Push notification failed:', err);
    return { sent: 0 };
  }
}

module.exports = { enabled, publicKey, notifyRole };