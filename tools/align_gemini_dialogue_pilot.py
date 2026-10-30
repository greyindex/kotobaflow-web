#!/usr/bin/env python3
"""Experimental Whisper-token alignment of a Gemini dialogue pilot.

Requires pykakasi and ffprobe. Usage:
  python tools/align_gemini_dialogue_pilot.py ASR_JSON [XinBian2 lesson_10]

The JSON produced here is a QA artifact, not an approved playback manifest.
"""

import difflib
import json
import pathlib
import subprocess
import sys
import unicodedata

from pykakasi import kakasi


ROOT = pathlib.Path(__file__).resolve().parent.parent
BOOK = sys.argv[2] if len(sys.argv) > 2 else "XinBian1"
LESSON = sys.argv[3] if len(sys.argv) > 3 else "lesson_02"
if BOOK not in {"XinBian1", "XinBian2", "XinBian3", "XinBian4"} or not (
    LESSON.startswith("lesson_") or LESSON.startswith("review_unit_")
):
    raise ValueError("Invalid book or lesson ID")
PILOT = ROOT / "data/gemini38_flash_tts_dialogue_candidate_v1" / BOOK / LESSON
ASR = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "local/qa/tts-dialogue-pilot-small-dtw.json"
OUT = PILOT / "whisper_alignment_candidate.json"
CONVERTER = kakasi()
DIGITS = dict(zip("0123456789", ("ぜろ", "いち", "に", "さん", "よん", "ご", "ろく", "なな", "はち", "きゅう")))


def phonetic(text):
    normalized = unicodedata.normalize("NFKC", text)
    normalized = "".join(DIGITS.get(char, char) for char in normalized)
    pieces = CONVERTER.convert(normalized)
    hira = "".join(piece["hira"] for piece in pieces)
    return "".join(char for char in hira if "\u3040" <= char <= "\u309f" or "a" <= char.lower() <= "z")


def duration_seconds(wav):
    result = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                             "-of", "default=noprint_wrappers=1:nokey=1", str(wav)],
                            check=True, capture_output=True, text=True)
    return float(result.stdout.strip())


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    source = json.loads((PILOT / "source.json").read_text(encoding="utf-8"))
    # whisper.cpp can emit split UTF-8 bytes in token text; replacement keeps
    # the JSON readable while lowering the corresponding QA similarity score.
    asr = json.loads(ASR.read_text(encoding="utf-8", errors="replace"))
    duration = duration_seconds(PILOT / "whole_conversation.wav")
    expected_parts = [phonetic(turn["text"]) for turn in source["turns"]]
    expected = "".join(expected_parts)
    chars = []
    times = []
    token_indexes = []
    raw_tokens = []
    for segment in asr["transcription"]:
        for token in segment.get("tokens", []):
            if token["text"].startswith("[_"):
                continue
            value = phonetic(token["text"])
            if not value:
                continue
            start = max(0, min(duration, token["offsets"]["from"] / 1000))
            end = max(start, min(duration, token["offsets"]["to"] / 1000))
            token_index = len(raw_tokens)
            raw_tokens.append(token["text"])
            for index, char in enumerate(value):
                chars.append(char)
                times.append((start + (end - start) * index / len(value),
                              start + (end - start) * (index + 1) / len(value)))
                token_indexes.append(token_index)
    observed = "".join(chars)
    matcher = difflib.SequenceMatcher(None, expected, observed, autojunk=False)
    anchors = [(0, 0), (len(expected), len(observed))]
    for i, j, n in matcher.get_matching_blocks():
        anchors.extend((i + index, j + index) for index in range(n + 1))
    anchors = sorted(set(anchors))

    def observed_position(expected_position):
        low, high = 0, len(anchors) - 1
        while low < high:
            mid = (low + high + 1) // 2
            if anchors[mid][0] <= expected_position:
                low = mid
            else:
                high = mid - 1
        left = anchors[low]
        right = anchors[min(low + 1, len(anchors) - 1)]
        if left[0] == right[0]:
            return right[1]
        fraction = (expected_position - left[0]) / (right[0] - left[0])
        return round(left[1] + fraction * (right[1] - left[1]))

    def time_at(position):
        if position <= 0:
            return 0.0
        if position >= len(times):
            return duration
        return max(0, min(duration, (times[position - 1][1] + times[position][0]) / 2))

    rows = []
    offset = 0
    previous_end = 0.0
    for turn, part in zip(source["turns"], expected_parts):
        start_pos = observed_position(offset)
        end_pos = observed_position(offset + len(part))
        start = max(previous_end, time_at(start_pos))
        end = max(start, time_at(end_pos))
        first_token = token_indexes[min(start_pos, len(token_indexes) - 1)]
        last_token = token_indexes[max(0, min(end_pos - 1, len(token_indexes) - 1))]
        transcript_raw = "".join(raw_tokens[first_token:last_token + 1])
        transcript = phonetic(transcript_raw)
        similarity = difflib.SequenceMatcher(None, part, transcript, autojunk=False).ratio()
        rows.append({"turn_id": turn["turn_id"], "speaker": turn["speaker"],
                     "voice_role": turn["voice_role"], "text": turn["text"],
                     "start_sec": round(start, 3), "end_sec": round(end, 3),
                     "duration_sec": round(end - start, 3),
                     "phonetic_similarity": round(similarity, 3),
                     "whisper_text_approx": transcript_raw})
        offset += len(part)
        previous_end = end

    full_asr_text = "".join(segment["text"] for segment in asr["transcription"])
    full_similarity = difflib.SequenceMatcher(None, expected, phonetic(full_asr_text),
                                              autojunk=False).ratio()
    result = {"model": "whisper.cpp", "asr_json": str(ASR), "duration_sec": duration,
              "overall_phonetic_similarity": round(full_similarity, 3),
              "timing_token_similarity": round(matcher.ratio(), 3),
              "turn_count": len(rows), "turns": rows,
              "warning": "Approximate token alignment; review every low-score/repeated turn by ear."}
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Whisper/source phonetic similarity: {full_similarity:.3f}; "
          f"timing-token similarity: {matcher.ratio():.3f}; "
          f"turns: {len(rows)}; audio: {duration:.2f}s")
    for row in rows:
        print(f"{row['turn_id']} {row['start_sec']:5.2f}–{row['end_sec']:5.2f} "
              f"{row['phonetic_similarity']:.2f} {row['speaker']}: {row['text']}")
    print(f"Candidate: {OUT}")


if __name__ == "__main__":
    main()
