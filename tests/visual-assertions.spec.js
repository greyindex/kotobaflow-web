const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { PNG } = require('pngjs');
const { expectScreenshotIgnoringVerticalEdges } = require('./visual-assertions');

function temporaryDirectory(testInfo) {
  const outputRoot = testInfo.outputPath('visual-helper');
  fs.mkdirSync(outputRoot, { recursive: true });
  return fs.mkdtempSync(path.join(outputRoot, 'case-'));
}

function screenshot(kind = 'baseline') {
  const png = new PNG({ width: kind === 'resized' ? 41 : 40, height: 30 });
  png.data.fill(255);
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const edge = x < 4 || x >= png.width - 4;
      const interior = x >= 15 && x < 20 && y >= 10 && y < 15;
      if ((kind === 'edge' && edge) || (kind === 'interior' && interior))
        png.data.fill(0, (y * png.width + x) * 4, (y * png.width + x) * 4 + 3);
    }
  }
  return PNG.sync.write(png);
}

function fixture(testInfo, update, actual, expected = screenshot()) {
  const directory = temporaryDirectory(testInfo);
  const snapshotPath = path.join(directory, 'snapshots', 'baseline.png');
  if (expected) {
    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
    fs.writeFileSync(snapshotPath, expected);
  }
  let captures = 0;
  const attachments = [];
  const locator = {
    screenshot: async () => {
      captures++;
      return typeof actual === 'function' ? actual(captures) : actual;
    },
  };
  return {
    snapshotPath,
    attachments,
    captures: () => captures,
    run: () =>
      expectScreenshotIgnoringVerticalEdges(
        locator,
        'baseline.png',
        {
          config: { ...testInfo.config, updateSnapshots: update },
          snapshotPath: () => snapshotPath,
          attach: async (name, options) => attachments.push({ name, ...options }),
        },
        { timeout: 300 },
      ),
  };
}

for (const update of ['all', 'changed', 'missing', 'none']) {
  for (const kind of ['interior', 'resized']) {
    test(`FIX-17 ${update} handles ${kind} screenshot changes without altering other baselines`, async ({
      browserName,
    }, testInfo) => {
      const expected = screenshot();
      const actual = screenshot(kind);
      const sample = fixture(testInfo, update, actual, expected);
      if (update === 'all' || update === 'changed') {
        await sample.run();
        expect(sample.captures()).toBeGreaterThanOrEqual(2);
        expect(fs.readFileSync(sample.snapshotPath)).toEqual(actual);
      } else {
        await expect(sample.run()).rejects.toThrow('interior must have zero differing pixels');
        expect(fs.readFileSync(sample.snapshotPath)).toEqual(expected);
        expect(sample.attachments.map((attachment) => attachment.name)).toEqual([
          'baseline.png-expected',
          'baseline.png-actual',
        ]);
        expect(sample.attachments[1].body).toEqual(actual);
      }
    });
  }
}

for (const update of ['all', 'changed', 'none']) {
  test(`FIX-17 ${update} preserves the vertical edge exclusion when deciding whether to update`, async ({
    browserName,
  }, testInfo) => {
    const expected = screenshot();
    const actual = screenshot('edge');
    const sample = fixture(testInfo, update, actual, expected);
    await sample.run();
    expect(fs.readFileSync(sample.snapshotPath)).toEqual(update === 'all' ? actual : expected);
  });
}

for (const update of ['all', 'changed']) {
  test(`FIX-17 ${update} creates an absent baseline in a new directory`, async ({
    browserName,
  }, testInfo) => {
    const actual = screenshot('interior');
    const sample = fixture(testInfo, update, actual, null);
    await sample.run();
    expect(fs.readFileSync(sample.snapshotPath)).toEqual(actual);
    expect(sample.captures()).toBeGreaterThanOrEqual(2);
  });
}

test('FIX-17 none rejects a missing baseline without creating a file or taking a screenshot', async ({
  browserName,
}, testInfo) => {
  const sample = fixture(testInfo, 'none', screenshot(), null);
  await expect(sample.run()).rejects.toThrow("A snapshot doesn't exist at");
  expect(fs.existsSync(sample.snapshotPath)).toBe(false);
  expect(sample.captures()).toBe(0);
});

