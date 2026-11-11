'use strict';
// One-time cleanup for documents that were left on Cloudinary before the site started deleting them
// (replaced files, deleted years, deleted courses). It lists every document in harrypass/materials, compares them
// with the links the database still uses, and reports the rest. Nothing is deleted unless you add --delete.
//
//   node scripts/cleanup-orphans.js            look only
//   node scripts/cleanup-orphans.js --delete   delete the orphans
//
// Run it from the project folder with your .env filled in. Do not run it while you are in the middle of uploading
// a document in the dashboard. Files younger than one hour are always skipped for that reason.
const config = require('../server/config');
const db = require('../server/database');
const { v2: cloudinary } = require('cloudinary');

cloudinary.config({ ...config.cloudinary, secure: true });
const PREFIX = 'harrypass/materials/';
const MIN_AGE_MS = 60 * 60 * 1000;
const doDelete = process.argv.includes('--delete');

/** Cloudinary id of a link to one of our uploaded documents, or null. Raw files keep their extension, images do not. */
function idFromUrl(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.hostname !== 'res.cloudinary.com') return null;
    const parts = u.pathname.split('/').filter(Boolean);
    const [cloud, type, mode] = parts;
    if (cloud !== config.cloudinary.cloud_name || mode !== 'upload' || !['raw', 'image'].includes(type)) return null;
    const at = parts.indexOf('harrypass');
    if (at < 3) return null;
    let id = decodeURIComponent(parts.slice(at).join('/'));
    if (type === 'image') id = id.replace(/\.[A-Za-z0-9]+$/, '');
    return `${type}:${id}`;
  } catch { return null; }
}

async function listAll(type) {
  const found = [];
  let next;
  do {
    const page = await cloudinary.api.resources({ resource_type: type, type: 'upload', prefix: PREFIX, max_results: 500, next_cursor: next });
    for (const r of page.resources) found.push({ key: `${type}:${r.public_id}`, type, id: r.public_id, bytes: r.bytes, created: new Date(r.created_at) });
    next = page.next_cursor;
  } while (next);
  return found;
}

async function main() {
  const { data: rows, error } = await db.from('course_materials').select('question_url, handout_url').limit(100000);
  if (error) throw error;
  const used = new Set(rows.flatMap((r) => [r.question_url, r.handout_url]).map(idFromUrl).filter(Boolean));

  const stored = [...await listAll('raw'), ...await listAll('image')];
  const orphans = stored.filter((f) => !used.has(f.key) && Date.now() - f.created.getTime() > MIN_AGE_MS);
  const bytes = orphans.reduce((sum, f) => sum + (f.bytes || 0), 0);

  console.log(`${stored.length} documents on Cloudinary, ${used.size} used by the site, ${orphans.length} not used (${(bytes / 1048576).toFixed(1)} MB).`);
  for (const f of orphans) console.log(`  ${f.id}`);
  if (!orphans.length) return;
  if (!doDelete) { console.log('Nothing deleted. Run again with --delete to remove these files.'); return; }

  for (const type of ['raw', 'image']) {
    const ids = orphans.filter((f) => f.type === type).map((f) => f.id);
    for (let i = 0; i < ids.length; i += 100) {
      await cloudinary.api.delete_resources(ids.slice(i, i + 100), { resource_type: type, type: 'upload', invalidate: true });
    }
  }
  console.log(`Deleted ${orphans.length} files.`);
}

main().catch((err) => { console.error(err); process.exitCode = 1; });