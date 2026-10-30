const { revealControl } = require('./helpers');
const { test, expect } = require('@playwright/test');
const {
  openReadyApp,
  openSettings,
  openSidebar,
  closeSidebar,
  expectRegionsWithinViewport,
  expectReadable,
} = require('./helpers');
const KEY = 'jp_learning_appearance_v1';
const presets = [
  'plain',
  'paper',
  'original',
  'ink',
  'nord',
  'catppuccin',
  'gruvbox',
  'ai',
  'konpeki',
  'matcha',
  'sakura',
  'kaki',
];
const shot = (page) => ({
  animations: 'disabled',
  // Today's activity graph follows the current date, so it is masked like other live values.
  mask: [
    page.locator('#progressStrip'),
    page.locator('[data-visual-dynamic]'),
    page.locator('[data-activity-graph]'),
  ],
  maxDiffPixelRatio: 0.005,
});
async function prepare(page, mode = 'light') {
  await page.route('**/api/progress', (route) =>
    route.fulfill({ json: { version: 2, vocabulary: {}, usage: {}, navigation: {} } }),
  );
  const errors = await openReadyApp(page, { module: 'dashboard' });
  await openSettings(page);
  await page.locator('#appThemeSelect').selectOption(mode);
  await page.locator('#appAppearanceOpen').click();
  await expect(page.locator('#appearanceDialog')).toBeVisible();
  await expect(page.locator('#appearanceApply')).toHaveCSS(
    'background-color',
    mode === 'dark' ? 'rgb(164, 189, 230)' : 'rgb(43, 76, 126)',
  );
  return errors;
}
async function openEditor(page) {
  await openSettings(page);
  await page.locator('#appAppearanceOpen').click();
  await expect(page.locator('#appearanceDialog')).toBeVisible();
}
async function choose(page, preset) {
  await page.locator(`[data-preset="${preset}"]`).click();
}
async function rootStyle(page) {
  return page.locator('html').getAttribute('style');
}
async function stored(page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
}
async function readingPreview(page) {
  await expectReadable(
    page.locator(
      '#appearancePreview .cc-word, #appearancePreview .cc-reading, .appearance-sample-reading p[lang="ja"], .appearance-sample-translation, .appearance-sample-meta, #appearancePreviewAction',
    ),
  );
}

test('integration: new appearance defaults use 简洁 and Chinese UI without replacing saved choices', async ({
  page,
}) => {
  await prepare(page);
  await expect(page.locator('[data-preset="plain"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#appearanceFont-ui')).toHaveValue('chinese');
  await expect(page.locator('html')).toHaveAttribute('data-density', 'comfortable');
  await page.locator('#appearanceEditMode').selectOption('dark');
  await expect(page.locator('[data-preset="plain"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#appearanceEditMode').selectOption('light');
  await choose(page, 'original');
  await page.locator('#appearanceFont-ui').selectOption('original');
  await page.locator('#appearanceApply').click();
  await page.reload();
  await openEditor(page);
  await expect(page.locator('[data-preset="original"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#appearanceFont-ui')).toHaveValue('original');
});

test('UI-ART-25 new visitors follow the system on 简洁 while saved choices win', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  const errors = await openReadyApp(page, { module: 'dashboard' });
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme-mode', 'auto');
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(html).toHaveAttribute('data-appearance-preset', 'plain');
  await expect(html).toHaveCSS('--surface-canvas', '#0f0f0f');
  await expect(html).toHaveCSS('--surface-raised', '#1a1a1a');
  await expect(html).toHaveCSS('--c-ink', '#e6e6e6');
  await expect(html).toHaveCSS('--c-primary', '#a4bde6');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(html).toHaveCSS('--surface-canvas', '#ffffff');
  await expect(html).toHaveCSS('--surface-raised', '#ffffff');
  await expect(html).toHaveCSS('--c-ink', '#1f2328');
  await expect(html).toHaveCSS('--c-primary', '#2b4c7e');
  expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('jp_learning_theme'))).toBeNull();
  // Someone who chose light and 和纸藏青 before keeps both on a dark system.
  await page.evaluate((key) => {
    localStorage.setItem('jp_learning_theme', 'light');
    const saved = window.AppAppearance.defaults();
    saved.light = window.AppAppearance.fromPreset('paper', 'light');
    saved.dark = window.AppAppearance.fromPreset('paper', 'dark');
    localStorage.setItem(key, JSON.stringify(saved));
  }, KEY);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.reload();
  await expect(html).toHaveAttribute('data-theme-mode', 'light');
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(html).toHaveAttribute('data-appearance-preset', 'paper');
  await expect(html).toHaveCSS('--surface-canvas', '#f3efe7');
  expect(errors).toEqual([]);
});

