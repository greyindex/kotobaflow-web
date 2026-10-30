const { revealControl } = require('./helpers');
const { test, expect } = require('@playwright/test');
const { useAudioFixtures } = require('./audio-fixtures');
const { openReadyApp } = require('./helpers');

// Keep in-memory audio fixtures active after reload; worker fetches bypass page.route.
test.use({ serviceWorkers: 'block' });

test('FIX-04 same-level choices stay at N5 and adjacent-level fallback is ordered and unambiguous', async ({
  page,
}) => {
  await useIsolatedProgress(page);
  await openReadyApp(page);
  const result = await page.evaluate(() => {
    const engine = JPLearn.practice;
    const all = taxonomyManager.allWords;
    const uncle = all.find((w) => w.word === '叔父/伯父');
    const real = engine.createExercise(uncle, all, 0);
    const target = { index: 1, word: '橋', reading_hiragana: 'はし', meaning: '桥', level: 'N3' };
    const pool = [
      target,
      { index: 2, word: '箸', reading_hiragana: 'はし', meaning: '筷子', level: 'N3' },
      { index: 3, word: 'はし', reading_hiragana: 'はし', meaning: '桥', level: 'N3' },
      { index: 4, word: '川', reading_hiragana: 'かわ', meaning: '河', level: 'N3' },
      { index: 5, word: '学校', reading_hiragana: 'がっこう', meaning: '学校', level: 'N4' },
      { index: 6, word: '樹木', reading_hiragana: 'じゅもく', meaning: '树木', level: 'N2' },
      { index: 7, word: '王者', reading_hiragana: 'おうじゃ', meaning: '王者', level: 'N1' },
    ];
    const listening = engine.createExercise(target, pool, 0, { preferredType: 'listening' });
    const reversed = engine.createExercise(target, pool.slice().reverse(), 0, { preferredType: 'listening' });
    return {
      realLevels: real.options
        .filter((o) => !o.correct)
        .map((o) => all.filter((w) => w.meaning === o.label).map((w) => w.level)),
      listening,
      reversed,
      missing: engine.createExercise(target, pool.slice(0, 3), 0, { preferredType: 'listening' }),
    };
  });
  for (const levels of result.realLevels) expect(levels).toContain('N5');
  expect(result.listening.options.map((o) => o.label).sort()).toEqual(['橋', '川', '学校', '樹木'].sort());
  expect(result.reversed).toEqual(result.listening);
  expect(result.missing.type).toBe('input');
  expect(result.listening.options.filter((o) => o.correct)).toHaveLength(1);
});

test('FIX-04 saved question survives a smaller candidate pool, rerender, refresh and pending feedback', async ({
  page,
}) => {
  const stored = await useIsolatedProgress(page);
  await openReadyApp(page);
  await startMixedSession(page, 3);
  const original = await page.evaluate(() => appConfig.studyMode.currentExercise);
  await answerChoice(page, false);
  await expect.poll(() => stored().navigation.vocab.studySession?.currentExercise).toEqual(original);
  const restored = await page.evaluate(() => {
    const mode = appConfig.studyMode;
    const checkpoint = mode.exportCheckpoint();
    const all = taxonomyManager.allWords;
    taxonomyManager.allWords = mode.queue.slice();
    mode.restoreCheckpoint(checkpoint);
    taxonomyManager.allWords = all;
    mode.render();
    mode.render();
    return {
      exercise: mode.currentExercise,
      feedback: mode.exerciseFeedback,
      fallback: mode._fallbackExercise('ja-zh', 'test'),
    };
  });
  expect(restored.exercise).toEqual(original);
  expect(restored.feedback.correct).toBe(false);
  expect(restored.fallback).toBe(false);
  await page.goto('/');
  await expect(page.locator('[data-dashboard-action="resume"]')).toBeVisible();
  await page.locator('[data-dashboard-action="resume"]').click();
  await expect(page.locator('.practice-feedback')).toContainText('回答错误');
  expect(await page.evaluate(() => appConfig.studyMode.currentExercise)).toEqual(original);
  await page.locator('#btnPracticeNext').click();
  expect(await page.evaluate(() => appConfig.studyMode.sessionStats.unknown)).toBe(1);
  await page.locator('[data-practice-action="skip"]').click();
  expect(await page.evaluate(() => appConfig.studyMode.sessionStats.skipped)).toBe(1);
  expect(await page.evaluate(() => StudyStorage.getSrsRecords().length)).toBe(1);
});

