const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { loadEnrichment } = require('./kotobaflow_vocab_enrichment.cjs');
const root = path.resolve(__dirname, '..');
const context = { console };
vm.runInNewContext(fs.readFileSync(path.join(root, 'js/core/lexical-metadata.js'), 'utf8'), context);
vm.runInNewContext(fs.readFileSync(path.join(root, 'js/textbook-loader.js'), 'utf8'), context);
const readJSON = (file) => {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  if (source.startsWith('version https://git-lfs')) throw Error('Run git lfs pull first');
  return JSON.parse(source);
};
const readBundles = (books) =>
  Object.fromEntries(
    books.map((book) => [book, readJSON('data/textbook/canonical_books/' + book + '.bundle.json')]),
  );

// Each curriculum keeps its own vocabulary index namespace, sentence chunks and Wiki readings.
const legacyBooks = ['XinBian1', 'XinBian2', 'XinBian3', 'XinBian4'];
const legacyBundles = readBundles(legacyBooks);
const legacyVocab = context.TextbookLoader.build.mergeVocabulary(
  readJSON('data/textbook/canonical_textbook_vocab/textbook_vocab_full.v3.json'),
  readJSON('data/textbook/canonical_textbook_vocab/textbook_vocab_full.v4.enrichment.json'),
  readJSON('data/textbook/canonical_textbook_vocab/jitendex_overlay/jitendex_textbook_vocab_overlay.json')
    .entries,
  context.TextbookLoader.build.sourceVocabulary(legacyBundles),
);
const kotobaBooks = ['KotobaFlow1', 'KotobaFlow2', 'KotobaFlow3', 'KotobaFlow4'];
const kotobaBundles = readBundles(kotobaBooks);
const kotobaVocab = context.TextbookLoader.build.mergeVocabulary(
  loadEnrichment(root, readJSON('data/textbook/kotobaflow/textbook_vocab_full.v3.json')),
  [],
  [],
  context.TextbookLoader.build.sourceVocabulary(kotobaBundles),
);
// KotobaFlow indexes are not legacy audio indexes. Reuse a recorded word only
// when exactly one legacy entry has the same surface and reading.
const normalizeReading = (value) =>
  String(value || '')
    .normalize('NFKC')
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
const identity = (row) =>
  String(row.word || '').normalize('NFKC') + '::' + normalizeReading(row.reading_hiragana);
const legacyAudioByIdentity = new Map();
for (const row of legacyVocab) {
  if (row.audio_available === false || !row.word || !row.reading_hiragana) continue;
  const key = identity(row);
  legacyAudioByIdentity.set(key, legacyAudioByIdentity.has(key) ? null : row.index);
}
let reusedVocabAudio = 0;
for (const row of kotobaVocab) {
  const audioIndex = legacyAudioByIdentity.get(identity(row));
  if (audioIndex) {
    row.vocab_audio_index = audioIndex;
    reusedVocabAudio++;
  } else row.audio_available = false;
}
const curricula = [
  {
    books: legacyBooks,
    bundles: legacyBundles,
    vocab: legacyVocab,
    grammar: context.TextbookLoader.build.grammarByLesson(
      readJSON('data/textbook/canonical_textbook_grammar/textbook_grammar_full.v2.json'),
    ),
    sentences: readJSON('data/textbook/textbook_text_chunks.v2.json').sentences,
    readings: readJSON('data/wiki/processed/textbook_wiki_reading_chunks.v1.json').readings,
  },
  {
    books: kotobaBooks,
    bundles: kotobaBundles,
    vocab: kotobaVocab,
    grammar: {},
    sentences: readJSON('data/textbook/kotobaflow/textbook_text_chunks.v2.json').sentences,
    readings: [],
  },
];
const files = new Map();
let matchedSentences = 0,
  matchedReadings = 0,
  totalSentences = 0,
  totalReadings = 0;
let indexBytes = 0,
  lessons = 0;
