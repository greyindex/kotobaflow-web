// Reviewed teaching-text corrections. Validate every target before writing any file.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const resourceRevisions = require('./reviewed_resource_revisions.cjs');
const lexicalMetadata = require('../js/core/lexical-metadata.js');
const manifestPath = 'resources/quality/learning-content-corrections-2026-09-23.json';
const revisionManifestPath = resourceRevisions.manifestPath;

function propertyAt(document, keys, label) {
  if (!Array.isArray(keys) || !keys.length) throw Error('Missing JSON path: ' + label);
  let parent = document;
  for (const key of keys) {
    if (
      !['string', 'number'].includes(typeof key) ||
      ['__proto__', 'prototype', 'constructor'].includes(String(key)) ||
      parent === null ||
      typeof parent !== 'object' ||
      !Object.hasOwn(parent, key)
    )
      throw Error('Correction path no longer exists: ' + label);
    parent = parent[key];
  }
  return parent;
}

function validateTeachingFile(root, file, id) {
  if (
    typeof file !== 'string' ||
    !/^data\/[A-Za-z0-9_./-]+\.json$/.test(file) ||
    file.split('/').some((part) => !part || part === '.' || part === '..') ||
    file.startsWith('data/user_progress')
  )
    throw Error('Correction must target a teaching JSON file: ' + id);
  const absolute = path.resolve(root, file);
  const relative = path.relative(path.resolve(root, 'data'), absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative))
    throw Error('Correction path escapes data directory: ' + id);
  return absolute;
}

function loadDocument(root, files, file, id) {
  if (!files.has(file)) {
    const absolute = validateTeachingFile(root, file, id);
    const source = fs.readFileSync(absolute, 'utf8');
    if (source.startsWith('version https://git-lfs.github.com/'))
      throw Error('Fetch Git LFS content before correcting: ' + file);
    const document = JSON.parse(source);
    files.set(file, { absolute, initial: structuredClone(document), document, changed: false });
  }
  return files.get(file);
}

const lexicalFields = ['pos', 'transitivity', 'register', 'style'];
function isStructuredLexicalRow(row) {
  return !!(
    row &&
    typeof row === 'object' &&
    (lexicalFields.some((field) => row[field] && typeof row[field] === 'object') ||
      (row.lexical_review && typeof row.lexical_review === 'object'))
  );
}

function validateStructuredLexicalRow(row, id) {
  lexicalMetadata.validate({
    pos: row.pos,
    transitivity: row.transitivity,
    register: row.register,
    style: row.style,
  });
  const review = row.lexical_review;
  if (
    !review ||
    review.schemaVersion !== 2 ||
    !['reviewed', 'needs_review'].includes(review.status) ||
    !['high', 'medium', 'low'].includes(review.confidence) ||
    (review.status === 'needs_review' && review.confidence === 'high') ||
    !Array.isArray(review.basis) ||
    !review.basis.length ||
    !Array.isArray(review.dictionary_sequences) ||
    !review.identity ||
    typeof review.identity.word !== 'string' ||
    !review.identity.word.trim() ||
    typeof review.identity.reading_hiragana !== 'string' ||
    typeof review.identity.meaning !== 'string'
  )
    throw Error('Invalid structured lexical metadata review: ' + id);
}

