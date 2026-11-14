import { api, h, isHttpUrl, currentYear, FIRST_YEAR, LEVELS } from '../js/api.js';
import { icon, toast, confirmDialog, tokens, matches, bindSearch, viewUrl, downloadUrl as docDownloadUrl } from '../js/ui.js';
import { makeZip } from './zip.js';

const $ = (id) => document.getElementById(id);
const VIEWS = ['courses', 'posts', 'submissions', 'password'];
const SEMESTERS = ['First', 'Second'];
const DOC_EXT = /\.(pdf|docx?|pptx?)$/i;
const MAX_DOC = 10 * 1024 * 1024; // Cloudinary free plan limit per file
const courseForm = $('course-form');
let courses = [];
let libGroups = []; // posts library: [{ el, sems: [{ el, items: [{ course, el, details, body }] }] }]. Declared here because showView() below can read it on first load.

// ---------- Session and errors ----------
async function guard() {
  try {
    await api('/api/auth/me');
    return true;
  } catch (err) {
    if (err.status === 401) { location.replace('index.html#login'); return false; }
    toast('error', 'Cannot open the dashboard', err.message);
    return false;
  }
}

/** Any API call that returns 401 mid-session sends the admin back to sign in. */
function handleError(err, title = 'Something went wrong') {
  if (err.status === 401) return location.replace('index.html#login');
  toast('error', title, err.message, 6000);
}

const setBusy = (btn, busy) => { btn.disabled = busy; btn.classList.toggle('is-loading', busy); };

$('logout').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST' }); } finally { location.replace('index.html#login'); }
});

// ---------- Download total (landing view only) ----------
/** Fills the card at the top of the landing view with how many times students have pressed Download. */
async function loadDownloadTotal() {
  try {
    const { total } = await api('/api/stats/downloads');
    const text = new Intl.NumberFormat('en-US').format(Number(total) || 0);
    $('dl-total').textContent = text;
    $('dl-stat').setAttribute('aria-label', `${text} student downloads`);
  } catch { /* keep the dash if the number cannot be loaded */ }
}

// ---------- Views (one at a time, chosen from the menu) ----------
function showView(name) {
  if (name === 'upload' || name === 'materials') name = 'courses';
  if (!VIEWS.includes(name)) name = 'courses';
  for (const v of VIEWS) $(v).hidden = v !== name;
  for (const item of document.querySelectorAll('[data-view]')) item.setAttribute('aria-current', String(item.dataset.view === name));
  history.replaceState(null, '', `#${name}`);
  window.scrollTo({ top: 0 });
  $('dl-stat').hidden = name !== 'courses'; // the counter belongs to the landing view only
  if (name === 'courses') loadDownloadTotal();
  if (name === 'posts') refreshOpenCourses();
  if (name === 'submissions') loadSubmissions();
}
$('menu').addEventListener('click', (e) => {
  const item = e.target.closest('[data-view]');
  if (item) showView(item.dataset.view);
});
showView(location.hash.slice(1));
// A notification tap on an already-open dashboard only changes the #hash, so follow it.
window.addEventListener('hashchange', () => showView(location.hash.slice(1)));

// ---------- Uploading documents ----------
/** Uploads straight from the browser to Cloudinary with a server-signed request (no Vercel body limit).
 *  Documents go up as "raw" files so PDF, Word and PowerPoint keep their extension and are not blocked. */
async function uploadFile(file, signature) {
  if (!DOC_EXT.test(file.name)) throw new Error(`${file.name}: upload a PDF, Word or PowerPoint document.`);
  if (file.size > MAX_DOC) throw new Error(`${file.name} is larger than 10 MB.`);
  const sig = signature ?? await api('/api/courses/upload-signature');
  const data = new FormData();
  data.set('api_key', sig.apiKey);
  data.set('timestamp', sig.timestamp);
  data.set('folder', sig.folder);
  data.set('use_filename', 'true');
  data.set('unique_filename', 'true');
  data.set('signature', sig.signature);
  data.set('file', file);
  let res;
  try {
    res = await fetch(`https://api.cloudinary.com/v1_1/${sig.cloudName}/raw/upload`, { method: 'POST', body: data });
  } catch {
    throw new Error('Could not reach Cloudinary. Check your connection and try again.');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !isHttpUrl(json.secure_url)) throw new Error(`Cloudinary: ${json.error?.message || `upload failed (${res.status})`}`);
  return json.secure_url;
}

const saveMaterial = (courseId, year, body) => api(`/api/courses/${courseId}/materials/${year}`, { method: 'PUT', body });

