const { revealControl, openSettings, closeSidebar } = require('./helpers');
const { test, expect } = require('@playwright/test');
const { openReadyApp, expectRegionsWithinViewport, expectReadable } = require('./helpers');

async function useProgress(page, vocabulary = {}) {
  let stored = { version: 2, vocabulary, navigation: {}, usage: {}, updatedAt: '' };
  await page.route('**/api/progress', async (route) => {
    if (route.request().method() === 'POST') stored = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stored) });
  });
}

test('FIX-27 activity minutes refresh before the next colour threshold', async ({ page }) => {
  await useProgress(page);
  await page.clock.install({ time: new Date('2026-10-06T12:00:00+08:00') });
  const errors = await openReadyApp(page, { module: 'dashboard' });
  const graph = page.locator('[data-activity-graph]');
  await graph.locator('.cg-cell.is-today').focus();
  await graph.locator('.cg-months-table > summary').click();
  await graph.locator('.cg-cell.is-today').focus();
  // Count a few ticks so today reaches the first colour level, then jump the
  // rest: the one-second tick measures elapsed time, and stepping 125 s of
  // animation frames one by one could outlast the test timeout.
  await page.clock.runFor(5_000);
  await expect(graph.locator('.cg-cell.is-today')).toHaveAttribute('data-level', '1');
  await page.clock.fastForward(120_000);
  await page.clock.runFor(1_000);
  expect(
    await page.evaluate(() => ProgressStore.getActivityGraph('recent').totals.focusedMs),
  ).toBeGreaterThan(120_000);
  await expect(graph.locator('.cg-cell.is-today')).toHaveAttribute('data-level', '1');
  await expect(graph.locator('.cg-summary-line')).toContainText('专注 2 分钟');
  await expect(graph.locator('.cg-detail')).toContainText('专注 2 分钟');
  await expect(graph.locator('.cg-cell.is-today')).toHaveAccessibleName(/专注 2 分钟/);
  await expect(graph.locator('.cg-cell.is-today')).toBeFocused();
  await expect(graph.locator('.cg-months-table')).toHaveAttribute('open');
  await expect(graph.locator('.cg-months-table tbody')).toContainText('2 分钟');
  expect(errors).toEqual([]);
});

