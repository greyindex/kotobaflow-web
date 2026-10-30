const { test, expect } = require('@playwright/test');
const { DEFAULT_LAYOUT_STORAGE, openReadyApp, revealControl } = require('./helpers');

test.use({ serviceWorkers: 'block', storageState: DEFAULT_LAYOUT_STORAGE });

test.beforeEach(async ({ page }) => {
  await page.route('**/js/storage-config.js*', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: "window.JPLearnStorageConfig = Object.freeze({ mode: 'browser' });",
    }),
  );
});

for (const viewport of [
  { width: 1600, height: 900 },
  { width: 1280, height: 720 },
]) {
  test(`FIX-31 vocabulary details display Chinese metadata labels at ${viewport.width}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    const errors = await openReadyApp(page);
    const search = page.locator('#searchInput');
    const detail = page.locator('#detailContent .vocab-detail');
    const samples = [
      { index: 5, word: '愛顧', frequency: '中频', domain: '贸易' },
      { index: 75, word: 'ニックネーム', frequency: '高频', domain: '关系' },
      { index: 2872, word: '付録', frequency: '', domain: '写作' },
    ];

    // Read the original words without changing the app's data or selection state.
    const originalMetadata = await page.evaluate(
      (indices) =>
        indices.map((index) => {
          const word = window.taxonomyManager.allWords.find((item) => item.index === index);
          return JSON.stringify({
            pos: word.pos,
            style: word.style,
            freq_band: word.freq_band,
            domain_codes: word.domain_codes,
          });
        }),
      samples.map((sample) => sample.index),
    );

    for (const sample of samples) {
      await revealControl(search);
      await search.fill(sample.word);
      const card = page.locator(`.cc-card[data-index="${sample.index}"] .cc-card-body`);
      await expect(card).toBeAttached();
      await revealControl(card);
      await card.click();
      await expect(detail.locator('.vocab-detail-head h3')).toHaveText(sample.word);

      const field = (label) =>
        detail
          .locator('.detail-item')
          .filter({
            has: page.locator('.detail-label', { hasText: new RegExp(`^${label}$`) }),
          })
          .locator('.detail-value');
      const labels = await page.evaluate((index) => {
        const word = window.taxonomyManager.allWords.find((item) => item.index === index);
        const api = window.JPLearn.lexicalMetadata;
        return { pos: api.posLabel(word.pos, 'zh'), style: api.styleLabel(word.style, 'zh') };
      }, sample.index);
      await expect(field('词性')).toHaveText(labels.pos);
      await expect(field('媒介 / 体裁')).toHaveText(
        [labels.style, sample.frequency].filter(Boolean).join(' · '),
      );
      await expect(field('使用领域')).toContainText(sample.domain);
      await expect(detail.locator('.vocab-detail-info-grid')).not.toContainText(
        /\b(noun|verb|written|spoken|general|mid|high|unknown)\b|领域候选/,
      );

      const bounds = await page.locator('#detailPanel').boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1);
      expect(await detail.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      if (sample.index === 5) {
        await field('媒介 / 体裁').scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath(`detail-language-${viewport.width}.png`) });
      }
      await page.locator('#detailPanelCollapseBtn').click();
    }

    expect(
      await page.evaluate(
        (indices) =>
          indices.map((index) => {
            const word = window.taxonomyManager.allWords.find((item) => item.index === index);
            return JSON.stringify({
              pos: word.pos,
              style: word.style,
              freq_band: word.freq_band,
              domain_codes: word.domain_codes,
            });
          }),
        samples.map((sample) => sample.index),
      ),
    ).toEqual(originalMetadata);
    expect(errors).toEqual([]);
  });
}
