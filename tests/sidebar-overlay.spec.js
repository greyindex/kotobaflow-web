const { test, expect } = require('@playwright/test');
const {
  closeSidebar,
  expectSidebarAboveLoading,
  openReadyApp,
  openSettings,
  openSidebar,
  revealControl,
} = require('./helpers');

test.describe('pending-request stacking', () => {
  test.use({ serviceWorkers: 'block' });
  for (const [width, height] of [
    [1600, 900],
    [1280, 720],
    [390, 844],
  ]) {
    test(`loading layers stay below the sidebar during real pending requests at ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      const gates = [];
      for (const pattern of [
        '**/data/vocab_chunks/index.json',
        '**/data/grammar_index.json',
        '**/data/textbook/book_chunks/*.json*',
      ]) {
        let release;
        const promise = new Promise((resolve) => {
          release = resolve;
        });
        gates.push(release);
        await page.route(pattern, async (route) => {
          await promise;
          return route.continue();
        });
      }
      await page.route('**/data/classics_v1/**', (route) => route.fulfill({ status: 404, body: '' }));
      try {
        await page.goto('/');
        for (const [index, button, loading] of [
          [0, '#modBtnVocab', '#loading'],
          [1, '#modBtnGrammar', '#gmLoading'],
          [2, '#modBtnLesson', '#tbLoading'],
        ]) {
          await page.locator(button).click();
          await expect(page.locator(loading)).toBeVisible();
          await openSidebar(page);
          await expectSidebarAboveLoading(page);
          await page.locator('#appSettingsToggle').click();
          await expect(page.locator('#appSettingsPanel')).toBeVisible();
          await expect(page.locator(loading)).toBeVisible();
          await page.keyboard.press('Escape');
          gates[index]();
          await expect(page.locator(loading)).toBeHidden();
          await closeSidebar(page);
        }
      } finally {
        gates.forEach((release) => release());
      }
    });
  }
});

test('review regression: sidebar mouse resizing follows the pointer at every display scale', async ({
  page,
}) => {
  await openReadyApp(page);
  const shell = page.locator('#unifiedSidebar');
  for (const scale of ['1', '1.25', '1.5']) {
    await openSettings(page);
    await page.locator('#appScaleSelect').selectOption(scale);
    await page.keyboard.press('Escape');
    await closeSidebar(page);
    for (const [module, handleId] of [
      ['vocab', 'resizeSidebarVocab'],
      ['grammar', 'resizeSidebarGrammar'],
      ['lesson', 'resizeSidebarTextbook'],
    ]) {
      await page.locator(`[data-module="${module}"].mod-btn`).click();
      const handle = page.locator(`#${handleId}`);
      await revealControl(handle);
      const before = await shell.boundingBox();
      for (const delta of [40, -40]) {
        const box = await handle.boundingBox();
        const width = (await shell.boundingBox()).width;
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + delta, y, { steps: 8 });
        await page.mouse.up();
        await expect
          .poll(async () => Math.abs((await shell.boundingBox()).width - width - delta))
          .toBeLessThan(2);
      }
      expect(Math.abs((await shell.boundingBox()).width - before.width)).toBeLessThan(2);
      await page.keyboard.press('Escape');
    }
  }
});

for (const [name, width, height, theme] of [
  ['desktop', 1600, 900, 'light'],
  ['compact-dark', 1280, 720, 'dark'],
  ['phone', 390, 844, 'light'],
]) {
  test(`W-06 ${name} drawer covers without moving any module`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript((theme) => localStorage.setItem('jp_learning_theme', theme), theme);
    await openReadyApp(page);
    for (const module of ['vocab', 'grammar', 'lesson', 'dashboard']) {
      await page.locator(`[data-module="${module}"].mod-btn`).click();
      const content = page.locator('.app-container');
      const before = await content.boundingBox();
      await page.locator('#statusBarShowBtn').click();
      await expect(page.locator('#unifiedSidebar')).toHaveAttribute('aria-modal', 'true');
      await expect(content).toHaveAttribute('inert', '');
      await expect(page.locator('.app-brand-copy')).toBeVisible();
      await expect(page.locator('#moduleSwitcher')).toHaveCSS('display', 'grid');
      await expect(page.locator('#narrowGlobalSidebarBackdrop')).toBeVisible();
      expect(await content.boundingBox()).toEqual(before);
      if (module === 'vocab') {
        await expect(page.locator('#card-container .cc-card').first()).toBeVisible();
        await expect(page).toHaveScreenshot(`w06-overlay-${name}.png`, {
          animations: 'disabled',
          mask: [page.locator('#progressStrip'), page.locator('[data-visual-dynamic]')],
        });
      }
      await page.keyboard.press('Escape');
      await expect(page.locator('#statusBarShowBtn')).toBeFocused();
      await expect(content).not.toHaveAttribute('inert');
      expect(await content.boundingBox()).toEqual(before);
    }
  });
}

