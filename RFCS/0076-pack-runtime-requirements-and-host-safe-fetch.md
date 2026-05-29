# RFC 0076: Pack runtime-requirements declaration + host-provided safe-fetch

| Field | Value |
|---|---|
| **RFC** | 0076 |
| **Title** | Pack runtime-requirements declaration + host-provided safe-fetch |
| **Status** | `Draft` |
| **Author(s)** | openwop working group (steward), prompted by the MyndHyve RFC 0072 §B second-host debrief (2026-05-28) |
| **Created** | 2026-05-28 |
| **Updated** | 2026-05-29 (rev 3 — MyndHyve §A schema-diff review folded in: elided additive diff synced to live `$defs/Runtime`, `oneOf`/`const`/`description` vocabulary (no JSON comments), empty-array≡omission, coarser-parent-breadth + closed-enum versioning rules, peerDependencies-compose note, Q5 credential-provenance breadcrumb). Rev 2 (2026-05-28) — second-host comment-window review: Q1–Q4 resolved, `env.read` added, §B audit MUST + request-init clamps + RFC 0069 composition + §A/§B sequencing |
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

Add an OPTIONAL `requires` array to the manifest's `$defs/Runtime` object, drawn from a **controlled, runtime-agnostic vocabulary** of platform primitives — *not* raw Node builtin names (`node:dns/promises` does not translate to the Python / Go / wasm runtimes the spec already supports). The diff below is **additive-only** — the `+` lines are the entire change; the surrounding properties (elided with `…`) are unchanged, including `language` (which already carries `wasm-component`, RFC 0008.1), `format`, and `minRuntimeVersion`. JSON Schema is strict JSON, so per-value semantics ride in `oneOf`/`const`/`description` rather than `//` comments:

```diff
   "Runtime": {
     "type": "object",
     "required": ["language", "entry"],
     "properties": {
       "language":          { "…": "unchanged (incl. wasm-component, RFC 0008.1)" },
       "entry":             { "…": "unchanged" },
       "format":            { "…": "unchanged" },
       "minRuntimeVersion": { "…": "unchanged" },
+      "requires": {
+        "type": "array",
+        "uniqueItems": true,
+        "description": "RFC 0076. Abstract platform primitives the pack's runtime code exercises, for install-time sandbox gating. Runtime-agnostic (not language builtin names). Absent or [] ⇒ no elevated platform needs.",
+        "items": {
+          "oneOf": [
+            { "const": "net.dns",      "description": "Resolves hostnames (e.g., SSRF pre-flight)." },
+            { "const": "net.outbound", "description": "Opens outbound network connections / fetch." },
+            { "const": "crypto",       "description": "Primitives beyond the standard hashing the host already provides." },
+            { "const": "subprocess",   "description": "Spawns a child process (composes with the RFC 0069 exec-class contract when the host advertises it)." },
+            { "const": "fs.read",      "description": "Reads the local filesystem." },
+            { "const": "fs.write",     "description": "Writes the local filesystem." },
+            { "const": "env.read",     "description": "Reads the process environment (may expose deployment secrets if the host does not scrub it)." },
+            { "const": "clock",        "description": "Reads wall-clock time as a behavioral input — gated for REPLAY determinism, not access control. A pack that branches on the clock is non-deterministic on replay (replay.md)." }
+          ]
+        }
+      }
     },
     "additionalProperties": false
   }
```

`clock` and `env.read` are the two non-obvious members. `clock` is included not because wall-clock access is privileged (it is a language global) but because a pack that branches on it is **non-deterministic on replay** (`replay.md`) — declaring it lets a replay-strict host gate or instrument it; future maintainers should not trim it as redundant with `Date.now()`. `env.read` is gated because an unscrubbed `process.env` can leak deployment secrets into pack code.

**Behavior (normative).**

