'use strict';

// Replays reviewed source pairings. It never edits grammar data or requests TTS.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { buildReviewByUid, readReview } = require('./grammar_example_review.cjs');
const { normalizeGrammarExamples } = require('../js/grammar-loader.js');

const root = path.resolve(__dirname, '..');
const directory = path.join(root, 'docs/evidence/chinese-example-audit-2026-10-12');
const args = process.argv.slice(2);
assert(
  args.every((arg) => arg === '--check'),
  'Only --check is supported',
);
const check = args.includes('--check');
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const snapshot = read(path.join(directory, 'excluded-snapshot.json'));
const grammarBytes = fs.readFileSync(path.join(root, snapshot.source_grammar));
assert.equal(
  sha256(grammarBytes),
  snapshot.source_grammar_sha256,
  'Grammar source changed; review the audit before replaying',
);
const grammar = JSON.parse(grammarBytes);
const decisions = ['001-055', '056-110', '111-166'].flatMap((range) =>
  read(path.join(directory, `decisions-${range}.json`)),
);
const texts = [...new Set(snapshot.excluded.map((entry) => entry.text))];
assert.equal(snapshot.excluded.length, 355);
assert.equal(texts.length, 166);
assert.equal(decisions.length, texts.length);
const decisionById = new Map(decisions.map((entry) => [entry.text_id, entry]));
assert.equal(decisionById.size, texts.length, 'Repeated text decision');

function tokens(field) {
  return field.replace(/\[(\d+)\]/g, '.$1').split('.');
}

function get(row, field) {
  return tokens(field).reduce((value, key) => {
    assert(value && Object.hasOwn(value, key), `Missing field: ${field}`);
    return value[key];
  }, row);
}

