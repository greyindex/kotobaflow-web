// PUB-04-EXAMPLES: example sentences play clips packed under data/example_audio_v1.
// The packs are generated, ignored by Git and absent here, so each test serves
// a two-clip pack made of silent Ogg/Opus and keys it with the page's own hash.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test, expect } = require('@playwright/test');
const { openReadyApp } = require('./helpers');
const { silentOgg } = require('./audio-fixtures');

const keys = (() => {
  const file = path.join(__dirname, '..', 'js/core/example-audio.js');
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox);
  return sandbox.window.JPLearn.exampleAudio;
})();

const clips = [silentOgg(2), silentOgg(2)];
const pack = Buffer.concat(clips);

// Serves index, one shard and one pack. The shard is filled once the test has
// read the example texts; the third example is left out on purpose.
async function serveExamples(page, { ranges = true } = {}) {
  const state = { shard: {}, packRequests: [] };
  await page.route('**/data/example_audio_v1/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/index.json'))
      return route.fulfill({
        json: {
          schema: 1,
          hash: keys.HASH,
          shardBits: 0,
          clips: 2,
          keys: 2,
          packs: ['packs/fixture.ogg'],
          shards: ['shards/0-fixture.json'],
        },
      });
    if (url.endsWith('/shards/0-fixture.json')) return route.fulfill({ json: state.shard });
    if (url.endsWith('/packs/fixture.ogg')) {
      const range = route.request().headers().range || '';
      state.packRequests.push(range);
      const match = /^bytes=(\d+)-(\d+)$/.exec(range);
      if (!ranges || !match) return route.fulfill({ status: 200, contentType: 'audio/ogg', body: pack });
      const start = Number(match[1]);
      const end = Number(match[2]);
      return route.fulfill({
        status: 206,
        contentType: 'audio/ogg',
        headers: { 'Content-Range': `bytes ${start}-${end}/${pack.length}` },
        body: pack.subarray(start, end + 1),
      });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  return state;
}

async function openWordDetail(page) {
  const errors = await openReadyApp(page, { exampleAudio: true });
  await page.locator('.cc-card').first().locator('.cc-card-body').click();
  const detail = page.locator('#detailContent .vocab-detail');
  await expect(detail).toBeVisible();
  return { errors, detail };
}

// Voices the first two examples of the open word, in pack order.
async function voiceFirstTwo(state, buttons) {
  const texts = await buttons.evaluateAll((items) => items.map((item) => item.dataset.exampleAudio));
  expect(texts.length).toBeGreaterThanOrEqual(3);
  state.shard[keys.textKey(texts[0])] = [0, 0, clips[0].length];
  state.shard[keys.textKey(texts[1])] = [0, clips[0].length, clips[1].length];
}

test('example audio buttons stay hidden when the site has no packs', async ({ page }) => {
  let indexRequests = 0;
  await page.route('**/data/example_audio_v1/**', (route) => {
    if (route.request().url().endsWith('/index.json')) indexRequests++;
    return route.fulfill({ status: 404, body: '' });
  });
  const { errors, detail } = await openWordDetail(page);
  const buttons = detail.locator('.example-audio-btn');
  await expect(buttons.first()).toBeAttached();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('html')).not.toHaveAttribute('data-example-audio', /.+/);
  await expect(buttons.first()).toBeHidden();
  // The 404 is remembered: another word's detail does not ask again.
  await page.keyboard.press('Escape');
  await page.locator('.cc-card').nth(1).locator('.cc-card-body').click();
  await expect(detail.locator('.example-audio-btn').first()).toBeAttached();
  await page.waitForLoadState('networkidle');
  expect(indexRequests).toBe(1);
  expect(errors).toEqual([]);
});