test('FIX-04 legacy checkpoints explicitly reset an unavailable question and reject corrupt choices', async ({
  page,
}) => {
  await useIsolatedProgress(page);
  await openReadyApp(page);
  await startMixedSession(page, 2);
  await answerChoice(page, true);
  const result = await page.evaluate(() => {
    const mode = appConfig.studyMode;
    const saved = mode.exportCheckpoint();
    const corrupt = JSON.parse(JSON.stringify(saved.currentExercise));
    corrupt.options[0].correct = true;
    corrupt.options[1].correct = true;
    const rejected = JPLearn.practice.restoreExercise(corrupt, mode.queue[0], 0);
    delete saved.currentExercise;
    mode.restoreCheckpoint(saved);
    return {
      rejected,
      feedback: mode.exerciseFeedback,
      notice: mode.practiceNotice,
      reviews: StudyStorage.getSrsRecords().length,
    };
  });
  expect(result.rejected).toBeNull();
  expect(result.feedback).toBeNull();
  expect(result.notice).toContain('请重新作答');
  expect(result.reviews).toBe(0);
});

async function useIsolatedProgress(page) {
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
    navigation: { version: 1, lastModule: '', vocab: {}, grammar: {}, textbook: {} },
    usage: {},
    updatedAt: '',
  };
  await page.route('**/api/progress', async (route) => {
    if (route.request().method() === 'POST') stored = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stored) });
  });
  return () => stored;
}

async function startMixedSession(page, count) {
  await page.evaluate((size) => {
    const words = window.taxonomyManager.allWords.slice(0, size);
    window.appConfig.startStudySession(words, { practiceMode: 'mixed' });
  }, count);
  await expect(page.locator('.practice-card')).toBeVisible();
}

async function answerChoice(page, shouldBeCorrect) {
  const optionIndex = await page.evaluate((correct) => {
    const exercise = window.appConfig.studyMode.currentExercise;
    return exercise.options.findIndex((option) => option.correct === correct);
  }, shouldBeCorrect);
  expect(optionIndex).toBeGreaterThanOrEqual(0);
  await page.locator('.practice-option').nth(optionIndex).click();
}

test('practice engine generates five cognitive tasks and normalizes Japanese input', async ({ page }) => {
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page);
  const result = await page.evaluate(() => {
    const pool = [
      {
        index: 1,
        word: '相方',
        reading_hiragana: 'あいかた',
        meaning: '伙伴',
        level: 'N5',
        example_sentence_ja: '彼は私の相方です。',
        example_sentence_zh: '他是我的搭档。',
      },
      { index: 2, word: '学校', reading_hiragana: 'がっこう', meaning: '学校', level: 'N5' },
      { index: 3, word: '先生', reading_hiragana: 'せんせい', meaning: '老师', level: 'N5' },
      { index: 4, word: '友達', reading_hiragana: 'ともだち', meaning: '朋友', level: 'N5' },
    ];
    const types = window.JPLearn.practice.TYPE_ORDER.map((type, position) =>
      window.JPLearn.practice.createExercise(pool[0], pool, position, { preferredType: type }),
    );
    const inputExercise = types[3];
    return {
      types: types.map((exercise) => exercise && exercise.type),
      clozePrompt: types[4] && types[4].prompt,
      halfWidthKatakanaAccepted: window.JPLearn.practice.isCorrect(inputExercise, ' ｱｲｶﾀ '),
      spacedHiraganaAccepted: window.JPLearn.practice.isCorrect(inputExercise, 'あい かた'),
      wrongRejected: window.JPLearn.practice.isCorrect(inputExercise, 'せんせい'),
      fallbackType: window.JPLearn.practice.createExercise(pool[0], [pool[0]], 0, {
        preferredType: 'ja-zh',
      }).type,
    };
  });

  expect(result.types).toEqual(['ja-zh', 'zh-ja', 'listening', 'input', 'cloze']);
  expect(result.clozePrompt).toContain('＿＿＿＿');
  expect(result).toMatchObject({
    halfWidthKatakanaAccepted: true,
    spacedHiraganaAccepted: true,
    wrongRejected: false,
    fallbackType: 'input',
  });
  expect(pageErrors).toEqual([]);
});

