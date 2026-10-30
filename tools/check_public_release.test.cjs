const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { checkRelease, withheldPassages, withheldTextIn } = require('./check_public_release.cjs');
const { ROOT_FILES, omitUnreferencedChunks } = require('./release_files.cjs');
const { buildManifest } = require('./generate_sw_manifest.cjs');
const policy = () => ({ version: 2, blockedPaths: [], pendingFamilies: ['Textbook source follow-up'] });
const KANA_DIR = 'data/gemini38_flash_tts_kotobaflow_kana_candidate_v1';
function classicsFixture(dir, publicAudio = true) {
  const body = Buffer.from('ID3-classics-fixture');
  const sha256 = require('node:crypto').createHash('sha256').update(body).digest('hex');
  const write = (file, data) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), Buffer.isBuffer(data) ? data : JSON.stringify(data));
  };
  const base = 'data/classics_v1/';
  write(base + 'catalog.json', { schema: 1, books: [{ id: 'taketori', parts: 1, units: 1, audio: true }] });
  write(base + 'taketori/index.json', {
    schema: 1,
    id: 'taketori',
    units: 1,
    parts: [{ n: 1, file: '01.json', units: 1 }],
    audio: {
      file: publicAudio ? sha256 + '.mp3' : 'audio.mp3',
      duration: 2,
      chunks: [{ start: 0, end: 2, spans: [['TK-1', 0, 1]] }],
      ...(publicAudio ? { sha256, bytes: body.length } : {}),
    },
  });
  write(base + 'taketori/01.json', {
    schema: 1,
    book: 'taketori',
    part: 1,
    units: [{ id: 'TK-1', modern: '竹' }],
  });
  if (!publicAudio) write(base + 'taketori/audio.mp3', body);
  return { sha256, bytes: body.length };
}
function kanaFixture(dir) {
  const clips = [];
  fs.mkdirSync(path.join(dir, KANA_DIR, 'clips'), { recursive: true });
  for (const kind of ['K', 'W']) {
    for (let number = 1; number <= 46; number++) {
      const id = 'C00-' + kind + String(number).padStart(2, '0');
      const bytes = Buffer.from('OggS' + id);
      const audio_relpath = 'clips/' + id + '.ogg';
      fs.writeFileSync(path.join(dir, KANA_DIR, audio_relpath), bytes);
      clips.push({
        id,
        audio_relpath,
        audio_sha256: require('node:crypto').createHash('sha256').update(bytes).digest('hex'),
      });
    }
  }
  const index = { schema: 1, chapter: 0, clips };
  fs.writeFileSync(path.join(dir, KANA_DIR, 'clips.json'), JSON.stringify(index));
  return index;
}

test('classics public graph keeps the timeline and uses immutable R2 audio without publishing MP3', (t) => {
  const { classicsGraph } = require('./classics_public.cjs');
  const { isRuntimePath } = require('./release_files.cjs');
  const dir = fixture(t);
  const expected = classicsFixture(dir, false);
  const sourceIndex = fs.readFileSync(path.join(dir, 'data/classics_v1/taketori/index.json'), 'utf8');
  const graph = classicsGraph(dir, false);
  assert.equal(graph.files.size, 3);
  assert.equal(graph.audio[0].sha256, expected.sha256);
  assert.equal(graph.audio[0].bytes, expected.bytes);
  assert.equal(
    graph.audio[0].url,
    'https://audio.kotobaflow.lol/classics/v1/taketori/' + expected.sha256 + '.mp3',
  );
  assert.deepEqual(
    JSON.parse(graph.indexes.get('data/classics_v1/taketori/index.json')).audio.chunks,
    JSON.parse(sourceIndex).audio.chunks,
  );
  assert.equal(fs.readFileSync(path.join(dir, 'data/classics_v1/taketori/index.json'), 'utf8'), sourceIndex);
  assert.equal(isRuntimePath('data/classics_v1/taketori/01.json'), true);
  for (const file of ['audio.mp3', '../secret.json', 'summary.json', '01.json.bak'])
    assert.equal(isRuntimePath('data/classics_v1/taketori/' + file), false);
});

