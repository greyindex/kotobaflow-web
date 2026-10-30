/**
 * StudyStorage: localStorage 持久化层
 *
 * 管理学习数据的读写。页面内使用 localStorage 做即时缓存，
 * ProgressStore 会把快照同步到本地文件 data/user_progress.json。
 *
 * 数据键:
 *   tgv_known     — 认识的词索引数组
 *   tgv_fuzzy     — 模糊的词索引数组
 *   tgv_unknown   — 不会的词索引数组
 *   tgv_favorites — 收藏的词索引数组
 *   tgv_history   — 学习历史记录
 */
var StudyStorage = {
  KEYS: {
    known: 'tgv_known',
    fuzzy: 'tgv_fuzzy',
    unknown: 'tgv_unknown',
    favorite: 'tgv_favorites',
    grammarFavorite: 'tgv_grammar_favorites',
    history: 'tgv_history',
    srs: 'tgv_srs',
  },

  COMMIT_KEY: 'tgv_commit_v1',
  _pendingCommit: null,

  // Write-ahead recovery for a single-page synchronous commit. The journal's
  // committed bit is the decision point; multi-key writes themselves are NOT atomic.
  recoverPendingCommit: function () {
    var record;
    try {
      var raw = localStorage.getItem(this.COMMIT_KEY);
      if (!raw) {
        this._pendingCommit = null;
        return { status: 'empty' };
      }
      record = JSON.parse(raw);
      var allowed = Object.values(this.KEYS).concat([
        'jp_learning_progress_browser_v1',
        'jp_learning_progress_offline_v1',
      ]);
      if (
        record.version !== 1 ||
        typeof record.committed !== 'boolean' ||
        typeof record.id !== 'string' ||
        !Array.isArray(record.entries) ||
        !record.entries.length ||
        record.entries.some(function (entry) {
          return (
            allowed.indexOf(entry.key) === -1 ||
            (entry.before !== null && typeof entry.before !== 'string') ||
            typeof entry.after !== 'string'
          );
        })
      )
        throw new Error('保存恢复记录无法识别');
      this._pendingCommit = record;
      record.entries.forEach(function (entry) {
        var value = record.committed ? entry.after : entry.before;
        if (localStorage.getItem(entry.key) === value) return;
        if (value === null) localStorage.removeItem(entry.key);
        else localStorage.setItem(entry.key, value);
        if (localStorage.getItem(entry.key) !== value) throw new Error('保存恢复读回失败');
      });
      localStorage.removeItem(this.COMMIT_KEY);
      if (localStorage.getItem(this.COMMIT_KEY) !== null) throw new Error('保存恢复尚未结束');
      this._pendingCommit = null;
      return { status: record.committed ? 'alreadySaved' : 'rolledBack', id: record.id, record: record };
    } catch (error) {
      this._pendingCommit = record || this._pendingCommit || { entries: [] };
      return { status: 'storageError', error: error };
    }
  },

  isWriteBlocked: function () {
    return !!this._pendingCommit;
  },

  hasPendingCommit: function () {
    return this.isWriteBlocked() || localStorage.getItem(this.COMMIT_KEY) !== null;
  },

  _readRaw: function (key) {
    if (this._pendingCommit) {
      var entry = (this._pendingCommit.entries || []).find(function (item) {
        return item.key === key;
      });
      if (entry) return this._pendingCommit.committed ? entry.after : entry.before;
    }
    return localStorage.getItem(key);
  },

  _snapshotForCommit: function () {
    var snapshot = { srsVersion: window.JPLearn.srs.VERSION };
    var self = this;
    Object.keys(this.KEYS).forEach(function (name) {
      var raw = self._readRaw(self.KEYS[name]);
      var value = raw === null ? [] : JSON.parse(raw);
      if (!Array.isArray(value)) throw new Error('学习记录读取失败，停止提交');
      snapshot[name] = value;
    });
    snapshot.srs = window.JPLearn.srs.normalizeRecords(snapshot.srs);
    return snapshot;
  },

  _commitSnapshot: function (snapshot, options) {
    options = options || {};
    // A clear whose durable outcome is still unknown must not be followed by
    // an answer from the old live session. Startup will recover both together.
    if (this._pendingCommit && this._pendingCommit.clearStudyRecords)
      return { status: 'storageError' };
    var recovered = this.recoverPendingCommit();
    if (recovered.status === 'storageError') return recovered;
    var progress = options.cacheOnly ? null : window.ProgressStore;
    if (recovered.record && progress && progress.acceptVocabularyCommit)
      progress.acceptVocabularyCommit(recovered.record);
    if (options.id && recovered.id === options.id && recovered.status === 'alreadySaved') return recovered;
    var self = this;
    var record;
    try {
      var entries = Object.keys(this.KEYS).map(function (name) {
        return {
          key: self.KEYS[name],
          before: localStorage.getItem(self.KEYS[name]),
          after: JSON.stringify(snapshot[name] || []),
        };
      });
      if (progress && progress.prepareVocabularyCommit)
        entries.push(progress.prepareVocabularyCommit(snapshot, options.checkpoint));
      // Keep unchanged cache hydration independent of spare localStorage quota.
      entries = entries.filter(function (entry) {
        return entry.before !== entry.after;
      });
      if (!entries.length) {
        if (!options.checkpoint && !options.cacheOnly && options.notify !== false) this._notifyChanged();
        return { status: 'saved' };
      }
      record = { version: 1, id: options.id || '', committed: false, entries: entries };
      if (options.clearStudyRecords) record.clearStudyRecords = true;
      var prepared = JSON.stringify(record);
      localStorage.setItem(this.COMMIT_KEY, prepared);
      this._pendingCommit = record;
      if (localStorage.getItem(this.COMMIT_KEY) !== prepared) throw new Error('保存准备未确认');
      entries.forEach(function (entry) {
        localStorage.setItem(entry.key, entry.after);
        if (localStorage.getItem(entry.key) !== entry.after) throw new Error('保存读回未确认');
      });
      record = Object.assign({}, record, { committed: true });
      localStorage.setItem(this.COMMIT_KEY, JSON.stringify(record));
    } catch (error) {
      var recovery = this.recoverPendingCommit();
      if (recovery.status === 'alreadySaved' && record && recovery.id === record.id) {
        if (progress && progress.acceptVocabularyCommit) progress.acceptVocabularyCommit(recovery.record);
        if (!options.checkpoint && !options.cacheOnly && options.notify !== false) this._notifyChanged();
        return recovery;
      }
      return { status: 'storageError', error: error };
    }
    var confirmed = this.recoverPendingCommit();
    if (confirmed.status !== 'alreadySaved') return { status: 'storageError' };
    if (progress && progress.acceptVocabularyCommit) progress.acceptVocabularyCommit(confirmed.record);
    // The caller applies its checkpoint before notifying views / autosave.
    if (!options.checkpoint && !options.cacheOnly && options.notify !== false) this._notifyChanged();
    return { status: 'saved' };
  },

  /**
   * 标记词条状态
   * @param {number} index - 词条索引
   * @param {string} status - 'known'|'fuzzy'|'unknown'|'favorite'|'skip'
   */
  markWord: function (index, status, options) {
    if (
      !Number.isSafeInteger(index) ||
      ['known', 'fuzzy', 'unknown', 'favorite', 'skip'].indexOf(status) === -1
    )
      return { status: 'empty' };
    if (status === 'favorite') {
      return this._changeSnapshot(function (snapshot) {
        if (snapshot.favorite.indexOf(index) === -1) snapshot.favorite.push(index);
      }, options);
    }
    var snapshot;
    try {
      snapshot = this._snapshotForCommit();
    } catch (error) {
      window.JPLearn.events.emit('storage:failed', {
        message: '学习状态读取失败，已停止提交；请保留站点数据并重试。',
      });
      return { status: 'storageError', error: error };
    }
    if (status !== 'skip') {
      ['known', 'fuzzy', 'unknown'].forEach(function (name) {
        snapshot[name] = snapshot[name].filter(function (id) {
          return id !== index;
        });
      });
      snapshot[status].push(index);
      var current = snapshot.srs.find(function (row) {
        return row.index === index;
      });
      var scheduled = window.JPLearn.srs.schedule(current, index, status, new Date());
      snapshot.srs = snapshot.srs.filter(function (row) {
        return row.index !== index;
      });
      if (scheduled) snapshot.srs.push(scheduled);
    }
    var result = this._commitSnapshot(snapshot, options);
    if (result.status === 'storageError')
      window.JPLearn.events.emit('storage:failed', {
        message: '学习状态保存未确认，请重试；恢复前请勿关闭页面。',
      });
    return result;
  },

  /**
   * 取消收藏
   */
  unfavorite: function (index) {
    if (!Number.isSafeInteger(index)) return { status: 'empty' };
    return this._changeSnapshot(function (snapshot) {
      snapshot.favorite = snapshot.favorite.filter(function (id) { return id !== index; });
    });
  },

  toggleGrammarFavorite: function (uid) {
    if (typeof uid !== 'string' || !uid.trim()) return { status: 'empty' };
    var favorite;
    var result = this._changeSnapshot(function (snapshot) {
      favorite = snapshot.grammarFavorite.indexOf(uid) === -1;
      if (favorite) snapshot.grammarFavorite.push(uid);
      else snapshot.grammarFavorite = snapshot.grammarFavorite.filter(function (id) { return id !== uid; });
    });
    if (result.status === 'saved' || result.status === 'alreadySaved') result.isFavorite = favorite;
    return result;
  },

  removeWordStatus: function (index, status) {
    if (!Number.isSafeInteger(index) || ['known', 'fuzzy', 'unknown'].indexOf(status) === -1)
      return { status: 'empty' };
    return this._changeSnapshot(function (snapshot) {
      if (snapshot[status].indexOf(index) === -1) return;
      snapshot[status] = snapshot[status].filter(function (id) { return id !== index; });
      snapshot.srs = snapshot.srs.filter(function (row) { return row.index !== index; });
    });
  },

  // These commands must not reconcile a pending answer behind its live view.
  // They share the same journal and durable ProgressStore entry as answers.
  _changeSnapshot: function (change, options) {
    var result;
    try {
      if (this.hasPendingCommit()) throw new Error('学习保存尚未恢复');
      var snapshot = this._snapshotForCommit();
      change(snapshot);
      result = this._commitSnapshot(snapshot, options);
    } catch (error) {
      result = { status: 'storageError', error: error };
    }
    if (result.status === 'storageError')
      window.JPLearn.events.emit('storage:failed', {
        message: '学习记录保存未确认，请保留站点数据并重新加载，恢复后再试。',
      });
    return result;
  },

  isGrammarFavorite: function (uid) {
    return this._isInSet('grammarFavorite', uid);
  },

  getGrammarFavorites: function () {
    return this._getSet('grammarFavorite');
  },

  /**
   * 查询词条当前状态
   * @returns {object} { status: 'known'|'fuzzy'|'unknown'|'none', isFavorite: bool }
   */
  getWordStatus: function (index) {
    var result = { status: 'none', isFavorite: false };

    if (this._isInSet('known', index)) result.status = 'known';
    else if (this._isInSet('fuzzy', index)) result.status = 'fuzzy';
    else if (this._isInSet('unknown', index)) result.status = 'unknown';

    result.isFavorite = this._isInSet('favorite', index);
    return result;
  },

  /**
   * 获取某状态下的所有词条索引
   */
  getWordsByStatus: function (status) {
    return this._getSet(status);
  },

  /**
   * 获取各状态的计数
   */
  getCounts: function () {
    return {
      known: this._getSet('known').length,
      fuzzy: this._getSet('fuzzy').length,
      unknown: this._getSet('unknown').length,
      favorite: this._getSet('favorite').length,
    };
  },

  getDueWordIndices: function (now) {
    return window.JPLearn.srs.getDueIndices(this._getSrsRecords(), now || new Date());
  },

  getSrsRecords: function () {
    return this._getSrsRecords();
  },

  /**
   * 保存一次学习会话记录
   */
  saveSession: function (stats, options) {
    if (this._pendingCommit && this._pendingCommit.clearStudyRecords)
      return { status: 'storageError' };
    var recovered = this.recoverPendingCommit();
    if (recovered.status === 'storageError') return recovered;
    if (recovered.record && window.ProgressStore && window.ProgressStore.acceptVocabularyCommit)
      window.ProgressStore.acceptVocabularyCommit(recovered.record);
    stats = stats || {};
    if ((Number(stats.total) || 0) <= 0) return { status: 'empty' };
    var snapshot;
    try {
      snapshot = this._snapshotForCommit();
    } catch (error) {
      return { status: 'storageError', error: error };
    }
    var history = snapshot.history;
    if (stats.id) {
      for (var i = 0; i < history.length; i++) {
        if (history[i] && history[i].id === stats.id) return { status: 'alreadySaved' };
      }
    }
    var weakWords = Array.isArray(stats.weakWords)
      ? stats.weakWords.slice(0, 5).map(function (word) {
          return {
            index: Number(word.index),
            word: String(word.word || ''),
            reading: String(word.reading || ''),
            meaning: String(word.meaning || ''),
            feedback: word.feedback === 'unknown' ? 'unknown' : 'fuzzy',
          };
        })
      : [];
    var exerciseStats = {};
    var allowedExerciseTypes = ['ja-zh', 'zh-ja', 'listening', 'input', 'cloze'];
    var rawExerciseStats =
      stats.exerciseStats && typeof stats.exerciseStats === 'object' ? stats.exerciseStats : {};
    for (var j = 0; j < allowedExerciseTypes.length; j++) {
      var exerciseType = allowedExerciseTypes[j];
      var rawStat = rawExerciseStats[exerciseType];
      if (!rawStat || typeof rawStat !== 'object') continue;
      exerciseStats[exerciseType] = {
        total: Math.max(0, Number(rawStat.total) || 0),
        correct: Math.max(0, Number(rawStat.correct) || 0),
        incorrect: Math.max(0, Number(rawStat.incorrect) || 0),
        skipped: Math.max(0, Number(rawStat.skipped) || 0),
      };
    }
    var rawSource = stats.source && typeof stats.source === 'object' ? stats.source : {};
    var source = {
      kind: String(rawSource.kind || 'direct'),
      label: String(rawSource.label || '学习队列'),
      parentSessionId: String(rawSource.parentSessionId || ''),
      rootSessionId: String(rawSource.rootSessionId || ''),
      depth: Math.max(0, Number(rawSource.depth) || 0),
      parentTotal: Math.max(0, Number(rawSource.parentTotal) || 0),
      reviewCount: Math.max(0, Number(rawSource.reviewCount) || 0),
    };
    history.push({
      id: stats.id ? String(stats.id) : '',
      date: typeof stats.date === 'string' ? stats.date : new Date().toISOString(),
      total: stats.total || 0,
      known: stats.known || 0,
      fuzzy: stats.fuzzy || 0,
      unknown: stats.unknown || 0,
      skipped: stats.skipped || 0,
      durationMs: Math.max(0, Number(stats.durationMs) || 0),
      newlyMastered: Math.max(0, Number(stats.newlyMastered) || 0),
      pendingReview: Math.max(0, Number(stats.pendingReview) || 0),
      weakWords: weakWords,
      practiceMode: stats.practiceMode === 'mixed' ? 'mixed' : 'classic',
      exerciseStats: exerciseStats,
      source: source,
    });
    // 只保留最近 100 条记录
    if (history.length > 100) {
      history = history.slice(history.length - 100);
    }
    snapshot.history = history;
    return this._commitSnapshot(snapshot, options);
  },

  /**
   * 获取学习历史
   */
  getHistory: function () {
    try {
      var raw = this._readRaw(this.KEYS.history);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  },

  /**
   * 清空词汇/语法记录及未完会话，保留计划、计时、阅读位置和外观。
   */
  clearAll: function () {
    var names = Object.keys(this.KEYS);
    var result = this._changeSnapshot(function (snapshot) {
      names.forEach(function (name) { snapshot[name] = []; });
    }, { checkpoint: null, notify: false, clearStudyRecords: true });
    if (result.status === 'saved' || result.status === 'alreadySaved') {
      // Owners discard stale live checkpoints before autosave can capture them.
      window.JPLearn.events.emit('study:cleared');
      this._notifyChanged();
    }
    return result;
  },

  exportSnapshot: function () {
    return {
      known: this._getSet('known'),
      fuzzy: this._getSet('fuzzy'),
      unknown: this._getSet('unknown'),
      favorite: this._getSet('favorite'),
      grammarFavorite: this._getSet('grammarFavorite'),
      history: this.getHistory(),
      srsVersion: window.JPLearn.srs.VERSION,
      srs: this._getSrsRecords(),
    };
  },

  importSnapshot: function (snapshot, options) {
    snapshot = snapshot || {};
    options = options || {};
    var next = {
      known: this._normalizeNumberArray(snapshot.known),
      fuzzy: this._normalizeNumberArray(snapshot.fuzzy),
      unknown: this._normalizeNumberArray(snapshot.unknown),
      favorite: this._normalizeNumberArray(snapshot.favorite),
      grammarFavorite: this._normalizeStringArray(snapshot.grammarFavorite),
      history: Array.isArray(snapshot.history) ? snapshot.history : [],
    };
    next.srs = window.JPLearn.srs.migrateLegacy(
      snapshot.srs || [],
      next,
      options.referenceNow || new Date(),
      options.timezoneOffsetMinutes,
    );
    // Hydrate the cache as one recoverable group. The source progress snapshot
    // remains untouched until ProgressStore has checked the result.
    return this._commitSnapshot(next, { cacheOnly: true });
  },

  // Restore all vocabulary keys or put their original bytes back on failure.
  // The caller keeps a full archive backup before this multi-key operation.
  replaceSnapshotStrict: function (snapshot) {
    var previous = {};
    var keys = Object.keys(this.KEYS);
    var self = this;
    keys.forEach(function (name) {
      previous[name] = localStorage.getItem(self.KEYS[name]);
    });
    function rollback() {
      keys.forEach(function (name) {
        if (previous[name] === null) localStorage.removeItem(self.KEYS[name]);
        else localStorage.setItem(self.KEYS[name], previous[name]);
      });
    }
    try {
      keys.forEach(function (name) {
        var body = JSON.stringify(snapshot[name] || []);
        localStorage.setItem(self.KEYS[name], body);
        if (localStorage.getItem(self.KEYS[name]) !== body) throw new Error('存储读回校验失败');
      });
    } catch (error) {
      try {
        rollback();
      } catch (rollbackError) {
        throw new Error('恢复未完成；原记录备份已保留，请勿继续学习或清除站点数据', { cause: rollbackError });
      }
      throw error;
    }
    return rollback;
  },

  migrateSrs: function (referenceNow, timezoneOffsetMinutes, sourceRecords) {
    var records = typeof sourceRecords === 'undefined' ? this._getSrsRecords() : sourceRecords;
    var migrated = window.JPLearn.srs.migrateLegacy(
      records,
      {
        known: this._getSet('known'),
        fuzzy: this._getSet('fuzzy'),
        unknown: this._getSet('unknown'),
      },
      referenceNow || new Date(),
      timezoneOffsetMinutes,
    );
    this._saveSrsRecords(migrated);
    return migrated;
  },

  // ─── 内部方法 ───────────────────────────────

  _getSet: function (status) {
    try {
      var raw = this._readRaw(this.KEYS[status]);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  },

  _isInSet: function (status, index) {
    var arr = this._getSet(status);
    return arr.indexOf(index) !== -1;
  },

  _scheduleReview: function (index, status) {
    var records = this._getSrsRecords();
    var current = null;
    for (var i = 0; i < records.length; i++) {
      if (records[i].index === index) {
        current = records[i];
        break;
      }
    }
    var scheduled = window.JPLearn.srs.schedule(current, index, status, new Date());
    if (!scheduled) return;
    var next = [];
    for (var j = 0; j < records.length; j++) {
      if (records[j].index !== index) next.push(records[j]);
    }
    next.push(scheduled);
    this._saveSrsRecords(next);
  },

  _getSrsRecords: function () {
    try {
      var raw = this._readRaw(this.KEYS.srs);
      return window.JPLearn.srs.normalizeRecords(raw ? JSON.parse(raw) : []);
    } catch (e) {
      return [];
    }
  },

  _saveSrsRecords: function (records) {
    try {
      localStorage.setItem(this.KEYS.srs, JSON.stringify(window.JPLearn.srs.normalizeRecords(records)));
    } catch (e) {
      console.warn('[Storage] 保存 SRS 失败:', e);
    }
  },

  _normalizeNumberArray: function (value) {
    if (!Array.isArray(value)) return [];
    var seen = {};
    var out = [];
    for (var i = 0; i < value.length; i++) {
      var n = parseInt(value[i], 10);
      if (!isFinite(n) || seen[n]) continue;
      seen[n] = true;
      out.push(n);
    }
    return out;
  },

  _normalizeStringArray: function (value) {
    if (!Array.isArray(value)) return [];
    var seen = {};
    var out = [];
    for (var i = 0; i < value.length; i++) {
      var s = String(value[i] || '').trim();
      if (!s || seen[s]) continue;
      seen[s] = true;
      out.push(s);
    }
    return out;
  },

  _notifyChanged: function () {
    window.JPLearn.events.emit('vocabulary:changed');
  },
};

window.StudyStorage = StudyStorage;
StudyStorage.recoverPendingCommit();