// ---------- Courses and uploads: one form ----------
const normalizeCode = (raw) => {
  const m = /^([A-Za-z]{2,5})[\s-]?(\d{3})$/.exec(String(raw).trim());
  return m ? `${m[1].toUpperCase()} ${m[2]}` : null;
};
const fileKinds = [['question', 'past question'], ['handout', 'handout']];
const F = courseForm.elements;
for (let y = currentYear(); y >= FIRST_YEAR; y--) $('m-year').append(h('option', { value: y }, y));
$('m-year').prepend(h('option', { value: '' }, 'No year yet'));
$('m-year').value = String(currentYear());
let currentMaterial = { question_url: null, handout_url: null, status_note: null };
// What the form is doing: 'year' = editing one existing year, 'course' = editing only the course,
// 'add' = adding a new year from the Posts list, null = typed by hand. Only 'year' may touch an existing year.
let formMode = null;
let yearTaken = false; // true when the chosen year of the chosen course already has a post

/** The course the form points at: the one being edited, or one that already has this level, semester and code. */
function formCourse() {
  if (F.id.value) return courses.find((c) => String(c.id) === F.id.value) ?? null;
  const code = normalizeCode(F.course_code.value);
  return code ? courses.find((c) => c.level_id === Number(F.level_id.value) && c.semester === F.semester.value && c.course_code === code) ?? null : null;
}

/** Cloudinary stores "My_Notes.docx" as "My_Notes_x7k2ab.docx" (random 6-character suffix). Show the name the admin uploaded. */
function docName(url) {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
    const name = last.replace(/^(.+\.[A-Za-z0-9]{2,5})_[A-Za-z0-9]{6}$/, '$1').replace(/_[A-Za-z0-9]{6}(?=\.[A-Za-z0-9]{2,5}$)/, '');
    return name || 'Uploaded file';
  } catch { return 'Uploaded file'; }
}

/** The line next to "Choose file": the new file if one was picked, otherwise the file already uploaded. */
function renderFileName(kind) {
  const url = currentMaterial[`${kind}_url`];
  const picked = $(`m-${kind}-file`).files[0];
  const name = $(`m-${kind}-name`);
  const hint = $(`m-${kind}-hint`);
  $(`m-${kind}-clear`).hidden = !picked;
  if (picked) {
    name.textContent = picked.name;
    hint.textContent = !$('m-year').value ? 'Choose a year above, or this file will not be saved.'
      : url ? 'New file. It replaces the current one when you save.' : 'New file. It is uploaded when you save.';
  } else if (!url) {
    name.textContent = 'No file chosen';
    hint.textContent = '';
  } else if (isHttpUrl(url)) {
    name.textContent = docName(url);
    hint.textContent = 'Current file. Choose another from your device to replace it.';
  } else {
    name.textContent = 'Old text notes';
    hint.textContent = 'Choose a file to replace them.';
  }
}
for (const [kind] of fileKinds) {
  $(`m-${kind}-file`).addEventListener('change', () => renderFileName(kind));
  // The cross drops the file that is waiting to be uploaded. A file already saved on the post is not touched.
  $(`m-${kind}-clear`).addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    $(`m-${kind}-file`).value = '';
    renderFileName(kind);
  });
}

function renderCurrent() {
  for (const [kind] of fileKinds) {
    const url = currentMaterial[`${kind}_url`];
    $(`m-${kind}-current`).replaceChildren(
      !url ? h('span', { class: 'muted' }, 'Pending')
        : isHttpUrl(url) ? h('a', { class: 'pill-btn sm', href: viewUrl(url), target: '_blank', rel: 'noopener noreferrer' }, icon('external-link'), 'View current file')
          : h('span', { class: 'muted' }, 'Old text notes are saved. Upload a file to replace them.'));
    renderFileName(kind);
  }
}

