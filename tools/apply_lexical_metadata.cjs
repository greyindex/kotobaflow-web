const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { isDeepStrictEqual } = require('node:util');
const lexicalMetadata = require('../js/core/lexical-metadata.js');
const { loadEnrichment } = require('./kotobaflow_vocab_enrichment.cjs');

const QA_REL = 'local/qa/vocab-metadata-v2-2026-10-12';
const MAIN = 'data/taxonomy_annotations_gemini_3_flash_enriched.json';
const XIN = 'data/textbook/canonical_textbook_vocab/textbook_vocab_full.v3.json';
const XIN_V4 = 'data/textbook/canonical_textbook_vocab/textbook_vocab_full.v4.enrichment.json';
const KOTOBA = 'data/textbook/kotobaflow/textbook_vocab_full.v3.json';
const OUTPUT_FIELDS = ['pos', 'transitivity', 'register', 'style', 'lexical_review'];
const COUNT_EXPECTED = { main: 12528, xinbian: 6127, kotobaflow: 6518 };
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const jsonBytes = (value) => Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8');
const readBytes = (file) => fs.readFileSync(file);
const readJSON = (file) => JSON.parse(readBytes(file).toString('utf8'));
const fail = (message) => {
  throw new Error(message);
};

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(label + ' must be an object');
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.join('|') !== wanted.join('|')) fail(label + ' has unexpected/missing keys');
}

function parseList(value, label) {
  if (typeof value !== 'string') fail(label + ' must be a comma-separated string');
  if (!value) return [];
  const result = value.split(',');
  if (result.some((part) => !part || part !== part.trim()) || new Set(result).size !== result.length)
    fail(label + ' has empty, padded, or duplicate values');
  return result;
}

function validateFields(fields) {
  return lexicalMetadata.normalize(fields);
}

function parseVerdict(verdict, record, role) {
  if (!Array.isArray(verdict) || verdict.length !== 17) fail(role + ' verdict must have 17 cells');
  if (verdict[0] !== record.record_id) fail(role + ' record ID mismatch: ' + record.record_id);
  const fields = validateFields({
    pos: {
      primary: verdict[1],
      classes: parseList(verdict[2], 'classes'),
      subtypes: parseList(verdict[3], 'subtypes'),
      conjugation: verdict[4],
    },
    transitivity: { value: verdict[5], scope: verdict[6] },
    register: {
      formality: verdict[7],
      politeness: parseList(verdict[8], 'politeness'),
      usage: parseList(verdict[9], 'usage'),
    },
    style: { medium: verdict[10], genres: parseList(verdict[11], 'genres') },
  });
  if (!['reviewed', 'needs_review'].includes(verdict[12])) fail('Invalid review status: ' + record.record_id);
  if (!['high', 'medium', 'low'].includes(verdict[13])) fail('Invalid confidence: ' + record.record_id);
  if (verdict[12] === 'needs_review' && verdict[13] === 'high')
    fail('needs_review cannot have high confidence');
  const basis = parseList(verdict[14], 'basis');
  if (!basis.length || basis.some((item) => !['dictionary', 'grammar', 'context', 'usage'].includes(item)))
    fail('Invalid review basis: ' + record.record_id);
  const note = verdict[15];
  if (
    typeof note !== 'string' ||
    note !== note.trim() ||
    [...note].length < 8 ||
    [...note].length > 500 ||
    /[\u0000-\u001f\u007f]/.test(note) ||
    !/[\u4e00-\u9fff]/.test(note)
  )
    fail('Invalid Chinese review note: ' + record.record_id);
  const sequences = verdict[16];
  if (
    !Array.isArray(sequences) ||
    new Set(sequences).size !== sequences.length ||
    sequences.some((value) => !Number.isSafeInteger(value) || value < 1)
  )
    fail('Invalid dictionary sequences: ' + record.record_id);
  const availableSequences = new Set((record.dictionary || []).map((row) => row.sequence));
  if (sequences.some((value) => !availableSequences.has(value)))
    fail('Dictionary sequence not in frozen input: ' + record.record_id);
  if (basis.includes('dictionary') && !sequences.length)
    fail('Dictionary basis requires a cited sequence: ' + record.record_id);
  const identity = record.effective_identity;
  exactKeys(identity, ['word', 'reading_hiragana', 'meaning'], 'effective identity');
  for (const field of ['word', 'reading_hiragana', 'meaning'])
    if (typeof identity[field] !== 'string' || /[\u0000-\u001f\u007f]/.test(identity[field]))
      fail('Invalid baseline identity: ' + record.record_id);
  if (!identity.word.trim()) fail('Empty baseline word identity: ' + record.record_id);
  return {
    ...fields,
    lexical_review: {
      schemaVersion: 2,
      status: verdict[12],
      confidence: verdict[13],
      basis,
      note_zh: note,
      dictionary_sequences: sequences,
      identity: { ...identity },
    },
  };
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sameExcept(original, updated, allowedKeys, label) {
  const before = deepClone(original);
  const after = deepClone(updated);
  for (const key of allowedKeys) {
    delete before[key];
    delete after[key];
  }
  if (JSON.stringify(before) !== JSON.stringify(after)) fail('Non-allowed change detected in ' + label);
}

const KOTOBA_ENTRY_ALLOWED = [...OUTPUT_FIELDS, 'pos_ja', 'pos_zh', 'register_zh'];
function validateKotobaDocumentUpdate(original, updated, label = 'KotobaFlow enrichment') {
  if (
    !original ||
    !updated ||
    original.schemaVersion !== 1 ||
    updated.schemaVersion !== 2 ||
    !Array.isArray(original.entries) ||
    !Array.isArray(updated.entries) ||
    original.entries.length !== updated.entries.length
  )
    fail('Invalid KotobaFlow schema migration: ' + label);
  sameExcept(original, updated, ['schemaVersion', 'entries'], label);
  for (let index = 0; index < original.entries.length; index++)
    sameExcept(
      original.entries[index],
      updated.entries[index],
      KOTOBA_ENTRY_ALLOWED,
      label + '/entry-' + index,
    );
  return true;
}

function attachMetadata(target, metadata, label) {
  const updated = { ...target, ...metadata };
  sameExcept(target, updated, OUTPUT_FIELDS, label);
  return updated;
}

function parseArgs(argv) {
  let input = null;
  let mode = 'dry-run';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input') input = argv[++i];
    else if (argv[i] === '--apply' && mode === 'dry-run') mode = 'apply';
    else if (argv[i] === '--check' && mode === 'dry-run') mode = 'check';
    else if (argv[i] === '--verify-current' && mode === 'dry-run') mode = 'verify-current';
    else fail('Unknown or conflicting argument: ' + argv[i]);
  }
  if (mode === 'verify-current') {
    if (input) fail('--verify-current does not accept --input');
    return { input: null, mode };
  }
  if (!input)
    fail('Usage: node tools/apply_lexical_metadata.cjs --input <batch-directory> [--apply|--check]');
  return { input: path.resolve(input), mode };
}

