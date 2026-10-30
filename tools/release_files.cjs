const fs = require('node:fs');
const path = require('node:path');
const ROOT_FILES = [
  'index.html',
  'vocabulary/index.html',
  'grammar/index.html',
  'textbook/index.html',
  'robots.txt',
  'sitemap.xml',
  'style.css',
  'sw.js',
  'sw-manifest.js',
  'manifest.webmanifest',
  'pwa-icon.svg',
  '_headers',
  '404.html',
];
const KANA_AUDIO_DIR = 'data/gemini38_flash_tts_kotobaflow_kana_candidate_v1';
const AUDIO_DIRS = [
  'data/gcloud_chirp3_vocab12528_female_aoede_v1',
  'data/gcloud_chirp3_vocab6127_female_aoede_v1',
  'data/gemini38_flash_tts_dialogue_sections_candidate_v1',
  'data/gemini38_flash_tts_reading_sections_candidate_v1',
  // KotobaFlow (PUB-04), installed locally by tools/install_kotobaflow_audio.py.
  'data/kotobaflow_reading_chirp_v1',
  'data/kotobaflow_dialogue_lite_v1',
  'data/kotobaflow_word_audio_v1',
  // Chapter 0 is restored separately without copying canonical course content.
  KANA_AUDIO_DIR,
];
// The public package offers only the original curriculum (PUB-05); the XinBian
// books stay local and their files are blocked by public-release-policy.json.
const PUBLIC_TEXTBOOKS = ['KotobaFlow1', 'KotobaFlow2', 'KotobaFlow3', 'KotobaFlow4'];
const WITHHELD_TEXTBOOKS = ['XinBian1', 'XinBian2', 'XinBian3', 'XinBian4'];
const UNIT_IMAGE_DIR = 'data/kotobaflow_unit_images_v1';
// Example sentence audio packed by tools/build_example_audio_packs.cjs (PUB-04-EXAMPLES).
const EXAMPLE_AUDIO_DIR = 'data/example_audio_v1';
const CLASSICS_DIR = 'data/classics_v1';
const CLASSICS_AUDIO_BASE = 'https://audio.kotobaflow.lol/classics/v1/';
const DATA_FILES = [
  'domain_taxonomy.json',
  'semantic_tag_taxonomy.json',
  'pos.json',
  'register.json',
  'transitivity.json',
  'style.json',
  'freq_band.json',
  // The vocabulary master is not published: the page reads data/vocab_chunks
  // built from it, and since VOCAB-META-02 (34.9 MB) it exceeds the Pages
  // 25 MiB file limit.
  'grammar_index.json',
  'grammar_details.json',
  'grammar_lessons.json',
].map((name) => 'data/' + name);
const DATA_DIRS = [
  'data/vocab_chunks',
  'data/grammar_chunks',
  'data/textbook/book_chunks',
  'data/textbook/audio_chunks',
  'data/textbook/canonical_books',
  'data/textbook/canonical_textbook_grammar',
  'data/textbook/canonical_textbook_vocab',
  'data/wiki/processed',
];
const NOTICES = [
  'resources/licenses/THIRD_PARTY_NOTICES.md',
  'resources/licenses/CYTOSCAPE-MIT.txt',
  'resources/licenses/theme-palettes.md',
  'resources/provenance/SOURCES.md',
];
function isRuntimePath(file) {
  if (
    typeof file !== 'string' ||
    file.includes('\\') ||
    file.split('/').some((p) => !p || p === '.' || p === '..' || p.startsWith('.'))
  )
    return false;
  if (
    /(?:^|\/)(?:user_progress|credentials?|secrets?|backup|private|params|summary|run_manifest|logs?)(?:[._/-]|$)|\.(?:bak|map|wav|zip|apk|pem|key|log|sql|toml)$/i.test(
      file,
    )
  )
    return false;
  if (
    ROOT_FILES.includes(file) ||
    file === 'privacy.html' ||
    NOTICES.includes(file) ||
    DATA_FILES.includes(file)
  )
    return true;
  if (/^js\/(?:[a-z0-9_-]+\/)*[a-z0-9_.-]+\.js$/i.test(file)) return true;
  if (file === 'vendor/cytoscape.min.js') return true;
  if (file.startsWith(CLASSICS_DIR + '/'))
    return /^(?:catalog\.json|[a-z][a-z0-9_-]{0,31}\/(?:index|[0-9]{2,3})\.json)$/.test(
      file.slice(CLASSICS_DIR.length + 1),
    );
  if (/^(?:image|resources\/brand)\/(?:[^/]+\/)*[^/]+\.(?:png|webp|svg|ico)$/i.test(file)) return true;
  if (file.startsWith(EXAMPLE_AUDIO_DIR + '/'))
    return (
      file === EXAMPLE_AUDIO_DIR + '/index.json' ||
      /^(?:packs\/[a-f0-9]{16}\.ogg|shards\/\d+-[a-f0-9]{12}\.json)$/.test(
        file.slice(EXAMPLE_AUDIO_DIR.length + 1),
      )
    );
  if (
    file === UNIT_IMAGE_DIR + '/images.json' ||
    /^data\/kotobaflow_unit_images_v1\/KotobaFlow[1-4]\/[^/]+\.webp$/.test(file)
  )
    return true;
  if (
    DATA_DIRS.some((dir) => file.startsWith(dir + '/')) &&
    /\.json$/.test(file) &&
    !/\.(?:local-repaired|gemini-full)\./.test(file)
  )
    return true;
  if (
    [
      'data/textbook/textbook_text_chunks.v2.json',
      'data/textbook/textbook_text_grammar_annotations.v1.json',
    ].includes(file)
  )
    return true;
  if (file.startsWith(KANA_AUDIO_DIR + '/'))
    return (
      file === KANA_AUDIO_DIR + '/clips.json' ||
      /^clips\/C00-[KW](?:0[1-9]|[1-3][0-9]|4[0-6])\.ogg$/.test(file.slice(KANA_AUDIO_DIR.length + 1))
    );
  return AUDIO_DIRS.some(
    (dir) =>
      file.startsWith(dir + '/') &&
      (/\.ogg$/.test(file) ||
        file === dir + '/manifest.jsonl' ||
        (dir.endsWith('dialogue_sections_candidate_v1') &&
          /\/XinBian[1-4]\/[^/]+\/[^/]+\/manifest\.json$/.test(file)) ||
        (/\/kotobaflow_(?:reading|dialogue)_/.test(dir) &&
          /\/KotobaFlow[1-4]\/[^/]+\/[^/]+\/manifest\.json$/.test(file)) ||
        file === 'data/kotobaflow_word_audio_v1/words.json' ||
        /(?:timing|alignment)[^/]*\.json$/.test(file)),
  );
}
function omitUnreferencedChunks(root, files) {
  // Builders retain historical hashes locally. Only current index graphs belong in a release.
  const folderPattern = /^data\/(?:vocab_chunks|grammar_chunks|textbook\/(?:book_chunks|audio_chunks))\//;
  const hashPattern = /^(?:(?:vocab|text|wiki|grammar|detail)-)?[a-f0-9]{64}\.json$/;
  const chunks = [...files].filter((file) => folderPattern.test(file) && file.endsWith('.json'));
  const reachable = new Set();
  function visit(file) {
    if (reachable.has(file) || !files.has(file)) return;
    reachable.add(file);
    const walk = (value) => {
      if (typeof value === 'string' && hashPattern.test(value)) {
        visit(path.posix.join(path.posix.dirname(file), value));
      } else if (value && typeof value === 'object') Object.values(value).forEach(walk);
    };
    walk(JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')));
  }
  for (const file of chunks) if (!hashPattern.test(path.posix.basename(file))) visit(file);
  for (const file of chunks) if (!reachable.has(file)) files.delete(file);
}

// Publish only the packs and shards the current index names, and all of them.
function omitUnreferencedExampleAudio(root, files) {
  const index = EXAMPLE_AUDIO_DIR + '/index.json';
  const inDir = [...files].filter((file) => file.startsWith(EXAMPLE_AUDIO_DIR + '/'));
  if (!files.has(index)) {
    for (const file of inDir) files.delete(file);
    return false;
  }
  const data = JSON.parse(fs.readFileSync(path.join(root, index), 'utf8'));
  const wanted = new Set([
    index,
    ...[...data.packs, ...data.shards].map((name) => EXAMPLE_AUDIO_DIR + '/' + name),
  ]);
  for (const file of wanted)
    if (!files.has(file)) throw new Error('Example audio index names a missing file: ' + file);
  for (const file of inDir) if (!wanted.has(file)) files.delete(file);
  return true;
}

module.exports = {
  CLASSICS_DIR,
  CLASSICS_AUDIO_BASE,
  EXAMPLE_AUDIO_DIR,
  omitUnreferencedExampleAudio,
  ROOT_FILES,
  AUDIO_DIRS,
  KANA_AUDIO_DIR,
  PUBLIC_TEXTBOOKS,
  WITHHELD_TEXTBOOKS,
  UNIT_IMAGE_DIR,
  DATA_FILES,
  DATA_DIRS,
  NOTICES,
  isRuntimePath,
  omitUnreferencedChunks,
};
