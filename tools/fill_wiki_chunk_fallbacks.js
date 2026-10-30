#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_INPUT = path.join(ROOT, 'data', 'wiki', 'processed', 'textbook_wiki_reading_chunks.v1.json');

function parseArgs(argv) {
  const args = { input: DEFAULT_INPUT, out: '' };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--input') args.input = path.resolve(next());
    else if (arg === '--out') args.out = path.resolve(next());
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.out) args.out = args.input;
  return args;
}

function fallbackChunks(text) {
  const chunks = [];
  const punct = new Set(['、', '。', '「', '」', '『', '』', '？', '！', '.', '!', '?']);
  let buffer = '';

  function flush() {
    if (!buffer) return;
    chunks.push({
      surface: buffer,
      display: buffer.trim() || buffer,
      meaning_zh: '词块',
      role_zh: '其他',
      grammar_zh: '自动 fallback 粗分块',
      color_key: 'other',
      fallback_chunk: true,
    });
    buffer = '';
  }

  for (const ch of text) {
    if (punct.has(ch)) {
      flush();
      chunks.push({
        surface: ch,
        display: ch,
        meaning_zh: ch,
        role_zh: '标点',
        grammar_zh: '标点',
        color_key: 'punctuation',
        fallback_chunk: true,
      });
    } else {
      buffer += ch;
    }
  }
  flush();
  return chunks;
}

function main() {
  const args = parseArgs(process.argv);
  const data = JSON.parse(fs.readFileSync(args.input, 'utf8'));
  let filled = 0;
  let joinErrors = 0;

  for (const reading of data.readings || []) {
    for (const sentence of reading.sentences || []) {
      const joined = Array.isArray(sentence.chunks)
        ? sentence.chunks.map((chunk) => chunk.surface || '').join('')
        : '';
      if (!Array.isArray(sentence.chunks) || sentence.chunks.length === 0 || joined !== sentence.text) {
        sentence.chunks = fallbackChunks(sentence.text);
        sentence.fallback = true;
        filled += 1;
      }
      const check = sentence.chunks.map((chunk) => chunk.surface || '').join('');
      if (check !== sentence.text) joinErrors += 1;
    }
  }

  data.meta = {
    ...(data.meta || {}),
    fallback_sentence_count: filled,
  };
  fs.writeFileSync(args.out, JSON.stringify(data, null, 2), 'utf8');
  console.log(JSON.stringify({ filled, joinErrors }, null, 2));
}

main();
