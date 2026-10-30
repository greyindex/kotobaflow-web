// CLASSICS-01: the Japanese classics library, a fifth module (古典) in
// copies that have it. Its data is built into the ignored data/classics_v1
// folder, so every test serves a small two-work library: 竹取物語 with a
// narration made of silent Ogg/Opus, and 源氏物語 without one.
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { publicContentConfig } = require('../tools/build_public_release.cjs');
const {
  DEFAULT_LAYOUT_STORAGE,
  chooseReadingLayout,
  expectOnlyModuleVisible,
  expectSidebarAboveLoading,
  openSidebar,
  openReadyApp,
  revealControl,
  settleBook,
} = require('./helpers');
const { silentOgg } = require('./audio-fixtures');

test.use({ serviceWorkers: 'block', storageState: DEFAULT_LAYOUT_STORAGE });

const STORE_KEY = 'jp_learning_classics_v1';
const sentences = (count, text) =>
  Array.from({ length: count }, (_, i) => text.replace('N', String(i + 1))).join('');
const UNITS = {
  'TK-001': {
    original: '今は昔竹取の翁といふものありけり。',
    modern:
      '今は昔、竹取の翁という人がいた。' + sentences(40, '翁は野山に入ってN本目の竹を取り、家に持ち帰った。'),
    zh: '很久以前，有个叫竹取翁的人。' + sentences(40, '翁走进山野取了第N根竹子，带回家中。'),
    notes: ['「竹取の翁」按原文保留称呼。'],
  },
  'TK-002': {
    original: 'この子いと大きになりぬれば、名を三室戸齋部秋田を呼びてつけさす。',
    modern: sentences(30, '子どもはN日ごとに大きくなっていった。'),
    zh: sentences(30, '孩子每过N天就长大一些。'),
  },
  'TK-003': {
    original: '世界の男あてなるもいやしきも、いかでこのかぐや姫を得てしがな。',
    modern: '世の男たちは、身分の高い者も低い者も、かぐや姫を妻にしたいと思った。噂を聞いて心を乱した。',
    zh: '世间男子，不论身份高低，都想娶辉夜姬为妻。',
  },
  'GE-001': {
    original: 'いつれの御時にか女御更衣あまたさふらひ給けるなかに',
    modern: 'どの帝の御代であったか、女御や更衣が大勢お仕えしている中に、ひときわ寵愛を受ける方がいた。',
    zh: '不知是哪一朝的帝王在位时，宫中有许多女御和更衣侍奉。',
  },
  'GE-002': {
    original: 'この君の御童姿いとかへまうくおほせど',
    modern: '帝はこの君の童姿を変えるのを惜しまれた。',
    zh: '帝王舍不得改变这位公子的童子装束。',
  },
};
const unit = (id) => Object.assign({ id }, UNITS[id]);
const chars = (ids) => ids.reduce((sum, id) => sum + Array.from(UNITS[id].modern).length, 0);
const length = (id) => Array.from(UNITS[id].modern).length;

