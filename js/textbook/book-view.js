// Page-turn reading for lessons, the default layout (legacy scrolling only via
// the display settings). The shared pager (js/core/book-pager.js) lays the
// rendered lesson out as book pages; this mixin adds the lesson specifics: lead
// image on the first page, an end page, adjacent lessons at the edges and the
// outline following the spread.
(function (window) {
  'use strict';

  // Reading units are paragraph-sized so a restore after a layout change lands
  // near the saved spread. A curriculum grammar point spans several pages, so
  // its heading, explanation blocks and examples are units, not the point itself.
  var ANCHOR_ITEMS =
    '.tb-section-head, .tb-unit, .tb-dialogue-turn, .tb-reading-vocab-row, .tb-item, .tb-exercise, .tb-kana-table tr, .tb-paragraph, ' +
    '.tb-cgrammar-head, .tb-cgrammar-text > p, .tb-cgrammar-subhead, .tb-cgrammar-points > li, .tb-cgrammar-examples > li';

  function anchorText(element) {
    return element ? element.textContent.replace(/\s+/g, ' ').trim().slice(0, 160) : '';
  }

  function sectionName(section) {
    return anchorText(section && section.querySelector('.tb-section-badge, .tb-wiki-title'));
  }

  function anchorItems(section) {
    return Array.from(section.querySelectorAll(ANCHOR_ITEMS)).filter(function (element) {
      var parent = element.parentElement.closest(ANCHOR_ITEMS);
      return !parent || !section.contains(parent);
    });
  }

  // Last page (column) a unit reaches; a long one is split into column fragments.
  function lastColumnOf(pager, element) {
    var bounds = pager.body.getBoundingClientRect();
    var scale = bounds.width ? pager.body.clientWidth / bounds.width : 1;
    var rects = element.getClientRects();
    var last = pager.columnOf(element);
    for (var i = 0; i < rects.length; i++) {
      if (!rects[i].width || !rects[i].height) continue;
      var right = (rects[i].right - bounds.left) * scale + pager.body.scrollLeft;
      last = Math.max(last, Math.floor((right - 2) / pager.column));
    }
    return last;
  }

  function layoutSignature(pager) {
    var style = window.getComputedStyle(pager.body);
    return [
      pager.body.clientWidth,
      pager.body.clientHeight,
      pager.perSpread,
      document.documentElement.getAttribute('data-book-format') || 'default',
      style.fontFamily,
      style.fontSize,
      style.lineHeight,
      !!pager.body.querySelector(':scope > .tb-book-cover'),
    ].join('|');
  }

  // Content hashes only select the exact-column fast path. A changed lesson
  // still restores by a matching reading unit, then by its section.
  function contentSignature(body) {
    var text = body.textContent.replace(/\s+/g, ' ');
    var hash = 2166136261;
    for (var i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return String(hash >>> 0);
  }

  window.JPLearn = window.JPLearn || {};
  window.JPLearn.textbookBookViewMethods = {
    _isBookViewEnabled: function () {
      return window.JPLearn.readingLayout.isBook();
    },

    // Re-lay the open lesson when the display settings switch the layout.
    _watchReadingLayout: function () {
      if (this._readingLayoutWatched || !window.JPLearn.events) return;
      this._readingLayoutWatched = true;
      var self = this;
      window.JPLearn.events.on('reading-layout:change', function () {
        self._bookAnchor = null;
        self._bookRestoreAnchor = null;
        if (!self.currentLesson) return;
        self._renderReader();
        if (self.readerEl) self.readerEl.scrollTop = 0;
      });
    },

    _bookLessonKey: function () {
      return (this.currentBookId || '') + '/' + (this.currentLessonId || '');
    },

    _normalizeBookAnchor: function (raw, key) {
      if (
        !raw ||
        typeof raw !== 'object' ||
        Array.isArray(raw) ||
        raw.version !== 1 ||
        raw.key !== key ||
        !Number.isInteger(raw.column) ||
        raw.column < 0 ||
        raw.column > 1000000
      )
        return null;
      var target = raw.target;
      return {
        version: 1,
        key: key,
        column: raw.column,
        layout: typeof raw.layout === 'string' ? raw.layout.slice(0, 512) : '',
        content: typeof raw.content === 'string' ? raw.content.slice(0, 32) : '',
        target:
          target && typeof target === 'object' && !Array.isArray(target)
            ? {
                section: typeof target.section === 'string' ? target.section.slice(0, 160) : '',
                sectionIndex:
                  Number.isInteger(target.sectionIndex) && target.sectionIndex >= 0
                    ? Math.min(target.sectionIndex, 10000)
                    : 0,
                index:
                  Number.isInteger(target.index) && target.index >= 0 ? Math.min(target.index, 10000) : 0,
                text: typeof target.text === 'string' ? target.text.slice(0, 160) : '',
                offset:
                  Number.isInteger(target.offset) && target.offset > 0 ? Math.min(target.offset, 1000) : 0,
                end: target.end === true,
              }
            : null,
      };
    },

    _exportBookAnchor: function () {
      return this._normalizeBookAnchor(this._bookRestoreAnchor || this._bookAnchor, this._bookLessonKey());
    },

    _captureBookAnchor: function (pager, key) {
      var first = pager.firstColumn();
      var last = pager.lastColumn();
      var target = null;
      var best = -1;
      Array.from(pager.body.querySelectorAll(':scope > .tb-section')).forEach(
        function (section, sectionIndex) {
          anchorItems(section).forEach(function (element, index) {
            var column = pager.columnOf(element);
            // Prefer the first reading unit beginning on this spread; for long
            // units spanning pages keep the nearest preceding one and how many
            // pages into it this spread begins.
            if (column > last || (best >= first && column >= first) || column < best) return;
            best = column;
            target = {
              section: sectionName(section),
              sectionIndex: sectionIndex,
              index: index,
              text: anchorText(element),
              offset: Math.max(0, first - column),
            };
          });
        },
      );
      // The closing page (adjacent lessons) follows every section.
      var end = pager.body.querySelector(':scope > .tb-book-end');
      if (target && end && pager.columnOf(end) <= first) target.end = true;
      return {
        version: 1,
        key: key,
        column: first,
        layout: layoutSignature(pager),
        content: contentSignature(pager.body),
        target: target,
      };
    },

    _restoreBookPosition: function (pager, anchor) {
      var column = anchor.column;
      if (anchor.layout !== layoutSignature(pager) || anchor.content !== contentSignature(pager.body)) {
        var sections = Array.from(pager.body.querySelectorAll(':scope > .tb-section'));
        var target = anchor.target;
        var end = pager.body.querySelector(':scope > .tb-book-end');
        if (target && target.end && end) column = pager.columnOf(end);
        else if (target) {
          var section =
            sections.find(function (element) {
              return sectionName(element) === target.section;
            }) || sections[Math.min(target.sectionIndex, sections.length - 1)];
          if (section) {
            var items = anchorItems(section);
            var element = items[target.index];
            if (!element || anchorText(element) !== target.text) {
              element = items.find(function (item) {
                return anchorText(item) === target.text;
              });
            }
            column = element
              ? Math.min(pager.columnOf(element) + target.offset, lastColumnOf(pager, element))
              : pager.columnOf(section);
          }
        }
      }
      var page = Math.max(0, Math.min(pager.spreads - 1, Math.floor(column / pager.perSpread)));
      if (pager.page !== page) pager.goTo(page, false);
    },

    // Called at the end of every reader render.
    _applyBookView: function () {
      this._watchReadingLayout();
      if (this._bookPager) this._bookPager.destroy();
      this._bookPager = null;
      var reader = this.readerEl;
      var body = reader && reader.querySelector('.tb-reader-body');
      var enabled =
        this._isBookViewEnabled() && !!body && !!(this.currentLesson && this.currentLesson.lesson);
      if (reader) reader.classList.toggle('tb-reader--book', enabled);
      if (!enabled) return;

      var lead = reader.querySelector('.tb-reader-lead-media');
      if (lead) body.prepend(lead);
      var end = document.createElement('div');
      end.className = 'tb-book-end';
      end.innerHTML = '<p class="tb-book-end-mark">本课完</p>';
      var endNav = reader.querySelector('.tb-lesson-end');
      if (endNav) end.appendChild(endNav);
      body.appendChild(end);

      var key = this._bookLessonKey();
      var loadId = this._lessonLoadId;
      var savedAnchor = this._normalizeBookAnchor(this._bookRestoreAnchor || this._bookAnchor, key);
      this._bookRestoreAnchor = this._bookPendingLast ? null : savedAnchor;
      var anchor = savedAnchor ? savedAnchor.column : 0;
      if (this._bookPendingLast) anchor = Infinity;
      this._bookPendingLast = false;
      var self = this;
      var restoring = false;
      var explicitTurn = false;
      var assetsReady = false;
      this._bookPager = window.JPLearn.bookPager.mount({
        body: body,
        scroller: reader,
        label: '课文翻页阅读',
        anchor: anchor,
        observe: [this._lessonHeadingEl],
        sectionSelector: ':scope > .tb-section',
        sectionName: function (section) {
          var badge = section.querySelector('.tb-section-badge, .tb-wiki-title');
          return badge ? badge.textContent.trim() : '';
        },
        edgeLabel: function (direction) {
          if (!self._adjacentLessons()[direction]) return '';
          return direction === 'next' ? '下一课' : '上一课';
        },
        onEdge: function (direction) {
          self._bookPendingLast = direction === 'previous';
          self._openAdjacentLesson(direction, false);
        },
        beforeTurn: function () {
          if (self._lessonLoadId !== loadId || self._bookLessonKey() !== key) return;
          if (!restoring) {
            explicitTurn = true;
            self._bookRestoreAnchor = null;
          }
          self._closeChunkDetail(false);
          if (window.JPLearn.anchoredDetail) window.JPLearn.anchoredDetail.close('lesson', false);
        },
        onChange: function (pager) {
          // The previous reader can still receive resize/scroll callbacks while
          // the next lesson is loading. It must not overwrite that lesson's
          // pending navigation, even when restoring the same lesson again.
          if (self._lessonLoadId !== loadId || self._bookLessonKey() !== key) return;
          self._bookPager = pager; // also set during the first layout
          if (restoring) return;
          var previous = self._bookRestoreAnchor || self._bookAnchor;
          var focused = document.activeElement;
          // The shared pager keeps an active reading control visible after a
          // resize. Do not replace that live focus with an older reading unit.
          var readingFocus = focused !== pager.body && pager.body.contains(focused);
          if (
            !explicitTurn &&
            !readingFocus &&
            !pager._pinEnd &&
            previous &&
            previous.key === key &&
            (self._bookRestoreAnchor || previous.layout !== layoutSignature(pager))
          ) {
            restoring = true;
            self._restoreBookPosition(pager, previous);
            restoring = false;
          }
          self._bookAnchor = self._captureBookAnchor(pager, key);
          // Hidden readers are measured only when shown again. Keep the
          // original restore request until that visible layout has consumed it.
          if (assetsReady) self._bookRestoreAnchor = null;
          self._syncOutline();
          if (explicitTurn) {
            explicitTurn = false;
            self._persistCourseNavigation();
          }
        },
      });
      var pager = this._bookPager;
      Promise.all([this._insertBookCover(body, key), document.fonts && document.fonts.ready]).then(
        function () {
          if (self._bookPager !== pager || !body.isConnected || self._bookLessonKey() !== key) return;
          assetsReady = true;
          pager.refresh();
        },
      );
    },

    // KotobaFlow lessons open on their theme image; the page-turn layout is the
    // only one that shows it.
    _insertBookCover: function (body, key) {
      var loader = window.TextbookLoader;
      if (!loader || !loader.getUnitImage || !loader.isKotobaBook(this.currentBookId)) return;
      var self = this;
      return loader
        .getUnitImage(this.currentBookId, this.currentLessonId)
        .then(function (image) {
          if (!image || !body.isConnected || self._bookLessonKey() !== key) return;
          if (body.querySelector(':scope > .tb-book-cover')) return;
          var figure = document.createElement('figure');
          figure.className = 'tb-book-cover';
          var img = document.createElement('img');
          img.src = image.url;
          img.width = image.width;
          img.height = image.height;
          img.alt = image.title ? '本课主题图：' + image.title : '本课主题图';
          img.decoding = 'async';
          figure.appendChild(img);
          body.prepend(figure);
          if (self._bookPager) self._bookPager.refresh();
          // Keep the requested reading unit until the cover's decoded size
          // has participated in layout; inserting the node alone is too early.
          return img.decode().catch(function () {
            /* A missing cover must not block restoring the text. */
          });
        })
        .catch(function () {
          /* The lesson reads the same without its image. */
        });
    },

    // Outline highlight for the page-turn layout: the latest section begun on this spread.
    _syncBookOutline: function () {
      var pager = this._bookPager;
      var links = Array.from(this.readerEl.querySelectorAll('.tb-outline a'));
      if (!pager || !links.length) return;
      var lastColumn = pager.lastColumn();
      var active = links[0];
      links.forEach(function (link) {
        var section = document.getElementById(link.hash.slice(1));
        if (section && pager.columnOf(section) <= lastColumn) active = link;
      });
      links.forEach(function (link) {
        if (link === active) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
    },
  };
})(window);
