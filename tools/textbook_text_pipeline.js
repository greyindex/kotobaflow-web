#!/usr/bin/env node
/*
 * Textbook text-only preprocessing pipeline.
 *
 * Scope:
 * - Reads data/textbook/canonical_books/*.bundle.json
 * - Processes only body/application/conversation text
 * - Excludes study_window and all frontend files
 * - Uses kuromoji for Japanese morphological analysis
 *
 * Usage:
 *   node tools/textbook_text_pipeline.js --sample XinBian1 lesson_02 body --limit 5
 *   node tools/textbook_text_pipeline.js --out data/textbook/textbook_text_tokens.sample.json --limit 20
 */

const fs = require('fs');
const path = require('path');
const kuromoji = require('kuromoji');

const ROOT = path.resolve(__dirname, '..');
const BOOK_DIR = path.join(ROOT, 'data', 'textbook', 'canonical_books');
const VOCAB_V3 = path.join(ROOT, 'data', 'textbook', 'canonical_textbook_vocab', 'textbook_vocab_full.v3.json');
const BOOKS = ['XinBian1', 'XinBian2', 'XinBian3', 'XinBian4'];

function u(value) {
  return value.replace(/\\u\{([0-9a-fA-F]+)\}|\\u([0-9a-fA-F]{4})/g, function(_, wide, fixed) {
    return String.fromCodePoint(parseInt(wide || fixed, 16));
  });
}

const JP = {
  fullStop: u('\\u3002'),
  comma: u('\\u3001'),
  question: u('\\uff1f'),
  exclamation: u('\\uff01'),
  ellipsis: u('\\u2026\\u2026'),
  openQuote: u('\\u300c'),
  closeQuote: u('\\u300d'),
  ni: u('\\u306b')
};
const POS_LABELS = new Map([
  [u('\\u540d\\u8a5e'), ['noun', u('\\u540d\\u8bcd')]],
  [u('\\u52d5\\u8a5e'), ['verb', u('\\u52a8\\u8bcd')]],
  [u('\\u5f62\\u5bb9\\u8a5e'), ['adjective', u('\\u5f62\\u5bb9\\u8bcd')]],
  [u('\\u5f62\\u5bb9\\u52d5\\u8a5e'), ['na_adjective', u('\\u30ca\\u5f62\\u5bb9\\u8bcd')]],
  [u('\\u526f\\u8a5e'), ['adverb', u('\\u526f\\u8bcd')]],
  [u('\\u52a9\\u8a5e'), ['particle', u('\\u52a9\\u8bcd')]],
  [u('\\u52a9\\u52d5\\u8a5e'), ['auxiliary', u('\\u52a9\\u52a8\\u8bcd')]],
  [u('\\u9023\\u4f53\\u8a5e'), ['adnominal', u('\\u8fde\\u4f53\\u8bcd')]],
  [u('\\u63a5\\u7d9a\\u8a5e'), ['conjunction', u('\\u63a5\\u7eed\\u8bcd')]],
  [u('\\u611f\\u52d5\\u8a5e'), ['interjection', u('\\u611f\\u53f9\\u8bcd')]],
  [u('\\u8a18\\u53f7'), ['symbol', u('\\u7b26\\u53f7')]]
]);

