#!/usr/bin/env node
// Builds the Japanese classics reader data (CLASSICS-01) from
// the JapaneseClassics library: one small index per work, one JSON file per
// part (帖 / 卷 / 篇 / 节) and the two narrated works' MP3 with their timelines.
//
//   node tools/build_classics_library.cjs --source C:\code\JapaneseClassics
//
// Output goes to the ignored data/classics_v1/ (AI translation drafts and
// generated narration stay out of Git). Public releases copy JSON and use R2
// for narration. The corpus and
// audio hashes listed in the library's catalog.json are verified first.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUT = path.join(ROOT, 'data', 'classics_v1');
const SCHEMA = 1;

// Section names for 竹取物語's nine sections, in the order of the corpus
// `section` numbers. Each was checked against the section's opening text.
const TAKETORI_SECTIONS = [
  'かぐや姫の生い立ち',
  '貴公子たちの求婚',
  '仏の御石の鉢',
  '蓬莱の玉の枝',
  '火鼠の皮衣',
  '龍の首の珠',
  '燕の子安貝',
  '御門の求婚',
  'かぐや姫の昇天',
];

// Reading order: by period. `noun` names a part in the reader's labels.
const BOOKS = [
  {
    id: 'taketori',
    title: '竹取物语',
    titleJa: '竹取物語',
    noun: '节',
    corpus: 'audio/taketori/corpus.json',
    license: '公有领域（维基文库转录）',
  },
  {
    id: 'ise',
    title: '伊势物语',
    titleJa: '伊勢物語',
    noun: '部分',
    corpus: 'texts/ise/corpus.json',
    license: '公有领域（维基文库转录）',
  },
  {
    id: 'genji',
    title: '源氏物语',
    titleJa: '源氏物語',
    noun: '帖',
    corpus: 'texts/genji/corpus.json',
    license: 'CC0-1.0（TEI 本文数据）',
  },
  {
    id: 'heike',
    title: '平家物语',
    titleJa: '平家物語',
    noun: '卷',
    corpus: 'texts/heike/corpus.json',
    license: '公有领域（国立国会图书馆 PDM）',
  },
  {
    id: 'taiheiki',
    title: '太平记',
    titleJa: '太平記',
    noun: '卷',
    corpus: 'texts/taiheiki/corpus.json',
    license: '公有领域（维基文库转录）',
  },
  {
    id: 'otogi',
    title: '御伽草子',
    titleJa: '御伽草子',
    noun: '篇',
    corpus: 'texts/otogi/corpus.json',
    license: '公有领域（国立国会图书馆 PDM）',
  },
];

// 伊勢物語 (塗籠本, 115 段): an episode opens with むかし／昔. The reader shows
// ten episodes per part with each episode headed inside it.
const ISE_EPISODE_START = /^(?:むかし|昔)/;
const ISE_EPISODES_PER_PART = 10;

const CN_DIGITS = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

// 1–99 in the form shared by Chinese and Japanese (十一, 二十, 五十四).
function smallNumeral(n) {
  if (n < 10) return CN_DIGITS[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return (tens > 1 ? CN_DIGITS[tens] : '') + '十' + (ones ? CN_DIGITS[ones] : '');
}

// Japanese episode numbers: 百十五, not 一百一十五.
function japaneseNumeral(n) {
  if (n < 100) return smallNumeral(n);
  const rest = n % 100;
  return (n >= 200 ? CN_DIGITS[Math.floor(n / 100)] : '') + '百' + (rest ? smallNumeral(rest) : '');
}

function codePoints(text) {
  return Array.from(String(text || '')).length;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value) + '\n');
}

function args(argv) {
  const out = { source: process.env.JP_CLASSICS_SOURCE || '', out: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--source') out.source = argv[++i] || '';
    else if (argv[i] === '--out') out.out = path.resolve(argv[++i] || '');
    else if (argv[i] === '--help' || argv[i] === '-h') out.help = true;
    else throw new Error('Unknown argument: ' + argv[i]);
  }
  return out;
}

function unitRecord(unit) {
  const record = {
    id: unit.id,
    original: unit.original_ja || '',
    modern: unit.modern_ja || '',
    zh: unit.zh_cn || '',
  };
  const notes = (unit.notes || []).filter((note) => typeof note === 'string' && note.trim());
  if (notes.length) record.notes = notes;
  return record;
}

