#!/usr/bin/env bash
# openwop-check — one-shot validation of the openwop spec corpus.
#
# Runs server-free checks across all artifacts:
#   1. JSON Schemas compile + fixtures validate (vitest server-free subset)
#   2. TypeScript SDK builds clean (tsc)
#   3. Python SDK passes syntax + import smoke
#   4. Go SDK passes go vet + tests (skipped if Go is not installed)
#   5. OpenAPI lints clean (redocly)
#   6. AsyncAPI validates (asyncapi-cli)
#   7. Generated protocol status + active-doc stale-status guard
#   8. Publish/package audit (metadata + npm/Python/Go release surfaces)
#   9. Security invariants — every protocol-tier MUST-NOT in
#      SECURITY/invariants.yaml has at least one matching public test.
#
# Mirror of .github/workflows/openwop-spec.yml — run this before pushing
# to skip the round-trip CI wait. Exits non-zero on any failure.
#
# Total runtime: ~30s on a warm cache.

set -euo pipefail

SPEC_ROOT="."
NPM_CACHE="${NPM_CONFIG_CACHE:-/tmp/openwop-npm-cache}"

# Stale npm _locks left from killed earlier invocations cause
# `ECOMPROMISED Lock compromised` on the next run. The locks are advisory
# and safe to wipe at gate start; npm regenerates whatever it needs. This
# class of failure was historically much more common when steps 5/6 used
# `npx -y -p @<pkg>@latest` — one network fetch into the cache per gate
# run, racing itself when concurrent runs interleaved (the `@latest`
# resolution forced a remote metadata lookup every time even on a warm
# cache). Since 2026-05-23 those two steps pin to explicit semver
# versions (`@redocly/cli@2.31.4` + `@asyncapi/cli@4.1.1`) — pinned npx
# calls are deterministic: the package tarball is content-addressed in
# the cache by version, so the second invocation hits the cache cleanly
# without any `@latest` round-trip. Vendoring as a repo-root
# devDependency was considered but the AsyncAPI CLI's transitive deps
# (it bundles the entire Studio UI: Next.js + React + Monaco editor +
# ReactFlow) makes `node_modules/` ~100 MB for what's effectively a
# YAML validator — pinning npx is the right cost/benefit point. The
# lock-wipe stays as a belt-and-suspenders safety since other sub-gates
# also call `npx`.
rm -rf "$NPM_CACHE/_locks" 2>/dev/null || true

echo "=== openwop:check — validating $SPEC_ROOT/ ==="
echo

# 1. Conformance package — typecheck + server-free scenarios.
#
# The TypeScript/Python/Go reference SDKs moved to the openwop-sdks repo; their
# build + smoke steps left with them (verified by that repo's scripts/sdks-check.sh).
# The conformance spec-corpus-validity suite has a `describe.skipIf` SDK-helper
# block that reads sdk/typescript|python|go sources — it self-skips here now that
# those sources are absent (the cross-SDK parity it covered is enforced in
# openwop-sdks via check-sdk-parity.mjs).
echo "[1/9] Conformance suite (typecheck + server-free scenarios)..."
(
  cd "$SPEC_ROOT/conformance"
  if [[ ! -d node_modules ]]; then
    echo "  installing conformance deps (one-time)..."
    # `npm ci`, NOT `npm install` (2026-08-18). `npm install` WRITES
    # package-lock.json as a side effect of running the gate: it rewrites the
    # root version line and prunes entries, so a contributor whose node_modules
    # happened to be absent would find a lockfile diff they did not make, and
    # it lands in whoever's PR runs the check next. Reported independently by
    # two sessions, each of which reverted it by hand.
    #
    # `npm ci` installs FROM the lockfile and never writes to it (verified:
    # byte-identical after a run). It also fails loudly if the lock and the
    # manifest genuinely disagree, which is the behaviour a gate should have —
    # the same lockfile-respecting-install discipline `conformance-certification.md`
    # §"A bundle attributes to a BUILD" now recommends to hosts, applied to our
    # own gate. Falls back to `install` only when there is no lockfile to honour.
    if [[ -f package-lock.json ]]; then
      npm_config_cache="$NPM_CACHE" npm ci --no-audit --no-fund --prefer-offline >/dev/null
    else
      npm_config_cache="$NPM_CACHE" npm install --no-audit --no-fund --prefer-offline >/dev/null
    fi
  fi
  npx tsc --noEmit
  npx vitest run \
    src/scenarios/fixtures-valid.test.ts \
    src/scenarios/spec-corpus-validity.test.ts \
    src/scenarios/ai-envelope-shape.test.ts \
    src/scenarios/aiproviders-speechsynth-shape.test.ts \
    src/scenarios/artifact-type-pack-manifest-validation.test.ts \
    src/scenarios/artifact-schema-compile-bounded.test.ts \
    src/scenarios/chat-card-pack-manifest-validation.test.ts \
    src/scenarios/form-content-packs.test.ts \
    src/scenarios/x-openwop-form-pack-manifest.test.ts \
    src/scenarios/anonymous-actor-shape.test.ts
)
echo

