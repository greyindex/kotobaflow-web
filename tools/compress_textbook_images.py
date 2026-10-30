"""Build lossless WebP derivatives; keep canonical PNGs and verify decoded pixels."""
from pathlib import Path
import json
import sys
from PIL import Image

root = Path(__file__).resolve().parent.parent
rows = []
for source in sorted((root / "image").glob("XinBian*/*.png")):
    target = source.with_suffix(".webp")
    with Image.open(source) as original:
        pixels = original.convert("RGBA")
        if "--check" not in sys.argv:
            pixels.save(target, "WEBP", lossless=True, method=6, exact=True)
        with Image.open(target) as encoded:
            assert encoded.convert("RGBA").tobytes() == pixels.tobytes(), source
        rows.append({"source": source.relative_to(root).as_posix(), "output": target.relative_to(root).as_posix(), "sourceBytes": source.stat().st_size, "outputBytes": target.stat().st_size})
report = root / "local/qa/image-compression.json"
report.parent.mkdir(parents=True, exist_ok=True)
if "--check" not in sys.argv:
    report.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"count": len(rows), "sourceBytes": sum(r["sourceBytes"] for r in rows), "outputBytes": sum(r["outputBytes"] for r in rows)}))
