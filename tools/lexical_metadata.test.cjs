const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const metadata = require('../js/core/lexical-metadata.js');

function fields() {
  return {
    pos: { primary: 'noun', classes: ['verb', 'noun'], subtypes: ['verbal_noun'], conjugation: 'suru' },
    transitivity: { value: 'both', scope: 'suru' },
    register: { formality: 'neutral', politeness: [], usage: ['literary', 'colloquial'] },
    style: { medium: 'general', genres: ['educational', 'business'] },
  };
}

test('normalize validates v2 and returns enum ordered deep copy', () => {
  const source = fields();
  const normalized = metadata.normalize(source);
  assert.deepEqual(normalized.pos.classes, ['noun', 'verb']);
  assert.deepEqual(normalized.register.usage, ['colloquial', 'literary']);
  assert.deepEqual(normalized.style.genres, ['business', 'educational']);
  assert.notEqual(normalized, source);
  assert.notEqual(normalized.pos, source.pos);
  assert.equal(metadata.validate(normalized), true);
});

test('POS taxonomy exposes all 18 classes with matching bilingual labels', () => {
  const taxonomy = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/pos.json'), 'utf8'));
  assert.equal(taxonomy.version, '2.1.0');
  assert.deepEqual(
    taxonomy.items.map((item) => item.code),
    metadata.ENUMS.pos,
  );
  const taru = taxonomy.items.find((item) => item.code === 'adjective_taru');
  assert.equal(taru.label_zh, 'タリ形容词');
  assert.equal(taru.label_ja, 'タリ形容詞');
  assert.deepEqual(
    taxonomy.dimensions.subtypes.map((item) => item.code),
    metadata.ENUMS.subtypes,
  );
});

test('prenominal use does not turn a noun into an independent rentaishi', () => {
  const f = fields();
  f.pos = { primary: 'noun', classes: ['noun'], subtypes: ['prenominal'], conjugation: 'not_applicable' };
  f.transitivity = { value: 'not_applicable', scope: 'not_applicable' };
  assert.equal(metadata.validate(f), true);
  assert.equal(metadata.hasClass(f.pos, 'adnominal'), false);
  assert.equal(metadata.posLabel(f.pos, 'zh'), '名词・前置修饰用法');
  assert.equal(metadata.posLabel(f.pos, 'ja'), '名詞・連体修飾用法');
});

test('validate rejects malformed objects, enums, duplicates and combinations', () => {
  const missingClass = fields();
  missingClass.pos.classes = ['verb'];
  assert.throws(() => metadata.validate(missingClass), /include primary/);
  const duplicate = fields();
  duplicate.register.usage = ['slang', 'slang'];
  assert.throws(() => metadata.validate(duplicate), /duplicate/);
  const invalid = fields();
  invalid.pos.extra = true;
  assert.throws(() => metadata.normalize(invalid), /unknown key/);
  const na = fields();
  na.transitivity = { value: 'not_applicable', scope: 'suru' };
  assert.throws(() => metadata.validate(na), /must occur together/);
  const legacy = { pos: 'noun', transitivity: 'not_applicable', register: 'neutral', style: 'general' };
  assert.throws(() => metadata.normalize(legacy));
  const auxiliary = fields();
  auxiliary.pos = {
    primary: 'adjective_i',
    classes: ['adjective_i', 'auxiliary'],
    subtypes: ['auxiliary_adjective'],
    conjugation: 'not_applicable',
  };
  assert.equal(metadata.validate(auxiliary), true); // 「たい」型：形容词型助动词，不要求动词活用
  const mixedSuru = fields();
  mixedSuru.pos = {
    primary: 'adjective_na',
    classes: ['adjective_na', 'noun', 'verb'],
    subtypes: [],
    conjugation: 'suru',
  };
  assert.equal(metadata.validate(mixedSuru), true); // 「感心」型兼类する动词
  const adjectiveOnly = fields();
  adjectiveOnly.pos = {
    primary: 'adjective_na',
    classes: ['adjective_na'],
    subtypes: [],
    conjugation: 'suru',
  };
  assert.throws(() => metadata.validate(adjectiveOnly), /without verb class/);
  const verbWithoutConjugation = fields();
  verbWithoutConjugation.pos = {
    primary: 'verb',
    classes: ['verb'],
    subtypes: [],
    conjugation: 'not_applicable',
  };
  assert.throws(() => metadata.validate(verbWithoutConjugation), /cannot use not_applicable/);
  const taruAdjective = fields();
  taruAdjective.pos = {
    primary: 'adjective_taru',
    classes: ['adjective_taru'],
    subtypes: [],
    conjugation: 'not_applicable',
  };
  assert.equal(metadata.validate(taruAdjective), true);
  const taruWithVerbConjugation = structuredClone(taruAdjective);
  taruWithVerbConjugation.pos.conjugation = 'godan';
  assert.throws(() => metadata.validate(taruWithVerbConjugation), /without verb class/);
  assert.equal(metadata.ENUMS.pos.includes('adjective_taru'), true);
  assert.equal(metadata.posLabel(taruAdjective.pos, 'zh'), 'タリ形容词');
  assert.equal(metadata.posLabel(taruAdjective.pos, 'ja'), 'タリ形容詞');
});

