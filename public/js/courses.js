import { api, apiCached, h, isHttpUrl, currentYear, FIRST_YEAR, LEVELS } from './api.js';
import { icon, toast, tokens, matches, highlight, bindSearch, downloadUrl, viewUrl } from './ui.js';
import { countDownload } from './download-count.js';

const params = new URLSearchParams(location.search);
const SEMESTERS = ['First', 'Second'];
const level = params.get('level');
let semester = SEMESTERS.includes(params.get('semester')) ? params.get('semester') : 'First'; // the toggle on the page switches it
const focusId = params.get('focus');
const focusYear = Number(params.get('year')) || null; // set by a notification link, to land on one year of the course
const focusKind = params.get('kind'); // 'question', 'handout' or 'both': which box the notification was about
const $ = (id) => document.getElementById(id);
const listEl = $('course-list');
const emptyEl = $('empty-semester'); // kept in variables: they leave the page while a list is shown
const noMatchEl = $('no-match');
const toggleButtons = [...document.querySelectorAll('[data-semester]')];
const bySemester = { First: [], Second: [] };
let items = []; // the courses of the semester on screen
let loaded = false;

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
    return h('div', { class: 'res', 'data-kind': kind }, head, h('p', { class: 'res-empty' }, icon('info'), note || 'Not available yet.'));
  }
  if (isHttpUrl(value)) {
    const dl = downloadUrl(value);
    return h('div', { class: 'res', 'data-kind': kind }, head, h('div', { class: 'res-actions' },
      h('a', { class: 'pill-btn sm primary', href: viewUrl(value), target: '_blank', rel: 'noopener noreferrer' }, icon('external-link'), 'Open'),
      dl && h('a', {
        class: 'pill-btn sm', href: dl, download: '', rel: 'noopener noreferrer',
        onclick: () => {
          countDownload(dl);
          toast('success', 'Download started', `${course.course_code} ${year} ${label.toLowerCase()} will be in your downloads folder.`);
        },
      }, icon('download'), 'Download')));
  }
  // Older posts that were saved as plain text (before files were used) still open in place.
  return h('div', { class: 'res', 'data-kind': kind }, head, h('details', { class: 'notes-box' },
    h('summary', {}, icon('file-text'), 'Read notes'),
    h('pre', {}, value),
    h('button', { class: 'pill-btn sm', type: 'button', onclick: () => copyText(value) }, icon('copy'), 'Copy text')));
}

function renderYears(course, materials) {
  const byYear = new Map(materials.map((m) => [m.year, m]));
  const years = [];
  const newest = Math.max(currentYear(), ...materials.map((m) => m.year)); // a post dated next year still shows
  for (let y = newest; y >= FIRST_YEAR; y--) years.push(y);
  const hasFile = (y) => Boolean(byYear.get(y)?.question_url || byYear.get(y)?.handout_url);
  const filled = years.filter(hasFile);
  const empty = years.filter((y) => !hasFile(y));
  if (!filled.length) return h('p', { class: 'res-empty' }, icon('info'), 'Nothing has been posted for this course yet.');

  // Years with files: each one collapses, and the newest is open.
  const items = filled.map((y, i) => {
    const m = byYear.get(y);
    const what = [m.question_url && 'Past question', m.handout_url && 'Handout'].filter(Boolean).join(' · ');
    return h('li', { class: 'year-item', id: `year-${course.id}-${y}` },
      h('details', { class: 'year-block', open: i === 0 },
        h('summary', {}, icon('calendar'), h('strong', {}, y), h('span', { class: 'year-tags' }, what), icon('chevron-right', 'chev')),
        h('div', { class: 'year-body' },
          resource('question', course, y, m.question_url, m.status_note),
          resource('handout', course, y, m.handout_url, m.status_note))));
  });
  // Years with nothing: one closed group at the bottom instead of a pair of empty boxes per year.
  if (empty.length) {
    items.push(h('li', { class: 'year-item' },
      h('details', { class: 'year-block year-empty' },
        h('summary', {}, icon('inbox'), h('span', {}, `${empty.length} ${empty.length === 1 ? 'year' : 'years'} with nothing yet`), icon('chevron-right', 'chev')),
        h('ul', { class: 'empty-list' }, empty.map((y) => h('li', {}, h('strong', {}, y), h('span', {}, byYear.get(y)?.status_note || 'Not available yet')))))));
  }
  return h('ul', { class: 'years' }, items);
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
      // Arrived from a notification: scroll to the year that was posted and mark it.
      if (focusYear && String(course.id) === String(Number(focusId))) {
        const card = document.getElementById(`year-${course.id}-${focusYear}`);
        if (card) {
          card.querySelector('details')?.setAttribute('open', '');
          // One kind posted: point at that box. Both posted (or an older link with no kind): point at the whole year.
          const box = focusKind === 'question' || focusKind === 'handout' ? card.querySelector(`.res[data-kind="${focusKind}"]`) : null;
          (box || card).classList.add(box ? 'is-target-res' : 'is-target');
          (box || card).scrollIntoView({ block: 'center' });
        }
      }
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
  noMatchEl.hidden = shown > 0 || items.length === 0;
  if (toks.length && shown === 1) last.details.open = true; // one match: open it straight away
}

