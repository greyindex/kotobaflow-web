const { test, expect } = require('@playwright/test');
const {
  openReadyApp,
  revealControl,
  expectReadable,
  openSettings,
  closeSidebar,
  openSidebar,
} = require('./helpers');

async function useIsolatedProgress(page) {
  let stored = { version: 2, vocabulary: {}, navigation: {}, usage: {}, updatedAt: '' };
  await page.route('**/api/progress', async (route) => {
    if (route.request().method() === 'POST') stored = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stored) });
  });
}

test.beforeEach(async ({ page }) => useIsolatedProgress(page));

for (const [width, height] of [
  [1600, 900],
  [1280, 720],
]) {
  test(`integration: expanded navigation survives module switches and settings at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    const errors = await openReadyApp(page, { module: 'dashboard' });
    const toggle = page.locator('#statusBarShowBtn');
    await toggle.click();
    for (const module of ['lesson', 'grammar', 'vocab', 'dashboard']) {
      await page.locator(`.mod-btn[data-module="${module}"]`).click();
      await expect(page.locator('body')).toHaveAttribute('data-unified-sidebar-module', module);
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator('#narrowGlobalSidebarBackdrop')).toBeVisible();
      await page.locator('#appSettingsToggle').click();
      await expect(page.locator('#appSettingsPanel')).toBeVisible();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await page.keyboard.press('Escape');
      await expect(page.locator('#appSettingsPanel')).toBeHidden();
      await expect(page.locator('#appSettingsToggle')).toBeFocused();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    }
    await page.locator('#appSettingsToggle').click();
    await page.locator('#appAppearanceOpen').click();
    await expect(page.locator('#appearanceDialog')).toBeVisible();
    await page.locator('#appearanceApply').focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('#appearanceClose')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#appearanceDialog')).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await toggle.click();
    await expect(page.locator('.app-container')).not.toHaveAttribute('inert');
    await toggle.click();
    await page.locator('#appSettingsToggle').click();
    await page.locator('#narrowGlobalSidebarBackdrop').click({ position: { x: width - 10, y: 100 } });
    await expect(page.locator('#appSettingsPanel')).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();
    expect(errors).toEqual([]);
  });
}

test('integration: textbook reading tools start collapsed and remain operable', async ({ page }) => {
  await openReadyApp(page, { module: 'lesson' });
  await page.locator('#statusBarShowBtn').click();
  const tools = page.locator('.tb-sidebar-reading-group');
  await expect(tools).not.toHaveAttribute('open');
  await expect(page.locator('#tbSidebarReadingControls')).toBeHidden();
  await tools.locator('summary').press('Enter');
  await expect(page.locator('#tbSidebarReadingControls')).toBeVisible();
  await page.locator('#modBtnGrammar').click();
  await page.locator('#modBtnLesson').click();
  await expect(tools).not.toHaveAttribute('open');
  await tools.locator('summary').click();
  await expect(page.locator('#tbSidebarReadingControls')).toBeVisible();
  await tools.locator('summary').click();
  await expect(tools).not.toHaveAttribute('open');
  await expect(page.locator('#statusBarShowBtn')).toHaveAttribute('aria-expanded', 'true');
});

test('wayfinding: zoomed short rail keeps every navigation control above the footer', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openReadyApp(page);
  await openSettings(page);
  await page.locator('#appScaleSelect').selectOption('1.5');
  await page.keyboard.press('Escape');
  await closeSidebar(page);
  await expect(page.locator('html')).toHaveClass(/layout-max-900/);
  const header = await page.locator('.app-header').boundingBox();
  // UI-ART-28: the collapsed rail holds the modules; search and settings are
  // in the opened sidebar.
  await expect(page.locator('#globalSearchToggle')).toBeHidden();
  await expect(page.locator('#appSettingsToggle')).toBeHidden();
  for (const control of await page.locator('.app-header .mod-btn').all()) {
    const box = await control.boundingBox();
    expect(box.y + box.height, await control.getAttribute('aria-label')).toBeLessThanOrEqual(
      header.y + header.height - 3,
    );
  }
  await openSidebar(page);
  await page.locator('#appSettingsToggle').press('Enter');
  await expect(page.locator('#appSettingsPanel')).toBeVisible();
});

async function chooseLesson(page, id) {
  const directory = page.locator('.tb-lesson-directory');
  await revealControl(directory.locator('summary'));
  if (!(await directory.evaluate((el) => el.open))) await directory.locator('summary').click();
  await page.locator(`.tb-lesson-card[data-lesson-id="${id}"]`).click();
  await expect(page.locator('.tb-reader-body')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => ModuleSwitcher.getTextbookModule().currentLesson?.lesson.item_id))
    .toBe(id);
  await revealControl(page.locator('#tbLessonHeading'));
}

async function expectFits(page, locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box.x).toBeGreaterThanOrEqual(-0.5);
  expect(box.y).toBeGreaterThanOrEqual(-0.5);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 0.5);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 0.5);
}

for (const [width, height] of [
  [1600, 900],
  [1280, 720],
  [1024, 768],
  [390, 844],
]) {
  test(`wayfinding: heading tools open the drawer and restore focus at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const errors = await openReadyApp(page);
    for (const [module, headingId, action, focusSelector] of [
      ['Vocab', 'vocabHeading', 'tools', '#vocabLevelChips .active'],
      ['Grammar', 'grammarHeading', 'tools', '#gmSidebarFilters .gm-tab.active'],
      ['Lesson', 'tbLessonHeading', 'toc', '.tb-lesson-card[aria-current="page"]'],
    ]) {
      await page.locator(`#modBtn${module}`).click();
      const heading = page.locator(`#${headingId}`);
      const trigger = heading.locator(`[data-heading-action="${action}"]`);
      await expectFits(page, heading);
      await expectFits(page, trigger);
      await trigger.press('Enter');
      await expect(page.locator('#unifiedSidebar')).toHaveAttribute('aria-modal', 'true');
      await expect(page.locator(focusSelector)).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
      await expect(page.locator('.app-container')).not.toHaveAttribute('inert');
    }
    expect(errors).toEqual([]);
  });
}

