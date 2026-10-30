(function (root) {
  'use strict';

  var app = root.JPLearn || (root.JPLearn = {});

  app.installListEvents = function (ListView) {
    ListView.prototype._bindEvents = function () {
      var self = this;

      var emptyStateAction = this.container.querySelector('.list-empty-state [data-state-action]');
      if (emptyStateAction) {
        emptyStateAction.addEventListener('click', function () {
          var action = this.getAttribute('data-state-action');
          if (action === 'clear-list-favorites') {
            self.showFavOnly = false;
            self.currentPage = 1;
            self._buildDisplay();
            self.render();
          } else if (action === 'reset-vocab-filters' && window.filterManager && window.filterManager.reset) {
            window.filterManager.reset();
          }
        });
      }

      // 行点击 → 详情
      var rows = this.container.querySelectorAll('.list-row');
      for (var i = 0; i < rows.length; i++) {
        rows[i].addEventListener('click', function (e) {
          // 不拦截按钮和复选框点击
          if (
            e.target.closest('.btn-local-graph') ||
            e.target.closest('.list-fav-btn') ||
            e.target.closest('.row-check')
          )
            return;

          var idx = parseInt(this.getAttribute('data-word-index'));
          var wordObj = self._findWordByIndex(idx);
          if (wordObj && window.detailPanel) {
            if (window.VocabTTS)
              window.VocabTTS.playOne(idx, function (message) {
                var statusEl = document.getElementById('listReadStatus');
                if (statusEl) statusEl.textContent = message;
              });
            window.detailPanel.showNode({ type: 'word', rawData: wordObj }, this, {
              focus: e.detail === 0,
            });
          }
          // 高亮选中行
          var allRows = self.container.querySelectorAll('.list-row');
          for (var j = 0; j < allRows.length; j++) {
            allRows[j].classList.remove('selected');
          }
          this.classList.add('selected');
        });
        rows[i].addEventListener('keydown', function (e) {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          if (e.target.closest('button, input')) return;
          e.preventDefault();
          this.click();
        });
      }

      var favBtns = this.container.querySelectorAll('.list-fav-btn');
      for (var i = 0; i < favBtns.length; i++) {
        favBtns[i].addEventListener('click', function (e) {
          e.stopPropagation();
          var idx = parseInt(this.getAttribute('data-fav'));
          var status = window.StudyStorage.getWordStatus(idx);
          var result = status.isFavorite
            ? window.StudyStorage.unfavorite(idx)
            : window.StudyStorage.markWord(idx, 'favorite');
          if (result.status !== 'saved' && result.status !== 'alreadySaved') return;
          self._buildDisplay();
          self.render();
        });
      }

      var favToggle = document.getElementById('listFavToggle');
      if (favToggle) {
        favToggle.addEventListener('click', function () {
          self.showFavOnly = !self.showFavOnly;
          self.currentPage = 1;
          self._buildDisplay();
          self.render();
        });
      }

      var meaningToggle = document.getElementById('listMeaningToggle');
      if (meaningToggle) {
        meaningToggle.addEventListener('click', function () {
          self.hideMeanings = !self.hideMeanings;
          self.render();
        });
      }

      // 局部图按钮
      var localBtns = this.container.querySelectorAll('.btn-local-graph');
      for (var i = 0; i < localBtns.length; i++) {
        localBtns[i].addEventListener('click', function (e) {
          e.stopPropagation();
          var idx = parseInt(this.getAttribute('data-word-index'));
          var wordObj = self._findWordByIndex(idx);
          if (wordObj) {
            window.ViewMode.showLocal('word', wordObj);
            window.appConfig.applyFilters();
          }
        });
      }

      // 全选复选框
      var checkAll = document.getElementById('checkAll');
      if (checkAll) {
        checkAll.addEventListener('change', function () {
          var checked = this.checked;
          var checkboxes = self.container.querySelectorAll('.row-check');
          for (var i = 0; i < checkboxes.length; i++) {
            checkboxes[i].checked = checked;
            var idx = parseInt(checkboxes[i].getAttribute('data-index'));
            if (checked) {
              self.selectedIndices.add(idx);
            } else {
              self.selectedIndices.delete(idx);
            }
          }
          self._updateBatchBar();
        });
      }

      // 单行复选框
      var rowChecks = this.container.querySelectorAll('.row-check');
      for (var i = 0; i < rowChecks.length; i++) {
        rowChecks[i].addEventListener('change', function () {
          var idx = parseInt(this.getAttribute('data-index'));
          if (this.checked) {
            self.selectedIndices.add(idx);
          } else {
            self.selectedIndices.delete(idx);
          }
          self._updateBatchBar();
        });
      }

      // 批量加入学习队列
      var batchStudyBtn = document.getElementById('btnBatchStudy');
      if (batchStudyBtn) {
        batchStudyBtn.addEventListener('click', function () {
          if (self.selectedIndices.size === 0) return;
          var selectedWords = [];
          self.selectedIndices.forEach(function (idx) {
            var w = self._findWordByIndex(idx);
            if (w) selectedWords.push(w);
          });
          if (selectedWords.length > 0) {
            window.appConfig.startStudySession(selectedWords);
          }
        });
      }

      // 筛选结果生成学习队列
      var filterStudyBtn = document.getElementById('btnStudyFromFilter');
      if (filterStudyBtn) {
        filterStudyBtn.addEventListener('click', function () {
          window.ViewMode.set('study');
          window.appConfig.applyFilters();
        });
      }

      // 朗读当页
      var readPageBtn = document.getElementById('listReadPage');
      if (readPageBtn) {
        readPageBtn.addEventListener('click', function () {
          if (window.VocabTTS && window.VocabTTS.isPlaying) {
            window.VocabTTS.stop('已暂停朗读');
            self._updateReadPageButton(false);
            self.container.querySelectorAll('tr.tts-reading').forEach(function (el) {
              el.classList.remove('tts-reading');
            });
          } else if (window.VocabTTS) {
            var start = (self.currentPage - 1) * self.pageSize;
            var end = Math.min(start + self.pageSize, self.words.length);
            var pageWords = self.words.slice(start, end);
            if (pageWords.length > 0) {
              self._updateReadPageButton(true);
              window.VocabTTS.playLoop(pageWords, function (statusMsg, wordIndex) {
                var statusEl = document.getElementById('listReadStatus');
                if (statusEl) statusEl.textContent = statusMsg;
                // highlight active row
                self.container.querySelectorAll('tr.tts-reading').forEach(function (el) {
                  el.classList.remove('tts-reading');
                });
                if (wordIndex != null) {
                  var activeRow = self.container.querySelector('tr[data-word-index="' + wordIndex + '"]');
                  if (activeRow) activeRow.classList.add('tts-reading');
                }
                if (statusMsg === '朗读完毕' || statusMsg === '已暂停朗读' || statusMsg === '') {
                  self._updateReadPageButton(false);
                  self.container.querySelectorAll('tr.tts-reading').forEach(function (el) {
                    el.classList.remove('tts-reading');
                  });
                }
              });
            }
          }
        });
      }

      // 排序
      var sortSel = document.getElementById('listSortSelect');
      if (sortSel) {
        sortSel.addEventListener('change', function () {
          self.sortMode = this.value;
          self.currentPage = 1;
          self._buildDisplay();
          self.render();
        });
      }

      // 洗牌
      var reshuffleBtn = document.getElementById('listReshuffle');
      if (reshuffleBtn) {
        reshuffleBtn.addEventListener('click', function () {
          self.reshuffle();
        });
      }

      // 分页
      var prevBtn = document.getElementById('pagePrev');
      if (prevBtn) {
        prevBtn.addEventListener('click', function () {
          if (self.currentPage > 1) {
            self.currentPage--;
            self.render();
          }
        });
      }

      var nextBtn = document.getElementById('pageNext');
      if (nextBtn) {
        nextBtn.addEventListener('click', function () {
          if (self.currentPage < self.totalPages) {
            self.currentPage++;
            self.render();
          }
        });
      }

      var pageNums = this.container.querySelectorAll('.btn-page-num');
      for (var i = 0; i < pageNums.length; i++) {
        pageNums[i].addEventListener('click', function () {
          var p = parseInt(this.getAttribute('data-page'));
          if (p && p !== self.currentPage) {
            self.currentPage = p;
            self.render();
          }
        });
      }

      // 每页条数
      var pageSizeSel = document.getElementById('pageSizeSelect');
      if (pageSizeSel) {
        pageSizeSel.addEventListener('change', function () {
          self.setPageSize(parseInt(this.value));
          self.render();
        });
      }
    };
  };
})(window);
