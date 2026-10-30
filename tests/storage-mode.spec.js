const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { openReadyApp } = require('./helpers');

test.use({ serviceWorkers: 'block' });
const browserConfig = fs.readFileSync(path.join(__dirname, '../js/storage-config.js'), 'utf8');
const key = 'jp_learning_progress_browser_v1';

async function staticMode(page, mode = 'browser') {
  await page.route('**/js/storage-config.js*', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: browserConfig.replace("mode: 'browser'", `mode: '${mode}'`),
    }),
  );
}

async function editPlan(page, minutes) {
  await page.locator('[data-dashboard-action="open-plan"]').first().click();
  await page.locator('#dashboardPlanMinutes').fill(String(minutes));
  await page.locator('[data-dashboard-plan-form] button[type="submit"]').click();
}

test('static release saves through ten minutes and offline without progress API requests', async ({
  page,
  context,
}) => {
  let requests = 0;
  await page.route('**/api/progress', async (route) => {
    requests++;
    await route.fulfill({ status: 404, body: '{}' });
  });
  await staticMode(page);
  await page.clock.install();
  await openReadyApp(page, { module: 'dashboard' });
  await editPlan(page, 45);
  await expect(page.locator('#progressSyncStatus')).toHaveText('仅保存在此浏览器');
  // Exercise every 15-second save interval without replaying 36,000 animation frames.
  for (let interval = 0; interval < 40; interval++) await page.clock.fastForward(15_000);
  await page.clock.resume();
  await context.setOffline(true);
  await editPlan(page, 55);
  await expect(page.locator('#progressSyncStatus')).toHaveText('仅保存在此浏览器');
  // This suite explicitly blocks SW; browser progress persists but the shell is not cached.
  await expect(page.locator('#appPwaStatusText')).toContainText('离线缓存尚未就绪');
  await context.setOffline(false);
  await page.reload();
  await expect(page.locator('[data-dashboard-minute-target]')).toHaveText('55');
  expect(await page.evaluate(() => window.ProgressStore.getStorageMode())).toBe('browser');
  expect(requests).toBe(0);
});

test('reserved account mode never claims a login or uploads progress', async ({ page }) => {
  let requests = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/progress')) requests++;
  });
  await staticMode(page, 'account-sync');
  await openReadyApp(page, { module: 'dashboard' });
  await editPlan(page, 35);
  await expect(page.locator('#progressSyncStatus')).toHaveText('账号同步尚未启用；仅保存在此浏览器');
  await page.reload();
  await expect(page.locator('[data-dashboard-minute-target]')).toHaveText('35');
  expect(requests).toBe(0);
});

test('browser migration preserves legacy pending progress without deleting its backup', async ({ page }) => {
  await staticMode(page);
  await page.addInitScript(() => {
    if (!localStorage.getItem('jp_learning_progress_offline_v1'))
      localStorage.setItem(
        'jp_learning_progress_offline_v1',
        JSON.stringify({
          version: 2,
          pending: true,
          readFailure: true,
          plan: { dailyMinutes: 65 },
          vocabulary: {},
          usage: {},
        }),
      );
  });
  await openReadyApp(page, { module: 'dashboard' });
  await expect(page.locator('[data-dashboard-minute-target]')).toHaveText('65');
  await editPlan(page, 70);
  const saved = await page.evaluate(
    (key) => ({
      current: JSON.parse(localStorage.getItem(key)).plan.dailyMinutes,
      old: JSON.parse(localStorage.getItem('jp_learning_progress_offline_v1')).plan.dailyMinutes,
    }),
    key,
  );
  expect(saved).toEqual({ current: 70, old: 65 });
});

test('browser quota failure preserves confirmed data and shows an actionable warning', async ({ page }) => {
  await staticMode(page);
  await openReadyApp(page, { module: 'dashboard' });
  await editPlan(page, 30);
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException('full', 'QuotaExceededError');
      return original.call(this, name, value);
    };
  }, key);
  await editPlan(page, 50);
  await expect(page.locator('#progressSyncStatus')).toContainText('请勿关闭页面');
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).plan.dailyMinutes, key)).toBe(30);
});

