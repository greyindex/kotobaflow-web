const { test, expect } = require('@playwright/test');
const {
  DEFAULT_LAYOUT_STORAGE,
  openReadyApp,
  revealControl,
  expectReadable,
  chooseReadingLayout,
  settleBook,
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

async function theme(page, mode) {
  await openSettings(page);
  await page.locator('#appThemeSelect').selectOption(mode);
  await page.keyboard.press('Escape');
  await expect(page.locator('#appSettingsPanel')).toBeHidden();
  await expect(page.locator('#appSettingsToggle')).toBeFocused();
  await closeSidebar(page);
}

async function openLesson(page, bookId = 'KotobaFlow1', lessonId = 'lesson_01') {
  await page.locator('#modBtnLesson').click();
  await revealControl(page.locator('#tbBookSelect'));
  await page.locator('#tbBookSelect').selectOption(bookId);
  const lesson = page.locator(`.tb-lesson-card[data-lesson-id="${lessonId}"]`);
  await revealControl(lesson);
  await lesson.click();
  await expect(lesson).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Escape');
  await expect(page.locator('#tbLessonHeading')).toBeVisible();
}

async function expectExample(locator) {
  await expect(locator).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(locator).toHaveCSS('border-left-width', '2px');
  await expect(locator).toHaveCSS('border-radius', '0px');
}

async function detailHeaderStyle(host) {
  return host.locator('.detail-panel-header').evaluate((el) => {
    const style = getComputedStyle(el);
    return { position: style.position, minHeight: style.minHeight, padding: style.padding };
  });
}

for (const [width, height, mode] of [
  [1600, 900, 'light'],
  [1280, 720, 'dark'],
  [390, 844, 'light'],
]) {
  test(`UI-ART-08 headwords, examples and detail headers share roles at ${width} ${mode}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    const errors = await openReadyApp(page);
    await theme(page, mode);
    await expect(page.locator('.cc-word').first()).toHaveCSS('font-family', /Mincho/);
    await expectExample(page.locator('.cc-example').first());
    await page.locator('.cc-card-body').first().press('Enter');
    const vocab = page.locator('#detailPanel');
    await expect(vocab).toBeVisible();
    await expect(vocab.locator('.vocab-detail h3')).toHaveCSS('font-family', /Mincho/);
    await expect(vocab.locator('#vocabDetailPanelTitle')).toBeVisible();
    await expectExample(vocab.locator('.vocab-detail-example').first());
    const headerStyle = await detailHeaderStyle(vocab);
    await page.keyboard.press('Escape');
    await page.locator('#modBtnGrammar').click();
    await page.locator('.gm-card').first().press('Enter');
    const grammar = page.locator('#grammarDetailPanel');
    await expect(grammar.locator('.gm-detail-title')).toHaveCSS('font-family', /Mincho/);
    await expectExample(grammar.locator('.gm-ex-card').first());
    await expect(grammar.locator('.gm-why').first()).toHaveCSS('font-style', 'normal');
    await expect(grammar.locator('.gm-detail-title')).toHaveCSS('letter-spacing', 'normal');
    expect(await detailHeaderStyle(grammar)).toEqual(headerStyle);
    await page.keyboard.press('Escape');
    await openLesson(page);
    const word = page.locator('#tbReader .tb-inline-highlight-link').first();
    await word.press('Enter');
    const textbook = page.locator('#textbookDetailPanel');
    await expect(textbook.locator('.tb-vocab-popup-head h3')).toHaveCSS('font-family', /Mincho/);
    await expect(textbook.locator('.tb-vocab-popup-head h3')).toHaveCSS('border-bottom-width', '0px');
    await expectExample(textbook.locator('.tb-example').first());
    expect(await detailHeaderStyle(textbook)).toEqual(headerStyle);
    await page.keyboard.press('Escape');
    await expect(word).toBeFocused();
    await expect(page.locator('.tb-paragraph:has(button)').first()).toHaveCSS('text-align', 'start');
    await expect(page.locator('.tb-dialogue-text').first()).not.toHaveCSS('text-align', 'justify');
    expect(errors).toEqual([]);
  });

  for (const practiceMode of ['classic', 'mixed']) {
    test(`UI-ART-18 ${practiceMode} paper question uses available height at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const errors = await openReadyApp(page);
      await theme(page, mode);
      await page.evaluate((selectedMode) => {
        appConfig.startStudySession(taxonomyManager.allWords.slice(0, 3), {
          practiceMode: selectedMode,
          shuffle: false,
        });
      }, practiceMode);
      const card = page.locator(practiceMode === 'classic' ? '.flashcard' : '.practice-card');
      await expect(card).toBeVisible();
      const geometry = await card.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return { height: rect.height, right: rect.right, top: rect.top };
      });
      expect(geometry.height).toBeGreaterThan(height * 0.55);
      expect(geometry.right).toBeLessThanOrEqual(width);
      expect(geometry.top).toBeGreaterThanOrEqual(0);
      await expect(page.locator('.study-exit-action')).toHaveCSS('white-space', 'nowrap');
      const paper = practiceMode === 'classic' ? card.locator('.flashcard-front') : card;
      await expect(paper).toHaveCSS('border-radius', '4px');
      await expect(page.locator(practiceMode === 'classic' ? '.fc-word' : '.practice-prompt')).toHaveCSS(
        'font-family',
        /Mincho/,
      );
      if (practiceMode === 'classic') {
        await card.press('Enter');
        await expect(page.locator('.fc-word-sm')).toHaveCSS('font-family', /Mincho/);
        await page.locator('[data-fb="known"]').click();
        await expect(page.locator('.study-stats-row')).toContainText('2 / 3');
      } else {
        await page.locator('.practice-option').first().click();
        await expect(page.locator('.practice-feedback')).toBeVisible();
        await page.locator('#btnPracticeNext').click();
        await expect(page.locator('.study-stats-row')).toContainText('2 / 3');
        // The next question uses Chinese prompt text and keeps the UI font.
        await expect(page.locator('.practice-prompt')).toHaveCSS('font-family', /Microsoft YaHei/);
      }
      expect(errors).toEqual([]);
    });
  }
}

