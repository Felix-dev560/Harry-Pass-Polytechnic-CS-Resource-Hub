'use strict';
// Vercel serverless entry point. All /api/* requests are rewritten here (see vercel.json).
// Exporting the Express app lets Vercel invoke it as a request handler.
module.exports = require('../server/server');
