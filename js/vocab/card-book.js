(function (root) {
  'use strict';

  var app = root.JPLearn || (root.JPLearn = {});

  // Page-turn layout for the word-card catalog, the default since 2026-10-06:
  // the cards of the current group (one catalog page) flow through book pages
  // like a word book; turning past the last spread opens the next group. The
  // legacy grid with its pager stays available only from the display settings.
  app.installCardBook = function (CardMode) {
    CardMode.prototype._isBookViewEnabled = function () {
      return app.readingLayout.isBook();
    };

    CardMode.prototype._resetBookPosition = function () {
      this.currentPage = 1;
      this._bookAnchor = null;
      this._bookPendingLast = false;
    };

    CardMode.prototype._watchReadingLayout = function () {
      if (this._readingLayoutWatched || !app.events) return;
      this._readingLayoutWatched = true;
      var self = this;
      app.events.on('reading-layout:change', function () {
        self._bookAnchor = null;
        if (!root.ViewMode || root.ViewMode.get() !== 'cards') return;
        self.render();
        self._scrollToTop();
      });
    };

    CardMode.prototype._mountBookView = function (totalPages) {
      this._watchReadingLayout();
      if (this._bookPager) this._bookPager.destroy();
      this._bookPager = null;
      var body = this.container && this.container.querySelector('.cc-book-body');
      if (body) this._mountBookPager(body, totalPages);
    };

    CardMode.prototype._mountBookPager = function (body, totalPages) {
      var self = this;
      var group = this.currentPage;
      var anchor = this._bookAnchor && this._bookAnchor.group === group ? this._bookAnchor.column : 0;
      if (this._bookPendingLast) anchor = Infinity;
      this._bookPendingLast = false;
      app.bookPager.mount({
        body: body,
        scroller: this.container,
        label: '词卡翻页阅读',
        anchor: anchor,
        statusExtra: function () {
          var start = (group - 1) * self.perPage + 1;
          var end = Math.min(group * self.perPage, self.displayWords.length);
          return '第 ' + group + ' / ' + totalPages + ' 组 · ' + start + '–' + end + ' 词';
        },
        edgeLabel: function (direction) {
          if (direction === 'next') return group < totalPages ? '下一组' : '';
          return group > 1 ? '上一组' : '';
        },
        onEdge: function (direction) {
          self._bookPendingLast = direction === 'previous';
          self.currentPage = group + (direction === 'next' ? 1 : -1);
          self._bookAnchor = null;
          self.render();
        },
        beforeTurn: function () {
          if (app.anchoredDetail) app.anchoredDetail.close('vocab', false);
        },
        onChange: function (pager) {
          self._bookPager = pager;
          self._bookAnchor = { group: group, column: pager.firstColumn() };
          self._syncBookLevels(pager);
        },
      });
    };

    // Keep one level mark when a spread contains a single JLPT level. Visibility
    // preserves the entry geometry, so this cannot change the measured pages.
    CardMode.prototype._syncBookLevels = function (pager) {
      var cards = pager.body.querySelectorAll('.cc-card');
      var shown = [];
      var levels = [];
      for (var i = 0; i < cards.length; i++) {
        var badge = cards[i].querySelector('.cc-level');
        if (!badge) continue;
        badge.classList.remove('cc-level-repeated');
        badge.removeAttribute('aria-hidden');
        var column = pager.columnOf(cards[i]);
        if (column < pager.firstColumn() || column > pager.lastColumn()) continue;
        shown.push(badge);
        var level = cards[i].getAttribute('data-level') || '';
        if (levels.indexOf(level) === -1) levels.push(level);
      }
      if (levels.length !== 1 || !levels[0]) return;
      for (var j = 1; j < shown.length; j++) {
        shown[j].classList.add('cc-level-repeated');
        shown[j].setAttribute('aria-hidden', 'true');
      }
    };

    // Read-aloud follows the active card onto its spread.
    CardMode.prototype._revealBookCard = function (card) {
      if (this._bookPager && card) this._bookPager.show(card);
    };
  };
})(window);
