const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const vm = require('node:vm');
const { openReadyApp, openSettings, revealControl } = require('./helpers');
test.use({ serviceWorkers: 'block' });

function storageVm(initial = {}) {
  const data = new Map(Object.entries(initial));
  const events = [];
  const localStorage = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
  const context = { localStorage, console, JPLearn: { events: { emit: (name) => events.push(name) } } };
  context.window = context;
  vm.createContext(context);
  for (const file of ['js/core/srs.js', 'js/storage.js'])
    vm.runInContext(fs.readFileSync(file, 'utf8'), context);
  return { storage: context.StudyStorage, localStorage, data, events };
}

test('FIX-18 favorites and status removal confirm storage before reporting changes', () => {
  for (const [key, act, check] of [
    ['tgv_favorites', (s) => s.unfavorite(42), (s) => s.getWordStatus(42).isFavorite],
    [
      'tgv_grammar_favorites',
      (s) => s.toggleGrammarFavorite('N5-test'),
      (s) => !s.isGrammarFavorite('N5-test'),
    ],
    [
      'tgv_unknown',
      (s) => s.removeWordStatus(42, 'unknown'),
      (s) => s.getWordStatus(42).status === 'unknown',
    ],
  ]) {
    const box = storageVm({ tgv_favorites: '[42]', tgv_unknown: '[42]' });
    const before = box.storage.exportSnapshot();
    const set = box.localStorage.setItem;
    box.localStorage.setItem = (name, value) => {
      if (name === key) throw Error('injected command failure');
      return set(name, value);
    };
    expect(act(box.storage)?.status).toBe('storageError');
    expect(box.storage.exportSnapshot()).toEqual(before);
    expect(check(box.storage)).toBe(true);
    expect(box.events).not.toContain('vocabulary:changed');
    expect(box.events).toContain('storage:failed');
    box.localStorage.setItem = set;
    expect(act(box.storage).status).toBe('saved');
    expect(check(box.storage)).toBe(false);
    expect(storageVm(Object.fromEntries(box.data)).storage.exportSnapshot()).toEqual(
      box.storage.exportSnapshot(),
    );
  }
});

test('FIX-18 legacy commands reject pending journals without changing or deleting them', () => {
  const box = storageVm({ tgv_unknown: '[42]' });
  const remove = box.localStorage.removeItem;
  box.localStorage.removeItem = (key) => {
    if (key === 'tgv_commit_v1') throw Error('cleanup failed');
    return remove(key);
  };
  expect(box.storage.markWord(42, 'known', { id: 'pending-answer' }).status).toBe('storageError');
  const before = Object.fromEntries(box.data);
  box.localStorage.removeItem = remove;
  for (const act of [
    () => box.storage.unfavorite(42),
    () => box.storage.toggleGrammarFavorite('N5-test'),
    () => box.storage.clearAll(),
    () => box.storage.removeWordStatus(42, 'known'),
    () => box.storage.markWord(42, 'favorite'),
  ]) {
    expect(act()?.status).toBe('storageError');
    expect(Object.fromEntries(box.data)).toEqual(before);
  }
  expect(box.events).not.toContain('vocabulary:changed');
  const reopened = storageVm(before);
  expect(reopened.storage.getWordStatus(42).status).toBe('known');
  expect(reopened.storage.clearAll().status).toBe('saved');
  expect(reopened.storage.getWordStatus(42).status).toBe('none');
});

test('FIX-18 clear is recoverable at every write stage and never partially reports success', () => {
  const initial = { tgv_known: '[42]', tgv_favorites: '[42]', tgv_history: '[{"id":"old","total":1}]' };
  for (const key of ['tgv_known', 'tgv_favorites', 'tgv_history', 'tgv_commit_v1']) {
    const box = storageVm(initial);
    const before = box.storage.exportSnapshot();
    const set = box.localStorage.setItem;
    box.localStorage.setItem = (name, value) => {
      if (name === key) throw Error('clear write failed');
      return set(name, value);
    };
    expect(box.storage.clearAll()?.status).toBe('storageError');
    expect(box.storage.exportSnapshot()).toEqual(before);
    expect(box.events).not.toContain('vocabulary:changed');
    expect(box.events).not.toContain('study:cleared');
  }
  const box = storageVm(initial);
  const stages = [];
  const set = box.localStorage.setItem;
  box.localStorage.setItem = (key, value) => {
    set(key, value);
    stages.push(Object.fromEntries(box.data));
  };
  expect(box.storage.clearAll().status).toBe('saved');
  expect(box.events).toEqual(['study:cleared', 'vocabulary:changed']);
  expect(stages.length).toBeGreaterThan(3);
  for (const bytes of stages) {
    const committed = JSON.parse(bytes.tgv_commit_v1).committed;
    const reopened = storageVm(bytes);
    expect(reopened.storage.getWordsByStatus('known')).toEqual(committed ? [] : [42]);
    expect(reopened.storage.getWordsByStatus('favorite')).toEqual(committed ? [] : [42]);
    expect(reopened.storage.getHistory()).toHaveLength(committed ? 0 : 1);
  }
});

