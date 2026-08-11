# RFC 0148: Non-Vacuous Conformance and Certification Evidence

| Field | Value |
| --- | --- |
| **RFC** | 0148 |
| **Title** | Non-Vacuous Conformance and Certification Evidence |
| **Status** | `Draft` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-08-11 |
| **Updated** | 2026-08-11 |
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
2. Which historic bundles are publicly reachable and who owns invalidation notices?
3. Should bundle signing land here or in RFC 0154's provenance work?
4. What stable registry owns `requirementId` values and aliases after editorial renames?

## Implementation notes (non-normative)

Replace boolean gates with a reporter-aware API that calls the test framework's explicit skip mechanism and records the reason. A per-assertion registry should be generated from scenario metadata and compared with profile floors in CI. This RFC is SR-1 under RFC 0147.

## Acceptance criteria

- [ ] Spec and bundle-v2 schema merged.
- [ ] Runner records requirement-level dispositions and rejects unclassified returns.
- [ ] Strict mode fails advertised missing behavior.
- [ ] New scenarios and fixtures pass, including sabotage tests.
- [ ] Historic bundle inventory and invalidation/reissue record published.
- [ ] Reference hosts publish valid v2 bundles.
- [ ] CHANGELOG, coverage guide, interop matrix, and migration runbook updated.

## References

- RFC 0089 and `spec/v1/conformance-certification.md`
- RFC 0147 Workstream 1
- `conformance/src/lib/behavior-gate.ts`
- `conformance/src/cli.ts` `scenarioStatesFromReport()`
- `COMPATIBILITY.md` §3