test('classics publication rejects incomplete parts, mismatched audio hashes and an unexpected audio origin', (t) => {
  const { classicsGraph } = require('./classics_public.cjs');
  const { publicContentConfig } = require('./build_public_release.cjs');
  const dir = fixture(t);
  classicsFixture(dir);
  assert.equal(classicsGraph(dir, true).audio.length, 1);
  const file = path.join(dir, 'data/classics_v1/taketori/index.json');
  const original = fs.readFileSync(file, 'utf8');
  const index = JSON.parse(original);
  index.audio.sha256 = 'b'.repeat(64);
  fs.writeFileSync(file, JSON.stringify(index));
  assert.throws(() => classicsGraph(dir, true), /Invalid public classics audio/);
  fs.writeFileSync(file, original);
  fs.unlinkSync(path.join(dir, 'data/classics_v1/taketori/01.json'));
  assert.throws(() => classicsGraph(dir, true), /Missing or linked classics file/);
  classicsFixture(dir);
  const config = publicContentConfig(
    fs.readFileSync(path.join(__dirname, '../js/content-config.js'), 'utf8'),
  );
  fs.mkdirSync(path.join(dir, 'js'));
  fs.writeFileSync(
    path.join(dir, 'js/content-config.js'),
    config.replace('audio.kotobaflow.lol', 'other.example'),
  );
  assert.ok(checkRelease(dir, policy()).failures.some((e) => e.reason === 'classics-audio-origin'));
});
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kotobaflow-release-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const name of ROOT_FILES) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), 'fixture');
  }
  fs.writeFileSync(
    path.join(dir, 'sw-manifest.js'),
    'self.JPLearnShellManifest = ' + JSON.stringify({ schema: 1, required: [] }) + ';\n',
  );
  return dir;
}

