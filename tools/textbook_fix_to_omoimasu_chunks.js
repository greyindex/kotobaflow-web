#!/usr/bin/env node
/*
 * Normalize chunk boundaries around と/と思います.
 *
 * Teaching display should usually show the quoted/thought content separately
 * and keep と思います / と思いますか / と思いますが as the predicate chunk.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const V2 = path.join(ROOT, 'data', 'textbook', 'textbook_text_chunks.v2.json');

function clone(chunk) {
  return { ...chunk };
}

function isOmoimasuChunk(chunk) {
  return /^思います(か|が)?$/.test(chunk.display || chunk.surface || '');
}

function splitTrailingTo(chunk) {
  const surface = chunk.surface || '';
  if (!surface.endsWith('と')) return null;
  if (surface === 'と') return { content: null, toSurface: surface };
  const contentSurface = surface.slice(0, -1);
  const content = clone(chunk);
  content.surface = contentSurface;
  content.display = (chunk.display || surface).endsWith('と')
    ? (chunk.display || surface).slice(0, -1).trim()
    : contentSurface.trim();
  content.meaning_zh = chunk.meaning_zh || content.display;
  content.role_zh = chunk.role_zh === '引用/内容' ? '引用/内容' : chunk.role_zh;
  content.color_key = chunk.color_key === 'quote' ? 'quote' : chunk.color_key;
  return { content, toSurface: 'と' };
}

function makeToOmoimasu(toSurface, omoimasuChunk) {
  const display = `${toSurface}${omoimasuChunk.display || omoimasuChunk.surface}`;
  return {
    ...clone(omoimasuChunk),
    surface: `${toSurface}${omoimasuChunk.surface}`,
    display,
    meaning_zh: omoimasuChunk.meaning_zh || '认为/想',
    role_zh: '谓语',
    grammar_zh: `${toSurface}标记思考/引用内容，${omoimasuChunk.display || omoimasuChunk.surface}表示认为/想`,
    color_key: 'predicate',
    boundary_fix: 'to_omoimasu'
  };
}

function normalizeSentence(sentence) {
  const chunks = sentence.chunks || [];
  const out = [];
  let changed = false;
  for (let i = 0; i < chunks.length; i += 1) {
    const current = chunks[i];
    const next = chunks[i + 1];
    if (next && isOmoimasuChunk(next)) {
      if ((current.surface || '') === 'と') {
        out.push(makeToOmoimasu(current.surface, next));
        i += 1;
        changed = true;
        continue;
      }
      const split = splitTrailingTo(current);
      if (split) {
        if (split.content && split.content.surface) out.push(split.content);
        out.push(makeToOmoimasu(split.toSurface, next));
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
    throw new Error(`Join mismatch after fix for ${sentence.id}`);
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
    to_omoimasu_boundary_fix_count: changed
  };
  fs.writeFileSync(V2, JSON.stringify(data, null, 2), 'utf8');
  console.log(JSON.stringify({ changed }));
}

main();