test('FIX-18 uncertain clear blocks stale live answers until recovery on reload', () => {
  const box = storageVm({ tgv_known: '[42]' });
  const remove = box.localStorage.removeItem;
  box.localStorage.removeItem = (key) => {
    if (key === 'tgv_commit_v1') throw Error('clear cleanup failed');
    return remove(key);
  };
  expect(box.storage.clearAll()?.status).toBe('storageError');
  const pending = Object.fromEntries(box.data);
  box.localStorage.removeItem = remove;
  expect(box.storage.markWord(42, 'unknown', { id: 'stale-answer' }).status).toBe('storageError');
  expect(box.storage.saveSession({ id: 'stale-history', total: 1 }).status).toBe('storageError');
  expect(Object.fromEntries(box.data)).toEqual(pending);
  expect(storageVm(pending).storage.getWordsByStatus('known')).toEqual([]);
});

test('FIX-18 removing a study status removes its review schedule in the same commit', () => {
  const box = storageVm();
  box.storage.markWord(42, 'unknown');
  box.storage.markWord(43, 'known');
  expect(box.storage.removeWordStatus(42, 'unknown').status).toBe('saved');
  expect(box.storage.getWordStatus(42).status).toBe('none');
  expect(box.storage.getSrsRecords().map((row) => row.index)).toEqual([43]);
});