test('release keeps the current nested chunk graph while preserving historical source files locally', (t) => {
  const dir = fixture(t);
  const folder = 'data/textbook/book_chunks';
  fs.mkdirSync(path.join(dir, folder), { recursive: true });
  const index = folder + '/XinBian1.index.json';
  const current = folder + '/text-' + 'a'.repeat(64) + '.json';
  const nested = folder + '/vocab-' + 'b'.repeat(64) + '.json';
  const stale = folder + '/text-' + 'c'.repeat(64) + '.json';
  fs.writeFileSync(path.join(dir, index), JSON.stringify({ lesson_02: path.posix.basename(current) }));
  fs.writeFileSync(path.join(dir, current), JSON.stringify({ child: path.posix.basename(nested) }));
  fs.writeFileSync(path.join(dir, nested), '{}');
  fs.writeFileSync(path.join(dir, stale), '{}');
  const files = new Set([index, current, nested, stale, 'style.css']);
  omitUnreferencedChunks(dir, files);
  assert.deepEqual([...files], [index, current, nested, 'style.css']);
  assert.equal(fs.existsSync(path.join(dir, stale)), true);
  const manifestPaths = buildManifest(dir).data.map((entry) => entry.url.slice(2));
  assert.ok(manifestPaths.includes(current) && manifestPaths.includes(nested));
  assert.equal(manifestPaths.includes(stale), false);
  fs.writeFileSync(path.join(dir, current), JSON.stringify({ missing: 'd'.repeat(64) + '.json' }));
  omitUnreferencedChunks(dir, files);
  assert.equal(files.has(current), true);
  assert.equal(files.has(nested), false);
  assert.ok(checkRelease(dir, policy()).failures.some((entry) => entry.reason === 'missing-reference'));
});
test('ordinary source changes pass without per-file rights approvals; reminders stay visible', (t) => {
  const dir = fixture(t);
  assert.equal(checkRelease(dir, policy()).allowed, true);
  fs.writeFileSync(path.join(dir, 'style.css'), 'body { color: #123; }');
  const result = checkRelease(dir, policy());
  assert.equal(result.allowed, true);
  assert.equal(result.warnings.length, 1);
  assert.match(result.files.find((f) => f.path === 'style.css').sha256, /^[a-f0-9]{64}$/);
});
test('private progress, credentials, LFS pointers and explicit resource blocks still fail', (t) => {
  const dir = fixture(t);
  fs.mkdirSync(path.join(dir, 'data'));
  fs.writeFileSync(path.join(dir, 'data/user_progress.json'), '{"private":"PRIVATE_TEST_SENTINEL"}');
  assert.equal(checkRelease(dir, policy()).allowed, false);
  const cli = spawnSync(process.execPath, [path.join(__dirname, 'check_public_release.cjs'), dir], {
    encoding: 'utf8',
  });
  assert.equal(cli.status, 1);
  assert.equal((cli.stdout + cli.stderr).includes('PRIVATE_TEST_SENTINEL'), false);
  fs.unlinkSync(path.join(dir, 'data/user_progress.json'));
  fs.writeFileSync(path.join(dir, 'style.css'), 'version https://git-lfs.github.com/spec/v1\n');
  assert.ok(checkRelease(dir, policy()).failures.some((e) => e.reason === 'lfs-pointer'));
  fs.writeFileSync(path.join(dir, 'style.css'), '"client_secret": "PRIVATE_TEST_SENTINEL"');
  assert.ok(checkRelease(dir, policy()).failures.some((e) => e.reason === 'credential-pattern'));
  fs.writeFileSync(path.join(dir, 'style.css'), '');
  assert.ok(
    checkRelease(dir, { ...policy(), blockedPaths: ['style.css'] }).failures.some(
      (e) => e.reason === 'blocked-resource',
    ),
  );
  assert.throws(() => checkRelease(dir, { ...policy(), blockedPaths: ['../outside'] }));
});
test('missing entrypoints, broken shell references and stale offline hashes block release', (t) => {
  const dir = fixture(t);
  fs.unlinkSync(path.join(dir, '404.html'));
  assert.ok(checkRelease(dir, policy()).failures.some((e) => e.path === '404.html'));
  fs.writeFileSync(path.join(dir, '404.html'), '');
  fs.writeFileSync(path.join(dir, 'index.html'), '<script src="./js/missing.js?v=1"></script>');
  assert.ok(checkRelease(dir, policy()).failures.some((e) => e.reason === 'missing-reference'));
  fs.writeFileSync(path.join(dir, 'index.html'), '');
  fs.writeFileSync(
    path.join(dir, 'sw-manifest.js'),
    'self.JPLearnShellManifest = ' +
      JSON.stringify({
        schema: 1,
        required: [{ url: './style.css', sha256: '0'.repeat(64) }],
      }) +
      ';',
  );
  assert.ok(checkRelease(dir, policy()).failures.some((e) => e.reason === 'stale-offline-manifest'));
  fs.mkdirSync(path.join(dir, 'data/vocab_chunks'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'data/vocab_chunks/index.json'),
    JSON.stringify({ chunks: ['a'.repeat(64) + '.json'] }),
  );
  assert.ok(checkRelease(dir, policy()).failures.some((e) => e.path.endsWith('a'.repeat(64) + '.json')));
  const audio = 'data/gemini38_flash_tts_dialogue_sections_candidate_v1';
  fs.mkdirSync(path.join(dir, audio), { recursive: true });
  fs.writeFileSync(
    path.join(dir, audio, 'manifest.jsonl'),
    JSON.stringify({
      status: 'ok',
      output: audio + '/missing.wav',
      manifest: audio + '/XinBian1/01_lesson_01/conversation/manifest.json',
    }),
  );
  const missing = checkRelease(dir, policy()).failures;
  assert.ok(missing.some((e) => e.path === audio + '/missing.ogg'));
  assert.ok(missing.some((e) => e.path.endsWith('/conversation/manifest.json')));
});
test('directory links and over-size assets cannot enter a Pages release', (t) => {
  const dir = fixture(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'kotobaflow-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.symlinkSync(outside, path.join(dir, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.ok(checkRelease(dir, policy()).failures.some((e) => e.reason === 'symbolic-link'));
  fs.writeFileSync(path.join(dir, 'style.css'), Buffer.alloc(25 * 1024 * 1024 + 1));
  assert.ok(checkRelease(dir, policy()).failures.some((e) => e.reason === 'pages-file-too-large'));
});

test('FIX-12 every prefixed content reference must exist, independent of the SW manifest', (t) => {
  const dir = fixture(t);
  const names = ['vocab', 'text', 'wiki', 'grammar', 'detail'];
  for (const [i, prefix] of names.entries()) {
    const folder = prefix === 'detail' ? 'data/vocab_chunks' : 'data/textbook/book_chunks';
    fs.mkdirSync(path.join(dir, folder), { recursive: true });
    const name = prefix + '-' + String(i).repeat(64) + '.json';
    fs.writeFileSync(path.join(dir, folder, 'index.json'), JSON.stringify({ nested: { lesson_02: name } }));
    const missing = checkRelease(dir, policy());
    assert.equal(missing.allowed, false);
    assert.ok(
      missing.failures.some(
        (entry) => entry.path === folder + '/' + name && entry.reason === 'missing-reference',
      ),
    );
    fs.writeFileSync(path.join(dir, folder, name), '{}');
    assert.equal(checkRelease(dir, policy()).allowed, true);
  }
});

test('FIX-12 SW data entries enforce existence and hashes, including entries outside chunk indexes', (t) => {
  const dir = fixture(t);
  const name = 'data/grammar_index.json';
  const manifest = {
    schema: 1,
    required: [],
    data: [
      { url: './' + name, sha256: require('node:crypto').createHash('sha256').update('{}').digest('hex') },
    ],
  };
  fs.writeFileSync(
    path.join(dir, 'sw-manifest.js'),
    'self.JPLearnShellManifest = ' + JSON.stringify(manifest) + ';',
  );
  assert.ok(
    checkRelease(dir, policy()).failures.some(
      (entry) => entry.path === name && entry.reason === 'missing-reference',
    ),
  );
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(dir, name), '{"changed":true}');
  assert.ok(
    checkRelease(dir, policy()).failures.some(
      (entry) => entry.path === name && entry.reason === 'stale-offline-manifest',
    ),
  );
  fs.writeFileSync(path.join(dir, name), '{}');
  assert.equal(checkRelease(dir, policy()).allowed, true);
});

