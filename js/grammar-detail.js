/**
 * grammar-detail.js
 * Renders full grammar detail in the shared anchored detail surface.
 * Learning-first detail sections, null-tolerant.
 */
function GrammarDetailPanel(containerId) {
  this.container = document.getElementById(containerId);
  this.currentUid = null;
}

GrammarDetailPanel.prototype = {
  /**
   * Show detail for a grammar point.
   * @param {string} uid
   * @param {object} indexEntry - from grammar_index
   */
  show: function (uid, indexEntry, anchor, options) {
    if (window.PanelLayout) window.PanelLayout.expandDetail('grammar', anchor, options);

    this.currentUid = uid;
    var self = this;
    var el = this.container;
    if (window.StateView) {
      window.StateView.mount(el, {
        kind: 'loading',
        className: 'gm-detail-loading-state',
        icon: 'grammar',
        title: '正在加载语法详情',
        message: '正在整理接续、例句和练习…',
      });
    } else {
      el.innerHTML = '<div class="gm-detail-loading">読み込み中...</div>';
    }

    return GrammarLoader.getDetail(uid)
      .then(function (detail) {
        if (self.currentUid !== uid) return; // stale
        if (!detail) {
          var loadError = GrammarLoader.getLastError && GrammarLoader.getLastError('details');
          if (window.StateView) {
            window.StateView.mount(
              el,
              loadError
                ? {
                    kind: 'error',
                    className: 'gm-detail-error-state',
                    icon: 'grammar',
                    title: '语法详情暂时无法加载',
                    message: '列表仍可浏览，点击重试即可重新读取这条详情。',
                    details: loadError && loadError.message,
                    action: {
                      id: 'retry-grammar-detail',
                      label: '重试详情',
                      icon: 'rotate-ccw',
                      onClick: function () {
                        if (GrammarLoader.reset) GrammarLoader.reset('details');
                        return self.show(uid, indexEntry, anchor, options);
                      },
                    },
                  }
                : {
                    kind: 'empty',
                    className: 'gm-detail-empty-state',
                    icon: 'grammar',
                    title: '找不到这条语法详情',
                    message: '返回列表选择其他语法点，或稍后再试。',
                  },
            );
          } else {
            el.innerHTML = '<div class="gm-detail-empty">データが見つかりません</div>';
          }
          return;
        }
        self._render(detail, indexEntry);
      })
      .catch(function (err) {
        if (self.currentUid !== uid) return;
        if (window.StateView) {
          window.StateView.mount(el, {
            kind: 'error',
            className: 'gm-detail-error-state',
            icon: 'grammar',
            title: '语法详情暂时无法加载',
            message: '列表仍可浏览，点击重试即可重新读取这条详情。',
            details: err && err.message,
            action: {
              id: 'retry-grammar-detail',
              label: '重试详情',
              icon: 'rotate-ccw',
              onClick: function () {
                if (GrammarLoader.reset) GrammarLoader.reset('details');
                return self.show(uid, indexEntry, anchor, options);
              },
            },
          });
        }
      });
  },

  clear: function () {
    this.currentUid = null;
    if (window.JPLearn.anchoredDetail) window.JPLearn.anchoredDetail.close('grammar', false);
    if (this.container) {
      if (window.StateView) {
        window.StateView.mount(this.container, {
          kind: 'empty',
          className: 'panel-empty-state',
          icon: 'info',
          title: '选择语法点查看详情',
          message: '点击中间列表中的语法卡片后，这里会显示接续、例句、辨析和练习。',
        });
      } else {
        this.container.innerHTML =
          '<div class="panel-empty-state">' +
          uiIcon('info') +
          '<strong>选择语法点查看详情</strong><p>点击中间列表中的语法卡片后，这里会显示接续、例句、辨析和练习。</p></div>';
      }
    }
  },

  _render: function (detail, indexEntry) {
    var e = detail.enriched || {};
    var rs = e.render_summary || {};
    var h = '';

    // Header
    h += '<div class="gm-detail-header">';
    h += '<h2 class="gm-detail-title" lang="ja">' + this._esc(e.clean_title || detail.title) + '</h2>';
    h +=
      '<span class="gm-detail-level gm-level-' +
      (detail.level || '').toLowerCase() +
      '">' +
      this._esc(detail.level) +
      '</span>';
    h += '<span class="gm-detail-index">#' + (detail.index || '') + '</span>';
    if (e.grammar_id) h += '<div class="gm-detail-uid">' + this._esc(e.grammar_id) + '</div>';
    h +=
      '<button type="button" class="btn-primary gm-detail-study" id="gmStartPractice">' +
      uiIcon('pencil') +
      '开始练习</button>';
    h += '</div>';

    var sections = [
      {
        id: 'gm-section-summary',
        label: '摘要',
        icon: 'clipboard',
        content: this._renderEssentialSummary(detail, rs, e),
        open: true,
      },
      {
        id: 'gm-section-connection',
        label: '接续',
        icon: 'link',
        content: this._renderEssentialConnection(detail, e),
        open: true,
      },
      {
        id: 'gm-section-examples',
        label: '例句',
        icon: 'book',
        content: this._renderExamples(e, detail),
        open: true,
      },
      {
        id: 'gm-section-confusable',
        label: '辨析',
        icon: 'scale',
        content: this._renderConfusable(e),
        open: false,
      },
      {
        id: 'gm-section-errors',
        label: '误用',
        icon: 'x-circle',
        content: this._renderErrors(e),
        open: false,
      },
      {
        id: 'gm-section-practice',
        label: '练习',
        icon: 'pencil',
        content: this._renderPractice(e),
        open: false,
      },
      {
        id: 'gm-section-memory',
        label: '记忆补充',
        icon: 'brain',
        content: this._mergeContent(this._renderMemory(e), this._renderSummary(rs, e, indexEntry)),
        open: false,
      },
      {
        id: 'gm-section-patterns',
        label: '搭配句框',
        icon: 'ruler',
        content: this._mergeContent(this._renderConnection(detail, e), this._renderPatterns(e)),
        open: false,
      },
      {
        id: 'gm-section-lessons',
        label: '辅助课文',
        icon: 'library',
        content: this._renderLessonLink(indexEntry, detail),
        open: false,
      },
    ].filter(function (section) {
      return !!section.content;
    });

    h += this._renderOutline(sections);

    var warnings = e.warnings;
    if (
      warnings &&
      ((Array.isArray(warnings) && warnings.length) || (typeof warnings === 'string' && warnings))
    ) {
      h += '<div class="gm-detail-warning">' + uiIcon('info') + '该条目存在待复核内容</div>';
    }

    for (var i = 0; i < sections.length; i++) {
      var section = sections[i];
      h += this._section(section.id, uiIcon(section.icon) + section.label, section.content, section.open);
    }

    this.container.innerHTML = h;
    this._bindEvents();
  },

  _section: function (id, title, content, open) {
    if (!content) return '';
    return (
      '<details class="gm-detail-section" id="' +
      id +
      '"' +
      (open ? ' open' : '') +
      '>' +
      '<summary>' +
      title +
      '</summary>' +
      '<div class="gm-detail-section-body">' +
      content +
      '</div>' +
      '</details>'
    );
  },

  _renderOutline: function (sections) {
    if (sections.length < 2) return '';
    return (
      '<nav class="gm-detail-outline" aria-label="语法详情章节">' +
      sections
        .map(
          function (section, index) {
            return (
              '<button type="button" class="gm-detail-nav-btn' +
              (index === 0 ? ' active' : '') +
              '" data-section-target="' +
              section.id +
              '">' +
              this._esc(section.label) +
              '</button>'
            );
          }.bind(this),
        )
        .join('') +
      '</nav>'
    );
  },

  _renderEssentialSummary: function (detail, rs, e) {
    var parts = [];
    var coreMeaning = e.core_meaning_zh || detail.explanation || rs.headline;
    if (coreMeaning) parts.push(this._kvRow('核心义', coreMeaning));
    return parts.length ? parts.join('') : null;
  },

  _renderEssentialConnection: function (detail, e) {
    var parts = [];
    var connection = e.normalized_connection || detail.connection || e.canonical_form;
    if (connection) parts.push(this._kvRow('', connection));
    return parts.length ? parts.join('') : null;
  },

  _mergeContent: function (first, second) {
    var merged = (first || '') + (second || '');
    return merged || null;
  },

  _renderSummary: function (rs, e, indexEntry) {
    var parts = [];
    if (rs.headline)
      parts.push(
        '<div class="gm-kv"><span class="gm-k">要点</span><span class="gm-v">' +
          this._esc(rs.headline) +
          '</span></div>',
      );
    if (rs.memory_formula)
      parts.push(
        '<div class="gm-kv"><span class="gm-k">记忆公式</span><span class="gm-v gm-mono">' +
          this._esc(rs.memory_formula) +
          '</span></div>',
      );
    if (rs.key_warning)
      parts.push(
        '<div class="gm-kv gm-kv-warn"><span class="gm-k">⚠ 警告</span><span class="gm-v">' +
          this._esc(rs.key_warning) +
          '</span></div>',
      );
    if (rs.contrast_focus)
      parts.push(
        '<div class="gm-kv"><span class="gm-k">辨析焦点</span><span class="gm-v">' +
          this._esc(rs.contrast_focus) +
          '</span></div>',
      );
    if (rs.usage_snapshot)
      parts.push(
        '<div class="gm-kv"><span class="gm-k">使用快照</span><span class="gm-v">' +
          this._esc(rs.usage_snapshot) +
          '</span></div>',
      );
    var tags = grammarTagLabels([].concat((indexEntry && indexEntry.quickTags) || [], rs.quick_tags || []));
    if (tags.length) {
      parts.push('<div class="gm-detail-metadata">' + this._kvRow('分类标签', tags.join(' · ')) + '</div>');
    }
    return parts.length ? parts.join('') : null;
  },

  _renderConnection: function (detail, e) {
    var parts = [];
    if (e.canonical_form) parts.push(this._kvRow('标准形式', e.canonical_form));
    if (detail.connection) parts.push(this._kvRow('接续', detail.connection));
    if (e.normalized_connection) parts.push(this._kvRow('规范接续', e.normalized_connection));
    if (detail.explanation) parts.push(this._kvRow('释义', detail.explanation));
    if (e.recognition_cues) parts.push(this._kvRow('识别线索', this._listOrStr(e.recognition_cues)));
    if (e.usage_constraints) parts.push(this._kvRow('使用限制', this._listOrStr(e.usage_constraints)));
    if (e.cooccurrence_signals) parts.push(this._kvRow('共现信号', this._listOrStr(e.cooccurrence_signals)));
    if (e.sentence_position) parts.push(this._kvRow('句中位置', e.sentence_position));
    return parts.length ? parts.join('') : null;
  },

  _renderMemory: function (e) {
    var parts = [];
    if (e.core_meaning_zh) parts.push(this._kvRow('核心义(中)', e.core_meaning_zh));
    if (e.core_meaning_ja) parts.push(this._kvRow('核心義(日)', e.core_meaning_ja));
    if (e.one_line_memory) parts.push(this._kvRow('一句记忆', e.one_line_memory));
    if (e.memory_hooks) parts.push(this._kvRow('记忆钩子', this._listOrStr(e.memory_hooks)));
    if (e.subtle_nuance) parts.push(this._kvRow('微妙语感', e.subtle_nuance));
    return parts.length ? parts.join('') : null;
  },

  _renderPatterns: function (e) {
    var parts = [];
    if (e.common_collocations && e.common_collocations.length) {
      parts.push(
        '<div class="gm-subsec-title">常见搭配</div><div class="gm-chip-list">' +
          e.common_collocations
            .map(
              function (c) {
                return '<span class="gm-chip">' + this._esc(c) + '</span>';
              }.bind(this),
            )
            .join('') +
          '</div>',
      );
    }
    if (e.pattern_frames && e.pattern_frames.length) {
      parts.push('<div class="gm-subsec-title">句框模式</div>' + this._renderStringList(e.pattern_frames));
    }
    if (e.formation_variants && e.formation_variants.length) {
      parts.push(
        '<div class="gm-subsec-title">形态变体</div>' + this._renderStringList(e.formation_variants),
      );
    }
    if (e.replacement_ready_templates && e.replacement_ready_templates.length) {
      parts.push(
        '<div class="gm-subsec-title">替换模板</div>' + this._renderStringList(e.replacement_ready_templates),
      );
    }
    return parts.length ? parts.join('') : null;
  },

  _renderConfusable: function (e) {
    var parts = [];
    if (e.confusable_grammar && e.confusable_grammar.length) {
      var table =
        '<table class="gm-conf-table"><thead><tr><th>语法</th><th>区别</th><th>何时用这个</th><th>何时不用</th></tr></thead><tbody>';
      for (var i = 0; i < e.confusable_grammar.length; i++) {
        var cg = e.confusable_grammar[i];
        table +=
          '<tr><td>' +
          this._esc(cg.grammar || '') +
          '</td><td>' +
          this._esc(cg.difference || '') +
          '</td><td>' +
          this._esc(cg.when_to_use_this || '') +
          '</td><td>' +
          this._esc(cg.when_not_to_use_this || '') +
          '</td></tr>';
      }
      table += '</tbody></table>';
      parts.push(table);
    }
    var notes = this._differenceNotes(e.difference_notes);
    if (notes) parts.push(this._kvRow('辨析要点', notes));
    if (e.mini_contrast_set && e.mini_contrast_set.length) {
      parts.push('<div class="gm-subsec-title">对比句组</div>');
      for (var j = 0; j < e.mini_contrast_set.length; j++) {
        var mc = e.mini_contrast_set[j];
        if (typeof mc === 'object') {
          parts.push(
            '<div class="gm-contrast-item">' +
              (mc.ja
                ? '<div class="gm-ja" lang="ja">' + this._esc(mc.ja) + this._exampleAudio(mc.ja) + '</div>'
                : '') +
              (mc.zh ? '<div class="gm-zh">' + this._esc(mc.zh) + '</div>' : '') +
              (mc.grammar_used ? '<div class="gm-used">使用: ' + this._esc(mc.grammar_used) + '</div>' : '') +
              '</div>',
          );
        } else {
          parts.push('<div class="gm-contrast-item">' + this._esc(String(mc)) + '</div>');
        }
      }
    }
    return parts.length ? parts.join('') : '<div class="gm-no-data">暂无辨析数据</div>';
  },

  _renderErrors: function (e) {
    var parts = [];
    if (e.anti_examples && e.anti_examples.length) {
      parts.push('<div class="gm-subsec-title">反例（错句卡）</div>');
      for (var i = 0; i < e.anti_examples.length; i++) {
        var ae = e.anti_examples[i];
        parts.push(
          '<div class="gm-anti-card">' +
            (ae.ja
              ? '<div class="gm-ja gm-anti-ja" lang="ja">' + uiIcon('x') + this._marked(ae.ja) + '</div>'
              : '') +
            (ae.zh ? '<div class="gm-zh">' + this._marked(ae.zh) + '</div>' : '') +
            (ae.why_bad ? '<div class="gm-why">为什么别扭: ' + this._esc(ae.why_bad) + '</div>' : '') +
            (ae.why_wrong ? '<div class="gm-why">正确方向: ' + this._esc(ae.why_wrong) + '</div>' : '') +
            '</div>',
        );
      }
    }
    if (e.error_patterns && e.error_patterns.length) {
      parts.push(
        '<div class="gm-subsec-title">常见错误模式</div>' + this._renderStringList(e.error_patterns),
      );
    }
    if (e.exam_traps && e.exam_traps.length) {
      parts.push('<div class="gm-subsec-title">考试陷阱</div>' + this._renderStringList(e.exam_traps));
    }
    return parts.length ? parts.join('') : '<div class="gm-no-data">暂无误用数据</div>';
  },

  _renderExamples: function (e, detail) {
    var parts = [];
    if (e.example_analysis && e.example_analysis.length) {
      for (var i = 0; i < e.example_analysis.length; i++) {
        var ea = e.example_analysis[i];
        parts.push(
          '<div class="gm-ex-card">' +
            (ea.ja
              ? '<div class="gm-ja" lang="ja">' + this._marked(ea.ja) + this._exampleAudio(ea.ja) + '</div>'
              : '') +
            (ea.zh ? '<div class="gm-zh">' + this._marked(ea.zh) + '</div>' : '') +
            (ea.grammar_span
              ? '<div class="gm-span">命中: <strong>' + this._esc(ea.grammar_span) + '</strong></div>'
              : '') +
            (ea.scene ? '<div class="gm-scene">场景: ' + this._esc(ea.scene) + '</div>' : '') +
            (ea.why_this_grammar
              ? '<div class="gm-why">为什么用此语法: ' + this._esc(ea.why_this_grammar) + '</div>'
              : '') +
            '</div>',
        );
      }
    }
    if (e.best_examples_for_memory && e.best_examples_for_memory.length) {
      parts.push('<div class="gm-subsec-title">最佳记忆例句</div>');
      for (var j = 0; j < e.best_examples_for_memory.length; j++) {
        var bm = e.best_examples_for_memory[j];
        parts.push(this._renderExItem(bm));
      }
    }
    if (e.best_examples_for_contrast && e.best_examples_for_contrast.length) {
      parts.push('<div class="gm-subsec-title">最佳对比例句</div>');
      for (var k = 0; k < e.best_examples_for_contrast.length; k++) {
        parts.push(this._renderExItem(e.best_examples_for_contrast[k]));
      }
    }
    if (!parts.length) {
      var fallbackExamples = detail.originalExamples || detail.rewrittenExamples || [];
      for (var m = 0; m < fallbackExamples.length; m++) {
        parts.push(this._renderExItem(fallbackExamples[m]));
      }
    }
    return parts.length ? parts.join('') : null;
  },

  // Japanese examples get a button for the packed example audio; the
  // counter-examples in _renderErrors deliberately do not.
  _exampleAudio: function (text) {
    var audio = window.JPLearn && window.JPLearn.exampleAudio;
    return audio ? audio.button(text) : '';
  },

  _renderExItem: function (item) {
    if (typeof item === 'string')
      return '<div class="gm-ex-simple">' + this._marked(item) + this._exampleAudio(item) + '</div>';
    if (!item) return '';
    return (
      '<div class="gm-ex-card">' +
      (item.ja
        ? '<div class="gm-ja" lang="ja">' + this._marked(item.ja) + this._exampleAudio(item.ja) + '</div>'
        : '') +
      (item.zh ? '<div class="gm-zh">' + this._marked(item.zh) + '</div>' : '') +
      '</div>'
    );
  },

  _renderPractice: function (e) {
    var parts = [];
    if (e.quick_self_test && e.quick_self_test.length) {
      parts.push('<div class="gm-subsec-title">快速自测</div>');
      for (var i = 0; i < e.quick_self_test.length; i++) {
        var q = e.quick_self_test[i];
        if (typeof q === 'object') {
          parts.push(
            '<div class="gm-quiz">' +
              (q.question ? '<div class="gm-quiz-q">Q: ' + this._esc(q.question) + '</div>' : '') +
              (q.answer
                ? '<details class="gm-quiz-a"><summary>查看答案</summary>' +
                  this._esc(q.answer) +
                  '</details>'
                : '') +
              '</div>',
          );
        } else {
          parts.push('<div class="gm-quiz">' + this._esc(String(q)) + '</div>');
        }
      }
    }
    if (e.production_prompts && e.production_prompts.length) {
      parts.push(
        '<div class="gm-subsec-title">造句提示</div>' + this._renderStringList(e.production_prompts),
      );
    }
    if (e.comprehension_checks && e.comprehension_checks.length) {
      parts.push(
        '<div class="gm-subsec-title">理解检查</div>' + this._renderStringList(e.comprehension_checks),
      );
    }
    if (e.substitution_drills && e.substitution_drills.length) {
      parts.push(
        '<div class="gm-subsec-title">替换练习</div>' + this._renderStringList(e.substitution_drills),
      );
    }
    return parts.length ? parts.join('') : null;
  },

  _renderLessonLink: function (indexEntry, detail) {
    if (!indexEntry || !indexEntry.lessonIds || !indexEntry.lessonIds.length) {
      return '<div class="gm-no-data">该语法点暂未关联辅助课文</div>';
    }
    var parts = ['<div class="gm-lesson-links">'];
    for (var i = 0; i < indexEntry.lessonIds.length; i++) {
      var lid = indexEntry.lessonIds[i];
      parts.push(
        '<button class="btn-secondary gm-lesson-link-btn" data-lesson-id="' +
          lid +
          '">' +
          uiIcon('book') +
          'Lesson ' +
          String(lid).padStart(3, '0') +
          ' — 在辅助课文中查看</button>',
      );
    }
    parts.push('</div>');
    return parts.join('');
  },

  _bindEvents: function () {
    var self = this;
    var practiceBtn = document.getElementById('gmStartPractice');
    if (practiceBtn) {
      practiceBtn.addEventListener('click', function () {
        self._focusSection('gm-section-practice');
      });
    }
    var navBtns = this.container.querySelectorAll('.gm-detail-nav-btn');
    for (var n = 0; n < navBtns.length; n++) {
      navBtns[n].addEventListener('click', function () {
        self._focusSection(this.getAttribute('data-section-target'));
      });
    }
    var btns = this.container.querySelectorAll('.gm-lesson-link-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        var lid = parseInt(this.getAttribute('data-lesson-id'));
        if (window.grammarModule) {
          window.grammarModule.navigateToLesson(lid, self.currentUid);
        }
      });
    }
  },

  _focusSection: function (id) {
    var section = document.getElementById(id);
    if (!section) return;
    var navBtns = this.container.querySelectorAll('.gm-detail-nav-btn');
    for (var i = 0; i < navBtns.length; i++) {
      navBtns[i].classList.toggle('active', navBtns[i].getAttribute('data-section-target') === id);
    }
    section.open = true;
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    var summary = section.querySelector('summary');
    if (summary) summary.focus();
  },

  // Helpers
  _esc: function (s) {
    return window.JPLearn.html.escape(s);
  },
  // Example sentences, drills and error patterns mark the grammar as [[TEXT]].
  _marked: function (s) {
    return GrammarInlineParser.renderStrong(s);
  },
  _kvRow: function (label, value) {
    return (
      '<div class="gm-kv">' +
      (label ? '<span class="gm-k">' + label + '</span>' : '') +
      '<span class="gm-v">' +
      this._esc(typeof value === 'string' ? value : JSON.stringify(value)) +
      '</span></div>'
    );
  },
  _listOrStr: function (val) {
    if (Array.isArray(val)) return val.join('；');
    return String(val || '');
  },
  // Difference notes are {grammar, note} pairs; older data had plain strings.
  _differenceNotes: function (val) {
    if (!Array.isArray(val)) return String(val || '');
    return val
      .map(function (item) {
        if (!item || typeof item !== 'object') return String(item || '');
        return [item.grammar, item.note].filter(Boolean).join('：');
      })
      .filter(Boolean)
      .join('；');
  },
  _renderStringList: function (arr) {
    if (!arr || !arr.length) return '';
    var h = '<ul class="gm-str-list">';
    for (var i = 0; i < arr.length; i++) {
      var item = arr[i];
      h += '<li>' + this._marked(typeof item === 'string' ? item : JSON.stringify(item)) + '</li>';
    }
    h += '</ul>';
    return h;
  },
};
