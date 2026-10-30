'use strict';

/**
 * Build the image-to-course mapping that can be recovered from canonical bundle
 * metadata. Historical model/prompt/license fields stay null when the checkout
 * cannot prove them; this script never infers generation provenance from pixels.
 */

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const IMAGE_ROOT = path.join(ROOT, 'image');
const OUTPUT = path.join(ROOT, 'resources', 'provenance', 'image-generation.jsonl');

function normalize(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function pngDimensions(filePath) {
  const header = Buffer.alloc(24);
  const descriptor = fs.openSync(filePath, 'r');
  try {
    const bytesRead = fs.readSync(descriptor, header, 0, header.length, 0);
    if (bytesRead < 24 || header.readUInt32BE(0) !== 0x89504e47 || header.readUInt32BE(4) !== 0x0d0a1a0a) {
      throw new Error(`Invalid PNG: ${filePath}`);
    }
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
  } finally {
    fs.closeSync(descriptor);
  }
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function listImages() {
  const images = [];
  for (const bookId of ['XinBian1', 'XinBian2', 'XinBian3', 'XinBian4']) {
    const bookRoot = path.join(IMAGE_ROOT, bookId);
    if (!fs.existsSync(bookRoot)) continue;
    for (const fileName of fs
      .readdirSync(bookRoot)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
      if (!fileName.toLowerCase().endsWith('.png')) continue;
      const stem = fileName.slice(0, -4);
      const numeric = /^\d+$/.test(stem);
      const review = /^r(\d+)$/i.exec(stem);
      const isPhonetic = stem.toLowerCase() === 'unit1';
      let lessonId = null;
      let reviewUnitNo = null;
      if (numeric) lessonId = `lesson_${stem.padStart(2, '0')}`;
      else if (review) {
        reviewUnitNo = Number(review[1]);
        lessonId = `review_unit_${String(reviewUnitNo).padStart(2, '0')}`;
      } else if (isPhonetic) lessonId = 'lesson_01';
      const absolutePath = path.join(bookRoot, fileName);
      const dimensions = pngDimensions(absolutePath);
      images.push({
        path: normalize(path.relative(ROOT, absolutePath)),
        bookId,
        lessonId,
        reviewUnitNo,
        kind: isPhonetic ? 'phonetic-chart' : review ? 'review-lesson' : 'lesson-header',
        width: dimensions.width,
        height: dimensions.height,
        sha256: sha256(absolutePath),
        status: 'final',
        source:
          'project image asset; course mapping recovered from filename and canonical bundle conventions',
        generation: {
          model: null,
          prompt: null,
          finalPrompt: null,
          referenceImages: [],
          generationDate: null,
          generationId: null,
        },
        postprocessing: {
          originalPath: null,
          operations: null,
          evidence: null,
        },
        provenanceStatus: 'historical-generation-metadata-pending-RES-200',
        humanReview: 'pending-RES-406',
      });
    }
  }
  return images;
}

const images = listImages();
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, `${images.map((image) => JSON.stringify(image)).join('\n')}\n`, 'utf8');
console.log(`Wrote ${images.length} image records to resources/provenance/image-generation.jsonl.`);
