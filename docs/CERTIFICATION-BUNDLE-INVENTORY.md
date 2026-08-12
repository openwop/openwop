# Certification Bundle Inventory (RFC 0148 §D)

> **Status: Working inventory (non-normative), opened 2026-08-11.** RFC 0148 §D requires the project to publish an inventory of `bundleVersion: "1"` conformance certification bundles and to mark any bundle that cannot prove every claimed floor requirement executed as `invalidated` rather than merely historical. This document is that inventory. It is evidence bookkeeping, not a normative surface.

## Why this exists

RFC 0089 made a certification bundle the machine-readable evidence behind a profile claim. RFC 0148 found that the runner can record a scenario as `passed` when its behavioral assertions never executed. Before the corrected v2 bundle format can mean anything, the project has to say plainly which already-published v1 bundles are still substantiated and which are not — and it has to say so from evidence, not from memory.

## Scope of the sweep

Searched for bundle instances (documents carrying `claimedProfiles`, distinguishing them from the schema files and from the unrelated `debug-bundle` / `export-bundle` surfaces) across every repository in the OpenWOP ecosystem: `openwop`, `openwop-examples`, `openwop-app`, `openwop-sdks`, `openwop-registry`, `openwop-site`.

**Result: exactly one published v1 certification bundle exists.**

`INTEROP-MATRIX.md` cites no bundle as evidence for any host row, so no interop claim currently rests on a bundle artifact.

## Inventory

| # | Bundle | Host | Suite | Generated | `bundleVersion` | Disposition |
|---|---|---|---|---|---|---|
| 1 | `openwop-examples/examples/hosts/in-memory/certification-bundle.json` | `openwop-host-in-memory` 1.1.7 (steward reference host, tier-1) | `@openwop/openwop-conformance` 1.18.1 | 2026-06-03 | `1` | **Invalidated** — see below |

Landed by `ad59631` ("spec(rfc-0089): --certify bundle generator + reference-host evidence → Accepted").

## Bundle 1 — findings

Reported totals: **passed 256, failed 29, skipped 43, total 328.** Claimed profiles: `openwop-core`, `openwop-stream-sse`, `openwop-stream-poll`, `openwop-node-packs`, `openwop-fixtures`.

### Finding 1 — every profile claim is floor-vacuous, and the shipped verifier still returns `valid: true`

`conformance-certification.md` §B(2) ("Floor-proven") requires that every floor scenario required by a claimed profile appear in `results.passed`, never in `failed` or `skipped`, with `PROFILE_FLOOR_SCENARIOS` in `conformance/src/lib/profiles.ts` as the machine-readable source.

`PROFILE_FLOOR_SCENARIOS` defines a floor set for exactly one profile: `openwop-core-standard`. **None of the five profiles this bundle claims has a floor set defined.** In `verifyBundleProfile()`:

```ts
const floor = PROFILE_FLOOR_SCENARIOS[profile];                 // undefined
const missingFloor = floor ? floor.required.filter(...) : [];   // → []
const prefixOk = (floor?.requiredAnyPrefix ?? []).every(...);   // → [].every() === true
const floorProven = missingFloor.length === 0 && prefixOk;      // → true
```

An undefined floor set yields `floorProven: true`. Running the shipped `verifyBundle()` against this bundle returns `valid: true` with `floorProven: true` for all five claims, every one of which has no floor definition behind it. §B(2) is therefore unenforced for every profile except `openwop-core-standard`.

This is a **third** vacuity mode, distinct from the two RFC 0148 §"Motivation" names (runner early return recorded as a pass; file-level result aggregation). Those two let an *unexecuted assertion* count as a pass. This one lets an *entire profile claim* verify against nothing. It is the mode that actually invalidates the published evidence, because none of this bundle's claims name the one profile with a floor.

### Finding 2 — the bundle claims two streaming profiles whose scenarios are in its own failure list

`results.failed` contains `stream-modes.test.ts`, `stream-modes-buffer.test.ts`, and `stream-modes-mixed.test.ts`, while `claimedProfiles` asserts both `openwop-stream-sse` and `openwop-stream-poll`. A reader comparing the two lists by hand would reject the claim; the verifier accepts it, for the reason in Finding 1.

The failure list also includes `version-negotiation.test.ts`, `route-coverage.test.ts`, `runtime-capabilities.test.ts`, `pause-resume.test.ts`, and six `interrupt-*` scenarios.

### Finding 3 — 43 of the 256 recorded passes are unwitnessable

