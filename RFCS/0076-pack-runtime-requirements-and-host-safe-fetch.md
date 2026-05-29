# RFC 0076: Pack runtime-requirements declaration + host-provided safe-fetch

| Field | Value |
|---|---|
| **RFC** | 0076 |
| **Title** | Pack runtime-requirements declaration + host-provided safe-fetch |
| **Status** | `Draft` |
| **Author(s)** | openwop working group (steward), prompted by the MyndHyve RFC 0072 §B second-host debrief (2026-05-28) |
| **Created** | 2026-05-28 |
| **Updated** | 2026-05-28 |
| **Affects** | `schemas/node-pack-manifest.schema.json` (new optional `runtime.requires[]`), `spec/v1/node-packs.md`, `spec/v1/registry-operations.md` (install-time gate), `spec/v1/host-extensions.md` (`ctx.http.safeFetch`), `spec/v1/capabilities.md` (`host.http.safeFetch` advertisement), `conformance/src/scenarios/*` |
| **Compatibility** | `additive` per `COMPATIBILITY.md` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

A pack's runtime code may need platform primitives the host's sandbox denies by default — `core.openwop.http@1.1.2` reaches for `node:dns/promises` to do SSRF defense before every fetch, which a tight default-deny sandbox refuses, so the host discovers the requirement only by a failed *trial-load*. This RFC adds two additive surfaces: (1) an abstract, runtime-agnostic `runtime.requires[]` declaration on the pack manifest so a host can gate at **install time** instead of at first invocation; and (2) an OPTIONAL host-provided `ctx.http.safeFetch(url, init?)` that centralizes outbound-request SSRF defense in the host, so packs no longer reach for `node:dns/promises` themselves. Both are opt-in and backward-compatible: packs without `runtime.requires` and hosts without `safeFetch` behave exactly as today.

## Motivation

Today, pack-runtime platform requirements are **not first-class**. The manifest has three adjacent-but-distinct mechanisms, none of which expresses "this pack's code calls `dns.lookup` / opens outbound sockets":

- `runtime` (`schemas/node-pack-manifest.schema.json` — `language`/`entry`) — *which* runtime, not what it touches.
- `peerDependencies` (RFC 0072 §C) — host **agent-runtime capability tiers** (`agents.manifestRuntime`, `host.agentRuntime`).
- `NodeModule.requires` + `capabilities.runtimeCapabilities` (`capabilities.md` §"Runtime capabilities") — **host-advertised opaque facilities** consumed *per node at dispatch* (`chat.sendPrompt`, `canvas.write`). `registry-operations.md` §"Host-private marketplace" already shows `requires: ['<host>.canvas.write']` gating load.

What's missing is the **platform/sandbox** axis: the primitives the pack's *own code* exercises (DNS resolution, outbound fetch, crypto, subprocess, filesystem). A sandbox-based host (the realistic deployment for untrusted `community.*` / `vendor.*` packs) runs a default deny-list and only learns a pack needs `node:dns` when the pack throws at first invocation. MyndHyve had to **carve `node:dns/promises` out of its sandbox by trial-and-error** to load `core.openwop.http` at all (RFC 0072 §B debrief, finding 1).

The spec is the right place because pack portability is a cross-host guarantee: a pack that loads on host A's sandbox but silently fails on host B's tighter sandbox is exactly the "portable manifest, host-specific runtime" failure RFC 0072 set out to close. An install-time, declarative gate makes the boundary inspectable before a run depends on it.

Separately, finding 1(b): packs that perform SSRF defense by direct DNS (the `core.openwop.http` `assertPublicUrl` pattern) **each re-implement** the metadata-endpoint blocklist and private-range checks, and each must reach for `node:dns`. Centralizing the defense in a host-provided `safeFetch` is more secure (one audited, host-maintained blocklist; audit-loggable via RFC 0064 `agent.toolCalled`), more portable (no `node:dns` dependency in the pack), and consistent across packs — worth settling before more packs follow `core.openwop.http`'s lead.

