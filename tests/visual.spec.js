const { revealControl, openSettings, closeSidebar } = require('./helpers');
const { test, expect } = require('@playwright/test');
const { openReadyApp } = require('./helpers');
const { PNG } = require('pngjs');
const {
  compareVerticalEdgeScreenshot,
  expectScreenshotIgnoringVerticalEdges,
} = require('./visual-assertions');

const dynamicRegions = ['#progressStrip', '[data-visual-dynamic]', '[data-activity-graph]'];

const screenshotOptions = (page) => ({
  animations: 'disabled',
  // The activity graph follows today's date, so only its section heading is compared.
  mask: dynamicRegions.map((selector) => page.locator(selector)),
  maxDiffPixelRatio: 0.005,
});

// Display zoom sits on <html>, and Playwright draws masks in an overlay inside it,
// so at 125% and 150% each mask lands at its box times the scale and misses the
// date and the activity graph (FIX-36). Zoomed shots hide those regions instead.
const zoomedScreenshotOptions = { animations: 'disabled', maxDiffPixelRatio: 0.005 };

async function hideDynamicRegions(page) {
  return page.addStyleTag({ content: `${dynamicRegions.join(', ')} { visibility: hidden !important; }` });
}

// UI-ART-28: settings open beside the opened sidebar, and masks are drawn above
// the panel wherever a dynamic region lies under it, so settings shots hide the
// regions for the shot instead.
async function expectSettingsScreenshot(page, name) {
  const style = await hideDynamicRegions(page);
  await expect(page).toHaveScreenshot(name, zoomedScreenshotOptions);
  await style.evaluate((node) => node.remove());
}

async function useEmptyProgress(page) {
  const state = {
    version: 1,
    vocabulary: {
      known: [],
      fuzzy: [],
      unknown: [],
      favorite: [],
      grammarFavorite: [],
      history: [],
    },
    usage: {},
    updatedAt: '',
  };
  await page.route('**/api/progress', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state) });
  });
}

async function openTextbookDirectory(page) {
  const directory = page.locator('.tb-lesson-directory');
  await revealControl(directory);
  if ((await directory.getAttribute('open')) === null) await directory.locator('summary').click();
  await expect(directory).toHaveAttribute('open', '');
}

async function useAchievementProgress(page) {
  const keyFor = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const twoDaysAgo = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 2);
  const day = { focusedMs: 120000, checkedIn: true, checkins: 1 };
  const state = {
    version: 2,
    vocabulary: {
      known: Array.from({ length: 20 }, (_, index) => index + 1),
      fuzzy: [],
      unknown: [],
      favorite: [],
      grammarFavorite: [],
      history: [
        {
          id: 'ux501-visual-session',
          date: today.toISOString(),
          total: 20,
          known: 18,
          fuzzy: 2,
          unknown: 0,
          skipped: 0,
        },
      ],
      srs: [],
    },
    navigation: {
      version: 1,
      lastModule: 'lesson',
      vocab: {},
      grammar: {},
      textbook: {
        coursePath: {
          version: 1,
          bookId: 'XinBian1',
          lessonId: 'lesson_02',
          lessonLabel: '第二课',
          currentStep: '',
          steps: { vocab: 'done', reading: 'done', grammar: 'done', review: 'done' },
          completed: true,
          startedAt: today.toISOString(),
          completedAt: today.toISOString(),
        },
      },
    },
    usage: {
      [keyFor(today)]: day,
      [keyFor(yesterday)]: day,
      [keyFor(twoDaysAgo)]: day,
    },
    updatedAt: today.toISOString(),
  };
  await page.route('**/api/progress', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state) });
  });
}

test('daily dashboard has desktop and compact baselines', async ({ page }) => {
  await useEmptyProgress(page);
  await openReadyApp(page, { module: 'dashboard' });
  await expect(page.locator('.dashboard-primary')).toBeEnabled();
  await expect(
    page.locator('[data-dashboard-insight="content"] .dashboard-content-progress').nth(1),
  ).toContainText('/');
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('dashboard-home.png', screenshotOptions(page));
  await page.setViewportSize({ width: 1280, height: 720 });
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('dashboard-home-compact.png', screenshotOptions(page));

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.locator('#modBtnLesson').click();
  await expect(page.locator('.tb-lesson-directory')).not.toHaveAttribute('open', '');
  await page.locator('#modBtnDashboard').click();
  await expect(page.locator('.dashboard-primary')).toHaveAttribute('data-dashboard-action', 'resume');
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('dashboard-resume.png', screenshotOptions(page));
  await page.setViewportSize({ width: 1280, height: 720 });
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('dashboard-resume-compact.png', screenshotOptions(page));
});

