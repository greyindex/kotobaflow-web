const { revealControl, openSettings, openSidebar, closeSidebar } = require('./helpers');
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { openReadyApp, expectOnlyModuleVisible, expectRegionsWithinViewport } = require('./helpers');
const { useAudioFixtures } = require('./audio-fixtures');

test('design tokens do not contain unresolved custom-property references', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
  const definitions = new Set(Array.from(css.matchAll(/(--[\w-]+)\s*:/g), (match) => match[1]));
  const references = new Set(Array.from(css.matchAll(/var\(\s*(--[\w-]+)/g), (match) => match[1]));
  const unresolved = Array.from(references)
    .filter((token) => !definitions.has(token))
    .sort();

  expect(unresolved).toEqual([]);
});

async function useIsolatedProgress(page) {
  let stored = { version: 2, vocabulary: {}, navigation: {}, usage: {}, updatedAt: '' };
  await page.route('**/api/progress', async (route) => {
    if (route.request().method() === 'POST') stored = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stored) });
  });
}

async function openTextbookDirectory(page) {
  const directory = page.locator('.tb-lesson-directory');
  await revealControl(directory);
  if ((await directory.getAttribute('open')) === null) await directory.locator('summary').click();
  await expect(directory).toHaveAttribute('open', '');
}

const APK_URL = 'https://download.kotobaflow.lol/android/kotobaflow-0.4.2-public-8d85707591da.apk';

test('iPhone visitors reach the web app directly while Android downloads remain available', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
  });
  const page = await context.newPage();
  await useIsolatedProgress(page);
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-phone-device', 'true');
  await expect(page.locator('#mobileUnsupportedNotice')).toBeHidden();
  await expect(page.locator('#mobileUnsupportedDownload')).toHaveAttribute('href', APK_URL);
  await expect(page.locator('body')).not.toHaveClass(/mobile-warning-open/);
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 45_000 });
  await expect(page.locator('[data-dashboard-download]')).toBeVisible();
  await context.close();
});

for (const dismissal of ['continue', 'escape']) {
  test(`Android phone download prompt supports ${dismissal} and remembers the choice`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      // Intercept the APK before any service worker can take over its request.
      serviceWorkers: 'block',
      userAgent:
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
    });
    const page = await context.newPage();
    await useIsolatedProgress(page);
    let apkRequests = 0;
    let captured;
    const downloadCaptured = new Promise((resolve) => {
      captured = resolve;
    });
    await context.route(APK_URL, (route) => {
      apkRequests++;
      captured();
      return route.fulfill({
        status: 200,
        contentType: 'application/vnd.android.package-archive',
        headers: { 'Content-Disposition': 'attachment; filename="KotobaFlow-0.4.2-Android.apk"' },
        body: 'APK-download-fixture',
      });
    });
    await page.goto('/');
    const notice = page.locator('#mobileUnsupportedNotice');
    const download = page.locator('#mobileUnsupportedDownload');
    const next = page.locator('#mobileUnsupportedContinue');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('Android 7.0');
    await expect(notice).toContainText('827 MB');
    await expect(download).toHaveAttribute('href', APK_URL);
    await expect(download).toHaveAttribute('download', 'KotobaFlow-0.4.2-Android.apk');
    await expect(download).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(next).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(download).toBeFocused();
    expect(apkRequests).toBe(0);
    if (dismissal === 'continue') {
      await Promise.all([downloadCaptured, download.click()]);
      expect(apkRequests).toBe(1);
      await expect(notice).toBeVisible();
      await next.click();
    } else await page.keyboard.press('Escape');
    await expect(notice).toBeHidden();
    await expect(page.locator('body')).not.toHaveClass(/mobile-warning-open/);
    await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 45000 });
    await expect(page.locator('[data-dashboard-download]')).toHaveAttribute('href', APK_URL);
    await expect(page.locator('[data-dashboard-download]')).toHaveAttribute('aria-label', /0\.4\.2.*827 MB/);
    expect(await page.evaluate(() => JPLearn.androidDownload.bytes)).toBe(826752298);
    await page.reload();
    await expect(notice).toBeHidden();
    await context.close();
  });
}

test('desktop and iPad avoid phone warnings while touch controls clear browser chrome', async ({
  browser,
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await useIsolatedProgress(page);
  await page.goto('/');
  await expect(page.locator('#mobileUnsupportedNotice')).toBeHidden();
  await expect(page.locator('html')).toHaveAttribute('data-layout-viewport', 'phone');
  await expect(page.locator('#unifiedSidebar')).toHaveCSS('width', '56px');
  await page.locator('#statusBarShowBtn').click();
  await expect(page.locator('body')).toHaveClass(/narrow-global-sidebar-open/);
  await expect(page.locator('#statusBarShowBtn')).toHaveAttribute('aria-label', '关闭左侧栏');
  await expect(page.locator('#narrowGlobalSidebarBackdrop')).toBeVisible();
  await expect
    .poll(async () => (await page.locator('#unifiedSidebar').boundingBox()).width)
    .toBeGreaterThan(280);
  await page.locator('#narrowGlobalSidebarBackdrop').click({ position: { x: 380, y: 400 } });
  await expect(page.locator('body')).not.toHaveClass(/narrow-global-sidebar-open/);
  await expect(page.locator('#statusBarShowBtn')).toHaveAttribute('aria-label', '展开左侧栏');
  await page.locator('#statusBarShowBtn').click();
  await expect(page.locator('body')).toHaveClass(/narrow-global-sidebar-open/);
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.locator('html')).toHaveAttribute('data-layout-viewport', 'desktop');
  await expect(page.locator('body')).toHaveClass(/narrow-global-sidebar-open/);

  const tabletContext = await browser.newContext({
    viewport: { width: 820, height: 1180 },
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
  });
  const tabletPage = await tabletContext.newPage();
  await useIsolatedProgress(tabletPage);
  const pageErrors = await openReadyApp(tabletPage);
  await expect(tabletPage.locator('#mobileUnsupportedNotice')).toBeHidden();
  await expect(tabletPage.locator('html')).toHaveAttribute('data-touch-device', 'true');
  await tabletPage.setViewportSize({ width: 820, height: 640 });
  await tabletPage.locator('#modBtnVocab').click();
  await expect(tabletPage.locator('.cc-card').first()).toBeVisible();
  await expect(tabletPage.locator('html')).toHaveAttribute('data-layout-viewport', 'tablet');

  const assertAboveBrowserChrome = async (selector) => {
    const box = await tabletPage.locator(selector).boundingBox();
    expect(box, `${selector} should have a measurable box`).not.toBeNull();
    expect(box.y + box.height, `${selector} should clear the tablet browser toolbar`).toBeLessThanOrEqual(
      580,
    );
  };

  // UI-ART-28: the collapsed rail ends with the open button; full screen is in
  // the opened sidebar's footer.
  await expect(tabletPage.locator('#fullscreenToggleBtn')).toBeHidden();
  await assertAboveBrowserChrome('#statusBarShowBtn');
  await tabletPage.locator('#statusBarShowBtn').click();
  await assertAboveBrowserChrome('#fullscreenToggleBtn');
  await assertAboveBrowserChrome('#statusBarShowBtn');
  await tabletPage.keyboard.press('Escape');
  await expect(tabletPage.locator('body')).toHaveClass(/status-bar-collapsed/);
  const cards = tabletPage.locator('.card-container');
  await cards.evaluate((element) => {
    element.style.scrollBehavior = 'auto';
    element.scrollTop = element.scrollHeight;
  });
  await expect(tabletPage.locator('.cc-pagination')).toBeVisible();
  await assertAboveBrowserChrome('.cc-pagination');
  expect(pageErrors).toEqual([]);
  await tabletContext.close();
});

test('phone bottom controls and vocabulary pagination stay above browser chrome', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 700 },
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
  });
  const page = await context.newPage();
  await useIsolatedProgress(page);
  await page.addInitScript(() => {
    sessionStorage.setItem('jp_learning_mobile_warning_dismissed', '1');
  });
  const pageErrors = await openReadyApp(page);
  await expect(page.locator('html')).toHaveAttribute('data-layout-viewport', 'phone');
  await expect(page.locator('html')).toHaveAttribute('data-phone-device', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-touch-device', 'true');

  const assertAboveBrowserChrome = async (selector) => {
    const box = await page.locator(selector).boundingBox();
    expect(box, `${selector} should have a measurable box`).not.toBeNull();
    expect(box.y + box.height, `${selector} should clear the mobile browser toolbar`).toBeLessThanOrEqual(
      648,
    );
  };

  await expect(page.locator('#fullscreenToggleBtn')).toBeHidden();
  await assertAboveBrowserChrome('#statusBarShowBtn');

  const cards = page.locator('.card-container');
  await cards.evaluate((element) => {
    element.style.scrollBehavior = 'auto';
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(() =>
      cards.evaluate((element) => element.scrollTop + element.clientHeight >= element.scrollHeight - 1),
    )
    .toBe(true);
  await expect(page.locator('.cc-pagination')).toBeVisible();
  await assertAboveBrowserChrome('.cc-pagination');

  await expect(page.locator('#statusBarShowBtn')).toHaveAttribute('aria-label', '展开左侧栏');
  await page.locator('#statusBarShowBtn').click();
  await expect(page.locator('body')).toHaveClass(/narrow-global-sidebar-open/);
  await expect(page.locator('#sidebar')).not.toHaveClass(/tablet-drawer-open/);
  await expect(page.locator('#narrowGlobalSidebarBackdrop')).toBeVisible();
  await expect
    .poll(async () => (await page.locator('#unifiedSidebar').boundingBox()).width)
    .toBeGreaterThan(300);
  await expect(page.locator('#statusBarShowBtn')).toHaveAttribute('aria-label', '关闭左侧栏');
  await assertAboveBrowserChrome('#fullscreenToggleBtn');
  await assertAboveBrowserChrome('#statusBarShowBtn');
  await page.locator('#statusBarShowBtn').click();
  await expect(page.locator('body')).not.toHaveClass(/narrow-global-sidebar-open/);
  await expect(page.locator('#statusBarShowBtn')).toHaveAttribute('aria-label', '展开左侧栏');
  await assertAboveBrowserChrome('#statusBarShowBtn');

  await revealControl(page.locator('#tabletSidebarToggle'));
  await page.locator('#tabletSidebarToggle').click();
  await expect(page.locator('#sidebar')).toHaveClass(/tablet-drawer-open/);
  await page.locator('#statusBarShowBtn').click();
  await expect(page.locator('#sidebar')).not.toHaveClass(/tablet-drawer-open/);
  await expect(page.locator('body')).toHaveClass(/narrow-global-sidebar-open/);
  await expect(page.locator('#globalSearchToggle')).toBeVisible();
  await expect(page.locator('#unifiedModuleSidebarHost')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).not.toHaveClass(/narrow-global-sidebar-open/);
  expect(pageErrors).toEqual([]);
  await context.close();
});

test('daily dashboard is the default entry and starts a finite study session', async ({ page }) => {
  await page.route('**/api/progress', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ version: 2, vocabulary: {}, navigation: {}, usage: {}, updatedAt: '' }),
    });
  });
  const pageErrors = await openReadyApp(page, { module: 'dashboard' });
  await expectOnlyModuleVisible(page, 'dashboard');
  await expect(page.locator('#modBtnDashboard')).toHaveClass(/active/);
  await expect(page.locator('.dashboard-primary')).toBeEnabled();
  await expect(page.locator('.dashboard-task-card')).toHaveCount(3);
  await expect(page.locator('[data-dashboard-download]')).toHaveAttribute('href', APK_URL);
  await page.locator('.dashboard-primary').click();
  await expectOnlyModuleVisible(page, 'vocab');
  await expect(page.locator('.study-card-view')).toBeVisible();
  await expect(page.locator('#statusStudyQueue')).toHaveText('20');
  expect(pageErrors).toEqual([]);
});

test('daily dashboard remains usable when the progress API is unavailable', async ({ page }) => {
  await page.route('**/api/progress', async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ status: 503, body: '' });
    else await route.continue();
  });
  const pageErrors = await openReadyApp(page, { module: 'dashboard' });
  await expect(page.locator('.dashboard-primary')).toBeEnabled();
  await expect(page.locator('.dashboard-recent-empty')).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('damaged navigation falls back without blocking startup', async ({ page }) => {
  await page.route('**/api/progress', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ version: 1, vocabulary: {}, usage: {}, navigation: 'damaged' }),
    });
  });
  const pageErrors = await openReadyApp(page, { module: 'dashboard' });
  await expect(page.locator('.dashboard-primary')).toHaveAttribute('data-dashboard-action', 'start-new');
  await expect(page.locator('.dashboard-primary')).toBeEnabled();
  expect(pageErrors).toEqual([]);
});

test('continue learning restores textbook context after a page reload', async ({ page }) => {
  let stored = {
    version: 1,
    vocabulary: {
      known: [],
      fuzzy: [],
      unknown: [],
      favorite: [],
      grammarFavorite: [],
      history: [],
    },
    navigation: { version: 1, lastModule: '', vocab: {}, grammar: {}, textbook: {} },
    usage: {},
    updatedAt: '',
  };
  await page.route('**/api/progress', async (route) => {
    if (route.request().method() === 'POST') stored = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(stored),
    });
  });

  const pageErrors = await openReadyApp(page, { module: 'dashboard' });
  await page.locator('#modBtnLesson').click();
  await openTextbookDirectory(page);
  const secondLesson = page.locator('.tb-lesson-card').nth(1);
  await revealControl(secondLesson);
  await expect(secondLesson).toBeVisible();
  const lessonId = await secondLesson.getAttribute('data-lesson-id');
  await revealControl(secondLesson);
  await secondLesson.click();
  await expect(secondLesson).toHaveClass(/active/);
  await revealControl(page.locator('.tb-display-mode-btn[data-display-mode="plain"]'));
  await page.locator('.tb-display-mode-btn[data-display-mode="plain"]').click();
  await expect(page.locator('.tb-display-mode-btn[data-display-mode="plain"]')).toHaveClass(/active/);

  await page.locator('#modBtnDashboard').click();
  await expect(page.locator('.dashboard-primary')).toHaveAttribute('data-dashboard-action', 'resume');
  await expect(page.locator('.dashboard-secondary')).toBeVisible();
  await expect
    .poll(() => stored.navigation && stored.navigation.textbook && stored.navigation.textbook.lessonId)
    .toBe(lessonId);

  await page.reload();
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 45_000 });
  await expect(page.locator('.dashboard-primary')).toHaveAttribute('data-dashboard-action', 'resume');
  await page.locator('.dashboard-primary').click();
  await expectOnlyModuleVisible(page, 'lesson');
  await expect(page.locator(`.tb-lesson-card[data-lesson-id="${lessonId}"]`)).toHaveClass(/active/);
  await expect(page.locator('.tb-display-mode-btn[data-display-mode="plain"]')).toHaveClass(/active/);
  expect(pageErrors).toEqual([]);
});

test('continue learning restores the vocabulary view and filters', async ({ page }) => {
  const state = {
    version: 1,
    vocabulary: {},
    navigation: {
      version: 1,
      lastModule: 'vocab',
      vocab: { view: 'list', page: 1, filters: { search: '食べる', renderLimit: '0' } },
      grammar: {},
      textbook: {},
    },
    usage: {},
  };
  await page.route('**/api/progress', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state) });
  });
  const pageErrors = await openReadyApp(page, { module: 'dashboard' });
  await page.locator('.dashboard-primary').click();
  await expectOnlyModuleVisible(page, 'vocab');
  await expect(page.locator('#viewModeSelect')).toHaveValue('list');
  await expect(page.locator('#searchInput')).toHaveValue('食べる');
  await expect(page.locator('.list-row').first()).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('continue learning restores a selected grammar item after reload', async ({ page }) => {
  let stored = {
    version: 1,
    vocabulary: {},
    navigation: { version: 1, lastModule: '', vocab: {}, grammar: {}, textbook: {} },
    usage: {},
  };
  await page.route('**/api/progress', async (route) => {
    if (route.request().method() === 'POST') stored = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stored) });
  });
  const pageErrors = await openReadyApp(page, { module: 'dashboard' });
  await page.locator('#modBtnGrammar').click();
  const firstCard = page.locator('.gm-card').first();
  await expect(firstCard).toBeVisible();
  const uid = await firstCard.getAttribute('data-uid');
  await firstCard.click();
  await expect(firstCard).toHaveClass(/gm-card-selected/);
  await page.locator('#modBtnDashboard').click();
  await expect
    .poll(() => stored.navigation && stored.navigation.grammar && stored.navigation.grammar.selectedUid)
    .toBe(uid);

  await page.reload();
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 45_000 });
  await page.locator('.dashboard-primary').click();
  await expectOnlyModuleVisible(page, 'grammar');
  await expect(page.locator(`.gm-card[data-uid="${uid}"]`)).toHaveClass(/gm-card-selected/);
  await expect(page.locator('#gmDetailContent')).not.toBeEmpty();
  expect(pageErrors).toEqual([]);
});

test('loads vocabulary data and switches all primary modules', async ({ page }) => {
  const pageErrors = await openReadyApp(page);
  await expectOnlyModuleVisible(page, 'vocab');
  await expect(page.locator('#card-container')).toBeVisible();
  await expect(page.locator('.cc-card').first()).toBeVisible();

  await page.locator('#modBtnGrammar').click();
  await expectOnlyModuleVisible(page, 'grammar');
  await expect(page.locator('#grammarTotalBadge')).not.toHaveText('0 条');
  await expect(page.locator('.gm-card').first()).toBeVisible();

  await page.locator('#modBtnLesson').click();
  await expectOnlyModuleVisible(page, 'lesson');
  await expect(page.locator('.tb-lesson-directory')).not.toHaveAttribute('open', '');
  await expect(page.locator('#tbReader')).not.toContainText('课文模块初始化中');

  await page.locator('#modBtnVocab').click();
  await expectOnlyModuleVisible(page, 'vocab');
  expect(pageErrors).toEqual([]);
});

test('product header identifies the app, tracks location, and returns home', async ({ page }) => {
  const pageErrors = await openReadyApp(page, { module: 'dashboard' });
  await expect(page.locator('#appBrandHome')).toContainText('词基流动');
  const brandLogo = page.locator('#appBrandHome .app-brand-mark img');
  await expect(brandLogo).toBeVisible();
  await expect(brandLogo).toHaveAttribute('src', /^\.\/pwa-icon\.svg\?v=20260829-b05-1$/);
  await expect(page.locator('#appHeaderLocation')).toHaveText('今日学习');
  await expect(page.locator('.mod-btn[aria-current="page"]')).toHaveCount(1);
  await expect(page.locator('#modBtnDashboard')).toHaveAttribute('aria-current', 'page');

  for (const [moduleName, buttonId, location] of [
    ['lesson', '#modBtnLesson', '课文阅读'],
    ['grammar', '#modBtnGrammar', '语法学习'],
    ['vocab', '#modBtnVocab', '词汇学习'],
  ]) {
    await page.locator(buttonId).click();
    await expectOnlyModuleVisible(page, moduleName);
    await expect(page.locator(buttonId)).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.mod-btn[aria-current="page"]')).toHaveCount(1);
    await expect(page.locator('#appHeaderLocation')).toHaveText(location);
  }

  await page.locator('#appBrandHome').click();
  await expectOnlyModuleVisible(page, 'dashboard');
  await expect(page.locator('#appHeaderLocation')).toHaveText('今日学习');
  expect(pageErrors).toEqual([]);
});

