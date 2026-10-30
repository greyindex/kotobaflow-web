(function (root) {
  'use strict';

  var app = root.JPLearn || (root.JPLearn = {});

  app.textbookTextMethods = Object.freeze({
    // UI-SMALL-01: a long section title (a KotobaFlow reading unit) already sits
    // in the heading above, so its read-aloud button says only 朗读本段.
    _ttsSectionButton: function (ttsMode, sectionTitle) {
      var label = '朗读' + sectionTitle;
      var short = sectionTitle.length > 6 ? '朗读本段' : label;
      return (
        '<button class="tb-tts-btn" type="button" data-tts-mode="' +
        this._esc(ttsMode) +
        '" data-start-text="' +
        this._esc(short) +
        '" data-stop-text="停止朗读"' +
        (short === label ? '' : ' title="' + this._esc(label) + '"') +
        '>' +
        uiIcon('play') +
        this._esc(short) +
        '</button>'
      );
    },

    _renderTextSection: function (section, fallbackTitle, opts) {
      if (
        !section ||
        (!this._cleanValue(section.text) &&
          !this._cleanValue(section.subtitle) &&
          !this._cleanValue(section.image_path))
      )
        return '';
      var ttsMode = opts && opts.ttsMode ? this._cleanValue(opts.ttsMode) : '';
      var lesson = opts && opts.lesson ? opts.lesson : null;
      var highlightMode = opts && opts.highlightMode ? opts.highlightMode : true;
      var sectionKey = opts && opts.sectionKey ? this._cleanValue(opts.sectionKey) : '';
      var sectionTitle = this._cleanValue(section.title) || fallbackTitle;
      var imageConfig = this._resolveSectionImageConfig(section, sectionTitle, lesson);
      var html =
        '<section class="tb-section"' +
        (ttsMode ? ' data-tts-mode="' + this._esc(ttsMode) + '"' : '') +
        '><header class="tb-section-head tb-meta-noselect"><span class="tb-section-badge" lang="' +
        (TextbookLoader.isKotobaBook(this.currentBookId) && section.title ? 'ja' : 'zh-CN') +
        '">' +
        this._esc(sectionTitle) +
        '</span>';
      if (section.subtitle)
        html += '<span class="tb-section-meta">' + this._esc(this._cleanValue(section.subtitle)) + '</span>';
      if (ttsMode)
        html +=
          '<div class="tb-section-actions">' +
          this._ttsSectionButton(ttsMode, sectionTitle) +
          this._renderTtsFeedback(ttsMode, '') +
          '</div>';
      html += '</header><div class="tb-section-body">';
      if (imageConfig && imageConfig.position !== 'lesson_header')
        html += this._renderResolvedSectionImage(imageConfig);
      var unitHtml = this._renderUnitParagraphs(section, sectionKey, highlightMode);
      var parts = unitHtml ? [] : this._splitParagraphs(section.text);
      html += unitHtml;
      for (var i = 0; i < parts.length; i++)
        html +=
          '<p class="tb-paragraph" lang="ja">' +
          this._renderMaybeChunkedText(parts[i], sectionKey, null, highlightMode) +
          '</p>';
      html += '</div></section>';
      return html;
    },

    _renderMaybeChunkedText: function (text, sectionKey, turnIndex, fallbackHighlightMode) {
      var raw = this._cleanValue(text);
      if (this.textDisplayMode === 'plain') return this._esc(raw);
      if (this.textDisplayMode !== 'chunks' || !raw || !sectionKey)
        return this._formatText(raw, fallbackHighlightMode);
      var sentences = this._getChunkSentences(sectionKey, turnIndex);
      if (!sentences.length) return this._formatText(raw, fallbackHighlightMode);
      return this._renderChunkedText(raw, sentences, fallbackHighlightMode);
    },

    _getChunkSentences: function (sectionKey, turnIndex) {
      var rows = this.currentTextChunks || [];
      var matched = [];
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i] || {};
        if (row.section !== sectionKey) continue;
        if (turnIndex !== null && turnIndex !== undefined && row.turn_index !== turnIndex) continue;
        if ((turnIndex === null || turnIndex === undefined) && row.role !== 'section_text') continue;
        matched.push(row);
      }
      matched.sort(function (a, b) {
        if ((a.turn_index || 0) !== (b.turn_index || 0)) return (a.turn_index || 0) - (b.turn_index || 0);
        return (a.sentence_index || 0) - (b.sentence_index || 0);
      });
      return matched;
    },

    _renderChunkedText: function (text, sentences, fallbackHighlightMode) {
      var html = '';
      var cursor = 0;
      var matches = [];
      for (var i = 0; i < sentences.length; i++) {
        var sentence = sentences[i] || {};
        var sentenceText = this._cleanValue(sentence.text);
        var found = sentenceText ? text.indexOf(sentenceText, cursor) : -1;
        if (found >= 0)
          matches.push({
            sentence: sentence,
            text: sentenceText,
            start: found,
            end: found + sentenceText.length,
          });
      }
      matches.sort(function (a, b) {
        if (a.start !== b.start) return a.start - b.start;
        return b.text.length - a.text.length;
      });
      for (var j = 0; j < matches.length; j++) {
        var match = matches[j];
        if (match.start < cursor) continue;
        if (match.start > cursor)
          html += this._formatText(text.slice(cursor, match.start), fallbackHighlightMode);
        html += this._renderChunkSentence(match.sentence);
        cursor = match.end;
      }
      if (cursor < text.length) html += this._formatText(text.slice(cursor), fallbackHighlightMode);
      return html || this._formatText(text, fallbackHighlightMode);
    },

    _renderChunkSentence: function (sentence) {
      var chunks = Array.isArray(sentence && sentence.chunks) ? sentence.chunks : [];
      if (!chunks.length) return this._formatText(sentence && sentence.text, false);
      var html = '';
      var sentenceFallback = !!(sentence && sentence.fallback);
      for (var i = 0; i < chunks.length; i++) {
        var chunk = chunks[i] || {};
        var surface = chunk.surface === null || chunk.surface === undefined ? '' : String(chunk.surface);
        if (!surface) continue;
        var colorKey = this._toChunkColorKey(chunk.color_key);
        var role = this._cleanValue(chunk.role_zh);
        var meaning = this._cleanValue(chunk.meaning_zh);
        var grammar = this._cleanValue(chunk.grammar_zh);
        var isFallback = sentenceFallback || !!chunk.fallback_chunk;
        var className =
          'tb-text-chunk tb-text-chunk--' +
          this._esc(colorKey) +
          (isFallback ? ' tb-text-chunk-fallback' : '');
        if (colorKey === 'punctuation' || (!role && !meaning && !grammar)) {
          html += '<span class="' + className + '">' + this._esc(surface) + '</span>';
        } else {
          html +=
            '<button type="button" class="' +
            className +
            '" data-text-chunk data-chunk-role="' +
            this._esc(role) +
            '" data-chunk-meaning="' +
            this._esc(meaning) +
            '" data-chunk-grammar="' +
            this._esc(grammar) +
            '" data-chunk-fallback="' +
            (isFallback ? '1' : '0') +
            '" aria-haspopup="dialog" aria-expanded="false" aria-label="查看词块「' +
            this._esc(surface) +
            '」的构成和意思">' +
            this._esc(surface) +
            '</button>';
        }
      }
      return html;
    },

    _renderWikiExtensionSection: function () {
      var reading = this.currentWikiReading;
      if (!reading) return '';
      var wiki = reading.wiki || {};
      var title = this._cleanValue(wiki.title) || this._cleanValue(reading.lessonTitle) || 'Wikipedia';
      var url = this._cleanValue(wiki.url);
      var source = this._cleanValue(wiki.source) || 'ja.wikipedia.org';
      var license = this._cleanValue(wiki.license) || 'CC BY-SA';
      var html =
        '<section class="tb-section tb-section-wiki"><header class="tb-section-head tb-meta-noselect">' +
        '<span class="tb-section-badge">拓展阅读</span>' +
        '<span class="tb-section-meta">Wikipedia · ' +
        this._esc(title) +
        '</span>' +
        '</header><div class="tb-section-body">';
      html +=
        '<div class="tb-wiki-kicker"><h3 class="tb-wiki-title">' +
        this._esc(title) +
        '</h3>' +
        this._renderWikiChips(reading) +
        '</div>';
      html += this._renderWikiReadingBody(reading);
      html += '<div class="tb-wiki-source">';
      if (url)
        html +=
          '<a href="' +
          this._esc(url) +
          '" target="_blank" rel="noopener noreferrer">' +
          this._esc(source + ' / ' + title) +
          '</a>';
      else html += '<span>' + this._esc(source + ' / ' + title) + '</span>';
      html += '<span>' + this._esc(license) + '</span>';
      if (wiki.lastrevid) html += '<span>rev ' + this._esc(wiki.lastrevid) + '</span>';
      html += '</div></div></section>';
      return html;
    },

    _renderWikiChips: function (reading) {
      var chips = [];
      var targets = Array.isArray(reading && reading.targetCandidates) ? reading.targetCandidates : [];
      var sections = Array.isArray(reading && reading.selectedSections) ? reading.selectedSections : [];
      for (var i = 0; i < targets.length && chips.length < 4; i++) {
        var target = this._cleanValue(targets[i]);
        if (target) chips.push(target);
      }
      for (var j = 0; j < sections.length && chips.length < 7; j++) {
        var title = this._cleanValue(sections[j] && sections[j].title);
        if (title) chips.push(title);
      }
      if (!chips.length) return '';
      var html = '<div class="tb-wiki-chips">';
      for (var k = 0; k < chips.length; k++)
        html += '<span class="tb-wiki-chip">' + this._esc(chips[k]) + '</span>';
      return html + '</div>';
    },

    _renderWikiReadingBody: function (reading) {
      var text = this._cleanValue(reading && reading.readingText);
      var sentences = Array.isArray(reading && reading.sentences) ? reading.sentences.slice() : [];
      var paragraphs = text
        ? text
            .split(/\n{2,}/)
            .map(function (part) {
              return String(part || '').trim();
            })
            .filter(Boolean)
        : [];
      if (!paragraphs.length && sentences.length) {
        paragraphs = sentences
          .map(function (sentence) {
            return String((sentence && sentence.text) || '').trim();
          })
          .filter(Boolean);
      }
      if (!paragraphs.length)
        return '<p class="tb-paragraph tb-wiki-paragraph" lang="zh-CN">暂无可显示的拓展阅读正文。</p>';
      var html = '';
      for (var i = 0; i < paragraphs.length; i++) {
        html +=
          '<p class="tb-paragraph tb-wiki-paragraph" lang="ja">' +
          this._renderWikiParagraph(paragraphs[i], sentences) +
          '</p>';
      }
      return html;
    },

    _renderWikiParagraph: function (paragraph, sentences) {
      var raw = this._cleanValue(paragraph);
      if (this.textDisplayMode !== 'chunks') return this._esc(raw);
      if (!raw || !sentences || !sentences.length) return this._formatText(raw, false);
      return this._renderChunkedText(raw, sentences, false);
    },

    _ensureChunkDetail: function () {
      if (this._chunkDetailEl && this._chunkDetailEl.isConnected) return this._chunkDetailEl;
      var panel = document.getElementById('tbChunkDetail');
      if (!panel) {
        panel = document.createElement('aside');
        panel.id = 'tbChunkDetail';
        panel.className = 'tb-chunk-detail';
        panel.hidden = true;
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'false');
        panel.setAttribute('aria-labelledby', 'tbChunkDetailTitle');
        panel.innerHTML =
          '<div class="tb-chunk-detail-head"><span>词块解析</span>' +
          '<button type="button" class="tb-chunk-detail-close" aria-label="关闭词块解析" title="关闭">' +
          uiIcon('x') +
          '</button></div><div class="tb-chunk-detail-content"></div>';
        document.body.appendChild(panel);
      }
      this._chunkDetailEl = panel;
      var self = this;
      if (panel.getAttribute('data-bound') !== '1') {
        panel.setAttribute('data-bound', '1');
        panel.querySelector('.tb-chunk-detail-close').addEventListener('click', function () {
          self._closeChunkDetail(true);
        });
        panel.addEventListener('pointerenter', function () {
          self._clearChunkDetailClose();
        });
        panel.addEventListener('pointerleave', function () {
          self._scheduleChunkDetailClose();
        });
        document.addEventListener(
          'pointerdown',
          function (event) {
            if (panel.hidden || panel.contains(event.target)) return;
            if (self._chunkDetailAnchor && self._chunkDetailAnchor.contains(event.target)) return;
            self._closeChunkDetail(false);
          },
          true,
        );
        document.addEventListener('keydown', function (event) {
          if (event.key !== 'Escape' || panel.hidden) return;
          event.preventDefault();
          event.stopPropagation();
          self._closeChunkDetail(true);
        });
        window.addEventListener('resize', function () {
          self._positionChunkDetail();
        });
        window.addEventListener(
          'scroll',
          function () {
            self._positionChunkDetail();
          },
          true,
        );
        window.addEventListener('app:layout-viewport-change', function () {
          self._positionChunkDetail();
        });
        if (window.JPLearn.topLayer) {
          window.JPLearn.topLayer.register('text-chunk-detail', {
            close: function (restoreFocus) {
              self._closeChunkDetail(restoreFocus);
            },
          });
        }
      }
      return panel;
    },

    _showChunkDetail: function (anchor, focusPanel) {
      if (!anchor) return;
      this._clearChunkDetailClose();
      var panel = this._ensureChunkDetail();
      if (!panel) return;
      if (this._chunkDetailAnchor === anchor && !panel.hidden) {
        if (focusPanel) panel.querySelector('.tb-chunk-detail-close').focus();
        return;
      }
      if (this._chunkDetailAnchor) this._chunkDetailAnchor.setAttribute('aria-expanded', 'false');
      this._chunkDetailAnchor = anchor;
      anchor.setAttribute('aria-expanded', 'true');
      var surface = this._cleanValue(anchor.textContent) || '词块';
      var rows = [
        ['构成', this._cleanValue(anchor.getAttribute('data-chunk-role'))],
        ['意思', this._cleanValue(anchor.getAttribute('data-chunk-meaning'))],
        ['用法', this._cleanValue(anchor.getAttribute('data-chunk-grammar'))],
      ];
      var body =
        '<strong class="tb-chunk-detail-title" id="tbChunkDetailTitle" lang="ja">' +
        this._esc(surface) +
        '</strong><dl class="tb-chunk-detail-list">';
      for (var i = 0; i < rows.length; i++) {
        if (!rows[i][1]) continue;
        body += '<div><dt>' + rows[i][0] + '</dt><dd>' + this._esc(rows[i][1]) + '</dd></div>';
      }
      body += '</dl>';
      if (anchor.getAttribute('data-chunk-fallback') === '1')
        body += '<p class="tb-chunk-detail-note">此处使用自动粗分块，仅作阅读辅助。</p>';
      panel.querySelector('.tb-chunk-detail-content').innerHTML = body;
      panel.hidden = false;
      panel.setAttribute('data-tone', this._chunkToneFromAnchor(anchor));
      if (window.JPLearn.topLayer) window.JPLearn.topLayer.requestOpen('text-chunk-detail');
      this._positionChunkDetail();
      if (focusPanel) panel.querySelector('.tb-chunk-detail-close').focus();
    },

    _clearChunkDetailClose: function () {
      if (!this._chunkDetailCloseTimer) return;
      window.clearTimeout(this._chunkDetailCloseTimer);
      this._chunkDetailCloseTimer = 0;
    },

    // Keyboard focus inside the open detail owns it: scrolling can move other
    // chunks under an idle pointer, which must not re-anchor or close it.
    _chunkDetailHasFocus: function () {
      var panel = this._chunkDetailEl;
      return !!(panel && !panel.hidden && panel.contains(document.activeElement));
    },

    _scheduleChunkDetailClose: function () {
      var self = this;
      this._clearChunkDetailClose();
      this._chunkDetailCloseTimer = window.setTimeout(function () {
        self._chunkDetailCloseTimer = 0;
        if (self._chunkDetailHasFocus()) return;
        self._closeChunkDetail(false);
      }, 140);
    },

    _chunkToneFromAnchor: function (anchor) {
      var match = String(anchor.className || '').match(/tb-text-chunk--([a-z]+)/);
      return match ? match[1] : 'other';
    },

    _positionChunkDetail: function () {
      var panel = this._chunkDetailEl;
      var anchor = this._chunkDetailAnchor;
      if (!panel || panel.hidden || !anchor || !anchor.isConnected) return;
      var scale =
        window.AppDisplayScale && window.AppDisplayScale.getScale
          ? window.AppDisplayScale.getScale() || 1
          : 1;
      var viewportWidth =
        window.AppDisplayScale && window.AppDisplayScale.getLayoutWidth
          ? window.AppDisplayScale.getLayoutWidth()
          : window.innerWidth / scale;
      var viewportHeight =
        window.AppDisplayScale && window.AppDisplayScale.getLayoutHeight
          ? window.AppDisplayScale.getLayoutHeight()
          : window.innerHeight / scale;
      var anchorRect = anchor.getBoundingClientRect();
      var rect = {
        left: anchorRect.left / scale,
        right: anchorRect.right / scale,
        top: anchorRect.top / scale,
        bottom: anchorRect.bottom / scale,
        width: anchorRect.width / scale,
      };
      if (rect.bottom < 0 || rect.top > viewportHeight || rect.right < 0 || rect.left > viewportWidth) {
        this._closeChunkDetail(false);
        return;
      }
      var panelRect = panel.getBoundingClientRect();
      var width = panelRect.width / scale;
      var height = panelRect.height / scale;
      var margin = 10;
      var gap = 9;
      var navWidth = parseFloat(
        window.getComputedStyle(document.documentElement).getPropertyValue('--app-nav-width'),
      );
      if (!isFinite(navWidth)) navWidth = 0;
      var safeLeft = Math.min(viewportWidth - margin, navWidth + margin);
      var left = rect.left + rect.width / 2 - width / 2;
      left = Math.max(safeLeft, Math.min(left, viewportWidth - width - margin));
      var placement = 'bottom';
      var top = rect.bottom + gap;
      if (top + height > viewportHeight - margin) {
        placement = 'top';
        top = rect.top - height - gap;
      }
      top = Math.max(margin, Math.min(top, viewportHeight - height - margin));
      panel.style.left = Math.round(left) + 'px';
      panel.style.top = Math.round(top) + 'px';
      panel.setAttribute('data-placement', placement);
      panel.style.setProperty(
        '--chunk-arrow-offset',
        Math.max(18, Math.min(width - 18, rect.left + rect.width / 2 - left)) + 'px',
      );
    },

    _closeChunkDetail: function (restoreFocus) {
      this._clearChunkDetailClose();
      var panel = this._chunkDetailEl;
      var anchor = this._chunkDetailAnchor;
      if (anchor) anchor.setAttribute('aria-expanded', 'false');
      this._chunkDetailAnchor = null;
      if (panel) panel.hidden = true;
      if (window.JPLearn.topLayer) window.JPLearn.topLayer.release('text-chunk-detail');
      if (restoreFocus && anchor && anchor.isConnected) anchor.focus({ preventScroll: true });
    },

    _toChunkColorKey: function (value) {
      var key = this._cleanValue(value).toLowerCase();
      var allowed = {
        topic: true,
        subject: true,
        object: true,
        time: true,
        place: true,
        direction: true,
        adverb: true,
        connector: true,
        modifier: true,
        predicate: true,
        quote: true,
        punctuation: true,
        other: true,
      };
      return allowed[key] ? key : 'other';
    },
  });
})(window);
