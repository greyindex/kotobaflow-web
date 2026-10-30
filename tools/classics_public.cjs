// Public reading-library graph and immutable R2 audio descriptors (CLASSICS-01).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { CLASSICS_DIR, CLASSICS_AUDIO_BASE } = require('./release_files.cjs');

function classicsGraph(root, publicAudio) {
  const files = new Set();
  const indexes = new Map();
  const audio = [];
  function fail(file, message) {
    throw Object.assign(new Error(message + ': ' + file), { file });
  }
  function read(file) {
    const full = path.join(root, file);
    if (!fs.existsSync(full) || fs.lstatSync(full).isSymbolicLink() || !fs.lstatSync(full).isFile())
      fail(file, 'Missing or linked classics file');
    files.add(file);
    try {
      return JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch {
      fail(file, 'Invalid classics JSON');
    }
  }
  const catalogFile = CLASSICS_DIR + '/catalog.json';
  const catalog = read(catalogFile);
  if (catalog.schema !== 1 || !Array.isArray(catalog.books) || !catalog.books.length)
    fail(catalogFile, 'Invalid classics catalog');
  const books = new Set();
  for (const book of catalog.books) {
    if (!/^[a-z][a-z0-9_-]{0,31}$/.test(book.id) || books.has(book.id))
      fail(catalogFile, 'Invalid or repeated classics id');
    books.add(book.id);
    const folder = CLASSICS_DIR + '/' + book.id + '/';
    const indexFile = folder + 'index.json';
    const index = read(indexFile);
    if (
      index.schema !== 1 ||
      index.id !== book.id ||
      !Array.isArray(index.parts) ||
      !index.parts.length ||
      index.parts.length !== book.parts ||
      index.units !== book.units
    )
      fail(indexFile, 'Invalid classics index');
    const units = new Set();
    const parts = new Set();
    for (const [i, part] of index.parts.entries()) {
      if (!/^[0-9]{2,3}\.json$/.test(part.file) || parts.has(part.file) || part.n !== i + 1)
        fail(indexFile, 'Invalid or repeated classics part');
      parts.add(part.file);
      const partFile = folder + part.file;
      const data = read(partFile);
      if (
        data.schema !== 1 ||
        data.book !== book.id ||
        data.part !== part.n ||
        !Array.isArray(data.units) ||
        !data.units.length ||
        data.units.length !== part.units
      )
        fail(partFile, 'Invalid classics part');
      for (const unit of data.units) {
        if (typeof unit.id !== 'string' || !unit.id || units.has(unit.id))
          fail(partFile, 'Invalid or repeated classics unit');
        units.add(unit.id);
      }
    }
    if (units.size !== index.units || !!index.audio !== book.audio)
      fail(indexFile, 'Classics catalog counts disagree');
    if (index.audio) {
      const entry = index.audio;
      if (
        !Number.isFinite(entry.duration) ||
        entry.duration <= 0 ||
        !Array.isArray(entry.chunks) ||
        !entry.chunks.length ||
        entry.chunks.some(
          (chunk) =>
            !Number.isFinite(chunk.start) ||
            !Number.isFinite(chunk.end) ||
            chunk.start < 0 ||
            chunk.end <= chunk.start ||
            chunk.end > entry.duration + 1 ||
            !Array.isArray(chunk.spans) ||
            chunk.spans.some((span) => !Array.isArray(span) || !units.has(span[0])),
        )
      )
        fail(indexFile, 'Invalid classics audio timeline');
      if (publicAudio) {
        if (
          !/^[a-f0-9]{64}\.mp3$/.test(entry.file) ||
          entry.sha256 !== entry.file.slice(0, 64) ||
          !Number.isSafeInteger(entry.bytes) ||
          entry.bytes <= 0
        )
          fail(indexFile, 'Invalid public classics audio');
        audio.push({
          book: book.id,
          url: CLASSICS_AUDIO_BASE + book.id + '/' + entry.file,
          sha256: entry.sha256,
          bytes: entry.bytes,
        });
      } else {
        if (!/^[a-z0-9_-]{1,32}\.mp3$/.test(entry.file)) fail(indexFile, 'Invalid local classics audio');
        const source = path.join(root, folder, entry.file);
        if (!fs.existsSync(source) || fs.lstatSync(source).isSymbolicLink())
          fail(folder + entry.file, 'Missing or linked classics audio');
        const body = fs.readFileSync(source);
        const sha256 = crypto.createHash('sha256').update(body).digest('hex');
        if (body.subarray(0, 100).toString().startsWith('version https://git-lfs.github.com/spec/v1'))
          fail(folder + entry.file, 'Classics audio is an LFS pointer');
        index.audio = { ...entry, file: sha256 + '.mp3', sha256, bytes: body.length };
        audio.push({
          book: book.id,
          source,
          key: 'classics/v1/' + book.id + '/' + sha256 + '.mp3',
          url: CLASSICS_AUDIO_BASE + book.id + '/' + sha256 + '.mp3',
          sha256,
          bytes: body.length,
        });
      }
    }
    indexes.set(indexFile, JSON.stringify(index));
  }
  return { files, indexes, audio };
}

module.exports = { classicsGraph };
