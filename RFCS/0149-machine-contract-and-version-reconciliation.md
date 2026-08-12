# RFC 0149: Machine-Contract and Version Reconciliation

| Field | Value |
| --- | --- |
| **RFC** | 0149 |
| **Title** | Machine-Contract and Version Reconciliation |
| **Status** | `Accepted` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-08-11 |
| **Updated** | 2026-08-12 (`Active` -> `Accepted`; 7-day comment window waived by the steward per `MAINTAINERS.md` §"Bootstrap-phase RFC waivers". **Landed:** §A canonical URL resolution — 44 operations resolved `/v1/v1/*`, plus discovery itself; fixed with `openapi-resolved-paths.test.ts` (#942). §B wrapper lint with all eight normative examples unwrapped, `capability-example-root-layout.test.ts` (#945). §D feasibility measured and the checkbox hypothesis corrected (#946, #948). Suite `1.76.0`. §C `protocolVersion` grammar — the field was specified three incompatible ways at once (schema `minLength: 1`, predicate `startsWith('1.')`, prose calling it semver), so `"1.0.0"` both validated AND derived `openwop-core`; now `^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$` in the schema, `profiles.ts`, and `version-negotiation.md` §"Protocol version grammar", with a leg asserting the schema pattern and the predicate are the same string. Closes gap V2, open since v1.0. Suite `1.79.0`. **Carried forward, not closed:** §D's lifecycle gate (measured; the annotated-vs-bare rule is recommended, not enforced), and §E's `discovery-canonical-family-no-shadow` invariant.) |
| **Affects** | `api/openapi.yaml`, `api/asyncapi.yaml`, `schemas/capabilities.schema.json`, `spec/v1/{capabilities,version-negotiation,profiles}.md`, normative examples, corpus generators and SDK parity gates |
| **Compatibility** | `safety-fix` for machine-contract defects; editorial/additive for examples and authoring lint |
| **Supersedes** | Contradictory base-path, discovery-wrapper, and protocol-version examples |
| **Superseded by** | — |

## Summary

This RFC reconciles OpenWOP's machine contracts so OpenAPI, AsyncAPI, SDKs, prose examples, discovery layout, and protocol-version grammar resolve to one canonical interpretation. It removes the duplicated OpenAPI `/v1` base, validates every normative example, standardizes `protocolVersion` as major.minor, and adds authoring-time typo detection without closing forward-compatible server-emitted documents at runtime.

## Motivation

The canonical OpenAPI server URL ends in `/v1` while versioned paths also begin `/v1`, so generic resolution yields `/v1/v1/runs`. Normative capability examples still use the prohibited top-level `capabilities` wrapper even though RFC 0073 requires families at the document root. `protocolVersion` is described as semver, accepted with `startsWith('1.')`, and illustrated as `1.0`. Validators pass because they check shape, not cross-artifact intent.

## Proposal

### §A — Canonical URL resolution

```diff
 servers:
-  - url: https://{host}/v1
+  - url: https://{host}
```

All canonical versioned paths remain `/v1/*`; `/.well-known/openwop` remains unversioned. A corpus gate **MUST** resolve every server/path pair and prove exactly one `/v1` segment for versioned operations. SDK operation URLs and AsyncAPI bindings **MUST** match the resolved OpenAPI path.

**Landed 2026-08-11** as `openapi-resolved-paths.test.ts` (suite `1.74.0`) plus the one-line `servers[].url` correction. The gate was written first and observed red against the uncorrected document, then green after it — 44 versioned path keys resolved to `/v1/v1/*` before the fix.

The red run surfaced a second consequence this section had not anticipated: **`/.well-known/openwop` is a path key in the same document**, so the duplicated base resolved it to `/v1/.well-known/openwop`. A client generated from the canonical contract could not perform discovery at all, which is a worse failure than a mis-resolved operation because discovery is the bootstrap — every capability decision downstream depends on it. The gate therefore asserts unversioned resolution for `/.well-known/*` as a distinct leg, since a base path that silently versions the discovery route is the same defect pointing the other way.

Classified **editorial** rather than safety-fix on the evidence that nothing which ever worked can break: the doubled prefix names routes no host serves, and the reference SDKs already issue `/v1/runs` against a bare base URL, so the SDKs and the OpenAPI document disagreed and the SDKs were correct. Resolves UQ1.

### §B — Discovery examples and authoring validation

Every OpenWOP discovery example **MUST** place canonical capability families at document root. A top-level property named `capabilities` in an OpenWOP discovery example **MUST** fail authoring CI. Server-emitted discovery remains open at runtime for additive v1 fields. Authoring lint **MUST** reject:

- a legacy `capabilities` wrapper;
- a property within edit distance one of a canonical family unless it is namespaced `x-host-*` or `vendor.*`; and
- a vendor field occupying a canonical reserved name.

The runtime schema **MUST NOT** reject an otherwise legal unknown server-emitted property solely because an older client does not recognize it.

**Wrapper lint landed 2026-08-12** as `capability-example-root-layout.test.ts` (suite `1.76.0`), with all eight offending `spec/v1` examples unwrapped. The defect was worse than "some examples are stale": several sat under headings such as *"Capability advertisement (normative)"*, introduced by prose saying hosts "advertise it under `/.well-known/openwop`" — so the corpus taught, in normative voice, a document shape RFC 0073 Phase 4 grades as non-conformant. **No gate caught it because a fenced example is prose to every validator in the corpus**, which is the same blind spot RFC 0149 §D addresses for examples generally.

Classified **editorial**: RFC 0073 already made root layout the normative MUST, so this corrects examples to match a rule that has been in force since Phase 1 rather than changing one. Runtime tolerance is untouched — the lint reads no host, and the wrapper remains a legal server-emitted shape until it retires with the schema's `additionalProperties` tolerance at v2.0.

**The historical carve-out is asserted, not assumed.** Every `RFCS/` example still showing the wrapper is in an RFC numbered below 0073, so those are left as the dated record of what was proposed — rewriting them would make the record lie. The lint tests that boundary, so a *new* post-0073 RFC introducing a wrapper fails and the exemption cannot widen into a licence.

Two further defects surfaced in the same snippets and are **not** fixed here, because both belong to sections still inside their own safety-fix window: `idempotency.md`'s advertisement example is the `partitionRecoveryStrategy: "last-writer-wins"` value RFC 0150 §D retires, and it is fenced as ```json while containing `"crossRegion": "single-region" | "best-effort" | "strict"`, which no JSON parser accepts — an example that cannot parse, which is exactly what §D's extraction requirement is for.

Positive:

```json
{ "protocolVersion": "1.0", "idempotency": { "supported": true } }
```

Negative authoring example:

```json
{ "protocolVersion": "1.0", "capabilities": { "idempotency": { "supported": true } } }
```

### §C — Protocol version grammar

`protocolVersion` **MUST** use ASCII `<major>.<minor>` with no leading zero except zero itself: `^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`. `1.0` and `1.12` are valid; `1`, `1.0.0`, `v1.0`, and `01.0` are invalid. Compatibility comparison uses the integer major as the hard boundary and minor as the additive contract level. Patch belongs to suite/SDK versions, not the spec version.

Hosts **MUST** advertise the highest protocol minor they implement. Consumers **MUST** reject a different unsupported major and **MUST** tolerate a higher minor under v1 additive rules while capability-gating optional behavior.

### §D — Lifecycle coherence

The corpus generator **MUST** fail when an `Accepted` RFC retains an unresolved acceptance blocker not explicitly carried to a register/known-limit, or when a Stable/FINAL spec describes its owning RFC as pending acceptance. Normative examples **MUST** be extracted into fixtures and validated against the same schemas used by conformance.

### §E — Security

Add invariant `discovery-canonical-family-no-shadow`: a vendor extension **MUST NOT** shadow or wrap a canonical capability family in a way that changes negotiation. This is structural and server-free. No discovery example may contain credentials or tenant data.

## Compatibility

The OpenAPI base correction describes the already normative endpoints and is a safety defect repair for generators; it does not move a real endpoint. Hosts that accidentally served `/v1/v1/*` MAY retain a non-normative redirect during migration. Example corrections and lifecycle lint are non-wire changes. The major.minor grammar codifies the dominant wire shape; the suite first warns on legacy `1.0.0`, then enforces after the 90-day safety window. Runtime discovery stays open, preserving v1 forward compatibility.

## Conformance

New scenarios:

- `openapi-resolved-paths.test.ts`;
- `openapi-asyncapi-sdk-parity.test.ts`;
- `capability-example-root-layout.test.ts`;
- `discovery-canonical-family-no-shadow.test.ts`;
- `protocol-version-grammar.test.ts`; and
- `rfc-lifecycle-coherence.test.ts`.

All are server-free and always-on. Fixtures cover valid root discovery, wrapper, typo, vendor extension, version grammar, and every extracted normative example. SDK repositories consume a generated canonical operation-path manifest.

## Alternatives considered

1. Remove `/v1` from every OpenAPI path. Rejected: it would make path keys disagree with actual endpoints and AsyncAPI organization.
2. Close discovery with `additionalProperties:false`. Rejected for v1 server-emitted forward compatibility.
3. Keep semver patch in `protocolVersion`. Rejected: the corpus version axis is major.minor and examples/behavior use it.
4. Do nothing. Rejected: green validators produce incorrect clients and contradictory examples.

## Unresolved questions

1. ~~Which generators or clients have implemented a workaround for `/v1/v1`?~~ **Resolved 2026-08-11** — none. The reference SDKs issue `/v1/*` against a bare base URL, so they never consumed the OpenAPI server value; no host serves the doubled route; and no workaround was found in the corpus or the SDK repositories. This is what made the correction editorial.
2. What edit-distance rule avoids false positives for legitimate extension names?
3. Is a temporary `1.0.0` normalization warning required for any deployed host?
4. Which stale lifecycle statements are intentional historical notes rather than defects? **Measured 2026-08-12** (`docs/RFC-LIFECYCLE-COHERENCE.md`): the acceptance-checkbox signal is *inconsistent, not absent* — of 141 `Accepted` RFCs, 42% ticked every box, 25% ticked none, 24% ticked some. A blanket gate would fail 69 RFCs, mostly for an authoring convention, and a gate that fires 69 times on its first run gets disabled rather than fixed. The **34 partial** RFCs are the real triage set: someone was ticking and stopped. **Triaged 2026-08-12, and the first hypothesis was wrong.** The 34 partial RFCs are not a blocker backlog: reading the eight trailing items across `0027`/`0028`/`0029`/`0040`/`0041` shows every one is deliberately unticked *and annotated with why* — "(Will land alongside the first non-steward advertisement.)", "(Path-to-Accepted.)", "(Follow-up — … not normative gate-blockers.)". That inline annotation **is** §D's "explicitly carried", just carried in a parenthetical rather than a register row. Re-measured on that basis: **150 unticked items are annotated, 200 are bare** — and the bare ones are dominated by items self-evidently *done* (`0003`: "Spec text merged (this file)"), clustered in the RFCs where nobody ticked anything. So the signal §D wants is **annotated vs bare, not ticked vs unticked**: *an unticked acceptance item MUST carry its reason — an external gate, a follow-up note, or a register/known-limit pointer.* Enforceable immediately for new RFCs; 200 existing items would need annotating before it could apply retroactively. Still open: the "Stable spec describes its RFC as pending" half, whose phrasing search returned no hits (recorded as unproven, not clean).

## Implementation notes (non-normative)

Land the URL-resolution test before the YAML correction to prove it red. Example extraction should preserve source file/line in failures. This RFC is SR-2 under RFC 0147.

## Acceptance criteria

- [ ] OpenAPI paths resolve correctly and match AsyncAPI/SDKs.
- [ ] All normative discovery examples use root layout and validate.
- [ ] Authoring lint catches wrappers, canonical typos, and shadows without closing runtime discovery.
- [ ] Version grammar and migration warning land.
- [ ] Lifecycle coherence gate passes across the corpus.
- [ ] CHANGELOG, SDK path manifest, and version-negotiation runbook updated.

## References

- RFC 0073, RFC 0094, RFC 0144, RFC 0146
- `spec/v1/capabilities.md` §Document-root layout
- `spec/v1/version-negotiation.md`
- `COMPATIBILITY.md` §§2–3
- RFC 0147 Workstream 2