function relativeSafe(base, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative)) fail('Unsafe manifest path');
  const full = path.resolve(base, relative);
  if (!full.startsWith(path.resolve(base) + path.sep)) fail('Manifest path escapes its root: ' + relative);
  return full;
}

function readBaselineFile(repoRoot, qaRoot, relative, expectedHash) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..'))
    fail('Unsafe source path in manifest: ' + relative);
  const baselinePath = path.join(qaRoot, 'baseline', relative);
  const bytes = readBytes(baselinePath);
  if (sha(bytes) !== expectedHash) fail('Baseline hash mismatch: ' + relative);
  const currentPath = path.join(repoRoot, relative);
  return { baselinePath, currentPath, bytes, value: JSON.parse(bytes.toString('utf8')) };
}

function buildPlan({ repoRoot, inputDir }) {
  const manifestPath = path.join(inputDir, 'manifest.json');
  const manifestBytes = readBytes(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.schemaVersion !== 2 || manifest.baseline !== 'b969a970c11800f715c889b362d9abd11a3960ab')
    fail('Unsupported metadata batch manifest or baseline');
  if (!manifest.microjobs || !Array.isArray(manifest.microjobs) || !manifest.sourceHashes)
    fail('Manifest requires microjobs and sourceHashes');
  const qaRoot = path.join(repoRoot, QA_REL);
  const qaRelative = path.relative(repoRoot, inputDir);
  const microjobNames = new Set();
  const allRecords = new Map();
  const evidence = [];
  const recordVerdicts = new Map();

  for (const entry of manifest.microjobs) {
    if (!entry || typeof entry.job !== 'string' || microjobNames.has(entry.job))
      fail('Missing or duplicate microjob');
    microjobNames.add(entry.job);
    const inputBytes = readBytes(relativeSafe(inputDir, entry.input));
    if (sha(inputBytes) !== entry.input_sha256) fail('Frozen microjob input hash mismatch: ' + entry.job);
    const input = JSON.parse(inputBytes.toString('utf8'));
    if (
      input.schemaVersion !== 2 ||
      input.job !== entry.job ||
      input.baseline !== manifest.baseline ||
      !Array.isArray(input.records)
    )
      fail('Invalid input envelope: ' + entry.job);
    if (
      entry.count !== input.records.length ||
      !Array.isArray(entry.record_ids) ||
      JSON.stringify(entry.record_ids) !== JSON.stringify(input.records.map((record) => record.record_id))
    )
      fail('Manifest microjob coverage differs from input: ' + entry.job);
    const authorPath = relativeSafe(inputDir, entry.author);
    const reviewPath = relativeSafe(inputDir, entry.review);
    const authorBytes = readBytes(authorPath);
    const reviewBytes = readBytes(reviewPath);
    const authorHash = sha(authorBytes);
    const author = JSON.parse(authorBytes.toString('utf8'));
    const review = JSON.parse(reviewBytes.toString('utf8'));
    for (const [role, output] of [
      ['author', author],
      ['review', review],
    ]) {
      if (
        output.schemaVersion !== 2 ||
        output.job !== entry.job ||
        output.input_sha256 !== entry.input_sha256 ||
        !Array.isArray(output.verdicts)
      )
        fail('Invalid ' + role + ' result envelope: ' + entry.job);
      if (output.verdicts.length !== input.records.length)
        fail('Incomplete ' + role + ' verdicts: ' + entry.job);
    }
    if (review.author_sha256 !== authorHash) fail('Review is stale against author output: ' + entry.job);
    const recordsById = new Map(input.records.map((record) => [record.record_id, record]));
    if (recordsById.size !== input.records.length) fail('Duplicate input IDs: ' + entry.job);
    const authorById = new Map(author.verdicts.map((row) => [row && row[0], row]));
    const reviewById = new Map(review.verdicts.map((row) => [row && row[0], row]));
    if (authorById.size !== input.records.length || reviewById.size !== input.records.length)
      fail('Duplicate or missing output IDs: ' + entry.job);
    for (const record of input.records) {
      const id = record.record_id;
      if (allRecords.has(id)) fail('Duplicate record across microjobs: ' + id);
      const authorMetadata = parseVerdict(authorById.get(id), record, 'author');
      const reviewedMetadata = parseVerdict(reviewById.get(id), record, 'review');
      allRecords.set(id, record);
      recordVerdicts.set(id, reviewedMetadata);
      evidence.push({
        record_id: id,
        microjob: entry.job,
        input_sha256: entry.input_sha256,
        author_sha256: authorHash,
        review_sha256: sha(reviewBytes),
        author_metadata_sha256: sha(Buffer.from(JSON.stringify(authorMetadata))),
        reviewed_metadata_sha256: sha(Buffer.from(JSON.stringify(reviewedMetadata))),
      });
    }
  }

  if (allRecords.size !== 25173 || allRecords.size !== manifest.recordCount)
    fail('Required 25,173 record coverage was not met');
  const datasetCounts = { main: 0, xinbian: 0, kotobaflow: 0 };
  const expectedPrefixes = { main: 'M', xinbian: 'X', kotobaflow: 'K' };
  for (const [id, record] of allRecords) {
    if (!Object.hasOwn(datasetCounts, record.dataset)) fail('Unknown dataset in ' + id);
    datasetCounts[record.dataset]++;
    const [prefix, number] = id.split(':');
    if (prefix !== expectedPrefixes[record.dataset] || Number(number) !== record.index)
      fail('record_id/index/baseline mismatch: ' + id);
  }
  for (const dataset of Object.keys(COUNT_EXPECTED)) {
    if (
      datasetCounts[dataset] !== COUNT_EXPECTED[dataset] ||
      manifest.sourceCounts[dataset] !== COUNT_EXPECTED[dataset]
    )
      fail('Dataset coverage mismatch: ' + dataset);
  }

  const baselineSources = new Map();
  for (const [relative, expectedHash] of Object.entries(manifest.sourceHashes)) {
    baselineSources.set(relative, readBaselineFile(repoRoot, qaRoot, relative, expectedHash));
  }
  const requireSource = (relative) => {
    const source = baselineSources.get(relative);
    if (!source) fail('Missing frozen source hash: ' + relative);
    return source;
  };
  const mainSource = requireSource(MAIN);
  const xinSource = requireSource(XIN);
  const xinV4Source = requireSource(XIN_V4);
  const kotobaSource = requireSource(KOTOBA);
  const mainRows = mainSource.value;
  const xinRows = xinSource.value;
  const xinV4Rows = xinV4Source.value;
  const kotobaRows = kotobaSource.value;
  for (const [name, rows] of [
    [MAIN, mainRows],
    [XIN, xinRows],
    [XIN_V4, xinV4Rows],
    [KOTOBA, kotobaRows],
  ])
    if (!Array.isArray(rows)) fail('Expected array source: ' + name);
  const indexes = {
    main: new Map(mainRows.map((row, position) => [Number(row.index), { row, position }])),
    xinbian: new Map(xinRows.map((row, position) => [Number(row.index), { row, position }])),
    kotobaflow: new Map(kotobaRows.map((row, position) => [Number(row.index), { row, position }])),
  };
  const xinV4Indexes = new Map(xinV4Rows.map((row, position) => [Number(row.index), { row, position }]));
  if (xinV4Indexes.size !== COUNT_EXPECTED.xinbian) fail('Duplicate/missing XinBian v4 indexes');
  for (const [dataset, map] of Object.entries(indexes)) {
    if (map.size !== COUNT_EXPECTED[dataset]) fail('Duplicate/missing source indexes: ' + dataset);
  }

  const enrichmentDocs = new Map();
  for (const relative of baselineSources.keys()) {
    if (!relative.startsWith('data/textbook/kotobaflow/vocab_enrichment/')) continue;
    const file = requireSource(relative);
    enrichmentDocs.set(relative, file.value);
  }
  const entryByUid = new Map();
  for (const [relative, doc] of enrichmentDocs) {
    if (!Array.isArray(doc.entries)) fail('Invalid KotobaFlow enrichment source: ' + relative);
    for (const entry of doc.entries) {
      if (entryByUid.has(entry.textbook_uid))
        fail('Duplicate KotobaFlow enrichment UID: ' + entry.textbook_uid);
      entryByUid.set(entry.textbook_uid, { relative, entry });
    }
  }

  const changedSources = new Map();
  const mainUpdated = deepClone(mainRows);
  const xinUpdated = deepClone(xinRows);
  const xinV4Updated = deepClone(xinV4Rows);
  const kotobaUpdatedDocs = new Map([...enrichmentDocs].map(([relative, doc]) => [relative, deepClone(doc)]));
  const seenTargets = { main: new Set(), xinbian: new Set(), kotobaflow: new Set() };

  for (const [id, record] of allRecords) {
    const sourceFile = record.source_file;
    requireSource(sourceFile);
    const sourceAtIndex = indexes[record.dataset].get(Number(record.index));
    const raw = sourceAtIndex && sourceAtIndex.row;
    if (!raw || sourceFile !== { main: MAIN, xinbian: XIN, kotobaflow: KOTOBA }[record.dataset])
      fail('Baseline record source mismatch: ' + id);
    if (
      record.textbook_uid !== (raw.textbook_uid || null) ||
      sha(Buffer.from(JSON.stringify(raw))) !== record.guard_hash
    )
      fail('Baseline record_id/guard hash mismatch: ' + id);
    const metadata = recordVerdicts.get(id);
    const identity = record.effective_identity;
    if (
      record.dataset === 'kotobaflow' &&
      (raw.word !== identity.word ||
        raw.reading_hiragana !== identity.reading_hiragana ||
        raw.meaning !== identity.meaning)
    )
      fail('KotobaFlow effective identity differs from canonical source: ' + id);
    if (record.dataset === 'main') {
      if (
        raw.word !== identity.word ||
        raw.reading_hiragana !== identity.reading_hiragana ||
        raw.meaning !== identity.meaning
      )
        fail('Main review identity differs from source row: ' + id);
      mainUpdated[sourceAtIndex.position] = attachMetadata(mainUpdated[sourceAtIndex.position], metadata, id);
      seenTargets.main.add(id);
    } else if (record.dataset === 'xinbian') {
      xinUpdated[sourceAtIndex.position] = attachMetadata(xinUpdated[sourceAtIndex.position], metadata, id);
      const v4Index = xinV4Indexes.get(Number(record.index));
      const v4 = v4Index && xinV4Updated[v4Index.position];
      if (!v4 || v4.textbook_uid !== raw.textbook_uid) fail('XinBian v4 UID/index mismatch: ' + id);
      const v4Updated = { ...v4, ...metadata };
      v4Updated.display_pos_ja = lexicalMetadata.posLabel(metadata.pos, 'ja');
      v4Updated.display_pos_zh = lexicalMetadata.posLabel(metadata.pos, 'zh');
      v4Updated.conjugation_class_ja = lexicalMetadata.conjugationLabel(metadata.pos, 'ja');
      v4Updated.transitivity_label_zh = lexicalMetadata.transitivityLabel(metadata.transitivity, 'zh');
      sameExcept(
        v4,
        v4Updated,
        [
          ...OUTPUT_FIELDS,
          'display_pos_ja',
          'display_pos_zh',
          'conjugation_class_ja',
          'transitivity_label_zh',
        ],
        id + ' v4',
      );
      xinV4Updated[v4Index.position] = v4Updated;
      seenTargets.xinbian.add(id);
    } else {
      if (
        !record.enrichment_file ||
        !manifest.sourceHashes[record.enrichment_file] ||
        !record.enrichment_file.startsWith('data/textbook/kotobaflow/vocab_enrichment/')
      )
        fail('Missing KotobaFlow enrichment file: ' + id);
      const location = entryByUid.get(raw.textbook_uid);
      if (!location || location.relative !== record.enrichment_file)
        fail('KotobaFlow enrichment UID/file mismatch: ' + id);
      const doc = kotobaUpdatedDocs.get(location.relative);
      const entry = doc.entries.find((item) => item.textbook_uid === raw.textbook_uid);
      if (
        !entry ||
        entry.index !== raw.index ||
        entry.word !== raw.word ||
        entry.reading_hiragana !== raw.reading_hiragana ||
        entry.context_meaning_zh !== raw.meaning
      )
        fail('KotobaFlow enrichment identity mismatch: ' + id);
      const updated = {
        ...entry,
        ...metadata,
        pos_ja: lexicalMetadata.posLabel(metadata.pos, 'ja'),
        pos_zh: lexicalMetadata.posLabel(metadata.pos, 'zh'),
        register_zh: lexicalMetadata.registerLabel(metadata.register, 'zh'),
      };
      sameExcept(entry, updated, [...OUTPUT_FIELDS, 'pos_ja', 'pos_zh', 'register_zh'], id + ' enrichment');
      doc.entries[doc.entries.indexOf(entry)] = updated;
      doc.schemaVersion = 2;
      seenTargets.kotobaflow.add(id);
    }
  }

  for (const [dataset, set] of Object.entries(seenTargets)) {
    if (set.size !== COUNT_EXPECTED[dataset]) fail('Target output coverage mismatch: ' + dataset);
  }
  const outputs = new Map([
    [MAIN, jsonBytes(mainUpdated)],
    [XIN, jsonBytes(xinUpdated)],
    [XIN_V4, jsonBytes(xinV4Updated)],
  ]);
  for (const [relative, doc] of kotobaUpdatedDocs) outputs.set(relative, jsonBytes(doc));
  for (const [relative, outputBytes] of outputs) {
    const source = requireSource(relative);
    const outputValue = JSON.parse(outputBytes.toString('utf8'));
    if (!Array.isArray(outputValue) && relative !== MAIN && relative !== XIN && relative !== XIN_V4)
      validateKotobaDocumentUpdate(source.value, outputValue, relative);
    changedSources.set(relative, { before: source.bytes, after: outputBytes, count: 0 });
  }
  const expectedOutputSources = Object.keys(manifest.sourceHashes)
    .filter((relative) => relative !== KOTOBA)
    .sort();
  if (JSON.stringify([...changedSources.keys()].sort()) !== JSON.stringify(expectedOutputSources))
    fail('Manifest output source set differs from the allowed metadata targets');
  for (const row of evidence) {
    const record = allRecords.get(row.record_id);
    const relative = record.dataset === 'kotobaflow' ? record.enrichment_file : record.source_file;
    changedSources.get(relative).count++;
    if (record.dataset === 'xinbian') changedSources.get(XIN_V4).count++;
    row.source = relative;
    row.additional_source = record.dataset === 'xinbian' ? XIN_V4 : null;
  }
  return {
    manifest,
    manifest_sha256: sha(manifestBytes),
    repoRoot,
    inputDir,
    inputDirRelative: qaRelative,
    outputs: changedSources,
    evidence,
    recordCount: allRecords.size,
    datasetCounts,
    sourceHashes: Object.fromEntries([...baselineSources].map(([name, source]) => [name, sha(source.bytes)])),
  };
}

