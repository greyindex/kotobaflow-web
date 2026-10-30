// 古典 module (CLASSICS-01, local only). ModuleSwitcher creates it on the first
// visit; the rail button exists only when data/classics_v1/catalog.json loads.
// The drawer lists the works and, under them, the open work's reading tools
// and directory from js/classics/reader.js, which draws the work in #clReader.
(function (window) {
  'use strict';

  var app = window.JPLearn || (window.JPLearn = {});

  function esc(value) {
    return app.html.escape(value);
  }

  function icon(name) {
    return typeof window.uiIcon === 'function' ? window.uiIcon(name) : '';
  }

  function count(value) {
    return Number(value || 0).toLocaleString('zh-CN');
  }

  function ClassicsModule(options) {
    var self = this;
    this.sidebarEl = document.getElementById(options.sidebarContentId);
    this.readerEl = document.getElementById(options.readerId);
    this.loadingEl = document.getElementById(options.loadingId);
    this.badgeEl = document.getElementById(options.badgeId);
    this.catalog = null;
    this._started = null;
    this.reader = new app.ClassicsReader({
      readerEl: this.readerEl,
      sidebarEl: this.sidebarEl,
      renderSidebar: function () {
        self.renderSidebar();
      },
      showLoading: function (text) {
        self._loading(true, text);
      },
      hideLoading: function () {
        self._loading(false);
      },
      setStatus: function (state) {
        if (window.ModuleSwitcher && window.ModuleSwitcher.setClassicsStatus)
          window.ModuleSwitcher.setClassicsStatus(state);
      },
    });
    this.sidebarEl.addEventListener('click', function (event) {
      self._onSidebarClick(event);
    });
  }

  ClassicsModule.prototype = {
    activate: function () {
      this.reader.activate();
      if (!this._started) this._started = this._start();
      return this._started;
    },

    deactivate: function () {
      this.reader.deactivate();
    },

    // First visit: the catalog, then the work opened last (or the first one).
    _start: function () {
      var self = this;
      // The rail button only exists once this same catalog has loaded.
      return app.classics.getCatalog().then(function (catalog) {
        if (!catalog) return false;
        self.catalog = catalog;
        if (self.badgeEl) self.badgeEl.textContent = catalog.books.length + ' 部';
        var book = self._book(self.reader.lastBookId()) || catalog.books[0];
        self.renderSidebar();
        return self.openWork(book.id);
      });
    },

    openWork: function (id) {
      if (!this._book(id)) return Promise.resolve(false);
      this._markWork(id);
      return this.reader.open(id);
    },

    _book: function (id) {
      var books = this.catalog ? this.catalog.books : [];
      for (var i = 0; i < books.length; i++) if (books[i].id === id) return books[i];
      return null;
    },

    // Rebuilds the drawer when the open work changes; focus inside it moves to
    // the matching work button.
    renderSidebar: function () {
      if (!this.catalog) return;
      var focused = document.activeElement;
      var hadFocus = !!(focused && focused !== this.sidebarEl && this.sidebarEl.contains(focused));
      var work = hadFocus ? focused.getAttribute('data-cl-work') || this.reader.currentBookId() : '';
      this.sidebarEl.innerHTML = this._worksHtml() + this.reader.sidebarHtml();
      var target = work && this.sidebarEl.querySelector('[data-cl-work="' + work + '"]');
      if (target) target.focus({ preventScroll: true });
    },

    _worksHtml: function () {
      var reader = this.reader;
      var current = reader.currentBookId();
      return (
        '<div class="cl-works" role="group" aria-label="作品">' +
        this.catalog.books
          .map(function (book) {
            var active = book.id === current;
            var place = active ? null : reader.placeOf(book.id);
            var meta =
              book.parts +
              ' ' +
              book.noun +
              ' · ' +
              (place
                ? '读到第 ' + Math.min(place.part, book.parts) + ' ' + book.noun
                : count(book.units) + ' 段');
            return (
              '<button type="button" class="cl-work' +
              (active ? ' active' : '') +
              '" data-cl-work="' +
              esc(book.id) +
              '"' +
              (active ? ' aria-current="page"' : '') +
              '><span class="cl-work-head"><span class="cl-work-title">' +
              esc(book.title) +
              '</span>' +
              (book.audio ? '<span class="cl-work-audio">' + icon('volume') + '朗读</span>' : '') +
              '</span><span class="cl-work-meta">' +
              esc(meta) +
              '</span></button>'
            );
          })
          .join('') +
        '</div>'
      );
    },

    // Marks the chosen work at once; the drawer is rebuilt when it has loaded.
    _markWork: function (id) {
      this.sidebarEl.querySelectorAll('[data-cl-work]').forEach(function (button) {
        var current = button.getAttribute('data-cl-work') === id;
        button.classList.toggle('active', current);
        if (current) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
      });
    },

    _onSidebarClick: function (event) {
      var target = event.target && event.target.closest ? event.target : null;
      if (!target) return;
      var work = target.closest('[data-cl-work]');
      if (work) {
        this.openWork(work.getAttribute('data-cl-work'));
        return;
      }
      this.reader.handleSidebarClick(event);
    },

    _loading: function (on, text) {
      var el = this.loadingEl;
      if (!el) return;
      if (on && window.StateView)
        window.StateView.mount(el, { kind: 'loading', title: '正在加载古典', message: (text || '') + '…' });
      el.classList.toggle('hidden', !on);
      el.setAttribute('aria-busy', on ? 'true' : 'false');
    },
  };

  app.ClassicsModule = ClassicsModule;
})(window);
