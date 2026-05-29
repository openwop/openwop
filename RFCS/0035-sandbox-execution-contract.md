# RFC 0035: Sandbox execution contract for pack-loaded typeIds

| Field | Value |
|---|---|
| **RFC** | 0035 |
| **Title** | Sandbox execution contract for pack-loaded typeIds |
| **Status** | `Active` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-21 |
| **Updated** | 2026-05-21 (Draft → Active same-day: `capabilities.sandbox` block landed in `schemas/capabilities.schema.json` with the 5 fields (supported + isolationModel anyOf + allowedHostCalls + memoryLimitBytes + wallClockLimitMs); `spec/v1/host-capabilities.md` §"Sandbox execution contract (RFC 0035)" added with the 8-row failure-mode invariant table + capability advertisement + error-code table; `spec/v1/rest-endpoints.md` §"Common error codes" gains the 4 new codes (`sandbox_memory_exceeded`, `sandbox_timeout`, `sandbox_capability_denied`, `sandbox_escape_attempt`). The 8 `node-pack-sandbox-*` rows in `SECURITY/invariants.yaml` stay at `tier: reference-impl` for now; graduation to `tier: protocol` is gated on a sandbox-executing reference host advertising + the 8 matching conformance scenarios per §D. Path to `Accepted`: first non-steward host advertises + passes the 8 scenarios.) |
| **Affects** | `spec/v1/host-capabilities.md` (adds §"Sandbox execution contract") · `schemas/capabilities.schema.json` (adds `capabilities.sandbox` block) · `SECURITY/invariants.yaml` (graduates 8 `node-pack-sandbox-*` rows from `reference-impl` to `protocol` tier) · 8 new conformance scenarios · reference hosts (NEW: `examples/hosts/wasm-sandbox/` OR Postgres extension) · `INTEROP-MATRIX.md` · CHANGELOG |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

Define a normative contract for what isolation guarantees a host makes when it loads a pack-published typeId (per `node-packs.md`) and executes its handler logic. Today, `SECURITY/invariants.yaml` has 8 `node-pack-sandbox-*` rows at `tier: reference-impl` with a `non_testability_rationale: "no reference host executes pack-loaded typeIds in a sandbox"` — meaning **the protocol formally requires sandbox semantics that no implementation actually provides.** This RFC defines the wire-shape advertisement, the isolation model, and the failure-mode invariants so a host that wires sandbox execution can mechanically demonstrate compliance.

## Motivation

