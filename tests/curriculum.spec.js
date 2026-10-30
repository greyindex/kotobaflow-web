// PUB-04: the KotobaFlow 77-lesson curriculum beside the legacy XinBian books.
// Audio is generated locally and git-ignored, so media is mocked in memory.
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const {
  DEFAULT_LAYOUT_STORAGE,
  chooseReadingLayout,
  openReadyApp,
  revealControl,
  selectTextbook,
  settleBook,
} = require('./helpers');
const { silentOgg } = require('./audio-fixtures');
test.use({ serviceWorkers: 'block' });

const books = ['KotobaFlow1', 'KotobaFlow2', 'KotobaFlow3', 'KotobaFlow4'];
const source = (book) =>
  JSON.parse(
    fs.readFileSync(path.join(__dirname, '../data/textbook/canonical_books', book + '.bundle.json'), 'utf8'),
  );

// A lesson-07 word without a legacy recording; the installed words.json gives it its own file.
const supplementWord = (() => {
  const dir = path.join(__dirname, '../data/textbook/book_chunks');
  const catalog = JSON.parse(fs.readFileSync(path.join(dir, 'KotobaFlow1.json'), 'utf8'));
  const rows = JSON.parse(fs.readFileSync(path.join(dir, catalog.vocabulary.lesson_07), 'utf8'));
  return rows.find((row) => row.vocab_audio_index == null);
})();
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function mockCurriculumAudio(page, { completeKana = false } = {}) {
  const requests = [];
  const audio = silentOgg(3);
  const sectionRow = (book, lesson, key, dir, kind) => ({
    status: 'ok',
    book,
    lesson_id: lesson,
    lesson_no: Number(lesson.slice(-2)),
    section_key: key,
    output: `data/${dir}/${book}/${lesson.slice(-2)}_${lesson}/${key}/${book}_${lesson.slice(-2)}_${key}_${kind}.ogg`,
    manifest: `data/${dir}/${book}/${lesson.slice(-2)}_${lesson}/${key}/manifest.json`,
  });
  const reading = 'kotobaflow_reading_chirp_v1';
  const dialogue = 'kotobaflow_dialogue_lite_v1';
  await page.route(/\/data\/(?:gcloud_chirp3_|gemini38_flash_tts_|kotobaflow_)/, async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    requests.push(pathname);
    if (pathname.endsWith(`/${reading}/manifest.jsonl`))
      return route.fulfill({
        body: JSON.stringify(sectionRow('KotobaFlow1', 'lesson_01', 'body', reading, 'reading')),
      });
    if (pathname.endsWith(`/${dialogue}/manifest.jsonl`))
      return route.fulfill({
        body: JSON.stringify(sectionRow('KotobaFlow1', 'lesson_01', 'conversation', dialogue, 'dialogue')),
      });
    if (pathname.endsWith('/gemini38_flash_tts_kotobaflow_kana_candidate_v1/clips.json'))
      return route.fulfill({
        json: {
          schema: 1,
          clips: (completeKana
            ? ['K', 'W'].flatMap((kind) =>
                Array.from({ length: 46 }, (_, i) => `C00-${kind}${String(i + 1).padStart(2, '0')}`),
              )
            : ['C00-K01', 'C00-W01', 'C00-K46']
          ).map((id) => ({ id, audio_relpath: `clips/${id}.ogg` })),
        },
      });
    if (pathname.endsWith('/kotobaflow_word_audio_v1/words.json'))
      return route.fulfill({
        json: {
          schema: 1,
          count: 1,
          words: {
            [`KotobaFlow1/lesson_07/${supplementWord.index}`]: {
              file: 'audio/00xxx/00007.ogg',
              sha256: 'ab'.repeat(32),
            },
          },
        },
      });
    if (pathname.endsWith('/kotobaflow_unit_images_v1/images.json'))
      return route.fulfill({
        json: {
          schema: 1,
          count: 1,
          images: {
            'KotobaFlow1/lesson_01': {
              file: 'KotobaFlow1/lesson_01.webp',
              width: 1280,
              height: 720,
              title_zh: '听见日语：姓名、问候与求助',
              webp_sha256: 'cd'.repeat(32),
            },
          },
        },
      });
    if (pathname.endsWith('.webp'))
      return route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG });
    if (pathname.endsWith('.ogg'))
      return route.fulfill({ status: 200, contentType: 'audio/ogg', body: audio });
    return route.fulfill({ status: 404, body: '' });
  });
  return requests;
}

