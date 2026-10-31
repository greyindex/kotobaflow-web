#!/usr/bin/env node
'use strict';

/**
 * GRAMMAR-LESSON-02 plain-text drafts: parser and per-draft checks against the skeleton plan.
 *
 *   node tools/grammar_lesson_drafts.cjs [L001 L002 ...] [--dir local/grammar-lessons-v2]
 *
 * Without lesson ids, checks every draft present. Exit code 1 when any checked draft fails.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SHAPE = {
  N5: { chars: [400, 600], paras: [3, 5] },
  N4: { chars: [600, 800], paras: [4, 6] },
  N3: { chars: [700, 900], paras: [4, 6] },
  N2: { chars: [900, 1100], paras: [5, 7] },
  N1: { chars: [900, 1100], paras: [5, 7] },
};
const MARK = /\[\[([^:\]]+)::([^\]]*)\]\]/g;

function parseDraft(text) {
  const head = {};
  const body = { ja: [], zh: [] };
  let part = null;
  for (const line of text.replace(/^﻿/, '').replace(/\r\n/g, '\n').split('\n')) {
    const marker = line.match(/^\s*===\s*(ja|zh|end)\s*$/);
    if (marker) {
      part = marker[1];
      continue;
    }
    if (part === null) {
      const m = line.match(/^(.+?)[：:](.*)$/);
      if (m) head[m[1].trim().replace(/標/g, '标').replace(/題/g, '题')] = m[2].trim();
    } else if (part !== 'end') body[part].push(line);
  }
  const paras = (arr) =>
    arr
      .join('\n')
      .split(/\n\s*\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  return {
    lesson: head['课次'] || '',
    seed: head['题材'] || '',
    title_ja: head['标题ja'] || '',
    title_zh: head['标题zh'] || '',
    summary_zh: head['摘要zh'] || '',
    paragraphs_ja: paras(body.ja),
    paragraphs_zh: paras(body.zh),
  };
}

const plainText = (paras) => paras.join('').replace(MARK, '$2');

function checkDraft(draft, planned) {
  const errors = [];
  const shape = SHAPE[planned.level];
  for (const key of ['title_ja', 'title_zh', 'summary_zh'])
    if (!draft[key]) errors.push(`missing ${key}`);
  if (draft.lesson && draft.lesson !== planned.lesson) errors.push(`课次 ${draft.lesson} != ${planned.lesson}`);
  if (draft.seed !== planned.seed) errors.push(`题材 ${draft.seed} != ${planned.seed}`);
  const ja = draft.paragraphs_ja;
  if (ja.length !== draft.paragraphs_zh.length)
    errors.push(`paragraphs ja ${ja.length} != zh ${draft.paragraphs_zh.length}`);
  if (ja.length < shape.paras[0] || ja.length > shape.paras[1])
    errors.push(`${ja.length} paragraphs, expected ${shape.paras.join('-')}`);
  const chars = plainText(ja).length;
  if (chars < shape.chars[0] || chars > shape.chars[1])
    errors.push(`${chars} ja chars, expected ${shape.chars.join('-')}`);
  const counts = {};
  for (const m of ja.join('\n').matchAll(MARK)) {
    if (!m[2].trim()) errors.push(`empty mark ${m[1]}`);
    counts[m[1]] = (counts[m[1]] || 0) + 1;
  }
  const targets = planned.grammar.map((g) => g.uid);
  for (const uid of targets) {
    if (!counts[uid]) errors.push(`${uid} not marked`);
    else if (counts[uid] > 2) errors.push(`${uid} marked ${counts[uid]} times`);
  }
  for (const uid of Object.keys(counts)) if (!targets.includes(uid)) errors.push(`${uid} is not a target`);
  if (/\[\[|\]\]/.test(plainText(ja))) errors.push('stray [[ or ]] in ja');
  if (/\[\[|\]\]/.test(draft.paragraphs_zh.join(''))) errors.push('marks in zh');
  return { chars, errors };
}

function main() {
  const args = process.argv.slice(2);
  const dirIndex = args.indexOf('--dir');
  const dir = path.resolve(ROOT, dirIndex >= 0 ? args[dirIndex + 1] : 'local/grammar-lessons-v2');
  const wanted = args.filter((a, i) => /^L\d{3}$/.test(a) && args[i - 1] !== '--dir');
  const plan = JSON.parse(fs.readFileSync(path.join(dir, 'plan.json'), 'utf8')).lessons;
  const draftsDir = path.join(dir, 'drafts');
  const ids = wanted.length
    ? wanted
    : plan.map((l) => l.lesson).filter((id) => fs.existsSync(path.join(draftsDir, id + '.txt')));
  let failed = 0;
  for (const id of ids) {
    const planned = plan.find((l) => l.lesson === id);
    const file = path.join(draftsDir, id + '.txt');
    if (!planned || !fs.existsSync(file)) {
      console.log(`${id} FAIL ${planned ? 'draft missing' : 'not in plan'}`);
      failed++;
      continue;
    }
    const { chars, errors } = checkDraft(parseDraft(fs.readFileSync(file, 'utf8')), planned);
    console.log(`${id} ${errors.length ? 'FAIL' : 'ok'} ${chars} chars${errors.length ? ': ' + errors.join('; ') : ''}`);
    if (errors.length) failed++;
  }
  console.log(`${ids.length - failed}/${ids.length} drafts pass`);
  if (failed) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { parseDraft, checkDraft, plainText };