test('mixed practice completes all five task types with immediate feedback and result stats', async ({
  page,
}) => {
  const getStored = await useIsolatedProgress(page);
  await useAudioFixtures(page);
  const pageErrors = await openReadyApp(page);
  await startMixedSession(page, 5);

  await expect(page.locator('.practice-type-pill')).toHaveText('日文 → 中文');
  await answerChoice(page, true);
  await expect(page.locator('.practice-feedback')).toContainText('回答正确');
  await page.keyboard.press('Enter');

  await expect(page.locator('.practice-type-pill')).toHaveText('中文 → 日文');
  await answerChoice(page, false);
  await expect(page.locator('.practice-feedback')).toContainText('回答错误');
  await page.locator('#btnPracticeNext').click();

  await expect(page.locator('.practice-type-pill')).toHaveText('听音辨词');
  await expect
    .poll(() => page.locator('#practiceAudioProbe').evaluate((audio) => audio.readyState))
    .toBeGreaterThanOrEqual(1);
  await page.locator('#btnPracticeAudio').click();
  await expect.poll(() => page.evaluate(() => window.VocabTTS.audio?.currentTime || 0)).toBeGreaterThan(0);
  await answerChoice(page, true);
  await page.keyboard.press('Enter');

  await expect(page.locator('.practice-type-pill')).toHaveText('假名 / 汉字输入');
  const katakanaAnswer = await page.evaluate(() => {
    const reading = window.appConfig.studyMode.currentExercise.reading;
    return ' ' + reading.replace(/[ぁ-ゖ]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 0x60)) + ' ';
  });
  await page.locator('#practiceAnswerInput').fill(katakanaAnswer);
  await page.keyboard.press('Enter');
  await expect(page.locator('.practice-feedback')).toContainText('回答正确');
  await page.keyboard.press('Enter');

  await expect(page.locator('.practice-type-pill')).toHaveText('例句挖空');
  const clozeAnswer = await page.evaluate(() => window.appConfig.studyMode.currentExercise.answer);
  await page.locator('#practiceAnswerInput').fill(clozeAnswer);
  await page.locator('#btnPracticeSubmit').click();
  await expect(page.locator('.practice-feedback')).toContainText('回答正确');
  await page.locator('#btnPracticeNext').click();

  await expect(page.locator('.study-complete')).toBeVisible();
  await expect(page.locator('.study-result-exercise')).toHaveCount(5);
  await expect(page.locator('.study-result-exercises')).toContainText('日文 → 中文');
  await expect(page.locator('.study-result-exercises')).toContainText('例句挖空');
  await expect(page.locator('.study-result-distribution')).toHaveAttribute(
    'aria-label',
    '认识 4，模糊 0，不会 1，跳过 0',
  );
  await expect.poll(() => getStored().vocabulary.history.length).toBe(1);
  expect(getStored().vocabulary.history[0]).toMatchObject({
    practiceMode: 'mixed',
    exerciseStats: {
      'ja-zh': { total: 1, correct: 1, incorrect: 0, skipped: 0 },
      'zh-ja': { total: 1, correct: 0, incorrect: 1, skipped: 0 },
      listening: { total: 1, correct: 1, incorrect: 0, skipped: 0 },
      input: { total: 1, correct: 1, incorrect: 0, skipped: 0 },
      cloze: { total: 1, correct: 1, incorrect: 0, skipped: 0 },
    },
  });
  expect(pageErrors).toEqual([]);
});

test('A05 mixed practice restores an unanswered feedback checkpoint without double counting', async ({
  page,
}) => {
  const getStored = await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page);
  await startMixedSession(page, 3);
  const firstWord = await page.evaluate(() => window.appConfig.studyMode.queue[0].word);

  await answerChoice(page, false);
  await expect(page.locator('.practice-feedback')).toContainText('回答错误');
  await expect.poll(() => getStored().navigation.vocab.studySession?.exerciseFeedback?.correct).toBe(false);
  expect(getStored().vocabulary.unknown).toEqual([]);

  await page.goto('/');
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 45_000 });
  await expect(page.locator('.dashboard-start-card h2')).toHaveText('继续上次的词汇练习');
  await expect(page.locator('.dashboard-start-card > p')).toContainText('当前答案反馈等待确认');
  await page.locator('[data-dashboard-action="resume"]').click();

  await expect(page.locator('.practice-feedback')).toContainText('回答错误');
  await expect(page.locator('.study-stats-row')).toContainText('1 / 3');
  expect(await page.evaluate(() => window.appConfig.studyMode.queue[0].word)).toBe(firstWord);
  expect(getStored().vocabulary.unknown).toEqual([]);

  await page.locator('#btnPracticeNext').click();
  await expect(page.locator('.study-stats-row')).toContainText('2 / 3');
  await expect.poll(() => getStored().vocabulary.unknown.length).toBe(1);
  expect(getStored().vocabulary.unknown).toEqual([
    await page.evaluate(() => window.appConfig.studyMode.sessionResults[0].index),
  ]);
  expect(await page.evaluate(() => window.appConfig.studyMode.sessionStats.unknown)).toBe(1);
  expect(pageErrors).toEqual([]);
});

