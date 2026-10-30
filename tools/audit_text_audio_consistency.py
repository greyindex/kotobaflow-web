#!/usr/bin/env python3
"""Read-only cross-layer audit. Flags are review leads, never automatic edits."""

import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
import difflib
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import unicodedata

ROOT = Path(__file__).resolve().parent.parent


def read(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def key(value):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", str(value or "")))


def kana(value):
    return "".join(chr(ord(c) - 96) if "ァ" <= c <= "ヶ" else c for c in key(value))


def han(value):
    return set(re.findall(r"[\u4e00-\u9fff]", str(value)))


def vocabularies(node, path=""):
    if isinstance(node, dict):
        for name, value in node.items():
            if name == "vocabulary" and isinstance(value, list):
                for item in value:
                    yield path, item
            else:
                yield from vocabularies(value, path + "/" + name)
    elif isinstance(node, list):
        for i, value in enumerate(node):
            yield from vocabularies(value, path + "/" + str(i))


def historical_json(revision, path):
    body = subprocess.check_output(["git", "show", f"{revision}:{path}"], cwd=ROOT)
    if body.startswith(b"version https://git-lfs.github.com/spec/v1"):
        oid = re.search(rb"oid sha256:([a-f0-9]{64})", body)[1].decode()
        common = subprocess.check_output(["git", "rev-parse", "--git-common-dir"], cwd=ROOT, text=True).strip()
        body = (ROOT / common / "lfs/objects" / oid[:2] / oid[2:4] / oid).read_bytes()
    return read_bytes_json(body)


def read_bytes_json(body):
    return json.loads(body.decode("utf-8-sig"))


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default="local/qa/audio-update-2026-09-28/consistency.json")
    parser.add_argument("--decode-audio", action="store_true")
    parser.add_argument("--preparation", help="Explicit local playback receipt; defaults to the latest closure receipt")
    args = parser.parse_args()
    lessons, vocabulary = {}, defaultdict(list)
    inputs = list(sorted((ROOT / "data/textbook/canonical_books").glob("*.bundle.json")))
    inputs += [ROOT / "data/textbook/textbook_text_chunks.v2.json",
               ROOT / "data/textbook/textbook_text_tokens.v1.json"]
    for path in inputs[:4]:
        for item in read(path)["items"]:
            lesson = item["lesson"]
            identity = lesson["book_id"], lesson["item_id"]
            lessons[identity] = lesson
            for location, word in vocabularies(lesson):
                for surface in {word.get("surface"), word.get("kanji"), word.get("kana")} - {None, ""}:
                    vocabulary[(*identity, key(surface))].append({"path": location, **word})
    chunks, tokens = [read(p)["sentences"] for p in inputs[-2:]]
    token_by_id = {s["id"]: s for s in tokens}
    issues, flags = [], {}

    def flag(kind, sentence, surface, current, originals, extra=None):
        identity = (kind, sentence["book_id"], sentence["lesson_id"], surface,
                    json.dumps(current, ensure_ascii=False, sort_keys=True),
                    json.dumps(originals, ensure_ascii=False, sort_keys=True))
        if identity not in flags:
            flags[identity] = {"kind": kind, "book": sentence["book_id"],
                               "lesson": sentence["lesson_id"], "surface": surface,
                               "current": current, "source_vocabulary": originals,
                               "occurrences": [], "status": "needs_context_review"}
        flags[identity]["occurrences"].append({"sentence_id": sentence["id"], "text": sentence["text"], **(extra or {})})

    for sentence in chunks:
        sid, identity = sentence["id"], (sentence["book_id"], sentence["lesson_id"])
        token_row = token_by_id.get(sid)
        expected = key(sentence["text"])
        section = lessons[identity].get(sentence["section"], {})
        if sentence["role"] == "dialogue_turn":
            source = section["dialogue"][sentence["turn_index"]]["text"]
        else:
            source = section.get("context" if sentence["role"] == "context" else "text", "")
        if expected not in key(source):
            issues.append({"kind": "sentence_vs_canonical", "sentence_id": sid})
        if key("".join(c["surface"] for c in sentence["chunks"])) != expected:
            issues.append({"kind": "chunk_reassembly", "sentence_id": sid})
        if not token_row or key(token_row["text"]) != expected or key("".join(t["surface"] for t in token_row["tokens"])) != expected:
            issues.append({"kind": "token_reassembly", "sentence_id": sid})
        if not token_row:
            continue
        for token in token_row["tokens"]:
            if key(token["surface"]) != key(token["base"]) or token["pos_key"] in {"particle", "auxiliary", "symbol"}:
                continue
            original = vocabulary.get((*identity, key(token["surface"])), [])
            if not original:
                continue
            readings = sorted({kana(w.get("reading") or w.get("kana")) for w in original} - {""})
            if readings and kana(token["reading"]) not in readings:
                flag("token_reading_vs_source", sentence, token["surface"], token["reading"], readings,
                     {"token_index": token["index"]})
        for chunk in sentence["chunks"]:
            surface = key(chunk["surface"])
            original = vocabulary.get((*identity, surface), [])
            if not original:
                # A single ordinary case/topic particle is safe to strip for a review lead.
                trimmed = re.sub(r"[はがをにへとでの]$", "", surface)
                original = vocabulary.get((*identity, trimmed), []) if trimmed != surface else []
            meanings = sorted({w.get("meaning", "") for w in original} - {""})
            current_han = han(chunk.get("meaning_zh", ""))
            if meanings and len(current_han) >= 2 and all(len(han(m)) >= 2 and not current_han.intersection(han(m)) for m in meanings):
                flag("chunk_gloss_vs_source", sentence, surface, chunk["meaning_zh"], meanings,
                     {"matched_source_surfaces": sorted({w.get("surface", "") for w in original})})
    if len(token_by_id) != len(tokens) or len({s["id"] for s in chunks}) != len(chunks):
        issues.append({"kind": "duplicate_sentence_id"})
    if set(token_by_id) != {s["id"] for s in chunks}:
        issues.append({"kind": "sentence_id_set_mismatch"})

    # Original vocabulary may retain a term corrected in the running text.
    source_changes = read(ROOT / "docs/evidence/resource-closure-2026-09-27/source-changes.json")["changes"]
    for change in source_changes:
        for (book, lesson, surface), words in vocabulary.items():
            if (book, lesson) != (change["book"], change["lesson"]) or len(surface) < 2:
                continue
            if surface in key(change["before"]) and surface not in key(change["after"]):
                sentence = {"book_id": book, "lesson_id": lesson, "id": change["sentenceId"], "text": change["after"]}
                flag("revised_source_vs_vocabulary", sentence, surface,
                     {"before": change["before"], "after": change["after"]},
                     sorted({w.get("meaning", "") for w in words}))

    receipt = ROOT / "local/qa/content-closure-2026-09-28/playback/preparation.json"
    if args.preparation:
        receipt = ROOT / args.preparation
    elif not receipt.exists():
        receipt = ROOT / "local/qa/audio-update-2026-09-28/preparation.json"
    preparation = read(receipt)
    for file, expected in preparation.get("source_sha256", {}).items():
        if hashlib.sha256((ROOT / file).read_bytes()).hexdigest() != expected:
            issues.append({"kind": "stale_playback_source", "path": file})
    audio_flags, media = [], []
    for row in preparation["readings"]:
        media.append(ROOT / row["output"].replace(".wav", ".ogg"))
        if row["source_revision_mismatch"]:
            audio_flags.append({"book": row["book"], "lesson": row["lesson_id"], "section": row["section_key"],
                                "kind": "reading_synthesis_text_drift", "output": row["output"],
                                "diff": list(difflib.unified_diff(row["synthesis_text"].splitlines(), row["current_text"].splitlines(), lineterm=""))})
    for row in preparation["dialogues"]:
        media.append(ROOT / row["output"])
        for turn in row["timing"]["turns"]:
            if turn["status"] == "unaligned" or turn["source_revision_mismatch"]:
                audio_flags.append({"book": row["book"], "lesson": row["lesson_id"], "section": "conversation",
                                    "kind": "dialogue_turn_review", "turn_index": turn["turn_index"],
                                    "timing_status": turn["status"], "source_revision_mismatch": turn["source_revision_mismatch"]})
    for row in preparation["word_repairs_applied"]:
        directory = "gcloud_chirp3_vocab12528_female_aoede_v1" if row["scope"] == "main" else "gcloud_chirp3_vocab6127_female_aoede_v1"
        active = ROOT / "data" / directory / row["active_audio"].replace(".wav", ".ogg")
        candidate = (ROOT / row["output"]).with_suffix(".ogg")
        if hashlib.sha256(active.read_bytes()).digest() != hashlib.sha256(candidate.read_bytes()).digest():
            issues.append({"kind": "vocabulary_audio_hash_mismatch", "word": row["word"]})
        media.append(active)
    decoding = []
    if args.decode_audio:
        def decode(path):
            result = subprocess.run(["ffmpeg", "-hide_banner", "-v", "error", "-i", str(path), "-f", "null", "-"], capture_output=True, text=True)
            return {"path": path.relative_to(ROOT).as_posix(), "exit_code": result.returncode,
                    "error": result.stderr.strip()}
        with ThreadPoolExecutor(max_workers=4) as pool:
            decoding = list(pool.map(decode, media))
        issues.extend({"kind": "media_decode_failure", **d} for d in decoding if d["exit_code"] or d["error"])
    rows = sorted(flags.values(), key=lambda f: (f["kind"], f["book"], f["lesson"], f["surface"]))
    for index, row in enumerate(rows, 1):
        row["id"] = f"CONFLICT-{index:04}"
    baseline = "a881ed4"
    historical = {kind: {s["id"]: s for s in historical_json(baseline, path)["sentences"]}
                  for kind, path in (("chunks", "data/textbook/textbook_text_chunks.v2.json"),
                                     ("tokens", "data/textbook/textbook_text_tokens.v1.json"))}
    for row in rows:
        kind = "tokens" if row["kind"] == "token_reading_vs_source" else "chunks"
        field = "reading" if kind == "tokens" else "meaning_zh"
        row["current_value_present_before_review"] = row["kind"] != "revised_source_vs_vocabulary" and all(
            any(key(t["surface"]) == key(row["surface"]) and t.get(field) == row["current"]
                for t in historical[kind].get(o["sentence_id"], {}).get(kind, [])) for o in row["occurrences"])
    output = {"scope": "Canonical/chunk/token structural consistency and source-vocabulary review leads; not a dictionary or complete semantic proof.",
              "comparison_baseline": baseline, "playback_receipt": receipt.relative_to(ROOT).as_posix(),
              "counts": {"lessons": len(lessons), "sentences": len(chunks), "structural_errors": len(issues),
                         "review_flags": len(rows), "flag_types": dict(Counter(r["kind"] for r in rows)),
                         "media_files": len(media), "decoded_files": len(decoding)},
              "input_sha256": {p.relative_to(ROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in inputs},
              "structural_errors": issues, "review_flags": rows, "audio_review_flags": audio_flags, "decoding": decoding}
    destination = ROOT / args.output
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(output["counts"], ensure_ascii=False, indent=2))
    if issues:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
