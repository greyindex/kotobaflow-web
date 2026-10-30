const { test, expect } = require('@playwright/test');
const {
  DEFAULT_LAYOUT_STORAGE,
  openReadyApp,
  openSettings,
  expectRegionsWithinViewport,
  revealControl,
} = require('./helpers');
test.use({ serviceWorkers: 'block' });
const browserKey = 'jp_learning_progress_browser_v1';
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
  await expect(page.locator('#appSettingsPanel')).toBeHidden();
}
async function upload(page, data) {
  await page.locator('#archiveFile').setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)),
  });
}
async function archive(page) {
  return page.evaluate(() => window.JPLearn.archive.exportArchive(window.ProgressStore.exportProgress()));
}
async function downloadArchive(page) {
  const pending = page.waitForEvent('download');
  await page.locator('#archiveExport').click();
  const download = await pending;
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}
async function seed(page, minutes = 45) {
  await page.evaluate((minutes) => {
    window.ProgressStore.updatePlan({ ...window.ProgressStore.getPlan(), dailyMinutes: minutes });
    const id = window.taxonomyManager.allWords[0].index;
    window.StudyStorage.markWord(id, 'known');
    window.StudyStorage.markWord(id, 'favorite');
    window.StudyStorage.saveSession({ id: 'archive-test-session', total: 1, known: 1, durationMs: 1000 });
  }, minutes);
}
async function restore(page, data, mode = 'replace') {
  await openArchive(page);
  await upload(page, data);
  await expect(page.locator('#archiveRestore')).toBeEnabled();
  await page.locator('#archiveMode').selectOption(mode);
  await page.locator('#archiveRestore').click();
  await expect(page.locator('#archiveReload')).toBeVisible();
  await page.locator('#archiveReload').click();
  await expect(page.locator('#loading')).toHaveClass(/hidden/);
}

test('complete download restores into a second browser with plan, SRS, history and checkpoint', async ({
  page,
  browser,
}) => {
  // Export, a second browser context, and restore/reload each load the full catalog.
  test.setTimeout(120_000);
  await browserMode(page);
  await openReadyApp(page, { module: 'dashboard' });
  await seed(page);
  await page.locator('#modBtnVocab').click();
  await page.evaluate(() => {
    localStorage.setItem('unrelated_access_token', 'must-not-export');
    window.appConfig.startStudySession(window.taxonomyManager.allWords.slice(0, 2), {
      practiceMode: 'classic',
    });
  });
  await openArchive(page);
  const text = await downloadArchive(page);
  expect(text).not.toContain('must-not-export');
  const data = JSON.parse(text);
  expect(data.progress.navigation.vocab.studySession.queueIndices).toHaveLength(2);
  const context = await browser.newContext({ serviceWorkers: 'block', baseURL: new URL(page.url()).origin });
  const target = await context.newPage();
  try {
    await browserMode(target);
    await openReadyApp(target, { module: 'dashboard' });
    await restore(target, data);
    const restored = await archive(target);
    expect(restored.progress.plan.dailyMinutes).toBe(45);
    expect(restored.progress.vocabulary).toEqual(data.progress.vocabulary);
    expect(restored.progress.navigation.vocab.studySession.queueIndices).toEqual(
      data.progress.navigation.vocab.studySession.queueIndices,
    );
  } finally {
    await context.close();
  }
});

test('reviewed older catalog backups restore the saved SRS for historical IDs', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await browserMode(page);
  await openReadyApp(page, { module: 'dashboard' });
  await page.evaluate(() => window.StudyStorage.markWord(10309, 'unknown'));
  const saved = await archive(page);
  expect(saved.progress.vocabulary.srs.some((record) => record.index === 10309)).toBe(true);

  const reviewedVersions = [
    'vocab-id-v1:d38811c9b176f119f7428af1b096262ce75f9b85ba2992d09debe559008d6372',
    'vocab-id-v1:0f628962ec6447de8cc3e80be975c392a2ef627bba7ac234c8ebeb2aa7e6ca31',
  ];
  for (const contentVersion of reviewedVersions) {
    const context = await browser.newContext({
      serviceWorkers: 'block',
      baseURL: new URL(page.url()).origin,
    });
    const target = await context.newPage();
    try {
      await browserMode(target);
      await openReadyApp(target, { module: 'dashboard' });
      await restore(target, { ...saved, contentVersion });
      const restored = await archive(target);
      expect(restored.progress.vocabulary.unknown).toContain(10309);
      expect(restored.progress.vocabulary.srs.some((record) => record.index === 10309)).toBe(true);
    } finally {
      await context.close();
    }
  }
});

