// BOOK-FIX-01: native keyboard focus must remain on the visible book spread.
const { test, expect } = require('@playwright/test');
const {
  DEFAULT_LAYOUT_STORAGE,
  openReadyApp,
  revealControl,
  selectTextbook,
  settleBook,
} = require('./helpers');

test.use({ serviceWorkers: 'block', storageState: DEFAULT_LAYOUT_STORAGE });
test.beforeEach(async ({ page }) => {
  await page.route('**/js/storage-config.js*', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: "window.JPLearnStorageConfig = Object.freeze({ mode: 'browser' });",
    }),
  );
});

async function openBook(page, kind) {
  const errors = await openReadyApp(page, {
    module: kind === 'vocab' ? 'vocab' : kind === 'lesson' ? 'lesson' : 'grammar',
  });
  if (kind === 'reader') {
    await revealControl(page.locator('#gmSideNavLesson'));
    await page.locator('#gmSideNavLesson').click();
    await revealControl(page.locator('.gm-lesson-card').first());
    await page.locator('.gm-lesson-card').first().click();
  } else if (kind === 'lesson') {
    await selectTextbook(page, 'KotobaFlow1');
    const lesson = page.locator('.tb-lesson-card[data-lesson-id="lesson_01"]');
    await revealControl(lesson);
    await lesson.click();
    // A book from the previous lesson can stay visible while the new body loads.
    await expect(page.locator('#tbLessonHeading')).toContainText('こんにちは');
    await expect(page.locator('#tbLoading')).toHaveClass(/hidden/);
  }
  if ((await page.locator('#statusBarShowBtn').getAttribute('aria-expanded')) === 'true')
    await page.keyboard.press('Escape');
  const selector = {
    vocab: '#card-container',
    grammar: '#gmGrammarList',
    reader: '#gmLessonReader',
    lesson: '#tbReader',
  }[kind];
  const book = page.locator(`${selector} .book-frame`);
  await expect(book).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return { book, errors };
}

async function middleSpread(book, withControls) {
  return book.evaluate((frame, withControls) => {
    const body = frame.querySelector('.book-body');
    const bounds = body.getBoundingClientRect();
    const scale = body.clientWidth / bounds.width;
    const stride = body.clientWidth + parseFloat(getComputedStyle(body).columnGap);
    const counts = Array(frame.querySelector('.book-page-select').options.length).fill(0);
    for (const control of body.querySelectorAll(
      'a[href], button, input, select, textarea, summary, [tabindex]',
    )) {
      if (control.tabIndex < 0 || control.disabled || getComputedStyle(control).visibility !== 'visible')
        continue;
      const rect = control.getClientRects()[0];
      if (!rect || !rect.width || !rect.height) continue;
      const spread = Math.floor(((rect.left - bounds.left) * scale + body.scrollLeft + 2) / stride);
      if (spread >= 0 && spread < counts.length) counts[spread]++;
    }
    const candidates = counts
      .map((count, spread) => ({ count, spread }))
      .filter(({ count, spread }) => spread > 0 && spread < counts.length - 1 && count > 0 === withControls)
      .sort((a, b) => Math.abs(a.spread - counts.length / 2) - Math.abs(b.spread - counts.length / 2));
    return candidates[0] || null;
  }, withControls);
}

async function focusState(book) {
  return book.evaluate((frame) => {
    const body = frame.querySelector('.book-body');
    const active = document.activeElement;
    if (!body.contains(active)) return null;
    const bounds = body.getBoundingClientRect();
    const visible = [...active.getClientRects()].some(
      (rect) =>
        rect.width > 0 &&
        rect.height > 0 &&
        rect.left >= bounds.left - 2 &&
        rect.right <= bounds.right + 2 &&
        rect.top >= Math.max(bounds.top, 0) - 2 &&
        rect.bottom <= Math.min(bounds.bottom, innerHeight) + 2,
    );
    return {
      visible,
      text: active.getAttribute('aria-label') || active.textContent.trim().slice(0, 70),
      page: Number(frame.querySelector('.book-page-select').value),
    };
  });
}

async function walkFocus(page, book, reverse) {
  const count = await book.locator('.book-body').evaluate((body, reverse) => {
    const controls = [...body.querySelectorAll('button, a[href], input, select, summary, [tabindex]')].filter(
      (element) => element.tabIndex >= 0 && !element.disabled && element.getClientRects().length,
    );
    const first = reverse ? controls[controls.length - 1] : controls[0];
    first.focus();
    return controls.length;
  }, reverse);
  expect(count).toBeGreaterThan(3);
  const visited = new Set();
  for (let index = 0; index < Math.min(count, 120); index++) {
    if (index) await page.keyboard.press(reverse ? 'Shift+Tab' : 'Tab');
    // Include native scroll settling, which used to move the focused control
    // back outside the clipped spread after the browser had revealed it.
    await page.waitForTimeout(180);
    const state = await focusState(book);
    expect(state, `focus left the body at ${index}/${count}`).not.toBeNull();
    expect(state.visible, `offscreen ${reverse ? 'reverse ' : ''}focus: ${state.text}`).toBe(true);
    visited.add(state.page);
  }
  expect(visited.size).toBeGreaterThan(1);
}

