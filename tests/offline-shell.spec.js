const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { buildManifest, source, hash } = require('../tools/generate_sw_manifest.cjs');
const { closeSidebar, openReadyApp, openSettings } = require('./helpers');

function release(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-shell-test-'));
  if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep + 'jp-shell-test-'))
    throw Error('Unexpected temporary path');
  try {
    const vocabulary = JSON.stringify({ label });
    const coreChunk = hash(vocabulary) + '.json';
    const files = {
      '/index.html':
        '<!doctype html><html><head><meta charset="utf-8"><title>Shell test</title><script src="./app.js"></script><script src="./js/loader.js"></script><script src="./js/pwa.js"></script></head><body><div id="appPwaStatus"><span id="appPwaStatusText"></span><button id="appPwaInstallBtn" hidden>Install</button></div></body></html>',
      '/app.js': `document.documentElement.dataset.release=${JSON.stringify(label)};`,
      '/js/loader.js': '/* Startup vocabulary dependency in this fixture. */',
      '/js/pwa.js': fs.readFileSync(path.join(__dirname, '../js/pwa.js'), 'utf8'),
      '/sw.js': fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8'),
      '/data/vocab_chunks/index.json': JSON.stringify({ version: 2, chunks: [coreChunk] }),
      ['/data/vocab_chunks/' + coreChunk]: vocabulary,
      '/data/grammar_index.json': JSON.stringify([{ label }]),
      '/resources/checksums/canonical-assets.sha256': '0'.repeat(64) + '  data/grammar_index.json\n',
    };
    for (const entry of ['vocabulary', 'grammar', 'textbook']) {
      files['/' + entry + '/index.html'] = files['/index.html']
        .replace('<head>', '<head><base href="/">')
        .replace('Shell test', entry + ' shell');
    }
    for (const name of [
      'domain_taxonomy',
      'semantic_tag_taxonomy',
      'pos',
      'register',
      'transitivity',
      'style',
      'freq_band',
    ])
      files['/data/' + name + '.json'] = '{}';
    for (const [url, body] of Object.entries(files)) {
      const file = path.join(root, url.slice(1));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, body);
    }
    const manifest = buildManifest(root);
    files['/sw-manifest.js'] = source(manifest);
    return { files, manifest, coreChunk };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function fixture({ redirectIndex = false } = {}) {
  const state = { current: release('A'), missing: new Set(), corrupt: new Set() };
  const server = http.createServer((req, res) => {
    let file = new URL(req.url, 'http://localhost').pathname;
    if (redirectIndex && file === '/index.html') {
      res.writeHead(302, { Location: '/' });
      res.end();
      return;
    }
    if (file.endsWith('/')) file += 'index.html';
    let body = state.current.files[file];
    if (body === undefined && /^\/data\/test-/.test(file))
      body = file.endsWith('.json') ? '{}' : 'test-media';
    if (file === '/data/user_progress.json') body = '{"private":true}';
    if (file === '/api/progress') body = '{"private":true}';
    if (state.missing.has(file) || body === undefined) {
      res.writeHead(404);
      res.end();
      return;
    }
    if (state.corrupt.has(file)) body += '\ncorrupt';
    res.writeHead(200, {
      'Content-Type': file.endsWith('.js')
        ? 'application/javascript'
        : file.endsWith('.html')
          ? 'text/html'
          : 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    ...state,
    get current() {
      return state.current;
    },
    set current(value) {
      state.current = value;
    },
    url: `http://127.0.0.1:${server.address().port}/`,
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  };
}
async function ready(page, url) {
  await page.goto(url);
  await expect.poll(() => page.evaluate(() => window.AppPWA?.getState().ready)).toBe(true);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}
async function update(page) {
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration()).update();
  });
}
async function activate(page, url) {
  const waiting = await page.evaluateHandle(
    async () => (await navigator.serviceWorker.getRegistration()).waiting,
  );
  // Leaving the scope releases the old client without skipWaiting or data loss.
  const worker = page.context().serviceWorkers().at(-1);
  await page.goto('about:blank');
  await expect.poll(() => worker.evaluate(() => self.registration.waiting === null)).toBe(true);
  await waiting.dispose();
  await page.goto(url);
}

