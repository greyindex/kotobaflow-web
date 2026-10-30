// PUB-05: the public package offers only the original KotobaFlow curriculum; the
// XinBian books stay local. The release builder rewrites js/content-config.js;
// here the same rewrite is served to a normal local page.
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { publicContentConfig } = require('../tools/build_public_release.cjs');
const { openReadyApp, openSettings, revealControl } = require('./helpers');

const PUBLIC_BOOKS = ['KotobaFlow1', 'KotobaFlow2', 'KotobaFlow3', 'KotobaFlow4'];

test.use({ serviceWorkers: 'block' });

async function servePublicBooks(page) {
  const source = fs.readFileSync(path.join(__dirname, '../js/content-config.js'), 'utf8');
  await page.route('**/js/content-config.js*', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: publicContentConfig(source) }),
  );
}

async function browserMode(page) {
  await page.route('**/js/storage-config.js*', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: "window.JPLearnStorageConfig={mode:'browser'};" }),
  );
}

async function openArchive(page) {
  await openSettings(page);
  if (!(await page.locator('.app-settings-danger').evaluate((el) => el.open)))
    await page.locator('.app-settings-danger summary').click();
  await page.locator('#appArchiveOpen').click();
  await expect(page.locator('#archiveDialog')).toBeVisible();
}

async function uploadArchive(page, archive) {
  await page.locator('#archiveFile').setInputFiles({
    name: 'legacy-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(archive)),
  });
}

async function exportArchive(page) {
  return page.evaluate(() => JPLearn.archive.exportArchive(ProgressStore.exportProgress()));
}

async function legacyArchive(page) {
  await page.evaluate(() => {
    StudyStorage.markWord(10309, 'unknown');
    StudyStorage.markWord(10309, 'favorite');
  });
  const archive = await exportArchive(page);
  archive.progress.plan.bookId = 'XinBian1';
  archive.progress.plan.lessonId = 'lesson_02';
  archive.progress.navigation.lastModule = 'lesson';
  archive.progress.navigation.textbook = {
    bookId: 'XinBian2',
    lessonId: 'review_unit_04',
    displayMode: 'normal',
    readerScrollTop: 200,
    coursePath: { bookId: 'XinBian3', lessonId: 'lesson_18' },
  };
  archive.progress.navigation.grammar.courseContext = { bookId: 'XinBian4', lessonId: 'lesson_18' };
  return archive;
}

for (const mode of ['replace', 'merge']) {
  test(`PUB-FIX-01 public file ${mode} preserves historical progress and exports a restorable backup`, async ({
    page,
  }) => {
    await page.setViewportSize(
      mode === 'replace' ? { width: 1600, height: 900 } : { width: 1280, height: 720 },
    );
    await browserMode(page);
    await openReadyApp(page, { module: 'dashboard' });
    const legacy = await legacyArchive(page);
    // The same actual export is valid locally before the release configuration changes.
    expect(await page.evaluate((data) => JPLearn.archive.validate(JSON.stringify(data)), legacy)).toEqual(
      legacy.progress,
    );
    await servePublicBooks(page);
    const requests = [];
    page.on('request', (request) => requests.push(request.url()));
    await page.reload();
    await expect(page.locator('#loading')).toHaveClass(/hidden/);
    const current = (await exportArchive(page)).progress;
    await openArchive(page);
    await uploadArchive(page, legacy);
    await expect(page.locator('#archiveRestore')).toBeEnabled();
    await page.screenshot({ path: `local/qa/batch1-2026-10-07/archive/public-${mode}-preview.png` });
    await page.locator('#archiveMode').selectOption(mode);
    await page.locator('#archiveRestore').click();
    await expect(page.locator('#archiveReload')).toBeVisible();
    await page.locator('#archiveReload').click();
    await expect(page.locator('#loading')).toHaveClass(/hidden/);
    const restored = (await exportArchive(page)).progress;
    expect(restored.plan).toEqual(mode === 'replace' ? legacy.progress.plan : current.plan);
    expect(restored.navigation.lastModule).toBe(
      mode === 'replace' ? legacy.progress.navigation.lastModule : current.navigation.lastModule,
    );
    expect(restored.navigation.textbook).toEqual(
      mode === 'replace' ? legacy.progress.navigation.textbook : current.navigation.textbook,
    );
    expect(restored.navigation.grammar).toEqual(
      mode === 'replace' ? legacy.progress.navigation.grammar : current.navigation.grammar,
    );
    expect(restored.vocabulary).toEqual(legacy.progress.vocabulary);

    // Use the public page's own download and file chooser, not a hand-built second backup.
    await openArchive(page);
    const pending = page.waitForEvent('download');
    await page.locator('#archiveExport').click();
    const chunks = [];
    for await (const chunk of await (await pending).createReadStream()) chunks.push(chunk);
    const exported = JSON.parse(Buffer.concat(chunks).toString());
    expect(exported.progress.plan).toEqual(restored.plan);
    expect(exported.progress.navigation.textbook).toEqual(restored.navigation.textbook);
    await uploadArchive(page, exported);
    await expect(page.locator('#archiveRestore')).toBeEnabled();
    await page.locator('#archiveMode').selectOption('replace');
    await page.locator('#archiveRestore').click();
    await expect(page.locator('#archiveReload')).toBeVisible();
    expect((await exportArchive(page)).progress.vocabulary).toEqual(legacy.progress.vocabulary);
    expect(requests.some((url) => /XinBian/.test(url))).toBe(false);
  });
}