test('product header settings and grayscale hierarchy have visual baselines', async ({ page }) => {
  await useEmptyProgress(page);
  await openReadyApp(page, { module: 'dashboard' });
  await expect(
    page.locator('[data-dashboard-insight="content"] .dashboard-content-progress').nth(1),
  ).toContainText('/');
  // The cache status in the shot is one line until the worker is ready, then two.
  await expect.poll(() => page.evaluate(() => window.AppPWA.getState().ready)).toBe(true);
  // UI-ART-28: settings open beside the opened sidebar, which the shot keeps.
  await openSettings(page);
  await expectSettingsScreenshot(page, 'product-header-settings.png');

  await page.keyboard.press('Escape');
  await closeSidebar(page);
  const grayscaleStyle = await page.addStyleTag({
    content: 'html { filter: grayscale(1) !important; }',
  });
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('product-header-grayscale.png', screenshotOptions(page));
  await grayscaleStyle.evaluate((node) => node.remove());

  await page.setViewportSize({ width: 1280, height: 720 });
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('product-header-compact.png', screenshotOptions(page));

  await page.locator('#modBtnVocab').click();
  await expect(page.locator('body')).toHaveClass(/status-bar-collapsed/);
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('unified-sidebar-collapsed-compact.png', screenshotOptions(page));
});

test('B05 selected logo remains legible at sidebar size', async ({ page }) => {
  await useEmptyProgress(page);
  await openReadyApp(page, { module: 'dashboard' });
  const brandMark = page.locator('#appBrandHome .app-brand-mark');
  await expect(brandMark).toBeVisible();
  await expect(brandMark).toHaveScreenshot('b05-logo-mark.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.005,
  });
});

test('global search dialog has desktop and compact baselines', async ({ page }) => {
  await useEmptyProgress(page);
  await openReadyApp(page, { module: 'dashboard' });
  await page.keyboard.press('Control+k');
  await page.locator('#globalSearchInput').fill('相容れない');
  await expect(page.locator('[aria-label="词汇结果"] .global-search-result').first()).toBeVisible();
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('global-search.png', screenshotOptions(page));

  await page.setViewportSize({ width: 1280, height: 720 });
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('global-search-compact.png', screenshotOptions(page));
});

test('B06 enlarged scales keep responsive shell and overlays coherent', async ({ page }) => {
  await useEmptyProgress(page);
  await page.setViewportSize({ width: 1600, height: 900 });
  await openReadyApp(page, { module: 'dashboard' });
  await hideDynamicRegions(page);
  await openSettings(page);
  await page.locator('#appScaleSelect').selectOption('1.25');
  await page.keyboard.press('Escape');
  await closeSidebar(page);
  await expect(page.locator('html')).toHaveClass(/layout-max-1400/);
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('b06-scale-125-dashboard.png', zoomedScreenshotOptions);

  await page.setViewportSize({ width: 1280, height: 720 });
  await openSettings(page);
  await page.locator('#appScaleSelect').selectOption('1.5');
  await page.keyboard.press('Escape');
  await closeSidebar(page);
  await page.locator('[data-dashboard-action="open-plan"]').first().click();
  await expect(page.locator('[data-dashboard-plan-form]')).toBeVisible();
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('b06-scale-150-plan.png', zoomedScreenshotOptions);

  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1024, height: 700 });
  await page.locator('#modBtnVocab').click();
  await page.locator('.cc-card-body').first().click();
  await expect(page.locator('#detailPanel')).toHaveAttribute('data-anchor-placement', 'sheet');
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('b06-scale-150-detail-sheet.png', zoomedScreenshotOptions);
});

test('tablet surface keeps drawer and anchored detail baselines', async ({ page }) => {
  await useEmptyProgress(page);
  await openReadyApp(page);
  await page.setViewportSize({ width: 768, height: 700 });
  await expect(page.locator('#tabletSidebarToggle')).toBeVisible();
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('tablet-vocabulary-closed.png', screenshotOptions(page));

  await revealControl(page.locator('#tabletSidebarToggle'));
  await page.locator('#tabletSidebarToggle').click();
  await expect(page.locator('#sidebar')).toHaveClass(/tablet-drawer-open/);
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('tablet-vocabulary-drawer.png', screenshotOptions(page));

  await page.locator('#sidebarCollapseBtn').click();
  await page.locator('.cc-card-body').first().click();
  await expect(page.locator('#detailPanel')).not.toHaveClass(/detail-panel-collapsed/);
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('tablet-vocabulary-detail.png', screenshotOptions(page));
});