const PARTICLE_ROLES = new Map([
  [u('\\u306f'), ['topic_marker', u('\\u63d0\\u793a\\u4e3b\\u9898/\\u5bf9\\u6bd4\\u7126\\u70b9')]],
  [u('\\u304c'), ['subject_marker', u('\\u6807\\u4e3b\\u8bed\\u6216\\u65b0\\u4fe1\\u606f')]],
  [u('\\u3092'), ['object_marker', u('\\u6807\\u52a8\\u4f5c\\u5bf9\\u8c61')]],
  [u('\\u306b'), ['case_marker_ni', u('\\u8868\\u65f6\\u95f4/\\u5730\\u70b9/\\u5230\\u8fbe\\u70b9/\\u76ee\\u7684/\\u5bf9\\u8c61')]],
  [u('\\u3078'), ['direction_marker', u('\\u8868\\u79fb\\u52a8\\u65b9\\u5411')]],
  [u('\\u3067'), ['place_or_means_marker', u('\\u8868\\u52a8\\u4f5c\\u573a\\u6240/\\u624b\\u6bb5/\\u539f\\u56e0')]],
  [u('\\u306e'), ['modifier_link', u('\\u8fde\\u63a5\\u540d\\u8bcd\\uff0c\\u8868\\u6240\\u5c5e/\\u4fee\\u9970')]],
  [u('\\u3082'), ['also_marker', u('\\u4e5f/\\u540c\\u7c7b\\u8ffd\\u52a0')]],
  [u('\\u3068'), ['quote_or_partner_marker', u('\\u8868\\u5f15\\u7528/\\u5171\\u540c\\u52a8\\u4f5c\\u5bf9\\u8c61/\\u5e76\\u5217')]],
  [u('\\u3084'), ['non_exhaustive_list', u('\\u4e0d\\u5b8c\\u5168\\u5217\\u4e3e')]],
  [u('\\u304b'), ['question_marker', u('\\u7591\\u95ee/\\u4e0d\\u786e\\u5b9a')]],
  [u('\\u306d'), ['sentence_final_softener', u('\\u7ec8\\u52a9\\u8bcd\\uff1a\\u786e\\u8ba4/\\u5171\\u611f')]],
  [u('\\u3088'), ['sentence_final_assertion', u('\\u7ec8\\u52a9\\u8bcd\\uff1a\\u544a\\u77e5/\\u63d0\\u9192')]],
  [u('\\u304b\\u3089'), ['source_or_reason', u('\\u8d77\\u70b9/\\u539f\\u56e0')]],
  [u('\\u307e\\u3067'), ['limit_marker', u('\\u7ec8\\u70b9/\\u8303\\u56f4\\u754c\\u9650')]],
  [u('\\u3088\\u308a'), ['comparison_or_source', u('\\u6bd4\\u8f83\\u57fa\\u51c6/\\u8d77\\u70b9')]],
  [u('\\u306a\\u3069'), ['example_marker', u('\\u4e3e\\u4f8b\\uff0c\\u7b49\\u7b49')]]
]);

function parseArgs(argv) {
  const args = { limit: 0, sample: null, out: '', pretty: true };
  for (let i = 2; i < argv.length; i++) {
    const cur = argv[i];
    if (cur === '--limit') args.limit = parseInt(argv[++i], 10) || 0;
    else if (cur === '--out') args.out = argv[++i] || '';
    else if (cur === '--compact') args.pretty = false;
    else if (cur === '--sample') args.sample = { book: argv[++i], lesson: argv[++i], section: argv[++i] };
  }
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function cleanText(text) {
  return String(text || '')
    .replace(/\u3000/g, ' ')
    .replace(/[\t\f\v]+/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/ *\n+ */g, '\n')
    .trim();
}

function splitSentences(text) {
  const out = [];
  let buffer = '';
  for (const ch of Array.from(String(text || ''))) {
    buffer += ch;
    if (ch === JP.fullStop || ch === JP.question || ch === JP.exclamation || ch === '\n') {
      const sentence = buffer.trim();
      if (sentence && !/^\([^)]+\)$/.test(sentence)) out.push(sentence);
      buffer = '';
    }
  }
  const tail = buffer.trim();
  if (tail) out.push(tail);
  return out;
}

function normalizeTerm(value) {
  return String(value || '').replace(/^~+/, '').replace(/[「」（）()]/g, '').trim();
}

