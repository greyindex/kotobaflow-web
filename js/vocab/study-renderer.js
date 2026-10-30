(function (root) {
  'use strict';

  var app = root.JPLearn || (root.JPLearn = {});

  function formatSessionDuration(ms) {
    var seconds = Math.max(0, Math.round((Number(ms) || 0) / 1000));
    if (seconds < 60) return seconds + '秒';
    return Math.floor(seconds / 60) + '分 ' + String(seconds % 60).padStart(2, '0') + '秒';
  }

  app.installStudyRenderer = function (StudyMode) {
    StudyMode.prototype._renderSessionSource = function () {
      var source = this.sessionSource || {};
      if (
        source.kind !== 'result-review' &&
        source.kind !== 'status-review' &&
        source.kind !== 'textbook-course' &&
        source.kind !== 'daily-review' &&
        source.kind !== 'weak-stats'
      )
        return '';
      var title = source.kind === 'result-review' ? '错项复习 · 第 ' + source.depth + ' 轮' : source.label;
      var detail =
        source.kind === 'result-review'
          ? '来自上次结果 ' + source.parentTotal + ' 词 · 本轮 ' + source.reviewCount + ' 词'
          : source.kind === 'textbook-course'
            ? '完成后返回课文继续学习'
            : '本轮 ' + this.queue.length + ' 词';
      return (
        '<div class="study-source-banner" role="status"><span>' +
        uiIcon('rotate-ccw') +
        this._esc(title) +
        '</span><small>' +
        this._esc(detail) +
        '</small></div>'
      );
    };

    StudyMode.prototype.render = function () {
      if (this._keyHandler) document.removeEventListener('keydown', this._keyHandler);
      if (this.subView) {
        this._renderSubView();
        return;
      }

      if (this.queue.length > 0 && this.currentIndex < this.queue.length) {
        if (this.practiceMode === 'mixed') this._renderExercise();
        else this._renderCard();
        if (this.sessionSource.requestedCount > this.queue.length) {
          var limitNotice = document.createElement('div');
          limitNotice.className = 'practice-notice';
          limitNotice.setAttribute('role', 'status');
          limitNotice.textContent =
            '本轮学习前 ' +
            this.queue.length +
            ' 词（共 ' +
            this.sessionSource.requestedCount +
            ' 词），其余词条保留在原列表。';
          this.container.querySelector('.study-card-view').prepend(limitNotice);
        }
        if (this.saveError) {
          var alert = document.createElement('div');
          alert.className = 'practice-notice study-save-error';
          alert.setAttribute('role', 'alert');
          alert.innerHTML =
            this._esc(this.saveError) +
            (this._pendingFeedback
              ? ' <button type="button" class="btn-secondary" id="btnRetryAnswer">重试保存</button>'
              : '');
          this.container.prepend(alert);
          var self = this;
          var retry = alert.querySelector('button');
          if (retry)
            retry.addEventListener('click', function () {
              var pending = self._pendingFeedback;
              if (pending) self._handleFeedback(pending.word, pending.feedback, pending.meta);
            });
        }
        return;
      }

      if (this.queue.length > 0 && this.currentIndex >= this.queue.length) {
        this._renderComplete();
        return;
      }

      this._renderSetup();
    };

    // ─── 配置面板 ────────────────────────────────────────

    StudyMode.prototype._renderSetup = function () {
      var counts = window.StudyStorage.getCounts();
      var filteredCount = window.appConfig.getCurrentWords().length;

      var html = '<div class="study-setup">';
      html += '<div class="study-setup-header">';
      html += '<h2>' + uiIcon('library') + '学习模式</h2>';
      html += '<p class="study-subtitle">基于当前筛选条件生成学习队列</p>';
      html += '</div>';

      // 当前筛选概况
      html += '<div class="study-info-card">';
      html +=
        '<div class="study-info-row"><span>当前筛选结果</span><strong>' +
        filteredCount +
        ' 词</strong></div>';
      html +=
        '<div class="study-info-row"><span>累计已认识</span><strong class="c-green">' +
        counts.known +
        '</strong></div>';
      html +=
        '<div class="study-info-row"><span>累计模糊</span><strong class="c-amber">' +
        counts.fuzzy +
        '</strong></div>';
      html +=
        '<div class="study-info-row"><span>累计不会</span><strong class="c-red">' +
        counts.unknown +
        '</strong></div>';
      html +=
        '<div class="study-info-row"><span>收藏</span><strong class="c-purple">' +
        counts.favorite +
        '</strong></div>';
      html += '</div>';

      // 学习数量选择
      html += '<div class="study-config">';
      html += '<label>今日学习数量</label>';
      html += '<div class="study-count-btns">';
      var countOptions = [20, 30, 50, 100];
      for (var i = 0; i < countOptions.length; i++) {
        var n = countOptions[i];
        var disabled = n > filteredCount ? ' disabled' : '';
        var sel = i === 1 ? ' active' : ''; // 默认选 30
        html +=
          '<button class="study-count-btn' +
          sel +
          disabled +
          '" data-count="' +
          n +
          '"' +
          disabled +
          '>' +
          n +
          '</button>';
      }
      html += '</div>';
      html += '</div>';

      html += '<div class="study-config study-mode-config">';
      html += '<label>练习方式</label>';
      html += '<div class="study-mode-options" role="radiogroup" aria-label="练习方式">';
      html +=
        '<button class="study-mode-btn active" type="button" role="radio" aria-checked="true" data-practice-mode="mixed"><strong>智能混合</strong><span>选择、听音、输入、例句</span></button>';
      html +=
        '<button class="study-mode-btn" type="button" role="radio" aria-checked="false" data-practice-mode="classic"><strong>经典词卡</strong><span>翻面后自行判断掌握度</span></button>';
      html += '</div></div>';

      // 开始学习按钮
      html +=
        '<button class="btn-study-start" id="btnStartStudy"' + (filteredCount === 0 ? ' disabled' : '') + '>';
      html += uiIcon('target') + '开始学习';
      html += '</button>';

      // 分隔
      html += '<hr class="study-divider">';

      // 错词本/模糊/收藏入口
      html += '<div class="study-review-section">';
      html += '<h3>' + uiIcon('book') + '复习入口</h3>';
      html += '<div class="study-review-btns">';
      html +=
        '<button class="btn-review' +
        (counts.unknown === 0 ? ' disabled' : '') +
        '" data-review="unknown" ' +
        (counts.unknown === 0 ? 'disabled' : '') +
        '>';
      html += uiIcon('x-circle') + '错词本 <span class="review-count">' + counts.unknown + '</span></button>';
      html +=
        '<button class="btn-review' +
        (counts.fuzzy === 0 ? ' disabled' : '') +
        '" data-review="fuzzy" ' +
        (counts.fuzzy === 0 ? 'disabled' : '') +
        '>';
      html += uiIcon('diamond') + '模糊词 <span class="review-count">' + counts.fuzzy + '</span></button>';
      html +=
        '<button class="btn-review' +
        (counts.favorite === 0 ? ' disabled' : '') +
        '" data-review="favorite" ' +
        (counts.favorite === 0 ? 'disabled' : '') +
        '>';
      html += uiIcon('star') + '收藏词 <span class="review-count">' + counts.favorite + '</span></button>';
      html += '</div>';
      html += '</div>';

      html += '</div>';
      this.container.innerHTML = html;
      this._bindSetupEvents();
    };

    StudyMode.prototype._renderExercise = function () {
      var w = this.queue[this.currentIndex];
      var exercise = this._getCurrentExercise();
      if (!exercise) {
        this.practiceMode = 'classic';
        this.practiceNotice = '当前词条无法生成无歧义练习，已切换到经典词卡。';
        this._renderCard();
        return;
      }
      var progress = this.currentIndex + 1;
      var total = this.queue.length;
      var pct = Math.round((this.currentIndex / total) * 100);
      var feedback = this.exerciseFeedback;
      var status = window.StudyStorage.getWordStatus(w.index);
      // FIX-19: the page is zh-CN; mark which side of each task is Japanese.
      var promptLang = exercise.type === 'ja-zh' || exercise.type === 'cloze' ? ' lang="ja"' : '';
      var optionLang = exercise.type === 'ja-zh' ? '' : ' lang="ja"';

      var html = '<div class="study-card-view practice-view">';
      html +=
        '<div class="study-progress"><div class="study-progress-bar" style="width:' + pct + '%"></div></div>';
      html += '<div class="study-stats-row">';
      html +=
        '<button class="study-exit-action" type="button" data-study-exit>' +
        uiIcon('arrow-left') +
        '返回词汇</button>';
      html += '<span>' + progress + ' / ' + total + '</span>';
      html += '<span class="practice-type-pill">' + this._esc(exercise.label) + '</span>';
      html += '<span class="c-green">' + uiIcon('check') + this.sessionStats.known + '</span>';
      html += '<span class="c-red">' + uiIcon('x') + this.sessionStats.unknown + '</span>';
      if (status.isFavorite) html += '<span class="c-purple">' + uiIcon('star') + '</span>';
      html += '</div>';
      html += this._renderSessionSource();

      if (this.practiceNotice) {
        html += '<div class="practice-notice" role="status">' + this._esc(this.practiceNotice) + '</div>';
      }

      html +=
        '<section class="practice-card" aria-labelledby="practicePrompt" data-exercise-type="' +
        exercise.type +
        '">';
      html += '<div class="practice-question">';
      html += '<div class="practice-kicker">' + this._esc(exercise.instruction) + '</div>';
      if (exercise.type === 'listening') {
        html += '<div class="practice-listening-mark" aria-hidden="true">' + uiIcon('volume') + '</div>';
        html +=
          '<h2 id="practicePrompt" class="practice-prompt practice-prompt-listening">' +
          this._esc(exercise.prompt) +
          '</h2>';
        html +=
          '<button class="btn-practice-audio" id="btnPracticeAudio" type="button">' +
          uiIcon('volume') +
          '播放发音 <kbd>R</kbd></button>';
        html +=
          '<audio id="practiceAudioProbe" preload="metadata" src="' +
          this._esc(exercise.audioUrl) +
          '"></audio>';
      } else {
        html +=
          '<h2 id="practicePrompt" class="practice-prompt' +
          (exercise.type === 'cloze' ? ' practice-prompt-sentence' : '') +
          '"' +
          promptLang +
          '>' +
          this._esc(exercise.prompt) +
          '</h2>';
        if (exercise.translation) {
          html += '<p class="practice-translation">' + this._esc(exercise.translation) + '</p>';
        }
        if (exercise.notAnswers && exercise.notAnswers.length) {
          var self = this;
          html +=
            '<p class="practice-translation practice-not-answers">不是：' +
            exercise.notAnswers
              .map(function (name) {
                return '<span lang="ja">' + self._esc(name) + '</span>';
              })
              .join('、') +
            '</p>';
        }
      }

      html += '</div>';

      if (exercise.options) {
        html += '<div class="practice-options">';
        for (var i = 0; i < exercise.options.length; i++) {
          var option = exercise.options[i];
          var optionClass = '';
          if (feedback) {
            if (option.correct) optionClass = ' is-correct';
            else if (feedback.selectedIndex === i) optionClass = ' is-wrong';
          }
          html +=
            '<button class="practice-option' +
            optionClass +
            '" type="button" data-option-index="' +
            i +
            '"' +
            (feedback ? ' disabled' : '') +
            '><kbd>' +
            (i + 1) +
            '</kbd><span' +
            optionLang +
            '>' +
            this._esc(option.label) +
            '</span></button>';
        }
        html += '</div>';
      } else {
        html += '<div class="practice-input-row">';
        html +=
          '<input id="practiceAnswerInput" type="text" lang="ja" autocomplete="off" placeholder="输入答案" aria-label="练习答案"' +
          (feedback ? ' disabled value="' + this._esc(feedback.inputValue || '') + '"' : '') +
          '>';
        if (!feedback) html += '<button id="btnPracticeSubmit" type="button">提交答案</button>';
        html += '</div>';
        html +=
          '<p class="practice-normalize-hint">接受常见全角/半角与平假名/片假名形式，空格不影响判断。</p>';
      }

      if (feedback) {
        // The saved answer identifies the word; choice feedback names the correct option.
        var correctOption =
          exercise.options &&
          exercise.options.find(function (option) {
            return option.correct;
          });
        var answer = correctOption ? correctOption.label : exercise.answer;
        var answerIsJapanese = exercise.type !== 'ja-zh';
        var showReading =
          answerIsJapanese &&
          exercise.reading &&
          window.JPLearn.practice.normalizeJapanese(exercise.reading) !==
            window.JPLearn.practice.normalizeJapanese(answer);
        html +=
          '<div class="practice-feedback ' +
          (feedback.correct ? 'is-correct' : 'is-wrong') +
          '" role="status"><strong>' +
          (feedback.correct ? uiIcon('check') + '回答正确' : uiIcon('x') + '回答错误') +
          '</strong><span>正确答案：<span lang="' +
          (answerIsJapanese ? 'ja' : 'zh-CN') +
          '">' +
          this._esc(answer) +
          (showReading ? '（' + this._esc(exercise.reading) + '）' : '') +
          '</span></span></div>';
      }
      html += '</section>';

      html += '<div class="practice-actions">';
      if (feedback) {
        html +=
          '<button class="btn-primary btn-practice-next" id="btnPracticeNext" type="button">下一题 <kbd>Enter</kbd></button>';
      }
      html +=
        '<button class="btn-ghost btn-practice-favorite" type="button" data-practice-action="favorite">' +
        uiIcon('star') +
        (status.isFavorite ? '已收藏' : '收藏') +
        '</button>';
      if (!feedback) {
        html +=
          '<button class="btn-ghost btn-practice-skip" type="button" data-practice-action="skip">' +
          uiIcon('skip') +
          '跳过</button>';
      }
      html += '</div></div>';

      var hadFocus = this._practiceHasFocus();
      this.container.innerHTML = html;
      this._bindExerciseEvents(w, exercise);
      // Replacing the card drops focus to BODY; keep a keyboard learner on the next step.
      if (hadFocus && !this.container.contains(document.activeElement)) {
        var next = this.container.querySelector(feedback ? '#btnPracticeNext' : '.practice-option');
        if (next) next.focus();
      }
    };

    StudyMode.prototype._practiceHasFocus = function () {
      var active = document.activeElement;
      return !!active && active !== this.container && this.container.contains(active);
    };

    StudyMode.prototype._renderCard = function () {
      var w = this.queue[this.currentIndex];
      var mgr = window.taxonomyManager;
      var status = window.StudyStorage.getWordStatus(w.index);
      var progress = this.currentIndex + 1;
      var total = this.queue.length;
      var pct = Math.round((this.currentIndex / total) * 100);

      var html = '<div class="study-card-view">';

      // 进度条
      html += '<div class="study-progress">';
      html += '<div class="study-progress-bar" style="width:' + pct + '%"></div>';
      html += '</div>';

      // 统计行
      html += '<div class="study-stats-row">';
      html +=
        '<button class="study-exit-action" type="button" data-study-exit>' +
        uiIcon('arrow-left') +
        '返回词汇</button>';
      html += '<span>' + progress + ' / ' + total + '</span>';
      html += '<span class="c-green">' + uiIcon('check') + this.sessionStats.known + '</span>';
      html += '<span class="c-amber">~' + this.sessionStats.fuzzy + '</span>';
      html += '<span class="c-red">' + uiIcon('x') + this.sessionStats.unknown + '</span>';
      if (status.isFavorite) html += '<span class="c-purple">' + uiIcon('star') + '</span>';
      html += '</div>';
      html += this._renderSessionSource();

      // 卡片
      html +=
        '<div class="flashcard' +
        (this.isFlipped ? ' flipped' : '') +
        '" id="flashcard" role="button" tabindex="0" aria-pressed="' +
        (this.isFlipped ? 'true' : 'false') +
        '" aria-label="翻转词汇卡片，' +
        this._esc(w.word) +
        '">';

      // 正面
      html += '<div class="flashcard-front">';
      html += '<div class="fc-level"><span class="level-badge">' + this._esc(w.level) + '</span></div>';
      html += '<div class="fc-word" lang="ja">' + this._esc(w.word) + '</div>';
      var reading = this._getDisplayReading(w);
      if (reading && reading !== w.word) {
        html += '<div class="fc-label" lang="ja">' + this._esc(reading) + '</div>';
      }
      html += '<div class="fc-hint">点击卡片或按 Enter/空格键显示答案</div>';
      html += '</div>';

      // 反面
      html += '<div class="flashcard-back">';
      html +=
        '<div class="fc-word-sm" lang="ja">' +
        this._esc(w.word) +
        ' <span class="level-badge">' +
        this._esc(w.level) +
        '</span></div>';
      html += '<div class="fc-meaning">' + this._esc(w.meaning || '暂无释义') + '</div>';
      html += '<hr class="fc-divider">';

      var metadata = window.JPLearn && window.JPLearn.lexicalMetadata;
      var posLabel = w.pos
        ? metadata
          ? metadata.posLabel({ primary: metadata.primary(w.pos), classes: [metadata.primary(w.pos)] }, 'zh')
          : mgr.getLabel('pos', w.pos)
        : '-';
      var primaryPos = metadata ? metadata.primary(w.pos) : typeof w.pos === 'string' ? w.pos : '';
      var posClasses = metadata ? metadata.classes(w.pos) : typeof w.pos === 'string' ? [w.pos] : [];
      var secondaryPosLabels = [];
      for (var pci = 0; pci < posClasses.length; pci++) {
        if (posClasses[pci] !== primaryPos)
          secondaryPosLabels.push(
            metadata
              ? metadata.posLabel({ primary: posClasses[pci], classes: [posClasses[pci]] }, 'zh')
              : mgr.getLabel('pos', posClasses[pci]),
          );
      }
      html += '<div class="fc-detail-grid">';
      html +=
        '<div class="fc-detail"><span class="fc-dt">词性</span><span class="fc-dd">' +
        this._esc(posLabel) +
        '</span></div>';
      if (secondaryPosLabels.length)
        html +=
          '<div class="fc-detail"><span class="fc-dt">兼类</span><span class="fc-dd">' +
          this._esc(secondaryPosLabels.join('、')) +
          '</span></div>';
      var conjugationLabel = metadata ? metadata.conjugationLabel(w.pos, 'zh') : '';
      if (conjugationLabel)
        html +=
          '<div class="fc-detail"><span class="fc-dt">活用</span><span class="fc-dd">' +
          this._esc(conjugationLabel) +
          '</span></div>';

      // domain tags
      var domainStr = '';
      for (var i = 0; i < w.domain_codes.length; i++) {
        domainStr +=
          '<span class="tag-badge domain">' +
          this._esc(mgr.getLabel('domain', w.domain_codes[i])) +
          '</span> ';
      }
      html +=
        '<div class="fc-detail"><span class="fc-dt">领域</span><span class="fc-dd">' +
        (domainStr || '-') +
        '</span></div>';

      // semantic tags
      var semStr = '';
      for (var i = 0; i < w.semantic_tag_codes.length; i++) {
        semStr +=
          '<span class="tag-badge semantic">' +
          this._esc(mgr.getLabel('semantic', w.semantic_tag_codes[i])) +
          '</span> ';
      }
      html +=
        '<div class="fc-detail"><span class="fc-dt">语义</span><span class="fc-dd">' +
        (semStr || '-') +
        '</span></div>';

      if (w.example_sentence_ja) {
        html +=
          '<div class="fc-detail fc-full"><span class="fc-dt">例句</span><span class="fc-dd fc-example" lang="ja">' +
          this._esc(w.example_sentence_ja) +
          '</span></div>';
      }
      if (w.example_sentence_zh) {
        html +=
          '<div class="fc-detail fc-full"><span class="fc-dt">中译</span><span class="fc-dd">' +
          this._esc(w.example_sentence_zh) +
          '</span></div>';
      }
      if (w.grammar) {
        html +=
          '<div class="fc-detail"><span class="fc-dt">语法</span><span class="fc-dd">' +
          this._esc(w.grammar) +
          '</span></div>';
      }

      var regLabel = w.register
        ? metadata
          ? metadata.registerLabel(w.register, 'zh')
          : mgr.getLabel('register', w.register)
        : '';
      var transLabel = w.transitivity
        ? metadata
          ? metadata.transitivityLabel(w.transitivity, 'zh')
          : mgr.getLabel('transitivity', w.transitivity)
        : '';
      if (regLabel) {
        html +=
          '<div class="fc-detail"><span class="fc-dt">语体</span><span class="fc-dd">' +
          this._esc(regLabel) +
          '</span></div>';
      }
      if (transLabel) {
        html +=
          '<div class="fc-detail"><span class="fc-dt">自他</span><span class="fc-dd">' +
          this._esc(transLabel) +
          '</span></div>';
      }
      if (w.style) {
        var styleLabel = metadata ? metadata.styleLabel(w.style, 'zh') : w.style;
        if (styleLabel)
          html +=
            '<div class="fc-detail"><span class="fc-dt">媒介 / 体裁</span><span class="fc-dd">' +
            this._esc(styleLabel) +
            '</span></div>';
      }

      html += '</div>'; // fc-detail-grid
      html += '</div>'; // flashcard-back
      html += '</div>'; // flashcard

      // 反馈按钮
      html += '<div class="study-feedback">';
      html += '<button class="fb-btn fb-known" data-fb="known">' + uiIcon('check') + '认识</button>';
      html += '<button class="fb-btn fb-fuzzy" data-fb="fuzzy">~ 模糊</button>';
      html += '<button class="fb-btn fb-unknown" data-fb="unknown">' + uiIcon('x') + '不会</button>';
      html += '<button class="fb-btn fb-skip" data-fb="skip">' + uiIcon('skip') + '跳过</button>';
      html += '</div>';

      // 图谱联动按钮
      html += '<div class="study-nav-btns">';
      html +=
        '<button class="btn-study-nav study-favorite-action fb-fav" data-fb="favorite" aria-pressed="' +
        (status.isFavorite ? 'true' : 'false') +
        '">' +
        uiIcon('star') +
        (status.isFavorite ? '已收藏' : '收藏') +
        '</button>';
      html += '<button class="btn-study-nav" data-nav="local">' + uiIcon('network') + '局部图</button>';
      if (w.domain_codes.length > 0) {
        html +=
          '<button class="btn-study-nav" data-nav="domain" data-code="' +
          this._esc(w.domain_codes[0]) +
          '">' +
          uiIcon('folder') +
          '同领域词</button>';
      }
      if (w.semantic_tag_codes.length > 0) {
        html +=
          '<button class="btn-study-nav" data-nav="semantic" data-code="' +
          this._esc(w.semantic_tag_codes[0]) +
          '">' +
          uiIcon('tag') +
          '同标签词</button>';
      }
      html += '</div>';

      html += '</div>'; // study-card-view
      var hadFocus = this._practiceHasFocus();
      this.container.innerHTML = html;
      this._bindCardEvents(w);
      var card = hadFocus && document.getElementById('flashcard');
      if (card && !this.container.contains(document.activeElement)) card.focus();
    };

    StudyMode.prototype._renderComplete = function () {
      var s = this._finalizeSession();
      if (!s) {
        this._renderSetup();
        return;
      }
      if (
        this.sessionSaved &&
        s.source &&
        s.source.kind === 'textbook-course' &&
        window.ModuleSwitcher &&
        window.ModuleSwitcher.completeTextbookCourseStep
      ) {
        window.ModuleSwitcher.completeTextbookCourseStep(s.source);
      }
      var nextWords = window.appConfig.getCurrentWords().filter(function (word) {
        return window.StudyStorage.getWordStatus(word.index).status === 'none';
      });
      var distribution = [
        { key: 'known', label: '认识', value: s.known },
        { key: 'fuzzy', label: '模糊', value: s.fuzzy },
        { key: 'unknown', label: '不会', value: s.unknown },
        { key: 'skipped', label: '跳过', value: s.skipped },
      ];

      var html = '<div class="study-complete">';
      html +=
        '<header class="study-result-header study-result-complete-state" data-state-kind="complete" role="status" aria-live="polite">';
      html += '<div class="study-result-icon" aria-hidden="true">' + uiIcon('check') + '</div>';
      html +=
        '<span class="study-result-kicker">' +
        (s.source && s.source.kind === 'result-review'
          ? '错项复习 · 第 ' + s.source.depth + ' 轮'
          : '本次学习结果') +
        '</span>';
      html += '<h2>完成 ' + s.total + ' 词</h2>';
      html +=
        '<p>' +
        (!this.sessionSaved
          ? '会话历史保存失败。答题记录仍在，请重试保存。'
          : s.source && s.source.kind === 'result-review'
            ? '本轮来自上次结果的 ' + s.source.reviewCount + ' 个错项，结果已独立保存。'
            : '结果已经保存。先看清薄弱处，再选择下一步。') +
        '</p>';
      html += '</header>';
      if (!this.sessionSaved)
        html +=
          '<p class="practice-notice" role="alert"><button type="button" class="btn-secondary" id="btnRetrySessionSave">重试保存会话</button></p>';

      html += '<div class="study-result-overview">';
      html +=
        '<div class="study-result-metric"><span>学习数量</span><strong>' +
        s.total +
        '</strong><small>词</small></div>';
      html +=
        '<div class="study-result-metric"><span>本次耗时</span><strong class="study-result-duration">' +
        formatSessionDuration(s.durationMs) +
        '</strong></div>';
      html +=
        '<div class="study-result-metric"><span>新增掌握</span><strong class="c-green">' +
        s.newlyMastered +
        '</strong><small>词</small></div>';
      html +=
        '<div class="study-result-metric"><span>待复习</span><strong class="c-red">' +
        s.pendingReview +
        '</strong><small>词</small></div>';
      html += '</div>';

      html += '<section class="study-result-panel study-result-distribution-panel">';
      html +=
        '<div class="study-result-panel-heading"><div><span>反馈分布</span><h3>这一组的掌握情况</h3></div></div>';
      html +=
        '<div class="study-result-distribution" role="img" aria-label="认识 ' +
        s.known +
        '，模糊 ' +
        s.fuzzy +
        '，不会 ' +
        s.unknown +
        '，跳过 ' +
        s.skipped +
        '">';
      for (var i = 0; i < distribution.length; i++) {
        var segment = distribution[i];
        if (segment.value === 0) continue;
        html +=
          '<span class="study-result-segment is-' +
          segment.key +
          '" style="width:' +
          (segment.value / s.total) * 100 +
          '%"></span>';
      }
      html += '</div>';
      html += '<div class="study-result-legend">';
      for (var j = 0; j < distribution.length; j++) {
        var item = distribution[j];
        html +=
          '<div><span class="study-result-dot is-' +
          item.key +
          '"></span><span>' +
          item.label +
          '</span><strong>' +
          item.value +
          '</strong></div>';
      }
      html += '</div></section>';

      var exerciseKeys = Object.keys(s.exerciseStats || {});
      if (s.practiceMode === 'mixed' && exerciseKeys.length > 0) {
        html += '<section class="study-result-panel study-result-exercises">';
        html +=
          '<div class="study-result-panel-heading"><div><span>题型表现</span><h3>不同任务的正确率</h3></div></div>';
        html += '<div class="study-result-exercise-list">';
        for (var e = 0; e < exerciseKeys.length; e++) {
          var exerciseKey = exerciseKeys[e];
          var exerciseStat = s.exerciseStats[exerciseKey];
          var answered = exerciseStat.correct + exerciseStat.incorrect;
          var rate = answered ? Math.round((exerciseStat.correct / answered) * 100) : 0;
          html +=
            '<div class="study-result-exercise"><span>' +
            this._esc(window.JPLearn.practice.TYPE_LABELS[exerciseKey] || exerciseKey) +
            '</span><strong>' +
            exerciseStat.correct +
            ' / ' +
            answered +
            '</strong><small>' +
            rate +
            '%</small></div>';
        }
        html += '</div></section>';
      }

      html += '<section class="study-result-panel study-result-weak-panel">';
      html +=
        '<div class="study-result-panel-heading"><div><span>需要再看</span><h3>本次薄弱词</h3></div><small>最多 5 项</small></div>';
      if (s.weakWords.length === 0) {
        html += '<div class="study-result-weak-empty">这一组没有模糊或不会的词。</div>';
      } else {
        html += '<div class="study-result-weak-list">';
        for (var k = 0; k < s.weakWords.length; k++) {
          var weak = s.weakWords[k];
          html += '<div class="study-result-weak-item">';
          html +=
            '<div><strong>' +
            this._esc(weak.word) +
            '</strong>' +
            (weak.reading ? '<span>' + this._esc(weak.reading) + '</span>' : '') +
            '</div>';
          html += '<p>' + this._esc(weak.meaning || '暂无释义') + '</p>';
          html +=
            '<small class="is-' +
            weak.feedback +
            '">' +
            (weak.feedback === 'unknown' ? '不会' : '模糊') +
            '</small></div>';
        }
        html += '</div>';
      }
      html += '</section>';

      if (nextWords.length === 0) {
        html +=
          '<p class="study-complete-next-empty">当前筛选下没有下一组未学习词，返回今日可继续读课文或调整筛选。</p>';
      }
      html += '<div class="study-complete-actions">';
      html +=
        '<button class="' +
        (nextWords.length ? 'btn-primary' : 'btn-ghost') +
        ' btn-study-start" id="btnStudyAgain"' +
        (nextWords.length === 0 ? ' disabled' : '') +
        '>' +
        uiIcon('chevron-right') +
        (nextWords.length ? '继续下一组' : '没有下一组') +
        '</button>';
      html +=
        '<button class="btn-secondary btn-review" id="btnReviewErrors"' +
        (s.pendingReview === 0 ? ' disabled' : '') +
        '>' +
        uiIcon('x-circle') +
        '复习本次错项 <span>' +
        s.pendingReview +
        '</span></button>';
      if (s.source && s.source.kind === 'result-review' && this.resultTrail.length > 0) {
        html +=
          '<button class="btn-ghost btn-review" id="btnBackToPreviousResult">' +
          uiIcon('arrow-left') +
          '返回上次结果</button>';
      }
      if (s.source && s.source.kind === 'textbook-course' && s.source.lessonId) {
        html +=
          '<button class="btn-primary btn-review" id="btnReturnToCourse">' +
          uiIcon('book') +
          '返回本课</button>';
      }
      html +=
        '<button class="' +
        (nextWords.length ? 'btn-ghost' : 'btn-primary') +
        ' btn-review" id="btnBackToSetup">' +
        uiIcon('arrow-left') +
        '返回今日</button>';
      html += '</div>';

      html += '</div>';
      this.container.innerHTML = html;

      var self = this;

      var retrySave = document.getElementById('btnRetrySessionSave');
      if (retrySave) {
        this.container.querySelectorAll('.study-complete-actions button').forEach(function (button) {
          button.disabled = true;
        });
        retrySave.addEventListener('click', function () {
          self._renderComplete();
          self._queueCheckpointSave();
        });
      }

      var againBtn = document.getElementById('btnStudyAgain');
      if (againBtn) {
        againBtn.addEventListener('click', function () {
          window.appConfig.startStudySession(nextWords, {
            shuffle: true,
            limit: Math.max(1, s.total),
            practiceMode: s.practiceMode,
          });
        });
      }

      var errBtn = document.getElementById('btnReviewErrors');
      if (errBtn) {
        var reviewLaunching = false;
        errBtn.addEventListener('click', function () {
          if (reviewLaunching) return;
          reviewLaunching = true;
          if (!self.startResultReview(s)) reviewLaunching = false;
        });
      }

      var previousBtn = document.getElementById('btnBackToPreviousResult');
      if (previousBtn) {
        previousBtn.addEventListener('click', function () {
          self.returnToPreviousResult();
        });
      }

      var courseBtn = document.getElementById('btnReturnToCourse');
      if (courseBtn) {
        courseBtn.addEventListener('click', function () {
          if (window.ModuleSwitcher && window.ModuleSwitcher.returnToTextbook) {
            window.ModuleSwitcher.returnToTextbook(s.source, { completedReview: self.sessionSaved });
          }
        });
      }

      var backBtn = document.getElementById('btnBackToSetup');
      if (backBtn) {
        backBtn.addEventListener('click', function () {
          self.leaveStudyToDashboard();
        });
      }
    };

    // ─── 子视图：错词本/模糊/收藏 ────────────────────────

    StudyMode.prototype._renderSubView = function () {
      var statusMap = {
        errorbook: 'unknown',
        fuzzybook: 'fuzzy',
        favorites: 'favorite',
      };
      var titleMap = {
        errorbook: uiIcon('x-circle') + '错词本',
        fuzzybook: uiIcon('diamond') + '模糊词',
        favorites: uiIcon('star') + '收藏词',
      };
      var status = statusMap[this.subView];
      var title = titleMap[this.subView];
      var indices = window.StudyStorage.getWordsByStatus(status);
      var allWords = window.taxonomyManager.allWords;
      var mgr = window.taxonomyManager;

      // 映射索引到词条对象
      var words = [];
      var indexSet = {};
      for (var i = 0; i < indices.length; i++) indexSet[indices[i]] = true;
      for (var i = 0; i < allWords.length; i++) {
        if (indexSet[allWords[i].index]) words.push(allWords[i]);
      }

      var html = '<div class="study-subview">';
      html += '<div class="study-subview-header">';
      html += '<button class="btn-back-sub" id="btnBackFromSub">' + uiIcon('arrow-left') + '返回</button>';
      html += '<h2>' + title + ' (' + words.length + ')</h2>';
      if (words.length > 0) {
        html +=
          '<button class="btn-review-start" id="btnReviewStart">' + uiIcon('library') + '开始复习</button>';
      }
      html += '</div>';

      if (words.length === 0) {
        if (window.StateView) {
          html += window.StateView.html({
            kind: 'empty',
            className: 'study-empty-state',
            icon: status === 'favorite' ? 'star' : 'library',
            title:
              status === 'favorite' ? '还没有收藏词' : status === 'unknown' ? '错词本是空的' : '模糊词是空的',
            message:
              status === 'favorite'
                ? '在词卡或详情中收藏词条后，就能从这里开始复习。'
                : '完成一次学习并标记对应反馈后，这里会出现可复习内容。',
            action: { id: 'back-from-empty-subview', label: '返回学习配置', icon: 'arrow-left' },
          });
        } else {
          html += '<div class="study-empty">暂无记录</div>';
        }
      } else {
        html += '<div class="review-list">';
        for (var i = 0; i < words.length; i++) {
          var w = words[i];
          var metadata = window.JPLearn && window.JPLearn.lexicalMetadata;
          var posLabel = w.pos
            ? metadata
              ? metadata.posLabel(
                  { primary: metadata.primary(w.pos), classes: [metadata.primary(w.pos)] },
                  'zh',
                )
              : mgr.getLabel('pos', w.pos)
            : '-';
          html += '<div class="review-item" data-word-index="' + w.index + '">';
          html += '<div class="ri-main">';
          html += '<strong>' + this._esc(w.word) + '</strong>';
          html += '<span class="ri-meaning">' + this._esc(w.meaning || '') + '</span>';
          html += '</div>';
          html += '<div class="ri-meta">';
          html += '<span class="level-badge">' + this._esc(w.level) + '</span>';
          html += '<span class="ri-pos">' + this._esc(posLabel) + '</span>';
          html +=
            '<button class="btn-sm btn-remove-word" data-word-index="' +
            w.index +
            '" data-status="' +
            status +
            '" title="移除" aria-label="移除">' +
            uiIcon('x') +
            '</button>';
          html += '</div>';
          html += '</div>';
        }
        html += '</div>';
      }

      html += '</div>';
      this.container.innerHTML = html;

      var self = this;
      var emptyAction = this.container.querySelector('[data-state-action="back-from-empty-subview"]');
      if (emptyAction)
        emptyAction.addEventListener('click', function () {
          self.subView = null;
          self.render();
        });

      var backBtn = document.getElementById('btnBackFromSub');
      if (backBtn) {
        backBtn.addEventListener('click', function () {
          self.subView = null;
          self.render();
        });
      }

      var reviewBtn = document.getElementById('btnReviewStart');
      if (reviewBtn) {
        reviewBtn.addEventListener('click', function () {
          if (self.generateReviewQueue(status)) {
            self.render();
            self._updateStatusBar();
          }
        });
      }

      // 移除按钮
      var removeBtns = this.container.querySelectorAll('.btn-remove-word');
      for (var i = 0; i < removeBtns.length; i++) {
        removeBtns[i].addEventListener('click', function (e) {
          e.stopPropagation();
          var idx = parseInt(this.getAttribute('data-word-index'));
          var st = this.getAttribute('data-status');
          var result =
            st === 'favorite'
              ? window.StudyStorage.unfavorite(idx)
              : window.StudyStorage.removeWordStatus(idx, st);
          if (result.status !== 'saved' && result.status !== 'alreadySaved') return;
          self.render();
        });
      }

      // 行点击 → 详情
      var items = this.container.querySelectorAll('.review-item');
      for (var i = 0; i < items.length; i++) {
        items[i].addEventListener('click', function (e) {
          if (e.target.closest('.btn-remove-word')) return;
          var idx = parseInt(this.getAttribute('data-word-index'));
          for (var j = 0; j < allWords.length; j++) {
            if (allWords[j].index === idx) {
              window.detailPanel.showNode({ type: 'word', rawData: allWords[j] }, this, {
                focus: e.detail === 0,
              });
              break;
            }
          }
        });
      }
    };

    // ─── 状态栏更新 ──────────────────────────────────────
  };
})(window);
