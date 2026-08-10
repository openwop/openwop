# RFC 0142: The `store`-gated `artifact.created` emission witness

| Field             | Value                                                                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**           | 0142                                                                                                                                          |
| **Title**         | The `store`-gated `artifact.created` emission witness                                                                                         |
| **Status**        | `Accepted`                                                                                                                                      |
| **Author(s)**     | David Tufts (@davidscotttufts), with the openwop-app reference host                                                                           |
| **Created**       | 2026-08-08                                                                                                                                    |
| **Updated**       | 2026-08-10                                                                                                                                    |
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

### What `store: true` claims — the scope ruling (2026-08-10)

Leg B could not be witnessed without answering a question the facet's one-sentence definition left implicit, raised by the reference host while wiring the seam: **a host with two persistence paths, one emitting and one not — does `store: true` for a type mean *every* production path emits, or *at least one*?**

**Ruling: every path.** `artifact-type-packs.md` §"Sub-flags": *"The host persists artifacts of registered types and emits `artifact.created`. A host advertising `store: true` MUST do so."* The sentence is universally quantified over **artifacts of registered types** — not over the host's paths to them, and not over *some* artifacts — and "MUST do so" binds the conjunction *persists **and** emits*. This is the plain reading of existing text, not a tightening of it; the §Compatibility claim below that this RFC adds, relaxes and reinterprets no MUST survives the ruling intact, which a tightening would have broken and which would then have needed its own RFC.

**Why the permissive reading fails, in this RFC's own terms.** Under "at least one," a host wires the leg-B seam through its single emitting path, passes, and leaves most of its production silently non-emitting — a leg green by construction against a host the facet describes falsely. That is the advertise-and-skip shape this RFC exists to make unreachable, re-entering through the seam rather than through the gate.

**The obligation is scoped to registered types, which is narrower than it first reads.** §"Binding" attaches emission to registered types, and the unregistered tier is permanent and first-class. So the test is not *"does every path emit?"* but *"does every path that persists an artifact carrying a **registered** `artifactTypeId` emit?"* A path persisting only unregistered artifacts is outside the facet and cannot falsify the advert — not a loophole, the unregistered tier working as designed. A host holding back its advert on account of such a path is being conservative for a reason that does not apply.

**Per-type is the instrument, with one case it cannot rescue.** A heterogeneous host advertises per type (RFC 0075 / P1-1) rather than a false union or a false intersection — the same argument that made the facet set per-type, and the reason the gating table above checks `store` at both scopes. The case per-type cannot reach is a **single type** produced through both an emitting and a non-emitting path; there the type is simply not advertisable until one of those facts changes, because the advert is a promise about the type, not a description of the host's best path to it.

The ruling is stated normatively in `artifact-type-packs.md` §"Sub-flags" — recording it only here would leave a normative reading in an RFC's discussion while the document a host actually implements against stayed silent, which is the defect RFC 0144 exists to close.

### What this does NOT do

