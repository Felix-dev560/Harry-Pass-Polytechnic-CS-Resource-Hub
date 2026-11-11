'use strict';
const express = require('express');
const { v2: cloudinary } = require('cloudinary');
const db = require('../database');
const config = require('../config');
const { asyncHandler, HttpError, requireAdmin } = require('../middleware');
const { notifyRole } = require('../push');

cloudinary.config({ ...config.cloudinary, secure: true });

/** Turns a link to a file this site uploaded (folder harrypass/materials on our own Cloudinary account) into
 *  its public_id. Any other link returns null, so only files uploaded by the dashboard can ever be deleted. */
function materialFile(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.hostname !== 'res.cloudinary.com') return null;
    const parts = u.pathname.split('/').filter(Boolean); // cloud, resource type, "upload", [version], folder, ..., file
    const [cloud, type, mode] = parts;
    if (cloud !== config.cloudinary.cloud_name || mode !== 'upload' || !['raw', 'image'].includes(type)) return null;
    const at = parts.indexOf('harrypass');
    if (at < 3 || parts[at + 1] !== 'materials' || parts.length < at + 3) return null;
    let publicId = decodeURIComponent(parts.slice(at).join('/'));
    if (type === 'image') publicId = publicId.replace(/\.[A-Za-z0-9]+$/, ''); // images are stored without the extension; raw files keep it
    return { publicId, type };
  } catch { return null; }
}

/** Deletes uploaded files from Cloudinary. Best effort: a failure is logged and never fails the admin's request. */
async function removeFiles(urls) {
  const files = [...new Set(urls.filter(Boolean))].map(materialFile).filter(Boolean);
  await Promise.all(files.map(async ({ publicId, type }) => {
    try {
      const result = await cloudinary.uploader.destroy(publicId, { resource_type: type, invalidate: true });
      if (result.result !== 'ok' && result.result !== 'not found') console.error('Cloudinary delete said:', publicId, result.result);
    } catch (err) {
      console.error('Cloudinary delete failed:', publicId, err);
    }
  }));
}

const router = express.Router();
const SEMESTERS = ['First', 'Second'];
const FIRST_YEAR = 2021;
const MAX_NOTE_LENGTH = 50000;
const LEVEL_NAMES = { 1: 'ND 1', 2: 'ND 2', 3: 'HND 1', 4: 'HND 2' };

/** Tells every subscribed student what was posted, and where to find it. `kinds` is ['handout'], ['past question'] or both. */
async function announceMaterial(course_id, year, kinds) {
  const { data: course } = await db.from('courses')
    .select('id, level_id, semester, course_code, course_title').eq('id', course_id).maybeSingle();
  if (!course) return;
  const what = kinds.length === 2 ? 'Handout and past question' : `${kinds[0][0].toUpperCase()}${kinds[0].slice(1)}`;
  await notifyRole('student', {
    title: `New ${what.toLowerCase()} posted`,
    body: `${course.course_code}: ${course.course_title}\n${LEVEL_NAMES[course.level_id]}, ${course.semester} semester, ${year}`,
    url: `/courses.html?level=${course.level_id}&semester=${course.semester}&focus=${course.id}&year=${year}`,
    tag: `material-${course.id}-${year}`,
  });
}

// Short in-memory cache for public reads, so repeat visits skip the database round trip.
// Every write clears it, so students see admin changes right away on this server instance.
const CACHE_MS = 30 * 1000;
const cache = new Map();
const cached = (key, load) => {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = load();
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key)); // never keep a failed lookup
  return value;
};
router.use((req, _res, next) => { if (req.method !== 'GET') cache.clear(); next(); });

const parseId = (value, label = 'id') => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, `Invalid ${label}.`);
  return n;
};

/** Accepts "COM111", "com 111" and "COM-111", and stores "COM 111". */
function normalizeCode(raw) {
  const match = /^([A-Za-z]{2,5})[\s-]?(\d{3})$/.exec(typeof raw === 'string' ? raw.trim() : '');
  if (!match) throw new HttpError(400, 'Course code looks like COM 111.');
  return `${match[1].toUpperCase()} ${match[2]}`;
}