async function openCurriculumLesson(page, book, lessonId) {
  await selectTextbook(page, book);
  const directory = page.locator('.tb-lesson-directory');
  await revealControl(directory.locator('summary'));
  if (!(await directory.evaluate((element) => element.open))) await directory.locator('summary').click();
  const card = page.locator(`.tb-lesson-card[data-lesson-id="${lessonId}"]`);
  await revealControl(card);
  await card.click();
  await expect(card).toHaveAttribute('aria-current', 'page');
  // Close the overlay drawer the way a reader does before using the page.
  await page.keyboard.press('Escape');
  await expect(page.locator('#narrowGlobalSidebarBackdrop')).toHaveAttribute('aria-hidden', 'true');
}

test('KotobaFlow catalogs list 77 lessons beside the unchanged XinBian books', async ({ page }) => {
  await openReadyApp(page, { module: 'dashboard' });
  const counts = [];
  for (const book of books) {
    const index = await page.evaluate((id) => TextbookLoader.getBookIndex(id), book);
    expect(index).toEqual(source(book).index);
    counts.push(index.lessons.length);
  }
  expect(counts).toEqual([19, 18, 20, 20]);
  const ids = await page.evaluate(() => TextbookLoader.getBooks().then((list) => list.map((b) => b.id)));
  expect(ids).toEqual(['XinBian1', 'XinBian2', 'XinBian3', 'XinBian4', ...books]);
  expect(await page.evaluate(() => TextbookLoader.isKnownBook('KotobaFlow0'))).toBe(false);
});

