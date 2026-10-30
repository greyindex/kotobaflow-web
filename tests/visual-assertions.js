const fs = require('node:fs');
const path = require('node:path');
const { expect } = require('@playwright/test');
const { PNG } = require('pngjs');
const pixelmatchReady = import('pixelmatch').then((module) => module.default);

// Only the four outermost columns on each side are excluded. Keep the same
// color/antialias comparison as Playwright; allow zero differing interior pixels.
async function compareVerticalEdgeScreenshot(actualBytes, expectedBytes) {
  const actual = PNG.sync.read(actualBytes);
  const expected = PNG.sync.read(expectedBytes);
  const { width, height } = expected;
  if (actual.width !== width || actual.height !== height || width <= 8)
    return { dimensionsMatch: false, differingPixels: null };
  const diff = new PNG({ width, height });
  const pixelmatch = await pixelmatchReady;
  pixelmatch(actual.data, expected.data, diff.data, width, height, { threshold: 0.2, diffMask: true });
  let differingPixels = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 4; x < width - 4; x++) {
      if (diff.data[(y * width + x) * 4 + 3]) differingPixels++;
    }
  }
  return { dimensionsMatch: true, differingPixels };
}

async function expectScreenshotIgnoringVerticalEdges(locator, name, testInfo, options = {}) {
  const snapshotPath = testInfo.snapshotPath(name);
  const update = testInfo.config.updateSnapshots;
  const expected = fs.existsSync(snapshotPath) ? fs.readFileSync(snapshotPath) : null;
  const missingMessage = `A snapshot doesn't exist at ${snapshotPath}`;
  if (!expected && update === 'none') throw new Error(`${missingMessage}.`);
  const canGenerate = !expected || update === 'all' || update === 'changed';
  let actual;
  let baselineMatches = false;
  try {
    await expect
      .poll(
        async () => {
          const previous = actual;
          actual = await locator.screenshot({ animations: 'disabled' });
          const matches = async (reference) => {
            const result = await compareVerticalEdgeScreenshot(actual, reference);
            return result.dimensionsMatch && result.differingPixels === 0;
          };
          baselineMatches = !!expected && (await matches(expected));
          if (update !== 'all' && baselineMatches) return true;
          // As with toHaveScreenshot(), generate only after two stable captures.
          return canGenerate && !!previous && (await matches(previous));
        },
        {
          timeout: options.timeout ?? 10_000,
          message: `${name}: size must match and interior must have zero differing pixels`,
        },
      )
      .toBe(true);
  } catch (error) {
    if (expected) await testInfo.attach(`${name}-expected`, { body: expected, contentType: 'image/png' });
    if (actual) await testInfo.attach(`${name}-actual`, { body: actual, contentType: 'image/png' });
    throw error;
  }
  if (!expected || (update === 'all' ? !actual.equals(expected) : !baselineMatches)) {
    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
    fs.writeFileSync(snapshotPath, actual);
  }
  if (!expected) {
    await testInfo.attach(`${name}-expected`, { body: actual, contentType: 'image/png' });
    await testInfo.attach(`${name}-actual`, { body: actual, contentType: 'image/png' });
    // Playwright's default missing mode writes a baseline but still fails the
    // current test, allowing later assertions to run. Explicit updates pass.
    if (update === 'missing') expect.soft(false, `${missingMessage}, writing actual.`).toBe(true);
  }
}

module.exports = { compareVerticalEdgeScreenshot, expectScreenshotIgnoringVerticalEdges };
