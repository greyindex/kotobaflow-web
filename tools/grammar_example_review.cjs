const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { normalizeGrammarExamples } = require('../js/grammar-loader.js');

const manifestPath = 'resources/quality/grammar-example-language-review-2026-10-12.json';

function buildReviewByUid(details, manifest) {
  assert.equal(manifest.schemaVersion, 1, 'Invalid grammar example review schema');
  assert(Array.isArray(manifest.pairs), 'Missing reviewed source pairs');
  const grouped = new Map();
  const sources = new Set();
  const targets = new Set();
  for (const pair of manifest.pairs) {
    assert(details[pair.uid] && details[pair.uid].uid === pair.uid, 'Grammar review UID mismatch');
    assert(['originalExamples', 'rewrittenExamples'].includes(pair.source));
    for (const key of ['sourceIndex', 'targetIndex', 'sourceAnalysisIndex', 'targetAnalysisIndex']) {
      assert(Number.isSafeInteger(pair[key]) && pair[key] >= 0, 'Invalid review array index');
    }
    for (const key of [
      'sourceJa',
      'sourceZh',
      'targetJa',
      'targetZh',
      'sourceExampleId',
      'targetExampleId',
      'sourceAnalysisZh',
      'targetAnalysisJa',
      'targetAnalysisZh',
    ])
      assert.equal(typeof pair[key], 'string', 'Missing review guard: ' + key);
    assert(pair.sourceJa && pair.targetJa && pair.sourceJa !== pair.targetJa, 'Invalid review text');
    const sourceKey = `${pair.uid}:${pair.source}[${pair.sourceIndex}]`;
    const targetKey = `${pair.uid}:${pair.source}[${pair.targetIndex}]`;
    assert(!sources.has(sourceKey), 'Duplicate review source');
    assert(!targets.has(targetKey), 'Multiple translations target the same example');
    sources.add(sourceKey);
    targets.add(targetKey);
    if (!grouped.has(pair.uid)) grouped.set(pair.uid, { schemaVersion: 1, uid: pair.uid, pairs: [] });
    grouped.get(pair.uid).pairs.push(pair);
  }
  for (const target of targets) assert(!sources.has(target), 'Reviewed target is itself removed');
  for (const [uid, review] of grouped) {
    // Browser and build use the same guard and normalization implementation.
    normalizeGrammarExamples({ ...details[uid], example_language_review: review });
  }
  // Recommended examples must also resolve in entries without language corrections.
  for (const [uid, detail] of Object.entries(details)) {
    if (!grouped.has(uid)) normalizeGrammarExamples(detail);
  }
  return grouped;
}

function readReview(root) {
  return JSON.parse(fs.readFileSync(path.join(root, manifestPath), 'utf8'));
}

module.exports = { manifestPath, buildReviewByUid, readReview };
