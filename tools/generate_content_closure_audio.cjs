#!/usr/bin/env node
'use strict';

// Reviewed follow-up recordings. Original candidates are immutable; this pack
// is applied only after its source hashes and dialogue alignment are verified.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const application = require('./generate_gemini_application_audio.cjs');
const dialogue = require('./generate_gemini_dialogue_full.cjs');
const ROOT = path.resolve(__dirname, '..');
const OUTPUT = 'data/gemini38_flash_tts_content_closure_candidate_v1';
const QA = 'local/qa/content-closure-2026-09-28';
const API = 'https://generativelanguage.googleapis.com/v1beta';
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/^\uFEFF/, ''));
const rows = (file) =>
  fs.existsSync(file)
    ? fs
        .readFileSync(file, 'utf8')
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/)
        .filter(Boolean)
        .map(JSON.parse)
    : [];
const keyText = (value) => value.normalize('NFKC').replace(/\s/g, '');
const day = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    `${file}.tmp`,
    typeof value === 'string' || Buffer.isBuffer(value) ? value : `${JSON.stringify(value, null, 2)}\n`,
  );
  fs.renameSync(`${file}.tmp`, file);
}
function append(file, row) {
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
}
function makePlan() {
  const preparation = read('local/qa/audio-update-2026-09-28/preparation.json');
  const lessons = new Map();
  const sources = {};
  for (let n = 1; n <= 4; n++) {
    const file = `data/textbook/canonical_books/XinBian${n}.bundle.json`;
    sources[file] = sha(fs.readFileSync(path.join(ROOT, file)));
    for (const { lesson } of read(file).items) lessons.set(`${lesson.book_id}|${lesson.item_id}`, lesson);
  }
  const jobs = [];
  for (const reading of preparation.readings) {
    const text = lessons.get(`${reading.book}|${reading.lesson_id}`)[reading.section_key].text;
    const paragraphs = text.split(/\n\s*\n/).filter((s) => s.trim());
    if (paragraphs.length !== reading.paragraphs.length)
      throw new Error(`Paragraph count changed: ${reading.output}`);
    for (let i = 0; i < paragraphs.length; i++) {
      const old = reading.paragraphs[i];
      if (keyText(old.text) === keyText(paragraphs[i])) continue;
      jobs.push({
        key: `reading/${reading.book}/${reading.lesson_id}/${reading.section_key}/p${i + 1}`,
        kind: 'reading',
        book: reading.book,
        lesson_id: reading.lesson_id,
        section_key: reading.section_key,
        paragraph_no: i + 1,
        text: paragraphs[i],
        before_text: old.text,
        model: old.model || old.model_id,
        voice_name: old.voice_name,
        voice_id: old.voice_id || old.voice_name,
        original: old.output,
      });
    }
  }
  for (const article of dialogue.getArticles()) {
    const original = `data/gemini38_flash_tts_dialogue_full_candidate_v1/${article.book}/${article.lesson_id}/source.json`;
    const before = read(original);
    if (article.turns.length !== before.turns.length) throw new Error(`Turn count changed: ${original}`);
    if (article.turns.every((t, i) => keyText(t.source_text) === keyText(before.turns[i].source_text)))
      continue;
    jobs.push({
      key: `dialogue/${article.book}/${article.lesson_id}`,
      kind: 'dialogue',
      book: article.book,
      lesson_id: article.lesson_id,
      model: 'gemini-3.8-flash-tts',
      source: article,
      original,
    });
  }
  const file = 'data/textbook/canonical_textbook_vocab/textbook_vocab_full.v3.json';
  const before = new Map(read(`${QA}/language-before.json`)[file].map((r) => [r.index, r]));
  const active = new Map(
    rows(path.join(ROOT, 'data/gcloud_chirp3_vocab6127_female_aoede_v1/manifest.jsonl')).map((r) => [
      r.index,
      r,
    ]),
  );
  sources[file] = sha(fs.readFileSync(path.join(ROOT, file)));
  for (const current of read(file)) {
    const old = before.get(current.index);
    if (!old || (old.word === current.word && old.reading_hiragana === current.reading_hiragana)) continue;
    const audio = active.get(current.index);
    if (
      !audio ||
      audio.textbook_uid !== current.textbook_uid ||
      ![old.word, current.word].includes(audio.word)
    )
      throw new Error(`Word identity drift: ${current.index}`);
    jobs.push({
      key: `word/textbook/${current.index}`,
      kind: 'word',
      scope: 'textbook',
      stable_index: current.index,
      word: current.word,
      before_word: old.word,
      before_reading: old.reading_hiragana,
      corrected_reading: current.reading_hiragana,
      text: `${current.reading_hiragana}。`,
      active_audio: audio.audio_relpath,
      textbook_uid: current.textbook_uid,
      model: 'gemini-3.8-flash-tts',
      voice_name: 'Concierge 7',
      voice_id: 'ja-jp-concierge-7',
    });
  }
  for (const job of jobs) {
    job.source_sha256 = sha(JSON.stringify(job));
    job.output = `${OUTPUT}/${job.key}/audio.wav`;
  }
  const followupFile = 'resources/quality/content-audio-followups-2026-09-28.json';
  if (fs.existsSync(path.join(ROOT, followupFile))) {
    const followups = read(followupFile);
    const frozen = fs.existsSync(path.join(ROOT, OUTPUT, 'plan.json'))
      ? read(`${OUTPUT}/plan.json`).jobs
      : [];
    sources[followupFile] = sha(fs.readFileSync(path.join(ROOT, followupFile)));
    for (const rule of followups.readings) {
      const text = lessons.get(`${rule.book}|${rule.lesson_id}`)[rule.section_key].text.split(/\n\s*\n/)[
        rule.paragraph_no - 1
      ];
      if (sha(text) !== rule.source_text_sha256)
        throw new Error(`Reviewed narration source changed: ${rule.supersedes}`);
      const original = preparation.readings.find(
        (r) => r.book === rule.book && r.lesson_id === rule.lesson_id && r.section_key === rule.section_key,
      ).paragraphs[rule.paragraph_no - 1];
      let spoken = text;
      for (const change of rule.replacements) {
        if (spoken.split(change.before).length - 1 !== change.count || change.count < 1)
          throw new Error(`Pronunciation span changed: ${rule.supersedes}`);
        spoken = spoken.split(change.before).join(change.after);
      }
      if (rule.literal_script_narration) spoken = spoken.replace(/:/g, '、').replace(/[()（）]/g, '、');
      if (rule.spoken_lines_only)
        spoken = spoken
          .split(/\r?\n/)
          .map((line) =>
            line
              .replace(/^[^:]{1,16}:/, '')
              .replace(/\([^)]*\)|（[^）]*）/g, '')
              .trim(),
          )
          .filter((line) => /[\p{L}\p{N}]/u.test(line))
          .join('\n');
      const job = {
        key: `${rule.supersedes}-reviewed`,
        kind: 'reading',
        book: rule.book,
        lesson_id: rule.lesson_id,
        section_key: rule.section_key,
        paragraph_no: rule.paragraph_no,
        text,
        spoken_text: spoken,
        style: rule.style,
        before_text: original.text,
        model: original.model || original.model_id,
        voice_name: original.voice_name,
        voice_id: original.voice_id || original.voice_name,
        original: original.output,
        supersedes: rule.supersedes,
        review_reason: rule.reason,
      };
      const index = jobs.findIndex((j) => j.key === rule.supersedes);
      const previous = frozen.find((j) => j.key === rule.supersedes) || rule.superseded_job;
      if (previous && rule.previous_source_sha256 !== previous.source_sha256)
        throw new Error(`Superseded recording identity changed: ${rule.supersedes}`);
      // Keep a previously generated input immutable even when its reviewed
      // replacement also fixes the source spelling. Only the new job is applied.
      if (index >= 0 && previous) jobs[index] = previous;
      job.source_sha256 = sha(JSON.stringify(job));
      job.output = `${OUTPUT}/${job.key}/audio.wav`;
      jobs.push(job);
    }
    for (const rule of followups.dialogue_fragments || []) {
      const parent = jobs.find((job) => job.key === `dialogue/${rule.book}/${rule.lesson_id}`);
      if (!parent || parent.source_sha256 !== rule.parent_source_sha256)
        throw new Error(`Dialogue refinement source changed: ${rule.book}/${rule.lesson_id}`);
      const turns = parent.source.turns.filter((turn) => rule.turn_ids.includes(turn.turn_id));
      if (turns.length !== rule.turn_ids.length || turns.some((turn) => !turn.speech_text))
        throw new Error('Dialogue refinement must contain existing spoken turns');
      const job = {
        key: `dialogue-fragment/${rule.book}/${rule.lesson_id}/${rule.turn_ids.join('-')}`,
        kind: 'dialogue_fragment',
        book: rule.book,
        lesson_id: rule.lesson_id,
        model: parent.model,
        source: { ...parent.source, turns },
        review_reason: rule.reason,
      };
      job.source_sha256 = sha(JSON.stringify(job));
      job.output = `${OUTPUT}/${job.key}/audio.wav`;
      jobs.push(job);
    }
  }
  return { schema: 1, sources, jobs };
}
function transport(model) {
  return model.startsWith('gemini-2.5')
    ? 'generate-content'
    : model.startsWith('gemini-3.1')
      ? 'interactions-pcm'
      : 'interactions-wav';
}
function makeRequest(job) {
  if (job.kind === 'dialogue' || job.kind === 'dialogue_fragment')
    return { url: `${API}/interactions`, body: dialogue.requestBody(job.source) };
  const model = { id: job.model, transport: transport(job.model), voiceName: job.voice_name };
  const spokenJob = { ...job, text: job.spoken_text || job.text };
  const body =
    model.transport === 'generate-content'
      ? application.makeGenerateContentPayload(model, spokenJob)
      : application.makeInteractionPayload(model, spokenJob, job.voice_id);
  if (job.style && model.transport === 'interactions-wav')
    body.input[0].content[0].annotations[0].style += ` ${job.style}`;
  return {
    url:
      model.transport === 'generate-content'
        ? `${API}/models/${job.model}:generateContent`
        : `${API}/interactions`,
    body,
  };
}
function quotaCounts() {
  const counts = new Map();
  for (const entry of fs.readdirSync(path.join(ROOT, 'data'), { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('gemini')) continue;
    for (const row of rows(path.join(ROOT, 'data', entry.name, 'request_ledger.jsonl'))) {
      const key = `${row.quota_day_pt}|${row.model || 'gemini-3.8-flash-tts'}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return counts;
}
function validSaved(job) {
  const file = path.join(ROOT, job.output);
  const receipt = `${file}.json`;
  if (!fs.existsSync(receipt)) return false;
  const saved = JSON.parse(fs.readFileSync(receipt, 'utf8'));
  if (saved.source_sha256 !== job.source_sha256) throw new Error(`Candidate source changed: ${job.key}`);
  for (const [suffix, field] of [
    ['.wav', 'wav_sha256'],
    ['.ogg', 'ogg_sha256'],
  ]) {
    const audio = file.replace(/\.wav$/, suffix);
    if (!fs.existsSync(audio) || sha(fs.readFileSync(audio)) !== saved[field])
      throw new Error(`Candidate audio changed: ${job.key}`);
  }
  return true;
}
async function run(plan, waitForReset) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is required');
  const output = path.join(ROOT, OUTPUT);
  fs.mkdirSync(output, { recursive: true });
  const ledger = path.join(output, 'request_ledger.jsonl');
  const manifest = path.join(output, 'manifest.jsonl');
  const deferredFile = path.join(output, 'deferred.json');
  const deferred = fs.existsSync(deferredFile) ? JSON.parse(fs.readFileSync(deferredFile, 'utf8')) : {};
  const counts = quotaCounts();
  const blocked = new Set();
  let lastStart = Date.now() - 15500;
  let pending = plan.jobs
    .filter((job) => !validSaved(job) && !deferred[job.key])
    .sort(
      (a, b) =>
        ['dialogue', 'word', 'reading'].indexOf(a.kind) - ['dialogue', 'word', 'reading'].indexOf(b.kind),
    );
  const attempts = new Map();
  while (pending.length) {
    const today = day();
    const index = pending.findIndex(
      (job) =>
        !blocked.has(`${today}|${job.model}`) &&
        (counts.get(`${today}|${job.model}`) || 0) < (job.model.includes('2.5-pro') ? 45 : 90),
    );
    if (index < 0) {
      console.log(`Quota pause: ${pending.length} jobs remain for original models; day ${today} PT`);
      if (!waitForReset) {
        process.exitCode = 2;
        return;
      }
      await sleep(60000);
      continue;
    }
    const job = pending[index];
    await sleep(Math.max(0, lastStart + 15500 - Date.now()));
    lastStart = Date.now();
    const quotaKey = `${day()}|${job.model}`;
    const count = (counts.get(quotaKey) || 0) + 1;
    counts.set(quotaKey, count);
    append(ledger, {
      quota_day_pt: day(),
      model: job.model,
      key: job.key,
      source_sha256: job.source_sha256,
      started_at: new Date().toISOString(),
    });
    console.log(`POST ${count} ${job.model}: ${job.key}`);
    try {
      const request = makeRequest(job);
      const response = await fetch(request.url, {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
        body: JSON.stringify(request.body),
        signal: AbortSignal.timeout(300000),
      });
      const payload = await response.json();
      if (!response.ok) {
        if (response.status === 429) blocked.add(quotaKey);
        const reason = JSON.stringify(payload.error || payload)
          .split(apiKey)
          .join('[redacted]')
          .slice(0, 1200);
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          deferred[job.key] = { status: response.status, reason, at: new Date().toISOString() };
          write(deferredFile, deferred);
          pending.splice(index, 1);
        }
        throw new Error(`TTS HTTP ${response.status}: ${reason}`);
      }
      const audio = application.extractAudio(payload, transport(job.model));
      const wav = application.normalizeWav(audio, { id: job.model });
      const target = path.join(ROOT, job.output);
      write(target, wav);
      const ogg = target.replace(/\.wav$/, '.ogg');
      execFileSync(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-i',
          target,
          '-ar',
          '24000',
          '-ac',
          '1',
          '-c:a',
          'libopus',
          '-b:a',
          '20k',
          '-vbr',
          'on',
          '-application',
          'voip',
          '-frame_duration',
          '60',
          '-map_metadata',
          '-1',
          ogg,
        ],
        { windowsHide: true },
      );
      const seconds = Number(
        execFileSync(
          'ffprobe',
          [
            '-v',
            'error',
            '-show_entries',
            'format=duration',
            '-of',
            'default=noprint_wrappers=1:nokey=1',
            target,
          ],
          { encoding: 'utf8', windowsHide: true },
        ),
      );
      if (!(seconds > 0)) throw new Error('Invalid audio duration');
      const result = {
        ...job,
        status: 'ok',
        duration_sec: seconds,
        wav_sha256: sha(wav),
        ogg_sha256: sha(fs.readFileSync(ogg)),
        generated_at: new Date().toISOString(),
      };
      write(`${target}.json`, result);
      if (job.source) write(path.join(path.dirname(target), 'source.json'), job.source);
      append(manifest, result);
      pending.splice(index, 1);
      console.log(`Saved ${job.key}: ${seconds.toFixed(2)}s; ${pending.length} remaining`);
    } catch (error) {
      const attempt = (attempts.get(job.key) || 0) + 1;
      attempts.set(job.key, attempt);
      console.error(`${job.key}: ${error.message}`);
      append(manifest, {
        key: job.key,
        status: 'error',
        message: error.message,
        at: new Date().toISOString(),
      });
      if (attempt >= 3 && !blocked.has(quotaKey)) throw new Error(`Three failed attempts: ${job.key}`);
      await sleep(30000);
    }
  }
  const complete = plan.jobs.filter(validSaved).length;
  console.log(
    `Run finished: ${complete}/${plan.jobs.length} verified candidate recordings; ${Object.keys(deferred).length} deferred.`,
  );
  if (complete < plan.jobs.length) process.exitCode = 2;
}
async function main() {
  const args = new Set(process.argv.slice(2));
  for (const arg of args)
    if (!['--run', '--wait-for-reset', '--dry-run'].includes(arg)) throw new Error(`Unknown argument ${arg}`);
  const plan = makePlan();
  const planFile = path.join(ROOT, OUTPUT, 'plan.json');
  if (fs.existsSync(planFile)) {
    const previous = read(`${OUTPUT}/plan.json`);
    const currentByKey = new Map(plan.jobs.map((job) => [job.key, job]));
    if (previous.jobs.some((job) => JSON.stringify(currentByKey.get(job.key)) !== JSON.stringify(job)))
      throw new Error('Frozen recording inputs changed');
    const added = plan.jobs.filter((job) => !previous.jobs.some((old) => old.key === job.key));
    if (added.length)
      append(path.join(ROOT, OUTPUT, 'plan_additions.jsonl'), {
        added: added.map((job) => ({ key: job.key, source_sha256: job.source_sha256 })),
        existing_recording_inputs_unchanged: true,
        at: new Date().toISOString(),
      });
    if (JSON.stringify(previous.sources) !== JSON.stringify(plan.sources))
      append(path.join(ROOT, OUTPUT, 'source_metadata_revisions.jsonl'), {
        before: previous.sources,
        after: plan.sources,
        recording_inputs_unchanged: true,
        at: new Date().toISOString(),
      });
  }
  write(planFile, plan);
  console.log(
    JSON.stringify(
      {
        jobs: plan.jobs.length,
        kinds: Object.fromEntries(
          ['reading', 'dialogue', 'word'].map((kind) => [
            kind,
            plan.jobs.filter((j) => j.kind === kind).length,
          ]),
        ),
        models: Object.fromEntries(
          [...new Set(plan.jobs.map((j) => j.model))].map((model) => [
            model,
            plan.jobs.filter((j) => j.model === model).length,
          ]),
        ),
      },
      null,
      2,
    ),
  );
  if (args.has('--run')) await run(plan, args.has('--wait-for-reset'));
}
module.exports = { makePlan, makeRequest, quotaCounts, transport, validSaved };
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
