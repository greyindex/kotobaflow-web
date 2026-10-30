const fs = require('node:fs');
const path = require('node:path');
const lexicalMetadata = require('../js/core/lexical-metadata.js');

function exactKeys(value, keys, label) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join('|') !== [...keys].sort().join('|')
  )
    throw Error('Invalid enrichment fields: ' + label);
}

function text(value, max, label) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value !== value.trim() ||
    [...value].length > max ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw Error('Invalid enrichment text: ' + label);
}

function list(value, max, label) {
  if (!Array.isArray(value) || value.length < 1 || value.length > max)
    throw Error('Invalid enrichment list: ' + label);
}

function validateReview(review, original) {
  exactKeys(
    review,
    ['schemaVersion', 'status', 'confidence', 'basis', 'note_zh', 'dictionary_sequences', 'identity'],
    'lexical_review',
  );
  if (review.schemaVersion !== 2 || !['reviewed', 'needs_review'].includes(review.status))
    throw Error('Invalid lexical review status/version');
  if (!['high', 'medium', 'low'].includes(review.confidence))
    throw Error('Invalid lexical review confidence');
  if (
    !Array.isArray(review.basis) ||
    new Set(review.basis).size !== review.basis.length ||
    review.basis.some((item) => !['dictionary', 'grammar', 'context', 'usage'].includes(item))
  )
    throw Error('Invalid lexical review basis');
  text(review.note_zh, 500, 'lexical_review.note_zh');
  if (
    !Array.isArray(review.dictionary_sequences) ||
    new Set(review.dictionary_sequences).size !== review.dictionary_sequences.length ||
    review.dictionary_sequences.some((sequence) => !Number.isSafeInteger(sequence) || sequence < 1)
  )
    throw Error('Invalid JMdict sequence list');
  exactKeys(review.identity, ['word', 'reading_hiragana', 'meaning'], 'lexical_review.identity');
  ['word', 'reading_hiragana', 'meaning'].forEach((key) => {
    const value = review.identity[key];
    if (
      typeof value !== 'string' ||
      value !== value.trim() ||
      [...value].length > 500 ||
      /[\u0000-\u001f\u007f]/.test(value)
    )
      throw Error('Invalid lexical review identity string: ' + key);
  });
  if (!review.identity.word) throw Error('Empty lexical review word identity');
  if (
    review.identity.word !== original.word ||
    review.identity.reading_hiragana !== original.reading_hiragana ||
    review.identity.meaning !== original.meaning
  )
    throw Error('Lexical review identity mismatch: ' + original.textbook_uid);
}

function validate(document, entry, original, schemaVersion) {
  const v2 = schemaVersion === 2;
  const fields = v2
    ? { pos: entry.pos, transitivity: entry.transitivity, register: entry.register, style: entry.style }
    : null;
  if (v2) {
    lexicalMetadata.validate(fields);
    validateReview(entry.lexical_review, original);
  }
  const identityKeys = ['textbook_uid', 'index', 'word', 'reading_hiragana', 'context_meaning_zh'];
  const displayKeys = ['pos_ja', 'pos_zh', 'register_zh'];
  const metaKeys = ['pos', 'transitivity', 'register', 'style', 'lexical_review'];
  exactKeys(
    entry,
    [...identityKeys, ...displayKeys, ...(v2 ? metaKeys : []), 'senses', 'collocations', 'usage_note_zh'],
    'entry',
  );
  if (
    !original ||
    entry.textbook_uid !== original.textbook_uid ||
    entry.index !== original.index ||
    entry.word !== original.word ||
    entry.reading_hiragana !== original.reading_hiragana ||
    entry.context_meaning_zh !== original.meaning
  )
    throw Error('Enrichment identity mismatch: ' + (entry.textbook_uid || 'unknown'));
  displayKeys.forEach((key) => text(entry[key], 100, key));
  if (v2) {
    const normalized = lexicalMetadata.normalize(fields);
    const expectedLabels = {
      pos_ja: lexicalMetadata.posLabel(normalized.pos, 'ja'),
      pos_zh: lexicalMetadata.posLabel(normalized.pos, 'zh'),
      register_zh: lexicalMetadata.registerLabel(normalized.register, 'zh'),
    };
    for (const [key, value] of Object.entries(expectedLabels)) {
      if (entry[key] !== value) throw Error('Enrichment label mismatch: ' + entry.textbook_uid + '/' + key);
    }
  }
  text(entry.usage_note_zh, 500, 'usage_note_zh');
  list(entry.senses, 3, 'senses');
  const meanings = new Set();
  const examples = new Set((original.example_sentences || []).map((item) => item.ja));
  for (const sense of entry.senses) {
    exactKeys(sense, ['meaning_zh', 'meaning_ja', 'example_ja', 'example_zh'], 'sense');
    Object.keys(sense).forEach((key) => text(sense[key], 300, key));
    if (meanings.has(sense.meaning_zh) || examples.has(sense.example_ja))
      throw Error('Duplicate enrichment meaning/example: ' + entry.textbook_uid);
    meanings.add(sense.meaning_zh);
    examples.add(sense.example_ja);
  }
  if (entry.senses[0].meaning_zh !== original.meaning)
    throw Error('First sense changed context: ' + entry.textbook_uid);
  list(entry.collocations, 3, 'collocations');
  const collocations = new Set();
  for (const item of entry.collocations) {
    exactKeys(item, ['ja', 'zh'], 'collocation');
    text(item.ja, 160, 'collocation.ja');
    text(item.zh, 160, 'collocation.zh');
    if (collocations.has(item.ja)) throw Error('Duplicate collocation: ' + entry.textbook_uid);
    collocations.add(item.ja);
  }
  return v2 ? lexicalMetadata.normalize(fields) : null;
}