function receiptPath(repoRoot) {
  return path.join(repoRoot, QA_REL, 'apply_receipt.json');
}

function validateApplied(plan) {
  const file = receiptPath(plan.repoRoot);
  if (!fs.existsSync(file)) fail('No apply receipt found; cannot verify applied state');
  const receipt = readJSON(file);
  if (
    receipt.schemaVersion !== 2 ||
    receipt.manifest_sha256 !== plan.manifest_sha256 ||
    receipt.recordCount !== plan.recordCount
  )
    fail('Apply receipt does not match current manifest/coverage');
  for (const [relative, entry] of Object.entries(receipt.sources || {})) {
    const planned = plan.outputs.get(relative);
    if (!planned || entry.after_sha256 !== sha(planned.after) || entry.before_sha256 !== sha(planned.before))
      fail('Apply receipt does not match planned source: ' + relative);
    const current = readBytes(path.join(plan.repoRoot, relative));
    if (sha(current) !== entry.after_sha256) fail('Applied source hash changed: ' + relative);
  }
  if (Object.keys(receipt.sources || {}).length !== plan.outputs.size)
    fail('Apply receipt source coverage mismatch');
  if (JSON.stringify(receipt.records) !== JSON.stringify(plan.evidence))
    fail('Apply receipt record evidence mismatch');
  const expectedProtected = Object.keys(plan.sourceHashes)
    .filter((relative) => !plan.outputs.has(relative))
    .sort();
  if (
    JSON.stringify(Object.keys(receipt.protected_sources || {}).sort()) !== JSON.stringify(expectedProtected)
  )
    fail('Protected source receipt coverage mismatch');
  for (const relative of expectedProtected) {
    const expectedHash = plan.sourceHashes[relative];
    const currentHash = sha(readBytes(path.join(plan.repoRoot, relative)));
    if (currentHash !== expectedHash || receipt.protected_sources[relative] !== expectedHash)
      fail('Protected source changed: ' + relative);
  }
  return receipt;
}