## Proposal

### §A — `runtime.requires[]` on the pack manifest (additive)

Add an OPTIONAL `requires` array to the manifest's `runtime` object, drawn from a **controlled, runtime-agnostic vocabulary** of platform primitives — *not* raw Node builtin names (`node:dns/promises` does not translate to the Python / Go / wasm runtimes the spec already supports):

```diff
   "runtime": {
     "type": "object",
     "required": ["language", "entry"],
     "properties": {
       "language": { "enum": ["javascript", "python", "go", "wasm", "remote"] },
-      "entry": { "type": "string" }
+      "entry": { "type": "string" },
+      "requires": {
+        "type": "array",
+        "description": "RFC 0076. Abstract platform primitives the pack's runtime code exercises, for install-time sandbox gating. Runtime-agnostic (not Node builtin names). Absent ⇒ the pack declares no elevated platform needs.",
+        "items": {
+          "enum": [
+            "net.dns",        // resolves hostnames (e.g. SSRF pre-flight)
+            "net.outbound",   // opens outbound network connections / fetch
+            "crypto",         // primitives beyond the standard hashing the host already provides
+            "subprocess",     // spawns a child process (see RFC 0069 exec-class contract)
+            "fs.read",        // reads the local filesystem
+            "fs.write",       // writes the local filesystem
+            "clock"           // reads wall-clock time as a behavioral input (replay-relevant)
+          ]
+        },
+        "uniqueItems": true
+      }
     }
   }
```

**Behavior (normative).**