// Parts in reading order: [{label, title, units: [corpus unit]}]. Episode
// numbers (伊勢物語) go to `episodes`, keyed by the unit that opens each one.
function groupParts(book, units, episodes) {
  if (book.id === 'taketori') {
    const parts = [];
    for (const unit of units) {
      const n = Number(unit.section);
      if (!Number.isInteger(n) || n < 1 || n > TAKETORI_SECTIONS.length)
        throw new Error('Unexpected 竹取物語 section ' + unit.section + ' in ' + unit.id);
      if (!parts[n - 1])
        parts[n - 1] = { label: '第' + smallNumeral(n) + '节', title: TAKETORI_SECTIONS[n - 1], units: [] };
      parts[n - 1].units.push(unit);
    }
    if (parts.length !== TAKETORI_SECTIONS.length || parts.some((part) => !part))
      throw new Error('竹取物語 should have nine sections');
    return parts;
  }
  if (book.id === 'ise') {
    let episode = 0;
    const tagged = units.map((unit) => {
      if (ISE_EPISODE_START.test(unit.original_ja || '')) {
        episode += 1;
        return { unit, episode, opens: true };
      }
      // The title line before 第一段 opens the first part.
      return { unit, episode: Math.max(1, episode), opens: false };
    });
    if (episode !== 115) throw new Error('伊勢物語 (塗籠本) should have 115 episodes, found ' + episode);
    const parts = [];
    for (const item of tagged) {
      const index = Math.floor((item.episode - 1) / ISE_EPISODES_PER_PART);
      if (!parts[index]) {
        const first = index * ISE_EPISODES_PER_PART + 1;
        const last = Math.min(episode, first + ISE_EPISODES_PER_PART - 1);
        parts[index] = {
          label: '',
          title: '第' + japaneseNumeral(first) + '段〜第' + japaneseNumeral(last) + '段',
          episodes: [first, last],
          units: [],
        };
      }
      if (item.opens) episodes.set(item.unit.id, item.episode);
      parts[index].units.push(item.unit);
    }
    return parts;
  }
  const byPart = new Map();
  for (const unit of units) {
    const n = Number(unit.part);
    if (!Number.isInteger(n) || n < 1) throw new Error('Unexpected part ' + unit.part + ' in ' + unit.id);
    if (!byPart.has(n)) {
      const label =
        book.id === 'genji'
          ? '第' + smallNumeral(n) + '帖'
          : book.id === 'otogi'
            ? '第' + smallNumeral(n) + '篇'
            : '';
      byPart.set(n, { label, title: String(unit.part_title || '').trim(), units: [] });
    }
    byPart.get(n).units.push(unit);
  }
  const numbers = [...byPart.keys()].sort((a, b) => a - b);
  numbers.forEach((n, i) => {
    if (n !== i + 1) throw new Error(book.id + ' parts are not numbered 1..N');
  });
  return numbers.map((n) => byPart.get(n));
}

function sourceSummary(book, metadata) {
  const receipt = metadata.source_receipt || {};
  const candidate = receipt.recommended_candidate || {};
  const records = Array.isArray(receipt.records) ? receipt.records : [];
  const url =
    metadata.source_url ||
    receipt.permanent_source ||
    receipt.source ||
    candidate.source ||
    (records[0] && records[0].record) ||
    '';
  return {
    edition: metadata.edition || '',
    license: book.license,
    url: /^https:\/\//.test(url) ? url : '',
    status: metadata.status || '',
    quality: metadata.quality_note || metadata.review_scope || '',
  };
}

// Narration timeline: chunk times plus the modern-Japanese code-point spans
// each chunk reads. The reader interpolates inside a chunk by characters.
function audioSummary(entry, library, unitIds) {
  const timeline = readJson(path.join(library, entry.files.timeline));
  const covered = new Set();
  const chunks = timeline.map((chunk) => {
    const spans = (chunk.source_spans || []).map((span) => {
      if (!unitIds.has(span.unit_id))
        throw new Error(entry.id + ' timeline names unknown unit ' + span.unit_id);
      covered.add(span.unit_id);
      return [span.unit_id, span.start, span.end];
    });
    return { start: round(chunk.start_seconds), end: round(chunk.end_seconds), spans };
  });
  for (let i = 1; i < chunks.length; i++)
    if (chunks[i].start + 0.01 < chunks[i - 1].end) throw new Error(entry.id + ' timeline chunks overlap');
  return {
    file: 'audio.mp3',
    bytes: entry.audio_bytes,
    duration: round(entry.duration_seconds),
    model: entry.model,
    voice: entry.voice,
    language: entry.language,
    narration: entry.narration_field,
    chunks,
    uncovered: [...unitIds].filter((id) => !covered.has(id)),
  };
}

function round(value) {
  return Math.round(Number(value) * 100) / 100;
}

// Start time of each unit's first character, for per-part audio ranges.
function unitStartTimes(audio, units) {
  const lengths = new Map(units.map((unit) => [unit.id, codePoints(unit.modern_ja)]));
  const starts = new Map();
  for (const chunk of audio.chunks) {
    const total = chunk.spans.reduce((sum, span) => sum + Math.max(0, span[2] - span[1]), 0);
    let before = 0;
    for (const [id, start, end] of chunk.spans) {
      if (start === 0 && !starts.has(id))
        starts.set(id, chunk.start + (total ? (before / total) * (chunk.end - chunk.start) : 0));
      before += Math.max(0, end - start);
    }
  }
  for (const [id, length] of lengths)
    if (length && !starts.has(id) && !audio.uncovered.includes(id))
      throw new Error('Narration never starts unit ' + id);
  return starts;
}