function validateReview(review, identity, label) {
  exactKeys(
    review,
    ['schemaVersion', 'status', 'confidence', 'basis', 'note_zh', 'dictionary_sequences', 'identity'],
    label + '.lexical_review',
  );
  if (
    review.schemaVersion !== 2 ||
    !['reviewed', 'needs_review'].includes(review.status) ||
    !['high', 'medium', 'low'].includes(review.confidence) ||
    (review.status === 'needs_review' && review.confidence === 'high')
  )
    fail('Invalid lexical review status/confidence: ' + label);
  if (
    !Array.isArray(review.basis) ||
    !review.basis.length ||
    new Set(review.basis).size !== review.basis.length ||
    review.basis.some((item) => !['dictionary', 'grammar', 'context', 'usage'].includes(item))
  )
    fail('Invalid lexical review basis: ' + label);
  if (
    typeof review.note_zh !== 'string' ||
    review.note_zh !== review.note_zh.trim() ||
    [...review.note_zh].length < 8 ||
    [...review.note_zh].length > 500 ||
    /[\u0000-\u001f\u007f]/.test(review.note_zh) ||
    !/[\u4e00-\u9fff]/.test(review.note_zh)
  )
    fail('Invalid lexical review note: ' + label);
  if (
    !Array.isArray(review.dictionary_sequences) ||
    new Set(review.dictionary_sequences).size !== review.dictionary_sequences.length ||
    review.dictionary_sequences.some((value) => !Number.isSafeInteger(value) || value < 1) ||
    (review.basis.includes('dictionary') && !review.dictionary_sequences.length)
  )
    fail('Invalid lexical review dictionary references: ' + label);
  exactKeys(review.identity, ['word', 'reading_hiragana', 'meaning'], label + '.lexical_review.identity');
  for (const field of ['word', 'reading_hiragana', 'meaning']) {
    const value = review.identity[field];
    if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value))
      fail('Invalid lexical review identity: ' + label + '/' + field);
  }
  if (!review.identity.word.trim()) fail('Empty lexical review word identity: ' + label);
  if (!lexicalMetadata.reviewMatches({ ...identity, lexical_review: review }))
    fail('Lexical review identity mismatch: ' + label);
}