test.describe('textbook archive reading anchors', () => {
  test.use({ storageState: DEFAULT_LAYOUT_STORAGE });

  test('downloaded first and later reading-unit anchors pass import preview unchanged', async ({ page }) => {
    test.setTimeout(120_000);
    await browserMode(page);
    await openReadyApp(page, { module: 'lesson' });
    await revealControl(page.locator('#tbBookSelect'));
    await page.locator('#tbBookSelect').selectOption('KotobaFlow1');
    const lesson = page.locator('.tb-lesson-card[data-lesson-id="lesson_01"]');
    await revealControl(lesson);
    await lesson.click();
    await page.keyboard.press('Escape');
    const pages = page.locator('#tbReader .book-page-select');
    await expect(pages).toBeVisible();
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        [...document.querySelectorAll('#tbReader img')].map((image) => image.decode().catch(() => {})),
      );
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const spreads = await pages
      .locator('option')
      .evaluateAll((options) => options.map((option) => option.value));
    for (const firstUnit of [true, false]) {
      let anchor;
      for (const spread of spreads) {
        await pages.selectOption(spread);
        anchor = await page.evaluate(
          () => window.ModuleSwitcher.getTextbookModule().exportNavigation().bookAnchor,
        );
        if (anchor?.target && (firstUnit ? anchor.target.index === 0 : anchor.target.index > 0)) break;
      }
      expect(anchor?.target).toBeTruthy();
      if (firstUnit) expect(anchor.target.index).toBe(0);
      else expect(anchor.target.index).toBeGreaterThan(0);
      await openArchive(page);
      const text = await downloadArchive(page);
      const exported = JSON.parse(text);
      expect(exported.progress.vocabulary.history).toEqual([]);
      expect(exported.progress.navigation.vocab.studySession).toBeFalsy();
      expect(exported.progress.navigation.textbook.bookAnchor).toEqual(anchor);
      await upload(page, text);
      await expect(page.locator('#archivePreview')).toBeVisible();
      await expect(page.locator('#archiveRestore')).toBeEnabled();
      const validated = await page.evaluate((text) => window.JPLearn.archive.validate(text), text);
      expect(validated).toEqual(exported.progress);
      await page.locator('#archiveClose').click();
    }
  });
});

