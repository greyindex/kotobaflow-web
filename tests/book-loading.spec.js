const { closeSidebar, openSettings, revealControl } = require('./helpers');
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { openReadyApp } = require('./helpers');
test.use({ serviceWorkers: 'block' });
const books = ['XinBian1', 'XinBian2', 'XinBian3', 'XinBian4'];
const source = (book) =>
  JSON.parse(
    fs.readFileSync(path.join(__dirname, '../data/textbook/canonical_books', book + '.bundle.json'), 'utf8'),
  );

test('book catalogs preserve all four indexes without fetching lesson bodies', async ({ page }) => {
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  await openReadyApp(page, { module: 'dashboard' });
  for (const book of books) {
    expect(await page.evaluate((id) => TextbookLoader.getBookIndex(id), book)).toEqual(source(book).index);
  }
  expect(requests.some((url) => url.includes('.bundle.json'))).toBe(false);
  expect(requests.some((url) => /book_chunks\/[a-f0-9]{64}\.json/.test(url))).toBe(false);
});

test('each lesson is lossless and concurrent requests share one fetch', async ({ page }) => {
  await openReadyApp(page);
  const urls = [];
  page.on('request', (r) => urls.push(r.url()));
  for (const book of books) {
    const bundle = source(book);
    const actual = await page.evaluate(
      async ({ book, ids }) =>
        Promise.all(
          ids.map(async (id) => {
            const [first, second] = await Promise.all([
              TextbookLoader.getLesson(book, id),
              TextbookLoader.getLesson(book, id),
            ]);
            if (first !== second) throw Error('Requests not deduplicated');
            return first;
          }),
        ),
      { book, ids: bundle.items.map((item) => item.lesson.item_id) },
    );
    expect(actual).toEqual(bundle.items);
  }
  expect(urls.filter((url) => /book_chunks\/[a-f0-9]{64}\.json/.test(url))).toHaveLength(76);
});

test('failed lesson fetch retries without poisoning the catalog', async ({ page }) => {
  await openReadyApp(page);
  const original = source('XinBian1').items[0];
  const id = original.lesson.item_id;
  await page.route('**/book_chunks/*.json', (route) => {
    if (/\/XinBian[1-4]\.json/.test(route.request().url())) return route.continue();
    return route.fulfill({ status: 503, body: '' });
  });
  expect(
    await page.evaluate(
      (id) =>
        TextbookLoader.getLesson('XinBian1', id).then(
          () => false,
          () => true,
        ),
      id,
    ),
  ).toBe(true);
  await page.unroute('**/book_chunks/*.json');
  expect(await page.evaluate((id) => TextbookLoader.getLesson('XinBian1', id), id)).toEqual(original);
  await page.locator('#modBtnLesson').click();
  await expect(page.locator('.tb-reader-lead-media .tb-section-image')).toBeVisible();
});

test('per-lesson vocabulary matches every original merged field and order', async ({ page }) => {
  const expected = require('./fixtures/book-vocabulary.sha256.json').lessons;
  const urls = [];
  page.on('request', (r) => urls.push(r.url()));
  await openReadyApp(page);
  for (const [key, snapshot] of Object.entries(expected)) {
    const [book, id] = key.split('::');
    const actual = await page.evaluate(
      async ({ book, id }) => {
        const rows = await TextbookLoader.getLessonVocab(book, id);
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(rows)));
        return {
          count: rows.length,
          sha256: Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, '0')).join(''),
        };
      },
      { book, id },
    );
    expect(actual, key).toEqual(snapshot);
  }
  expect(urls.some((url) => url.includes('canonical_textbook_vocab/'))).toBe(false);
});

test('text and Wiki chunks match every original lesson with deduplicated requests', async ({ page }) => {
  const expected = require('./fixtures/book-readings.sha256.json').lessons;
  const urls = [];
  page.on('request', (r) => urls.push(r.url()));
  await openReadyApp(page);
  for (const [key, hashes] of Object.entries(expected)) {
    const [book, id] = key.split('::');
    const actual = await page.evaluate(
      async ({ book, id }) => {
        return Promise.all(
          ['getLessonTextChunks', 'getLessonWikiReading'].map(async (method) => {
            const [a, b] = await Promise.all([
              TextbookLoader[method](book, id),
              TextbookLoader[method](book, id),
            ]);
            if (a !== b) throw Error('Duplicate reading fetch');
            const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(a)));
            return Array.from(new Uint8Array(hash), (v) => v.toString(16).padStart(2, '0')).join('');
          }),
        );
      },
      { book, id },
    );
    expect(actual, key).toEqual(hashes);
  }
  expect(urls.filter((u) => /book_chunks\/(text|wiki)-/.test(u))).toHaveLength(152);
  expect(
    urls.some((u) => u.includes('textbook_text_chunks.v2') || u.includes('textbook_wiki_reading_chunks.v1')),
  ).toBe(false);
});