test('dark theme keeps dashboard and textbook reading surfaces coherent', async ({ page }) => {
  await useEmptyProgress(page);
  await openReadyApp(page, { module: 'dashboard' });
  await openSettings(page);
  await page.locator('#appThemeSelect').selectOption('dark');
  await page.keyboard.press('Escape');
  await closeSidebar(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('theme-dark-dashboard.png', screenshotOptions(page));

  await page.locator('#modBtnLesson').click();
  await openTextbookDirectory(page);
  await revealControl(page.locator('.tb-lesson-card').nth(1));
  await expect(page.locator('.tb-lesson-card').nth(1)).toBeVisible();
  await revealControl(page.locator('.tb-lesson-card').nth(1));
  await page.locator('.tb-lesson-card').nth(1).click();
  await expect(page.locator('#tbLoading')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#statusTextbookLesson')).toHaveText('第二课');
  const paragraph = page.locator('.tb-paragraph[lang="ja"]').first();
  await expect(paragraph).toBeVisible();
  await paragraph.scrollIntoViewIfNeeded();
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('theme-dark-textbook-reading.png', screenshotOptions(page));
});

test('learning milestones have desktop and compact visual baselines', async ({ page }) => {
  await useAchievementProgress(page);
  await openReadyApp(page, { module: 'dashboard' });
  const achievements = page.locator('[data-dashboard-achievements]');
  await expect(achievements).toBeVisible();
  await achievements.scrollIntoViewIfNeeded();
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('dashboard-achievements.png', screenshotOptions(page));

  await page.setViewportSize({ width: 1280, height: 720 });
  await achievements.scrollIntoViewIfNeeded();
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('dashboard-achievements-compact.png', screenshotOptions(page));
});

test('compact layout density keeps dashboard and reading surfaces calm', async ({ page }) => {
  await useEmptyProgress(page);
  await openReadyApp(page, { module: 'dashboard' });
  // The cache status in the shot grows from one line to two once the worker is
  // ready, and the taller panel moves up to keep its bottom margin (FIX-37, FIX-38).
  await expect.poll(() => page.evaluate(() => window.AppPWA.getState().ready)).toBe(true);
  await openSettings(page);
  await expect(page.locator('#appDensitySelect')).toBeVisible();
  await page.waitForTimeout(240);
  await expectSettingsScreenshot(page, 'layout-density-settings.png');
  await page.locator('#appDensitySelect').selectOption('compact');
  await page.keyboard.press('Escape');
  await closeSidebar(page);
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('layout-density-compact-dashboard.png', screenshotOptions(page));

  await page.setViewportSize({ width: 1280, height: 720 });
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot(
    'layout-density-compact-dashboard-compact.png',
    screenshotOptions(page),
  );

  await page.locator('#modBtnLesson').click();
  await openTextbookDirectory(page);
  const lesson = page.locator('.tb-lesson-card').nth(1);
  await revealControl(lesson);
  await expect(lesson).toBeVisible();
  await revealControl(lesson);
  await lesson.click();
  // The previous lesson remains in the reader while the selected lesson loads.
  await expect(page.locator('#tbLoading')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#statusTextbookLesson')).toHaveText('第二课');
  const paragraph = page.locator('.tb-paragraph[lang="ja"]').first();
  await expect(paragraph).toBeVisible();
  await paragraph.scrollIntoViewIfNeeded();
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('layout-density-compact-textbook.png', screenshotOptions(page));
});

test('installable PWA status is clear in the product settings panel', async ({ page }) => {
  await useEmptyProgress(page);
  await openReadyApp(page, { module: 'dashboard' });
  await expect
    .poll(() => page.evaluate(() => window.AppPWA && window.AppPWA.getState().ready), {
      timeout: 15_000,
    })
    .toBe(true);
  await openSettings(page);
  await expect(page.locator('#appPwaStatusText')).toContainText('可离线使用', { timeout: 15_000 });
  await expectSettingsScreenshot(page, 'pwa-settings.png');
});

test('primary modules retain desktop and compact baselines', async ({ page }) => {
  await useEmptyProgress(page);
  await openReadyApp(page);
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('vocabulary-home.png', screenshotOptions(page));

  await page.locator('#modBtnGrammar').click();
  await expect(page.locator('.gm-card').first()).toBeVisible();
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('grammar-home.png', screenshotOptions(page));

  await page.locator('#modBtnLesson').click();
  await expect(page.locator('.tb-lesson-directory')).not.toHaveAttribute('open', '');
  await revealControl(page.locator('.tb-course-path'));
  await expect(page.locator('.tb-course-path')).toBeVisible();
  await expect(page.locator('.tb-reader-lead-media')).toBeVisible();
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('textbook-home.png', screenshotOptions(page));

  await page.setViewportSize({ width: 1280, height: 720 });
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('textbook-home-compact.png', screenshotOptions(page));
  await page.locator('#modBtnGrammar').click();
  await expect(page.locator('.gm-card').first()).toBeVisible();
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('grammar-home-compact.png', screenshotOptions(page));
  await page.locator('#modBtnVocab').click();
  await expect(page.locator('.cc-card').first()).toBeVisible();
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('vocabulary-home-compact.png', screenshotOptions(page));
  await page.locator('.cc-card-body').first().click();
  await expect(page.locator('#detailPanel .detail-panel-header h2')).toHaveText('词汇详情');
  await expect(page.locator('#detailContent .vocab-detail')).toBeVisible();
  await page.locator('#detailPanelCollapseBtn').click();
  await revealControl(page.locator('#resizeSidebarVocab'));
  await page.locator('#resizeSidebarVocab').focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect(page.locator('#resizeSidebarVocab')).toHaveAttribute('aria-valuenow', '312');
  await expect(page).toHaveScreenshot('panel-layout-empty-compact.png', screenshotOptions(page));
});

test('B16 compact vocabulary list keeps browsing tools in the left sidebar', async ({ page }) => {
  await useEmptyProgress(page);
  await openReadyApp(page);
  await revealControl(page.locator('#viewModeSelect'));
  await page.locator('#viewModeSelect').selectOption('list');
  await expect(page.locator('.list-row').first()).toBeVisible();
  await revealControl(page.locator('#vocabViewTools #listSortSelect'));
  await expect(page.locator('#vocabViewTools #listSortSelect')).toBeVisible();
  await expect(page).toHaveScreenshot('vocabulary-list-tools.png', screenshotOptions(page));

  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page).toHaveScreenshot('vocabulary-list-tools-compact.png', screenshotOptions(page));
});

test('B15 compact secondary controls keep focused visual baselines', async ({ page }) => {
  await useEmptyProgress(page);
  await openReadyApp(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await revealControl(page.locator('.cc-toolbar'));
  await expect(page.locator('.cc-toolbar')).toHaveScreenshot('b15-vocabulary-toolbar-compact.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.005,
  });

  await page.locator('#modBtnLesson').click();
  await revealControl(page.locator('[data-course-path]'));
  await expect(page.locator('[data-course-path]')).toBeVisible();
  await revealControl(page.locator('.tb-course-path-toggle'));
  await page.locator('.tb-course-path-toggle').click();
  await expect(page.locator('.tb-course-path-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('[data-course-path]')).toHaveScreenshot('b15-textbook-course-actions.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.005,
  });
});

test('B14 informational surfaces use lists and dividers instead of nested cards', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-05T04:00:00Z'));
  await useEmptyProgress(page);
  await openReadyApp(page, { module: 'dashboard' });
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(
    page.locator('[data-dashboard-insight="content"] .dashboard-content-progress').nth(1),
  ).toContainText('/');
  await expect(page.locator('.dashboard-insights')).toHaveScreenshot('b14-dashboard-information-groups.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.005,
  });

  await page.locator('#modBtnGrammar').click();
  await revealControl(page.locator('#gmSideNavLesson'));
  await page.locator('#gmSideNavLesson').click();
  await expect(page.locator('.gm-lesson-card').first()).toBeVisible();
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('b14-grammar-lesson-list-compact.png', screenshotOptions(page));

  await page.locator('#modBtnLesson').click();
  await revealControl(page.locator('.tb-lesson-directory'));
  await expect(page.locator('.tb-lesson-directory')).toBeVisible();
  // By id: the classics sidebar (CLASSICS-01) also carries .tb-sidebar.
  await expect(page.locator('#textbookSidebar')).toHaveScreenshot('b14-textbook-directory-compact.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.005,
  });
});

