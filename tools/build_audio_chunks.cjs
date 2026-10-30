const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'data/gcloud_chirp3_vocab6127_female_aoede_v1/manifest.jsonl');
const output = path.join(root, 'data/textbook/audio_chunks');
const hash = (body) => crypto.createHash('sha256').update(body).digest('hex');
const validPath = (value) => typeof value === 'string' && /^audio\/[0-9]{2}xxx\/[0-9]{5}\.ogg$/.test(value);
const check = process.argv.includes('--check');
if (!fs.existsSync(source)) {
  if (!check) throw Error('Restore the local textbook audio manifest before generating');
  const index = JSON.parse(fs.readFileSync(path.join(output, 'index.json'), 'utf8'));
  if (index.schema !== 1 || index.bucketSize !== 256) throw Error('Invalid audio index');
  for (const [bucket, file] of Object.entries(index.chunks)) {
    if (!/^[a-f0-9]{64}\.json$/.test(file)) throw Error('Invalid audio chunk path');
    const body = fs.readFileSync(path.join(output, file), 'utf8');
    if (hash(body) + '.json' !== file) throw Error('Audio chunk hash mismatch');
    for (const [id, url] of Object.entries(JSON.parse(body))) {
      if (String(Math.floor(Number(id) / 256)) !== bucket || !validPath(url))
        throw Error('Invalid audio row');
    }
  }
  console.log(
    'Local audio source absent: committed chunk structure/hash verified; source equality not checked.',
  );
} else {
  const input = fs.readFileSync(source, 'utf8');
  const rows = new Map();
  for (const line of input.split(/\r?\n/).filter((s) => s.trim())) {
    const row = JSON.parse(line),
      id = parseInt(row && row.index, 10);
    if (!Number.isNaN(id)) rows.set(id, row); // Preserve the original last-row-wins rule.
  }
  const buckets = {};
  for (const [id, row] of rows) {
    if (!row.audio_relpath) continue;
    const url = row.audio_relpath.replace(/\.wav$/i, '.ogg');
    if (!validPath(url)) throw Error('Unexpected audio path for index ' + id);
    const key = Math.floor(id / 256);
    (buckets[key] ||= {})[id] = url;
  }
  const files = new Map();
  const index = {
    schema: 1,
    bucketSize: 256,
    base: './data/gcloud_chirp3_vocab6127_female_aoede_v1/',
    sourceSha256: hash(input.replace(/\r\n/g, '\n')),
    chunks: {},
  };
  for (const [bucket, rows] of Object.entries(buckets)) {
    const body = JSON.stringify(rows),
      file = hash(body) + '.json';
    index.chunks[bucket] = file;
    files.set(file, body);
  }
  files.set('index.json', JSON.stringify(index));
  if (!check) fs.mkdirSync(output, { recursive: true });
  for (const [file, body] of files) {
    const target = path.join(output, file);
    if (check) {
      if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== body)
        throw Error('Audio index stale; run npm run resources:audio');
    } else fs.writeFileSync(target, body);
  }
  console.log(
    JSON.stringify({
      sourceBytes: Buffer.byteLength(input),
      entries: rows.size,
      chunks: files.size - 1,
      indexBytes: Buffer.byteLength(files.get('index.json')),
      largestChunkBytes: Math.max(
        ...[...files].filter(([f]) => f !== 'index.json').map(([, body]) => Buffer.byteLength(body)),
      ),
    }),
  );
}
