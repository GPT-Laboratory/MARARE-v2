"""Run an MCP stdio server while keeping stdout JSON-RPC clean.

Some npm MCP servers print human startup logs to stdout. The Python MCP stdio
client expects every stdout line to be JSON-RPC, so this wrapper forwards only
JSON-looking lines to stdout and moves other child output to stderr.
"""

from __future__ import annotations

import subprocess
import os
import shutil
import sys
import threading


def _forward_stdin(process: subprocess.Popen[bytes]) -> None:
    try:
        while True:
            chunk = os.read(sys.stdin.fileno(), 4096)
            if not chunk:
                break
            if process.stdin:
                process.stdin.write(chunk)
                process.stdin.flush()
    except OSError:
        pass
    finally:
        if process.stdin:
            try:
                process.stdin.close()
            except OSError:
                pass


def _forward_stdout(process: subprocess.Popen[bytes]) -> None:
    if not process.stdout:
        return

    for line in process.stdout:
        stripped = line.lstrip()
        if stripped.startswith((b"{", b"[")):
            sys.stdout.buffer.write(line)
            sys.stdout.buffer.flush()
        else:
            sys.stderr.buffer.write(b"[mcp-server-log] " + line)
            sys.stderr.buffer.flush()


def _forward_stderr(process: subprocess.Popen[bytes]) -> None:
    if not process.stderr:
        return

    for line in process.stderr:
        sys.stderr.buffer.write(line)
        sys.stderr.buffer.flush()


def main() -> int:
    if len(sys.argv) < 2:
        sys.stderr.write("Usage: mcp_stdio_filter.py <command> [args...]\n")
        return 2

    command = shutil.which(sys.argv[1]) or sys.argv[1]
    child_args = [command, *sys.argv[2:]]
    process = subprocess.Popen(
        child_args,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    threads = [
        threading.Thread(target=_forward_stdin, args=(process,), daemon=True),
        threading.Thread(target=_forward_stdout, args=(process,), daemon=True),
        threading.Thread(target=_forward_stderr, args=(process,), daemon=True),
    ]
    for thread in threads:
        thread.start()

    return process.wait()


if __name__ == "__main__":
    raise SystemExit(main())