test('missing listening audio falls back without an empty question or page error', async ({ page }) => {
  await useIsolatedProgress(page);
  await useAudioFixtures(page);
  await page.route(/\.(?:wav|ogg)(?:\?|$)/, async (route) => route.fulfill({ status: 404, body: '' }));
  const pageErrors = await openReadyApp(page);
  await startMixedSession(page, 3);

  await answerChoice(page, true);
  await page.keyboard.press('Enter');
  await answerChoice(page, true);
  await page.keyboard.press('Enter');

  await expect(page.locator('.practice-notice')).toContainText('音频暂不可用');
  await expect(page.locator('.practice-card')).not.toHaveAttribute('data-exercise-type', 'listening');
  await expect(page.locator('.practice-option, #practiceAnswerInput').first()).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('setup mode control keeps the classic flashcard path available', async ({ page }) => {
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page);
  await revealControl(page.locator('#viewModeSelect'));
  await page.locator('#viewModeSelect').selectOption('study');
  await expect(page.locator('.study-mode-btn.active')).toHaveAttribute('data-practice-mode', 'mixed');
  await revealControl(page.locator('[data-practice-mode="classic"]'));
  await page.locator('[data-practice-mode="classic"]').click();
  await expect(page.locator('[data-practice-mode="classic"]')).toHaveAttribute('aria-checked', 'true');
  await page.locator('#btnStartStudy').click();
  await expect(page.locator('#flashcard')).toBeVisible();
  await page.locator('#flashcard').click();
  await expect(page.locator('#flashcard')).toHaveClass(/flipped/);
  expect(pageErrors).toEqual([]);
});

test('FIX-19 keyboard-only mixed practice keeps focus on the next step and marks Japanese text', async ({
  page,
}) => {
  await useIsolatedProgress(page);
  await useAudioFixtures(page);
  const pageErrors = await openReadyApp(page);
  await startMixedSession(page, 5);
  const focused = () =>
    page.evaluate(() => {
      const el = document.activeElement;
      return el.id || el.className || el.tagName;
    });
  const correctIndex = () =>
    page.evaluate(() => window.appConfig.studyMode.currentExercise.options.findIndex((o) => o.correct));
  const expectNextFocused = async () => {
    await expect(page.locator('.practice-feedback')).toBeVisible();
    expect(await focused()).toBe('btnPracticeNext');
  };

  // 日文 → 中文: the prompt is Japanese, the choices are Chinese.
  await expect(page.locator('.practice-type-pill')).toHaveText('日文 → 中文');
  await expect(page.locator('.practice-prompt')).toHaveAttribute('lang', 'ja');
  await expect(page.locator('.practice-option span[lang]')).toHaveCount(0);
  await page.locator('[data-study-exit]').focus();
  for (let i = 0; i <= (await correctIndex()); i++) await page.keyboard.press('Tab');
  expect(await focused()).toContain('practice-option');
  await page.keyboard.press('Enter');
  await expectNextFocused();
  await expect(page.locator('.practice-feedback [lang="zh-CN"]')).toHaveText(
    await page.evaluate(() => window.appConfig.studyMode.currentExercise.meaning),
  );
  // Tab continues forward from 下一题 instead of restarting at 返回词汇.
  await page.keyboard.press('Tab');
  expect(await focused()).toContain('btn-practice-favorite');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');

  // 中文 → 日文 and 听音辨词: the choices are Japanese.
  for (const label of ['中文 → 日文', '听音辨词']) {
    await expect(page.locator('.practice-type-pill')).toHaveText(label);
    await expect(page.locator('.practice-prompt')).not.toHaveAttribute('lang', 'ja');
    await expect(page.locator('.practice-option span[lang="ja"]')).toHaveCount(4);
    expect(await focused()).toContain('practice-option');
    for (let i = 0; i < (await correctIndex()); i++) await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expectNextFocused();
    await page.keyboard.press('Enter');
  }

  // 输入 and 例句挖空 keep the input focus, then move to 下一题 after the answer.
  for (const label of ['假名 / 汉字输入', '例句挖空']) {
    await expect(page.locator('.practice-type-pill')).toHaveText(label);
    if (label === '例句挖空') await expect(page.locator('.practice-prompt')).toHaveAttribute('lang', 'ja');
    expect(await focused()).toBe('practiceAnswerInput');
    await page.keyboard.type(await page.evaluate(() => window.appConfig.studyMode.currentExercise.answer));
    await page.keyboard.press('Enter');
    await expectNextFocused();
    await page.keyboard.press('Enter');
  }
  await expect(page.locator('.study-complete')).toBeVisible();
  await expect(page.locator('.study-result-distribution')).toHaveAttribute(
    'aria-label',
    '认识 5，模糊 0，不会 0，跳过 0',
  );
  expect(pageErrors).toEqual([]);
});

test('VAL-02 an input prompt shared by other words names them, and a cloze blanks only the word itself', async ({
  page,
}) => {
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page);
  const result = await page.evaluate(() => {
    const engine = JPLearn.practice;
    const all = taxonomyManager.allWords;
    const byIndex = (index) => all.find((word) => word.index === index);
    const input = (word) => engine.createExercise(word, all, 3, { preferredType: 'input' });
    const key = input(byIndex(11390));
    const katakanaKey = input(byIndex(11391));
    const cloze = (word, pool) => engine.createExercise(word, pool || all, 4, { preferredType: 'cloze' });
    const synthetic = (word, sentence) => ({
      index: 90000,
      word,
      reading_hiragana: 'やま',
      meaning: '测试',
      level: 'N5',
      example_sentence_ja: sentence,
      example_sentence_zh: '测试例句',
    });
    return {
      key: [
        key.type,
        key.prompt,
        key.notAnswers,
        engine.isCorrect(key, 'かぎ'),
        engine.isCorrect(key, 'キー'),
      ],
      katakanaKey: [katakanaKey.type, katakanaKey.prompt, katakanaKey.notAnswers],
      // Too many words share 关系 to name them all, so another task type is used.
      crowded: input(byIndex(9)).type,
      fuji: cloze(byIndex(11225)).type,
      thisYear: cloze(byIndex(12060)).type,
      standalone: cloze(synthetic('山', 'あの山は高い。')).prompt,
      twice: cloze(synthetic('山', '山を見て、また山に登る。')).prompt,
      insideKatakana: cloze(synthetic('キー', 'ルームキーをなくした。')).type,
      katakanaAlone: cloze(synthetic('キー', 'キーをなくした。')).prompt,
    };
  });
  expect(result.key).toEqual(['input', '钥匙', ['キー'], true, false]);
  expect(result.katakanaKey).toEqual(['input', '钥匙', ['鍵']]);
  expect(result.crowded).not.toBe('input');
  expect(result.fuji).not.toBe('cloze');
  expect(result.thisYear).not.toBe('cloze');
  expect(result.standalone).toBe('あの＿＿＿＿は高い。');
  expect(result.twice).toBe('＿＿＿＿を見て、また＿＿＿＿に登る。');
  expect(result.insideKatakana).not.toBe('cloze');
  expect(result.katakanaAlone).toBe('＿＿＿＿をなくした。');
  expect(pageErrors).toEqual([]);
});