const SOURCE = {
  edition: '國民文庫本（测试）',
  license: '公有领域（测试）',
  status: '试译初稿',
  quality: '测试数据',
  url: 'https://ja.wikisource.org/wiki/example',
};
const LIBRARY = {
  'catalog.json': {
    schema: 1,
    books: [
      { id: 'taketori', title: '竹取物语', titleJa: '竹取物語', noun: '节', parts: 2, units: 3, audio: true },
      { id: 'genji', title: '源氏物语', titleJa: '源氏物語', noun: '帖', parts: 2, units: 2, audio: false },
    ],
  },
  'taketori/index.json': {
    schema: 1,
    id: 'taketori',
    title: '竹取物语',
    titleJa: '竹取物語',
    noun: '节',
    units: 3,
    source: SOURCE,
    parts: [
      {
        n: 1,
        file: '01.json',
        label: '第一节',
        title: 'かぐや姫の生い立ち',
        units: 2,
        chars: chars(['TK-001', 'TK-002']),
        audioStart: 0,
        audioEnd: 200,
      },
      {
        n: 2,
        file: '02.json',
        label: '第二节',
        title: '貴公子たちの求婚',
        units: 1,
        chars: chars(['TK-003']),
        audioStart: 200,
        audioEnd: 240,
      },
    ],
    audio: {
      file: 'audio.ogg',
      duration: 240,
      model: 'fixture',
      chunks: [
        { start: 0, end: 150, spans: [['TK-001', 0, length('TK-001')]] },
        { start: 150, end: 200, spans: [['TK-002', 0, length('TK-002')]] },
        { start: 200, end: 240, spans: [['TK-003', 0, length('TK-003')]] },
      ],
    },
  },
  'taketori/01.json': { schema: 1, book: 'taketori', part: 1, units: [unit('TK-001'), unit('TK-002')] },
  'taketori/02.json': { schema: 1, book: 'taketori', part: 2, units: [unit('TK-003')] },
  'genji/index.json': {
    schema: 1,
    id: 'genji',
    title: '源氏物语',
    titleJa: '源氏物語',
    noun: '帖',
    units: 2,
    source: SOURCE,
    parts: [
      { n: 1, file: '01.json', label: '第一帖', title: '桐壺', units: 1, chars: chars(['GE-001']) },
      { n: 2, file: '02.json', label: '第二帖', title: '帚木', units: 1, chars: chars(['GE-002']) },
    ],
  },
  'genji/01.json': { schema: 1, book: 'genji', part: 1, units: [unit('GE-001')] },
  'genji/02.json': { schema: 1, book: 'genji', part: 2, units: [unit('GE-002')] },
};
const NARRATION = silentOgg(240);
const PUBLIC_AUDIO = 'a'.repeat(64) + '.mp3';

async function serveLibrary(page, publicAudio = false) {
  await page.route('**/data/classics_v1/**', (route) => {
    const file = new URL(route.request().url()).pathname.replace(/^.*\/data\/classics_v1\//, '');
    if (file === 'taketori/audio.ogg') return route.fulfill({ contentType: 'audio/ogg', body: NARRATION });
    if (LIBRARY[file]) {
      const data =
        publicAudio && file === 'taketori/index.json'
          ? { ...LIBRARY[file], audio: { ...LIBRARY[file].audio, file: PUBLIC_AUDIO } }
          : LIBRARY[file];
      return route.fulfill({ json: data });
    }
    return route.fulfill({ status: 404, body: '' });
  });
}

test('public classics plays R2 audio, seeks across parts and restores after reload', async ({ page }) => {
  await serveLibrary(page, true);
  const source = fs.readFileSync(path.join(__dirname, '../js/content-config.js'), 'utf8');
  await page.route('**/js/content-config.js*', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: publicContentConfig(source) }),
  );
  const audioUrl = 'https://audio.kotobaflow.lol/classics/v1/taketori/' + PUBLIC_AUDIO;
  await page.route(audioUrl, (route) => route.fulfill({ contentType: 'audio/ogg', body: NARRATION }));
  const errors = await openReadyApp(page, { module: 'classics', classics: true });
  const play = reader(page).locator('.cl-audio-play');
  await play.click();
  await expect(play).toHaveAttribute('aria-label', '暂停朗读');
  expect(await classics(page, () => ModuleSwitcher.getClassicsModule().reader.audio.src)).toBe(audioUrl);
  await reader(page).locator('.cl-audio-seek').fill('200');
  await expect(heading(page)).toContainText('貴公子たちの求婚');
  await page.locator('#modBtnVocab').click();
  await expect.poll(async () => (await saved(page))?.books.taketori?.time).toBeGreaterThanOrEqual(200);
  await page.locator('#modBtnClassics').click();
  await expect(play).toHaveAttribute('aria-label', '继续朗读');
  await page.reload();
  await waitForApp(page);
  await expect(heading(page)).toContainText('貴公子たちの求婚');
  await expect(play).toHaveAttribute('aria-label', '继续朗读');
  await expect
    .poll(() => classics(page, () => ModuleSwitcher.getClassicsModule().reader.audio.currentTime))
    .toBeGreaterThanOrEqual(200);
  expect(
    await page.evaluate(() => [
      JPLearn.classics.audioUrl({ id: 'taketori', audio: { file: 'audio.mp3' } }),
      JPLearn.classics.audioUrl({ id: '../private', audio: { file: 'a'.repeat(64) + '.mp3' } }),
    ]),
  ).toEqual(['', '']);
  expect(errors).toEqual([]);
});

