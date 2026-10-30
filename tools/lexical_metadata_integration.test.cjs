const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { applyEnrichment } = require('./kotobaflow_vocab_enrichment.cjs');

const root = path.resolve(__dirname, '..');
const context = vm.createContext({
  console,
  fetch: () => Promise.reject(new Error('Unexpected network access')),
});
vm.runInContext(fs.readFileSync(path.join(root, 'js/core/lexical-metadata.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'js/textbook-loader.js'), 'utf8'), context);

const metadata = context.JPLearn.lexicalMetadata;
const mergeVocabulary = context.TextbookLoader.build.mergeVocabulary;

function reviewedFields(identity) {
  return {
    pos: { primary: 'verb', classes: ['verb'], subtypes: [], conjugation: 'godan' },
    transitivity: { value: 'intransitive', scope: 'lexeme' },
    register: { formality: 'neutral', politeness: [], usage: [] },
    style: { medium: 'general', genres: [] },
    lexical_review: {
      schemaVersion: 2,
      status: 'reviewed',
      confidence: 'high',
      basis: ['dictionary', 'context'],
      note_zh: '按词头、读音和教材原义核对。',
      dictionary_sequences: [12345],
      identity,
    },
  };
}

function row() {
  return {
    index: 5223,
    textbook_uid: 'tv-c784b550b869',
    word: '引っ越す',
    reading_hiragana: 'ひっこす',
    meaning: '搬家',
    example_sentence_ja: '来月、引っ越す。',
    audio_available: true,
    vocab_audio_index: 4321,
    match_status: 'exact',
    association_review: { status: 'verified' },
  };
}

test('XinBian v4 enrichment is attached only when its review identity matches the effective row', () => {
  const source = row();
  const identity = {
    word: source.word,
    reading_hiragana: source.reading_hiragana,
    meaning: source.meaning,
  };
  const valid = {
    index: source.index,
    textbook_uid: source.textbook_uid,
    word: source.word,
    reading_hiragana: source.reading_hiragana,
    ...reviewedFields(identity),
    senses: [{ meaning_zh: 'REJECTED CANDIDATE MEANING' }],
    external_links: [{ url: 'https://invalid.example/candidate' }],
  };
  const merged = mergeVocabulary([source], [valid], [], [])[0];
  assert.deepEqual(merged.v4_enrichment.pos, valid.pos);
  assert.equal(merged.v4_enrichment.lexical_review.identity.meaning, '搬家');
  assert.equal(merged.meaning, '搬家');
  assert.equal(merged.example_sentence_ja, '来月、引っ越す。');
  assert.equal(merged.vocab_audio_index, 4321);
  assert.equal(merged.index, 5223);

  const mismatched = {
    ...valid,
    ...reviewedFields({
      word: source.word,
      reading_hiragana: source.reading_hiragana,
      meaning: '别的义项',
    }),
  };
  const rejected = mergeVocabulary([source], [mismatched], [], [])[0];
  assert.equal(rejected.v4_enrichment, null);
  assert.equal(rejected.meaning, '搬家');
  assert.equal(rejected.example_sentence_ja, '来月、引っ越す。');
  assert.equal(rejected.audio_available, true);
  assert.equal(rejected.vocab_audio_index, 4321);
  assert.equal(rejected.index, 5223);
  assert.equal(metadata.reviewMatches({ ...source, lexical_review: mismatched.lexical_review }), false);
});

test('pending associations remain pending and cannot resolve to a practice word after metadata is added', () => {
  const pending = {
    ...row(),
    association_review: {
      status: 'pending',
      reason: '教材原文与候选关联待核对',
      candidate: { word: '引っ越す', reading: 'ひっこす', meaning: '候选释义' },
    },
    ...reviewedFields({ word: '引っ越す', reading_hiragana: 'ひっこす', meaning: '搬家' }),
  };
  const candidate = {
    index: pending.index,
    textbook_uid: pending.textbook_uid,
    word: pending.word,
    reading_hiragana: pending.reading_hiragana,
    ...reviewedFields(pending.lexical_review.identity),
    senses: [{ meaning_zh: '不得恢复的候选释义' }],
  };
  const merged = mergeVocabulary([pending], [candidate], [], [])[0];
  assert.equal(merged.association_review.status, 'pending');
  assert.equal(merged.v4_enrichment, null);
  assert.equal(merged.meaning, '搬家');
  assert.equal(merged.example_sentence_ja, '来月、引っ越す。');
  assert.equal(merged.vocab_audio_index, 4321);
  assert.equal(merged.index, 5223);
  assert.deepEqual(context.TextbookLoader.resolveStudyVocabulary([merged], [row()]), [null]);
});

test('KotobaFlow enrichment rejects the wrong identity and attaches reviewed metadata without changing source identity or audio', () => {
  const canonical = JSON.parse(
    fs.readFileSync(path.join(root, 'data/textbook/kotobaflow/textbook_vocab_full.v3.json'), 'utf8'),
  );
  const original = canonical.find((item) => item.index === 350 && item.word === 'タクシー');
  assert.ok(original, 'expected the real KotobaFlow タクシー source record at index 350');
  const source = { ...original, vocab_audio_index: 9876 };
  const [association] = source.textbook_sources.filter((item) => item.source_type === 'lesson_vocab');
  const identity = {
    word: source.word,
    reading_hiragana: source.reading_hiragana,
    meaning: source.meaning,
  };
  const lexical_review = {
    schemaVersion: 2,
    status: 'reviewed',
    confidence: 'high',
    basis: ['dictionary', 'context'],
    note_zh: 'QA integration record tied to the source identity.',
    dictionary_sequences: [98765],
    identity,
  };
  const displayLabels = {
    pos_ja: metadata.posLabel(
      { primary: 'noun', classes: ['noun'], subtypes: [], conjugation: 'not_applicable' },
      'ja',
    ),
    pos_zh: metadata.posLabel(
      { primary: 'noun', classes: ['noun'], subtypes: [], conjugation: 'not_applicable' },
      'zh',
    ),
    register_zh: metadata.registerLabel({ formality: 'neutral', politeness: [], usage: [] }, 'zh'),
  };
  const entry = {
    textbook_uid: source.textbook_uid,
    index: source.index,
    word: source.word,
    reading_hiragana: source.reading_hiragana,
    context_meaning_zh: source.meaning,
    pos: { primary: 'noun', classes: ['noun'], subtypes: [], conjugation: 'not_applicable' },
    transitivity: { value: 'not_applicable', scope: 'not_applicable' },
    register: { formality: 'neutral', politeness: [], usage: [] },
    style: { medium: 'general', genres: [] },
    lexical_review,
    ...displayLabels,
    senses: [
      {
        meaning_zh: source.meaning,
        meaning_ja: 'QAで確認した語義',
        example_ja: 'QA用の別例文です。',
        example_zh: '这是QA用的补充例句。',
      },
    ],
    collocations: [{ ja: 'QA用の組み合わせ', zh: 'QA用搭配' }],
    usage_note_zh: 'QA integration test fixture.',
  };
  const document = {
    schemaVersion: 2,
    book_id: association.book_id,
    lesson_id: association.lesson_id,
    entries: [entry],
  };

  const wrongIdentity = structuredClone(document);
  wrongIdentity.entries[0].lexical_review.identity.meaning = '候选释义';
  assert.throws(() => applyEnrichment([source], [wrongIdentity]), /Lexical review identity mismatch/);

  const wrongLabel = structuredClone(document);
  wrongLabel.entries[0].pos_zh = '动词';
  assert.throws(() => applyEnrichment([source], [wrongLabel]), /Enrichment label mismatch/);

  const [accepted] = applyEnrichment([source], [document]);
  assert.deepEqual(accepted.pos, entry.pos);
  assert.deepEqual(accepted.transitivity, entry.transitivity);
  assert.deepEqual(accepted.register, entry.register);
  assert.deepEqual(accepted.style, entry.style);
  assert.deepEqual(accepted.lexical_review.identity, identity);
  assert.equal(accepted.word, source.word);
  assert.equal(accepted.reading_hiragana, source.reading_hiragana);
  assert.equal(accepted.meaning, source.meaning);
  assert.equal(accepted.textbook_uid, source.textbook_uid);
  assert.equal(accepted.index, source.index);
  assert.equal(accepted.vocab_audio_index, 9876);
});

test('a noun-verb class produces stable separate POS graph nodes and edges', () => {
  class GraphBuilderFixture {
    constructor() {
      this.cy = {
        data: [],
        elements() {
          return { remove: () => (this.data = []) };
        },
        add(elements) {
          this.data.push(...elements);
        },
        layout() {
          return { run() {} };
        },
      };
    }

    _getLayoutOptions() {
      return {};
    }

    _updateStats() {}
  }

  context.window = context;
  context.taxonomyManager = {
    getLabel: (kind, code) => (kind === 'pos' ? { noun: '名词', verb: '动词' }[code] : code),
    getDescription: () => '',
  };
  context.GraphBuilderFixture = GraphBuilderFixture;
  vm.runInContext(fs.readFileSync(path.join(root, 'js/vocab/graph-builders.js'), 'utf8'), context);
  context.JPLearn.installGraphBuilders(GraphBuilderFixture);

  const word = {
    index: 9604,
    word: '勉強',
    pos: {
      primary: 'noun',
      classes: ['noun', 'verb'],
      subtypes: ['verbal_noun'],
      conjugation: 'suru',
    },
    domain_codes: ['home'],
    semantic_tag_codes: ['daily_life'],
  };
  const nounOnly = {
    ...word,
    index: 9605,
    word: '専門用語',
    pos: { primary: 'noun', classes: ['noun'], subtypes: [], conjugation: 'not_applicable' },
    domain_codes: ['home'],
    semantic_tag_codes: [],
  };
  const verbOnly = {
    ...word,
    index: 9606,
    word: '行く',
    pos: { primary: 'verb', classes: ['verb'], subtypes: [], conjugation: 'godan' },
    domain_codes: [],
    semantic_tag_codes: ['daily_life'],
  };
  const adjectiveOnly = {
    ...word,
    index: 9607,
    word: '易しい',
    pos: { primary: 'adjective_i', classes: ['adjective_i'], subtypes: [], conjugation: 'not_applicable' },
    domain_codes: [],
    semantic_tag_codes: [],
  };
  const graph = new GraphBuilderFixture();
  graph.buildLocalGraph({ type: 'word', data: word }, [word], 'domain');

  const nodes = Object.fromEntries(
    graph.cy.data.filter((item) => item.data.type === 'pos').map((item) => [item.data.id, item.data]),
  );
  assert.deepEqual(Object.keys(nodes).sort(), ['pos:noun', 'pos:verb']);
  assert.equal(nodes['pos:noun'].label, '名词');
  assert.equal(nodes['pos:verb'].label, '动词');
  assert.ok(graph.cy.data.some((item) => item.data.id === 'word:9604'));
  assert.ok(graph.cy.data.some((item) => item.data.id === 'word:9604->pos:noun'));
  assert.ok(graph.cy.data.some((item) => item.data.id === 'word:9604->pos:verb'));
  assert.ok(graph.cy.data.every((item) => !item.data.id.includes('[object Object]')));

  const allWords = [word, nounOnly, verbOnly, adjectiveOnly];
  graph.buildLocalGraph({ type: 'pos', data: { code: 'noun' } }, allWords, 'domain');
  const posWordIds = graph.cy.data.filter((item) => item.data.type === 'word').map((item) => item.data.id);
  assert.deepEqual(posWordIds.sort(), ['word:9604', 'word:9605']);
  assert.ok(graph.cy.data.some((item) => item.data.id === 'word:9604->pos:noun'));
  assert.ok(graph.cy.data.some((item) => item.data.id === 'word:9605->pos:noun'));
  assert.equal(
    graph.cy.data.some((item) => item.data.id === 'word:9606'),
    false,
  );
  assert.equal(
    graph.cy.data.some((item) => item.data.id === 'word:9607'),
    false,
  );

  graph.buildLocalGraph({ type: 'domain', data: { code: 'home' } }, allWords, 'domain');
  assert.deepEqual(
    graph.cy.data
      .filter((item) => item.data.type === 'word')
      .map((item) => item.data.id)
      .sort(),
    ['word:9604', 'word:9605'],
  );
  graph.buildLocalGraph({ type: 'semantic', data: { code: 'daily_life' } }, allWords, 'semantic');
  assert.deepEqual(
    graph.cy.data
      .filter((item) => item.data.type === 'word')
      .map((item) => item.data.id)
      .sort(),
    ['word:9604', 'word:9606'],
  );
});
