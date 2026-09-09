# OpenWOP Spec v1 — Version Negotiation and Deploy-Skew Safety

> **Status: Stable · v1.1 (2026-04-27).** Comprehensive coverage of all four version axes (engine, per-run event-log, per-event, runtime pinning). Stable surface for external review. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). See `auth.md` for the status legend.

---

## Why this exists

Long-running workflows persist state. State written by engine version N may be read by engine version N+1 (forward) or — in a botched deploy — by engine version N-1 (backward / "deploy skew"). Without a version contract, a backward read can silently lose state added in N+1; a forward read can crash on unfamiliar fields. Separately, workflows that have been _running_ for hours or days may need to evolve their behavior without invalidating the runs already in flight.

openwop defines **four independent versioning axes** that callers and servers MUST track. Three are _schema_ axes (writer/reader compatibility); one is a _runtime branching_ axis (in-flight run determinism):

1. **Engine version** (`engineVersion`) — semantic version of the engine code that wrote a run's persisted state. Bumped when run-doc shape changes (renamed/added/removed required field, semantic change).
2. **Event-log schema version, per-run** (`eventLogSchemaVersion`) — version of the event-log _subcollection_ format. Bumped on breaking changes to `RunEventDoc` envelope shape or path semantics.
3. **Event-log schema version, per-event** (`schemaVersion` on each `RunEventDoc`) — version of an _individual_ event-payload contract. Bumped when a specific event type's payload changes shape.
4. **Pinned change versions** (`version.pinned` events) — Temporal-style per-(run, changeId) branch pins. Bumped by node authors via `ctx.getVersion(changeId, min, max)` to evolve workflow behavior without breaking in-flight runs.

The four are decoupled because they evolve at different rates and have different correctness guarantees. The three schema axes are deploy-coordinated; the pinning axis is runtime-pinned per-run.

---

## Protocol version grammar

`protocolVersion` in `/.well-known/openwop` identifies the **spec** the host speaks. It is
distinct from all four axes above, which describe persisted documents and run-local branch
pins rather than the wire contract.

It **MUST** be ASCII `<major>.<minor>` matching:

```text
^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$
```

No leading zero except zero itself. `1.0` and `1.12` are valid; `1`, `1.0.0`, `v1.0`, and
`01.0` are not.

- The integer **major** is the hard compatibility boundary.
- The integer **minor** is the additive contract level.
- **Patch does not exist on this axis.** It belongs to suite and SDK versions, which move
  independently of the spec.

Hosts **MUST** advertise the highest protocol minor they implement. Consumers **MUST**
reject a different unsupported major, and **MUST** tolerate a higher minor under v1 additive
rules while capability-gating any optional behavior it might carry.

### `protocolVersions[]` — every major.minor the host speaks (RFC 0165 §A)

A host MAY additionally advertise `protocolVersions: string[]` at the discovery root: every
`<major>.<minor>` it serves, newest first by convention, each item under the grammar above
(not the looser A2A/MCP item pattern). When present it **MUST** contain the value of
`protocolVersion` and **MUST NOT** name a major the host does not serve; a v1.x host advertises
`["1.<minor>"]` until it serves v2. Consumers **MUST** treat an absent array as
`[protocolVersion]`. Profile derivation (`profiles.md`) reads the scalar only in v1.x. The
array exists so a host can advertise both majors during the v2 transition
(`COMPATIBILITY.md` §5); v2 defines the negotiation that acts on it.

**The `engineVersion` axis is split, and this is recorded rather than fixed.** The discovery
root declares `engineVersion` as an integer; `run-event.schema.json`, `run-snapshot.schema.json`
and three event payloads carry it as a string. Changing either type is a `COMPATIBILITY.md`
§2.2 break, so in v1.x the per-event value is the decimal string rendering of the root integer,
and unification is scheduled for v2 (`spec/v1/deprecations.json`,
`openwop.deprecation.engine-version-type-split`).

