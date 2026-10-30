const { revealControl } = require('./helpers');
const { test, expect } = require('@playwright/test');
const { openReadyApp } = require('./helpers');

async function useIsolatedProgress(page) {
  let stored = {
    version: 2,
    vocabulary: {
      known: [],
      fuzzy: [],
      unknown: [],
      favorite: [],
      grammarFavorite: [],
      history: [],
      srsVersion: 1,
      srs: [],
    },
    navigation: { version: 1, lastModule: '', vocab: {}, grammar: {}, textbook: {} },
    usage: {},
    updatedAt: '',
  };
  await page.route('**/api/progress', async (route) => {
    if (route.request().method() === 'POST') stored = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stored) });
  });
}

async function startSelectedSession(page, count) {
  await revealControl(page.locator('#viewModeSelect'));
  await page.locator('#viewModeSelect').selectOption('list');
  const checks = page.locator('.row-check');
  await revealControl(checks);
  for (let index = 0; index < count; index += 1) await checks.nth(index).check();
  await revealControl(page.locator('#btnBatchStudy'));
  await page.locator('#btnBatchStudy').click();
  await expect(page.locator('.study-card-view')).toBeVisible();
}

async function submitFeedback(page, feedback) {
  await page.locator('#flashcard').click();
  await page.locator(`[data-fb="${feedback}"]`).click();
  await page.waitForTimeout(10);
}

test('an empty queue never creates a result or history entry', async ({ page }) => {
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page);
  const result = await page.evaluate(() => {
    const before = window.StudyStorage.getHistory().length;
    const started = window.appConfig.startStudySession([], { limit: 0 });
    return { before, after: window.StudyStorage.getHistory().length, started };
  });

  expect(result).toMatchObject({ started: false });
  expect(result.after).toBe(result.before);
  await expect(page.locator('.study-complete')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test('a one-word result records duration and remains idempotent under repeated feedback', async ({
  page,
}) => {
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page);
  await page.evaluate(() => window.StudyStorage.clearAll());
  const historyBefore = await page.evaluate(() => window.StudyStorage.getHistory().length);
  await startSelectedSession(page, 1);
  await page.evaluate(() => {
    window.appConfig.studyMode.sessionStartedAt = Date.now() - 65_000;
  });

  await page.locator('#flashcard').click();
  await page.keyboard.press('Digit1');
  await page.keyboard.press('Digit1');
  await expect(page.locator('.study-complete')).toBeVisible();
  await page.evaluate(() => {
    window.appConfig.studyMode.render();
    window.appConfig.studyMode.render();
  });

  await expect(page.locator('.study-result-header h2')).toHaveText('完成 1 词');
  await expect(page.locator('.study-result-duration')).toHaveText('1分 05秒');
  await expect(page.locator('.study-result-overview')).toContainText('新增掌握1词');
  await expect(page.locator('.study-result-overview')).toContainText('待复习0词');
  await expect(page.locator('.study-result-weak-empty')).toBeVisible();
  const historyAfter = await page.evaluate(() => window.StudyStorage.getHistory().length);
  expect(historyAfter).toBe(historyBefore + 1);
  expect(pageErrors).toEqual([]);
});

test('a mixed result shows distribution and orders weak words by severity', async ({ page }) => {
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page);
  await page.evaluate(() => window.StudyStorage.clearAll());
  await startSelectedSession(page, 4);

  for (const feedback of ['known', 'fuzzy', 'unknown', 'skip']) await submitFeedback(page, feedback);

  await expect(page.locator('.study-complete')).toBeVisible();
  await expect(page.locator('.study-result-distribution')).toHaveAttribute(
    'aria-label',
    '认识 1，模糊 1，不会 1，跳过 1',
  );
  await expect(page.locator('.study-result-legend')).toContainText('认识1');
  await expect(page.locator('.study-result-legend')).toContainText('跳过1');
  await expect(page.locator('.study-result-overview')).toContainText('新增掌握1词');
  await expect(page.locator('.study-result-overview')).toContainText('待复习2词');
  const weakItems = page.locator('.study-result-weak-item');
  await expect(weakItems).toHaveCount(2);
  await expect(weakItems.nth(0).locator('small')).toHaveText('不会');
  await expect(weakItems.nth(1).locator('small')).toHaveText('模糊');
  expect(pageErrors).toEqual([]);
});

test('extended result history survives a progress reload without duplication', async ({ page }) => {
  let stored = {
    version: 2,
    vocabulary: {
      known: [],
      fuzzy: [],
      unknown: [],
      favorite: [],
      grammarFavorite: [],
      history: [],
      srsVersion: 1,
      srs: [],
    },
    navigation: { version: 1, lastModule: '', vocab: {}, grammar: {}, textbook: {} },
    usage: {},
    updatedAt: '',
  };
  await page.route('**/api/progress', async (route) => {
    if (route.request().method() === 'POST') stored = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stored) });
  });

  const pageErrors = await openReadyApp(page);
  await startSelectedSession(page, 1);
  await submitFeedback(page, 'unknown');
  await expect(page.locator('.study-complete')).toBeVisible();
  await expect.poll(() => stored.vocabulary.history.length).toBe(1);
  expect(stored.vocabulary.history[0]).toMatchObject({
    total: 1,
    pendingReview: 1,
    newlyMastered: 0,
  });
  expect(stored.vocabulary.history[0].weakWords).toHaveLength(1);

  // Reopen the dashboard URL; module URLs now restore their module directly.
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 45_000 });
  await expect(page.locator('.dashboard-recent-item').first()).toContainText('完成 1 词');
  const restored = await page.evaluate(() => window.StudyStorage.getHistory());
  expect(restored).toHaveLength(1);
  expect(restored[0].weakWords).toHaveLength(1);
  expect(pageErrors).toEqual([]);
});
