/**
 * DataLoader: 数据加载适配器和归一化处理层
 *
 * 核心 normalize 逻辑：
 *  - JSONL 格式：每行 {model, key(JSON string), value} → 解析 key 获得词条元数据，合并 value 获得 taxonomy codes
 *  - JSON 数组格式：直接归一化
 *  - taxonomy 文件统一提取 items 数组
 *
 * [v2] 新增：分阶段加载进度回调；basePath 改为 ./data/ 兼容静态部署
 * [v3] 数据源切换至 Gemini 修订增强版 (taxonomy_annotations_gemini_3_flash_enriched.json)
 *      新增字段：reading_hiragana / meanings_zh / definition_ja_brief / example_sentences /
 *               style / freq_band / descriptive_tags_zh / usage_tags_zh /
 *               synonyms_ja / antonyms_ja / related_words_ja / confusable_words_ja /
 *               shape_similar_words_ja / sound_similar_words_ja / quality_flags /
 *               source_index / split_part / split_total
 */
class DataLoader {
  constructor(basePath) {
    // 使用 ./ 前缀确保在子目录部署时路径正确
    this.basePath = basePath || './data/';
    this.onProgress = null; // function(stage, detail)
    this.detailFiles = {};
    this.detailRequests = new Map();
  }

  _progress(stage, detail) {
    if (this.onProgress) {
      this.onProgress(stage, detail);
    }
  }

  async loadJson(filename) {
    try {
      var response = await fetch(this.basePath + filename, {
        cache: filename === 'vocab_chunks/index.json' ? 'no-cache' : 'default',
      });
      if (!response.ok) return null;
      return await response.json();
    } catch (e) {
      console.warn('[Loader] Skip: ' + filename, e.message);
      return null;
    }
  }

  async loadVocabularyChunks() {
    var manifest = await this.loadJson('vocab_chunks/index.json');
    if (
      !manifest ||
      manifest.version !== 2 ||
      !Array.isArray(manifest.chunks) ||
      !Array.isArray(manifest.details)
    ) {
      throw new Error('词汇分片索引无法加载，请联网后重试。');
    }
    var self = this;
    var groups = await Promise.all(
      manifest.chunks.map(async function (file) {
        if (!/^[a-f0-9]{64}\.json$/.test(file)) throw new Error('词汇分片路径无效');
        var data = await self.loadJson('vocab_chunks/' + file);
        if (!data || !Array.isArray(data.keys) || !Array.isArray(data.values) || !Array.isArray(data.rows)) {
          throw new Error('词汇分片无法加载，请联网后重试。');
        }
        return data.rows.map(function (row) {
          if (row.length !== data.keys.length) throw new Error('词汇分片不完整');
          var word = {};
          data.keys.forEach(function (key, i) {
            if (!Number.isInteger(row[i]) || row[i] < 0 || row[i] >= data.values.length)
              throw new Error('词汇分片索引无效');
            var value = data.values[row[i]];
            word[key] = value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value;
          });
          return word;
        });
      }),
    );
    var words = groups.flat();
    if (words.length !== manifest.count || !words.length) throw new Error('词汇分片数量不完整');
    this.detailFiles = {};
    manifest.details.forEach(function (group) {
      group.indexes.forEach(function (index) {
        self.detailFiles[index] = group.file;
      });
    });
    this.detailRequests.clear();
    return words;
  }

  async getWordDetail(word) {
    var file = this.detailFiles[word.index];
    if (!file) return word;
    if (!/^detail-[a-f0-9]{64}\.json$/.test(file)) throw new Error('词汇详情路径无效');
    if (!this.detailRequests.has(file)) {
      var self = this;
      var pending = this.loadJson('vocab_chunks/' + file)
        .then(function (data) {
          if (!data || !data[word.index]) throw new Error('词汇详情无法加载，请联网后重试。');
          return data;
        })
        .catch(function (error) {
          self.detailRequests.delete(file);
          throw error;
        });
      this.detailRequests.set(file, pending);
    }
    var details = await this.detailRequests.get(file);
    if (!details[word.index]) throw new Error('词汇详情不完整');
    return Object.assign({}, word, details[word.index]);
  }

