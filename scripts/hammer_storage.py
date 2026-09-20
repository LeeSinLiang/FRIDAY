#!/usr/bin/env python3
"""Concurrency check for the one SQLite file three subsystems share.

Runs scene saves, compile requests (which write the throttle counter to the cache table) and
sign-in attempts (sessions and auth rate limits) against a RUNNING dev server, all at once, and
counts server errors. A storage problem may delay a save; it must never produce a 5xx.

Usage: python3 scripts/hammer_storage.py http://127.0.0.1:8211 [seconds]
Exit codes: 0 no server errors, 1 server errors seen, 2 could not run.
"""
import http.cookiejar
import json
import sys
import threading
import time
import urllib.error
import urllib.request
from collections import Counter

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://127.0.0.1:8211"
SECONDS = float(sys.argv[2]) if len(sys.argv) > 2 else 12.0
WORKERS = {"scene": 4, "compile": 3, "login": 3}
results: dict[str, Counter] = {name: Counter() for name in WORKERS}
lock = threading.Lock()


class Browser:
    """One cookie jar, one CSRF token: what a real tab sends."""

    def __init__(self) -> None:
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def csrf(self) -> str:
        return next((cookie.value for cookie in self.jar if cookie.name == "csrftoken"), "")

    def call(self, method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
        data = None if body is None else json.dumps(body).encode()
        headers = {"Content-Type": "application/json", "X-CSRFToken": self.csrf(), "Referer": BASE + "/"}
        request = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
        try:
            with self.opener.open(request, timeout=30) as response:
                return response.status, json.loads(response.read() or b"{}")
        except urllib.error.HTTPError as error:
            raw = error.read()
            try:
                return error.code, json.loads(raw or b"{}")
            except json.JSONDecodeError:
                return error.code, {}


def record(name: str, status: int) -> None:
    with lock:
        results[name][status] += 1


def scene_worker(deadline: float, index: int) -> None:
    browser = Browser()
    status, scene = browser.call("GET", "/api/scene/")
    revision, x = scene.get("revision", 0), 100
    while time.time() < deadline:
        x = 100 + (x - 95) % 300  # a chair sliding along a line: always a legal pose
        item = {"instanceId": f"hammer-{index}", "productId": "test-chair", "pose": {"xCm": x, "zCm": 250, "yawRad": 0}}
        status, body = browser.call("PUT", "/api/scene/", {"baseRevision": revision, "instances": [item]})
        record("scene", status)
        if status == 200:
            revision = body["revision"]
        elif status == 409:
            revision = body.get("revision", revision)


def compile_worker(deadline: float, index: int) -> None:
    browser = Browser()
    while time.time() < deadline:
        # A malformed body is refused after the throttle has counted it, so this exercises the
        # cache write without spending a model call.
        status, _ = browser.call("POST", "/api/compile", {"text": 12345})
        record("compile", status)


def login_worker(deadline: float, index: int) -> None:
    browser = Browser()
    browser.call("GET", "/_allauth/browser/v1/config")
    while time.time() < deadline:
        status, _ = browser.call("POST", "/_allauth/browser/v1/auth/login", {"email": f"nobody{index}@example.com", "password": "wrong-password-1"})
        record("login", status)


def main() -> int:
    try:
        urllib.request.urlopen(BASE + "/api/health/", timeout=5).read()
    except OSError as error:
        print(f"cannot reach {BASE}: {error}", file=sys.stderr)
        return 2
    deadline = time.time() + SECONDS
    targets = {"scene": scene_worker, "compile": compile_worker, "login": login_worker}
    threads = [threading.Thread(target=targets[name], args=(deadline, i)) for name, count in WORKERS.items() for i in range(count)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    errors = 0
    for name, counts in results.items():
        server_errors = sum(n for status, n in counts.items() if status >= 500)
        errors += server_errors
        print(f"{name:8} {sum(counts.values()):5} requests  {dict(sorted(counts.items()))}  5xx: {server_errors}")
    print("RESULT:", "no server errors" if errors == 0 else f"{errors} server errors")
    return 0 if errors == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