test('wayfinding: N5 heading starts a finite session from the selected vocabulary', async ({ page }) => {
  const errors = await openReadyApp(page);
  const heading = page.locator('#vocabHeading');
  await heading.locator('[data-heading-action="tools"]').click();
  await page.locator('[data-vocab-level="N5"]').click();
  await page.keyboard.press('Escape');
  await expect(heading.locator('.page-heading-title')).toHaveText('JLPT N5 词汇');
  await expect(page.locator('.cc-card').first().locator('.cc-level')).toHaveText('N5');
  await expect(heading.locator('[data-heading-action="study"]')).toHaveText('随机学 20 词');
  await heading.locator('[data-heading-action="study"]').click();
  await expect(page.locator('.practice-card')).toBeVisible();
  await expect(page.locator('#statusStudyQueue')).toHaveText('20');
  await expect(heading).toBeHidden();
  expect(errors).toEqual([]);
});

test('wayfinding: literal search text and empty-result recovery are safe in the heading', async ({
  page,
}) => {
  const errors = await openReadyApp(page);
  const heading = page.locator('#vocabHeading');
  const query = '<b>wayfinding-no-match</b>';
  await heading.locator('[data-heading-action="tools"]').click();
  await page.locator('#searchInput').fill(query);
  await expect(page.locator('.cc-empty-state')).toBeAttached();
  await page.keyboard.press('Escape');
  await expect(heading.locator('.page-heading-title')).toHaveText(`搜索“${query}”`);
  await expect(heading.locator('.page-heading-title b')).toHaveCount(0);
  await expect(heading.locator('[data-heading-action="study"]')).toBeDisabled();
  await heading.locator('[data-heading-action="clear"]').press('Enter');
  await expect(heading.locator('.page-heading-title')).toHaveText('全部词汇');
  await expect(heading.locator('.page-heading-title')).toBeFocused();
  await expect(page.locator('.cc-card').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('wayfinding: clear filters keeps the selected list view', async ({ page }) => {
  await openReadyApp(page);
  const heading = page.locator('#vocabHeading');
  await heading.locator('[data-heading-action="tools"]').click();
  await page.locator('#viewModeSelect').selectOption('list');
  await page.locator('[data-vocab-level="N5"]').click();
  await page.keyboard.press('Escape');
  await expect(heading.locator('.page-heading-title')).toHaveText('JLPT N5 词汇');
  await heading.locator('[data-heading-action="clear"]').click();
  await expect(heading.locator('.page-heading-title')).toHaveText('全部词汇');
  await expect(page.locator('#listTable')).toBeVisible();
  await expect(page.locator('#card-container')).toBeHidden();
});

test('wayfinding: grammar heading filters and switches auxiliary lessons reversibly', async ({ page }) => {
  const errors = await openReadyApp(page, { module: 'grammar' });
  const heading = page.locator('#grammarHeading');
  await heading.locator('[data-heading-action="tools"]').click();
  await page.locator('#gmSidebarFilters .gm-tab[data-level="N5"]').click();
  await page.keyboard.press('Escape');
  await expect(heading.locator('.page-heading-title')).toHaveText('JLPT N5 语法');
  await heading.locator('[data-heading-action="view-lessons"]').click();
  await expect(heading.locator('.page-heading-title')).toHaveText('语法辅助课文');
  await expect(page.locator('.gm-lesson-grid')).toBeVisible();
  await heading.locator('[data-heading-action="view-grammar"]').click();
  await expect(heading.locator('.page-heading-title')).toHaveText('JLPT N5 语法');
  await heading.locator('[data-heading-action="clear"]').click();
  await expect(heading.locator('.page-heading-title')).toHaveText('全部语法');
  expect(errors).toEqual([]);
});

test('wayfinding: chapter and lesson-end navigation keep location and keyboard focus', async ({ page }) => {
  const errors = await openReadyApp(page, { module: 'lesson' });
  const heading = page.locator('#tbLessonHeading');
  await expect(heading.locator('.page-heading-title-prefix')).toHaveText('第一课');
  await expect(heading.locator('[data-heading-action="previous"]')).toBeDisabled();
  const next = heading.locator('[data-heading-action="next"]');
  await next.press('Enter');
  await expect(heading.locator('.page-heading-title-prefix')).toHaveText('第二课');
  await expect(next).toBeFocused();
  await expect.poll(() => page.locator('#tbReader').evaluate((el) => el.scrollTop)).toBe(0);
  await page.locator('.tb-lesson-end [data-lesson-step="next"]').press('Enter');
  await expect(heading.locator('.page-heading-title-prefix')).toHaveText('第三课');
  await expect(heading.locator('.page-heading-title')).toBeFocused();
  await expect.poll(() => page.locator('#tbReader').evaluate((el) => el.scrollTop)).toBe(0);
  expect(errors).toEqual([]);
});

test('wayfinding: rapid header navigation ignores an older delayed lesson', async ({ page }) => {
  await openReadyApp(page, { module: 'lesson' });
  await expect(page.locator('#tbLessonHeading')).toBeVisible();
  await page.evaluate(() => {
    const original = TextbookLoader.getLesson;
    const gate = new Promise((resolve) => {
      window.releaseHeadingLesson = resolve;
    });
    TextbookLoader.getLesson = async function (book, lesson) {
      if (lesson === 'lesson_02') {
        window.headingOldLoad = gate.then(() => original.call(this, book, lesson));
        return window.headingOldLoad;
      }
      return original.call(this, book, lesson);
    };
  });
  const next = page.locator('#tbLessonHeading [data-heading-action="next"]');
  await next.press('Enter');
  await next.press('Enter');
  const title = page.locator('#tbLessonHeading .page-heading-title-prefix');
  await expect(title).toHaveText('第三课');
  await page.evaluate(async () => {
    window.releaseHeadingLesson();
    await window.headingOldLoad;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await expect(title).toHaveText('第三课');
  await expect(next).toBeFocused();
});

for (const viewed of [false, true]) {
  test(`wayfinding: grammar heading return ${viewed ? 'completes viewed' : 'preserves unviewed'} step and scroll`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const errors = await openReadyApp(page, { module: 'lesson' });
    await chooseLesson(page, 'lesson_02');
    const reader = page.locator('#tbReader');
    await reader.hover();
    await page.mouse.wheel(0, 460);
    await expect.poll(() => reader.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    const before = await reader.evaluate((el) => el.scrollTop);
    const toggle = page.locator('.tb-course-path-toggle');
    await revealControl(toggle);
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    const action = page.locator('[data-course-action="step"][data-course-step="grammar"]');
    if (!(await action.isVisible())) await page.locator('.tb-course-other-toggle').click();
    await action.click();
    const heading = page.locator('#grammarHeading');
    await revealControl(heading);
    await expect(heading.locator('.page-heading-title-prefix')).toHaveText('第二课');
    if (viewed) {
      await page.locator('.gm-course-grammar-card').first().click();
      await expect(page.locator('.gm-course-detail')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(heading).toContainText('已查看语法点');
    }
    await heading.locator('[data-heading-action="return"]').click();
    await expect(page.locator('#textbookMain')).toBeVisible();
    await expect
      .poll(async () => Math.abs((await reader.evaluate((el) => el.scrollTop)) - before))
      .toBeLessThan(2);
    await expect(page.locator('#tbLessonHeading .page-heading-steps')).toHaveAttribute(
      'aria-label',
      viewed ? /查看语法已完成/ : /查看语法进行中/,
    );
    expect(errors).toEqual([]);
  });
}

for (const [width, height, theme] of [
  [1600, 900, 'light'],
  [1280, 720, 'dark'],
]) {
  test(`wayfinding: pronunciation and section controls remain readable at ${width} ${theme}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript((value) => localStorage.setItem('jp_learning_theme', value), theme);
    await openReadyApp(page, { module: 'lesson' });
    await chooseLesson(page, 'lesson_03');
    const word = page.locator('.tb-phonetic-word').filter({ hasText: /^おばあさん$/ });
    await word.scrollIntoViewIfNeeded();
    await expectReadable(word);
    const metrics = await word.evaluate((el) => ({
      size: parseFloat(getComputedStyle(el).fontSize),
      height: el.getBoundingClientRect().height,
    }));
    expect(metrics.size).toBeGreaterThanOrEqual(16);
    expect(metrics.height).toBeLessThanOrEqual(metrics.size * 1.5);
    await expectReadable(page.locator('.tb-outline a'));
    const audio = await page.locator('.tb-section-head .tb-tts-btn').evaluateAll((buttons) =>
      buttons.map((el) => {
        const box = el.getBoundingClientRect();
        const parent = el.closest('.tb-section-head').getBoundingClientRect();
        return { right: box.right, parentRight: parent.right, height: box.height };
      }),
    );
    expect(audio.length).toBeGreaterThan(0);
    for (const button of audio) {
      expect(Math.abs(button.right - button.parentRight)).toBeLessThanOrEqual(2);
      expect(button.height).toBeLessThanOrEqual(34);
    }
    const labels = await page.locator('.tb-item-source').allTextContents();
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) expect(label).toMatch(/^出自[^a-z]+$/);
  });
}

for (const [width, height, scale] of [
  [320, 844, '1'],
  [390, 844, '1'],
  [1280, 720, '1.5'],
]) {
  test(`wayfinding: Today resume actions fit and start new learning at ${width} scale ${scale}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    const errors = await openReadyApp(page, { module: 'lesson' });
    await expect(page.locator('#tbLessonHeading')).toBeVisible();
    await page.locator('#modBtnDashboard').click();
    if (scale !== '1') {
      await openSettings(page);
      await page.locator('#appScaleSelect').selectOption(scale);
      await page.keyboard.press('Escape');
      await closeSidebar(page);
    }
    const buttons = page.locator('.dashboard-start-actions > button');
    await expect(buttons).toHaveCount(2);
    for (const button of await buttons.all()) await expectFits(page, button);
    await expect(page.locator('.dashboard-trend-bars')).toHaveCount(0);
    await expect(page.locator('[data-dashboard-insight="trend"]')).toContainText('最近 7 天');
    await page.locator('.dashboard-secondary').click();
    await expect(page.locator('.practice-card')).toBeVisible();
    await expect(page.locator('#statusStudyQueue')).toHaveText('20');
    expect(errors).toEqual([]);
  });
}

test('review regression: a global search hit below the fold keeps its vocabulary detail open', async ({
  page,
}) => {
  const errors = await openReadyApp(page);
  await page.keyboard.press('Control+k');
  await page.locator('#globalSearchInput').fill('学生');
  const result = page.locator('[aria-label="词汇结果"] .global-search-result').first();
  await expect(result).toContainText('学生');
  await result.click();
  // 学生 sorts after more than a screen of related cards in the same page.
  await expect(page.locator('#detailPanel')).toBeVisible();
  await expect(page.locator('#detailPanel h3')).toHaveText('学生');
  await expect(page.locator('#detailPanelCollapseBtn')).toBeFocused();
  await expect(page.locator('.cc-card-body[data-detail-anchor-active="true"]')).toBeInViewport();
  expect(errors).toEqual([]);
});

for (const [width, height] of [
  [1600, 900],
  [1024, 768],
]) {
  test(`wayfinding: collapsed rail shows module labels only on hover or keyboard focus at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    const errors = await openReadyApp(page, { module: 'dashboard' });
    await expect(page.locator('#appBrandHome')).toHaveAccessibleName('词基流动，返回今日首页');
    const grammar = page.locator('#modBtnGrammar');
    const label = grammar.locator('.mod-btn-label');
    await expect(grammar).toHaveAccessibleName('语法');
    await expect(label).toHaveCSS('opacity', '0');
    await grammar.hover();
    await expect(label).toHaveCSS('opacity', '1');
    const button = await grammar.boundingBox();
    const flyout = await label.boundingBox();
    expect(flyout.x).toBeGreaterThanOrEqual(button.x + button.width);
    expect(Math.abs(flyout.y + flyout.height / 2 - (button.y + button.height / 2))).toBeLessThanOrEqual(2);
    await page.mouse.move(width - 20, height - 20);
    await expect(label).toHaveCSS('opacity', '0');
    await page.locator('#modBtnDashboard').focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('#modBtnLesson')).toBeFocused();
    await expect(page.locator('#modBtnLesson .mod-btn-label')).toHaveCSS('opacity', '1');
    if (width >= 1280) {
      await page.locator('#statusBarShowBtn').click();
      await expect(label).toHaveCSS('position', 'static');
      await expect(label).toBeVisible();
      await expect(page.locator('#appBrandHome strong')).toHaveText('词基流动');
    }
    expect(errors).toEqual([]);
  });
}

test('wayfinding: grammar levels share the vocabulary bar and favorites stand alone', async ({ page }) => {
  const errors = await openReadyApp(page, { module: 'grammar' });
  const heading = page.locator('#grammarHeading');
  await heading.locator('[data-heading-action="tools"]').click();
  const filters = page.locator('#gmSidebarFilters');
  const bar = filters.locator('.gm-level-tabs');
  await expect(bar).toHaveAttribute('role', 'group');
  await expect(bar.locator('.gm-tab')).toHaveText(['全部', 'N5', 'N4', 'N3', 'N2', 'N1']);
  const rows = await bar
    .locator('.gm-tab')
    .evaluateAll((buttons) => buttons.map((button) => Math.round(button.getBoundingClientRect().top)));
  expect(new Set(rows).size).toBe(1);
  await expect(bar.locator('.gm-tab-fav')).toHaveCount(0);
  await expect(filters.locator('input[type="checkbox"]')).toHaveCount(0);
  for (const removed of ['有辨析', '有误用', '有课文']) await expect(filters).not.toContainText(removed);
  const favorite = filters.locator('.gm-tab-fav');
  await expect(favorite).toHaveAttribute('aria-pressed', 'false');
  await bar.locator('[data-level="N3"]').click();
  await expect(bar.locator('[data-level="N3"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(bar.locator('[data-level="all"]')).toHaveAttribute('aria-pressed', 'false');
  await filters.locator('.gm-tab-fav').click();
  await expect(filters.locator('.gm-tab-fav')).toHaveAttribute('aria-pressed', 'true');
  await expect(bar.locator('[data-level="N3"]')).toHaveClass(/active/);
  await page.keyboard.press('Escape');
  await expect(heading.locator('.page-heading-title')).toHaveText('JLPT N3 语法');
  await expect(heading.locator('.page-heading-meta')).toContainText('只看收藏');
  await heading.locator('[data-heading-action="clear"]').click();
  await expect(heading.locator('.page-heading-title')).toHaveText('全部语法');
  expect(errors).toEqual([]);
});

for (const [module, headingId, listSelector] of [
  ['vocab', 'vocabHeading', '#card-container'],
  ['grammar', 'grammarHeading', '#gmGrammarList'],
]) {
  test(`wayfinding: ${module} heading slides away on scroll down and returns on scroll up`, async ({
    page,
  }) => {
    const errors = await openReadyApp(page, { module });
    const heading = page.locator(`#${headingId}`);
    const list = page.locator(listSelector);
    await expect(heading).toBeVisible();
    const start = await list.boundingBox();
    const column = await page.locator(`#${headingId}`).locator('xpath=..').boundingBox();
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    const scrollDown = async () => {
      for (let i = 0; i < 4; i += 1) {
        await page.mouse.wheel(0, 150);
        await page.waitForTimeout(80);
      }
      await expect(heading).toHaveClass(/is-scroll-hidden/);
    };
    await scrollDown();
    // The list takes over the heading's space at the top of the clipped main column.
    await expect.poll(async () => Math.round((await list.boundingBox()).y)).toBe(Math.round(column.y));
    await expect
      .poll(async () => {
        const box = await heading.boundingBox();
        return box.y + box.height;
      })
      .toBeLessThanOrEqual(column.y + 1);
    await page.waitForTimeout(400);
    await page.mouse.wheel(0, -80);
    await expect(heading).not.toHaveClass(/is-scroll-hidden/);
    await expect.poll(async () => Math.round((await list.boundingBox()).y)).toBe(Math.round(start.y));
    expect(await list.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
    await page.waitForTimeout(400);
    await scrollDown();
    await page.waitForTimeout(400);
    await heading.locator('[data-heading-action="tools"]').focus();
    await expect(heading).not.toHaveClass(/is-scroll-hidden/);
    expect(errors).toEqual([]);
  });
}
