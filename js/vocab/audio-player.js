(function (root) {
  'use strict';

  var AUDIO_FAILURE = '音频暂不可用，点击播放按钮重试';

  // Word and example audio never play over each other.
  function stopExampleAudio() {
    var exampleAudio = window.JPLearn && window.JPLearn.exampleAudio;
    if (exampleAudio && exampleAudio.stop) exampleAudio.stop();
  }

  window.VocabTTS = {
    audio: null,
    queue: [],
    isPlaying: false,
    timerId: 0,
    currentIndex: -1,
    loopRepeatCount: 2,
    loopDelayMs: 1000,
    repeatDelayMs: 500,
    statusCallback: null,

    getAudioUrl: function (index) {
      if (isNaN(index)) return '';
      var idxStr = String(index).padStart(5, '0');
      var folder = idxStr.substring(0, 2) + 'xxx';
      return (
        './data/gcloud_chirp3_vocab12528_female_aoede_v1/audio/' +
        folder +
        '/' +
        idxStr +
        '.ogg?v=20260928-gemini-local-1'
      );
    },

    playOne: function (index, onStatusChange) {
      this.stop();
      stopExampleAudio();
      this.statusCallback = null;
      var url = this.getAudioUrl(index);
      if (!url) {
        if (typeof onStatusChange === 'function') onStatusChange(AUDIO_FAILURE, index);
        return;
      }
      var self = this;
      this.audio = new Audio(url);
      var notifyFailure = function () {
        if (typeof onStatusChange === 'function') onStatusChange(AUDIO_FAILURE, index);
      };
      this.audio.addEventListener('error', notifyFailure, { once: true });
      this.audio.play().catch(function (e) {
        console.warn('[VocabTTS]', url, e);
        notifyFailure();
        self.audio = null;
      });
    },

    playLoop: function (words, onStatusChange) {
      this.stop();
      stopExampleAudio();
      if (!words || !words.length) return;
      this.queue = words;
      this.statusCallback = onStatusChange;
      this.isPlaying = true;
      this.currentIndex = 0;
      this._playNextInLoop(0); // 0 = first repeat
    },

    _playNextInLoop: function (repeatIndex) {
      if (!this.isPlaying) return;
      var wordObj = this.queue[this.currentIndex];
      if (!wordObj) {
        this.stop('朗读完毕');
        return;
      }

      var url = this.getAudioUrl(wordObj.index);
      if (!url) {
        if (this.statusCallback) this.statusCallback(AUDIO_FAILURE, wordObj.index);
        this._advanceLoop(repeatIndex);
        return;
      }

      var self = this;
      this.audio = new Audio(url);
      if (this.statusCallback) {
        this.statusCallback(
          '正在朗读: ' +
            wordObj.word +
            (this.loopRepeatCount > 1 ? ' (' + (repeatIndex + 1) + '/' + this.loopRepeatCount + ')' : ''),
          wordObj.index,
        );
      }

      this.audio.addEventListener('ended', function () {
        if (!self.isPlaying) return;
        self.audio = null;
        self.timerId = setTimeout(
          function () {
            self._advanceLoop(repeatIndex);
          },
          repeatIndex + 1 < self.loopRepeatCount ? self.repeatDelayMs : self.loopDelayMs,
        );
      });

      this.audio.addEventListener('error', function () {
        if (!self.isPlaying) return;
        if (self.statusCallback) self.statusCallback(AUDIO_FAILURE, wordObj.index);
        self.audio = null;
        self._advanceLoop(repeatIndex);
      });

      this.audio.play().catch(function (e) {
        console.warn('[VocabTTS]', url, e);
        if (self.isPlaying && self.statusCallback) self.statusCallback(AUDIO_FAILURE, wordObj.index);
        self.audio = null;
        self._advanceLoop(repeatIndex);
      });
    },

    _advanceLoop: function (repeatIndex) {
      if (repeatIndex + 1 < this.loopRepeatCount) {
        this._playNextInLoop(repeatIndex + 1);
      } else {
        this.currentIndex++;
        this._playNextInLoop(0);
      }
    },

    stop: function (message) {
      this.isPlaying = false;
      this.queue = [];
      this.currentIndex = -1;
      if (this.audio) {
        try {
          this.audio.pause();
          this.audio.currentTime = 0;
        } catch (e) {}
        this.audio = null;
      }
      if (this.timerId) {
        clearTimeout(this.timerId);
        this.timerId = 0;
      }
      if (this.statusCallback) {
        this.statusCallback(message || '');
      }
    },
  };

  root.JPLearn.vocabAudio = root.VocabTTS;
})(window);
