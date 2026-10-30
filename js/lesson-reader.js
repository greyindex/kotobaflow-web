/**
 * lesson-reader.js
 * Full lesson reading view with inline [[UID::TEXT]] grammar highlighting.
 * Bi-pane layout: Japanese paragraphs with clickable grammar spans + Chinese translation.
 */
function LessonReaderView(containerId, detailPanel) {
    this.container = document.getElementById(containerId);
    this.detailPanel = detailPanel;
    this.currentLesson = null;
    this.displayMode = 'bilingual'; // 'bilingual' | 'ja-only' | 'zh-only'
    this.onBack = null;    // callback()
    this.onGrammarClick = null; // callback(uid, entry)
    this._indexEntries = null; // cached grammar index
}

LessonReaderView.prototype = {

    show: function(lessonId) {
        var self = this;
        if (window.StateView) {
            window.StateView.mount(this.container, {
                kind: 'loading',
                className: 'gm-reader-loading-state',
                icon: 'book',
                title: '正在加载辅助课文',
                message: '正在整理正文与语法标记…',
            });
        } else {
            this.container.innerHTML = '<div class="gm-reader-loading">辅助课文加载中...</div>';
        }

        // Load lesson + grammar index in parallel
        return Promise.all([
            GrammarLoader.getLesson(lessonId),
            GrammarLoader.getIndex()
        ]).then(function(results) {
            var lesson = results[0];
            var index = results[1];
            self._indexEntries = {};
            if (index) {
                for (var i = 0; i < index.length; i++) {
                    self._indexEntries[index[i].uid] = index[i];
                }
            }
            if (!lesson) {
                var loadError = GrammarLoader.getLastError && GrammarLoader.getLastError('lessons');
                if (window.StateView) {
                    window.StateView.mount(self.container, loadError ? {
                        kind: 'error',
                        className: 'gm-reader-error-state',
                        icon: 'book',
                        title: '辅助课文暂时无法加载',
                        message: '返回课文列表或重试，当前语法学习不会被打断。',
                        details: loadError && loadError.message,
                        action: {
                            id: 'retry-grammar-reader',
                            label: '重试课文',
                            icon: 'rotate-ccw',
                            onClick: function() {
                                if (GrammarLoader.reset) GrammarLoader.reset('lessons');
                                return self.show(lessonId);
                            },
                        },
                    } : {
                        kind: 'empty',
                        className: 'gm-reader-empty-state',
                        icon: 'book',
                        title: '找不到这篇辅助课文',
                        message: '返回课文列表选择其他内容。',
                    });
                } else {
                    self.container.innerHTML = '<div class="gm-reader-error">辅助课文不存在</div>';
                }
                return;
            }
            self.currentLesson = lesson;
            self._render();
        }).catch(function(err) {
            if (window.StateView) {
                window.StateView.mount(self.container, {
                    kind: 'error',
                    className: 'gm-reader-error-state',
                    icon: 'book',
                    title: '辅助课文暂时无法加载',
                    message: '返回课文列表或重试，当前语法学习不会被打断。',
                    details: err && err.message,
                    action: {
                        id: 'retry-grammar-reader',
                        label: '重试课文',
                        icon: 'rotate-ccw',
                        onClick: function() {
                            if (GrammarLoader.reset) GrammarLoader.reset('lessons');
                            return self.show(lessonId);
                        },
                    },
                });
            }
        });
    },

    _render: function() {
        var lesson = this.currentLesson;
        var gps = lesson.grammar_points || [];
        var h = '';

        // Back button + section navigation + display toggle
        h += '<div class="gm-reader-topbar">';
        h += '<button class="gm-back-btn" id="gmReaderBack" title="返回辅助课文列表" aria-label="返回辅助课文列表">' + uiIcon('arrow-left') + '返回列表</button>';
        h += '<nav class="gm-reader-jump-nav" aria-label="辅助课文章节">';
        if (gps.length) h += '<button type="button" data-reader-target="gmReaderTargets">目标语法 <span>' + gps.length + '</span></button>';
        h += '<button type="button" data-reader-target="gmReaderReading">正文</button>';
        h += '</nav>';
        h += '<div class="gm-display-toggle" role="group" aria-label="阅读显示方式">';
        h += '<button class="gm-toggle-btn' + (this.displayMode === 'ja-only' ? ' active' : '') + '" data-mode="ja-only" aria-pressed="' + (this.displayMode === 'ja-only') + '">日文</button>';
        h += '<button class="gm-toggle-btn' + (this.displayMode === 'bilingual' ? ' active' : '') + '" data-mode="bilingual" aria-pressed="' + (this.displayMode === 'bilingual') + '">日中</button>';
        h += '<button class="gm-toggle-btn' + (this.displayMode === 'zh-only' ? ' active' : '') + '" data-mode="zh-only" aria-pressed="' + (this.displayMode === 'zh-only') + '">中文</button>';
        h += '</div>';
        h += '</div>';

        h += '<article class="gm-reader-article">';

        // Lesson header
        h += '<div class="gm-reader-header">';
        h += '<div class="gm-reader-lesson-no">Lesson ' + String(lesson.lesson_id).padStart(3, '0') + '</div>';
        if (lesson.theme) h += '<div class="gm-reader-theme">' + this._esc(lesson.theme) + '</div>';
        if (lesson.title_ja) h += '<h1 class="gm-reader-title-ja" lang="ja">' + this._esc(lesson.title_ja) + '</h1>';
        if (lesson.title_zh) h += '<div class="gm-reader-title-zh">' + this._esc(lesson.title_zh) + '</div>';
        if (lesson.summary_zh) h += '<p class="gm-reader-summary">' + this._esc(lesson.summary_zh) + '</p>';
        h += '</div>';

        // Grammar briefs section
        if (gps.length) {
            h += '<details class="gm-reader-grammar-briefs" id="gmReaderTargets">';
            h += '<summary>' + uiIcon('clipboard') + '<span><strong>本课目标语法</strong><small>阅读时可直接点击文中的标记</small></span><em>' + gps.length + ' 点</em></summary>';
            h += '<div class="gm-brief-grid">';
            for (var i = 0; i < gps.length; i++) {
                h += this._renderGrammarBrief(gps[i]);
            }
            h += '</div></details>';
        }

        // Reading section
        h += '<section class="gm-reader-reading" id="gmReaderReading" aria-labelledby="gmReaderReadingHeading">';
        h += '<div class="gm-reader-section-head" tabindex="-1"><span>READING</span><h2 id="gmReaderReadingHeading">正文阅读</h2><p>带下划线的语法可以打开详细说明</p></div>';
        h += '<div class="gm-reader-body">';
        var parasJa = lesson.paragraphs_ja || [];
        var parasZh = lesson.paragraphs_zh || [];
        var paraCount = Math.max(parasJa.length, parasZh.length);

        for (var p = 0; p < paraCount; p++) {
            h += '<div class="gm-para-pair gm-display-' + this.displayMode + '">';

            // Japanese paragraph
            if (this.displayMode !== 'zh-only') {
                h += '<div class="gm-para-ja" lang="ja">';
                var rawJa = parasJa[p] || '';
                h += this._renderJaParagraph(rawJa);
                h += '</div>';
            }

            // Chinese paragraph: its grammar marks are only bold; the
            // Japanese paragraph holds the clickable ones.
            if (this.displayMode !== 'ja-only') {
                h += '<div class="gm-para-zh">';
                h += GrammarInlineParser.renderStrong(parasZh[p] || '');
                h += '</div>';
            }

            h += '</div>';
        }
        h += '</div>'; // reader-body
        h += '</section>';
        h += '</article>';

        this.container.innerHTML = h;
        this._bindEvents();
        this._mountBookView();
    },

    _renderGrammarBrief: function(gp) {
        var uid = gp.uid || '';
        var inIndex = this._indexEntries && this._indexEntries[uid];
        var h = inIndex
            ? '<button type="button" class="gm-brief-card gm-brief-clickable" data-uid="' + this._esc(uid) + '" aria-label="查看语法 ' + this._esc(gp.title || uid) + '">'
            : '<div class="gm-brief-card" data-uid="' + this._esc(uid) + '">';
        h += '<div class="gm-brief-head">';
        h += '<span class="gm-brief-level gm-level-' + (gp.level || '').toLowerCase() + '">' + this._esc(gp.level || '') + '</span>';
        h += '<span class="gm-brief-title">' + this._esc(gp.title || uid) + '</span>';
        h += '</div>';
        if (gp.explanation) h += '<div class="gm-brief-exp">' + this._esc(gp.explanation) + '</div>';
        // Samples mark the brief's own grammar as [[TEXT]], without a uid.
        if (gp.sample_ja) h += '<div class="gm-brief-sample-ja" lang="ja">' + GrammarInlineParser.renderStrong(gp.sample_ja) + '</div>';
        if (gp.sample_zh) h += '<div class="gm-brief-sample-zh">' + GrammarInlineParser.renderStrong(gp.sample_zh) + '</div>';
        h += inIndex ? '</button>' : '</div>';
        return h;
    },

    _renderJaParagraph: function(raw) {
        var segments = GrammarInlineParser.parse(raw);
        var h = '';
        for (var i = 0; i < segments.length; i++) {
            var seg = segments[i];
            if (seg.type === 'grammar') {
                var inIndex = this._indexEntries && this._indexEntries[seg.uid];
                if (inIndex) {
                    h += '<button type="button" class="gm-grammar-mark gm-grammar-known" data-uid="' + this._esc(seg.uid) + '" title="查看语法：' + this._esc(seg.uid) + '">' + this._esc(seg.text) + '</button>';
                } else {
                    h += '<span class="gm-grammar-mark gm-grammar-unknown" title="' + this._esc(seg.uid) + '">' + this._esc(seg.text) + '</span>';
                }
            } else {
                h += this._esc(seg.text);
            }
        }
        return h;
    },

    _bindEvents: function() {
        var self = this;

        // Back
        var backBtn = document.getElementById('gmReaderBack');
        if (backBtn) {
            backBtn.addEventListener('click', function() {
                if (self.onBack) self.onBack();
            });
        }

        // Display toggle
        var toggleBtns = this.container.querySelectorAll('.gm-toggle-btn');
        for (var i = 0; i < toggleBtns.length; i++) {
            toggleBtns[i].addEventListener('click', function() {
                var scrollTop = self.container.scrollTop;
                self.displayMode = this.getAttribute('data-mode');
                self._render();
                self.container.scrollTop = scrollTop;
                var activeToggle = self.container.querySelector('.gm-toggle-btn[data-mode="' + self.displayMode + '"]');
                if (activeToggle) activeToggle.focus({ preventScroll: true });
            });
        }

        // Compact section navigation
        var jumpBtns = this.container.querySelectorAll('[data-reader-target]');
        for (var n = 0; n < jumpBtns.length; n++) {
            jumpBtns[n].addEventListener('click', function() {
                var target = document.getElementById(this.getAttribute('data-reader-target'));
                if (!target) return;
                if (target.tagName === 'DETAILS') target.open = true;
                var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
                var focusTarget = target.querySelector('summary, .gm-reader-section-head');
                if (focusTarget) {
                    focusTarget.setAttribute('tabindex', '-1');
                    focusTarget.focus({ preventScroll: true });
                }
            });
        }

        // Grammar brief clicks
        var briefCards = this.container.querySelectorAll('.gm-brief-clickable');
        for (var j = 0; j < briefCards.length; j++) {
            briefCards[j].addEventListener('click', function(event) {
                var uid = this.getAttribute('data-uid');
                self._triggerGrammarDetail(uid, this, event.detail === 0);
            });
        }

        // Inline grammar span clicks
        var marks = this.container.querySelectorAll('.gm-grammar-known');
        for (var k = 0; k < marks.length; k++) {
            marks[k].addEventListener('click', function(event) {
                var uid = this.getAttribute('data-uid');
                self._triggerGrammarDetail(uid, this, event.detail === 0);
            });
        }
    },

    _triggerGrammarDetail: function(uid, anchor, focusPopup) {
        if (!uid) return;
        var entry = this._indexEntries ? this._indexEntries[uid] : null;
        if (this.detailPanel) {
            this.detailPanel.show(uid, entry, anchor, { focus: !!focusPopup });
        }
        if (this.onGrammarClick) {
            this.onGrammarClick(uid, entry);
        }
    },

    _esc: function(s) {
        return window.JPLearn.html.escape(s);
    }
};
