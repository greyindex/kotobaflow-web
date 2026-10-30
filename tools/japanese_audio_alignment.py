#!/usr/bin/env python3
"""Japanese source-turn alignment with traceable Whisper DTW and pause evidence.

Ported from the locally verified GPU subtitle workflow. Outputs are candidates;
ASR verification never implies a human listening sign-off.
"""
import collections
from collections import Counter
import difflib
import hashlib
import json
from pathlib import Path
import re
import subprocess
import unicodedata
from pykakasi import kakasi

CONVERTER = kakasi()
DIGITS = dict(zip("0123456789", ("ぜろ", "いち", "に", "さん", "よん", "ご", "ろく", "なな", "はち", "きゅう")))


def readings(text, origins, aliases):
    normalized, mapping = [], []
    for char, origin in zip(text, origins):
        chars = "".join(" " if c.isspace() else c for c in unicodedata.normalize("NFKC", char))
        normalized.extend(chars)
        mapping.extend([origin] * len(chars))
    text = "".join(normalized)
    for old, new in {**aliases, **DIGITS}.items():
        if not old or not new:
            raise ValueError("Reading aliases must have nonempty keys and values")
        result, indexes, offset = [], [], 0
        while True:
            start = text.find(old, offset)
            if start < 0:
                result.append(text[offset:])
                indexes.extend(mapping[offset:])
                break
            result.extend((text[offset:start], new))
            indexes.extend(mapping[offset:start])
            indexes.extend(mapping[start + min(len(old) - 1, i * len(old) // len(new))]
                           for i in range(len(new)))
            offset = start + len(old)
        text, mapping = "".join(result), indexes
    result, indexes, offset = [], [], 0

    def append_reading(original, hira, start):
        for i, char in enumerate(hira):
            # Keep unknown ideographs as unmatched text instead of silently dropping them.
            if char.isalpha() or "\u3040" <= char <= "\u309f":
                result.append(char.lower())
                indexes.append(mapping[start + min(len(original) - 1, i * len(original) // len(hira))])

    def append_gap(start, end):
        # pykakasi can skip the character following an unknown ideograph. Recover
        # that original span character by character, retaining its token ownership.
        for position in range(start, end):
            char = text[position]
            hira = "".join(p["hira"] for p in CONVERTER.convert(char))
            append_reading(char, hira or char, position)

    for piece in CONVERTER.convert(text):
        original, hira = piece["orig"], piece["hira"]
        start = text.find(original, offset)
        if start < 0:
            raise ValueError("Reading converter returned a span not present in the input")
        append_gap(offset, start)
        append_reading(original, hira, start)
        offset = start + len(original)
    append_gap(offset, len(text))
    return "".join(result), indexes


def timestamp(seconds, separator=","):
    total = round(seconds * 1000)
    hours, total = divmod(total, 3600000)
    minutes, total = divmod(total, 60000)
    sec, millis = divmod(total, 1000)
    return f"{hours:02}:{minutes:02}:{sec:02}{separator}{millis:03}"


# Reading normalization only; these aliases never rewrite source or ASR text.
ALIASES = {"李": "り", "あの人": "あのひと", "お入り": "おはいり", "1階": "いっかい",
           "一階": "いっかい", "1人": "ひとり", "2人": "ふたり",
           "えぇ": "ええ", "はぁ": "はあ", "あぁ": "ああ", "うぅ": "うう",
           "へぇ": "へえ", "へー": "へえ"}
# Known character-form differences in the frozen synthesis inputs. Apply only
# while comparing readings; original source strings and subtitles stay traceable.
ALIASES.update(dict(zip("类书组话寻记录见费减现训练场间职业爱贤乐惊调处买败鹤种卖识伟纺绩术",
                        "類書組話尋記録見費減現訓練場間職業愛賢楽驚調処買敗鶴種売識偉紡績術")))
for digit, kanji, reading in zip("123456789", "一二三四五六七八九", (
        "ひとつ", "ふたつ", "みっつ", "よっつ", "いつつ", "むっつ", "ななつ", "やっつ", "ここのつ")):
    ALIASES[digit + "つ"] = reading
    ALIASES[kanji + "つ"] = reading


def japanese_integer(value):
    if value == 0:
        return "零"
    digits = "一二三四五六七八九"
    groups, group_index = [], 0
    while value:
        value, group = divmod(value, 10000)
        part = ""
        for power, unit in ((3, "千"), (2, "百"), (1, "十"), (0, "")):
            number, group = divmod(group, 10 ** power)
            if number:
                part += ("" if number == 1 and power else digits[number - 1]) + unit
        if part:
            groups.append(part + ("", "万", "億")[group_index])
        group_index += 1
    return "".join(reversed(groups))


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def alignment(item, destination):
    source_path = Path(item["source"])
    run_dir = Path(item["run_dir"])
    asr_path, audio_path = run_dir / "asr.json", run_dir / "audio-16k.wav"
    source = json.loads(source_path.read_text(encoding="utf-8"))
    asr = json.loads(asr_path.read_text(encoding="utf-8", errors="replace"))
    turns = [t for t in source["turns"] if t.get("speech_text", "").strip()]
    tokens = [t for s in asr["transcription"] for t in s["tokens"] if not t["text"].startswith("[_")]
    text = "".join(t["text"] for t in tokens)
    aliases = dict(ALIASES)
    combined = text + " " + " ".join(t["speech_text"] for t in turns)
    for number in re.findall(r"(?<![0-9])[1-9][0-9]{1,7}(?![0-9])", combined):
        aliases[number] = japanese_integer(int(number))
    if any("楊" in t["speaker"] for t in turns):
        aliases.update({"洋です": "ようです", "洋さん": "ようさん"})
    # Longer counters/numbers must be normalized before their shorter prefixes.
    aliases = dict(sorted(aliases.items(), key=lambda item: -len(item[0])))
    observed, origins = readings(text, [i for i, t in enumerate(tokens) for _ in t["text"]], aliases)
    parts = [readings(t["speech_text"], [0] * len(t["speech_text"]), aliases)[0] for t in turns]
    expected = "".join(parts)
    matcher = difflib.SequenceMatcher(None, expected, observed, autojunk=False)
    mapping = {}
    for block in matcher.get_matching_blocks():
        mapping.update((block.a + i, block.b + i) for i in range(block.size))
    duration = item["audio_duration_sec"]
    notes, failures, spans = [], [], []
    offset = 0
    for turn, part in zip(turns, parts):
        matched = [(i, mapping[i]) for i in range(offset, offset + len(part)) if i in mapping]
        coverage = len(matched) / max(1, len(part))
        span = {"turn_id": turn["turn_id"], "source_start": offset, "source_end": offset + len(part),
                "matched_reading_fraction": round(coverage, 4), "matched": matched}
        if not matched or coverage < 0.55:
            failures.append({"turn": turn["turn_id"], "reason": "insufficient_text_anchors", "coverage": round(coverage, 4)})
        elif coverage < 0.9:
            notes.append({"turn": turn["turn_id"], "reason": "reading_difference", "coverage": round(coverage, 4)})
        spans.append(span)
        offset += len(part)
    differences = [{"kind": tag, "source_range": [a, b], "asr_range": [c, d],
                    "source_reading": expected[a:b], "asr_reading": observed[c:d],
                    "source_context": expected[max(0, a - 12):b + 12],
                    "asr_context": observed[max(0, c - 12):d + 12]}
                   for tag, a, b, c, d in matcher.get_opcodes() if tag != "equal"]
    detection = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(audio_path),
                                "-af", "silencedetect=noise=-35dB:d=0.04", "-f", "null", "-"],
                               check=True, capture_output=True, encoding="utf-8", errors="replace")
    pauses, start = [], None
    for kind, value in re.findall(r"silence_(start|end): ([\d.]+)", detection.stderr):
        if kind == "start":
            start = float(value)
        elif start is not None:
            end = float(value)
            if pauses and start - pauses[-1][1] <= 0.02:
                pauses[-1][1] = end
            else:
                pauses.append([start, end])
            start = None
    cuts, boundaries = [0.0], []
    for left_span, right_span in zip(spans, spans[1:]):
        boundary = {"after_turn": left_span["turn_id"], "before_turn": right_span["turn_id"]}
        if not left_span["matched"] or not right_span["matched"]:
            failures.append({**boundary, "reason": "missing_boundary_text_anchor"})
            continue
        left_source, left_observed = left_span["matched"][-1]
        right_source, right_observed = right_span["matched"][0]
        left_gap = left_span["source_end"] - 1 - left_source
        right_gap = right_source - right_span["source_start"]
        left_index, right_index = origins[left_observed], origins[right_observed]
        if left_gap > 8 or right_gap > 8 or left_index >= right_index:
            failures.append({**boundary, "reason": "boundary_text_anchor_too_far_or_shared_token",
                             "left_gap": left_gap, "right_gap": right_gap})
            continue
        left, right = tokens[left_index], tokens[right_index]
        left_time, right_time = left["t_dtw"] / 100, right["t_dtw"] / 100
        if not 0 <= left_time <= right_time <= duration or right_time - left_time > 3:
            failures.append({**boundary, "reason": "invalid_or_distant_dtw_anchors",
                             "left_sec": left_time, "right_sec": right_time})
            continue
        seed = (left_time + right_time) / 2
        candidates = [p for p in pauses if p[1] - p[0] >= 0.07
                      and left_time - 0.35 <= sum(p) / 2 <= right_time
                      and abs(sum(p) / 2 - seed) <= 0.65]
        if not candidates:
            failures.append({**boundary, "reason": "no_nearby_pause", "dtw_seed_sec": round(seed, 3)})
            continue
        pause = min(candidates, key=lambda p: abs(sum(p) / 2 - seed))
        cut = round(sum(pause) / 2, 3)
        if not cuts[-1] < cut < duration:
            failures.append({**boundary, "reason": "non_monotone_cut", "cut_sec": cut})
            continue
        if left_gap or right_gap or abs(cut - seed) > 0.35:
            notes.append({**boundary, "reason": "boundary_needs_review", "left_text_gap": left_gap,
                          "right_text_gap": right_gap, "pause_shift_sec": round(cut - seed, 3)})
        cuts.append(cut)
        boundaries.append({**boundary, "cut_sec": cut, "pause_sec": pause, "dtw_seed_sec": round(seed, 3),
                           "left_token": left["text"], "right_token": right["text"],
                           "left_dtw_sec": left_time, "right_dtw_sec": right_time})
    cuts.append(duration)
    if len(cuts) != len(turns) + 1:
        failures.append({"reason": "not_all_source_boundaries_resolved"})
    destination.mkdir(parents=True, exist_ok=True)
    result = {"status": "needs_manual_alignment" if failures else "candidate", "key": item["key"],
              "source_file_sha256": digest(source_path), "asr_sha256": digest(asr_path),
              "audio_sha256": item["audio_sha256"], "duration_sec": duration,
              "source_turn_count": len(source["turns"]), "audible_turn_count": len(turns),
              "normalized_reading_similarity": round(matcher.ratio(), 4), "reading_aliases": aliases,
              "differences": differences, "review_notes": notes, "failures": failures,
              "coverage": [{k: v for k, v in s.items() if k != "matched"} for s in spans],
              "boundaries": boundaries, "listening_review": "pending",
              "speaker_origin": "source.json; not automatic speaker diarization",
              "method": "Monotone reading matches + Whisper DTW anchors + nearby pause midpoint"}
    if not failures:
        rows, srt = [], []
        repetitions = Counter(parts)
        for index, (turn, span, part) in enumerate(zip(turns, spans, parts)):
            row = {"turn_id": turn["turn_id"], "speaker": turn["speaker"], "text": turn["speech_text"],
                   "start_sec": cuts[index], "end_sec": cuts[index + 1],
                   "matched_reading_fraction": span["matched_reading_fraction"],
                   "repeated_text": repetitions[part] > 1, "listening_review": "pending"}
            rows.append(row)
            srt.append(f"{index + 1}\n{timestamp(cuts[index])} --> {timestamp(cuts[index + 1])}\n"
                       f"{turn['speaker']}：{turn['speech_text']}\n")
        result["turns"] = rows
        srt_path = destination / "turns.srt"
        srt_path.write_text("\n".join(srt), encoding="utf-8")
        result["srt"] = str(srt_path.resolve())
        result["srt_sha256"] = digest(srt_path)
    save(destination / "alignment.json", result)
    return {"key": item["key"], "status": result["status"], "audible_turns": len(turns),
            "similarity": result["normalized_reading_similarity"], "review_notes": len(notes),
            "differences": len(differences), "failures": len(failures),
            "alignment": str((destination / "alignment.json").resolve()), "srt": result.get("srt")}
