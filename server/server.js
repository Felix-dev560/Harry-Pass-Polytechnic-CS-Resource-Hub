'use strict';
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const config = require('./config');
const authRoutes = require('./routes/auth');
const courseRoutes = require('./routes/courses');
const submissionRoutes = require('./routes/submissions');
const pushRoutes = require('./routes/push');
const statsRoutes = require('./routes/stats');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // behind Vercel's proxy, so rate limits see the real client IP

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", 'https://fonts.googleapis.com'],
      fontSrc: ['https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://res.cloudinary.com'],
      connectSrc: ["'self'", 'https://api.cloudinary.com'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: config.isProd ? [] : null,
    },
  },
}));
app.use(express.json({ limit: '300kb' }));
app.use(cookieParser());

app.use('/api/auth', authRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/submissions', submissionRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

// Local development: Express also serves the front end. On Vercel the static build is served by the CDN.
app.use('/admin', express.static(path.join(__dirname, '..', 'admin')));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Central error handler: expose only messages from HttpError, log everything else.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    return res.status(tooBig ? 413 : 400).json({ error: tooBig ? 'Image is larger than 4 MB.' : 'Upload failed.' });
  }
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON.' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.' });
  if (err?.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  console.error(err);
  return res.status(err?.status ?? 500).json({ error: err?.status ? err.message : 'Something went wrong on the server.' });
});

if (require.main === module) {
  app.listen(config.port, () => console.log(`Hub running at http://localhost:${config.port}`));
}

module.exports = app;