test('UI-ART-11 a mobile headword has a complete line and tools keep their own space', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await openReadyApp(page);
  const search = page.locator('#searchInput');
  await revealControl(search);
  await search.fill('相容れない');
  await search.press('Enter');
  await page.keyboard.press('Escape');
  const headword = page.locator('.cc-word').filter({ hasText: '相容れない' }).first();
  await expect(headword).toBeVisible();
  const geometry = await headword.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const lines = [...range.getClientRects()].filter((r) => r.width > 0);
    const bounds = el.getBoundingClientRect();
    const tools = el.closest('.cc-card').querySelector('.cc-card-head').getBoundingClientRect();
    return {
      lines: lines.length,
      within: lines.every((r) => r.left >= bounds.left - 1 && r.right <= bounds.right + 1),
      toolsAbove: tools.bottom <= bounds.top + 1,
      documentOverflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  expect(geometry).toEqual({ lines: 1, within: true, toolsAbove: true, documentOverflow: false });
  await headword.locator('..').press('Enter');
  await expect(page.locator('#detailPanel')).toBeVisible();
  expect(errors).toEqual([]);
});

test('UI-ART-08 modal scrims use one tint without blur in both themes', async ({ page }) => {
  await openReadyApp(page);
  for (const mode of ['light', 'dark']) {
    await theme(page, mode);
    await page.keyboard.press('Control+k');
    await expect(page.locator('.global-search-overlay')).toBeVisible();
    const searchScrim = await page.locator('.global-search-backdrop').evaluate((el) => {
      const style = getComputedStyle(el);
      return { background: style.backgroundColor, blur: style.backdropFilter };
    });
    expect(searchScrim.blur).toBe('none');
    await page.keyboard.press('Escape');
    await page.locator('#statusBarShowBtn').click();
    await expect(page.locator('#narrowGlobalSidebarBackdrop')).toHaveCSS(
      'background-color',
      searchScrim.background,
    );
    await page.keyboard.press('Escape');
    const dialogScrims = await page.evaluate(() =>
      ['.archive-dialog', '.appearance-editor'].map(
        (selector) => getComputedStyle(document.querySelector(selector), '::backdrop').backgroundColor,
      ),
    );
    expect(dialogScrims).toEqual(Array(2).fill(searchScrim.background));
  }
});

test('UI-ART-08 Japanese search results keep the same headword role', async ({ page }) => {
  await openReadyApp(page);
  await page.keyboard.press('Control+k');
  for (const [query, group] of [
    ['相容れない', '词汇结果'],
    ['あっての', '语法结果'],
    ['こんにちは', '课文结果'],
  ]) {
    await page.locator('#globalSearchInput').fill(query);
    const headword = page.locator(`.global-search-group[aria-label="${group}"] strong[lang="ja"]`).first();
    await expect(headword).toBeVisible();
    await expect(headword).toHaveCSS('font-family', /Mincho/);
    await expect(headword).toHaveCSS('font-weight', '600');
  }
});

