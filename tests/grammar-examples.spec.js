const { test, expect } = require('@playwright/test');
const { DEFAULT_LAYOUT_STORAGE, openReadyApp, revealControl } = require('./helpers');

test.use({ serviceWorkers: 'block', storageState: DEFAULT_LAYOUT_STORAGE });

async function useBrowserStorage(page) {
  await page.route('**/js/storage-config.js*', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: "window.JPLearnStorageConfig = { mode: 'browser' };",
    }),
  );
}

async function openExamples(page, keyword, uid) {
  const search = page.locator('#gmSearch');
  await revealControl(search);
  await search.fill(keyword);
  const card = page.locator(`.gm-card[data-uid="${uid}"]`);
  await expect(card).toBeVisible();
  await revealControl(card);
  await card.locator('.gm-card-body').click();
  await expect(page.locator('#grammarDetailPanel')).toHaveClass(/anchored-detail-open/);
  await expect(page.locator('#gmDetailContent .gm-detail-uid')).toHaveText(uid);
  await page.locator('[data-section-target="gm-section-examples"]').click();

  const examples = page.locator('#gm-section-examples');
  const summary = examples.locator(':scope > summary');
  await expect(summary).toBeFocused();
  // Exercise the actual disclosure in addition to jumping from the outline.
  await summary.click();
  await expect(examples).not.toHaveAttribute('open');
  await summary.click();
  await expect(examples).toHaveAttribute('open', '');
  return examples;
}

function bestExampleCards(examples, title) {
  // The two recommendation groups are headed by sibling subsection titles.
  // Select only cards belonging to this title, not the following group.
  return examples
    .locator('.gm-subsec-title')
    .filter({ hasText: title })
    .locator(
      `xpath=following-sibling::div[contains(@class, "gm-ex-card")][preceding-sibling::div[contains(@class, "gm-subsec-title")][1][normalize-space(.)="${title}"]]`,
    );
}

for (const viewport of [
  { width: 1600, height: 900 },
  { width: 1280, height: 720 },
]) {
  test(`grammar translations accompany Japanese and preserve kanji-only dialogue at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await useBrowserStorage(page);
    const errors = await openReadyApp(page, { module: 'grammar' });
    let examples = await openExamples(page, 'ことだから', 'N2-028');

    const yamamoto = examples.locator('.gm-ex-card').filter({
      has: page.locator('.gm-ja').filter({ hasText: '「山本さんは遅いですね。」' }),
    });
    await expect(yamamoto).toHaveCount(1);
    await yamamoto.scrollIntoViewIfNeeded();
    await expect(yamamoto.locator('.gm-ja[lang="ja"]')).toBeVisible();
    await expect(yamamoto.locator('.gm-ja + .gm-zh')).toHaveText('“山本可真慢呀。”。');
    await expect(examples.locator('[lang="ja"]').filter({ hasText: '山本可真慢呀' })).toHaveCount(0);
    await expect(examples.locator('.gm-zh').filter({ hasText: '山本可真慢呀' })).toHaveCount(1);

    const reply = examples.locator('.gm-ex-card').filter({
      has: page.locator('.gm-ja').filter({ hasText: 'まじめなあの人のことだから必ず来ますよ' }),
    });
    await expect(reply.locator('.gm-ja + .gm-zh')).toContainText('他是个认真严谨的人，所以肯定会来的');
    await expect(examples.locator('[lang="ja"]').filter({ hasText: '认真严谨的人' })).toHaveCount(0);

    await page.keyboard.press('Escape');
    examples = await openExamples(page, 'お目にかかる', 'N4-120');
    const greeting = examples.locator('.gm-ex-card').filter({
      has: page.locator('.gm-ja').filter({ hasText: '山口「中川先生。」' }),
    });
    await expect(greeting).toHaveCount(1);
    await greeting.scrollIntoViewIfNeeded();
    await expect(greeting.locator('.gm-ja[lang="ja"]')).toHaveText('山口「中川先生。」。');
    await expect(greeting.locator('.gm-ja + .gm-zh')).toHaveText('山口：“中川老师。”。');
    await expect(examples.locator('[lang="ja"]').filter({ hasText: '中川老师' })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test(`grammar duplicate translations disappear and recommended examples resolve at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await useBrowserStorage(page);
    const errors = await openReadyApp(page, { module: 'grammar' });
    const examples = await openExamples(page, 'うかがう', 'N4-124');
    // Analysis cards have scene explanations; recommendations may legitimately
    // repeat these sentences below, so count duplication within the analysis.
    const analyzed = examples.locator('.gm-ex-card').filter({ has: page.locator('.gm-scene') });
    for (const translation of [
      '贵方秘密警察招聘的事情',
      '不需要提问。您的经历我们已经全部掌握了',
      '今晚去您府上拜访可以吗',
      '条件是你不能去排队买面包',
    ]) {
      await expect(analyzed.locator('.gm-zh').filter({ hasText: translation })).toHaveCount(1);
      await expect(examples.locator('[lang="ja"]').filter({ hasText: translation })).toHaveCount(0);
    }

    const expectedJapanese = [
      '書記長「いいですよ。ただし、パンの行列に並ばないことが条件です。」',
      '職員「質問は不要です。あなたの経歴はすでにすべて把握しております。」',
      '市民「すみません、そちらの秘密警察の求人についてちょっと伺いたいんですが。」',
    ];
    for (const [title, expected] of [
      ['最佳记忆例句', expectedJapanese],
      ['最佳对比例句', expectedJapanese.slice(0, 2)],
    ]) {
      const recommendations = bestExampleCards(examples, title);
      await expect(recommendations).toHaveCount(expected.length);
      await expect(recommendations.locator('.gm-ja[lang="ja"]')).toHaveText(expected);
      for (const recommendation of await recommendations.all()) {
        await recommendation.scrollIntoViewIfNeeded();
        await expect(recommendation.locator('.gm-ja')).toBeVisible();
        await expect(recommendation.locator('.gm-ja + .gm-zh')).not.toBeEmpty();
      }
    }
    expect(errors).toEqual([]);
  });
}