test('PUB-FIX-01 historical validation rejects unknown books and wrong lesson IDs in every saved context', async ({
  page,
}) => {
  await servePublicBooks(page);
  await browserMode(page);
  await openReadyApp(page, { module: 'dashboard' });
  const legacy = await legacyArchive(page);
  await openArchive(page);
  for (const field of ['plan', 'textbook', 'coursePath', 'courseContext']) {
    for (const invalid of [
      { bookId: 'XinBian9', lessonId: 'lesson_01' },
      { bookId: 'XinBian1', lessonId: 'lesson_17' },
      { bookId: 'XinBian3', lessonId: 'review_unit_01' },
      { bookId: 'XinBian4', lessonId: 'lesson_018' },
      { bookId: 'KotobaFlow2', lessonId: 'lesson_00' },
    ]) {
      const bad = structuredClone(legacy);
      const context =
        field === 'plan'
          ? bad.progress.plan
          : field === 'textbook'
            ? bad.progress.navigation.textbook
            : field === 'coursePath'
              ? bad.progress.navigation.textbook.coursePath
              : bad.progress.navigation.grammar.courseContext;
      Object.assign(context, invalid);
      await uploadArchive(page, bad);
      await expect(page.locator('#archiveStatus')).toContainText(
        invalid.bookId === 'XinBian9' ? '教材 ID 不存在' : '教材课次 ID 不存在',
      );
      await expect(page.locator('#archiveRestore')).toBeDisabled();
    }
  }
  expect((await exportArchive(page)).progress.vocabulary).toEqual(legacy.progress.vocabulary);
});

test('PUB-FIX-01 frozen historical lesson identities exactly match the local catalogs without exposing content', async ({
  page,
}) => {
  await servePublicBooks(page);
  await browserMode(page);
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  await openReadyApp(page, { module: 'dashboard' });
  const probes = ['lesson_00', 'lesson_001', 'lesson_1', 'review_unit_00'];
  for (let n = 1; n <= 30; n++) {
    probes.push('lesson_' + String(n).padStart(2, '0'));
    probes.push('review_unit_' + String(n).padStart(2, '0'));
  }
  for (const bookId of ['XinBian1', 'XinBian2', 'XinBian3', 'XinBian4', ...PUBLIC_BOOKS]) {
    const catalog = JSON.parse(
      fs.readFileSync(path.join(__dirname, `../data/textbook/book_chunks/${bookId}.json`), 'utf8'),
    );
    const accepted = await page.evaluate(
      async ({ bookId, probes }) => {
        const result = [];
        for (const id of probes) if (await TextbookLoader.hasArchiveLesson(bookId, id)) result.push(id);
        return result;
      },
      { bookId, probes },
    );
    expect(accepted.sort()).toEqual(catalog.index.lessons.map((lesson) => lesson.lesson_id).sort());
  }
  expect(
    await page.evaluate(async () => {
      try {
        await TextbookLoader.getBookIndex('XinBian1');
        return false;
      } catch {
        return true;
      }
    }),
  ).toBe(true);
  expect(await page.evaluate(() => TextbookLoader.isKnownBook('XinBian1'))).toBe(false);
  expect(requests.some((url) => /XinBian/.test(url))).toBe(false);
});

