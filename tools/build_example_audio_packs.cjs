#!/usr/bin/env node
// Pack the Chirp3 example clips (PUB-04-EXAMPLES, option A) for Cloudflare Pages.
//
// 42,903 single OGG files would exceed the Pages file limit, so clips are joined
// into a few packs. Each clip stays a complete OGG file inside its pack, and
// js/core/example-audio.js fetches it by byte range. Index shards map a text
// key to [pack, offset, length]; this tool evaluates that same script, so the
// page and the packer hash text identically. Counter-examples are left out.
//
//   node tools/build_example_audio_packs.cjs --source <chirp3 batch dir>
//     [--out data/example_audio_v1] [--pack-bytes 5242880] [--pack-clips 0]
//     [--shard-bits 6] [--coverage]
//
// The output directory is ignored by Git and rebuilt from scratch on each run.
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const PAGES_FILE_LIMIT = 25 * 1024 * 1024;
const COUNTER_EXAMPLE_KIND = 'anti_examples';

function parseArgs(argv) {
  const options = {
    source: 'local/qa/chirp3-examples-2026-10-06',
    out: 'data/example_audio_v1',
    packBytes: 5 * 1024 * 1024,
    packClips: 0,
    shardBits: 6,
    coverage: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) throw new Error(arg + ' needs a value');
      return argv[++i];
    };
    if (arg === '--source') options.source = value();
    else if (arg === '--out') options.out = value();
    else if (arg === '--pack-bytes') options.packBytes = Number(value());
    else if (arg === '--pack-clips') options.packClips = Number(value());
    else if (arg === '--shard-bits') options.shardBits = Number(value());
    else if (arg === '--coverage') options.coverage = true;
    else throw new Error('Unknown option ' + arg);
  }
  if (!Number.isInteger(options.packBytes) || options.packBytes < 1 || options.packBytes > PAGES_FILE_LIMIT)
    throw new Error('--pack-bytes must be an integer from 1 to ' + PAGES_FILE_LIMIT);
  if (!Number.isInteger(options.packClips) || options.packClips < 0)
    throw new Error('--pack-clips must be 0 (no limit) or a positive integer');
  if (!Number.isInteger(options.shardBits) || options.shardBits < 0 || options.shardBits > 12)
    throw new Error('--shard-bits must be an integer from 0 to 12');
  options.source = path.resolve(ROOT, options.source);
  options.out = path.resolve(ROOT, options.out);
  return options;
}

