// EXP-BOOK-01: page-turn reading is the default layout for the vocabulary cards
// and grammar; the legacy scrolling layout is chosen only in the display
// settings. The textbook variant is covered in curriculum.spec.js.
const { test, expect } = require('@playwright/test');
const {
  DEFAULT_LAYOUT_STORAGE,
  chooseReadingLayout,
  openSettings,
  openReadyApp,
  revealControl,
  settleBook,
} = require('./helpers');
test.use({ serviceWorkers: 'block', storageState: DEFAULT_LAYOUT_STORAGE });

async function turnToEdge(book) {
  const next = book.locator('.book-turn[data-book-flip="next"]');
  for (let i = 0; i < 40 && (await next.isEnabled()) && (await next.textContent()).includes('下一页'); i++)
    await next.click();
  return next;
}

test('word cards open as a word book that turns into the next group', async ({ page }) => {
  const errors = await openReadyApp(page, { module: 'vocab' });
  const book = page.locator('#card-container .book-frame');
  const status = book.locator('.book-status');
  await expect(book).toBeVisible();
  await expect(book).not.toHaveClass(/is-single/);
  await expect(page.locator('#card-container .cc-pagination')).toHaveCount(0);
  // The vocabulary drawer keeps its original tools: no layout switch anywhere in the module.
  await expect(
    page.locator('#vocabMain [data-book-view-toggle], #vocabViewTools [data-book-view-toggle]'),
  ).toHaveCount(0);
  await expect(status).toContainText(/^第 1–2 页 \/ 共 \d+ 页 · 第 1 \/ \d+ 组 · 1–24 词/);
  await expect(book.locator('.book-turn[data-book-flip="prev"]')).toBeDisabled();

  // Every card of the group is reachable on some spread and opens its details.
  const next = await turnToEdge(book);
  await expect(next).toContainText('下一组');
  const lastCard = book.locator('.cc-card').last();
  // Measure after the turn, not between two frames of it.
  await settleBook(book);
  const area = await book.locator('.book-body').boundingBox();
  const cardBox = await lastCard.boundingBox();
  expect(cardBox.x).toBeGreaterThanOrEqual(area.x - 1);
  expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(area.x + area.width + 1);
  await lastCard.locator('.cc-card-body').click();
  await expect(page.locator('#detailPanel')).toHaveClass(/anchored-detail-open/);
  await page.keyboard.press('Escape');

  await next.click();
  await expect(status).toContainText('第 2 / ');
  await expect(status).toContainText('第 1–2 页');
  await book.locator('.book-body').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(status).toContainText('第 1 / ');
  await expect(book.locator('.book-turn[data-book-flip="next"]')).toContainText('下一组');
  expect(errors).toEqual([]);
});

test('the legacy scrolling layout is a display setting that lasts across reloads', async ({ page }) => {
  const errors = await openReadyApp(page, { module: 'vocab' });
  await expect(page.locator('#card-container .book-frame')).toBeVisible();
  await openSettings(page);
  const select = page.locator('#appReadingLayoutSelect');
  await expect(select).toHaveValue('book');
  await expect(select.locator('option[value="book"]')).toHaveText('翻页（默认）');
  await expect(select.locator('option[value="scroll"]')).toHaveText('连续滚动（旧版）');
  await page.locator('#appSettingsToggle').click();

  await chooseReadingLayout(page, 'scroll');
  await expect(page.locator('#card-container .book-frame')).toHaveCount(0);
  await expect(page.locator('#card-container .cc-pagination')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('jp_learning_reading_layout_v1'))).toBe('scroll');

  await page.reload();
  await openReadyApp(page, { module: 'vocab' });
  await expect(page.locator('#card-container .cc-pagination')).toBeVisible();
  await expect(page.locator('#card-container .book-frame')).toHaveCount(0);

  await chooseReadingLayout(page, 'book');
  await expect(page.locator('#card-container .book-frame')).toBeVisible();
  expect(errors).toEqual([]);
});

test('grammar points and supplementary lessons read as books by default', async ({ page }) => {
  const errors = await openReadyApp(page, { module: 'grammar' });
  await expect(page.locator('#gmSidebarContent [data-book-view-toggle]')).toHaveCount(0);

  const book = page.locator('#gmGrammarList .book-frame');
  const status = book.locator('.book-status');
  await expect(book).toBeVisible();
  await expect(page.locator('#gmGrammarList .gm-pagination')).toHaveCount(0);
  await expect(status).toContainText(/第 1 \/ \d+ 组 · 1–24 条/);
  const next = await turnToEdge(book);
  await expect(next).toContainText('下一组');
  await next.click();
  await expect(status).toContainText(/第 2 \/ \d+ 组 · 25–48 条/);
  const card = book.locator('.gm-card').first();
  await card.click();
  await expect(page.locator('#grammarDetailPanel')).toHaveClass(/anchored-detail-open/);
  await page.keyboard.press('Escape');

  await revealControl(page.locator('#gmSideNavLesson'));
  await page.locator('#gmSideNavLesson').click();
  await revealControl(page.locator('.gm-lesson-card').first());
  await page.locator('.gm-lesson-card').first().click();
  const reader = page.locator('#gmLessonReader .book-frame');
  await expect(reader).toBeVisible();
  await expect(page.locator('#gmReaderBack')).toBeVisible();
  await expect(reader.locator('.gm-reader-grammar-briefs')).toHaveAttribute('open', '');
  await expect(reader.locator('.book-status')).toContainText(/课文信息|目标语法/);
  const readerNext = await turnToEdge(reader);
  await expect(readerNext).toBeDisabled();
  await expect(reader.locator('.book-status')).toContainText('正文阅读');

  await chooseReadingLayout(page, 'scroll');
  await expect(page.locator('#gmLessonReader .book-frame')).toHaveCount(0);
  await expect(page.locator('#gmLessonReader .gm-reader-article')).toBeVisible();
  expect(errors).toEqual([]);
});
