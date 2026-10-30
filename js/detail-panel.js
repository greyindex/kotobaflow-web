/**
 * DetailPanel: 词汇详情渲染（由 AnchoredDetail 作为锚点浮层承载）
 *
 * [v3] 增强：
 *   - 词条详情增加「加入学习队列」「标记不会」「收藏」按钮
 *   - 显示词条当前学习状态
 */
function DetailPanel() {
  this.container = document.getElementById('detailContent');
  this.generation = 0;
}

DetailPanel.prototype.clear = function () {
  this.generation++;
  if (window.JPLearn.anchoredDetail) window.JPLearn.anchoredDetail.close('vocab', false);
  this.container.innerHTML =
    '<div class="panel-empty-state">' +
    uiIcon('info') +
    '<strong>选择词汇查看详情</strong><p>点击词卡、列表词条或图谱节点后，这里会显示释义、例句和学习操作。</p></div>';
};

DetailPanel.prototype.showNode = function (data, anchor, options) {
  var generation = ++this.generation;
  var self = this;
  if (window.PanelLayout) window.PanelLayout.expandDetail('vocab', anchor, options);

  if (data.type === 'word') {
    window.StateView.mount(this.container, {
      kind: 'loading',
      title: data.rawData.word,
      message: '正在加载词汇详情…',
    });
    return window.dataLoader
      .getWordDetail(data.rawData)
      .then(function (word) {
        if (self.generation !== generation) return;
        self._renderWord(word);
      })
      .catch(function (error) {
        if (self.generation !== generation) return;
        window.StateView.mount(self.container, {
          kind: 'error',
          title: '词汇详情暂时无法加载',
          message: '列表与学习仍可使用，请联网后重试。',
          details: error.message,
          action: {
            id: 'retry-word-detail',
            label: '重试详情',
            onClick: function () {
              return self.showNode(data, anchor, options);
            },
          },
        });
      });
  } else {
    this._renderTaxonomy(data);
  }
};

/**
 * 渲染词条详情
 */
