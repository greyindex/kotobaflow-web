"""Restore the existing 92 chapter-0 OGG clips without changing course content.

    python -X utf8 tools/install_kotobaflow_kana.py --source-root <checkout with local/qa>

This copies existing recordings only; it never runs TTS or the legacy curriculum
installer. The complete source is checked before writes, then staged and swapped
as a directory. Candidate/listening-review metadata is preserved.
"""

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import tempfile


ROOT = Path(__file__).resolve().parent.parent
KANA_DIR = "data/gemini38_flash_tts_kotobaflow_kana_candidate_v1"
SOURCE_DIR = "local/qa/curriculum-ch00-audio-2026-10-04/audio/ch00"
EXPECTED_IDS = {f"C00-{kind}{number:02}" for kind in "KW" for number in range(1, 47)}


def linked(path):
    return path.is_symlink() or (hasattr(path, "is_junction") and path.is_junction())


def plain_file(path, base):
    for part in [path, *path.parents]:
        if linked(part):
            raise ValueError(f"Linked source path: {path}")
        if part == base:
            break
    if not path.is_file() or not path.resolve().is_relative_to(base.resolve()):
        raise ValueError(f"Missing or unsafe source file: {path}")
    return path


def checked_audio(path, expected_hash):
    body = path.read_bytes()
    if not body.startswith(b"OggS") or hashlib.sha256(body).hexdigest() != expected_hash:
        raise ValueError(f"Invalid OGG or hash mismatch: {path}")


def read_source(source):
    data = json.loads(plain_file(source / "clips.json", source).read_text(encoding="utf-8"))
    if not isinstance(data, dict) or data.get("schema") != 1 or data.get("chapter") != 0:
        raise ValueError("Invalid chapter 0 clip index")
    rows = data.get("clips")
    if not isinstance(rows, list) or len(rows) != 92:
        raise ValueError("Chapter 0 requires exactly 92 clips")
    seen, clips = set(), []
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("Invalid clip row")
        clip_id = row.get("id")
        if not isinstance(clip_id, str) or clip_id not in EXPECTED_IDS or clip_id in seen:
            raise ValueError("Unexpected or duplicate clip identity")
        seen.add(clip_id)
        relative = f"clips/{clip_id}.ogg"
        if row.get("audio_relpath") != relative:
            raise ValueError(f"Unsafe clip path: {clip_id}")
        digest = row.get("audio_sha256")
        seconds = row.get("duration_sec")
        if not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest):
            raise ValueError(f"Missing clip hash: {clip_id}")
        if isinstance(seconds, bool) or not isinstance(seconds, (int, float)) or not math.isfinite(seconds) or seconds <= 0:
            raise ValueError(f"Invalid clip duration: {clip_id}")
        checked_audio(plain_file(source / relative, source), digest)
        clips.append({key: row[key] for key in (
            "id", "kind", "source_text", "spoken_text", "audio_relpath",
            "audio_sha256", "duration_sec", "status", "review_needed",
        ) if key in row})
    return {"schema": 1, "chapter": 0, "model": data.get("model"), "voice": data.get("voice"), "clips": clips}


def install_kana(source, root=ROOT):
    source = Path(source).absolute()
    root = Path(root).resolve(strict=True)
    index = read_source(source)
    data_dir = root / "data"
    target = root / KANA_DIR
    if linked(data_dir) or linked(target) or (target.exists() and not target.is_dir()):
        raise ValueError("Installation requires real data and kana directories")
    data_dir.mkdir(exist_ok=True)
    if data_dir.resolve() != data_dir or target.resolve().parent != data_dir:
        raise ValueError("Installation path escaped the checkout data directory")
    work = Path(tempfile.mkdtemp(prefix=".kana-install-", dir=data_dir))
    # Both rollback and cleanup remain inside this exact, verified temporary directory.
    if work.resolve().parent != data_dir or not work.name.startswith(".kana-install-"):
        raise ValueError("Unsafe temporary installation directory")
    package, previous = work / "package", work / "previous"
    cleanup = True
    try:
        (package / "clips").mkdir(parents=True)
        for row in index["clips"]:
            relative = row["audio_relpath"]
            shutil.copyfile(source / relative, package / relative)
            checked_audio(package / relative, row["audio_sha256"])
        (package / "clips.json").write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        # A user interruption must never let finally delete the only old copy.
        cleanup = False
        try:
            if target.exists():
                os.replace(target, previous)
            os.replace(package, target)
        except BaseException:
            if previous.exists():
                try:
                    os.replace(previous, target)
                except BaseException:
                    raise RuntimeError(f"Restore the previous kana pack from {previous}")
            cleanup = True
            raise
        cleanup = True
    finally:
        if cleanup:
            shutil.rmtree(work)
    return {"clips": len(index["clips"]), "directory": KANA_DIR, "bytes": sum((target / row["audio_relpath"]).stat().st_size for row in index["clips"])}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", default=str(ROOT), help="checkout holding the original chapter-0 recordings in local/qa")
    args = parser.parse_args()
    try:
        result = install_kana(Path(args.source_root).resolve() / SOURCE_DIR)
    except (OSError, ValueError, RuntimeError) as error:
        parser.exit(1, f"install_kotobaflow_kana: {error}\n")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
