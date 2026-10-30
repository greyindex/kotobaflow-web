const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseVerdict,
  validateFields,
  validateKotobaDocumentUpdate,
  validateCurrentData,
  attachMetadata,
  sameExcept,
} = require('./apply_lexical_metadata.cjs');

const record = {
  record_id: 'M:7',
  effective_identity: { word: '食べる', reading_hiragana: 'たべる', meaning: '吃' },
  dictionary: [{ sequence: 1234 }],
};
const verdict = () => [
  'M:7',
  'verb',
  'verb',
  '',
  'ichidan',
  'transitive',
  'lexeme',
  'neutral',
  '',
  '',
  'general',
  '',
  'reviewed',
  'high',
  'dictionary,context',
  '「食べる」は一段他動詞で、食物を目的語に取る一般的な動作を表す。',
  [1234],
];

test('parses a complete reviewed 17-cell verdict and binds review identity to frozen input', () => {
  const result = parseVerdict(verdict(), record, 'review');
  assert.equal(result.pos.primary, 'verb');
  assert.deepEqual(result.pos.classes, ['verb']);
  assert.equal(result.lexical_review.identity.meaning, record.effective_identity.meaning);
  assert.deepEqual(result.lexical_review.dictionary_sequences, [1234]);
});

test('rejects malformed verdicts, bad enum values, unprovided dictionary sequences, and changed IDs', () => {
  const invalidWidth = verdict().slice(0, 16);
  assert.throws(() => parseVerdict(invalidWidth, record, 'review'), /17 cells/);
  const invalidCode = verdict();
  invalidCode[1] = 'verb-like';
  assert.throws(() => parseVerdict(invalidCode, record, 'review'), /pos.primary has invalid/);
  const invalidReference = verdict();
  invalidReference[16] = [9999];
  assert.throws(() => parseVerdict(invalidReference, record, 'review'), /not in frozen input/);
  const invalidId = verdict();
  invalidId[0] = 'M:8';
  assert.throws(() => parseVerdict(invalidId, record, 'review'), /record ID mismatch/);
});

test('field validation rejects unknown keys and allowlist comparison rejects unrelated edits', () => {
  assert.throws(
    () =>
      validateFields({
        pos: { primary: 'noun', classes: ['noun'], subtypes: [], conjugation: 'not_applicable', extra: true },
        transitivity: { value: 'not_applicable', scope: 'not_applicable' },
        register: { formality: 'neutral', politeness: [], usage: [] },
        style: { medium: 'general', genres: [] },
      }),
    /unknown key/,
  );
  const original = { index: 7, word: '食べる', meaning: '吃', pos: 'legacy' };
  const metadata = parseVerdict(verdict(), record, 'review');
  const updated = attachMetadata(original, metadata, 'M:7');
  assert.equal(updated.index, original.index);
  assert.equal(updated.meaning, original.meaning);
  assert.doesNotThrow(() =>
    sameExcept(original, updated, ['pos', 'transitivity', 'register', 'style', 'lexical_review'], 'valid'),
  );
  assert.throws(
    () =>
      sameExcept(
        original,
        { ...updated, meaning: '别的意思' },
        ['pos', 'transitivity', 'register', 'style', 'lexical_review'],
        'tampered',
      ),
    /Non-allowed change/,
  );
});

test('publisher uses the core validator for auxiliary adjectives and adjective plus suru classes', () => {
  const auxiliaryAdjective = {
    pos: {
      primary: 'auxiliary',
      classes: ['auxiliary'],
      subtypes: ['auxiliary_adjective'],
      conjugation: 'not_applicable',
    },
    transitivity: { value: 'not_applicable', scope: 'not_applicable' },
    register: { formality: 'neutral', politeness: [], usage: [] },
    style: { medium: 'general', genres: [] },
  };
  assert.equal(validateFields(auxiliaryAdjective).pos.conjugation, 'not_applicable');

  const adjectiveSuru = {
    pos: {
      primary: 'adjective_na',
      classes: ['adjective_na', 'noun', 'verb'],
      subtypes: [],
      conjugation: 'suru',
    },
    transitivity: { value: 'intransitive', scope: 'suru' },
    register: { formality: 'neutral', politeness: [], usage: [] },
    style: { medium: 'general', genres: [] },
  };
  assert.deepEqual(validateFields(adjectiveSuru).pos.classes, ['noun', 'verb', 'adjective_na']);
});

test('publisher preserves baseline identities whose reading or meaning is empty', () => {
  const emptyIdentityRecord = {
    record_id: 'X:9',
    effective_identity: { word: '学生', reading_hiragana: '', meaning: '' },
    dictionary: [],
  };
  const row = verdict();
  row[0] = 'X:9';
  row[12] = 'needs_review';
  row[13] = 'low';
  row[14] = 'grammar,context';
  row[15] = '读音与释义在冻结输入中为空；只按提供的词性资料保留基础名词判断。';
  row[16] = [];
  const result = parseVerdict(row, emptyIdentityRecord, 'review');
  assert.deepEqual(result.lexical_review.identity, emptyIdentityRecord.effective_identity);
  assert.equal(result.lexical_review.status, 'needs_review');
});

