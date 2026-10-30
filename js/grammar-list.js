/**
 * grammar-list.js
 * Paginated grammar card grid with search/filter.
 */
var GRAMMAR_TAG_LABELS = {
  evaluation: '评价',
  speaker_judgment: '说话人判断',
  condition: '条件',
  concession: '让步',
  degree: '程度',
  dependency: '依存',
  premise: '前提',
  contrastive_focus: '对比强调',
  'N1-Grammar': 'N1 语法',
  'N1-grammar': 'N1 语法',
  Formal: '正式',
  formal: '正式',
  emotion_attitude: '情感态度',
  emphasis: '强调',
  strong_emphasis: '强烈强调',
  assertion: '断定',
  rhetorical: '修辞',
  spoken_expression: '口语表达',
  limitation: '限定',
  scope_restriction: '范围限制',
  inability: '无法',
  assumption: '假设',
  obligation: '义务',
  necessity: '必要',
  cause_basis: '原因依据',
  basis: '依据',
  comparison: '比较',
  inevitability: '必然',
  purpose: '目的',
  intentionality: '意图',
  written_expression: '书面表达',
  urgency: '紧迫',
  contrast: '对比',
  sequence: '顺序',
  inference: '推断',
  empathy: '共情',
  judgment: '判断',
  cause_reason: '原因',
  regret: '遗憾',
  negative_only: '仅限否定',
  volition: '意志',
  strong_negation: '强烈否定',
  permission: '许可',
  polite_request: '礼貌请求',
  humble: '谦让',
  result_state: '结果状态',
  cause: '原因',
  reason: '理由',
  result_focus: '结果强调',
  state_change: '状态变化',
  request_advice: '请求建议',
  possibility: '可能',
  negative_prediction: '否定预测',
  emotion: '情感',
  uncontrollable: '不可控',
  tendency: '倾向',
  habitual_pattern: '习惯模式',
  topic_pickup: '话题提起',
  'Ko-So-A-Do': '指示词体系',
  verb_type: '动词类型',
  N5_core: 'N5 核心',
  quantity: '数量',
  premise_dependency: '前提依存',
  frequency: '频率',
};

function grammarTagLabel(value) {
  var key = String(value || '').trim();
  return GRAMMAR_TAG_LABELS[key] || key;
}

function grammarTagLabels(tags, level) {
  var seen = Object.create(null);
  var normalizedLevel = String(level || '').toLowerCase();
  return (Array.isArray(tags) ? tags : []).map(grammarTagLabel).filter(function (label) {
    if (!label || seen[label]) return false;
    seen[label] = true;
    var compact = label.replace(/[\s_-]/g, '').toLowerCase();
    return (
      !normalizedLevel ||
      (compact !== normalizedLevel &&
        compact !== normalizedLevel + '语法' &&
        compact !== normalizedLevel + 'grammar')
    );
  });
}

function GrammarListView(containerId, detailPanel) {
  this.container = document.getElementById(containerId);
  this.detailPanel = detailPanel;
  this.allItems = [];
  this.filtered = [];
  this.currentPage = 1;
  this.pageSize = 24;
  this.selectedUid = null;
  this.searchQuery = '';
  this.levelFilter = 'all';
  this.funcGroupFilter = '';
  this.filterFavorites = false;
  this.onRendered = null; // callback() after each grid render (page heading)
}

