#!/usr/bin/env node
/*
 * Gemini chunk annotation pipeline for textbook text.
 *
 * Reads data/textbook/textbook_text_tokens.v1.json and produces sentence-level
 * grammar chunks. Existing v1 morphology output is not modified.
 *
 * Required:
 *   set GEMINI_API_KEY=...
 *
 * Examples:
 *   node tools/textbook_gemini_chunks.js --limit 20 --concurrency 4 --out data/textbook/textbook_text_chunks.v2.sample.json
 *   node tools/textbook_gemini_chunks.js --book XinBian4 --section application --limit 80 --concurrency 4
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INPUT = path.join(ROOT, 'data', 'textbook', 'textbook_text_tokens.v1.json');
const DEFAULT_OUT = path.join(ROOT, 'data', 'textbook', 'textbook_text_chunks.v2.json');
const DEFAULT_MODEL = 'gemini-3-flash-preview';
const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';

const ROLE_SET = new Set([
  '主题', '主语', '宾语', '时间', '地点', '方向', '起点', '终点', '对象', '方式',
  '原因', '目的', '副词', '连接', '修饰', '谓语', '说明/判断', '转折', '疑问',
  '引用/内容', '标点', '其他'
]);

const CHUNK_COLOR_SET = new Set([
  'topic', 'subject', 'object', 'time', 'place', 'direction', 'adverb',
  'connector', 'modifier', 'predicate', 'quote', 'punctuation', 'other'
]);

const TOKEN_COLOR_SET = new Set([
  'noun', 'verb', 'adjective', 'adverb', 'particle', 'auxiliary',
  'conjunction', 'punctuation', 'expression', 'other'
]);

const PUNCT_RE = /[、。「」『』（）？！]/;

function parseArgs(argv) {
  const args = {
    input: INPUT,
    out: DEFAULT_OUT,
    model: DEFAULT_MODEL,
    batchSize: 10,
    concurrency: 1,
    retries: 2,
    limit: 0,
    offset: 0,
    book: '',
    section: '',
    noTokens: false,
    dryRun: false
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--input') args.input = path.resolve(next());
    else if (arg === '--out') args.out = path.resolve(next());
    else if (arg === '--model') args.model = next();
    else if (arg === '--batch-size') args.batchSize = Number(next());
    else if (arg === '--concurrency') args.concurrency = Number(next());
    else if (arg === '--retries') args.retries = Number(next());
    else if (arg === '--limit') args.limit = Number(next());
    else if (arg === '--offset') args.offset = Number(next());
    else if (arg === '--book') args.book = next();
    else if (arg === '--section') args.section = next();
    else if (arg === '--no-tokens') args.noTokens = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isFinite(args.batchSize) || args.batchSize < 1) throw new Error('--batch-size must be >= 1');
  if (!Number.isFinite(args.concurrency) || args.concurrency < 1) throw new Error('--concurrency must be >= 1');
  return args;
}

function loadSentences(args) {
  const data = JSON.parse(fs.readFileSync(args.input, 'utf8'));
  let sentences = data.sentences.map((sentence, index) => ({ ...sentence, source_index: index }));
  if (args.book) sentences = sentences.filter((s) => s.book_id === args.book);
  if (args.section) sentences = sentences.filter((s) => s.section === args.section);
  if (args.offset) sentences = sentences.slice(args.offset);
  if (args.limit) sentences = sentences.slice(0, args.limit);
  return sentences;
}

function chunkArray(items, size) {
  const batches = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

function buildPrompt(batch, includeTokens) {
  const tokenPart = includeTokens
    ? `\n- tokens: 词块内部细分。每个 token 必须有 surface, pos_zh, meaning_zh, color_key。\n- token.surface 拼接必须完全等于 chunk.surface。\n- token color_key 只能用：noun, verb, adjective, adverb, particle, auxiliary, conjunction, punctuation, expression, other。`
    : '';

  return `你是日语教材课文的语法成分词块标注器。只输出严格 JSON。

目标：生成适合前端高亮的日语成分词块。外层 chunks 用于主高亮；${includeTokens ? '内层 tokens 用于 hover 细分。' : '不要输出 tokens。'}

强制规则：
1. chunks.surface 按顺序直接拼接必须完全等于 text，包括空格和标点。
2. surface 必须逐字复制原文中的连续片段，不能改字、漏字、加字。
3. 所有标点必须独立成为 chunk：、 。 「 」 『 』 （ ） ？ ！
4. 非标点 chunk 的 surface 绝对不能包含任何标点。
5. 标点 chunk: role_zh=标点, color_key=punctuation。
6. chunk 必须有 surface, display, meaning_zh, role_zh, grammar_zh, color_key${includeTokens ? ', tokens' : ''}。
7. display 是给学生看的文本，可以去掉首尾空格。
8. meaning_zh 是词块意思，简短，不要整句翻译。
9. grammar_zh 是简单语法点，短，例如：は提示主题、を标记宾语、で表动作地点、てください表请求。
10. role_zh 只能用：主题、主语、宾语、时间、地点、方向、起点、终点、对象、方式、原因、目的、副词、连接、修饰、谓语、说明/判断、转折、疑问、引用/内容、标点、其他。
11. color_key 只能用：topic, subject, object, time, place, direction, adverb, connector, modifier, predicate, quote, punctuation, other。${tokenPart}

切块规则：
- 外层按语法成分切，不按最小单词切。
- 主题：名词/代词+は 合成一块，如 李さんは、これは、日本人は。
- 主语/宾语/地点/时间/方向/方式：名词短语 + が/を/に/で/へ/から/まで/より/も 合成一块。
- の 连接的名词短语尽量合到后续核心名词和格助词，如 日本語の朗読を。
- 副词通常单独成块，如 よく、必ず、すこし、まず、実は、一般的に。
- 谓语表达合成一块，如 起きます、行きました、守ってください、説明できる、なのです。
- 引用/内容结构：XというN 优先切成 X | という | N+助词；短引用可合为 引用/内容 块。
- 长块超过18个日文字符时优先按助词、という、谓语边界拆开。
- 不要把宾语助词を单独拆出。
- 不确定时宁可外层块略粗，但标点必须拆开。

示例：
李さんは 毎朝、六時に 起きます。
=> 李さんは |  毎朝 | 、 | 六時に |  起きます | 。

必ず時間を守ってください。
=> 必ず | 時間を | 守ってください | 。

経済成長を考える前に、まず公害対策を考えなければならないという意見が強くなっている。
=> 経済成長を | 考える前に | 、 | まず | 公害対策を | 考えなければならない | という | 意見が | 強くなっている | 。

待处理句子：
${batch.map((s, i) => `${i + 1}. ${s.text}`).join('\n')}

JSON格式：{"sentences":[{"text":"原句","chunks":[{"surface":"...","display":"...","meaning_zh":"...","role_zh":"...","grammar_zh":"...","color_key":"..."${includeTokens ? ',"tokens":[{"surface":"...","pos_zh":"...","meaning_zh":"...","color_key":"..."}]' : ''}}]}]}`;
}

async function callGemini(args, prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set');
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0,
      topP: 0.1,
      maxOutputTokens: 16000,
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingBudget: 0 }
    }
  };
  const url = `${API_ROOT}/models/${args.model}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const api = await res.json();
  if (!res.ok || api.error) {
    const message = api.error ? `${api.error.status || api.error.code}: ${api.error.message}` : `HTTP ${res.status}`;
    throw new Error(message);
  }
  const text = api.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  if (!text) throw new Error('Gemini returned empty text');
  return { text, usage: api.usageMetadata || null, finishReason: api.candidates?.[0]?.finishReason || '' };
}

function validateChunk(chunk, includeTokens, errors, sentIndex, chunkIndex) {
  const prefix = `sentence ${sentIndex + 1} chunk ${chunkIndex + 1}`;
  for (const key of ['surface', 'display', 'meaning_zh', 'role_zh', 'grammar_zh', 'color_key']) {
    if (typeof chunk[key] !== 'string' || chunk[key].length === 0) errors.push(`${prefix}: missing ${key}`);
  }
  if (chunk.role_zh && !ROLE_SET.has(chunk.role_zh)) errors.push(`${prefix}: bad role_zh ${chunk.role_zh}`);
  if (chunk.color_key && !CHUNK_COLOR_SET.has(chunk.color_key)) errors.push(`${prefix}: bad color_key ${chunk.color_key}`);
  if (chunk.role_zh !== '标点' && PUNCT_RE.test(chunk.surface || '')) errors.push(`${prefix}: non-punctuation chunk contains punctuation`);
  if (chunk.role_zh === '标点' && chunk.color_key !== 'punctuation') errors.push(`${prefix}: punctuation chunk has non-punctuation color`);
  if (!includeTokens) return;
  if (!Array.isArray(chunk.tokens) || chunk.tokens.length === 0) {
    errors.push(`${prefix}: missing tokens`);
    return;
  }
  const tokenJoin = chunk.tokens.map((t) => t.surface || '').join('');
  if (tokenJoin !== chunk.surface) errors.push(`${prefix}: tokens do not join to chunk surface`);
  chunk.tokens.forEach((token, tokenIndex) => {
    const tokenPrefix = `${prefix} token ${tokenIndex + 1}`;
    for (const key of ['surface', 'pos_zh', 'meaning_zh', 'color_key']) {
      if (typeof token[key] !== 'string' || token[key].length === 0) errors.push(`${tokenPrefix}: missing ${key}`);
    }
    if (token.color_key && !TOKEN_COLOR_SET.has(token.color_key)) errors.push(`${tokenPrefix}: bad color_key ${token.color_key}`);
  });
}

function validateResponse(obj, batch, includeTokens) {
  const errors = [];
  if (!obj || !Array.isArray(obj.sentences)) return ['missing sentences array'];
  if (obj.sentences.length !== batch.length) errors.push(`expected ${batch.length} sentences, got ${obj.sentences.length}`);
  obj.sentences.forEach((sentence, sentIndex) => {
    const source = batch[sentIndex];
    if (!source) return;
    if (sentence.text !== source.text) errors.push(`sentence ${sentIndex + 1}: text mismatch`);
    if (!Array.isArray(sentence.chunks) || sentence.chunks.length === 0) {
      errors.push(`sentence ${sentIndex + 1}: missing chunks`);
      return;
    }
    const joined = sentence.chunks.map((c) => c.surface || '').join('');
    if (joined !== source.text) errors.push(`sentence ${sentIndex + 1}: chunks do not join to source text`);
    sentence.chunks.forEach((chunk, chunkIndex) => validateChunk(chunk, includeTokens, errors, sentIndex, chunkIndex));
  });
  return errors;
}

function attachMetadata(batch, parsed) {
  return parsed.sentences.map((annotated, index) => {
    const source = batch[index];
    return {
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
      chunks: annotated.chunks
    };
  });
}

function readDoneIds(jsonlPath) {
  const done = new Set();
  if (!fs.existsSync(jsonlPath)) return done;
  const lines = fs.readFileSync(jsonlPath, 'utf8').split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      if (Array.isArray(row.results)) row.results.forEach((item) => done.add(item.id));
    } catch (_) {
      // Ignore partial final line from interrupted runs.
    }
  }
  return done;
}

function appendJsonl(jsonlPath, row) {
  fs.appendFileSync(jsonlPath, `${JSON.stringify(row)}\n`, 'utf8');
}

async function annotateBatch(args, batch, batchIndex) {
  const includeTokens = !args.noTokens;
  const prompt = buildPrompt(batch, includeTokens);
  let lastError = null;
  for (let attempt = 1; attempt <= args.retries + 1; attempt += 1) {
    try {
      const started = Date.now();
      const response = await callGemini(args, prompt);
      const parsed = JSON.parse(response.text);
      const validationErrors = validateResponse(parsed, batch, includeTokens);
      if (validationErrors.length) throw new Error(validationErrors.slice(0, 5).join('; '));
      return {
        ok: true,
        batch_index: batchIndex,
        attempt,
        ms: Date.now() - started,
        usage: response.usage,
        finish_reason: response.finishReason,
        results: attachMetadata(batch, parsed)
      };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
    }
  }
  return {
    ok: false,
    batch_index: batchIndex,
    ids: batch.map((s) => s.id),
    error: lastError ? lastError.message : 'unknown error'
  };
}

async function annotateBatchWithSplit(args, batch, batchIndex) {
  const row = await annotateBatch(args, batch, batchIndex);
  if (row.ok || batch.length === 1) return [row];
  const midpoint = Math.ceil(batch.length / 2);
  const left = batch.slice(0, midpoint);
  const right = batch.slice(midpoint);
  const leftRows = await annotateBatchWithSplit(args, left, `${batchIndex}a`);
  const rightRows = await annotateBatchWithSplit(args, right, `${batchIndex}b`);
  return leftRows.concat(rightRows);
}

async function runPool(items, concurrency, worker) {
  let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

function writeFinal(outPath, jsonlPath, meta) {
  const results = [];
  const failures = [];
  if (fs.existsSync(jsonlPath)) {
    for (const line of fs.readFileSync(jsonlPath, 'utf8').split(/\r?\n/).filter(Boolean)) {
      const row = JSON.parse(line);
      if (row.ok && Array.isArray(row.results)) results.push(...row.results);
      else failures.push(row);
    }
  }
  results.sort((a, b) => a.source_index - b.source_index);
  fs.writeFileSync(outPath, JSON.stringify({ meta: { ...meta, failures: failures.length }, sentences: results, failures }, null, 2), 'utf8');
  return { count: results.length, failures: failures.length };
}

async function main() {
  const args = parseArgs(process.argv);
  const sentences = loadSentences(args);
  const jsonlPath = `${args.out}.jsonl`;
  const doneIds = readDoneIds(jsonlPath);
  const pending = sentences.filter((s) => !doneIds.has(s.id));
  const batches = chunkArray(pending, args.batchSize);
  const started = Date.now();
  const meta = {
    generated_at: new Date().toISOString(),
    input: path.relative(ROOT, args.input),
    model: args.model,
    batch_size: args.batchSize,
    concurrency: args.concurrency,
    include_tokens: !args.noTokens,
    selected_sentences: sentences.length
  };

  console.log(JSON.stringify({ event: 'start', selected: sentences.length, pending: pending.length, batches: batches.length, out: args.out, jsonl: jsonlPath }));
  if (args.dryRun) return;

  let completed = 0;
  let failed = 0;
  await runPool(batches, args.concurrency, async (batch, batchIndex) => {
    const rows = await annotateBatchWithSplit(args, batch, batchIndex);
    for (const row of rows) {
      appendJsonl(jsonlPath, row);
      if (row.ok) completed += row.results.length;
      else failed += row.ids ? row.ids.length : 0;
    }
    const elapsed = (Date.now() - started) / 1000;
    const processed = completed + failed;
    const rate = processed > 0 ? processed / elapsed : 0;
    const remaining = pending.length - processed;
    const etaSec = rate > 0 ? remaining / rate : null;
    console.log(JSON.stringify({
      event: rows.every((row) => row.ok) ? 'batch_ok' : 'batch_partial',
      batch_index: batchIndex,
      processed,
      pending: pending.length,
      completed,
      failed,
      split_rows: rows.length,
      ms: rows.reduce((sum, row) => sum + (row.ms || 0), 0) || null,
      eta_sec: etaSec == null ? null : Math.round(etaSec)
    }));
  });

  const final = writeFinal(args.out, jsonlPath, meta);
  console.log(JSON.stringify({ event: 'done', ...final, out: args.out, jsonl: jsonlPath }));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
