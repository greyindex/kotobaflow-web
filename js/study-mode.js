/**
 * StudyMode: 学习模式 UI 和逻辑引擎
 *
 * 功能：
 *   - 基于筛选条件生成学习队列
 *   - 卡片式正反面学习
 *   - 5 种反馈（认识/模糊/不会/收藏/跳过）
 *   - 错词本/模糊/收藏子视图
 *   - 图谱联动
 */
function StudyMode(containerId) {
  this.container = document.getElementById(containerId);
  this.queue = []; // 当前学习队列 [{wordObj, ...}, ...]
  this.currentIndex = 0; // 当前卡片在 queue 中的位置
  this.isFlipped = false; // 是否显示答案
  this.sessionStats = { total: 0, known: 0, fuzzy: 0, unknown: 0, skipped: 0 };
  this.sessionStartedAt = 0;
  this.sessionCompletedAt = 0;
  this.sessionId = '';
  this.sessionInitialStatuses = {};
  this.sessionResults = [];
  this.sessionSummary = null;
  this.sessionSaved = false;
  this.feedbackLocked = false;
  this.saveError = '';
  this._pendingFeedback = null;
  this.practiceMode = 'mixed';
  this.currentExercise = null;
  this.exerciseFeedback = null;
  this.practiceNotice = '';
  this.exerciseStats = {};
  this.sessionSource = { kind: 'direct', label: '学习队列', depth: 0 };
  this.resultTrail = [];
  this.subView = null; // null | 'errorbook' | 'fuzzybook' | 'favorites'
  var self = this;
  window.JPLearn.events.on('study:cleared', function () {
    self._replaceQueue([], { practiceMode: self.practiceMode });
    self.render();
    self._updateStatusBar();
  });
}

StudyMode.prototype._queueCheckpointSave = function () {
  if (window.ProgressStore && window.ProgressStore.queueSave) window.ProgressStore.queueSave(0);
};

StudyMode.prototype._copyCheckpointValue = function (value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (err) {
    return fallback;
  }
};

StudyMode.prototype.exportCheckpoint = function () {
  if (!this.queue.length) return null;
  return {
    version: 1,
    queueIndices: this.queue.map(function (word) {
      return word.index;
    }),
    currentIndex: this.currentIndex,
    isFlipped: this.isFlipped,
    sessionStartedAt: this.sessionStartedAt,
    sessionCompletedAt: this.sessionCompletedAt,
    sessionId: this.sessionId,
    sessionInitialStatuses: this._copyCheckpointValue(this.sessionInitialStatuses, {}),
    sessionResults: this._copyCheckpointValue(this.sessionResults, []),
    sessionSummary: this._copyCheckpointValue(this.sessionSummary, null),
    sessionSaved: this.sessionSaved,
    practiceMode: this.practiceMode,
    currentExerciseType: this.currentExercise ? this.currentExercise.type : '',
    currentExercise: this._copyCheckpointValue(this.currentExercise, null),
    exerciseFeedback: this._copyCheckpointValue(this.exerciseFeedback, null),
    practiceNotice: this.practiceNotice,
    exerciseStats: this._copyCheckpointValue(this.exerciseStats, {}),
    sessionSource: this._copyCheckpointValue(this.sessionSource, {
      kind: 'direct',
      label: '学习队列',
      depth: 0,
    }),
  };
};

StudyMode.prototype._resolveCheckpointQueue = function (checkpoint) {
  if (!checkpoint || checkpoint.version !== 1 || !Array.isArray(checkpoint.queueIndices)) return null;
  if (
    !checkpoint.queueIndices.length ||
    checkpoint.queueIndices.length > window.JPLearn.practice.MAX_SESSION_WORDS
  )
    return null;

  var allWords = window.taxonomyManager && window.taxonomyManager.allWords;
  if (!Array.isArray(allWords) || !allWords.length) return null;
  var wordMap = {};
  for (var i = 0; i < allWords.length; i++) wordMap[String(allWords[i].index)] = allWords[i];
  var queue = [];
  for (var q = 0; q < checkpoint.queueIndices.length; q++) {
    var word = wordMap[String(checkpoint.queueIndices[q])];
    if (!word) return null;
    queue.push(word);
  }
  return queue;
};