> **Why a pattern and not just prose (RFC 0149 §C).** The field was specified three
> incompatible ways at once: `capabilities.schema.json` constrained it to `minLength: 1`,
> the suite's core predicate tested `startsWith('1.')`, and prose called it semver while
> every example showed two components. So `"v1.0"`, `"1.0.0"`, and `"banana"` all validated,
> and `"1.0.0"` additionally *derived* `openwop-core`. Comparison needs an integer major and
> an integer minor; neither can be extracted from a string nothing constrains, which left
> two hosts advertising `"1.0"` and `"1.0.0"` with no way for a consumer to tell a patch
> convention from a typo from a different protocol. Closes gap V2.

---

## Engine version

### Stamping

Every persisted run document MUST carry an `engineVersion: number` field set to the writer engine's `CURRENT_ENGINE_VERSION` constant at write time. Servers MAY omit this field on legacy runs that predate the contract; readers MUST treat absent values as "compatible" (best-effort backward read).

Host implementations SHOULD define a single `CURRENT_ENGINE_VERSION` constant and stamp every write through the run persistence layer.

### Reader safety check

When a reader fetches a persisted run, it MUST call an equivalent of `assertEngineVersionCompatible(runId, persistedVersion)`:

| Persisted version          | Action                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------- |
| `undefined`                | Treat as compatible (legacy doc)                                                    |
| `≤ CURRENT_ENGINE_VERSION` | Safe to read                                                                        |
| `> CURRENT_ENGINE_VERSION` | **Refuse** — throw `EngineVersionMismatchError` (`code: "engine_version_mismatch"`) |

The third case represents a deploy skew: the doc was written by a newer engine the current reader doesn't understand. The reader MUST refuse rather than fall through, because silent best-effort reads will:

- Lose fields the reader doesn't know exist
- Misinterpret reused field names with new semantics
- Corrupt the doc on the next write-back (since the reader will re-stamp with its own lower `CURRENT_ENGINE_VERSION`)

### Error surface

<!-- normative-example: error-envelope.schema.json -->
```json
{
  "error": "engine_version_mismatch",
  "message": "Run R was persisted by engine version 3; current engine is version 2. Refusing to resume.",
  "details": {
    "runId": "string",
    "persistedVersion": 3,
    "currentVersion": 2
  }
}
```

An OpenWOP-compliant server MUST surface this through `ResumeRunResult`-style return shapes (not swallowed) so the caller's UI can render a "system is upgrading, please retry" banner. The CLI/SDK SHOULD surface it as a recognizable distinct error rather than a generic 5xx.

### Bumping protocol

Implementers SHOULD follow this sequence when changing persistence shape:

1. Land the new persistence shape behind a feature gate or in a way that's optional on read.
2. Bump `CURRENT_ENGINE_VERSION` after the writer change is deployed.
3. Register a forward migration ("schema codemod") that converts older docs to the new shape on read OR on a background backfill. Until the migration ships, the bump is a deploy-skew safety net only.
4. Document the change in the implementation's CHANGELOG and bump SDK versions that pin to a particular `engineVersion` floor.

---

## Event-log schema version

### Stamping

Every persisted run document MUST carry an `eventLogSchemaVersion: number` field. The current v1 value is `2`.

Distinct from `engineVersion` because event-log evolution is more frequent. Adding a new optional event type (e.g., `node.retried`) doesn't break readers that ignore unknown event types; renaming or repurposing an existing type does.

### Legacy detection

Hosts identify an older run document as legacy when `eventLogSchemaVersion` is undefined or `< 2`. An OpenWOP-compliant server MUST treat legacy runs differently in two regards:

1. **No event subcollection.** Legacy runs were persisted as snapshot-only; `runs/{runId}/events/{seq}` doesn't exist. Readers MUST fall back to the snapshot for state.
2. **No projection cache write-through.** Legacy runs predate `EventLog.onAppend`-driven projection caching.