test('FIX-17 missing creates the baseline, continues assertions, and fails the runner', ({
  browserName,
}, testInfo) => {
  const directory = temporaryDirectory(testInfo);
  const actual = screenshot('interior');
  fs.writeFileSync(path.join(directory, 'actual.png'), actual);
  const testSource = `
    const { test } = require('@playwright/test');
    const fs = require('node:fs');
    const path = require('node:path');
    const { expectScreenshotIgnoringVerticalEdges } = require(${JSON.stringify(path.join(__dirname, 'visual-assertions.js'))});
    test('missing baseline', async ({}, info) => {
      fs.writeFileSync(path.join(__dirname, 'snapshot-path.txt'), info.snapshotPath('baseline.png'));
      await expectScreenshotIgnoringVerticalEdges(
        { screenshot: async () => fs.readFileSync(path.join(__dirname, 'actual.png')) },
        'baseline.png', info, { timeout: 1000 });
      fs.writeFileSync(path.join(__dirname, 'continued.txt'), 'yes');
    });
  `;
  fs.writeFileSync(path.join(directory, 'missing.spec.js'), testSource);
  const reportPath = path.join(directory, 'report.json');
  const configPath = path.join(directory, 'playwright.config.js');
  fs.writeFileSync(
    configPath,
    'module.exports = ' +
      JSON.stringify({
        testDir: directory,
        testMatch: 'missing.spec.js',
        updateSnapshots: 'missing',
        workers: 1,
        timeout: 10000,
        outputDir: path.join(directory, 'results'),
        reporter: [['json', { outputFile: reportPath }]],
      }),
  );
  const cli = path.join(path.dirname(require.resolve('@playwright/test/package.json')), 'cli.js');
  const result = spawnSync(process.execPath, [cli, 'test', '--config', configPath], {
    encoding: 'utf8',
    timeout: 15000,
  });
  expect(result.error, result.stderr).toBeUndefined();
  expect(result.status, result.stdout + result.stderr).toBe(1);
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  expect(report.stats.unexpected).toBe(1);
  const errors = report.suites[0].specs[0].tests[0].results[0].errors;
  expect(errors).toHaveLength(1);
  expect(errors[0].message).toContain("A snapshot doesn't exist at");
  expect(errors[0].message).toContain('writing actual.');
  expect(fs.readFileSync(path.join(directory, 'continued.txt'), 'utf8')).toBe('yes');
  const snapshotPath = fs.readFileSync(path.join(directory, 'snapshot-path.txt'), 'utf8');
  expect(fs.readFileSync(snapshotPath)).toEqual(actual);
});

test('FIX-17 all leaves an identical baseline file untouched', async ({ browserName }, testInfo) => {
  const expected = screenshot();
  const sample = fixture(testInfo, 'all', expected, expected);
  fs.utimesSync(sample.snapshotPath, new Date(0), new Date(0));
  await sample.run();
  expect(fs.statSync(sample.snapshotPath).mtimeMs).toBe(0);
});

test('FIX-17 changed preserves the baseline when a screenshot capture fails', async ({
  browserName,
}, testInfo) => {
  const expected = screenshot();
  const sample = fixture(testInfo, 'changed', (capture) => {
    if (capture > 1) throw new Error('capture failed');
    return screenshot('interior');
  });
  await expect(sample.run()).rejects.toThrow('capture failed');
  expect(fs.readFileSync(sample.snapshotPath)).toEqual(expected);
});

test('FIX-17 all rejects unstable screenshot captures without overwriting the baseline', async ({
  browserName,
}, testInfo) => {
  const expected = screenshot();
  const sample = fixture(testInfo, 'all', (capture) => screenshot(capture % 2 ? 'interior' : 'baseline'));
  await expect(sample.run()).rejects.toThrow('interior must have zero differing pixels');
  expect(fs.readFileSync(sample.snapshotPath)).toEqual(expected);
});