DetailPanel.prototype._renderWord = function (w) {
  var mgr = window.taxonomyManager;
  var studyStatus = window.StudyStorage.getWordStatus(w.index);

  var esc = this._esc.bind(this);
  var exampleAudio = window.JPLearn && window.JPLearn.exampleAudio;
  function exampleAudioButton(text) {
    return exampleAudio ? exampleAudio.button(text) : '';
  }

  // ── Word identity ───────────────────────────────────────────────────────
  var html = '<article class="vocab-detail">';
  html += '<header class="vocab-detail-head">';
  html += '<div class="vocab-detail-title-row"><div class="vocab-detail-title-copy">';
  html += '<h3 lang="ja">' + esc(w.word) + '</h3>';
  if (w.reading_hiragana) {
    html += '<div class="vocab-detail-reading" lang="ja">' + esc(w.reading_hiragana) + '</div>';
  }
  html += '</div>';
  html +=
    '<button class="vocab-detail-audio cc-btn-icon" type="button" title="朗读单词" aria-label="朗读单词" onclick="if(window.VocabTTS) window.VocabTTS.playOne(' +
    w.index +
    ", function(message){var el=document.getElementById('detailAudioStatus'); if(el) el.textContent=message;})\">" +
    uiIcon('volume') +
    '</button>';
  html += '</div>';
  html += '<span id="detailAudioStatus" class="detail-audio-status" aria-live="polite"></span>';

  html += '<div class="vocab-detail-meta">';
  html += '<span class="tag-badge vocab-detail-level">' + esc(w.level) + '</span>';
  var lexicalMetadata = window.JPLearn && window.JPLearn.lexicalMetadata;
  if (w.pos)
    html +=
      '<span class="vocab-detail-pos">' +
      esc(
        lexicalMetadata
          ? lexicalMetadata.posLabel(
              { primary: lexicalMetadata.primary(w.pos), classes: [lexicalMetadata.primary(w.pos)] },
              'zh',
            )
          : mgr.getLabel('pos', w.pos),
      ) +
      '</span>';
  if (w.split_total > 1) {
    html +=
      '<span class="tag-badge vocab-detail-split" title="来自原词条拆分">拆分 ' +
      (w.split_part || 1) +
      '/' +
      w.split_total +
      '</span>';
  }
  html += '</div>';
  html += '</header>';

  // ── Meaning: dictionary order — lead gloss, numbered senses, Japanese definition, tags ──
  html +=
    '<section class="vocab-detail-section vocab-detail-meaning" aria-labelledby="vocabDetailMeaningHeading">';
  html += '<h4 id="vocabDetailMeaningHeading" class="sr-only">释义</h4>';
  if (w.meanings_zh && w.meanings_zh.length > 1) {
    html += '<ol class="vocab-detail-meaning-list">';
    for (var mi = 0; mi < w.meanings_zh.length; mi++) {
      html += '<li>' + esc(w.meanings_zh[mi]) + '</li>';
    }
    html += '</ol>';
  } else {
    html += '<p class="vocab-detail-core">' + esc(w.meaning || '暂无释义') + '</p>';
  }
  if (w.definition_ja_brief) {
    html += '<p class="vocab-detail-ja" lang="ja">' + esc(w.definition_ja_brief) + '</p>';
  }
  function tagLine(label, tags) {
    if (!tags || !tags.length) return '';
    return (
      '<p class="vocab-detail-tags"><span class="detail-label">' +
      label +
      '</span>' +
      tags
        .map(function (t) {
          return '<span class="vocab-detail-tag">' + esc(t) + '</span>';
        })
        .join('') +
      '</p>'
    );
  }
  html += tagLine('描述', w.descriptive_tags_zh);
  html += tagLine('用法', w.usage_tags_zh);
  html += '</section>';

  // ── Study state and actions ─────────────────────────────────────────────
  html += '<section class="vocab-detail-study" aria-labelledby="vocabDetailStudyHeading">';
  html +=
    '<div class="vocab-detail-section-heading"><h4 id="vocabDetailStudyHeading">学习状态</h4><div class="detail-status-badges">';
  if (studyStatus.status === 'known')
    html += '<span class="tag-badge ok">' + uiIcon('check') + '已认识</span>';
  if (studyStatus.status === 'fuzzy') html += '<span class="tag-badge warn">~ 模糊</span>';
  if (studyStatus.status === 'unknown')
    html += '<span class="tag-badge danger">' + uiIcon('x') + '不会</span>';
  if (studyStatus.status === 'none') html += '<span class="vocab-detail-unset">尚未标记</span>';
  if (studyStatus.isFavorite)
    html += '<span class="tag-badge vocab-detail-favorite">' + uiIcon('star') + '已收藏</span>';
  html += '</div></div>';
  html += '<div class="detail-actions vocab-detail-actions">';
  html +=
    '<button class="btn-action-primary" id="detailBtnLocalGraph" data-word-index="' +
    w.index +
    '">' +
    uiIcon('network') +
    '查看局部图</button>';
  html += '<button id="detailBtnSwitchList">' + uiIcon('list') + '切到列表</button>';
  html +=
    '<button id="detailBtnMarkUnknown" data-word-index="' +
    w.index +
    '" aria-pressed="' +
    (studyStatus.status === 'unknown') +
    '">' +
    uiIcon('x-circle') +
    (studyStatus.status === 'unknown' ? '已标记不会' : '标记不会') +
    '</button>';
  html +=
    '<button id="detailBtnFavorite" data-word-index="' +
    w.index +
    '" aria-pressed="' +
    studyStatus.isFavorite +
    '">' +
    uiIcon('star') +
    (studyStatus.isFavorite ? '已收藏' : '收藏') +
    '</button>';
  html += '</div></section>';

  // ── Taxonomy ─────────────────────────────────────────────────────────────
  var metadata = window.JPLearn && window.JPLearn.lexicalMetadata;
  var posLabel = w.pos ? (metadata ? metadata.posLabel(w.pos, 'zh') : mgr.getLabel('pos', w.pos)) : '未知';
  var primaryPos = metadata ? metadata.primary(w.pos) : typeof w.pos === 'string' ? w.pos : '';
  var posClasses = metadata ? metadata.classes(w.pos) : typeof w.pos === 'string' ? [w.pos] : [];
  var secondaryPosLabels = [];
  for (var pci = 0; pci < posClasses.length; pci++) {
    if (posClasses[pci] === primaryPos) continue;
    secondaryPosLabels.push(
      metadata && typeof w.pos !== 'string'
        ? metadata.posLabel({ primary: posClasses[pci], classes: [posClasses[pci]] }, 'zh')
        : mgr.getLabel('pos', posClasses[pci]),
    );
  }
  var conjugationLabel = metadata ? metadata.conjugationLabel(w.pos, 'zh') : '';
  var registerLabel = w.register
    ? metadata
      ? metadata.registerLabel(w.register, 'zh')
      : mgr.getLabel('register', w.register)
    : '-';
  var transLabel = w.transitivity
    ? metadata
      ? metadata.transitivityLabel(w.transitivity, 'zh')
      : mgr.getLabel('transitivity', w.transitivity)
    : '-';

  html += '<section class="vocab-detail-section" aria-labelledby="vocabDetailInfoHeading">';
  html += '<h4 id="vocabDetailInfoHeading">词语信息</h4><div class="vocab-detail-info-grid">';
  html += this._field('词性', posLabel);
  if (secondaryPosLabels.length) html += this._field('兼类', secondaryPosLabels.join('、'));
  if (conjugationLabel) html += this._field('活用', conjugationLabel);
  html += this._field('语体', registerLabel);
  html += this._field('自他动', transLabel);

  // Media and genre are presented as a separate style field.
  var styleLabel = w.style ? (metadata ? metadata.styleLabel(w.style, 'zh') : w.style) : '';
  var freqLabel = w.freq_band && w.freq_band !== 'unknown' ? mgr.getLabel('freq_band', w.freq_band) : '';
  if (styleLabel || freqLabel) {
    html +=
      '<div class="detail-item"><span class="detail-label">媒介 / 体裁</span><div class="detail-value">';
    if (styleLabel) html += esc(styleLabel);
    if (styleLabel && freqLabel) html += ' · ';
    if (freqLabel) html += esc(freqLabel);
    html += '</div></div>';
  }

  // Domain tags
  var domainsHtml = '';
  var domainCodes = w.domain_codes || [];
  for (var di = 0; di < domainCodes.length; di++) {
    domainsHtml +=
      '<span class="tag-badge domain">' + esc(mgr.getLabel('domain', domainCodes[di])) + '</span>';
  }
  if (!domainsHtml) domainsHtml = '<span class="vocab-detail-unset">无</span>';
  html +=
    '<div class="detail-item vocab-detail-info-wide"><span class="detail-label">使用领域</span><div class="detail-value tag-list">' +
    domainsHtml +
    '</div></div>';

  // Semantic tag chips
  var semHtml = '';
  var semanticCodes = w.semantic_tag_codes || [];
  for (var si = 0; si < semanticCodes.length; si++) {
    semHtml +=
      '<span class="tag-badge semantic">' + esc(mgr.getLabel('semantic', semanticCodes[si])) + '</span>';
  }
  if (!semHtml) semHtml = '<span class="vocab-detail-unset">无</span>';
  html +=
    '<div class="detail-item vocab-detail-info-wide"><span class="detail-label">语义标签</span><div class="detail-value tag-list">' +
    semHtml +
    '</div></div>';
  if (w.grammar)
    html +=
      '<div class="detail-item vocab-detail-info-wide"><span class="detail-label">语法形式</span><div class="detail-value" lang="ja">' +
      esc(w.grammar) +
      '</div></div>';
  html += '</div></section>';

  // ── Example sentences ────────────────────────────────────────────────────
  var exSentences = w.example_sentences && w.example_sentences.length ? w.example_sentences : null;
  html +=
    '<section class="vocab-detail-section vocab-detail-examples" aria-labelledby="vocabDetailExamplesHeading">';
  html +=
    '<h4 id="vocabDetailExamplesHeading">例句' +
    (exSentences ? '<span>' + exSentences.length + '</span>' : '') +
    '</h4>';
  if (exSentences) {
    for (var ei = 0; ei < exSentences.length; ei++) {
      var ex = exSentences[ei];
      html += '<div class="vocab-detail-example">';
      html +=
        '<div class="vocab-detail-example-ja" lang="ja">' +
        esc(ex.ja || '') +
        exampleAudioButton(ex.ja) +
        '</div>';
      html += '<div class="vocab-detail-example-zh">' + esc(ex.zh || '') + '</div>';
      html += '</div>';
    }
  } else {
    // Fallback to single example
    if (w.example_sentence_ja)
      html +=
        '<div class="vocab-detail-example"><div class="vocab-detail-example-ja" lang="ja">' +
        esc(w.example_sentence_ja) +
        exampleAudioButton(w.example_sentence_ja) +
        '</div>' +
        (w.example_sentence_zh
          ? '<div class="vocab-detail-example-zh">' + esc(w.example_sentence_zh) + '</div>'
          : '') +
        '</div>';
    if (!w.example_sentence_ja && w.example_sentence_zh)
      html +=
        '<div class="vocab-detail-example"><div class="vocab-detail-example-zh">' +
        esc(w.example_sentence_zh) +
        '</div></div>';
    if (!w.example_sentence_ja && !w.example_sentence_zh)
      html += '<p class="vocab-detail-unset">暂无例句</p>';
  }
  html += '</section>';

  // ── Word relations ────────────────────────────────────────────────────────
  function chipList(arr, cls) {
    if (!arr || !arr.length) return '';
    return arr
      .map(function (t) {
        return '<span class="tag-badge ' + cls + '">' + esc(t) + '</span>';
      })
      .join('');
  }
  var hasSyn = w.synonyms_ja && w.synonyms_ja.length;
  var hasAnt = w.antonyms_ja && w.antonyms_ja.length;
  var hasRel = w.related_words_ja && w.related_words_ja.length;
  var hasCon = w.confusable_words_ja && w.confusable_words_ja.length;
  var hasSha = w.shape_similar_words_ja && w.shape_similar_words_ja.length;
  var hasSnd = w.sound_similar_words_ja && w.sound_similar_words_ja.length;

  if (hasSyn || hasAnt || hasRel || hasCon || hasSha || hasSnd) {
    html +=
      '<section class="vocab-detail-section vocab-detail-relations" aria-labelledby="vocabDetailRelationsHeading">';
    html += '<h4 id="vocabDetailRelationsHeading">关联词</h4>';
    if (hasSyn)
      html +=
        '<div class="detail-item"><span class="detail-label">同义词</span><div class="detail-value tag-list">' +
        chipList(w.synonyms_ja, 'neutral') +
        '</div></div>';
    if (hasAnt)
      html +=
        '<div class="detail-item"><span class="detail-label">反义词</span><div class="detail-value tag-list">' +
        chipList(w.antonyms_ja, 'domain') +
        '</div></div>';
    if (hasRel)
      html +=
        '<div class="detail-item"><span class="detail-label">相关词</span><div class="detail-value tag-list">' +
        chipList(w.related_words_ja, 'neutral') +
        '</div></div>';
    if (hasCon)
      html +=
        '<div class="detail-item"><span class="detail-label">易混词</span><div class="detail-value tag-list">' +
        chipList(w.confusable_words_ja, 'semantic') +
        '</div></div>';
    if (hasSha)
      html +=
        '<div class="detail-item"><span class="detail-label">形近词</span><div class="detail-value tag-list">' +
        chipList(w.shape_similar_words_ja, 'neutral') +
        '</div></div>';
    if (hasSnd)
      html +=
        '<div class="detail-item"><span class="detail-label">音近词</span><div class="detail-value tag-list">' +
        chipList(w.sound_similar_words_ja, 'neutral') +
        '</div></div>';
    html += '</section>';
  }

  // Debug dump (only in debug mode)
  html += '<div class="debug-field">';
  html += '<strong>[DEBUG] legacy_theme_tags</strong>';
  html += '<div>' + esc(JSON.stringify(w.legacy_theme_tags)) + '</div>';
  html += '<br><strong>[DEBUG] Raw VocabEntry</strong>';
  html += '<pre style="white-space:pre-wrap;overflow-x:auto;">' + esc(JSON.stringify(w, null, 2)) + '</pre>';
  html += '</div>';
  html += '</article>';

  this.container.innerHTML = html;
  this._bindDetailActions(w);
};

