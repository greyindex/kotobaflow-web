const { test, expect } = require('@playwright/test');
const { DEFAULT_LAYOUT_STORAGE, chooseReadingLayout, openReadyApp, revealControl } = require('./helpers');

test.use({ serviceWorkers: 'block', storageState: DEFAULT_LAYOUT_STORAGE });

test.beforeEach(async ({ page }) => {
  await page.route('**/js/storage-config.js*', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: "window.JPLearnStorageConfig = Object.freeze({ mode: 'browser' });",
    }),
  );
});

async function useControl(control, action) {
  await revealControl(control);
  await action(control);
}

async function expectFirstSpread(book, firstCard) {
  await revealControl(book);
  await expect(book.locator('.book-page-select')).toHaveValue('0');
  await expect(book.locator('.book-status')).toContainText(/第 1 \/ \d+ 组/);
  await expect(firstCard).toBeInViewport();
}

for (const viewport of [
  { width: 1600, height: 900 },
  { width: 1280, height: 720 },
]) {
  test(`vocabulary filters, search and sort start from their first spread at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const errors = await openReadyApp(page, { module: 'vocab' });
    const book = page.locator('#card-container .book-frame');
    const select = book.locator('.book-page-select');
    await select.selectOption('1');
    await useControl(page.locator('[data-vocab-level="N5"]'), (control) => control.click());
    await expectFirstSpread(book, book.locator('.cc-card').first());

    await select.selectOption('1');
    await useControl(page.locator('#searchInput'), (control) => control.fill('あ'));
    await expect(page.locator('#vocabHeading')).toContainText('あ');
    await expectFirstSpread(book, book.locator('.cc-card').first());

    await select.selectOption('1');
    await useControl(page.locator('#ccSortSelect'), (control) => control.selectOption('alpha'));
    await expectFirstSpread(book, book.locator('.cc-card').first());

    await select.selectOption('1');
    await useControl(page.locator('#resetFiltersBtn'), (control) => control.click());
    await expectFirstSpread(book, book.locator('.cc-card').first());

    await select.selectOption('1');
    await useControl(page.locator('#ccPerPageSelect'), (control) => control.selectOption('48'));
    await expectFirstSpread(book, book.locator('.cc-card').first());
    expect(errors).toEqual([]);
  });

  test(`grammar filters and search start from their first spread at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors = await openReadyApp(page, { module: 'grammar' });
    const book = page.locator('#gmGrammarList .book-frame');
    const select = book.locator('.book-page-select');
    await select.selectOption('1');
    await useControl(page.locator('#gmSidebarFilters [data-level="N5"]'), (control) => control.click());
    await expectFirstSpread(book, book.locator('.gm-card').first());

    await select.selectOption('1');
    await useControl(page.locator('#gmSearch'), (control) => control.fill('です'));
    await expect(page.locator('#grammarHeading')).toContainText('です');
    await expectFirstSpread(book, book.locator('.gm-card').first());
    expect(errors).toEqual([]);
  });
}

test('same vocabulary results, favorites and meaning display keep the current group and spread', async ({
  page,
}) => {
  const errors = await openReadyApp(page, { module: 'vocab' });
  const book = page.locator('#card-container .book-frame');
  const select = book.locator('.book-page-select');
  const last = await select.locator('option').last().getAttribute('value');
  await select.selectOption(last);
  await book.locator('.book-turn[data-book-flip="next"]').click();
  await expect(book.locator('.book-status')).toContainText('第 2 / ');
  await book.locator('.book-turn[data-book-flip="prev"]').click();
  await expect(book.locator('.book-status')).toContainText('第 1 / ');
  await expect(book.locator('.book-turn[data-book-flip="next"]')).toHaveText('下一组');
  await book.locator('.book-turn[data-book-flip="next"]').click();
  await expect(book.locator('.book-status')).toContainText('第 2 / ');
  await select.selectOption('1');

  // Reapplying the unchanged real query must not jump to group one.
  await useControl(page.locator('#searchInput'), (control) => control.press('Enter'));
  await revealControl(book);
  await expect(book.locator('.book-status')).toContainText('第 2 / ');
  await expect(select).toHaveValue('1');

  // Multi-column items are present in the DOM even when clipped; choose a card in this spread.
  const index = await book.locator('.cc-card').evaluateAll((cards) => {
    const body = cards[0].closest('.book-body').getBoundingClientRect();
    return cards
      .find((card) => {
        const rect = card.getBoundingClientRect();
        return rect.left >= body.left - 1 && rect.right <= body.right + 1;
      })
      .getAttribute('data-index');
  });
  await book.locator(`.cc-card[data-index="${index}"] .cc-fav`).click();
  await expect(select).toHaveValue('1');
  await expect(book.locator('.book-status')).toContainText('第 2 / ');

  await useControl(page.locator('#ccMeaningToggle'), (control) => control.click());
  await revealControl(book);
  await expect(select).toHaveValue('1');
  await expect(book.locator('.book-status')).toContainText('第 2 / ');
  expect(errors).toEqual([]);
});

