#!/usr/bin/env node
/*
 * Fill missing Gemini chunk annotations using deterministic v1 token fallback.
 *
 * This is intended for a small residue of sentences that repeatedly fail LLM
 * validation because of unusual punctuation, dangling quotes, or source defects.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const V1 = path.join(ROOT, 'data', 'textbook', 'textbook_text_tokens.v1.json');
const V2 = path.join(ROOT, 'data', 'textbook', 'textbook_text_chunks.v2.json');

function roleForToken(token) {
  if (token.function_key === 'punctuation' || token.pos_key === 'symbol') return ['标点', 'punctuation'];
  if (token.pos_key === 'verb' || token.pos_key === 'auxiliary') return ['谓语', 'predicate'];
  if (token.pos_key === 'adverb') return ['副词', 'adverb'];
  if (token.pos_key === 'particle') return ['连接', 'connector'];
  if (token.pos_key === 'adjective' || token.pos_key === 'na_adjective' || token.pos_key === 'adnominal') return ['修饰', 'modifier'];
  if (token.pos_key === 'conjunction') return ['连接', 'connector'];
  return ['其他', 'other'];
}

function grammarForToken(token) {
  if (token.function_label_zh) return token.function_label_zh;
  if (token.pos_label_zh) return token.pos_label_zh;
  return '兜底标注';
}

function makeWholeSentenceFallback(source) {
  return [{
    surface: source.text,
    display: source.text.trim(),
    meaning_zh: '',
    role_zh: '其他',
    grammar_zh: 'LLM失败后的整句兜底',
    color_key: 'other',
    fallback: true
  }];
}

function makeFallbackChunks(source) {
  const text = source.text;
  const chunks = [];
  let cursor = 0;
  for (const token of source.tokens || []) {
    const surface = token.surface || '';
    if (!surface) continue;
    const found = text.indexOf(surface, cursor);
    if (found < 0) return makeWholeSentenceFallback(source);
    if (found > cursor) {
      const gap = text.slice(cursor, found);
      if (chunks.length) chunks[chunks.length - 1].surface += gap;
      else {
        chunks.push({
          surface: gap,
          display: gap.trim(),
          meaning_zh: '',
          role_zh: '其他',
          grammar_zh: '原文空白/未识别片段',
          color_key: 'other',
          fallback: true
        });
      }
    }
    const [role, color] = roleForToken(token);
    chunks.push({
      surface,
      display: surface.trim(),
      meaning_zh: token.meaning_zh || '',
      role_zh: role,
      grammar_zh: grammarForToken(token),
      color_key: color,
      fallback: true
    });
    cursor = found + surface.length;
  }
  if (cursor < text.length) {
    const rest = text.slice(cursor);
    if (chunks.length) chunks[chunks.length - 1].surface += rest;
    else return makeWholeSentenceFallback(source);
  }
  if (chunks.map((chunk) => chunk.surface).join('') !== text) return makeWholeSentenceFallback(source);
  return chunks;
}

function main() {
  const v1 = JSON.parse(fs.readFileSync(V1, 'utf8'));
  const v2 = JSON.parse(fs.readFileSync(V2, 'utf8'));
  const existing = new Set(v2.sentences.map((sentence) => sentence.id));
  const missing = v1.sentences.filter((sentence) => !existing.has(sentence.id));
  const fallbacks = missing.map((source) => ({
    id: source.id,
    source_index: source.source_index,
    book_id: source.book_id,
    lesson_id: source.lesson_id,
    lesson_no: source.lesson_no,
    lesson_title: source.lesson_title,
    section: source.section,
    role: source.role,
    speaker: source.speaker,
    turn_index: source.turn_index,
    sentence_index: source.sentence_index,
    text: source.text,
    chunks: makeFallbackChunks(source),
    fallback: true
  }));
  v2.sentences.push(...fallbacks);
  v2.sentences.sort((a, b) => a.source_index - b.source_index);
  v2.meta = {
    ...(v2.meta || {}),
    fallback_count: ((v2.meta && v2.meta.fallback_count) || 0) + fallbacks.length,
    failures: 0
  };
  v2.failures = [];
  fs.writeFileSync(V2, JSON.stringify(v2, null, 2), 'utf8');
  const jsonl = `${V2}.jsonl`;
  if (fallbacks.length) {
    fs.appendFileSync(jsonl, `${JSON.stringify({ ok: true, batch_index: 'fallback', fallback: true, results: fallbacks })}\n`, 'utf8');
  }
  console.log(JSON.stringify({ filled: fallbacks.length, total: v2.sentences.length }));
}

main();