test('B01 B11 global and module controls share one collapsible left sidebar', async ({ page }) => {
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page, { module: 'dashboard' });
  const rail = page.locator('#unifiedSidebar');
  const app = page.locator('.app-container');

  await page.locator('#statusBarShowBtn').click();
  await expect(rail).toHaveCSS('width', '288px');
  const desktopLayout = await page.evaluate(() => {
    const railBox = document.getElementById('unifiedSidebar').getBoundingClientRect();
    const appBox = document.querySelector('.app-container').getBoundingClientRect();
    const moduleBoxes = Array.from(document.querySelectorAll('.mod-btn')).map((button) =>
      button.getBoundingClientRect(),
    );
    return {
      rail: { left: railBox.left, top: railBox.top, width: railBox.width, height: railBox.height },
      appLeft: appBox.left,
      moduleLefts: moduleBoxes.map((box) => Math.round(box.left)),
      moduleTops: moduleBoxes.map((box) => Math.round(box.top)),
    };
  });
  expect(desktopLayout.rail).toEqual({ left: 0, top: 0, width: 288, height: 900 });
  expect(desktopLayout.appLeft).toBe(76);
  expect(new Set(desktopLayout.moduleTops).size).toBe(1);
  expect(desktopLayout.moduleLefts).toEqual([...desktopLayout.moduleLefts].sort((a, b) => a - b));
  expect(
    await page.evaluate(() =>
      ['sidebar', 'grammarSidebar', 'textbookSidebar'].every(
        (id) => document.getElementById(id).parentElement.id === 'unifiedModuleSidebarHost',
      ),
    ),
  ).toBe(true);

  // UI-ART-25: the third-party JLPT site is listed on the about page, not in the sidebar.
  await expect(page.locator('#unifiedSidebar a[href*="easy-jlpt"]')).toHaveCount(0);
  await expectRegionsWithinViewport(page, [
    '#moduleSwitcher',
    '#globalSearchToggle',
    '#appSettingsToggle',
    '#fullscreenToggleBtn',
    '#statusBarShowBtn',
  ]);
  const unifiedHeaderLayout = await page.evaluate(() => {
    const box = (selector) => document.querySelector(selector).getBoundingClientRect();
    const search = box('#globalSearchToggle');
    const settings = box('#appSettingsToggle');
    const navStyle = getComputedStyle(document.querySelector('.mod-btn'));
    return {
      actionTopSpread: Math.abs(search.top - settings.top),
      searchToSettingsGap: Math.round(settings.left - search.right),
      navDirection: navStyle.flexDirection,
      navAlignment: navStyle.alignItems,
      progressColor: getComputedStyle(document.querySelector('#progressTodayTime')).color,
      progressLabelColor: getComputedStyle(document.querySelector('.progress-label')).color,
      desktopModuleCollapseButtonsHidden: Array.from(
        document.querySelectorAll('.unified-module-sidebar-host .sidebar-collapse-btn'),
      ).every((button) => getComputedStyle(button).display === 'none'),
    };
  });
  expect(unifiedHeaderLayout.actionTopSpread).toBeLessThanOrEqual(1);
  expect(unifiedHeaderLayout.searchToSettingsGap).toBe(6);
  expect(unifiedHeaderLayout.navDirection).toBe('row');
  expect(unifiedHeaderLayout.navAlignment).toBe('center');
  expect(unifiedHeaderLayout.progressColor).not.toBe(unifiedHeaderLayout.progressLabelColor);
  expect(unifiedHeaderLayout.desktopModuleCollapseButtonsHidden).toBe(true);

  await page.locator('#statusBarShowBtn').click();
  await expect(page.locator('body')).toHaveClass(/status-bar-collapsed/);
  await expect(rail).toBeVisible();
  await expect(page.locator('#statusBar')).toBeVisible();
  await expect(page.locator('#statusBarShowBtn')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#statusBarShowBtn')).toHaveAttribute('aria-label', '展开左侧栏');
  await expect.poll(() => rail.evaluate((element) => element.offsetWidth)).toBe(76);
  await expect.poll(() => app.evaluate((element) => element.getBoundingClientRect().left)).toBe(76);
  const collapsedControls = await page.locator('#statusBarRevealControls').boundingBox();
  expect(collapsedControls.x).toBe(0);
  expect(collapsedControls.width).toBeLessThanOrEqual(76);
  expect(collapsedControls.height).toBeLessThanOrEqual(110);
  expect(Math.round(collapsedControls.y + collapsedControls.height)).toBe(900);
  // UI-ART-28: the collapsed rail keeps the brand, the modules and a smaller
  // open button with no rule above it; search, settings and full screen are in
  // the opened sidebar.
  for (const selector of ['#globalSearchToggle', '#appSettingsToggle', '#fullscreenToggleBtn'])
    await expect(page.locator(selector)).toBeHidden();
  const openButton = await page.locator('#statusBarShowBtn').boundingBox();
  expect([openButton.width, openButton.height]).toEqual([36, 36]);
  expect(
    await page.evaluate(() => ({
      header: getComputedStyle(document.getElementById('statusBar')).borderBottomWidth,
      modules: getComputedStyle(document.getElementById('moduleSwitcher')).borderBottomWidth,
      footer: getComputedStyle(document.getElementById('statusBarRevealControls')).borderTopWidth,
    })),
  ).toEqual({ header: '0px', modules: '0px', footer: '0px' });

  await page.locator('#statusBarShowBtn').click();
  await expect(page.locator('body')).not.toHaveClass(/status-bar-collapsed/);
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect.poll(() => rail.evaluate((element) => element.offsetWidth)).toBe(288);
  await expect.poll(() => app.evaluate((element) => element.getBoundingClientRect().left)).toBe(76);
  await expect(page.locator('.mod-btn')).toHaveCount(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(pageErrors).toEqual([]);
});

test('header settings support dismissal, scale selection, and compact layout', async ({ page }) => {
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page, { module: 'dashboard' });
  const toggle = page.locator('#appSettingsToggle');
  const panel = page.locator('#appSettingsPanel');

  await page.evaluate(() => {
    window.StudyStorage.markWord(window.taxonomyManager.allWords[0].index, 'known');
    window.StudyStorage.toggleGrammarFavorite('settings-danger-test');
  });

  // The offline status stays one line until the worker is ready; measure the
  // panel with its final height.
  await expect.poll(() => page.evaluate(() => window.AppPWA.getState().ready)).toBe(true);
  await openSettings(page);
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const expandedAnchor = await page.evaluate(() => {
    const button = document.querySelector('#appSettingsToggle').getBoundingClientRect();
    const popup = document.querySelector('#appSettingsPanel').getBoundingClientRect();
    return {
      buttonRight: button.right,
      buttonTop: button.top,
      popupLeft: popup.left,
      popupTop: popup.top,
      popupRight: popup.right,
      popupHeight: document.querySelector('#appSettingsPanel').offsetHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });
  expect(expandedAnchor.popupLeft).toBeGreaterThanOrEqual(expandedAnchor.buttonRight + 6);
  // The panel lines up with its button unless that leaves less than its 10px
  // margin at the window bottom; then it rises just enough (FIX-38).
  const anchoredTop = Math.min(
    expandedAnchor.buttonTop,
    expandedAnchor.viewportHeight - expandedAnchor.popupHeight - 10,
  );
  expect(Math.abs(expandedAnchor.popupTop - anchoredTop)).toBeLessThanOrEqual(4);
  expect(expandedAnchor.popupRight).toBeLessThanOrEqual(expandedAnchor.viewportWidth);
  await page.locator('#appScaleSelect').selectOption('1');
  await expect(page.locator('#appScaleSelect')).toHaveValue('1');
  await expect(page.locator('#btnClearStudyData')).toHaveCount(0);
  await panel.locator('.app-settings-danger summary').click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#appClearStudyData').click();
  await expect(page.locator('#appClearStudyDataStatus')).toHaveText('学习记录已清空');
  expect(
    await page.evaluate(() => ({
      counts: window.StudyStorage.getCounts(),
      grammarFavorites: window.StudyStorage.getGrammarFavorites().length,
    })),
  ).toEqual({
    counts: { known: 0, fuzzy: 0, unknown: 0, favorite: 0 },
    grammarFavorites: 0,
  });
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(toggle).toBeFocused();

  // A click elsewhere in the opened sidebar dismisses the panel and keeps the sidebar.
  await toggle.click();
  await page.locator('#progressStrip .progress-label').first().click();
  await expect(panel).toBeHidden();
  await expect(page.locator('body')).not.toHaveClass(/status-bar-collapsed/);
  await closeSidebar(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await expectRegionsWithinViewport(page, ['#appBrandHome', '#moduleSwitcher', '#statusBarRevealControls']);
  // Open the drawer with its own control and check the panel beside it.
  await page.locator('#statusBarShowBtn').click();
  await expect(page.locator('body')).not.toHaveClass(/status-bar-collapsed/);
  await toggle.click();
  await expect(panel).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const button = document.querySelector('#appSettingsToggle').getBoundingClientRect();
        const popup = document.querySelector('#appSettingsPanel').getBoundingClientRect();
        return popup.left >= button.right + 6 && popup.top <= button.bottom && popup.bottom >= button.top;
      }),
    )
    .toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).not.toHaveClass(/status-bar-collapsed/);
  await page.locator('#statusBarShowBtn').click();
  await expect(page.locator('body')).toHaveClass(/status-bar-collapsed/);
  await expect(toggle).toBeHidden();
  await expect(page.locator('.mod-btn')).toHaveCount(4);
  for (const button of await page.locator('.mod-btn').all()) await expect(button).toBeVisible();
  expect(pageErrors).toEqual([]);
});

// FIX-38: the open settings panel follows its own height. The offline status
// grows from one line to two once the service worker is ready, and 数据管理
// opens inside the panel; both keep the panel 10px inside the window.
for (const { width, height } of [
  { width: 1600, height: 900 },
  { width: 1280, height: 720 },
]) {
  test(`FIX-38 open settings stay inside the window as their content grows at ${width}`, async ({ page }) => {
    await useIsolatedProgress(page);
    await page.setViewportSize({ width, height });
    const pageErrors = await openReadyApp(page, { module: 'dashboard' });
    // Once the worker is ready, js/pwa.js no longer rewrites the status below.
    await expect.poll(() => page.evaluate(() => window.AppPWA.getState().ready)).toBe(true);
    const toggle = page.locator('#appSettingsToggle');
    const panel = page.locator('#appSettingsPanel');
    const status = page.locator('#appPwaStatusText');
    const settled = () =>
      panel.evaluate(async (el) => {
        await Promise.all(el.getAnimations().map((animation) => animation.finished.catch(() => {})));
        const rect = el.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, height: el.offsetHeight };
      });
    const expectInside = (box) => {
      expect(box.top).toBeGreaterThanOrEqual(9.5);
      expect(box.bottom).toBeLessThanOrEqual(height - 9.5);
    };

    await openSettings(page);
    await expect(panel).toHaveClass(/is-open/);
    const opened = await settled();
    expectInside(opened);
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();

    // Open with the one-line status of a worker that is still starting, then
    // write the ready text the way js/pwa.js render() does.
    const readyText = await status.textContent();
    await status.evaluate((el) => (el.textContent = '正在准备离线缓存…'));
    await toggle.click();
    await expect(panel).toHaveClass(/is-open/);
    const starting = await settled();
    expect(starting.height).toBeLessThan(opened.height);
    expectInside(starting);
    await status.evaluate((el, text) => (el.textContent = text), readyText);
    await expect.poll(settled).toEqual(opened);

    await panel.locator('.app-settings-danger summary').click();
    await expect(page.locator('#appClearStudyData')).toBeVisible();
    const withData = await settled();
    expect(withData.height).toBeGreaterThan(opened.height);
    expectInside(withData);
    expect(pageErrors).toEqual([]);
  });
}

test('vocabulary view, search, and status-bar controls complete a full cycle', async ({ page }) => {
  const pageErrors = await openReadyApp(page);

  await revealControl(page.locator('#viewModeSelect'));
  await page.locator('#viewModeSelect').selectOption('list');
  await expect(page.locator('#list-container')).toBeVisible();
  await expect(page.locator('.list-row').first()).toBeVisible();

  await revealControl(page.locator('#searchInput'));
  await page.locator('#searchInput').fill('__baseline_no_match__');
  await revealControl(page.locator('#searchInput'));
  await page.locator('#searchInput').press('Enter');
  await expect(page.locator('#statusFiltered')).toHaveText('0');

  await revealControl(page.locator('#resetFiltersBtn'));
  await page.locator('#resetFiltersBtn').click();
  await expect(page.locator('#statusFiltered')).not.toHaveText('0');

  await page.locator('#statusBarShowBtn').click();
  await expect(page.locator('body')).toHaveClass(/status-bar-collapsed/);
  await expect(page.locator('#statusBarShowBtn')).toBeVisible();
  await page.locator('#statusBarShowBtn').click();
  await expect(page.locator('body')).not.toHaveClass(/status-bar-collapsed/);
  expect(pageErrors).toEqual([]);
});

test('B16 vocabulary and grammar browsing tools live in their left sidebars', async ({ page }) => {
  const pageErrors = await openReadyApp(page);

  await revealControl(page.locator('#vocabViewTools #ccSortSelect'));
  await expect(page.locator('#vocabViewTools #ccSortSelect')).toBeVisible();
  await revealControl(page.locator('#vocabViewTools .cc-toolbar'));
  await expect(page.locator('#vocabViewTools .cc-toolbar')).toBeVisible();
  await expect(page.locator('#card-container > .cc-wrapper > .cc-toolbar')).toHaveCount(0);
  await expect(page.locator('.cc-toolbar #ccSortSelect')).toHaveCount(0);
  await revealControl(page.locator('#ccPerPageSelect'));
  await page.locator('#ccPerPageSelect').selectOption('12');
  await expect(page.locator('.cc-card')).toHaveCount(12);
  await revealControl(page.locator('#ccSortSelect'));
  await page.locator('#ccSortSelect').selectOption('shuffle');
  await revealControl(page.locator('#vocabViewTools #ccReshuffle'));
  await expect(page.locator('#vocabViewTools #ccReshuffle')).toBeVisible();

  await revealControl(page.locator('#viewModeSelect'));
  await page.locator('#viewModeSelect').selectOption('list');
  await revealControl(page.locator('#vocabViewTools #listSortSelect'));
  await expect(page.locator('#vocabViewTools #listSortSelect')).toBeVisible();
  await expect(page.locator('.list-header')).toHaveCount(0);
  await revealControl(page.locator('#pageSizeSelect'));
  await page.locator('#pageSizeSelect').selectOption('20');
  await expect(page.locator('.list-row')).toHaveCount(20);
  await revealControl(page.locator('#listMeaningToggle'));
  await page.locator('#listMeaningToggle').click();
  await expect(page.locator('.list-row .col-meaning').first()).toBeEmpty();
  await revealControl(page.locator('#listMeaningToggle'));
  await page.locator('#listMeaningToggle').click();
  await expect(page.locator('.list-row .col-meaning').first()).not.toBeEmpty();

  await page.locator('#modBtnGrammar').click();
  await revealControl(page.locator('#gmSidebarFilters #gmSearch'));
  await expect(page.locator('#gmSidebarFilters #gmSearch')).toBeVisible();
  await expect(page.locator('#gmGrammarList .gm-toolbar')).toHaveCount(0);
  await expect(page.locator('#gmSubTabs')).toBeHidden();
  expect(await page.locator('#gmCourseContext').evaluate((node) => node.parentElement.id)).toBe(
    'grammarSidebar',
  );
  await revealControl(page.locator('#gmSidebarFilters .gm-tab[data-level="N5"]'));
  await page.locator('#gmSidebarFilters .gm-tab[data-level="N5"]').click();
  await expect(page.locator('#gmSidebarFilters .gm-tab[data-level="N5"]')).toHaveClass(/active/);
  await expect(page.locator('.gm-card').first()).toBeVisible();

  await revealControl(page.locator('#gmSideNavLesson'));
  await page.locator('#gmSideNavLesson').click();
  await expect(page.locator('#gmSidebarTools')).toBeHidden();
  await revealControl(page.locator('#gmSideNavGrammar'));
  await page.locator('#gmSideNavGrammar').click();
  await revealControl(page.locator('#gmSidebarTools'));
  await expect(page.locator('#gmSidebarTools')).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('B15 repeated confirmations and utility labels stay compact but accessible', async ({ page }) => {
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page);

  await expect(page.locator('#applyFiltersBtn')).toBeHidden();
  await expect(page.locator('#resetFiltersBtn')).toHaveText(/清除筛选/);
  await expect(page.locator('#searchInput')).toHaveAttribute('placeholder', /即时筛选/);
  await revealControl(page.locator('#searchInput'));
  await page.locator('#searchInput').fill('__b15_live_no_match__');
  await expect(page.locator('#statusFiltered')).toHaveText('0');
  await revealControl(page.locator('#resetFiltersBtn'));
  await page.locator('#resetFiltersBtn').click();
  await expect(page.locator('#statusFiltered')).not.toHaveText('0');

  await expect(page.locator('#ccReadPage')).toHaveText('');
  await expect(page.locator('#ccReadPage')).toHaveAttribute('aria-label', '朗读当页单词');
  await expect(page.locator('#ccMeaningToggle')).toHaveText('');
  await expect(page.locator('#ccMeaningToggle')).toHaveAttribute('aria-label', '隐藏词卡释义');
  await expect(page.locator('#ccBatchToggle')).toContainText('批量');
  await expect(page.locator('#ccBatchToggle')).not.toContainText('批量操作');

  await revealControl(page.locator('#viewModeSelect'));
  await page.locator('#viewModeSelect').selectOption('list');
  await expect(page.locator('#listReadPage')).toHaveText('');
  await expect(page.locator('#listReadPage')).toHaveAttribute('title', '朗读当页单词');

  await page.locator('#modBtnGrammar').click();
  await expect(page.locator('#gmSideNavGrammar')).toHaveText(/语法点$/);
  await expect(page.locator('#gmSideNavLesson')).toHaveText(/辅助课文$/);
  await revealControl(page.locator('#gmSideNavLesson'));
  await page.locator('#gmSideNavLesson').click();
  await expect(page.locator('.gm-lesson-card').first()).toBeVisible();
  await revealControl(page.locator('.gm-lesson-card').first());
  await page.locator('.gm-lesson-card').first().click();
  await expect(page.locator('#gmReaderBack')).toHaveText(/返回列表/);
  await expect(page.locator('#gmReaderBack')).toHaveAttribute('aria-label', '返回辅助课文列表');

  await page.locator('#modBtnLesson').click();
  await revealControl(page.locator('.tb-course-path-toggle'));
  await page.locator('.tb-course-path-toggle').click();
  await revealControl(page.locator('.tb-course-step-skip').first());
  await expect(page.locator('.tb-course-step-skip').first()).toBeVisible();
  await expect(page.locator('.tb-course-step-skip').first()).toHaveText('');
  await expect(page.locator('.tb-course-step-skip').first()).toHaveAttribute('aria-label', /跳过/);
  expect(pageErrors).toEqual([]);
});

test('B14 informational surfaces use grouped lists while primary actions stay emphasized', async ({
  page,
}) => {
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page, { module: 'dashboard' });
  await page.setViewportSize({ width: 1280, height: 720 });

  const dashboardStyles = await page.evaluate(() => {
    const style = (selector) => getComputedStyle(document.querySelector(selector));
    const insight = style('.dashboard-insight-card');
    const insightGroup = style('.dashboard-insight-grid');
    const achievement = style('.dashboard-achievement-card');
    const recent = style('.dashboard-recent');
    return {
      insightBorder: insight.borderTopWidth,
      insightRadius: insight.borderRadius,
      insightShadow: insight.boxShadow,
      groupBorder: insightGroup.borderTopWidth,
      achievementBorder: achievement.borderTopWidth,
      achievementRadius: achievement.borderRadius,
      recentRadius: recent.borderRadius,
      recentShadow: recent.boxShadow,
    };
  });
  expect(dashboardStyles).toEqual({
    insightBorder: '0px',
    insightRadius: '0px',
    insightShadow: 'none',
    groupBorder: '1px',
    achievementBorder: '0px',
    achievementRadius: '0px',
    recentRadius: '0px',
    recentShadow: 'none',
  });

  await page.locator('#modBtnVocab').click();
  const planStyle = await page.locator('.vocab-plan-card').evaluate((node) => {
    const style = getComputedStyle(node);
    return { borderTop: style.borderTopWidth, borderLeft: style.borderLeftWidth, radius: style.borderRadius };
  });
  expect(planStyle).toEqual({ borderTop: '1px', borderLeft: '0px', radius: '0px' });

  await page.locator('#modBtnGrammar').click();
  await revealControl(page.locator('#gmSideNavLesson'));
  await page.locator('#gmSideNavLesson').click();
  const lessonCards = page.locator('.gm-lesson-card');
  await expect(lessonCards.first()).toBeVisible();
  const lessonListLayout = await lessonCards.evaluateAll((nodes) => {
    const first = nodes[0].getBoundingClientRect();
    const second = nodes[1].getBoundingClientRect();
    const style = getComputedStyle(nodes[0]);
    return {
      sameColumn: Math.abs(first.left - second.left) < 1,
      stacked: second.top >= first.bottom - 1,
      borderBottom: style.borderBottomWidth,
      radius: style.borderRadius,
      shadow: style.boxShadow,
    };
  });
  expect(lessonListLayout).toEqual({
    sameColumn: true,
    stacked: true,
    borderBottom: '1px',
    radius: '0px',
    shadow: 'none',
  });
  await revealControl(lessonCards.first());
  await lessonCards.first().press('Enter');
  await expect(page.locator('.gm-reader-article')).toBeVisible();

  await page.locator('#modBtnLesson').click();
  const directory = page.locator('.tb-lesson-directory');
  await revealControl(directory);
  await openTextbookDirectory(page);
  await revealControl(directory.locator('.tb-lesson-card').first());
  await expect(directory.locator('.tb-lesson-card').first()).toBeVisible();
  const textbookListStyle = await directory
    .locator('.tb-lesson-card')
    .first()
    .evaluate((node) => {
      const style = getComputedStyle(node);
      const list = node.closest('.tb-lesson-list');
      return {
        borderBottom: style.borderBottomWidth,
        borderLeft: style.borderLeftWidth,
        radius: style.borderRadius,
        shadow: style.boxShadow,
        fitsWidth: list.scrollWidth <= list.clientWidth,
      };
    });
  expect(textbookListStyle).toEqual({
    borderBottom: '1px',
    borderLeft: '3px',
    radius: '0px',
    shadow: 'none',
    fitsWidth: true,
  });
  await revealControl(directory.locator('.tb-lesson-card').nth(1));
  await directory.locator('.tb-lesson-card').nth(1).click();
  await expect(directory.locator('.tb-lesson-card').nth(1)).toHaveAttribute('aria-current', 'page');
  expect(pageErrors).toEqual([]);
});

test('B17 global palette and spacing keep four module surfaces distinct and stable', async ({ page }) => {
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page, { module: 'dashboard' });
  await page.setViewportSize({ width: 1280, height: 720 });

  const surfaces = () =>
    page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      return {
        tokens: ['--surface-canvas', '--surface-base', '--surface-raised'].map((name) =>
          root.getPropertyValue(name).trim(),
        ),
        canvas: getComputedStyle(document.querySelector('.dashboard-main')).backgroundColor,
        rail: getComputedStyle(document.querySelector('.app-header')).backgroundColor,
      };
    });
  const lightRhythm = await page.evaluate(() => {
    const shell = getComputedStyle(document.querySelector('.dashboard-shell'));
    const heading = getComputedStyle(document.querySelector('.dashboard-heading'));
    const section = getComputedStyle(document.querySelector('.dashboard-section'));
    const activeMarker = getComputedStyle(document.querySelector('.mod-btn.active'), '::before');
    const sidebar = getComputedStyle(document.querySelector('.unified-sidebar'));
    return {
      railRule: sidebar.borderRightWidth + ' ' + sidebar.borderRightStyle,
      railRuleColor: sidebar.borderRightColor,
      shellPaddingTop: shell.paddingTop,
      shellRowGap: shell.rowGap,
      headingMarginBottom: heading.marginBottom,
      sectionMarginBottom: section.marginBottom,
      activeMarkerWidth: activeMarker.width,
      activeMarkerHeight: activeMarker.height,
    };
  });
  // UI-ART-25: the 简洁 default is one white page in light mode, so a rule rather
  // than a tint sets the rail apart; the layered 和纸 palette is checked below.
  const plainSurfaces = await surfaces();
  expect(plainSurfaces.tokens).toEqual(['#ffffff', '#ffffff', '#ffffff']);
  expect(lightRhythm.railRule).toBe('1px solid');
  expect(lightRhythm.railRuleColor).not.toBe(plainSurfaces.canvas);
  // Today spaces its bands with one gap that also pads the board's top edge.
  expect(lightRhythm.shellPaddingTop).toBe('10px');
  expect(lightRhythm.shellRowGap).toBe(lightRhythm.shellPaddingTop);
  expect(lightRhythm.headingMarginBottom).toBe('0px');
  expect(lightRhythm.sectionMarginBottom).toBe('0px');
  expect(lightRhythm.activeMarkerWidth).toBe('2px');
  expect(parseFloat(lightRhythm.activeMarkerHeight)).toBeGreaterThanOrEqual(24);

  for (const [button, moduleName] of [
    ['#modBtnVocab', 'vocab'],
    ['#modBtnGrammar', 'grammar'],
    ['#modBtnLesson', 'lesson'],
    ['#modBtnDashboard', 'dashboard'],
  ]) {
    await page.locator(button).click();
    await expectOnlyModuleVisible(page, moduleName);
    await expect(page.locator(button)).toHaveClass(/active/);
  }

  await openSettings(page);
  await page.locator('#appAppearanceOpen').click();
  await page.locator('#appearanceEditMode').selectOption('light');
  await page.locator('[data-preset="paper"]').click();
  await page.locator('#appearanceApply').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#appSettingsPanel')).toBeHidden();
  await closeSidebar(page);
  await expect(page.locator('html')).toHaveAttribute('data-appearance-preset', 'paper');
  const paperSurfaces = await surfaces();
  expect(new Set(paperSurfaces.tokens).size).toBe(3);
  expect(paperSurfaces.canvas).not.toBe(paperSurfaces.rail);

  await openSettings(page);
  await page.locator('#appThemeSelect').selectOption('dark');
  await page.keyboard.press('Escape');
  await closeSidebar(page);
  const darkSurfaces = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return ['--surface-canvas', '--surface-base', '--surface-raised'].map((name) =>
      root.getPropertyValue(name).trim(),
    );
  });
  expect(new Set(darkSurfaces).size).toBe(3);
  await expectRegionsWithinViewport(page, ['.app-header', '.dashboard-main']);
  expect(pageErrors).toEqual([]);
});

