import { api, LEVELS } from './api.js';
import { toast, tokens, matches, bindSearch, bindListNav, courseLink } from './ui.js';

const params = new URLSearchParams(location.search);
const level = params.get('level');

if (!Object.hasOwn(LEVELS, level)) {
  location.replace('index.html'); // missing or invalid level
} else {
  init();
}

async function init() {
  const $ = (id) => document.getElementById(id);
  $('level-name').textContent = LEVELS[level];
  document.title = `${LEVELS[level]} semesters | Harry Pass CS Hub`;
  for (const link of document.querySelectorAll('[data-semester]')) {
    link.href = `courses.html?level=${level}&semester=${link.dataset.semester}`;
  }

  const input = $('filter');
  const list = $('sem-results');
  const status = $('sem-status');
  const tiles = $('sem-tiles');
  let courses = null;

  function render() {
    const toks = tokens(input.value);
    tiles.hidden = toks.length > 0; // while searching, results replace the semester cards
    if (!toks.length) {
      list.replaceChildren();
      status.textContent = '';
      return;
    }
    if (!courses) {
      status.textContent = 'Loading courses...';
      return;
    }
    const found = courses.filter((c) => matches(c, toks));
    list.replaceChildren(...found.map((c) => courseLink(c, toks)));
    status.textContent = found.length
      ? `${found.length} of ${courses.length} ${LEVELS[level]} courses`
      : `No ${LEVELS[level]} course matches "${input.value.trim()}".`;
  }

  bindSearch(input, $('filter-clear'), render);
  bindListNav(input, list);

  try {
    ({ courses } = await api(`/api/courses?level=${level}`));
    render();
  } catch (err) {
    status.textContent = '';
    toast('error', 'Could not load courses', err.message);
  }
}