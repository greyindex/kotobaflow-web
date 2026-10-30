#!/usr/bin/env node
/*
 * Generic conservative boundary fixer for:
 *
 *   Xと | 思う/考える/感じる...  ->  X | と思う/と考える/と感じる...
 *
 * It intentionally does not merge と with 言う/書く/呼ぶ/述べる because those
 * are reporting/quotation predicates and are more context-dependent.
 *
 * Usage:
 *   node tools/fix_thought_predicate_boundaries.js --input data/textbook/textbook_text_chunks.v2.json
 *   node tools/fix_thought_predicate_boundaries.js --input in.json --out out.json
 */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = { input: '', out: '' };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--input') args.input = path.resolve(next());
    else if (arg === '--out') args.out = path.resolve(next());
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.input) throw new Error('--input is required');
  if (!args.out) args.out = args.input;
  return args;
}

function clone(chunk) {
  return { ...chunk };
}

function startsWithThoughtPredicate(text) {
  return /^[\u601d\u8003\u611f]/u.test(text || '');
}

function splitTrailingTo(chunk) {
  const surface = chunk.surface || '';
  if (!surface.endsWith('\u3068')) return null;

  if (surface === '\u3068') {
    return {
      content: null,
      toSurface: '\u3068',
      toDisplay: chunk.display || '\u3068',
    };
  }

  const display = chunk.display || surface;
  const content = clone(chunk);
  content.surface = surface.slice(0, -1);
  content.display = display.endsWith('\u3068') ? display.slice(0, -1).trim() : content.surface.trim();
  content.role_zh = '引用/内容';
  content.color_key = 'quote';
  content.grammar_zh = '思考/判断的内容';
  return {
    content,
    toSurface: '\u3068',
    toDisplay: '\u3068',
  };
}

function mergeToPredicate(toSurface, toDisplay, predicate) {
  const predDisplay = predicate.display || predicate.surface || '';
  return {
    ...clone(predicate),
    surface: `${toSurface}${predicate.surface}`,
    display: `${toDisplay}${predDisplay}`.trim(),
    role_zh: '谓语',
    color_key: 'predicate',
    grammar_zh: 'と标记思考/判断内容，后接思う/考える/感じる类谓语',
    boundary_fix: 'thought_predicate_to_v2',
  };
}

function normalizeSentence(sentence) {
  const chunks = sentence.chunks || [];
  const out = [];
  let changed = false;

  for (let i = 0; i < chunks.length; i += 1) {
    const current = chunks[i];
    const next = chunks[i + 1];
    const nextText = next ? `${next.display || ''}${next.surface || ''}` : '';

    if (next && startsWithThoughtPredicate(nextText)) {
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
  const joined = out.map((chunk) => chunk.surface || '').join('');
  if (joined !== sentence.text) {
    throw new Error(`Join mismatch after thought predicate fix: ${sentence.id || sentence.text}`);
  }
  sentence.chunks = out;
  return true;
}

function walkSentences(root) {
  if (Array.isArray(root.sentences)) return root.sentences;
  if (Array.isArray(root.readings)) {
    return root.readings.flatMap((reading) => reading.sentences || []);
  }
  throw new Error('Unsupported JSON shape: expected .sentences[] or .readings[].sentences[]');
}

function main() {
  const args = parseArgs(process.argv);
  const data = JSON.parse(fs.readFileSync(args.input, 'utf8'));
  const sentences = walkSentences(data);
  let changed = 0;
  for (const sentence of sentences) {
    if (normalizeSentence(sentence)) changed += 1;
  }
  data.meta = {
    ...(data.meta || {}),
    thought_predicate_boundary_fix_count: changed,
  };
  fs.writeFileSync(args.out, JSON.stringify(data, null, 2), 'utf8');
  console.log(JSON.stringify({ input: args.input, out: args.out, sentences: sentences.length, changed }, null, 2));
}

main();
