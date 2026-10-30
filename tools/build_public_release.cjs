const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  ROOT_FILES,
  AUDIO_DIRS,
  KANA_AUDIO_DIR,
  PUBLIC_TEXTBOOKS,
  UNIT_IMAGE_DIR,
  NOTICES,
  isRuntimePath,
  omitUnreferencedChunks,
  omitUnreferencedExampleAudio,
  CLASSICS_DIR,
  CLASSICS_AUDIO_BASE,
} = require('./release_files.cjs');
const { classicsGraph } = require('./classics_public.cjs');
const { checkRelease, withheldPassages } = require('./check_public_release.cjs');
const { buildManifest, source: manifestSource } = require('./generate_sw_manifest.cjs');

const CONTENT_CONFIG = 'js/content-config.js';
const OFFERED_LINE = /^(\s*)var offered = (?:null|\[[^\r\n;]*\]);.*$/m;
const CLASSICS_AUDIO_LINE = /^(\s*)var classicsAudioBase = '';.*$/m;
const hash = (body) => crypto.createHash('sha256').update(body).digest('hex');

// The public package offers the original curriculum (PUB-05) and reading-library
// JSON; full classics narrations are served from immutable R2 URLs.
function publicContentConfig(text) {
  if (!OFFERED_LINE.test(text)) throw new Error('Cannot find the offered-books line in ' + CONTENT_CONFIG);
  if (!CLASSICS_AUDIO_LINE.test(text))
    throw new Error('Cannot find the classics audio base in ' + CONTENT_CONFIG);
  return text
    .replace(
      OFFERED_LINE,
      (line, indent) =>
        indent + 'var offered = ' + JSON.stringify(PUBLIC_TEXTBOOKS) + '; // public package (PUB-05)',
    )
    .replace(
      CLASSICS_AUDIO_LINE,
      (line, indent) => indent + 'var classicsAudioBase = ' + JSON.stringify(CLASSICS_AUDIO_BASE) + ';',
    );
}

function isBlocked(file, policy) {
  return policy.blockedPaths.some((p) => file === p || file.startsWith(p + '/'));
}

// The legacy word recordings (AUDIO_DIRS[1]) were made for the XinBian lesson
// lists; KotobaFlow reuses part of them by index. Publish only those recordings
// and a matching audio index, which also keeps the package under the Pages
// file limit. Returns generated files (path -> content) that replace sources.
function keepReusedWordAudio(root, files) {
  const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  const books = 'data/textbook/book_chunks/';
  const used = new Set();
  for (const book of PUBLIC_TEXTBOOKS) {
    for (const file of Object.values(read(books + book + '.json').vocabulary || {})) {
      for (const row of read(books + file))
        if (row && row.vocab_audio_index !== undefined && row.vocab_audio_index !== null)
          used.add(String(parseInt(row.vocab_audio_index, 10)));
    }
  }
  const folder = 'data/textbook/audio_chunks/';
  const index = read(folder + 'index.json');
  const generated = new Map();
  const chunks = {};
  const keep = new Set();
  for (const [bucket, file] of Object.entries(index.chunks)) {
    const rows = {};
    for (const [id, url] of Object.entries(read(folder + file)))
      if (used.has(id)) {
        rows[id] = url;
        keep.add(AUDIO_DIRS[1] + '/' + url);
      }
    if (!Object.keys(rows).length) continue;
    const body = JSON.stringify(rows);
    chunks[bucket] = hash(body) + '.json';
    generated.set(folder + chunks[bucket], body);
  }
  generated.set(folder + 'index.json', JSON.stringify({ ...index, chunks }));
  for (const file of [...files])
    if (file.startsWith(folder) || (file.startsWith(AUDIO_DIRS[1] + '/') && !keep.has(file)))
      files.delete(file);
  for (const file of generated.keys()) files.add(file);
  return generated;
}