test('UX-305 empty states explain recovery for vocabulary and grammar filters', async ({ page }) => {
  const pageErrors = await openReadyApp(page);
  await page.evaluate(() => window.StudyStorage.clearAll());

  await revealControl(page.locator('.cc-tab-fav'));
  await page.locator('.cc-tab-fav').click();
  await expect(page.locator('.cc-empty-state')).toBeVisible();
  await expect(page.locator('.cc-empty-state')).toContainText('还没有收藏词');
  await revealControl(page.locator('.cc-empty-state [data-state-action="clear-favorites"]'));
  await page.locator('.cc-empty-state [data-state-action="clear-favorites"]').click();
  await expect(page.locator('.cc-card').first()).toBeVisible();

  await revealControl(page.locator('#searchInput'));
  await page.locator('#searchInput').fill('__ux305_no_match__');
  await revealControl(page.locator('#searchInput'));
  await page.locator('#searchInput').press('Enter');
  await expect(page.locator('.cc-empty-state')).toContainText('当前筛选没有词条');
  await revealControl(page.locator('.cc-empty-state [data-state-action="reset-vocab-filters"]'));
  await page.locator('.cc-empty-state [data-state-action="reset-vocab-filters"]').click();
  await expect(page.locator('.cc-card').first()).toBeVisible();

  await revealControl(page.locator('#viewModeSelect'));
  await page.locator('#viewModeSelect').selectOption('study');
  await page.evaluate(() => {
    window.appConfig.studyMode.subView = 'favorites';
    window.appConfig.studyMode.render();
  });
  await expect(page.locator('.study-empty-state')).toContainText('还没有收藏词');
  await revealControl(page.locator('.study-empty-state [data-state-action="back-from-empty-subview"]'));
  await page.locator('.study-empty-state [data-state-action="back-from-empty-subview"]').click();
  await expect(page.locator('#btnStartStudy')).toBeVisible();

  await page.locator('#modBtnGrammar').click();
  await expect(page.locator('.gm-card').first()).toBeVisible();
  await revealControl(page.locator('#gmSearch'));
  await page.locator('#gmSearch').fill('__ux305_no_match__');
  await expect(page.locator('.gm-empty-state')).toContainText('当前筛选没有语法点');
  await revealControl(page.locator('.gm-empty-state [data-state-action="reset-grammar-filters"]'));
  await page.locator('.gm-empty-state [data-state-action="reset-grammar-filters"]').click();
  await expect(page.locator('.gm-card').first()).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('UX-305 data failures expose a retry path and recover', async ({ page }) => {
  await page.route('**/data/vocab_chunks/**', async (route) => {
    await route.fulfill({ status: 503, body: '' });
  });
  await page.route('**/data/generated_*', async (route) => {
    await route.fulfill({ status: 503, body: '' });
  });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#dashboardMain .state-view--error')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('#dashboardMain .state-view-details')).not.toHaveAttribute('open', '');
  await expect(page.locator('#dashboardMain .state-view--error')).toContainText('重试加载');

  await page.unroute('**/data/vocab_chunks/**');
  await page.unroute('**/data/generated_*');
  await page.locator('#dashboardMain [data-state-action="retry-app"]').click();
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 45_000 });
  await expect(page.locator('#statusTotal')).not.toHaveText('0');
  await expect(page.locator('#dashboardMain .state-view--error')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test('UX-305 lazy module failures recover without leaking raw error strings', async ({ page }) => {
  await page.route('**/data/grammar_index.json*', async (route) => {
    await route.fulfill({ status: 503, body: '' });
  });
  await page.route('**/data/grammar_enriched_gemini_full_refined.json*', async (route) => {
    await route.fulfill({ status: 503, body: '' });
  });
  const pageErrors = await openReadyApp(page);
  await page.locator('#modBtnGrammar').click();
  await expect(page.locator('#grammarMain .state-view--error')).toBeVisible();
  await expect(page.locator('#grammarMain .state-view--error')).toContainText('重试语法');
  await expect(page.locator('#grammarMain .state-view-details')).not.toHaveAttribute('open', '');

  await page.unroute('**/data/grammar_index.json*');
  await page.unroute('**/data/grammar_enriched_gemini_full_refined.json*');
  await page.locator('#grammarMain [data-state-action="retry-grammar-module"]').click();
  await expect(page.locator('.gm-card').first()).toBeVisible();

  await page.route('**/data/textbook/book_chunks/XinBian1.json*', async (route) => {
    await route.fulfill({ status: 503, body: '' });
  });
  await page.locator('#modBtnLesson').click();
  await expect(page.locator('#tbReader .state-view--error')).toBeVisible();
  await expect(page.locator('#tbReader .state-view--error')).toContainText('重试课文');
  await expect(page.locator('#tbReader .state-view-details')).not.toHaveAttribute('open', '');
  await page.unroute('**/data/textbook/book_chunks/XinBian1.json*');
  await page.locator('#tbReader [data-state-action="retry-textbook"]').click();
  await expect(page.locator('.tb-lesson-directory')).not.toHaveAttribute('open', '');
  expect(pageErrors).toEqual([]);
});

test('UX-306 motion contract keeps feedback brief and honors reduced motion', async ({ page }) => {
  const pageErrors = await openReadyApp(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  const motion = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const sidebar = getComputedStyle(document.getElementById('sidebar'));
    const card = document.querySelector('.cc-card');
    card.classList.add('tts-reading');
    const reading = getComputedStyle(card);
    return {
      panel: root.getPropertyValue('--motion-panel-duration').trim(),
      feedback: root.getPropertyValue('--motion-feedback-duration').trim(),
      panelTransition: sidebar.transitionDuration,
      readingAnimation: reading.animationName,
      readingIterations: reading.animationIterationCount,
    };
  });
  expect(motion.panel).toBe('190ms');
  expect(motion.feedback).toBe('160ms');
  expect(motion.panelTransition).toBe('0.19s, 0.19s');
  expect(motion.readingAnimation).toBe('ttsReadingEnter');
  expect(motion.readingIterations).toBe('1');

  await openSettings(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('#appSettingsPanel')).toBeHidden();

  await revealControl(page.locator('#viewModeSelect'));
  await page.locator('#viewModeSelect').selectOption('study');
  await expect(page.locator('.study-setup')).toBeVisible();
  await revealControl(page.locator('#btnStartStudy'));
  await page.locator('#btnStartStudy').click();
  await expect(page.locator('.study-progress')).toBeVisible();
  const progressMotion = await page.locator('.study-progress-bar').evaluate((element) => {
    return getComputedStyle(element).transitionDuration;
  });
  expect(progressMotion).toBe('0.16s');

  await page.evaluate(() => {
    window.PanelLayout.expandDetail('vocab', document.querySelector('.study-card-view'));
  });
  await expect(page.locator('#detailPanel')).not.toHaveClass(/detail-panel-collapsed/);
  await page.locator('#detailPanelCollapseBtn').click();
  await expect(page.locator('#detailPanel')).toHaveClass(/detail-panel-collapsed/);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reduced = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const sidebar = getComputedStyle(document.getElementById('sidebar'));
    const progress = getComputedStyle(document.querySelector('.study-progress-bar'));
    return {
      panel: root.getPropertyValue('--motion-panel-duration').trim(),
      feedback: root.getPropertyValue('--motion-feedback-duration').trim(),
      panelTransition: sidebar.transitionDuration,
      progressTransition: progress.transitionDuration,
      scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
    };
  });
  expect(reduced.panel).toBe('1ms');
  expect(reduced.feedback).toBe('1ms');
  expect(reduced.panelTransition).toBe('0.001s');
  expect(reduced.progressTransition).toBe('0.001s');
  expect(reduced.scrollBehavior).toBe('auto');
  expect(pageErrors).toEqual([]);
});

test('sidebar widths persist while drawers and anchored details remain transient across reloads', async ({
  page,
}) => {
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page);
  const mainWidth = await page.locator('#vocabMain').evaluate((el) => el.offsetWidth);
  const card = page.locator('.cc-card-body').first();
  await card.click();
  await expect(page.locator('#detailPanel')).toHaveClass(/anchored-detail-open/);
  expect(await page.locator('#vocabMain').evaluate((el) => el.offsetWidth)).toBe(mainWidth);
  await page.locator('#detailPanelCollapseBtn').click();
  await expect(card).toBeFocused();
  await expect(page.locator('#resizeHandleVocab')).toBeHidden();
  const handle = page.locator('#resizeSidebarVocab');
  await revealControl(handle);
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + 3, box.y + 160);
  await page.mouse.down();
  await page.mouse.move(box.x + 35, box.y + 160, { steps: 5 });
  await page.mouse.up();
  const resized = await page.evaluate(() => window.PanelLayout.getState('vocab').sidebarWidth);
  expect(resized).toBeGreaterThan(288);
  expect(await page.locator('#vocabMain').evaluate((el) => el.offsetWidth)).toBe(mainWidth);
  await page.locator('#modBtnGrammar').click();
  await expect(page.locator('#statusBarShowBtn')).toHaveAttribute('aria-expanded', 'true');
  const grammarHandle = page.locator('#resizeSidebarGrammar');
  await revealControl(grammarHandle);
  await grammarHandle.focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect(grammarHandle).toHaveAttribute('aria-valuenow', '312');
  await page.reload();
  await expect(page.locator('#loading')).toHaveClass(/hidden/);
  await page.locator('#modBtnVocab').click();
  await expect(page.locator('#statusBarShowBtn')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#detailPanel')).toHaveClass(/detail-panel-collapsed/);
  expect(await page.evaluate(() => window.PanelLayout.getState('vocab').sidebarWidth)).toBe(resized);
  expect(await page.evaluate(() => window.PanelLayout.getState('grammar').sidebarWidth)).toBe(312);
  await revealControl(page.locator('#sidebar [data-panel-reset="vocab"]'));
  await page.locator('#sidebar [data-panel-reset="vocab"]').click();
  expect(await page.evaluate(() => window.PanelLayout.getState('vocab').sidebarWidth)).toBe(288);
  expect(pageErrors).toEqual([]);
});

test('compact panel constraints and header recovery keep every module usable', async ({ page }) => {
  await useIsolatedProgress(page);
  await page.addInitScript(() => {
    const wide = {
      sidebarWidth: 380,
      detailWidth: 520,
      sidebarCollapsed: false,
      detailCollapsed: false,
    };
    localStorage.setItem(
      'jp_learning_panel_layout_v1',
      JSON.stringify({ vocab: wide, grammar: wide, lesson: wide }),
    );
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  const pageErrors = await openReadyApp(page);

  await revealControl(page.locator('#sidebar'));
  const shell = await page.evaluate(() => ({
    sidebar: document.querySelector('#sidebar').getBoundingClientRect(),
    main: document.querySelector('#vocabMain').getBoundingClientRect(),
    detail: document.querySelector('#detailPanel').getBoundingClientRect(),
    detailVisibility: getComputedStyle(document.querySelector('#detailPanel')).visibility,
    canScrollX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }));
  expect(shell.sidebar.width).toBeGreaterThanOrEqual(220);
  expect(shell.main.width).toBeGreaterThanOrEqual(520);
  expect(shell.detailVisibility).toBe('hidden');
  expect(shell.canScrollX).toBe(false);

  const moduleButtons = ['#modBtnVocab', '#modBtnGrammar', '#modBtnLesson'];
  for (const selector of moduleButtons) {
    await page.locator(selector).click();
    await page.locator('#statusBarShowBtn').click();
    await expect(page.locator('#statusBarShowBtn')).toBeVisible();
    await page.locator('#statusBarShowBtn').click();
  }
  expect(pageErrors).toEqual([]);
});

test('vocabulary catalog keeps recognition content compact and secondary actions reachable', async ({
  page,
}) => {
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page);
  const firstCard = page.locator('.cc-card').first();
  await expect(firstCard).toBeVisible();
  await expect(firstCard.locator('.cc-index')).toHaveCount(0);
  await expect(firstCard.locator('.cc-word')).not.toBeEmpty();
  await expect(firstCard.locator('.cc-meaning')).not.toBeEmpty();
  await expect(firstCard.locator('.cc-example')).toHaveCount(1);
  await expect(firstCard.locator('.cc-card-extra')).toBeHidden();
  await expect(firstCard.locator('.cc-card-primary')).toHaveText(/学习此词/);
  await expect(firstCard.locator('.cc-meaning')).toHaveCSS('-webkit-line-clamp', '3');

  const firstMenuToggle = firstCard.locator('.cc-card-menu-toggle');
  await expect(firstMenuToggle).toHaveAttribute('aria-label', '更多操作');
  await firstMenuToggle.click();
  await expect(firstCard.locator('.cc-card-menu')).toBeVisible();
  await expect(firstCard.locator('.cc-card-menu [role="menuitem"]')).toHaveCount(2);
  await expect(firstCard.locator('.cc-card-menu [data-act="read-one"]')).toHaveText(/朗读此词/);
  await expect(firstCard.locator('.cc-card-menu [data-act="detail"]')).toHaveText(/查看详情/);
  await expect(firstCard.locator('.cc-card-menu [data-act="expand"]')).toHaveCount(0);
  await page.locator('.cc-card').nth(1).locator('.cc-card-menu-toggle').click();
  await expect(page.locator('.cc-card-menu.open')).toHaveCount(1);
  await expect(firstCard.locator('.cc-card-menu')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('.cc-card-menu.open')).toHaveCount(0);
  await firstCard.locator('.cc-meta-count').click();
  await expect(firstCard).toHaveClass(/cc-expanded/);
  await expect(firstCard.locator('.cc-card-extra')).toBeVisible();

  await firstCard.locator('.cc-fav').click();
  await expect(page.locator('.cc-card').first().locator('.cc-fav')).toHaveClass(/active/);
  await page.locator('.cc-card').first().locator('.cc-card-body').click();
  await expect(page.locator('#detailPanel')).not.toHaveClass(/detail-panel-collapsed/);
  await expect(page.locator('#detailContent')).not.toBeEmpty();
  expect(pageErrors).toEqual([]);
});

test('B13 vocabulary detail reads as a dictionary entry: identity, meanings, study actions, metadata, examples', async ({
  page,
}) => {
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page);
  await page.locator('.cc-card').first().locator('.cc-card-body').click();

  const detail = page.locator('#detailContent .vocab-detail');
  await expect(detail).toBeVisible();
  await expect(detail.locator('.vocab-detail-head h3')).not.toBeEmpty();
  await expect(detail.locator('.vocab-detail-reading')).not.toBeEmpty();
  await expect(detail.locator('h4').nth(0)).toHaveText('释义');
  await expect(detail.locator('h4').nth(1)).toHaveText('学习状态');
  await expect(detail.locator('.vocab-detail-head')).toContainText(/N[1-5]/);
  // Senses lead without field labels; only tag lines keep a short label.
  await expect(detail.locator('.vocab-detail-meaning .detail-item')).toHaveCount(0);
  await expect(detail.locator('h4').nth(2)).toHaveText('词语信息');
  await expect(detail.locator('h4').nth(3)).toContainText('例句');
  await expect(detail.locator('.vocab-detail-actions button')).toHaveCount(4);
  expect(await detail.locator('.vocab-detail-info-grid .detail-item').count()).toBeGreaterThanOrEqual(5);
  await expect(detail.locator('.vocab-detail-example').first()).toBeVisible();
  await expect(detail.locator('.vocab-detail-quality')).toHaveCount(0);
  await expect(detail.locator('.vocab-detail-head')).not.toContainText('ocr_repaired');

  const layout = await detail.evaluate((element) => {
    const head = element.querySelector('.vocab-detail-head').getBoundingClientRect();
    const study = element.querySelector('.vocab-detail-study').getBoundingClientRect();
    const meaning = element.querySelector('.vocab-detail-meaning').getBoundingClientRect();
    const infoItems = Array.from(element.querySelectorAll('.vocab-detail-info-grid .detail-item'));
    const firstInfo = infoItems[0].getBoundingClientRect();
    const secondInfo = infoItems[1].getBoundingClientRect();
    return {
      headToMeaning: meaning.top - head.bottom,
      meaningToStudy: study.top - meaning.bottom,
      infoColumnsAligned: Math.abs(firstInfo.top - secondInfo.top) < 2 && secondInfo.left > firstInfo.left,
    };
  });
  expect(layout.headToMeaning).toBeLessThanOrEqual(4);
  expect(layout.meaningToStudy).toBeLessThanOrEqual(15);
  expect(layout.infoColumnsAligned).toBe(true);

  await detail.locator('#detailBtnMarkUnknown').click();
  await expect(detail.locator('#detailBtnMarkUnknown')).toHaveAttribute('aria-pressed', 'true');
  await expect(detail.locator('.detail-status-badges')).toContainText('不会');
  await detail.locator('#detailBtnFavorite').click();
  await expect(detail.locator('#detailBtnFavorite')).toHaveAttribute('aria-pressed', 'true');
  await expect(detail.locator('.detail-status-badges')).toContainText('已收藏');
  expect(pageErrors).toEqual([]);
});

test('B12 shared details stay anchored, preserve content width, and restore keyboard focus', async ({
  page,
}) => {
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page);
  const anchor = page.locator('.cc-card-body').first();
  const mainWidth = await page.locator('#vocabMain').evaluate((element) => element.offsetWidth);

  await anchor.focus();
  await page.keyboard.press('Enter');
  const popup = page.locator('#detailPanel');
  await expect(popup).toHaveClass(/anchored-detail-open/);
  await expect(popup).toHaveAttribute('role', 'dialog');
  await expect(popup).toHaveAttribute('aria-modal', 'false');
  await expect(page.locator('#detailPanelCollapseBtn')).toBeFocused();
  expect(await page.locator('#vocabMain').evaluate((element) => element.offsetWidth)).toBe(mainWidth);

  await page.waitForTimeout(220);
  const initial = await page.evaluate(() => {
    const panel = document.querySelector('#detailPanel').getBoundingClientRect();
    const trigger = document.querySelector('.cc-card-body').getBoundingClientRect();
    return {
      panel: { left: panel.left, top: panel.top, right: panel.right, bottom: panel.bottom },
      triggerTop: trigger.top,
      placement: document.querySelector('#detailPanel').getAttribute('data-anchor-placement'),
      width: window.innerWidth,
      height: window.innerHeight,
    };
  });
  expect(['left', 'right', 'top', 'bottom']).toContain(initial.placement);
  expect(initial.panel.left).toBeGreaterThanOrEqual(0);
  expect(initial.panel.top).toBeGreaterThanOrEqual(0);
  expect(initial.panel.right).toBeLessThanOrEqual(initial.width + 1);
  expect(initial.panel.bottom).toBeLessThanOrEqual(initial.height + 1);

  await page.locator('#card-container').evaluate((element) => {
    element.scrollTop += 36;
    element.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(80);
  const moved = await page.evaluate(() => ({
    popupTop: document.querySelector('#detailPanel').getBoundingClientRect().top,
    triggerTop: document.querySelector('.cc-card-body').getBoundingClientRect().top,
  }));
  expect(moved.triggerTop).toBeLessThan(initial.triggerTop);
  expect(moved.popupTop).toBeLessThan(initial.panel.top);

  await page.keyboard.press('Escape');
  await expect(popup).toHaveClass(/detail-panel-collapsed/);
  await expect(popup).toBeHidden();
  await expect(anchor).toBeFocused();

  await anchor.click();
  await expect(popup).toBeVisible();
  await page.locator('#vocabMain').click({ position: { x: 6, y: 6 } });
  await expect(popup).toBeHidden();
  expect(
    await popup.evaluate((element) => ({ hidden: element.hidden, boxes: element.getClientRects().length })),
  ).toEqual({ hidden: true, boxes: 0 });

  await page.locator('#modBtnGrammar').click();
  const grammarAnchor = page.locator('.gm-card').first();
  const grammarWidth = await page.locator('#grammarMain').evaluate((element) => element.offsetWidth);
  await grammarAnchor.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#grammarDetailPanel')).toHaveClass(/anchored-detail-open/);
  await expect(page.locator('#grammarDetailCollapseBtn')).toBeFocused();
  expect(await page.locator('#grammarMain').evaluate((element) => element.offsetWidth)).toBe(grammarWidth);
  await page.keyboard.press('Escape');
  await expect(grammarAnchor).toBeFocused();
  expect(pageErrors).toEqual([]);
});

test('B12 textbook vocabulary follows application text and opens one-word floating details', async ({
  page,
}) => {
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page);
  await page.locator('#modBtnLesson').click();
  await openTextbookDirectory(page);
  await revealControl(page.locator('.tb-lesson-card').nth(5));
  await page.locator('.tb-lesson-card').nth(5).click();
  await expect(
    page.locator('.tb-reader-body .tb-section[data-tts-mode="reading:application"]'),
  ).toBeVisible();

  const sectionKinds = await page.locator('.tb-reader-body .tb-section').evaluateAll((sections) =>
    sections.map((section) => ({
      application: section.getAttribute('data-tts-mode') === 'reading:application',
      vocabulary: section.classList.contains('tb-reading-vocab-section'),
      grammar: section.classList.contains('tb-section-grammar'),
    })),
  );
  const applicationIndex = sectionKinds.findIndex((section) => section.application);
  const vocabularyIndex = sectionKinds.findIndex((section) => section.vocabulary);
  const grammarIndex = sectionKinds.findIndex((section) => section.grammar);
  expect(applicationIndex).toBeGreaterThanOrEqual(0);
  expect(vocabularyIndex).toBe(applicationIndex + 1);
  expect(grammarIndex).toBeGreaterThan(vocabularyIndex);

  const expectedCount = await page.evaluate(
    () => window.ModuleSwitcher.getTextbookModule().currentVocab.length,
  );
  await expect(page.locator('.tb-reading-vocab-row')).toHaveCount(expectedCount);
  await expect(
    page.locator('.tb-reading-vocab-section .tb-tts-btn[data-tts-mode="vocab-loop"]'),
  ).toBeVisible();

  const textbookWidth = await page.locator('#textbookMain').evaluate((element) => element.offsetWidth);
  const word = page.locator('.tb-reading-vocab-open').first();
  await revealControl(word);
  await word.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#textbookDetailPanel')).toHaveClass(/anchored-detail-open/);
  await expect(page.locator('#textbookDetailCollapseBtn')).toBeFocused();
  await expect(page.locator('.tb-vocab-popup-entry')).toBeVisible();
  await expect(page.locator('#textbookDetailPanel .tb-item-list')).toHaveCount(0);
  expect(await page.locator('#textbookMain').evaluate((element) => element.offsetWidth)).toBe(textbookWidth);
  await page.keyboard.press('Escape');
  await expect(word).toBeFocused();
  expect(pageErrors).toEqual([]);
});

