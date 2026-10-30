/**
 * FilterManager: UI 筛选面板与状态管理
 *
 * [v2] 新增：viewMode、renderLimit 控件绑定
 */
function FilterManager() {
  this.searchInput = document.getElementById('searchInput');
  this.graphModeSelect = document.getElementById('graphModeSelect');
  this.levelSelect = document.getElementById('levelSelect');
  this.posSelect = document.getElementById('posSelect');
  this.domainSelect = document.getElementById('domainSelect');
  this.semanticSelect = document.getElementById('semanticSelect');
  this.viewModeSelect = document.getElementById('viewModeSelect');
  this.renderLimitSelect = document.getElementById('renderLimitSelect');
  this._applyTimer = null;

  this._bindEvents();
}

/**
 * 根据已加载数据填充筛选下拉框
 */
FilterManager.prototype.populateOptions = function () {
  var words = window.taxonomyManager.allWords;
  var mgr = window.taxonomyManager;

  // Level
  var levels = this._uniqueValues(words, function (w) {
    return w.level;
  });
  levels.sort();
  this._fillSelect(this.levelSelect, levels);
  this._syncLevelChips();

  // POS
  var metadata = window.JPLearn && window.JPLearn.lexicalMetadata;
  var posSeen = {};
  var posSet = [];
  for (var pi = 0; pi < words.length; pi++) {
    var wordPos = words[pi].pos;
    var classes = metadata ? metadata.classes(wordPos) : typeof wordPos === 'string' ? [wordPos] : [];
    for (var pc = 0; pc < classes.length; pc++) {
      if (!posSeen[classes[pc]]) {
        posSeen[classes[pc]] = true;
        posSet.push(classes[pc]);
      }
    }
  }
  posSet.sort();
  this._fillSelect(this.posSelect, posSet, function (val) {
    return mgr.getLabel('pos', val);
  });

  // Domain
  var domainsSet = {};
  for (var i = 0; i < words.length; i++) {
    var dc = words[i].domain_codes;
    for (var j = 0; j < dc.length; j++) {
      domainsSet[dc[j]] = true;
    }
  }
  var domainKeys = Object.keys(domainsSet).sort();
  this._fillSelect(this.domainSelect, domainKeys, function (val) {
    return mgr.getLabel('domain', val);
  });

  // Semantic
  var semanticSet = {};
  for (var i = 0; i < words.length; i++) {
    var sc = words[i].semantic_tag_codes;
    for (var j = 0; j < sc.length; j++) {
      semanticSet[sc[j]] = true;
    }
  }
  var semanticKeys = Object.keys(semanticSet).sort();
  this._fillSelect(this.semanticSelect, semanticKeys, function (val) {
    return mgr.getLabel('semantic', val);
  });
};

FilterManager.prototype._uniqueValues = function (arr, getter) {
  var seen = {};
  var result = [];
  for (var i = 0; i < arr.length; i++) {
    var val = getter(arr[i]);
    if (val && !seen[val]) {
      seen[val] = true;
      result.push(val);
    }
  }
  return result;
};

FilterManager.prototype._fillSelect = function (selectEl, values, labelFn) {
  labelFn =
    labelFn ||
    function (v) {
      return v;
    };
  selectEl.innerHTML = '<option value="">全部</option>';
  for (var i = 0; i < values.length; i++) {
    var val = values[i];
    var opt = document.createElement('option');
    opt.value = val;
    var displayLabel = labelFn(val);
    opt.textContent = displayLabel + (displayLabel !== val ? ' (' + val + ')' : '');
    selectEl.appendChild(opt);
  }
};