test('the public package lists only KotobaFlow and moves saved XinBian places to it', async ({ page }) => {
  await servePublicBooks(page);
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  const errors = await openReadyApp(page, { module: 'lesson' });

  await revealControl(page.locator('#tbBookSelect'));
  await expect(page.locator('#tbBookSelect option')).toHaveCount(4);
  expect(
    await page.locator('#tbBookSelect option').evaluateAll((items) => items.map((o) => o.value)),
  ).toEqual(PUBLIC_BOOKS);
  await expect(page.locator('#tbBookSelect')).toHaveValue('KotobaFlow1');
  expect(
    await page.evaluate(() => TextbookLoader.getBooks().then((books) => books.map((b) => b.id))),
  ).toEqual(PUBLIC_BOOKS);

  // A plan or link saved before the change still opens a lesson, in the first public book.
  await page.keyboard.press('Escape');
  await page.evaluate(() => ModuleSwitcher.openPlannedLesson({ bookId: 'XinBian1', lessonId: 'lesson_05' }));
  await expect(page.locator('#tbBookSelect')).toHaveValue('KotobaFlow1');
  await expect(page.locator('#tbReader .tb-reader-body')).toBeVisible();

  // The plan editor offers the same books, even for a plan saved with XinBian.
  await page.locator('#modBtnDashboard').click();
  await page.locator('[data-dashboard-action="open-plan"]').click();
  await expect(page.locator('#dashboardPlanBook option')).toHaveCount(4);
  expect(
    await page.locator('#dashboardPlanBook option').evaluateAll((items) => items.map((o) => o.value)),
  ).toEqual(PUBLIC_BOOKS);
  await page.keyboard.press('Escape');
  expect(requests.some((url) => /XinBian/.test(url))).toBe(false);
  // The public reading library is enabled; this suite's helper returns 404
  // for its catalog so unrelated archive and textbook flows keep four modules.
  expect(requests.some((url) => /classics_v\d+\/catalog\.json/.test(url))).toBe(true);
  await expect(page.locator('#modBtnClassics')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('PUB-FIX-03 a plan saved with a XinBian book edits an offered book and its real lessons', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await servePublicBooks(page);
  await browserMode(page);
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  const errors = await openReadyApp(page, { module: 'dashboard' });
  const lessons = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../data/textbook/book_chunks/KotobaFlow1.json'), 'utf8'),
  ).index.lessons.map((lesson) => lesson.lesson_id);
  await page.evaluate(() =>
    ProgressStore.updatePlan(
      Object.assign(ProgressStore.getPlan(), { bookId: 'XinBian1', lessonId: 'lesson_05' }),
    ),
  );
  const savedPlan = () => page.evaluate(() => ProgressStore.getPlan());

  await page.locator('[data-dashboard-action="open-plan"]').click();
  await expect(page.locator('#dashboardPlanBook')).toHaveValue('KotobaFlow1');
  await expect(page.locator('#dashboardPlanLesson')).toBeEnabled();
  expect(
    await page.locator('#dashboardPlanLesson option').evaluateAll((items) => items.map((o) => o.value)),
  ).toEqual(['', ...lessons]);
  await expect(page.locator('#dashboardPlanLesson')).toHaveValue(lessons[0]);
  await expect(page.locator('.dashboard-plan-notice')).toContainText('不再提供');
  await expect(page.locator('.dashboard-plan-notice')).not.toContainText('无法读取');

  // Cancelling keeps the historical plan; only an explicit save rewrites it.
  await page.keyboard.press('Escape');
  await expect(page.locator('#dashboardPlanBook')).toHaveCount(0);
  expect(await savedPlan()).toMatchObject({ bookId: 'XinBian1', lessonId: 'lesson_05' });

  await page.locator('[data-dashboard-action="open-plan"]').click();
  await expect(page.locator('#dashboardPlanLesson')).toBeEnabled();
  await page.locator('#dashboardPlanBook').selectOption('KotobaFlow2');
  await expect(page.locator('.dashboard-plan-notice')).toHaveCount(0);
  await expect(page.locator('#dashboardPlanLesson')).toBeEnabled();
  await page.locator('#dashboardPlanBook').selectOption('KotobaFlow1');
  await expect(page.locator('#dashboardPlanLesson')).toBeEnabled();
  await page.locator('#dashboardPlanLesson').selectOption(lessons[3]);
  await page.locator('.dashboard-plan-dialog button[type="submit"]').click();
  await expect(page.locator('#dashboardPlanBook')).toHaveCount(0);
  expect(await savedPlan()).toMatchObject({ bookId: 'KotobaFlow1', lessonId: lessons[3] });
  expect(requests.some((url) => /XinBian/.test(url))).toBe(false);
  expect(errors).toEqual([]);
});

// FIX-33: without course progress Today's lesson row names the book it opens,
// never a withheld one.
const lessonRowDetail = (page) =>
  page.locator('.dashboard-task-card[data-dashboard-action="open-lesson"] .dashboard-task-copy > span');

test('FIX-33 the public lesson row names the planned KotobaFlow book', async ({ page }) => {
  await servePublicBooks(page);
  await browserMode(page);
  const errors = await openReadyApp(page, { module: 'dashboard' });
  await expect(lessonRowDetail(page)).toHaveText('KotobaFlow 日语 · 第一册');

  // A plan saved with XinBian opens the first public book, and the row says so.
  await page.evaluate(() =>
    ProgressStore.updatePlan(
      Object.assign(ProgressStore.getPlan(), { bookId: 'XinBian2', lessonId: 'lesson_05' }),
    ),
  );
  await expect(lessonRowDetail(page)).toHaveText('KotobaFlow 日语 · 第一册');

  await page.locator('[data-dashboard-action="open-plan"]').click();
  await expect(page.locator('#dashboardPlanLesson')).toBeEnabled();
  await page.locator('#dashboardPlanBook').selectOption('KotobaFlow2');
  await expect(page.locator('#dashboardPlanLesson')).toBeEnabled();
  await page.locator('.dashboard-plan-dialog button[type="submit"]').click();
  await expect(page.locator('#dashboardPlanBook')).toHaveCount(0);
  await expect(lessonRowDetail(page)).toHaveText('KotobaFlow 日语 · 第二册');
  await expect(page.locator('#dashboardMain')).not.toContainText('新编');
  expect(errors).toEqual([]);
});

test('FIX-33 the local copy names its first book, 新编日语', async ({ page }) => {
  // Browser storage keeps lesson progress from earlier tests on the shared server out.
  await browserMode(page);
  const errors = await openReadyApp(page, { module: 'dashboard' });
  await expect(lessonRowDetail(page)).toHaveText('新编日语 · 第一册');
  expect(errors).toEqual([]);
});

test('PUB-FIX-05 a saved lesson grammar path into a withheld book resumes to the whole list', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await servePublicBooks(page);
  await browserMode(page);
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  const errors = await openReadyApp(page, { module: 'dashboard' });
  await page.evaluate(() => {
    const navigation = ProgressStore.exportProgress().navigation;
    navigation.lastModule = 'grammar';
    navigation.grammar = {
      view: 'grammar-list',
      page: 1,
      courseContext: {
        kind: 'textbook-course',
        courseStep: 'grammar',
        bookId: 'XinBian4',
        lessonId: 'lesson_18',
        lessonLabel: '第十八课',
        grammarUids: ['g1', 'g2'],
      },
    };
    ProgressStore.updateNavigation(navigation);
  });
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveClass(/hidden/);
  await page.locator('[data-dashboard-action="resume"]').first().click();

  const heading = page.locator('#grammarHeading');
  await expect(heading.locator('.page-heading-title')).toHaveText('全部语法');
  await expect(heading.locator('.page-heading-eyebrow')).toHaveText(
    '上次的本课语法来自本站不再提供的教材，已改为显示全部语法',
  );
  await expect(page.locator('#gmCourseContext')).toBeHidden();
  await expect(page.locator('#gmGrammarList .gm-card').first()).toBeVisible();
  await expect(page.locator('#grammarMain')).not.toContainText('正在整理本课语法');
  expect(
    await page.evaluate(() => ProgressStore.exportProgress().navigation.grammar.courseContext),
  ).toBeNull();

  // The notice stays only until the learner changes the list.
  await heading.getByRole('button', { name: /打开语法筛选/ }).click();
  await page.locator('#gmSidebarFilters [data-level="N5"]').click();
  await expect(heading.locator('.page-heading-title')).toHaveText('JLPT N5 语法');
  await expect(heading.locator('.page-heading-eyebrow')).toBeHidden();
  expect(requests.some((url) => /XinBian/.test(url))).toBe(false);
  expect(errors).toEqual([]);
});