for (const width of [1600, 390]) {
  test(`UI-ART-08 curriculum examples retain numbering without a grey box at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await openReadyApp(page);
    await openLesson(page);
    const book = page.locator('#tbReader .book-frame');
    const picker = book.locator('.book-page-select');
    await expect(picker.locator('option').filter({ hasText: '语法' }).first()).toBeAttached();
    const grammarPages = await picker
      .locator('option')
      .evaluateAll((options) =>
        options.filter((option) => option.textContent.includes('语法')).map((option) => option.value),
      );
    expect(grammarPages.length).toBeGreaterThan(0);
    const examples = page.locator('.tb-cgrammar-examples').first();
    const example = examples.locator('li').first();
    for (const value of grammarPages) {
      await picker.selectOption(value);
      await settleBook(book);
      const bounds = await example.boundingBox();
      if (bounds && bounds.x >= 0 && bounds.x + bounds.width <= width) break;
    }
    await expect(example).toBeInViewport({ ratio: 0.5 });
    await expect(examples).toHaveAttribute('aria-label', '例句');
    await expect(examples).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expectExample(example);
    await expect(examples.locator('.tb-cgrammar-example-ja').first()).toHaveCSS('font-family', /Yu Gothic/);
    expect(
      await examples
        .locator('li')
        .first()
        .evaluate((el) => getComputedStyle(el, '::before').content),
    ).toBe('counter(tb-cgrammar-example)');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('UI-ART-08 a hovered detail close button remains readable in dark mode', async ({ page }) => {
  await openReadyApp(page);
  await theme(page, 'dark');
  await page.locator('.cc-card-body').first().press('Enter');
  const close = page.locator('#detailPanelCollapseBtn');
  await expect(close).toBeVisible();
  await close.hover();
  await close.evaluate((el) => Promise.all(el.getAnimations().map((animation) => animation.finished)));
  await expectReadable(close, { minRatio: 3 });
  await close.click();
  await expect(page.locator('#detailPanel')).toBeHidden();
});

async function paragraphGeometry(paragraph) {
  return paragraph.evaluate((el) => {
    const chars = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const style = getComputedStyle(el);
    let text;
    while ((text = walker.nextNode())) {
      for (let offset = 0; offset < text.textContent.length; offset++) {
        const range = document.createRange();
        range.setStart(text, offset);
        range.setEnd(text, offset + 1);
        const rect = range.getBoundingClientRect();
        if (rect.width) chars.push({ char: text.textContent[offset], rect });
      }
    }
    const punctuationGaps = [];
    const lines = [];
    for (let i = 0; i < chars.length; i++) {
      const current = chars[i];
      const previous = chars[i - 1];
      // A line can resume at the same vertical position in another book column.
      if (
        !previous ||
        Math.abs(current.rect.top - previous.rect.top) > 1 ||
        current.rect.left < previous.rect.left
      ) {
        lines.push([]);
      }
      if (current.char.trim()) lines[lines.length - 1].push(current.char);
      if (
        previous &&
        /[、。！？]/.test(current.char) &&
        previous.char.trim() &&
        Math.abs(current.rect.top - previous.rect.top) < 1
      ) {
        punctuationGaps.push(current.rect.left - previous.rect.right);
      }
    }
    return {
      fontSize: parseFloat(style.fontSize),
      punctuationGaps,
      lines: lines.filter((line) => line.length).map((line) => line.join('')),
    };
  });
}

for (const [width, height, layout] of [
  [1280, 720, 'scroll'],
  [390, 844, 'book'],
]) {
  test(`UI-ART-11 interactive Japanese keeps punctuation adjacent at ${width} ${layout}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await openReadyApp(page);
    await chooseReadingLayout(page, layout);
    await openLesson(page, 'XinBian1', 'lesson_02');
    for (const mode of ['normal', 'chunks', 'plain']) {
      const control = page.locator(`.tb-display-mode-btn[data-display-mode="${mode}"]`);
      await revealControl(control);
      await control.click();
      await page.keyboard.press('Escape');
      const paragraph =
        mode === 'normal'
          ? page.locator('.tb-paragraph:has(button)').first()
          : page.locator('.tb-paragraph').filter({ hasText: 'はじめまして' }).first();
      await expect(paragraph).toBeAttached();
      await paragraph.scrollIntoViewIfNeeded();
      await paragraph.evaluate((el) =>
        Promise.all(el.getAnimations({ subtree: true }).map((animation) => animation.finished)),
      );
      const geometry = await paragraphGeometry(paragraph);
      expect(geometry.punctuationGaps.length).toBeGreaterThan(0);
      if (mode !== 'plain') {
        await expect(paragraph.locator('button').first()).toBeAttached();
        await expect(paragraph).toHaveCSS('text-align', 'start');
        // The only permitted separation is the chunk's tiny inline padding;
        // justify used to insert a word-sized gap before a sentence's full stop.
        for (const gap of geometry.punctuationGaps) expect(gap).toBeLessThan(geometry.fontSize * 0.25);
      } else {
        await expect(paragraph.locator('button')).toHaveCount(0);
        await expect(paragraph).toHaveCSS('text-align', 'justify');
        expect(geometry.lines.length).toBeGreaterThan(1);
        for (const line of geometry.lines) {
          expect(line).not.toMatch(/^[、。，．？！）」』】》〉〕］｝]/);
          expect(line).not.toMatch(/[（「『【《〈〔［｛]$/);
        }
      }
      await expect(paragraph).toHaveCSS('line-break', 'strict');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  });
}