Per `docs/KNOWN-LIMITS.md:32` and the external standards-readiness review 2026-05-21 finding (5): "no reference host executes pack-loaded typeIds in a sandbox. Before endorsement, I'd require sandbox proof, telemetry/debug-bundle secret-leakage conformance, and external review." The 8 `node-pack-sandbox-*` invariants exist as protocol claims (loaded packs MUST NOT escape the host's process context, MUST NOT access the host filesystem outside an advertised root, MUST NOT exfiltrate env vars, MUST NOT bypass capability gates, etc.) — but they're verified host-internally only on the Postgres pack-consumer's install-time security checks (PACK-1/PACK-2), which are necessary but not sufficient for runtime claims.

This is the highest-leverage SECURITY gap in the corpus: every published pack the host loads runs with full host process privileges today, with the protocol's invariants depending on a sandbox that doesn't exist. Closing this requires both (a) a spec contract that defines what a compliant sandbox looks like and (b) at least one reference implementation.

## Proposal

### §A — `capabilities.sandbox` block (normative)

Add to `schemas/capabilities.schema.json`:

```diff
+  "sandbox": {
+    "type": "object",
+    "additionalProperties": false,
+    "required": ["supported", "isolationModel"],
+    "properties": {
+      "supported": {
+        "type": "boolean",
+        "description": "Host advertises that pack-loaded typeIds execute inside an isolation boundary that meets the contract in spec/v1/host-capabilities.md §'Sandbox execution contract'. Defaults to false — a host that does NOT sandbox MUST advertise false (or omit) and MUST refuse to load any pack whose manifest declares peerDependencies.host.sandbox: required."
+      },
+      "isolationModel": {
+        "type": "string",
+        "anyOf": [
+          { "enum": ["wasm", "process", "container", "vm"] },
+          { "pattern": "^x-host-[a-z][a-z0-9-]*-[a-z][a-z0-9-]*$" }
+        ],
+        "description": "Categorical isolation model. 'wasm' = WebAssembly sandbox with explicit host imports (e.g., Wasmtime, Wasmer). 'process' = OS process boundary with restricted syscalls (e.g., gVisor, seccomp, Landlock). 'container' = container runtime boundary (e.g., Firecracker microVM). 'vm' = full VM. Vendor-specific isolation models advertise a host-extension namespace string matching `^x-host-<host>-<key>$` per `spec/v1/host-extensions.md` §'Canonical prefixes' (e.g., `x-host-myndhyve-cloud-run-gvisor`); the matching documentation MUST live at the host's discovery doc."
+      },
+      "allowedHostCalls": {
+        "type": "array",
+        "items": { "type": "string" },
+        "description": "Whitelist of host-call surfaces that sandboxed code MAY invoke. Identifiers from the spec-reserved host.* capability set or x-host-<host>-<key>. Empty array = pure compute only (no I/O). Used by conformance to verify the sandbox refuses unlisted calls."
+      },
+      "memoryLimitBytes": {
+        "type": "integer",
+        "minimum": 1048576,
+        "description": "Per-invocation memory cap. Host MUST enforce; exceeding fails the node with sandbox_memory_exceeded."
+      },
+      "wallClockLimitMs": {
+        "type": "integer",
+        "minimum": 100,
+        "description": "Per-invocation wall-clock cap. Host MUST enforce; exceeding fails the node with sandbox_timeout."
+      }
+    }
+  }
```

### §B — Failure-mode invariants (normative)

When `capabilities.sandbox.supported: true`, the host MUST enforce the 8 invariants enumerated below. The table maps each invariant to (a) the canonical SECURITY invariant ID in `SECURITY/invariants.yaml` and (b) the conformance scenario that exercises it (canonical scenario naming `sandbox-*.test.ts` per `@openwop/openwop-conformance@1.4.0`):

| # | Normative requirement | SECURITY invariant ID | Conformance scenario |
|---|---|---|---|
| 1 | Sandbox code MUST NOT read or write files outside the host-advertised sandbox root. | `node-pack-sandbox-fs-gated` | `sandbox-no-host-fs-escape.test.ts` |
| 2 | Host environment variables MUST NOT be visible to sandbox code unless the host has explicitly forwarded them via an `allowedHostCalls` entry. | `node-pack-sandbox-no-env` | `sandbox-no-host-env-leak.test.ts` |
| 3 | Sandbox code MUST NOT initiate network requests unless `host.fetch` (or equivalent) is in `allowedHostCalls`. | `node-pack-sandbox-network-gated` | `sandbox-no-network-escape.test.ts` |
| 4 | Sandbox code MUST NOT spawn host processes, fork, or call exec-family syscalls. | `node-pack-sandbox-no-process` | `sandbox-no-host-process-escape.test.ts` |
| 5 | Exceeding `memoryLimitBytes` MUST fail the node with `error.code: "sandbox_memory_exceeded"`. | `node-pack-sandbox-memory-cap` | `sandbox-memory-cap.test.ts` (+ `wasm-pack-memory-cap.test.ts` for the WASM-runtime path) |
| 6 | Exceeding `wallClockLimitMs` MUST fail the node with `error.code: "sandbox_timeout"`. | `node-pack-sandbox-timeout` | `sandbox-timeout-cap.test.ts` |
| 7 | Sandbox code MUST NOT bypass the host's capability-advertisement check; calls to undeclared host capabilities MUST fail closed with `error.code: "sandbox_capability_denied"`. | (paired with `node-pack-sandbox-no-eval` at `tier: reference-impl` — the runtime-agnostic invariant has scenario coverage even though the SECURITY row stays exempt) | `sandbox-capability-gate-respected.test.ts` |
| 8 | Sandbox code from pack A MUST NOT mutate state visible to pack B inside the same host process. | `node-pack-sandbox-isolated-context` | `sandbox-no-cross-pack-mutation.test.ts` |

All 8 SECURITY invariants stay at `tier: reference-impl` as of 2026-05-22. The `tests:` globs on each row point at the right scenario file, but the behavioral assertion inside each file is `it.todo` — no host has wired a sandbox-executing runtime against which the probes can run, so promoting to `tier: protocol` would weaken the gate's "verified here" promise. Graduation happens per-row when the matching scenario's `it.todo` flips to a real behavioral assertion against a host advertising `capabilities.sandbox.supported: true`. `node-pack-sandbox-no-eval` is the most likely permanent exemption — `eval()` semantics are JS-runtime-specific and don't apply to wasmtime / nsjail — but the other 7 invariants are general enough that any sandbox-executing host can wire probes against them.

### §C — Error codes (additive to `rest-endpoints.md` §"Common error codes")

- `sandbox_memory_exceeded` — Sandbox invocation exceeded `memoryLimitBytes`. `details.requestedBytes` MAY be present.
- `sandbox_timeout` — Sandbox invocation exceeded `wallClockLimitMs`.
- `sandbox_capability_denied` — Sandbox code called a host capability not in `allowedHostCalls`. `details.requestedCapability` MUST be set.
- `sandbox_escape_attempt` — Sandbox detected an explicit escape attempt (a system call from a forbidden list). `details.escapeKind` SHOULD be set.

### §D — Conformance scenarios (NEW)

`conformance/src/scenarios/sandbox-*.test.ts` — 8 new behavioral scenarios, one per invariant. Each is capability-gated on `capabilities.sandbox.supported: true` AND uses a deliberately-malicious test fixture published under the `vendor.openwop.misbehaving-sandbox` pack scope (synthetic; not for production registry).

Test approach: register a workflow that invokes the misbehaving typeId, expect terminal `failed` with the matching `sandbox_*` error code, verify no escape-attempt artifact survived on the host filesystem / env / process tree.

## Compatibility

**Additive.** Hosts that don't advertise `capabilities.sandbox` continue exactly as today; the 8 invariants stay at `tier: reference-impl` with the existing `non_testability_rationale`. Hosts that DO advertise opt into the contract + the conformance gate.

The promotion from `reference-impl` to `protocol` tier in `SECURITY/invariants.yaml` is gated on this RFC reaching `Accepted` AND at least one reference host advertising — per the RFC 0001 promotion criterion.

## Conformance

8 new scenarios per §D. Each is capability-gated; each requires the `vendor.openwop.misbehaving-sandbox` synthetic fixture to be loaded into the host's pack registry. Hosts that don't advertise sandbox soft-skip cleanly.

## Alternatives considered

1. **Mandate a specific isolation model (e.g., WASM).** Rejected — different hosts have different deployment constraints (a Postgres-extension host benefits from process isolation; a serverless host benefits from container isolation). The `isolationModel` enum allows honest advertisement without dictating the implementation.
2. **Treat sandbox as a `host.sandbox` capability under `host-capabilities.md`.** Rejected — sandbox is a meta-capability (it governs how OTHER host capabilities are exposed to pack code), so it lives at the top-level `capabilities.sandbox` block rather than as a sibling of `host.fs` / `host.kvStorage` / etc.
3. **Defer to runtime-specific sandboxing (Lambda's process model, Cloud Run's gVisor).** Rejected — those provide some of the invariants but not all (cross-pack mutation isn't addressed by Lambda's isolation; capability-gate enforcement isn't addressed by gVisor). The protocol-level claims need protocol-level testing.

## Unresolved questions

1. **Sandbox introspection seam for debug-bundle.** Should a debug-bundle export include sandbox-allocation traces? Recommend deferring to a follow-up RFC; the core 8 invariants don't require it.
2. **Per-tenant sandbox boundary.** Cross-tenant invariant CTI-1 already exists in `agent-memory.md`; should this RFC restate it for sandbox boundary? Likely yes — defer the prose decision to spec review.
3. **WASM ABI version pinning.** RFC 0008 already specifies WASM ABI version negotiation. This RFC's `isolationModel: "wasm"` should cross-reference; deferred to implementation.

## Acceptance criteria

- [ ] Spec text merged (this file).
- [x] `schemas/capabilities.schema.json` extended per §A.
- [x] `spec/v1/host-capabilities.md` extended with §"Sandbox execution contract" per §B + §C.
- [x] `spec/v1/rest-endpoints.md` §"Common error codes" gains 4 new codes per §C.
- [x] 8 conformance scenario FILES land in `conformance/src/scenarios/` — canonical names `sandbox-{capability-gate-respected, memory-cap, no-cross-pack-mutation, no-host-env-leak, no-host-fs-escape, no-host-process-escape, no-network-escape, timeout-cap}.test.ts`. Shipped in `@openwop/openwop-conformance@1.4.0` (2026-05-22). The advertisement-shape probes are real assertions; the behavioral assertions are `it.todo` placeholders (NO host has wired a sandbox-executing runtime yet, so no real probe is possible).
- [x] At least one reference host implements + advertises `capabilities.sandbox` **at the wire-contract level**. The workflow-engine sample host ships a `node:vm` MVP (`apps/workflow-engine/backend/typescript/src/routes/testSeam.ts` §"sandbox-vm MVP"; advertised under `OPENWOP_TEST_SANDBOX_MVP=true` as `isolationModel: 'vm'`) that drives every §B failure-mode probe through `POST /v1/host/sample/test/sandbox-invoke`. **Verified 2026-05-29:** `conformance/src/scenarios/sandbox-mvp-behavior.test.ts` 10/10 + the three advertisement-shape probes pass non-vacuously under `OPENWOP_REQUIRE_BEHAVIOR=true` (fs-escape / env-leak / network-escape / process-escape / timeout / memory / cross-pack-isolation / capability-gate-denied, plus the `well-behaved.echo` + `well-behaved.host-fetch` positive controls). **Caveat — this does NOT satisfy the next item.** `node:vm` is a wire-contract demonstrator, not a production isolation boundary (node:vm is escapable by design); it proves the §A advertisement shape, the §C error catalog, and the seam are implementable and conformance-testable, but the SECURITY-invariant graduation below requires a *real-isolation* host. The originally-listed paths — (a) `examples/hosts/wasm-sandbox/`, (b) `wasmtime-postgres` — remain the real-isolation routes. (Path-to-Accepted unchanged: see final line.)
- [ ] `SECURITY/invariants.yaml` 8 `node-pack-sandbox-*` rows graduate from `reference-impl → protocol` with `tests:` globs pointing at the scenarios. NOT YET graduated. The scenarios point at the right files but their behavioral assertions are `it.todo` — promoting to protocol tier would mean the SECURITY-tier "verified at this gate" promise reduced to "the test file exists," which would weaken the gate. Graduation happens when a sandbox-executing host wires the behavioral assertions to real probes.
- [ ] `INTEROP-MATRIX.md` row updated for the advertising host. (Will land alongside the reference-host implementation that advertises `capabilities.sandbox`.)
- [x] CHANGELOG entry under `[Unreleased]` (conformance suite v1.4.0 CHANGELOG documents the 8 scenario shapes + naming-convention reconciliation note).

Path to `Active → Accepted`: at least one **non-steward** host advertises the capability AND passes the 8 scenarios. **As of 2026-05-29 there is no candidate.** The sole declared non-steward adopter (MyndHyve) has formally opted out of RFC 0035 — see `INTEROP-MATRIX.md` §"Deferred / opt-out (MyndHyve round-3)", rationale *no-untrusted-packs*: its host does not execute untrusted pack code, so a sandbox boundary is not load-bearing for it (an honest opt-out, not a gap). RFC 0035 therefore stays `Active` until a non-steward host that *does* run untrusted pack code in a real-isolation sandbox (wasm/process/container) advertises `capabilities.sandbox.supported: true` and passes the §B probes. The steward `node:vm` MVP is the reference the wire contract is proven against; by construction it cannot satisfy the non-steward bar, and the `SECURITY/invariants.yaml` promotion (`reference-impl → protocol`) stays blocked on that same gate.

## References

- `docs/KNOWN-LIMITS.md:32` (the row this RFC closes)
- `SECURITY/invariants.yaml` `node-pack-sandbox-*` rows (8 rows, currently `tier: reference-impl`)
- `spec/v1/node-packs.md` §"Manifest format" (where `peerDependencies.host.sandbox` would be declared)
- `RFCS/0008-wasm-abi.md` (WASM ABI version negotiation; pairs with `isolationModel: "wasm"`)
- `spec/v1/host-extensions.md` §"Canonical prefixes" (test fixture namespace)
- External standards-readiness review 2026-05-21 — finding (5)
