#!/usr/bin/env node
/*
 * Generate candidate replacements for verified vocabulary reading corrections.
 * Production audio directories and frontend manifests are never modified here.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL = 'gemini-3.8-flash-tts';
const VOICE_NAME = 'Concierge 7';
const STYLE =
  'Clear, steady standard Japanese pronunciation with natural pitch accent. Say only the provided Japanese word, at a measured pace, without adding an explanation or other words.';
const DEFAULT_OUTPUT = 'data/gemini38_flash_tts_vocab_repairs_candidate_v1';
const QUOTA_TIME_ZONE = 'America/Los_Angeles';
const BODY_LEDGER = path.join(ROOT, 'data/gemini38_flash_tts_body_v1/request_ledger.jsonl');

const TEXTBOOK_INDEXES = [526, 3391, 3494, 3647, 3947, 4060, 4221, 5383, 5853, 6068];
const MAIN_SOURCE_INDEXES = [2433, 2781, 2860, 3742, 4804, 4873, 6121, 6346, 6922, 7735];

function parseArgs(argv) {
  const options = {
    dryRun: false,
    outputDir: DEFAULT_OUTPUT,
    ratePerMinute: 4,
    maxRequestsPerDay: 90,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) throw new Error(`${arg} requires a value`);
      i += 1;
      return next;
    };
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--output-dir') options.outputDir = value();
    else if (arg === '--rate-per-minute') options.ratePerMinute = positiveInt(value(), arg);
    else if (arg === '--max-requests-per-day') options.maxRequestsPerDay = positiveInt(value(), arg);
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.ratePerMinute > 4) throw new Error('--rate-per-minute cannot exceed 4');
  return options;
}

function positiveInt(raw, name) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
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

function appendJsonl(file, row) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`, 'utf8');
}

function atomicWrite(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, contents);
  fs.renameSync(temp, file);
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function relative(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

function quotaDay(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: QUOTA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function mainManifestIndex() {
  const file = path.join(ROOT, 'data/gcloud_chirp3_vocab12528_female_aoede_v1/manifest.jsonl');
  return new Map(readJsonl(file).map((row) => [`${row.source_index}|${row.split_part || 1}`, row]));
}

function collectItems() {
  const textbookManifest = new Map(
    readJsonl(path.join(ROOT, 'data/gcloud_chirp3_vocab6127_female_aoede_v1/manifest.jsonl')).map((row) => [
      row.index,
      row,
    ]),
  );
  const textbookCanonical = new Map(
    readJson(path.join(ROOT, 'data/textbook/canonical_textbook_vocab/textbook_vocab_full.v3.json')).map(
      (row) => [row.index, row],
    ),
  );
  const mainManifest = mainManifestIndex();
  const mainCanonical = new Map(
    readJson(path.join(ROOT, 'data/taxonomy_annotations_gemini_3_flash_enriched.json')).map((row) => [
      `${row.source_index}|${row.split_part || 1}`,
      row,
    ]),
  );
  const items = [];

  for (const index of TEXTBOOK_INDEXES) {
    const active = textbookManifest.get(index);
    const canonical = textbookCanonical.get(index);
    if (!active || !canonical) throw new Error(`Missing textbook vocabulary row ${index}`);
    if (
      !canonical.reading_hiragana ||
      canonical.word !== active.word ||
      (canonical.reading_hiragana === active.reading_hiragana && !active.audio_update_version)
    ) {
      throw new Error(`Textbook candidate ${index} no longer matches the reviewed reading correction`);
    }
    items.push(
      makeItem({
        scope: 'textbook',
        key: `textbook|${index}`,
        stableIndex: index,
        word: canonical.word,
        oldReading: active.reading_hiragana,
        reading: canonical.reading_hiragana,
        sourceManifest: relative(
          path.join(ROOT, 'data/gcloud_chirp3_vocab6127_female_aoede_v1/manifest.jsonl'),
        ),
        activeAudio: active.audio_relpath,
      }),
    );
  }

  for (const sourceIndex of MAIN_SOURCE_INDEXES) {
    const key = `${sourceIndex}|1`;
    const active = mainManifest.get(key);
    const canonical = mainCanonical.get(key);
    if (!active || !canonical) throw new Error(`Missing main vocabulary row ${key}`);
    if (
      !canonical.reading_hiragana ||
      canonical.word !== active.word ||
      (canonical.reading_hiragana === active.reading_hiragana && !active.audio_update_version)
    ) {
      throw new Error(
        `Main vocabulary candidate ${sourceIndex} no longer matches the reviewed reading correction`,
      );
    }
    items.push(
      makeItem({
        scope: 'main',
        key: `main|${sourceIndex}|1`,
        stableIndex: sourceIndex,
        word: canonical.word,
        oldReading: active.reading_hiragana,
        reading: canonical.reading_hiragana,
        sourceManifest: relative(
          path.join(ROOT, 'data/gcloud_chirp3_vocab12528_female_aoede_v1/manifest.jsonl'),
        ),
        activeAudio: active.audio_relpath,
      }),
    );
  }

  if (items.length !== 20)
    throw new Error(`Expected 20 reviewed pronunciation corrections, found ${items.length}`);
  return items;
}

function makeItem({ scope, key, stableIndex, word, oldReading, reading, sourceManifest, activeAudio }) {
  const synthesisText = `${reading}。`;
  const safeWord =
    word
      .normalize('NFKC')
      .replace(/[^\p{L}\p{N}]+/gu, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 24) || 'word';
  return {
    scope,
    key,
    stable_index: stableIndex,
    word,
    old_reading: oldReading,
    corrected_reading: reading,
    synthesis_text: synthesisText,
    text_sha256: sha256(synthesisText),
    source_manifest: sourceManifest,
    active_audio: activeAudio,
    filename: `${scope}_${String(stableIndex).padStart(5, '0')}_${safeWord}.wav`,
  };
}

function help() {
  console.log(
    [
      'Generate 20 reviewed vocabulary pronunciation replacements into a local candidate directory.',
      'Production audio and frontend manifests are not changed.',
      '',
      'Options:',
      '  --dry-run                     Validate source rows and print request plan',
      '  --output-dir PATH             Candidate output directory',
      '  --rate-per-minute N           Global request starts per minute (1–4, default 4)',
      '  --max-requests-per-day N      Shared Gemini 3.8 Flash TTS safety cap (default 90)',
    ].join('\n'),
  );
}

async function readResponseJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 700) || `HTTP ${response.status}` };
  }
}

function errorText(payload) {
  return String(payload.error?.message || payload.message || 'unknown error')
    .replace(/\s+/g, ' ')
    .slice(0, 700);
}

function extractAudio(payload) {
  if (payload.output_audio?.data) return payload.output_audio.data;
  for (const step of [...(payload.steps || [])].reverse()) {
    for (const item of [...(step.content || [])].reverse()) {
      if (item.type === 'audio' && item.data) return item.data;
    }
  }
  return null;
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
  if (!response.ok) throw new Error(`Voice lookup failed (HTTP ${response.status}): ${errorText(payload)}`);
  const matches = (payload.voices || []).filter(
    (voice) =>
      String(voice.display_name || '')
        .trim()
        .toLowerCase() === VOICE_NAME.toLowerCase(),
  );
  if (matches.length !== 1 || !matches[0].id)
    throw new Error(`Expected exactly one Japanese voice named ${VOICE_NAME}; found ${matches.length}`);
  return matches[0];
}

function wavInfo(buffer) {
  if (
    buffer.length < 44 ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WAVE'
  )
    return null;
  const channels = buffer.readUInt16LE(22);
  const sampleRate = buffer.readUInt32LE(24);
  const bitsPerSample = buffer.readUInt16LE(34);
  const dataBytes = buffer.readUInt32LE(40);
  if (!channels || !sampleRate || !bitsPerSample || dataBytes <= 0) return null;
  return {
    channels,
    sample_rate_hz: sampleRate,
    bits_per_sample: bitsPerSample,
    duration_sec: dataBytes / ((sampleRate * channels * bitsPerSample) / 8),
    bytes: buffer.length,
  };
}

function todayRequests(ledgers, day) {
  return ledgers.reduce((sum, rows) => sum + rows.filter((row) => row.quota_day_pt === day).length, 0);
}

async function sleep(ms) {
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return help();

  const outputRoot = path.resolve(ROOT, options.outputDir);
  const manifestPath = path.join(outputRoot, 'manifest.jsonl');
  const requestLedgerPath = path.join(outputRoot, 'request_ledger.jsonl');
  const work = collectItems();
  const previous = readJsonl(manifestPath);
  const completed = new Map(previous.filter((row) => row.status === 'ok').map((row) => [row.key, row]));
  const pending = work.filter((item) => {
    const old = completed.get(item.key);
    const file = path.join(outputRoot, item.filename);
    return !(
      old?.text_sha256 === item.text_sha256 &&
      old?.model === MODEL &&
      old?.voice_name === VOICE_NAME &&
      fs.existsSync(file) &&
      fs.statSync(file).size > 44
    );
  });

  const bodyLedger = readJsonl(BODY_LEDGER);
  const ownLedger = readJsonl(requestLedgerPath);
  const day = quotaDay();
  const usedToday = todayRequests([bodyLedger, ownLedger], day);
  console.log(`Model: ${MODEL}; voice: ${VOICE_NAME}; quota day: ${day} (${QUOTA_TIME_ZONE})`);
  console.log(
    `Reviewed reading changes: ${work.length}; already complete: ${work.length - pending.length}; pending: ${pending.length}`,
  );
  console.log(
    `Shared body + word request ledger: ${usedToday}/${options.maxRequestsPerDay}; output: ${relative(outputRoot)}`,
  );
  console.log(
    `Request rate: at most ${options.ratePerMinute}/minute; synthesis inputs use corrected kana only.`,
  );
  for (const item of pending)
    console.log(
      `  ${item.scope} #${item.stable_index}: ${item.word} ${item.old_reading} -> ${item.corrected_reading}`,
    );
  if (options.dryRun) {
    if (usedToday + pending.length > options.maxRequestsPerDay) {
      console.log(
        `Dry run: ${pending.length} calls exceed the shared safety headroom (${options.maxRequestsPerDay - usedToday}).`,
      );
    } else {
      console.log(`Dry run passed: ${pending.length} candidate TTS requests fit the shared safety cap.`);
    }
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('Set GEMINI_API_KEY or GOOGLE_API_KEY in this process environment.');
  if (typeof fetch !== 'function' || typeof AbortSignal.timeout !== 'function')
    throw new Error('Node.js 18+ with built-in fetch is required.');
  if (usedToday >= options.maxRequestsPerDay)
    throw new Error(
      `Shared Gemini TTS safety cap is already reached (${usedToday}/${options.maxRequestsPerDay}).`,
    );

  const voice = await resolveVoice(apiKey);
  console.log(`Resolved voice: ${voice.display_name} (${voice.id})`);
  const minSpacingMs = Math.ceil(60000 / options.ratePerMinute) + 500;
  let lastStart = Math.max(
    0,
    ...[bodyLedger, ownLedger]
      .flat()
      .filter((row) => row.quota_day_pt === day)
      .map((row) => Date.parse(row.started_at) || 0),
  );
  let requests = 0;
  let generated = 0;
  let failed = 0;

  for (const item of pending) {
    let audio = null;
    let interactionId = null;
    let failure = null;
    for (let attempt = 0; attempt < 3 && !audio; attempt += 1) {
      const currentDay = quotaDay();
      const currentBody = readJsonl(BODY_LEDGER);
      const currentOwn = readJsonl(requestLedgerPath);
      const sharedUsed = todayRequests([currentBody, currentOwn], currentDay);
      if (sharedUsed >= options.maxRequestsPerDay)
        throw new Error(
          `Shared daily safety cap reached (${sharedUsed}/${options.maxRequestsPerDay}); stopping before another TTS POST.`,
        );
      await sleep(lastStart + minSpacingMs - Date.now());
      lastStart = Date.now();
      requests += 1;
      appendJsonl(requestLedgerPath, {
        quota_day_pt: currentDay,
        started_at: new Date(lastStart).toISOString(),
        model: MODEL,
        key: item.key,
        attempt: attempt + 1,
        run_pid: process.pid,
      });
      console.log(
        `[TTS ${sharedUsed + 1}/${options.maxRequestsPerDay} PT today; request ${requests}] ${item.scope} #${item.stable_index}: ${item.word}`,
      );
      let response;
      try {
        response = await fetch(`${API_ROOT}/interactions`, {
          method: 'POST',
          headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
          body: JSON.stringify({
            model: MODEL,
            input: [
              {
                type: 'user_input',
                content: [
                  {
                    type: 'text',
                    text: item.synthesis_text,
                    annotations: [{ type: 'speech_metadata', style: STYLE }],
                  },
                ],
              },
            ],
            response_format: { type: 'audio' },
            generation_config: { speech_config: [{ voice: voice.id }] },
          }),
          signal: AbortSignal.timeout(180000),
        });
      } catch (error) {
        failure = error;
        if (attempt < 2) await sleep((attempt + 1) * 20000);
        continue;
      }
      const payload = await readResponseJson(response);
      if (response.ok) {
        const encoded = extractAudio(payload);
        if (!encoded) throw new Error(`No audio payload for ${item.key}`);
        audio = Buffer.from(encoded, 'base64');
        interactionId = payload.id || payload.interaction?.id || null;
        if (!wavInfo(audio)) throw new Error(`Invalid WAV payload for ${item.key}`);
        break;
      }
      failure = new Error(`Gemini HTTP ${response.status}: ${errorText(payload)}`);
      failure.status = response.status;
      if (!(response.status === 429 || response.status >= 500) || attempt >= 2) break;
      const wait = Number(response.headers.get('retry-after')) * 1000;
      await sleep(Math.max(Number.isFinite(wait) && wait > 0 ? wait : 0, (attempt + 1) * 20000));
    }

    if (!audio) {
      if ([400, 401, 403].includes(failure?.status)) throw failure;
      failed += 1;
      appendJsonl(manifestPath, {
        status: 'error',
        ...item,
        error: failure?.message || 'TTS failed after retries',
        failed_at: new Date().toISOString(),
      });
      console.error(`FAILED ${item.key}: ${failure?.message || 'unknown error'}`);
      continue;
    }

    const out = path.join(outputRoot, item.filename);
    const temp = `${out}.${process.pid}.part.wav`;
    fs.mkdirSync(outputRoot, { recursive: true });
    fs.writeFileSync(temp, audio);
    fs.renameSync(temp, out);
    const stats = wavInfo(audio);
    const generatedAt = new Date().toISOString();
    const meta = {
      model: MODEL,
      voice_name: VOICE_NAME,
      voice_id: voice.id,
      style: STYLE,
      text_sha256: item.text_sha256,
      interaction_id: interactionId,
      generated_at: generatedAt,
      active_audio_unchanged: true,
    };
    atomicWrite(`${out}.meta.json`, `${JSON.stringify(meta, null, 2)}\n`);
    appendJsonl(manifestPath, {
      status: 'ok',
      ...item,
      model: MODEL,
      voice_name: VOICE_NAME,
      voice_id: voice.id,
      interaction_id: interactionId,
      output: relative(out),
      ...stats,
      generated_at: generatedAt,
    });
    generated += 1;
    console.log(`  Saved ${path.basename(out)} (${stats.duration_sec.toFixed(2)} sec WAV)`);
  }

  const finalOwn = readJsonl(requestLedgerPath);
  const finalBody = readJsonl(BODY_LEDGER);
  const summary = {
    model: MODEL,
    voice_name: VOICE_NAME,
    quota_day_pt: quotaDay(),
    total_reviewed_items: work.length,
    complete: new Set(
      readJsonl(manifestPath)
        .filter((row) => row.status === 'ok')
        .map((row) => row.key),
    ).size,
    pending: pending.length - generated - failed,
    generated_this_run: generated,
    failed_this_run: failed,
    tts_post_attempts_this_run: requests,
    shared_tts_post_attempts_today: todayRequests([finalBody, finalOwn], quotaDay()),
    output_dir: relative(outputRoot),
    updated_at: new Date().toISOString(),
  };
  atomicWrite(path.join(outputRoot, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(
    `Finished: generated=${generated}, failed=${failed}, TTS POST attempts=${requests}, complete=${summary.complete}/${work.length}.`,
  );
  if (failed || summary.complete !== work.length) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
