// Page-turn layout shared by the vocabulary, grammar and textbook modules and,
// since 2026-10-06, the default reading layout (EXP-BOOK-01). A rendered content
// element flows into book pages (two facing pages on wide readers, one on
// narrow) and turns a spread at a time. The content DOM and its events stay
// unchanged: the element is laid out as horizontal CSS columns inside a
// fixed-height frame and scrolled sideways by whole spreads. The legacy
// continuous scrolling stays available only from the display settings.
(function (window) {
  'use strict';

  var app = window.JPLearn || (window.JPLearn = {});
  var TWO_PAGE_MIN_WIDTH = 680;
  var FIT_MIN_HEIGHT = 480;

  var LAYOUT_KEY = 'jp_learning_reading_layout_v1';
  // 2026-10-15: how much a spread shows (styles under html[data-book-format]).
  var FORMAT_KEY = 'jp_learning_book_format_v1';
  var FORMATS = ['default', 'dense', 'large', 'single'];

  function readChoice(key, allowed, fallback) {
    try {
      var value = window.localStorage.getItem(key);
      return allowed.indexOf(value) === -1 ? fallback : value;
    } catch (e) {
      return fallback;
    }
  }

  function saveChoice(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (e) {
      /* A per-viewer convenience: the choice then lasts for this page only. */
    }
  }

  // Per-device choices shared by all three modules: 'book' (default) or the
  // legacy 'scroll' layout that is being phased out, and the page format.
  var layout = readChoice(LAYOUT_KEY, ['scroll'], 'book');
  var format = readChoice(FORMAT_KEY, FORMATS, 'default');
  document.documentElement.setAttribute('data-book-format', format);

  // Live pagers, so a new page format re-lays every open book.
  var pagers = [];

  // The layout select lists the page formats as kinds of the page-turn layout:
  // 'book' (its default format), 'dense', 'large', 'single', then 'scroll'.
  function layoutChoice() {
    if (layout === 'scroll') return 'scroll';
    return format === 'default' ? 'book' : format;
  }

  function syncLayoutControl() {
    var select = document.getElementById('appReadingLayoutSelect');
    var value = layoutChoice();
    if (select && select.value !== value) select.value = value;
  }

  function setLayout(value) {
    var next = value === 'scroll' ? 'scroll' : 'book';
    if (next === layout) return;
    layout = next;
    saveChoice(LAYOUT_KEY, next);
    syncLayoutControl();
    if (app.events) app.events.emit('reading-layout:change', { layout: next });
  }

  function setFormat(value) {
    var next = FORMATS.indexOf(value) === -1 ? 'default' : value;
    if (next === format) return;
    // What each open book shows, taken while its pages still have the old type.
    var open = pagers.map(function (pager) {
      return { pager: pager, keep: pager.formatAnchor() };
    });
    format = next;
    saveChoice(FORMAT_KEY, next);
    document.documentElement.setAttribute('data-book-format', next);
    syncLayoutControl();
    open.forEach(function (entry) {
      entry.pager.reformat(entry.keep);
    });
    if (app.events) app.events.emit('book-format:change', { format: next });
  }

  function chooseLayout(value) {
    if (value === 'scroll') return setLayout('scroll');
    // The format first: books opened by the layout change then start in it.
    setFormat(value === 'book' ? 'default' : value);
    setLayout('book');
  }

  function bindLayoutControl() {
    var select = document.getElementById('appReadingLayoutSelect');
    if (!select || select.getAttribute('data-bound') === '1') return;
    select.setAttribute('data-bound', '1');
    select.value = layoutChoice();
    select.addEventListener('change', function () {
      chooseLayout(select.value);
    });
  }

  function isEditable(target) {
    if (!target || !target.closest) return false;
    return !!target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
  }

  function icon(name) {
    return typeof window.uiIcon === 'function' ? window.uiIcon(name) : '';
  }

  // options:
  //   body          element to paginate (stays in place inside the new frame)
  //   scroller      vertical scroll container that hosts the frame
  //   label         accessible name of the book region
  //   anchor        page (column) index to open on; Infinity opens the last spread
  //   observe       extra elements whose size changes require a new layout
  //   sectionSelector / sectionName(el)  names the section shown on a spread
  //   edgeLabel(direction)  label for turning past the first/last spread, '' = none
  //   onEdge(direction)     called for such a turn ('previous' | 'next')
  //   statusExtra()         text appended to the page status
  //   beforeTurn()          close popups anchored to the old spread
  //   onChange(pager)       after every page change or new layout
  function BookPager(options) {
    this.options = options;
    this.body = options.body;
    this.scroller = options.scroller;
    this.page = 0;
    this.spreads = 1;
    this.columns = 1;
    this.perSpread = 2;
    this.stride = 1;
    this.column = 1;
    this.gap = 0;
    this._build();
    this._bind();
    pagers.push(this);
    this.layout(options.anchor || 0);
  }

  BookPager.prototype = {
    _build: function () {
      var body = this.body;
      var frame = document.createElement('div');
      frame.className = 'book-frame';
      frame.setAttribute('role', 'region');
      frame.setAttribute('aria-roledescription', '翻页阅读');
      frame.setAttribute('aria-label', this.options.label || '翻页阅读');
      frame.innerHTML =
        '<button type="button" class="book-edge is-prev" data-book-flip="prev">' +
        icon('chevron-left') +
        '</button>' +
        '<button type="button" class="book-edge is-next" data-book-flip="next">' +
        icon('chevron-right') +
        '</button>' +
        // Turn buttons stay at the two ends; the middle picks any spread.
        '<div class="book-footer">' +
        '<button type="button" class="book-turn is-prev" data-book-flip="prev"></button>' +
        '<div class="book-pages">' +
        '<select class="book-page-select" aria-label="跳到页面"></select>' +
        '<span class="book-page-total"></span>' +
        '<span class="book-status-extra"></span>' +
        '</div>' +
        '<button type="button" class="book-turn is-next" data-book-flip="next"></button>' +
        '<span class="book-status sr-only" aria-live="polite"></span>' +
        '</div>';
      body.parentNode.insertBefore(frame, body);
      frame.insertBefore(body, frame.querySelector('.book-edge.is-next'));
      body.classList.add('book-body');
      if (!body.hasAttribute('tabindex')) body.tabIndex = -1;
      this.frame = frame;
    },

    _bind: function () {
      var self = this;
      var body = this.body;
      this.frame.addEventListener('click', function (event) {
        var flip = event.target && event.target.closest && event.target.closest('[data-book-flip]');
        if (!flip || flip.disabled || !self.frame.contains(flip)) return;
        event.preventDefault();
        self.turn(flip.getAttribute('data-book-flip') === 'next' ? 1 : -1);
      });
      this.frame.querySelector('.book-page-select').addEventListener('change', function (event) {
        if (!self._alive() || !self.measure()) return;
        self.goTo(Number(event.target.value) || 0, true);
      });

      // Native Tab can scroll just enough to expose a control in the next
      // column. Follow the control itself, not that intermediate scroll offset.
      // A pressed control is focused on pointerdown and is already in view;
      // scrolling the reader then would move it away before the click lands.
      var pressing = false;
      body.addEventListener(
        'pointerdown',
        function () {
          pressing = true;
          window.setTimeout(function () {
            pressing = false;
          }, 0);
        },
        true,
      );
      // Tab from outside the book enters the shown spread, not the first or
      // last control of the whole content on another spread.
      var tabbing = 0;
      this._onTab = function (event) {
        if (event.key !== 'Tab') return;
        tabbing = event.shiftKey ? -1 : 1;
        window.setTimeout(function () {
          tabbing = 0;
        }, 0);
      };
      document.addEventListener('keydown', this._onTab, true);
      body.addEventListener('focusin', function (event) {
        self._pointerFocus = pressing ? event.target : null;
        var from = event.relatedTarget;
        if (tabbing && !(from && body.contains(from)) && self._enterSpread(event.target, tabbing)) return;
        self._revealFocus(event.target);
      });

      // Focus moves, jump links and audio follow use scrollIntoView, which
      // scrolls the clipped body freely; settle it back onto a spread afterwards.
      var settleTimer = 0;
      var settle = function () {
        settleTimer = 0;
        self.settle();
      };
      body.addEventListener(
        'scroll',
        function () {
          if ('onscrollend' in window) return;
          if (settleTimer) window.clearTimeout(settleTimer);
          settleTimer = window.setTimeout(settle, 160);
        },
        { passive: true },
      );
      body.addEventListener('scrollend', settle);

      var swipe = null;
      body.addEventListener('pointerdown', function (event) {
        if (event.pointerType === 'mouse') return;
        swipe = { x: event.clientX, y: event.clientY, id: event.pointerId };
      });
      body.addEventListener('pointerup', function (event) {
        if (!swipe || swipe.id !== event.pointerId) return;
        var dx = event.clientX - swipe.x;
        var dy = event.clientY - swipe.y;
        swipe = null;
        if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) self.turn(dx < 0 ? 1 : -1);
      });
      body.addEventListener('pointercancel', function () {
        swipe = null;
      });

      var lastWheel = 0;
      body.addEventListener(
        'wheel',
        function (event) {
          if (Math.abs(event.deltaX) < 24 || Math.abs(event.deltaX) < Math.abs(event.deltaY)) return;
          event.preventDefault();
          var now = Date.now();
          if (now - lastWheel < 450) return;
          lastWheel = now;
          self.turn(event.deltaX > 0 ? 1 : -1);
        },
        { passive: false },
      );

      // Fonts, images and expanding details reflow the content after layout.
      body.addEventListener(
        'load',
        function () {
          self.refresh();
        },
        true,
      );
      body.addEventListener(
        'toggle',
        function () {
          self.refresh();
        },
        true,
      );
      if (document.fonts && document.fonts.ready)
        document.fonts.ready.then(function () {
          self.refresh();
        });

      this._onKey = function (event) {
        self._handleKey(event);
      };
      document.addEventListener('keydown', this._onKey);

      if (window.ResizeObserver) {
        var request = 0;
        this._observer = new ResizeObserver(function () {
          if (!self._alive() || request) return;
          request = window.requestAnimationFrame(function () {
            request = 0;
            if (self._alive()) self.layout(self.firstColumn());
          });
        });
        this._observer.observe(this.scroller);
        (this.options.observe || []).forEach(function (element) {
          if (element) self._observer.observe(element);
        });
      }
    },

    // Re-rendering replaces the content; a detached pager cleans itself up.
    _alive: function () {
      if (this.frame.isConnected) return true;
      this.destroy();
      return false;
    },

    destroy: function () {
      if (this._destroyed) return;
      this._destroyed = true;
      if (app.bookTurn) app.bookTurn.end(this);
      var index = pagers.indexOf(this);
      if (index !== -1) pagers.splice(index, 1);
      document.removeEventListener('keydown', this._onKey);
      document.removeEventListener('keydown', this._onTab, true);
      if (this._observer) this._observer.disconnect();
    },

    firstColumn: function () {
      return this.page * this.perSpread;
    },

    lastColumn: function () {
      return Math.min(this.columns, (this.page + 1) * this.perSpread) - 1;
    },

    // Page (column) index on which an element inside the body starts.
    columnOf: function (element) {
      var bounds = this.body.getBoundingClientRect();
      var rect = element.getClientRects()[0];
      if (!rect || !bounds.width) return 0;
      var scale = this.body.clientWidth / bounds.width;
      var left = (rect.left - bounds.left) * scale + this.body.scrollLeft;
      return Math.max(0, Math.floor((left + 2) / this.column));
    },

    _focusPage: function (element) {
      var bounds = this.body.getBoundingClientRect();
      var scale = bounds.width ? this.body.clientWidth / bounds.width : 1;
      var rects = element.getClientRects();
      var target = this.page;
      var distance = Infinity;
      // Inline grammar controls can wrap across columns. Keep a fragment on
      // the current spread when possible, otherwise choose the nearest one.
      for (var i = 0; i < rects.length; i++) {
        if (!rects[i].width || !rects[i].height) continue;
        var left = (rects[i].left - bounds.left) * scale + this.body.scrollLeft;
        var column = Math.max(0, Math.floor((left + 2) / this.column));
        var page = Math.floor(column / this.perSpread);
        var diff = Math.abs(page - this.page);
        if (diff < distance) {
          target = page;
          distance = diff;
        }
      }
      return target;
    },

    // Focusable controls on the shown spread, in document order.
    _spreadControls: function () {
      var controls = this.body.querySelectorAll(
        'a[href], button, input, select, textarea, summary, [tabindex]',
      );
      var shown = [];
      for (var i = 0; i < controls.length; i++) {
        if (
          controls[i].tabIndex >= 0 &&
          !controls[i].disabled &&
          controls[i].getClientRects().length &&
          this._focusPage(controls[i]) === this.page
        )
          shown.push(controls[i]);
      }
      return shown;
    },

    _enterSpread: function (element, direction) {
      if (!this._alive() || !this.measure() || this._focusPage(element) === this.page) return false;
      var controls = this._spreadControls();
      var target = direction > 0 ? controls[0] : controls[controls.length - 1];
      if (!target) {
        // A text-only spread has no Tab stop. Continue outside the body in
        // native order; phone edge buttons are hidden and must be skipped.
        target = this._outsideSpreadControl(direction);
        if (!target) return false;
        target.focus();
        // Native entry already scrolled to the first/last off-page control.
        // Keep the shown spread after redirecting focus, including scrollend.
        this.body.scrollLeft = this.page * this.stride;
        return true;
      }
      target.focus({ preventScroll: true });
      return true;
    },

    _outsideSpreadControl: function (direction) {
      var controls = document.querySelectorAll(
        'a[href], button, input, select, textarea, summary, [tabindex]',
      );
      var target = null;
      for (var i = 0; i < controls.length; i++) {
        var control = controls[i];
        if (
          control.tabIndex < 0 ||
          control.disabled ||
          this.body.contains(control) ||
          control.contains(this.body) ||
          control.closest('[inert]') ||
          !control.getClientRects().length ||
          window.getComputedStyle(control).visibility !== 'visible'
        )
          continue;
        // Closed details can still report rectangles for positioned children,
        // although only their own summary participates in native Tab order.
        var closed = control.closest('details:not([open])');
        var hidden = false;
        while (closed) {
          var summary = closed.querySelector(':scope > summary');
          if (!summary || !summary.contains(control)) {
            hidden = true;
            break;
          }
          closed = closed.parentElement && closed.parentElement.closest('details:not([open])');
        }
        if (hidden) continue;
        var relation = this.body.compareDocumentPosition(control);
        if (direction > 0 && relation & Node.DOCUMENT_POSITION_FOLLOWING) return control;
        if (direction < 0 && relation & Node.DOCUMENT_POSITION_PRECEDING) target = control;
      }
      return target;
    },

    _revealFocus: function (element) {
      if (!this._alive() || !element || element === this.body || !this.body.contains(element)) return;
      if (!this.measure()) return;
      var target = this._focusPage(element);
      if (target !== this.page) this.goTo(target, false);
      else if (element !== this._pointerFocus) this.reveal();
    },

    layout: function (anchorColumn) {
      if (!this._alive() || !this.body.getClientRects().length) return;
      // A new geometry makes the copies of a running turn stale.
      if (app.bookTurn) app.bookTurn.end(this);
      var scroller = this.scroller;
      var frame = this.frame;
      var body = this.body;
      // Fit below whatever precedes the frame when that leaves a readable page;
      // otherwise fill the scroller and let a page turn scroll the rest away.
      var scrollerRect = scroller.getBoundingClientRect();
      var scale = scrollerRect.height ? scroller.clientHeight / scrollerRect.height : 1;
      var frameTop = (frame.getBoundingClientRect().top - scrollerRect.top) * scale + scroller.scrollTop;
      var below = scroller.clientHeight - frameTop - 12;
      // A narrow reader has one column. Keep its footer on screen after phone
      // headings wrap or display zoom reduces the effective viewport height.
      var fitMinimum = scroller.clientWidth <= 640 ? 320 : FIT_MIN_HEIGHT;
      var height = below >= fitMinimum ? below : scroller.clientHeight - 24;
      frame.style.setProperty('--book-height', Math.max(320, Math.floor(height)) + 'px');
      body.style.width = '';
      var width = Math.floor(parseFloat(window.getComputedStyle(body).width) || body.clientWidth);
      if (!(width > 40)) return; // Hidden: the resize observer lays out once shown.
      var perSpread = format !== 'single' && width >= TWO_PAGE_MIN_WIDTH ? 2 : 1;
      body.style.width = width + 'px';
      frame.classList.toggle('is-single', perSpread === 1);
      var gap = parseFloat(window.getComputedStyle(body).columnGap) || 0;
      this.perSpread = perSpread;
      this.gap = gap;
      this.stride = width + gap;
      this.column = (width - gap * (perSpread - 1)) / perSpread + gap;
      // Opening on the last spread (turning back from the next lesson or group)
      // stays there while late fonts and images add pages, until the reader turns.
      var page = Math.floor((Number(anchorColumn) || 0) / perSpread);
      if (!isFinite(page)) this._pinEnd = true;
      if (!this.measure()) return;
      this.page = this._pinEnd ? this.spreads - 1 : Math.max(0, Math.min(this.spreads - 1, page));
      body.scrollLeft = this.page * this.stride;
      this.updateChrome();
      this._revealFocus(document.activeElement);
    },

    // Count pages again; runs before every turn because content can reflow.
    measure: function () {
      var body = this.body;
      // Late media/font callbacks can run after switching modules. A hidden
      // body reports zero geometry; keep its last valid pages until shown.
      if (!(body.clientWidth > 0) || !(body.clientHeight > 0) || !(this.column > 1)) return false;
      var filler = body.querySelector(':scope > .book-filler');
      if (filler) filler.remove();
      var columns = Math.max(1, Math.round((body.scrollWidth + this.gap) / this.column));
      if (this.perSpread === 2 && columns % 2 === 1) {
        // Keep the last spread reachable: scrollLeft cannot pass the content edge.
        filler = document.createElement('div');
        filler.className = 'book-filler';
        filler.setAttribute('aria-hidden', 'true');
        body.appendChild(filler);
        columns += 1;
      }
      this.columns = columns;
      this.spreads = Math.max(1, Math.ceil(columns / this.perSpread));
      if (this.page >= this.spreads || this._pinEnd) this.page = this.spreads - 1;
      body.scrollLeft = this.page * this.stride;
      return true;
    },

    refresh: function () {
      if (!this._alive() || !(this.column > 1)) return;
      if (!this.measure()) return;
      this.updateChrome();
      this._revealFocus(document.activeElement);
    },

    // First and last page (column) an element occupies.
    _columnRange: function (element) {
      var bounds = this.body.getBoundingClientRect();
      var scale = bounds.width ? this.body.clientWidth / bounds.width : 1;
      var rects = element.getClientRects();
      var range = null;
      for (var i = 0; i < rects.length; i++) {
        if (!rects[i].width && !rects[i].height) continue;
        var left = (rects[i].left - bounds.left) * scale + this.body.scrollLeft;
        var right = (rects[i].right - bounds.left) * scale + this.body.scrollLeft;
        var first = Math.max(0, Math.floor((left + 2) / this.column));
        var last = Math.max(first, Math.floor((right - 2) / this.column));
        range = range ? [Math.min(range[0], first), Math.max(range[1], last)] : [first, last];
      }
      return range;
    },

    // The innermost element at the top of the shown spread: what the reader
    // was looking at, kept in view when the page format changes.
    _spreadStart: function () {
      if (!this._alive() || !this.measure()) return null;
      var first = this.firstColumn();
      var parent = this.body;
      var found = null;
      while (parent) {
        var inside = null;
        for (var child = parent.firstElementChild; child; child = child.nextElementSibling) {
          var range = this._columnRange(child);
          if (!range || range[1] < first) continue;
          if (range[0] >= first) return range[0] <= this.lastColumn() ? child : found;
          inside = child; // the spread begins inside it
          break;
        }
        if (!inside) return found;
        found = inside;
        parent = inside.firstElementChild ? inside : null;
      }
      return found;
    },

    // Where the reader is for a page format change: the spread's start, or
    // the element an earlier change kept while the reader has not turned
    // since, so trying formats one after another does not drift.
    formatAnchor: function () {
      var kept = this._formatKeep;
      if (kept && kept.isConnected && this.page === this._formatKeepPage) return kept;
      return this._spreadStart();
    },

    // A new page format changes type size and pages per spread.
    reformat: function (keep) {
      if (!this._alive()) return;
      this.layout(this.firstColumn());
      if (keep && keep.isConnected && this.body.contains(keep)) this.show(keep);
      this._formatKeep = keep;
      this._formatKeepPage = this.page;
    },

    settle: function () {
      if (!this._alive() || !(this.stride > 1) || !this.body.clientWidth) return;
      var body = this.body;
      var page = Math.max(0, Math.min(this.spreads - 1, Math.floor((body.scrollLeft + 2) / this.stride)));
      if (Math.abs(body.scrollLeft - page * this.stride) > 1) body.scrollLeft = page * this.stride;
      if (page !== this.page) {
        this._pinEnd = false;
        this.page = page;
        this.updateChrome();
      }
    },

    turn: function (delta) {
      if (!this._alive() || !this.measure()) return false;
      var target = this.page + delta;
      if (target < 0 || target >= this.spreads) {
        var direction = target < 0 ? 'previous' : 'next';
        if (!this._edgeLabel(direction) || typeof this.options.onEdge !== 'function') return false;
        this.options.onEdge(direction);
        return true;
      }
      this.goTo(target, true);
      return true;
    },

    goTo: function (page, animate) {
      this._pinEnd = false;
      var previous = this.page;
      var target = Math.max(0, Math.min(this.spreads - 1, page));
      // The turn copies the old pages before anything moves or closes; an
      // instant move ends a turn that is still playing.
      var turn = null;
      if (app.bookTurn) {
        if (animate && target !== previous) turn = app.bookTurn.prepare(this, previous, target);
        else app.bookTurn.end(this);
      }
      this.page = target;
      if (typeof this.options.beforeTurn === 'function') this.options.beforeTurn();
      // Jump instantly so rapid turns never race a running scroll; the motion
      // only covers the new spread for a moment (js/core/book-turn.js).
      this.body.scrollLeft = this.page * this.stride;
      this.updateChrome();
      if (turn) turn.play();
      this.reveal();
      var active = document.activeElement;
      if (active !== this.body && this.body.contains(active) && this._focusPage(active) !== this.page) {
        // An explicit keyboard/audio turn must not leave focus on the old
        // spread. Continue the native Tab order from a control on the new one.
        var focusTarget = this._spreadControls()[0];
        if (!focusTarget) focusTarget = this.frame.querySelector('.book-turn:not(:disabled)');
        (focusTarget || this.body).focus({ preventScroll: true });
      }
    },

    // Turn to the spread on which an element starts (read-aloud follow).
    show: function (element) {
      if (!this._alive() || !element || !this.body.contains(element)) return;
      if (!this.measure()) return;
      var page = Math.floor(this.columnOf(element) / this.perSpread);
      if (page !== this.page) this.goTo(page, false);
    },

    // Keep the whole frame, including its footer, inside the scroller after a turn.
    reveal: function () {
      var scroller = this.scroller;
      var scrollerRect = scroller.getBoundingClientRect();
      var frameRect = this.frame.getBoundingClientRect();
      if (frameRect.bottom <= scrollerRect.bottom + 1 && frameRect.top >= scrollerRect.top - 1) return;
      var scale = scrollerRect.height ? scroller.clientHeight / scrollerRect.height : 1;
      scroller.scrollTop += (frameRect.top - scrollerRect.top) * scale - 12;
    },

    _edgeLabel: function (direction) {
      return typeof this.options.edgeLabel === 'function' ? this.options.edgeLabel(direction) || '' : '';
    },

    _handleKey: function (event) {
      if (!this._alive() || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (!this.frame.getClientRects().length) return;
      var target = event.target;
      if (isEditable(target)) return;
      if (target && target !== document && target !== document.body && !this.scroller.contains(target))
        return;
      if (app.topLayer && app.topLayer.getCurrent()) return;
      var delta = 0;
      if (event.key === 'ArrowRight' || event.key === 'PageDown') delta = 1;
      else if (event.key === 'ArrowLeft' || event.key === 'PageUp') delta = -1;
      if (!delta) return;
      event.preventDefault();
      this.turn(delta);
    },

    // Names of the sections in reading order with the page each starts on.
    _sectionStarts: function () {
      var selector = this.options.sectionSelector;
      if (!selector) return [];
      var sections = this.body.querySelectorAll(selector);
      var starts = [];
      for (var i = 0; i < sections.length; i++) {
        var name = this.options.sectionName ? this.options.sectionName(sections[i]) : '';
        if (name) starts.push({ column: this.columnOf(sections[i]), name: name });
      }
      return starts;
    },

    // Section shown on a spread: the last one that starts on or before its last page.
    _sectionOn: function (starts, spread) {
      var last = Math.min(this.columns, (spread + 1) * this.perSpread) - 1;
      var name = '';
      for (var i = 0; i < starts.length && starts[i].column <= last; i++) name = starts[i].name;
      return name;
    },

    sectionName: function () {
      return this._sectionOn(this._sectionStarts(), this.page);
    },

    _pageRange: function (spread) {
      var first = spread * this.perSpread + 1;
      var last = Math.min(this.columns, (spread + 1) * this.perSpread);
      return last > first ? first + '–' + last : String(first);
    },

    _updatePageSelect: function (starts) {
      var select = this.frame.querySelector('.book-page-select');
      var labels = [];
      for (var spread = 0; spread < this.spreads; spread++) {
        var section = this._sectionOn(starts, spread);
        labels.push('第 ' + this._pageRange(spread) + ' 页' + (section ? ' · ' + section : ''));
      }
      var signature = labels.join('|');
      if (select._signature !== signature) {
        select._signature = signature;
        select.textContent = '';
        labels.forEach(function (label, index) {
          var option = document.createElement('option');
          option.value = String(index);
          option.textContent = label;
          select.appendChild(option);
        });
      }
      select.value = String(this.page);
      select.disabled = this.spreads < 2;
    },

    updateChrome: function () {
      var frame = this.frame;
      var first = this.firstColumn();
      var last = this.lastColumn() + 1;
      var atStart = this.page === 0;
      var atEnd = this.page >= this.spreads - 1;
      var prevLabel = atStart ? this._edgeLabel('previous') : '上一页';
      var nextLabel = atEnd ? this._edgeLabel('next') : '下一页';
      var twoPages = this.perSpread === 2 && last - first === 2;
      var parts = [
        '第 ' + (twoPages ? first + 1 + '–' + last : first + 1) + ' 页 / 共 ' + this.columns + ' 页',
      ];
      var starts = this._sectionStarts();
      var section = this._sectionOn(starts, this.page);
      if (section) parts.push(section);
      var extra = typeof this.options.statusExtra === 'function' ? this.options.statusExtra() : '';
      if (extra) parts.push(extra);
      frame.querySelector('.book-status').textContent = parts.join(' · ');
      this._updatePageSelect(starts);
      frame.querySelector('.book-page-total').textContent = '共 ' + this.columns + ' 页';
      frame.querySelector('.book-status-extra').textContent = extra;
      var buttons = frame.querySelectorAll('[data-book-flip]');
      for (var i = 0; i < buttons.length; i++) {
        var isNext = buttons[i].getAttribute('data-book-flip') === 'next';
        var label = isNext ? nextLabel : prevLabel;
        var crossing = (isNext ? atEnd : atStart) && !!label;
        buttons[i].disabled = !label;
        buttons[i].setAttribute('aria-label', label || (isNext ? '已是最后一页' : '已是第一页'));
        buttons[i].title = label || '';
        buttons[i].classList.toggle('is-crossing', crossing);
        if (buttons[i].classList.contains('book-turn')) {
          buttons[i].innerHTML = isNext
            ? '<span>' + (label || '下一页') + '</span>' + icon('chevron-right')
            : icon('chevron-left') + '<span>' + (label || '上一页') + '</span>';
        }
      }
      if (typeof this.options.onChange === 'function') this.options.onChange(this);
    },
  };

  app.readingLayout = {
    get: function () {
      return layout;
    },
    isBook: function () {
      return layout === 'book';
    },
    set: setLayout,
    getFormat: function () {
      return format;
    },
    setFormat: setFormat,
  };

  app.bookPager = {
    mount: function (options) {
      return new BookPager(options);
    },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindLayoutControl);
  else bindLayoutControl();
})(window);
