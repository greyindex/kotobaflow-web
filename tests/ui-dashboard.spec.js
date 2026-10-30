const { test, expect } = require('@playwright/test');
const {
  DEFAULT_LAYOUT_STORAGE,
  closeSidebar,
  openReadyApp,
  openSettings,
  revealControl,
} = require('./helpers');
const { heroTextContrast } = require('./dashboard-contrast');

test.use({ serviceWorkers: 'block', storageState: DEFAULT_LAYOUT_STORAGE });
test.beforeEach(async ({ page }) => {
  await page.route('**/js/storage-config.js*', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: "window.JPLearnStorageConfig = { mode: 'browser' };",
    }),
  );
});

async function setTheme(page, mode) {
  await openSettings(page);
  await page.locator('#appThemeSelect').selectOption(mode);
  await page.keyboard.press('Escape');
  await expect(page.locator('#appSettingsPanel')).toBeHidden();
  await closeSidebar(page);
}

for (const [width, height] of [
  [1600, 900],
  [1280, 720],
  [390, 844],
]) {
  test(`UI-ART-04/09 today uses an aligned paper ledger at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const errors = await openReadyApp(page, { module: 'dashboard' });
    const shell = page.locator('.dashboard-shell');
    const originalEdge = await shell.boundingBox();
    const goal = page.locator('.dashboard-progress-card');
    await expect(goal).toHaveCSS('border-radius', '0px');
    await expect(goal).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(page.locator('.dashboard-progress-grid')).toHaveCSS('flex-direction', 'column');
    await expect(page.locator('.dashboard-progress-grid > div').first()).toHaveCSS(
      'flex-direction',
      'row-reverse',
    );
    await expect(page.locator('.dashboard-section-title > div > span')).toHaveCount(0);
    await expect(page.locator('.dashboard-eyebrow')).toHaveCount(1);
    expect(
      await page.locator('.dashboard-start-card').evaluate((el) => getComputedStyle(el, '::after').content),
    ).toContain('今日');
    await expect(page.locator('.dashboard-primary')).toBeInViewport();
    await page.getByRole('button', { name: '设置学习计划', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '设置你的轻量计划', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.locator('#modBtnGrammar').click();
    const book = page.locator('#gmGrammarList .book-frame');
    await expect(book).toBeVisible();
    const bookEdge = await book.boundingBox();
    expect(Math.abs(bookEdge.x - originalEdge.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(bookEdge.x + bookEdge.width - originalEdge.x - originalEdge.width)).toBeLessThanOrEqual(
      1,
    );
    expect(errors).toEqual([]);
  });
}

for (const [width, height] of [
  [1600, 900],
  [1280, 720],
]) {
  test(`UI-ART-13 dark hero and kana chart stay readable at ${width}`, async ({ page }) => {
    test.setTimeout(100_000);
    await page.setViewportSize({ width, height });
    const errors = await openReadyApp(page, { module: 'dashboard' });
    await setTheme(page, 'dark');
    await expect
      .poll(() =>
        page.locator('.dashboard-start-card').evaluate((el) => {
          const color = (value) => {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 1;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = value;
            ctx.fillRect(0, 0, 1, 1);
            return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3);
          };
          const card = color(getComputedStyle(el).backgroundColor);
          const canvas = color(
            getComputedStyle(document.documentElement).getPropertyValue('--surface-canvas'),
          );
          return card.reduce((sum, c, i) => sum + Math.abs(c - canvas[i]), 0);
        }),
      )
      .toBeGreaterThan(24);
    await expect(page.locator('.dashboard-start-card')).toHaveCSS('border-radius', '16px');
    for (const preset of [
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
    ]) {
      await openSettings(page);
      await page.locator('#appAppearanceOpen').click();
      await page.locator('#appearanceEditMode').selectOption('dark');
      await page.locator(`[data-preset="${preset}"]`).click();
      await page.locator('#appearanceApply').click();
      await page.keyboard.press('Escape');
      await expect(page.locator('#appSettingsPanel')).toBeHidden();
      await closeSidebar(page);
      for (const hover of [false, true]) {
        if (hover) await page.locator('.dashboard-primary').hover();
        else await page.mouse.move(1, 1);
        const samples = await heroTextContrast(page);
        expect(samples.length).toBeGreaterThan(0);
        for (const sample of samples) {
          const label = `${preset}: ${sample.text}`;
          expect(Number.isFinite(sample.ratio), label).toBe(true);
          expect(sample.ratio, label).toBeGreaterThanOrEqual(sample.threshold);
        }
      }
    }
    await page.locator('#modBtnLesson').click();
    await revealControl(page.locator('#tbBookSelect'));
    await page.locator('#tbBookSelect').selectOption('XinBian1');
    const lesson = page.locator('.tb-lesson-card[data-lesson-id="lesson_01"]');
    await revealControl(lesson);
    await lesson.click();
    await page.keyboard.press('Escape');
    const chart = page.locator('.tb-phonetic-lead-media .tb-section-image');
    await expect(chart).toHaveCSS('filter', 'brightness(0.78) contrast(0.95)');
    expect(await chart.evaluate((image) => image.decode().then(() => image.naturalWidth > 0))).toBe(true);
    await setTheme(page, 'light');
    await expect(chart).toHaveCSS('filter', 'none');
    expect(errors).toEqual([]);
  });
}

// UI-ART-25: the 简洁 default turns the ink desk into a plain ruled card with an
// accent action; other presets keep the desk.
for (const mode of ['light', 'dark']) {
  test(`UI-ART-25 简洁 hero is a plain card with accent actions in ${mode}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: mode });
    const errors = await openReadyApp(page, { module: 'dashboard' });
    await expect(page.locator('html')).toHaveAttribute('data-appearance-preset', 'plain');
    await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
    const hero = page.locator('.dashboard-start-card');
    const look = () =>
      hero.evaluate((el) => {
        const root = getComputedStyle(document.documentElement);
        const probe = (value) => {
          const span = document.createElement('span');
          span.style.color = value;
          document.body.appendChild(span);
          const color = getComputedStyle(span).color;
          span.remove();
          return color;
        };
        const style = getComputedStyle(el);
        const primary = getComputedStyle(el.querySelector('.dashboard-primary'));
        return {
          background: style.backgroundColor,
          paper: probe(root.getPropertyValue('--surface-raised')),
          border: style.borderTopWidth + ' ' + style.borderTopStyle,
          borderColor: style.borderTopColor,
          rule: probe(root.getPropertyValue('--c-border-soft')),
          shadow: style.boxShadow,
          tide: getComputedStyle(el, '::before').content,
          seal: getComputedStyle(el, '::after').content,
          action: primary.backgroundColor,
          accent: probe(root.getPropertyValue('--c-primary')),
          actionShadow: primary.boxShadow,
        };
      });
    const plain = await look();
    expect(plain.background).toBe(plain.paper);
    expect(plain.background).toBe(mode === 'dark' ? 'rgb(26, 26, 26)' : 'rgb(255, 255, 255)');
    expect(plain.border).toBe('1px solid');
    expect(plain.borderColor).toBe(plain.rule);
    expect(plain.shadow).toBe('none');
    expect(plain.tide).toBe('none');
    expect(plain.seal).toContain('今日');
    expect(plain.action).toBe(plain.accent);
    expect(plain.actionShadow).toBe('none');
    for (const hover of [false, true]) {
      if (hover) await page.locator('.dashboard-primary').hover();
      else await page.mouse.move(1, 1);
      for (const sample of await heroTextContrast(page)) {
        expect(sample.ratio, `plain ${mode}: ${sample.text}`).toBeGreaterThanOrEqual(sample.threshold);
      }
    }
    await page.locator('.dashboard-primary').focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(page.locator('.dashboard-primary')).toHaveCSS('outline-style', 'solid');
    // A saved 和纸藏青 palette keeps the ink desk and its vermilion action.
    await openSettings(page);
    await page.locator('#appAppearanceOpen').click();
    await page.locator('#appearanceEditMode').selectOption(mode);
    await page.locator('[data-preset="paper"]').click();
    await page.locator('#appearanceApply').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('html')).toHaveAttribute('data-appearance-preset', 'paper');
    const desk = await look();
    expect(desk.background).not.toBe(desk.paper);
    expect(desk.tide).not.toBe('none');
    expect(desk.action).not.toBe(desk.accent);
    expect(errors).toEqual([]);
  });
}