- A pack MAY declare `runtime.requires[]`. Absent — or an empty array (`runtime.requires: []`) — ⇒ the pack asserts no elevated platform needs (today's behavior); the two are equivalent, and a host MUST NOT read a distinct meaning into the empty array.
- A host that gates platform access (a sandbox host) MUST evaluate `runtime.requires[]` at **install time**: every listed primitive its sandbox can grant ⇒ install; any primitive it will **not** grant ⇒ the host MUST refuse install with `pack_runtime_requirement_unmet` naming the unmet primitive(s) — the install-time analogue of the dispatch-time `capability_not_provided` (`capabilities.md`). It MUST NOT silently install and fail at first invocation.
- A host that does **not** gate platform access (grants the runtime's full standard library) MAY ignore the field for *enforcement* — every primitive is already available; there is nothing to refuse. It SHOULD nevertheless **project `runtime.requires[]` onto the pack's inventory/summary entry** (e.g. the pack-summary projection on the `GET /v1/agents` / pack listing) so operators retain visibility into the declared platform footprint at install time. This forward-compatibly prepares the workspace approval ledger for a later migration to a sandbox-enforcing host (which packs to re-evaluate). It carries no execution requirement.
- `runtime.requires[]` is a **declaration of intent for gating**, not an authorization grant. It does not widen what a pack may do; it lets the host decide *before* load whether it is willing to grant what the pack will attempt. A host MUST still enforce its sandbox at runtime — a pack that declares `net.dns` but attempts `subprocess` is still denied the undeclared primitive.

**Vocabulary versioning (normative).** The vocabulary extends additively (minor version; the `wasm-*` enum-addition precedent). Two rules keep the install gate sound as it refines:

- **Coarser-parent breadth.** When a later revision introduces a finer-grained primitive (e.g. `net.outbound.http` vs `net.outbound.raw`), a host MUST treat the coarser parent (`net.outbound`) as **at-least-as-broad** — a manifest declaring the coarser term implicitly requires every finer sub-token the host might split it into. This prevents a vocabulary refinement from becoming a covert security regression: a host that newly enforces a finer distinction cannot silently accept a coarser declaration it would refuse at the finer grain.
- **Closed-enum / version-pinned (the safety contract).** Schemas are version-pinned per host. A host validating manifests against schema v*N* MUST refuse a vocabulary token introduced after v*N* with `invalid_manifest`. This is intentional, not a gap: an old host refusing a newer requirement it does not understand **is** the install-time safety contract — a host MUST NOT grant a primitive it has not yet specified.

**Examples.**

*Positive.* `core.openwop.http` declares `"requires": ["net.dns", "net.outbound"]`. A sandbox host that permits outbound HTTP + DNS installs it; the requirement is visible on the pack's discovery page; no trial-load.

*Negative (refused install).* A pack declares `"requires": ["subprocess"]`. A host whose sandbox forbids child processes refuses install with `pack_runtime_requirement_unmet { unmet: ["subprocess"] }` — the operator sees the boundary at install, not a production run failure.

*Negative (validation).* `"requires": ["node:dns/promises"]` fails manifest validation (`400 invalid_manifest`) — raw builtin names are not in the controlled vocabulary; the abstract `net.dns` is the portable equivalent.

**Error payload (normative).** `pack_runtime_requirement_unmet` reuses the `capability_not_provided` envelope shape (`capabilities.md`):

```json
{
  "error": "pack_runtime_requirement_unmet",
  "unmet": ["subprocess"],
  "manifest": "core.openwop.cron@1.0.0",
  "advice": "operator-facing copy (OPTIONAL)"
}
```

`unmet[]` is the subset of the pack's `runtime.requires[]` the host will not grant; `manifest` is the offending `name@version`; `advice` is OPTIONAL operator-facing remediation copy.

**Composition with RFC 0069 (normative).** `runtime.requires: ["subprocess"]` is the *install-time gate* (will the host grant subprocess at all?); RFC 0069's exec-class contract is the *runtime contract* for **how** subprocess is granted (exec-class enumeration, sandbox mechanics). They are independent so a host can adopt the gate without first implementing RFC 0069:

- A host that grants `runtime.requires: ["subprocess"]` **AND** advertises RFC 0069's exec-class contract MUST apply that contract to every subprocess invocation by the pack.
- A host MAY grant `runtime.requires: ["subprocess"]` **without** RFC 0069 — in which case its sandbox-internal subprocess mechanics are not protocol-specified, and a pack requiring exec-class-grade isolation SHOULD additionally express that dependency via `peerDependencies` (RFC 0072 §C), which fails install closed when unmet.
- The two gates compose to the **stricter** of the two: `peerDependencies` is install-closed (unmet ⇒ refuse) and `runtime.requires` is install-closed; a pack declaring both `runtime.requires: ["subprocess"]` **and** `peerDependencies: { "host.execClass": "supported" }` opts into both and is refused on a host that grants `subprocess` but does not advertise the exec-class contract. That belt-and-suspenders posture is intentional and pack-author-selected, not a conflict.

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
- When `capabilities.toolHooks.prePostEvents: true` **AND** `capabilities.host.http.safeFetch.supported: true` are **both** advertised, the host MUST emit `agent.toolCalled` / `agent.toolReturned` for every `safeFetch` invocation with `transport: 'http'`. Centralizing egress in the host must *increase* auditability, not become a quiet bypass: a host that wishes to sample audit volume MUST do so at the storage/projection tier; the wire-level emission stays unconditional. (Same posture as RFC 0064's existing audit MUST for the `agent.toolCalled`/`agent.toolReturned` pair.) A host advertising `safeFetch` but not `toolHooks.prePostEvents` SHOULD still emit the pair.
- A pack that uses `ctx.http.safeFetch` **does not** declare `net.dns` in `runtime.requires` for the fetch path — the host owns resolution. A pack that wants to run on hosts lacking the capability MAY feature-detect (`ctx.http?.safeFetch`) and fall back to its own `net.outbound` + `net.dns` path (declaring both).

This composes with — does not replace — RFC 0069's exec-class host-extension safety contract: `safeFetch` is the network-egress analogue of that RFC's subprocess sandboxing.

**Example.** `core.openwop.http@2.0.0` (hypothetical) calls `ctx.http.safeFetch(url)` when present, dropping its in-pack `assertPublicUrl` + `node:dns/promises`; the host's audited blocklist applies uniformly across every pack that fetches.

**Request-init clamping.** The `init?` argument is a host-clamped subset of `RequestInit`, not a passthrough. The protocol does not number all clamps, but one is **normative** because it defends the same boundary as the SSRF check: the host MUST refuse connection-upgrade attempts (`Connection: upgrade` / `Connection: keep-alive` requesting a `101` protocol switch) — these defeat the resolve→pin→connect guard by escaping HTTP into a raw bidirectional socket. The rest are non-normative host-policy defaults, surfaced here so first implementations converge:

- **Body size** — host-configurable cap (suggest 10 MB default).
- **Timeout** — host-configurable (suggest 30 s default).
- **Headers** — MAY be reshaped. A host SHOULD refuse to forward an `Authorization` header the pack did not construct from a credential the host itself issued (RFC 0046 `host.credentials`) rather than from a static manifest string, to prevent a pack exfiltrating a host-issued credential to an arbitrary URL — but enforcement is host policy. *(Promoting this SHOULD → MUST needs credential provenance expressible at the `safeFetch` boundary — see future RFC: credential provenance; tracked as Q5 in Unresolved questions.)*

**Egress-proxy composition (non-normative).** `safeFetch` composes with, and does not preclude, a deployment-level egress allowlist (e.g. Cloud Run behind a serverless VPC connector + Cloud NAT with its own allowlist). The host's resolve→pin→connect SSRF defense applies *before* the egress proxy sees the request; the proxy's allowlist applies after — defense-in-depth, not redundancy.

## Compatibility

**Additive.** Both surfaces are opt-in:

- `runtime.requires[]` is a new OPTIONAL array; packs that omit it validate and load exactly as today. Hosts that don't gate platform access ignore it. The only new failure (`pack_runtime_requirement_unmet`) fires on packs that *opt in* to a requirement the host won't grant — which today fails *anyway* (at trial-load), only later and less legibly. No existing conformance pass is invalidated.
- `ctx.http.safeFetch` is a new OPTIONAL capability under a new `host.http` block; hosts that omit it expose no `ctx.http`, and packs feature-detect. No existing pack depends on it.

No wire-event change, no new SECURITY invariant (the SSRF guarantee restates existing host responsibility; `safeFetch` centralizes it), no breaking schema change. Lands in v1.x.

## Conformance

- **New, gated on a sandbox seam:** a pack manifest declaring `runtime.requires: ["subprocess"]` against a host seam that denies subprocess MUST yield `pack_runtime_requirement_unmet`; a manifest with `requires: ["net.dns"]` against a host that grants it installs.
- **New, gated on `host.http.safeFetch.supported`:** `ctx.http.safeFetch` against a loopback / RFC-1918 / metadata URL MUST throw `ssrf_blocked` and MUST NOT connect; against a public URL it returns the response. A DNS-rebinding fixture (public A-record that re-resolves to `169.254.169.254`) MUST be blocked. A request carrying `Connection: upgrade` MUST be refused.
- **New, gated on `host.http.safeFetch.supported` + `toolHooks.prePostEvents`:** a `safeFetch` call emits the `agent.toolCalled` / `agent.toolReturned` pair with `transport: 'http'`.
- **Validation:** a manifest with a `runtime.requires` entry outside the vocabulary MUST be rejected `invalid_manifest`.

Both scenario groups soft-skip until the respective capability/seam is advertised, per the established gating convention.

## Alternatives considered

1. **Raw Node-builtin names in `requires` (MyndHyve's literal suggestion 1a, "listing required Node builtins").** Rejected as the normative vocabulary: `node:dns/promises` is meaningless for the Python / Go / wasm / remote runtimes the manifest already supports, and would leak a runtime's implementation surface into the portable wire contract. The abstract vocabulary (`net.dns`, …) captures the same gating intent portably. A host MAY map the abstract primitive to its runtime's concrete builtins internally.
2. **Reuse `NodeModule.requires` / `runtimeCapabilities` for platform primitives.** Rejected — that mechanism is *per-node, host-advertised opaque facilities* checked at dispatch (`chat.sendPrompt`), a different axis and a different enforcement point. Overloading it would conflate "this node needs a host facility at run" with "this pack's code needs a sandbox primitive at load," and break the clean dispatch-time `capability_not_provided` semantics.
3. **`safeFetch` only, no `runtime.requires`.** Rejected — `safeFetch` solves only outbound HTTP; it does nothing for packs needing `subprocess`, `fs`, or `crypto`. The declaration is the general gate; `safeFetch` is one centralized facility under it.
4. **Do nothing (status quo: trial-load).** Rejected — trial-load defers a load-time contract failure to first production invocation, is non-portable across sandbox policies, and forces each operator to reverse-engineer a pack's platform needs (exactly MyndHyve's experience). The cost of doing nothing is paid by every future sandbox host integrating every future pack.

## Unresolved questions

*Q1–Q4 resolved by the MyndHyve second-host comment-window review (2026-05-28); positions folded into the Proposal above.*

1. **Vocabulary scope — RESOLVED.** Ship the v1 set as-is (now eight: `net.dns`, `net.outbound`, `crypto`, `subprocess`, `fs.read`, `fs.write`, `env.read`, `clock`). Reject coarser buckets (`net`/`fs`) — they lose gating power that is already paying off (a host can grant `net.dns` for safe-fetch preflight while denying `net.outbound` because all egress goes through `safeFetch`; collapsing to `net` would force granting the combined bucket). Defer finer buckets (`net.outbound.http` vs `net.outbound.raw`) — a real distinction (fetch allowed, raw sockets denied) but **additively extensible later** without breaking anyone (enum-addition, `wasm-*` precedent), so it stays out of v1. `env.read` added on review.
2. **`safeFetch` audit emission — RESOLVED: MUST when both advertised.** See §B normative bullet. Sampling belongs at the storage/projection tier, not the wire-emission tier (RFC 0064 posture).
3. **Relationship to RFC 0069 — RESOLVED: independent declarations + composition MUST.** See §A "Composition with RFC 0069." The gate and the runtime contract stay decoupled so a host can adopt the gate without first implementing RFC 0069.
4. **Non-sandbox host strictness — RESOLVED: SHOULD record.** A non-gating host SHOULD project `runtime.requires[]` onto the inventory entry for operator visibility (§A). One denormalized field copy; cost-to-value favors SHOULD.

Genuinely still open:

5. **`Authorization`-header forwarding enforcement (PARKED — own RFC).** §B leaves "refuse forwarding a pack-constructed `Authorization` not derived from a host-issued credential" as host policy (SHOULD). Promoting it to MUST needs credential provenance at the `safeFetch` boundary, distinguishing a host-issued credential from a static manifest string at call time. Two candidate mechanisms, each RFC-worthy on its own (folding either into 0076 would balloon scope): (a) thread provenance through `RequestInit` (intrusive — changes the call signature), or (b) a host-side credential-issuance ledger keyed by call-id. Deferred to a dedicated "credential provenance" RFC; the §B breadcrumb points here.

## Implementation notes (non-normative)

- Reference host (`examples/hosts/*`): add an install-time check that intersects `runtime.requires[]` against a configured grant-set, emitting `pack_runtime_requirement_unmet`; add a `ctx.http.safeFetch` behind a config flag implementing the resolve→pin→connect SSRF guard. Effort: small for the gate, medium for the rebinding-safe fetch.
- `core.openwop.http` is the natural first adopter of both: declare `runtime.requires: ["net.dns", "net.outbound"]` now (additive, no behavior change), and ship a `safeFetch`-preferring `2.0.0` once a reference host advertises the capability.
- **Approval-snapshot under RFC 0074 (raised in second-host review).** A workspace approval today records `{packName, approvedAt, approvedBy}`. Once `runtime.requires` lands, an approval captures a *single grant-evaluation*; a later host update that tightens its sandbox can silently invalidate previously-approved packs (the dispatch-time gate now fails). Hosts SHOULD snapshot the gate-evaluated `runtime.requires` onto the approval document (`approved against {net.dns, net.outbound} on 2026-05-28`) so admins see the grant set an approval was made against and can react explicitly when it shifts. Non-normative for this RFC; a candidate RFC 0074 amendment.
- **Sequencing (§A before §B).** §A (declaration + install gate) is independently shippable and delivers the immediate win the debrief surfaced; it merges to `Active` first, graduating to `Accepted` on one second-host adoption. §B (`safeFetch`) needs a reference implementation + ≥1 consumer pack gating behind feature-detection, so it follows as a **separate `Active → Accepted` track** once a reference host implements it and `core.openwop.http@2.0.0` ships the feature-detection path. This mirrors the established cohort-graduation pattern (RFC 0058's wall-clock and loop-iteration arms graduated independently).

## Acceptance criteria

Two independent tracks (see Implementation notes §"Sequencing").

**§A — `runtime.requires[]` (declaration + install gate):**
- [ ] Spec text merged (this file + `runtime.requires` in `node-packs.md` + the install gate + `pack_runtime_requirement_unmet` payload in `registry-operations.md`).
- [ ] `schemas/node-pack-manifest.schema.json` adds `runtime.requires` (8-value enum).
- [ ] ≥1 conformance scenario (install-grant, install-refuse, vocabulary-validation), seam-gated.
- [ ] CHANGELOG entry under the target v1.x.
- [ ] `Active → Accepted` on one second-host advertising the install gate (`core.openwop.http` declaring `["net.dns","net.outbound"]` is the first adopter).

**§B — `ctx.http.safeFetch` (separate `Active → Accepted` track):**
- [ ] Spec text merged (`ctx.http.safeFetch` in `host-extensions.md` + capability in `capabilities.md`); `schemas/capabilities.schema.json` adds `host.http.safeFetch`.
- [ ] ≥1 conformance scenario (SSRF block incl. rebinding + `Connection: upgrade` refusal; audit-emission-when-both-advertised), capability-gated.
- [ ] A reference host implements the resolve→pin→connect guard + `core.openwop.http@2.0.0` ships the feature-detection path, or §B explicitly defers reference implementation.

## References

- MyndHyve RFC 0072 §B second-host debrief, 2026-05-28 (finding 1a/1b) — the implementer pain point that prompted this RFC.
- MyndHyve RFC 0076 second-host review, 2026-05-28 — Q1–Q4 positions + observations A–D (approval-snapshot, request-init clamping, error payload, egress-proxy) + the §A/§B sequencing recommendation, all folded into rev 2.
- MyndHyve RFC 0076 §A schema-diff review, 2026-05-29 — five mechanical schema fixes (stale enum/elision, JSON-comment removal via `oneOf`, empty-array equivalence, coarser-parent forward-compat, closed-enum safety) + the peerDependencies-compose note, folded into rev 3. `wasm-component` (RFC 0008.1) drop-risk caught here.
- RFC 0003 — agent/pack manifest (`runtime` object this extends).
- RFC 0072 — agent inventory + dispatch (`peerDependencies` / `peerDependenciesMeta`, the adjacent host-capability gate).
- RFC 0069 — exec-class tool host-extension safety contract (subprocess sandboxing; `safeFetch` is its network analogue).
- RFC 0064 — `host.toolHooks` (the audit surface `safeFetch` egress reuses).
- `spec/v1/capabilities.md` §"Runtime capabilities" — the distinct per-node host-facility mechanism this deliberately does not overload.
- OWASP SSRF prevention cheat sheet; GCP/AWS metadata-endpoint hardening guidance (prior art for the blocklist).
