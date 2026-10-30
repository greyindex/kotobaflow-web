const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { prepareChanges, writeChanges } = require('./apply_kotobaflow_source_collation.cjs');

const MASTER = 'data/textbook/kotobaflow/textbook_vocab_full.v3.json';
const CANONICAL = 'data/textbook/canonical_books/KotobaFlow2.bundle.json';
const ENRICHMENT = 'data/textbook/kotobaflow/vocab_enrichment/KotobaFlow2-lesson_15.json';
const UID = 'cfv-afda1960f827bb30';

function fixture(t, schemaVersion = 2) {
  const temporaryRoot = path.resolve(os.tmpdir());
  const root = fs.mkdtempSync(path.join(temporaryRoot, 'kotobaflow-collation-test-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), temporaryRoot);
    assert.match(path.basename(root), /^kotobaflow-collation-test-/);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const write = (relative, value) => {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), JSON.stringify(value, null, 2) + '\n');
  };
  const read = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
  const identity = { word: '保つ', reading_hiragana: 'たもつ', meaning: '保持;保持' };
  const review = {
    schemaVersion: 2,
    identity,
    status: 'reviewed',
    confidence: 'high',
    note_zh: '他动词；以を标记保持的对象。',
  };
  const vocab = {
    id: 'OV-2855',
    word: '保つ',
    reading: 'たもつ',
    meaning_zh: '保持;保持',
    notes_zh: '本章义：保持;保持。',
    examples: [{ ja: '習慣を保ちます。', zh: '保持习惯。' }],
  };
  write(MASTER, [
    {
      ...identity,
      index: 2149,
      source_index: 2149,
      textbook_uid: UID,
      meanings_zh: ['保持;保持'],
      example_sentence_ja: '習慣を保ちます。',
      example_sentences: vocab.examples,
      textbook_sources: [{ book_id: 'KotobaFlow2', lesson_id: 'lesson_15' }],
      curriculum_extension: vocab,
      ...(schemaVersion === 2 ? { lexical_review: review } : {}),
    },
  ]);
  write(CANONICAL, {
    book_id: 'KotobaFlow2',
    items: [
      {
        meta: { item_id: 'lesson_15' },
        lesson: {
          vocab: [vocab],
          original_vocabulary: [vocab],
          body: {
            text: '習慣を保ちます。',
            vocabulary: [{ vocabulary_id: 'OV-2855', meaning: '保持;保持' }],
          },
          annotation_extension: [{ vocabulary_id: 'OV-2855', meaning_zh: '保持习惯' }],
        },
      },
    ],
  });
  write(ENRICHMENT, {
    schemaVersion,
    book_id: 'KotobaFlow2',
    lesson_id: 'lesson_15',
    entries: [
      {
        textbook_uid: UID,
        index: 2149,
        word: identity.word,
        reading_hiragana: identity.reading_hiragana,
        context_meaning_zh: identity.meaning,
        senses: [{ meaning_zh: identity.meaning, meaning_ja: '状態を変えずに続ける。' }],
        usage_note_zh: '源义重复。',
        pos: { primary: 'verb' },
        transitivity: { value: 'transitive' },
        register: { formality: 'neutral' },
        style: { medium: 'neutral' },
        ...(schemaVersion === 2 ? { lexical_review: review } : {}),
      },
    ],
  });
  const plan = {
    schemaVersion: 1,
    entries: [
      {
        uid: UID,
        index: 2149,
        word: identity.word,
        reading_hiragana: identity.reading_hiragana,
        book_id: 'KotobaFlow2',
        lesson_id: 'lesson_15',
        curriculum_id: 'OV-2855',
        meaning: {
          before: identity.meaning,
          after: '保持',
          canonical_pointers: [
            '/items/0/lesson/vocab/0/meaning_zh',
            '/items/0/lesson/original_vocabulary/0/meaning_zh',
            '/items/0/lesson/body/vocabulary/0/meaning',
          ],
        },
        source_note: {
          before: '本章义：保持;保持。',
          after: '本章义：保持。',
          canonical_pointers: [
            '/items/0/lesson/vocab/0/notes_zh',
            '/items/0/lesson/original_vocabulary/0/notes_zh',
          ],
        },
        enrichment_changes: [{ pointer: '/usage_note_zh', before: '源义重复。', after: '对象用を。' }],
      },
    ],
  };
  return { root, plan, read, write };
}