test('same grammar filter and favorite changes keep the current group and spread', async ({ page }) => {
  const errors = await openReadyApp(page, { module: 'grammar' });
  const book = page.locator('#gmGrammarList .book-frame');
  const select = book.locator('.book-page-select');
  const last = await select.locator('option').last().getAttribute('value');
  await select.selectOption(last);
  await book.locator('.book-turn[data-book-flip="next"]').click();
  await expect(book.locator('.book-status')).toContainText('第 2 / ');
  await book.locator('.book-turn[data-book-flip="prev"]').click();
  await expect(book.locator('.book-status')).toContainText('第 1 / ');
  await expect(book.locator('.book-turn[data-book-flip="next"]')).toHaveText('下一组');
  await book.locator('.book-turn[data-book-flip="next"]').click();
  await expect(book.locator('.book-status')).toContainText('第 2 / ');
  await select.selectOption('1');
  await useControl(page.locator('#gmSidebarFilters [data-level="all"]'), (control) => control.click());
  await revealControl(book);
  await expect(book.locator('.book-status')).toContainText('第 2 / ');
  await expect(select).toHaveValue('1');
  const uid = await book.locator('.gm-card').evaluateAll((cards) => {
    const body = cards[0].closest('.book-body').getBoundingClientRect();
    return cards
      .find((card) => {
        const rect = card.getBoundingClientRect();
        return rect.left >= body.left - 1 && rect.right <= body.right + 1;
      })
      .getAttribute('data-uid');
  });
  await book.locator(`.gm-card[data-uid="${uid}"] .gm-card-fav`).click();
  await expect(select).toHaveValue('1');
  await expect(book.locator('.book-status')).toContainText('第 2 / ');
  expect(errors).toEqual([]);
});

for (const module of ['vocab', 'grammar']) {
  test(`${module} favorites start at the first spread and removing the last group stays readable`, async ({
    page,
  }) => {
    const errors = await openReadyApp(page, { module });
    // Set up a known two-group collection; the filtering and removal use real controls.
    await page.evaluate(async (module) => {
      if (module === 'vocab') {
        window.taxonomyManager.allWords.slice(0, 25).forEach((word) => {
          window.StudyStorage.markWord(word.index, 'favorite');
        });
      } else {
        (await window.GrammarLoader.getIndex()).slice(0, 25).forEach((item) => {
          window.StudyStorage.toggleGrammarFavorite(item.uid);
        });
      }
    }, module);
    const vocab = module === 'vocab';
    const book = page.locator(`${vocab ? '#card-container' : '#gmGrammarList'} .book-frame`);
    const select = book.locator('.book-page-select');
    const cardSelector = vocab ? '.cc-card' : '.gm-card';
    await select.selectOption('1');
    await useControl(
      page.locator(vocab ? '#vocabViewTools .cc-tab-fav' : '#gmSidebarFilters .gm-tab-fav'),
      (control) => control.click(),
    );
    await expectFirstSpread(book, book.locator(cardSelector).first());
    const last = await select.locator('option').last().getAttribute('value');
    await select.selectOption(last);
    await book.locator('.book-turn[data-book-flip="next"]').click();
    await expect(book.locator('.book-status')).toContainText('第 2 / 2 组');
    await book.locator(vocab ? '.cc-fav' : '.gm-card-fav').click();
    await expect(book.locator('.book-status')).toContainText('第 1 / 1 组');
    await expectFirstSpread(book, book.locator(cardSelector).first());
    expect(errors).toEqual([]);
  });
}

test('legacy scrolling catalogs still reset pagination when their filters change', async ({ page }) => {
  const errors = await openReadyApp(page, { module: 'vocab' });
  await chooseReadingLayout(page, 'scroll');
  await page.locator('#card-container .cc-page-num[data-page="2"]').click();
  await useControl(page.locator('[data-vocab-level="N5"]'), (control) => control.click());
  await revealControl(page.locator('#card-container'));
  await expect(page.locator('#card-container .cc-page-num.active')).toHaveText('1');
  await expect(page.locator('#card-container .book-frame')).toHaveCount(0);
  await page.locator('#modBtnGrammar').click();
  await page.locator('#gmGrammarList .gm-page-btn[data-page="2"]').click();
  await useControl(page.locator('#gmSidebarFilters [data-level="N5"]'), (control) => control.click());
  await revealControl(page.locator('#gmGrammarList'));
  await expect(page.locator('#gmGrammarList .gm-page-btn.active')).toHaveText('1');
  await expect(page.locator('#gmGrammarList .book-frame')).toHaveCount(0);
  expect(errors).toEqual([]);
});
