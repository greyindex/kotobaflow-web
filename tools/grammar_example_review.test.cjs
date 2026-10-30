const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { manifestPath, buildReviewByUid } = require('./grammar_example_review.cjs');
const { normalizeGrammarExamples } = require('../js/grammar-loader.js');

const root = path.resolve(__dirname, '..');
const details = JSON.parse(fs.readFileSync(path.join(root, 'data/grammar_details.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const bestFields = ['best_examples_for_memory', 'best_examples_for_contrast'];

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

freezeDeep(details);
freezeDeep(manifest);

function reviewedDetail(uid) {
  return {
    ...structuredClone(details[uid]),
    example_language_review: structuredClone(buildReviewByUid(details, manifest).get(uid)),
  };
}

function analysisAt(detail, index) {
  return detail.enriched.example_analysis[index];
}

function sourceField(source, index) {
  return `${source}[${index}]`;
}

test('all 175 reviewed pairs in 60 UIDs validate without mutating frozen source data', () => {
  const before = JSON.stringify(details);
  const manifestBefore = JSON.stringify(manifest);
  const byUid = buildReviewByUid(details, manifest);
  assert.ok(byUid instanceof Map);
  assert.equal(byUid.size, 60);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.reviewedTextCount, 166);
  assert.equal(manifest.referenceCount, 355);
  assert.equal(manifest.pairs.length, 175);
  assert.equal(
    [...byUid.values()].reduce((n, review) => n + review.pairs.length, 0),
    175,
  );
  for (const [uid, review] of byUid) {
    assert.equal(review.schemaVersion, 1);
    assert.equal(review.uid, uid);
    assert.deepEqual(
      review.pairs,
      manifest.pairs.filter((pair) => pair.uid === uid),
    );
  }
  assert.equal(JSON.stringify(details), before);
  assert.equal(JSON.stringify(manifest), manifestBefore);
});

test('all reviewed views hide only mapped Chinese rows, fill empty translations and retain identities', () => {
  const byUid = buildReviewByUid(details, manifest);
  let checkedPairs = 0;
  for (const [uid, review] of byUid) {
    const raw = freezeDeep({ ...structuredClone(details[uid]), example_language_review: review });
    const before = JSON.stringify(raw);
    const view = normalizeGrammarExamples(raw);
    assert.notEqual(view, raw);
    assert.notEqual(view.enriched, raw.enriched);
    const removedAnalysis = new Set(review.pairs.map((pair) => pair.sourceAnalysisIndex));
    const expectedAnalysis = raw.enriched.example_analysis
      .map((item, index) => ({ item, index }))
      .filter(({ index }) => !removedAnalysis.has(index));
    assert.deepEqual(
      view.enriched.example_analysis.map((item) => item.example_id),
      expectedAnalysis.map(({ item }) => item.example_id),
      uid,
    );
    assert.deepEqual(
      view.enriched.example_analysis.map((item) => item.source_field),
      expectedAnalysis.map(({ index }) => sourceField('enriched.example_analysis', index)),
      uid,
    );
    for (const source of ['originalExamples', 'rewrittenExamples']) {
      const removed = new Set(
        review.pairs.filter((pair) => pair.source === source).map((pair) => pair.sourceIndex),
      );
      const survivingIndices = raw[source].map((_, index) => index).filter((index) => !removed.has(index));
      assert.deepEqual(
        view[source].map((item) => item.source_field),
        survivingIndices.map((index) => sourceField(source, index)),
        `${uid} ${source}`,
      );
      assert.deepEqual(
        view[source].map((item) => item.example_id),
        survivingIndices.map(
          (index) => `${uid}-${source === 'originalExamples' ? 'original' : 'rewritten'}-${index + 1}`,
        ),
        `${uid} ${source}`,
      );
      assert.deepEqual(
        view[source].map((item) => item.ja),
        survivingIndices.map((index) => raw[source][index].ja),
        `${uid} ${source}: Japanese text must not be rewritten`,
      );
    }
    for (const pair of review.pairs) {
      const target = view[pair.source].find(
        (item) => item.source_field === sourceField(pair.source, pair.targetIndex),
      );
      const targetAnalysis = view.enriched.example_analysis.find(
        (item) => item.example_id === pair.targetExampleId,
      );
      assert.ok(target, `${uid}: target base row retained`);
      assert.ok(targetAnalysis, `${uid}: target analysis retained`);
      assert.equal(target.ja, pair.targetJa);
      assert.equal(target.zh, pair.targetZh || pair.sourceJa);
      assert.equal(targetAnalysis.ja, pair.targetAnalysisJa);
      assert.equal(targetAnalysis.zh, pair.targetAnalysisZh || pair.sourceJa);
      assert.equal(
        targetAnalysis.source_field,
        sourceField('enriched.example_analysis', pair.targetAnalysisIndex),
      );
      assert.ok(!view.enriched.example_analysis.some((item) => item.example_id === pair.sourceExampleId));
      checkedPairs += 1;
    }
    assert.equal(JSON.stringify(raw), before, `${uid}: normalizing must not change canonical data`);
  }
  assert.equal(checkedPairs, 175);
});

const guardMutations = [
  [
    'source Japanese text',
    (raw, pair) => {
      raw[pair.source][pair.sourceIndex].ja += 'changed';
    },
  ],
  [
    'source translation',
    (raw, pair) => {
      raw[pair.source][pair.sourceIndex].zh += 'changed';
    },
  ],
  [
    'target Japanese text',
    (raw, pair) => {
      raw[pair.source][pair.targetIndex].ja += 'changed';
    },
  ],
  [
    'target translation',
    (raw, pair) => {
      raw[pair.source][pair.targetIndex].zh += 'changed';
    },
  ],
  [
    'source analysis ID',
    (raw, pair) => {
      analysisAt(raw, pair.sourceAnalysisIndex).example_id += '-changed';
    },
  ],
  [
    'target analysis ID',
    (raw, pair) => {
      analysisAt(raw, pair.targetAnalysisIndex).example_id += '-changed';
    },
  ],
  [
    'source analysis Japanese text',
    (raw, pair) => {
      analysisAt(raw, pair.sourceAnalysisIndex).ja += 'changed';
    },
  ],
  [
    'target analysis Japanese text',
    (raw, pair) => {
      analysisAt(raw, pair.targetAnalysisIndex).ja += 'changed';
    },
  ],
  [
    'source analysis translation',
    (raw, pair) => {
      analysisAt(raw, pair.sourceAnalysisIndex).zh += 'changed';
    },
  ],
  [
    'target analysis translation',
    (raw, pair) => {
      analysisAt(raw, pair.targetAnalysisIndex).zh += 'changed';
    },
  ],
];

for (const [label, mutate] of guardMutations) {
  test(`both build and runtime reject drift in ${label}`, () => {
    const pair = manifest.pairs[0];
    const changed = structuredClone(details[pair.uid]);
    mutate(changed, pair);
    freezeDeep(changed);
    const before = JSON.stringify(changed);
    assert.throws(() => buildReviewByUid({ ...details, [pair.uid]: changed }, manifest));
    const raw = freezeDeep({
      ...changed,
      example_language_review: buildReviewByUid(details, manifest).get(pair.uid),
    });
    assert.throws(() => normalizeGrammarExamples(raw));
    assert.equal(JSON.stringify(changed), before);
  });
}

test('review schema and reference identity cannot be silently changed', () => {
  const changedManifest = structuredClone(manifest);
  changedManifest.schemaVersion = 2;
  assert.throws(() => buildReviewByUid(details, changedManifest));
  const pair = manifest.pairs[0];
  for (const field of ['sourceExampleId', 'targetExampleId']) {
    const changed = structuredClone(manifest);
    changed.pairs[0][field] += '-changed';
    assert.throws(() => buildReviewByUid(details, changed), field);
  }
  const raw = reviewedDetail(pair.uid);
  raw.example_language_review.uid = 'another-uid';
  assert.throws(() => normalizeGrammarExamples(raw));
});

test('existing target translations are preserved for reviewed rewritten duplicates', () => {
  const pair = manifest.pairs.find((item) => item.source === 'rewrittenExamples' && item.targetZh);
  assert.ok(pair, 'the corpus must exercise an existing rewritten translation');
  const raw = freezeDeep(reviewedDetail(pair.uid));
  const view = normalizeGrammarExamples(raw);
  const target = view.rewrittenExamples.find((item) => item.example_id === pair.targetExampleId);
  assert.equal(target.zh, pair.targetZh);
  assert.ok(!view.rewrittenExamples.some((item) => item.example_id === pair.sourceExampleId));
  assert.equal(raw.rewrittenExamples[pair.sourceIndex].ja, pair.sourceJa);
});

test('best-example aliases resolve to retained analyses while keeping recommendation reasons', () => {
  const raw = reviewedDetail('N3-125');
  const pairs = raw.example_language_review.pairs;
  const original = pairs.find((pair) => pair.source === 'originalExamples');
  const rewritten = pairs.find((pair) => pair.source === 'rewrittenExamples');
  assert.ok(original && rewritten);
  raw.enriched.best_examples_for_memory = [
    { example_id: original.sourceExampleId, reason: '保留记忆推荐理由' },
  ];
  raw.enriched.best_examples_for_contrast = [
    { example_id: rewritten.sourceExampleId, reason: '保留辨析推荐理由' },
  ];
  const before = JSON.stringify(raw);
  freezeDeep(raw);
  const view = normalizeGrammarExamples(raw);
  for (const [field, pair] of [
    [bestFields[0], original],
    [bestFields[1], rewritten],
  ]) {
    const best = view.enriched[field][0];
    const analysis = view.enriched.example_analysis.find((item) => item.example_id === pair.targetExampleId);
    assert.equal(best.example_id, pair.targetExampleId);
    assert.equal(best.ja, analysis.ja);
    assert.equal(best.zh, analysis.zh);
    assert.equal(best.source_field, sourceField('enriched.example_analysis', pair.targetAnalysisIndex));
    assert.equal(best.reason, raw.enriched[field][0].reason);
  }
  assert.equal(JSON.stringify(raw), before);
});

test('ordinary recommendation IDs resolve throughout the corpus, including unreviewed UIDs', () => {
  const byUid = buildReviewByUid(details, manifest);
  let unreviewed = 0;
  for (const [uid, detail] of Object.entries(details)) {
    const review = byUid.get(uid);
    const raw = freezeDeep({ ...detail, ...(review ? { example_language_review: review } : {}) });
    const before = JSON.stringify(raw);
    const view = normalizeGrammarExamples(raw);
    for (const field of bestFields) {
      const recommendations = raw.enriched[field] || [];
      assert.equal(view.enriched[field].length, recommendations.length, `${uid} ${field}`);
      recommendations.forEach((recommendation, index) => {
        const pair = review?.pairs.find((item) => item.sourceExampleId === recommendation.example_id);
        const expectedId = pair ? pair.targetExampleId : recommendation.example_id;
        const best = view.enriched[field][index];
        const analysis = view.enriched.example_analysis.find((item) => item.example_id === expectedId);
        assert.ok(analysis, `${uid}: recommendation target ${expectedId} exists`);
        assert.equal(best.example_id, expectedId);
        assert.equal(best.ja, analysis.ja);
        assert.equal(best.zh, analysis.zh);
        assert.equal(best.reason, recommendation.reason);
        assert.equal(best.source_field, analysis.source_field);
      });
    }
    assert.equal(JSON.stringify(raw), before, uid);
    if (!review) unreviewed += 1;
  }
  assert.equal(unreviewed, Object.keys(details).length - 60);
  assert.ok(unreviewed > 0);
});

test('unreviewed all-kanji Japanese is retained without heuristic language filtering', () => {
  const raw = freezeDeep({
    uid: 'TEST-HANZI',
    originalExamples: [{ ja: '立入禁止', zh: '禁止进入' }],
    rewrittenExamples: [],
    enriched: {
      example_analysis: [
        { example_id: 'TEST-HANZI-original-1', source_type: 'original', ja: '立入禁止', zh: '禁止进入' },
      ],
      best_examples_for_memory: [{ example_id: 'TEST-HANZI-original-1', reason: '告示用语' }],
      best_examples_for_contrast: [],
    },
  });
  const view = normalizeGrammarExamples(raw);
  assert.equal(view.originalExamples.length, 1);
  assert.equal(view.originalExamples[0].ja, '立入禁止');
  assert.equal(view.originalExamples[0].source_field, 'originalExamples[0]');
  assert.equal(view.enriched.example_analysis[0].ja, '立入禁止');
  assert.equal(view.enriched.best_examples_for_memory[0].ja, '立入禁止');
});

test('an unresolved recommendation ID is reported instead of rendering an empty example', () => {
  const raw = structuredClone(details['N1-001']);
  raw.enriched.best_examples_for_memory[0].example_id = 'N1-001-missing-999';
  assert.throws(() => normalizeGrammarExamples(freezeDeep(raw)));
});

test('getDetail reports review guard failures as a load error and never exposes the corrupted detail', async () => {
  const pair = manifest.pairs[0];
  const raw = reviewedDetail(pair.uid);
  const review = raw.example_language_review;
  delete raw.example_language_review;
  raw[pair.source][pair.sourceIndex].ja += 'changed';
  const chunk = `${'a'.repeat(64)}.json`;
  const warnings = [];
  const context = vm.createContext({
    console: { warn: (...args) => warnings.push(args) },
    fetch: async (url) => ({
      ok: true,
      json: async () =>
        url.endsWith('index.json')
          ? {
              version: 1,
              entries: { [pair.uid]: chunk },
              exampleLanguageReviews: { [pair.uid]: review },
            }
          : { [pair.uid]: structuredClone(raw) },
    }),
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'js/grammar-loader.js'), 'utf8'), context);
  assert.equal(await context.GrammarLoader.getDetail(pair.uid), null);
  assert.ok(context.GrammarLoader.getLastError('details'));
  assert.ok(warnings.length > 0, 'a visible diagnostic accompanies the rejected detail');
  assert.equal(await context.GrammarLoader.getDetail(pair.uid), null, 'cache must not bypass validation');
});
