const { test, expect } = require('@playwright/test');
const {
  DEFAULT_LAYOUT_STORAGE,
  openReadyApp,
  revealControl,
  openSettings,
  closeSidebar,
} = require('./helpers');

test.use({ serviceWorkers: 'block', storageState: DEFAULT_LAYOUT_STORAGE });

test.beforeEach(async ({ page }) => {
  await page.route('**/js/storage-config.js*', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: "window.JPLearnStorageConfig = { mode: 'browser' };",
    }),
  );
  await page.route('**/kotobaflow_unit_images_v1/images.json*', (route) =>
    route.fulfill({ json: { schema: 1, count: 0, images: {} } }),
  );
});

async function openLesson(page) {
  await revealControl(page.locator('#tbBookSelect'));
  await page.locator('#tbBookSelect').selectOption('KotobaFlow1');
  const lesson = page.locator('.tb-lesson-card[data-lesson-id="lesson_01"]');
  await revealControl(lesson);
  await lesson.click();
  await expect(lesson).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Escape');
  await expect(page.locator('#tbReader .book-frame')).toBeVisible();
  await expect(page.locator('#tbLoading')).toHaveClass(/hidden/);
}

async function geometry(page, heading, book) {
  return page.evaluate(
    ({ heading, book }) => {
      const title = document.querySelector(heading + ' .page-heading-copy').getBoundingClientRect();
      const actions = document.querySelector(heading + ' .page-heading-actions').getBoundingClientRect();
      const frame = document.querySelector(book).getBoundingClientRect();
      return { left: Math.abs(title.left - frame.left), right: Math.abs(actions.right - frame.right) };
    },
    { heading, book },
  );
}

for (const width of [1280, 1600, 1920]) {
  for (const [module, heading, book] of [
    ['vocab', '#vocabHeading', '#card-container .book-frame'],
    ['grammar', '#grammarHeading', '#gmGrammarList .book-frame'],
  ]) {
    test(`UI-ART-12 ${module} heading aligns with both book edges at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 1280 ? 720 : 900 });
      const errors = await openReadyApp(page, { module });
      await expect(page.locator(book)).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expect.poll(async () => (await geometry(page, heading, book)).left).toBeLessThanOrEqual(1);
      await expect.poll(async () => (await geometry(page, heading, book)).right).toBeLessThanOrEqual(1);
      expect(errors).toEqual([]);
    });
  }
}

for (const width of [390, 1280, 1600]) {
  test(`UI-ART-12 lesson directory is a readable disclosure at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1280 ? 720 : 900 });
    const errors = await openReadyApp(page, { module: 'lesson' });
    await openLesson(page);
    const outline = page.locator('#tbReader .tb-outline');
    const summary = outline.locator('summary');
    await expect(summary).toBeVisible();
    await expect(outline).not.toHaveAttribute('open');
    const originalPage = await page.locator('#tbReader .book-page-select').inputValue();
    await summary.click();
    const nav = outline.locator('nav');
    await expect(nav).toBeVisible();
    const box = await nav.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(230);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    const lineCounts = await outline.locator('a').evaluateAll((links) =>
      links.map((link) => {
        const text = document.createRange();
        text.selectNodeContents(link);
        return text.getBoundingClientRect().height / parseFloat(getComputedStyle(link).lineHeight);
      }),
    );
    expect(Math.max(...lineCounts)).toBeLessThan(3);
    await page.keyboard.press('Escape');
    await expect(summary).toBeFocused();
    await expect(page.locator('#tbReader .book-page-select')).toHaveValue(originalPage);
    await summary.click();
    const destination = outline.locator('a').last();
    const target = await destination.getAttribute('href');
    await destination.click();
    await expect(outline).not.toHaveAttribute('open');
    await expect(page.locator(target)).toBeFocused();
    await expect(destination).toHaveAttribute('aria-current', 'location');
    expect(errors).toEqual([]);
  });
}

