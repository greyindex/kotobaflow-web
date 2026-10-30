function TextbookModule(opts) {
  this.sidebarContentEl = document.getElementById(opts.sidebarContentId);
  this.readerEl = document.getElementById(opts.readerId);
  this.detailEl = document.getElementById(opts.detailId);
  this.loadingEl = document.getElementById(opts.loadingId);
  this.loadingDetailEl = document.getElementById(opts.loadingDetailId);
  this.lessonCountBadgeEl = document.getElementById(opts.lessonCountBadgeId);
  this.defaultBookId = opts.defaultBookId || window.JPLearn.textbooks.defaultBookId();
  this.currentBookId = this.defaultBookId;
  this.currentLessonId = null;
  this._bookLoadId = 0;
  this._lessonLoadId = 0;
  this.books = [];
  this.bookIndex = null;
  this.currentLesson = null;
  this.currentVocab = [];
  this.currentGrammar = [];
  this.currentTextChunks = [];
  this.currentWikiReading = null;
  this.textDisplayMode = 'normal';
  this.showTranslations = true;
  // Device preference: lesson illustrations can be hidden, and are then not
  // downloaded. Teaching charts such as the kana table always show.
  this.showImages = true;
  try {
    this.showImages = localStorage.getItem('jp_learning_textbook_images_v1') !== 'hidden';
  } catch (error) {
    /* storage unavailable: keep the default */
  }
  this.currentInlineGrammarCount = 0;
  this._highlightEntries = [];
  this._highlightCacheKey = '';
  this._visitedLessonIds = {};
  this.coursePath = null;
  this._coursePathManuallyCollapsed = true;
  this._courseOtherExpanded = false;
  this._pendingReaderScrollTop = null;
  this._courseActionBusy = false;
  this._lastTtsActiveVocabIndex = -1;
  this.initialized = false;
  this.vocabLoopRepeatCount = 2;
  this.vocabLoopDelayMs = 1000;
  this.ttsState = {
    loading: false,
    mode: '',
    lastMode: '',
    audio: null,
    objectUrl: '',
    timerId: 0,
    abortController: null,
    segments: [],
    segmentIndex: 0,
    activeVocabIndex: -1,
    loopCursor: 0,
    loopRepeat: 0,
    statusText: '',
  };
}