test('reading anchor ordinal validation keeps word references and recursive safety checks strict', async ({
  page,
}) => {
  await browserMode(page);
  await openReadyApp(page, { module: 'dashboard' });
  await seed(page);
  const good = await archive(page);
  good.progress.navigation.textbook = {
    bookId: 'KotobaFlow1',
    lessonId: 'lesson_01',
    bookAnchor: {
      version: 1,
      key: 'KotobaFlow1/lesson_01',
      column: 0,
      layout: '',
      content: '',
      target: { section: '课文', sectionIndex: 0, index: 0, text: '', offset: 0, end: false },
    },
  };
  expect(await page.evaluate(() => window.taxonomyManager.allWords.some((word) => word.index === 0))).toBe(
    false,
  );
  await openArchive(page);
  for (const index of [0, 10000]) {
    const data = structuredClone(good);
    data.progress.navigation.textbook.bookAnchor.target.index = index;
    await upload(page, data);
    await expect(page.locator('#archiveRestore')).toBeEnabled();
    expect(
      await page.evaluate((data) => window.JPLearn.archive.validate(JSON.stringify(data)), data),
    ).toEqual(data.progress);
  }
  const invalid = [];
  for (const index of [-1, 0.5, 10001, '0', null, [], {}]) {
    const data = structuredClone(good);
    data.progress.navigation.textbook.bookAnchor.target.index = index;
    invalid.push({ data, message: '课文书签阅读位置无效' });
  }
  const mutations = [
    [(s) => (s.vocabulary.history[0].index = 0), '旧词汇 ID'],
    [(s) => (s.vocabulary.history[0].wordIndex = 0), '旧词汇 ID'],
    [(s) => (s.vocabulary.srs[0].index = 0), 'SRS'],
    [
      (s) => (s.navigation.vocab.studySession = { version: 1, queueIndices: [0], currentIndex: 0 }),
      '旧词汇 ID',
    ],
    [(s) => (s.navigation.textbook.bookAnchor.target.wordIndex = 0), '旧词汇 ID'],
    [(s) => (s.navigation.textbook.bookAnchor.target.queueIndices = [0]), '旧词汇 ID'],
    [(s) => (s.navigation.textbook.bookAnchor.target.child = { index: 0 }), '旧词汇 ID'],
    [(s) => (s['navigation.textbook.bookAnchor.target'] = { index: 0 }), '旧词汇 ID'],
    [(s) => (s.navigation.textbook.bookAnchor.target.constructor = {}), '不安全字段'],
    [
      (s) => {
        let child = s.navigation.textbook.bookAnchor.target;
        for (let depth = 0; depth < 30; depth++) child = child.child = {};
      },
      '嵌套过深',
    ],
  ];
  for (const [mutate, message] of mutations) {
    const data = structuredClone(good);
    mutate(data.progress);
    invalid.push({ data, message });
  }
  const nonfinite = structuredClone(good);
  nonfinite.progress.navigation.textbook.bookAnchor.target.offset = 'overflow-number';
  invalid.push({
    data: JSON.stringify(nonfinite).replace('"overflow-number"', '1e400'),
    message: '数值无效',
  });
  for (const { data, message } of invalid) {
    await upload(page, data);
    await expect(page.locator('#archiveStatus')).toContainText(message);
    await expect(page.locator('#archiveRestore')).toBeDisabled();
  }
  expect((await archive(page)).progress.vocabulary).toEqual(good.progress.vocabulary);
  expect((await archive(page)).progress.plan).toEqual(good.progress.plan);
});

test('invalid files, future schemas and old IDs never enable recovery or change stored progress', async ({
  page,
}) => {
  await browserMode(page);
  await openReadyApp(page, { module: 'dashboard' });
  await seed(page);
  const good = await archive(page);
  await openArchive(page);
  const inputs = [
    'bad json',
    { ...good, archiveVersion: 999 },
    { ...good, contentVersion: 'old-catalog' },
    { ...good, progress: { ...good.progress, version: 999 } },
    {
      ...good,
      progress: { ...good.progress, vocabulary: { ...good.progress.vocabulary, known: [99999999] } },
    },
  ];
  for (const data of inputs) {
    await upload(page, data);
    await expect(page.locator('#archiveStatus')).not.toHaveText('正在处理…');
    await expect(page.locator('#archiveRestore')).toBeDisabled();
    expect((await archive(page)).progress.plan.dailyMinutes).toBe(45);
  }
});

test('merge is repeatable and preserves current plan without double-counting history or time', async ({
  page,
}) => {
  await browserMode(page);
  await openReadyApp(page, { module: 'dashboard' });
  await seed(page, 30);
  const data = await archive(page);
  data.progress.plan.dailyMinutes = 80;
  data.progress.usage['2025-01-01'] = {
    focusedMs: 10000,
    checkedIn: false,
    checkins: 0,
    firstSeenAt: '2025-01-01T00:00:00Z',
    lastSeenAt: '2025-01-01T00:00:10Z',
  };
  await restore(page, data, 'merge');
  await restore(page, data, 'merge');
  const result = (await archive(page)).progress;
  expect(result.plan.dailyMinutes).toBe(30);
  expect(result.vocabulary.history.filter((entry) => entry.id === 'archive-test-session')).toHaveLength(1);
  expect(result.usage['2025-01-01'].focusedMs).toBe(10000);
  // EXP-LEARN-04: the activity graph reads the merged usage, so it does not double-count either.
  expect(await page.evaluate(() => window.ProgressStore.getActivityGraph('2025').totals)).toEqual({
    days: 1,
    focusedMs: 10000,
    checked: 0,
  });
});

