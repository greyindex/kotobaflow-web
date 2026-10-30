#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INPUT = path.join(ROOT, 'data', 'wiki', 'processed', 'textbook_wiki_reading_chunks.v1.json');
const MODEL = 'gemini-3-flash-preview';
const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';

function parseArgs(argv) {
  const args = { input: INPUT, out: '', concurrency: 3, retries: 5, timeoutMs: 90000 };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--input') args.input = path.resolve(next());
    else if (arg === '--out') args.out = path.resolve(next());
    else if (arg === '--concurrency') args.concurrency = Number(next());
    else if (arg === '--retries') args.retries = Number(next());
    else if (arg === '--timeout-ms') args.timeoutMs = Number(next());
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.out) args.out = args.input;
  return args;
}

function buildPrompt(text) {
  return `你是日语拓展阅读的语法词块标注器。只输出严格 JSON。

规则：
1. chunks.surface 按顺序拼接必须完全等于 text。
2. 不要改字、漏字、加字。
3. 句读和引号尽量独立成块：、 。 「 」 『 』 ？ ！ . ! ?
4. role_zh 只能用：主题、主语、宾语、时间、地点、方向、起点、终点、对象、方式、原因、目的、副词、连接、修饰、谓语、说明/判断、转折、疑问、引用/内容、标点、范围、其他。
5. color_key 只能用：topic, subject, object, time, place, direction, adverb, connector, modifier, predicate, quote, punctuation, other。
6. 读音括号、英文缩写、数字、脚注残留可以并入相邻词块，优先保证 surface 拼接完全一致。

text:
${text}

JSON格式：{"text":"原句","chunks":[{"surface":"...","display":"...","meaning_zh":"...","role_zh":"...","grammar_zh":"...","color_key":"..."}]}`;
}

async function callGemini(args, text) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set');
  const body = {
    contents: [{ role: 'user', parts: [{ text: buildPrompt(text) }] }],
    generationConfig: {
      temperature: 0,
      topP: 0.1,
      maxOutputTokens: 6000,
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs);
  try {
    const res = await fetch(`${API_ROOT}/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const api = await res.json();
    if (!res.ok || api.error) {
      const message = api.error ? `${api.error.status || api.error.code}: ${api.error.message}` : `HTTP ${res.status}`;
      throw new Error(message);
    }
    const output = api.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    const parsed = JSON.parse(output);
    const chunks = parsed.chunks;
    if (!Array.isArray(chunks) || !chunks.length) throw new Error('missing chunks');
    const joined = chunks.map((chunk) => chunk.surface || '').join('');
    if (joined !== text) throw new Error('chunks do not join to source text');
    return chunks;
  } finally {
    clearTimeout(timeout);
  }
}

async function retryGemini(args, text) {
  let lastError = null;
  for (let attempt = 1; attempt <= args.retries + 1; attempt += 1) {
    try {
      return await callGemini(args, text);
    } catch (error) {
      lastError = error;
      if (attempt <= args.retries) {
        const capacity = /UNAVAILABLE|RESOURCE_EXHAUSTED|429|503|high demand/i.test(error.message || '');
        await new Promise((resolve) => setTimeout(resolve, capacity ? Math.min(60000, 8000 * attempt) : 1200 * attempt));
      }
    }
  }
  throw lastError;
}

function findFallbacks(data) {
  const items = [];
  for (const reading of data.readings || []) {
    for (const sentence of reading.sentences || []) {
      if (sentence.fallback || (sentence.chunks || []).some((chunk) => chunk.fallback_chunk)) {
        items.push({ reading, sentence });
      }
    }
  }
  return items;
}

async function runPool(args, items) {
  let next = 0;
  let ok = 0;
  let fail = 0;
  const failures = [];

  async function worker(workerIndex) {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      try {
        const chunks = await retryGemini(args, item.sentence.text);
        item.sentence.chunks = chunks.map((chunk) => ({ ...chunk, rerun_from_fallback: true }));
        item.sentence.fallback = false;
        delete item.sentence.error;
        ok += 1;
        console.log(`[ok] worker=${workerIndex} ${ok + fail}/${items.length} ${item.reading.bookId}:${item.reading.lessonId}#${item.sentence.sentence_index}`);
      } catch (error) {
        fail += 1;
        failures.push({
          id: item.sentence.id,
          text: item.sentence.text,
          error: error.message,
        });
        console.log(`[fail] worker=${workerIndex} ${ok + fail}/${items.length} ${item.reading.bookId}:${item.reading.lessonId}#${item.sentence.sentence_index}: ${error.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(args.concurrency, items.length) }, (_, i) => worker(i)));
  return { ok, fail, failures };
}

async function main() {
  const args = parseArgs(process.argv);
  const data = JSON.parse(fs.readFileSync(args.input, 'utf8'));
  const items = findFallbacks(data);
  console.log(JSON.stringify({ fallbackSentences: items.length, concurrency: args.concurrency }, null, 2));
  const result = await runPool(args, items);
  data.meta = {
    ...(data.meta || {}),
    fallback_rerun: {
      attempted: items.length,
      ok: result.ok,
      fail: result.fail,
      at: new Date().toISOString(),
      failures: result.failures.slice(0, 100),
    },
  };
  fs.writeFileSync(args.out, JSON.stringify(data, null, 2), 'utf8');
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
