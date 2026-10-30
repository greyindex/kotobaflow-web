// Local lab measurement, not a public CDN or physical-device benchmark.
const { chromium } = require('@playwright/test');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const label = process.argv[2] || 'current';
const includeLesson = process.argv.includes('--lesson');
const nextLesson = process.argv.find((arg) => arg.startsWith('--next-lesson='))?.split('=')[1];
if (nextLesson && (!includeLesson || !/^lesson_\d{2}$/.test(nextLesson)))
  throw Error('Use --lesson with --next-lesson=lesson_02');
if (!/^[a-z0-9-]+$/.test(label)) throw Error('Use a simple report label');
const url = 'http://127.0.0.1:18086';
async function main() {
  // Never attach measurements to a pre-existing server or personal progress file.
  try {
    await fetch(url);
    throw Error('Measurement port already occupied');
  } catch (error) {
    if (error.message !== 'fetch failed') throw error;
  }
  const server = spawn('python', ['serve.py', '--port', '18086', '--no-browser', '--temporary-progress'], {
    cwd: root,
    windowsHide: true,
    stdio: 'ignore',
  });
  let browser;
  const samples = [];
  try {
    for (let i = 0; ; i++) {
      try {
        await fetch(url);
        break;
      } catch {
        if (i >= 100) throw Error('Measurement server unavailable');
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    browser = await chromium.launch();
    for (let run = 0; run < 3; run++) {
      const context = await browser.newContext({
        viewport: { width: 1600, height: 900 },
        serviceWorkers: 'block',
      });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Performance.enable');
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 120,
        downloadThroughput: 500000,
        uploadThroughput: 125000,
      });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      let bytes = 0,
        requests = 0;
      const included = new Set();
      cdp.on('Network.requestWillBeSent', (event) => {
        if (!event.request.url.includes('/api/')) {
          included.add(event.requestId);
          requests++;
        }
      });
      cdp.on('Network.loadingFinished', (event) => {
        if (included.has(event.requestId)) bytes += event.encodedDataLength;
      });
      for (const cache of ['cold', 'warm-http']) {
        if (cache === 'cold') await cdp.send('Network.clearBrowserCache');
        bytes = 0;
        requests = 0;
        included.clear();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
        await page.waitForFunction(
          () =>
            document.querySelector('#loading')?.classList.contains('hidden') &&
            Number(document.querySelector('#statusTotal')?.textContent.replace(/,/g, '')) > 0,
          null,
          { timeout: 120000 },
        );
        const appReadyMs = await page.evaluate(() => performance.now());
        await page.evaluate(() => TextbookLoader.getBookIndex('XinBian1'));
        const catalogReadyMs = await page.evaluate(() => performance.now());
        let lessonReadyMs = null,
          nextLessonMs = null,
          nextLessonBytes = null;
        if (includeLesson) {
          await page.locator('#modBtnLesson').click();
          await page.locator('.tb-reader-body').waitFor({ state: 'visible', timeout: 120000 });
          await page.waitForFunction(
            () => {
              const image = document.querySelector('.tb-reader-lead-media .tb-section-image');
              return image && image.complete && image.naturalWidth > 0;
            },
            null,
            { timeout: 120000 },
          );
          lessonReadyMs = await page.evaluate(() => performance.now());
          if (nextLesson) {
            const start = await page.evaluate(() => performance.now());
            const startBytes = bytes;
            await page.locator('.tb-lesson-directory > summary').click();
            await page.locator('.tb-lesson-card[data-lesson-id="' + nextLesson + '"]').click();
            await page.waitForFunction(
              () => document.querySelector('#tbLoading').classList.contains('hidden'),
              null,
              { timeout: 120000 },
            );
            await page.locator('.tb-reader-body').waitFor({ state: 'visible' });
            await page.waitForFunction(
              () => {
                const image = document.querySelector('.tb-reader-lead-media .tb-section-image');
                return image && image.complete && image.naturalWidth > 0;
              },
              null,
              { timeout: 120000 },
            );
            nextLessonMs = (await page.evaluate(() => performance.now())) - start;
            nextLessonBytes = bytes - startBytes;
          }
        }
        await cdp.send('HeapProfiler.collectGarbage');
        const metrics = Object.fromEntries(
          (await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]),
        );
        samples.push({
          run,
          cache,
          appReadyMs,
          catalogReadyMs,
          lessonReadyMs,
          nextLessonMs,
          nextLessonBytes,
          bytes,
          requests,
          scriptSeconds: metrics.ScriptDuration,
          heapBytes: metrics.JSHeapUsedSize,
        });
      }
      await context.close();
    }
    const report = {
      label,
      conditions: {
        viewport: '1600x900',
        includeLesson,
        nextLesson: nextLesson || null,
        downloadBytesPerSecond: 500000,
        latencyMs: 120,
        cpuSlowdown: 4,
        serviceWorkers: 'blocked',
        server: 'local Python HTTP/1.1 static keep-alive; no CDN/compression; temporary progress',
        samplesPerCache: 3,
      },
      samples,
    };
    const file = path.join(root, 'local/qa', `loading-${label}.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
