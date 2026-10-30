const { revealControl } = require('./helpers');
const { test, expect } = require('@playwright/test');
const { openReadyApp, expectRegionsWithinViewport } = require('./helpers');
test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => {
  await page.route('**/js/storage-config.js*', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: "window.JPLearnStorageConfig={mode:'browser'};",
    }),
  );
});
const queue = (page) => page.evaluate(() => window.appConfig.studyMode.exportCheckpoint().queueIndices);

test('N5 new words ignore an empty browsing search and contain no advanced words', async ({ page }) => {
  await openReadyApp(page);
  await revealControl(page.locator('#searchInput'));
  await page.locator('#searchInput').fill('no-such-word-xyz');
  await expect.poll(() => page.evaluate(() => window.appConfig.getCurrentWords().length)).toBe(0);
  await page.locator('#modBtnDashboard').click();
  await revealControl(page.locator('#dashboardMain'));
  await expect(page.locator('[data-dashboard-action="start-new"] .dashboard-task-copy')).toContainText(
    '新词范围：N5',
  );
  await page.locator('.dashboard-task-card[data-dashboard-action="start-new"]').click();
  expect(await queue(page)).toHaveLength(20);
  const levels = await page.evaluate(() => {
    const ids = window.appConfig.studyMode.exportCheckpoint().queueIndices;
    return ids.map((id) => window.taxonomyManager.allWords.find((w) => w.index === id).level);
  });
  expect(new Set(levels)).toEqual(new Set(['N5']));
});

test('N3 includes N5 and N4 foundations while excluding N2 and N1', async ({ page }) => {
  await openReadyApp(page, { module: 'dashboard' });
  await page.evaluate(() => {
    const original = window.TextbookLoader.getBooks;
    window.TextbookLoader.getBooks = async function () {
      await new Promise((resolve) => {
        window.releasePlanCatalog = resolve;
      });
      return original.call(this);
    };
  });
  await page.locator('[data-dashboard-action="open-plan"]').click();
  await page.locator('#dashboardPlanJlpt').selectOption('N3');
  await page.locator('#dashboardPlanMinutes').fill('35');
  await page.evaluate(() => window.releasePlanCatalog());
  await expect(page.locator('[data-dashboard-plan-form] button[type="submit"]')).toBeEnabled();
  await expect(page.locator('#dashboardPlanJlpt')).toHaveValue('N3');
  await expect(page.locator('#dashboardPlanMinutes')).toHaveValue('35');
  await page.locator('[data-dashboard-plan-form] button[type="submit"]').click();
  const wanted = await page.evaluate(() => {
    const list = ['N5', 'N4', 'N3', 'N2', 'N1'].map((level) =>
      window.taxonomyManager.allWords.find((w) => w.level === level),
    );
    window.taxonomyManager.allWords = list;
    window.Dashboard.render();
    return list
      .slice(0, 3)
      .map((w) => w.index)
      .sort((a, b) => a - b);
  });
  await expect(page.locator('.dashboard-start-card')).toContainText('N5–N3（含基础词）');
  await page.locator('.dashboard-primary').click();
  expect((await queue(page)).sort((a, b) => a - b)).toEqual(wanted);
});

test('global overdue review wins over browsing resume and preserves due order', async ({ page }) => {
  await openReadyApp(page);
  const expected = await page.evaluate(() => {
    const words = window.taxonomyManager.allWords.slice(0, 3);
    const ids = words.map((w) => w.index).reverse();
    window.StudyStorage.importSnapshot({
      unknown: ids,
      srs: ids.map((id, i) =>
        window.JPLearn.srs.schedule(null, id, 'unknown', new Date(Date.UTC(2020, 0, i + 1))),
      ),
    });
    return ids;
  });
  await revealControl(page.locator('#searchInput'));
  await page.locator('#searchInput').fill('no-such-word-xyz');
  await expect.poll(() => page.evaluate(() => window.appConfig.getCurrentWords().length)).toBe(0);
  await page.locator('#modBtnDashboard').click();
  await revealControl(page.locator('#dashboardMain'));
  await expect(page.locator('.dashboard-primary')).toHaveAttribute('data-dashboard-action', 'start-review');
  await expect(page.locator('.dashboard-start-card')).toContainText('全词库有 3 个到期词');
  await page.locator('.dashboard-primary').click();
  expect(await queue(page)).toEqual(expected);
});

test('unfinished question precedes due review without changing its saved queue', async ({ page }) => {
  await openReadyApp(page);
  await page.evaluate(() => {
    const words = window.taxonomyManager.allWords.slice(0, 2);
    window.appConfig.startStudySession(words, { shuffle: false, practiceMode: 'classic' });
    window.StudyStorage.markWord(words[0].index, 'unknown');
  });
  const saved = await queue(page);
  await page.locator('#modBtnDashboard').click();
  await expect(page.locator('.dashboard-primary')).toHaveAttribute('data-dashboard-action', 'resume');
  await expect(page.locator('.dashboard-start-card')).toContainText('进度 1 / 2');
  await page.locator('.dashboard-primary').click();
  expect(await queue(page)).toEqual(saved);
});