43 scenario files in `results.passed` call `behaviorGate` / `behaviorGatePresent` / `experimentalGate`. Under the current runner a gated scenario that returns early is recorded by Vitest as passed, so for each of these the bundle cannot distinguish "executed and passed" from "returned before asserting". This is not a claim that all 43 were vacuous — it is the claim that **the bundle contains no evidence either way**, which is precisely the disposition RFC 0148 §A introduces `executed-pass` / `blocked` to make expressible.

### Finding 4 — `openwop-core` is not `openwop-core-standard`

The bundle claims `openwop-core`. The floor set exists for `openwop-core-standard`. These are different names, and the bundle's `interrupt-*` failures would have violated `openwop-core-standard`'s `requiredAnyPrefix: ['interrupt-']` had that profile been claimed. This is RFC 0155's "`openwop-core` can mean discovery-only compatibility" ambiguity appearing in shipped evidence rather than in the abstract.

## Refinement after the floor fix (2026-08-12)

Findings 1 and 2 were written before floor sets existed for these profiles. With the G6 fix landed — an undefined floor is unprovable, and the floors `profiles.md` already defined in prose are transcribed — the verdict is sharper than "all five unprovable", and part of it is *better* than first reported:

| Claim | Verdict | Why |
|---|---|---|
| `openwop-core` | **valid** | `profiles.md` §`openwop-core` is a pure discovery predicate; the predicate is the whole claim |
| `openwop-fixtures` | **valid** | `profiles.md` §`openwop-fixtures`: "discovery-payload-only" |
| `openwop-stream-sse` | **invalid** | floor `stream-modes.test.ts`, `stream-modes-buffer.test.ts`, `stream-modes-mixed.test.ts` — all three in this bundle's own `results.failed` |
| `openwop-stream-poll` | **invalid** | floor `stream-modes.test.ts` — failed |
| `openwop-node-packs` | **invalid** | floor `pack-registry.test.ts` — failed |

`verifyBundle()` now returns `valid: false` overall. So two claims are genuinely substantiated and **three are positively contradicted by normative prose as already written**, rather than all five being merely unprovable. That is a stronger statement than the original finding, not a weaker one: the streaming and pack claims are not unproven, they are *wrong*.

## Disposition

Bundle 1 is marked **`invalidated`** per RFC 0148 §D. Three of its five profile claims are contradicted by `profiles.md`'s own "predicate AND those scenarios pass" rule (see the refinement table); the remaining two are substantiated but cannot carry a bundle on their own. Separately, 43 recorded passes carry no execution witness (Finding 3), so even the valid claims rest on a results list that cannot distinguish an executed assertion from an early return. It is retained in place, with this document as the machine-readable-adjacent reason, per §D's "MAY retain invalidated bundles with a machine-readable reason".

Reissue requires bundle v2 (`executed-pass` / `executed-fail` / `skipped` / `inapplicable` / `blocked` dispositions with witnesses), and it requires floor sets to exist for every profile a host intends to claim.

## What this changes about RFC 0148

Three consequences the RFC as drafted does not yet capture:

1. **The blast radius is one artifact, not a corpus.** §D's inventory-and-invalidate obligation is satisfied by this document plus one disposition. `INTEROP-MATRIX.md` cites no bundles, so no host row needs restating. The migration burden §D anticipated is close to zero — which removes it from the critical path.
2. **A verifier-side vacuity needs naming in §C.** §C already says a verifier `MUST` reject "missing floor requirements", but the concrete defect is narrower and worth stating outright: *an undefined floor set MUST NOT satisfy the floor condition.* A profile with no floor definition is unprovable, not proven.
3. **Part of this is enforceable today** — and was enforced on 2026-08-12. Making `verifyBundleProfile()` treat an undefined floor as unprovable enforces `conformance-certification.md` §B(2) and `profiles.md` §"Claiming vs passing" as already written, rather than changing them, so it did not depend on the 90-day safety-fix window that §C's bundle-v2 format still needs. The floor sets were **transcribed from `profiles.md`, not invented** — that prose already names the scenarios for `openwop-stream-sse`, `openwop-stream-poll`, and `openwop-node-packs`, and already declares `openwop-core` and `openwop-fixtures` discovery-only. `PROFILE_FLOOR_SCENARIOS` was an incomplete transcription of normative text, which is why the fix is implementation rather than design.

## References

- RFC 0148 §§A, C, D — dispositions, bundle v2, invalidation
- RFC 0089 and `spec/v1/conformance-certification.md` §§A, B
- `conformance/src/lib/profiles.ts` — `PROFILE_FLOOR_SCENARIOS`, `verifyBundleProfile()`, `verifyBundle()`
- RFC 0147 Workstream 1