for (const kind of ['vocab', 'grammar', 'reader', 'lesson']) {
  test(`book focus: ${kind} native Tab and Shift+Tab reveal focused controls across spreads`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const { book, errors } = await openBook(page, kind);
    await walkFocus(page, book, false);
    await walkFocus(page, book, true);
    expect(errors).toEqual([]);
  });
}

test('book focus: single-page vocabulary layout follows Tab in both directions', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 768, height: 1024 });
  const { book, errors } = await openBook(page, 'vocab');
  await expect(book).toHaveClass(/is-single/);
  await walkFocus(page, book, false);
  await walkFocus(page, book, true);
  expect(errors).toEqual([]);
});

test('book focus: same-spread focus keeps the open dictionary and keyboard layers stay isolated', async ({
  page,
}) => {
  const { book, errors } = await openBook(page, 'vocab');
  const pages = book.locator('.book-page-select');
  const firstCard = book.locator('.cc-card-body').first();
  await firstCard.click();
  const detail = page.locator('#detailPanel');
  await expect(detail).toHaveClass(/anchored-detail-open/);
  await firstCard.focus();
  await expect(pages).toHaveValue('0');
  await expect(detail).toHaveClass(/anchored-detail-open/);
  await page.keyboard.press('PageDown');
  await expect(pages).toHaveValue('0');
  await expect(detail).toHaveClass(/anchored-detail-open/);
  await page.keyboard.press('Escape');
  await expect(detail).not.toHaveClass(/anchored-detail-open/);

  await firstCard.focus();
  await page.keyboard.press('ArrowRight');
  await expect(pages).toHaveValue('1');
  expect((await focusState(book)).visible).toBe(true);
  await page.keyboard.press('Tab');
  await expect(pages).toHaveValue('1');
  expect((await focusState(book)).visible).toBe(true);
  await page.locator('#statusBarShowBtn').click();
  await page.locator('#searchInput').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('PageDown');
  await expect(pages).toHaveValue('1');
  await page.locator('#modBtnVocab').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(pages).toHaveValue('1');
  await page.keyboard.press('Escape');
  // Escape closes the sidebar and then returns focus to its button.
  await expect(page.locator('#statusBarShowBtn')).toBeFocused();

  await page.keyboard.press('Control+k');
  await expect(page.locator('#globalSearchInput')).toBeFocused();
  await page.keyboard.press('PageDown');
  await page.keyboard.press('ArrowLeft');
  await expect(pages).toHaveValue('1');
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

for (const kind of ['vocab', 'lesson']) {
  test(`book focus: ${kind} layout changes and delayed settling preserve visible focus`, async ({ page }) => {
    const { book, errors } = await openBook(page, kind);
    const target =
      kind === 'vocab' ? book.locator('.cc-card-body').nth(8) : book.locator('.book-body button').nth(65);
    await target.focus();
    await expect.poll(async () => (await focusState(book)).visible).toBe(true);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(300);
    await expect(target).toBeFocused();
    expect((await focusState(book)).visible).toBe(true);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    const state = await focusState(book);
    expect(state.visible).toBe(true);
    await page.waitForTimeout(300);
    expect(await focusState(book)).toEqual(state);
    expect(errors).toEqual([]);
  });
}

// A short reader shows the top of a taller frame. Pressing a control focuses
// it on pointerdown; following that focus must not scroll the reader and move
// the control from under the pointer before the click lands.
test('book focus: pressing a word in a frame taller than the reader keeps the click on it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 540 });
  const { book, errors } = await openBook(page, 'lesson');
  const point = await book.evaluate((frame) => {
    const reader = document.getElementById('tbReader');
    const body = frame.querySelector('.book-body');
    const limits = reader.getBoundingClientRect();
    const bounds = body.getBoundingClientRect();
    const control = [...body.querySelectorAll('button')].find((element) => {
      const rect = element.getBoundingClientRect();
      return (
        rect.width > 4 &&
        rect.left >= bounds.left &&
        rect.right <= bounds.right &&
        rect.top >= limits.top + 8 &&
        rect.bottom <= Math.min(limits.bottom, bounds.bottom) - 8
      );
    });
    control.setAttribute('data-press-target', '');
    window.__pressClicks = [];
    document.addEventListener(
      'click',
      (event) => window.__pressClicks.push(!!event.target.closest('[data-press-target]')),
      true,
    );
    const rect = control.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      overflows: frame.getBoundingClientRect().bottom > limits.bottom + 1,
    };
  });
  expect(point.overflows).toBe(true);
  const scrollTop = () => page.locator('#tbReader').evaluate((reader) => reader.scrollTop);
  const before = await scrollTop();
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  expect(await scrollTop()).toBe(before);
  await page.mouse.up();
  expect(await page.evaluate(() => window.__pressClicks)).toEqual([true]);
  expect(errors).toEqual([]);
});

