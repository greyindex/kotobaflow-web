#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_INPUT = 'data/textbook/canonical_textbook_vocab/textbook_vocab_full.v3.json';
const DEFAULT_ENRICHED = 'data/taxonomy_annotations_gemini_3_flash_enriched.json';

const TAXONOMY_FILES = {
  pos: 'data/pos.json',
  transitivity: 'data/transitivity.json',
  register: 'data/register.json',
  style: 'data/style.json',
  freq_band: 'data/freq_band.json',
  domain_codes: 'data/domain_taxonomy.json',
  semantic_tag_codes: 'data/semantic_tag_taxonomy.json',
};

const ARRAY_FIELDS = [
  'meanings_zh',
  'legacy_theme_tags',
  'example_sentences',
  'domain_level1_codes',
  'domain_codes',
  'semantic_tag_codes',
  'descriptive_tags_zh',
  'usage_tags_zh',
  'synonyms_ja',
  'antonyms_ja',
  'related_words_ja',
  'confusable_words_ja',
  'shape_similar_words_ja',
  'sound_similar_words_ja',
  'quality_flags',
];

const PATCH_ARRAY_FIELDS = [
  'meanings_zh',
  'example_sentences',
  'domain_codes',
  'semantic_tag_codes',
  'descriptive_tags_zh',
  'usage_tags_zh',
  'synonyms_ja',
  'antonyms_ja',
  'related_words_ja',
  'confusable_words_ja',
  'shape_similar_words_ja',
  'sound_similar_words_ja',
];

const PATCH_STRING_FIELDS = [
  'meaning',
  'definition_ja_brief',
  'example_sentence_ja',
  'example_sentence_zh',
  'pos',
  'transitivity',
  'register',
  'style',
  'freq_band',
];

const LATIN_WORD_RE = /[A-Za-z]{3,}/;
const CJK_RE = /[\u3400-\u9fff]/;
const HIRAGANA_RE = /[\u3040-\u309f]/;
const KATAKANA_RE = /[\u30a0-\u30ff]/;
let REQUEST_TIMEOUT_MS = 90000;
let FETCH_MAX_ATTEMPTS = 2;

const ENGLISH_TRANSLATIONS = {
  'when': '什么时候',
  'who': '谁',
  'what': '什么',
  'you': '你',
  'they': '他们',
  'dislike': '讨厌；不喜欢',
  'carp streamer': '鲤鱼旗',
  'konjac': '魔芋',
  'sukiyaki': '寿喜烧',
  'for example': '例如；比如',
  'to put on': '放上；载',
  'glasses': '眼镜',
  'please come in': '请进',
  'please, do come in': '请进',
  'happy new year': '新年好；恭贺新禧',
  'to guide': '引导；带领',
  'torch relay': '圣火传递',
  'sightseeing bus': '观光巴士',
  'mailman': '邮递员',
  'to become hungry': '肚子饿',
  'nice to meet you / please treat me well': '请多关照',
  'travel story': '旅行见闻',
  'tv tower': '电视塔',
  'large bridge': '大桥',
  'to hurry someone up': '催促；催逼',
  'to lie face down': '趴下；俯卧',
  'thank you for your hard work': '辛苦了',
  'earphones': '耳机',
  'per person': '每人；人均',
  'counter for books': '册；本的量词',
  'paper cutting art': '剪纸',
  'to move around': '到处移动；走来走去',
  'to mistake; to misunderstand': '弄错；误解',
  'family gathering; happy family circle': '阖家团圆',
  'early; ahead of time': '提前；早些',
  'month by month; monthly': '每月；逐月',
  'unavoidably; out of necessity': '不得已；无可奈何',
  'to have a feeling; to have a hunch': '感觉；觉得',
  'automobile; car': '汽车',
  'guidepost; signpost': '路标；指路牌',
  'brief moment': '片刻；一瞬间',
  'with a smile': '微微一笑地',
  'expo': '博览会',
  'guided tour': '导览游',
  'guide map': '导览地图',
  'coin-operated locker': '投币式储物柜',
  'speech contest': '演讲比赛',
  'playing cards': '扑克牌',
  'handbag': '手提包',
  'pavilion': '展馆',
  'volunteer': '志愿者',
  'river cruise': '河上巡游',
  'level up; improvement': '升级；提高',
  'logo': '标志',
  'first semester': '第一学期',
  'organizer': '主办者',
  'beside': '旁边',
  'to cheer up': '鼓励；使振作',
  'needless worry': '杞人忧天；多余的担心',
  'caller': '呼叫者；叫号的人',
  'serious injury': '重伤',
  'can imagine': '可以想象',
  'emergency': '急救；紧急',
  'performance': '正式演出；正式比赛',
  'visitor': '来场者；到场者',
  'to be formal': '拘泥形式；讲究礼节',
  'incomparable': '无法相比',
  'consideration': '体贴；照顾',
  'different culture': '异文化',
  'to be exhausted': '筋疲力尽',
  'harmonious': '和睦；融洽',
  'deportment': '举止；仪态',
  'to let die out': '断绝；使消失',
  'feeling of tension': '紧张感',
  "to puff out one's chest": '挺胸；自豪',
  'adapting to circumstances': '随机应变',
  'fusion': '融合',
  'to praise highly': '大加赞扬',
  'opening; start (of an event)': '开幕；开始',
  'dilapidated house; hovel': '破旧房屋；陋屋',
  'dimly lit': '昏暗的',
  'narration': '旁白；解说',
  'landing place': '登陆地',
  'to live in seclusion': '隐居；避世',
  'theme song': '主题曲',
  'pair / duo': '两人组',
  'buddhist scriptures': '佛典；佛经',
  'monk / priest': '僧侣',
  'appetizer': '前菜；开胃菜',
  'birthplace': '出生地；出身地',
  'to shut one\'s mouth': '闭口不言',
  'to start talking': '开口说话',
  'similarly': '同样地',
  'to name': '命名',
  'business talk': '业务洽谈；商务谈话',
  'heroic deed': '英勇事迹',
  'to wind around': '缠绕',
  'seat': '座位',
  "to catch one's breath": '喘口气；缓过气',
  "one's mind": '内心；心意',
  'punishment': '惩罚',
  'religious precepts': '戒律',
  'preceptor (buddhism)': '戒师',
  'scattered': '零散的；分散的',
  'civilization and enlightenment': '文明开化',
  'film adaptation': '电影改编',
  'rainstorm': '暴雨',
  'forever; for a long time': '永远；长久',
  'endless; ceaseless': '无尽；不断',
  'to feel guilty': '感到内疚',
  'to become lively': '热闹起来；活跃起来',
  'instruction; command': '指示；命令',
  "to fix one's eyes on; to pay attention to": '凝视；注视',
  'to enshrine; to worship': '供奉；祭祀',
  'smoothly; without causing friction': '圆滑地；顺利地',
  'monument': '纪念碑',
  'localized; limited to a specific area': '局部的；限于特定地区',
  'thaw; melting of snow': '解冻；融雪',
};