// Today is one screen on a desktop window: no page scrollbar for a new learner, for one
// with due reviews and weak words, or for one with a lesson to resume (two hero actions).
function todayProgress(kind) {
  const now = new Date();
  const dateKey = (date) =>
    [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');
  const usage = {};
  for (let offset = 0; offset < 120; offset += 1) {
    if (offset % 3 === 1) continue;
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset, 10);
    usage[dateKey(day)] = { focusedMs: (5 + ((offset * 7) % 40)) * 60_000, checkedIn: offset % 2 === 0 };
  }
  const history = [3, 2, 1].map((daysAgo) => ({
    date: new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, 10).toISOString(),
    total: 10 * daysAgo,
    known: 6 * daysAgo,
    fuzzy: 3 * daysAgo,
    unknown: daysAgo,
  }));
  return {
    version: 2,
    vocabulary: {
      known: Array.from({ length: 12 }, (_, index) => index + 10),
      fuzzy: kind === 'review' ? [2, 4, 6] : [],
      unknown: kind === 'review' ? [3, 5] : [],
      favorite: [],
      grammarFavorite: [],
      history,
      srs: [],
    },
    navigation:
      kind === 'resume'
        ? { version: 1, lastModule: 'lesson', vocab: {}, grammar: {}, textbook: { lessonId: 'lesson_02' } }
        : {},
    usage,
    updatedAt: now.toISOString(),
  };
}

