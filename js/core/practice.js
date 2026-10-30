(function (root) {
  'use strict';

  var app = root.JPLearn || (root.JPLearn = {});
  var TYPE_ORDER = ['ja-zh', 'zh-ja', 'listening', 'input', 'cloze'];
  var TYPE_LABELS = {
    'ja-zh': '日文 → 中文',
    'zh-ja': '中文 → 日文',
    listening: '听音辨词',
    input: '假名 / 汉字输入',
    cloze: '例句挖空',
  };

  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function normalizeJapanese(value) {
    return text(value)
      .normalize('NFKC')
      .replace(/\s+/g, '')
      .replace(/[ァ-ヶ]/g, function (char) {
        return String.fromCharCode(char.charCodeAt(0) - 0x60);
      });
  }

  function meaningOf(word) {
    return text(word && (word.meaning || (word.meanings_zh || [])[0]));
  }

  function readingOf(word) {
    return text(word && word.reading_hiragana);
  }

  function acceptedAnswers(word) {
    // Slashes explicitly separate alternative spellings in the vocabulary data.
    // Keep the original combined display valid; do not infer semantic synonyms.
    var forms = [text(word.word), readingOf(word)];
    return Array.from(
      new Set(
        forms
          .concat(
            forms.flatMap(function (form) {
              return form.split(/[\/／]/).map(text);
            }),
          )
          .filter(Boolean),
      ),
    );
  }

  function stableNumber(word, position) {
    var numeric = Number(word && word.index);
    if (!Number.isFinite(numeric)) numeric = text(word && word.word).length * 31;
    return Math.abs(numeric + position * 17);
  }

  function candidatePool(word, pool) {
    var source = Array.isArray(pool) ? pool : [];
    var levels = ['N5', 'N4', 'N3', 'N2', 'N1'];
    var current = levels.indexOf(word.level);
    levels.sort(function (a, b) {
      if (current < 0) return Number(b.slice(1)) - Number(a.slice(1));
      var distance =
        Math.abs(Number(a.slice(1)) - Number(word.level.slice(1))) -
        Math.abs(Number(b.slice(1)) - Number(word.level.slice(1)));
      return distance || Number(b.slice(1)) - Number(a.slice(1));
    });
    if (current < 0) levels.unshift(word.level);
    var tiers = levels.map(function (level) {
      return source.filter(function (candidate) {
        return candidate && candidate.index !== word.index && candidate.level === level;
      });
    });
    tiers.push(
      source.filter(function (candidate) {
        return candidate && candidate.index !== word.index && levels.indexOf(candidate.level) === -1;
      }),
    );
    return tiers.map(function (tier) {
      return tier.slice().sort(function (a, b) {
        return Number(a.index) - Number(b.index);
      });
    });
  }

  function parts(value, japanese) {
    return text(value)
      .split(/[\/／、,，;；·]/)
      .map(function (part) {
        return japanese
          ? normalizeJapanese(part)
          : text(part)
              .normalize('NFKC')
              .replace(/[\s。.!！]+/g, '');
      })
      .filter(Boolean);
  }

  function overlaps(left, right) {
    return left.some(function (value) {
      return right.indexOf(value) !== -1;
    });
  }

  function meanings(word) {
    return parts([meaningOf(word)].concat(word.meanings_zh || []).join('；'));
  }

  // VAL-02: other words can share the meaning an input task shows (鍵 and キー
  // are both 钥匙). Name up to three of them; with more, use another task type.
  var MAX_NOT_ANSWERS = 3;
  function inputAlternatives(word, pool) {
    var prompt = parts(meaningOf(word));
    var own = acceptedAnswers(word).map(normalizeJapanese);
    var seen = new Set(own);
    return (Array.isArray(pool) ? pool : [])
      .filter(function (candidate) {
        return (
          candidate &&
          candidate.index !== word.index &&
          text(candidate.word) &&
          overlaps(prompt, meanings(candidate)) &&
          !acceptedAnswers(candidate).some(function (answer) {
            return own.indexOf(normalizeJapanese(answer)) !== -1;
          })
        );
      })
      .sort(function (a, b) {
        return Number(a.index) - Number(b.index);
      })
      .map(function (candidate) {
        return text(candidate.word);
      })
      .filter(function (name) {
        var key = normalizeJapanese(name);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function validNotAnswers(value, word) {
    if (!Array.isArray(value) || !value.length || value.length > MAX_NOT_ANSWERS) return false;
    var seen = new Set(acceptedAnswers(word).map(normalizeJapanese));
    return value.every(function (name) {
      if (typeof name !== 'string' || !text(name) || name.length > 100) return false;
      var key = normalizeJapanese(name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // VAL-02: blank the word itself, not the same characters inside a longer word
  // (山 in 富士山, 年 in 今年, キー in ルームキー). A sentence that would still
  // show the answer somewhere is not used.
  var KANJI = /[\u3400-\u9fff\uf900-\ufaff々〆ヶ]/;
  var KATAKANA = /[\u30a0-\u30ff]/;
  function clozePrompt(sentence, wordText) {
    var single = wordText.length === 1 && KANJI.test(wordText);
    var first = wordText.charAt(0);
    var last = wordText.charAt(wordText.length - 1);
    var found = false;
    for (
      var at = sentence.indexOf(wordText);
      at !== -1;
      at = sentence.indexOf(wordText, at + wordText.length)
    ) {
      var before = sentence.charAt(at - 1);
      var after = sentence.charAt(at + wordText.length);
      var inside = single
        ? KANJI.test(before) || KANJI.test(after)
        : (KATAKANA.test(first) && KATAKANA.test(before)) || (KATAKANA.test(last) && KATAKANA.test(after));
      if (inside) return '';
      found = true;
    }
    return found ? sentence.split(wordText).join('＿＿＿＿') : '';
  }

  function eligibleDistractor(word, candidate, type) {
    if (overlaps(parts(word.word, true), parts(candidate.word, true))) return false;
    if (overlaps(meanings(word), meanings(candidate))) return false;
    if (
      overlaps(parts((word.synonyms_ja || []).join('/'), true), parts(candidate.word, true)) ||
      overlaps(parts((candidate.synonyms_ja || []).join('/'), true), parts(word.word, true))
    )
      return false;
    if (
      type === 'listening' &&
      (!readingOf(candidate) || overlaps(parts(readingOf(word), true), parts(readingOf(candidate), true)))
    )
      return false;
    return true;
  }

  function choiceOptions(word, pool, valueGetter, position, type) {
    var answer = valueGetter(word);
    if (!answer) return null;
    var seen = new Set([normalizeJapanese(answer)]);
    var values = [];
    var tiers = candidatePool(word, pool);
    for (var tier = 0; tier < tiers.length && values.length < 3; tier++) {
      var candidates = tiers[tier];
      var start = candidates.length ? stableNumber(word, position) % candidates.length : 0;
      for (var offset = 0; offset < candidates.length && values.length < 3; offset++) {
        var candidate = candidates[(start + offset) % candidates.length];
        var value = valueGetter(candidate);
        var key = normalizeJapanese(value);
        if (!value || seen.has(key) || !eligibleDistractor(word, candidate, type)) continue;
        seen.add(key);
        values.push(value);
      }
    }
    if (values.length < 3) return null;
    var correctIndex = stableNumber(word, position) % 4;
    values.splice(correctIndex, 0, answer);
    return values.map(function (value, index) {
      return { label: value, correct: index === correctIndex };
    });
  }

  function buildExercise(type, word, pool, position) {
    var wordText = text(word && word.word);
    var reading = readingOf(word);
    var meaning = meaningOf(word);
    var exercise = {
      version: 1,
      id: String(position) + ':' + String(word && word.index) + ':' + type,
      type: type,
      label: TYPE_LABELS[type],
      wordIndex: word && word.index,
      answer: wordText,
      reading: reading,
      meaning: meaning,
      acceptedAnswers: acceptedAnswers(word),
    };

    if (type === 'ja-zh') {
      exercise.prompt = wordText;
      exercise.instruction = '选择最合适的中文释义';
      exercise.options = choiceOptions(word, pool, meaningOf, position, type);
      return exercise.options ? exercise : null;
    }
    if (type === 'zh-ja') {
      exercise.prompt = meaning;
      exercise.instruction = '选择对应的日文词汇';
      exercise.options = choiceOptions(
        word,
        pool,
        function (candidate) {
          return text(candidate && candidate.word);
        },
        position,
        type,
      );
      return exercise.prompt && exercise.options ? exercise : null;
    }
    if (type === 'listening') {
      exercise.prompt = '先听发音，再选择你听到的词';
      exercise.instruction = '可按 R 重播';
      exercise.audioUrl =
        root.VocabTTS && typeof root.VocabTTS.getAudioUrl === 'function'
          ? root.VocabTTS.getAudioUrl(word && word.index)
          : '';
      exercise.options = choiceOptions(
        word,
        pool,
        function (candidate) {
          return text(candidate && candidate.word);
        },
        position,
        type,
      );
      return exercise.audioUrl && exercise.options ? exercise : null;
    }
    if (type === 'input') {
      exercise.prompt = meaning;
      exercise.instruction = '输入对应的日文、假名或汉字';
      var alternatives = inputAlternatives(word, pool);
      if (alternatives.length > MAX_NOT_ANSWERS) return null;
      if (alternatives.length) exercise.notAnswers = alternatives;
      return exercise.prompt && exercise.acceptedAnswers.length ? exercise : null;
    }
    if (type === 'cloze') {
      var sentence = text(word && word.example_sentence_ja);
      var cloze = wordText && sentence ? clozePrompt(sentence, wordText) : '';
      if (!cloze) return null;
      exercise.prompt = cloze;
      exercise.translation = text(word && word.example_sentence_zh);
      exercise.instruction = '补全例句中的目标词';
      return exercise;
    }
    return null;
  }

  function createExercise(word, pool, position, options) {
    options = options || {};
    var preferred = options.preferredType || TYPE_ORDER[position % TYPE_ORDER.length];
    var excluded = options.exclude || [];
    var order = [preferred].concat(
      TYPE_ORDER.filter(function (type) {
        return type !== preferred;
      }),
    );
    for (var i = 0; i < order.length; i++) {
      if (excluded.indexOf(order[i]) !== -1) continue;
      var exercise = buildExercise(order[i], word, pool, position);
      if (exercise) return exercise;
    }
    return null;
  }

  function isCorrect(exercise, value) {
    if (!exercise) return false;
    if (exercise.options) {
      var optionIndex = Number(value);
      return !!exercise.options[optionIndex] && exercise.options[optionIndex].correct;
    }
    var normalized = normalizeJapanese(value);
    if (!normalized) return false;
    return exercise.acceptedAnswers.some(function (answer) {
      return normalizeJapanese(answer) === normalized;
    });
  }

  // pool is optional: with it, an input task saved before VAL-02 is asked again
  // when its meaning is now known to be shared.
  function restoreExercise(saved, word, position, pool) {
    if (
      !saved ||
      saved.version !== 1 ||
      TYPE_ORDER.indexOf(saved.type) === -1 ||
      saved.wordIndex !== word.index ||
      saved.id !== String(position) + ':' + word.index + ':' + saved.type ||
      saved.answer !== text(word.word) ||
      saved.reading !== readingOf(word) ||
      saved.meaning !== meaningOf(word)
    )
      return null;
    var expected = buildExercise(saved.type, word, [], position);
    // Choice construction needs candidates, but prompt and the one correct answer depend only on this word.
    if (['ja-zh', 'zh-ja', 'listening'].indexOf(saved.type) !== -1) {
      var prompt =
        saved.type === 'ja-zh'
          ? text(word.word)
          : saved.type === 'zh-ja'
            ? meaningOf(word)
            : '先听发音，再选择你听到的词';
      var answer = saved.type === 'ja-zh' ? meaningOf(word) : text(word.word);
      if (
        saved.prompt !== prompt ||
        !Array.isArray(saved.options) ||
        saved.options.length !== 4 ||
        saved.options.some(function (option) {
          return (
            !option ||
            typeof option.label !== 'string' ||
            !option.label.trim() ||
            option.label.length > 1000 ||
            typeof option.correct !== 'boolean'
          );
        }) ||
        saved.options.filter(function (option) {
          return option.correct;
        }).length !== 1 ||
        !saved.options.some(function (option) {
          return option.correct && option.label === answer;
        }) ||
        new Set(
          saved.options.map(function (option) {
            return normalizeJapanese(option.label);
          }),
        ).size !== 4
      )
        return null;
      expected = Object.assign({}, saved);
      if (saved.type === 'listening') expected.audioUrl = root.VocabTTS.getAudioUrl(word.index);
    } else if (!expected || expected.prompt !== saved.prompt) return null;
    else if (saved.type === 'input') {
      // Like saved choices, the named alternatives belong to the saved question.
      if (saved.notAnswers !== undefined) {
        if (!validNotAnswers(saved.notAnswers, word)) return null;
        expected.notAnswers = saved.notAnswers.slice();
      } else if (pool) {
        var current = buildExercise('input', word, pool, position);
        if (!current || current.notAnswers) return null;
      }
    }
    expected.acceptedAnswers = acceptedAnswers(word);
    expected.label = TYPE_LABELS[saved.type];
    return JSON.parse(JSON.stringify(expected));
  }

  app.practice = {
    MAX_SESSION_WORDS: 200,
    TYPE_ORDER: TYPE_ORDER.slice(),
    TYPE_LABELS: TYPE_LABELS,
    createExercise: createExercise,
    isCorrect: isCorrect,
    normalizeJapanese: normalizeJapanese,
    restoreExercise: restoreExercise,
  };
})(window);
