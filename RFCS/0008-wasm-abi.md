# RFC 0008: WASM ABI for Cross-Language Node Packs

| Field             | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **RFC**           | 0008                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Title**         | WASM ABI for Cross-Language Node Packs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Status**        | `Accepted`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Author(s)**     | David Tufts (@davidscotttufts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Created**       | 2026-05-10                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Updated**       | 2026-05-13 (Active → Accepted: all 8 acceptance-criteria items satisfied — spec text merged; `node-pack-manifest.schema.json` carries `wasm` + `wasm-component` in `runtime.language` enum (line 195) and `format` enum (line 204); `spec/v1/node-packs.md` §"WASM runtime" subsection landed 2026-05-13 cross-linking to this RFC with the 6-scenario coverage table; `schemas/capabilities.schema.json` declares `nodePackRuntimes.wasm.{supported, abiVersions, maxMemoryBytes, loadedPacks}` since 2026-05-13; six conformance scenarios all capability-gated under `capabilities.nodePackRuntimes.wasm.supported` — load, invoke-completed, invoke-suspended, replay-determinism, memory-cap, abi-version-rejection — plus the two deliberately-misbehaving Rust packs (`rust-misbehaving-memory` for §K, `rust-misbehaving-abi` for §H) that drive the positive paths; in-memory reference host at `examples/hosts/in-memory/src/wasm-loader.ts` implements the loader zero-dep over Node's native `WebAssembly`; CHANGELOG records the RFC in the v1.1.0 entry; example Rust pack at `examples/packs/rust-hello/` published live to `packs.openwop.dev` since 2026-05-11. The Component Model variant (`language: wasm-component`) remains reserved for an additive sub-RFC.) |
| **Affects**       | `schemas/node-pack-manifest.schema.json`, `spec/v1/node-packs.md`, `spec/v1/registry-operations.md`, `spec/v1/capabilities.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Compatibility** | `additive`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Supersedes**    | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Superseded by** | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## Summary

Specify the WebAssembly (WASM) Application Binary Interface (ABI) that `language: wasm` node packs implement, enabling cross-language node packs (Rust, Zig, C, Go via TinyGo, AssemblyScript, etc.) to run portably across every OpenWOP host without per-language runtime support in each host. The ABI is deliberately minimal — a small set of exports the module provides + a small set of imports the host provides — with JSON-encoded payloads passed over the module's linear memory. Component Model migration is left as a future additive extension.

## Motivation

Today, every OpenWOP host that loads node packs needs runtime support for each language the pack uses. The `node-pack-manifest.schema.json` declares `language: "javascript" | "python" | "go" | "wasm" | "remote"`, but only JavaScript node packs are routinely tested. Three problems compound:

1. **Practical TypeScript lock-in.** Every reference host is Node.js; non-JS authors must either ship `language: remote` packs (HTTP-over-the-wire, with all the latency and dependency tradeoffs) or wait for each host to add Python/Go runtime support individually.
2. **No portable performance path.** Even when a host adds Python support, the workflow author can't pre-compile to a host-neutral artifact. Every host re-interprets.
3. **Sandboxing without consensus.** Hosts that load native node packs face a sandbox-or-trust tradeoff. WASM is the consensus sandbox of the 2020s; standardizing on it means the trust boundary is the same everywhere.

The right answer is the existing `language: wasm` slot in `node-pack-manifest.schema.json`: ship pre-compiled WASM modules with a documented ABI, and every host that has a WASM runtime (Wasmtime, Wasmer, V8, browser, etc.) loads them identically. Native performance, language-neutral packaging, consensus sandbox.

This is post-v1 ecosystem work — high-leverage but not blocking v1 conformance. RFC 0008 ships as `Draft` to gather feedback before promotion to `Active`.

## Proposal

### §A Wire format choice: WASM core + custom imports (not Component Model — yet)

Two viable foundations:

- **WASM core (Stage 5 W3C spec)** with custom imports under a namespace. Tooling is mature (every WASM runtime supports it); the ABI is hand-rolled but small.
- **WASM Component Model (Preview 3)** with WIT-defined interfaces. Cleaner ergonomics, evolving tooling, requires Component Model support in every host runtime.

RFC 0008 selects **WASM core** for v1.x. Rationale: every Wasmtime / Wasmer / wasm-pack toolchain handles core modules today; Component Model support is uneven across runtimes as of 2026-05. Future migration to a Component Model variant (RFC 0009 candidate) lands as an additive `format: "wasm-component"` enum value alongside the existing `format: "wasm"`.

### §B Required exports

Every conformant WASM node-pack module MUST export the following functions. Names are case-sensitive.

```text
;; Module identification
(func $openwop_abi_version (result i32))      ;; returns ABI version; this RFC defines version 1
(func $openwop_pack_name (result i32 i32))    ;; returns (ptr, len) of UTF-8 pack name
(func $openwop_node_count (result i32))       ;; number of node typeIds exported
(func $openwop_node_id_at
  (param $index i32)                          ;; 0..node_count-1
  (result i32 i32))                           ;; returns (ptr, len) of UTF-8 typeId

;; Memory management — host calls these to manage strings/buffers in linear memory
(func $openwop_alloc (param $size i32) (result i32))   ;; returns ptr
(func $openwop_free (param $ptr i32) (param $size i32))

;; Node execution entry point
(func $openwop_node_invoke
  (param $node_index i32)         ;; index from openwop_node_id_at
  (param $request_ptr i32)        ;; pointer to JSON-encoded request
  (param $request_len i32)
  (result i32 i32))               ;; returns (response_ptr, response_len) — JSON-encoded
```

**Multi-value vs packed-i64 encoding.** WebAssembly multi-value returns are first-class in the spec but require the `multivalue` target feature, which is not enabled by default on stable Rust's `wasm32-unknown-unknown` toolchain (as of 2026-05). Conformant modules MAY satisfy any `(result i32 i32)` signature in this RFC using _either_ native multi-value OR a packed `i64` encoding: low 32 bits = ptr, high 32 bits = len. Hosts MUST support both:

```text
;; Equivalent module-side signature (packed i64):
(func $openwop_node_invoke
  (param $node_index i32) (param $request_ptr i32) (param $request_len i32)
  (result i64))   ;; (high u32: response_len) | (low u32: response_ptr)
```

The reference Rust pack (`examples/packs/rust-hello/`) uses packed i64 for stable-toolchain compatibility. Loaders detect the encoding by inspecting the exported function's signature at instantiation.

The request and response JSON shapes are defined in §D.

### §C Required imports

The host MUST provide these imports under the `openwop` namespace.

```text
;; Channel I/O — bridge to channels-and-reducers.md
(func $openwop_channel_read
  (param $name_ptr i32) (param $name_len i32)
  (result i32 i32))                      ;; (ptr, len) of JSON value, or (0, 0) on miss
(func $openwop_channel_write
  (param $name_ptr i32) (param $name_len i32)
  (param $value_ptr i32) (param $value_len i32)
  (result i32))                          ;; returns status; 0 = ok, non-zero per §F

;; Variables (legacy untyped state)
(func $openwop_variable_get
  (param $key_ptr i32) (param $key_len i32)
  (result i32 i32))
(func $openwop_variable_set
  (param $key_ptr i32) (param $key_len i32)
  (param $value_ptr i32) (param $value_len i32)
  (result i32))

;; Interrupt — host runs the suspend flow
(func $openwop_interrupt
  (param $payload_ptr i32) (param $payload_len i32)  ;; JSON-encoded InterruptPayload
  (result i32 i32))                                  ;; (ptr, len) of JSON-encoded resume value

;; Diagnostic / logging
(func $openwop_log
  (param $level i32)                     ;; 0=trace 1=debug 2=info 3=warn 4=error
  (param $msg_ptr i32) (param $msg_len i32))

;; Time (host-controlled for replay determinism)
(func $openwop_now_ms (result i64))      ;; ms since Unix epoch

;; Random (host-controlled for replay determinism; modules MUST NOT use
;; WASI random_get directly)
(func $openwop_random
  (param $out_ptr i32) (param $len i32))
```

WASI imports (e.g., `wasi_snapshot_preview1.fd_write`) are NOT part of the OpenWOP ABI. Modules that link WASI imports MAY still load if the host provides a WASI shim (recommended: stub `fd_write` for stdout/stderr capture), but their behavior under that shim is not normated by this RFC.

### §D JSON envelope shapes

#### Request to `openwop_node_invoke`

```json
{
  "abiVersion": 1,
  "nodeContext": {
    "runId": "string",
    "nodeId": "string",
    "tenantId": "string",
    "attempt": 0,
    "configurable": {},
    "agent": "<AgentRef or null>"
  },
  "inputs": {}
}
```

#### Response from `openwop_node_invoke`

Discriminated by `outcome`:

```json
{ "outcome": "completed", "output": <any> }
```

```json
{ "outcome": "suspended", "interrupt": "<InterruptPayload>" }
```

```json
{
  "outcome": "failed",
  "error": {
    "code": "string",
    "message": "string",
    "details": {}
  }
}
```

Modules that need to call `openwop_interrupt` mid-execution use the import (suspends through the host); modules that wish to return without calling the import set `outcome: "suspended"` and let the host invoke the interrupt flow afterward. Hosts MUST support both patterns.

### §E Memory ownership rules

The ABI uses **caller-owned allocation**: the side that produces a buffer allocates it; the side that consumes it reads but does not free.

Concretely:

1. **Module-to-host returns** (e.g., `openwop_node_invoke` result): module allocates via `openwop_alloc`. Host reads. After reading, host calls `openwop_free` to release.
2. **Host-to-module passes** (e.g., `request_ptr` on `openwop_node_invoke`): host allocates via `openwop_alloc` (callable into module memory). Module reads. Module calls `openwop_free` when done OR ignores (host MAY garbage-collect on next invocation).
3. **Returned `(ptr, len)` pairs from imports** (e.g., `openwop_channel_read`): host allocates via `openwop_alloc`. Module reads. Module calls `openwop_free`.

Modules that fail to call `openwop_free` leak memory inside their own linear-memory instance; hosts are not required to detect this beyond reasonable diagnostics. Hosts SHOULD restart the module after a configured per-invocation memory ceiling.

### §F Error and status codes

Status integers returned by host imports (zero = success):

| Status | Meaning                                                                            |
| ------ | ---------------------------------------------------------------------------------- |
| 0      | Success                                                                            |
| 1      | `channel_access_denied` — see `channels-and-reducers.md` §"Channel access control" |
| 2      | `channel_schema_breaking_change`                                                   |
| 3      | `channel_cross_engine_write_forbidden`                                             |
| 10     | `validation_error` — JSON payload didn't conform to schema                         |
| 11     | `not_found` — referenced channel / variable / interrupt doesn't exist              |
| 20     | `capability_breach` — call would exceed engine-enforced cap                        |
| 99     | `host_error` — unexpected host-side failure; module SHOULD propagate as `failed`   |

Modules MUST tolerate unknown nonzero codes (forward-compatibility): treat as a generic failure and surface as `outcome: "failed"`.

### §G Replay determinism

Modules MUST be deterministic given the same:

- `request` to `openwop_node_invoke`,
- Sequence of import results from `openwop_channel_read`, `openwop_variable_get`, `openwop_interrupt`, `openwop_now_ms`, and `openwop_random`.

Hosts MUST cache import results during the original execution and replay them verbatim during fork/replay. Modules that call `openwop_now_ms` twice during one invocation will see the same ms value on replay; modules that call WASI clock primitives directly break replay and are non-conformant.

`openwop_random` is the canonical source of entropy: hosts MUST seed it deterministically per `(runId, nodeId, attempt)` so replay produces identical bytes.

### §H Capability advertisement

Hosts that load WASM packs advertise:

```json
{
  "capabilities": {
    "nodePackRuntimes": {
      "wasm": {
        "supported": true,
        "abiVersions": [1],
        "engine": "wasmtime",
        "engineVersion": "21.0.0",
        "maxMemoryBytes": 134217728,
        "maxExecutionMs": 30000
      }
    }
  }
}
```

Hosts MUST include at least one supported `abiVersion` in `abiVersions[]`. Future ABI revisions extend the array.

### §I Manifest extension

The existing `node-pack-manifest.schema.json` already accepts `language: "wasm"`. RFC 0008 narrows the additional fields for the `wasm` runtime block:

```json
"runtime": {
  "language": "wasm",
  "entry": "dist/pack.wasm",
  "format": "wasm",
  "minRuntimeVersion": "1",
  "wasm": {
    "abiVersion": 1,
    "memoryPagesInitial": 16,
    "memoryPagesMax": 1024
  }
}
```

The `wasm` sub-block:

- `abiVersion` — REQUIRED. The ABI version this module targets. Hosts MUST refuse to load modules whose `abiVersion` is not in `capabilities.nodePackRuntimes.wasm.abiVersions`.
- `memoryPagesInitial` / `memoryPagesMax` — pre-declare memory needs so hosts can size the instance up-front. 1 page = 64 KiB.

### §J Signing and integrity

WASM modules are signed identically to other pack artifacts (Ed25519 signature over the tarball; see `node-packs.md` §Signing). The signature covers the `.wasm` binary contents byte-for-byte. Hosts MUST verify the signature before instantiation.

### §K Resource limits

Hosts MUST enforce the following limits per node invocation:

- **Memory ceiling** — `capabilities.nodePackRuntimes.wasm.maxMemoryBytes` (default 128 MiB). Exceeded → kill the instance, emit `cap.breached` with `kind: "wasm-memory"`.
- **Wall-clock ceiling** — `maxExecutionMs` (default 30 s). Exceeded → trap the instance, emit `cap.breached` with `kind: "wasm-execution-time"`.
- **Fuel / instruction count** — hosts MAY use Wasmtime's fuel mechanism or equivalent to bound CPU; this is host policy, not normated.

### §L Reserved exports for future use

The following export names are RESERVED and MUST NOT be used for application purposes:

- `openwop_abi_*` — ABI metadata (this RFC defines `openwop_abi_version`; future RFCs may add `openwop_abi_features`, `openwop_abi_capabilities`).
- `openwop_node_*` — Node lifecycle (this RFC defines `openwop_node_count`, `openwop_node_id_at`, `openwop_node_invoke`; future RFCs may add `openwop_node_describe`, `openwop_node_validate_inputs`).
- `openwop_agent_*` — Reserved for future agent-implementing WASM modules (RFC 0009 candidate).

## Compatibility

**Additive.**

- `language: "wasm"` already exists in the manifest enum; this RFC binds it to a contract.
- The `wasm` sub-block on `Runtime` is new and optional.
- Capability advertisement is opt-in.
- No changes to existing required fields.

Pre-RFC-0008 hosts that don't support WASM packs continue to be v1-conformant; they simply refuse to install WASM packs at registry-fetch time with `unsupported_pack_runtime`.

## Conformance

New scenarios required for `Active → Accepted`:

- `wasm-pack-load.test.ts` — load a signed WASM pack against a host that advertises `nodePackRuntimes.wasm.supported: true`; verify pack-name, node-typeId, and ABI-version exports.
- `wasm-pack-invoke-completed.test.ts` — invoke a node that returns `outcome: "completed"`; verify output round-trip.
- `wasm-pack-invoke-suspended.test.ts` — invoke a node that returns `outcome: "suspended"`; verify host runs the interrupt and re-invokes with the resume value.
- `wasm-pack-replay-determinism.test.ts` — re-run a fork against a WASM pack; verify `openwop_now_ms` and `openwop_random` produce identical bytes.
- `wasm-pack-memory-cap.test.ts` — verify the host kills a module exceeding `maxMemoryBytes` and emits `cap.breached`.
- `wasm-pack-abi-version-rejection.test.ts` — verify a module with an unsupported `abiVersion` is rejected with `unsupported_abi_version`.

All gated on `capabilities.nodePackRuntimes.wasm.supported: true`.

## Alternatives considered

1. **WASI Preview 2 / Component Model from day one.** Cleaner WIT-based interface; runtime support is uneven in 2026-05 and the spec is still being polished. **Resolved 2026-05-12 (Phase B):** Promoted to an additive enum value `language: "wasm-component"` + `format: "wasm-component"` on `node-pack-manifest.schema.json` per `node-packs.md` §"Runtime formats". The core-module `language: "wasm"` path remains the v1 baseline (no host MUST support Component Model yet); hosts opt in via `capabilities.nodePackRuntimes.wasmComponent.supported: true`. The ABI envelope (`openwop_node_invoke` semantics + JSON-over-linear-memory) is shared between the two variants; the Component Model variant simply replaces the hand-rolled imports/exports with WIT-defined interfaces. Specifics of the WIT interface definitions ship as an additive amendment to this RFC when the first Component-Model host lands.
2. **Embed Lua / JS interpreters per language.** Rejected: defeats the "consensus sandbox" goal. WASM is the lowest common denominator.
3. **Native dynamic libraries** (`.so`, `.dylib`, `.dll`). Rejected: no sandbox, ABI varies per OS, security model is the host's reputation.
4. **Treat all non-JS packs as `language: remote`.** Status quo. Works but pays HTTP latency on every node invocation and creates a deployment dependency.
5. **Use ProtoBuf / FlatBuffers / Cap'n Proto for the wire format instead of JSON.** Faster but adds toolchain overhead in every language. JSON-over-linear-memory is good enough for v1.x; a binary fast-path is a future additive.

## Unresolved questions

1. Should the ABI specify a fuel-based CPU limit normatively, or leave it as host policy? Current: host policy. May tighten in v1.2.
2. How should WASM packs that ship multiple node typeIds share state across invocations within the same module? Current: ephemeral per-invocation (instance reused but no global state guarantees). Open question for stateful nodes.
3. Should `openwop_log` honor the run's privacy-classification settings (`metadata.complianceClass`)? Current: yes, modules' logged content is treated as untrusted output and subject to standard redaction per `observability.md` §"Privacy classification".
4. Should we expose a `Module → Host` cancellation signal so long-running modules can react to `:cancel`? Current: hosts trap the module when cancellation arrives, which is forceful. A cooperative `openwop_should_cancel() → bool` import is a future extension.

## Implementation notes (non-normative)

- Reference TypeScript host plans to use Wasmtime via the official `wasmtime` Node binding. Initial memory cap 128 MiB; execution time cap 30 s.
- An example Rust pack ships under `examples/packs/rust-hello/` once the RFC reaches `Active`. The example wires `openwop_node_invoke` to a simple state-transformation node.
- A `wasm-bindgen`-style helper crate (`openwop-wasm-sdk`) for Rust authors is post-RFC ecosystem work; not part of this proposal.

## Acceptance criteria

- [ ] Spec text merged (this file).
- [ ] `node-pack-manifest.schema.json` adds the `wasm` sub-block on `Runtime`.
- [ ] `node-packs.md` adds a §"WASM runtime" subsection cross-linking to this RFC.
- [ ] `capabilities.md` adds `nodePackRuntimes.wasm` advertisement.
- [ ] Six conformance scenarios (listed above).
- [ ] Reference host implements WASM loader and passes the scenarios.
- [ ] CHANGELOG entry under v1.2.
- [ ] Example Rust pack under `examples/packs/rust-hello/`.

## References

- W3C WebAssembly Core Specification 2.0: <https://www.w3.org/TR/wasm-core-2/>
- WASI Preview 2 / Component Model (informative, future migration target): <https://component-model.bytecodealliance.org/>
- Wasmtime documentation: <https://docs.wasmtime.dev/>
- `schemas/node-pack-manifest.schema.json` (existing `language: wasm` declaration)
- `spec/v1/node-packs.md` §Signing
- RFC 0003 (Agent Packs — analogous pack-extension shape)
- `spec/v1/replay.md` §Determinism (constraints on `openwop_now_ms` / `openwop_random`)