function buildRelease(root, directory) {
  root = fs.realpathSync(root);
  directory = path.resolve(directory);
  if (fs.existsSync(directory))
    throw new Error('Choose a new staging directory; previous releases are never overwritten');
  const relative = path.relative(root, directory);
  if (
    !relative ||
    (!relative.startsWith('..' + path.sep) &&
      !path.isAbsolute(relative) &&
      !relative.startsWith('local' + path.sep))
  )
    throw new Error('Use a staging directory outside the repository or under ignored local/');
  const files = new Set(ROOT_FILES.concat(NOTICES, ['vendor/cytoscape.min.js', 'privacy.html']));
  function visit(folder, prefix) {
    if (!fs.existsSync(folder)) return;
    if (fs.lstatSync(folder).isSymbolicLink()) throw new Error('Linked input directory is not supported');
    for (const item of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = prefix + '/' + item.name;
      if (item.isSymbolicLink()) throw new Error('Linked input is not supported: ' + file);
      if (item.isDirectory()) visit(path.join(folder, item.name), file);
      else if (item.isFile() && isRuntimePath(file)) files.add(file);
    }
  }
  for (const dir of ['js', 'image', 'resources/brand', 'data']) visit(path.join(root, dir), dir);
  const policy = JSON.parse(
    fs.readFileSync(path.join(root, 'resources/licenses/public-release-policy.json'), 'utf8'),
  );
  // Locally kept resources (the XinBian books) never enter the package; their
  // lesson chunks then become unreachable and are omitted with the stale ones.
  for (const file of [...files]) if (isBlocked(file, policy)) files.delete(file);
  omitUnreferencedChunks(root, files);
  if (!omitUnreferencedExampleAudio(root, files))
    console.warn('No example audio packs; run tools/build_example_audio_packs.cjs to publish them.');
  for (const dir of AUDIO_DIRS) {
    if (isBlocked(dir, policy)) continue;
    const index =
      dir === KANA_AUDIO_DIR
        ? dir + '/clips.json'
        : dir.endsWith('word_audio_v1')
          ? dir + '/words.json'
          : dir + '/manifest.jsonl';
    if (
      (!isBlocked(index, policy) && !files.has(index)) ||
      ![...files].some((file) => file.startsWith(dir + '/') && file.endsWith('.ogg'))
    )
      throw new Error('Restore the existing local Ogg pack before publishing: ' + dir);
  }
  if (!files.has(UNIT_IMAGE_DIR + '/images.json'))
    throw new Error('Install the KotobaFlow unit images before publishing: ' + UNIT_IMAGE_DIR);
  for (const book of PUBLIC_TEXTBOOKS)
    if (!files.has('data/textbook/book_chunks/' + book + '.json'))
      throw new Error('Missing public textbook catalog: ' + book);
  const generated = keepReusedWordAudio(root, files);
  const classics = classicsGraph(root, false);
  for (const file of [...files])
    if (file.startsWith(CLASSICS_DIR + '/') && !classics.files.has(file)) files.delete(file);
  for (const file of classics.files) files.add(file);
  for (const [file, body] of classics.indexes) generated.set(file, body);
  // All sources are checked before creating the new staging directory.
  for (const file of files)
    if (generated.has(file)) continue;
    else if (!fs.existsSync(path.join(root, file)) || fs.lstatSync(path.join(root, file)).isSymbolicLink())
      throw new Error('Missing or linked release input: ' + file);
  fs.mkdirSync(directory, { recursive: true });
  for (const file of [...files].sort()) {
    const destination = path.join(directory, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (generated.has(file)) fs.writeFileSync(destination, generated.get(file));
    else if (file === CONTENT_CONFIG)
      fs.writeFileSync(destination, publicContentConfig(fs.readFileSync(path.join(root, file), 'utf8')));
    else fs.copyFileSync(path.join(root, file), destination);
  }
  // The offline manifest must describe this package, not the full local tree.
  fs.writeFileSync(
    path.join(directory, 'sw-manifest.js'),
    manifestSource(buildManifest(directory, { checksumsFrom: root })),
  );
  const result = checkRelease(directory, policy, { withheld: withheldPassages(root) });
  const receipt = directory + '.manifest.json';
  fs.writeFileSync(receipt, JSON.stringify({ createdAt: new Date().toISOString(), ...result }, null, 2));
  if (!result.allowed) throw new Error('Staging check failed; see the private receipt: ' + receipt);
  return {
    directory,
    receipt,
    files: result.count,
    bytes: result.files.reduce((sum, f) => sum + f.bytes, 0),
    reminders: result.warnings.length,
  };
}
if (require.main === module) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: npm run release:build -- <new-staging-directory>');
    console.log(JSON.stringify(buildRelease(path.resolve(__dirname, '..'), process.argv[2])));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { buildRelease, publicContentConfig };