test('corrupt browser snapshots are never replaced with a new-user default', async ({ page }) => {
  await staticMode(page);
  await page.addInitScript((key) => localStorage.setItem(key, 'broken archive'), key);
  await openReadyApp(page, { module: 'dashboard' });
  await editPlan(page, 50);
  await expect(page.locator('#progressSyncStatus')).toContainText('读取浏览器存档失败');
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe('broken archive');
});

test('invalid browser progress structures stay intact through editing and reopening', async ({ context }) => {
  test.setTimeout(120_000);
  const base = { version: 2, vocabulary: {}, usage: {}, plan: { dailyMinutes: 45 } };
  const invalid = [
    '',
    { version: 2 },
    { ...base, version: 3 },
    { ...base, vocabulary: [] },
    { ...base, vocabulary: { known: '[7]' } },
    { ...base, vocabulary: { history: {} } },
    { ...base, vocabulary: { srs: null } },
    { ...base, usage: [] },
    { ...base, usage: { '2026-09-10': 60000 } },
    { ...base, plan: [] },
    { ...base, plan: { dailyMinutes: '45' } },
    { ...base, navigation: { vocab: [] } },
  ];
  for (const [index, value] of invalid.entries()) {
    await test.step(`reject invalid shape ${index}`, async () => {
      const page = await context.newPage();
      const body = typeof value === 'string' ? value : JSON.stringify(value);
      await staticMode(page, index % 2 ? 'account-sync' : 'browser');
      await page.addInitScript(
        ({ key, body }) => {
          if (sessionStorage.getItem('review-seeded')) return;
          localStorage.clear();
          localStorage.setItem(key, body);
          sessionStorage.setItem('review-seeded', '1');
        },
        { key, body },
      );
      try {
        await openReadyApp(page, { module: 'dashboard' });
        await editPlan(page, 50);
        await expect(page.locator('#progressSyncStatus')).toContainText('读取浏览器存档失败');
        expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(body);
        await page.reload();
        await expect(page.locator('#loading')).toHaveClass(/hidden/);
        await expect(page.locator('#progressSyncStatus')).toContainText('读取浏览器存档失败');
        expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(body);
      } finally {
        await page.close();
      }
    });
  }
});

test('version 1 browser progress migrates missing optional fields without losing learning records', async ({
  page,
}) => {
  await staticMode(page);
  await page.addInitScript((key) => {
    if (localStorage.getItem(key) !== null) return;
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        vocabulary: { known: [7], favorite: [7] },
        usage: { '2026-09-10': { focusedMs: 60000, checkedIn: true } },
      }),
    );
  }, key);
  await openReadyApp(page, { module: 'dashboard' });
  await editPlan(page, 55);
  await page.reload();
  await expect(page.locator('[data-dashboard-minute-target]')).toHaveText('55');
  await expect(page.locator('#progressSyncStatus')).toHaveText('仅保存在此浏览器');
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
  expect(saved.version).toBe(2);
  expect(saved.vocabulary.known).toEqual([7]);
  expect(saved.vocabulary.favorite).toEqual([7]);
  expect(saved.vocabulary.srs[0].index).toBe(7);
  expect(saved.usage['2026-09-10']).toEqual({ focusedMs: 60000, checkedIn: true });
});

test('a stale browser page cannot overwrite progress saved by another page', async ({ page, context }) => {
  await staticMode(page);
  await openReadyApp(page, { module: 'dashboard' });
  await editPlan(page, 30);
  const second = await context.newPage();
  await staticMode(second);
  await openReadyApp(second, { module: 'dashboard' });
  await editPlan(second, 60);
  await page.bringToFront();
  await editPlan(page, 40);
  await expect(page.locator('#progressSyncStatus')).toContainText('另一页面已更新存档');
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).plan.dailyMinutes, key)).toBe(60);
});