test('failed reading chunks expose the lesson retry and recover through real controls', async ({ page }) => {
  await openReadyApp(page);
  await page.route('**/book_chunks/text-*.json', (r) => r.fulfill({ status: 503, body: '' }));
  await page.locator('#modBtnLesson').click();
  await expect(page.getByText('课文加载失败', { exact: true })).toBeVisible();
  await page.unroute('**/book_chunks/text-*.json');
  await page.getByRole('button', { name: '重试课文', exact: true }).click();
  await expect(page.locator('.tb-reader-lead-media .tb-section-image')).toBeVisible();
});

test('wrong-lesson Wiki data is rejected and can be fetched again', async ({ page }) => {
  await openReadyApp(page);
  const id = source('XinBian1').items[0].lesson.item_id;
  await page.route('**/book_chunks/wiki-*.json', (r) =>
    r.fulfill({ json: { bookId: 'XinBian4', lessonId: id } }),
  );
  expect(
    await page.evaluate(
      (id) =>
        TextbookLoader.getLessonWikiReading('XinBian1', id).then(
          () => false,
          () => true,
        ),
      id,
    ),
  ).toBe(true);
  await page.unroute('**/book_chunks/wiki-*.json');
  const reading = await page.evaluate((id) => TextbookLoader.getLessonWikiReading('XinBian1', id), id);
  expect(reading.bookId).toBe('XinBian1');
  expect(reading.lessonId).toBe(id);
});

test('lesson grammar matches the full source mapping and ordering for all lessons', async ({ page }) => {
  const expected = require('./fixtures/book-grammar.sha256.json').lessons;
  const urls = [];
  page.on('request', (r) => urls.push(r.url()));
  await openReadyApp(page);
  for (const [key, snapshot] of Object.entries(expected)) {
    const [book, id] = key.split('::');
    const actual = await page.evaluate(
      async ({ book, id }) => {
        const [a, b] = await Promise.all([
          TextbookLoader.getLessonGrammar(book, id),
          TextbookLoader.getLessonGrammar(book, id),
        ]);
        if (a !== b) throw Error('Duplicate grammar fetch');
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(a)));
        return {
          count: a.length,
          sha256: Array.from(new Uint8Array(hash), (v) => v.toString(16).padStart(2, '0')).join(''),
        };
      },
      { book, id },
    );
    expect(actual, key).toEqual(snapshot);
  }
  expect(urls.some((u) => u.includes('canonical_textbook_grammar/'))).toBe(false);
});

test('invalid grammar chunk is rejected and retries successfully', async ({ page }) => {
  await openReadyApp(page);
  await page.route('**/book_chunks/grammar-*.json', (r) => r.fulfill({ json: { points: [] } }));
  expect(
    await page.evaluate(() =>
      TextbookLoader.getLessonGrammar('XinBian1', 'lesson_01').then(
        () => false,
        () => true,
      ),
    ),
  ).toBe(true);
  await page.unroute('**/book_chunks/grammar-*.json');
  expect(
    Array.isArray(await page.evaluate(() => TextbookLoader.getLessonGrammar('XinBian1', 'lesson_01'))),
  ).toBe(true);
});

test('all textbook audio paths match the original manifest and carry the new cache version', async ({
  page,
}) => {
  const baseline = require('./fixtures/vocab-audio-urls.sha256.json');
  const urls = [];
  page.on('request', (r) => urls.push(r.url()));
  await openReadyApp(page);
  const result = await page.evaluate(async (ids) => {
    const entries = await Promise.all(ids.map(async (id) => [id, await TextbookLoader.getVocabAudioUrl(id)]));
    const paths = entries.map(([id, url]) => [id, url.split('?')[0]]);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(paths)));
    return {
      hash: Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, '0')).join(''),
      versions: [...new Set(entries.map(([, url]) => new URL(url, location.href).searchParams.get('v')))],
    };
  }, baseline.ids);
  expect(result.hash).toBe(baseline.sha256);
  expect(result.versions).toEqual(['20260928-content-closure-2']);
  expect(urls.filter((u) => u.includes('/audio_chunks/'))).toHaveLength(25);
  expect(urls.some((u) => u.includes('vocab6127') && u.includes('manifest.jsonl'))).toBe(false);
  expect(
    await page.evaluate(() =>
      Promise.all(['invalid', -1, 999999].map((i) => TextbookLoader.getVocabAudioUrl(i))),
    ),
  ).toEqual(['', '', '']);
});

