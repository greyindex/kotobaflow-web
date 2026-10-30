/**
 * lesson-list.js
 * Lesson card grid for browsing Soviet joke lessons.
 */
function LessonListView(containerId) {
  this.container = document.getElementById(containerId);
  this.lessons = [];
  this.onSelectLesson = null; // callback(lessonId)
  this.onRetry = null;
  this.onRendered = null; // callback() after each render (page heading)
}

LessonListView.prototype = {
  init: function () {
    var self = this;
    return GrammarLoader.getLessons().then(function (lessons) {
      self.lessons = lessons || [];
      self._render();
    });
  },

  _render: function () {
    var self = this;
    if (!this.lessons.length) {
      var loadError = GrammarLoader.getLastError && GrammarLoader.getLastError('lessons');
      if (window.StateView) {
        window.StateView.mount(
          this.container,
          loadError
            ? {
                kind: 'error',
                className: 'gm-empty-state',
                icon: 'book',
                title: '辅助课文暂时无法加载',
                message: '课文列表没有准备好，可以重试；语法点浏览仍可继续。',
                details: loadError && loadError.message,
                action: {
                  id: 'retry-grammar-lessons',
                  label: '重试课文列表',
                  icon: 'rotate-ccw',
                  onClick: function () {
                    if (self.onRetry) return self.onRetry();
                  },
                },
              }
            : {
                kind: 'empty',
                className: 'gm-empty-state',
                icon: 'book',
                title: '还没有辅助课文',
                message: '当前数据源没有可显示的辅助课文。',
              },
        );
      } else {
        this.container.innerHTML = '<div class="gm-empty-grid">辅助课文数据不存在</div>';
      }
      if (typeof this.onRendered === 'function') this.onRendered();
      return;
    }
    // The shared grammar page heading names this view and its count.
    var h = '<div class="gm-lesson-grid">';
    for (var i = 0; i < this.lessons.length; i++) {
      h += this._renderCard(this.lessons[i]);
    }
    h += '</div>';
    this.container.innerHTML = h;
    this._bindEvents();
    if (typeof this.onRendered === 'function') this.onRendered();
  },

  _renderCard: function (lesson) {
    var lid = lesson.lesson_id;
    var uids = lesson.grammar_uids || [];
    // Determine level distribution
    var levels = {};
    for (var i = 0; i < uids.length; i++) {
      var lv = uids[i].split('-')[0];
      levels[lv] = (levels[lv] || 0) + 1;
    }
    var levelStr = Object.keys(levels)
      .map(function (k) {
        return k + '×' + levels[k];
      })
      .join(' ');

    var title = lesson.title_ja || lesson.title_zh || '辅助课文';
    var h =
      '<div class="gm-lesson-card" data-lesson-id="' +
      lid +
      '" role="button" tabindex="0" aria-label="查看辅助课文 ' +
      this._esc(title) +
      '">';
    h += '<div class="gm-lesson-card-head">';
    h += '<span class="gm-lesson-no">Lesson ' + String(lid).padStart(3, '0') + '</span>';
    h += '<span class="gm-lesson-gcount">' + uids.length + ' 语法点</span>';
    h += '</div>';
    if (lesson.title_ja)
      h += '<div class="gm-lesson-title-ja" lang="ja">' + this._esc(lesson.title_ja) + '</div>';
    if (lesson.title_zh) h += '<div class="gm-lesson-title-zh">' + this._esc(lesson.title_zh) + '</div>';
    if (lesson.theme) h += '<div class="gm-lesson-theme">' + this._esc(lesson.theme) + '</div>';
    if (lesson.summary_zh)
      h +=
        '<div class="gm-lesson-summary">' +
        this._esc(lesson.summary_zh).substring(0, 100) +
        (lesson.summary_zh.length > 100 ? '…' : '') +
        '</div>';
    h += '<div class="gm-lesson-levels">' + levelStr + '</div>';
    h += '</div>';
    return h;
  },

  _bindEvents: function () {
    var self = this;
    var cards = this.container.querySelectorAll('.gm-lesson-card');
    for (var i = 0; i < cards.length; i++) {
      cards[i].addEventListener('click', function () {
        var lid = parseInt(this.getAttribute('data-lesson-id'));
        if (self.onSelectLesson) self.onSelectLesson(lid);
      });
      cards[i].addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        var lid = parseInt(this.getAttribute('data-lesson-id'));
        if (self.onSelectLesson) self.onSelectLesson(lid);
      });
    }
  },

  _esc: function (s) {
    return window.JPLearn.html.escape(s);
  },
};
