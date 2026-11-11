// Forgot password page. Appearance is in css/auth.css. The server checks the setup key; this file only
// checks the obvious mistakes so the admin gets an answer without waiting for a request.
import { api, setStatus } from '../js/api.js';

const $ = (id) => document.getElementById(id);
const form = $('reset-form');
const status = $('reset-status');

for (const btn of document.querySelectorAll('.toggle-password')) {
  btn.addEventListener('click', () => {
    const input = btn.closest('.control').querySelector('input');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.setAttribute('aria-pressed', String(show));
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });
}

function setBusy(busy) {
  const button = form.querySelector('button[type="submit"]');
  button.disabled = busy;
  button.classList.toggle('is-loading', busy);
  form.setAttribute('aria-busy', String(busy));
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  const email = String(data.email ?? '').trim();
  const setup_key = String(data.setup_key ?? '').trim();
  const { password, confirm_password } = data;

  if (!email || !setup_key || !password) return setStatus(status, 'Fill in every field.', 'error');
  if (password.length < 8) return setStatus(status, 'Password must be at least 8 characters.', 'error');
  if (password !== confirm_password) return setStatus(status, 'Passwords do not match.', 'error');

  setBusy(true);
  setStatus(status, 'Resetting...');
  try {
    await api('/api/auth/reset', { method: 'POST', body: { email, setup_key, password, confirm_password } });
    location.replace('dashboard.html'); // the reset also signs you in
  } catch (err) {
    setStatus(status, err.message, 'error');
    setBusy(false);
  }
});