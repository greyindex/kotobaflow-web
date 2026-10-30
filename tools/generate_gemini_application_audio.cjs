#!/usr/bin/env node
/*
 * Generate candidate TTS audio for every paragraph in the textbook application
 * readings. Paragraphs come from canonical application.text and are checked
 * against the v2 sentence source before any API request.
 *
 * Each article is assigned to one model/voice for its entire duration. A
 * first-fit-decreasing allocator packs complete articles into the remaining
 * per-model quotas for the current Pacific quota day. Requests are
 * serialized at no more than four starts per minute across all models.
 *
 * Usage:
 *   node tools/generate_gemini_application_audio.cjs --dry-run
 *   node tools/generate_gemini_application_audio.cjs
 *
 * Set GEMINI_API_KEY in the process environment before a live run.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'data/textbook/textbook_text_chunks.v2.json');
const CANONICAL_DIR = path.join(ROOT, 'data/textbook/canonical_books');
const REFERENCE_MANIFEST = path.join(
  ROOT,
  'data/qwen_reading_sections_manual_clean132_context_punctpause_v1/manifest.jsonl',
);
const DEFAULT_OUTPUT = 'data/gemini38_flash_tts_application_candidate_v1';
const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';
const QUOTA_DAY_PT = pacificQuotaDay();
const RATE_PER_MINUTE = 4;
const MIN_SPACING_MS = 15500;
const STYLE =
  'Warm, steady Japanese narrator with clear standard Tokyo Japanese pronunciation and natural pitch accent. Read at a measured textbook pace, with subtle pauses at punctuation and even volume. Keep the delivery understated and encouraging; do not add words or dramatize.';
const LEGACY_PROMPT =
  'Read the following Japanese passage aloud exactly as written. Use a warm, steady textbook narrator, clear standard Tokyo Japanese pronunciation, measured pace, and natural pauses at punctuation.\n';
const LOCAL_PAUSE_SECONDS = 1.2;

// This editorial ellipsis contains no speech; TTS returned an empty audio payload.
function isLocalPauseItem(item) {
  return (
    item.book === 'XinBian2' &&
    item.lesson_id === 'review_unit_02' &&
    item.paragraph_no === 5 &&
    item.text === '……'
  );
}

// These canonical spans were included in the historical TTS source but omitted
// from v2 sentence text. Keep them in the replacement audio and require the
// historical source chunks to confirm each exception before proceeding.
const APPROVED_V2_OMISSIONS = {
  'XinBian2|lesson_07': ['(クラスの班長・張志強)'],
  'XinBian3|lesson_05': ['(「ウエスタン・ランド写真館」でなりきり写真を撮影)'],
  'XinBian4|lesson_18': ['(音楽、終わる)'],
};
const HISTORICAL_SOURCE_DIR = path.join(ROOT, 'data/qwen_reading_sections_manual_clean132_context_v1');

// Daily limits come from the user's AI Studio screenshot. This run starts just
// after the Pacific quota reset; the request ledger tracks usage by this script.
// Any other same-day account usage can still cause a provider 429 response.
const MODELS = [
  {
    id: 'gemini-2.5-flash-preview-tts',
    display: 'Gemini 2.5 Flash TTS',
    dailyLimit: 100,
    usedAtSnapshot: 0,
    transport: 'generate-content',
    voiceName: 'Kore',
  },
  {
    id: 'gemini-2.5-pro-preview-tts',
    display: 'Gemini 2.5 Pro TTS',
    dailyLimit: 50,
    usedAtSnapshot: 0,
    transport: 'generate-content',
    voiceName: 'Kore',
  },
  {
    id: 'gemini-3.1-flash-tts-preview',
    display: 'Gemini 3.1 Flash TTS',
    dailyLimit: 100,
    usedAtSnapshot: 0,
    transport: 'interactions-pcm',
    voiceName: 'Kore',
  },
  {
    id: 'gemini-3.8-flash-lite-tts',
    display: 'Gemini 3.8 Flash-Lite TTS',
    dailyLimit: 100,
    usedAtSnapshot: 0,
    transport: 'interactions-wav',
    voiceName: 'Concierge 7',
    lookupVoice: true,
  },
  {
    id: 'gemini-3.8-flash-tts',
    display: 'Gemini 3.8 Flash TTS',
    dailyLimit: 100,
    usedAtSnapshot: 0,
    transport: 'interactions-wav',
    voiceName: 'Concierge 7',
    lookupVoice: true,
  },
];

function parseArgs(argv) {
  const options = {
    dryRun: false,
    limit: null,
    outputDir: DEFAULT_OUTPUT,
    ratePerMinute: RATE_PER_MINUTE,
    ffmpeg: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) throw new Error(arg + ' requires a value');
      i += 1;
      return next;
    };
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--limit') options.limit = parsePositiveInt(value(), arg);
    else if (arg === '--output-dir') options.outputDir = value();
    else if (arg === '--rate-per-minute') options.ratePerMinute = parsePositiveInt(value(), arg);
    else if (arg === '--ffmpeg') options.ffmpeg = value();
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error('Unknown argument: ' + arg);
  }
  if (options.ratePerMinute > 4) throw new Error('--rate-per-minute cannot exceed 4');
  return options;
}

function parsePositiveInt(raw, name) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(name + ' must be a positive integer');
  return n;
}

function help() {
  console.log(
    [
      'Generate application-reading audio as independently replaceable paragraphs.',
      '',
      'Options:',
      '  --dry-run                 Verify source coverage and print the quota plan',
      '  --limit N                 Process at most N unfinished paragraphs',
      '  --output-dir PATH         Candidate output directory',
      '  --rate-per-minute N       Global request starts per minute (1–4, default 4)',
      '  --ffmpeg PATH             Explicit ffmpeg executable path',
      '',
      'A live run requires GEMINI_API_KEY. It writes candidate WAV/OGG files and resumable JSONL manifests.',
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
        throw new Error('Invalid JSONL at ' + file + ':' + (index + 1) + ': ' + error.message);
      }
    });
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.' + process.pid + '.' + Date.now() + '.tmp';
  fs.writeFileSync(temp, data);
  fs.renameSync(temp, file);
}

function appendJsonl(file, row) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(row) + '\n', 'utf8');
}

function sectionKey(book, lessonId) {
  return book + '|' + lessonId;
}

function paragraphKey(book, lessonId, paragraphNo) {
  return sectionKey(book, lessonId) + '|p' + String(paragraphNo).padStart(2, '0');
}

function getApplicationParagraphs() {
  const data = readJson(SOURCE);
  if (!Array.isArray(data.sentences)) throw new Error(SOURCE + ' has no sentences array');

  const grouped = new Map();
  for (const sentence of data.sentences) {
    if (sentence.section !== 'application' || sentence.role !== 'section_text') continue;
    if (typeof sentence.text !== 'string' || !sentence.text.length) {
      throw new Error('Application sentence ' + (sentence.id || '(no id)') + ' has empty/non-string text');
    }
    const key = sectionKey(sentence.book_id, sentence.lesson_id);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(sentence);
  }

  const v2TextByArticle = new Map();
  for (const [key, sentences] of grouped) {
    sentences.sort((a, b) => Number(a.sentence_index) - Number(b.sentence_index));
    const seen = new Set();
    for (const sentence of sentences) {
      const index = Number(sentence.sentence_index);
      if (!Number.isInteger(index) || seen.has(index)) {
        throw new Error(key + ' has a missing or duplicate sentence_index ' + sentence.sentence_index);
      }
      seen.add(index);
    }
    v2TextByArticle.set(key, sentences.map((sentence) => sentence.text).join(''));
  }

  const references = readJsonl(REFERENCE_MANIFEST).filter(
    (row) => row.section_key === 'application' && row.status === 'ok',
  );
  const expected = new Map();
  for (const reference of references) {
    const key = sectionKey(reference.book, reference.lesson_id);
    if (expected.has(key)) throw new Error('Duplicate application reference: ' + key);
    expected.set(key, reference);
  }
  if (expected.size !== 71) throw new Error('Expected 71 application references, found ' + expected.size);
  const absentV2 = [...expected.keys()].filter((key) => !v2TextByArticle.has(key));
  const unexpectedV2 = [...v2TextByArticle.keys()].filter((key) => !expected.has(key));
  if (absentV2.length || unexpectedV2.length) {
    throw new Error(
      'Application v2 coverage mismatch; missing=' +
        (absentV2.join(', ') || 'none') +
        '; unexpected=' +
        (unexpectedV2.join(', ') || 'none'),
    );
  }

  const referencesByBook = new Map();
  for (const reference of references) {
    if (!referencesByBook.has(reference.book)) referencesByBook.set(reference.book, new Map());
    referencesByBook.get(reference.book).set(reference.lesson_id, reference);
  }

  const rows = [];
  const canonicalKeys = new Set();
  for (const [book, expectedLessons] of referencesByBook) {
    const bundlePath = path.join(CANONICAL_DIR, book + '.bundle.json');
    const bundle = readJson(bundlePath);
    for (const item of bundle.items || []) {
      const lesson = item.lesson;
      const lessonId = lesson && lesson.item_id;
      if (!expectedLessons.has(lessonId)) continue;
      const key = sectionKey(book, lessonId);
      canonicalKeys.add(key);
      const originalText = lesson.application && lesson.application.text;
      if (typeof originalText !== 'string' || !originalText.trim()) {
        throw new Error(key + ' is missing canonical lesson.application.text');
      }
      const reference = expectedLessons.get(lessonId);
      const parts = originalText
        .trim()
        .split(/\r?\n\s*\r?\n/)
        .map((part) => part.replace(/\r?\n/g, '').trim())
        .filter(Boolean);
      if (!parts.length) throw new Error(key + ' has no application paragraphs');
      let v2Projection = parts.join('');
      const approvedOmissions = APPROVED_V2_OMISSIONS[key] || [];
      if (approvedOmissions.length) {
        const sourceDir = String(Number(reference.lesson_no) || 0).padStart(2, '0') + '_' + lessonId;
        const historicalPath = path.join(
          HISTORICAL_SOURCE_DIR,
          book,
          sourceDir,
          'application',
          'source_chunks.json',
        );
        if (!fs.existsSync(historicalPath)) {
          throw new Error(
            key + ' needs an approved historical-source check, but source_chunks.json is missing',
          );
        }
        const historicalChunks = readJson(historicalPath);
        const historicalText = Array.isArray(historicalChunks) ? historicalChunks.join('') : '';
        for (const omission of approvedOmissions) {
          const index = v2Projection.indexOf(omission);
          if (index < 0 || v2Projection.indexOf(omission, index + omission.length) >= 0) {
            throw new Error(key + ' does not contain its approved one-time v2 omission: ' + omission);
          }
          if (!historicalText.includes(omission)) {
            throw new Error(key + ' historical TTS source does not confirm approved span: ' + omission);
          }
          v2Projection = v2Projection.slice(0, index) + v2Projection.slice(index + omission.length);
        }
      }
      if (v2Projection !== v2TextByArticle.get(key)) {
        throw new Error(
          key + ' canonical text differs from v2 beyond approved historical spans; refusing generation',
        );
      }

      const articleSha = sha256(parts.join('\n\n'));
      for (let index = 0; index < parts.length; index += 1) {
        const text = parts[index];
        rows.push({
          book,
          lesson_id: lessonId,
          lesson_no: Number.isFinite(Number(reference.lesson_no))
            ? Number(reference.lesson_no)
            : Number(lesson.lesson_no) || 0,
          lesson_label: reference.lesson_label,
          lesson_title: reference.lesson_title,
          section_key: 'application',
          section_label: reference.section_label,
          section_title: reference.section_title,
          section_subtitle: reference.section_subtitle,
          article_sha256: articleSha,
          approved_v2_omissions: approvedOmissions,
          paragraph_no: index + 1,
          paragraph_count: parts.length,
          text,
          text_sha256: sha256(text),
          text_chars: [...text].length,
        });
      }
    }
  }

  const absentCanonical = [...expected.keys()].filter((key) => !canonicalKeys.has(key));
  const unexpectedCanonical = [...canonicalKeys].filter((key) => !expected.has(key));
  if (absentCanonical.length || unexpectedCanonical.length || canonicalKeys.size !== 71) {
    throw new Error(
      'Canonical application coverage mismatch; missing=' +
        (absentCanonical.join(', ') || 'none') +
        '; unexpected=' +
        (unexpectedCanonical.join(', ') || 'none'),
    );
  }
  return rows;
}

function makePlan(rows) {
  const articleMap = new Map();
  for (const row of rows) {
    const key = sectionKey(row.book, row.lesson_id);
    if (!articleMap.has(key))
      articleMap.set(key, {
        key,
        book: row.book,
        lesson_id: row.lesson_id,
        article_sha256: row.article_sha256,
        rows: [],
      });
    articleMap.get(key).rows.push(row);
  }
  const articles = [...articleMap.values()];
  const bins = MODELS.map((model) => ({
    model_id: model.id,
    capacity: model.dailyLimit - model.usedAtSnapshot,
    remaining: model.dailyLimit - model.usedAtSnapshot,
    articles: [],
  }));

  const descending = [...articles].sort(
    (a, b) => b.rows.length - a.rows.length || a.key.localeCompare(b.key),
  );
  for (const article of descending) {
    const bin = bins.find((candidate) => candidate.remaining >= article.rows.length);
    if (!bin) continue;
    bin.remaining -= article.rows.length;
    bin.articles.push(article);
  }

  const assignments = {};
  const binByModel = {};
  for (const bin of bins) {
    const articlesInStableOrder = bin.articles.sort((a, b) => a.key.localeCompare(b.key));
    binByModel[bin.model_id] = articlesInStableOrder.map((article) => article.key);
    for (const article of articlesInStableOrder) assignments[article.key] = bin.model_id;
  }
  const assignedCount = Object.values(binByModel).reduce(
    (sum, keys) => sum + keys.reduce((count, key) => count + articleMap.get(key).rows.length, 0),
    0,
  );
  const unassigned = articles
    .filter((article) => !assignments[article.key])
    .map((article) => ({ key: article.key, paragraphs: article.rows.length }));
  const modelPlan = MODELS.map((model, index) => ({
    model_id: model.id,
    display: model.display,
    voice_name: model.voiceName,
    daily_limit: model.dailyLimit,
    used_at_snapshot: model.usedAtSnapshot,
    request_capacity: bins[index].capacity,
    assigned_requests: bins[index].capacity - bins[index].remaining,
    articles: binByModel[model.id],
  }));
  return {
    version: 1,
    quota_day_pt: QUOTA_DAY_PT,
    source: path.relative(ROOT, SOURCE).split(path.sep).join('/'),
    source_sha256: sha256(rows.map((row) => row.text_sha256).join('\n')),
    total_articles: articles.length,
    total_paragraphs: rows.length,
    assigned_articles: Object.keys(assignments).length,
    assigned_requests: assignedCount,
    unassigned_articles: unassigned,
    unassigned_requests: unassigned.reduce((sum, item) => sum + item.paragraphs, 0),
    model_plan: modelPlan,
    assignments,
  };
}

function makeResumedPlan(rows, previous, existing, outputRoot, sourcePlan) {
  const articles = new Map();
  for (const row of rows) {
    const key = sectionKey(row.book, row.lesson_id);
    if (!articles.has(key)) articles.set(key, { key, rows: [] });
    articles.get(key).rows.push(row);
  }

  const lastSuccess = new Map();
  const successModelsByArticle = new Map();
  for (const row of existing) {
    if (row.status !== 'ok' || !row.paragraph_no) continue;
    lastSuccess.set(paragraphKey(row.book, row.lesson_id, row.paragraph_no), row);
    const key = sectionKey(row.book, row.lesson_id);
    if (!successModelsByArticle.has(key)) successModelsByArticle.set(key, new Set());
    if (row.model) successModelsByArticle.get(key).add(row.model);
  }

  const modelStats = new Map(
    MODELS.map((model) => [
      model.id,
      {
        model,
        capacity: Math.max(0, model.dailyLimit - model.usedAtSnapshot),
        assignedRequests: 0,
        articles: [],
      },
    ]),
  );
  const assignments = {};
  const deferred = [];
  let assignedArticles = 0;

  function pendingRows(article, modelId) {
    return article.rows.filter((row) => {
      const key = paragraphKey(row.book, row.lesson_id, row.paragraph_no);
      const prior = lastSuccess.get(key);
      if (!prior || prior.text_sha256 !== row.text_sha256 || prior.model !== modelId) return true;
      const paths = outputPaths(outputRoot, row);
      return !wavInfo(paths.wav) || !oggIsValid(paths.ogg);
    });
  }

  for (const article of articles.values()) {
    const recordedModels = successModelsByArticle.get(article.key) || new Set();
    if (recordedModels.size > 1) {
      throw new Error(
        article.key + ' already has successful paragraphs from multiple TTS models; refusing to mix voices.',
      );
    }
    const modelId = previous.assignments[article.key] || [...recordedModels][0];
    if (!modelId) {
      deferred.push({ ...article, pending: pendingRows(article, null) });
      continue;
    }
    const stats = modelStats.get(modelId);
    if (!stats) throw new Error('Previous allocation refers to unknown model: ' + modelId);
    if (recordedModels.size && !recordedModels.has(modelId)) {
      throw new Error(
        article.key + ' successful audio does not match its saved article model; refusing to change voice.',
      );
    }
    assignments[article.key] = modelId;
    const pending = pendingRows(article, modelId);
    if (pending.length > stats.capacity) {
      throw new Error(
        article.key +
          ' needs ' +
          pending.length +
          ' requests on ' +
          modelId +
          ", above today's remaining quota of " +
          stats.capacity +
          '.',
      );
    }
    stats.capacity -= pending.length;
    stats.assignedRequests += pending.length;
    if (pending.length) {
      stats.articles.push(article.key);
      assignedArticles += 1;
    }
  }

  deferred.sort((a, b) => b.pending.length - a.pending.length || a.key.localeCompare(b.key));
  const unassigned = [];
  for (const article of deferred) {
    if (!article.pending.length) continue;
    const stats = [...modelStats.values()].find((candidate) => candidate.capacity >= article.pending.length);
    if (!stats) {
      unassigned.push({ key: article.key, paragraphs: article.pending.length });
      continue;
    }
    assignments[article.key] = stats.model.id;
    stats.capacity -= article.pending.length;
    stats.assignedRequests += article.pending.length;
    stats.articles.push(article.key);
    assignedArticles += 1;
  }

  const assignedRequests = [...modelStats.values()].reduce((sum, item) => sum + item.assignedRequests, 0);
  return {
    version: 1,
    quota_day_pt: QUOTA_DAY_PT,
    source: sourcePlan.source,
    source_sha256: sourcePlan.source_sha256,
    total_articles: articles.size,
    total_paragraphs: rows.length,
    assigned_articles: assignedArticles,
    assigned_requests: assignedRequests,
    unassigned_articles: unassigned,
    unassigned_requests: unassigned.reduce((sum, item) => sum + item.paragraphs, 0),
    model_plan: MODELS.map((model) => {
      const stats = modelStats.get(model.id);
      return {
        model_id: model.id,
        display: model.display,
        voice_name: model.voiceName,
        daily_limit: model.dailyLimit,
        used_at_snapshot: model.usedAtSnapshot,
        request_capacity: model.dailyLimit - model.usedAtSnapshot,
        assigned_requests: stats.assignedRequests,
        articles: stats.articles,
      };
    }),
    assignments,
  };
}

function outputPaths(outputRoot, item) {
  const lessonNo = Number.isFinite(Number(item.lesson_no))
    ? String(Number(item.lesson_no)).padStart(2, '0')
    : '00';
  const paragraphNo = String(item.paragraph_no).padStart(2, '0');
  const baseName = item.book + '_' + lessonNo + '_application_p' + paragraphNo + '_reading';
  const directory = path.join(outputRoot, item.book, item.lesson_id, 'application');
  return {
    wav: path.join(directory, baseName + '.wav'),
    ogg: path.join(directory, baseName + '.ogg'),
    meta: path.join(directory, baseName + '.meta.json'),
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
      const candidate = path.join(dir, name.toLowerCase().endsWith(ext.toLowerCase()) ? name : name + ext);
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
      else
        reject(new Error(path.basename(executable) + ' exited ' + code + ': ' + stderr.trim().slice(-3000)));
    });
  });
}

function appendErrorFromPayload(payload) {
  const message =
    payload && payload.error && payload.error.message
      ? payload.error.message
      : payload && payload.message
        ? payload.message
        : 'API returned an unspecified error';
  return String(message).replace(/\s+/g, ' ').slice(0, 700);
}

async function readResponseJson(response) {
  const body = await response.text();
  try {
    return JSON.parse(body);
  } catch {
    return { message: body.slice(0, 700) || 'HTTP ' + response.status };
  }
}

async function sleep(ms) {
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveVoice(apiKey, displayName) {
  const url = new URL(API_ROOT + '/voices');
  url.searchParams.set('language_code', 'ja-JP');
  url.searchParams.set('search', displayName);
  url.searchParams.set('page_size', '100');
  const response = await fetch(url, {
    headers: { 'x-goog-api-key': apiKey },
    signal: AbortSignal.timeout(30000),
  });
  const payload = await readResponseJson(response);
  if (!response.ok)
    throw new Error('Voice lookup failed (HTTP ' + response.status + '): ' + appendErrorFromPayload(payload));
  const exact = (payload.voices || []).filter(
    (voice) =>
      String(voice.display_name || '')
        .trim()
        .toLowerCase() === displayName.toLowerCase(),
  );
  if (exact.length !== 1 || !exact[0].id) {
    throw new Error('Expected one Japanese voice named ' + displayName + '; exact matches=' + exact.length);
  }
  return exact[0];
}

function makeInteractionPayload(model, item, voiceValue) {
  const text =
    model.transport === 'interactions-wav'
      ? item.text
      : 'Read this Japanese textbook passage in a warm, measured style, clearly and exactly as written.\n' +
        item.text;
  const content = { type: 'text', text };
  if (model.transport === 'interactions-wav') {
    content.annotations = [{ type: 'speech_metadata', style: STYLE }];
  }
  return {
    model: model.id,
    input: [{ type: 'user_input', content: [content] }],
    response_format: { type: 'audio' },
    generation_config: { speech_config: [{ voice: voiceValue }] },
  };
}

function makeGenerateContentPayload(model, item) {
  return {
    contents: [
      {
        role: 'user',
        parts: [{ text: LEGACY_PROMPT + item.text }],
      },
    ],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: model.voiceName },
        },
      },
    },
  };
}

function extractAudio(payload, transport) {
  if (transport.startsWith('interactions-')) {
    if (payload.output_audio && payload.output_audio.data) {
      return {
        bytes: Buffer.from(payload.output_audio.data, 'base64'),
        mimeType: payload.output_audio.mime_type || payload.output_audio.mimeType || '',
      };
    }
    for (const step of [...(payload.steps || [])].reverse()) {
      for (const content of [...(step.content || [])].reverse()) {
        if (content.type === 'audio' && content.data) {
          return { bytes: Buffer.from(content.data, 'base64'), mimeType: content.mime_type || '' };
        }
      }
    }
    return null;
  }
  const parts =
    (payload.candidates &&
      payload.candidates[0] &&
      payload.candidates[0].content &&
      payload.candidates[0].content.parts) ||
    [];
  const audioPart = parts.find(
    (part) => (part.inlineData && part.inlineData.data) || (part.inline_data && part.inline_data.data),
  );
  if (!audioPart) return null;
  const data = audioPart.inlineData || audioPart.inline_data;
  return { bytes: Buffer.from(data.data, 'base64'), mimeType: data.mimeType || data.mime_type || '' };
}

function pcmToWav(pcm, sampleRate = 24000, channels = 1, bitsPerSample = 16) {
  if (pcm.length % ((channels * bitsPerSample) / 8) !== 0) {
    throw new Error('Raw PCM byte length is not aligned to the declared sample format');
  }
  const header = Buffer.alloc(44);
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function normalizeWav(audio, model) {
  if (
    audio.bytes.length >= 44 &&
    audio.bytes.toString('ascii', 0, 4) === 'RIFF' &&
    audio.bytes.toString('ascii', 8, 12) === 'WAVE'
  ) {
    return audio.bytes;
  }
  const mime = String(audio.mimeType || '').toLowerCase();
  if (mime && !mime.includes('l16') && !mime.includes('pcm') && !mime.includes('wav')) {
    throw new Error('Unexpected audio MIME type from ' + model.id + ': ' + audio.mimeType);
  }
  return pcmToWav(audio.bytes);
}

function makeHttpError(status, payload) {
  const error = new Error('Gemini API HTTP ' + status + ': ' + appendErrorFromPayload(payload));
  error.status = status;
  return error;
}

function describePlan(plan) {
  console.log(
    'Quota day: ' +
      plan.quota_day_pt +
      ' Pacific time; global pace: at most ' +
      RATE_PER_MINUTE +
      ' requests/minute.',
  );
  console.log(
    'Application articles: ' + plan.total_articles + '; paragraph requests: ' + plan.total_paragraphs + '.',
  );
  console.log(
    'Planned today: ' +
      plan.assigned_requests +
      ' requests across ' +
      plan.assigned_articles +
      ' complete articles.',
  );
  console.log(
    'Deferred: ' +
      plan.unassigned_requests +
      ' requests across ' +
      plan.unassigned_articles.length +
      ' complete articles.',
  );
  for (const row of plan.model_plan) {
    console.log(
      row.display +
        ': ' +
        row.assigned_requests +
        '/' +
        row.request_capacity +
        ' requests; ' +
        row.articles.length +
        ' articles; voice=' +
        row.voice_name,
    );
  }
  if (plan.unassigned_requests) {
    console.log(
      'Deferred articles: ' +
        plan.unassigned_articles.map((item) => item.key + '(' + item.paragraphs + ')').join(', '),
    );
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return help();

  const rows = getApplicationParagraphs();
  const outputRoot = path.resolve(ROOT, options.outputDir);
  const allocationPath = path.join(outputRoot, 'allocation.json');
  const manifestPath = path.join(outputRoot, 'manifest.jsonl');
  const requestLedgerPath = path.join(outputRoot, 'request_ledger.jsonl');
  const existing = readJsonl(manifestPath);
  const candidatePlan = makePlan(rows);
  let plan = candidatePlan;
  let allocationNeedsWrite = !fs.existsSync(allocationPath);

  if (fs.existsSync(allocationPath)) {
    const previous = readJson(allocationPath);
    if (previous.source_sha256 !== candidatePlan.source_sha256) {
      throw new Error(
        'Existing allocation belongs to a different source revision; review the source changes before resuming.',
      );
    }
    if (previous.quota_day_pt === QUOTA_DAY_PT) {
      plan = previous;
    } else {
      plan = makeResumedPlan(rows, previous, existing, outputRoot, candidatePlan);
      allocationNeedsWrite = true;
      console.log(
        'Refreshing the quota plan for ' +
          QUOTA_DAY_PT +
          ' Pacific time; existing article model assignments are preserved.',
      );
    }
  }

  const currentDay = pacificQuotaDay();
  if (currentDay !== QUOTA_DAY_PT) {
    throw new Error(
      'This allocation is for Pacific quota day ' +
        QUOTA_DAY_PT +
        ', but today is ' +
        currentDay +
        '. Refresh the quota snapshot before running.',
    );
  }

  const assignedRows = rows
    .map((row) => {
      const article = sectionKey(row.book, row.lesson_id);
      return plan.assignments[article] ? { ...row, model_id: plan.assignments[article] } : null;
    })
    .filter(Boolean);

  const lastSuccess = new Map();
  for (const row of existing) {
    if (row.status === 'ok' && row.paragraph_no) {
      lastSuccess.set(paragraphKey(row.book, row.lesson_id, row.paragraph_no), row);
    }
  }

  const completed = new Set();
  const pending = [];
  for (const row of assignedRows) {
    const model = MODELS.find((item) => item.id === row.model_id);
    if (!model) throw new Error('Allocation refers to unknown model: ' + row.model_id);
    const paths = outputPaths(outputRoot, row);
    const key = paragraphKey(row.book, row.lesson_id, row.paragraph_no);
    const prior = lastSuccess.get(key);
    const info = wavInfo(paths.wav);
    const hasArtifacts = Boolean(info && oggIsValid(paths.ogg));
    let sidecarMatches = false;
    if (hasArtifacts && fs.existsSync(paths.meta)) {
      try {
        const meta = readJson(paths.meta);
        sidecarMatches =
          meta.text_sha256 === row.text_sha256 &&
          meta.model === model.id &&
          meta.voice_name === model.voiceName;
      } catch {
        sidecarMatches = false;
      }
    }
    if (prior && prior.text_sha256 === row.text_sha256 && prior.model === model.id && hasArtifacts) {
      completed.add(key);
      continue;
    }
    if (sidecarMatches) {
      appendJsonl(manifestPath, {
        status: 'ok',
        recovered_after_restart: true,
        ...row,
        model: model.id,
        voice_name: model.voiceName,
        output: relative(paths.wav),
        output_ogg: relative(paths.ogg),
        duration_sec: info.duration_sec,
        wav_bytes: info.size_bytes,
        generated_at: readJson(paths.meta).generated_at,
      });
      completed.add(key);
      continue;
    }
    pending.push({ ...row, paths });
  }

  const work = options.limit == null ? pending : pending.slice(0, options.limit);
  const totalChars = rows.reduce((sum, row) => sum + row.text_chars, 0);
  console.log('Source paragraphs verified against canonical application.text and v2 sentence data.');
  console.log(
    'All application paragraphs: ' +
      rows.length +
      '; Japanese characters: ' +
      totalChars.toLocaleString() +
      '.',
  );
  console.log(
    'Canonical-only transcript spans explicitly checked against historical source chunks: ' +
      Object.values(APPROVED_V2_OMISSIONS).flat().length +
      ' in 3 articles.',
  );
  console.log(
    'Already complete: ' +
      completed.size +
      '; assigned and pending: ' +
      pending.length +
      '; selected: ' +
      work.length +
      '.',
  );
  describePlan(plan);
  console.log('Output: ' + path.relative(ROOT, outputRoot).split(path.sep).join('/'));
  if (options.dryRun) {
    console.log('Dry run passed. No API requests or files were written.');
    return;
  }

  const needsApi = work.some((item) => !isLocalPauseItem(item));
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (needsApi && !apiKey)
    throw new Error('Set GEMINI_API_KEY or GOOGLE_API_KEY in this process environment.');
  if (needsApi && (typeof fetch !== 'function' || typeof AbortSignal.timeout !== 'function')) {
    throw new Error('Node.js with built-in fetch and AbortSignal.timeout is required (Node 18+).');
  }
  const ffmpeg = options.ffmpeg || findExecutable('ffmpeg');
  if (!ffmpeg || !fs.existsSync(ffmpeg))
    throw new Error('ffmpeg not found; add it to PATH or pass --ffmpeg PATH.');

  fs.mkdirSync(outputRoot, { recursive: true });
  if (allocationNeedsWrite) atomicWrite(allocationPath, JSON.stringify(plan, null, 2) + '\n');

  const voiceValues = new Map();
  for (const model of MODELS) {
    if (!work.some((item) => item.model_id === model.id && !isLocalPauseItem(item))) continue;
    if (model.lookupVoice) {
      const voice = await resolveVoice(apiKey, model.voiceName);
      voiceValues.set(model.id, voice.id);
      console.log('Resolved voice for ' + model.display + ': ' + voice.display_name + ' (' + voice.id + ').');
    } else {
      voiceValues.set(model.id, model.voiceName);
    }
  }

  const requestLedger = readJsonl(requestLedgerPath);
  const dailyCounts = new Map(MODELS.map((model) => [model.id, model.usedAtSnapshot]));
  for (const entry of requestLedger) {
    if (entry.quota_day_pt === QUOTA_DAY_PT && entry.model) {
      dailyCounts.set(entry.model, (dailyCounts.get(entry.model) || 0) + 1);
    }
  }

  let lastPostStartedAt = 0;
  let requestsThisRun = 0;
  let generated = 0;
  let failed = 0;
  const unavailableModels = new Set();
  const exhaustedModels = new Set();

  async function post(model, item) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (pacificQuotaDay() !== QUOTA_DAY_PT) {
        const error = new Error('Pacific quota day changed; stopping to avoid using a stale quota snapshot.');
        error.fatal = true;
        throw error;
      }
      const currentUsage = dailyCounts.get(model.id) || 0;
      if (currentUsage >= model.dailyLimit) {
        exhaustedModels.add(model.id);
        const error = new Error(model.display + ' reached its recorded daily limit.');
        error.quotaExhausted = true;
        throw error;
      }
      await sleep(
        Math.max(0, lastPostStartedAt + Math.ceil(60000 / options.ratePerMinute) + 500 - Date.now()),
      );
      lastPostStartedAt = Date.now();
      dailyCounts.set(model.id, currentUsage + 1);
      requestsThisRun += 1;
      appendJsonl(requestLedgerPath, {
        quota_day_pt: QUOTA_DAY_PT,
        started_at: new Date(lastPostStartedAt).toISOString(),
        run_pid: process.pid,
        model: model.id,
        book: item.book,
        lesson_id: item.lesson_id,
        paragraph_no: item.paragraph_no,
        attempt: attempt + 1,
      });

      let response;
      try {
        if (model.transport.startsWith('interactions-')) {
          const voice = voiceValues.get(model.id);
          const payload = makeInteractionPayload(model, item, voice);
          response = await fetch(API_ROOT + '/interactions', {
            method: 'POST',
            headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(180000),
          });
        } else {
          const payload = makeGenerateContentPayload(model, item);
          response = await fetch(API_ROOT + '/models/' + model.id + ':generateContent', {
            method: 'POST',
            headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(180000),
          });
        }
      } catch (error) {
        if (attempt === 0) {
          console.warn('  Network error; retrying once after the global request interval: ' + error.message);
          continue;
        }
        throw error;
      }

      const payload = await readResponseJson(response);
      if (response.ok) {
        const audio = extractAudio(payload, model.transport);
        if (!audio || !audio.bytes.length) throw new Error('Gemini response contained no audio payload.');
        return {
          audio,
          interactionId: payload.id || (payload.interaction && payload.interaction.id) || null,
        };
      }

      const error = makeHttpError(response.status, payload);
      if (response.status === 429) {
        exhaustedModels.add(model.id);
        error.quotaExhausted = true;
        throw error;
      }
      if (response.status === 401 || response.status === 403) {
        error.fatal = true;
        throw error;
      }
      if (response.status === 400 || response.status === 404 || response.status === 405) {
        unavailableModels.add(model.id);
        error.modelUnavailable = true;
        throw error;
      }
      if (response.status >= 500 && attempt === 0) {
        console.warn('  HTTP ' + response.status + '; retrying once after the global request interval.');
        continue;
      }
      throw error;
    }
    throw new Error('TTS request failed after retries.');
  }

  let fatalError = null;
  for (const model of MODELS) {
    if (!work.some((item) => item.model_id === model.id)) continue;
    if (unavailableModels.has(model.id) || exhaustedModels.has(model.id)) continue;
    const modelWork = work.filter((item) => item.model_id === model.id);
    for (const item of modelWork) {
      if (unavailableModels.has(model.id) || exhaustedModels.has(model.id)) break;
      const key = paragraphKey(item.book, item.lesson_id, item.paragraph_no);
      if (completed.has(key)) continue;
      const count = dailyCounts.get(model.id) || 0;
      console.log(
        '[' +
          model.display +
          ' ' +
          count +
          '/' +
          model.dailyLimit +
          ' today PT; ' +
          requestsThisRun +
          ' requests this run] ' +
          item.book +
          ' ' +
          item.lesson_id +
          ' p' +
          String(item.paragraph_no).padStart(2, '0') +
          ' (' +
          item.text_chars +
          ' chars)',
      );
      try {
        const localPause = isLocalPauseItem(item);
        const result = localPause ? null : await post(model, item);
        const wavTemp = item.paths.wav + '.' + process.pid + '.part.wav';
        const oggTemp = item.paths.ogg + '.' + process.pid + '.part.ogg';
        fs.mkdirSync(path.dirname(item.paths.wav), { recursive: true });
        if (localPause) {
          fs.writeFileSync(wavTemp, pcmToWav(Buffer.alloc(Math.round(24000 * LOCAL_PAUSE_SECONDS) * 2)));
        } else {
          fs.writeFileSync(wavTemp, normalizeWav(result.audio, model));
        }
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
        if (!oggIsValid(oggTemp)) throw new Error('ffmpeg produced an invalid OGG file.');
        fs.renameSync(wavTemp, item.paths.wav);
        fs.renameSync(oggTemp, item.paths.ogg);
        const info = wavInfo(item.paths.wav);
        if (!info) throw new Error('Generated WAV failed validation.');
        const generatedAt = new Date().toISOString();
        const voiceName = model.voiceName;
        atomicWrite(
          item.paths.meta,
          JSON.stringify(
            {
              model: model.id,
              voice_name: voiceName,
              voice_id: localPause ? null : voiceValues.get(model.id),
              style: localPause
                ? null
                : model.transport === 'interactions-wav'
                  ? STYLE
                  : LEGACY_PROMPT.trim(),
              synthesis_method: localPause ? 'local_silence' : 'gemini_tts',
              text_sha256: item.text_sha256,
              article_sha256: item.article_sha256,
              interaction_id: result && result.interactionId,
              generated_at: generatedAt,
            },
            null,
            2,
          ) + '\n',
        );
        appendJsonl(manifestPath, {
          status: 'ok',
          ...item,
          paths: undefined,
          model: model.id,
          voice_name: voiceName,
          voice_id: localPause ? null : voiceValues.get(model.id),
          synthesis_method: localPause ? 'local_silence' : 'gemini_tts',
          output: relative(item.paths.wav),
          output_ogg: relative(item.paths.ogg),
          duration_sec: info.duration_sec,
          sample_rate_hz: info.sample_rate_hz,
          channels: info.channels,
          wav_bytes: info.size_bytes,
          interaction_id: result && result.interactionId,
          generated_at: generatedAt,
        });
        generated += 1;
        completed.add(key);
        console.log(
          '  Saved ' +
            info.duration_sec.toFixed(1) +
            ' sec ' +
            (localPause ? 'local pause' : 'TTS') +
            ' WAV + OGG.',
        );
        try {
          fs.unlinkSync(wavTemp);
        } catch {}
        try {
          fs.unlinkSync(oggTemp);
        } catch {}
      } catch (error) {
        if (error.fatal) {
          fatalError = error;
          break;
        }
        if (error.quotaExhausted) {
          console.warn('  ' + error.message + ' Skipping the rest of this model for today.');
          break;
        }
        if (error.modelUnavailable) {
          console.error('  ' + error.message + ' Skipping this model; other models will continue.');
          break;
        }
        failed += 1;
        console.error(
          '  FAILED ' + item.book + ' ' + item.lesson_id + ' p' + item.paragraph_no + ': ' + error.message,
        );
        appendJsonl(manifestPath, {
          status: 'error',
          model: model.id,
          book: item.book,
          lesson_id: item.lesson_id,
          section_key: 'application',
          paragraph_no: item.paragraph_no,
          text_sha256: item.text_sha256,
          error: error.message,
          failed_at: new Date().toISOString(),
        });
      }
    }
    if (fatalError) break;
  }

  const successKeys = new Set(
    readJsonl(manifestPath)
      .filter((row) => row.status === 'ok')
      .map((row) => paragraphKey(row.book, row.lesson_id, row.paragraph_no)),
  );
  const missingAssigned = assignedRows.filter(
    (row) => !successKeys.has(paragraphKey(row.book, row.lesson_id, row.paragraph_no)),
  );
  const finalDay = pacificQuotaDay();
  const summary = {
    quota_day_pt: QUOTA_DAY_PT,
    model_plan: plan.model_plan,
    all_application_paragraphs: rows.length,
    assigned_today: plan.assigned_requests,
    deferred_for_future_quota: plan.unassigned_requests,
    completed_assigned: assignedRows.length - missingAssigned.length,
    missing_assigned: missingAssigned.map((row) => ({
      book: row.book,
      lesson_id: row.lesson_id,
      paragraph_no: row.paragraph_no,
      model: row.model_id,
    })),
    generated_this_run: generated,
    failed_this_run: failed,
    requests_this_run: requestsThisRun,
    requests_used_today_by_model: Object.fromEntries(dailyCounts),
    exhausted_models: [...exhaustedModels],
    unavailable_models: [...unavailableModels],
    quota_day_after_run_pt: finalDay,
    output_dir: relative(outputRoot),
    updated_at: new Date().toISOString(),
  };
  atomicWrite(path.join(outputRoot, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(
    'Finished: generated=' +
      generated +
      ', failed=' +
      failed +
      ', attempts=' +
      requestsThisRun +
      ', assigned complete=' +
      summary.completed_assigned +
      '/' +
      assignedRows.length +
      ', deferred=' +
      plan.unassigned_requests +
      '.',
  );
  if (fatalError) throw fatalError;
}

module.exports = { makeInteractionPayload, makeGenerateContentPayload, extractAudio, normalizeWav };
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