for (const completed of [false, true]) {
  test(`FIX-18 real clear preserves plan and time but discards ${completed ? 'completed' : 'unfinished'} checkpoints`, async ({
    page,
  }) => {
    const width = completed ? 1280 : 1600;
    await page.setViewportSize({ width, height: completed ? 720 : 900 });
    await browserStorageFault(page);
    const before = await page.evaluate((done) => {
      const words = taxonomyManager.allWords.slice(0, done ? 1 : 2);
      StudyStorage.markWord(words[0].index, 'favorite');
      StudyStorage.toggleGrammarFavorite('settings-danger-test');
      appConfig.startStudySession(words, { practiceMode: 'classic' });
      return ProgressStore.exportProgress();
    }, completed);
    await page.locator('[data-fb="known"]').click();
    const beforeFailure = await page.evaluate(() => ({
      snapshot: StudyStorage.exportSnapshot(),
      session: appConfig.studyMode.exportCheckpoint(),
    }));
    await openSettings(page);
    await page.locator('.app-settings-danger summary').click();
    await page.evaluate(() => localStorage.setItem('test.failureKey', 'tgv_known'));
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#appClearStudyData').click();
    await expect(page.locator('#appClearStudyDataStatus')).toContainText('未确认');
    await expect
      .poll(() =>
        page.locator('#appClearStudyDataStatus').evaluate((el) => {
          const rect = el.getBoundingClientRect();
          const panel = el.closest('#appSettingsPanel').getBoundingClientRect();
          return rect.top >= panel.top && rect.bottom <= Math.min(innerHeight, panel.bottom);
        }),
      )
      .toBe(true);
    await page.screenshot({ path: `local/qa/batch1-2026-10-07/storage/clear-failure-${width}.png` });
    expect(await page.evaluate(() => StudyStorage.exportSnapshot())).toEqual(beforeFailure.snapshot);
    expect(await page.evaluate(() => appConfig.studyMode.exportCheckpoint())).toEqual(beforeFailure.session);
    await page.evaluate(() => localStorage.removeItem('test.failureKey'));
    page.once('dialog', (dialog) => {
      expect(dialog.message()).toContain('学习计划');
      return dialog.accept();
    });
    await page.locator('#appClearStudyData').click();
    await expect(page.locator('#appClearStudyDataStatus')).toHaveText('学习记录已清空');
    await expect
      .poll(() =>
        page.locator('#appClearStudyDataStatus').evaluate((el) => {
          const rect = el.getBoundingClientRect();
          const panel = el.closest('#appSettingsPanel').getBoundingClientRect();
          return rect.top >= panel.top && rect.bottom <= Math.min(innerHeight, panel.bottom);
        }),
      )
      .toBe(true);
    await page.screenshot({ path: `local/qa/batch1-2026-10-07/storage/clear-success-${width}.png` });
    const after = await page.evaluate(() => ({
      progress: ProgressStore.exportProgress(),
      session: appConfig.studyMode.exportCheckpoint(),
    }));
    expect(after.session).toBeNull();
    expect(after.progress.vocabulary.known).toEqual([]);
    expect(after.progress.vocabulary.favorite).toEqual([]);
    expect(after.progress.vocabulary.grammarFavorite).toEqual([]);
    expect(after.progress.vocabulary.history).toEqual([]);
    expect(after.progress.vocabulary.srs).toEqual([]);
    expect(after.progress.navigation.vocab.studySession).toBeNull();
    expect(after.progress.plan).toEqual(before.plan);
    expect(Object.keys(after.progress.usage)).toEqual(Object.keys(before.usage));
    for (const day of Object.keys(before.usage))
      expect(after.progress.usage[day].focusedMs).toBeGreaterThanOrEqual(before.usage[day].focusedMs);
    await page.goto('/');
    await expect(page.locator('#loading')).toHaveClass(/hidden/);
    expect(await page.evaluate(() => StudyStorage.getHistory())).toEqual([]);
    expect(await page.evaluate(() => appConfig.studyMode.exportCheckpoint())).toBeNull();
    // A location-only resume may remain because reading/navigation is preserved.
    const resume = page.locator('[data-dashboard-action="resume"]');
    if (await resume.count()) await resume.click();
    expect(await page.evaluate(() => appConfig.studyMode.exportCheckpoint())).toBeNull();
    expect(await page.evaluate(() => StudyStorage.getHistory())).toEqual([]);
  });
}

test('FIX-18 real favorite buttons preserve their confirmed appearance and retry after quota errors', async ({
  page,
}) => {
  await browserStorageFault(page);
  await page.locator('#modBtnGrammar').click();
  const grammar = page.locator('.gm-card-fav').first();
  const uid = await grammar.getAttribute('data-grammar-fav');
  await page.evaluate(() => localStorage.setItem('test.failureKey', 'tgv_grammar_favorites'));
  await grammar.click();
  await expect(grammar).not.toHaveClass(/active/);
  expect(await page.evaluate((id) => StudyStorage.isGrammarFavorite(id), uid)).toBe(false);
  await expect(page.locator('#progressSyncStatus')).toContainText('保存未确认');
  await page.evaluate(() => localStorage.removeItem('test.failureKey'));
  await grammar.click();
  await expect(grammar).toHaveClass(/active/);
  await page.locator('#modBtnVocab').click();
  const index = await page.evaluate(() => {
    const word = taxonomyManager.allWords[0];
    StudyStorage.markWord(word.index, 'favorite');
    detailPanel.showNode({ type: 'word', rawData: word });
    return word.index;
  });
  const favorite = page.locator('#detailBtnFavorite');
  await expect(favorite).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => localStorage.setItem('test.failureKey', 'tgv_favorites'));
  await favorite.click();
  await expect(favorite).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate((id) => StudyStorage.getWordStatus(id).isFavorite, index)).toBe(true);
  await page.evaluate(() => localStorage.removeItem('test.failureKey'));
  await favorite.click();
  expect(await page.evaluate((id) => StudyStorage.getWordStatus(id).isFavorite, index)).toBe(false);
  await page.reload();
  await expect(page.locator('#loading')).toHaveClass(/hidden/);
  expect(await page.evaluate((id) => StudyStorage.getWordStatus(id).isFavorite, index)).toBe(false);
  expect(await page.evaluate((id) => StudyStorage.isGrammarFavorite(id), uid)).toBe(true);
});

