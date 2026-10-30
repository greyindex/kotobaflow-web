"""Install the current KotobaFlow audio (2026-10-06 handoff) for the site.

    python -X utf8 tools/install_kotobaflow_audio.py --source-root <repo holding local/qa>

Sources (see docs/audio-handoff-2026-10-06.md), all read-only:
  reading   Chirp3-HD Aoede A/B sections: local/qa/chirp3-reading-76-2026-10-05/section-timings.json
  dialogue  Gemini 3.8 Flash-Lite D chapters: local/qa/gemini-lite-full-2026-10-05/chapter-timings.json,
            grouped into rendered turns by local/qa/curriculum-role-voices-2026-10-05/utterance-voice-map.json
  words     Aoede supplement recordings: local/qa/chirp3-missing-2026-10-05/curriculum-word-audio-map.json
Section OGGs come from the shared preview folder local/qa/curriculum-tts-full-76-2026-10-04/preview and
are copied unchanged; supplement WAVs are encoded to mono Opus like the legacy word library. Output goes
to the git-ignored data/kotobaflow_reading_chirp_v1/, data/kotobaflow_dialogue_lite_v1/ and
data/kotobaflow_word_audio_v1/ of this checkout. Words that already match a legacy recording keep it
through vocab_audio_index; words.json lists supplement rows and the legacy rows the site chunks never
linked (their legacy OGG is copied, or encoded from the WAV). Chapter 0 kana clips are not part of
this install.
"""

import argparse
import hashlib
import json
import pathlib
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
BOOKS = [("KotobaFlow1", 1, 18), ("KotobaFlow2", 19, 36), ("KotobaFlow3", 37, 56), ("KotobaFlow4", 57, 76)]
READING_DIR = "data/kotobaflow_reading_chirp_v1"
DIALOGUE_DIR = "data/kotobaflow_dialogue_lite_v1"
WORD_DIR = "data/kotobaflow_word_audio_v1"
READING_KEYS = {"A": "body", "B": "application"}


def fail(message):
    sys.exit("install_kotobaflow_audio: " + message)


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(path):
    if not path.exists():
        fail("missing source file " + str(path))
    return json.loads(path.read_text(encoding="utf-8"))


def duration(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        check=True,
        capture_output=True,
        text=True,
    )
    return round(float(out.stdout.strip()), 3)


def web_file(web, url):
    path = web / url.split("?", 1)[0]
    if not path.exists():
        fail("missing web audio " + str(path))
    return path


def chapters():
    for book, first, last in BOOKS:
        for chapter in range(first, last + 1):
            lesson_no = chapter - first + 1
            yield chapter, book, "lesson_%02d" % lesson_no, lesson_no


def section_paths(directory, book, lesson_id, lesson_no, key, kind):
    folder = "%s/%s/%02d_%s/%s" % (directory, book, lesson_no, lesson_id, key)
    return folder + "/%s_%02d_%s_%s.ogg" % (book, lesson_no, key, kind), folder + "/manifest.json"


def write_json(rel, data):
    path = ROOT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def copy(src, rel):
    dest = ROOT / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dest)
    return dest


def bundle_turns(book):
    data = load(ROOT / "data/textbook/canonical_books" / (book + ".bundle.json"))
    turns = {}
    for item in data["items"]:
        lesson = item["lesson"]
        dialogue = (lesson.get("conversation") or {}).get("dialogue") or []
        turns[lesson["global_chapter"]] = dialogue
    return turns


def install_reading(qa, web):
    timings = {row["chapter"]: row for row in load(qa / "chirp3-reading-76-2026-10-05/section-timings.json")}
    rows = []
    for chapter, book, lesson_id, lesson_no in chapters():
        sections = timings.get(chapter, {}).get("sections") or {}
        for code, key in READING_KEYS.items():
            section = sections.get(code)
            if not section or not section.get("ready") or not section.get("new"):
                fail("chapter %d section %s is not ready" % (chapter, code))
            ogg_rel, manifest_rel = section_paths(READING_DIR, book, lesson_id, lesson_no, key, "reading")
            dest = copy(web_file(web, section["new"]), ogg_rel)
            seconds = duration(dest)
            sentences = section.get("sentences") or []
            for sentence in sentences:
                if not 0 <= float(sentence["start_sec"]) < float(sentence["end_sec"]) <= seconds + 0.05:
                    fail("bad reading interval %s" % sentence["id"])
            write_json(
                manifest_rel,
                {
                    "schema": 1,
                    "mode": "section",
                    "voice": "ja-JP-Chirp3-HD-Aoede",
                    "duration_sec": seconds,
                    "source_chapter": chapter,
                    "sentence_intervals": [
                        {
                            "sentence_id": s["id"],
                            "section": code,
                            "text": s["text"],
                            "start_sec": round(float(s["start_sec"]), 3),
                            "end_sec": round(float(s["end_sec"]), 3),
                        }
                        for s in sentences
                    ],
                },
            )
            rows.append(
                {
                    "status": "ok",
                    "book": book,
                    "lesson_id": lesson_id,
                    "lesson_no": lesson_no,
                    "section_key": key,
                    "output": ogg_rel,
                    "manifest": manifest_rel,
                    "model": "ja-JP-Chirp3-HD-Aoede",
                    "duration_sec": seconds,
                    "timing_mode": "section",
                    "ogg_sha256": sha256(dest),
                    "review_status": "user_accepted_sample",
                }
            )
    return rows


