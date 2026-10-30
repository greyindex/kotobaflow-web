const fs = require('fs');
const path = require('path');

const INPUT = path.join('data', 'wiki', 'processed', 'textbook_wiki_extensions.json');
const OUTPUT = path.join('data', 'wiki', 'processed', 'textbook_wiki_reading_candidates.v1.json');
const MAX_CHARS = Number(process.argv.find(a => a.startsWith('--max-chars='))?.split('=')[1] || 3000);
const MIN_AUTO_CHARS = Number(process.argv.find(a => a.startsWith('--min-auto-chars='))?.split('=')[1] || 500);

const BAD_SECTION_RE = /(関連|外部リンク|脚注|注釈|出典|参考文献|参考資料|関連項目|文献|ギャラリー|一覧|年表|カテゴリ|パビリオン一覧|主要施設|イベント|作品|登場|受賞|著書|出演|フィルモグラフィ|リンク)/;
const GOOD_SECTION_RE = /^(概要|概説|特徴|由来|歴史|構成|利用|文化|種類|分類|背景|影響|制度|伝承|概況|教育|生活|観光|交流|語源|発音|表記)$/;
const TOO_SHORT_RE = /^[\s・*　-]*.{0,18}$/u;
const SEE_ALSO_RE = /^(詳細は|については|詳細については).+をご覧ください。?$/;
const MAINTENANCE_RE = /(Wikipedia:|翻訳告知|翻訳のガイドライン|履歴継承|要約欄|この記事は.+から翻訳された|正確性に疑問が呈されています|出典を追加して記事の信頼性向上にご協力ください)/;

function normalizeText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/注釈\s*/g, '注 ')
    .trim();
}

function sectionText(section) {
  return (section.paragraphs || [])
    .map(normalizeText)
    .filter(Boolean)
    .join('\n');
}

function paragraphLooksUseful(text) {
  const t = normalizeText(text);
  if (!t) return false;
  if (TOO_SHORT_RE.test(t)) return false;
  if (SEE_ALSO_RE.test(t)) return false;
  if (MAINTENANCE_RE.test(t)) return false;
  if (/^[\d０-９]+年[、,]?$/.test(t)) return false;
  return true;
}

function isListLike(section) {
  const paragraphs = (section.paragraphs || []).map(normalizeText).filter(Boolean);
  if (paragraphs.length < 6) return false;
  const shortCount = paragraphs.filter(p => p.length < 35).length;
  return shortCount / paragraphs.length > 0.55;
}

function scoreSection(section, lesson, order) {
  const title = section.title || '';
  if (BAD_SECTION_RE.test(title)) return -100;
  if (isListLike(section)) return -50;

  let score = 0;
  if (title === '概要') score += 90;
  if (title === '概説') score += 85;
  if (GOOD_SECTION_RE.test(title)) score += 50;
  if ((section.level || 1) <= 2) score += 10;
  if (order < 4) score += 10;

  const haystack = [lesson.lessonTitle, lesson.wiki?.title, ...(lesson.targetCandidates || [])].join(' ');
  if (title && haystack.includes(title)) score += 25;
  if (title && lesson.lessonTitle && title.includes(lesson.lessonTitle)) score += 25;

  const chars = sectionText(section).length;
  if (chars < 80) score -= 20;
  if (chars > 1200 && !GOOD_SECTION_RE.test(title)) score -= 5;
  return score;
}

function appendWithinCap(parts, item, maxChars) {
  const current = parts.join('\n\n');
  const sep = current ? '\n\n' : '';
  if (current.length + sep.length + item.text.length <= maxChars) {
    parts.push(item.text);
    return true;
  }

  const remaining = maxChars - current.length - sep.length;
  if (remaining >= 180) {
    const trimmed = item.text.slice(0, remaining);
    const cut = Math.max(trimmed.lastIndexOf('。'), trimmed.lastIndexOf('\n'));
    if (cut >= 120) {
      parts.push(trimmed.slice(0, cut + 1));
      return true;
    }
  }
  return false;
}

