const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { processCorrections, manifestPath } = require('../tools/apply_learning_corrections.cjs');
const { openReadyApp, revealControl, selectTextbook } = require('./helpers');
test.use({ serviceWorkers: 'block' });

test('RES-CORR-01 reviewed teaching corrections are present in canonical resources', () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const result = processCorrections(process.cwd(), manifest);
  expect(result.corrections).toBeGreaterThan(0);
  expect(result.alreadyApplied + result.metadataSuperseded).toBe(result.corrections);
  expect(result.applied).toBe(0);
  expect(result.followups).toBeGreaterThan(0);
  expect(result.followupsAlreadyApplied).toBe(result.followups);
});

test('content closure preserves vocabulary IDs, contextual senses and matching enrichment', () => {
  const { rows } = buildTextbookVocabulary();
  const gdp = rows.find((row) => row.textbook_uid === 'tv-676a541cf78d');
  expect(gdp).toMatchObject({
    index: 1999,
    word: '国内総生産',
    reading_hiragana: 'こくないそうせいさん',
    meaning: '国内生产总值（GDP）',
    v4_enrichment: null,
    jitendex_overlay: null,
  });
  expect(gdp.synonyms_ja).toEqual(['GDP']);
  expect(gdp.example_sentence_ja).toContain('GDP(国内総生産)');
  expect(gdp.example_sentence_zh).toContain('GDP（国内生产总值）');
  const life = rows.find((row) => row.index === 674);
  expect(life.reading_hiragana).toBe('じっせいかつ');
  expect(life.v4_enrichment.reading_hiragana).toBe('じっせいかつ');
  expect(life.jitendex_overlay.reading).toBe('じっせいかつ');
  const nature = rows.find((row) => row.index === 4232);
  expect(nature.reading_hiragana).toBe('しぜん');
  expect(nature.meanings_zh).toEqual(['大自然', '自然而然地']);
  const proverb = rows.find((row) => row.index === 4965);
  expect(proverb.reading_hiragana).toBe('せんりのこうもそっかからはじまる');
  expect(proverb.v4_enrichment.reading_hiragana).toBe(proverb.reading_hiragana);
});

test('content closure keeps time readings distinct from sufficient and fixes 輪', () => {
  const { sentences } = JSON.parse(fs.readFileSync('data/textbook/textbook_text_tokens.v1.json'));
  const minutes = sentences.filter(
    (row) => row.book_id === 'XinBian2' && row.lesson_id === 'lesson_06' && /[七九]時十分/.test(row.text),
  );
  expect(minutes).toHaveLength(2);
  for (const sentence of minutes)
    expect(sentence.tokens.find((token) => token.surface === '十分').reading).toBe('ジュップン');
  const ring = sentences.find((row) => row.id === 'XinBian4::lesson_05::application::section_text::11');
  expect(ring.text).toContain('金の輪');
  expect(ring.tokens.find((token) => token.surface === '輪').reading).toBe('ワ');
  const generations = sentences.flatMap((row) => row.tokens).filter((token) => token.surface === '世々代々');
  expect(generations.map((token) => token.reading)).toEqual(['セゼダイダイ']);
  const script = sentences.find((row) => row.id === 'XinBian3::lesson_17::application::section_text::72');
  expect(script.text).toBe('リカ:どんなもんだい？');
  expect(script.tokens.map((token) => token.surface).join('')).toBe(script.text);
  expect(script.tokens.some((token) => token.surface === '問題')).toBe(false);
  const asking = sentences.filter((row) => row.book_id === 'XinBian4' && row.text.includes('聞くは一時'));
  expect(asking).toHaveLength(2);
  for (const sentence of asking)
    expect(sentence.tokens.find((token) => token.surface === '一時').reading).toBe('イットキ');
  const tastes = sentences.find((row) => row.id === 'XinBian4::lesson_04::body::section_text::7');
  expect(tastes.tokens.find((token) => token.surface === '甘').reading).toBe('カン');
  expect(tastes.tokens.find((token) => token.surface === '辛').reading).toBe('シン');
});