test('FIX-12 SW generation excludes canonical offline inputs that the public package cannot ship', (t) => {
  const dir = fixture(t);
  fs.mkdirSync(path.join(dir, 'resources/checksums'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'data/grammar_index.json'), '{}');
  fs.writeFileSync(
    path.join(dir, 'resources/checksums/canonical-assets.sha256'),
    '0'.repeat(64) +
      '  data/textbook/textbook_text_tokens.v1.json\n' +
      '1'.repeat(64) +
      '  data/grammar_index.json\n',
  );
  const manifest = buildManifest(dir);
  assert.deepEqual(
    manifest.data.map((entry) => entry.url),
    ['./data/grammar_index.json'],
  );
});

test('PUB-05 the public package must offer only the KotobaFlow catalogs it contains', (t) => {
  const { publicContentConfig } = require('./build_public_release.cjs');
  const dir = fixture(t);
  const source = fs.readFileSync(path.join(__dirname, '../js/content-config.js'), 'utf8');
  fs.mkdirSync(path.join(dir, 'js'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'js/content-config.js'), source);
  const local = checkRelease(dir, policy()).failures;
  assert.ok(local.some((e) => e.reason === 'non-public-textbooks-offered'));
  assert.ok(local.some((e) => e.reason === 'classics-audio-origin'));
  fs.writeFileSync(path.join(dir, 'js/content-config.js'), publicContentConfig(source));
  assert.match(publicContentConfig(source), /var classics = true;/);
  const missing = checkRelease(dir, policy()).failures;
  assert.ok(missing.some((e) => e.reason === 'invalid-classics-library'));
  assert.ok(missing.some((e) => e.path === 'data/textbook/book_chunks/KotobaFlow1.json'));
  fs.mkdirSync(path.join(dir, 'data/textbook/book_chunks'), { recursive: true });
  for (const n of [1, 2, 3, 4])
    fs.writeFileSync(path.join(dir, 'data/textbook/book_chunks/KotobaFlow' + n + '.json'), '{}');
  kanaFixture(dir);
  classicsFixture(dir);
  assert.equal(checkRelease(dir, policy()).allowed, true);
  const repoPolicy = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../resources/licenses/public-release-policy.json'), 'utf8'),
  );
  fs.writeFileSync(path.join(dir, 'data/textbook/book_chunks/XinBian1.json'), '{}');
  assert.ok(checkRelease(dir, repoPolicy).failures.some((e) => e.reason === 'blocked-resource'));
});