test('learning scope remains readable in both desktop viewports', async ({ page }) => {
  await openReadyApp(page, { module: 'dashboard' });
  for (const viewport of [
    { width: 1600, height: 900 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    await expectRegionsWithinViewport(page, ['.dashboard-start-card', '.dashboard-task-grid']);
    await page.screenshot({ path: `local/qa/learning-plan-${viewport.width}.png` });
  }
});

test('active planned course precedes casual browsing but follows overdue review', async ({ page }) => {
  await openReadyApp(page, { module: 'dashboard' });
  await page.evaluate(() => {
    const plan = window.ProgressStore.getPlan();
    window.ProgressStore.updateNavigation({
      version: 1,
      lastModule: 'vocab',
      vocab: { view: 'cards' },
      grammar: {},
      textbook: {
        bookId: plan.bookId,
        lessonId: plan.lessonId,
        coursePath: {
          version: 1,
          bookId: plan.bookId,
          lessonId: plan.lessonId,
          currentStep: 'reading',
          completed: false,
        },
      },
    });
  });
  await expect(page.locator('.dashboard-start-card')).toContainText('下一步：阅读课文');
  await page.evaluate(() =>
    window.StudyStorage.markWord(window.taxonomyManager.allWords[0].index, 'unknown'),
  );
  await expect(page.locator('.dashboard-primary')).toHaveAttribute('data-dashboard-action', 'start-review');
});

test('today keeps learning and plan controls in the first screen across viewport sizes', async ({ page }) => {
  await openReadyApp(page, { module: 'dashboard' });
  for (const viewport of [
    { width: 1600, height: 900 },
    { width: 1280, height: 720 },
    { width: 820, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.locator('.dashboard-heading').scrollIntoViewIfNeeded();
    await expectRegionsWithinViewport(page, [
      '.dashboard-heading',
      '.dashboard-primary',
      '.dashboard-plan-action',
    ]);
    if (viewport.width >= 1280) {
      await expectRegionsWithinViewport(page, ['.dashboard-tasks', '.dashboard-progress-card']);
      const tasks = await page.locator('.dashboard-tasks').boundingBox();
      expect(tasks.y + tasks.height).toBeLessThan(520);
    }
    await page.locator('.dashboard-plan-action').click();
    await expect(page.locator('[data-dashboard-plan-form]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.dashboard-plan-action')).toBeFocused();
  }
  await expect(page.locator('[data-dashboard-download]')).toHaveCount(1);
  await page.locator('.dashboard-primary').click();
  await expect(page.locator('.study-card-view')).toBeVisible();
});

test('FIX-22 today minutes refresh while the dashboard stays open without moving focus', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-06T12:00:00+08:00') });
  const errors = await openReadyApp(page, { module: 'dashboard' });
  const goal = page.locator('.dashboard-progress-main strong');
  const planButton = page.locator('.dashboard-heading [data-dashboard-action="open-plan"]');
  await expect(goal).toHaveText('0');
  await planButton.focus();
  // Same clock pattern as FIX-27: a few one-second ticks, then jump the rest.
  await page.clock.runFor(5_000);
  await page.clock.fastForward(120_000);
  await page.clock.runFor(1_000);
  await expect(goal).toHaveText('2');
  await expect(page.locator('[data-dashboard-goal-progress]')).toHaveAttribute('aria-valuenow', '20');
  await expect(page.locator('.dashboard-progress-note')).toHaveText('还差 8 分钟完成今日目标');
  await expect(page.locator('[data-dashboard-stat="week"] strong')).toHaveText('1 天 · 2 分钟');
  await expect(page.locator('[data-activity-graph] .cg-summary-line')).toContainText('专注 2 分钟');
  await expect(planButton).toBeFocused();

  // Later minutes update in place: the open month table and focus stay as they are.
  const months = page.locator('[data-activity-graph] .cg-months-table');
  await months.locator('summary').click();
  await planButton.focus();
  await page.clock.fastForward(60_000);
  await page.clock.runFor(1_000);
  await expect(goal).toHaveText('3');
  await expect(page.locator('[data-dashboard-stat="week"] strong')).toHaveText('1 天 · 3 分钟');
  await expect(months).toHaveAttribute('open');
  await expect(planButton).toBeFocused();

  // An open plan editor is not redrawn under the learner; closing it shows the new minutes.
  await page.keyboard.press('Enter');
  const words = page.locator('#dashboardPlanWords');
  await words.fill('30');
  await page.clock.fastForward(60_000);
  await page.clock.runFor(1_000);
  await expect(words).toBeFocused();
  await expect(words).toHaveValue('30');
  await page.keyboard.press('Escape');
  await expect(goal).toHaveText('4');
  await expect(planButton).toBeFocused();
  expect(errors).toEqual([]);
});
