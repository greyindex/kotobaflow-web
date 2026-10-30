const { test, expect } = require('@playwright/test');
const { openReadyApp } = require('./helpers');

async function openSrsHarness(page, includeStorage = false) {
  await page.goto('/404.html');
  await page.addScriptTag({ url: '/js/core/srs.js' });
  if (includeStorage) {
    await page.addScriptTag({ url: '/js/core/events.js' });
    await page.addScriptTag({ url: '/js/storage.js' });
  }
}

test('SRS feedback produces deterministic local-calendar intervals', async ({ page }) => {
  await openSrsHarness(page);

  const result = await page.evaluate(() => {
    const now = new Date('2026-08-26T07:30:00.000Z');
    const offset = -480;
    const firstKnown = window.JPLearn.srs.schedule(null, 7, 'known', now, offset);
    return {
      known: firstKnown,
      knownAgain: window.JPLearn.srs.schedule(firstKnown, 7, 'known', now, offset),
      fuzzy: window.JPLearn.srs.schedule(null, 8, 'fuzzy', now, offset),
      unknown: window.JPLearn.srs.schedule(null, 9, 'unknown', now, offset),
      skipped: window.JPLearn.srs.schedule(firstKnown, 7, 'skip', now, offset),
    };
  });

  expect(result.known).toMatchObject({
    index: 7,
    nextReviewAt: '2026-08-28T16:00:00.000Z',
    intervalDays: 3,
    ease: 2.05,
    lapses: 0,
    reviewCount: 1,
  });
  expect(result.knownAgain).toMatchObject({ intervalDays: 6, ease: 2.1, reviewCount: 2 });
  expect(result.fuzzy).toMatchObject({
    nextReviewAt: '2026-08-26T16:00:00.000Z',
    intervalDays: 1,
    ease: 1.9,
  });
  expect(result.unknown).toMatchObject({
    nextReviewAt: '2026-08-26T07:30:00.000Z',
    intervalDays: 0,
    ease: 1.8,
    lapses: 1,
  });
  expect(result.skipped).toEqual(result.known);
});

test('SRS due queue is stable across exact boundaries and timezones', async ({ page }) => {
  await openSrsHarness(page);

  const result = await page.evaluate(() => {
    const records = [
      { index: 8, nextReviewAt: '2026-08-26T16:00:00.000Z' },
      { index: 3, nextReviewAt: '2026-08-26T16:00:00.000Z' },
      { index: 5, nextReviewAt: '2026-08-27T05:00:00.000Z' },
    ];
    return {
      before: window.JPLearn.srs.getDueIndices(records, new Date('2026-08-26T15:59:59.999Z')),
      atBoundary: window.JPLearn.srs.getDueIndices(records, new Date('2026-08-26T16:00:00.000Z')),
      utcMinusFive: window.JPLearn.srs.schedule(null, 11, 'fuzzy', new Date('2026-08-26T23:30:00.000Z'), 300),
    };
  });

  expect(result.before).toEqual([]);
  expect(result.atBoundary).toEqual([3, 8]);
  expect(result.utcMinusFive.nextReviewAt).toBe('2026-08-27T05:00:00.000Z');
});

test('SRS migration ignores damaged data and storage feedback updates once', async ({ page }) => {
  await openSrsHarness(page, true);

  const result = await page.evaluate(() => {
    const migrated = window.JPLearn.srs.migrateLegacy(
      [
        null,
        { index: 'bad', nextReviewAt: 'never' },
        {
          index: 4,
          lastReviewedAt: '2026-08-25T04:00:00.000Z',
          nextReviewAt: '2026-08-28T16:00:00.000Z',
          intervalDays: 3,
          ease: 2,
          lapses: 0,
          reviewCount: 1,
          lastResult: 'known',
        },
      ],
      { known: [4, 4, 'bad'], fuzzy: [5], unknown: null },
      new Date('2026-08-25T04:00:00.000Z'),
      -480,
    );
    window.StudyStorage.clearAll();
    window.StudyStorage.markWord(42, 'known');
    const beforeSkip = window.StudyStorage.getSrsRecords();
    window.StudyStorage.markWord(42, 'skip');
    const afterSkip = window.StudyStorage.getSrsRecords();
    window.StudyStorage.markWord(42, 'unknown');
    const afterUnknown = window.StudyStorage.getSrsRecords();
    return {
      emptyDue: window.JPLearn.srs.getDueIndices('damaged', new Date()),
      migrated,
      beforeSkip,
      afterSkip,
      afterUnknown,
    };
  });

  expect(result.emptyDue).toEqual([]);
  expect(result.migrated.map((record) => record.index)).toEqual([4, 5]);
  expect(result.migrated[1]).toMatchObject({ lastResult: 'fuzzy', nextReviewAt: '2026-08-25T04:00:00.000Z' });
  expect(result.afterSkip).toEqual(result.beforeSkip);
  expect(result.afterUnknown).toHaveLength(1);
  expect(result.afterUnknown[0]).toMatchObject({
    index: 42,
    lastResult: 'unknown',
    intervalDays: 0,
    lapses: 1,
  });
});

