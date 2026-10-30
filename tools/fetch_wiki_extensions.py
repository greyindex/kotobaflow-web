from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parents[1]
BOOK_DIR = ROOT / "data" / "textbook" / "canonical_books"
OUT_DIR = ROOT / "data" / "wiki"
RAW_DIR = OUT_DIR / "raw" / "ja"
PROCESSED_DIR = OUT_DIR / "processed"
TARGETS_PATH = PROCESSED_DIR / "textbook_extension_targets.json"
PROCESSED_PATH = PROCESSED_DIR / "textbook_wiki_extensions.json"
API_URL = "https://ja.wikipedia.org/w/api.php"
USER_AGENT = "Ver03JapaneseStudyTool/0.1 (local educational cache; no-public-contact) Python-urllib"
REQUEST_DELAY_SECONDS = 0.8


TARGET_BY_LESSON = {
    "XinBian1:lesson_01": ["五十音"],
    "XinBian1:lesson_02": ["挨拶"],
    "XinBian1:lesson_03": ["和室"],
    "XinBian1:lesson_04": ["学園都市"],
    "XinBian1:review_unit_01": ["外灘"],
    "XinBian1:lesson_05": ["大学"],
    "XinBian1:lesson_06": ["浦東新区", "浦東"],
    "XinBian1:lesson_07": ["2008年北京オリンピック", "北京オリンピック"],
    "XinBian1:lesson_08": ["デジタルカメラ"],
    "XinBian1:review_unit_02": ["ゴールデンウィーク", "連休"],
    "XinBian1:lesson_09": ["趣味"],
    "XinBian1:lesson_10": ["試験"],
    "XinBian1:lesson_11": ["留学"],
    "XinBian1:lesson_12": ["挨拶"],
    "XinBian1:review_unit_03": ["アルバイト"],
    "XinBian1:lesson_13": ["クリスマス"],
    "XinBian1:lesson_14": ["元日", "元旦"],
    "XinBian1:lesson_15": ["料理"],
    "XinBian1:lesson_16": ["インタビュー"],
    "XinBian1:review_unit_04": ["春節"],
    "XinBian2:lesson_01": ["学期"],
    "XinBian2:lesson_02": ["バーゲンセール"],
    "XinBian2:lesson_03": ["病気", "疾病"],
    "XinBian2:lesson_04": ["御馳走", "ご馳走"],
    "XinBian2:review_unit_01": ["テープレコーダー"],
    "XinBian2:lesson_05": ["地下鉄"],
    "XinBian2:lesson_06": ["誕生日"],
    "XinBian2:lesson_07": ["日本語"],
    "XinBian2:lesson_08": ["体験"],
    "XinBian2:review_unit_02": ["メーデー"],
    "XinBian2:lesson_09": ["吾輩は猫である"],
    "XinBian2:lesson_10": ["日本語教育"],
    "XinBian2:lesson_11": ["敬語"],
    "XinBian2:lesson_12": ["日本語教師"],
    "XinBian2:review_unit_03": ["インターンシップ", "職場体験"],
    "XinBian2:lesson_13": ["東京"],
    "XinBian2:lesson_14": ["工場見学"],
    "XinBian2:lesson_15": ["家庭訪問"],
    "XinBian2:lesson_16": ["歌舞伎", "相撲"],
    "XinBian2:review_unit_04": ["東京"],
    "XinBian3:lesson_01": ["上海国際博覧会"],
    "XinBian3:lesson_02": ["パーソナルコンピュータ", "パソコン"],
    "XinBian3:lesson_03": ["第3世代移動通信システム"],
    "XinBian3:lesson_04": ["デジタルカメラ"],
    "XinBian3:lesson_05": ["上海ディズニーランド"],
    "XinBian3:lesson_06": ["電子辞書"],
    "XinBian3:lesson_07": ["クイズ", "なぞなぞ"],
    "XinBian3:lesson_08": ["プレゼンテーション"],
    "XinBian3:lesson_09": ["会議"],
    "XinBian3:lesson_10": ["イソップ寓話"],
    "XinBian3:lesson_11": ["コピー食品", "代用食品"],
    "XinBian3:lesson_12": ["クレジットカード"],
    "XinBian3:lesson_13": ["知覚"],
    "XinBian3:lesson_14": ["インスタント食品"],
    "XinBian3:lesson_15": ["漫画"],
    "XinBian3:lesson_16": ["マスメディア"],
    "XinBian3:lesson_17": ["映画"],
    "XinBian3:lesson_18": ["テレビ"],
    "XinBian4:lesson_01": ["日本"],
    "XinBian4:lesson_02": ["カラオケ"],
    "XinBian4:lesson_03": ["落語"],
    "XinBian4:lesson_04": ["日本料理"],
    "XinBian4:lesson_05": ["着物"],
    "XinBian4:lesson_06": ["雑誌"],
    "XinBian4:lesson_07": ["本音と建前"],
    "XinBian4:lesson_08": ["廃棄物"],
    "XinBian4:lesson_09": ["環境問題"],
    "XinBian4:lesson_10": ["教育"],
    "XinBian4:lesson_11": ["日本語教育"],
    "XinBian4:lesson_12": ["婉曲法"],
    "XinBian4:lesson_13": ["擬声語", "擬態語"],
    "XinBian4:lesson_14": ["ことわざ"],
    "XinBian4:lesson_15": ["中華人民共和国の観光", "中国の観光"],
    "XinBian4:lesson_16": ["北京の西瓜", "大林宣彦"],
    "XinBian4:lesson_17": ["日中関係史"],
    "XinBian4:lesson_18": ["徐福"],
}