for (const scale of ['1', '1.5']) {
  test(`UI-ART-17 phone rail, drawer and book controls remain reachable at scale ${scale}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const errors = await openReadyApp(page, { module: 'lesson' });
    await openSettings(page);
    await page.locator('#appScaleSelect').selectOption(scale);
    await page.keyboard.press('Escape');
    await closeSidebar(page);
    await openLesson(page);
    await expect(page.locator('#tbReader .book-footer')).toBeInViewport({ ratio: 1 });
    const rail = page.locator('#unifiedSidebar');
    const appliedScale = await page.evaluate(() => window.AppDisplayScale.getScale());
    await expect.poll(async () => (await rail.boundingBox()).width / appliedScale).toBeLessThanOrEqual(56.1);
    const targets = page.locator(
      '#moduleSwitcher .mod-btn, #appSettingsToggle, #globalSearchToggle, #statusBarShowBtn, #tabletSidebarToggle, #tbReader .book-turn, #tbReader .book-page-select, #tbLessonHeading .page-heading-action, #tbReader .tb-outline summary, #tbReader .tb-tts-btn, #tbReader .tb-turn-play-btn',
    );
    const sizes = await targets.evaluateAll((elements) =>
      elements
        .filter((element) => element.getClientRects().length)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            label: element.getAttribute('aria-label') || element.textContent,
            w: rect.width,
            h: rect.height,
          };
        }),
    );
    for (const size of sizes) {
      expect(size.w, size.label).toBeGreaterThanOrEqual(43.9);
      expect(size.h, size.label).toBeGreaterThanOrEqual(43.9);
    }

    const picker = page.locator('#tbReader .book-page-select');
    await picker.selectOption('1');
    await page.locator('#tbReader .book-turn.is-next').click();
    await expect(picker).toHaveValue('2');
    const tools = page.locator('#tbLessonHeading [data-heading-action="tools"]');
    // Course headings label the same drawer entry "课程目录".
    const drawerEntry = (await tools.count())
      ? tools
      : page.locator('#tbLessonHeading [data-heading-action="toc"]');
    await drawerEntry.click();
    await expect(page.locator('.app-container')).toHaveAttribute('inert');
    await expect(rail).toHaveAttribute('aria-modal', 'true');
    await expect(page.locator('#tbBookSelect')).toBeVisible();
    const opened = await rail.boundingBox();
    expect(opened.x).toBe(0);
    expect(opened.x + opened.width).toBeLessThanOrEqual(390);
    await page.keyboard.press('Escape');
    await expect(drawerEntry).toBeFocused();
    await expect(picker).toHaveValue('2');

    await page.locator('#modBtnGrammar').click();
    await expect(page.locator('#gmGrammarList .book-frame')).toBeVisible();
    await page.locator('#modBtnLesson').click();
    await expect(picker).toHaveValue('2');
    await expect(page.locator('#tbReader .book-footer')).toBeInViewport({ ratio: 1 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
      .toBe(true);
    expect(errors).toEqual([]);
  });
}

test('UI-ART-17 phone zoom and drawer keep the current reading section', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await openReadyApp(page, { module: 'lesson' });
  await openLesson(page);
  const outline = page.locator('#tbReader .tb-outline');
  await outline.locator('summary').click();
  const destination = outline.locator('a').last();
  const target = await destination.getAttribute('href');
  await destination.click();
  await openSettings(page);
  await page.locator('#appScaleSelect').selectOption('1.5');
  await page.keyboard.press('Escape');
  await closeSidebar(page);
  await expect(destination).toHaveAttribute('aria-current', 'location');
  await expect
    .poll(() =>
      page.locator(target + ' .tb-section-head').evaluate((heading) => {
        const rect = heading.getBoundingClientRect();
        const body = heading.closest('.book-body').getBoundingClientRect();
        return rect.left >= body.left - 1 && rect.right <= body.right + 1;
      }),
    )
    .toBe(true);
  const currentPage = await page.locator('#tbReader .book-page-select').inputValue();
  await page.locator('#statusBarShowBtn').click();
  await expect(page.locator('#tbBookSelect')).toBeVisible();
  // Use viewport coordinates because the app can apply CSS zoom to the backdrop.
  await page.mouse.click(388, 8);
  await expect(page.locator('#statusBarShowBtn')).toBeFocused();
  await expect(page.locator('#tbReader .book-page-select')).toHaveValue(currentPage);
  expect(errors).toEqual([]);
});
