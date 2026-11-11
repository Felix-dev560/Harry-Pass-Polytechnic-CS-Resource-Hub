// Shared student-site UI: plain outline icons, toast pop-ups, live-search helpers and the "Developer" footer.
// Icons are constant SVG strings below. User or database text never goes through innerHTML.
import { h, LEVELS } from './api.js';

/* ================= Developer details (edit the links here, once) ================= */
const DEV = {
  name: 'Saawuan Felix',
  role: 'Web developer',
  links: [
    { label: 'Portfolio', icon: 'globe', url: 'https://saawuanfelix.vercel.app' },
    { label: 'GitHub', icon: 'github', url: 'https://github.com/felix-dev560' },
    { label: 'WhatsApp', icon: 'message-circle', url: 'https://wa.me/2348140161811' },
    { label: 'Facebook', icon: 'facebook', url: 'https://www.facebook.com/Felixdev560' },
    { label: 'Upwork', icon: 'briefcase', url: 'https://www.upwork.com/freelancers/~01d68070d2fa4a8ae2' },
  ],
};

/* ================= Icons ================= */
const ICONS = {
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  'arrow-left': '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  'more-vertical': '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
  'chevron-left': '<path d="m15 18-6-6 6-6"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'arrow-right': '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  'external-link': '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  'file-text': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  'book-open': '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  'graduation-cap': '<path d="M22 10v6"/><path d="M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  'alert-triangle': '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  'alert-circle': '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
  hash: '<line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  'log-out': '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  github: '<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/>',
  facebook: '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>',
  'message-circle': '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  briefcase: '<rect width="20" height="14" x="2" y="7" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
};
const SVG_NS = 'http://www.w3.org/2000/svg';

export function icon(name, className = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `icon ${className}`.trim());
  svg.innerHTML = ICONS[name] ?? ''; // constant markup from the table above
  return svg;
}

/** Turns <i data-icon="search" class="x"></i> placeholders in the HTML into real SVG icons. */
export function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) el.replaceWith(icon(el.dataset.icon, el.className));
}

/* ================= Toasts ================= */
const TOAST_ICON = { success: 'check', error: 'alert-triangle', info: 'info' };
let host;

function toastHost() {
  if (!host) {
    host = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(host);
  }
  return host;
}

/** toast('success', 'Download started', 'Check your downloads folder.') */
export function toast(type, title, text = '', duration = 4200) {
  const box = toastHost();
  while (box.children.length >= 3) box.firstElementChild.remove();
  let timer;
  const dismiss = () => {
    clearTimeout(timer);
    node.classList.add('is-leaving');
    setTimeout(() => node.remove(), 250);
  };
  const node = h('div', { class: `toast ${type}` },
    h('span', { class: 'toast-icon' }, icon(TOAST_ICON[type] ?? 'info')),
    h('div', { class: 'toast-body' }, h('div', { class: 'toast-title' }, title), text && h('div', { class: 'toast-text' }, text)),
    h('button', { class: 'toast-close', type: 'button', 'aria-label': 'Dismiss message', onclick: dismiss }, icon('x')));
  box.append(node);
  timer = setTimeout(dismiss, duration);
  return dismiss;
}

/* ================= Search helpers ================= */
export const tokens = (q) => q.toLowerCase().split(/\s+/).filter(Boolean);

/** Every typed word must appear in the code ("COM 111" or "com111"), title or semester. */
export function matches(course, toks) {
  const hay = `${course.course_code} ${course.course_code.replace(/\s/g, '')} ${course.course_title} ${course.semester}`.toLowerCase();
  return toks.every((t) => hay.includes(t));
}

/** Wraps the typed words in <mark>. Returns an array of strings and nodes. */
export function highlight(text, toks) {
  if (!toks.length) return [text];
  const words = toks.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length);
  return text.split(new RegExp(`(${words.join('|')})`, 'gi')).map((part, i) => (i % 2 ? h('mark', {}, part) : part));
}

export function bindSearch(input, clearBtn, onChange) {
  const sync = () => { clearBtn.hidden = !input.value; onChange(input.value); };
  input.addEventListener('input', sync);
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape' && input.value) { input.value = ''; sync(); } });
  clearBtn.addEventListener('click', () => { input.value = ''; sync(); input.focus(); });
}

