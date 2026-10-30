#!/usr/bin/env node
/*
 * Conservative boundary fix for thought/judgment predicates:
 *
 *   Xと | 思う/考える/感じる...  ->  X | と思う/と考える/と感じる...
 *
 * This script intentionally does not touch 言う/書く/呼ぶ patterns because
 * quote/reporting chunks are more context-dependent.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const V2 = path.join(ROOT, 'data', 'textbook', 'textbook_text_chunks.v2.json');

const THOUGHT_RE = /^(思|考え|感じ)/;

function clone(chunk) {
  return { ...chunk };
}

function splitTrailingTo(chunk) {
  const surface = chunk.surface || '';
  if (!surface.endsWith('と')) return null;
  if (surface === 'と') return { content: null, toSurface: surface, toDisplay: chunk.display || surface };

  const display = chunk.display || surface;
  const content = clone(chunk);
  content.surface = surface.slice(0, -1);
  content.display = display.endsWith('と') ? display.slice(0, -1).trim() : content.surface.trim();
  content.role_zh = '引用/内容';
  content.color_key = 'quote';
  if (!content.grammar_zh || content.grammar_zh.includes('と')) {
    content.grammar_zh = '思考/判断的内容';
  }
  return { content, toSurface: 'と', toDisplay: 'と' };
}

function mergeToPredicate(toSurface, toDisplay, predicate) {
  const predDisplay = predicate.display || predicate.surface;
  return {
    ...clone(predicate),
    surface: `${toSurface}${predicate.surface}`,
    display: `${toDisplay}${predDisplay}`,
    role_zh: '谓语',
    color_key: 'predicate',
    grammar_zh: `${toDisplay.trim()}标记思考/判断内容，${predDisplay}表示认为/想/考虑`,
    boundary_fix: 'thought_predicate_to'
  };
}

function normalizeSentence(sentence) {
  const chunks = sentence.chunks || [];
  const out = [];
  let changed = false;

  for (let i = 0; i < chunks.length; i += 1) {
    const current = chunks[i];
    const next = chunks[i + 1];
    const nextDisplay = next ? (next.display || next.surface || '') : '';
    if (next && THOUGHT_RE.test(nextDisplay)) {
      const split = splitTrailingTo(current);
      if (split) {
        if (split.content && split.content.surface) out.push(split.content);
        out.push(mergeToPredicate(split.toSurface, split.toDisplay, next));
        i += 1;
        changed = true;
        continue;
      }
    }
    out.push(current);
  }

  if (!changed) return false;
  const joined = out.map((chunk) => chunk.surface).join('');
  if (joined !== sentence.text) {
    throw new Error(`Join mismatch after thought predicate fix: ${sentence.id}`);
  }
  sentence.chunks = out;
  return true;
}

function main() {
  const data = JSON.parse(fs.readFileSync(V2, 'utf8'));
  let changed = 0;
  for (const sentence of data.sentences) {
    if (normalizeSentence(sentence)) changed += 1;
  }
  data.meta = {
    ...(data.meta || {}),
    thought_predicate_to_fix_count: changed
  };
  fs.writeFileSync(V2, JSON.stringify(data, null, 2), 'utf8');
  console.log(JSON.stringify({ changed }));
}

main();