test('UI-ART-27 简洁 light sets secondary text one step darker and Japanese gothic text at Medium', async ({
  page,
}) => {
  const errors = await openReadyApp(page, { module: 'dashboard' });
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-appearance-preset', 'plain');
  await expect(html).toHaveCSS('--c-ink', '#1f2328');
  await expect(html).toHaveCSS('--c-ink-2', '#3e4246');
  await expect(html).toHaveCSS('--c-ink-3', '#55585c');
  await expect(html).toHaveCSS('--c-ink-4', '#626569');
  // 简洁 dark and the other palettes keep the shared steps.
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(html).toHaveCSS('--c-ink-2', '#bdbdbd');
  await expect(html).toHaveCSS('--c-ink-3', '#a1a1a1');
  await expect(html).toHaveCSS('--c-ink-4', '#909090');
  await page.emulateMedia({ colorScheme: 'light' });
  const paper = await page.evaluate(() => {
    const probe = document.createElement('div');
    document.body.appendChild(probe);
    const state = window.AppAppearance.defaults();
    state.light = window.AppAppearance.fromPreset('paper', 'light');
    window.AppAppearance.paint(probe, state, 'light');
    const values = ['--c-ink-2', '--c-ink-3', '--c-ink-4'].map((name) => probe.style.getPropertyValue(name));
    probe.remove();
    return values;
  });
  expect(paper).toEqual(['#4e4e4a', '#6a6a66', '#696965']);
  // Regular Japanese gothic text goes through the local Yu Gothic Medium/Bold
  // faces first, also when 日文黑体 is chosen explicitly.
  const faces = await page.evaluate(() =>
    [...document.fonts]
      .filter((face) => face.family.replace(/"/g, '') === 'JPLearn Gothic')
      .map((face) => face.weight)
      .sort(),
  );
  expect(faces).toEqual(['400', '700']);
  await expect(html).toHaveCSS('--font-ja-sans', /^\s*"JPLearn Gothic", "Yu Gothic"/);
  expect(
    await page.evaluate(() => window.AppAppearance.fonts.japanese.find((font) => font.id === 'gothic').value),
  ).toMatch(/^"JPLearn Gothic", "Yu Gothic"/);
  expect(errors).toEqual([]);
});

test('UI-ART-28 简洁 light draws grey icons in #0f0f0f and keeps coloured and white icons', async ({
  page,
}) => {
  const errors = await openReadyApp(page, { module: 'dashboard' });
  const html = page.locator('html');
  // The computed colour of an icon as [r, g, b]; relative colours compute to color(srgb …).
  // Polled, since a theme change runs colour transitions.
  const icon = (selector) =>
    page
      .locator(`${selector} ui-icon svg`)
      .first()
      .evaluate((svg) => {
        const value = getComputedStyle(svg).color;
        const channels = value
          .match(/[\d.]+/g)
          .map(Number)
          .slice(0, 3);
        return value.startsWith('color(srgb')
          ? channels.map((channel) => Math.round(channel * 255))
          : channels;
      });
  await expect(html).toHaveAttribute('data-appearance-preset', 'plain');
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect.poll(() => icon('#modBtnVocab')).toEqual([15, 15, 15]);
  await expect.poll(() => icon('#statusBarShowBtn')).toEqual([15, 15, 15]);
  await expect.poll(() => icon('#progressCalendarToggle')).toEqual([15, 15, 15]);
  // The current module keeps the accent, a filled button its white icon.
  await expect.poll(() => icon('#modBtnDashboard')).toEqual([43, 76, 126]);
  await expect.poll(() => icon('.dashboard-primary')).toEqual([255, 255, 255]);
  await expect(page.locator('#searchInput')).toHaveCSS('background-image', /stroke='%230F0F0F'/);
  // 简洁 dark and the other palettes keep their icon colours.
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => icon('#modBtnVocab')).toEqual([161, 161, 161]);
  await expect.poll(() => icon('#statusBarShowBtn')).toEqual([189, 189, 189]);
  await expect.poll(() => icon('.dashboard-primary')).toEqual([17, 17, 17]);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.evaluate((key) => {
    const saved = window.AppAppearance.defaults();
    saved.light = window.AppAppearance.fromPreset('paper', 'light');
    saved.dark = window.AppAppearance.fromPreset('paper', 'dark');
    localStorage.setItem(key, JSON.stringify(saved));
  }, KEY);
  await page.reload();
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 45_000 });
  await expect(html).toHaveAttribute('data-appearance-preset', 'paper');
  await expect.poll(() => icon('#modBtnVocab')).toEqual([106, 106, 102]);
  await expect.poll(() => icon('#statusBarShowBtn')).toEqual([78, 78, 74]);
  await expect(page.locator('#searchInput')).not.toHaveCSS('background-image', /0F0F0F/);
  expect(errors).toEqual([]);
});