test('a storage write failure rolls back vocabulary and retains the original complete backup', async ({
  page,
}) => {
  await browserMode(page);
  await openReadyApp(page, { module: 'dashboard' });
  await seed(page, 30);
  const data = await archive(page);
  data.progress.vocabulary.known = [];
  data.progress.vocabulary.srs = [];
  data.progress.plan.dailyMinutes = 80;
  await openArchive(page);
  await upload(page, data);
  await expect(page.locator('#archiveRestore')).toBeEnabled();
  await page.locator('#archiveMode').selectOption('replace');
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException('空间不足', 'QuotaExceededError');
      return original.call(this, name, value);
    };
  }, browserKey);
  await page.locator('#archiveRestore').click();
  await expect(page.locator('#archiveStatus')).toContainText('空间不足');
  const result = await page.evaluate(() => ({
    current: window.ProgressStore.exportProgress(),
    backup: window.ProgressStore.getRestoreBackup(),
  }));
  expect(result.current.plan.dailyMinutes).toBe(30);
  expect(result.current.vocabulary.known).toEqual(result.backup.vocabulary.known);
  expect(result.current.vocabulary.known).toHaveLength(1);
});

test('API revision conflicts restore no data and keep both original copies', async ({ page }) => {
  let stored = { version: 2, revision: 0, vocabulary: {}, usage: {} };
  let reject = false;
  await page.route('**/api/progress', async (route) => {
    if (route.request().method() === 'POST') {
      if (reject) return route.fulfill({ status: 409, json: {} });
      stored = { ...route.request().postDataJSON(), revision: stored.revision + 1 };
    }
    await route.fulfill({ json: stored });
  });
  await openReadyApp(page, { module: 'dashboard' });
  await seed(page, 30);
  await page.evaluate(() => window.ProgressStore.save());
  const data = await archive(page);
  data.progress.plan.dailyMinutes = 80;
  await openArchive(page);
  await upload(page, data);
  await expect(page.locator('#archiveRestore')).toBeEnabled();
  await page.locator('#archiveMode').selectOption('replace');
  reject = true;
  await page.locator('#archiveRestore').click();
  await expect(page.locator('#archiveStatus')).toContainText('重新预览');
  expect(stored.plan.dailyMinutes).toBe(30);
  expect(await page.evaluate(() => window.ProgressStore.getPlan().dailyMinutes)).toBe(30);
  expect(await page.evaluate(() => window.ProgressStore.getRestoreBackup('remote').plan.dailyMinutes)).toBe(
    30,
  );
});

