// Notification permission bar + subscription. Loaded on every page (student pages and the admin dashboard).
// On every visit it checks whether this device is already set up. If it is not, a small bar with a toggle
// appears. Switching it on asks the browser for permission and saves the device, so notifications keep
// arriving for as long as this site's data stays in the browser. Once enabled, the bar no longer shows.
import { api, h } from './api.js';
import { icon, toast } from './ui.js';

const ROLE = location.pathname.startsWith('/admin/') ? 'admin' : 'student';
const SUBSCRIBE_PATH = ROLE === 'admin' ? '/api/push/subscribe-admin' : '/api/push/subscribe';
const DISMISS_KEY = 'hp-push-dismissed'; // sessionStorage: the bar is hidden for this visit only, and returns next visit
// One key per role. Student pages and the admin dashboard share one browser tab session, so a single shared key
// made the dashboard think the device was already saved as the admin's after a student page had saved it.
const SYNC_KEY = `hp-push-synced:${ROLE}`;
const COPY = {
  student: 'Get a notification when a new handout or past question is uploaded.',
  admin: 'Get a notification when students send new photos.',
};
const UNSUPPORTED = 'Notifications do not work in this browser. Open this site in Chrome to turn them on.';

const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const store = {
  get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

function keyToBytes(base64) {
  const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** True when a saved browser subscription was made with the same server key as the one the server uses now. */
function sameKey(sub, bytes) {
  const current = sub.options?.applicationServerKey;
  if (!current) return true; // the browser does not say: assume it matches
  const saved = new Uint8Array(current);
  return saved.length === bytes.length && saved.every((value, i) => value === bytes[i]);
}

/** Rejects if a promise takes too long, so a stuck push service can never leave the toggle hanging. */
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('This is taking too long. Check your connection and try again.')), ms)),
  ]);
}

let registering;
/** Registers the service worker once. A failed attempt is forgotten, so a later tap can try again. */
function worker() {
  registering ??= navigator.serviceWorker.register('/sw.js', { scope: '/' })
    .then(() => navigator.serviceWorker.ready)
    .catch((err) => { registering = undefined; throw err; });
  return registering;
}

/** Creates (or reuses) this device's subscription and saves it on the server. Needs permission to be granted. */
async function subscribe() {
  const reg = await withTimeout(worker(), 10000);
  const { publicKey } = await api('/api/push/key');
  const key = keyToBytes(publicKey);
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with an older server key can never receive anything. Replace it.
  if (sub && !sameKey(sub, key)) {
    await sub.unsubscribe().catch(() => {});
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await api(SUBSCRIBE_PATH, { method: 'POST', body: { subscription: sub.toJSON() } });
  store.set(SYNC_KEY, '1');
  return sub;
}

// ---------- The bar ----------
function showBar({ blocked, unsupported }) {
  if (store.get(DISMISS_KEY) || document.querySelector('.notify-bar')) return;

  const input = h('input', { type: 'checkbox', role: 'switch', 'aria-label': 'Turn on notifications from this site' });
  const bar = h('div', { class: 'notify-bar', role: 'region', 'aria-label': 'Notifications' },
    h('span', { class: 'notify-ico' }, icon('bell')),
    h('div', { class: 'notify-text' },
      h('small', {}, unsupported ? UNSUPPORTED : blocked ? 'Allow notifications from this site in your browser settings.' : COPY[ROLE])),
    !blocked && !unsupported && h('label', { class: 'switch' }, input, h('span', { class: 'switch-track', 'aria-hidden': 'true' })),
    h('button', { class: 'notify-close', type: 'button', 'aria-label': 'Hide for now', onclick: () => { store.set(DISMISS_KEY, '1'); bar.remove(); } }, icon('x')));
  document.body.append(bar);

  input.addEventListener('change', async () => {
    if (!input.checked) return;
    input.disabled = true;
    try {
      const result = await Notification.requestPermission(); // must run straight from the tap
      if (result !== 'granted') {
        input.checked = false;
        input.disabled = false;
        if (result === 'denied') { bar.remove(); showBar({ blocked: true }); }
        return;
      }
      // Permission is granted, so the toggle has done its job: the bar goes away right now.
      bar.remove();
      await withTimeout(subscribe(), 20000);
      toast('success', 'Notifications are on', ROLE === 'admin' ? 'You will be notified when students send photos.' : 'You will be notified when new materials are uploaded.');
    } catch (err) {
      // Saving this device failed. Tell the person and bring the bar back so they can try again.
      toast('error', 'Could not turn on notifications', err.message);
      showBar({ blocked: false });
    }
  });
}

// ---------- Every visit ----------
// The bar is decided from the browser's permission alone, so it never waits for (or depends on) the service
// worker or the network. The service worker is registered in the background.
async function check() {
  // Some browsers (Opera Mini, many in-app browsers) cannot receive web notifications at all.
  // Say so, instead of showing nothing.
  if (!supported) return showBar({ unsupported: true });

  const permission = Notification.permission;
  if (permission === 'denied') return showBar({ blocked: true });
  if (permission === 'default') {
    showBar({ blocked: false });
    worker().catch(() => {}); // warm up so the toggle responds quickly
    return;
  }

  // Already allowed: make sure this device is saved on the server for THIS role (student or admin).
  if (store.get(SYNC_KEY)) {
    worker().catch(() => {}); // registered on every visit so the browser can always deliver pushes
    return;
  }
  try {
    await withTimeout(subscribe(), 20000);
  } catch (err) {
    if (err.status === 401) return; // admin session ended: the dashboard is already sending them to sign in
    showBar({ blocked: false }); // could not save this device: offer the toggle again instead of failing silently
  }
}

// Runs once the page is idle, so it never competes with the first paint.
const later = typeof requestIdleCallback === 'function' ? (fn) => requestIdleCallback(fn, { timeout: 2000 }) : (fn) => setTimeout(fn, 500);
const start = () => later(() => { check().catch(() => {}); });
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();