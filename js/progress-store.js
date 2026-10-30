/**
 * ProgressStore: file-backed study progress and focused-time check-ins.
 */
var ProgressStore = (function () {
  var CHECKIN_MS = 60 * 60 * 1000;
  var SAVE_INTERVAL_MS = 15000;
  var TICK_MS = 1000;
  var OFFLINE_STORAGE_KEY = 'jp_learning_progress_offline_v1';
  var BROWSER_STORAGE_KEY = 'jp_learning_progress_browser_v1';
  var configuredMode = (window.JPLearnStorageConfig || {}).mode;
  var storageMode =
    ['browser', 'local-api', 'account-sync'].indexOf(configuredMode) !== -1 ? configuredMode : 'browser';
  var usesApi = storageMode === 'local-api';
  var browserBaseline = null;
  var restoring = false;
  var restorePreviewOpen = false;
  var RESTORE_BACKUP_KEY = 'jp_learning_progress_restore_backup_v1';

  var state = null;
  var generation = 0;
  var saving = null;
  var saveAgain = false;
  var conflict = false;
  var loadFailed = false;
  var hydrationFailed = false;
  var CONFIRMED_STORAGE_KEY = 'jp_learning_progress_confirmed_v1';
  var todayKey = '';
  var activeSince = 0;
  var saveTimer = 0;
  var intervalTimer = 0;
  var tickTimer = 0;
  var initialized = false;
  var vocabularyError = '';
  var els = {};
  var PLAN_DEFAULTS = {
    dailyMinutes: 10,
    dailyNewWords: 20,
    bookId: window.JPLearn.textbooks.defaultBookId(),
    lessonId: 'lesson_02',
    jlptTarget: 'N5',
    updatedAt: '',
  };

  function defaultState() {
    return {
      version: 2,
      revision: 0,
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
      navigation: {
        version: 1,
        lastModule: '',
        vocab: {},
        grammar: {},
        textbook: {},
      },
      plan: defaultPlan(),
      usage: {},
      updatedAt: '',
    };
  }

  function defaultPlan() {
    return {
      dailyMinutes: PLAN_DEFAULTS.dailyMinutes,
      dailyNewWords: PLAN_DEFAULTS.dailyNewWords,
      bookId: PLAN_DEFAULTS.bookId,
      lessonId: PLAN_DEFAULTS.lessonId,
      jlptTarget: PLAN_DEFAULTS.jlptTarget,
      updatedAt: PLAN_DEFAULTS.updatedAt,
    };
  }

  async function init() {
    if (initialized) return state;
    state = await load();
    if (window.StudyStorage.isWriteBlocked()) loadFailed = true;
    if (!loadFailed) migrateVocabulary();
    todayKey = localDateKey(new Date());
    ensureToday();
    cacheEls();
    setSyncText(storageLabel());
    bindEvents();
    render();
    startCountingIfActive();
    intervalTimer = setInterval(function () {
      commitActiveTime();
      rollDateIfNeeded();
      render();
      announceMinutes();
      save();
    }, SAVE_INTERVAL_MS);
    tickTimer = setInterval(function () {
      commitActiveTime();
      rollDateIfNeeded();
      render();
      announceMinutes();
    }, TICK_MS);
    initialized = true;
    if (loadFailed) setSyncText('读取存档失败，已暂停写入；请保留页面并重新加载恢复');
    queueSave();
    return state;
  }

  async function load() {
    if (!usesApi) return loadBrowser();
    try {
      var res = await fetch('/api/progress', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var remote = normalize(await res.json());
      var offline = readOfflineSnapshot();
      if (offline && (offline.pending === true || isSnapshotNewer(offline, remote))) {
        loadFailed = offline.readFailure === true;
        return offline;
      }
      if (offline) clearOfflineSnapshot();
      return remote;
    } catch (e) {
      loadFailed = true;
      console.warn('[ProgressStore] 读取本地存档失败，使用浏览器缓存:', e);
      try {
        var confirmed = localStorage.getItem(CONFIRMED_STORAGE_KEY);
        var fallback = readOfflineSnapshot() || (confirmed ? normalize(JSON.parse(confirmed)) : null);
        loadFailed = !fallback || fallback.readFailure === true;
        return fallback || defaultState();
      } catch (storageError) {
        return readOfflineSnapshot() || defaultState();
      }
    }
  }

  function storageLabel() {
    if (usesApi) return window.__KOTOBAFLOW_NATIVE__ ? '仅保存在此设备' : '本机文件存档';
    return storageMode === 'account-sync' ? '账号同步尚未启用；仅保存在此浏览器' : '仅保存在此浏览器';
  }

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function optionalFieldsMatch(value, fields, valid) {
    return fields.every(function (field) {
      return !Object.prototype.hasOwnProperty.call(value, field) || valid(value[field]);
    });
  }

  function validBrowserSnapshot(raw) {
    if (
      !isRecord(raw) ||
      (raw.version !== 1 && raw.version !== 2) ||
      !isRecord(raw.vocabulary) ||
      !isRecord(raw.usage)
    )
      return false;
    // Missing optional fields are valid in older saves; present malformed fields
    // must not be normalized to empty values and written over the recovery copy.
    if (
      !optionalFieldsMatch(
        raw.vocabulary,
        ['known', 'fuzzy', 'unknown', 'favorite', 'grammarFavorite', 'history', 'srs'],
        Array.isArray,
      ) ||
      !optionalFieldsMatch(raw, ['plan', 'navigation'], isRecord) ||
      !optionalFieldsMatch(raw, ['updatedAt'], function (value) {
        return typeof value === 'string';
      })
    )
      return false;
    var stringValue = function (value) {
      return typeof value === 'string';
    };
    var booleanValue = function (value) {
      return typeof value === 'boolean';
    };
    var numberValue = function (value) {
      return Number.isFinite(value) && value >= 0;
    };
    if (
      raw.plan &&
      (!optionalFieldsMatch(raw.plan, ['dailyMinutes', 'dailyNewWords'], numberValue) ||
        !optionalFieldsMatch(raw.plan, ['bookId', 'lessonId', 'jlptTarget', 'updatedAt'], stringValue))
    )
      return false;
    if (
      raw.navigation &&
      (!optionalFieldsMatch(raw.navigation, ['vocab', 'grammar', 'textbook'], isRecord) ||
        !optionalFieldsMatch(raw.navigation, ['version'], function (value) {
          return value === 1;
        }) ||
        !optionalFieldsMatch(raw.navigation, ['lastModule'], stringValue))
    )
      return false;
    return Object.keys(raw.usage).every(function (date) {
      var day = raw.usage[date];
      return (
        isRecord(day) &&
        optionalFieldsMatch(day, ['focusedMs', 'checkins'], numberValue) &&
        optionalFieldsMatch(day, ['checkedIn'], booleanValue) &&
        optionalFieldsMatch(day, ['firstSeenAt', 'lastSeenAt'], stringValue)
      );
    });
  }

  function loadBrowser() {
    try {
      browserBaseline = localStorage.getItem(BROWSER_STORAGE_KEY);
      var body = browserBaseline;
      if (body === null) body = localStorage.getItem(OFFLINE_STORAGE_KEY);
      if (body === null) body = localStorage.getItem(CONFIRMED_STORAGE_KEY);
      if (body === null) return defaultState();
      var raw = JSON.parse(body);
      if (!validBrowserSnapshot(raw)) throw new Error('Invalid browser progress');
      var loaded = normalize(raw);
      delete loaded.pending;
      delete loaded.readFailure;
      return loaded;
    } catch (error) {
      loadFailed = true;
      return defaultState();
    }
  }

  function saveBrowser() {
    if (loadFailed) {
      setSyncText('读取浏览器存档失败，已暂停写入；请勿清除站点数据');
      return;
    }
    try {
      if (conflict || localStorage.getItem(BROWSER_STORAGE_KEY) !== browserBaseline) {
        conflict = true;
        setSyncText('另一页面已更新存档，本页新改动未保存；请保留页面');
        return;
      }
      var snapshot = JSON.parse(captureSnapshot());
      delete snapshot.pending;
      delete snapshot.readFailure;
      var body = JSON.stringify(snapshot);
      localStorage.setItem(BROWSER_STORAGE_KEY, body);
      browserBaseline = body;
      setSyncText(storageLabel());
    } catch (error) {
      setSyncText('浏览器保存失败，空间不足或存储不可用；请勿关闭页面');
    }
  }

  function normalize(raw) {
    var base = defaultState();
    raw = raw || {};
    if (raw.pending === true) base.pending = true;
    if (raw.readFailure === true) base.readFailure = true;
    if (Number.isSafeInteger(raw.revision) && raw.revision >= 0) base.revision = raw.revision;
    if (raw.vocabulary) {
      base.vocabulary.known = asArray(raw.vocabulary.known);
      base.vocabulary.fuzzy = asArray(raw.vocabulary.fuzzy);
      base.vocabulary.unknown = asArray(raw.vocabulary.unknown);
      base.vocabulary.favorite = asArray(raw.vocabulary.favorite);
      base.vocabulary.grammarFavorite = asArray(raw.vocabulary.grammarFavorite);
      base.vocabulary.history = asArray(raw.vocabulary.history);
      base.vocabulary.srsVersion = 1;
      base.vocabulary.srs = asArray(raw.vocabulary.srs);
    }
    if (raw.usage && typeof raw.usage === 'object') base.usage = raw.usage;
    base.navigation = normalizeNavigation(raw.navigation);
    base.plan = normalizePlan(raw.plan);
    if (typeof raw.updatedAt === 'string') base.updatedAt = raw.updatedAt;
    return base;
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function readOfflineSnapshot() {
    try {
      var raw = localStorage.getItem(OFFLINE_STORAGE_KEY);
      if (!raw) return null;
      return normalize(JSON.parse(raw));
    } catch (e) {
      return null;
    }
  }

  function writeOfflineSnapshot(body) {
    if (window.StudyStorage.isWriteBlocked()) return false;
    try {
      localStorage.setItem(OFFLINE_STORAGE_KEY, body);
      return true;
    } catch (e) {
      return false;
    }
  }

  function clearOfflineSnapshot(expectedBody) {
    if (window.StudyStorage.isWriteBlocked()) return;
    try {
      if (expectedBody === undefined || localStorage.getItem(OFFLINE_STORAGE_KEY) === expectedBody) {
        localStorage.removeItem(OFFLINE_STORAGE_KEY);
      }
    } catch (e) {}
  }

  function snapshotTime(snapshot) {
    var value = Date.parse(String(snapshot && snapshot.updatedAt ? snapshot.updatedAt : ''));
    return isFinite(value) ? value : 0;
  }

  function isSnapshotNewer(localSnapshot, remoteSnapshot) {
    var localTime = snapshotTime(localSnapshot);
    var remoteTime = snapshotTime(remoteSnapshot);
    return localTime > 0 && localTime > remoteTime;
  }

  function normalizePlan(value) {
    var raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    var plan = defaultPlan();
    var minutes = Number(raw.dailyMinutes);
    var words = Number(raw.dailyNewWords);
    var books = ['XinBian1', 'XinBian2', 'XinBian3', 'XinBian4', 'KotobaFlow1', 'KotobaFlow2', 'KotobaFlow3', 'KotobaFlow4'];
    var levels = ['N5', 'N4', 'N3', 'N2', 'N1'];
    var bookId = typeof raw.bookId === 'string' ? raw.bookId : '';
    var lessonId = typeof raw.lessonId === 'string' ? raw.lessonId : '';
    var jlptTarget = typeof raw.jlptTarget === 'string' ? raw.jlptTarget.toUpperCase() : '';

    if (isFinite(minutes)) plan.dailyMinutes = Math.max(5, Math.min(120, Math.round(minutes)));
    if (isFinite(words)) plan.dailyNewWords = Math.max(5, Math.min(60, Math.round(words)));
    if (books.indexOf(bookId) !== -1) plan.bookId = bookId;
    if (/^(lesson|review_unit)_\d+$/.test(lessonId)) plan.lessonId = lessonId;
    if (levels.indexOf(jlptTarget) !== -1) plan.jlptTarget = jlptTarget;
    if (typeof raw.updatedAt === 'string') plan.updatedAt = raw.updatedAt;
    return plan;
  }

  function normalizeNavigation(value) {
    var base = defaultState().navigation;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return base;
    if (value.lastModule === 'vocab' || value.lastModule === 'grammar' || value.lastModule === 'lesson') {
      base.lastModule = value.lastModule;
    }
    base.vocab =
      value.vocab && typeof value.vocab === 'object' && !Array.isArray(value.vocab) ? value.vocab : {};
    base.grammar =
      value.grammar && typeof value.grammar === 'object' && !Array.isArray(value.grammar)
        ? value.grammar
        : {};
    base.textbook =
      value.textbook && typeof value.textbook === 'object' && !Array.isArray(value.textbook)
        ? value.textbook
        : {};
    return base;
  }

  function migrateVocabulary() {
    if (!window.StudyStorage || window.StudyStorage.isWriteBlocked()) return;
    var fileVocab = state.vocabulary || {};
    try {
      var localVocab = window.StudyStorage._snapshotForCommit();
      if (vocabIsEmpty(fileVocab) && !vocabIsEmpty(localVocab)) {
        state.vocabulary = localVocab;
        return;
      }
      var result = window.StudyStorage.importSnapshot(fileVocab, {
        referenceNow: state.updatedAt || new Date(),
      });
      if (result.status !== 'saved' && result.status !== 'alreadySaved')
        throw new Error('词汇缓存恢复未确认');
    } catch (error) {
      hydrationFailed = true;
      loadFailed = true;
    }
  }

  function vocabIsEmpty(vocab) {
    return (
      !vocab ||
      (asArray(vocab.known).length === 0 &&
        asArray(vocab.fuzzy).length === 0 &&
        asArray(vocab.unknown).length === 0 &&
        asArray(vocab.favorite).length === 0 &&
        asArray(vocab.grammarFavorite).length === 0 &&
        asArray(vocab.history).length === 0 &&
        asArray(vocab.srs).length === 0)
    );
  }

  function ensureToday() {
    ensureDay(todayKey);
  }

  function ensureDay(key) {
    if (!state.usage) state.usage = {};
    if (!state.usage[key]) {
      var now = new Date().toISOString();
      state.usage[key] = {
        focusedMs: 0,
        checkedIn: false,
        checkins: 0,
        firstSeenAt: now,
        lastSeenAt: now,
      };
    }
    return state.usage[key];
  }

  function cacheEls() {
    els.time = document.getElementById('progressTodayTime');
    els.checkin = document.getElementById('progressCheckinStatus');
    els.streak = document.getElementById('progressStreak');
    els.calendar = document.getElementById('progressCalendar');
    els.calendarToggle = document.getElementById('progressCalendarToggle');
    els.calendarGrid = document.getElementById('progressCalendarGrid');
    els.sync = document.getElementById('progressSyncStatus');
  }

  function bindEvents() {
    window.JPLearn.events.on('storage:failed', function (detail) {
      vocabularyError = detail.message;
      setSyncText(vocabularyError);
    });
    window.JPLearn.events.on('vocabulary:changed', function () {
      queueSave();
    });
    window.addEventListener('focus', onFocusChange);
    window.addEventListener('blur', onFocusChange);
    document.addEventListener('visibilitychange', onFocusChange);
    window.addEventListener('online', function () {
      if (!state) return;
      if (usesApi) setSyncText('正在保存到本机');
      queueSave(0);
    });
    window.addEventListener('beforeunload', function () {
      commitActiveTime();
      save(true);
    });
    if (els.calendarToggle && els.calendar) {
      function setCalendarOpen(open, restoreFocus) {
        if (open && window.JPLearn.topLayer) window.JPLearn.topLayer.requestOpen('progress-calendar');
        els.calendar.classList.toggle('open', open);
        if (open) mountActivityGraph(els.calendarGrid, { id: 'calendar' });
        els.calendarToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        els.calendar.setAttribute('aria-hidden', open ? 'false' : 'true');
        if (!open && window.JPLearn.topLayer) window.JPLearn.topLayer.release('progress-calendar');
        if (!open && restoreFocus) els.calendarToggle.focus();
      }
      els.calendarToggle.setAttribute(
        'aria-expanded',
        els.calendar.classList.contains('open') ? 'true' : 'false',
      );
      els.calendar.setAttribute('aria-hidden', els.calendar.classList.contains('open') ? 'false' : 'true');
      if (window.JPLearn.topLayer) {
        window.JPLearn.topLayer.register('progress-calendar', {
          close: function (restoreFocus) {
            setCalendarOpen(false, restoreFocus);
          },
        });
      }
      els.calendarToggle.addEventListener('click', function () {
        var open = !els.calendar.classList.contains('open');
        setCalendarOpen(open, !open);
      });
      document.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape' || !els.calendar.classList.contains('open')) return;
        event.preventDefault();
        setCalendarOpen(false, true);
      });
    }
  }

  function onFocusChange() {
    if (isActive()) {
      startCountingIfActive();
    } else {
      commitActiveTime();
      activeSince = 0;
      queueSave(0);
    }
    render();
  }

  function isActive() {
    return document.visibilityState === 'visible' && document.hasFocus();
  }

  function startCountingIfActive() {
    if (!isActive() || activeSince) return;
    activeSince = Date.now();
  }

  function commitActiveTime() {
    if (restoring) return;
    if (!activeSince) return;
    var nowMs = Date.now();
    if (nowMs <= activeSince) return;
    var day = ensureDay(todayKey);
    day.focusedMs = Math.max(0, Number(day.focusedMs) || 0) + (nowMs - activeSince);
    day.lastSeenAt = new Date(nowMs).toISOString();
    if (!day.firstSeenAt) day.firstSeenAt = day.lastSeenAt;
    if (day.focusedMs >= CHECKIN_MS) {
      day.checkedIn = true;
      day.checkins = 1;
    }
    activeSince = isActive() ? nowMs : 0;
    generation++;
  }

  // FIX-22: views that show whole minutes (Today's goal) update when what they
  // show changes, not on every one-second tick.
  var announcedMinutes = '';
  function announceMinutes() {
    if (!state || !todayKey) return;
    var day = ensureDay(todayKey);
    var focusedMs = Math.max(0, Number(day.focusedMs) || 0);
    var key = [todayKey, Math.floor(focusedMs / 60000), focusedMs > 0, !!day.checkedIn].join(':');
    if (key === announcedMinutes) return;
    var first = !announcedMinutes;
    announcedMinutes = key;
    if (!first) window.JPLearn.events.emit('usage:minutes', { date: todayKey });
  }

  function rollDateIfNeeded() {
    var key = localDateKey(new Date());
    if (key === todayKey) return;
    commitActiveTime();
    todayKey = key;
    ensureToday();
    activeSince = isActive() ? Date.now() : 0;
    queueSave(0);
  }

  function queueSave(delay) {
    if (hydrationFailed) {
      setSyncText('恢复学习记录失败，已暂停写入；请保留站点数据并重新加载');
      return;
    }
    if (!state || restoring || restorePreviewOpen || window.StudyStorage.isWriteBlocked()) return;
    generation++;
    if (!usesApi) {
      save();
      return;
    }
    writeOfflineSnapshot(captureSnapshot());
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(
      function () {
        saveTimer = 0;
        save();
      },
      typeof delay === 'number' ? delay : 800,
    );
  }

  function captureSnapshot() {
    if (
      window.appConfig &&
      window.appConfig.status === 'ready' &&
      window.ModuleSwitcher &&
      window.ModuleSwitcher.exportNavigation &&
      window.ModuleSwitcher.getCurrentModule() !== 'dashboard'
    ) {
      state.navigation = normalizeNavigation(window.ModuleSwitcher.exportNavigation());
    }
    if (!hydrationFailed && window.StudyStorage) state.vocabulary = window.StudyStorage.exportSnapshot();
    state.updatedAt = new Date().toISOString();
    return JSON.stringify(Object.assign({}, state, { pending: true, readFailure: loadFailed }));
  }

  function save(useBeacon) {
    if (hydrationFailed) {
      setSyncText('恢复学习记录失败，已暂停写入；请保留站点数据并重新加载');
      return Promise.resolve();
    }
    if (!state || restoring || restorePreviewOpen || window.StudyStorage.isWriteBlocked())
      return Promise.resolve();
    commitActiveTime();
    if (!usesApi) {
      saveBrowser();
      return Promise.resolve();
    }
    var body = captureSnapshot();
    var durable = writeOfflineSnapshot(body);
    if (loadFailed) {
      setSyncText(
        durable
          ? '读取存档失败，记录暂存在浏览器；请保留记录，恢复前暂停写入'
          : '读取存档失败且无法暂存；请勿关闭页面',
      );
      return Promise.resolve();
    }
    if (conflict) {
      setSyncText(
        durable
          ? '存档版本冲突，本页记录保留在浏览器；请勿清除站点数据'
          : '保存失败，浏览器空间不足或存储不可用；请勿关闭页面',
      );
      return Promise.resolve();
    }
    if (saving) {
      saveAgain = true;
      return saving;
    }
    var submittedGeneration = generation;
    var controller = new AbortController();
    var timeout = setTimeout(function () {
      controller.abort();
    }, 12000);
    saveAgain = false;
    saving = (async function () {
      await Promise.resolve();
      try {
        var res = await fetch('/api/progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'If-Match': String(state.revision) },
          body: body,
          signal: controller.signal,
          keepalive: !!useBeacon,
        });
        if (res.status === 409 || res.status === 428) {
          conflict = true;
          throw new Error('Progress revision conflict');
        }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var raw = await res.json();
        if (!raw || raw.version !== 2 || !raw.vocabulary || !raw.usage)
          throw new Error('Invalid progress response');
        var confirmed = normalize(raw);
        if (confirmed.revision < state.revision) throw new Error('Stale progress confirmation');
        // The response confirms the submitted snapshot, never current UI state.
        state.revision = confirmed.revision;
        try {
          localStorage.setItem(CONFIRMED_STORAGE_KEY, JSON.stringify(confirmed));
        } catch (e) {}
        if (generation === submittedGeneration && !saveAgain) {
          clearOfflineSnapshot(body);
          setSyncText('已保存');
        } else {
          writeOfflineSnapshot(captureSnapshot());
          saveAgain = true;
        }
      } catch (e) {
        console.warn('[ProgressStore] 保存失败:', e);
        durable = writeOfflineSnapshot(captureSnapshot());
        setSyncText(
          !durable
            ? '保存失败，浏览器空间不足或存储不可用；请勿关闭页面'
            : conflict
              ? '存档版本冲突，本页记录保留在浏览器；请勿清除站点数据'
              : navigator.onLine === false
                ? '离线，待联网同步'
                : '暂存本地，待重试',
        );
        // Periodic/online saves retry without an unbounded failure loop.
        saveAgain = false;
      } finally {
        clearTimeout(timeout);
        saving = null;
      }
      if (saveAgain && !useBeacon) return save();
    })();
    return saving;
  }

  function render() {
    if (!state || !todayKey) return;
    var day = ensureDay(todayKey);
    var focusedMs = Math.max(0, Number(day.focusedMs) || 0);
    var pct = Math.min(100, Math.floor((focusedMs / CHECKIN_MS) * 100));
    if (els.time) els.time.textContent = formatDuration(focusedMs);
    if (els.checkin) {
      els.checkin.textContent = day.checkedIn ? '已打卡' : pct + '%';
      els.checkin.classList.toggle('checked', !!day.checkedIn);
    }
    if (els.streak) els.streak.textContent = String(getStreak());
    renderCalendar();
  }

  // EXP-LEARN-04: GitHub-style activity graph. Columns are Sunday-first weeks,
  // rows are weekdays; colour comes only from the existing foreground focus
  // timer (usage[YYYY-MM-DD].focusedMs) and checkedIn keeps its 60-minute rule.
  // Dates step with local calendar arithmetic, so DST and leap days need no
  // fixed 24-hour maths. Viewing the graph never writes usage.
  var DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
  var WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
  var GRAPH_LEVEL_MINUTES = [10, 30];

  function parseDateKey(key) {
    var match = DATE_KEY.exec(key || '');
    if (!match) return null;
    var date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return localDateKey(date) === key ? date : null;
  }

  function activityLevel(day) {
    var ms = Math.max(0, Number(day && day.focusedMs) || 0);
    if (day && day.checkedIn) return 4;
    if (!ms) return 0;
    var minutes = ms / 60000;
    if (minutes < GRAPH_LEVEL_MINUTES[0]) return 1;
    if (minutes < GRAPH_LEVEL_MINUTES[1]) return 2;
    return ms >= CHECKIN_MS ? 4 : 3;
  }

  function activityYears(usage, today) {
    var years = {};
    years[today.getFullYear()] = true;
    Object.keys(usage || {}).forEach(function (key) {
      var date = parseDateKey(key);
      if (date && date <= today && (Number(usage[key].focusedMs) > 0 || usage[key].checkedIn)) {
        years[date.getFullYear()] = true;
      }
    });
    return Object.keys(years)
      .map(Number)
      .sort(function (a, b) {
        return b - a;
      });
  }

  // range: 'recent' (the last 365 days), a four-digit year, or 'YYYY-Qn'
  // (the quarter view used where a whole year cannot fit).
  function getActivityGraph(range, now, usageOverride) {
    var usage = usageOverride || (state && state.usage) || {};
    var today = startOfLocalDay(now || new Date());
    var quarter = /^(\d{4})-Q([1-4])$/.exec(String(range));
    var year = quarter ? Number(quarter[1]) : /^\d{4}$/.test(String(range)) ? Number(range) : 0;
    var first = quarter
      ? new Date(year, (quarter[2] - 1) * 3, 1)
      : year
        ? new Date(year, 0, 1)
        : addDays(today, -364);
    var last = quarter ? new Date(year, quarter[2] * 3, 0) : year ? new Date(year, 11, 31) : today;
    var gridStart = addDays(first, -first.getDay());
    var weeks = [];
    var months = [];
    var totals = { days: 0, focusedMs: 0, checked: 0 };
    var byMonth = {};
    for (var week = 0, cursor = gridStart; cursor <= last; week++) {
      var column = [];
      for (var weekday = 0; weekday < 7; weekday++, cursor = addDays(cursor, 1)) {
        if (cursor < first || cursor > last) {
          column.push(null);
          continue;
        }
        var key = localDateKey(cursor);
        var day = usage[key] || null;
        var future = cursor > today;
        var focusedMs = future ? 0 : Math.max(0, Number(day && day.focusedMs) || 0);
        var cell = {
          key: key,
          weekday: weekday,
          focusedMs: focusedMs,
          checkedIn: !future && !!(day && day.checkedIn),
          level: future ? -1 : activityLevel(day),
          today: cursor.getTime() === today.getTime(),
          future: future,
        };
        if (cursor.getDate() === 1 || (week === 0 && weekday === first.getDay())) {
          months.push({ week: week, label: cursor.getMonth() + 1 + '月' });
        }
        if (!future) {
          var monthKey = key.slice(0, 7);
          var month = byMonth[monthKey] || (byMonth[monthKey] = { month: monthKey, days: 0, focusedMs: 0, checked: 0 });
          if (cell.level > 0) {
            totals.days++;
            month.days++;
          }
          if (cell.checkedIn) {
            totals.checked++;
            month.checked++;
          }
          totals.focusedMs += focusedMs;
          month.focusedMs += focusedMs;
        }
        column.push(cell);
      }
      weeks.push(column);
    }
    // A month label spans three week columns; drop one crowding the next, which
    // would otherwise wrap onto a second label row hidden under the days.
    months = months.filter(function (item, index) {
      var next = months[index + 1];
      return !next || next.week - item.week >= 3;
    });
    return {
      range: quarter ? quarter[0] : year ? String(year) : 'recent',
      title: quarter
        ? year + ' 年 ' + (first.getMonth() + 1) + '–' + (last.getMonth() + 1) + ' 月'
        : year
          ? year + ' 年'
          : '过去一年',
      first: localDateKey(first),
      last: localDateKey(last),
      today: localDateKey(today),
      weeks: weeks,
      months: months,
      totals: totals,
      byMonth: Object.keys(byMonth)
        .sort()
        .map(function (key) {
          return byMonth[key];
        }),
      years: activityYears(usage, today),
    };
  }

  function formatMinutes(ms) {
    var minutes = Math.round(ms / 60000);
    if (minutes < 60) return minutes + ' 分钟';
    var hours = Math.floor(minutes / 60);
    return hours + ' 小时' + (minutes % 60 ? ' ' + (minutes % 60) + ' 分钟' : '');
  }

  function describeDay(cell) {
    var date = parseDateKey(cell.key);
    var label = date.getFullYear() + '年' + (date.getMonth() + 1) + '月' + date.getDate() + '日 周' + WEEKDAYS[cell.weekday];
    if (cell.future) return label + '，尚未到来';
    if (!cell.focusedMs && !cell.checkedIn) return label + '，无学习记录';
    return label + '，专注 ' + formatMinutes(cell.focusedMs) + '，' + (cell.checkedIn ? '已打卡' : '未打卡');
  }

  // Each mounted graph (the check-in popover, Today's section) keeps its own
  // view state by id, so a re-rendered host gets back its range and day.
  var graphViews = {};
  var NARROW_GRAPH_PX = 600;

  function currentQuarter(date) {
    return date.getFullYear() + '-Q' + (Math.floor(date.getMonth() / 3) + 1);
  }

  function shiftQuarter(range, step) {
    var match = /^(\d{4})-Q([1-4])$/.exec(range);
    var index = Number(match[1]) * 4 + Number(match[2]) - 1 + step;
    return Math.floor(index / 4) + '-Q' + ((index % 4) + 1);
  }

  function mountActivityGraph(root, options) {
    if (!root) return null;
    options = options || {};
    var id = options.id || 'graph';
    var view = graphViews[id] || (graphViews[id] = { id: id, range: 'recent', quarter: '', focusKey: '' });
    var wasFocused = view.root && view.root.contains(document.activeElement);
    view.root = root;
    view.signature = '';
    view.autoScroll = true;
    root.classList.add('contribution-graph');
    if (!root.hasAttribute('data-graph-bound')) {
      root.setAttribute('data-graph-bound', '');
      bindGraphEvents(view);
      if (window.ResizeObserver) {
        new ResizeObserver(function () {
          if (view.root === root && isNarrowGraph(view) !== view.narrow) renderGraph(view, true);
        }).observe(root);
      }
    }
    renderGraph(view, true);
    if (wasFocused || options.restoreFocus) {
      var cell = root.querySelector('.cg-cell[tabindex="0"]');
      if (cell) cell.focus();
    }
    return view;
  }

  function isNarrowGraph(view) {
    var width = view.root.clientWidth;
    return width > 0 && width < NARROW_GRAPH_PX;
  }

  function calendarOpen() {
    return !!(els.calendar && els.calendar.classList.contains('open'));
  }

  function renderCalendar(force) {
    Object.keys(graphViews).forEach(function (id) {
      var view = graphViews[id];
      if (!view.root || !view.root.isConnected) return;
      if (id === 'calendar' && !force && !calendarOpen()) return;
      renderGraph(view, force);
    });
  }

  function renderGraph(view, force) {
    if (!view.root || !state) return;
    var today = state.usage[todayKey] || {};
    var narrow = isNarrowGraph(view);
    var signature = [
      view.range, view.quarter, narrow, todayKey, activityLevel(today),
      // Text shows rounded minutes even while the cell stays in one colour band.
      Math.round((Number(today.focusedMs) || 0) / 60000), Object.keys(state.usage).length,
    ].join('|');
    if (!force && signature === view.signature) return;
    view.signature = signature;
    view.narrow = narrow;
    var now = new Date();
    var range = view.range;
    if (narrow) {
      // A whole year shrinks to unusable dots on a phone: step through quarters.
      if (!view.quarter) {
        view.quarter = view.range === 'recent' || Number(view.range) === now.getFullYear() ? currentQuarter(now) : view.range + '-Q4';
      }
      range = view.quarter;
    }
    var model = getActivityGraph(range);
    if (!narrow && view.range !== 'recent' && model.years.indexOf(Number(view.range)) === -1) {
      view.range = 'recent';
      model = getActivityGraph('recent');
    }
    var esc = window.JPLearn.html.escape;
    var focusKey =
      view.focusKey >= model.first && view.focusKey <= model.last && view.focusKey <= model.today ? view.focusKey : '';
    if (!focusKey) focusKey = model.last < model.today ? model.last : model.today;
    if (focusKey < model.first) focusKey = model.first;
    var html = '<div class="cg-head"><div class="cg-summary-line"><strong>' + esc(model.title) + '学习 ' + model.totals.days + ' 天</strong>';
    html += '<span>专注 ' + formatMinutes(model.totals.focusedMs) + ' · 打卡 ' + model.totals.checked + ' 天 · 当前连续 ' + getStreak() + ' 天</span></div>';
    if (narrow) {
      var earliest = model.years[model.years.length - 1] + '-Q1';
      var latest = currentQuarter(now);
      html += '<div class="cg-quarters" role="group" aria-label="切换季度">';
      html += '<button type="button" class="cg-year" data-graph-step="-1" aria-label="上一季度"' + (range <= earliest ? ' disabled' : '') + '>‹</button>';
      html += '<span class="cg-quarter-label" aria-live="polite">' + esc(model.title) + '</span>';
      html += '<button type="button" class="cg-year" data-graph-step="1" aria-label="下一季度"' + (range >= latest ? ' disabled' : '') + '>›</button>';
      html += '</div>';
    } else {
      html += '<div class="cg-years" role="group" aria-label="选择查看范围">';
      ['recent'].concat(model.years.map(String)).forEach(function (value) {
        html +=
          '<button type="button" class="cg-year" data-graph-range="' + value + '" aria-pressed="' + (value === model.range) + '">' +
          (value === 'recent' ? '近一年' : value) +
          '</button>';
      });
      html += '</div>';
    }
    html += '</div>';
    html += '<div class="cg-scroll"><div class="cg-body" style="--cg-weeks:' + model.weeks.length + '">';
    html += '<div class="cg-months" aria-hidden="true">';
    model.months.forEach(function (item) {
      html += '<span style="grid-column:' + (item.week + 1) + ' / span 3">' + item.label + '</span>';
    });
    html += '</div><div class="cg-weekdays" aria-hidden="true">';
    for (var w = 0; w < 7; w++) html += '<span>' + (w % 2 ? WEEKDAYS[w] : '') + '</span>';
    html += '</div>';
    html += '<div class="cg-grid" role="grid" aria-readonly="true" aria-label="' + esc(model.title) + '每日学习记录，方向键切换日期">';
    for (var row = 0; row < 7; row++) {
      html += '<div class="cg-row" role="row">';
      for (var col = 0; col < model.weeks.length; col++) {
        var cell = model.weeks[col][row];
        if (!cell) {
          html += '<span class="cg-cell cg-pad" role="presentation"></span>';
          continue;
        }
        html +=
          '<span class="cg-cell' + (cell.today ? ' is-today' : '') + (cell.future ? ' is-future' : '') +
          '" role="gridcell" data-date="' + cell.key + '" data-level="' + cell.level +
          '" aria-label="' + esc(describeDay(cell)) + '"' +
          (cell.future ? ' aria-disabled="true"' : ' tabindex="' + (cell.key === focusKey ? '0' : '-1') + '"') +
          '></span>';
      }
      html += '</div>';
    }
    html += '</div></div></div>';
    html += '<div class="cg-foot"><p class="cg-detail" aria-live="polite">' + esc(describeDay(findCell(model, focusKey))) + '</p>';
    html += '<div class="cg-legend" aria-hidden="true"><span>少</span>';
    for (var level = 0; level <= 4; level++) html += '<i class="cg-cell" data-level="' + level + '"></i>';
    html += '<span>多</span></div></div>';
    html += '<p class="cg-note">颜色为前台专注时长：不足 10 分钟、10–29、30–59 分钟，满 60 分钟即打卡。</p>';
    html += '<details class="cg-months-table"><summary>按月查看</summary><table><thead><tr><th scope="col">月份</th><th scope="col">学习天数</th><th scope="col">专注</th><th scope="col">打卡</th></tr></thead><tbody>';
    model.byMonth
      .filter(function (month) {
        return month.days || month.checked;
      })
      .reverse()
      .forEach(function (month) {
        html += '<tr><th scope="row">' + month.month.replace('-', ' 年 ') + ' 月</th><td>' + month.days + ' 天</td><td>' + formatMinutes(month.focusedMs) + '</td><td>' + month.checked + ' 天</td></tr>';
      });
    html += '</tbody></table><p class="cg-empty">没有记录的月份不列出。</p></details>';
    var root = view.root;
    var active = root.contains(document.activeElement) ? document.activeElement : null;
    var focusedControl = active && (active.getAttribute('data-graph-range') || active.getAttribute('data-graph-step'));
    var tableOpen = !!root.querySelector('.cg-months-table[open]');
    var oldScroll = root.querySelector('.cg-scroll');
    var scrollLeft = oldScroll ? oldScroll.scrollLeft : 0;
    root.classList.toggle('is-quarter', narrow);
    root.innerHTML = html;
    if (tableOpen) root.querySelector('.cg-months-table').open = true;
    var scroll = root.querySelector('.cg-scroll');
    // Recent days sit at the right edge, as on GitHub; later updates keep the reader's place.
    if (scroll) scroll.scrollLeft = view.autoScroll ? (model.range === 'recent' ? scroll.scrollWidth : 0) : scrollLeft;
    view.autoScroll = false;
    if (active) {
      var restore = focusedControl
        ? root.querySelector('[data-graph-range="' + focusedControl + '"], [data-graph-step="' + focusedControl + '"]')
        : root.querySelector('.cg-cell[tabindex="0"]');
      if (restore && !restore.disabled) restore.focus();
      else {
        var fallback = root.querySelector('.cg-cell[tabindex="0"]');
        if (fallback) fallback.focus();
      }
    }
  }

  function findCell(model, key) {
    for (var c = 0; c < model.weeks.length; c++) {
      for (var r = 0; r < 7; r++) if (model.weeks[c][r] && model.weeks[c][r].key === key) return model.weeks[c][r];
    }
    return model.weeks[0].filter(Boolean)[0];
  }

  function showGraphDay(view, cell) {
    var detail = view.root.querySelector('.cg-detail');
    if (detail && cell) detail.textContent = cell.getAttribute('aria-label');
  }

  function moveGraphFocus(view, from, days) {
    var date = parseDateKey(from.getAttribute('data-date'));
    if (!date) return;
    var key = localDateKey(addDays(date, days));
    var target = view.root.querySelector('.cg-cell[data-date="' + key + '"]:not(.is-future)');
    if (!target && view.narrow && key <= todayKey) {
      // Quarter view: arrows continue into the neighbouring quarter.
      var next = parseDateKey(key);
      var quarter = next.getFullYear() + '-Q' + (Math.floor(next.getMonth() / 3) + 1);
      if (getActivityGraph(quarter).years.indexOf(next.getFullYear()) === -1) return;
      view.quarter = quarter;
      view.focusKey = key;
      renderGraph(view, true);
      target = view.root.querySelector('.cg-cell[data-date="' + key + '"]');
      if (target) {
        target.focus();
        showGraphDay(view, target);
      }
      return;
    }
    if (!target) return;
    from.setAttribute('tabindex', '-1');
    target.setAttribute('tabindex', '0');
    view.focusKey = target.getAttribute('data-date');
    target.focus();
    showGraphDay(view, target);
  }

  function bindGraphEvents(view) {
    var root = view.root;
    root.addEventListener('click', function (event) {
      var range = event.target.closest('[data-graph-range]');
      var step = event.target.closest('[data-graph-step]');
      if (range || step) {
        if (range) {
          view.range = range.getAttribute('data-graph-range');
          view.quarter = '';
        } else {
          view.quarter = shiftQuarter(view.quarter, Number(step.getAttribute('data-graph-step')));
        }
        view.focusKey = '';
        view.autoScroll = true;
        renderGraph(view, true);
        return;
      }
      var cell = event.target.closest('.cg-cell[data-date]:not(.is-future)');
      if (cell) {
        view.focusKey = cell.getAttribute('data-date');
        showGraphDay(view, cell);
      }
    });
    root.addEventListener('mouseover', function (event) {
      var cell = event.target.closest('.cg-cell[data-date]');
      if (cell) showGraphDay(view, cell);
    });
    root.addEventListener('focusin', function (event) {
      var cell = event.target.closest('.cg-cell[data-date]');
      if (cell) showGraphDay(view, cell);
    });
    root.addEventListener('keydown', function (event) {
      var cell = event.target.closest('.cg-cell[data-date]');
      if (!cell) return;
      var steps = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 };
      if (steps[event.key] !== undefined) moveGraphFocus(view, cell, steps[event.key]);
      else if (event.key === 'Home' || event.key === 'End') {
        // The DOM is grouped by weekday rows, not chronological date order.
        var cells = Array.prototype.slice.call(root.querySelectorAll('.cg-cell[data-date]:not(.is-future)'));
        cells.sort(function (a, b) {
          return a.getAttribute('data-date').localeCompare(b.getAttribute('data-date'));
        });
        var target = cells[event.key === 'Home' ? 0 : cells.length - 1];
        var date = parseDateKey(cell.getAttribute('data-date'));
        var targetDate = parseDateKey(target.getAttribute('data-date'));
        moveGraphFocus(view, cell, Math.round((targetDate - date) / 86400000));
      } else return;
      event.preventDefault();
      event.stopPropagation();
    });
  }

  function getStreak() {
    var cursor = startOfLocalDay(new Date());
    if (!isChecked(localDateKey(cursor))) {
      cursor = addDays(cursor, -1);
    }
    var streak = 0;
    while (isChecked(localDateKey(cursor))) {
      streak++;
      cursor = addDays(cursor, -1);
    }
    return streak;
  }

  function isChecked(key) {
    return !!(state.usage && state.usage[key] && state.usage[key].checkedIn);
  }

  function setSyncText(text) {
    if (!els.sync) return;
    if (vocabularyError && (text === '已保存' || text === storageLabel())) text = vocabularyError;
    els.sync.textContent = text;
    if (text === '已保存') {
      setTimeout(function () {
        if (els.sync && els.sync.textContent === '已保存') els.sync.textContent = storageLabel();
      }, 1500);
    }
  }

  function getNavigation() {
    return normalizeNavigation(state && state.navigation);
  }

  function exportProgress() {
    if (!state) throw new Error('学习记录尚未加载完成');
    if (restoring) return JSON.parse(JSON.stringify(state));
    commitActiveTime();
    var snapshot = JSON.parse(captureSnapshot());
    delete snapshot.pending;
    delete snapshot.readFailure;
    return snapshot;
  }

  // Prepare the durable progress/checkpoint bytes without advancing the live UI.
  // StudyStorage journals this entry with the vocabulary keys before writing any of them.
  function prepareVocabularyCommit(vocabulary, checkpoint) {
    if (!state || restoring || restorePreviewOpen || loadFailed)
      throw new Error('存档尚未就绪，请先恢复后重试');
    var key = usesApi ? OFFLINE_STORAGE_KEY : BROWSER_STORAGE_KEY;
    var before = localStorage.getItem(key);
    if (!usesApi && (conflict || before !== browserBaseline)) {
      conflict = true;
      throw new Error('另一页面已更新存档，请重新加载后重试');
    }
    var next = JSON.parse(JSON.stringify(state));
    if (
      window.appConfig &&
      window.appConfig.status === 'ready' &&
      window.ModuleSwitcher &&
      window.ModuleSwitcher.getCurrentModule() !== 'dashboard'
    )
      next.navigation = normalizeNavigation(window.ModuleSwitcher.exportNavigation());
    next.vocabulary = vocabulary;
    if (typeof checkpoint !== 'undefined') next.navigation.vocab.studySession = checkpoint;
    next.updatedAt = new Date().toISOString();
    if (usesApi) {
      next.pending = true;
      next.readFailure = false;
    } else {
      delete next.pending;
      delete next.readFailure;
    }
    return { key: key, before: before, after: JSON.stringify(next) };
  }

  function acceptVocabularyCommit(record) {
    var key = usesApi ? OFFLINE_STORAGE_KEY : BROWSER_STORAGE_KEY;
    var entry = record.entries.find(function (item) {
      return item.key === key;
    });
    if (!entry) return;
    vocabularyError = '';
    var raw = record.committed ? entry.after : entry.before;
    if (raw) state = normalize(JSON.parse(raw));
    if (!usesApi) browserBaseline = raw;
    generation++;
  }

  function restoreFingerprint() {
    return JSON.stringify({
      vocabulary: window.StudyStorage.exportSnapshot(),
      plan: state.plan,
      navigation: state.navigation,
    });
  }

  function checkRestoreCommit() {
    // Only startup/answer retry may reconcile a commit with the live study view.
    // Importing here would leave an old journal able to overwrite the new archive.
    if (window.StudyStorage.hasPendingCommit())
      throw new Error('学习保存尚未恢复，请保留站点数据并重新加载后再导入');
  }

  async function prepareRestore() {
    if (restoring) throw new Error('正在恢复，请稍候');
    if (saving) await saving;
    checkRestoreCommit();
    restorePreviewOpen = true;
    if (saveTimer) clearTimeout(saveTimer);
    var snapshot = exportProgress();
    var remote = null;
    if (usesApi) {
      var response = await fetch('/api/progress', { cache: 'no-store' });
      if (!response.ok) throw new Error('无法读取本机存档，请先恢复服务后重试');
      remote = await response.json();
      if (!remote || remote.version !== 2 || !Number.isSafeInteger(remote.revision))
        throw new Error('本机存档版本不可恢复');
    }
    return {
      snapshot: snapshot,
      fingerprint: restoreFingerprint(),
      browserRaw: usesApi ? null : localStorage.getItem(BROWSER_STORAGE_KEY),
      remote: remote,
    };
  }

  async function restoreProgress(snapshot, preview) {
    if (restoring) throw new Error('正在恢复，请稍候');
    if (saving) await saving;
    checkRestoreCommit();
    if (restoreFingerprint() !== preview.fingerprint) throw new Error('预览后学习记录已改变，请重新预览');
    if (!usesApi && localStorage.getItem(BROWSER_STORAGE_KEY) !== preview.browserRaw)
      throw new Error('另一页面已更新存档，请重新预览');
    var next = normalize(snapshot);
    next.revision = usesApi ? preview.remote.revision : 0;
    delete next.pending;
    delete next.readFailure;
    next.updatedAt = new Date().toISOString();
    // One durable recovery record retains both the page and API copies.
    localStorage.setItem(
      RESTORE_BACKUP_KEY,
      JSON.stringify({
        version: 1,
        page: exportProgress(),
        remote: preview.remote,
        browserRaw: preview.browserRaw,
      }),
    );
    restoring = true;
    if (saveTimer) clearTimeout(saveTimer);
    var rollback = null;
    var apiConfirmed = false;
    try {
      rollback = window.StudyStorage.replaceSnapshotStrict(next.vocabulary);
      if (usesApi) {
        var response = await fetch('/api/progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'If-Match': String(next.revision) },
          body: JSON.stringify(next),
          signal: AbortSignal.timeout(12000),
        });
        if (!response.ok)
          throw new Error(
            response.status === 409 ? '本机存档已改变，请重新预览' : '本机保存失败，原记录备份已保留',
          );
        var confirmed = await response.json();
        if (!confirmed || confirmed.version !== 2 || confirmed.revision !== next.revision + 1)
          throw new Error('保存结果未确认，原记录备份已保留；请重新加载核对');
        next = normalize(confirmed);
        apiConfirmed = true;
      } else {
        var body = JSON.stringify(next);
        localStorage.setItem(BROWSER_STORAGE_KEY, body);
        browserBaseline = body;
      }
      state = next;
      conflict = false;
      loadFailed = false;
      hydrationFailed = false;
      generation++;
      // Old pending data must not override this explicit restoration on reload.
      if (usesApi) {
        try {
          localStorage.removeItem(OFFLINE_STORAGE_KEY);
          localStorage.setItem(CONFIRMED_STORAGE_KEY, JSON.stringify(next));
        } catch (error) {
          throw new Error('本机恢复已确认，但浏览器缓存更新失败；请保留页面和原记录备份', { cause: error });
        }
      }
      window.JPLearn.events.emit('progress:restored');
      setSyncText('恢复完成，请重新加载应用');
      // Keep automatic saves paused until reloading the restored navigation.
      return true;
    } catch (error) {
      if (rollback && !apiConfirmed) {
        try {
          rollback();
        } catch (rollbackError) {
          setSyncText('恢复未完成；请保留页面和原记录备份');
          throw rollbackError;
        }
      }
      // An interrupted request can have reached the server. Never auto-overwrite it.
      if (usesApi) conflict = true;
      restoring = apiConfirmed;
      error.restoreCommitted = apiConfirmed;
      setSyncText('恢复未完成，原记录备份已保留；请重新预览或导出');
      throw error;
    }
  }

  function updateNavigation(navigation) {
    if (!state || restoring) return;
    state.navigation = normalizeNavigation(navigation);
    window.JPLearn.events.emit('navigation:changed', getNavigation());
    queueSave();
  }

  function getPlan() {
    return normalizePlan(state && state.plan);
  }

  function updatePlan(plan) {
    if (!state || restoring) return getPlan();
    state.plan = normalizePlan(plan);
    state.plan.updatedAt = new Date().toISOString();
    window.JPLearn.events.emit('plan:changed', getPlan());
    queueSave(0);
    render();
    return getPlan();
  }

  function localDateKey(date) {
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, '0');
    var d = String(date.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  function startOfLocalDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function addDays(date, days) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  }

  function formatDuration(ms) {
    var totalSeconds = Math.floor(ms / 1000);
    var hours = Math.floor(totalSeconds / 3600);
    var minutes = Math.floor((totalSeconds % 3600) / 60);
    var seconds = totalSeconds % 60;
    if (hours > 0) return hours + '小时' + String(minutes).padStart(2, '0') + '分';
    return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
  }

  return {
    init: init,
    exportProgress: exportProgress,
    prepareRestore: prepareRestore,
    restoreProgress: restoreProgress,
    cancelRestorePreview: function () {
      restorePreviewOpen = false;
      if (!restoring) queueSave();
    },
    getRestoreBackup: function (source) {
      var raw = localStorage.getItem(RESTORE_BACKUP_KEY);
      return raw ? JSON.parse(raw)[source === 'remote' ? 'remote' : 'page'] : null;
    },
    getStorageMode: function () {
      return storageMode;
    },
    queueSave: queueSave,
    prepareVocabularyCommit: prepareVocabularyCommit,
    acceptVocabularyCommit: acceptVocabularyCommit,
    save: save,
    getState: function () {
      return state;
    },
    getStreak: getStreak,
    getActivityGraph: getActivityGraph,
    mountActivityGraph: mountActivityGraph,
    getNavigation: getNavigation,
    updateNavigation: updateNavigation,
    getPlan: getPlan,
    updatePlan: updatePlan,
  };
})();

window.ProgressStore = ProgressStore;
