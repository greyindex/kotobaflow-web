const { test, expect } = require('@playwright/test');
const { chooseReadingLayout, openReadyApp, revealControl, selectTextbook } = require('./helpers');

test('a real reviewed noun-する word is returned by the verb filter without altering its fields', async ({
  page,
}) => {
  await openReadyApp(page);
  const target = await page.evaluate(() => {
    const api = window.JPLearn.lexicalMetadata;
    const row = window.taxonomyManager.allWords.find(
      (word) => api.primary(word.pos) === 'noun' && api.hasClass(word.pos, 'verb') && api.reviewMatches(word),
    );
    if (!row) return null;
    const fields = JSON.stringify({
      pos: row.pos,
      transitivity: row.transitivity,
      register: row.register,
      style: row.style,
    });
    window.filterManager.populateOptions();
    return { index: row.index, word: row.word, fields };
  });
  expect(target, 'expected a real reviewed noun-する word in the migrated vocabulary').toBeTruthy();

  await revealControl(page.locator('#searchInput'));
  await page.locator('#searchInput').fill(target.word);
  await page.locator('#searchInput').press('Enter');
  await revealControl(page.locator('#posSelect'));
  await page.locator('#posSelect').selectOption('verb');
  await expect(page.locator(`.cc-card-body[data-detail="${target.index}"]`)).toBeVisible();
  await expect(page.locator('#posSelect option[value="verb"]')).toBeAttached();
  expect(
    await page.evaluate(
      (index) =>
        JSON.stringify({
          pos: window.taxonomyManager.allWords.find((word) => word.index === index).pos,
          transitivity: window.taxonomyManager.allWords.find((word) => word.index === index).transitivity,
          register: window.taxonomyManager.allWords.find((word) => word.index === index).register,
          style: window.taxonomyManager.allWords.find((word) => word.index === index).style,
        }),
      target.index,
    ),
  ).toBe(target.fields);
});

test('the main vocabulary detail renders all four structured metadata fields as Chinese labels', async ({
  page,
}) => {
  await openReadyApp(page);
  const target = await page.evaluate(() => {
    const api = window.JPLearn.lexicalMetadata;
    const row = window.taxonomyManager.allWords.find((word) => {
      const fields = {
        pos: word.pos,
        transitivity: word.transitivity,
        register: word.register,
        style: word.style,
      };
      try {
        return api.validate(fields) && api.reviewMatches(word);
      } catch (_) {
        return false;
      }
    });
    if (!row) return null;
    return {
      index: row.index,
      word: row.word,
      labels: {
        pos: api.posLabel(row.pos, 'zh'),
        transitivity: api.transitivityLabel(row.transitivity, 'zh'),
        register: api.registerLabel(row.register, 'zh'),
        style: api.styleLabel(row.style, 'zh'),
      },
    };
  });
  expect(
    target,
    'expected an actual reviewed main-vocabulary row with all four metadata objects',
  ).toBeTruthy();

  await revealControl(page.locator('#searchInput'));
  await page.locator('#searchInput').fill(target.word);
  await page.locator('#searchInput').press('Enter');
  const card = page.locator(`.cc-card-body[data-detail="${target.index}"]`);
  await expect(card).toBeVisible();
  const drawerBackdrop = page.locator('#narrowGlobalSidebarBackdrop');
  if (await drawerBackdrop.isVisible()) await drawerBackdrop.click();
  await card.click();

  const info = page.locator('#detailContent .vocab-detail-info-grid');
  await expect(info).toContainText('词性');
  await expect(info).toContainText('语体');
  await expect(info).toContainText('自他动');
  await expect(info).toContainText('媒介 / 体裁');
  for (const label of Object.values(target.labels)) {
    if (label) await expect(info).toContainText(label);
  }
  await expect(info).not.toContainText('[object Object]');
  await expect(info).not.toContainText(/\b(high|mid|low)\b/);
});

