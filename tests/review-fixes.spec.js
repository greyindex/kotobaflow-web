const { test, expect } = require('@playwright/test');
const { openReadyApp, revealControl } = require('./helpers');
const { useAudioFixtures } = require('./audio-fixtures');

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => {
  await page.route('**/js/storage-config.js*', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: "window.JPLearnStorageConfig = { mode: 'browser' };",
    }),
  );
});

test('MERGE-01 dialogue gaps preserve zero and default only invalid duration values', async ({ page }) => {
  const gaps = [0, undefined, null, -1, 'invalid', '0.3', 0.25];
  const audioRoot = '/data/gemini38_flash_tts_dialogue_sections_candidate_v1/';
  const rows = gaps.map((gap, index) => ({
    status: 'ok',
    book: 'XinBian1',
    lesson_id: `lesson_${String(index + 1).padStart(2, '0')}`,
    section_key: 'conversation',
    manifest: `${audioRoot}merge-gap-${index}.json`,
    turn_gap_sec: gap,
  }));
  await page.route(`**${audioRoot}manifest.jsonl*`, (route) =>
    route.fulfill({
      contentType: 'application/x-ndjson',
      body: rows.map((row) => JSON.stringify(row)).join('\n'),
    }),
  );
  await page.route(`**${audioRoot}merge-gap-*.json*`, (route) =>
    route.fulfill({ json: [{ duration_sec: 1 }, { duration_sec: 2 }] }),
  );
  const errors = await openReadyApp(page, { module: 'dashboard' });
  const actual = await page.evaluate(
    (rows) =>
      Promise.all(
        rows.map(async (row) => {
          const timing = await TextbookLoader.getDialogueTiming(row.book, row.lesson_id, row.section_key);
          return { count: timing.turns.length, gap: timing.gap };
        }),
      ),
    rows,
  );
  expect(actual).toEqual([0, 0.55, 0.55, 0.55, 0.55, 0.3, 0.25].map((gap) => ({ count: 2, gap })));
  expect(errors).toEqual([]);
});

test('FIX-06 a 201-word classic selection advances once per answer and reloads within the archive limit', async ({
  page,
}) => {
  await openReadyApp(page);
  const ids = await page.evaluate(() => {
    const words = taxonomyManager.allWords.slice(0, 201);
    appConfig.startStudySession(words, { practiceMode: 'classic' });
    return words.slice(0, 2).map((w) => w.index);
  });
  await expect(page.locator('.practice-notice')).toContainText('前 200 词（共 201 词）');
  await page.locator('[data-fb="known"]').dblclick();
  expect(await page.evaluate(() => appConfig.studyMode.currentIndex)).toBe(1);
  await page.locator('[data-fb="known"]').click();
  expect(await page.evaluate(() => appConfig.studyMode.currentIndex)).toBe(2);
  expect(
    await page.evaluate(
      (ids) => ids.map((id) => StudyStorage.getSrsRecords().find((r) => r.index === id).reviewCount),
      ids,
    ),
  ).toEqual([1, 1]);
  await page.goto('/');
  await page.locator('[data-dashboard-action="resume"]').click();
  await expect(page.locator('#flashcard')).toBeVisible();
  expect(
    await page.evaluate(() => ({
      count: appConfig.studyMode.queue.length,
      position: appConfig.studyMode.currentIndex,
      results: appConfig.studyMode.sessionResults.length,
    })),
  ).toEqual({ count: 200, position: 2, results: 2 });
  for (const width of [1600, 1280]) {
    await page.setViewportSize({ width, height: width === 1600 ? 900 : 720 });
    await page.screenshot({ path: `local/qa/fix-review-2026-09-21/queue-${width}.png` });
  }
});

test('FIX-06 a 201-word errorbook uses real review controls and commits the next checkpoint', async ({
  page,
}) => {
  await openReadyApp(page);
  const id = await page.evaluate(() => {
    const words = taxonomyManager.allWords.slice(0, 201);
    StudyStorage.importSnapshot({ unknown: words.map((w) => w.index) });
    ViewMode.set('study');
    appConfig.applyFilters();
    return words[0].index;
  });
  await page.locator('[data-review="unknown"]').click();
  await page.locator('#btnReviewStart').click();
  const correct = await page.evaluate(() =>
    appConfig.studyMode.currentExercise.options.findIndex((o) => o.correct),
  );
  await page.locator('.practice-option').nth(correct).click();
  await page.locator('#btnPracticeNext').click();
  expect(await page.evaluate(() => appConfig.studyMode.currentIndex)).toBe(1);
  expect(
    await page.evaluate((id) => StudyStorage.getSrsRecords().find((r) => r.index === id).reviewCount, id),
  ).toBe(2);
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('jp_learning_progress_browser_v1')).navigation.vocab.studySession
          .queueIndices.length,
    ),
  ).toBe(200);
});