test('FIX-18 a delayed local API save cannot restore records after a real clear', async ({ page }) => {
  let stored = { version: 2, revision: 0, vocabulary: {}, usage: {} };
  let hold = false;
  let release;
  await page.route('**/api/progress', async (route) => {
    if (route.request().method() === 'POST') {
      const submitted = route.request().postDataJSON();
      if (hold) {
        hold = false;
        await new Promise((resolve) => {
          release = resolve;
        });
      }
      expect(route.request().headers()['if-match']).toBe(String(stored.revision));
      stored = { ...submitted, revision: stored.revision + 1 };
    }
    await route.fulfill({ json: stored });
  });
  await openReadyApp(page);
  await page.evaluate(() => ProgressStore.save());
  hold = true;
  await page.evaluate(() => {
    StudyStorage.markWord(42, 'known');
    ProgressStore.save();
  });
  await expect.poll(() => !!release).toBe(true);
  await openSettings(page);
  await page.locator('.app-settings-danger summary').click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#appClearStudyData').click();
  await expect(page.locator('#appClearStudyDataStatus')).toHaveText('学习记录已清空');
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('jp_learning_progress_offline_v1')).vocabulary.known,
    ),
  ).toEqual([]);
  release();
  await expect.poll(() => stored.vocabulary.known).toEqual([]);
  await page.reload();
  await expect(page.locator('#loading')).toHaveClass(/hidden/);
  expect(await page.evaluate(() => StudyStorage.getWordsByStatus('known'))).toEqual([]);
});

test('FIX-18 a first failed batch favorite stops and keeps its menu consistent', async ({ page }) => {
  await browserStorageFault(page);
  const toggle = page.locator('#ccBatchToggle');
  await revealControl(toggle);
  await toggle.click();
  await page.evaluate(() => {
    localStorage.setItem('test.failureKey', 'tgv_favorites');
    window.failedFavoriteWrites = 0;
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'tgv_favorites') window.failedFavoriteWrites++;
      return set.call(this, key, value);
    };
  });
  await page.locator('[data-batch="fav-page"]').click();
  expect(await page.evaluate(() => window.failedFavoriteWrites)).toBe(1);
  expect(await page.evaluate(() => StudyStorage.getWordsByStatus('favorite'))).toEqual([]);
  await expect(page.locator('#ccBatchMenu')).toHaveClass(/open/);
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(await page.evaluate(() => appConfig.cardMode._batchMenuOpen)).toBe(true);
  await toggle.click();
  await expect(page.locator('#ccBatchMenu')).not.toHaveClass(/open/);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test('FIX-05 cache hydration rolls back failures and recovers every journal stage', () => {
  const source = { known: [42], favorite: [42], history: [{ id: 'kept', total: 1 }] };
  for (const key of ['tgv_known', 'tgv_unknown', 'tgv_history', 'tgv_srs', 'tgv_commit_v1']) {
    const box = storageVm({ tgv_unknown: '[77]' });
    const before = Object.fromEntries(box.data);
    const set = box.localStorage.setItem;
    box.localStorage.setItem = (name, value) => {
      if (name === key) throw Error('injected hydration failure');
      set(name, value);
    };
    expect(box.storage.importSnapshot(source).status).toBe('storageError');
    expect(Object.fromEntries(box.data)).toEqual(before);
  }
  const box = storageVm({ tgv_unknown: '[77]' });
  const stages = [];
  const set = box.localStorage.setItem;
  box.localStorage.setItem = (key, value) => {
    set(key, value);
    stages.push(Object.fromEntries(box.data));
  };
  expect(box.storage.importSnapshot(source).status).toBe('saved');
  for (const bytes of stages) {
    const committed = JSON.parse(bytes.tgv_commit_v1).committed;
    const restored = storageVm(bytes);
    expect(restored.storage.getWordsByStatus('known')).toEqual(committed ? [42] : []);
    expect(restored.storage.getWordsByStatus('unknown')).toEqual(committed ? [] : [77]);
    expect(restored.storage.getHistory()).toEqual(committed ? source.history : []);
  }
});