  async loadJsonLines(filename) {
    try {
      var response = await fetch(this.basePath + filename);
      if (!response.ok) return null;
      var text = await response.text();
      var lines = text.split('\n');
      var results = [];
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;
        try {
          results.push(JSON.parse(line));
        } catch (ex) {
          /* skip malformed */
        }
      }
      return results.length > 0 ? results : null;
    } catch (e) {
      console.warn('[Loader] Skip JSONL: ' + filename, e.message);
      return null;
    }
  }

  /**
   * 从 taxonomy JSON 数据中提取 items 数组（兼容多种格式）
   */
  extractItems(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (data.items && Array.isArray(data.items)) return data.items;
    // 尝试 Object.values
    var vals = Object.values(data);
    if (vals.length > 0 && typeof vals[0] === 'object' && vals[0] !== null) {
      return vals;
    }
    return [];
  }

  async loadAllData() {
    this._progress('taxonomy', '正在加载 taxonomy 字典...');

    // 并行加载所有 taxonomy 字典（含新增的 style / freq_band）
    var results = await Promise.all([
      this.loadJson('domain_taxonomy.json'),
      this.loadJson('semantic_tag_taxonomy.json'),
      this.loadJson('pos.json'),
      this.loadJson('register.json'),
      this.loadJson('transitivity.json'),
      this.loadJson('style.json'),
      this.loadJson('freq_band.json'),
    ]);

    var domainData = results[0];
    var semanticData = results[1];
    var posData = results[2];
    var registerData = results[3];
    var transData = results[4];
    var styleData = results[5];
    var freqBandData = results[6];

    var mgr = window.taxonomyManager;
    var domainItems = this.extractItems(domainData);
    var semanticItems = this.extractItems(semanticData);
    var posItems = this.extractItems(posData);
    var registerItems = this.extractItems(registerData);
    var transItems = this.extractItems(transData);
    var styleItems = this.extractItems(styleData);
    var freqItems = this.extractItems(freqBandData);

    mgr.addTaxonomyItems(mgr.domains, domainItems);
    mgr.addTaxonomyItems(mgr.semantics, semanticItems);
    mgr.addTaxonomyItems(mgr.pos, posItems);
    mgr.addTaxonomyItems(mgr.registers, registerItems);
    mgr.addTaxonomyItems(mgr.transitivity, transItems);
    // style / freq_band: 存放在 mgr.styles / mgr.freqBands（如结构不存在则跳过）
    if (mgr.styles) mgr.addTaxonomyItems(mgr.styles, styleItems);
    if (mgr.freqBands) mgr.addTaxonomyItems(mgr.freqBands, freqItems);

    this._progress(
      'taxonomy_done',
      'Taxonomy 加载完成 (' +
        domainItems.length +
        ' 域 / ' +
        semanticItems.length +
        ' 标签 / ' +
        posItems.length +
        ' 词性)',
    );

    // ── 加载主词汇数据 ──────────────────────────────────────────────────
    this._progress('words', '正在加载词汇分片...');
    var normalizedWords = await this.loadVocabularyChunks();
    mgr.setWords(normalizedWords);

    this._progress('words_done', '词汇数据加载完成 (' + normalizedWords.length + ' 条)');
    return normalizedWords.length;
  }

  /**
   * 归一化核心：将不同格式 (JSONL with key/value, flat JSON array) 统一为 VocabEntry
   */
  normalizeWords(rawItems) {
    var items;
    if (Array.isArray(rawItems)) {
      items = rawItems;
    } else if (rawItems.items) {
      items = rawItems.items;
    } else {
      items = Object.values(rawItems);
    }

    var self = this;
    var normalized = [];

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (!item) continue;

      var entry;
      // 检测 JSONL 的 key/value 格式
      if (item.key !== undefined && item.value !== undefined) {
        entry = self._normalizeKeyValueFormat(item, i);
      } else {
        entry = self._normalizeDirectFormat(item, i);
      }

      if (entry) {
        var metadata = window.JPLearn && window.JPLearn.lexicalMetadata;
        var fields = {
          pos: entry.pos,
          transitivity: entry.transitivity,
          register: entry.register,
          style: entry.style,
        };
        if (
          metadata &&
          fields.pos &&
          typeof fields.pos === 'object' &&
          fields.transitivity &&
          typeof fields.transitivity === 'object' &&
          fields.register &&
          typeof fields.register === 'object' &&
          fields.style &&
          typeof fields.style === 'object'
        ) {
          Object.assign(entry, metadata.normalize(fields));
        }
        normalized.push(entry);
      }
    }

    return this._hideDuplicateWordReadings(normalized);
  }

  /**
   * 展示层去重：相同 word + reading_hiragana 只保留最先出现的词条。
   * 不修改源数据，不合并字段，也不改变保留词条的 index。
   */
  _hideDuplicateWordReadings(words) {
    var seen = new Set();
    var visible = [];
    // These IDs were visible before the 2026-09 content correction. Progress
    // and SRS records use the numeric ID, so keep them reachable until an
    // explicit state migration can merge genuinely equivalent entries.
    var preservedIds = new Set([6856, 7796, 9053, 9770, 9961, 10309, 10310, 10836]);

    for (var i = 0; i < words.length; i++) {
      var word = words[i];
      var key = String(word.word || '') + '\u0000' + String(word.reading_hiragana || '');
      if (seen.has(key) && !preservedIds.has(Number(word.index))) continue;
      seen.add(key);
      visible.push(word);
    }

    return visible;
  }

  /**
   * 处理 JSONL 的 {model, key(JSON string), value} 格式
   */
  _normalizeKeyValueFormat(item, fallbackIndex) {
    var keyData;
    try {
      keyData = typeof item.key === 'string' ? JSON.parse(item.key) : item.key;
    } catch (e) {
      keyData = {};
    }

    var val = item.value || {};
    var ensureArray = this._ensureArray;

    return {
      // ── 主键与来源追踪 ──────────────────────────────────────────────
      index: keyData.index !== undefined ? keyData.index : fallbackIndex,
      source_index: keyData.source_index !== undefined ? keyData.source_index : null,
      source_label: keyData.source_label || '',
      source_word: keyData.source_word || '',
      split_part: keyData.split_part || 1,
      split_total: keyData.split_total || 1,
      // ── 核心词条字段 ────────────────────────────────────────────────
      label: keyData.label || keyData.word || '词_' + fallbackIndex,
      word: keyData.word || keyData.label || '词_' + fallbackIndex,
      meaning: keyData.meaning || keyData.definition || '',
      grammar: keyData.grammar || '',
      level: keyData.level || '未知',
      legacy_theme_tags: ensureArray(keyData.legacy_theme_tags || keyData.theme_tags),
      // ── 读音与释义（Gemini 新增）────────────────────────────────────
      reading_hiragana: keyData.reading_hiragana || '',
      meanings_zh: ensureArray(keyData.meanings_zh),
      definition_ja_brief: keyData.definition_ja_brief || '',
      // ── 例句 ────────────────────────────────────────────────────────
      example_sentence_ja: keyData.example_sentence_ja || keyData.example_ja || '',
      example_sentence_zh: keyData.example_sentence_zh || keyData.example_zh || '',
      example_sentences: keyData.example_sentences || [],
      // ── Taxonomy codes ───────────────────────────────────────────────
      pos: val.pos || keyData.pos || '',
      transitivity: val.transitivity || keyData.transitivity || '',
      register: val.register || keyData.register || '',
      style: val.style || keyData.style || '',
      lexical_review: val.lexical_review || keyData.lexical_review || undefined,
      freq_band: val.freq_band || keyData.freq_band || '',
      domain_level1_codes: ensureArray(val.domain_level1_codes || keyData.domain_level1_codes),
      domain_codes: ensureArray(val.domain_codes || val.domains || keyData.domain_codes),
      semantic_tag_codes: ensureArray(
        val.semantic_tag_codes || val.semantic_tags || keyData.semantic_tag_codes,
      ),
      // ── 词汇关系（Gemini 新增）──────────────────────────────────────
      synonyms_ja: ensureArray(keyData.synonyms_ja),
      antonyms_ja: ensureArray(keyData.antonyms_ja),
      related_words_ja: ensureArray(keyData.related_words_ja),
      confusable_words_ja: ensureArray(keyData.confusable_words_ja),
      shape_similar_words_ja: ensureArray(keyData.shape_similar_words_ja),
      sound_similar_words_ja: ensureArray(keyData.sound_similar_words_ja),
      // ── 标签（Gemini 新增）──────────────────────────────────────────
      descriptive_tags_zh: ensureArray(keyData.descriptive_tags_zh),
      usage_tags_zh: ensureArray(keyData.usage_tags_zh),
      quality_flags: ensureArray(keyData.quality_flags),
    };
  }

  /**
   * 处理直接的 flat JSON 对象格式
   */
  _normalizeDirectFormat(item, fallbackIndex) {
    var ensureArray = this._ensureArray;

    return {
      // ── 主键与来源追踪 ──────────────────────────────────────────────
      index: item.index !== undefined ? item.index : fallbackIndex,
      source_index: item.source_index !== undefined ? item.source_index : null,
      source_label: item.source_label || '',
      source_word: item.source_word || '',
      split_part: item.split_part || 1,
      split_total: item.split_total || 1,
      // ── 核心词条字段 ────────────────────────────────────────────────
      label: item.label || item.word || '词_' + fallbackIndex,
      word: item.word || item.label || '词_' + fallbackIndex,
      meaning: item.meaning || item.definition || '',
      grammar: item.grammar || '',
      level: item.level || '未知',
      legacy_theme_tags: ensureArray(item.legacy_theme_tags || item.theme_tags),
      // ── 读音与释义（Gemini 新增）────────────────────────────────────
      reading_hiragana: item.reading_hiragana || '',
      meanings_zh: ensureArray(item.meanings_zh),
      definition_ja_brief: item.definition_ja_brief || '',
      // ── 例句 ────────────────────────────────────────────────────────
      example_sentence_ja: item.example_sentence_ja || item.example_ja || '',
      example_sentence_zh: item.example_sentence_zh || item.example_zh || '',
      example_sentences: item.example_sentences || [],
      // ── Taxonomy codes ───────────────────────────────────────────────
      pos: item.pos || '',
      transitivity: item.transitivity || '',
      register: item.register || '',
      style: item.style || '',
      freq_band: item.freq_band || '',
      domain_level1_codes: ensureArray(item.domain_level1_codes),
      domain_codes: ensureArray(item.domain_codes || item.domains),
      semantic_tag_codes: ensureArray(item.semantic_tag_codes || item.semantic_tags),
      // ── 词汇关系（Gemini 新增）──────────────────────────────────────
      synonyms_ja: ensureArray(item.synonyms_ja),
      antonyms_ja: ensureArray(item.antonyms_ja),
      related_words_ja: ensureArray(item.related_words_ja),
      confusable_words_ja: ensureArray(item.confusable_words_ja),
      shape_similar_words_ja: ensureArray(item.shape_similar_words_ja),
      sound_similar_words_ja: ensureArray(item.sound_similar_words_ja),
      // ── 标签（Gemini 新增）──────────────────────────────────────────
      descriptive_tags_zh: ensureArray(item.descriptive_tags_zh),
      usage_tags_zh: ensureArray(item.usage_tags_zh),
      quality_flags: ensureArray(item.quality_flags),
      lexical_review: item.lexical_review || undefined,
    };
  }

  /**
   * 确保值是 Array 类型，处理 string/null/undefined
   */
  _ensureArray(val) {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') {
      return val
        .split(',')
        .map(function (s) {
          return s.trim();
        })
        .filter(Boolean);
    }
    return [];
  }
}

window.dataLoader = new DataLoader();
