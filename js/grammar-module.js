/**
 * grammar-module.js
 * Orchestrator for the Grammar Module.
 * Manages sub-view state and inter-component navigation.
 *
 * Sub-views:
 *   'grammar-list'   — paginated grammar card grid
 *   'lesson-list'    — lesson card grid
 *   'lesson-reader'  — full lesson reading with inline grammar
 *
 * Exposes window.grammarModule for cross-component callbacks.
 */
function GrammarModule(opts) {
    // DOM containers
    this.mainContainer    = document.getElementById(opts.mainContainerId);
    this.detailContainer  = document.getElementById(opts.detailContainerId);
    this.grammarListEl    = document.getElementById(opts.grammarListId);
    this.lessonListEl     = document.getElementById(opts.lessonListId);
    this.lessonReaderEl   = document.getElementById(opts.lessonReaderId);
    this.sidebarContentEl = document.getElementById(opts.sidebarContentId || 'gmSidebarContent');

    this.currentView = null;  // 'grammar-list' | 'lesson-list' | 'lesson-reader'
    this.initialized = false;
    this._lessonListReady = false; // has lesson list been rendered
    this._pendingLessonId = null;
    this.courseContext = null;
    this.courseGrammar = [];
    this._courseGrammarContext = null; // context whose grammar list is rendered
    this._courseGrammarError = null; // context whose grammar failed to load
    this.courseNotice = ''; // why a saved lesson path became the whole list

    // Component instances
    this.detailPanel  = new GrammarDetailPanel(opts.detailContainerId);
    this.grammarList  = new GrammarListView(opts.grammarListId, this.detailPanel);
    this.lessonList   = new LessonListView(opts.lessonListId);
    this.lessonReader = new LessonReaderView(opts.lessonReaderId, this.detailPanel);

    // Wire callbacks
    var self = this;
    if (window.JPLearn && window.JPLearn.events) {
        window.JPLearn.events.on('reading-layout:change', function() { self._onReadingLayoutChange(); });
    }
    this.lessonList.onSelectLesson = function(lid) { self.showLessonReader(lid); };
    this.lessonList.onRetry = function() {
        if (GrammarLoader.reset) GrammarLoader.reset('lessons');
        self._lessonListReady = false;
        return self._ensureLessonsReady();
    };
    this.lessonReader.onBack = function() { self._switchSubView('lesson-list'); };
    this.lessonReader.onGrammarClick = function(uid) {
        // Detail panel is already updated by lesson-reader.js internally.
        // Do NOT switch the sub-view — stay in the lesson reader.
    };
    this.grammarList.onRendered = function() { self._renderHeading(); };
    this.lessonList.onRendered = function() { self._renderHeading(); };

    // Register globally for cross-component callbacks
    window.grammarModule = this;
}

