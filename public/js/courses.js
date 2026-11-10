import { api, h, isHttpUrl, currentYear, FIRST_YEAR, LEVELS } from './api.js';
import { icon, toast, tokens, matches, highlight, bindSearch, downloadUrl, viewUrl } from './ui.js';

const params = new URLSearchParams(location.search);
const level = params.get('level');
const semester = params.get('semester');
const focusId = params.get('focus');
const $ = (id) => document.getElementById(id);
const listEl = $('course-list');
let items = [];

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('success', 'Copied', 'The notes are on your clipboard.');
  } catch {
    toast('error', 'Could not copy', 'Select the text and copy it by hand.');
  }
}

/** One "Past question" or "Handout" box inside a year. */
function resource(kind, course, year, value, note) {
  const label = kind === 'question' ? 'Past question' : 'Handout';
  const head = h('div', { class: 'res-title' }, icon(kind === 'question' ? 'file-text' : 'book-open'), label);

  if (!value) {
    return h('div', { class: 'res' }, head, h('p', { class: 'res-empty' }, icon('info'), note || 'Not available yet.'));
  }
  if (isHttpUrl(value)) {
    const dl = downloadUrl(value);
    return h('div', { class: 'res' }, head, h('div', { class: 'res-actions' },
      h('a', { class: 'pill-btn sm primary', href: viewUrl(value), target: '_blank', rel: 'noopener noreferrer' }, icon('external-link'), 'Open'),
      dl && h('a', {
        class: 'pill-btn sm', href: dl, download: '', rel: 'noopener noreferrer',
        onclick: () => toast('success', 'Download started', `${course.course_code} ${year} ${label.toLowerCase()} will be in your downloads folder.`),
      }, icon('download'), 'Download')));
  }
  // Plain-text notes (converted from student photos) open in place.
  return h('div', { class: 'res' }, head, h('details', { class: 'notes-box' },
    h('summary', {}, icon('file-text'), 'Read notes'),
    h('pre', {}, value),
    h('button', { class: 'pill-btn sm', type: 'button', onclick: () => copyText(value) }, icon('copy'), 'Copy text')));
}

function renderYears(course, materials) {
  const byYear = new Map(materials.map((m) => [m.year, m]));
  const years = [];
  for (let y = currentYear(); y >= FIRST_YEAR; y--) years.push(y);
  return h('ul', { class: 'years' }, years.map((y) => {
    const m = byYear.get(y);
    return h('li', { class: 'year-card' },
      h('h3', {}, icon('calendar'), y),
      resource('question', course, y, m?.question_url, m?.status_note),
      resource('handout', course, y, m?.handout_url, m?.status_note));
  }));
}

function courseItem(course) {
  const codeEl = h('span', { class: 'code' }, course.course_code);
  const titleEl = h('span', { class: 'course-title' }, course.course_title);
  const body = h('div', { class: 'course-body' }, h('p', { class: 'res-empty' }, 'Loading years...'));
  const details = h('details', { class: 'course-card glass', id: `course-${course.id}` },
    h('summary', {}, codeEl, titleEl, icon('chevron-right', 'chev')), body);

  let loaded = false;
  details.addEventListener('toggle', async () => {
    if (!details.open || loaded) return;
    loaded = true; // set early so a quick double toggle does not fetch twice
    try {
      const { materials } = await api(`/api/courses/${course.id}/materials`);
      body.replaceChildren(renderYears(course, materials));
    } catch (err) {
      loaded = false; // allow retry on next open
      body.replaceChildren(h('p', { class: 'res-empty' }, icon('alert-triangle'), err.message));
      toast('error', 'Could not load this course', err.message);
    }
  });

  return {
    course,
    details,
    setQuery(toks) {
      codeEl.replaceChildren(...highlight(course.course_code, toks));
      titleEl.replaceChildren(...highlight(course.course_title, toks));
    },
  };
}

function applyFilter(value) {
  const toks = tokens(value);
  let shown = 0;
  let last = null;
  for (const item of items) {
    const ok = matches(item.course, toks);
    item.details.hidden = !ok;
    item.setQuery(ok ? toks : []);
    if (ok) { shown++; last = item; }
  }
  $('filter-count').textContent = toks.length ? `${shown} of ${items.length}` : `${items.length} ${items.length === 1 ? 'course' : 'courses'}`;
  $('no-match').hidden = shown > 0;
  if (toks.length && shown === 1) last.details.open = true; // one match: open it straight away
}

async function init() {
  if (!Object.hasOwn(LEVELS, level) || !['First', 'Second'].includes(semester)) {
    location.replace('index.html');
    return;
  }
  const title = `${LEVELS[level]}, ${semester} semester`;
  $('page-title').textContent = title;
  document.title = `${title} | Harry Pass CS Hub`;
  $('back').href = `semester.html?level=${level}`;

  try {
    const { courses } = await api(`/api/courses?level=${level}&semester=${semester}`);
    if (courses.length === 0) {
      listEl.replaceChildren($('empty-semester'));
      $('empty-semester').hidden = false;
      return;
    }
    items = courses.map(courseItem);
    listEl.replaceChildren(...items.map((i) => i.details));
    $('filter-bar').hidden = false;
    bindSearch($('filter'), $('filter-clear'), applyFilter);
    applyFilter('');
    const target = focusId && document.getElementById(`course-${Number(focusId)}`);
    if (target) { target.open = true; target.scrollIntoView({ block: 'start' }); }
  } catch (err) {
    listEl.replaceChildren(h('div', { class: 'empty-state glass' },
      h('span', { class: 'tile-ico' }, icon('alert-triangle')), h('p', {}, err.message)));
    toast('error', 'Could not load courses', err.message);
  }
}
init();