for (const mode of ['browser', 'local-api']) {
  for (const failureKey of ['tgv_known', 'tgv_srs']) {
    test(`FIX-05 ${mode} hydration failure at ${failureKey} preserves the source through reload`, async ({
      page,
    }) => {
      const source = {
        version: 2,
        revision: 0,
        vocabulary: { known: [42], history: [{ id: 'kept', total: 1 }] },
        usage: {},
      };
      let posts = 0;
      await page.route('**/api/progress', (route) => {
        if (route.request().method() === 'POST') posts++;
        return route.fulfill({ json: source });
      });
      await page.route('**/js/storage-config.js*', (route) =>
        route.fulfill({
          contentType: 'application/javascript',
          body: `window.JPLearnStorageConfig = { mode: '${mode}' };`,
        }),
      );
      await page.addInitScript(
        ({ source, mode, failureKey }) => {
          if (!localStorage.getItem('test.hydrated')) {
            localStorage.setItem('test.hydrated', '1');
            localStorage.setItem('test.failureKey', failureKey);
            if (mode === 'browser')
              localStorage.setItem('jp_learning_progress_browser_v1', JSON.stringify(source));
          }
          const set = Storage.prototype.setItem;
          Storage.prototype.setItem = function (key, value) {
            if (key === localStorage.getItem('test.failureKey'))
              throw new DOMException('Injected quota', 'QuotaExceededError');
            return set.call(this, key, value);
          };
        },
        { source, mode, failureKey },
      );
      await openReadyApp(page, { module: 'dashboard' });
      await expect(page.locator('#progressSyncStatus')).toContainText('恢复学习记录失败');
      await page.locator('[data-dashboard-action="open-plan"]').first().click();
      await page.locator('#dashboardPlanMinutes').fill('50');
      await page.locator('[data-dashboard-plan-form] button[type="submit"]').click();
      expect(await page.evaluate(() => StudyStorage.markWord(42, 'unknown').status)).toBe('storageError');
      await page.evaluate(() => ProgressStore.save());
      expect(posts).toBe(0);
      expect(await page.evaluate(() => ProgressStore.exportProgress().vocabulary.known)).toEqual([42]);
      if (mode === 'browser')
        expect(await page.evaluate(() => localStorage.getItem('jp_learning_progress_browser_v1'))).toBe(
          JSON.stringify(source),
        );
      else
        expect(await page.evaluate(() => localStorage.getItem('jp_learning_progress_offline_v1'))).toBeNull();
      await page.evaluate(() => localStorage.removeItem('test.failureKey'));
      await page.reload();
      await expect(page.locator('#loading')).toHaveClass(/hidden/);
      expect(await page.evaluate(() => StudyStorage.getWordsByStatus('known'))).toEqual([42]);
      expect(await page.evaluate(() => StudyStorage.getHistory())).toEqual(source.vocabulary.history);
      expect(await page.evaluate(() => StudyStorage.getSrsRecords()[0].index)).toBe(42);
    });
  }
}

for (const key of ['tgv_known', 'tgv_unknown', 'tgv_srs', 'tgv_commit_v1']) {
  test(`FIX-03 ordinary marking preserves the confirmed state when ${key} fails`, () => {
    const box = storageVm({ tgv_unknown: '[42]' });
    const before = box.storage.exportSnapshot();
    const original = box.localStorage.setItem;
    box.localStorage.setItem = (name, value) => {
      if (name === key) throw Error('injected quota');
      original(name, value);
    };
    expect(box.storage.markWord(42, 'known').status).toBe('storageError');
    expect(box.storage.exportSnapshot()).toEqual(before);
    expect(box.events).not.toContain('vocabulary:changed');
    box.localStorage.setItem = original;
    expect(box.storage.markWord(42, 'known').status).toBe('saved');
    expect(box.storage.getSrsRecords()[0]).toMatchObject({ index: 42, reviewCount: 1, lastResult: 'known' });
    expect(storageVm(Object.fromEntries(box.data)).storage.getWordStatus(42).status).toBe('known');
  });
}

test('FIX-03 a transient read error cannot turn existing history into an empty commit', () => {
  const box = storageVm({ tgv_unknown: '[42]', tgv_history: '[{"id":"older","total":1}]' });
  const before = Object.fromEntries(box.data);
  const get = box.localStorage.getItem;
  let fail = true;
  box.localStorage.getItem = (key) => {
    if (key === 'tgv_history' && fail) {
      fail = false;
      throw Error('injected read');
    }
    return get(key);
  };
  expect(box.storage.markWord(42, 'known').status).toBe('storageError');
  expect(Object.fromEntries(box.data)).toEqual(before);
  expect(box.storage.markWord(42, 'known').status).toBe('saved');
  expect(box.storage.getHistory()).toEqual([{ id: 'older', total: 1 }]);
});