/** Enter opens the first result. Arrow keys move through the results and back to the box. */
export function bindListNav(input, list) {
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { list.querySelector('a')?.focus(); e.preventDefault(); }
    if (e.key === 'Enter') { const first = list.querySelector('a'); if (first) { e.preventDefault(); first.click(); } }
  });
  list.addEventListener('keydown', (e) => {
    const links = [...list.querySelectorAll('a')];
    const i = links.indexOf(document.activeElement);
    if (i < 0) return;
    if (e.key === 'ArrowDown') { links[i + 1]?.focus(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { (i === 0 ? input : links[i - 1]).focus(); e.preventDefault(); }
  });
}

/** One search result row, linking to the course on its courses page. */
export function courseLink(c, toks) {
  return h('li', {},
    h('a', { class: 'suggest-item', href: `courses.html?level=${c.level_id}&semester=${c.semester}&focus=${c.id}` },
      h('span', { class: 'code' }, highlight(c.course_code, toks)),
      h('span', { class: 'suggest-text' }, highlight(c.course_title, toks),
        h('small', {}, `${LEVELS[c.level_id]}, ${c.semester} semester`)),
      icon('chevron-right')));
}

/** Cloudinary's fl_attachment flag makes the browser download instead of opening. Other hosts return null. */
export function downloadUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== 'res.cloudinary.com') return null;
    if (u.pathname.includes('/image/upload/') || u.pathname.includes('/raw/upload/')) return url.replace('/upload/', '/upload/fl_attachment/');
  } catch { /* not a valid URL */ }
  return null;
}

/** Link that shows a PDF, Word or PowerPoint file online in a new tab instead of downloading it.
 *  Phones and many browsers download these files when the raw link is opened, so the file goes through Google's online viewer. */
export function viewUrl(url) {
  return `https://docs.google.com/viewer?url=${encodeURIComponent(url)}`;
}

/** Nice confirmation pop-up. Resolves true when the person confirms. */
export function confirmDialog({ title, text = '', confirm = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'confirm' });
    const done = (value) => { dlg.close(); dlg.remove(); resolve(value); };
    dlg.append(
      h('h3', {}, title),
      h('p', {}, text),
      h('div', { class: 'confirm-actions' },
        h('button', { type: 'button', class: 'pill-btn', onclick: () => done(false) }, 'Cancel'),
        h('button', { type: 'button', class: `pill-btn ${danger ? 'danger-fill' : 'primary'}`, onclick: () => done(true) }, confirm)));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(false); });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) done(false); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

/* ================= Footer ================= */
function renderFooter() {
  const root = document.getElementById('site-footer');
  if (!root) return;
  const links = DEV.links.map((l) => {
    if (l.url.includes('YOUR_')) console.warn(`Set your ${l.label} link in js/ui.js (DEV.links).`);
    return h('a', { class: 'pill-btn sm', href: l.url, target: '_blank', rel: 'noopener noreferrer' }, icon(l.icon), l.label);
  });
  root.replaceChildren(h('div', { class: 'wrap' },
    h('section', { class: 'about glass', 'aria-labelledby': 'about-title' },
      h('div', {},
        h('h2', { id: 'about-title' }, 'Developer: ', h('span', { class: 'dev-name' }, DEV.name)),
        h('p', {}, `${DEV.role}. I built this hub. Check my work or get in touch.`)),
      h('div', { class: 'about-links' }, links)),
    h('div', { class: 'foot-meta' },
      h('span', {}, `© ${new Date().getFullYear()} `, h('span', { class: 'dev-name' }, DEV.name)))));
}

/* ================= Header dropdown ================= */
function initMenu() {
  const btn = document.getElementById('menu-btn');
  const menu = document.getElementById('menu');
  if (!btn || !menu) return;
  const items = () => [...menu.querySelectorAll('[role="menuitem"]')];
  const close = (refocus = false) => {
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', 'Open menu');
    if (refocus) btn.focus();
  };
  const open = () => {
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    btn.setAttribute('aria-label', 'Close menu');
    items()[0]?.focus();
  };
  btn.addEventListener('click', () => (menu.hidden ? open() : close()));
  menu.addEventListener('click', (e) => close(Boolean(e.target.closest('button'))));
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) close();
  });
  document.addEventListener('keydown', (e) => {
    if (menu.hidden) return;
    if (e.key === 'Escape') return close(true);
    if (e.key === 'Tab') return close();
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const list = items();
    const i = list.indexOf(document.activeElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
    list[next].focus();
    e.preventDefault();
  });
}

/* ================= Signature font ================= */
// The handwriting font is only used for the developer's name in the footer. It is requested after the page
// has finished loading, so it can never hold up the first paint. Until it arrives the name shows in the
// script fonts already on the device (see --font-script), then swaps once the font is ready.
function loadSignatureFont() {
  if (!document.getElementById('site-footer')) return;
  const add = () => document.head.append(h('link', {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=Dancing+Script:wght@700&display=swap',
  }));
  if (document.readyState === 'complete') add();
  else window.addEventListener('load', add, { once: true });
}

hydrateIcons();
initMenu();
loadSignatureFont();
renderFooter();