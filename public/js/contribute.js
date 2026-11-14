import { api, setStatus, h, currentYear, FIRST_YEAR } from './api.js';
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
const MAX_BYTES = 8 * 1024 * 1024; // Cloudinary accepts up to 10 MB
const MAX_SIDE = 1800; // pixels on the long side: still easy to read, and about 5 times lighter than a raw phone photo
const TARGET_BYTES = 700 * 1024;
const CODE_RE = /^[A-Za-z]{2,5}[\s-]?\d{3}$/;
form.elements.year.min = FIRST_YEAR; // the hub starts at 2021, the same year the course pages start at
form.elements.year.max = currentYear();

let selected = []; // [{ file, url }]

/** Shrinks a phone photo in the browser (like WhatsApp does) so it uploads fast on mobile data. Text stays readable. */
async function compress(file) {
  if (file.type === 'image/jpeg' && file.size <= 600 * 1024) return file; // already light
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    let blob = null;
    for (const quality of [0.75, 0.65, 0.55]) {
      blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= TARGET_BYTES) break;
    }
    if (blob && blob.size <= MAX_BYTES) {
      if (file.type === 'image/jpeg' && file.size <= blob.size) return file; // the original is already the lighter one
      return new File([blob], 'photo.jpg', { type: 'image/jpeg' });
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
const bar = document.getElementById('send-bar');
const track = document.getElementById('send-track');
const fillEl = document.getElementById('send-fill');
const pctEl = document.getElementById('send-pct');
const cancelBtn = document.getElementById('send-cancel');

function fail(message) {
  setStatus(statusEl, message, 'error');
  toast('error', 'Check the form', message);
}

function setProgress(value) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  fillEl.style.width = `${v}%`;
  pctEl.textContent = `${v}%`;
  track.setAttribute('aria-valuenow', String(v));
}

function showBar(on) {
  if (on) {
    // The bar sticks right under the top bar, whatever height that has on this screen.
    document.documentElement.style.setProperty('--topbar-h', `${document.querySelector('.topbar').offsetHeight}px`);
    setProgress(0);
    cancelBtn.disabled = false;
  }
  bar.hidden = !on;
}

const warnLeave = (e) => { e.preventDefault(); e.returnValue = ''; };

/** Sends one photo straight to Cloudinary and reports how many bytes have gone, so the bar moves smoothly. */
function uploadToCloudinary(blob, sign, onProgress, active) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    active.add(xhr);
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${sign.cloud_name}/image/upload`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded); };
    xhr.onload = () => {
      active.delete(xhr);
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300 && data?.public_id) return resolve(data);
      reject(new Error(data?.error?.message || 'The photo could not be sent. Try again.'));
    };
    xhr.onerror = () => { active.delete(xhr); reject(new Error('Cannot reach the server. Check your connection and try again.')); };
    xhr.onabort = () => { active.delete(xhr); const err = new Error('Cancelled'); err.cancelled = true; reject(err); };
    const data = new FormData();
    data.set('file', blob, blob.name || 'photo.jpg');
    for (const key of ['api_key', 'timestamp', 'signature', 'folder', 'allowed_formats']) data.set(key, sign[key]);
    xhr.send(data);
  });
}

/** Tells our server the photo is stored, so it shows up for the admin. One retry if the connection blinked. */
async function recordPhoto(uploaded, details) {
  const body = { ...details, public_id: uploaded.public_id, version: uploaded.version, format: uploaded.format, signature: uploaded.signature };
  try {
    await api('/api/submissions/record', { method: 'POST', body });
  } catch (err) {
    if (err.status && err.status < 500) throw err;
    await api('/api/submissions/record', { method: 'POST', body });
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  setStatus(statusEl, '');
  if (selected.length === 0) return fail('Choose or take at least one photo first.');
  if (!CODE_RE.test(form.elements.course_code.value.trim())) return fail('Course code looks like COM 111.');
  if (!['First', 'Second'].includes(form.elements.semester.value)) return fail('Choose the semester, First or Second.');
  const year = Number(form.elements.year.value);
  if (!Number.isInteger(year) || year < FIRST_YEAR || year > currentYear()) return fail(`Enter a year from ${FIRST_YEAR} to ${currentYear()}.`);

  const details = Object.fromEntries(['course_code', 'course_title', 'semester', 'year', 'website'].map((name) => [name, form.elements[name].value]));
  button.disabled = true;
  button.classList.add('is-loading');
  showBar(true);
  window.addEventListener('beforeunload', warnLeave);

  const total = selected.length;
  const sent = new Set();
  const active = new Set(); // uploads in flight, so Cancel can stop them
  let cancelled = false;
  let stop = false; // set when the upload limit is reached
  let firstError = '';
  cancelBtn.onclick = () => {
    cancelled = true;
    cancelBtn.disabled = true;
    for (const xhr of active) xhr.abort();
  };

  try {
    // Step 1: shrink the photos (this is the first 10% of the bar).
    const jobs = selected.map((item) => ({ item, blob: null, loaded: 0 }));
    let prepared = 0;
    for (const job of jobs) {
      if (cancelled) break;
      try { job.blob = await compress(job.item.file); } catch (err) { firstError ||= err.message; }
      prepared += 1;
      setProgress((10 * prepared) / total);
    }

    // Step 2: send 3 photos at the same time. The rest of the bar follows the real bytes sent.
    const todo = jobs.filter((job) => job.blob);
    const bytes = todo.reduce((n, job) => n + job.blob.size, 0) || 1;
    const refresh = () => setProgress(10 + (90 * todo.reduce((n, job) => n + job.loaded, 0)) / bytes);
    let next = 0;
    const worker = async () => {
      while (!cancelled && !stop) {
        const job = todo[next++];
        if (!job) return;
        try {
          const sign = await api('/api/submissions/sign', { method: 'POST', body: { website: details.website } });
          if (cancelled) return;
          const uploaded = await uploadToCloudinary(job.blob, sign, (n) => { job.loaded = Math.min(n, job.blob.size); refresh(); }, active);
          job.loaded = job.blob.size;
          refresh();
          await recordPhoto(uploaded, details); // finished photos are saved at once, even if Cancel is pressed right after
          sent.add(job.item);
        } catch (err) {
          if (err.cancelled) return;
          firstError ||= err.message;
          job.loaded = job.blob.size; // a failed photo no longer holds the bar back
          refresh();
          if (err.status === 429) stop = true; // upload limit reached: keep the rest for later
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  } finally {
    window.removeEventListener('beforeunload', warnLeave);
    showBar(false);
    button.disabled = false;
    button.classList.remove('is-loading');
  }

  // One alert to the admin for the whole batch, not one per photo. Photos sent before a Cancel are included.
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
  } else if (cancelled) {
    const note = sent.size > 0
      ? `${sent.size} ${sent.size === 1 ? 'photo was' : 'photos were'} already sent and ${sent.size === 1 ? 'is' : 'are'} with the admin. The other ${selected.length} ${selected.length === 1 ? 'is' : 'are'} still here.`
      : 'Nothing was sent. Your photos are still here.';
    setStatus(statusEl, '');
    toast('info', 'Sending cancelled', note, 7000);
  } else {
    const message = `${sent.size} of ${total} sent. ${selected.length} not sent: ${firstError}`;
    setStatus(statusEl, message, 'error');
    toast('error', 'Some photos were not sent', `${firstError} The photos that failed are still here. Press Send photos to try again.`, 8000);
  }
});

renderPreview();