function readCourse(body) {
  const level_id = Number(body?.level_id);
  if (![1, 2, 3, 4].includes(level_id)) throw new HttpError(400, 'Choose a level.');
  if (!SEMESTERS.includes(body?.semester)) throw new HttpError(400, 'Choose First or Second semester.');
  const course_title = typeof body?.course_title === 'string' ? body.course_title.trim() : '';
  if (course_title.length < 3 || course_title.length > 150) throw new HttpError(400, 'Course title must be 3 to 150 characters.');
  return { level_id, semester: body.semester, course_code: normalizeCode(body?.course_code), course_title };
}

/** A material value is empty, an http(s) link, or a plain-text note. */
function readMaterialField(value, label) {
  if (value == null) return null;
  if (typeof value !== 'string') throw new HttpError(400, `${label} must be text.`);
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.length > MAX_NOTE_LENGTH) throw new HttpError(400, `${label} is too long.`);
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    throw new HttpError(400, `${label}: only http and https links are allowed.`);
  }
  return trimmed;
}

// ---- Public ----

router.get('/', asyncHandler(async (req, res) => {
  let level; let semester;
  if (req.query.level !== undefined) level = parseId(req.query.level, 'level');
  if (req.query.semester !== undefined) {
    if (!SEMESTERS.includes(req.query.semester)) throw new HttpError(400, 'Invalid semester.');
    semester = req.query.semester;
  }
  const data = await cached(`list:${level ?? ''}:${semester ?? ''}`, async () => {
    let query = db.from('courses').select('id, level_id, semester, course_code, course_title')
      .order('level_id').order('semester').order('course_code').limit(1000);
    if (level !== undefined) query = query.eq('level_id', level);
    if (semester !== undefined) query = query.eq('semester', semester);
    const { data: rows, error } = await query;
    if (error) throw error;
    return rows;
  });
  res.json({ courses: data });
}));

/** How many courses each level has, first and second semester together. Used by the number badge on the home page. */
router.get('/counts', asyncHandler(async (_req, res) => {
  const counts = await cached('counts', async () => {
    const { data: courses, error } = await db.from('courses').select('id, level_id').limit(5000);
    if (error) throw error;
    const totals = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const c of courses) if (c.level_id in totals) totals[c.level_id] += 1;
    return totals;
  });
  res.json({ counts });
}));

router.get('/search', asyncHandler(async (req, res) => {
  // Keep only characters that are safe inside a PostgREST filter string (no commas, parens or wildcards).
  const q = String(req.query.q ?? '').replace(/[^A-Za-z0-9 -]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (q.length < 2) return res.json({ courses: [] });
  const { data, error } = await db.from('courses')
    .select('id, level_id, semester, course_code, course_title')
    .or(`course_code.ilike.%${q}%,course_title.ilike.%${q}%`)
    .order('course_code').limit(15);
  if (error) throw error;
  res.json({ courses: data });
}));

// Must be registered before "/:id" routes so "upload-signature" is not parsed as an id.
router.get('/upload-signature', requireAdmin, (_req, res) => {
  // Browser uploads straight to Cloudinary using this signature. This avoids Vercel's 4.5 MB request body limit.
  const timestamp = Math.round(Date.now() / 1000);
  const folder = 'harrypass/materials';
  const signature = cloudinary.utils.api_sign_request({ folder, timestamp, unique_filename: true, use_filename: true }, config.cloudinary.api_secret);
  res.json({ cloudName: config.cloudinary.cloud_name, apiKey: config.cloudinary.api_key, timestamp, folder, signature });
});

router.get('/:id/materials', asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const data = await cached(`materials:${id}`, async () => {
    const { data: rows, error } = await db.from('course_materials')
      .select('year, question_url, handout_url, status_note')
      .eq('course_id', id).order('year', { ascending: false });
    if (error) throw error;
    return rows;
  });
  res.json({ materials: data });
}));

// ---- Admin ----