function applyEnrichment(rows, documents, requireComplete = false) {
  const additions = new Map();
  const lessons = new Set();
  let productionVersion = null;
  for (const doc of documents) {
    exactKeys(doc, ['schemaVersion', 'book_id', 'lesson_id', 'entries'], 'document');
    if (
      ![1, 2].includes(doc.schemaVersion) ||
      !/^KotobaFlow[1-4]$/.test(doc.book_id) ||
      !/^lesson_\d{2}$/.test(doc.lesson_id)
    )
      throw Error('Invalid enrichment lesson');
    if (productionVersion !== null && productionVersion !== doc.schemaVersion)
      throw Error('Mixed enrichment schema versions');
    productionVersion = doc.schemaVersion;
    if (requireComplete && doc.schemaVersion !== 2)
      throw Error('Production enrichment requires schemaVersion 2');
    const lesson = doc.book_id + '/' + doc.lesson_id;
    if (lessons.has(lesson)) throw Error('Duplicate enrichment lesson: ' + lesson);
    lessons.add(lesson);
    const expected = rows.filter((row) =>
      row.textbook_sources.some(
        (source) => source.book_id === doc.book_id && source.lesson_id === doc.lesson_id,
      ),
    );
    if (!expected.length || !Array.isArray(doc.entries) || doc.entries.length !== expected.length)
      throw Error('Incomplete enrichment lesson: ' + lesson);
    const originals = new Map(expected.map((row) => [row.textbook_uid, row]));
    for (const entry of doc.entries) {
      const original = originals.get(entry.textbook_uid);
      if (!original || additions.has(entry.textbook_uid))
        throw Error('Enrichment identity mismatch: ' + (entry.textbook_uid || 'unknown'));
      const metadata = validate(doc, entry, original, doc.schemaVersion);
      additions.set(entry.textbook_uid, { entry, metadata, schemaVersion: doc.schemaVersion });
    }
  }
  if (requireComplete && additions.size !== rows.length)
    throw Error('Incomplete curriculum enrichment: ' + additions.size + '/' + rows.length);
  return rows.map((row) => {
    const addition = additions.get(row.textbook_uid);
    if (!addition) return row;
    const output = { ...row, learning_enrichment: addition.entry };
    if (addition.schemaVersion === 2)
      Object.assign(output, addition.metadata, { lexical_review: addition.entry.lexical_review });
    return output;
  });
}

function loadEnrichment(root, rows) {
  const dir = path.join(root, 'data/textbook/kotobaflow/vocab_enrichment');
  const documents = fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => {
      const doc = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      if (file !== doc.book_id + '-' + doc.lesson_id + '.json') throw Error('Enrichment filename mismatch');
      return doc;
    });
  return applyEnrichment(rows, documents, true);
}

module.exports = { applyEnrichment, loadEnrichment };