test('PUB-FIX-02 public chapter 0 requires its clip index even when all audio is absent', (t) => {
  const dir = fixture(t);
  fs.mkdirSync(path.join(dir, 'data/textbook/book_chunks'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'data/textbook/book_chunks/KotobaFlow1.json'), '{}');
  assert.ok(checkRelease(dir, policy()).failures.some((e) => e.path === KANA_DIR + '/clips.json'));
  kanaFixture(dir);
  assert.equal(checkRelease(dir, policy()).allowed, true);
  fs.unlinkSync(path.join(dir, KANA_DIR, 'clips/C00-W46.ogg'));
  assert.ok(
    checkRelease(dir, policy()).failures.some(
      (e) => e.path === KANA_DIR + '/clips/C00-W46.ogg' && e.reason === 'missing-reference',
    ),
  );
});

test('PUB-FIX-02 runtime allowlist accepts only the kana index and exact clip paths', () => {
  const { isRuntimePath } = require('./release_files.cjs');
  assert.equal(isRuntimePath(KANA_DIR + '/clips.json'), true);
  assert.equal(isRuntimePath(KANA_DIR + '/clips/C00-K01.ogg'), true);
  for (const file of [
    'clips/C00-K99.ogg',
    'clips/C00-X01.ogg',
    'clips/not-a-clip.ogg',
    'whole_unit.ogg',
    'clips/C00-K01.wav',
    'meta.json',
  ])
    assert.equal(isRuntimePath(KANA_DIR + '/' + file), false);
});