// The samples on the target-grammar briefs mark their grammar as [[TEXT]],
// without a uid. The reader shows it in bold instead of the raw marks.
test('auxiliary lesson briefs show the marked grammar in bold, not as [[ ]]', async ({ page }) => {
  await useBrowserStorage(page);
  const errors = await openReadyApp(page, { module: 'grammar' });
  await revealControl(page.locator('#gmSideNavLesson'));
  await page.locator('#gmSideNavLesson').click();
  await revealControl(page.locator('.gm-lesson-card').first());
  await page.locator('.gm-lesson-card').first().click();

  const briefs = page.locator('#gmReaderTargets .gm-brief-card');
  await expect(briefs.first()).toBeVisible();
  const sample = briefs.first().locator('.gm-brief-sample-ja');
  await expect(sample).toHaveText('我々のささやかな幸福も、共産党の正しい指導あってのものです。');
  await expect(sample.locator('strong')).toHaveText('あっての');
  for (const text of await briefs.allTextContents()) expect(text).not.toMatch(/\[\[|\]\]/);

  // Some translations are marked too, a sample can hold two marks, and text
  // inside and outside the marks stays escaped.
  const html = await page.evaluate(() =>
    Object.create(window.LessonReaderView.prototype)._renderGrammarBrief({
      uid: 'N5-036',
      sample_ja: '[[長<b>い</b>]]列と[[短い]]列<i>',
      sample_zh: '排在[[长]]队里',
    }),
  );
  expect(html).toContain('<strong>長&lt;b&gt;い&lt;/b&gt;</strong>列と<strong>短い</strong>列&lt;i&gt;');
  expect(html).toContain('排在<strong>长</strong>队里');
  expect(html).not.toContain('[[');
  expect(errors).toEqual([]);
});

// Chinese paragraphs carry the grammar marks of the Japanese text, mostly as
// [[UID::TEXT]]. They show the marked words in bold only: the Japanese
// paragraphs keep the clickable grammar.
test('auxiliary lesson Chinese paragraphs show marked grammar in bold only', async ({ page }) => {
  await useBrowserStorage(page);
  const errors = await openReadyApp(page, { module: 'grammar' });
  await revealControl(page.locator('#gmSideNavLesson'));
  await page.locator('#gmSideNavLesson').click();
  await revealControl(page.locator('.gm-lesson-card').nth(1));
  await page.locator('.gm-lesson-card').nth(1).click();

  const reader = page.locator('#gmLessonReader');
  const chinese = reader.locator('.gm-para-zh');
  await expect(chinese).toHaveCount(6);
  await expect(chinese.filter({ hasText: '开门的铃声刚刚响过' }).locator('strong')).toHaveText(['刚刚响过']);
  await expect(chinese.locator('strong')).toHaveCount(10);
  await expect(chinese.locator('button')).toHaveCount(0);
  for (const text of await chinese.allTextContents()) expect(text).not.toMatch(/\[\[|\]\]|::/);
  await expect(reader.locator('.gm-para-ja button.gm-grammar-known').first()).toBeAttached();

  // Paragraphs without a uid in their marks (lesson 73) and markup inside a
  // mark take the same path.
  const html = await page.evaluate(() =>
    window.GrammarInlineParser.renderStrong('车[[还没]]来[[N1-019::<b>]]'),
  );
  expect(html).toBe('车<strong>还没</strong>来<strong>&lt;b&gt;</strong>');
  expect(errors).toEqual([]);
});

