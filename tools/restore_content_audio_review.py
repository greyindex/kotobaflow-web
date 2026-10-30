#!/usr/bin/env python3
"""Restore frozen review metadata after restoring the ignored local audio packs.

Does not request TTS or change active playback media. Existing differing review
files are never overwritten; source and candidate hashes must match first.
"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "docs/evidence/content-closure-2026-09-28"
OVERRIDES = ROOT / "data/gemini38_flash_tts_content_closure_candidate_v1/playback-overrides.json"


def local(value):
    path = (ROOT / value).resolve()
    if not path.is_relative_to(ROOT):
        raise ValueError(f"Review path escapes the repository: {value}")
    return path


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def main():
    overrides = json.loads((EVIDENCE / "playback-override-plan.json").read_text("utf-8"))
    alignments = json.loads((EVIDENCE / "reviewed-dialogue-alignments.json").read_text("utf-8"))
    for file, expected in overrides["source_sha256"].items():
        if hashlib.sha256(local(file).read_bytes()).hexdigest() != expected:
            raise ValueError(f"Reviewed source changed: {file}")
    rows = [r for paragraphs in overrides["readings"].values() for r in paragraphs]
    rows += list(overrides["dialogues"].values()) + overrides["words"]
    for row in rows:
        for field, digest in (("output", "wav_sha256"), ("output_ogg", "ogg_sha256")):
            if hashlib.sha256(local(row[field]).read_bytes()).hexdigest() != row[digest]:
                raise ValueError(f"Candidate audio changed: {row[field]}")
    writes = {OVERRIDES: encoded(overrides)}
    for key, row in overrides["dialogues"].items():
        body = encoded(alignments[key])
        if hashlib.sha256(body).hexdigest() != row["alignment_sha256"]:
            body = body.replace(b"\n", b"\r\n")
        if hashlib.sha256(body).hexdigest() != row["alignment_sha256"]:
            raise ValueError(f"Saved alignment changed: {key}")
        writes[local(row["alignment"])] = body
    for path, body in writes.items():
        if path.exists() and path.read_bytes() != body:
            if path == OVERRIDES and json.loads(path.read_text("utf-8")) == overrides:
                continue
            raise ValueError(f"Keep the existing review before restoring: {path}")
    restored = 0
    for path, body in writes.items():
        if path.exists():
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("xb") as stream:
            stream.write(body)
        restored += 1
    print(f"Verified {len(rows)} candidate entries; restored {restored} review files")


if __name__ == "__main__":
    main()