test('review regression: dark sidebar tools stay readable across all presets', async ({ page }) => {
  test.setTimeout(100_000);
  await prepare(page, 'dark');
  for (const preset of presets) {
    await choose(page, preset);
    await page.locator('#appearanceApply').click();
    for (const module of ['vocab', 'grammar']) {
      await page.locator(`[data-module="${module}"].mod-btn`).click();
      const section = page.locator('#unifiedModuleSidebarHost .sidebar-tool-section:visible');
      await openSidebar(page);
      const summary = section.locator('summary');
      await expectReadable(summary);
      await expectReadable(summary.locator('span'));
      await summary.hover();
      await expectReadable(summary);
      await summary.press('Enter');
      await summary.press('Enter');
      await expectReadable(summary);
      await expectReadable(summary.locator('span'));
      await page.keyboard.press('Escape');
    }
    await openEditor(page);
  }
  await page.locator('#appearanceCancel').click();
});

for (const mode of ['light', 'dark']) {
  test(`W-03 ${mode} presets preview and apply readable colors without changing learning hues`, async ({
    page,
  }) => {
    test.setTimeout(100_000);
    const errors = await prepare(page, mode);
    const grades = await page
      .locator('html')
      .evaluate((el) =>
        ['--c-n5', '--c-n4', '--c-n3', '--c-n2', '--c-n1'].map((key) =>
          getComputedStyle(el).getPropertyValue(key),
        ),
      );
    for (const preset of presets) {
      const before = await rootStyle(page);
      await choose(page, preset);
      await expect(page.locator(`[data-preset="${preset}"]`)).toHaveAttribute('aria-pressed', 'true');
      expect(await rootStyle(page)).toBe(before);
      await expect(page.locator('#appearanceApply')).toBeEnabled();
      await readingPreview(page);
      await page.locator('#appearancePreviewAction').hover();
      await expectReadable(page.locator('#appearancePreviewAction'));
      await page.locator('#appearancePreviewAction').focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      await expect(page.locator('#appearancePreviewAction')).toHaveCSS('outline-style', 'solid');
      await expectReadable(page.locator('#appearancePreviewAction'), {
        property: 'outlineColor',
        againstParent: true,
        minRatio: 3,
      });
      await page.locator('#appearanceApply').click();
      await expect(page.locator('#appearanceDialog')).toBeHidden();
      expect((await stored(page))[mode].preset).toBe(preset);
      const accent = (await stored(page))[mode].colors.accent;
      await expect(page.locator('html')).toHaveCSS('--c-primary', accent);
      await expect(page.locator('html')).toHaveCSS('--c-accent', accent);
      expect(
        await page
          .locator('html')
          .evaluate((el) =>
            ['--c-n5', '--c-n4', '--c-n3', '--c-n2', '--c-n1'].map((key) =>
              getComputedStyle(el).getPropertyValue(key),
            ),
          ),
      ).toEqual(grades);
      await expectReadable(page.locator('.dashboard-progress-note, .dashboard-insight-card p'));
      await openEditor(page);
    }
    await page.locator('#appearanceCancel').click();
    expect(errors).toEqual([]);
  });
}

