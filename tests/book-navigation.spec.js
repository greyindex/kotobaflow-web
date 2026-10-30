const { test, expect } = require('@playwright/test');
const {
  DEFAULT_LAYOUT_STORAGE,
  chooseReadingLayout,
  closeSidebar,
  openReadyApp,
  openSettings,
  revealControl,
  selectTextbook,
} = require('./helpers');

test.use({ serviceWorkers: 'block', storageState: DEFAULT_LAYOUT_STORAGE });

// Match the catalog dimensions so these tests have the same layout before and
// after decoding; a 1px placeholder has a different intrinsic size.
const COVER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="#e9e5dc"/></svg>';

async function mockCovers(page, wait = () => Promise.resolve()) {
  await page.route('**/kotobaflow_unit_images_v1/images.json*', async (route) => {
    await wait();
    await route.fulfill({
      json: {
        schema: 1,
        images: {
          'KotobaFlow1/lesson_01': { file: 'KotobaFlow1/lesson_01.webp', width: 1280, height: 720 },
          'KotobaFlow1/lesson_02': { file: 'KotobaFlow1/lesson_02.webp', width: 1280, height: 720 },
        },
      },
    });
  });
  await page.route('**/kotobaflow_unit_images_v1/**/*.webp*', (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: COVER_SVG }),
  );
}

async function waitForCoverLayout(page) {
  await expect
    .poll(() =>
      page.locator('#tbReader .tb-book-cover img').evaluate((image) => ({
        complete: image.complete,
        width: image.naturalWidth,
        height: image.naturalHeight,
      })),
    )
    .toEqual({ complete: true, width: 1280, height: 720 });
  await page.evaluate(async () => {
    await document.fonts.ready;
    // Allow the image/font resize notifications and their scheduled layout to
    // finish before comparing exact pages in an unchanged layout.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function openLesson(page, book, lesson, layout = 'book') {
  await selectTextbook(page, book);
  const card = page.locator(`.tb-lesson-card[data-lesson-id="${lesson}"]`);
  await revealControl(card);
  await card.click();
  await expect(card).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Escape');
  if (layout === 'book') await expect(page.locator('#tbReader .book-frame')).toBeVisible();
}

async function browserStorage(page) {
  await page.route('**/js/storage-config.js*', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: "window.JPLearnStorageConfig = { mode: 'browser' };",
    }),
  );
}

async function resumeFromDashboard(page) {
  await expect(page.locator('.dashboard-primary[data-dashboard-action="resume"]')).toBeVisible();
  await page.locator('.dashboard-primary[data-dashboard-action="resume"]').click();
  await expect(page.locator('#tbReader .book-frame')).toBeVisible();
  await expect(page.locator('#tbBookSelect')).toHaveValue('KotobaFlow1');
  await expect(page.locator('.tb-lesson-card[data-lesson-id="lesson_01"]')).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.locator('#tbLoading')).toHaveClass(/hidden/);
}

async function anchorOnSpread(page, anchor) {
  return page.evaluate((anchor) => {
    const pager = window.ModuleSwitcher.getTextbookModule()._bookPager;
    const section = [...pager.body.querySelectorAll(':scope > .tb-section')].find(
      (el) =>
        el.querySelector('.tb-section-badge, .tb-wiki-title')?.textContent.trim() === anchor.target.section,
    );
    const element = [
      ...section.querySelectorAll(
        'header, p, li, h4, .tb-unit, .tb-dialogue-turn, .tb-reading-vocab-row, .tb-item, tr',
      ),
    ].find((el) => el.textContent.replace(/\s+/g, ' ').trim().slice(0, 160) === anchor.target.text);
    if (!element) return false;
    const rect = element.getClientRects()[0];
    const body = pager.body.getBoundingClientRect();
    return rect.left >= body.left - 1 && rect.left < body.right - 1;
  }, anchor);
}

async function expectHeadingOnSpread(page, name) {
  await expect
    .poll(() =>
      page.evaluate((name) => {
        const module = window.ModuleSwitcher.getTextbookModule();
        const pager = module._bookPager;
        const section = [...pager.body.querySelectorAll(':scope > .tb-section')].find(
          (el) => el.querySelector('.tb-section-badge, .tb-wiki-title')?.textContent.trim() === name,
        );
        const bounds = pager.body.getBoundingClientRect();
        const heading = section.querySelector('.tb-section-badge, .tb-wiki-title').getBoundingClientRect();
        return heading.left >= bounds.left - 1 && heading.right <= bounds.right + 1;
      }, name),
    )
    .toBe(true);
}