FilterManager.prototype._bindEvents = function () {
  var self = this;

  var levelChips = document.querySelectorAll('[data-vocab-level]');
  for (var i = 0; i < levelChips.length; i++) {
    levelChips[i].addEventListener('click', function () {
      self.levelSelect.value = this.getAttribute('data-vocab-level') || '';
      self._syncLevelChips();
      window.appConfig.applyFilters();
    });
  }

  var applyButton = document.getElementById('applyFiltersBtn');
  if (applyButton)
    applyButton.addEventListener('click', function () {
      self._applyNow();
    });

  document.getElementById('resetFiltersBtn').addEventListener('click', function () {
    self.reset();
  });

  document.getElementById('debugModeToggle').addEventListener('change', function (e) {
    document.body.classList.toggle('debug-mode', e.target.checked);
  });

  this.searchInput.addEventListener('input', function () {
    self._scheduleApply(220);
  });

  this.searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      self._applyNow();
    }
  });

  var liveSelects = [this.posSelect, this.domainSelect, this.semanticSelect];
  for (var j = 0; j < liveSelects.length; j++) {
    liveSelects[j].addEventListener('change', function () {
      self._applyNow();
    });
  }

  this.graphModeSelect.addEventListener('change', function () {
    window.appConfig.applyFilters();
  });

  // 视图模式切换
  this.viewModeSelect.addEventListener('change', function () {
    var mode = self.viewModeSelect.value;
    window.ViewMode.set(mode);
    window.appConfig.applyFilters();
  });

  // 渲染上限切换
  this.renderLimitSelect.addEventListener('change', function () {
    window.appConfig.applyFilters();
  });

  // 返回上级按钮
  document.getElementById('backToOverviewBtn').addEventListener('click', function () {
    window.ViewMode.goBack();
    window.appConfig.applyFilters();
  });
};

FilterManager.prototype._scheduleApply = function (delay) {
  var self = this;
  clearTimeout(this._applyTimer);
  this._applyTimer = setTimeout(function () {
    self._applyTimer = null;
    window.appConfig.applyFilters();
  }, delay);
};

FilterManager.prototype._applyNow = function () {
  clearTimeout(this._applyTimer);
  this._applyTimer = null;
  return window.appConfig.applyFilters();
};

/**
 * Restore the vocabulary filter form and return the refresh promise.
 * Empty states use this public entry instead of reaching into form fields.
 */
FilterManager.prototype.reset = function () {
  clearTimeout(this._applyTimer);
  this._applyTimer = null;
  this.searchInput.value = '';
  this.levelSelect.value = '';
  this.posSelect.value = '';
  this.domainSelect.value = '';
  this.semanticSelect.value = '';
  this.renderLimitSelect.value = '0'; // 自动
  this.viewModeSelect.value = 'cards';
  this._syncLevelChips();
  window.ViewMode.set('cards');
  return window.appConfig.applyFilters();
};

/**
 * Clear the catalog filters while keeping the current view, sort and page size.
 * The in-page catalog heading uses this instead of reset(), which also returns
 * the browser to card mode.
 */
FilterManager.prototype.clearFilters = function () {
  clearTimeout(this._applyTimer);
  this._applyTimer = null;
  this.searchInput.value = '';
  this.levelSelect.value = '';
  this.posSelect.value = '';
  this.domainSelect.value = '';
  this.semanticSelect.value = '';
  this._syncLevelChips();
  return window.appConfig.applyFilters();
};

/**
 * Read-only summary of the active filters for context headings.
 */
FilterManager.prototype.describeActive = function () {
  var mgr = window.taxonomyManager;
  var label = function (kind, value) {
    return mgr && mgr.getLabel ? mgr.getLabel(kind, value) : value;
  };
  var search = this.searchInput.value.trim();
  var level = this.levelSelect.value || '';
  var details = [];
  if (this.posSelect.value) details.push(label('pos', this.posSelect.value));
  if (this.domainSelect.value) details.push('领域：' + label('domain', this.domainSelect.value));
  if (this.semanticSelect.value) details.push('语义：' + label('semantic', this.semanticSelect.value));
  return {
    search: search,
    level: level,
    details: details,
    count: (search ? 1 : 0) + (level ? 1 : 0) + details.length,
  };
};

/**
 * Set a vocabulary query from an external entry point and refresh the catalog.
 * Global search uses this public method so it does not reach into the filter
 * manager's internal controls or render state.
 */
FilterManager.prototype.setSearch = function (query) {
  clearTimeout(this._applyTimer);
  this._applyTimer = null;
  this.searchInput.value = String(query || '').slice(0, 200);
  this.levelSelect.value = '';
  this.posSelect.value = '';
  this.domainSelect.value = '';
  this.semanticSelect.value = '';
  this.renderLimitSelect.value = '0';
  this.viewModeSelect.value = 'cards';
  this._syncLevelChips();
  if (window.ViewMode) window.ViewMode.set('cards');
  return window.appConfig.applyFilters();
};