StudyMode.prototype.restoreCheckpoint = function (checkpoint, options) {
  options = options || {};
  var queue = this._resolveCheckpointQueue(checkpoint);
  if (!queue) return false;

  var allowedFeedback = { known: true, fuzzy: true, unknown: true, skip: true };
  var rawResults = Array.isArray(checkpoint.sessionResults) ? checkpoint.sessionResults : [];
  var results = [];
  for (var r = 0; r < rawResults.length && r < queue.length; r++) {
    var result = rawResults[r];
    if (!result || !allowedFeedback[result.feedback]) continue;
    results.push({
      index: result.index,
      word: String(result.word || ''),
      reading: String(result.reading || ''),
      meaning: String(result.meaning || ''),
      feedback: result.feedback,
      initialStatus: String(result.initialStatus || 'none'),
      exerciseType: String(result.exerciseType || 'classic'),
      correct: typeof result.correct === 'boolean' ? result.correct : null,
    });
  }

  var currentIndex = Math.max(0, Math.min(queue.length, Math.floor(Number(checkpoint.currentIndex) || 0)));
  var stats = { total: queue.length, known: 0, fuzzy: 0, unknown: 0, skipped: 0 };
  for (var s = 0; s < results.length; s++) {
    if (results[s].feedback === 'known') stats.known++;
    else if (results[s].feedback === 'fuzzy') stats.fuzzy++;
    else if (results[s].feedback === 'unknown') stats.unknown++;
    else if (results[s].feedback === 'skip') stats.skipped++;
  }
  currentIndex = Math.max(currentIndex, results.length);

  this.queue = queue;
  this.currentIndex = currentIndex;
  this.isFlipped = !!checkpoint.isFlipped;
  this.subView = null;
  this.sessionStats = stats;
  this.sessionStartedAt = Math.max(0, Number(checkpoint.sessionStartedAt) || Date.now());
  this.sessionCompletedAt = Math.max(0, Number(checkpoint.sessionCompletedAt) || 0);
  this.sessionId = String(checkpoint.sessionId || 'vocab-' + this.sessionStartedAt + '-restored');
  this.sessionInitialStatuses =
    checkpoint.sessionInitialStatuses && typeof checkpoint.sessionInitialStatuses === 'object'
      ? this._copyCheckpointValue(checkpoint.sessionInitialStatuses, {})
      : {};
  this.sessionResults = results;
  this.sessionSummary =
    checkpoint.sessionSummary && typeof checkpoint.sessionSummary === 'object'
      ? this._copyCheckpointValue(checkpoint.sessionSummary, null)
      : null;
  this.sessionSaved = window.StudyStorage.getHistory().some(function (record) {
    return record.id === checkpoint.sessionId;
  });
  this.feedbackLocked = false;
  this.practiceMode = checkpoint.practiceMode === 'mixed' ? 'mixed' : 'classic';
  this.currentExercise = null;
  this.exerciseFeedback = null;
  this.practiceNotice = String(checkpoint.practiceNotice || '');
  this.exerciseStats =
    checkpoint.exerciseStats && typeof checkpoint.exerciseStats === 'object'
      ? this._copyCheckpointValue(checkpoint.exerciseStats, {})
      : {};
  this.sessionSource =
    checkpoint.sessionSource && typeof checkpoint.sessionSource === 'object'
      ? this._copyCheckpointValue(checkpoint.sessionSource, { kind: 'direct', label: '学习队列', depth: 0 })
      : { kind: 'direct', label: '学习队列', depth: 0 };
  this.resultTrail = [];

  if (this.practiceMode === 'mixed' && this.currentIndex < this.queue.length) {
    var savedExercise = window.JPLearn.practice.restoreExercise(
      checkpoint.currentExercise,
      this.queue[this.currentIndex],
      this.currentIndex,
      this._getExercisePool(),
    );
    var exercise =
      savedExercise ||
      window.JPLearn.practice.createExercise(
        this.queue[this.currentIndex],
        this._getExercisePool(),
        this.currentIndex,
        checkpoint.currentExerciseType ? { preferredType: checkpoint.currentExerciseType } : {},
      );
    if (exercise) {
      this.currentExercise = exercise;
      var feedback = savedExercise ? checkpoint.exerciseFeedback : null;
      if (!savedExercise && checkpoint.currentExerciseType)
        this.practiceNotice = '旧题面未完整保存或内容已变化，已重新出题，请重新作答。';
      if (feedback && typeof feedback.correct === 'boolean') {
        var selectedIndex = exercise.options ? Math.floor(Number(feedback.selectedIndex)) : -1;
        if (!exercise.options || (selectedIndex >= 0 && selectedIndex < exercise.options.length)) {
          this.exerciseFeedback = {
            correct: window.JPLearn.practice.isCorrect(
              exercise,
              exercise.options ? selectedIndex : feedback.inputValue,
            ),
            selectedIndex: selectedIndex,
            inputValue: exercise.options ? '' : String(feedback.inputValue || ''),
          };
        }
      }
    }
  }

  if (options.render !== false) this.render();
  this._updateStatusBar();
  return true;
};