test('W-03 custom colors and separate local fonts survive reload and cancel/reset are reversible', async ({
  page,
}) => {
  await prepare(page);
  await choose(page, 'nord');
  await page.getByLabel('主要文字选择器', { exact: true }).fill('#223344');
  await expect(page.getByLabel('主要文字颜色值', { exact: true })).toHaveValue('#223344');
  await page.getByLabel('主要文字颜色值', { exact: true }).fill('#234');
  await page.locator('#appearanceFont-ui').selectOption('chinese');
  await page.locator('#appearanceFont-japanese').selectOption('mincho');
  await expect(page.locator('#appearancePreviewName')).toContainText('自定义');
  await expect(page.locator('#appearancePreview .cc-word')).toHaveCSS('font-family', /Yu Mincho/);
  await page.locator('#appearanceRestorePreset').click();
  await expect(page.getByLabel('主要文字颜色值', { exact: true })).toHaveValue('#2e3440');
  await expect(page.locator('#appearanceFont-japanese')).toHaveValue('mincho');
  await page.getByLabel('主要文字颜色值', { exact: true }).fill('#234');
  await page.locator('#appearanceApply').click();
  const saved = await stored(page);
  expect(saved.light.colors.text).toBe('#223344');
  expect(saved.fonts).toEqual({ ui: 'chinese', japanese: 'mincho' });
  await page.reload();
  await expect(page.locator('html')).toHaveCSS('--c-ink', '#223344');
  await expect(page.locator('html')).toHaveCSS('--font-ui', /Microsoft YaHei/);
  await openEditor(page);
  await choose(page, 'gruvbox');
  await page.locator('#appearanceCancel').click();
  expect(await stored(page)).toEqual(saved);
  await openEditor(page);
  await page.locator('#appearanceReset').click();
  await page.keyboard.press('Escape');
  expect(await stored(page)).toEqual(saved);
  await openEditor(page);
  await page.locator('#appearanceReset').click();
  await expect(page.locator('#appearanceStatus')).toContainText('默认配色（简洁）');
  await page.locator('#appearanceApply').click();
  await expect(page.locator('html')).toHaveCSS('--surface-canvas', '#ffffff');
  const reset = await stored(page);
  expect(reset.light.preset).toBe('plain');
  expect(reset.dark.preset).toBe('plain');
  expect(reset.fonts).toEqual({ ui: 'chinese', japanese: 'original' });
  await expect(page.locator('html')).toHaveCSS('--font-ui', /Microsoft YaHei/);
});