for (const kind of ['new', 'review', 'resume']) {
  test(`Today fits one desktop screen without a scrollbar for a ${kind} learner`, async ({ page }) => {
    if (kind !== 'new') {
      await page.addInitScript((snapshot) => {
        const key = 'jp_learning_progress_browser_v1';
        if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(snapshot));
      }, todayProgress(kind));
    }
    await page.setViewportSize({ width: 1600, height: 900 });
    const errors = await openReadyApp(page, { module: 'dashboard' });
    if (kind === 'review') await expect(page.locator('.dashboard-weak-list li')).toHaveCount(5);
    if (kind === 'resume') await expect(page.locator('.dashboard-start-actions > button')).toHaveCount(2);
    if (kind !== 'new') {
      // FIX-30: a milestone under way shows its count, never an "in progress" label.
      await expect(page.locator('[data-dashboard-achievement="known-20"]')).toContainText('12 / 20');
      await expect(page.locator('[data-dashboard-achievements]')).not.toContainText('进行中');
    }
    // 1366x600 is a 768px laptop screen with the browser's bookmarks bar shown.
    for (const [width, height] of [
      [1920, 960],
      [1600, 900],
      [1280, 720],
      [1366, 600],
    ]) {
      await page.setViewportSize({ width, height });
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const main = document.getElementById('dashboardMain');
              const root = document.documentElement;
              return Math.max(
                main.scrollHeight - main.clientHeight,
                root.scrollHeight - root.clientHeight,
                root.scrollWidth - root.clientWidth,
              );
            }),
          { message: `${kind} learner at ${width}x${height}` },
        )
        .toBeLessThanOrEqual(1);
      await expect(page.locator('.dashboard-primary')).toBeInViewport();
      await expect(page.locator('[data-dashboard-activity]')).toBeInViewport({ ratio: 1 });
      await expect(page.locator('.dashboard-recent')).toBeInViewport({ ratio: 1 });
    }
    expect(errors).toEqual([]);
  });
}