test('synchronizes source replicas and schema 2 identities; preserves spoken text, IDs and metadata', (t) => {
  const { root, plan, read } = fixture(t);
  const before = read(MASTER)[0];
  const metadataBefore = read(ENRICHMENT).entries[0];
  const prepared = prepareChanges(root, plan);
  assert.equal(read(MASTER)[0].meaning, '保持;保持', 'preparation must not write');
  writeChanges(prepared);
  const after = read(MASTER)[0];
  assert.equal(after.meaning, '保持');
  assert.deepEqual(after.meanings_zh, ['保持']);
  assert.equal(after.curriculum_extension.meaning_zh, '保持');
  assert.equal(after.curriculum_extension.notes_zh, '本章义：保持。');
  assert.equal(after.lexical_review.identity.meaning, '保持');
  for (const key of [
    'textbook_uid',
    'index',
    'source_index',
    'word',
    'reading_hiragana',
    'example_sentence_ja',
    'example_sentences',
  ])
    assert.deepEqual(after[key], before[key]);
  assert.deepEqual(after.curriculum_extension.examples, before.curriculum_extension.examples);
  const addition = read(ENRICHMENT).entries[0];
  assert.equal(addition.lexical_review.identity.meaning, '保持');
  assert.equal(addition.context_meaning_zh, '保持');
  assert.equal(addition.senses[0].meaning_zh, '保持');
  for (const key of ['pos', 'transitivity', 'register', 'style'])
    assert.deepEqual(addition[key], metadataBefore[key]);
  assert.equal(addition.lexical_review.note_zh, metadataBefore.lexical_review.note_zh);
  const lesson = read(CANONICAL).items[0].lesson;
  assert.equal(lesson.body.vocabulary[0].meaning, '保持');
  assert.equal(lesson.annotation_extension[0].meaning_zh, '保持习惯', 'narrow context gloss remains');
  assert.equal(lesson.body.text, '習慣を保ちます。');
  assert.equal(prepareChanges(root, plan).operations.length, 0, 'second run is idempotent');
});

test('supports historical schema 1 without inventing lexical metadata', (t) => {
  const { root, plan, read } = fixture(t, 1);
  writeChanges(prepareChanges(root, plan));
  assert.equal(read(ENRICHMENT).entries[0].context_meaning_zh, '保持');
  assert.equal(read(ENRICHMENT).entries[0].lexical_review, undefined);
});

test('late canonical drift fails before any source file is written', (t) => {
  const { root, plan, read, write } = fixture(t);
  const canonical = read(CANONICAL);
  canonical.items[0].lesson.body.vocabulary[0].meaning = '别人正在修改的释义';
  write(CANONICAL, canonical);
  assert.throws(() => prepareChanges(root, plan), /Source collation drift/);
  assert.equal(read(MASTER)[0].meaning, '保持;保持');
  assert.equal(read(ENRICHMENT).entries[0].context_meaning_zh, '保持;保持');
  assert.equal(read(CANONICAL).items[0].lesson.vocab[0].meaning_zh, '保持;保持');
});

test('refuses identity or lexical-review drift, including a missing schema 2 review', (t) => {
  const { root, plan, read, write } = fixture(t);
  const original = read(ENRICHMENT);
  for (const mutation of [
    (entry) => {
      entry.reading_hiragana = 'もつ';
    },
    (entry) => {
      entry.lexical_review.identity.meaning = '别的义';
    },
    (entry) => {
      delete entry.lexical_review;
    },
  ]) {
    const copy = structuredClone(original);
    mutation(copy.entries[0]);
    write(ENRICHMENT, copy);
    assert.throws(() => prepareChanges(root, plan), /identity mismatch|Missing schema 2/);
    assert.equal(read(MASTER)[0].meaning, '保持;保持');
  }
});