GrammarModule.prototype = {

    /**
     * Activate the grammar module UI.
     * Called on first entry and each return from vocabulary module.
     */
    activate: function() {
        if (!this.initialized) {
            return this._initialize();
        }
        this.mainContainer.style.display = '';
        if (this.detailContainer) this.detailContainer.parentElement.style.display = '';
        this._renderSidebar();
        this._renderCourseContext();
        return Promise.resolve();
    },

    /**
     * Deactivate — hide all grammar UI without destroying state.
     */
    deactivate: function() {
        if (this.mainContainer) this.mainContainer.style.display = 'none';
        var panel = document.getElementById('grammarDetailPanel');
        if (panel) panel.style.display = 'none';
    },

    _initialize: function() {
        var self = this;
        this.mainContainer.style.display = '';

        // Render sub-view tab bar and sidebar
        this._renderSubTabs();
        this._renderSidebar();
        this._renderCourseContext();

        // Default: show grammar list first
        return this.grammarList.init().then(function() {
            self._switchSubView('grammar-list');
            self.initialized = true;
            self.detailPanel.clear();

            // Preload lessons in background (non-blocking)
            self._ensureLessonsReady();

            // Handle any pending navigation
            if (self._pendingLessonId !== null) {
                var lid = self._pendingLessonId;
                self._pendingLessonId = null;
                self.showLessonReader(lid);
            }
        });
    },

    /**
     * Ensure lesson list is initialized (rendered into DOM).
     * Called proactively after grammar list loads, so lessons are ready
     * when the user switches tabs.
     */
    _ensureLessonsReady: function() {
        if (this._lessonListReady) return Promise.resolve();
        var self = this;
        return this.lessonList.init().then(function() {
            self._lessonListReady = !(GrammarLoader.getLastError && GrammarLoader.getLastError('lessons'));
            return self._lessonListReady;
        }).catch(function(err) {
            console.warn('[GrammarModule] Lesson list init failed:', err);
            self._lessonListReady = false;
            return false;
        });
    },

    _renderSubTabs: function() {
        var tabBar = document.getElementById('gmSubTabs');
        if (!tabBar) return;
        tabBar.innerHTML = '';
        tabBar.hidden = true;
    },

    _normalizeCourseContext: function(context) {
        if (!context || typeof context !== 'object' || Array.isArray(context)) return null;
        var uids = Array.isArray(context.grammarUids) ? context.grammarUids.filter(function(uid) { return typeof uid === 'string' && uid; }) : [];
        return {
            kind: context.kind === 'textbook-course' ? 'textbook-course' : '',
            courseStep: context.courseStep === 'grammar' ? 'grammar' : '',
            bookId: typeof context.bookId === 'string' ? context.bookId : '',
            lessonId: typeof context.lessonId === 'string' ? context.lessonId : '',
            lessonLabel: typeof context.lessonLabel === 'string' ? context.lessonLabel : '',
            title: typeof context.title === 'string' ? context.title : '',
            grammarUids: uids.slice(0, 12),
            readerScrollTop: Math.max(0, Number(context.readerScrollTop) || 0),
            viewedUid: typeof context.viewedUid === 'string' ? context.viewedUid : '',
            coursePath: context.coursePath && typeof context.coursePath === 'object' ? context.coursePath : null
        };
    },

    _renderCourseContext: function() {
        var el = document.getElementById('gmCourseContext');
        if (!el) return;
        var context = this.courseContext;
        var sidebarTools = document.getElementById('gmSidebarTools');
        if (!context || !context.lessonId) {
            el.hidden = true;
            el.innerHTML = '';
            if (sidebarTools) sidebarTools.hidden = this.currentView !== 'grammar-list';
            this._renderHeading();
            return;
        }
        if (sidebarTools) sidebarTools.hidden = true;
        var title = context.lessonLabel || context.lessonId;
        if (context.title) title += ' · ' + context.title;
        el.innerHTML = '<div class="gm-course-context-copy"><span class="gm-course-context-kicker">本课学习路径</span><strong>' + this._esc(title) + '</strong><small>正在查看本课关联语法 · ' + context.grammarUids.length + ' 点</small></div><button type="button" class="btn-secondary gm-course-return" data-course-action="return-textbook">' + uiIcon('arrow-left') + '返回课文</button>';
        el.hidden = false;
        var self = this;
        var button = el.querySelector('[data-course-action="return-textbook"]');
        if (button) button.onclick = function() {
            if (window.ModuleSwitcher && window.ModuleSwitcher.returnToTextbook) window.ModuleSwitcher.returnToTextbook(self.courseContext);
        };
        this._renderHeading();
    },

    showCourseContext: function(context) {
        var normalized = this._normalizeCourseContext(context);
        var textbooks = window.JPLearn && window.JPLearn.textbooks;
        if (normalized && normalized.lessonId && textbooks && !textbooks.isOffered(normalized.bookId)) {
            // PUB-FIX-05: a saved lesson path into a book this copy no longer
            // offers opens the whole list instead of a catalog that is not there.
            this.courseNotice = '上次的本课语法来自本站不再提供的教材，已改为显示全部语法';
            this.clearCourseContext();
            this._switchSubView('grammar-list');
            return Promise.resolve(false);
        }
        this.courseNotice = '';
        this.courseContext = normalized;
        this._courseGrammarError = null;
        this._renderCourseContext();
        this._switchSubView('grammar-list');
        var self = this;
        var current = this.courseContext;
        var loader = window.TextbookLoader && current
            ? window.TextbookLoader.getLessonGrammar(current.bookId, current.lessonId)
            : Promise.resolve([]);
        return Promise.resolve(loader).then(function(points) {
            if (self.courseContext !== current) return false;
            self.courseGrammar = Array.isArray(points) ? points : [];
            self._renderCourseGrammar();
            return true;
        }, function() {
            if (self.courseContext !== current) return false;
            self.courseGrammar = [];
            self._courseGrammarError = current;
            self._renderCourseGrammar();
            return false;
        });
    },

    clearCourseContext: function() {
        this.courseContext = null;
        this.courseGrammar = [];
        if (this.initialized && this.grammarList && this.grammarList._render) this.grammarList._render();
        this._renderCourseContext();
    },

    _renderCourseGrammar: function() {
        if (!this.courseContext || !this.grammarListEl) return;
        var points = this.courseGrammar || [];
        this._courseGrammarContext = this.courseContext;
        // The page heading names the lesson and the point count.
        var html = '<div class="gm-course-grammar-view">';
        if (this._courseGrammarError === this.courseContext) {
            var module = this;
            this.grammarListEl.innerHTML = html + '</div>';
            window.JPLearn.StateView.mount(this.grammarListEl.firstChild, {
                kind: 'error',
                title: '本课语法暂时无法读取',
                message: '可以重试，或先返回课文继续学习。',
                action: { label: '重试', icon: 'rotate-ccw', onClick: function() { return module.showCourseContext(module.courseContext); } }
            });
            this._renderHeading();
            return;
        }
        if (!points.length) {
            html += '<div class="gm-no-data">本课暂无可关联的语法点。</div></div>';
            this.grammarListEl.innerHTML = html;
            this._renderHeading();
            return;
        }
        html += '<div class="gm-course-grammar-list">';
        for (var i = 0; i < points.length; i++) {
            var point = points[i] || {};
            var enriched = point.enriched || {};
            var title = point.title || enriched.clean_title || point.uid || '语法点';
            var meaning = point.explanation || enriched.core_meaning_zh || '点击查看本课说明与例句。';
            html += '<button type="button" class="gm-course-grammar-card" data-course-grammar-uid="' + this._esc(point.uid || '') + '"><span class="gm-course-grammar-meta">' + this._esc(point.level || '教材') + '</span><strong>' + this._esc(title) + '</strong><span>' + this._esc(meaning) + '</span><em>查看详情 ' + uiIcon('chevron-right') + '</em></button>';
        }
        html += '</div></div>';
        this.grammarListEl.innerHTML = html;
        var self = this;
        var cards = this.grammarListEl.querySelectorAll('[data-course-grammar-uid]');
        for (var j = 0; j < cards.length; j++) cards[j].addEventListener('click', function(event) {
            self._showCourseGrammarDetail(
                this.getAttribute('data-course-grammar-uid'),
                this,
                event.detail === 0
            );
        });
        this._renderHeading();
    },

    _showCourseGrammarDetail: function(uid, anchor, focusPopup) {
        var point = null;
        for (var i = 0; i < this.courseGrammar.length; i++) {
            if (this.courseGrammar[i] && this.courseGrammar[i].uid === uid) { point = this.courseGrammar[i]; break; }
        }
        if (!point || !this.detailContainer) return;
        if (this.courseContext) this.courseContext.viewedUid = uid;
        var enriched = point.enriched || {};
        var title = point.title || enriched.clean_title || point.uid || '语法点';
        var explanation = point.explanation || enriched.core_meaning_zh || '暂无说明';
        var examples = Array.isArray(point.original_examples) ? point.original_examples : [];
        var html = '<div class="gm-course-detail"><span class="gm-course-detail-kicker">本课语法 · ' + this._esc(point.level || '教材') + '</span><h2>' + this._esc(title) + '</h2><p class="gm-course-detail-explanation">' + this._esc(explanation) + '</p>';
        if (point.connection) html += '<div class="gm-course-detail-row"><strong>接续</strong><span>' + this._esc(point.connection) + '</span></div>';
        if (examples.length) {
            html += '<div class="gm-course-detail-examples"><strong>例句</strong>';
            for (var j = 0; j < examples.length && j < 5; j++) {
                var example = examples[j];
                html += '<div>' + this._esc(typeof example === 'string' ? example : (example && (example.ja || example.text) || '')) + '</div>';
            }
            html += '</div>';
        }
        html += '<button type="button" class="btn-secondary gm-course-detail-return" data-course-action="return-textbook">' + uiIcon('arrow-left') + '返回课文</button></div>';
        this.detailContainer.innerHTML = html;
        if (window.PanelLayout) {
            window.PanelLayout.expandDetail('grammar', anchor, { focus: !!focusPopup });
        }
        var back = this.detailContainer.querySelector('[data-course-action="return-textbook"]');
        var self = this;
        if (back) back.onclick = function() {
            if (window.ModuleSwitcher && window.ModuleSwitcher.returnToTextbook) window.ModuleSwitcher.returnToTextbook(self.courseContext);
        };
        this._renderHeading();
    },

    _switchToView: function(v) {
        var self = this;
        if (v === 'lesson-list') {
            if (!this._lessonListReady) {
                // Loading in progress, show a brief loading state
                this._switchSubView('lesson-list');
                this.lessonListEl.innerHTML = '<div class="gm-detail-loading">' + uiIcon('library') + '辅助课文加载中…</div>';
                this._ensureLessonsReady().then(function() {
                    // Re-render by calling init only if not rendered (init is idempotent)
                    self.lessonList._render();
                    if (self._lessonListReady) self.lessonList._bindEvents();
                });
            } else {
                this._switchSubView('lesson-list');
            }
        } else {
            this._switchSubView(v);
        }
    },

    _renderSidebar: function() {
        var el = this.sidebarContentEl;
        if (!el) return;
        var self = this;
        el.innerHTML =
            '<div class="gm-sidebar-nav">' +
            '<button class="gm-sidebar-nav-btn" id="gmSideNavGrammar" data-view="grammar-list">' + uiIcon('grammar') + '语法点</button>' +
            '<button class="gm-sidebar-nav-btn" id="gmSideNavLesson" data-view="lesson-list">' + uiIcon('book') + '辅助课文</button>' +
            '</div>' +
            '<hr class="sidebar-divider">' +
            '<div class="gm-sidebar-info">' +
            '<div class="gm-info-row"><span>语法点</span> <strong id="gmSideTotal">-</strong></div>' +
            '<div class="gm-info-row"><span>辅助课文</span> <strong id="gmSideLessons">-</strong></div>' +
            '</div>' +
            '<hr class="sidebar-divider">' +
            '<details class="sidebar-tool-section gm-sidebar-tools" id="gmSidebarTools" open>' +
            '<summary>语法筛选 <span>搜索、等级与功能</span></summary>' +
            '<div id="gmSidebarFilters" class="sidebar-view-tools"></div>' +
            '</details>' +
            '<hr class="sidebar-divider">' +
            '<div class="gm-sidebar-guide" aria-label="语法学习提示">' +
            '<strong>使用提示</strong>' +
            '<span>点击语法卡，在当前位置查看详情</span>' +
            '<span>可收藏常用语法，再用筛选集中复习</span>' +
            '</div>';

        var btns = el.querySelectorAll('.gm-sidebar-nav-btn');
        for (var i = 0; i < btns.length; i++) {
            btns[i].addEventListener('click', function() {
                var v = this.getAttribute('data-view');
                self._switchToView(v);
            });
        }

        // Update counts
        GrammarLoader.getIndex().then(function(idx) {
            var el2 = document.getElementById('gmSideTotal');
            if (el2) el2.textContent = idx ? idx.length : '-';
        }).catch(function() {
            var el2 = document.getElementById('gmSideTotal');
            if (el2) el2.textContent = '-';
        });
        GrammarLoader.getLessons().then(function(ls) {
            var el3 = document.getElementById('gmSideLessons');
            if (el3) el3.textContent = ls ? ls.length : '-';
        });
        if (this.grammarList && this.grammarList.renderSidebarTools) this.grammarList.renderSidebarTools();
    },

    // The display settings switch the layout of the catalog and the reader at once.
    _onReadingLayoutChange: function() {
        this.grammarList._bookAnchor = null;
        this.lessonReader._bookAnchor = null;
        if (this.initialized && !this.courseContext) this.grammarList._render();
        if (this.lessonReader.currentLesson) this.lessonReader._render();
    },

    _switchSubView: function(view) {
        this.currentView = view;
        if (view !== 'grammar-list') this.courseNotice = '';

        // Update tab highlights
        var tabs = document.querySelectorAll('.gm-subtab');
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].classList.toggle('active', tabs[i].getAttribute('data-view') === view);
        }

        // Update sidebar navigation active state
        var navBtns = document.querySelectorAll('.gm-sidebar-nav-btn');
        for (var j = 0; j < navBtns.length; j++) {
            navBtns[j].classList.toggle('active', navBtns[j].getAttribute('data-view') === view);
        }

        var sidebarTools = document.getElementById('gmSidebarTools');
        if (sidebarTools) sidebarTools.hidden = view !== 'grammar-list' || !!this.courseContext;

        // Update status bar view label
        var labels = { 'grammar-list': '语法点视图', 'lesson-list': '辅助课文列表', 'lesson-reader': '辅助课文阅读' };
        if (window.ModuleSwitcher) window.ModuleSwitcher.setGrammarSubView(labels[view] || view);

        // Show/hide panes
        var showEl = function(el, show) {
            if (el) el.style.display = show ? '' : 'none';
        };
        showEl(this.grammarListEl, view === 'grammar-list');
        showEl(this.lessonListEl,  view === 'lesson-list');
        showEl(this.lessonReaderEl, view === 'lesson-reader');
        this._renderHeading();
    },

    /**
     * Shared page heading (js/core/page-heading.js): names the current view,
     * summarises the drawer filters and keeps the textbook return visible in a
     * course context. Filters stay in the drawer; the heading only opens it.
     */
    _renderHeading: function() {
        var host = document.getElementById('grammarHeading');
        var heading = window.JPLearn && window.JPLearn.pageHeading;
        if (!host || !heading) return;
        var view = this.currentView;
        if (view !== 'grammar-list' && view !== 'lesson-list') {
            heading.hide(host);
            return;
        }
        var self = this;
        var context = this.courseContext && this.courseContext.lessonId ? this.courseContext : null;
        var returnAction = context ? {
            id: 'return',
            label: '返回课文',
            icon: 'arrow-left',
            variant: context.viewedUid && context.courseStep === 'grammar' ? 'primary' : 'secondary',
            title: '回到' + (context.lessonLabel || '课文') + '原来的阅读位置'
        } : null;
        var model;
        if (context && view === 'grammar-list') {
            model = this._courseHeadingModel(context, returnAction);
        } else {
            var viewActions = [
                { id: 'view-grammar', label: '语法点', segment: true, pressed: view === 'grammar-list' },
                { id: 'view-lessons', label: '辅助课文', segment: true, pressed: view === 'lesson-list' }
            ];
            model = view === 'lesson-list'
                ? this._lessonsHeadingModel(viewActions, returnAction)
                : this._listHeadingModel(viewActions);
        }
        heading.render(host, model, {
            'view-grammar': function() { self._switchToView('grammar-list'); },
            'view-lessons': function() { self._switchToView('lesson-list'); },
            clear: function() { self.grammarList.resetFilters(); },
            tools: function(button) { self._openFilterTools(button); },
            'return': function() {
                // Same public path as the sidebar and detail return buttons; the
                // switcher alone decides whether the grammar step is complete.
                if (window.ModuleSwitcher && window.ModuleSwitcher.returnToTextbook) {
                    window.ModuleSwitcher.returnToTextbook(self.courseContext);
                }
            }
        });
    },

    _listHeadingModel: function(viewActions) {
        var list = this.grammarList;
        var query = String(list.searchQuery || '').trim();
        var level = list.levelFilter && list.levelFilter !== 'all' ? list.levelFilter : '';
        var favorites = !!list.filterFavorites;
        var details = [];
        if (list.funcGroupFilter) details.push('功能：' + grammarTagLabel(list.funcGroupFilter));
        var shown = list.filtered.length;
        var totalPages = Math.max(1, Math.ceil(shown / list.pageSize));
        var meta = [shown + ' 个语法点'];
        if (query && level) meta.push('JLPT ' + level);
        meta = meta.concat(details);
        if (favorites && (query || level)) meta.push('只看收藏');
        if (totalPages > 1) {
            meta.push('第 ' + Math.min(Math.max(1, list.currentPage), totalPages) + ' / ' + totalPages + ' 页');
        }
        var active = (query ? 1 : 0) + (level ? 1 : 0) + (favorites ? 1 : 0) + details.length;
        // The withheld-course notice stays only until the learner changes the list.
        if (active || list.currentPage > 1) this.courseNotice = '';
        var actions = viewActions.slice();
        if (active) {
            actions.push({ id: 'clear', label: '清除筛选', icon: 'rotate-ccw', variant: 'quiet', title: '清除搜索、等级、功能与收藏筛选' });
        }
        actions.push({
            id: 'tools',
            label: '筛选',
            icon: 'filter',
            badge: active ? String(active) : '',
            ariaLabel: active ? '打开语法筛选，当前 ' + active + ' 项筛选' : '打开语法筛选'
        });
        return {
            variant: 'grammar-list',
            eyebrow: this.courseNotice || '',
            title: query ? '搜索“' + query + '”' : level ? 'JLPT ' + level + ' 语法' : favorites ? '收藏的语法' : '全部语法',
            meta: meta,
            actions: actions
        };
    },

    _lessonsHeadingModel: function(viewActions, returnAction) {
        var count = (this.lessonList.lessons || []).length;
        var actions = viewActions.slice();
        if (returnAction) actions.push(returnAction);
        return {
            variant: 'lessons',
            title: '语法辅助课文',
            meta: count ? [count + ' 篇短文', '正文中的语法点可直接查看'] : [],
            actions: actions
        };
    },

    _courseHeadingModel: function(context, returnAction) {
        var loaded = this._courseGrammarContext === context;
        var courseStep = context.kind === 'textbook-course' && context.courseStep === 'grammar';
        var meta = [!loaded ? '正在整理本课语法…' : this._courseGrammarError === context ? '本课语法读取失败' : (this.courseGrammar || []).length + ' 个关联语法点'];
        if (courseStep) {
            meta.push(context.viewedUid ? '已查看语法点，返回课文即可完成这一步' : '查看任一语法点后返回课文，完成这一步');
        }
        return {
            variant: 'course',
            eyebrow: courseStep ? '本课语法 · 课文学习路径' : '本课语法',
            titlePrefix: context.title ? context.lessonLabel : '',
            title: context.title || context.lessonLabel || context.lessonId,
            titleLang: context.title ? 'ja' : '',
            meta: meta,
            actions: [returnAction]
        };
    },

    _openFilterTools: function(trigger) {
        if (!window.PanelLayout || !window.PanelLayout.openTools) return false;
        return window.PanelLayout.openTools({
            returnFocus: trigger,
            focus: function() {
                var tools = document.getElementById('gmSidebarTools');
                if (tools && !tools.open) tools.open = true;
                return document.querySelector('#gmSidebarFilters .gm-tab.active') || document.getElementById('gmSearch');
            }
        });
    },

    /**
     * Navigate to lesson reader.
     * @param {number} lessonId
     * @param {string?} highlightUid - grammar uid to highlight
     */
    navigateToLesson: function(lessonId, highlightUid) {
        if (!this.initialized) {
            this._pendingLessonId = lessonId;
            return;
        }
        this.showLessonReader(lessonId, highlightUid);
    },

    showLessonReader: function(lessonId, highlightUid) {
        this._switchSubView('lesson-reader');
        return this.lessonReader.show(lessonId, highlightUid);
    },

    /**
     * Navigate to grammar detail from external code.
     */
    navigateToGrammar: function(uid) {
        if (!this.initialized) return;
        this._switchSubView('grammar-list');
        this.grammarList.selectCard(uid);
    },

    exportNavigation: function() {
        var lesson = this.lessonReader.currentLesson;
        return {
            view: this.currentView || 'grammar-list',
            page: this.grammarList.currentPage || 1,
            selectedUid: this.grammarList.selectedUid || '',
            lessonId: lesson && lesson.lesson_id != null ? lesson.lesson_id : '',
            readerMode: this.lessonReader.displayMode || 'bilingual',
            courseContext: this.courseContext ? this._normalizeCourseContext(this.courseContext) : null
        };
    },

    restoreNavigation: function(state) {
        state = state && typeof state === 'object' ? state : {};
        this.courseContext = this._normalizeCourseContext(state.courseContext);
        this._renderCourseContext();
        if (this.courseContext) {
            return this.showCourseContext(this.courseContext);
        }
        var view = state.view;
        this.lessonReader.displayMode = state.readerMode === 'ja-only' || state.readerMode === 'zh-only'
            ? state.readerMode : 'bilingual';
        if (view === 'lesson-reader' && state.lessonId !== '' && state.lessonId != null) {
            return this.showLessonReader(state.lessonId);
        }
        if (view === 'lesson-list') {
            this._switchToView('lesson-list');
            return Promise.resolve();
        }
        this._switchSubView('grammar-list');
        this.grammarList.currentPage = Math.max(1, parseInt(state.page, 10) || 1);
        this.grammarList._render();
        if (typeof state.selectedUid === 'string' && state.selectedUid) {
            this.grammarList.selectCard(state.selectedUid);
        }
        return Promise.resolve();
    },

    _esc: function(s) { return window.JPLearn.html.escape(s); }
};
