# RFC 0142: The `store`-gated `artifact.created` emission witness

| Field             | Value                                                                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**           | 0142                                                                                                                                          |
| **Title**         | The `store`-gated `artifact.created` emission witness                                                                                         |
| **Status**        | `Active`                                                                                                                                      |
| **Author(s)**     | David Tufts (@davidscotttufts), with the openwop-app reference host                                                                           |
| **Created**       | 2026-08-08                                                                                                                                    |
| **Updated**       | 2026-08-08                                                                                                                                    |
| **Affects**       | `conformance/src/scenarios/artifact-type-store-emission.test.ts`, `conformance/coverage.md` §"Open seams", `conformance/src/lib/artifactTypes.ts` |
| **Compatibility** | `additive` per `COMPATIBILITY.md` §2.1 — conformance-only; no schema, endpoint, event, or prose-MUST change                                   |
| **Supersedes**    | —                                                                                                                                             |
| **Superseded by** | —                                                                                                                                             |

## Summary

`artifact-type-packs.md` mandates `artifact.created` emission in exactly one place — the `store` facet: *"A host advertising `store: true` MUST do so."* **No conformance leg checks that facet.** Every artifact-type leg gates on `supported: true`, which carries no emission obligation at all, so the one emission MUST in the corpus is unreachable by the suite in both directions: a `store: true` host that never emits passes everything, and a host that emits correctly is never credited either. This RFC adds the missing witness — a server-free leg pinning that the `artifact.created` payload *requires* `artifactType` (the fact RFC 0138's replay correction rests on, previously exercised only by a formerly-gated leg), and a behavioral leg, applicable only to hosts advertising `store: true`, that drives a **real run** through a host-sample seam and asserts `artifact.created` appears in the run-event log with the bound `artifactType` and `registered: true`.

## Motivation

### The facet mismatch, discovered by trying to price a seam

The reference host went to scope a real-run emission seam and found the obligation and the coverage pointing at different facets:

| | gates on |
|---|---|
| the emission MUST (`artifact-type-packs.md` §"Host capability", `store` row) | `store: true` |
| every artifact-type conformance leg (RFC 0071/0139) | `supported: true` |

So the G14-style strict-mode flip cannot reach it: un-gating a `supported`-gated leg never touches `store`. This was logged as the re-scoped G8 of RFC 0138: *"the emission MUST is unreachable by any current leg because it hangs off an unchecked facet."*

### The gap is symmetric, and both halves are now measured on the same host

The original motivation was the violation direction: a host could advertise `store: true`, emit nothing, and stay green. The reference host then ran the discriminator and **falsified its own negative** — its documents path *does* emit `artifact.created` (`packs/feature.documents.nodes/index.mjs`, `ctx.emit('artifact.created', …)`, appended verbatim to the event log), demonstrated live in both directions: a template bound to an `artifactTypeId` emits `{artifactType: 'doc.one-pager', registered: true}`; an unbound template completes with no emission, isolating the cause.

That falsification did not weaken the RFC's case — it supplied the other half of it. The host had **emitted correctly for months and no leg ever noticed that either.** Unverifiable violation *and* unverifiable compliance: a host doing the work gets no credit a peer can rely on, which is the same interop failure as a host skipping the work undetected.

### The population error worth recording

The host's initial "zero emit sites" negative came from grepping `backend/typescript/src/**` — but node behavior ships in **packs**, and the emit was a plain string literal in a directory the grep never enumerated. Third population-enumeration error in this collaboration (a filename-convention glob, a test-name filter, now a source-tree boundary), and the first to survive into a cross-session report. It did not survive into the corpus only because the acceptance standard here is *cite a run, not a grep* — which is the standard this RFC's behavioral leg operationalizes.

## Proposal

### Leg A (always-on, server-free): pin the payload fact

`run-event-payloads.schema.json` `$defs/artifactCreated` lists `artifactType` in **`required`**. This is the fact the RFC 0138 replay correction rests on — `artifactTypeId` values ride in the fixed event log — and until now it was exercised only by `artifact-type-pack-install.test.ts`, a leg that was a bare-return soft-skip for most of its life. Leg A asserts the schema fact directly, unconditionally, in under a second. The G8 "unpinned fact" complaint closes here regardless of any host's posture.

### Leg B (behavioral, `store: true` hosts only): the emission witness

**Seam contract** (documented in `conformance/coverage.md` §"Open seams", host-extension surface, never production):

```
POST /v1/host/sample/artifacttypes/runproduce
  body: { artifactTypeId: string }
  → 2xx { runId: string }        — a REAL run, through the host's normal
                                    execution path, that produces one artifact
                                    of the given registered type
  → 404/405                       — seam not wired
```

The leg then reads the standard **`GET /v1/runs/{runId}/events/poll`** — the same wire surface any consumer uses, not a bespoke report — and asserts: an `artifact.created` event is present; its payload's `artifactType` equals the requested id; `registered` is `true`. The evidence is the event log itself, which is the thing the MUST is about.

**Gating, three tiers, deliberately not uniform:**

| Condition | Behavior |
|---|---|
| `store` facet absent or `false` (capability **and** per-type level checked — the facet is per-type-scoped) | **Inapplicable — plain return in both modes.** `store` is optional; strict mode must not coerce hosts into advertising it. Same precedent as `artifact-type-store-without-render`'s shape precondition, kept as a non-gate in the RFC 0139 flip for the same reason. |
| `store: true` advertised, seam absent | `behaviorGate`: skip default, **FAIL strict** — advertise-and-skip is the only combination that can lie |
| `store: true` advertised, seam present | run the witness |

### What this does NOT do

- **No new protocol surface.** The seam is host-sample test surface; the events endpoint already exists; the MUST already exists. Conformance-only.
- **No pressure to advertise `store`.** A host that persists and emits but does not advertise (the reference host's current posture) remains conformant and simply inapplicable to leg B. Advertising honestly is a wire-posture decision this RFC explicitly leaves to the host.
- **No claim about un-advertised emission.** Leg B witnesses the MUST, which binds only advertisers.

## Compatibility

**Additive** per §2.1: no schema/endpoint/event/prose change; no MUST added, relaxed, or reinterpreted — the leg tests a MUST that has been in `artifact-type-packs.md` since RFC 0075. Suite-version consequence per §2.3 for `store: true` hosts only: one that advertised without wiring a seam goes strict-red on upgrade (it was always making an uncheckable claim); one that advertised without *emitting* now fails the witness itself, which is the leg working. No known host currently advertises `store: true`, so the measured blast radius today is zero.

## Conformance

`artifact-type-store-emission.test.ts`, suite `1.65.0 → 1.66.0`. Non-vacuity, one sabotage per surface: removing `artifactType` from the schema's `required` reds exactly leg A; a stub host advertising `store: true` whose run omits the emission reds exactly leg B, while the same stub in honest mode passes — and a stub emitting with the *wrong* `artifactType` also reds leg B, so the leg discriminates payload correctness, not mere event presence.

## Acceptance criteria

- [ ] Leg A green in CI (unconditional)
- [ ] Leg B witnessed non-vacuously by a host **advertising `store: true`**, with a per-leg report including what the seam does not discriminate. The reference host emits correctly today but does not advertise; acceptance waits for a host willing to make the advertisement honestly — it MUST NOT be manufactured by advertising solely to graduate this RFC.

## Alternatives considered

1. **Do nothing** — the corpus's only emission MUST stays untestable in both directions. Rejected on the measured evidence above.
2. **Fold into the G14 flip / RFC 0139** — cannot work; those legs gate on the wrong facet. This is the finding that created the RFC.
3. **Assert emission via the existing `artifacttypes/produce` seam** — that seam routes `persistRunArtifact`, which by the reference host's explicit design emits nothing; a leg there would witness the wrong path forever. The emission is a property of *real runs*, so the seam must start one.
4. **Make emission unconditional (decouple from `store`)** — a spec change this RFC has no license for; it would convert a facet-scoped MUST into a universal one and break every persist-without-events host. The facet is the contract; the suite should test the contract.

## Unresolved questions

1. Whether `registered: true` should be asserted or merely recorded — a `store: true` host producing an artifact of a *registered* type must validate before emitting (§"Binding"), so `true` is implied for the seam's happy path; asserted for now, revisit if a host surfaces a legitimate `false` case through this seam.
2. Whether the seam should also expose the negative control (a run that must *not* emit). The reference host's discriminator used one; the leg does not require it yet, because "no emission" is only meaningful against a host-known unbound configuration the suite cannot portably specify.

## References

- `spec/v1/artifact-type-packs.md` §"Host capability — `host.artifactTypes`", `store` row — the MUST under test
- RFC 0138 gap G8 (both scopings) — closed by this RFC's legs A (fact pinned) and B (MUST reachable)
- openwop-app discriminator run (2026-08-08): live both-direction demonstration — bound template emits `{artifactType, registered: true}`; unbound template completes silently; live discovery carries no `store` facet at either scope
- RFC 0139 — the gating precedent (advertise-and-skip fails strict; shape preconditions stay non-gates)
