/**
 * grammar-loader.js
 * Lazy split-file loader for grammar data.
 *
 * Loading strategy:
 *   1. Grammar index (849KB) — loaded when entering grammar mode (list/filter/search)
 *   2. Grammar details — UID index plus one content-addressed group (at most 16 points)
 *   3. Grammar lessons (635KB) — loaded lazily on first lesson view request
 *
 * Legacy index fallback remains; missing detail chunks use the existing retry UI.
 *
 * Exposes:
 *   - getIndex()          → Promise<Array<GrammarCardVM>>
 *   - getDetail(uid)      → Promise<GrammarDetail>
 *   - getLessons()         → Promise<Array<LessonVM>>
 *   - getLesson(lessonId)  → Promise<LessonVM|null>
 *   - getUidToLessonIds()  → Map<string, number[]>
 *   - getLessonIdToUids()  → Map<number, string[]>
 *   - getFacets()          → { levels, functionGroups, tones, registers }
 */
function normalizeGrammarExamples(detail) {
    if (!detail || !detail.uid) throw new Error('Missing grammar identity');
    var review = detail.example_language_review;
    var result = Object.assign({}, detail);
    var enriched = Object.assign({}, detail.enriched || {});
    var analysis = (enriched.example_analysis || []).map(function(example, index) {
        return Object.assign({}, example, { source_field: 'enriched.example_analysis[' + index + ']' });
    });
    var arrays = {};
    var omitted = { originalExamples: new Set(), rewrittenExamples: new Set(), analysis: new Set() };
    var aliases = new Map();
    ['originalExamples', 'rewrittenExamples'].forEach(function(field) {
        arrays[field] = (detail[field] || []).map(function(example, index) {
            if (!example || typeof example !== 'object') return example;
            return Object.assign({}, example, {
                example_id: detail.uid + '-' + field.replace('Examples', '') + '-' + (index + 1),
                source_field: field + '[' + index + ']'
            });
        });
    });
    function requireEqual(actual, expected, label) {
        if (actual !== expected) throw new Error('Grammar example review mismatch: ' + detail.uid + ' ' + label);
    }
    if (review) {
        requireEqual(review.schemaVersion, 1, 'schemaVersion');
        requireEqual(review.uid, detail.uid, 'uid');
        if (!Array.isArray(review.pairs)) throw new Error('Invalid grammar example review pairs');
        review.pairs.forEach(function(pair) {
            requireEqual(pair.uid, detail.uid, 'pair uid');
            if (!['originalExamples', 'rewrittenExamples'].includes(pair.source)) throw new Error('Invalid grammar example source');
            ['sourceIndex', 'targetIndex', 'sourceAnalysisIndex', 'targetAnalysisIndex'].forEach(function(key) {
                if (!Number.isSafeInteger(pair[key]) || pair[key] < 0) throw new Error('Invalid grammar example index');
            });
            if (pair.sourceIndex === pair.targetIndex || pair.sourceAnalysisIndex === pair.targetAnalysisIndex)
                throw new Error('Grammar example cannot refer to itself');
            var source = arrays[pair.source][pair.sourceIndex];
            var target = arrays[pair.source][pair.targetIndex];
            var sourceAnalysis = analysis[pair.sourceAnalysisIndex];
            var targetAnalysis = analysis[pair.targetAnalysisIndex];
            if (!source || !target || !sourceAnalysis || !targetAnalysis) throw new Error('Missing reviewed grammar example');
            requireEqual(source.ja, pair.sourceJa, 'source ja');
            requireEqual(source.zh, pair.sourceZh, 'source zh');
            requireEqual(target.ja, pair.targetJa, 'target ja');
            requireEqual(target.zh, pair.targetZh, 'target zh');
            requireEqual(source.example_id, pair.sourceExampleId, 'source identity');
            requireEqual(target.example_id, pair.targetExampleId, 'target identity');
            requireEqual(sourceAnalysis.example_id, pair.sourceExampleId, 'analysis source identity');
            requireEqual(targetAnalysis.example_id, pair.targetExampleId, 'analysis target identity');
            requireEqual(sourceAnalysis.ja, pair.sourceJa, 'analysis source ja');
            requireEqual(sourceAnalysis.zh, pair.sourceAnalysisZh, 'analysis source zh');
            requireEqual(targetAnalysis.ja, pair.targetAnalysisJa, 'analysis target ja');
            requireEqual(targetAnalysis.zh, pair.targetAnalysisZh, 'analysis target zh');
            if (omitted[pair.source].has(pair.sourceIndex) || aliases.has(pair.sourceExampleId))
                throw new Error('Duplicate grammar example review source');
            if (pair.source === 'originalExamples') {
                requireEqual(target.zh, '', 'original target translation must be empty');
                requireEqual(targetAnalysis.zh, '', 'original analysis translation must be empty');
                target.zh = pair.sourceJa;
                targetAnalysis.zh = pair.sourceJa;
            }
            omitted[pair.source].add(pair.sourceIndex);
            omitted.analysis.add(pair.sourceAnalysisIndex);
            aliases.set(pair.sourceExampleId, pair.targetExampleId);
        });
    }
    ['originalExamples', 'rewrittenExamples'].forEach(function(field) {
        result[field] = arrays[field].filter(function(example, index) { return !omitted[field].has(index); });
    });
    enriched.example_analysis = analysis.filter(function(example, index) { return !omitted.analysis.has(index); });
    var byId = new Map();
    enriched.example_analysis.forEach(function(example) {
        if (example.example_id) {
            if (byId.has(example.example_id)) throw new Error('Duplicate grammar example identity');
            byId.set(example.example_id, example);
        }
    });
    ['best_examples_for_memory', 'best_examples_for_contrast'].forEach(function(field) {
        if (!Array.isArray(enriched[field])) return;
        enriched[field] = enriched[field].map(function(item) {
            if (!item || typeof item !== 'object' || !item.example_id) return item;
            var id = aliases.get(item.example_id) || item.example_id;
            var example = byId.get(id);
            if (!example) throw new Error('Missing recommended grammar example: ' + detail.uid + ' ' + id);
            return Object.assign({}, item, example, { reason: item.reason, example_id: id });
        });
    });
    result.enriched = enriched;
    return result;
}