- **No new protocol surface.** The seam is host-sample test surface; the events endpoint already exists; the MUST already exists. Conformance-only.
- **No pressure to advertise `store`.** A host that persists and emits but does not advertise (the reference host's current posture) remains conformant and simply inapplicable to leg B. Advertising honestly is a wire-posture decision this RFC explicitly leaves to the host.
- **No claim about un-advertised emission.** Leg B witnesses the MUST, which binds only advertisers.

## Compatibility

**Additive** per §2.1: no schema/endpoint/event/prose change; no MUST added, relaxed, or reinterpreted — the leg tests a MUST that has been in `artifact-type-packs.md` since RFC 0075. Suite-version consequence per §2.3 for `store: true` hosts only: one that advertised without wiring a seam goes strict-red on upgrade (it was always making an uncheckable claim); one that advertised without *emitting* now fails the witness itself, which is the leg working. No known host currently advertises `store: true`, so the measured blast radius today is zero.

## Conformance

`artifact-type-store-emission.test.ts`, suite `1.65.0 → 1.66.0`. Non-vacuity, one sabotage per surface: removing `artifactType` from the schema's `required` reds exactly leg A; a stub host advertising `store: true` whose run omits the emission reds exactly leg B, while the same stub in honest mode passes — and a stub emitting with the *wrong* `artifactType` also reds leg B, so the leg discriminates payload correctness, not mere event presence.

## Acceptance criteria

- [x] Leg A green in CI (unconditional)
- [x] Leg B witnessed non-vacuously by a host **advertising `store: true`**, with a per-leg report including what the seam does not discriminate — openwop-app, 2026-08-10, advert `cbfbf9d4a` (#3111), witness `a8f58396e` (#3115), suite `1.68.2`. **The anti-manufacture clause is satisfied on the strongest available evidence: the leg went RED first.** See §"Witness" below.

**Status: `Accepted` (2026-08-10).**

## Witness

**Host:** openwop-app (steward-affiliated reference host, evidence tier 2 per `GOVERNANCE.md` §71–74). **Suite:** `1.68.2`. **Advert:** `cbfbf9d4a` (#3111) — `store: true` per-type for `doc.*`. **Result:** `1 failed | 1 passed` → `2 passed` after `a8f58396e` (#3115).

**Leg B failed before it passed, on a live wire defect.** `$defs.artifactCreated` requires `['artifactId','artifactType']`; the host emitted `artifactTypeId` and **neither required field** — so every `artifact.created` it had produced since its RFC 0071 support shipped was off-contract. `artifactType`'s presence in the fixed event log is what RFC 0138's replay correction rests on, so this was not cosmetic.

**Why nothing caught it earlier, which is the finding worth keeping.** The host's own `artifact-created-emission.test.ts` existed *specifically* to prove emission, and asserted `payload.artifactTypeId` — **the field the code happened to emit**. It was green for its entire life while the wire claim was false. A test written against the implementation cannot detect the implementation being wrong about the contract; only a leg that compares a real emission to its canonical schema can. That is leg B's whole thesis, and it was vindicated on first contact with a host that advertises.

**The anti-manufacture clause is satisfied, not merely asserted.** An advert made in order to graduate an RFC passes immediately; this one failed. The advertised set was additionally derived from **measured reachability** — an enumeration of which `artifactTypeId`s actually reach an `outputs.artifact` envelope — rather than from the identifier prefix as a convention, and anchored on the binding rule at the host's `documentsService.ts:507`. The adversarial half is the part that earns it: `core.trigger.artifact` accepts a **caller-supplied** `artifactTypeId`, the one input that could route any registered type (`doc.*` included) into the non-emitting path and falsify the advert for reasons no static list would show; it was checked specifically because it could break the claim, and returns the id flat rather than under `outputs.artifact`, so the envelope detector never sees it. Under §"What `store: true` claims", only an adversarial check against caller-controlled input can establish that *every* holds.

**What this witness does NOT discriminate** (reported by the host, recorded verbatim in substance):

1. **One path only.** The seam drives the documents-generation path. The host also persists via an `outputs.artifact` envelope that does not emit; no leg here would notice. This is exactly why `store` is advertised per-type for `doc.*` and why a host-global `store: true` would be false — the per-type instrument doing the work §"What `store: true` claims" describes.
2. **Canned prose.** The emitting node drafts through a deterministic mock provider under the same env gate. The run, persistence, validation and emission are real; only the generated text is fixed. Nothing on the artifact path is stubbed.
3. **Version scope.** Suite `1.68.2` covers legs A and B and says **nothing** about the RFC 0145 legs added in `1.70.0`. Two facts reported rather than one green.
4. **Registered-type tier.** `doc.board-agenda` is host-registered; a pack-registered type through the same seam is untested here.

**Blast radius measured with a control rather than asserted:** full conformance with the fix, 31 failed / 2489 passed; the same suite with the change reverted, 30 failed. The single difference was a broken-local-link failure in a `plans/` file — traced to **untracked, gitignored residue** in a working tree predating `937a9d85`, not to either repo's tracked corpus, and surfacing a separate defect in the link checker (it walks the filesystem rather than the git index). Every other failure is identical and pre-existing.

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
- openwop-app `cbfbf9d4a` (#3111) — the honest per-type advert, derived from measured reachability
- openwop-app `a8f58396e` (#3115) — the emission fix leg B forced, and the in-repo test rewritten to validate against `$defs.artifactCreated` rather than against the code