test('VAL-02 the named alternatives show in Japanese and survive a checkpoint restore', async ({ page }) => {
  await useIsolatedProgress(page);
  const pageErrors = await openReadyApp(page);
  await page.evaluate(() => {
    const words = [11390, 11391].map((index) => taxonomyManager.allWords.find((w) => w.index === index));
    appConfig.startStudySession(words, { practiceMode: 'mixed' });
    const mode = appConfig.studyMode;
    mode.currentExercise = JPLearn.practice.createExercise(words[0], taxonomyManager.allWords, 0, {
      preferredType: 'input',
    });
    mode.render();
  });
  const hint = page.locator('.practice-not-answers');
  await expect(hint).toHaveText('不是：キー');
  await expect(hint.locator('[lang="ja"]')).toHaveText('キー');
  await page.locator('#practiceAnswerInput').fill('キー');
  await page.keyboard.press('Enter');
  await expect(page.locator('.practice-feedback')).toContainText('回答错误');

  const restored = await page.evaluate(() => {
    const mode = appConfig.studyMode;
    const saved = mode.exportCheckpoint();
    const all = taxonomyManager.allWords;
    // A saved question keeps its own wording even when the candidate pool shrinks.
    taxonomyManager.allWords = mode.queue.slice();
    mode.restoreCheckpoint(saved);
    taxonomyManager.allWords = all;
    const kept = { exercise: mode.currentExercise, feedback: mode.exerciseFeedback };
    // A question saved before the alternatives were named is asked again.
    const legacy = JSON.parse(JSON.stringify(saved));
    delete legacy.currentExercise.notAnswers;
    mode.restoreCheckpoint(legacy);
    const reset = {
      exercise: mode.currentExercise,
      feedback: mode.exerciseFeedback,
      notice: mode.practiceNotice,
    };
    const tampered = JSON.parse(JSON.stringify(saved.currentExercise));
    tampered.notAnswers = ['鍵'];
    return {
      saved: saved.currentExercise,
      kept,
      reset,
      tampered: JPLearn.practice.restoreExercise(tampered, mode.queue[0], 0, all),
    };
  });
  expect(restored.kept.exercise).toEqual(restored.saved);
  expect(restored.kept.feedback.correct).toBe(false);
  expect(restored.reset.feedback).toBeNull();
  expect(restored.reset.notice).toContain('请重新作答');
  expect(restored.reset.exercise.notAnswers || null).not.toBeNull();
  expect(restored.tampered).toBeNull();
  expect(pageErrors).toEqual([]);
});