test('archive dialog fits both desktop viewports and restores focus on Escape', async ({ page }) => {
  await browserMode(page);
  await openReadyApp(page, { module: 'dashboard' });
  for (const viewport of [
    { width: 1600, height: 900 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    await openArchive(page);
    await upload(page, await archive(page));
    await expect(page.locator('#archiveRestore')).toBeEnabled();
    await expectRegionsWithinViewport(page, ['#archiveDialog']);
    await page.screenshot({ path: `local/qa/archive-${viewport.width}.png` });
    await page.keyboard.press('Escape');
    await expect(page.locator('#archiveDialog')).not.toBeVisible();
    await expect(page.locator('#appSettingsToggle')).toBeFocused();
  }
});

test('local API restoration uses the preview revision after a long preview and survives reload', async ({
  page,
}) => {
  let stored = { version: 2, revision: 0, vocabulary: {}, usage: {} };
  await page.route('**/api/progress', async (route) => {
    if (route.request().method() === 'POST') {
      expect(route.request().headers()['if-match']).toBe(String(stored.revision));
      stored = { ...route.request().postDataJSON(), revision: stored.revision + 1 };
    }
    await route.fulfill({ json: stored });
  });
  await openReadyApp(page, { module: 'dashboard' });
  await seed(page, 30);
  await page.evaluate(() => window.ProgressStore.save());
  const data = await archive(page);
  data.progress.plan.dailyMinutes = 80;
  await openArchive(page);
  await upload(page, data);
  await expect(page.locator('#archiveRestore')).toBeEnabled();
  const revision = stored.revision;
  await page.clock.install();
  await page.clock.fastForward(45000);
  expect(stored.revision).toBe(revision);
  await page.locator('#archiveMode').selectOption('replace');
  await page.locator('#archiveRestore').click();
  await expect(page.locator('#archiveReload')).toBeVisible();
  expect(stored.plan.dailyMinutes).toBe(80);
  await page.locator('#archiveReload').click();
  await expect(page.locator('#loading')).toHaveClass(/hidden/);
  expect(await page.evaluate(() => window.ProgressStore.getPlan().dailyMinutes)).toBe(80);
});

test('a second page changing the browser snapshot invalidates the import preview', async ({ page }) => {
  await browserMode(page);
  await openReadyApp(page, { module: 'dashboard' });
  await seed(page, 30);
  const data = await archive(page);
  data.progress.plan.dailyMinutes = 80;
  await openArchive(page);
  await upload(page, data);
  await expect(page.locator('#archiveRestore')).toBeEnabled();
  await page.evaluate((key) => {
    const newer = JSON.parse(localStorage.getItem(key));
    newer.plan.dailyMinutes = 60;
    localStorage.setItem(key, JSON.stringify(newer));
  }, browserKey);
  await page.locator('#archiveRestore').click();
  await expect(page.locator('#archiveStatus')).toContainText('另一页面');
  expect(
    await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).plan.dailyMinutes, browserKey),
  ).toBe(60);
});

async function leaveCommittedAnswerJournal(page) {
  await page.locator('#modBtnVocab').click();
  const ids = await page.evaluate(async () => {
    await window.ProgressStore.save();
    const words = window.taxonomyManager.allWords.slice(0, 2);
    window.appConfig.startStudySession(words, { practiceMode: 'classic' });
    await window.ProgressStore.save();
    const remove = Storage.prototype.removeItem;
    window.restoreArchiveStorage = () => {
      Storage.prototype.removeItem = remove;
    };
    Storage.prototype.removeItem = function (key) {
      if (key === 'tgv_commit_v1') throw new DOMException('Injected cleanup failure', 'SecurityError');
      return remove.call(this, key);
    };
    return words.map((word) => word.index);
  });
  await page.locator('[data-fb="known"]').click();
  await expect(page.locator('.study-save-error')).toContainText('尚未推进');
  expect(await page.evaluate(() => window.appConfig.studyMode.currentIndex)).toBe(0);
  const journal = await page.evaluate(() => localStorage.getItem('tgv_commit_v1'));
  expect(JSON.parse(journal).committed).toBe(true);
  return { ids, journal };
}

