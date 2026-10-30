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

async function openLesson(page, options = {}) {
  await useAudioFixtures(page, { absolute: true, ...options });
  const errors = await openReadyApp(page, { module: 'lesson' });
  const directory = page.locator('.tb-lesson-directory');
  await revealControl(directory.locator('summary'));
  if (!(await directory.evaluate((el) => el.open))) await directory.locator('summary').click();
  const lesson = page.locator('.tb-lesson-card[data-lesson-id="lesson_02"]');
  await revealControl(lesson);
  await lesson.click();
  await expect(page.locator('.tb-reader-body')).toBeVisible();
  await page.evaluate(() => {
    const NativeAudio = window.Audio;
    window.updatedAudio = [];
    window.Audio = function (url) {
      const audio = new NativeAudio(url);
      const row = { audio, url, start: null, end: null };
      window.updatedAudio.push(row);
      audio.playbackRate = 4;
      audio.addEventListener('playing', () => {
        if (row.start === null) row.start = audio.currentTime;
      });
      const pause = audio.pause.bind(audio);
      audio.pause = () => {
        row.end = audio.currentTime;
        pause();
      };
      return audio;
    };
  });
  return errors;
}

async function playTurn(page, index) {
  const button = page.locator(
    `.tb-turn-play-btn[data-tts-mode="dialogue:conversation"][data-turn-idx="${index}"]`,
  );
  await revealControl(button);
  await button.click();
}

async function playSection(page, mode = 'dialogue:conversation') {
  const button = page.locator(`.tb-tts-btn[data-tts-mode="${mode}"]`).first();
  await revealControl(button);
  await button.click();
}

const dialogueStatus = (page) => page.locator('[data-tts-status="dialogue:conversation"]').first();

test('new audio seeks first, middle and last turns using absolute timestamps', async ({ page }) => {
  const errors = await openLesson(page);
  for (const index of [0, 11, 22]) {
    await playTurn(page, index);
    await expect(dialogueStatus(page)).toHaveText('单句朗读完成');
    const media = await page.evaluate(() => {
      const { start, end, url } = window.updatedAudio.at(-1);
      return { start, end, url };
    });
    expect(media.url).toContain('gemini38_flash_tts_dialogue_sections_candidate_v1');
    expect(media.start).toBeGreaterThanOrEqual(index * 4.25 + 0.35);
    expect(media.start).toBeLessThan(index * 4.25 + 0.8);
    expect(media.end).toBeGreaterThan(index * 4.25 + 3.0);
    expect(media.end).toBeLessThan(index * 4.25 + 3.45);
  }
  expect(errors).toEqual([]);
});

test('unspoken and unaligned turns do not request audio or shift later turns', async ({ page }) => {
  const errors = await openLesson(page, { notSpoken: [0], unaligned: [1] });
  await playTurn(page, 0);
  await expect(dialogueStatus(page)).toHaveText('舞台说明无需朗读');
  await playTurn(page, 1);
  await expect(dialogueStatus(page)).toHaveText('本句定位待校准，请播放整段会话');
  expect(await page.evaluate(() => window.updatedAudio.length)).toBe(0);
  await playTurn(page, 2);
  await expect(dialogueStatus(page)).toHaveText('单句朗读完成');
  expect(await page.evaluate(() => window.updatedAudio.at(-1).start)).toBeGreaterThanOrEqual(8.85);
  expect(errors).toEqual([]);
});

test('whole dialogue keeps original turn indexes and never highlights an unaligned gap', async ({ page }) => {
  const errors = await openLesson(page, { notSpoken: [0], unaligned: [1] });
  await playSection(page);
  await expect
    .poll(() => page.evaluate(() => ModuleSwitcher.getTextbookModule().ttsState.loading))
    .toBe(false);
  await page.evaluate(() => {
    const audio = ModuleSwitcher.getTextbookModule().ttsState.audio;
    audio.playbackRate = 0.25;
    audio.currentTime = 9.1;
  });
  await expect(page.locator('.tb-dialogue-turn').nth(2)).toHaveClass(/tts-reading/);
  await page.evaluate(() => {
    ModuleSwitcher.getTextbookModule().ttsState.audio.currentTime = 5;
  });
  await expect(page.locator('.tb-dialogue-turn.tts-reading')).toHaveCount(0);
  await expect(dialogueStatus(page)).not.toContainText('第 ');
  expect(await page.evaluate(() => ModuleSwitcher.getTextbookModule().ttsState.segmentIndex)).toBe(-1);
  await playSection(page);
  expect(errors).toEqual([]);
});

test('invalid intervals fail visibly and retry succeeds after the timing response recovers', async ({
  page,
}) => {
  const errors = await openLesson(page);
  const timing =
    '**/gemini38_flash_tts_dialogue_sections_candidate_v1/XinBian1/02_lesson_02/conversation/manifest.json*';
  const bad = (route) =>
    route.fulfill({
      json: { schema: 2, mode: 'absolute', duration_sec: 10, turns: [{ start_sec: 5, end_sec: 4 }] },
    });
  await page.route(timing, bad);
  await playSection(page);
  await expect(dialogueStatus(page)).toHaveText('音频暂不可用，点击播放按钮重试');
  expect(await page.evaluate(() => window.updatedAudio.length)).toBe(0);
  await page.unroute(timing, bad);
  await playTurn(page, 0);
  await expect(dialogueStatus(page)).toHaveText('单句朗读完成');
  expect(errors).toEqual([]);
});

test('revised text notice is visible during reading and single-turn playback', async ({ page }) => {
  const errors = await openLesson(page, { reviewNotice: true });
  await playSection(page, 'reading:body');
  await expect(page.locator('[data-tts-status="reading:body"]').first()).toContainText(
    '音频与修订文字待核对',
  );
  await playSection(page, 'reading:body');
  await playTurn(page, 0);
  await expect(dialogueStatus(page)).toContainText('音频与修订文字待核对');
  await expect(dialogueStatus(page)).toHaveText('单句朗读完成');
  expect(errors).toEqual([]);
});
