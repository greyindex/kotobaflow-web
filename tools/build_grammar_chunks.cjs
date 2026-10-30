const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildReviewByUid, readReview } = require('./grammar_example_review.cjs');
const root = path.resolve(__dirname, '..');
const input = fs.readFileSync(path.join(root, 'data/grammar_details.json'), 'utf8');
if (input.startsWith('version https://git-lfs')) throw Error('Run git lfs pull first');
const details = JSON.parse(input);
const output = path.join(root, 'data/grammar_chunks');
const files = new Map();
const manifest = {
  version: 1,
  entries: {},
  exampleLanguageReviews: Object.fromEntries(buildReviewByUid(details, readReview(root))),
};
// Stable UID ordering; one small group per request, unchanged groups retain their URL.
const keys = Object.keys(details).sort();
for (let i = 0; i < keys.length; i += 16) {
  const group = keys.slice(i, i + 16);
  const body = JSON.stringify(Object.fromEntries(group.map((key) => [key, details[key]])));
  const hash = crypto.createHash('sha256').update(body).digest('hex');
  const file = hash + '.json';
  files.set(file, body);
  for (const key of group) manifest.entries[key] = file;
}
files.set('index.json', JSON.stringify(manifest));
if (process.argv.includes('--check')) {
  for (const [file, body] of files) {
    if (!fs.existsSync(path.join(output, file)) || fs.readFileSync(path.join(output, file), 'utf8') !== body)
      throw Error('Grammar chunks stale; run npm run resources:grammar');
  }
} else {
  fs.mkdirSync(output, { recursive: true });
  for (const [file, body] of files) fs.writeFileSync(path.join(output, file), body);
}
console.log(
  JSON.stringify({
    entries: keys.length,
    chunks: files.size - 1,
    largestBytes: Math.max(...[...files.values()].map((s) => Buffer.byteLength(s))),
    sourceBytes: Buffer.byteLength(input),
  }),
);
