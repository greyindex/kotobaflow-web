// Install the KotobaFlow 77-lesson curriculum (PUB-04) from its QA delivery folder.
//
//   node tools/install_kotobaflow_resources.cjs --from <Q>
//
// <Q> is local/qa/curriculum-ch00-audio-2026-10-04. Text data goes to
// data/textbook (Git LFS); Web audio goes to git-ignored candidate folders.
// WAV masters, receipts, ASR output and source snapshots are never copied.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const argIndex = process.argv.indexOf('--from');
const from = path.resolve(
  argIndex !== -1 ? process.argv[argIndex + 1] : path.join(root, 'local/qa/curriculum-ch00-audio-2026-10-04'),
);
const BOOKS = ['KotobaFlow1', 'KotobaFlow2', 'KotobaFlow3', 'KotobaFlow4'];
const READING_DIR = 'data/gemini38_flash_tts_kotobaflow_reading_candidate_v1';
const DIALOGUE_DIR = 'data/gemini38_flash_tts_kotobaflow_dialogue_candidate_v1';
const KANA_DIR = 'data/gemini38_flash_tts_kotobaflow_kana_candidate_v1';
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const copy = (src, dest) => {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
};
const need = (file) => {
  if (!fs.existsSync(file)) throw Error('Missing source file: ' + file);
  return file;
};

const manifest = JSON.parse(fs.readFileSync(need(path.join(from, 'compatible/manifest.json')), 'utf8'));
if (manifest.chapter_count !== 77 || manifest.books.map((b) => b.book_id).join() !== BOOKS.join())
  throw Error('Unexpected curriculum manifest');

// 1. Text data.
for (const book of BOOKS)
  copy(
    need(path.join(from, 'compatible', book + '.bundle.json')),
    path.join(root, 'data/textbook/canonical_books', book + '.bundle.json'),
  );
for (const file of ['textbook_text_chunks.v2.json', 'textbook_vocab_full.v3.json', 'manifest.json'])
  copy(need(path.join(from, 'compatible', file)), path.join(root, 'data/textbook/kotobaflow', file));

// 2. Section audio: OGG plus timing sidecar; manifest rows are rewritten to site paths.
function installSections(kind, targetDir) {
  const rows = fs
    .readFileSync(need(path.join(from, 'playback', kind, 'manifest.jsonl')), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
  const out = [];
  for (const row of rows) {
    if (row.status !== 'ok' || !BOOKS.includes(row.book)) throw Error('Unexpected audio row');
    const ogg = path.join(from, 'playback', row.output);
    if (sha256(need(ogg)) !== row.ogg_sha256) throw Error('Audio hash mismatch: ' + row.output);
    const rel = (value) => value.replace(new RegExp('^' + kind + '/'), '');
    copy(ogg, path.join(root, targetDir, rel(row.output)));
    copy(need(path.join(from, 'playback', row.manifest)), path.join(root, targetDir, rel(row.manifest)));
    out.push({
      status: 'ok',
      book: row.book,
      lesson_id: row.lesson_id,
      lesson_no: row.lesson_no,
      section_key: row.section_key,
      output: targetDir + '/' + rel(row.output),
      manifest: targetDir + '/' + rel(row.manifest),
      model: row.model,
      duration_sec: row.duration_sec,
      timing_mode: row.timing_mode,
      ogg_sha256: row.ogg_sha256,
      review_status: row.review_status,
    });
  }
  fs.writeFileSync(
    path.join(root, targetDir, 'manifest.jsonl'),
    out.map((row) => JSON.stringify(row)).join('\n') + '\n',
  );
  return out.length;
}
const reading = installSections('reading', READING_DIR);
const dialogue = installSections('dialogue', DIALOGUE_DIR);
if (reading !== 152 || dialogue !== 76) throw Error('Unexpected section count ' + reading + '/' + dialogue);

// 3. Chapter 0 kana and example clips.
const clips = JSON.parse(fs.readFileSync(need(path.join(from, 'audio/ch00/clips.json')), 'utf8'));
if (clips.clips.length !== 92) throw Error('Unexpected chapter 0 clip count');
const kana = clips.clips.map((clip) => {
  const src = path.join(from, 'audio/ch00', clip.audio_relpath);
  if (sha256(need(src)) !== clip.audio_sha256) throw Error('Clip hash mismatch: ' + clip.id);
  if (!/^clips\/C00-[KW][0-9]{2}\.ogg$/.test(clip.audio_relpath)) throw Error('Unexpected clip path');
  copy(src, path.join(root, KANA_DIR, clip.audio_relpath));
  return {
    id: clip.id,
    kind: clip.kind,
    source_text: clip.source_text,
    spoken_text: clip.spoken_text,
    audio_relpath: clip.audio_relpath,
    duration_sec: clip.duration_sec,
    status: clip.status,
    review_needed: !!clip.review_needed,
  };
});
fs.writeFileSync(
  path.join(root, KANA_DIR, 'clips.json'),
  JSON.stringify({ schema: 1, chapter: 0, model: clips.model, voice: clips.voice, clips: kana }),
);
console.log(JSON.stringify({ from, books: BOOKS.length, reading, dialogue, kanaClips: kana.length }));
