#!/usr/bin/env node
'use strict';

// Generate one complete Gemini 3.8 Flash TTS candidate per canonical dialogue.
// This stage deliberately does not run Whisper or change the active audio index.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'data/gemini38_flash_tts_dialogue_full_candidate_v1');
const MODEL = 'gemini-3.8-flash-tts';
const VOICES = { M: 'Charon', F: 'Aoede' };
const STYLE = 'Clear standard Japanese, natural conversational pace.';
const API = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const LEDGER = path.join(OUTPUT, 'request_ledger.jsonl');
const MANIFEST = path.join(OUTPUT, 'manifest.jsonl');
const DAILY_CAP = 90;

function options(argv) {
  const result = { dryRun: false, limit: null, ratePerMinute: 4, dailyCap: DAILY_CAP };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') result.dryRun = true;
    else if (['--limit', '--rate-per-minute', '--daily-cap'].includes(arg)) {
      const value = Number(argv[++index]);
      if (!Number.isInteger(value) || value < 1) throw new Error(`${arg} needs a positive integer`);
      if (arg === '--limit') result.limit = value;
      else if (arg === '--rate-per-minute') result.ratePerMinute = value;
      else result.dailyCap = value;
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (result.ratePerMinute > 4) throw new Error('Rate cannot exceed 4 requests/minute.');
  if (result.dailyCap > DAILY_CAP) throw new Error(`Daily safety cap cannot exceed ${DAILY_CAP}.`);
  return result;
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
    .map((line) => JSON.parse(line));
}

function appendJsonl(file, row) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`, 'utf8');
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temp, file);
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function quotaDay(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function isStageSpeaker(speaker) {
  return !speaker || /^(?:状況|ト書き|場面|ナレーター)/u.test(speaker);
}

function spokenText(book, lessonId, turn) {
  if (isStageSpeaker(turn.speaker)) return { text: '', notes: ['non_spoken_speaker'] };
  let text = turn.text.trim();
  const notes = [];
  // Leading parentheticals in this corpus are scene/action directions.
  while (/^(?:\([^()]*\)|（[^（）]*）)\s*/u.test(text)) {
    text = text.replace(/^(?:\([^()]*\)|（[^（）]*）)\s*/u, '').trimStart();
    notes.push('leading_direction_removed');
  }
  // A parenthetical immediately after sentence punctuation is a stage action.
  const afterSentence = text.replace(/([。！？!?])\s*(?:\([^()]*\)|（[^（）]*）)/gu, '$1');
  if (afterSentence !== text) notes.push('inter_sentence_direction_removed');
  text = afterSentence;
  const key = `${book}/${lessonId}/${turn.turn_id}`;
  const directRemovals = {
    'XinBian2/review_unit_03/t030': /^来客への応対\s*/u,
    'XinBian2/review_unit_03/t042': /^電話をかける\s*/u,
    'XinBian2/review_unit_03/t055': /^電話を受ける\s*/u,
    'XinBian3/lesson_07/t023': /\(薇\)/u,
    'XinBian4/lesson_07/t006': /\(ホステスの名前\)/u,
    'XinBian4/lesson_18/t003': /\(笑い\)/u,
  };
  if (directRemovals[key]) {
    const revised = text.replace(directRemovals[key], '');
    if (revised !== text) notes.push('reviewed_inline_direction_removed');
    text = revised;
  }
  text = text.trim();
  if (!text) notes.push('no_spoken_text');
  return { text, notes };
}

function getArticles() {
  const articles = [];
  for (const book of ['XinBian1', 'XinBian2', 'XinBian3', 'XinBian4']) {
    const bundle = readJson(path.join(ROOT, `data/textbook/canonical_books/${book}.bundle.json`));
    const referenceDir = path.join(ROOT, `data/gcloud_chirp3_dialogue_sections_v1/${book}`);
    const sourceDirs = fs.readdirSync(referenceDir);
    for (const item of bundle.items) {
      const lesson = item.lesson;
      const dialogue = lesson?.conversation?.dialogue;
      if (!Array.isArray(dialogue) || !dialogue.length) continue;
      const lessonId = lesson.item_id;
      const matches = sourceDirs.filter((name) => name.endsWith(`_${lessonId}`));
      if (matches.length !== 1) throw new Error(`${book}/${lessonId}: expected one Chirp3 source`);
      const reference = readJson(path.join(referenceDir, matches[0], 'conversation/source_turns.json'));
      if (reference.length !== dialogue.length) throw new Error(`${book}/${lessonId}: turn count changed`);
      const turns = dialogue.map((turn, index) => {
        const old = reference[index];
        if (turn.turn_id !== old.turn_id || turn.speaker !== old.speaker || !VOICES[old.voice_role]) {
          throw new Error(`${book}/${lessonId}/${turn.turn_id}: turn identity or voice role changed`);
        }
        const spoken = spokenText(book, lessonId, turn);
        return {
          turn_id: turn.turn_id,
          speaker: turn.speaker,
          voice_role: old.voice_role,
          source_text: turn.text,
          speech_text: spoken.text,
          notes: spoken.notes,
        };
      });
      const audible = turns.filter((turn) => turn.speech_text);
      if (!audible.length || new Set(audible.map((turn) => turn.voice_role)).size !== 2) {
        throw new Error(`${book}/${lessonId}: expected audible male and female turns`);
      }
      const sourceSha = hash(JSON.stringify({ model: MODEL, voices: VOICES, style: STYLE, turns }));
      articles.push({
        book,
        lesson_id: lessonId,
        lesson_title: lesson.title || null,
        turn_count: turns.length,
        audible_turn_count: audible.length,
        speech_chars: audible.reduce((sum, turn) => sum + [...turn.speech_text].length, 0),
        source_sha256: sourceSha,
        turns,
      });
    }
  }
  if (articles.length !== 75) throw new Error(`Expected 75 dialogues; found ${articles.length}`);
  return articles;
}

function articlePaths(article) {
  const dir = path.join(OUTPUT, article.book, article.lesson_id);
  return {
    wav: path.join(dir, 'whole_conversation.wav'),
    ogg: path.join(dir, 'whole_conversation.ogg'),
    source: path.join(dir, 'source.json'),
    meta: path.join(dir, 'meta.json'),
  };
}

function audioDuration(file) {
  if (!fs.existsSync(file)) return null;
  try {
    const result = execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file],
      { encoding: 'utf8' },
    );
    const seconds = Number(result.trim());
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  } catch {
    return null;
  }
}

function encodeOgg(wav, ogg) {
  const temp = `${ogg}.${process.pid}.part.ogg`;
  execFileSync('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    wav,
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
    temp,
  ]);
  fs.renameSync(temp, ogg);
  if (!audioDuration(ogg)) throw new Error(`Encoded OGG invalid: ${ogg}`);
}

function extractAudio(payload) {
  const base64 =
    payload.output_audio?.data ||
    [...(payload.steps || [])]
      .reverse()
      .flatMap((step) => [...(step.content || [])].reverse())
      .find((part) => part.type === 'audio')?.data;
  if (!base64) throw new Error('Gemini response has no audio block');
  const buffer = Buffer.from(base64, 'base64');
  if (
    buffer.length < 44 ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WAVE'
  )
    throw new Error('Gemini returned invalid WAV');
  return buffer;
}

function requestBody(article) {
  return {
    model: MODEL,
    input: [
      {
        type: 'user_input',
        content: article.turns
          .filter((turn) => turn.speech_text)
          .map((turn) => ({
            type: 'text',
            text: turn.speech_text,
            annotations: [{ type: 'speech_metadata', speaker: turn.voice_role, style: STYLE }],
          })),
      },
    ],
    response_format: { type: 'audio' },
    generation_config: {
      speech_config: {
        mode: 'conversational',
        speakers: [
          { speaker: 'M', voice: VOICES.M },
          { speaker: 'F', voice: VOICES.F },
        ],
      },
    },
  };
}

async function sleep(ms) {
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const opts = options(process.argv.slice(2));
  const articles = getArticles();
  const skippedTurns = articles.reduce((sum, row) => sum + row.turn_count - row.audible_turn_count, 0);
  const editedTurns = articles.reduce(
    (sum, row) =>
      sum + row.turns.filter((turn) => turn.speech_text && turn.speech_text !== turn.source_text).length,
    0,
  );
  const allChars = articles.reduce((sum, row) => sum + row.speech_chars, 0);
  console.log(
    `Source verified: ${articles.length} dialogues, ${articles.reduce((sum, row) => sum + row.turn_count, 0)} turns; ${skippedTurns} non-spoken turns; ${editedTurns} speech-text edits; ${allChars} speech chars.`,
  );

  const pending = [];
  for (const article of articles) {
    const paths = articlePaths(article);
    const prior = fs.existsSync(paths.source) ? readJson(paths.source) : null;
    if (prior && prior.source_sha256 !== article.source_sha256) {
      throw new Error(
        `${article.book}/${article.lesson_id}: saved source hash differs from current canonical text; inspect before resuming`,
      );
    }
    const wavDuration = audioDuration(paths.wav);
    const oggDuration = audioDuration(paths.ogg);
    if (prior && wavDuration && oggDuration) continue;
    pending.push({ article, paths, wavDuration, oggDuration });
  }
  const selected = opts.limit ? pending.slice(0, opts.limit) : pending;
  console.log(
    `Complete: ${articles.length - pending.length}/75; pending: ${pending.length}; selected: ${selected.length}; output: ${path.relative(ROOT, OUTPUT)}`,
  );
  if (opts.dryRun) {
    const longest = [...articles].sort((a, b) => b.speech_chars - a.speech_chars)[0];
    console.log(
      `Dry run passed. Longest speech: ${longest.book}/${longest.lesson_id} (${longest.speech_chars} chars).`,
    );
    for (const article of articles) {
      for (const turn of article.turns) {
        if (turn.speech_text !== turn.source_text) {
          console.log(
            `${article.book}/${article.lesson_id}/${turn.turn_id} [${turn.notes.join(',')}]: ${JSON.stringify(turn.source_text)} -> ${JSON.stringify(turn.speech_text)}`,
          );
        }
      }
    }
    return;
  }
  if (!selected.length) return;
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('Set GEMINI_API_KEY or GOOGLE_API_KEY in the process environment.');
  const trackedLedgers = [
    path.join(ROOT, 'data/gemini38_flash_tts_body_v1/request_ledger.jsonl'),
    path.join(ROOT, 'data/gemini38_flash_tts_vocab_repairs_candidate_v1/request_ledger.jsonl'),
    path.join(ROOT, 'data/gemini38_flash_tts_dialogue_candidate_v1/request_ledger.jsonl'),
    LEDGER,
  ];
  const entries = trackedLedgers.flatMap(readJsonl);
  let lastStarted = Math.max(0, ...entries.map((row) => Date.parse(row.started_at) || 0));
  const dailyCounts = new Map();
  for (const row of entries) {
    if (row.quota_day_pt && (!row.model || row.model === MODEL)) {
      dailyCounts.set(row.quota_day_pt, (dailyCounts.get(row.quota_day_pt) || 0) + 1);
    }
  }
  const spacingMs = Math.ceil(60000 / opts.ratePerMinute) + 500;
  let completed = 0;
  let failed = 0;
  let quotaStop = false;

  for (const { article, paths, wavDuration, oggDuration } of selected) {
    const key = `${article.book}/${article.lesson_id}`;
    try {
      writeJson(paths.source, article);
      if (wavDuration) {
        if (!oggDuration) encodeOgg(paths.wav, paths.ogg);
        const seconds = audioDuration(paths.wav);
        writeJson(paths.meta, {
          status: 'ok',
          recovered: true,
          source_sha256: article.source_sha256,
          model: MODEL,
          voices: VOICES,
          duration_sec: seconds,
        });
        appendJsonl(MANIFEST, {
          status: 'ok',
          recovered: true,
          book: article.book,
          lesson_id: article.lesson_id,
          source_sha256: article.source_sha256,
          duration_sec: seconds,
        });
        completed += 1;
        console.log(`[${completed}/${selected.length}] ${key} recovered from WAV`);
        continue;
      }
      const body = requestBody(article);
      let audio;
      let interactionId = null;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const day = quotaDay();
        const count = dailyCounts.get(day) || 0;
        if (count >= opts.dailyCap) {
          quotaStop = true;
          throw new Error(`Daily safety cap ${opts.dailyCap} reached for ${day} PT`);
        }
        await sleep(Math.max(0, lastStarted + spacingMs - Date.now()));
        lastStarted = Date.now();
        dailyCounts.set(day, count + 1);
        appendJsonl(LEDGER, {
          quota_day_pt: day,
          started_at: new Date(lastStarted).toISOString(),
          model: MODEL,
          book: article.book,
          lesson_id: article.lesson_id,
          source_sha256: article.source_sha256,
          attempt,
        });
        console.log(
          `[POST ${count + 1}/${opts.dailyCap} PT] ${key} attempt ${attempt}; ${article.audible_turn_count} turns, ${article.speech_chars} chars`,
        );
        let response;
        try {
          response = await fetch(API, {
            method: 'POST',
            headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(300000),
          });
        } catch (error) {
          if (attempt === 2) throw error;
          await sleep(30000);
          continue;
        }
        const payload = await response.json();
        if (response.ok) {
          try {
            audio = extractAudio(payload);
            interactionId = payload.id || null;
            break;
          } catch (error) {
            if (attempt === 2) throw error;
            await sleep(30000);
            continue;
          }
        }
        const reason = JSON.stringify(payload.error || payload).slice(0, 500);
        if (attempt === 2 || (response.status !== 429 && response.status < 500)) {
          throw new Error(`HTTP ${response.status}: ${reason}`);
        }
        const retryAfter = Number(response.headers.get('retry-after'));
        await sleep(
          Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.max(30000, retryAfter * 1000)
            : 30000 * attempt,
        );
      }
      if (!audio) throw new Error('No audio after retry loop');
      fs.mkdirSync(path.dirname(paths.wav), { recursive: true });
      const wavTemp = `${paths.wav}.${process.pid}.part.wav`;
      fs.writeFileSync(wavTemp, audio);
      if (!audioDuration(wavTemp)) throw new Error('Saved WAV does not decode');
      fs.renameSync(wavTemp, paths.wav);
      encodeOgg(paths.wav, paths.ogg);
      const seconds = audioDuration(paths.wav);
      writeJson(paths.meta, {
        status: 'ok',
        source_sha256: article.source_sha256,
        model: MODEL,
        voices: VOICES,
        style: STYLE,
        duration_sec: seconds,
        wav_bytes: audio.length,
        interaction_id: interactionId,
        generated_at: new Date().toISOString(),
      });
      appendJsonl(MANIFEST, {
        status: 'ok',
        book: article.book,
        lesson_id: article.lesson_id,
        source_sha256: article.source_sha256,
        duration_sec: seconds,
        output_wav: path.relative(ROOT, paths.wav),
        output_ogg: path.relative(ROOT, paths.ogg),
      });
      completed += 1;
      console.log(`[${completed}/${selected.length}] ${key} saved; ${seconds.toFixed(2)}s`);
    } catch (error) {
      failed += 1;
      appendJsonl(MANIFEST, {
        status: 'error',
        book: article.book,
        lesson_id: article.lesson_id,
        source_sha256: article.source_sha256,
        message: String(error.message).slice(0, 500),
        at: new Date().toISOString(),
      });
      console.error(`${key}: ${error.message}`);
      if (quotaStop) break;
    }
  }
  console.log(
    `Run complete: ${completed} saved/recovered; ${failed} failed; ${quotaStop ? 'daily cap reached' : 'daily cap available'}.`,
  );
  if (failed || quotaStop) process.exitCode = 1;
}

module.exports = { getArticles, requestBody, extractAudio };
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
