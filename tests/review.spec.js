const { test, expect } = require('@playwright/test');
const { openReadyApp, expectOnlyModuleVisible } = require('./helpers');

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
  return () => stored;
}

async function startClassicSession(page, start, count) {
  await page.evaluate(
    ({ offset, size }) => {
      window.appConfig.startStudySession(window.taxonomyManager.allWords.slice(offset, offset + size), {
        practiceMode: 'classic',
      });
    },
    { offset: start, size: count },
  );
  await expect(page.locator('#flashcard')).toBeVisible();
}

async function submitClassicFeedback(page, feedback) {
  await page.locator('#flashcard').click();
  await page.locator(`[data-fb="${feedback}"]`).click();
  await page.waitForTimeout(10);
}

test('result review uses only this session errors and supports repeated review with parent returns', async ({
  page,
}) => {
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page);
  await page.evaluate(() => {
    window.StudyStorage.clearAll();
    window.StudyStorage.markWord(window.taxonomyManager.allWords[10].index, 'unknown');
  });
  const globalOldError = await page.evaluate(() => window.taxonomyManager.allWords[10].index);
  await startClassicSession(page, 0, 3);
  for (const feedback of ['known', 'fuzzy', 'unknown']) await submitClassicFeedback(page, feedback);

  await expect(page.locator('#btnReviewErrors')).toContainText('复习本次错项 2');
  const originalSessionId = await page.evaluate(() => window.appConfig.studyMode.sessionId);
  await page.locator('#btnReviewErrors').click();
  await expect(page.locator('.study-source-banner')).toContainText('错项复习 · 第 1 轮');
  await expect(page.locator('.study-source-banner')).toContainText('来自上次结果 3 词 · 本轮 2 词');
  const firstReview = await page.evaluate(() => ({
    indices: window.appConfig.studyMode.queue.map((word) => word.index),
    source: window.appConfig.studyMode.sessionSource,
    trail: window.appConfig.studyMode.resultTrail.length,
  }));
  expect(firstReview.indices).toHaveLength(2);
  expect(firstReview.indices).not.toContain(globalOldError);
  expect(firstReview.source).toMatchObject({
    kind: 'result-review',
    parentSessionId: originalSessionId,
    rootSessionId: originalSessionId,
    depth: 1,
    reviewCount: 2,
  });
  expect(firstReview.trail).toBe(1);

  await submitClassicFeedback(page, 'known');
  await submitClassicFeedback(page, 'unknown');
  await expect(page.locator('#btnReviewErrors')).toContainText('复习本次错项 1');
  const firstReviewSessionId = await page.evaluate(() => window.appConfig.studyMode.sessionId);
  await page.locator('#btnReviewErrors').click();
  await expect(page.locator('.study-source-banner')).toContainText('错项复习 · 第 2 轮');
  await expect(page.locator('#statusStudyQueue')).toHaveText('1');
  const secondSource = await page.evaluate(() => window.appConfig.studyMode.sessionSource);
  expect(secondSource).toMatchObject({
    parentSessionId: firstReviewSessionId,
    rootSessionId: originalSessionId,
    depth: 2,
    reviewCount: 1,
  });

  await submitClassicFeedback(page, 'known');
  await expect(page.locator('#btnReviewErrors')).toBeDisabled();
  await expect(page.locator('#btnBackToPreviousResult')).toBeVisible();
  await expect(page.locator('#btnBackToPreviousResult')).toHaveText(/返回上次结果/);
  await page.locator('#btnBackToPreviousResult').click();
  await expect(page.locator('.study-result-kicker')).toHaveText('错项复习 · 第 1 轮');
  await expect(page.locator('#btnReviewErrors')).toContainText('复习本次错项 1');
  await page.locator('#btnBackToPreviousResult').click();
  await expect(page.locator('.study-result-kicker')).toHaveText('本次学习结果');
  await expect(page.locator('#btnReviewErrors')).toContainText('复习本次错项 2');
  await expect(page.locator('#btnBackToPreviousResult')).toHaveCount(0);

  const history = await page.evaluate(() => window.StudyStorage.getHistory());
  expect(history).toHaveLength(3);
  expect(new Set(history.map((entry) => entry.id)).size).toBe(3);
  expect(history[1].source).toMatchObject({ parentSessionId: originalSessionId, depth: 1 });
  expect(history[2].source).toMatchObject({ rootSessionId: originalSessionId, depth: 2 });
  expect(pageErrors).toEqual([]);
});

test('rapid review activation starts one child session and keeps the original history once', async ({
  page,
}) => {
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page);
  await page.evaluate(() => window.StudyStorage.clearAll());
  await startClassicSession(page, 0, 1);
  await submitClassicFeedback(page, 'unknown');
  await page.locator('#btnReviewErrors').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');

  await expect(page.locator('.study-source-banner')).toContainText('第 1 轮');
  const state = await page.evaluate(() => ({
    queue: window.appConfig.studyMode.queue.length,
    trail: window.appConfig.studyMode.resultTrail.length,
    history: window.StudyStorage.getHistory().length,
  }));
  expect(state).toEqual({ queue: 1, trail: 1, history: 1 });
  expect(pageErrors).toEqual([]);
});

test('review history source survives reload while ending review returns clearly to today', async ({
  page,
}) => {
  const getStored = await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page);
  await page.evaluate(() => window.StudyStorage.clearAll());
  await startClassicSession(page, 0, 1);
  await submitClassicFeedback(page, 'unknown');
  await page.locator('#btnReviewErrors').click();
  await submitClassicFeedback(page, 'known');
  await expect(page.locator('#btnBackToSetup')).toHaveText(/返回今日/);
  await page.locator('#btnBackToSetup').click();
  await expectOnlyModuleVisible(page, 'dashboard');
  await expect(page.locator('.dashboard-recent-item')).toHaveCount(2);
  await expect.poll(() => getStored().vocabulary.history.length).toBe(2);

  await page.reload();
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 45_000 });
  const restored = await page.evaluate(() => window.StudyStorage.getHistory());
  expect(restored).toHaveLength(2);
  expect(restored[1].source).toMatchObject({ kind: 'result-review', depth: 1, reviewCount: 1 });
  expect(pageErrors).toEqual([]);
});