def install_dialogue(qa, web):
    lite = {row["chapter"]: row for row in load(qa / "gemini-lite-full-2026-10-05/chapter-timings.json")["chapters"]}
    utterances = {}
    for turn in load(qa / "curriculum-role-voices-2026-10-05/utterance-voice-map.json"):
        utterances.setdefault(turn["chapter"], []).append(turn)
    rows = []
    for book, _, _ in BOOKS:
        rendered = bundle_turns(book)
        for chapter, chapter_book, lesson_id, lesson_no in chapters():
            if chapter_book != book:
                continue
            source = lite.get(chapter)
            if not source or not source.get("ready") or not source.get("new"):
                fail("chapter %d dialogue is not ready" % chapter)
            turns = sorted(utterances.get(chapter, []), key=lambda t: t["turn_index"])
            expected = [t["turn_id"] for t in rendered.get(chapter, [])]
            if [t["turn_id"] for t in turns] != expected:
                fail("chapter %d turns differ from the bundle dialogue" % chapter)
            sentences = {s["id"]: s for s in source["sentences"]}
            ogg_rel, manifest_rel = section_paths(DIALOGUE_DIR, book, lesson_id, lesson_no, "conversation", "dialogue")
            dest = copy(web_file(web, source["new"]), ogg_rel)
            seconds = duration(dest)
            out_turns, intervals, flagged = [], [], 0
            for turn in turns:
                ids = [s["id"] for s in turn["sentences"]]
                parts = [sentences.get(i) for i in ids]
                if not ids or None in parts:
                    fail("chapter %d turn %s lacks sentence timing" % (chapter, turn["turn_id"]))
                flags = sorted({flag for part in parts for flag in part.get("review_flags") or []})
                flagged += bool(flags)
                start = round(min(float(p["start_sec"]) for p in parts), 3)
                end = round(max(float(p["end_sec"]) for p in parts), 3)
                if not 0 <= start < end <= seconds + 0.02:
                    fail("chapter %d turn %s has a bad interval" % (chapter, turn["turn_id"]))
                out_turns.append(
                    {
                        "turn_id": turn["turn_id"],
                        "turn_index": turn["turn_index"],
                        "speaker": turn["casting_group"],
                        "source_text": turn["ja"],
                        "sentence_ids": ids,
                        "voice_id": turn["voice_id"],
                        "status": "candidate",
                        "review_needed": bool(flags),
                        "review_flags": flags,
                        "start_sec": start,
                        "end_sec": end,
                        "duration_sec": round(end - start, 3),
                    }
                )
                for part in parts:
                    intervals.append(
                        {
                            "sentence_id": part["id"],
                            "unit_id": turn["turn_id"],
                            "section": "D",
                            "speaker": part["speaker"],
                            "text": part["text"],
                            "start_sec": round(float(part["start_sec"]), 3),
                            "end_sec": round(float(part["end_sec"]), 3),
                            "review_flags": part.get("review_flags") or [],
                            "replacement": part.get("replacement"),
                        }
                    )
            write_json(
                manifest_rel,
                {
                    "schema": 2,
                    "mode": "absolute",
                    "model": "gemini-3.8-flash-lite-tts",
                    "duration_sec": seconds,
                    "listening_review": "pending",
                    "source_chapter": chapter,
                    "turns": out_turns,
                    "sentence_intervals": intervals,
                },
            )
            rows.append(
                {
                    "status": "ok",
                    "book": book,
                    "lesson_id": lesson_id,
                    "lesson_no": lesson_no,
                    "section_key": "conversation",
                    "output": ogg_rel,
                    "manifest": manifest_rel,
                    "model": "gemini-3.8-flash-lite-tts",
                    "duration_sec": seconds,
                    "timing_mode": "absolute",
                    "ogg_sha256": sha256(dest),
                    "review_status": "pending",
                    "review_flagged_turns": flagged,
                }
            )
    return rows


