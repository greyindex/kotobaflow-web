(function (root) {
  'use strict';

  var app = root.JPLearn || (root.JPLearn = {});

  app.installStudyEvents = function (StudyMode) {
    StudyMode.prototype._allowsStudyShortcut = function (event) {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.keyCode === 229 ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.shiftKey ||
        window.ViewMode.get() !== 'study' ||
        this.subView ||
        this.currentIndex >= this.queue.length ||
        (window.ModuleSwitcher && window.ModuleSwitcher.getCurrentModule() !== 'vocab') ||
        (app.topLayer && app.topLayer.getCurrent()) ||
        this.container.closest('[inert]')
      )
        return false;
      var target = event.target;
      if (
        target &&
        (target.isContentEditable || target.closest('input, textarea, select, [role="textbox"]'))
      ) {
        return target.id === 'practiceAnswerInput' && event.code === 'Enter';
      }
      // Let focused controls handle native activation without also advancing a card.
      return !(
        (event.code === 'Enter' || event.code === 'Space') &&
        target &&
        target.closest('button, a, [role="button"], [role="checkbox"], [role="radio"]')
      );
    };

    StudyMode.prototype._bindStudyExit = function () {
      var self = this;
      var button = this.container.querySelector('[data-study-exit]');
      if (button) {
        button.addEventListener('click', function (event) {
          if (event.detail > 1) return;
          self.leaveStudyToCatalog();
        });
      }
    };

    StudyMode.prototype._bindSetupEvents = function () {
      var self = this;

      // 学习数量按钮
      var countBtns = this.container.querySelectorAll('.study-count-btn');
      for (var i = 0; i < countBtns.length; i++) {
        countBtns[i].addEventListener('click', function () {
          var allBtns = self.container.querySelectorAll('.study-count-btn');
          for (var j = 0; j < allBtns.length; j++) allBtns[j].classList.remove('active');
          this.classList.add('active');
        });
      }

      var modeBtns = this.container.querySelectorAll('.study-mode-btn');
      for (var i = 0; i < modeBtns.length; i++) {
        modeBtns[i].addEventListener('click', function () {
          var allModeBtns = self.container.querySelectorAll('.study-mode-btn');
          for (var j = 0; j < allModeBtns.length; j++) {
            allModeBtns[j].classList.remove('active');
            allModeBtns[j].setAttribute('aria-checked', 'false');
          }
          this.classList.add('active');
          this.setAttribute('aria-checked', 'true');
        });
      }

      // 开始学习
      var startBtn = document.getElementById('btnStartStudy');
      if (startBtn) {
        startBtn.addEventListener('click', function () {
          var activeBtn = self.container.querySelector('.study-count-btn.active');
          var count = activeBtn ? parseInt(activeBtn.getAttribute('data-count')) : 30;
          var activeMode = self.container.querySelector('.study-mode-btn.active');
          var practiceMode = activeMode ? activeMode.getAttribute('data-practice-mode') : 'mixed';
          var filtered = window.appConfig.getCurrentWords();
          self.generateQueue(filtered, count, { practiceMode: practiceMode });
          self.render();
          self._updateStatusBar();
        });
      }

      // 复习入口
      var reviewBtns = this.container.querySelectorAll('.btn-review');
      for (var i = 0; i < reviewBtns.length; i++) {
        reviewBtns[i].addEventListener('click', function () {
          var status = this.getAttribute('data-review');
          self.subView = status === 'unknown' ? 'errorbook' : status === 'fuzzy' ? 'fuzzybook' : 'favorites';
          self.render();
        });
      }
    };

    StudyMode.prototype._bindExerciseEvents = function (wordObj, exercise) {
      var self = this;
      this._bindStudyExit();
      if (this._keyHandler) document.removeEventListener('keydown', this._keyHandler);

      var options = this.container.querySelectorAll('.practice-option');
      for (var i = 0; i < options.length; i++) {
        options[i].addEventListener('click', function () {
          self._handlePracticeAnswer(wordObj, exercise, Number(this.getAttribute('data-option-index')));
        });
      }

      var submitBtn = document.getElementById('btnPracticeSubmit');
      if (submitBtn) {
        submitBtn.addEventListener('click', function () {
          var input = document.getElementById('practiceAnswerInput');
          self._handlePracticeAnswer(wordObj, exercise, input ? input.value : '');
        });
      }

      var nextBtn = document.getElementById('btnPracticeNext');
      if (nextBtn) {
        nextBtn.addEventListener('click', function () {
          self._commitPracticeAnswer(wordObj, exercise);
        });
      }

      var actionBtns = this.container.querySelectorAll('[data-practice-action]');
      for (var i = 0; i < actionBtns.length; i++) {
        actionBtns[i].addEventListener('click', function () {
          var action = this.getAttribute('data-practice-action');
          if (action === 'favorite') {
            var result = window.StudyStorage.markWord(wordObj.index, 'favorite');
            if (result.status !== 'saved' && result.status !== 'alreadySaved') return;
            self.render();
          } else if (action === 'skip') {
            self._handleFeedback(wordObj, 'skip', {
              exerciseType: exercise.type,
              correct: null,
            });
          }
        });
      }

      var audioBtn = document.getElementById('btnPracticeAudio');
      var playPracticeAudio = function () {
        if (!window.VocabTTS) return;
        window.VocabTTS.playOne(wordObj.index, function (message) {
          if (self.currentExercise && self.currentExercise.id === exercise.id) {
            self.practiceNotice = message;
            self.render();
          }
        });
      };
      if (audioBtn) {
        audioBtn.addEventListener('click', function () {
          playPracticeAudio();
        });
      }
      var audioProbe = document.getElementById('practiceAudioProbe');
      if (audioProbe) {
        audioProbe.addEventListener('error', function () {
          if (self.currentExercise && self.currentExercise.id === exercise.id) {
            self._fallbackExercise('listening', '该词音频暂不可用，已自动切换为其他题型。');
          }
        });
      }

      this._keyHandler = function (event) {
        if (!self._allowsStudyShortcut(event)) return;
        if (!self.exerciseFeedback && exercise.options && event.code >= 'Digit1' && event.code <= 'Digit4') {
          event.preventDefault();
          self._handlePracticeAnswer(wordObj, exercise, Number(event.code.slice(-1)) - 1);
          return;
        }
        if (event.code === 'KeyR' && exercise.type === 'listening') {
          event.preventDefault();
          playPracticeAudio();
          return;
        }
        if (event.code === 'Enter') {
          event.preventDefault();
          if (self.exerciseFeedback) {
            self._commitPracticeAnswer(wordObj, exercise);
          } else if (!exercise.options) {
            var input = document.getElementById('practiceAnswerInput');
            self._handlePracticeAnswer(wordObj, exercise, input ? input.value : '');
          }
        }
      };
      document.addEventListener('keydown', this._keyHandler);

      var answerInput = document.getElementById('practiceAnswerInput');
      if (answerInput && !this.exerciseFeedback) answerInput.focus();
    };

    StudyMode.prototype._handlePracticeAnswer = function (wordObj, exercise, value) {
      if (this.feedbackLocked || this.exerciseFeedback || this.currentIndex >= this.queue.length) return;
      var correct = window.JPLearn.practice.isCorrect(exercise, value);
      this.exerciseFeedback = {
        correct: correct,
        selectedIndex: exercise.options ? Number(value) : -1,
        inputValue: exercise.options ? '' : String(value || ''),
      };
      this.render();
      this._queueCheckpointSave();
    };

    StudyMode.prototype._commitPracticeAnswer = function (wordObj, exercise) {
      if (!this.exerciseFeedback) return;
      this._handleFeedback(wordObj, this.exerciseFeedback.correct ? 'known' : 'unknown', {
        exerciseType: exercise.type,
        correct: this.exerciseFeedback.correct,
      });
    };

    // ─── 卡片渲染 ────────────────────────────────────────

    StudyMode.prototype._bindCardEvents = function (wordObj) {
      var self = this;
      this._bindStudyExit();

      // 翻转卡片
      var card = document.getElementById('flashcard');
      if (card) {
        var setFlippedState = function () {
          card.classList.toggle('flipped', self.isFlipped);
          card.setAttribute('aria-pressed', self.isFlipped ? 'true' : 'false');
        };
        card.addEventListener('click', function () {
          self.isFlipped = !self.isFlipped;
          setFlippedState();
          self._queueCheckpointSave();
        });
        card.addEventListener('keydown', function (event) {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          self.isFlipped = !self.isFlipped;
          setFlippedState();
          self._queueCheckpointSave();
        });
      }

      // 空格键翻转
      if (this._keyHandler) document.removeEventListener('keydown', this._keyHandler);
      this._keyHandler = function (e) {
        if (!self._allowsStudyShortcut(e)) return;
        if (
          e.code === 'Space' &&
          window.ViewMode.get() === 'study' &&
          e.target !== document.getElementById('flashcard')
        ) {
          e.preventDefault();
          self.isFlipped = !self.isFlipped;
          var c = document.getElementById('flashcard');
          if (c) {
            c.classList.toggle('flipped', self.isFlipped);
            c.setAttribute('aria-pressed', self.isFlipped ? 'true' : 'false');
          }
          self._queueCheckpointSave();
        }
        // 数字键 1-4 对应学习反馈；收藏是独立辅助操作。
        if (window.ViewMode.get() === 'study' && e.code >= 'Digit1' && e.code <= 'Digit4') {
          e.preventDefault();
          var map = {
            Digit1: 'known',
            Digit2: 'fuzzy',
            Digit3: 'unknown',
            Digit4: 'skip',
          };
          self._handleFeedback(wordObj, map[e.code]);
        }
      };
      document.addEventListener('keydown', this._keyHandler);

      // 反馈按钮
      var fbBtns = this.container.querySelectorAll('.fb-btn');
      for (var i = 0; i < fbBtns.length; i++) {
        fbBtns[i].addEventListener('click', function (event) {
          if (event.detail > 1) return;
          var fb = this.getAttribute('data-fb');
          self._handleFeedback(wordObj, fb);
        });
      }

      var favoriteBtn = this.container.querySelector('.study-favorite-action');
      if (favoriteBtn) {
        favoriteBtn.addEventListener('click', function () {
          self._handleFeedback(wordObj, 'favorite');
        });
      }

      // 图谱联动
      var navBtns = this.container.querySelectorAll('.btn-study-nav[data-nav]');
      for (var i = 0; i < navBtns.length; i++) {
        navBtns[i].addEventListener('click', function () {
          var nav = this.getAttribute('data-nav');
          var code = this.getAttribute('data-code');

          if (nav === 'local') {
            window.ViewMode.showLocal('word', wordObj);
            window.appConfig.applyFilters();
          } else if (nav === 'domain' && code) {
            window.ViewMode.showLocal('domain', { code: code });
            window.appConfig.applyFilters();
          } else if (nav === 'semantic' && code) {
            window.ViewMode.showLocal('semantic', { code: code });
            window.appConfig.applyFilters();
          }
        });
      }
    };

    StudyMode.prototype._handleFeedback = function (wordObj, fb, resultMeta) {
      if (fb === 'favorite') {
        var favoriteResult = window.StudyStorage.markWord(wordObj.index, fb);
        if (favoriteResult.status !== 'saved' && favoriteResult.status !== 'alreadySaved') return;
        var favBtn = this.container.querySelector('.fb-fav');
        if (favBtn) {
          favBtn.innerHTML = uiIcon('star') + '已收藏';
          favBtn.setAttribute('aria-pressed', 'true');
        }
        return;
      }
      if (
        this.feedbackLocked ||
        this.currentIndex >= this.queue.length ||
        this.queue[this.currentIndex].index !== wordObj.index ||
        (fb !== 'known' && fb !== 'fuzzy' && fb !== 'unknown' && fb !== 'skip')
      ) {
        return;
      }
      this.feedbackLocked = true;

      // Prepare the whole next checkpoint, then advance only after durable confirmation.
      var next = this.exportCheckpoint();
      next.sessionResults.push({
        index: wordObj.index,
        word: wordObj.word || '',
        reading: this._getDisplayReading(wordObj),
        meaning: wordObj.meaning || '',
        feedback: fb,
        initialStatus: this.sessionInitialStatuses[wordObj.index] || 'none',
        exerciseType: resultMeta && resultMeta.exerciseType ? resultMeta.exerciseType : 'classic',
        correct: resultMeta && typeof resultMeta.correct === 'boolean' ? resultMeta.correct : null,
      });

      if (resultMeta && resultMeta.exerciseType) {
        var exerciseStat = next.exerciseStats[resultMeta.exerciseType] || {
          total: 0,
          correct: 0,
          incorrect: 0,
          skipped: 0,
        };
        exerciseStat.total++;
        if (resultMeta.correct === true) exerciseStat.correct++;
        else if (resultMeta.correct === false) exerciseStat.incorrect++;
        else exerciseStat.skipped++;
        next.exerciseStats[resultMeta.exerciseType] = exerciseStat;
      }

      next.currentIndex++;
      next.isFlipped = false;
      next.currentExerciseType = '';
      next.currentExercise = null;
      next.exerciseFeedback = null;
      next.practiceNotice = '';
      if (next.currentIndex >= this.queue.length) next.sessionCompletedAt = Date.now();
      if (!this._resolveCheckpointQueue(next)) {
        this.feedbackLocked = false;
        this.saveError = '学习队列无法恢复，本题尚未提交。请返回列表重新开始学习。';
        this.render();
        return;
      }
      var committed = window.StudyStorage.markWord(wordObj.index, fb, {
        id: this.sessionId + ':' + this.currentIndex,
        checkpoint: next,
      });
      if (committed.status !== 'saved' && committed.status !== 'alreadySaved') {
        this.feedbackLocked = false;
        this._pendingFeedback = { word: wordObj, feedback: fb, meta: resultMeta };
        this.saveError = '本题保存未确认，尚未推进。请重试；恢复前请勿关闭页面。';
        this.render();
        return;
      }
      var trail = this.resultTrail;
      this.restoreCheckpoint(next, { render: false });
      this.resultTrail = trail;
      this.feedbackLocked = true;
      this._pendingFeedback = null;
      this.saveError = '';
      window.StudyStorage._notifyChanged();
      this._updateStatusBar();
      this.render();
      this._queueCheckpointSave();
      if (this.currentIndex < this.queue.length) {
        var self = this;
        setTimeout(function () {
          self.feedbackLocked = false;
        }, 0);
      }
    };

    // ─── 学习完成 ────────────────────────────────────────
  };
})(window);