test('B17 global color and spacing rhythm keeps hierarchy without relying on color alone', async ({
  page,
}) => {
  await useEmptyProgress(page);
  await openReadyApp(page, { module: 'dashboard' });
  await page.setViewportSize({ width: 1280, height: 720 });
  const grayscaleStyle = await page.addStyleTag({
    content: 'html { filter: grayscale(1) !important; }',
  });
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('b17-dashboard-rhythm-grayscale.png', screenshotOptions(page));
  await grayscaleStyle.evaluate((node) => node.remove());

  await page.locator('#modBtnGrammar').click();
  await expect(page.locator('.gm-card').first()).toBeVisible();
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('b17-grammar-rhythm-compact.png', screenshotOptions(page));
});

test('B12 B19 textbook keeps continuous reading, inline vocabulary, and floating details', async ({
  page,
}) => {
  await useEmptyProgress(page);
  await openReadyApp(page);
  await page.locator('#modBtnLesson').click();
  await openTextbookDirectory(page);
  await revealControl(page.locator('.tb-lesson-card').nth(1));
  await page.locator('.tb-lesson-card').nth(1).click();
  const readingSection = page.locator('.tb-section').filter({ hasText: '前文' }).first();
  await expect(readingSection).toBeVisible();
  await readingSection.scrollIntoViewIfNeeded();
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('b19-textbook-long-reading.png', screenshotOptions(page));

  await revealControl(page.locator('.tb-display-mode-btn[data-display-mode="chunks"]'));
  await page.locator('.tb-display-mode-btn[data-display-mode="chunks"]').click();
  const firstChunk = page.locator('[data-text-chunk]').first();
  await firstChunk.scrollIntoViewIfNeeded();
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('textbook-chunk-reading.png', screenshotOptions(page));

  await page.setViewportSize({ width: 1280, height: 720 });
  await firstChunk.scrollIntoViewIfNeeded();
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('textbook-chunk-reading-compact.png', screenshotOptions(page));
  await firstChunk.hover();
  await expect(page.locator('#tbChunkDetail')).toBeVisible();
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('textbook-chunk-detail-compact.png', screenshotOptions(page));
  await page.keyboard.press('Escape');

  const vocabularySection = page.locator('.tb-reading-vocab-section');
  await vocabularySection.scrollIntoViewIfNeeded();
  await expect(vocabularySection).toBeVisible();
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('b12-textbook-vocabulary-flow-compact.png', screenshotOptions(page));
  await revealControl(page.locator('.tb-reading-vocab-open').first());
  await page.locator('.tb-reading-vocab-open').first().click();
  await expect(page.locator('.tb-vocab-popup-entry')).toBeVisible();
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('b12-textbook-vocab-popup-compact.png', screenshotOptions(page));
});

