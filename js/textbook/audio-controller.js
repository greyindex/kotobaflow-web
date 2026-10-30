(function (root) {
  'use strict';

  var app = root.JPLearn || (root.JPLearn = {});
  var AUDIO_FAILURE = '音频暂不可用，点击播放按钮重试';

  app.textbookAudioMethods = Object.freeze({
    _getDialogueIntervals: function (timing) {
      if (!timing || !Array.isArray(timing.turns)) throw new Error('会话时间数据缺失');
      var absolute = timing.mode === 'absolute';
      var gap = absolute ? 0 : Number(timing.gap);
      if (!Number.isFinite(gap) || gap < 0) throw new Error('会话间隔无效');
      var cursor = 0;
      var previousEnd = 0;
      var intervals = [];
      timing.turns.forEach(function (turn, index) {
        if (absolute && turn && (turn.status === 'unaligned' || turn.status === 'not_spoken')) return;
        if (!turn) throw new Error('会话时间数据缺失');
        var start = absolute ? Number(turn.start_sec) : cursor;
        var end = absolute ? Number(turn.end_sec) : start + Number(turn.duration_sec);
        if (
          (absolute && (turn.start_sec == null || turn.end_sec == null)) ||
          !Number.isFinite(start) ||
          !Number.isFinite(end) ||
          start < previousEnd ||
          end <= start ||
          (absolute && (!Number.isFinite(timing.duration_sec) || end > timing.duration_sec + 0.02))
        )
          throw new Error('会话时间区间无效');
        intervals.push({ start: start, end: end, index: index, gap: gap });
        previousEnd = end;
        cursor = end + gap;
      });
      return intervals;
    },

    // Section modes repeat across lessons; late callbacks must belong to this playback.
    _getTtsRequestGuard: function (mode) {
      var self = this;
      var requestId = this._ttsRequestId;
      var bookId = this.currentBookId;
      var lessonId = this.currentLessonId;
      return function (audio) {
        return (
          self._ttsRequestId === requestId &&
          self.currentBookId === bookId &&
          self.currentLessonId === lessonId &&
          self.ttsState.mode === mode &&
          (!audio || self.ttsState.audio === audio)
        );
      };
    },

    _handleTtsButtonClick: function (mode) {
      if (!mode) return;
      if (
        (this.ttsState.loading || (this.ttsState.audio && !this.ttsState.audio.paused)) &&
        this.ttsState.mode === mode
      ) {
        this._stopTtsPlayback();
        return;
      }
      if (mode.indexOf('reading:') === 0) this._playReadingSectionAudio(mode);
      else if (mode.indexOf('dialogue:') === 0) this._playDialogueSectionAudio(mode);
      else if (mode === 'vocab-loop') this._playVocabLoop();
      else if (mode.indexOf('vocab-loop-from:') === 0)
        this._playVocabLoop(parseInt(String(mode).split(':')[1], 10));
      else if (mode.indexOf('vocab:') === 0) this._playVocabAudio(mode);
    },

    _playReadingSectionAudio: function (mode) {
      var self = this;
      var sectionKey = String(mode || '').split(':')[1] || '';
      var lesson = this.currentLesson && this.currentLesson.lesson;
      var section = lesson && lesson[sectionKey];
      var sectionTitle =
        this._cleanValue(section && section.title) || (sectionKey === 'application' ? '应用文' : '本文');
      if (!lesson || !sectionKey) return;

      this._stopTtsPlayback();
      this.ttsState.mode = mode;
      var isCurrent = this._getTtsRequestGuard(mode);
      var audio = null;
      this.ttsState.loading = true;
      this.ttsState.segments = this._getRenderedTtsSegments(mode);
      this.ttsState.segmentIndex = 0;
      this.ttsState.statusText = '正在加载预生成朗读...';
      this._syncTtsButtonState();

      Promise.all([
        TextbookLoader.getReadingAudioUrl(this.currentBookId, this.currentLessonId, sectionKey),
        TextbookLoader.getReadingAudioEntry(this.currentBookId, this.currentLessonId, sectionKey),
      ])
        .then(function (results) {
          if (!isCurrent()) return;
          var url = results[0];
          if (!url) throw new Error('未找到该部分的预生成朗读音频');
          self.ttsState.reviewNotice =
            results[1] && results[1].source_revision_mismatch ? '音频与修订文字待核对' : '';

          audio = new Audio(url);
          audio.preload = 'auto';
          self.ttsState.audio = audio;

          audio.addEventListener('playing', function () {
            if (!isCurrent(audio)) return;
            self.ttsState.loading = false;
            self._updateTtsTimedStatus(mode, sectionTitle, audio, -1, self.ttsState.segments.length);
          });
          audio.addEventListener('timeupdate', function () {
            if (!isCurrent(audio)) return;
            self._updateTtsTimedStatus(mode, sectionTitle, audio, -1, self.ttsState.segments.length);
          });
          audio.addEventListener('ended', function () {
            if (isCurrent(audio)) self._stopTtsPlayback(sectionTitle + '朗读完成');
          });
          audio.addEventListener('error', function () {
            if (isCurrent(audio)) self._stopTtsPlayback(AUDIO_FAILURE);
          });

          self._syncTtsButtonState();
          return audio.play();
        })
        .catch(function (err) {
          if (!isCurrent(audio)) return;
          self._stopTtsPlayback(AUDIO_FAILURE);
          console.error('[TextbookTTS] Reading section playback failed:', err);
        });
    },

    _playDialogueSectionAudio: function (mode) {
      var self = this;
      var sectionKey = String(mode || '').split(':')[1] || '';
      var lesson = this.currentLesson && this.currentLesson.lesson;
      var section = lesson && lesson[sectionKey];
      var sectionTitle = this._cleanValue(section && section.title) || '会话';
      if (!lesson || !sectionKey) return;

      this._stopTtsPlayback();
      this.ttsState.mode = mode;
      var isCurrent = this._getTtsRequestGuard(mode);
      var audio = null;
      var bookId = this.currentBookId;
      var lessonId = this.currentLessonId;
      this.ttsState.loading = true;
      this.ttsState.statusText = '正在加载预生成会话音频...';
      this._syncTtsButtonState();

      TextbookLoader.getDialogueAudioUrl(bookId, lessonId, sectionKey)
        .then(function (url) {
          if (!isCurrent()) return;
          if (!url) throw new Error('未找到该会话的预生成音频');

          return TextbookLoader.getDialogueTiming(bookId, lessonId, sectionKey).then(function (timing) {
            if (!isCurrent()) return;

            var turnTimes = self._getDialogueIntervals(timing);
            self.ttsState.reviewNotice = timing.source_revision_mismatch ? '音频与修订文字待核对' : '';
            audio = new Audio(url);
            audio.preload = 'auto';
            self.ttsState.audio = audio;

            audio.addEventListener('playing', function () {
              if (!isCurrent(audio)) return;
              self.ttsState.loading = false;
              var initial = turnTimes.find(function (turn) {
                return audio.currentTime >= turn.start && audio.currentTime < turn.end + turn.gap;
              });
              self._updateTtsTimedStatus(
                mode,
                sectionTitle,
                audio,
                initial ? initial.index : null,
                timing.turns.length,
              );
            });

            audio.addEventListener('timeupdate', function () {
              if (!isCurrent(audio)) return;
              var currentSec = audio.currentTime;
              var activeIndex = null;
              for (var i = 0; i < turnTimes.length; i++) {
                if (currentSec >= turnTimes[i].start && currentSec < turnTimes[i].end + turnTimes[i].gap) {
                  activeIndex = turnTimes[i].index;
                  break;
                }
              }
              self._updateTtsTimedStatus(mode, sectionTitle, audio, activeIndex, timing.turns.length);
              var domTurns = self.readerEl.querySelectorAll(
                'section[data-tts-mode="' + mode + '"] .tb-dialogue-turn',
              );
              domTurns.forEach(function (el, idx) {
                if (idx === activeIndex) el.classList.add('tts-reading');
                else el.classList.remove('tts-reading');
              });
            });

            audio.addEventListener('ended', function () {
              if (isCurrent(audio)) {
                var domTurns = self.readerEl.querySelectorAll(
                  'section[data-tts-mode="' + mode + '"] .tb-dialogue-turn',
                );
                domTurns.forEach(function (el) {
                  el.classList.remove('tts-reading');
                });
                self._stopTtsPlayback(sectionTitle + '朗读完成');
              }
            });

            audio.addEventListener('error', function () {
              if (isCurrent(audio)) self._stopTtsPlayback(AUDIO_FAILURE);
            });

            self._syncTtsButtonState();
            return audio.play();
          });
        })
        .catch(function (err) {
          if (!isCurrent(audio)) return;
          self._stopTtsPlayback(AUDIO_FAILURE);
          console.error('[TextbookTTS] Dialogue section playback failed:', err);
        });
    },

    _playSingleDialogueTurn: function (mode, turnIdx) {
      var self = this;
      var sectionKey = String(mode || '').split(':')[1] || '';

      this._stopTtsPlayback();
      var singleMode = mode + ':single:' + turnIdx;
      this.ttsState.mode = singleMode;
      var isCurrentRequest = this._getTtsRequestGuard(singleMode);
      var audio = null;
      function isCurrent() {
        return isCurrentRequest(audio);
      }
      this.ttsState.loading = true;
      this.ttsState.statusText = '准备朗读单句...';
      this._syncTtsButtonState();

      Promise.all([
        TextbookLoader.getDialogueAudioUrl(this.currentBookId, this.currentLessonId, sectionKey),
        TextbookLoader.getDialogueTiming(this.currentBookId, this.currentLessonId, sectionKey),
      ])
        .then(function (results) {
          var url = results[0];
          var timing = results[1];
          if (!isCurrent()) return;
          if (
            !url ||
            !timing ||
            !Array.isArray(timing.turns) ||
            !Number.isInteger(turnIdx) ||
            turnIdx < 0 ||
            !timing.turns[turnIdx]
          )
            throw new Error('单句音频数据缺失');
          var selected = timing.turns[turnIdx];
          if (
            timing.mode === 'absolute' &&
            (selected.status === 'unaligned' || selected.status === 'not_spoken')
          ) {
            self._stopTtsPlayback(
              selected.status === 'not_spoken' ? '舞台说明无需朗读' : '本句定位待校准，请播放整段会话',
            );
            return;
          }
          var interval = self._getDialogueIntervals(timing).find(function (turn) {
            return turn.index === turnIdx;
          });
          if (!interval) throw new Error('单句时间数据无效');
          var start = interval.start;
          var end = interval.end;
          self.ttsState.reviewNotice = selected.source_revision_mismatch ? '音频与修订文字待核对' : '';
          // Public releases contain the final OGG only; seek within that file.
          audio = new Audio(url);
          audio.preload = 'auto';
          self.ttsState.audio = audio;

          function clearStopTimer() {
            if (!isCurrent()) return;
            window.clearTimeout(self.ttsState.timerId);
            self.ttsState.timerId = 0;
          }
          function stopAtBoundary() {
            if (!isCurrent()) return;
            clearStopTimer();
            if (audio.currentTime >= end - 0.02) {
              self._stopTtsPlayback('单句朗读完成');
            } else if (!audio.paused && !audio.seeking) {
              self.ttsState.timerId = window.setTimeout(
                stopAtBoundary,
                Math.max(20, ((end - audio.currentTime) * 1000) / audio.playbackRate),
              );
            }
          }
          function failPlayback() {
            if (isCurrent()) self._stopTtsPlayback(AUDIO_FAILURE);
          }
          function startPlayback() {
            if (!isCurrent()) return;
            // Streaming OGG responses can report Infinity until the last page
            // arrives. The manifest supplies the interval in that case.
            if (
              Number.isNaN(audio.duration) ||
              (Number.isFinite(audio.duration) && (start >= audio.duration || end > audio.duration + 0.1))
            ) {
              failPlayback();
              return;
            }
            try {
              audio.currentTime = start;
              audio.play().catch(failPlayback);
            } catch (error) {
              failPlayback();
            }
          }
          audio.addEventListener('loadedmetadata', startPlayback, { once: true });
          audio.addEventListener('timeupdate', stopAtBoundary);
          audio.addEventListener('ratechange', stopAtBoundary);
          audio.addEventListener('seeked', stopAtBoundary);
          audio.addEventListener('waiting', clearStopTimer);
          audio.addEventListener('seeking', clearStopTimer);
          audio.addEventListener('pause', clearStopTimer);

          audio.addEventListener('playing', function () {
            if (!isCurrent()) return;
            self.ttsState.loading = false;
            self.ttsState.statusText =
              '正在朗读单句' + (self.ttsState.reviewNotice ? ' · ' + self.ttsState.reviewNotice : '');
            self._syncTtsButtonState();
            stopAtBoundary();

            var domTurns = self.readerEl.querySelectorAll(
              'section[data-tts-mode="' + mode + '"] .tb-dialogue-turn',
            );
            domTurns.forEach(function (el, idx) {
              if (idx === turnIdx) el.classList.add('tts-reading');
              else el.classList.remove('tts-reading');
            });
          });

          audio.addEventListener('ended', function () {
            if (isCurrent()) {
              var domTurns = self.readerEl.querySelectorAll(
                'section[data-tts-mode="' + mode + '"] .tb-dialogue-turn',
              );
              domTurns.forEach(function (el) {
                el.classList.remove('tts-reading');
              });
              self._stopTtsPlayback('单句朗读完成');
            }
          });

          audio.addEventListener('error', function () {
            failPlayback();
          });

          self._syncTtsButtonState();
          if (audio.readyState >= 1) startPlayback();
          else audio.load();
        })
        .catch(function (err) {
          if (!isCurrent()) return;
          self.ttsState.loading = false;
          self.ttsState.statusText = AUDIO_FAILURE;
          self._syncTtsButtonState();
          console.error('[TextbookTTS] Single turn playback failed:', err);
        });
    },

    _playVocabLoop: function (startIndex) {
      var safeStart = parseInt(startIndex, 10);
      if (!this.currentVocab.length) return;
      if (isNaN(safeStart) || safeStart < 0 || safeStart >= this.currentVocab.length) safeStart = 0;
      this._stopTtsPlayback();
      this.ttsState.mode = 'vocab-loop';
      this.ttsState.loading = true;
      this.ttsState.loopCursor = safeStart;
      this.ttsState.loopRepeat = 0;
      this.ttsState.activeVocabIndex = safeStart;
      this.ttsState.statusText = safeStart > 0 ? '准备从当前词开始顺序朗读...' : '准备开始顺序朗读...';
      this._syncTtsButtonState();
      this._playNextVocabLoopItem();
    },

    _playNextVocabLoopItem: function () {
      var self = this;
      var row = null;
      var audioIndex = 0;
      var word = '';
      var statusPrefix = '';
      if (this.ttsState.mode !== 'vocab-loop') return;
      var isCurrent = this._getTtsRequestGuard('vocab-loop');
      var audio = null;
      row = this.currentVocab[this.ttsState.loopCursor] || null;
      if (!row) {
        this._stopTtsPlayback('本课词汇顺序朗读完成');
        return;
      }

      audioIndex = this._vocabAudioIndex(row);
      word = this._cleanValue(
        row.word || row.label || row.reading_hiragana || '词汇 ' + (this.ttsState.loopCursor + 1),
      );
      if (isNaN(audioIndex) || row.audio_available === false) {
        this._advanceVocabLoopState();
        this._playNextVocabLoopItem();
        return;
      }

      this.ttsState.loading = true;
      this.ttsState.activeVocabIndex = this.ttsState.loopCursor;
      statusPrefix = '准备朗读 ';
      this.ttsState.statusText =
        statusPrefix +
        this._buildVocabLoopProgressText(this.ttsState.loopCursor, this.ttsState.loopRepeat, word);
      this._syncTtsButtonState();

      this._vocabAudioUrl(row, audioIndex)
        .then(function (url) {
          var nextState = null;
          if (!isCurrent()) return;
          if (!url) throw new Error('未找到该词条的音频');

          audio = new Audio(url);
          audio.preload = 'auto';
          self.ttsState.audio = audio;

          audio.addEventListener('playing', function () {
            if (!isCurrent(audio)) return;
            self.ttsState.loading = false;
            self.ttsState.statusText =
              '正在朗读 ' +
              self._buildVocabLoopProgressText(self.ttsState.loopCursor, self.ttsState.loopRepeat, word);
            self._syncTtsButtonState();
          });
          audio.addEventListener('ended', function () {
            if (!isCurrent(audio)) return;
            self.ttsState.audio = null;
            nextState = self._peekNextVocabLoopState();
            if (!nextState) {
              self._stopTtsPlayback('本课词汇顺序朗读完成');
              return;
            }
            self.ttsState.loading = true;
            self.ttsState.statusText =
              self._buildVocabLoopProgressText(self.ttsState.loopCursor, self.ttsState.loopRepeat, word) +
              ' · 间隔 1 秒后继续';
            self.ttsState.timerId = window.setTimeout(function () {
              if (!isCurrent()) return;
              self.ttsState.timerId = 0;
              self._advanceVocabLoopState();
              self._playNextVocabLoopItem();
            }, self.vocabLoopDelayMs);
            self._syncTtsButtonState();
          });
          audio.addEventListener('error', function () {
            if (isCurrent(audio)) self._stopTtsPlayback(AUDIO_FAILURE);
          });

          self._syncTtsButtonState();
          return audio.play();
        })
        .catch(function (err) {
          if (!isCurrent(audio)) return;
          self._stopTtsPlayback(AUDIO_FAILURE);
          console.error('[TextbookTTS] Vocab loop playback failed:', err);
        });
    },

    _playVocabAudio: function (mode) {
      var self = this;
      var index = parseInt(String(mode || '').split(':')[1], 10);
      if (isNaN(index)) return;
      var row = this.currentVocab[this._findVocabArrayIndexByAudioIndex(index)];
      if (row && row.audio_available === false) {
        this._stopTtsPlayback('此词读音关联待核对，暂不朗读');
        return;
      }

      this._stopTtsPlayback();
      this.ttsState.mode = mode;
      var isCurrent = this._getTtsRequestGuard(mode);
      var audio = null;
      this.ttsState.loading = true;
      this.ttsState.activeVocabIndex = this._findVocabArrayIndexByAudioIndex(index);
      this.ttsState.statusText = '';
      this._syncTtsButtonState();

      this._vocabAudioUrl(row, this._vocabAudioIndex(row, index))
        .then(function (url) {
          if (!isCurrent()) return;
          if (!url) throw new Error('未找到该词条的音频');

          audio = new Audio(url);
          audio.preload = 'auto';
          self.ttsState.audio = audio;

          audio.addEventListener('playing', function () {
            if (!isCurrent(audio)) return;
            self.ttsState.loading = false;
            self._syncTtsButtonState();
          });
          audio.addEventListener('ended', function () {
            if (isCurrent(audio)) self._stopTtsPlayback();
          });
          audio.addEventListener('error', function () {
            if (isCurrent(audio)) self._stopTtsPlayback(AUDIO_FAILURE);
          });

          self._syncTtsButtonState();
          return audio.play();
        })
        .catch(function (err) {
          if (!isCurrent(audio)) return;
          self._stopTtsPlayback(AUDIO_FAILURE);
          console.error('[TextbookTTS] Vocab playback failed:', err);
        });
    },

    // KotobaFlow words recorded outside the legacy library carry their own URL.
    _vocabAudioUrl: function (row, audioIndex) {
      if (row && row.vocab_audio_url) return Promise.resolve(row.vocab_audio_url);
      return TextbookLoader.getVocabAudioUrl(audioIndex);
    },

    // KotobaFlow rows carry the verified legacy recording index; their own
    // index is a different namespace and must not select an audio file.
    _vocabAudioIndex: function (row, fallback) {
      if (row && row.vocab_audio_index !== undefined && row.vocab_audio_index !== null)
        return parseInt(row.vocab_audio_index, 10);
      return parseInt(row ? row.index : fallback, 10);
    },

    _playKanaClip: function (clipId, label) {
      var self = this;
      var mode = 'kana:' + clipId;
      if (
        (this.ttsState.loading || (this.ttsState.audio && !this.ttsState.audio.paused)) &&
        this.ttsState.mode === mode
      ) {
        this._stopTtsPlayback();
        return;
      }
      this._stopTtsPlayback();
      this.ttsState.mode = mode;
      var isCurrent = this._getTtsRequestGuard(mode);
      var audio = null;
      this.ttsState.loading = true;
      this.ttsState.statusText = '正在加载示范音...';
      this._syncTtsButtonState();

      TextbookLoader.getKanaClipUrl(clipId)
        .then(function (url) {
          if (!isCurrent()) return;
          if (!url) throw new Error('未找到该示范音');
          audio = new Audio(url);
          audio.preload = 'auto';
          self.ttsState.audio = audio;
          audio.addEventListener('playing', function () {
            if (!isCurrent(audio)) return;
            self.ttsState.loading = false;
            self.ttsState.statusText = '正在播放：' + label + ' · 示范音待人工听检';
            self._syncTtsButtonState();
          });
          audio.addEventListener('ended', function () {
            if (isCurrent(audio)) self._stopTtsPlayback('播放完成：' + label);
          });
          audio.addEventListener('error', function () {
            if (isCurrent(audio)) self._stopTtsPlayback(AUDIO_FAILURE);
          });
          self._syncTtsButtonState();
          return audio.play();
        })
        .catch(function (err) {
          if (!isCurrent(audio)) return;
          self._stopTtsPlayback(AUDIO_FAILURE);
          console.error('[TextbookTTS] Kana clip playback failed:', err);
        });
    },

    _stopTtsPlayback: function (message) {
      this._ttsRequestId = (this._ttsRequestId || 0) + 1;
      var finishedMode = this.ttsState.mode || this.ttsState.lastMode || '';
      if (this.ttsState.abortController) {
        try {
          this.ttsState.abortController.abort();
        } catch (e) {}
      }
      if (this.ttsState.timerId) {
        try {
          window.clearTimeout(this.ttsState.timerId);
        } catch (e) {}
      }
      if (this.ttsState.audio) {
        try {
          this.ttsState.audio.pause();
          this.ttsState.audio.currentTime = 0;
        } catch (e) {}
      }
      if (this.ttsState.objectUrl) {
        try {
          URL.revokeObjectURL(this.ttsState.objectUrl);
        } catch (e) {}
      }

      // Remove dialogue highlights
      if (this.readerEl) {
        this.readerEl.querySelectorAll('.tb-dialogue-turn.tts-reading').forEach(function (el) {
          el.classList.remove('tts-reading');
        });
      }

      this.ttsState.loading = false;
      this.ttsState.mode = '';
      this.ttsState.lastMode = finishedMode;
      this.ttsState.audio = null;
      this.ttsState.objectUrl = '';
      this.ttsState.timerId = 0;
      this.ttsState.abortController = null;
      this.ttsState.segments = [];
      this.ttsState.segmentIndex = 0;
      this.ttsState.activeVocabIndex = -1;
      this.ttsState.loopCursor = 0;
      this.ttsState.loopRepeat = 0;
      this.ttsState.statusText = message || '';
      this.ttsState.reviewNotice = '';
      this._syncTtsButtonState();
    },

    _syncTtsButtonState: function () {
      var roots = [];
      if (this.readerEl) roots.push(this.readerEl);
      if (this.detailEl) roots.push(this.detailEl);

      for (var r = 0; r < roots.length; r++) {
        var buttons = roots[r].querySelectorAll('.tb-tts-btn');
        for (var i = 0; i < buttons.length; i++) {
          var btn = buttons[i];
          var mode = btn.getAttribute('data-tts-mode') || '';
          var isCurrent = !!mode && mode === this.ttsState.mode;
          var isBusy =
            (this.ttsState.loading || (this.ttsState.audio && !this.ttsState.audio.paused)) && isCurrent;
          btn.disabled = false;
          btn.classList.toggle('is-loading', this.ttsState.loading && isCurrent);
          btn.classList.toggle('is-playing', isBusy);
          var iconOnly = btn.classList.contains('tb-tts-btn-mini');
          var buttonText = iconOnly
            ? ''
            : isBusy
              ? btn.getAttribute('data-stop-text') || '停止'
              : btn.getAttribute('data-start-text') || '播放';
          btn.innerHTML = uiIcon(isBusy ? 'stop' : 'play') + this._esc(buttonText);
        }
      }

      for (var s = 0; s < roots.length; s++) {
        var statuses = roots[s].querySelectorAll('.tb-tts-status');
        for (var j = 0; j < statuses.length; j++) {
          var el = statuses[j];
          var statusMode = el.getAttribute('data-tts-status') || '';
          var idleText = el.getAttribute('data-idle-text') || '';
          var active =
            !!statusMode &&
            (statusMode === this.ttsState.mode || this.ttsState.mode.indexOf(statusMode + ':single:') === 0);
          var recent =
            !this.ttsState.mode &&
            this.ttsState.statusText &&
            (statusMode === this.ttsState.lastMode ||
              this.ttsState.lastMode.indexOf(statusMode + ':single:') === 0);
          if ((active || recent) && this.ttsState.statusText) el.textContent = this.ttsState.statusText;
          else el.textContent = idleText;
        }
      }

      for (var p = 0; p < roots.length; p++) {
        var progressBars = roots[p].querySelectorAll('.tb-tts-progress');
        for (var q = 0; q < progressBars.length; q++) {
          var progressEl = progressBars[q];
          var progressMode = progressEl.getAttribute('data-tts-progress') || '';
          var isProgressActive = !!progressMode && progressMode === this.ttsState.mode;
          var ratio = 0;
          if (isProgressActive && progressMode === 'vocab-loop' && this.currentVocab.length) {
            var totalUnits = this.currentVocab.length * this.vocabLoopRepeatCount;
            var currentUnit = this.ttsState.loopCursor * this.vocabLoopRepeatCount + this.ttsState.loopRepeat;
            var unitProgress = 0;
            if (
              this.ttsState.audio &&
              isFinite(this.ttsState.audio.duration) &&
              this.ttsState.audio.duration > 0
            ) {
              unitProgress = Math.max(
                0,
                Math.min(1, this.ttsState.audio.currentTime / this.ttsState.audio.duration),
              );
            } else if (this.ttsState.timerId) unitProgress = 1;
            ratio = totalUnits ? (currentUnit + unitProgress) / totalUnits : 0;
          } else if (
            isProgressActive &&
            this.ttsState.audio &&
            isFinite(this.ttsState.audio.duration) &&
            this.ttsState.audio.duration > 0
          ) {
            ratio = Math.max(0, Math.min(1, this.ttsState.audio.currentTime / this.ttsState.audio.duration));
          }
          var percent = Math.round(ratio * 100);
          progressEl.classList.toggle('is-active', isProgressActive);
          progressEl.style.setProperty('--tb-audio-progress', percent + '%');
          progressEl.setAttribute('aria-valuenow', String(percent));
        }
      }

      if (this.readerEl) {
        var kanaButtons = this.readerEl.querySelectorAll('[data-kana-clip]');
        for (var kb = 0; kb < kanaButtons.length; kb++) {
          var kanaMode = 'kana:' + kanaButtons[kb].getAttribute('data-kana-clip');
          kanaButtons[kb].classList.toggle('is-playing', this.ttsState.mode === kanaMode);
        }
        var kanaStatus = this.readerEl.querySelector('[data-tts-status="kana"]');
        if (kanaStatus)
          kanaStatus.textContent =
            this.ttsState.mode.indexOf('kana:') === 0 || this.ttsState.lastMode.indexOf('kana:') === 0
              ? this.ttsState.statusText
              : '';
      }

      this._syncActiveVocabState();
    },

    _updateTtsTimedStatus: function (mode, label, audio, activeIndex, segmentCount) {
      if (this.ttsState.mode !== mode || !audio) return;
      var duration = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
      var count = Math.max(1, parseInt(segmentCount, 10) || 1);
      var noPosition = activeIndex === null;
      var index = parseInt(activeIndex, 10);
      if (noPosition) index = -1;
      else if (isNaN(index) || index < 0) {
        index = duration ? Math.min(count - 1, Math.floor((audio.currentTime / duration) * count)) : 0;
      }
      this.ttsState.segmentIndex = index;
      this.ttsState.statusText =
        this._cleanValue(label || '朗读') +
        (noPosition ? ' · ' : ' · 第 ' + (index + 1) + ' / ' + count + ' 段 · ') +
        this._formatAudioClock(audio.currentTime) +
        (duration ? ' / ' + this._formatAudioClock(duration) : '') +
        (this.ttsState.reviewNotice ? ' · ' + this.ttsState.reviewNotice : '');
      this._syncTtsButtonState();
    },

    _getVocabLoopIdleText: function () {
      return (
        '默认：顺序朗读，每词 ' +
        this.vocabLoopRepeatCount +
        ' 遍，间隔 ' +
        Math.round(this.vocabLoopDelayMs / 100) / 10 +
        ' 秒'
      );
    },

    _buildVocabLoopProgressText: function (cursor, repeat, word) {
      return (
        cursor +
        1 +
        ' / ' +
        this.currentVocab.length +
        ' · 第 ' +
        (repeat + 1) +
        ' / ' +
        this.vocabLoopRepeatCount +
        ' 遍 · ' +
        this._cleanValue(word || '-')
      );
    },

    _peekNextVocabLoopState: function () {
      if (!this.currentVocab.length) return null;
      if (this.ttsState.loopRepeat + 1 < this.vocabLoopRepeatCount) {
        return { cursor: this.ttsState.loopCursor, repeat: this.ttsState.loopRepeat + 1 };
      }
      if (this.ttsState.loopCursor + 1 < this.currentVocab.length) {
        return { cursor: this.ttsState.loopCursor + 1, repeat: 0 };
      }
      return null;
    },

    _advanceVocabLoopState: function () {
      var next = this._peekNextVocabLoopState();
      if (!next) return false;
      this.ttsState.loopCursor = next.cursor;
      this.ttsState.loopRepeat = next.repeat;
      return true;
    },

    _findVocabArrayIndexByAudioIndex: function (index) {
      var numericIndex = parseInt(index, 10);
      for (var i = 0; i < this.currentVocab.length; i++) {
        if (parseInt(this.currentVocab[i] && this.currentVocab[i].index, 10) === numericIndex) return i;
      }
      return -1;
    },

    _syncActiveVocabState: function () {
      var items = null;
      var activeIndex = this.ttsState.activeVocabIndex;
      var target = null;
      var summary = null;
      if (!this.readerEl) return;
      items = this.readerEl.querySelectorAll('.tb-reading-vocab-row[data-vocab-entry="1"]');
      for (var i = 0; i < items.length; i++) {
        items[i].classList.toggle('tb-item-loop-active', i === activeIndex);
      }
      // Only the read-through follows its word; a single word played from a
      // detail popup or row stays where the reader is.
      if (activeIndex < 0 || activeIndex >= items.length || this.ttsState.mode !== 'vocab-loop') {
        this._lastTtsActiveVocabIndex = -1;
        return;
      }
      if (this._lastTtsActiveVocabIndex === activeIndex) return;
      this._lastTtsActiveVocabIndex = activeIndex;
      target = items[activeIndex];
      summary = target.querySelector('[data-vocab-detail-index]') || target;
      // Pages are clipped columns: turn to the word's spread instead of scrolling
      // the book sideways, which the pager would snap back on every word.
      if (this._bookPager) this._bookPager.show(target);
      else if (summary && summary.scrollIntoView)
        summary.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    },

    _buildTtsText: function (text) {
      return this._buildTtsSegments(text).join('\\n\\n');
    },

    _getRenderedTtsSegments: function (mode) {
      if (!this.readerEl) return [];
      var nodes = this.readerEl.querySelectorAll('.tb-section[data-tts-mode="' + mode + '"] .tb-paragraph');
      var segments = [];
      for (var i = 0; i < nodes.length; i++) {
        // A page turn briefly lays copies of the old pages over the book (js/core/book-turn.js).
        if (nodes[i].closest('.book-flip-layer')) continue;
        var text = this._cleanValue(nodes[i].textContent || nodes[i].innerText || '');
        if (!text) continue;
        var parts = this._buildTtsSegments(text);
        for (var j = 0; j < parts.length; j++) if (parts[j]) segments.push(parts[j]);
      }
      return segments;
    },

    _buildTtsSegments: function (text) {
      var normalized = [];
      var replacements = { 饮: '飲' };
      var parts = this._splitParagraphs(text);
      for (var i = 0; i < parts.length; i++) {
        var part = this._cleanValue(parts[i]).replace(/\n+/g, '');
        for (var key in replacements)
          if (Object.prototype.hasOwnProperty.call(replacements, key))
            part = part.split(key).join(replacements[key]);
        if (part) normalized.push(part);
      }
      return normalized;
    },
  });
})(window);
