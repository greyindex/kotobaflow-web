const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyEnrichment } = require('./kotobaflow_vocab_enrichment.cjs');
const lexicalMetadata = require('../js/core/lexical-metadata.js');

const row = {
  textbook_uid: 'cfv-test',
  index: 5,
  word: 'すみません',
  reading_hiragana: 'すみません',
  meaning: '引起注意或轻度致歉',
  example_sentences: [{ ja: 'すみません。', zh: '不好意思。' }],
  vocab_audio_index: 123,
  textbook_sources: [{ book_id: 'KotobaFlow1', lesson_id: 'lesson_01' }],
};
const document = () => ({
  schemaVersion: 1,
  book_id: 'KotobaFlow1',
  lesson_id: 'lesson_01',
  entries: [
    {
      textbook_uid: row.textbook_uid,
      index: row.index,
      word: row.word,
      reading_hiragana: row.reading_hiragana,
      context_meaning_zh: row.meaning,
      pos_ja: '定型表現',
      pos_zh: '固定表达',
      register_zh: '礼貌表达',
      senses: [
        {
          meaning_zh: row.meaning,
          meaning_ja: '人に声をかけるときの言葉。',
          example_ja: 'すみません、もう一度お願いします。',
          example_zh: '不好意思，请再说一遍。',
        },
      ],
      collocations: [{ ja: 'すみませんが、…', zh: '不好意思，……' }],
      usage_note_zh: '可用于叫住对方。',
    },
  ],
});

const documentV2 = () => {
  const doc = document();
  doc.schemaVersion = 2;
  doc.entries = doc.entries.map((entry) => {
    const fields = {
      pos: {
        primary: 'expression',
        classes: ['expression'],
        subtypes: ['polite_form'],
        conjugation: 'not_applicable',
      },
      transitivity: { value: 'not_applicable', scope: 'not_applicable' },
      register: { formality: 'neutral', politeness: ['polite'], usage: [] },
      style: { medium: 'spoken', genres: [] },
    };
    return {
      ...entry,
      ...fields,
      pos_ja: lexicalMetadata.posLabel(fields.pos, 'ja'),
      pos_zh: lexicalMetadata.posLabel(fields.pos, 'zh'),
      register_zh: lexicalMetadata.registerLabel(fields.register, 'zh'),
      lexical_review: {
        schemaVersion: 2,
        status: 'reviewed',
        confidence: 'high',
        basis: ['context', 'usage'],
        note_zh: '结合本课用于引起注意和致歉的语境审核。',
        dictionary_sequences: [],
        identity: { word: row.word, reading_hiragana: row.reading_hiragana, meaning: row.meaning },
      },
    };
  });
  return doc;
};

test('enrichment preserves original teaching fields and audio without mutating inputs', () => {
  const input = structuredClone(row);
  const output = applyEnrichment([input], [document()]);
  const { learning_enrichment, ...original } = output[0];
  assert.deepEqual(original, row);
  assert.deepEqual(input, row);
  assert.equal(learning_enrichment.senses.length, 1);
  assert.deepEqual(applyEnrichment([row], []), [row]);
});

test('schema v2 validates typed metadata and promotes it to the runtime vocabulary row', () => {
  const output = applyEnrichment([row], [documentV2()]);
  assert.deepEqual(
    {
      pos: output[0].pos,
      transitivity: output[0].transitivity,
      register: output[0].register,
      style: output[0].style,
    },
    lexicalMetadata.normalize({
      pos: documentV2().entries[0].pos,
      transitivity: documentV2().entries[0].transitivity,
      register: documentV2().entries[0].register,
      style: documentV2().entries[0].style,
    }),
  );
  assert.deepEqual(output[0].transitivity, documentV2().entries[0].transitivity);
  assert.deepEqual(output[0].register, documentV2().entries[0].register);
  assert.deepEqual(output[0].style, documentV2().entries[0].style);
  assert.deepEqual(output[0].lexical_review.identity, {
    word: row.word,
    reading_hiragana: row.reading_hiragana,
    meaning: row.meaning,
  });
});

