/**
 * Dashboard: daily learning home built from public progress and study APIs.
 */
var Dashboard = (function () {
  var container = null;
  var active = true;
  var initialized = false;
  var planEditorOpen = false;
  var planBooks = [];
  var planLessons = [];
  var planLoading = false;
  var planLoadError = '';
  var planBookNotice = '';
  var planDraft = null;
  var planFocusPending = false;
  var planPreviousFocus = null;
  var planPreviousFocusSelector = '';
  var planLoadRequest = 0;
  var grammarCount = null;
  var grammarStatsLoading = false;
  var grammarStatsError = false;

  function init() {
    if (initialized) return;
    container = document.getElementById('dashboardMain');
    if (!container) return;
    container.addEventListener('click', onClick);
    container.addEventListener('change', onChange);
    container.addEventListener('input', function (event) {
      if (event.target.closest('[data-dashboard-plan-form]')) planDraft = readPlanForm();
    });
    container.addEventListener('submit', onSubmit);
    window.JPLearn.events.on('app:ready', render);
    window.JPLearn.events.on('app:loading', render);
    window.JPLearn.events.on('app:error', render);
    window.JPLearn.events.on('vocabulary:changed', function () {
      if (active) render();
    });
    window.JPLearn.events.on('navigation:changed', function () {
      if (active) render();
    });
    window.JPLearn.events.on('plan:changed', function () {
      if (active) render();
    });
    // FIX-22: an open plan editor is left alone; closing it renders the current numbers.
    window.JPLearn.events.on('usage:minutes', function () {
      if (active && !planEditorOpen) refreshMinutes();
    });
    if (window.JPLearn.topLayer) {
      window.JPLearn.topLayer.register('dashboard-plan', {
        close: function (restoreFocus) {
          closePlanEditor(restoreFocus);
        },
      });
    }
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && planEditorOpen) {
        event.preventDefault();
        closePlanEditor();
        return;
      }
      if (event.key === 'Tab' && planEditorOpen) {
        trapFocus(event, document.querySelector('[data-dashboard-plan-form]'));
      }
    });
    initialized = true;
    render();
    window.setTimeout(ensureGrammarStats, 0);
  }

  function activate() {
    active = true;
    render();
  }

  function deactivate() {
    active = false;
  }

  function render() {
    if (!container) return;
    var appStatus = window.appConfig && window.appConfig.status;
    if (appStatus === 'error') {
      if (window.StateView) {
        window.StateView.mount(container, {
          kind: 'error',
          title: '今日学习暂时无法准备',
          message: '词库加载没有完成，修复数据后可以重试；已有本地进度不会丢失。',
          details: window.appConfig.lastError && window.appConfig.lastError.message,
          action: {
            id: 'retry-app',
            label: '重试加载',
            icon: 'rotate-ccw',
            onClick: function () {
              return window.appConfig.retryInit();
            },
          },
        });
      }
      return;
    }
    if (
      (appStatus === 'idle' || appStatus === 'loading') &&
      !(window.taxonomyManager && window.taxonomyManager.allWords && window.taxonomyManager.allWords.length)
    ) {
      if (window.StateView) {
        window.StateView.mount(container, {
          kind: 'loading',
          skeleton: true,
          title: '正在准备今日学习',
          message: '正在读取词库与学习进度…',
        });
      }
      return;
    }
    var html = dashboardHtml();
    var oldGraph = container.querySelector('[data-activity-graph]');
    var graphFocused = !!(oldGraph && oldGraph.contains(document.activeElement));
    container.innerHTML = html;
    mountActivity(graphFocused);
    if (planEditorOpen) {
      var planForm = container.querySelector('[data-dashboard-plan-form]');
      if (planFocusPending || !planForm || !planForm.contains(document.activeElement)) {
        planFocusPending = true;
        focusPlanEditor();
      }
    }
  }

  // Today fits one desktop screen: a four-column board (hero, goal and
  // entries; three learning signals beside the milestones; the activity
  // graph beside recent sessions). Each fact appears once, in a short label.
  function dashboardHtml() {
    var model = buildModel();
    var plannedNewWords = Math.min(model.newCount, model.plan.dailyNewWords);

    var html = '<div class="dashboard-shell">';
    html += '<header class="dashboard-heading">';
    html +=
      '<div class="dashboard-heading-copy"><h1>今日学习</h1><span class="dashboard-eyebrow" data-visual-dynamic>' +
      esc(model.dateLabel) +
      '</span></div>';
    html += '<div class="dashboard-heading-actions">';
    var download = window.JPLearn && window.JPLearn.androidDownload;
    if (download && download.url) {
      var downloadLabel = '下载 Android 版 ' + download.version + '，' + download.sizeLabel;
      html +=
        '<a class="dashboard-download-action" data-dashboard-download href="' +
        esc(download.url) +
        '" target="_blank" rel="noopener" download="' +
        esc(download.filename) +
        '" aria-label="' +
        esc(downloadLabel) +
        '" title="' +
        esc(downloadLabel) +
        '">Android 版</a>';
    }
    html +=
      '<button class="dashboard-plan-action" type="button" data-dashboard-action="open-plan" aria-haspopup="dialog" title="设置学习计划" aria-label="设置学习计划">' +
      uiIcon('settings') +
      '学习计划</button></div>';
    html += '</header>';

    html += '<section class="dashboard-hero-grid">';
    html += renderStartCard(model, plannedNewWords);
    html += renderGoal(model);
    html += renderTasks(model, plannedNewWords);
    html += '</section>';

    html += renderInsights(model.stats);
    html += renderAchievements(model.achievements);
    html += renderActivity();
    html += renderRecent(model.recent);
    if (planEditorOpen) html += renderPlanEditor(model.plan);
    html += '</div>';
    return html;
  }

  function renderStartCard(model, plannedNewWords) {
    var plan = model.plan;
    var primaryLabel = model.resume
      ? '继续上次学习'
      : model.allComplete
        ? '去读一课课文'
        : model.ready
          ? model.reviewCount > 0
            ? '开始复习 ' + Math.min(model.reviewCount, 20) + ' 词'
            : '开始学习 ' + plannedNewWords + ' 词'
          : '词汇准备中...';
    var primaryAction = model.resume
      ? 'resume'
      : model.allComplete
        ? 'open-lesson'
        : model.reviewCount > 0
          ? 'start-review'
          : 'start-new';
    var html =
      '<article class="dashboard-start-card' +
      (model.allComplete && !model.resume ? ' is-complete' : '') +
      '">';
    html += '<div class="dashboard-card-kicker">' + uiIcon('target') + ' 推荐下一步</div>';
    html += '<h2>' + esc(model.resume ? model.resume.headline : model.headline) + '</h2>';
    html += '<p>' + esc(model.resume ? model.resume.subline : model.subline) + '</p>';
    html += '<div class="dashboard-start-footer"><div class="dashboard-start-actions">';
    html +=
      '<button class="dashboard-primary" data-dashboard-action="' +
      primaryAction +
      '"' +
      (model.ready ? '' : ' disabled') +
      '>' +
      uiIcon('play') +
      primaryLabel +
      '</button>';
    if (model.resume) {
      html +=
        '<button class="dashboard-secondary" data-dashboard-action="start-new">不恢复，学习新词</button>';
    }
    html += '</div>';
    html +=
      '<div class="dashboard-start-meta"><span class="dashboard-start-meta-label">今日计划</span><span>约 ' +
      plan.dailyMinutes +
      ' 分钟 · ' +
      plan.dailyNewWords +
      ' 个新词目标</span><span>JLPT ' +
      plan.jlptTarget +
      ' 目标</span></div>';
    html += '</div></article>';
    return html;
  }

  // The goal ledger owns every time figure: today against the plan, this
  // week, the streak and today's finished words.
  function renderGoal(model) {
    var plan = model.plan;
    var percent = plan.dailyMinutes
      ? Math.min(100, Math.round((model.todayMinutes / plan.dailyMinutes) * 100))
      : 0;
    var remaining = Math.max(0, plan.dailyMinutes - model.todayMinutes);
    var html = '<aside class="dashboard-progress-card">';
    html += '<div class="dashboard-card-kicker">今日目标</div>';
    html +=
      '<div class="dashboard-progress-main"><strong data-visual-dynamic>' +
      model.todayMinutes +
      '</strong><span>/ <span data-dashboard-minute-target>' +
      plan.dailyMinutes +
      '</span> 分钟</span></div>';
    html +=
      '<div class="dashboard-day-progress" data-dashboard-goal-progress role="progressbar" aria-label="今日分钟目标" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' +
      percent +
      '"><span style="width:' +
      percent +
      '%"></span></div><p class="dashboard-progress-note">' +
      (remaining ? '还差 ' + remaining + ' 分钟完成今日目标' : '今日时间目标已完成') +
      '</p>';
    html += '<div class="dashboard-progress-grid">';
    html +=
      '<div data-dashboard-stat="week"><strong data-visual-dynamic>' +
      model.weekDays +
      ' 天 · ' +
      model.stats.weekMinutes +
      ' 分钟</strong><span>本周学习</span></div>';
    html +=
      '<div data-dashboard-stat="streak"><strong data-visual-dynamic>' +
      model.streak +
      ' 天</strong><span>连续学习</span></div>';
    html +=
      '<div data-dashboard-stat="done"><strong data-visual-dynamic>' +
      model.todayReviewed +
      ' 词</strong><span>今日完成</span></div>';
    html += '</div></aside>';
    return html;
  }

  function renderTasks(model, plannedNewWords) {
    var html =
      '<section class="dashboard-section dashboard-tasks" aria-labelledby="dashboardTasksTitle"><h2 class="sr-only" id="dashboardTasksTitle">其他学习入口</h2><div class="dashboard-task-grid">';
    html += taskCard(
      'repeat',
      '今日待复习',
      model.reviewCount,
      model.allComplete ? '今天已完成' : '按计划已经到期',
      'start-review',
      model.reviewCount === 0 || !model.ready,
      model.allComplete,
    );
    html += taskCard(
      'sparkles',
      '学习新词',
      plannedNewWords,
      model.newCount ? newWordScope(model.plan) : '目标范围内没有未学习词',
      'start-new',
      !model.ready || model.newCount === 0,
      model.newCount === 0,
    );
    // A finished course path is reported here only, not again in the hero.
    var courseDone = !!(model.course && model.course.completed);
    html += taskCard(
      'book',
      '继续课文',
      courseDone ? '✓' : 1,
      model.course
        ? courseDone
          ? '本课学习路径已完成'
          : '本课学习路径可恢复'
        : plannedBookLabel(model.plan),
      'open-lesson',
      false,
      courseDone,
      courseDone ? ' data-dashboard-course="complete"' : '',
    );
    html += '</div></section>';
    return html;
  }

  function renderRecent(recent) {
    var html = '<section class="dashboard-recent">';
    html +=
      '<div class="dashboard-section-title compact"><h2>最近学习</h2><button class="dashboard-text-action" data-dashboard-action="open-vocab" title="浏览全部词汇" aria-label="浏览全部词汇">全部词汇 ' +
      uiIcon('chevron-right') +
      '</button></div>';
    if (!recent.length) return html + '<div class="dashboard-recent-empty">还没有学习记录。</div></section>';
    html += '<div class="dashboard-recent-list">';
    for (var i = 0; i < recent.length; i++) {
      var item = recent[i];
      html +=
        '<div class="dashboard-recent-item"><span class="dashboard-recent-icon">' +
        uiIcon('check') +
        '</span><div><strong>完成 ' +
        item.total +
        ' 词</strong><span>' +
        esc(item.label) +
        ' · 认识 ' +
        item.known +
        '，待巩固 ' +
        (item.fuzzy + item.unknown) +
        '</span></div></div>';
    }
    return html + '</div></section>';
  }

  // FIX-22: today's minutes move while Today stays open. Swap only the blocks
  // that show them (the goal ledger and the streak milestone), never the
  // activity graph, so its open table, scroll and focus stay as they are.
  function refreshMinutes() {
    if (!container || !container.querySelector('.dashboard-progress-card')) return;
    var next = document.createElement('div');
    next.innerHTML = dashboardHtml();
    var focused = document.activeElement;
    var action = focused && container.contains(focused) ? focused.getAttribute('data-dashboard-action') : '';
    var selector = action ? '[data-dashboard-action="' + action + '"]' : '';
    var position = selector
      ? Array.prototype.indexOf.call(container.querySelectorAll(selector), focused)
      : -1;
    ['.dashboard-progress-card', '[data-dashboard-achievements]'].forEach(function (block) {
      var old = container.querySelector(block);
      var fresh = next.querySelector(block);
      if (old && fresh) old.replaceWith(fresh);
    });
    var target = position >= 0 ? container.querySelectorAll(selector)[position] : null;
    if (target && document.activeElement !== target) target.focus({ preventScroll: true });
  }

  function taskCard(icon, label, count, detail, action, disabled, completed, attributes) {
    return (
      '<button class="dashboard-task-card' +
      (completed ? ' is-complete' : '') +
      '" data-dashboard-action="' +
      action +
      '"' +
      (attributes || '') +
      (disabled ? ' disabled' : '') +
      '>' +
      '<span class="dashboard-task-icon">' +
      uiIcon(icon) +
      '</span>' +
      '<span class="dashboard-task-copy"><small>' +
      esc(label) +
      '</small><strong>' +
      count +
      '</strong><span>' +
      esc(detail) +
      '</span></span>' +
      '<span class="dashboard-task-arrow">' +
      uiIcon('chevron-right') +
      '</span></button>'
    );
  }

  function buildModel() {
    var history = window.StudyStorage ? window.StudyStorage.getHistory() : [];
    var progress = window.ProgressStore ? window.ProgressStore.getState() : null;
    var plan =
      window.ProgressStore && window.ProgressStore.getPlan ? window.ProgressStore.getPlan() : defaultPlan();
    var now = new Date();
    var todayKey = localDateKey(now);
    var usage = progress && progress.usage ? progress.usage : {};
    var today = usage[todayKey] || {};
    var todaySessions = [];
    var recent = [];
    for (var i = history.length - 1; i >= 0; i--) {
      var session = history[i] || {};
      var date = new Date(session.date);
      if (!isNaN(date.getTime()) && localDateKey(date) === todayKey) todaySessions.push(session);
      if (recent.length < 3) {
        recent.push({
          total: Number(session.total) || 0,
          known: Number(session.known) || 0,
          fuzzy: Number(session.fuzzy) || 0,
          unknown: Number(session.unknown) || 0,
          label: relativeDateLabel(date, now),
        });
      }
    }
    var todayReviewed = 0;
    for (var j = 0; j < todaySessions.length; j++) todayReviewed += Number(todaySessions[j].total) || 0;
    var currentWords = allLearningWords();
    var dueIndices = window.StudyStorage ? window.StudyStorage.getDueWordIndices(now) : [];
    var dueSet = {};
    for (var k = 0; k < dueIndices.length; k++) dueSet[dueIndices[k]] = true;
    var reviewCount = currentWords.filter(function (word) {
      return !!dueSet[word.index];
    }).length;
    var newCount = newLearningWords(plan).length;
    var ready = !!currentWords.length;
    var streak =
      progress && window.ProgressStore && window.ProgressStore.getStreak
        ? window.ProgressStore.getStreak()
        : 0;
    var navigation =
      window.ProgressStore && window.ProgressStore.getNavigation
        ? window.ProgressStore.getNavigation()
        : null;
    var textbookNavigation = navigation && navigation.textbook ? navigation.textbook : {};
    var coursePath =
      textbookNavigation.coursePath && typeof textbookNavigation.coursePath === 'object'
        ? textbookNavigation.coursePath
        : null;
    var checkpoint = navigation && navigation.vocab && navigation.vocab.studySession;
    var unfinished =
      checkpoint &&
      navigation.vocab.view === 'study' &&
      checkpoint.version === 1 &&
      Array.isArray(checkpoint.queueIndices) &&
      checkpoint.queueIndices.length > 0 &&
      (checkpoint.currentIndex < checkpoint.queueIndices.length || checkpoint.sessionSaved === false);
    var activeCourse =
      coursePath &&
      !coursePath.completed &&
      coursePath.bookId === plan.bookId &&
      coursePath.lessonId === plan.lessonId;
    var resumeNavigation = unfinished
      ? Object.assign({}, navigation, { lastModule: 'vocab' })
      : activeCourse
        ? Object.assign({}, navigation, { lastModule: 'lesson' })
        : navigation;
    var resume = reviewCount && !unfinished ? null : buildResume(resumeNavigation);
    return {
      ready: ready,
      reviewCount: reviewCount,
      newCount: newCount,
      allComplete: ready && reviewCount === 0 && newCount === 0,
      headline:
        ready && reviewCount === 0 && newCount === 0
          ? '今天的学习完成了'
          : reviewCount > 0
            ? '先完成今天到期的复习'
            : history.length
              ? '继续积累下一组词汇'
              : '从第一组词汇开始',
      subline:
        ready && reviewCount === 0 && newCount === 0
          ? '目标范围内没有新词，全词库也没有到期复习。可继续计划课文。'
          : reviewCount > 0
            ? '全词库有 ' + reviewCount + ' 个到期词，按到期顺序复习，最多 20 个。'
            : newWordScope(plan) + '，不受浏览筛选影响。',
      dateLabel: new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(
        now,
      ),
      todayMinutes: Math.floor((Number(today.focusedMs) || 0) / 60000),
      weekDays: countWeekDays(usage, now),
      streak: streak,
      todayReviewed: todayReviewed,
      recent: recent,
      resume: resume,
      resumeNavigation: resumeNavigation,
      plan: plan,
      stats: buildInsights({
        history: history,
        usage: usage,
        todayKey: todayKey,
        todaySessions: todaySessions,
        currentWords: currentWords,
        reviewCount: reviewCount,
        coursePath: coursePath,
        now: now,
      }),
      achievements: buildAchievements({
        history: history,
        knownCount:
          window.StudyStorage && window.StudyStorage.getCounts ? window.StudyStorage.getCounts().known : 0,
        streak: streak,
        coursePath: coursePath,
      }),
      course: coursePath,
    };
  }

  function ensureGrammarStats() {
    if (
      grammarCount !== null ||
      grammarStatsLoading ||
      !window.GrammarLoader ||
      !window.GrammarLoader.getIndex
    )
      return;
    grammarStatsLoading = true;
    var count = window.GrammarLoader.getCount
      ? window.GrammarLoader.getCount()
      : window.GrammarLoader.getIndex().then(function (index) {
          return Array.isArray(index) ? index.length : 0;
        });
    count
      .then(function (total) {
        grammarCount = total;
        grammarStatsLoading = false;
        grammarStatsError = false;
        if (active) render();
      })
      .catch(function () {
        grammarCount = 0;
        grammarStatsLoading = false;
        grammarStatsError = true;
        if (active) render();
      });
  }

  function buildInsights(input) {
    var history = input.history || [];
    var usage = input.usage || {};
    var now = input.now || new Date();
    var todayKey = input.todayKey || localDateKey(now);
    var trend = [];
    var trendByKey = {};
    var weekMinutes = 0;
    for (var dayOffset = 6; dayOffset >= 0; dayOffset--) {
      var date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOffset);
      var key = localDateKey(date);
      var day = usage[key] || {};
      var point = { key: key, label: date.getMonth() + 1 + '/' + date.getDate(), unknown: 0, fuzzy: 0 };
      trend.push(point);
      trendByKey[key] = point;
      weekMinutes += Math.floor((Number(day.focusedMs) || 0) / 60000);
    }

    var reviewCompleted = 0;
    for (var i = 0; i < history.length; i++) {
      var session = history[i] || {};
      var date = new Date(session.date);
      if (isNaN(date.getTime())) continue;
      var key = localDateKey(date);
      var source = session.source && typeof session.source === 'object' ? session.source : {};
      if (key === todayKey && (source.kind === 'daily-review' || source.label === '今日到期复习')) {
        reviewCompleted += Math.max(0, Number(session.total) || 0);
      }
      var point = trendByKey[key];
      if (point) {
        point.unknown += Math.max(0, Number(session.unknown) || 0);
        point.fuzzy += Math.max(0, Number(session.fuzzy) || 0);
      }
    }

    var reviewTotal = Math.max(0, Number(input.reviewCount) || 0) + reviewCompleted;
    var reviewPercent = reviewTotal ? Math.min(100, Math.round((reviewCompleted / reviewTotal) * 100)) : 100;
    var vocabTotal = (input.currentWords || []).length;
    var vocabKnown = 0;
    for (var j = 0; j < vocabTotal; j++) {
      if (
        window.StudyStorage &&
        window.StudyStorage.getWordStatus(input.currentWords[j].index).status === 'known'
      )
        vocabKnown++;
    }
    var grammarTotal = grammarCount === null ? 0 : grammarCount;
    var grammarMarked =
      window.StudyStorage && window.StudyStorage.getGrammarFavorites
        ? window.StudyStorage.getGrammarFavorites().length
        : 0;
    var courseDone = 0;
    var courseTotal = 4;
    if (input.coursePath && input.coursePath.steps) {
      var stepKeys = ['vocab', 'reading', 'grammar', 'review'];
      for (var k = 0; k < stepKeys.length; k++) {
        var status = input.coursePath.steps[stepKeys[k]];
        if (status === 'done' || status === 'skipped') courseDone++;
      }
    }
    return {
      todayMinutes: Math.floor((Number((usage[todayKey] || {}).focusedMs) || 0) / 60000),
      weekMinutes: weekMinutes,
      weekDays: countWeekDays(usage, now),
      reviewRemaining: Math.max(0, Number(input.reviewCount) || 0),
      reviewCompleted: reviewCompleted,
      reviewTotal: reviewTotal,
      reviewPercent: reviewPercent,
      vocabKnown: vocabKnown,
      vocabTotal: vocabTotal,
      vocabPercent: vocabTotal ? Math.min(100, Math.round((vocabKnown / vocabTotal) * 100)) : 0,
      grammarMarked: grammarMarked,
      grammarTotal: grammarTotal,
      grammarPercent: grammarTotal ? Math.min(100, Math.round((grammarMarked / grammarTotal) * 100)) : 0,
      grammarLoading: grammarCount === null && grammarStatsLoading,
      grammarError: grammarStatsError,
      courseDone: courseDone,
      courseTotal: courseTotal,
      coursePercent: Math.min(100, Math.round((courseDone / courseTotal) * 100)),
      trend: trend,
      weakWords: buildWeakWords(input.currentWords || []),
    };
  }

  function buildWeakWords(currentWords) {
    var map = {};
    for (var i = 0; i < currentWords.length; i++) map[currentWords[i].index] = currentWords[i];
    var result = [];
    var statuses = ['unknown', 'fuzzy'];
    for (var s = 0; s < statuses.length; s++) {
      var indices = window.StudyStorage ? window.StudyStorage.getWordsByStatus(statuses[s]) : [];
      for (var j = 0; j < indices.length; j++) {
        var word = map[indices[j]];
        if (!word) continue;
        result.push({
          index: word.index,
          word: word.word || '',
          meaning: word.meaning || '',
          status: statuses[s],
        });
        if (result.length >= 5) return result;
      }
    }
    return result;
  }

  // One ruled band of three signals: due reviews with the content counts,
  // the seven-day trend and the weak words. Empty panels keep one short line.
  function renderInsights(stats) {
    stats = stats || {};
    var reviewPercent = Math.max(0, Math.min(100, Number(stats.reviewPercent) || 0));
    var trend = Array.isArray(stats.trend) ? stats.trend : [];
    var trendMax = 1;
    var trendHasData = false;
    for (var i = 0; i < trend.length; i++) {
      var trendTotal = (Number(trend[i].unknown) || 0) + (Number(trend[i].fuzzy) || 0);
      trendMax = Math.max(trendMax, trendTotal);
      if (trendTotal > 0) trendHasData = true;
    }
    var trendBars = trend
      .map(function (point) {
        var unknown = Math.max(0, Number(point.unknown) || 0);
        var fuzzy = Math.max(0, Number(point.fuzzy) || 0);
        var unknownHeight = unknown ? Math.max(12, Math.round((unknown / trendMax) * 100)) : 0;
        var fuzzyHeight = fuzzy ? Math.max(12, Math.round((fuzzy / trendMax) * 100)) : 0;
        // A narrow chart keeps only the day; the bar label still names the date.
        var day = String(point.label || '').split('/');
        var dayLabel =
          day.length === 2
            ? '<span class="dashboard-trend-month">' + esc(day[0]) + '/</span>' + esc(day[1])
            : esc(point.label || '');
        return (
          '<div class="dashboard-trend-bar" data-trend-day="' +
          esc(point.key || '') +
          '" aria-label="' +
          esc((point.label || '') + '：不会 ' + unknown + '，模糊 ' + fuzzy) +
          '">' +
          '<span class="dashboard-trend-stack"><i class="dashboard-trend-unknown" style="height:' +
          unknownHeight +
          '%"></i><i class="dashboard-trend-fuzzy" style="height:' +
          fuzzyHeight +
          '%"></i></span><small data-visual-dynamic>' +
          dayLabel +
          '</small></div>'
        );
      })
      .join('');
    var weakWords = Array.isArray(stats.weakWords) ? stats.weakWords : [];
    var weakList = weakWords.length
      ? '<ul class="dashboard-weak-list">' +
        weakWords
          .map(function (item) {
            var statusLabel = item.status === 'unknown' ? '不会' : '模糊';
            return (
              '<li><span class="dashboard-weak-status ' +
              esc(item.status || 'fuzzy') +
              '">' +
              statusLabel +
              '</span><strong>' +
              esc(item.word || '词汇') +
              '</strong><span>' +
              esc(item.meaning || '待巩固') +
              '</span></li>'
            );
          })
          .join('') +
        '</ul>'
      : '<p class="dashboard-insight-empty">还没有标记为“不会”或“模糊”的词。</p>';
    var grammarValue = stats.grammarLoading
      ? '读取中…'
      : stats.grammarError
        ? '暂不可用'
        : stats.grammarMarked + '/' + stats.grammarTotal;
    var hasReviewQueue = Number(stats.reviewTotal) > 0;
    // The next step (or today's completion) shares the count's line.
    var review =
      '<div class="dashboard-review-progress" data-dashboard-insight="review"><div class="dashboard-progress-row"><span>到期复习</span>' +
      (hasReviewQueue
        ? '<small>已处理</small><strong data-visual-dynamic>' +
          (Number(stats.reviewCompleted) || 0) +
          ' / ' +
          (Number(stats.reviewTotal) || 0) +
          '</strong>' +
          (stats.reviewRemaining
            ? '<button class="dashboard-insight-link" type="button" data-dashboard-action="start-review">继续复习 ' +
              Math.min(stats.reviewRemaining, 20) +
              ' 词 ' +
              uiIcon('chevron-right') +
              '</button>'
            : '<span class="dashboard-insight-complete">今日到期复习已完成</span>') +
          '</div><div class="dashboard-progress-track" role="progressbar" aria-label="今日到期复习完成率" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' +
          reviewPercent +
          '"><span style="width:' +
          reviewPercent +
          '%"></span></div>'
        : '<strong>暂无到期词</strong></div>') +
      '</div>';
    var trendBody = trendHasData
      ? '<div class="dashboard-trend-bars">' + trendBars + '</div>'
      : '<p class="dashboard-insight-empty">最近 7 天还没有“模糊”或“不会”的反馈。</p>';
    return (
      '<section class="dashboard-section dashboard-insights" data-dashboard-insights aria-labelledby="dashboardInsightsTitle">' +
      '<h2 class="sr-only" id="dashboardInsightsTitle">学习信号</h2>' +
      '<div class="dashboard-insight-grid">' +
      '<article class="dashboard-insight-card dashboard-content-card" data-dashboard-insight="content"><div class="dashboard-panel-head"><h3 class="dashboard-panel-title">学习进度</h3></div>' +
      review +
      insightProgressRow(
        '词汇',
        stats.vocabPercent,
        (Number(stats.vocabKnown) || 0) + '/' + (Number(stats.vocabTotal) || 0),
        '已掌握',
      ) +
      insightProgressRow(
        '语法',
        stats.grammarPercent,
        grammarValue,
        stats.grammarError ? '打开语法后重试' : '已收藏',
      ) +
      insightProgressRow(
        '课文',
        stats.coursePercent,
        (Number(stats.courseDone) || 0) + '/' + (Number(stats.courseTotal) || 0),
        '本课步骤',
      ) +
      '</article>' +
      '<article class="dashboard-insight-card dashboard-trend-card" data-dashboard-insight="trend"><div class="dashboard-panel-head"><h3 class="dashboard-panel-title">7 日巩固趋势</h3>' +
      (trendHasData
        ? '<div class="dashboard-trend-legend"><span><i class="dashboard-trend-dot is-unknown"></i>不会</span><span><i class="dashboard-trend-dot is-fuzzy"></i>模糊</span></div>'
        : '') +
      '</div>' +
      trendBody +
      '</article>' +
      '<article class="dashboard-insight-card dashboard-weak-card" data-dashboard-insight="weak"><div class="dashboard-panel-head"><h3 class="dashboard-panel-title">薄弱词</h3>' +
      (weakWords.length
        ? '<button class="dashboard-insight-link" type="button" data-dashboard-action="start-weak">复习这组 ' +
          uiIcon('chevron-right') +
          '</button>'
        : '') +
      '</div>' +
      weakList +
      '</article>' +
      '</div></section>'
    );
  }

  function buildAchievements(input) {
    input = input || {};
    var history = Array.isArray(input.history) ? input.history : [];
    var completedSessions = 0;
    for (var i = 0; i < history.length; i++) {
      if (Math.max(0, Number(history[i] && history[i].total) || 0) > 0) completedSessions++;
    }

    var coursePath = input.coursePath && typeof input.coursePath === 'object' ? input.coursePath : null;
    var courseDone = 0;
    var courseTotal = 4;
    var stepKeys = ['vocab', 'reading', 'grammar', 'review'];
    if (coursePath && coursePath.completed) {
      courseDone = courseTotal;
    } else if (coursePath && coursePath.steps) {
      for (var j = 0; j < stepKeys.length; j++) {
        var status = coursePath.steps[stepKeys[j]];
        if (status === 'done' || status === 'skipped') courseDone++;
      }
    }

    var definitions = [
      {
        id: 'first-session',
        icon: 'play',
        title: '第一段学习',
        target: 1,
        value: completedSessions,
        unit: '次学习',
      },
      {
        id: 'known-20',
        icon: 'brain',
        title: '掌握 20 个词',
        target: 20,
        value: Math.max(0, Number(input.knownCount) || 0),
        unit: '个已掌握词',
      },
      {
        id: 'streak-3',
        icon: 'repeat',
        title: '连续学习 3 天',
        target: 3,
        value: Math.max(0, Number(input.streak) || 0),
        unit: '天连续学习',
      },
      {
        id: 'lesson-path',
        icon: 'book',
        title: '完成一课路径',
        target: courseTotal,
        value: courseDone,
        unit: '个课文步骤',
      },
    ];

    return definitions.map(function (item) {
      var value = Math.max(0, Math.floor(Number(item.value) || 0));
      var target = Math.max(1, Math.floor(Number(item.target) || 1));
      return {
        id: item.id,
        icon: item.icon,
        title: item.title,
        target: target,
        value: value,
        unit: item.unit,
        remaining: Math.max(0, target - value),
        complete: value >= target,
        percent: Math.min(100, Math.round((value / target) * 100)),
      };
    });
  }

  // EXP-LEARN-04: the same GitHub-style graph as the check-in popover.
  // ProgressStore owns it and keeps its range and day across re-renders; its
  // summary line ("过去一年学习 N 天") is the panel's visible title.
  function renderActivity() {
    if (!window.ProgressStore || !window.ProgressStore.mountActivityGraph) return '';
    return (
      '<section class="dashboard-section dashboard-activity" data-dashboard-activity aria-labelledby="dashboardActivityTitle">' +
      '<h2 class="sr-only" id="dashboardActivityTitle">每日学习记录</h2>' +
      '<div class="dashboard-activity-graph" data-activity-graph></div></section>'
    );
  }

  function mountActivity(restoreFocus) {
    var root = container.querySelector('[data-activity-graph]');
    if (root) window.ProgressStore.mountActivityGraph(root, { id: 'dashboard', restoreFocus: restoreFocus });
  }

  // FIX-30: a milestone shows its count until reached and only then a status,
  // so a new learner no longer sees four "in progress" labels.
  function renderAchievements(achievements) {
    var items = Array.isArray(achievements) ? achievements : [];
    if (!items.length) return '';
    return (
      '<section class="dashboard-section dashboard-achievements" data-dashboard-achievements>' +
      '<div class="dashboard-section-title"><h2>学习里程碑</h2></div>' +
      '<div class="dashboard-achievement-grid" role="list">' +
      items
        .map(function (item) {
          var value = Math.min(item.value, item.target);
          return (
            '<article class="dashboard-achievement-card' +
            (item.complete ? ' is-complete' : '') +
            '" data-dashboard-achievement="' +
            esc(item.id) +
            '" data-dashboard-achievement-status="' +
            (item.complete ? 'complete' : 'progress') +
            '" role="listitem"><span class="dashboard-achievement-icon">' +
            uiIcon(item.complete ? 'check' : item.icon) +
            '</span><div class="dashboard-achievement-copy"><div class="dashboard-achievement-heading"><strong>' +
            esc(item.title) +
            '</strong><span class="dashboard-achievement-meta">' +
            (item.complete ? '已达成' : '<b data-visual-dynamic>' + value + '</b> / ' + item.target) +
            '</span></div><div class="dashboard-achievement-track" role="progressbar" aria-label="' +
            esc(item.title + '进度') +
            '" aria-valuemin="0" aria-valuemax="' +
            item.target +
            '" aria-valuenow="' +
            value +
            '" aria-valuetext="' +
            esc(
              item.complete
                ? '已达成'
                : value + ' / ' + item.target + '，还差 ' + item.remaining + ' ' + item.unit,
            ) +
            '"><span style="width:' +
            item.percent +
            '%"></span></div></div></article>'
          );
        })
        .join('') +
      '</div></section>'
    );
  }

  function insightProgressRow(label, percent, value, note) {
    var safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
    return (
      '<div class="dashboard-content-progress"><div class="dashboard-progress-row"><span>' +
      esc(label) +
      '</span><small>' +
      esc(note) +
      '</small><strong data-visual-dynamic>' +
      esc(value) +
      '</strong></div><div class="dashboard-progress-track" role="progressbar" aria-label="' +
      esc(label + '进度') +
      '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' +
      safePercent +
      '"><span style="width:' +
      safePercent +
      '%"></span></div></div>'
    );
  }

  function buildResume(navigation) {
    if (!navigation || !navigation.lastModule) return null;
    if (navigation.lastModule === 'grammar') {
      var grammar = navigation.grammar || {};
      return {
        headline: '继续上次的语法学习',
        subline:
          grammar.view === 'lesson-reader'
            ? '返回上次阅读的辅助课文与显示模式。'
            : '返回上次的语法列表和选中内容。',
      };
    }
    if (navigation.lastModule === 'lesson') {
      var textbook = navigation.textbook || {};
      var course =
        textbook.coursePath && typeof textbook.coursePath === 'object' ? textbook.coursePath : null;
      if (course && course.completed) {
        return {
          headline: '本课学习完成了',
          subline:
            '返回 ' + (course.lessonLabel || course.lessonId || '课文') + ' 可继续复习，或选择下一课。',
        };
      }
      if (course && course.currentStep) {
        var stepLabels = { vocab: '预习词汇', reading: '阅读课文', grammar: '查看语法', review: '复习题目' };
        return {
          headline: '继续本课学习',
          subline: '下一步：' + (stepLabels[course.currentStep] || '继续课文') + '，进度可随时恢复。',
        };
      }
      return {
        headline: '继续上次的课文',
        subline: textbook.lessonId
          ? '返回 ' + textbook.lessonId + '，保留上次的阅读显示方式。'
          : '返回上次使用的教材。',
      };
    }
    if (navigation.lastModule === 'vocab') {
      var vocab = navigation.vocab || {};
      var checkpoint =
        vocab.studySession && typeof vocab.studySession === 'object' ? vocab.studySession : null;
      if (vocab.view === 'study' && checkpoint && Array.isArray(checkpoint.queueIndices)) {
        var total = checkpoint.queueIndices.length;
        var current = Math.max(0, Math.min(total, Number(checkpoint.currentIndex) || 0));
        if (current >= total) {
          return {
            headline: checkpoint.sessionSaved === false ? '保存上次的词汇结果' : '查看上次的词汇结果',
            subline:
              checkpoint.sessionSaved === false
                ? '答题已经完成，会话历史尚未确认保存；打开后重试。'
                : '上一组 ' + total + ' 词已经完成，结果与错项复习入口仍保留。',
          };
        }
        return {
          headline: '继续上次的词汇练习',
          subline:
            '进度 ' +
            (current + 1) +
            ' / ' +
            total +
            (checkpoint.exerciseFeedback ? '，当前答案反馈等待确认。' : '，题目和队列均已保存。'),
        };
      }
      var labels = { cards: '词卡', list: '列表', graph: '图谱', aggregate: '聚合图', study: '学习配置' };
      return {
        headline: '继续上次的词汇学习',
        subline:
          '返回' + (labels[vocab.view] || '词卡') + (vocab.page > 1 ? '第 ' + vocab.page + ' 页。' : '。'),
      };
    }
    return null;
  }

  function onClick(event) {
    var button = event.target.closest('[data-dashboard-action]');
    if (!button || button.disabled) return;
    var action = button.getAttribute('data-dashboard-action');
    if (action === 'open-plan') {
      openPlanEditor();
      return;
    }
    if (action === 'close-plan') {
      closePlanEditor();
      return;
    }
    if (action === 'open-lesson') {
      var plan =
        window.ProgressStore && window.ProgressStore.getPlan ? window.ProgressStore.getPlan() : defaultPlan();
      if (window.ModuleSwitcher.openPlannedLesson) window.ModuleSwitcher.openPlannedLesson(plan);
      else window.ModuleSwitcher.switchTo('lesson');
      return;
    }
    if (action === 'open-vocab') {
      window.ModuleSwitcher.switchTo('vocab');
      return;
    }
    if (action === 'open-grammar') {
      window.ModuleSwitcher.switchTo('grammar');
      return;
    }
    if (action === 'resume') {
      window.ModuleSwitcher.resume(buildModel().resumeNavigation);
      return;
    }
    if (action === 'start-new' || action === 'start-review') startVocabulary(action === 'start-review');
    if (action === 'start-weak') startWeakReview();
  }

  function onChange(event) {
    var target = event.target;
    if (!target || !target.closest('[data-dashboard-plan-form]')) return;
    planDraft = readPlanForm();
    if (target.id !== 'dashboardPlanBook') return;
    planDraft.bookId = target.value;
    planDraft.lessonId = '';
    planBookNotice = '';
    planLessons = [];
    planLoading = true;
    planLoadError = '';
    render();
    loadPlanLessons(planDraft.bookId);
  }

  function onSubmit(event) {
    var form = event.target.closest('[data-dashboard-plan-form]');
    if (!form) return;
    event.preventDefault();
    var next = readPlanForm();
    if (window.ProgressStore && window.ProgressStore.updatePlan) window.ProgressStore.updatePlan(next);
    closePlanEditor();
  }

  function defaultPlan() {
    return {
      dailyMinutes: 10,
      dailyNewWords: 20,
      bookId: window.JPLearn.textbooks.defaultBookId(),
      lessonId: 'lesson_02',
      jlptTarget: 'N5',
      updatedAt: '',
    };
  }

  function openPlanEditor() {
    if (window.JPLearn.topLayer) window.JPLearn.topLayer.requestOpen('dashboard-plan');
    var plan =
      window.ProgressStore && window.ProgressStore.getPlan ? window.ProgressStore.getPlan() : defaultPlan();
    // A plan saved before this copy stopped offering its book keeps that book until
    // the learner saves; the editor shows and loads an offered book meanwhile.
    var offered = window.JPLearn.textbooks.isOffered(plan.bookId);
    planBookNotice = offered ? '' : '原计划中的教材本站已不再提供，已改为显示第一册；保存后计划才会更新。';
    planDraft = {
      dailyMinutes: plan.dailyMinutes,
      dailyNewWords: plan.dailyNewWords,
      bookId: offered ? plan.bookId : window.JPLearn.textbooks.defaultBookId(),
      lessonId: offered ? plan.lessonId : '',
      jlptTarget: plan.jlptTarget,
      updatedAt: plan.updatedAt || '',
    };
    planPreviousFocus = document.activeElement;
    planPreviousFocusSelector =
      planPreviousFocus && planPreviousFocus.getAttribute('data-dashboard-action') === 'open-plan'
        ? '[data-dashboard-action="open-plan"]'
        : '';
    planEditorOpen = true;
    planFocusPending = true;
    planLoading = true;
    planLoadError = '';
    planBooks = [];
    planLessons = [];
    render();
    if (!window.TextbookLoader) {
      planLoading = false;
      planLoadError = '教材目录接口暂不可用，仍可保存其他目标。';
      render();
      return;
    }
    window.TextbookLoader.getBooks()
      .then(function (books) {
        planBooks = Array.isArray(books) ? books : [];
        return planEditorOpen && planDraft ? loadPlanLessons(planDraft.bookId) : [];
      })
      .catch(function () {
        planLoading = false;
        planLoadError = '教材目录暂不可用，仍可保存其他目标。';
        render();
      });
  }

  function loadPlanLessons(bookId) {
    var requestId = ++planLoadRequest;
    if (!window.TextbookLoader || !window.TextbookLoader.getBookIndex) {
      planLoading = false;
      planLoadError = '教材目录接口暂不可用，仍可保存其他目标。';
      render();
      return Promise.resolve([]);
    }
    return window.TextbookLoader.getBookIndex(bookId)
      .then(function (index) {
        if (!planEditorOpen || requestId !== planLoadRequest || !planDraft || planDraft.bookId !== bookId)
          return [];
        planLessons = index && Array.isArray(index.lessons) ? index.lessons : [];
        if (
          planDraft &&
          planDraft.bookId === bookId &&
          !planLessons.some(function (lesson) {
            return lesson.lesson_id === planDraft.lessonId;
          })
        ) {
          planDraft.lessonId = planLessons.length ? planLessons[0].lesson_id : '';
        }
        planLoading = false;
        planLoadError = '';
        render();
        return planLessons;
      })
      .catch(function () {
        if (!planEditorOpen || requestId !== planLoadRequest) return [];
        planLessons = [];
        planLoading = false;
        planLoadError = '这册教材的课次暂时无法读取，可稍后再调整。';
        render();
        return [];
      });
  }

  function closePlanEditor(restoreFocus) {
    planLoadRequest += 1;
    planEditorOpen = false;
    planDraft = null;
    planBookNotice = '';
    planFocusPending = false;
    var restore = planPreviousFocus;
    var restoreSelector = planPreviousFocusSelector;
    planPreviousFocus = null;
    planPreviousFocusSelector = '';
    if (window.JPLearn.topLayer) window.JPLearn.topLayer.release('dashboard-plan');
    render();
    if (restoreFocus === false) return;
    setTimeout(function () {
      if (restore && restore.isConnected) {
        restore.focus();
        return;
      }
      if (restoreSelector) {
        var replacement = document.querySelector(restoreSelector);
        if (replacement) replacement.focus();
      }
    }, 0);
  }

  function readPlanForm() {
    var current =
      planDraft ||
      (window.ProgressStore && window.ProgressStore.getPlan ? window.ProgressStore.getPlan() : defaultPlan());
    var minutes = document.getElementById('dashboardPlanMinutes');
    var words = document.getElementById('dashboardPlanWords');
    var book = document.getElementById('dashboardPlanBook');
    var lesson = document.getElementById('dashboardPlanLesson');
    var jlpt = document.getElementById('dashboardPlanJlpt');
    return {
      dailyMinutes: minutes ? minutes.value : current.dailyMinutes,
      dailyNewWords: words ? words.value : current.dailyNewWords,
      bookId: book ? book.value : current.bookId,
      lessonId: lesson ? lesson.value : current.lessonId,
      jlptTarget: jlpt ? jlpt.value : current.jlptTarget,
    };
  }

  function focusPlanEditor() {
    if (!planFocusPending) return;
    var input = document.getElementById('dashboardPlanMinutes');
    if (input) {
      planFocusPending = false;
      input.focus();
      input.select();
      return;
    }
    setTimeout(function () {
      if (!planEditorOpen) return;
      focusPlanEditor();
    }, 0);
  }

  function trapFocus(event, root) {
    if (!root) return;
    var focusables = root.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    );
    if (!focusables.length) return;
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function renderPlanEditor(plan) {
    var draft = planDraft || plan || defaultPlan();
    var books = planBooks.length
      ? planBooks
      : [
          { id: 'XinBian1', label: '新编 1', title: '新编日语 1' },
          { id: 'XinBian2', label: '新编 2', title: '新编日语 2' },
          { id: 'XinBian3', label: '新编 3', title: '新编日语 3' },
          { id: 'XinBian4', label: '新编 4', title: '新编日语 4' },
        ].filter(function (book) {
          return window.JPLearn.textbooks.isOffered(book.id);
        });
    var bookOptions = books
      .map(function (book) {
        return (
          '<option value="' +
          esc(book.id) +
          '"' +
          (book.id === draft.bookId ? ' selected' : '') +
          '>' +
          esc(book.title || book.label || book.id) +
          '</option>'
        );
      })
      .join('');
    var lessonOptions =
      '<option value="">自动使用第一课</option>' +
      planLessons
        .map(function (lesson) {
          var id = lesson.lesson_id || '';
          var label = lesson.lesson_label || lesson.title_ja || id;
          return (
            '<option value="' +
            esc(id) +
            '"' +
            (id === draft.lessonId ? ' selected' : '') +
            '>' +
            esc(label) +
            (lesson.title_ja ? ' · ' + esc(lesson.title_ja) : '') +
            '</option>'
          );
        })
        .join('');
    var jlptOptions = ['N5', 'N4', 'N3', 'N2', 'N1']
      .map(function (level) {
        return (
          '<option value="' +
          level +
          '"' +
          (level === draft.jlptTarget ? ' selected' : '') +
          '>' +
          level +
          '</option>'
        );
      })
      .join('');
    return (
      '<div class="dashboard-plan-overlay"><div class="dashboard-plan-backdrop" data-dashboard-action="close-plan"></div>' +
      '<form class="dashboard-plan-dialog" data-dashboard-plan-form role="dialog" aria-modal="true" aria-labelledby="dashboardPlanTitle" aria-describedby="dashboardPlanDescription">' +
      '<div class="dashboard-plan-heading"><div><span class="dashboard-card-kicker">学习节奏</span><h2 id="dashboardPlanTitle">设置你的轻量计划</h2><p id="dashboardPlanDescription">给今天一个可完成的边界，随时可以跳过或再调整。</p></div>' +
      '<button class="dashboard-plan-close" type="button" data-dashboard-action="close-plan" aria-label="关闭学习计划">' +
      uiIcon('x') +
      '</button></div>' +
      '<div class="dashboard-plan-fields">' +
      '<label><span>每天学习时间</span><div class="dashboard-plan-input"><input id="dashboardPlanMinutes" type="number" min="5" max="120" step="5" value="' +
      esc(draft.dailyMinutes) +
      '"><strong>分钟</strong></div><small>5–120 分钟，按设备本地时间累计</small></label>' +
      '<label><span>每天新词数</span><div class="dashboard-plan-input"><input id="dashboardPlanWords" type="number" min="5" max="60" step="5" value="' +
      esc(draft.dailyNewWords) +
      '"><strong>词</strong></div><small>5–60 词；已有进度不会被删除</small></label>' +
      '<label><span>当前教材册</span><select id="dashboardPlanBook">' +
      bookOptions +
      '</select><small>用于“继续课文”入口</small></label>' +
      '<label><span>当前教材课</span><select id="dashboardPlanLesson"' +
      (planLoading ? ' disabled' : '') +
      '>' +
      lessonOptions +
      '</select><small>' +
      (planLoading ? '正在读取课次…' : '可选择普通课或复习单元') +
      '</small></label>' +
      '<label><span>JLPT 目标</span><select id="dashboardPlanJlpt">' +
      jlptOptions +
      '</select><small>只作为首页提示，不会改变词库筛选</small></label>' +
      '</div>' +
      (planLoadError || planBookNotice
        ? '<div class="dashboard-plan-notice" role="status">' +
          esc(planLoadError || planBookNotice) +
          '</div>'
        : '') +
      '<div class="dashboard-plan-footer"><span>保存计划不会覆盖词汇、SRS 或学习历史。</span><div><button class="dashboard-secondary" type="button" data-dashboard-action="close-plan">取消</button><button class="dashboard-primary" type="submit"' +
      (planLoading ? ' disabled' : '') +
      '>' +
      uiIcon('check') +
      '保存计划</button></div></div>' +
      '</form></div>'
    );
  }

  function allLearningWords() {
    return window.taxonomyManager && Array.isArray(window.taxonomyManager.allWords)
      ? window.taxonomyManager.allWords
      : [];
  }

  function newWordScope(plan) {
    return plan.jlptTarget === 'N5' ? '新词范围：N5' : '新词范围：N5–' + plan.jlptTarget + '（含基础词）';
  }

  // FIX-33: name the book “继续课文” opens. A plan saved with a book this copy no
  // longer offers opens the first offered one, e.g. KotobaFlow on the public site.
  function plannedBookLabel(plan) {
    var textbooks = window.JPLearn.textbooks;
    var bookId = plan && textbooks.isOffered(plan.bookId) ? plan.bookId : textbooks.defaultBookId();
    var book = window.TextbookLoader && window.TextbookLoader.getBookMeta(bookId);
    var title = (book && book.title) || '';
    // “新编日语 1” reads as “新编日语 · 第一册”.
    var match = /^(.*\S)\s+([1-4])$/.exec(title);
    return match ? match[1] + ' · 第' + '一二三四'.charAt(match[2] - 1) + '册' : title || '课程第一册';
  }

  function newLearningWords(plan) {
    var target = Number(plan.jlptTarget.slice(1));
    return allLearningWords().filter(function (word) {
      return (
        /^N[1-5]$/.test(word.level) &&
        Number(word.level.slice(1)) >= target &&
        window.StudyStorage.getWordStatus(word.index).status === 'none'
      );
    });
  }

  function startVocabulary(reviewOnly) {
    var plan =
      window.ProgressStore && window.ProgressStore.getPlan ? window.ProgressStore.getPlan() : defaultPlan();
    var words = allLearningWords();
    if (reviewOnly) {
      var indices = window.StudyStorage.getDueWordIndices(new Date());
      var byId = new Map(
        words.map(function (word) {
          return [word.index, word];
        }),
      );
      words = indices
        .map(function (index) {
          return byId.get(index);
        })
        .filter(Boolean);
    } else {
      words = newLearningWords(plan);
    }
    if (!words.length) return;
    window.ModuleSwitcher.switchTo('vocab');
    window.appConfig.startStudySession(words, {
      shuffle: !reviewOnly,
      limit: reviewOnly ? 20 : plan.dailyNewWords,
      practiceMode: 'mixed',
      source: reviewOnly
        ? { kind: 'daily-review', label: '今日到期复习', reviewCount: words.length }
        : undefined,
    });
  }

  function startWeakReview() {
    var model = buildModel();
    var currentWords = allLearningWords();
    var weakItems = model.stats && model.stats.weakWords ? model.stats.weakWords : [];
    var words = weakItems
      .map(function (item) {
        for (var i = 0; i < currentWords.length; i++) {
          if (currentWords[i].index === item.index) return currentWords[i];
        }
        return null;
      })
      .filter(Boolean);
    if (!words.length) return;
    window.ModuleSwitcher.switchTo('vocab');
    window.appConfig.startStudySession(words, {
      shuffle: false,
      limit: words.length,
      practiceMode: 'mixed',
      source: { kind: 'weak-stats', label: '统计建议复习', reviewCount: words.length },
    });
  }

  function countWeekDays(usage, now) {
    var count = 0;
    var cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    for (var i = 0; i < 7; i++) {
      var day = usage[localDateKey(cursor)] || {};
      if ((Number(day.focusedMs) || 0) > 0) count++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return count;
  }

  function relativeDateLabel(date, now) {
    if (!date || isNaN(date.getTime())) return '最近';
    var diff = Math.round(
      (new Date(now.getFullYear(), now.getMonth(), now.getDate()) -
        new Date(date.getFullYear(), date.getMonth(), date.getDate())) /
        86400000,
    );
    if (diff <= 0) return '今天';
    if (diff === 1) return '昨天';
    return diff + ' 天前';
  }

  function localDateKey(date) {
    return (
      date.getFullYear() +
      '-' +
      String(date.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(date.getDate()).padStart(2, '0')
    );
  }

  function esc(value) {
    return window.JPLearn.html.escape(value);
  }

  document.addEventListener('DOMContentLoaded', init);

  return { init: init, activate: activate, deactivate: deactivate, render: render };
})();

window.Dashboard = Dashboard;