for (const [width, height] of [
  [1600, 900],
  [1280, 720],
  [390, 844],
]) {
  test(`FIX-27 activity Home and End use chronological boundaries at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await useProgress(page);
    await page.clock.install({ time: new Date('2026-10-06T12:00:00+08:00') });
    const errors = await openReadyApp(page, { module: 'dashboard' });
    const graph = page.locator('[data-activity-graph]');
    await graph.locator('.cg-cell.is-today').focus();
    // Fixed Tuesday: the rolling 365-day range starts on Tuesday too; the
    // narrow fourth-quarter range starts on Thursday. Neither is a Sunday row.
    const firstDate = width === 390 ? '2026-10-01' : '2025-10-07';
    await page.keyboard.press('Home');
    await expect(graph.locator(`.cg-cell[data-date="${firstDate}"]`)).toBeFocused();
    await page.keyboard.press('End');
    await expect(graph.locator('.cg-cell[data-date="2026-10-06"]')).toBeFocused();
    await expect(graph.locator('.cg-cell[tabindex="0"]')).toHaveCount(1);
    await graph.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `local/qa/claude55-review-20261003/activity-${width}.png` });
    expect(errors).toEqual([]);
  });
}

for (const input of ['pointer', 'keyboard']) {
  test(`review regression: textbook example lookup preserves the popup and ${input} return focus`, async ({
    page,
  }) => {
    await useProgress(page);
    const errors = await openReadyApp(page, { module: 'lesson' });
    await revealControl(page.locator('.tb-lesson-directory > summary'));
    await page.locator('.tb-lesson-directory > summary').click();
    await page.locator('.tb-lesson-card').nth(1).click();
    const popup = page.getByRole('dialog', { name: '课文词汇详情', exact: true });
    const close = page.locator('#textbookDetailCollapseBtn');
    for (const [word, selector] of [
      ['これ', '#tbReader .tb-inline-highlight-link'],
      ['荷物', '#tbReader .tb-reading-vocab-open'],
    ]) {
      const trigger = page
        .locator(selector)
        .and(
          page.getByRole('button', {
            name: `查看词汇详情：${word}`,
            exact: true,
          }),
        )
        .first();
      await revealControl(trigger);
      await trigger.press('Enter');
      await expect(close).toBeFocused();
      for (let repeat = 0; repeat < 2; repeat++) {
        const nested = popup.getByRole('button', { name: `查看词汇详情：${word}`, exact: true }).first();
        if (input === 'keyboard') await nested.press('Enter');
        else await nested.click();
        await expect(popup).toBeVisible();
        await expect(popup.getByRole('heading', { name: word, exact: true })).toBeVisible();
        if (input === 'keyboard') await expect(close).toBeFocused();
      }
      await page.keyboard.press('Escape');
      await expect(popup).toBeHidden();
      await expect(trigger).toBeFocused();
      await expect(page.locator('[data-detail-anchor-active]')).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });
}

for (const state of ['empty', 'partial', 'complete']) {
  test(`W-02 due review distinguishes ${state} queues`, async ({ page }) => {
    await useProgress(page, {
      known: state === 'complete' ? [1, 2] : [],
      unknown: state === 'partial' ? [1, 2] : [],
      history:
        state === 'empty'
          ? []
          : [{ date: new Date().toISOString(), total: 2, source: { kind: 'daily-review' } }],
    });
    const errors = await openReadyApp(page, { module: 'dashboard' });
    const review = page.locator('[data-dashboard-insight="review"]');
    const progress = review.getByRole('progressbar');
    if (state === 'empty') {
      await expect(review).toContainText('暂无到期词');
      await expect(progress).toHaveCount(0);
      await expect(review).not.toContainText('100%');
    } else {
      await expect(progress).toHaveAttribute('aria-valuenow', state === 'partial' ? '50' : '100');
      await expect(review).toContainText(state === 'partial' ? '2 / 4' : '2 / 2');
      if (state === 'partial') {
        await review.getByRole('button', { name: /继续复习 2 词/ }).click();
        await expect(page.locator('#statusStudyQueue')).toHaveText('2');
        await expect(page.locator('#vocabMain')).toBeVisible();
      } else {
        await expect(review).toContainText('今日到期复习已完成');
        await expect(review.getByRole('button')).toHaveCount(0);
      }
    }
    expect(errors).toEqual([]);
  });
}

for (const theme of ['light', 'dark']) {
  test(`W-02 ${theme} goal text and grammar navigation remain readable`, async ({ page }) => {
    await useProgress(page);
    await openReadyApp(page, { module: 'dashboard' });
    await openSettings(page);
    await page.locator('#appThemeSelect').selectOption(theme);
    await page.keyboard.press('Escape');
    await closeSidebar(page);
    await expectReadable(
      page.locator(
        '.dashboard-progress-note, .dashboard-section-title > small, .dashboard-insight-label, .dashboard-insight-card p',
      ),
    );
    await page.locator('#modBtnGrammar').click();
    await page.getByRole('button', { name: '查看语法 ～あっての', exact: true }).click();
    const nav = page.getByRole('navigation', { name: '语法详情章节' });
    await expectReadable(nav.getByRole('button'));
    const connection = nav.getByRole('button', { name: '接续', exact: true });
    await connection.hover();
    await expectReadable(connection);
    await connection.focus();
    await expectReadable(connection);
    await connection.press('Enter');
    await expect(connection).toHaveClass(/active/);
    await expectReadable(connection);
    await expect(page.locator('#gm-section-connection')).toContainText('名A + (が)あっての + 名B');
    await expect(page.locator('#gm-section-connection .gm-k')).toHaveCount(0);
    await nav.getByRole('button', { name: '例句', exact: true }).click();
    // Six analyzed examples, three memory examples and two contrast examples remain available.
    await expect(page.locator('#gm-section-examples .gm-ex-card')).toHaveCount(11);
    await expect(page.locator('#gm-section-examples')).not.toContainText('例句解析');
  });
}

for (const scenario of [
  { label: '390px', viewport: { width: 390, height: 844 }, scale: '1' },
  { label: '150% at 1280px', viewport: { width: 1280, height: 720 }, scale: '1.5' },
]) {
  test(`W-02 shared detail controls fit ${scenario.label} and return focus`, async ({ page }) => {
    await useProgress(page);
    await page.setViewportSize(scenario.viewport);
    await openReadyApp(page, { module: 'grammar' });
    await openSettings(page);
    await page.locator('#appScaleSelect').selectOption(scenario.scale);
    await page.keyboard.press('Escape');
    await closeSidebar(page);
    const assertPanelFits = async (selector) => {
      await expect
        .poll(async () => {
          const box = await page.locator(selector).boundingBox();
          const sidebar = await page.locator('#unifiedSidebar').boundingBox();
          return (
            !!box &&
            box.x >= sidebar.x + sidebar.width &&
            box.x + box.width <= scenario.viewport.width &&
            box.y >= 0 &&
            box.y + box.height <= scenario.viewport.height
          );
        })
        .toBe(true);
      await expectRegionsWithinViewport(page, [selector, `${selector} .detail-collapse-btn`]);
    };
    const grammarCard = page.locator('.gm-card').first();
    await grammarCard.press('Enter');
    await expect(page.locator('.gm-detail-outline')).toBeVisible();
    await assertPanelFits('#grammarDetailPanel');
    for (const label of ['展开阅读', '收回浮窗']) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await assertPanelFits('#grammarDetailPanel');
    }
    await page.getByRole('button', { name: '关闭语法详情', exact: true }).click();
    await expect(grammarCard).toBeFocused();
    await page.locator('#modBtnVocab').click();
    const word = page.locator('.cc-card-body').first();
    await word.press('Enter');
    await assertPanelFits('#detailPanel');
    await page.locator('#detailPanel .detail-collapse-btn').click();
    await expect(word).toBeFocused();
    await page.locator('#modBtnLesson').click();
    await page.locator('#tabletSidebarToggle').click();
    await revealControl(page.locator('.tb-lesson-directory > summary'));
    await page.locator('.tb-lesson-directory > summary').click();
    await revealControl(page.locator('.tb-lesson-card').nth(1));
    await page.locator('.tb-lesson-card').nth(1).click();
    const inlineWord = page.locator('.tb-inline-highlight-link').first();
    await revealControl(inlineWord);
    await inlineWord.press('Enter');
    await assertPanelFits('#textbookDetailPanel');
    await page.keyboard.press('Escape');
    await expect(inlineWord).toBeFocused();
    await expect(page.locator('#textbookDetailPanel')).toBeHidden();
  });
}

test('W-02 inline reading keeps one active word and clears it on close or module change', async ({
  page,
}) => {
  await useProgress(page);
  await openReadyApp(page, { module: 'lesson' });
  await revealControl(page.locator('.tb-lesson-directory > summary'));
  await page.locator('.tb-lesson-directory > summary').click();
  await revealControl(page.locator('.tb-lesson-card').filter({ hasText: '大学の生活' }));
  await page.locator('.tb-lesson-card').filter({ hasText: '大学の生活' }).click();
  const morning = page.getByRole('button', { name: '查看词汇详情：毎朝', exact: true }).first();
  const evening = page.getByRole('button', { name: '查看词汇详情：毎晩', exact: true }).first();
  for (const theme of ['light', 'dark']) {
    await openSettings(page);
    await page.locator('#appThemeSelect').selectOption(theme);
    await page.keyboard.press('Escape');
    await closeSidebar(page);
    await expect(morning).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await revealControl(morning);
    await morning.click();
    await expect(page.locator('#textbookDetailPanel')).toBeVisible();
    await expect(morning).toHaveAttribute('data-detail-anchor-active', 'true');
    await expect(morning).toHaveCSS('outline-style', 'solid');
    await evening.click();
    await expect(evening).toHaveAttribute('data-detail-anchor-active', 'true');
    await expect(morning).not.toHaveAttribute('data-detail-anchor-active');
    await expect(page.locator('.tb-inline-highlight-link[data-detail-anchor-active]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(evening).toBeFocused();
    await expect(page.locator('[data-detail-anchor-active]')).toHaveCount(0);
    await morning.press('Enter');
    await page.locator('#modBtnVocab').click();
    await expect(page.locator('[data-detail-anchor-active]')).toHaveCount(0);
    await expect(page.locator('#textbookDetailPanel')).toBeHidden();
    await page.locator('#modBtnLesson').click();
  }
});

test('UI-ART-01 catalogs share one paper column with quiet cards and a one-row grammar index', async ({
  page,
}) => {
  await useProgress(page);
  const errors = await openReadyApp(page);
  const card = page.locator('.cc-card').first();
  await expect(card).toBeVisible();

  // Japanese text uses a Japanese face even with the Chinese-first UI font.
  const exampleFont = await card.locator('.cc-example-ja').evaluate((el) => getComputedStyle(el).fontFamily);
  expect(exampleFont).not.toMatch(/^"?Microsoft YaHei/);
  await expect(card.locator('.cc-level')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(card.locator('.cc-ex-label').first()).toBeHidden();

  // Secondary actions stay out of the way until the card is hovered or focused.
  await page.mouse.move(2, 2);
  await expect(card.locator('.cc-card-actions')).toHaveCSS('opacity', '0');
  await card.hover();
  await expect(card.locator('.cc-card-actions')).toHaveCSS('opacity', '1');
  await page.mouse.move(2, 2);
  await card.locator('.cc-card-body').focus();
  await expect(card.locator('.cc-card-actions')).toHaveCSS('opacity', '1');

  const vocabEdges = await page.evaluate(() => ({
    heading: document.querySelector('#vocabHeading .page-heading-copy').getBoundingClientRect().left,
    grid: document.querySelector('.cc-grid').getBoundingClientRect().left,
  }));
  expect(Math.abs(vocabEdges.heading - vocabEdges.grid)).toBeLessThanOrEqual(2);

  await page.locator('#modBtnGrammar').click();
  await expect(page.locator('.gm-card').first()).toBeVisible();
  const rows = await page.locator('#gmGrammarList').evaluate((pane) => {
    const gridEl = pane.querySelector('.gm-card-grid');
    const style = getComputedStyle(gridEl);
    const grid = {
      width: gridEl.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
    };
    return Array.from(pane.querySelectorAll('.gm-card'))
      .slice(0, 8)
      .map((card) => ({
        width: card.getBoundingClientRect().width,
        gridWidth: grid.width,
        meaningLeft: card.querySelector('.gm-card-meaning').getBoundingClientRect().left,
        index: getComputedStyle(card.querySelector('.gm-card-idx')).display,
      }));
  });
  for (const row of rows) {
    expect(Math.abs(row.width - row.gridWidth)).toBeLessThanOrEqual(1);
    expect(row.index).toBe('none');
  }
  expect(
    Math.max(...rows.map((r) => r.meaningLeft)) - Math.min(...rows.map((r) => r.meaningLeft)),
  ).toBeLessThanOrEqual(1);
  const grammarEdges = await page.evaluate(() => ({
    heading: document.querySelector('#grammarHeading .page-heading-copy').getBoundingClientRect().left,
    list: document.querySelector('#gmGrammarList .gm-card').getBoundingClientRect().left,
  }));
  expect(Math.abs(grammarEdges.heading - grammarEdges.list)).toBeLessThanOrEqual(2);
  expect(errors).toEqual([]);
});

test('UI-ART-01 Today shows every learning signal to a new learner in short lines', async ({ page }) => {
  await useProgress(page);
  const errors = await openReadyApp(page, { module: 'dashboard' });
  const insights = page.locator('[data-dashboard-insights]');
  for (const name of ['content', 'trend', 'weak']) {
    await expect(insights.locator(`[data-dashboard-insight="${name}"]`)).toBeVisible();
  }
  await expect(insights.locator('[data-dashboard-insight="review"]')).toContainText('暂无到期词');
  await expect(insights.locator('[data-dashboard-insight="trend"]')).toContainText('最近 7 天还没有');
  await expect(insights.locator('[data-dashboard-insight="weak"]')).toContainText('还没有标记');
  // Section slogans are gone; what remains names the panel.
  for (const slogan of ['需要关注的进度', '把真实进步留在桌面上', '刚刚走过的路', '完成第一组学习后']) {
    await expect(page.locator('#dashboardMain')).not.toContainText(slogan);
  }
  await expect(page.locator('.dashboard-heading h1')).toContainText('今日学习');
  expect(
    await page.locator('.dashboard-heading h1').evaluate((el) => getComputedStyle(el, '::after').content),
  ).toBe('none');
  expect(errors).toEqual([]);
});

test('UI-ART-02 drawer keeps every filter in one calm, scrollable module panel', async ({ page }) => {
  await useProgress(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  const errors = await openReadyApp(page);
  await revealControl(page.locator('#vocabLevelChips'));
  const vocab = await page.locator('#sidebar').evaluate((aside) => {
    const style = (sel) => getComputedStyle(aside.querySelector(sel));
    const chips = Array.from(aside.querySelectorAll('#vocabLevelChips .vocab-filter-chip'));
    return {
      inDrawer: !!aside.closest('#unifiedSidebar'),
      panelScrolls: getComputedStyle(aside).overflowY,
      sectionScrolls: style('.filter-section').overflowY,
      chipRows: new Set(chips.map((chip) => Math.round(chip.getBoundingClientRect().top))).size,
      badge: style('.sidebar-header .badge').backgroundColor,
      clearBand: style('.filter-actions').backgroundColor,
      groupBorder: style('.advanced-filters').borderLeftWidth,
    };
  });
  expect(vocab).toEqual({
    inDrawer: true,
    panelScrolls: 'auto',
    sectionScrolls: 'visible',
    chipRows: 1,
    badge: 'rgba(0, 0, 0, 0)',
    clearBand: 'rgba(0, 0, 0, 0)',
    groupBorder: '0px',
  });
  // The plan card below the filters is reachable by scrolling the one panel.
  await page.locator('.vocab-plan-card').scrollIntoViewIfNeeded();
  await expect(page.locator('.vocab-plan-card')).toBeInViewport();
  await page.locator('[data-vocab-level="N5"]').click();
  await expect(page.locator('#vocabHeading .page-heading-title')).toHaveText('JLPT N5 词汇');
  await expectReadable(page.locator('#vocabLevelChips .vocab-filter-chip.active'));
  await page.keyboard.press('Escape');

  await page.locator('#modBtnGrammar').click();
  await revealControl(page.locator('#gmSidebarFilters .gm-tab.active'));
  await expectReadable(page.locator('.gm-sidebar-nav-btn.active, #gmSidebarFilters .gm-tab.active'));
  expect(errors).toEqual([]);
});

test('EXP-LEARN-04 activity graph aggregates local days like a GitHub contribution graph', async ({
  page,
}) => {
  await useProgress(page);
  const errors = await openReadyApp(page, { module: 'dashboard' });
  const result = await page.evaluate(() => {
    const day = (minutes, checkedIn = false) => ({ focusedMs: minutes * 60000, checkedIn });
    const usage = {
      '2027-12-31': day(5),
      '2028-01-01': day(12),
      '2028-02-29': day(45),
      '2028-03-01': day(61, true),
      '2028-02-30': day(99, true),
      'not-a-date': day(99, true),
      '2028-06-01': day(30),
    };
    const graph = (range, today) => window.ProgressStore.getActivityGraph(range, today, usage);
    const cells = (model) => model.weeks.flat().filter(Boolean);
    const level = (model, key) => cells(model).find((cell) => cell.key === key);
    const y2028 = graph('2028', new Date(2028, 2, 15));
    const recent = graph('recent', new Date(2028, 0, 3));
    const empty = graph('2026', new Date(2028, 2, 15));
    return {
      y2028: {
        first: y2028.first,
        last: y2028.last,
        leap: level(y2028, '2028-02-29').level,
        checked: level(y2028, '2028-03-01').level,
        future: level(y2028, '2028-06-01').future,
        totals: y2028.totals,
        days: cells(y2028).length,
        firstWeekday: y2028.weeks[0].findIndex(Boolean),
        years: y2028.years,
      },
      recent: {
        span: [recent.first, recent.last],
        crossYear: [level(recent, '2027-12-31').level, level(recent, '2028-01-01').level],
        firstColumnSunday: recent.weeks[0][0] === null || recent.weeks[0][0].weekday === 0,
        months: recent.months.length,
      },
      empty: { days: empty.totals.days, cells: cells(empty).length },
    };
  });
  expect(result.y2028).toEqual({
    first: '2028-01-01',
    last: '2028-12-31',
    leap: 3,
    checked: 4,
    future: true,
    totals: { days: 3, focusedMs: (12 + 45 + 61) * 60000, checked: 1 },
    days: 366,
    firstWeekday: 6,
    years: [2028, 2027],
  });
  expect(result.recent).toEqual({
    span: ['2027-01-04', '2028-01-03'],
    crossYear: [1, 2],
    firstColumnSunday: true,
    months: 13,
  });
  expect(result.empty).toEqual({ days: 0, cells: 365 });
  expect(errors).toEqual([]);
});

test('EXP-LEARN-04 check-in popover shows the year graph with keyboard and year controls', async ({
  page,
}) => {
  const today = new Date();
  const key = (date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const lastWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7);
  const usage = {
    [key(lastWeek)]: { focusedMs: 75 * 60000, checkedIn: true, checkins: 1 },
    '2024-05-06': { focusedMs: 20 * 60000, checkedIn: false, checkins: 0 },
  };
  let stored = { version: 2, vocabulary: {}, navigation: {}, usage };
  await page.route('**/api/progress', async (route) => {
    if (route.request().method() === 'POST') stored = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stored) });
  });
  const errors = await openReadyApp(page);
  const toggle = page.locator('#progressCalendarToggle');
  await revealControl(toggle);
  await toggle.click();
  const graph = page.locator('#progressCalendar');
  await expect(graph).toHaveClass(/open/);
  await expect(graph).toBeInViewport();
  await expect(graph.locator('.cg-grid[role="grid"] [role="row"]')).toHaveCount(7);
  const columns = await graph
    .locator('.cg-body')
    .evaluate((el) => Number(el.style.getPropertyValue('--cg-weeks')));
  expect(columns).toBeGreaterThanOrEqual(53);
  await expect(graph.locator(`.cg-cell[data-date="${key(lastWeek)}"]`)).toHaveAttribute('data-level', '4');
  await expect(graph.locator('.cg-cell.is-today')).toHaveAttribute('tabindex', '0');
  await expect(graph.locator('.cg-summary-line strong')).toContainText('过去一年学习');

  await graph.locator('.cg-cell.is-today').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(graph.locator(`.cg-cell[data-date="${key(lastWeek)}"]`)).toBeFocused();
  await expect(graph.locator('.cg-detail')).toContainText('专注 1 小时 15 分钟，已打卡');
  await page.keyboard.press('ArrowRight');
  await expect(graph.locator('.cg-cell.is-today')).toBeFocused();

  await graph.locator('[data-graph-range="2024"]').click();
  await expect(graph.locator('[data-graph-range="2024"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(graph.locator('.cg-summary-line strong')).toHaveText('2024 年学习 1 天');
  await graph.locator('.cg-months-table > summary').click();
  await expect(graph.locator('.cg-months-table tbody tr')).toHaveCount(1);
  await expect(graph.locator('.cg-months-table tbody')).toContainText('2024 年 05 月');

  await page.keyboard.press('Escape');
  await expect(graph).not.toHaveClass(/open/);
  await expect(toggle).toBeFocused();
  // Viewing never creates history for other days.
  const days = await page.evaluate(() => Object.keys(window.ProgressStore.getState().usage).sort());
  expect(days).toEqual([...new Set(['2024-05-06', key(lastWeek), key(today)])].sort());
  expect(errors).toEqual([]);
});

test('EXP-LEARN-04 Today shows the graph and keeps its range and focused day across re-renders', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  let stored = {
    version: 2,
    vocabulary: {},
    navigation: {},
    usage: { '2024-05-06': { focusedMs: 20 * 60000, checkedIn: false, checkins: 0 } },
  };
  await page.route('**/api/progress', async (route) => {
    if (route.request().method() === 'POST') stored = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stored) });
  });
  const errors = await openReadyApp(page, { module: 'dashboard' });
  const section = page.locator('[data-dashboard-activity]');
  await expect(section.locator('h2')).toHaveText('每日学习记录');
  const graph = section.locator('[data-activity-graph]');
  await expect(graph).not.toHaveClass(/is-quarter/);
  await expect(graph.locator('.cg-grid [role="row"]')).toHaveCount(7);
  await expect(graph.locator('.cg-summary-line strong')).toContainText('过去一年学习');

  await graph.locator('[data-graph-range="2024"]').click();
  await expect(graph.locator('.cg-summary-line strong')).toHaveText('2024 年学习 1 天');
  await graph.locator('.cg-cell[data-date="2024-05-06"]').click();
  // Today no longer scrolls, so the redrawn graph would land under a resting pointer
  // and its hover would name that day; the keyboard alone picks the day here.
  await page.locator('.dashboard-heading h1').hover();
  await graph.locator('.cg-cell[data-date="2024-05-06"]').focus();
  await page.keyboard.press('ArrowDown');
  await expect(graph.locator('.cg-cell[data-date="2024-05-07"]')).toBeFocused();
  // A plan change re-renders Today; the graph keeps its year and the focused day.
  await page.evaluate(() =>
    window.ProgressStore.updatePlan({ ...window.ProgressStore.getPlan(), dailyMinutes: 25 }),
  );
  await expect(page.locator('[data-dashboard-activity] [data-graph-range="2024"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('[data-dashboard-activity] .cg-cell[data-date="2024-05-07"]')).toBeFocused();
  await expect(page.locator('[data-dashboard-activity] .cg-detail')).toContainText('2024年5月7日');
  // The popover is a separate view and still opens on the recent year.
  const toggle = page.locator('#progressCalendarToggle');
  await revealControl(toggle);
  await toggle.click();
  await expect(page.locator('#progressCalendar .cg-summary-line strong')).toContainText('过去一年学习');
  expect(errors).toEqual([]);
});

test('EXP-LEARN-04 narrow screens step through quarters with larger days', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // A day last year makes earlier quarters reachable whatever today's date is.
  const lastYear = `${new Date().getFullYear() - 1}-06-01`;
  const stored = {
    version: 2,
    vocabulary: {},
    navigation: {},
    usage: { [lastYear]: { focusedMs: 15 * 60000, checkedIn: false, checkins: 0 } },
  };
  await page.route('**/api/progress', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stored) }),
  );
  const errors = await openReadyApp(page, { module: 'dashboard' });
  const model = await page.evaluate(() => {
    const graph = window.ProgressStore.getActivityGraph('2028-Q1', new Date(2028, 5, 1), {
      '2028-02-29': { focusedMs: 45 * 60000 },
      '2028-04-01': { focusedMs: 45 * 60000 },
    });
    const cells = graph.weeks.flat().filter(Boolean);
    return {
      range: graph.range,
      title: graph.title,
      span: [graph.first, graph.last],
      days: cells.length,
      totals: graph.totals,
    };
  });
  expect(model).toEqual({
    range: '2028-Q1',
    title: '2028 年 1–3 月',
    span: ['2028-01-01', '2028-03-31'],
    days: 91,
    totals: { days: 1, focusedMs: 45 * 60000, checked: 0 },
  });

  const graph = page.locator('[data-dashboard-activity] [data-activity-graph]');
  await graph.scrollIntoViewIfNeeded();
  await expect(graph).toHaveClass(/is-quarter/);
  const now = new Date();
  const quarter = Math.floor(now.getMonth() / 3);
  const label = `${now.getFullYear()} 年 ${quarter * 3 + 1}–${quarter * 3 + 3} 月`;
  await expect(graph.locator('.cg-quarter-label')).toHaveText(label);
  await expect(graph.getByRole('button', { name: '下一季度' })).toBeDisabled();
  const cell = await graph.locator('.cg-cell.is-today').boundingBox();
  expect(cell.width).toBeGreaterThanOrEqual(14);
  const scroll = await graph.locator('.cg-scroll').evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
  expect(scroll).toBe(true);
  await expectRegionsWithinViewport(page, ['[data-dashboard-activity]']);

  await graph.getByRole('button', { name: '上一季度' }).click();
  await expect(graph.locator('.cg-quarter-label')).not.toHaveText(label);
  await expect(graph.getByRole('button', { name: '上一季度' })).toBeFocused();
  await graph.getByRole('button', { name: '下一季度' }).click();
  await expect(graph.locator('.cg-quarter-label')).toHaveText(label);
  // Arrowing past the quarter's first week moves into the previous quarter.
  const first = graph.locator('.cg-cell[data-date]:not(.is-future)').first();
  await first.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(graph.locator('.cg-quarter-label')).not.toHaveText(label);
  await expect(page.locator(':focus')).toHaveClass(/cg-cell/);
  expect(errors).toEqual([]);
});
