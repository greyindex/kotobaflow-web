/**
 * CardMode: 词卡目录模式（Card Catalog）
 *
 * 一种类似纸质词卡手册的浏览和背词界面。
 * 支持等级分组、随机排序、收藏、分页、批量操作、展开详情。
 *
 * 依赖：
 *   - window.taxonomyManager (taxonomy.js)
 *   - window.StudyStorage (storage.js)
 *   - window.ViewMode (view-mode.js)
 *   - window.detailPanel (detail-panel.js)
 */
function CardMode(containerId) {
  this.container = document.getElementById(containerId);
  this.filteredWords = []; // 来自侧栏筛选的词
  this.displayWords = []; // 经过级别+收藏+排序后
  this.currentPage = 1;
  this.perPage = 24;
  this.activeLevel = ''; // 空 = 全部
  this.sortMode = 'default'; // default | shuffle | index | alpha | fav
  this.showFavOnly = false;
  this.hideMeanings = false;
  this.expandedCards = {}; // { index: true }
  this._shuffleCache = null;
  this._levelCounts = {};
  this._batchMenuOpen = false;
  this._meaningTransitionFrame = null;
  this._pendingMeaningAnchor = null;
  this._cardMenuKeyHandler = null;
}

/* ═══════════════════════════════════════════════════════════
   数据接入
   ═══════════════════════════════════════════════════════════ */

CardMode.prototype.setData = function (words) {
  // The same result may be supplied again when returning to this view. Only a
  // new query or ordered set of word identities starts a new book context.
  var filters = window.filterManager ? window.filterManager.exportNavigation() : {};
  var context = JSON.stringify([
    String(filters.search || '').toLowerCase().trim(),
    filters.level || '',
    filters.pos || '',
    filters.domain || '',
    filters.semantic || '',
    words.map(function (word) {
      return word.index;
    }),
  ]);
  var changed = context !== this._bookDataContext;
  this._bookDataContext = context;
  this.filteredWords = words;
  if (changed) this._resetBookPosition();
  else if (!this._isBookViewEnabled()) this.currentPage = 1;
  this._shuffleCache = null;
  this._calcLevelCounts();
};

CardMode.prototype._calcLevelCounts = function () {
  this._levelCounts = { '': 0 };
  for (var i = 0; i < this.filteredWords.length; i++) {
    var lv = this.filteredWords[i].level;
    if (!this._levelCounts[lv]) this._levelCounts[lv] = 0;
    this._levelCounts[lv]++;
    this._levelCounts['']++;
  }
};

/* ═══════════════════════════════════════════════════════════
   显示列表构建（级别 + 收藏 + 排序）
   ═══════════════════════════════════════════════════════════ */

CardMode.prototype._buildDisplay = function () {
  var context = JSON.stringify([this.activeLevel, this.showFavOnly, this.sortMode, this.perPage]);
  if (context !== this._bookDisplayContext) this._resetBookPosition();
  this._bookDisplayContext = context;
  var words = [];

  for (var i = 0; i < this.filteredWords.length; i++) {
    var w = this.filteredWords[i];
    if (this.activeLevel && w.level !== this.activeLevel) continue;
    if (this.showFavOnly) {
      var st = window.StudyStorage.getWordStatus(w.index);
      if (!st.isFavorite) continue;
    }
    words.push(w);
  }

  switch (this.sortMode) {
    case 'index':
      words.sort(function (a, b) {
        return a.index - b.index;
      });
      break;
    case 'alpha':
      words.sort(function (a, b) {
        return a.word.localeCompare(b.word, 'ja');
      });
      break;
    case 'shuffle':
      words = this._getShuffled(words);
      break;
    case 'fav':
      words = this._sortFavFirst(words);
      break;
  }

  this.displayWords = words;
};

CardMode.prototype._getShuffled = function (words) {
  return window.appConfig.getShuffled(words);
};

CardMode.prototype._sortFavFirst = function (words) {
  var favs = [];
  var rest = [];
  for (var i = 0; i < words.length; i++) {
    var st = window.StudyStorage.getWordStatus(words[i].index);
    if (st.isFavorite) favs.push(words[i]);
    else rest.push(words[i]);
  }
  return favs.concat(rest);
};

// Shared by the drawer tool and the catalog heading: one finite mixed session
// sampled from the words currently shown in the catalog.
CardMode.prototype.startStudyFromDisplay = function () {
  if (!this.displayWords.length) return false;
  return window.appConfig.startStudySession(this.displayWords, {
    shuffle: true,
    limit: 20,
    practiceMode: 'mixed',
  });
};

CardMode.prototype.reshuffle = function () {
  window.appConfig.reshuffleShared();
  this._resetBookPosition();
  this.render();
};

/* ═══════════════════════════════════════════════════════════
   主渲染入口
   ═══════════════════════════════════════════════════════════ */

