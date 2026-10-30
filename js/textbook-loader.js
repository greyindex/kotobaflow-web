/**
 * textbook-loader.js
 * Runtime loader for canonical textbook lessons, vocab library, and grammar library.
 *
 * Data sources:
 *   - ./data/textbook/book_chunks/{bookId}.json + content-addressed lesson JSON
 *   - ./data/textbook/canonical_textbook_vocab/textbook_vocab_full.v3.json
 *   - ./data/textbook/canonical_textbook_vocab/textbook_vocab_full.v4.enrichment.json
 *   - ./data/textbook/canonical_textbook_grammar/textbook_grammar_full.v2.json
 */
var TextbookLoader = (function () {
  var BASE = './data/textbook/';
  var DATA_VERSION = '20261008-kotobaflow-vocab-full-1';
  var VOCAB_AUDIO_BASE = './data/gcloud_chirp3_vocab6127_female_aoede_v1/';
  var VOCAB_AUDIO_VERSION = '20260928-content-closure-2';
  var READING_AUDIO_BASE = './data/gemini38_flash_tts_reading_sections_candidate_v1/';
  var READING_AUDIO_VERSION = '20260928-content-closure-2';
  var DIALOGUE_AUDIO_BASE = './data/gemini38_flash_tts_dialogue_sections_candidate_v1/';
  var DIALOGUE_AUDIO_VERSION = '20260928-content-closure-2';
  // KotobaFlow (PUB-04) has its own audio folders; XinBian keeps the legacy ones.
  // Since 2026-10-06 (handoff docs/audio-handoff-2026-10-06.md): Chirp3-HD Aoede
  // reading, Gemini 3.8 Flash-Lite dialogue and Aoede word recordings, installed
  // (git-ignored) by tools/install_kotobaflow_audio.py. Chapter 0 kana clips
  // keep the 2026-10-04 install.
  var KOTOBA_AUDIO_VERSION = '20261006-chirp-lite-1';
  var KOTOBA_READING_AUDIO_BASE = './data/kotobaflow_reading_chirp_v1/';
  var KOTOBA_DIALOGUE_AUDIO_BASE = './data/kotobaflow_dialogue_lite_v1/';
  var KOTOBA_WORD_AUDIO_BASE = './data/kotobaflow_word_audio_v1/';
  var KOTOBA_KANA_AUDIO_BASE = './data/gemini38_flash_tts_kotobaflow_kana_candidate_v1/';
  // One theme image per KotobaFlow lesson for the page-turn reader, installed
  // (git-ignored) by tools/install_kotobaflow_unit_images.py.
  var KOTOBA_IMAGE_BASE = './data/kotobaflow_unit_images_v1/';
  var KOTOBA_IMAGE_VERSION = '20261015-flat-unit-images-1';
  var KNOWN_BOOKS = [
    { id: 'XinBian1', label: '新编 1', title: '新编日语 1', level: '第 1 册' },
    { id: 'XinBian2', label: '新编 2', title: '新编日语 2', level: '第 2 册' },
    { id: 'XinBian3', label: '新编 3', title: '新编日语 3', level: '第 3 册' },
    { id: 'XinBian4', label: '新编 4', title: '新编日语 4', level: '第 4 册' },
    { id: 'KotobaFlow1', label: '新课程 1', title: 'KotobaFlow 日语 1', level: '新课程第 1 册' },
    { id: 'KotobaFlow2', label: '新课程 2', title: 'KotobaFlow 日语 2', level: '新课程第 2 册' },
    { id: 'KotobaFlow3', label: '新课程 3', title: 'KotobaFlow 日语 3', level: '新课程第 3 册' },
    { id: 'KotobaFlow4', label: '新课程 4', title: 'KotobaFlow 日语 4', level: '新课程第 4 册' },
  ];
  var BOOKS = KNOWN_BOOKS.filter(function (book) {
    // The public site offers only the original curriculum (js/content-config.js);
    // build tools load this file without a window and see every book.
    var textbooks = typeof window !== 'undefined' && window.JPLearn && window.JPLearn.textbooks;
    return !textbooks || textbooks.isOffered(book.id);
  });

  // Frozen identities for archives from the withdrawn XinBian books. These
  // contain no lesson content; public copies must never fetch their catalogs.
  // The public-content regression compares every ID with the local catalogs.
  var ARCHIVED_LESSONS = {};
  [
    ['XinBian1', 16, 4],
    ['XinBian2', 16, 4],
    ['XinBian3', 18, 0],
    ['XinBian4', 18, 0],
  ].forEach(function (book) {
    var ids = [];
    for (var lesson = 1; lesson <= book[1]; lesson++) ids.push('lesson_' + _pad2(lesson));
    for (var review = 1; review <= book[2]; review++) ids.push('review_unit_' + _pad2(review));
    ARCHIVED_LESSONS[book[0]] = ids;
  });

  function _isKotobaBook(bookId) {
    return /^KotobaFlow[1-4]$/.test(String(bookId || ''));
  }

  function _sectionAudioSource(kind, bookId) {
    if (_isKotobaBook(bookId))
      return {
        base: kind === 'dialogue' ? KOTOBA_DIALOGUE_AUDIO_BASE : KOTOBA_READING_AUDIO_BASE,
        version: KOTOBA_AUDIO_VERSION,
      };
    return kind === 'dialogue'
      ? { base: DIALOGUE_AUDIO_BASE, version: DIALOGUE_AUDIO_VERSION }
      : { base: READING_AUDIO_BASE, version: READING_AUDIO_VERSION };
  }

  var _bookCatalogs = {};
  var _bookCatalogPromises = {};
  var _lessonPromises = {};

  var _lessonVocabPromises = {};
  var _vocabAudioByIndex = null;
  var _vocabAudioPromise = null;
  var _vocabAudioIndexPromise = null;
  var _vocabAudioChunkPromises = {};
  var _sectionAudioRows = {};
  var _unitImagePromise = null;
  var _kotobaWordAudioPromise = null;
  var _sectionAudioPromises = {};
  var _readingChunkPromises = {};
  var _kanaClipPromise = null;

  function _bookLessonKey(bookId, lessonId) {
    return String(bookId || '') + '::' + String(lessonId || '');
  }

  function _readingAudioKey(bookId, lessonId, sectionKey) {
    return String(bookId || '') + '::' + String(lessonId || '') + '::' + String(sectionKey || '');
  }

  function _pad2(value) {
    var num = parseInt(value, 10);
    return isNaN(num) ? String(value || '--') : String(num).padStart(2, '0');
  }

  function _fetchJSON(url) {
    return fetch(url).then(function (res) {
      if (!res.ok) {
        throw new Error('HTTP ' + res.status + ' for ' + url);
      }
      return res.json();
    });
  }

  function _fetchText(url) {
    return fetch(url).then(function (res) {
      if (!res.ok) {
        throw new Error('HTTP ' + res.status + ' for ' + url);
      }
      return res.text();
    });
  }

  function _withVersion(url, version) {
    return url + (url.indexOf('?') === -1 ? '?' : '&') + 'v=' + encodeURIComponent(version || DATA_VERSION);
  }

  function _cloneBooks() {
    return BOOKS.map(function (book) {
      return {
        id: book.id,
        label: book.label,
        title: book.title,
        level: book.level,
      };
    });
  }

  function _loadBookCatalog(bookId) {
    if (_bookCatalogs[bookId]) return Promise.resolve(_bookCatalogs[bookId]);
    if (_bookCatalogPromises[bookId]) return _bookCatalogPromises[bookId];

    if (
      !BOOKS.some(function (book) {
        return book.id === bookId;
      })
    )
      return Promise.reject(new Error('Unknown book: ' + bookId));
    var url = BASE + 'book_chunks/' + bookId + '.json';
    _bookCatalogPromises[bookId] = fetch(url, { cache: 'no-cache' })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status + ' for ' + url);
        return response.json();
      })
      .then(function (data) {
        if (!data || data.schema !== 1 || data.book_id !== bookId || !data.index || !data.lessons)
          throw new Error('Invalid book catalog');
        _bookCatalogs[bookId] = data;
        return _bookCatalogs[bookId];
      })
      .catch(function (err) {
        _bookCatalogPromises[bookId] = null;
        throw err;
      });

    return _bookCatalogPromises[bookId];
  }

  function _enrichmentKey(row) {
    return String(row && row.index) + '::' + String((row && row.textbook_uid) || '');
  }

  function _identityParts(value, reading) {
    return String(value || '')
      .normalize('NFKC')
      .split(/[\/·]/)
      .map(function (part) {
        part = part.replace(/\s+/g, '');
        return reading
          ? part.replace(/[ァ-ヶ]/g, function (ch) {
              return String.fromCharCode(ch.charCodeAt(0) - 0x60);
            })
          : part;
      })
      .filter(Boolean);
  }

  function _overlaps(left, right, reading) {
    var a = _identityParts(left, reading);
    var b = _identityParts(right, reading);
    return a.some(function (part) {
      return b.indexOf(part) !== -1;
    });
  }

  function _sourceSurfaceParts(value) {
    var normalized = String(value || '').normalize('NFKC');
    var parts = [];
    function add(value) {
      _identityParts(value).forEach(function (part) {
        if (part && parts.indexOf(part) === -1) parts.push(part);
      });
    }
    add(normalized);
    add(normalized.split('(')[0]);
    var groups = normalized.matchAll(/\(([^)]*)\)/g);
    for (var group of groups) {
      if (group[1].indexOf('/') === -1) add(group[1]);
    }
    return parts;
  }

  function _sourceSurfaceHead(value) {
    return String(value || '')
      .normalize('NFKC')
      .split('(')[0]
      .trim();
  }

  function _normalizeKanaReading(value) {
    return String(value || '')
      .normalize('NFKC')
      .replace(/[ァ-ヶ]/g, function (ch) {
        return String.fromCharCode(ch.charCodeAt(0) - 0x60);
      });
  }

  function _sourceSurfaceOverlaps(left, right) {
    var a = _sourceSurfaceParts(left);
    var b = _sourceSurfaceParts(right);
    return a.some(function (part) {
      return b.indexOf(part) !== -1;
    });
  }

  // Textbook index and main-vocabulary index are different namespaces.
  // A source number only narrows candidates; surface AND reading must still agree.
  function _resolveStudyVocabulary(rows, allWords) {
    var bySource = {};
    var bySurface = {};
    (allWords || []).forEach(function (word) {
      var key = String(word.source_index);
      if (!bySource[key]) bySource[key] = [];
      bySource[key].push(word);
      _identityParts(word.word).forEach(function (surface) {
        if (!bySurface[surface]) bySurface[surface] = [];
        bySurface[surface].push(word);
      });
    });
    return (rows || []).map(function (row) {
      var review = row.association_review || {};
      if (review.status === 'pending') return null;
      if (
        row.source_word &&
        !_sourceSurfaceOverlaps(row.source_word, row.word) &&
        review.status !== 'verified'
      )
        return null;
      var candidates = [];
      if (row.base_source_index != null) {
        candidates = bySource[String(row.base_source_index)] || [];
      } else {
        _identityParts(row.word).forEach(function (surface) {
          candidates = candidates.concat(bySurface[surface] || []);
        });
      }
      var seen = {};
      candidates = candidates.filter(function (word) {
        if (seen[word.index]) return false;
        seen[word.index] = true;
        return _overlaps(row.word, word.word) && _overlaps(row.reading_hiragana, word.reading_hiragana, true);
      });
      return candidates.length === 1 ? candidates[0] : null;
    });
  }

  function _sourceVocabulary(bundles) {
    var entries = [];
    function visit(value, book, lesson) {
      if (!value || typeof value !== 'object') return;
      if (value.surface && value.meaning) {
        entries.push({
          book_id: book,
          lesson_id: lesson,
          word: value.surface,
          reading: value.reading || '',
          meaning: value.meaning,
          grammar: value.pos_raw || '',
        });
      }
      Object.keys(value).forEach(function (key) {
        visit(value[key], book, lesson);
      });
    }
    Object.keys(bundles).forEach(function (book) {
      bundles[book].items.forEach(function (item) {
        visit(item.lesson, book, item.lesson.item_id);
      });
    });
    return entries;
  }

  function _guardAssociation(row, originals) {
    if (row.association_review && row.association_review.status === 'verified') return row;
    var readingOnly =
      /reading/.test(row.match_status || '') && !/exact|normalized/.test(row.match_status || '');
    var ambiguous =
      /low_confidence/.test(row.match_status || '') ||
      (/ambiguous/.test(row.match_status || '') && Number(row.match_confidence) < 0.8);
    if (!readingOnly && !ambiguous && (!row.source_word || _sourceSurfaceOverlaps(row.source_word, row.word)))
      return row;
    var sourceWord = row.source_word || row.word;
    var sourceEntries = (originals || []).filter(function (original) {
      return (
        _sourceSurfaceOverlaps(sourceWord, original.word) &&
        (row.textbook_sources || []).some(function (src) {
          return src.book_id === original.book_id && src.lesson_id === original.lesson_id;
        })
      );
    });
    var readingMatches = sourceEntries.filter(function (original) {
      return _overlaps(row.reading_hiragana, original.reading, true);
    });
    var matches = readingMatches.length ? readingMatches : sourceEntries.length === 1 ? sourceEntries : [];
    var sourceReading =
      matches.length && matches[0].reading ? _normalizeKanaReading(matches[0].reading) : row.reading_hiragana;
    var meanings = [];
    matches.forEach(function (original) {
      if (meanings.indexOf(original.meaning) === -1) meanings.push(original.meaning);
    });
    var sourceSurface = matches.length ? _sourceSurfaceHead(matches[0].word) : sourceWord;
    var keepsMatchedSurface = matches.some(function (original) {
      return _sourceSurfaceOverlaps(_sourceSurfaceHead(original.word), row.word);
    });
    if (!matches.length && _sourceSurfaceOverlaps(sourceWord, row.word)) {
      return Object.assign({}, row, {
        base_source_index: null,
        match_status: 'needs_review',
        association_review: {
          status: 'pending',
          reason: '原文索引无法唯一匹配；保留词汇库条目并隔离候选关联',
          candidate: {
            word: row.word,
            reading: row.reading_hiragana,
            meaning: row.meaning,
            base_source_index: row.base_source_index,
            confidence: row.match_confidence,
            strategy: row.resolution_strategy,
          },
          original_entries: [],
        },
      });
    }
    var resolvedWord = keepsMatchedSurface ? row.word : sourceSurface;
    var resolvedLabel = keepsMatchedSurface
      ? row.label
      : _overlaps(resolvedWord, sourceReading, true)
        ? resolvedWord
        : resolvedWord + '（' + sourceReading + '）';
    // Do not inherit definitions, examples, links or taxonomy from the rejected candidate.
    return {
      index: row.index,
      source_index: row.source_index,
      textbook_uid: row.textbook_uid,
      source_word: sourceWord,
      source_label: row.source_label,
      textbook_sources: row.textbook_sources,
      word: resolvedWord,
      label: resolvedLabel,
      reading_hiragana: sourceReading,
      meaning: meanings.join('；'),
      meanings_zh: meanings,
      grammar: matches.length ? matches[0].grammar : '',
      level: row.level,
      match_status: 'needs_review',
      base_source_index: null,
      audio_available: _overlaps(sourceReading, row.reading_hiragana, true),
      association_review: {
        status: 'pending',
        reason: '读音或低置信度关联待核对，保留教材原文',
        candidate: {
          word: row.word,
          reading: row.reading_hiragana,
          meaning: row.meaning,
          base_source_index: row.base_source_index,
          confidence: row.match_confidence,
          strategy: row.resolution_strategy,
        },
        original_entries: matches,
      },
    };
  }

  function _mergeVocabV4(v3Rows, v4Rows, overlayEntries, originals) {
    var byKey = {};
    var overlayByIndex = {};
    for (var i = 0; i < v4Rows.length; i++) {
      var item = v4Rows[i] || {};
      byKey[_enrichmentKey(item)] = item;
    }
    for (var j = 0; j < overlayEntries.length; j++) {
      var overlay = overlayEntries[j] || {};
      var vocabIndex = parseInt(overlay.vocabIndex, 10);
      if (!isNaN(vocabIndex)) overlayByIndex[vocabIndex] = overlay;
    }
    return v3Rows.map(function (row) {
      var metadataSource = row;
      row = _guardAssociation(row, originals);
      var metadataRoot =
        typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null;
      var lexicalMetadata = metadataRoot && metadataRoot.JPLearn && metadataRoot.JPLearn.lexicalMetadata;
      if (
        lexicalMetadata &&
        metadataSource &&
        metadataSource.lexical_review &&
        lexicalMetadata.reviewMatches(
          Object.assign({}, row, {
            pos: metadataSource.pos,
            transitivity: metadataSource.transitivity,
            register: metadataSource.register,
            style: metadataSource.style,
            lexical_review: metadataSource.lexical_review,
          }),
        )
      ) {
        var reviewedFields = {
          pos: metadataSource.pos,
          transitivity: metadataSource.transitivity,
          register: metadataSource.register,
          style: metadataSource.style,
        };
        try {
          lexicalMetadata.validate(reviewedFields);
          row = Object.assign({}, row, lexicalMetadata.normalize(reviewedFields), {
            lexical_review: metadataSource.lexical_review,
          });
        } catch (error) {
          // Invalid or legacy metadata must never escape the source association guard.
        }
      }
      var v4 = byKey[_enrichmentKey(row)] || null;
      var index = parseInt(row && row.index, 10);
      var merged = {};
      for (var key in row) {
        if (Object.prototype.hasOwnProperty.call(row, key)) merged[key] = row[key];
      }
      var pending = row.association_review && row.association_review.status === 'pending';
      var metadataRoot =
        typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null;
      var lexicalMetadata = metadataRoot && metadataRoot.JPLearn && metadataRoot.JPLearn.lexicalMetadata;
      merged.v4_enrichment =
        !pending &&
        v4 &&
        _overlaps(row.word, v4.word) &&
        _overlaps(row.reading_hiragana, v4.reading_hiragana, true) &&
        _v4ReviewMatchesRow(row, v4, lexicalMetadata)
          ? v4
          : null;
      var overlay = overlayByIndex[index];
      merged.jitendex_overlay =
        !pending &&
        overlay &&
        _overlaps(row.word, overlay.word) &&
        _overlaps(row.reading_hiragana, overlay.reading, true)
          ? overlay
          : null;
      return merged;
    });
  }

  function _loadVocabAudioManifest() {
    if (_vocabAudioByIndex) return Promise.resolve(_vocabAudioByIndex);
    if (_vocabAudioPromise) return _vocabAudioPromise;

    _vocabAudioPromise = _fetchText(_withVersion(VOCAB_AUDIO_BASE + 'manifest.jsonl', VOCAB_AUDIO_VERSION))
      .then(function (text) {
        var rowsByIndex = {};
        var lines = String(text || '').split(/\r?\n/);
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          var row = null;
          var index = 0;
          if (!line) continue;
          row = JSON.parse(line);
          index = parseInt(row && row.index, 10);
          if (isNaN(index)) continue;
          rowsByIndex[index] = row;
        }
        _vocabAudioByIndex = rowsByIndex;
        return _vocabAudioByIndex;
      })
      .catch(function (err) {
        _vocabAudioPromise = null;
        throw err;
      });

    return _vocabAudioPromise;
  }

  function _loadVocabAudioIndex() {
    if (_vocabAudioIndexPromise) return _vocabAudioIndexPromise;
    _vocabAudioIndexPromise = fetch(BASE + 'audio_chunks/index.json', { cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('Audio index unavailable: HTTP ' + res.status);
        return res.json();
      })
      .then(function (index) {
        if (
          !index ||
          index.schema !== 1 ||
          index.bucketSize !== 256 ||
          index.base !== VOCAB_AUDIO_BASE ||
          !index.chunks
        )
          throw new Error('Invalid audio index');
        return index;
      })
      .catch(function (err) {
        _vocabAudioIndexPromise = null;
        throw err;
      });
    return _vocabAudioIndexPromise;
  }

  function _loadVocabAudioUrl(index) {
    var numericIndex = parseInt(index, 10);
    if (isNaN(numericIndex)) return Promise.resolve('');
    return _loadVocabAudioIndex().then(function (manifest) {
      var bucket = String(Math.floor(numericIndex / manifest.bucketSize));
      var file = manifest.chunks[bucket];
      if (!file) return '';
      if (!/^[a-f0-9]{64}\.json$/.test(file)) throw new Error('Invalid audio chunk reference');
      if (!_vocabAudioChunkPromises[file]) {
        _vocabAudioChunkPromises[file] = _fetchJSON(BASE + 'audio_chunks/' + file)
          .then(function (rows) {
            if (!rows || Array.isArray(rows) || typeof rows !== 'object')
              throw new Error('Invalid audio chunk');
            Object.keys(rows).forEach(function (id) {
              if (
                String(Math.floor(Number(id) / 256)) !== bucket ||
                typeof rows[id] !== 'string' ||
                !/^audio\/[0-9]{2}xxx\/[0-9]{5}\.ogg$/.test(rows[id])
              )
                throw new Error('Invalid audio path');
            });
            return rows;
          })
          .catch(function (err) {
            delete _vocabAudioChunkPromises[file];
            throw err;
          });
      }
      return _vocabAudioChunkPromises[file].then(function (rows) {
        return rows[numericIndex]
          ? _withVersion(VOCAB_AUDIO_BASE + rows[numericIndex], VOCAB_AUDIO_VERSION)
          : '';
      });
    });
  }

  // Section manifests are cached per audio folder; rows keep their own folder
  // so a lesson never resolves media from the other curriculum.
  function _sectionAudioUrlFromRow(kind, row) {
    if (!row) return '';
    var source = _sectionAudioSource(kind, row.book);
    var output = String(row.output || '').replace(/\\/g, '/');
    var marker = source.base.slice(2);
    var markerIndex = output.indexOf(marker);
    if (markerIndex !== -1)
      return _withVersion('./' + output.slice(markerIndex).replace(/\.wav$/i, '.ogg'), source.version);

    if (!row.book || !row.lesson_id || !row.section_key) return '';
    var url =
      source.base +
      row.book +
      '/' +
      _pad2(row.lesson_no) +
      '_' +
      row.lesson_id +
      '/' +
      row.section_key +
      '/' +
      row.book +
      '_' +
      _pad2(row.lesson_no) +
      '_' +
      row.section_key +
      '_' +
      kind +
      '.ogg';
    return _withVersion(url, source.version);
  }

  function _loadSectionAudioManifest(kind, bookId) {
    var source = _sectionAudioSource(kind, bookId);
    var cacheKey = kind + '::' + source.base;
    if (_sectionAudioRows[cacheKey]) return Promise.resolve(_sectionAudioRows[cacheKey]);
    if (_sectionAudioPromises[cacheKey]) return _sectionAudioPromises[cacheKey];

    _sectionAudioPromises[cacheKey] = _fetchText(_withVersion(source.base + 'manifest.jsonl', source.version))
      .then(function (text) {
        var rowsByKey = {};
        var lines = String(text || '').split(/\r?\n/);
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line) continue;
          var row = JSON.parse(line);
          if (!row || row.status !== 'ok') continue;
          rowsByKey[_readingAudioKey(row.book, row.lesson_id, row.section_key)] = row;
        }
        _sectionAudioRows[cacheKey] = rowsByKey;
        return rowsByKey;
      })
      .catch(function (err) {
        delete _sectionAudioPromises[cacheKey];
        throw err;
      });

    return _sectionAudioPromises[cacheKey];
  }

  function _loadSectionAudioRow(kind, bookId, lessonId, sectionKey) {
    return _loadSectionAudioManifest(kind, bookId).then(function (rowsByKey) {
      return rowsByKey[_readingAudioKey(bookId, lessonId, sectionKey)] || null;
    });
  }

  // Lesson words recorded outside the legacy library: "book/lesson/index" -> file.
  function _loadKotobaWordAudio() {
    if (_kotobaWordAudioPromise) return _kotobaWordAudioPromise;
    _kotobaWordAudioPromise = _fetchJSON(
      _withVersion(KOTOBA_WORD_AUDIO_BASE + 'words.json', KOTOBA_AUDIO_VERSION),
    )
      .then(function (data) {
        if (!data || data.schema !== 1 || !data.words || typeof data.words !== 'object')
          throw new Error('Invalid KotobaFlow word audio index');
        return data.words;
      })
      .catch(function (err) {
        if (/^HTTP 404 /.test(err && err.message)) return {};
        _kotobaWordAudioPromise = null;
        throw err;
      });
    return _kotobaWordAudioPromise;
  }

  function _attachKotobaWordAudio(bookId, lessonId, rows) {
    return _loadKotobaWordAudio()
      .catch(function () {
        return {};
      })
      .then(function (words) {
        rows.forEach(function (row) {
          var entry = row && words[bookId + '/' + lessonId + '/' + row.index];
          if (!entry || !/^(audio|legacy)\/[0-9]{2}xxx\/[0-9]{5}\.ogg$/.test(entry.file)) return;
          row.vocab_audio_url = _withVersion(
            KOTOBA_WORD_AUDIO_BASE + entry.file,
            String(entry.sha256 || '').slice(0, 16),
          );
          row.audio_available = true;
        });
        return rows;
      });
  }

  function _loadUnitImages() {
    if (_unitImagePromise) return _unitImagePromise;
    _unitImagePromise = _fetchJSON(_withVersion(KOTOBA_IMAGE_BASE + 'images.json', KOTOBA_IMAGE_VERSION))
      .then(function (data) {
        if (!data || data.schema !== 1 || !data.images || typeof data.images !== 'object')
          throw new Error('Invalid unit image index');
        return data.images;
      })
      .catch(function (err) {
        // Not installed on this checkout: lessons simply have no theme image.
        if (/^HTTP 404 /.test(err && err.message)) return {};
        _unitImagePromise = null;
        throw err;
      });
    return _unitImagePromise;
  }

  function _loadKanaClips() {
    if (_kanaClipPromise) return _kanaClipPromise;
    _kanaClipPromise = _fetchJSON(_withVersion(KOTOBA_KANA_AUDIO_BASE + 'clips.json', KOTOBA_AUDIO_VERSION))
      .then(function (data) {
        if (!data || data.schema !== 1 || !Array.isArray(data.clips))
          throw new Error('Invalid kana clip index');
        var byId = {};
        data.clips.forEach(function (clip) {
          if (
            clip &&
            /^C00-[KW][0-9]{2}$/.test(clip.id) &&
            clip.audio_relpath === 'clips/' + clip.id + '.ogg'
          )
            byId[clip.id] = clip;
        });
        return byId;
      })
      .catch(function (err) {
        _kanaClipPromise = null;
        throw err;
      });
    return _kanaClipPromise;
  }

  function _loadReadingChunk(bookId, lessonId, field, prefix) {
    var key = field + '::' + _bookLessonKey(bookId, lessonId);
    if (_readingChunkPromises[key]) return _readingChunkPromises[key];
    _readingChunkPromises[key] = _loadBookCatalog(bookId)
      .then(function (catalog) {
        var file = catalog[field] && catalog[field][lessonId];
        if (typeof file !== 'string' || !new RegExp('^' + prefix + '-[a-f0-9]{64}\\.json$').test(file)) {
          throw new Error('Missing reading chunk: ' + key);
        }
        return _fetchJSON(BASE + 'book_chunks/' + file);
      })
      .then(function (data) {
        if (field === 'grammar') {
          if (!Array.isArray(data)) throw new Error('Invalid lesson grammar');
        } else if (field === 'textChunks') {
          if (
            !Array.isArray(data) ||
            !data.every(function (row) {
              return row && row.book_id === bookId && row.lesson_id === lessonId;
            })
          )
            throw new Error('Invalid lesson text chunks');
        } else if (data !== null && (!data || data.bookId !== bookId || data.lessonId !== lessonId)) {
          throw new Error('Invalid lesson Wiki reading');
        }
        return data;
      })
      .catch(function (err) {
        delete _readingChunkPromises[key];
        throw err;
      });
    return _readingChunkPromises[key];
  }

  function _buildGrammarMaps(data) {
    var _grammarPointsByKey = {};
    var _grammarPointsByUid = {};

    var points = ((data || {}).textbook || {}).points || [];
    for (var i = 0; i < points.length; i++) {
      var point = points[i] || {};
      if (point.uid) _grammarPointsByUid[point.uid] = point;
      var enriched = point.enriched || {};
      if (!enriched.source_book_id || !enriched.source_lesson_id) continue;

      var key = _bookLessonKey(enriched.source_book_id, enriched.source_lesson_id);
      if (!_grammarPointsByKey[key]) _grammarPointsByKey[key] = [];
      _grammarPointsByKey[key].push(point);
    }

    var lessonRows = ((data || {}).lessons || {}).lessons || [];
    for (var j = 0; j < lessonRows.length; j++) {
      var lesson = lessonRows[j] || {};
      if (!lesson.book_id || !lesson.lesson_id) continue;

      var lessonKey = _bookLessonKey(lesson.book_id, lesson.lesson_id);
      if (!_grammarPointsByKey[lessonKey]) _grammarPointsByKey[lessonKey] = [];

      var mapped = _grammarPointsByKey[lessonKey];
      var seen = {};
      for (var k = 0; k < mapped.length; k++) if (mapped[k] && mapped[k].uid) seen[mapped[k].uid] = true;

      var uids = lesson.grammar_uids || [];
      for (var m = 0; m < uids.length; m++) {
        var uid = uids[m];
        var mappedPoint = _grammarPointsByUid[uid];
        if (!mappedPoint || seen[uid]) continue;
        mapped.push(mappedPoint);
        seen[uid] = true;
      }
    }
    Object.keys(_grammarPointsByKey).forEach(function (key) {
      _grammarPointsByKey[key].sort(function (a, b) {
        return (a.index || 0) !== (b.index || 0)
          ? (a.index || 0) - (b.index || 0)
          : String(a.uid || '').localeCompare(String(b.uid || ''), 'en');
      });
    });
    return _grammarPointsByKey;
  }

  function _matchLessonVocab(row, bookId, lessonId) {
    var sources = row.textbook_sources || [];
    for (var i = 0; i < sources.length; i++) {
      var src = sources[i] || {};
      if (src.book_id === bookId && src.lesson_id === lessonId && src.source_type === 'lesson_vocab') {
        return true;
      }
    }
    return false;
  }

  function _v4ReviewMatchesRow(row, v4, lexicalMetadata) {
    if (!v4 || !v4.lexical_review) return true;
    if (!lexicalMetadata) return false;
    try {
      lexicalMetadata.validate({
        pos: v4.pos,
        transitivity: v4.transitivity,
        register: v4.register,
        style: v4.style,
      });
      return lexicalMetadata.reviewMatches(Object.assign({}, row, { lexical_review: v4.lexical_review }));
    } catch (error) {
      return false;
    }
  }

  return {
    // Pure compilation helpers shared with the offline asset generator.
    build: Object.freeze({
      mergeVocabulary: _mergeVocabV4,
      sourceVocabulary: _sourceVocabulary,
      matchesLesson: _matchLessonVocab,
      grammarByLesson: _buildGrammarMaps,
    }),
    resolveStudyVocabulary: _resolveStudyVocabulary,
    getBooks: function () {
      return Promise.resolve(_cloneBooks());
    },

    getBookIndex: function (bookId) {
      return _loadBookCatalog(bookId).then(function (bundle) {
        return (bundle && bundle.index) || { book_id: bookId, lessons: [] };
      });
    },

    getLesson: function (bookId, lessonId) {
      return _loadBookCatalog(bookId).then(function (catalog) {
        var file = catalog.lessons[lessonId];
        if (!file || !/^[a-f0-9]{64}\.json$/.test(file))
          throw new Error('Lesson not found: ' + bookId + '/' + lessonId);
        var key = _bookLessonKey(bookId, lessonId);
        if (!_lessonPromises[key]) {
          _lessonPromises[key] = _fetchJSON(BASE + 'book_chunks/' + file)
            .then(function (item) {
              if (!item || !item.lesson || item.lesson.item_id !== lessonId)
                throw new Error('Invalid lesson chunk');
              return item;
            })
            .catch(function (error) {
              delete _lessonPromises[key];
              throw error;
            });
        }
        return _lessonPromises[key];
      });
    },

    getLessonTextChunks: function (bookId, lessonId) {
      return _loadReadingChunk(bookId, lessonId, 'textChunks', 'text');
    },

    getLessonWikiReading: function (bookId, lessonId) {
      return _loadReadingChunk(bookId, lessonId, 'wikiReadings', 'wiki');
    },

    getLessonVocab: function (bookId, lessonId) {
      return _loadBookCatalog(bookId).then(function (catalog) {
        var file = catalog.vocabulary && catalog.vocabulary[lessonId];
        if (!file || !/^vocab-[a-f0-9]{64}\.json$/.test(file)) throw new Error('Lesson vocabulary not found');
        var key = _bookLessonKey(bookId, lessonId);
        if (!_lessonVocabPromises[key]) {
          _lessonVocabPromises[key] = _fetchJSON(BASE + 'book_chunks/' + file)
            .then(function (rows) {
              if (!Array.isArray(rows)) throw new Error('Invalid lesson vocabulary');
              return _isKotobaBook(bookId) ? _attachKotobaWordAudio(bookId, lessonId, rows) : rows;
            })
            .catch(function (error) {
              delete _lessonVocabPromises[key];
              throw error;
            });
        }
        return _lessonVocabPromises[key];
      });
    },

    getVocabAudioEntry: function (index) {
      return _loadVocabAudioManifest().then(function (rowsByIndex) {
        var numericIndex = parseInt(index, 10);
        if (isNaN(numericIndex)) return null;
        return rowsByIndex[numericIndex] || null;
      });
    },

    getVocabAudioUrl: function (index) {
      return _loadVocabAudioUrl(index);
    },

    getReadingAudioEntry: function (bookId, lessonId, sectionKey) {
      return _loadSectionAudioRow('reading', bookId, lessonId, sectionKey);
    },

    getReadingAudioUrl: function (bookId, lessonId, sectionKey) {
      return _loadSectionAudioRow('reading', bookId, lessonId, sectionKey).then(function (row) {
        return row ? _sectionAudioUrlFromRow('reading', row) : '';
      });
    },

    getDialogueAudioEntry: function (bookId, lessonId, sectionKey) {
      return _loadSectionAudioRow('dialogue', bookId, lessonId, sectionKey);
    },

    getDialogueAudioUrl: function (bookId, lessonId, sectionKey) {
      return _loadSectionAudioRow('dialogue', bookId, lessonId, sectionKey).then(function (row) {
        return _sectionAudioUrlFromRow('dialogue', row);
      });
    },
    getDialogueTiming: function (bookId, lessonId, sectionKey) {
      return _loadSectionAudioRow('dialogue', bookId, lessonId, sectionKey).then(function (row) {
        if (!row || !row.manifest) return null;

        var source = _sectionAudioSource('dialogue', bookId);
        var path = String(row.manifest).replace(/\\/g, '/');
        var marker = source.base.slice(2);
        var markerIndex = path.indexOf(marker);
        if (markerIndex === -1) return null;
        var url = _withVersion('./' + path.slice(markerIndex), source.version);

        return _fetchJSON(url).then(function (turnsData) {
          if (
            turnsData &&
            turnsData.schema === 2 &&
            turnsData.mode === 'absolute' &&
            Array.isArray(turnsData.turns)
          ) {
            return {
              turns: turnsData.turns,
              mode: 'absolute',
              duration_sec: turnsData.duration_sec,
              gap: 0,
              source_revision_mismatch: !!row.source_revision_mismatch,
            };
          }
          if (!Array.isArray(turnsData)) throw new Error('Invalid dialogue timing data');
          var gap = row.turn_gap_sec == null ? NaN : Number(row.turn_gap_sec);
          return {
            turns: turnsData,
            mode: 'durations',
            gap: Number.isFinite(gap) && gap >= 0 ? gap : 0.55,
          };
        });
      });
    },

    // KotobaFlow lesson theme image, or null when the lesson has none (or none is installed).
    getUnitImage: function (bookId, lessonId) {
      if (!_isKotobaBook(bookId)) return Promise.resolve(null);
      return _loadUnitImages().then(function (images) {
        var image = images[bookId + '/' + lessonId];
        if (!image || image.file !== bookId + '/' + lessonId + '.webp') return null;
        return {
          url: _withVersion(KOTOBA_IMAGE_BASE + image.file, String(image.webp_sha256 || '').slice(0, 16)),
          width: Number(image.width) || 0,
          height: Number(image.height) || 0,
          title: String(image.title_zh || ''),
        };
      });
    },

    // Chapter 0 kana/example clips, keyed by the table cell or example ID.
    getKanaClipUrl: function (clipId) {
      return _loadKanaClips().then(function (byId) {
        var clip = byId[String(clipId || '')];
        return clip ? _withVersion(KOTOBA_KANA_AUDIO_BASE + clip.audio_relpath, KOTOBA_AUDIO_VERSION) : '';
      });
    },

    isKotobaBook: _isKotobaBook,
    // This legacy phonetics lesson has a Chinese title despite the title_ja
    // catalog field. Keep that exception out of the Japanese font/voice run.
    getLessonTitleLanguage: function (bookId, lessonId) {
      return bookId === 'XinBian1' && lessonId === 'lesson_01' ? 'zh-CN' : 'ja';
    },
    isKnownBook: function (bookId) {
      return BOOKS.some(function (book) {
        return book.id === bookId;
      });
    },

    // Names of one offered book, or null; Today shows them without waiting (FIX-33).
    getBookMeta: function (bookId) {
      return (
        _cloneBooks().filter(function (book) {
          return book.id === bookId;
        })[0] || null
      );
    },

    isKnownArchiveBook: function (bookId) {
      return KNOWN_BOOKS.some(function (book) {
        return book.id === bookId;
      });
    },

    hasArchiveLesson: function (bookId, lessonId) {
      var offered = BOOKS.some(function (book) {
        return book.id === bookId;
      });
      if (!offered) {
        var historical = Object.prototype.hasOwnProperty.call(ARCHIVED_LESSONS, bookId)
          ? ARCHIVED_LESSONS[bookId]
          : [];
        return Promise.resolve(historical.indexOf(lessonId) !== -1);
      }
      return _loadBookCatalog(bookId).then(function (catalog) {
        return catalog.index.lessons.some(function (lesson) {
          return lesson.lesson_id === lessonId;
        });
      });
    },

    getLessonGrammar: function (bookId, lessonId) {
      return _loadReadingChunk(bookId, lessonId, 'grammar', 'grammar');
    },
  };
})();