An OpenWOP-compliant server MAY surface a banner inviting the operator to complete or cancel legacy runs to migrate to the v2 path. Hosts MAY provide their own batch-cancellation or migration tooling as an operational convenience.

### Bumping

Bump `eventLogSchemaVersion` when any of:

- An event type is renamed or repurposed
- An event payload's required fields change shape in a non-backward-compatible way
- Sequence semantics change (e.g., gap-fill rules)
- The run-doc _path_ changes (e.g., the v1 → v2 move from `users/{u}/canvases/...` to top-level `runs/{runId}`)

Adding new optional event types or new optional payload fields does NOT require a bump (current readers ignore them).

---

## Per-event schema version

### Stamping

Each individual event document inside `runs/{runId}/events/{seq}` carries its own `schemaVersion: number` field, stamped at append time by `EventLog.appendAtomic`. This is **distinct** from the per-run `eventLogSchemaVersion`:

- Per-run `eventLogSchemaVersion` describes the _subcollection contract_ (does this run even have an event subcollection? what path?).
- Per-event `schemaVersion` describes the _individual event payload contract_.

The current v1 per-event schema version is `1`.

### Reader behavior

Per-event readers MUST be tolerant. The compatibility table:

| Reader version | Event-stamped version | Behavior                                                                                    |
| -------------- | --------------------- | ------------------------------------------------------------------------------------------- |
| N              | unset                 | Legacy event from pre-EventLog days. Reader folds best-effort.                              |
| N              | ≤ N                   | Compatible — current shape contract                                                         |
| N              | > N                   | Future shape — reader folds what it recognizes, ignores unknown fields. **MUST NOT throw.** |

Tolerance is intentional: the projection's job is to produce best-possible state from whatever events exist. A future event with extra fields shouldn't break replay of earlier events with the older shape.

### Bumping

Bump the per-event `schemaVersion` stamp when an _individual_ event type's payload contract changes in a non-additive way. Additive changes (new optional fields) don't require a bump. This is distinct from bumping the per-run `eventLogSchemaVersion` (§"Event-log schema version" → "Bumping" above), which tracks the subcollection contract, not individual payload shapes.

---

## Pinned change versions (Temporal-style)

### Why

Schema versioning protects readers from writers; it doesn't help an _in-flight run_ whose code branch was changed mid-execution. A workflow started under code that says "capture payment, then notify" cannot safely switch mid-stream to "notify first, then capture" — the run has already done the first half under the old branch.