for (const practiceMode of ['classic', 'mixed']) {
  test(`FIX-07 ${practiceMode} shortcuts ignore hidden modules, overlays, modifiers and composition`, async ({
    page,
  }) => {
    await openReadyApp(page);
    await page.evaluate(
      (practiceMode) => appConfig.startStudySession(taxonomyManager.allWords.slice(0, 5), { practiceMode }),
      practiceMode,
    );
    for (const button of ['#modBtnGrammar', '#modBtnLesson', '#modBtnDashboard']) {
      await page.locator(button).click();
      await page.keyboard.press('Digit1');
      await page.keyboard.press('Space');
      await page.keyboard.press('Enter');
      expect(
        await page.evaluate(() => ({
          position: appConfig.studyMode.currentIndex,
          feedback: appConfig.studyMode.exerciseFeedback,
          flipped: appConfig.studyMode.isFlipped,
        })),
      ).toEqual({ position: 0, feedback: null, flipped: false });
    }
    await page.locator('#modBtnVocab').click();
    await revealControl(page.locator('#globalSearchToggle'));
    await page.locator('#globalSearchToggle').click();
    await page.locator('#globalSearchInput').fill('1 2');
    await page.keyboard.press('Digit1');
    await page.keyboard.press('Escape');
    await revealControl(page.locator(practiceMode === 'classic' ? '#flashcard' : '.practice-card'));
    await page.locator('#modBtnVocab').focus();
    await page.keyboard.press('Control+Digit1');
    await page.evaluate(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { code: 'Digit1', key: '1', isComposing: true, bubbles: true }),
      );
      document.dispatchEvent(
        new KeyboardEvent('keydown', { code: 'Digit1', key: '1', repeat: true, bubbles: true }),
      );
    });
    expect(await page.evaluate(() => appConfig.studyMode.currentIndex)).toBe(0);
    expect(await page.evaluate(() => appConfig.studyMode.exerciseFeedback)).toBeNull();
    await page.keyboard.press('Digit1');
    if (practiceMode === 'classic')
      expect(await page.evaluate(() => appConfig.studyMode.currentIndex)).toBe(1);
    else expect(await page.evaluate(() => appConfig.studyMode.exerciseFeedback)).not.toBeNull();
  });
}

async function chooseLesson(page, id) {
  const directory = page.locator('.tb-lesson-directory');
  await revealControl(directory.locator('summary'));
  if (!(await directory.evaluate((el) => el.open))) await directory.locator('summary').click();
  const button = page.locator(`.tb-lesson-card[data-lesson-id="${id}"]`);
  await revealControl(button);
  await button.click();
}

async function holdLoad(page, kind, reject) {
  await page.evaluate(
    ({ kind, reject }) => {
      const loaderMethod = kind === 'book' ? 'getBookIndex' : 'getLesson';
      const uiMethod = kind === 'book' ? '_loadBook' : 'showLesson';
      const original = TextbookLoader[loaderMethod];
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      window.releaseReviewLoad = release;
      TextbookLoader[loaderMethod] = async function (...args) {
        const held =
          kind === 'book' ? args[0] === 'XinBian2' : args[0] === 'XinBian1' && args[1] === 'lesson_02';
        if (held) {
          await gate;
          if (reject) throw Error('Injected delayed failure');
        }
        return original.apply(this, args);
      };
      const module = ModuleSwitcher.getTextbookModule();
      const originalUi = module[uiMethod];
      module[uiMethod] = function (...args) {
        const promise = originalUi.apply(this, args);
        if (args[0] === (kind === 'book' ? 'XinBian2' : 'lesson_02')) window.heldReviewUI = promise;
        return promise;
      };
    },
    { kind, reject },
  );
}