test('audio index and chunk failures retry without falling back to the large manifest', async ({ page }) => {
  await openReadyApp(page);
  const failed = () =>
    page.evaluate(() =>
      TextbookLoader.getVocabAudioUrl(1).then(
        () => false,
        () => true,
      ),
    );
  await page.route('**/audio_chunks/index.json', (r) => r.fulfill({ status: 503, body: '' }));
  expect(await failed()).toBe(true);
  await page.unroute('**/audio_chunks/index.json');
  await page.route('**/audio_chunks/*.json', (r) =>
    r.request().url().endsWith('/index.json') ? r.continue() : r.fulfill({ json: { 1: '../wrong.ogg' } }),
  );
  expect(await failed()).toBe(true);
  await page.unroute('**/audio_chunks/*.json');
  expect(await page.evaluate(() => TextbookLoader.getVocabAudioUrl(1))).toBe(
    './data/gcloud_chirp3_vocab6127_female_aoede_v1/audio/00xxx/00001.ogg?v=20260928-content-closure-2',
  );
});

test('real textbook word playback requests only a small audio index and one chunk', async ({ page }) => {
  const urls = [];
  page.on('request', (r) => urls.push(r.url()));
  await openReadyApp(page, { module: 'lesson' });
  await page.locator('.tb-reading-vocab-open').first().click();
  const request = page.waitForRequest((r) => /vocab6127.*\/audio\/.*\.ogg/.test(r.url()));
  await page.locator('#textbookDetailPanel .tb-vocab-audio-btn').first().click();
  await request;
  expect(urls.filter((u) => u.includes('/audio_chunks/'))).toHaveLength(2);
  expect(urls.some((u) => u.includes('vocab6127') && u.includes('manifest.jsonl'))).toBe(false);
});

test('lesson outline jumps to actual sections and follows reader scrolling', async ({ page }) => {
  await openReadyApp(page, { module: 'lesson' });
  const outline = page.locator('.tb-outline');
  await expect(outline).toBeVisible();
  const sections = await page.locator('.tb-reader-body > .tb-section').count();
  await expect(outline.locator('a')).toHaveCount(sections);
  if (!(await outline.evaluate((e) => e.open))) await outline.locator('summary').click();
  const link = outline.locator('a').filter({ hasText: '本课词汇' });
  await link.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.tb-reading-vocab-section')).toBeFocused();
  await expect(link).toHaveAttribute('aria-current', 'location');
  await page.locator('#tbReader').evaluate((e) => (e.scrollTop = 0));
  await expect(outline.locator('a').first()).toHaveAttribute('aria-current', 'location');
  await page.screenshot({ path: 'local/qa/outline-1600.png' });
});

test('compact lesson outline preserves reading width and closes with Escape', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  await openReadyApp(page, { module: 'lesson' });
  const outline = page.locator('.tb-outline');
  await expect(outline).not.toHaveAttribute('open', '');
  const before = await page.locator('.tb-reader-body').boundingBox();
  await outline.locator('summary').click();
  await expect(outline.locator('nav')).toBeVisible();
  await outline.locator('a').first().focus();
  await page.keyboard.press('Escape');
  await expect(outline.locator('summary')).toBeFocused();
  await expect(outline.locator('nav')).toBeHidden();
  expect((await page.locator('.tb-reader-body').boundingBox()).width).toBe(before.width);
  await page.screenshot({ path: 'local/qa/outline-1100.png' });
  await page.setViewportSize({ width: 820, height: 900 });
  await expect(outline.locator('summary')).toBeVisible();
  const box = await outline.boundingBox();
  expect(box.x + box.width).toBeLessThanOrEqual(820);
});

test('lesson outline refreshes on course changes and yields to global search', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  await openReadyApp(page, { module: 'lesson' });
  await revealControl(page.locator('.tb-lesson-directory > summary'));
  await page.locator('.tb-lesson-directory > summary').click();
  await revealControl(page.locator('.tb-lesson-card[data-lesson-id="lesson_02"]'));
  await page.locator('.tb-lesson-card[data-lesson-id="lesson_02"]').click();
  await expect(page.locator('#tbLoading')).toHaveClass(/hidden/);
  const outline = page.locator('.tb-outline');
  await revealControl(outline.locator('summary'));
  await outline.locator('summary').click();
  await expect(outline.locator('a').filter({ hasText: '前文' })).toHaveCount(1);
  await expect(outline.locator('a')).toHaveCount(await page.locator('.tb-reader-body > .tb-section').count());
  await page.keyboard.press('Control+k');
  await expect(page.locator('#globalSearchOverlay')).toBeVisible();
  await expect(outline.locator('nav')).toBeHidden();
  await page.keyboard.press('Escape');
});

