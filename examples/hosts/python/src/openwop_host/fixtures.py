"""Fixture loader.

Walks up the filesystem from this file until it finds
`conformance/fixtures/`. Mirrors the TypeScript reference host's
behavior so this host slot-in-replaces it for conformance runs from
the public openwop repo.

Hosts that don't find the directory register a synthetic noop so
basic discovery scenarios continue to work in standalone runs.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def load_fixtures(start: Path | None = None) -> dict[str, dict[str, Any]]:
    """Return {workflowId: fixture-doc} from the nearest `conformance/fixtures/`.

    Walks up at most 10 levels from `start` (defaults to this file's
    parent). When no directory is found, returns a single-entry dict
    with a synthetic noop fixture so the host still answers discovery
    + basic lifecycle scenarios.
    """
    probe = (start or Path(__file__).resolve().parent).resolve()
    for _ in range(10):
        candidate = probe / "conformance" / "fixtures"
        if candidate.is_dir():
            return _load_directory(candidate)
        if probe.parent == probe:
            break
        probe = probe.parent

    # Fallback: a synthetic noop so discovery + lifecycle still work.
    return {
        "conformance-noop": {
            "id": "conformance-noop",
            "name": "Synthetic Noop",
            "version": "1.0",
            "nodes": [
                {"id": "noop", "typeId": "core.noop", "name": "Noop", "inputs": {}},
            ],
        }
    }


def _load_directory(path: Path) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for entry in sorted(path.iterdir()):
        if not entry.is_file() or entry.suffix != ".json":
            continue
        with entry.open("r", encoding="utf-8") as fh:
            try:
                parsed = json.load(fh)
            except json.JSONDecodeError:
                continue
        wf_id = parsed.get("id")
        if isinstance(wf_id, str):
            out[wf_id] = parsed
    return out
