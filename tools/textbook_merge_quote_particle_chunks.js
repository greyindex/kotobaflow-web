#!/usr/bin/env node
/*
 * Merge Japanese quote spans plus following particles into display-friendly
 * grammar chunks.
 *
 * Examples:
 *   「 | 脳科学者の卵 | 」 | と  -> 「脳科学者の卵」と
 *   「 | タマゴさん | 」 | は    -> 「タマゴさん」は
 *   「 | 脳内イメージ | 」 | という -> 「脳内イメージ」という
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const V2 = path.join(ROOT, 'data', 'textbook', 'textbook_text_chunks.v2.json');

const PAIR = new Map([
  ['「', '」'],
  ['『', '』']
]);

const SUFFIXES = new Set([
  'と', 'とか', 'という', 'とは', 'とも',
  'は', 'が', 'を', 'に', 'で', 'へ', 'も', 'の',
  'には', 'では'
]);

function strip(value) {
  return (value || '').trim();
}

function classify(display, suffix) {
  if (suffix === 'は') return ['主题', 'topic', '引用整体+は提示主题'];
  if (suffix === 'が') return ['主语', 'subject', '引用整体+が标记主语'];
  if (suffix === 'を') return ['宾语', 'object', '引用整体+を标记宾语'];
  if (suffix === 'に' || suffix === 'には') return ['对象', 'direction', '引用整体+に表示对象/范围'];
  if (suffix === 'で' || suffix === 'では') return ['方式', 'direction', '引用整体+で/では表示范围或方式'];
  if (suffix === 'の') return ['修饰', 'modifier', '引用整体+の修饰后续名词'];
  if (suffix === 'という') return ['引用/内容', 'quote', 'という概括前面的引用内容'];
  if (suffix === 'とか') return ['连接', 'connector', 'とか表示列举'];
  if (suffix === 'と' || suffix === 'とは' || suffix === 'とも') return ['引用/内容', 'quote', 'と标记引用/内容'];
  return ['引用/内容', 'quote', '引用内容'];
}

function mergeSpan(chunks, start, end, suffixIndex) {
  const span = chunks.slice(start, suffixIndex == null ? end + 1 : suffixIndex + 1);
  const surface = span.map((chunk) => chunk.surface).join('');
  const display = span.map((chunk) => chunk.display || chunk.surface).join('');
  const suffix = suffixIndex == null ? '' : strip(chunks[suffixIndex].display || chunks[suffixIndex].surface);
  const [role_zh, color_key, grammar_zh] = classify(display, suffix);
  const content = chunks.slice(start + 1, end).map((chunk) => chunk.display || chunk.surface).join('').trim();
  return {
    surface,
    display,
    meaning_zh: content || display,
    role_zh,
    grammar_zh,
    color_key,
    boundary_fix: 'quote_particle_merge'
  };
}

function normalizeSentence(sentence) {
  const chunks = sentence.chunks || [];
  const out = [];
  let changed = false;

  for (let i = 0; i < chunks.length; i += 1) {
    const open = strip(chunks[i].display || chunks[i].surface);
    const close = PAIR.get(open);
    if (!close) {
      out.push(chunks[i]);
      continue;
    }

    let end = -1;
    for (let j = i + 1; j < chunks.length; j += 1) {
      if (strip(chunks[j].display || chunks[j].surface) === close) {
        end = j;
        break;
      }
    }
    if (end < 0) {
      out.push(chunks[i]);
      continue;
    }

    const next = chunks[end + 1];
    const suffix = next ? strip(next.display || next.surface) : '';
    const suffixIndex = SUFFIXES.has(suffix) ? end + 1 : null;
    out.push(mergeSpan(chunks, i, end, suffixIndex));
    i = suffixIndex == null ? end : suffixIndex;
    changed = true;
  }

  if (!changed) return false;
  const joined = out.map((chunk) => chunk.surface).join('');
  if (joined !== sentence.text) {
    throw new Error(`Join mismatch after quote merge: ${sentence.id}`);
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
    quote_particle_merge_count: changed
  };
  fs.writeFileSync(V2, JSON.stringify(data, null, 2), 'utf8');
  console.log(JSON.stringify({ changed }));
}

main();
