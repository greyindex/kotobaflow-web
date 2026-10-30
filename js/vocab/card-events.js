(function (root) {
  'use strict';

  var app = root.JPLearn || (root.JPLearn = {});

  app.installCardEvents = function (CardMode) {
    CardMode.prototype._bindEvents = function () {
      var self = this;

      var emptyStateAction = this.container.querySelector('.cc-empty-state [data-state-action]');
      if (emptyStateAction) {
        emptyStateAction.addEventListener('click', function () {
          var action = this.getAttribute('data-state-action');
          if (action === 'clear-favorites') {
            self.showFavOnly = false;
            self.currentPage = 1;
            self.render();
          } else if (action === 'reset-vocab-filters' && window.filterManager && window.filterManager.reset) {
            window.filterManager.reset();
          }
        });
      }

      // ── 等级切换 ──
      var tabs = this.container.querySelectorAll('.cc-tab[data-level]');
      for (var i = 0; i < tabs.length; i++) {
        tabs[i].addEventListener('click', function () {
          self.activeLevel = this.getAttribute('data-level');
          self.currentPage = 1;
          self._shuffleCache = null;
          self.render();
        });
      }

      // ── 收藏筛选 ──
      var favTab = document.querySelector('#vocabViewTools .cc-tab-fav');
      if (favTab) {
        favTab.addEventListener('click', function () {
          self.showFavOnly = !self.showFavOnly;
          self.currentPage = 1;
          self.render();
        });
      }

      var meaningToggle = document.getElementById('ccMeaningToggle');
      if (meaningToggle) {
        var prepareMeaningAnchor = function () {
          if (!self._pendingMeaningAnchor) {
            self._pendingMeaningAnchor = self._captureScrollAnchor();
          }
        };
        meaningToggle.addEventListener('pointerdown', prepareMeaningAnchor);
        meaningToggle.addEventListener('mousedown', prepareMeaningAnchor);
        meaningToggle.addEventListener('touchstart', prepareMeaningAnchor, { passive: true });
        meaningToggle.addEventListener('click', function () {
          self._toggleMeaningsWithAnchor(self._pendingMeaningAnchor);
          self._pendingMeaningAnchor = null;
        });
      }

      // ── 排序 ──
      var sortSel = document.getElementById('ccSortSelect');
      if (sortSel) {
        sortSel.addEventListener('change', function () {
          self.sortMode = this.value;
          self.currentPage = 1;
          self._shuffleCache = null;
          self.render();
        });
      }

      // ── 每页数 ──
      var ppSel = document.getElementById('ccPerPageSelect');
      if (ppSel) {
        ppSel.addEventListener('change', function () {
          self.perPage = parseInt(this.value);
          self.currentPage = 1;
          self.render();
        });
      }

      // ── 重新洗牌 ──
      var reshuffleBtn = document.getElementById('ccReshuffle');
      if (reshuffleBtn) {
        reshuffleBtn.addEventListener('click', function () {
          self.reshuffle();
        });
      }

      // ── 朗读当页 ──
      var startStudyBtn = document.getElementById('ccStartStudy');
      if (startStudyBtn) {
        startStudyBtn.addEventListener('click', function () {
          self.startStudyFromDisplay();
        });
      }

      var readPageBtn = document.getElementById('ccReadPage');
      if (readPageBtn) {
        readPageBtn.addEventListener('click', function () {
          if (window.VocabTTS && window.VocabTTS.isPlaying) {
            window.VocabTTS.stop('已暂停朗读');
            self._updateReadPageButton(false);
          } else if (window.VocabTTS) {
            var start = (self.currentPage - 1) * self.perPage;
            var end = Math.min(start + self.perPage, self.displayWords.length);
            var pageWords = self.displayWords.slice(start, end);
            if (pageWords.length > 0) {
              self._updateReadPageButton(true);
              window.VocabTTS.playLoop(pageWords, function (statusMsg, wordIndex) {
                var statusEl = document.getElementById('ccReadStatus');
                if (statusEl) statusEl.textContent = statusMsg;
                // highlight active card
                self.container.querySelectorAll('.cc-card.tts-reading').forEach(function (el) {
                  el.classList.remove('tts-reading');
                });
                if (wordIndex != null) {
                  var activeCard = self.container.querySelector('.cc-card[data-index="' + wordIndex + '"]');
                  if (activeCard) activeCard.classList.add('tts-reading');
                  self._revealBookCard(activeCard);
                }
                if (statusMsg === '朗读完毕' || statusMsg === '已暂停朗读' || statusMsg === '') {
                  self._updateReadPageButton(false);
                  self.container.querySelectorAll('.cc-card.tts-reading').forEach(function (el) {
                    el.classList.remove('tts-reading');
                  });
                }
              });
            }
          }
        });
      }

      // ── 批量操作菜单 ──
      var batchToggle = document.getElementById('ccBatchToggle');
      if (batchToggle) {
        batchToggle.addEventListener('click', function (e) {
          e.stopPropagation();
          self._batchMenuOpen = !self._batchMenuOpen;
          if (self._batchMenuOpen) closeCardMenus();
          var menu = document.getElementById('ccBatchMenu');
          if (menu) menu.classList.toggle('open', self._batchMenuOpen);
          this.setAttribute('aria-expanded', self._batchMenuOpen ? 'true' : 'false');
          if (menu) menu.setAttribute('aria-hidden', self._batchMenuOpen ? 'false' : 'true');
          if (self._batchMenuOpen && menu) {
            var firstItem = menu.querySelector('[role="menuitem"]');
            if (firstItem) firstItem.focus();
          }
        });
      }

      function closeCardMenus() {
        self.container.querySelectorAll('.cc-card-menu.open').forEach(function (menu) {
          menu.classList.remove('open');
          menu.setAttribute('aria-hidden', 'true');
        });
        self.container
          .querySelectorAll('.cc-card-menu-toggle[aria-expanded="true"]')
          .forEach(function (button) {
            button.setAttribute('aria-expanded', 'false');
          });
        self._openCardMenuToggle = null;
      }

      var cardMenuToggles = this.container.querySelectorAll('.cc-card-menu-toggle');
      for (var i = 0; i < cardMenuToggles.length; i++) {
        cardMenuToggles[i].addEventListener('click', function (e) {
          e.stopPropagation();
          var index = this.getAttribute('data-card-menu');
          var menu = self.container.querySelector('[data-card-menu-panel="' + index + '"]');
          var opening = menu && !menu.classList.contains('open');
          closeCardMenus();
          if (menu && opening) {
            menu.classList.add('open');
            menu.setAttribute('aria-hidden', 'false');
            this.setAttribute('aria-expanded', 'true');
            self._openCardMenuToggle = this;
            var firstItem = menu.querySelector('[role="menuitem"]');
            if (firstItem) firstItem.focus();
          }
        });
      }

      // 点击其他地方关闭菜单
      this.container.addEventListener('click', function (e) {
        if (!e.target.closest('.cc-batch-wrap')) {
          self._batchMenuOpen = false;
          var menu = document.getElementById('ccBatchMenu');
          if (menu) menu.classList.remove('open');
          var batchToggle = document.getElementById('ccBatchToggle');
          if (batchToggle) batchToggle.setAttribute('aria-expanded', 'false');
          if (menu) menu.setAttribute('aria-hidden', 'true');
        }
        if (!e.target.closest('.cc-card-menu-wrap')) closeCardMenus();
      });

      if (this._cardMenuKeyHandler) document.removeEventListener('keydown', this._cardMenuKeyHandler);
      this._cardMenuKeyHandler = function (e) {
        if (e.key === 'Escape') {
          var opener = self._openCardMenuToggle;
          closeCardMenus();
          var batchMenu = document.getElementById('ccBatchMenu');
          var batchToggle = document.getElementById('ccBatchToggle');
          if (batchMenu && batchMenu.classList.contains('open')) {
            batchMenu.classList.remove('open');
            batchMenu.setAttribute('aria-hidden', 'true');
            self._batchMenuOpen = false;
            if (batchToggle) {
              batchToggle.setAttribute('aria-expanded', 'false');
              batchToggle.focus();
            }
          } else if (opener && opener.isConnected) opener.focus();
        }
      };
      document.addEventListener('keydown', this._cardMenuKeyHandler);

      // ── 批量操作 ──
      var batchItems = document.querySelectorAll('#vocabViewTools .cc-batch-item');
      for (var i = 0; i < batchItems.length; i++) {
        batchItems[i].addEventListener('click', function () {
          var action = this.getAttribute('data-batch');
          self._handleBatch(action);
        });
      }

      // ── 收藏按钮 ──
      var favBtns = this.container.querySelectorAll('.cc-fav');
      for (var i = 0; i < favBtns.length; i++) {
        favBtns[i].addEventListener('click', function (e) {
          e.stopPropagation();
          var idx = parseInt(this.getAttribute('data-fav'));
          self._toggleFavorite(idx);
        });
      }

      // ── 卡片操作按钮 ──
      var actBtns = this.container.querySelectorAll('[data-act][data-idx]');
      for (var i = 0; i < actBtns.length; i++) {
        actBtns[i].addEventListener('click', function (e) {
          e.stopPropagation();
          var action = this.getAttribute('data-act');
          var idx = parseInt(this.getAttribute('data-idx'));
          self._handleCardAction(action, idx, this.closest('.cc-card') || this, e.detail === 0);
        });
      }

      // ── 卡片主体点击 → 详情面板 ──
      var bodies = this.container.querySelectorAll('.cc-card-body[data-detail]');
      for (var i = 0; i < bodies.length; i++) {
        bodies[i].addEventListener('click', function (event) {
          var idx = parseInt(this.getAttribute('data-detail'));
          self._showDetail(idx, this, event.detail === 0);
        });
        bodies[i].addEventListener('keydown', function (e) {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          self._showDetail(parseInt(this.getAttribute('data-detail')), this, true);
        });
      }

      // ── 分页 ──
      var pageBtns = this.container.querySelectorAll('[data-page]');
      for (var i = 0; i < pageBtns.length; i++) {
        pageBtns[i].addEventListener('click', function () {
          var p = parseInt(this.getAttribute('data-page'));
          if (p >= 1) {
            self.currentPage = p;
            self.render();
            self._scrollToTop();
          }
        });
      }

      // ── 页码跳转 ──
      var jumpInput = document.getElementById('ccPageJump');
      if (jumpInput) {
        jumpInput.addEventListener('keypress', function (e) {
          if (e.key === 'Enter') {
            var p = parseInt(this.value);
            var totalPages = Math.ceil(self.displayWords.length / self.perPage) || 1;
            if (p >= 1 && p <= totalPages) {
              self.currentPage = p;
              self.render();
              self._scrollToTop();
            }
          }
        });
      }
    };

    /* ═══════════════════════════════════════════════════════════
       操作处理
       ═══════════════════════════════════════════════════════════ */

    CardMode.prototype._toggleFavorite = function (index) {
      var st = window.StudyStorage.getWordStatus(index);
      var result = st.isFavorite
        ? window.StudyStorage.unfavorite(index)
        : window.StudyStorage.markWord(index, 'favorite');
      if (result.status !== 'saved' && result.status !== 'alreadySaved') return;
      this.render();
    };

    CardMode.prototype._handleCardAction = function (action, index, anchor, focusPopup) {
      var self = this;
      var w = this._findWord(index);
      if (!w) return;

      switch (action) {
        case 'study-word':
          window.appConfig.startStudySession([w], { practiceMode: 'mixed' });
          break;
        case 'read-one':
          if (window.VocabTTS)
            window.VocabTTS.playOne(index, function (message) {
              var statusEl = document.getElementById('ccReadStatus');
              if (statusEl) statusEl.textContent = message;
            });
          break;
        case 'expand':
          this.expandedCards[index] = !this.expandedCards[index];
          this.render();
          var expandedToggle = this.container.querySelector(
            '.cc-card[data-index="' + index + '"] .cc-meta-count',
          );
          if (expandedToggle) expandedToggle.focus({ preventScroll: true });
          break;
        case 'detail':
          this._showDetail(index, anchor, focusPopup);
          break;
        case 'local':
          window.ViewMode.showLocal('word', w);
          window.appConfig.applyFilters();
          break;
        case 'read-from':
          if (window.VocabTTS) {
            var startIdx = (this.currentPage - 1) * this.perPage;
            var endIdx = Math.min(startIdx + this.perPage, this.displayWords.length);
            var pageWords = this.displayWords.slice(startIdx, endIdx);

            var startIndexInPage = 0;
            for (var i = 0; i < pageWords.length; i++) {
              if (pageWords[i].index === index) {
                startIndexInPage = i;
                break;
              }
            }
            var wordsToRead = pageWords.slice(startIndexInPage);

            self._updateReadPageButton(true);

            window.VocabTTS.playLoop(wordsToRead, function (statusMsg, wordIndex) {
              var statusEl = document.getElementById('ccReadStatus');
              if (statusEl) statusEl.textContent = statusMsg;
              // highlight active card
              self.container.querySelectorAll('.cc-card.tts-reading').forEach(function (el) {
                el.classList.remove('tts-reading');
              });
              if (wordIndex != null) {
                var activeCard = self.container.querySelector('.cc-card[data-index="' + wordIndex + '"]');
                if (activeCard) activeCard.classList.add('tts-reading');
                self._revealBookCard(activeCard);
              }
              if (statusMsg === '朗读完毕' || statusMsg === '已暂停朗读' || statusMsg === '') {
                self._updateReadPageButton(false);
                self.container.querySelectorAll('.cc-card.tts-reading').forEach(function (el) {
                  el.classList.remove('tts-reading');
                });
              }
            });
          }
          break;
      }
    };

    CardMode.prototype._showDetail = function (index, anchor, focusPopup) {
      var w = this._findWord(index);
      if (w && window.detailPanel) {
        window.detailPanel.showNode({ type: 'word', rawData: w }, anchor, { focus: !!focusPopup });
      }
    };

    CardMode.prototype._handleBatch = function (action) {
      var wasBatchMenuOpen = this._batchMenuOpen;
      this._batchMenuOpen = false;
      var startIdx = (this.currentPage - 1) * this.perPage;
      var endIdx = Math.min(startIdx + this.perPage, this.displayWords.length);
      var pageWords = this.displayWords.slice(startIdx, endIdx);

      switch (action) {
        case 'fav-page':
        case 'unfav-page':
          var savedAny = false;
          for (var i = 0; i < pageWords.length; i++) {
            var result =
              action === 'fav-page'
                ? window.StudyStorage.markWord(pageWords[i].index, 'favorite')
                : window.StudyStorage.unfavorite(pageWords[i].index);
            if (result.status !== 'saved' && result.status !== 'alreadySaved') break;
            savedAny = true;
          }
          if (savedAny) this.render();
          else this._batchMenuOpen = wasBatchMenuOpen;
          break;

        case 'study-page':
          if (pageWords.length > 0) {
            window.appConfig.startStudySession(pageWords, { practiceMode: 'mixed' });
          }
          break;

        case 'study-all':
          if (this.displayWords.length > 0) {
            var count = Math.min(this.displayWords.length, 100);
            window.appConfig.startStudySession(this.displayWords, {
              shuffle: true,
              limit: count,
              practiceMode: 'mixed',
            });
          }
          break;
      }
    };

    /* ═══════════════════════════════════════════════════════════
       工具方法
       ═══════════════════════════════════════════════════════════ */
  };
})(window);
