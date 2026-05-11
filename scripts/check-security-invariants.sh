#!/usr/bin/env bash
# check-security-invariants — verify every protocol-tier security
# invariant in SECURITY/invariants.yaml has at least one matching test
# file in the public repo.
#
# Reference-impl-tier invariants are advisory at this gate; they may have
# an empty tests list when verification is host-specific and lives outside
# the public protocol repository.
#
# Architecture review #8 rejected free-form Markdown parsing of threat
# models — this script consumes the YAML index instead. The YAML is the
# single source of truth for invariant → test mapping; threat models
# are the human-readable documentation.
#
# Adding a new invariant requires:
#   1. Adding it to the threat model with a unique ID.
#   2. Adding an entry to SECURITY/invariants.yaml.
#   3. For protocol-tier invariants: ensuring at least one test file
#      glob resolves in the public repo.
#   4. This script verifies the invariant on every push.
#
# Exit codes:
#   0 — all protocol-tier invariants have at least one matching test
#   1 — one or more protocol-tier invariants have zero matching tests
#   2 — invariants.yaml is malformed or missing
#
# Total runtime: ~1s.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INVARIANTS_FILE="$REPO_ROOT/SECURITY/invariants.yaml"

if [[ ! -f "$INVARIANTS_FILE" ]]; then
  echo "ERROR: SECURITY/invariants.yaml not found at $INVARIANTS_FILE" >&2
  exit 2
fi

echo "=== check-security-invariants — verifying $INVARIANTS_FILE ==="
echo

# Parse the YAML using node (every CI environment that runs this repo
# already has Node available; avoid a Python or yq dependency).
PARSE_SCRIPT='
const fs = require("fs");
const path = require("path");
const yamlText = fs.readFileSync(process.argv[1], "utf8");

// Minimal YAML parser for our shape — we only need:
//   - id, tier, severity, threat_model fields (scalars)
//   - tests: list of strings
// Avoid pulling in a full YAML library (no node_modules at this layer).
// The shape is well-defined and the file is generated, so a
// purpose-built parser is fine.
function parseInvariants(text) {
  const lines = text.split("\n");
  const invariants = [];
  let current = null;
  let inTests = false;
  let inNote = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("#") || line.trim() === "" || line === "---") continue;
    if (line.startsWith("invariants:")) continue;
    const itemMatch = line.match(/^  - id: (.+)$/);
    if (itemMatch) {
      if (current) invariants.push(current);
      current = { id: itemMatch[1].trim(), tests: [] };
      inTests = false;
      inNote = false;
      continue;
    }
    if (!current) continue;
    const fieldMatch = line.match(/^    (\w+): ?(.*)$/);
    if (fieldMatch) {
      const [, key, value] = fieldMatch;
      inTests = false;
      inNote = false;
      if (key === "tests") {
        if (value === "[]") {
          current.tests = [];
        } else {
          inTests = true;
        }
      } else if (key === "note") {
        inNote = true;
      } else {
        current[key] = value.trim();
      }
      continue;
    }
    if (inTests) {
      const testMatch = line.match(/^      - (.+)$/);
      if (testMatch) current.tests.push(testMatch[1].trim());
      continue;
    }
    // note continuation lines or other free text — ignore
  }
  if (current) invariants.push(current);
  return invariants;
}

const invariants = parseInvariants(yamlText);
console.log(JSON.stringify(invariants));
'

INVARIANTS_JSON=$(node -e "$PARSE_SCRIPT" "$INVARIANTS_FILE")

# Walk each invariant; for protocol-tier, check that at least one
# test glob resolves to an existing file.
TOTAL=0
PROTOCOL=0
REFERENCE_IMPL=0
ADVISORY=0
FAILED=0

# Use a temp file to track failures since we're piping through node.
FAIL_LOG=$(mktemp)
trap 'rm -f "$FAIL_LOG"' EXIT

# Use node to process the JSON since bash array-of-objects is awkward.
PROCESS_SCRIPT='
const path = require("path");
const fs = require("fs");
const repoRoot = process.argv[1];
const invariants = JSON.parse(process.argv[2]);
const failLog = process.argv[3];
const failHandle = fs.openSync(failLog, "w");

