// The download counter in the top bar of every student page.
// Shows the total from the server (the copy saved from the last visit appears at once), and countDownload()
// adds 1 when a student presses a Download button. The pill stays hidden until a real number is known.
import { apiCached } from './api.js';

const PATH = '/api/stats/downloads';
const full = new Intl.NumberFormat('en-US');
const short = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const pill = document.getElementById('dl-pill');
const fullEl = document.getElementById('dl-full');
const shortEl = document.getElementById('dl-short');
let total = null;
const recent = new Map(); // file link -> time of its last counted tap, so a double tap counts once

function show(n) {
  if (!pill || !Number.isFinite(n)) return;
  total = Math.max(n, total ?? 0); // the total only ever grows, so an older copy never lowers it
  fullEl.textContent = full.format(total);
  shortEl.textContent = short.format(total); // phones show this one (12.4K) once the number gets long, see student.css
  pill.classList.toggle('is-big', total >= 100000);
  pill.setAttribute('aria-label', `${full.format(total)} downloads so far`);
  pill.title = `${full.format(total)} downloads so far`;
  pill.hidden = false;
}

function remember(n) {
  try { localStorage.setItem(`hp-cache:${PATH}`, JSON.stringify({ total: n })); } catch { /* storage blocked */ }
}

/** Call when a student presses Download. Adds 1 on screen at once, then takes the server's total. */
export function countDownload(key = '') {
  const now = Date.now();
  if (key && now - (recent.get(key) ?? 0) < 3000) return;
  recent.set(key, now);
  if (total !== null) show(total + 1);
  fetch(PATH, { method: 'POST', keepalive: true, credentials: 'same-origin' })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => { if (data && Number.isFinite(data.total)) { show(data.total); remember(total); } })
    .catch(() => { /* offline: the count is not saved, and the student still gets the file */ });
}

if (pill) {
  // On a phone a long number is shortened (12.4K). Tapping the pill shows the whole number.
  pill.addEventListener('click', () => pill.classList.toggle('is-open'));
  apiCached(PATH, (data) => show(Number(data?.total))).catch(() => { /* stay hidden if the server is unreachable */ });
}