test('legacy progress migrates to schema v2 and powers the due queue', async ({ page }) => {
  let stored = {
    version: 1,
    vocabulary: {
      known: [0],
      fuzzy: [1],
      unknown: [2],
      favorite: [],
      grammarFavorite: [],
      history: [],
    },
    usage: {},
    updatedAt: '2026-08-25T04:00:00.000Z',
  };
  await page.route('**/api/progress', async (route) => {
    if (route.request().method() === 'POST') stored = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stored) });
  });

  const pageErrors = await openReadyApp(page, { module: 'dashboard' });
  await expect(page.locator('[data-dashboard-action="start-review"] strong')).toHaveText('2');
  await page.locator('.dashboard-primary[data-dashboard-action="start-review"]').click();
  await expect(page.locator('.study-card-view')).toBeVisible();
  await expect(page.locator('#statusStudyQueue')).toHaveText('2');
  await expect.poll(() => stored.version).toBe(2);
  expect(stored.vocabulary.srsVersion).toBe(1);
  expect(stored.vocabulary.srs).toHaveLength(3);
  expect(pageErrors).toEqual([]);
});

test('previously visible vocabulary IDs keep their saved review state', async ({ page }) => {
  const historicalIds = [6856, 7796, 9053, 9770, 9961, 10309, 10310, 10836];
  let stored = {
    version: 1,
    vocabulary: {
      known: [],
      fuzzy: [],
      unknown: historicalIds,
      favorite: [],
      grammarFavorite: [],
      history: [],
    },
    usage: {},
    updatedAt: '2026-08-25T04:00:00.000Z',
  };
  await page.route('**/api/progress', async (route) => {
    if (route.request().method() === 'POST') stored = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stored) });
  });

  await openReadyApp(page, { module: 'dashboard' });
  const visibleIds = await page.evaluate(() => window.taxonomyManager.allWords.map((word) => word.index));
  expect(visibleIds).toHaveLength(10116);
  expect(historicalIds.every((id) => visibleIds.includes(id))).toBe(true);
  await expect(page.locator('[data-dashboard-action="start-review"] strong')).toHaveText('8');
  await page.locator('.dashboard-primary[data-dashboard-action="start-review"]').click();
  await expect(page.locator('#statusStudyQueue')).toHaveText('8');
  expect(await page.evaluate(() => window.appConfig.studyMode.queue.map((word) => word.index))).toEqual(
    historicalIds,
  );
});

test('today queue reports all due words and starts a stable twenty-word session', async ({ page }) => {
  const due = Array.from({ length: 22 }, (_, index) => index + 1);
  const state = {
    version: 1,
    vocabulary: {
      known: [],
      fuzzy: [],
      unknown: due,
      favorite: [],
      grammarFavorite: [],
      history: [],
    },
    usage: {},
    updatedAt: '2026-08-25T04:00:00.000Z',
  };
  await page.route('**/api/progress', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state) });
  });

  const pageErrors = await openReadyApp(page, { module: 'dashboard' });
  await expect(page.locator('[data-dashboard-action="start-review"] strong')).toHaveText('22');
  await page.locator('.dashboard-primary[data-dashboard-action="start-review"]').click();
  await expect(page.locator('#statusStudyQueue')).toHaveText('20');
  expect(pageErrors).toEqual([]);
});