test('example audio plays clips by byte range, one at a time, and reports a missing clip', async ({
  page,
}) => {
  const state = await serveExamples(page);
  const { errors, detail } = await openWordDetail(page);
  await expect(page.locator('html')).toHaveAttribute('data-example-audio', 'ready');
  const buttons = detail.locator('.example-audio-btn');
  await expect(buttons.first()).toBeVisible();
  await expect(buttons.first()).toHaveAccessibleName('朗读例句');
  await voiceFirstTwo(state, buttons);

  await buttons.nth(0).click();
  await expect(buttons.nth(0)).toHaveAttribute('data-state', 'playing');
  await expect(buttons.nth(0)).toHaveAttribute('aria-pressed', 'true');
  await buttons.nth(1).click();
  await expect(buttons.nth(1)).toHaveAttribute('data-state', 'playing');
  await expect(buttons.nth(0)).toHaveAttribute('data-state', 'idle');
  expect(state.packRequests).toEqual([
    `bytes=0-${clips[0].length - 1}`,
    `bytes=${clips[0].length}-${pack.length - 1}`,
  ]);

  // Pressing a playing example again stops it.
  await buttons.nth(1).click();
  await expect(buttons.nth(1)).toHaveAttribute('data-state', 'idle');

  await buttons.nth(2).click();
  await expect(buttons.nth(2)).toHaveAttribute('data-state', 'missing');
  await expect(buttons.nth(2)).toHaveAccessibleName('这句暂无配音');
  await expect(detail.locator('.example-audio-note')).toHaveText('这句暂无配音');

  // Word audio stops a playing example.
  await buttons.nth(0).click();
  await expect(buttons.nth(0)).toHaveAttribute('data-state', 'playing');
  await detail.locator('.vocab-detail-audio').click();
  await expect(buttons.nth(0)).toHaveAttribute('data-state', 'idle');
  expect(errors).toEqual([]);
});

// The ready marker on <html> uses the buttons' attribute; a click elsewhere
// must keep its default action and leave the playing example alone.
test('clicks outside example buttons keep their own behaviour once audio is ready', async ({ page }) => {
  const state = await serveExamples(page);
  const { errors, detail } = await openWordDetail(page);
  await expect(page.locator('html')).toHaveAttribute('data-example-audio', 'ready');
  const buttons = detail.locator('.example-audio-btn');
  await expect(buttons.first()).toBeVisible();
  await voiceFirstTwo(state, buttons);
  await buttons.nth(0).click();
  await expect(buttons.nth(0)).toHaveAttribute('data-state', 'playing');

  const cancelled = await detail.evaluate((element) => {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(cancelled).toBe(false);
  await expect(buttons.nth(0)).toHaveAttribute('data-state', 'playing');
  await expect(page.locator('html')).not.toHaveAttribute('aria-pressed', /.*/);
  await expect(page.locator('html')).not.toHaveAttribute('title', /.*/);
  expect(errors).toEqual([]);
});

test('example audio cuts clips from a whole pack when ranges are ignored', async ({ page }) => {
  const state = await serveExamples(page, { ranges: false });
  const { errors, detail } = await openWordDetail(page);
  const buttons = detail.locator('.example-audio-btn');
  await expect(buttons.first()).toBeVisible();
  await voiceFirstTwo(state, buttons);

  await buttons.nth(1).click();
  await expect(buttons.nth(1)).toHaveAttribute('data-state', 'playing');
  await buttons.nth(0).click();
  await expect(buttons.nth(0)).toHaveAttribute('data-state', 'playing');
  // The second clip comes from the pack already in memory.
  expect(state.packRequests).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('grammar examples get audio buttons and counter-examples do not', async ({ page }) => {
  const errors = await openReadyApp(page);
  const html = await page.evaluate(() => {
    const panel = Object.create(window.GrammarDetailPanel.prototype);
    return {
      examples: panel._renderExamples({ example_analysis: [{ ja: '[[雨]]が降る。', zh: '下雨。' }] }, {}),
      fallback: panel._renderExamples({}, { originalExamples: ['本を読む。'] }),
      counter: panel._renderErrors({ anti_examples: [{ ja: '雨が降るです。', zh: '错句' }] }),
    };
  });
  expect(html.examples).toContain('data-example-audio="[[雨]]が降る。"');
  expect(html.fallback).toContain('data-example-audio="本を読む。"');
  expect(html.counter).not.toContain('example-audio-btn');
  expect(keys.textKey('[[雨]]が降る。')).toBe(keys.textKey('雨が降る。'));
  expect(errors).toEqual([]);
});
