// Reviewed structural revisions for teaching JSON. This is intentionally a
// separate manifest contract from scalar learning-content corrections.
const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');

const manifestPath = 'resources/quality/textbook-token-revisions-2026-09-27.json';
const followupManifestPath = 'resources/quality/content-closure-2026-09-28.json';

function validateTeachingFile(root, file, id) {
  if (
    typeof file !== 'string' ||
    !/^data\/[A-Za-z0-9_./-]+\.json$/.test(file) ||
    file.split('/').some((part) => !part || part === '.' || part === '..') ||
    file.startsWith('data/user_progress')
  )
    throw Error('Revision must target a teaching JSON file: ' + id);
  const absolute = path.resolve(root, file);
  const relative = path.relative(path.resolve(root, 'data'), absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative))
    throw Error('Revision path escapes data directory: ' + id);
  return absolute;
}

function isLexicalMetadataRevision(file, keys) {
  const vocabularyFile =
    file === 'data/taxonomy_annotations_gemini_3_flash_enriched.json' ||
    file === 'data/textbook/canonical_textbook_vocab/textbook_vocab_full.v3.json' ||
    file === 'data/textbook/canonical_textbook_vocab/textbook_vocab_full.v4.enrichment.json' ||
    file === 'data/textbook/kotobaflow/textbook_vocab_full.v3.json' ||
    file.startsWith('data/textbook/kotobaflow/vocab_enrichment/');
  return (
    vocabularyFile &&
    keys.some((key) => ['pos', 'transitivity', 'register', 'style', 'lexical_review'].includes(String(key)))
  );
}

function validateManifest(root, manifest) {
  if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.revisions))
    throw Error('Invalid reviewed revision manifest');
  const ids = new Set();
  const targets = [];
  for (const revision of manifest.revisions) {
    const { id, file, path: keys, guards, before, after, reason, evidence } = revision;
    if (
      !id ||
      ids.has(id) ||
      !reason ||
      !Array.isArray(evidence) ||
      !evidence.length ||
      !Object.hasOwn(revision, 'before') ||
      !Object.hasOwn(revision, 'after') ||
      isDeepStrictEqual(before, after)
    )
      throw Error('Invalid or duplicate revision: ' + id);
    ids.add(id);
    validateTeachingFile(root, file, id);
    if (!Array.isArray(keys) || !keys.length) throw Error('Missing revision path: ' + id);
    if (isLexicalMetadataRevision(file, keys))
      throw Error('Lexical metadata is review-gated and cannot be changed by resource revisions: ' + id);
    const arrayRevision = ['tokens', 'chunks'].includes(keys[keys.length - 1]);
    if (
      !(arrayRevision && Array.isArray(before) && Array.isArray(after)) &&
      !(typeof before === 'string' && typeof after === 'string')
    )
      throw Error('Revision target must be scalar text or a whole tokens/chunks array: ' + id);
    if (!Array.isArray(guards) || !guards.length) throw Error('Missing revision identity guard: ' + id);
    const prefix = (a, b) => a.length <= b.length && a.every((part, index) => part === b[index]);
    for (const prior of targets) {
      if (prior.file === file && (prefix(prior.path, keys) || prefix(keys, prior.path)))
        throw Error('Overlapping revision target: ' + id);
    }
    targets.push({ file, path: keys });
  }
}

function readOptional(root, file = manifestPath) {
  const absolute = path.join(root, file);
  return fs.existsSync(absolute) ? JSON.parse(fs.readFileSync(absolute, 'utf8')) : null;
}

module.exports = {
  manifestPath,
  followupManifestPath,
  validateManifest,
  validateTeachingFile,
  isLexicalMetadataRevision,
  readOptional,
};
