/**
 * main.js: 应用初始化与总控入口
 *
 * [v3] 新增：
 *   - 学习模式调度 (study)
 *   - 4000 渲染上限支持
 *   - 自动模式阈值提升到 1000
 *   - taxonomyManager.allWords 存储全量词条用于学习模式
 *
 * [v4] 新增：
 *   - 词卡模式调度 (cards)
 */
window.appConfig = {
  listView: null,
  studyMode: null,
  cardMode: null,
  _lastFilteredWords: [],
  status: 'idle',
  lastError: null,
  _retryPromise: null,

  getCurrentWords: function () {
    return this._lastFilteredWords.slice();
  },

  startStudySession: function (words, options) {
    if (!this.studyMode) return false;
    return this.studyMode.startSession(words, options);
  },

  retryInit: function () {
    var self = this;
    if (this._retryPromise) return this._retryPromise;
    this._retryPromise = this.init().then(function (ready) {
      if (ready && window.JPLearn && window.JPLearn.events) window.JPLearn.events.emit('app:ready');
      return ready;
    }).then(function (ready) {
      self._retryPromise = null;
      return ready;
    }, function (err) {
      self._retryPromise = null;
      throw err;
    });
    return this._retryPromise;
  },

  exportNavigation: function () {
    var mode = window.ViewMode ? window.ViewMode.get() : 'cards';
    var page = 1;
    if (mode === 'list' && this.listView) page = this.listView.currentPage;
    if (mode === 'cards' && this.cardMode) page = this.cardMode.currentPage;
    return {
      view: mode,
      page: page,
      filters: window.filterManager ? window.filterManager.exportNavigation() : {},
      studySession: this.studyMode ? this.studyMode.exportCheckpoint() : null,
    };
  },

  restoreNavigation: async function (state) {
    state = state && typeof state === 'object' ? state : {};
    var allowedViews = { cards: true, list: true, graph: true, aggregate: true, study: true };
    var mode = allowedViews[state.view] ? state.view : 'cards';
    if (window.filterManager) window.filterManager.restoreNavigation(state.filters);
    window.ViewMode.set(mode);
    await this.applyFilters();
    if (this.studyMode && state.studySession) {
      this.studyMode.restoreCheckpoint(state.studySession, { render: mode === 'study' });
    }
    var page = Math.max(1, parseInt(state.page, 10) || 1);
    if (mode === 'list' && this.listView) {
      this.listView.currentPage = Math.min(page, this.listView.totalPages || 1);
      this.listView.render();
    }
    if (mode === 'cards' && this.cardMode) {
      var totalPages = Math.max(1, Math.ceil(this.cardMode.displayWords.length / this.cardMode.perPage));
      this.cardMode.currentPage = Math.min(page, totalPages);
      this.cardMode.render();
    }
  },

  // Shared state for shuffling
  sharedShuffleCache: null,
  getSeed: function () {
    var seed = localStorage.getItem('vocab_shuffle_seed');
    if (!seed) {
      seed = Date.now().toString();
      localStorage.setItem('vocab_shuffle_seed', seed);
    }
    return parseInt(seed, 10);
  },
  setSeed: function (newSeed) {
    localStorage.setItem('vocab_shuffle_seed', newSeed.toString());
    this.sharedShuffleCache = null;
  },
  _mulberry32: function (a) {
    return function () {
      var t = (a += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },
  getShuffled: function (words) {
    if (this.sharedShuffleCache && this.sharedShuffleCache.length === words.length) {
      var valid = true;
      if (words.length > 0) {
        var cacheIndices = {};
        for (var k = 0; k < this.sharedShuffleCache.length; k++) {
          cacheIndices[this.sharedShuffleCache[k].index] = true;
        }
        for (var k = 0; k < words.length; k++) {
          if (!cacheIndices[words[k].index]) {
            valid = false;
            break;
          }
        }
      }
      if (valid) return this.sharedShuffleCache;
    }

    var rng = this._mulberry32(this.getSeed());
    var arr = words.slice();
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    this.sharedShuffleCache = arr;
    return arr;
  },
  reshuffleShared: function () {
    this.setSeed(Date.now());
  },

  async init() {
    var self = this;
    var loadingEl = document.getElementById('loading');
    var errorEl = document.getElementById('error-message');
    var loadingDetail = document.getElementById('loadingDetail');

    this.status = 'loading';
    this.lastError = null;
    if (loadingEl) {
      if (window.StateView) {
        window.StateView.mount(loadingEl, {
          kind: 'loading',
          skeleton: true,
          title: '正在准备词汇',
          message: '正在读取词库与筛选器…',
        });
      }
      loadingEl.classList.remove('hidden');
      loadingEl.setAttribute('aria-busy', 'true');
    }
    if (errorEl) errorEl.classList.add('hidden');

    try {
      if (loadingEl && loadingEl.querySelector('.state-view-title')) {
        loadingEl.querySelector('.state-view-title').textContent = '正在初始化词汇';
      }

      // 设置加载进度回调
      window.dataLoader.onProgress = function (stage, detail) {
        if (window.StateView) window.StateView.setLoading(loadingEl, '正在准备词汇', detail || stage);
        if (loadingDetail) loadingDetail.textContent = detail;
        console.log('[Loader] ' + stage + ': ' + detail);
      };

      // 初始化图谱引擎
      window.graphBuilder = new GraphBuilder('graph-container');
      window.graphBuilder.init();

      // 初始化列表视图
      this.listView = new ListView('list-container');

      // 初始化学习模式
      this.studyMode = new StudyMode('study-container');

      // 初始化词卡模式
      this.cardMode = new CardMode('card-container');

      // 加载并归一化所有数据
      var count = await window.dataLoader.loadAllData();
      // allWords 已在 loader.js 中通过 mgr.setWords() 设置

      // 更新 badge 和状态栏
      document.getElementById('totalWordsBadge').textContent = count + ' 词';
      document.getElementById('statusTotal').textContent = count;

      // 初始化筛选器
      window.filterManager = new FilterManager();
      window.filterManager.populateOptions();

      // 初始化详情面板
      window.detailPanel = new DetailPanel();

      // 默认使用词卡模式
      window.ViewMode.set('cards');

      // 首次渲染
      var rendered = await this.applyFilters();
      if (rendered === false) throw this.lastError || new Error('词汇界面渲染失败');

      this.status = 'ready';
      this.renderCatalogHeading();
      if (loadingEl) {
        loadingEl.classList.add('hidden');
        loadingEl.setAttribute('aria-busy', 'false');
      }
      if (errorEl) {
        errorEl.classList.add('hidden');
        errorEl.innerHTML = '';
      }
      console.log('[Main] 初始化成功，共加载 ' + count + ' 个词条');
      return true;
    } catch (err) {
      console.error('[Main] 初始化失败:', err);
      this.status = 'error';
      this.lastError = err;
      if (loadingEl) {
        loadingEl.classList.add('hidden');
        loadingEl.setAttribute('aria-busy', 'false');
      }
      if (window.StateView && errorEl) {
        window.StateView.mount(errorEl, {
          kind: 'error',
          title: '词汇暂时无法显示',
          message: '词库没有准备好。检查本地数据后，可以再次尝试加载。',
          details: err && err.message ? err.message : String(err),
          action: {
            id: 'retry-vocab',
            label: '重试加载',
            icon: 'rotate-ccw',
            onClick: function () { return self.retryInit(); },
          },
        });
      } else if (errorEl) {
        errorEl.textContent = '词汇暂时无法显示';
      }
      if (errorEl) errorEl.classList.remove('hidden');
      if (window.JPLearn && window.JPLearn.events) window.JPLearn.events.emit('app:error', { error: err });
      return false;
    }
  },

  /**
   * 核心调度：根据当前视图模式分派渲染任务
   */
  applyFilters: function () {
    var loadingEl = document.getElementById('loading');
    var errorEl = document.getElementById('error-message');
    var matchInfoEl = document.getElementById('matchInfo');
    var viewMode = window.ViewMode.get();

    if (errorEl) errorEl.classList.add('hidden');

    // 局部图和学习模式不需要显示 loading
    if (viewMode !== 'local' && viewMode !== 'study' && viewMode !== 'cards') {
      if (window.StateView) window.StateView.setLoading(loadingEl, '正在更新词汇', '正在应用筛选条件…');
      if (loadingEl) {
        loadingEl.classList.remove('hidden');
        loadingEl.setAttribute('aria-busy', 'true');
      }
    }

    var self = this;

    // 使用 setTimeout 让 loading 先显示出来；返回 Promise 使首次初始化真正等到数据可用。
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        try {
          var filteredWords;

          // 局部图使用独立渲染路径
          if (viewMode === 'local') {
            filteredWords = self._lastFilteredWords;
            self._renderLocal(filteredWords);
          } else if (viewMode === 'study') {
            // 学习模式：需要筛选数据但不渲染图谱
            filteredWords = window.filterManager.getFilteredWords();
            self._lastFilteredWords = filteredWords;
            self._renderStudy(filteredWords);
          } else if (viewMode === 'cards') {
            // 词卡模式：筛选数据并渲染卡片网格
            filteredWords = window.filterManager.getFilteredWords();
            self._lastFilteredWords = filteredWords;
            self._renderCards(filteredWords);
          } else {
            filteredWords = window.filterManager.getFilteredWords();
            self._lastFilteredWords = filteredWords;
          }

          var renderLimit = window.filterManager.getRenderLimit();

          // 更新筛选信息
          var infoText = '匹配: ' + filteredWords.length + ' 词';
          matchInfoEl.textContent = infoText;
          document.getElementById('statusFiltered').textContent = filteredWords.length;
          var planCountEl = document.getElementById('vocabPlanCount');
          if (planCountEl) planCountEl.textContent = filteredWords.length;

          // 按模式渲染
          switch (viewMode) {
            case 'graph':
              self._renderGraph(filteredWords, renderLimit);
              break;
            case 'list':
              self._renderList(filteredWords);
              break;
            case 'aggregate':
              self._renderAggregate(filteredWords);
              break;
            case 'local':
              // 已在上面处理
              break;
            case 'study':
              // 已在上面处理
              break;
            case 'cards':
              // 已在上面处理
              break;
          }

          if (viewMode !== 'graph' && viewMode !== 'aggregate' && viewMode !== 'local') {
            self._hideGraphEmptyState();
          }

          // 清空详情（非局部图/学习/词卡模式）
          if (viewMode !== 'local' && viewMode !== 'study' && viewMode !== 'cards' && window.detailPanel) {
            window.detailPanel.clear();
          }
        } catch (err) {
          self.lastError = err;
          var failureEl = document.getElementById('error-message');
          if (window.StateView && failureEl) {
            window.StateView.mount(failureEl, {
              kind: 'error',
              title: '筛选结果暂时无法显示',
              message: '这次更新没有完成，保留当前条件后可以重试。',
              details: err && err.message ? err.message : String(err),
              action: {
                id: 'retry-filters',
                label: '重试筛选',
                icon: 'rotate-ccw',
                onClick: function () { return self.applyFilters(); },
              },
            });
            failureEl.classList.remove('hidden');
          }
          resolve(false);
          return;
        } finally {
          if (loadingEl) {
            loadingEl.classList.add('hidden');
            loadingEl.setAttribute('aria-busy', 'false');
          }
        }
        if (errorEl) {
          errorEl.classList.add('hidden');
          errorEl.innerHTML = '';
        }
        resolve(true);
      }, 30);
    });
  },

  /**
   * Catalog heading: scope, count and next actions while the rail is collapsed.
   * Filters and view tools stay in the drawer; the heading only reads their
   * state and opens that drawer instead of duplicating controls.
   */
  renderCatalogHeading: function () {
    var host = document.getElementById('vocabHeading');
    var heading = window.JPLearn && window.JPLearn.pageHeading;
    if (!host || !heading) return;
    var mode = window.ViewMode ? window.ViewMode.get() : '';
    var view = mode === 'list' ? this.listView : mode === 'cards' ? this.cardMode : null;
    if (!view || this.status !== 'ready' || !window.filterManager) {
      heading.hide(host);
      return;
    }
    var self = this;
    var filters = window.filterManager.describeActive();
    var favoritesOnly = !!view.showFavOnly;
    var shown = mode === 'list' ? view.words.length : view.displayWords.length;
    var pageSize = mode === 'list' ? view.pageSize : view.perPage;
    var totalPages = Math.max(1, Math.ceil(shown / (pageSize || 1)));
    var page = Math.min(Math.max(1, view.currentPage || 1), totalPages);
    var title = filters.search
      ? '搜索“' + filters.search + '”'
      : filters.level
        ? 'JLPT ' + filters.level + ' 词汇'
        : favoritesOnly
          ? '收藏的词汇'
          : '全部词汇';
    var meta = [shown.toLocaleString('zh-CN') + ' 词'];
    if (filters.search && filters.level) meta.push('JLPT ' + filters.level);
    meta = meta.concat(filters.details);
    if (favoritesOnly && (filters.search || filters.level)) meta.push('只看收藏');
    var sortLabels = { shuffle: '随机顺序', index: '编号顺序', alpha: '字母顺序', fav: '收藏优先' };
    if (sortLabels[view.sortMode]) meta.push(sortLabels[view.sortMode]);
    if (totalPages > 1) meta.push('第 ' + page + ' / ' + totalPages + ' 页');
    var activeCount = filters.count + (favoritesOnly ? 1 : 0);
    var actions = [];
    if (activeCount) {
      actions.push({
        id: 'clear',
        label: '清除筛选',
        icon: 'rotate-ccw',
        variant: 'quiet',
        title: '清除搜索、等级、词性与收藏筛选，保留当前视图',
      });
    }
    actions.push({
      id: 'tools',
      label: '筛选与视图',
      compactLabel: '筛选',
      icon: 'filter',
      badge: activeCount ? String(activeCount) : '',
      ariaLabel: activeCount ? '打开筛选与视图，当前 ' + activeCount + ' 项筛选' : '打开筛选与视图',
    });
    if (mode === 'cards') {
      var studyCount = Math.min(shown, 20);
      actions.push({
        id: 'study',
        label: studyCount ? '随机学 ' + studyCount + ' 词' : '暂无可学词',
        icon: 'target',
        variant: 'primary',
        disabled: !studyCount,
        title: '从当前结果随机抽取最多 20 词，开始一组有限练习',
      });
    }
    heading.render(
      host,
      {
        variant: mode === 'list' ? 'list' : 'cards',
        title: title,
        meta: meta,
        actions: actions,
      },
      {
        clear: function () {
          self._clearCatalogFilters();
        },
        tools: function (button) {
          self._openCatalogTools(button);
        },
        study: function () {
          if (self.cardMode) self.cardMode.startStudyFromDisplay();
        },
      },
    );
  },

  _clearCatalogFilters: function () {
    if (this.cardMode) this.cardMode.showFavOnly = false;
    if (this.listView) this.listView.showFavOnly = false;
    return window.filterManager ? window.filterManager.clearFilters() : false;
  },

  _openCatalogTools: function (trigger) {
    if (!window.PanelLayout || !window.PanelLayout.openTools) return false;
    return window.PanelLayout.openTools({
      returnFocus: trigger,
      focus: function () {
        return (
          document.querySelector('#vocabLevelChips .vocab-filter-chip.active') ||
          document.getElementById('searchInput')
        );
      },
    });
  },

  _hideGraphEmptyState: function () {
    var emptyEl = document.getElementById('graphEmptyState');
    if (emptyEl) emptyEl.hidden = true;
    var statsEl = document.getElementById('graphStats');
    if (statsEl) statsEl.style.display = '';
  },

  _renderGraphEmptyState: function () {
    var emptyEl = document.getElementById('graphEmptyState');
    if (!emptyEl) return;
    if (window.graphBuilder && window.graphBuilder.cy) window.graphBuilder.cy.elements().remove();
    if (window.StateView) {
      var self = this;
      window.StateView.mount(emptyEl, {
        kind: 'empty',
        title: '当前筛选没有词条',
        message: '换一个关键词或清除筛选，词汇会重新出现在这里。',
        action: {
          id: 'reset-vocab-filters',
          label: '清除筛选',
          icon: 'rotate-ccw',
          onClick: function () {
            if (window.filterManager && window.filterManager.reset) return window.filterManager.reset();
            return false;
          },
        },
      });
    }
    emptyEl.hidden = false;
    var statsEl = document.getElementById('graphStats');
    if (statsEl) statsEl.style.display = 'none';
  },

  // The graph engine loads on first use. Only the latest graph render runs,
  // and only while a graph view is still the current one.
  _withGraph: function (build) {
    var self = this;
    var token = (this._graphRenderToken = (this._graphRenderToken || 0) + 1);
    var current = function () {
      return token === self._graphRenderToken && /^(graph|aggregate|local)$/.test(window.ViewMode.current);
    };
    window.graphBuilder.ready().then(
      function () {
        if (current()) build();
      },
      function (error) {
        if (!current()) return;
        console.warn('[Main] 关系图组件加载失败', error);
        self._renderGraphLoadError(function () {
          self._hideGraphEmptyState();
          self._withGraph(build);
        });
      },
    );
  },

  _renderGraphLoadError: function (retry) {
    var emptyEl = document.getElementById('graphEmptyState');
    if (!emptyEl || !window.StateView) return;
    window.StateView.mount(emptyEl, {
      kind: 'error',
      title: '关系图暂时无法打开',
      message: '关系图组件没有加载成功，请检查网络后重试。',
      action: { id: 'retry-graph', label: '重试', icon: 'rotate-ccw', onClick: retry },
    });
    emptyEl.hidden = false;
  },

  // ─── 渲染路径 ───────────────────────────────────────

  /**
   * 普通图谱渲染
   */
  _renderGraph: function (filteredWords, renderLimit) {
    if (!filteredWords.length) {
      this._renderGraphEmptyState();
      return;
    }
    this._hideGraphEmptyState();
    var mode = window.filterManager.getGraphMode();

    // "自动"模式下的上限决策
    if (renderLimit === 0) {
      if (filteredWords.length > 1000) {
        // 数据量太大，自动切到聚合图
        window.ViewMode.set('aggregate');
        this._renderAggregate(filteredWords);
        return;
      }
      renderLimit = Math.min(filteredWords.length, 500);
    }

    var effectiveLimit = Math.min(renderLimit, filteredWords.length);
    var truncated = filteredWords.length > effectiveLimit;

    document.getElementById('matchInfo').textContent =
      '匹配: ' + filteredWords.length + ' 词' + (truncated ? '（渲染前 ' + effectiveLimit + ' 条）' : '');

    // 4000 警告
    if (effectiveLimit > 2000) {
      console.warn('[Main] 渲染 ' + effectiveLimit + ' 条词条，启用极端性能保护');
    }

    this._withGraph(function () {
      window.graphBuilder.buildGraph(filteredWords, mode, effectiveLimit);
    });
  },

  /**
   * 列表视图渲染
   */
  _renderList: function (filteredWords) {
    this._hideGraphEmptyState();
    this.listView.setData(filteredWords);
    this.listView.render();
    // 列表模式下清空图谱统计
    document.getElementById('statusNodes').textContent = '-';
    document.getElementById('statusEdges').textContent = '-';
  },

  /**
   * 聚合图渲染
   */
  _renderAggregate: function (filteredWords) {
    if (!filteredWords.length) {
      this._renderGraphEmptyState();
      return;
    }
    this._hideGraphEmptyState();
    var mode = window.filterManager.getGraphMode();
    this._withGraph(function () {
      window.graphBuilder.buildAggregateGraph(filteredWords, mode);
    });
  },

  /**
   * 局部图渲染
   */
  _renderLocal: function (filteredWords) {
    if (!filteredWords.length) {
      this._renderGraphEmptyState();
      return;
    }
    this._hideGraphEmptyState();
    var center = window.ViewMode.localCenter;
    if (!center) {
      console.warn('[Main] 局部图缺少中心节点，回退到聚合图');
      window.ViewMode.goBack();
      return;
    }
    var mode = window.filterManager.getGraphMode();
    this._withGraph(function () {
      window.graphBuilder.buildLocalGraph(center, filteredWords, mode);
    });
  },

  /**
   * 学习模式渲染
   */
  _renderStudy: function (filteredWords) {
    this._hideGraphEmptyState();
    this.studyMode.render();
    // 更新状态栏
    document.getElementById('statusNodes').textContent = '-';
    document.getElementById('statusEdges').textContent = '-';
  },

  /**
   * 词卡模式渲染
   */
  _renderCards: function (filteredWords) {
    this._hideGraphEmptyState();
    this.cardMode.setData(filteredWords);
    this.cardMode.render();
    // 更新状态栏
    document.getElementById('statusNodes').textContent = '-';
    document.getElementById('statusEdges').textContent = '-';
  },

  _throttle: function (func, limit) {
    var inThrottle;
    return function () {
      var args = arguments;
      var context = this;
      if (!inThrottle) {
        func.apply(context, args);
        inThrottle = true;
        setTimeout(function () {
          inThrottle = false;
        }, limit);
      }
    };
  },
};

if (window.JPLearn && window.JPLearn.events) {
  window.JPLearn.events.on('vocab:catalog-rendered', function () {
    window.appConfig.renderCatalogHeading();
  });
}
if (window.ViewMode && window.ViewMode.onChange) {
  window.ViewMode.onChange(function () {
    window.appConfig.renderCatalogHeading();
  });
}

document.addEventListener('DOMContentLoaded', async function () {
  window.appConfig.status = 'loading';
  if (window.JPLearn && window.JPLearn.events) window.JPLearn.events.emit('app:loading');
  if (window.ProgressStore) {
    await window.ProgressStore.init();
  }
  var ready = await window.appConfig.init();
  window.JPLearn.events.emit(ready ? 'app:ready' : 'app:error', { error: window.appConfig.lastError });
});
