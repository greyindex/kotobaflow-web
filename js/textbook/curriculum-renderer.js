(function (root) {
  'use strict';

  var app = root.JPLearn || (root.JPLearn = {});
  var GRAMMAR_ROLES = { production: '产出', comprehension: '理解', recycle: '复习', mixed: '产出与理解' };

  // KotobaFlow (PUB-04) lesson parts that the XinBian data never had: the
  // chapter 0 kana table, study steps, exercises, unit translations and scenes.
  app.textbookCurriculumMethods = Object.freeze({
    _hasKanaTable: function (lesson) {
      var sections = lesson && lesson.phonetic_sections;
      return !!(sections && sections.length && sections[0] && Array.isArray(sections[0].rows));
    },

    _hasFoundationIntro: function (lesson) {
      return !!(
        lesson &&
        (this._cleanValue(lesson.intro_zh) ||
          (lesson.objectives_zh || []).length ||
          (lesson.study_steps || []).length)
      );
    },

    _hasFoundationNotes: function (lesson) {
      return !!(lesson && ((lesson.notes || []).length || this._cleanValue(lesson.bridge_to_ch01_zh)));
    },

    _lessonExercises: function (lesson) {
      if (!lesson) return [];
      if (lesson.exercises && Array.isArray(lesson.exercises.items)) return lesson.exercises.items;
      return Array.isArray(lesson.practice) ? lesson.practice : [];
    },

    _lessonHasTranslations: function (lesson) {
      if (!lesson) return false;
      return !!(
        (lesson.body && (lesson.body.original_units || []).length) ||
        (lesson.application && (lesson.application.original_units || []).length) ||
        (lesson.conversation && (lesson.conversation.original_turns || []).length)
      );
    },

    _multiline: function (text) {
      return this._esc(this._cleanValue(text)).replace(/\n/g, '<br>');
    },

    _renderFoundationIntro: function (lesson) {
      var html =
        '<section class="tb-section tb-section-foundation"><header class="tb-section-head tb-meta-noselect"><span class="tb-section-badge">学习目标</span>' +
        (lesson.title_zh
          ? '<span class="tb-section-meta">' + this._esc(this._cleanValue(lesson.title_zh)) + '</span>'
          : '') +
        '</header><div class="tb-section-body">';
      if (lesson.intro_zh)
        html += '<p class="tb-foundation-intro">' + this._multiline(lesson.intro_zh) + '</p>';
      var objectives = lesson.objectives_zh || [];
      if (objectives.length) {
        html += '<ul class="tb-foundation-objectives">';
        for (var i = 0; i < objectives.length; i++) html += '<li>' + this._esc(objectives[i]) + '</li>';
        html += '</ul>';
      }
      var steps = lesson.study_steps || [];
      if (steps.length) {
        html += '<ol class="tb-study-steps">';
        for (var j = 0; j < steps.length; j++) {
          var step = steps[j] || {};
          html +=
            '<li><strong>' +
            this._esc(this._cleanValue(step.title_zh) || '步骤 ' + (j + 1)) +
            '</strong><p>' +
            this._multiline(step.explanation_zh) +
            '</p></li>';
        }
        html += '</ol>';
      }
      return html + '</div></section>';
    },

    _renderKanaTableSection: function (lesson) {
      var html = '';
      var sections = lesson.phonetic_sections || [];
      for (var s = 0; s < sections.length; s++) {
        var table = sections[s] || {};
        var columns = table.columns || [];
        html +=
          '<section class="tb-section tb-section-kana"><header class="tb-section-head tb-meta-noselect"><span class="tb-section-badge">五十音</span><span class="tb-section-meta">' +
          this._esc(this._cleanValue(table.title_zh) || '假名表') +
          '</span></header><div class="tb-section-body">' +
          '<p class="tb-kana-hint">点按假名听单音，点按例词听短词；空格表示现代基本表没有对应字。示范音为自动切分的候选录音，尚未逐音人工听检。</p>' +
          '<div class="tb-kana-table-wrap"><table class="tb-kana-table"><caption class="sr-only">' +
          this._esc(this._cleanValue(table.title_zh) || '假名表') +
          '</caption><thead><tr><th scope="col" class="tb-kana-corner">行＼列</th>';
        for (var c = 0; c < columns.length; c++)
          html += '<th scope="col">' + this._esc(columns[c]) + ' 列</th>';
        html += '</tr></thead><tbody>';
        var rows = table.rows || [];
        for (var r = 0; r < rows.length; r++) {
          var row = rows[r] || {};
          html +=
            '<tr><th scope="row"><span lang="ja">' +
            this._esc(this._cleanValue(row.label_ja)) +
            '</span>' +
            (row.label_zh ? '<small>' + this._esc(this._cleanValue(row.label_zh)) + '</small>' : '') +
            '</th>';
          var cells = row.cells || [];
          if (row.column === 'special') {
            html +=
              '<td colspan="' +
              Math.max(1, columns.length) +
              '" class="tb-kana-special">' +
              this._renderKanaCell(cells[0]) +
              '</td>';
          } else {
            for (var k = 0; k < columns.length; k++) {
              html += cells[k]
                ? '<td>' + this._renderKanaCell(cells[k]) + '</td>'
                : '<td class="tb-kana-empty"><span class="sr-only">空格，本表没有对应假名</span></td>';
            }
          }
          html += '</tr>';
        }
        html +=
          '</tbody></table></div><div class="tb-kana-detail" data-kana-detail aria-live="polite">' +
          '<p class="tb-kana-detail-empty">选择一个假名查看发音提示与例词说明。</p></div>' +
          this._renderTtsFeedback('kana', '') +
          '</div></section>';
      }
      return html;
    },

    _renderKanaCell: function (cell) {
      if (!cell) return '';
      var example = cell.example || null;
      var label = cell.hiragana + '／' + cell.katakana + '（' + cell.romaji + '）';
      var html =
        '<button type="button" class="tb-kana-sound" data-kana-clip="' +
        this._esc(cell.id) +
        '" data-kana-label="' +
        this._esc(label) +
        '" aria-label="播放 ' +
        this._esc(label) +
        '"><span class="tb-kana-pair" lang="ja"><span class="tb-kana-hira">' +
        this._esc(cell.hiragana) +
        '</span><span class="tb-kana-kata">' +
        this._esc(cell.katakana) +
        '</span></span><span class="tb-kana-romaji">' +
        this._esc(cell.romaji) +
        '</span></button>';
      if (example) {
        var exampleLabel = example.surface + '（' + example.reading + '）';
        html +=
          '<button type="button" class="tb-kana-example" data-kana-clip="' +
          this._esc(example.id) +
          '" data-kana-label="' +
          this._esc(exampleLabel) +
          '" aria-label="播放例词 ' +
          this._esc(exampleLabel + ' ' + (example.meaning_zh || '')) +
          '"><span lang="ja">' +
          this._esc(example.surface) +
          '</span><small lang="ja">' +
          this._esc(example.reading) +
          '</small></button>';
      }
      return html;
    },

    _findKanaEntry: function (clipId) {
      var lesson = this.currentLesson && this.currentLesson.lesson;
      var sections = (lesson && lesson.phonetic_sections) || [];
      for (var s = 0; s < sections.length; s++) {
        var rows = (sections[s] && sections[s].rows) || [];
        for (var r = 0; r < rows.length; r++) {
          var cells = (rows[r] && rows[r].cells) || [];
          for (var c = 0; c < cells.length; c++) {
            var cell = cells[c];
            if (cell && (cell.id === clipId || (cell.example && cell.example.id === clipId)))
              return { cell: cell, row: rows[r] };
          }
        }
      }
      return null;
    },

    _showKanaDetail: function (button) {
      var section = button.closest('.tb-section-kana');
      var detail = section && section.querySelector('[data-kana-detail]');
      var entry = this._findKanaEntry(button.getAttribute('data-kana-clip'));
      if (!detail || !entry) return;
      var cell = entry.cell;
      var example = cell.example || {};
      var current = section.querySelectorAll('.tb-kana-table .is-selected');
      for (var i = 0; i < current.length; i++) current[i].classList.remove('is-selected');
      button.classList.add('is-selected');
      detail.innerHTML =
        '<div class="tb-kana-detail-head"><strong lang="ja">' +
        this._esc(cell.hiragana + '／' + cell.katakana) +
        '</strong><span>' +
        this._esc(cell.romaji + ' · ' + this._cleanValue(entry.row.label_ja)) +
        '</span></div>' +
        (cell.notes_zh ? '<p>' + this._multiline(cell.notes_zh) + '</p>' : '') +
        (example.surface
          ? '<p class="tb-kana-detail-example"><span lang="ja">' +
            this._esc(example.surface + '（' + example.reading + '）') +
            '</span> ' +
            this._esc(this._cleanValue(example.meaning_zh)) +
            (example.type === 'particle_phrase' ? '<em>助词片段，不是独立词</em>' : '') +
            '</p>' +
            (example.notes_zh ? '<p>' + this._multiline(example.notes_zh) + '</p>' : '')
          : '');
    },

    _renderFoundationNotes: function (lesson) {
      var notes = lesson.notes || [];
      var html =
        '<section class="tb-section tb-section-foundation"><header class="tb-section-head tb-meta-noselect"><span class="tb-section-badge">发音与辨形</span><span class="tb-section-meta">' +
        notes.length +
        ' 条说明</span></header><div class="tb-item-list tb-item-list-embedded">';
      for (var i = 0; i < notes.length; i++) {
        var note = notes[i] || {};
        html +=
          '<details class="tb-item"><summary><div class="tb-item-title-row"><strong class="tb-item-title">' +
          this._esc(this._cleanValue(note.title_zh) || '说明 ' + (i + 1)) +
          '</strong></div></summary><div class="tb-item-body"><p class="tb-foundation-note">' +
          this._multiline(note.text_zh) +
          '</p></div></details>';
      }
      html += '</div>';
      if (lesson.bridge_to_ch01_zh)
        html +=
          '<div class="tb-section-body"><p class="tb-foundation-bridge"><strong>衔接第 1 课</strong>' +
          this._multiline(lesson.bridge_to_ch01_zh) +
          '</p></div>';
      return html + '</section>';
    },

    // Choice labels follow choice_display; a Japanese placeholder such as "—"
    // or identical Japanese strings fall back to the Chinese text.
    _exerciseChoiceLabel: function (item, choice, jaUsable) {
      var ja = this._cleanValue(choice.ja);
      var zh = this._cleanValue(choice.zh);
      var display = item.choice_display;
      if (display === 'zh' || !jaUsable) return '<span>' + this._esc(zh || ja) + '</span>';
      if (display === 'both' && zh && zh !== ja)
        return '<span lang="ja">' + this._esc(ja) + '</span><small>' + this._esc(zh) + '</small>';
      return '<span lang="ja">' + this._esc(ja || zh) + '</span>';
    },

    _renderExerciseSection: function (lesson) {
      var items = this._lessonExercises(lesson);
      if (!items.length) return '';
      var html =
        '<section class="tb-section tb-section-exercises"><header class="tb-section-head tb-meta-noselect"><span class="tb-section-badge">练习</span><span class="tb-section-meta">' +
        items.length +
        ' 题 · 作答不计入存档</span></header><div class="tb-section-body"><ol class="tb-exercise-list">';
      for (var i = 0; i < items.length; i++) html += this._renderExercise(items[i] || {}, i);
      return html + '</ol></div></section>';
    },

    _renderExercise: function (item, index) {
      var choices = item.choices || [];
      var html =
        '<li class="tb-exercise" data-exercise-id="' +
        this._esc(item.id) +
        '"><p class="tb-exercise-prompt">' +
        this._multiline(item.prompt_zh) +
        '</p>' +
        (item.prompt_ja
          ? '<p class="tb-exercise-prompt-ja" lang="ja">' + this._multiline(item.prompt_ja) + '</p>'
          : '');
      if (choices.length) {
        var seen = {};
        var jaUsable = choices.every(function (choice) {
          var ja = String((choice && choice.ja) || '').trim();
          if (!ja || /^[—－-]+$/.test(ja) || seen[ja]) return false;
          seen[ja] = true;
          return true;
        });
        html += '<div class="tb-exercise-choices" role="group" aria-label="第 ' + (index + 1) + ' 题选项">';
        for (var c = 0; c < choices.length; c++) {
          var choice = choices[c] || {};
          html +=
            '<button type="button" class="tb-exercise-choice" data-exercise-choice="' +
            this._esc(choice.id) +
            '"><span class="tb-exercise-choice-key">' +
            String.fromCharCode(65 + c) +
            '</span>' +
            this._exerciseChoiceLabel(item, choice, jaUsable) +
            '</button>';
        }
        html +=
          '</div><div class="tb-exercise-feedback" aria-live="polite" hidden></div>' +
          '<template data-exercise-answer="' +
          this._esc(item.answer) +
          '">' +
          (item.explanation_zh ? '<p>' + this._multiline(item.explanation_zh) + '</p>' : '') +
          '</template>';
      } else {
        html += this._renderExerciseReference(item);
      }
      return html + '</li>';
    },

    _renderExerciseReference: function (item) {
      var answer = item.answer;
      var points =
        item.scoring_points_zh ||
        item.scoring_criteria_zh ||
        (answer && typeof answer === 'object' ? answer.grading_criteria_zh : null) ||
        [];
      var body = '';
      if (item.sample_answer_ja)
        body += '<p class="tb-exercise-sample" lang="ja">' + this._multiline(item.sample_answer_ja) + '</p>';
      if (item.sample_answer_zh) body += '<p>' + this._multiline(item.sample_answer_zh) + '</p>';
      if (typeof answer === 'string' && answer && answer !== item.sample_answer_zh)
        body += '<p>' + this._multiline(answer) + '</p>';
      if (item.sample_answer_note_zh)
        body += '<p class="tb-exercise-note">' + this._multiline(item.sample_answer_note_zh) + '</p>';
      if (points.length) {
        body += '<ul class="tb-exercise-points">';
        for (var i = 0; i < points.length; i++) body += '<li>' + this._esc(points[i]) + '</li>';
        body += '</ul>';
      }
      if (item.explanation_zh)
        body += '<p class="tb-exercise-note">' + this._multiline(item.explanation_zh) + '</p>';
      return (
        '<details class="tb-exercise-reference"><summary>开放题 · 查看参考答案与评分要点</summary>' +
        body +
        '</details>'
      );
    },

    _answerExercise: function (button) {
      var exercise = button.closest('.tb-exercise');
      var template = exercise && exercise.querySelector('template[data-exercise-answer]');
      var feedback = exercise && exercise.querySelector('.tb-exercise-feedback');
      if (!template || !feedback || exercise.classList.contains('is-answered')) return;
      var answer = template.getAttribute('data-exercise-answer');
      var correct = button.getAttribute('data-exercise-choice') === answer;
      var buttons = exercise.querySelectorAll('.tb-exercise-choice');
      for (var i = 0; i < buttons.length; i++) {
        var isAnswer = buttons[i].getAttribute('data-exercise-choice') === answer;
        buttons[i].classList.toggle('is-answer', isAnswer);
        buttons[i].setAttribute('aria-disabled', 'true');
      }
      button.classList.add(correct ? 'is-correct' : 'is-wrong');
      button.setAttribute('aria-pressed', 'true');
      exercise.classList.add('is-answered');
      feedback.hidden = false;
      feedback.className = 'tb-exercise-feedback ' + (correct ? 'is-correct' : 'is-wrong');
      feedback.innerHTML =
        '<strong>' +
        (correct ? '回答正确' : '再看一下：正确答案已标出') +
        '</strong>' +
        template.innerHTML +
        '<button type="button" class="tb-exercise-retry" data-exercise-retry>重做本题</button>';
    },

    _resetExercise: function (button) {
      var exercise = button.closest('.tb-exercise');
      if (!exercise) return;
      exercise.classList.remove('is-answered');
      var buttons = exercise.querySelectorAll('.tb-exercise-choice');
      for (var i = 0; i < buttons.length; i++) {
        buttons[i].classList.remove('is-answer', 'is-correct', 'is-wrong');
        buttons[i].removeAttribute('aria-disabled');
        buttons[i].removeAttribute('aria-pressed');
      }
      var feedback = exercise.querySelector('.tb-exercise-feedback');
      if (feedback) {
        feedback.hidden = true;
        feedback.innerHTML = '';
      }
      if (buttons[0]) buttons[0].focus();
    },

    _renderTranslation: function (text) {
      if (!this.showTranslations || this.textDisplayMode === 'plain' || !this._cleanValue(text)) return '';
      return '<p class="tb-translation" lang="zh-CN">' + this._multiline(text) + '</p>';
    },

    // Body/application units are the paragraphs of section.text in order; only
    // when they line up exactly do translations and scene notes attach to them.
    _renderUnitParagraphs: function (section, sectionKey, highlightMode) {
      var units = (section && section.original_units) || [];
      if (!units.length) return '';
      var parts = this._splitParagraphs(section.text);
      if (parts.length !== units.length) return '';
      for (var i = 0; i < units.length; i++) {
        if (this._cleanValue(units[i] && units[i].ja) !== parts[i]) return '';
      }
      var html = '';
      for (var j = 0; j < units.length; j++) {
        var unit = units[j];
        html +=
          '<div class="tb-unit" data-unit-id="' +
          this._esc(unit.id) +
          '">' +
          (this.showTranslations && unit.setting_zh && this.textDisplayMode !== 'plain'
            ? '<p class="tb-scene-note">' + this._multiline(unit.setting_zh) + '</p>'
            : '') +
          '<p class="tb-paragraph" lang="ja">' +
          this._renderMaybeChunkedText(parts[j], sectionKey, null, highlightMode) +
          '</p>' +
          this._renderTranslation(unit.zh) +
          '</div>';
      }
      return html;
    },

    _dialogueTurnTranslation: function (turnIndex) {
      var rows = this.currentTextChunks || [];
      var parts = [];
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i] || {};
        if (row.section === 'conversation' && row.turn_index === turnIndex && row.translation_zh)
          parts.push(this._cleanValue(row.translation_zh));
      }
      return parts.join('');
    },

    _dialogueSceneNote: function (section, turn, previousTurn) {
      if (!this.showTranslations || this.textDisplayMode === 'plain') return '';
      var turns = (section && section.original_turns) || [];
      var scenes = (section && section.original_scenes) || [];
      if (!turns.length || !scenes.length) return '';
      var sceneOf = function (value) {
        if (!value) return '';
        for (var i = 0; i < turns.length; i++) if (turns[i].id === value.turn_id) return turns[i].scene_id;
        return '';
      };
      var sceneId = sceneOf(turn);
      if (!sceneId || sceneId === sceneOf(previousTurn)) return '';
      for (var j = 0; j < scenes.length; j++) {
        if (scenes[j].id !== sceneId) continue;
        return (
          '<p class="tb-scene-note tb-scene-note-dialogue">' +
          (scenes[j].title_zh ? '<strong>' + this._esc(scenes[j].title_zh) + '</strong>' : '') +
          this._multiline(scenes[j].setting_zh) +
          '</p>'
        );
      }
      return '';
    },

    // KotobaFlow grammar points read as a textbook page: the long explanation
    // keeps its own structure (line breaks, 【小节】 headings, ①② lists) and
    // examples pair with their translations under the translation switch.
    _renderCurriculumGrammarSection: function (section, fallbackTitle) {
      var items = (section && section.items) || [];
      var html =
        '<section class="tb-section tb-section-grammar tb-section-cgrammar"><header class="tb-section-head tb-meta-noselect"><span class="tb-section-badge">' +
        this._esc(this._cleanValue(section.title) || fallbackTitle) +
        '</span><span class="tb-section-meta">' +
        items.length +
        ' 个语法点</span></header><div class="tb-section-body">';
      for (var i = 0; i < items.length; i++) html += this._renderCurriculumGrammarItem(items[i] || {}, i);
      return html + '</div></section>';
    },

    _renderCurriculumGrammarItem: function (item, index) {
      var source = item.original_g || {};
      var role = GRAMMAR_ROLES[source.role] || '';
      var examples =
        source.examples && source.examples.length
          ? source.examples
          : (item.examples || []).map(function (ja) {
              return { ja: ja };
            });
      var showZh = this.showTranslations && this.textDisplayMode !== 'plain';
      var html =
        '<article class="tb-cgrammar" data-grammar-uid="' +
        this._esc(item.uid) +
        '"><header class="tb-cgrammar-head"><span class="tb-cgrammar-no" aria-hidden="true">' +
        (index + 1) +
        '</span><h3 class="tb-cgrammar-form" lang="ja">' +
        this._esc(this._cleanValue(item.point) || this._cleanValue(source.form) || item.uid) +
        '</h3>' +
        (role
          ? '<span class="tb-cgrammar-role" data-role="' + this._esc(source.role) + '">' + role + '</span>'
          : '') +
        '</header>' +
        this._renderCurriculumGrammarText(item.description || source.explanation_zh);
      if (examples.length) {
        html += '<ol class="tb-cgrammar-examples" aria-label="例句">';
        for (var i = 0; i < examples.length; i++) {
          var example = examples[i] || {};
          if (!this._cleanValue(example.ja)) continue;
          html +=
            '<li><p class="tb-cgrammar-example-ja" lang="ja">' +
            this._formatText(this._cleanValue(example.ja), 'clickable') +
            '</p>' +
            (showZh && this._cleanValue(example.zh)
              ? '<p class="tb-cgrammar-example-zh">' + this._esc(this._cleanValue(example.zh)) + '</p>'
              : '') +
            '</li>';
        }
        html += '</ol>';
      }
      return html + '</article>';
    },

    _renderCurriculumGrammarText: function (text) {
      var paragraphs = this._cleanValue(text).split(/\n+/);
      var html = '';
      for (var i = 0; i < paragraphs.length; i++) {
        // ['lead', 'heading', 'text', 'heading', 'text', ...]
        var parts = paragraphs[i].split(/【([^】]{1,24})】/);
        html += this._renderCurriculumGrammarChunk(parts[0]);
        for (var j = 1; j < parts.length; j += 2) {
          html +=
            '<h4 class="tb-cgrammar-subhead">' +
            this._esc(parts[j]) +
            '</h4>' +
            this._renderCurriculumGrammarChunk(parts[j + 1]);
        }
      }
      return html ? '<div class="tb-cgrammar-text">' + html + '</div>' : '';
    },

    // Circled numbers (①②…) inside a paragraph become a list; a short label
    // before the first colon of an item is set in bold.
    _renderCurriculumGrammarChunk: function (text) {
      var value = String(text || '').trim();
      if (!value) return '';
      var pieces = value.split(/(?=[①-⑳])/);
      var lead = /^[①-⑳]/.test(pieces[0]) ? '' : pieces.shift();
      if (pieces.length < 2) return '<p>' + this._esc(value) + '</p>';
      var html = lead.trim() ? '<p>' + this._esc(lead.trim()) + '</p>' : '';
      html += '<ul class="tb-cgrammar-points">';
      for (var i = 0; i < pieces.length; i++) {
        var body = pieces[i].slice(1).trim();
        var label = body.match(/^([^：:，。；]{1,10})[：:]\s*([\s\S]*)$/);
        html +=
          '<li><span class="tb-cgrammar-mark" aria-hidden="true">' +
          pieces[i].charAt(0) +
          '</span><span>' +
          (label ? '<strong>' + this._esc(label[1]) + '</strong>：' + this._esc(label[2]) : this._esc(body)) +
          '</span></li>';
      }
      return html + '</ul>';
    },

    _renderTranslationToggle: function () {
      var lesson = this.currentLesson && this.currentLesson.lesson;
      if (!this._lessonHasTranslations(lesson)) return '';
      return (
        '<button type="button" class="btn-secondary tb-translation-toggle" data-translation-toggle aria-pressed="' +
        (this.showTranslations ? 'true' : 'false') +
        '">' +
        uiIcon(this.showTranslations ? 'eye-off' : 'eye') +
        (this.showTranslations ? '隐藏中文译文与场景' : '显示中文译文与场景') +
        '</button>'
      );
    },
  });
})(window);