test('FIX-03 interruption at every journal stage recovers an entire old or committed answer', () => {
  const box = storageVm({ tgv_unknown: '[42]' });
  const stages = [];
  const set = box.localStorage.setItem;
  box.localStorage.setItem = (key, value) => {
    set(key, value);
    stages.push(Object.fromEntries(box.data));
  };
  expect(box.storage.markWord(42, 'known').status).toBe('saved');
  expect(stages.length).toBeGreaterThan(5);
  for (const bytes of stages) {
    const committed = JSON.parse(bytes.tgv_commit_v1).committed;
    const restarted = storageVm(bytes);
    expect(restarted.storage.getWordStatus(42).status).toBe(committed ? 'known' : 'unknown');
    expect(restarted.storage.getSrsRecords()).toHaveLength(committed ? 1 : 0);
    expect(restarted.data.has('tgv_commit_v1')).toBe(false);
  }
});

test('FIX-03 a committed but unacknowledged answer is verified before retry, without a second review', () => {
  const box = storageVm({ tgv_unknown: '[42]' });
  const remove = box.localStorage.removeItem;
  box.localStorage.removeItem = (key) => {
    if (key === 'tgv_commit_v1') throw Error('injected cleanup');
    remove(key);
  };
  expect(box.storage.markWord(42, 'known', { id: 'session:0' }).status).toBe('storageError');
  expect(box.storage.isWriteBlocked()).toBe(true);
  box.localStorage.removeItem = remove;
  expect(box.storage.markWord(42, 'known', { id: 'session:0' }).status).toBe('alreadySaved');
  expect(box.storage.getSrsRecords()[0].reviewCount).toBe(1);
  expect(box.storage.isWriteBlocked()).toBe(false);
});

test('FIX-03 session history distinguishes empty, failed, saved and duplicate outcomes', () => {
  const box = storageVm();
  expect(box.storage.saveSession({ total: 0 }).status).toBe('empty');
  const set = box.localStorage.setItem;
  box.localStorage.setItem = (key, value) => {
    if (key === 'tgv_history') throw Error('injected history');
    set(key, value);
  };
  expect(box.storage.saveSession({ id: 'one', total: 1 }).status).toBe('storageError');
  expect(box.storage.getHistory()).toHaveLength(0);
  box.localStorage.setItem = set;
  expect(box.storage.saveSession({ id: 'one', total: 1 }).status).toBe('saved');
  expect(box.storage.saveSession({ id: 'one', total: 1 }).status).toBe('alreadySaved');
  expect(box.storage.getHistory()).toHaveLength(1);
});

async function browserStorageFault(page) {
  await page.route('**/js/storage-config.js*', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: "window.JPLearnStorageConfig = { mode: 'browser' };",
    }),
  );
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === localStorage.getItem('test.failureKey'))
        throw new DOMException('Injected failure', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await openReadyApp(page);
}

test('FIX-03 browser reopening resolves interrupted vocabulary and checkpoint together', async ({
  page,
  browser,
}) => {
  await browserStorageFault(page);
  await page.evaluate(() => {
    const words = taxonomyManager.allWords.slice(0, 2);
    StudyStorage.markWord(words[0].index, 'unknown');
    appConfig.startStudySession(words, { practiceMode: 'classic' });
    const original = Storage.prototype.setItem;
    window.commitStages = {};
    Storage.prototype.setItem = function (key, value) {
      const result = original.call(this, key, value);
      const stage =
        key === 'jp_learning_progress_browser_v1' && localStorage.getItem('tgv_commit_v1')
          ? 'prepared'
          : key === 'tgv_commit_v1' && JSON.parse(value).committed
            ? 'committed'
            : '';
      if (stage)
        window.commitStages[stage] = Object.fromEntries(
          Object.values(StudyStorage.KEYS)
            .concat(['tgv_commit_v1', 'jp_learning_progress_browser_v1'])
            .map((k) => [k, localStorage.getItem(k)]),
        );
      return result;
    };
  });
  await page.locator('[data-fb="known"]').click();
  const stages = await page.evaluate(() => window.commitStages);
  for (const [stage, bytes] of Object.entries(stages)) {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.addInitScript((data) => {
      for (const [key, value] of Object.entries(data)) if (value !== null) localStorage.setItem(key, value);
    }, bytes);
    const reopened = await context.newPage();
    await reopened.route('**/js/storage-config.js*', (route) =>
      route.fulfill({
        contentType: 'application/javascript',
        body: "window.JPLearnStorageConfig = { mode: 'browser' };",
      }),
    );
    await reopened.goto('/');
    await expect(reopened.locator('[data-dashboard-action="resume"]')).toBeVisible();
    await reopened.locator('[data-dashboard-action="resume"]').click();
    await expect(reopened.locator('#flashcard')).toBeVisible();
    expect(await reopened.evaluate(() => appConfig.studyMode.currentIndex)).toBe(
      stage === 'committed' ? 1 : 0,
    );
    expect(
      await reopened.evaluate(() => StudyStorage.getWordStatus(appConfig.studyMode.queue[0].index).status),
    ).toBe(stage === 'committed' ? 'known' : 'unknown');
    expect(await reopened.evaluate(() => localStorage.getItem('tgv_commit_v1'))).toBeNull();
    await context.close();
  }
  expect(Object.keys(stages).sort()).toEqual(['committed', 'prepared']);
});

