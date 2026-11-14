'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../database');
const { asyncHandler } = require('../middleware');

const router = express.Router();

// One tap on a student's Download button is one request. The limit stops one connection from inflating the number.
const countLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Try again later.' },
});

async function readTotal() {
  const { data, error } = await db.from('download_counter').select('total').eq('id', 1).maybeSingle();
  if (error) throw error;
  return Number(data?.total) || 0;
}

// Public: the student header and the admin dashboard both show this number.
router.get('/downloads', asyncHandler(async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ total: await readTotal() });
}));

// A student pressed Download: add 1 and return the new total.
router.post('/downloads', countLimiter, asyncHandler(async (_req, res) => {
  const { data, error } = await db.rpc('increment_downloads');
  if (error) throw error;
  res.set('Cache-Control', 'no-store');
  res.json({ total: Number(data) || 0 });
}));

module.exports = router;