let total = 0, protocol = 0, refImpl = 0, advisory = 0, failed = 0;

function globMatches(repoRoot, pattern) {
  // Minimal glob: support `*` within a single segment only. We do not
  // need full POSIX glob — the patterns in invariants.yaml are simple.
  if (!pattern.includes("*")) {
    return fs.existsSync(path.join(repoRoot, pattern));
  }
  // Walk the directory containing the wildcard.
  const segments = pattern.split("/");
  let basePath = repoRoot;
  let i = 0;
  while (i < segments.length && !segments[i].includes("*")) {
    basePath = path.join(basePath, segments[i]);
    i++;
  }
  if (!fs.existsSync(basePath) || !fs.statSync(basePath).isDirectory()) return false;
  if (i >= segments.length) return true;
  const remainder = segments.slice(i).join("/");
  // Convert simple glob to RegExp (escape literals; * → [^/]*).
  const regex = new RegExp(
    "^" + remainder.replace(/[.+?^${}()|[\\]\\\\]/g, "\\\\$&").replace(/\\*/g, "[^/]*") + "$"
  );
  // For multi-segment patterns, recurse one level.
  function walk(dir, relParts) {
    if (!fs.existsSync(dir)) return false;
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      const full = path.join(dir, entry);
      const rel = relParts.concat(entry).join("/");
      if (regex.test(rel)) return true;
      if (fs.statSync(full).isDirectory()) {
        if (walk(full, relParts.concat(entry))) return true;
      }
    }
    return false;
  }
  return walk(basePath, []);
}

for (const inv of invariants) {
  total++;
  if (inv.tier === "protocol") protocol++;
  else if (inv.tier === "reference-impl") refImpl++;
  else if (inv.tier === "advisory") advisory++;

  const tests = inv.tests || [];
  if (inv.tier !== "protocol") continue;

  // Protocol-tier: at least one test glob must resolve.
  let anyResolves = false;
  for (const glob of tests) {
    if (globMatches(repoRoot, glob)) {
      anyResolves = true;
      break;
    }
  }
  if (!anyResolves) {
    failed++;
    fs.writeSync(failHandle, "  FAIL: " + inv.id + " (severity=" + inv.severity + ") — no test file matches any of: " + tests.join(", ") + "\n");
  }
}

fs.closeSync(failHandle);
process.stdout.write(JSON.stringify({ total, protocol, refImpl, advisory, failed }));
'

STATS=$(node -e "$PROCESS_SCRIPT" "$REPO_ROOT" "$INVARIANTS_JSON" "$FAIL_LOG")
TOTAL=$(echo "$STATS" | node -e 'let d=""; process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).total))')
PROTOCOL=$(echo "$STATS" | node -e 'let d=""; process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).protocol))')
REFERENCE_IMPL=$(echo "$STATS" | node -e 'let d=""; process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).refImpl))')
ADVISORY=$(echo "$STATS" | node -e 'let d=""; process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).advisory))')
FAILED=$(echo "$STATS" | node -e 'let d=""; process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).failed))')

echo "Invariants tracked:"
echo "  total:          $TOTAL"
echo "  protocol-tier:  $PROTOCOL  (verified at this gate)"
echo "  reference-impl: $REFERENCE_IMPL  (verified by reference impl's CI)"
echo "  advisory:       $ADVISORY  (defense-in-depth, no hard MUST)"
echo

if [[ "$FAILED" -gt 0 ]]; then
  echo "FAILED protocol-tier invariants ($FAILED):"
  cat "$FAIL_LOG"
  echo
  echo "=== check-security-invariants FAILED ==="
  echo
  echo "Each protocol-tier invariant in SECURITY/invariants.yaml MUST have"
  echo "at least one test file glob that resolves to an existing file."
  echo "Either:"
  echo "  1. Add a conformance scenario covering the invariant."
  echo "  2. Update the invariant's 'tests:' globs to point at an existing test."
  echo "  3. Demote the invariant to reference-impl tier (and ensure the"
  echo "     reference impl's CI verifies it)."
  echo
  exit 1
fi

echo "=== check-security-invariants OK — all protocol-tier invariants have test coverage ==="