test('auxiliary grammar lesson keeps centered reading baselines', async ({ page }) => {
  await useEmptyProgress(page);
  await openReadyApp(page);
  await page.locator('#modBtnGrammar').click();
  await revealControl(page.locator('#gmSideNavLesson'));
  await page.locator('#gmSideNavLesson').click();
  await expect(page.locator('.gm-lesson-card').first()).toBeVisible();
  await revealControl(page.locator('.gm-lesson-card').first());
  await page.locator('.gm-lesson-card').first().click();
  await expect(page.locator('#gmLessonReader .gm-reader-article')).toBeVisible();
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('grammar-lesson-reader.png', screenshotOptions(page));

  await page.setViewportSize({ width: 1280, height: 720 });
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('grammar-lesson-reader-compact.png', screenshotOptions(page));
});

test('vocabulary recognition cards retain compact menu and expanded baselines', async ({ page }) => {
  await useEmptyProgress(page);
  await openReadyApp(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  const firstCard = page.locator('.cc-card').first();
  await firstCard.locator('.cc-card-menu-toggle').click();
  await expect(firstCard.locator('.cc-card-menu')).toBeVisible();
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('vocabulary-card-menu-compact.png', screenshotOptions(page));

  await page.keyboard.press('Escape');
  await firstCard.locator('.cc-meta-count').click();
  await expect(firstCard.locator('.cc-card-extra')).toBeVisible();
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('vocabulary-card-expanded-compact.png', screenshotOptions(page));
});

test('vocabulary detail keeps compact grouped information baselines', async ({ page }) => {
  await useEmptyProgress(page);
  await openReadyApp(page);
  await page.locator('.cc-card').first().locator('.cc-card-body').click();
  await expect(page.locator('#detailContent .vocab-detail')).toBeVisible();
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('vocabulary-detail.png', screenshotOptions(page));

  await page.setViewportSize({ width: 1280, height: 720 });
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('vocabulary-detail-compact.png', screenshotOptions(page));
});

test('key interaction states have visual baselines', async ({ page }) => {
  // This tour captures 12 states across three modules and two viewport sizes.
  test.setTimeout(120_000);
  await useEmptyProgress(page);
  await openReadyApp(page);

  await page.setViewportSize({ width: 1280, height: 720 });
  await revealControl(page.locator('#searchInput'));
  await page.locator('#searchInput').fill('__visual_no_match__');
  await revealControl(page.locator('#searchInput'));
  await page.locator('#searchInput').press('Enter');
  await expect(page.locator('.cc-empty')).toBeVisible();
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('vocabulary-empty-compact.png', screenshotOptions(page));

  await page.setViewportSize({ width: 1600, height: 900 });
  await revealControl(page.locator('#resetFiltersBtn'));
  await page.locator('#resetFiltersBtn').click();
  await revealControl(page.locator('#viewModeSelect'));
  await page.locator('#viewModeSelect').selectOption('study');
  await expect(page.locator('.study-setup')).toBeVisible();
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('study-setup.png', screenshotOptions(page));

  await revealControl(page.locator('#viewModeSelect'));
  await page.locator('#viewModeSelect').selectOption('list');
  const checks = page.locator('.row-check');
  await revealControl(checks);
  for (let index = 0; index < 6; index += 1) await checks.nth(index).check();
  await revealControl(page.locator('#btnBatchStudy'));
  await page.locator('#btnBatchStudy').click();
  await expect(page.locator('.study-card-view')).toBeVisible();
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('study-card-front.png', screenshotOptions(page));
  await page.locator('#flashcard').click();
  await expect(page.locator('#flashcard')).toHaveClass(/flipped/);
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('study-card-back.png', screenshotOptions(page));
  await page.locator('[data-fb="known"]').click();
  for (const feedback of ['unknown', 'fuzzy', 'unknown', 'fuzzy', 'unknown']) {
    await page.locator('#flashcard').click();
    await page.locator(`[data-fb="${feedback}"]`).click();
  }
  await expect(page.locator('.study-complete')).toBeVisible();
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('study-complete-actions.png', screenshotOptions(page));
  const grayscaleStyle = await page.addStyleTag({
    content: 'html { filter: grayscale(1) !important; }',
  });
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('study-complete-actions-grayscale.png', screenshotOptions(page));
  await grayscaleStyle.evaluate((node) => node.remove());
  await page.setViewportSize({ width: 1280, height: 720 });
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('study-result-dense-compact.png', screenshotOptions(page));

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.locator('#modBtnGrammar').click();
  await page.locator('.gm-card').first().click();
  await expect(page.locator('#grammarDetailPanel')).not.toHaveClass(/detail-panel-collapsed/);
  await expect(page.locator('#gmDetailContent')).not.toBeEmpty();
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('grammar-detail.png', screenshotOptions(page));
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.locator('#gm-section-examples .gm-ex-card').first()).toBeVisible();
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('grammar-detail-compact.png', screenshotOptions(page));

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.locator('#modBtnLesson').click();
  await openTextbookDirectory(page);
  await revealControl(page.locator('.tb-lesson-card').first());
  await page.locator('.tb-lesson-card').first().click();
  await revealControl(page.locator('.tb-display-mode-btn[data-display-mode="plain"]'));
  await page.locator('.tb-display-mode-btn[data-display-mode="plain"]').click();
  await expect(page.locator('.tb-display-mode-btn[data-display-mode="plain"]')).toHaveClass(/active/);
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('textbook-plain-reading.png', screenshotOptions(page));

  await page.setViewportSize({ width: 1280, height: 720 });
  await openTextbookDirectory(page);
  await revealControl(page.locator('.tb-lesson-card').nth(1));
  await page.locator('.tb-lesson-card').nth(1).click();
  await revealControl(page.locator('.tb-display-mode-btn[data-display-mode="normal"]'));
  await page.locator('.tb-display-mode-btn[data-display-mode="normal"]').click();
  await expect(page.locator('.tb-reader-body .tb-section').first()).toBeVisible();
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('textbook-reading-compact.png', screenshotOptions(page));
  await page.evaluate(() => {
    const module = window.ModuleSwitcher.getTextbookModule();
    module.ttsState.mode = 'reading:body';
    module.ttsState.loading = false;
    module.ttsState.segments = ['第一段', '第二段', '第三段'];
    module.ttsState.segmentIndex = 0;
    module.ttsState.statusText = '前文 · 第 1 / 3 段 · 0:04 / 0:14';
    module.ttsState.audio = {
      paused: false,
      currentTime: 4,
      duration: 14,
      pause() {
        this.paused = true;
      },
    };
    module._syncTtsButtonState();
  });
  const readingProgress = page.locator('.tb-tts-progress[data-tts-progress="reading:body"]');
  await expect(readingProgress).toHaveAttribute('aria-valuenow', '29');
  await readingProgress.scrollIntoViewIfNeeded();
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('textbook-audio-progress-compact.png', screenshotOptions(page));
  await page.evaluate(() => window.ModuleSwitcher.getTextbookModule()._stopTtsPlayback());
});

