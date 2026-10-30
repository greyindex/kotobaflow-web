const { revealControl } = require('./helpers');
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { openReadyApp } = require('./helpers');
const { normalizeGrammarExamples } = require('../js/grammar-loader.js');

test('vocabulary chunks preserve every visible word and field without fetching the source', async ({
  page,
}) => {
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  await openReadyApp(page);
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/loader.js'), 'utf8'), { window, console });
  const expected = window.dataLoader.normalizeWords(
    JSON.parse(
      fs.readFileSync(
        path.join(__dirname, '../data/taxonomy_annotations_gemini_3_flash_enriched.json'),
        'utf8',
      ),
    ),
  );
  const actual = await page.evaluate(() => window.taxonomyManager.allWords);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../data/vocab_chunks/index.json'), 'utf8'),
  );
  const light = expected.map((word) =>
    Object.fromEntries(Object.entries(word).filter(([key]) => !manifest.deferred.includes(key))),
  );
  expect(JSON.stringify(actual)).toBe(JSON.stringify(light));
  const details = Object.assign(
    {},
    ...manifest.details.map((group) =>
      JSON.parse(fs.readFileSync(path.join(__dirname, '../data/vocab_chunks', group.file), 'utf8')),
    ),
  );
  expect(actual.map((word) => ({ ...word, ...details[word.index] }))).toEqual(
    JSON.parse(JSON.stringify(expected)),
  );
  expect(requests.some((url) => url.includes('/vocab_chunks/detail-'))).toBe(false);
  expect(requests.filter((u) => /vocab_chunks\/[a-f0-9]{64}\.json/.test(u))).toHaveLength(7);
  expect(requests.some((u) => u.includes('taxonomy_annotations'))).toBe(false);
});

test('word details load on demand, retry failures and ignore a superseded request', async ({ page }) => {
  await openReadyApp(page);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let slow = true;
  await page.route('**/vocab_chunks/detail-*.json', async (route) => {
    if (slow) {
      slow = false;
      await gate;
      return route.continue();
    }
    return route.fulfill({ status: 503, body: '' });
  });
  const cards = page.locator('.cc-card-body');
  const firstIndex = await cards.first().getAttribute('data-detail');
  const next = await page.evaluate(
    (index) =>
      window.taxonomyManager.allWords.find(
        (word) => window.dataLoader.detailFiles[word.index] !== window.dataLoader.detailFiles[index],
      ),
    firstIndex,
  );
  await cards.first().click();
  await expect(page.locator('#detailContent')).toContainText('正在加载词汇详情');
  // Switch through real cards while the first chunk is deliberately delayed.
  await page.keyboard.press('Escape');
  await revealControl(page.locator('#searchInput'));
  await page.locator('#searchInput').fill(next.word);
  await revealControl(page.locator(`.cc-card-body[data-detail="${next.index}"]`));
  await page.locator(`.cc-card-body[data-detail="${next.index}"]`).click();
  release();
  await expect(page.locator('#detailContent .state-view--error')).toBeVisible();
  await page.unroute('**/vocab_chunks/detail-*.json');
  await page.locator('#detailContent [data-state-action="retry-word-detail"]').click();
  await expect(page.locator('#detailContent .vocab-detail')).toBeVisible();
  expect(await page.locator('#detailContent h3').innerText()).toBe(next.word);
});

test('grammar loads only the requested chunk, deduplicates and retries a failed chunk', async ({ page }) => {
  await openReadyApp(page, { module: 'grammar' });
  const urls = [];
  const rawChunkBodies = [];
  page.on('request', (r) => urls.push(r.url()));
  page.on('response', (response) => {
    if (/grammar_chunks\/[a-f0-9]{64}\.json$/.test(response.url()) && response.ok())
      rawChunkBodies.push(response.json());
  });
  await page.route('**/grammar_chunks/*.json', async (route) => {
    if (route.request().url().endsWith('/index.json')) return route.continue();
    return route.fulfill({ status: 503, body: '' });
  });
  expect(await page.evaluate(() => GrammarLoader.getDetail('N1-001'))).toBeNull();
  await page.unroute('**/grammar_chunks/*.json');
  const result = await page.evaluate(() =>
    Promise.all([GrammarLoader.getDetail('N1-001'), GrammarLoader.getDetail('N1-001')]),
  );
  const source = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/grammar_details.json'), 'utf8'));
  const expected = normalizeGrammarExamples({ ...source['N1-001'], example_language_review: null });
  expect(result).toEqual([expected, expected]);
  expect((await Promise.all(rawChunkBodies))[0]['N1-001']).toEqual(source['N1-001']);
  expect(urls.filter((u) => /grammar_chunks\/[a-f0-9]{64}\.json/.test(u))).toHaveLength(2);
  expect(urls.some((u) => u.endsWith('/grammar_details.json'))).toBe(false);
  await page.locator('.gm-card').first().click();
  await expect(page.locator('.gm-detail-title')).toBeVisible();
});

test('lesson selects the lossless WebP derivative at both desktop widths', async ({ page }) => {
  await openReadyApp(page, { module: 'lesson' });
  const directory = page.locator('.tb-lesson-directory');
  await revealControl(directory);
  if ((await directory.getAttribute('open')) === null) await directory.locator('summary').click();
  await revealControl(page.locator('.tb-lesson-card').first());
  await page.locator('.tb-lesson-card').first().click();
  for (const width of [1600, 1280]) {
    await page.setViewportSize({ width, height: width === 1600 ? 900 : 720 });
    const img = page.locator('.tb-reader-lead-media .tb-section-image').first();
    await expect(img).toBeVisible();
    await expect
      .poll(() => img.evaluate((el) => el.complete && el.naturalWidth > 0 && el.currentSrc.endsWith('.webp')))
      .toBe(true);
    await page.screenshot({ path: `local/qa/resource-image-${width}.png` });
  }
});

test('keyboard detail focus does not wait for button color transitions', async ({ page }) => {
  await openReadyApp(page, { module: 'grammar' });
  const close = page.locator('#grammarDetailCollapseBtn');
  await close.evaluate((button) => {
    button.style.transitionDuration = '2s';
    getComputedStyle(button).visibility;
  });
  const card = page.locator('.gm-card').first();
  await card.focus();
  await page.keyboard.press('Enter');
  await expect(close).toBeFocused({ timeout: 1500 });
  await page.keyboard.press('Escape');
  await expect(card).toBeFocused();
});
