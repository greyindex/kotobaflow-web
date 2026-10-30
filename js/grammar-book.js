/**
 * grammar-book.js
 * Page-turn layout for the grammar module, the default since 2026-10-06: the
 * grammar-point catalog reads like a grammar handbook (one catalog page per
 * group of book pages) and supplementary lessons read like a printed lesson.
 * The legacy scrolling layout is chosen once for all modules in the display
 * settings (JPLearn.readingLayout).
 */
(function (root) {
  'use strict';

  var app = root.JPLearn || (root.JPLearn = {});

  app.grammarBookView = {
    isEnabled: function () {
      return app.readingLayout.isBook();
    },
  };

  function closeDetail() {
    if (app.anchoredDetail) app.anchoredDetail.close('grammar', false);
  }

  Object.assign(GrammarListView.prototype, {
    _mountBookView: function () {
      if (this._bookPager) this._bookPager.destroy();
      this._bookPager = null;
      var body = this.container && this.container.querySelector('.gm-book-body');
      if (!body) return;
      var self = this;
      var group = this.currentPage;
      var totalPages = Math.ceil(this.filtered.length / this.pageSize) || 1;
      var anchor = this._bookAnchor && this._bookAnchor.group === group ? this._bookAnchor.column : 0;
      if (this._bookPendingLast) anchor = Infinity;
      this._bookPendingLast = false;
      app.bookPager.mount({
        body: body,
        scroller: this.container,
        label: '语法点翻页阅读',
        anchor: anchor,
        statusExtra: function () {
          var start = (group - 1) * self.pageSize + 1;
          var end = Math.min(group * self.pageSize, self.filtered.length);
          return '第 ' + group + ' / ' + totalPages + ' 组 · ' + start + '–' + end + ' 条';
        },
        edgeLabel: function (direction) {
          if (direction === 'next') return group < totalPages ? '下一组' : '';
          return group > 1 ? '上一组' : '';
        },
        onEdge: function (direction) {
          self._bookPendingLast = direction === 'previous';
          self.currentPage = group + (direction === 'next' ? 1 : -1);
          self._bookAnchor = null;
          self._render();
        },
        beforeTurn: closeDetail,
        onChange: function (pager) {
          self._bookPager = pager;
          self._bookAnchor = { group: group, column: pager.firstColumn() };
        },
      });
    },
  });

  var READER_SECTIONS = [
    ['gm-reader-header', '课文信息'],
    ['gm-reader-grammar-briefs', '目标语法'],
    ['gm-reader-reading', '正文阅读'],
  ];

  Object.assign(LessonReaderView.prototype, {
    _mountBookView: function () {
      if (this._bookPager) this._bookPager.destroy();
      this._bookPager = null;
      var article = this.container && this.container.querySelector('.gm-reader-article');
      if (!article || !app.grammarBookView.isEnabled()) return;
      var self = this;
      var key = this.currentLesson && this.currentLesson.lesson_id;
      var anchor = this._bookAnchor && this._bookAnchor.key === key ? this._bookAnchor.column : 0;
      // A book shows the target grammar on its own pages instead of a disclosure.
      var briefs = article.querySelector('.gm-reader-grammar-briefs');
      if (briefs) briefs.open = true;
      app.bookPager.mount({
        body: article,
        scroller: this.container,
        label: '辅助课文翻页阅读',
        anchor: anchor,
        sectionSelector: ':scope > *',
        sectionName: function (section) {
          for (var i = 0; i < READER_SECTIONS.length; i++) {
            if (section.classList.contains(READER_SECTIONS[i][0])) return READER_SECTIONS[i][1];
          }
          return '';
        },
        beforeTurn: closeDetail,
        onChange: function (pager) {
          self._bookPager = pager;
          self._bookAnchor = { key: key, column: pager.firstColumn() };
        },
      });
    },
  });
})(window);
