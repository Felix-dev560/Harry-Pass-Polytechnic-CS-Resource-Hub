import { api } from './api.js';
import { toast, tokens, matches, bindSearch, bindListNav, courseLink } from './ui.js';

const input = document.getElementById('search');
const clearBtn = document.getElementById('search-clear');
const list = document.getElementById('results');
const status = document.getElementById('search-status');
const MAX_SHOWN = 8;

let all = null;
let loading = null;

/** Loads every course once, so results can update instantly on each keystroke with no server round trip. */
function load() {
  loading ??= api('/api/courses')
    .then((data) => (all = data.courses))
    .catch((err) => {
      loading = null;
      toast('error', 'Could not load courses', err.message);
      throw err;
    });
  return loading;
}

function render() {
  const toks = tokens(input.value);
  if (!toks.length) {
    list.replaceChildren();
    status.textContent = '';
    return;
  }
  if (!all) {
    status.textContent = 'Loading courses...';
    return;
  }
  const found = all.filter((c) => matches(c, toks));
  list.replaceChildren(...found.slice(0, MAX_SHOWN).map((c) => courseLink(c, toks)));
  if (!found.length) status.textContent = `No course matches "${input.value.trim()}".`;
  else if (found.length > MAX_SHOWN) status.textContent = `Showing ${MAX_SHOWN} of ${found.length} matches. Type more to narrow it down.`;
  else status.textContent = `${found.length} matching ${found.length === 1 ? 'course' : 'courses'}`;
}

bindSearch(input, clearBtn, () => {
  render();
  if (!all) load().then(render).catch(() => { status.textContent = ''; });
});
bindListNav(input, list);
input.addEventListener('focus', () => { load().catch(() => {}); }, { once: true });