test('publisher permits a complete KotobaFlow entry migration while guarding document and row identity', () => {
  const original = {
    schemaVersion: 1,
    book_id: 'KotobaFlow1',
    lesson_id: 'lesson_01',
    title_zh: '第一课',
    entries: [
      {
        textbook_uid: 'cfv-1',
        index: 1,
        word: '学生',
        reading_hiragana: 'がくせい',
        context_meaning_zh: '学生',
        pos_ja: '名詞',
        pos_zh: '名词',
        register_zh: '中性',
        senses: [],
        collocations: [],
        usage_note_zh: '学生を表す。',
      },
    ],
  };
  const migrated = structuredClone(original);
  migrated.schemaVersion = 2;
  Object.assign(migrated.entries[0], {
    pos: { primary: 'noun', classes: ['noun'], subtypes: [], conjugation: 'not_applicable' },
    transitivity: { value: 'not_applicable', scope: 'not_applicable' },
    register: { formality: 'neutral', politeness: [], usage: [] },
    style: { medium: 'general', genres: [] },
    lexical_review: {
      schemaVersion: 2,
      status: 'reviewed',
      confidence: 'high',
      basis: ['context'],
      note_zh: '本课词头和原义均指学生这一名词。',
      dictionary_sequences: [],
      identity: { word: '学生', reading_hiragana: 'がくせい', meaning: '学生' },
    },
  });
  assert.equal(validateKotobaDocumentUpdate(original, migrated), true);
  const changedTitle = structuredClone(migrated);
  changedTitle.title_zh = '错误标题';
  assert.throws(() => validateKotobaDocumentUpdate(original, changedTitle), /Non-allowed change/);
  const changedEntry = structuredClone(migrated);
  changedEntry.entries[0].word = '先生';
  assert.throws(() => validateKotobaDocumentUpdate(original, changedEntry), /Non-allowed change/);
});

test('standalone current-data verifier rejects legacy scalars and accepts exact blank XinBian identity', () => {
  const reviewFor = (identity) => ({
    schemaVersion: 2,
    status: 'needs_review',
    confidence: 'low',
    basis: ['context'],
    note_zh: '冻结输入部分身份字段为空，按原值保留并待核。',
    dictionary_sequences: [],
    identity,
  });
  const fields = {
    pos: { primary: 'noun', classes: ['noun'], subtypes: [], conjugation: 'not_applicable' },
    transitivity: { value: 'not_applicable', scope: 'not_applicable' },
    register: { formality: 'neutral', politeness: [], usage: [] },
    style: { medium: 'general', genres: [] },
  };
  const main = {
    index: 1,
    word: '学生',
    reading_hiragana: '',
    meaning: '',
    ...fields,
    lexical_review: reviewFor({ word: '学生', reading_hiragana: '', meaning: '' }),
  };
  const effectiveXin = { index: 1, textbook_uid: 'xin-1', word: '語', reading_hiragana: 'ご', meaning: '' };
  const xinIdentity = { word: '語', reading_hiragana: 'ご', meaning: '' };
  const xin = {
    index: 1,
    textbook_uid: 'xin-1',
    word: '語',
    reading_hiragana: 'ご',
    meaning: 'raw meaning may be protected by association loader',
    ...fields,
    lexical_review: reviewFor(xinIdentity),
  };
  const xinV4 = {
    index: 1,
    textbook_uid: 'xin-1',
    word: '語',
    reading_hiragana: 'ご',
    ...fields,
    lexical_review: reviewFor(xinIdentity),
    display_pos_ja: '名詞',
    display_pos_zh: '名词',
    conjugation_class_ja: '',
    transitivity_label_zh: '不适用',
  };
  const kotoba = { index: 1, textbook_uid: 'cfv-1', word: '学生', reading_hiragana: '', meaning: '学生' };
  const kotobaEntry = {
    textbook_uid: kotoba.textbook_uid,
    index: kotoba.index,
    word: kotoba.word,
    reading_hiragana: kotoba.reading_hiragana,
    context_meaning_zh: kotoba.meaning,
    ...fields,
    lexical_review: reviewFor({ word: kotoba.word, reading_hiragana: '', meaning: kotoba.meaning }),
    pos_ja: '名詞',
    pos_zh: '名词',
    register_zh: '中性',
  };
  const valid = {
    mainRows: [main],
    xinRows: [xin],
    xinV4Rows: [xinV4],
    kotobaRows: [kotoba],
    kotobaDocuments: [{ schemaVersion: 2, entries: [kotobaEntry] }],
    effectiveXinRows: [effectiveXin],
    expectedCounts: { main: 1, xinbian: 1, kotobaflow: 1 },
    expectedKotobaDocuments: 1,
  };
  assert.equal(validateCurrentData(valid).ok, true);
  const oldScalar = structuredClone(valid);
  oldScalar.mainRows[0].pos = 'noun';
  assert.throws(() => validateCurrentData(oldScalar), /metadata: pos must be an object/);
  const mismatchedBlank = structuredClone(valid);
  mismatchedBlank.xinRows[0].lexical_review.identity.meaning = 'filled by guess';
  assert.throws(() => validateCurrentData(mismatchedBlank), /identity mismatch/);
});
