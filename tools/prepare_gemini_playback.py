#!/usr/bin/env python3
"""Prepare local Gemini playback packs; preserve old media and report text drift.

No TTS requests are made. Run --apply after restoring the local candidate packs.
Generated media, manifests, backups and receipts remain Git-ignored.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import unicodedata
import uuid


ROOT = Path(__file__).resolve().parent.parent
READING = "data/gemini38_flash_tts_reading_sections_candidate_v1"
DIALOGUE = "data/gemini38_flash_tts_dialogue_sections_candidate_v1"
QA = ROOT / "local/qa/content-closure-2026-09-28/playback"
ALIGNMENT = ROOT / "local/qa/whisper-gpu-full-srt-2026-09-28"
VERSION = "20260928-content-closure-2"
OVERRIDES = "data/gemini38_flash_tts_content_closure_candidate_v1/playback-overrides.json"


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path, value):
    write_text_atomic(path, json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def replace_ready(temporary, destination):
    for attempt in range(5):
        try:
            temporary.replace(destination)
            return
        except PermissionError:
            if attempt == 4:
                raise
            time.sleep(0.1)


def write_text_atomic(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        temporary.write_text(text, encoding="utf-8")
        replace_ready(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def text_key(text):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", str(text or "")))


def latest_rows(path, fields):
    result = {}
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if row.get("status") == "ok":
            result[tuple(row[field] for field in fields)] = row
    return result


def local_path(value):
    path = (ROOT / value).resolve()
    if not path.is_relative_to(ROOT) or path.is_symlink():
        raise ValueError(f"Invalid local media path: {value}")
    return path


def verified_media(row, field, hash_field):
    path = local_path(row[field])
    if digest(path) != row[hash_field]:
        raise ValueError(f"Reviewed audio changed: {row[field]}")
    return path


def load_overrides():
    overrides = read_json(ROOT / OVERRIDES)
    if overrides.get("version") != VERSION:
        raise ValueError("Audio override version does not match the playback version")
    for file, expected in overrides["source_sha256"].items():
        if digest(local_path(file)) != expected:
            raise ValueError(f"Canonical text changed since audio review: {file}")
    return overrides


def override_paragraphs(paragraphs, replacements, current):
    result = [dict(row) for row in paragraphs]
    parts = [p for p in re.split(r"\n\s*\n", current) if p.strip()]
    if len(parts) != len(result):
        raise ValueError("Paragraph structure changed since generation")
    seen = set()
    for row in replacements:
        index = row["paragraph_no"] - 1
        if index in seen or not 0 <= index < len(parts) or text_key(row["text"]) != text_key(parts[index]):
            raise ValueError("Paragraph override does not match current source")
        seen.add(index)
        verified_media(row, "output", "wav_sha256")
        verified_media(row, "output_ogg", "ogg_sha256")
        result[index].update(row)
    return result


def duration(path):
    return float(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(path)], text=True).strip())


def dialogue_timing(source, alignment, canonical_turns, audio_duration):
    turns = source["turns"]
    if len(turns) != len(canonical_turns):
        raise ValueError("Source turn count differs from the current lesson")
    if alignment["audio_sha256"] != source["audio_sha256"]:
        raise ValueError("Alignment belongs to another audio file")
    starts, ends, rejected = {}, {}, set()
    for failure in alignment.get("failures", []):
        if failure.get("turn"):
            rejected.add(failure["turn"])
    spoken = [t for t in turns if t.get("speech_text", "").strip()]
    if spoken:
        starts[spoken[0]["turn_id"]] = 0.0
        ends[spoken[-1]["turn_id"]] = audio_duration
    for boundary in alignment.get("boundaries", []):
        ends[boundary["after_turn"]] = boundary["cut_sec"]
        starts[boundary["before_turn"]] = boundary["cut_sec"]
    result, previous_end = [], 0.0
    for index, (turn, current) in enumerate(zip(turns, canonical_turns)):
        expected_id = f"t{index + 1:03}"
        if turn["turn_id"] != expected_id:
            raise ValueError("Source turn IDs are not sequential")
        row = {"turn_id": expected_id, "turn_index": index, "speaker": turn["speaker"],
               "source_revision_mismatch": text_key(turn["source_text"]) != text_key(current.get("text", ""))}
        start, end = starts.get(expected_id), ends.get(expected_id)
        if not turn.get("speech_text", "").strip():
            row["status"] = "not_spoken"
        elif expected_id in rejected or start is None or end is None:
            row["status"] = "unaligned"
        else:
            if not 0 <= start < end <= audio_duration + 0.02 or start < previous_end - 0.001:
                raise ValueError(f"Invalid absolute interval for {expected_id}")
            row.update(status="candidate", start_sec=round(start, 3), end_sec=round(end, 3),
                       duration_sec=round(end - start, 3))
            previous_end = end
        result.append(row)
    return {"schema": 2, "mode": "absolute", "duration_sec": audio_duration,
            "listening_review": "pending", "turns": result}


def backup_replace(source, destination, backup_root):
    """Idempotent replacement; an existing backup never gets overwritten."""
    source, destination = source.resolve(), destination.resolve()
    if not destination.is_relative_to(ROOT):
        raise ValueError("Replacement must stay inside the project")
    backup = backup_root / destination.relative_to(ROOT)
    if destination.exists() and digest(source) == digest(destination):
        return
    if destination.exists():
        if backup.exists() and digest(backup) != digest(destination):
            raise ValueError(f"Active audio changed since backup: {destination}")
        if not backup.exists():
            backup.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(destination, backup)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f".{destination.name}.{uuid.uuid4().hex}.tmp")
    try:
        shutil.copy2(source, temporary)
        replace_ready(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


def resolve_repair_row(repair, rows):
    relative = repair["active_audio"]
    if not re.fullmatch(r"audio/\d{2}xxx/\d{5}\.wav", relative):
        raise ValueError("Unexpected vocabulary repair target")
    audio_index = int(Path(relative).stem)
    row = rows.get((audio_index,))
    # Main source_index and runtime index diverge after split vocabulary entries.
    identity = row.get("source_index") if row and repair["scope"] == "main" else audio_index
    allowed_words = {repair["word"], repair.get("before_word", repair["word"])}
    if (not row or identity != repair["stable_index"] or row["word"] not in allowed_words
            or row["audio_relpath"] != relative
            or (repair.get("textbook_uid") and row.get("textbook_uid") != repair["textbook_uid"])):
        raise ValueError("Vocabulary source identity does not match its playback file")
    return row


def plan():
    overrides = load_overrides()
    lessons = {}
    for book in sorted((ROOT / "data/textbook/canonical_books").glob("*.bundle.json")):
        for item in read_json(book)["items"]:
            lesson = item["lesson"]
            lessons[(lesson["book_id"], lesson["item_id"])] = lesson
    old_reading = latest_rows(ROOT / "data/qwen_reading_sections_manual_clean132_context_punctpause_v1/manifest.jsonl",
                              ("book", "lesson_id", "section_key"))
    old_dialogue = latest_rows(ROOT / "data/gcloud_chirp3_dialogue_sections_v1/manifest.jsonl",
                               ("book", "lesson_id", "section_key"))
    readings = []
    for directory, section in (("data/gemini38_flash_tts_body_v1", "body"),
                               ("data/gemini38_flash_tts_application_candidate_v1", "application")):
        grouped = {}
        for key, row in latest_rows(ROOT / directory / "manifest.jsonl", ("book", "lesson_id", "paragraph_no")).items():
            grouped.setdefault(key[:2], []).append(row)
        for key, paragraphs in sorted(grouped.items()):
            paragraphs.sort(key=lambda row: row["paragraph_no"])
            if [r["paragraph_no"] for r in paragraphs] != list(range(1, len(paragraphs) + 1)):
                raise ValueError(f"Missing paragraph in {key}")
            for row in paragraphs:
                if not local_path(row["output"]).is_file():
                    raise FileNotFoundError(row["output"])
            current = lessons[key][section]["text"]
            replacements = overrides["readings"].get("/".join((*key, section)), [])
            paragraphs = override_paragraphs(paragraphs, replacements, current)
            original = "\n\n".join(row["text"] for row in paragraphs)
            synthesis = "\n\n".join(row.get("synthesis_text", row.get("spoken_text", row.get("original_synthesis_text", row["text"]))) for row in paragraphs)
            legacy = old_reading[(*key, section)]
            label = f"{int(legacy['lesson_no']):02}"
            relative = f"{READING}/{key[0]}/{label}_{key[1]}/{section}/{key[0]}_{label}_{section}_reading"
            readings.append({"status": "ok", "book": key[0], "lesson_id": key[1],
                             "lesson_no": legacy["lesson_no"], "section_key": section,
                             "output": relative + ".wav", "paragraphs": paragraphs,
                             "provider": "google-gemini", "models": sorted({p.get("model", p.get("model_id", "")) for p in paragraphs}),
                             "voices": sorted({p.get("voice_name", "") for p in paragraphs}),
                             "source_revision_mismatch": text_key(original) != text_key(current),
                             "synthesis_text": synthesis, "reviewed_source_text": original, "current_text": current})
    dialogues = []
    for source_file in sorted((ROOT / "data/gemini38_flash_tts_dialogue_full_candidate_v1").glob("XinBian*/*/source.json")):
        source = read_json(source_file)
        key = (source["book"], source["lesson_id"])
        audio = source_file.parent / "whole_conversation.wav"
        ogg = source_file.parent / "whole_conversation.ogg"
        replacement = overrides["dialogues"].get("/".join(key))
        if replacement:
            source_file = local_path(replacement["source"])
            source = read_json(source_file)
            audio = verified_media(replacement, "output", "wav_sha256")
            ogg = verified_media(replacement, "output_ogg", "ogg_sha256")
            alignment_file = local_path(replacement["alignment"])
            if digest(alignment_file) != replacement["alignment_sha256"]:
                raise ValueError("Reviewed dialogue alignment changed")
        else:
            alignment_file = ALIGNMENT / "source-turns" / key[0] / key[1] / "alignment.json"
        alignment = read_json(alignment_file)
        if digest(source_file) != alignment["source_file_sha256"]:
            raise ValueError(f"Alignment source changed for {key}")
        source["audio_sha256"] = digest(audio)
        timing = dialogue_timing(source, alignment, lessons[key]["conversation"]["dialogue"], duration(audio))
        label = f"{int(old_dialogue[(*key, 'conversation')]['lesson_no']):02}"
        folder = f"{DIALOGUE}/{key[0]}/{label}_{key[1]}/conversation"
        dialogues.append({"status": "ok", "book": key[0], "lesson_id": key[1],
                          "lesson_no": int(label), "section_key": "conversation",
                          "output": f"{folder}/{key[0]}_{label}_conversation_dialogue.ogg",
                          "manifest": f"{folder}/manifest.json", "turn_gap_sec": 0,
                          "provider": "google-gemini", "model": "gemini-3.8-flash-tts",
                          "total_duration_sec": timing["duration_sec"],
                          "source_revision_mismatch": any(t["source_revision_mismatch"] for t in timing["turns"]),
                          "source_snapshot": source_file.relative_to(ROOT).as_posix(),
                          "source_ogg": str(ogg), "source_wav": str(audio), "timing": timing})
    repairs = list(latest_rows(ROOT / "data/gemini38_flash_tts_vocab_repairs_candidate_v1/manifest.jsonl", ("key",)).values())
    if (len(readings), len(dialogues), len(repairs)) != (146, 75, 20):
        raise ValueError("Candidate coverage is incomplete")
    for repair in overrides["words"]:
        verified_media(repair, "output", "wav_sha256")
        verified_media(repair, "output_ogg", "ogg_sha256")
        repairs.append(repair)
    if any(r["source_revision_mismatch"] for r in readings + dialogues):
        raise ValueError("Unresolved text/audio revision mismatch in closure pack")
    if any(t["status"] == "unaligned" for d in dialogues for t in d["timing"]["turns"]):
        raise ValueError("Closure pack still has unaligned spoken turns")
    return readings, dialogues, repairs


def assemble_reading(row):
    target = ROOT / row["output"]
    target.parent.mkdir(parents=True, exist_ok=True)
    inputs = [local_path(p["output"]) for p in row["paragraphs"]]
    hashes = [digest(p) for p in inputs]
    receipt_path = target.with_suffix(".receipt.json")
    if receipt_path.exists() and target.exists() and target.with_suffix(".ogg").exists():
        receipt = read_json(receipt_path)
        if receipt.get("input_sha256") == hashes and receipt["ogg_sha256"] == digest(target.with_suffix(".ogg")):
            return {**row, "duration_sec": receipt["duration_sec"], "paragraph_timing": receipt["paragraph_timing"]}
    for existing in (receipt_path,):
        if existing.exists():
            backup = QA / "backup" / existing.relative_to(ROOT)
            if backup.exists() and digest(backup) != digest(existing):
                raise ValueError(f"Reading audio changed after backup: {existing}")
            if not backup.exists():
                backup.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(existing, backup)
    concat = QA / "concat" / f"{row['book']}-{row['lesson_id']}-{row['section_key']}.txt"
    concat.parent.mkdir(parents=True, exist_ok=True)
    concat.write_text("\n".join("file '" + p.as_posix().replace("'", "'\\''") + "'" for p in inputs) + "\n", encoding="utf-8")
    staged = concat.with_suffix(".wav")
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0",
                    "-i", str(concat), "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", "-map_metadata", "-1", str(staged)], check=True)
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(staged), "-ar", "24000", "-ac", "1",
                    "-c:a", "libopus", "-b:a", "20k", "-vbr", "on", "-application", "voip", "-frame_duration", "60",
                    "-map_metadata", "-1", str(staged.with_suffix(".ogg"))], check=True)
    seconds, cursor, paragraphs = duration(staged), 0.0, []
    for index, item in enumerate(inputs, 1):
        end = cursor + duration(item)
        paragraphs.append({"paragraph_no": index, "start_sec": round(cursor, 3), "end_sec": round(end, 3)})
        cursor = end
    if abs(seconds - cursor) > 0.1:
        raise ValueError(f"Concatenation duration mismatch: {target}")
    for suffix in (".wav", ".ogg"):
        backup_replace(staged.with_suffix(suffix), target.with_suffix(suffix), QA / "backup")
    write_json(receipt_path, {"input_sha256": hashes, "ogg_sha256": digest(target.with_suffix(".ogg")),
                              "duration_sec": seconds, "paragraph_timing": paragraphs})
    return {**row, "duration_sec": seconds, "paragraph_timing": paragraphs}


def apply_word_repairs(repairs):
    for scope, directory in (("main", "data/gcloud_chirp3_vocab12528_female_aoede_v1"),
                              ("textbook", "data/gcloud_chirp3_vocab6127_female_aoede_v1")):
        manifest = ROOT / directory / "manifest.jsonl"
        backup = QA / "backup" / directory / "manifest.jsonl"
        if not backup.exists():
            backup.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(manifest, backup)
        rows = latest_rows(manifest, ("index",))
        additions = []
        for repair in repairs:
            if repair["scope"] != scope:
                continue
            relative = repair["active_audio"]
            active = resolve_repair_row(repair, rows)
            target = ROOT / directory / relative
            source = local_path(repair["output"])
            for suffix in (".wav", ".ogg"):
                backup_replace(source.with_suffix(suffix), target.with_suffix(suffix), QA / "backup")
            updated = {**active, "word": repair["word"], "reading_hiragana": repair["corrected_reading"],
                       "synthesis_text": repair["corrected_reading"], "tts_input_text": repair["synthesis_text"],
                       "provider": "google-gemini", "model": repair["model"], "voice_name": repair["voice_name"],
                       "duration_sec": duration(target), "sha1": hashlib.sha1(target.read_bytes()).hexdigest(),
                       "audio_bytes": target.stat().st_size, "audio_update_version": VERSION}
            updated["sample_rate"] = 24000
            updated["frames"] = round(updated["duration_sec"] * 24000)
            if updated != active:
                additions.append(updated)
        if additions:
            text = manifest.read_text(encoding="utf-8")
            if not text.endswith("\n"):
                text += "\n"
            write_text_atomic(manifest, text + "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in additions))


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    readings, dialogues, repairs = plan()
    summary = {"version": VERSION, "source_sha256": load_overrides()["source_sha256"],
               "reading_sections": len(readings), "dialogue_sections": len(dialogues),
               "word_repairs": len(repairs), "reading_text_drift": sum(r["source_revision_mismatch"] for r in readings),
               "dialogue_text_drift": sum(r["source_revision_mismatch"] for r in dialogues),
               "dialogue_timing_status": dict(__import__("collections").Counter(t["status"] for d in dialogues for t in d["timing"]["turns"]))}
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)
    if not args.apply:
        return
    QA.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=4) as pool:
        readings = list(pool.map(assemble_reading, readings))
    for row in dialogues:
        target = ROOT / row["output"]
        target.parent.mkdir(parents=True, exist_ok=True)
        backup_replace(Path(row["source_ogg"]), target, QA / "backup")
        backup_replace(Path(row["source_wav"]), target.with_suffix(".wav"), QA / "backup")
        write_json(ROOT / row["manifest"], row["timing"])
    for directory, rows, private in ((READING, readings, {"paragraphs", "current_text"}),
                                      (DIALOGUE, dialogues, {"source_ogg", "source_wav", "timing"})):
        write_text_atomic(ROOT / directory / "manifest.jsonl", "".join(
            json.dumps({k: v for k, v in row.items() if k not in private}, ensure_ascii=False) + "\n" for row in rows))
    apply_word_repairs(repairs)
    write_json(QA / "preparation.json", {**summary, "readings": readings,
                                         "dialogues": dialogues, "word_repairs_applied": repairs})
    print(f"Prepared local playback packs; receipt and backups: {QA}")


if __name__ == "__main__":
    main()
