(function (root) {
  'use strict';

  var app = root.JPLearn || (root.JPLearn = {});

  app.textbookVocabMethods = Object.freeze({
    _renderDetail: function () {
      if (window.JPLearn.anchoredDetail) window.JPLearn.anchoredDetail.close('lesson', false);
      this.detailEl.innerHTML =
        '<div class="panel-empty-state">' +
        uiIcon('info') +
        '<strong>选择课文词汇查看详情</strong><p>点击正文中的词汇高亮或“本课词汇”章节中的词条后，这里会显示完整释义。</p></div>';
      this._bindDetailEvents();
      this._syncTtsButtonState();
    },

    _renderReadingVocabSection: function () {
      if (!this.currentVocab.length) return '';
      var html =
        '<section class="tb-section tb-reading-vocab-section" data-reading-vocab-section tabindex="-1">' +
        '<header class="tb-section-head tb-meta-noselect"><span class="tb-section-badge">本课词汇</span>' +
        '<span class="tb-section-meta">' +
        this.currentVocab.length +
        ' 个 · 点击查看详情</span></header>' +
        this._renderVocabLoopControls() +
        '<div class="tb-reading-vocab-list" role="list">';
      for (var i = 0; i < this.currentVocab.length; i++) {
        var row = this.currentVocab[i] || {};
        var word = this._cleanValue(row.word || row.label || '-');
        var subline = this._buildItemSubline(
          this._cleanValue(row.reading_hiragana),
          this._getVocabMeaningZh(row),
        );
        html +=
          '<div class="tb-reading-vocab-row" id="' +
          this._esc(this._buildVocabAnchorId(i)) +
          '" data-vocab-entry="1" data-vocab-index="' +
          i +
          '" role="listitem"><button type="button" class="tb-reading-vocab-open" data-vocab-detail-index="' +
          i +
          '" aria-label="查看词汇详情：' +
          this._esc(word) +
          '"><span class="tb-reading-vocab-word" lang="ja">' +
          this._esc(word) +
          '</span><span class="tb-reading-vocab-sub">' +
          this._esc(subline) +
          '</span></button>' +
          this._renderVocabTitleMeta(row, i) +
          '</div>';
      }
      return html + '</div></section>';
    },

    _showVocabDetail: function (index, anchor, focusPopup) {
      index = parseInt(index, 10);
      var row = this.currentVocab[index];
      if (!row || !this.detailEl) return;
      // Example links are removed by the detail render below. Keep the original
      // reading anchor and its return focus when looking up a word inside it.
      var preserveAnchor = !!(anchor && anchor.nodeType === 1 && this.detailEl.contains(anchor));
      var word = this._cleanValue(row.word || row.label || '-');
      var reading = this._cleanValue(row.reading_hiragana);
      var level = this._cleanValue(row.level);
      var title = document.getElementById('textbookDetailPanelTitle');
      if (title) title.textContent = '课文词汇详情';
      this.detailEl.innerHTML =
        '<article class="tb-vocab-popup-entry" data-popup-vocab-index="' +
        index +
        '"><header class="tb-vocab-popup-head"><div><h3 lang="ja">' +
        this._esc(word) +
        '</h3>' +
        (reading ? '<p lang="ja">' + this._esc(reading) + '</p>' : '') +
        '</div>' +
        (level ? '<span class="tb-item-level">' + this._esc(level) + '</span>' : '') +
        '</header><div class="tb-vocab-popup-body">' +
        this._renderVocabDetailBody(row) +
        '</div></article>';
      this._bindDetailEvents();
      this._syncTtsButtonState();
      var rows = this.readerEl ? this.readerEl.querySelectorAll('.tb-reading-vocab-row') : [];
      for (var i = 0; i < rows.length; i++) {
        rows[i].classList.toggle(
          'tb-item-focus',
          parseInt(rows[i].getAttribute('data-vocab-index'), 10) === index,
        );
      }
      if (window.PanelLayout) {
        window.PanelLayout.expandDetail('lesson', anchor, {
          focus: !!focusPopup,
          preserveAnchor: preserveAnchor,
        });
      }
    },

    _renderVocabLoopControls: function () {
      if (!this.currentVocab.length) return '';
      return (
        '<div class="tb-vocab-loop-bar">' +
        '<button class="tb-tts-btn tb-vocab-loop-btn" type="button" data-tts-mode="vocab-loop" data-start-text="顺序朗读" data-stop-text="停止顺序朗读">' +
        uiIcon('play') +
        '顺序朗读</button>' +
        this._renderTtsFeedback('vocab-loop', this._getVocabLoopIdleText()) +
        '</div>'
      );
    },

    _renderVocabTitleMeta: function (row, index) {
      var level = this._cleanValue(row && row.level) || '-';
      return (
        '<span class="tb-item-meta-stack">' +
        '<span class="tb-item-level">' +
        this._esc(level) +
        '</span>' +
        '<button class="tb-tts-btn tb-item-start-loop-btn" type="button" data-tts-mode="vocab-loop-from:' +
        index +
        '" data-start-text="从此朗读" data-stop-text="停止顺序朗读" title="从这个词开始顺序朗读" aria-label="从这个词开始顺序朗读">' +
        uiIcon('play') +
        '从此朗读</button>' +
        '</span>'
      );
    },

    _getVocabV4: function (row) {
      return (row && row.v4_enrichment) || {};
    },

    _getJitendexOverlay: function (row) {
      return (row && row.jitendex_overlay) || {};
    },

    _getVocabSenses: function (row) {
      var senses = ((row && row.learning_enrichment) || this._getVocabV4(row)).senses || [];
      return Array.isArray(senses) ? senses : [];
    },

    _getVocabMeaningZh: function (row) {
      var senses = this._getVocabSenses(row);
      var first = senses.length ? this._cleanValue(senses[0] && senses[0].meaning_zh) : '';
      if (first) return first;
      if (row && row.meanings_zh && row.meanings_zh.length)
        return this._cleanValue(row.meanings_zh.join('；'));
      return this._cleanValue(row && row.meaning) || '暂无释义';
    },

    _getVocabPosLabel: function (row) {
      var metadata = this._getLexicalMetadataLabels(row);
      if (metadata.pos) return metadata.pos;
      var learning = row && row.learning_enrichment;
      if (learning && (learning.pos_ja || learning.pos_zh))
        return [this._cleanValue(learning.pos_ja), this._cleanValue(learning.pos_zh)]
          .filter(Boolean)
          .join(' / ');
      var v4 = this._getVocabV4(row);
      var ja = this._cleanValue(v4.display_pos_ja);
      var zh = this._cleanValue(v4.display_pos_zh);
      if (ja && zh && ja !== zh) return ja + ' / ' + zh;
      if (ja) return ja;
      if (zh) return zh;
      return this._cleanValue(row && row.grammar);
    },

    _getLexicalMetadataLabels: function (row) {
      var api = window.JPLearn && window.JPLearn.lexicalMetadata;
      if (!api || !row) return {};
      var labels = {};
      if (row.pos) {
        labels.pos = api.posLabel(row.pos, 'zh');
        labels.conjugation = api.conjugationLabel(row.pos, 'zh');
      }
      if (row.transitivity) labels.transitivity = api.transitivityLabel(row.transitivity, 'zh');
      if (row.register) labels.register = api.registerLabel(row.register, 'zh');
      if (row.style) labels.style = api.styleLabel(row.style, 'zh');
      Object.keys(labels).forEach(function (key) {
        labels[key] = typeof labels[key] === 'string' ? labels[key] : '';
      });
      return labels;
    },

    _getLegacyVocabMetadataLabels: function (row) {
      var v4 = this._getVocabV4(row);
      var learning = (row && row.learning_enrichment) || {};
      return {
        conjugation: this._cleanValue(v4.conjugation_class_ja) || this._cleanValue(learning.conjugation_ja),
        transitivity:
          this._cleanValue(v4.transitivity_label_zh) || this._cleanValue(learning.transitivity_zh),
        register: this._cleanValue(learning.register_zh),
        style: '',
      };
    },

    _getVocabMainExample: function (row) {
      var senses = this._getVocabSenses(row);
      for (var i = 0; i < senses.length; i++) {
        var sense = senses[i] || {};
        if (this._cleanValue(sense.example_ja) || this._cleanValue(sense.example_zh)) {
          return {
            ja: this._cleanValue(sense.example_ja),
            zh: this._cleanValue(sense.example_zh),
          };
        }
      }
      if (row && row.example_sentences && row.example_sentences.length) {
        var ex = row.example_sentences[0] || {};
        if (typeof ex === 'string') return { ja: this._cleanValue(ex), zh: '' };
        return { ja: this._cleanValue(ex.ja), zh: this._cleanValue(ex.zh) };
      }
      return {
        ja: this._cleanValue(row && row.example_sentence_ja),
        zh: this._cleanValue(row && row.example_sentence_zh),
      };
    },

    _renderVocabList: function () {
      if (!this.currentVocab.length) return '<div class="tb-detail-empty">本课暂无可显示词汇</div>';
      var html = '<div class="tb-item-list">';
      for (var i = 0; i < this.currentVocab.length; i++) {
        var row = this.currentVocab[i] || {};
        var word = this._cleanValue(row.word || row.label || '-');
        html +=
          '<details class="tb-item" id="' +
          this._esc(this._buildVocabAnchorId(i)) +
          '" data-vocab-entry="1" data-vocab-word="' +
          this._esc(word) +
          '"><summary><div class="tb-item-title-row"><strong class="tb-item-title">' +
          this._esc(word) +
          '</strong>' +
          this._renderVocabTitleMeta(row, i) +
          '</div><div class="tb-item-sub">' +
          this._esc(
            this._buildItemSubline(this._cleanValue(row.reading_hiragana), this._getVocabMeaningZh(row)),
          ) +
          '</div></summary><div class="tb-item-body">' +
          this._renderVocabDetailBody(row) +
          '</div></details>';
      }
      return html + '</div>';
    },

    _renderVocabDetailBody: function (row) {
      var html = this._renderVocabReadingRow(row);
      if (row.association_review && row.association_review.status === 'pending') {
        html += this._detailRow('关联待核对', '当前保留教材原词与原义，暂不加入本课复习。');
      }
      var posLabel = this._getVocabPosLabel(row);
      var level = this._cleanValue(row && row.level);
      var metadata = this._getLexicalMetadataLabels(row);
      var legacy = this._getLegacyVocabMetadataLabels(row);
      var conjugation = metadata.conjugation || legacy.conjugation;
      var transitivity = metadata.transitivity || legacy.transitivity;
      var register = metadata.register || legacy.register;
      var style = metadata.style || legacy.style;

      html += this._renderVocabSenses(row);
      html += this._renderJitendexGlosses(row);
      if (posLabel) html += this._detailRow('词性', posLabel);
      if (level) html += this._detailRow('等级', level);
      if (conjugation && conjugation !== 'なし' && conjugation !== '不适用' && conjugation !== '未确定')
        html += this._detailRow('活用', conjugation);
      if (transitivity && transitivity !== 'なし' && transitivity !== '不适用' && transitivity !== '未确定')
        html += this._detailRow('自他', transitivity);
      html += this._renderVocabMainExample(row);
      if (register) html += this._detailRow('语体', register);
      if (style) html += this._detailRow('用法倾向', style);
      if (row.learning_enrichment) {
        var enrichment = row.learning_enrichment;
        html += '<div class="tb-subtitle">常用搭配</div>';
        html += this._renderExamples(enrichment.collocations, 'clickable', false);
        html += this._detailRow('用法提示', enrichment.usage_note_zh);
      }
      html += this._renderVocabEtymology(row);
      html += this._renderVocabExternalLinks(row);
      return html;
    },

    _renderJitendexGlosses: function (row) {
      var overlay = this._getJitendexOverlay(row);
      var glosses = Array.isArray(overlay.defaultDisplayGlosses) ? overlay.defaultDisplayGlosses : [];
      var html = '';
      var rendered = 0;
      if (!glosses.length) return '';
      html += '<div class="tb-subtitle">词典释义</div>';
      for (var i = 0; i < glosses.length && rendered < 6; i++) {
        var gloss = glosses[i] || {};
        var zh = this._cleanValue(gloss.zh);
        var flags = Array.isArray(gloss.flags) ? gloss.flags : [];
        if (!zh || flags.length) continue;
        rendered++;
        html +=
          '<div class="tb-example"><div class="tb-example-zh"><strong>' +
          rendered +
          '. ' +
          this._esc(zh) +
          '</strong></div></div>';
      }
      if (!rendered) return '';
      return html;
    },

    _renderVocabSenses: function (row) {
      var senses = this._getVocabSenses(row);
      var html = '';
      if (!senses.length) {
        html += this._detailRow('释义', this._getVocabMeaningZh(row));
        if (this._cleanValue(row && row.definition_ja_brief))
          html += this._detailRow('日语释义', this._cleanValue(row.definition_ja_brief), 'ja');
        return html;
      }
      if (senses.length === 1) {
        var sense = senses[0] || {};
        html += this._detailRow('释义', this._cleanValue(sense.meaning_zh) || this._getVocabMeaningZh(row));
        if (this._cleanValue(sense.meaning_ja))
          html += this._detailRow('日语释义', this._cleanValue(sense.meaning_ja), 'ja');
        else if (this._cleanValue(row && row.definition_ja_brief))
          html += this._detailRow('日语释义', this._cleanValue(row.definition_ja_brief), 'ja');
        return html;
      }
      html += '<div class="tb-subtitle">义项</div>';
      for (var i = 0; i < senses.length && i < 3; i++) {
        var item = senses[i] || {};
        var zh = this._cleanValue(item.meaning_zh);
        var ja = this._cleanValue(item.meaning_ja);
        if (!zh && !ja) continue;
        html +=
          '<div class="tb-example"><div class="tb-example-zh"><strong>' +
          (i + 1) +
          '. ' +
          this._esc(zh || '暂无释义') +
          '</strong></div>';
        if (ja) html += '<div class="tb-example-ja" lang="ja">' + this._esc(ja) + '</div>';
        html += '</div>';
      }
      return html;
    },

    _renderVocabMainExample: function (row) {
      if (row.learning_enrichment) {
        var html = '<div class="tb-subtitle">课内例句</div>';
        html += this._renderExamples(row.example_sentences || [], 'clickable', false);
        var senses = row.learning_enrichment.senses;
        for (var i = 0; i < senses.length; i++) {
          html +=
            '<div class="tb-subtitle">补充例句' + (senses.length > 1 ? ' · 义项 ' + (i + 1) : '') + '</div>';
          html += this._renderExamples(
            [{ ja: senses[i].example_ja, zh: senses[i].example_zh }],
            'clickable',
            false,
          );
        }
        return html;
      }
      var example = this._getVocabMainExample(row);
      if (!example.ja && !example.zh) return '';
      return (
        '<div class="tb-subtitle">例句</div><div class="tb-example">' +
        (example.ja
          ? '<div class="tb-example-ja">' + this._formatText(example.ja, 'clickable') + '</div>'
          : '') +
        (example.zh ? '<div class="tb-example-zh">' + this._esc(example.zh) + '</div>' : '') +
        '</div>'
      );
    },

    _renderVocabEtymology: function (row) {
      var etymology = this._getVocabV4(row).etymology || {};
      var html = '';
      var parts = Array.isArray(etymology.parts) ? etymology.parts : [];
      if (etymology.recommended_for_card !== true) return '';
      if (this._cleanValue(etymology.summary_zh))
        html += this._detailRow('词源', this._cleanValue(etymology.summary_zh));
      for (var i = 0; i < parts.length; i++) {
        var part = parts[i] || {};
        var label = this._cleanValue(part.surface || part.kanji);
        var value = this._buildItemSubline(this._cleanValue(part.meaning_zh), this._cleanValue(part.note_zh));
        if (label && value && value !== '-') html += this._detailRow(label, value);
      }
      return html;
    },

    _renderVocabExternalLinks: function (row) {
      var links = this._getVocabV4(row).external_links || {};
      var html = '';
      if (links.jawiki && this._cleanValue(links.jawiki.url)) {
        html +=
          '<a href="' +
          this._esc(links.jawiki.url) +
          '" target="_blank" rel="noopener noreferrer">日语维基</a>';
      }
      if (links.jawiktionary && this._cleanValue(links.jawiktionary.url)) {
        html +=
          (html ? ' ' : '') +
          '<a href="' +
          this._esc(links.jawiktionary.url) +
          '" target="_blank" rel="noopener noreferrer">维基词典</a>';
      }
      return html ? this._detailRowHtml('外链', html) : '';
    },

    _renderExamples: function (examples, highlightMode, showHeading) {
      if (!examples || !examples.length) return '';
      var mode = highlightMode || 'clickable';
      var html = showHeading === false ? '' : '<div class="tb-subtitle">例句</div>';
      for (var i = 0; i < examples.length; i++) {
        var example = examples[i];
        if (typeof example === 'string')
          html +=
            '<div class="tb-example"><div class="tb-example-ja">' +
            this._formatText(example, mode) +
            '</div></div>';
        else
          html +=
            '<div class="tb-example">' +
            (example && example.ja
              ? '<div class="tb-example-ja">' + this._formatText(example.ja, mode) + '</div>'
              : '') +
            (example && example.zh
              ? '<div class="tb-example-zh">' + this._esc(this._cleanValue(example.zh)) + '</div>'
              : '') +
            '</div>';
      }
      return html;
    },

    _buildItemSubline: function (reading, meaning) {
      var parts = [];
      if (reading) parts.push(reading);
      if (meaning) parts.push(meaning);
      return parts.length ? parts.join(' · ') : '-';
    },

    _buildVocabAnchorId: function (index) {
      return (
        'tb-vocab-' +
        this._toDomToken(this.currentBookId) +
        '-' +
        this._toDomToken(this.currentLessonId) +
        '-' +
        index
      );
    },

    _buildVocabTargetMap: function () {
      var map = {};
      for (var i = 0; i < this.currentVocab.length; i++) {
        var row = this.currentVocab[i] || {};
        var word = this._cleanValue(row.word || row.label || '');
        if (!word || map[word]) continue;
        map[word] = {
          word: word,
          anchorId: this._buildVocabAnchorId(i),
        };
      }
      return map;
    },

    _expandTextbookDetailPanel: function (anchor, options) {
      if (window.PanelLayout) window.PanelLayout.expandDetail('lesson', anchor, options);
    },

    _jumpToVocabEntry: function (anchorId, trigger, focusPopup) {
      if (!anchorId || !this.detailEl) return;
      var item = document.getElementById(anchorId);
      if (!item) return;
      this._showVocabDetail(parseInt(item.getAttribute('data-vocab-index'), 10), trigger || item, focusPopup);
    },

    _invalidateHighlightCache: function () {
      this._highlightEntries = [];
      this._highlightCacheKey = '';
    },

    _getHighlightEntries: function () {
      var key =
        this.currentBookId +
        '::' +
        this.currentLessonId +
        '::' +
        this.currentVocab.length +
        '::' +
        this.currentGrammar.length;
      if (this._highlightCacheKey === key) return this._highlightEntries;
      var seen = {},
        entries = [];
      var vocabTargets = this._buildVocabTargetMap();
      for (var i = 0; i < this.currentVocab.length; i++) {
        var vocabWord = this.currentVocab[i].word || this.currentVocab[i].label || '';
        var target = vocabTargets[this._cleanValue(vocabWord)] || null;
        this._appendHighlight(entries, seen, vocabWord, vocabWord, {
          type: 'vocab',
          anchorId: target ? target.anchorId : '',
        });
      }
      for (var j = 0; j < this.currentGrammar.length; j++) {
        var point = this.currentGrammar[j] || {},
          enriched = point.enriched || {},
          terms = enriched.highlight_terms || [];
        for (var k = 0; k < terms.length; k++)
          this._appendHighlight(
            entries,
            seen,
            terms[k],
            (point.title || enriched.clean_title || point.uid || '语法') +
              (enriched.core_meaning_zh ? ' / ' + enriched.core_meaning_zh : ''),
            { type: 'grammar' },
          );
      }
      entries.sort(function (a, b) {
        return b.word.length !== a.word.length
          ? b.word.length - a.word.length
          : a.word.localeCompare(b.word, 'ja');
      });
      this._highlightEntries = entries;
      this._highlightCacheKey = key;
      return entries;
    },

    _appendHighlight: function (entries, seen, rawWord, title, meta) {
      var word = this._cleanValue(rawWord);
      if (
        !word ||
        word.length < 2 ||
        /\s/.test(word) ||
        /^[A-Za-z0-9._-]+$/.test(word) ||
        /[~\[\]（）()]/.test(word) ||
        seen[word]
      )
        return;
      entries.push({
        word: word,
        title: this._cleanValue(title || word) || word,
        type: meta && meta.type ? meta.type : '',
        anchorId: meta && meta.anchorId ? meta.anchorId : '',
      });
      seen[word] = true;
    },

    _highlightText: function (text, mode) {
      var raw = String(text || ''),
        entries = this._getHighlightEntries();
      if (!entries.length || !raw) return this._esc(raw);
      var clickable = mode === 'clickable';
      var html = '',
        index = 0;
      while (index < raw.length) {
        var match = null;
        for (var i = 0; i < entries.length; i++)
          if (raw.substr(index, entries[i].word.length) === entries[i].word) {
            match = entries[i];
            break;
          }
        if (match) {
          var typeClass =
            match.type === 'grammar' ? ' tb-inline-highlight-grammar' : ' tb-inline-highlight-vocab';
          if (clickable && match.type === 'vocab' && match.anchorId)
            html +=
              '<button type=\"button\" class=\"tb-inline-highlight tb-inline-highlight-link' +
              typeClass +
              '\" data-vocab-anchor=\"' +
              this._esc(match.anchorId) +
              '\" title=\"' +
              this._esc(match.title) +
              '\" aria-label=\"查看词汇详情：' +
              this._esc(match.word) +
              '\">' +
              this._esc(match.word) +
              '</button>';
          else
            html +=
              '<mark class=\"tb-inline-highlight' +
              typeClass +
              '\" title=\"' +
              this._esc(match.title) +
              '\">' +
              this._esc(match.word) +
              '</mark>';
          index += match.word.length;
        } else {
          html += this._esc(raw.charAt(index));
          index += 1;
        }
      }
      return html;
    },

    _formatText: function (text, highlightMode) {
      var lines = this._cleanValue(text).split(/\n/),
        html = [];
      if (this.textDisplayMode === 'plain') highlightMode = false;
      var mode = highlightMode === 'clickable' ? 'clickable' : highlightMode ? 'mark' : '';
      for (var i = 0; i < lines.length; i++)
        html.push(mode ? this._highlightText(lines[i], mode) : this._esc(lines[i]));
      return html.join('<br>');
    },

    _splitParagraphs: function (text) {
      var raw = this._cleanValue(text).replace(/\r\n?/g, '\n');
      if (!raw) return [];
      return raw
        .split(/\n{2,}/)
        .map(function (part) {
          return part.trim();
        })
        .filter(Boolean);
    },

    _renderVocabReadingRow: function (row) {
      var reading = this._cleanValue(row && row.reading_hiragana) || '-';
      var word = this._cleanValue((row && (row.word || row.label)) || reading);
      var index = parseInt(row && row.index, 10);
      var hasAudio = !isNaN(index) && index > 0 && row.audio_available !== false;
      var html =
        '<div class="tb-detail-row"><span class="tb-detail-label">读音</span><span class="tb-detail-value tb-detail-value-wrap"><span class="tb-detail-value-text" lang="ja">' +
        this._esc(reading) +
        '</span>';
      if (hasAudio) {
        html +=
          '<button class="tb-tts-btn tb-tts-btn-mini tb-vocab-audio-btn" type="button" data-tts-mode="vocab:' +
          this._esc(index) +
          '" data-start-text="" data-stop-text="" aria-label="播放词汇读音：' +
          this._esc(word) +
          '" title="播放读音">' +
          uiIcon('play') +
          '</button>';
      }
      html += '</span></div>';
      return html;
    },

    _detailRow: function (label, value, lang) {
      if (label === '说明' && this._cleanValue(value).indexOf('●') !== -1) {
        return this._detailRowHtml(label, this._renderBulletDescription(this._cleanValue(value)));
      }
      return (
        '<div class=\"tb-detail-row\"><span class=\"tb-detail-label\">' +
        this._esc(label) +
        '</span><span class=\"tb-detail-value\"' +
        (lang ? ' lang="' + this._esc(lang) + '"' : '') +
        '>' +
        this._esc(value) +
        '</span></div>'
      );
    },

    _detailRowHtml: function (label, html) {
      return (
        '<div class=\"tb-detail-row\"><span class=\"tb-detail-label\">' +
        this._esc(label) +
        '</span><span class=\"tb-detail-value\">' +
        (html || '') +
        '</span></div>'
      );
    },

    _renderBulletDescription: function (value) {
      var parts = String(value || '').split('●');
      var html = '';
      var lead = this._cleanValue(parts.shift());
      if (lead) html += '<div class="tb-grammar-desc-lead">' + this._esc(lead) + '</div>';
      var items = [];
      for (var i = 0; i < parts.length; i++) {
        var item = this._cleanValue(parts[i]);
        if (item) items.push('<li>' + this._esc(item) + '</li>');
      }
      if (items.length) html += '<ul class="tb-grammar-bullet-list">' + items.join('') + '</ul>';
      return html || this._esc(value);
    },
  });
})(window);
