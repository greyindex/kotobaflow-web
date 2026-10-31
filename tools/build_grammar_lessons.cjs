#!/usr/bin/env node
'use strict';

/**
 * GRAMMAR-LESSON-02 build: merges the checked plain-text drafts into data/grammar_lessons.json,
 * rewrites grammar_index lessonIds and records how the 2026-09-23 lesson corrections map onto the
 * new file. See docs/grammar-lessons-rewrite.md.
 *
 *   node tools/build_grammar_lessons.cjs            validate and print a summary (no writes)
 *   node tools/build_grammar_lessons.cjs --write    write data and the correction relocation file
 *   node tools/build_grammar_lessons.cjs --check    exit 1 when the written files differ from a rebuild
 *
 * Drafts and plan live in the ignored local/grammar-lessons-v2/ directory. grammar_points are copied
 * unchanged by UID from the current data file, whichever layout it has.
 */

const fs = require('fs');
const path = require('path');
const { parseDraft, checkDraft } = require('./grammar_lesson_drafts.cjs');

const ROOT = path.resolve(__dirname, '..');
const LESSONS = 'data/grammar_lessons.json';
const INDEX = 'data/grammar_index.json';
const CORRECTIONS = 'resources/quality/learning-content-corrections-2026-09-23.json';
const RELOCATION = 'resources/quality/grammar-lessons-v2-2026-10-31.json';
const TASK = 'GRAMMAR-LESSON-02';

const readJson = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const serialize = (value) => JSON.stringify(value, null, 2) + '\n';
const isRewritten = (lessons) => lessons.every((lesson) => typeof lesson.seed === 'string');

function buildLessons(plan, catalog, draftsDir, pointsByUid, problems) {
  const lessons = [];
  const titles = new Map();
  plan.forEach((planned, i) => {
    const file = path.join(draftsDir, planned.lesson + '.txt');
    if (!fs.existsSync(file)) {
      problems.push(`${planned.lesson}: draft missing`);
      return;
    }
    const draft = parseDraft(fs.readFileSync(file, 'utf8'));
    const { errors } = checkDraft(draft, planned);
    errors.forEach((e) => problems.push(`${planned.lesson}: ${e}`));
    if (titles.has(draft.title_ja)) problems.push(`${planned.lesson}: title same as ${titles.get(draft.title_ja)}`);
    titles.set(draft.title_ja, planned.lesson);
    const uids = planned.grammar.map((g) => g.uid);
    lessons.push({
      lesson_id: i + 1,
      level: planned.level,
      seed: planned.seed,
      theme: `${catalog.themes[planned.theme]} · ${catalog.types[planned.type].label}`,
      title_ja: draft.title_ja,
      title_zh: draft.title_zh,
      summary_zh: draft.summary_zh,
      paragraphs_ja: draft.paragraphs_ja,
      paragraphs_zh: draft.paragraphs_zh,
      grammar_uids: uids,
      grammar_points: uids.map((uid) => {
        if (!pointsByUid.has(uid)) problems.push(`${planned.lesson}: no grammar_points entry for ${uid}`);
        return pointsByUid.get(uid);
      }),
    });
  });
  return lessons;
}

// Corrections addressed old lesson text by array position. Text corrections are superseded by the
// rewrite; grammar_points corrections keep their content and are relocated by UID.
function relocateCorrections(oldLessons, corrections) {
  const superseded = [];
  const relocated = [];
  for (const c of corrections) {
    if (c.file !== LESSONS) continue;
    const [index, field, pointIndex, pointField] = c.path;
    const lesson = oldLessons[index];
    if (!lesson || lesson.lesson_id !== c.guards[0].value) throw Error(`${c.id}: old lesson guard mismatch`);
    if (field === 'grammar_points') {
      const point = lesson.grammar_points[pointIndex];
      if (!point || !Object.hasOwn(point, pointField)) throw Error(`${c.id}: old grammar point missing`);
      relocated.push({ id: c.id, uid: point.uid, field: pointField });
    } else superseded.push(c.id);
  }
  return {
    schemaVersion: 1,
    task: TASK,
    description:
      '2026-10-31 语法辅助课文重做后，2026-09-23 修订中指向 data/grammar_lessons.json 的条目：superseded 为被新课文取代的正文、标题和摘要修订；relocated 为目标语法卡修订，内容不变，按 UID 定位到新位置。',
    superseded,
    relocated,
  };
}

function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const check = args.includes('--check');
  const workDir = path.resolve(ROOT, 'local/grammar-lessons-v2');
  const plan = JSON.parse(fs.readFileSync(path.join(workDir, 'plan.json'), 'utf8')).lessons;
  const catalog = readJson('tools/grammar_lessons_seeds.json');
  const current = readJson(LESSONS);
  const index = readJson(INDEX);
  const problems = [];

  const pointsByUid = new Map();
  current.forEach((lesson) => lesson.grammar_points.forEach((p) => pointsByUid.set(p.uid, p)));

  const lessons = buildLessons(plan, catalog, path.join(workDir, 'drafts'), pointsByUid, problems);
  const lessonByUid = new Map();
  for (const lesson of lessons)
    for (const uid of lesson.grammar_uids) {
      if (lessonByUid.has(uid)) problems.push(`${uid} in lessons ${lessonByUid.get(uid)} and ${lesson.lesson_id}`);
      lessonByUid.set(uid, lesson.lesson_id);
    }
  const newIndex = index.map((entry) => {
    if (!lessonByUid.has(entry.uid)) problems.push(`${entry.uid} not in any lesson`);
    return { ...entry, lessonIds: lessonByUid.has(entry.uid) ? [lessonByUid.get(entry.uid)] : [] };
  });
  if (lessonByUid.size !== index.length) problems.push(`lessons cover ${lessonByUid.size}/${index.length} UIDs`);

  const relocation = isRewritten(current)
    ? readJson(RELOCATION)
    : relocateCorrections(current, readJson(CORRECTIONS).corrections);

  if (problems.length) {
    console.error(problems.join('\n'));
    process.exitCode = 1;
    return;
  }

  const outputs = [
    [LESSONS, serialize(lessons)],
    [INDEX, serialize(newIndex)],
    [RELOCATION, serialize(relocation)],
  ];
  const levels = {};
  lessons.forEach((l) => (levels[l.level] = (levels[l.level] || 0) + 1));
  console.log(
    `${lessons.length} lessons ${JSON.stringify(levels)}, ${lessonByUid.size} UIDs; corrections: ` +
      `${relocation.superseded.length} superseded, ${relocation.relocated.length} relocated`,
  );
  if (check) {
    const stale = outputs.filter(([file, text]) => {
      const absolute = path.join(ROOT, file);
      return !fs.existsSync(absolute) || fs.readFileSync(absolute, 'utf8') !== text;
    });
    stale.forEach(([file]) => console.error(`${file} differs from rebuild`));
    if (stale.length) process.exitCode = 1;
    return;
  }
  if (write) {
    for (const [file, text] of outputs) {
      const absolute = path.join(ROOT, file);
      if (fs.existsSync(absolute) && fs.readFileSync(absolute, 'utf8') === text) continue;
      fs.writeFileSync(absolute, text);
      console.log(`wrote ${file}`);
    }
  }
}

main();
