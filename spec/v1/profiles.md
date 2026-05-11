# openwop Spec v1 — Compatibility Profiles

> **Status: FINAL v1 (2026-05-05; `openwop-fixtures` added 2026-05-07 via RFC 0003).** Profiles are an additive layer over v1 capabilities. They MUST be derivable from existing `/.well-known/openwop` fields without a wire-shape change. Graduated DRAFT → FINAL via RFC 0003. See `auth.md` for the status legend. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

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

Nine v1.x compatibility profiles. The catalog is closed: new compatibility profiles require an RFC per `RFCS/0001-rfc-process.md`.

### `openwop-core`

The minimum any conforming host MUST satisfy.

**Requirements:**
- `protocolVersion` is set to a `1.x.x` semver string.
- `supportedEnvelopes` is an array (MAY be empty for engine-only hosts that don't expose LLM-emitting nodes).
- `schemaVersions` is an object with non-negative integer values.
- `limits.clarificationRounds`, `limits.schemaRounds`, `limits.envelopesPerTurn` are all non-negative integers.

**Predicate:**

```
openwop-core(c) :=
     typeof c.protocolVersion == 'string'
  && c.protocolVersion.startsWith('1.')
  && Array.isArray(c.supportedEnvelopes)
  && typeof c.schemaVersions == 'object'
  && typeof c.limits == 'object'
  && Number.isInteger(c.limits.clarificationRounds) && c.limits.clarificationRounds >= 0
  && Number.isInteger(c.limits.schemaRounds)         && c.limits.schemaRounds >= 0
  && Number.isInteger(c.limits.envelopesPerTurn)     && c.limits.envelopesPerTurn >= 0
```

A host that fails `openwop-core` is not openwop-compatible. Every other profile implies `openwop-core`.

### `openwop-interrupts`

The host implements the interrupt/resume protocol per `interrupt.md`.

**Requirements:** This profile is satisfied by every conforming v1 host (interrupts are non-optional in v1 per `interrupt.md` §"Why this exists"). The profile exists so that downstream tooling can declare a dependency on interrupt-resume semantics explicitly.

**Predicate:**

```
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

```
openwop-stream-sse(c) :=
     openwop-core(c)
  && (c.supportedTransports == null || c.supportedTransports.includes('rest'))
```

This is a runtime profile: discovery-payload alone can't fully validate SSE behavior. Conformance scenarios in `stream-modes.test.ts`, `stream-modes-buffer.test.ts`, and `stream-modes-mixed.test.ts` exercise the wire behavior. A host passes `openwop-stream-sse` when discovery passes the predicate AND those scenarios pass.

### `openwop-stream-poll`

The host accepts polling on the events endpoint per `stream-modes.md` §"Polling mode."

**Requirements:** Polling is the fallback transport for clients that can't hold long-lived connections. A host advertises support implicitly by serving `GET /v1/runs/{runId}/events/poll` per `rest-endpoints.md`.

**Predicate:** Same shape as `openwop-stream-sse` — runtime validated. Conformance scenarios in `stream-modes.test.ts` exercise polling.

```
openwop-stream-poll(c) :=
     openwop-core(c)
  && (c.supportedTransports == null || c.supportedTransports.includes('rest'))
```

A host MAY satisfy both `openwop-stream-sse` and `openwop-stream-poll`; in v1 most reference hosts do.

### `openwop-secrets`

The host implements credential resolution per `run-options.md` §"Credential references" + `capabilities.md` §"Secrets."

**Requirements:** `secrets.supported: true` and `secrets.scopes` includes at least `user`. Hosts that advertise additional scopes (`tenant`, `run`) satisfy a richer subset; the predicate gates on the minimum.

**Predicate:**

```
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

```
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

```
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

```
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

```
openwop-node-packs-discovery(c) := openwop-core(c)
```

Discovery alone can't tell whether the registry endpoints are wired. The conformance scenarios in `pack-registry.test.ts` and `pack-registry-publish.test.ts` exercise the runtime; a host passes `openwop-node-packs` when it passes those scenarios.

A host MAY support read-only pack distribution (GET routes only — `openwop-node-packs-readonly`) or read/write (GET + PUT/POST/DELETE — `openwop-node-packs-publish`). The split sub-profiles are derivable from which scenarios pass; they don't appear in the discovery payload.

---

## Derivation

The reference derivation for any conforming v1.x discovery payload `c` is:

```
profiles(c) := {
  'openwop-core'           if openwop-core(c),
  'openwop-interrupts'     if openwop-interrupts(c),
  'openwop-stream-sse'     if openwop-stream-sse(c),
  'openwop-stream-poll'    if openwop-stream-poll(c),
  'openwop-secrets'        if openwop-secrets(c),
  'openwop-provider-policy' if openwop-provider-policy(c),
  'openwop-node-packs'     if openwop-node-packs-discovery(c),
  'openwop-replay-fork'    if openwop-replay-fork(c),
  'openwop-fixtures'       if openwop-fixtures(c),
}
```

A reference TypeScript implementation lives in `@openwop/openwop-conformance` at `src/lib/profiles.ts`. SDKs MAY include a derivation helper; the spec doesn't require it.

The derivation is **deterministic and pure** — same input, same profile set. It MUST NOT depend on host-specific state, time-of-day, or fields outside the discovery payload.

---

## Profile semantics

A host **claims** a profile by satisfying its predicate AND passing the conformance scenarios labelled with the profile tag. A host **passes** a profile when both conditions hold against the suite version it reports.

Profile claims are reported in:

- The host's README or compatibility documentation.
- The `INTEROP-MATRIX.md` row for the host.
- The host's response to clients that query for profile membership (no protocol-defined endpoint; runtime-derived in the SDK).

A profile is NOT something a host advertises in the discovery payload. The discovery payload advertises capabilities; the profile is what conformance derives from those capabilities.

Operational annexes such as `auth-profiles.md`, `interrupt-profiles.md`, and `production-profile.md` define optional public-release claims. They are separate from this compatibility catalog because they combine runtime behavior, documentation, and conformance evidence rather than pure discovery-payload predicates.

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

| ID | Description |
|---|---|
| PROFILE-1 | Sub-profiles (`openwop-node-packs-readonly`, `openwop-node-packs-publish`) — deferred candidate. Derivable today from which scenarios pass; will be formalized via a successor RFC if a third-party host needs the split. |
| PROFILE-2 | ✅ Closed in the v1.0 conformance baseline. Profile-gated scenarios use `describe.runIf(profile)`; the conformance runner exposes `--profile=<name>` to filter. |

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