// ─── 队列生成 ────────────────────────────────────────

StudyMode.prototype._replaceQueue = function (words, options) {
  options = options || {};
  this.queue = Array.isArray(words) ? words.slice(0, window.JPLearn.practice.MAX_SESSION_WORDS) : [];
  this.saveError = '';
  this._pendingFeedback = null;
  this.currentIndex = 0;
  this.isFlipped = false;
  this.subView = null;
  this.sessionStats = { total: this.queue.length, known: 0, fuzzy: 0, unknown: 0, skipped: 0 };
  this.sessionStartedAt = Date.now();
  this.sessionCompletedAt = 0;
  this.sessionId = 'vocab-' + this.sessionStartedAt + '-' + Math.random().toString(36).slice(2, 9);
  this.sessionInitialStatuses = {};
  for (var i = 0; i < this.queue.length; i++) {
    var word = this.queue[i];
    this.sessionInitialStatuses[word.index] = window.StudyStorage.getWordStatus(word.index).status;
  }
  this.sessionResults = [];
  this.sessionSummary = null;
  this.sessionSaved = false;
  this.feedbackLocked = false;
  this.practiceMode = options.practiceMode === 'mixed' ? 'mixed' : 'classic';
  this.currentExercise = null;
  this.exerciseFeedback = null;
  this.practiceNotice = '';
  this.exerciseStats = {};
  this.sessionSource =
    options.source && typeof options.source === 'object'
      ? {
          kind: String(options.source.kind || 'direct'),
          label: String(options.source.label || '学习队列'),
          parentSessionId: String(options.source.parentSessionId || ''),
          rootSessionId: String(options.source.rootSessionId || ''),
          depth: Math.max(0, Number(options.source.depth) || 0),
          parentTotal: Math.max(0, Number(options.source.parentTotal) || 0),
          reviewCount: Math.max(0, Number(options.source.reviewCount) || 0),
          bookId: String(options.source.bookId || ''),
          lessonId: String(options.source.lessonId || ''),
          courseStep: String(options.source.courseStep || ''),
          returnModule: String(options.source.returnModule || ''),
          returnReaderScrollTop: Math.max(0, Number(options.source.returnReaderScrollTop) || 0),
          coursePath:
            options.source.coursePath && typeof options.source.coursePath === 'object'
              ? options.source.coursePath
              : null,
        }
      : { kind: 'direct', label: '学习队列', depth: 0 };
  this.sessionSource.requestedCount = Array.isArray(words) ? words.length : 0;
  if (!options.preserveTrail) this.resultTrail = [];
  this._queueCheckpointSave();
};

StudyMode.prototype._finalizeSession = function () {
  if (this.queue.length === 0 || this.currentIndex < this.queue.length) return null;
  if (this.sessionSummary) {
    this._saveSessionSummary();
    return this.sessionSummary;
  }

  this.sessionCompletedAt = this.sessionCompletedAt || Date.now();
  var weak = this.sessionResults
    .filter(function (result) {
      return result.feedback === 'unknown' || result.feedback === 'fuzzy';
    })
    .sort(function (a, b) {
      var rank = { unknown: 0, fuzzy: 1 };
      return rank[a.feedback] - rank[b.feedback];
    })
    .slice(0, 5);
  var newlyMastered = 0;
  for (var i = 0; i < this.sessionResults.length; i++) {
    var result = this.sessionResults[i];
    if (result.feedback === 'known' && result.initialStatus !== 'known') newlyMastered++;
  }
  this.sessionSummary = {
    id: this.sessionId,
    date: new Date(this.sessionCompletedAt).toISOString(),
    total: this.sessionStats.total,
    known: this.sessionStats.known,
    fuzzy: this.sessionStats.fuzzy,
    unknown: this.sessionStats.unknown,
    skipped: this.sessionStats.skipped,
    durationMs: Math.max(0, this.sessionCompletedAt - this.sessionStartedAt),
    newlyMastered: newlyMastered,
    pendingReview: this.sessionStats.fuzzy + this.sessionStats.unknown,
    weakWords: weak,
    practiceMode: this.practiceMode,
    exerciseStats: this.exerciseStats,
    source: this.sessionSource,
  };
  this._saveSessionSummary();
  return this.sessionSummary;
};

StudyMode.prototype._saveSessionSummary = function () {
  if (this.sessionSaved) return;
  var checkpoint = this.exportCheckpoint();
  checkpoint.sessionSaved = true;
  var result = window.StudyStorage.saveSession(this.sessionSummary, {
    id: this.sessionId + ':history',
    checkpoint: checkpoint,
  });
  this.sessionSaved = result.status === 'saved' || result.status === 'alreadySaved';
  if (this.sessionSaved) window.StudyStorage._notifyChanged();
};