test('mixed practice has question, feedback, input, and result baselines', async ({ page }) => {
  await useEmptyProgress(page);
  // Whether word audio plays decides if the third question stays a listening one
  // or falls back to ja-zh; pin the fallback so the result baseline does not
  // depend on local audio files or the machine's audio output.
  await page.route('**/data/gcloud_chirp3_vocab12528_female_aoede_v1/**', (route) =>
    route.fulfill({ status: 404, body: '' }),
  );
  await openReadyApp(page);
  await page.evaluate(() => {
    window.appConfig.startStudySession(window.taxonomyManager.allWords.slice(0, 5), {
      practiceMode: 'mixed',
    });
  });

  await expect(page.locator('.practice-card[data-exercise-type="ja-zh"]')).toBeVisible();
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('practice-choice.png', screenshotOptions(page));
  const wrongOption = await page.evaluate(() =>
    window.appConfig.studyMode.currentExercise.options.findIndex((option) => !option.correct),
  );
  await page.locator('.practice-option').nth(wrongOption).click();
  await expect(page.locator('.practice-feedback.is-wrong')).toBeVisible();
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('practice-choice-feedback.png', screenshotOptions(page));
  await page.keyboard.press('Enter');

  for (let position = 1; position < 3; position += 1) {
    const correctOption = await page.evaluate(() =>
      window.appConfig.studyMode.currentExercise.options.findIndex((option) => option.correct),
    );
    await page.locator('.practice-option').nth(correctOption).click();
    await page.keyboard.press('Enter');
  }

  await expect(page.locator('.practice-card[data-exercise-type="input"]')).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('practice-input-compact.png', screenshotOptions(page));
  const inputAnswer = await page.evaluate(() => window.appConfig.studyMode.currentExercise.reading);
  await page.locator('#practiceAnswerInput').fill(inputAnswer);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');

  const clozeAnswer = await page.evaluate(() => window.appConfig.studyMode.currentExercise.answer);
  await page.locator('#practiceAnswerInput').fill(clozeAnswer);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(page.locator('.study-result-exercises')).toBeVisible();
  await page.setViewportSize({ width: 1600, height: 900 });
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('practice-result.png', screenshotOptions(page));
});