function usage() {
  console.log(`Usage:
  node tools/textbook_vocab_repair.js audit [--input=${DEFAULT_INPUT}]
  node tools/textbook_vocab_repair.js local [--input=${DEFAULT_INPUT}] [--out=PATH | --write] [--mark]
  node tools/textbook_vocab_repair.js compare [--input=${DEFAULT_INPUT}] [--sample=12] [--batch=6]
  node tools/textbook_vocab_repair.js llm --provider=deepseek|gemini [--input=${DEFAULT_INPUT}] [--out=PATH] [--limit=N] [--batch=8] [--untilComplete] [--maxPasses=N] [--maxConsecutiveBatchFailures=N] [--mark]

Environment for online repair:
  DEEPSEEK_API_KEY for provider=deepseek
  GEMINI_API_KEY or GOOGLE_API_KEY for provider=gemini
`);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (const raw of argv) {
    if (!raw.startsWith('--')) {
      args._.push(raw);
      continue;
    }
    const eq = raw.indexOf('=');
    if (eq === -1) {
      args[raw.slice(2)] = true;
    } else {
      args[raw.slice(2, eq)] = raw.slice(eq + 1);
    }
  }
  return args;
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  return [value];
}

function uniqueStrings(values) {
  const out = [];
  const seen = new Set();
  for (const value of ensureArray(values)) {
    if (typeof value === 'object' && value !== null) {
      out.push(value);
      continue;
    }
    const text = String(value == null ? '' : value).trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function isEmpty(value) {
  return value == null || value === '' || (Array.isArray(value) && value.length === 0);
}

function hasLatin(value) {
  return LATIN_WORD_RE.test(String(value || ''));
}

function hasCjk(value) {
  return CJK_RE.test(String(value || ''));
}

function keyOf(entry) {
  return `${normalizeText(entry.word)}|${normalizeText(entry.reading_hiragana)}`;
}

function normalizeText(value) {
  return String(value || '')
    .replace(/[〜～]/g, '~')
    .replace(/[（）]/g, (ch) => (ch === '（' ? '(' : ')'))
    .trim();
}

function loadTaxonomies() {
  const taxonomies = {};
  for (const [name, filePath] of Object.entries(TAXONOMY_FILES)) {
    const data = loadJson(filePath);
    const items = Array.isArray(data) ? data : data.items || [];
    taxonomies[name] = {
      items,
      codes: new Set(items.map((item) => item.code).filter(Boolean)),
      labels: new Map(items.map((item) => [item.code, item.label_zh || item.code])),
      parents: new Map(items.map((item) => [item.code, item.parent_code || null])),
    };
  }
  return taxonomies;
}

function loadEnrichedMap(filePath) {
  if (!fs.existsSync(filePath)) return new Map();
  const enriched = loadJson(filePath);
  const map = new Map();
  for (const entry of enriched) {
    const key = keyOf(entry);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(entry);
  }
  return map;
}

function audit(entries) {
  const fields = [
    'meaning',
    'meanings_zh',
    'definition_ja_brief',
    'grammar',
    'level',
    'legacy_theme_tags',
    'example_sentence_ja',
    'example_sentence_zh',
    'example_sentences',
    'pos',
    'transitivity',
    'register',
    'style',
    'freq_band',
    'domain_level1_codes',
    'domain_codes',
    'semantic_tag_codes',
    'descriptive_tags_zh',
    'usage_tags_zh',
    'synonyms_ja',
    'antonyms_ja',
    'related_words_ja',
    'confusable_words_ja',
    'shape_similar_words_ja',
    'sound_similar_words_ja',
    'quality_flags',
  ];
  const empty = Object.fromEntries(fields.map((field) => [field, 0]));
  const unknown = Object.fromEntries(fields.map((field) => [field, 0]));
  const latin = { meaning: 0, meanings_zh: 0, definition_ja_brief: 0 };
  const flags = {};
  let needsLlm = 0;
  for (const entry of entries) {
    for (const field of fields) {
      const value = entry[field];
      if (isEmpty(value)) empty[field]++;
      if (value === 'unknown' || (Array.isArray(value) && value.length === 1 && value[0] === 'unknown')) {
        unknown[field]++;
      }
    }
    if (hasLatin(entry.meaning)) latin.meaning++;
    if (hasLatin(ensureArray(entry.meanings_zh).join(' '))) latin.meanings_zh++;
    if (hasLatin(entry.definition_ja_brief)) latin.definition_ja_brief++;
    for (const flag of ensureArray(entry.quality_flags)) flags[flag] = (flags[flag] || 0) + 1;
    if (needsModelRepair(entry)) needsLlm++;
  }
  return { total: entries.length, empty, unknown, latin, needsLlm, quality_flags: sortObject(flags) };
}

function sortObject(value) {
  return Object.fromEntries(Object.entries(value).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function needsModelRepair(entry) {
  return (
    hasLatin(entry.meaning) ||
    hasLatin(ensureArray(entry.meanings_zh).join(' ')) ||
    hasLatin(entry.definition_ja_brief) ||
    isEmpty(entry.example_sentence_ja) ||
    isEmpty(entry.example_sentence_zh) ||
    isEmpty(entry.domain_codes) ||
    isEmpty(entry.semantic_tag_codes) ||
    isEmpty(entry.descriptive_tags_zh) ||
    entry.pos === 'unknown' ||
    entry.style === 'unknown' ||
    entry.freq_band === 'unknown'
  );
}

function addFlag(entry, flag) {
  const flags = uniqueStrings(entry.quality_flags);
  if (!flags.includes(flag)) flags.push(flag);
  entry.quality_flags = flags;
}

function replaceIfBetter(entry, field, value, reason, changes) {
  if (value == null) return;
  const current = entry[field];
  const next = Array.isArray(value) ? uniqueStrings(value) : String(value).trim();
  if (Array.isArray(next) && next.length === 0) return;
  if (!Array.isArray(next) && next === '') return;
  const shouldReplace =
    isEmpty(current) ||
    current === 'unknown' ||
    (field === 'meaning' && hasLatin(current)) ||
    (field === 'definition_ja_brief' && hasLatin(current)) ||
    (Array.isArray(current) && hasLatin(current.join(' ')));
  if (!shouldReplace) return;
  if (JSON.stringify(current) === JSON.stringify(next)) return;
  entry[field] = next;
  changes.push(`${field}:${reason}`);
}

function applyLocalRepair(entries, taxonomies, enrichedMap, options = {}) {
  const out = clone(entries);
  const report = {
    changedEntries: 0,
    changes: {},
    enrichedExactMatchesUsed: 0,
  };

  for (const entry of out) {
    const changes = [];
    for (const field of ARRAY_FIELDS) {
      if (field === 'example_sentences') {
        entry[field] = normalizeExampleSentences(entry[field]);
      } else {
        entry[field] = uniqueStrings(entry[field]);
      }
    }

    const enriched = chooseEnriched(enrichedMap.get(keyOf(entry)));
    if (enriched) {
      const beforeCount = changes.length;
      copyFromEnriched(entry, enriched, changes);
      if (changes.length > beforeCount) report.enrichedExactMatchesUsed++;
    }

    repairMeanings(entry, changes);
    repairExamples(entry, changes);
    repairPosAndUsage(entry, changes);
    repairDerivedTaxonomy(entry, taxonomies, changes);

    if (changes.length) {
      if (options.mark) addFlag(entry, 'local_repaired');
      report.changedEntries++;
      for (const change of changes) report.changes[change] = (report.changes[change] || 0) + 1;
    }
  }

  report.changes = sortObject(report.changes);
  return { entries: out, report };
}

function chooseEnriched(candidates) {
  if (!candidates || candidates.length !== 1) return null;
  return candidates[0];
}

function copyFromEnriched(entry, enriched, changes) {
  for (const field of [
    'meaning',
    'meanings_zh',
    'definition_ja_brief',
    'example_sentence_ja',
    'example_sentence_zh',
    'example_sentences',
    'pos',
    'transitivity',
    'register',
    'style',
    'freq_band',
    'domain_codes',
    'semantic_tag_codes',
    'descriptive_tags_zh',
    'usage_tags_zh',
    'synonyms_ja',
    'antonyms_ja',
    'related_words_ja',
    'confusable_words_ja',
    'shape_similar_words_ja',
    'sound_similar_words_ja',
  ]) {
    replaceIfBetter(entry, field, enriched[field], 'enriched_exact', changes);
  }
}

function normalizeExampleSentences(value) {
  const out = [];
  const seen = new Set();
  for (const item of ensureArray(value)) {
    if (!item || typeof item !== 'object') continue;
    const ja = String(item.ja || item.example_sentence_ja || '').trim();
    const zh = String(item.zh || item.example_sentence_zh || '').trim();
    if (!ja) continue;
    const key = `${ja}\n${zh}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ja, zh });
  }
  return out;
}

function repairMeanings(entry, changes) {
  let meanings = uniqueStrings(entry.meanings_zh);
  const meaning = String(entry.meaning || '').trim();

  if (hasLatin(meaning)) {
    const translated = translateEnglish(meaning);
    const zhCandidate = meanings.find((item) => !hasLatin(item) && hasCjk(item));
    const replacement = zhCandidate || translated;
    if (replacement) {
      entry.meaning = replacement;
      changes.push('meaning:latin_to_zh');
      if (!meanings.some((item) => item === replacement)) meanings.unshift(replacement);
    }
  }

  meanings = meanings.map((item) => {
    if (!hasLatin(item)) return item;
    return translateEnglish(item) || item;
  });
  const hasNonLatin = meanings.some((item) => !hasLatin(item));
  if (hasNonLatin) meanings = meanings.filter((item) => !hasLatin(item));
  meanings = uniqueStrings(meanings);
  if (meanings.length && JSON.stringify(entry.meanings_zh) !== JSON.stringify(meanings)) {
    entry.meanings_zh = meanings;
    changes.push('meanings_zh:latin_to_zh');
  }
  if (isEmpty(entry.meanings_zh) && entry.meaning && !hasLatin(entry.meaning)) {
    entry.meanings_zh = [entry.meaning];
    changes.push('meanings_zh:from_meaning');
  }

  if (hasLatin(entry.definition_ja_brief)) {
    const primary = ensureArray(entry.meanings_zh).find((item) => item && !hasLatin(item)) || entry.meaning;
    if (primary && !hasLatin(primary)) {
      entry.definition_ja_brief = `教材語彙。中国語注は「${primary}」。`;
      changes.push('definition_ja_brief:remove_latin');
    }
  }
}

function translateEnglish(value) {
  const key = String(value || '').trim().toLowerCase();
  return ENGLISH_TRANSLATIONS[key] || null;
}

function repairExamples(entry, changes) {
  const examples = normalizeExampleSentences(entry.example_sentences);
  if (!entry.example_sentence_ja && examples.length && examples[0].ja) {
    entry.example_sentence_ja = examples[0].ja;
    changes.push('example_sentence_ja:from_examples');
  }
  if (!entry.example_sentence_zh && examples.length) {
    const firstZh = examples.find((example) => example.zh);
    if (firstZh) {
      entry.example_sentence_zh = firstZh.zh;
      changes.push('example_sentence_zh:from_examples');
    }
  }
  if (!examples.length && entry.example_sentence_ja) {
    entry.example_sentences = [{ ja: entry.example_sentence_ja, zh: entry.example_sentence_zh || '' }];
    changes.push('example_sentences:from_single');
  }
}

function repairPosAndUsage(entry, changes) {
  const inferredPos = inferPos(entry);
  if ((entry.pos === 'unknown' || !entry.pos) && inferredPos) {
    entry.pos = inferredPos;
    changes.push('pos:from_grammar');
  }

  const inferredTransitivity = inferTransitivity(entry);
  if (inferredTransitivity && entry.transitivity !== inferredTransitivity) {
    entry.transitivity = inferredTransitivity;
    changes.push('transitivity:from_grammar');
  }

  if (!entry.style || entry.style === 'unknown') {
    entry.style = inferStyle(entry);
    changes.push('style:coarse_inference');
  }

  if (!entry.freq_band || entry.freq_band === 'unknown') {
    entry.freq_band = inferFreqBand(entry.level);
    changes.push('freq_band:from_level');
  }
}

function inferPos(entry) {
  const grammar = String(entry.grammar || '');
  const word = String(entry.word || '');
  if (/寒暄|慣|惯|連語|连语|組|组|句|表現|表达/.test(grammar)) return 'expression';
  if (/代/.test(grammar)) return 'pronoun';
  if (/叹|嘆|感動/.test(grammar)) return 'interjection';
  if (/接続|接续|接詞|连词|連詞/.test(grammar)) return 'conjunction';
  if (/副/.test(grammar)) return 'adverb';
  if (/形動|形动|ナ形/.test(grammar)) return 'adjective_na';
  if (/形/.test(grammar)) return 'adjective_i';
  if (/自|他|五|一|サ変|サ|動/.test(grammar)) return 'verb';
  if (/名|専|专|接尾|助数/.test(grammar)) return 'noun';
  if (/連体|连体/.test(grammar) && /^(こ|そ|あ|ど|こん|そん|あん|どん)/.test(word)) return 'pronoun';
  return null;
}

function inferTransitivity(entry) {
  const grammar = String(entry.grammar || '');
  if (entry.pos !== 'verb') return 'not_applicable';
  const hasTransitive = /他/.test(grammar);
  const hasIntransitive = /自/.test(grammar);
  if (hasTransitive && hasIntransitive) return 'both';
  if (hasTransitive) return 'transitive';
  if (hasIntransitive) return 'intransitive';
  return null;
}

function inferStyle(entry) {
  const grammar = String(entry.grammar || '');
  if (/寒暄|叹|嘆|感動/.test(grammar)) return 'spoken';
  if (entry.register === 'spoken' || entry.register === 'colloquial' || entry.register === 'informal') return 'spoken';
  if (entry.register === 'written' || entry.register === 'formal') return 'written';
  if (entry.register === 'literary') return 'literary';
  return 'educational';
}

function inferFreqBand(level) {
  if (level === 'N5' || level === 'N4') return 'high';
  if (level === 'N3' || level === 'N2') return 'mid';
  return 'unknown';
}

function repairDerivedTaxonomy(entry, taxonomies, changes) {
  entry.domain_codes = filterCodes(entry.domain_codes, taxonomies.domain_codes.codes);
  entry.semantic_tag_codes = filterCodes(entry.semantic_tag_codes, taxonomies.semantic_tag_codes.codes);

  const level1 = deriveDomainLevel1(entry.domain_codes, taxonomies.domain_codes.parents);
  if (level1.length && JSON.stringify(entry.domain_level1_codes) !== JSON.stringify(level1)) {
    entry.domain_level1_codes = level1;
    changes.push('domain_level1_codes:derived');
  }
}

function filterCodes(values, allowed) {
  return uniqueStrings(values).filter((code) => allowed.has(code));
}

function deriveDomainLevel1(domainCodes, parents) {
  const out = [];
  const seen = new Set();
  for (const code of uniqueStrings(domainCodes)) {
    let current = code;
    let guard = 0;
    while (parents.has(current) && parents.get(current) && guard < 10) {
      current = parents.get(current);
      guard++;
    }
    const root = current.includes('.') ? current.split('.')[0] : current;
    if (root && root !== 'unknown' && !seen.has(root)) {
      seen.add(root);
      out.push(root);
    }
  }
  return out;
}

function selectModelTargets(entries, limit) {
  const targets = entries.filter(needsModelRepair);
  const prioritized = targets.sort((a, b) => {
    const score = (entry) =>
      (isEmpty(entry.domain_codes) ? 10 : 0) +
      (isEmpty(entry.semantic_tag_codes) ? 10 : 0) +
      (hasLatin(entry.meaning) || hasLatin(ensureArray(entry.meanings_zh).join(' ')) ? 8 : 0) +
      (isEmpty(entry.example_sentence_zh) ? 4 : 0) +
      (entry.pos === 'unknown' ? 3 : 0) +
      (entry.freq_band === 'unknown' ? 2 : 0) +
      (entry.style === 'unknown' ? 1 : 0);
    return score(b) - score(a) || Number(a.index || 0) - Number(b.index || 0);
  });
  return Number.isFinite(limit) && limit > 0 ? prioritized.slice(0, limit) : prioritized;
}

function compactEntry(entry) {
  return {
    index: entry.index,
    word: entry.word,
    reading_hiragana: entry.reading_hiragana,
    label: entry.label,
    meaning: entry.meaning,
    meanings_zh: entry.meanings_zh,
    definition_ja_brief: entry.definition_ja_brief,
    grammar: entry.grammar,
    level: entry.level,
    example_sentence_ja: entry.example_sentence_ja,
    example_sentence_zh: entry.example_sentence_zh,
    example_sentences: entry.example_sentences,
    pos: entry.pos,
    transitivity: entry.transitivity,
    register: entry.register,
    style: entry.style,
    freq_band: entry.freq_band,
    domain_codes: entry.domain_codes,
    semantic_tag_codes: entry.semantic_tag_codes,
    descriptive_tags_zh: entry.descriptive_tags_zh,
    usage_tags_zh: entry.usage_tags_zh,
    synonyms_ja: entry.synonyms_ja,
    antonyms_ja: entry.antonyms_ja,
    related_words_ja: entry.related_words_ja,
    confusable_words_ja: entry.confusable_words_ja,
    shape_similar_words_ja: entry.shape_similar_words_ja,
    sound_similar_words_ja: entry.sound_similar_words_ja,
  };
}

function makePrompt(entries, taxonomies) {
  const domainList = taxonomyPromptList(taxonomies.domain_codes);
  const semanticList = taxonomyPromptList(taxonomies.semantic_tag_codes);
  const system = `You repair Japanese textbook vocabulary JSON.
Return only a JSON object: {"items":[...]}.
Do not add markdown.
Do not modify index, word, reading_hiragana, grammar, or level.
All Chinese fields must be Simplified Chinese, not English.
definition_ja_brief must be short Japanese.
Use only these enum values:
pos=${Array.from(taxonomies.pos.codes).join(', ')}
transitivity=${Array.from(taxonomies.transitivity.codes).join(', ')}
register=${Array.from(taxonomies.register.codes).join(', ')}
style=${Array.from(taxonomies.style.codes).join(', ')}
freq_band=${Array.from(taxonomies.freq_band.codes).join(', ')}
domain_codes=${domainList}
semantic_tag_codes=${semanticList}
For each item fill: meaning, meanings_zh, definition_ja_brief, example_sentence_ja, example_sentence_zh, example_sentences, pos, transitivity, register, style, freq_band, domain_codes, semantic_tag_codes, descriptive_tags_zh, usage_tags_zh, synonyms_ja, antonyms_ja, related_words_ja, confusable_words_ja, shape_similar_words_ja, sound_similar_words_ja.
domain_codes, semantic_tag_codes, descriptive_tags_zh, example_sentence_ja, and example_sentence_zh must never be empty.
For proper nouns, use the closest domain and a broad semantic tag such as state, relationship, communication, or movement.
Keep arrays short: domain_codes 1-2, semantic_tag_codes 1-4, meanings_zh 1-3, examples 1-3.
If the source has a Japanese example without Chinese, translate it instead of replacing it.`;
  const user = `Repair these entries:\n${JSON.stringify(entries.map(compactEntry), null, 2)}`;
  return { system, user };
}

function taxonomyPromptList(taxonomy) {
  return taxonomy.items
    .map((item) => `${item.code}(${item.label_zh || item.code})`)
    .join(', ');
}

async function callProvider(provider, model, prompt) {
  if (provider === 'deepseek') return callDeepSeek(model, prompt);
  if (provider === 'gemini') return callGemini(model, prompt);
  throw new Error(`Unknown provider: ${provider}`);
}

async function callDeepSeek(model, prompt) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY is missing');
  const response = await fetchJson('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      temperature: 0.1,
      max_tokens: 16000,
      stream: false,
      thinking: { type: 'disabled' },
      response_format: { type: 'json_object' },
    }),
  });
  return response.choices?.[0]?.message?.content || '';
}

async function callGemini(model, prompt) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY or GOOGLE_API_KEY is missing');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetchJson(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: prompt.system }] },
      contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingLevel: 'low' },
      },
    }),
  });
  return response.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
}

async function fetchJson(url, init) {
  if (typeof fetch !== 'function') {
    throw new Error('This script requires Node.js 18+ with global fetch.');
  }
  const maxAttempts = FETCH_MAX_ATTEMPTS;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response;
    let text;
    try {
      response = await fetch(url, { ...init, signal: controller.signal });
      text = await response.text();
    } catch (error) {
      clearTimeout(timer);
      lastError = error?.name === 'AbortError'
        ? new Error(`HTTP timeout after ${REQUEST_TIMEOUT_MS}ms`)
        : error;
      if (attempt === maxAttempts) throw lastError;
      await sleep(1000 * attempt * attempt);
      continue;
    }
    clearTimeout(timer);
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text };
    }
    if (response.ok) return body;
    const message = typeof body === 'object' ? JSON.stringify(body).slice(0, 1000) : String(body);
    lastError = new Error(`HTTP ${response.status}: ${message}`);
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === maxAttempts) {
      throw lastError;
    }
    await sleep(1000 * attempt * attempt);
  }
  throw lastError;
}

function parseModelJson(text) {
  const cleaned = String(text || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (error) {
    const extracted = extractFirstJson(cleaned);
    if (!extracted) throw error;
    parsed = JSON.parse(extracted);
  }
  if (Array.isArray(parsed)) return { items: parsed };
  if (!Array.isArray(parsed.items)) throw new Error('Model JSON must contain items array');
  return parsed;
}

function extractFirstJson(text) {
  const start = text.search(/[\[{]/);
  if (start < 0) return null;
  const opener = text[start];
  const closer = opener === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const ch = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === opener) depth++;
    if (ch === closer) {
      depth--;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

function sanitizePatch(original, patch, taxonomies) {
  if (!patch || Number(patch.index) !== Number(original.index)) return null;
  const out = {};

  for (const field of PATCH_STRING_FIELDS) {
    if (patch[field] == null) continue;
    const value = String(patch[field]).trim();
    if (!value) continue;
    if (field === 'meaning' && hasLatin(value) && !hasCjk(value)) continue;
    if (field === 'definition_ja_brief' && !HIRAGANA_RE.test(value) && !KATAKANA_RE.test(value) && !hasCjk(value)) continue;
    if (field === 'pos' && !taxonomies.pos.codes.has(value)) continue;
    if (field === 'transitivity' && !taxonomies.transitivity.codes.has(value)) continue;
    if (field === 'register' && !taxonomies.register.codes.has(value)) continue;
    if (field === 'style' && !taxonomies.style.codes.has(value)) continue;
    if (field === 'freq_band' && !taxonomies.freq_band.codes.has(value)) continue;
    out[field] = value;
  }

  for (const field of PATCH_ARRAY_FIELDS) {
    if (patch[field] == null) continue;
    if (field === 'example_sentences') {
      const examples = normalizeExampleSentences(patch[field]);
      if (examples.length) out[field] = examples.slice(0, 3);
      continue;
    }
    let values = uniqueStrings(patch[field]);
    if (field === 'domain_codes') values = values.filter((code) => taxonomies.domain_codes.codes.has(code) && code !== 'unknown').slice(0, 2);
    if (field === 'semantic_tag_codes') values = values.filter((code) => taxonomies.semantic_tag_codes.codes.has(code) && code !== 'unknown').slice(0, 4);
    if (field === 'meanings_zh') values = values.filter((value) => !hasLatin(value) || hasCjk(value)).slice(0, 3);
    if (values.length) out[field] = values;
  }

  if (out.example_sentences && !out.example_sentence_ja && out.example_sentences[0]?.ja) {
    out.example_sentence_ja = out.example_sentences[0].ja;
  }
  if (out.example_sentences && !out.example_sentence_zh && out.example_sentences[0]?.zh) {
    out.example_sentence_zh = out.example_sentences[0].zh;
  }
  if ((!out.meaning || hasLatin(out.meaning)) && out.meanings_zh?.length) {
    out.meaning = out.meanings_zh[0];
  }
  return out;
}

function mergePatch(entry, patch, provider, taxonomies, options = {}) {
  const changes = [];
  if ((!patch.meaning || hasLatin(patch.meaning)) && patch.meanings_zh?.length) {
    patch = { ...patch, meaning: patch.meanings_zh[0] };
  }
  for (const [field, value] of Object.entries(patch)) {
    if (['index', 'word', 'reading_hiragana', 'grammar', 'level'].includes(field)) continue;
    if (JSON.stringify(entry[field]) === JSON.stringify(value)) continue;
    entry[field] = value;
    changes.push(field);
  }
  repairDerivedTaxonomy(entry, taxonomies, changes);
  if (changes.length && options.mark) addFlag(entry, `llm_repaired_${provider}`);
  return changes;
}

async function runCompare(args, taxonomies, entries) {
  REQUEST_TIMEOUT_MS = parseInt(args.timeoutMs || process.env.VOCAB_REPAIR_HTTP_TIMEOUT_MS || String(REQUEST_TIMEOUT_MS), 10);
  FETCH_MAX_ATTEMPTS = parseInt(args.fetchAttempts || process.env.VOCAB_REPAIR_FETCH_ATTEMPTS || String(FETCH_MAX_ATTEMPTS), 10);
  const sample = parseInt(args.sample || '12', 10);
  const batch = parseInt(args.batch || '6', 10);
  const targets = selectModelTargets(entries, sample);
  const batches = chunk(targets, batch);
  const providers = [
    { provider: 'deepseek', model: args.deepseekModel || 'deepseek-v4-flash' },
    { provider: 'gemini', model: args.geminiModel || 'gemini-3-flash-preview' },
  ];
  const result = { created_at: new Date().toISOString(), sample: targets.map((entry) => entry.index), providers: {} };
  for (const info of providers) {
    const providerResult = { model: info.model, ok: 0, failed: 0, items: [], errors: [] };
    for (const batchEntries of batches) {
      try {
        const prompt = makePrompt(batchEntries, taxonomies);
        const text = await callProvider(info.provider, info.model, prompt);
        const parsed = parseModelJson(text);
        for (const patch of parsed.items) {
          const original = batchEntries.find((entry) => Number(entry.index) === Number(patch.index));
          const sanitized = original ? sanitizePatch(original, patch, taxonomies) : null;
          if (sanitized) {
            providerResult.ok++;
            providerResult.items.push({ index: original.index, word: original.word, patch: sanitized });
          } else {
            providerResult.failed++;
          }
        }
      } catch (error) {
        providerResult.failed += batchEntries.length;
        providerResult.errors.push(String(error.message || error));
      }
    }
    result.providers[info.provider] = providerResult;
  }
  const outDir = args.outDir || 'local/vocab_repair_compare';
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `compare-${timestamp()}.json`);
  writeJson(outPath, result);
  console.log(JSON.stringify({ outPath, summary: summarizeCompare(result) }, null, 2));
}

function summarizeCompare(result) {
  const summary = {};
  for (const [provider, info] of Object.entries(result.providers)) {
    summary[provider] = {
      model: info.model,
      ok: info.ok,
      failed: info.failed,
      errors: info.errors,
      filledDomain: info.items.filter((item) => item.patch.domain_codes?.length).length,
      filledSemantic: info.items.filter((item) => item.patch.semantic_tag_codes?.length).length,
      noLatinMeaning: info.items.filter((item) => item.patch.meaning && !hasLatin(item.patch.meaning)).length,
      examplesZh: info.items.filter((item) => item.patch.example_sentence_zh).length,
    };
  }
  return summary;
}

async function runLlm(args, taxonomies, entries) {
  REQUEST_TIMEOUT_MS = parseInt(args.timeoutMs || process.env.VOCAB_REPAIR_HTTP_TIMEOUT_MS || String(REQUEST_TIMEOUT_MS), 10);
  FETCH_MAX_ATTEMPTS = parseInt(args.fetchAttempts || process.env.VOCAB_REPAIR_FETCH_ATTEMPTS || String(FETCH_MAX_ATTEMPTS), 10);
  const provider = args.provider;
  if (!provider) throw new Error('--provider=deepseek|gemini is required');
  const model = args.model || (provider === 'deepseek' ? 'deepseek-v4-flash' : 'gemini-3-flash-preview');
  const batchSize = parseInt(args.batch || '8', 10);
  const limit = args.limit ? parseInt(args.limit, 10) : Infinity;
  const byIndex = new Map(entries.map((entry) => [Number(entry.index), entry]));
  const runDir = args.runDir || 'local/vocab_repair_runs';
  fs.mkdirSync(runDir, { recursive: true });
  const checkpoint = args.checkpoint || path.join(runDir, `${provider}-${timestamp()}.jsonl`);
  const outPath = args.out || inputToRepairedPath(args.input || DEFAULT_INPUT, `llm-${provider}`);
  const replayed = replayCheckpoint(checkpoint, entries, provider, taxonomies);
  const maxPasses = args.untilComplete ? parseInt(args.maxPasses || '1000', 10) : parseInt(args.maxPasses || '1', 10);
  const retryDelayMs = parseInt(args.retryDelayMs || '30000', 10);
  const maxConsecutiveBatchFailures = parseInt(args.maxConsecutiveBatchFailures || '5', 10);

  let ok = replayed;
  let failed = 0;
  for (let pass = 1; pass <= maxPasses; pass++) {
    const targets = selectModelTargets(entries, limit);
    if (!targets.length) {
      console.log(JSON.stringify({ provider, model, pass, done: true, ok, failed, checkpoint, outPath }));
      break;
    }

    let passOk = 0;
    let passFailed = 0;
    let consecutiveBatchFailures = 0;
    const batches = chunk(targets, batchSize);
    console.log(JSON.stringify({ provider, model, pass, batches: batches.length, targets: targets.length, batchSize, checkpoint, outPath }));

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batchEntries = batches[batchIndex];
      const prompt = makePrompt(batchEntries, taxonomies);
      let parsed;
      try {
        const text = await callProvider(provider, model, prompt);
        parsed = parseModelJson(text);
      } catch (error) {
        failed += batchEntries.length;
        passFailed += batchEntries.length;
        consecutiveBatchFailures++;
        appendCheckpoint(checkpoint, { type: 'error', pass, indexes: batchEntries.map((entry) => entry.index), error: String(error.message || error) });
        console.log(JSON.stringify({ provider, model, pass, batch: batchIndex + 1, ok, failed, passOk, passFailed, skipped: batchEntries.length, error: String(error.message || error).slice(0, 300) }));
        if (consecutiveBatchFailures >= maxConsecutiveBatchFailures) {
          console.log(JSON.stringify({ provider, model, pass, paused: true, reason: 'consecutive_batch_failures', consecutiveBatchFailures, maxConsecutiveBatchFailures }));
          break;
        }
        continue;
      }
      consecutiveBatchFailures = 0;

      const seen = new Set();
      for (const rawPatch of parsed.items) {
        const original = byIndex.get(Number(rawPatch.index));
        seen.add(Number(rawPatch.index));
        const sanitized = original ? sanitizePatch(original, rawPatch, taxonomies) : null;
        if (!sanitized) {
          failed++;
          passFailed++;
          appendCheckpoint(checkpoint, { type: 'invalid', pass, index: rawPatch.index, raw: rawPatch });
          continue;
        }
        const changes = mergePatch(original, sanitized, provider, taxonomies, { mark: Boolean(args.mark) });
        appendCheckpoint(checkpoint, { type: 'patch', pass, index: original.index, changes, patch: sanitized });
        ok++;
        passOk++;
      }

      for (const entry of batchEntries) {
        if (seen.has(Number(entry.index))) continue;
        failed++;
        passFailed++;
        appendCheckpoint(checkpoint, { type: 'missing', pass, index: entry.index });
      }

      writeJson(outPath, entries);
      const remainingNow = selectModelTargets(entries, limit).length;
      console.log(JSON.stringify({ provider, model, pass, batch: batchIndex + 1, batches: batches.length, ok, failed, passOk, passFailed, remaining: remainingNow, checkpoint }));
      await sleep(parseInt(args.delayMs || '250', 10));
    }

    writeJson(outPath, entries);
    const remainingAfterPass = selectModelTargets(entries, limit).length;
    console.log(JSON.stringify({ provider, model, pass, passOk, passFailed, remaining: remainingAfterPass, checkpoint, outPath }));
    if (!remainingAfterPass) break;
    if (!args.untilComplete) break;
    if (pass < maxPasses) await sleep(retryDelayMs);
  }

  writeJson(outPath, entries);
  console.log(JSON.stringify({ outPath, checkpoint, ok, failed, after: audit(entries) }, null, 2));
}

function loadCheckpoint(filePath) {
  const done = new Set();
  if (!fs.existsSync(filePath)) return done;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    try {
      const item = JSON.parse(line);
      if (item.type === 'patch' && item.index != null) done.add(Number(item.index));
    } catch {
      // Ignore broken checkpoint lines.
    }
  }
  return done;
}

function replayCheckpoint(filePath, entries, provider, taxonomies) {
  if (!fs.existsSync(filePath)) return 0;
  const byIndex = new Map(entries.map((entry) => [Number(entry.index), entry]));
  const patches = new Map();
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    try {
      const item = JSON.parse(line);
      if (item.type === 'patch' && item.index != null && item.patch) {
        patches.set(Number(item.index), item.patch);
      }
    } catch {
      // Ignore broken checkpoint lines.
    }
  }
  let applied = 0;
  for (const [index, patch] of patches.entries()) {
    const entry = byIndex.get(index);
    if (!entry) continue;
    mergePatch(entry, patch, provider, taxonomies, { mark: false });
    applied++;
  }
  return applied;
}

function appendCheckpoint(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify({ ts: new Date().toISOString(), ...value })}\n`, 'utf8');
}

function chunk(values, size) {
  const out = [];
  for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size));
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function inputToRepairedPath(input, suffix) {
  return input.replace(/\.json$/i, `.${suffix}.json`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || 'audit';
  if (args.help || command === 'help') {
    usage();
    return;
  }
  const input = args.input || DEFAULT_INPUT;
  args.input = input;
  const taxonomies = loadTaxonomies();
  const data = loadJson(input);
  const entries = Array.isArray(data) ? data : data.items || data.entries || [];

  if (command === 'audit') {
    console.log(JSON.stringify(audit(entries), null, 2));
    return;
  }

  if (command === 'local') {
    const enrichedMap = loadEnrichedMap(args.enriched || DEFAULT_ENRICHED);
    const before = audit(entries);
    const repaired = applyLocalRepair(entries, taxonomies, enrichedMap, { mark: Boolean(args.mark) });
    const after = audit(repaired.entries);
    const outPath = args.write ? input : args.out || inputToRepairedPath(input, 'local-repaired');
    writeJson(outPath, repaired.entries);
    console.log(JSON.stringify({ outPath, before, localReport: repaired.report, after }, null, 2));
    return;
  }

  if (command === 'compare') {
    await runCompare(args, taxonomies, entries);
    return;
  }

  if (command === 'llm') {
    const enrichedMap = loadEnrichedMap(args.enriched || DEFAULT_ENRICHED);
    const local = applyLocalRepair(entries, taxonomies, enrichedMap, { mark: Boolean(args.mark) });
    await runLlm(args, taxonomies, local.entries);
    return;
  }

  usage();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