test('SEO-01 offline directory entries use their own verified shell on first open and reload', async ({
  page,
}) => {
  const site = await fixture({ redirectIndex: true });
  try {
    await ready(page, site.url);
    await page.context().setOffline(true);
    for (const entry of ['vocabulary', 'grammar', 'textbook']) {
      await page.goto(site.url + entry + '/');
      await expect(page).toHaveTitle(entry + ' shell');
      await expect(page.locator('html')).toHaveAttribute('data-release', 'A');
      await page.reload();
      await expect(page).toHaveTitle(entry + ' shell');
      await expect(page.locator('html')).toHaveAttribute('data-release', 'A');
    }
  } finally {
    await page.context().setOffline(false);
    await site.close();
  }
});

test('first visit prepares core learning offline without an extra online reload or HTTP cache', async ({
  page,
}) => {
  await openReadyApp(page);
  await expect.poll(() => page.evaluate(() => window.AppPWA.getState().ready)).toBe(true);
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(false);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.clearBrowserCache');
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.locator('#loading')).toHaveClass(/hidden/);
  await openSettings(page);
  await page.keyboard.press('Control+k');
  await expect(page.locator('#globalSearchOverlay')).toBeVisible();
  await expect(page.locator('#appSettingsPanel')).toBeHidden();
  await page.keyboard.press('Escape');
  await closeSidebar(page);
  await page.locator('#modBtnDashboard').click();
  await page.locator('.dashboard-task-card[data-dashboard-action="start-new"]').click();
  await expect(page.locator('#statusStudyQueue')).toHaveText('20');
  await page.screenshot({ path: 'local/qa/review-fix-first-offline.png' });
});

test('redirected index responses support controlled reload, offline reload and cache recovery', async ({
  page,
  context,
}) => {
  const app = await fixture({ redirectIndex: true });
  try {
    await ready(page, app.url);
    const indexUrl = new URL('index.html', app.url).href;
    expect(await page.evaluate(async (url) => (await caches.match(url)).redirected, indexUrl)).toBe(true);
    await page.evaluate(() => localStorage.setItem('progress-probe', 'saved'));
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-release', 'A');
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-release', 'A');
    expect(await page.evaluate(() => localStorage.getItem('progress-probe'))).toBe('saved');
    await context.setOffline(false);
    await page.evaluate(async (url) => {
      for (const name of await caches.keys()) await (await caches.open(name)).delete(url);
    }, indexUrl);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-release', 'A');
    expect(await page.evaluate(async (url) => !!(await caches.match(url)), indexUrl)).toBe(true);
  } finally {
    await context.setOffline(false);
    await app.close();
  }
});

for (const missing of ['script', 'index', 'chunk', 'taxonomy']) {
  test(`missing mandatory ${missing} rejects installation and reconnect retries successfully`, async ({
    page,
  }) => {
    const app = await fixture();
    try {
      app.missing.add(
        {
          script: '/app.js',
          index: '/data/vocab_chunks/index.json',
          chunk: '/data/vocab_chunks/' + app.current.coreChunk,
          taxonomy: '/data/pos.json',
        }[missing],
      );
      await page.goto(app.url);
      await expect.poll(() => page.evaluate(() => window.AppPWA.getState().error)).toBe(true);
      expect(await page.evaluate(() => window.AppPWA.getState().ready)).toBe(false);
      expect(await page.evaluate(() => caches.keys())).toEqual([]);
      app.missing.clear();
      await page.context().setOffline(true);
      await expect.poll(() => page.evaluate(() => window.AppPWA.getState().online)).toBe(false);
      await page.context().setOffline(false);
      await expect.poll(() => page.evaluate(() => window.AppPWA.getState().ready)).toBe(true);
    } finally {
      await app.close();
    }
  });
}

