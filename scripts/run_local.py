"""Run both dev servers; terminate their process groups on exit (macOS/Linux)."""
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent


def stop(signum, frame):
    raise KeyboardInterrupt


def main():
    load_dotenv(ROOT / ".env")
    ports = [int(os.getenv("BACKEND_PORT", "8000")), int(os.getenv("FRONTEND_PORT", "5173"))]
    if len(set(ports)) != 2 or any(not 1 <= port <= 65535 for port in ports):
        raise ValueError("BACKEND_PORT and FRONTEND_PORT must be distinct ports from 1 to 65535.")
    for port in ports:
        with socket.socket() as sock:
            # Closed connections can remain in TIME_WAIT after a normal restart.
            # This still rejects a live listener on the same address and port.
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind(("127.0.0.1", port))
            except OSError as exc:
                raise RuntimeError(f"Port {port} is unavailable. Stop its server or change .env.") from exc

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    processes = []
    try:
        processes.append(subprocess.Popen(
            [sys.executable, "manage.py", "runserver", f"127.0.0.1:{ports[0]}"],
            cwd=ROOT / "backend", start_new_session=True,
        ))
        processes.append(subprocess.Popen(
            ["node", "node_modules/vite/bin/vite.js"],
            cwd=ROOT / "frontend", start_new_session=True,
        ))
        print(f"Frontend: http://127.0.0.1:{ports[1]}\nBackend: http://127.0.0.1:{ports[0]}/api/health/\nCtrl-C stops both servers.", flush=True)
        while all(process.poll() is None for process in processes):
            time.sleep(0.25)
        print("A dev server exited; stopping the full stack.", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 0
    finally:
        signal.signal(signal.SIGINT, signal.SIG_IGN)
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        for process in processes:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        deadline = time.monotonic() + 5
        for process in processes:
            try:
                process.wait(timeout=max(0, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                pass
        # Also clean up reload workers if their parent exited first.
        for process in processes:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, RuntimeError) as exc:
        print(exc, file=sys.stderr)
        sys.exit(1)
