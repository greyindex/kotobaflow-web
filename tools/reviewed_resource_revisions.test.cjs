const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { processCorrections } = require('./apply_learning_corrections.cjs');
const { validateManifest } = require('./reviewed_resource_revisions.cjs');

function fixture(tokens, correctionBefore = 'old', correctionAfter = 'reviewed') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resource-revisions-'));
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  const document = { sentences: [{ id: 's1', text: 'にかな。', tokens }] };
  fs.writeFileSync(path.join(root, 'data/book.json'), JSON.stringify(document, null, 2) + '\n');
  const corrections = {
    schemaVersion: 1,
    corrections: [
      {
        id: 'legacy-field',
        file: 'data/book.json',
        path: ['sentences', 0, 'tokens', 0, 'meaning'],
        guards: [
          { path: ['sentences', 0, 'id'], value: 's1' },
          { path: ['sentences', 0, 'tokens', 0, 'index'], value: 0 },
          { path: ['sentences', 0, 'tokens', 0, 'surface'], value: 'にかな' },
        ],
        before: correctionBefore,
        after: correctionAfter,
        reason: 'Reviewed field',
        evidence: ['fixture'],
      },
    ],
  };
  const beforeTokens = [
    { index: 0, surface: 'にかな', meaning: correctionAfter },
    { index: 1, surface: '。', meaning: '' },
  ];
  const afterTokens = [
    { index: 0, surface: 'に', meaning: correctionAfter },
    { index: 1, surface: 'かな', meaning: '' },
    { index: 2, surface: '。', meaning: '' },
  ];
  const revisions = {
    schemaVersion: 1,
    revisions: [
      {
        id: 'split-1',
        file: 'data/book.json',
        path: ['sentences', 0, 'tokens'],
        guards: [
          { path: ['sentences', 0, 'id'], value: 's1' },
          { path: ['sentences', 0, 'text'], value: 'にかな。' },
        ],
        before: beforeTokens,
        after: afterTokens,
        reason: 'Boundary repair',
        evidence: ['Japanese sentence contract'],
      },
    ],
  };
  return {
    root,
    corrections,
    revisions,
    beforeTokens,
    afterTokens,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function read(root) {
  return fs.readFileSync(path.join(root, 'data/book.json'), 'utf8');
}
function startingTokens(meaning = 'old') {
  return [
    { index: 0, surface: 'にかな', meaning },
    { index: 1, surface: '。', meaning: '' },
  ];
}

function nextLayer(f) {
  const after = structuredClone(f.afterTokens);
  after[0].reading = 'ニ';
  return {
    schemaVersion: 1,
    revisions: [
      {
        id: 'follow-up-reading',
        file: 'data/book.json',
        path: ['sentences', 0, 'tokens'],
        guards: [{ path: ['sentences', 0, 'id'], value: 's1' }],
        before: f.afterTokens,
        after,
        reason: 'Reviewed reading',
        evidence: ['fixture'],
      },
    ],
  };
}

test('follow-up layer replays from raw, old revised and final documents without losing old guards', () => {
  for (const start of ['raw', 'revised', 'final']) {
    const f = fixture(startingTokens());
    const followups = nextLayer(f);
    try {
      if (start !== 'raw') {
        const tokens = start === 'final' ? followups.revisions[0].after : f.afterTokens;
        fs.writeFileSync(
          path.join(f.root, 'data/book.json'),
          JSON.stringify({ sentences: [{ id: 's1', text: 'にかな。', tokens }] }),
        );
      }
      processCorrections(f.root, f.corrections, { apply: true, revisions: f.revisions, followups });
      assert.deepEqual(JSON.parse(read(f.root)).sentences[0].tokens, followups.revisions[0].after);
      const stable = read(f.root);
      const again = processCorrections(f.root, f.corrections, {
        apply: true,
        revisions: f.revisions,
        followups,
      });
      assert.equal(again.followupsApplied, 0);
      assert.equal(again.followupsAlreadyApplied, 1);
      assert.equal(read(f.root), stable);
      const invalid = structuredClone(f.corrections);
      invalid.corrections[0].guards[0].value = 'tampered-id';
      assert.throws(
        () => processCorrections(f.root, invalid, { apply: true, revisions: f.revisions, followups }),
        /identity changed/,
      );
      assert.equal(read(f.root), stable);
    } finally {
      f.cleanup();
    }
  }
});

test('follow-up mismatch prevents writes to an earlier valid file', () => {
  const f = fixture(startingTokens());
  try {
    const followups = nextLayer(f);
    fs.writeFileSync(path.join(f.root, 'data/other.json'), '{"text":"unexpected"}');
    followups.revisions.push({
      id: 'late-mismatch',
      file: 'data/other.json',
      path: ['text'],
      guards: [{ path: ['text'], value: 'unexpected' }],
      before: 'old',
      after: 'new',
      reason: 'Root scalar',
      evidence: ['fixture'],
    });
    const stable = read(f.root);
    assert.throws(
      () => processCorrections(f.root, f.corrections, { apply: true, revisions: f.revisions, followups }),
      /Follow-up source changed/,
    );
    assert.equal(read(f.root), stable);
  } finally {
    f.cleanup();
  }
});

test('legacy correction API keeps old behavior when no revision manifest exists', () => {
  const f = fixture(startingTokens());
  try {
    assert.throws(() => processCorrections(f.root, f.corrections), /reviewed corrections missing/);
    assert.equal(processCorrections(f.root, f.corrections, { apply: true }).applied, 1);
    assert.equal(processCorrections(f.root, f.corrections).alreadyApplied, 1);
  } finally {
    f.cleanup();
  }
});

test('replays legacy raw fields then applies structural revision in one write', () => {
  const f = fixture(startingTokens());
  try {
    assert.throws(
      () => processCorrections(f.root, f.corrections, { revisions: f.revisions }),
      /corrections missing/,
    );
    const result = processCorrections(f.root, f.corrections, { apply: true, revisions: f.revisions });
    assert.deepEqual(JSON.parse(read(f.root)).sentences[0].tokens, f.afterTokens);
    assert.equal(result.applied, 1);
    assert.equal(result.revisionsApplied, 1);
  } finally {
    f.cleanup();
  }
});

test('migrates from this-round corrected before value', () => {
  const f = fixture(startingTokens('reviewed'));
  try {
    assert.equal(
      processCorrections(f.root, f.corrections, { apply: true, revisions: f.revisions }).revisionsApplied,
      1,
    );
    assert.deepEqual(JSON.parse(read(f.root)).sentences[0].tokens, f.afterTokens);
  } finally {
    f.cleanup();
  }
});

test('already-after revision is idempotent while legacy guards remain validated', () => {
  const f = fixture(startingTokens('reviewed'));
  try {
    fs.writeFileSync(
      path.join(f.root, 'data/book.json'),
      JSON.stringify({ sentences: [{ id: 's1', text: 'にかな。', tokens: f.afterTokens }] }, null, 2) + '\n',
    );
    const result = processCorrections(f.root, f.corrections, { apply: true, revisions: f.revisions });
    assert.equal(result.revisionsApplied, 0);
    assert.equal(result.revisionsAlreadyApplied, 1);
    assert.deepEqual(result.changedFiles, []);
    assert.deepEqual(JSON.parse(read(f.root)).sentences[0].tokens, f.afterTokens);
  } finally {
    f.cleanup();
  }
});

test('legacy scalar metadata corrections are superseded by valid v2 objects without rewriting them', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resource-v2-lexical-'));
  const file = path.join(root, 'data/book.json');
  const row = {
    index: 0,
    word: '学生',
    reading_hiragana: '',
    meaning: '',
    pos: { primary: 'noun', classes: ['noun'], subtypes: [], conjugation: 'not_applicable' },
    transitivity: { value: 'not_applicable', scope: 'not_applicable' },
    register: { formality: 'neutral', politeness: [], usage: [] },
    style: { medium: 'general', genres: [] },
    lexical_review: {
      schemaVersion: 2,
      status: 'needs_review',
      confidence: 'low',
      basis: ['grammar'],
      note_zh: '冻结输入读音和释义为空，保留有效记录原样。',
      dictionary_sequences: [],
      identity: { word: '学生', reading_hiragana: '', meaning: '' },
    },
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify([row], null, 2) + '\n');
  const before = fs.readFileSync(file, 'utf8');
  const corrections = {
    schemaVersion: 1,
    corrections: [
      {
        id: 'old-pos-fix',
        file: 'data/book.json',
        path: [0, 'pos'],
        guards: [{ path: [0, 'word'], value: '学生' }],
        before: 'unknown',
        after: 'noun',
        reason: 'Historical scalar correction superseded by v2 review',
        evidence: ['fixture'],
      },
    ],
  };
  try {
    const result = processCorrections(root, corrections, { apply: true });
    assert.equal(result.metadataSuperseded, 1);
    assert.deepEqual(result.changedFiles, []);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    assert.deepEqual(JSON.parse(before)[0].pos, row.pos);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('historical v4 display correction yields only to the exact derived metadata label', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resource-v2-display-'));
  const relative = 'data/textbook/canonical_textbook_vocab/textbook_vocab_full.v4.enrichment.json';
  const file = path.join(root, relative);
  const row = {
    index: 1332,
    textbook_uid: 'tv-f52fb70301e8',
    word: '随分',
    reading_hiragana: 'ずいぶん',
    display_pos_ja: 'ナ形容詞・副詞',
    pos: {
      primary: 'adverb',
      classes: ['adjective_na', 'adverb'],
      subtypes: [],
      conjugation: 'not_applicable',
    },
    transitivity: { value: 'not_applicable', scope: 'not_applicable' },
    register: { formality: 'neutral', politeness: [], usage: [] },
    style: { medium: 'general', genres: [] },
    lexical_review: {
      schemaVersion: 2,
      status: 'reviewed',
      confidence: 'high',
      basis: ['dictionary'],
      note_zh: '副词和ナ形容词用法。',
      dictionary_sequences: [1372800],
      identity: { word: '随分', reading_hiragana: 'ずいぶん', meaning: '相当' },
    },
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify([row], null, 2) + '\n');
  const correction = {
    schemaVersion: 1,
    corrections: [
      {
        id: 'RES-CORR-10030-fixture',
        file: relative,
        path: [0, 'display_pos_ja'],
        guards: [
          { path: [0, 'index'], value: 1332 },
          { path: [0, 'word'], value: '随分' },
          { path: [0, 'textbook_uid'], value: 'tv-f52fb70301e8' },
        ],
        before: '副詞',
        after: '副詞・形容動詞',
        reason: 'Historical display correction.',
        evidence: ['fixture'],
      },
    ],
  };
  try {
    const original = fs.readFileSync(file, 'utf8');
    const result = processCorrections(root, correction, { apply: true });
    assert.equal(result.metadataSuperseded, 1);
    assert.deepEqual(result.changedFiles, []);
    assert.equal(fs.readFileSync(file, 'utf8'), original);
    row.display_pos_ja = '不相关旧标签';
    fs.writeFileSync(file, JSON.stringify([row], null, 2) + '\n');
    assert.throws(() => processCorrections(root, correction, { apply: true }), /Correction source changed/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resource revision gate rejects edits to migrated vocabulary metadata', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resource-v2-gate-'));
  try {
    const manifest = {
      schemaVersion: 1,
      revisions: [
        {
          id: 'legacy-pos-scalar',
          file: 'data/textbook/canonical_textbook_vocab/textbook_vocab_full.v3.json',
          path: [0, 'pos'],
          guards: [{ path: [0, 'textbook_uid'], value: 'tv-fixture' }],
          before: 'noun',
          after: 'verb',
          reason: 'fixture',
          evidence: ['fixture'],
        },
      ],
    };
    assert.throws(() => validateManifest(root, manifest), /Lexical metadata is review-gated/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('supports a guarded scalar text revision', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resource-revision-text-'));
  try {
    fs.mkdirSync(path.join(root, 'data'));
    fs.writeFileSync(path.join(root, 'data/book.json'), JSON.stringify({ text: 'before' }));
    const legacy = { schemaVersion: 1, corrections: [] };
    const revisions = {
      schemaVersion: 1,
      revisions: [
        {
          id: 'text-edit',
          file: 'data/book.json',
          path: ['text'],
          guards: [{ path: ['text'], value: 'before' }],
          before: 'before',
          after: 'after',
          reason: 'Correct sentence language',
          evidence: ['fixture'],
        },
      ],
    };
    assert.throws(() => processCorrections(root, legacy, { revisions }), /revisions missing/);
    processCorrections(root, legacy, { revisions, apply: true });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'data/book.json'), 'utf8')), {
      text: 'after',
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('replays legacy guards against old text while text and chunks revisions apply idempotently', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resource-revision-text-chunks-'));
  const file = path.join(root, 'data/book.json');
  const beforeChunks = [{ text: '旧分块' }];
  const afterChunks = [{ text: '新分块' }];
  const original = {
    sentences: [
      {
        id: 's1',
        text: '旧句子',
        tokens: [{ index: 0, surface: '句', meaning: '旧释义' }],
        chunks: beforeChunks,
      },
    ],
  };
  const legacy = {
    schemaVersion: 1,
    corrections: [
      {
        id: 'legacy-meaning',
        file: 'data/book.json',
        path: ['sentences', 0, 'tokens', 0, 'meaning'],
        guards: [
          { path: ['sentences', 0, 'id'], value: 's1' },
          { path: ['sentences', 0, 'text'], value: '旧句子' },
          { path: ['sentences', 0, 'tokens', 0, 'surface'], value: '句' },
        ],
        before: '旧释义',
        after: '已审释义',
        reason: 'Keep the prior scalar correction attached to its source sentence',
        evidence: ['fixture'],
      },
    ],
  };
  const revisions = {
    schemaVersion: 1,
    revisions: [
      {
        id: 'text-revision',
        file: 'data/book.json',
        path: ['sentences', 0, 'text'],
        guards: [{ path: ['sentences', 0, 'text'], value: '旧句子' }],
        before: '旧句子',
        after: '新句子',
        reason: 'Update the reviewed sentence text',
        evidence: ['fixture'],
      },
      {
        id: 'chunks-revision',
        file: 'data/book.json',
        path: ['sentences', 0, 'chunks'],
        guards: [{ path: ['sentences', 0, 'text'], value: '旧句子' }],
        before: beforeChunks,
        after: afterChunks,
        reason: 'Update derived sentence chunks with the source text',
        evidence: ['fixture'],
      },
    ],
  };

  try {
    fs.mkdirSync(path.join(root, 'data'), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(original, null, 2) + '\n');

    const applied = processCorrections(root, legacy, { apply: true, revisions });
    assert.equal(applied.applied, 1);
    assert.equal(applied.revisionsApplied, 2);
    const expected = {
      sentences: [
        {
          id: 's1',
          text: '新句子',
          tokens: [{ index: 0, surface: '句', meaning: '已审释义' }],
          chunks: afterChunks,
        },
      ],
    };
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), expected);

    const stable = fs.readFileSync(file, 'utf8');
    const checked = processCorrections(root, legacy, { revisions });
    assert.equal(checked.alreadyApplied, 1);
    assert.equal(checked.revisionsAlreadyApplied, 2);
    assert.equal(fs.readFileSync(file, 'utf8'), stable);

    const repeated = processCorrections(root, legacy, { apply: true, revisions });
    assert.equal(repeated.applied, 0);
    assert.equal(repeated.alreadyApplied, 1);
    assert.equal(repeated.revisionsApplied, 0);
    assert.equal(repeated.revisionsAlreadyApplied, 2);
    assert.deepEqual(repeated.changedFiles, []);
    assert.equal(fs.readFileSync(file, 'utf8'), stable);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects tampered after state without writing', () => {
  const f = fixture(startingTokens('reviewed'));
  try {
    const tampered = { sentences: [{ id: 's1', text: 'にかな。', tokens: structuredClone(f.afterTokens) }] };
    tampered.sentences[0].tokens[1].surface = '改';
    const original = JSON.stringify(tampered, null, 2) + '\n';
    fs.writeFileSync(path.join(f.root, 'data/book.json'), original);
    assert.throws(
      () => processCorrections(f.root, f.corrections, { apply: true, revisions: f.revisions }),
      /identity changed|source changed/,
    );
    assert.equal(read(f.root), original);
  } finally {
    f.cleanup();
  }
});

test('rejects incorrect revision guard without writing', () => {
  const f = fixture(startingTokens('reviewed'));
  try {
    const bad = structuredClone(f.revisions);
    bad.revisions[0].guards[1].value = 'wrong source';
    const original = read(f.root);
    assert.throws(
      () => processCorrections(f.root, f.corrections, { apply: true, revisions: bad }),
      /Revision identity changed/,
    );
    assert.equal(read(f.root), original);
  } finally {
    f.cleanup();
  }
});

test('rejects unsafe paths, prototype keys, and duplicate/prefix-overlapping targets', () => {
  const f = fixture(startingTokens('reviewed'));
  try {
    const attempt = (mutate, pattern) => {
      const bad = structuredClone(f.revisions);
      mutate(bad);
      assert.throws(() => processCorrections(f.root, f.corrections, { revisions: bad }), pattern);
    };
    attempt((m) => {
      m.revisions[0].file = 'data/../outside.json';
    }, /teaching JSON|escapes/);
    attempt((m) => {
      m.revisions[0].guards[0].path = ['sentences', 0, '__proto__'];
    }, /path no longer exists/);
    attempt((m) => {
      m.revisions.push({
        ...m.revisions[0],
        id: 'overlap',
        path: ['sentences', 0, 'tokens', 0, 'text'],
        before: 'before',
        after: 'after',
      });
    }, /Overlapping revision target/);
  } finally {
    f.cleanup();
  }
});

test('a later-file validation failure happens before any earlier file is written', () => {
  const f = fixture(startingTokens());
  try {
    fs.writeFileSync(path.join(f.root, 'data/second.json'), JSON.stringify({ value: 'drift' }));
    const firstOriginal = read(f.root);
    const bad = structuredClone(f.revisions);
    bad.revisions.push({
      id: 'bad-second',
      file: 'data/second.json',
      path: ['value'],
      guards: [{ path: ['value'], value: 'drift' }],
      before: 'expected',
      after: 'final',
      reason: 'fixture',
      evidence: ['fixture'],
    });
    assert.throws(
      () => processCorrections(f.root, f.corrections, { apply: true, revisions: bad }),
      /Revision source changed/,
    );
    assert.equal(read(f.root), firstOriginal);
    assert.equal(fs.readFileSync(path.join(f.root, 'data/second.json'), 'utf8'), '{"value":"drift"}');
  } finally {
    f.cleanup();
  }
});