function cleanSourcePos(raw) {
  const text = String(raw || '');
  if (/形容動詞|形容动词|形動|形动|ナ/.test(text)) return ['na_adjective', u('\\u30ca\\u5f62\\u5bb9\\u8bcd')];
  if (/動|动|五|一|サ|自|他/.test(text)) return ['verb', u('\\u52a8\\u8bcd')];
  if (/形/.test(text)) return ['adjective', u('\\u5f62\\u5bb9\\u8bcd')];
  if (/副/.test(text)) return ['adverb', u('\\u526f\\u8bcd')];
  if (/助/.test(text)) return ['particle', u('\\u52a9\\u8bcd')];
  if (/名/.test(text)) return ['noun', u('\\u540d\\u8bcd')];
  return ['unknown', u('\\u672a\\u5b9a')];
}

function addLexiconEntry(lexicon, entry) {
  const terms = [
    entry.surface,
    entry.word,
    entry.kanji,
    entry.kana,
    entry.reading,
    entry.reading_hiragana,
    entry.source_word
  ].map(normalizeTerm).filter(Boolean);

  for (const term of terms) {
    const [posKey, posLabel] = cleanSourcePos(entry.pos_raw || entry.grammar || entry.pos || entry.display_pos_zh);
    const meaning = entry.meaning || entry.meaning_zh || (entry.meanings_zh && entry.meanings_zh[0]) || '';
    const existing = lexicon.get(term);
    if (!existing || meaning.length > (existing.meaning_zh || '').length) {
      lexicon.set(term, {
        meaning_zh: meaning,
        pos_key: posKey,
        pos_label_zh: posLabel,
        reading: entry.reading || entry.kana || entry.reading_hiragana || ''
      });
    }
  }
}

function loadVocabRows() {
  if (!fs.existsSync(VOCAB_V3)) return [];
  return readJson(VOCAB_V3);
}

function buildLessonLexicon(bundle, lessonId, vocabRows) {
  const item = (bundle.items || []).find(row => row.lesson && row.lesson.item_id === lessonId);
  const lexicon = new Map();
  if (!item || !item.lesson) return lexicon;

  for (const group of item.lesson.phonetic_sections || []) {
    for (const vocab of group.vocabulary || []) addLexiconEntry(lexicon, vocab);
  }

  for (const row of vocabRows) {
    const found = (row.textbook_sources || []).some(src =>
      src.book_id === bundle.book_id &&
      src.lesson_id === lessonId &&
      src.source_type === 'lesson_vocab'
    );
    if (found) addLexiconEntry(lexicon, row);
  }

  return lexicon;
}

function collectTextBlocks(bundle) {
  const blocks = [];
  for (const item of bundle.items || []) {
    const lesson = item.lesson || {};
    const base = {
      book_id: bundle.book_id,
      lesson_id: lesson.item_id || '',
      lesson_no: lesson.lesson_no == null ? null : lesson.lesson_no,
      lesson_title: lesson.title || ''
    };

    if (lesson.body && lesson.body.text) {
      blocks.push({ ...base, section: 'body', role: 'section_text', text: lesson.body.text });
    }
    if (lesson.application && lesson.application.text) {
      blocks.push({ ...base, section: 'application', role: 'section_text', text: lesson.application.text });
    }
    if (lesson.conversation) {
      if (lesson.conversation.context) {
        blocks.push({ ...base, section: 'conversation', role: 'context', text: lesson.conversation.context });
      }
      for (let i = 0; i < (lesson.conversation.dialogue || []).length; i++) {
        const turn = lesson.conversation.dialogue[i] || {};
        if (turn.text) {
          blocks.push({
            ...base,
            section: 'conversation',
            role: 'dialogue_turn',
            speaker: turn.speaker || '',
            turn_index: i,
            text: turn.text
          });
        }
      }
    }
  }
  return blocks;
}

function basePos(token) {
  return POS_LABELS.get(token.pos) || ['unknown', token.pos || u('\\u672a\\u5b9a')];
}

function isParticle(token) {
  return token.pos === u('\\u52a9\\u8a5e');
}

function isAuxiliary(token) {
  return token.pos === u('\\u52a9\\u52d5\\u8a5e');
}

function isSymbol(token) {
  return token.pos === u('\\u8a18\\u53f7');
}