test('content closure shows the corrected GDP entry through real lesson controls', async ({ page }) => {
  const errors = await openReadyApp(page, { module: 'lesson' });
  await selectTextbook(page, 'XinBian2');
  const directory = page.locator('.tb-lesson-directory');
  await revealControl(directory.locator('summary'));
  if (!(await directory.evaluate((element) => element.open))) await directory.locator('summary').click();
  const lesson = page.locator('.tb-lesson-card[data-lesson-id="lesson_15"]');
  await revealControl(lesson);
  await lesson.click();
  const word = page.locator('.tb-reading-vocab-open').filter({ hasText: '国内総生産' });
  await expect(word).toContainText('国内生产总值');
  await revealControl(word);
  await word.click();
  const detail = page.locator('#textbookDetailPanel');
  await expect(detail.locator('h3')).toHaveText('国内総生産');
  await expect(detail).toContainText('こくないそうせいさん');
  await expect(detail).not.toContainText('GNP');
  await expect(detail).not.toContainText('国民生产总值');
  expect(errors).toEqual([]);
});

test('RES-CORR-01 stale identities and changed sources prevent the entire correction batch', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-content-corrections-'));
  try {
    fs.mkdirSync(path.join(root, 'data'));
    const filename = path.join(root, 'data/teaching.json');
    const original = JSON.stringify([
      { id: 'a', text: 'old' },
      { id: 'b', text: 'updated independently' },
    ]);
    fs.writeFileSync(filename, original);
    const correction = (id, index, before, after) => ({
      id,
      file: 'data/teaching.json',
      path: [index, 'text'],
      guards: [{ path: [index, 'id'], value: id }],
      before,
      after,
      reason: 'Reviewed language correction',
      evidence: ['Test fixture'],
    });
    const manifest = {
      schemaVersion: 1,
      corrections: [correction('a', 0, 'old', 'new'), correction('b', 1, 'old', 'new')],
    };
    expect(() => processCorrections(root, manifest, { apply: true })).toThrow(/source changed/);
    expect(fs.readFileSync(filename, 'utf8')).toBe(original);
    manifest.corrections[1].before = 'updated independently';
    manifest.corrections[1].guards[0].value = 'wrong identity';
    expect(() => processCorrections(root, manifest, { apply: true })).toThrow(/identity changed/);
    expect(fs.readFileSync(filename, 'utf8')).toBe(original);
    manifest.corrections[1].guards[0].value = 'b';
    expect(() => processCorrections(root, manifest)).toThrow(/reviewed corrections missing/);
    expect(fs.readFileSync(filename, 'utf8')).toBe(original);
    expect(processCorrections(root, manifest, { apply: true }).applied).toBe(2);
    expect(processCorrections(root, manifest, { apply: true }).applied).toBe(0);
    expect(processCorrections(root, manifest).alreadyApplied).toBe(2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function loader() {
  const context = {};
  vm.runInNewContext(fs.readFileSync('js/core/lexical-metadata.js', 'utf8'), context);
  vm.runInNewContext(fs.readFileSync('js/textbook-loader.js', 'utf8'), context);
  return context.TextbookLoader;
}

function buildTextbookVocabulary() {
  const api = loader();
  const dir = 'data/textbook/canonical_textbook_vocab/';
  const read = (name) => JSON.parse(fs.readFileSync(dir + name));
  const bundles = Object.fromEntries(
    ['XinBian1', 'XinBian2', 'XinBian3', 'XinBian4'].map((book) => [
      book,
      JSON.parse(fs.readFileSync(`data/textbook/canonical_books/${book}.bundle.json`)),
    ]),
  );
  const rows = api.build.mergeVocabulary(
    read('textbook_vocab_full.v3.json'),
    read('textbook_vocab_full.v4.enrichment.json'),
    read('jitendex_overlay/jitendex_textbook_vocab_overlay.json').entries,
    api.build.sourceVocabulary(bundles),
  );
  return { api, bundles, rows };
}

test('FIX-01 textbook identity rejects collisions, ambiguous senses, and missing source links', () => {
  const main = [
    { index: 107, source_index: 107, word: 'あべこべ', reading_hiragana: 'あべこべ' },
    { index: 11066, source_index: 11027, word: 'そこ', reading_hiragana: 'そこ' },
    { index: 201, source_index: 200, word: '生', reading_hiragana: 'せい' },
    { index: 202, source_index: 200, word: '生', reading_hiragana: 'なま' },
    { index: 203, source_index: 203, word: '橋', reading_hiragana: 'はし' },
    { index: 204, source_index: 204, word: '橋', reading_hiragana: 'はし' },
  ];
  const rows = [
    { index: 107, base_source_index: 11027, word: 'そこ', reading_hiragana: 'そこ' },
    { index: 201, base_source_index: 200, word: '生', reading_hiragana: 'ナマ' },
    { word: '橋', reading_hiragana: 'はし' },
    { word: '箸', reading_hiragana: 'はし' },
    { word: 'そこ', reading_hiragana: 'そこ', base_source_index: 999 },
    { word: 'そこ', reading_hiragana: '' },
  ];
  expect(
    loader()
      .resolveStudyVocabulary(rows, main)
      .map((word) => word?.index ?? null),
  ).toEqual([11066, 202, null, null, null, null]);
});

test('FIX-01 every generated course queue preserves verified surface, reading, and source identity', () => {
  const main = JSON.parse(fs.readFileSync('data/taxonomy_annotations_gemini_3_flash_enriched.json'));
  const api = loader();
  let linked = 0;
  for (const book of ['XinBian1', 'XinBian2', 'XinBian3', 'XinBian4']) {
    const catalog = JSON.parse(fs.readFileSync(`data/textbook/book_chunks/${book}.json`));
    for (const file of Object.values(catalog.vocabulary)) {
      const rows = JSON.parse(fs.readFileSync(`data/textbook/book_chunks/${file}`));
      api.resolveStudyVocabulary(rows, main).forEach((word, i) => {
        if (!word) return;
        linked++;
        const row = rows[i];
        if (row.base_source_index != null) expect(word.source_index).toBe(row.base_source_index);
        expect(
          word.word
            .normalize('NFKC')
            .split(/[\/·]/)
            .some((surface) => row.word.normalize('NFKC').split(/[\/·]/).includes(surface)),
        ).toBe(true);
        const kana = (value) =>
          value.normalize('NFKC').replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
        expect(kana(word.reading_hiragana)).toBe(kana(row.reading_hiragana));
      });
    }
  }
  expect(linked).toBeGreaterThan(1500);
});

for (const width of [1600, 1280]) {
  test(`FIX-01 real lesson review asks its own words without changing a colliding ID (${width})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 1600 ? 900 : 720 });
    await page.route('**/js/storage-config.js*', (route) =>
      route.fulfill({
        contentType: 'application/javascript',
        body: "window.JPLearnStorageConfig = { mode: 'browser' };",
      }),
    );
    await openReadyApp(page, { module: 'lesson' });
    await expect(page.locator('.tb-reading-vocab-open').first()).toContainText('そこ');
    await page.evaluate(() => StudyStorage.markWord(107, 'unknown'));
    await revealControl(page.locator('.tb-course-path-toggle'));
    await page.locator('.tb-course-path-toggle').click();
    await page.locator('.tb-course-other-toggle').click();
    await page.locator('[data-course-action="step"][data-course-step="review"]').click();
    await expect(page.locator('.practice-card')).toBeVisible();
    expect(await page.evaluate(() => appConfig.studyMode.queue.map((w) => w.word))).toEqual([
      'そこ',
      'アクセント',
      'インク',
      'クラス',
      'タオル',
    ]);
    expect(await page.evaluate(() => appConfig.studyMode.currentExercise.answer)).toBe('そこ');
    const correct = await page.evaluate(() =>
      appConfig.studyMode.currentExercise.options.findIndex((o) => o.correct),
    );
    await revealControl(page.locator('.practice-option').nth(correct));
    await page.locator('.practice-option').nth(correct).click();
    await page.locator('#btnPracticeNext').click();
    expect(
      await page.evaluate(() => [
        StudyStorage.getWordStatus(107).status,
        StudyStorage.getWordStatus(11066).status,
      ]),
    ).toEqual(['unknown', 'known']);
    await page.screenshot({ path: `local/qa/fix-learning-2026-09-21/course-${width}.png` });
  });
}

test('FIX-02 merged vocabulary preserves textbook meanings across homonyms and parenthetical forms', () => {
  const { api, rows: rebuilt } = buildTextbookVocabulary();
  const stake = rebuilt.find((r) => r.textbook_uid === 'tv-33112a687876');
  expect(stake).toMatchObject({
    word: '杭',
    meaning: '桩子',
    reading_hiragana: 'くい',
    base_source_index: null,
    v4_enrichment: null,
    jitendex_overlay: null,
  });
  expect(stake.association_review.candidate.word).toBe('悔い');
  expect(stake.audio_provenance).toMatchObject({ index: 777, synthesis_text: 'くい' });
  const variant = rebuilt.find((r) => r.source_word === '暫く');
  expect(variant.word).toBe('しばらく');
  expect(variant.association_review.status).toBe('verified');
  const homonym = rebuilt.find((r) => r.source_word === '一階');
  expect(homonym.word).toBe('一階');
  expect(homonym.association_review).toMatchObject({ status: 'pending', candidate: { word: '一回' } });
  expect(homonym.v4_enrichment).toBeNull();
  expect(homonym.jitendex_overlay).toBeNull();

  const merit = rebuilt.find((r) => r.textbook_uid === 'tv-d8c3993638b7');
  expect(merit).toMatchObject({
    word: '功',
    reading_hiragana: 'こう',
    meaning: 'merit',
    base_source_index: null,
  });
  expect(merit.association_review).toMatchObject({
    status: 'pending',
    candidate: { word: '~港' },
    original_entries: [{ word: '功', reading: 'こう', meaning: 'merit' }],
  });
  expect(merit.v4_enrichment).toBeNull();
  expect(merit.jitendex_overlay).toBeNull();

  const irritation = rebuilt.find((r) => r.textbook_uid === 'tv-a939f22a23cf');
  expect(irritation).toMatchObject({
    word: 'いらいら',
    reading_hiragana: 'いらいら',
    meaning: '焦急',
    match_status: 'linked_existing_exact',
  });
  expect(irritation.association_review).toBeUndefined();
  expect(irritation.v4_enrichment).not.toBeNull();
  const mainWords = JSON.parse(fs.readFileSync('data/taxonomy_annotations_gemini_3_flash_enriched.json'));
  expect(api.resolveStudyVocabulary([irritation], mainWords)[0]?.word).toBe('いらいら');

  const stylish = rebuilt.find((r) => r.textbook_uid === 'tv-a5385bf10988');
  expect(stylish).toMatchObject({
    word: 'おしゃれ',
    reading_hiragana: 'おしゃれ',
    meaning: '好打扮、爱漂亮',
  });
  expect(stylish.association_review.original_entries).toMatchObject([
    { word: 'おしゃれ(お洒落)', reading: 'おしゃれ', meaning: '好打扮、爱漂亮' },
  ]);
  expect(stylish.v4_enrichment).toBeNull();

  const flatly = rebuilt.find((r) => r.textbook_uid === 'tv-a9e49918285b');
  expect(flatly).toMatchObject({
    word: 'ぺたんと',
    reading_hiragana: 'ぺたんと',
    meaning: '扑通地',
    grammar: '副',
  });
  expect(flatly.v4_enrichment).toBeNull();
  expect(flatly.jitendex_overlay).toBeNull();

  const genre = rebuilt.find((r) => r.textbook_uid === 'tv-a5b93e7eebd2');
  expect(genre).toMatchObject({
    word: 'ジャンル',
    reading_hiragana: 'じゃんる',
    meaning: '类型、形式、体裁',
  });
  expect(genre.association_review.status).toBe('pending');

  for (const entry of [
    {
      uid: 'tv-64260ea578af',
      word: 'デザイナー',
      reading: 'でざいなー',
      meaning: '服装设计师',
      grammar: '名',
    },
    {
      uid: 'tv-9598018d80b1',
      word: 'バケツ',
      reading: 'ばけつ',
      meaning: '塑料桶、水桶',
      grammar: '名',
    },
    {
      uid: 'tv-367522b6c940',
      word: 'ビニール',
      reading: 'びにーる',
      meaning: '塑料薄膜、乙烯基',
      grammar: '名',
    },
  ]) {
    const sourceWithoutReading = rebuilt.find((r) => r.textbook_uid === entry.uid);
    expect(sourceWithoutReading).toMatchObject({
      word: entry.word,
      reading_hiragana: entry.reading,
      meaning: entry.meaning,
      grammar: entry.grammar,
      base_source_index: null,
      match_status: 'needs_review',
      association_review: {
        status: 'pending',
        original_entries: [{ word: entry.word, reading: '', meaning: entry.meaning }],
      },
      v4_enrichment: null,
      jitendex_overlay: null,
    });
  }
});

test('FIX-02 generated lesson vocabulary chunks match the canonical merge', () => {
  const { api, bundles, rows: rebuilt } = buildTextbookVocabulary();
  for (const book of Object.keys(bundles)) {
    const catalog = JSON.parse(fs.readFileSync(`data/textbook/book_chunks/${book}.json`));
    for (const [id, file] of Object.entries(catalog.vocabulary)) {
      const actual = JSON.parse(fs.readFileSync(`data/textbook/book_chunks/${file}`));
      const expected = rebuilt.filter((row) => api.build.matchesLesson(row, book, id));
      expect(actual.map((r) => r.textbook_uid).sort()).toEqual(expected.map((r) => r.textbook_uid).sort());
      for (const row of actual)
        expect(row).toEqual(expected.find((r) => r.textbook_uid === row.textbook_uid));
    }
  }
});

test('FIX-02 lesson list, highlight, detail and audio keep 杭 separate from 悔い', async ({ page }) => {
  await openReadyApp(page, { module: 'lesson' });
  const entry = page.getByRole('button', { name: '查看词汇详情：杭', exact: true });
  await expect(entry).toContainText('桩子');
  await entry.click();
  const detail = page.locator('#textbookDetailPanel');
  await expect(detail.locator('h3')).toHaveText('杭');
  await expect(detail).toContainText('桩子');
  await expect(detail).not.toContainText('悔恨');
  const audio = page.waitForRequest(/vocab6127.*00777\.ogg/);
  await detail.locator('.tb-vocab-audio-btn').click();
  await audio;
  const highlighted = await page.evaluate(() => {
    const module = ModuleSwitcher.getTextbookModule();
    return { html: module._highlightText('杭', 'clickable'), targets: module._buildVocabTargetMap() };
  });
  // Single-character words intentionally stay unhighlighted; their detail target is still exact.
  expect(highlighted.html).toBe('杭');
  expect(highlighted.targets['杭'].word).toBe('杭');
  expect(highlighted.targets['悔い']).toBeUndefined();
  await page.screenshot({ path: 'local/qa/fix-learning-2026-09-21/stake-detail.png' });
});
