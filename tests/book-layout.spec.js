const { test, expect } = require('@playwright/test');
const {
  DEFAULT_LAYOUT_STORAGE,
  closeSidebar,
  openReadyApp,
  openSettings,
  revealControl,
  selectTextbook,
} = require('./helpers');

test.use({ serviceWorkers: 'block', storageState: DEFAULT_LAYOUT_STORAGE });

test.beforeEach(async ({ page }) => {
  await page.route('**/js/storage-config.js*', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: "window.JPLearnStorageConfig = { mode: 'browser' };",
    }),
  );
  // Optional generated illustrations are not present in a clean checkout. Keep
  // these layout baselines identical there and on a fully installed workstation.
  await page.route('**/kotobaflow_unit_images_v1/images.json*', (route) =>
    route.fulfill({
      json: { schema: 1, count: 0, images: {} },
    }),
  );
});

async function openLesson(page) {
  await selectTextbook(page, 'KotobaFlow1');
  const directory = page.locator('.tb-lesson-directory');
  await revealControl(directory.locator('summary'));
  if (!(await directory.evaluate((el) => el.open))) await directory.locator('summary').click();
  const lesson = page.locator('.tb-lesson-card[data-lesson-id="lesson_01"]');
  await revealControl(lesson);
  await lesson.click();
  await expect(lesson).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Escape');
  await expect(page.locator('#narrowGlobalSidebarBackdrop')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('#tbLessonHeading .page-heading-title')).toContainText('こんにちは');
}

async function footerGeometry(book) {
  return book.locator('.book-footer').evaluate((footer) => {
    const selectors = [
      '.book-turn.is-prev',
      '.book-page-select',
      '.book-page-total',
      '.book-status-extra',
      '.book-turn.is-next',
    ];
    const bounds = footer.getBoundingClientRect();
    const elements = selectors
      .map((selector) => footer.querySelector(selector))
      .filter((el) => el.getClientRects().length);
    const rects = elements.map((el) => el.getBoundingClientRect());
    const overlaps = rects.some((a, i) =>
      rects.some(
        (b, j) =>
          i !== j &&
          Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
          Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1,
      ),
    );
    const targets = elements.filter((el) => el.matches('button, select') && !el.disabled);
    return {
      overlaps,
      within: rects.every((r) => r.left >= bounds.left - 1 && r.right <= bounds.right + 1 && r.width > 0),
      hits: targets.map((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return hit === el || el.contains(hit);
      }),
    };
  });
}