function processCorrections(root, manifest, { apply = false, revisions = null, followups = null } = {}) {
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.corrections))
    throw Error('Invalid learning correction manifest');
  const files = new Map();
  if (revisions === null) revisions = resourceRevisions.readOptional(root);
  if (revisions) resourceRevisions.validateManifest(root, revisions);
  if (followups === null)
    followups = resourceRevisions.readOptional(root, resourceRevisions.followupManifestPath);
  const restoredFollowups = new Set();
  if (followups) {
    resourceRevisions.validateManifest(root, followups);
    // Unwind the newest reviewed layer before replaying the original guards.
    for (const revision of followups.revisions) {
      const state = loadDocument(root, files, revision.file, revision.id);
      const current = propertyAt(state.document, revision.path, revision.id);
      if (isDeepStrictEqual(current, revision.after)) {
        const parent =
          revision.path.length === 1
            ? state.document
            : propertyAt(state.document, revision.path.slice(0, -1), revision.id);
        parent[revision.path[revision.path.length - 1]] = structuredClone(revision.before);
        restoredFollowups.add(revision);
      }
    }
  }
  const revisionTargets = new Map();
  const restoredRevisions = new Set();
  let revisionPending = 0;
  let revisionAlreadyApplied = 0;
  if (revisions) {
    for (const revision of revisions.revisions) {
      const state = loadDocument(root, files, revision.file, revision.id);
      const current = propertyAt(state.document, revision.path, revision.id);
      if (isDeepStrictEqual(current, revision.after)) {
        const parent =
          revision.path.length === 1
            ? state.document
            : propertyAt(state.document, revision.path.slice(0, -1), revision.id);
        parent[revision.path[revision.path.length - 1]] = structuredClone(revision.before);
        state.changed = true;
        restoredRevisions.add(revision);
      }
      revisionTargets.set(revision, state);
    }
  }
  const ids = new Set();
  const targets = new Set();
  let pending = 0;
  let alreadyApplied = 0;
  let metadataSuperseded = 0;
  for (const correction of manifest.corrections) {
    const { id, file, path: keys, guards, before, after, reason, evidence } = correction;
    if (
      !id ||
      ids.has(id) ||
      !reason ||
      !Array.isArray(evidence) ||
      !evidence.length ||
      !Object.hasOwn(correction, 'before') ||
      !Object.hasOwn(correction, 'after') ||
      isDeepStrictEqual(before, after)
    )
      throw Error('Invalid or duplicate correction: ' + id);
    ids.add(id);
    validateTeachingFile(root, file, id);
    const target = file + ':' + JSON.stringify(keys);
    if (targets.has(target)) throw Error('Duplicate correction target: ' + id);
    targets.add(target);
    const state = loadDocument(root, files, file, id);
    if (!Array.isArray(guards) || !guards.length) throw Error('Missing identity guard: ' + id);
    for (const guard of guards) {
      if (!isDeepStrictEqual(propertyAt(state.document, guard.path, id), guard.value))
        throw Error('Correction identity changed; review required: ' + id);
    }
    const current = propertyAt(state.document, keys, id);
    const metadataField = ['pos', 'transitivity', 'register', 'style'].includes(String(keys.at(-1)));
    const indexedVocabularyRow =
      keys.length === 2 && typeof keys[0] === 'number' && Array.isArray(state.document) && metadataField;
    if (indexedVocabularyRow) {
      const row = state.document[keys[0]];
      if (isStructuredLexicalRow(row)) {
        validateStructuredLexicalRow(row, id);
        metadataSuperseded++;
        continue;
      }
    }
    const derivedDisplayFields = {
      display_pos_ja: () => lexicalMetadata.posLabel(state.document[keys[0]].pos, 'ja'),
      display_pos_zh: () => lexicalMetadata.posLabel(state.document[keys[0]].pos, 'zh'),
      pos_ja: () => lexicalMetadata.posLabel(state.document[keys[0]].pos, 'ja'),
      pos_zh: () => lexicalMetadata.posLabel(state.document[keys[0]].pos, 'zh'),
      conjugation_class_ja: () => lexicalMetadata.conjugationLabel(state.document[keys[0]].pos, 'ja'),
      transitivity_label_zh: () =>
        lexicalMetadata.transitivityLabel(state.document[keys[0]].transitivity, 'zh'),
    };
    const derivedRowTarget =
      keys.length === 2 &&
      typeof keys[0] === 'number' &&
      Array.isArray(state.document) &&
      Object.hasOwn(derivedDisplayFields, String(keys[1]));
    if (derivedRowTarget) {
      const row = state.document[keys[0]];
      if (isStructuredLexicalRow(row)) {
        validateStructuredLexicalRow(row, id);
        const expected = derivedDisplayFields[String(keys[1])]();
        if (current === expected) {
          metadataSuperseded++;
          continue;
        }
      }
    }
    if (isDeepStrictEqual(current, after)) {
      alreadyApplied++;
      continue;
    }
    if (!isDeepStrictEqual(current, before)) throw Error('Correction source changed; review required: ' + id);
    pending++;
    const parent = keys.length === 1 ? state.document : propertyAt(state.document, keys.slice(0, -1), id);
    parent[keys[keys.length - 1]] = structuredClone(after);
    state.changed = true;
  }
  if (revisions) {
    for (const revision of revisions.revisions) {
      const state = revisionTargets.get(revision);
      for (const guard of revision.guards) {
        if (!isDeepStrictEqual(propertyAt(state.document, guard.path, revision.id), guard.value))
          throw Error('Revision identity changed; review required: ' + revision.id);
      }
    }
    for (const revision of revisions.revisions) {
      const state = revisionTargets.get(revision);
      const current = propertyAt(state.document, revision.path, revision.id);
      if (restoredRevisions.has(revision)) {
        if (!isDeepStrictEqual(current, revision.before))
          throw Error('Revision baseline changed; review required: ' + revision.id);
        const parent =
          revision.path.length === 1
            ? state.document
            : propertyAt(state.document, revision.path.slice(0, -1), revision.id);
        parent[revision.path[revision.path.length - 1]] = structuredClone(revision.after);
        revisionAlreadyApplied++;
        continue;
      }
      if (isDeepStrictEqual(current, revision.after)) {
        revisionAlreadyApplied++;
        continue;
      }
      if (!isDeepStrictEqual(current, revision.before))
        throw Error('Revision source changed; review required: ' + revision.id);
      revisionPending++;
      const parent =
        revision.path.length === 1
          ? state.document
          : propertyAt(state.document, revision.path.slice(0, -1), revision.id);
      parent[revision.path[revision.path.length - 1]] = structuredClone(revision.after);
      state.changed = true;
    }
  }
  let followupPending = 0;
  let followupAlreadyApplied = 0;
  if (followups) {
    // Validate the entire follow-up layer against the completed previous layer.
    for (const revision of followups.revisions) {
      const state = loadDocument(root, files, revision.file, revision.id);
      for (const guard of revision.guards) {
        if (!isDeepStrictEqual(propertyAt(state.document, guard.path, revision.id), guard.value))
          throw Error('Follow-up identity changed; review required: ' + revision.id);
      }
      if (!isDeepStrictEqual(propertyAt(state.document, revision.path, revision.id), revision.before))
        throw Error('Follow-up source changed; review required: ' + revision.id);
    }
    for (const revision of followups.revisions) {
      const state = files.get(revision.file);
      const parent =
        revision.path.length === 1
          ? state.document
          : propertyAt(state.document, revision.path.slice(0, -1), revision.id);
      parent[revision.path[revision.path.length - 1]] = structuredClone(revision.after);
      state.changed = true;
      if (restoredFollowups.has(revision)) followupAlreadyApplied++;
      else followupPending++;
    }
  }
  if (!apply && pending)
    throw Error(`${pending} reviewed corrections missing; run npm run resources:correct`);
  if (!apply && revisionPending)
    throw Error(`${revisionPending} reviewed revisions missing; run npm run resources:correct`);
  if (!apply && followupPending)
    throw Error(`${followupPending} reviewed follow-ups missing; run npm run resources:correct`);
  const changedFiles = [];
  if (apply) {
    for (const [file, state] of files) {
      if (!state.changed || isDeepStrictEqual(state.initial, state.document)) continue;
      const temporary = state.absolute + '.corrections-' + randomUUID() + '.tmp';
      try {
        fs.writeFileSync(temporary, JSON.stringify(state.document, null, 2) + '\n', { flag: 'wx' });
        fs.renameSync(temporary, state.absolute);
      } finally {
        fs.rmSync(temporary, { force: true });
      }
      changedFiles.push(file);
    }
  }
  return {
    corrections: ids.size,
    applied: apply ? pending : 0,
    alreadyApplied,
    metadataSuperseded,
    revisions: revisions ? revisions.revisions.length : 0,
    revisionsApplied: apply ? revisionPending : 0,
    revisionsAlreadyApplied: revisionAlreadyApplied,
    followups: followups ? followups.revisions.length : 0,
    followupsApplied: apply ? followupPending : 0,
    followupsAlreadyApplied: followupAlreadyApplied,
    changedFiles,
  };
}

module.exports = { manifestPath, revisionManifestPath, processCorrections };
if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const args = process.argv.slice(2);
  if (args.some((arg) => !['--check', '--apply'].includes(arg)) || args.length > 1)
    throw Error('Use --check (default) or --apply');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, manifestPath), 'utf8'));
  const revisions = resourceRevisions.readOptional(root);
  console.log(
    JSON.stringify(processCorrections(root, manifest, { apply: args.includes('--apply'), revisions })),
  );
}