/** Marks the chosen semester on the toggle. */
function syncToggle() {
  for (const btn of toggleButtons) btn.setAttribute('aria-pressed', String(btn.dataset.semester === semester));
}

/** Shows the courses of the chosen semester. No new request: both semesters were loaded together. */
function showSemester({ updateUrl = true } = {}) {
  syncToggle();
  document.title = `${LEVELS[level]}, ${semester} semester | Harry Pass CS Hub`;
  // Keeps the address in step with the toggle, so Refresh and Share open the same semester.
  if (updateUrl) history.replaceState(null, '', `courses.html?level=${level}&semester=${semester}`);
  items = bySemester[semester];
  if (items.length) listEl.replaceChildren(...items.map((i) => i.details));
  else listEl.replaceChildren(emptyEl);
  emptyEl.hidden = items.length > 0;
  applyFilter($('filter').value);
}

for (const btn of toggleButtons) {
  btn.addEventListener('click', () => {
    if (btn.dataset.semester === semester) return;
    semester = btn.dataset.semester;
    if (loaded) showSemester(); else syncToggle();
  });
}

/** Builds the course list from the data. Runs once from the saved copy (if any) and again only if the server's copy differs. */
let wired = false;
function build(courses) {
  bySemester.First = [];
  bySemester.Second = [];
  for (const course of courses) bySemester[course.semester]?.push(courseItem(course));
  // A link to one course (search result, notification) opens the semester that course is in.
  const wanted = courses.find((c) => String(c.id) === String(Number(focusId)));
  if (wanted && !loaded) semester = wanted.semester;
  const firstBuild = !loaded;
  loaded = true;
  $('filter-bar').hidden = false;
  if (!wired) { bindSearch($('filter'), $('filter-clear'), applyFilter); wired = true; }
  showSemester({ updateUrl: false });
  const target = firstBuild && focusId && document.getElementById(`course-${Number(focusId)}`);
  if (target) { target.open = true; target.scrollIntoView({ block: 'start' }); }
}

async function init() {
  if (!Object.hasOwn(LEVELS, level)) {
    location.replace('index.html');
    return;
  }
  $('page-title').textContent = LEVELS[level];
  document.title = `${LEVELS[level]} | Harry Pass CS Hub`;
  syncToggle();

  try {
    // The list from the last visit shows instantly; the server's copy replaces it only if something changed.
    await apiCached(`/api/courses?level=${level}`, ({ courses }) => build(courses));
  } catch (err) {
    listEl.replaceChildren(h('div', { class: 'empty-state glass' },
      h('span', { class: 'tile-ico' }, icon('alert-triangle')), h('p', {}, err.message)));
    toast('error', 'Could not load courses', err.message);
  }
}
init();