for (const viewport of [
  { width: 1600, height: 900 },
  { width: 1280, height: 720 },
]) {
  test(`textbook outline opens the target heading's spread at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await browserStorage(page);
    const errors = await openReadyApp(page, { module: 'lesson' });
    await openLesson(page, 'XinBian1', 'lesson_05');
    const outline = page.locator('#tbReader .tb-outline');
    if (!(await outline.evaluate((element) => element.open))) await outline.locator('summary').click();
    for (const name of await outline.getByRole('link').allTextContents()) {
      if (!(await outline.evaluate((element) => element.open))) await outline.locator('summary').click();
      await outline.getByRole('link', { name, exact: true }).click();
      // The old scrollIntoView path briefly exposed headings before scrollend
      // snapped back to the previous spread. Assert after that delayed settling.
      await page.waitForTimeout(250);
      await expectHeadingOnSpread(page, name);
    }
    expect(errors).toEqual([]);
  });
}

test('textbook reading resumes the saved spread after dashboard and reload', async ({ page }) => {
  await browserStorage(page);
  await mockCovers(page);
  const errors = await openReadyApp(page, { module: 'lesson' });
  await openLesson(page, 'KotobaFlow1', 'lesson_01');
  await expect(page.locator('#tbReader .tb-book-cover')).toBeVisible();
  expect(await page.evaluate(() => window.ProgressStore.getStorageMode())).toBe('browser');
  const select = page.locator('#tbReader .book-page-select');
  await select.selectOption('5');
  await expect(select).toHaveValue('5');
  await page.locator('#modBtnDashboard').click();
  await page.reload();
  await resumeFromDashboard(page);
  await expect(page.locator('#tbReader .book-page-select')).toHaveValue('5');
  expect(errors).toEqual([]);
});

test('local progress API retains the book position in its saved response and reload', async ({
  page,
  request,
}) => {
  await mockCovers(page);
  const errors = await openReadyApp(page, { module: 'lesson' });
  expect(await page.evaluate(() => window.ProgressStore.getStorageMode())).toBe('local-api');
  await openLesson(page, 'KotobaFlow1', 'lesson_01');
  await expect(page.locator('#tbReader .tb-book-cover')).toHaveCount(1);
  await page.locator('#tbReader .book-page-select').selectOption('5');
  const anchor = await page.evaluate(
    () => window.ModuleSwitcher.getTextbookModule().exportNavigation().bookAnchor,
  );
  await page.locator('#modBtnDashboard').click();
  await expect
    .poll(async () => (await (await request.get('/api/progress')).json()).navigation.textbook.bookAnchor)
    .toEqual(anchor);
  await page.goto('/');
  await resumeFromDashboard(page);
  await expect(page.locator('#tbReader .book-page-select')).toHaveValue('5');
  expect(errors).toEqual([]);
});

test('course vocabulary jump opens its heading and first word in the book', async ({ page }) => {
  await browserStorage(page);
  const errors = await openReadyApp(page, { module: 'lesson' });
  await openLesson(page, 'XinBian1', 'lesson_05');
  await page.locator('#tbReader [data-heading-action="continue"]').click();
  await expectHeadingOnSpread(page, '本课词汇');
  await expect(
    page.locator('#tbReader [data-reading-vocab-section] [data-vocab-detail-index]').first(),
  ).toBeFocused();
  expect(errors).toEqual([]);
});

test('delayed cover metadata cannot consume the saved reading position', async ({ page }) => {
  await browserStorage(page);
  let release;
  let delayed = false;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await mockCovers(page, () => (delayed ? held : Promise.resolve()));
  const errors = await openReadyApp(page, { module: 'lesson' });
  await openLesson(page, 'KotobaFlow1', 'lesson_01');
  await expect(page.locator('#tbReader .tb-book-cover')).toHaveCount(1);
  await page.locator('#tbReader .book-page-select').selectOption('5');
  const saved = await page.evaluate(
    () => window.ModuleSwitcher.getTextbookModule().exportNavigation().bookAnchor,
  );
  await page.locator('#modBtnDashboard').click();
  delayed = true;
  await page.reload();
  await resumeFromDashboard(page);
  expect(
    await page.evaluate(() => window.ModuleSwitcher.getTextbookModule().exportNavigation().bookAnchor),
  ).toEqual(saved);
  await page.locator('#modBtnDashboard').click();
  release();
  await expect(page.locator('#tbReader .tb-book-cover')).toHaveCount(1);
  expect(
    await page.evaluate(() => window.ModuleSwitcher.getTextbookModule().exportNavigation().bookAnchor),
  ).toEqual(saved);
  await page.locator('#modBtnLesson').click();
  await expect(page.locator('#tbReader .book-page-select')).toHaveValue('5');
  expect(errors).toEqual([]);
});

test('a cover arriving while the lesson is hidden preserves its reading unit', async ({ page }) => {
  await browserStorage(page);
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await mockCovers(page, () => held);
  const errors = await openReadyApp(page, { module: 'lesson' });
  await openLesson(page, 'KotobaFlow1', 'lesson_01');
  await page.locator('#tbReader .book-page-select').selectOption('5');
  const saved = await page.evaluate(
    () => window.ModuleSwitcher.getTextbookModule().exportNavigation().bookAnchor,
  );
  await page.locator('#modBtnDashboard').click();
  release();
  await expect(page.locator('#tbReader .tb-book-cover img')).toHaveCount(1);
  await expect
    .poll(() => page.locator('#tbReader .tb-book-cover img').evaluate((image) => image.complete))
    .toBe(true);
  expect(
    await page.evaluate(() => {
      const module = window.ModuleSwitcher.getTextbookModule();
      return { page: module._bookPager.page, column: module._bookAnchor.column };
    }),
  ).toEqual({ page: 5, column: saved.column });
  await page.locator('#modBtnLesson').click();
  await expect.poll(() => anchorOnSpread(page, saved)).toBe(true);
  expect(errors).toEqual([]);
});

test('reloading directly from the lesson retains the last selected spread', async ({ page }) => {
  await browserStorage(page);
  await mockCovers(page);
  const errors = await openReadyApp(page, { module: 'lesson' });
  await openLesson(page, 'KotobaFlow1', 'lesson_01');
  await waitForCoverLayout(page);
  await page.locator('#tbReader .book-page-select').selectOption('5');
  await page.reload();
  await expect(page.locator('#tbReader .book-frame')).toBeVisible();
  await waitForCoverLayout(page);
  await expect(page.locator('#tbReader .book-page-select')).toHaveValue('5');
  expect(errors).toEqual([]);
});

for (const changed of ['viewport', 'zoom', 'content']) {
  test(`saved reading unit survives changed ${changed}`, async ({ page }) => {
    await browserStorage(page);
    await mockCovers(page);
    const errors = await openReadyApp(page, { module: 'lesson' });
    await openLesson(page, 'KotobaFlow1', 'lesson_01');
    await expect(page.locator('#tbReader .tb-book-cover')).toHaveCount(1);
    await page.locator('#tbReader .book-page-select').selectOption('5');
    const saved = await page.evaluate(
      () => window.ModuleSwitcher.getTextbookModule().exportNavigation().bookAnchor,
    );
    expect(saved.target.text).toBeTruthy();
    await page.locator('#modBtnDashboard').click();
    if (changed === 'viewport') await page.setViewportSize({ width: 1280, height: 720 });
    if (changed === 'zoom') {
      await openSettings(page);
      await page.locator('#appScaleSelect').selectOption('1.5');
      await page.locator('#appSettingsToggle').click();
      await closeSidebar(page);
    }
    // Simulate a newer content revision while preserving the recorded unit.
    if (changed === 'content')
      await page.addInitScript(() => {
        const key = 'jp_learning_progress_browser_v1';
        const snapshot = JSON.parse(localStorage.getItem(key));
        snapshot.navigation.textbook.bookAnchor.content = 'older-content';
        localStorage.setItem(key, JSON.stringify(snapshot));
      });
    await page.goto('/');
    await resumeFromDashboard(page);
    await expect(page.locator('#tbReader .tb-book-cover')).toHaveCount(1);
    await expect.poll(() => anchorOnSpread(page, saved)).toBe(true);
    expect(errors).toEqual([]);
  });
}

// "The saved unit is on the spread" also holds when a whole section is one
// unit and the reader lands on its first spread; assert the spread itself.
test('every lesson spread restores to itself when its reading unit decides the position', async ({
  page,
}) => {
  await browserStorage(page);
  await mockCovers(page);
  const errors = await openReadyApp(page, { module: 'lesson' });
  await openLesson(page, 'KotobaFlow1', 'lesson_01');
  await waitForCoverLayout(page);
  const spreads = await page.evaluate(() => window.ModuleSwitcher.getTextbookModule()._bookPager.spreads);
  expect(spreads).toBeGreaterThan(8);
  const misplaced = [];
  for (let spread = 1; spread < spreads; spread++) {
    await page.locator('#tbReader .book-page-select').selectOption(String(spread));
    const state = await page.evaluate(() => window.ModuleSwitcher.getTextbookModule().exportNavigation());
    // A different content signature skips the exact-column path.
    state.bookAnchor.content = 'older-content';
    await page.evaluate((value) => window.ModuleSwitcher.getTextbookModule().restoreNavigation(value), state);
    await waitForCoverLayout(page);
    const restored = await page.evaluate(() => window.ModuleSwitcher.getTextbookModule()._bookPager.page);
    if (restored !== spread) misplaced.push({ spread, restored, unit: state.bookAnchor.target.text });
  }
  expect(misplaced).toEqual([]);
  expect(errors).toEqual([]);
});

test('a slightly shorter window keeps a deep grammar position within one spread', async ({ page }) => {
  await browserStorage(page);
  await mockCovers(page);
  const errors = await openReadyApp(page, { module: 'lesson' });
  await openLesson(page, 'KotobaFlow1', 'lesson_01');
  await waitForCoverLayout(page);
  const spread = await page.evaluate(() => {
    const pager = window.ModuleSwitcher.getTextbookModule()._bookPager;
    const grammar = pager.body.querySelector('.tb-cgrammar').closest('.tb-section');
    return Math.floor(pager.columnOf(grammar) / pager.perSpread) + 2;
  });
  await page.locator('#tbReader .book-page-select').selectOption(String(spread));
  const saved = await page.evaluate(
    () => window.ModuleSwitcher.getTextbookModule().exportNavigation().bookAnchor,
  );
  expect(saved.target.section).toBe('语法');
  await page.locator('#modBtnDashboard').click();
  // For example a browser toolbar shown on the next visit.
  await page.setViewportSize({ width: 1600, height: 890 });
  await page.reload();
  await resumeFromDashboard(page);
  await waitForCoverLayout(page);
  await expect.poll(() => anchorOnSpread(page, saved)).toBe(true);
  const restored = await page.evaluate(() => window.ModuleSwitcher.getTextbookModule()._bookPager.page);
  expect(Math.abs(restored - spread)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('old or malformed book positions do not break restoration; valid large positions clamp', async ({
  page,
}) => {
  await browserStorage(page);
  await mockCovers(page);
  const errors = await openReadyApp(page, { module: 'lesson' });
  await openLesson(page, 'KotobaFlow1', 'lesson_01');
  const saved = await page.evaluate(() => window.ModuleSwitcher.getTextbookModule().exportNavigation());
  for (const bookAnchor of [
    undefined,
    { version: 1, key: 'KotobaFlow1/lesson_02', column: 4 },
    { version: 1, key: 'KotobaFlow1/lesson_01', column: -1 },
    { version: 1, key: 'KotobaFlow1/lesson_01', column: 'bad' },
  ]) {
    // Archived navigation enters through the same public restore interface.
    await page.evaluate(
      (navigation) => window.ModuleSwitcher.getTextbookModule().restoreNavigation(navigation),
      { ...saved, bookAnchor },
    );
    await expect(page.locator('#tbReader .book-page-select')).toHaveValue('0');
  }
  await page.evaluate(
    (navigation) => window.ModuleSwitcher.getTextbookModule().restoreNavigation(navigation),
    { ...saved, bookAnchor: { version: 1, key: 'KotobaFlow1/lesson_01', column: 999999 } },
  );
  await expect(page.locator('#tbReader .book-turn.is-next')).toHaveText('下一课');
  expect(errors).toEqual([]);
});

test('previous lesson opens at its last spread and ordinary lesson selection resets to the start', async ({
  page,
}) => {
  await browserStorage(page);
  await mockCovers(page);
  const errors = await openReadyApp(page, { module: 'lesson' });
  await openLesson(page, 'KotobaFlow1', 'lesson_02');
  await page.locator('#tbReader .book-turn.is-prev').click();
  await expect(page.locator('.tb-lesson-card[data-lesson-id="lesson_01"]')).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.locator('#tbReader .tb-book-cover')).toHaveCount(1);
  await expect(page.locator('#tbReader .book-turn.is-next')).toHaveText('下一课');
  await openLesson(page, 'KotobaFlow1', 'lesson_02');
  await expect(page.locator('#tbReader .book-page-select')).toHaveValue('0');
  expect(errors).toEqual([]);
});

test('legacy scrolling outline and reading navigation keep their existing behavior', async ({ page }) => {
  await browserStorage(page);
  const errors = await openReadyApp(page, { module: 'lesson' });
  await chooseReadingLayout(page, 'scroll');
  await openLesson(page, 'XinBian1', 'lesson_05', 'scroll');
  const outline = page.locator('#tbReader .tb-outline');
  await outline.getByRole('link', { name: '数词', exact: true }).click();
  const before = await page.locator('#tbReader').evaluate((el) => el.scrollTop);
  expect(before).toBeGreaterThan(100);
  await page.locator('#modBtnDashboard').click();
  await page.reload();
  await page.locator('.dashboard-primary[data-dashboard-action="resume"]').click();
  await expect.poll(() => page.locator('#tbReader').evaluate((el) => el.scrollTop)).toBeCloseTo(before, 0);
  await expect(page.locator('#tbReader .book-frame')).toHaveCount(0);
  expect(errors).toEqual([]);
});