// Example sentences, counter-examples, drills and error patterns in grammar
// details mark the grammar as [[TEXT]]; the detail shows it in bold.
test('grammar details show marked grammar in bold, not as [[ ]]', async ({ page }) => {
  await useBrowserStorage(page);
  const errors = await openReadyApp(page, { module: 'grammar' });
  for (const [keyword, uid, selector, text, marks] of [
    // Example analysis, repeated as the best example for memory.
    [
      'にせよ',
      'N2-098',
      '.gm-ja',
      '賛成するにせよ反対するにせよ、結局は党の決定に従うほかないのだ。',
      ['にせよ', 'にせよ'],
    ],
    ['いくつ', 'N5-039', '.gm-zh', '配给的面包有几个？', ['几个']],
    ['それとも', 'N5-073', 'li', 'バスで行きますか。それとも、電車で行きますか。', ['それとも']],
    ['ながら', 'N2-079', '.gm-anti-ja', '弟が勉強しながら、私はテレビを見た。', ['ながら']],
    ['ご覧いただく', 'N4-121', 'li', '私が先生の写真をご覧いただきました。', ['ご覧いただきました']],
  ]) {
    await openExamples(page, keyword, uid);
    const content = page.locator('#gmDetailContent');
    await expect(content).not.toContainText('[[');
    await expect(content).not.toContainText(']]');
    const sentences = content.locator(selector).filter({ hasText: text });
    await expect(sentences).not.toHaveCount(0);
    for (const sentence of await sentences.all()) await expect(sentence.locator('strong')).toHaveText(marks);
    await page.keyboard.press('Escape');
  }
  expect(errors).toEqual([]);
});

// Difference notes are {grammar, note} pairs. The 辨析要点 row lists each as
// "grammar：note" instead of "[object Object]".
test('grammar difference notes show each grammar with its note', async ({ page }) => {
  await useBrowserStorage(page);
  const errors = await openReadyApp(page, { module: 'grammar' });
  for (const [keyword, uid, notes] of [
    [
      'あっての',
      'N1-001',
      '～ゆえに：表示书面语的因果关系，侧重于“因为这个理由，所以导致那个结果”，不强调“存在的前提”。',
    ],
    [
      'でも何でもない',
      'N1-065',
      '～でも何でもない：侧重于“质”的否定，即“根本不具备某种资格或属性”。；～くも何ともない：侧重于“感官或程度”的否定，即“完全没有某种感觉”。',
    ],
  ]) {
    await openExamples(page, keyword, uid);
    const row = page
      .locator('#gm-section-confusable .gm-kv')
      .filter({ has: page.locator('.gm-k', { hasText: '辨析要点' }) });
    await expect(row.locator('.gm-v')).toHaveText(notes);
    await expect(page.locator('#gmDetailContent')).not.toContainText('[object Object]');
    await page.keyboard.press('Escape');
  }

  // Empty notes leave the row out, older plain strings still show, and the
  // text stays escaped.
  const html = await page.evaluate(() => {
    const panel = Object.create(window.GrammarDetailPanel.prototype);
    return {
      pairs: panel._renderConfusable({
        difference_notes: [
          { grammar: 'A<i>', note: '甲' },
          { grammar: 'B', note: '乙' },
        ],
      }),
      empty: panel._renderConfusable({ difference_notes: [] }),
      text: panel._renderConfusable({ difference_notes: '旧格式说明' }),
    };
  });
  expect(html.pairs).toContain('A&lt;i&gt;：甲；B：乙');
  expect(html.empty).not.toContain('辨析要点');
  expect(html.text).toContain('旧格式说明');
  expect(errors).toEqual([]);
});
