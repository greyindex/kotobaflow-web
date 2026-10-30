#!/usr/bin/env node
/*
 * Generate candidate Gemini 3.8 Flash TTS audio for textbook body paragraphs.
 *
 * Paragraph boundaries come from canonical lesson body.text. Each paragraph
 * gets an independent request and output file. Paragraphs are checked against
 * the v2 sentence data before any API call. Applications and dialogues are
 * excluded.
 *
 * Usage:
 *   node tools/generate_gemini38_body_audio.cjs --dry-run
 *   node tools/generate_gemini38_body_audio.cjs
 *
 * Set GEMINI_API_KEY (or GOOGLE_API_KEY) in the environment before running.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_SOURCE = 'data/textbook/textbook_text_chunks.v2.json';
const DEFAULT_CANONICAL_DIR = 'data/textbook/canonical_books';
const DEFAULT_SOURCE_MANIFEST =
  'data/qwen_reading_sections_manual_clean132_context_punctpause_v1/manifest.jsonl';
const DEFAULT_OUTPUT = 'data/gemini38_flash_tts_body_v1';
const MODEL = 'gemini-3.8-flash-tts';
const VOICE_NAME = 'Concierge 7';
const STYLE =
  'Warm, steady Japanese narrator with clear standard Tokyo Japanese pronunciation and natural pitch accent. Read at a measured textbook pace, with subtle pauses at punctuation and even volume. Keep the delivery understated and encouraging; do not add words or dramatize.';
const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MAX_REQUESTS = 90;

function parseArgs(argv) {
  const options = {
    dryRun: false,
    limit: null,
    book: null,
    outputDir: DEFAULT_OUTPUT,
    ratePerMinute: 4,
    maxRequestsPerDay: DEFAULT_MAX_REQUESTS,
    waitForDailyReset: false,
    ffmpeg: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = (name) => {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) throw new Error(`${name} requires a value`);
      i += 1;
      return next;
    };
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--limit') options.limit = parsePositiveInt(value(arg), arg);
    else if (arg === '--book') options.book = value(arg);
    else if (arg === '--output-dir') options.outputDir = value(arg);
    else if (arg === '--rate-per-minute') options.ratePerMinute = parsePositiveInt(value(arg), arg);
    else if (arg === '--max-requests-per-day') options.maxRequestsPerDay = parsePositiveInt(value(arg), arg);
    else if (arg === '--wait-for-daily-reset') options.waitForDailyReset = true;
    else if (arg === '--ffmpeg') options.ffmpeg = value(arg);
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.ratePerMinute > 4) throw new Error('--rate-per-minute cannot exceed 4');
  if (options.maxRequestsPerDay > DEFAULT_MAX_REQUESTS) {
    throw new Error(`--max-requests-per-day cannot exceed the safety cap of ${DEFAULT_MAX_REQUESTS}`);
  }
  return options;
}

function parsePositiveInt(raw, name) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
  return n;
}

function help() {
  console.log(
    [
      'Generate textbook body audio as independently replaceable paragraphs.',
      '',
      'Options:',
      '  --dry-run                 Validate the source/coverage without API calls',
      '  --limit N                 Process at most N unfinished paragraphs',
      '  --book ID                 Process one book (for example XinBian1)',
      `  --output-dir PATH         Output directory (default: ${DEFAULT_OUTPUT})`,
      '  --rate-per-minute N       Maximum request starts per minute (1–4, default 4)',
      `  --max-requests-per-day N  Hard cap shared across resumptions (default ${DEFAULT_MAX_REQUESTS})`,
      '  --wait-for-daily-reset    Keep running and resume after each Pacific-midnight quota reset',
      '  --ffmpeg PATH             Explicit ffmpeg executable path',
      '',
      'Requires GEMINI_API_KEY or GOOGLE_API_KEY. Outputs WAV and OGG plus a resumable JSONL manifest.',
    ].join('\n'),
  );
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  const content = fs.readFileSync(file, 'utf8');
  return content
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSONL at ${file}:${index + 1}: ${error.message}`);
      }
    });
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, data);
  fs.renameSync(temp, file);
}

function appendJsonl(file, row) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`, 'utf8');
}

function sectionKey(book, lessonId) {
  return `${book}|${lessonId}`;
}

function paragraphKey(book, lessonId, paragraphNo) {
  return `${book}|${lessonId}|p${String(paragraphNo).padStart(2, '0')}`;
}

function getBodyParagraphs(sourcePath, canonicalDir, referenceManifestPath) {
  const data = readJson(sourcePath);
  if (!Array.isArray(data.sentences)) throw new Error(`${sourcePath} has no sentences array`);
  const grouped = new Map();
  for (const sentence of data.sentences) {
    if (sentence.section !== 'body' || sentence.role !== 'section_text') continue;
    if (typeof sentence.text !== 'string' || !sentence.text.length) {
      throw new Error(`Body sentence ${sentence.id || '(no id)'} has empty/non-string text`);
    }
    const key = sectionKey(sentence.book_id, sentence.lesson_id);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(sentence);
  }

  const v2BodyTexts = new Map();
  for (const [key, sentences] of grouped) {
    sentences.sort((a, b) => Number(a.sentence_index) - Number(b.sentence_index));
    const seen = new Set();
    for (const sentence of sentences) {
      const index = Number(sentence.sentence_index);
      if (!Number.isInteger(index) || seen.has(index)) {
        throw new Error(`${key} has missing or duplicate sentence_index ${sentence.sentence_index}`);
      }
      seen.add(index);
    }
    v2BodyTexts.set(key, sentences.map((sentence) => sentence.text).join(''));
  }

  const references = readJsonl(referenceManifestPath).filter(
    (row) => row.section_key === 'body' && row.status === 'ok',
  );
  const referenceKeys = new Set(references.map((row) => sectionKey(row.book, row.lesson_id)));
  const missing = [...referenceKeys].filter((key) => !v2BodyTexts.has(key));
  const extra = [...v2BodyTexts.keys()].filter((key) => !referenceKeys.has(key));
  if (missing.length || extra.length || referenceKeys.size !== 75) {
    throw new Error(
      `Body coverage mismatch: reference=${referenceKeys.size}, missing=${missing.join(', ') || 'none'}, extra=${extra.join(', ') || 'none'}`,
    );
  }

  const referenceByBook = new Map();
  for (const reference of references) {
    if (!referenceByBook.has(reference.book)) referenceByBook.set(reference.book, new Map());
    referenceByBook.get(reference.book).set(reference.lesson_id, reference);
  }

  const paragraphs = [];
  const canonicalKeys = new Set();
  for (const [book, expectedLessons] of referenceByBook) {
    const bundlePath = path.join(ROOT, canonicalDir, `${book}.bundle.json`);
    const bundle = readJson(bundlePath);
    for (const item of bundle.items || []) {
      const lesson = item.lesson;
      const lessonId = lesson?.item_id;
      if (!expectedLessons.has(lessonId)) continue;
      const key = sectionKey(book, lessonId);
      canonicalKeys.add(key);
      const originalText = lesson.body?.text;
      if (typeof originalText !== 'string' || !originalText.trim()) {
        throw new Error(`${key} is missing canonical lesson.body.text`);
      }
      const parts = originalText
        .trim()
        .split(/\r?\n\s*\r?\n/)
        .map((part) => part.replace(/\r?\n/g, '').trim())
        .filter(Boolean);
      if (!parts.length) throw new Error(`${key} has no paragraph text`);
      if (parts.join('') !== v2BodyTexts.get(key)) {
        throw new Error(
          `${key} paragraph text does not match canonical v2 sentence text; refusing generation`,
        );
      }
      const reference = expectedLessons.get(lessonId);
      for (let index = 0; index < parts.length; index += 1) {
        const text = parts[index];
        paragraphs.push({
          book,
          lesson_id: lessonId,
          lesson_no: reference.lesson_no,
          lesson_label: reference.lesson_label,
          lesson_title: reference.lesson_title,
          section_key: 'body',
          section_label: reference.section_label,
          paragraph_no: index + 1,
          paragraph_count: parts.length,
          text,
          text_sha256: sha256(text),
          text_chars: [...text].length,
        });
      }
    }
  }
  const absent = [...referenceKeys].filter((key) => !canonicalKeys.has(key));
  const unexpected = [...canonicalKeys].filter((key) => !referenceKeys.has(key));
  if (absent.length || unexpected.length || canonicalKeys.size !== 75) {
    throw new Error(
      `Canonical body coverage mismatch: expected 75, found ${canonicalKeys.size}; absent=${absent.join(', ') || 'none'}, unexpected=${unexpected.join(', ') || 'none'}`,
    );
  }
  return paragraphs;
}

function outputPaths(outputRoot, item) {
  const lessonNo = Number.isFinite(Number(item.lesson_no))
    ? String(Number(item.lesson_no)).padStart(2, '0')
    : '00';
  const paragraphNo = String(item.paragraph_no).padStart(2, '0');
  const baseName = `${item.book}_${lessonNo}_body_p${paragraphNo}_reading`;
  const directory = path.join(outputRoot, item.book, item.lesson_id, 'body');
  return {
    wav: path.join(directory, `${baseName}.wav`),
    ogg: path.join(directory, `${baseName}.ogg`),
    meta: path.join(directory, `${baseName}.meta.json`),
  };
}

function pacificQuotaDay(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function pacificParts(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(
    parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  );
}

function millisecondsUntilPacificReset(now = Date.now()) {
  const local = pacificParts(new Date(now));
  const nextLocalMidnight = Date.UTC(
    Number(local.year),
    Number(local.month) - 1,
    Number(local.day) + 1,
    0,
    0,
    30,
  );
  let utcGuess = nextLocalMidnight + 8 * 60 * 60 * 1000;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const atGuess = pacificParts(new Date(utcGuess));
    const localAsUtc = Date.UTC(
      Number(atGuess.year),
      Number(atGuess.month) - 1,
      Number(atGuess.day),
      Number(atGuess.hour),
      Number(atGuess.minute),
      Number(atGuess.second),
    );
    const offsetMs = localAsUtc - utcGuess;
    utcGuess = nextLocalMidnight - offsetMs;
  }
  return Math.max(1000, utcGuess - now);
}

function relative(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

function wavInfo(file) {
  if (!fs.existsSync(file) || fs.statSync(file).size < 44) return null;
  const fd = fs.openSync(file, 'r');
  try {
    const header = Buffer.alloc(44);
    const read = fs.readSync(fd, header, 0, 44, 0);
    if (
      read !== 44 ||
      header.toString('ascii', 0, 4) !== 'RIFF' ||
      header.toString('ascii', 8, 12) !== 'WAVE'
    )
      return null;
    const byteRate = header.readUInt32LE(28);
    const dataSize = header.readUInt32LE(40);
    if (!byteRate || !dataSize) return null;
    return {
      size_bytes: fs.statSync(file).size,
      sample_rate_hz: header.readUInt32LE(24),
      channels: header.readUInt16LE(22),
      duration_sec: Number((dataSize / byteRate).toFixed(3)),
    };
  } finally {
    fs.closeSync(fd);
  }
}

function oggIsValid(file) {
  if (!fs.existsSync(file) || fs.statSync(file).size < 64) return false;
  const fd = fs.openSync(file, 'r');
  try {
    const magic = Buffer.alloc(4);
    return fs.readSync(fd, magic, 0, 4, 0) === 4 && magic.toString('ascii') === 'OggS';
  } finally {
    fs.closeSync(fd);
  }
}

function findExecutable(name) {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const extensions =
    process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = path.join(dir, name.endsWith(ext.toLowerCase()) ? name : `${name}${ext}`);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
  }
  return null;
}

function runProcess(executable, args, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 12000) stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(executable)} exited ${code}: ${stderr.trim().slice(-3000)}`));
    });
  });
}

function appendErrorFromPayload(payload) {
  const message = payload?.error?.message || payload?.message || 'API returned an unspecified error';
  return String(message).replace(/\s+/g, ' ').slice(0, 700);
}

async function readResponseJson(response) {
  const body = await response.text();
  try {
    return JSON.parse(body);
  } catch {
    return { message: body.slice(0, 700) || `HTTP ${response.status}` };
  }
}

function parseRetryAfter(value) {
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return Math.max(0, numeric * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

async function sleep(ms) {
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveVoice(apiKey) {
  const url = new URL(`${API_ROOT}/voices`);
  url.searchParams.set('language_code', 'ja-JP');
  url.searchParams.set('search', VOICE_NAME);
  url.searchParams.set('page_size', '100');
  const response = await fetch(url, {
    headers: { 'x-goog-api-key': apiKey },
    signal: AbortSignal.timeout(30000),
  });
  const payload = await readResponseJson(response);
  if (!response.ok)
    throw new Error(`Voice lookup failed (HTTP ${response.status}): ${appendErrorFromPayload(payload)}`);
  const exact = (payload.voices || []).filter(
    (voice) =>
      String(voice.display_name || '')
        .trim()
        .toLowerCase() === VOICE_NAME.toLowerCase(),
  );
  if (exact.length !== 1 || !exact[0].id) {
    const names = (payload.voices || [])
      .map((voice) => voice.display_name)
      .filter(Boolean)
      .slice(0, 10)
      .join(', ');
    throw new Error(
      `Expected one Japanese voice named "${VOICE_NAME}"; exact matches=${exact.length}. Results: ${names || 'none'}`,
    );
  }
  return exact[0];
}

function extractAudioBase64(payload) {
  if (payload.output_audio?.data) return payload.output_audio.data;
  for (const step of [...(payload.steps || [])].reverse()) {
    for (const content of [...(step.content || [])].reverse()) {
      if (content.type === 'audio' && content.data) return content.data;
    }
  }
  return null;
}

function makeError(status, payload) {
  const error = new Error(`Gemini API HTTP ${status}: ${appendErrorFromPayload(payload)}`);
  error.status = status;
  return error;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return help();

  const sourcePath = path.join(ROOT, DEFAULT_SOURCE);
  const canonicalDir = DEFAULT_CANONICAL_DIR;
  const referenceManifestPath = path.join(ROOT, DEFAULT_SOURCE_MANIFEST);
  const outputRoot = path.resolve(ROOT, options.outputDir);
  const rows = getBodyParagraphs(sourcePath, canonicalDir, referenceManifestPath).filter(
    (row) => !options.book || row.book === options.book,
  );
  if (!rows.length) throw new Error(`No body sections matched --book ${options.book}`);

  const manifestPath = path.join(outputRoot, 'manifest.jsonl');
  const requestLedgerPath = path.join(outputRoot, 'request_ledger.jsonl');
  const existingLog = readJsonl(manifestPath);
  const lastSuccess = new Map();
  for (const row of existingLog) {
    if (row.status === 'ok' && row.paragraph_no) {
      lastSuccess.set(paragraphKey(row.book, row.lesson_id, row.paragraph_no), row);
    }
  }

  const completed = new Set();
  const pending = [];
  for (const row of rows) {
    const paths = outputPaths(outputRoot, row);
    const key = paragraphKey(row.book, row.lesson_id, row.paragraph_no);
    const prior = lastSuccess.get(key);
    const info = wavInfo(paths.wav);
    const hasBothArtifacts = Boolean(info && oggIsValid(paths.ogg));
    let sidecarMatches = false;
    if (hasBothArtifacts && fs.existsSync(paths.meta)) {
      try {
        const meta = readJson(paths.meta);
        sidecarMatches =
          meta.text_sha256 === row.text_sha256 && meta.model === MODEL && meta.voice_name === VOICE_NAME;
      } catch {
        sidecarMatches = false;
      }
    }
    if (prior?.text_sha256 === row.text_sha256 && prior?.output && hasBothArtifacts) {
      completed.add(key);
      continue;
    }
    if (sidecarMatches) {
      const recovered = {
        status: 'ok',
        recovered_after_restart: true,
        ...row,
        model: MODEL,
        voice_name: VOICE_NAME,
        output: relative(paths.wav),
        output_ogg: relative(paths.ogg),
        duration_sec: info.duration_sec,
        wav_bytes: info.size_bytes,
        generated_at: readJson(paths.meta).generated_at,
      };
      appendJsonl(manifestPath, recovered);
      completed.add(key);
      continue;
    }
    pending.push({ ...row, paths });
  }

  const work = options.limit == null ? pending : pending.slice(0, options.limit);
  const totalChars = rows.reduce((sum, row) => sum + row.text_chars, 0);
  const lessonCount = new Set(rows.map((row) => sectionKey(row.book, row.lesson_id))).size;
  console.log(`Model: ${MODEL}; voice: ${VOICE_NAME}; lessons: ${lessonCount}; paragraphs: ${rows.length}`);
  console.log(
    `Canonical paragraphs verified against: ${path.relative(ROOT, sourcePath)}; ${totalChars.toLocaleString()} Japanese characters`,
  );
  console.log(
    `Already complete: ${completed.size}; remaining paragraphs: ${pending.length}; selected this run: ${work.length}`,
  );
  console.log(
    `Output: ${path.relative(ROOT, outputRoot)}; max rate: ${options.ratePerMinute}/minute; daily request cap: ${options.maxRequestsPerDay}`,
  );
  if (options.dryRun) {
    const max = [...rows].sort((a, b) => b.text_chars - a.text_chars)[0];
    console.log(
      `Dry run passed. Longest paragraph: ${max.book}/${max.lesson_id}/p${String(max.paragraph_no).padStart(2, '0')} (${max.text_chars} chars).`,
    );
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('Set GEMINI_API_KEY or GOOGLE_API_KEY in this process environment.');
  if (typeof fetch !== 'function' || typeof AbortSignal.timeout !== 'function') {
    throw new Error('Node.js with built-in fetch and AbortSignal.timeout is required (Node 18+).');
  }
  const ffmpeg = options.ffmpeg || findExecutable('ffmpeg');
  if (!ffmpeg || !fs.existsSync(ffmpeg))
    throw new Error('ffmpeg not found; add it to PATH or pass --ffmpeg PATH.');

  const voice = await resolveVoice(apiKey);
  console.log(
    `Resolved voice: ${voice.display_name} (${voice.id}); language ${voice.language_code || 'unspecified'}`,
  );

  const minSpacingMs = Math.ceil(60000 / options.ratePerMinute) + 500;
  let lastPostStartedAt = 0;
  let postCount = 0;
  const dailyCounts = new Map();
  for (const entry of readJsonl(requestLedgerPath)) {
    if (entry.quota_day_pt)
      dailyCounts.set(entry.quota_day_pt, (dailyCounts.get(entry.quota_day_pt) || 0) + 1);
  }
  let activeQuotaDay = pacificQuotaDay();
  let generated = 0;
  let failed = 0;
  let quotaStop = false;

  async function postWithRetries(body, item) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      activeQuotaDay = pacificQuotaDay();
      const dailyCount = dailyCounts.get(activeQuotaDay) || 0;
      if (dailyCount >= options.maxRequestsPerDay) {
        quotaStop = true;
        throw new Error(
          `Daily safety cap reached (${options.maxRequestsPerDay} TTS POSTs for ${activeQuotaDay} Pacific time); stopping before the next request.`,
        );
      }
      const waitForSlot = Math.max(0, lastPostStartedAt + minSpacingMs - Date.now());
      if (waitForSlot) await sleep(waitForSlot);
      lastPostStartedAt = Date.now();
      postCount += 1;
      dailyCounts.set(activeQuotaDay, dailyCount + 1);
      appendJsonl(requestLedgerPath, {
        quota_day_pt: activeQuotaDay,
        started_at: new Date(lastPostStartedAt).toISOString(),
        run_pid: process.pid,
        book: item.book,
        lesson_id: item.lesson_id,
        paragraph_no: item.paragraph_no,
      });
      console.log(
        `[TTS ${dailyCount + 1}/${options.maxRequestsPerDay} PT today; run ${postCount}] ${item.book} ${item.lesson_id} p${String(item.paragraph_no).padStart(2, '0')} (${item.text_chars} chars)`,
      );
      let response;
      try {
        response = await fetch(`${API_ROOT}/interactions`, {
          method: 'POST',
          headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(180000),
        });
      } catch (error) {
        lastError = error;
        if (attempt >= 2) break;
        console.warn(`  Network error; retrying after ${Math.max(15500, (attempt + 1) * 15000)} ms.`);
        await sleep(Math.max(15500, (attempt + 1) * 15000));
        continue;
      }
      if (response.ok) {
        const payload = await readResponseJson(response);
        const audioBase64 = extractAudioBase64(payload);
        if (!audioBase64)
          throw new Error(
            `Gemini response for ${item.lesson_id} p${item.paragraph_no} had no audio payload.`,
          );
        return {
          audio: Buffer.from(audioBase64, 'base64'),
          interactionId: payload.id || payload.interaction?.id || null,
        };
      }

      const payload = await readResponseJson(response);
      lastError = makeError(response.status, payload);
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= 2) break;
      const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
      const backoffMs =
        retryAfter == null ? Math.min(90000, 20000 * (attempt + 1)) : Math.max(retryAfter, 15500);
      console.warn(`  HTTP ${response.status}; retrying after ${Math.ceil(backoffMs / 1000)} s.`);
      await sleep(backoffMs);
    }
    throw lastError || new Error('TTS request failed after retries.');
  }

  outer: for (const item of work) {
    let itemComplete = false;
    while (!itemComplete) {
      activeQuotaDay = pacificQuotaDay();
      const dailyCount = dailyCounts.get(activeQuotaDay) || 0;
      if (dailyCount >= options.maxRequestsPerDay) {
        if (!options.waitForDailyReset) {
          quotaStop = true;
          console.log(
            `Daily safety cap reached (${options.maxRequestsPerDay} TTS POSTs for ${activeQuotaDay} Pacific time); stopping before the next request.`,
          );
          break outer;
        }
        const delayMs = millisecondsUntilPacificReset();
        console.log(
          `Daily safety cap reached for ${activeQuotaDay} Pacific time; waiting about ${Math.ceil(delayMs / 60000)} minutes for reset.`,
        );
        await sleep(delayMs + 1000);
        continue;
      }

      try {
        const interaction = await postWithRetries(
          {
            model: MODEL,
            input: [
              {
                type: 'user_input',
                content: [
                  {
                    type: 'text',
                    text: item.text,
                    annotations: [{ type: 'speech_metadata', style: STYLE }],
                  },
                ],
              },
            ],
            response_format: { type: 'audio' },
            generation_config: { speech_config: [{ voice: voice.id }] },
          },
          item,
        );

        if (
          interaction.audio.length < 44 ||
          interaction.audio.toString('ascii', 0, 4) !== 'RIFF' ||
          interaction.audio.toString('ascii', 8, 12) !== 'WAVE'
        ) {
          throw new Error(
            `Gemini returned an invalid WAV payload for ${item.lesson_id} p${item.paragraph_no}.`,
          );
        }
        const wavTemp = `${item.paths.wav}.${process.pid}.part.wav`;
        const oggTemp = `${item.paths.ogg}.${process.pid}.part.ogg`;
        fs.mkdirSync(path.dirname(item.paths.wav), { recursive: true });
        fs.writeFileSync(wavTemp, interaction.audio);
        await runProcess(ffmpeg, [
          '-y',
          '-hide_banner',
          '-loglevel',
          'error',
          '-i',
          wavTemp,
          '-map_metadata',
          '-1',
          '-vn',
          '-ac',
          '1',
          '-ar',
          '24000',
          '-c:a',
          'libopus',
          '-b:a',
          '20k',
          '-vbr',
          'on',
          '-compression_level',
          '10',
          '-application',
          'voip',
          '-frame_duration',
          '60',
          oggTemp,
        ]);
        if (!oggIsValid(oggTemp))
          throw new Error(`ffmpeg produced an invalid OGG for ${item.lesson_id} p${item.paragraph_no}.`);
        fs.renameSync(wavTemp, item.paths.wav);
        fs.renameSync(oggTemp, item.paths.ogg);

        const info = wavInfo(item.paths.wav);
        if (!info)
          throw new Error(`Generated WAV failed validation for ${item.lesson_id} p${item.paragraph_no}.`);
        const generatedAt = new Date().toISOString();
        const meta = {
          model: MODEL,
          voice_name: VOICE_NAME,
          voice_id: voice.id,
          style: STYLE,
          text_sha256: item.text_sha256,
          interaction_id: interaction.interactionId,
          generated_at: generatedAt,
        };
        atomicWrite(item.paths.meta, `${JSON.stringify(meta, null, 2)}\n`);
        const entry = {
          status: 'ok',
          ...item,
          paths: undefined,
          model: MODEL,
          voice_name: VOICE_NAME,
          voice_id: voice.id,
          style: STYLE,
          interaction_id: interaction.interactionId,
          output: relative(item.paths.wav),
          output_ogg: relative(item.paths.ogg),
          duration_sec: info.duration_sec,
          sample_rate_hz: info.sample_rate_hz,
          channels: info.channels,
          wav_bytes: info.size_bytes,
          generated_at: generatedAt,
        };
        appendJsonl(manifestPath, entry);
        generated += 1;
        console.log(
          `  Saved p${String(item.paragraph_no).padStart(2, '0')}: ${info.duration_sec.toFixed(1)} sec WAV + OGG.`,
        );
        try {
          fs.unlinkSync(wavTemp);
        } catch {}
        try {
          fs.unlinkSync(oggTemp);
        } catch {}
        itemComplete = true;
      } catch (error) {
        if (quotaStop) {
          if (options.waitForDailyReset) {
            quotaStop = false;
            continue;
          }
          console.log(error.message);
          break outer;
        }
        failed += 1;
        console.error(`  FAILED ${item.book} ${item.lesson_id} p${item.paragraph_no}: ${error.message}`);
        appendJsonl(manifestPath, {
          status: 'error',
          book: item.book,
          lesson_id: item.lesson_id,
          section_key: 'body',
          paragraph_no: item.paragraph_no,
          text_sha256: item.text_sha256,
          text_chars: item.text_chars,
          request_attempts_used: postCount,
          error: error.message,
          failed_at: new Date().toISOString(),
        });
        itemComplete = true;
      }
    }
  }

  const successKeys = new Set(
    readJsonl(manifestPath)
      .filter((row) => row.status === 'ok')
      .map((row) => paragraphKey(row.book, row.lesson_id, row.paragraph_no)),
  );
  const stillMissing = rows.filter(
    (row) => !successKeys.has(paragraphKey(row.book, row.lesson_id, row.paragraph_no)),
  );
  activeQuotaDay = pacificQuotaDay();
  const summary = {
    model: MODEL,
    voice_name: VOICE_NAME,
    output_dir: relative(outputRoot),
    total_body_sections: lessonCount,
    total_body_paragraphs: rows.length,
    complete: rows.length - stillMissing.length,
    missing: stillMissing.map(({ book, lesson_id, paragraph_no }) => ({ book, lesson_id, paragraph_no })),
    generated_this_run: generated,
    failed_this_run: failed,
    tts_post_attempts_this_run: postCount,
    tts_post_attempts_this_quota_day: dailyCounts.get(activeQuotaDay) || 0,
    quota_day_time_zone: 'America/Los_Angeles',
    max_tts_post_attempts_per_quota_day: options.maxRequestsPerDay,
    request_spacing_ms: minSpacingMs,
    estimated_total_text_chars: totalChars,
    updated_at: new Date().toISOString(),
  };
  atomicWrite(path.join(outputRoot, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(
    `Finished: generated=${generated}, failed=${failed}, TTS POST attempts=${postCount}, complete=${summary.complete}/${rows.length}.`,
  );
  if (stillMissing.length) {
    console.log(
      `Remaining paragraphs can be resumed by rerunning the same command after the daily quota reset (${stillMissing.length} pending).`,
    );
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