test('a real noun-する card shows Chinese primary and secondary POS labels', async ({ page }) => {
  await openReadyApp(page);
  const target = await page.evaluate(() => {
    const api = window.JPLearn.lexicalMetadata;
    const word = window.taxonomyManager.allWords.find(
      (item) => api.primary(item.pos) === 'noun' && api.hasClass(item.pos, 'verb') && api.reviewMatches(item),
    );
    return word ? { index: word.index, word: word.word } : null;
  });
  expect(target, 'expected a real reviewed noun-する word in the migrated vocabulary').toBeTruthy();

  await revealControl(page.locator('#searchInput'));
  await page.locator('#searchInput').fill(target.word);
  await page.locator('#searchInput').press('Enter');
  const card = page.locator(`.cc-card[data-index="${target.index}"]`);
  await expect(card.locator('.cc-card-body .cc-pos-badge')).toContainText('名词');
  await revealControl(card.locator('.cc-meta-count'));
  await card.locator('.cc-meta-count').click();
  const extra = card.locator('.cc-card-extra');
  await expect(extra.locator('.cc-xlabel').filter({ hasText: '兼类' })).toBeVisible();
  await expect(extra).toContainText('动词');
  await expect(card).not.toContainText('[object Object]');
});

test('KotobaFlow displays the reviewed metadata for real corrected vocabulary rows', async ({ page }) => {
  await openReadyApp(page, { module: 'lesson' });

  const targets = [
    { book: 'KotobaFlow1', lesson: 'lesson_09', word: 'タクシー' },
    { book: 'KotobaFlow2', lesson: 'lesson_07', word: 'やさしい' },
    { book: 'KotobaFlow2', lesson: 'lesson_07', word: '泊める', index: 1446 },
    { book: 'KotobaFlow4', lesson: 'lesson_16', word: '可哀相' },
  ];

  for (const target of targets) {
    await selectTextbook(page, target.book);
    const lessonCard = page.locator(`.tb-lesson-card[data-lesson-id="${target.lesson}"]`);
    await revealControl(lessonCard);
    await lessonCard.click();

    const metadata = await page.evaluate(async ({ book, lesson, word }) => {
      const row = (await TextbookLoader.getLessonVocab(book, lesson)).find((item) => item.word === word);
      if (!row) throw new Error(`Missing real KotobaFlow row: ${book}/${lesson}/${word}`);
      const api = window.JPLearn.lexicalMetadata;
      const fields = {
        pos: row.pos,
        transitivity: row.transitivity,
        register: row.register,
        style: row.style,
      };
      let valid = false;
      try {
        valid = api.validate(fields);
      } catch (_) {
        // Surface missing migration fields through a normal test assertion.
      }
      return {
        index: row.index,
        fields,
        valid,
        reviewMatches: api.reviewMatches(row),
        labels: {
          pos: api.posLabel(row.pos, 'zh'),
          conjugation: api.conjugationLabel(row.pos, 'zh'),
          transitivity: api.transitivityLabel(row.transitivity, 'zh'),
          register: api.registerLabel(row.register, 'zh'),
          style: api.styleLabel(row.style, 'zh'),
          transitivityApplicable: row.transitivity.value !== 'not_applicable',
        },
      };
    }, target);
    expect(metadata.valid, `${target.book}/${target.lesson}/${target.word} must have v2 fields`).toBe(true);
    expect(
      metadata.reviewMatches,
      `${target.book}/${target.lesson}/${target.word} needs matching review identity`,
    ).toBe(true);
    if (target.index) expect(metadata.index).toBe(target.index);

    await chooseReadingLayout(page, 'scroll');
    const wordButton = page.locator('.tb-reading-vocab-open').filter({ hasText: target.word }).first();
    await revealControl(wordButton);
    const compactLine = wordButton.locator('.tb-reading-vocab-sub');
    await expect(compactLine).not.toContainText(metadata.labels.pos);
    await expect(compactLine).not.toContainText(metadata.labels.register);
    await wordButton.click();
    const panel = page.locator('#textbookDetailPanel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(target.word);
    await expect(panel).toContainText('词性');
    await expect(panel).toContainText('语体');
    await expect(panel).toContainText(metadata.labels.pos);
    await expect(panel).toContainText(metadata.labels.register);
    await expect(panel).toContainText('用法倾向');
    await expect(panel).toContainText(metadata.labels.style);
    if (metadata.labels.conjugation && !['不适用', '未确定'].includes(metadata.labels.conjugation)) {
      await expect(panel).toContainText('活用');
      await expect(panel).toContainText(metadata.labels.conjugation);
    } else {
      await expect(panel).not.toContainText('活用');
    }
    if (metadata.labels.transitivityApplicable) {
      await expect(panel).toContainText('自他');
      await expect(panel).toContainText(metadata.labels.transitivity);
    } else {
      await expect(panel).not.toContainText('自他');
    }
    await expect(panel).not.toContainText('[object Object]');
    await page.keyboard.press('Escape');
  }
});

test('XinBian 引っ越す renders v4 conjugation and transitivity from the reviewed fields', async ({
  page,
}) => {
  await openReadyApp(page, { module: 'lesson' });
  await selectTextbook(page, 'XinBian4');
  const lessonCard = page.locator('.tb-lesson-card[data-lesson-id="lesson_08"]');
  await revealControl(lessonCard);
  await lessonCard.click();

  const row = await page.evaluate(async () =>
    (await TextbookLoader.getLessonVocab('XinBian4', 'lesson_08')).find((item) => item.word === '引っ越す'),
  );
  expect(row, 'the real XinBian lesson row must be present').toBeTruthy();
  expect(row.v4_enrichment).toBeTruthy();
  expect(row.v4_enrichment.pos).toBeTruthy();
  expect(row.v4_enrichment.transitivity).toBeTruthy();

  const wordButton = page.locator('.tb-reading-vocab-open').filter({ hasText: '引っ越す' }).first();
  await revealControl(wordButton);
  await wordButton.click();
  const panel = page.locator('#textbookDetailPanel');
  await expect(panel).toContainText('五段');
  await expect(panel).toContainText('自动');
  await expect(panel).not.toContainText('[object Object]');
});

test('pending textbook associations stay outside the practice vocabulary after metadata is added', async ({
  page,
}) => {
  await openReadyApp(page, { module: 'lesson' });
  await selectTextbook(page, 'KotobaFlow4');
  const lessonCard = page.locator('.tb-lesson-card[data-lesson-id="lesson_16"]');
  await revealControl(lessonCard);
  await lessonCard.click();

  const result = await page.evaluate(async () => {
    const rows = await TextbookLoader.getLessonVocab('KotobaFlow4', 'lesson_16');
    const source = rows.find((row) => row.index === 6161 && row.word === '可哀相');
    if (!source) throw new Error('Missing real KotobaFlow4/lesson_16 可哀相 row');
    const pending = {
      ...source,
      association_review: { status: 'pending', reason: 'QA fixture: association remains unresolved' },
      pos: {
        primary: 'adjective_na',
        classes: ['adjective_na'],
        subtypes: [],
        conjugation: 'not_applicable',
      },
      transitivity: { value: 'not_applicable', scope: 'not_applicable' },
      register: { formality: 'neutral', politeness: [], usage: [] },
      style: { medium: 'general', genres: [] },
      lexical_review: {
        schemaVersion: 2,
        status: 'reviewed',
        confidence: 'high',
        basis: ['dictionary'],
        note_zh: 'QA fixture with the source row identity.',
        dictionary_sequences: [12345],
        identity: { word: source.word, reading_hiragana: source.reading_hiragana, meaning: source.meaning },
      },
    };
    const study = TextbookLoader.resolveStudyVocabulary([pending], window.taxonomyManager.allWords);
    return { pending: pending.index, study };
  });

  expect(result.study).toEqual([null]);
});