function validateMetadataRow(row, identity, label) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) fail('Invalid metadata row: ' + label);
  const fields = validateFields({
    pos: row.pos,
    transitivity: row.transitivity,
    register: row.register,
    style: row.style,
  });
  validateReview(row.lexical_review, identity, label);
  return { ...fields, lexical_review: row.lexical_review };
}

function validateCurrentData({
  mainRows,
  xinRows,
  xinV4Rows,
  kotobaRows,
  kotobaDocuments,
  effectiveXinRows,
  expectedCounts = COUNT_EXPECTED,
  expectedKotobaDocuments = 76,
}) {
  for (const [label, rows] of [
    ['main', mainRows],
    ['xinbian', xinRows],
    ['xinbian v4', xinV4Rows],
    ['kotobaflow', kotobaRows],
  ])
    if (!Array.isArray(rows)) fail('Expected metadata source array: ' + label);
  for (const [dataset, rows] of [
    ['main', mainRows],
    ['xinbian', xinRows],
    ['kotobaflow', kotobaRows],
  ])
    if (rows.length !== expectedCounts[dataset])
      fail('Metadata coverage mismatch for ' + dataset + ': ' + rows.length + '/' + expectedCounts[dataset]);
  if (xinV4Rows.length !== expectedCounts.xinbian)
    fail('Metadata coverage mismatch for XinBian v4: ' + xinV4Rows.length + '/' + expectedCounts.xinbian);

  const identityOf = (row) => ({
    word: typeof row.word === 'string' ? row.word : '',
    reading_hiragana: typeof row.reading_hiragana === 'string' ? row.reading_hiragana : '',
    meaning: typeof row.meaning === 'string' ? row.meaning : '',
  });
  const indexRows = (rows, label) => {
    const result = new Map();
    for (const row of rows) {
      const index = Number(row && row.index);
      if (!Number.isInteger(index) || result.has(index)) fail('Missing/duplicate index in ' + label);
      result.set(index, row);
    }
    return result;
  };
  const mainIndex = indexRows(mainRows, 'main');
  const xinIndex = indexRows(xinRows, 'XinBian');
  const xinV4Index = indexRows(xinV4Rows, 'XinBian v4');
  const kotobaIndex = indexRows(kotobaRows, 'KotobaFlow');
  const kotobaByUid = new Map([...kotobaIndex.values()].map((row) => [row.textbook_uid, row]));
  for (const row of mainRows) validateMetadataRow(row, identityOf(row), 'main:' + row.index);
  for (const row of kotobaRows) {
    if (typeof row.textbook_uid !== 'string' || !row.textbook_uid)
      fail('Missing KotobaFlow UID: ' + row.index);
    if (
      OUTPUT_FIELDS.slice(0, 4).some((field) => row[field] && typeof row[field] === 'object') ||
      Object.hasOwn(row, 'lexical_review')
    )
      fail('KotobaFlow canonical vocabulary must remain unmodified: ' + row.index);
  }

  const effectiveByIndex = new Map();
  for (const row of effectiveXinRows || []) {
    const index = Number(row && row.index);
    if (!Number.isInteger(index) || effectiveByIndex.has(index))
      fail('Missing/duplicate effective XinBian index');
    effectiveByIndex.set(index, row);
  }
  if (effectiveByIndex.size !== expectedCounts.xinbian) fail('Effective XinBian identity coverage mismatch');
  for (const [index, sourceRow] of xinIndex) {
    const effective = effectiveByIndex.get(index);
    if (!effective || effective.textbook_uid !== sourceRow.textbook_uid)
      fail('XinBian effective UID mismatch: ' + index);
    const identity = identityOf(effective);
    const metadata = validateMetadataRow(sourceRow, identity, 'xinbian:' + index);
    const v4 = xinV4Index.get(index);
    if (!v4 || v4.textbook_uid !== sourceRow.textbook_uid) fail('XinBian v4 UID mismatch: ' + index);
    const v4Metadata = validateMetadataRow(v4, identity, 'xinbian-v4:' + index);
    if (!isDeepStrictEqual(metadata, v4Metadata)) fail('XinBian v3/v4 metadata mismatch: ' + index);
    for (const [field, expected] of Object.entries({
      display_pos_ja: lexicalMetadata.posLabel(metadata.pos, 'ja'),
      display_pos_zh: lexicalMetadata.posLabel(metadata.pos, 'zh'),
      conjugation_class_ja: lexicalMetadata.conjugationLabel(metadata.pos, 'ja'),
      transitivity_label_zh: lexicalMetadata.transitivityLabel(metadata.transitivity, 'zh'),
    }))
      if (v4[field] !== expected) fail('XinBian v4 display label mismatch: ' + index + '/' + field);
  }

  if (!Array.isArray(kotobaDocuments) || kotobaDocuments.length !== expectedKotobaDocuments)
    fail('KotobaFlow enrichment document coverage mismatch: ' + (kotobaDocuments || []).length);
  const seenKotoba = new Set();
  for (const document of kotobaDocuments) {
    if (!document || document.schemaVersion !== 2 || !Array.isArray(document.entries))
      fail('KotobaFlow enrichment requires schemaVersion 2');
    for (const entry of document.entries) {
      const source = kotobaByUid.get(entry.textbook_uid);
      if (!source || seenKotoba.has(entry.textbook_uid)) fail('Missing/duplicate KotobaFlow metadata UID');
      if (
        entry.index !== source.index ||
        entry.word !== source.word ||
        entry.reading_hiragana !== source.reading_hiragana ||
        entry.context_meaning_zh !== source.meaning
      )
        fail('KotobaFlow enrichment source identity mismatch: ' + entry.textbook_uid);
      const metadata = validateMetadataRow(entry, identityOf(source), 'kotobaflow:' + entry.textbook_uid);
      for (const [field, expected] of Object.entries({
        pos_ja: lexicalMetadata.posLabel(metadata.pos, 'ja'),
        pos_zh: lexicalMetadata.posLabel(metadata.pos, 'zh'),
        register_zh: lexicalMetadata.registerLabel(metadata.register, 'zh'),
      }))
        if (entry[field] !== expected)
          fail('KotobaFlow enrichment label mismatch: ' + entry.textbook_uid + '/' + field);
      seenKotoba.add(entry.textbook_uid);
    }
  }
  if (seenKotoba.size !== expectedCounts.kotobaflow)
    fail('KotobaFlow enrichment coverage mismatch: ' + seenKotoba.size + '/' + expectedCounts.kotobaflow);
  return {
    ok: true,
    counts: {
      main: mainIndex.size,
      xinbian: xinIndex.size,
      xinbianV4: xinV4Index.size,
      kotobaflow: seenKotoba.size,
      kotobaflowDocuments: kotobaDocuments.length,
    },
  };
}