/**
 * 返回经过筛选的词条数组
 */
FilterManager.prototype.getFilteredWords = function () {
  var words = window.taxonomyManager.allWords;
  var q = this.searchInput.value.toLowerCase().trim();
  var level = this.levelSelect.value;
  var pos = this.posSelect.value;
  var domain = this.domainSelect.value;
  var semantic = this.semanticSelect.value;

  var filtered = [];
  for (var i = 0; i < words.length; i++) {
    var w = words[i];

    // 搜索匹配（v3 扩展：覆盖 Gemini 新字段）
    if (q) {
      var matchWord = w.word.toLowerCase().indexOf(q) !== -1 || w.label.toLowerCase().indexOf(q) !== -1;
      var matchMeaning =
        (w.meaning && w.meaning.toLowerCase().indexOf(q) !== -1) ||
        (w.reading_hiragana && w.reading_hiragana.indexOf(q) !== -1) ||
        (w.definition_ja_brief && w.definition_ja_brief.indexOf(q) !== -1) ||
        (w.meanings_zh && w.meanings_zh.join('').toLowerCase().indexOf(q) !== -1);
      var matchRelated =
        (w.synonyms_ja && w.synonyms_ja.join('').indexOf(q) !== -1) ||
        (w.antonyms_ja && w.antonyms_ja.join('').indexOf(q) !== -1) ||
        (w.related_words_ja && w.related_words_ja.join('').indexOf(q) !== -1);
      if (!matchWord && !matchMeaning && !matchRelated) continue;
    }

    // 下拉筛选
    if (level && w.level !== level) continue;
    if (pos) {
      var metadata = window.JPLearn && window.JPLearn.lexicalMetadata;
      var matchesPos = metadata
        ? metadata.hasClass(w.pos, pos)
        : typeof w.pos === 'string' && w.pos === pos;
      if (!matchesPos) continue;
    }
    if (domain && w.domain_codes.indexOf(domain) === -1) continue;
    if (semantic && w.semantic_tag_codes.indexOf(semantic) === -1) continue;

    filtered.push(w);
  }

  return filtered;
};

FilterManager.prototype.getGraphMode = function () {
  return this.graphModeSelect.value;
};

/**
 * 获取当前设定的渲染上限。0 表示"自动"。
 */
FilterManager.prototype.getRenderLimit = function () {
  return parseInt(this.renderLimitSelect.value) || 0;
};

FilterManager.prototype.exportNavigation = function () {
  return {
    search: this.searchInput.value || '',
    level: this.levelSelect.value || '',
    pos: this.posSelect.value || '',
    domain: this.domainSelect.value || '',
    semantic: this.semanticSelect.value || '',
    renderLimit: this.renderLimitSelect.value || '0',
  };
};

FilterManager.prototype.restoreNavigation = function (state) {
  state = state && typeof state === 'object' ? state : {};
  this.searchInput.value = typeof state.search === 'string' ? state.search.slice(0, 200) : '';
  this._restoreSelectValue(this.levelSelect, state.level);
  this._restoreSelectValue(this.posSelect, state.pos);
  this._restoreSelectValue(this.domainSelect, state.domain);
  this._restoreSelectValue(this.semanticSelect, state.semantic);
  this._restoreSelectValue(this.renderLimitSelect, state.renderLimit || '0');
  this._syncLevelChips();
};

FilterManager.prototype._syncLevelChips = function () {
  var selected = this.levelSelect.value || '';
  var chips = document.querySelectorAll('[data-vocab-level]');
  for (var i = 0; i < chips.length; i++) {
    var active = (chips[i].getAttribute('data-vocab-level') || '') === selected;
    chips[i].classList.toggle('active', active);
    chips[i].setAttribute('aria-pressed', active ? 'true' : 'false');
  }
};

FilterManager.prototype._restoreSelectValue = function (selectEl, value) {
  var text = typeof value === 'string' ? value : '';
  for (var i = 0; i < selectEl.options.length; i++) {
    if (selectEl.options[i].value === text) {
      selectEl.value = text;
      return;
    }
  }
  selectEl.value = '';
};