test('failed update retains A, complete B waits for old clients, and rollback restores A', async ({
  page,
}) => {
  const app = await fixture();
  try {
    const first = app.current;
    await ready(page, app.url);
    app.current = release('B');
    app.corrupt.add('/app.js');
    await update(page);
    await expect.poll(() => page.evaluate(() => window.AppPWA.getState().error)).toBe(true);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-release', 'A');
    app.corrupt.clear();
    app.corrupt.add('/data/vocab_chunks/' + app.current.coreChunk);
    await update(page);
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const reg = await navigator.serviceWorker.getRegistration();
          return !reg.installing && !reg.waiting;
        }),
      )
      .toBe(true);
    await expect.poll(() => page.evaluate(() => window.AppPWA.getState().error)).toBe(true);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-release', 'A');
    app.corrupt.clear();
    await update(page);
    await expect.poll(() => page.evaluate(() => window.AppPWA.getState().updateAvailable)).toBe(true);
    await expect(page.locator('#appPwaStatusText')).toContainText('关闭本站全部窗口');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-release', 'A');
    await activate(page, app.url);
    await expect(page.locator('html')).toHaveAttribute('data-release', 'B');
    app.current = first;
    await update(page);
    await expect.poll(() => page.evaluate(() => window.AppPWA.getState().updateAvailable)).toBe(true);
    await activate(page, app.url);
    await expect(page.locator('html')).toHaveAttribute('data-release', 'A');
    const keys = await page.evaluate(() => caches.keys());
    expect(keys.every((k) => k.endsWith(first.manifest.version))).toBe(true);
  } finally {
    await app.close();
  }
});

test('optional failure, independent quotas, private exclusions and exact query fallback', async ({
  page,
}) => {
  const app = await fixture();
  try {
    app.missing.add('/data/grammar_index.json');
    await ready(page, app.url);
    await page.evaluate(async () => {
      await Promise.all(Array.from({ length: 28 }, (_, i) => fetch('/data/test-audio-' + i + '.ogg')));
      await Promise.all(Array.from({ length: 15 }, (_, i) => fetch('/data/test-image-' + i + '.png')));
      await Promise.all(Array.from({ length: 28 }, (_, i) => fetch('/data/test-data-' + i + '.json?v=1')));
      await fetch('/data/user_progress.json');
      await fetch('/api/progress');
    });
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const result = {};
          for (const name of await caches.keys())
            result[name.split('-')[2]] = (await (await caches.open(name)).keys()).length;
          return result;
        }),
      )
      .toEqual({ shell: app.current.manifest.required.length, data: 24, audio: 24, image: 12 });
    const paths = await page.evaluate(async () => {
      const keys = [];
      for (const name of await caches.keys())
        keys.push(...(await (await caches.open(name)).keys()).map((k) => k.url));
      return keys;
    });
    expect(paths.some((p) => p.includes('user_progress') || p.includes('/api/'))).toBe(false);
    const kept = paths.find((p) => p.includes('/data/test-data-'));
    await page.context().setOffline(true);
    expect(
      await page.evaluate(async () => {
        const index = await (await fetch('/data/vocab_chunks/index.json')).json();
        return (await fetch('/data/vocab_chunks/' + index.chunks[0])).ok;
      }),
    ).toBe(true);
    expect(await page.evaluate(async (url) => (await fetch(url)).ok, kept)).toBe(true);
    expect(
      await page.evaluate(async (url) => {
        try {
          await fetch(url.replace('v=1', 'v=2'));
          return false;
        } catch {
          return true;
        }
      }, kept),
    ).toBe(true);
  } finally {
    await app.close();
  }
});

test('lesson reading chunks survive offline reload without the HTTP cache', async ({ page, context }) => {
  await ready(page, '/');
  const load = () =>
    page.evaluate(async () => [
      await TextbookLoader.getLessonTextChunks('XinBian1', 'lesson_01'),
      await TextbookLoader.getLessonWikiReading('XinBian1', 'lesson_01'),
      await TextbookLoader.getVocabAudioUrl(1),
    ]);
  const expected = await load();
  const files = await page.evaluate(async () => {
    const catalog = await (await fetch('./data/textbook/book_chunks/XinBian1.json')).json();
    const audio = await (await fetch('./data/textbook/audio_chunks/index.json')).json();
    return [
      ...[catalog.textChunks.lesson_01, catalog.wikiReadings.lesson_01].map(
        (f) => './data/textbook/book_chunks/' + f,
      ),
      './data/textbook/audio_chunks/index.json',
      './data/textbook/audio_chunks/' + audio.chunks['0'],
    ];
  });
  // Poll cache completion without refetching indexes and scheduling another
  // delete/put on every sample. The offline reload below still verifies durability.
  await expect
    .poll(() =>
      page.evaluate(
        async (files) =>
          (await Promise.all(files.map((f) => caches.match(new URL(f, location.href).href)))).every(Boolean),
        files,
      ),
    )
    .toBe(true);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.clearBrowserCache');
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#loading')).toHaveClass(/hidden/);
  expect(await load()).toEqual(expected);
});
