#!/usr/bin/env python3
"""Python smoke for openwop-client.

Exercises the wire round-trip against a running SQLite reference host:
    1. Capability discovery (unauthenticated)
    2. Run create + terminal poll for ``conformance-noop``
    3. Error envelope on unknown workflowId

Exits non-zero on any contract violation. Run from repo root with the
SQLite host listening on 127.0.0.1:3838 (default ``OPENWOP_BASE_URL``).
"""

import os
import sys
import time
from pathlib import Path

# Import the SDK directly from its source directory so the smoke runs
# without requiring a package install.
SDK_SRC = Path(__file__).resolve().parents[1] / "python" / "src"
sys.path.insert(0, str(SDK_SRC))

from openwop_client import (  # type: ignore[import-not-found]  # noqa: E402
    CreateRunRequest,
    OpenwopClient,
    WopError,
)

BASE_URL = os.environ.get("OPENWOP_BASE_URL", "http://127.0.0.1:3838")
API_KEY = os.environ.get("OPENWOP_API_KEY", "openwop-sqlite-dev-key")
FIXTURE = "conformance-noop"
TERMINAL_STATUSES = {"completed", "failed", "cancelled"}


def fail(msg: str) -> None:
    print(f"[smoke-py] FAIL: {msg}", file=sys.stderr)
    sys.exit(1)


def poll_terminal(client: OpenwopClient, run_id: str) -> str:
    deadline = time.monotonic() + 10.0
    while time.monotonic() < deadline:
        snap = client.runs_get(run_id)
        if snap.status in TERMINAL_STATUSES:
            return snap.status
        time.sleep(0.05)
    fail(f"run {run_id} did not terminate within 10s")
    return ""  # unreachable; satisfies type checker


def main() -> None:
    client = OpenwopClient(base_url=BASE_URL, api_key=API_KEY)

    # 1. Discovery
    caps = client.discovery_capabilities()
    if caps.protocolVersion != "1.0":
        fail(f"protocolVersion {caps.protocolVersion} != 1.0")

    # 2. Run + poll
    create = client.runs_create(CreateRunRequest(workflowId=FIXTURE))
    if not create.runId:
        fail("runs_create did not return runId")
    if not create.eventsUrl:
        fail("runs_create did not return eventsUrl")
    terminal = poll_terminal(client, create.runId)
    if terminal != "completed":
        fail(f"terminal status {terminal} != completed")

    # 3. Error envelope on bad workflow
    try:
        client.runs_create(CreateRunRequest(workflowId="__does_not_exist__"))
        fail("expected WopError for unknown workflow")
    except WopError as err:
        if err.status not in (400, 404):
            fail(f"expected 400/404 for unknown workflow, got {err.status}")

    print("[smoke-py] PASS")


if __name__ == "__main__":
    main()