for (const { books, bundles, vocab, grammar, sentences, readings } of curricula) {
  if (!Array.isArray(sentences) || !Array.isArray(readings)) throw Error('Invalid reading source');
  totalSentences += sentences.length;
  totalReadings += readings.length;
  const readingKeys = new Set();
  for (const reading of readings) {
    const key = reading.bookId + '::' + reading.lessonId;
    if (readingKeys.has(key)) throw Error('Duplicate Wiki reading: ' + key);
    readingKeys.add(key);
  }
  for (const book of books) {
    const bundle = bundles[book];
    if (bundle.book_id !== book) throw Error('Bundle identity mismatch: ' + book);
    const catalog = {
      schema: 1,
      book_id: book,
      index: bundle.index,
      lessons: {},
      vocabulary: {},
      textChunks: {},
      wikiReadings: {},
      grammar: {},
    };
    for (const item of bundle.items) {
      const id = item.lesson.item_id;
      if (!id || Object.hasOwn(catalog.lessons, id)) throw Error('Missing/duplicate lesson ID');
      const body = JSON.stringify(item);
      const file = crypto.createHash('sha256').update(body).digest('hex') + '.json';
      catalog.lessons[id] = file;
      files.set(file, body);
      const rows = vocab.filter((row) => context.TextbookLoader.build.matchesLesson(row, book, id));
      rows.sort((a, b) =>
        (a.source_index || 0) !== (b.source_index || 0)
          ? (a.source_index || 0) - (b.source_index || 0)
          : String(a.word || '').localeCompare(String(b.word || ''), 'zh-Hans-CN'),
      );
      const vocabBody = JSON.stringify(rows);
      const vocabFile = 'vocab-' + crypto.createHash('sha256').update(vocabBody).digest('hex') + '.json';
      catalog.vocabulary[id] = vocabFile;
      files.set(vocabFile, vocabBody);
      const lessonSentences = sentences.filter((row) => row && row.book_id === book && row.lesson_id === id);
      lessonSentences.sort((a, b) => {
        const ai = parseInt(a.source_index, 10),
          bi = parseInt(b.source_index, 10);
        if (!isNaN(ai) && !isNaN(bi) && ai !== bi) return ai - bi;
        if ((a.turn_index || 0) !== (b.turn_index || 0)) return (a.turn_index || 0) - (b.turn_index || 0);
        return (a.sentence_index || 0) - (b.sentence_index || 0);
      });
      const reading = readings.find((row) => row.bookId === book && row.lessonId === id) || null;
      matchedSentences += lessonSentences.length;
      matchedReadings += reading ? 1 : 0;
      for (const [field, prefix, value] of [
        ['textChunks', 'text', lessonSentences],
        ['wikiReadings', 'wiki', reading],
        ['grammar', 'grammar', grammar[book + '::' + id] || []],
      ]) {
        const body = JSON.stringify(value);
        const file = prefix + '-' + crypto.createHash('sha256').update(body).digest('hex') + '.json';
        catalog[field][id] = file;
        files.set(file, body);
      }
      lessons++;
    }
    const body = JSON.stringify(catalog);
    files.set(book + '.json', body);
    indexBytes += Buffer.byteLength(body);
  }
}
if (matchedSentences !== totalSentences || matchedReadings !== totalReadings)
  throw Error('Reading source contains unmapped lessons; refusing incomplete output');
const output = path.join(root, 'data/textbook/book_chunks');
if (process.argv.includes('--check')) {
  for (const [file, body] of files) {
    if (!fs.existsSync(path.join(output, file)) || fs.readFileSync(path.join(output, file), 'utf8') !== body)
      throw Error('Book chunks stale; run npm run resources:books');
  }
} else {
  fs.mkdirSync(output, { recursive: true });
  for (const [file, body] of files) fs.writeFileSync(path.join(output, file), body);
}
console.log(
  JSON.stringify({
    indexBytes,
    lessons,
    matchedSentences,
    matchedReadings,
    kotobaVocab: kotobaVocab.length,
    reusedVocabAudio,
    maxTextBytes: Math.max(
      ...[...files].filter(([name]) => name.startsWith('text-')).map(([, body]) => Buffer.byteLength(body)),
    ),
    maxWikiBytes: Math.max(
      ...[...files].filter(([name]) => name.startsWith('wiki-')).map(([, body]) => Buffer.byteLength(body)),
    ),
    maxLessonBytes: Math.max(
      ...[...files]
        .filter(([name]) => /^[a-f0-9]{64}\.json$/.test(name))
        .map(([, body]) => Buffer.byteLength(body)),
    ),
  }),
);
