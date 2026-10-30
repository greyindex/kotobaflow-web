const fs = require('node:fs');
const path = require('node:path');

const PLAN = 'docs/evidence/vocab-source-collation-2026-10-12/safe-changes.json';
const MASTER = 'data/textbook/kotobaflow/textbook_vocab_full.v3.json';

function at(object, pointer) {
  return pointer
    .split('/')
    .slice(1)
    .reduce((value, key) => value?.[key], object);
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Validate every before value in memory before any file is written. The explicit plan
// only permits meaning/definition/note edits; spoken text and learning IDs cannot change.
function prepareChanges(root, plan) {
  if (plan.schemaVersion !== 1 || !Array.isArray(plan.entries) || !plan.entries.length)
    throw Error('Invalid source collation plan');
  const files = new Map();
  const operations = [];
  const seen = new Set();
  const read = (relative) => {
    if (!files.has(relative)) {
      const original = fs.readFileSync(path.join(root, relative), 'utf8');
      if (original.startsWith('version https://git-lfs')) throw Error('Run git lfs pull first');
      files.set(relative, { original, data: JSON.parse(original) });
    }
    return files.get(relative).data;
  };
  const patch = (relative, pointer, before, after) => {
    if (same(before, after)) throw Error('No-op patch: ' + pointer);
    const data = read(relative);
    const actual = at(data, pointer);
    if (same(actual, after)) return;
    if (!same(actual, before)) throw Error('Source collation drift: ' + relative + '#' + pointer);
    const parts = pointer.split('/');
    const key = parts.pop();
    const parent = at(data, parts.join('/'));
    if (!parent || !Object.hasOwn(parent, key)) throw Error('Missing patch target: ' + pointer);
    parent[key] = structuredClone(after);
    operations.push({ file: relative, pointer, before, after });
  };
  const master = read(MASTER);
  if (!Array.isArray(master)) throw Error('Invalid source vocabulary');
  for (const entry of plan.entries) {
    const { uid, index, word, reading_hiragana: reading, book_id: book, lesson_id: lesson } = entry;
    if (
      !/^cfv-[0-9a-f]{16}$/.test(uid) ||
      !Number.isSafeInteger(index) ||
      typeof word !== 'string' ||
      typeof reading !== 'string' ||
      !/^KotobaFlow[1-4]$/.test(book) ||
      !/^lesson_\d{2}$/.test(lesson) ||
      seen.has(uid)
    )
      throw Error('Invalid/duplicate source collation identity: ' + uid);
    seen.add(uid);
    const matches = master.map((row, i) => ({ row, i })).filter(({ row }) => row.textbook_uid === uid);
    if (matches.length !== 1) throw Error('Missing/duplicate source UID: ' + uid);
    const { row, i } = matches[0];
    if (
      row.index !== index ||
      row.word !== word ||
      row.reading_hiragana !== reading ||
      row.curriculum_extension?.id !== entry.curriculum_id ||
      !row.textbook_sources?.some((source) => source.book_id === book && source.lesson_id === lesson)
    )
      throw Error('Source identity mismatch: ' + uid);

    const enrichmentFile = `data/textbook/kotobaflow/vocab_enrichment/${book}-${lesson}.json`;
    const enrichment = read(enrichmentFile);
    if (
      ![1, 2].includes(enrichment.schemaVersion) ||
      enrichment.book_id !== book ||
      enrichment.lesson_id !== lesson
    )
      throw Error('Enrichment lesson mismatch: ' + uid);
    const enriched = enrichment.entries
      .map((value, position) => ({ value, position }))
      .filter(({ value }) => value.textbook_uid === uid);
    if (enriched.length !== 1) throw Error('Missing/duplicate enrichment UID: ' + uid);
    const { value: addition, position } = enriched[0];
    if (addition.index !== index || addition.word !== word || addition.reading_hiragana !== reading)
      throw Error('Enrichment identity mismatch: ' + uid);

    const expectedMeanings = entry.meaning
      ? [entry.meaning.before, entry.meaning.after]
      : [entry.meaning_unchanged];
    for (const value of [row.meaning, addition.context_meaning_zh, addition.senses?.[0]?.meaning_zh]) {
      if (!expectedMeanings.includes(value)) throw Error('Meaning identity mismatch: ' + uid);
    }
    const reviews = [
      { value: row.lexical_review, file: MASTER, pointer: `/${i}/lexical_review/identity/meaning` },
      {
        value: addition.lexical_review,
        file: enrichmentFile,
        pointer: `/entries/${position}/lexical_review/identity/meaning`,
      },
    ];
    if (enrichment.schemaVersion === 2 && !addition.lexical_review)
      throw Error('Missing schema 2 lexical review: ' + uid);
    for (const review of reviews) {
      if (!review.value) continue;
      if (
        review.value.identity?.word !== word ||
        review.value.identity?.reading_hiragana !== reading ||
        !expectedMeanings.includes(review.value.identity?.meaning)
      )
        throw Error('Lexical review identity mismatch: ' + uid);
    }

    if (entry.meaning) {
      const { before, after, canonical_pointers: pointers } = entry.meaning;
      if (typeof before !== 'string' || typeof after !== 'string' || !after.trim())
        throw Error('Invalid meaning revision: ' + uid);
      if (!Array.isArray(pointers) || pointers.length < 2 || new Set(pointers).size !== pointers.length)
        throw Error('Incomplete canonical meaning plan: ' + uid);
      const canonicalFile = `data/textbook/canonical_books/${book}.bundle.json`;
      const canonical = read(canonicalFile);
      const lessonIndices = canonical.items
        .map((item, ordinal) => ({ item, ordinal }))
        .filter(({ item }) => item.meta?.item_id === lesson);
      if (lessonIndices.length !== 1) throw Error('Canonical lesson mismatch: ' + uid);
      const lessonPrefix = `/items/${lessonIndices[0].ordinal}/lesson/`;
      const kinds = new Set();
      for (const pointer of pointers) {
        if (!pointer.startsWith(lessonPrefix) || !/\/(meaning|meaning_zh)$/.test(pointer))
          throw Error('Unsafe canonical pointer: ' + uid);
        const parent = at(canonical, pointer.slice(0, pointer.lastIndexOf('/')));
        if (parent?.id !== entry.curriculum_id && parent?.vocabulary_id !== entry.curriculum_id)
          throw Error('Canonical vocabulary identity mismatch: ' + uid);
        if (pointer.startsWith(lessonPrefix + 'vocab/')) kinds.add('vocab');
        if (pointer.startsWith(lessonPrefix + 'original_vocabulary/')) kinds.add('original_vocabulary');
        patch(canonicalFile, pointer, before, after);
      }
      if (kinds.size !== 2) throw Error('Missing canonical source replica: ' + uid);
      patch(MASTER, `/${i}/meaning`, before, after);
      patch(MASTER, `/${i}/meanings_zh`, [before], [after]);
      patch(MASTER, `/${i}/curriculum_extension/meaning_zh`, before, after);
      patch(enrichmentFile, `/entries/${position}/context_meaning_zh`, before, after);
      patch(enrichmentFile, `/entries/${position}/senses/0/meaning_zh`, before, after);
      for (const review of reviews) {
        if (review.value) patch(review.file, review.pointer, before, after);
      }
    }
    if (entry.source_note) {
      const { before, after, canonical_pointers: pointers } = entry.source_note;
      if (typeof before !== 'string' || typeof after !== 'string' || !after.trim())
        throw Error('Invalid source note revision: ' + uid);
      const canonicalFile = `data/textbook/canonical_books/${book}.bundle.json`;
      const canonical = read(canonicalFile);
      if (!Array.isArray(pointers) || pointers.length !== 2 || new Set(pointers).size !== 2)
        throw Error('Incomplete canonical source note plan: ' + uid);
      const kinds = new Set();
      for (const pointer of pointers) {
        const match = /^\/items\/(\d+)\/lesson\/(vocab|original_vocabulary)\/\d+\/notes_zh$/.exec(pointer);
        const parent = at(canonical, pointer.slice(0, pointer.lastIndexOf('/')));
        if (
          !match ||
          canonical.items[Number(match[1])]?.meta?.item_id !== lesson ||
          parent?.id !== entry.curriculum_id
        )
          throw Error('Unsafe canonical source note pointer: ' + uid);
        kinds.add(match[2]);
        patch(canonicalFile, pointer, before, after);
      }
      if (kinds.size !== 2) throw Error('Missing canonical source note replica: ' + uid);
      patch(MASTER, `/${i}/curriculum_extension/notes_zh`, before, after);
    }
    for (const change of entry.enrichment_changes || []) {
      if (!/^\/(usage_note_zh|senses\/[0-2]\/meaning_(zh|ja))$/.test(change.pointer))
        throw Error('Unsafe enrichment pointer: ' + uid);
      if (typeof change.before !== 'string' || typeof change.after !== 'string' || !change.after.trim())
        throw Error('Invalid enrichment revision: ' + uid);
      if (change.pointer === '/senses/0/meaning_zh')
        throw Error('First sense must use meaning synchronization');
      patch(enrichmentFile, `/entries/${position}${change.pointer}`, change.before, change.after);
    }
  }
  const changedFiles = [...new Set(operations.map((operation) => operation.file))];
  return { root, files, operations, changedFiles, records: plan.entries.length };
}

function writeChanges(prepared) {
  // Catch another writer before replacing anything. No data is written on validation failure.
  for (const relative of prepared.changedFiles) {
    if (fs.readFileSync(path.join(prepared.root, relative), 'utf8') !== prepared.files.get(relative).original)
      throw Error('Concurrent source edit: ' + relative);
  }
  const written = [];
  try {
    for (const relative of prepared.changedFiles) {
      written.push(relative);
      fs.writeFileSync(
        path.join(prepared.root, relative),
        JSON.stringify(prepared.files.get(relative).data, null, 2) + '\n',
      );
    }
  } catch (error) {
    const restorationErrors = [];
    for (const relative of written) {
      try {
        fs.writeFileSync(path.join(prepared.root, relative), prepared.files.get(relative).original);
      } catch (restorationError) {
        restorationErrors.push(Error('Could not restore ' + relative, { cause: restorationError }));
      }
    }
    if (restorationErrors.length)
      throw new AggregateError(
        [error, ...restorationErrors],
        'Source collation write failed; restoration also failed: ' +
          restorationErrors.map((item) => item.message).join('; '),
        { cause: error },
      );
    throw error;
  }
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || args.some((arg) => !['--check', '--write', '--dry-run'].includes(arg)))
      throw Error('Usage: node tools/apply_kotobaflow_source_collation.cjs [--dry-run|--write|--check]');
    const root = path.resolve(__dirname, '..');
    const prepared = prepareChanges(root, JSON.parse(fs.readFileSync(path.join(root, PLAN), 'utf8')));
    if (args[0] === '--check' && prepared.operations.length)
      throw Error('Source collation changes not applied: ' + prepared.operations.length);
    if (args[0] === '--write') writeChanges(prepared);
    console.log(
      JSON.stringify({
        mode: args[0] || '--dry-run',
        records: prepared.records,
        changedFields: prepared.operations.length,
        changedFiles: prepared.changedFiles,
      }),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { prepareChanges, writeChanges };