/**
 * 渲染 taxonomy 节点详情 (domain / semantic_tag / pos)
 */
DetailPanel.prototype._renderTaxonomy = function (data) {
  var typeNames = {
    domain: '领域 (Domain)',
    semantic: '语义标签 (Semantic Tag)',
    pos: '词性 (POS)',
  };
  var typeName = typeNames[data.type] || data.type;
  var wordCount = data.wordCount || 0;

  var html = '<h3>' + this._esc(data.label) + '</h3>';
  html += this._field('分类类型', typeName);
  html += this._field('代码标识 (Code)', data.code);
  html += this._field('定义描述', data.description || '暂无描述');
  if (wordCount > 0) {
    html += this._field('当前筛选范围关联词数', wordCount + ' 条');
  }
  html += '<hr class="divider">';

  // 操作按钮
  html += '<div class="detail-actions">';
  html +=
    '<button class="btn-action-primary" id="detailBtnExpandTax" data-tax-type="' +
    this._esc(data.type) +
    '" data-tax-code="' +
    this._esc(data.code) +
    '">' +
    uiIcon('network') +
    '展开局部图</button>';
  html += '<button id="detailBtnSwitchList">' + uiIcon('list') + '切到列表视图</button>';
  html += '</div>';

  html += '<hr class="divider">';
  html += '<div id="taxonomyConnectedWords"></div>';

  this.container.innerHTML = html;
  this._bindTaxonomyActions(data);
};