test('W-03 separate light and dark drafts follow system without overwriting density or zoom', async ({
  page,
}) => {
  await prepare(page);
  await choose(page, 'nord');
  await page.locator('#appearanceEditMode').selectOption('dark');
  await choose(page, 'catppuccin');
  await page.locator('#appearanceEditMode').selectOption('light');
  await expect(page.locator('[data-preset="nord"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#appearanceApply').click();
  await openSettings(page);
  await page.locator('#appDensitySelect').selectOption('compact');
  await page.locator('#appScaleSelect').selectOption('1.25');
  await page.locator('#appThemeSelect').selectOption('auto');
  await page.keyboard.press('Escape');
  const saved = await stored(page);
  await expect(page.locator('html')).toHaveCSS('--surface-canvas', '#e5e9f0');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveCSS('--surface-canvas', '#181825');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme-mode', 'auto');
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  await expect(page.locator('html')).toHaveCSS('--surface-canvas', '#181825');
  await expect(page.locator('html')).toHaveCSS('--app-scale', '1.25');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveCSS('--surface-canvas', '#e5e9f0');
  expect(await stored(page)).toEqual(saved);
});

test('W-03 invalid hex is isolated and low contrast has an explicit reversible correction', async ({
  page,
}) => {
  await prepare(page);
  const input = page.getByLabel('主要文字颜色值', { exact: true });
  const before = await page.locator('#appearancePreview').getAttribute('style');
  await input.fill('#zzz');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#appearanceApply')).toBeDisabled();
  expect(await page.locator('#appearancePreview').getAttribute('style')).toBe(before);
  await page.locator('#appearanceEditMode').selectOption('dark');
  await expect(page.locator('#appearanceApply')).toBeDisabled();
  await page.locator('#appearanceEditMode').selectOption('light');
  await expect(input).toHaveValue('#zzz');
  await input.fill('#fff');
  await page.getByLabel('阅读纸面颜色值', { exact: true }).fill('#fff');
  await page.getByLabel('页面背景颜色值', { exact: true }).fill('#000');
  await page.getByLabel('强调色颜色值', { exact: true }).fill('#fff');
  await expect(page.locator('#appearanceRepair')).toBeVisible();
  await expect(page.locator('#appearanceApply')).toBeDisabled();
  await page.locator('#appearanceRepair').click();
  await expect(page.locator('#appearanceApply')).toBeEnabled();
  await readingPreview(page);
  expect(await stored(page)).toBeNull();
  await page.locator('#appearanceApply').click();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'custom');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'custom');
});

test('W-03 save failure keeps the draft open and the applied page unchanged', async ({ page }) => {
  await prepare(page);
  const original = await rootStyle(page);
  await page.evaluate((key) => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException('full', 'QuotaExceededError');
      return set.call(this, name, value);
    };
  }, KEY);
  await choose(page, 'ink');
  await page.locator('#appearanceApply').click();
  await expect(page.locator('#appearanceStatus')).toContainText('未能保存');
  await expect(page.locator('#appearanceDialog')).toBeVisible();
  expect(await rootStyle(page)).toBe(original);
  expect(await stored(page)).toBeNull();
  await page.locator('#appearanceCancel').click();
  await expect(page.locator('#appSettingsToggle')).toBeFocused();
});

test('W-03 invalid stored preferences and arbitrary font values fall back before painting', async ({
  page,
}) => {
  await page.addInitScript(
    (key) =>
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          light: { preset: 'nord', colors: { accent: '#fff', canvas: '#fff', paper: '#fff', text: '#fff' } },
          dark: { colors: { accent: 'url(https://invalid.test/font)' } },
          fonts: { ui: 'url(https://invalid.test/font)', japanese: 'missing-font' },
        }),
      ),
    KEY,
  );
  const errors = await prepare(page);
  await expect(page.locator('html')).toHaveCSS('--surface-canvas', '#ffffff');
  await expect(page.locator('html')).toHaveCSS('--c-ink', '#1f2328');
  await expect(page.locator('#appearanceFont-ui')).toHaveValue('chinese');
  await expect(page.locator('#appearanceFont-japanese')).toHaveValue('original');
  await page.locator('#appearanceCancel').click();
  expect(errors).toEqual([]);
  for (const value of ['{broken-json', '{"version":99,"fonts":{"ui":"system"}}']) {
    const other = await page.context().newPage();
    await other.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: KEY, value });
    const otherErrors = await prepare(other);
    await expect(other.locator('html')).toHaveCSS('--surface-canvas', '#ffffff');
    await expect(other.locator('#appearanceFont-ui')).toHaveValue('chinese');
    await expect(other.locator('#appearanceApply')).toBeEnabled();
    expect(otherErrors).toEqual([]);
    await other.close();
  }
});

