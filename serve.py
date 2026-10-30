from __future__ import annotations

import atexit
import json
import io
import os
import socket
import sys
import threading
import webbrowser
import argparse
import subprocess
import time
import tempfile
import re
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib import error as urllib_error
from urllib import parse as urllib_parse
from urllib import request as urllib_request


ROOT = Path(__file__).resolve().parent
HOST = "127.0.0.1"
START_PORT = 8080
END_PORT = 8099
QWEN_WORKER_HOST = "127.0.0.1"
QWEN_WORKER_PORT = 8312
QWEN_ROOT = ROOT / "local" / "tts" / "qwen"
QWEN_PYTHON = QWEN_ROOT / ".venv" / "Scripts" / "python.exe"
QWEN_WORKER_SCRIPT = QWEN_ROOT / "worker_server.py"
QWEN_LOG_DIR = QWEN_ROOT / "logs"
QWEN_WORKER_PROCESS: subprocess.Popen[bytes] | None = None
QWEN_WORKER_STDOUT = None
QWEN_WORKER_STDERR = None
QWEN_WORKER_LOCK = threading.Lock()
PROGRESS_PATH = ROOT / "data" / "user_progress.json"
PROGRESS_LOCK = threading.RLock()


class ProgressConflict(Exception):
    pass
PLAN_DEFAULTS = {
    "dailyMinutes": 10,
    "dailyNewWords": 20,
    "bookId": "XinBian1",
    "lessonId": "lesson_02",
    "jlptTarget": "N5",
    "updatedAt": "",
}


# serve.py --no-service-worker (used by run.bat previews): replace sw.js with a
# worker that clears every cache, unregisters itself and reloads open tabs once,
# so a checkout always shows the files on disk instead of a cached older shell.
SERVICE_WORKER_DISABLED = False
RETIRED_SERVICE_WORKER = b"""// Served by serve.py --no-service-worker.
self.addEventListener('install', function () {
  self.skipWaiting();
});
self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    await self.clients.claim();
    var keys = await caches.keys();
    await Promise.all(keys.map(function (key) { return caches.delete(key); }));
    await self.registration.unregister();
    if (!keys.length) return;
    var pages = await self.clients.matchAll({ type: 'window' });
    pages.forEach(function (page) { page.navigate(page.url); });
  })());
});
"""


# A browser that cancels a request (navigation, closed tab, test teardown) aborts
# the socket while a response is still being written. That is not a server fault,
# so it skips socketserver's full traceback; every other error still prints one.
CLIENT_DISCONNECTS = (BrokenPipeError, ConnectionAbortedError, ConnectionResetError)


class QuietServer(ThreadingHTTPServer):
    def handle_error(self, request, client_address) -> None:
        if isinstance(sys.exc_info()[1], CLIENT_DISCONNECTS):
            return
        super().handle_error(request, client_address)


# One "bytes=" range per request, as browsers send for media and example-audio
# packs. Without it a long MP3 (the narrated classics) cannot seek past what
# has downloaded. Several ranges or other units get the whole file instead.
BYTE_RANGE = re.compile(r"^bytes=(\d*)-(\d*)$")


class LimitedFile:
    """The open file from the range start, ending after `length` bytes."""

    def __init__(self, file, length: int) -> None:
        self.file = file
        self.remaining = length

    def read(self, size: int = -1) -> bytes:
        if self.remaining <= 0:
            return b""
        if size is None or size < 0 or size > self.remaining:
            size = self.remaining
        data = self.file.read(size)
        self.remaining -= len(data)
        return data

    def close(self) -> None:
        self.file.close()


