/**
 * module-switcher.js
 * Top-bar module switcher between vocabulary and grammar modules.
 * Keeps both modules cleanly isolated - switching just shows/hides their DOM.
 *
 * Architecture:
 *   - Vocabulary module: sidebar + vocabMain + anchored detailPanel
 *   - Grammar module:    grammarSidebar + grammarMain + anchored grammarDetailPanel
 *   - Classics module:   classicsSidebar + classicsMain, local copies only
 *
 * Grammar, textbook and classics modules are lazy-initialized on first switch.
 * The classics are reading material outside the study record: they never
 * become navigation.lastModule and keep their places in their own preference.
 */
var ModuleSwitcher = (function () {
  var currentModule = 'dashboard';
  var grammarModule = null;
  var grammarInitialized = false;
  var textbookModule = null;
  var textbookInitialized = false;
  var classicsModule = null;
  var classicsReady = Promise.resolve(false);
  var navigation = {
    version: 1,
    lastModule: '',
    vocab: {},
    grammar: {},
    textbook: {},
  };
  var navigationLoaded = false;

  // DOM references
  var els = {};

  function init() {
    if (window.ProgressStore && window.ProgressStore.getNavigation) {
      navigation = window.ProgressStore.getNavigation();
    }
    // Cache DOM refs
    els.dashboardMain = document.getElementById('dashboardMain');
    els.vocabSidebar = document.getElementById('sidebar');
    els.vocabMain = document.getElementById('vocabMain');
    els.vocabDetail = document.getElementById('detailPanel');
    els.grammarSidebar = document.getElementById('grammarSidebar');
    els.grammarMain = document.getElementById('grammarMain');
    els.grammarDetail = document.getElementById('grammarDetailPanel');
    els.textbookSidebar = document.getElementById('textbookSidebar');
    els.textbookMain = document.getElementById('textbookMain');
    els.textbookDetail = document.getElementById('textbookDetailPanel');
    els.classicsSidebar = document.getElementById('classicsSidebar');
    els.classicsMain = document.getElementById('classicsMain');
    els.modBtnDashboard = document.getElementById('modBtnDashboard');
    els.modBtnVocab = document.getElementById('modBtnVocab');
    els.modBtnGrammar = document.getElementById('modBtnGrammar');
    els.modBtnLesson = document.getElementById('modBtnLesson');
    els.appBrandHome = document.getElementById('appBrandHome');
    els.appHeaderLocation = document.getElementById('appHeaderLocation');
    els.vocabStatus = document.getElementById('vocabStatusGroup');
    els.grammarStatus = document.getElementById('grammarStatusGroup');
    els.textbookStatus = document.getElementById('textbookStatusGroup');
    els.classicsStatus = document.getElementById('classicsStatusGroup');
    els.statusViewMode = document.getElementById('statusViewMode');
    els.backToOverviewBtn = document.getElementById('backToOverviewBtn');
    els.statusGView = document.getElementById('statusGrammarView');
    els.gmLoading = document.getElementById('gmLoading');
    els.grammarTotalBadge = document.getElementById('grammarTotalBadge');
    els.statusGTotal = document.getElementById('statusGrammarTotal');
    els.statusLessons = document.getElementById('statusLessons');
    els.statusTbBook = document.getElementById('statusTextbookBook');
    els.statusTbLesson = document.getElementById('statusTextbookLesson');
    els.statusTbVocab = document.getElementById('statusTextbookVocab');
    els.statusTbGrammar = document.getElementById('statusTextbookGrammar');
    els.statusClBook = document.getElementById('statusClassicsBook');
    els.statusClPart = document.getElementById('statusClassicsPart');
    els.resizeVocab = document.getElementById('resizeHandleVocab');
    els.resizeGrammar = document.getElementById('resizeHandleGrammar');
    els.resizeTextbook = document.getElementById('resizeHandleTextbook');
    els.resizeSidebarVocab = document.getElementById('resizeSidebarVocab');
    els.resizeSidebarGrammar = document.getElementById('resizeSidebarGrammar');
    els.resizeSidebarTextbook = document.getElementById('resizeSidebarTextbook');
    els.resizeSidebarClassics = document.getElementById('resizeSidebarClassics');

    // Bind buttons
    if (els.modBtnDashboard) {
      els.modBtnDashboard.addEventListener('click', function () {
        switchTo('dashboard');
      });
    }
    if (els.modBtnVocab) {
      els.modBtnVocab.addEventListener('click', function () {
        switchTo('vocab');
      });
    }
    if (els.modBtnGrammar) {
      els.modBtnGrammar.addEventListener('click', function () {
        switchTo('grammar');
      });
    }
    if (els.modBtnLesson) {
      els.modBtnLesson.addEventListener('click', function () {
        switchTo('lesson');
      });
    }
    if (els.appBrandHome) {
      els.appBrandHome.addEventListener('click', function () {
        switchTo('dashboard');
      });
    }
    classicsReady = _offerClassics();
    _showDashboard();
  }

  // Copies with the classics library get a fifth module button, inserted once
  // the catalog loads; the public package and copies without data keep four.
  function _offerClassics() {
    var library = window.JPLearn.classics;
    if (!library) return Promise.resolve(false);
    return library.getCatalog().then(function (catalog) {
      var template = document.getElementById('modBtnClassicsTemplate');
      if (!catalog || !template) return false;
      if (!els.modBtnClassics) {
        template.parentNode.appendChild(template.content.cloneNode(true));
        els.modBtnClassics = document.getElementById('modBtnClassics');
        els.modBtnClassics.addEventListener('click', function () {
          switchTo('classics');
        });
      }
      return true;
    });
  }

  // Resolves false when this copy has no classics.
  function openClassics() {
    return classicsReady.then(function (ready) {
      if (!ready) return false;
      return switchTo('classics').then(function () {
        return true;
      });
    });
  }

  function switchTo(mod) {
    if (mod === currentModule) return Promise.resolve();
    if (mod === 'classics' && !els.modBtnClassics) return Promise.resolve();
    if (window.JPLearn.anchoredDetail) {
      window.JPLearn.anchoredDetail.close(window.JPLearn.anchoredDetail.getActiveModule(), false);
    }
    _persistCurrentNavigation();
    currentModule = mod;

    var result;
    if (mod === 'dashboard') {
      result = _showDashboard();
    } else if (mod === 'vocab') {
      result = _showVocab();
    } else if (mod === 'grammar') {
      result = _showGrammar();
    } else if (mod === 'lesson') {
      result = _showLesson();
    } else if (mod === 'classics') {
      result = _showClassics();
    }
    return Promise.resolve(result).then(function () {
      if (mod !== 'dashboard' && mod !== 'classics') {
        navigation.lastModule = mod;
        _persistCurrentNavigation();
      }
    });
  }

  function _showDashboard() {
    _setActive('dashboard');
    _show(els.dashboardMain);
    _hide(els.vocabSidebar);
    _hide(els.vocabMain);
    _hide(els.vocabDetail);
    _hide(els.vocabStatus);
    _hide(els.resizeVocab);
    _hide(els.resizeSidebarVocab);
    _hide(els.grammarSidebar);
    _hide(els.grammarMain);
    _hide(els.grammarDetail);
    _hide(els.grammarStatus);
    _hide(els.resizeGrammar);
    _hide(els.resizeSidebarGrammar);
    _hide(els.textbookSidebar);
    _hide(els.textbookMain);
    _hide(els.textbookDetail);
    _hide(els.textbookStatus);
    _hide(els.resizeTextbook);
    _hide(els.resizeSidebarTextbook);
    _hideClassics();
    if (grammarModule) grammarModule.deactivate();
    if (textbookModule) textbookModule.deactivate();
    if (window.Dashboard) window.Dashboard.activate();
    if (els.statusViewMode) els.statusViewMode.textContent = '今日学习';
    if (els.backToOverviewBtn) els.backToOverviewBtn.style.display = 'none';
  }

  function _showVocab() {
    // Update buttons
    _setActive('vocab');
    _hide(els.dashboardMain);
    if (window.Dashboard) window.Dashboard.deactivate();
    // Show vocab UI
    _show(els.vocabSidebar);
    _show(els.vocabMain);
    _show(els.vocabDetail);
    _show(els.vocabStatus);
    _show(els.resizeVocab);
    _show(els.resizeSidebarVocab);
    // Hide grammar UI
    _hide(els.grammarSidebar);
    _hide(els.grammarMain);
    _hide(els.grammarDetail);
    _hide(els.grammarStatus);
    _hide(els.resizeGrammar);
    _hide(els.resizeSidebarGrammar);
    _hide(els.textbookSidebar);
    _hide(els.textbookMain);
    _hide(els.textbookDetail);
    _hide(els.textbookStatus);
    _hide(els.resizeTextbook);
    _hide(els.resizeSidebarTextbook);
    _hideClassics();
    // Deactivate grammar module
    if (grammarModule) grammarModule.deactivate();
    if (textbookModule) textbookModule.deactivate();
    if (els.backToOverviewBtn) els.backToOverviewBtn.style.display = 'none';
    // Update view mode label
    if (els.statusViewMode) {
      var vm = window.ViewMode ? window.ViewMode.get() : 'aggregate';
      els.statusViewMode.textContent = _viewLabel(vm);
    }
  }

  function _showGrammar() {
    // Update buttons
    _setActive('grammar');
    _hide(els.dashboardMain);
    if (window.Dashboard) window.Dashboard.deactivate();
    // Show grammar UI
    _show(els.grammarSidebar);
    _show(els.grammarMain);
    _show(els.grammarDetail);
    _show(els.grammarStatus);
    _show(els.resizeGrammar);
    _show(els.resizeSidebarGrammar);
    // Hide vocab UI
    _hide(els.vocabSidebar);
    _hide(els.vocabMain);
    _hide(els.vocabDetail);
    _hide(els.vocabStatus);
    _hide(els.resizeVocab);
    _hide(els.resizeSidebarVocab);
    _hide(els.textbookSidebar);
    _hide(els.textbookMain);
    _hide(els.textbookDetail);
    _hide(els.textbookStatus);
    _hide(els.resizeTextbook);
    _hide(els.resizeSidebarTextbook);
    _hideClassics();
    // Update view mode label
    if (els.statusViewMode) els.statusViewMode.textContent = '语法模式';
    if (els.backToOverviewBtn) els.backToOverviewBtn.style.display = 'none';
    if (textbookModule) textbookModule.deactivate();

    // Initialize grammar module on first use
    if (!grammarInitialized) {
      return _initGrammarModule();
    } else {
      return grammarModule.activate();
    }
  }

  function _showLesson() {
    _setActive('lesson');
    _hide(els.dashboardMain);
    if (window.Dashboard) window.Dashboard.deactivate();
    _show(els.textbookSidebar);
    _show(els.textbookMain);
    _show(els.textbookDetail);
    _show(els.textbookStatus);
    _show(els.resizeTextbook);
    _show(els.resizeSidebarTextbook);

    _hide(els.vocabSidebar);
    _hide(els.vocabMain);
    _hide(els.vocabDetail);
    _hide(els.vocabStatus);
    _hide(els.resizeVocab);
    _hide(els.resizeSidebarVocab);
    _hide(els.grammarSidebar);
    _hide(els.grammarMain);
    _hide(els.grammarDetail);
    _hide(els.grammarStatus);
    _hide(els.resizeGrammar);
    _hide(els.resizeSidebarGrammar);
    _hideClassics();

    if (grammarModule) grammarModule.deactivate();
    if (els.statusViewMode) els.statusViewMode.textContent = '课文阅读';
    if (els.backToOverviewBtn) els.backToOverviewBtn.style.display = 'none';

    if (!textbookInitialized) {
      return _initTextbookModule();
    } else {
      return textbookModule.activate();
    }
  }

  function _showClassics() {
    _setActive('classics');
    _hide(els.dashboardMain);
    if (window.Dashboard) window.Dashboard.deactivate();
    _show(els.classicsSidebar);
    _show(els.classicsMain);
    _show(els.classicsStatus);
    _show(els.resizeSidebarClassics);

    _hide(els.vocabSidebar);
    _hide(els.vocabMain);
    _hide(els.vocabDetail);
    _hide(els.vocabStatus);
    _hide(els.resizeVocab);
    _hide(els.resizeSidebarVocab);
    _hide(els.grammarSidebar);
    _hide(els.grammarMain);
    _hide(els.grammarDetail);
    _hide(els.grammarStatus);
    _hide(els.resizeGrammar);
    _hide(els.resizeSidebarGrammar);
    _hide(els.textbookSidebar);
    _hide(els.textbookMain);
    _hide(els.textbookDetail);
    _hide(els.textbookStatus);
    _hide(els.resizeTextbook);
    _hide(els.resizeSidebarTextbook);

    if (grammarModule) grammarModule.deactivate();
    if (textbookModule) textbookModule.deactivate();
    if (els.statusViewMode) els.statusViewMode.textContent = '古典阅读';
    if (els.backToOverviewBtn) els.backToOverviewBtn.style.display = 'none';

    if (!classicsModule)
      classicsModule = new window.JPLearn.ClassicsModule({
        sidebarContentId: 'clSidebarContent',
        readerId: 'clReader',
        loadingId: 'clLoading',
        badgeId: 'classicsWorkCountBadge',
      });
    return classicsModule.activate();
  }

  function _hideClassics() {
    // Capture scroll geometry before the reader becomes hidden.
    if (classicsModule) classicsModule.deactivate();
    _hide(els.classicsSidebar);
    _hide(els.classicsMain);
    _hide(els.classicsStatus);
    _hide(els.resizeSidebarClassics);
  }

  function _initGrammarModule() {
    _showGmLoading('初始化语法模块...');

    grammarModule = new GrammarModule({
      mainContainerId: 'grammarMain',
      detailContainerId: 'gmDetailContent',
      grammarListId: 'gmGrammarList',
      lessonListId: 'gmLessonList',
      lessonReaderId: 'gmLessonReader',
      sidebarContentId: 'gmSidebarContent',
    });

    return grammarModule
      .activate()
      .then(function () {
        grammarInitialized = true;
        _hideGmLoading();
        _updateGrammarStats();
        return true;
      })
      .catch(function (err) {
        grammarInitialized = false;
        console.error('[ModuleSwitcher] Grammar init failed:', err);
        // Keep the grammar shell and its sub-view containers intact so a retry
        // can reuse the same DOM references.  Mounting into grammarMain would
        // replace #gmGrammarList/#gmLessonList/#gmLessonReader and make the
        // next initialization impossible.
        var el = els.gmLoading || document.getElementById('gmLoading');
        if (window.StateView && el) {
          window.StateView.mount(el, {
            kind: 'error',
            title: '语法暂时无法加载',
            message: '语法列表没有准备好，可以重试；词汇和课文不受影响。',
            details: err && err.message,
            action: {
              id: 'retry-grammar-module',
              label: '重试语法',
              icon: 'rotate-ccw',
              onClick: function () {
                if (window.GrammarLoader && GrammarLoader.reset) GrammarLoader.reset('all');
                return _initGrammarModule();
              },
            },
          });
          el.classList.remove('hidden');
          el.setAttribute('aria-busy', 'false');
        } else if (el) {
          el.classList.remove('hidden');
          el.innerHTML = '<div class="gm-error">语法模块加载失败</div>';
        }
        return false;
      });
  }

  function _initTextbookModule() {
    textbookModule = new TextbookModule({
      sidebarContentId: 'tbSidebarContent',
      readerId: 'tbReader',
      detailId: 'tbDetailContent',
      loadingId: 'tbLoading',
      loadingDetailId: 'tbLoadingDetail',
      lessonCountBadgeId: 'textbookLessonCountBadge',
      defaultBookId: window.JPLearn.textbooks.defaultBookId(),
    });

    return textbookModule
      .activate()
      .then(function () {
        textbookInitialized = true;
        return true;
      })
      .catch(function (err) {
        textbookInitialized = false;
        console.error('[ModuleSwitcher] Textbook init failed:', err);
        var el = document.getElementById('tbReader');
        if (el && !el.querySelector('.state-view')) {
          if (window.StateView) {
            window.StateView.mount(el, {
              kind: 'error',
              title: '课文暂时无法加载',
              message: '教材内容没有准备好，可以重试；已有学习进度不会丢失。',
              details: err && err.message,
              action: {
                id: 'retry-textbook-module',
                label: '重试课文',
                icon: 'rotate-ccw',
                onClick: function () {
                  return _initTextbookModule();
                },
              },
            });
          } else {
            el.innerHTML = '<div class="tb-reader-error">课文模块加载失败</div>';
          }
        }
        return false;
      });
  }

  function _updateGrammarStats() {
    GrammarLoader.getIndex().then(function (idx) {
      var total = idx ? idx.length : 0;
      if (els.statusGTotal) els.statusGTotal.textContent = total;
      if (els.grammarTotalBadge) els.grammarTotalBadge.textContent = total + ' 条';
    });
    GrammarLoader.getLessons().then(function (lessons) {
      var cnt = lessons ? lessons.length : 0;
      if (els.statusLessons) els.statusLessons.textContent = cnt;
    });
  }

  function _showGmLoading(msg) {
    var el = els.gmLoading;
    if (!el) return;
    if (window.StateView) {
      window.StateView.mount(el, {
        kind: 'loading',
        title: msg || '正在加载语法',
        message: '正在读取语法索引与辅助课文…',
      });
    } else {
      var span = el.querySelector('span');
      if (span) span.textContent = msg || '加载中...';
    }
    el.classList.remove('hidden');
    el.setAttribute('aria-busy', 'true');
  }

  function _hideGmLoading() {
    var el = els.gmLoading;
    if (el) {
      el.classList.add('hidden');
      el.setAttribute('aria-busy', 'false');
    }
  }

  function _setActive(mod) {
    var buttons = {
      dashboard: els.modBtnDashboard,
      lesson: els.modBtnLesson,
      grammar: els.modBtnGrammar,
      vocab: els.modBtnVocab,
      classics: els.modBtnClassics,
    };
    var labels = {
      dashboard: '今日学习',
      lesson: '课文阅读',
      grammar: '语法学习',
      vocab: '词汇学习',
      classics: '古典阅读',
    };
    Object.keys(buttons).forEach(function (key) {
      var button = buttons[key];
      if (!button) return;
      var active = key === mod;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    if (els.appHeaderLocation) els.appHeaderLocation.textContent = labels[mod] || labels.dashboard;
    if (window.JPLearn.sitePages) window.JPLearn.sitePages.activate(mod);
  }

  function _show(el) {
    if (el) el.style.display = '';
  }
  function _hide(el) {
    if (el) el.style.display = 'none';
  }

  function _viewLabel(vm) {
    var map = {
      aggregate: '聚合图',
      graph: '普通图谱',
      list: '列表',
      cards: '词卡',
      study: '学习',
      local: '局部图',
    };
    return map[vm] || vm;
  }

  // Expose for grammar module to update status bar
  function setGrammarSubView(label) {
    if (els.statusGView) els.statusGView.textContent = label;
  }

  function setTextbookStatus(state) {
    state = state || {};
    if (els.statusTbBook) els.statusTbBook.textContent = state.bookLabel || '-';
    if (els.statusTbLesson) els.statusTbLesson.textContent = state.lessonLabel || '-';
    if (els.statusTbVocab) els.statusTbVocab.textContent = state.vocabCount || 0;
    if (els.statusTbGrammar) els.statusTbGrammar.textContent = state.grammarCount || 0;
  }

  function setClassicsStatus(state) {
    state = state || {};
    if (els.statusClBook) els.statusClBook.textContent = state.book || '-';
    if (els.statusClPart) els.statusClPart.textContent = state.part || '-';
  }

  function openGrammarFromTextbook(context) {
    context = context && typeof context === 'object' ? context : {};
    return switchTo('grammar').then(function () {
      if (grammarModule && grammarModule.showCourseContext) return grammarModule.showCourseContext(context);
      return false;
    });
  }

  function returnToTextbook(context, options) {
    context = context && typeof context === 'object' ? context : {};
    var returningGrammarContext = grammarModule && grammarModule.courseContext;
    var completesReview =
      options &&
      options.completedReview === true &&
      context.kind === 'textbook-course' &&
      context.courseStep === 'review';
    var completesGrammar =
      context.kind === 'textbook-course' && context.courseStep === 'grammar' && !!context.viewedUid;
    return switchTo('lesson').then(function () {
      if (!textbookModule || !textbookModule.restoreReadingContext) return false;
      var targetModule = textbookModule;
      var bookId = context.bookId || targetModule.currentBookId;
      var lessonId = context.lessonId || targetModule.currentLessonId;
      var result = targetModule.restoreReadingContext(context);
      return Promise.resolve(result).then(function (value) {
        if (
          value !== true ||
          currentModule !== 'lesson' ||
          textbookModule !== targetModule ||
          targetModule.currentBookId !== bookId ||
          targetModule.currentLessonId !== lessonId
        )
          return false;
        if ((completesGrammar || completesReview) && textbookModule && textbookModule.markCourseStep) {
          textbookModule.markCourseStep(completesGrammar ? 'grammar' : 'review', 'done');
        }
        if (
          returningGrammarContext &&
          returningGrammarContext.bookId === bookId &&
          returningGrammarContext.lessonId === lessonId &&
          grammarModule &&
          grammarModule.courseContext === returningGrammarContext &&
          grammarModule.clearCourseContext
        )
          grammarModule.clearCourseContext();
        _persistCurrentNavigation();
        return value;
      });
    });
  }

  function openGrammarResult(uid) {
    uid = typeof uid === 'string' ? uid : '';
    return switchTo('grammar').then(function () {
      if (!uid || !grammarModule || !grammarModule.navigateToGrammar) return false;
      grammarModule.navigateToGrammar(uid);
      return true;
    });
  }

  function openPlannedLesson(plan) {
    plan = plan && typeof plan === 'object' ? plan : {};
    return switchTo('lesson').then(function () {
      if (!textbookModule || !textbookModule.restoreReadingContext) return false;
      return textbookModule.restoreReadingContext({
        bookId: typeof plan.bookId === 'string' ? plan.bookId : '',
        lessonId: typeof plan.lessonId === 'string' ? plan.lessonId : '',
        readerScrollTop: 0,
      });
    });
  }

  function completeTextbookCourseStep(source) {
    if (!source || source.kind !== 'textbook-course' || !textbookModule || !textbookModule.markCourseStep)
      return false;
    if (source.bookId && textbookModule.currentBookId !== source.bookId) return false;
    if (source.lessonId && textbookModule.currentLessonId !== source.lessonId) return false;
    return textbookModule.markCourseStep(source.courseStep || 'review', 'done');
  }

  function setCourseStudyContext(source) {
    if (!source || source.kind !== 'textbook-course') return false;
    _syncLoadedNavigation();
    // The recoverable page is the textbook lesson, even while the active
    // practice UI lives in the vocabulary module.
    navigation.lastModule = 'lesson';
    _persistCurrentNavigation();
    return true;
  }

  // init() runs before ProgressStore has loaded, so its copy holds defaults.
  // Take the loaded navigation before the first write; otherwise the first
  // switch replaces the saved places of modules not opened yet.
  function _syncLoadedNavigation() {
    if (navigationLoaded || !window.ProgressStore || !window.ProgressStore.getState) return;
    if (!window.ProgressStore.getState()) return;
    navigationLoaded = true;
    navigation = window.ProgressStore.getNavigation();
  }

  function exportNavigation() {
    _syncLoadedNavigation();
    if (window.appConfig && window.appConfig.exportNavigation) {
      navigation.vocab = window.appConfig.exportNavigation();
    }
    if (grammarInitialized && grammarModule && grammarModule.exportNavigation) {
      navigation.grammar = grammarModule.exportNavigation();
    }
    if (textbookInitialized && textbookModule && textbookModule.exportNavigation) {
      navigation.textbook = textbookModule.exportNavigation();
    }
    return {
      version: 1,
      lastModule: navigation.lastModule || '',
      vocab: navigation.vocab || {},
      grammar: navigation.grammar || {},
      textbook: navigation.textbook || {},
    };
  }

  function _persistCurrentNavigation() {
    _syncLoadedNavigation();
    if (currentModule !== 'dashboard' && currentModule !== 'classics') navigation.lastModule = currentModule;
    navigation = exportNavigation();
    if (window.ProgressStore && window.ProgressStore.updateNavigation) {
      window.ProgressStore.updateNavigation(navigation);
    }
  }

  function resume(savedNavigation) {
    var target = savedNavigation && savedNavigation.lastModule;
    if (target !== 'vocab' && target !== 'grammar' && target !== 'lesson') return Promise.resolve(false);
    var targetState =
      target === 'lesson'
        ? savedNavigation.textbook
        : target === 'grammar'
          ? savedNavigation.grammar
          : savedNavigation.vocab;
    navigation = savedNavigation;
    navigationLoaded = true;
    return switchTo(target).then(function () {
      var restore;
      if (target === 'vocab') restore = window.appConfig.restoreNavigation(targetState);
      if (target === 'grammar' && grammarModule) restore = grammarModule.restoreNavigation(targetState);
      if (target === 'lesson' && textbookModule) restore = textbookModule.restoreNavigation(targetState);
      return Promise.resolve(restore).then(function () {
        _persistCurrentNavigation();
        return true;
      });
    });
  }

  // DOMContentLoaded bootstrap
  document.addEventListener('DOMContentLoaded', function () {
    init();
  });

  return {
    switchTo: switchTo,
    setGrammarSubView: setGrammarSubView,
    setTextbookStatus: setTextbookStatus,
    setClassicsStatus: setClassicsStatus,
    openClassics: openClassics,
    openGrammarFromTextbook: openGrammarFromTextbook,
    openGrammarResult: openGrammarResult,
    returnToTextbook: returnToTextbook,
    openPlannedLesson: openPlannedLesson,
    completeTextbookCourseStep: completeTextbookCourseStep,
    setCourseStudyContext: setCourseStudyContext,
    exportNavigation: exportNavigation,
    resume: resume,
    updateGrammarStats: _updateGrammarStats,
    getTextbookModule: function () {
      return textbookModule;
    },
    getClassicsModule: function () {
      return classicsModule;
    },
    getCurrentModule: function () {
      return currentModule;
    },
  };
})();
