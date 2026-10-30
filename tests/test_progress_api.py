import concurrent.futures
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from http.server import ThreadingHTTPServer
from urllib import request, error

import serve


class ProgressTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="kotobaflow-api-test-")
        self.addCleanup(self.directory.cleanup)
        self.progress = Path(self.directory.name) / "progress.json"
        self.path_patch = patch.object(serve, "PROGRESS_PATH", self.progress)
        self.path_patch.start()
        self.addCleanup(self.path_patch.stop)

    def test_concurrent_writers_cannot_overwrite_same_revision(self):
        def write(minutes):
            try:
                return serve.write_progress({"plan": {"dailyMinutes": minutes}}, "0")
            except serve.ProgressConflict:
                return None
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(write, [20, 40]))
        winners = [item for item in results if item]
        self.assertEqual(len(winners), 1)
        self.assertEqual(serve.read_progress(), winners[0])
        self.assertEqual(winners[0]["revision"], 1)

    def test_atomic_write_failure_keeps_last_confirmed_file(self):
        serve.write_progress({"plan": {"dailyMinutes": 25}}, "0")
        before = self.progress.read_bytes()
        with patch.object(serve.os, "replace", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                serve.write_progress({"plan": {"dailyMinutes": 55}}, "1")
        self.assertEqual(self.progress.read_bytes(), before)
        self.assertEqual(list(Path(self.directory.name).glob("*.tmp")), [])

    def test_damaged_file_is_not_silently_replaced(self):
        self.progress.write_text("broken", encoding="utf-8")
        with self.assertRaises(ValueError):
            serve.write_progress({}, "0")
        self.assertEqual(self.progress.read_text(), "broken")

    def test_static_connections_are_reused_but_api_closes(self):
        from http.client import HTTPConnection
        server = ThreadingHTTPServer(("127.0.0.1", 0), serve.QuietHandler)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        self.addCleanup(server.server_close)
        self.addCleanup(worker.join)
        self.addCleanup(server.shutdown)
        connection = HTTPConnection("127.0.0.1", server.server_port, timeout=5)
        self.addCleanup(connection.close)
        connection.request("GET", "/js/storage-config.js")
        response = connection.getresponse()
        body = response.read()
        self.assertEqual(int(response.getheader("Content-Length")), len(body))
        original_socket = connection.sock
        self.assertIsNotNone(original_socket)
        for _ in range(25):
            connection.request("GET", "/js/core/html.js")
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            response.read()
            self.assertIs(connection.sock, original_socket)
        connection.request("GET", "/api/progress")
        response = connection.getresponse()
        self.assertEqual(response.getheader("Connection"), "close")
        response.read()
        self.assertIsNone(connection.sock)

    def test_client_disconnects_skip_traceback_but_real_errors_still_print(self):
        import contextlib
        import io
        server = serve.QuietServer(("127.0.0.1", 0), serve.QuietHandler)
        self.addCleanup(server.server_close)
        cases = [
            (ConnectionAbortedError(10053, "aborted by the host"), False),
            (ConnectionResetError(10054, "reset by peer"), False),
            (BrokenPipeError(32, "broken pipe"), False),
            (ValueError("real handler bug"), True),
            (OSError(28, "no space left"), True),
        ]
        for exc, printed in cases:
            stderr = io.StringIO()
            with contextlib.redirect_stderr(stderr):
                try:
                    raise exc
                except Exception:
                    server.handle_error(None, ("127.0.0.1", 50000))
            output = stderr.getvalue()
            if printed:
                self.assertIn(type(exc).__name__, output)
                self.assertIn("Traceback", output)
            else:
                self.assertEqual(output, "", type(exc).__name__)

    def test_static_files_answer_a_single_byte_range(self):
        from http.client import HTTPConnection
        server = ThreadingHTTPServer(("127.0.0.1", 0), serve.QuietHandler)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        self.addCleanup(server.server_close)
        self.addCleanup(worker.join)
        self.addCleanup(server.shutdown)
        source = (Path(serve.__file__).resolve().parent / "js" / "core" / "html.js").read_bytes()
        connection = HTTPConnection("127.0.0.1", server.server_port, timeout=5)
        self.addCleanup(connection.close)

        def fetch(header):
            connection.request("GET", "/js/core/html.js?v=test", headers={"Range": header} if header else {})
            response = connection.getresponse()
            return response, response.read()

        response, body = fetch("bytes=10-29")
        self.assertEqual(response.status, 206)
        self.assertEqual(body, source[10:30])
        self.assertEqual(response.getheader("Content-Range"), f"bytes 10-29/{len(source)}")
        self.assertEqual(response.getheader("Accept-Ranges"), "bytes")
        # The connection stays usable after a partial body.
        response, body = fetch("bytes=-16")
        self.assertEqual((response.status, body), (206, source[-16:]))
        response, body = fetch(f"bytes=20-{len(source) + 500}")
        self.assertEqual((response.status, body), (206, source[20:]))
        response, body = fetch(f"bytes={len(source)}-")
        self.assertEqual(response.status, 416)
        self.assertEqual(response.getheader("Content-Range"), f"bytes */{len(source)}")
        # Several ranges or another unit fall back to the whole file.
        for header in ("bytes=0-1,4-5", "items=0-1", None):
            response, body = fetch(header)
            self.assertEqual((response.status, body), (200, source))

    def test_preview_mode_retires_the_service_worker(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), serve.QuietHandler)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        self.addCleanup(server.server_close)
        self.addCleanup(worker.join)
        self.addCleanup(server.shutdown)
        url = f"http://127.0.0.1:{server.server_port}/sw.js?v=test"
        with request.urlopen(url, timeout=5) as response:
            self.assertNotIn(b"--no-service-worker", response.read())
        with patch.object(serve, "SERVICE_WORKER_DISABLED", True):
            with request.urlopen(url, timeout=5) as response:
                body = response.read()
        self.assertIn(b"registration.unregister()", body)
        self.assertIn(b"caches.delete(key)", body)

    def test_http_requires_revision_and_rejects_late_request(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), serve.QuietHandler)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        self.addCleanup(server.server_close)
        self.addCleanup(worker.join)
        self.addCleanup(server.shutdown)
        url = f"http://127.0.0.1:{server.server_port}/api/progress"
        config_url = f"http://127.0.0.1:{server.server_port}/js/storage-config.js?v=test"
        with request.urlopen(config_url) as response:
            self.assertIn("mode: 'local-api'", response.read().decode())
            self.assertEqual(response.headers["Cache-Control"], "no-cache")
        with request.urlopen(request.Request(config_url, method="HEAD")) as response:
            self.assertEqual(response.status, 200)
            self.assertIn("text/javascript", response.headers["Content-Type"])
        def post(revision, minutes):
            headers = {"Content-Type": "application/json"}
            if revision is not None:
                headers["If-Match"] = revision
            req = request.Request(url, data=json.dumps({"plan": {"dailyMinutes": minutes}}).encode(), headers=headers)
            try:
                with request.urlopen(req) as response:
                    return response.status, json.load(response)
            except error.HTTPError as response:
                return response.code, json.load(response)
        self.assertEqual(post(None, 10)[0], 428)
        self.assertEqual(post("0", 30)[0], 200)
        self.assertEqual(post("0", 10)[0], 409)
        self.assertEqual(serve.read_progress()["plan"]["dailyMinutes"], 30)


if __name__ == "__main__":
    unittest.main()