async function textbookState(page) {
  return page.evaluate(() => {
    const module = ModuleSwitcher.getTextbookModule();
    return {
      book: module.currentBookId,
      selected: module.currentLessonId,
      rendered: module.currentLesson?.lesson.item_id,
      title: module.currentLesson?.lesson.title,
      course: module.coursePath,
    };
  });
}

for (const kind of ['lesson', 'book']) {
  for (const reject of [false, true]) {
    test(`FIX-08 delayed ${kind} ${reject ? 'failure' : 'success'} cannot replace the newer selection`, async ({
      page,
    }) => {
      await openReadyApp(page, { module: 'lesson' });
      await expect(page.locator('.tb-reader-body')).toBeVisible();
      await holdLoad(page, kind, reject);
      if (kind === 'lesson') {
        await chooseLesson(page, 'lesson_02');
        await chooseLesson(page, 'lesson_03');
        await expect.poll(async () => (await textbookState(page)).rendered).toBe('lesson_03');
      } else {
        await revealControl(page.locator('#tbBookSelect'));
        await page.locator('#tbBookSelect').selectOption('XinBian2');
        await page.locator('#tbBookSelect').selectOption('XinBian3');
        await expect.poll(async () => (await textbookState(page)).book).toBe('XinBian3');
        await expect.poll(async () => (await textbookState(page)).rendered).toBeTruthy();
      }
      const expected = await textbookState(page);
      await page.evaluate(async () => {
        window.releaseReviewLoad();
        await window.heldReviewUI;
      });
      expect(await textbookState(page)).toEqual(expected);
      await expect(page.locator('.tb-reader-body')).toBeVisible();
      await expect(page.locator('.tb-state-error')).toHaveCount(0);
    });
  }
}

test('FIX-10 both kanji variants and kana survive real input submission and checkpoint restoration', async ({
  page,
}) => {
  await openReadyApp(page);
  await page.evaluate(() => {
    const uncle = taxonomyManager.allWords.find((w) => w.word === '叔父/伯父');
    const others = taxonomyManager.allWords.filter((w) => w.index !== uncle.index).slice(0, 3);
    appConfig.startStudySession(others.concat(uncle), { practiceMode: 'mixed' });
  });
  for (let i = 0; i < 3; i++) await page.locator('[data-practice-action="skip"]').click();
  await page.locator('#practiceAnswerInput').fill('叔父');
  await page.keyboard.press('Enter');
  await expect(page.locator('.practice-feedback')).toContainText('回答正确');
  await page.goto('/');
  await page.locator('[data-dashboard-action="resume"]').click();
  await expect(page.locator('.practice-feedback')).toContainText('回答正确');
  expect(
    await page.evaluate(() => {
      const exercise = appConfig.studyMode.currentExercise;
      return ['叔父', '伯父', 'おじ', 'オジ', '叔父/伯父', 'おば', '王者', ''].map((answer) =>
        JPLearn.practice.isCorrect(exercise, answer),
      );
    }),
  ).toEqual([true, true, true, true, true, false, false, false]);
  await page.locator('#btnPracticeNext').click();
  expect(await page.evaluate(() => appConfig.studyMode.sessionStats.known)).toBe(1);
});

test('FIX-11 grammar debounce keeps the same input, focus, selection and composed text', async ({ page }) => {
  await openReadyApp(page, { module: 'grammar' });
  await revealControl(page.locator('#gmSearch'));
  await page.clock.install();
  const input = page.locator('#gmSearch');
  await input.fill('条件');
  await input.evaluate((el) => {
    window.reviewSearchInput = el;
    el.setSelectionRange(0, 1);
  });
  await page.clock.fastForward(300);
  await expect(input).toBeFocused();
  expect(
    await input.evaluate((el) => ({
      same: el === window.reviewSearchInput,
      start: el.selectionStart,
      end: el.selectionEnd,
    })),
  ).toEqual({ same: true, start: 0, end: 1 });
  const filtered = await page.locator('#gmSidebarFilters .gm-count').textContent();
  await input.dispatchEvent('compositionstart');
  await input.fill('zz-not-finished');
  await page.clock.fastForward(300);
  await expect(page.locator('#gmSidebarFilters .gm-count')).toHaveText(filtered);
  await input.fill('原因');
  await input.dispatchEvent('compositionend');
  await page.clock.fastForward(300);
  await expect(input).toBeFocused();
  await page.keyboard.press('End');
  await page.keyboard.type('x');
  await page.clock.fastForward(300);
  await expect(input).toHaveValue('原因x');
  await expect(page.locator('#gmSidebarFilters .gm-count')).toHaveText(/^0 \/ /);
  await input.fill('条件');
  await page.clock.fastForward(300);
  await page.clock.resume();
  for (const width of [1600, 1280]) {
    await page.setViewportSize({ width, height: width === 1600 ? 900 : 720 });
    await page.screenshot({ path: `local/qa/fix-review-2026-09-21/search-${width}.png` });
  }
});

