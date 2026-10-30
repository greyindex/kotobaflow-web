// A small-project release check: package safety and integrity block; provenance reminders do not.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  isRuntimePath,
  ROOT_FILES,
  AUDIO_DIRS,
  KANA_AUDIO_DIR,
  PUBLIC_TEXTBOOKS,
  WITHHELD_TEXTBOOKS,
  UNIT_IMAGE_DIR,
  CLASSICS_DIR,
  CLASSICS_AUDIO_BASE,
} = require('./release_files.cjs');
const { classicsGraph } = require('./classics_public.cjs');

// PUB-FIX-04: withheld books must not reach the package through the page shell
// either (an inline sample once quoted XinBian 1). Compare whole sentences with
// kana, ignoring spacing; set phrases the public course also uses do not count.
const SENTENCE_BREAK = /[。！？!?\n"'`<>]/;
function passageKey(text) {
  const key = text.replace(/\s+/g, '');
  return key.length >= 10 && /[぀-ヿ]/.test(key) ? key : '';
}
function lessonPassages(root, books) {
  const folder = path.join(root, 'data/textbook/book_chunks');
  const passages = new Set();
  const walk = (value) => {
    if (typeof value === 'string') {
      for (const part of value.split(SENTENCE_BREAK)) if (passageKey(part)) passages.add(passageKey(part));
    } else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  for (const book of books) {
    const catalog = JSON.parse(fs.readFileSync(path.join(folder, book + '.json'), 'utf8'));
    for (const file of Object.values(catalog.lessons || {}))
      walk(JSON.parse(fs.readFileSync(path.join(folder, file), 'utf8')));
  }
  return passages;
}
function withheldPassages(root) {
  const passages = lessonPassages(root, WITHHELD_TEXTBOOKS);
  for (const shared of lessonPassages(root, PUBLIC_TEXTBOOKS)) passages.delete(shared);
  if (!passages.size) throw new Error('No withheld textbook text found');
  return passages;
}
function withheldTextIn(text, passages) {
  return text
    .replace(/<[^>]*>/g, '\n')
    .split(SENTENCE_BREAK)
    .map(passageKey)
    .filter((key) => key && passages.has(key));
}

function checkRelease(directory, policy, options = {}) {
  if (policy.version !== 2 || !Array.isArray(policy.pendingFamilies) || !Array.isArray(policy.blockedPaths))
    throw new Error('Invalid public-release policy');
  const safePath = (value) =>
    typeof value === 'string' &&
    value &&
    !value.includes('\\') &&
    !value.split('/').some((part) => !part || part === '.' || part === '..');
  if (!policy.blockedPaths.every(safePath)) throw new Error('Invalid blocked path');
  if (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink())
    throw new Error('Release must be a real directory');
  const failures = [],
    files = [],
    present = new Set();
  let externalAudio = [];
  function visit(folder, prefix = '') {
    for (const item of fs.readdirSync(folder, { withFileTypes: true })) {
      const relative = prefix + item.name,
        full = path.join(folder, item.name);
      if (item.isSymbolicLink()) failures.push({ path: relative, reason: 'symbolic-link' });
      else if (item.isDirectory()) visit(full, relative + '/');
      else if (item.isFile()) {
        present.add(relative);
        const bytes = fs.readFileSync(full);
        files.push({
          path: relative,
          bytes: bytes.length,
          sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        });
        if (!isRuntimePath(relative))
          failures.push({ path: relative, reason: 'non-runtime-or-private-file' });
        if (policy.blockedPaths.some((p) => relative === p || relative.startsWith(p + '/')))
          failures.push({ path: relative, reason: 'blocked-resource' });
        if (bytes.length > 25 * 1024 * 1024)
          failures.push({ path: relative, reason: 'pages-file-too-large' });
        if (bytes.subarray(0, 200).toString('utf8').startsWith('version https://git-lfs.github.com/spec/v1'))
          failures.push({ path: relative, reason: 'lfs-pointer' });
        if (/\.(?:js|html|css|json|jsonl|md|txt)$/.test(relative)) {
          const text = bytes.toString('utf8');
          if (
            /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|"(?:private_key|client_secret|refresh_token)"\s*:\s*"[^"\s]+"|\b(?:GOCSPX-|ghp_)[A-Za-z0-9_-]{20,}/.test(
              text,
            )
          )
            failures.push({ path: relative, reason: 'credential-pattern' });
          if (
            options.withheld &&
            !relative.startsWith('data/') &&
            /\.(?:html|js|css)$/.test(relative) &&
            withheldTextIn(text, options.withheld).length
          )
            failures.push({ path: relative, reason: 'withheld-textbook-text' });
        }
      } else failures.push({ path: relative, reason: 'unsupported-file' });
    }
  }
  visit(directory);
  if (!files.length) failures.push({ path: '', reason: 'empty-release' });
  if (files.length > 20000) failures.push({ path: '', reason: 'pages-file-count' });
  for (const file of ROOT_FILES)
    if (!present.has(file)) failures.push({ path: file, reason: 'missing-entry' });
  function reference(value, from) {
    if (typeof value !== 'string' || /^(?:https?:|data:|#|\/\/)/.test(value)) return;
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(from), value.split(/[?#]/)[0]));
    if (resolved.startsWith('../') || !present.has(resolved))
      failures.push({ path: resolved, reason: 'missing-reference' });
  }
  for (const file of [...present].filter((name) => name.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(directory, file), 'utf8');
    for (const tag of html.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
      const match = tag[0].match(/\b(?:src|href)\s*=\s*["']([^"']+)["']/i);
      if (match) reference(match[1], /<base\s+href=["']\/["']\s*>/i.test(html) ? 'index.html' : file);
    }
  }
  // Follow the content-addressed runtime indexes and the audio paths actually used by the loaders.
  for (const file of present) {
    if (
      !/^data\/(?:vocab_chunks|grammar_chunks|textbook\/(?:book_chunks|audio_chunks))\/.+\.json$/.test(file)
    )
      continue;
    try {
      const walk = (value) => {
        if (typeof value === 'string') {
          if (/^(?:(?:vocab|text|wiki|grammar|detail)-)?[a-f0-9]{64}\.json$/.test(value))
            reference(value, file);
          else if (/^\.?\/?image\/.+\.(?:png|webp)$/.test(value))
            reference(value.replace(/^\.?\//, ''), 'index.html');
          else if (file.startsWith('data/textbook/audio_chunks/') && /^audio\/.+\.ogg$/.test(value))
            reference(AUDIO_DIRS[1] + '/' + value, 'index.html');
        } else if (value && typeof value === 'object') Object.values(value).forEach(walk);
      };
      walk(JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8')));
    } catch (error) {
      failures.push({ path: file, reason: 'invalid-runtime-json' });
    }
  }
  for (const dir of AUDIO_DIRS) {
    const manifest = dir + '/manifest.jsonl';
    if (!present.has(manifest)) continue;
    try {
      const rows = fs
        .readFileSync(path.join(directory, manifest), 'utf8')
        .split(/\r?\n/)
        .filter((line) => line.trim());
      for (const line of rows) {
        const row = JSON.parse(line);
        if (row.status && row.status !== 'ok') continue;
        if (row.audio_relpath) reference(row.audio_relpath.replace(/\.wav$/i, '.ogg'), manifest);
        for (const field of ['output', 'manifest']) {
          const value = String(row[field] || '').replace(/\\/g, '/');
          const start = value.indexOf(dir + '/');
          if (start >= 0) reference(value.slice(start).replace(/\.wav$/i, '.ogg'), 'index.html');
        }
      }
    } catch (error) {
      failures.push({ path: manifest, reason: 'invalid-audio-manifest' });
    }
  }
  // PUB-FIX-02: chapter 0 is shipped with KotobaFlow1 even when its ignored local
  // audio pack was never installed. Do not let an absent index skip validation.
  const kanaIndex = KANA_AUDIO_DIR + '/clips.json';
  if (
    present.has('data/textbook/book_chunks/KotobaFlow1.json') ||
    [...present].some((file) => file.startsWith(KANA_AUDIO_DIR + '/'))
  ) {
    if (!present.has(kanaIndex)) failures.push({ path: kanaIndex, reason: 'missing-reference' });
    else {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(directory, kanaIndex), 'utf8'));
        if (data.schema !== 1 || data.chapter !== 0 || !Array.isArray(data.clips) || data.clips.length !== 92)
          throw new Error('Invalid kana index');
        const ids = new Set();
        for (const clip of data.clips) {
          if (
            !clip ||
            !/^C00-[KW](?:0[1-9]|[1-3][0-9]|4[0-6])$/.test(clip.id) ||
            ids.has(clip.id) ||
            clip.audio_relpath !== 'clips/' + clip.id + '.ogg' ||
            !/^[a-f0-9]{64}$/.test(clip.audio_sha256)
          )
            throw new Error('Invalid kana clip');
          ids.add(clip.id);
          reference(clip.audio_relpath, kanaIndex);
          const file = KANA_AUDIO_DIR + '/' + clip.audio_relpath;
          const entry = files.find((item) => item.path === file);
          if (entry && entry.sha256 !== clip.audio_sha256)
            failures.push({ path: file, reason: 'kana-audio-hash-mismatch' });
        }
      } catch (error) {
        failures.push({ path: kanaIndex, reason: 'invalid-kana-index' });
      }
    }
  }
  if (present.has('sw-manifest.js')) {
    try {
      const source = fs.readFileSync(path.join(directory, 'sw-manifest.js'), 'utf8');
      const manifest = JSON.parse(
        source
          .slice(source.indexOf(' = ') + 3)
          .trim()
          .replace(/;$/, ''),
      );
      if (manifest.schema !== 1 || !Array.isArray(manifest.required)) throw new Error('Invalid manifest');
      for (const entry of [...manifest.required, ...(manifest.optional || []), ...(manifest.data || [])]) {
        reference(entry.url, 'sw-manifest.js');
        const file = entry.url.replace(/^\.\//, '');
        if (present.has(file) && !entry.dynamic) {
          const body = fs.readFileSync(path.join(directory, file), 'utf8').replace(/\r\n/g, '\n');
          if (crypto.createHash('sha256').update(body).digest('hex') !== entry.sha256)
            failures.push({ path: file, reason: 'stale-offline-manifest' });
        }
      }
    } catch (error) {
      failures.push({ path: 'sw-manifest.js', reason: 'invalid-offline-manifest' });
    }
  }
  // PUB-05: the public site offers only the original curriculum, each with its catalog.
  if (present.has('js/content-config.js')) {
    const config = fs.readFileSync(path.join(directory, 'js/content-config.js'), 'utf8');
    const match = config.match(/^\s*var offered = (\[[^\]]*\]);/m);
    let offered = null;
    try {
      offered = match ? JSON.parse(match[1]) : null;
    } catch (error) {
      offered = null;
    }
    if (
      !Array.isArray(offered) ||
      !offered.length ||
      offered.some((book) => !PUBLIC_TEXTBOOKS.includes(book))
    )
      failures.push({ path: 'js/content-config.js', reason: 'non-public-textbooks-offered' });
    else offered.forEach((book) => reference('data/textbook/book_chunks/' + book + '.json', 'index.html'));
    if (/^\s*var classics = true;/m.test(config)) {
      const audioBase = config.match(/^\s*var classicsAudioBase = ("[^"]*");/m);
      if (!audioBase || JSON.parse(audioBase[1]) !== CLASSICS_AUDIO_BASE)
        failures.push({ path: 'js/content-config.js', reason: 'classics-audio-origin' });
      try {
        const classics = classicsGraph(directory, true);
        externalAudio = classics.audio;
        for (const file of present)
          if (file.startsWith(CLASSICS_DIR + '/') && !classics.files.has(file))
            failures.push({ path: file, reason: 'unreferenced-classics-file' });
      } catch (error) {
        failures.push({ path: error.file || CLASSICS_DIR, reason: 'invalid-classics-library' });
      }
    } else if ([...present].some((file) => file.startsWith(CLASSICS_DIR + '/')))
      failures.push({ path: CLASSICS_DIR, reason: 'classics-disabled-with-data' });
  }
  for (const [index, pattern] of [
    ['data/kotobaflow_word_audio_v1/words.json', 'words'],
    [UNIT_IMAGE_DIR + '/images.json', 'images'],
  ]) {
    if (!present.has(index)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(directory, index), 'utf8'));
      Object.values(data[pattern] || {}).forEach((entry) => {
        if (entry && typeof entry.file === 'string') reference(entry.file, index);
      });
    } catch (error) {
      failures.push({ path: index, reason: 'invalid-runtime-json' });
    }
  }
  if (present.has('js/storage-config.js')) {
    const config = fs.readFileSync(path.join(directory, 'js/storage-config.js'), 'utf8');
    if (/mode\s*:\s*['"]local-api['"]/.test(config))
      failures.push({ path: 'js/storage-config.js', reason: 'local-api-in-public-release' });
  }
  return {
    count: files.length,
    failures,
    warnings: policy.pendingFamilies.map((family) => ({ family, reason: 'provenance-follow-up' })),
    files,
    externalAudio,
    allowed: failures.length === 0,
  };
}

if (require.main === module) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: npm run release:check -- <staging-directory>');
    const policy = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../resources/licenses/public-release-policy.json'), 'utf8'),
    );
    const result = checkRelease(path.resolve(process.argv[2]), policy, {
      withheld: withheldPassages(path.join(__dirname, '..')),
    });
    // Never print file contents, credentials, or personal progress.
    console.log(
      JSON.stringify({
        allowed: result.allowed,
        files: result.count,
        blocked: result.failures.length,
        reminders: result.warnings.length,
      }),
    );
    if (result.warnings.length)
      console.warn(
        'Resource provenance reminders remain in public-release-policy.json; these are not license approvals.',
      );
    if (!result.allowed) console.error(JSON.stringify(result.failures.slice(0, 30)));
    process.exitCode = result.allowed ? 0 : 1;
  } catch (error) {
    console.error('Release check failed. Verify staging path and policy schema.');
    process.exitCode = 1;
  }
}
module.exports = { checkRelease, withheldPassages, withheldTextIn };