for (const viewport of [
  { width: 1600, height: 900 },
  { width: 1280, height: 720 },
]) {
  test(`FIX-29 feedback names the correct answer in all five tasks and after refresh at ${viewport.width}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    const stored = await useIsolatedProgress(page);
    await useAudioFixtures(page);
    const pageErrors = await openReadyApp(page);
    await page.evaluate(() => {
      const words = [12081, 11593, 11418, 10645, 8481].map((index) =>
        taxonomyManager.allWords.find((word) => word.index === index),
      );
      appConfig.startStudySession(words, { practiceMode: 'mixed' });
    });

    // A wrong Japanese-to-Chinese answer names the meaning, including after restoring feedback.
    await expect(page.locator('.practice-card')).toHaveAttribute('data-exercise-type', 'ja-zh');
    await expect(page.locator('#practicePrompt')).toHaveText('ドリンク');
    await answerChoice(page, false);
    const feedback = page.locator('.practice-feedback');
    await expect(feedback).toContainText('回答错误');
    await expect(feedback.locator('[lang="zh-CN"]')).toHaveText('饮料');
    await expect(feedback.locator('[lang="ja"]')).toHaveCount(0);
    await expect(page.locator('.practice-option.is-correct span')).toHaveText('饮料');
    await expect.poll(() => stored().navigation.vocab.studySession?.exerciseFeedback?.correct).toBe(false);
    expect(stored().navigation.vocab.studySession.currentExercise.answer).toBe('ドリンク');
    await page.goto('/');
    await page.locator('[data-dashboard-action="resume"]').click();
    await expect(feedback.locator('[lang="zh-CN"]')).toHaveText('饮料');
    await expect(feedback).toContainText('回答错误');
    const bounds = await feedback.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    await page.locator('.practice-card').screenshot({ path: testInfo.outputPath('correct-meaning.png') });
    await page.locator('#btnPracticeNext').click();

    // Japanese tasks retain kanji readings while kana-equivalent word/reading pairs appear once.
    for (const item of [
      { type: 'zh-ja', answer: 'コーヒー', choice: true },
      { type: 'listening', answer: '学校（がっこう）', choice: true },
      { type: 'input', answer: 'ビル', input: 'びる' },
      { type: 'cloze', answer: '猫（ねこ）', input: 'ねこ' },
    ]) {
      await expect(page.locator('.practice-card')).toHaveAttribute('data-exercise-type', item.type);
      if (item.choice) await answerChoice(page, true);
      else {
        await page.locator('#practiceAnswerInput').fill(item.input);
        await page.locator('#btnPracticeSubmit').click();
      }
      await expect(feedback).toContainText('回答正确');
      await expect(feedback.locator('[lang="ja"]')).toHaveText(item.answer);
      await expect(feedback.locator('[lang="zh-CN"]')).toHaveCount(0);
      await page.locator('#btnPracticeNext').click();
    }
    await expect(page.locator('.study-complete')).toBeVisible();
    expect(await page.evaluate(() => StudyStorage.getSrsRecords().length)).toBe(5);
    expect(pageErrors).toEqual([]);
  });
}
