"""CLI entry point: `python -m openwop_host`."""

from __future__ import annotations

import os
import signal
import sys
import threading

from . import __version__
from .server import serve


def main() -> int:
    host = os.environ.get("OPENWOP_HOST", "127.0.0.1")
    port = int(os.environ.get("OPENWOP_PORT", "3737"))

    server, state, thread = serve(host, port)
    api_key = state.api_key
    fixture_count = len(state.workflows)
    print(
        f"[openwop-host-in-memory-python {__version__}] listening on "
        f"http://{host}:{port} (api key: {api_key}, {fixture_count} fixtures loaded)",
        flush=True,
    )

    shutdown_event = threading.Event()

    def _on_signal(signum: int, _frame: object) -> None:  # noqa: ARG001
        print(f"[openwop-host] received signal {signum}; shutting down", flush=True)
        shutdown_event.set()

    signal.signal(signal.SIGINT, _on_signal)
    signal.signal(signal.SIGTERM, _on_signal)

    shutdown_event.wait()
    server.shutdown()
    server.server_close()
    thread.join(timeout=5)
    return 0


if __name__ == "__main__":
    sys.exit(main())