test('vocabulary cards stay content-sized and keep all actions in the metadata row', async ({ page }) => {
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page);
  const firstCard = page.locator('.cc-card').first();

  const measureCard = () =>
    firstCard.evaluate((card) => {
      const cardBox = card.getBoundingClientRect();
      const favoriteBox = card.querySelector('.cc-fav').getBoundingClientRect();
      const actionBox = card.querySelector('.cc-card-actions').getBoundingClientRect();
      const stripe = getComputedStyle(card, '::before');
      return {
        cardHeight: cardBox.height,
        alignedActions: Math.abs(
          favoriteBox.top + favoriteBox.height / 2 - (actionBox.top + actionBox.height / 2),
        ),
        stripeContent: stripe.content,
      };
    });

  const normal = await measureCard();
  expect(normal.cardHeight).toBeLessThan(248);
  expect(normal.alignedActions).toBeLessThanOrEqual(1);
  expect(normal.stripeContent).toBe('none');
  await expect(firstCard.locator('.cc-level')).toHaveText('N1');
  await expect(firstCard.locator('.cc-level')).toBeVisible();
  await expect(firstCard.locator('.cc-card-foot')).toHaveCount(0);
  const bilingualCard = page.locator('.cc-card:has(.cc-example-zh)').first();
  await expect(bilingualCard.locator('.cc-meaning')).toBeVisible();
  await expect(bilingualCard.locator('.cc-example-zh')).toBeVisible();

  await revealControl(page.locator('#ccMeaningToggle'));
  await page.locator('#ccMeaningToggle').click();
  await expect(page.locator('.cc-wrapper')).toHaveClass(/cc-hide-meanings/);
  await expect(page.locator('#ccMeaningToggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(bilingualCard.locator('.cc-meaning')).toBeHidden();
  await expect(bilingualCard.locator('.cc-example-zh')).toBeHidden();

  const hidden = await measureCard();
  expect(hidden.cardHeight).toBeLessThanOrEqual(normal.cardHeight);
  expect(hidden.stripeContent).toBe('none');
  await expect(firstCard.locator('.cc-level')).toBeVisible();

  await revealControl(page.locator('#ccMeaningToggle'));
  await page.locator('#ccMeaningToggle').click();
  await expect(page.locator('.cc-wrapper')).not.toHaveClass(/cc-hide-meanings/);
  await expect(page.locator('#ccMeaningToggle')).toHaveAttribute('aria-pressed', 'false');
  await expect(bilingualCard.locator('.cc-meaning')).toBeVisible();
  await expect(bilingualCard.locator('.cc-example-zh')).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('JLPT chips update the shared filter and one-card study stays available', async ({ page }) => {
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page);
  const allCount = Number(await page.locator('#vocabPlanCount').textContent());
  await revealControl(page.locator('.vocab-filter-chip[data-vocab-level="N5"]'));
  await page.locator('.vocab-filter-chip[data-vocab-level="N5"]').click();
  await expect(page.locator('#levelSelect')).toHaveValue('N5');
  await expect(page.locator('.vocab-filter-chip[data-vocab-level="N5"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.cc-card').first()).toHaveAttribute('data-level', 'N5');
  const n5Count = Number(await page.locator('#vocabPlanCount').textContent());
  expect(n5Count).toBeGreaterThan(0);
  expect(n5Count).toBeLessThan(allCount);

  await revealControl(page.locator('#resetFiltersBtn'));
  await page.locator('#resetFiltersBtn').click();
  await expect(page.locator('.vocab-filter-chip[data-vocab-level=""]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await revealControl(page.locator('.cc-card').first().locator('.cc-card-primary'));
  await page.locator('.cc-card').first().locator('.cc-card-primary').click();
  await expect(page.locator('.practice-card')).toBeVisible();
  await expect(page.locator('#statusStudyQueue')).toHaveText('1');
  await page.locator('[data-study-exit]').click();
  await expect(page.locator('.cc-card').first()).toBeVisible();
  await expect(page.locator('#statusStudyQueue')).toHaveText('0');
  expect(pageErrors).toEqual([]);
});

test('vocabulary catalog exposes compact complete recognition cards above the fold', async ({ page }) => {
  await useIsolatedProgress(page);
  await openReadyApp(page);
  for (const viewport of [
    { width: 1600, height: 900, minimumCards: 6 },
    { width: 1280, height: 720, minimumCards: 4 },
  ]) {
    await page.setViewportSize(viewport);
    const fullyVisibleCards = await page.evaluate(() => {
      const toolbarBottom = document.querySelector('#vocabMain').getBoundingClientRect().top;
      const mainBottom = document.querySelector('#vocabMain').getBoundingClientRect().bottom;
      return Array.from(document.querySelectorAll('.cc-card')).filter((card) => {
        const rect = card.getBoundingClientRect();
        return rect.top >= toolbarBottom - 1 && rect.bottom <= mainBottom + 1;
      }).length;
    });
    expect(fullyVisibleCards).toBeGreaterThanOrEqual(viewport.minimumCards);
    expect(fullyVisibleCards).toBeLessThanOrEqual(12);
  }
});

test('B04 vocabulary cards follow the content pane and allow long content to grow', async ({ page }) => {
  await useIsolatedProgress(page);
  await page.setViewportSize({ width: 1600, height: 900 });
  const pageErrors = await openReadyApp(page);

  const measureCatalog = () =>
    page.evaluate(() => {
      const grid = document.querySelector('.cc-grid');
      const cards = Array.from(grid.querySelectorAll('.cc-card')).slice(0, 8);
      const boxes = cards.map((card) => card.getBoundingClientRect());
      const firstTop = boxes[0].top;
      return {
        columns: getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length,
        firstRow: boxes.filter((box) => Math.abs(box.top - firstTop) <= 2).length,
        minWidth: Math.min(...boxes.map((box) => box.width)),
        maxWidth: Math.max(...boxes.map((box) => box.width)),
        maxRight: Math.max(...boxes.map((box) => box.right)),
        hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });

  let metrics = await measureCatalog();
  expect(metrics.columns).toBe(3);
  expect(metrics.firstRow).toBe(3);
  expect(metrics.minWidth).toBeGreaterThanOrEqual(260);
  // UI-ART-12: three equal columns fit the shared 1240px catalog limit.
  expect(metrics.maxWidth - metrics.minWidth).toBeLessThanOrEqual(1);
  expect(metrics.maxWidth).toBeLessThanOrEqual(1240 / 3);

  await page.locator('.cc-card-body').first().click();
  await expect(page.locator('#detailPanel')).not.toHaveClass(/detail-panel-collapsed/);
  await page.waitForTimeout(220);
  metrics = await measureCatalog();
  expect(metrics.columns).toBe(3);
  expect(metrics.firstRow).toBe(3);
  expect(metrics.maxWidth - metrics.minWidth).toBeLessThanOrEqual(1);
  expect(metrics.maxWidth).toBeLessThanOrEqual(1240 / 3);
  await page.locator('#detailPanelCollapseBtn').click();
  await page.waitForTimeout(220);

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(() => window.AppDisplayScale.refresh());
  metrics = await measureCatalog();
  expect(metrics.columns).toBe(3);
  expect(metrics.firstRow).toBe(3);
  expect(metrics.maxWidth - metrics.minWidth).toBeLessThanOrEqual(1);
  expect(metrics.maxWidth).toBeLessThanOrEqual(1240 / 3);

  await page.setViewportSize({ width: 1024, height: 700 });
  await page.evaluate(() => window.AppDisplayScale.refresh());
  await expect(page.locator('html')).toHaveAttribute('data-layout-viewport', 'tablet');
  metrics = await measureCatalog();
  expect(metrics.columns).toBe(2);
  expect(metrics.firstRow).toBe(2);
  expect(metrics.minWidth).toBeGreaterThanOrEqual(240);
  expect(metrics.maxWidth).toBeLessThanOrEqual(420);
  expect(metrics.maxRight).toBeLessThanOrEqual(1025);
  expect(metrics.hasHorizontalOverflow).toBe(false);

  await page.setViewportSize({ width: 1280, height: 720 });
  await openSettings(page);
  await page.locator('#appScaleSelect').selectOption('1.5');
  await page.keyboard.press('Escape');
  await closeSidebar(page);
  await expect(page.locator('html')).toHaveAttribute('data-layout-viewport', 'tablet');
  metrics = await measureCatalog();
  expect(metrics.columns).toBe(2);
  expect(metrics.firstRow).toBe(2);
  expect(metrics.maxRight).toBeLessThanOrEqual(1281);
  expect(metrics.hasHorizontalOverflow).toBe(false);

  await openSidebar(page);
  await page.locator('#appSettingsToggle').focus();
  await page.keyboard.press('Enter');
  await page.locator('#appScaleSelect').selectOption('1');
  await page.keyboard.press('Escape');
  await closeSidebar(page);
  const firstCard = page.locator('.cc-card').first();
  const baseHeight = await firstCard.evaluate((card) => card.getBoundingClientRect().height);
  await firstCard.evaluate((card) => {
    const word = card.querySelector('.cc-word');
    const meaning = card.querySelector('.cc-meaning');
    const example = card.querySelector('.cc-example');
    const exampleJa = card.querySelector('.cc-example-ja');
    word.textContent = '国際文化交流研究発表準備委員会連絡事項';
    meaning.textContent = '用于验证较长词形与较长释义同时出现时，词卡能够随内容自然增加高度。';
    exampleJa.textContent =
      '例：長い内容でも本文と操作欄が重ならず、必要な高さを保ったまま読み進められることを確認する。';
    word.style.display = 'block';
    word.style.webkitLineClamp = 'unset';
    meaning.style.display = 'block';
    meaning.style.webkitLineClamp = 'unset';
    meaning.style.maxHeight = 'none';
    example.style.maxHeight = 'none';
    exampleJa.style.display = 'block';
    exampleJa.style.webkitLineClamp = 'unset';
  });
  const longContent = await firstCard.evaluate((card) => {
    const cardBox = card.getBoundingClientRect();
    const bodyBox = card.querySelector('.cc-card-body').getBoundingClientRect();
    return { height: cardBox.height, bodyBottom: bodyBox.bottom, cardBottom: cardBox.bottom };
  });
  expect(longContent.height).toBeGreaterThan(baseHeight + 20);
  expect(longContent.bodyBottom).toBeLessThanOrEqual(longContent.cardBottom + 1);
  expect(pageErrors).toEqual([]);
});

test('primary module regions fit at desktop and compact widths', async ({ page }) => {
  await openReadyApp(page);
  for (const viewport of [
    { width: 1600, height: 900 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    const metrics = await page.evaluate(() => {
      const root = document.documentElement;
      return {
        scrollWidth: root.scrollWidth,
        clientWidth: root.clientWidth,
        scrollHeight: root.scrollHeight,
        clientHeight: root.clientHeight,
      };
    });
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
    expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight);

    await expectRegionsWithinViewport(page, ['#statusBar', '#sidebar', '#vocabMain']);

    await page.locator('#modBtnGrammar').click();
    await expect(page.locator('.gm-card').first()).toBeVisible();
    await expectRegionsWithinViewport(page, ['#statusBar', '#grammarSidebar', '#grammarMain']);

    await page.locator('#modBtnLesson').click();
    await expect(page.locator('.tb-lesson-directory')).not.toHaveAttribute('open', '');
    await expectRegionsWithinViewport(page, ['#statusBar', '#textbookSidebar', '#textbookMain']);

    await page.locator('#modBtnVocab').click();
  }
});

test('a three-item learning path reaches completion and returns to today', async ({ page }) => {
  const pageErrors = await openReadyApp(page);
  await revealControl(page.locator('#viewModeSelect'));
  await page.locator('#viewModeSelect').selectOption('list');

  const checks = page.locator('.row-check');
  await revealControl(checks);
  for (let index = 0; index < 3; index += 1) await checks.nth(index).check();
  await expect(page.locator('#btnBatchStudy')).toBeEnabled();
  await revealControl(page.locator('#btnBatchStudy'));
  await page.locator('#btnBatchStudy').click();

  await expect(page.locator('.study-feedback [data-fb]')).toHaveCount(4);
  await expect(page.locator('.study-feedback [data-fb="favorite"]')).toHaveCount(0);
  const favoriteAction = page.locator('.study-nav-btns [data-fb="favorite"]');
  await expect(favoriteAction).toBeVisible();
  await favoriteAction.click();
  await expect(favoriteAction).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.study-stats-row span').first()).toContainText('1 /');

  for (const feedback of ['known', 'fuzzy', 'unknown']) {
    await expect(page.locator('.study-card-view')).toBeVisible();
    await page.locator('#flashcard').click();
    await expect(page.locator('#flashcard')).toHaveClass(/flipped/);
    await page.locator(`[data-fb="${feedback}"]`).click();
  }

  await expect(page.locator('.study-complete')).toBeVisible();
  await expect(page.locator('.study-result-overview')).toContainText('3');
  await page.locator('#btnBackToSetup').click();
  await expectOnlyModuleVisible(page, 'dashboard');
  await expect(page.locator('.dashboard-recent-item').first()).toContainText('完成 3 词');
  expect(pageErrors).toEqual([]);
});

test('card batch action starts a study session through the public boundary', async ({ page }) => {
  const pageErrors = await openReadyApp(page);
  await revealControl(page.locator('#ccBatchToggle'));
  await page.locator('#ccBatchToggle').click();
  await revealControl(page.locator('[data-batch="study-page"]'));
  await page.locator('[data-batch="study-page"]').click();
  await expect(page.locator('#study-container')).toBeVisible();
  await expect(page.locator('.study-card-view')).toBeVisible();
  await expect(page.locator('#statusStudyQueue')).not.toHaveText('0');
  await expect(page.locator('.study-stats-row span').first()).toContainText('1 /');
  await revealControl(page.locator('[data-practice-action="skip"]'));
  await page.locator('[data-practice-action="skip"]').click();
  await expect(page.locator('.study-stats-row span').first()).toContainText('2 /');
  expect(pageErrors).toEqual([]);
});

test('vocabulary catalog exposes one primary action and starts twenty words', async ({ page }) => {
  const pageErrors = await openReadyApp(page);
  await expect(page.locator('.cc-controls .btn-primary')).toHaveCount(1);
  await expect(page.locator('#ccStartStudy')).toHaveText(/开始学习/);
  await revealControl(page.locator('#ccStartStudy'));
  await page.locator('#ccStartStudy').click();
  await expect(page.locator('.study-card-view')).toBeVisible();
  await expect(page.locator('#statusStudyQueue')).toHaveText('20');
  expect(pageErrors).toEqual([]);
});

test('study completion actions review errors and continue with the next group', async ({ page }) => {
  const pageErrors = await openReadyApp(page);
  await page.evaluate(() => window.StudyStorage.clearAll());
  await revealControl(page.locator('#viewModeSelect'));
  await page.locator('#viewModeSelect').selectOption('list');
  const checks = page.locator('.row-check');
  await revealControl(checks.nth(0));
  await checks.nth(0).check();
  await checks.nth(1).check();
  await page.locator('#btnBatchStudy').click();

  for (const feedback of ['known', 'unknown']) {
    await page.locator('#flashcard').click();
    await page.locator(`[data-fb="${feedback}"]`).click();
  }
  await expect(page.locator('.study-complete-actions .btn-primary')).toHaveCount(1);
  await expect(page.locator('#btnStudyAgain')).toHaveText(/继续下一组/);
  await expect(page.locator('#btnReviewErrors')).toHaveText(/复习本次错项/);
  await page.locator('#btnReviewErrors').click();
  await expect(page.locator('.study-card-view')).toBeVisible();
  await expect(page.locator('#statusStudyQueue')).toHaveText('1');

  await page.locator('#flashcard').click();
  await page.locator('[data-fb="known"]').click();
  await expect(page.locator('.study-complete')).toBeVisible();
  await page.locator('#btnStudyAgain').click();
  await expect(page.locator('.study-card-view')).toBeVisible();
  await expect(page.locator('#statusStudyQueue')).toHaveText('1');
  expect(pageErrors).toEqual([]);
});

test('list selection starts a study session without leaking view state', async ({ page }) => {
  const pageErrors = await openReadyApp(page);
  await revealControl(page.locator('#viewModeSelect'));
  await page.locator('#viewModeSelect').selectOption('list');
  await revealControl(page.locator('.row-check').first());
  await page.locator('.row-check').first().check();
  await expect(page.locator('#btnBatchStudy')).toBeEnabled();
  await page.locator('#btnBatchStudy').click();
  await expect(page.locator('#study-container')).toBeVisible();
  await expect(page.locator('.study-card-view')).toBeVisible();
  await expect(page.locator('#statusStudyQueue')).toHaveText('1');
  expect(pageErrors).toEqual([]);
});

test('compatibility graph renderer works without a CDN Cytoscape request', async ({ page }) => {
  let blockedCdnRequests = 0;
  await page.route('**/*cdnjs*', async (route) => {
    blockedCdnRequests += 1;
    await route.abort();
  });
  const pageErrors = await openReadyApp(page);
  await page.evaluate(() => {
    window.ViewMode.set('graph');
    window.appConfig.applyFilters();
  });
  await expect(page.locator('#graph-container')).toBeVisible();
  await expect(page.locator('#nodeCount')).not.toHaveText('0');
  await expect(page.locator('#graph-container canvas').first()).toBeVisible();
  expect(blockedCdnRequests).toBe(0);
  expect(pageErrors).toEqual([]);
});

test('DEV-LOG-01 graph keeps its gentle wheel zoom without a Cytoscape warning', async ({ page }) => {
  const warnings = [];
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') warnings.push(message.text());
  });
  const pageErrors = await openReadyApp(page);
  await page.evaluate(() => {
    window.ViewMode.set('graph');
    window.appConfig.applyFilters();
  });
  await expect(page.locator('#graph-container canvas').first()).toBeVisible();
  const box = await page.locator('#graph-container').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const zoom = () => page.evaluate(() => window.graphBuilder.cy.zoom());
  // Let the animated layout finish fitting the graph first.
  await expect
    .poll(async () => {
      const start = await zoom();
      await page.waitForTimeout(300);
      return (await zoom()) === start;
    })
    .toBe(true);
  const before = await zoom();
  await page.mouse.wheel(0, 100);
  // One 100px wheel step zooms out by 10^(-0.4 × 0.15) ≈ 0.87, not Cytoscape's default 0.4.
  await expect.poll(async () => (await zoom()) / before).toBeCloseTo(0.871, 2);
  expect(warnings.filter((text) => /wheel sensitivity/i.test(text))).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('grammar cards open details and preserve favorite filtering behavior', async ({ page }) => {
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page);
  await page.locator('#modBtnGrammar').click();

  const firstCard = page.locator('.gm-card').first();
  const uid = await firstCard.getAttribute('data-uid');
  await firstCard.click();
  await expect(page.locator('#grammarDetailPanel')).not.toHaveClass(/detail-panel-collapsed/);
  await expect(page.locator('#gmDetailContent')).not.toBeEmpty();
  await expect(page.locator('#gmDetailContent .btn-primary')).toHaveCount(1);
  await page.locator('#gmStartPractice').click();
  await expect(page.locator('.gm-detail-section > summary').filter({ hasText: '练习' })).toBeFocused();

  const favoriteButton = page.locator(`.gm-card-fav[data-grammar-fav="${uid}"]`);
  await favoriteButton.click();
  await expect(favoriteButton).toHaveClass(/active/);
  await revealControl(page.locator('.gm-tab-fav'));
  await page.locator('.gm-tab-fav').click();
  await expect(page.locator(`.gm-card[data-uid="${uid}"]`)).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('grammar cards and details follow the learning-first reading hierarchy', async ({ page }) => {
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page);
  await page.locator('#modBtnGrammar').click();

  const cards = page.locator('.gm-card');
  const firstCard = cards.first();
  await expect(page.locator('.gm-sidebar-guide')).toContainText('在当前位置查看详情');
  await expect(page.locator('.gm-sidebar-guide')).not.toContainText('右侧显示详细信息');
  await expect(firstCard.locator('.gm-card-title')).toBeVisible();
  await expect(firstCard.locator('.gm-card-meaning')).toBeVisible();
  await expect(firstCard.locator('.gm-card-connection')).toBeVisible();
  await expect(firstCard.locator('.gm-card-tags .gm-card-tag')).toHaveCount(1);
  await expect(firstCard.locator('.gm-card-tag')).toHaveText('前提条件');
  await expect(firstCard.locator('.gm-card-tag-more')).toHaveCount(0);
  await expect(firstCard.locator('.gm-card-lesson-badge')).toHaveCount(0);
  const grammarLabels = await page.locator('.gm-card-tag:not(.gm-card-tag-more)').allTextContents();
  expect(grammarLabels.every((label) => !/[a-z_]/.test(label))).toBe(true);
  await expect(page.locator('#gmFuncGroup option[value="evaluation"]')).toHaveText('评价');
  const grammarTitleType = await firstCard.locator('.gm-card-title').evaluate((element) => ({
    lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
    fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
  }));
  expect(grammarTitleType.lineHeight / grammarTitleType.fontSize).toBeGreaterThanOrEqual(1.4);

  const cardHeights = await cards.evaluateAll((nodes) =>
    nodes.slice(0, 12).map((node) => Math.round(node.getBoundingClientRect().height)),
  );
  expect(Math.max(...cardHeights) - Math.min(...cardHeights)).toBeLessThanOrEqual(1);

  await firstCard.focus();
  await page.keyboard.press('Enter');
  await expect(firstCard).toHaveClass(/gm-card-selected/);
  await expect(page.locator('.gm-detail-outline')).toBeVisible();
  await expect(page.locator('.gm-detail-section')).toHaveCount(9);
  const sectionIds = await page
    .locator('.gm-detail-section')
    .evaluateAll((nodes) => nodes.slice(0, 6).map((node) => node.id));
  expect(sectionIds).toEqual([
    'gm-section-summary',
    'gm-section-connection',
    'gm-section-examples',
    'gm-section-confusable',
    'gm-section-errors',
    'gm-section-practice',
  ]);

  const firstExample = page.locator('#gm-section-examples .gm-ex-card').first();
  await expect(firstExample).toBeVisible();
  const detailViewport = page.locator('#gmDetailContent');
  const [exampleBox, viewportBox] = await Promise.all([
    firstExample.boundingBox(),
    detailViewport.boundingBox(),
  ]);
  expect(exampleBox.y).toBeLessThan(viewportBox.y + viewportBox.height);

  await page.locator('.gm-detail-nav-btn[data-section-target="gm-section-practice"]').click();
  await expect(page.locator('#gm-section-practice > summary')).toBeFocused();
  await expect(page.locator('.gm-detail-nav-btn[data-section-target="gm-section-practice"]')).toHaveClass(
    /active/,
  );
  await expect(page.locator('.gm-lesson-link-btn').first()).toHaveClass(/btn-secondary/);
  expect(pageErrors).toEqual([]);
});

test('B18 auxiliary lesson centers continuous reading with section navigation and keyboard grammar marks', async ({
  page,
}) => {
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page);
  await page.locator('#modBtnGrammar').click();
  await revealControl(page.locator('#gmSideNavLesson'));
  await page.locator('#gmSideNavLesson').click();
  await expect(page.locator('.gm-lesson-card').first()).toBeVisible();
  await revealControl(page.locator('.gm-lesson-card').first());
  await page.locator('.gm-lesson-card').first().click();

  const reader = page.locator('#gmLessonReader');
  const article = reader.locator('.gm-reader-article');
  const targets = reader.locator('#gmReaderTargets');
  await expect(article).toBeVisible();
  await expect(targets).not.toHaveAttribute('open', '');
  await expect(reader.locator('#gmReaderReadingHeading')).toHaveText('正文阅读');
  await expect(reader.locator('.gm-para-pair').first()).toBeVisible();

  const readingLayout = await reader.evaluate((element) => {
    const readerBox = element.getBoundingClientRect();
    const articleBox = element.querySelector('.gm-reader-article').getBoundingClientRect();
    const firstPair = element.querySelector('.gm-para-pair').getBoundingClientRect();
    const secondPair = element.querySelectorAll('.gm-para-pair')[1].getBoundingClientRect();
    return {
      articleWidth: articleBox.width,
      leftInset: articleBox.left - readerBox.left,
      rightInset: readerBox.right - articleBox.right,
      paragraphGap: secondPair.top - firstPair.bottom,
      paragraphShadow: getComputedStyle(element.querySelector('.gm-para-pair')).boxShadow,
    };
  });
  expect(readingLayout.articleWidth).toBeLessThanOrEqual(862);
  expect(Math.abs(readingLayout.leftInset - readingLayout.rightInset)).toBeLessThanOrEqual(2);
  expect(Math.abs(readingLayout.paragraphGap)).toBeLessThanOrEqual(1);
  expect(readingLayout.paragraphShadow).toBe('none');

  await reader.locator('[data-reader-target="gmReaderTargets"]').click();
  await expect(targets).toHaveAttribute('open', '');
  await expect(targets.locator('summary')).toBeFocused();

  const firstMark = reader.locator('.gm-grammar-known').first();
  await expect(firstMark).toHaveJSProperty('tagName', 'BUTTON');
  await firstMark.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#grammarDetailPanel')).not.toHaveClass(/detail-panel-collapsed/);
  await expect(page.locator('#gmDetailContent')).not.toBeEmpty();

  await reader.locator('.gm-toggle-btn[data-mode="ja-only"]').click();
  await expect(reader.locator('.gm-toggle-btn[data-mode="ja-only"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(reader.locator('.gm-para-zh')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test('textbook reader changes among its original display modes', async ({ page }) => {
  const pageErrors = await openReadyApp(page);
  await page.locator('#modBtnLesson').click();
  await openTextbookDirectory(page);
  await revealControl(page.locator('.tb-lesson-card').first());
  await expect(page.locator('.tb-lesson-card').first()).toBeVisible();
  await revealControl(page.locator('.tb-lesson-card').first());
  await page.locator('.tb-lesson-card').first().click();
  await expect(page.locator('.tb-sidebar-reading-controls .btn-primary')).toHaveCount(1);
  await expect(page.locator('.tb-reader-header')).toHaveCount(0);
  await revealControl(page.locator('.tb-course-path-toggle'));
  await page.locator('.tb-course-path-toggle').click();
  await revealControl(page.locator('[data-course-action="step"][data-course-step="reading"]'));
  await page.locator('[data-course-action="step"][data-course-step="reading"]').click();
  await expect(page.locator('[data-course-action="step"][data-course-step="reading"]')).toBeFocused();

  const normal = page.locator('.tb-display-mode-btn[data-display-mode="normal"]');
  const plain = page.locator('.tb-display-mode-btn[data-display-mode="plain"]');
  await expect(normal).toHaveClass(/active/);
  await revealControl(plain);
  await plain.click();
  await expect(plain).toHaveClass(/active/);
  await expect(page.locator('#tbReader')).not.toBeEmpty();

  const chunks = page.locator('.tb-display-mode-btn[data-display-mode="chunks"]');
  if (await chunks.isEnabled()) {
    await revealControl(chunks);
    await chunks.click();
    await expect(chunks).toHaveClass(/active/);
    const firstChunk = page.locator('[data-text-chunk]').first();
    const secondChunk = page.locator('[data-text-chunk]').nth(1);
    await expect(firstChunk).toBeVisible();
    await expect(firstChunk).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(firstChunk).toHaveAttribute('aria-expanded', 'false');
    await expect(firstChunk).not.toHaveAttribute('title', /.+/);
    await revealControl(firstChunk);
    await firstChunk.hover();
    const chunkDetail = page.locator('#tbChunkDetail');
    await expect(chunkDetail).toBeVisible();
    await expect(firstChunk).toHaveAttribute('aria-expanded', 'true');
    await chunkDetail.hover();
    await page.waitForTimeout(180);
    await expect(chunkDetail).toBeVisible();
    await page.mouse.move(2, 2);
    await expect(chunkDetail).toBeHidden();

    const expectedFields = await firstChunk.evaluate((element) =>
      [
        element.getAttribute('data-chunk-role'),
        element.getAttribute('data-chunk-meaning'),
        element.getAttribute('data-chunk-grammar'),
      ].filter(Boolean),
    );
    await firstChunk.click();
    await expect(chunkDetail).toBeVisible();
    await expect(firstChunk).toHaveAttribute('aria-expanded', 'true');
    for (const field of expectedFields) await expect(chunkDetail).toContainText(field);
    expect(
      await page.evaluate(() => {
        const popup = document.querySelector('#tbChunkDetail').getBoundingClientRect();
        return (
          popup.left >= 0 &&
          popup.top >= 0 &&
          popup.right <= window.innerWidth + 1 &&
          popup.bottom <= window.innerHeight + 1
        );
      }),
    ).toBe(true);

    await secondChunk.click();
    await expect(firstChunk).toHaveAttribute('aria-expanded', 'false');
    await expect(secondChunk).toHaveAttribute('aria-expanded', 'true');
    await page.locator('.tb-section-head').first().click();
    await expect(chunkDetail).toBeHidden();

    await secondChunk.focus();
    await page.keyboard.press('Enter');
    await expect(chunkDetail).toBeVisible();
    await expect(chunkDetail.locator('.tb-chunk-detail-close')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(chunkDetail).toBeHidden();
    await expect(secondChunk).toBeFocused();
  }
  expect(pageErrors).toEqual([]);
});

// Focusing a chunk can scroll another one under an idle mouse; the browser then
// reports pointer crossings that must not take over a keyboard-opened detail.
test('keyboard-opened chunk detail ignores pointer crossings until Escape', async ({ page }) => {
  const pageErrors = await openReadyApp(page);
  await page.locator('#modBtnLesson').click();
  await openTextbookDirectory(page);
  await revealControl(page.locator('.tb-lesson-card').first());
  await page.locator('.tb-lesson-card').first().click();
  const chunksMode = page.locator('.tb-display-mode-btn[data-display-mode="chunks"]');
  await revealControl(chunksMode);
  await expect(chunksMode).toBeEnabled();
  await chunksMode.click();
  await expect(chunksMode).toHaveClass(/active/);

  const firstChunk = page.locator('[data-text-chunk]').first();
  const secondChunk = page.locator('[data-text-chunk]').nth(1);
  const chunkDetail = page.locator('#tbChunkDetail');
  await revealControl(secondChunk);
  await page.mouse.move(2, 2);
  await secondChunk.focus();
  await page.keyboard.press('Enter');
  await expect(chunkDetail.locator('.tb-chunk-detail-close')).toBeFocused();
  await expect(secondChunk).toHaveAttribute('aria-expanded', 'true');

  const point = await firstChunk.evaluate((element) => {
    const rect = element.getClientRects()[0];
    const x = rect.left + Math.min(8, rect.width / 2);
    const y = rect.top + rect.height / 2;
    return { x, y, hit: element.contains(document.elementFromPoint(x, y)) };
  });
  expect(point.hit).toBe(true);
  await page.mouse.move(point.x, point.y);
  await page.mouse.move(2, 2);
  await page.waitForTimeout(300);
  await expect(chunkDetail).toBeVisible();
  await expect(firstChunk).toHaveAttribute('aria-expanded', 'false');
  await expect(secondChunk).toHaveAttribute('aria-expanded', 'true');
  await expect(chunkDetail.locator('.tb-chunk-detail-close')).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(chunkDetail).toBeHidden();
  await expect(secondChunk).toBeFocused();
  expect(pageErrors).toEqual([]);
});

test('B22 textbook rail keeps a compact collapsible directory and owns reading controls', async ({
  page,
}) => {
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page);
  await page.locator('#modBtnLesson').click();

  const sidebar = page.locator('#textbookSidebar');
  const directory = sidebar.locator('.tb-lesson-directory');
  const directorySummary = directory.locator('summary');
  const readingTools = sidebar.locator('.tb-sidebar-reading-controls');
  await expect(directory).not.toHaveAttribute('open', '');
  await revealControl(readingTools.locator('.tb-sidebar-continue'));
  await expect(readingTools.locator('.tb-sidebar-continue')).toBeVisible();
  await expect(readingTools.locator('.tb-display-mode-btn')).toHaveCount(3);
  await expect(readingTools.locator('[data-course-path]')).toHaveCount(1);
  await expect(page.locator('#tbReader [data-course-path]')).toHaveCount(0);
  await expect(page.locator('.tb-reader-header')).toHaveCount(0);

  await directorySummary.click();
  const firstCardStyle = await sidebar
    .locator('.tb-lesson-card')
    .first()
    .evaluate((card) => {
      const box = card.getBoundingClientRect();
      const style = getComputedStyle(card);
      return { height: box.height, boxShadow: style.boxShadow, borderLeftWidth: style.borderLeftWidth };
    });
  expect(firstCardStyle.height).toBeLessThanOrEqual(78);
  expect(firstCardStyle.boxShadow).toBe('none');
  expect(firstCardStyle.borderLeftWidth).toBe('3px');

  await directorySummary.click();
  await expect(directory).not.toHaveAttribute('open', '');
  await expect(directory.locator('.tb-lesson-list')).toBeHidden();
  await directorySummary.click();
  await revealControl(directory.locator('.tb-lesson-card').first());
  await expect(directory.locator('.tb-lesson-card').first()).toBeVisible();

  const previousTitle = await readingTools.locator('.tb-sidebar-current-lesson strong').textContent();
  await revealControl(directory.locator('.tb-lesson-card').nth(1));
  await directory.locator('.tb-lesson-card').nth(1).click();
  await expect(readingTools.locator('.tb-sidebar-current-lesson strong')).not.toHaveText(previousTitle);
  await expect(directory.locator('.tb-lesson-card').nth(1)).toHaveAttribute('aria-current', 'page');
  await expect(directory.locator('.tb-lesson-card').first()).not.toHaveAttribute('aria-current', 'page');

  const plain = readingTools.locator('.tb-display-mode-btn[data-display-mode="plain"]');
  await revealControl(plain);
  await plain.click();
  await expect(plain).toHaveAttribute('aria-pressed', 'true');
  await expect(readingTools.locator('.tb-display-mode-btn[aria-pressed="true"]')).toHaveCount(1);

  await page.setViewportSize({ width: 1280, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expectRegionsWithinViewport(page, ['#textbookSidebar', '#textbookMain']);
  expect(pageErrors).toEqual([]);
});

test('B09 textbook course path stays compact in the sidebar and ignores reader scrolling', async ({
  page,
}) => {
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page);
  await page.locator('#modBtnLesson').click();
  await openTextbookDirectory(page);
  await revealControl(page.locator('.tb-lesson-card').first());
  await page.locator('.tb-lesson-card').first().click();

  const reader = page.locator('#tbReader');
  const path = page.locator('#textbookSidebar [data-course-path]');
  const toggle = path.locator('.tb-course-path-toggle');
  const body = path.locator('.tb-course-path-body');
  await expect(page.locator('#tbReader [data-course-path]')).toHaveCount(0);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(body).toBeHidden();
  await expect(path.locator('.tb-course-step')).toHaveCount(4);

  await revealControl(toggle);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(body).toBeVisible();

  await reader.evaluate((element) => {
    element.scrollTop = 240;
    element.dispatchEvent(new Event('scroll'));
  });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(path).not.toHaveClass(/is-collapsed/);
  await reader.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll'));
  });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(pageErrors).toEqual([]);
});

test('textbook reading keeps a visible entry, progress hierarchy, and scroll position', async ({ page }) => {
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.locator('#modBtnLesson').click();
  await openTextbookDirectory(page);

  const leadImage = page.locator('.tb-reader-lead-media .tb-section-image');
  const firstSection = page.locator('.tb-reader-body .tb-section').first();
  await expect(leadImage).toBeVisible();
  const [imageBox, sectionBox] = await Promise.all([leadImage.boundingBox(), firstSection.boundingBox()]);
  expect(imageBox.height).toBeGreaterThanOrEqual(175);
  expect(imageBox.height).toBeLessThanOrEqual(210);
  expect(sectionBox.y).toBeLessThan(720);
  await expect(page.locator('.tb-lesson-progress').first()).toHaveText('当前阅读');
  await revealControl(page.locator('.tb-lesson-progress').filter({ hasText: '待复习' }).first());
  await expect(page.locator('.tb-lesson-progress').filter({ hasText: '待复习' }).first()).toBeVisible();

  await revealControl(page.locator('.tb-lesson-card').nth(1));
  await page.locator('.tb-lesson-card').nth(1).click();
  await expect(page.locator('.tb-lesson-progress').first()).toHaveText('已读');
  await expect(page.locator('.tb-lesson-progress').nth(1)).toHaveText('当前阅读');

  const reader = page.locator('#tbReader');
  await reader.evaluate((element) => {
    element.scrollTop = 420;
  });
  const beforeSwitch = await reader.evaluate((element) => element.scrollTop);
  await revealControl(page.locator('.tb-display-mode-btn[data-display-mode="plain"]'));
  await page.locator('.tb-display-mode-btn[data-display-mode="plain"]').click();
  await expect(page.locator('.tb-display-mode-btn[data-display-mode="plain"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.tb-display-mode-btn[aria-pressed="true"]')).toHaveCount(1);
  expect(await reader.evaluate((element) => element.scrollTop)).toBe(beforeSwitch);
  expect(pageErrors).toEqual([]);
});

test('textbook highlights return to reading and audio exposes segment progress', async ({ page }) => {
  await useAudioFixtures(page);
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page);
  const audioUrls = await page.evaluate(async () => ({
    mainVocab: window.VocabTTS.getAudioUrl(1),
    textbookVocab: await window.TextbookLoader.getVocabAudioUrl(1),
    reading: await window.TextbookLoader.getReadingAudioUrl('XinBian1', 'lesson_02', 'body'),
    dialogue: await window.TextbookLoader.getDialogueAudioUrl('XinBian1', 'lesson_02', 'conversation'),
  }));
  expect(Object.values(audioUrls).every((url) => /\.ogg(?:\?|$)/.test(url))).toBe(true);
  await page.locator('#modBtnLesson').click();
  await openTextbookDirectory(page);
  await revealControl(page.locator('.tb-lesson-card').nth(1));
  await page.locator('.tb-lesson-card').nth(1).click();

  const highlight = page.locator('.tb-inline-highlight-link').first();
  await expect(highlight).toBeVisible();
  await revealControl(highlight);
  await highlight.click();
  await expect(page.locator('#textbookDetailPanel')).not.toHaveClass(/detail-panel-collapsed/);
  await expect(page.locator('.tb-vocab-popup-entry')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(highlight).toBeFocused();
  await expect(page.locator('#textbookDetailPanel')).toHaveClass(/detail-panel-collapsed/);

  const readingButton = page.locator('.tb-tts-btn[data-tts-mode="reading:body"]');
  await expect(page.locator('.tb-tts-progress[data-tts-progress="reading:body"]')).toBeHidden();
  await readingButton.click();
  await expect(readingButton).toHaveClass(/is-playing/, { timeout: 10_000 });
  await expect(page.locator('.tb-tts-status[data-tts-status="reading:body"]')).toContainText('第');
  await expect(page.locator('.tb-tts-progress[data-tts-progress="reading:body"]')).toHaveClass(/is-active/);
  await expect(page.locator('.tb-tts-progress[data-tts-progress="reading:body"]')).toBeVisible();
  await expect(page.locator('.tb-tts-progress[data-tts-progress="reading:body"]')).not.toHaveAttribute(
    'aria-valuenow',
    '0',
  );
  await revealControl(page.locator('.tb-lesson-card').nth(2));
  await page.locator('.tb-lesson-card').nth(2).click();
  await expect(page.locator('.tb-tts-btn.is-playing')).toHaveCount(0);
  await expect(page.locator('.tb-tts-progress.is-active')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test('B19 textbook uses one continuous reading paper with integrated tools and detail rows', async ({
  page,
}) => {
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.locator('#modBtnLesson').click();
  await openTextbookDirectory(page);
  const lesson = page.locator('.tb-lesson-card').nth(1);
  await revealControl(lesson);
  await lesson.click();
  await expect(lesson).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.tb-reader-body .tb-section').nth(1)).toBeVisible();

  const readingStyle = await page.evaluate(() => {
    const body = document.querySelector('.tb-reader-body');
    const sections = body.querySelectorAll('.tb-section');
    const paragraph = document.querySelector('.tb-paragraph');
    const paragraphStyle = getComputedStyle(paragraph);
    const image = document.querySelector('.tb-reader-lead-media .tb-section-image');
    const path = document.querySelector('.tb-course-path');
    const step = document.querySelector('.tb-course-step');
    const tts = document.querySelector('.tb-section .tb-tts-btn');
    const dialogue = document.querySelector('.tb-dialogue-turn');
    return {
      bodyBackground: getComputedStyle(body).backgroundColor,
      sectionBackground: getComputedStyle(sections[0]).backgroundColor,
      sectionBorder: getComputedStyle(sections[0]).borderTopWidth,
      sectionShadow: getComputedStyle(sections[0]).boxShadow,
      nextSectionBorder: getComputedStyle(sections[1]).borderTopWidth,
      pathRadius: getComputedStyle(path).borderRadius,
      pathShadow: getComputedStyle(path).boxShadow,
      stepRadius: getComputedStyle(step).borderRadius,
      imageHeight: image.getBoundingClientRect().height,
      paragraphRatio: parseFloat(paragraphStyle.lineHeight) / parseFloat(paragraphStyle.fontSize),
      ttsRadius: getComputedStyle(tts).borderRadius,
      ttsShadow: getComputedStyle(tts).boxShadow,
      dialogueRadius: getComputedStyle(dialogue).borderRadius,
      dialogueBackground: getComputedStyle(dialogue).backgroundColor,
    };
  });
  expect(readingStyle.bodyBackground).not.toBe('rgba(0, 0, 0, 0)');
  expect(readingStyle.sectionBackground).toBe('rgba(0, 0, 0, 0)');
  expect(readingStyle.sectionBorder).toBe('0px');
  expect(readingStyle.sectionShadow).toBe('none');
  expect(readingStyle.nextSectionBorder).toBe('1px');
  expect(readingStyle.pathRadius).toBe('0px');
  expect(readingStyle.pathShadow).toBe('none');
  expect(readingStyle.stepRadius).toBe('0px');
  expect(readingStyle.imageHeight).toBeGreaterThanOrEqual(175);
  expect(readingStyle.imageHeight).toBeLessThanOrEqual(210);
  expect(readingStyle.paragraphRatio).toBeGreaterThanOrEqual(2);
  expect(readingStyle.ttsRadius).toBe('6px');
  expect(readingStyle.ttsShadow).toBe('none');
  expect(readingStyle.dialogueRadius).toBe('0px');
  expect(readingStyle.dialogueBackground).toBe('rgba(0, 0, 0, 0)');

  const highlight = page.locator('.tb-inline-highlight-link').first();
  await revealControl(highlight);
  await highlight.click();
  await expect(page.locator('#textbookDetailPanel')).not.toHaveClass(/detail-panel-collapsed/);
  await expect(page.locator('.tb-vocab-popup-entry')).toBeVisible();
  const focusedItem = page.locator('.tb-reading-vocab-row.tb-item-focus');
  await expect(focusedItem).toHaveCount(1);
  await expect(page.locator('.tb-reading-vocab-section .tb-item-start-loop-btn').first()).toHaveText(
    /从此朗读/,
  );
  await expect(page.locator('.tb-reading-vocab-section .tb-item-start-loop-btn').first()).toHaveAttribute(
    'aria-label',
    '从这个词开始顺序朗读',
  );
  await page.waitForTimeout(220);
  const detailStyle = await focusedItem.evaluate((item) => {
    const itemStyle = getComputedStyle(item);
    const popupStyle = getComputedStyle(document.querySelector('#textbookDetailPanel'));
    return {
      radius: itemStyle.borderRadius,
      shadow: itemStyle.boxShadow,
      borderBottom: itemStyle.borderBottomWidth,
      popupPosition: popupStyle.position,
    };
  });
  expect(detailStyle).toEqual({
    radius: '0px',
    shadow: 'rgb(43, 76, 126) 3px 0px 0px 0px inset',
    borderBottom: '1px',
    popupPosition: 'fixed',
  });

  await openSettings(page);
  await page.locator('#appThemeSelect').selectOption('dark');
  await page.keyboard.press('Escape');
  await closeSidebar(page);
  const darkReading = await page.evaluate(() => ({
    body: getComputedStyle(document.querySelector('.tb-reader-body')).backgroundColor,
    section: getComputedStyle(document.querySelector('.tb-section')).backgroundColor,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }));
  expect(darkReading.body).toBe('rgb(26, 26, 26)');
  expect(darkReading.section).toBe('rgba(0, 0, 0, 0)');
  expect(darkReading.overflow).toBe(false);
  expect(pageErrors).toEqual([]);
});

test('UX-400 textbook course path connects vocabulary, grammar, review, and completion', async ({ page }) => {
  let stored = {
    version: 2,
    vocabulary: {},
    navigation: { version: 1, lastModule: '', vocab: {}, grammar: {}, textbook: {} },
    usage: {},
    updatedAt: '',
  };
  await page.route('**/api/progress', async (route) => {
    if (route.request().method() === 'POST') stored = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stored) });
  });

  const pageErrors = await openReadyApp(page, { module: 'dashboard' });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.locator('#modBtnLesson').click();
  await openTextbookDirectory(page);
  await revealControl(page.locator('.tb-lesson-card').nth(1));
  await page.locator('.tb-lesson-card').nth(1).click();
  await revealControl(page.locator('[data-course-path]'));
  await expect(page.locator('[data-course-path]')).toBeVisible();
  await expect(page.locator('.tb-course-step')).toHaveCount(4);
  await expect(page.locator('.tb-course-progress')).toHaveText('0/4 已完成');

  await revealControl(page.locator('[data-reader-action="continue"]'));
  await page.locator('[data-reader-action="continue"]').click();
  await expect(page.locator('.tb-reading-vocab-section')).toBeVisible();
  await expect(page.locator('[data-reader-action="continue"]')).toBeFocused();
  await expect(page.locator('.app-container')).toHaveAttribute('inert');
  await expect(page.locator('#textbookDetailPanel')).toHaveClass(/detail-panel-collapsed/);
  await expect(page.locator('[data-course-step="vocab"] .tb-course-step-status')).toHaveText('进行中');
  await expect(page.locator('.tb-course-progress')).toHaveText('0/4 已完成');
  await revealControl(page.locator('[data-course-action="done"][data-course-step="vocab"]'));
  await page.locator('[data-course-action="done"][data-course-step="vocab"]').click();
  await expect(page.locator('.tb-course-progress')).toHaveText('1/4 已完成');

  await revealControl(page.locator('[data-reader-action="continue"]'));
  await page.locator('[data-reader-action="continue"]').click();
  await expect(page.locator('[data-course-step="reading"] .tb-course-step-status')).toHaveText('进行中');
  await expect(page.locator('.tb-course-progress')).toHaveText('1/4 已完成');
  await expect(page.locator('.tb-course-path-toggle')).toHaveAttribute('aria-expanded', 'true');
  await revealControl(page.locator('[data-course-action="done"][data-course-step="reading"]'));
  await page.locator('[data-course-action="done"][data-course-step="reading"]').click();
  await expect(page.locator('.tb-course-progress')).toHaveText('2/4 已完成');
  const reader = page.locator('#tbReader');
  await reader.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll'));
    element.scrollTop = 260;
    element.dispatchEvent(new Event('scroll'));
  });
  await expect(page.locator('.tb-course-path-toggle')).toHaveAttribute('aria-expanded', 'true');
  const expectedScroll = await reader.evaluate((element) => element.scrollTop);

  await revealControl(page.locator('[data-course-action="step"][data-course-step="grammar"]'));
  await page.locator('[data-course-action="step"][data-course-step="grammar"]').click();
  await expect(page.locator('[data-course-step="grammar"] .tb-course-step-status')).toHaveText('进行中');
  await revealControl(page.locator('#gmCourseContext'));
  await expect(page.locator('#gmCourseContext')).toBeVisible();
  await expect(page.locator('.gm-course-grammar-card')).toHaveCount(7);
  await revealControl(page.locator('.gm-course-grammar-card').first());
  await page.locator('.gm-course-grammar-card').first().click();
  await expect(page.locator('.gm-course-detail')).toBeVisible();
  await page.locator('.gm-course-detail-return').click();
  await expectOnlyModuleVisible(page, 'lesson');
  await expect(page.locator('.tb-course-progress')).toHaveText('3/4 已完成');
  expect(await reader.evaluate((element) => element.scrollTop)).toBe(expectedScroll);

  await revealControl(page.locator('[data-course-action="step"][data-course-step="review"]'));
  await page.locator('[data-course-action="step"][data-course-step="review"]').click();
  await expect(page.locator('.study-card-view')).toBeVisible();
  await expect(page.locator('.study-source-banner')).toContainText('完成后返回课文继续学习');
  await revealControl(page.locator('[data-practice-action="skip"]'));
  for (let i = 0; i < 5; i += 1) {
    await page.locator('[data-practice-action="skip"]').click();
  }
  await expect(page.locator('#btnReturnToCourse')).toBeVisible();
  await page.locator('#btnReturnToCourse').click();
  await expectOnlyModuleVisible(page, 'lesson');
  await expect(page.locator('.tb-course-progress')).toHaveText('4/4 已完成');
  await expect(page.locator('[data-course-action="complete"]')).toBeEnabled();

  await revealControl(page.locator('[data-course-action="complete"]'));
  await page.locator('[data-course-action="complete"]').click();
  await expectOnlyModuleVisible(page, 'dashboard');
  await expect(page.locator('[data-dashboard-course="complete"]')).toContainText('本课学习路径已完成');
  await expect
    .poll(
      () =>
        stored.navigation &&
        stored.navigation.textbook &&
        stored.navigation.textbook.coursePath &&
        stored.navigation.textbook.coursePath.completed,
    )
    .toBe(true);
  expect(pageErrors).toEqual([]);
});

test('UX-400 skipped course steps remain recoverable after reload', async ({ page }) => {
  let stored = {
    version: 2,
    vocabulary: {},
    navigation: { version: 1, lastModule: '', vocab: {}, grammar: {}, textbook: {} },
    usage: {},
    updatedAt: '',
  };
  await page.route('**/api/progress', async (route) => {
    if (route.request().method() === 'POST') stored = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stored) });
  });

  const pageErrors = await openReadyApp(page, { module: 'dashboard' });
  await page.locator('#modBtnLesson').click();
  await openTextbookDirectory(page);
  await revealControl(page.locator('.tb-lesson-card').nth(1));
  await page.locator('.tb-lesson-card').nth(1).click();
  await revealControl(page.locator('.tb-course-path-toggle'));
  await page.locator('.tb-course-path-toggle').click();
  await revealControl(page.locator('[data-course-action="skip"][data-course-step="vocab"]'));
  await page.locator('[data-course-action="skip"][data-course-step="vocab"]').click();
  await expect(page.locator('.tb-course-progress')).toHaveText('1/4 已完成');
  await page.locator('#modBtnDashboard').click();
  await expect(page.locator('.dashboard-primary')).toHaveAttribute('data-dashboard-action', 'resume');
  await page.reload();
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 45_000 });
  await expect(page.locator('.dashboard-primary')).toHaveAttribute('data-dashboard-action', 'resume');
  await page.locator('.dashboard-primary').click();
  await expectOnlyModuleVisible(page, 'lesson');
  await expect(page.locator('.tb-course-progress')).toHaveText('1/4 已完成');
  await expect(page.locator('[data-course-step="vocab"] .tb-course-step-status')).toHaveText('已跳过');
  await revealControl(page.locator('.tb-course-path-toggle'));
  await page.locator('.tb-course-path-toggle').click();
  await revealControl(page.locator('.tb-course-other-toggle'));
  await page.locator('.tb-course-other-toggle').click();
  await revealControl(page.locator('[data-course-action="step"][data-course-step="vocab"]'));
  await page.locator('[data-course-action="step"][data-course-step="vocab"]').click();
  await expect(page.locator('[data-course-step="vocab"] .tb-course-step-status')).toHaveText('进行中');
  await expect(page.locator('.tb-course-progress')).toHaveText('0/4 已完成');
  await expect(page.locator('.tb-reading-vocab-section')).toHaveCount(1);
  await expect(page.locator('[data-course-action="step"][data-course-step="vocab"]')).toBeFocused();
  await revealControl(page.locator('[data-course-action="done"][data-course-step="vocab"]'));
  await page.locator('[data-course-action="done"][data-course-step="vocab"]').click();
  await expect(page.locator('[data-course-step="vocab"] .tb-course-step-status')).toHaveText('已完成');
  expect(pageErrors).toEqual([]);
  await expect.poll(() => stored.navigation.textbook.coursePath.steps.vocab).toBe('done');

  await page.evaluate(() => {
    const textbook = window.ModuleSwitcher.getTextbookModule();
    textbook.coursePath.steps = {
      vocab: 'todo',
      reading: 'todo',
      grammar: 'todo',
      review: 'todo',
    };
    textbook.coursePath.currentStep = '';
    textbook.coursePath.completed = true;
    textbook.coursePath.completedAt = '2026-08-28T00:00:00.000Z';
    textbook._refreshCoursePath();
  });
  await page.locator('[data-sidebar-reader-action="continue"]').click();
  await expect(page.locator('[data-course-step="vocab"] .tb-course-step-status')).toHaveText('进行中');
  await revealControl(page.locator('[data-course-action="done"][data-course-step="vocab"]'));
  await expect(page.locator('[data-course-action="done"][data-course-step="vocab"]')).toBeVisible();
});

