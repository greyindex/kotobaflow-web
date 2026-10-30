const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { withheldPassages, withheldTextIn } = require('./check_public_release.cjs');
const phrase = 'あいうえおかきくけこさしすせそ';
function fixture(t, snapshot) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kotobaflow-public-boundary-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  if (snapshot) {
    const folder = path.join(root, 'data/public-boundary');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'withheld-passage-sha256.json'), JSON.stringify(snapshot));
  }
  return root;
}
test('public resource fingerprints detect a withheld sentence without its source textbook', (t) => {
  const hash = crypto.createHash('sha256').update(phrase).digest('hex');
  const boundary = withheldPassages(fixture(t, { schema: 1, algorithm: 'sha256', passages: [hash] }));
  assert.equal(boundary.hashed, true);
  assert.deepEqual(withheldTextIn(phrase + '。', boundary), [phrase]);
  assert.deepEqual(withheldTextIn('たちつてとなにぬねのはひふへほ。', boundary), []);
});
test('public packaging refuses a missing fingerprint boundary', (t) => {
  assert.throws(() => withheldPassages(fixture(t)), /fingerprints first/);
});
test('public packaging refuses malformed or empty fingerprint boundaries', (t) => {
  for (const passages of [[], ['not-a-digest'], ['a'.repeat(64), 'a'.repeat(64)]])
    assert.throws(
      () => withheldPassages(fixture(t, { schema: 1, algorithm: 'sha256', passages })),
      /Invalid public/,
    );
});