// Native order would enter at the first or last control of the whole content,
// turning to the opposite end of the book. Keyboard entry starts on the shown spread.
for (const kind of ['vocab', 'lesson']) {
  test(`book focus: ${kind} Tab and Shift+Tab from outside enter the shown spread`, async ({ page }) => {
    const { book, errors } = await openBook(page, kind);
    if (kind === 'vocab') {
      // Word-book entries fit a 24-word group on two spreads; a larger group has a middle one.
      await revealControl(page.locator('#ccPerPageSelect'));
      await page.locator('#ccPerPageSelect').selectOption('96');
      if ((await page.locator('#statusBarShowBtn').getAttribute('aria-expanded')) === 'true')
        await page.keyboard.press('Escape');
      await expect(book.locator('.book-status-extra')).toContainText('1–96 词');
    }
    const pages = book.locator('.book-page-select');
    const spreads = await pages.locator('option').count();
    // A middle spread, so entering at either end of the content would turn it.
    expect(spreads).toBeGreaterThan(2);
    // Typography can put only prose on the mathematical middle spread. This
    // case verifies entry into controls; text-only spreads have their own case.
    const candidate = await middleSpread(book, true);
    expect(candidate).not.toBeNull();
    const spread = String(candidate.spread);
    await pages.selectOption(spread);
    for (const [from, key] of [
      ['.book-edge.is-prev', 'Tab'],
      ['.book-edge.is-next', 'Shift+Tab'],
    ]) {
      await book.locator(from).focus();
      await page.keyboard.press(key);
      await page.waitForTimeout(180);
      await expect(pages).toHaveValue(spread);
      const state = await focusState(book);
      expect(state, `${key} did not enter the book`).not.toBeNull();
      expect(state.visible, `${key} focused ${state.text}`).toBe(true);
    }
    expect(errors).toEqual([]);
  });
}

for (const viewport of [
  { width: 1600, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`book focus: a text-only lesson spread keeps its page and lets Tab leave at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const { book, errors } = await openBook(page, 'lesson');
    const candidate = await middleSpread(book, false);
    expect(candidate).not.toBeNull();
    expect(candidate.count).toBe(0);
    const spread = String(candidate.spread);
    const pages = book.locator('.book-page-select');
    const previous = book.locator('.book-edge.is-prev');
    const next = book.locator('.book-edge.is-next');
    const footerPrevious = book.locator('.book-turn.is-prev');
    // The lesson directory sits in the heading row, so the heading's last
    // action is the stop just before the book.
    const headingActions = page.locator('#tbLessonHeading .page-heading-action');
    const lastAction = headingActions.last();
    const phone = viewport.width === 390;
    if (phone) {
      await expect(previous).toBeHidden();
      await expect(next).toBeHidden();
    }
    for (const [from, key, expected, afterNextTab] of [
      [phone ? lastAction : previous, 'Tab', phone ? footerPrevious : next, phone ? pages : footerPrevious],
      [
        phone ? footerPrevious : next,
        'Shift+Tab',
        phone ? lastAction : previous,
        phone ? headingActions.nth(-2) : lastAction,
      ],
    ]) {
      await pages.selectOption(spread);
      await from.focus();
      await page.keyboard.press(key);
      await expect(expected).toBeFocused();
      await expect(expected).toBeInViewport();
      // Include native scroll settling and the page-turn animation, then keep
      // walking in the same direction to rule out a focus loop.
      await page.waitForTimeout(300);
      await expect(pages).toHaveValue(spread);
      await page.keyboard.press(key);
      await expect(afterNextTab).toBeFocused();
      await page.waitForTimeout(300);
      await expect(pages).toHaveValue(spread);
      await settleBook(book);
      expect(
        await book.locator('.book-body').evaluate((body) => {
          const stride = body.clientWidth + parseFloat(getComputedStyle(body).columnGap);
          return Math.abs(
            body.scrollLeft - Number(body.parentElement.querySelector('.book-page-select').value) * stride,
          );
        }),
      ).toBeLessThanOrEqual(1);
    }
    expect(errors).toEqual([]);
  });
}