/**
 * 公开的学习会话入口。外部视图不应直接修改 queue/currentIndex/sessionStats。
 * @param {Array} words - 要学习的词条
 * @param {{shuffle?: boolean, limit?: number}=} options - 会话选项
 * @returns {boolean} 是否成功启动会话
 */
StudyMode.prototype.startSession = function (words, options) {
  options = options || {};
  var queue = Array.isArray(words) ? words.slice() : [];
  if (options.shuffle) {
    for (var i = queue.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = queue[i];
      queue[i] = queue[j];
      queue[j] = tmp;
    }
  }
  if (Number.isFinite(options.limit)) queue = queue.slice(0, Math.max(0, options.limit));
  if (queue.length === 0) return false;

  this._replaceQueue(queue, {
    practiceMode: options.practiceMode,
    source: options.source,
    preserveTrail: options.preserveTrail,
  });
  window.ViewMode.set('study');
  this.render();
  this._updateStatusBar();
  this._queueCheckpointSave();
  return true;
};

/**
 * 从筛选后的词条生成学习队列
 * @param {Array} filteredWords - 已通过筛选的词条
 * @param {number} count - 学习数量
 */
StudyMode.prototype.generateQueue = function (filteredWords, count, options) {
  count = Math.min(count, filteredWords.length);

  // 随机打乱
  var shuffled = filteredWords.slice();
  for (var i = shuffled.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = tmp;
  }

  this._replaceQueue(shuffled.slice(0, count), options);
};

/**
 * 从错词本/模糊/收藏列表生成复习队列
 */
StudyMode.prototype.generateReviewQueue = function (status, options) {
  var indices = window.StudyStorage.getWordsByStatus(status);
  var allWords = window.taxonomyManager.allWords;
  var words = [];

  for (var i = 0; i < indices.length; i++) {
    for (var j = 0; j < allWords.length; j++) {
      if (allWords[j].index === indices[i]) {
        words.push(allWords[j]);
        break;
      }
    }
  }

  if (words.length === 0) return false;

  options = options || { practiceMode: this.practiceMode };
  if (!options.source) {
    options.source = {
      kind: 'status-review',
      label: status === 'favorite' ? '收藏词复习' : status === 'fuzzy' ? '模糊词复习' : '错词本复习',
      reviewCount: words.length,
    };
  }
  this._replaceQueue(words, options);
  return true;
};

StudyMode.prototype._captureSessionState = function () {
  return {
    queue: this.queue.slice(),
    currentIndex: this.currentIndex,
    isFlipped: this.isFlipped,
    sessionStats: Object.assign({}, this.sessionStats),
    sessionStartedAt: this.sessionStartedAt,
    sessionCompletedAt: this.sessionCompletedAt,
    sessionId: this.sessionId,
    sessionInitialStatuses: Object.assign({}, this.sessionInitialStatuses),
    sessionResults: this.sessionResults.slice(),
    sessionSummary: this.sessionSummary,
    sessionSaved: this.sessionSaved,
    practiceMode: this.practiceMode,
    exerciseStats: this.exerciseStats,
    sessionSource: this.sessionSource,
  };
};

StudyMode.prototype._restoreSessionState = function (state) {
  if (!state) return false;
  this.queue = state.queue.slice();
  this.currentIndex = state.currentIndex;
  this.isFlipped = state.isFlipped;
  this.sessionStats = Object.assign({}, state.sessionStats);
  this.sessionStartedAt = state.sessionStartedAt;
  this.sessionCompletedAt = state.sessionCompletedAt;
  this.sessionId = state.sessionId;
  this.sessionInitialStatuses = Object.assign({}, state.sessionInitialStatuses);
  this.sessionResults = state.sessionResults.slice();
  this.sessionSummary = state.sessionSummary;
  this.sessionSaved = state.sessionSaved;
  this.feedbackLocked = false;
  this.practiceMode = state.practiceMode;
  this.currentExercise = null;
  this.exerciseFeedback = null;
  this.practiceNotice = '';
  this.exerciseStats = state.exerciseStats;
  this.sessionSource = state.sessionSource;
  this.subView = null;
  this.render();
  this._updateStatusBar();
  this._queueCheckpointSave();
  return true;
};