for (const key of ['tgv_known', 'tgv_srs', 'jp_learning_progress_browser_v1']) {
  test(`FIX-03 real answer waits for ${key}, retries once, and reloads the same checkpoint`, async ({
    page,
  }) => {
    await browserStorageFault(page);
    const id = await page.evaluate(() => {
      const words = taxonomyManager.allWords.slice(0, 2);
      StudyStorage.markWord(words[0].index, 'unknown');
      appConfig.startStudySession(words, { practiceMode: 'mixed' });
      return words[0].index;
    });
    const correct = await page.evaluate(() =>
      appConfig.studyMode.currentExercise.options.findIndex((o) => o.correct),
    );
    await page.locator('.practice-option').nth(correct).click();
    await page.evaluate((key) => localStorage.setItem('test.failureKey', key), key);
    await page.locator('#btnPracticeNext').click();
    await expect(page.locator('.study-save-error')).toContainText('尚未推进');
    expect(await page.evaluate(() => appConfig.studyMode.currentIndex)).toBe(0);
    expect(await page.evaluate((id) => StudyStorage.getWordStatus(id).status, id)).toBe('unknown');
    await page.evaluate(() => localStorage.removeItem('test.failureKey'));
    await page.locator('#btnRetryAnswer').dblclick();
    await expect(page.locator('.study-save-error')).toHaveCount(0);
    expect(await page.evaluate(() => appConfig.studyMode.currentIndex)).toBe(1);
    expect(
      await page.evaluate((id) => StudyStorage.getSrsRecords().find((r) => r.index === id).reviewCount, id),
    ).toBe(2);
    await page.goto('/');
    await expect(page.locator('[data-dashboard-action="resume"]')).toBeVisible();
    await page.locator('[data-dashboard-action="resume"]').click();
    await expect(page.locator('.practice-card')).toBeVisible();
    expect(await page.evaluate(() => appConfig.studyMode.currentIndex)).toBe(1);
    expect(await page.evaluate(() => appConfig.studyMode.sessionStats.known)).toBe(1);
    expect(await page.evaluate((id) => StudyStorage.getWordStatus(id).status, id)).toBe('known');
  });
}

