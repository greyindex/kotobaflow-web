(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.JPLearn = root.JPLearn || {};
    root.JPLearn.lexicalMetadata = api;
    if (root.window && root.window !== root) {
      root.window.JPLearn = root.window.JPLearn || {};
      root.window.JPLearn.lexicalMetadata = api;
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var ENUMS = {
    pos: [
      'noun',
      'verb',
      'adjective_i',
      'adjective_na',
      'adjective_taru',
      'adverb',
      'expression',
      'particle',
      'auxiliary',
      'interjection',
      'pronoun',
      'conjunction',
      'adnominal',
      'prefix',
      'suffix',
      'numeral',
      'counter',
      'unknown',
    ],
    subtypes: [
      'proper_noun',
      'temporal_noun',
      'verbal_noun',
      'adverbial_noun',
      'onomatopoeia',
      'interrogative',
      'demonstrative',
      'personal',
      'reflexive',
      'idiom',
      'greeting',
      'proverb',
      'fixed_expression',
      'numeral_expression',
      'counter_expression',
      'sentence_expression',
      'polite_form',
      'inflected_form',
      'auxiliary_verb',
      'auxiliary_adjective',
      'copula',
      'classical',
      'prenominal',
    ],
    conjugation: [
      'godan',
      'ichidan',
      'suru',
      'kuru',
      'zuru',
      'irregular',
      'classical',
      'not_applicable',
      'unknown',
    ],
    transitivity: ['transitive', 'intransitive', 'both', 'not_applicable', 'unknown'],
    scope: ['lexeme', 'suru', 'phrase', 'auxiliary', 'not_applicable'],
    formality: ['neutral', 'formal', 'informal', 'unknown'],
    politeness: ['polite', 'honorific', 'humble'],
    usage: [
      'colloquial',
      'slang',
      'vulgar',
      'derogatory',
      'archaic',
      'literary',
      'dialect',
      'children',
      'feminine',
      'masculine',
      'familiar',
      'euphemistic',
      'joking',
      'sensitive',
    ],
    medium: ['general', 'spoken', 'written', 'unknown'],
    genres: ['literary', 'news', 'academic', 'official', 'business', 'educational'],
  };
  var labels = {
    zh: {
      pos: [
        '名词',
        '动词',
        'い形容词',
        'な形容词',
        'タリ形容词',
        '副词',
        '表达',
        '助词',
        '助动词',
        '感叹词',
        '代词',
        '连词',
        '连体词',
        '接头词',
        '接尾词',
        '数词',
        '量词',
        '未知',
      ],
      subtypes: [
        '专有名词',
        '时间名词',
        'サ变名词',
        '副词性名词',
        '拟声拟态词',
        '疑问',
        '指示',
        '人称',
        '反身',
        '惯用语',
        '问候语',
        '谚语',
        '固定表达',
        '数词表达',
        '量词表达',
        '句子表达',
        '礼貌形式',
        '活用形式',
        '动词型助动词',
        '形容词型助动词',
        '系词',
        '古典语',
        '前置修饰用法',
      ],
      conjugation: ['五段', '一段', 'サ变', 'カ变', 'ザ变', '不规则', '古典活用', '不适用', '未知'],
      transitivity: ['他动', '自动', '自他两用', '不适用', '未知'],
      scope: ['词项', 'サ变', '短语', '助动词', '不适用'],
      formality: ['中性', '正式', '非正式', '未知'],
      politeness: ['礼貌语', '尊敬语', '谦让语'],
      usage: [
        '口语',
        '俚语',
        '粗俗',
        '贬义',
        '古语',
        '文学',
        '方言',
        '儿童用语',
        '女性用语',
        '男性用语',
        '亲昵',
        '委婉',
        '玩笑',
        '敏感',
      ],
      medium: ['通用', '口语', '书面', '未知'],
      genres: ['文学', '新闻', '学术', '官方', '商务', '教学'],
    },
    ja: {
      pos: [
        '名詞',
        '動詞',
        'イ形容詞',
        'ナ形容詞',
        'タリ形容詞',
        '副詞',
        '表現',
        '助詞',
        '助動詞',
        '感動詞',
        '代名詞',
        '接続詞',
        '連体詞',
        '接頭辞',
        '接尾辞',
        '数詞',
        '助数詞',
        '不明',
      ],
      subtypes: [
        '固有名詞',
        '時間名詞',
        'サ変名詞',
        '副詞的名詞',
        'オノマトペ',
        '疑問',
        '指示',
        '人称',
        '再帰',
        '慣用句',
        '挨拶',
        'ことわざ',
        '定型表現',
        '数詞表現',
        '助数詞表現',
        '文表現',
        '丁寧形',
        '活用形',
        '動詞型助動詞',
        '形容詞型助動詞',
        'コピュラ',
        '古典',
        '連体修飾用法',
      ],
      conjugation: ['五段', '一段', 'サ変', 'カ変', 'ザ変', '不規則', '古典活用', '該当なし', '不明'],
      transitivity: ['他動詞', '自動詞', '自他両用', '該当なし', '不明'],
      scope: ['語彙', 'サ変', '句', '助動詞', '該当なし'],
      formality: ['中立', 'フォーマル', 'インフォーマル', '不明'],
      politeness: ['丁寧語', '尊敬語', '謙譲語'],
      usage: [
        '口語',
        '俗語',
        '卑語',
        '軽蔑',
        '古語',
        '文学',
        '方言',
        '子ども',
        '女性語',
        '男性語',
        '親しい表現',
        '婉曲',
        '冗談',
        '要配慮',
      ],
      medium: ['一般', '話し言葉', '書き言葉', '不明'],
      genres: ['文学', 'ニュース', '学術', '公的', 'ビジネス', '教育'],
    },
  };
  function fail(message) {
    throw new Error('lexical metadata: ' + message);
  }
  function object(value, keys, name) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(name + ' must be an object');
    Object.keys(value).forEach(function (key) {
      if (keys.indexOf(key) < 0) fail(name + ' has unknown key ' + key);
    });
    keys.forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) fail(name + ' is missing ' + key);
    });
  }
  function enumValue(value, values, name) {
    if (typeof value !== 'string' || values.indexOf(value) < 0) fail(name + ' has invalid value');
  }
  function enumArray(value, values, name) {
    if (!Array.isArray(value)) fail(name + ' must be an array');
    var seen = new Set();
    value.forEach(function (code) {
      enumValue(code, values, name);
      if (seen.has(code)) fail(name + ' contains duplicate ' + code);
      seen.add(code);
    });
  }
  function validate(fields) {
    object(fields, ['pos', 'transitivity', 'register', 'style'], 'fields');
    var p = fields.pos,
      t = fields.transitivity,
      r = fields.register,
      s = fields.style;
    object(p, ['primary', 'classes', 'subtypes', 'conjugation'], 'pos');
    enumValue(p.primary, ENUMS.pos, 'pos.primary');
    enumArray(p.classes, ENUMS.pos, 'pos.classes');
    enumArray(p.subtypes, ENUMS.subtypes, 'pos.subtypes');
    enumValue(p.conjugation, ENUMS.conjugation, 'pos.conjugation');
    if (!p.classes.includes(p.primary)) fail('pos.classes must include primary');
    if (p.primary === 'unknown' && p.classes.length !== 1)
      fail('unknown cannot be combined with another class');
    if (p.classes.includes('unknown') && p.classes.length !== 1)
      fail('unknown cannot be combined with another class');
    var verbish = p.classes.includes('verb') || p.subtypes.includes('auxiliary_verb');
    if (verbish && p.conjugation === 'not_applicable')
      fail('verb-like pos cannot use not_applicable conjugation');
    if (
      !verbish &&
      (p.classes.includes('adjective_i') ||
        p.classes.includes('adjective_na') ||
        p.classes.includes('adjective_taru')) &&
      ['godan', 'ichidan', 'suru', 'kuru', 'zuru', 'irregular'].includes(p.conjugation)
    )
      fail('adjective without verb class cannot use verb conjugation');
    object(t, ['value', 'scope'], 'transitivity');
    enumValue(t.value, ENUMS.transitivity, 'transitivity.value');
    enumValue(t.scope, ENUMS.scope, 'transitivity.scope');
    if ((t.value === 'not_applicable') !== (t.scope === 'not_applicable'))
      fail('not_applicable value and scope must occur together');
    object(r, ['formality', 'politeness', 'usage'], 'register');
    enumValue(r.formality, ENUMS.formality, 'register.formality');
    enumArray(r.politeness, ENUMS.politeness, 'register.politeness');
    enumArray(r.usage, ENUMS.usage, 'register.usage');
    object(s, ['medium', 'genres'], 'style');
    enumValue(s.medium, ENUMS.medium, 'style.medium');
    enumArray(s.genres, ENUMS.genres, 'style.genres');
    return true;
  }
  function orderedArray(value, values) {
    return values.filter(function (code) {
      return value.includes(code);
    });
  }
  function normalize(fields) {
    validate(fields);
    return {
      pos: {
        primary: fields.pos.primary,
        classes: orderedArray(fields.pos.classes, ENUMS.pos),
        subtypes: orderedArray(fields.pos.subtypes, ENUMS.subtypes),
        conjugation: fields.pos.conjugation,
      },
      transitivity: { value: fields.transitivity.value, scope: fields.transitivity.scope },
      register: {
        formality: fields.register.formality,
        politeness: orderedArray(fields.register.politeness, ENUMS.politeness),
        usage: orderedArray(fields.register.usage, ENUMS.usage),
      },
      style: { medium: fields.style.medium, genres: orderedArray(fields.style.genres, ENUMS.genres) },
    };
  }
  function codeOf(value, key) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value[key] : value;
  }
  function langKey(lang) {
    return lang === 'ja' ? 'ja' : 'zh';
  }
  function label(category, code, lang) {
    var i = ENUMS[category].indexOf(code);
    return i < 0 ? (typeof code === 'string' ? code : '') : labels[langKey(lang)][category][i];
  }
  var LEGACY_LABELS = {
    register: {
      spoken: ['口语', '話し言葉'],
      written: ['书面', '書き言葉'],
      formal: ['正式', 'フォーマル'],
      informal: ['非正式', 'インフォーマル'],
      colloquial: ['口语化', '口語'],
      literary: ['文学', '文学'],
      neutral: ['中性', '中立'],
      unknown: ['未知', '不明'],
    },
    style: {
      spoken: ['口语', '話し言葉'],
      written: ['书面', '書き言葉'],
      literary: ['文学', '文学'],
      news: ['新闻', 'ニュース'],
      educational: ['教学', '教育'],
      unknown: ['未知', '不明'],
    },
  };
  function legacyLabel(category, value, lang) {
    if (typeof value !== 'string') return value || '';
    if (ENUMS[category] && ENUMS[category].includes(value)) return label(category, value, lang);
    var categoryMap = LEGACY_LABELS[category];
    if (categoryMap && categoryMap[value]) return categoryMap[value][langKey(lang) === 'ja' ? 1 : 0];
    return value;
  }
  function primary(pos) {
    return codeOf(pos, 'primary') || '';
  }
  function classes(pos) {
    var list = pos && typeof pos === 'object' && !Array.isArray(pos) ? pos.classes : null;
    return Array.isArray(list)
      ? ENUMS.pos.filter(function (code) {
          return list.includes(code);
        })
      : pos
        ? [pos]
        : [];
  }
  function hasClass(pos, code) {
    return classes(pos).indexOf(code) >= 0;
  }
  function join(values) {
    return values.filter(Boolean).join('・');
  }
  function posLabel(pos, lang) {
    if (typeof pos === 'string') return legacyLabel('pos', pos, lang);
    if (!pos || typeof pos !== 'object') return '';
    var cls = classes(pos),
      out = cls.map(function (c) {
        return label('pos', c, lang);
      });
    (pos.subtypes || []).forEach(function (c) {
      out.push(label('subtypes', c, lang));
    });
    return join(out);
  }
  function conjugationLabel(pos, lang) {
    if (typeof pos === 'string') return legacyLabel('conjugation', pos, lang);
    if (!pos || typeof pos !== 'object') return '';
    var c = pos.conjugation;
    if (!c || c === 'not_applicable') return '';
    return label('conjugation', c, lang);
  }
  function transitivityLabel(value, lang) {
    if (typeof value === 'string') return legacyLabel('transitivity', value, lang);
    if (!value || typeof value !== 'object') return '';
    var result = label('transitivity', value.value, lang),
      scope = value.scope;
    return join([
      result,
      scope && scope !== 'lexeme' && scope !== 'not_applicable' ? label('scope', scope, lang) : '',
    ]);
  }
  function registerLabel(value, lang) {
    if (typeof value === 'string') return legacyLabel('register', value, lang);
    if (!value || typeof value !== 'object') return '';
    return join(
      [label('formality', value.formality, lang)].concat(
        orderedArray(value.politeness || [], ENUMS.politeness).map(function (c) {
          return label('politeness', c, lang);
        }),
        orderedArray(value.usage || [], ENUMS.usage).map(function (c) {
          return label('usage', c, lang);
        }),
      ),
    );
  }
  function styleLabel(value, lang) {
    if (typeof value === 'string') return legacyLabel('style', value, lang);
    if (!value || typeof value !== 'object') return '';
    return join(
      [label('medium', value.medium, lang)].concat(
        orderedArray(value.genres || [], ENUMS.genres).map(function (c) {
          return label('genres', c, lang);
        }),
      ),
    );
  }
  function reviewMatches(row) {
    var review = row && row.lexical_review,
      id = review && review.identity;
    return !!(
      id &&
      typeof id === 'object' &&
      typeof row.word === 'string' &&
      typeof row.reading_hiragana === 'string' &&
      typeof row.meaning === 'string' &&
      id.word === row.word &&
      id.reading_hiragana === row.reading_hiragana &&
      id.meaning === row.meaning
    );
  }
  return {
    ENUMS: ENUMS,
    validate: validate,
    normalize: normalize,
    primary: primary,
    classes: classes,
    hasClass: hasClass,
    posLabel: posLabel,
    conjugationLabel: conjugationLabel,
    transitivityLabel: transitivityLabel,
    registerLabel: registerLabel,
    styleLabel: styleLabel,
    reviewMatches: reviewMatches,
  };
});