CardMode.prototype._findWord = function (index) {
  var allWords = window.taxonomyManager.allWords;
  for (var i = 0; i < allWords.length; i++) {
    if (allWords[i].index === index) return allWords[i];
  }
  return null;
};

CardMode.prototype._padIndex = function (n) {
  var s = String(n);
  while (s.length < 5) s = '0' + s;
  return s;
};

CardMode.prototype._esc = function (str) {
  return window.JPLearn.html.escape(str);
};

CardMode.prototype._getDisplayReading = function (word) {
  return word && word.reading_hiragana ? String(word.reading_hiragana).trim() : '';
};

CardMode.prototype._getVisibleContentTop = function () {
  var containerRect = this.container.getBoundingClientRect();
  var toolbar = this.container.querySelector('.cc-toolbar');
  if (!toolbar) return containerRect.top;

  var toolbarRect = toolbar.getBoundingClientRect();
  if (toolbarRect.bottom <= containerRect.top || toolbarRect.top >= containerRect.bottom) {
    return containerRect.top;
  }
  return Math.max(containerRect.top, Math.min(containerRect.bottom, toolbarRect.bottom));
};

CardMode.prototype._captureScrollAnchor = function () {
  var fallback = { index: null, offset: 0, scrollTop: this.container.scrollTop };
  var cards = this.container.querySelectorAll('.cc-card[data-index]');
  var visibleTop = this._getVisibleContentTop();
  var containerRect = this.container.getBoundingClientRect();
  var containerBottom = containerRect.bottom;
  var partial = null;

  for (var i = 0; i < cards.length; i++) {
    var rect = cards[i].getBoundingClientRect();
    if (rect.bottom > visibleTop + 1 && rect.top < containerBottom) {
      var anchor = {
        index: cards[i].getAttribute('data-index'),
        offset: rect.top - containerRect.top,
        scrollTop: this.container.scrollTop,
      };
      if (rect.top >= visibleTop - 1) return anchor;
      if (!partial) partial = anchor;
    }
  }
  return partial || fallback;
};

CardMode.prototype._restoreScrollAnchor = function (anchor) {
  if (!anchor || !this.container) return;
  if (anchor.index === null) {
    this.container.scrollTop = anchor.scrollTop;
    return;
  }

  var card = this.container.querySelector('.cc-card[data-index="' + anchor.index + '"]');
  if (!card) {
    this.container.scrollTop = anchor.scrollTop;
    return;
  }

  var delta = card.getBoundingClientRect().top - this.container.getBoundingClientRect().top - anchor.offset;
  if (Math.abs(delta) > 0.5) {
    this.container.scrollTop += delta;
  }
};

CardMode.prototype._updateMeaningToggle = function () {
  var button = document.getElementById('ccMeaningToggle');
  if (!button) return;
  button.classList.toggle('active', this.hideMeanings);
  button.setAttribute('aria-pressed', this.hideMeanings ? 'true' : 'false');
  button.title = this.hideMeanings ? '显示词卡释义' : '隐藏词卡释义';
  button.setAttribute('aria-label', button.title);
  button.innerHTML = uiIcon(this.hideMeanings ? 'eye' : 'eye-off');
};

CardMode.prototype._updateReadPageButton = function (playing) {
  var button = document.getElementById('ccReadPage');
  if (!button) return;
  var label = playing ? '暂停当页朗读' : '朗读当页单词';
  button.innerHTML = uiIcon(playing ? 'pause' : 'play');
  button.title = label;
  button.setAttribute('aria-label', label);
};

CardMode.prototype._toggleMeaningsWithAnchor = function (preparedAnchor) {
  if (!this.container) return;

  var anchor = preparedAnchor || this._captureScrollAnchor();
  var wrapper = this.container.querySelector('.cc-wrapper');
  if (!wrapper) return;

  if (this._meaningTransitionFrame !== null) {
    cancelAnimationFrame(this._meaningTransitionFrame);
    this._meaningTransitionFrame = null;
  }

  this.hideMeanings = !this.hideMeanings;
  wrapper.classList.toggle('cc-hide-meanings', this.hideMeanings);
  this._updateMeaningToggle();
  this.container.classList.add('cc-meaning-transitioning');

  var self = this;
  var startedAt = performance.now();
  var duration = 220;

  function keepAnchor(now) {
    self._restoreScrollAnchor(anchor);
    if (now - startedAt < duration) {
      self._meaningTransitionFrame = requestAnimationFrame(keepAnchor);
      return;
    }
    self._meaningTransitionFrame = null;
    self.container.classList.remove('cc-meaning-transitioning');
    self._restoreScrollAnchor(anchor);
  }

  this._meaningTransitionFrame = requestAnimationFrame(keepAnchor);
};

CardMode.prototype._scrollToTop = function () {
  if (this.container) this.container.scrollTop = 0;
};

window.JPLearn.installCardRenderer(CardMode);
window.JPLearn.installCardEvents(CardMode);
window.JPLearn.installCardBook(CardMode);
window.CardMode = CardMode;