function verifyCurrentSources(repoRoot) {
  const readSource = (relative) => {
    const filename = path.join(repoRoot, relative);
    const bytes = readBytes(filename);
    if (bytes.subarray(0, 40).toString().startsWith('version https://git-lfs'))
      fail('Fetch Git LFS content before metadata verification: ' + relative);
    return JSON.parse(bytes.toString('utf8'));
  };
  const mainRows = readSource(MAIN);
  const xinRows = readSource(XIN);
  const xinV4Rows = readSource(XIN_V4);
  const kotobaRows = readSource(KOTOBA);
  const enrichmentDir = path.join(repoRoot, 'data/textbook/kotobaflow/vocab_enrichment');
  const enrichmentFiles = fs
    .readdirSync(enrichmentDir)
    .filter((file) => file.endsWith('.json'))
    .sort();
  const kotobaDocuments = enrichmentFiles.map((file) =>
    readSource('data/textbook/kotobaflow/vocab_enrichment/' + file),
  );
  const bundles = Object.fromEntries(
    [1, 2, 3, 4].map((number) => [
      'XinBian' + number,
      readSource('data/textbook/canonical_books/XinBian' + number + '.bundle.json'),
    ]),
  );
  const overlay = readSource(
    'data/textbook/canonical_textbook_vocab/jitendex_overlay/jitendex_textbook_vocab_overlay.json',
  );
  const context = vm.createContext({ console });
  vm.runInContext(fs.readFileSync(path.join(repoRoot, 'js/core/lexical-metadata.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(repoRoot, 'js/textbook-loader.js'), 'utf8'), context);
  const effectiveXinRows = context.TextbookLoader.build.mergeVocabulary(
    xinRows,
    xinV4Rows,
    overlay.entries,
    context.TextbookLoader.build.sourceVocabulary(bundles),
  );
  loadEnrichment(repoRoot, kotobaRows);
  return validateCurrentData({ mainRows, xinRows, xinV4Rows, kotobaRows, kotobaDocuments, effectiveXinRows });
}

function assertCurrentBaseline(plan) {
  for (const [relative, expectedHash] of Object.entries(plan.sourceHashes)) {
    const current = readBytes(path.join(plan.repoRoot, relative));
    if (sha(current) !== expectedHash) fail('Current source differs from frozen baseline: ' + relative);
  }
}

function writeApply(plan) {
  const currentBefore = new Map();
  for (const [relative, output] of plan.outputs) {
    const current = readBytes(path.join(plan.repoRoot, relative));
    const beforeHash = sha(output.before);
    if (sha(current) !== beforeHash) fail('Current source differs from frozen baseline: ' + relative);
    currentBefore.set(relative, current);
  }
  const backupDir = path.join(plan.repoRoot, QA_REL, 'applied-backup');
  fs.mkdirSync(backupDir, { recursive: true });
  for (const [relative, bytes] of currentBefore) {
    const backup = path.join(backupDir, relative);
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    if (fs.existsSync(backup) && sha(readBytes(backup)) !== sha(bytes))
      fail('Existing application backup differs: ' + relative);
    if (!fs.existsSync(backup)) fs.writeFileSync(backup, bytes);
  }
  const staged = new Map();
  const runId = Date.now().toString(36) + '-' + process.pid;
  try {
    for (const [relative, output] of plan.outputs) {
      const destination = path.join(plan.repoRoot, relative);
      const temporary = destination + '.lexmeta-' + runId + '.tmp';
      fs.writeFileSync(temporary, output.after, { flag: 'wx' });
      staged.set(relative, temporary);
    }
    for (const [relative, temporary] of staged) fs.renameSync(temporary, path.join(plan.repoRoot, relative));
  } catch (error) {
    for (const [relative, original] of currentBefore) {
      const destination = path.join(plan.repoRoot, relative);
      if (fs.existsSync(destination) && sha(readBytes(destination)) !== sha(original))
        fs.writeFileSync(destination, original);
    }
    for (const temporary of staged.values()) if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    throw error;
  }
  const sources = {};
  for (const [relative, output] of plan.outputs) {
    sources[relative] = {
      before_sha256: sha(output.before),
      after_sha256: sha(output.after),
      records: output.count,
    };
  }
  const receipt = {
    schemaVersion: 2,
    applied_at: new Date().toISOString(),
    baseline: plan.manifest.baseline,
    input_manifest: path
      .relative(plan.repoRoot, path.join(plan.inputDir, 'manifest.json'))
      .replace(/\\/g, '/'),
    manifest_sha256: plan.manifest_sha256,
    recordCount: plan.recordCount,
    datasetCounts: plan.datasetCounts,
    sources,
    protected_sources: Object.fromEntries(
      Object.entries(plan.sourceHashes).filter(([relative]) => !plan.outputs.has(relative)),
    ),
    records: plan.evidence,
  };
  fs.writeFileSync(receiptPath(plan.repoRoot), jsonBytes(receipt));
  return receipt;
}

function run(argv = process.argv.slice(2), cwd = process.cwd()) {
  const args = parseArgs(argv);
  const repoRoot = path.resolve(cwd);
  if (args.mode === 'verify-current') {
    const result = verifyCurrentSources(repoRoot);
    console.log(JSON.stringify({ mode: 'verify-current', ...result }));
    return { mode: 'verify-current', ...result };
  }
  const plan = buildPlan({ repoRoot, inputDir: args.input });
  if (args.mode === 'check') {
    const receipt = validateApplied(plan);
    console.log(
      JSON.stringify({
        mode: 'check',
        ok: true,
        records: receipt.recordCount,
        sources: Object.keys(receipt.sources).length,
      }),
    );
    return { ok: true, mode: 'check', receipt };
  }
  assertCurrentBaseline(plan);
  if (args.mode === 'apply') {
    const receipt = writeApply(plan);
    console.log(
      JSON.stringify({ mode: 'apply', ok: true, records: plan.recordCount, sources: plan.outputs.size }),
    );
    return { ok: true, mode: 'apply', receipt };
  }
  const sourceStatus = [...plan.outputs].map(([relative, output]) => {
    const current = readBytes(path.join(repoRoot, relative));
    return {
      source: relative,
      state: sha(current) === sha(output.before) ? 'baseline' : 'changed',
      records: output.count,
    };
  });
  if (sourceStatus.some((item) => item.state !== 'baseline'))
    fail('Current files are not at baseline; use --check after a recorded apply');
  const summary = {
    mode: 'dry-run',
    ok: true,
    records: plan.recordCount,
    datasetCounts: plan.datasetCounts,
    sources: sourceStatus,
  };
  console.log(JSON.stringify(summary));
  return summary;
}

module.exports = {
  ENUMS: lexicalMetadata.ENUMS,
  validateFields,
  validateKotobaDocumentUpdate,
  parseVerdict,
  sameExcept,
  attachMetadata,
  buildPlan,
  validateApplied,
  validateReview,
  validateMetadataRow,
  validateCurrentData,
  verifyCurrentSources,
  writeApply,
  run,
};

if (require.main === module) {
  try {
    run();
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}