test('lesson outline stays accessible when an open compact menu becomes a wide directory', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  await openReadyApp(page, { module: 'lesson' });
  const outline = page.locator('.tb-outline');
  for (const width of [1100, 820]) {
    await page.setViewportSize({ width, height: 720 });
    await expect(outline).not.toHaveClass(/is-wide/);
    await outline.locator('summary').click();
    await expect(outline.locator('nav')).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.JPLearn.topLayer.getCurrent()))
      .toBe('textbook-outline');
    await page.setViewportSize({ width: 1600, height: 900 });
    await expect(outline).toHaveClass(/is-wide/);
    await openSettings(page);
    await page.keyboard.press('Escape');
    await closeSidebar(page);
    await expect(outline.locator('nav')).toBeVisible();
    await outline.locator('a').filter({ hasText: '本课词汇' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.tb-reading-vocab-section')).toBeFocused();
    await page.keyboard.press('Control+k');
    await expect(page.locator('#globalSearchOverlay')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(outline.locator('nav')).toBeVisible();
  }
  await page.screenshot({ path: 'local/qa/review-fix-outline-1600.png' });
  await page.setViewportSize({ width: 1100, height: 720 });
  await outline.locator('summary').click();
  await outline.locator('a').first().focus();
  await page.keyboard.press('Escape');
  await expect(outline.locator('summary')).toBeFocused();
  await expect(outline.locator('nav')).toBeHidden();
  await page.screenshot({ path: 'local/qa/review-fix-outline-1100.png' });
});

for (const viewport of [
  { width: 1600, height: 900 },
  { width: 1280, height: 720 },
]) {
  test(`reviewed textbook wording stays consistent in all reading modes at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openReadyApp(page, { module: 'lesson' });
    const book = page.locator('#tbBookSelect');
    await revealControl(book);
    await book.selectOption('XinBian4');
    await expect(page.locator('.tb-lesson-card[data-lesson-id="lesson_16"]')).toBeAttached();
    const directory = page.locator('.tb-lesson-directory');
    await revealControl(directory.locator('summary'));
    if (!(await directory.evaluate((element) => element.open))) {
      await directory.locator('summary').click();
    }
    await page.locator('.tb-lesson-card[data-lesson-id="lesson_16"]').click();
    const wording = '一束五十円のホウレンソウ';
    const dialogue = page.locator('.tb-dialogue-text').filter({ hasText: wording });
    await expect(dialogue).toHaveCount(1);
    for (const mode of ['normal', 'chunks', 'plain']) {
      const control = page.locator(`[data-display-mode="${mode}"]`);
      await revealControl(control);
      await control.click();
      await expect(control).toHaveAttribute('aria-pressed', 'true');
      await expect(dialogue).toHaveCount(1);
      await expect(page.locator('#tbReader')).not.toContainText('一束五十円的ホウレンソウ');
    }
    await page.locator('#statusBarShowBtn').click();
    await dialogue.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `local/qa/resource-closure-2026-09-27/reading-${viewport.width}.png`,
    });
    // Keep checking the dashboard resume action; module URLs restore directly.
    await page.goto('/');
    await expect(page.locator('#loading')).toHaveClass(/hidden/);
    await page.locator('[data-dashboard-action="resume"]').click();
    await expect(page.locator('.tb-dialogue-text').filter({ hasText: wording })).toHaveCount(1);
  });
}

test('FIX-27 first-visit catalog retry keeps the chosen lesson across module switches', async ({ page }) => {
  await openReadyApp(page, { module: 'dashboard' });
  let fail = true;
  await page.route('**/book_chunks/XinBian1.json*', (route) =>
    fail ? route.fulfill({ status: 503, body: '' }) : route.continue(),
  );
  await page.locator('#modBtnLesson').click();
  const retry = page.locator('#tbReader [data-state-action="retry-textbook"]');
  await expect(retry).toBeVisible();
  fail = false;
  await retry.click();
  const lessonId = 'lesson_03';
  const directory = page.locator('.tb-lesson-directory');
  await revealControl(directory.locator('summary'));
  if (!(await directory.evaluate((el) => el.open))) await directory.locator('summary').click();
  const lesson = page.locator(`.tb-lesson-card[data-lesson-id="${lessonId}"]`);
  await revealControl(lesson);
  await lesson.click();
  await expect
    .poll(() => page.evaluate(() => ModuleSwitcher.exportNavigation().textbook.lessonId))
    .toBe(lessonId);
  await expect(page.locator('.tb-reader-lead-media .tb-section-image')).toBeVisible();
  await page.locator('#modBtnVocab').click();
  await page.locator('#modBtnLesson').click();
  await expect(page.locator('.tb-reader-lead-media .tb-section-image')).toBeVisible();
  expect(await page.evaluate(() => ModuleSwitcher.exportNavigation().textbook.lessonId)).toBe(lessonId);
  await page.unroute('**/book_chunks/XinBian1.json*');
});
