const { test, expect } = require('@playwright/test');
const {
  DEFAULT_LAYOUT_STORAGE,
  chooseReadingLayout,
  openReadyApp,
  revealControl,
  selectTextbook,
  settleBook,
} = require('./helpers');

// 2026-10-15 page-turn motion (js/core/book-turn.js) and spread formats
// (显示设置 › 阅读排版), in the default page-turn layout.
test.use({ serviceWorkers: 'block', storageState: DEFAULT_LAYOUT_STORAGE });

const COVER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="#e9e5dc"/></svg>';

test.beforeEach(async ({ page }) => {
  await page.route('**/js/storage-config.js*', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: "window.JPLearnStorageConfig = { mode: 'browser' };",
    }),
  );
  // Same theme images on every machine, so copies of a page with a picture are covered.
  await page.route('**/kotobaflow_unit_images_v1/images.json*', (route) =>
    route.fulfill({
      json: {
        schema: 1,
        images: {
          'KotobaFlow1/lesson_03': { file: 'KotobaFlow1/lesson_03.webp', width: 1280, height: 720 },
          'KotobaFlow1/lesson_07': { file: 'KotobaFlow1/lesson_07.webp', width: 1280, height: 720 },
        },
      },
    }),
  );
  await page.route('**/kotobaflow_unit_images_v1/**/*.webp*', (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: COVER_SVG }),
  );
});

async function openLesson(page, lesson, bookId = 'KotobaFlow1') {
  await selectTextbook(page, bookId);
  const card = page.locator(`.tb-lesson-card[data-lesson-id="${lesson}"]`);
  await revealControl(card);
  await card.click();
  await expect(card).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Escape');
  const book = page.locator('#tbReader .book-frame');
  await expect(book).toBeVisible();
  // Pages are counted again as pictures load: wait for every one of them.
  await expect
    .poll(() =>
      book
        .locator('img')
        .evaluateAll(
          (images) => images.length > 0 && images.every((image) => image.complete && image.naturalWidth > 0),
        ),
    )
    .toBe(true);
  await page.evaluate(() => document.fonts.ready);
  return book;
}

// Runs the rest of a turn at a twentieth of its speed, so its copies can be inspected.
async function slowMotion(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Animation.enable');
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.05 });
  return () => cdp.send('Animation.setPlaybackRate', { playbackRate: 1 });
}

// Clicks a turn button and reports what the turn put over the frame at once.
function turnAndInspect(book, direction = 'next') {
  return book.evaluate((frame, direction) => {
    window.JPLearn.bookTurn.lastFallback = null;
    frame.querySelector(`.book-turn.is-${direction}`).click();
    const layer = frame.querySelector('.book-flip-layer');
    const body = frame.querySelector('.book-body');
    const copy = layer && layer.querySelector('.book-body');
    return {
      page: Number(frame.querySelector('.book-page-select').value),
      layer: !!layer,
      strips: layer ? layer.querySelectorAll('.book-flip-strip').length : 0,
      faces: layer ? layer.querySelectorAll('.book-flip-face').length : 0,
      sliding: body.getAnimations().length > 0,
      fallback: window.JPLearn.bookTurn.lastFallback || null,
      // A copy and the live body must agree in height to the fraction.
      heights: copy ? [parseFloat(copy.style.height), parseFloat(getComputedStyle(body).height)] : null,
    };
  }, direction);
}

// Turns that did not play the 3D leaf from verified copies of the right height.
function failedTurns(turns) {
  return turns.filter(
    (turn) => !turn.layer || turn.fallback || Math.abs(turn.heights[0] - turn.heights[1]) > 0.05,
  );
}