EXCLUDED_SECTION_PREFIXES = (
    "脚注",
    "注釈",
    "出典",
    "参考文献",
    "関連項目",
    "外部リンク",
    "参考資料",
    "関連書籍",
    "関連文献",
    "ギャラリー",
    "一覧",
)


def api_get(params: dict[str, object], retries: int = 5) -> dict[str, object]:
    query = dict(params)
    query.setdefault("format", "json")
    query.setdefault("formatversion", "2")
    query.setdefault("maxlag", "5")
    url = API_URL + "?" + urllib.parse.urlencode(query)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=45) as res:
                return json.loads(res.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code in (429, 503):
                wait = min(90, 10 * (attempt + 1))
                print(f"[wiki] HTTP {exc.code}; waiting {wait}s", file=sys.stderr)
                time.sleep(wait)
                continue
            raise
        except urllib.error.URLError:
            if attempt + 1 >= retries:
                raise
            time.sleep(5 * (attempt + 1))
    raise RuntimeError("Wikimedia API request failed after retries")


def load_lessons() -> list[dict[str, object]]:
    lessons: list[dict[str, object]] = []
    for book_no in range(1, 5):
        book_id = f"XinBian{book_no}"
        payload = json.loads((BOOK_DIR / f"{book_id}.bundle.json").read_text(encoding="utf-8"))
        for meta in payload["index"]["lessons"]:
            key = f"{book_id}:{meta['lesson_id']}"
            targets = TARGET_BY_LESSON.get(key)
            lessons.append(
                {
                    "bookId": book_id,
                    "lessonId": meta["lesson_id"],
                    "lessonLabel": meta.get("chapter_label") or meta.get("item_id"),
                    "lessonTitle": meta.get("title_ja") or meta.get("title") or meta["lesson_id"],
                    "targetCandidates": targets or [meta.get("title_ja") or meta["lesson_id"]],
                }
            )
    return lessons


def normalize_title(title: str) -> str:
    value = unicodedata.normalize("NFKC", title)
    value = value.replace(" ", "_")
    value = re.sub(r"[\\/:*?\"<>|]+", "_", value)
    return value[:120]


def page_url(title: str) -> str:
    return "https://ja.wikipedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_"))


def resolve_page(title_candidates: list[str]) -> dict[str, object] | None:
    for title in title_candidates:
        data = api_get(
            {
                "action": "query",
                "prop": "info",
                "inprop": "url",
                "redirects": "1",
                "titles": title,
            }
        )
        pages = data.get("query", {}).get("pages", [])
        for page in pages:
            if page.get("missing"):
                continue
            return {
                "requestedTitle": title,
                "pageid": page.get("pageid"),
                "title": page.get("title"),
                "lastrevid": page.get("lastrevid"),
                "fullurl": page.get("fullurl") or page_url(str(page.get("title"))),
                "redirects": data.get("query", {}).get("redirects", []),
            }
        time.sleep(REQUEST_DELAY_SECONDS)
    return None


def fetch_parse(title: str) -> dict[str, object]:
    return api_get(
        {
            "action": "parse",
            "page": title,
            "prop": "text|sections|displaytitle|revid",
            "redirects": "1",
            "disableeditsection": "1",
            "disabletoc": "1",
        }
    )


class WikiTextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.blocks: list[dict[str, object]] = []
        self._current_tag = ""
        self._current_level = 0
        self._buffer: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = dict(attrs)
        classes = attrs_dict.get("class") or ""
        if tag in {"style", "script", "table", "sup", "figure", "math"}:
            self._skip_depth += 1
            return
        if "mw-editsection" in classes or "reference" in classes or "navbox" in classes:
            self._skip_depth += 1
            return
        if tag in {"p", "li", "h2", "h3", "h4"} and not self._current_tag:
            self._current_tag = tag
            self._current_level = int(tag[1]) if tag.startswith("h") else 0
            self._buffer = []
        elif tag == "br" and self._current_tag:
            self._buffer.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if self._skip_depth:
            if tag in {"style", "script", "table", "sup", "figure", "math", "span", "div"}:
                self._skip_depth = max(0, self._skip_depth - 1)
            return
        if tag == self._current_tag:
            text = clean_text("".join(self._buffer))
            if text:
                kind = "heading" if tag.startswith("h") else "paragraph"
                self.blocks.append({"type": kind, "level": self._current_level, "text": text})
            self._current_tag = ""
            self._current_level = 0
            self._buffer = []

    def handle_data(self, data: str) -> None:
        if self._skip_depth or not self._current_tag:
            return
        self._buffer.append(data)


def clean_text(value: str) -> str:
    value = html.unescape(value)
    value = unicodedata.normalize("NFKC", value)
    value = re.sub(r"\[\s*編集\s*\]", "", value)
    value = re.sub(r"(?:\[[0-9]+\]|[0-9]+\])", "", value)
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def is_noise_paragraph(text: str) -> bool:
    noise_prefixes = (
        "出典がまったく示されていない",
        "出典は列挙するだけでなく",
        "独自研究が含まれている",
        "百科事典的でない記述",
        "この記事には",
        "この記事は",
        "この項目は",
        "このページには",
        "ウィキペディアはオンライン百科事典であって",
        "出典検索:",
    )
    if any(text.startswith(prefix) for prefix in noise_prefixes):
        return True
    if "出典検索:" in text and "ニュース" in text:
        return True
    return False


def process_html(raw_html: str) -> dict[str, object]:
    parser = WikiTextParser()
    parser.feed(raw_html)
    sections: list[dict[str, object]] = []
    current = {"title": "概要", "level": 1, "paragraphs": []}
    top_excluded = False
    for block in parser.blocks:
        text = str(block["text"])
        if block["type"] == "heading":
            if current["paragraphs"]:
                sections.append(current)
            current = {"title": text, "level": block["level"], "paragraphs": []}
            top_excluded = any(text.startswith(prefix) for prefix in EXCLUDED_SECTION_PREFIXES)
            continue
        if top_excluded:
            continue
        if len(text) < 2 or is_noise_paragraph(text):
            continue
        current["paragraphs"].append(text)
    if current["paragraphs"]:
        sections.append(current)

    full_paragraphs: list[str] = []
    for section in sections:
        full_paragraphs.extend(str(p) for p in section["paragraphs"])
    full_text = "\n\n".join(full_paragraphs)
    reading_text = build_reading_text(sections)
    return {
        "sections": sections,
        "plainTextFull": full_text,
        "processedReading": reading_text,
        "chunks": split_chunks(reading_text),
        "charCountFull": len(full_text),
        "charCountReading": len(reading_text),
    }


def build_reading_text(sections: list[dict[str, object]], limit: int = 8000) -> str:
    paragraphs: list[str] = []
    for section in sections:
        title = str(section["title"])
        if title != "概要":
            paragraphs.append(f"【{title}】")
        paragraphs.extend(str(p) for p in section["paragraphs"])
        if sum(len(p) for p in paragraphs) >= limit:
            break
    text = "\n\n".join(paragraphs)
    if len(text) > limit:
        text = text[:limit].rstrip() + "..."
    return text