function refineNi(previous, next) {
  const prevSurface = previous ? previous.surface : '';
  if (/[時分日月年朝昼晩夜前後頃中週]/.test(prevSurface)) return ['time_marker', u('\\u8868\\u65f6\\u95f4\\u70b9')];
  if (/[上下中外内前後横隣東西南北階室屋校駅店館園家国]/.test(prevSurface)) return ['location_or_goal_marker', u('\\u8868\\u5b58\\u5728\\u5730\\u70b9/\\u5230\\u8fbe\\u70b9')];
  if (next && /[行来帰入出着戻]/.test(next.surface || '')) return ['purpose_or_goal_marker', u('\\u8868\\u79fb\\u52a8\\u76ee\\u7684/\\u5230\\u8fbe\\u70b9')];
  return PARTICLE_ROLES.get(JP.ni);
}

function tokenRole(token, previous, next) {
  if (token.lex_hit) return ['content_word', u('\\u5b9e\\u4e49\\u8bcd\\uff0c\\u627f\\u62c5\\u53e5\\u4e2d\\u6982\\u5ff5\\u5185\\u5bb9')];

  if (isSymbol(token)) return ['punctuation', u('\\u65ad\\u53e5/\\u8bed\\u6c14')];

  if (isAuxiliary(token)) {
    return ['auxiliary_function', u('\\u6784\\u6210\\u65f6\\u6001/\\u5426\\u5b9a/\\u793c\\u8c8c/\\u8bed\\u6c14')];
  }

  if (isParticle(token)) {
    if (token.surface_form === JP.ni) return refineNi(previous, next);
    if (token.surface_form === u('\\u304c') && previous && /です|ます/.test(previous.surface)) {
      return ['contrastive_connector', u('\\u9006\\u63a5/\\u94fa\\u57ab\\u8fde\\u63a5')];
    }
    return PARTICLE_ROLES.get(token.surface_form) || ['particle_function', u('\\u52a9\\u8bcd\\u529f\\u80fd')];
  }

  if (token.pos === u('\\u526f\\u8a5e')) return ['modifier', u('\\u4fee\\u9970\\u52a8\\u4f5c/\\u72b6\\u6001')];
  if (token.pos === u('\\u63a5\\u7d9a\\u8a5e')) return ['connector', u('\\u8fde\\u63a5\\u524d\\u540e\\u6587')];
  return ['content_word', u('\\u5b9e\\u4e49\\u8bcd\\uff0c\\u627f\\u62c5\\u53e5\\u4e2d\\u6982\\u5ff5\\u5185\\u5bb9')];
}

function analyzeSentence(tokenizer, sentence, lexicon) {
  const rawTokens = mergeLexiconTokens(
    tokenizer.tokenize(sentence),
    lexicon
  ).filter(token => !(isSymbol(token) && /^\s+$/.test(token.surface_form)));

  const projected = rawTokens.map((token, index) => {
    const [posKey, posLabel] = token.lex_hit ? [token.lex_hit.pos_key, token.lex_hit.pos_label_zh] : basePos(token);
    const basic = token.basic_form && token.basic_form !== '*' ? token.basic_form : token.surface_form;
    const lexHit = token.lex_hit || ((!isParticle(token) && !isAuxiliary(token) && !isSymbol(token))
      ? (lexicon.get(token.surface_form) || lexicon.get(basic))
      : null);

    return {
      index,
      surface: token.surface_form,
      base: basic,
      reading: token.reading || '',
      pos_key: lexHit ? lexHit.pos_key : posKey,
      pos_label_zh: lexHit ? lexHit.pos_label_zh : posLabel,
      meaning_zh: lexHit ? lexHit.meaning_zh : '',
      raw_pos: [token.pos, token.pos_detail_1, token.pos_detail_2, token.pos_detail_3].filter(Boolean).join('/')
    };
  });

  return projected.map((token, index) => {
    const previous = [...projected.slice(0, index)].reverse().find(item => item.pos_key !== 'symbol');
    const next = projected.slice(index + 1).find(item => item.pos_key !== 'symbol');
    const raw = rawTokens[index];
    const [functionKey, functionLabel] = tokenRole(raw, previous, next);
    return {
      ...token,
      function_key: functionKey,
      function_label_zh: functionLabel
    };
  });
}

