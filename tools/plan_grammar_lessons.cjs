#!/usr/bin/env node
'use strict';

/**
 * GRAMMAR-LESSON-02 skeleton: groups grammar points into lessons, assigns one seed per lesson and
 * writes a writing brief per lesson. See docs/grammar-lessons-rewrite.md.
 *
 *   node tools/plan_grammar_lessons.cjs [--out local/grammar-lessons-v2]
 *
 * Grouping is by stride within a level: point i (UID order) goes to lesson i mod k. UID-adjacent
 * points (same cluster, e.g. N4 keigo) therefore land in different lessons.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'];
const SHAPE = {
  N5: { chars: [400, 600], paras: [3, 5] },
  N4: { chars: [600, 800], paras: [4, 6] },
  N3: { chars: [700, 900], paras: [4, 6] },
  N2: { chars: [900, 1100], paras: [5, 7] },
  N1: { chars: [900, 1100], paras: [5, 7] },
};
const THEME_SHARE_MAX = 0.12;
const TYPE_SHARE_MAX = 0.25;

function argValue(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const clashes = (a, b) => a.theme === b.theme || a.type === b.type;

// Greedy reorder so neighbouring lessons differ in theme and type; tries each starting seed in
// listed order and keeps the first clean result.
function orderSeeds(seeds) {
  let first = null;
  for (let start = 0; start < seeds.length; start++) {
    const rest = seeds.slice(start).concat(seeds.slice(0, start));
    const out = [];
    while (rest.length) {
      const prev = out[out.length - 1];
      let i = prev ? rest.findIndex((s) => !clashes(s, prev)) : 0;
      if (i < 0) i = 0;
      out.push(rest.splice(i, 1)[0]);
    }
    if (out.every((s, i) => i === 0 || !clashes(out[i - 1], s))) return out;
    first = first || out;
  }
  return first;
}

function brief(lesson, catalog) {
  const shape = SHAPE[lesson.level];
  const type = catalog.types[lesson.type];
  const lines = [
    `课次：${lesson.lesson}`,
    `等级：${lesson.level}`,
    `主题：${catalog.themes[lesson.theme]}`,
    `故事类型：${type.label}——${type.guide}`,
    `母题 ${lesson.seed}：${lesson.premise}`,
    `笑点：${lesson.twist}`,
    `篇幅：日文 ${shape.chars[0]}–${shape.chars[1]} 字（不含标记），${shape.paras[0]}–${shape.paras[1]} 段`,
    '',
    `目标语法（${lesson.grammar.length} 个，每个都要在日文正文中使用并标记）：`,
    ...lesson.grammar.map(
      (g) =>
        `- ${g.uid} ${g.form}：${g.meaning}` +
        (g.pattern ? `｜接续 ${g.pattern}` : '') +
        (g.warning ? `｜注意 ${g.warning}` : ''),
    ),
    '',
    '写作规则：',
    `1. 词汇和非目标语法不超过 ${lesson.level}，更低等级的语法可以自由使用、不标记。读者是中国学习者。`,
    '2. 目标语法写成 [[UID::原文片段]]，片段只含语法本身及必要的活用部分；每个 UID 至少标一次、最多两次；中文译文不加标记。',
    '3. 母题和笑点是骨架，可以改人物、地点和细节，但笑点的结构保留，并放在最后一段；前文要铺垫。笑点里的中文是意思，日文要写成自然的日语说法。',
    '4. 语法要用在自然的句子里，不能为了塞语法写不自然的句子；敬语等语体可以借对话、引用或信件引入。',
    '5. 讽刺对象是制度和官僚话语；领导人只用职称，不写真实姓名；不写针对民族的笑话，不写色情、血腥内容。',
    '6. 中文译文与日文逐段对应、段数相同，自然通顺。摘要只写一句这篇讲了什么，不写评价和口号。',
    '',
    '输出格式（纯文本，字段名照抄，用 === 行分隔段落区）：',
    `课次：${lesson.lesson}`,
    `题材：${lesson.seed}`,
    '标题ja：（日文标题）',
    '标题zh：（中文标题）',
    '摘要zh：（一句话）',
    '=== ja',
    '（日文第1段）',
    '',
    '（日文第2段）',
    '=== zh',
    '（中文第1段）',
    '',
    '（中文第2段）',
    '=== end',
  ];
  return lines.join('\n') + '\n';
}

function main() {
  const outDir = path.resolve(ROOT, argValue('--out', 'local/grammar-lessons-v2'));
  const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, 'grammar_lessons_seeds.json'), 'utf8'));
  const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/grammar_index.json'), 'utf8'));
  const problems = [];

  const ids = new Set();
  for (const s of catalog.seeds) {
    if (ids.has(s.id)) problems.push(`duplicate seed ${s.id}`);
    ids.add(s.id);
    if (!catalog.themes[s.theme]) problems.push(`${s.id} unknown theme ${s.theme}`);
    if (!catalog.types[s.type]) problems.push(`${s.id} unknown type ${s.type}`);
  }

  const lessons = [];
  for (const level of LEVELS) {
    const points = index.filter((g) => g.level === level).sort((a, b) => a.index - b.index);
    const seeds = orderSeeds(catalog.seeds.filter((s) => s.level === level));
    const k = seeds.length;
    if (!k) {
      problems.push(`no seeds for ${level}`);
      continue;
    }
    const groups = Array.from({ length: k }, () => []);
    points.forEach((g, i) => groups[i % k].push(g));
    seeds.forEach((seed, j) => {
      lessons.push({
        lesson: 'L' + String(lessons.length + 1).padStart(3, '0'),
        level,
        seed: seed.id,
        theme: seed.theme,
        type: seed.type,
        premise: seed.premise,
        twist: seed.twist,
        grammar: groups[j].map((g) => ({
          uid: g.uid,
          form: g.cleanTitle || g.title,
          meaning: g.coreMeaningZh || '',
          pattern: g.canonicalForm || '',
          warning: g.keyWarning || '',
        })),
      });
    });
  }

  const covered = lessons.flatMap((l) => l.grammar.map((g) => g.uid));
  if (new Set(covered).size !== index.length || covered.length !== index.length)
    problems.push(`coverage ${new Set(covered).size}/${index.length}`);
  for (let i = 1; i < lessons.length; i++) {
    const a = lessons[i - 1];
    const b = lessons[i];
    if (a.level === b.level && (a.theme === b.theme || a.type === b.type))
      problems.push(`${a.lesson}/${b.lesson} adjacent ${a.theme === b.theme ? 'theme' : 'type'}`);
  }
  const share = (key, max) => {
    const counts = {};
    lessons.forEach((l) => (counts[l[key]] = (counts[l[key]] || 0) + 1));
    for (const [k, n] of Object.entries(counts))
      if (n > Math.ceil(lessons.length * max)) problems.push(`${key} ${k} used ${n} times`);
    return counts;
  };
  const themeCounts = share('theme', THEME_SHARE_MAX);
  const typeCounts = share('type', TYPE_SHARE_MAX);

  fs.mkdirSync(path.join(outDir, 'briefs'), { recursive: true });
  fs.mkdirSync(path.join(outDir, 'drafts'), { recursive: true });
  fs.writeFileSync(path.join(outDir, 'plan.json'), JSON.stringify({ lessons }, null, 2) + '\n');
  for (const l of lessons) fs.writeFileSync(path.join(outDir, 'briefs', l.lesson + '.txt'), brief(l, catalog));

  for (const level of LEVELS) {
    const ls = lessons.filter((l) => l.level === level);
    const sizes = ls.map((l) => l.grammar.length);
    console.log(`${level}: ${ls.length} lessons, ${Math.min(...sizes)}-${Math.max(...sizes)} points`);
  }
  console.log('themes', JSON.stringify(themeCounts));
  console.log('types', JSON.stringify(typeCounts));
  console.log(`${lessons.length} briefs -> ${path.relative(ROOT, outDir)}`);
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exitCode = 1;
  }
}

main();