test('accessors and display labels support legacy strings and structured values', () => {
  const f = fields();
  assert.equal(metadata.primary(f.pos), 'noun');
  assert.deepEqual(metadata.classes(f.pos), ['noun', 'verb']);
  assert.equal(metadata.hasClass(f.pos, 'verb'), true);
  assert.match(metadata.posLabel(f.pos, 'zh'), /名词.*动词/);
  assert.equal(metadata.conjugationLabel(f.pos, 'ja'), 'サ変');
  assert.match(metadata.transitivityLabel(f.transitivity, 'zh'), /自他两用.*サ变/);
  assert.equal(
    metadata.transitivityLabel({ value: 'not_applicable', scope: 'not_applicable' }, 'zh'),
    '不适用',
  );
  assert.match(metadata.registerLabel(f.register, 'ja'), /口語.*文学/);
  assert.match(metadata.styleLabel(f.style, 'ja'), /ビジネス.*教育/);
  assert.equal(metadata.posLabel('noun', 'zh'), '名词');
  assert.equal(metadata.registerLabel('neutral', 'zh'), '中性');
  assert.equal(metadata.transitivityLabel('intransitive', 'zh'), '自动');
  assert.equal(metadata.styleLabel('written', 'zh'), '书面');
  assert.equal(metadata.posLabel('旧版自定义词类', 'zh'), '旧版自定义词类');
  assert.equal(metadata.registerLabel('旧语体', 'zh'), '旧语体');
  for (const [code, zh, ja] of [
    ['spoken', '口语', '話し言葉'],
    ['written', '书面', '書き言葉'],
    ['formal', '正式', 'フォーマル'],
    ['informal', '非正式', 'インフォーマル'],
    ['colloquial', '口语化', '口語'],
    ['literary', '文学', '文学'],
    ['neutral', '中性', '中立'],
    ['unknown', '未知', '不明'],
  ]) {
    assert.equal(metadata.registerLabel(code, 'zh'), zh);
    assert.equal(metadata.registerLabel(code, 'ja'), ja);
  }
  for (const [code, zh, ja] of [
    ['spoken', '口语', '話し言葉'],
    ['written', '书面', '書き言葉'],
    ['literary', '文学', '文学'],
    ['news', '新闻', 'ニュース'],
    ['educational', '教学', '教育'],
    ['unknown', '未知', '不明'],
  ]) {
    assert.equal(metadata.styleLabel(code, 'zh'), zh);
    assert.equal(metadata.styleLabel(code, 'ja'), ja);
  }
});

test('UMD publishes to both globalThis and window, and a separate loader VM receives an explicit bridge', () => {
  const metadataSource = fs.readFileSync(path.join(__dirname, '../js/core/lexical-metadata.js'), 'utf8');
  const loaderSource = fs.readFileSync(path.join(__dirname, '../js/loader.js'), 'utf8');
  const firstWindow = {};
  const firstContext = vm.createContext({ window: firstWindow });
  vm.runInContext(metadataSource, firstContext);
  assert.equal(typeof firstContext.JPLearn.lexicalMetadata.normalize, 'function');
  assert.equal(firstWindow.JPLearn.lexicalMetadata, firstContext.JPLearn.lexicalMetadata);

  const secondWindow = { JPLearn: { lexicalMetadata: firstWindow.JPLearn.lexicalMetadata } };
  const secondContext = vm.createContext({ window: secondWindow, console });
  vm.runInContext(loaderSource, secondContext);
  const legacyWord = {
    index: 1,
    word: '感心',
    reading_hiragana: 'かんしん',
    meaning: '感心する',
    pos: {
      primary: 'adjective_na',
      classes: ['verb', 'noun', 'adjective_na'],
      subtypes: [],
      conjugation: 'suru',
    },
    transitivity: { value: 'unknown', scope: 'suru' },
    register: { formality: 'neutral', politeness: [], usage: [] },
    style: { medium: 'general', genres: [] },
  };
  const [loaded] = secondWindow.dataLoader.normalizeWords([legacyWord]);
  assert.deepEqual(Array.from(loaded.pos.classes), ['noun', 'verb', 'adjective_na']);
});

test('reviewMatches checks full effective lexical identity', () => {
  const row = {
    word: 'する',
    reading_hiragana: 'する',
    meaning: '做',
    lexical_review: { identity: { word: 'する', reading_hiragana: 'する', meaning: '做' } },
  };
  assert.equal(metadata.reviewMatches(row), true);
  assert.equal(metadata.reviewMatches({ ...row, meaning: '另一个义项' }), false);
});

test('reviewMatches preserves exact baseline identities with empty reading or meaning', () => {
  const row = {
    word: '学生',
    reading_hiragana: '',
    meaning: '',
    lexical_review: { identity: { word: '学生', reading_hiragana: '', meaning: '' } },
  };
  assert.equal(metadata.reviewMatches(row), true);
  assert.equal(metadata.reviewMatches({ ...row, reading_hiragana: 'がくせい' }), false);
  assert.equal(metadata.reviewMatches({ ...row, meaning: '学生' }), false);
});
