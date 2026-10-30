// Japanese classics reader (CLASSICS-01, local only). The 古典 module
// (js/classics/module.js) opens a work here and puts the reader's tools and
// directory in its drawer. One part (帖 / 卷 / 篇 / 节) is read at a time in
// the shared page-turn layout; the modern Japanese and Chinese translations
// show by default and the classical original only on request. 竹取物語 and
// 伊勢物語 carry a modern-Japanese narration that the pages can follow.
// Reading places, shown layers and narration positions are device
// preferences (localStorage); they are not part of the study archive.
(function (window) {
  'use strict';

  var app = window.JPLearn || (window.JPLearn = {});
  var STORE_KEY = 'jp_learning_classics_v1';
  var LAYERS = ['original', 'modern', 'zh', 'notes'];
  var TEXT_LAYERS = ['original', 'modern', 'zh'];
  var DEFAULT_LAYERS = { original: false, modern: true, zh: true, notes: false };
  var LAYER_LABELS = { original: '古文原文', modern: '现代日语', zh: '中文译文', notes: '译注' };
  var RATES = [0.75, 1, 1.25, 1.5];
  var SENTENCE_END = /[。！？!?]/;
  var CLOSER = /[」』）)】〕”’]/;
  var DIGITS = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  var BOOK_ID = /^[a-z][a-z0-9_-]{0,31}$/;

  function esc(value) {
    return app.html.escape(value);
  }

  function icon(name) {
    return typeof window.uiIcon === 'function' ? window.uiIcon(name) : '';
  }

  // 第百十五段: Japanese numerals for 伊勢物語 episode headings.
  function numeral(n) {
    var small = function (value) {
      if (value < 10) return DIGITS[value];
      var tens = Math.floor(value / 10);
      return (tens > 1 ? DIGITS[tens] : '') + '十' + (value % 10 ? DIGITS[value % 10] : '');
    };
    if (n < 100) return small(n);
    return (n >= 200 ? DIGITS[Math.floor(n / 100)] : '') + '百' + (n % 100 ? small(n % 100) : '');
  }

  function clock(seconds) {
    var total = Math.max(0, Math.floor(Number(seconds) || 0));
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = String(total % 60).padStart(2, '0');
    return h ? h + ':' + String(m).padStart(2, '0') + ':' + s : m + ':' + s;
  }

  function spokenClock(seconds) {
    var total = Math.max(0, Math.floor(Number(seconds) || 0));
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    return (h ? h + ' 小时 ' : '') + m + ' 分 ' + (total % 60) + ' 秒';
  }

  function count(value) {
    return Number(value || 0).toLocaleString('zh-CN');
  }

  // 〔原文判読困難〕-style markers from the translators read as editorial asides.
  function markGaps(html) {
    return html.replace(/〔[^〔〕<>]{1,80}〕/g, '<span class="cl-gap">$&</span>');
  }

  function partName(entry) {
    return (entry.label ? entry.label + ' ' : '') + entry.title;
  }

  // --- Device preferences ---------------------------------------------------

  function cleanLayers(raw) {
    var layers = {};
    LAYERS.forEach(function (name) {
      layers[name] = raw && typeof raw[name] === 'boolean' ? raw[name] : DEFAULT_LAYERS[name];
    });
    if (
      !TEXT_LAYERS.some(function (name) {
        return layers[name];
      })
    )
      layers.modern = true;
    return layers;
  }

  function cleanBook(raw) {
    raw = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    var place = {
      part: Number.isInteger(raw.part) && raw.part > 0 && raw.part < 1000 ? raw.part : 1,
      unit: typeof raw.unit === 'string' ? raw.unit.slice(0, 64) : '',
      offset: Number.isInteger(raw.offset) && raw.offset > 0 ? Math.min(raw.offset, 500) : 0,
      scrollRatio:
        typeof raw.scrollRatio === 'number' && isFinite(raw.scrollRatio)
          ? Math.max(0, Math.min(1, raw.scrollRatio))
          : 0,
      time: typeof raw.time === 'number' && isFinite(raw.time) && raw.time > 0 ? raw.time : 0,
      done: Array.isArray(raw.done)
        ? raw.done
            .filter(function (n) {
              return Number.isInteger(n) && n > 0 && n < 1000;
            })
            .slice(0, 1000)
        : [],
    };
    return place;
  }

  function loadState() {
    var raw = null;
    try {
      raw = JSON.parse(window.localStorage.getItem(STORE_KEY) || 'null');
    } catch (e) {
      raw = null;
    }
    raw = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    var books = {};
    if (raw.books && typeof raw.books === 'object' && !Array.isArray(raw.books))
      Object.keys(raw.books)
        .slice(0, 32)
        .forEach(function (id) {
          if (BOOK_ID.test(id)) books[id] = cleanBook(raw.books[id]);
        });
    return {
      version: 1,
      layers: cleanLayers(raw.layers),
      rate: RATES.indexOf(raw.rate) === -1 ? 1 : raw.rate,
      last: typeof raw.last === 'string' && BOOK_ID.test(raw.last) ? raw.last : '',
      books: books,
    };
  }

  function ClassicsReader(options) {
    this.readerEl = options.readerEl;
    this.sidebarEl = options.sidebarEl;
    this.hooks = options;
    this.state = loadState();
    this.active = false;
    this.book = null;
    this.partNumber = 0;
    this.part = null;
    this.pager = null;
    this._loadId = 0;
    this._saveTimer = 0;
    this._following = false;
    this._autoTurn = false;
    this._reading = null;
    this._lastAudioSave = 0;
    this._watchLayout();
    // Saves are debounced; leaving the page writes the pending one at once.
    var self = this;
    var flush = function () {
      self._rememberScroll();
      self._storeTime(true);
      if (self._saveTimer) self._save(true);
    };
    window.addEventListener('pagehide', flush);
    this.readerEl.addEventListener(
      'scroll',
      function () {
        self._rememberScroll();
      },
      { passive: true },
    );
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flush();
    });
  }

  ClassicsReader.prototype = {
    isActive: function () {
      return this.active;
    },

    currentBookId: function () {
      return this.book ? this.book.id : '';
    },

    // The work opened last on this device, for the module's first visit.
    lastBookId: function () {
      return this.state.last;
    },

    // A work's saved place, or null when it has not been opened here.
    placeOf: function (id) {
      return this.state.books[id] || null;
    },

    _place: function (id) {
      id = id || this.currentBookId();
      if (!this.state.books[id]) this.state.books[id] = cleanBook(null);
      return this.state.books[id];
    },

    _save: function (now) {
      var self = this;
      if (this._saveTimer) window.clearTimeout(this._saveTimer);
      this._saveTimer = 0;
      var write = function () {
        self._saveTimer = 0;
        try {
          window.localStorage.setItem(STORE_KEY, JSON.stringify(self.state));
        } catch (e) {
          /* A device preference: without storage it lasts for this page only. */
        }
      };
      if (now) write();
      else this._saveTimer = window.setTimeout(write, 400);
    },

    // --- Opening works and parts ---------------------------------------------

    // The module is shown. A layout change made while it was hidden lays the
    // open part out again at the saved place.
    activate: function () {
      this.active = true;
      if (!this.part) return;
      if (this._layoutDirty) {
        this._layoutDirty = false;
        var saved = this._place();
        this._render(
          saved.unit ? { unit: saved.unit, offset: saved.offset, scrollRatio: saved.scrollRatio } : null,
        );
        if (this.pager) this.readerEl.scrollTop = 0;
      } else if (this.pager) this.pager.refresh();
      this._setStatus();
    },

    deactivate: function () {
      this._rememberScroll();
      this.active = false;
      this._pauseAudio();
      this._save(true);
    },

    open: function (bookId) {
      var self = this;
      this._rememberScroll();
      var loadId = ++this._loadId;
      this.state.last = bookId;
      this._save();
      if (this.book && this.book.id === bookId && this.part) {
        // Selecting the displayed work also cancels a pending switch away.
        this._hooks('hideLoading');
        this._setStatus();
        this._syncSidebar();
        if (this.pager) this.pager.refresh();
        return Promise.resolve(true);
      }
      this._pauseAudio();
      this._following = false;
      this._hooks('showLoading', '读取作品目录');
      return app.classics
        .getBook(bookId)
        .then(function (book) {
          if (loadId !== self._loadId) return false;
          self.book = book;
          self.part = null;
          self.partNumber = 0;
          self._prepareAudio();
          var place = self._place(book.id);
          var n = Math.min(Math.max(1, place.part), book.parts.length);
          return self.openPart(
            n,
            place.part === n && place.unit
              ? { unit: place.unit, offset: place.offset, scrollRatio: place.scrollRatio }
              : null,
          );
        })
        .catch(function (error) {
          if (loadId !== self._loadId) return false;
          self._hooks('hideLoading');
          self._showError('古典资料无法加载', error, function () {
            return self.open(bookId);
          });
          return false;
        });
    },

    // where: null (first page), 'end' (last spread), or {unit, offset}.
    openPart: function (n, where, options) {
      var self = this;
      var book = this.book;
      if (!book || n < 1 || n > book.parts.length) return Promise.resolve(false);
      this._rememberScroll();
      var loadId = ++this._loadId;
      if (!(options && options.keepFollowing)) this._following = false;
      this._hooks('showLoading', '读取' + partName(book.parts[n - 1]));
      return app.classics
        .getPart(book, n)
        .then(function (part) {
          if (loadId !== self._loadId || self.book !== book) return false;
          self.part = part;
          self.partNumber = n;
          var place = self._place(book.id);
          place.part = n;
          if (!where || where === 'end') {
            place.unit = '';
            place.offset = 0;
          }
          self._render(where);
          self._hooks('hideLoading');
          self._setStatus();
          self._syncSidebar();
          self._save();
          return true;
        })
        .catch(function (error) {
          if (loadId !== self._loadId) return false;
          self._hooks('hideLoading');
          self._showError('本' + book.noun + '无法加载', error, function () {
            return self.openPart(n, where);
          });
          return false;
        });
    },

    _adjacent: function () {
      var parts = (this.book && this.book.parts) || [];
      return {
        previous: parts[this.partNumber - 2] || null,
        current: parts[this.partNumber - 1] || null,
        next: parts[this.partNumber] || null,
      };
    },

    // --- Rendering --------------------------------------------------------------

    _render: function (where) {
      if (this.pager) this.pager.destroy();
      this.pager = null;
      this._reading = null;
      var heading = this._ensureHeading();
      var template = document.createElement('template');
      template.innerHTML =
        this._audioHtml() + '<div class="cl-body" tabindex="-1">' + this._bodyHtml() + '</div>';
      Array.prototype.slice.call(this.readerEl.childNodes).forEach(function (node) {
        if (node !== heading) node.remove();
      });
      if (heading.parentNode !== this.readerEl) this.readerEl.prepend(heading);
      this.readerEl.appendChild(template.content);
      this._applyLayers();
      this._renderHeading();
      this._bindReader();
      this._syncAudioUi();
      this._mount(where);
    },

    _ensureHeading: function () {
      if (!this.headingEl) {
        var host = document.createElement('header');
        host.id = 'clPartHeading';
        host.className = 'page-heading page-heading--lesson';
        host.hidden = true;
        this.headingEl = host;
      }
      return this.headingEl;
    },

    _renderHeading: function () {
      var heading = app.pageHeading;
      var entry = this._adjacent().current;
      if (!heading || !entry) return;
      var self = this;
      var adjacent = this._adjacent();
      var noun = this.book.noun;
      var original = this.state.layers.original;
      heading.render(
        this.headingEl,
        {
          variant: 'lesson',
          titlePrefix: entry.label,
          title: entry.title,
          titleLang: 'ja',
          actions: [
            {
              id: 'previous',
              label: '上一' + noun,
              icon: 'chevron-left',
              variant: 'quiet',
              disabled: !adjacent.previous,
              title: adjacent.previous
                ? '上一' + noun + '：' + partName(adjacent.previous)
                : '已经是第一' + noun,
            },
            {
              id: 'next',
              label: '下一' + noun,
              icon: 'chevron-right',
              iconAfter: true,
              variant: 'quiet',
              disabled: !adjacent.next,
              title: adjacent.next ? '下一' + noun + '：' + partName(adjacent.next) : '已经是最后一' + noun,
            },
            {
              id: 'original',
              label: '古文',
              icon: original ? 'eye' : 'eye-off',
              pressed: original,
              title: original ? '隐藏古文原文' : '显示古文原文',
            },
            { id: 'toc', label: '目录', icon: 'list', title: '打开' + this.book.title + '目录' },
          ],
        },
        {
          previous: function () {
            self.openPart(self.partNumber - 1, 'end');
          },
          next: function () {
            self.openPart(self.partNumber + 1, null);
          },
          original: function () {
            self.setLayer('original', !self.state.layers.original);
          },
          toc: function (button) {
            self._openDirectory(button);
          },
        },
      );
    },

    _openingHtml: function (entry) {
      var meta = [count(this.part.units.length) + ' 段', count(entry.chars) + ' 字'];
      if (entry.audioStart !== undefined) meta.push('朗读 ' + clock(entry.audioEnd - entry.audioStart));
      return (
        '<header class="cl-opening">' +
        '<h2 class="cl-opening-title" lang="ja">' +
        (entry.label ? '<span class="cl-opening-label" lang="zh-CN">' + esc(entry.label) + '</span>' : '') +
        '<span class="cl-opening-name">' +
        esc(entry.title) +
        '</span></h2>' +
        '<div class="cl-opening-side"><p class="cl-opening-book" lang="ja">' +
        esc(this.book.titleJa) +
        '</p><p class="cl-opening-meta">' +
        esc(meta.join(' · ')) +
        '</p></div></header>'
      );
    },

    _modernHtml: function (text) {
      // Narrated works mark sentences so the narration can be followed.
      if (!this.book.audio) return markGaps(esc(text));
      var chars = Array.from(text);
      var html = '';
      var start = 0;
      var sentence = function (from, to) {
        return (
          '<span class="cl-s" data-o="' +
          from +
          '">' +
          markGaps(esc(chars.slice(from, to).join(''))) +
          '</span>'
        );
      };
      for (var i = 0; i < chars.length; i++) {
        if (!SENTENCE_END.test(chars[i])) continue;
        var end = i + 1;
        while (end < chars.length && CLOSER.test(chars[end])) end++;
        html += sentence(start, end);
        start = end;
        i = end - 1;
      }
      if (start < chars.length) html += sentence(start, chars.length);
      return html;
    },

    _bodyHtml: function () {
      var self = this;
      var entry = this._adjacent().current;
      var html = this._openingHtml(entry);
      this.part.units.forEach(function (unit) {
        if (unit.episode)
          html +=
            '<h3 class="cl-episode-head" lang="ja" data-episode="' +
            Number(unit.episode) +
            '">第' +
            numeral(Number(unit.episode)) +
            '段</h3>';
        var notes = Array.isArray(unit.notes) ? unit.notes : [];
        html +=
          '<div class="cl-unit" data-unit-id="' +
          esc(unit.id) +
          '">' +
          '<p class="cl-original" lang="ja">' +
          markGaps(esc(unit.original)) +
          '</p>' +
          '<p class="cl-modern" lang="ja">' +
          self._modernHtml(String(unit.modern || '')) +
          '</p>' +
          '<p class="cl-zh" lang="zh-CN">' +
          markGaps(esc(unit.zh)) +
          '</p>' +
          (notes.length
            ? '<ol class="cl-notes" lang="zh-CN">' +
              notes
                .map(function (note) {
                  return '<li>' + esc(note) + '</li>';
                })
                .join('') +
              '</ol>'
            : '') +
          '</div>';
      });
      return html + this._endHtml();
    },

    _endHtml: function () {
      var adjacent = this._adjacent();
      var noun = this.book.noun;
      var next = adjacent.next;
      return (
        '<footer class="cl-end"><p class="cl-end-mark">' +
        (next ? '本' + esc(noun) + '完' : '全书完') +
        '</p>' +
        (next
          ? '<button type="button" class="tb-lesson-end-link is-next" data-cl-step="next">' +
            '<span class="tb-lesson-end-copy"><small>下一' +
            esc(noun) +
            (next.label ? ' · ' + esc(next.label) : '') +
            '</small><strong lang="ja">' +
            esc(next.title) +
            '</strong></span>' +
            icon('chevron-right') +
            '</button>'
          : '') +
        '</footer>'
      );
    },

    _applyLayers: function () {
      var layers = this.state.layers;
      var reader = this.readerEl;
      LAYERS.forEach(function (name) {
        reader.classList.toggle('cl-hide-' + name, !layers[name]);
      });
    },

    // --- Page-turn layout and reading place ---------------------------------

    _watchLayout: function () {
      var self = this;
      if (!app.events) return;
      app.events.on('reading-layout:change', function () {
        if (!self.part) return;
        // A hidden reader has no geometry to measure the place with.
        if (!self.active) {
          self._layoutDirty = true;
          return;
        }
        var place = self._capture();
        self._render(place);
        if (self.pager) self.readerEl.scrollTop = 0;
      });
    },

    _units: function () {
      var body = this._body();
      return body ? Array.prototype.slice.call(body.querySelectorAll('.cl-unit')) : [];
    },

    _body: function () {
      return this.readerEl.querySelector('.cl-body');
    },

    _unitEl: function (id) {
      var body = this._body();
      if (!body || !id) return null;
      var units = body.querySelectorAll('.cl-unit');
      for (var i = 0; i < units.length; i++)
        if (units[i].getAttribute('data-unit-id') === id) return units[i];
      return null;
    },

    // The content element that shows a unit: its first displayed layer.
    _visible: function (unit) {
      var children = unit ? unit.children : [];
      for (var i = 0; i < children.length; i++) if (children[i].getClientRects().length) return children[i];
      return null;
    },

    _lastColumn: function (element) {
      var pager = this.pager;
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
    },

    // Where the reader is: the unit the shown spread starts in, and how many
    // pages into it, so a new layout or layer choice returns to the same text.
    _capture: function () {
      var pager = this.pager;
      var units = this._units();
      if (!units.length) return null;
      if (!pager) {
        if (!this.readerEl.scrollTop) return null;
        var top = this.readerEl.getBoundingClientRect().top;
        for (var j = 0; j < units.length; j++) {
          var bounds = units[j].getBoundingClientRect();
          if (bounds.bottom > top + 24)
            return {
              unit: units[j].getAttribute('data-unit-id'),
              offset: 0,
              scrollRatio: bounds.height ? Math.max(0, Math.min(1, (top - bounds.top) / bounds.height)) : 0,
            };
        }
        return null;
      }
      if (pager.page === 0) return null;
      var first = pager.firstColumn();
      var found = null;
      for (var i = 0; i < units.length; i++) {
        var shown = this._visible(units[i]);
        if (!shown) continue;
        var column = pager.columnOf(shown);
        if (column > first) {
          if (!found) found = { unit: units[i].getAttribute('data-unit-id'), offset: 0 };
          break;
        }
        found = { unit: units[i].getAttribute('data-unit-id'), offset: first - column };
        // Later units can begin lower in this same column; keep its first text.
        if (this._lastColumn(units[i]) >= first) break;
      }
      return found;
    },

    _restore: function (where) {
      var pager = this.pager;
      if (where === 'end') {
        if (pager) pager.goTo(pager.spreads - 1, false);
        else this.readerEl.scrollTop = this.readerEl.scrollHeight;
        return;
      }
      var unit = where && where.unit ? this._unitEl(where.unit) : null;
      var shown = this._visible(unit);
      if (!shown) return;
      if (!pager) {
        var bounds = unit.getBoundingClientRect();
        var readerBounds = this.readerEl.getBoundingClientRect();
        var scale = readerBounds.width ? this.readerEl.clientWidth / readerBounds.width : 1;
        this.readerEl.scrollTop +=
          (bounds.top - readerBounds.top + bounds.height * (where.scrollRatio || 0)) * scale;
        return;
      }
      // The offset can lie in a later layer, such as the Chinese translation.
      var column = Math.min(pager.columnOf(shown) + (where.offset || 0), this._lastColumn(unit));
      var page = Math.max(0, Math.min(pager.spreads - 1, Math.floor(column / pager.perSpread)));
      if (page !== pager.page) pager.goTo(page, false);
    },

    _signature: function () {
      var pager = this.pager;
      var layers = this.state.layers;
      return [
        pager.body.clientWidth,
        pager.body.clientHeight,
        pager.perSpread,
        document.documentElement.getAttribute('data-book-format') || 'default',
        LAYERS.map(function (name) {
          return layers[name] ? 1 : 0;
        }).join(''),
      ].join('|');
    },

    _mount: function (where) {
      var self = this;
      var body = this._body();
      var book = this.book;
      var n = this.partNumber;
      if (!app.readingLayout || !app.readingLayout.isBook()) {
        this.readerEl.classList.remove('tb-reader--book');
        this.readerEl.scrollTop = 0;
        this._restore(where);
        return;
      }
      this.readerEl.classList.add('tb-reader--book');
      var anchor = { place: where && where !== 'end' ? where : null, signature: '' };
      var restoring = false;
      var settled = false;
      this.pager = app.bookPager.mount({
        body: body,
        scroller: this.readerEl,
        label: book.title + '翻页阅读',
        anchor: where === 'end' ? Infinity : 0,
        observe: [this.headingEl, this.readerEl.querySelector('.cl-audio')],
        sectionSelector: book.id === 'ise' ? ':scope > .cl-episode-head' : '',
        sectionName: function (head) {
          return head.textContent.trim();
        },
        edgeLabel: function (direction) {
          var target = direction === 'next' ? self._adjacent().next : self._adjacent().previous;
          return target ? (direction === 'next' ? '下一' : '上一') + book.noun : '';
        },
        onEdge: function (direction) {
          if (direction === 'next') self.openPart(n + 1, null);
          else self.openPart(n - 1, 'end');
        },
        beforeTurn: function () {
          if (!self._autoTurn && !restoring) self._stopFollowing();
        },
        onChange: function (pager) {
          if (self.book !== book || self.partNumber !== n || restoring) return;
          self.pager = pager;
          var signature = self._signature();
          if (anchor.place && (!settled || signature !== anchor.signature)) {
            restoring = true;
            self._restore(anchor.place);
            restoring = false;
          } else if (settled) {
            anchor.place = self._capture();
          }
          anchor.signature = signature;
          self._remember(anchor.place, pager);
        },
      });
      this._anchor = anchor;
      var pager = this.pager;
      Promise.resolve(document.fonts && document.fonts.ready).then(function () {
        if (self.pager !== pager || !body.isConnected) return;
        pager.refresh();
        settled = true;
        if (anchor.place) {
          restoring = true;
          self._restore(anchor.place);
          restoring = false;
        }
        if (self._following && self._reading) self._highlight(self._reading, true);
      });
    },

    _remember: function (place, pager) {
      var saved = this._place();
      saved.part = this.partNumber;
      saved.unit = place ? place.unit : '';
      saved.offset = place ? place.offset : 0;
      saved.scrollRatio = place && place.scrollRatio ? place.scrollRatio : 0;
      if (pager && pager.page >= pager.spreads - 1 && saved.done.indexOf(this.partNumber) === -1) {
        saved.done.push(this.partNumber);
        this._syncSidebar();
      }
      this._save();
    },

    _rememberScroll: function () {
      if (
        this.pager ||
        !this.part ||
        !this.active ||
        !this.readerEl.clientWidth ||
        !this.readerEl.clientHeight
      )
        return;
      this._remember(this._capture(), null);
    },

    // A layer change re-lays the pages; return to the text the reader was on.
    setLayer: function (name, on) {
      if (LAYERS.indexOf(name) === -1) return;
      var layers = this.state.layers;
      if (!on && TEXT_LAYERS.indexOf(name) !== -1) {
        var others = TEXT_LAYERS.filter(function (other) {
          return other !== name && layers[other];
        });
        if (!others.length) return;
      }
      var place = this.pager ? this._capture() : null;
      layers[name] = !!on;
      this._applyLayers();
      this._save();
      if (this.part) this._renderHeading();
      this._syncSidebar();
      if (this.pager) {
        if (this._anchor) this._anchor.place = place;
        this.pager.refresh();
      }
      if (this._reading) this._highlight(this._reading, false);
    },

    _bindReader: function () {
      var self = this;
      this.readerEl.onclick = function (event) {
        var target = event.target && event.target.closest ? event.target : null;
        if (!target) return;
        var step = target.closest('[data-cl-step]');
        if (step) {
          self.openPart(self.partNumber + 1, null).then(function (loaded) {
            var title = loaded && self.headingEl.querySelector('.page-heading-title');
            if (title) title.focus({ preventScroll: true });
          });
          return;
        }
        var control = target.closest('[data-cl-audio]');
        if (control) self._audioAction(control.getAttribute('data-cl-audio'));
      };
      var seek = this.readerEl.querySelector('.cl-audio-seek');
      if (seek) {
        seek.addEventListener('input', function () {
          self._seeking = true;
          self._syncAudioUi(Number(seek.value));
        });
        seek.addEventListener('change', function () {
          self._seeking = false;
          self._seek(Number(seek.value), true);
        });
      }
      var rate = this.readerEl.querySelector('.cl-audio-rate');
      if (rate)
        rate.addEventListener('change', function () {
          var value = Number(rate.value);
          if (RATES.indexOf(value) === -1) return;
          self.state.rate = value;
          if (self.audio) self.audio.playbackRate = value;
          self._save();
        });
    },

    _showError: function (title, error, retry) {
      if (this.pager) this.pager.destroy();
      this.pager = null;
      if (this.headingEl) this.headingEl.hidden = true;
      var view = window.StateView;
      if (!view) {
        this.readerEl.textContent = title;
        return;
      }
      Array.prototype.slice.call(this.readerEl.childNodes).forEach(function (node) {
        node.remove();
      });
      var host = document.createElement('div');
      this.readerEl.appendChild(host);
      view.mount(host, {
        kind: 'error',
        className: 'tb-reader-error-state',
        icon: 'book',
        title: title,
        message: '本机的古典资料不完整，可以重试；资料由 tools/build_classics_library.cjs 生成。',
        details: error && error.message,
        action: { id: 'retry-classics', label: '重试', icon: 'rotate-ccw', onClick: retry },
      });
    },

    // --- Drawer: reading tools and directory ------------------------------------

    sidebarHtml: function () {
      var book = this.book;
      if (!book) return '';
      var self = this;
      var toggles = LAYERS.map(function (name) {
        var state = self._layerButton(name);
        return (
          '<button type="button" class="cl-layer-btn" data-cl-layer="' +
          name +
          '" aria-pressed="' +
          (state.on ? 'true' : 'false') +
          '"' +
          (state.last ? ' disabled title="至少显示一种文本"' : '') +
          '>' +
          state.inner +
          '</button>'
        );
      }).join('');
      var source = book.source || {};
      var rows = [
        ['底本', source.edition],
        ['许可', source.license],
        ['译文', source.status ? source.status + '（AI 生成）：' + (source.quality || '') : source.quality],
      ];
      if (book.audio)
        rows.push([
          '朗读',
          '现代日语译文 · ' +
            (book.audio.model || '') +
            ' · ' +
            clock(book.audio.duration) +
            '；位置按字数估算',
        ]);
      var sourceHtml = rows
        .filter(function (row) {
          return row[1];
        })
        .map(function (row) {
          return '<div><dt>' + esc(row[0]) + '</dt><dd>' + esc(row[1]) + '</dd></div>';
        })
        .join('');
      if (source.url)
        sourceHtml +=
          '<div><dt>来源</dt><dd><a href="' +
          esc(source.url) +
          '" target="_blank" rel="noopener noreferrer">' +
          esc(source.url.replace(/^https:\/\//, '').slice(0, 48)) +
          '</a></dd></div>';
      var cards = book.parts
        .map(function (entry) {
          var current = entry.n === self.partNumber;
          var meta = count(entry.units) + ' 段 · ' + count(entry.chars) + ' 字';
          if (entry.audioStart !== undefined) meta += ' · ' + clock(entry.audioEnd - entry.audioStart);
          return (
            '<button type="button" class="tb-lesson-card cl-part-card' +
            (current ? ' active' : '') +
            '" data-cl-part="' +
            entry.n +
            '"' +
            (current ? ' aria-current="page"' : '') +
            '><div class="tb-lesson-card-head"><span class="tb-lesson-no">' +
            esc(entry.label || book.noun + ' ' + entry.n) +
            '</span>' +
            self._cardChip(entry) +
            '</div><div class="tb-lesson-title" lang="ja">' +
            esc(entry.title) +
            '</div><div class="tb-lesson-meta"><span class="tb-lesson-pages">' +
            esc(meta) +
            '</span></div></button>'
          );
        })
        .join('');
      return (
        '<details class="tb-sidebar-group tb-sidebar-reading-group cl-tools-group"><summary><span>阅读工具</span><small>本机保存</small></summary>' +
        '<div class="tb-sidebar-reading-controls cl-tools"><span class="tb-sidebar-control-label">显示内容</span>' +
        '<div class="cl-layer-toggles" role="group" aria-label="显示内容">' +
        toggles +
        '</div><span class="tb-sidebar-control-label">版本与来源</span><dl class="cl-source">' +
        sourceHtml +
        '</dl></div></details>' +
        '<details class="tb-sidebar-group tb-lesson-directory cl-directory" data-cl-book="' +
        esc(book.id) +
        '"><summary><span>目录</span><small>' +
        book.parts.length +
        ' ' +
        esc(book.noun) +
        '</small></summary><div class="tb-lesson-list">' +
        cards +
        '</div></details>'
      );
    },

    _layerButton: function (name) {
      var layers = this.state.layers;
      var on = layers[name];
      var shown = TEXT_LAYERS.filter(function (other) {
        return layers[other];
      });
      return {
        on: on,
        last: on && shown.length === 1 && TEXT_LAYERS.indexOf(name) !== -1,
        inner: icon(on ? 'check' : 'eye-off') + esc(LAYER_LABELS[name]),
      };
    },

    _cardChip: function (entry) {
      if (entry.n === this.partNumber) return '<span class="tb-lesson-progress is-current">当前阅读</span>';
      if (this._place().done.indexOf(entry.n) !== -1)
        return '<span class="tb-lesson-progress is-complete">读完</span>';
      return '';
    },

    // Updates the drawer without replacing its controls, so focus stays put.
    _syncSidebar: function () {
      var container = this.sidebarEl;
      var directory = container && container.querySelector('.cl-directory');
      if (!directory || directory.getAttribute('data-cl-book') !== this.currentBookId()) {
        this._hooks('renderSidebar');
        return;
      }
      var self = this;
      container.querySelectorAll('[data-cl-layer]').forEach(function (button) {
        var state = self._layerButton(button.getAttribute('data-cl-layer'));
        button.setAttribute('aria-pressed', state.on ? 'true' : 'false');
        button.disabled = state.last;
        if (state.last) button.title = '至少显示一种文本';
        else button.removeAttribute('title');
        if (button._inner !== state.inner) {
          button.innerHTML = state.inner;
          button._inner = state.inner;
        }
      });
      directory.querySelectorAll('[data-cl-part]').forEach(function (card) {
        var entry = self.book.parts[Number(card.getAttribute('data-cl-part')) - 1];
        if (!entry) return;
        var current = entry.n === self.partNumber;
        card.classList.toggle('active', current);
        if (current) card.setAttribute('aria-current', 'page');
        else card.removeAttribute('aria-current');
        var head = card.querySelector('.tb-lesson-card-head');
        var chip = head.querySelector('.tb-lesson-progress');
        var html = self._cardChip(entry);
        if ((chip ? chip.outerHTML : '') === html) return;
        if (chip) chip.remove();
        if (html) head.insertAdjacentHTML('beforeend', html);
      });
    },

    // Returns true when the click belonged to the classics drawer controls.
    handleSidebarClick: function (event) {
      var target = event.target && event.target.closest ? event.target : null;
      if (!target) return false;
      var layer = target.closest('[data-cl-layer]');
      if (layer) {
        var name = layer.getAttribute('data-cl-layer');
        if (!layer.disabled) this.setLayer(name, !this.state.layers[name]);
        return true;
      }
      var card = target.closest('[data-cl-part]');
      if (card) {
        var n = Number(card.getAttribute('data-cl-part'));
        if (n !== this.partNumber) this.openPart(n, null);
        return true;
      }
      return false;
    },

    _openDirectory: function (trigger) {
      var self = this;
      var layout = window.PanelLayout;
      if (!layout || !layout.openTools) return false;
      return layout.openTools({
        returnFocus: trigger,
        focus: function () {
          var directory = self.sidebarEl && self.sidebarEl.querySelector('.cl-directory');
          if (!directory) return null;
          directory.open = true;
          var current = directory.querySelector('.cl-part-card[aria-current="page"]');
          if (current) current.scrollIntoView({ block: 'nearest' });
          return current || directory.querySelector('summary');
        },
      });
    },

    _setStatus: function () {
      var entry = this._adjacent().current;
      this._hooks('setStatus', {
        book: this.book ? this.book.title : '',
        part: entry ? partName(entry) : '',
      });
    },

    _hooks: function (name, value) {
      if (typeof this.hooks[name] === 'function') this.hooks[name](value);
    },

    // --- Narration ----------------------------------------------------------------

    _audioHtml: function () {
      var book = this.book;
      if (!book.audio) return '';
      var duration = book.audio.duration || 1;
      var marks = book.parts
        .slice(1)
        .filter(function (entry) {
          return entry.audioStart !== undefined;
        })
        .map(function (entry) {
          return '<i style="left:' + ((entry.audioStart / duration) * 100).toFixed(3) + '%"></i>';
        })
        .join('');
      var rates = RATES.map(function (rate) {
        return '<option value="' + rate + '">' + rate + '×</option>';
      }).join('');
      return (
        '<div class="cl-audio" role="group" aria-label="' +
        esc(book.title) +
        '现代日语朗读">' +
        '<button type="button" class="cl-audio-play" data-cl-audio="toggle"></button>' +
        '<button type="button" class="cl-audio-here" data-cl-audio="here" aria-label="从本页读" title="从当前页第一句开始朗读">' +
        icon('skip') +
        '<span>从本页读</span></button>' +
        '<span class="cl-audio-time"><span class="cl-audio-now">0:00</span> / ' +
        clock(book.audio.duration) +
        '</span>' +
        '<div class="cl-audio-track"><span class="cl-audio-range" aria-hidden="true"></span><span class="cl-audio-marks" aria-hidden="true">' +
        marks +
        '</span><input type="range" class="cl-audio-seek" min="0" max="' +
        Math.ceil(duration) +
        '" step="5" value="0" aria-label="朗读位置"></div>' +
        '<select class="cl-audio-rate" aria-label="朗读速度">' +
        rates +
        '</select>' +
        '<button type="button" class="cl-audio-follow" data-cl-audio="follow" hidden>' +
        icon('target') +
        '<span>回到朗读处</span></button>' +
        '<span class="cl-audio-error" role="status" aria-live="polite" hidden></span>' +
        '</div>'
      );
    },

    _prepareAudio: function () {
      var book = this.book;
      if (!book || !book.audio) {
        if (this.audio) {
          this.audio.pause();
          this._storeTime(true);
          this.audio.removeAttribute('src');
          this.audio.load();
          this._audioBook = '';
        }
        return;
      }
      var self = this;
      if (!this.audio) {
        var audio = new Audio();
        audio.preload = 'metadata';
        ['play', 'pause', 'ended', 'loadedmetadata'].forEach(function (type) {
          audio.addEventListener(type, function () {
            self._audioEvent(type);
          });
        });
        audio.addEventListener('timeupdate', function () {
          self._onTime();
        });
        audio.addEventListener('error', function () {
          self._audioFailed();
        });
        this.audio = audio;
      }
      if (this._audioBook === book.id) return;
      this.audio.pause();
      this._storeTime(true);
      this._audioBook = book.id;
      this._audioError = '';
      this._pendingTime = this._place(book.id).time || 0;
      this.audio.src = app.classics.audioUrl(book);
      this.audio.playbackRate = this.state.rate;
    },

    _audioEvent: function (type) {
      if (type === 'loadedmetadata' && this._pendingTime) {
        this.audio.currentTime = Math.min(this._pendingTime, this.audio.duration || this._pendingTime);
        this._pendingTime = 0;
      }
      if (type === 'play') this._mediaSession();
      if (type === 'pause' || type === 'ended') {
        this._storeTime(true);
        if (type === 'ended') this._following = false;
      }
      this._syncAudioUi();
    },

    _audioFailed: function () {
      if (!this.book || !this.book.audio) return;
      this._audioError = '朗读音频无法加载：本机缺少 data/classics_v1/' + this.book.id + '/audio.mp3';
      this._following = false;
      this._syncAudioUi();
    },

    _audioTime: function () {
      if (!this.audio) return 0;
      return this._pendingTime || this.audio.currentTime || 0;
    },

    _pauseAudio: function () {
      if (this.audio && !this.audio.paused) this.audio.pause();
    },

    _audioAction: function (action) {
      if (!this.audio || !this.book || !this.book.audio) return;
      if (action === 'toggle') {
        if (this.audio.paused) {
          this._following = true;
          this._play();
        } else this.audio.pause();
      } else if (action === 'here') {
        this._playFromSpread();
      } else if (action === 'follow') {
        this._following = true;
        this._onTime(true);
      }
      this._syncAudioUi();
    },

    _play: function () {
      var self = this;
      this.audio.playbackRate = this.state.rate;
      var started = this.audio.play();
      if (started && started.catch)
        started.catch(function (error) {
          if (error && error.name === 'AbortError') return;
          self._audioFailed();
        });
    },

    _seek: function (time, follow) {
      if (!this.audio) return;
      time = Math.max(0, Math.min(Number(time) || 0, this.book.audio.duration));
      if (this.audio.readyState >= 1) this.audio.currentTime = time;
      else this._pendingTime = time;
      if (follow) this._following = true;
      this._onTime(true);
      this._storeTime(true);
    },

    // The first sentence that starts on the shown spread, or the one the
    // spread begins inside.
    _spreadStartTime: function () {
      var timeline = this.book.timeline;
      var units = this._units();
      var pager = this.pager;
      var first = pager ? pager.firstColumn() : 0;
      var last = pager ? pager.lastColumn() : 0;
      var top = this.readerEl.getBoundingClientRect().top;
      var best = null;
      for (var i = 0; i < units.length; i++) {
        var id = units[i].getAttribute('data-unit-id');
        var sentences = units[i].querySelectorAll('.cl-modern .cl-s');
        var targets =
          sentences.length && sentences[0].getClientRects().length ? sentences : [this._visible(units[i])];
        for (var j = 0; j < targets.length; j++) {
          var element = targets[j];
          if (!element || !element.getClientRects().length) continue;
          var offset = element.hasAttribute('data-o') ? Number(element.getAttribute('data-o')) : 0;
          var before = pager ? pager.columnOf(element) < first : element.getBoundingClientRect().top < top;
          if (before) {
            best = { id: id, offset: offset };
            continue;
          }
          if (!pager || pager.columnOf(element) <= last) best = { id: id, offset: offset };
          return best ? timeline.timeAt(best.id, best.offset) : null;
        }
      }
      return best ? timeline.timeAt(best.id, best.offset) : null;
    },

    _playFromSpread: function () {
      var time = this._spreadStartTime();
      if (time === null || time === undefined) {
        var entry = this._adjacent().current;
        time = entry && entry.audioStart !== undefined ? entry.audioStart : 0;
      }
      // Just past the sentence start: after a seek the media element may report
      // a time a hair earlier, which would name the previous sentence.
      this._seek(time + 0.05, true);
      this._play();
    },

    _partAt: function (time) {
      var parts = this.book.parts;
      for (var i = parts.length - 1; i >= 0; i--)
        if (parts[i].audioStart !== undefined && parts[i].audioStart <= time + 0.05) return parts[i].n;
      return 1;
    },

    _onTime: function (force) {
      if (!this.book || !this.book.audio || !this.audio) return;
      var time = this._audioTime();
      if (!this._seeking) this._syncAudioUi();
      this._storeTime(false);
      if (!this.active || !this.part) return;
      var position = this.book.timeline.positionAt(time);
      if (!position) return;
      var part = this._partAt(time);
      if (part !== this.partNumber) {
        this._clearHighlight();
        // Following the narration into the next part opens it.
        if (this._following && (!this.audio.paused || force) && this._followPart !== part) {
          var self = this;
          this._followPart = part;
          this.openPart(part, { unit: position.id, offset: 0 }, { keepFollowing: true }).then(
            function (loaded) {
              self._followPart = 0;
              if (loaded) self._highlight(position, true);
            },
          );
        }
        return;
      }
      var same =
        this._reading &&
        this._reading.id === position.id &&
        this._reading.sentence === this._sentenceOf(position);
      if (same && !force) return;
      this._highlight(position, this._following);
    },

    _sentenceOf: function (position) {
      var unit = this._unitEl(position.id);
      if (!unit) return null;
      var sentences = unit.querySelectorAll('.cl-modern .cl-s');
      var found = null;
      for (var i = 0; i < sentences.length; i++)
        if (Number(sentences[i].getAttribute('data-o')) <= position.offset) found = sentences[i];
      return found;
    },

    _clearHighlight: function () {
      var body = this._body();
      if (body)
        body.querySelectorAll('.is-reading').forEach(function (element) {
          element.classList.remove('is-reading');
        });
      this._reading = null;
    },

    _highlight: function (position, follow) {
      var unit = this._unitEl(position.id);
      var sentence = this._sentenceOf(position);
      this._clearHighlight();
      if (!unit) return;
      unit.classList.add('is-reading');
      if (sentence) sentence.classList.add('is-reading');
      this._reading = { id: position.id, offset: position.offset, sentence: sentence };
      if (!follow) return;
      var target = sentence && sentence.getClientRects().length ? sentence : this._visible(unit);
      if (!target) return;
      if (this.pager) {
        this._autoTurn = true;
        this.pager.show(target);
        this._autoTurn = false;
      } else target.scrollIntoView({ block: 'center' });
    },

    _stopFollowing: function () {
      if (!this._following) return;
      this._following = false;
      this._syncAudioUi();
    },

    _storeTime: function (now) {
      if (!this._audioBook || !this.audio) return;
      var stamp = Date.now();
      if (!now && stamp - this._lastAudioSave < 5000) return;
      this._lastAudioSave = stamp;
      this._place(this._audioBook).time = Math.round(this._audioTime() * 10) / 10;
      this._save(now);
    },

    _mediaSession: function () {
      if (!('mediaSession' in navigator) || typeof window.MediaMetadata !== 'function') return;
      var entry = this.book.parts[this._partAt(this._audioTime()) - 1];
      try {
        navigator.mediaSession.metadata = new window.MediaMetadata({
          title: entry ? partName(entry) : this.book.titleJa,
          artist: '现代日语朗读',
          album: this.book.titleJa,
        });
      } catch (e) {
        /* Media keys keep working without the title. */
      }
    },

    _syncAudioUi: function (previewTime) {
      var strip = this.readerEl.querySelector('.cl-audio');
      if (!strip || !this.book || !this.book.audio) return;
      var audio = this.audio;
      var playing = !!(audio && !audio.paused);
      var time = typeof previewTime === 'number' ? previewTime : this._audioTime();
      var duration = this.book.audio.duration || 1;
      var play = strip.querySelector('.cl-audio-play');
      var label = playing ? '暂停朗读' : time > 1 ? '继续朗读' : '播放朗读';
      var inner = icon(playing ? 'pause' : 'play') + '<span>' + (playing ? '暂停' : '播放') + '</span>';
      if (play._inner !== inner) {
        play.innerHTML = inner;
        play._inner = inner;
      }
      play.setAttribute('aria-label', label);
      play.title = label;
      play.classList.toggle('is-playing', playing);
      strip.querySelector('.cl-audio-now').textContent = clock(time);
      var part = this.book.parts[this._partAt(time) - 1];
      var seek = strip.querySelector('.cl-audio-seek');
      if (!this._seeking) seek.value = String(Math.round(time));
      seek.setAttribute('aria-valuetext', spokenClock(time) + (part ? '，' + partName(part) : ''));
      strip.style.setProperty('--cl-progress', ((time / duration) * 100).toFixed(3) + '%');
      var current = this._adjacent().current;
      var range = strip.querySelector('.cl-audio-range');
      if (current && current.audioStart !== undefined) {
        range.style.left = ((current.audioStart / duration) * 100).toFixed(3) + '%';
        range.style.width = (((current.audioEnd - current.audioStart) / duration) * 100).toFixed(3) + '%';
        range.hidden = false;
      } else range.hidden = true;
      var rate = strip.querySelector('.cl-audio-rate');
      if (rate.value !== String(this.state.rate)) rate.value = String(this.state.rate);
      var follow = strip.querySelector('.cl-audio-follow');
      follow.hidden = this._following || !playing;
      var error = strip.querySelector('.cl-audio-error');
      error.hidden = !this._audioError;
      error.textContent = this._audioError || '';
      strip.classList.toggle('has-error', !!this._audioError);
    },
  };

  app.ClassicsReader = ClassicsReader;
})(window);
