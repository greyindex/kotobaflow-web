#!/usr/bin/env node
'use strict';

// Controlled article experiments: named characters share two Gemini voice roles.
// Keep this separate from the active audio pipeline until text and timing QA pass.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
}

const BOOK = argument('--book', 'XinBian1');
const LESSON = argument('--lesson', 'lesson_02');
if (!/^XinBian[1-4]$/.test(BOOK) || !/^(lesson_\d{2}|review_unit_\d{2})$/.test(LESSON)) {
  throw new Error('Invalid book or lesson ID.');
}
if (!new Set(['XinBian1/lesson_02', 'XinBian2/lesson_10']).has(`${BOOK}/${LESSON}`)) {
  throw new Error('This experiment is limited to the two reviewed pilot articles.');
}
const MODEL = 'gemini-3.8-flash-tts';
const VOICES = { M: 'Charon', F: 'Aoede' };
const OUTPUT = path.join(ROOT, 'data/gemini38_flash_tts_dialogue_candidate_v1', BOOK, LESSON);
const LEDGER = path.join(ROOT, 'data/gemini38_flash_tts_dialogue_candidate_v1/request_ledger.jsonl');
const WAV = path.join(OUTPUT, 'whole_conversation.wav');
const OGG = path.join(OUTPUT, 'whole_conversation.ogg');
const META = path.join(OUTPUT, 'source.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function quotaDay(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function ledgerCount(file, day) {
  if (!fs.existsSync(file)) return 0;
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((row) => row.quota_day_pt === day).length;
}

function source() {
  const bundle = readJson(path.join(ROOT, `data/textbook/canonical_books/${BOOK}.bundle.json`));
  const lesson = bundle.items.find((item) => item.lesson?.item_id === LESSON)?.lesson;
  const current = lesson?.conversation?.dialogue;
  const referenceDir = path.join(ROOT, `data/gcloud_chirp3_dialogue_sections_v1/${BOOK}`);
  const matches = fs.readdirSync(referenceDir).filter((name) => name.endsWith(`_${LESSON}`));
  if (matches.length !== 1) throw new Error(`Expected one old dialogue source for ${BOOK}/${LESSON}.`);
  const old = readJson(path.join(referenceDir, matches[0], 'conversation/source_turns.json'));
  if (!Array.isArray(current) || !current.length || current.length !== old.length) {
    throw new Error('Unexpected dialogue size; source needs review before recording.');
  }
  const turns = current.map((turn, index) => {
    const ref = old[index];
    if (
      turn.turn_id !== ref.turn_id ||
      turn.speaker !== ref.speaker ||
      turn.text !== ref.text ||
      !VOICES[ref.voice_role]
    ) {
      throw new Error(`Source mismatch at ${turn.turn_id}; review the dialogue before recording.`);
    }
    return { turn_id: turn.turn_id, speaker: turn.speaker, voice_role: ref.voice_role, text: turn.text };
  });
  return {
    book: BOOK,
    lesson_id: LESSON,
    turns,
    text_sha256: crypto.createHash('sha256').update(JSON.stringify(turns)).digest('hex'),
  };
}

async function main() {
  const item = source();
  const day = quotaDay();
  const bodyLedger = path.join(ROOT, 'data/gemini38_flash_tts_body_v1/request_ledger.jsonl');
  const vocabLedger = path.join(
    ROOT,
    'data/gemini38_flash_tts_vocab_repairs_candidate_v1/request_ledger.jsonl',
  );
  const count = [bodyLedger, vocabLedger, LEDGER].reduce((sum, file) => sum + ledgerCount(file, day), 0);
  const people = new Set(item.turns.map((turn) => turn.speaker)).size;
  console.log(
    `${BOOK}/${LESSON}: ${item.turns.length} turns; ${people} named people; 2 voices; ${count} logged ${MODEL} POSTs today (PT).`,
  );
  if (process.argv.includes('--dry-run')) return;
  if (fs.existsSync(WAV)) throw new Error('Pilot WAV already exists; refusing to spend quota again.');
  if (count >= 90) throw new Error('Shared 90-request daily safety cap reached.');
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is required.');

  const body = {
    model: MODEL,
    input: [
      {
        type: 'user_input',
        content: item.turns.map((turn) => ({
          type: 'text',
          text: turn.text,
          annotations: [
            {
              type: 'speech_metadata',
              speaker: turn.voice_role,
              style: 'Clear standard Japanese, natural conversational pace.',
            },
          ],
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
  fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
  fs.appendFileSync(
    LEDGER,
    `${JSON.stringify({
      quota_day_pt: day,
      started_at: new Date().toISOString(),
      model: MODEL,
      book: BOOK,
      lesson_id: LESSON,
    })}\n`,
  );
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300000),
  });
  const payload = await response.json();
  if (!response.ok)
    throw new Error(
      `Gemini HTTP ${response.status}: ${JSON.stringify(payload.error || payload).slice(0, 500)}`,
    );
  const base64 =
    payload.output_audio?.data ||
    [...(payload.steps || [])]
      .reverse()
      .flatMap((step) => [...(step.content || [])].reverse())
      .find((part) => part.type === 'audio')?.data;
  if (!base64) throw new Error('Gemini returned no audio.');
  const wav = Buffer.from(base64, 'base64');
  if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error('Gemini returned invalid WAV data.');
  fs.mkdirSync(OUTPUT, { recursive: true });
  fs.writeFileSync(WAV, wav);
  execFileSync('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    WAV,
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
    OGG,
  ]);
  fs.writeFileSync(
    META,
    `${JSON.stringify(
      {
        ...item,
        model: MODEL,
        voices: VOICES,
        wav_bytes: wav.length,
        interaction_id: payload.id || null,
        generated_at: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Saved ${WAV} and ${OGG}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