test('schema v2 preserves an empty frozen reading instead of substituting another identity', () => {
  const source = { ...row, reading_hiragana: '' };
  const doc = documentV2();
  doc.entries[0].reading_hiragana = '';
  doc.entries[0].lexical_review.identity.reading_hiragana = '';
  const [accepted] = applyEnrichment([source], [doc]);
  assert.equal(accepted.reading_hiragana, '');
  assert.equal(accepted.lexical_review.identity.reading_hiragana, '');
  const mismatched = structuredClone(doc);
  mismatched.entries[0].lexical_review.identity.reading_hiragana = 'すみません';
  assert.throws(() => applyEnrichment([source], [mismatched]), /Lexical review identity mismatch/);
});

test('production completeness rejects legacy schema and schema v2 rejects identity or metadata drift', () => {
  assert.throws(() => applyEnrichment([row], [document()], true), /schemaVersion 2/);
  const wrongIdentity = documentV2();
  wrongIdentity.entries[0].lexical_review.identity.meaning = '谢谢';
  assert.throws(() => applyEnrichment([row], [wrongIdentity]), /Lexical review identity/);
  const invalidField = documentV2();
  invalidField.entries[0].pos.classes.push('made_up');
  assert.throws(() => applyEnrichment([row], [invalidField]), /invalid value/);
  const invalidLabel = documentV2();
  invalidLabel.entries[0].pos_zh = '固定表达';
  assert.throws(() => applyEnrichment([row], [invalidLabel]), /Enrichment label mismatch/);
});

for (const [name, mutate] of [
  [
    'wrong reading',
    (d) => {
      d.entries[0].reading_hiragana = 'すいません';
    },
  ],
  [
    'wrong index',
    (d) => {
      d.entries[0].index++;
    },
  ],
  [
    'wrong lesson',
    (d) => {
      d.lesson_id = 'lesson_02';
    },
  ],
  [
    'incomplete lesson',
    (d) => {
      d.entries = [];
    },
  ],
  [
    'changed original meaning',
    (d) => {
      d.entries[0].context_meaning_zh = '谢谢';
    },
  ],
  [
    'changed first sense',
    (d) => {
      d.entries[0].senses[0].meaning_zh = '谢谢';
    },
  ],
  [
    'reused original example',
    (d) => {
      d.entries[0].senses[0].example_ja = 'すみません。';
    },
  ],
  [
    'missing translation',
    (d) => {
      d.entries[0].senses[0].example_zh = '';
    },
  ],
  [
    'unexpected audio override',
    (d) => {
      d.entries[0].vocab_audio_index = 456;
    },
  ],
]) {
  test('rejects ' + name + ' before changing source', () => {
    const input = structuredClone(row);
    const doc = document();
    mutate(doc);
    assert.throws(() => applyEnrichment([input], [doc]));
    assert.deepEqual(input, row);
  });
}
test('rejects duplicate lessons and repeated word identities even at correct entry count', () => {
  assert.throws(() => applyEnrichment([row], [document(), document()]), /Duplicate/);
  const doc = document();
  doc.entries.push(structuredClone(doc.entries[0]));
  assert.throws(
    () => applyEnrichment([row, { ...row, textbook_uid: 'cfv-other', index: 6 }], [doc]),
    /identity/,
  );
});

test('full curriculum build rejects a missing lesson while isolated author validation remains available', () => {
  const another = {
    ...row,
    textbook_uid: 'cfv-other',
    index: 6,
    textbook_sources: [{ book_id: 'KotobaFlow1', lesson_id: 'lesson_02' }],
  };
  assert.throws(() => applyEnrichment([row, another], [document()], true), /schemaVersion 2/);
  assert.throws(() => applyEnrichment([row], [], true), /Incomplete curriculum/);
  assert.equal(applyEnrichment([row], [documentV2()], true).length, 1);
  assert.equal(applyEnrichment([row, another], [document()]).length, 2);
});
