'use strict';
// Vercel static build: public/ becomes the site root, admin/ becomes /admin (admin/index.html is the sign-in page).
// Both keep the same relative asset paths (../css, ../js) as in local Express serving.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');

fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(path.join(root, 'public'), dist, { recursive: true });
fs.cpSync(path.join(root, 'admin'), path.join(dist, 'admin'), { recursive: true });
console.log('Built static site into dist/');