let loadToken = 0;
async function loadMaterial() {
  const token = ++loadToken;
  const course = formCourse();
  const year = $('m-year').value;
  let next = { question_url: null, handout_url: null, status_note: null };
  let taken = false;
  if (course && year) {
    try {
      const { materials } = await api(`/api/courses/${course.id}/materials`);
      const row = materials.find((m) => String(m.year) === year);
      if (row) {
        taken = true;
        // Only "Edit year" loads the saved post into the form. Adding a year starts from a blank post.
        if (formMode === 'year') next = { question_url: row.question_url ?? null, handout_url: row.handout_url ?? null, status_note: row.status_note ?? null };
      }
    } catch (err) { handleError(err); }
  }
  if (token !== loadToken) return; // a newer change replaced this one
  currentMaterial = next;
  yearTaken = taken && formMode !== 'year';
  const warn = $('m-year-warn');
  warn.hidden = !yearTaken;
  warn.textContent = yearTaken ? `${course.course_code} already has a post in ${year}. Pick another year, or edit that year from the Posts list.` : '';
  $('m-question-file').value = '';
  $('m-handout-file').value = '';
  $('m-note').value = next.status_note ?? '';
  renderCurrent();
}
for (const el of [F.level_id, F.semester, F.course_code, $('m-year')]) el.addEventListener('change', loadMaterial);
// Changing which course the form points at, after "Add a post", turns it back into a hand-typed entry.
for (const el of [F.level_id, F.semester, F.course_code]) {
  el.addEventListener('change', () => {
    if (formMode !== 'add' && formMode !== null) return;
    if (formMode === 'add') { F.id.value = ''; formMode = null; showBanner(null); $('course-save').replaceChildren('Save'); $('course-cancel').hidden = true; loadMaterial(); }
  });
}

/** Shows what is being edited at the top of the form: a year of a course, the course itself, or a new year. */
function showBanner(mode, course, year) {
  const banner = $('edit-banner');
  if (!mode) { banner.hidden = true; return; }
  const title = mode === 'year' ? `Editing year ${year}` : mode === 'course' ? 'Editing course' : 'Adding a new year';
  $('edit-banner-title').textContent = title;
  $('edit-banner-sub').textContent = `${course.course_code}, ${course.course_title}. ${LEVELS[course.level_id]}, ${course.semester} semester.`;
  banner.hidden = false;
}

function resetCourseForm() {
  courseForm.reset();
  F.id.value = '';
  formMode = null;
  $('m-year').disabled = false;
  showBanner(null);
  $('m-year').value = String(currentYear());
  $('course-save').replaceChildren('Save');
  $('course-cancel').hidden = true;
  loadMaterial();
}

/** Fills the form from the posts list. mode is 'year' (edit that year's post), 'course' (edit only the course) or 'add' (new year). */
function editInForm(course, year = '', mode = year ? 'year' : 'course') {
  F.id.value = course.id;
  F.level_id.value = course.level_id;
  F.semester.value = course.semester;
  F.course_code.value = course.course_code;
  F.course_title.value = course.course_title;
  formMode = mode;
  $('m-year').value = String(year);
  $('m-year').disabled = mode === 'year'; // editing a year cannot move it onto another year
  $('course-save').replaceChildren(icon('check'), 'Save changes');
  $('course-cancel').hidden = false;
  showBanner(mode, course, year);
  showView('courses');
  loadMaterial();
}

async function removeCourse(c) {
  const ok = await confirmDialog({
    title: `Delete ${c.course_code}?`, text: 'This also removes all of its uploaded materials. This cannot be undone.',
    confirm: 'Delete course', danger: true,
  });
  if (!ok) return;
  try {
    await api(`/api/courses/${c.id}`, { method: 'DELETE' });
    toast('success', 'Course deleted', c.course_code);
    if (F.id.value === String(c.id)) resetCourseForm();
    await loadCourses();
  } catch (err) { handleError(err); }
}

async function loadCourses() {
  try {
    ({ courses } = await api('/api/courses'));
    buildLibrary();
    await loadMaterial();
  } catch (err) { handleError(err, 'Could not load courses'); }
}