for (const [width, height, scale] of [
  [1600, 900, '1'],
  [1280, 720, '1'],
  [768, 1024, '1'],
  [390, 844, '1'],
  [768, 1024, '1.25'],
  [390, 844, '1.5'],
]) {
  test(`BOOK-FIX-03 footer controls fit and remain real click targets at ${width} scale ${scale}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    const errors = await openReadyApp(page, { module: 'lesson' });
    await openSettings(page);
    await page.locator('#appScaleSelect').selectOption(scale);
    await page.keyboard.press('Escape');
    await closeSidebar(page);
    await openLesson(page);
    const book = page.locator('#tbReader .book-frame');
    const picker = book.locator('.book-page-select');
    await picker.selectOption('1');
    await expect.poll(() => footerGeometry(book)).toMatchObject({ overlaps: false, within: true });
    expect((await footerGeometry(book)).hits.every(Boolean)).toBe(true);
    await book.locator('.book-turn.is-prev').click();
    await expect(picker).toHaveValue('0');
    await expect.poll(() => footerGeometry(book)).toMatchObject({ overlaps: false, within: true });
    expect((await footerGeometry(book)).hits.every(Boolean)).toBe(true);
    await page.screenshot({ path: `local/qa/batch2-2026-10-07/layout/footer-${width}-${scale}.png` });
    await book.locator('.book-turn.is-prev').click();
    await expect(page.locator('#tbLessonHeading .page-heading-title')).toContainText('第0课');
    expect(errors).toEqual([]);
  });
}

for (const [width, height] of [
  [1600, 900],
  [1280, 720],
]) {
  for (const [module, host] of [
    ['vocab', '#card-container'],
    ['grammar', '#gmGrammarList'],
    ['lesson', '#tbReader'],
  ]) {
    test(`BOOK-QA-01 default ${module} book visual baseline at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await openReadyApp(page, { module });
      if (module === 'lesson') await openLesson(page);
      const book = page.locator(host + ' .book-frame');
      await expect(book).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expect(book.locator('.book-page-select')).toHaveValue('0');
      await page.mouse.move(width - 2, 2);
      await book.locator('.book-body').evaluate((el) => el.focus({ preventScroll: true }));
      await expect(book).toHaveScreenshot(`book-${module}-${width}.png`, {
        animations: 'disabled',
        maxDiffPixelRatio: 0.005,
      });
    });
  }
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1280, height: 720 },
]) {
  test(`UI-SMALL-01 section read-aloud buttons stay short and inside their column at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const errors = await openReadyApp(page, { module: 'lesson' });
    await openLesson(page);
    const buttons = await page.locator('#tbReader .tb-section-head').evaluateAll((heads) =>
      heads
        .map((head) => {
          const button = head.querySelector('.tb-tts-btn');
          if (!button) return null;
          const badge = head.querySelector('.tb-section-badge').textContent.trim();
          const box = button.getBoundingClientRect();
          const column = head.getBoundingClientRect();
          return {
            badge,
            label: button.textContent.trim(),
            title: button.getAttribute('title') || '',
            inside: box.left >= column.left - 1 && box.right <= column.right + 1,
            clipped: button.scrollWidth > button.clientWidth + 1,
          };
        })
        .filter(Boolean),
    );
    expect(buttons.length).toBeGreaterThan(1);
    for (const button of buttons) {
      expect(button.inside, button.label).toBe(true);
      expect(button.clipped, button.label).toBe(false);
      if (button.badge.length > 6) {
        // The heading already shows a long title; the button does not repeat it.
        expect(button.label).toBe('朗读本段');
        expect(button.title).toBe('朗读' + button.badge);
      } else expect(button.label).toBe('朗读' + button.badge);
    }
    expect(buttons.some((button) => button.badge.length > 6)).toBe(true);
    expect(errors).toEqual([]);
  });
}

for (const { width, height, scale, applied, option } of [
  { width: 390, height: 844, scale: '1.5', applied: '1.21', option: '150% → 121%' },
  { width: 390, height: 844, scale: '1', applied: '1', option: '100%' },
  { width: 768, height: 1024, scale: '1.5', applied: '1.5', option: '150%' },
]) {
  test(`FIX-25 narrow layouts keep the reader, heading and settings reachable at ${width} scale ${scale}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    const errors = await openReadyApp(page, { module: 'lesson' });
    await openSettings(page);
    await page.locator('#appScaleSelect').selectOption(scale);
    // The saved choice applies again on the next visit.
    await page.reload();
    await expect(page.locator('#loading')).toHaveClass(/hidden/);
    await openSettings(page);
    // A phone keeps at least a 320px layout; the choice says what it applies.
    await expect(page.locator('html')).toHaveAttribute('data-app-scale', applied);
    await expect(page.locator('#appScaleSelect option:checked')).toHaveText(option);
    // The panel opens beside its toggle, which stays clickable to close it.
    const toggleHit = () =>
      page.locator('#appSettingsToggle').evaluate((toggle) => {
        const r = toggle.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!hit && toggle.contains(hit);
      });
    expect(await toggleHit()).toBe(true);
    await page.locator('#appSettingsToggle').click();
    await expect(page.locator('#appSettingsPanel')).toBeHidden();
    await closeSidebar(page);
    await page.locator('#modBtnLesson').click();
    await openLesson(page);

    const reader = page.locator('.tb-reader--book');
    expect(await reader.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    const resume = page.locator('#tbLessonHeading').getByRole('button', { name: /继续本课/ });
    await expect(resume).toBeInViewport({ ratio: 1 });
    await resume.click({ trial: true });
    for (const module of ['#modBtnGrammar', '#modBtnVocab']) {
      await page.locator(module).click();
      await expect(page.locator('.book-frame:visible').first()).toBeVisible();
      expect(
        await page.evaluate(
          () =>
            [...document.querySelectorAll('body *')].filter((el) => {
              const style = getComputedStyle(el);
              return (
                /(auto|scroll)/.test(style.overflowX) &&
                el.getClientRects().length &&
                !el.closest('[data-activity-graph]') &&
                el.scrollWidth > el.clientWidth + 1
              );
            }).length,
        ),
      ).toBe(0);
    }
    expect(errors).toEqual([]);
  });
}