test('UX-401 learning plan updates dashboard targets and planned textbook entry', async ({ page }) => {
  // Includes a cold start, reload, and first visits to two textbook volumes.
  test.setTimeout(120_000);
  let stored = { version: 2, vocabulary: {}, navigation: {}, usage: {}, updatedAt: '' };
  await page.route('**/api/progress', async (route) => {
    if (route.request().method() === 'POST') stored = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stored) });
  });

  const pageErrors = await openReadyApp(page, { module: 'dashboard' });
  await expect(page.locator('[data-dashboard-minute-target]')).toHaveText('10');
  await expect(
    page.locator('.dashboard-task-card[data-dashboard-action="start-new"] .dashboard-task-copy strong'),
  ).toHaveText('20');

  await page.locator('[data-dashboard-action="open-plan"]').first().click();
  await expect(page.locator('[data-dashboard-plan-form]')).toBeVisible();
  const minutes = page.locator('#dashboardPlanMinutes');
  const words = page.locator('#dashboardPlanWords');
  await expect(minutes).toHaveAttribute('min', '5');
  await expect(minutes).toHaveAttribute('max', '120');
  await expect(words).toHaveAttribute('min', '5');
  await expect(words).toHaveAttribute('max', '60');
  await minutes.fill('1');
  expect(await minutes.evaluate((element) => !element.checkValidity())).toBe(true);
  await words.fill('999');
  expect(await words.evaluate((element) => !element.checkValidity())).toBe(true);

  await minutes.fill('35');
  await words.fill('45');
  await page.locator('#dashboardPlanBook').selectOption('XinBian2');
  await expect(page.locator('#dashboardPlanLesson')).toBeEnabled();
  await page.locator('#dashboardPlanLesson').selectOption('lesson_03');
  await page.locator('#dashboardPlanJlpt').selectOption('N3');
  await page.locator('[data-dashboard-plan-form] button[type="submit"]').click();

  await expect(page.locator('[data-dashboard-minute-target]')).toHaveText('35');
  await expect(page.locator('.dashboard-start-meta')).toContainText('45 个新词目标');
  await expect(page.locator('.dashboard-start-meta')).toContainText('JLPT N3 目标');
  await expect(
    page.locator('.dashboard-task-card[data-dashboard-action="start-new"] .dashboard-task-copy strong'),
  ).toHaveText('45');
  await expect.poll(() => stored.plan && stored.plan.dailyMinutes).toBe(35);
  await expect.poll(() => stored.plan && stored.plan.dailyNewWords).toBe(45);
  await expect.poll(() => stored.plan && stored.plan.bookId).toBe('XinBian2');
  await expect.poll(() => stored.plan && stored.plan.lessonId).toBe('lesson_03');
  await expect.poll(() => stored.plan && stored.plan.jlptTarget).toBe('N3');

  await page.reload();
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 45_000 });
  await expect(page.locator('[data-dashboard-minute-target]')).toHaveText('35');
  await expect(
    page.locator('.dashboard-task-card[data-dashboard-action="start-new"] .dashboard-task-copy strong'),
  ).toHaveText('45');
  await page.locator('.dashboard-task-card[data-dashboard-action="open-lesson"]').click();
  await expectOnlyModuleVisible(page, 'lesson');
  await expect(page.locator('#statusTextbookBook')).toContainText('新编 2');
  await expect(page.locator('#statusTextbookLesson')).toHaveText('第三课');
  expect(pageErrors).toEqual([]);
});