$('course-cancel').addEventListener('click', resetCourseForm);
courseForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const code = normalizeCode(F.course_code.value);
  const title = F.course_title.value.trim();
  if (!code) return toast('error', 'Check the course code', 'It looks like COM 111.');
  if (title.length < 3) return toast('error', 'Check the course title', 'Write at least 3 characters.');
  const year = $('m-year').value;
  const files = { question: $('m-question-file').files[0], handout: $('m-handout-file').files[0] };
  const note = $('m-note').value.trim();
  if (!year && (files.question || files.handout)) return toast('error', 'Choose a year first', 'A file is saved under a year. Pick the year above, then save.');
  const body = { level_id: Number(F.level_id.value), semester: F.semester.value, course_code: code, course_title: title };
  const btn = $('course-save');
  setBusy(btn, true);
  try {
    // Anything except "Edit year" adds a year. It joins the course if it exists, and never replaces a year that has a post.
    const adding = formMode !== 'year';
    const existing = formCourse();
    if (adding && existing && year) {
      const { materials } = await api(`/api/courses/${existing.id}/materials`);
      if (materials.some((m) => String(m.year) === year)) {
        return toast('error', `${existing.course_code} already has a post in ${year}`, 'Open that year from the Posts list and use Edit year to change it.', 7000);
      }
    }
    if (adding && existing && !F.id.value && existing.course_title.trim().toLowerCase() !== title.toLowerCase()) {
      return toast('error', `${existing.course_code} already exists with another title`, `It is "${existing.course_title}". Use that title to add a year to it, or edit the course from the Posts list.`, 7000);
    }
    // 1. Upload the documents first, so a failed upload leaves nothing half saved.
    const urls = { question_url: currentMaterial.question_url, handout_url: currentMaterial.handout_url };
    if (year) {
      const chosen = fileKinds.filter(([kind]) => files[kind]);
      if (chosen.length) {
        toast('info', 'Uploading', chosen.map(([kind]) => files[kind].name).join(', '), 3000);
        const sig = await api('/api/courses/upload-signature'); // one signature serves both files
        const done = await Promise.all(chosen.map(([kind]) => uploadFile(files[kind], sig)));
        chosen.forEach(([kind], i) => { urls[`${kind}_url`] = done[i]; });
      }
    }
    // 2. Add or update the course.
    let course = formCourse();
    if (course) {
      // A course that is only getting a new year is left exactly as it is.
      if (formMode === 'year' || formMode === 'course') ({ course } = await api(`/api/courses/${course.id}`, { method: 'PUT', body }));
    } else {
      ({ course } = await api('/api/courses', { method: 'POST', body }));
    }
    // 3. Save the post. Anything not uploaded is marked pending.
    if (year) {
      const missing = fileKinds.filter(([kind]) => !urls[`${kind}_url`]).map(([, label]) => label);
      const status_note = missing.length ? (note || (missing.length === 2 ? 'Pending' : `${missing[0][0].toUpperCase()}${missing[0].slice(1)} pending`)) : '';
      await saveMaterial(course.id, year, { ...urls, status_note, ...(formMode === 'year' ? {} : { create: true }) });
    }
    toast('success', 'Saved', `${code}${year ? `, ${year}` : ''}`);
    resetCourseForm();
    await loadCourses();
  } catch (err) { handleError(err, 'Could not save'); if (err.status === 409) loadMaterial(); } finally { setBusy(btn, false); }
});

// ---------- Icon dropdowns ----------
// A three-dot button that opens a small list of icon-only buttons. The list is attached to the page body
// and placed by script, so a card that clips its content cannot cut it off.
let openMenu = null;
function closeMenu() {
  if (!openMenu) return;
  openMenu.menu.remove();
  openMenu.trigger.setAttribute('aria-expanded', 'false');
  openMenu = null;
}
document.addEventListener('click', (e) => {
  if (openMenu && !openMenu.menu.contains(e.target) && !openMenu.trigger.contains(e.target)) closeMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !openMenu) return;
  const { trigger } = openMenu;
  closeMenu();
  trigger.focus();
});
window.addEventListener('resize', closeMenu);
window.addEventListener('scroll', closeMenu, true);