TextbookModule.prototype = Object.assign(
  {},
  window.JPLearn.textbookImageMethods,
  window.JPLearn.textbookTextMethods,
  window.JPLearn.textbookAudioMethods,
  window.JPLearn.textbookVocabMethods,
  window.JPLearn.textbookCurriculumMethods,
  window.JPLearn.textbookBookViewMethods,
  {
    activate: function () {
      if (this.initialized) {
        this._renderSidebar();
        this._renderSelection();
        this._updateStatus();
        return Promise.resolve();
      }
      return this._initialize();
    },

    deactivate: function () {
      this._stopTtsPlayback();
      this._closeChunkDetail(false);
    },

    exportNavigation: function () {
      return {
        bookId: this.currentBookId || this.defaultBookId,
        lessonId: this.currentLessonId || '',
        displayMode: this.textDisplayMode || 'normal',
        readerScrollTop: this.readerEl ? Math.max(0, Number(this.readerEl.scrollTop) || 0) : 0,
        bookAnchor: this._exportBookAnchor(),
        coursePath: this._normalizeCoursePath(this.coursePath),
      };
    },

    restoreNavigation: function (state) {
      state = state && typeof state === 'object' ? state : {};
      this.textDisplayMode =
        state.displayMode === 'chunks' || state.displayMode === 'plain' ? state.displayMode : 'normal';
      this._pendingReaderScrollTop = Math.max(0, Number(state.readerScrollTop) || 0);
      this.coursePath = this._normalizeCoursePath(state.coursePath);
      var requestedBook = typeof state.bookId === 'string' ? state.bookId : '';
      var bookId = this.defaultBookId;
      for (var i = 0; i < this.books.length; i++) {
        if (this.books[i].id === requestedBook) bookId = requestedBook;
      }
      var self = this;
      var loadBook = bookId === this.currentBookId ? Promise.resolve(true) : this._loadBook(bookId);
      var requestId = ++this._lessonLoadId;
      return loadBook.then(function (loaded) {
        if (!loaded || self.currentBookId !== bookId || self._lessonLoadId !== requestId) return false;
        var lessons = (self.bookIndex && self.bookIndex.lessons) || [];
        var lessonId = '';
        for (var j = 0; j < lessons.length; j++) {
          if (lessons[j].lesson_id === state.lessonId) lessonId = state.lessonId;
        }
        if (!lessonId && lessons.length) lessonId = lessons[0].lesson_id;
        self._bookAnchor = self._normalizeBookAnchor(state.bookAnchor, bookId + '/' + lessonId);
        self._bookRestoreAnchor = self._bookAnchor;
        self._bookPendingLast = false;
        return lessonId ? self.showLesson(lessonId) : Promise.resolve();
      });
    },

    _createCoursePath: function (lessonId) {
      var now = new Date().toISOString();
      return {
        version: 1,
        bookId: this.currentBookId || this.defaultBookId,
        lessonId: String(lessonId || ''),
        lessonLabel: '',
        title: '',
        currentStep: 'vocab',
        steps: { vocab: 'todo', reading: 'todo', grammar: 'todo', review: 'todo' },
        completed: false,
        startedAt: now,
        completedAt: '',
      };
    },

    _normalizeCoursePath: function (raw) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      var path = this._createCoursePath(raw.lessonId || '');
      path.bookId =
        typeof raw.bookId === 'string' && raw.bookId ? raw.bookId : this.currentBookId || this.defaultBookId;
      path.lessonId = typeof raw.lessonId === 'string' ? raw.lessonId : String(raw.lessonId || '');
      path.lessonLabel = this._cleanValue(raw.lessonLabel);
      path.title = this._cleanValue(raw.title);
      path.startedAt = this._cleanValue(raw.startedAt) || path.startedAt;
      path.completedAt = this._cleanValue(raw.completedAt);
      path.completed = raw.completed === true;
      var allowed = { todo: true, active: true, done: true, skipped: true };
      var sourceSteps = raw.steps && typeof raw.steps === 'object' ? raw.steps : {};
      var keys = ['vocab', 'reading', 'grammar', 'review'];
      for (var i = 0; i < keys.length; i++) {
        var value = sourceSteps[keys[i]];
        path.steps[keys[i]] = allowed[value] ? value : 'todo';
      }
      if (path.completed && !this._courseProgress(path).ready) {
        path.completed = false;
        path.completedAt = '';
      }
      path.currentStep =
        typeof raw.currentStep === 'string' && keys.indexOf(raw.currentStep) !== -1
          ? raw.currentStep
          : 'vocab';
      this._syncCoursePathCursor(path);
      return path;
    },

    _syncCoursePathCursor: function (path) {
      if (!path) return;
      if (path.completed) {
        path.currentStep = '';
        return;
      }
      var keys = ['vocab', 'reading', 'grammar', 'review'];
      for (var i = 0; i < keys.length; i++) {
        if (path.steps[keys[i]] !== 'done' && path.steps[keys[i]] !== 'skipped') {
          path.currentStep = keys[i];
          return;
        }
      }
      path.currentStep = '';
    },

    _ensureCoursePath: function () {
      var sameLesson =
        this.coursePath &&
        this.coursePath.bookId === (this.currentBookId || this.defaultBookId) &&
        this.coursePath.lessonId === String(this.currentLessonId || '');
      if (!sameLesson) this.coursePath = this._createCoursePath(this.currentLessonId);
      else {
        if (this.coursePath.completed && !this._courseProgress(this.coursePath).ready) {
          this.coursePath.completed = false;
          this.coursePath.completedAt = '';
        }
        this._syncCoursePathCursor(this.coursePath);
      }
      return this.coursePath;
    },

    _updateCoursePathMeta: function () {
      var path = this._ensureCoursePath();
      var lesson = this.currentLesson && this.currentLesson.lesson;
      var meta =
        this._adjacentLessons().current || (this.currentLesson && this.currentLesson.meta) || lesson || {};
      path.bookId = this.currentBookId || this.defaultBookId;
      path.lessonId = String(this.currentLessonId || '');
      path.lessonLabel = this._cleanValue(this._buildLessonLabel(meta));
      path.title = this._cleanValue((lesson && lesson.title) || meta.title || this.currentLessonId);
      return path;
    },

    _courseProgress: function (path) {
      var keys = ['vocab', 'reading', 'grammar', 'review'];
      var complete = 0;
      for (var i = 0; i < keys.length; i++) {
        if (path && (path.steps[keys[i]] === 'done' || path.steps[keys[i]] === 'skipped')) complete++;
      }
      return { complete: complete, total: keys.length, ready: complete === keys.length };
    },

    _persistCourseNavigation: function () {
      if (
        window.ProgressStore &&
        window.ProgressStore.updateNavigation &&
        window.ModuleSwitcher &&
        window.ModuleSwitcher.exportNavigation
      ) {
        window.ProgressStore.updateNavigation(window.ModuleSwitcher.exportNavigation());
      } else if (window.ProgressStore && window.ProgressStore.queueSave) {
        window.ProgressStore.queueSave(0);
      }
    },

    _initialize: function () {
      var self = this;
      this._showLoading('正在初始化课文模块...');
      this._setReaderPlaceholder('课文模块初始化中...');
      this._setDetailPlaceholder('正在准备本课词汇...');
      return TextbookLoader.getBooks()
        .then(function (books) {
          self.books = books || [];
          return self._loadBook(self.currentBookId);
        })
        .then(function (loaded) {
          if (!loaded) return false;
          self.initialized = true;
          self._hideLoading();
          return self._openInitialLesson();
        })
        .catch(function (err) {
          self._hideLoading();
          self._setReaderError(
            '课文模块初始化失败',
            function () {
              return self._initialize();
            },
            err,
          );
          self._setDetailPlaceholder('课文模块初始化失败');
          throw err;
        });
    },

    _loadBook: function (bookId) {
      var self = this;
      var requestId = ++this._bookLoadId;
      this._lessonLoadId++;
      this._stopTtsPlayback();
      this.currentBookId = bookId;
      this.bookIndex = null;
      this.currentLessonId = null;
      this.currentLesson = null;
      this._showLoading('正在加载教材目录...');
      return TextbookLoader.getBookIndex(bookId)
        .then(function (index) {
          if (requestId !== self._bookLoadId || self.currentBookId !== bookId) return false;
          self.bookIndex = index || { lessons: [] };
          self._renderSidebar();
          if (self.lessonCountBadgeEl)
            self.lessonCountBadgeEl.textContent = ((self.bookIndex.lessons || []).length || 0) + ' 单元';
          self._hideLoading();
          self._updateStatus();
          return true;
        })
        .catch(function (err) {
          if (requestId !== self._bookLoadId || self.currentBookId !== bookId) return false;
          self._hideLoading();
          self._setReaderError(
            '教材目录加载失败',
            function () {
              return self._loadBook(bookId).then(function (loaded) {
                // Retry bypasses _initialize; keep the selected lesson on reactivation.
                if (loaded) self.initialized = true;
                return loaded && self._openInitialLesson();
              });
            },
            err,
          );
          return false;
        });
    },

    _openInitialLesson: function () {
      var lessons = (this.bookIndex && this.bookIndex.lessons) || [];
      if (!lessons.length) {
        this._setReaderPlaceholder('当前教材没有可用课文');
        this._setDetailPlaceholder('当前教材没有可用课文');
        return Promise.resolve();
      }
      return this.showLesson(
        this.currentLessonId &&
          lessons.some(function (it) {
            return it.lesson_id === this.currentLessonId;
          }, this)
          ? this.currentLessonId
          : lessons[0].lesson_id,
      );
    },

    showLesson: function (lessonId) {
      var self = this;
      var requestId = ++this._lessonLoadId;
      var bookId = this.currentBookId;
      function isCurrent() {
        return (
          requestId === self._lessonLoadId &&
          self.currentBookId === bookId &&
          self.currentLessonId === lessonId
        );
      }
      this._stopTtsPlayback();
      if (this.currentLessonId && this.currentLesson) this._visitedLessonIds[this.currentLessonId] = true;
      var sameCourse =
        this.coursePath &&
        this.coursePath.bookId === (this.currentBookId || this.defaultBookId) &&
        this.coursePath.lessonId === String(lessonId || '');
      if (!sameCourse) {
        this.coursePath = this._createCoursePath(lessonId);
        this._coursePathManuallyCollapsed = true;
        this._courseOtherExpanded = false;
      }
      this.currentLessonId = lessonId;
      this._renderSelection();
      this._showLoading('正在加载课文、词汇与语法...');
      return Promise.all([
        TextbookLoader.getLesson(this.currentBookId, lessonId),
        TextbookLoader.getLessonVocab(this.currentBookId, lessonId),
        TextbookLoader.getLessonGrammar(this.currentBookId, lessonId),
        TextbookLoader.getLessonTextChunks(this.currentBookId, lessonId),
        TextbookLoader.getLessonWikiReading(this.currentBookId, lessonId),
      ])
        .then(function (results) {
          if (!isCurrent()) return false;
          self.currentLesson = results[0];
          self.currentVocab = results[1] || [];
          self.currentGrammar = results[2] || [];
          self.currentTextChunks = results[3] || [];
          self.currentWikiReading = results[4] || null;
          self.currentInlineGrammarCount = self._countInlineGrammar(self.currentLesson);
          self._updateCoursePathMeta();
          self._invalidateHighlightCache();
          self._renderReader();
          self._renderDetail();
          if (self._pendingReaderScrollTop !== null && self.readerEl) {
            self.readerEl.scrollTop = self._pendingReaderScrollTop;
            self._pendingReaderScrollTop = null;
          }
          self._visitedLessonIds[lessonId] = true;
          self._renderSelection();
          self._hideLoading();
          self._updateStatus();
          return true;
        })
        .catch(function (err) {
          if (!isCurrent()) return false;
          self.currentLesson = null;
          self.currentVocab = [];
          self.currentGrammar = [];
          self.currentTextChunks = [];
          self.currentWikiReading = null;
          self.currentInlineGrammarCount = 0;
          self.coursePath = self._createCoursePath(lessonId);
          self._invalidateHighlightCache();
          self._hideLoading();
          self._setReaderError(
            '课文加载失败',
            function () {
              return self.showLesson(lessonId);
            },
            err,
          );
          self._setDetailPlaceholder('本课词汇暂不可用');
          self._updateStatus();
          return false;
        });
    },

    _renderSidebar: function () {
      var currentBook = this._getCurrentBookMeta();
      var lessons = (this.bookIndex && this.bookIndex.lessons) || [];
      var html =
        '<div class="tb-book-picker"><label for="tbBookSelect">教材册</label><select id="tbBookSelect" class="tb-select">';
      for (var i = 0; i < this.books.length; i++) {
        var book = this.books[i];
        html +=
          '<option value="' +
          this._esc(book.id) +
          '"' +
          (book.id === this.currentBookId ? ' selected' : '') +
          '>' +
          this._esc(book.label + ' / ' + book.level) +
          '</option>';
      }
      html +=
        '</select><span class="tb-book-picker-meta">' +
        this._esc(currentBook.level || '-') +
        ' · ' +
        lessons.length +
        ' 单元</span></div>' +
        '<details class="tb-sidebar-group tb-sidebar-reading-group">' +
        '<summary><span>阅读工具</span><small>随当前课文</small></summary>' +
        '<div id="tbSidebarReadingControls" class="tb-sidebar-reading-controls"></div>' +
        '</details>' +
        '<details class="tb-sidebar-group tb-lesson-directory">' +
        '<summary><span>课程目录</span><small>' +
        lessons.length +
        ' 单元</small></summary><div class="tb-lesson-list">';
      for (var j = 0; j < lessons.length; j++) html += this._renderLessonCard(lessons[j]);
      if (!lessons.length) {
        html += window.StateView
          ? window.StateView.html({
              kind: 'empty',
              className: 'tb-empty-state',
              icon: 'book',
              title: '当前教材没有可显示的课文',
              message: '换一本教材，或检查本地教材索引后再试。',
              action: { id: 'choose-textbook', label: '选择其他教材', icon: 'library' },
            })
          : '<div class="tb-empty-state">当前教材没有可显示的课文</div>';
      }
      html += '</div></details>';
      this.sidebarContentEl.innerHTML = html;
      this._bindSidebarEvents();
      this._renderSidebarReadingTools();
    },

    _renderSidebarReadingTools: function () {
      var container = document.getElementById('tbSidebarReadingControls');
      if (!container) return;
      var lesson = this.currentLesson && this.currentLesson.lesson;
      if (!lesson) {
        container.innerHTML =
          '<p class="tb-sidebar-tool-placeholder">选择课程后可调整显示模式和继续当前学习步骤。</p>';
        return;
      }
      var title = this._cleanValue(lesson.title) || this.currentLessonId || '当前课文';
      var meta = (this.currentLesson && this.currentLesson.meta) || {};
      var book = this._getCurrentBookMeta();
      var locationLabel =
        (book.label || this.currentBookId || '教材') +
        ' / ' +
        (book.level || '-') +
        ' · ' +
        this._buildLessonLabel(meta);
      container.innerHTML =
        '<div class="tb-sidebar-current-lesson"><span>' +
        this._esc(locationLabel) +
        '</span><strong lang="ja">' +
        this._esc(title) +
        '</strong></div>' +
        this._renderCoursePath(lesson, meta) +
        '<button type="button" class="btn-primary tb-sidebar-continue" data-reader-action="continue" data-sidebar-reader-action="continue">' +
        uiIcon('chevron-right') +
        '继续本课</button>' +
        '<span class="tb-sidebar-control-label">显示模式</span>' +
        this._renderTextDisplayToggle() +
        this._renderTranslationToggle() +
        '<button type="button" class="btn-secondary tb-translation-toggle tb-image-toggle" data-image-toggle aria-pressed="' +
        (this.showImages ? 'true' : 'false') +
        '">' +
        uiIcon(this.showImages ? 'eye-off' : 'eye') +
        (this.showImages ? '隐藏课文插图' : '显示课文插图') +
        '</button>';
    },

    _setShowImages: function (show) {
      this.showImages = !!show;
      try {
        if (this.showImages) localStorage.removeItem('jp_learning_textbook_images_v1');
        else localStorage.setItem('jp_learning_textbook_images_v1', 'hidden');
      } catch (error) {
        /* keep the choice for this page */
      }
      var scrollTop = this.readerEl ? this.readerEl.scrollTop : 0;
      this._renderReader();
      if (this.readerEl) this.readerEl.scrollTop = scrollTop;
    },

    _renderSelection: function () {
      if (!this.sidebarContentEl) return;
      var cards = this.sidebarContentEl.querySelectorAll('.tb-lesson-card');
      for (var i = 0; i < cards.length; i++) {
        var lessonId = cards[i].getAttribute('data-lesson-id');
        var isCurrent = lessonId === this.currentLessonId;
        var isReview = cards[i].getAttribute('data-review-unit') === '1';
        var progress = cards[i].querySelector('.tb-lesson-progress');
        cards[i].classList.toggle('active', isCurrent);
        cards[i].classList.toggle('is-read', !isCurrent && !!this._visitedLessonIds[lessonId]);
        if (isCurrent) cards[i].setAttribute('aria-current', 'page');
        else cards[i].removeAttribute('aria-current');
        if (progress) {
          progress.textContent = isCurrent
            ? '当前阅读'
            : this._visitedLessonIds[lessonId]
              ? '已读'
              : isReview
                ? '待复习'
                : '待学习';
          progress.className =
            'tb-lesson-progress' +
            (isCurrent
              ? ' is-current'
              : this._visitedLessonIds[lessonId]
                ? ' is-complete'
                : isReview
                  ? ' is-review'
                  : '');
        }
      }
    },

    _bindSidebarEvents: function () {
      var self = this;
      var bookSelect = document.getElementById('tbBookSelect');
      if (bookSelect)
        bookSelect.addEventListener('change', function () {
          self.currentLessonId = null;
          self.currentLesson = null;
          self.currentVocab = [];
          self.currentGrammar = [];
          self.currentTextChunks = [];
          self.currentWikiReading = null;
          self.currentInlineGrammarCount = 0;
          self._invalidateHighlightCache();
          self._setReaderPlaceholder('正在切换教材...');
          self._setDetailPlaceholder('正在准备本课词汇...');
          var nextBookId = this.value;
          self._loadBook(nextBookId).then(function (loaded) {
            return loaded && self._openInitialLesson();
          });
        });
      var emptyAction = this.sidebarContentEl.querySelector('[data-state-action="choose-textbook"]');
      if (emptyAction && bookSelect)
        emptyAction.addEventListener('click', function () {
          bookSelect.focus();
        });
      this.sidebarContentEl.onclick = function (event) {
        var target = event.target;
        if (!target || !target.closest) return;
        var courseAction = target.closest('[data-course-action]');
        if (courseAction) {
          event.preventDefault();
          if (courseAction.getAttribute('data-course-action') === 'toggle') {
            self._toggleCoursePath();
            return;
          }
          if (courseAction.getAttribute('data-course-action') === 'toggle-others') {
            self._courseOtherExpanded = !self._courseOtherExpanded;
            self._refreshCoursePath();
            return;
          }
          self._handleCourseAction(
            courseAction.getAttribute('data-course-action') || '',
            courseAction.getAttribute('data-course-step') || '',
          );
          if (courseAction.getAttribute('data-course-action') === 'complete') self._completeCourse();
          return;
        }
        var card = target.closest('.tb-lesson-card');
        if (card) {
          var lessonId = card.getAttribute('data-lesson-id');
          if (lessonId) self.showLesson(lessonId);
          return;
        }
        var continueBtn = target.closest('[data-sidebar-reader-action="continue"]');
        if (continueBtn) {
          self._continueCourse();
          return;
        }
        if (target.closest('[data-translation-toggle]')) {
          self.showTranslations = !self.showTranslations;
          var scrollTop = self.readerEl ? self.readerEl.scrollTop : 0;
          self._renderReader();
          if (self.readerEl) self.readerEl.scrollTop = scrollTop;
          var toggle = self.sidebarContentEl.querySelector('[data-translation-toggle]');
          if (toggle) toggle.focus({ preventScroll: true });
          return;
        }
        if (target.closest('[data-image-toggle]')) {
          self._setShowImages(!self.showImages);
          var imageToggle = self.sidebarContentEl.querySelector('[data-image-toggle]');
          if (imageToggle) imageToggle.focus({ preventScroll: true });
          return;
        }
        var displayBtn = target.closest('.tb-display-mode-btn');
        if (displayBtn && !displayBtn.disabled) {
          self._setTextDisplayMode(displayBtn.getAttribute('data-display-mode') || 'normal');
        }
      };
    },

    _renderLessonCard: function (meta) {
      var isCurrent = meta.lesson_id === this.currentLessonId;
      var isVisited = !!this._visitedLessonIds[meta.lesson_id];
      var isReview = !!(meta.is_review_unit || meta.item_type === 'review_unit');
      var progressText = isCurrent ? '当前阅读' : isVisited ? '已读' : isReview ? '待复习' : '待学习';
      var progressClass = isCurrent
        ? ' is-current'
        : isVisited
          ? ' is-complete'
          : isReview
            ? ' is-review'
            : '';
      return (
        '<button class="tb-lesson-card' +
        (isCurrent ? ' active' : '') +
        (isVisited && !isCurrent ? ' is-read' : '') +
        '" data-lesson-id="' +
        this._esc(meta.lesson_id) +
        '" data-review-unit="' +
        (isReview ? '1' : '0') +
        '"' +
        (isCurrent ? ' aria-current="page"' : '') +
        '">' +
        '<div class="tb-lesson-card-head"><span class="tb-lesson-no">' +
        this._esc(this._buildLessonLabel(meta)) +
        '</span><span class="tb-lesson-progress' +
        progressClass +
        '">' +
        progressText +
        '</span></div>' +
        '<div class="tb-lesson-title" lang="' +
        TextbookLoader.getLessonTitleLanguage(this.currentBookId, meta.lesson_id) +
        '">' +
        this._esc(meta.title_ja || meta.lesson_id) +
        '</div>' +
        '<div class="tb-lesson-meta"><span class="tb-status-chip">' +
        this._esc(this._buildLessonKindLabel(meta)) +
        '</span><span class="tb-lesson-pages">' +
        this._esc(this._formatPageRange(meta.printed_page_range) || '-') +
        '</span></div></button>'
      );
    },

    _renderReader: function () {
      if (window.JPLearn.topLayer) window.JPLearn.topLayer.release('textbook-outline');
      this._closeChunkDetail(false);
      var item = this.currentLesson;
      var lesson = item && item.lesson;
      if (!lesson) return this._setReaderPlaceholder('请选择课文开始阅读');
      var meta = (item && item.meta) || {};
      var order = this._buildSectionOrder(meta.declared_sections || [], lesson);
      var leadMedia = this._renderLessonLeadImage(lesson);
      var body = '';
      for (var i = 0; i < order.length; i++) body += this._renderSection(order[i], lesson);
      body += this._renderWikiExtensionSection();
      if (!body) {
        body = window.StateView
          ? window.StateView.html({
              kind: 'empty',
              className: 'tb-reader-empty-state',
              icon: 'book',
              title: '本课暂无可渲染正文',
              message: '换一课继续阅读，或检查本课文本资源。',
            })
          : '<div class="tb-reader-empty">本课暂无可渲染正文</div>';
      }
      // Replace the reading content around the persistent lesson heading so a
      // focused heading action (next lesson, directory) survives the switch.
      var heading = this._ensureLessonHeading();
      var template = document.createElement('template');
      template.innerHTML =
        leadMedia +
        '<div class="tb-reader-body" tabindex="-1">' +
        body +
        '</div>' +
        this._renderLessonEndNav();
      var previousNodes = Array.prototype.slice.call(this.readerEl.childNodes);
      for (var n = 0; n < previousNodes.length; n++) {
        if (previousNodes[n] !== heading) this.readerEl.removeChild(previousNodes[n]);
      }
      if (heading.parentNode !== this.readerEl) this.readerEl.prepend(heading);
      this.readerEl.appendChild(template.content);
      this._renderLessonHeading();
      this._renderOutline();
      this._bindReaderEvents();
      this._syncTtsButtonState();
      this._renderSidebarReadingTools();
      this._applyBookView();
    },

    _ensureLessonHeading: function () {
      if (!this._lessonHeadingEl) {
        var host = document.createElement('header');
        host.id = 'tbLessonHeading';
        host.className = 'page-heading page-heading--lesson';
        host.hidden = true;
        this._lessonHeadingEl = host;
      }
      return this._lessonHeadingEl;
    },

    // Chapter opening inside the reader: book, lesson and Japanese title, the
    // four-step path at a glance and the next action. The drawer keeps the full
    // path controls; these actions call the same handlers.
    _renderLessonHeading: function () {
      var host = this._lessonHeadingEl;
      var heading = window.JPLearn.pageHeading;
      if (!host || !heading) return;
      var item = this.currentLesson;
      var lesson = item && item.lesson;
      if (!lesson) {
        heading.hide(host);
        return;
      }
      var meta = (item && item.meta) || lesson;
      var book = this._getCurrentBookMeta();
      var path = this._ensureCoursePath();
      var progress = this._courseProgress(path);
      var names = { vocab: '预习词汇', reading: '阅读课文', grammar: '查看语法', review: '复习 3–5 题' };
      var statusNames = { done: '已完成', skipped: '已跳过', active: '进行中', todo: '待开始' };
      var keys = ['vocab', 'reading', 'grammar', 'review'];
      var current = path.completed ? '' : path.currentStep;
      var currentActive = !!current && path.steps[current] === 'active';
      var steps = [];
      var spoken = [];
      for (var i = 0; i < keys.length; i++) {
        var stepStatus = path.steps[keys[i]];
        steps.push({
          label: names[keys[i]] + ' · ' + statusNames[stepStatus],
          state:
            keys[i] === current
              ? currentActive
                ? 'active'
                : 'current'
              : stepStatus === 'done' || stepStatus === 'skipped'
                ? stepStatus
                : 'todo',
        });
        spoken.push(names[keys[i]] + statusNames[stepStatus]);
      }
      var statusText = path.completed
        ? '本课已完成'
        : progress.ready
          ? '四步已处理，可以完成本课'
          : current
            ? '当前：' + names[current] + (currentActive ? '（进行中）' : '')
            : '';
      var adjacent = this._adjacentLessons();
      var entry = adjacent.current || meta;
      var lessonName = function (target) {
        return this._buildLessonLabel(target) + ' ' + (target.title_ja || target.lesson_id);
      }.bind(this);
      var actions = [
        {
          id: 'previous',
          label: '上一课',
          icon: 'chevron-left',
          variant: 'quiet',
          disabled: !adjacent.previous,
          title: adjacent.previous ? '上一课：' + lessonName(adjacent.previous) : '已经是本册第一课',
        },
        {
          id: 'next',
          label: '下一课',
          icon: 'chevron-right',
          iconAfter: true,
          variant: 'quiet',
          disabled: !adjacent.next,
          title: adjacent.next ? '下一课：' + lessonName(adjacent.next) : '已经是本册最后一课',
        },
        { id: 'toc', label: '课程目录', compactLabel: '目录', icon: 'list', title: '打开课程目录' },
      ];
      if (currentActive) {
        actions.push({
          id: 'done',
          label: '完成此步',
          icon: 'check',
          ariaLabel: '完成此步：' + names[current],
        });
      }
      if (!path.completed && progress.ready) {
        actions.push({ id: 'complete', label: '完成本课', icon: 'flag', variant: 'primary' });
      } else if (!path.completed) {
        actions.push({
          id: 'continue',
          label: '继续本课',
          icon: 'chevron-right',
          iconAfter: true,
          variant: 'primary',
          ariaLabel: current ? '继续本课：' + names[current] : '',
        });
      }
      var self = this;
      heading.render(
        host,
        {
          variant: 'lesson',
          eyebrow: [
            book.title || book.label || this.currentBookId,
            this._buildLessonKindLabel(entry),
            this._formatPageRange(entry.printed_page_range),
          ]
            .filter(Boolean)
            .join(' · '),
          titlePrefix: this._buildLessonLabel(entry),
          title: this._cleanValue(lesson.title) || this._cleanValue(meta.title_ja) || this.currentLessonId,
          titleLang: TextbookLoader.getLessonTitleLanguage(this.currentBookId, this.currentLessonId),
          steps: steps,
          stepsLabel: '本课学习路径：' + spoken.join('，'),
          meta: ['学习路径 ' + progress.complete + '/' + progress.total, statusText],
          actions: actions,
        },
        {
          previous: function () {
            self._openAdjacentLesson('previous', false);
          },
          next: function () {
            self._openAdjacentLesson('next', false);
          },
          toc: function (button) {
            self._openLessonDirectory(button);
          },
          done: function () {
            var coursePath = self._ensureCoursePath();
            if (coursePath.currentStep) self._handleCourseAction('done', coursePath.currentStep);
            if (!heading.focusAction(host, 'continue')) heading.focusAction(host, 'complete');
          },
          continue: function () {
            self._continueCourse();
          },
          complete: function () {
            self._completeCourse();
          },
        },
      );
    },

    // Directory entries carry the printed lesson label and pages used by the
    // lesson cards; headings and the outline use the same source.
    _adjacentLessons: function () {
      var lessons = (this.bookIndex && this.bookIndex.lessons) || [];
      for (var i = 0; i < lessons.length; i++) {
        if (lessons[i].lesson_id === this.currentLessonId) {
          return { previous: lessons[i - 1] || null, current: lessons[i], next: lessons[i + 1] || null };
        }
      }
      return { previous: null, current: null, next: null };
    },

    _openAdjacentLesson: function (direction, focusHeading) {
      var adjacent = this._adjacentLessons();
      var target = direction === 'next' ? adjacent.next : adjacent.previous;
      if (!target) return Promise.resolve(false);
      var self = this;
      this._pendingReaderScrollTop = 0;
      return this.showLesson(target.lesson_id).then(function (loaded) {
        var title = self._lessonHeadingEl && self._lessonHeadingEl.querySelector('.page-heading-title');
        if (loaded && focusHeading && title) title.focus({ preventScroll: true });
        return loaded;
      });
    },

    _openLessonDirectory: function (trigger) {
      if (!window.PanelLayout || !window.PanelLayout.openTools) return false;
      var sidebar = this.sidebarContentEl;
      return window.PanelLayout.openTools({
        returnFocus: trigger,
        focus: function () {
          var directory = sidebar && sidebar.querySelector('.tb-lesson-directory');
          if (!directory) return null;
          directory.open = true;
          return (
            directory.querySelector('.tb-lesson-card[aria-current="page"]') ||
            directory.querySelector('summary')
          );
        },
      });
    },

    // Lesson end: the next lesson is one step away without reopening the drawer.
    _renderLessonEndNav: function () {
      var adjacent = this._adjacentLessons();
      if (!adjacent.previous && !adjacent.next) return '';
      var self = this;
      var link = function (direction, target) {
        if (!target) return '<span class="tb-lesson-end-spacer" aria-hidden="true"></span>';
        var isNext = direction === 'next';
        return (
          '<button type="button" class="tb-lesson-end-link is-' +
          direction +
          '" data-lesson-step="' +
          direction +
          '">' +
          (isNext ? '' : uiIcon('chevron-left')) +
          '<span class="tb-lesson-end-copy"><small>' +
          (isNext ? '下一课' : '上一课') +
          ' · ' +
          self._esc(self._buildLessonLabel(target)) +
          '</small><strong lang="ja">' +
          self._esc(target.title_ja || target.lesson_id) +
          '</strong></span>' +
          (isNext ? uiIcon('chevron-right') : '') +
          '</button>'
        );
      };
      return (
        '<nav class="tb-lesson-end" aria-label="上一课与下一课">' +
        link('previous', adjacent.previous) +
        link('next', adjacent.next) +
        '</nav>'
      );
    },

    _renderOutline: function () {
      var self = this;
      // The lesson heading survives lesson changes, so drop its previous directory.
      this.readerEl.querySelectorAll('.tb-outline-slot').forEach(function (old) {
        old.remove();
      });
      var sections = Array.from(this.readerEl.querySelectorAll('.tb-reader-body > .tb-section'));
      if (!sections.length) return;
      var slot = document.createElement('div');
      slot.className = 'tb-outline-slot';
      slot.innerHTML =
        '<details class="tb-outline"><summary>本课目录</summary><nav aria-label="本课章节"></nav></details>';
      var details = slot.querySelector('details');
      var nav = slot.querySelector('nav');
      // Once the lesson heading scrolls away, the sticky outline still names the lesson.
      var outlineMeta =
        this._adjacentLessons().current ||
        (this.currentLesson && (this.currentLesson.meta || this.currentLesson.lesson));
      if (outlineMeta) {
        var outlineLesson = document.createElement('p');
        outlineLesson.className = 'tb-outline-lesson';
        outlineLesson.textContent = this._buildLessonLabel(outlineMeta);
        nav.appendChild(outlineLesson);
      }
      var layer = window.JPLearn.topLayer;
      if (layer) {
        layer.register('textbook-outline', {
          close: function (restoreFocus) {
            details.open = false;
            if (restoreFocus) details.querySelector('summary').focus();
          },
        });
        details.addEventListener('toggle', function () {
          if (!details.isConnected) return;
          if (details.open && !details.classList.contains('is-wide')) layer.requestOpen('textbook-outline');
          else layer.release('textbook-outline');
        });
      }
      sections.forEach(function (section, index) {
        var title = section.querySelector('.tb-section-badge, .tb-wiki-title');
        if (!title) return;
        section.id = 'tb-section-' + index;
        section.tabIndex = -1;
        var link = document.createElement('a');
        link.href = '#' + section.id;
        link.textContent = title.textContent.trim();
        link.title = link.textContent;
        link.onclick = function (event) {
          event.preventDefault();
          section.focus({ preventScroll: true });
          if (self._bookPager) {
            self._bookPager.show(section.querySelector('.tb-section-head') || section);
            self._bookPager.reveal();
          } else section.scrollIntoView({ behavior: 'auto', block: 'start', inline: 'nearest' });
          if (!details.classList.contains('is-wide')) details.open = false;
          self._syncOutline();
        };
        nav.appendChild(link);
      });
      details.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && !details.classList.contains('is-wide')) {
          details.open = false;
          details.querySelector('summary').focus();
          event.stopPropagation();
        }
      });
      // Facing pages put the directory in the lesson heading row, left of the
      // lesson actions; the legacy scrolling reader keeps its sticky outline.
      var lessonHeading = this._lessonHeadingEl;
      var headingActions = lessonHeading && lessonHeading.querySelector(':scope > .page-heading-actions');
      if (this._isBookViewEnabled() && headingActions && this.readerEl.contains(lessonHeading))
        lessonHeading.insertBefore(slot, headingActions);
      else if (lessonHeading && lessonHeading.parentNode === this.readerEl) lessonHeading.after(slot);
      else this.readerEl.prepend(slot);
      if (!this._outlineResizeObserver) {
        this._outlineResizeObserver = new ResizeObserver(function () {
          self._resizeOutline();
        });
        this._outlineResizeObserver.observe(this.readerEl);
        this.readerEl.addEventListener(
          'scroll',
          function () {
            self._syncOutline();
          },
          { passive: true },
        );
        document.addEventListener('pointerdown', function (event) {
          var current = self.readerEl.querySelector('.tb-outline');
          if (current && !current.classList.contains('is-wide') && !current.contains(event.target))
            current.open = false;
        });
      }
      this._resizeOutline();
      this._syncOutline();
    },

    _resizeOutline: function () {
      var outline = this.readerEl.querySelector('.tb-outline');
      if (!outline) return;
      // Facing pages use the full reading column. Their section directory is
      // a disclosure above the book, wide enough to read Japanese headings.
      // The legacy scrolling reader keeps its permanent desktop margin index.
      var wide = !this._isBookViewEnabled() && this.readerEl.clientWidth >= 1150;
      if (outline.classList.contains('is-wide') !== wide) outline.open = wide;
      outline.classList.toggle('is-wide', wide);
      // An already-open compact menu does not emit toggle when made wide.
      // Keep the permanent directory out of the temporary-layer coordinator.
      var layer = window.JPLearn.topLayer;
      if (layer) {
        if (outline.open && !wide) layer.requestOpen('textbook-outline');
        else layer.release('textbook-outline');
      }
    },

    _syncOutline: function () {
      if (this._bookPager) return this._syncBookOutline();
      var links = Array.from(this.readerEl.querySelectorAll('.tb-outline a'));
      if (!links.length) return;
      var top = this.readerEl.getBoundingClientRect().top + 28;
      var active = links[0];
      links.forEach(function (link) {
        var section = document.getElementById(link.hash.slice(1));
        if (section && section.getBoundingClientRect().top <= top) active = link;
      });
      if (
        this.readerEl.scrollTop > 0 &&
        this.readerEl.scrollTop + this.readerEl.clientHeight >= this.readerEl.scrollHeight - 2
      )
        active = links[links.length - 1];
      links.forEach(function (link) {
        if (link === active) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
    },

    _renderCoursePath: function (lesson, meta) {
      var path = this._updateCoursePathMeta();
      var progress = this._courseProgress(path);
      var labels = {
        vocab: {
          title: '预习词汇',
          hint: this.currentVocab.length ? this.currentVocab.length + ' 个核心词' : '本课暂无词汇',
          icon: 'library',
          action: '打开词汇',
        },
        reading: { title: '阅读课文', hint: '读一遍并听朗读', icon: 'book', action: '继续阅读' },
        grammar: {
          title: '查看语法',
          hint: this.currentGrammar.length ? this.currentGrammar.length + ' 个语法点' : '本课暂无关联语法',
          icon: 'grammar',
          action: '查看语法',
        },
        review: {
          title: '复习 3–5 题',
          hint: this._courseWordObjects().length
            ? '复习已关联词；其余留在课文中查看'
            : '暂无可关联词；请在课文中查看',
          icon: 'pencil',
          action: '开始复习',
        },
      };
      var keys = ['vocab', 'reading', 'grammar', 'review'];
      var collapsed = this._isCoursePathCollapsed();
      var html =
        '<section class="tb-course-path' +
        (collapsed ? ' is-collapsed' : '') +
        '" data-course-path aria-label="本课学习路径">';
      html +=
        '<button type="button" class="tb-course-path-toggle" data-course-action="toggle" aria-expanded="' +
        (collapsed ? 'false' : 'true') +
        '" aria-controls="tbCoursePathBody" aria-label="' +
        (collapsed ? '展开本课学习路径' : '收起本课学习路径') +
        '"><span class="tb-course-path-heading"><span class="tb-course-kicker">本课学习路径</span><strong>' +
        this._esc(path.lessonLabel || this.currentLessonId || '') +
        (path.title ? ' · ' + this._esc(path.title) : '') +
        '</strong></span><span class="tb-course-path-summary"><span class="tb-course-progress">' +
        progress.complete +
        '/' +
        progress.total +
        ' 已完成</span>' +
        uiIcon(collapsed ? 'chevron-down' : 'chevron-up') +
        '</span></button>';
      html += '<div class="tb-course-path-body" id="tbCoursePathBody"' + (collapsed ? ' hidden' : '') + '>';
      var focusedKeys = keys
        .filter(function (key) {
          return !path.completed && path.steps[key] !== 'done' && path.steps[key] !== 'skipped';
        })
        .slice(0, 2);
      var focusedHtml = '';
      var otherHtml = '';
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var item = labels[key];
        var position = focusedKeys.indexOf(key);
        var stepHtml = '';
        var status = path.steps[key];
        var terminal = status === 'done' || status === 'skipped';
        var statusLabel =
          status === 'done'
            ? '已完成'
            : status === 'skipped'
              ? '已跳过'
              : status === 'active'
                ? '进行中'
                : '待开始';
        var actionLabel =
          status === 'skipped'
            ? '恢复'
            : status === 'done'
              ? '再次查看'
              : status === 'active'
                ? '继续'
                : item.action;
        stepHtml +=
          '<div class="tb-course-step is-' +
          status +
          (position === 0 ? ' is-current' : position === 1 ? ' is-next' : '') +
          '" data-course-step="' +
          key +
          '" role="listitem"' +
          (position === 0 ? ' aria-current="step"' : '') +
          '>';
        stepHtml +=
          '<span class="tb-course-step-index" aria-hidden="true">' +
          (terminal ? uiIcon('check') : i + 1) +
          '</span>';
        stepHtml +=
          '<div class="tb-course-step-copy"><strong>' +
          (position >= 0
            ? '<span class="tb-course-step-position">' + (position === 0 ? '当前' : '下一步') + '</span>'
            : '') +
          this._esc(item.title) +
          '</strong><small>' +
          this._esc(item.hint) +
          '</small></div>';
        stepHtml += '<span class="tb-course-step-status">' + this._esc(statusLabel) + '</span>';
        stepHtml +=
          '<button type="button" class="tb-course-step-action" data-course-action="step" data-course-step="' +
          key +
          '">' +
          uiIcon(item.icon) +
          this._esc(actionLabel) +
          '</button>';
        if (status === 'active')
          stepHtml +=
            '<button type="button" class="tb-course-step-done" data-course-action="done" data-course-step="' +
            key +
            '" title="标记' +
            this._esc(item.title) +
            '完成" aria-label="标记' +
            this._esc(item.title) +
            '完成">' +
            uiIcon('check') +
            '完成</button>';
        if (!terminal)
          stepHtml +=
            '<button type="button" class="tb-course-step-skip" data-course-action="skip" data-course-step="' +
            key +
            '" title="跳过' +
            this._esc(item.title) +
            '" aria-label="跳过' +
            this._esc(item.title) +
            '">' +
            uiIcon('skip') +
            '</button>';
        stepHtml += '</div>';
        if (position >= 0) focusedHtml += stepHtml;
        else otherHtml += stepHtml;
      }
      if (focusedHtml)
        html +=
          '<div class="tb-course-steps tb-course-focus-steps" role="list" aria-label="当前与下一步">' +
          focusedHtml +
          '</div>';
      if (otherHtml) {
        html +=
          '<button type="button" class="tb-course-other-toggle" data-course-action="toggle-others" aria-expanded="' +
          (this._courseOtherExpanded ? 'true' : 'false') +
          '" aria-controls="tbCourseOtherSteps">' +
          uiIcon(this._courseOtherExpanded ? 'chevron-up' : 'chevron-down') +
          '其他步骤 · ' +
          (keys.length - focusedKeys.length) +
          '</button>';
        html +=
          '<div class="tb-course-steps tb-course-other-steps" id="tbCourseOtherSteps" role="list" aria-label="其他步骤"' +
          (this._courseOtherExpanded ? '' : ' hidden') +
          '>' +
          otherHtml +
          '</div>';
      }
      html +=
        '<div class="tb-course-path-foot"><span>' +
        (path.completed
          ? '本课已完成，仍可回看各步骤。'
          : progress.ready
            ? '四步已处理，可以完成本课。'
            : '步骤可跳过，之后仍可恢复。') +
        '</span>';
      html +=
        '<button type="button" class="btn-secondary tb-course-complete" data-course-action="complete"' +
        (progress.ready && !path.completed ? '' : ' disabled') +
        '>' +
        uiIcon(path.completed ? 'check' : 'flag') +
        (path.completed ? '本课已完成' : '标记本课完成') +
        '</button></div>';
      html += '</div></section>';
      return html;
    },

    _isCoursePathCollapsed: function () {
      return this._coursePathManuallyCollapsed;
    },

    _applyCoursePathCollapsed: function () {
      var pathEl = this.sidebarContentEl && this.sidebarContentEl.querySelector('[data-course-path]');
      if (!pathEl) return;
      var collapsed = this._isCoursePathCollapsed();
      var toggle = pathEl.querySelector('.tb-course-path-toggle');
      var body = pathEl.querySelector('.tb-course-path-body');
      pathEl.classList.toggle('is-collapsed', collapsed);
      if (toggle) {
        toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        toggle.setAttribute('aria-label', collapsed ? '展开本课学习路径' : '收起本课学习路径');
        var icon = toggle.querySelector('ui-icon');
        if (icon) icon.setAttribute('name', collapsed ? 'chevron-down' : 'chevron-up');
      }
      if (body) body.hidden = collapsed;
    },

    _toggleCoursePath: function () {
      this._coursePathManuallyCollapsed = !this._coursePathManuallyCollapsed;
      this._applyCoursePathCollapsed();
    },

    _renderTextDisplayToggle: function () {
      var wikiSentences = Array.isArray(this.currentWikiReading && this.currentWikiReading.sentences)
        ? this.currentWikiReading.sentences
        : [];
      var chunkDisabled = this.currentTextChunks.length || wikiSentences.length ? '' : ' disabled';
      return (
        '<div class="tb-display-toggle tb-meta-noselect" role="group" aria-label="课文显示模式">' +
        '<button type="button" class="tb-display-mode-btn' +
        (this.textDisplayMode === 'normal' ? ' active' : '') +
        '" data-display-mode="normal" aria-pressed="' +
        (this.textDisplayMode === 'normal' ? 'true' : 'false') +
        '">' +
        uiIcon('book') +
        '普通显示</button>' +
        '<button type="button" class="tb-display-mode-btn' +
        (this.textDisplayMode === 'chunks' ? ' active' : '') +
        '" data-display-mode="chunks" aria-pressed="' +
        (this.textDisplayMode === 'chunks' ? 'true' : 'false') +
        '"' +
        chunkDisabled +
        '>' +
        uiIcon('layers') +
        '词块显示</button>' +
        '<button type="button" class="tb-display-mode-btn' +
        (this.textDisplayMode === 'plain' ? ' active' : '') +
        '" data-display-mode="plain" aria-pressed="' +
        (this.textDisplayMode === 'plain' ? 'true' : 'false') +
        '">' +
        uiIcon('text') +
        '纯文字</button>' +
        '</div>'
      );
    },

    _setTextDisplayMode: function (displayMode) {
      var nextMode = displayMode === 'chunks' ? 'chunks' : displayMode === 'plain' ? 'plain' : 'normal';
      if (nextMode === this.textDisplayMode) return;
      var readerScrollTop = this.readerEl ? this.readerEl.scrollTop : 0;
      this.textDisplayMode = nextMode;
      this._renderReader();
      if (this.readerEl) this.readerEl.scrollTop = readerScrollTop;
    },

    _buildSectionOrder: function (declared, lesson) {
      var order = [];
      for (var i = 0; i < declared.length; i++) {
        var kind = this._normalizeDeclaredType((declared[i] || {}).type);
        if (kind && this._hasSectionContent(lesson, kind)) this._pushUnique(order, kind);
      }
      var fallback = [
        'foundation_intro',
        'phonetic',
        'foundation_notes',
        'body',
        'conversation',
        'application',
        'study_window',
        'counter_grammar',
        'grammar',
        'unit_summary',
        'exercises',
      ];
      for (var j = 0; j < fallback.length; j++)
        if (this._hasSectionContent(lesson, fallback[j])) this._pushUnique(order, fallback[j]);
      if (!this._hasAnyInlineGrammar(lesson) && this.currentGrammar.length)
        this._pushUnique(order, 'grammar_library');
      if (this.currentVocab.length) {
        var existingVocab = order.indexOf('vocab');
        if (existingVocab !== -1) order.splice(existingVocab, 1);
        var grammarKinds = ['counter_grammar', 'grammar', 'unit_summary', 'grammar_library'];
        var firstGrammarIndex = -1;
        var grammarSections = [];
        var nonGrammarBefore = 0;
        for (var k = 0; k < order.length; k++) {
          if (grammarKinds.indexOf(order[k]) !== -1) {
            if (firstGrammarIndex === -1) firstGrammarIndex = k;
            grammarSections.push(order[k]);
          } else if (firstGrammarIndex === -1) {
            nonGrammarBefore++;
          }
        }
        order = order.filter(function (kind) {
          return grammarKinds.indexOf(kind) === -1;
        });
        var applicationIndex = order.indexOf('application');
        var insertAt = applicationIndex !== -1 ? applicationIndex + 1 : nonGrammarBefore;
        if (firstGrammarIndex === -1 && applicationIndex === -1) insertAt = order.length;
        order.splice(insertAt, 0, 'vocab');
        for (var g = 0; g < grammarSections.length; g++) {
          order.splice(insertAt + 1 + g, 0, grammarSections[g]);
        }
      }
      return order;
    },

    _renderSection: function (kind, lesson) {
      if (kind === 'foundation_intro') return this._renderFoundationIntro(lesson);
      if (kind === 'phonetic')
        return this._hasKanaTable(lesson)
          ? this._renderKanaTableSection(lesson)
          : this._renderPhoneticSection(lesson.phonetic_sections || [], lesson);
      if (kind === 'foundation_notes') return this._renderFoundationNotes(lesson);
      if (kind === 'exercises') return this._renderExerciseSection(lesson);
      if (kind === 'body')
        return this._renderTextSection(lesson.body, '本文', {
          ttsMode: 'reading:body',
          lesson: lesson,
          highlightMode: 'clickable',
          sectionKey: 'body',
        });
      if (kind === 'conversation') return this._renderConversationSection(lesson.conversation);
      if (kind === 'application')
        return this._renderTextSection(lesson.application, '应用文', {
          ttsMode: 'reading:application',
          lesson: lesson,
          highlightMode: 'clickable',
          sectionKey: 'application',
        });
      if (kind === 'vocab') return this._renderReadingVocabSection();
      if (kind === 'study_window')
        return this._renderTextSection(lesson.study_window, '学习之窗', {
          lesson: lesson,
          highlightMode: 'clickable',
        });
      if (kind === 'counter_grammar') return this._renderGrammarSection(lesson.counter_grammar, '数词');
      if (kind === 'grammar') return this._renderGrammarSection(lesson.grammar, '语法');
      if (kind === 'unit_summary') return this._renderGrammarSection(lesson.unit_summary, '单元总结');
      if (kind === 'grammar_library') return this._renderGrammarLibraryFallback();
      return '';
    },

    _renderConversationSection: function (section) {
      if (!section) return '';
      var turns = section.dialogue || [];
      if (!this._cleanValue(section.context) && !turns.length) return '';
      var sectionTitle = this._cleanValue(section.title) || '会话';
      var ttsMode = 'dialogue:conversation';
      var html =
        '<section class="tb-section tb-section-dialogue" data-tts-mode="' +
        this._esc(ttsMode) +
        '"><header class="tb-section-head tb-meta-noselect"><span class="tb-section-badge" lang="' +
        (TextbookLoader.isKotobaBook(this.currentBookId) && section.title ? 'ja' : 'zh-CN') +
        '">' +
        this._esc(sectionTitle) +
        '</span>';
      if (turns.length)
        html +=
          '<div class="tb-section-actions">' +
          this._ttsSectionButton(ttsMode, sectionTitle) +
          this._renderTtsFeedback(ttsMode, '') +
          '</div>';
      html += '</header>';
      if (section.context)
        html +=
          '<div class="tb-section-body"><p class="tb-paragraph tb-listening-note" lang="ja">' +
          this._renderMaybeChunkedText(section.context, 'conversation', null, 'clickable') +
          '</p></div>';
      if (turns.length) {
        html += '<div class="tb-dialogue-flow">';
        for (var i = 0; i < turns.length; i++) {
          var turn = turns[i] || {};
          html += this._dialogueSceneNote(section, turn, turns[i - 1]);
          var playBtnHtml =
            '<button class="tb-turn-play-btn tb-meta-noselect" data-tts-mode="' +
            this._esc(ttsMode) +
            '" data-turn-idx="' +
            i +
            '" title="播放此句" aria-label="播放此句">' +
            uiIcon('volume') +
            '</button>';
          html +=
            '<div class="tb-dialogue-turn">' +
            (turn.speaker
              ? '<span class="tb-dialogue-speaker tb-meta-noselect" lang="ja">' +
                this._esc(turn.speaker) +
                '</span>'
              : '') +
            '<div><p class="tb-dialogue-text" lang="ja">' +
            this._renderMaybeChunkedText(turn.text || '', 'conversation', i, 'clickable') +
            playBtnHtml +
            '</p>' +
            (section.original_turns ? this._renderTranslation(this._dialogueTurnTranslation(i)) : '') +
            '</div></div>';
        }
        html += '</div>';
      }
      html += '</section>';
      return html;
    },

    _renderPhoneticSection: function (groups, lesson) {
      var phoneticImage = this._resolvePhoneticImageConfig(lesson);
      if ((!groups || !groups.length) && !phoneticImage) return '';
      var html =
        '<section class="tb-section"><header class="tb-section-head tb-meta-noselect"><span class="tb-section-badge">发音</span></header>';
      if (phoneticImage)
        html +=
          '<div class="tb-phonetic-lead-media">' +
          this._renderResolvedSectionImage(phoneticImage, { teaching: true }) +
          '</div>';
      html += '<div class="tb-item-list tb-item-list-embedded">';
      for (var i = 0; i < groups.length; i++) {
        var group = groups[i] || {};
        var vocab = group.vocabulary || [];
        html +=
          '<details class="tb-item tb-phonetic-group" open><summary><div class="tb-item-title-row"><strong class="tb-item-title">' +
          this._esc(this._cleanValue(group.group) || '分组 ' + (i + 1)) +
          '</strong><span class="tb-item-count">' +
          vocab.length +
          ' 词</span></div></summary><div class="tb-item-body">';
        // Local pronunciation grid: the Japanese word leads, its reading and
        // meaning follow; entries wrap as whole units on narrow screens.
        html += '<ul class="tb-phonetic-grid">';
        for (var j = 0; j < vocab.length; j++) {
          var row = vocab[j] || {};
          var word = this._cleanValue(row.surface || row.word_info_raw || row.word) || '-';
          var reading = this._cleanValue(row.reading || row.kana);
          var meaning = this._cleanValue(row.meaning);
          html +=
            '<li class="tb-phonetic-entry"><span class="tb-phonetic-word" lang="ja">' +
            this._esc(word) +
            '</span>' +
            (reading && reading !== word
              ? '<span class="tb-phonetic-reading" lang="ja">' + this._esc(reading) + '</span>'
              : '') +
            (meaning ? '<span class="tb-phonetic-meaning">' + this._esc(meaning) + '</span>' : '') +
            '</li>';
        }
        html += '</ul></div></details>';
      }
      html += '</div></section>';
      return html;
    },

    _resolvePhoneticImageConfig: function (lesson) {
      if (!lesson) return null;
      var src = this._cleanValue(lesson.phonetic_image_path || lesson.phonetic_image_src);
      if (!src) return null;
      var width = parseInt(lesson.phonetic_image_width, 10);
      var height = parseInt(lesson.phonetic_image_height, 10);
      return {
        src: src,
        alt: this._cleanValue(lesson.phonetic_image_alt) || this._buildSectionImageAlt(lesson, '发音'),
        caption: this._cleanValue(lesson.phonetic_image_caption),
        width: isNaN(width) ? 0 : width,
        height: isNaN(height) ? 0 : height,
        position: 'section_header',
      };
    },

    _renderGrammarSection: function (section, fallbackTitle) {
      if (!section || (!(section.items || []).length && !this._cleanValue(section.text))) return '';
      if (TextbookLoader.isKotobaBook(this.currentBookId) && (section.items || []).length)
        return this._renderCurriculumGrammarSection(section, fallbackTitle);
      var html =
        '<section class="tb-section tb-section-grammar"><header class="tb-section-head tb-meta-noselect"><span class="tb-section-badge">' +
        this._esc(this._cleanValue(section.title) || fallbackTitle) +
        '</span>' +
        (section.subtitle
          ? '<span class="tb-section-meta">' + this._esc(this._cleanValue(section.subtitle)) + '</span>'
          : '') +
        '</header>';
      if (section.text) {
        html += '<div class="tb-section-body">';
        var parts = this._splitParagraphs(section.text);
        for (var i = 0; i < parts.length; i++)
          html += '<p class="tb-paragraph" lang="ja">' + this._formatText(parts[i], 'clickable') + '</p>';
        html += '</div>';
      }
      if ((section.items || []).length) {
        html += '<div class="tb-item-list tb-item-list-embedded">';
        for (var j = 0; j < section.items.length; j++) {
          var item = section.items[j] || {};
          var source = this._grammarSourceLabel(item.source_origin);
          html +=
            '<details class="tb-item tb-grammar-item"><summary><div class="tb-item-title-row"><strong class="tb-item-title">' +
            this._esc(this._cleanValue(item.point) || '条目 ' + (j + 1)) +
            '</strong>' +
            (source
              ? '<span class="tb-item-source" title="' +
                this._esc('本课“' + source + '”中的用例') +
                '">' +
                this._esc('出自' + source) +
                '</span>'
              : '') +
            '</div>' +
            (item.anchor_sentence
              ? '<div class="tb-item-sub">' +
                this._formatText(this._cleanValue(item.anchor_sentence), 'clickable') +
                '</div>'
              : '') +
            '</summary><div class="tb-item-body">' +
            (item.description ? this._detailRow('说明', this._cleanValue(item.description)) : '') +
            this._renderExamples(item.examples, 'clickable') +
            '</div></details>';
        }
        html += '</div>';
      }
      html += '</section>';
      return html;
    },

    // source_origin is a data key. Show the matching section title as it reads
    // in this lesson; self-references (grammar, unit summary) and unknown keys
    // are not shown.
    _grammarSourceLabel: function (origin) {
      var lesson = this.currentLesson && this.currentLesson.lesson;
      var sections = {
        body: { section: lesson && lesson.body, fallback: '本文' },
        conversation: { section: lesson && lesson.conversation, fallback: '会话' },
        application: { section: lesson && lesson.application, fallback: '应用文' },
      };
      var entry = Object.prototype.hasOwnProperty.call(sections, this._cleanValue(origin))
        ? sections[this._cleanValue(origin)]
        : null;
      if (!entry) return '';
      return this._cleanValue(entry.section && entry.section.title) || entry.fallback;
    },

    _renderGrammarLibraryFallback: function () {
      if (!this.currentGrammar.length) return '';
      var html =
        '<section class="tb-section tb-section-grammar"><header class="tb-section-head tb-meta-noselect"><span class="tb-section-badge">语法</span><span class="tb-section-meta">来自教材语法库</span></header><div class="tb-item-list tb-item-list-embedded">';
      for (var i = 0; i < this.currentGrammar.length; i++) {
        var point = this.currentGrammar[i] || {},
          enriched = point.enriched || {};
        html +=
          '<details class="tb-item tb-grammar-item"><summary><div class="tb-item-title-row"><strong class="tb-item-title">' +
          this._esc(this._cleanValue(point.title || enriched.clean_title || point.uid || '-')) +
          '</strong><span class="tb-item-level">' +
          this._esc(this._cleanValue(point.level) || '-') +
          '</span></div><div class="tb-item-sub">' +
          this._esc(this._cleanValue(enriched.core_meaning_zh || point.explanation || '-')) +
          '</div></summary><div class="tb-item-body">' +
          (point.connection ? this._detailRow('接续', this._cleanValue(point.connection)) : '') +
          (point.explanation ? this._detailRow('说明', this._cleanValue(point.explanation)) : '') +
          this._renderExamples(point.original_examples, 'clickable') +
          '</div></details>';
      }
      return html + '</div></section>';
    },

    _refreshCoursePath: function () {
      this._renderLessonHeading();
      var pathEl = this.sidebarContentEl && this.sidebarContentEl.querySelector('[data-course-path]');
      if (!pathEl) return;
      var active = document.activeElement;
      var hadFocus = active && pathEl.contains(active);
      var action = hadFocus ? active.getAttribute('data-course-action') : '';
      var step = hadFocus ? active.getAttribute('data-course-step') : '';
      var lesson = this.currentLesson && this.currentLesson.lesson;
      var meta = (this.currentLesson && this.currentLesson.meta) || {};
      pathEl.outerHTML = this._renderCoursePath(lesson, meta);
      this._applyCoursePathCollapsed();
      if (hadFocus) {
        pathEl = this.sidebarContentEl.querySelector('[data-course-path]');
        var candidates = pathEl.querySelectorAll('[data-course-action]');
        var target = null;
        for (var i = 0; i < candidates.length; i++) {
          if (
            candidates[i].getAttribute('data-course-action') === action &&
            (candidates[i].getAttribute('data-course-step') || '') === (step || '') &&
            !candidates[i].disabled &&
            candidates[i].getClientRects().length
          )
            target = candidates[i];
        }
        if (!target) target = pathEl.querySelector('.is-current .tb-course-step-action');
        if (!target) target = pathEl.querySelector('.tb-course-complete:not(:disabled)');
        if (!target || !target.getClientRects().length)
          target = pathEl.querySelector('.tb-course-path-toggle');
        if (target) target.focus({ preventScroll: true });
      }
    },

    _setCourseStep: function (step, status) {
      var path = this._ensureCoursePath();
      var allowed = { vocab: true, reading: true, grammar: true, review: true };
      if (!allowed[step]) return false;
      if (status !== 'todo' && status !== 'active' && status !== 'done' && status !== 'skipped') return false;
      if (status === 'active') {
        // Starting a step should reveal its controls even though the compact
        // sidebar path is folded by default when a lesson is first opened.
        this._coursePathManuallyCollapsed = false;
      }
      path.steps[step] = status;
      if (status === 'done' || status === 'skipped') path.steps[step] = status;
      this._syncCoursePathCursor(path);
      this._refreshCoursePath();
      this._persistCourseNavigation();
      return true;
    },

    markCourseStep: function (step, status) {
      return this._setCourseStep(step, status || 'done');
    },

    _courseWordObjects: function () {
      var allWords =
        window.taxonomyManager && Array.isArray(window.taxonomyManager.allWords)
          ? window.taxonomyManager.allWords
          : [];
      var linked = TextbookLoader.resolveStudyVocabulary(this.currentVocab, allWords);
      var result = [];
      var seen = {};
      for (var j = 0; j < this.currentVocab.length && result.length < 5; j++) {
        var word = linked[j];
        if (!word || seen[String(word.index)]) continue;
        seen[String(word.index)] = true;
        result.push(word);
      }
      return result;
    },

    _openCourseVocab: function () {
      // Keep the path actions available after this explicit jump so the learner
      // can mark preview complete without reopening the sidebar disclosure.
      this._coursePathManuallyCollapsed = false;
      this._applyCoursePathCollapsed();
      var section = this.readerEl && this.readerEl.querySelector('[data-reading-vocab-section]');
      if (section) {
        if (this._bookPager) {
          this._bookPager.show(section.querySelector('.tb-section-head') || section);
          this._bookPager.reveal();
        } else section.scrollIntoView({ behavior: 'auto', block: 'start', inline: 'nearest' });
      }
      var first = section && section.querySelector('[data-vocab-detail-index]');
      if (first) {
        first.focus({ preventScroll: true });
      }
    },

    // Shared by the drawer's “继续本课” and the lesson heading.
    _continueCourse: function () {
      var path = this._ensureCoursePath();
      if (path.currentStep) this._handleCourseAction('step', path.currentStep);
      else this._continueCourseReading();
    },

    _continueCourseReading: function () {
      var readerBody = this.readerEl && this.readerEl.querySelector('.tb-reader-body');
      if (readerBody) {
        readerBody.scrollIntoView({ behavior: 'smooth', block: 'start' });
        readerBody.focus({ preventScroll: true });
      }
    },

    _openCourseGrammar: function () {
      var uids = [];
      for (var i = 0; i < this.currentGrammar.length; i++) {
        var uid = this.currentGrammar[i] && this.currentGrammar[i].uid;
        if (uid && uids.indexOf(uid) === -1) uids.push(uid);
      }
      if (!uids.length) {
        this._setCourseStep('grammar', 'skipped');
        return;
      }
      var path = this._ensureCoursePath();
      var context = {
        bookId: this.currentBookId,
        lessonId: this.currentLessonId,
        lessonLabel: path.lessonLabel,
        title: path.title,
        kind: 'textbook-course',
        courseStep: 'grammar',
        grammarUids: uids,
        readerScrollTop: this.readerEl ? Math.max(0, Number(this.readerEl.scrollTop) || 0) : 0,
        coursePath: path,
      };
      if (window.ModuleSwitcher && window.ModuleSwitcher.openGrammarFromTextbook) {
        window.ModuleSwitcher.openGrammarFromTextbook(context);
      } else if (window.ModuleSwitcher) {
        window.ModuleSwitcher.switchTo('grammar');
      }
    },

    _startCourseReview: function () {
      var words = this._courseWordObjects();
      if (!words.length) {
        this._setCourseStep('review', 'skipped');
        return;
      }
      if (this._courseActionBusy) return;
      this._courseActionBusy = true;
      this._setCourseStep('review', 'active');
      var path = this._ensureCoursePath();
      var source = {
        kind: 'textbook-course',
        label: '本课复习 · ' + (path.lessonLabel || this.currentLessonId),
        bookId: this.currentBookId,
        lessonId: this.currentLessonId,
        courseStep: 'review',
        returnModule: 'lesson',
        returnReaderScrollTop: this.readerEl ? Math.max(0, Number(this.readerEl.scrollTop) || 0) : 0,
        coursePath: path,
      };
      var self = this;
      var switchPromise =
        window.ModuleSwitcher && window.ModuleSwitcher.switchTo
          ? window.ModuleSwitcher.switchTo('vocab')
          : Promise.resolve();
      Promise.resolve(switchPromise)
        .then(function () {
          var started =
            window.appConfig && window.appConfig.startStudySession
              ? window.appConfig.startStudySession(words, {
                  shuffle: false,
                  limit: 5,
                  practiceMode: 'mixed',
                  source: source,
                })
              : false;
          if (!started) self._setCourseStep('review', 'todo');
          else if (window.ModuleSwitcher && window.ModuleSwitcher.setCourseStudyContext)
            window.ModuleSwitcher.setCourseStudyContext(source);
        })
        .catch(function () {
          self._setCourseStep('review', 'todo');
        })
        .then(function () {
          self._courseActionBusy = false;
        });
    },

    _completeCourse: function () {
      var path = this._ensureCoursePath();
      if (!this._courseProgress(path).ready || path.completed) return;
      path.completed = true;
      path.completedAt = new Date().toISOString();
      path.currentStep = '';
      this._refreshCoursePath();
      this._persistCourseNavigation();
      if (window.ModuleSwitcher && window.ModuleSwitcher.switchTo)
        window.ModuleSwitcher.switchTo('dashboard');
    },

    _handleCourseAction: function (action, step) {
      var path = this._ensureCoursePath();
      if (!step || !Object.prototype.hasOwnProperty.call(path.steps, step)) return;
      if (action === 'skip') {
        if (path.steps[step] !== 'done') this._setCourseStep(step, 'skipped');
        return;
      }
      if (action === 'done') {
        if (path.steps[step] === 'active') this._setCourseStep(step, 'done');
        return;
      }
      if (action !== 'step') return;
      if (path.steps[step] === 'skipped') this._setCourseStep(step, 'todo');
      if (path.steps[step] === 'todo') this._setCourseStep(step, 'active');
      if (step === 'vocab') {
        if (!this.currentVocab.length) {
          this._setCourseStep('vocab', 'skipped');
          return;
        }
        this._openCourseVocab();
      } else if (step === 'reading') {
        this._continueCourseReading();
      } else if (step === 'grammar') {
        this._openCourseGrammar();
      } else if (step === 'review') {
        this._startCourseReview();
      }
    },

    restoreReadingContext: function (context) {
      context = context && typeof context === 'object' ? context : {};
      var self = this;
      var targetBook =
        typeof context.bookId === 'string' && context.bookId ? context.bookId : this.currentBookId;
      var targetLesson =
        typeof context.lessonId === 'string' && context.lessonId ? context.lessonId : this.currentLessonId;
      // A plan or link saved for a book this copy does not offer (the public site
      // keeps XinBian local) opens the current lesson instead of a failed catalog.
      if (!window.JPLearn.textbooks.isOffered(targetBook)) {
        targetBook = this.currentBookId;
        targetLesson = this.currentLessonId;
      }
      var same =
        targetBook === this.currentBookId && targetLesson === this.currentLessonId && this.currentLesson;
      var promise = Promise.resolve();
      if (!same) {
        if (context.coursePath) this.coursePath = this._normalizeCoursePath(context.coursePath);
        var needsBook = targetBook && targetBook !== self.currentBookId;
        promise = (needsBook ? self._loadBook(targetBook) : Promise.resolve(true)).then(function (loaded) {
          if (!loaded || self.currentBookId !== targetBook) return false;
          return self.showLesson(targetLesson);
        });
      }
      return promise.then(function (loaded) {
        if (loaded === false || self.currentBookId !== targetBook || self.currentLessonId !== targetLesson)
          return false;
        if (context.coursePath)
          self.coursePath = self._normalizeCoursePath(context.coursePath) || self.coursePath;
        var scrollTop = Math.max(0, Number(context.readerScrollTop) || 0);
        if (self.readerEl) self.readerEl.scrollTop = scrollTop;
        self._refreshCoursePath();
        self._persistCourseNavigation();
        return true;
      });
    },

    _bindReaderEvents: function () {
      var self = this;
      if (!this.readerEl) return;
      this.readerEl.onpointerover = function (event) {
        var target = event.target;
        var chunk = target && target.closest ? target.closest('[data-text-chunk]') : null;
        if (!chunk || (event.relatedTarget && chunk.contains(event.relatedTarget))) return;
        if (self._chunkDetailHasFocus()) return;
        // A hover preview never displaces a surface opened on purpose. Opening a
        // word detail can move text under a resting pointer, and the crossing the
        // browser then reports would otherwise close that detail again (FIX-32).
        var layer = window.JPLearn.topLayer;
        var current = layer ? layer.getCurrent() : '';
        if (current && current !== 'text-chunk-detail') return;
        self._showChunkDetail(chunk, false);
      };
      this.readerEl.onpointerout = function (event) {
        var target = event.target;
        var chunk = target && target.closest ? target.closest('[data-text-chunk]') : null;
        if (!chunk || (event.relatedTarget && chunk.contains(event.relatedTarget))) return;
        self._scheduleChunkDetailClose();
      };
      this.readerEl.onclick = function (event) {
        var target = event.target;
        if (!target || !target.closest) return;

        var textChunk = target.closest('[data-text-chunk]');
        if (textChunk) {
          event.preventDefault();
          self._showChunkDetail(textChunk, event.detail === 0);
          return;
        }

        var vocabDetail = target.closest('[data-vocab-detail-index]');
        if (vocabDetail) {
          self._showVocabDetail(
            vocabDetail.getAttribute('data-vocab-detail-index'),
            vocabDetail.closest('.tb-reading-vocab-row') || vocabDetail,
            event.detail === 0,
          );
          return;
        }

        if (self._handleInlineHighlightClick(event)) return;

        var lessonStep = target.closest('[data-lesson-step]');
        if (lessonStep) {
          self._openAdjacentLesson(lessonStep.getAttribute('data-lesson-step'), true);
          return;
        }

        var kanaBtn = target.closest('[data-kana-clip]');
        if (kanaBtn) {
          self._showKanaDetail(kanaBtn);
          self._playKanaClip(
            kanaBtn.getAttribute('data-kana-clip') || '',
            kanaBtn.getAttribute('data-kana-label') || '',
          );
          return;
        }
        var exerciseChoice = target.closest('[data-exercise-choice]');
        if (exerciseChoice) {
          self._answerExercise(exerciseChoice);
          return;
        }
        var exerciseRetry = target.closest('[data-exercise-retry]');
        if (exerciseRetry) {
          self._resetExercise(exerciseRetry);
          return;
        }

        var turnPlayBtn = target.closest('.tb-turn-play-btn');
        if (turnPlayBtn) {
          var turnMode = turnPlayBtn.getAttribute('data-tts-mode') || '';
          var turnIdx = parseInt(turnPlayBtn.getAttribute('data-turn-idx'), 10);
          if (turnMode && !isNaN(turnIdx)) {
            self._playSingleDialogueTurn(turnMode, turnIdx);
          }
          return;
        }

        var btn = target.closest('.tb-tts-btn');
        if (!btn) return;
        var mode = btn.getAttribute('data-tts-mode') || '';
        if (!mode) return;
        self._handleTtsButtonClick(mode);
      };
    },

    _bindDetailEvents: function () {
      var self = this;
      if (!this.detailEl) return;
      this.detailEl.onclick = function (event) {
        var target = event && event.target;
        var btn = target && target.closest ? target.closest('.tb-tts-btn') : null;
        if (btn) {
          event.preventDefault();
          event.stopPropagation();
          self._handleTtsButtonClick(btn.getAttribute('data-tts-mode') || '');
          return;
        }
        self._handleInlineHighlightClick(event);
      };
    },

    _handleInlineHighlightClick: function (event) {
      var target = event && event.target;
      if (!target || !target.closest) return false;
      var jump = target.closest('.tb-inline-highlight-link');
      if (!jump) return false;
      event.preventDefault();
      this._jumpToVocabEntry(jump.getAttribute('data-vocab-anchor') || '', jump, event.detail === 0);
      return true;
    },

    _updateStatus: function () {
      if (!window.ModuleSwitcher || !window.ModuleSwitcher.setTextbookStatus) return;
      var book = this._getCurrentBookMeta();
      window.ModuleSwitcher.setTextbookStatus({
        bookLabel: (book.label || this.currentBookId) + (book.level ? ' / ' + book.level : ''),
        lessonLabel:
          this.currentLesson && this.currentLesson.lesson
            ? this._buildLessonLabel(this.currentLesson.lesson)
            : this.currentLessonId || '-',
        vocabCount: this.currentVocab.length || 0,
        grammarCount: this.currentInlineGrammarCount || this.currentGrammar.length || 0,
      });
    },

    _getCurrentBookMeta: function () {
      for (var i = 0; i < this.books.length; i++)
        if (this.books[i].id === this.currentBookId) return this.books[i];
      return { id: this.currentBookId, label: this.currentBookId, level: '' };
    },

    _normalizeDeclaredType: function (type) {
      var text = this._normalizeSectionLabel(type);
      if (!text) return '';
      if (text.indexOf('发音') !== -1 || text.indexOf('發音') !== -1) return 'phonetic';
      if (text.indexOf('前文') !== -1 || text.indexOf('本文') !== -1) return 'body';
      if (text.indexOf('会話') !== -1 || text.indexOf('會話') !== -1 || text.indexOf('会话') !== -1)
        return 'conversation';
      if (
        text.indexOf('読解') !== -1 ||
        text.indexOf('讀解') !== -1 ||
        text.indexOf('应用文') !== -1 ||
        text.indexOf('應用文') !== -1
      )
        return 'application';
      if (text.indexOf('学習の窓') !== -1 || text.indexOf('学习之窗') !== -1) return 'study_window';
      if (text.indexOf('数詞') !== -1 || text.indexOf('数词') !== -1) return 'counter_grammar';
      if (text.indexOf('単元') !== -1 || text.indexOf('单元') !== -1) return 'unit_summary';
      if (text.indexOf('解説') !== -1 || text.indexOf('解说') !== -1 || text.indexOf('言葉と表現') !== -1)
        return 'grammar';
      return '';
    },

    _hasSectionContent: function (lesson, kind) {
      if (!lesson) return false;
      if (kind === 'phonetic') return !!(lesson.phonetic_sections && lesson.phonetic_sections.length);
      if (kind === 'foundation_intro') return this._hasFoundationIntro(lesson);
      if (kind === 'foundation_notes') return this._hasFoundationNotes(lesson);
      if (kind === 'exercises') return !!this._lessonExercises(lesson).length;
      if (kind === 'body') return !!this._cleanValue(lesson.body && lesson.body.text);
      if (kind === 'conversation')
        return !!(
          this._cleanValue(lesson.conversation && lesson.conversation.context) ||
          ((lesson.conversation && lesson.conversation.dialogue) || []).length
        );
      if (kind === 'application') return !!this._cleanValue(lesson.application && lesson.application.text);
      if (kind === 'vocab') return !!this.currentVocab.length;
      if (kind === 'study_window')
        return !!(
          this._cleanValue(lesson.study_window && lesson.study_window.text) ||
          this._cleanValue(lesson.study_window && lesson.study_window.subtitle)
        );
      if (kind === 'counter_grammar')
        return !!(
          ((lesson.counter_grammar && lesson.counter_grammar.items) || []).length ||
          this._cleanValue(lesson.counter_grammar && lesson.counter_grammar.text)
        );
      if (kind === 'grammar')
        return !!(
          ((lesson.grammar && lesson.grammar.items) || []).length ||
          this._cleanValue(lesson.grammar && lesson.grammar.text)
        );
      if (kind === 'unit_summary')
        return !!(
          ((lesson.unit_summary && lesson.unit_summary.items) || []).length ||
          this._cleanValue(lesson.unit_summary && lesson.unit_summary.text)
        );
      if (kind === 'grammar_library') return !!this.currentGrammar.length;
      return false;
    },

    _hasAnyInlineGrammar: function (lesson) {
      return (
        this._hasSectionContent(lesson, 'grammar') ||
        this._hasSectionContent(lesson, 'counter_grammar') ||
        this._hasSectionContent(lesson, 'unit_summary')
      );
    },

    _countInlineGrammar: function (item) {
      var lesson = item && item.lesson;
      if (!lesson) return 0;
      return (
        ((lesson.grammar && lesson.grammar.items) || []).length +
        ((lesson.counter_grammar && lesson.counter_grammar.items) || []).length +
        ((lesson.unit_summary && lesson.unit_summary.items) || []).length
      );
    },

    _buildLessonLabel: function (meta) {
      if (!meta) return '-';
      if (meta.lesson_label) return this._cleanValue(meta.lesson_label);
      if (meta.lesson_no !== null && meta.lesson_no !== undefined)
        return '第 ' + this._pad2(meta.lesson_no) + ' 课';
      if (meta.review_unit_no !== null && meta.review_unit_no !== undefined)
        return '复习 ' + this._pad2(meta.review_unit_no);
      return this._cleanValue(meta.item_id || meta.lesson_id || '-');
    },

    _buildLessonKindLabel: function (meta) {
      if (!meta) return '课文';
      if (meta.is_review_unit || meta.item_type === 'review_unit') return '复习';
      if (meta.item_type === 'special_lesson') return '专项';
      return '课文';
    },

    _setReaderPlaceholder: function (text) {
      if (window.StateView) {
        window.StateView.mount(this.readerEl, {
          kind: 'empty',
          className: 'tb-reader-placeholder-state',
          icon: 'book',
          title: text || '请选择课文开始阅读',
          message: '从左侧选择一课，正文、词汇和语法会在这里展开。',
        });
      } else {
        this.readerEl.innerHTML =
          '<div class="tb-reader-placeholder">' + this._esc(text || '请选择课文开始阅读') + '</div>';
      }
    },
    _setReaderError: function (text, retry, err) {
      var detail = err && err.message ? err.message : '';
      if (window.StateView) {
        window.StateView.mount(this.readerEl, {
          kind: 'error',
          className: 'tb-reader-error-state',
          icon: 'book',
          title: text || '课文加载失败',
          message: '课文阅读暂不可用，可以重试；当前学习进度仍然保留。',
          details: detail,
          action: retry
            ? { id: 'retry-textbook', label: '重试课文', icon: 'rotate-ccw', onClick: retry }
            : null,
        });
      } else {
        this.readerEl.innerHTML =
          '<div class="tb-reader-error">' + this._esc(text || '课文加载失败') + '</div>';
      }
    },
    _setDetailPlaceholder: function (text) {
      if (window.StateView) {
        window.StateView.mount(this.detailEl, {
          kind: 'empty',
          className: 'panel-empty-state',
          icon: 'info',
          title: '选择课文查看本课词汇',
          message: text || '进入一课后，这里会列出课内词汇；点击正文高亮可直接定位到对应词条。',
        });
      } else {
        this.detailEl.innerHTML =
          '<div class="panel-empty-state">' +
          uiIcon('info') +
          '<strong>选择课文查看本课词汇</strong><p>' +
          this._esc(text || '进入一课后，这里会列出课内词汇；点击正文高亮可直接定位到对应词条。') +
          '</p></div>';
      }
    },
    _showLoading: function (text) {
      var outline = this.readerEl.querySelector('.tb-outline-slot');
      if (outline) outline.remove();
      if (window.JPLearn.topLayer) window.JPLearn.topLayer.release('textbook-outline');
      if (window.StateView)
        window.StateView.mount(this.loadingEl, {
          kind: 'loading',
          title: '正在加载课文',
          message: text || '请稍候…',
        });
      if (this.loadingDetailEl) this.loadingDetailEl.textContent = text || '';
      if (this.loadingEl) {
        this.loadingEl.classList.remove('hidden');
        this.loadingEl.setAttribute('aria-busy', 'true');
      }
    },
    _hideLoading: function () {
      if (this.loadingEl) {
        this.loadingEl.classList.add('hidden');
        this.loadingEl.setAttribute('aria-busy', 'false');
      }
    },
    _formatPageRange: function (range) {
      if (!range || !range.length) return '';
      return range.length === 1 ? 'P.' + range[0] : 'P.' + range[0] + '-' + range[range.length - 1];
    },
    _normalizeSectionLabel: function (label) {
      return String(label || '')
        .replace(/\s+/g, '')
        .replace(/[（()）]/g, '')
        .trim()
        .toLowerCase();
    },
    _toDomToken: function (value) {
      return (
        String(value || '')
          .replace(/[^A-Za-z0-9_-]+/g, '-')
          .replace(/^-+|-+$/g, '') || 'x'
      );
    },
    _cleanValue: function (value) {
      if (value === null || value === undefined) return '';
      var text = String(value).trim();
      if (!text) return '';
      var low = text.toLowerCase();
      return low === 'null' || low === 'undefined' || low === 'nan' ? '' : text;
    },
    _pushUnique: function (list, value) {
      var clean = this._cleanValue(value);
      if (clean && list.indexOf(clean) === -1) list.push(clean);
    },
    _renderTtsFeedback: function (mode, idleText) {
      return (
        '<span class="tb-tts-feedback"><span class="tb-tts-status" data-tts-status="' +
        this._esc(mode) +
        '" data-idle-text="' +
        this._esc(idleText || '') +
        '" aria-live="polite"></span><span class="tb-tts-progress" data-tts-progress="' +
        this._esc(mode) +
        '" role="progressbar" aria-label="朗读进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span></span></span></span>'
      );
    },
    _formatAudioClock: function (value) {
      var seconds = Math.max(0, Math.floor(Number(value) || 0));
      return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
    },
    _pad2: function (value) {
      var num = parseInt(value, 10);
      return isNaN(num) ? String(value || '--') : String(num).padStart(2, '0');
    },
    _esc: function (s) {
      return window.JPLearn.html.escape(s);
    },
  },
);