test.describe('KotobaFlow vocabulary enrichment', () => {
  test.use({ storageState: DEFAULT_LAYOUT_STORAGE });
  for (const viewport of [
    { width: 1600, height: 900 },
    { width: 1280, height: 720 },
    { width: 390, height: 844 },
  ]) {
    test(`new senses and examples stay reachable in the detail panel at ${viewport.width}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const errors = await openReadyApp(page, { module: 'lesson' });
      await mockCurriculumAudio(page);
      await openCurriculumLesson(page, 'KotobaFlow1', 'lesson_01');
      await page.locator('.tb-book-cover img').evaluate((image) => image.decode());
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      const outline = page.locator('.tb-outline a').filter({ hasText: '本课词汇' });
      await revealControl(outline);
      await outline.click();
      await page.keyboard.press('Escape');
      const word = page.locator('.tb-reading-vocab-open').filter({ hasText: 'すみません' }).first();
      const book = page.locator('#tbReader .book-frame');
      expect(
        await book.locator('.book-body').evaluate((body) => {
          const css = getComputedStyle(body);
          return [parseFloat(css.paddingLeft), parseFloat(css.paddingRight)];
        }),
      ).toEqual([0, 0]);
      // Navigate with real controls; never let locator.click scroll an off-page word.
      for (let i = 0; i < 8; i++) {
        const direction = await word.evaluate((element) => {
          const a = element.getBoundingClientRect();
          const b = element.closest('.book-body').getBoundingClientRect();
          return a.left < b.left - 1 ? 'prev' : a.right > b.right + 1 ? 'next' : '';
        });
        if (!direction) break;
        await book.locator('.book-turn[data-book-flip="' + direction + '"]').click();
      }
      await expect(word).toBeInViewport();
      await word.click();
      const panel = page.locator('#textbookDetailPanel');
      await expect(panel).toBeVisible();
      await expect(panel).toContainText('引起注意或轻度致歉');
      await expect(panel).toContainText('人に声をかけたり');
      await expect(panel).toContainText('课内例句');
      await expect(panel).toContainText('补充例句');
      await expect(panel).toContainText('すみません、駅はどこですか。');
      await expect(panel).toContainText('不好意思。');
      await expect(panel).toContainText('常用搭配');
      const note = panel.locator('.tb-detail-row').filter({ hasText: '用法提示' });
      await note.scrollIntoViewIfNeeded();
      await expect(note).toBeInViewport();
      const box = await panel.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      await page.screenshot({ path: `local/qa/vocab-full-2026-10-08/detail-${viewport.width}.png` });
      await page.keyboard.press('Escape');
      await expect(panel).not.toHaveClass(/anchored-detail-open/);
      expect(errors).toEqual([]);
    });
  }

  test('enrichment is escaped and leaves the legacy curriculum unchanged', async ({ page }) => {
    const dir = path.join(__dirname, '../data/textbook/book_chunks');
    const catalog = JSON.parse(fs.readFileSync(path.join(dir, 'KotobaFlow1.json'), 'utf8'));
    const rows = JSON.parse(fs.readFileSync(path.join(dir, catalog.vocabulary.lesson_01), 'utf8'));
    const injection = '<img src=x onerror="window.__enrichmentInjected=1">';
    rows[0].learning_enrichment.usage_note_zh = injection;
    rows[0].learning_enrichment.senses[0].meaning_ja = injection;
    rows[0].learning_enrichment.senses[0].example_ja = injection;
    rows[0].learning_enrichment.collocations[0].ja = injection;
    await page.route('**/' + catalog.vocabulary.lesson_01 + '*', (route) => route.fulfill({ json: rows }));
    const errors = await openReadyApp(page, { module: 'lesson' });
    await chooseReadingLayout(page, 'scroll');
    await openCurriculumLesson(page, 'KotobaFlow1', 'lesson_01');
    const word = page.locator('.tb-reading-vocab-open').first();
    await word.click();
    const panel = page.locator('#textbookDetailPanel');
    await expect(panel).toContainText(injection);
    await expect(panel.locator('img[src="x"]')).toHaveCount(0);
    expect(await page.evaluate(() => window.__enrichmentInjected)).toBeUndefined();
    await page.keyboard.press('Escape');
    await openCurriculumLesson(page, 'XinBian1', 'lesson_01');
    await page.locator('.tb-reading-vocab-open').first().click();
    await expect(panel).not.toContainText('补充例句');
    await expect(panel).not.toContainText('用法提示');
    expect(errors).toEqual([]);
  });

  for (const [book, lesson] of [
    ['KotobaFlow1', 'lesson_18'],
    ['KotobaFlow2', 'lesson_18'],
    ['KotobaFlow3', 'lesson_20'],
    ['KotobaFlow4', 'lesson_20'],
  ]) {
    test(`full enrichment reaches the last lesson of ${book} through real controls`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 720 });
      const errors = await openReadyApp(page, { module: 'lesson' });
      await chooseReadingLayout(page, 'scroll');
      await openCurriculumLesson(page, book, lesson);
      const source = JSON.parse(
        fs.readFileSync(
          path.join(__dirname, `../data/textbook/kotobaflow/vocab_enrichment/${book}-${lesson}.json`),
          'utf8',
        ),
      ).entries[0];
      await page.locator('.tb-reading-vocab-open[data-vocab-detail-index="0"]').click();
      const panel = page.locator('#textbookDetailPanel');
      await expect(panel).toBeVisible();
      await expect(panel.locator('h3')).toHaveText(source.word);
      for (const sense of source.senses) {
        await expect(panel).toContainText(sense.meaning_ja);
        await expect(panel).toContainText(sense.example_ja);
        await expect(panel).toContainText(sense.example_zh);
      }
      const note = panel.locator('.tb-detail-row').filter({ hasText: '用法提示' });
      await note.scrollIntoViewIfNeeded();
      await expect(note).toBeInViewport();
      await expect(note).toContainText(source.usage_note_zh);
      await page.screenshot({ path: `local/qa/vocab-full-2026-10-08/${book}-last-lesson.png` });
      await page.keyboard.press('Escape');
      await expect(panel).not.toHaveClass(/anchored-detail-open/);
      expect(errors).toEqual([]);
    });
  }
});

test('chapter 0 kana table plays clips and keeps the real blanks', async ({ page }) => {
  const errors = await openReadyApp(page, { module: 'lesson' });
  const requests = await mockCurriculumAudio(page);
  await openCurriculumLesson(page, 'KotobaFlow1', 'lesson_00');
  const table = page.locator('.tb-kana-table');
  await expect(table.locator('thead th')).toHaveCount(6);
  await expect(table.locator('tbody th')).toHaveCount(11);
  await expect(table.locator('[data-kana-clip]')).toHaveCount(92);
  await expect(table.locator('.tb-kana-empty')).toHaveCount(5);
  await expect(page.locator('.tb-reader-lead-media')).toHaveCount(0);

  await table.getByRole('button', { name: '播放 あ／ア（a）' }).click();
  await expect(page.locator('[data-kana-detail]')).toContainText('朝（あさ）');
  await expect(page.locator('[data-tts-status="kana"]')).toContainText('あ／ア（a）');
  expect(requests.some((url) => url.endsWith('/clips/C00-K01.ogg'))).toBe(true);

  await table.getByRole('button', { name: /播放例词 本（ほん）/ }).click();
  await expect(page.locator('[data-kana-detail]')).toContainText('ん／ン');
  expect(requests.some((url) => url.endsWith('/clips/C00-W46.ogg'))).toBe(false);
  await expect(page.locator('[data-tts-status="kana"]')).toContainText('音频暂不可用');

  const first = page.locator('.tb-exercise').first();
  await first.getByRole('button', { name: /ゆ/ }).click();
  await expect(first.locator('.tb-exercise-feedback')).toContainText('正确答案已标出');
  await expect(first.locator('.tb-exercise-choice.is-answer')).toContainText('う');
  await first.getByRole('button', { name: '重做本题' }).click();
  await expect(first.locator('.tb-exercise-feedback')).toBeHidden();
  expect(errors).toEqual([]);
});

test('KotobaFlow lesson shows translations, scenes and exercises', async ({ page }) => {
  const errors = await openReadyApp(page, { module: 'lesson' });
  await mockCurriculumAudio(page);
  await openCurriculumLesson(page, 'KotobaFlow1', 'lesson_01');
  const body = page.locator('.tb-section').first();
  await expect(body.locator('.tb-unit')).toHaveCount(4);
  await expect(body.locator('.tb-translation').first()).toContainText('邻居：早上好。');
  await expect(body.locator('.tb-scene-note').first()).toContainText('公寓门口');
  await expect(page.locator('.tb-dialogue-turn').first().locator('.tb-translation')).toHaveText('晚上好。');

  // Identical Japanese choices fall back to their Chinese explanations.
  const ex1 = page.locator('.tb-exercise').first();
  await expect(ex1.locator('.tb-exercise-choice').first()).toContainText('让我想一想');
  await ex1.locator('.tb-exercise-choice').first().click();
  await expect(ex1.locator('.tb-exercise-feedback')).toContainText('回答正确');
  await expect(page.locator('.tb-exercise-reference summary').first()).toContainText('参考答案');

  const toggle = page.locator('[data-translation-toggle]');
  await revealControl(toggle);
  await toggle.click();
  await expect(page.locator('.tb-translation')).toHaveCount(0);
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(page.locator('.tb-translation').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('lesson illustrations can be hidden on this device and are not downloaded', async ({ page }) => {
  const errors = await openReadyApp(page, { module: 'lesson' });
  const lead = page.locator('.tb-reader-lead-media .tb-section-image');
  // Teaching charts such as the kana table are content, not illustrations.
  const chart = page.locator('.tb-phonetic-lead-media .tb-section-image');
  await expect(lead).toBeVisible();
  const leadSrc = (await lead.getAttribute('src')).replace('./', '');
  const toggle = page.locator('[data-image-toggle]');
  await revealControl(toggle);
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(lead).toHaveCount(0);
  await expect(chart).toHaveCount(1);
  await expect(page.locator('[data-image-toggle]')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => localStorage.getItem('jp_learning_textbook_images_v1'))).toBe('hidden');

  // After a reload the lesson opens without requesting its illustrations.
  const imageRequests = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes(leadSrc)) imageRequests.push(url);
  });
  await openReadyApp(page, { module: 'lesson' });
  await expect(page.locator('#tbReader .tb-section').first()).toBeVisible();
  await expect(lead).toHaveCount(0);
  await expect(chart).toHaveCount(1);
  expect(imageRequests).toEqual([]);

  const again = page.locator('[data-image-toggle]');
  await revealControl(again);
  await again.click();
  await expect(lead).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('jp_learning_textbook_images_v1'))).toBeNull();
  expect(errors).toEqual([]);
});

test('PUB-FIX-02 complete chapter 0 pack plays the final example through its indexed URL', async ({
  page,
}) => {
  const errors = await openReadyApp(page, { module: 'lesson' });
  const requests = await mockCurriculumAudio(page, { completeKana: true });
  await openCurriculumLesson(page, 'KotobaFlow1', 'lesson_00');
  await page
    .locator('.tb-kana-table')
    .getByRole('button', { name: /播放例词 本（ほん）/ })
    .click();
  await expect(page.locator('[data-tts-status="kana"]')).toContainText('本（ほん）');
  await expect.poll(() => requests.some((url) => url.endsWith('/clips/C00-W46.ogg'))).toBe(true);
  await expect(page.locator('[data-tts-status="kana"]')).not.toContainText('音频暂不可用');
  expect(errors).toEqual([]);
});

test('KotobaFlow audio uses the 2026-10-06 Chirp, Lite and word recordings', async ({ page }) => {
  const errors = await openReadyApp(page, { module: 'lesson' });
  const requests = await mockCurriculumAudio(page);
  const urls = await page.evaluate(() =>
    Promise.all([
      TextbookLoader.getReadingAudioUrl('KotobaFlow1', 'lesson_01', 'body'),
      TextbookLoader.getDialogueAudioUrl('KotobaFlow1', 'lesson_01', 'conversation'),
    ]),
  );
  expect(urls[0]).toContain('/kotobaflow_reading_chirp_v1/KotobaFlow1/01_lesson_01/');
  expect(urls[1]).toContain('/kotobaflow_dialogue_lite_v1/KotobaFlow1/01_lesson_01/');

  await openCurriculumLesson(page, 'KotobaFlow1', 'lesson_07');
  const rows = await page.evaluate(async () => TextbookLoader.getLessonVocab('KotobaFlow1', 'lesson_07'));
  const iku = rows.find((row) => row.word === '行く');
  expect(iku.index).not.toBe(iku.vocab_audio_index);
  expect(
    rows.every((row) => row.vocab_audio_index || row.vocab_audio_url || row.audio_available === false),
  ).toBe(true);
  const word = page.locator('.tb-reading-vocab-open').filter({ hasText: '行く' }).first();
  await revealControl(word);
  await word.click();
  await page.locator('#textbookDetailPanel .tb-vocab-audio-btn').click();
  const expected = '/' + String(iku.vocab_audio_index).padStart(5, '0') + '.ogg';
  await expect.poll(() => requests.some((url) => url.endsWith(expected))).toBe(true);
  await page.keyboard.press('Escape');

  // A word without a legacy recording plays its own installed file.
  const supplement = rows.find((row) => row.index === supplementWord.index);
  expect(supplement.audio_available).toBe(true);
  expect(supplement.vocab_audio_url).toContain('/kotobaflow_word_audio_v1/audio/00xxx/00007.ogg');
  const newWord = page.locator('.tb-reading-vocab-open').filter({ hasText: supplementWord.word }).first();
  await revealControl(newWord);
  await newWord.click();
  await page.locator('#textbookDetailPanel .tb-vocab-audio-btn').click();
  await expect
    .poll(() => requests.some((url) => url.endsWith('/kotobaflow_word_audio_v1/audio/00xxx/00007.ogg')))
    .toBe(true);
  expect(errors).toEqual([]);
});

test.describe('page-turn reading (default layout)', () => {
  test.use({ storageState: DEFAULT_LAYOUT_STORAGE });

  test('lessons open as facing pages by default and scroll only from the display settings', async ({
    page,
  }) => {
    const errors = await openReadyApp(page, { module: 'lesson' });
    await mockCurriculumAudio(page);
    await openCurriculumLesson(page, 'KotobaFlow1', 'lesson_01');
    // No layout switch in the lesson drawer: the legacy layout lives in the display settings.
    await expect(page.locator('#tbSidebarReadingControls [data-book-view-toggle]')).toHaveCount(0);
    // The lesson's theme image opens the book.
    const cover = page.locator('#tbReader .book-body > .tb-book-cover img');
    await expect(cover).toHaveAttribute('src', /kotobaflow_unit_images_v1\/KotobaFlow1\/lesson_01\.webp/);
    await expect(cover).toHaveAttribute('alt', '本课主题图：听见日语：姓名、问候与求助');

    const book = page.locator('#tbReader .book-frame');
    const status = book.locator('.book-status');
    const next = book.locator('.book-turn[data-book-flip="next"]');
    const previous = book.locator('.book-turn[data-book-flip="prev"]');
    await expect(book).not.toHaveClass(/is-single/);
    await expect(status).toContainText(/^第 1–2 页 \/ 共 \d+ 页/);
    await expect(previous).toContainText('上一课');
    expect(await page.evaluate(() => localStorage.getItem('jp_learning_reading_layout_v1'))).toBeNull();

    // One-line heading: only the lesson number and title beside the four lesson actions.
    const heading = page.locator('#tbLessonHeading');
    await expect(heading.locator('.page-heading-eyebrow')).toBeHidden();
    await expect(heading.locator('.page-heading-meta')).toBeHidden();
    await expect(heading.locator('.page-heading-title')).toHaveText(/^第1课\s*こんにちは$/);
    const actionTops = await heading
      .locator('.page-heading-action')
      .evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().top)));
    expect(actionTops).toHaveLength(4);
    expect(new Set(actionTops).size).toBe(1);
    const titleBox = await heading.locator('.page-heading-title').boundingBox();
    expect(Math.abs(titleBox.y + titleBox.height / 2 - (actionTops[0] + 18))).toBeLessThan(12);

    // Turn buttons sit at the two ends of their own row; the middle picks a spread.
    const footerBox = await book.locator('.book-footer').boundingBox();
    const previousBox = await previous.boundingBox();
    const nextBox = await next.boundingBox();
    const footerEdge = footerBox.x + footerBox.width;
    expect(previousBox.x - footerBox.x).toBeLessThan(80);
    expect(footerEdge - (nextBox.x + nextBox.width)).toBeLessThan(80);
    const picker = book.locator('.book-page-select');
    await expect(picker.locator('option').first()).toHaveText(/^第 1–2 页/);
    await expect(picker).toHaveValue('0');

    await next.click();
    await expect(status).toContainText('第 3–4 页');
    await expect(picker).toHaveValue('1');
    expect((await next.boundingBox()).x).toBeCloseTo(nextBox.x, 0);
    await settleBook(book);
    await book.locator('.tb-reader-body').focus();
    await page.keyboard.press('ArrowLeft');
    await expect(status).toContainText('第 1–2 页');

    const lastSpread = (await picker.locator('option').count()) - 1;
    await picker.selectOption(String(lastSpread));
    await expect(next).toContainText('下一课');
    await settleBook(book);
    await expect(book.locator('.tb-book-end')).toBeInViewport();
    await picker.selectOption('0');
    await expect(status).toContainText('第 1–2 页');
    await expect(previous).toContainText('上一课');

    // The page-turn outline opens from its summary at every viewport width.
    await page.locator('.tb-outline summary').click();
    await expect(page.locator('.tb-outline nav')).toBeVisible();
    // Outline links land on the spread that holds the section.
    const outlineLink = page.locator('.tb-outline a').filter({ hasText: '练习' });
    await outlineLink.click();
    await expect(outlineLink).toHaveAttribute('aria-current', 'location');
    await expect(status).toContainText('练习');

    for (let i = 0; i < 40 && !(await next.textContent()).includes('下一课'); i++) await next.click();
    await expect(next).toContainText('下一课');
    // Measure after the last turn has settled.
    await settleBook(book);
    const bodyBox = await book.locator('.tb-reader-body').boundingBox();
    const endBox = await book.locator('.tb-book-end').boundingBox();
    expect(endBox.x).toBeGreaterThanOrEqual(bodyBox.x - 1);
    expect(endBox.x).toBeLessThan(bodyBox.x + bodyBox.width);

    await next.click();
    await expect(page.locator('.tb-lesson-card[data-lesson-id="lesson_02"]')).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(status).toContainText('第 1–2 页');
    await previous.click();
    await expect(page.locator('.tb-lesson-card[data-lesson-id="lesson_01"]')).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(next).toContainText('下一课');

    await chooseReadingLayout(page, 'scroll');
    await expect(book).toHaveCount(0);
    await expect(page.locator('#tbReader > .tb-lesson-end')).toBeVisible();
    // The theme image belongs to the page-turn layout only.
    await expect(page.locator('#tbReader .tb-book-cover')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('jp_learning_reading_layout_v1'))).toBe('scroll');
    expect(errors).toEqual([]);
  });

  test('word audio stays on the spread and the vocabulary read-through turns to its word', async ({
    page,
  }) => {
    const errors = await openReadyApp(page, { module: 'lesson' });
    const requests = await mockCurriculumAudio(page);
    await openCurriculumLesson(page, 'KotobaFlow1', 'lesson_07');
    const book = page.locator('#tbReader .book-frame');
    const picker = book.locator('.book-page-select');
    const onSpread = (selector) =>
      book.locator('.book-body').evaluate((body, sel) => {
        const area = body.getBoundingClientRect();
        return Array.from(body.querySelectorAll(sel)).findIndex((el) => {
          const box = el.getBoundingClientRect();
          return box.width > 0 && box.left >= area.left - 1 && box.right <= area.right + 1;
        });
      }, selector);

    // A word in the running text: its popup plays the word without leaving the page.
    const wordIndex = await onSpread('.tb-inline-highlight-link');
    expect(wordIndex).toBeGreaterThanOrEqual(0);
    await picker.evaluate((select) => select.setAttribute('data-before', select.value));
    const before = await picker.inputValue();
    await book.locator('.tb-inline-highlight-link').nth(wordIndex).click();
    const panel = page.locator('#textbookDetailPanel');
    await panel.locator('.tb-vocab-audio-btn').click();
    await expect.poll(() => requests.some((url) => /\/\d{5}\.ogg$/.test(url))).toBe(true);
    await page.waitForTimeout(600);
    await expect(picker).toHaveValue(before);
    await expect(panel).toHaveClass(/anchored-detail-open/);
    await page.keyboard.press('Escape');

    // Starting the read-through from the last word turns to that word's spread and stays there.
    const lastRow = book.locator('.tb-reading-vocab-row[data-vocab-entry="1"]').last();
    await lastRow.locator('.tb-item-start-loop-btn').evaluate((button) => button.click());
    await expect(picker).not.toHaveValue(before);
    const turned = await picker.inputValue();
    const rowInView = () =>
      lastRow.evaluate((row) => {
        const area = row.closest('.book-body').getBoundingClientRect();
        const box = row.getBoundingClientRect();
        return box.left >= area.left - 1 && box.right <= area.right + 1;
      });
    expect(await rowInView()).toBe(true);
    await page.waitForTimeout(800);
    await expect(picker).toHaveValue(turned);
    expect(await rowInView()).toBe(true);
    await expect(lastRow).toHaveClass(/tb-item-loop-active/);
    expect(errors).toEqual([]);
  });

  test('page-turn reading keeps every kana cell reachable on some page', async ({ page }) => {
    const errors = await openReadyApp(page, { module: 'lesson' });
    await mockCurriculumAudio(page);
    await openCurriculumLesson(page, 'KotobaFlow1', 'lesson_00');
    const book = page.locator('#tbReader .book-frame');
    const next = book.locator('.book-turn[data-book-flip="next"]');
    const seen = new Set();
    for (let i = 0; i < 40; i++) {
      const visible = await book.evaluate((frame) => {
        const area = frame.querySelector('.tb-reader-body').getBoundingClientRect();
        return Array.from(frame.querySelectorAll('[data-kana-clip]'))
          .filter((button) => {
            const box = button.getBoundingClientRect();
            return (
              box.width > 0 &&
              box.left >= area.left - 1 &&
              box.right <= area.right + 1 &&
              box.top >= area.top - 1 &&
              box.bottom <= area.bottom + 1
            );
          })
          .map((button) => button.getAttribute('data-kana-clip') + '|' + button.textContent);
      });
      visible.forEach((id) => seen.add(id));
      if ((await next.textContent()).includes('下一课')) break;
      await next.click();
    }
    expect(seen.size).toBe(await page.locator('[data-kana-clip]').count());
    expect(errors).toEqual([]);
  });
});

test('KotobaFlow grammar points keep their headings, lists and example translations', async ({ page }) => {
  const errors = await openReadyApp(page, { module: 'lesson' });
  await mockCurriculumAudio(page);
  const lesson = source('KotobaFlow1').items.find((item) => item.meta.item_id === 'lesson_03').lesson;
  await openCurriculumLesson(page, 'KotobaFlow1', 'lesson_03');
  const section = page.locator('.tb-section-cgrammar');
  await expect(section.locator('.tb-cgrammar')).toHaveCount(lesson.grammar.items.length);
  const owner = section.locator('[data-grammar-uid="C03-G02"]');
  await expect(owner.locator('.tb-cgrammar-form')).toHaveText('NのN・だれのN');
  await expect(owner.locator('.tb-cgrammar-role')).toHaveText('产出');
  // 限定关系分项：①归属 ②时间 ③用途 ④所属类别 become a list with bold labels.
  await expect(owner.locator('.tb-cgrammar-points li')).toHaveCount(4);
  await expect(owner.locator('.tb-cgrammar-points strong').first()).toHaveText('归属');
  const examples = owner.locator('.tb-cgrammar-examples li');
  await expect(examples).toHaveCount(9);
  await expect(examples.first().locator('.tb-cgrammar-example-zh')).toHaveText('这把钥匙是朴的钥匙。');

  const toggle = page.locator('[data-translation-toggle]');
  await revealControl(toggle);
  await toggle.click();
  await expect(page.locator('.tb-cgrammar-example-zh')).toHaveCount(0);
  await expect(examples.first().locator('.tb-cgrammar-example-ja')).toContainText(
    'この鍵はパクさんの鍵です。',
  );

  // 【小节】 headings inside one explanation become their own subheadings.
  await openCurriculumLesson(page, 'KotobaFlow1', 'lesson_01');
  await expect(page.locator('[data-grammar-uid="C01-G01"] .tb-cgrammar-subhead')).toHaveCount(12);
  await expect(page.locator('[data-grammar-uid="C01-G01"] .tb-cgrammar-subhead').nth(1)).toHaveText(
    '五元音：あいうえお／アイウエオ',
  );
  expect(errors).toEqual([]);
});