class QuietHandler(SimpleHTTPRequestHandler):
    # Reuse static-asset connections; large chunk sets otherwise exhaust Windows sockets.
    protocol_version = "HTTP/1.1"

    def send_byte_range(self, header: str):
        match = BYTE_RANGE.match(header.strip())
        path = self.translate_path(self.path)
        if not match or not (match.group(1) or match.group(2)) or not os.path.isfile(path):
            return NotImplemented
        size = os.path.getsize(path)
        if match.group(1):
            start = int(match.group(1))
            end = min(int(match.group(2)), size - 1) if match.group(2) else size - 1
        else:
            start = max(0, size - int(match.group(2)))
            end = size - 1
        if start >= size or start > end:
            self.send_response(416)
            self.send_header("Content-Range", "bytes */%d" % size)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return None
        file = open(path, "rb")
        try:
            file.seek(start)
            self.send_response(206)
            self.send_header("Content-Type", self.guess_type(path))
            self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
            self.send_header("Content-Length", str(end - start + 1))
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Last-Modified", self.date_time_string(int(os.path.getmtime(path))))
            self.end_headers()
        except BaseException:
            file.close()
            raise
        return LimitedFile(file, end - start + 1)

    def send_head(self):
        if SERVICE_WORKER_DISABLED and urllib_parse.urlparse(self.path).path == "/sw.js":
            self.send_response(200)
            self.send_header("Content-Type", "text/javascript; charset=utf-8")
            self.send_header("Content-Length", str(len(RETIRED_SERVICE_WORKER)))
            self.end_headers()
            return io.BytesIO(RETIRED_SERVICE_WORKER)
        if urllib_parse.urlparse(self.path).path == "/js/storage-config.js":
            body = b"window.JPLearnStorageConfig = window.JPLearnStorageConfig || Object.freeze({ mode: 'local-api' });\n"
            self.send_response(200)
            self.send_header("Content-Type", "text/javascript; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            return io.BytesIO(body)
        byte_range = self.headers.get("Range")
        if byte_range:
            ranged = self.send_byte_range(byte_range)
            if ranged is not NotImplemented:
                return ranged
        return super().send_head()

    def log_message(self, format: str, *args) -> None:
        sys.stdout.write("[http] " + format % args + os.linesep)

    def end_headers(self) -> None:
        path = urllib_parse.urlparse(self.path).path
        if self.command == "POST" or path.startswith("/api/"):
            self.send_header("Connection", "close")
            self.close_connection = True
        if path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store")
        else:
            # Revalidate static files on refresh without forcing a fresh storage origin every run.
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def _send_json(self, status: int, payload: dict[str, object]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        path = urllib_parse.urlparse(self.path).path
        if path == "/api/progress":
            try:
                self._send_json(200, read_progress())
            except Exception:
                self._send_json(503, {"error": "Progress file unavailable"})
            return
        if path == "/api/tts/qwen/health":
            try:
                ensure_qwen_worker()
                status, headers, body = proxy_qwen_request("GET", "/health")
                self.send_response(status)
                self.send_header("Content-Type", headers.get("Content-Type", "application/json; charset=utf-8"))
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except Exception as exc:
                self._send_json(502, {"error": str(exc)})
            return
        super().do_GET()

    def do_POST(self) -> None:
        path = urllib_parse.urlparse(self.path).path
        if path == "/api/progress":
            try:
                length = int(self.headers.get("Content-Length") or "0")
                body = self.rfile.read(length) if length > 0 else b"{}"
                payload = json.loads(body.decode("utf-8"))
                if not isinstance(payload, dict):
                    self._send_json(400, {"error": "Expected progress object"})
                    return
                expected = self.headers.get("If-Match")
                if expected is None:
                    self._send_json(428, {"error": "Progress revision required"})
                    return
                saved = write_progress(payload, expected)
                self._send_json(200, saved)
            except ProgressConflict:
                self._send_json(409, {"error": "Progress revision conflict"})
            except json.JSONDecodeError:
                self._send_json(400, {"error": "Invalid JSON"})
            except Exception as exc:
                self._send_json(500, {"error": str(exc)})
            return
        if path != "/api/tts/qwen/synthesize":
            self._send_json(404, {"error": "Not found"})
            return
        try:
            ensure_qwen_worker()
            length = int(self.headers.get("Content-Length") or "0")
            body = self.rfile.read(length) if length > 0 else b"{}"
            status, headers, payload = proxy_qwen_request(
                "POST",
                "/synthesize",
                body=body,
                content_type=self.headers.get("Content-Type", "application/json; charset=utf-8"),
            )
            self.send_response(status)
            self.send_header("Content-Type", headers.get("Content-Type", "application/octet-stream"))
            self.send_header("Content-Length", str(len(payload)))
            if headers.get("X-TTS-Cache"):
                self.send_header("X-TTS-Cache", headers["X-TTS-Cache"])
            self.end_headers()
            self.wfile.write(payload)
        except urllib_error.HTTPError as exc:
            error_body = exc.read()
            self.send_response(exc.code)
            self.send_header("Content-Type", exc.headers.get("Content-Type", "application/json; charset=utf-8"))
            self.send_header("Content-Length", str(len(error_body)))
            self.end_headers()
            self.wfile.write(error_body)
        except Exception as exc:
            self._send_json(502, {"error": str(exc)})


def find_port() -> int:
    for port in range(START_PORT, END_PORT + 1):
        try:
            with socket.create_connection((HOST, port), timeout=0.2):
                continue
        except OSError:
            return port
    raise RuntimeError(f"No free port found in {START_PORT}-{END_PORT}")


def default_progress() -> dict[str, object]:
    return {
        "version": 2,
        "revision": 0,
        "vocabulary": {
            "known": [],
            "fuzzy": [],
            "unknown": [],
            "favorite": [],
            "grammarFavorite": [],
            "history": [],
            "srsVersion": 1,
            "srs": [],
        },
        "navigation": {
            "version": 1,
            "lastModule": "",
            "vocab": {},
            "grammar": {},
            "textbook": {},
        },
        "plan": dict(PLAN_DEFAULTS),
        "usage": {},
        "updatedAt": "",
    }


def _bounded_int(value: object, fallback: int, lower: int, upper: int) -> int:
    if isinstance(value, bool):
        return fallback
    try:
        number = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError, OverflowError):
        return fallback
    return max(lower, min(upper, number))


def normalize_plan(value: object) -> dict[str, object]:
    plan = dict(PLAN_DEFAULTS)
    if not isinstance(value, dict):
        return plan

    plan["dailyMinutes"] = _bounded_int(value.get("dailyMinutes"), int(PLAN_DEFAULTS["dailyMinutes"]), 5, 120)
    plan["dailyNewWords"] = _bounded_int(value.get("dailyNewWords"), int(PLAN_DEFAULTS["dailyNewWords"]), 5, 60)
    book_id = value.get("bookId")
    if book_id in {"XinBian1", "XinBian2", "XinBian3", "XinBian4"}:
        plan["bookId"] = book_id
    lesson_id = value.get("lessonId")
    if isinstance(lesson_id, str) and re.fullmatch(r"(?:lesson|review_unit)_\d+", lesson_id):
        plan["lessonId"] = lesson_id
    jlpt_target = value.get("jlptTarget")
    if isinstance(jlpt_target, str) and jlpt_target.upper() in {"N5", "N4", "N3", "N2", "N1"}:
        plan["jlptTarget"] = jlpt_target.upper()
    updated_at = value.get("updatedAt")
    if isinstance(updated_at, str):
        plan["updatedAt"] = updated_at
    return plan


def normalize_progress(payload: object) -> dict[str, object]:
    base = default_progress()
    if not isinstance(payload, dict):
        return base

    vocab = payload.get("vocabulary")
    if isinstance(vocab, dict):
        normalized_vocab = base["vocabulary"]
        assert isinstance(normalized_vocab, dict)
        for key in ("known", "fuzzy", "unknown", "favorite", "grammarFavorite", "history"):
            value = vocab.get(key)
            normalized_vocab[key] = value if isinstance(value, list) else []
        srs = vocab.get("srs")
        normalized_vocab["srsVersion"] = 1
        normalized_vocab["srs"] = [record for record in srs if isinstance(record, dict)] if isinstance(srs, list) else []

    usage = payload.get("usage")
    if isinstance(usage, dict):
        base["usage"] = usage

    base["plan"] = normalize_plan(payload.get("plan"))

    navigation = payload.get("navigation")
    if isinstance(navigation, dict):
        normalized_navigation = base["navigation"]
        assert isinstance(normalized_navigation, dict)
        last_module = navigation.get("lastModule")
        if last_module in ("vocab", "grammar", "lesson"):
            normalized_navigation["lastModule"] = last_module
        for key in ("vocab", "grammar", "textbook"):
            value = navigation.get(key)
            normalized_navigation[key] = value if isinstance(value, dict) else {}

    updated_at = payload.get("updatedAt")
    base["updatedAt"] = updated_at if isinstance(updated_at, str) else ""
    base["version"] = 2
    revision = payload.get("revision")
    base["revision"] = revision if type(revision) is int and 0 <= revision <= 9007199254740991 else 0
    return base


def read_progress() -> dict[str, object]:
    with PROGRESS_LOCK:
        if not PROGRESS_PATH.exists():
            return normalize_progress({})
        with PROGRESS_PATH.open("r", encoding="utf-8") as f:
            raw = json.load(f)
        if not isinstance(raw, dict):
            raise ValueError("Invalid progress file")
        return normalize_progress(raw)


def write_progress(payload: object, expected_revision: str) -> dict[str, object]:
    progress = normalize_progress(payload)
    progress["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    PROGRESS_PATH.parent.mkdir(parents=True, exist_ok=True)
    with PROGRESS_LOCK:
        current = read_progress()
        if expected_revision != str(current["revision"]):
            raise ProgressConflict()
        progress["revision"] = current["revision"] + 1
        fd, tmp_name = tempfile.mkstemp(
            prefix=PROGRESS_PATH.name + ".",
            suffix=".tmp",
            dir=str(PROGRESS_PATH.parent),
            text=True,
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(progress, f, ensure_ascii=False, indent=2)
                f.write("\n")
            os.replace(tmp_name, PROGRESS_PATH)
        finally:
            if os.path.exists(tmp_name):
                os.unlink(tmp_name)
    return progress


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--port", type=int, help="Bind an explicit port instead of scanning 8080-8099")
    parser.add_argument(
        "--no-service-worker",
        action="store_true",
        help="Preview mode: retire cached service workers so pages always match the files on disk",
    )
    progress = parser.add_mutually_exclusive_group()
    progress.add_argument("--progress-file", type=Path, help="Use a specific private progress file")
    progress.add_argument("--temporary-progress", action="store_true", help="Use disposable isolated progress for tests")
    return parser.parse_args()


def qwen_worker_url(path: str) -> str:
    return f"http://{QWEN_WORKER_HOST}:{QWEN_WORKER_PORT}{path}"


def is_qwen_worker_ready() -> bool:
    try:
        req = urllib_request.Request(qwen_worker_url("/health"), method="GET")
        with urllib_request.urlopen(req, timeout=1.5) as res:
            return res.status == 200
    except Exception:
        return False


def ensure_qwen_worker(timeout_seconds: float = 20.0) -> None:
    global QWEN_WORKER_PROCESS, QWEN_WORKER_STDOUT, QWEN_WORKER_STDERR
    if is_qwen_worker_ready():
        return

    with QWEN_WORKER_LOCK:
        if is_qwen_worker_ready():
            return
        if not QWEN_PYTHON.exists():
            raise RuntimeError(f"Qwen Python runtime not found: {QWEN_PYTHON}")
        if not QWEN_WORKER_SCRIPT.exists():
            raise RuntimeError(f"Qwen worker script not found: {QWEN_WORKER_SCRIPT}")

        if QWEN_WORKER_PROCESS is None or QWEN_WORKER_PROCESS.poll() is not None:
            QWEN_LOG_DIR.mkdir(parents=True, exist_ok=True)
            QWEN_WORKER_STDOUT = open(QWEN_LOG_DIR / "worker.stdout.log", "a", encoding="utf-8")
            QWEN_WORKER_STDERR = open(QWEN_LOG_DIR / "worker.stderr.log", "a", encoding="utf-8")
            creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            QWEN_WORKER_PROCESS = subprocess.Popen(
                [
                    str(QWEN_PYTHON),
                    str(QWEN_WORKER_SCRIPT),
                    "--host",
                    QWEN_WORKER_HOST,
                    "--port",
                    str(QWEN_WORKER_PORT),
                    "--parent-pid",
                    str(os.getpid()),
                ],
                cwd=str(ROOT),
                stdout=QWEN_WORKER_STDOUT,
                stderr=QWEN_WORKER_STDERR,
                creationflags=creationflags,
            )

        deadline = time.time() + timeout_seconds
        while time.time() < deadline:
            if is_qwen_worker_ready():
                return
            if QWEN_WORKER_PROCESS and QWEN_WORKER_PROCESS.poll() is not None:
                raise RuntimeError(f"Qwen worker exited with code {QWEN_WORKER_PROCESS.poll()}")
            time.sleep(0.25)
        raise RuntimeError("Timed out waiting for Qwen worker startup")


def stop_qwen_worker() -> None:
    global QWEN_WORKER_PROCESS, QWEN_WORKER_STDOUT, QWEN_WORKER_STDERR
    with QWEN_WORKER_LOCK:
        proc = QWEN_WORKER_PROCESS
        if proc is not None and proc.poll() is None:
            try:
                subprocess.run(
                    ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                    check=False,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=10,
                )
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass
        QWEN_WORKER_PROCESS = None
        if QWEN_WORKER_STDOUT is not None:
            QWEN_WORKER_STDOUT.close()
            QWEN_WORKER_STDOUT = None
        if QWEN_WORKER_STDERR is not None:
            QWEN_WORKER_STDERR.close()
            QWEN_WORKER_STDERR = None


def proxy_qwen_request(method: str, path: str, body: bytes | None = None, content_type: str | None = None) -> tuple[int, dict[str, str], bytes]:
    headers = {}
    if content_type:
        headers["Content-Type"] = content_type
    req = urllib_request.Request(qwen_worker_url(path), data=body, headers=headers, method=method)
    with urllib_request.urlopen(req, timeout=600) as res:
        payload = res.read()
        response_headers = {
            "Content-Type": res.headers.get("Content-Type", ""),
            "X-TTS-Cache": res.headers.get("X-TTS-Cache", ""),
        }
        return res.status, response_headers, payload


def main() -> int:
    global PROGRESS_PATH, SERVICE_WORKER_DISABLED
    args = parse_args()
    SERVICE_WORKER_DISABLED = args.no_service_worker
    temporary_progress = tempfile.TemporaryDirectory(prefix="kotobaflow-progress-") if args.temporary_progress else None
    if temporary_progress:
        PROGRESS_PATH = Path(temporary_progress.name) / "progress.json"
    elif args.progress_file:
        PROGRESS_PATH = args.progress_file.resolve()
    port = args.port if args.port is not None else find_port()
    if not 1 <= port <= 65535:
        raise ValueError(f"Invalid port: {port}")
    handler = partial(QuietHandler, directory=str(ROOT))
    server = QuietServer((HOST, port), handler)
    url = f"http://{HOST}:{port}/index.html"

    print(f"Serving {ROOT}")
    print(f"Open {url}")
    if args.port is None and port != START_PORT:
        print(f"Note: {START_PORT} is occupied, so the server fell back to {port}.")
    print("Press Ctrl+C to stop.")

    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
    finally:
        server.server_close()
        stop_qwen_worker()
        if temporary_progress:
            temporary_progress.cleanup()
    return 0


atexit.register(stop_qwen_worker)


if __name__ == "__main__":
    raise SystemExit(main())
