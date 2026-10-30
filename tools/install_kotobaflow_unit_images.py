"""Install the KotobaFlow unit theme images for the page-turn reader (EXP-BOOK-01).

    python -X utf8 tools/install_kotobaflow_unit_images.py --from <IMG>

<IMG> is local/qa/curriculum-unit-images-74-2026-10-05: 76 PNG masters (one
per lesson of chapters 01-76) with generation-plan.json. Each master is checked
against the plan's SHA-256, scaled to 1280x720 WebP and written with
images.json to the git-ignored data/kotobaflow_unit_images_v1/. The PNG
masters, prompts and receipts stay in the QA folder; nothing there is changed.
"""

import argparse
import hashlib
import json
import pathlib
import sys

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "data" / "kotobaflow_unit_images_v1"
BOOK_LESSONS = {"KotobaFlow1": 18, "KotobaFlow2": 18, "KotobaFlow3": 20, "KotobaFlow4": 20}
SIZE = (1280, 720)
QUALITY = 82


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--from",
        dest="source",
        default=str(ROOT / "local/qa/curriculum-unit-images-74-2026-10-05"),
    )
    source = pathlib.Path(parser.parse_args().source).resolve()
    plan = json.loads((source / "generation-plan.json").read_text(encoding="utf-8"))
    expected = {(book, "lesson_%02d" % n) for book, count in BOOK_LESSONS.items() for n in range(1, count + 1)}
    seen = set()
    images = {}
    for item in plan:
        book, lesson = item["book_id"], item["lesson_id"]
        if (book, lesson) not in expected or (book, lesson) in seen:
            sys.exit("Unexpected or repeated lesson in plan: %s/%s" % (book, lesson))
        if item["status"] not in ("generated", "reused"):
            sys.exit("Image not ready: %s/%s (%s)" % (book, lesson, item["status"]))
        seen.add((book, lesson))
        master = source / pathlib.PurePosixPath(item["file"]).name
        if sha256(master) != item["sha256"]:
            sys.exit("Master changed since the plan was recorded: " + master.name)
        with Image.open(master) as img:
            webp = img.convert("RGB").resize(SIZE, Image.LANCZOS)
        rel = "%s/%s.webp" % (book, lesson)
        dest = OUT_DIR / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        webp.save(dest, "WEBP", quality=QUALITY, method=6)
        images[book + "/" + lesson] = {
            "file": rel,
            "width": SIZE[0],
            "height": SIZE[1],
            "chapter": item["chapter"],
            "title_zh": item["title_zh"],
            "title_ja": item["title_ja"],
            "master_sha256": item["sha256"],
            "webp_sha256": sha256(dest),
        }
    if seen != expected:
        sys.exit("Plan is missing %d lessons" % len(expected - seen))
    index = {"schema": 1, "source": source.name, "count": len(images), "images": images}
    (OUT_DIR / "images.json").write_text(json.dumps(index, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    total = sum((OUT_DIR / meta["file"]).stat().st_size for meta in images.values())
    print("Installed %d unit images (%.1f MiB WebP) to %s" % (len(images), total / 1048576, OUT_DIR.relative_to(ROOT)))


if __name__ == "__main__":
    main()
