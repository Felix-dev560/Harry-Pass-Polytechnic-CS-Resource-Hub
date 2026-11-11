import { api, setStatus, h, currentYear } from './api.js';
import { icon, toast } from './ui.js';

const form = document.getElementById('contribute-form');
const statusEl = document.getElementById('form-status');
const button = form.querySelector('button[type="submit"]');
const dropzone = document.getElementById('dropzone');
const input = form.elements.image;
const preview = document.getElementById('preview');
const previewList = document.getElementById('preview-list');
const previewCount = document.getElementById('preview-count');
const MAX_FILES = 20;
const MAX_BYTES = 4 * 1024 * 1024;
const CODE_RE = /^[A-Za-z]{2,5}[\s-]?\d{3}$/;
form.elements.year.max = currentYear();

let selected = []; // [{ file, url }]

/** Downscales phone photos in the browser so they fit under the 4 MB server limit and upload quickly on slow data. */
async function compress(file) {
  if (file.size <= 1.5 * 1024 * 1024 && file.type === 'image/jpeg') return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, 2200 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    for (const quality of [0.85, 0.7, 0.55]) {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= MAX_BYTES) return new File([blob], 'photo.jpg', { type: 'image/jpeg' });
    }
  } catch {
    /* unsupported format or decode failure: fall through to the size check */
  }
  if (file.size <= MAX_BYTES) return file;
  throw new Error('A photo is too large. Take it again at a lower resolution.');
}

// ---------- Choosing photos ----------
const same = (a, b) => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;

function renderPreview() {
  previewList.replaceChildren(...selected.map((s, i) => h('li', {},
    h('img', { src: s.url, alt: `Photo ${i + 1}` }),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Remove photo ${i + 1}`, onclick: () => removeAt(i) }, icon('x')))));
  previewCount.textContent = `${selected.length} of ${MAX_FILES} photos`;
  preview.hidden = selected.length === 0;
}

function removeAt(index) {
  URL.revokeObjectURL(selected[index].url);
  selected.splice(index, 1);
  renderPreview();
}

function addFiles(list) {
  let notImages = 0;
  for (const file of list) {
    if (!file.type.startsWith('image/')) { notImages++; continue; }
    if (selected.some((s) => same(s.file, file))) continue;
    if (selected.length >= MAX_FILES) {
      toast('info', 'Photo limit reached', `You can send up to ${MAX_FILES} photos at once.`);
      break;
    }
    selected.push({ file, url: URL.createObjectURL(file) });
  }
  if (notImages) toast('error', 'Some files were skipped', 'Only JPEG, PNG or WebP photos can be sent.');
  renderPreview();
}

input.addEventListener('change', () => {
  addFiles([...input.files]);
  input.value = ''; // lets the same photo be chosen again after removing it
});

for (const type of ['dragenter', 'dragover']) {
  dropzone.addEventListener(type, (e) => { e.preventDefault(); dropzone.classList.add('is-over'); });
}
for (const type of ['dragleave', 'drop']) {
  dropzone.addEventListener(type, () => dropzone.classList.remove('is-over'));
}
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.dataTransfer?.files?.length) addFiles([...e.dataTransfer.files]);
});

// ---------- Sending ----------
function fail(message) {
  setStatus(statusEl, message, 'error');
  toast('error', 'Check the form', message);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  setStatus(statusEl, '');
  if (selected.length === 0) return fail('Choose or take at least one photo first.');
  if (!CODE_RE.test(form.elements.course_code.value.trim())) return fail('Course code looks like COM 111.');
  if (!['First', 'Second'].includes(form.elements.semester.value)) return fail('Choose the semester, First or Second.');
  const year = Number(form.elements.year.value);
  if (!Number.isInteger(year) || year < 2015 || year > currentYear() + 1) return fail('Enter the year as four digits, for example 2023.');

  button.disabled = true;
  button.classList.add('is-loading');
  const total = selected.length;
  const sent = new Set();
  let firstError = '';
  try {
    for (const [i, item] of selected.entries()) {
      setStatus(statusEl, `Sending photo ${i + 1} of ${total}...`);
      try {
        const data = new FormData();
        data.set('image', await compress(item.file));
        for (const name of ['course_code', 'course_title', 'semester', 'year', 'website']) data.set(name, form.elements[name].value);
        await api('/api/submissions', { method: 'POST', formData: data });
        sent.add(item);
      } catch (err) {
        firstError ||= err.message;
        if (err.status === 429) break; // upload limit reached: keep the rest for later
      }
    }
  } finally {
    button.disabled = false;
    button.classList.remove('is-loading');
  }

  // One alert to the admin for the whole batch, not one per photo.
  if (sent.size > 0) {
    const batch = Object.fromEntries(['course_code', 'semester', 'year'].map((name) => [name, form.elements[name].value]));
    api('/api/submissions/notify', { method: 'POST', body: batch }).catch(() => {});
  }

  for (const item of selected) if (sent.has(item)) URL.revokeObjectURL(item.url);
  selected = selected.filter((item) => !sent.has(item));
  renderPreview();

  if (selected.length === 0) {
    form.reset();
    setStatus(statusEl, '');
    toast('success', total === 1 ? 'Photo sent' : `${total} photos sent`, 'An admin will review them and add them to the course. Thank you for contributing.', 6000);
  } else {
    const message = `${sent.size} of ${total} sent. ${selected.length} not sent: ${firstError}`;
    setStatus(statusEl, message, 'error');
    toast('error', 'Some photos were not sent', `${firstError} The photos that failed are still here. Press Send photos to try again.`, 8000);
  }
});

renderPreview();