# 2. OpenAPI lint via redocly. Uses a PINNED version (not @latest) — the
# `@latest` resolution forced a remote metadata lookup every gate run,
# which is what raced the npm cache. The pinned semver tarball is
# content-addressed; the second invocation hits the cache deterministically.
echo "[2/9] OpenAPI 3.1 (redocly lint)..."
(
  cd "$SPEC_ROOT/api"
  npm_config_cache="$NPM_CACHE" npx -y -p @redocly/cli@2.31.4 redocly lint openapi.yaml
)
echo

# 3. AsyncAPI validate. Same pinning as step 2. `@asyncapi/cli@4.1.1` is
# the last release compatible with Node 22 (5.x requires Node 24+).
echo "[3/9] AsyncAPI 3.1 (asyncapi validate)..."
npm_config_cache="$NPM_CACHE" npx -y -p @asyncapi/cli@4.1.1 asyncapi validate "$SPEC_ROOT/api/asyncapi.yaml"
echo

# 7. Generated protocol status — catches stale corpus counts, RFC status
# drift, SDK parity-count drift, and active-doc stale phrases that should not
# survive outside archived historical docs. Plus the required-property
# typo-catcher (replaces redocly's flawed walker — see api/redocly.yaml
# comment for context).
#
# The RFC 0013 expansion-algorithm drift guard (conformance/ canonical vs the
# zero-deps mirror in the in-memory host) moved to conformance-soak.yml, which
# checks out openwop-examples for the host source — the host no longer lives in
# this repo, so the guard can't run in this server-free local gate.
echo "[4/9] Generated protocol status..."
node "$SPEC_ROOT/scripts/generate-protocol-status.mjs" --check
# RFC 0155 §B — the core-standard manifest is DERIVED, so it can go stale the
# moment the corpus moves. Checking it here is the "generated from or checked
# against" half of §B; without it the manifest would assert a floor nobody runs.
node "$SPEC_ROOT/scripts/generate-core-standard-manifest.mjs" --check
# RFC 0149 §A/§Conformance — the canonical resolved operation-path manifest SDK
# repositories consume is DERIVED from api/openapi.yaml; stale = SDKs consuming
# paths the contract no longer resolves.
node "$SPEC_ROOT/scripts/generate-operation-path-manifest.mjs" --check
node "$SPEC_ROOT/scripts/generate-extension-registry-coverage.mjs" --check
node "$SPEC_ROOT/scripts/check-required-properties-defined.mjs"
node "$SPEC_ROOT/scripts/check-capability-declaration-classes.mjs"
# COMPATIBILITY.md §7 — the deprecation register is an index of deprecations the RFC
# process already made; this keeps every cited source carrying its annotation.
node "$SPEC_ROOT/scripts/check-deprecations.mjs"
# SDK parity (OpenAPI operations <-> per-SDK typed helpers) moved to the
# openwop-sdks repo (sdk/ extracted 2026-06; verified by that repo's
# scripts/check-sdk-parity.mjs against its vendored api/openapi.yaml).
# Backend dep-graph sanity moved to the openwop-app repo (apps/workflow-engine
# extracted 2026-06; verified there by its own CI against its package.json).
# Pack registry signature/signer/prompt-ref validation moved to the openwop-registry
# repo (packs/ + registry/ extracted 2026-06; verified by that repo's
# scripts/registry-check.sh). The spec corpus keeps prose honest about packs via the
# live-fetching scripts/check-doc-pack-claims.mjs (run from examples CI), not by
# re-validating in-tree pack tarballs that no longer live here.
# External-audit remediation gate — once the audit report lands and findings are
# recorded in SECURITY/external-audit-findings.json, an OPEN high/critical finding
# MUST block the gate (and thus any release / standardization claim). Passes on
# the pre-audit empty-tracker state. Mechanizes the audit's "close high/critical
# findings before standardizing" requirement (cf. docs/AUDIT-RESPONSE).
node "$SPEC_ROOT/scripts/check-audit-findings.mjs"
# CF-11 out-of-band audit-checkpoint verifier regression guard. The verifier
# (scripts/verify-audit-checkpoints.mjs) is a security-relevant tamper-detection
# tool; pin its behavior against committed sample bundles so a regression is
# caught at the spec gate, not just in the postgres host's own test. MUST accept
# a valid bundle (exit 0) and reject a tampered one (exit 1).
if node "$SPEC_ROOT/scripts/verify-audit-checkpoints.mjs" "$SPEC_ROOT/conformance/audit-export-samples/valid.json" >/dev/null 2>&1; then
  echo "  ok: audit-checkpoint verifier accepts the valid sample bundle"