router.post('/', requireAdmin, asyncHandler(async (req, res) => {
  const { data, error } = await db.from('courses').insert(readCourse(req.body)).select().single();
  if (error) {
    if (error.code === '23505') throw new HttpError(409, 'That course code already exists for this level and semester.');
    throw error;
  }
  res.status(201).json({ course: data });
}));

router.put('/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { data, error } = await db.from('courses').update(readCourse(req.body)).eq('id', parseId(req.params.id)).select().maybeSingle();
  if (error) {
    if (error.code === '23505') throw new HttpError(409, 'That course code already exists for this level and semester.');
    throw error;
  }
  if (!data) throw new HttpError(404, 'Course not found.');
  res.json({ course: data });
}));

router.delete('/:id', requireAdmin, asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  // Remember the files first: the rows are removed with the course (ON DELETE CASCADE), and the files must go too.
  const { data: rows, error: readError } = await db.from('course_materials').select('question_url, handout_url').eq('course_id', id);
  if (readError) throw readError;
  const { error } = await db.from('courses').delete().eq('id', id);
  if (error) throw error;
  await removeFiles((rows ?? []).flatMap((r) => [r.question_url, r.handout_url]));
  res.json({ ok: true });
}));

router.put('/:id/materials/:year', requireAdmin, asyncHandler(async (req, res) => {
  const course_id = parseId(req.params.id);
  const year = Number(req.params.year);
  if (!Number.isInteger(year) || year < FIRST_YEAR || year > new Date().getFullYear() + 1) {
    throw new HttpError(400, `Year must be between ${FIRST_YEAR} and ${new Date().getFullYear() + 1}.`);
  }
  const status_note = typeof req.body?.status_note === 'string' ? req.body.status_note.trim().slice(0, 200) || null : null;
  const row = {
    course_id,
    year,
    question_url: readMaterialField(req.body?.question_url, 'Past question'),
    handout_url: readMaterialField(req.body?.handout_url, 'Handout'),
    status_note,
  };
  // create: true means "add a new year". It never overwrites, so a year that already has a post is refused.
  // Without it, the call edits that year in place (upsert).
  const creating = req.body?.create === true;
  // What this year already had, so only a document that was missing before counts as "newly posted".
  const { data: before, error: beforeError } = await db.from('course_materials')
    .select('question_url, handout_url').eq('course_id', course_id).eq('year', year).maybeSingle();
  if (beforeError) throw beforeError;
  const query = db.from('course_materials');
  const { data, error } = await (creating ? query.insert(row) : query.upsert(row, { onConflict: 'course_id,year' })).select().single();
  if (error) {
    if (error.code === '23503') throw new HttpError(404, 'Course not found.');
    if (error.code === '23505') throw new HttpError(409, `This course already has a post in ${year}. Open that year from the Posts list and edit it instead.`);
    throw error;
  }
  // A file that was on this year and is no longer used (replaced or removed) is deleted from Cloudinary.
  await removeFiles([before?.question_url, before?.handout_url].filter((u) => u && u !== row.question_url && u !== row.handout_url));
  // Replacing or removing a file, or editing a note, is not announced. Only a document that was not there before is.
  const added = [];
  if (row.handout_url && !before?.handout_url) added.push('handout');
  if (row.question_url && !before?.question_url) added.push('past question');
  if (added.length) await announceMaterial(course_id, year, added);
  res.json({ material: data });
}));

router.delete('/:id/materials/:year', requireAdmin, asyncHandler(async (req, res) => {
  const course_id = parseId(req.params.id);
  const year = parseId(req.params.year, 'year');
  const { data: old, error: readError } = await db.from('course_materials')
    .select('question_url, handout_url').eq('course_id', course_id).eq('year', year).maybeSingle();
  if (readError) throw readError;
  const { error } = await db.from('course_materials').delete().eq('course_id', course_id).eq('year', year);
  if (error) throw error;
  if (old) await removeFiles([old.question_url, old.handout_url]);
  res.json({ ok: true });
}));

module.exports = router;