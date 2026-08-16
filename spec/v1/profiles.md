# OpenWOP Spec v1 — Compatibility Profiles

> **Status: Stable · v1.2 (2026-08-16 — RFC 0155 §A: `openwop-discovery-core` is the canonical name of the discovery predicate, `openwop-core` its deprecated alias for all of v1; claim vocabulary in §"Claim vocabulary"). v1.1 (2026-05-05; `openwop-fixtures` added 2026-05-07 via RFC 0003).** Profiles are an additive layer over v1 capabilities. They MUST be derivable from existing `/.well-known/openwop` fields without a wire-shape change. Graduated DRAFT → FINAL via RFC 0003. See `auth.md` for the status legend. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

---

## Why this exists

"openwop-compatible" today means "passes some subset of `@openwop/openwop-conformance`." That's accurate but not actionable: a host advertising `secrets.supported: true` and a host advertising `aiProviders.policies` aren't doing the same thing, and a client that depends on one doesn't necessarily work against the other.

A **compatibility profile** is a named set of capability requirements. A host that satisfies the requirements is in the profile. Clients pick the profile their workload depends on; hosts pick the profiles they implement; conformance matches the two.

Profiles are **derived from existing capability fields**, not declared as a new wire field. Two reasons:

1. **One source of truth.** A host that advertises `secrets.supported: true` but is "not in `openwop-secrets`" would be a contradiction. Derivation makes it impossible.
2. **No protocol deploy.** Adding a `profiles[]` array to `/.well-known/openwop` would touch every host's discovery payload and require a coordinated deploy. Derivation runs in the conformance suite and in client SDKs against the existing payload.

Per `COMPATIBILITY.md`, this document is additive — no v1 host implementation needs to change to be evaluated against profiles. Hosts that already satisfy a profile's requirements are already in it as of v1.

---

## Profile catalog

Thirteen v1.x compatibility profiles, plus one **deprecated alias** (`openwop-core` → `openwop-discovery-core`, RFC 0155 §A). The catalog is closed: new compatibility profiles require an RFC per `RFCS/0001-rfc-process.md`.

### `openwop-discovery-core` (canonical) — alias `openwop-core` (deprecated)