test('a page turn curls frozen copies of the old pages over the new spread', async ({ page }) => {
  const errors = await openReadyApp(page, { module: 'lesson' });
  const book = await openLesson(page, 'lesson_03');
  const select = book.locator('.book-page-select');
  await expect(select).toHaveValue('0');
  const resume = await slowMotion(page);
  await book.locator('.book-turn.is-next').click();
  // The real pages already show the destination; only the copies move.
  await expect(select).toHaveValue('1');
  const turn = await book.evaluate((frame) => {
    const layer = frame.querySelector('.book-flip-layer');
    return (
      layer && {
        last: frame.lastElementChild === layer,
        hidden: layer.getAttribute('aria-hidden'),
        inert: layer.hasAttribute('inert'),
        named: layer.querySelectorAll('[id], [name]').length,
        strips: layer.querySelectorAll('.book-flip-strip').length,
        turning: frame.classList.contains('is-turning'),
        // Clicks go to the edge buttons and live pages, never to a copy.
        blocked: getComputedStyle(frame.querySelector('.book-body > *')).pointerEvents,
        fallback: window.JPLearn.bookTurn.lastFallback || null,
      }
    );
  });
  expect(turn).toEqual({
    last: true,
    hidden: 'true',
    inert: true,
    named: 0,
    strips: 9,
    turning: true,
    blocked: 'none',
    fallback: null,
  });
  await resume();
  await expect(book.locator('.book-flip-layer')).toHaveCount(0);
  await expect(book).not.toHaveClass(/is-turning/);
  expect(errors).toEqual([]);
});