var GrammarLoader = (function() {

    var DATA_BASE = './data/';
    var INDEX_URL = DATA_BASE + 'grammar_index.json';
    var DETAILS_URL = DATA_BASE + 'grammar_chunks/';
    var LESSONS_URL = DATA_BASE + 'grammar_lessons.json';

    // Cached data
    var _index = null;          // Array<GrammarCardVM>
    var _details = null;        // Object{ uid: detail }
    var _lessons = null;        // Array<LessonRaw>
    var _lessonMap = null;      // Map<number, LessonRaw>
    var _uidToLessonIds = null; // Map<string, number[]>
    var _lessonIdToUids = null; // Map<number, string[]>
    var _facets = null;

    // Loading promises (dedup)
    var _indexPromise = null;
    var _detailsPromise = null;
    var _detailChunks = new Map();
    var _detailViews = new Map();
    var _exampleReviews = null;
    var _fallbackDetails = null;
    var _lessonsPromise = null;
    var _lastErrors = { index: null, details: null, lessons: null };

    /**
     * Fetch JSON with error handling.
     */
    function fetchJSON(url) {
        return fetch(url).then(function(res) {
            if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
            return res.json();
        });
    }

    /**
     * Load grammar index (lightweight summary data).
     */
    function loadIndex() {
        if (_indexPromise) return _indexPromise;
        _indexPromise = fetchJSON(INDEX_URL).then(function(data) {
            _index = data;
            _lastErrors.index = null;
            _buildIndexMaps();
            return _index;
        }).catch(function(err) {
            console.warn('[GrammarLoader] Index load failed, trying fallback:', err);
            _indexPromise = null;
            return _loadFallbackIndex().catch(function(fallbackErr) {
                _lastErrors.index = fallbackErr || err;
                throw fallbackErr || err;
            });
        });
        return _indexPromise;
    }

    /**
     * Build bidirectional uid↔lesson maps + facets from index data.
     */
    function _buildIndexMaps() {
        _uidToLessonIds = new Map();
        _lessonIdToUids = new Map();
        var levels = new Set();
        var functionGroups = new Set();
        var tones = new Set();
        var registers = new Set();

        for (var i = 0; i < _index.length; i++) {
            var item = _index[i];
            // uid → lessonIds
            if (item.lessonIds && item.lessonIds.length > 0) {
                _uidToLessonIds.set(item.uid, item.lessonIds);
                for (var j = 0; j < item.lessonIds.length; j++) {
                    var lid = item.lessonIds[j];
                    if (!_lessonIdToUids.has(lid)) _lessonIdToUids.set(lid, []);
                    _lessonIdToUids.get(lid).push(item.uid);
                }
            }
            // Facets
            if (item.level) levels.add(item.level);
            if (item.functionGroup) {
                for (var k = 0; k < item.functionGroup.length; k++) {
                    functionGroups.add(item.functionGroup[k]);
                }
            }
            if (item.tone) tones.add(item.tone);
            if (item.register) registers.add(item.register);
        }

        _facets = {
            levels: Array.from(levels).sort(),
            functionGroups: Array.from(functionGroups).sort(),
            tones: Array.from(tones).sort(),
            registers: Array.from(registers).sort()
        };
    }

    /**
     * Load grammar details (heavyweight, keyed by UID).
     */
    function loadDetailIndex() {
        if (!_detailsPromise) {
            _detailsPromise = fetchJSON(DETAILS_URL + 'index.json').then(function(data) {
                if (data.version !== 1 || !data.entries || !data.exampleLanguageReviews)
                    throw new Error('Invalid grammar chunk index or example review');
                _exampleReviews = data.exampleLanguageReviews;
                return data.entries;
            }).catch(function(err) {
                _detailsPromise = null;
                throw err;
            });
        }
        return _detailsPromise;
    }

    function loadDetails(uid) {
        return loadDetailIndex().then(function(entries) {
            var file = entries[uid];
            if (!file) return null;
            if (!/^[a-f0-9]{64}\.json$/.test(file)) throw new Error('Invalid grammar chunk path');
            if (!_detailChunks.has(file)) {
                var pending = fetchJSON(DETAILS_URL + file).then(function(data) {
                    if (!data || !data[uid]) throw new Error('Incomplete grammar chunk');
                    _details = Object.assign(_details || {}, data);
                    _lastErrors.details = null;
                    return data;
                }).catch(function(err) {
                    _detailChunks.delete(file);
                    throw err;
                });
                _detailChunks.set(file, pending);
            }
            return _detailChunks.get(file);
        }).catch(function(err) {
            console.warn('[GrammarLoader] Details load failed:', err);
            _lastErrors.details = err;
            return null;
        });
    }

    /**
     * Load lessons data.
     */
    function loadLessons() {
        if (_lessonsPromise) return _lessonsPromise;
        _lessonsPromise = fetchJSON(LESSONS_URL).then(function(data) {
            _lessons = data;
            _lastErrors.lessons = null;
            _lessonMap = new Map();
            for (var i = 0; i < data.length; i++) {
                _lessonMap.set(data[i].lesson_id, data[i]);
            }
            return _lessons;
        }).catch(function(err) {
            console.warn('[GrammarLoader] Lessons load failed:', err);
            _lastErrors.lessons = err;
            _lessonsPromise = null;
            return [];
        });
        return _lessonsPromise;
    }

    /**
     * Fallback: load full monolithic JSON and extract index.
     */
    function _loadFallbackIndex() {
        var FULL_URL = DATA_BASE + 'grammar_enriched_gemini_full_refined.json';
        return fetchJSON(FULL_URL).then(function(data) {
            var pts = (data.textbook || {}).points || data.points || [];
            // Build index from full data
            _index = [];
            _details = {};
            for (var i = 0; i < pts.length; i++) {
                var pt = pts[i];
                var e = pt.enriched || {};
                var rs = e.render_summary || {};
                _index.push({
                    uid: pt.uid, level: pt.level, index: pt.index, title: pt.title,
                    cleanTitle: e.clean_title || pt.title,
                    grammarId: e.grammar_id || pt.uid,
                    canonicalForm: e.canonical_form || '',
                    coreMeaningZh: e.core_meaning_zh || '',
                    oneLineMemory: e.one_line_memory || '',
                    headline: rs.headline || '',
                    memoryFormula: rs.memory_formula || '',
                    keyWarning: rs.key_warning || '',
                    quickTags: rs.quick_tags || [],
                    functionGroup: e.function_group || [],
                    semanticFunctionTags: e.semantic_function_tags || [],
                    tone: e.tone || '', register: e.register || '',
                    hasConfusable: !!(e.confusable_grammar && e.confusable_grammar.length),
                    hasAntiExamples: !!(e.anti_examples && e.anti_examples.length),
                    hasExamTraps: !!(e.exam_traps && e.exam_traps.length),
                    hasWarnings: !!(e.warnings && e.warnings.length),
                    lessonIds: [],
                    commonCollocations: e.common_collocations || [],
                    patternFrames: e.pattern_frames || []
                });
                _details[pt.uid] = pt;
            }
            // Extract lessons from fallback
            var lw = data.lessons || {};
            var lsList = (typeof lw === 'object' && !Array.isArray(lw)) ? (lw.lessons || []) : (lw || []);
            _lessons = lsList;
            _lessonMap = new Map();
            for (var j = 0; j < lsList.length; j++) {
                _lessonMap.set(lsList[j].lesson_id, lsList[j]);
                var uids = lsList[j].grammar_uids || [];
                for (var k = 0; k < uids.length; k++) {
                    // Patch index entries with lesson IDs
                    for (var m = 0; m < _index.length; m++) {
                        if (_index[m].uid === uids[k]) {
                            _index[m].lessonIds.push(lsList[j].lesson_id);
                        }
                    }
                }
            }
            _buildIndexMaps();
            _lastErrors.index = null;
            _lastErrors.details = null;
            _lastErrors.lessons = null;
            _fallbackDetails = _details;
            // Detail review mappings still come from the canonical chunk index.
            _detailsPromise = null;
            _exampleReviews = null;
            _detailViews.clear();
            _lessonsPromise = Promise.resolve(_lessons);
            return _index;
        });
    }

    // Public API
    return {
        getIndex: function() {
            return _index ? Promise.resolve(_index) : loadIndex();
        },
        // Grammar point count for summaries. The small detail-chunk index lists
        // the same UIDs as grammar_index.json, so Today skips the full index.
        getCount: function() {
            if (_index) return Promise.resolve(_index.length);
            return loadDetailIndex().then(function(entries) {
                return Object.keys(entries).length;
            });
        },
        getDetail: function(uid) {
            if (_detailViews.has(uid)) return Promise.resolve(_detailViews.get(uid));
            return loadDetailIndex().then(function() {
                if (_details && _details[uid]) return _details[uid];
                return loadDetails(uid).then(function(data) { return data ? (data[uid] || null) : null; });
            }).then(function(detail) {
                if (!detail) return null;
                var reviewed = normalizeGrammarExamples(Object.assign({}, detail, {
                    example_language_review: _exampleReviews[uid] || null
                }));
                _detailViews.set(uid, reviewed);
                _lastErrors.details = null;
                return reviewed;
            }).catch(function(error) {
                console.warn('[GrammarLoader] Example review failed:', error);
                _lastErrors.details = error;
                // The optional legacy source predates this review. If the review
                // index is unavailable, keep its previously readable detail and
                // retain the error; do not cache or claim language repair there.
                if (!_exampleReviews && _fallbackDetails && _fallbackDetails[uid]) {
                    return _fallbackDetails[uid];
                }
                return null;
            });
        },
        getLessons: function() {
            if (_lessons) return Promise.resolve(_lessons);
            return loadLessons();
        },
        getLesson: function(lessonId) {
            if (_lessonMap && _lessonMap.has(lessonId)) {
                return Promise.resolve(_lessonMap.get(lessonId));
            }
            return loadLessons().then(function() {
                return _lessonMap ? (_lessonMap.get(lessonId) || null) : null;
            });
        },
        getUidToLessonIds: function() { return _uidToLessonIds; },
        getLessonIdToUids: function() { return _lessonIdToUids; },
        getFacets: function() { return _facets; },
        isIndexLoaded: function() { return !!_index; },
        isDetailsLoaded: function() { return !!_details; },
        isLessonsLoaded: function() { return !!_lessons; },
        getLastError: function(kind) { return _lastErrors[kind] || null; },
        reset: function(kind) {
            if (!kind || kind === 'index' || kind === 'all') {
                _index = null;
                _indexPromise = null;
                _facets = null;
                _uidToLessonIds = null;
                _lessonIdToUids = null;
                if (kind === 'all' || !kind) {
                    _details = null;
                    _detailsPromise = null;
                    _lessons = null;
                    _lessonsPromise = null;
                }
            }
            if (kind === 'details' || kind === 'all' || !kind) {
                _details = null;
                _detailsPromise = null;
                _detailChunks.clear();
                _detailViews.clear();
                _exampleReviews = null;
                _fallbackDetails = null;
            }
            if (kind === 'lessons' || kind === 'all' || !kind) {
                _lessons = null;
                _lessonMap = null;
                _lessonsPromise = null;
            }
            if (kind === 'index' || kind === 'all' || !kind) _lastErrors.index = null;
            if (kind === 'details' || kind === 'all' || !kind) _lastErrors.details = null;
            if (kind === 'lessons' || kind === 'all' || !kind) _lastErrors.lessons = null;
        }
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { normalizeGrammarExamples: normalizeGrammarExamples };
}