test('FIX-03 history failure remains unsaved after reopening and can be retried from the result', async ({
  page,
}) => {
  await browserStorageFault(page);
  await page.evaluate(() => {
    appConfig.startStudySession(taxonomyManager.allWords.slice(0, 1), { practiceMode: 'classic' });
    localStorage.setItem('test.failureKey', 'tgv_history');
  });
  await page.locator('[data-fb="known"]').click();
  await expect(page.locator('.study-complete')).toContainText('会话历史保存失败');
  await expect(page.locator('.study-complete')).not.toContainText('结果已经保存');
  await expect(page.locator('.study-complete')).not.toContainText('结果已独立保存');
  expect(await page.evaluate(() => appConfig.studyMode.sessionSaved)).toBe(false);
  expect(await page.evaluate(() => StudyStorage.getHistory())).toEqual([]);
  await page.goto('/');
  await expect(page.locator('[data-dashboard-action="resume"]')).toBeVisible();
  await page.locator('[data-dashboard-action="resume"]').click();
  await expect(page.locator('#btnRetrySessionSave')).toBeVisible();
  expect(await page.evaluate(() => appConfig.studyMode.sessionSaved)).toBe(false);
  await page.screenshot({ path: 'local/qa/fix-learning-2026-09-21/history-retry-1600.png' });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ path: 'local/qa/fix-learning-2026-09-21/history-retry-1280.png' });
  await page.evaluate(() => localStorage.removeItem('test.failureKey'));
  await page.locator('#btnRetrySessionSave').click();
  await expect(page.locator('#btnRetrySessionSave')).toHaveCount(0);
  expect(await page.evaluate(() => StudyStorage.getHistory().length)).toBe(1);
  expect(await page.evaluate(() => StudyStorage.getSrsRecords()[0].reviewCount)).toBe(1);
  expect(await page.evaluate(() => appConfig.studyMode.sessionSaved)).toBe(true);
});

test('FIX-27 hydration journals only changed keys and needs no spare quota when unchanged', () => {
  const box = storageVm();
  for (const [index, status] of [
    [1, 'known'],
    [2, 'fuzzy'],
    [3, 'unknown'],
    [4, 'favorite'],
  ])
    expect(box.storage.markWord(index, status).status).toBe('saved');
  expect(box.storage.saveSession({ id: 'kept', total: 1 }).status).toBe('saved');
  const source = JSON.parse(JSON.stringify(box.storage._snapshotForCommit()));
  const before = Object.fromEntries(box.data);
  const set = box.localStorage.setItem;
  box.localStorage.setItem = () => {
    throw Error('injected full quota');
  };
  expect(box.storage.importSnapshot(source).status).toBe('saved');
  expect(Object.fromEntries(box.data)).toEqual(before);
  expect(box.storage.isWriteBlocked()).toBe(false);

  const journals = [];
  box.localStorage.setItem = (key, value) => {
    if (key === 'tgv_commit_v1') journals.push(JSON.parse(value));
    set(key, value);
  };
  expect(box.storage.importSnapshot({ ...source, favorite: [4, 5] }).status).toBe('saved');
  expect(journals.length).toBeGreaterThan(0);
  for (const record of journals) expect(record.entries.map((entry) => entry.key)).toEqual(['tgv_favorites']);
  expect(box.storage.getWordsByStatus('favorite')).toEqual([4, 5]);
  expect(box.storage.getHistory()).toEqual(source.history);
});

test('FIX-27 an unchanged startup cache stays writable when the journal key is out of quota', async ({
  page,
}) => {
  // Own progress file: earlier tests' local-API saves to the shared test server
  // must not add their words to the startup cache this test compares.
  let stored = { version: 2, revision: 0, vocabulary: {}, usage: {} };
  await page.route('**/api/progress', async (route) => {
    if (route.request().method() === 'POST')
      stored = { ...route.request().postDataJSON(), revision: stored.revision + 1 };
    await route.fulfill({ json: stored });
  });
  await page.addInitScript(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'tgv_commit_v1' && this.getItem('test.blockCommit'))
        throw new DOMException('Injected quota', 'QuotaExceededError');
      return set.call(this, key, value);
    };
  });
  await openReadyApp(page, { module: 'dashboard' });
  expect(await page.evaluate(() => StudyStorage.markWord(42, 'known').status)).toBe('saved');
  await page.evaluate(() => ProgressStore.save());
  await page.evaluate(() => localStorage.setItem('test.blockCommit', '1'));
  await page.reload();
  await expect(page.locator('#loading')).toHaveClass(/hidden/);
  await expect(page.locator('#progressSyncStatus')).not.toContainText('恢复学习记录失败');
  expect(await page.evaluate(() => StudyStorage.getWordsByStatus('known'))).toEqual([42]);
  await page.evaluate(() => localStorage.removeItem('test.blockCommit'));
  expect(await page.evaluate(() => StudyStorage.markWord(43, 'known').status)).toBe('saved');
  await page.evaluate(() => ProgressStore.save());
  await page.reload();
  await expect(page.locator('#loading')).toHaveClass(/hidden/);
  expect(await page.evaluate(() => StudyStorage.getWordsByStatus('known'))).toEqual([42, 43]);
});