for (const mode of ['browser', 'local-api']) {
  test(`FIX-13 ${mode} import waits for journal recovery on reload and survives a second reload`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    if (mode === 'browser') await browserMode(page);
    else {
      let stored = { version: 2, revision: 0, vocabulary: {}, usage: {} };
      await page.route('**/api/progress', async (route) => {
        if (route.request().method() === 'POST') {
          expect(route.request().headers()['if-match']).toBe(String(stored.revision));
          stored = { ...route.request().postDataJSON(), revision: stored.revision + 1 };
        }
        await route.fulfill({ json: stored });
      });
    }
    await openReadyApp(page, { module: 'dashboard' });
    const { ids } = await leaveCommittedAnswerJournal(page);
    const data = await archive(page);
    data.progress.vocabulary.known = [ids[1]];
    data.progress.vocabulary.srs = [];
    data.progress.plan.dailyMinutes = 80;
    data.progress.navigation.vocab = {};
    await page.evaluate(() => window.restoreArchiveStorage());
    await openArchive(page);
    await upload(page, data);
    await expect(page.locator('#archiveStatus')).toContainText('重新加载后再导入');
    await expect(page.locator('#archiveRestore')).toBeDisabled();
    await page.reload();
    await expect(page.locator('#loading')).toHaveClass(/hidden/);
    expect(
      await page.evaluate(() => window.ProgressStore.getNavigation().vocab.studySession.currentIndex),
    ).toBe(1);
    await openArchive(page);
    await upload(page, data);
    await expect(page.locator('#archiveRestore')).toBeEnabled();
    expect(await page.evaluate(() => localStorage.getItem('tgv_commit_v1'))).toBeNull();
    await page.locator('#archiveMode').selectOption('replace');
    await page.locator('#archiveRestore').click();
    await expect(page.locator('#archiveReload')).toBeVisible();
    const backup = await page.evaluate(() => window.ProgressStore.getRestoreBackup());
    expect(backup.vocabulary.known).toEqual([ids[0]]);
    expect(backup.navigation.vocab.studySession.currentIndex).toBe(1);
    await page.locator('#archiveReload').click();
    await expect(page.locator('#loading')).toHaveClass(/hidden/);
    expect(await page.evaluate(() => window.StudyStorage.getWordsByStatus('known'))).toEqual([ids[1]]);
    expect(await page.evaluate(() => window.ProgressStore.getPlan().dailyMinutes)).toBe(80);
    expect(await page.evaluate(() => localStorage.getItem('tgv_commit_v1'))).toBeNull();
  });
}

test('FIX-13 an unresolved journal blocks archive preview without deleting its recovery data', async ({
  page,
}) => {
  await browserMode(page);
  await openReadyApp(page, { module: 'dashboard' });
  const { ids, journal } = await leaveCommittedAnswerJournal(page);
  const data = await archive(page);
  data.progress.plan.dailyMinutes = 80;
  const before = await page.evaluate((key) => localStorage.getItem(key), browserKey);
  await openArchive(page);
  await upload(page, data);
  await expect(page.locator('#archiveStatus')).toContainText('学习保存尚未恢复');
  await expect(page.locator('#archiveRestore')).toBeDisabled();
  await expect(page.locator('#archiveReload')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('tgv_commit_v1'))).toBe(journal);
  expect(await page.evaluate((key) => localStorage.getItem(key), browserKey)).toBe(before);
  expect(await page.evaluate(() => window.StudyStorage.getWordsByStatus('known'))).toEqual([ids[0]]);
  expect(await page.evaluate(() => window.ProgressStore.getRestoreBackup())).toBeNull();
});

test('FIX-13 a journal appearing after preview blocks confirmation without changing its bytes', async ({
  page,
}) => {
  await browserMode(page);
  await openReadyApp(page, { module: 'dashboard' });
  const { ids, journal } = await leaveCommittedAnswerJournal(page);
  const data = await archive(page);
  data.progress.vocabulary.known = [ids[1]];
  data.progress.vocabulary.srs = [];
  data.progress.plan.dailyMinutes = 80;
  data.progress.navigation.vocab = {};
  await page.evaluate(() => window.restoreArchiveStorage());
  await page.reload();
  await expect(page.locator('#loading')).toHaveClass(/hidden/);
  await openArchive(page);
  await upload(page, data);
  await expect(page.locator('#archiveRestore')).toBeEnabled();
  await page.locator('#archiveMode').selectOption('replace');
  // Reintroduce an actual interrupted commit after the preview was captured.
  await page.evaluate((raw) => localStorage.setItem('tgv_commit_v1', raw), journal);
  await page.locator('#archiveRestore').click();
  await expect(page.locator('#archiveStatus')).toContainText('重新加载后再导入');
  await expect(page.locator('#archiveReload')).toBeHidden();
  expect(await page.evaluate(() => window.ProgressStore.getRestoreBackup())).toBeNull();
  expect(await page.evaluate(() => window.StudyStorage.getWordsByStatus('known'))).toEqual([ids[0]]);
  expect(await page.evaluate(() => window.ProgressStore.getPlan().dailyMinutes)).toBe(10);
  expect(await page.evaluate(() => localStorage.getItem('tgv_commit_v1'))).toBe(journal);
});
