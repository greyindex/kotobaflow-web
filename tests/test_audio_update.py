import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location("audio_update", Path(__file__).resolve().parents[1] / "tools/prepare_gemini_playback.py")
AUDIO = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIO)


class AudioUpdateTest(unittest.TestCase):
    def source(self):
        turns = [{"turn_id": f"t{i + 1:03}", "speaker": "A", "source_text": text, "speech_text": text}
                 for i, text in enumerate(["一", "", "三", "四"])]
        return {"audio_sha256": "audio-a", "turns": turns}

    def alignment(self):
        return {"audio_sha256": "audio-a", "failures": [], "boundaries": [
            {"after_turn": "t001", "before_turn": "t003", "cut_sec": 2},
            {"after_turn": "t003", "before_turn": "t004", "cut_sec": 5}]}

    def timing(self, alignment=None, canonical=None):
        return AUDIO.dialogue_timing(self.source(), alignment or self.alignment(),
                                     canonical or [{"text": t["source_text"]} for t in self.source()["turns"]], 7)

    def test_skipped_direction_keeps_original_indexes_and_absolute_offsets(self):
        rows = self.timing()["turns"]
        self.assertEqual(rows[1]["status"], "not_spoken")
        self.assertEqual((rows[2]["turn_index"], rows[2]["start_sec"], rows[2]["end_sec"]), (2, 2, 5))
        self.assertEqual(rows[3]["end_sec"], 7)

    def test_unresolved_turn_does_not_shift_later_audio(self):
        alignment = self.alignment()
        alignment["failures"] = [{"turn": "t003", "reason": "insufficient_text_anchors"}]
        rows = self.timing(alignment)["turns"]
        self.assertEqual(rows[2]["status"], "unaligned")
        self.assertNotIn("start_sec", rows[2])
        self.assertEqual(rows[3]["start_sec"], 5)

    def test_missing_boundary_never_becomes_zero_duration(self):
        alignment = self.alignment()
        alignment["boundaries"] = alignment["boundaries"][1:]
        rows = self.timing(alignment)["turns"]
        self.assertEqual([r["status"] for r in rows], ["unaligned", "not_spoken", "unaligned", "candidate"])

    def test_changed_audio_and_changed_turn_structure_are_rejected(self):
        alignment = self.alignment()
        alignment["audio_sha256"] = "another-recording"
        with self.assertRaises(ValueError):
            self.timing(alignment)
        with self.assertRaises(ValueError):
            self.timing(canonical=[{"text": "一"}])

    def test_nonmonotone_or_out_of_bounds_timing_is_rejected(self):
        for cut in (-1, 9):
            alignment = self.alignment()
            alignment["boundaries"][0]["cut_sec"] = cut
            with self.assertRaises(ValueError):
                self.timing(alignment)

    def test_text_drift_is_marked_without_rewriting_source(self):
        canonical = [{"text": t["source_text"]} for t in self.source()["turns"]]
        canonical[2]["text"] = "新しい三"
        self.assertEqual([t["source_revision_mismatch"] for t in self.timing(canonical=canonical)["turns"]], [False, False, True, False])

    def test_main_source_id_must_resolve_to_its_actual_audio_index(self):
        row = {"index": 2443, "source_index": 2433, "word": "何より", "audio_relpath": "audio/02xxx/02443.wav"}
        repair = {"scope": "main", "stable_index": 2433, "word": "何より", "active_audio": row["audio_relpath"]}
        self.assertEqual(AUDIO.resolve_repair_row(repair, {(2443,): row})["index"], 2443)
        repair["active_audio"] = "audio/02xxx/02433.wav"
        with self.assertRaises(ValueError):
            AUDIO.resolve_repair_row(repair, {(2443,): row})

    def test_original_audio_backup_is_preserved_and_conflicts_stop(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            source, target, backup = root / "new.ogg", root / "active.ogg", root / "backup"
            source.write_bytes(b"new-audio")
            target.write_bytes(b"old-audio")
            with patch.object(AUDIO, "ROOT", root):
                AUDIO.backup_replace(source, target, backup)
                AUDIO.backup_replace(source, target, backup)
                self.assertEqual((backup / "active.ogg").read_bytes(), b"old-audio")
                target.write_bytes(b"user-changed-audio")
                with self.assertRaises(ValueError):
                    AUDIO.backup_replace(source, target, backup)
                self.assertEqual(target.read_bytes(), b"user-changed-audio")

    def test_reviewed_paragraph_rejects_source_drift_and_changed_audio(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            (root / "new.wav").write_bytes(b"verified-wav")
            (root / "new.ogg").write_bytes(b"verified-ogg")
            row = {"paragraph_no": 1, "text": "国内総生産。", "output": "new.wav",
                   "output_ogg": "new.ogg", "wav_sha256": AUDIO.digest(root / "new.wav"),
                   "ogg_sha256": AUDIO.digest(root / "new.ogg")}
            original = [{"paragraph_no": 1, "text": "国民総生産。", "output": "old.wav"}]
            with patch.object(AUDIO, "ROOT", root):
                result = AUDIO.override_paragraphs(original, [row], "国内総生産。")
                self.assertEqual(result[0]["output"], "new.wav")
                self.assertEqual(original[0]["output"], "old.wav")
                with self.assertRaises(ValueError):
                    AUDIO.override_paragraphs(original, [row], "別の文。")
                (root / "new.ogg").write_bytes(b"unexpected-replacement")
                with self.assertRaises(ValueError):
                    AUDIO.override_paragraphs(original, [row], "国内総生産。")

    def test_vocabulary_spelling_correction_preserves_stable_identity(self):
        row = {"index": 1999, "word": "国民総生産", "textbook_uid": "existing-id",
               "audio_relpath": "audio/01xxx/01999.wav"}
        repair = {"scope": "textbook", "stable_index": 1999, "word": "国内総生産",
                  "before_word": "国民総生産", "textbook_uid": "existing-id", "active_audio": row["audio_relpath"]}
        self.assertIs(AUDIO.resolve_repair_row(repair, {(1999,): row}), row)
        row["textbook_uid"] = "unrelated-word"
        with self.assertRaises(ValueError):
            AUDIO.resolve_repair_row(repair, {(1999,): row})

    def test_failed_replacement_keeps_active_audio_and_removes_only_its_temporary_file(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            source, target = root / "new.ogg", root / "active.ogg"
            source.write_bytes(b"new-audio")
            target.write_bytes(b"old-audio")
            with patch.object(AUDIO, "ROOT", root), patch.object(AUDIO, "replace_ready", side_effect=PermissionError("locked")):
                with self.assertRaises(PermissionError):
                    AUDIO.backup_replace(source, target, root / "backup")
            self.assertEqual(target.read_bytes(), b"old-audio")
            self.assertEqual(source.read_bytes(), b"new-audio")
            self.assertEqual((root / "backup/active.ogg").read_bytes(), b"old-audio")
            self.assertEqual(list(root.glob("*.tmp")), [])


if __name__ == "__main__":
    unittest.main()