test('FIX-09 first, middle and last dialogue turns seek and stop inside an OGG fixture', async ({ page }) => {
  await useAudioFixtures(page);
  const requested = [];
  page.on('request', (request) => {
    if (/\.(wav|ogg)(?:[?#]|$)/.test(request.url())) requested.push(request.url());
  });
  await page.route('**/*.wav*', (route) => route.fulfill({ status: 404, body: '' }));
  await openReadyApp(page, { module: 'lesson' });
  await expect(page.locator('.tb-reader-body')).toBeVisible();
  await chooseLesson(page, 'lesson_02');
  await expect.poll(async () => (await textbookState(page)).rendered).toBe('lesson_02');
  const ranges = await page.evaluate(async () => {
    const timing = await TextbookLoader.getDialogueTiming('XinBian1', 'lesson_02', 'conversation');
    let start = 0;
    const ranges = timing.turns.map((turn, index) => {
      const range = { index, start, end: start + turn.duration_sec };
      start = range.end + timing.gap;
      return range;
    });
    const OriginalAudio = window.Audio;
    window.reviewMedia = [];
    window.Audio = function (url) {
      const audio = new OriginalAudio(url);
      const record = { url, started: null, stopped: null };
      window.reviewMedia.push(record);
      audio.playbackRate = 4;
      audio.addEventListener('playing', () => {
        if (record.started === null) record.started = audio.currentTime;
      });
      const pause = audio.pause.bind(audio);
      audio.pause = function () {
        record.stopped = audio.currentTime;
        pause();
      };
      return audio;
    };
    return [ranges[0], ranges[Math.floor(ranges.length / 2)], ranges[ranges.length - 1]];
  });
  for (const range of ranges) {
    const button = page.locator(
      `.tb-turn-play-btn[data-tts-mode="dialogue:conversation"][data-turn-idx="${range.index}"]`,
    );
    await revealControl(button);
    await button.click();
    await expect
      .poll(() => page.evaluate(() => ModuleSwitcher.getTextbookModule().ttsState.statusText))
      .toBe('单句朗读完成');
    const media = await page.evaluate(() => window.reviewMedia.at(-1));
    expect(media.url).toMatch(/\.ogg(?:\?|$)/);
    expect(media.started).toBeGreaterThanOrEqual(range.start - 0.05);
    expect(media.started).toBeLessThan(range.start + 0.4);
    expect(media.stopped).toBeGreaterThanOrEqual(range.end - 0.1);
    expect(media.stopped).toBeLessThan(range.end + 0.3);
    await expect(page.locator('.tb-dialogue-turn.tts-reading')).toHaveCount(0);
  }
  expect(requested.some((url) => /\.wav(?:[?#]|$)/.test(url))).toBe(false);
  expect(requested.some((url) => /\.ogg(?:[?#]|$)/.test(url))).toBe(true);
});

test('FIX-09 single-turn failure retries and leaving the lesson stops playback and delayed loads', async ({
  page,
}) => {
  await useAudioFixtures(page);
  await openReadyApp(page, { module: 'lesson' });
  await expect(page.locator('.tb-reader-body')).toBeVisible();
  await chooseLesson(page, 'lesson_02');
  await expect.poll(async () => (await textbookState(page)).rendered).toBe('lesson_02');
  const button = page.locator('.tb-turn-play-btn').first();
  await revealControl(button);
  await page.evaluate(() => {
    window.reviewOriginalTiming = TextbookLoader.getDialogueTiming;
    TextbookLoader.getDialogueTiming = () => Promise.resolve(null);
  });
  await button.click();
  await expect
    .poll(() => page.evaluate(() => ModuleSwitcher.getTextbookModule().ttsState.statusText))
    .toContain('音频暂不可用');
  await page.evaluate(() => {
    TextbookLoader.getDialogueTiming = window.reviewOriginalTiming;
  });
  await button.click();
  await expect
    .poll(() => page.evaluate(() => ModuleSwitcher.getTextbookModule().ttsState.statusText))
    .toBe('正在朗读单句');
  await page.evaluate(() => {
    window.reviewPlayingAudio = ModuleSwitcher.getTextbookModule().ttsState.audio;
  });
  await page.locator('#modBtnGrammar').click();
  expect(await page.evaluate(() => window.reviewPlayingAudio.paused)).toBe(true);
  expect(await page.evaluate(() => ModuleSwitcher.getTextbookModule().ttsState.mode)).toBe('');
  await page.locator('#modBtnLesson').click();
  await page.evaluate(() => {
    const original = TextbookLoader.getDialogueAudioUrl;
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    window.reviewReleaseAudio = release;
    TextbookLoader.getDialogueAudioUrl = function (...args) {
      TextbookLoader.getDialogueAudioUrl = original;
      window.reviewDelayedAudio = gate.then(() => original.apply(this, args));
      return window.reviewDelayedAudio;
    };
  });
  await button.click();
  await expect
    .poll(() => page.evaluate(() => ModuleSwitcher.getTextbookModule().ttsState.loading))
    .toBe(true);
  await chooseLesson(page, 'lesson_03');
  await expect.poll(async () => (await textbookState(page)).rendered).toBe('lesson_03');
  const currentButton = page.locator('.tb-turn-play-btn').first();
  await revealControl(currentButton);
  await currentButton.click();
  await expect
    .poll(() => page.evaluate(() => ModuleSwitcher.getTextbookModule().ttsState.statusText))
    .toBe('正在朗读单句');
  const currentUrl = await page.evaluate(() => ModuleSwitcher.getTextbookModule().ttsState.audio.src);
  await page.evaluate(async () => {
    window.reviewReleaseAudio();
    await window.reviewDelayedAudio;
  });
  expect(await page.evaluate(() => ModuleSwitcher.getTextbookModule().ttsState.audio.src)).toBe(currentUrl);
  for (const width of [1600, 1280]) {
    await page.setViewportSize({ width, height: width === 1600 ? 900 : 720 });
    await page.screenshot({ path: `local/qa/fix-review-2026-09-21/audio-${width}.png` });
  }
  await page.locator('#modBtnDashboard').click();
  expect(await page.evaluate(() => ModuleSwitcher.getTextbookModule().ttsState.audio)).toBeNull();
});

async function observeTextbookAudio(page) {
  await page.evaluate(() => {
    const NativeAudio = window.Audio;
    window.reviewTtsMedia = [];
    window.Audio = function (url) {
      const audio = new NativeAudio(url);
      window.reviewTtsMedia.push(audio);
      return audio;
    };
  });
}

async function holdAudioResponse(page, pattern) {
  let release;
  let requested;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    requested = resolve;
  });
  await page.route(pattern, async (route) => {
    requested();
    await gate;
    await route.fallback();
  });
  return { started, release };
}

async function clickSectionAudio(page, mode) {
  const button = page.locator(`.tb-tts-btn[data-tts-mode="${mode}"]`).first();
  await revealControl(button);
  await button.click();
}

async function expectCurrentAudioPlaying(page, lesson) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = ModuleSwitcher.getTextbookModule().ttsState;
        return state.audio && !state.loading && !state.audio.paused && state.audio.currentTime > 0
          ? state.audio.src
          : '';
      }),
    )
    .toContain(lesson);
}

test('FIX-14 a shared reading manifest cannot start the old lesson and stop leaves no orphan audio', async ({
  page,
}) => {
  await useAudioFixtures(page);
  await openReadyApp(page, { module: 'lesson' });
  await chooseLesson(page, 'lesson_02');
  await expect.poll(async () => (await textbookState(page)).rendered).toBe('lesson_02');
  await observeTextbookAudio(page);
  const held = await holdAudioResponse(
    page,
    '**/gemini38_flash_tts_reading_sections_candidate_v1/manifest.jsonl*',
  );
  await clickSectionAudio(page, 'reading:body');
  await held.started;
  await chooseLesson(page, 'lesson_03');
  await expect.poll(async () => (await textbookState(page)).rendered).toBe('lesson_03');
  await clickSectionAudio(page, 'reading:body');
  held.release();
  await expectCurrentAudioPlaying(page, '03_lesson_03');
  expect(await page.evaluate(() => window.reviewTtsMedia.length)).toBe(1);
  await clickSectionAudio(page, 'reading:body');
  expect(await page.evaluate(() => window.reviewTtsMedia.every((audio) => audio.paused))).toBe(true);
  await clickSectionAudio(page, 'reading:body');
  await expectCurrentAudioPlaying(page, '03_lesson_03');
  await page.locator('#modBtnDashboard').click();
  expect(await page.evaluate(() => window.reviewTtsMedia.every((audio) => audio.paused))).toBe(true);
});

test('FIX-14 delayed dialogue timing cannot replace a newer lesson playback', async ({ page }) => {
  await useAudioFixtures(page);
  const errors = await openReadyApp(page, { module: 'lesson' });
  await chooseLesson(page, 'lesson_02');
  await expect.poll(async () => (await textbookState(page)).rendered).toBe('lesson_02');
  await observeTextbookAudio(page);
  const timingPattern =
    '**/gemini38_flash_tts_dialogue_sections_candidate_v1/XinBian1/02_lesson_02/conversation/manifest.json*';
  const held = await holdAudioResponse(page, timingPattern);
  await clickSectionAudio(page, 'dialogue:conversation');
  await held.started;
  await chooseLesson(page, 'lesson_03');
  await expect.poll(async () => (await textbookState(page)).rendered).toBe('lesson_03');
  await clickSectionAudio(page, 'dialogue:conversation');
  await expectCurrentAudioPlaying(page, '03_lesson_03');
  const oldResponse = page.waitForResponse((response) =>
    response.url().includes('02_lesson_02/conversation/manifest.json'),
  );
  held.release();
  await (await oldResponse).finished();
  // Let the timing response finish its JSON and audio callbacks before checking for orphans.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  expect(await page.evaluate(() => window.reviewTtsMedia.length)).toBe(1);
  await expectCurrentAudioPlaying(page, '03_lesson_03');
  await expect(page.locator('.tb-dialogue-turn.tts-reading')).toHaveCount(1);
  await page.locator('#modBtnDashboard').click();
  expect(await page.evaluate(() => window.reviewTtsMedia.every((audio) => audio.paused))).toBe(true);
  expect(errors).toEqual([]);
});

test('FIX-14 dialogue timing rejection reports a retryable failure and a stale rejection is ignored', async ({
  page,
}) => {
  await useAudioFixtures(page);
  const errors = await openReadyApp(page, { module: 'lesson' });
  await chooseLesson(page, 'lesson_02');
  await expect.poll(async () => (await textbookState(page)).rendered).toBe('lesson_02');
  await page.evaluate(() => {
    const original = TextbookLoader.getDialogueTiming;
    window.reviewOriginalTiming = original;
    TextbookLoader.getDialogueTiming = function () {
      TextbookLoader.getDialogueTiming = original;
      return Promise.reject(new Error('Injected timing rejection'));
    };
  });
  await clickSectionAudio(page, 'dialogue:conversation');
  await expect
    .poll(() => page.evaluate(() => ModuleSwitcher.getTextbookModule().ttsState.statusText))
    .toContain('音频暂不可用');
  expect(await page.evaluate(() => ModuleSwitcher.getTextbookModule().ttsState.loading)).toBe(false);
  await clickSectionAudio(page, 'dialogue:conversation');
  await expectCurrentAudioPlaying(page, '02_lesson_02');
  await clickSectionAudio(page, 'dialogue:conversation');
  await page.evaluate(() => {
    TextbookLoader.getDialogueTiming = function (...args) {
      if (args[1] !== 'lesson_02') return window.reviewOriginalTiming.apply(this, args);
      return new Promise((resolve, reject) => {
        window.rejectOldTiming = reject;
      });
    };
  });
  await clickSectionAudio(page, 'dialogue:conversation');
  await expect.poll(() => page.evaluate(() => typeof window.rejectOldTiming)).toBe('function');
  await chooseLesson(page, 'lesson_03');
  await expect.poll(async () => (await textbookState(page)).rendered).toBe('lesson_03');
  await clickSectionAudio(page, 'dialogue:conversation');
  await expectCurrentAudioPlaying(page, '03_lesson_03');
  await page.evaluate(async () => {
    window.rejectOldTiming(new Error('Injected stale timing rejection'));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await expectCurrentAudioPlaying(page, '03_lesson_03');
  expect(errors).toEqual([]);
});

test('FIX-14 leaving while a reading manifest is pending never starts hidden audio', async ({ page }) => {
  await useAudioFixtures(page);
  await openReadyApp(page, { module: 'lesson' });
  await chooseLesson(page, 'lesson_02');
  await expect.poll(async () => (await textbookState(page)).rendered).toBe('lesson_02');
  await observeTextbookAudio(page);
  const held = await holdAudioResponse(
    page,
    '**/gemini38_flash_tts_reading_sections_candidate_v1/manifest.jsonl*',
  );
  await clickSectionAudio(page, 'reading:body');
  await held.started;
  await page.locator('#modBtnDashboard').click();
  const response = page.waitForResponse((item) =>
    item.url().includes('gemini38_flash_tts_reading_sections_candidate_v1/manifest.jsonl'),
  );
  held.release();
  await (await response).finished();
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  expect(await page.evaluate(() => window.reviewTtsMedia.length)).toBe(0);
  expect(await page.evaluate(() => ModuleSwitcher.getTextbookModule().ttsState.mode)).toBe('');
});

test('FIX-14 aborting an old native play promise cannot stop the next section audio', async ({ page }) => {
  await useAudioFixtures(page);
  const errors = await openReadyApp(page, { module: 'lesson' });
  await chooseLesson(page, 'lesson_02');
  await expect.poll(async () => (await textbookState(page)).rendered).toBe('lesson_02');
  await observeTextbookAudio(page);
  const held = await holdAudioResponse(
    page,
    '**/gemini38_flash_tts_reading_sections_candidate_v1/XinBian1/02_lesson_02/body/*.ogg*',
  );
  await clickSectionAudio(page, 'reading:body');
  await held.started;
  await clickSectionAudio(page, 'dialogue:conversation');
  await expectCurrentAudioPlaying(page, '02_lesson_02/conversation');
  held.release();
  await page.evaluate(() => {
    const oldAudio = window.reviewTtsMedia[0];
    oldAudio.dispatchEvent(new Event('error'));
    oldAudio.dispatchEvent(new Event('ended'));
  });
  await expectCurrentAudioPlaying(page, '02_lesson_02/conversation');
  expect(await page.evaluate(() => window.reviewTtsMedia[0].paused)).toBe(true);
  expect(errors).toEqual([]);
});

test('FIX-14 vocabulary loop advances normally and ignores events from the previous Audio instance', async ({
  page,
}) => {
  await useAudioFixtures(page);
  await openReadyApp(page, { module: 'lesson' });
  await chooseLesson(page, 'lesson_02');
  await expect.poll(async () => (await textbookState(page)).rendered).toBe('lesson_02');
  await observeTextbookAudio(page);
  await clickSectionAudio(page, 'vocab-loop');
  await expect.poll(() => page.evaluate(() => window.reviewTtsMedia.length)).toBeGreaterThanOrEqual(2);
  await expectCurrentAudioPlaying(page, '.ogg');
  const source = await page.evaluate(() => ModuleSwitcher.getTextbookModule().ttsState.audio.src);
  await page.evaluate(() => {
    window.reviewTtsMedia[0].dispatchEvent(new Event('error'));
    window.reviewTtsMedia[0].dispatchEvent(new Event('ended'));
  });
  await expectCurrentAudioPlaying(page, source);
  await clickSectionAudio(page, 'vocab-loop');
  expect(await page.evaluate(() => window.reviewTtsMedia.every((audio) => audio.paused))).toBe(true);
});

async function openCourseStep(page, step) {
  const toggle = page.locator('.tb-course-path-toggle');
  await revealControl(toggle);
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  const action = page.locator(`[data-course-action="step"][data-course-step="${step}"]`);
  if (!(await action.isVisible())) await page.locator('.tb-course-other-toggle').click();
  await revealControl(action);
  await action.click();
}

async function prepareCourseReturn(page, step) {
  await openReadyApp(page, { module: 'lesson' });
  await chooseLesson(page, 'lesson_02');
  await expect.poll(async () => (await textbookState(page)).rendered).toBe('lesson_02');
  await openCourseStep(page, step);
  if (step === 'grammar') {
    const card = page.locator('.gm-course-grammar-card').first();
    await revealControl(card);
    await card.click();
    await expect(page.locator('.gm-course-detail')).toBeVisible();
    await page.keyboard.press('Escape');
  } else {
    await expect(page.locator('.practice-card')).toBeVisible();
    await revealControl(page.locator('.practice-card'));
    for (let i = 0; i < 5; i++) await page.locator('[data-practice-action="skip"]').click();
    await expect(page.locator('#btnReturnToCourse')).toBeVisible();
  }
}

async function clickCourseReturn(page, step) {
  const button = page.locator(step === 'grammar' ? '.gm-course-return' : '#btnReturnToCourse');
  await revealControl(button);
  await button.click();
}

async function holdCourseReturn(page) {
  await page.evaluate(() => {
    const original = TextbookLoader.getLesson;
    const originalReturn = ModuleSwitcher.returnToTextbook;
    const gate = new Promise((resolve) => {
      window.releaseCancelledCourse = resolve;
    });
    TextbookLoader.getLesson = async function (book, lesson) {
      if (lesson === 'lesson_02') await gate;
      return original.call(this, book, lesson);
    };
    ModuleSwitcher.returnToTextbook = function (...args) {
      window.cancelledCourseReturn = originalReturn.apply(this, args);
      return window.cancelledCourseReturn;
    };
  });
}

for (const step of ['grammar', 'review']) {
  test(`FIX-15 a cancelled ${step} return does not complete the newly selected lesson`, async ({ page }) => {
    await prepareCourseReturn(page, step);
    await page.locator('#modBtnLesson').click();
    await chooseLesson(page, 'lesson_03');
    await expect.poll(async () => (await textbookState(page)).rendered).toBe('lesson_03');
    await page.locator(step === 'grammar' ? '#modBtnGrammar' : '#modBtnVocab').click();
    await holdCourseReturn(page);
    await clickCourseReturn(page, step);
    await chooseLesson(page, 'lesson_04');
    await expect.poll(async () => (await textbookState(page)).rendered).toBe('lesson_04');
    expect((await textbookState(page)).course.steps[step]).toBe('todo');
    expect(
      await page.evaluate(async () => {
        window.releaseCancelledCourse();
        return window.cancelledCourseReturn;
      }),
    ).toBe(false);
    expect((await textbookState(page)).course.steps[step]).toBe('todo');
  });

  test(`FIX-15 successful ${step} return completes the original lesson`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await prepareCourseReturn(page, step);
    await clickCourseReturn(page, step);
    await expect.poll(async () => (await textbookState(page)).course.steps[step]).toBe('done');
    expect((await textbookState(page)).rendered).toBe('lesson_02');
    if (step === 'grammar')
      expect(await page.evaluate(() => ModuleSwitcher.exportNavigation().grammar.courseContext)).toBeNull();
  });
}

test('FIX-15 a cancelled return keeps a newer grammar course context', async ({ page }) => {
  await prepareCourseReturn(page, 'grammar');
  await page.locator('#modBtnLesson').click();
  await chooseLesson(page, 'lesson_03');
  await expect.poll(async () => (await textbookState(page)).rendered).toBe('lesson_03');
  await page.locator('#modBtnGrammar').click();
  await holdCourseReturn(page);
  await clickCourseReturn(page, 'grammar');
  await chooseLesson(page, 'lesson_04');
  await expect.poll(async () => (await textbookState(page)).rendered).toBe('lesson_04');
  await openCourseStep(page, 'grammar');
  await expect(page.locator('.gm-course-grammar-card').first()).toBeVisible();
  const currentContext = await page.evaluate(() => ModuleSwitcher.exportNavigation().grammar.courseContext);
  expect(currentContext.lessonId).toBe('lesson_04');
  expect(
    await page.evaluate(async () => {
      window.releaseCancelledCourse();
      return window.cancelledCourseReturn;
    }),
  ).toBe(false);
  expect(await page.evaluate(() => ModuleSwitcher.exportNavigation().grammar.courseContext)).toEqual(
    currentContext,
  );
  await expect(page.locator('.gm-course-grammar-card').first()).toBeVisible();
});
