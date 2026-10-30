(function () {
  'use strict';
  var identity;
  var limit = 8 * 1024 * 1024;
  // Verified against the 2026-09 source catalog: the old 10,116 entries keep
  // their IDs, order and written forms. Only 32 readings changed. The 10,108
  // entry fingerprint came from the interim deduplication of eight saved IDs.
  // Recheck both migrations whenever the current catalog fingerprint changes.
  var reviewedCatalogVersion = 'vocab-id-v1:002f53870ed92d642c8202cdd8678f915e5614ecfa35716479e32b94855aeb05';
  var compatibleArchiveVersions = new Set([
    'vocab-id-v1:d38811c9b176f119f7428af1b096262ce75f9b85ba2992d09debe559008d6372',
    'vocab-id-v1:0f628962ec6447de8cc3e80be975c392a2ef627bba7ac234c8ebeb2aa7e6ca31',
  ]);
  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }
  function object(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
  }
  function assert(ok, message) {
    if (!ok) throw new Error(message);
  }
  function words() {
    var values = window.appConfig && window.appConfig.taxonomyManager;
    values = values || window.taxonomyManager;
    var list = values && values.allWords;
    assert(Array.isArray(list) && list.length, '请等待词库加载完成');
    return list;
  }
  async function contentVersion() {
    if (!identity) {
      var body = JSON.stringify(
        words().map(function (word) {
          return [word.index, word.word, word.reading_hiragana || ''];
        }),
      );
      identity = crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)).then(function (hash) {
        return (
          'vocab-id-v1:' +
          Array.from(new Uint8Array(hash))
            .map(function (byte) {
              return byte.toString(16).padStart(2, '0');
            })
            .join('')
        );
      });
    }
    return identity;
  }
  function clean(value) {
    return JSON.parse(JSON.stringify(value), function (key, item) {
      if (
        /^(?:__proto__|prototype|constructor|token|accessToken|refreshToken|password|cookie|authorization|privateKey)$/i.test(
          key,
        )
      )
        return undefined;
      return item;
    });
  }
  function progressOnly(snapshot) {
    return clean({
      version: snapshot.version,
      vocabulary: snapshot.vocabulary,
      usage: snapshot.usage,
      plan: snapshot.plan,
      navigation: snapshot.navigation,
      updatedAt: snapshot.updatedAt,
    });
  }
  async function exportArchive(snapshot) {
    return {
      format: 'kotobaflow-progress',
      archiveVersion: 1,
      contentVersion: await contentVersion(),
      exportedAt: new Date().toISOString(),
      progress: progressOnly(snapshot),
    };
  }
  async function validate(text) {
    assert(typeof text === 'string' && new Blob([text]).size <= limit, '存档超过 8 MB 限制');
    var archive;
    try {
      archive = JSON.parse(text);
    } catch (error) {
      throw new Error('不是有效的 JSON 存档', { cause: error });
    }
    assert(object(archive) && archive.format === 'kotobaflow-progress', '不是词基流动完整备份文件');
    assert(archive.archiveVersion === 1, '备份版本不兼容，请使用对应版本的应用');
    var currentVersion = await contentVersion();
    assert(
      archive.contentVersion === currentVersion ||
        (currentVersion === reviewedCatalogVersion && compatibleArchiveVersions.has(archive.contentVersion)),
      '词库 ID 版本不匹配，不能安全恢复此存档',
    );
    var s = archive.progress;
    assert(
      object(s) &&
        s.version === 2 &&
        object(s.vocabulary) &&
        object(s.usage) &&
        object(s.plan) &&
        object(s.navigation),
      '存档结构或进度版本不兼容',
    );
    var ids = new Set(
      words().map(function (word) {
        return word.index;
      }),
    );
    var v = s.vocabulary;
    var states = new Set();
    ['known', 'fuzzy', 'unknown', 'favorite'].forEach(function (key) {
      assert(Array.isArray(v[key]), '缺少词汇集合：' + key);
      var seen = new Set();
      v[key].forEach(function (id) {
        assert(Number.isInteger(id) && ids.has(id) && !seen.has(id), '存档包含不存在或重复的词汇 ID');
        seen.add(id);
        if (key !== 'favorite') {
          assert(!states.has(id), '词汇状态互相冲突');
          states.add(id);
        }
      });
    });
    assert(v.srsVersion === 1 && Array.isArray(v.srs), 'SRS 版本不兼容');
    assert(window.JPLearn.srs.normalizeRecords(v.srs).length === v.srs.length, 'SRS 记录损坏');
    var srsIds = new Set();
    v.srs.forEach(function (record) {
      assert(object(record) && ids.has(record.index) && !srsIds.has(record.index), 'SRS 词汇 ID 无效');
      assert(
        Number.isInteger(record.intervalDays) &&
          record.intervalDays >= 0 &&
          record.intervalDays <= 365 &&
          Number.isFinite(record.ease) &&
          record.ease >= 1.3 &&
          record.ease <= 3 &&
          Number.isInteger(record.lapses) &&
          record.lapses >= 0 &&
          Number.isInteger(record.reviewCount) &&
          record.reviewCount >= 1,
        'SRS 数值损坏',
      );
      srsIds.add(record.index);
    });
    assert(
      Array.isArray(v.history) && v.history.length <= 10000 && Array.isArray(v.grammarFavorite),
      '历史或收藏结构损坏',
    );
    function scan(value, path) {
      var depth = path.length;
      assert(depth < 30, '存档嵌套过深');
      if (!value || typeof value !== 'object') {
        assert(typeof value !== 'number' || Number.isFinite(value), '数值无效');
        return;
      }
      Object.keys(value).forEach(function (key) {
        assert(!['__proto__', 'prototype', 'constructor'].includes(key), '存档含不安全字段');
        // This one index is a reading-unit ordinal, normalized by textbook/book-view.js.
        // Match path segments exactly so similarly named history/session fields keep
        // their vocabulary-ID checks, including keys that contain dots.
        var readingUnitIndex =
          key === 'index' &&
          path.length === 4 &&
          path[0] === 'navigation' &&
          path[1] === 'textbook' &&
          path[2] === 'bookAnchor' &&
          path[3] === 'target';
        if (readingUnitIndex) {
          assert(
            Number.isInteger(value[key]) && value[key] >= 0 && value[key] <= 10000,
            '课文书签阅读位置无效',
          );
        } else if (key === 'index' || key === 'wordIndex')
          assert(ids.has(value[key]), '会话或历史中存在旧词汇 ID');
        if (key === 'queueIndices') {
          assert(
            Array.isArray(value[key]) && value[key].length <= window.JPLearn.practice.MAX_SESSION_WORDS,
            '会话队列无效',
          );
          value[key].forEach(function (id) {
            assert(ids.has(id), '会话包含旧词汇 ID');
          });
        }
        scan(value[key], path.concat(key));
      });
    }
    scan(s, []);
    v.history.forEach(function (entry) {
      assert(object(entry) && Number.isFinite(entry.total) && entry.total >= 0, '学习历史损坏');
    });
    Object.keys(s.usage).forEach(function (date) {
      var day = s.usage[date];
      assert(
        /^\d{4}-\d{2}-\d{2}$/.test(date) &&
          object(day) &&
          Number.isFinite(day.focusedMs) &&
          day.focusedMs >= 0,
        '学习时长记录损坏',
      );
    });
    assert(
      Number.isInteger(s.plan.dailyMinutes) &&
        s.plan.dailyMinutes >= 5 &&
        s.plan.dailyMinutes <= 120 &&
        Number.isInteger(s.plan.dailyNewWords) &&
        s.plan.dailyNewWords >= 5 &&
        s.plan.dailyNewWords <= 60,
      '学习计划数值无效',
    );
    assert(['N5', 'N4', 'N3', 'N2', 'N1'].includes(s.plan.jlptTarget), 'JLPT 目标无效');
    assert(
      s.navigation.version === 1 && ['', 'vocab', 'grammar', 'lesson'].includes(s.navigation.lastModule),
      '导航版本或模块无效',
    );
    var grammar = await window.GrammarLoader.getIndex();
    ['vocab', 'grammar', 'textbook'].forEach(function (key) {
      assert(object(s.navigation[key]), '导航结构损坏');
    });
    var checkpoint = s.navigation.vocab.studySession;
    if (checkpoint != null) {
      assert(
        object(checkpoint) &&
          checkpoint.version === 1 &&
          Array.isArray(checkpoint.queueIndices) &&
          Number.isInteger(checkpoint.currentIndex) &&
          checkpoint.currentIndex >= 0 &&
          checkpoint.currentIndex <= checkpoint.queueIndices.length,
        '学习会话版本或位置无效',
      );
    }
    var grammarIds = new Set(
      grammar.map(function (entry) {
        return entry.uid;
      }),
    );
    v.grammarFavorite.forEach(function (uid) {
      assert(grammarIds.has(uid), '语法收藏包含旧 ID');
    });
    var navGrammar = s.navigation.grammar || {};
    if (navGrammar.selectedUid) assert(grammarIds.has(navGrammar.selectedUid), '语法导航包含旧 ID');
    if (navGrammar.lessonId !== undefined && navGrammar.lessonId !== '')
      assert(await window.GrammarLoader.getLesson(navGrammar.lessonId), '辅助课文 ID 不存在');
    var contexts = [
      s.plan,
      s.navigation.textbook,
      (s.navigation.textbook || {}).coursePath,
      navGrammar.courseContext,
    ];
    for (var context of contexts) {
      if (!context || !context.bookId) continue;
      assert(window.TextbookLoader.isKnownArchiveBook(context.bookId), '教材 ID 不存在');
      if (context.lessonId) {
        assert(
          await window.TextbookLoader.hasArchiveLesson(context.bookId, context.lessonId),
          '教材课次 ID 不存在',
        );
      }
    }
    return progressOnly(s);
  }
  function merge(current, incoming) {
    var result = clone(current);
    var a = result.vocabulary,
      b = incoming.vocabulary;
    ['favorite', 'grammarFavorite'].forEach(function (key) {
      a[key] = Array.from(new Set(a[key].concat(b[key])));
    });
    var srs = new Map(
      a.srs.map(function (record) {
        return [record.index, record];
      }),
    );
    b.srs.forEach(function (record) {
      var old = srs.get(record.index);
      if (!old || Date.parse(record.lastReviewedAt) > Date.parse(old.lastReviewedAt))
        srs.set(record.index, clone(record));
    });
    var status = new Map();
    ['known', 'fuzzy', 'unknown'].forEach(function (key) {
      b[key].forEach(function (id) {
        status.set(id, key);
      });
    });
    ['known', 'fuzzy', 'unknown'].forEach(function (key) {
      a[key].forEach(function (id) {
        status.set(id, key);
      });
    });
    srs.forEach(function (record, id) {
      status.set(id, record.lastResult);
    });
    ['known', 'fuzzy', 'unknown'].forEach(function (key) {
      a[key] = Array.from(status)
        .filter(function (entry) {
          return entry[1] === key;
        })
        .map(function (entry) {
          return entry[0];
        });
    });
    a.srs = Array.from(srs.values());
    var history = new Map();
    b.history.concat(a.history).forEach(function (entry) {
      history.set(entry.id || JSON.stringify(entry), clone(entry));
    });
    a.history = Array.from(history.values()).sort(function (x, y) {
      return String(x.date).localeCompare(String(y.date));
    });
    Object.keys(incoming.usage).forEach(function (date) {
      var old = result.usage[date],
        next = incoming.usage[date];
      if (!old) {
        result.usage[date] = clone(next);
        return;
      }
      old.focusedMs = Math.max(old.focusedMs, next.focusedMs);
      old.checkedIn = !!(old.checkedIn || next.checkedIn);
      old.checkins = Math.max(old.checkins || 0, next.checkins || 0);
      old.firstSeenAt = [old.firstSeenAt, next.firstSeenAt].filter(Boolean).sort()[0] || '';
      old.lastSeenAt = [old.lastSeenAt, next.lastSeenAt].filter(Boolean).sort().pop() || '';
    });
    return result;
  }
  window.JPLearn.archive = {
    exportArchive: exportArchive,
    validate: validate,
    merge: merge,
    MAX_BYTES: limit,
  };
})();