test('rejects wrong canonical ownership and disallowed spoken-text edits', (t) => {
  const { root, plan, read, write } = fixture(t);
  const badPlan = structuredClone(plan);
  badPlan.entries[0].enrichment_changes.push({ pointer: '/senses/0/example_ja', before: 'a', after: 'b' });
  assert.throws(() => prepareChanges(root, badPlan), /Unsafe enrichment pointer/);
  const canonical = read(CANONICAL);
  canonical.items[0].lesson.body.vocabulary[0].vocabulary_id = 'OV-other';
  write(CANONICAL, canonical);
  assert.throws(() => prepareChanges(root, plan), /Canonical vocabulary identity mismatch/);
  assert.equal(read(MASTER)[0].meaning, '保持;保持');
});

test('detects a concurrent writer between preparation and apply', (t) => {
  const { root, plan, read, write } = fixture(t);
  const prepared = prepareChanges(root, plan);
  const addition = read(ENRICHMENT);
  addition.entries[0].usage_note_zh = '另一个任务的新说明';
  write(ENRICHMENT, addition);
  assert.throws(() => writeChanges(prepared), /Concurrent source edit/);
  assert.equal(read(MASTER)[0].meaning, '保持;保持');
});

test('note-only correction keeps source meaning and guards it against drift', (t) => {
  const { root, plan, read, write } = fixture(t);
  delete plan.entries[0].meaning;
  delete plan.entries[0].source_note;
  plan.entries[0].meaning_unchanged = '保持;保持';
  const prepared = prepareChanges(root, plan);
  assert.deepEqual(prepared.changedFiles, [ENRICHMENT]);
  writeChanges(prepared);
  assert.equal(read(MASTER)[0].meaning, '保持;保持');
  const master = read(MASTER);
  master[0].meaning = '异义';
  write(MASTER, master);
  assert.throws(() => prepareChanges(root, plan), /Meaning identity mismatch/);
});

test('restores every file, including a partially written failing target', (t) => {
  const { root, plan } = fixture(t);
  const prepared = prepareChanges(root, plan);
  const write = fs.writeFileSync;
  let writes = 0;
  const stub = t.mock.method(fs, 'writeFileSync', (target, text, ...args) => {
    writes++;
    if (writes === 3) {
      write(target, 'partial write');
      throw Error('simulated disk write failure');
    }
    return write(target, text, ...args);
  });
  assert.throws(() => writeChanges(prepared), /simulated disk write failure/);
  stub.mock.restore();
  for (const relative of prepared.changedFiles)
    assert.equal(fs.readFileSync(path.join(root, relative), 'utf8'), prepared.files.get(relative).original);
});

test('attempts remaining restorations after rollback failure and retains the original error', (t) => {
  const { root, plan } = fixture(t);
  const prepared = prepareChanges(root, plan);
  const write = fs.writeFileSync;
  let writes = 0;
  const stub = t.mock.method(fs, 'writeFileSync', (target, text, ...args) => {
    writes++;
    if (writes === 3) throw Error('original write failed');
    if (writes === 4) throw Error('first restoration failed');
    return write(target, text, ...args);
  });
  assert.throws(
    () => writeChanges(prepared),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.cause.message, 'original write failed');
      assert.equal(error.errors.length, 2);
      return true;
    },
  );
  stub.mock.restore();
  assert.equal(writes, 6, 'both later files were still restored');
  for (const relative of prepared.changedFiles.slice(1))
    assert.equal(fs.readFileSync(path.join(root, relative), 'utf8'), prepared.files.get(relative).original);
});