function loadKeyFunctions() {
  const file = path.join(ROOT, 'js/core/example-audio.js');
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  const api = sandbox.window.JPLearn && sandbox.window.JPLearn.exampleAudio;
  if (!api || typeof api.textKey !== 'function' || typeof api.shardOf !== 'function')
    throw new Error('js/core/example-audio.js no longer exposes textKey() and shardOf()');
  return api;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// Gather clips in source-map order, which keeps one word's or one grammar
// point's examples next to each other in the same pack.
function collectClips(source, keys) {
  const map = readJson(path.join(source, 'source-audio-map.json'));
  const manifest = readJson(path.join(source, 'web-manifest.json'));
  const clips = new Map();
  const counterOnly = new Set();
  const textByKey = new Map();
  const conflicts = [];
  for (const row of map) {
    if (!manifest[row.audio_key] || manifest[row.audio_key].status !== 'ok')
      throw new Error('No exported clip for ' + row.audio_key);
    if (row.kind === COUNTER_EXAMPLE_KIND) {
      if (!clips.has(row.audio_key)) counterOnly.add(row.audio_key);
      continue;
    }
    counterOnly.delete(row.audio_key);
    if (!clips.has(row.audio_key)) clips.set(row.audio_key, { audioKey: row.audio_key, keys: new Set() });
    const text = keys.normalize(row.display_text);
    const key = keys.textKey(text);
    if (!key) continue;
    const known = textByKey.get(key);
    if (known && known.text !== text)
      throw new Error('Text key collision: "' + known.text + '" and "' + text + '"');
    if (known && known.audioKey !== row.audio_key) {
      conflicts.push({ text, kept: known.audioKey, skipped: row.audio_key });
      continue;
    }
    if (!known) textByKey.set(key, { text, audioKey: row.audio_key });
    clips.get(row.audio_key).keys.add(key);
  }
  for (const audioKey of counterOnly) clips.delete(audioKey);
  // A clip whose every text already belongs to another clip is unreachable.
  const reachable = [...clips.values()].filter((clip) => clip.keys.size);
  return { clips: reachable, manifest, counterOnly: counterOnly.size, conflicts, references: map.length };
}

function prepareOutput(out) {
  const dataRoot = path.join(ROOT, 'data') + path.sep;
  if (!out.startsWith(dataRoot)) throw new Error('--out must be inside data/: ' + out);
  if (fs.existsSync(out)) {
    const unexpected = fs
      .readdirSync(out)
      .filter((name) => !['index.json', 'packs', 'shards'].includes(name));
    if (unexpected.length)
      throw new Error('Refusing to clear ' + out + '; unexpected: ' + unexpected.join(', '));
    fs.rmSync(out, { recursive: true, force: true });
  }
  fs.mkdirSync(path.join(out, 'packs'), { recursive: true });
  fs.mkdirSync(path.join(out, 'shards'), { recursive: true });
}

function writePacks(options, clips, manifest) {
  const packs = [];
  const entries = new Map();
  let parts = [];
  let size = 0;
  let bytes = 0;
  function close() {
    if (!parts.length) return;
    const content = Buffer.concat(parts.map((part) => part.buffer));
    const name = 'packs/' + sha256(content).slice(0, 16) + '.ogg';
    fs.writeFileSync(path.join(options.out, name), content);
    for (const part of parts)
      for (const key of part.clip.keys) entries.set(key, [packs.length, part.offset, part.buffer.length]);
    packs.push({ name, bytes: content.length, clips: parts.length });
    bytes += content.length;
    parts = [];
    size = 0;
  }
  for (const clip of clips) {
    const file = path.join(options.source, 'audio', clip.audioKey.slice(0, 2), clip.audioKey + '.ogg');
    const buffer = fs.readFileSync(file);
    if (sha256(buffer) !== manifest[clip.audioKey].ogg_sha256) throw new Error('Checksum mismatch: ' + file);
    if (buffer.toString('latin1', 0, 4) !== 'OggS') throw new Error('Not an OGG file: ' + file);
    if (buffer.length > options.packBytes) throw new Error('Clip larger than --pack-bytes: ' + file);
    const full =
      size + buffer.length > options.packBytes || (options.packClips && parts.length >= options.packClips);
    if (full) close();
    parts.push({ clip, buffer, offset: size });
    size += buffer.length;
  }
  close();
  return { packs, entries, bytes };
}

function writeShards(options, keys, entries) {
  const count = 2 ** options.shardBits;
  const shards = Array.from({ length: count }, () => ({}));
  for (const key of [...entries.keys()].sort())
    shards[keys.shardOf(key, options.shardBits)][key] = entries.get(key);
  const width = String(count - 1).length;
  return shards.map((shard, index) => {
    const content = JSON.stringify(shard);
    const name =
      'shards/' + String(index).padStart(width, '0') + '-' + sha256(content).slice(0, 12) + '.json';
    fs.writeFileSync(path.join(options.out, name), content);
    return { name, bytes: Buffer.byteLength(content) };
  });
}

// How many examples the site shows today have a clip. Text that changed after
// the 2026-10-06 recording correctly has none and shows "暂无配音".
function coverage(keys, entries) {
  const result = {};
  function count(group, text) {
    const key = keys.textKey(text);
    if (!key) return;
    const row = (result[group] = result[group] || { shown: 0, voiced: 0 });
    row.shown++;
    if (entries.has(key)) row.voiced++;
  }
  function list(value) {
    return Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : [];
  }
  const vocab = readJson(path.join(ROOT, 'data/taxonomy_annotations_gemini_3_flash_enriched.json'));
  for (const word of list(vocab.words || vocab)) {
    const examples = list(word && word.example_sentences);
    if (examples.length) for (const example of examples) count('vocabulary', example && example.ja);
    else count('vocabulary', word && word.example_sentence_ja);
  }
  const grammar = readJson(path.join(ROOT, 'data/grammar_details.json'));
  for (const detail of list(grammar.details || grammar)) {
    const enriched = (detail && detail.enriched) || {};
    const text = (item) => (typeof item === 'string' ? item : item && item.ja);
    for (const item of list(enriched.example_analysis)) count('grammar:example_analysis', text(item));
    for (const item of list(enriched.best_examples_for_memory)) count('grammar:best_examples', text(item));
    for (const item of list(enriched.best_examples_for_contrast)) count('grammar:best_examples', text(item));
    for (const item of list(enriched.mini_contrast_set)) count('grammar:mini_contrast_set', text(item));
    for (const item of list(detail && detail.originalExamples)) count('grammar:originalExamples', text(item));
    for (const item of list(detail && detail.rewrittenExamples))
      count('grammar:rewrittenExamples', text(item));
  }
  return result;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const keys = loadKeyFunctions();
  const collected = collectClips(options.source, keys);
  prepareOutput(options.out);
  const written = writePacks(options, collected.clips, collected.manifest);
  const shards = writeShards(options, keys, written.entries);
  const index = {
    schema: 1,
    hash: keys.HASH,
    shardBits: options.shardBits,
    clips: collected.clips.length,
    keys: written.entries.size,
    packs: written.packs.map((pack) => pack.name),
    shards: shards.map((shard) => shard.name),
  };
  fs.writeFileSync(path.join(options.out, 'index.json'), JSON.stringify(index));
  const shardBytes = shards.map((shard) => shard.bytes);
  const packBytes = written.packs.map((pack) => pack.bytes);
  const report = {
    out: path.relative(ROOT, options.out).replace(/\\/g, '/'),
    references: collected.references,
    clips: collected.clips.length,
    counterExampleOnly: collected.counterOnly,
    textKeys: written.entries.size,
    textConflicts: collected.conflicts.length,
    packs: written.packs.length,
    packBytes: { total: written.bytes, max: Math.max(...packBytes), min: Math.min(...packBytes) },
    clipsPerPack: Math.round(collected.clips.length / written.packs.length),
    shards: shards.length,
    shardBytes: { total: shardBytes.reduce((a, b) => a + b, 0), max: Math.max(...shardBytes) },
    files: written.packs.length + shards.length + 1,
  };
  if (options.coverage) report.coverage = coverage(keys, written.entries);
  console.log(JSON.stringify(report, null, 2));
  if (collected.conflicts.length)
    console.log('Conflicting texts kept their first clip:', JSON.stringify(collected.conflicts.slice(0, 5)));
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