function pointer(owner, field) {
  return (
    '/' + [owner, ...tokens(field)].map((part) => part.replace(/~/g, '~0').replace(/\//g, '~1')).join('/')
  );
}

function originalField(owner, example) {
  const prefix = `${owner}-`;
  assert(example.example_id.startsWith(prefix));
  const match = example.example_id.slice(prefix.length).match(/^(original|rewritten)-(\d+)$/);
  assert(match, `Unexpected example ID: ${example.example_id}`);
  assert.equal(example.source_type, match[1]);
  return `${match[1]}Examples[${Number(match[2]) - 1}]`;
}

const primaryPairs = new Map();
for (let index = 0; index < texts.length; index += 1) {
  const textId = `T${String(index + 1).padStart(3, '0')}`;
  const decision = decisionById.get(textId);
  assert(decision, `Missing review for ${textId}`);
  assert.equal(decision.language, 'zh', `Review language missing for ${textId}`);
  assert(decision.classification && decision.decision);
  assert(Array.isArray(decision.pairs) && decision.pairs.length > 0);
  for (const pair of decision.pairs) {
    assert(pair.reason_zh, `${textId}: missing pairing reason`);
    assert(/^(original|rewritten)Examples\[\d+\]$/.test(pair.source_field));
    const row = grammar[pair.owner];
    assert(row && row.uid === pair.owner);
    assert.equal(get(row, pair.source_field).ja, texts[index]);
    assert(
      snapshot.excluded.some(
        (entry) =>
          entry.owner === pair.owner && entry.field === pair.source_field && entry.text === texts[index],
      ),
    );
    const key = `${pair.owner}:${pair.source_field}`;
    assert(!primaryPairs.has(key), `Duplicate source pairing ${key}`);
    if (pair.target_field !== null) {
      assert(/^(original|rewritten)Examples\[\d+\]$/.test(pair.target_field));
      assert.notEqual(pair.source_field, pair.target_field);
      const target = get(row, pair.target_field);
      assert.equal(typeof target.ja, 'string');
      assert(target.ja && target.ja !== texts[index], `Invalid Japanese counterpart ${key}`);
    }
    primaryPairs.set(key, { textId, decision, pair });
  }
}

const seenReferences = new Set();
const references = snapshot.excluded.map((entry, index) => {
  assert.equal(entry.module, 'grammar');
  const key = `${entry.owner}:${entry.field}`;
  assert(!seenReferences.has(key), `Duplicate excluded reference ${key}`);
  seenReferences.add(key);
  const row = grammar[entry.owner];
  let physicalField;
  let example;
  let sourceField;
  let indirectReference = null;
  if (entry.field.endsWith('.example_id')) {
    const id = get(row, entry.field);
    const matches = row.enriched.example_analysis
      .map((value, offset) => ({ value, offset }))
      .filter(({ value }) => value.example_id === id);
    assert.equal(matches.length, 1, `Ambiguous example ID ${key}`);
    example = matches[0].value;
    physicalField = `enriched.example_analysis[${matches[0].offset}].ja`;
    indirectReference = { pointer: pointer(entry.owner, entry.field), value: id };
    sourceField = originalField(entry.owner, example);
  } else {
    example = get(row, entry.field);
    physicalField = `${entry.field}.ja`;
    sourceField = entry.field.startsWith('enriched.') ? originalField(entry.owner, example) : entry.field;
  }
  assert.equal(get(row, physicalField), entry.text, `Excluded source changed: ${key}`);
  const reviewed = primaryPairs.get(`${entry.owner}:${sourceField}`);
  assert(reviewed, `No manual pairing for ${key}`);
  const { textId, decision, pair } = reviewed;
  assert.equal(texts[Number(textId.slice(1)) - 1], entry.text);
  const target = pair.target_field === null ? null : get(row, pair.target_field);
  return {
    reference_id: `R${String(index + 1).padStart(3, '0')}`,
    text_id: textId,
    owner: entry.owner,
    grammar_title: row.title,
    original_plan_field: entry.field,
    source_file: snapshot.source_grammar,
    physical_json_pointer: pointer(entry.owner, physicalField),
    indirect_reference: indirectReference,
    source_example_id: example.example_id || null,
    primary_source_pointer: pointer(entry.owner, `${sourceField}.ja`),
    source_text: entry.text,
    source_text_sha256: sha256(entry.text),
    language: decision.language,
    context_classification: decision.classification,
    japanese_counterpart:
      target === null
        ? null
        : {
            pointer: pointer(entry.owner, `${pair.target_field}.ja`),
            text: target.ja,
            current_zh_pointer: pointer(entry.owner, `${pair.target_field}.zh`),
            current_zh: target.zh,
          },
    disposition: decision.decision,
    reason_zh: pair.reason_zh,
    related_issue_zh: decision.issue_zh || null,
  };
});

assert.equal(
  primaryPairs.size,
  snapshot.excluded.filter((entry) => /^(original|rewritten)Examples/.test(entry.field)).length,
  'Primary source coverage mismatch',
);
const reviewManifest = readReview(root);
const reviewByUid = buildReviewByUid(grammar, reviewManifest);
assert.equal(reviewManifest.reviewedTextCount, texts.length);
assert.equal(reviewManifest.referenceCount, references.length);
assert.equal(reviewManifest.pairs.length, primaryPairs.size);
for (const pair of reviewManifest.pairs) {
  const manual = primaryPairs.get(`${pair.uid}:${pair.source}[${pair.sourceIndex}]`);
  assert(manual, 'Unreviewed display correction');
  assert.equal(pair.textId, manual.textId);
  assert.equal(`${pair.source}[${pair.targetIndex}]`, manual.pair.target_field);
}
let hiddenPrimary = 0;
let hiddenAnalysis = 0;
for (const [uid, review] of reviewByUid) {
  const raw = grammar[uid];
  const view = normalizeGrammarExamples({ ...raw, example_language_review: review });
  hiddenPrimary +=
    raw.originalExamples.length +
    raw.rewrittenExamples.length -
    view.originalExamples.length -
    view.rewrittenExamples.length;
  hiddenAnalysis += raw.enriched.example_analysis.length - view.enriched.example_analysis.length;
  for (const pair of review.pairs) {
    const target = view[pair.source].find(
      (example) => example.source_field === `${pair.source}[${pair.targetIndex}]`,
    );
    assert(target && target.example_id === pair.targetExampleId, 'Stable display identity changed');
    assert.equal(target.ja, pair.targetJa);
    assert.equal(target.zh, pair.source === 'originalExamples' ? pair.sourceJa : pair.targetZh);
  }
}
const countBy = (values, key) =>
  values.reduce((result, entry) => {
    const value = key(entry);
    result[value] = (result[value] || 0) + 1;
    return result;
  }, {});
const summary = {
  schema_version: 1,
  task: 'PUB-04-JA',
  source_grammar_sha256: sha256(grammarBytes),
  source_plan_sha256: snapshot.source_plan_sha256,
  reference_count: references.length,
  unique_text_count: texts.length,
  grammar_owner_count: new Set(references.map((entry) => entry.owner)).size,
  primary_reference_count: primaryPairs.size,
  reference_classes: countBy(references, (entry) => entry.context_classification),
  text_classes: countBy(decisions, (entry) => entry.classification),
  field_classes: countBy(snapshot.excluded, (entry) => entry.field.replace(/\[\d+\].*/, '')),
  indirect_reference_count: references.filter((entry) => entry.indirect_reference).length,
  unresolved_pairing_count: references.filter((entry) => entry.japanese_counterpart === null).length,
  issues: decisions
    .filter((entry) => entry.issue_zh)
    .map((entry) => ({ text_id: entry.text_id, note_zh: entry.issue_zh })),
  review_result:
    'All excluded texts have recorded language and source decisions. Reviewed display copies pair translations and omit duplicate Chinese rows while raw source arrays remain unchanged.',
  display_normalization: {
    affected_grammar_owners: reviewByUid.size,
    filled_original_translations: reviewManifest.pairs.filter((pair) => pair.source === 'originalExamples')
      .length,
    hidden_primary_rows: hiddenPrimary,
    hidden_analysis_rows: hiddenAnalysis,
    remapped_recommendation_references: references.filter((entry) => entry.indirect_reference).length,
    stable_identity_field: 'source_field',
  },
  production_data_changed: false,
  tts_requested: false,
};

for (const [name, data] of [
  ['references.json', references],
  ['summary.json', summary],
]) {
  const file = path.join(directory, name);
  const content = JSON.stringify(data, null, 2) + '\n';
  if (check) assert.equal(fs.readFileSync(file, 'utf8'), content, `Stale audit evidence: ${name}`);
  else fs.writeFileSync(file, content);
}
console.log(
  JSON.stringify({
    checked: check,
    references: references.length,
    texts: texts.length,
    primaryReferences: primaryPairs.size,
    unresolvedPairings: summary.unresolved_pairing_count,
  }),
);