def split_chunks(text: str) -> list[dict[str, object]]:
    chunks: list[dict[str, object]] = []
    for para_index, paragraph in enumerate(re.split(r"\n{2,}", text)):
        paragraph = paragraph.strip()
        if not paragraph:
            continue
        sentences = re.split(r"(?<=[。！？])", paragraph)
        for sentence in sentences:
            sentence = sentence.strip()
            if not sentence:
                continue
            chunks.append({"paragraphIndex": para_index, "text": sentence})
    return chunks


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="refetch pages even if raw cache exists")
    parser.add_argument("--process-only", action="store_true", help="regenerate processed JSON from existing raw cache")
    args = parser.parse_args()

    lessons = load_lessons()
    resolved_by_key: dict[str, dict[str, object]] = {}
    pages_by_title: dict[str, dict[str, object]] = {}

    if args.process_only:
        target_entries = json.loads(TARGETS_PATH.read_text(encoding="utf-8"))
        for entry in target_entries:
            key = f"{entry['bookId']}:{entry['lessonId']}"
            resolved = entry.get("resolved") or {}
            resolved_by_key[key] = resolved
            if resolved.get("title"):
                pages_by_title[str(resolved["title"])] = resolved
    else:
        for lesson in lessons:
            key = f"{lesson['bookId']}:{lesson['lessonId']}"
            resolved = resolve_page([str(t) for t in lesson["targetCandidates"]])
            if not resolved:
                print(f"[wiki] missing target for {key}: {lesson['targetCandidates']}", file=sys.stderr)
                resolved_by_key[key] = {"missing": True, "targetCandidates": lesson["targetCandidates"]}
                continue
            resolved_by_key[key] = resolved
            pages_by_title[str(resolved["title"])] = resolved
            print(f"[wiki] {key} -> {resolved['title']}", flush=True)
            time.sleep(REQUEST_DELAY_SECONDS)

    pages: dict[str, dict[str, object]] = {}
    for title, resolved in pages_by_title.items():
        pageid = resolved["pageid"]
        raw_path = RAW_DIR / f"{pageid}_{normalize_title(title)}.json"
        if raw_path.exists() and not args.force:
            raw = json.loads(raw_path.read_text(encoding="utf-8"))
        else:
            raw = fetch_parse(title)
            write_json(raw_path, raw)
            time.sleep(REQUEST_DELAY_SECONDS)
        parse_payload = raw.get("parse", {})
        processed = process_html(str(parse_payload.get("text", "")))
        pages[str(pageid)] = {
            "pageid": pageid,
            "title": parse_payload.get("title") or title,
            "url": resolved.get("fullurl") or page_url(title),
            "lastrevid": parse_payload.get("revid") or resolved.get("lastrevid"),
            "rawCachePath": str(raw_path.relative_to(ROOT)).replace("\\", "/"),
            "license": "CC BY-SA",
            "source": "ja.wikipedia.org",
            **processed,
        }

    lesson_entries: list[dict[str, object]] = []
    target_entries: list[dict[str, object]] = []
    for lesson in lessons:
        key = f"{lesson['bookId']}:{lesson['lessonId']}"
        resolved = resolved_by_key.get(key, {})
        page = pages.get(str(resolved.get("pageid")))
        target_entries.append({**lesson, "resolved": resolved})
        lesson_entries.append(
            {
                **lesson,
                "wiki": None
                if not page
                else {
                    "pageid": page["pageid"],
                    "title": page["title"],
                    "url": page["url"],
                    "lastrevid": page["lastrevid"],
                    "license": page["license"],
                    "source": page["source"],
                    "charCountFull": page["charCountFull"],
                    "charCountReading": page["charCountReading"],
                    "processedReading": page["processedReading"],
                    "chunks": page["chunks"],
                },
            }
        )

    output = {
        "version": 1,
        "language": "ja",
        "retrievedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "source": "https://ja.wikipedia.org/",
        "license": "CC BY-SA",
        "requestPolicy": {
            "userAgent": USER_AGENT,
            "delaySeconds": REQUEST_DELAY_SECONDS,
            "rawCache": "data/wiki/raw/ja",
        },
        "lessons": lesson_entries,
        "pages": pages,
    }
    write_json(TARGETS_PATH, target_entries)
    write_json(PROCESSED_PATH, output)
    print(f"[wiki] wrote {TARGETS_PATH.relative_to(ROOT)}", flush=True)
    print(f"[wiki] wrote {PROCESSED_PATH.relative_to(ROOT)}", flush=True)
    print(f"[wiki] resolved lessons: {sum(1 for x in lesson_entries if x['wiki'])}/{len(lesson_entries)}", flush=True)
    print(f"[wiki] unique pages: {len(pages)}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
