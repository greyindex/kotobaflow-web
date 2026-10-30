(function (root) {
  'use strict';

  var app = root.JPLearn || (root.JPLearn = {});

  app.installCardRenderer = function (CardMode) {
    CardMode.prototype.render = function () {
      if (!this.container) return;
      this._buildDisplay();

      var totalPages = Math.ceil(this.displayWords.length / this.perPage) || 1;
      if (this.currentPage > totalPages) this.currentPage = totalPages;
      if (this.currentPage < 1) this.currentPage = 1;

      var startIdx = (this.currentPage - 1) * this.perPage;
      var endIdx = Math.min(startIdx + this.perPage, this.displayWords.length);
      var pageWords = this.displayWords.slice(startIdx, endIdx);

      // 收藏总数统计
      var favCount = 0;
      for (var i = 0; i < this.filteredWords.length; i++) {
        if (window.StudyStorage.getWordStatus(this.filteredWords[i].index).isFavorite) favCount++;
      }

      this._renderSidebarTools(totalPages, favCount);

      var book = this._isBookViewEnabled();
      var html =
        '<div class="cc-wrapper' +
        (this.hideMeanings ? ' cc-hide-meanings' : '') +
        (book ? ' cc-wrapper--book' : '') +
        '">';

      if (this.displayWords.length === 0) {
        if (window.StateView) {
          html += window.StateView.html({
            kind: 'empty',
            className: 'cc-empty cc-empty-state',
            icon: this.showFavOnly ? 'star' : 'search',
            title: this.showFavOnly ? '还没有收藏词' : '当前筛选没有词条',
            message: this.showFavOnly
              ? '收藏词条后，它们会集中出现在这里。'
              : '换一个关键词或清除筛选，词汇会重新出现在这里。',
            action: {
              id: this.showFavOnly ? 'clear-favorites' : 'reset-vocab-filters',
              label: this.showFavOnly ? '返回全部词汇' : '清除筛选',
              icon: this.showFavOnly ? 'library' : 'rotate-ccw',
            },
          });
        } else {
          html +=
            '<div class="cc-empty"><div class="cc-empty-icon">📭</div><p>当前筛选条件下没有词条</p></div>';
        }
      } else if (book) {
        // The page-turn layout replaces the pager: turning past a group opens the next one.
        html += '<div class="cc-book-body">' + this._renderGrid(pageWords) + '</div>';
      } else {
        html += this._renderGrid(pageWords);
        html += this._renderPagination(totalPages);
      }

      html += '</div>';
      this.container.innerHTML = html;
      this._bindEvents();
      this._mountBookView(totalPages);
      if (app.events) app.events.emit('vocab:catalog-rendered', { view: 'cards' });
    };

    /* ═══════════════════════════════════════════════════════════
       工具栏渲染
       ═══════════════════════════════════════════════════════════ */

    CardMode.prototype._renderToolbar = function () {
      var html = '<div class="cc-toolbar">';
      html += '<div class="cc-toolbar-main">';
      html += '<div class="cc-controls">';

      html +=
        '<button class="btn-primary cc-start-study" id="ccStartStudy"' +
        (this.displayWords.length === 0 ? ' disabled' : '') +
        '>' +
        uiIcon('target') +
        '开始学习 ' +
        Math.min(this.displayWords.length, 20) +
        ' 词</button>';

      // 朗读当页
      html +=
        '<button class="cc-btn-icon btn-ghost browsing-icon-action" id="ccReadPage" title="朗读当页单词" aria-label="朗读当页单词">' +
        uiIcon('play') +
        '</button>';
      html +=
        '<button class="cc-visibility-toggle browsing-icon-action' +
        (this.hideMeanings ? ' active' : '') +
        '" id="ccMeaningToggle" aria-pressed="' +
        (this.hideMeanings ? 'true' : 'false') +
        '" title="' +
        (this.hideMeanings ? '显示词卡释义' : '隐藏词卡释义') +
        '" aria-label="' +
        (this.hideMeanings ? '显示词卡释义' : '隐藏词卡释义') +
        '"' +
        '>';
      html += uiIcon(this.hideMeanings ? 'eye' : 'eye-off');
      html += '</button>';

      // 批量操作
      html += '<div class="cc-batch-wrap">';
      html +=
        '<button class="cc-btn-batch btn-secondary" id="ccBatchToggle" aria-haspopup="menu" aria-expanded="' +
        (this._batchMenuOpen ? 'true' : 'false') +
        '" aria-controls="ccBatchMenu" aria-label="批量操作" title="批量操作">批量 ' +
        uiIcon('chevron-down') +
        '</button>';
      html +=
        '<div class="cc-batch-menu' +
        (this._batchMenuOpen ? ' open' : '') +
        '" id="ccBatchMenu" role="menu" aria-hidden="' +
        (this._batchMenuOpen ? 'false' : 'true') +
        '">';
      html +=
        '<button class="cc-batch-item" role="menuitem" data-batch="fav-page">' +
        uiIcon('star') +
        '收藏当前页</button>';
      html +=
        '<button class="cc-batch-item" role="menuitem" data-batch="unfav-page">' +
        uiIcon('x') +
        '取消当前页收藏</button>';
      html +=
        '<button class="cc-batch-item" role="menuitem" data-batch="study-page">' +
        uiIcon('library') +
        '学习当前页</button>';
      html +=
        '<button class="cc-batch-item" role="menuitem" data-batch="study-all">' +
        uiIcon('library') +
        '学习全部筛选结果</button>';
      html += '</div>';
      html += '</div>';

      html += '</div>'; // cc-controls
      html += '</div>'; // cc-toolbar-main
      html += '<span class="cc-read-status" id="ccReadStatus" aria-live="polite"></span>';
      html += '</div>'; // cc-toolbar

      return html;
    };

    CardMode.prototype._renderSidebarTools = function (totalPages, favCount) {
      var tools = document.getElementById('vocabViewTools');
      if (!tools) return;

      var html = this._renderToolbar();
      html += '<div class="sidebar-view-summary"><strong>' + this.displayWords.length + '</strong> 词';
      html += '<span>第 ' + this.currentPage + ' / ' + totalPages + ' 页</span></div>';

      html +=
        '<label class="sidebar-tool-field"><span>排序</span><select class="cc-select" id="ccSortSelect">';
      var sortOptions = [
        { v: 'default', t: '默认顺序' },
        { v: 'shuffle', t: '随机顺序' },
        { v: 'index', t: '编号顺序' },
        { v: 'alpha', t: '字母顺序' },
        { v: 'fav', t: '收藏优先' },
      ];
      for (var i = 0; i < sortOptions.length; i++) {
        var sel = this.sortMode === sortOptions[i].v ? ' selected' : '';
        html += '<option value="' + sortOptions[i].v + '"' + sel + '>' + sortOptions[i].t + '</option>';
      }
      html += '</select></label>';

      html +=
        '<label class="sidebar-tool-field"><span>每页</span><select class="cc-select" id="ccPerPageSelect">';
      var ppOptions = [12, 24, 48, 96];
      for (var i = 0; i < ppOptions.length; i++) {
        var sel = this.perPage === ppOptions[i] ? ' selected' : '';
        html += '<option value="' + ppOptions[i] + '"' + sel + '>' + ppOptions[i] + ' 张</option>';
      }
      html += '</select></label>';

      html +=
        '<button class="sidebar-tool-toggle cc-tab-fav' +
        (this.showFavOnly ? ' active' : '') +
        '" data-action="fav-toggle" aria-pressed="' +
        (this.showFavOnly ? 'true' : 'false') +
        '">' +
        uiIcon('star') +
        '收藏 <span>' +
        favCount +
        '</span></button>';

      if (this.sortMode === 'shuffle') {
        html +=
          '<button class="sidebar-tool-toggle" id="ccReshuffle" title="重新洗牌" aria-label="重新洗牌">' +
          uiIcon('shuffle') +
          '重新洗牌</button>';
      }
      tools.innerHTML = html;
    };

    /* ═══════════════════════════════════════════════════════════
       卡片网格渲染
       ═══════════════════════════════════════════════════════════ */

    CardMode.prototype._renderGrid = function (pageWords) {
      var mgr = window.taxonomyManager;
      var html = '<div class="cc-grid">';

      for (var i = 0; i < pageWords.length; i++) {
        var w = pageWords[i];
        var status = window.StudyStorage.getWordStatus(w.index);
        var isExpanded = !!this.expandedCards[w.index];
        var lvClass = w.level ? w.level.toLowerCase() : '';
        var metadata = window.JPLearn && window.JPLearn.lexicalMetadata;
        var posLabel = w.pos
          ? metadata
            ? metadata.posLabel(
                { primary: metadata.primary(w.pos), classes: [metadata.primary(w.pos)] },
                'zh',
              )
            : mgr.getLabel('pos', w.pos)
          : '';
        var hiddenMetaCount = this._countHiddenMeta(w, status);

        html +=
          '<div class="cc-card' +
          (isExpanded ? ' cc-expanded' : '') +
          '" data-index="' +
          w.index +
          '" data-level="' +
          this._esc(w.level) +
          '">';

        // ── 卡片头部 ──
        html += '<div class="cc-card-head">';
        html += '<span class="cc-level cc-lv-' + lvClass + '">' + this._esc(w.level) + '</span>';
        if (hiddenMetaCount > 0) {
          var metaLabel = isExpanded ? '收起附加信息' : '展开 ' + hiddenMetaCount + ' 项附加信息';
          html +=
            '<button class="cc-meta-count" type="button" aria-expanded="' +
            isExpanded +
            '" aria-controls="cc-card-extra-' +
            w.index +
            '" data-act="expand" data-idx="' +
            w.index +
            '" title="' +
            metaLabel +
            '" aria-label="' +
            metaLabel +
            '">' +
            (isExpanded ? uiIcon('chevron-up') + '收起' : uiIcon('tag') + hiddenMetaCount + ' 项') +
            '</button>';
        }
        html +=
          '<button class="cc-fav' +
          (status.isFavorite ? ' active' : '') +
          '" data-fav="' +
          w.index +
          '" title="' +
          (status.isFavorite ? '取消收藏' : '收藏') +
          '" aria-label="' +
          (status.isFavorite ? '取消收藏' : '收藏') +
          '">';
        html += uiIcon('star');
        html += '</button>';
        html += '<div class="cc-card-actions">';
        html +=
          '<button class="cc-card-primary" data-act="study-word" data-idx="' +
          w.index +
          '" aria-label="学习此词" title="学习此词">' +
          uiIcon('target') +
          '学习此词</button>';
        html += '<div class="cc-card-menu-wrap">';
        html +=
          '<button class="cc-card-menu-toggle" type="button" data-card-menu="' +
          w.index +
          '" aria-expanded="false" aria-haspopup="menu" aria-controls="cc-card-menu-' +
          w.index +
          '" aria-label="更多操作" title="更多操作"><span aria-hidden="true">•••</span></button>';
        html +=
          '<div class="cc-card-menu" id="cc-card-menu-' +
          w.index +
          '" data-card-menu-panel="' +
          w.index +
          '" role="menu" aria-hidden="true">';
        html +=
          '<button class="cc-act" role="menuitem" data-act="read-one" data-idx="' +
          w.index +
          '">' +
          uiIcon('play') +
          '朗读此词</button>';
        html +=
          '<button class="cc-act" role="menuitem" data-act="detail" data-idx="' +
          w.index +
          '">' +
          uiIcon('info') +
          '查看详情</button>';
        html += '</div></div></div>';
        html += '</div>';

        // ── 卡片主体 ──
        html +=
          '<div class="cc-card-body" data-detail="' +
          w.index +
          '" role="button" tabindex="0" aria-label="查看词汇 ' +
          this._esc(w.word) +
          (w.level ? '" aria-description="JLPT ' + this._esc(w.level) : '') +
          '">';

        // 词头
        html += '<div class="cc-word" lang="ja">' + this._esc(w.word) + '</div>';

        // 读音使用文件内的纯假名字段，避免继续显示旧 OCR 合成标签。
        var reading = this._getDisplayReading(w);
        if (reading && reading !== w.word) {
          html += '<div class="cc-reading" lang="ja">' + this._esc(reading) + '</div>';
        }

        // 词性与释义
        html += '<div class="cc-pos-line' + (posLabel ? '' : ' cc-pos-only-meaning') + '">';
        if (posLabel) {
          html += '<span class="cc-pos-badge">' + this._esc(posLabel) + '</span>';
        }
        html += '<span class="cc-meaning">' + this._esc(w.meaning || '暂无释义') + '</span>';
        html += '</div>';

        // 默认同时展示日文例句与中文译文；隐藏释义时两类中文信息一起收起。
        if (w.example_sentence_ja || w.example_sentence_zh) {
          html +=
            '<div class="cc-example' +
            (!w.example_sentence_ja && w.example_sentence_zh ? ' cc-example-zh-only' : '') +
            '">';
          if (w.example_sentence_ja) {
            html +=
              '<div class="cc-example-ja" lang="ja"><span class="cc-ex-label">例：</span>' +
              this._esc(w.example_sentence_ja) +
              '</div>';
          }
          if (w.example_sentence_zh) {
            html +=
              '<div class="cc-example-zh"><span class="cc-ex-label">译：</span>' +
              this._esc(w.example_sentence_zh) +
              '</div>';
          }
          html += '</div>';
        }

        html += '</div>'; // cc-card-body

        // ── 展开区域 ──
        html += '<div class="cc-card-extra" id="cc-card-extra-' + w.index + '">';
        html += this._renderExtra(w, mgr);
        html += '</div>';

        html += '</div>'; // cc-card
      }

      html += '</div>';
      return html;
    };

    CardMode.prototype._renderExtra = function (w, mgr) {
      var html = '';

      // 语法
      if (w.grammar) {
        html +=
          '<div class="cc-xrow"><span class="cc-xlabel">语法</span><span>' +
          this._esc(w.grammar) +
          '</span></div>';
      }

      // 语体
      if (w.register) {
        var metadata = window.JPLearn && window.JPLearn.lexicalMetadata;
        var regLabel = metadata
          ? metadata.registerLabel(w.register, 'zh')
          : mgr.getLabel('register', w.register);
        html +=
          '<div class="cc-xrow"><span class="cc-xlabel">语体</span><span>' +
          this._esc(regLabel) +
          '</span></div>';
      }

      // 自他
      if (w.transitivity) {
        var metadata = window.JPLearn && window.JPLearn.lexicalMetadata;
        var transLabel = metadata
          ? metadata.transitivityLabel(w.transitivity, 'zh')
          : mgr.getLabel('transitivity', w.transitivity);
        html +=
          '<div class="cc-xrow"><span class="cc-xlabel">自他</span><span>' +
          this._esc(transLabel) +
          '</span></div>';
      }

      if (w.pos) {
        var metadata = window.JPLearn && window.JPLearn.lexicalMetadata;
        if (metadata) {
          var primary = metadata.primary(w.pos);
          var classes = metadata.classes(w.pos);
          var secondaryLabels = [];
          for (var ci = 0; ci < classes.length; ci++) {
            if (classes[ci] !== primary)
              secondaryLabels.push(
                typeof w.pos !== 'string'
                  ? metadata.posLabel({ primary: classes[ci], classes: [classes[ci]] }, 'zh')
                  : mgr.getLabel('pos', classes[ci]),
              );
          }
          if (secondaryLabels.length)
            html +=
              '<div class="cc-xrow"><span class="cc-xlabel">兼类</span><span>' +
              this._esc(secondaryLabels.join('、')) +
              '</span></div>';
          var conjugationLabel = metadata.conjugationLabel(w.pos, 'zh');
          if (conjugationLabel)
            html +=
              '<div class="cc-xrow"><span class="cc-xlabel">活用</span><span>' +
              this._esc(conjugationLabel) +
              '</span></div>';
        }
      }

      if (w.style) {
        var styleMetadata = window.JPLearn && window.JPLearn.lexicalMetadata;
        var styleLabel = styleMetadata ? styleMetadata.styleLabel(w.style, 'zh') : w.style;
        if (styleLabel)
          html +=
            '<div class="cc-xrow"><span class="cc-xlabel">风格</span><span>' +
            this._esc(styleLabel) +
            '</span></div>';
      }

      // 领域
      if (w.domain_codes && w.domain_codes.length > 0) {
        html += '<div class="cc-xrow"><span class="cc-xlabel">领域</span><span class="cc-xtags">';
        for (var i = 0; i < w.domain_codes.length; i++) {
          html +=
            '<span class="cc-chip cc-chip-domain">' +
            this._esc(mgr.getLabel('domain', w.domain_codes[i])) +
            '</span>';
        }
        html += '</span></div>';
      }

      // 语义
      if (w.semantic_tag_codes && w.semantic_tag_codes.length > 0) {
        html += '<div class="cc-xrow"><span class="cc-xlabel">语义</span><span class="cc-xtags">';
        for (var i = 0; i < w.semantic_tag_codes.length; i++) {
          html +=
            '<span class="cc-chip cc-chip-sem">' +
            this._esc(mgr.getLabel('semantic', w.semantic_tag_codes[i])) +
            '</span>';
        }
        html += '</span></div>';
      }

      // 学习状态
      var st = window.StudyStorage.getWordStatus(w.index);
      if (st.status !== 'none') {
        var statusLabels = { known: '✓ 已认识', fuzzy: '~ 模糊', unknown: '✗ 不会' };
        html +=
          '<div class="cc-xrow"><span class="cc-xlabel">学习</span><span class="cc-status-' +
          st.status +
          '">' +
          statusLabels[st.status] +
          '</span></div>';
      }

      // Debug 模式下显示原始 code
      html +=
        '<div class="cc-xrow cc-debug-row"><span class="cc-xlabel">Index</span><span>' +
        w.index +
        '</span></div>';
      if (w.domain_codes && w.domain_codes.length > 0) {
        html +=
          '<div class="cc-xrow cc-debug-row"><span class="cc-xlabel">Domain codes</span><span>' +
          this._esc(w.domain_codes.join(', ')) +
          '</span></div>';
      }
      if (w.semantic_tag_codes && w.semantic_tag_codes.length > 0) {
        html +=
          '<div class="cc-xrow cc-debug-row"><span class="cc-xlabel">Sem codes</span><span>' +
          this._esc(w.semantic_tag_codes.join(', ')) +
          '</span></div>';
      }

      if (!html) {
        html = '<div class="cc-xrow" style="color:var(--cc-muted)">无更多信息</div>';
      }

      return html;
    };

    CardMode.prototype._countHiddenMeta = function (w, status) {
      var count = 0;
      if (w.grammar) count++;
      if (w.register) count++;
      if (w.transitivity) count++;
      if (w.style) count++;
      var metadata = window.JPLearn && window.JPLearn.lexicalMetadata;
      if (metadata && w.pos) {
        var classes = metadata.classes(w.pos);
        var primary = metadata.primary(w.pos);
        if (
          classes.some(function (code) {
            return code !== primary;
          })
        )
          count++;
        if (metadata.conjugationLabel(w.pos, 'zh')) count++;
      }
      count += w.domain_codes ? w.domain_codes.length : 0;
      count += w.semantic_tag_codes ? w.semantic_tag_codes.length : 0;
      if (status && status.status !== 'none') count++;
      return count;
    };

    /* ═══════════════════════════════════════════════════════════
       分页渲染
       ═══════════════════════════════════════════════════════════ */

    CardMode.prototype._renderPagination = function (totalPages) {
      if (totalPages <= 1) return '';

      var cur = this.currentPage;
      var html = '<div class="cc-pagination">';

      // 上一页
      html +=
        '<button class="cc-page-btn' +
        (cur <= 1 ? ' disabled' : '') +
        '" data-page="' +
        (cur - 1) +
        '"' +
        (cur <= 1 ? ' disabled' : '') +
        '>' +
        uiIcon('chevron-left') +
        '上一页</button>';

      // 页码
      html += '<div class="cc-page-nums">';
      var pages = this._calcPageRange(cur, totalPages);
      for (var i = 0; i < pages.length; i++) {
        var p = pages[i];
        if (p === '...') {
          html += '<span class="cc-page-dots">…</span>';
        } else {
          html +=
            '<button class="cc-page-num' +
            (p === cur ? ' active' : '') +
            '" data-page="' +
            p +
            '">' +
            p +
            '</button>';
        }
      }
      html += '</div>';

      // 下一页
      html +=
        '<button class="cc-page-btn' +
        (cur >= totalPages ? ' disabled' : '') +
        '" data-page="' +
        (cur + 1) +
        '"' +
        (cur >= totalPages ? ' disabled' : '') +
        '>下一页' +
        uiIcon('chevron-right') +
        '</button>';

      // 跳转
      html += '<div class="cc-page-jump">';
      html += '<span>跳至</span>';
      html +=
        '<input type="number" class="cc-page-input" id="ccPageJump" min="1" max="' +
        totalPages +
        '" value="' +
        cur +
        '">';
      html += '<span>页</span>';
      html += '</div>';

      html += '</div>';
      return html;
    };

    CardMode.prototype._calcPageRange = function (cur, total) {
      if (total <= 7) {
        var arr = [];
        for (var i = 1; i <= total; i++) arr.push(i);
        return arr;
      }
      var pages = [1];
      var start = Math.max(2, cur - 2);
      var end = Math.min(total - 1, cur + 2);

      if (start > 2) pages.push('...');
      for (var i = start; i <= end; i++) pages.push(i);
      if (end < total - 1) pages.push('...');
      pages.push(total);
      return pages;
    };

    /* ═══════════════════════════════════════════════════════════
       事件绑定
       ═══════════════════════════════════════════════════════════ */
  };
})(window);
