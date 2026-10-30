const { test, expect } = require('@playwright/test');
const { openReadyApp } = require('./helpers');

test('failed initial read never overwrites an existing archive after service recovery', async ({ page }) => {
  let failed = true;
  let writes = 0;
  await page.route('**/api/progress', async (route) => {
    if (route.request().method() === 'POST') writes++;
    await route.fulfill({
      status: failed ? 503 : 200,
      json: { version: 2, revision: 0, vocabulary: {}, usage: {}, plan: { dailyMinutes: 60 } },
    });
  });
  await openReadyApp(page, { module: 'dashboard' });
  await editPlan(page, 25);
  failed = false;
  await page.evaluate(() => window.ProgressStore.save());
  await expect(page.locator('#progressSyncStatus')).toContainText('读取存档失败');
  await page.reload();
  await page.waitForFunction(() => window.appConfig?.status === 'ready');
  await page.evaluate(() => window.ProgressStore.save());
  expect(writes).toBe(0);
  await expect(page.locator('#progressSyncStatus')).toContainText('暂停写入');
});

async function editPlan(page, minutes) {
  await page.locator('[data-dashboard-action="open-plan"]').first().click();
  await page.locator('#dashboardPlanMinutes').fill(String(minutes));
  await page.locator('[data-dashboard-plan-form] button[type="submit"]').click();
}

test('unconfirmed plan survives reload even when the server clock is ahead', async ({ page }) => {
  await page.route('**/api/progress', async (route) => {
    await route.fulfill({
      status: route.request().method() === 'POST' ? 503 : 200,
      json: { version: 2, revision: 0, vocabulary: {}, usage: {}, updatedAt: '2099-01-01T00:00:00Z' },
    });
  });
  await openReadyApp(page, { module: 'dashboard' });
  await editPlan(page, 55);
  await expect(page.locator('#progressSyncStatus')).toContainText('待重试');
  await page.reload();
  await expect(page.locator('[data-dashboard-minute-target]')).toHaveText('55');
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('jp_learning_progress_offline_v1')).pending),
  ).toBe(true);
});

test('invalid success response cannot erase the last confirmed or pending copy', async ({ page }) => {
  let invalid = false;
  let stored = { version: 2, revision: 0, vocabulary: {}, usage: {} };
  await page.route('**/api/progress', async (route) => {
    if (route.request().method() === 'POST') {
      if (invalid) {
        await route.fulfill({ json: {} });
        return;
      }
      stored = route.request().postDataJSON();
    }
    await route.fulfill({ json: stored });
  });
  await openReadyApp(page, { module: 'dashboard' });
  await editPlan(page, 25);
  await page.evaluate(() => window.ProgressStore.save());
  invalid = true;
  await editPlan(page, 50);
  await expect(page.locator('#progressSyncStatus')).toContainText('待重试');
  const copies = await page.evaluate(() => ({
    confirmed: JSON.parse(localStorage.getItem('jp_learning_progress_confirmed_v1')).plan.dailyMinutes,
    pending: JSON.parse(localStorage.getItem('jp_learning_progress_offline_v1')).plan.dailyMinutes,
  }));
  expect(copies).toEqual({ confirmed: 25, pending: 50 });
});

test('a delayed save never rolls back a newer plan and retries the latest snapshot', async ({ page }) => {
  let stored = { version: 2, revision: 0, vocabulary: {}, usage: {} };
  let delayed;
  let release;
  let hold = false;
  let fail = false;
  let active = 0;
  let maxActive = 0;
  await page.route('**/api/progress', async (route) => {
    if (route.request().method() === 'POST') {
      active++;
      maxActive = Math.max(maxActive, active);
      const submitted = route.request().postDataJSON();
      // Hold the 20-minute plan's own save: under load the earlier save can
      // still be on its way when the plan is edited.
      if (hold && submitted.plan?.dailyMinutes === 20) {
        hold = false;
        delayed = submitted;
        await new Promise((resolve) => {
          release = resolve;
        });
      }
      if (fail) {
        active--;
        await route.fulfill({ status: 503, body: '{}' });
        return;
      }
      stored = { ...submitted, revision: stored.revision + 1 };
      active--;
    }
    await route.fulfill({ json: stored });
  });
  await openReadyApp(page, { module: 'dashboard' });
  await page.evaluate(() => window.ProgressStore.save());
  hold = true;
  await editPlan(page, 20);
  await expect.poll(() => delayed?.plan.dailyMinutes).toBe(20);
  await editPlan(page, 40);
  await expect(page.locator('[data-dashboard-minute-target]')).toHaveText('40');
  fail = true;
  release();
  await expect(page.locator('#progressSyncStatus')).toContainText('待重试');
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('jp_learning_progress_offline_v1')).plan.dailyMinutes,
    ),
  ).toBe(40);
  fail = false;
  await page.evaluate(() => window.ProgressStore.save());
  await expect.poll(() => stored.plan.dailyMinutes).toBe(40);
  expect(maxActive).toBe(1);
  await page.reload();
  await expect(page.locator('[data-dashboard-minute-target]')).toHaveText('40');
});

test('successful old response preserves edits made while the request was pending', async ({ page }) => {
  let stored = { version: 2, revision: 0, vocabulary: {}, usage: {} };
  let release;
  let hold = false;
  await page.route('**/api/progress', async (route) => {
    if (route.request().method() === 'POST') {
      const submitted = route.request().postDataJSON();
      // As above, hold the 25-minute plan's own save, not a late earlier one.
      if (hold && submitted.plan?.dailyMinutes === 25) {
        hold = false;
        await new Promise((resolve) => {
          release = resolve;
        });
      }
      stored = { ...submitted, revision: stored.revision + 1 };
    }
    await route.fulfill({ json: stored });
  });
  await openReadyApp(page, { module: 'dashboard' });
  await page.evaluate(() => window.ProgressStore.save());
  hold = true;
  await editPlan(page, 25);
  await expect.poll(() => !!release).toBe(true);
  await editPlan(page, 50);
  release();
  await expect.poll(() => stored.plan.dailyMinutes).toBe(50);
  expect(await page.evaluate(() => window.ProgressStore.getPlan().dailyMinutes)).toBe(50);
  await expect(page.locator('[data-dashboard-minute-target]')).toHaveText('50');
});

test('revision conflict preserves pending data and storage failures are not called saved', async ({
  page,
}) => {
  let conflict = false;
  await page.route('**/api/progress', async (route) => {
    const post = route.request().method() === 'POST';
    await route.fulfill({
      status: conflict && post ? 409 : 200,
      json: post ? route.request().postDataJSON() : { version: 2, revision: 0, vocabulary: {}, usage: {} },
    });
  });
  await openReadyApp(page, { module: 'dashboard' });
  await page.evaluate(() => window.ProgressStore.save());
  conflict = true;
  await editPlan(page, 45);
  await expect(page.locator('#progressSyncStatus')).toContainText('版本冲突');
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('jp_learning_progress_offline_v1')).plan.dailyMinutes,
    ),
  ).toBe(45);
  await page.evaluate(() => {
    Storage.prototype.setItem = function () {
      throw new DOMException('full', 'QuotaExceededError');
    };
    return window.ProgressStore.save();
  });
  await expect(page.locator('#progressSyncStatus')).toContainText('请勿关闭页面');
});
