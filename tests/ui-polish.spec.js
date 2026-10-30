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

async function openLesson(page, bookId, lessonId) {
  await page.locator('#modBtnLesson').click();
  const select = page.locator('#tbBookSelect');
  await revealControl(select);
  await select.selectOption(bookId);
  const lesson = page.locator(`.tb-lesson-card[data-lesson-id="${lessonId}"]`);
  await revealControl(lesson);
  await lesson.click();
  await expect(lesson).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Escape');
  await expect(page.locator('#tbReader .book-frame')).toBeVisible();
}

for (const [width, height, theme] of [
  [1600, 900, 'light'],
  [1280, 720, 'dark'],
]) {
  test(`UI-ART-03 Chinese headings and Japanese learning text keep separate fonts at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    const errors = await openReadyApp(page, { module: 'dashboard' });
    await openSettings(page);
    await page.locator('#appThemeSelect').selectOption(theme);
    await page.keyboard.press('Escape');
    await closeSidebar(page);
    for (const selector of [
      '.dashboard-heading h1',
      '.dashboard-start-card h2',
      '.dashboard-section-title h2',
    ]) {
      await expect(page.locator(selector).first()).toHaveCSS('font-family', /Microsoft YaHei/);
    }
    await page.locator('#modBtnGrammar').click();
    await expect(page.locator('.gm-card-connection').first()).toHaveAttribute('lang', 'ja');
    await expect(page.locator('.gm-card-connection > span').first()).toHaveAttribute('lang', 'zh-CN');
    await expect(page.locator('.gm-card-connection > span').first()).toHaveCSS(
      'font-family',
      /Microsoft YaHei/,
    );
    await page.keyboard.press('Control+k');
    await page.locator('#globalSearchInput').fill('食べる');
    const result = page
      .locator('.global-search-group[aria-label="词汇结果"] .global-search-result-copy')
      .first();
    await expect(result.locator('strong')).toHaveAttribute('lang', 'ja');
    await expect(result.locator('strong')).toHaveCSS('font-family', /Mincho/);
    await expect(result.locator('span')).toHaveAttribute('lang', 'ja');
    await page.keyboard.press('Escape');
    await openLesson(page, 'XinBian1', 'lesson_01');
    await expect(page.locator('#tbLessonHeading .page-heading-title-text')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.locator('#tbLessonHeading .page-heading-title-text')).toHaveCSS(
      'font-family',
      /Microsoft YaHei/,
    );
    await openLesson(page, 'KotobaFlow1', 'lesson_01');
    await expect(
      page.locator('.tb-lesson-card[data-lesson-id="lesson_01"] .tb-lesson-title'),
    ).toHaveAttribute('lang', 'ja');
    await expect(page.locator('.tb-dialogue-speaker').first()).toHaveAttribute('lang', 'ja');
    const word = page.locator('#tbReader .tb-inline-highlight-link').first();
    await word.press('Enter');
    const popup = page.getByRole('dialog', { name: '课文词汇详情', exact: true });
    await expect(popup).toBeVisible();
    await expect(popup.locator('.tb-detail-value-text').first()).toHaveAttribute('lang', 'ja');
    await expect(
      popup.locator('.tb-detail-row').filter({ hasText: '日语释义' }).locator('.tb-detail-value').first(),
    ).toHaveAttribute('lang', 'ja');
    await page.keyboard.press('Escape');
    await expect(word).toBeFocused();
    expect(errors).toEqual([]);
  });

  test(`UI-ART-07 inline lookup preserves text spacing and keyboard/pointer access at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    const errors = await openReadyApp(page, { module: 'lesson' });
    await openSettings(page);
    await page.locator('#appThemeSelect').selectOption(theme);
    await page.keyboard.press('Escape');
    await closeSidebar(page);
    await openLesson(page, 'KotobaFlow1', 'lesson_01');
    for (const mode of ['normal', 'chunks']) {
      const modeButton = page.locator(`.tb-display-mode-btn[data-display-mode="${mode}"]`);
      await revealControl(modeButton);
      await modeButton.click();
      await page.keyboard.press('Escape');
      const word = page.locator('#tbReader .tb-inline-highlight-link').first();
      await expect(word).toHaveCSS('padding-left', '0px');
      await expect(word).toHaveCSS('padding-right', '0px');
      await word.press('Enter');
      const popup = page.getByRole('dialog', { name: '课文词汇详情', exact: true });
      await expect(popup).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(word).toBeFocused();
      await expect(word).toHaveCSS('outline-style', 'solid');
      await word.click();
      await expect(popup).toBeVisible();
      await page.keyboard.press('Escape');
      const translation = page.locator('.tb-dialogue-turn .tb-translation').first();
      await expect(translation).toHaveCSS('border-left-width', '0px');
      await expect(page.locator('.tb-dialogue-turn').first()).toHaveCSS('border-bottom-width', '1px');
    }
    expect(errors).toEqual([]);
  });
}

