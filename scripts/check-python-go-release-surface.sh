#!/usr/bin/env bash
# check-python-go-release-surface — no-dependency release checks for PyPI + Go.

set -euo pipefail

SPEC_ROOT="."
EXPECTED_GO_MODULE="github.com/openwop/openwop/sdk/go"

echo "=== check-python-go-release-surface — auditing Python and Go release surfaces ==="
echo

python3 - <<'PY'
from __future__ import annotations

import ast
import pathlib
import re

root = pathlib.Path(".")
expected_version = "1.0.0"
pyproject_path = root / "sdk/python/pyproject.toml"
init_path = root / "sdk/python/src/openwop_client/__init__.py"

pyproject_text = pyproject_path.read_text()


def toml_string(key: str) -> str | None:
    match = re.search(rf"^{re.escape(key)}\s*=\s*\"([^\"]+)\"", pyproject_text, re.MULTILINE)
    return match.group(1) if match else None

init_tree = ast.parse(init_path.read_text())
init_version = None
for node in init_tree.body:
    if isinstance(node, ast.Assign):
        for target in node.targets:
            if isinstance(target, ast.Name) and target.id == "__version__":
                init_version = ast.literal_eval(node.value)


def fail(message: str) -> None:
    raise SystemExit(f"  FAIL: {message}")


project_version = toml_string("version")
project_description = toml_string("description")

if project_version != expected_version:
    fail(f"{pyproject_path} version is {project_version!r}, expected {expected_version!r}")
if init_version != expected_version:
    fail(f"{init_path} __version__ is {init_version!r}, expected {expected_version!r}")
if project_description is None or "production-ready" not in project_description.lower():
    fail(f"{pyproject_path} description should say production-ready")
if '"Development Status :: 5 - Production/Stable"' not in pyproject_text:
    fail(f"{pyproject_path} must use the Production/Stable classifier")
if 'packages = ["src/openwop_client"]' not in pyproject_text:
    fail(f"{pyproject_path} wheel target must include only src/openwop_client")

for path in [
    root / "sdk/python/README.md",
    root / "sdk/python/src/openwop_client/sse.py",
    root / "sdk/go/README.md",
]:
    text = path.read_text()
    stale_markers = ["v0.1", "v0.2", "Pre-1", "scaffold only", "forthcoming"]
    found = [marker for marker in stale_markers if marker in text]
    if found:
        fail(f"{path} contains stale release markers: {', '.join(found)}")

print("  ok: Python project metadata, __version__, wheel package target, and v1.0 docs are aligned.")
PY

GO_MODULE_LINE=$(grep -E "^module " "$SPEC_ROOT/sdk/go/go.mod" || true)
if [[ "$GO_MODULE_LINE" != "module $EXPECTED_GO_MODULE" ]]; then
  echo "  FAIL: sdk/go/go.mod declares '$GO_MODULE_LINE', expected 'module $EXPECTED_GO_MODULE'." >&2
  exit 1
fi
GO_VERSION_LINE=$(grep -E "^go " "$SPEC_ROOT/sdk/go/go.mod" || true)
if [[ "$GO_VERSION_LINE" != "go 1.22" ]]; then
  echo "  FAIL: sdk/go/go.mod declares '$GO_VERSION_LINE', expected 'go 1.22'." >&2
  exit 1
fi
echo "  ok: Go module path and language version are v1.0 release-ready."

echo
echo "=== check-python-go-release-surface OK — Python and Go surfaces are release-ready ==="