> **RFC 0155 §A (2026-08-16).** `openwop-discovery-core` is the **canonical name** for this predicate. `openwop-core` remains a **deprecated alias throughout v1** and derives **exactly when** `openwop-discovery-core` derives — a derivation MUST emit both names or neither, and a consumer MUST treat them as the same profile. New claims, badges, and bundles MUST use the canonical name; the alias is accepted on input for the whole of v1 and removed no earlier than v2. **Why the rename:** this predicate is a *discovery-payload* check — it says the `/.well-known/openwop` document is well-formed, and nothing about whether a run can be started, suspended, or replayed. A published certification bundle claimed `openwop-core` while failing six `interrupt-*` scenarios (RFC 0155 §A's motivating defect), which was possible only because the name did not say what it measured. The **minimum executable conformance floor** is `openwop-core-standard` ([`core-standard-profile.md`](./core-standard-profile.md), RFC 0088), and that is what an unqualified conformance claim means — see §"Claim vocabulary" below.

The minimum discovery shape any conforming host MUST satisfy.

**Requirements:**

- `protocolVersion` is a `1.<minor>` string per `version-negotiation.md` §"Protocol version grammar" (RFC 0149 §C: `MAJOR.MINOR`, not semver — `1.0` passes, `1.0.0` does not).
- `supportedEnvelopes` is an array (MAY be empty for engine-only hosts that don't expose LLM-emitting nodes).
- `schemaVersions` is an object with non-negative integer values.
- `limits.clarificationRounds`, `limits.schemaRounds`, `limits.envelopesPerTurn` are all non-negative integers.

**Predicate:**

```text
openwop-discovery-core(c) :=          # alias: openwop-core(c) ≡ openwop-discovery-core(c)
     typeof c.protocolVersion == 'string'
  && MAJOR(c.protocolVersion) == 1        # `MAJOR.MINOR` grammar per version-negotiation.md (RFC 0149 §C); reference impl: conformance `isCore`
  && Array.isArray(c.supportedEnvelopes)
  && typeof c.schemaVersions == 'object'
  && typeof c.limits == 'object'
  && Number.isInteger(c.limits.clarificationRounds) && c.limits.clarificationRounds >= 0
  && Number.isInteger(c.limits.schemaRounds)         && c.limits.schemaRounds >= 0
  && Number.isInteger(c.limits.envelopesPerTurn)     && c.limits.envelopesPerTurn >= 0
```

A host that fails `openwop-discovery-core` is not openwop-compatible. Every other profile implies `openwop-discovery-core`. (Predicates below are written `openwop-core(c)` for continuity; read it as the alias of `openwop-discovery-core(c)`.)

### `openwop-interrupts`

The host implements the interrupt/resume protocol per `interrupt.md`.

**Requirements:** This profile is satisfied by every conforming v1 host (interrupts are non-optional in v1 per `interrupt.md` §"Why this exists"). The profile exists so that downstream tooling can declare a dependency on interrupt-resume semantics explicitly.

**Predicate:**

```text
openwop-interrupts(c) :=
     openwop-core(c)
  && c.supportedEnvelopes.includes('clarification.request')
```

The `clarification.request` envelope is the canonical interrupt envelope per `interrupt.md`. Approval-gate interrupts use a different mechanism (suspend/resume) but a host that supports clarifications MUST also support the suspend mechanism.

A host that genuinely doesn't expose any interrupt path (e.g., a fire-and-forget batch host) MAY publish without `clarification.request` in `supportedEnvelopes` and fail the `openwop-interrupts` profile. Such hosts are still `openwop-core`.

### `openwop-stream-sse`

The host accepts SSE streaming on the events endpoint per `stream-modes.md`.

**Requirements:** SSE is the default streaming transport in v1. A host advertising `supportedTransports` either omits the field (REST-only is REQUIRED, SSE is RECOMMENDED) or includes `rest`. The conformance suite verifies SSE behavior at runtime.

**Predicate:**

```text
openwop-stream-sse(c) :=
     openwop-core(c)
  && (c.supportedTransports == null || c.supportedTransports.includes('rest'))
```

This is a runtime profile: discovery-payload alone can't fully validate SSE behavior. Conformance scenarios in `stream-modes.test.ts`, `stream-modes-buffer.test.ts`, and `stream-modes-mixed.test.ts` exercise the wire behavior. A host passes `openwop-stream-sse` when discovery passes the predicate AND those scenarios pass.

### `openwop-stream-poll`

The host accepts polling on the events endpoint per `stream-modes.md` §"Polling mode."

**Requirements:** Polling is the fallback transport for clients that can't hold long-lived connections. A host advertises support implicitly by serving `GET /v1/runs/{runId}/events/poll` per `rest-endpoints.md`.

**Predicate:** Same shape as `openwop-stream-sse` — runtime validated. Conformance scenarios in `stream-modes.test.ts` exercise polling.

```text
openwop-stream-poll(c) :=
     openwop-core(c)
  && (c.supportedTransports == null || c.supportedTransports.includes('rest'))
```

A host MAY satisfy both `openwop-stream-sse` and `openwop-stream-poll`; in v1 most reference hosts do.

### `openwop-secrets`

The host implements credential resolution per `run-options.md` §"Credential references" + `capabilities.md` §"Secrets."

**Requirements:** `secrets.supported: true` and `secrets.scopes` includes at least `user`. Hosts that advertise additional scopes (`tenant`, `run`) satisfy a richer subset; the predicate gates on the minimum.

**Predicate:**

```text
openwop-secrets(c) :=
     openwop-core(c)
  && c.secrets != null
  && c.secrets.supported === true
  && Array.isArray(c.secrets.scopes)
  && c.secrets.scopes.includes('user')
```

`tenant`-scoped secrets are an OPTIONAL add-on; the conformance suite reports `openwop-secrets` + advertised scope set separately.

### `openwop-provider-policy`

The host enforces AI provider policy modes per `capabilities.md` §`aiProviders.policies`.

**Requirements:** `aiProviders.policies.modes` is present and non-empty. The reference impl supports all four modes (`disabled`, `optional`, `required`, `restricted`). The predicate gates on at least `optional` being present (which every conforming policy host supports as the default no-restriction mode).

**Predicate:**

```text
openwop-provider-policy(c) :=
     openwop-core(c)
  && c.aiProviders != null
  && c.aiProviders.policies != null
  && Array.isArray(c.aiProviders.policies.modes)
  && c.aiProviders.policies.modes.length > 0
  && c.aiProviders.policies.modes.includes('optional')
```

The conformance suite verifies enforcement against the runtime; discovery-payload predicates prove the host advertises the contract.

### `openwop-replay-fork`

The host implements `POST /v1/runs/{runId}:fork` per `replay.md`.

**Requirements:** `replay.supported: true` AND `replay.modes` is a non-empty array. Conventional values for `replay.modes`: `'replay'` (deterministic re-execution from `fromSeq`), `'branch'` (divergent execution with optional `runOptionsOverlay`). A host that supports only `branch` mode satisfies the discovery predicate; `replayDeterminism.test.ts` skip-equivalents at runtime if `'replay'` mode is absent or stubbed.

**Predicate:**

```text
openwop-replay-fork(c) :=
     openwop-core(c)
  && c.replay != null
  && c.replay.supported === true
  && Array.isArray(c.replay.modes)
  && c.replay.modes.length > 0
```

This profile gates `replayDeterminism.test.ts` and `replay-fork.test.ts` scenarios. Hosts MAY support either or both modes; the conformance scenarios pass on whichever mode the host advertises.

### `openwop-fixtures`

The host advertises one or more conformance fixture workflows in the discovery payload's `fixtures` array per `capabilities.md` §`fixtures`. Added by RFC 0003.

**Requirements:** `fixtures` is a non-empty array of non-empty strings. Each entry is a fixture-workflow ID resolvable by `POST /v1/runs` `workflowId` on the host. Hosts that ship vendor-prefixed fixture IDs satisfy the profile; the conformance suite ignores IDs it doesn't recognize.

**Predicate:**

```text
openwop-fixtures(c) :=
     openwop-core(c)
  && Array.isArray(c.fixtures)
  && c.fixtures.length > 0
  && c.fixtures.every(id => typeof id === 'string' && id.length > 0)
```

A host that omits `fixtures` (pre-RFC 0003 hosts, or hosts that opted out) does not satisfy this profile and ~30 fixture-dependent conformance scenarios skip cleanly. The profile is discovery-payload-only — it confirms the host claims SOME fixture, not that any specific fixture is wired. Per-fixture skip decisions are made by the suite using the advertised list.

The v1.0 conformance baseline refuses to fail a fixture-dependent scenario unless the corresponding ID is advertised here. Older pre-reset suite artifacts are historical and not part of the OpenWOP v1.0 release line.

### `openwop-node-packs`

The host serves a node-pack registry per `node-packs.md` §"Registry HTTP API."

**Requirements:** The host responds 200 to `GET /v1/packs` with a list-shaped body. The discovery-payload predicate is structural; the runtime predicate is HTTP behavior.

**Predicate (discovery-payload only — runtime check separate):**

```text
openwop-node-packs-discovery(c) := openwop-core(c)
```

Discovery alone can't tell whether the registry endpoints are wired. The conformance scenarios in `pack-registry.test.ts` and `pack-registry-publish.test.ts` exercise the runtime; a host passes `openwop-node-packs` when it passes those scenarios.

A host MAY support read-only pack distribution (GET routes only — `openwop-node-packs-readonly`) or read/write (GET + PUT/POST/DELETE — `openwop-node-packs-publish`). The split sub-profiles are derivable from which scenarios pass; they don't appear in the discovery payload.

> **Runtime-derived, and how `--certify` treats it (2026-08-16, suite `1.117.0`).** Because the discovery predicate is `openwop-core` and RFC 0025 makes the `/v1/packs/*` read surface unadvertised-when-shipped, this profile is **runtime-derived** (`PROFILE_FLOOR_SCENARIOS['openwop-node-packs'].runtimeDerived`): a host *holds* it only when both floor scenarios record a witnessed `executed-pass`. `--certify` lists it in a bundle's `claimedProfiles` only when held; otherwise it is simply not claimed — reported as *not held*, never as a rejected or blocked claim. The two floor scenarios say why in the RFC 0148 §A ledger: `pack-registry.test.ts` records `inapplicable` with the probe result when no registry is mounted; `pack-registry-publish.test.ts` records `inapplicable` when `packs.testMode.supported` is not advertised (RFC 0025 §A optional seam — the host MAY still hold the read-only sub-profile) and `blocked` when it is advertised but `/v1/packs-test/*` answers 404 (an advertised-missing seam, which fails outright under `OPENWOP_REQUIRE_BEHAVIOR=true`). Before this every core host was "claiming" node-packs on the emitter's behalf and every reference host was rejected for a registry it never advertised (`docs/CERTIFICATION-BUNDLE-INVENTORY.md` rows 2–5, measured with `1.116.0`).

### `openwop-discovery-auth-scoped`

The host serves an authenticated capability view alongside the public unauthenticated payload per `capabilities-change-detection.md` §"Scoped capability views" (formalized as a capability flag by `RFCS/0011-auth-scoped-discovery.md`).

**Requirements:** When `Authorization: Bearer <key>` is presented to `/.well-known/openwop` (or to a host-advertised `endpointPath`), the host MAY return a narrowed or enriched capability view scoped to the caller. The authenticated view MUST still satisfy `capabilities.schema.json` (required fields preserved) and MUST NOT expose capabilities outside the caller's authorization — the unauthorized view's capability keyset MUST be a strict subset of an authorized caller's keyset.

**Predicate (discovery-payload only — runtime check separate):**

```text
openwop-discovery-auth-scoped(c) :=
    c.capabilities.discovery.authScoped.supported === true
  ∧ c.capabilities.discovery.authScoped.mode ∈ { 'same-endpoint', 'extension-endpoint', undefined }
  ∧ (c.capabilities.discovery.authScoped.mode === 'extension-endpoint'
        ⇒ c.capabilities.discovery.authScoped.endpointPath matches /^\//)
```

Three subtests in `conformance/src/scenarios/discovery.test.ts` validate the runtime behavior: capability shape, authenticated view satisfies the base schema, and the authorization-oracle probe (gated on `OPENWOP_TEST_UNAUTHORIZED_API_KEY`). A host passes `openwop-discovery-auth-scoped` when discovery passes the predicate AND those scenarios pass.

### `openwop-memory`

The host implements the reconciled memory-capability model per `agent-memory.md` §"Memory capability model" (RFC 0080) at the core tier: a read/write `MemoryAdapter` plus a cross-run durable store.

**Requirements:** `memory.supported: true` (the RFC 0004 four-op adapter) AND `memory.writable` is not `false` (writable — the back-compatible default; a read-only host sets `writable: false` and does NOT derive this profile) AND `agents.memoryBackends` includes `"long-term"`. Richer tiers (`-search`, `-managed`) are deferred per RFC 0080 §UQ4 — clients filter on the additive `memory.search` / `memory.retention` / `memory.attribution` / `memory.compaction` fields directly until a tier is needed.

**Predicate (discovery-payload only):**

```text
openwop-memory(c) :=
     openwop-core(c)
  && c.memory != null
  && c.memory.supported === true
  && c.memory.writable !== false
  && Array.isArray(c.agents?.memoryBackends)
  && c.agents.memoryBackends.includes('long-term')
```

(Capability families are document-root properties of the discovery payload per RFC 0073, so the predicate reads `c.memory` / `c.agents`, matching `openwop-replay-fork`.)

Derived purely from existing + the RFC 0080 additive fields — no new wire field beyond the §A dimensions. The degraded-projection contract (RFC 0080 §C: `GET /v1/agents` surfaces `memoryDegraded` when an agent's `memoryShape` exceeds the host's reconciled model) is validated by `memory-degraded-projection.test.ts` (gated on `agents.manifestRuntime` + `memory`); the additive field shapes are validated always-on by `memory-capability-model-shape.test.ts`.

### `openwop-trigger-bridge`

The host implements the durable inbound-work contract per `trigger-bridge.md` (RFC 0083) — a uniform composition of scheduling (RFC 0052), dead-letter (RFC 0053), queue-bus (RFC 0017), webhooks, and cross-host causation (RFC 0040).

**Requirements:** `triggerBridge.supported: true` AND `deadLetter.supported: true` (the RFC 0053 sink for exhausted deliveries) AND at least one durable inbound source — `queueBus.supported: true` OR `webhooks.durable: true` OR `scheduling.supported: true` OR (RFC 0099) an externally-ingested `email`/`form` source advertised in `triggerBridge.ingestion.externalSources[]`. A queue-only durable-inbound host is legitimately in the profile (RFC 0083 §UQ3 — the OR is intentional). The RFC 0099 disjuncts only **widen** the satisfying set — a host already in the profile stays in it (`profiles.md` §"Adding a profile": widening is additive).

**Predicate (discovery-payload only — runtime check separate):**

```text
openwop-trigger-bridge(c) :=
     openwop-core(c)
  && c.triggerBridge != null && c.triggerBridge.supported === true
  && c.deadLetter != null && c.deadLetter.supported === true
  && (   (c.queueBus != null && c.queueBus.supported === true)
       || (c.webhooks != null && c.webhooks.durable === true)
       || (c.scheduling != null && c.scheduling.supported === true)
       || (c.triggerBridge.ingestion != null
           && (   includes(c.triggerBridge.ingestion.externalSources, "email")
               || includes(c.triggerBridge.ingestion.externalSources, "form") )) )
```

Capability families are document-root properties (RFC 0073), so the predicate reads `c.triggerBridge` / `c.deadLetter` / `c.queueBus` / `c.webhooks` / `c.scheduling`. The runtime conformance scenarios (`trigger-bridge-delivery.test.ts`, profile-gated) verify the state machine + dedup + causation behavior; the always-on `trigger-bridge-shape.test.ts` asserts the subscription record + the two content-free `trigger.*` payloads + the predicate derivation. Channels (Slack/email/SMS) stay vendor extensions (RFC 0083 §E) — only their _bridge_ into a run is uniform.

### `openwop-experimental`

A host advertising at least one capability sub-block as a preview (RFC 0042). Unlike the other profiles, this one signals _instability_, not a feature set: clients that require stable-only contracts filter on its **negation**.

**Predicate:** any object-valued capability sub-block carries `tier: "experimental"` (with its required `experimentalUntil` sunset date, `capabilities.md` §"Capability stability tier").

```text
openwop-experimental(c) :=
     ∃ sub-block b ∈ c.capabilities.* : b.tier === 'experimental'
```

Derived purely from the existing `tier` field — no new wire field. The profile is intentionally coarse (host-level "some surface is preview"); per-capability stability is read directly off each sub-block's `tier`. A host with zero experimental capabilities does not derive this profile; a client depending only on `stable` surfaces requires `¬ openwop-experimental(c)` OR inspects the specific sub-blocks it consumes. The `experimental` capabilities themselves are enumerated, with their `experimentalUntil` dates, in `INTEROP-MATRIX.md` §"Experimental capabilities advertised". Conformance routing for experimental surfaces is the `experimentalGate` helper (`capabilities.md` §"Capability stability tier" → "Conformance routing"); the shape probes live in `conformance/src/scenarios/experimental-tier-shape.test.ts`.

---

## Derivation

The reference derivation for any conforming v1.x discovery payload `c` is:

```text
profiles(c) := {
  'openwop-discovery-core'             if openwop-discovery-core(c),
  'openwop-core'                       if openwop-discovery-core(c),   # deprecated alias — emitted together with the canonical name, never alone (RFC 0155 §A)
  'openwop-interrupts'                 if openwop-interrupts(c),
  'openwop-stream-sse'                 if openwop-stream-sse(c),
  'openwop-stream-poll'                if openwop-stream-poll(c),
  'openwop-secrets'                    if openwop-secrets(c),
  'openwop-provider-policy'            if openwop-provider-policy(c),
  'openwop-discovery-auth-scoped'      if openwop-discovery-auth-scoped(c),
  'openwop-node-packs'     if openwop-node-packs-discovery(c),
  'openwop-replay-fork'    if openwop-replay-fork(c),
  'openwop-fixtures'       if openwop-fixtures(c),
  'openwop-memory'         if openwop-memory(c),
  'openwop-trigger-bridge' if openwop-trigger-bridge(c),
  'openwop-experimental'   if openwop-experimental(c),
}
```

A reference TypeScript implementation lives in `@openwop/openwop-conformance` at `src/lib/profiles.ts`. SDKs MAY include a derivation helper; the spec doesn't require it.

The derivation is **deterministic and pure** — same input, same profile set. It MUST NOT depend on host-specific state, time-of-day, or fields outside the discovery payload.

---

## Claim vocabulary (RFC 0155 §A)

Normative for any public conformance statement — README, badge, `INTEROP-MATRIX.md` row, certification bundle, marketing copy:

- An **unqualified** "OpenWOP conformant" / "OpenWOP compatible" badge or statement **MUST** mean **`openwop-core-standard`** — the minimum executable floor (`core-standard-profile.md`; the manifest at `spec/v1/core-standard-manifest.json`), not the discovery predicate.
- A **discovery-only** claim **MUST** say **`openwop-discovery-core`** and **MUST NOT** use the same visual or textual badge as `openwop-core-standard` (RFC 0155 §E).
- Every claim **MUST** state all additional profiles it relies on (`openwop-interrupts`, `openwop-stream-sse`, extension profiles from `extensions.json`, …); an omitted profile is an unclaimed one.
- Certification bundle v2 (RFC 0148 §C) **MUST** name canonical profile IDs; the deprecated alias MAY appear only as an alias, never as the claimed id.
- Vendor extensions remain permitted but **MUST NOT** use an `openwop-*` id without an accepted RFC (RFC 0155 §F).

Deprecation guidance for the alias: hosts and SDKs that emit `openwop-core` today keep working for all of v1; they SHOULD add `openwop-discovery-core` beside it now, and consumers SHOULD read the canonical name first and fall back to the alias. Structural invariant `profile-claim-floor-not-overstated` (RFC 0155 §F) is named and not yet registered; the certification-floor gate (`certification-floor-enforcement.test.ts`) is the current mechanism.

## Profile semantics

A host **claims** a profile by satisfying its predicate AND passing the conformance scenarios labelled with the profile tag. A host **passes** a profile when both conditions hold against the suite version it reports.

Profile claims are reported in:

- The host's README or compatibility documentation.
- The `INTEROP-MATRIX.md` row for the host.
- The host's response to clients that query for profile membership (no protocol-defined endpoint; runtime-derived in the SDK).

A profile is NOT something a host advertises in the discovery payload. The discovery payload advertises capabilities; the profile is what conformance derives from those capabilities.

Operational annexes such as `auth-profiles.md`, `interrupt-profiles.md`, `production-profile.md`, `agent-platform-profile.md` (RFC 0085 — the `openwop-agent-platform` partial/full meta-profile), and `core-standard-profile.md` (RFC 0088 — the `openwop-core-standard` stable floor of black-box-proven MUSTs) define optional public-release claims. They are separate from this compatibility catalog because they combine runtime behavior, documentation, and conformance evidence rather than pure discovery-payload predicates.

---

## Adding a profile

New profiles are an additive change per `COMPATIBILITY.md` §2.1. The process:

1. File an RFC per `RFCS/0001-rfc-process.md` proposing the profile name, its predicate over capabilities, and the runtime conformance scenarios required to pass it.
2. The RFC ships with a same-PR update to `conformance/src/lib/profiles.ts` adding the derivation.
3. New conformance scenarios that gate on the profile use the profile tag in their `describe()` block.

Profiles MAY be deprecated via the `COMPATIBILITY.md` §7 deprecation policy (annotation + RFC; surface continues to behave through v1.x).

A new profile MUST NOT cause a previously-passing host to fail an existing profile. Profile predicates are append-only within v1.x.

---

## Why this is not a wire field

An earlier draft of this document proposed `capabilities.profiles: string[]` advertised in `/.well-known/openwop`. Reasons it was rejected:

1. **Two answers to one question.** A host could advertise `profiles: ["openwop-secrets"]` while `capabilities.secrets.supported = false` because two code paths set them. Derivation makes this impossible.
2. **Host redeploy.** Adding a wire field forces every host to redeploy. Derivation runs in the suite, no redeploy.
3. **Fragmentation risk.** With a wire field, hosts could advertise nonexistent profiles. With derivation, the closed catalog is enforced by the suite.

The derivation library is the single canonical implementation of profile membership.

---

## Open spec gaps

| ID        | Description                                                                                                                                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PROFILE-1 | Sub-profiles (`openwop-node-packs-readonly`, `openwop-node-packs-publish`) — deferred candidate. Derivable today from which scenarios pass; will be formalized via a successor RFC if a third-party host needs the split. |
| PROFILE-3 | RFC 0155 §A rename landed 2026-08-16 (`openwop-discovery-core` canonical, `openwop-core` deprecated alias, both derived together — `profile-discovery-core-alias.test.ts`). Open: registering `profile-claim-floor-not-overstated`; (correction 2026-08-16: `certification-bundle-v2.schema.json` has always carried `aliases`; `--certify` now populates it and keeps `openwop-core` out of `claimedProfiles`); badge artwork/text distinction is a site concern. |
| PROFILE-2 | ✅ Closed in the v1.0 conformance baseline. Profile-gated scenarios use `describe.runIf(profile)`; the conformance runner exposes `--profile=<name>` to filter.                                                           |

---

## References

- `capabilities.md` — discovery-payload shape that profiles derive from.
- `interrupt.md` — interrupt protocol that `openwop-interrupts` references.
- `stream-modes.md` — streaming transports that `openwop-stream-sse` and `openwop-stream-poll` reference.
- `run-options.md` — credential references that `openwop-secrets` references.
- `node-packs.md` — registry HTTP API that `openwop-node-packs` references.
- `COMPATIBILITY.md` — additive-change discipline that gates new profiles.
- `RFCS/0001-rfc-process.md` — RFC mechanism for adding profiles.
- `INTEROP-MATRIX.md` — per-host profile pass/skip table.
