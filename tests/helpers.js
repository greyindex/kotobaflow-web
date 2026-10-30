const { expect } = require('@playwright/test');

// Navigate through the real drawer controls before interacting with a target.
// Main learning-flow tests share this step; W-06 tests assert drawer state directly.
async function revealControl(locator) {
  const target = locator.first();
  await target.waitFor({ state: 'attached' });
  let region;
  // Filtering can replace a card between resolving its locator and evaluating it.
  // Only use ancestry from a connected node, otherwise an inert target looks unblocked.
  await expect
    .poll(async () => {
      region = await target.evaluate((el) => ({
        connected: el.isConnected,
        sidebar: !!el.closest('#unifiedSidebar') && !el.closest('#appSettingsPanel'),
        tabletDrawer: !!el.closest('.tablet-drawer-open'),
        blocked:
          !!el.closest('.app-container[inert]') ||
          (el.id === 'tabletSidebarToggle' && document.body.classList.contains('narrow-global-sidebar-open')),
      }));
      return region.connected;
    })
    .toBe(true);
  const page = locator.page();
  if (
    region.sidebar &&
    !region.tabletDrawer &&
    !(await target.isVisible()) &&
    (await page.locator('#statusBarShowBtn').getAttribute('aria-expanded')) !== 'true'
  ) {
    await page.locator('#statusBarShowBtn').click();
  } else if (region.blocked) {
    await page.locator('#statusBarShowBtn').click();
    await expect(page.locator('.app-container')).not.toHaveAttribute('inert');
  }
  await page
    .locator('#unifiedSidebar')
    .evaluate((el) => Promise.all(el.getAnimations().map((animation) => animation.finished.catch(() => {}))));
  // Reading tools and other groups start collapsed. Open their real summaries
  // from the outside in, without changing application state through JS.
  for (const group of await target.locator('xpath=ancestor::details[not(@open)]').all()) {
    if (await target.isVisible()) break;
    await group.locator(':scope > summary').click();
  }
}

// Switching books re-renders the whole textbook sidebar only after the new
// index arrives. Until then the previous book's directory and lesson cards are
// still attached, and a slow machine can click one just before it is replaced
// by a collapsed directory. Wait for the new book's index before going on.
async function selectTextbook(page, bookId) {
  await revealControl(page.locator('#tbBookSelect'));
  await page.locator('#tbBookSelect').selectOption(bookId);
  await expect
    .poll(() =>
      page.evaluate((id) => {
        const module = ModuleSwitcher.getTextbookModule();
        return !!module && module.currentBookId === id && !!module.bookIndex;
      }, bookId),
    )
    .toBe(true);
}

async function openReadyApp(page, options = {}) {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  // Locally generated example audio packs (PUB-04-EXAMPLES) would show their
  // buttons; other tests and screenshot baselines must not depend on them.
  if (!options.exampleAudio)
    await page.route('**/data/example_audio_v1/**', (route) => route.fulfill({ status: 404, body: '' }));
  // The same for the local classics library (CLASSICS-01): its catalog adds a
  // fifth module button to the rail.
  if (!options.classics)
    await page.route('**/data/classics_v1/**', (route) => route.fulfill({ status: 404, body: '' }));
  await page.goto('/');
  await expect(page).toHaveTitle('词基流动');
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 45_000 });
  await expect(page.locator('#statusTotal')).not.toHaveText('0');
  const targetModule = options.module || 'vocab';
  const buttons = {
    dashboard: '#modBtnDashboard',
    vocab: '#modBtnVocab',
    grammar: '#modBtnGrammar',
    lesson: '#modBtnLesson',
    classics: '#modBtnClassics',
  };
  if (targetModule !== 'dashboard') await page.locator(buttons[targetModule]).click();
  return pageErrors;
}

async function expectOnlyModuleVisible(page, moduleName) {
  const ids = {
    dashboard: '#dashboardMain',
    vocab: '#vocabMain',
    grammar: '#grammarMain',
    lesson: '#textbookMain',
    classics: '#classicsMain',
  };
  for (const [name, selector] of Object.entries(ids)) {
    if (name === moduleName) await expect(page.locator(selector)).toBeVisible();
    else await expect(page.locator(selector)).toBeHidden();
  }
}

async function expectRegionsWithinViewport(page, selectors) {
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();

  for (const selector of selectors) {
    const region = page.locator(selector);
    await revealControl(region);
    await expect(region, `${selector} should be visible`).toBeVisible();
    const box = await region.boundingBox();
    expect(box, `${selector} should have a measurable box`).not.toBeNull();
    expect(box.x, `${selector} should not be clipped on the left`).toBeGreaterThanOrEqual(-0.5);
    expect(box.y, `${selector} should not be clipped at the top`).toBeGreaterThanOrEqual(-0.5);
    expect(box.x + box.width, `${selector} should fit horizontally`).toBeLessThanOrEqual(
      viewport.width + 0.5,
    );
    expect(box.y + box.height, `${selector} should fit vertically`).toBeLessThanOrEqual(
      viewport.height + 0.5,
    );
  }
}