const reader = (page) => page.locator('#clReader');
const heading = (page) => page.locator('#clPartHeading .page-heading-title');
const works = (page) => page.locator('#clSidebarContent .cl-work');
const classics = (page, read) => page.evaluate(read);
const pagerPage = (page) => classics(page, () => ModuleSwitcher.getClassicsModule().reader.pager.page);
const saved = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), STORE_KEY);

async function openClassics(page) {
  await page.locator('#modBtnClassics').click();
  await expect(reader(page).locator('.cl-body .cl-unit').first()).toBeVisible();
}

async function waitForApp(page) {
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 45_000 });
}

test('古典 is the last rail module and its drawer lists the works', async ({ page }) => {
  await serveLibrary(page);
  const errors = await openReadyApp(page, { module: 'grammar', classics: true });
  const buttons = page.locator('#moduleSwitcher .mod-btn');
  await expect(buttons).toHaveCount(5);
  await expect(buttons.last()).toHaveAttribute('id', 'modBtnClassics');
  await expect(buttons.last()).toHaveText('古典');

  await openClassics(page);
  await expect(page).toHaveURL(/\/#classics$/);
  await expect(page).toHaveTitle('日本古典 · 词基流动');
  await expect(page.locator('#appHeaderLocation')).toHaveText('古典阅读');
  await expect(buttons.last()).toHaveAttribute('aria-current', 'page');
  await expectOnlyModuleVisible(page, 'classics');

  // The first work opens in page-turn layout with the classical original hidden.
  await expect(reader(page).locator('.book-frame')).toBeVisible();
  await expect(heading(page)).toContainText('かぐや姫の生い立ち');
  await expect(reader(page).locator('.cl-opening-name')).toHaveCSS('writing-mode', 'vertical-rl');
  await expect(reader(page).locator('.cl-modern').first()).toBeVisible();
  await expect(reader(page).locator('.cl-zh').first()).toBeVisible();
  await expect(reader(page).locator('.cl-original').first()).toBeHidden();
  await expect(reader(page).locator('.cl-notes')).toBeHidden();
  // UI-ART-27: the modern text, sentence spans included, is set in the Japanese gothic face.
  for (const text of [
    reader(page).locator('.cl-modern').first(),
    reader(page).locator('.cl-modern .cl-s').first(),
  ])
    await expect(text).toHaveCSS('font-family', /^"JPLearn Gothic", "Yu Gothic"/);

  // Drawer: five modules in one row, then the works with the open one marked.
  await page.locator('#statusBarShowBtn').click();
  const tops = await buttons.evaluateAll((items) =>
    items.map((b) => Math.round(b.getBoundingClientRect().top)),
  );
  expect(new Set(tops).size).toBe(1);
  await expect(works(page)).toHaveCount(2);
  await expect(works(page).nth(0)).toHaveAttribute('aria-current', 'page');
  await expect(works(page).nth(0).locator('.cl-work-title')).toHaveText('竹取物语');
  await expect(works(page).nth(0).locator('.cl-work-audio')).toHaveText('朗读');
  await expect(works(page).nth(1).locator('.cl-work-audio')).toHaveCount(0);
  await expect(works(page).nth(1).locator('.cl-work-meta')).toHaveText('2 帖 · 2 段');
  await expect(page.locator('#classicsWorkCountBadge')).toHaveText('2 部');

  // Choosing a work keeps the drawer open and focus on that work.
  await works(page).nth(1).click();
  await expect(heading(page)).toContainText('桐壺');
  await expect(works(page).nth(1)).toHaveAttribute('aria-current', 'page');
  await expect(works(page).nth(1)).toBeFocused();
  await expect(works(page).nth(0).locator('.cl-work-meta')).toHaveText('2 节 · 读到第 1 节');
  await expect(reader(page).locator('.cl-audio')).toHaveCount(0);
  await expect(page.locator('#statusClassicsBook')).toHaveText('源氏物语');
  await expect(page.locator('#statusClassicsPart')).toHaveText('第一帖 桐壺');
  await page.keyboard.press('Escape');

  // The heading toggle shows the original and the choice is kept on this device.
  const original = page.locator('#clPartHeading [data-heading-action="original"]');
  await expect(original).toHaveAttribute('aria-pressed', 'false');
  await original.click();
  await expect(original).toHaveAttribute('aria-pressed', 'true');
  await expect(reader(page).locator('.cl-original')).toBeVisible();
  await expect(reader(page).locator('.cl-original')).toHaveCSS('border-left-style', 'solid');
  await expect.poll(async () => (await saved(page))?.layers.original).toBe(true);

  // Drawer: the same layer state, and the last text layer cannot be hidden.
  const layer = (name) => page.locator(`#clSidebarContent [data-cl-layer="${name}"]`);
  await revealControl(layer('zh'));
  await expect(layer('original')).toHaveAttribute('aria-pressed', 'true');
  await layer('zh').click();
  await expect(reader(page).locator('.cl-zh')).toBeHidden();
  await expect(layer('zh')).toBeFocused();
  await layer('original').click();
  await expect(layer('modern')).toBeDisabled();
  await expect(reader(page).locator('.cl-modern')).toBeVisible();
  await layer('zh').click();
  await expect(layer('modern')).toBeEnabled();
  await page.keyboard.press('Escape');

  // The classics never become the module the dashboard offers to resume.
  expect(await page.evaluate(() => ProgressStore.getNavigation().lastModule)).toBe('grammar');

  // Browser history moves between the classics and the module before them.
  await page.goBack();
  await expect.poll(() => page.evaluate(() => ModuleSwitcher.getCurrentModule())).toBe('grammar');
  await expect(page).toHaveURL(/\/grammar\/$/);
  await expect(page).toHaveTitle('JLPT 日语语法查阅 · 词基流动');
  await page.goForward();
  await expect.poll(() => page.evaluate(() => ModuleSwitcher.getCurrentModule())).toBe('classics');
  await expect(page).toHaveURL(/\/#classics$/);
  await expect(page).toHaveTitle('日本古典 · 词基流动');
  await expect(heading(page)).toContainText('桐壺');

  // #classics reopens the module at the work read last, with its layers.
  await page.reload();
  await waitForApp(page);
  await expect.poll(() => page.evaluate(() => ModuleSwitcher.getCurrentModule())).toBe('classics');
  await expect(heading(page)).toContainText('桐壺');
  await expect(reader(page).locator('.cl-original')).toBeHidden();
  await expect(reader(page).locator('.cl-zh')).toBeVisible();
  await expect(page).toHaveTitle('日本古典 · 词基流动');
  expect(errors).toEqual([]);
});

test('turning past a part opens the next one, and the directory and place are kept', async ({ page }) => {
  await serveLibrary(page);
  const errors = await openReadyApp(page, { module: 'classics', classics: true });
  await expect(reader(page).locator('.cl-body .cl-unit').first()).toBeVisible();
  const book = reader(page).locator('.book-frame');
  await expect(heading(page)).toContainText('かぐや姫の生い立ち');
  const next = book.locator('.book-turn.is-next');
  for (let turns = 0; turns < 12 && (await next.getAttribute('aria-label')) !== '下一节'; turns++) {
    await next.click();
    await settleBook(book);
  }
  await expect(next).toHaveAttribute('aria-label', '下一节');
  await expect(reader(page).locator('.cl-end-mark')).toHaveText('本节完');
  await expect.poll(async () => (await saved(page))?.books.taketori?.done).toEqual([1]);

  await next.click();
  await expect(heading(page)).toContainText('貴公子たちの求婚');
  await expect(reader(page).locator('.cl-end-mark')).toHaveText('全书完');
  await expect(page.locator('#clPartHeading [data-heading-action="next"]')).toBeDisabled();

  // The directory opens from the heading at the current part; part one is read.
  await page.locator('#clPartHeading [data-heading-action="toc"]').click();
  const cards = page.locator('#clSidebarContent .cl-directory .cl-part-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(1)).toHaveAttribute('aria-current', 'page');
  await expect(cards.nth(1)).toBeFocused();
  await expect(cards.nth(0).locator('.tb-lesson-progress')).toHaveText('读完');
  await cards.nth(0).click();
  await expect(heading(page)).toContainText('かぐや姫の生い立ち');
  await page.keyboard.press('Escape');

  // Turn one page in, leave for another module, and come back to the same page.
  await next.click();
  await settleBook(book);
  expect(await pagerPage(page)).toBe(1);
  await page.locator('#modBtnGrammar').click();
  await page.locator('#modBtnClassics').click();
  await expect(reader(page)).toBeVisible();
  await expect(heading(page)).toContainText('かぐや姫の生い立ち');
  await expect.poll(() => pagerPage(page)).toBe(1);

  // After a reload the work opens at the saved part and unit.
  await expect.poll(async () => (await saved(page))?.books.taketori?.unit).toMatch(/^TK-00[12]$/);
  await page.reload();
  await waitForApp(page);
  await expect(heading(page)).toContainText('かぐや姫の生い立ち');
  await expect.poll(() => pagerPage(page)).toBe(1);
  expect(errors).toEqual([]);
});

for (const { zoom, viewport } of [
  { zoom: '1', viewport: { width: 1280, height: 720 } },
  // The 150% display zoom (页面缩放) over the same layout size.
  { zoom: '1.5', viewport: { width: 1920, height: 1080 } },
]) {
  test(`every turn through a narrated part plays the page-turn motion at ${zoom}× zoom`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript((zoom) => localStorage.setItem('jp_learning_display_scale', zoom), zoom);
    await serveLibrary(page);
    const errors = await openReadyApp(page, { module: 'classics', classics: true });
    await expect(page.locator('html')).toHaveAttribute('data-app-scale', zoom);
    await expect(reader(page).locator('.cl-body .cl-unit').first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const book = reader(page).locator('.book-frame');
    const spreads = await book.locator('.book-page-select option').count();
    expect(spreads).toBeGreaterThan(2);
    // Pages begin inside paragraphs made of sentence spans, which copies used
    // to rewrap, so that the turn fell back to a slide.
    const turn = (direction) =>
      book.evaluate((frame, direction) => {
        window.JPLearn.bookTurn.lastFallback = null;
        frame.querySelector(`.book-turn.is-${direction}`).click();
        const layer = frame.querySelector('.book-flip-layer');
        const copy = layer && layer.querySelector('.book-body');
        return {
          page: Number(frame.querySelector('.book-page-select').value),
          layer: !!layer,
          fallback: window.JPLearn.bookTurn.lastFallback || null,
          // A copy as tall as the live body, to the fraction.
          heights: copy && [
            parseFloat(copy.style.height),
            parseFloat(getComputedStyle(frame.querySelector('.book-body')).height),
          ],
        };
      }, direction);
    const turns = [];
    for (let i = 1; i < spreads; i++) turns.push(await turn('next'));
    for (let i = 1; i < spreads; i++) turns.push(await turn('prev'));
    await expect(book.locator('.book-page-select')).toHaveValue('0');
    expect(
      turns.filter((t) => !t.layer || t.fallback || Math.abs(t.heights[0] - t.heights[1]) > 0.05),
    ).toEqual([]);
    await settleBook(book);
    expect(errors).toEqual([]);
  });
}

test('the narration plays, follows the text into the next part and keeps its time', async ({ page }) => {
  await serveLibrary(page);
  const errors = await openReadyApp(page, { module: 'classics', classics: true });
  const strip = reader(page).locator('.cl-audio');
  const play = strip.locator('.cl-audio-play');
  await expect(strip).toBeVisible();
  await expect(strip.locator('.cl-audio-time')).toHaveText('0:00 / 4:00');
  await expect(strip.locator('.cl-audio-marks i')).toHaveCount(1);
  await expect(play).toHaveAttribute('aria-label', '播放朗读');

  await play.click();
  await expect(play).toHaveAttribute('aria-label', '暂停朗读');
  await expect(reader(page).locator('.cl-unit[data-unit-id="TK-001"] .cl-s.is-reading')).toHaveCount(1);
  await expect(reader(page).locator('.cl-unit[data-unit-id="TK-001"]')).toHaveClass(/is-reading/);

  // Seeking into part two opens it and marks its first sentence.
  await strip.locator('.cl-audio-seek').fill('200');
  await expect(heading(page)).toContainText('貴公子たちの求婚');
  await expect(reader(page).locator('.cl-unit[data-unit-id="TK-003"] .cl-s.is-reading')).toHaveCount(1);
  await expect(reader(page).locator('.cl-unit[data-unit-id="TK-003"] .cl-s.is-reading')).toContainText(
    '世の男たちは',
  );
  await expect(reader(page).locator('.cl-audio .cl-audio-seek')).toHaveAttribute(
    'aria-valuetext',
    /第二节 貴公子たちの求婚/,
  );

  // Another module pauses it; the time is kept for the next visit.
  await page.locator('#modBtnVocab').click();
  await expect
    .poll(() => classics(page, () => ModuleSwitcher.getClassicsModule().reader.audio.paused))
    .toBe(true);
  await expect.poll(async () => (await saved(page))?.books.taketori?.time).toBeGreaterThanOrEqual(200);
  await page.locator('#modBtnClassics').click();
  await expect(play).toHaveAttribute('aria-label', '继续朗读');

  // 从本页读 starts from the first sentence that begins on the shown spread.
  await page.locator('#clPartHeading [data-heading-action="previous"]').click();
  await expect(heading(page)).toContainText('かぐや姫の生い立ち');
  const book = reader(page).locator('.book-frame');
  await book.locator('.book-page-select').selectOption({ index: 1 });
  await settleBook(book);
  await strip.locator('[data-cl-audio="here"]').click();
  await expect(play).toHaveAttribute('aria-label', '暂停朗读');
  await expect(reader(page).locator('.cl-s.is-reading')).toHaveCount(1);
  expect(
    await classics(page, () => {
      const narrated = ModuleSwitcher.getClassicsModule().reader;
      const pager = narrated.pager;
      const sentence = document.querySelector('#clReader .cl-s.is-reading');
      const column = pager.columnOf(sentence);
      const unit = sentence.closest('.cl-unit').getAttribute('data-unit-id');
      const start = narrated.book.timeline.timeAt(unit, Number(sentence.getAttribute('data-o')));
      return {
        page: pager.page,
        shown: column >= pager.firstColumn() && column <= pager.lastColumn(),
        fromSentence: Math.abs(narrated.audio.currentTime - start) < 2,
      };
    }),
  ).toEqual({ page: 1, shown: true, fromSentence: true });
  await play.click();
  await expect(play).toHaveAttribute('aria-label', '继续朗读');
  expect(errors).toEqual([]);
});

test('a layout chosen while the classics are hidden applies at the saved place', async ({ page }) => {
  await serveLibrary(page);
  const errors = await openReadyApp(page, { module: 'classics', classics: true });
  const book = reader(page).locator('.book-frame');
  await expect(book).toBeVisible();
  await book.locator('.book-turn.is-next').click();
  await settleBook(book);
  await expect.poll(async () => (await saved(page))?.books.taketori?.unit).toMatch(/^TK-00[12]$/);
  const place = (await saved(page)).books.taketori;

  await page.locator('#modBtnVocab').click();
  await chooseReadingLayout(page, 'single');
  await page.locator('#modBtnClassics').click();
  await expect(page.locator('html')).toHaveAttribute('data-book-format', 'single');
  await expect(book).toBeVisible();
  await expect
    .poll(() => classics(page, () => (ModuleSwitcher.getClassicsModule().reader._capture() || {}).unit))
    .toBe(place.unit);
  expect(await pagerPage(page)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('a classic also reads in the scrolling layout', async ({ page }) => {
  await serveLibrary(page);
  const errors = await openReadyApp(page, { module: 'classics', classics: true });
  await expect(reader(page).locator('.book-frame')).toBeVisible();
  await chooseReadingLayout(page, 'scroll');
  await expect(reader(page).locator('.book-frame')).toHaveCount(0);
  await expect(reader(page).locator('.cl-body .cl-unit')).toHaveCount(2);
  await reader(page).locator('.cl-end [data-cl-step="next"]').click();
  await expect(heading(page)).toContainText('貴公子たちの求婚');
  await expect(heading(page)).toBeFocused();
  expect(errors).toEqual([]);
});

for (const width of [1600, 1280]) {
  test(`classics restore a spread inside the Chinese translation at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1600 ? 900 : 720 });
    await serveLibrary(page);
    await page.route('**/data/classics_v1/taketori/01.json', (route) =>
      route.fulfill({
        json: {
          ...LIBRARY['taketori/01.json'],
          units: [
            { ...unit('TK-001'), zh: sentences(240, '翁走进山野取了第N根竹子，带回家中。') },
            unit('TK-002'),
          ],
        },
      }),
    );
    const errors = await openReadyApp(page, { module: 'classics', classics: true });
    const book = reader(page).locator('.book-frame');
    await expect(book).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const target = await classics(page, () => {
      const r = ModuleSwitcher.getClassicsModule().reader;
      const unit = r._unitEl('TK-001');
      const page = Math.floor((r._lastColumn(unit.querySelector('.cl-zh')) - 1) / r.pager.perSpread);
      return {
        page,
        firstColumn: page * r.pager.perSpread,
        modernEnd: r._lastColumn(unit.querySelector('.cl-modern')),
      };
    });
    expect(target.firstColumn).toBeGreaterThan(target.modernEnd);
    await book.locator('.book-page-select').selectOption(String(target.page));
    await settleBook(book);
    await expect.poll(async () => (await saved(page))?.books.taketori?.offset).toBe(target.firstColumn);
    await page.reload();
    await waitForApp(page);
    await expect(book.locator('.book-page-select')).toHaveValue(String(target.page));
    expect(errors).toEqual([]);
  });
}

test('classics scrolling keeps the position within a long unit on reload and module switches', async ({
  page,
}) => {
  await serveLibrary(page);
  await page.route('**/data/classics_v1/taketori/01.json', (route) =>
    route.fulfill({
      json: {
        ...LIBRARY['taketori/01.json'],
        units: [
          unit('TK-001'),
          { ...unit('TK-002'), modern: sentences(160, '子どもはN日ごとに大きくなっていった。') },
        ],
      },
    }),
  );
  const errors = await openReadyApp(page, { module: 'classics', classics: true });
  await expect(reader(page).locator('.book-frame')).toBeVisible();
  await chooseReadingLayout(page, 'scroll');
  await reader(page).hover();
  await page.mouse.wheel(0, 10000);
  await expect
    .poll(() => classics(page, () => ModuleSwitcher.getClassicsModule().reader._capture()?.unit))
    .toBe('TK-002');
  const scroll = await reader(page).evaluate((el) => el.scrollTop);
  await expect.poll(async () => (await saved(page))?.books.taketori?.unit).toBe('TK-002');
  await page.locator('#modBtnVocab').click();
  await page.locator('#modBtnClassics').click();
  expect(await reader(page).evaluate((el) => el.scrollTop)).toBeCloseTo(scroll, 0);
  await page.reload();
  await waitForApp(page);
  await expect(reader(page).locator('.cl-body .cl-unit').last()).toBeVisible();
  await expect.poll(() => reader(page).evaluate((el) => el.scrollTop)).toBeCloseTo(scroll, 0);
  expect(errors).toEqual([]);
});

test('the last classics work selection cancels a pending directory request', async ({ page }) => {
  await serveLibrary(page);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route('**/data/classics_v1/genji/index.json', async (route) => {
    requested = true;
    await gate;
    return route.fulfill({ json: LIBRARY['genji/index.json'] });
  });
  const errors = await openReadyApp(page, { module: 'classics', classics: true });
  await expect(heading(page)).toContainText('かぐや姫の生い立ち');
  await openSidebar(page);
  try {
    await works(page).nth(1).click();
    await expect.poll(() => requested).toBe(true);
    await expect(page.locator('#clLoading')).toBeVisible();
    await works(page).nth(0).click();
    await expect(page.locator('#clLoading')).toBeHidden();
    release();
    await expect
      .poll(() => classics(page, () => JPLearn.classics.getBook('genji').then((book) => book.id)))
      .toBe('genji');
    await expect(heading(page)).toContainText('かぐや姫の生い立ち');
    await expect(works(page).nth(0)).toHaveAttribute('aria-current', 'page');
    await expect.poll(async () => (await saved(page))?.last).toBe('taketori');
    expect(errors).toEqual([]);
  } finally {
    release();
  }
});

test('the classics loading layer stays below the open sidebar', async ({ page }) => {
  await serveLibrary(page);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/data/classics_v1/genji/index.json', async (route) => {
    await gate;
    return route.fulfill({ json: LIBRARY['genji/index.json'] });
  });
  await openReadyApp(page, { module: 'classics', classics: true });
  await expect(heading(page)).toBeVisible();
  await openSidebar(page);
  try {
    await works(page).nth(1).click();
    await expect(page.locator('#clLoading')).toBeVisible();
    await expectSidebarAboveLoading(page);
    await page.locator('#appSettingsToggle').click();
    await expect(page.locator('#appSettingsPanel')).toBeVisible();
    await page.keyboard.press('Escape');
  } finally {
    release();
  }
  await expect(heading(page)).toContainText('桐壺');
});

test('without a classics library the rail keeps four modules and #classics opens today', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/data/classics_v1/**', (route) => route.fulfill({ status: 404, body: '' }));
  await page.goto('/#classics');
  await waitForApp(page);
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('');
  expect(await page.evaluate(() => ModuleSwitcher.getCurrentModule())).toBe('dashboard');
  await expect(page).toHaveTitle('词基流动');
  await expect(page.locator('#moduleSwitcher .mod-btn')).toHaveCount(4);
  await expect(page.locator('#modBtnClassics')).toHaveCount(0);

  // Typing the address later changes nothing either.
  await page.evaluate(() => {
    location.hash = 'classics';
  });
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#classics');
  expect(await page.evaluate(() => ModuleSwitcher.getCurrentModule())).toBe('dashboard');
  await expect(page).toHaveTitle('词基流动');
  expect(errors).toEqual([]);
});

test('the first module switch after loading keeps the saved places of the others', async ({ page }) => {
  // The local progress API (serve.py) answers after the modules have started,
  // so their first copy of the navigation is the empty default.
  const place = { bookId: 'KotobaFlow1', lessonId: 'lesson_02' };
  let stored = {
    version: 2,
    vocabulary: {
      known: [],
      fuzzy: [],
      unknown: [],
      favorite: [],
      grammarFavorite: [],
      history: [],
      srsVersion: 1,
      srs: [],
    },
    navigation: { version: 1, lastModule: 'lesson', vocab: {}, grammar: {}, textbook: place },
    usage: {},
    updatedAt: '',
  };
  await page.route('**/api/progress', async (route) => {
    if (route.request().method() === 'POST') stored = route.request().postDataJSON();
    await route.fulfill({ json: stored });
  });
  await serveLibrary(page);
  const errors = await openReadyApp(page, { module: 'dashboard', classics: true });
  const navigation = () => page.evaluate(() => ProgressStore.getNavigation());

  await openClassics(page);
  expect((await navigation()).lastModule).toBe('lesson');
  expect((await navigation()).textbook).toMatchObject(place);

  await page.goto('/');
  await waitForApp(page);
  await page.locator('#modBtnVocab').click();
  await expect.poll(async () => (await navigation()).lastModule).toBe('vocab');
  expect((await navigation()).textbook).toMatchObject(place);
  await expect.poll(() => stored.navigation.lastModule).toBe('vocab');
  expect(stored.navigation.textbook).toMatchObject(place);
  expect(errors).toEqual([]);
});