StudyMode.prototype.startResultReview = function (summary) {
  if (!summary || summary.id !== this.sessionId || this.currentIndex < this.queue.length) return false;
  var indexSet = {};
  var reviewIndices = [];
  for (var i = 0; i < this.sessionResults.length; i++) {
    var result = this.sessionResults[i];
    if (result.feedback !== 'unknown' && result.feedback !== 'fuzzy') continue;
    if (indexSet[result.index]) continue;
    indexSet[result.index] = true;
    reviewIndices.push(result.index);
  }
  if (reviewIndices.length === 0) return false;

  var wordMap = {};
  var allWords = window.taxonomyManager.allWords;
  for (var j = 0; j < allWords.length; j++) wordMap[allWords[j].index] = allWords[j];
  var words = reviewIndices
    .map(function (index) {
      return wordMap[index];
    })
    .filter(Boolean);
  if (words.length === 0) return false;

  var parentSource = summary.source || this.sessionSource || {};
  var depth = parentSource.kind === 'result-review' ? Math.max(1, Number(parentSource.depth) || 1) + 1 : 1;
  var rootSessionId =
    parentSource.kind === 'result-review' && parentSource.rootSessionId
      ? parentSource.rootSessionId
      : summary.id;
  this.resultTrail.push(this._captureSessionState());
  this._replaceQueue(words, {
    practiceMode: summary.practiceMode,
    preserveTrail: true,
    source: {
      kind: 'result-review',
      label: '本次错项复习',
      parentSessionId: summary.id,
      rootSessionId: rootSessionId,
      depth: depth,
      parentTotal: summary.total,
      reviewCount: words.length,
    },
  });
  window.ViewMode.set('study');
  this.render();
  this._updateStatusBar();
  return true;
};

StudyMode.prototype.returnToPreviousResult = function () {
  if (this.resultTrail.length === 0) return false;
  return this._restoreSessionState(this.resultTrail.pop());
};

StudyMode.prototype.leaveStudyToDashboard = function () {
  this.queue = [];
  this.currentIndex = 0;
  this.resultTrail = [];
  this.sessionSource = { kind: 'direct', label: '学习队列', depth: 0 };
  this._queueCheckpointSave();
  window.ModuleSwitcher.switchTo('dashboard');
};

StudyMode.prototype.leaveStudyToCatalog = function () {
  this.queue = [];
  this.currentIndex = 0;
  this.resultTrail = [];
  this.sessionSource = { kind: 'direct', label: '学习队列', depth: 0 };
  this.currentExercise = null;
  this.exerciseFeedback = null;
  this.feedbackLocked = false;
  this._queueCheckpointSave();
  window.ViewMode.set('cards');
  this._updateStatusBar();
};

StudyMode.prototype._getExercisePool = function () {
  var allWords = window.taxonomyManager && window.taxonomyManager.allWords;
  return Array.isArray(allWords) && allWords.length ? allWords : this.queue;
};

StudyMode.prototype._getCurrentExercise = function () {
  if (this.practiceMode !== 'mixed' || this.currentIndex >= this.queue.length) return null;
  var word = this.queue[this.currentIndex];
  if (!this.currentExercise || this.currentExercise.wordIndex !== word.index) {
    this.currentExercise = window.JPLearn.practice.createExercise(
      word,
      this._getExercisePool(),
      this.currentIndex,
    );
    this.exerciseFeedback = null;
  }
  return this.currentExercise;
};

StudyMode.prototype._fallbackExercise = function (type, message) {
  if (this.practiceMode !== 'mixed' || this.exerciseFeedback || this.currentIndex >= this.queue.length)
    return false;
  var word = this.queue[this.currentIndex];
  var fallback = window.JPLearn.practice.createExercise(word, this._getExercisePool(), this.currentIndex, {
    preferredType: type,
    exclude: [type],
  });
  if (!fallback) return false;
  this.currentExercise = fallback;
  this.exerciseFeedback = null;
  this.practiceNotice = message || '当前题型不可用，已自动切换。';
  this.render();
  this._queueCheckpointSave();
  return true;
};

// ─── 渲染入口 ────────────────────────────────────────

/**
 * 渲染学习模式主界面（配置 + 进入学习）
 */
StudyMode.prototype._updateStatusBar = function () {
  var el = document.getElementById('statusStudyQueue');
  if (el) {
    var remaining = Math.max(0, this.queue.length - this.currentIndex);
    el.textContent = remaining;
  }
};

// ─── 工具方法 ────────────────────────────────────────

StudyMode.prototype._esc = function (str) {
  return window.JPLearn.html.escape(str);
};

StudyMode.prototype._getDisplayReading = function (word) {
  return word && word.reading_hiragana ? String(word.reading_hiragana).trim() : '';
};
window.JPLearn.installStudyRenderer(StudyMode);
window.JPLearn.installStudyEvents(StudyMode);