test('PUB-04-EXAMPLES release ships exactly the packs and shards the example index names', (t) => {
  const { EXAMPLE_AUDIO_DIR, isRuntimePath, omitUnreferencedExampleAudio } = require('./release_files.cjs');
  const dir = fixture(t);
  const pack = 'packs/' + 'a'.repeat(16) + '.ogg';
  const stale = 'packs/' + 'b'.repeat(16) + '.ogg';
  const shard = 'shards/0-' + 'c'.repeat(12) + '.json';
  const named = (name) => EXAMPLE_AUDIO_DIR + '/' + name;
  fs.mkdirSync(path.join(dir, EXAMPLE_AUDIO_DIR), { recursive: true });
  fs.writeFileSync(
    path.join(dir, named('index.json')),
    JSON.stringify({ schema: 1, packs: [pack], shards: [shard] }),
  );
  for (const name of ['index.json', pack, stale, shard]) assert.equal(isRuntimePath(named(name)), true);
  for (const name of ['packs/x.ogg', 'notes.txt', 'shards/0-c.json', 'packs/' + 'a'.repeat(16) + '.wav'])
    assert.equal(isRuntimePath(named(name)), false);
  const files = new Set([named('index.json'), named(pack), named(stale), named(shard), 'style.css']);
  assert.equal(omitUnreferencedExampleAudio(dir, files), true);
  assert.deepEqual([...files], [named('index.json'), named(pack), named(shard), 'style.css']);
  files.delete(named(shard));
  assert.throws(() => omitUnreferencedExampleAudio(dir, files), /missing file/);
  const withoutIndex = new Set([named(pack), 'style.css']);
  assert.equal(omitUnreferencedExampleAudio(dir, withoutIndex), false);
  assert.deepEqual([...withoutIndex], ['style.css']);
});
test('PUB-FIX-02 kana index rejects malformed, duplicate, unsafe and altered media references', (t) => {
  const dir = fixture(t);
  const good = kanaFixture(dir);
  const indexPath = path.join(dir, KANA_DIR, 'clips.json');
  for (const mutate of [
    (data) => {
      data.schema = 2;
    },
    (data) => {
      data.clips.pop();
    },
    (data) => {
      data.clips[1] = data.clips[0];
    },
    ...[
      '../outside.ogg',
      '/clips/C00-K01.ogg',
      'https://example.com/audio.ogg',
      'clips\\C00-K01.ogg',
      'clips/C00-K02.ogg',
    ].map((url) => (data) => {
      data.clips[0].audio_relpath = url;
    }),
  ]) {
    const data = structuredClone(good);
    mutate(data);
    fs.writeFileSync(indexPath, JSON.stringify(data));
    assert.equal(checkRelease(dir, policy()).allowed, false);
  }
  fs.writeFileSync(indexPath, JSON.stringify(good));
  fs.writeFileSync(path.join(dir, KANA_DIR, 'clips/C00-K01.ogg'), 'OggScorrupt');
  assert.ok(checkRelease(dir, policy()).failures.some((e) => e.reason === 'kana-audio-hash-mismatch'));
  fs.writeFileSync(indexPath, '{');
  assert.ok(checkRelease(dir, policy()).failures.some((e) => e.reason === 'invalid-kana-index'));
});

test('PUB-FIX-02 release build includes all 92 clips and fails on absent or broken packs', (t) => {
  const { buildRelease } = require('./build_public_release.cjs');
  const { AUDIO_DIRS, NOTICES, UNIT_IMAGE_DIR } = require('./release_files.cjs');
  const dir = fixture(t);
  const write = (file, body) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), body);
  };
  for (const file of [...NOTICES, 'vendor/cytoscape.min.js', 'privacy.html']) write(file, 'fixture');
  write('resources/licenses/public-release-policy.json', JSON.stringify(policy()));
  write('js/content-config.js', fs.readFileSync(path.join(__dirname, '../js/content-config.js'), 'utf8'));
  classicsFixture(dir, false);
  for (const n of [1, 2, 3, 4]) write('data/textbook/book_chunks/KotobaFlow' + n + '.json', '{}');
  for (const n of [1, 2, 3, 4]) {
    write('data/textbook/book_chunks/XinBian' + n + '.json', '{"lessons":{"lesson_01":"x' + n + '.json"}}');
    write('data/textbook/book_chunks/x' + n + '.json', '{"text":"わたしは テストの がくせいです。"}');
  }
  write('data/textbook/audio_chunks/index.json', '{"chunks":{}}');
  write(UNIT_IMAGE_DIR + '/images.json', '{"images":{}}');
  for (const audio of AUDIO_DIRS.filter((value) => value !== KANA_DIR)) {
    write(audio + '/fixture.ogg', 'OggSfixture');
    write(
      audio + (audio.endsWith('word_audio_v1') ? '/words.json' : '/manifest.jsonl'),
      audio.endsWith('word_audio_v1') ? '{"words":{}}' : '',
    );
  }
  const missing = path.join(dir, 'local/missing');
  assert.throws(() => buildRelease(dir, missing), /Restore the existing local Ogg pack/);
  assert.equal(fs.existsSync(missing), false);
  kanaFixture(dir);
  const release = path.join(dir, 'local/valid');
  const result = buildRelease(dir, release);
  assert.equal(checkRelease(result.directory, policy()).allowed, true);
  assert.equal(fs.readdirSync(path.join(release, KANA_DIR, 'clips')).length, 92);
  assert.equal(fs.existsSync(path.join(release, KANA_DIR, 'clips.json')), true);
  fs.unlinkSync(path.join(dir, KANA_DIR, 'clips/C00-W46.ogg'));
  assert.throws(() => buildRelease(dir, path.join(dir, 'local/broken')), /Staging check failed/);
  kanaFixture(dir);
  // PUB-FIX-04: the builder checks the shell against the withheld books' text.
  write('js/sample.js', "var sample = 'わたしは テストの がくせいです。';");
  assert.throws(() => buildRelease(dir, path.join(dir, 'local/quoted')), /Staging check failed/);
  const receipt = JSON.parse(fs.readFileSync(path.join(dir, 'local/quoted.manifest.json'), 'utf8'));
  assert.deepEqual(
    receipt.failures.map((entry) => [entry.path, entry.reason]),
    [['js/sample.js', 'withheld-textbook-text']],
  );
});