def install_words(source_root, qa):
    entries = load(qa / "chirp3-missing-2026-10-05/curriculum-word-audio-map.json")
    by_identity = {}
    for entry in entries:
        if entry["group"] == "vocabulary":
            by_identity.setdefault((entry["chapter"], entry["word"], entry["reading"]), set()).add(
                (entry["origin"], entry["audio_path"], entry.get("source_audio_index"))
            )
    words, encoded = {}, {}
    counts = {"legacy": 0, "linked": 0, "supplement": 0}
    first = {book: start for book, start, _ in BOOKS}
    for book, _, _ in BOOKS:
        catalog = load(ROOT / "data/textbook/book_chunks" / (book + ".json"))
        for lesson_id, file in catalog["vocabulary"].items():
            chapter = first[book] + int(lesson_id[-2:]) - 1
            for row in load(ROOT / "data/textbook/book_chunks" / file):
                word = row.get("source_word") or row.get("word")
                matches = by_identity.get((chapter, word, row.get("reading_hiragana")), set())
                if len(matches) != 1:
                    fail("%s/%s %s has %d audio candidates" % (book, lesson_id, word, len(matches)))
                origin, audio_path, legacy_index = next(iter(matches))
                key = "%s/%s/%s" % (book, lesson_id, row["index"])
                if origin == "legacy_aoede":
                    if row.get("vocab_audio_index") == legacy_index:
                        counts["legacy"] += 1
                        continue
                    if row.get("vocab_audio_index") is not None:
                        fail(key + " legacy index differs from the map")
                    folder, counts_key = "legacy", "linked"
                elif origin == "supplement_aoede":
                    folder, counts_key = "audio", "supplement"
                else:
                    fail(key + " has unknown origin " + origin)
                parts = pathlib.PurePosixPath(audio_path).parts[-2:]
                rel = "%s/%s/%s.ogg" % (folder, parts[0], parts[1][: -len(".wav")])
                if rel not in encoded:
                    src = source_root / audio_path
                    if not src.exists():
                        fail("missing word recording " + str(src))
                    dest = ROOT / WORD_DIR / rel
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    web_copy = src.with_suffix(".ogg")
                    if folder == "legacy" and web_copy.exists():
                        shutil.copyfile(web_copy, dest)
                    else:
                        subprocess.run(
                            ["ffmpeg", "-v", "error", "-y", "-i", str(src), "-ac", "1", "-c:a", "libopus", "-b:a", "24k", str(dest)],
                            check=True,
                        )
                    encoded[rel] = sha256(dest)
                words[key] = {"file": rel, "sha256": encoded[rel]}
                counts[counts_key] += 1
    write_json(WORD_DIR + "/words.json", {"schema": 1, "count": len(words), "words": words})
    return counts, len(encoded)


def write_manifest(directory, rows):
    lines = "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)
    (ROOT / directory / "manifest.jsonl").write_text(lines, encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", default=str(ROOT), help="checkout whose local/qa holds the audio")
    source_root = pathlib.Path(parser.parse_args().source_root).resolve()
    qa = source_root / "local/qa"
    web = qa / "curriculum-tts-full-76-2026-10-04/preview"
    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            fail(tool + " is required")
    reading = install_reading(qa, web)
    write_manifest(READING_DIR, reading)
    dialogue = install_dialogue(qa, web)
    write_manifest(DIALOGUE_DIR, dialogue)
    counts, files = install_words(source_root, qa)
    flagged = sum(row["review_flagged_turns"] for row in dialogue)
    print("reading: %d Chirp sections (%.0f min)" % (len(reading), sum(r["duration_sec"] for r in reading) / 60))
    print("dialogue: %d Lite chapters (%.0f min), %d turns carry review flags" % (len(dialogue), sum(r["duration_sec"] for r in dialogue) / 60, flagged))
    print(
        "words: %d rows keep their legacy index, %d legacy rows newly linked, %d rows on supplements; %d files"
        % (counts["legacy"], counts["linked"], counts["supplement"], files)
    )


if __name__ == "__main__":
    main()
