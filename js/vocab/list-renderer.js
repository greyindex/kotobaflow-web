(function (root) {
  'use strict';

  var app = root.JPLearn || (root.JPLearn = {});

  app.installListRenderer = function (ListView) {
    ListView.prototype.render = function () {
      var mgr = window.taxonomyManager;
      var start = (this.currentPage - 1) * this.pageSize;
      var end = Math.min(start + this.pageSize, this.words.length);
      var pageItems = this.words.slice(start, end);
      var self = this;
      var favCount = 0;
      for (var fi = 0; fi < this.filteredWords.length; fi++) {
        if (window.StudyStorage.getWordStatus(this.filteredWords[fi].index).isFavorite) favCount++;
      }

      var html = '';

      this._renderSidebarTools(start, end, favCount);

      // 批量操作栏
      html += '<div class="list-batch-bar">';
      html += '<span id="listSelectedCount">已选 ' + this.selectedIndices.size + ' 条</span>';
      html +=
        '<button class="btn-secondary" id="btnBatchStudy"' +
        (this.selectedIndices.size === 0 ? ' disabled' : '') +
        '>' +
        uiIcon('library') +
        '学习所选</button>';
      html +=
        '<button class="btn-primary" id="btnStudyFromFilter"' +
        (this.words.length === 0 ? ' disabled' : '') +
        '>' +
        uiIcon('target') +
        '开始学习 (' +
        this.words.length +
        ')</button>';
      html += '<div style="flex:1;"></div>'; // Spacer
      html +=
        '<button class="btn-ghost browsing-icon-action" id="listReadPage" title="朗读当页单词" aria-label="朗读当页单词"' +
        (this.words.length === 0 ? ' disabled' : '') +
        '>' +
        uiIcon('play') +
        '</button>';
      html +=
        '<span id="listReadStatus" style="font-size:12px; color:var(--text-tertiary); margin-left:8px; display:inline-block; min-width:80px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; vertical-align:middle;"></span>';
      html += '</div>';

      if (!pageItems.length) {
        if (window.StateView) {
          html += window.StateView.html({
            kind: 'empty',
            className: 'list-empty-state',
            icon: this.showFavOnly ? 'star' : 'search',
            title: this.showFavOnly ? '还没有收藏词' : '当前筛选没有词条',
            message: this.showFavOnly
              ? '收藏词条后，它们会集中出现在这里。'
              : '换一个关键词或清除筛选，词汇会重新出现在这里。',
            action: {
              id: this.showFavOnly ? 'clear-list-favorites' : 'reset-vocab-filters',
              label: this.showFavOnly ? '返回全部词汇' : '清除筛选',
              icon: this.showFavOnly ? 'library' : 'rotate-ccw',
            },
          });
        } else {
          html += '<div class="list-empty-state"><p>当前筛选没有词条</p></div>';
        }
      } else {
        // 表格
        html += '<div class="list-table-wrap">';
        html += '<table class="list-table" id="listTable">';
        html += '<thead><tr>';
        html +=
          '<th class="col-check"><input type="checkbox" id="checkAll" title="全选当前页" aria-label="全选当前页"></th>';
        html += '<th class="col-idx">#</th>';
        html += '<th class="col-word">词条</th>';
        html += '<th class="col-meaning">释义</th>';
        html += '<th class="col-level">等级</th>';
        html += '<th class="col-pos">词性</th>';
        html += '<th class="col-domain">领域</th>';
        html += '<th class="col-semantic">语义标签</th>';
        html += '<th class="col-action">操作</th>';
        html += '</tr></thead>';
        html += '<tbody>';

        for (var i = 0; i < pageItems.length; i++) {
          var w = pageItems[i];
          var metadata = window.JPLearn && window.JPLearn.lexicalMetadata;
          var posLabel = w.pos
            ? metadata
              ? metadata.posLabel(
                  { primary: metadata.primary(w.pos), classes: [metadata.primary(w.pos)] },
                  'zh',
                )
              : mgr.getLabel('pos', w.pos)
            : '-';
          var domainLabel = w.domain_codes.length > 0 ? mgr.getLabel('domain', w.domain_codes[0]) : '-';
          var semanticLabel =
            w.semantic_tag_codes.length > 0 ? mgr.getLabel('semantic', w.semantic_tag_codes[0]) : '-';
          var extraDomains = w.domain_codes.length > 1 ? ' +' + (w.domain_codes.length - 1) : '';
          var extraSemantic = w.semantic_tag_codes.length > 1 ? ' +' + (w.semantic_tag_codes.length - 1) : '';

          var checked = this.selectedIndices.has(w.index) ? ' checked' : '';
          var status = window.StudyStorage.getWordStatus(w.index);
          var statusIcon = '';
          if (status.status === 'known')
            statusIcon = '<span class="c-green" title="已认识">✓<span class="sr-only">已认识</span></span>';
          else if (status.status === 'fuzzy')
            statusIcon = '<span class="c-amber" title="模糊">~<span class="sr-only">模糊</span></span>';
          else if (status.status === 'unknown')
            statusIcon = '<span class="c-red" title="不会">✗<span class="sr-only">不会</span></span>';

          html +=
            '<tr class="list-row" data-word-index="' +
            w.index +
            '" tabindex="0" aria-label="查看词汇详情：' +
            this._esc(w.word || '') +
            '">';
          html +=
            '<td class="col-check"><input type="checkbox" class="row-check" data-index="' +
            w.index +
            '"' +
            checked +
            '></td>';
          html += '<td class="col-idx">' + (start + i + 1) + '</td>';
          html += '<td class="col-word"><strong>' + this._esc(w.word) + '</strong> ' + statusIcon + '</td>';
          html +=
            '<td class="col-meaning">' +
            (this.hideMeanings ? '' : this._esc(this._truncate(w.meaning, 30))) +
            '</td>';
          html += '<td class="col-level"><span class="level-badge">' + this._esc(w.level) + '</span></td>';
          html += '<td class="col-pos">' + this._esc(posLabel) + '</td>';
          html +=
            '<td class="col-domain"><span class="tag-badge domain">' +
            this._esc(domainLabel) +
            '</span>' +
            this._esc(extraDomains) +
            '</td>';
          html +=
            '<td class="col-semantic"><span class="tag-badge semantic">' +
            this._esc(semanticLabel) +
            '</span>' +
            this._esc(extraSemantic) +
            '</td>';
          html += '<td class="col-action">';
          html +=
            '<button class="list-fav-btn' +
            (status.isFavorite ? ' active' : '') +
            '" data-fav="' +
            w.index +
            '" title="' +
            (status.isFavorite ? '取消收藏' : '收藏') +
            '" aria-label="' +
            (status.isFavorite ? '取消收藏' : '收藏') +
            '">' +
            uiIcon('star') +
            '</button>';
          html +=
            '<button class="btn-sm btn-local-graph" data-word-index="' +
            w.index +
            '" title="查看局部图" aria-label="查看局部图">' +
            uiIcon('network') +
            '</button>';
          html += '</td>';
          html += '</tr>';
        }

        html += '</tbody></table>';
        html += '</div>';
      }

      // 分页控件
      html += this._renderPagination();

      this.container.innerHTML = html;
      this._bindEvents();
      if (app.events) app.events.emit('vocab:catalog-rendered', { view: 'list' });
    };

    ListView.prototype._renderSidebarTools = function (start, end, favCount) {
      var tools = document.getElementById('vocabViewTools');
      if (!tools) return;

      var shownStart = this.words.length ? start + 1 : 0;
      var html = '<div class="sidebar-view-summary"><strong>' + this.words.length + '</strong> 条结果';
      html +=
        '<span>第 ' +
        this.currentPage +
        ' / ' +
        this.totalPages +
        ' 页 · ' +
        shownStart +
        '-' +
        end +
        '</span></div>';

      html +=
        '<button class="sidebar-tool-toggle' +
        (this.showFavOnly ? ' active favorite' : '') +
        '" id="listFavToggle" title="只显示收藏词" aria-label="只显示收藏词" aria-pressed="' +
        (this.showFavOnly ? 'true' : 'false') +
        '">' +
        uiIcon('star') +
        '显示收藏 <span>' +
        favCount +
        '</span></button>';
      html +=
        '<button class="sidebar-tool-toggle' +
        (this.hideMeanings ? ' active' : '') +
        '" id="listMeaningToggle" title="' +
        (this.hideMeanings ? '显示列表释义' : '隐藏列表释义') +
        '" aria-label="' +
        (this.hideMeanings ? '显示列表释义' : '隐藏列表释义') +
        '" aria-pressed="' +
        (this.hideMeanings ? 'true' : 'false') +
        '">' +
        uiIcon(this.hideMeanings ? 'eye' : 'eye-off') +
        (this.hideMeanings ? '显示释义' : '隐藏释义') +
        '</button>';

      html +=
        '<label class="sidebar-tool-field"><span>排序</span><select class="cc-select" id="listSortSelect">';
      var sortOptions = [
        { v: 'default', t: '默认顺序' },
        { v: 'shuffle', t: '随机顺序' },
        { v: 'index', t: '编号顺序' },
        { v: 'alpha', t: '字母顺序' },
      ];
      for (var i = 0; i < sortOptions.length; i++) {
        var sel = this.sortMode === sortOptions[i].v ? ' selected' : '';
        html += '<option value="' + sortOptions[i].v + '"' + sel + '>' + sortOptions[i].t + '</option>';
      }
      html += '</select></label>';

      if (this.sortMode === 'shuffle') {
        html +=
          '<button class="sidebar-tool-toggle" id="listReshuffle" title="重新洗牌" aria-label="重新洗牌">' +
          uiIcon('shuffle') +
          '重新洗牌</button>';
      }
      html +=
        '<label class="sidebar-tool-field"><span>每页</span><select id="pageSizeSelect" class="page-size-select">';
      var sizes = [20, 50, 100];
      for (var s = 0; s < sizes.length; s++) {
        var selected = sizes[s] === this.pageSize ? ' selected' : '';
        html += '<option value="' + sizes[s] + '"' + selected + '>' + sizes[s] + ' 条</option>';
      }
      html += '</select></label>';

      tools.innerHTML = html;
    };

    /**
     * 渲染分页条
     */
    ListView.prototype._renderPagination = function () {
      var html = '<div class="pagination">';

      // 上一页
      html +=
        '<button class="btn-page' +
        (this.currentPage <= 1 ? ' disabled' : '') +
        '" id="pagePrev">' +
        uiIcon('arrow-left') +
        '上一页</button>';

      // 页码（显示最多 7 个）
      var startPage = Math.max(1, this.currentPage - 3);
      var endPage = Math.min(this.totalPages, startPage + 6);
      if (endPage - startPage < 6) {
        startPage = Math.max(1, endPage - 6);
      }

      for (var p = startPage; p <= endPage; p++) {
        var activeClass = p === this.currentPage ? ' active' : '';
        html +=
          '<button class="btn-page btn-page-num' + activeClass + '" data-page="' + p + '">' + p + '</button>';
      }

      // 下一页
      html +=
        '<button class="btn-page' +
        (this.currentPage >= this.totalPages ? ' disabled' : '') +
        '" id="pageNext">下一页' +
        uiIcon('chevron-right') +
        '</button>';

      html += '</div>';
      return html;
    };

    /**
     * 绑定列表交互事件
     */
  };
})(window);