test('W-03 native modal traps focus, restores settings focus and protects a stale draft', async ({
  page,
  context,
}) => {
  await prepare(page);
  await expect(page.locator('#appSettingsPanel')).toBeHidden();
  await expect(page.locator('#appearanceEditMode')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#appearanceClose')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#appearanceApply')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#appearanceClose')).toBeFocused();
  await choose(page, 'nord');
  const other = await context.newPage();
  await prepare(other);
  await choose(other, 'ink');
  await other.locator('#appearanceApply').click();
  await expect(page.locator('#appearanceStatus')).toContainText('另一页面已更新');
  await expect(page.locator('#appearanceApply')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.locator('#appSettingsToggle')).toBeFocused();
  await openEditor(page);
  await expect(page.locator('[data-preset="ink"]')).toHaveAttribute('aria-pressed', 'true');
  await other.close();
});

for (const scenario of [
  {
    name: 'desktop-light',
    viewport: { width: 1600, height: 900 },
    mode: 'light',
    preset: 'nord',
    scale: '1',
  },
  {
    name: 'compact-dark',
    viewport: { width: 1280, height: 720 },
    mode: 'dark',
    preset: 'catppuccin',
    scale: '1',
  },
  { name: 'narrow', viewport: { width: 390, height: 844 }, mode: 'light', preset: 'gruvbox', scale: '1' },
  { name: 'zoom150', viewport: { width: 1280, height: 720 }, mode: 'dark', preset: 'nord', scale: '1.5' },
]) {
  test(`W-03 appearance editor fits ${scenario.name} and keeps all actions reachable`, async ({ page }) => {
    await page.setViewportSize(scenario.viewport);
    await page.addInitScript(() => {
      localStorage.setItem('jp_learning_mobile_notice_ack_v1', '1');
    });
    await prepare(page, scenario.mode);
    if (scenario.scale !== '1') {
      await page.locator('#appearanceCancel').click();
      await openSettings(page);
      await page.locator('#appScaleSelect').selectOption(scenario.scale);
      await page.locator('#appAppearanceOpen').click();
    }
    await choose(page, scenario.preset);
    await expectRegionsWithinViewport(page, [
      '#appearanceDialog',
      '.appearance-heading',
      '.appearance-footer',
      '#appearanceApply',
      '#appearanceCancel',
    ]);
    expect(await page.locator('#appearanceDialog').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    // PUB-FIX-04: the reading sample quotes the original course, not a withheld book.
    await expect(
      page.locator('#appearancePreview .appearance-sample-reading .appearance-sample-label'),
    ).toHaveText('新课程 1 · 第2课节选');
    await expect(page.locator('#appearancePreview .appearance-sample-reading p[lang="ja"]')).toContainText(
      '私はリン・メイです。',
    );
    await expect(page.locator('#appearanceDialog')).toHaveScreenshot(`w03-editor-${scenario.name}.png`, {
      animations: 'disabled',
      maxDiffPixelRatio: 0.005,
    });
    await page.locator('#appearanceFont-japanese').selectOption('gothic');
    if (await page.locator('#appearancePreviewJump').isVisible())
      await page.locator('#appearancePreviewJump').click();
    await page.locator('#appearancePreviewAction').click();
    await expect(page.locator('#appearancePreviewFeedback')).toContainText('预览完成');
    await page.locator('#appearancePreviewFavorite').click();
    await expect(page.locator('#appearancePreviewFavorite')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#appearanceApply').click();
    await expect(page.locator('#appearanceDialog')).toBeHidden();
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'custom');
  });
}

for (const scenario of [
  { name: 'nord-light', mode: 'light', preset: 'nord', viewport: { width: 1600, height: 900 } },
  { name: 'catppuccin-dark', mode: 'dark', preset: 'catppuccin', viewport: { width: 1280, height: 720 } },
]) {
  test(`W-03 ${scenario.name} covers all four modules and detail reading`, async ({ page }) => {
    await page.setViewportSize(scenario.viewport);
    const errors = await prepare(page, scenario.mode);
    await choose(page, scenario.preset);
    await page.locator('#appearanceFont-japanese').selectOption('gothic');
    await page.locator('#appearanceApply').click();
    await closeSidebar(page);
    await expectReadable(page.locator('.dashboard-progress-note, .dashboard-insight-card p'));
    for (const module of ['Dashboard', 'Vocab', 'Grammar', 'Lesson']) {
      await page.locator(`#modBtn${module}`).click();
      if (module === 'Vocab') {
        await page.locator('#card-container .cc-card-body').first().press('Enter');
        await expect(page.locator('#detailPanel')).toBeVisible();
      }
      if (module === 'Grammar') {
        await page.locator('.gm-card').first().press('Enter');
        await expect(page.locator('.gm-detail-outline')).toBeVisible();
        await expectReadable(page.locator('.gm-detail-outline button'));
      }
      if (module === 'Lesson') {
        const directory = page.locator('.tb-lesson-directory');
        await revealControl(directory);
        if ((await directory.getAttribute('open')) === null) await directory.locator('summary').click();
        await revealControl(page.locator('.tb-lesson-card').nth(1));
        await page.locator('.tb-lesson-card').nth(1).click();
        await expect(page.locator('.tb-inline-highlight-link').first()).toBeVisible();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page).toHaveScreenshot(`w03-${scenario.name}-${module.toLowerCase()}.png`, shot(page));
    }
    expect(errors).toEqual([]);
  });
}

test('review regression: Today desk small text stays readable in every light preset', async ({ page }) => {
  test.setTimeout(100_000);
  await prepare(page, 'light');
  // The desk surface is a color-mix(); read its sRGB value instead of rgba().
  const deskContrast = () =>
    page.evaluate(() => {
      const parse = (value) => {
        const srgb = value.match(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/);
        if (srgb) return [srgb[1] * 255, srgb[2] * 255, srgb[3] * 255, srgb[4] === undefined ? 1 : +srgb[4]];
        const c = value.match(/[\d.]+/g).map(Number);
        return [c[0], c[1], c[2], c[3] ?? 1];
      };
      const over = (fg, bg) => fg.slice(0, 3).map((ch, i) => ch * fg[3] + bg[i] * (1 - fg[3]));
      const lum = (rgb) =>
        rgb.reduce((sum, ch, i) => {
          const v = ch / 255;
          return (
            sum + (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i]
          );
        }, 0);
      const card = document.querySelector('.dashboard-start-card');
      const bg = over(parse(getComputedStyle(card).backgroundColor), [255, 255, 255]);
      return ['.dashboard-card-kicker', '.dashboard-start-meta span:not(.dashboard-start-meta-label)'].map(
        (selector) => {
          const fg = over(parse(getComputedStyle(card.querySelector(selector)).color), bg);
          const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
          return { selector, ratio: (a + 0.05) / (b + 0.05) };
        },
      );
    });
  for (const preset of presets) {
    await choose(page, preset);
    await page.locator('#appearanceApply').click();
    await expect(page.locator('#appearanceDialog')).toBeHidden();
    for (const { selector, ratio } of await deskContrast())
      expect(ratio, `${preset} ${selector}`).toBeGreaterThanOrEqual(4.5);
    // Palettes that already pass keep the designed tints untouched.
    if (preset !== 'catppuccin') expect(await rootStyle(page)).not.toMatch(/--desk-(kicker|ink-3)-fit/);
    await openEditor(page);
  }
});