This is the [Temporal versioning](https://docs.temporal.io/dev-guide/typescript/versioning) idiom: per-(run, changeId) version pinning at first encounter, replayed deterministically on resume.

### API

```typescript
const v = await ctx.getVersion('payment-capture-flow', 1, 2);
if (v === 1) {
  // legacy: capture before notifying
} else {
  // v === 2: notify before capture
}
```

An OpenWOP-compliant engine MUST expose `ctx.getVersion(changeId: string, min: number, max: number): Promise<number>` on `NodeContext`.

Semantics:

- The **first** call for `(runId, changeId)` returns `max` and persists a `version.pinned` event with `{ changeId, version: max }`.
- **Subsequent** calls (same run, including after replay or recovery) return the pinned value — guaranteeing in-flight runs follow the branch they started on.
- Reading the pin uses `findPinnedVersion(events, changeId)` — a pure helper that scans the event stream.
- `min` and `max` MUST be integers with `max >= min`. Implementations MUST throw on invalid input (validation error, not a runtime version mismatch).

### `version.pinned` event

An OpenWOP-compliant engine MUST emit a `version.pinned` `RunEventType` on first encounter:

```json
{
  "type": "version.pinned",
  "payload": { "changeId": "string", "version": "number" }
}
```

The fold doesn't track versions specially — they're consulted by the executor via `findPinnedVersion`. Replay-determinism is automatic because pinned values are durable events.

### Bumping `min` (removing a branch)

Removing an old branch is signaled by raising `min` above a previously-supported value. A run that pinned the deprecated value MUST receive `VersionOutOfRangeError` on the next `ctx.getVersion` call:

```typescript
class VersionOutOfRangeError extends Error {
  readonly code = 'version_out_of_range';
  readonly runId: string;
  readonly changeId: string;
  readonly pinnedVersion: number;
  readonly currentMin: number;
  readonly currentMax: number;
}
```

This is intentional: silent "follow nonexistent code" behavior is a worse failure mode than a loud error pointing at the deprecated pin. The runbook MUST instruct operators to drain or migrate runs holding deprecated pins before raising `min`.

### Default version

An OpenWOP-compliant engine MAY define a `DEFAULT_VERSION = -1` sentinel (Temporal compatibility). The `min` parameter MAY be `-1` to capture pre-versioning behavior; readers MUST handle this without throwing.

---

## Capability handshake (forward reference)

An OpenWOP-compliant server MUST expose `GET /.well-known/openwop` returning a `Capabilities` object that includes both versions plus a richer compatibility surface. See `capabilities.md` for the required and optional v1 discovery fields.

Minimum required `Capabilities` fields for version negotiation:

```json
{
  "protocolVersion": "1.0",
  "engineVersion": 1,
  "eventLogSchemaVersion": 2,
  "minClientVersion": "1.0"
}
```

A client MAY pre-flight `/.well-known/openwop` and compare against its own pinned floor before issuing requests. A server MAY reject requests from clients reporting `User-Agent: openwop-sdk/<v>` below `minClientVersion` with HTTP `426 Upgrade Required`.

---

## Cross-version interop matrix

| Reader engine  | Writer engine | Behavior                                                                                                                                  |
| -------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| N              | N             | Normal operation                                                                                                                          |
| N              | N-1 (older)   | Reader reads, MAY upgrade-on-write if migration registered. Without migration, reader writes back at N (older fields preserved as opaque) |
| N              | N+1 (newer)   | Reader refuses (`engine_version_mismatch`). Caller must wait for fleet to roll forward.                                                   |
| N (no version) | N             | Reader treats as legacy. Reads succeed; no migration needed.                                                                              |

### Conformance via `X-Force-Engine-Version`

The matrix above is verifiable without requiring multiple deployed engine versions: the conformance scenario `conformance/src/scenarios/version-fold.test.ts` exercises it via a test-keys-only request header `X-Force-Engine-Version: <integer>`, which instructs the server to emit events for that run AS IF it were running the named engine version.

- Servers MUST reject on production keys with `403 force_engine_version_forbidden`.
- Servers advertise the supported range via `Capabilities.testing.forceEngineVersionRange = { min, max }`. Range typically spans `[current-1, current+1]` so back-compat AND forward-compat are exercisable from the same fixture.
- Outside the advertised range → `400 unsupported_force_engine_version` with the supported range in the body.

The conformance fixture `conformance-version-fold` (see `conformance/fixtures.md`) exercises the matrix by running a single noop workflow once per supported version and asserting that:

1. Each run reaches terminal `completed`.
2. `GET /v1/runs/{runId}` returns a valid `RunSnapshot` for each (forward-compat fold-best-effort tolerates the version mismatch).
3. The event log is readable via `GET /v1/runs/{runId}/events/poll` for each run.

### `events/poll` forward-compat tolerance (normative)

`GET /v1/runs/{runId}/events/poll` accepts an optional cursor parameter naming the highest sequence number the caller has already observed. The canonical parameter name is `lastSequence`; hosts MAY also accept `since` for back-compat with pre-v1.0 deployments, but `lastSequence` is authoritative.

A request with `lastSequence` strictly greater than the run's current highest event sequence MUST return `200 OK` with the canonical response envelope and an empty `events` array. Hosts MUST NOT return `400`, `404`, `416`, or any other status for the "past-end" case — that pattern is the forward-compat recovery path used by clients that recover from a deploy that renumbered the sequence space, and MUST be benign.

The response shape for past-end requests:

```json
{
  "runId": "<runId>",
  "events": [],
  "lastEventSeq": <integer>,
  "runStatus": "<RunStatus>",
  "isTerminal": true | false
}
```

`lastEventSeq` echoes the caller's `lastSequence` when nothing newer exists, OR the run's highest emitted sequence when the host can determine it; either is acceptable. `isTerminal` reflects the run's current status.

---

## Deploy ordering decision matrix

The interaction between the four version axes determines deploy ordering. An OpenWOP-compliant deployment SHOULD adopt a "server-first" rollout convention so the writer is always at-or-ahead-of every reader (browser, CLI, SDK):

| Change                                               | Bumps                         | Drain in-flight?                                              | Deploy order                                       |
| ---------------------------------------------------- | ----------------------------- | ------------------------------------------------------------- | -------------------------------------------------- |
| Add optional field to run doc                        | None (additive)               | No                                                            | Server first                                       |
| Add required field to run doc                        | `engineVersion`               | Drain ⚠️ (clean state simplifies debug)                       | Server first, with codemod that defaults the field |
| Rename run doc field                                 | `engineVersion`               | Drain ⚠️                                                      | Server first, with codemod                         |
| Add new RunEventType                                 | None (readers ignore unknown) | No                                                            | Server first                                       |
| Remove a RunEventType                                | `eventLogSchemaVersion`       | **Drain ✗** (already-emitted events become unreadable)        | Server first                                       |
| Change existing event payload contract               | per-event `schemaVersion`     | Drain ⚠️                                                      | Server first                                       |
| Change run-doc _path_                                | `eventLogSchemaVersion`       | **Drain ✗**                                                   | Server first                                       |
| Add new branch via `ctx.getVersion(id, min, M)`      | `max` (M+1)                   | No (in-flight runs stay on old `M`)                           | Either order — pinning is per-run                  |
| Remove old branch via `ctx.getVersion(id, M+1, ...)` | `min` (M+1)                   | **Drain or migrate** runs holding pinned ≤ M, else they error | Server first                                       |

⚠️ = optional but recommended
✗ = mandatory (otherwise data is stranded)

---

## Channel resolution + replay

> Additive v1.x extension (RFC 0082). Applies only to hosts advertising `capabilities.agents.deployment.supported: true`.

A deployment **channel** (`AgentRef.channel`, e.g. `stable` / `canary` / the reserved `latest`) is a fifth, agent-scoped instance of the **pinning** axis above (§"Pinned change versions"): it is runtime-pinned per-run, not deploy-coordinated. When a run binds `agentId@channel`, the host **MUST** resolve the channel to a concrete agent-definition `version` at the **first resolution** of that `(agentId, channel)` pair within the run, and **MUST** reuse that pinned version for every subsequent resolution of the same pair in the same run — it **MUST NOT** re-resolve against a channel that has moved mid-run. The resolved version is a **recorded fact** carried on `agent.invocation.started.resolvedAgentVersion` (a recorded-fact event per `replay.md`); on `POST /v1/runs/{runId}:fork` and on `replay`-mode re-execution the host **MUST** re-read it and **MUST NOT** re-resolve the channel. A canary traffic-split draw is performed once as part of this first-resolution pin and is likewise never re-rolled on replay. A channel that resolves to no `active` version fails the run with `no_active_deployment`. See [`agent-deployment.md`](./agent-deployment.md) §B for the full contract.

---

## Layer-2 effect identity v2

> Safety-fix (RFC 0150 §B), `idempotency.md` v1.2. Applies to every host that performs
> external side effects — there is no capability to gate it on, because the composition it
> replaces was never optional.

Through `idempotency.md` v1.1 the Layer-2 identity was
`sha256(runId ':' nodeId ':' attempt ':' providerKey)`. Because `attempt` is the retry
counter, that key changed on every retry, and the deduplication the layer promises could
never fire. v1.2 replaces it with the domain-separated, tenant-bound composition over
`logicalInvocationOrdinal` — see [`idempotency.md`](./idempotency.md) §"Idempotency key
composition".

This is **not** one of the four version axes above. The identity is engine-internal: it
never appears on the wire between a caller and a host, it is not stamped on an event, and no
client negotiates it. A host may therefore migrate unilaterally, without deploy
coordination and without a `protocolVersion` bump.

The operator sequence:

1. **Upgrade.** Compute v2 identities for logical activities created after the upgrade. Do
   not recompute identities for activities already in flight — an in-flight activity that
   changes identity mid-retry is the very failure being fixed.
2. **Leave the old entries alone.** v1 entries in the invocation log **MUST NOT** be
   rewritten or back-filled. They expire under their existing TTL (§"Engine guarantees"
   recommends 14 days). The `openwop:activity:v2` domain tag is what makes coexistence safe:
   a v1 and a v2 identity for the same effect cannot collide.
3. **Expect one window of reduced dedup.** Activities that started under v1 and retry after
   the upgrade get a v2 identity and miss the log, so the effect is re-performed once. This
   is bounded by the longest single activity's retry horizon, not by the TTL. Operators who
   cannot accept even that window should drain in-flight activities before upgrading —
   the same drain pattern as V5 below.
4. **Do not mix within a deployment.** Two engine instances serving the same tenant **MUST**
   agree on the composition version, or a retry that lands on the other instance computes a
   different identity and re-performs the effect. Roll all instances before resuming
   retries, or accept the same one-window cost above.

Replay is unaffected. The identity was never a recorded fact — it is recomputed from
`(tenantId, runId, nodeId, ordinal, providerKey)`, all of which a replay already has — so
`POST /v1/runs/{runId}:fork` against a historical checkpoint behaves exactly as before.
Layer 2 still does not survive a fork, for the unchanged reason that `runId` is in the
preimage; see `idempotency.md` §"Layer 2 does not survive a fork".

---

## Multi-region effect-posture vocabulary

> Safety-fix (RFC 0150 §D), `idempotency.md` v1.3. Affects only hosts that advertise
> `capabilities.idempotency.crossRegion` or the `multiRegion` sub-block.

Unlike the Layer-2 identity change above, this **is** a wire change: the advertised enum
values differ, so a host and a client can disagree across a deploy.

| Old value | New value | Why |
| --- | --- | --- |
| `crossRegion: "best-effort"` | `"reconciled-records"` | Same meaning, honest name — it always described *record* convergence |
| `crossRegion: "strict"` | *(removed)* | A read-visibility latency claim in an effect-safety slot; see `idempotency.md` §"Recovery postures" |
| — | `crossRegion: "fenced-effects"` | New, strictly stronger: every effect fenced or provider-idempotent |
| `partitionRecoveryStrategy: "last-writer-wins"` / `"first-writer-wins"` | `"lexicographic-min-run-id"` | Time-ordered rules cannot produce a reproducible survivor without a shared clock |

The operator sequence:

1. **Do not map `strict` to `fenced-effects`.** A host previously advertising `strict` has
   evidence of bounded read-visibility and **no** evidence of fencing. Re-advertise as
   `reconciled-records` unless the fencing requirement in `idempotency.md`
   §"Reconciliation does not authorize effects" is actually met, and keep the latency claim
   where it belongs — in `multiRegion.replicationLagBoundMs`, which is unchanged.
2. **Roll clients before hosts.** A client validating discovery against the old closed enum
   rejects `reconciled-records` and `fenced-effects`. This is the reverse of the usual
   ordering, because the *host's* document is what changes shape.
3. **Re-derive the recovery strategy, do not translate it.** A host that implemented
   `last-writer-wins` was not conforming — the annex has always MUSTed lex-min(runId), and a
   clock-ordered winner contradicts it. Advertising `lexicographic-min-run-id` is a claim
   about the resolver, so verify the resolver first rather than renaming the advertisement.
4. **Classify what you cannot fence.** A host that can offer neither a fencing token nor a
   duplicate-suppressing provider **MUST** classify affected effects `at-least-once-risk`
   rather than silently advertising the lower posture and leaving the risk unnamed.

No `protocolVersion` bump: the enum is an optional capability value, and hosts that
advertise no `crossRegion` at all are unaffected in both directions.

---

## Canonical URL resolution (RFC 0149 §A — the `/v1/v1` correction)

> Safety-fix (RFC 0149 §A). Affects **generated clients and anything that composed a base
> URL from `api/openapi.yaml`'s `servers` entry**. Hosts are unaffected: no endpoint moved.

The OpenAPI document declared `servers: [{ url: "https://{host}/v1" }]` while every path
already began with `/v1`. A generator that composes `server.url + path` therefore produced
**`https://{host}/v1/v1/runs`**. The correction drops the prefix from `servers`:

```diff
 servers:
-  - url: https://{host}/v1
+  - url: https://{host}
```

**The hazard is that the bug was survivable.** A consumer that hit `/v1/v1` and worked
around it — by stripping the duplicate, by hard-coding a base without the suffix, or by
patching the spec locally — has a workaround that the correction **turns into a new bug**,
because the same composition now yields `https://{host}/runs`. This is the case RFC 0147's
register tracks as R6.

| Who | What | When |
| --- | --- | --- |
| **SDK / client generator** | Regenerate against the corrected `api/openapi.yaml`. If you carried a workaround for the duplicate prefix, **remove it in the same change** — the two corrections cancel, and applying either alone is broken. | Before upgrading past the corrected document. |
| **Hand-written client** | Verify your base URL has no `/v1` suffix; paths supply it. | Any time — the resolved URL is unchanged if you were already correct. |
| **Host operator** | Nothing. No route moved and no request shape changed. A host that answered `/v1/runs` before answers it now. | — |
| **Anyone unsure** | `scripts/generate-operation-path-manifest.mjs` emits the canonical resolved path for every operation. Compare against what your client actually requests. | — |

**Detection.** A client on the old composition requests a path with a doubled prefix; a
client with an un-removed workaround requests one with no prefix. Both are visible in a
single request log, and both 404 against a conforming host — the failure is loud, not silent.

No `protocolVersion` bump: the wire contract is unchanged. What changed is the document that
describes how to address it.

---

## Certification-evidence migration (RFC 0148 — bundle v1 → v2)

RFC 0148 classified certification evidence as a `safety-fix` (`COMPATIBILITY.md` §3): bundle **v1** (`results.passed[]` lists) counted an early-returning test as a pass and could not tell `skipped` from `inapplicable` from `blocked`. This runbook is what implementers and consumers do about it.

| Who | What | When |
| --- | --- | --- |
| **Host operator** (publishing evidence) | Regenerate with `openwop-conformance --certify <out.json> --bundle-version 2` against a suite ≥ `1.114.0` (dispositions + `assertionCount` per requirement, `blocked` total REQUIRED, evidence scrubbed of the handed credential / `OPENWOP_*` secrets / the SR-1 canary). Publish the v2 file beside (not instead of) any v1 file for the window; link it from `capabilities.conformance.certificationBundleUrl` if you advertise one. A bundle with `blocked > 0` is honest evidence that does not certify the blocked claims — publish it anyway. | Now; v1 ceases to substantiate a **new** certification 90 days after 2026-08-12 (2026-11-10). |
| **Consumer** (badge / interop matrix / procurement) | Re-derive with `verifyBundleV2` (`conformance/src/lib/certification-bundle-verify.ts`): `evidenceValid` (no unwitnessed / vacuous / duplicate / tampered / canary rows) and per-profile `certified`. Treat a v1 bundle as a *measurement*, not a claim, after the window; before it, read v1 `passed[]` knowing it may include zero-assertion passes. Never trust `claimedProfiles` verbatim (RFC 0089 §B(1)). | Now. |
| **Reference hosts** | Already reissued as v2 (`openwop-examples#14`, 2026-08-16; `docs/CERTIFICATION-BUNDLE-INVENTORY.md` rows 2–5). | Done. |
| **Suite** | v1 emission (`--bundle-version 1`) stays for the window; the emitter scrubs v1 too. After the window the default flips to v2 (a suite minor); v1 remains parseable. | Window end. |

Nothing on the wire changes: discovery, runs, events are untouched. Only what a certification *claim* is allowed to rest on changes.

## Combined SAML + SCIM hosts (RFC 0164 — the leaver contract is implied)

RFC 0164 (`additive`, 2026-09-02) made the SCIM ⟷ SAML leaver contract (`auth-profiles.md` §"Subject linking (SAML ⟷ SCIM)") follow the **profile pair**: a host that advertises both `openwop-auth-saml` and `openwop-auth-scim` is bound whether or not it sets `capabilities.auth.subjectLinking`, and MUST advertise `subjectLinking: true` + `subjectLinkKey`. No production host advertised both at filing, so no deployed host changes status; this section exists for the first one that does.

| Who | What | When |
| --- | --- | --- |
| **Host operator** advertising both profiles today (none known) | Detect: `capabilities.auth.profiles[]` contains both strings and `subjectLinking` is absent/`false` — the suite's `auth-subject-link` advertisement leg now records `executed-fail`, and the discovery document fails `capabilities.schema.json`. Migrate by **one** of: (a) implement the contract (RFC 0159 §A + RFC 0163 §A/§B — link on an opaque IdP-stable key, declare the class, check the trust root, fail-close the linked SAML identity on SCIM deactivation) and emit the derived flag; or (b) **narrow the advertisement** — drop one of the two profile strings. (b) is conforming: a profile string is a claim of conformance, not an inventory of code. | Before the next suite pin. |
| **Host operator** adopting the second lane | Adopt the contract with it; the derived flag and key come from the same gate that adds the second profile string, so they cannot drift. | At adoption. |
| **Host** whose SAML SP and SCIM connection serve different tenant realms | The same-tenant link cannot form, so advertise one profile (the reference host does this when `subjectLinkRealmAlignment()` is false). | At configuration. |
| **Client / consumer** | Derive the combined-leaver guarantee from the profile pair; keep tolerating `subjectLinking` (kept through v1.x, removed in v2 per `COMPATIBILITY.md` §5). | Any time. |
| **Suite** | Both subject-link scenarios gate on the pair; a combined host that opted out now fails where it previously read `inapplicable` — the `COMPATIBILITY.md` §2.3 case of a new scenario finding a previously untested gap. | Suite ≥ 1.150.0. |

Nothing on the wire changes for SAML-only or SCIM-only hosts.

## Open spec gaps

> **Absorbed into `spec/v1/gaps.json` (RFC 0174 §E.3, 2026-09-03).** The 5 row(s) this table carried are now `openwop.gap.spec.version-negotiation.<local>` entries with a disposition and a witness class, one namespace with every RFC register (RFC 0166 §B). The table is retired; do not add rows here.

## References

- `auth.md` — auth model
- `rest-endpoints.md` — endpoint catalog
- `capabilities.md` — `/.well-known/openwop` capability declaration

Hosts implementing version-negotiation should also publish their own deploy-ordering matrix (engine version vs event-log schema vs API surface) and operational migration runbook for skew transitions.