- A pack MAY declare `runtime.requires[]`. Absent ⇒ the pack asserts no elevated platform needs (today's behavior).
- A host that gates platform access (a sandbox host) MUST evaluate `runtime.requires[]` at **install time**: every listed primitive its sandbox can grant ⇒ install; any primitive it will **not** grant ⇒ the host MUST refuse install with `pack_runtime_requirement_unmet` naming the unmet primitive(s) — the install-time analogue of the dispatch-time `capability_not_provided` (`capabilities.md`). It MUST NOT silently install and fail at first invocation.
- A host that does **not** gate platform access (grants the runtime's full standard library) MAY ignore the field — every primitive is already available; there is nothing to refuse.
- `runtime.requires[]` is a **declaration of intent for gating**, not an authorization grant. It does not widen what a pack may do; it lets the host decide *before* load whether it is willing to grant what the pack will attempt. A host MUST still enforce its sandbox at runtime — a pack that declares `net.dns` but attempts `subprocess` is still denied the undeclared primitive.

**Examples.**

*Positive.* `core.openwop.http` declares `"requires": ["net.dns", "net.outbound"]`. A sandbox host that permits outbound HTTP + DNS installs it; the requirement is visible on the pack's discovery page; no trial-load.

*Negative (refused install).* A pack declares `"requires": ["subprocess"]`. A host whose sandbox forbids child processes refuses install with `pack_runtime_requirement_unmet { unmet: ["subprocess"] }` — the operator sees the boundary at install, not a production run failure.

*Negative (validation).* `"requires": ["node:dns/promises"]` fails manifest validation (`400 invalid_manifest`) — raw builtin names are not in the controlled vocabulary; the abstract `net.dns` is the portable equivalent.

### §B — host-provided `ctx.http.safeFetch` (additive, OPTIONAL host capability)

A host MAY advertise `capabilities.host.http.safeFetch: { supported: true }` and expose `ctx.http.safeFetch(url, init?)` to pack runtime code:

```typescript
ctx.http.safeFetch(
  url: string,
  init?: RequestInit,        // method/headers/body subset, host-clamped
) → Promise<Response>        // standard fetch Response, or throws ssrf_blocked / fetch_failed
```

**Behavior (normative, when advertised).**

- The host MUST perform SSRF defense before connecting: resolve the host, and **reject** (throw `ssrf_blocked`) any request whose resolved address is loopback, RFC 1918 private, link-local, or a cloud metadata endpoint (`169.254.169.254`, `metadata.google.internal`, etc.). The host MUST re-check the resolved address against the connected address to defeat DNS-rebinding (pin the resolved IP for the connection).
- The host SHOULD emit the call under RFC 0064 `host.toolHooks` (`agent.toolCalled` / `agent.toolReturned`, `transport: 'http'`) so safe-fetch egress is auditable and rate-limitable on the same surface as other tool calls.
- A pack that uses `ctx.http.safeFetch` **does not** declare `net.dns` in `runtime.requires` for the fetch path — the host owns resolution. A pack that wants to run on hosts lacking the capability MAY feature-detect (`ctx.http?.safeFetch`) and fall back to its own `net.outbound` + `net.dns` path (declaring both).

This composes with — does not replace — RFC 0069's exec-class host-extension safety contract: `safeFetch` is the network-egress analogue of that RFC's subprocess sandboxing.

**Example.** `core.openwop.http@2.0.0` (hypothetical) calls `ctx.http.safeFetch(url)` when present, dropping its in-pack `assertPublicUrl` + `node:dns/promises`; the host's audited blocklist applies uniformly across every pack that fetches.

## Compatibility

**Additive.** Both surfaces are opt-in:

- `runtime.requires[]` is a new OPTIONAL array; packs that omit it validate and load exactly as today. Hosts that don't gate platform access ignore it. The only new failure (`pack_runtime_requirement_unmet`) fires on packs that *opt in* to a requirement the host won't grant — which today fails *anyway* (at trial-load), only later and less legibly. No existing conformance pass is invalidated.
- `ctx.http.safeFetch` is a new OPTIONAL capability under a new `host.http` block; hosts that omit it expose no `ctx.http`, and packs feature-detect. No existing pack depends on it.

No wire-event change, no new SECURITY invariant (the SSRF guarantee restates existing host responsibility; `safeFetch` centralizes it), no breaking schema change. Lands in v1.x.

## Conformance

- **New, gated on a sandbox seam:** a pack manifest declaring `runtime.requires: ["subprocess"]` against a host seam that denies subprocess MUST yield `pack_runtime_requirement_unmet`; a manifest with `requires: ["net.dns"]` against a host that grants it installs.
- **New, gated on `host.http.safeFetch.supported`:** `ctx.http.safeFetch` against a loopback / RFC-1918 / metadata URL MUST throw `ssrf_blocked` and MUST NOT connect; against a public URL it returns the response. A DNS-rebinding fixture (public A-record that re-resolves to `169.254.169.254`) MUST be blocked.
- **Validation:** a manifest with a `runtime.requires` entry outside the vocabulary MUST be rejected `invalid_manifest`.

Both scenario groups soft-skip until the respective capability/seam is advertised, per the established gating convention.

## Alternatives considered

1. **Raw Node-builtin names in `requires` (MyndHyve's literal suggestion 1a, "listing required Node builtins").** Rejected as the normative vocabulary: `node:dns/promises` is meaningless for the Python / Go / wasm / remote runtimes the manifest already supports, and would leak a runtime's implementation surface into the portable wire contract. The abstract vocabulary (`net.dns`, …) captures the same gating intent portably. A host MAY map the abstract primitive to its runtime's concrete builtins internally.
2. **Reuse `NodeModule.requires` / `runtimeCapabilities` for platform primitives.** Rejected — that mechanism is *per-node, host-advertised opaque facilities* checked at dispatch (`chat.sendPrompt`), a different axis and a different enforcement point. Overloading it would conflate "this node needs a host facility at run" with "this pack's code needs a sandbox primitive at load," and break the clean dispatch-time `capability_not_provided` semantics.
3. **`safeFetch` only, no `runtime.requires`.** Rejected — `safeFetch` solves only outbound HTTP; it does nothing for packs needing `subprocess`, `fs`, or `crypto`. The declaration is the general gate; `safeFetch` is one centralized facility under it.
4. **Do nothing (status quo: trial-load).** Rejected — trial-load defers a load-time contract failure to first production invocation, is non-portable across sandbox policies, and forces each operator to reverse-engineer a pack's platform needs (exactly MyndHyve's experience). The cost of doing nothing is paid by every future sandbox host integrating every future pack.

## Unresolved questions

1. **Vocabulary scope.** Is the seven-value set (`net.dns`, `net.outbound`, `crypto`, `subprocess`, `fs.read`, `fs.write`, `clock`) the right granularity, or do we want coarser (`net`, `fs`) / finer (`net.outbound.http` vs `net.outbound.raw`) buckets? Additions are themselves additive (enum extension, `wasm-*` precedent), so starting minimal is low-risk.
2. **`safeFetch` MUST vs SHOULD for the audit emission.** Should emitting under `host.toolHooks` be MUST (when both capabilities are advertised) so safe-fetch egress is never an audit blind spot, or SHOULD?
3. **Relationship to RFC 0069.** Should `subprocess` in `runtime.requires` be defined as *requiring* the RFC 0069 exec-class contract when the host grants it, or stay an independent declaration that RFC 0069 gates separately?
4. **Install gate strictness for non-sandbox hosts.** This RFC lets a non-gating host ignore the field. Should a host instead be encouraged (SHOULD) to *record* the declared requirements on the inventory entry for operator visibility even when it grants everything?

## Implementation notes (non-normative)

- Reference host (`examples/hosts/*`): add an install-time check that intersects `runtime.requires[]` against a configured grant-set, emitting `pack_runtime_requirement_unmet`; add a `ctx.http.safeFetch` behind a config flag implementing the resolve→pin→connect SSRF guard. Effort: small for the gate, medium for the rebinding-safe fetch.
- `core.openwop.http` is the natural first adopter of both: declare `runtime.requires: ["net.dns", "net.outbound"]` now (additive, no behavior change), and ship a `safeFetch`-preferring `2.0.0` once a reference host advertises the capability.
- Sequencing: §A (declaration) is independently shippable and unblocks sandbox hosts immediately; §B (`safeFetch`) can follow.

## Acceptance criteria

- [ ] Spec text merged (this file + `runtime.requires` in `node-packs.md` + the install gate in `registry-operations.md` + `ctx.http.safeFetch` in `host-extensions.md` + the capability in `capabilities.md`).
- [ ] `schemas/node-pack-manifest.schema.json` adds `runtime.requires`; `schemas/capabilities.schema.json` adds `host.http.safeFetch`.
- [ ] At least one conformance scenario per §A and §B, capability/seam-gated.
- [ ] CHANGELOG entry under the target v1.x.
- [ ] A reference host implements the install gate + `safeFetch`, or this RFC explicitly defers §B reference implementation.

## References

- MyndHyve RFC 0072 §B second-host debrief, 2026-05-28 (finding 1a/1b) — the implementer pain point that prompted this RFC.
- RFC 0003 — agent/pack manifest (`runtime` object this extends).
- RFC 0072 — agent inventory + dispatch (`peerDependencies` / `peerDependenciesMeta`, the adjacent host-capability gate).
- RFC 0069 — exec-class tool host-extension safety contract (subprocess sandboxing; `safeFetch` is its network analogue).
- RFC 0064 — `host.toolHooks` (the audit surface `safeFetch` egress reuses).
- `spec/v1/capabilities.md` §"Runtime capabilities" — the distinct per-node host-facility mechanism this deliberately does not overload.
- OWASP SSRF prevention cheat sheet; GCP/AWS metadata-endpoint hardening guidance (prior art for the blocklist).
