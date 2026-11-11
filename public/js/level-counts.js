// Fills the number badge on each level tile (ND 1 to HND 2) with how many courses that level has,
// first and second semester together. The numbers come from the database through /api/courses/counts.
import { apiCached } from './api.js';

function show({ counts }) {
  for (const el of document.querySelectorAll('[data-level-count]')) {
    const n = Number(counts?.[el.dataset.levelCount]) || 0;
    el.textContent = String(n);
    el.setAttribute('aria-label', `${n} ${n === 1 ? 'course' : 'courses'}`);
  }
}

apiCached('/api/courses/counts', show).catch(() => { /* keep the badges as they are if the server is unreachable */ });