test('FIX-24 compact density makes vocabulary cards denser than comfortable in both layouts', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  const errors = await openReadyApp(page, { module: 'vocab' });
  const measure = () =>
    page.locator('#card-container').evaluate((host) => {
      const cards = [...host.querySelectorAll('.cc-card')].slice(0, 6);
      const total = host.querySelector('.book-page-total');
      return {
        height: Math.max(...cards.map((card) => card.getBoundingClientRect().height)),
        pages: total ? Number(total.textContent.replace(/\D/g, '')) : 0,
      };
    });
  const choose = async (select, value) => {
    await openSettings(page);
    await page.locator(select).selectOption(value);
    await page.keyboard.press('Escape');
    await closeSidebar(page);
  };

  for (const layout of ['book', 'scroll']) {
    await choose('#appReadingLayoutSelect', layout);
    await choose('#appDensitySelect', 'comfortable');
    await expect(page.locator('.cc-card').first()).toBeVisible();
    const comfortable = await measure();
    await choose('#appDensitySelect', 'compact');
    await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
    // Compact never makes a card taller, so a spread never holds fewer words.
    await expect.poll(async () => (await measure()).height).toBeLessThan(comfortable.height);
    if (layout === 'book') expect((await measure()).pages).toBeLessThanOrEqual(comfortable.pages);
  }
  expect(errors).toEqual([]);
});

// BOOK-UX-01: word-book entries instead of framed cards. Framed cards showed 6
// words per spread at 1600×900, 4 at 1280×720 and 3 on a phone.
for (const { width, height, least } of [
  { width: 1600, height: 900, least: 14 },
  { width: 1280, height: 720, least: 10 },
  { width: 390, height: 844, least: 4 },
]) {
  test(`BOOK-UX-01 vocabulary spread holds dictionary entries at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const errors = await openReadyApp(page, { module: 'vocab' });
    const book = page.locator('#card-container .book-frame');
    await expect(book).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const layout = await book.locator('.book-body').evaluate((body) => {
      const bounds = body.getBoundingClientRect();
      const shown = [...body.querySelectorAll('.cc-card')].filter((card) => {
        const r = card.getBoundingClientRect();
        return r.left >= bounds.left - 1 && r.right <= bounds.right + 1 && r.bottom <= bounds.bottom + 1;
      });
      // Headword, reading, gloss, example and the control cluster never sit on one another.
      const meet = (a, b) =>
        Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
        Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
      const overlaps = shown.filter((card) => {
        const parts = [...card.querySelectorAll('.cc-word, .cc-reading, .cc-pos-line, .cc-example')].map(
          (el) => {
            const range = document.createRange();
            range.selectNodeContents(el);
            return [...range.getClientRects()];
          },
        );
        parts.push([card.querySelector('.cc-card-head').getBoundingClientRect()]);
        return parts.some((a, i) => parts.some((b, j) => i < j && a.some((r) => b.some((q) => meet(r, q)))));
      });
      return {
        shown: shown.length,
        overlaps: overlaps.map((card) => card.dataset.index),
        sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });
    expect(layout.shown).toBeGreaterThanOrEqual(least);
    expect(layout.overlaps).toEqual([]);
    expect(layout.sideways).toBe(false);

    // The per-entry study control is an icon with its own name and still starts a session.
    const first = book.locator('.cc-card').first();
    await first.hover();
    const study = first.getByRole('button', { name: '学习此词' });
    await expect(study).toBeVisible();
    await study.click();
    await expect(page.locator('#study-container')).toBeVisible();
    await expect(page.locator('#statusStudyQueue')).toHaveText('1');
    expect(errors).toEqual([]);
  });
}
