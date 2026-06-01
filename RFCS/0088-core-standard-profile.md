# RFC 0088: `openwop-core-standard` — the stable Core Standard Profile

| Field | Value |
|---|---|
| **RFC** | 0088 |
| **Title** | `openwop-core-standard` — the stable Core Standard Profile (the black-box-proven floor) |
| **Status** | `Active` |
| **Author(s)** | David Tufts (@dtufts, steward) |
| **Created** | 2026-05-31 |
| **Updated** | 2026-06-01 (RFC 0029 prompt-resolution chain + RFC 0059 workspace cross-tenant isolation graduated from the §D Lever-2 seam-gated set into black-box production-path conformance — their proofs landed via `prompt-resolution-chain-event.test.ts` + `workspace-cross-tenant-isolation-blackbox.test.ts`; the annex §D tables updated accordingly) |
| **Affects** | `spec/v1/core-standard-profile.md` (NEW operational annex) · `spec/v1/profiles.md` (annex cross-ref) · `conformance/src/lib/profiles.ts` (predicate helper) · `conformance/src/scenarios/core-standard-profile.test.ts` (NEW) · `conformance/coverage.md` · `README.md` · `CHANGELOG.md` |
| **Compatibility** | `additive` per `COMPATIBILITY.md` §2.1 — a new operational annex + reference predicate + always-on server-free scenario; no wire-shape change, no new required field |
| **Supersedes** | — |
| **Superseded by** | — |

## Why this exists

An independent standards-readiness review declined to accept OpenWOP as a full open standard but would accept a **narrow Core Candidate profile** with the newer multi-agent-platform surfaces marked experimental until their behavior is proven through production-path conformance. The objection was scope stability: with 15+ `Active`/`Draft` agent-platform RFCs, the standard boundary is too fluid, and too much behavior is proven through `/v1/host/sample/*` test seams rather than the production wire.

This RFC freezes that **Core Standard Profile** — a small, stable, named target a buyer or adopter can build against without inheriting the in-motion agent-platform surface. It is defined by a single, falsifiable rule: **the Core floor is exactly the set of normative MUSTs that have black-box production-path conformance** (proven against the live wire, no seam, no soft-skip, no env-gate). Everything else is an *extension* outside the floor, demoted by one of two levers (§D). As an extension's behavior graduates to black-box production-path proof, it graduates **into** the floor — so this profile and the "replace seam proofs with black-box conformance" workstream are two ends of one pipeline.

It **composes — does not redefine**. The floor is an AND of existing closed-catalog profiles (`profiles.md`) plus the always-black-box wire-core MUSTs; it adds no new capability and no new wire field.

## §A — Why an annex, not the closed catalog

`openwop-core-standard` is an **operational annex**, alongside `production-profile.md`, `auth-profiles.md`, `interrupt-profiles.md`, and `agent-platform-profile.md` (RFC 0085). Per `profiles.md` §"Profile semantics": operational annexes combine *runtime behavior + documentation + conformance evidence*, not a pure discovery-payload predicate — the Core claim is *backed by* the floor scenarios actually passing black-box, not asserted on discovery shape alone. So it does **NOT** enter the closed `profiles.md` predicate catalog (which stays the fine-grained pure-predicate set); `profiles.md` gains only a one-line cross-reference in its annex list.

## §B — The discovery predicate (the floor)

```
openwop-core-standard(c) :=
     openwop-core(c)                                  // profiles.md §openwop-core — the v1 minimum
  && openwop-interrupts(c)                            // clarification.request envelope (required in v1)
  && (openwop-stream-sse(c) || openwop-stream-poll(c))// at least one event transport
```

The predicate is intentionally thin: it gates on the closed-catalog profiles whose constituent MUSTs are already proven black-box. The reference helper is `isCoreStandard` in `conformance/src/lib/profiles.ts` (an annex helper, clearly separate from the closed-catalog `deriveProfiles`).

## §C — Required runtime scenarios (the black-box floor)

A host **claims** `openwop-core-standard` by satisfying §B **AND passing the floor's black-box production-path scenarios** — each of which exercises the live production wire surface with no `/v1/host/sample/*` seam, no soft-skip, and no operator env-gate:

- Run lifecycle — `runs-lifecycle.test.ts` (`POST /v1/runs`, `GET /v1/runs/{id}`, terminal status)
- Discovery — `discovery.test.ts` (`GET /.well-known/openwop`)
- Auth rejection — `auth.test.ts` (401 on missing/invalid credential)
- Event ordering + causation — `eventOrdering.test.ts` (RFC 0040 causationId)
- Error envelope — `failure-path.test.ts` (canonical HTTP error shapes)
- Idempotency — `idempotency.test.ts` + `idempotency-key-determinism.test.ts`
- Interrupts — the `interrupt-*.test.ts` family (external-event correlation, resume, token matrix)
- Webhooks — `webhook-negative.test.ts` (signature versioning, negative signature)
- Audit-log verification — `audit-log-verification.test.ts`

The aggregating meta-scenario `core-standard-profile.test.ts` derives the floor status from discovery (§B) and asserts the predicate's behavior on representative payloads. The **live aggregate-evidence assertion** (does every floor scenario actually pass against a host claiming the profile?) is the `Active → Accepted` step — naturally satisfied by any host already passing the wire core. MyndHyve and all four reference hosts pass every floor scenario today.

