# openwop Spec v1 — `openwop-core-standard` Operational Annex

> **Status: DRAFT v1.x (filed via [RFC 0088](../../RFCS/0088-core-standard-profile.md), 2026-05-31).** Additive v1.x extension — an **operational annex** (the [`production-profile.md`](./production-profile.md) / [`agent-platform-profile.md`](./agent-platform-profile.md) pattern), NOT a new entry in the closed [`profiles.md`](./profiles.md) predicate catalog. Names the small, stable **Core Standard Profile** — the floor of normative MUSTs that have black-box production-path conformance — so an adopter can build against a frozen target without inheriting the in-motion agent-platform surface. The live aggregate-evidence assertion against a claiming host lands at `Active → Accepted`. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). See `auth.md` for the status legend.

## Why this exists

A standards-readiness review found OpenWOP's standard boundary too fluid for full open-standard acceptance — 15+ `Active`/`Draft` agent-platform RFCs, and a lot of behavior proven through `/v1/host/sample/*` test seams rather than the production wire — but would accept a **narrow Core Candidate profile** with the newer surfaces marked experimental until proven through production-path conformance. This annex is that Core Candidate: a single, named, stable target defined by one falsifiable rule — **the Core floor is exactly the set of normative MUSTs with black-box production-path conformance** (proven against the live wire: no seam, no soft-skip, no env-gate).

It **composes — does not redefine.** The floor is an AND of existing closed-catalog profiles plus the wire-core MUSTs that are already black-box; it adds no capability and no wire field. It is distinct from `openwop-core` (the bare v1 minimum — no interrupts, no transport guarantee) and from `openwop-agent-platform` (RFC 0085 — the aggregate platform claim, deliberately *outside* this floor).

## §A — Why an annex, not the closed catalog

`openwop-core-standard` is an **operational annex**, alongside `production-profile.md`, `auth-profiles.md`, `interrupt-profiles.md`, and `agent-platform-profile.md`. Per `profiles.md` §"Profile semantics", operational annexes combine *runtime behavior + documentation + conformance evidence* rather than a pure discovery predicate — the Core claim is *backed by* the floor scenarios passing black-box, not asserted on discovery shape alone. So it does **NOT** enter the closed `profiles.md` predicate catalog; `profiles.md` gains only a one-line cross-reference in its annex list.

## §B — The discovery predicate (the floor)

```
openwop-core-standard(c) :=
     openwop-core(c)                                   // profiles.md §openwop-core — the v1 minimum
  && openwop-interrupts(c)                             // clarification.request envelope (required in v1)
  && (openwop-stream-sse(c) || openwop-stream-poll(c)) // at least one event transport
```

Capability families are document-root properties (RFC 0073), so the constituent predicates read `c.<family>`. The reference helper is `isCoreStandard` in `conformance/src/lib/profiles.ts` (an annex helper, separate from the closed-catalog `deriveProfiles`).

## §C — The black-box floor (required runtime scenarios)

A host **claims** the profile by satisfying §B **AND passing the floor's black-box production-path scenarios**. Each exercises the live production wire with **no `/v1/host/sample/*` seam, no soft-skip, and no operator env-gate** — that is the membership rule:

| MUST | Scenario | Wire surface |
|---|---|---|
| Run lifecycle | `runs-lifecycle.test.ts` | `POST /v1/runs`, `GET /v1/runs/{id}`, terminal status |
| Discovery | `discovery.test.ts` | `GET /.well-known/openwop` |
| Auth rejection | `auth.test.ts` | 401 on missing/invalid credential |
| Event ordering + causation | `eventOrdering.test.ts` | run event log, `causationId` (RFC 0040) |
| Error envelope | `failure-path.test.ts` | canonical HTTP error shapes |
| Idempotency | `idempotency.test.ts`, `idempotency-key-determinism.test.ts` | request dedup + cache-serve |
| Interrupts | `interrupt-*.test.ts` family | external-event correlation, resume, token matrix |
| Webhooks | `webhook-negative.test.ts` | signature versioning, negative signature |
| Audit-log verification | `audit-log-verification.test.ts` | `GET /v1/audit/verify` |

