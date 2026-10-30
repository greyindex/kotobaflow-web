from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOOLS_DIR = ROOT / "tools"
sys.path.insert(0, str(TOOLS_DIR))

import fetch_wiki_extensions as wiki  # noqa: E402

TARGETS_PATH = ROOT / "data" / "wiki" / "processed" / "textbook_extension_targets.json"
PROCESSED_PATH = ROOT / "data" / "wiki" / "processed" / "textbook_wiki_extensions.json"

OVERRIDES = {
    # Avoid reusing "挨拶"; this first beginner lesson practices pronouns and forms of address.
    "XinBian1:lesson_02": ["人称代名詞", "日本語の一人称代名詞"],
    # Avoid reusing "デジタルカメラ"; this lesson uses a family photo from hanami as the scene.
    "XinBian1:lesson_08": ["花見", "上野恩賜公園", "写真"],
    # The original "試験" page is too short. This lesson's test format is close to JLPT sections.
    "XinBian1:lesson_10": ["日本語能力試験", "入学試験"],
    # The lesson is about returning from winter break and preparing for the new term.
    "XinBian2:lesson_01": ["始業式", "学校行事"],
    # The lesson centers on treating someone to food, especially sushi/Japanese food.
    "XinBian2:lesson_04": ["寿司", "日本料理"],
    # The original "体験" page is only a dictionary-like stub. Use the education-oriented concept.
    "XinBian2:lesson_08": ["体験学習", "経験"],
    # The lesson focuses on an automated car factory using robots and computers.
    "XinBian2:lesson_14": ["産業用ロボット", "自動車産業"],
    # The original "着物" page is too short; "和服" covers kimono types and modern usage.
    "XinBian4:lesson_05": ["和服", "振袖", "成人式"],
    # Avoid reusing "日本語教育"; this lesson is about acquiring Japanese as a learner.
    "XinBian4:lesson_11": ["第二言語習得", "語学", "外国語教育"],
    # Avoid reusing "東京"; this review focuses on urban problems seen during the visit.
    "XinBian2:review_unit_04": ["都市問題", "東京一極集中", "ラッシュ時"],
}


def fetch_or_process_page(resolved: dict[str, object]) -> dict[str, object]:
    title = str(resolved["title"])
    pageid = resolved["pageid"]
    raw_path = wiki.RAW_DIR / f"{pageid}_{wiki.normalize_title(title)}.json"
    if raw_path.exists():
        raw = json.loads(raw_path.read_text(encoding="utf-8"))
    else:
        raw = wiki.fetch_parse(title)
        wiki.write_json(raw_path, raw)
        time.sleep(wiki.REQUEST_DELAY_SECONDS)

    parse_payload = raw.get("parse", {})
    processed = wiki.process_html(str(parse_payload.get("text", "")))
    return {
        "pageid": pageid,
        "title": parse_payload.get("title") or title,
        "url": resolved.get("fullurl") or wiki.page_url(title),
        "lastrevid": parse_payload.get("revid") or resolved.get("lastrevid"),
        "rawCachePath": str(raw_path.relative_to(ROOT)).replace("\\", "/"),
        "license": "CC BY-SA",
        "source": "ja.wikipedia.org",
        **processed,
    }


def compact_lesson_page(page: dict[str, object]) -> dict[str, object]:
    return {
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
    }


def main() -> int:
    targets = json.loads(TARGETS_PATH.read_text(encoding="utf-8"))
    processed = json.loads(PROCESSED_PATH.read_text(encoding="utf-8"))
    pages = processed.setdefault("pages", {})

    lessons_by_key = {
        f"{entry['bookId']}:{entry['lessonId']}": entry
        for entry in processed.get("lessons", [])
    }
    targets_by_key = {
        f"{entry['bookId']}:{entry['lessonId']}": entry
        for entry in targets
    }

    changed = []
    for key, candidates in OVERRIDES.items():
        resolved = wiki.resolve_page(candidates)
        if not resolved:
            raise RuntimeError(f"Could not resolve override for {key}: {candidates}")
        page = fetch_or_process_page(resolved)
        pages[str(page["pageid"])] = page

        lesson = lessons_by_key.get(key)
        target = targets_by_key.get(key)
        if not lesson or not target:
            raise KeyError(f"Missing lesson/target entry for {key}")

        lesson["targetCandidates"] = candidates
        lesson["wiki"] = compact_lesson_page(page)
        target["targetCandidates"] = candidates
        target["resolved"] = resolved
        changed.append((key, page["title"], page["charCountFull"], page["charCountReading"]))
        print(f"[wiki-override] {key} -> {page['title']} ({page['charCountFull']} chars)")
        time.sleep(wiki.REQUEST_DELAY_SECONDS)

    used_pageids = {
        str(entry["wiki"]["pageid"])
        for entry in processed.get("lessons", [])
        if entry.get("wiki")
    }
    processed["pages"] = {
        pageid: page
        for pageid, page in pages.items()
        if pageid in used_pageids
    }
    processed["retrievedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")

    wiki.write_json(TARGETS_PATH, targets)
    wiki.write_json(PROCESSED_PATH, processed)
    print(f"[wiki-override] wrote {TARGETS_PATH.relative_to(ROOT)}")
    print(f"[wiki-override] wrote {PROCESSED_PATH.relative_to(ROOT)}")
    print(f"[wiki-override] changed {len(changed)} entries")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