/**
 * 补充关联词条列表
 */
DetailPanel.prototype.appendConnectedWords = function (wordsArray, nodeData) {
  var container = document.getElementById('taxonomyConnectedWords');
  if (!container) return;

  var limit = 50;
  var total = wordsArray.length;
  var html = '<div class="detail-item">';
  html += '<span class="detail-label">当前图中关联词条 (' + total + ')</span>';
  html += '<div class="detail-value tag-list" style="margin-top:5px">';

  var count = Math.min(total, limit);
  for (var i = 0; i < count; i++) {
    var w = wordsArray[i];
    if (!w) continue;
    html +=
      '<span class="tag-badge neutral" title="' + this._esc(w.meaning) + '">' + this._esc(w.word) + '</span>';
  }

  if (total > limit) {
    html += '<br><small style="color:#94a3b8;margin-top:4px">仅展示前 ' + limit + ' 个</small>';
  }

  html += '</div></div>';
  container.innerHTML = html;
};

/**
 * 绑定词条详情的操作按钮事件
 */
DetailPanel.prototype._bindDetailActions = function (wordObj) {
  var self = this;

  var localBtn = document.getElementById('detailBtnLocalGraph');
  if (localBtn) {
    localBtn.addEventListener('click', function () {
      window.ViewMode.showLocal('word', wordObj);
      window.appConfig.applyFilters();
    });
  }

  var listBtn = document.getElementById('detailBtnSwitchList');
  if (listBtn) {
    listBtn.addEventListener('click', function () {
      window.ViewMode.set('list');
      window.appConfig.applyFilters();
    });
  }

  // 标记不会
  var unknownBtn = document.getElementById('detailBtnMarkUnknown');
  if (unknownBtn) {
    unknownBtn.addEventListener('click', function () {
      var result = window.StudyStorage.markWord(wordObj.index, 'unknown');
      if (result.status !== 'saved' && result.status !== 'alreadySaved') return;
      self._renderWord(wordObj);
    });
  }

  // 收藏
  var favBtn = document.getElementById('detailBtnFavorite');
  if (favBtn) {
    favBtn.addEventListener('click', function () {
      var status = window.StudyStorage.getWordStatus(wordObj.index);
      var result = status.isFavorite
        ? window.StudyStorage.unfavorite(wordObj.index)
        : window.StudyStorage.markWord(wordObj.index, 'favorite');
      if (result.status !== 'saved' && result.status !== 'alreadySaved') return;
      self._renderWord(wordObj);
    });
  }
};

/**
 * 绑定分类节点详情的操作按钮事件
 */
DetailPanel.prototype._bindTaxonomyActions = function (data) {
  var expandBtn = document.getElementById('detailBtnExpandTax');
  if (expandBtn) {
    expandBtn.addEventListener('click', function () {
      var type = this.getAttribute('data-tax-type');
      var code = this.getAttribute('data-tax-code');
      window.ViewMode.showLocal(type, { code: code });
      window.appConfig.applyFilters();
    });
  }

  var listBtn = document.getElementById('detailBtnSwitchList');
  if (listBtn) {
    listBtn.addEventListener('click', function () {
      window.ViewMode.set('list');
      window.appConfig.applyFilters();
    });
  }
};

/**
 * Helper: 生成一个标准 detail-item
 */
DetailPanel.prototype._field = function (label, value) {
  return (
    '<div class="detail-item">' +
    '<span class="detail-label">' +
    this._esc(label) +
    '</span>' +
    '<div class="detail-value">' +
    this._esc(value) +
    '</div>' +
    '</div>'
  );
};

/**
 * Helper: HTML 转义
 */
DetailPanel.prototype._esc = function (str) {
  return window.JPLearn.html.escape(str);
};