The aggregating meta-scenario `core-standard-profile.test.ts` derives the floor status from discovery (§B) and asserts the predicate behavior on representative payloads. The **live aggregate-evidence assertion** (every floor scenario passing against a host claiming the profile) is the `Active → Accepted` step — already satisfied by MyndHyve and all four reference hosts, which pass every floor scenario today.

## §D — Two levers: how an extension stays out of the floor (and graduates in)

Everything not in §B is an **extension**, kept out by exactly one lever, chosen by the underlying RFC's status (RFC 0088 §D):

- **Lever 1 — `tier: "experimental"` (RFC 0042)** for capabilities whose RFC is still `Active`/`Draft`. The host advertises the experimental signal; the suite soft-skips by default. RFC 0042 forbids this on `Accepted`-RFC capabilities.
- **Lever 2 — outside the floor, pending black-box proof** for `Accepted` capabilities whose **behavioral** conformance is still proven via a seam / soft-skip / simulator. They stay `Accepted` (no de-grade) but sit outside the floor until their black-box production-path proof lands, then graduate **in**.

### Experimental extensions (Lever 1 — `Active` RFCs)

| Capability | RFC |
|---|---|
| `agents.memoryConsolidation` / `agents.commitments` | 0068 |
| `toolCatalog` | 0078 |
| `httpClient.egressPolicy` | 0079 |
| `memory.search` / `memory.retention` | 0080 |
| `agents.evalSuite` | 0081 |
| `agents.deployment` | 0082 |
| `budget` | 0084 |

### Graduated to black-box production-path (capability-gated; proof landed 2026-06-01)

These `Accepted` capabilities have moved out of the seam-gated set: their behavioral conformance is now proven on the **production wire with no `/v1/host/sample/*` seam** (capability-gated — a host that advertises the capability MUST pass the black-box scenario). This is the Lever-2 "graduate in" outcome.

| Capability | RFC | Black-box proof (no seam) |
|---|---|---|
| Workspace cross-tenant isolation | 0059 | `workspace-cross-tenant-isolation-blackbox.test.ts` — two operator credentials write-A / read-B against the normative §C `PUT`/`GET /v1/host/workspace/files` endpoints |
| Prompt-resolution chain | 0029 | `prompt-resolution-chain-event.test.ts` — reads the `agent.promptResolved.chain[]` precedence record from the normative `GET /v1/runs/{runId}/events/poll` |

### Extensions outside the floor pending black-box proof (Lever 2 — `Accepted` RFCs)

| Capability | RFC | Today's proof | Graduation condition |
|---|---|---|---|
| OTel secret-redaction | 0034 | OTel-scrape seam / reference-impl | conformance OTel collector scrapes **exported** spans for BYOK canaries against a non-steward host |
| Multi-region idempotency + cross-engine ordering | 0036 | partition / two-engine simulator seam | a deployed multi-region / multi-engine host (no single-host wire can exercise it) |
| Sandbox execution | 0035 | real-isolation WASM reference host (`examples/hosts/wasm-sandbox/`; 6 `node-pack-sandbox-*` invariants graduated `reference-impl → protocol`) | a **non-steward** host that runs untrusted packs in a real-isolation sandbox advertises `capabilities.sandbox` + passes the §B probes (RFC 0035 `Active → Accepted`). Sandbox is a capability-gated surface, not a Core-floor MUST. |

## §E — Relationship to `openwop-agent-platform` (RFC 0085)

The aggregate agent-platform target is named separately by RFC 0085's `openwop-agent-platform` annex. `openwop-core-standard` does not duplicate it: the agent-platform capabilities are extensions **outside** the Core floor (Lever 1 for the `Active` ones; RFC 0085's `partial`/`full` claim for the `Accepted` ones). A host MAY advertise both annexes; they are orthogonal — Core = the stable wire floor, agent-platform = the aggregate platform claim.

## Open spec gaps

- The live aggregate-evidence assertion against a claiming host is the `Active → Accepted` step (MyndHyve + all reference hosts already pass the floor scenarios).
- Each Lever-2 row graduates into the floor as its Phase-4 black-box harness lands; the §C table grows by the corresponding scenario set at that point.