test('W-06 drawer closes by backdrop, traps focus, keeps settings above it and reloads closed', async ({
  page,
}) => {
  await openReadyApp(page);
  const toggle = page.locator('#statusBarShowBtn');
  await toggle.click();
  await page.keyboard.press('Tab');
  await expect(page.locator('#appBrandHome')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(toggle).toBeFocused();
  await page.locator('#narrowGlobalSidebarBackdrop').click({ position: { x: 1000, y: 300 } });
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await page.locator('#appSettingsToggle').click();
  await expect(page.locator('#narrowGlobalSidebarBackdrop')).toBeVisible();
  await expect(page.locator('#appSettingsPanel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#appSettingsPanel')).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#appSettingsToggle')).toBeFocused();
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.app-container')).not.toHaveAttribute('inert');
});

test('W-06 zoom and learning actions keep the drawer open until explicitly dismissed', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openReadyApp(page, { module: 'lesson' });
  await openSettings(page);
  await page.locator('#appScaleSelect').selectOption('1.5');
  await page.keyboard.press('Escape');
  await closeSidebar(page);
  await expect(page.locator('html')).toHaveAttribute('data-layout-viewport', 'tablet');
  const reader = page.locator('#tbReader');
  await reader.hover();
  await page.mouse.wheel(0, 450);
  await expect.poll(() => reader.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  const scroll = await reader.evaluate((el) => el.scrollTop);
  const box = await reader.boundingBox();
  await page.locator('#statusBarShowBtn').click();
  expect(await reader.boundingBox()).toEqual(box);
  expect(await reader.evaluate((el) => el.scrollTop)).toBe(scroll);
  await page.keyboard.press('Escape');
  expect(await reader.evaluate((el) => el.scrollTop)).toBe(scroll);
  await page.locator('#statusBarShowBtn').click();
  await revealControl(page.locator('[data-reader-action="continue"]'));
  await page.locator('[data-reader-action="continue"]').click();
  await expect(page.locator('#narrowGlobalSidebarBackdrop')).toBeVisible();
  await expect(page.locator('.app-container')).toHaveAttribute('inert');
  await page.locator('#modBtnVocab').click();
  await expect(page.locator('#statusBarShowBtn')).toHaveAttribute('aria-expanded', 'true');
  await page.locator('#ccStartStudy').click();
  await expect(page.locator('.study-card-view')).toBeVisible();
  await expect(page.locator('.app-container')).toHaveAttribute('inert');
  await page.locator('#statusBarShowBtn').click();
  await expect(page.locator('.app-container')).not.toHaveAttribute('inert');
});

for (const [kind, module, query, group, panel, close] of [
  ['vocabulary', 'vocab', '相容れない', '词汇结果', '#detailPanel', '#detailPanelCollapseBtn'],
  ['grammar', 'grammar', 'です', '语法结果', '#grammarDetailPanel', '#grammarDetailCollapseBtn'],
]) {
  test(`review regression: a ${kind} search result opened over the drawer is usable`, async ({ page }) => {
    const errors = await openReadyApp(page, { module });
    const toggle = page.locator('#statusBarShowBtn');
    await toggle.click();
    await expect(page.locator('.app-container')).toHaveAttribute('inert');
    await page.locator('#globalSearchToggle').click();
    await page.locator('#globalSearchInput').fill(query);
    const result = page.locator(`[aria-label="${group}"] .global-search-result`).first();
    await expect(result).toBeVisible({ timeout: 15_000 });
    await result.click();
    // The detail cannot live in the inert content area, so the drawer yields to it.
    await expect(page.locator(panel)).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.app-container')).not.toHaveAttribute('inert');
    // Vocabulary search asks for focus; both details must accept a real click.
    if (module === 'vocab') await expect(page.locator(close)).toBeFocused();
    await page.locator(close).click();
    await expect(page.locator(panel)).toBeHidden();
    expect(errors).toEqual([]);
  });
}

test('review regression: Escape handled by a child surface leaves the drawer open', async ({ page }) => {
  await openReadyApp(page);
  const toggle = page.locator('#statusBarShowBtn');
  await toggle.click();
  // A window capture listener runs before the drawer's document listener, like
  // a child layer that consumed Escape and already released the top layer.
  await page.evaluate(() =>
    window.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Escape' && window.__consumeEscape) event.preventDefault();
      },
      true,
    ),
  );
  await page.evaluate(() => (window.__consumeEscape = true));
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.evaluate(() => (window.__consumeEscape = false));
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});
