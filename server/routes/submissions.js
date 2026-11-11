'use strict';
const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { v2: cloudinary } = require('cloudinary');
const db = require('../database');
const config = require('../config');
const { asyncHandler, HttpError, requireAdmin } = require('../middleware');
const { notifyRole } = require('../push');

cloudinary.config({ ...config.cloudinary, secure: true });

const router = express.Router();
const SEMESTERS = ['First', 'Second'];
const MAX_BYTES = 4 * 1024 * 1024; // Vercel rejects request bodies above about 4.5 MB
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1, fields: 7 } });

const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 60, // one request per photo, so a batch of 20 photos uses 20
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many uploads from this connection. Try again in an hour.' },
});

/** Checks the file's first bytes, because the browser-supplied mimetype can be faked. */
function isRealImage(buf) {
  if (buf.length < 12) return false;
  const jpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const png = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const webp = buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP';
  return jpeg || png || webp;
}

function uploadBuffer(buffer, options) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(options, (err, result) => (err ? reject(err) : resolve(result))).end(buffer);
  });
}

router.post('/', submitLimiter, upload.single('image'), asyncHandler(async (req, res) => {
  // Hidden field that real users never fill. Bots do. Pretend success and store nothing.
  if (req.body?.website) return res.status(201).json({ ok: true });

  if (!req.file) throw new HttpError(400, 'Attach a photo of the paper or handout.');
  if (!isRealImage(req.file.buffer)) throw new HttpError(400, 'The file must be a JPEG, PNG or WebP image.');

  const codeMatch = /^([A-Za-z]{2,5})[\s-]?(\d{3})$/.exec(String(req.body?.course_code ?? '').trim());
  if (!codeMatch) throw new HttpError(400, 'Course code looks like COM 111.');
  const course_code = `${codeMatch[1].toUpperCase()} ${codeMatch[2]}`;

  const semester = String(req.body?.semester ?? '').trim();
  if (!SEMESTERS.includes(semester)) throw new HttpError(400, 'Choose First or Second semester.');

  const course_title = String(req.body?.course_title ?? '').trim().slice(0, 150) || null;
  const year = Number(req.body?.year);
  if (!Number.isInteger(year) || year < 2015 || year > new Date().getFullYear() + 1) {
    throw new HttpError(400, 'Enter the year as four digits, for example 2023.');
  }

  let uploaded;
  try {
    uploaded = await uploadBuffer(req.file.buffer, { folder: 'harrypass/submissions', resource_type: 'image' });
  } catch (err) {
    console.error('Cloudinary upload failed:', err);
    throw new HttpError(502, 'The image could not be stored. Try again in a moment.');
  }

  const { error } = await db.from('student_submissions').insert({
    course_code, course_title, semester, year, image_url: uploaded.secure_url, public_id: uploaded.public_id,
  });
  if (error) {
    // Do not leave an orphaned image behind when the database write fails.
    await cloudinary.uploader.destroy(uploaded.public_id).catch(() => {});
    throw error;
  }
  res.status(201).json({ ok: true });
}));

// The Contribute page calls this once, after the last photo of a batch is stored (not once per photo).
// Photos are marked notified in one atomic update, so repeated or forged calls find nothing new and send nothing.
const notifyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Try again later.' },
});

router.post('/notify', notifyLimiter, asyncHandler(async (req, res) => {
  const codeMatch = /^([A-Za-z]{2,5})[\s-]?(\d{3})$/.exec(String(req.body?.course_code ?? '').trim());
  const semester = String(req.body?.semester ?? '').trim();
  const year = Number(req.body?.year);
  if (!codeMatch || !SEMESTERS.includes(semester) || !Number.isInteger(year)) throw new HttpError(400, 'Invalid batch.');
  const course_code = `${codeMatch[1].toUpperCase()} ${codeMatch[2]}`;

  const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db.from('student_submissions')
    .update({ notified: true })
    .eq('course_code', course_code).eq('semester', semester).eq('year', year)
    .eq('notified', false).gte('submitted_at', since)
    .select('id');
  if (error) throw error;

  const count = data?.length ?? 0;
  if (count > 0) {
    await notifyRole('admin', {
      title: count === 1 ? 'New photo from a student' : `${count} new photos from a student`,
      body: `${course_code}, ${semester} semester, ${year}. Tap to review.`,
      url: '/admin/dashboard.html#submissions',
      tag: `photos-${course_code.replace(' ', '')}-${semester}-${year}`,
    });
  }
  res.json({ ok: true });
}));

router.get('/', requireAdmin, asyncHandler(async (_req, res) => {
  const { data, error } = await db.from('student_submissions')
    .select('id, course_code, course_title, semester, year, image_url, submitted_at')
    .order('submitted_at', { ascending: false }).limit(500);
  if (error) throw error;
  res.json({ submissions: data });
}));

router.delete('/:id', requireAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid id.');

  const { data: row, error: readError } = await db.from('student_submissions').select('id, public_id').eq('id', id).maybeSingle();
  if (readError) throw readError;
  if (!row) throw new HttpError(404, 'Submission not found.');

  // Delete the image first. If Cloudinary fails, keep the row so the admin can retry.
  let result;
  try {
    result = await cloudinary.uploader.destroy(row.public_id, { resource_type: 'image', invalidate: true });
  } catch (err) {
    console.error('Cloudinary delete failed:', err);
    throw new HttpError(502, 'The image could not be deleted from storage. Try again.');
  }
  if (result.result !== 'ok' && result.result !== 'not found') {
    throw new HttpError(502, 'The image could not be deleted from storage. Try again.');
  }

  const { error } = await db.from('student_submissions').delete().eq('id', id);
  if (error) throw error;
  res.json({ ok: true });
}));

module.exports = router;