test('result review exposes its source and parent-result return', async ({ page }) => {
  await useEmptyProgress(page);
  await openReadyApp(page);
  await page.evaluate(() => {
    window.appConfig.startStudySession(window.taxonomyManager.allWords.slice(0, 2), {
      practiceMode: 'classic',
    });
  });
  for (const feedback of ['fuzzy', 'unknown']) {
    await page.locator('#flashcard').click();
    await page.locator(`[data-fb="${feedback}"]`).click();
  }
  await page.locator('#btnReviewErrors').click();
  await expect(page.locator('.study-source-banner')).toContainText('错项复习 · 第 1 轮');
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('result-review-session.png', screenshotOptions(page));

  await page.locator('#flashcard').click();
  await page.locator('[data-fb="known"]').click();
  await page.locator('#flashcard').click();
  await page.locator('[data-fb="unknown"]').click();
  await expect(page.locator('#btnBackToPreviousResult')).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('result-review-complete-compact.png', screenshotOptions(page));
});

test('lesson section outline has wide and compact baselines', async ({ page }) => {
  // This suite covers the legacy scrolling outline; keep that choice explicit
  // when its dedicated visual check runs on a separate temporary server port.
  await page.addInitScript(() => localStorage.setItem('jp_learning_reading_layout_v1', 'scroll'));
  await useEmptyProgress(page);
  await openReadyApp(page, { module: 'lesson' });
  const outline = page.locator('.tb-outline');
  await expect(outline).toBeVisible();
  await expect(outline).toHaveScreenshot('lesson-outline-wide.png', {
    animations: 'disabled',
    maxDiffPixels: 0,
  });
  await page.setViewportSize({ width: 1100, height: 720 });
  await outline.locator('summary').click();
  await expect(outline.locator('nav')).toBeVisible();
  // The open menu is positioned outside the summary's details box. Capture
  // its own bounds so the baseline includes every visible section label.
  await expect(outline.locator('nav')).toHaveScreenshot('lesson-outline-compact.png', {
    animations: 'disabled',
    maxDiffPixels: 0,
  });
  await page.setViewportSize({ width: 820, height: 900 });
  await expect(outline.locator('nav')).toBeVisible();
  await expect(outline.locator('nav')).toHaveScreenshot('lesson-outline-tablet.png', {
    animations: 'disabled',
    maxDiffPixels: 0,
  });
});

