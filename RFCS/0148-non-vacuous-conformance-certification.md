# RFC 0148: Non-Vacuous Conformance and Certification Evidence

| Field | Value |
| --- | --- |
| **RFC** | 0148 |
| **Title** | Non-Vacuous Conformance and Certification Evidence |
| **Status** | `Accepted` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-08-11 |
| **Updated** | 2026-08-16 (item 4: `certification-bundle-non-vacuous` + `certification-bundle-redaction` landed, `--certify` scrubs + self-verifies, suite `1.115.0`; acceptance item 2 landed — ledger sink + `--certify` rejection of unclassified returns, suite `1.113.0 -> 1.114.0`; see the item's annotation) · 2026-08-12 (`Active` -> `Accepted`; 7-day comment window waived by the steward per `MAINTAINERS.md` §"Bootstrap-phase RFC waivers". **Landed:** §C floor enforcement — undefined floor is now unprovable, floors transcribed from `profiles.md`, `certification-floor-enforcement.test.ts` sabotage-verified (#944); §D v1 bundle inventory with the one published bundle `invalidated` (#941); G3 registry feasibility measured (#943). Suite `1.75.0`. **Carried forward, not closed:** §A requirement-execution ledger, §B strict-mode dispositions, and the bundle-v2 schema. Gaps G1/G3/G5/G7 remain open in the register.) |
| **Affects** | `spec/v1/conformance-certification.md`, `schemas/conformance-certification-bundle.schema.json`, `conformance/src/{cli.ts,lib/behavior-gate.ts,lib/profiles.ts,scenarios/}`, RFC 0089, `INTEROP-MATRIX.md` |
| **Compatibility** | `safety-fix` per `COMPATIBILITY.md` §3 |
| **Supersedes** | RFC 0089 bundle-version-1 validity rule where it permits file-level pass aggregation |
| **Superseded by** | — |

## Summary

OpenWOP certification currently reduces a scenario file to passed when at least one assertion passes and none fails, even when required behavioral paths returned early. This RFC introduces bundle version 2 with requirement-level dispositions and execution witnesses, makes strict mode reject advertised-but-unexecuted behavior, and requires affected v1 bundles to be inventoried and reissued. A required behavior is proven only when its assertion executed against the target host; omission, early return, or an unavailable required seam can never become a pass.

## Motivation

`behaviorGate()` returns `false` and instructs callers to `return`; Vitest records the test as passed rather than skipped. `scenarioStatesFromReport()` then marks the whole file passed if it sees any passing assertion and no failure. This contradicts `conformance-certification.md` §A's requirement that a generator MUST NOT place a scenario in `passed` if it did not run non-vacuously. Certification is an interop contract, so this cannot be repaired by host convention.

## Proposal

### §A — Requirement execution ledger

Every normative conformance assertion included in a certifiable profile **MUST** have a stable `requirementId`. The runner **MUST** record exactly one disposition:

- `executed-pass` — the assertion executed against the target and passed;
- `executed-fail` — the assertion executed and failed;
- `skipped` — the operator explicitly excluded an optional, unadvertised profile;
- `inapplicable` — the requirement does not apply to the captured discovery/profile set; or
- `blocked` — advertised behavior could not be exercised because a required seam, fixture, credential, or dependency was unavailable.

A plain test return, caught exception converted to a return, or empty assertion body **MUST NOT** produce `executed-pass`. A `blocked` requirement in a claimed profile **MUST** invalidate that profile's certification.

### §B — Strict behavior

When a host advertises a capability, every required behavioral assertion for that capability **MUST** execute or fail. `OPENWOP_REQUIRE_BEHAVIOR=true` **MUST** fail on `blocked`, unclassified early return, or a missing seam unless the profile was explicitly opted out before discovery capture. A host **MUST NOT** both advertise and opt out of the same profile.

### §C — Bundle version 2

```diff
 {
-  "bundleVersion": "1",
+  "bundleVersion": "2",
   "results": {
-    "totals": { "passed": 10, "failed": 0, "skipped": 2 },
-    "passed": ["idempotency"],
-    "failed": [],
-    "skipped": ["mcp"]
+    "totals": {
+      "executedPass": 41,
+      "executedFail": 0,
+      "skipped": 2,
+      "inapplicable": 7,
+      "blocked": 0
+    },
+    "requirements": [{
+      "requirementId": "idempotency.layer1.same-request-replay",
+      "scenarioId": "idempotency",
+      "disposition": "executed-pass",
+      "assertionCount": 3,
+      "witnessSha256": "<64 lowercase hex>"
+    }]
   },
+  "scenarioManifestSha256": "<64 lowercase hex>",
+  "targetConfigurationSha256": "<64 lowercase hex>"
 }
```

The schema **MUST** use a `oneOf` discriminator on `bundleVersion`. Version 2 `requirements` **MUST** be closed objects. `witnessSha256` **MUST** cover the normalized reporter record, not response bodies or secrets. The bundle **MUST** include suite/corpus provenance and the captured discovery digest. A verifier **MUST** reject duplicates, missing floor requirements, contradictory dispositions, mismatched totals, or `blocked`/`skipped` requirements inside a claimed profile floor.

A verifier **MUST** distinguish a profile with *no floor requirements* from a profile whose floor is *not yet specified*. An undefined floor set **MUST NOT** satisfy the floor condition: a claimed profile with no floor definition is **unprovable**, and the verifier **MUST** reject the claim rather than treat an empty check as a passed one.

This is not hypothetical. `PROFILE_FLOOR_SCENARIOS` currently defines a floor for `openwop-core-standard` alone, and `verifyBundleProfile()` computes `floorProven` from `missingFloor.length === 0 && prefixOk`, both of which are vacuously true when the floor is `undefined`. The single published v1 bundle claims five profiles, none of which has a floor definition, lists three `stream-modes*` scenarios in `results.failed` while claiming `openwop-stream-sse` and `openwop-stream-poll`, and still verifies as `valid: true`. This is a **third** vacuity mode alongside the two in §"Motivation": those let an unexecuted assertion count as a pass, whereas this lets an entire profile claim verify against nothing. See `docs/CERTIFICATION-BUNDLE-INVENTORY.md`.

Enforcing this distinction implements `conformance-certification.md` §B(2) as already written rather than changing it, so it does not depend on this RFC's safety-fix migration window. Defining floor sets for the remaining claimable profiles (deferred by RFC 0089 G1/G2) is additive and is a precondition for any host claiming them.

**Landed 2026-08-12** (suite `1.75.0`, `certification-floor-enforcement.test.ts`, sabotage-verified). Two design points settled in the process:

*The floors were transcribed, not invented.* `profiles.md` §"Claiming vs passing" already says a host claims a profile "by satisfying its predicate AND passing the conformance scenarios labelled with the profile tag", and its per-profile sections already name those scenarios — `stream-modes*.test.ts` for the streaming profiles, `pack-registry*.test.ts` for node-packs. `PROFILE_FLOOR_SCENARIOS` was an incomplete transcription of normative prose. That is what makes this implementation rather than design, and it means three of the published bundle's claims are **positively contradicted** by prose as already written, not merely unprovable.

*An empty floor and an unwritten floor MUST be distinguishable.* `openwop-core` and `openwop-fixtures` are discovery-payload-only by `profiles.md`, so no runtime floor is the correct answer for them. Representing that as an absent key is precisely the defect; it is now an explicit `discoveryOnly` marker, so an empty floor is a decision on record and an absent key means unprovable. A verdict carries `floorUnspecified` to keep "the corpus has no floor for this" distinct from "the host failed its floor" — both invalid, but only the first is a gap in the corpus.

`openwop-replay-fork` is deliberately left unspecified: `profiles.md` says its scenarios "pass on whichever mode the host advertises", a discovery-conditional floor a flat required-list cannot express. Forcing it would either fail an honest single-mode host or reintroduce the vacuity.

Positive: every core-standard floor requirement has `executed-pass`, and optional MCP requirements are `inapplicable` because MCP is absent from captured discovery.

Negative: a host advertises MCP, the MCP test returns because its seam is absent, and the bundle lists the scenario as passed. The v2 verifier rejects the bundle because the requirement is `blocked` or lacks a witness.

### §D — Invalidation and provenance

The project **MUST** publish an inventory of v1 bundles. A v1 bundle whose underlying run cannot prove every claimed floor requirement executed **MUST** be marked `invalidated`, not merely historical. Reissued bundles **MUST** use v2. Certification pointers **SHOULD** expose the latest valid bundle and **MAY** retain invalidated bundles with a machine-readable reason.

### §E — Security

Add protocol invariant `certification-no-vacuous-pass`: a required behavior **MUST NOT** be certified without a target execution witness. Bundles **MUST NOT** contain credentials, authorization headers, raw prompts, tool results, tenant data, or response bodies. The external audit scope **MUST** review reporter integrity, bundle tampering, configuration binding, and CI substitution.

## Compatibility

This is a safety-fix. Bundle v1 remains parseable but ceases to substantiate a new certification after a 90-day migration window. Existing hosts remain protocol-compatible; only unsupported evidence claims change. The suite minor adds v2 generation and verification, v1 warnings, an inventory tool, and a migration command. `version-negotiation.md` gains a certification-evidence migration runbook. No runtime endpoint changes.

## Conformance

Existing adjacent scenarios: `spec-corpus-validity.test.ts`, profile floor scenarios, and RFC 0089 bundle verification.

New scenarios:

- `conformance-execution-witness.test.ts` — early return cannot become pass;
- `conformance-advertised-seam-required.test.ts` — advertised missing seam fails strict mode;
- `certification-bundle-v2.test.ts` — positive/negative schema and binding vectors;
- `certification-bundle-non-vacuous.test.ts` — missing witness and blocked floor reject;
- `certification-bundle-redaction.test.ts` — secret canaries never enter evidence.

These runner-integrity scenarios are always-on and **MUST NOT** capability-skip. Fixtures include valid-v2, early-return, missing-floor, duplicate-requirement, tampered-witness, and secret-canary bundles. Reference hosts regenerate evidence; `INTEROP-MATRIX.md` records bundle version and disposition totals.

## Alternatives considered

1. Keep file-level aggregation and improve comments. Rejected: comments cannot distinguish execution from return.
2. Use Vitest's file status only. Rejected: the required unit is a normative assertion, not a source file.
3. Make every optional scenario fail when unadvertised. Rejected: honest optional absence is inapplicable, not failure.
4. Do nothing. Rejected: published evidence can overstate behavior.

## Unresolved questions

1. Should `witnessSha256` cover a canonical assertion transcript or a signed runner event?
2. ~~Which historic bundles are publicly reachable~~ (**resolved 2026-08-11**: exactly one, inventoried and invalidated in `docs/CERTIFICATION-BUNDLE-INVENTORY.md`) and who owns invalidation notices?
3. Should bundle signing land here or in RFC 0154's provenance work?
4. What stable registry owns `requirementId` values and aliases after editorial renames?

## Implementation notes (non-normative)

Replace boolean gates with a reporter-aware API that calls the test framework's explicit skip mechanism and records the reason. A per-assertion registry should be generated from scenario metadata and compared with profile floors in CI. This RFC is SR-1 under RFC 0147.

## Acceptance criteria

- [ ] Spec and bundle-v2 schema merged. (Schema landed — `schemas/certification-bundle-v2.schema.json` with per-requirement dispositions, required `blocked` total, and provenance digests, plus `certification-bundle-v2.test.ts`. Carried: spec prose, and the runner does not yet EMIT v2.)
- [x] Runner records requirement-level dispositions and rejects unclassified returns. (2026-08-16, suite `1.113.0 -> 1.114.0`: **landed.** Every scenario file records a file-level disposition into the §A ledger through `setup.ts` `afterEach`/`afterAll` hooks — `executed-pass`/`executed-fail` from vitest's per-file test states, `skipped`/`inapplicable` from the file's own `behaviorGate` decisions, `blocked` otherwise — carrying `assertionCount` (`expect.getState().assertionCalls`) so a pass with zero assertions is visible as such. `recordRequirement` appends JSONL to `OPENWOP_LEDGER_PATH`, which `--certify` sets under its report dir and reads back (`readLedgerFile`, conflict rank `executed-fail > blocked > executed-pass > skipped > inapplicable`); `scenario-disposition.ts` derives every floor and prefix requirement of every claimed profile from the ledger, and `--certify` **REJECTS** (exit 3, bundle still written) any claimed profile with an unclassified return — a requirement with no ledger row while the ledger is present (a *silent* return), or an `executed-pass` with `assertionCount: 0` (a *vacuous* one). `runner-ledger.test.ts` covers sink/reader/derivation/rejection; the first end-to-end run against the tier-1 reference host returned exit 3 and surfaced two things nothing else had: the `openwop-core-standard` floor named a scenario file that has never existed (`audit-log-verification.test.ts`; the scenario it meant gates on the optional annex profile `openwop-audit-log-integrity`, so by §C's own no-soft-skip rule it was never a floor scenario — the row is removed from `profiles.ts`, `core-standard-profile.md`, RFC 0088, and the manifest, leaving an eight-file floor), and 83 suite-wide passes with zero assertions on that host, of which `openwop.floor.pack-registry-publish` sits in a claimed floor. Earlier annotation, kept for the record: Runner emits v2 via `--bundle-version 2`, mapping unclassifiable skips to `blocked` per §A rather than to a pass — so a bundle produced today honestly does not certify. Carried: scenarios recording into the ledger, which is what would let a skip be classified as `skipped` or `inapplicable`. Ledger landed — `requirement-ledger.ts` with the five §A dispositions, absence resolving to `blocked`, and reason-required non-passes. Carried: wiring each floor scenario to record its disposition, and the runner-level rejection of unclassified returns.) (Superseded annotation, kept for the record: it read "depends on §A's requirement ledger, which is unbuilt" — the ledger has been built since `5509599f`; the earlier parenthetical above is current.)
- [ ] Strict mode fails advertised missing behavior. (§B's advertise-vs-opt-out `MUST NOT` now throws rather than warning, and gate decisions record `skipped` / `inapplicable` ledger dispositions. Carried: failing on a *missing seam* mid-scenario, which needs per-assertion instrumentation beyond the profile gate.)
- [ ] New scenarios and fixtures pass, including sabotage tests. (Partially landed — `certification-floor-enforcement.test.ts` is sabotage-verified. **2026-08-16, suite `1.115.0`:** the last two named §Conformance scenarios landed — `certification-bundle-non-vacuous.test.ts` (consumer re-derivation `verifyBundleV2`: missing witness / vacuous pass / duplicate requirement / tampered totals / invented disposition / reason-missing all REJECT the evidence; an honest `blocked` or `executed-fail` on a required row is VALID evidence that does not certify; discovery-only and undefined-floor claims handled) and `certification-bundle-redaction.test.ts` (`scrubEvidence` at the emitter — values AND keys, longest-secret-first, empties ignored — `evidenceSecretsFromEnv`, and the verifier's `secret-canary` rejection; `--certify` now scrubs the finished v1/v2 document with the handed credential + every `OPENWOP_*` key/token/secret + the conformance canary before validating and writing, and self-verifies with the consumer verifier). The fixture shapes the RFC names (valid-v2, early-return, missing-floor, duplicate-requirement, tampered-witness, secret-canary) are built INLINE against the live core-standard floor rather than committed under `fixtures/`, matching `certification-bundle-v2.test.ts`; still carried: `conformance-execution-witness.test.ts` and `conformance-advertised-seam-required.test.ts` as named files — their behaviour is enforced by `strict-behavior-gate.test.ts` + the S6 ledger wiring, but the names are not yet on disk.)
- [ ] Historic bundle inventory and invalidation/reissue record published. (Inventory landed — `docs/CERTIFICATION-BUNDLE-INVENTORY.md`. Reissue is carried and blocked on `openwop-examples`, whose committed bundle is formally invalidated and currently unowned.)
- [ ] Reference hosts publish valid v2 bundles. (Carried — blocked on the v2 schema above, and on `openwop-examples` regenerating against a passing run.)
- [ ] CHANGELOG, coverage guide, interop matrix, and migration runbook updated. (CHANGELOG landed. The rest are carried with the v2 work they describe.)

## References

- RFC 0089 and `spec/v1/conformance-certification.md`
- RFC 0147 Workstream 1
- `conformance/src/lib/behavior-gate.ts`
- `conformance/src/cli.ts` `scenarioStatesFromReport()`
- `conformance/src/lib/profiles.ts` `PROFILE_FLOOR_SCENARIOS`, `verifyBundleProfile()`
- `docs/CERTIFICATION-BUNDLE-INVENTORY.md` — the §D inventory
- `COMPATIBILITY.md` §3