// Opening a word detail can move text under a resting pointer. Neither that
// crossing nor a later hover may let a chunk parse close the detail (FIX-32).
test('FIX-32 hover parse does not displace a word detail opened from the keyboard', async ({ page }) => {
  const pageErrors = await openReadyApp(page, { module: 'lesson' });
  await openLesson(page, 'KotobaFlow1', 'lesson_01');
  const chunksMode = page.locator('.tb-display-mode-btn[data-display-mode="chunks"]');
  await revealControl(chunksMode);
  await chunksMode.click();
  await expect(chunksMode).toHaveClass(/active/);
  await page.keyboard.press('Escape');

  const chunkDetail = page.locator('#tbChunkDetail');
  const wordDetail = page.getByRole('dialog', { name: '课文词汇详情', exact: true });
  const word = page.locator('#tbReader .tb-inline-highlight-link').first();
  await revealControl(word);
  const chunk = page.locator('[data-text-chunk]').first();
  await revealControl(chunk);
  await chunk.hover();
  await expect(chunkDetail).toBeVisible();

  await word.press('Enter');
  await expect(wordDetail).toBeVisible();
  await expect(chunkDetail).toBeHidden();
  const point = await page.evaluate(() => {
    const detail = document.querySelector('#textbookDetailPanel').getBoundingClientRect();
    for (const element of document.querySelectorAll('#tbReader [data-text-chunk]')) {
      const rect = element.getClientRects()[0];
      if (!rect || rect.width < 4) continue;
      const x = rect.left + Math.min(8, rect.width / 2);
      const y = rect.top + rect.height / 2;
      const covered = x >= detail.left && x <= detail.right && y >= detail.top && y <= detail.bottom;
      if (!covered && element.contains(document.elementFromPoint(x, y))) return { x, y };
    }
    return null;
  });
  expect(point).not.toBeNull();
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(300);
  await expect(wordDetail).toBeVisible();
  await expect(chunkDetail).toBeHidden();

  await page.keyboard.press('Escape');
  await expect(wordDetail).toBeHidden();
  await page.mouse.move(2, 2);
  await page.mouse.move(point.x, point.y);
  await expect(chunkDetail).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('UI-ART-05 default shell and standalone branding share the paper/navy palette', async ({
  page,
  request,
}) => {
  await page.route('**/js/appearance.js*', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: '' }),
  );
  await page.goto('/');
  await expect(page.locator('html')).toHaveCSS('--c-primary', '#2b4c7e');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#16181c');
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.theme_color).toBe('#16181c');
  // UI-ART-25: the install splash matches the 简洁 default page painted by appearance.js.
  expect(manifest.background_color).toBe('#ffffff');
  const icon = await (await request.get('/pwa-icon.svg')).text();
  expect(icon).toContain('#2b4c7e');
  expect(icon).not.toMatch(/#1f6964|#13201e/i);
  await page.goto('/404.html');
  await expect(page.locator('h1')).toHaveCSS('color', 'rgb(43, 76, 126)');
});