GrammarListView.prototype = {
  init: function () {
    var self = this;
    return GrammarLoader.getIndex().then(function (index) {
      self.allItems = index || [];
      self._applyFilters();
      self._render();
    });
  },

  _applyFilters: function () {
    var q = this.searchQuery.toLowerCase().trim();
    var level = this.levelFilter;
    var fg = this.funcGroupFilter;
    var self = this;
    var context = JSON.stringify([q, level, fg, this.filterFavorites, this.pageSize]);
    var changed = context !== this._bookFilterContext;
    this._bookFilterContext = context;

    this.filtered = this.allItems.filter(function (item) {
      // Level filter
      if (level !== 'all' && item.level !== level) return false;
      // Function group
      if (fg && (!item.functionGroup || item.functionGroup.indexOf(fg) === -1)) return false;
      if (self.filterFavorites && !window.StudyStorage.isGrammarFavorite(item.uid)) return false;
      // Search
      if (q) {
        var hay = [
          item.title,
          item.cleanTitle,
          item.canonicalForm,
          item.coreMeaningZh,
          item.headline,
          item.oneLineMemory,
          (item.commonCollocations || []).join(' '),
          (item.patternFrames || []).join(' '),
          (item.quickTags || []).join(' '),
        ]
          .join(' ')
          .toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });

    if (changed) {
      this.currentPage = 1;
      this._bookAnchor = null;
      this._bookPendingLast = false;
    } else if (!window.JPLearn.grammarBookView.isEnabled()) this.currentPage = 1;
    else this.currentPage = Math.min(this.currentPage, Math.ceil(this.filtered.length / this.pageSize) || 1);
  },

  _render: function (options) {
    var h = '';
    // The page-turn layout replaces the pager: turning past a group opens the next one.
    var book = window.JPLearn.grammarBookView.isEnabled() && this.filtered.length > 0;
    if (book) h += '<div class="gm-book-body">' + this._renderGrid() + '</div>';
    else {
      h += this._renderGrid();
      h += this._renderPagination();
    }
    this.container.innerHTML = h;
    if (options && options.preserveSearch) {
      var count = document.querySelector('#gmSidebarFilters .gm-count');
      if (count) count.textContent = this.filtered.length + ' / ' + this.allItems.length;
    } else this.renderSidebarTools();
    this._bindContentEvents();
    this._mountBookView();
    if (typeof this.onRendered === 'function') this.onRendered();
  },

  renderSidebarTools: function () {
    clearTimeout(this._searchTimeout);
    var tools = document.getElementById('gmSidebarFilters');
    if (!tools) return;
    tools.innerHTML = this._renderToolbar();
    this._bindSidebarEvents();
  },

  _renderToolbar: function () {
    var facets = GrammarLoader.getFacets() || { levels: [], functionGroups: [] };
    var total = this.allItems.length;
    var shown = this.filtered.length;
    var favoriteCount = window.StudyStorage.getGrammarFavorites().length;

    var h = '<div class="gm-sidebar-filter-content">';
    // Search
    h += '<div class="gm-toolbar-row">';
    h +=
      '<input type="text" class="gm-search" id="gmSearch" placeholder="搜索语法 (标题/接续/释义/搭配)" value="' +
      this._esc(this.searchQuery) +
      '">';
    h += '<span class="gm-count">' + shown + ' / ' + total + '</span>';
    h += '</div>';

    // Level segments: one row ordered like the vocabulary bar (N5 → N1).
    h += '<div class="gm-level-tabs" role="group" aria-label="按 JLPT 等级筛选">';
    var levels = ['all'].concat(facets.levels.slice().sort().reverse());
    for (var i = 0; i < levels.length; i++) {
      var lv = levels[i];
      var label = lv === 'all' ? '全部' : lv;
      var count =
        lv === 'all'
          ? total
          : this.allItems.filter(function (x) {
              return x.level === lv;
            }).length;
      var isActive = lv === this.levelFilter;
      h +=
        '<button class="gm-tab' +
        (isActive ? ' active' : '') +
        '" type="button" data-level="' +
        this._esc(lv) +
        '" aria-pressed="' +
        isActive +
        '" title="' +
        this._esc(label + ' · ' + count + ' 个语法点') +
        '">' +
        this._esc(label) +
        '</button>';
    }
    h += '</div>';

    // Favorites: a separate toggle row, matching the vocabulary drawer.
    h +=
      '<button class="sidebar-tool-toggle favorite gm-tab-fav' +
      (this.filterFavorites ? ' active' : '') +
      '" type="button" data-favorite-filter="1" aria-pressed="' +
      this.filterFavorites +
      '">' +
      uiIcon('star') +
      '收藏 <span>' +
      favoriteCount +
      '</span></button>';

    // Function group
    h += '<div class="gm-toolbar-row gm-filter-row">';
    // Function group select
    h += '<select class="gm-select" id="gmFuncGroup"><option value="">功能组: 全部</option>';
    var fgs = facets.functionGroups || [];
    for (var j = 0; j < fgs.length; j++) {
      var sel = fgs[j] === this.funcGroupFilter ? ' selected' : '';
      h +=
        '<option value="' +
        this._esc(fgs[j]) +
        '"' +
        sel +
        '>' +
        this._esc(grammarTagLabel(fgs[j])) +
        '</option>';
    }
    h += '</select>';
    h += '</div>';
    h += '</div>';
    return h;
  },

  _renderGrid: function () {
    var start = (this.currentPage - 1) * this.pageSize;
    var end = Math.min(start + this.pageSize, this.filtered.length);
    var page = this.filtered.slice(start, end);

    if (!page.length) {
      if (window.StateView) {
        return window.StateView.html({
          kind: 'empty',
          className: 'gm-empty-state',
          icon: this.filterFavorites ? 'star' : 'search',
          title: this.filterFavorites ? '还没有收藏语法' : '当前筛选没有语法点',
          message: this.filterFavorites
            ? '收藏语法点后，它们会集中出现在这里。'
            : '换一个关键词或清除筛选，语法点会重新出现在这里。',
          action: {
            id: 'reset-grammar-filters',
            label: '清除筛选',
            icon: 'rotate-ccw',
          },
        });
      }
      return '<div class="gm-empty-grid">没有匹配的语法点</div>';
    }

    var h = '<div class="gm-card-grid">';
    for (var i = 0; i < page.length; i++) {
      h += this._renderCard(page[i]);
    }
    h += '</div>';
    return h;
  },

  _renderCard: function (item) {
    var sel = item.uid === this.selectedUid ? ' gm-card-selected' : '';
    var isFavorite = window.StudyStorage.isGrammarFavorite(item.uid);
    var title = item.cleanTitle || item.title;
    var connectionHint =
      item.canonicalForm || (item.patternFrames && item.patternFrames[0]) || item.headline || '';
    var tags = grammarTagLabels(item.quickTags, item.level)
      .filter(function (label) {
        return !/[a-z_]/i.test(label);
      })
      .slice(0, 1);
    var h =
      '<div class="gm-card' +
      sel +
      '" data-uid="' +
      this._esc(item.uid) +
      '" role="button" tabindex="0" aria-label="查看语法 ' +
      this._esc(title) +
      '">';
    h += '<div class="gm-card-bar gm-level-' + (item.level || '').toLowerCase() + '"></div>';
    h += '<div class="gm-card-body">';
    // Stable meta row: long titles never displace the level/index baseline.
    h += '<div class="gm-card-meta">';
    h += '<span class="gm-card-level">' + this._esc(item.level) + '</span>';
    h += '<span class="gm-card-idx">#' + String(item.index || '').padStart(3, '0') + '</span>';
    h +=
      '<button class="gm-card-fav' +
      (isFavorite ? ' active' : '') +
      '" data-grammar-fav="' +
      this._esc(item.uid) +
      '" title="' +
      (isFavorite ? '取消收藏' : '收藏') +
      '" aria-label="' +
      (isFavorite ? '取消收藏' : '收藏') +
      '">' +
      uiIcon('star') +
      '</button>';
    h += '</div>';
    h += '<div class="gm-card-title" lang="ja">' + this._esc(title) + '</div>';
    if (item.coreMeaningZh) {
      h += '<div class="gm-card-meaning">' + this._esc(item.coreMeaningZh) + '</div>';
    }
    if (connectionHint) {
      h +=
        '<div class="gm-card-connection" lang="ja"><span lang="zh-CN">接续</span>' +
        this._esc(connectionHint) +
        '</div>';
    }
    if (tags.length) {
      h += '<div class="gm-card-tags">';
      for (var j = 0; j < tags.length; j++) {
        h += '<span class="gm-card-tag">' + this._esc(grammarTagLabel(tags[j])) + '</span>';
      }
      h += '</div>';
    }
    h += '</div></div>';
    return h;
  },

  _renderPagination: function () {
    var totalPages = Math.ceil(this.filtered.length / this.pageSize) || 1;
    if (totalPages <= 1) return '';

    var h = '<div class="gm-pagination">';
    h +=
      '<button class="gm-page-btn" data-page="prev" aria-label="上一页" ' +
      (this.currentPage <= 1 ? 'disabled' : '') +
      '>' +
      uiIcon('chevron-left') +
      '</button>';

    // Page numbers
    var startP = Math.max(1, this.currentPage - 2);
    var endP = Math.min(totalPages, this.currentPage + 2);
    if (startP > 1)
      h += '<button class="gm-page-btn" data-page="1">1</button><span class="gm-page-dots">…</span>';
    for (var p = startP; p <= endP; p++) {
      var cls = p === this.currentPage ? 'gm-page-btn active' : 'gm-page-btn';
      h += '<button class="' + cls + '" data-page="' + p + '">' + p + '</button>';
    }
    if (endP < totalPages)
      h +=
        '<span class="gm-page-dots">…</span><button class="gm-page-btn" data-page="' +
        totalPages +
        '">' +
        totalPages +
        '</button>';

    h +=
      '<button class="gm-page-btn" data-page="next" aria-label="下一页" ' +
      (this.currentPage >= totalPages ? 'disabled' : '') +
      '>' +
      uiIcon('chevron-right') +
      '</button>';
    h += '</div>';
    return h;
  },

  _bindSidebarEvents: function () {
    var self = this;
    // Search
    var searchEl = document.getElementById('gmSearch');
    if (searchEl) {
      var composing = false;
      function search(event) {
        clearTimeout(self._searchTimeout);
        if (composing || (event && event.isComposing)) return;
        self.searchQuery = searchEl.value;
        self._searchTimeout = setTimeout(function () {
          if (!searchEl.isConnected) return;
          self._applyFilters();
          self._render({ preserveSearch: true });
        }, 250);
      }
      searchEl.addEventListener('compositionstart', function () {
        composing = true;
        clearTimeout(self._searchTimeout);
      });
      searchEl.addEventListener('compositionend', function () {
        composing = false;
        search();
      });
      searchEl.addEventListener('input', search);
    }
    // Level tabs
    var tabs = document.querySelectorAll('#gmSidebarFilters .gm-tab[data-level]');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', function () {
        self.levelFilter = this.getAttribute('data-level');
        self._applyFilters();
        self._render();
      });
    }
    var favoriteTab = document.querySelector('#gmSidebarFilters .gm-tab-fav');
    if (favoriteTab) {
      favoriteTab.addEventListener('click', function () {
        self.filterFavorites = !self.filterFavorites;
        self._applyFilters();
        self._render();
      });
    }
    // Select
    var fgSel = document.getElementById('gmFuncGroup');
    if (fgSel)
      fgSel.addEventListener('change', function () {
        self.funcGroupFilter = this.value;
        self._applyFilters();
        self._render();
      });
  },

  _bindContentEvents: function () {
    var self = this;
    var emptyStateAction = this.container.querySelector('.gm-empty-state [data-state-action]');
    if (emptyStateAction) {
      emptyStateAction.addEventListener('click', function () {
        self.resetFilters();
      });
    }
    // Card clicks
    var cards = this.container.querySelectorAll('.gm-card');
    for (var j = 0; j < cards.length; j++) {
      cards[j].addEventListener('click', function (e) {
        if (e.target.closest('.gm-card-fav')) return;
        var uid = this.getAttribute('data-uid');
        self.selectCard(uid, this, e.detail === 0);
      });
      cards[j].addEventListener('keydown', function (e) {
        if (e.target.closest('.gm-card-fav')) return;
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        self.selectCard(this.getAttribute('data-uid'), this, true);
      });
    }
    var favoriteBtns = this.container.querySelectorAll('.gm-card-fav');
    for (var f = 0; f < favoriteBtns.length; f++) {
      favoriteBtns[f].addEventListener('click', function (e) {
        e.stopPropagation();
        var result = window.StudyStorage.toggleGrammarFavorite(this.getAttribute('data-grammar-fav'));
        if (result.status !== 'saved' && result.status !== 'alreadySaved') return;
        if (self.filterFavorites) self._applyFilters();
        self._render();
      });
    }
    // Pagination
    var pageBtns = this.container.querySelectorAll('.gm-page-btn');
    for (var k = 0; k < pageBtns.length; k++) {
      pageBtns[k].addEventListener('click', function () {
        var p = this.getAttribute('data-page');
        var totalPages = Math.ceil(self.filtered.length / self.pageSize) || 1;
        if (p === 'prev') self.currentPage = Math.max(1, self.currentPage - 1);
        else if (p === 'next') self.currentPage = Math.min(totalPages, self.currentPage + 1);
        else self.currentPage = parseInt(p);
        self._render();
      });
    }
  },

  selectCard: function (uid, anchor, focusPopup) {
    this.selectedUid = uid;
    // Highlight
    var cards = this.container.querySelectorAll('.gm-card');
    for (var i = 0; i < cards.length; i++) {
      cards[i].classList.toggle('gm-card-selected', cards[i].getAttribute('data-uid') === uid);
      if (!anchor && cards[i].getAttribute('data-uid') === uid) anchor = cards[i];
    }
    // Find index entry
    var entry = null;
    for (var j = 0; j < this.allItems.length; j++) {
      if (this.allItems[j].uid === uid) {
        entry = this.allItems[j];
        break;
      }
    }
    // Show detail
    if (this.detailPanel) {
      this.detailPanel.show(uid, entry, anchor, { focus: !!focusPopup });
    }
  },

  resetFilters: function () {
    this.searchQuery = '';
    this.levelFilter = 'all';
    this.funcGroupFilter = '';
    this.filterFavorites = false;
    this._applyFilters();
    this._render();
  },

  _esc: function (s) {
    return window.JPLearn.html.escape(s);
  },
};
