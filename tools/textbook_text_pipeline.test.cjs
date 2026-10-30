const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanSourcePos, mergeLexiconTokens } = require('./textbook_text_pipeline.js');

const JP_NOUN = '名詞';
const JP_PARTICLE = '助詞';

function token(surface, pos, details = []) {
  return {
    surface_form: surface,
    basic_form: surface,
    reading: surface,
    pos,
    pos_detail_1: details[0] || '*',
    pos_detail_2: details[1] || '*',
    pos_detail_3: details[2] || '*',
  };
}

test('kana following に stays in kuromoji token boundaries without a lexicon hit', () => {
  const examples = [
    [
      token('に', JP_PARTICLE),
      token('なり', '動詞'),
      token('まし', '助動詞'),
      token('た', '助動詞'),
      token('が', JP_PARTICLE),
    ],
    [
      token('に', JP_PARTICLE),
      token('あり', '動詞'),
      token('まし', '助動詞'),
      token('た', '助動詞'),
      token('の', JP_PARTICLE),
    ],
    [
      token('に', JP_PARTICLE),
      token('どう', '副詞'),
      token('し', '動詞'),
      token('た', '助動詞'),
      token('の', JP_PARTICLE),
    ],
  ];

  for (const input of examples) {
    const merged = mergeLexiconTokens(input, new Map());
    assert.deepEqual(
      merged.map((item) => item.surface_form),
      input.map((item) => item.surface_form),
    );
    assert.deepEqual(merged, input);
    assert.equal(
      merged.some((item) => item.recovered),
      false,
    );
  }
});

test('lesson lexicon merge still combines a known multi-token term', () => {
  const input = [token('日', JP_NOUN), token('本', JP_NOUN), token('語', JP_NOUN), token('を', JP_PARTICLE)];
  const hit = { meaning_zh: '日语', pos_key: 'noun', pos_label_zh: '名词', reading: 'にほんご' };
  const merged = mergeLexiconTokens(input, new Map([['日本語', hit]]));

  assert.deepEqual(
    merged.map((item) => item.surface_form),
    ['日本語', 'を'],
  );
  assert.equal(merged[0].lex_hit, hit);
  assert.equal(merged[1], input[3]);
});

test('full 形容動詞 source label is classified as a na-adjective', () => {
  assert.deepEqual(cleanSourcePos('名詞・形容動詞語幹'), ['na_adjective', 'ナ形容词']);
  assert.deepEqual(cleanSourcePos('名词・形容动词'), ['na_adjective', 'ナ形容词']);
});