function prepareLesson(lesson, pages) {
  const page = pages[String(lesson.wiki.pageid)];
  const sections = page?.sections || [];
  const sectionItems = sections.map((section, order) => {
    const usefulParagraphs = (section.paragraphs || []).map(normalizeText).filter(paragraphLooksUseful);
    return {
      order,
      title: section.title || '概要',
      level: section.level || 1,
      text: usefulParagraphs.join('\n'),
      originalChars: sectionText(section).length,
      usefulChars: usefulParagraphs.join('\n').length,
      score: scoreSection(section, lesson, order),
      listLike: isListLike(section),
    };
  }).filter(item => item.text && item.score > -50);

  const selected = [];
  const selectedKeys = new Set();
  const parts = [];

  function take(item) {
    const key = `${item.order}:${item.title}`;
    if (selectedKeys.has(key)) return;
    if (!appendWithinCap(parts, item, MAX_CHARS)) return;
    selectedKeys.add(key);
    selected.push({
      title: item.title,
      level: item.level,
      chars: item.text.length,
      score: item.score,
    });
  }

  for (const item of sectionItems.filter(i => i.title === '概要' || i.title === '概説').sort((a, b) => a.order - b.order)) {
    take(item);
  }

  for (const item of [...sectionItems].sort((a, b) => b.score - a.score || a.order - b.order)) {
    if (parts.join('\n\n').length >= MAX_CHARS * 0.88) break;
    take(item);
  }

  const text = parts.join('\n\n').trim();
  const fullChars = sections.map(sectionText).join('\n\n').length;
  const reasons = [];
  if (text.length < MIN_AUTO_CHARS) reasons.push('selected_text_too_short');
  if (fullChars < MIN_AUTO_CHARS) reasons.push('source_too_short');
  if (selected.length === 0) reasons.push('no_selectable_section');
  if (fullChars > 10000 && selected.every(s => !/概要|概説|特徴|由来|歴史|利用|文化|観光|教育|伝承/.test(s.title))) {
    reasons.push('long_article_low_confidence_sections');
  }
  if (sectionItems.filter(i => i.listLike).length >= Math.max(3, sectionItems.length * 0.35)) {
    reasons.push('many_list_like_sections');
  }

  return {
    bookId: lesson.bookId,
    lessonId: lesson.lessonId,
    lessonTitle: lesson.lessonTitle,
    targetCandidates: lesson.targetCandidates || [],
    wiki: {
      pageid: lesson.wiki.pageid,
      title: lesson.wiki.title,
      url: lesson.wiki.url,
      lastrevid: lesson.wiki.lastrevid,
      license: lesson.wiki.license,
      source: lesson.wiki.source,
    },
    sourceCharCount: fullChars,
    readingCharCount: text.length,
    maxChars: MAX_CHARS,
    status: reasons.length ? 'manual_review' : 'auto',
    reviewReasons: reasons,
    selectedSections: selected,
    readingText: text,
  };
}

function main() {
  const input = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
  const pages = input.pages || {};
  const readings = (input.lessons || []).map(lesson => prepareLesson(lesson, pages));
  const summary = {
    total: readings.length,
    auto: readings.filter(r => r.status === 'auto').length,
    manual_review: readings.filter(r => r.status === 'manual_review').length,
    maxChars: MAX_CHARS,
    tooLong: readings.filter(r => r.readingCharCount > MAX_CHARS).length,
    tooShort: readings.filter(r => r.readingCharCount < MIN_AUTO_CHARS).length,
    generatedAt: new Date().toISOString(),
  };

  const output = {
    version: 1,
    kind: 'textbook_wiki_reading_candidates',
    sourceFile: INPUT.replaceAll(path.sep, '/'),
    summary,
    readings,
  };

  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2), 'utf8');
  console.log(JSON.stringify(summary, null, 2));
  const manual = readings.filter(r => r.status === 'manual_review');
  for (const r of manual) {
    console.log(`${r.bookId} ${r.lessonId} ${r.lessonTitle} -> ${r.wiki.title}: ${r.readingCharCount}/${r.sourceCharCount} ${r.reviewReasons.join(',')}`);
  }
}

main();
