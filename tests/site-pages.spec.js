const { test, expect } = require('@playwright/test');
const { expectOnlyModuleVisible } = require('./helpers');

const entries = [
  { path: '/vocabulary/', module: 'vocab', title: '日语词汇查阅与复习 · 词基流动' },
  { path: '/grammar/', module: 'grammar', title: 'JLPT 日语语法查阅 · 词基流动' },
  { path: '/textbook/', module: 'lesson', title: 'KotobaFlow 日语课文阅读 · 词基流动' },
];
test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => {
  await page.route('**/js/storage-config.js*', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: "window.JPLearnStorageConfig={mode:'browser'};" }),
  );
});

async function ready(page, entry) {
  await page.goto(entry.path);
  await expect(page.locator('#loading')).toHaveClass(/hidden/);
  await expect.poll(() => page.evaluate(() => ModuleSwitcher.getCurrentModule())).toBe(entry.module);
  await expectOnlyModuleVisible(page, entry.module);
  await expect(page).toHaveTitle(entry.title);
}

for (const entry of entries) {
  test(`SEO-01 ${entry.path} serves its own metadata before JavaScript`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
    const page = await context.newPage();
    try {
      const response = await page.goto(entry.path);
      expect(response.status()).toBe(200);
      await expect(page).toHaveTitle(entry.title);
      await expect(page.locator('link[rel=canonical]')).toHaveAttribute(
        'href',
        'https://kotobaflow.lol' + entry.path,
      );
      await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
        'content',
        'https://kotobaflow.lol' + entry.path,
      );
      const description = await page.locator('meta[name=description]').getAttribute('content');
      expect(description.length).toBeGreaterThan(20);
      await expect(page.locator('meta[property="og:description"]')).toHaveAttribute('content', description);
      const schema = JSON.parse(await page.locator('#sitePageSchema').textContent());
      expect(schema.url).toBe('https://kotobaflow.lol' + entry.path);
      expect(schema.name).toBe(entry.title);
    } finally {
      await context.close();
    }
  });
  for (const width of [1600, 1280]) {
    test(`SEO-01 ${entry.path} opens and reloads the module at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 1600 ? 900 : 720 });
      const errors = [];
      const brokenAssets = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('response', (response) => {
        if (response.status() === 404 && /\/(?:js|vendor)\//.test(response.url()))
          brokenAssets.push(response.url());
      });
      await ready(page, entry);
      await page.reload();
      await expect.poll(() => page.evaluate(() => ModuleSwitcher.getCurrentModule())).toBe(entry.module);
      await expectOnlyModuleVisible(page, entry.module);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `local/qa/seo-2026-10-18/${entry.module}-${width}.png` });
      expect(errors).toEqual([]);
      expect(brokenAssets).toEqual([]);
    });
  }
}

test('SEO-01 real module controls keep URLs, metadata and browser history together', async ({ page }) => {
  await ready(page, entries[0]);
  await page.locator('#modBtnGrammar').click();
  await expect(page).toHaveURL(/\/grammar\/$/);
  await expect(page).toHaveTitle(entries[1].title);
  await page.locator('#modBtnLesson').click();
  await expect(page).toHaveURL(/\/textbook\/$/);
  await expect(page).toHaveTitle(entries[2].title);
  await page.goBack();
  await expectOnlyModuleVisible(page, 'grammar');
  await expect(page).toHaveTitle(entries[1].title);
  await page.goForward();
  await expectOnlyModuleVisible(page, 'lesson');
  await page.locator('#modBtnDashboard').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page).toHaveTitle('词基流动');
  await expectOnlyModuleVisible(page, 'dashboard');
});

test('SEO-01 module entry points share saved learning state and honor the requested module', async ({
  page,
}) => {
  await ready(page, entries[0]);
  await page.locator('.cc-card').first().click();
  await expect(page.locator('#detailBtnFavorite')).toBeVisible();
  await page.locator('#detailBtnFavorite').click();
  await expect(page.locator('#detailBtnFavorite')).toHaveAttribute('aria-pressed', 'true');
  const vocabulary = await page.evaluate(() => ProgressStore.exportProgress().vocabulary);
  expect(Object.keys(vocabulary).length).toBeGreaterThan(0);
  await ready(page, entries[1]);
  expect(await page.evaluate(() => ProgressStore.exportProgress().vocabulary)).toEqual(vocabulary);
  await ready(page, entries[0]);
  expect(await page.evaluate(() => ProgressStore.exportProgress().vocabulary)).toEqual(vocabulary);
  await page.locator('.cc-card').first().click();
  await expect(page.locator('#detailBtnFavorite')).toHaveAttribute('aria-pressed', 'true');
});

test('SEO-01 robots, sitemap and visible about-page links expose the canonical entries', async ({
  page,
  request,
}) => {
  const robots = await request.get('/robots.txt');
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toContain('Sitemap: https://kotobaflow.lol/sitemap.xml');
  const sitemap = await request.get('/sitemap.xml');
  expect(sitemap.status()).toBe(200);
  const xml = await sitemap.text();
  expect(xml.match(/<loc>/g)).toHaveLength(5);
  for (const entry of entries) expect(xml).toContain('<loc>https://kotobaflow.lol' + entry.path + '</loc>');
  await page.goto('/privacy.html');
  const navigation = page.getByRole('navigation', { name: '站内模块' });
  await expect(navigation.getByRole('link')).toHaveCount(3);
  await navigation.getByRole('link', { name: '日语语法', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.ModuleSwitcher?.getCurrentModule())).toBe('grammar');
});
