/**
 * GlobalSearch: a lightweight cross-module command/search entry.
 *
 * Vocabulary is already in memory at startup. Grammar and textbook indexes
 * are loaded only after the user enters the first query, so the dashboard
 * keeps its fast first paint while the search still covers all three modules.
 */
(function () {
  var overlay;
  var dialog;
  var toggle;
  var input;
  var status;
  var resultsEl;
  var results = [];
  var activeIndex = -1;
  var previousFocus = null;
  var searchTimer = 0;
  var searchToken = 0;
  var indexPromise = null;
  var grammarIndex = [];
  var textbookEntries = [];
  var grammarLoaded = false;
  var textbookLoaded = false;
  var textbookIndexes = Object.create(null);
  var grammarError = false;
  var textbookError = false;

  function normalize(value) {
    var text = String(value == null ? '' : value)
      .trim()
      .toLowerCase();
    try {
      return text.normalize('NFKC');
    } catch (err) {
      return text;
    }
  }

  function text(value) {
    if (value == null) return '';
    if (Array.isArray(value)) return value.map(text).filter(Boolean).join(' ');
    if (typeof value === 'object') {
      return Object.keys(value)
        .map(function (key) {
          return text(value[key]);
        })
        .filter(Boolean)
        .join(' ');
    }
    return String(value);
  }

  function escape(value) {
    if (window.JPLearn && window.JPLearn.html && window.JPLearn.html.escape) {
      return window.JPLearn.html.escape(String(value == null ? '' : value));
    }
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function icon(name) {
    return typeof uiIcon === 'function' ? uiIcon(name) : '';
  }

  function fieldScore(value, query) {
    var candidate = normalize(text(value));
    if (!candidate || !query) return 0;
    if (candidate === query) return 1000;
    if (candidate.indexOf(query) === 0) return 760;
    if (candidate.indexOf(query) !== -1) return 520;

    return 0;
  }

  function bestScore(fields, query) {
    var score = 0;
    for (var i = 0; i < fields.length; i++) {
      var value = fields[i];
      var weight = 1;
      if (Array.isArray(value)) {
        weight = Number(value[1]) || 1;
        value = value[0];
      }
      score = Math.max(score, fieldScore(value, query) * weight);
    }
    return score;
  }

  function wordResult(word, query) {
    var fields = [
      [word.word, 1.5],
      [word.label, 1.3],
      [word.reading_hiragana, 1.2],
      [word.meaning, 1],
      [word.definition_ja_brief, 0.95],
      [word.meanings_zh, 0.9],
      [word.synonyms_ja, 0.8],
      [word.antonyms_ja, 0.8],
      [word.related_words_ja, 0.8],
    ];
    var score = bestScore(fields, query);
    if (!score) return null;
    return {
      kind: 'vocab',
      item: word,
      query: word.word || word.label || query,
      title: word.word || word.label || '词汇',
      titleLang: word.word || word.label ? 'ja' : 'zh-CN',
      subtitle: word.reading_hiragana || word.meaning || '打开词汇详情',
      subtitleLang: word.reading_hiragana ? 'ja' : 'zh-CN',
      meta: [word.level, word.meaning].filter(Boolean).join(' · ') || '词汇',
      score: score,
    };
  }

  function searchVocabulary(query) {
    var words = (window.taxonomyManager && window.taxonomyManager.allWords) || [];
    var found = [];
    for (var i = 0; i < words.length; i++) {
      var result = wordResult(words[i] || {}, query);
      if (result) found.push(result);
    }
    found.sort(function (a, b) {
      return b.score - a.score || String(a.title).localeCompare(String(b.title), 'ja');
    });
    return found.slice(0, 5);
  }

  function grammarResult(item, query) {
    item = item || {};
    var fields = [
      [item.title, 1.45],
      [item.cleanTitle, 1.45],
      [item.clean_title, 1.45],
      [item.canonicalForm, 1.35],
      [item.canonical_form, 1.35],
      [item.headline, 1.15],
      [item.coreMeaningZh, 1],
      [item.core_meaning_zh, 1],
      [item.oneLineMemory, 0.9],
      [item.memoryFormula, 0.9],
      [item.quickTags, 0.8],
      [item.functionGroup, 0.8],
    ];
    var score = bestScore(fields, query);
    if (!score) return null;
    var title =
      item.cleanTitle || item.clean_title || item.title || item.canonicalForm || item.uid || '语法点';
    var meaning =
      item.coreMeaningZh || item.core_meaning_zh || item.headline || item.oneLineMemory || '打开语法详情';
    return {
      kind: 'grammar',
      item: item,
      uid: item.uid,
      title: title,
      titleLang: 'ja',
      subtitle: meaning,
      meta: [item.level, item.functionGroup && item.functionGroup[0]].filter(Boolean).join(' · ') || '语法',
      score: score,
    };
  }

  function searchGrammar(query) {
    var found = [];
    for (var i = 0; i < grammarIndex.length; i++) {
      var result = grammarResult(grammarIndex[i], query);
      if (result) found.push(result);
    }
    found.sort(function (a, b) {
      return b.score - a.score || String(a.title).localeCompare(String(b.title), 'ja');
    });
    return found.slice(0, 5);
  }

  function lessonResult(entry, query) {
    var item = entry.item || {};
    var fields = [
      [item.title_ja, 1.5],
      [item.lesson_label, 1.3],
      [entry.bookLabel, 1.1],
      [item.lesson_id, 0.9],
      [item.declared_sections, 0.85],
      [item.notes, 0.7],
    ];
    var score = bestScore(fields, query);
    if (!score) return null;
    var title = item.title_ja || item.lesson_label || item.lesson_id || '课文';
    var label = item.lesson_label || item.lesson_id || '课文';
    return {
      kind: 'lesson',
      item: item,
      bookId: entry.bookId,
      lessonId: item.lesson_id,
      title: title,
      titleLang: item.title_ja
        ? window.TextbookLoader.getLessonTitleLanguage(entry.bookId, item.lesson_id)
        : 'zh-CN',
      subtitle: label,
      meta: [entry.bookLabel, item.is_review_unit ? '复习单元' : '课文'].filter(Boolean).join(' · '),
      score: score,
    };
  }

  function searchLessons(query) {
    var found = [];
    for (var i = 0; i < textbookEntries.length; i++) {
      var result = lessonResult(textbookEntries[i], query);
      if (result) found.push(result);
    }
    found.sort(function (a, b) {
      return b.score - a.score || String(a.title).localeCompare(String(b.title), 'ja');
    });
    return found.slice(0, 5);
  }

  function loadTextbookIndexes() {
    if (!window.TextbookLoader || !window.TextbookLoader.getBooks)
      return Promise.reject(new Error('教材索引不可用'));
    return window.TextbookLoader.getBooks().then(function (books) {
      return Promise.all(
        books.map(function (book) {
          if (Object.prototype.hasOwnProperty.call(textbookIndexes, book.id))
            return Promise.resolve(textbookIndexes[book.id]);
          return window.TextbookLoader.getBookIndex(book.id).then(
            function (index) {
              var lessons = (index && index.lessons) || [];
              textbookIndexes[book.id] = lessons.map(function (item) {
                return { bookId: book.id, bookLabel: book.label || book.title || book.id, item: item };
              });
              return textbookIndexes[book.id];
            },
            function () {
              textbookError = true;
              return [];
            },
          );
        }),
      ).then(function (groups) {
        textbookEntries = [].concat.apply([], groups);
        textbookLoaded = !textbookError;
        return textbookEntries;
      });
    });
  }

  function ensureIndexes() {
    if (indexPromise) return indexPromise;
    if (grammarLoaded && textbookLoaded) return Promise.resolve();
    grammarError = false;
    textbookError = false;
    var grammarPromise = grammarLoaded
      ? Promise.resolve()
      : window.GrammarLoader && window.GrammarLoader.getIndex
        ? window.GrammarLoader.getIndex().then(
            function (items) {
              grammarIndex = Array.isArray(items) ? items : [];
              grammarLoaded = true;
              return grammarIndex;
            },
            function () {
              grammarError = true;
              return [];
            },
          )
        : Promise.resolve().then(function () {
            grammarError = true;
          });
    var textbookPromise = textbookLoaded
      ? Promise.resolve()
      : loadTextbookIndexes().catch(function () {
          textbookError = true;
        });
    // Deduplicate pending loads, but let a later query retry only failed sources.
    indexPromise = Promise.all([grammarPromise, textbookPromise]).then(function () {
      indexPromise = null;
    });
    return indexPromise;
  }

  function groupResults(items) {
    var groups = [
      { kind: 'vocab', label: '词汇' },
      { kind: 'grammar', label: '语法' },
      { kind: 'lesson', label: '课文' },
    ];
    return groups
      .map(function (group) {
        return {
          kind: group.kind,
          label: group.label,
          items: items.filter(function (item) {
            return item.kind === group.kind;
          }),
        };
      })
      .filter(function (group) {
        return group.items.length;
      });
  }

  function renderResults(query, loading) {
    if (!resultsEl) return;
    if (!query) {
      results = [];
      activeIndex = -1;
      resultsEl.innerHTML =
        '<div class="global-search-empty"><span class="global-search-empty-icon">' +
        icon('search') +
        '</span><strong>从一个关键词开始</strong><span>支持日文、读音、中文释义、语法形式和课名。</span></div>';
      if (status) status.textContent = '输入关键词开始搜索';
      return;
    }

    var grouped = groupResults(results);
    var html = '';
    var flatIndex = 0;
    for (var i = 0; i < grouped.length; i++) {
      var group = grouped[i];
      html +=
        '<section class="global-search-group" aria-label="' +
        escape(group.label) +
        '结果"><div class="global-search-group-heading"><span>' +
        icon(group.kind === 'vocab' ? 'library' : group.kind === 'grammar' ? 'grammar' : 'book') +
        group.label +
        '</span><small>' +
        group.items.length +
        '</small></div>';
      for (var j = 0; j < group.items.length; j++) {
        var item = group.items[j];
        var selected = flatIndex === activeIndex;
        html +=
          '<button id="global-search-result-' +
          flatIndex +
          '" class="global-search-result' +
          (selected ? ' is-active' : '') +
          '" type="button" role="option" data-search-index="' +
          flatIndex +
          '" aria-selected="' +
          (selected ? 'true' : 'false') +
          '"><span class="global-search-result-icon">' +
          icon(group.kind === 'vocab' ? 'library' : group.kind === 'grammar' ? 'grammar' : 'book') +
          '</span><span class="global-search-result-copy"><strong lang="' +
          escape(item.titleLang) +
          '">' +
          escape(item.title) +
          '</strong><span lang="' +
          escape(item.subtitleLang || 'zh-CN') +
          '">' +
          escape(item.subtitle) +
          '</span></span><span class="global-search-result-meta">' +
          escape(item.meta) +
          '</span><span class="global-search-result-enter">↵</span></button>';
        flatIndex += 1;
      }
      html += '</section>';
    }
    if (!html) {
      html =
        '<div class="global-search-empty"><span class="global-search-empty-icon">' +
        icon('search') +
        '</span><strong>没有找到相关内容</strong><span>试试日文、读音、中文释义或课名。</span></div>';
    }
    resultsEl.innerHTML = html;
    if (input) {
      if (activeIndex >= 0)
        input.setAttribute('aria-activedescendant', 'global-search-result-' + activeIndex);
      else input.removeAttribute('aria-activedescendant');
    }
    var buttons = resultsEl.querySelectorAll('[data-search-index]');
    for (var b = 0; b < buttons.length; b++) {
      buttons[b].addEventListener('click', function () {
        activateResult(parseInt(this.getAttribute('data-search-index'), 10));
      });
    }
    if (status) {
      var suffix = loading ? ' · 正在读取更多索引…' : '';
      if (grammarError || textbookError) suffix += ' · 部分索引不可用';
      status.textContent = results.length
        ? '找到 ' + results.length + ' 个结果' + suffix
        : '没有找到相关内容' + suffix;
    }
  }

  function executeSearch() {
    var query = normalize(input && input.value);
    var token = ++searchToken;
    activeIndex = -1;
    if (!query) {
      renderResults('', false);
      return;
    }
    results = searchVocabulary(query);
    renderResults(query, true);
    ensureIndexes().then(function () {
      if (token !== searchToken || !overlay || overlay.hidden) return;
      results = searchVocabulary(query).concat(searchGrammar(query), searchLessons(query));
      renderResults(query, false);
    });
  }

  function scheduleSearch() {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      searchTimer = 0;
      executeSearch();
    }, 55);
  }

  function setActive(index) {
    if (!results.length) return;
    activeIndex = (index + results.length) % results.length;
    var buttons = resultsEl.querySelectorAll('[data-search-index]');
    for (var i = 0; i < buttons.length; i++) {
      var selected = parseInt(buttons[i].getAttribute('data-search-index'), 10) === activeIndex;
      buttons[i].classList.toggle('is-active', selected);
      buttons[i].setAttribute('aria-selected', selected ? 'true' : 'false');
      if (selected && buttons[i].scrollIntoView) buttons[i].scrollIntoView({ block: 'nearest' });
    }
    input.setAttribute('aria-activedescendant', 'global-search-result-' + activeIndex);
  }

  function activateResult(index) {
    var result = results[index];
    if (!result) return;
    close();
    if (result.kind === 'vocab') {
      var switchPromise =
        window.ModuleSwitcher && window.ModuleSwitcher.switchTo
          ? window.ModuleSwitcher.switchTo('vocab')
          : Promise.resolve();
      switchPromise
        .then(function () {
          if (window.filterManager && window.filterManager.setSearch)
            return window.filterManager.setSearch(result.query);
          return null;
        })
        .then(function () {
          if (window.detailPanel && window.detailPanel.showNode) {
            var index = result.item && result.item.index;
            var anchor =
              document.querySelector('.cc-card[data-index="' + index + '"] .cc-card-body') ||
              document.querySelector('.list-row[data-word-index="' + index + '"]') ||
              document.getElementById('modBtnVocab');
            // A card below the fold would close the anchored detail on its
            // first positioning pass; bring the matched entry into view first.
            if (anchor.id !== 'modBtnVocab' && anchor.scrollIntoView)
              anchor.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' });
            window.detailPanel.showNode({ type: 'word', rawData: result.item }, anchor, {
              focus: true,
            });
          }
        });
    } else if (result.kind === 'grammar') {
      if (window.ModuleSwitcher && window.ModuleSwitcher.openGrammarResult)
        window.ModuleSwitcher.openGrammarResult(result.uid);
    } else if (result.kind === 'lesson') {
      if (window.ModuleSwitcher && window.ModuleSwitcher.openPlannedLesson) {
        window.ModuleSwitcher.openPlannedLesson({ bookId: result.bookId, lessonId: result.lessonId });
      }
    }
  }

  function open() {
    if (!overlay || !input) return;
    if (window.JPLearn.topLayer) window.JPLearn.topLayer.requestOpen('global-search');
    previousFocus = document.activeElement;
    // The collapsed rail hides the toggle (UI-ART-28); Ctrl K from the page
    // then returns to the page.
    if ((!previousFocus || previousFocus === document.body) && toggle.getClientRects().length)
      previousFocus = toggle;
    overlay.hidden = false;
    document.body.classList.add('global-search-open');
    toggle.setAttribute('aria-expanded', 'true');
    input.value = '';
    searchToken += 1;
    results = [];
    activeIndex = -1;
    renderResults('', false);
    input.focus();
  }

  function close(restoreFocus) {
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    document.body.classList.remove('global-search-open');
    toggle.setAttribute('aria-expanded', 'false');
    if (
      restoreFocus !== false &&
      previousFocus &&
      previousFocus.isConnected &&
      typeof previousFocus.focus === 'function'
    )
      previousFocus.focus();
    // With nothing to return to (Ctrl K from the page), leave the hidden
    // dialog instead of waiting for the browser to move focus off it.
    if (overlay.contains(document.activeElement)) document.activeElement.blur();
    previousFocus = null;
    if (window.JPLearn.topLayer) window.JPLearn.topLayer.release('global-search');
  }

  function handleKeydown(event) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (overlay.hidden) open();
      else close();
      return;
    }
    if (!overlay || overlay.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'Tab') {
      trapSearchFocus(event);
      return;
    }
    if (event.target !== input) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(activeIndex + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      activateResult(activeIndex >= 0 ? activeIndex : 0);
    }
  }

  function trapSearchFocus(event) {
    if (!dialog) return;
    var focusables = dialog.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    );
    if (!focusables.length) return;
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function init() {
    overlay = document.getElementById('globalSearchOverlay');
    dialog = document.getElementById('globalSearchDialog');
    toggle = document.getElementById('globalSearchToggle');
    input = document.getElementById('globalSearchInput');
    status = document.getElementById('globalSearchStatus');
    resultsEl = document.getElementById('globalSearchResults');
    if (!overlay || !toggle || !input || !resultsEl) return;

    if (window.JPLearn.topLayer) {
      window.JPLearn.topLayer.register('global-search', {
        close: function (restoreFocus) {
          close(restoreFocus);
        },
      });
    }

    toggle.addEventListener('click', function () {
      if (overlay.hidden) open();
      else close();
    });
    input.addEventListener('input', scheduleSearch);
    window.addEventListener('online', function () {
      if (!overlay.hidden && (grammarError || textbookError) && normalize(input.value)) executeSearch();
    });
    overlay.addEventListener('click', function (event) {
      if (event.target.closest && event.target.closest('[data-global-search-close]')) close();
    });
    document.addEventListener('keydown', handleKeydown);
    if (dialog) {
      dialog.addEventListener('click', function (event) {
        // The close button sits inside the dialog, so handle it before the
        // propagation stop keeps the overlay listener from seeing it.
        if (event.target.closest && event.target.closest('[data-global-search-close]')) close();
        event.stopPropagation();
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
  window.GlobalSearch = {
    open: open,
    close: close,
    search: executeSearch,
    isOpen: function () {
      return !!(overlay && !overlay.hidden);
    },
  };
})();