test('grammar expanded reading has desktop compact and narrow baselines', async ({ page }) => {
  await useEmptyProgress(page);
  await openReadyApp(page, { module: 'grammar' });
  await page.locator('.gm-card').first().click();
  await expect(page.locator('.gm-detail-outline')).toBeVisible();
  await page.locator('[data-detail-reading-toggle]').click();
  for (const viewport of [
    { width: 1600, height: 900 },
    { width: 1280, height: 720 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.locator('html')).toHaveAttribute(
      'data-layout-viewport',
      viewport.width < 768 ? 'phone' : 'desktop',
    );
    await revealControl(page.locator('.app-container'));
    await expect(page).toHaveScreenshot(`grammar-reading-${viewport.width}.png`, screenshotOptions(page));
  }
});

test('C02 recognition metadata keeps readable light and dark baselines', async ({ page }) => {
  await useEmptyProgress(page);
  await openReadyApp(page);
  await expect(page.locator('.cc-card').first()).toHaveScreenshot('c02-vocabulary-metadata.png', {
    animations: 'disabled',
    maxDiffPixels: 0,
  });
  await page.locator('#modBtnGrammar').click();
  await expect(page.locator('.gm-card').first()).toBeVisible();
  await expect(page.locator('.gm-card').first()).toHaveScreenshot('c02-grammar-metadata.png', {
    animations: 'disabled',
    maxDiffPixels: 0,
  });
  await openSettings(page);
  await page.locator('#appThemeSelect').selectOption('dark');
  await page.keyboard.press('Escape');
  await closeSidebar(page);
  await expect(page.locator('.gm-card').first()).toHaveScreenshot('c02-grammar-metadata-dark.png', {
    animations: 'disabled',
    maxDiffPixels: 0,
  });
});

test('C03 edge exclusion still rejects interior changes and different screenshot sizes', async () => {
  const baseline = new PNG({ width: 40, height: 30 });
  baseline.data.fill(255);
  const expected = PNG.sync.write(baseline);
  const edgeOnly = PNG.sync.read(expected);
  for (let y = 0; y < edgeOnly.height; y++) {
    for (let x = 0; x < edgeOnly.width; x++) {
      if (x < 4 || x >= edgeOnly.width - 4)
        edgeOnly.data.fill(0, (y * edgeOnly.width + x) * 4, (y * edgeOnly.width + x) * 4 + 3);
    }
  }
  expect(await compareVerticalEdgeScreenshot(PNG.sync.write(edgeOnly), expected)).toEqual({
    dimensionsMatch: true,
    differingPixels: 0,
  });
  const interior = PNG.sync.read(expected);
  for (let y = 10; y < 15; y++) {
    for (let x = 15; x < 20; x++)
      interior.data.fill(0, (y * interior.width + x) * 4, (y * interior.width + x) * 4 + 3);
  }
  expect(
    (await compareVerticalEdgeScreenshot(PNG.sync.write(interior), expected)).differingPixels,
  ).toBeGreaterThan(0);
  const resized = PNG.sync.write(new PNG({ width: 41, height: 30 }));
  expect((await compareVerticalEdgeScreenshot(resized, expected)).dimensionsMatch).toBe(false);
});

test('C03 current next and recovered course steps keep compact visual baselines', async ({
  page,
}, testInfo) => {
  await useEmptyProgress(page);
  await openReadyApp(page, { module: 'lesson' });
  await revealControl(page.locator('.tb-course-path-toggle'));
  await page.locator('.tb-course-path-toggle').click();
  const course = page.locator('[data-course-path]');
  await expect(course.locator('.tb-course-step:visible')).toHaveCount(2);
  await expect(course).toHaveScreenshot('c03-course-current-next-1600.png', {
    animations: 'disabled',
    maxDiffPixels: 0,
  });
  await page.screenshot({ path: 'local/qa/c03-page-1600.png', animations: 'disabled' });
  await revealControl(course.locator('[data-course-action="skip"][data-course-step="vocab"]'));
  await course.locator('[data-course-action="skip"][data-course-step="vocab"]').click();
  await course.locator('[data-course-action="step"][data-course-step="reading"]').click();
  await page.setViewportSize({ width: 1280, height: 720 });
  await revealControl(course);
  await expect(course).toHaveScreenshot('c03-course-active-1280.png', {
    animations: 'disabled',
    maxDiffPixels: 0,
  });
  await page.screenshot({ path: 'local/qa/c03-page-1280.png', animations: 'disabled' });
  await openSettings(page);
  await page.locator('#appThemeSelect').selectOption('dark');
  await page.keyboard.press('Escape');
  await closeSidebar(page);
  await page.setViewportSize({ width: 820, height: 900 });
  await expect(page.locator('html')).toHaveAttribute('data-layout-viewport', 'tablet');
  await revealControl(page.locator('#tabletSidebarToggle'));
  await page.locator('#tabletSidebarToggle').click();
  await revealControl(course.locator('.tb-course-other-toggle'));
  await course.locator('.tb-course-other-toggle').click();
  await expect(course.locator('.tb-course-step:visible')).toHaveCount(4);
  // The archived CI diff is confined to the vertical crop edges. Preserve the
  // existing baseline and require zero interior differences on every platform.
  await expectScreenshotIgnoringVerticalEdges(course, 'c03-course-other-tablet-dark.png', testInfo);
});

test('C06 reading focus keeps desktop compact and narrow visual baselines', async ({ page }) => {
  await useEmptyProgress(page);
  await openReadyApp(page, { module: 'lesson' });
  await expect(page.locator('.tb-reader-body')).toBeVisible();
  await openSettings(page);
  await expect(page.locator('#readingFocusEnter')).toHaveScreenshot('c06-focus-entry.png', {
    animations: 'disabled',
    maxDiffPixels: 0,
  });
  await page.locator('#readingFocusEnter').click();
  await expect(page.locator('#unifiedSidebar')).toBeHidden();
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('c06-focus-lesson-1600.png', screenshotOptions(page));
  await page.locator('#readingFocusExit').click();
  await page.locator('#modBtnVocab').click();
  await page.setViewportSize({ width: 1280, height: 720 });
  await openSettings(page);
  await page.locator('#readingFocusEnter').click();
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('c06-focus-vocabulary-1280.png', screenshotOptions(page));
  await page.locator('#readingFocusExit').click();
  await page.locator('#modBtnGrammar').click();
  await openSettings(page);
  await page.locator('#appThemeSelect').selectOption('dark');
  await page.locator('#readingFocusEnter').click();
  await page.locator('.gm-card').first().click();
  await expect(page.locator('.gm-detail-outline')).toBeVisible();
  await page.locator('[data-detail-reading-toggle]').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('html')).toHaveAttribute('data-layout-viewport', 'phone');
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('c06-focus-grammar-dark-390.png', screenshotOptions(page));
});

test('W-02 ordinary dark grammar detail fits the narrow reading area', async ({ page }) => {
  await useEmptyProgress(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await openReadyApp(page, { module: 'grammar' });
  await openSettings(page);
  await page.locator('#appThemeSelect').selectOption('dark');
  await page.keyboard.press('Escape');
  await closeSidebar(page);
  await page.locator('.gm-card').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#grammarDetailCollapseBtn')).toBeFocused();
  await expect(page.locator('.gm-detail-outline')).toBeVisible();
  await revealControl(page.locator('.app-container'));
  await expect(page).toHaveScreenshot('w02-grammar-detail-dark-390.png', screenshotOptions(page));
});