function build(options) {
  const library = path.resolve(options.source);
  const catalogFile = path.join(library, 'catalog.json');
  if (!fs.existsSync(catalogFile))
    throw new Error('Not a JapaneseClassics library (catalog.json missing): ' + library);
  const catalog = readJson(catalogFile);
  if (catalog.schema_version !== 1)
    throw new Error('Unsupported library catalog schema ' + catalog.schema_version);
  const out = options.out;
  fs.mkdirSync(out, { recursive: true });
  const summary = [];
  for (const book of BOOKS) {
    const corpusFile = path.join(library, book.corpus);
    const listed = (catalog.books || []).find((entry) => entry.id === book.id);
    if (listed && listed.corpus_sha256 && sha256(corpusFile) !== listed.corpus_sha256)
      throw new Error(book.id + ' corpus does not match catalog.json');
    const corpus = readJson(corpusFile);
    const units = corpus.units || [];
    if (!units.length) throw new Error(book.id + ' has no units');
    const ids = new Set();
    for (const unit of units) {
      if (!unit.id || ids.has(unit.id)) throw new Error(book.id + ' has a missing or repeated unit id');
      ids.add(unit.id);
    }
    const audioEntry = (catalog.audio || []).find((entry) => entry.id === book.id) || null;
    const audio = audioEntry ? audioSummary(audioEntry, library, ids) : null;
    const starts = audio ? unitStartTimes(audio, units) : null;
    const episodes = new Map();
    const parts = groupParts(book, units, episodes);
    const directory = path.join(out, book.id);
    fs.mkdirSync(directory, { recursive: true });
    for (const name of fs.readdirSync(directory))
      if (/\.json$/.test(name)) fs.rmSync(path.join(directory, name));
    const partEntries = parts.map((part, index) => {
      const file = String(index + 1).padStart(2, '0') + '.json';
      const records = part.units.map((unit) => {
        const record = unitRecord(unit);
        if (episodes.has(unit.id)) record.episode = episodes.get(unit.id);
        return record;
      });
      writeJson(path.join(directory, file), {
        schema: SCHEMA,
        book: book.id,
        part: index + 1,
        units: records,
      });
      const entry = {
        n: index + 1,
        file,
        label: part.label,
        title: part.title,
        units: records.length,
        chars: records.reduce((sum, record) => sum + codePoints(record.modern), 0),
      };
      if (part.episodes) entry.episodes = part.episodes;
      if (starts) {
        const first = part.units.find((unit) => starts.has(unit.id));
        if (first) entry.audioStart = round(starts.get(first.id));
      }
      return entry;
    });
    if (audio) {
      partEntries.forEach((entry, i) => {
        const next = partEntries.slice(i + 1).find((later) => later.audioStart !== undefined);
        if (entry.audioStart !== undefined) entry.audioEnd = next ? next.audioStart : audio.duration;
      });
      const mp3 = path.join(library, audioEntry.files.audio);
      const target = path.join(directory, audio.file);
      if (sha256(mp3) !== audioEntry.audio_sha256)
        throw new Error(book.id + ' audio does not match catalog.json');
      if (!fs.existsSync(target) || sha256(target) !== audioEntry.audio_sha256) fs.copyFileSync(mp3, target);
    } else if (fs.existsSync(path.join(directory, 'audio.mp3'))) {
      fs.rmSync(path.join(directory, 'audio.mp3'));
    }
    const index = {
      schema: SCHEMA,
      id: book.id,
      title: book.title,
      titleJa: book.titleJa,
      noun: book.noun,
      units: units.length,
      parts: partEntries,
      source: sourceSummary(book, corpus.metadata || {}),
    };
    if (audio) {
      delete audio.uncovered;
      index.audio = audio;
    }
    writeJson(path.join(directory, 'index.json'), index);
    summary.push({
      id: book.id,
      title: book.title,
      titleJa: book.titleJa,
      noun: book.noun,
      parts: partEntries.length,
      units: units.length,
      audio: !!audio,
    });
    console.log(
      book.id.padEnd(9) +
        String(partEntries.length).padStart(3) +
        ' parts ' +
        String(units.length).padStart(5) +
        ' units' +
        (audio ? ' + audio ' + audio.duration + ' s' : ''),
    );
  }
  writeJson(path.join(out, 'catalog.json'), {
    schema: SCHEMA,
    preparedOn: catalog.prepared_on || '',
    library: { catalogSha256: sha256(catalogFile) },
    books: summary,
  });
  return summary;
}

if (require.main === module) {
  let options;
  try {
    options = args(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  if (options.help || !options.source) {
    console.log(
      'Usage: node tools/build_classics_library.cjs --source <JapaneseClassics folder> [--out <dir>]',
    );
    process.exit(options.help ? 0 : 2);
  }
  try {
    build(options);
    console.log('Wrote ' + (path.relative(ROOT, options.out) || options.out));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { build, groupParts, japaneseNumeral, smallNumeral, TAKETORI_SECTIONS };
