const { test, expect } = require('@playwright/test');
const {
  DEFAULT_LAYOUT_STORAGE,
  openReadyApp,
  revealControl,
  openSettings,
  closeSidebar,
} = require('./helpers');

test.use({ serviceWorkers: 'block', storageState: DEFAULT_LAYOUT_STORAGE });

test.beforeEach(async ({ page }) => {
  await page.route('**/js/storage-config.js*', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: "window.JPLearnStorageConfig = { mode: 'browser' };",
    }),
  );
  await page.route('**/kotobaflow_unit_images_v1/images.json*', (route) =>
    route.fulfill({ json: { schema: 1, count: 0, images: {} } }),
  );
});

test('UI-ART-06 native controls and headings follow global type sizes at normal and short heights', async ({
  page,
}) => {
  await page.goto('/404.html');
  // A plain document using the real global stylesheet separates UA defaults
  // from application classes and standalone-page heading overrides.
  await page.setContent(
    '<!doctype html><html lang="zh-CN"><head><link rel="stylesheet" href="/style.css"></head><body><section id="typeInheritanceSample">' +
      '<h1>页面标题</h1><h2>章节标题</h2><h3>小标题</h3><h4>内容标题</h4><small>说明</small><button>操作</button><input value="输入"><select><option>选项</option></select><textarea>备注</textarea>' +
      '</section></body></html>',
  );
  for (const viewport of [
    { width: 1600, height: 900 },
    { width: 390, height: 500 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.locator('html')).toHaveCSS('font-size', '16px');
    await expect(page.locator('body')).toHaveCSS('font-size', '15px');
    const sample = page.locator('#typeInheritanceSample');
    await expect(sample.locator('h1')).toHaveCSS('font-size', '18px');
    await expect(sample.locator('h2')).toHaveCSS('font-size', '15px');
    await expect(sample.locator('h3')).toHaveCSS('font-size', '18px');
    await expect(sample.locator('h4')).toHaveCSS('font-size', '15px');
    await expect(sample.locator('small')).toHaveCSS('font-size', '12px');
    // The existing shared button role uses the 14px UI step; other unstyled
    // controls inherit the 15px body step instead of browser-specific defaults.
    await expect(sample.locator('button')).toHaveCSS('font-size', '14px');
    for (const control of ['input', 'select', 'textarea'])
      await expect(sample.locator(control)).toHaveCSS('font-size', '15px');
  }
});

async function inspectVisibleType(page) {
  return page.evaluate(() => {
    const ladder = [12, 13, 14, 15, 18, 22, 28];
    const histogram = {};
    const outsideLadder = [];
    const zeroLabels = [];
    const measured = new Set();
    const sample = (el, text, rects) => {
      if (measured.has(el) || !text.trim()) return;
      // SVG icons, decorative illustrations and visually hidden accessible text
      // are not printed words. Off-page book columns are clipped by their viewport.
      if (el.closest('svg, .sr-only, .cc-empty-icon, [aria-hidden="true"], [inert]')) return;
      const style = getComputedStyle(el);
      if (style.visibility !== 'visible' || style.display === 'none' || Number(style.opacity) === 0) return;
      let clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
      for (let parent = el.parentElement; parent; parent = parent.parentElement) {
        const parentStyle = getComputedStyle(parent);
        if (parentStyle.visibility !== 'visible' || Number(parentStyle.opacity) === 0) return;
        const r = parent.getBoundingClientRect();
        if (/hidden|clip|auto|scroll/.test(parentStyle.overflowX))
          clip = { ...clip, left: Math.max(clip.left, r.left), right: Math.min(clip.right, r.right) };
        if (/hidden|clip|auto|scroll/.test(parentStyle.overflowY))
          clip = { ...clip, top: Math.max(clip.top, r.top), bottom: Math.min(clip.bottom, r.bottom) };
      }
      const size = parseFloat(style.fontSize);
      if (size === 0) {
        zeroLabels.push({ text: text.trim(), selector: el.className });
        return;
      }
      if (
        !rects.some(
          (r) =>
            r.width > 0 &&
            r.height > 0 &&
            r.right > clip.left &&
            r.left < clip.right &&
            r.bottom > clip.top &&
            r.top < clip.bottom,
        )
      )
        return;
      measured.add(el);
      histogram[size] = (histogram[size] || 0) + 1;
      if (!ladder.includes(size))
        outsideLadder.push({
          text: text.trim().slice(0, 60),
          size,
          selector: el.id || el.className || el.tagName,
        });
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const el = node.parentElement;
      if (!el || el.closest('script, style, noscript')) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      sample(el, node.textContent, [...range.getClientRects()]);
    }
    for (const el of document.querySelectorAll('input, textarea, select')) {
      sample(el, el.value || el.placeholder || el.getAttribute('aria-label') || '', [...el.getClientRects()]);
    }
    return { histogram, outsideLadder, zeroLabels };
  });
}

async function expectTypeLadder(page, stage, report) {
  const audit = await inspectVisibleType(page);
  expect(Object.keys(audit.histogram).length, `${stage} contains measurable text`).toBeGreaterThan(0);
  expect(audit.outsideLadder, `${stage} uses only the seven type sizes`).toEqual([]);
  report.push({ stage, ...audit });
}

for (const [width, height] of [
  [1600, 900],
  [1280, 720],
  [390, 844],
]) {
  for (const theme of ['light', 'dark']) {
    test(`UI-ART-06 visible text and native controls use seven sizes at ${width} ${theme}`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(120_000);
      const report = [];
      await page.setViewportSize({ width, height });
      const errors = await openReadyApp(page, { module: 'dashboard' });
      await expect(page.locator('html')).toHaveCSS('font-size', '16px');
      await expect(page.locator('body')).toHaveCSS('font-size', '15px');
      await openSettings(page);
      await page.locator('#appThemeSelect').selectOption(theme);
      await expectTypeLadder(page, 'settings', report);
      await page.keyboard.press('Escape');
      await closeSidebar(page);
      await expectTypeLadder(page, 'today', report);
      await page.locator('#modBtnVocab').click();
      await expect(page.locator('.cc-wrapper--book .book-frame')).toBeVisible();
      await expectTypeLadder(page, 'vocabulary', report);
      await expect(page.locator('.cc-card-primary').first()).toHaveAccessibleName('学习此词');
      await page.locator('.cc-card-body').first().press('Enter');
      await expect(page.locator('#detailPanel')).toBeVisible();
      await expectTypeLadder(page, 'vocabulary-detail', report);
      await page.keyboard.press('Escape');
      await page.locator('#modBtnGrammar').click();
      await expect(page.locator('#gmGrammarList .book-frame')).toBeVisible();
      await expectTypeLadder(page, 'grammar', report);
      await page.locator('.gm-card').first().press('Enter');
      await expect(page.locator('#grammarDetailPanel')).toBeVisible();
      await expectTypeLadder(page, 'grammar-detail', report);
      await page.keyboard.press('Escape');
      await page.locator('#modBtnLesson').click();
      await revealControl(page.locator('#tbBookSelect'));
      await page.locator('#tbBookSelect').selectOption('KotobaFlow1');
      const lesson = page.locator('.tb-lesson-card[data-lesson-id="lesson_00"]');
      await revealControl(lesson);
      await expectTypeLadder(page, 'lesson-sidebar', report);
      await lesson.click();
      await page.keyboard.press('Escape');
      await expect(page.locator('#tbReader .book-frame')).toBeVisible();
      await expectTypeLadder(page, 'kana-lesson', report);
      const pageSelect = page.locator('#tbReader .book-page-select');
      if ((await pageSelect.locator('option').count()) > 1) {
        await pageSelect.selectOption('1');
        await expectTypeLadder(page, 'kana-lesson-page-2', report);
      }
      await page.screenshot({ path: testInfo.outputPath(`kana-${width}-${theme}.png`) });
      await revealControl(page.locator('.tb-lesson-card[data-lesson-id="lesson_01"]'));
      await page.locator('.tb-lesson-card[data-lesson-id="lesson_01"]').click();
      await page.keyboard.press('Escape');
      await page.locator('#tbReader .tb-inline-highlight-link').first().press('Enter');
      await expect(page.locator('#textbookDetailPanel')).toBeVisible();
      await expectTypeLadder(page, 'lesson-detail', report);
      await page.keyboard.press('Escape');
      await page.locator('#modBtnVocab').click();
      await page.evaluate(() =>
        appConfig.startStudySession(taxonomyManager.allWords.slice(0, 3), {
          practiceMode: 'mixed',
          shuffle: false,
        }),
      );
      await expect(page.locator('.practice-card')).toBeVisible();
      await expectTypeLadder(page, 'practice', report);
      await page.locator('.practice-option').first().click();
      await expect(page.locator('.practice-feedback')).toBeVisible();
      await expectTypeLadder(page, 'practice-feedback', report);
      await testInfo.attach('computed-type-histograms', {
        body: JSON.stringify(report, null, 2),
        contentType: 'application/json',
      });
      expect(errors).toEqual([]);
    });
  }
}
