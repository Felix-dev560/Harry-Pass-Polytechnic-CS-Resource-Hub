// Behaviour for the admin sign in / register page. Appearance (the slide, the eye icons, the spinner)
// is all in css/auth.css; this file only changes attributes and classes that the CSS reacts to.
import { api, setStatus } from '../js/api.js';

const $ = (id) => document.getElementById(id);
const card = $('auth-card');
const tablist = $('auth-tabs');
const tabs = { login: $('tab-login'), register: $('tab-register') };
const panels = { login: $('login-panel'), register: $('register-panel') };
const loginForm = $('login-form');
const registerForm = $('register-form');
const TITLES = { login: 'Admin Sign In', register: 'Create Admin Account' };

// Registration stays closed (and its tab hidden in the HTML) until the server says no admin exists yet.
let registrationOpen = false;

/** Slides to a panel. The CSS reacts to data-mode; inert keeps the hidden form out of tab order and screen readers. */
function setMode(mode, { focus = true } = {}) {
  if (mode === 'register' && !registrationOpen) mode = 'login';
  card.dataset.mode = mode;
  for (const [name, tab] of Object.entries(tabs)) {
    const active = name === mode;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    panels[name].inert = !active;
  }
  document.title = `${TITLES[mode]} | Harry Pass CS Hub`;
  history.replaceState(null, '', `#${mode}`);
  if (focus) panels[mode].querySelector('input')?.focus({ preventScroll: true });
}

for (const tab of Object.values(tabs)) tab.addEventListener('click', () => setMode(tab.dataset.mode));
for (const link of document.querySelectorAll('[data-switch]')) {
  link.addEventListener('click', () => setMode(link.dataset.switch));
}
// Arrow keys move between tabs, as screen reader users expect from a tab list.
tablist.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  const next = event.key === 'ArrowRight' ? 'register' : 'login';
  if (next === 'register' && !registrationOpen) return;
  setMode(next, { focus: false });
  tabs[next].focus();
});

// ---- Password visibility ----
for (const btn of document.querySelectorAll('.toggle-password')) {
  btn.addEventListener('click', () => {
    const input = btn.closest('.control').querySelector('input');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.setAttribute('aria-pressed', String(show));
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });
}

function setBusy(form, busy) {
  const button = form.querySelector('button[type="submit"]');
  button.disabled = busy;
  button.classList.toggle('is-loading', busy);
  form.setAttribute('aria-busy', String(busy));
}

// ---- Sign in ----
loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const status = $('login-status');
  const data = new FormData(loginForm);
  const email = String(data.get('email') ?? '').trim();
  const password = String(data.get('password') ?? '');
  if (!email || !password) return setStatus(status, 'Enter your email and your password.', 'error');

  setBusy(loginForm, true);
  setStatus(status, 'Signing in...');
  try {
    await api('/api/auth/login', { method: 'POST', body: { email, password, remember: data.get('remember') === '1' } });
    location.replace('dashboard.html');
  } catch (err) {
    setStatus(status, err.message, 'error');
    setBusy(loginForm, false);
  }
});

// ---- Register ----
registerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const status = $('register-status');
  const data = new FormData(registerForm);
  const body = Object.fromEntries(data);
  delete body.confirm_password;

  if (!body.first_name.trim() || !body.last_name.trim() || !body.email.trim() || !body.password) {
    return setStatus(status, 'Fill in every field.', 'error');
  }
  if (body.password.length < 4) return setStatus(status, 'Password must be at least 4 characters.', 'error');
  if (body.password !== data.get('confirm_password')) return setStatus(status, 'Passwords do not match.', 'error');

  setBusy(registerForm, true);
  setStatus(status, 'Creating account...');
  try {
    await api('/api/auth/register', { method: 'POST', body });
    location.replace('dashboard.html');
  } catch (err) {
    setStatus(status, err.message, 'error');
    setBusy(registerForm, false);
  }
});

// ---- Start-up ----
// The tabs and the register form are hidden in the HTML, so a returning admin never sees them flash.
// They are only revealed when the server confirms that no admin exists yet.
setMode('login', { focus: false });

try {
  ({ registrationOpen } = await api('/api/auth/status'));
} catch {
  registrationOpen = false; // status unknown: show sign in only; the server still refuses a second admin
}
if (registrationOpen) {
  tablist.hidden = false;
  panels.register.hidden = false;
  if (location.hash === '#register') setMode('register', { focus: false });
} else {
  for (const el of document.querySelectorAll('[data-register-only]')) el.hidden = true;
}