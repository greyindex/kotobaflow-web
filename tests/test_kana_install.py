import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location("kana_install", Path(__file__).resolve().parents[1] / "tools/install_kotobaflow_kana.py")
KANA = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(KANA)


class KanaInstallTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "source"
        self.destination = self.root / "checkout"
        self.source.mkdir()
        self.destination.mkdir()
        (self.source / "clips").mkdir()
        self.rows = []
        for kind in "KW":
            for number in range(1, 47):
                clip_id = f"C00-{kind}{number:02}"
                audio = b"OggS" + clip_id.encode()
                relative = f"clips/{clip_id}.ogg"
                (self.source / relative).write_bytes(audio)
                self.rows.append({"id": clip_id, "audio_relpath": relative,
                                  "audio_sha256": hashlib.sha256(audio).hexdigest(),
                                  "duration_sec": 1.25, "status": "candidate", "review_needed": True})
        self.write_index()

    def write_index(self):
        (self.source / "clips.json").write_text(json.dumps({"schema": 1, "chapter": 0, "clips": self.rows}), encoding="utf-8")

    def snapshot(self):
        return {p.relative_to(self.destination).as_posix(): p.read_bytes()
                for p in self.destination.rglob("*") if p.is_file()}

    def test_install_is_repeatable_and_never_writes_canonical_or_source(self):
        canonical = self.destination / "data/textbook/canonical_books/KotobaFlow1.bundle.json"
        canonical.parent.mkdir(parents=True)
        canonical.write_bytes(b"preserve canonical")
        source_before = {p.name: p.read_bytes() for p in self.source.rglob("*") if p.is_file()}
        result = KANA.install_kana(self.source, self.destination)
        self.assertEqual(result["clips"], 92)
        installed = self.destination / KANA.KANA_DIR
        self.assertEqual(len(list((installed / "clips").glob("*.ogg"))), 92)
        index = json.loads((installed / "clips.json").read_text(encoding="utf-8"))
        self.assertTrue(index["clips"][-1]["review_needed"])
        self.assertEqual(index["clips"][-1]["audio_sha256"], self.rows[-1]["audio_sha256"])
        before = self.snapshot()
        KANA.install_kana(self.source, self.destination)
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(canonical.read_bytes(), b"preserve canonical")
        self.assertEqual({p.name: p.read_bytes() for p in self.source.rglob("*") if p.is_file()}, source_before)

    def test_missing_or_corrupt_late_clip_leaves_existing_pack_untouched(self):
        KANA.install_kana(self.source, self.destination)
        before = self.snapshot()
        last = self.source / self.rows[-1]["audio_relpath"]
        last.write_bytes(b"OggScorrupt")
        with self.assertRaises(ValueError):
            KANA.install_kana(self.source, self.destination)
        self.assertEqual(self.snapshot(), before)
        last.unlink()
        with self.assertRaises(ValueError):
            KANA.install_kana(self.source, self.destination)
        self.assertEqual(self.snapshot(), before)

    def test_invalid_identity_count_and_unsafe_paths_are_rejected_before_writes(self):
        original = [dict(row) for row in self.rows]
        for change in ["../outside.ogg", "/clips/C00-K01.ogg", "clips\\C00-K01.ogg", "clips/C00-K02.ogg"]:
            self.rows = [dict(row) for row in original]
            self.rows[0]["audio_relpath"] = change
            self.write_index()
            with self.assertRaises(ValueError):
                KANA.install_kana(self.source, self.destination)
            self.assertEqual(self.snapshot(), {})
        for rows in [original[:-1], [original[0]] + original[:-1]]:
            self.rows = rows
            self.write_index()
            with self.assertRaises(ValueError):
                KANA.install_kana(self.source, self.destination)
            self.assertEqual(self.snapshot(), {})

    def test_copy_failure_does_not_partially_replace_installed_pack(self):
        KANA.install_kana(self.source, self.destination)
        before = self.snapshot()
        copy = KANA.shutil.copyfile
        calls = 0

        def fail_late(*args, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 92:
                raise OSError("simulated disk failure")
            return copy(*args, **kwargs)

        with patch.object(KANA.shutil, "copyfile", side_effect=fail_late), self.assertRaises(OSError):
            KANA.install_kana(self.source, self.destination)
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(sorted(p.name for p in (self.destination / "data").iterdir()), [Path(KANA.KANA_DIR).name])

    def test_linked_destination_is_never_followed(self):
        data = self.destination / "data"
        data.mkdir()
        target = data / Path(KANA.KANA_DIR).name
        if os.name == "nt":
            subprocess.run(["cmd", "/c", "mklink", "/J", str(target), str(self.source)], check=True, capture_output=True)
        else:
            target.symlink_to(self.source, target_is_directory=True)
        with self.assertRaises(ValueError):
            KANA.install_kana(self.source, self.destination)
        self.assertEqual(len(list((self.source / "clips").iterdir())), 92)

    def test_publish_failure_restores_the_previous_pack(self):
        KANA.install_kana(self.source, self.destination)
        before = self.snapshot()
        replace = KANA.os.replace

        def fail_publish(source, destination):
            if Path(source).name == "package":
                raise OSError("simulated publish failure")
            return replace(source, destination)

        with patch.object(KANA.os, "replace", side_effect=fail_publish), self.assertRaises(OSError):
            KANA.install_kana(self.source, self.destination)
        self.assertEqual(self.snapshot(), before)

    def test_interruption_during_swap_preserves_the_previous_pack(self):
        KANA.install_kana(self.source, self.destination)
        before = self.snapshot()
        replace = KANA.os.replace
        for interrupt_after_backup in [True, False]:
            def interrupt_swap(source, destination):
                if interrupt_after_backup and Path(destination).name == "previous":
                    replace(source, destination)
                    raise KeyboardInterrupt()
                if not interrupt_after_backup and Path(source).name == "package":
                    raise KeyboardInterrupt()
                return replace(source, destination)

            with patch.object(KANA.os, "replace", side_effect=interrupt_swap), self.assertRaises(KeyboardInterrupt):
                KANA.install_kana(self.source, self.destination)
            self.assertEqual(self.snapshot(), before)

    def test_failed_rollback_keeps_a_complete_recoverable_backup(self):
        KANA.install_kana(self.source, self.destination)
        installed = self.destination / KANA.KANA_DIR
        before = {p.relative_to(installed).as_posix(): p.read_bytes() for p in installed.rglob("*") if p.is_file()}
        replace = KANA.os.replace

        def fail_publish_and_restore(source, destination):
            if Path(source).name in {"package", "previous"}:
                raise OSError("simulated filesystem failure")
            return replace(source, destination)

        with patch.object(KANA.os, "replace", side_effect=fail_publish_and_restore), self.assertRaisesRegex(RuntimeError, "Restore the previous kana pack"):
            KANA.install_kana(self.source, self.destination)
        previous = next((self.destination / "data").glob(".kana-install-*/previous"))
        self.assertEqual({p.relative_to(previous).as_posix(): p.read_bytes() for p in previous.rglob("*") if p.is_file()}, before)


if __name__ == "__main__":
    unittest.main()