test('UX-401 plan bounds normalize safely without changing vocabulary history', async ({ page }) => {
  let stored = {
    version: 2,
    vocabulary: {
      known: [1],
      fuzzy: [],
      unknown: [],
      favorite: [],
      grammarFavorite: [],
      history: [{ total: 1 }],
    },
    navigation: {},
    usage: { '2026-08-27': { focusedMs: 1200 } },
    updatedAt: '',
  };
  await page.route('**/api/progress', async (route) => {
    if (route.request().method() === 'POST') stored = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stored) });
  });

  const pageErrors = await openReadyApp(page, { module: 'dashboard' });
  const normalized = await page.evaluate(() =>
    window.ProgressStore.updatePlan({
      dailyMinutes: 1,
      dailyNewWords: 999,
      bookId: 'unknown-book',
      lessonId: 'not-a-lesson',
      jlptTarget: 'N0',
    }),
  );
  expect(normalized).toMatchObject({
    dailyMinutes: 5,
    dailyNewWords: 60,
    bookId: 'XinBian1',
    lessonId: 'lesson_02',
    jlptTarget: 'N5',
  });
  await expect.poll(() => stored.vocabulary.known).toEqual([1]);
  await expect.poll(() => stored.vocabulary.history).toEqual([{ total: 1 }]);
  await expect.poll(() => stored.usage['2026-08-27'].focusedMs).toBeGreaterThanOrEqual(1200);
  expect(pageErrors).toEqual([]);
});

test('UX-402 dashboard turns progress into actionable time, review, and content signals', async ({
  page,
}) => {
  const now = new Date();
  const dateKey = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  const todayKey = dateKey(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = dateKey(yesterday);
  let stored = {
    version: 2,
    vocabulary: {
      known: [1],
      fuzzy: [2],
      unknown: [3],
      favorite: [],
      grammarFavorite: ['grammar-001'],
      history: [
        {
          date: now.toISOString(),
          total: 2,
          known: 1,
          fuzzy: 1,
          unknown: 0,
          source: { kind: 'daily-review', label: '今日到期复习' },
        },
        {
          date: yesterday.toISOString(),
          total: 3,
          known: 1,
          fuzzy: 1,
          unknown: 1,
        },
      ],
      srs: [],
    },
    navigation: {},
    usage: {
      [todayKey]: { focusedMs: 25 * 60 * 1000 },
      [yesterdayKey]: { focusedMs: 10 * 60 * 1000 },
    },
    updatedAt: '',
  };
  await page.route('**/api/progress', async (route) => {
    if (route.request().method() === 'POST') stored = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stored) });
  });

  const pageErrors = await openReadyApp(page, { module: 'dashboard' });
  const insights = page.locator('[data-dashboard-insights]');
  await expect(insights).toBeVisible();
  // Time lives in the goal ledger only: today against the plan, then the past seven days.
  await expect(page.locator('.dashboard-progress-main strong')).toHaveText('25');
  await expect(page.locator('[data-dashboard-stat="week"] strong')).toHaveText('2 天 · 35 分钟');
  await expect(page.locator('[data-dashboard-insight="review"] .dashboard-progress-track')).toHaveAttribute(
    'aria-valuenow',
    '50',
  );
  await expect(page.locator('[data-dashboard-insight="review"]')).toContainText('继续复习');
  await expect(page.locator('.dashboard-trend-bar')).toHaveCount(7);
  await expect(page.locator('[data-dashboard-insight="trend"]')).toContainText('不会');
  await expect(page.locator('[data-dashboard-insight="trend"]')).toContainText('模糊');
  await expect(
    page.locator('[data-dashboard-insight="content"] .dashboard-content-progress').nth(0),
  ).toContainText('1/');
  await expect(
    page.locator('[data-dashboard-insight="content"] .dashboard-content-progress').nth(1),
  ).not.toContainText('读取中');
  await expect(
    page.locator('[data-dashboard-insight="content"] .dashboard-content-progress').nth(1),
  ).toContainText('1/');
  await expect(page.locator('[data-dashboard-insight="weak"]')).toContainText('不会');
  await expect(page.locator('[data-dashboard-insight="weak"]')).toContainText('模糊');
  await expect(page.locator('[data-dashboard-action="start-weak"]')).toBeEnabled();
  expect(pageErrors).toEqual([]);
});

test('B10 dashboard prioritizes the daily goal, compact tasks, and aligned signals', async ({ page }) => {
  const now = new Date();
  const todayKey = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  await page.route('**/api/progress', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        version: 2,
        vocabulary: {},
        navigation: {},
        plan: {
          dailyMinutes: 30,
          dailyNewWords: 20,
          bookId: 'XinBian1',
          lessonId: 'lesson_02',
          jlptTarget: 'N5',
        },
        usage: { [todayKey]: { focusedMs: 12 * 60 * 1000 } },
        updatedAt: now.toISOString(),
      }),
    });
  });
  const pageErrors = await openReadyApp(page, { module: 'dashboard' });

  await expect(page.locator('.dashboard-primary')).toHaveCount(1);
  await expect(page.locator('[data-dashboard-goal-progress]')).toHaveAttribute('aria-valuenow', '40');
  await expect(page.locator('.dashboard-progress-note')).toContainText('还差 18 分钟');
  const taskHeights = await page
    .locator('.dashboard-task-card')
    .evaluateAll((cards) => cards.map((card) => Math.round(card.getBoundingClientRect().height)));
  expect(Math.max(...taskHeights)).toBeLessThanOrEqual(82);

  // Due reviews head the progress panel; the trend and weak words share its top edge.
  const positions = await page.evaluate(() => {
    const box = (selector) => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { x: rect.x, y: rect.y, bottom: rect.bottom };
    };
    return {
      goal: box('.dashboard-progress-card'),
      content: box('[data-dashboard-insight="content"]'),
      review: box('[data-dashboard-insight="review"]'),
      trend: box('[data-dashboard-insight="trend"]'),
      weak: box('[data-dashboard-insight="weak"]'),
    };
  });
  expect(Math.abs(positions.review.x - positions.content.x)).toBeLessThan(2);
  expect(positions.review.y).toBeGreaterThan(positions.content.y);
  for (const card of [positions.trend, positions.weak]) {
    expect(Math.abs(card.y - positions.content.y)).toBeLessThan(2);
  }
  expect(positions.trend.x).toBeGreaterThan(positions.content.x);
  expect(positions.weak.x).toBeGreaterThan(positions.trend.x);
  expect(positions.content.y).toBeGreaterThanOrEqual(positions.goal.bottom);
  expect(pageErrors).toEqual([]);
});

test('UX-402 weak-word suggestion starts a finite review session', async ({ page }) => {
  let stored = {
    version: 2,
    vocabulary: {
      known: [],
      fuzzy: [2],
      unknown: [1, 3],
      favorite: [],
      grammarFavorite: [],
      history: [],
      srs: [],
    },
    navigation: {},
    usage: {},
    updatedAt: '',
  };
  await page.route('**/api/progress', async (route) => {
    if (route.request().method() === 'POST') stored = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stored) });
  });

  const pageErrors = await openReadyApp(page, { module: 'dashboard' });
  const weakAction = page.locator('[data-dashboard-action="start-weak"]');
  await expect(weakAction).toBeEnabled();
  await weakAction.click();
  await expectOnlyModuleVisible(page, 'vocab');
  await expect(page.locator('.study-card-view')).toBeVisible();
  await expect(page.locator('.study-source-banner')).toContainText('统计建议复习');
  await expect(page.locator('#statusStudyQueue')).toHaveText('3');
  expect(pageErrors).toEqual([]);
});

test('UX-403 global search groups vocabulary, grammar, and textbook results', async ({ page }) => {
  // Loading all three content modules can exceed one minute on hosted Windows.
  test.setTimeout(120_000);
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page, { module: 'dashboard' });
  const toggle = page.locator('#globalSearchToggle');
  const input = page.locator('#globalSearchInput');

  await revealControl(toggle);
  await toggle.click();
  await expect(input).toBeFocused();
  await input.fill('相容れない');
  await expect(page.locator('[aria-label="词汇结果"] .global-search-result').first()).toBeVisible();
  await expect(page.locator('.global-search-group-heading').first()).toContainText('词汇');
  await input.press('Enter');
  await expectOnlyModuleVisible(page, 'vocab');
  await expect(page.locator('#detailContent')).toContainText('相容れない');

  await revealControl(toggle);
  await toggle.click();
  await input.fill('です');
  await expect(page.locator('[aria-label="语法结果"] .global-search-result').first()).toBeVisible({
    timeout: 15_000,
  });
  await page.locator('[aria-label="语法结果"] .global-search-result').first().click();
  await expectOnlyModuleVisible(page, 'grammar');
  await expect(page.locator('#gmDetailContent')).not.toBeEmpty();

  await revealControl(toggle);
  await toggle.click();
  await input.fill('はじめまして');
  await expect(page.locator('[aria-label="课文结果"] .global-search-result').first()).toBeVisible({
    timeout: 15_000,
  });
  await page.locator('[aria-label="课文结果"] .global-search-result').first().click();
  await expectOnlyModuleVisible(page, 'lesson');
  await expect(page.locator('#statusTextbookLesson')).toHaveText('第二课');
  expect(pageErrors).toEqual([]);
});

test('UX-403 global search supports keyboard selection, empty state, and compact layout', async ({
  page,
}) => {
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page, { module: 'dashboard' });
  await page.setViewportSize({ width: 1280, height: 720 });
  const toggle = page.locator('#globalSearchToggle');
  const input = page.locator('#globalSearchInput');

  await revealControl(toggle);
  await toggle.click();
  await input.fill('没有这个词条-ux403');
  await expect(page.locator('#globalSearchStatus')).toContainText('没有找到相关内容', { timeout: 15_000 });
  await expect(page.locator('.global-search-empty')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#globalSearchOverlay')).toBeHidden();
  await expect(toggle).toBeFocused();

  // The close button sits inside the dialog, which stops click propagation.
  await toggle.click();
  await page.locator('button.global-search-close').click();
  await expect(page.locator('#globalSearchOverlay')).toBeHidden();
  await expect(toggle).toBeFocused();

  await toggle.click();
  await input.fill('相容れない');
  await expect(page.locator('.global-search-result').first()).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.global-search-result.is-active')).toHaveAttribute('aria-selected', 'true');
  await expectRegionsWithinViewport(page, ['#globalSearchDialog']);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  await page.keyboard.press('Enter');
  await expect(page.locator('#detailContent')).toContainText('相容れない');
  expect(pageErrors).toEqual([]);
});