// Measure the rendered text against its composited ancestor backgrounds.
// These selected text surfaces have no background images or element opacity.
async function expectReadable(locator, options = {}) {
  await expect(locator.first()).toBeVisible();
  const ratios = await locator.evaluateAll((elements, options) => {
    const rgba = (value) => {
      const channels = value.match(/[\d.]+/g).map(Number);
      return [channels[0], channels[1], channels[2], channels[3] ?? 1];
    };
    const over = (fg, bg) => fg.slice(0, 3).map((channel, i) => channel * fg[3] + bg[i] * (1 - fg[3]));
    const luminance = (rgb) =>
      rgb.reduce((sum, channel, i) => {
        const s = channel / 255;
        return sum + (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i];
      }, 0);
    return elements.map((el) => {
      const backgrounds = [];
      for (let node = options.againstParent ? el.parentElement : el; node; node = node.parentElement)
        backgrounds.push(rgba(getComputedStyle(node).backgroundColor));
      const bg = backgrounds.reverse().reduce((color, layer) => over(layer, color), [255, 255, 255]);
      const fg = over(rgba(getComputedStyle(el)[options.property || 'color']), bg);
      const light = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
      return { text: el.textContent.trim(), ratio: (light[0] + 0.05) / (light[1] + 0.05) };
    });
  }, options);
  expect(ratios.length).toBeGreaterThan(0);
  for (const result of ratios)
    expect(result.ratio, result.text).toBeGreaterThanOrEqual(options.minRatio || 4.5);
}

// Storage without the legacy-layout pin of playwright.config.js: the app opens
// in its default page-turn layout.
const DEFAULT_LAYOUT_STORAGE = { cookies: [], origins: [] };

// UI-ART-28: search, settings and full screen are in the opened sidebar; the
// collapsed rail shows only the modules. Opens the sidebar when it is
// collapsed, then the display settings.
async function openSettings(page) {
  const toggle = page.locator('#appSettingsToggle');
  await revealControl(toggle);
  await toggle.click();
  await expect(page.locator('#appSettingsPanel')).toBeVisible();
}

// Opens the sidebar unless it is open already.
async function openSidebar(page) {
  const button = page.locator('#statusBarShowBtn');
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
  await expect(page.locator('body')).not.toHaveClass(/status-bar-collapsed/);
}

// Closes the opened sidebar, and any settings panel in it, back to the rail.
async function closeSidebar(page) {
  const button = page.locator('#statusBarShowBtn');
  if ((await button.getAttribute('aria-expanded')) === 'true') await button.click();
  await expect(page.locator('body')).toHaveClass(/status-bar-collapsed/);
}

// Inert content is skipped by hit testing even if it paints over the drawer.
// Temporarily include it so a successful click cannot hide a stacking defect.
async function expectSidebarAboveLoading(page) {
  await expect
    .poll(() =>
      page.locator('#appSettingsToggle').evaluate((button) => {
        const content = document.querySelector('.app-container');
        const inert = content.inert;
        try {
          content.inert = false;
          const box = button.getBoundingClientRect();
          return button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
        } finally {
          content.inert = inert;
        }
      }),
    )
    .toBe(true);
}

// Switches the reading layout the way a reader does, from the display settings.
async function chooseReadingLayout(page, layout) {
  await openSettings(page);
  await page.locator('#appReadingLayoutSelect').selectOption(layout);
  await page.locator('#appSettingsToggle').click();
  await expect(page.locator('#appSettingsPanel')).toBeHidden();
  await closeSidebar(page);
}

// Waits until a page turn has finished. While it plays, copies of the old
// pages, classes included, lie over the book (js/core/book-turn.js), and a
// fallback slide still moves the pages.
async function settleBook(book) {
  await expect(book.locator('.book-flip-layer')).toHaveCount(0);
  await book
    .locator('.book-body')
    .evaluate((body) =>
      Promise.all(body.getAnimations().map((animation) => animation.finished.catch(() => {}))),
    );
}

module.exports = {
  DEFAULT_LAYOUT_STORAGE,
  chooseReadingLayout,
  closeSidebar,
  openSettings,
  openSidebar,
  settleBook,
  openReadyApp,
  revealControl,
  selectTextbook,
  expectOnlyModuleVisible,
  expectSidebarAboveLoading,
  expectRegionsWithinViewport,
  expectReadable,
};
