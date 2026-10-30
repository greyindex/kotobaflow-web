const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const window = {};
vm.runInNewContext(fs.readFileSync(path.join(root, 'js/core/lexical-metadata.js'), 'utf8'), {
  window,
  console,
});
vm.runInNewContext(fs.readFileSync(path.join(root, 'js/loader.js'), 'utf8'), { window, console });
const input = fs.readFileSync(
  path.join(root, 'data/taxonomy_annotations_gemini_3_flash_enriched.json'),
  'utf8',
);
if (input.startsWith('version https://git-lfs')) throw Error('Run git lfs pull first');
const words = window.dataLoader.normalizeWords(JSON.parse(input));
const files = new Map();
const deferred = [
  'example_sentences',
  'confusable_words_ja',
  'shape_similar_words_ja',
  'sound_similar_words_ja',
  'descriptive_tags_zh',
  'usage_tags_zh',
  'quality_flags',
  'source_word',
  'source_label',
  'split_part',
  'split_total',
];
const manifest = { version: 2, count: words.length, chunks: [], deferred, details: [] };
for (let i = 0; i < words.length; i += 1600) {
  const group = words.slice(i, i + 1600);
  const keys = Object.keys(group[0]).filter((key) => !deferred.includes(key));
  const values = [],
    seen = new Map();
  const rows = group.map((word) =>
    keys.map((key) => {
      const encoded = JSON.stringify(word[key]);
      if (!seen.has(encoded)) {
        seen.set(encoded, values.length);
        values.push(word[key]);
      }
      return seen.get(encoded);
    }),
  );
  const body = JSON.stringify({ keys, values, rows });
  const name = crypto.createHash('sha256').update(body).digest('hex') + '.json';
  manifest.chunks.push(name);
  files.set(name, body);
}
for (let i = 0; i < words.length; i += 128) {
  const group = words.slice(i, i + 128);
  const body = JSON.stringify(
    Object.fromEntries(
      group.map((word) => [word.index, Object.fromEntries(deferred.map((key) => [key, word[key]]))]),
    ),
  );
  const name = 'detail-' + crypto.createHash('sha256').update(body).digest('hex') + '.json';
  files.set(name, body);
  manifest.details.push({ file: name, indexes: group.map((word) => word.index) });
}
files.set('index.json', JSON.stringify(manifest));
const output = path.join(root, 'data/vocab_chunks');
if (process.argv.includes('--check')) {
  for (const [file, body] of files) {
    if (!fs.existsSync(path.join(output, file)) || fs.readFileSync(path.join(output, file), 'utf8') !== body)
      throw Error('Vocabulary chunks stale; run npm run resources:vocab');
  }
} else {
  fs.mkdirSync(output, { recursive: true });
  for (const [file, body] of files) fs.writeFileSync(path.join(output, file), body);
}
console.log(
  JSON.stringify({
    words: words.length,
    chunks: manifest.chunks.length,
    sourceBytes: Buffer.byteLength(input),
    outputBytes: [...files.values()].reduce((sum, s) => sum + Buffer.byteLength(s), 0),
    initialBytes:
      Buffer.byteLength(files.get('index.json')) +
      manifest.chunks.reduce((sum, name) => sum + Buffer.byteLength(files.get(name)), 0),
    maxBytes: Math.max(...[...files.values()].map((s) => Buffer.byteLength(s))),
  }),
);