for (const viewport of [
  { width: 1600, height: 900 },
  { width: 1280, height: 720 },
  { width: 390, height: 844 },
]) {
  test(`every turn through a lesson plays from verified copies at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors = await openReadyApp(page, { module: 'lesson' });
    const book = await openLesson(page, 'lesson_07');
    const spreads = await book.locator('.book-page-select option').count();
    expect(spreads).toBeGreaterThan(5);
    const turns = [];
    // Forward to the end and back again, each turn cutting short the previous one.
    for (let i = 1; i < spreads; i++) turns.push(await turnAndInspect(book, 'next'));
    await expect(book.locator('.book-page-select')).toHaveValue(String(spreads - 1));
    for (let i = 1; i < spreads; i++) turns.push(await turnAndInspect(book, 'prev'));
    await expect(book.locator('.book-page-select')).toHaveValue('0');
    expect(failedTurns(turns)).toEqual([]);
    await expect(book.locator('.book-flip-layer')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('turns through a word list in two columns play from verified copies', async ({ page }) => {
  // 新编第三册第2课 at 1600×900: rows of the word list differ in height, and
  // the taller one of a row sets where the next page begins.
  const errors = await openReadyApp(page, { module: 'lesson' });
  const book = await openLesson(page, 'lesson_02', 'XinBian3');
  const spreads = await book.locator('.book-page-select option').count();
  expect(spreads).toBeGreaterThan(5);
  const turns = [];
  for (let i = 1; i < spreads; i++) turns.push(await turnAndInspect(book, 'next'));
  for (let i = 1; i < spreads; i++) turns.push(await turnAndInspect(book, 'prev'));
  await expect(book.locator('.book-page-select')).toHaveValue('0');
  expect(failedTurns(turns)).toEqual([]);
  await settleBook(book);
  expect(errors).toEqual([]);
});

// A book built to hit each way a pruned copy used to lay out differently from
// its live page, so that the turn fell back to a slide (2026-10-19). Each
// part is named for what it covers; sizes come from --mixed-page, a custom
// property set on the body itself.
const SENTENCE =
  '昔、ある村に竹取の翁という者がいて、野山に入って竹を取り、さまざまな物を作って暮らしていた。';
const PICTURE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='3'/%3E";
const MIXED_PARTS = {
  // Units at the top of a page whose first shown child's margin collapses through them.
  collapse: (
    '<div class="mixed-fill"></div><div class="mixed-unit"><p class="mixed-hidden">古文</p>' +
    `<p class="mixed-text">${SENTENCE.repeat(3)}</p></div>`
  ).repeat(2),
  // Blocks of 0.37 page: page after page begins without an element at its top.
  offset: '<div class="mixed-bar"></div>'.repeat(44),
  // An opened section, whose body slides in as it opens.
  opened:
    '<details class="tb-item" open><summary>展开的一节</summary><div class="tb-item-body">' +
    `<p>${SENTENCE.repeat(22)}</p><p>${SENTENCE.repeat(6)}</p></div></details>`,
  // A paragraph running over more pages than a copy looks back for a page top.
  long: `<p>${SENTENCE.repeat(320)}</p>`,
  // Narrated text: sentence spans with nothing between them.
  narrated: `<p>${Array.from({ length: 60 }, (_, k) => `<span>${k % 3 ? '' : '翁は'}${SENTENCE}</span>`).join('')}</p>`,
  // Grid items taller than a page, cut by the page breaks.
  grid: `<div class="mixed-grid">${`<div>${`<div class="mixed-line">${SENTENCE.repeat(2)}</div>`.repeat(9)}</div>`.repeat(4)}</div>`,
  // A picture whose height has a fraction, above a paragraph whose next line
  // just misses the page (see --mixed-gap below).
  picture:
    `<div class="mixed-gap"></div><img class="mixed-picture" src="${PICTURE}" alt="">` +
    `<p class="mixed-lines">${SENTENCE.repeat(14)}</p><p>${SENTENCE}</p>`,
};
const MIXED_CSS = `
  .mixed-book p { margin: 0 0 12px; orphans: 2; widows: 2; }
  .mixed-book h3 { margin: 0 0 12px; }
  .mixed-unit { margin: 0 0 24px; }
  .mixed-unit > p { margin: 0; }
  .mixed-hidden { display: none; }
  .mixed-unit > .mixed-hidden + .mixed-text { margin-top: 10px; }
  .mixed-fill { break-before: column; height: var(--mixed-page); }
  .mixed-bar { height: calc(var(--mixed-page) * 0.37); border-top: 1px solid var(--c-border-soft); }
  .mixed-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 28px; }
  .mixed-line { padding: 4px 0; }
  .mixed-gap { break-before: column; height: var(--mixed-gap); }
  .mixed-picture { display: block; width: 100%; height: 200.375px; }
  .mixed-book .mixed-lines { line-height: 30px; }
`;

test('every turn through mixed content plays from verified copies', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const errors = await openReadyApp(page);
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: MIXED_CSS });
  const html = Object.entries(MIXED_PARTS)
    .map(([name, part]) => `<section data-part="${name}"><h3>${name}</h3>${part}</section>`)
    .join('');
  const spreads = await page.evaluate((html) => {
    const scroller = document.createElement('div');
    scroller.id = 'mixedBook';
    scroller.style.cssText =
      'position:fixed;inset:0;z-index:5000;overflow:auto;background:var(--surface-canvas)';
    const body = document.createElement('div');
    body.className = 'mixed-book';
    body.innerHTML = html;
    scroller.appendChild(body);
    document.body.appendChild(scroller);
    const pager = window.JPLearn.bookPager.mount({ body, scroller, label: '翻页测试' });
    const style = getComputedStyle(body);
    const height = parseFloat(style.height) - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    body.style.setProperty('--mixed-page', height + 'px');
    const lines = Math.floor((height - 200.375) / 30);
    body.style.setProperty('--mixed-gap', height - 200.375 - lines * 30 + 0.2 + 'px');
    pager.refresh();
    return pager.spreads;
  }, html);
  expect(spreads).toBeGreaterThan(10);
  const book = page.locator('#mixedBook .book-frame');
  const turns = [];
  for (let i = 1; i < spreads; i++) turns.push(await turnAndInspect(book, 'next'));
  for (let i = 1; i < spreads; i++) turns.push(await turnAndInspect(book, 'prev'));
  await expect(book.locator('.book-page-select')).toHaveValue('0');
  expect(failedTurns(turns)).toEqual([]);
  await settleBook(book);
  expect(errors).toEqual([]);
});

test('one-page books hinge the turning page at the left edge', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await openReadyApp(page, { module: 'lesson' });
  const book = await openLesson(page, 'lesson_03');
  await expect(book).toHaveClass(/is-single/);
  const resume = await slowMotion(page);
  await book.locator('.book-turn.is-next').click();
  const leaf = await book.evaluate((frame) => {
    const layer = frame.querySelector('.book-flip-layer');
    const element = layer && layer.querySelector('.book-flip-leaf');
    return element && { left: element.style.left, back: !!layer.querySelector('.is-back') };
  });
  // Forward, the live page is revealed under the leaf: no copy of its back.
  expect(leaf).toEqual({ left: '0px', back: false });
  await resume();
  await expect(book.locator('.book-flip-layer')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('copies that do not lay out like the live pages fall back to a slide', async ({ page }) => {
  const errors = await openReadyApp(page, { module: 'lesson' });
  const book = await openLesson(page, 'lesson_03');
  // Taller lines in the turn layer only: no copy can match its live page.
  await page.addStyleTag({ content: '.book-flip-layer * { line-height: 3 !important; }' });
  const turn = await turnAndInspect(book);
  expect(turn).toMatchObject({ layer: false, sliding: true });
  expect(turn.fallback).toEqual(
    expect.objectContaining({ page: expect.any(Number), live: expect.any(Array) }),
  );
  await expect(book.locator('.book-page-select')).toHaveValue('1');
  await settleBook(book);
  expect(errors).toEqual([]);
});

test('read-aloud text ignores the copies a turn lays over the book', async ({ page }) => {
  const errors = await openReadyApp(page, { module: 'lesson' });
  const book = await openLesson(page, 'lesson_03');
  const segments = () =>
    page.evaluate(() => ModuleSwitcher.getTextbookModule()._getRenderedTtsSegments('reading:body'));
  const settled = await segments();
  expect(settled.length).toBeGreaterThan(0);
  const resume = await slowMotion(page);
  await book.locator('.book-turn.is-next').click();
  // The turning pages carry the passage, so copies of its text are on screen.
  await expect(
    book.locator('.book-flip-layer [data-tts-mode="reading:body"] .tb-paragraph').filter({ hasText: /\S/ }),
  ).not.toHaveCount(0);
  expect(await segments()).toEqual(settled);
  await resume();
  await settleBook(book);
  expect(errors).toEqual([]);
});

test('reduced motion turns pages without any motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = await openReadyApp(page, { module: 'lesson' });
  const book = await openLesson(page, 'lesson_03');
  expect(await turnAndInspect(book)).toMatchObject({ layer: false, sliding: false });
  await expect(book.locator('.book-page-select')).toHaveValue('1');
  expect(errors).toEqual([]);
});

// Words fully on the shown spread.
function wordsOnSpread(book) {
  return book.locator('.book-body').evaluate((body) => {
    const bounds = body.getBoundingClientRect();
    return [...body.querySelectorAll('.cc-card')].filter((card) => {
      const r = card.getBoundingClientRect();
      return r.left >= bounds.left - 1 && r.right <= bounds.right + 1 && r.bottom <= bounds.bottom + 1;
    }).length;
  });
}

test('spread formats change how much one spread holds', async ({ page }) => {
  const errors = await openReadyApp(page, { module: 'vocab' });
  const book = page.locator('#card-container .book-frame');
  const layout = page.locator('#appReadingLayoutSelect');
  await expect(book).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect(layout).toHaveValue('book');
  const standard = await wordsOnSpread(book);
  const width = (await book.boundingBox()).width;
  expect(standard).toBeGreaterThanOrEqual(14);

  await chooseReadingLayout(page, 'dense');
  await expect(page.locator('html')).toHaveAttribute('data-book-format', 'dense');
  expect(await wordsOnSpread(book)).toBeGreaterThan(standard);
  expect((await book.boundingBox()).width).toBeGreaterThan(width);

  await chooseReadingLayout(page, 'large');
  expect(await wordsOnSpread(book)).toBeLessThan(standard);

  await chooseReadingLayout(page, 'single');
  await expect(book).toHaveClass(/is-single/);
  const narrow = await book.boundingBox();
  expect(narrow.width).toBeLessThan(800);
  // The heading keeps the book's left edge.
  const heading = await page.locator('#vocabHeading .page-heading-title').boundingBox();
  expect(Math.abs(heading.x - narrow.x)).toBeLessThan(24);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.reload();
  await openReadyApp(page, { module: 'vocab' });
  await expect(book).toHaveClass(/is-single/);
  await expect(layout).toHaveValue('single');
  expect(errors).toEqual([]);
});

test('changing the spread format keeps the reader on the same passage', async ({ page }) => {
  const errors = await openReadyApp(page, { module: 'lesson' });
  const book = await openLesson(page, 'lesson_07');
  const select = book.locator('.book-page-select');
  // The first dialogue turn wholly on a spread stands for the passage; start
  // from the fifth spread and take the first one that shows a whole turn.
  const spreads = await select
    .locator('option')
    .evaluateAll((options) => options.map((option) => option.value));
  let marker = '';
  let start = '';
  for (const value of [...spreads.slice(4), ...spreads.slice(0, 4)]) {
    await select.selectOption(value);
    marker = await book.evaluate((frame) => {
      const body = frame.querySelector('.book-body');
      const bounds = body.getBoundingClientRect();
      const turn = [...body.querySelectorAll('.tb-dialogue-turn')].find((el) => {
        const r = el.getBoundingClientRect();
        return r.width && r.left >= bounds.left - 1 && r.right <= bounds.right + 1;
      });
      if (!turn) return '';
      turn.setAttribute('data-test-marker', '');
      return turn.textContent.trim().slice(0, 20);
    });
    if (marker) {
      start = value;
      break;
    }
  }
  expect(marker).not.toBe('');
  const markerOnSpread = () =>
    book.evaluate((frame) => {
      const bounds = frame.querySelector('.book-body').getBoundingClientRect();
      const r = frame.querySelector('[data-test-marker]').getBoundingClientRect();
      return r.left >= bounds.left - 1 && r.right <= bounds.right + 1;
    });
  for (const format of ['dense', 'large', 'single']) {
    await chooseReadingLayout(page, format);
    expect(await markerOnSpread(), format).toBe(true);
  }
  // Trying formats in a row comes back to the same spread.
  await chooseReadingLayout(page, 'book');
  await expect(select).toHaveValue(start);
  expect(await markerOnSpread()).toBe(true);
  expect(errors).toEqual([]);
});

test('the reading layout setting lists the formats of the page-turn layout', async ({ page }) => {
  const errors = await openReadyApp(page, { module: 'vocab' });
  const layout = page.locator('#appReadingLayoutSelect');
  await expect(layout.locator('option')).toHaveText([
    '翻页（默认）',
    '翻页（高密度）',
    '翻页（大字）',
    '翻页（单页）',
    '连续滚动（旧版）',
  ]);
  await chooseReadingLayout(page, 'scroll');
  await expect(page.locator('#card-container .book-frame')).toHaveCount(0);
  // From the legacy layout a format opens the books in that format.
  await chooseReadingLayout(page, 'dense');
  await expect(page.locator('#card-container .book-frame')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-book-format', 'dense');
  await expect(layout).toHaveValue('dense');
  expect(
    await page.evaluate(() => [
      localStorage.getItem('jp_learning_reading_layout_v1'),
      localStorage.getItem('jp_learning_book_format_v1'),
    ]),
  ).toEqual(['book', 'dense']);
  expect(errors).toEqual([]);
});