test('PUB-FIX-05 lesson grammar that fails to load offers a retry instead of a stuck list', async ({
  page,
}) => {
  // Local configuration: the KotobaFlow lessons do not link grammar points yet.
  await page.setViewportSize({ width: 1280, height: 720 });
  const errors = await openReadyApp(page, { module: 'dashboard' });
  await page.route('**/book_chunks/grammar-*.json', (route) => route.abort());
  await page.evaluate(() =>
    ModuleSwitcher.openGrammarFromTextbook({
      kind: 'textbook-course',
      courseStep: 'grammar',
      bookId: 'XinBian1',
      lessonId: 'lesson_02',
      lessonLabel: '第二课',
    }),
  );
  const failure = page.locator('#gmGrammarList .state-view--error');
  await expect(failure).toContainText('本课语法暂时无法读取');
  await expect(page.locator('#grammarHeading')).toContainText('本课语法读取失败');
  await expect(page.locator('#gmGrammarList .gm-card')).toHaveCount(0);
  await page.unroute('**/book_chunks/grammar-*.json');
  await failure.getByRole('button', { name: '重试' }).click();
  await expect(page.locator('.gm-course-grammar-card')).toHaveCount(7);
  await expect(page.locator('#grammarHeading')).toContainText('7 个关联语法点');
  expect(errors.filter((message) => !/grammar-[a-f0-9]{64}\.json/.test(message))).toEqual([]);
});
