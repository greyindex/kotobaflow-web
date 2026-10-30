'use strict';

/**
 * Inventory and verify the resources that are deliberately split between the
 * repository and local runtime/archive packs. The script never reads or
 * writes credentials and always excludes the personal progress file.
 *
 * Commands:
 *   node tools/resource_audit.js inventory
 *   node tools/resource_audit.js checksum
 *   node tools/resource_audit.js verify
 *   node tools/resource_audit.js verify --include-local-audio --include-archive --include-models
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const RESOURCE_ROOT = path.join(ROOT, 'resources');
const CHECKSUM_ROOT = path.join(RESOURCE_ROOT, 'checksums');
const MANIFEST_PATH = path.join(RESOURCE_ROOT, 'RESOURCE_MANIFEST.json');
const PACKS_PATH = path.join(RESOURCE_ROOT, 'PACKS.md');
const IMAGE_MANIFEST_PATH = 'resources/provenance/image-generation.jsonl';
const EXCLUDED_BASENAMES = new Set(['user_progress.json']);
const EXCLUDED_DIRECTORY_NAMES = new Set(['_repair_monitor']);
const EXCLUDED_EXTENSIONS = new Set(['.err', '.log']);

const ACTIVE_AUDIO = [
  {
    id: 'main-vocab-audio-female',
    label: '主词库女声音频',
    type: 'audio',
    status: 'active',
    required: false,
    paths: ['data/gcloud_chirp3_vocab12528_female_aoede_v1'],
    provider: 'Google Cloud Text-to-Speech / Google Gemini reviewed repairs',
    model: 'Chirp3-HD / gemini-3.8-flash-tts',
    voice: 'Aoede / Concierge 7 repairs',
    version: 'v1',
    checksumFile: 'resources/checksums/runtime-assets.sha256',
  },
  {
    id: 'textbook-vocab-audio-female',
    label: '教材课内词汇女声音频',
    type: 'audio',
    status: 'active',
    required: false,
    paths: ['data/gcloud_chirp3_vocab6127_female_aoede_v1'],
    provider: 'Google Cloud Text-to-Speech / Google Gemini reviewed repairs',
    model: 'Chirp3-HD / gemini-3.8-flash-tts',
    voice: 'Aoede / Concierge 7 repairs',
    version: 'v1',
    checksumFile: 'resources/checksums/runtime-assets.sha256',
  },
  {
    id: 'textbook-dialogue-audio',
    label: '教材会话音频',
    type: 'audio',
    status: 'active',
    required: false,
    paths: ['data/gemini38_flash_tts_dialogue_sections_candidate_v1'],
    provider: 'Google Gemini',
    model: 'gemini-3.8-flash-tts',
    voice: 'Charon / Aoede, source speaker roles',
    version: '20260928-content-closure-2',
    checksumFile: 'resources/checksums/runtime-assets.sha256',
  },
  {
    id: 'textbook-reading-audio',
    label: '教材正文/应用文朗读音频',
    type: 'audio',
    status: 'active',
    required: false,
    paths: ['data/gemini38_flash_tts_reading_sections_candidate_v1'],
    provider: 'Google Gemini',
    model: 'Per-paragraph Gemini 2.5 / 3.1 / 3.8 TTS; see local manifest',
    voice: 'Kore / Concierge 7, preserved per article',
    version: '20260928-content-closure-2',
    checksumFile: 'resources/checksums/runtime-assets.sha256',
  },
];

const ARCHIVE_AUDIO = [
  {
    id: 'textbook-dialogue-audio-old-chirp',
    label: '旧 Chirp3 会话音频',
    type: 'audio',
    status: 'archive',
    required: false,
    paths: ['data/gcloud_chirp3_dialogue_sections_v1'],
    provider: 'Google Cloud Text-to-Speech',
    model: 'Chirp3-HD',
    voice: 'speaker-mapped',
    version: 'v1',
    checksumFile: 'resources/checksums/archive-assets.sha256',
  },
  {
    id: 'textbook-reading-audio-old-qwen-punctpause',
    label: '旧 Qwen 标点停顿朗读音频',
    type: 'audio',
    status: 'archive',
    required: false,
    paths: ['data/qwen_reading_sections_manual_clean132_context_punctpause_v1'],
    provider: 'Qwen local TTS',
    model: 'Historical local model; provenance pending RES-104',
    voice: 'Historical reference voice; provenance pending RES-104',
    version: 'v1',
    checksumFile: 'resources/checksums/archive-assets.sha256',
  },
  {
    id: 'textbook-vocab-audio-male',
    label: '教材课内词汇男声音频',
    type: 'audio',
    status: 'archive',
    required: false,
    paths: ['data/gcloud_chirp3_vocab6127_male_charon_v1'],
    provider: 'Google Cloud Text-to-Speech',
    model: 'Chirp3-HD',
    voice: 'Charon',
    version: 'v1',
    checksumFile: 'resources/checksums/archive-assets.sha256',
  },
  {
    id: 'textbook-reading-audio-old-qwen',
    label: '旧 Qwen 朗读音频',
    type: 'audio',
    status: 'archive',
    required: false,
    paths: ['data/qwen_reading_sections_manual_clean132_context_v1'],
    provider: 'Qwen local TTS',
    model: 'historical local model; provenance pending RES-104',
    voice: 'historical reference voice; provenance pending RES-104',
    version: 'v1',
    checksumFile: 'resources/checksums/archive-assets.sha256',
  },
];

const SOURCE_MANIFEST_PATHS = [
  'data/gcloud_chirp3_vocab12000_female_aoede_v1_source_manifest.jsonl',
  'data/gcloud_chirp3_vocab12528_female_aoede_v1_source_manifest.jsonl',
];

const CANONICAL_PATHS = [
  'data/domain_taxonomy.json',
  'data/freq_band.json',
  'data/grammar_details.json',
  'data/grammar_index.json',
  'data/grammar_lessons.json',
  'data/pos.json',
  'data/register.json',
  'data/semantic_tag_taxonomy.json',
  'data/style.json',
  'data/taxonomy_annotations_gemini_3_flash_enriched.json',
  'data/transitivity.json',
  'data/textbook/canonical_textbook_vocab/textbook_vocab_full.v3.json',
  'data/textbook/canonical_textbook_vocab/textbook_vocab_full.v4.enrichment.json',
  'data/textbook/canonical_textbook_vocab/jitendex_overlay/jitendex_textbook_vocab_overlay.json',
  'data/textbook/canonical_books/XinBian1.bundle.json',
  'data/textbook/canonical_books/XinBian2.bundle.json',
  'data/textbook/canonical_books/XinBian3.bundle.json',
  'data/textbook/canonical_books/XinBian4.bundle.json',
  'data/textbook/canonical_textbook_grammar/textbook_grammar_full.v2.json',
  'data/textbook/textbook_text_tokens.v1.json',
  'data/textbook/textbook_text_chunks.v2.json',
  'data/wiki/processed/textbook_wiki_reading_chunks.v1.json',
  'data/wiki/processed/textbook_wiki_reading_candidates.v1.json',
  'manifest.webmanifest',
  'pwa-icon.svg',
  'resources/licenses/CYTOSCAPE-MIT.txt',
  'resources/provenance/image-generation.jsonl',
  'resources/quality',
  'resources/schemas',
  'vendor/cytoscape.min.js',
];

const IMAGE_ROOT = 'image';

const BRAND_RECORD = {
  id: 'brand-package',
  label: '产品品牌包',
  type: 'brand',
  status: 'active',
  required: true,
  paths: ['resources/brand/README.md', 'resources/brand/icons'],
  provider: 'project-authored',
  version: 'v1',
  checksumFile: 'resources/checksums/canonical-assets.sha256',
};

function normalizeRelative(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join('/');
}

function absoluteFromRelative(relativePath) {
  return path.resolve(ROOT, relativePath);
}

function exists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch (error) {
    return false;
  }
}

function isExcluded(filePath) {
  const basename = path.basename(filePath);
  if (EXCLUDED_BASENAMES.has(basename) || EXCLUDED_EXTENSIONS.has(path.extname(basename).toLowerCase()))
    return true;
  return filePath.split(path.sep).some((segment) => EXCLUDED_DIRECTORY_NAMES.has(segment));
}

function walkFiles(directory) {
  if (!exists(directory)) return [];
  const result = [];
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (isExcluded(absolutePath)) continue;
    if (entry.isDirectory()) {
      result.push(...walkFiles(absolutePath));
    } else if (entry.isFile()) {
      result.push(absolutePath);
    }
  }
  return result;
}

function filesForPaths(paths, extensions) {
  const result = [];
  for (const relativePath of paths) {
    const absolutePath = absoluteFromRelative(relativePath);
    if (!exists(absolutePath)) continue;
    const stat = fs.statSync(absolutePath);
    if (stat.isDirectory()) {
      const files = walkFiles(absolutePath);
      if (extensions && extensions.length) {
        result.push(...files.filter((filePath) => extensions.includes(path.extname(filePath).toLowerCase())));
      } else {
        result.push(...files);
      }
    } else if (stat.isFile()) {
      if (
        !extensions ||
        !extensions.length ||
        extensions.includes(path.extname(absolutePath).toLowerCase())
      ) {
        result.push(absolutePath);
      }
    }
  }
  return Array.from(new Set(result)).sort((a, b) => normalizeRelative(a).localeCompare(normalizeRelative(b)));
}

function getGitRevision() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch (error) {
    return null;
  }
}

function getTrackedSourceSummary() {
  try {
    const output = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' });
    const relativePaths = output
      .split('\0')
      .filter(Boolean)
      .filter(
        (relativePath) =>
          !['data/', 'image/', 'vendor/', 'resources/'].some((prefix) => relativePath.startsWith(prefix)),
      );
    const filePaths = relativePaths.map(absoluteFromRelative).filter((filePath) => exists(filePath));
    return summarizeFiles(filePaths);
  } catch (error) {
    return { fileCount: 0, bytes: 0, unavailable: true };
  }
}

function summarizeFiles(filePaths) {
  let bytes = 0;
  for (const filePath of filePaths) {
    try {
      bytes += fs.statSync(filePath).size;
    } catch (error) {
      // The manifest records the files that are present at audit time.
    }
  }
  return { fileCount: filePaths.length, bytes };
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unit = 'B';
  for (const nextUnit of units) {
    value /= 1024;
    unit = nextUnit;
    if (value < 1024 || nextUnit === units[units.length - 1]) break;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

function makeRecord(spec, filePaths) {
  const summary = summarizeFiles(filePaths);
  return {
    id: spec.id,
    label: spec.label,
    type: spec.type,
    status: spec.status,
    requiredForApp: Boolean(spec.required),
    present: filePaths.length > 0,
    paths: spec.paths,
    fileCount: summary.fileCount,
    bytes: summary.bytes,
    humanSize: formatBytes(summary.bytes),
    provider: spec.provider || null,
    model: spec.model || null,
    voice: spec.voice || null,
    version: spec.version || null,
    input: spec.input || null,
    generator: spec.generator || null,
    provenance: spec.provenance || null,
    license: spec.license || null,
    checksumFile: spec.checksumFile || null,
  };
}

function collectSpecs() {
  const specs = [];
  for (const spec of ACTIVE_AUDIO) specs.push({ ...spec, checksumGroup: 'runtime' });
  for (const spec of ARCHIVE_AUDIO) specs.push({ ...spec, checksumGroup: 'archive' });
  specs.push({
    id: 'source-manifests',
    label: '音频源 manifest',
    type: 'manifest',
    status: 'source',
    required: false,
    paths: SOURCE_MANIFEST_PATHS,
    provider: 'project source manifests',
    version: 'v1',
    checksumFile: 'resources/checksums/runtime-assets.sha256',
    checksumGroup: 'runtime',
  });
  specs.push({
    id: 'textbook-images',
    label: '教材插图',
    type: 'image',
    status: 'active',
    required: true,
    paths: [IMAGE_ROOT],
    extensions: ['.png'],
    provider: 'project asset; generation provenance pending RES-200',
    version: 'v1',
    checksumFile: 'resources/checksums/canonical-assets.sha256',
    checksumGroup: 'canonical',
  });
  specs.push({
    id: 'canonical-data',
    label: '核心数据、资源合同与插图来源 manifest',
    type: 'json',
    status: 'canonical',
    required: true,
    paths: CANONICAL_PATHS,
    provider: 'project data; individual provenance documented by source files/docs',
    version: 'current',
    checksumFile: 'resources/checksums/canonical-assets.sha256',
    checksumGroup: 'canonical',
  });
  specs.push({
    id: 'qwen-model-pack',
    label: '本地 Qwen 模型/环境',
    type: 'model',
    status: 'model',
    required: false,
    paths: ['local/tts/qwen'],
    provider: 'local optional runtime',
    version: 'unknown; local pack absent at this audit when absent',
    checksumFile: 'resources/checksums/models.sha256',
    checksumGroup: 'models',
  });
  specs.push({ ...BRAND_RECORD, checksumGroup: 'canonical' });
  return specs;
}

function collectInventory() {
  const specs = collectSpecs();
  const records = [];
  const checksumGroups = { canonical: new Set(), runtime: new Set(), archive: new Set(), models: new Set() };
  for (const spec of specs) {
    const files = filesForPaths(spec.paths, spec.extensions);
    for (const filePath of files) {
      checksumGroups[spec.checksumGroup].add(filePath);
    }
    records.push(makeRecord(spec, files));
  }
  const generatedAt = new Date().toISOString();
  return {
    schemaVersion: 1,
    generatedAt,
    repositoryRevision: getGitRevision(),
    sourceCheckout: getTrackedSourceSummary(),
    root: 'repository root; all paths are relative',
    exclusions: ['data/user_progress.json', 'local/tts/qwen credentials and account tokens'],
    notes: [
      'Ignored generated audio and optional local model files are inventoried when present but are not required in a fresh clone.',
      'Exact generation provenance and public redistribution permissions remain separate TODOs where historical evidence is unavailable.',
    ],
    packs: records,
    checksumFiles: {
      canonical: 'resources/checksums/canonical-assets.sha256',
      runtime: 'resources/checksums/runtime-assets.sha256',
      archive: 'resources/checksums/archive-assets.sha256',
      models: 'resources/checksums/models.sha256',
    },
    _filesByChecksumGroup: Object.fromEntries(
      Object.entries(checksumGroups).map(([group, values]) => [
        group,
        Array.from(values).map(normalizeRelative).sort(),
      ]),
    ),
  };
}

function publicManifest(inventory) {
  const copy = { ...inventory };
  delete copy._filesByChecksumGroup;
  return copy;
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function writeJson(filePath, value) {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function makePacksMarkdown(manifest) {
  const groups = [
    [
      'runtime',
      'Runtime pack',
      '运行时音频、必要 source manifest 和应用使用的轻量资源；音频缺失时页面仍可浏览，但朗读能力会降级。',
    ],
    ['archive', 'Archive pack', '历史/备用音频与旧 Qwen 朗读；应用不依赖此包。'],
    ['models', 'Model pack', '本地 Qwen 模型、checkpoint、参考音频和环境；不存在时只关闭动态 TTS。'],
    [
      'canonical',
      'Repository/LFS pack',
      'Git/LFS 中的核心 JSON、PNG、品牌包和本地 Cytoscape；新 clone 的基础运行内容。',
    ],
  ];
  const lines = [
    '# Resource packs',
    '',
    `Generated: ${manifest.generatedAt}`,
    '',
    '本文件只记录资源分类、用途和恢复路径，不保存 API key、credential JSON、账号 token 或个人进度。资源备份本身由仓库外的备份介质管理。',
    '',
    '## Pack overview',
    '',
    '| Pack | Files | Size | Required | Restore target |',
    '| --- | ---: | ---: | --- | --- |',
  ];
  const byGroup = new Map();
  for (const record of manifest.packs) {
    const group =
      record.status === 'archive'
        ? 'archive'
        : record.type === 'model'
          ? 'models'
          : record.type === 'json' || record.type === 'image' || record.type === 'brand'
            ? 'canonical'
            : 'runtime';
    if (!byGroup.has(group)) byGroup.set(group, { fileCount: 0, bytes: 0, required: false });
    const value = byGroup.get(group);
    value.fileCount += record.fileCount;
    value.bytes += record.bytes;
    value.required = value.required || record.requiredForApp;
  }
  const restoreTargets = {
    runtime: '`<runtime-pack>/*` → repository root',
    archive: '`<archive-pack>/*` → repository root',
    models: '`<model-pack>/local/tts/qwen` → `local/tts/qwen`',
    canonical: 'Git/LFS checkout → repository root',
  };
  for (const [group, title] of groups) {
    const value = byGroup.get(group) || { fileCount: 0, bytes: 0, required: false };
    lines.push(
      `| ${title} | ${value.fileCount.toLocaleString('en-US')} | ${formatBytes(value.bytes)} | ${value.required ? '基础运行' : '可选'} | ${restoreTargets[group]} |`,
    );
  }
  const canonicalData = manifest.packs.find((record) => record.id === 'canonical-data') || {
    fileCount: 0,
    bytes: 0,
  };
  const images = manifest.packs.find((record) => record.id === 'textbook-images') || {
    fileCount: 0,
    bytes: 0,
  };
  const source = manifest.sourceCheckout || { fileCount: 0, bytes: 0, unavailable: true };
  const runtime = byGroup.get('runtime') || { fileCount: 0, bytes: 0 };
  const archive = byGroup.get('archive') || { fileCount: 0, bytes: 0 };
  const models = byGroup.get('models') || { fileCount: 0, bytes: 0 };
  lines.push(
    '',
    '## Workspace budget',
    '',
    '| Category | Files | Size | Notes |',
    '| --- | ---: | ---: | --- |',
    `| 源码与配置（排除 data/image/vendor/resources） | ${source.fileCount.toLocaleString('en-US')} | ${formatBytes(source.bytes)} | Git tracked checkout${source.unavailable ? '; unavailable outside Git' : ''} |`,
    `| 核心 JSON、合同与许可证 | ${canonicalData.fileCount.toLocaleString('en-US')} | ${formatBytes(canonicalData.bytes)} | canonical-data record |`,
    `| 教材插图 | ${images.fileCount.toLocaleString('en-US')} | ${formatBytes(images.bytes)} | 77 PNG final assets |`,
    `| Active audio + source manifests | ${runtime.fileCount.toLocaleString('en-US')} | ${formatBytes(runtime.bytes)} | optional runtime pack |`,
    `| Archive audio | ${archive.fileCount.toLocaleString('en-US')} | ${formatBytes(archive.bytes)} | optional history/alternate pack |`,
    `| Model pack | ${models.fileCount.toLocaleString('en-US')} | ${formatBytes(models.bytes)} | optional; credentials excluded |`,
  );
  lines.push('', '## Pack contents', '');
  for (const [group, title, description] of groups) {
    lines.push(
      `### ${title}`,
      '',
      description,
      '',
      '| Resource | Status | Files | Size | Current path |',
      '| --- | --- | ---: | ---: | --- |',
    );
    const records = manifest.packs.filter((record) => {
      const recordGroup =
        record.status === 'archive'
          ? 'archive'
          : record.type === 'model'
            ? 'models'
            : record.type === 'json' || record.type === 'image' || record.type === 'brand'
              ? 'canonical'
              : 'runtime';
      return recordGroup === group;
    });
    for (const record of records) {
      lines.push(
        `| ${record.label} | ${record.status} | ${record.fileCount.toLocaleString('en-US')} | ${record.humanSize} | ${record.paths.map((value) => `\`${value}\``).join('<br>')} |`,
      );
    }
    if (!records.length) lines.push('| (none present) | — | 0 | 0 B | — |');
    lines.push('');
  }
  lines.push(
    '## Restore and verify',
    '',
    '1. 从私人备份恢复到明确的 pack 根目录，保持上表中的相对路径。',
    '2. 将 Runtime/Archive/Model pack 的内容复制到仓库根目录；不要覆盖 `data/user_progress.json`。',
    '3. 可用 `powershell -File tools/restore_resource_pack.ps1 -PackRoot <pack-root> -Pack runtime` 只恢复明确的 Runtime 路径；需要时将 `runtime` 换成 `archive` 或 `model`。',
    '4. 运行 `npm run validate:resources -- --include-local-audio --include-archive --include-models`。',
    '5. 校验命令会报告 missing、empty 和 hash mismatch；没有本地音频的 CI 只运行默认命令。',
    '',
    '## Current limitations',
    '',
    '- Qwen model pack 当前可能不存在；这不影响静态站点和预生成音频。',
    '- 音频生成配方、插图 prompt、第三方许可证和公开发布边界仍分别由 RES-100–104、RES-200–204、RES-300–303 维护。',
  );
  return `${lines.join('\n')}\n`;
}

function buildChecksumLines(filePaths, hashes) {
  const lines = ['# SHA-256 manifest generated by tools/resource_audit.js'];
  if (!filePaths.length) {
    lines.push('# No files were present for this optional pack at audit time.');
  }
  for (const filePath of filePaths) {
    lines.push(`${hashes.get(filePath)}  ${normalizeRelative(filePath)}`);
  }
  return `${lines.join('\n')}\n`;
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function mapLimit(values, limit, worker) {
  const results = new Array(values.length);
  let nextIndex = 0;
  async function run() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      results[index] = await worker(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, values.length)) }, run));
  return results;
}

async function writeChecksums(inventory) {
  ensureDirectory(CHECKSUM_ROOT);
  const groups = inventory._filesByChecksumGroup;
  const allFiles = Array.from(new Set(Object.values(groups).flat().map(absoluteFromRelative))).sort();
  console.log(`Hashing ${allFiles.length.toLocaleString('en-US')} files...`);
  const allHashes = await mapLimit(allFiles, 6, async (filePath, index) => {
    if ((index + 1) % 1000 === 0 || index + 1 === allFiles.length) {
      console.log(`  ${index + 1}/${allFiles.length}`);
    }
    return hashFile(filePath);
  });
  const hashMap = new Map(allFiles.map((filePath, index) => [filePath, allHashes[index]]));
  const files = {
    canonical: 'canonical-assets.sha256',
    runtime: 'runtime-assets.sha256',
    archive: 'archive-assets.sha256',
    models: 'models.sha256',
  };
  for (const [group, fileName] of Object.entries(files)) {
    const filePaths = groups[group]
      .map(absoluteFromRelative)
      .sort((a, b) => normalizeRelative(a).localeCompare(normalizeRelative(b)));
    const lines = buildChecksumLines(filePaths, hashMap);
    fs.writeFileSync(path.join(CHECKSUM_ROOT, fileName), lines, 'utf8');
  }
  const nextManifest = {
    ...publicManifest(inventory),
    checksumGeneratedAt: new Date().toISOString(),
  };
  writeJson(MANIFEST_PATH, nextManifest);
  fs.writeFileSync(PACKS_PATH, makePacksMarkdown(nextManifest), 'utf8');
  console.log('Wrote resources/checksums/*.sha256 and refreshed resource inventory.');
}

function parseChecksumLine(line) {
  const match = line.match(/^([a-f0-9]{64})\s+(.+)$/i);
  return match ? { expected: match[1].toLowerCase(), relativePath: match[2].trim() } : null;
}

function readJsonFile(relativePath, errors) {
  const filePath = absoluteFromRelative(relativePath);
  if (!exists(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    errors.push(`invalid JSON: ${relativePath} (${error.message})`);
    return null;
  }
}

function readJsonLines(relativePath, errors) {
  const filePath = absoluteFromRelative(relativePath);
  if (!exists(filePath)) return [];
  const records = [];
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      errors.push(`invalid JSONL: ${relativePath}:${index + 1} (${error.message})`);
    }
  }
  return records;
}

function assertArray(value, label, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array`);
    return false;
  }
  return true;
}

function assertUnique(values, label, errors) {
  const filtered = values.filter((value) => value !== null && value !== undefined && value !== '');
  const duplicateCount = filtered.length - new Set(filtered).size;
  if (duplicateCount) errors.push(`${label} has ${duplicateCount} duplicate value(s)`);
}

function validateCanonicalData() {
  const errors = [];
  for (const relativePath of SOURCE_MANIFEST_PATHS) {
    if (exists(absoluteFromRelative(relativePath))) readJsonLines(relativePath, errors);
  }
  const vocabulary = readJsonFile('data/taxonomy_annotations_gemini_3_flash_enriched.json', errors);
  if (assertArray(vocabulary, 'main vocabulary', errors)) {
    assertUnique(
      vocabulary.map((entry) => entry.index),
      'main vocabulary.index',
      errors,
    );
    vocabulary.forEach((entry, index) => {
      if (!Number.isInteger(entry.index)) errors.push(`main vocabulary entry ${index + 1} has invalid index`);
      if (typeof entry.word !== 'string' || !entry.word)
        errors.push(`main vocabulary entry ${index + 1} has no word`);
      if (typeof entry.reading_hiragana !== 'string')
        errors.push(`main vocabulary entry ${index + 1} has no reading_hiragana`);
    });
  }

  const grammarIndex = readJsonFile('data/grammar_index.json', errors);
  const grammarDetails = readJsonFile('data/grammar_details.json', errors);
  const grammarLessons = readJsonFile('data/grammar_lessons.json', errors);
  const grammarIds = new Set();
  if (assertArray(grammarIndex, 'grammar_index', errors)) {
    assertUnique(
      grammarIndex.map((entry) => entry.uid),
      'grammar_index.uid',
      errors,
    );
    grammarIndex.forEach((entry, index) => {
      if (!entry.uid) errors.push(`grammar_index entry ${index + 1} has no uid`);
      grammarIds.add(entry.uid);
    });
  }
  if (grammarDetails && typeof grammarDetails === 'object' && !Array.isArray(grammarDetails)) {
    Object.keys(grammarDetails).forEach((uid) => {
      if (!grammarDetails[uid] || typeof grammarDetails[uid] !== 'object')
        errors.push(`grammar_details.${uid} is not an object`);
      if (grammarDetails[uid] && grammarDetails[uid].uid && grammarDetails[uid].uid !== uid)
        errors.push(`grammar_details.${uid}.uid does not match its key`);
    });
    if (grammarIndex) {
      for (const uid of grammarIds)
        if (!Object.prototype.hasOwnProperty.call(grammarDetails, uid))
          errors.push(`grammar_index uid missing from grammar_details: ${uid}`);
    }
  }
  if (assertArray(grammarLessons, 'grammar_lessons', errors)) {
    assertUnique(
      grammarLessons.map((lesson) => lesson.lesson_id),
      'grammar_lessons.lesson_id',
      errors,
    );
    grammarLessons.forEach((lesson) => {
      for (const uid of lesson.grammar_uids || [])
        if (grammarIds.size && !grammarIds.has(uid))
          errors.push(`grammar lesson ${lesson.lesson_id} references missing grammar uid: ${uid}`);
    });
  }

  const textbookV3 = readJsonFile(
    'data/textbook/canonical_textbook_vocab/textbook_vocab_full.v3.json',
    errors,
  );
  const textbookV4 = readJsonFile(
    'data/textbook/canonical_textbook_vocab/textbook_vocab_full.v4.enrichment.json',
    errors,
  );
  const jitendex = readJsonFile(
    'data/textbook/canonical_textbook_vocab/jitendex_overlay/jitendex_textbook_vocab_overlay.json',
    errors,
  );
  const v3Indexes = new Set();
  if (assertArray(textbookV3, 'textbook vocab v3', errors)) {
    assertUnique(
      textbookV3.map((entry) => entry.index),
      'textbook vocab v3.index',
      errors,
    );
    textbookV3.forEach((entry) => v3Indexes.add(entry.index));
  }
  if (assertArray(textbookV4, 'textbook vocab v4 enrichment', errors)) {
    assertUnique(
      textbookV4.map((entry) => entry.index),
      'textbook vocab v4.index',
      errors,
    );
    textbookV4.forEach((entry) => {
      if (v3Indexes.size && !v3Indexes.has(entry.index))
        errors.push(`textbook v4 references missing v3 index: ${entry.index}`);
    });
  }
  if (jitendex && typeof jitendex === 'object') {
    const entries = jitendex.entries;
    if (assertArray(entries, 'Jitendex overlay.entries', errors)) {
      assertUnique(
        entries.map((entry) => entry.vocabIndex),
        'Jitendex overlay.vocabIndex',
        errors,
      );
      entries.forEach((entry) => {
        if (v3Indexes.size && !v3Indexes.has(entry.vocabIndex))
          errors.push(`Jitendex overlay references missing v3 index: ${entry.vocabIndex}`);
      });
    }
  }

  const textbookGrammar = readJsonFile(
    'data/textbook/canonical_textbook_grammar/textbook_grammar_full.v2.json',
    errors,
  );
  if (textbookGrammar && textbookGrammar.textbook) {
    if (assertArray(textbookGrammar.textbook.points, 'textbook grammar points', errors)) {
      assertUnique(
        textbookGrammar.textbook.points.map((entry) => entry.uid),
        'textbook grammar point.uid',
        errors,
      );
    }
  }
  for (const bookId of ['XinBian1', 'XinBian2', 'XinBian3', 'XinBian4']) {
    const bundle = readJsonFile(`data/textbook/canonical_books/${bookId}.bundle.json`, errors);
    if (!bundle || !assertArray(bundle.items, `${bookId}.bundle.items`, errors)) continue;
    assertUnique(
      bundle.items.map((item) => item.meta && item.meta.item_id),
      `${bookId}.bundle.items.meta.item_id`,
      errors,
    );
    if (bundle.book_id !== bookId) errors.push(`${bookId}.bundle.book_id does not match filename`);
  }

  const tokenData = readJsonFile('data/textbook/textbook_text_tokens.v1.json', errors);
  const chunkData = readJsonFile('data/textbook/textbook_text_chunks.v2.json', errors);
  const tokenSentences = tokenData && tokenData.sentences;
  const chunkSentences = chunkData && chunkData.sentences;
  let tokenIds = new Set();
  let chunkIds = new Set();
  if (assertArray(tokenSentences, 'textbook tokens.sentences', errors)) {
    assertUnique(
      tokenSentences.map((sentence) => sentence.id),
      'textbook tokens.sentences.id',
      errors,
    );
    tokenIds = new Set(tokenSentences.map((sentence) => sentence.id));
    for (const sentence of tokenSentences) {
      if (!Array.isArray(sentence.tokens)) {
        errors.push(`textbook sentence has no token array: ${sentence.id}`);
        continue;
      }
      for (const [index, token] of sentence.tokens.entries()) {
        if (token.index !== index || typeof token.surface !== 'string' || !token.surface) {
          errors.push(`textbook token identity or surface invalid: ${sentence.id}#token-${index}`);
        }
      }
      const joined = sentence.tokens.map((token) => token.surface).join('');
      if (joined.replace(/\s/g, '') !== String(sentence.text).replace(/\s/g, '')) {
        errors.push(`textbook tokens do not join to source text: ${sentence.id}`);
      }
    }
  }
  if (assertArray(chunkSentences, 'textbook chunks.sentences', errors)) {
    assertUnique(
      chunkSentences.map((sentence) => sentence.id),
      'textbook chunks.sentences.id',
      errors,
    );
    chunkIds = new Set(chunkSentences.map((sentence) => sentence.id));
  }
  if (tokenIds.size && chunkIds.size) {
    const tokenById = new Map(tokenSentences.map((sentence) => [sentence.id, sentence]));
    const chunkById = new Map(chunkSentences.map((sentence) => [sentence.id, sentence]));
    for (const id of tokenIds)
      if (!chunkIds.has(id)) errors.push(`textbook chunks missing token sentence id: ${id}`);
    for (const id of chunkIds)
      if (!tokenIds.has(id)) errors.push(`textbook tokens missing chunk sentence id: ${id}`);
    for (const [id, sentence] of chunkById) {
      const joined = Array.isArray(sentence.chunks)
        ? sentence.chunks.map((chunk) => String((chunk && chunk.surface) || '')).join('')
        : '';
      if (joined !== sentence.text) errors.push(`textbook chunks do not join to source text: ${id}`);
      for (const [index, chunk] of (Array.isArray(sentence.chunks) ? sentence.chunks : []).entries()) {
        if (
          !chunk ||
          typeof chunk.display !== 'string' ||
          chunk.display.trim() !== String(chunk.surface || '').trim()
        )
          errors.push(`textbook chunk display differs from source: ${id}#${index}`);
      }
      const tokenSentence = tokenById.get(id);
      if (tokenSentence && tokenSentence.text !== sentence.text)
        errors.push(`textbook token/chunk text mismatch: ${id}`);
    }

    const reviewSet = readJsonFile('resources/quality/textbook_text_gold_candidates.v1.json', errors);
    if (reviewSet && reviewSet.schemaVersion !== 1)
      errors.push('textbook gold candidates must use schemaVersion 1');
    const samples = reviewSet && reviewSet.samples;
    if (assertArray(samples, 'textbook gold candidates.samples', errors)) {
      assertUnique(
        samples.map((sample) => sample.id),
        'textbook gold candidates.id',
        errors,
      );
      assertUnique(
        samples.map((sample) => sample.sentenceId),
        'textbook gold candidates.sentenceId',
        errors,
      );
      if (samples.length < 20) errors.push('textbook gold candidates must keep at least 20 samples');
      const bundleStrings = new Map();
      for (const bookId of ['XinBian1', 'XinBian2', 'XinBian3', 'XinBian4']) {
        const bundle = readJsonFile(`data/textbook/canonical_books/${bookId}.bundle.json`, errors);
        const strings = [];
        const collectStrings = (value) => {
          if (typeof value === 'string') strings.push(value);
          else if (Array.isArray(value)) value.forEach(collectStrings);
          else if (value && typeof value === 'object') Object.values(value).forEach(collectStrings);
        };
        collectStrings(bundle);
        bundleStrings.set(bookId, strings);
      }
      const allowedStatuses = new Set(['pending-human', 'approved', 'needs-correction']);
      samples.forEach((sample) => {
        const label = sample.id || sample.sentenceId || '(unknown sample)';
        const tokenSentence = tokenById.get(sample.sentenceId);
        const chunkSentence = chunkById.get(sample.sentenceId);
        if (!tokenSentence || !chunkSentence) {
          errors.push(`textbook gold candidate references missing sentence: ${label}`);
          return;
        }
        if (!allowedStatuses.has(sample.status))
          errors.push(`textbook gold candidate has invalid status: ${label}`);
        if (sample.observedText !== tokenSentence.text || sample.observedText !== chunkSentence.text)
          errors.push(`textbook gold candidate drifted from tokens/chunks: ${label}`);
        if (
          sample.bookId !== tokenSentence.book_id ||
          sample.lessonId !== tokenSentence.lesson_id ||
          sample.section !== tokenSentence.section
        )
          errors.push(`textbook gold candidate metadata mismatch: ${label}`);
        const sourceStrings = bundleStrings.get(sample.bookId) || [];
        if (!sourceStrings.some((value) => value.includes(sample.observedText)))
          errors.push(`textbook gold candidate is not traceable to canonical bundle: ${label}`);
        if (sample.status === 'approved') {
          if (!sample.expectedText || sample.expectedText !== sample.observedText)
            errors.push(`approved textbook gold candidate must match runtime text: ${label}`);
          if (!sample.reference || !sample.reviewedAt || !sample.reviewNote)
            errors.push(`approved textbook gold candidate is missing review evidence: ${label}`);
        }
        if (
          sample.status === 'needs-correction' &&
          (!sample.expectedText || !sample.reference || !sample.reviewNote)
        )
          errors.push(`textbook gold candidate correction lacks evidence: ${label}`);
      });
    }
  }
  const wikiChunks = readJsonFile('data/wiki/processed/textbook_wiki_reading_chunks.v1.json', errors);
  const wikiCandidates = readJsonFile('data/wiki/processed/textbook_wiki_reading_candidates.v1.json', errors);
  if (wikiChunks && assertArray(wikiChunks.readings, 'Wiki chunks.readings', errors))
    assertUnique(
      wikiChunks.readings.map((reading) => `${reading.bookId}:${reading.lessonId}`),
      'Wiki chunks reading key',
      errors,
    );
  if (wikiCandidates && assertArray(wikiCandidates.readings, 'Wiki candidates.readings', errors))
    assertUnique(
      wikiCandidates.readings.map((reading) => `${reading.bookId}:${reading.lessonId}`),
      'Wiki candidates reading key',
      errors,
    );

  return errors;
}

function resolveManifestTarget(rootDirectory, candidate) {
  if (typeof candidate !== 'string' || !candidate.trim()) return null;
  const normalizedCandidate = candidate.trim().replace(/\\/g, '/');
  const rootName = path.basename(rootDirectory);
  const marker = `${rootName}/`;
  const markerIndex = normalizedCandidate.indexOf(marker);
  const relativePath =
    markerIndex >= 0 ? normalizedCandidate.slice(markerIndex + marker.length) : normalizedCandidate;
  const target = path.resolve(rootDirectory, relativePath);
  const relative = path.relative(rootDirectory, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return target;
}

function readWavHeader(filePath) {
  const buffer = Buffer.alloc(12);
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, 'r');
    const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
    return (
      bytesRead === 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WAVE'
    );
  } catch (error) {
    return false;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function validateAudioRoots(specs) {
  const errors = [];
  let manifestCount = 0;
  let audioCount = 0;
  for (const spec of specs) {
    const rootDirectory = absoluteFromRelative(spec.paths[0]);
    if (!exists(rootDirectory)) continue;
    const manifestFiles = walkFiles(rootDirectory).filter(
      (filePath) => path.basename(filePath).toLowerCase() === 'manifest.jsonl',
    );
    for (const manifestFile of manifestFiles) {
      const relativeManifest = normalizeRelative(manifestFile);
      const records = readJsonLines(relativeManifest, errors);
      manifestCount += records.length;
      for (const record of records) {
        const candidate = record.audio_relpath || record.output;
        const target = resolveManifestTarget(rootDirectory, candidate);
        if (!target) {
          errors.push(`audio manifest target is unsafe or missing: ${relativeManifest}`);
          continue;
        }
        if (!exists(target) || fs.statSync(target).size === 0) {
          errors.push(`audio manifest target missing or empty: ${normalizeRelative(target)}`);
        } else if (path.extname(target).toLowerCase() === '.wav' && !readWavHeader(target)) {
          errors.push(`invalid WAV header: ${normalizeRelative(target)}`);
        }
      }
    }
    const wavFiles = walkFiles(rootDirectory).filter(
      (filePath) => path.extname(filePath).toLowerCase() === '.wav',
    );
    audioCount += wavFiles.length;
    for (const filePath of wavFiles) {
      if (fs.statSync(filePath).size === 0) errors.push(`empty audio file: ${normalizeRelative(filePath)}`);
      else if (!readWavHeader(filePath)) errors.push(`invalid WAV header: ${normalizeRelative(filePath)}`);
    }
  }
  return { errors, manifestCount, audioCount };
}

function validateImages() {
  const errors = [];
  const imageFiles = filesForPaths([IMAGE_ROOT], ['.png']);
  const imagePaths = new Set(imageFiles.map(normalizeRelative));
  for (const filePath of imageFiles) {
    const buffer = Buffer.alloc(24);
    let descriptor;
    try {
      descriptor = fs.openSync(filePath, 'r');
      const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
      if (bytesRead < 24 || buffer.readUInt32BE(0) !== 0x89504e47 || buffer.readUInt32BE(4) !== 0x0d0a1a0a) {
        errors.push(`invalid PNG signature: ${normalizeRelative(filePath)}`);
      } else if (buffer.readUInt32BE(16) === 0 || buffer.readUInt32BE(20) === 0) {
        errors.push(`invalid PNG dimensions: ${normalizeRelative(filePath)}`);
      }
    } catch (error) {
      errors.push(`cannot read PNG: ${normalizeRelative(filePath)} (${error.message})`);
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
  }
  if (!imageFiles.length) errors.push('no textbook PNG files found');
  const imageManifestAbsolute = absoluteFromRelative(IMAGE_MANIFEST_PATH);
  if (!exists(imageManifestAbsolute)) {
    errors.push(`missing image manifest: ${IMAGE_MANIFEST_PATH}`);
  } else {
    const records = readJsonLines(IMAGE_MANIFEST_PATH, errors);
    assertUnique(
      records.map((record) => record.path),
      'image manifest.path',
      errors,
    );
    if (records.length !== imageFiles.length)
      errors.push(`image manifest has ${records.length} records for ${imageFiles.length} PNG files`);
    const validLessonIds = new Set();
    for (const bookId of ['XinBian1', 'XinBian2', 'XinBian3', 'XinBian4']) {
      const bundle = readJsonFile(`data/textbook/canonical_books/${bookId}.bundle.json`, errors);
      for (const item of (bundle && bundle.items) || []) {
        if (item.lesson && item.lesson.item_id) validLessonIds.add(`${bookId}:${item.lesson.item_id}`);
      }
    }
    for (const record of records) {
      if (!imagePaths.has(record.path))
        errors.push(`image manifest path missing from image directory: ${record.path}`);
      if (!validLessonIds.has(`${record.bookId}:${record.lessonId}`))
        errors.push(`image manifest lesson mapping is unknown: ${record.bookId}/${record.lessonId}`);
      if (
        !Number.isInteger(record.width) ||
        record.width <= 0 ||
        !Number.isInteger(record.height) ||
        record.height <= 0
      ) {
        errors.push(`image manifest dimensions are invalid: ${record.path}`);
      }
    }
  }
  return { errors, count: imageFiles.length };
}

async function verifyChecksumFile(relativeChecksumPath) {
  const checksumPath = absoluteFromRelative(relativeChecksumPath);
  if (!exists(checksumPath))
    return {
      file: relativeChecksumPath,
      missingManifest: true,
      checked: 0,
      errors: [`missing checksum file: ${relativeChecksumPath}`],
    };
  const lines = fs.readFileSync(checksumPath, 'utf8').split(/\r?\n/);
  const entries = lines.map(parseChecksumLine).filter(Boolean);
  const errors = [];
  let emptyCount = 0;
  for (const entry of entries) {
    const target = absoluteFromRelative(entry.relativePath);
    const relativeTarget = normalizeRelative(target);
    if (relativeTarget !== entry.relativePath || relativeTarget.startsWith('../')) {
      errors.push(`unsafe path: ${entry.relativePath}`);
      continue;
    }
    if (!exists(target)) {
      errors.push(`missing: ${entry.relativePath}`);
      continue;
    }
    const stat = fs.statSync(target);
    if (!stat.isFile()) {
      errors.push(`not a file: ${entry.relativePath}`);
      continue;
    }
    if (stat.size === 0) {
      emptyCount += 1;
      errors.push(`empty: ${entry.relativePath}`);
      continue;
    }
    const actual = await hashFile(target);
    if (actual !== entry.expected) errors.push(`hash mismatch: ${entry.relativePath}`);
  }
  return { file: relativeChecksumPath, checked: entries.length, emptyCount, errors };
}

function validateInventoryShape(manifest) {
  const errors = [];
  if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.packs)) {
    return ['resource manifest is missing schemaVersion 1 or packs'];
  }
  const ids = new Set();
  for (const record of manifest.packs) {
    if (!record.id || ids.has(record.id))
      errors.push(`duplicate or missing resource id: ${record.id || '(empty)'}`);
    ids.add(record.id);
    if (!Array.isArray(record.paths) || !record.paths.length) errors.push(`missing paths: ${record.id}`);
    if (!Number.isInteger(record.fileCount) || record.fileCount < 0)
      errors.push(`invalid fileCount: ${record.id}`);
    if (!Number.isInteger(record.bytes) || record.bytes < 0) errors.push(`invalid bytes: ${record.id}`);
  }
  return errors;
}

async function verifyResources(args) {
  if (!exists(MANIFEST_PATH)) {
    console.error(`Missing ${normalizeRelative(MANIFEST_PATH)}; run npm run resources:inventory first.`);
    process.exitCode = 1;
    return;
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const errors = validateInventoryShape(manifest);
  const reports = [];
  const canonicalErrors = validateCanonicalData();
  errors.push(...canonicalErrors);
  const imageReport = validateImages();
  errors.push(...imageReport.errors);
  console.log(
    `canonical data: JSON/JSONL, uniqueness and cross-references checked; ${imageReport.count} PNG dimensions checked`,
  );
  reports.push(await verifyChecksumFile(manifest.checksumFiles.canonical));
  if (args.includeLocalAudio) {
    reports.push(await verifyChecksumFile(manifest.checksumFiles.runtime));
    const audioReport = validateAudioRoots(ACTIVE_AUDIO);
    errors.push(...audioReport.errors);
    console.log(
      `active audio: ${audioReport.manifestCount} manifest entries and ${audioReport.audioCount} WAV files checked`,
    );
  }
  if (args.includeArchive) {
    reports.push(await verifyChecksumFile(manifest.checksumFiles.archive));
    const audioReport = validateAudioRoots(ARCHIVE_AUDIO);
    errors.push(...audioReport.errors);
    console.log(
      `archive audio: ${audioReport.manifestCount} manifest entries and ${audioReport.audioCount} WAV files checked`,
    );
  }
  if (args.includeModels) reports.push(await verifyChecksumFile(manifest.checksumFiles.models));
  for (const report of reports) {
    errors.push(...report.errors);
    console.log(
      `${report.file}: checked ${report.checked || 0} entries${report.errors.length ? `, ${report.errors.length} error(s)` : ', OK'}`,
    );
  }
  if (!args.includeLocalAudio)
    console.log('runtime audio skipped; add --include-local-audio to verify ignored active audio.');
  if (!args.includeArchive)
    console.log('archive audio skipped; add --include-archive to verify optional archive audio.');
  if (!args.includeModels)
    console.log('model pack skipped; add --include-models to verify local Qwen files.');
  if (errors.length) {
    console.error(`Resource validation failed with ${errors.length} error(s).`);
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log('Resource validation passed.');
  }
}

function writeInventory() {
  const inventory = collectInventory();
  const manifest = publicManifest(inventory);
  writeJson(MANIFEST_PATH, manifest);
  fs.writeFileSync(PACKS_PATH, makePacksMarkdown(manifest), 'utf8');
  console.log(`Wrote ${normalizeRelative(MANIFEST_PATH)} and ${normalizeRelative(PACKS_PATH)}.`);
  for (const record of manifest.packs) {
    console.log(
      `${record.id}: ${record.fileCount.toLocaleString('en-US')} files, ${record.humanSize}${record.present ? '' : ' (not present)'}`,
    );
  }
}

async function main() {
  const [command = 'inventory', ...flags] = process.argv.slice(2);
  const args = {
    includeLocalAudio: flags.includes('--include-local-audio'),
    includeArchive: flags.includes('--include-archive'),
    includeModels: flags.includes('--include-models'),
  };
  if (command === 'inventory') {
    writeInventory();
    return;
  }
  if (command === 'checksum') {
    const inventory = collectInventory();
    await writeChecksums(inventory);
    return;
  }
  if (command === 'verify') {
    await verifyResources(args);
    return;
  }
  console.error(`Unknown command: ${command}`);
  console.error('Use inventory, checksum, or verify.');
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