/** entries: { icon, label, onClick, href, download, danger }. Entries that are false or null are skipped. */
function dropdown(label, entries) {
  const trigger = h('button', { class: 'icon-btn sm dd-trigger', type: 'button', 'aria-label': label, title: label, 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, icon('more-vertical'));
  const makeItem = (e) => {
    const attrs = { class: `dd-item${e.danger ? ' danger' : ''}`, role: 'menuitem', 'aria-label': e.label, title: e.label };
    // Close after the click has finished, so a link still opens or downloads.
    const done = () => { e.onClick?.(); setTimeout(closeMenu, 0); };
    return e.href
      ? h('a', { ...attrs, href: e.href, target: e.download ? null : '_blank', download: e.download ? '' : null, rel: 'noopener noreferrer', onclick: done }, icon(e.icon))
      : h('button', { ...attrs, type: 'button', onclick: done }, icon(e.icon));
  };
  trigger.addEventListener('click', (e) => {
    e.preventDefault(); // some triggers sit inside a <summary>, so the card must not open or close
    e.stopPropagation();
    if (openMenu?.trigger === trigger) return closeMenu();
    closeMenu();
    const menu = h('div', { class: 'dd-menu', role: 'menu' }, entries.filter(Boolean).map(makeItem));
    document.body.append(menu);
    const r = trigger.getBoundingClientRect();
    menu.style.top = `${r.bottom + 4}px`;
    menu.style.right = `${document.documentElement.clientWidth - r.right}px`;
    trigger.setAttribute('aria-expanded', 'true');
    openMenu = { menu, trigger };
    menu.firstElementChild?.focus();
  });
  return trigger;
}

// ---------- Posts library: level > semester > course > year ----------

function libCourse(course) {
  const body = h('div', { class: 'lib-body' });
  const options = dropdown(`Options for ${course.course_code}`, [
    { icon: 'pencil', label: 'Edit course', onClick: () => editInForm(course, '', 'course') },
    { icon: 'trash', label: 'Delete course', danger: true, onClick: () => removeCourse(course) },
  ]);
  const details = h('details', { class: 'lib-course' },
    h('summary', {}, h('span', { class: 'code' }, course.course_code), h('span', { class: 'course-title' }, course.course_title), options),
    body);
  details.addEventListener('toggle', () => { if (details.open) loadPosts(course, body); });
  return { course, el: details, details, body };
}

function buildLibrary() {
  const root = $('library');
  const openCourses = new Set(libGroups.flatMap((g) => g.sems.flatMap((s) => s.items.filter((i) => i.details.open).map((i) => i.course.id))));
  const openLevels = new Set(libGroups.filter((g) => g.el.open).map((g) => g.levelId));
  if (courses.length === 0) {
    libGroups = [];
    root.replaceChildren(h('div', { class: 'empty-state glass' }, h('span', { class: 'tile-ico' }, icon('inbox')), h('p', {}, 'No courses yet.')));
    return;
  }
  libGroups = [1, 2, 3, 4].map((levelId) => {
    const inLevel = courses.filter((c) => c.level_id === levelId);
    if (!inLevel.length) return null;
    const sems = SEMESTERS.map((sem) => {
      const list = inLevel.filter((c) => c.semester === sem);
      if (!list.length) return null;
      const items = list.map(libCourse);
      return { el: h('div', { class: 'lib-sem' }, h('h3', {}, `${sem} semester`), items.map((i) => i.el)), items };
    }).filter(Boolean);
    const el = h('details', { class: 'lib-level glass' },
      h('summary', {}, h('span', { class: 'tile-ico' }, icon(levelId <= 2 ? 'book-open' : 'graduation-cap')), h('strong', {}, LEVELS[levelId]),
        h('span', { class: 'count-chip' }, `${inLevel.length} ${inLevel.length === 1 ? 'course' : 'courses'}`), icon('chevron-right', 'chev')),
      sems.map((s) => s.el));
    return { el, sems, levelId };
  }).filter(Boolean);
  root.replaceChildren(...libGroups.map((g) => g.el));
  for (const g of libGroups) {
    if (openLevels.has(g.levelId)) g.el.open = true;
    for (const s of g.sems) for (const it of s.items) if (openCourses.has(it.course.id)) it.details.open = true;
  }
  applyLibFilter();
}

function applyLibFilter() {
  const toks = tokens($('lib-filter').value);
  for (const g of libGroups) {
    let levelShown = 0;
    for (const s of g.sems) {
      let semShown = 0;
      for (const it of s.items) {
        const ok = matches(it.course, toks);
        it.el.hidden = !ok;
        if (ok) semShown++;
      }
      s.el.hidden = semShown === 0;
      levelShown += semShown;
    }
    g.el.hidden = levelShown === 0;
    if (toks.length && levelShown) g.el.open = true;
  }
  $('lib-empty').hidden = !(toks.length && libGroups.length && libGroups.every((g) => g.el.hidden));
}
bindSearch($('lib-filter'), $('lib-filter-clear'), applyLibFilter);

function refreshOpenCourses() {
  for (const g of libGroups) for (const s of g.sems) for (const it of s.items) if (it.details.open) loadPosts(it.course, it.body);
}

async function loadPosts(course, body) {
  body.replaceChildren(h('p', { class: 'muted' }, 'Loading posts...'));
  try {
    const { materials } = await api(`/api/courses/${course.id}/materials`);
    body.replaceChildren(materials.length
      ? h('ul', { class: 'post-list' }, materials.map((m) => postItem(course, m, body)))
      : [h('div', { class: 'lib-actions' }, addPostButton(course)), h('p', { class: 'muted' }, 'No posts yet for this course.')]);
  } catch (err) {
    body.replaceChildren(h('p', { class: 'muted' }, err.message));
    handleError(err, 'Could not load posts');
  }
}

const addPostButton = (course) => h('button', { class: 'pill-btn sm primary', type: 'button', onclick: () => editInForm(course, currentYear(), 'add') }, icon('plus'), 'Add a post');

function postItem(course, m, body) {
  return h('li', { class: 'post' },
    h('h4', { class: 'post-year' }, icon('calendar'), m.year),
    fileRow(course, m, 'question', body),
    fileRow(course, m, 'handout', body),
    m.status_note && h('p', { class: 'muted post-note' }, `Note: ${m.status_note}`),
    h('div', { class: 'post-foot' },
      addPostButton(course),
      h('button', { class: 'pill-btn sm', type: 'button', onclick: () => editInForm(course, m.year, 'year') }, icon('pencil'), 'Edit year'),
      h('button', { class: 'pill-btn sm danger', type: 'button', onclick: () => deleteYear(course, m, body) }, icon('trash'), 'Delete year')));
}

function fileRow(course, m, kind, body) {
  const label = kind === 'question' ? 'Past question' : 'Handout';
  const url = m[`${kind}_url`];
  const picker = h('input', { type: 'file', accept: '.pdf,.doc,.docx,.ppt,.pptx', hidden: true, 'aria-label': `Choose a file to replace the ${label.toLowerCase()}` });
  picker.addEventListener('change', async () => {
    const file = picker.files[0];
    picker.value = '';
    if (file) await changeFile(course, m, kind, label, file, body);
  });
  const state = !url ? (m.status_note || 'Nothing uploaded') : isHttpUrl(url) ? '' : 'Old text notes';
  const isFile = Boolean(url) && isHttpUrl(url);
  const options = dropdown(`${label} options`, [
    isFile && { icon: 'eye', label: 'View', href: viewUrl(url) },
    isFile && {
      icon: 'download', label: 'Download', href: docDownloadUrl(url) ?? url, download: true,
      onClick: () => toast('success', 'Download started', `${course.course_code} ${m.year} ${label.toLowerCase()} will be in your downloads folder.`),
    },
    { icon: 'upload', label: url ? 'Replace' : 'Upload', onClick: () => picker.click() },
    Boolean(url) && { icon: 'trash', label: 'Delete', danger: true, onClick: () => removeFile(course, m, kind, label, body) },
  ]);
  return h('div', { class: 'res' },
    h('div', { class: 'res-head' },
      h('div', { class: 'res-title' }, icon(kind === 'question' ? 'file-text' : 'book-open'), label),
      options),
    state && h('p', { class: 'res-state' }, state),
    picker);
}

const materialBody = (m, patch) => ({ question_url: m.question_url, handout_url: m.handout_url, status_note: m.status_note, ...patch });

async function changeFile(course, m, kind, label, file, body) {
  try {
    toast('info', `Uploading ${label.toLowerCase()}`, file.name, 3000);
    const url = await uploadFile(file);
    await saveMaterial(course.id, m.year, materialBody(m, { [`${kind}_url`]: url }));
    toast('success', 'Post updated', `${course.course_code} ${m.year}, ${label.toLowerCase()}`);
    await loadPosts(course, body);
  } catch (err) { handleError(err, 'Could not update the post'); }
}

async function removeFile(course, m, kind, label, body) {
  const ok = await confirmDialog({
    title: `Remove the ${label.toLowerCase()}?`, text: `${course.course_code}, ${m.year}. Students will no longer see it.`,
    confirm: 'Remove', danger: true,
  });
  if (!ok) return;
  try {
    const next = materialBody(m, { [`${kind}_url`]: null });
    if (!next.question_url && !next.handout_url && !next.status_note) {
      await api(`/api/courses/${course.id}/materials/${m.year}`, { method: 'DELETE' });
    } else {
      await saveMaterial(course.id, m.year, next);
    }
    toast('success', `${label} removed`, `${course.course_code} ${m.year}`);
    await loadPosts(course, body);
  } catch (err) { handleError(err); }
}

async function deleteYear(course, m, body) {
  const ok = await confirmDialog({
    title: `Delete ${course.course_code}, ${m.year}?`, text: 'Both the past question and the handout for this year are removed.',
    confirm: 'Delete year', danger: true,
  });
  if (!ok) return;
  try {
    await api(`/api/courses/${course.id}/materials/${m.year}`, { method: 'DELETE' });
    toast('success', 'Post deleted', `${course.course_code} ${m.year}`);
    await loadPosts(course, body);
  } catch (err) { handleError(err); }
}

// ---------- Student photos ----------
const safeImage = (url) => typeof url === 'string' && url.startsWith('https://res.cloudinary.com/');
const thumbUrl = (url) => url.replace('/upload/', '/upload/c_limit,w_480,q_auto,f_auto/');
/** Cloudinary's fl_attachment flag makes the browser download the image with a readable file name. */
const downloadUrl = (url, name) => url.replace('/upload/', `/upload/fl_attachment:${name}/`);
const fileName = (g, i) => [g.code.replace(/\s+/g, ''), g.semester, g.year, String(i + 1).padStart(2, '0')].filter(Boolean).join('_');
const semesterLabel = (g) => (g.semester ? `${g.semester} semester` : 'Semester not given');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function groupSubmissions(list) {
  const map = new Map();
  for (const s of list) {
    const key = `${s.course_code}|${s.semester ?? ''}|${s.year}`;
    if (!map.has(key)) map.set(key, { code: s.course_code, semester: s.semester ?? null, year: s.year, title: s.course_title, items: [] });
    const g = map.get(key);
    g.title ||= s.course_title;
    g.items.push(s);
  }
  for (const g of map.values()) g.items.sort((a, b) => new Date(a.submitted_at) - new Date(b.submitted_at));
  return [...map.values()].sort((a, b) => new Date(b.items.at(-1).submitted_at) - new Date(a.items.at(-1).submitted_at));
}

function thumbItem(g, s, i) {
  const name = fileName(g, i);
  const download = h('a', {
    class: 'icon-btn sm', href: downloadUrl(s.image_url, name), download: '', 'aria-label': `Download photo ${i + 1}`,
    onclick: () => toast('success', 'Download started', `${name} will be in your downloads folder.`),
  }, icon('download'));
  const remove = h('button', {
    class: 'icon-btn sm danger', type: 'button', 'aria-label': `Delete photo ${i + 1}`, onclick: () => deleteOne(g, s),
  }, icon('trash'));
  const image = h('a', { href: s.image_url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Open photo ${i + 1} of ${g.code}, ${semesterLabel(g)}, ${g.year}` },
    h('img', { src: thumbUrl(s.image_url), alt: `Photo ${i + 1} sent for ${g.code}, ${semesterLabel(g)}, ${g.year}`, loading: 'lazy' }));
  return h('li', { class: 'thumb' }, image,
    h('div', { class: 'thumb-actions' },
      h('p', { class: 'hint' }, new Date(s.submitted_at).toLocaleDateString()),
      h('span', { class: 'sub-actions' }, download, remove)));
}

function groupCard(g) {
  const count = `${g.items.length} ${g.items.length === 1 ? 'photo' : 'photos'}`;
  const meta = h('div', { class: 'meta' },
    h('span', { class: 'code' }, g.code), h('strong', {}, g.year),
    h('span', { class: g.semester ? 'count-chip' : 'muted' }, semesterLabel(g)),
    g.title && h('span', { class: 'muted' }, g.title),
    h('span', { class: 'count-chip' }, count));
  const actions = h('div', { class: 'sub-actions' },
    h('button', { class: 'pill-btn sm primary', type: 'button', onclick: (e) => downloadAll(g, e.currentTarget) }, icon('download'), 'Download all'),
    h('button', { class: 'pill-btn sm danger', type: 'button', onclick: () => deleteGroup(g) }, icon('trash'), 'Delete all'));
  return h('section', { class: 'sub-group glass' },
    h('div', { class: 'sub-head' }, meta, actions),
    h('ul', { class: 'thumb-grid' }, g.items.map((s, i) => thumbItem(g, s, i))));
}

function renderQueue(list) {
  const badge = $('queue-count');
  badge.textContent = list.length;
  badge.hidden = list.length === 0;
  $('queue-status').textContent = list.length ? '' : 'No photos waiting. New ones from students will appear here.';
  $('queue').replaceChildren(...groupSubmissions(list).map(groupCard));
}

async function loadSubmissions() {
  try {
    const { submissions } = await api('/api/submissions');
    renderQueue(submissions.filter((s) => safeImage(s.image_url)));
  } catch (err) { handleError(err, 'Could not load student photos'); }
}

/** The details written on the top of a bundle, as one line: GNS 411 - 2026 - First semester - psychology */
function bundleTitle(g) {
  return [g.code, g.year, g.semester ? `${g.semester} semester` : '', g.title].filter(Boolean).join(' - ');
}

/** The same details as a small text file, placed inside the ZIP. */
function bundleDetails(g) {
  const dates = g.items.map((s) => new Date(s.submitted_at).toLocaleDateString());
  return [
    `Course code: ${g.code}`,
    `Course title: ${g.title || 'Not given'}`,
    `Semester: ${semesterLabel(g)}`,
    `Year: ${g.year}`,
    `Photos: ${g.items.length}`,
    `Sent: ${dates[0] === dates.at(-1) ? dates[0] : `${dates[0]} to ${dates.at(-1)}`}`,
  ].join('\r\n') + '\r\n';
}

/** Reads one photo. Tries Cloudinary directly (fastest); if the browser refuses, reads it through our own server. */
async function fetchPhoto(s, i) {
  try {
    const direct = await fetch(s.image_url, { credentials: 'omit' });
    if (direct.ok) return direct;
  } catch { /* blocked or offline: use our server below */ }
  let viaServer;
  try {
    viaServer = await fetch(`/api/submissions/${s.id}/file`, { credentials: 'same-origin' });
  } catch {
    throw new Error(`Photo ${i + 1} could not be reached.`);
  }
  if (viaServer.status === 401) { location.replace('index.html#login'); throw new Error('Please sign in again.'); }
  if (!viaServer.ok) throw new Error(`Photo ${i + 1} could not be fetched.`);
  return viaServer;
}

/** Packs every photo of a bundle, plus its details, into one ZIP that downloads with a single tap. */
async function downloadAll(g, btn) {
  if (btn?.disabled) return;
  if (btn) setBusy(btn, true);
  toast('info', 'Preparing ZIP', `Packing ${g.items.length} ${g.items.length === 1 ? 'photo' : 'photos'} for ${g.code} ${g.year}.`, 5000);
  try {
    const files = [{ name: 'details.txt', data: new TextEncoder().encode(bundleDetails(g)) }];
    const photos = new Array(g.items.length);
    let next = 0;
    const worker = async () => { // fetch 4 photos at a time
      while (next < g.items.length) {
        const i = next++;
        const res = await fetchPhoto(g.items[i], i);
        const ext = /\.(jpe?g|png|webp)$/i.exec(new URL(g.items[i].image_url).pathname)?.[1]?.toLowerCase() || 'jpg';
        photos[i] = { name: `${fileName(g, i)}.${ext}`, data: new Uint8Array(await res.arrayBuffer()) };
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    files.push(...photos);

    const zipName = `${bundleTitle(g).replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 120)}.zip`;
    const url = URL.createObjectURL(makeZip(files));
    const a = h('a', { href: url, download: zipName });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast('success', 'ZIP ready', `${zipName} is in your downloads folder.`, 6000);
  } catch (err) {
    toast('error', 'Could not make the ZIP', `${err.message} Try again in a moment.`, 7000);
  } finally {
    if (btn) setBusy(btn, false);
  }
}

async function deleteOne(g, s) {
  const ok = await confirmDialog({
    title: 'Delete this photo?', text: 'It is removed from storage permanently. Download it first if you still need it.',
    confirm: 'Delete photo', danger: true,
  });
  if (!ok) return;
  try {
    await api(`/api/submissions/${s.id}`, { method: 'DELETE' });
    toast('success', 'Photo deleted', `${g.code} ${g.year}`);
  } catch (err) { handleError(err); }
  await loadSubmissions();
}

async function deleteGroup(g) {
  const ok = await confirmDialog({
    title: `Delete all ${g.items.length} photos?`, text: `${g.code}, ${semesterLabel(g)}, ${g.year}. They are removed from storage permanently. Download them first if you still need them.`,
    confirm: 'Delete all', danger: true,
  });
  if (!ok) return;
  let done = 0;
  try {
    for (const s of g.items) {
      await api(`/api/submissions/${s.id}`, { method: 'DELETE' });
      done++;
    }
    toast('success', 'Photos deleted', `${done} photos for ${g.code} ${g.year}.`);
  } catch (err) {
    handleError(err, `Deleted ${done} of ${g.items.length}, then stopped`);
  }
  await loadSubmissions();
}

// ---------- Password ----------
const passwordForm = $('password-form');
// Eye buttons show or hide what is typed in each password box, same as the sign in page.
for (const btn of passwordForm.querySelectorAll('.toggle-password')) {
  btn.addEventListener('click', () => {
    const input = btn.closest('.control').querySelector('input');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.setAttribute('aria-pressed', String(show));
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });
}
function resetPasswordEyes() {
  for (const btn of passwordForm.querySelectorAll('.toggle-password')) {
    btn.closest('.control').querySelector('input').type = 'password';
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-label', 'Show password');
  }
}
passwordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const next = $('p-new').value;
  const again = $('p-confirm').value;
  if (next.length < 8) return toast('error', 'Password is too short', 'Use at least 8 characters.');
  if (next !== again) return toast('error', 'Passwords do not match', 'Type the same new password in both boxes.');
  const btn = $('password-save');
  setBusy(btn, true);
  try {
    await api('/api/auth/password', { method: 'PUT', body: { password: next, confirm_password: again } });
    passwordForm.reset();
    resetPasswordEyes();
    toast('success', 'Password changed', 'Every other device was signed out. Use the new password next time you sign in.');
  } catch (err) { handleError(err, 'Could not change the password'); } finally { setBusy(btn, false); }
});

// ---------- Start ----------
if (await guard()) await Promise.all([loadCourses(), loadSubmissions()]);