function mergeLexiconTokens(tokens, lexicon) {
  const merged = [];
  const maxParts = 8;
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];
    if (isSymbol(token)) {
      merged.push(token);
      i++;
      continue;
    }

    let best = null;
    let bestEnd = i;
    let surface = '';

    for (let j = i; j < Math.min(tokens.length, i + maxParts); j++) {
      if (isSymbol(tokens[j])) break;
      surface += tokens[j].surface_form;
      const hit = lexicon.get(surface);
      if (hit && Array.from(surface).length > 1) {
        best = { surface, hit };
        bestEnd = j;
      }
    }

    if (best) {
      const parts = tokens.slice(i, bestEnd + 1);
      merged.push({
        surface_form: best.surface,
        basic_form: best.surface,
        reading: parts.map(part => part.reading || '').join(''),
        pos: parts[0].pos,
        pos_detail_1: parts[0].pos_detail_1,
        pos_detail_2: parts[0].pos_detail_2,
        pos_detail_3: parts[0].pos_detail_3,
        lex_hit: best.hit
      });
      i = bestEnd + 1;
      continue;
    }

    merged.push(token);
    i++;
  }

  return merged;
}

function buildTokenizer() {
  return new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath: path.join(ROOT, 'node_modules', 'kuromoji', 'dict') }).build((err, tokenizer) => {
      if (err) reject(err);
      else resolve(tokenizer);
    });
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const tokenizer = await buildTokenizer();
  const vocabRows = loadVocabRows();
  const output = [];

  for (const bookId of BOOKS) {
    const bundle = readJson(path.join(BOOK_DIR, bookId + '.bundle.json'));
    const lexiconByLesson = new Map();
    const blocks = collectTextBlocks(bundle);

    for (const block of blocks) {
      if (args.sample) {
        if (block.book_id !== args.sample.book || block.lesson_id !== args.sample.lesson || block.section !== args.sample.section) continue;
      }

      if (!lexiconByLesson.has(block.lesson_id)) {
        lexiconByLesson.set(block.lesson_id, buildLessonLexicon(bundle, block.lesson_id, vocabRows));
      }

      const lexicon = lexiconByLesson.get(block.lesson_id);
      const clean = cleanText(block.text);
      const sentences = splitSentences(clean);
      for (let i = 0; i < sentences.length; i++) {
        output.push({
          id: [block.book_id, block.lesson_id, block.section, block.role, block.turn_index == null ? '' : block.turn_index, i].filter(String).join('::'),
          book_id: block.book_id,
          lesson_id: block.lesson_id,
          lesson_no: block.lesson_no,
          lesson_title: block.lesson_title,
          section: block.section,
          role: block.role,
          speaker: block.speaker || '',
          turn_index: block.turn_index == null ? null : block.turn_index,
          sentence_index: i,
          text: sentences[i],
          tokens: analyzeSentence(tokenizer, sentences[i], lexicon)
        });

        if (args.limit && output.length >= args.limit) break;
      }
      if (args.limit && output.length >= args.limit) break;
    }
    if (args.limit && output.length >= args.limit) break;
  }

  const payload = {
    meta: {
      pipeline: 'textbook_text_tokens',
      analyzer: 'kuromoji',
      sections: ['body', 'application', 'conversation'],
      excluded_sections: ['study_window'],
      sentence_count: output.length
    },
    sentences: output
  };

  const json = JSON.stringify(payload, null, args.pretty ? 2 : 0) + '\n';
  if (args.out) {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    fs.writeFileSync(args.out, json, 'utf8');
  } else {
    process.stdout.write(json);
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = { cleanSourcePos, mergeLexiconTokens };
