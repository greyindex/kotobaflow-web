const { test, expect } = require('@playwright/test');
const {
  DEFAULT_LAYOUT_STORAGE,
  openReadyApp,
  openSettings,
  revealControl,
  expectReadable,
  settleBook,
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

async function spreadLevels(book) {
  return book.locator('.book-body').evaluate((body) => {
    const bounds = body.getBoundingClientRect();
    const cards = [...body.querySelectorAll('.cc-card')].filter((card) => {
      const rect = card.getBoundingClientRect();
      return rect.left >= bounds.left - 2 && rect.right <= bounds.right + 2;
    });
    return {
      total: cards.length,
      levels: [...new Set(cards.map((card) => card.dataset.level))],
      visible: cards.filter(
        (card) => getComputedStyle(card.querySelector('.cc-level')).visibility !== 'hidden',
      ).length,
      described: cards.every(
        (card) =>
          card.querySelector('.cc-card-body').getAttribute('aria-description') ===
          'JLPT ' + card.dataset.level,
      ),
    };
  });
}

for (const [width, height] of [
  [1600, 900],
  [1280, 720],
]) {
  test(`UI-ART-10 level marks follow each visible spread at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const errors = await openReadyApp(page);
    await revealControl(page.locator('[data-vocab-level="N5"]'));
    await page.locator('[data-vocab-level="N5"]').click();
    await page.keyboard.press('Escape');
    const book = page.locator('#card-container .book-frame');
    await expect
      .poll(() => spreadLevels(book))
      .toMatchObject({ levels: ['N5'], visible: 1, described: true });
    expect((await spreadLevels(book)).total).toBeGreaterThan(1);
    await book.locator('.book-turn.is-next').click();
    await settleBook(book);
    await expect
      .poll(() => spreadLevels(book))
      .toMatchObject({ levels: ['N5'], visible: 1, described: true });
    await book.locator('.book-turn.is-prev').click();
    await settleBook(book);
    const entry = book.locator('.cc-card-body').first();
    await entry.press('Enter');
    await expect(page.getByRole('dialog', { name: '词汇详情', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(entry).toBeFocused();
    await revealControl(page.locator('#resetFiltersBtn'));
    await page.locator('#resetFiltersBtn').click();
    await revealControl(page.locator('#ccSortSelect'));
    await page.locator('#ccSortSelect').selectOption('alpha');
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await spreadLevels(book)).levels.length).toBeGreaterThan(1);
    const mixed = await spreadLevels(book);
    expect(mixed.visible).toBe(mixed.total);
    expect(mixed.described).toBe(true);
    expect(errors).toEqual([]);
  });
}

for (const touch of [false, true]) {
  test.describe(`UI-ART-10 vocabulary read-from control ${touch ? 'touch' : 'pointer'}`, () => {
    test.use({
      hasTouch: touch,
      viewport: touch ? { width: 390, height: 844 } : { width: 1600, height: 900 },
    });
    test('keeps its name, keyboard path and touch access', async ({ page }) => {
      const errors = await openReadyApp(page, { module: 'lesson' });
      await revealControl(page.locator('#tbBookSelect'));
      await page.locator('#tbBookSelect').selectOption('KotobaFlow1');
      const lesson = page.locator('.tb-lesson-card[data-lesson-id="lesson_01"]');
      await revealControl(lesson);
      await lesson.click();
      await page.keyboard.press('Escape');
      const outline = page.locator('.tb-outline a').filter({ hasText: '本课词汇' });
      await revealControl(outline);
      await outline.click();
      await page.keyboard.press('Escape');
      const row = page.locator('.tb-reading-vocab-row').first();
      const read = row.locator('.tb-item-start-loop-btn');
      await page.mouse.move(0, 0);
      await expect(read).toHaveAttribute('aria-label', '从这个词开始顺序朗读');
      await expect(read).toHaveCSS('opacity', touch ? '1' : '0');
      await row.locator('.tb-reading-vocab-open').focus();
      await expect(read).toHaveCSS('opacity', '1');
      await page.keyboard.press('Tab');
      await expect(read).toBeFocused();
      await expect(read).toBeInViewport();
      await expect(read).toHaveCSS('pointer-events', 'auto');
      await page.screenshot({
        path: `local/qa/ui-art-rest-2026-10-10/controls-vocab-${touch ? 'touch' : 'keyboard'}.png`,
      });
      expect(errors).toEqual([]);
    });
  });
}

test('UI-ART-16 loading has a static paper shell and remains recoverable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let fail = true;
  await page.route('**/data/vocab_chunks/**', async (route) => {
    await held;
    if (fail) await route.fulfill({ status: 503, body: '' });
    else await route.continue();
  });
  await page.route('**/data/generated_*', (route) =>
    fail ? route.fulfill({ status: 503, body: '' }) : route.continue(),
  );
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const state = page.locator('#dashboardMain .state-view--loading');
  await expect(state).toHaveAttribute('role', 'status');
  await expect(state).toHaveAttribute('aria-busy', 'true');
  await expect(state.locator('.loading-paper')).toBeVisible();
  await expect(state.locator('.loading-paper')).toHaveAttribute('aria-hidden', 'true');
  await expect(state).toContainText('正在准备今日学习');
  expect(await state.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
  await page.screenshot({ path: 'local/qa/ui-art-rest-2026-10-10/loading-paper.png' });
  release();
  await expect(page.locator('#dashboardMain .state-view--error')).toBeVisible();
  await expect(page.locator('#dashboardMain .loading-paper')).toHaveCount(0);
  fail = false;
  await page.locator('[data-state-action="retry-app"]').click();
  await expect(page.locator('#loading')).toHaveClass(/hidden/);
  await expect(page.locator('#dashboardMain .state-view--error')).toHaveCount(0);
  await expect(page.locator('#statusTotal')).not.toHaveText('0');
});

for (const [width, height] of [
  [1600, 900],
  [1280, 720],
]) {
  test(`UI-ART-19 settings use named groups while preserving controls at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const errors = await openReadyApp(page);
    await openSettings(page);
    const panel = page.locator('#appSettingsPanel');
    await expect(panel.locator('.app-settings-group')).toHaveCount(3);
    await expect(panel.getByRole('group', { name: '外观', exact: true })).toBeVisible();
    await expect(panel.getByRole('group', { name: '阅读', exact: true })).toBeVisible();
    await expect(panel.getByRole('group', { name: '应用与数据', exact: true })).toBeVisible();
    await expect(panel.locator('.app-theme-control')).toHaveCSS('border-top-width', '0px');
    await expect(panel.locator('.app-appearance-open').first()).toHaveCSS(
      'background-color',
      'rgba(0, 0, 0, 0)',
    );
    await panel.locator('#appThemeSelect').selectOption('dark');
    await expect(panel.locator('.app-theme-control')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(panel.locator('#appAppearanceOpen')).toHaveCSS('color', 'rgb(230, 230, 230)');
    await expectReadable(panel.locator('.app-appearance-open span, .reading-focus-enter span'));
    await page.screenshot({
      path: `local/qa/ui-art-rest-2026-10-10/settings-groups-${width}.png`,
      animations: 'disabled',
    });
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(page.locator('#appSettingsToggle')).toBeFocused();
    expect(errors).toEqual([]);
  });
}

for (const [width, height, theme] of [
  [1600, 900, 'light'],
  [1280, 720, 'dark'],
  [390, 844, 'dark'],
]) {
  test(`UI-ART-19 standalone pages inherit device appearance at ${width}`, async ({ page, request }) => {
    await page.setViewportSize({ width, height });
    const dataRequests = [];
    const errors = [];
    page.on('request', (req) => {
      if (/\/(data|api)\//.test(req.url())) dataRequests.push(req.url());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/privacy.html');
    await page.evaluate((mode) => {
      window.AppTheme.setMode(mode);
      const appearance = window.AppAppearance.get();
      appearance.light = window.AppAppearance.fromPreset('sakura', 'light');
      appearance.dark = window.AppAppearance.fromPreset('sakura', 'dark');
      appearance.fonts.ui = 'system';
      window.AppAppearance.save(appearance);
    }, theme);
    const missing = await (await request.get('/404.html')).text();
    await page.route('**/missing/nested/page', (route) =>
      route.fulfill({ status: 404, contentType: 'text/html', body: missing }),
    );
    for (const [url, label] of [
      ['/privacy.html', 'privacy'],
      ['/missing/nested/page', '404'],
    ]) {
      await page.goto(url);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.locator('body')).toHaveCSS('font-family', /system-ui/);
      await expect(page.locator('.standalone-back')).toHaveCSS(
        'color',
        theme === 'dark' ? 'rgb(242, 167, 191)' : 'rgb(163, 58, 94)',
      );
      await expectReadable(page.locator('h1, p, .standalone-back'));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({
        path: `local/qa/ui-art-rest-2026-10-10/${label}-${width}-${theme}.png`,
        fullPage: true,
      });
      if (label === 'privacy') {
        await page.getByRole('link', { name: 'GitHub（greyindex）' }).scrollIntoViewIfNeeded();
        await expect(page.getByRole('link', { name: 'GitHub（greyindex）' })).toBeInViewport();
        // UI-ART-25: the third-party JLPT site moved here from the sidebar, marked as such.
        const jlpt = page.getByRole('link', { name: 'Easy JLPT', exact: true });
        await expect(jlpt).toHaveAttribute('href', 'https://easy-jlpt.com/');
        await expect(jlpt).toHaveAttribute('target', '_blank');
        await expect(jlpt).toHaveAttribute('rel', 'noopener noreferrer');
        await expect(jlpt.locator('xpath=..')).toContainText('第三方');
        await expect(jlpt.locator('xpath=..')).toContainText('非官方');
        await expectReadable(jlpt);
      }
    }
    expect(dataRequests).toEqual([]);
    expect(errors).toEqual([]);
    await page.locator('.standalone-back').click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('#loading')).toHaveClass(/hidden/);
  });
}
