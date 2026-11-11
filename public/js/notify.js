// Notification permission bar + subscription. Loaded on every page.
// On every visit it checks whether this device is already set up. If it is not, a small bar with a toggle
// appears. Switching it on asks the browser for permission and saves the device, so notifications keep
// arriving for as long as this site's data stays in the browser. Once enabled, the bar no longer shows.
import { api, h } from './api.js';
import { icon, toast } from './ui.js';

const ROLE = location.pathname.startsWith('/admin/') ? 'admin' : 'student';
const SUBSCRIBE_PATH = ROLE === 'admin' ? '/api/push/subscribe-admin' : '/api/push/subscribe';
const DISMISS_KEY = 'hp-push-dismissed'; // sessionStorage: the bar is hidden for this visit only, and returns next visit
const SYNC_KEY = 'hp-push-synced';
const COPY = {
  student: 'Get an alert when a new handout or past question is posted, with the course and a link straight to it.',
  admin: 'Get an alert on this device when students send new photos.',
};

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

let registration;
async function worker() {
  registration ??= await navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(() => navigator.serviceWorker.ready);
  return registration;
}

/** Creates (or reuses) this device's subscription and saves it on the server. Needs permission to be granted. */
async function subscribe() {
  const reg = await worker();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { publicKey } = await api('/api/push/key');
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) });
  }
  await api(SUBSCRIBE_PATH, { method: 'POST', body: { subscription: sub.toJSON() } });
  store.set(SYNC_KEY, '1');
  return sub;
}

// ---------- The bar ----------
function showBar({ blocked }) {
  if (store.get(DISMISS_KEY) || document.querySelector('.notify-bar')) return;

  const input = h('input', { type: 'checkbox', role: 'switch', 'aria-label': 'Turn on notifications from this site' });
  const bar = h('div', { class: 'notify-bar', role: 'region', 'aria-label': 'Notifications' },
    h('span', { class: 'notify-ico' }, icon('bell')),
    h('div', { class: 'notify-text' },
      h('strong', {}, blocked ? 'Notifications are blocked' : 'Turn on notifications'),
      h('small', {}, blocked ? 'Allow notifications for this site in your browser settings, then reload this page.' : COPY[ROLE])),
    !blocked && h('label', { class: 'switch' }, input, h('span', { class: 'switch-track', 'aria-hidden': 'true' })),
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
      await subscribe();
      bar.remove();
      toast('success', 'Notifications are on', ROLE === 'admin' ? 'You will be alerted when students send photos.' : 'You will be alerted when new materials are posted.');
    } catch (err) {
      input.checked = false;
      input.disabled = false;
      toast('error', 'Could not turn on notifications', err.message);
    }
  });
}

// ---------- Every visit ----------
async function check() {
  if (!supported) return;
  try {
    await worker(); // registered on every visit so the browser can always deliver pushes
  } catch { return; }

  if (Notification.permission === 'granted') {
    // Already allowed: quietly make sure the server still has this device. No bar.
    if (!store.get(SYNC_KEY)) await subscribe().catch(() => {});
    return;
  }
  showBar({ blocked: Notification.permission === 'denied' });
}

check();