test('FIX-16 reconnecting retries the open search without reloading the learning page', async ({ page }) => {
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page, { module: 'dashboard' });
  const input = page.locator('#globalSearchInput');
  const status = page.locator('#globalSearchStatus');
  await page.context().setOffline(true);
  await page.keyboard.press('Control+k');
  await input.fill('はじめまして');
  await expect(status).toContainText('部分索引不可用');
  await expect(page.locator('[aria-label="课文结果"]')).toHaveCount(0);

  await page.context().setOffline(false);
  await expect(page.locator('[aria-label="课文结果"]')).toContainText('はじめまして');
  await expect(status).not.toContainText('部分索引不可用');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('はじめまして');
  for (const viewport of [
    { width: 1600, height: 900 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    await expectRegionsWithinViewport(page, ['#globalSearchDialog']);
  }
  await page.locator('[aria-label="课文结果"] .global-search-result').click();
  await expectOnlyModuleVisible(page, 'lesson');
  await expect(page.locator('#statusTextbookLesson')).toHaveText('第二课');
  expect(pageErrors).toEqual([]);
});

test('FIX-16 reopening search retries failed sources and preserves successful book indexes', async ({
  page,
}) => {
  await useIsolatedProgress(page);
  let unavailable = true;
  const requests = { grammar: 0, XinBian1: 0, XinBian2: 0, XinBian3: 0, XinBian4: 0 };
  await page.route('**/data/grammar_index.json', async (route) => {
    requests.grammar++;
    if (unavailable) await route.fulfill({ status: 503, body: 'temporary index failure' });
    else await route.continue();
  });
  await page.route('**/data/grammar_enriched_gemini_full_refined.json', async (route) => {
    if (unavailable) await route.fulfill({ status: 503, body: 'temporary fallback failure' });
    else await route.continue();
  });
  await page.route('**/data/textbook/book_chunks/XinBian*.json', async (route) => {
    const book = new URL(route.request().url()).pathname.match(/(XinBian[1-4])\.json$/)[1];
    requests[book]++;
    if (unavailable && book === 'XinBian1')
      await route.fulfill({ status: 503, body: 'temporary book failure' });
    else await route.continue();
  });
  const pageErrors = await openReadyApp(page, { module: 'dashboard' });
  const input = page.locator('#globalSearchInput');
  const status = page.locator('#globalSearchStatus');
  await page.keyboard.press('Control+k');
  await input.fill('新编');
  await expect(status).toContainText('部分索引不可用');
  await expect(page.locator('[aria-label="课文结果"] .global-search-result').first()).toBeVisible();
  const failedAttempts = { ...requests };
  await input.press('Escape');
  unavailable = false;
  await page.keyboard.press('Control+k');
  await input.fill('はじめまして');
  await expect(page.locator('[aria-label="课文结果"]')).toContainText('はじめまして');
  await expect(status).not.toContainText('部分索引不可用');
  expect(requests.grammar).toBeGreaterThan(failedAttempts.grammar);
  expect(requests.XinBian1).toBe(failedAttempts.XinBian1 + 1);
  for (const book of ['XinBian2', 'XinBian3', 'XinBian4']) {
    expect(requests[book]).toBe(failedAttempts[book]);
  }
  await input.fill('です');
  await expect(page.locator('[aria-label="语法结果"] .global-search-result').first()).toBeVisible();
  await page.locator('[aria-label="语法结果"] .global-search-result').first().click();
  await expectOnlyModuleVisible(page, 'grammar');
  await expect(page.locator('.gm-detail-title')).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('A02 product-level layers dismiss each other and keep their accessibility state in sync', async ({
  page,
}) => {
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page, { module: 'dashboard' });
  const calendar = page.locator('#progressCalendar');
  const calendarToggle = page.locator('#progressCalendarToggle');
  const searchOverlay = page.locator('#globalSearchOverlay');
  const searchToggle = page.locator('#globalSearchToggle');
  const settings = page.locator('#appSettingsPanel');
  const settingsToggle = page.locator('#appSettingsToggle');

  await revealControl(calendarToggle);
  await calendarToggle.click();
  await expect(calendar).toHaveClass(/open/);
  await expect(calendarToggle).toHaveAttribute('aria-expanded', 'true');
  await searchToggle.click();
  await expect(searchOverlay).toBeVisible();
  await expect(calendar).not.toHaveClass(/open/);
  await expect(calendar).toHaveAttribute('aria-hidden', 'true');
  await expect(calendarToggle).toHaveAttribute('aria-expanded', 'false');

  await page.keyboard.press('Escape');
  await expect(searchToggle).toBeFocused();
  await settingsToggle.click();
  await expect(settings).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(searchOverlay).toBeVisible();
  await expect(settings).toBeHidden();
  await expect(settingsToggle).toHaveAttribute('aria-expanded', 'false');

  await page.keyboard.press('Escape');
  await revealControl(page.locator('[data-dashboard-action="open-plan"]').first());
  await page.locator('[data-dashboard-action="open-plan"]').first().click();
  await expect(page.locator('[data-dashboard-plan-form]')).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(searchOverlay).toBeVisible();
  await expect(page.locator('.dashboard-plan-overlay')).toHaveCount(0);
  await page.keyboard.press('Escape');
  // UI-ART-28: the collapsed rail hides the search button, so focus stays on the page.
  await expect(searchOverlay).toBeHidden();
  await expect(searchToggle).toHaveAttribute('aria-expanded', 'false');
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  expect(pageErrors).toEqual([]);
});

test('A03 grammar cards stay inside their pane at 1280 by 720 and 150 percent scale', async ({ page }) => {
  await useIsolatedProgress(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  const pageErrors = await openReadyApp(page, { module: 'dashboard' });
  await openSettings(page);
  await page.locator('#appScaleSelect').selectOption('1.5');
  await page.keyboard.press('Escape');
  await closeSidebar(page);
  await page.locator('#modBtnGrammar').click();
  await expect(page.locator('.gm-card').first()).toBeVisible();

  const layout = await page.locator('#gmGrammarList').evaluate((pane) => {
    const grid = pane.querySelector('.gm-card-grid');
    const card = pane.querySelector('.gm-card');
    const paneBox = pane.getBoundingClientRect();
    const gridBox = grid.getBoundingClientRect();
    const cardBox = card.getBoundingClientRect();
    return {
      paneClientWidth: pane.clientWidth,
      paneScrollWidth: pane.scrollWidth,
      gridRight: gridBox.right,
      paneRight: paneBox.right,
      cardRight: cardBox.right,
    };
  });

  expect(layout.paneScrollWidth).toBeLessThanOrEqual(layout.paneClientWidth + 1);
  expect(layout.gridRight).toBeLessThanOrEqual(layout.paneRight + 1);
  expect(layout.cardRight).toBeLessThanOrEqual(layout.paneRight + 1);
  expect(pageErrors).toEqual([]);
});

test('A04 enlarged UI scale uses the effective viewport and preserves first-screen capacity', async ({
  page,
}) => {
  await useIsolatedProgress(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  const pageErrors = await openReadyApp(page, { module: 'dashboard' });
  await openSettings(page);
  await page.locator('#appScaleSelect').selectOption('1.5');
  await expect(page.locator('html')).toHaveAttribute('data-layout-viewport', 'tablet');
  await page.keyboard.press('Escape');
  await closeSidebar(page);
  const navControlLayout = await page.evaluate(() => {
    const modules = document.getElementById('moduleSwitcher').getBoundingClientRect();
    const controls = document.getElementById('statusBarRevealControls').getBoundingClientRect();
    return { modulesBottom: modules.bottom, controlsTop: controls.top };
  });
  expect(navControlLayout.modulesBottom).toBeLessThanOrEqual(navControlLayout.controlsTop + 1);
  await expect(page.locator('.dashboard-task-card').first()).toBeInViewport({ ratio: 0.35 });

  await page.locator('#modBtnVocab').click();
  const drawerToggle = page.locator('#tabletSidebarToggle');
  await expect(drawerToggle).toBeVisible();
  await expect(page.locator('#sidebar')).not.toHaveClass(/tablet-drawer-open/);
  const cardBoxes = await page.locator('.cc-card').evaluateAll((cards) =>
    cards.slice(0, 2).map((card) => {
      const box = card.getBoundingClientRect();
      return { top: box.top, right: box.right };
    }),
  );
  expect(cardBoxes).toHaveLength(2);
  expect(Math.abs(cardBoxes[0].top - cardBoxes[1].top)).toBeLessThanOrEqual(2);
  expect(cardBoxes[1].right).toBeLessThanOrEqual(1281);

  await drawerToggle.click();
  await expect(page.locator('#sidebar')).toHaveClass(/tablet-drawer-open/);
  await page.keyboard.press('Control+k');
  await expect(page.locator('#globalSearchOverlay')).toBeVisible();
  await expect(page.locator('#sidebar')).not.toHaveClass(/tablet-drawer-open/);
  await page.keyboard.press('Escape');

  await openSidebar(page);
  await page.locator('#appSettingsToggle').focus();
  await page.keyboard.press('Enter');
  await page.locator('#appScaleSelect').selectOption('1');
  await expect(page.locator('html')).toHaveAttribute('data-layout-viewport', 'desktop');
  await page.keyboard.press('Escape');
  await expect(drawerToggle).toBeHidden();
  expect(pageErrors).toEqual([]);
});

test('B06 scale uses effective breakpoints and keeps overlays inside the viewport', async ({ page }) => {
  await useIsolatedProgress(page);
  await page.setViewportSize({ width: 1600, height: 900 });
  const pageErrors = await openReadyApp(page, { module: 'dashboard' });
  const root = page.locator('html');

  await openSettings(page);
  await page.locator('#appScaleSelect').selectOption('1.25');
  await expect(root).toHaveClass(/layout-max-1400/);
  await expect(root).not.toHaveClass(/layout-max-1200/);
  await expect(root).toHaveAttribute('data-layout-height', 'regular');
  const desktopScale = await page.evaluate(() => ({
    width: window.AppDisplayScale.getLayoutWidth(),
    height: window.AppDisplayScale.getLayoutHeight(),
    navWidth: getComputedStyle(document.documentElement).getPropertyValue('--app-nav-width').trim(),
  }));
  expect(desktopScale).toEqual({ width: 1280, height: 720, navWidth: '76px' });
  await page.keyboard.press('Escape');
  await closeSidebar(page);

  await page.setViewportSize({ width: 1280, height: 720 });
  await openSettings(page);
  await page.locator('#appScaleSelect').selectOption('1.5');
  await expect(root).toHaveAttribute('data-layout-viewport', 'tablet');
  await expect(root).toHaveAttribute('data-layout-height', 'compact');
  await expect(root).toHaveClass(/layout-max-900/);
  await page.keyboard.press('Escape');
  await closeSidebar(page);
  expect(
    await page
      .locator('.dashboard-hero-grid')
      .evaluate((element) => getComputedStyle(element).gridTemplateColumns),
  ).toContain(' ');

  await page.locator('[data-dashboard-action="open-plan"]').first().click();
  await expectRegionsWithinViewport(page, ['[data-dashboard-plan-form]']);
  expect(
    await page.locator('[data-dashboard-plan-form]').evaluate((element) => ({
      ownsScroll: element.scrollHeight > element.clientHeight,
      pageOverflow: document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
    })),
  ).toEqual({ ownsScroll: true, pageOverflow: false });
  await page.locator('.dashboard-plan-footer').scrollIntoViewIfNeeded();
  await expectRegionsWithinViewport(page, ['.dashboard-plan-footer']);
  await page.keyboard.press('Escape');

  await page.keyboard.press('Control+k');
  await page.locator('#globalSearchInput').fill('相容れない');
  await expect(page.locator('.global-search-result').first()).toBeVisible();
  await expectRegionsWithinViewport(page, ['#globalSearchDialog']);
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 1024, height: 700 });
  await expect(root).toHaveClass(/layout-max-700/);
  await expect(root).toHaveClass(/layout-max-760/);
  expect(
    await page
      .locator('.dashboard-hero-grid')
      .evaluate((element) => getComputedStyle(element).gridTemplateColumns),
  ).not.toContain(' ');
  await page.locator('#modBtnVocab').click();
  await page.locator('.cc-card-body').first().click();
  await expect(page.locator('#detailPanel')).toHaveAttribute('data-anchor-placement', 'sheet');
  await expectRegionsWithinViewport(page, ['#detailPanel']);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    ),
  ).toBe(false);
  expect(pageErrors).toEqual([]);
});

test('UX-404 keyboard flow keeps focus through plan, card, menu, and classic study', async ({ page }) => {
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page, { module: 'dashboard' });

  const planTrigger = page.locator('[data-dashboard-action="open-plan"]').first();
  await planTrigger.focus();
  await page.keyboard.press('Enter');
  const planDialog = page.locator('[data-dashboard-plan-form]');
  await expect(planDialog).toBeVisible();
  await expect(page.locator('#dashboardPlanMinutes')).toBeFocused();

  const firstPlanFocusable = planDialog
    .locator(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    )
    .first();
  const lastPlanFocusable = planDialog
    .locator(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    )
    .last();
  await lastPlanFocusable.focus();
  await page.keyboard.press('Tab');
  await expect(firstPlanFocusable).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(planDialog).toBeHidden();
  await expect(page.locator('[data-dashboard-action="open-plan"]').first()).toBeFocused();

  await page.locator('#modBtnVocab').click();
  const cardBody = page.locator('.cc-card-body').first();
  const word = await cardBody.locator('.cc-word').innerText();
  await cardBody.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#detailContent')).toContainText(word);

  const menuToggle = page.locator('.cc-card-menu-toggle').first();
  await menuToggle.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.cc-card-menu').first()).toHaveAttribute('aria-hidden', 'false');
  await page.keyboard.press('Escape');
  await expect(page.locator('.cc-card-menu').first()).toHaveAttribute('aria-hidden', 'true');
  await expect(menuToggle).toBeFocused();

  await revealControl(page.locator('#viewModeSelect'));
  await page.locator('#viewModeSelect').selectOption('study');
  await expect(page.locator('.study-setup')).toBeVisible();
  await revealControl(page.locator('.study-mode-btn[data-practice-mode="classic"]'));
  await page.locator('.study-mode-btn[data-practice-mode="classic"]').click();
  await page.locator('#btnStartStudy').click();
  const flashcard = page.locator('#flashcard');
  await expect(flashcard).toBeVisible();
  await expect(flashcard).toHaveAttribute('role', 'button');
  await flashcard.focus();
  await page.keyboard.press('Enter');
  await expect(flashcard).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Space');
  await expect(flashcard).toHaveAttribute('aria-pressed', 'false');
  expect(pageErrors).toEqual([]);
});

test('UX-404 semantics expose state beyond color and survive language and scale checks', async ({ page }) => {
  let stored = {
    version: 2,
    vocabulary: {
      known: [],
      fuzzy: [],
      unknown: [1],
      favorite: [],
      grammarFavorite: [],
      history: [],
    },
    navigation: {},
    usage: {},
    updatedAt: '',
  };
  await page.route('**/api/progress', async (route) => {
    if (route.request().method() === 'POST') stored = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stored) });
  });
  const pageErrors = await openReadyApp(page, { module: 'vocab' });
  await page.setViewportSize({ width: 1280, height: 720 });

  const cardBody = page.locator('.cc-card-body').first();
  await expect(cardBody).toHaveAttribute('role', 'button');
  await expect(cardBody).toHaveAttribute('tabindex', '0');
  await expect(cardBody.locator('.cc-word')).toHaveAttribute('lang', 'ja');
  await expect(page.locator('.cc-fav').first()).toHaveAttribute('aria-label', /收藏|取消收藏/);

  const menuToggle = page.locator('.cc-card-menu-toggle').first();
  await menuToggle.click();
  await expect(page.locator('.cc-card-menu').first()).toHaveAttribute('aria-hidden', 'false');
  await page.keyboard.press('Escape');
  await expect(menuToggle).toBeFocused();

  await revealControl(page.locator('#viewModeSelect'));
  await page.locator('#viewModeSelect').selectOption('list');
  await expect(page.locator('.list-row').first()).toBeVisible();
  expect(
    await page.locator('.list-row .sr-only').evaluateAll((nodes) => nodes.map((node) => node.textContent)),
  ).toContain('不会');

  const settingsToggle = page.locator('#appSettingsToggle');
  await revealControl(settingsToggle);
  await settingsToggle.click();
  await page.locator('#appScaleSelect').selectOption('1.5');
  await expect(page.locator('html')).toHaveAttribute('data-app-scale', '1.5');
  await page.keyboard.press('Escape');
  await expect(settingsToggle).toBeFocused();

  await page.locator('#modBtnGrammar').click();
  await expect(page.locator('.gm-card').first()).toBeVisible();
  await expect(page.locator('.gm-card-title').first()).toHaveAttribute('lang', 'ja');
  await page.locator('#modBtnLesson').click();
  await revealControl(page.locator('#tabletSidebarToggle'));
  await page.locator('#tabletSidebarToggle').click();
  await expect(page.locator('#textbookSidebar')).toHaveClass(/tablet-drawer-open/);
  await openTextbookDirectory(page);
  await revealControl(page.locator('.tb-lesson-card').nth(1));
  await page.locator('.tb-lesson-card').nth(1).click();
  await expect(page.locator('.tb-paragraph[lang="ja"]').first()).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  expect(pageErrors).toEqual([]);
});

test('UX-405 tablet drawer keeps the learning surface wide while details overlay it', async ({ page }) => {
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page, { module: 'vocab' });
  await page.setViewportSize({ width: 768, height: 700 });

  const drawerToggle = page.locator('#tabletSidebarToggle');
  const sidebar = page.locator('#sidebar');
  const main = page.locator('#vocabMain');
  const detail = page.locator('#detailPanel');
  await expect(drawerToggle).toBeVisible();
  await expect(drawerToggle).toHaveAttribute('aria-controls', 'sidebar');
  await expect(sidebar).not.toHaveClass(/tablet-drawer-open/);
  await expectRegionsWithinViewport(page, ['#tabletSidebarToggle', '#vocabMain']);

  await drawerToggle.click();
  await expect(sidebar).toHaveClass(/tablet-drawer-open/);
  await expect(page.locator('#tabletSidebarBackdrop')).toBeVisible();
  await expect(drawerToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#sidebarCollapseBtn')).toBeFocused();
  await page.locator('#sidebarCollapseBtn').click();
  await expect(sidebar).not.toHaveClass(/tablet-drawer-open/);
  await expect(drawerToggle).toBeFocused();

  await page.locator('.cc-card-body').first().click();
  await expect(detail).not.toHaveClass(/detail-panel-collapsed/);
  await page.waitForTimeout(220);
  const mainBox = await main.boundingBox();
  const detailBox = await detail.boundingBox();
  const navWidth = await page.locator('#statusBar').evaluate((element) => element.offsetWidth);
  expect(mainBox.width).toBeGreaterThanOrEqual(767 - navWidth);
  expect(detailBox.x).toBeGreaterThan(0);
  expect(detailBox.x + detailBox.width).toBeLessThanOrEqual(768.5);
  await expectRegionsWithinViewport(page, ['#detailPanel']);

  await page.locator('#detailPanelCollapseBtn').click();
  await expect(detail).toHaveClass(/detail-panel-collapsed/);
  await drawerToggle.click();
  await expect(sidebar).toHaveClass(/tablet-drawer-open/);
  await revealControl(page.locator('#ccStartStudy'));
  await page.locator('#ccStartStudy').click();
  await expect(page.locator('.study-card-view')).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('UX-405 tablet drawer follows grammar and textbook modules at supported widths', async ({ page }) => {
  test.setTimeout(120_000);
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page, { module: 'vocab' });
  await page.evaluate(() => window.AppDisplayScale.setMode('1'));

  for (const width of [1024, 900, 768]) {
    await page.setViewportSize({ width, height: 700 });
    await page.evaluate(() => window.AppDisplayScale.refresh());
    await expect(page.locator('html')).toHaveAttribute('data-layout-viewport', 'tablet');
    await page.locator('#modBtnVocab').click();
    await expect(page.locator('.cc-card').first()).toBeVisible();
    await expect(page.locator('#tabletSidebarToggle')).toHaveAttribute('aria-controls', 'sidebar');
    const vocabMain = await page.locator('#vocabMain').boundingBox();
    const navWidth = await page.locator('#statusBar').evaluate((element) => element.offsetWidth);
    expect(vocabMain.width).toBeGreaterThanOrEqual(width - navWidth - 1);
    await revealControl(page.locator('#tabletSidebarToggle'));
    await page.locator('#tabletSidebarToggle').click();
    await expect(page.locator('#sidebar')).toHaveClass(/tablet-drawer-open/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#sidebar')).not.toHaveClass(/tablet-drawer-open/);
    await expect(page.locator('#tabletSidebarToggle')).toBeFocused();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
    ).toBe(false);
  }

  await page.locator('#modBtnGrammar').click();
  await expect(page.locator('.gm-card').first()).toBeVisible();
  await expect(page.locator('#tabletSidebarToggle')).toHaveAttribute('aria-controls', 'grammarSidebar');
  const grammarMain = await page.locator('#grammarMain').boundingBox();
  const grammarNavWidth = await page.locator('#statusBar').evaluate((element) => element.offsetWidth);
  expect(grammarMain.width).toBeGreaterThanOrEqual(768 - grammarNavWidth - 1);
  await page.locator('#modBtnLesson').click();
  await expect(page.locator('.tb-lesson-directory')).not.toHaveAttribute('open', '');
  await expect(page.locator('#tabletSidebarToggle')).toHaveAttribute('aria-controls', 'textbookSidebar');
  await expect(page.locator('#textbookMain')).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('UX-500 theme control cycles light, dark, and system modes with persistence', async ({ page }) => {
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page, { module: 'dashboard' });
  const settingsToggle = page.locator('#appSettingsToggle');
  const themeSelect = page.locator('#appThemeSelect');

  // UI-ART-25: without a saved choice the page follows the system (light here).
  await expect(page.locator('html')).toHaveAttribute('data-theme-mode', 'auto');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await openSettings(page);
  await expect(themeSelect).toHaveValue('auto');
  await themeSelect.selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme-mode', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const darkColors = await page.evaluate(() => ({
    background: getComputedStyle(document.body).backgroundColor,
    foreground: getComputedStyle(document.body).color,
  }));
  expect(darkColors.background).toBe('rgb(15, 15, 15)');
  expect(darkColors.foreground).toBe('rgb(230, 230, 230)');

  await page.keyboard.press('Escape');
  await expect(settingsToggle).toBeFocused();
  await page.reload();
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 45_000 });
  await expect(page.locator('html')).toHaveAttribute('data-theme-mode', 'dark');

  await openSettings(page);
  await themeSelect.selectOption('auto');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await themeSelect.selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme-mode', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(pageErrors).toEqual([]);
});

test('UX-500 dark theme keeps textbook body text and content surfaces readable', async ({ page }) => {
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page, { module: 'dashboard' });
  await openSettings(page);
  await page.locator('#appThemeSelect').selectOption('dark');
  await page.keyboard.press('Escape');
  await closeSidebar(page);

  await page.locator('#modBtnLesson').click();
  await openTextbookDirectory(page);
  const lesson = page.locator('.tb-lesson-card').nth(1);
  await revealControl(lesson);
  await expect(lesson).toBeVisible();
  await revealControl(lesson);
  await lesson.click();
  await expect(page.locator('#tbLoading')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#statusTextbookLesson')).toHaveText('第二课');
  const paragraph = page.locator('.tb-paragraph[lang="ja"]').first();
  await expect(paragraph).toBeVisible();
  await paragraph.scrollIntoViewIfNeeded();

  const highlightColors = await page
    .locator('.tb-inline-highlight')
    .first()
    .evaluate((element) => ({
      background: getComputedStyle(element).backgroundColor,
      shadow: getComputedStyle(element).boxShadow,
    }));
  expect(highlightColors.background).toBe('rgba(0, 0, 0, 0)');
  expect(highlightColors.shadow).toContain('rgba(231, 184, 95, 0.24)');
  expect(highlightColors.shadow).toContain('0px -1px 0px 0px inset');

  const readingColors = await page.evaluate(() => ({
    paragraph: getComputedStyle(document.querySelector('.tb-paragraph')).color,
    paper: getComputedStyle(document.querySelector('.tb-reader-body')).backgroundColor,
    section: getComputedStyle(document.querySelector('.tb-section')).backgroundColor,
    path: getComputedStyle(document.querySelector('#textbookSidebar .tb-course-path')).backgroundColor,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }));
  expect(readingColors.paragraph).toBe('rgb(230, 230, 230)');
  expect(readingColors.paper).toBe('rgb(26, 26, 26)');
  expect(readingColors.section).toBe('rgba(0, 0, 0, 0)');
  expect(readingColors.path).toBe('rgba(0, 0, 0, 0)');
  expect(readingColors.overflow).toBe(false);

  await page.setViewportSize({ width: 1280, height: 720 });
  await revealControl(page.locator('.tb-sidebar-current-lesson'));
  await revealControl(page.locator('.tb-sidebar-current-lesson'));
  await expect(page.locator('.tb-sidebar-current-lesson')).toBeVisible();
  await expect(page.locator('.tb-reader-header')).toHaveCount(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
  ).toBe(false);

  await page.locator('#modBtnVocab').click();
  await revealControl(page.locator('#viewModeSelect'));
  await page.locator('#viewModeSelect').selectOption('study');
  await expect(page.locator('.study-setup')).toBeVisible();
  const studyColors = await page.evaluate(() => ({
    card: getComputedStyle(document.querySelector('.study-info-card')).backgroundColor,
    primary: getComputedStyle(document.querySelector('#btnStartStudy')).backgroundColor,
  }));
  expect(studyColors.card).toBe('rgb(26, 26, 26)');
  expect(studyColors.primary).toBe('rgb(164, 189, 230)');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reducedMotion = await page.evaluate(() => ({
    theme: document.documentElement.getAttribute('data-theme'),
    panelDuration: getComputedStyle(document.documentElement)
      .getPropertyValue('--motion-panel-duration')
      .trim(),
  }));
  expect(reducedMotion.theme).toBe('dark');
  expect(reducedMotion.panelDuration).toBe('1ms');
  expect(pageErrors).toEqual([]);
});

test('UX-501 dashboard keeps milestone progress calm and useful for a new learner', async ({ page }) => {
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page, { module: 'dashboard' });
  const achievements = page.locator('[data-dashboard-achievement]');

  await expect(page.locator('[data-dashboard-achievements]')).toBeVisible();
  await expect(achievements).toHaveCount(4);
  await expect(achievements.nth(0)).toHaveAttribute('data-dashboard-achievement-status', 'progress');
  await expect(achievements.nth(0)).toContainText('第一段学习');
  await expect(achievements.nth(0)).toContainText('0 / 1');
  await expect(achievements.nth(0).locator('[role="progressbar"]')).toHaveAttribute('aria-valuenow', '0');
  await expect(achievements.nth(0).locator('[role="progressbar"]')).toHaveAttribute(
    'aria-valuetext',
    '0 / 1，还差 1 次学习',
  );
  // FIX-30: unmet milestones show their count, not a row of "in progress" labels.
  await expect(page.locator('[data-dashboard-achievements]')).not.toContainText('进行中');
  await expect(page.locator('.dashboard-achievement-card.is-complete')).toHaveCount(0);

  await page.setViewportSize({ width: 1280, height: 720 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
  ).toBe(false);
  expect(pageErrors).toEqual([]);
});

test('UX-501 unlocks milestones from real history, mastery, streak, and course progress', async ({
  page,
}) => {
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
          id: 'ux501-session',
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
  let stored = state;
  await page.route('**/api/progress', async (route) => {
    if (route.request().method() === 'POST') stored = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stored) });
  });
  const pageErrors = await openReadyApp(page, { module: 'dashboard' });

  for (const id of ['first-session', 'known-20', 'streak-3', 'lesson-path']) {
    await expect(page.locator(`[data-dashboard-achievement="${id}"]`)).toHaveAttribute(
      'data-dashboard-achievement-status',
      'complete',
    );
  }
  await expect(page.locator('[data-dashboard-achievement="known-20"] [role="progressbar"]')).toHaveAttribute(
    'aria-valuenow',
    '20',
  );
  await expect(page.locator('[data-dashboard-achievement="streak-3"] [role="progressbar"]')).toHaveAttribute(
    'aria-valuenow',
    '3',
  );
  await expect(page.locator('[data-dashboard-achievement="lesson-path"]')).toContainText('已达成');
  await expect(page.locator('.dashboard-achievement-card.is-complete')).toHaveCount(4);
  await expect(page.locator('.dashboard-plan-overlay')).toHaveCount(0);
  expect(stored.vocabulary.history).toHaveLength(1);
  expect(pageErrors).toEqual([]);
});

test('UX-502 layout density switches between comfortable and compact and persists', async ({ page }) => {
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page, { module: 'dashboard' });
  const densitySelect = page.locator('#appDensitySelect');
  const task = page.locator('.dashboard-task-card').first();

  await openSettings(page);
  await expect(densitySelect).toHaveValue('comfortable');
  const comfortableBox = await task.boundingBox();
  const comfortableHeight = comfortableBox.height;
  await densitySelect.selectOption('compact');
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  await expect(densitySelect).toHaveValue('compact');
  const compactBox = await task.boundingBox();
  expect(compactBox.height).toBeLessThan(comfortableHeight);

  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 45_000 });
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  await openSettings(page);
  await expect(densitySelect).toHaveValue('compact');
  await densitySelect.selectOption('comfortable');
  await expect(page.locator('html')).toHaveAttribute('data-density', 'comfortable');
  expect(pageErrors).toEqual([]);
});