## §D — Two levers: how an extension stays out of the floor (and graduates in)

Everything not in the §B floor is an **extension**, kept out by exactly one of two levers, chosen by the underlying RFC's status. This is the load-bearing distinction the review asked for.

- **Lever 1 — `tier: "experimental"` (RFC 0042).** For capabilities whose RFC is still `Active`/`Draft`. The host advertises `tier: "experimental"` + `experimentalUntil` (RFC 0042 §A) — a public, machine-readable "not promising stability yet" signal; the conformance suite soft-skips them by default. Applies to: `agents.memoryConsolidation`/`commitments` (RFC 0068), `toolCatalog` (0078), `httpClient.egressPolicy` (0079), `memory.search`/`retention` (0080), `agents.evalSuite` (0081), `agents.deployment` (0082), `budget` (0084). RFC 0042 §"Negative space" **forbids** `tier: experimental` on an `Accepted`-RFC capability, so this lever is unavailable to the Accepted surfaces below.

- **Lever 2 — outside the Core floor, pending black-box proof.** For `Accepted` capabilities whose **behavioral** conformance is still proven through a test seam, soft-skip, or simulator rather than the production wire. They stay `Accepted` (no de-grade — that would be a wire regression) but sit **outside** the Core floor until their black-box production-path proof lands, at which point they graduate **into** it. At this RFC's filing, five sat here: prompt-resolution chain (RFC 0029), OTel secret-redaction (RFC 0034), multi-region idempotency + cross-engine ordering (RFC 0036), sandbox execution (RFC 0035), workspace cross-tenant isolation (RFC 0059). **Graduated 2026-06-01 (black-box production-path proof landed, no seam):** prompt-resolution chain (RFC 0029, `prompt-resolution-chain-event.test.ts`) + workspace cross-tenant isolation (RFC 0059, `workspace-cross-tenant-isolation-blackbox.test.ts`). **Still seam-gated:** OTel secret-redaction (0034) + multi-region/cross-engine (0036), each needing a non-steward exporter / multi-region host; and sandbox execution (0035), a capability-gated surface (not a Core-floor MUST) whose `Active → Accepted` needs a non-steward sandbox-executing host. The annex (`core-standard-profile.md` §D) tracks each.

The two levers are mutually exclusive by RFC status: an `Active` surface uses Lever 1; an `Accepted`-but-seam-gated surface uses Lever 2. No capability is de-graded and no wire shape changes.

## §E — The agent-platform surface

The aggregate agent-platform target is already named separately by RFC 0085's `openwop-agent-platform` operational annex. `openwop-core-standard` does not duplicate it: the agent-platform capabilities are extensions outside the Core floor (Lever 1 for the `Active` ones, RFC 0085's `partial`/`full` claim for the `Accepted` ones). A host MAY advertise both annexes; they are orthogonal (Core = the stable wire floor; agent-platform = the aggregate platform claim).

## Alternatives considered

1. **Add `openwop-core-standard` to the closed `profiles.md` catalog.** Rejected: a Core *standard* claim requires runtime + documentation + conformance evidence (the floor scenarios passing black-box), which is the operational-annex contract, not a pure discovery predicate.
2. **De-grade the Active agent-platform RFCs to `Draft`.** Rejected: they are legitimately `Active` (implemented, wire-stable-within-minor); the review asked for an *experimental signal*, which RFC 0042's `tier` field already provides without status churn.
3. **Mark the Accepted-but-seam-gated capabilities `tier: experimental`.** Rejected: RFC 0042 forbids it on Accepted RFCs, and it would misrepresent a stable wire shape. Lever 2 (floor membership) is the correct instrument.
4. **Do nothing — point adopters at `openwop-core`.** Rejected: `openwop-core` is the bare v1 minimum (no interrupts, no transport guarantee); the review wanted a curated *stable* target distinct from both the minimum and the in-motion surface.

## Open spec gaps

- The live aggregate-evidence assertion against a host claiming the profile is the `Active → Accepted` step — gated on a host advertising the claim in its `conformance.md`/`INTEROP-MATRIX.md` row (MyndHyve + all reference hosts already pass the floor scenarios).
- As Phase-4 black-box harnesses land (workspace isolation, prompt-chain), the corresponding Lever-2 extensions graduate into the floor; each graduation is a §C scenario-set addition tracked in the annex.

## Acceptance criteria

- [x] `spec/v1/core-standard-profile.md` operational annex authored.
- [x] `isCoreStandard` reference predicate in `conformance/src/lib/profiles.ts`.
- [x] Always-on server-free `core-standard-profile.test.ts` asserting the §B derivation.
- [x] One-line cross-reference added to `profiles.md` §"Profile semantics" annex list.
- [x] `coverage.md` row + CHANGELOG entry.
- [ ] `Active → Accepted`: ≥1 host advertises the `openwop-core-standard` claim backed by the §C floor scenarios passing black-box (MyndHyve is the natural first).

## References

- `spec/v1/core-standard-profile.md` (this RFC's annex)
- `spec/v1/profiles.md` §"Profile semantics" (the closed catalog + annex distinction)
- RFC 0042 (experimental capability tier — Lever 1)
- RFC 0085 (`openwop-agent-platform` operational annex — the orthogonal aggregate claim)
- RFC 0073 (capability families are document-root properties — the predicate reads `c.<family>`)
- `COMPATIBILITY.md` §2.1 (additive)