test('PUB-FIX-04 a withheld textbook sentence in the page shell blocks the release', (t) => {
  const dir = fixture(t);
  const withheld = new Set(['わたしはテストのがくせいです']);
  const reasons = () =>
    checkRelease(dir, policy(), { withheld })
      .failures.filter((entry) => entry.reason === 'withheld-textbook-text')
      .map((entry) => entry.path);
  const quoted = '<p lang="ja">はじめまして。わたしは テストの がくせいです。</p>';
  fs.writeFileSync(path.join(dir, 'index.html'), quoted);
  assert.deepEqual(reasons(), ['index.html']);
  // Short shared phrases and the data directories are outside this check.
  fs.writeFileSync(path.join(dir, 'index.html'), '<p lang="ja">わたしは がくせいです。</p>');
  fs.mkdirSync(path.join(dir, 'data'));
  fs.writeFileSync(path.join(dir, 'data/sample.json'), JSON.stringify({ text: quoted }));
  assert.deepEqual(reasons(), []);
  fs.mkdirSync(path.join(dir, 'js'));
  fs.writeFileSync(path.join(dir, 'js/sample.js'), "var sample = 'わたしはテストのがくせいです。';");
  assert.deepEqual(reasons(), ['js/sample.js']);
  assert.equal(
    checkRelease(dir, policy()).failures.some((e) => e.reason === 'withheld-textbook-text'),
    false,
  );
});

test('PUB-FIX-04 the repository page shell quotes no withheld XinBian sentence', () => {
  const root = path.join(__dirname, '..');
  const withheld = withheldPassages(root);
  const folder = path.join(root, 'data/textbook/book_chunks');
  const catalog = JSON.parse(fs.readFileSync(path.join(folder, 'XinBian1.json'), 'utf8'));
  const lesson = JSON.parse(fs.readFileSync(path.join(folder, catalog.lessons.lesson_02), 'utf8'));
  // The appearance preview once quoted the opening of this lesson.
  assert.ok(withheldTextIn('<p lang="ja">' + lesson.lesson.body.text + '</p>', withheld).length);
  const shell = ROOT_FILES.filter((file) => /\.(?:html|js|css)$/.test(file)).concat('privacy.html');
  const visit = (folderPath) => {
    for (const item of fs.readdirSync(path.join(root, folderPath), { withFileTypes: true })) {
      const file = folderPath + '/' + item.name;
      if (item.isDirectory()) visit(file);
      else if (file.endsWith('.js')) shell.push(file);
    }
  };
  visit('js');
  assert.ok(shell.length > 50);
  for (const file of shell)
    assert.deepEqual(withheldTextIn(fs.readFileSync(path.join(root, file), 'utf8'), withheld), [], file);
});