else
  echo "  FAIL: verify-audit-checkpoints.mjs rejected conformance/audit-export-samples/valid.json (expected exit 0)" >&2
  exit 1
fi
if node "$SPEC_ROOT/scripts/verify-audit-checkpoints.mjs" "$SPEC_ROOT/conformance/audit-export-samples/tampered.json" >/dev/null 2>&1; then
  echo "  FAIL: verify-audit-checkpoints.mjs ACCEPTED the tampered sample bundle (expected non-zero exit — tamper not detected)" >&2
  exit 1
else
  echo "  ok: audit-checkpoint verifier rejects the tampered sample bundle"
fi
# Vendored-fixtures drift check moved to the openwop-app repo (apps/workflow-engine
# extracted 2026-06; it vendors conformance/fixtures into its own image + CI).
echo

# 5. Publish-metadata + package-content audit — catches placeholder URLs,
# package posture drift, and package content leaks. Scoped to the conformance
# suite now (the SDKs' publish metadata + the python/go release-surface check
# moved to the openwop-sdks repo with sdk/).
echo "[5/9] Publish metadata + package contents..."
"$(dirname "$0")/openwop-check-publish-metadata.sh"
"$(dirname "$0")/check-npm-pack-contents.sh"
echo

# 6. Security invariants — every protocol-tier MUST-NOT in
# SECURITY/invariants.yaml has at least one matching public test.
echo "[6/9] Security invariants..."
"$(dirname "$0")/check-security-invariants.sh"
# RFC 0156 — the hand-typed tallies (invariant counts in SECURITY.md + README,
# scenario-file counts in conformance/README) must agree with the tree; the
# part of "documents agree" that is a number is checked here, not asserted.
node "$(dirname "$0")/check-doc-tallies.mjs"
# The bootstrap-waiver ledger must not drift from the tree. It reached 26 rows
# against 41 derived before this gate existed — the twenty-one absent included
# RFC 0147 and all three Workstream 1-3 children, i.e. the whole program spine
# was missing from the surface that exists to make waivers auditable.
node "$(dirname "$0")/check-waiver-ledger.mjs"
# RFC 0156 §F — the assurance manifest is current AND no public surface carries
# a claim token the manifest does not permit (RFC 0147 §A claim table).
node "$(dirname "$0")/generate-assurance-status.mjs" --check
echo

# 7. Published-layout collection — every scenario must LOAD in the tarball
# layout, not just in a repo checkout. Steps 1-6 all run with spec/v1, RFCS/
# and docs/ sitting above the conformance package; the published package has
# none of those, and a scenario that reads through them throws at import for
# every npm consumer while staying green here. Six did.
echo "[7/9] Published-layout collection..."
node "$(dirname "$0")/check-published-layout.mjs"
echo

# 8. Published-version identity — does the version number still identify the
# contents? `conformance/package.json` read 1.138.1 while npm served a DIFFERENT
# 1.138.1: fifteen files of drift under one version number, and nothing detected
# it because the publish step's guard asked whether the version EXISTED, not
# whether it was THIS. A version-number comparison standing in for a content
# comparison, whose only symptom was a publish step printing "already on npm"
# and exiting 0 — which is exactly what a correct no-op prints.
#
# Network-dependent, so it reports UNKNOWN (not a pass) when the registry is
# unreachable and still exits 0 for offline work. The publish preflight passes
# --require-network, where UNKNOWN is a hard stop.
# 8. Advertised versions — does the README's published-artifacts line match what
# the registries actually serve? It advertised @openwop/openwop v1.6.1 (npm had
# 1.8.0), openwop-client v1.5.0 (PyPI had 1.6.0), and the conformance suite
# v1.73.0 (npm had 1.139.0 — stale by 66 minors, twice on one line). Only the Go
# module was right. Found by a downstream consumer syncing openwop.dev, which had
# already shipped one of those numbers publicly on the strength of this line being
# authoritative. Network-dependent, so UNKNOWN is tolerated locally and fatal in CI.
echo "[8/9] Advertised package versions..."
node "$(dirname "$0")/check-advertised-versions.mjs"
echo

echo "[9/9] Published-version identity..."
node "$(dirname "$0")/check-published-suite-identity.mjs"
echo

# Advisory tail — the gate above validated the WORKING TREE. Nothing so far
# proves the tree is what you are about to push, and the gap between them is
# exactly one `git add`. Diagnosis from openwop-app-1: "the gate proves the tree
# is good, and nothing proves the tree is what you pushed."
node "$(dirname "$0")/check-tree-matches-head.mjs"
echo

echo "=== openwop:check OK — spec corpus is internally consistent ==="
