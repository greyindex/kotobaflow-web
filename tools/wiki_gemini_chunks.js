#!/usr/bin/env node
/*
 * Gemini chunk annotation pipeline for wiki extension readings.
 *
 * Required:
 *   GEMINI_API_KEY
 *
 * Example:
 *   node tools/wiki_gemini_chunks.js --batch-size 10 --concurrency 4
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_INPUT = path.join(ROOT, 'data', 'wiki', 'processed', 'textbook_wiki_reading_candidates.v1.json');
const DEFAULT_OUT = path.join(ROOT, 'data', 'wiki', 'processed', 'textbook_wiki_reading_chunks.v1.json');
const DEFAULT_MODEL = 'gemini-3-flash-preview';
const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';

const ROLE_SET = new Set([
  '主题', '主语', '宾语', '时间', '地点', '方向', '起点', '终点', '对象', '方式',
  '原因', '目的', '副词', '连接', '修饰', '谓语', '说明/判断', '转折', '疑问',
  '引用/内容', '标点', '范围', '其他',
]);

const CHUNK_COLOR_SET = new Set([
  'topic', 'subject', 'object', 'time', 'place', 'direction', 'adverb',
  'connector', 'modifier', 'predicate', 'quote', 'punctuation', 'other',
]);

const PUNCT_RE = /[、。「」『』？！.!?]/;

function parseArgs(argv) {
  const args = {
    input: DEFAULT_INPUT,
    out: DEFAULT_OUT,
    model: DEFAULT_MODEL,
    batchSize: 10,
    concurrency: 4,
    retries: 3,
    requestTimeoutMs: 90000,
    limit: 0,
    offset: 0,
    dryRun: false,
    splitPendingSentences: false,
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
    else if (arg === '--request-timeout-ms') args.requestTimeoutMs = Number(next());
    else if (arg === '--split-pending-sentences') args.splitPendingSentences = true;
    else if (arg === '--limit') args.limit = Number(next());
    else if (arg === '--offset') args.offset = Number(next());
    else if (arg === '--dry-run') args.dryRun = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isFinite(args.batchSize) || args.batchSize < 1) throw new Error('--batch-size must be >= 1');
  if (!Number.isFinite(args.concurrency) || args.concurrency < 1) throw new Error('--concurrency must be >= 1');
  return args;
}

function splitSentences(text) {
  const sentences = [];
  const paragraphs = String(text || '').split(/\n+/).map((p) => p.trim()).filter(Boolean);
  for (const paragraph of paragraphs) {
    let start = 0;
    for (let i = 0; i < paragraph.length; i += 1) {
      if ('。！？.!?'.includes(paragraph[i])) {
        const sentence = paragraph.slice(start, i + 1).trim();
        if (sentence) sentences.push(sentence);
        start = i + 1;
      }
    }
    const rest = paragraph.slice(start).trim();
    if (rest) sentences.push(rest);
  }
  return sentences;
}

function loadSources(args) {
  const data = JSON.parse(fs.readFileSync(args.input, 'utf8'));
  const flat = [];
  for (const reading of data.readings || []) {
    const textSentences = splitSentences(reading.readingText);
    textSentences.forEach((text, sentenceIndex) => {
      flat.push({
        id: `${reading.bookId}::${reading.lessonId}::wiki::${sentenceIndex}`,
        book_id: reading.bookId,
        lesson_id: reading.lessonId,
        lesson_title: reading.lessonTitle,
        wiki_pageid: reading.wiki.pageid,
        wiki_title: reading.wiki.title,
        wiki_url: reading.wiki.url,
        sentence_index: sentenceIndex,
        text,
      });
    });
  }
  let sentences = flat.map((sentence, sourceIndex) => ({ ...sentence, source_index: sourceIndex }));
  if (args.offset) sentences = sentences.slice(args.offset);
  if (args.limit) sentences = sentences.slice(0, args.limit);
  return { input: data, sentences, allSentenceCount: flat.length };
}

function chunkArray(items, size) {
  const batches = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

function buildPrompt(batch) {
  return `你是日语百科拓展阅读的语法成分词块标注器。只输出严格 JSON。

目标：生成适合前端高亮的日语成分词块。外层 chunks 用于主高亮，不要输出 tokens。

强制规则：
1. chunks.surface 按顺序直接拼接必须完全等于 text，包括空格和标点。
2. surface 必须逐字复制原文中的连续片段，不能改字、漏字、加字。
3. 句读和引号必须独立成为 chunk：、 。 「 」 『 』 ？ ！ . ! ?。括号内读音如 五十音(ごじゅうおん) 可以保留在同一个词块里。
4. 非标点 chunk 的 surface 绝对不能包含任何标点。
5. 标点 chunk: role_zh=标点, color_key=punctuation。
6. chunk 必须有 surface, display, meaning_zh, role_zh, grammar_zh, color_key。
7. meaning_zh 是词块意思，简短，不要整句翻译。
8. grammar_zh 是简单语法/作用说明，如 は提示主题、を标记宾语、で表动作地点/手段、に表时间/对象/到达点。
9. role_zh 只能用：主题、主语、宾语、时间、地点、方向、起点、终点、对象、方式、原因、目的、副词、连接、修饰、谓语、说明/判断、转折、疑问、引用/内容、标点、其他。
10. color_key 只能用：topic, subject, object, time, place, direction, adverb, connector, modifier, predicate, quote, punctuation, other。

切块规则：
- 外层按语法成分切，不按最小单词切。
- 名词短语 + は/が/を/に/で/へ/から/まで/より/も 通常合成一块。
- の 连接的名词短语尽量合到后续核心名词和格助词，例如 日本語の学習を。
- 副词通常单独成块，例如 一般に、特に、また、しかし、さらに。
- 谓语表达合成一块，例如 行われている、分類される、用いられる、重要である。
- 引用/判断结构：Xと 思う/考える/感じる 时切成 X | と思う/と考える/と感じる，不要切成 Xと | 思う。
- 但 Xと言う/と書く/と呼ぶ/と述べる 可保持 と言う 等谓语块，不强行改成思考结构。
- XというN 优先切成 X | という | N+助词。
- 长块超过 22 个日文字符时优先按助词、という、谓语边界拆开。

示例：
日本語は、主語・修飾語・述語の語順で構成される。
=> 日本語は | 、 | 主語・修飾語・述語の語順で | 構成される | 。

これは重要だと思われる。
=> これは | 重要だ | と思われる | 。

待处理句子：
${batch.map((s, i) => `${i + 1}. ${s.text}`).join('\n')}

JSON格式：{"sentences":[{"text":"原句","chunks":[{"surface":"...","display":"...","meaning_zh":"...","role_zh":"...","grammar_zh":"...","color_key":"..."}]}]}`;
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
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
  const url = `${API_ROOT}/models/${args.model}:generateContent?key=${encodeURIComponent(key)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.requestTimeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  const api = await res.json();
  if (!res.ok || api.error) {
    const message = api.error ? `${api.error.status || api.error.code}: ${api.error.message}` : `HTTP ${res.status}`;
    throw new Error(message);
  }
  const text = api.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  if (!text) throw new Error('Gemini returned empty text');
  return { text, usage: api.usageMetadata || null, finishReason: api.candidates?.[0]?.finishReason || '' };
}

function validateChunk(chunk, errors, sentIndex, chunkIndex) {
  const prefix = `sentence ${sentIndex + 1} chunk ${chunkIndex + 1}`;
  for (const key of ['surface', 'display', 'meaning_zh', 'role_zh', 'grammar_zh', 'color_key']) {
    if (typeof chunk[key] !== 'string' || chunk[key].length === 0) errors.push(`${prefix}: missing ${key}`);
  }
  if (chunk.role_zh && !ROLE_SET.has(chunk.role_zh)) errors.push(`${prefix}: bad role_zh ${chunk.role_zh}`);
  if (chunk.color_key && !CHUNK_COLOR_SET.has(chunk.color_key)) errors.push(`${prefix}: bad color_key ${chunk.color_key}`);
  if (chunk.role_zh === '标点' && chunk.color_key !== 'punctuation') errors.push(`${prefix}: punctuation chunk has non-punctuation color`);
}

function validateResponse(obj, batch) {
  const errors = [];
  if (!obj || !Array.isArray(obj.sentences)) return ['missing sentences array'];
  if (obj.sentences.length !== batch.length) errors.push(`expected ${batch.length} sentences, got ${obj.sentences.length}`);
  obj.sentences.forEach((sentence, sentIndex) => {
    const source = batch[sentIndex];
    if (!source) return;
    if (!Array.isArray(sentence.chunks) || sentence.chunks.length === 0) {
      errors.push(`sentence ${sentIndex + 1}: missing chunks`);
      return;
    }
    const joined = sentence.chunks.map((c) => c.surface || '').join('');
    if (joined !== source.text) errors.push(`sentence ${sentIndex + 1}: chunks do not join to source text`);
    sentence.chunks.forEach((chunk, chunkIndex) => validateChunk(chunk, errors, sentIndex, chunkIndex));
  });
  return errors;
}

function attachMetadata(batch, parsed) {
  return parsed.sentences.map((annotated, index) => {
    const source = batch[index];
    return {
      ...source,
      chunks: annotated.chunks,
    };
  });
}

async function processBatch(args, batch, batchIndex) {
  const prompt = buildPrompt(batch);
  if (args.dryRun) return { ok: true, batch_index: batchIndex, dry_run: true, prompt };
  let lastError = null;
  for (let attempt = 1; attempt <= args.retries + 1; attempt += 1) {
    const start = Date.now();
    try {
      const response = await callGemini(args, prompt);
      const parsed = JSON.parse(response.text);
      const errors = validateResponse(parsed, batch);
      if (errors.length) throw new Error(errors.slice(0, 8).join('; '));
      return {
        ok: true,
        batch_index: batchIndex,
        attempt,
        ms: Date.now() - start,
        usage: response.usage,
        finish_reason: response.finishReason,
        results: attachMetadata(batch, parsed),
      };
    } catch (error) {
      lastError = error;
      if (attempt <= args.retries) {
        const isCapacityError = /UNAVAILABLE|RESOURCE_EXHAUSTED|429|503|high demand/i.test(error.message || '');
        const wait = isCapacityError ? Math.min(60000, 10000 * attempt) : 1500 * attempt;
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
  }
  return {
    ok: false,
    batch_index: batchIndex,
    error: lastError ? lastError.message : 'unknown error',
    results: batch.map((sentence) => ({ ...sentence, chunks: null, fallback: true })),
  };
}

async function processBatchBySentence(args, batch, batchIndex) {
  const results = [];
  const errors = [];
  let totalMs = 0;
  const usages = [];

  for (let i = 0; i < batch.length; i += 1) {
    const result = await processBatch(args, [batch[i]], `${batchIndex}.${i}`);
    if (result.ok && result.results?.[0]) {
      results.push(result.results[0]);
      totalMs += result.ms || 0;
      if (result.usage) usages.push(result.usage);
    } else {
      errors.push(`sentence ${i}: ${result.error || 'unknown error'}`);
      results.push({ ...batch[i], chunks: null, fallback: true, error: result.error || 'unknown error' });
    }
  }

  return {
    ok: errors.length === 0,
    batch_index: batchIndex,
    split_pending_sentences: true,
    ms: totalMs,
    usage: usages.length ? usages : null,
    error: errors.join('; '),
    results,
  };
}

async function runPool(args, batches, onResult) {
  let next = 0;
  async function worker(workerIndex) {
    while (next < batches.length) {
      const batchIndex = next;
      next += 1;
      const result = args.splitPendingSentences
        ? await processBatchBySentence(args, batches[batchIndex], batchIndex)
        : await processBatch(args, batches[batchIndex], batchIndex);
      await onResult(result, workerIndex);
    }
  }
  await Promise.all(Array.from({ length: Math.min(args.concurrency, batches.length) }, (_, i) => worker(i)));
}

function readJsonlResults(jsonlPath) {
  if (!fs.existsSync(jsonlPath)) return new Map();
  const map = new Map();
  const lines = fs.readFileSync(jsonlPath, 'utf8').split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const result = JSON.parse(line);
    map.set(result.batch_index, result);
  }
  return map;
}

function buildOutput(input, allResults, args, allSentenceCount) {
  const byReading = new Map();
  for (const reading of input.readings || []) {
    byReading.set(`${reading.bookId}:${reading.lessonId}`, {
      bookId: reading.bookId,
      lessonId: reading.lessonId,
      lessonTitle: reading.lessonTitle,
      targetCandidates: reading.targetCandidates,
      wiki: reading.wiki,
      sourceCharCount: reading.sourceCharCount,
      readingCharCount: reading.readingCharCount,
      selectedSections: reading.selectedSections,
      readingText: reading.readingText,
      sentences: [],
    });
  }
  const sentences = allResults.flatMap((result) => result.results || []).sort((a, b) => a.source_index - b.source_index);
  for (const sentence of sentences) {
    const key = `${sentence.book_id}:${sentence.lesson_id}`;
    const reading = byReading.get(key);
    if (!reading) continue;
    reading.sentences.push({
      id: sentence.id,
      sentence_index: sentence.sentence_index,
      text: sentence.text,
      chunks: sentence.chunks,
      fallback: sentence.fallback || false,
    });
  }
  return {
    version: 1,
    kind: 'textbook_wiki_reading_chunks',
    model: args.model,
    generatedAt: new Date().toISOString(),
    sourceFile: path.relative(ROOT, args.input).replace(/\\/g, '/'),
    meta: {
      allSentenceCount,
      processedSentenceCount: sentences.length,
      batchSize: args.batchSize,
      concurrency: args.concurrency,
      failedBatchCount: allResults.filter((r) => !r.ok).length,
    },
    readings: Array.from(byReading.values()),
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const { input, sentences, allSentenceCount } = loadSources(args);
  const batches = chunkArray(sentences, args.batchSize);
  console.log(JSON.stringify({
    input: args.input,
    out: args.out,
    model: args.model,
    sentences: sentences.length,
    allSentenceCount,
    batches: batches.length,
    batchSize: args.batchSize,
    concurrency: args.concurrency,
    dryRun: args.dryRun,
    splitPendingSentences: args.splitPendingSentences,
  }, null, 2));

  if (args.dryRun) {
    const result = await processBatch(args, batches[0] || [], 0);
    console.log(result.prompt);
    return;
  }

  const jsonlPath = `${args.out}.jsonl`;
  const existing = readJsonlResults(jsonlPath);
  const pending = batches
    .map((batch, index) => ({ batch, index }))
    .filter(({ index }) => !existing.has(index) || !existing.get(index).ok);
  const append = fs.createWriteStream(jsonlPath, { flags: 'a', encoding: 'utf8' });

  let completed = existing.size;
  const started = Date.now();
  await runPool(args, pending.map((x) => x.batch), async (result, workerIndex) => {
    result.batch_index = pending[result.batch_index].index;
    append.write(`${JSON.stringify(result)}\n`);
    completed += 1;
    const ok = result.ok ? 'ok' : 'fail';
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`[${ok}] worker=${workerIndex} batch=${result.batch_index} completed=${completed}/${batches.length} elapsed=${elapsed}s`);
  });
  await new Promise((resolve) => append.end(resolve));

  const finalResults = Array.from(readJsonlResults(jsonlPath).values()).sort((a, b) => a.batch_index - b.batch_index);
  const output = buildOutput(input, finalResults, args, allSentenceCount);
  fs.writeFileSync(args.out, JSON.stringify(output, null, 2), 'utf8');
  console.log(JSON.stringify(output.meta, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