test('UX-502 compact density keeps vocabulary, grammar, and textbook surfaces usable', async ({ page }) => {
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page, { module: 'dashboard' });
  await openSettings(page);
  await page.locator('#appDensitySelect').selectOption('compact');
  await page.keyboard.press('Escape');
  await closeSidebar(page);

  for (const width of [1600, 1280]) {
    await page.setViewportSize({ width, height: 720 });
    await page.locator('#modBtnVocab').click();
    await expect(page.locator('.cc-card').first()).toBeVisible();
    await page.locator('#modBtnGrammar').click();
    await expect(page.locator('.gm-card').first()).toBeVisible();
    await page.locator('#modBtnLesson').click();
    await openTextbookDirectory(page);
    const lesson = page.locator('.tb-lesson-card').nth(1);
    await revealControl(lesson);
    await expect(lesson).toBeVisible();
    await revealControl(lesson);
    await lesson.click();
    await expect(page.locator('.tb-reader-body')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
    ).toBe(false);
  }
  expect(pageErrors).toEqual([]);
});

test('UX-503 registers the installable shell and reports offline availability', async ({ page }) => {
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page, { module: 'dashboard' });
  await openSettings(page);
  await expect(page.locator('#appPwaStatus')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.AppPWA && window.AppPWA.getState().ready), {
      timeout: 15_000,
    })
    .toBe(true);
  await expect(page.locator('#appPwaStatusText')).toContainText('可离线使用', { timeout: 15_000 });
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', /manifest\.webmanifest/);
  const registration = await page.evaluate(() => navigator.serviceWorker.getRegistration(location.href));
  expect(registration).not.toBeNull();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration(location.href);
        const worker = reg && (reg.active || reg.waiting || reg.installing);
        return worker ? worker.scriptURL : '';
      }),
    )
    .toMatch(/\/sw\.js\?v=[\w-]+$/);
  const workerSource = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration(location.href);
    return fetch(reg.active.scriptURL).then((response) => response.text());
  });
  expect(workerSource).toContain("cache: 'reload'");

  await page.context().setOffline(true);
  await expect(page.locator('#appPwaStatusText')).toContainText('当前离线');
  await page.context().setOffline(false);
  await expect(page.locator('#appPwaStatusText')).toContainText('可离线使用', { timeout: 10_000 });
  await page.reload();
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 45_000 });
  await page.context().setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page).toHaveTitle('词基流动');
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 45_000 });
  expect(await page.evaluate(() => typeof window.JPLearn.archive.exportArchive)).toBe('function');
  expect(await page.evaluate(() => typeof window.JPLearn.topLayer.requestOpen)).toBe('function');
  await page.context().setOffline(false);
  await expect(page.locator('#appPwaStatusText')).toContainText('可离线使用', { timeout: 10_000 });
  expect(pageErrors).toEqual([]);
});

test('UX-503 keeps an offline progress snapshot and syncs it after reconnecting', async ({ page }) => {
  let stored = {
    version: 2,
    vocabulary: {},
    navigation: {},
    usage: {},
    plan: {
      dailyMinutes: 10,
      dailyNewWords: 20,
      bookId: 'XinBian1',
      lessonId: 'lesson_02',
      jlptTarget: 'N5',
    },
    updatedAt: '',
  };
  let offlineSaveMode = false;
  await page.route('**/api/progress', async (route) => {
    if (route.request().method() === 'POST') {
      if (offlineSaveMode) {
        await route.abort('failed');
        return;
      }
      stored = route.request().postDataJSON();
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stored) });
  });

  const pageErrors = await openReadyApp(page, { module: 'dashboard' });
  await page.context().setOffline(true);
  offlineSaveMode = true;
  await page.evaluate(() => {
    const plan = window.ProgressStore.getPlan();
    plan.dailyMinutes = 15;
    window.ProgressStore.updatePlan(plan);
    return window.ProgressStore.save();
  });
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('jp_learning_progress_offline_v1')))
    .not.toBeNull();
  await expect(page.locator('#progressSyncStatus')).toContainText('离线', { timeout: 5_000 });

  offlineSaveMode = false;
  await page.context().setOffline(false);
  await page.evaluate(() => window.ProgressStore.save());
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('jp_learning_progress_offline_v1')))
    .toBeNull();
  expect(stored.plan.dailyMinutes).toBe(15);
  expect(pageErrors).toEqual([]);
});

test('UX-503 prefers a newer offline snapshot over an older remote progress state', async ({ page }) => {
  const remoteUpdatedAt = new Date(Date.now() - 60_000).toISOString();
  const localUpdatedAt = new Date(Date.now() + 60_000).toISOString();
  const localSnapshot = {
    version: 2,
    vocabulary: {},
    navigation: {},
    usage: {},
    plan: {
      dailyMinutes: 15,
      dailyNewWords: 20,
      bookId: 'XinBian1',
      lessonId: 'lesson_02',
      jlptTarget: 'N5',
    },
    updatedAt: localUpdatedAt,
  };
  await page.addInitScript((snapshot) => {
    localStorage.setItem('jp_learning_progress_offline_v1', JSON.stringify(snapshot));
  }, localSnapshot);
  await page.route('**/api/progress', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...localSnapshot,
        plan: { ...localSnapshot.plan, dailyMinutes: 10 },
        updatedAt: remoteUpdatedAt,
      }),
    });
  });

  const pageErrors = await openReadyApp(page, { module: 'dashboard' });
  await expect.poll(() => page.evaluate(() => window.ProgressStore.getPlan().dailyMinutes)).toBe(15);
  await expect(page.locator('.dashboard-start-meta')).toContainText('15 分钟');
  expect(pageErrors).toEqual([]);
});

test('grammar expanded reading preserves sections and returns focus after closing', async ({ page }) => {
  await useIsolatedProgress(page);
  await openReadyApp(page, { module: 'grammar' });
  const card = page.locator('.gm-card').first();
  await card.focus();
  await page.keyboard.press('Enter');
  const panel = page.locator('#grammarDetailPanel');
  const toggle = panel.locator('[data-detail-reading-toggle]');
  await expect(page.locator('.gm-detail-outline')).toBeVisible();
  const compact = await panel.boundingBox();
  await page.locator('[data-section-target="gm-section-memory"]').click();
  await expect(page.locator('#gm-section-memory')).toHaveAttribute('open', '');
  await toggle.click();
  await expect(toggle).toHaveText('收回浮窗');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await panel.boundingBox()).width).toBeGreaterThan(compact.width + 200);
  await expect(page.locator('#gm-section-memory')).toHaveAttribute('open', '');
  expect(await page.locator('#gmDetailContent').evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await panel.boundingBox()).width).toBeCloseTo(compact.width, 0);
  await expect(page.locator('#gm-section-memory')).toHaveAttribute('open', '');
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(card).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveText('展开阅读');
});

test('grammar expanded reading fits narrow screens and closes for other modules', async ({ page }) => {
  await useIsolatedProgress(page);
  await openReadyApp(page, { module: 'grammar' });
  await page.locator('.gm-card').first().click();
  await expect(page.locator('.gm-detail-outline')).toBeVisible();
  await page.locator('[data-detail-reading-toggle]').click();
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 820, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    if (viewport.width === 390)
      await expect(page.locator('html')).toHaveAttribute('data-layout-viewport', 'phone');
    await expectRegionsWithinViewport(page, [
      '#grammarDetailPanel',
      '[data-detail-reading-toggle]',
      '#grammarDetailCollapseBtn',
    ]);
  }
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.keyboard.press('Control+k');
  await expect(page.locator('#globalSearchDialog')).toBeVisible();
  await expect(page.locator('#grammarDetailPanel')).toBeHidden();
  await page.keyboard.press('Escape');
  await openSettings(page);
  await page.locator('#appScaleSelect').selectOption('1.5');
  await page.keyboard.press('Escape');
  await closeSidebar(page);
  await page.locator('.gm-card').first().click();
  await expect(page.locator('[data-detail-reading-toggle]')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('[data-detail-reading-toggle]').click();
  await expectRegionsWithinViewport(page, ['#grammarDetailPanel', '[data-detail-reading-toggle]']);
  await page.locator('#modBtnDashboard').click();
  await expect(page.locator('#grammarDetailPanel')).toBeHidden();
});

test('grammar metadata stays searchable and readable after reducing card labels', async ({ page }) => {
  await useIsolatedProgress(page);
  await openReadyApp(page, { module: 'grammar' });
  await revealControl(page.locator('#gmSearch'));
  await page.locator('#gmSearch').fill('郑重表达');
  await expect(page.locator('.gm-card')).toHaveCount(2);
  const card = page.locator('.gm-card[data-uid="N1-001"]');
  await expect(card).toBeVisible();
  await expect(card.locator('.gm-card-tag')).toHaveText('前提条件');
  await expect(card.locator('.gm-card-level')).toHaveText('N1');
  await revealControl(card);
  await card.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.gm-detail-outline')).toBeVisible();
  await page.locator('[data-section-target="gm-section-memory"]').click();
  await expect(page.locator('.gm-detail-metadata')).toBeVisible();
  await expect(page.locator('.gm-detail-metadata')).toContainText('N1语法 · 前提条件 · 存在依赖 · 郑重表达');
  await page.keyboard.press('Escape');
  await revealControl(page.locator('#gmSearch'));
  await page.locator('#gmSearch').fill('no-such-grammar-c02');
  await expect(page.locator('.gm-card')).toHaveCount(0);
  await revealControl(page.locator('#gmSearch'));
  await page.locator('#gmSearch').fill('');
  await expect(page.locator('.gm-card').first()).toBeVisible();
});

test('vocabulary metadata disclosure keeps keyboard focus and recognition text', async ({ page }) => {
  await useIsolatedProgress(page);
  await openReadyApp(page);
  const card = page.locator('.cc-card').first();
  const word = await card.locator('.cc-word').innerText();
  const meaning = await card.locator('.cc-meaning').innerText();
  const toggle = card.locator('.cc-meta-count');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(card.locator('.cc-card-extra')).toBeVisible();
  await expect(card.locator('.cc-card-extra .cc-xrow').first()).not.toBeEmpty();
  await page.keyboard.press('Enter');
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(card.locator('.cc-card-extra')).toBeHidden();
  await expect(card.locator('.cc-word')).toHaveText(word);
  await expect(card.locator('.cc-meaning')).toHaveText(meaning);
});

test('C03 course path advances current and next while keeping other steps recoverable', async ({ page }) => {
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page, { module: 'lesson' });
  await revealControl(page.locator('.tb-course-path-toggle'));
  await page.locator('.tb-course-path-toggle').click();
  const path = page.locator('[data-course-path]');
  const focused = path.locator('.tb-course-focus-steps .tb-course-step');
  const otherToggle = path.locator('.tb-course-other-toggle');
  const otherSteps = path.locator('.tb-course-other-steps');
  const stepAction = (action, step) =>
    path.locator(`[data-course-action="${action}"][data-course-step="${step}"]`);
  await expect(focused).toHaveCount(2);
  await expect(focused.nth(0)).toHaveAttribute('data-course-step', 'vocab');
  await expect(focused.nth(0)).toHaveAttribute('aria-current', 'step');
  await expect(focused.nth(1)).toHaveAttribute('data-course-step', 'reading');
  await expect(focused.nth(1)).toContainText('下一步');
  await expect(otherSteps).toBeHidden();
  await expect(path.locator('.tb-course-step:visible')).toHaveCount(2);
  await revealControl(otherToggle);
  await otherToggle.focus();
  await page.keyboard.press('Enter');
  await expect(otherToggle).toBeFocused();
  await expect(otherToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(path.locator('.tb-course-step:visible')).toHaveCount(4);
  await stepAction('skip', 'grammar').click();
  await expect(path.locator('.tb-course-progress')).toHaveText('1/4 已完成');
  await revealControl(otherToggle);
  await otherToggle.click();
  await expect(otherSteps).toBeHidden();
  await stepAction('skip', 'vocab').focus();
  await page.keyboard.press('Enter');
  await expect(focused.nth(0)).toHaveAttribute('data-course-step', 'reading');
  await expect(focused.nth(1)).toHaveAttribute('data-course-step', 'review');
  await expect(stepAction('step', 'reading')).toBeFocused();
  await stepAction('step', 'reading').click();
  await expect(page.locator('[data-course-action="step"][data-course-step="reading"]')).toBeFocused();
  await revealControl(stepAction('step', 'reading'));
  const resumeBox = await stepAction('step', 'reading').boundingBox();
  const doneBox = await stepAction('done', 'reading').boundingBox();
  expect(doneBox.y).toBeGreaterThanOrEqual(resumeBox.y + resumeBox.height);
  await stepAction('done', 'reading').click();
  await expect(stepAction('step', 'review')).toBeFocused();
  await expect(focused).toHaveCount(1);
  await stepAction('skip', 'review').click();
  await expect(focused).toHaveCount(0);
  await expect(path.locator('[aria-current="step"]')).toHaveCount(0);
  await expect(path.locator('.tb-course-complete')).toBeEnabled();
  await expect(path.locator('.tb-course-complete')).toBeFocused();
  await revealControl(otherToggle);
  await otherToggle.click();
  await expect(otherSteps.locator('.tb-course-step')).toHaveCount(4);
  await stepAction('step', 'vocab').click();
  await expect(focused.nth(0)).toHaveAttribute('data-course-step', 'vocab');
  await expect(path.locator('.tb-course-progress')).toHaveText('3/4 已完成');
  await expect(path.locator('.tb-course-complete')).toBeDisabled();
  await expect(page.locator('[data-course-action="step"][data-course-step="vocab"]')).toBeFocused();
  await openTextbookDirectory(page);
  await revealControl(page.locator('.tb-lesson-card').nth(1));
  await page.locator('.tb-lesson-card').nth(1).click();
  await revealControl(page.locator('.tb-course-path-toggle'));
  await page.locator('.tb-course-path-toggle').click();
  await expect(otherToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(path.locator('.tb-course-progress')).toHaveText('0/4 已完成');
  expect(pageErrors).toEqual([]);
});

test('C03 course disclosures fit compact scale and tablet drawer keyboard paths', async ({ page }) => {
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page, { module: 'lesson' });
  await page.setViewportSize({ width: 1280, height: 720 });
  await revealControl(page.locator('.tb-course-path-toggle'));
  await page.locator('.tb-course-path-toggle').click();
  const otherToggle = page.locator('.tb-course-other-toggle');
  await revealControl(otherToggle);
  await otherToggle.focus();
  await page.keyboard.press('Enter');
  await expect(otherToggle).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.tb-course-other-steps')).toBeHidden();
  await expectRegionsWithinViewport(page, ['.tb-course-focus-steps', '.tb-course-other-toggle']);

  await page.setViewportSize({ width: 1600, height: 900 });
  await openSettings(page);
  await page.locator('#appScaleSelect').selectOption('1.5');
  await page.keyboard.press('Escape');
  await closeSidebar(page);
  await expect(page.locator('html')).toHaveAttribute('data-layout-viewport', 'desktop');
  await revealControl(otherToggle);
  await otherToggle.scrollIntoViewIfNeeded();
  await expectRegionsWithinViewport(page, ['.tb-course-focus-steps', '.tb-course-other-toggle']);
  await openSettings(page);
  await page.locator('#appScaleSelect').selectOption('1');
  await page.keyboard.press('Escape');
  await closeSidebar(page);
  await page.setViewportSize({ width: 820, height: 900 });
  await expect(page.locator('html')).toHaveAttribute('data-layout-viewport', 'tablet');
  await revealControl(page.locator('#tabletSidebarToggle'));
  await page.locator('#tabletSidebarToggle').click();
  await expect(page.locator('#textbookSidebar')).toHaveClass(/tablet-drawer-open/);
  await revealControl(otherToggle);
  await otherToggle.focus();
  await page.keyboard.press('Enter');
  await revealControl(page.locator('.tb-course-other-steps'));
  await expect(page.locator('.tb-course-other-steps')).toBeVisible();
  await expect(otherToggle).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#textbookSidebar')).not.toHaveClass(/tablet-drawer-open/);
  await expect(page.locator('#tabletSidebarToggle')).toBeFocused();
  await revealControl(page.locator('#tabletSidebarToggle'));
  await page.locator('#tabletSidebarToggle').click();
  await expect(otherToggle).toHaveAttribute('aria-expanded', 'true');
  await revealControl(otherToggle);
  await otherToggle.click();
  await expectRegionsWithinViewport(page, ['.tb-course-focus-steps', '.tb-course-other-toggle']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(pageErrors).toEqual([]);
});

async function enterReadingFocus(page) {
  await openSettings(page);
  await page.locator('#readingFocusEnter').click();
  await expect(page.locator('html')).toHaveClass(/reading-focus/);
  await expect(page.locator('#unifiedSidebar')).toBeHidden();
  await expect(page.locator('#readingFocusExit')).toBeFocused();
}

async function sidebarPreferences(page) {
  return page.evaluate(() => [
    localStorage.getItem('jp_learning_status_bar_hidden'),
    localStorage.getItem('jp_learning_panel_layout_v1'),
  ]);
}

test('C06 reading focus preserves sidebar preferences and lesson position through a full round trip', async ({
  page,
}) => {
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  const preferences = await sidebarPreferences(page);
  const firstWord = await page.locator('.cc-word').first().innerText();
  const oldWidth = (await page.locator('#vocabMain').boundingBox()).width;
  await enterReadingFocus(page);
  await expect(page.locator('#readingFocusLocation')).toHaveText('词汇 · 专注阅读');
  expect((await page.locator('#vocabMain').boundingBox()).width).toBeGreaterThan(oldWidth + 75);
  await expect(page.locator('.cc-word').first()).toHaveText(firstWord);
  await expectRegionsWithinViewport(page, ['#readingFocusBar', '#readingFocusExit', '#vocabMain']);
  await page.keyboard.press('Escape');
  await expect(page.locator('html')).not.toHaveClass(/reading-focus/);
  // UI-ART-28: focus mode starts from the settings in the opened sidebar and
  // returns to them.
  await expect(page.locator('#appSettingsToggle')).toBeFocused();
  await expect(page.locator('body')).toHaveClass(/narrow-global-sidebar-open/);
  expect(await sidebarPreferences(page)).toEqual(preferences);
  await enterReadingFocus(page);
  await revealControl(page.locator('#readingFocusExit'));
  await page.locator('#readingFocusExit').click();
  await expect(page.locator('body')).toHaveClass(/narrow-global-sidebar-open/);
  expect(await sidebarPreferences(page)).toEqual(preferences);
  await closeSidebar(page);
  expect(await sidebarPreferences(page)).toEqual(preferences);
  await page.locator('#modBtnLesson').click();
  await expect(page.locator('.tb-reader-body')).toBeVisible();
  await page.locator('#tbReader').evaluate((reader) => {
    reader.scrollTop = 450;
  });
  const scroll = await page.locator('#tbReader').evaluate((reader) => reader.scrollTop);
  const lesson = await page.locator('#statusTextbookLesson').innerText();
  await enterReadingFocus(page);
  await expect(page.locator('#readingFocusLocation')).toHaveText('课文 · 专注阅读');
  await page.locator('#readingFocusExit').click();
  await expect(page.locator('#statusTextbookLesson')).toHaveText(lesson);
  expect(await page.locator('#tbReader').evaluate((reader) => reader.scrollTop)).toBe(scroll);
  expect(pageErrors).toEqual([]);
});

test('C06 nested detail and search dismiss before focus mode and module navigation exits focus', async ({
  page,
}) => {
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page, { module: 'grammar' });
  await enterReadingFocus(page);
  const card = page.locator('.gm-card').first();
  await card.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#grammarDetailPanel')).toBeVisible();
  await expectRegionsWithinViewport(page, ['#grammarDetailPanel']);
  await page.locator('[data-detail-reading-toggle]').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('html')).toHaveAttribute('data-layout-viewport', 'phone');
  await expectRegionsWithinViewport(page, ['#grammarDetailPanel', '#readingFocusExit']);
  const bar = await page.locator('#readingFocusBar').boundingBox();
  const detail = await page.locator('#grammarDetailPanel').boundingBox();
  expect(detail.y).toBeGreaterThanOrEqual(bar.y + bar.height);
  await page.keyboard.press('Escape');
  await expect(page.locator('#grammarDetailPanel')).toBeHidden();
  await expect(card).toBeFocused();
  await expect(page.locator('html')).toHaveClass(/reading-focus/);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.keyboard.press('Control+k');
  await expect(page.locator('#globalSearchDialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#globalSearchDialog')).toBeHidden();
  await expect(page.locator('html')).toHaveClass(/reading-focus/);
  await page.keyboard.press('Control+k');
  await page.locator('#globalSearchInput').fill('はじめまして');
  await page.locator('[aria-label="课文结果"] .global-search-result').first().click();
  await expectOnlyModuleVisible(page, 'lesson');
  await expect(page.locator('html')).not.toHaveClass(/reading-focus/);
  await expect(page.locator('#unifiedSidebar')).toBeVisible();
  await enterReadingFocus(page);
  await page.reload();
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 45_000 });
  await expect(page.locator('html')).not.toHaveClass(/reading-focus/);
  await expect(page.locator('#unifiedSidebar')).toBeVisible();
  await page.locator('#modBtnDashboard').click();
  await openSettings(page);
  await expect(page.locator('#readingFocusEnter')).toBeHidden();
  expect(pageErrors).toEqual([]);
});

test('C06 reading focus survives zoom and narrow layouts without leaking drawer state', async ({ page }) => {
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page, { module: 'lesson' });
  for (const { width, height, scale, layout } of [
    { width: 1280, height: 720, scale: '1.5', layout: 'tablet' },
    { width: 820, height: 900, scale: '1', layout: 'tablet' },
    { width: 390, height: 844, scale: '1', layout: 'phone' },
  ]) {
    await openSettings(page);
    await page.locator('#appScaleSelect').selectOption(scale);
    await page.keyboard.press('Escape');
    await closeSidebar(page);
    await page.setViewportSize({ width, height });
    await expect(page.locator('html')).toHaveAttribute('data-layout-viewport', layout);
    await revealControl(page.locator('#tabletSidebarToggle'));
    await page.locator('#tabletSidebarToggle').click();
    await expect(page.locator('#textbookSidebar')).toHaveClass(/tablet-drawer-open/);
    const preferences = await sidebarPreferences(page);
    await enterReadingFocus(page);
    await expect(page.locator('#textbookSidebar')).not.toHaveClass(/tablet-drawer-open/);
    await expect(page.locator('#tabletSidebarBackdrop')).toBeHidden();
    await expect(page.locator('#narrowGlobalSidebarBackdrop')).toBeHidden();
    await expectRegionsWithinViewport(page, ['#readingFocusExit', '#textbookMain']);
    await page.keyboard.press('Escape');
    // UI-ART-28: focus mode starts from the settings in the opened sidebar,
    // which comes back on exit.
    await expect(page.locator('#appSettingsToggle')).toBeFocused();
    await expect(page.locator('body')).toHaveClass(/narrow-global-sidebar-open/);
    await expect(page.locator('#textbookSidebar')).not.toHaveClass(/tablet-drawer-open/);
    expect(await sidebarPreferences(page)).toEqual(preferences);
    await enterReadingFocus(page);
    await expect(page.locator('body')).not.toHaveClass(/narrow-global-sidebar-open/);
    await page.setViewportSize({ width: 1600, height: 900 });
    await expect(page.locator('html')).toHaveAttribute('data-layout-viewport', 'desktop');
    await revealControl(page.locator('#readingFocusExit'));
    await page.locator('#readingFocusExit').click();
    await expect(page.locator('#unifiedSidebar')).toBeVisible();
    await expect(page.locator('#tabletSidebarBackdrop')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(pageErrors).toEqual([]);
});
