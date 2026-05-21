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

Per `docs/KNOWN-LIMITS.md:32` and the Google-acceptance review 2026-05-21 finding (5): "no reference host executes pack-loaded typeIds in a sandbox. Before endorsement, I'd require sandbox proof, telemetry/debug-bundle secret-leakage conformance, and external review." The 8 `node-pack-sandbox-*` invariants exist as protocol claims (loaded packs MUST NOT escape the host's process context, MUST NOT access the host filesystem outside an advertised root, MUST NOT exfiltrate env vars, MUST NOT bypass capability gates, etc.) — but they're verified host-internally only on the Postgres pack-consumer's install-time security checks (PACK-1/PACK-2), which are necessary but not sufficient for runtime claims.

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

When `capabilities.sandbox.supported: true`, the host MUST enforce the 8 invariants currently at `SECURITY/invariants.yaml` `node-pack-sandbox-*`:

1. `node-pack-sandbox-no-host-fs-escape` — sandbox code MUST NOT read or write files outside the host-advertised sandbox root.
2. `node-pack-sandbox-no-host-env-leak` — host environment variables MUST NOT be visible to sandbox code unless the host has explicitly forwarded them via an `allowedHostCalls` entry.
3. `node-pack-sandbox-no-network-escape` — sandbox code MUST NOT initiate network requests unless `host.fetch` (or equivalent) is in `allowedHostCalls`.
4. `node-pack-sandbox-no-host-process-escape` — sandbox code MUST NOT spawn host processes, fork, or call exec-family syscalls.
5. `node-pack-sandbox-memory-cap` — exceeding `memoryLimitBytes` MUST fail the node with `error.code: "sandbox_memory_exceeded"`.
6. `node-pack-sandbox-timeout-cap` — exceeding `wallClockLimitMs` MUST fail the node with `error.code: "sandbox_timeout"`.
7. `node-pack-sandbox-capability-gate-respected` — sandbox code MUST NOT bypass the host's capability-advertisement check; calls to undeclared host capabilities MUST fail closed.
8. `node-pack-sandbox-no-cross-pack-mutation` — sandbox code from pack A MUST NOT mutate state visible to pack B inside the same host process.

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
- [ ] `schemas/capabilities.schema.json` extended per §A.
- [ ] `spec/v1/host-capabilities.md` extended with §"Sandbox execution contract" per §B + §C.
- [ ] `spec/v1/rest-endpoints.md` §"Common error codes" gains 4 new codes per §C.
- [ ] 8 new conformance scenarios per §D land in `conformance/src/scenarios/`.
- [ ] At least one reference host implements + advertises `capabilities.sandbox`. Two viable paths: (a) NEW `examples/hosts/wasm-sandbox/` directory; (b) Postgres reference host extension using `wasmtime-postgres`. Either passes the 8 new scenarios end-to-end.
- [ ] `SECURITY/invariants.yaml` 8 `node-pack-sandbox-*` rows graduate to `tier: protocol` with `public_tests` globs.
- [ ] `INTEROP-MATRIX.md` row updated for the advertising host.
- [ ] CHANGELOG entry under `[Unreleased]`.

Path to `Active → Accepted`: at least one non-steward host advertises the capability AND passes the 8 scenarios.

## References

- `docs/KNOWN-LIMITS.md:32` (the row this RFC closes)
- `SECURITY/invariants.yaml` `node-pack-sandbox-*` rows (8 rows, currently `tier: reference-impl`)
- `spec/v1/node-packs.md` §"Manifest format" (where `peerDependencies.host.sandbox` would be declared)
- `RFCS/0008-wasm-abi.md` (WASM ABI version negotiation; pairs with `isolationModel: "wasm"`)
- `spec/v1/host-extensions.md` §"Canonical prefixes" (test fixture namespace)
- Google-acceptance review 2026-05-21 — finding (5)
