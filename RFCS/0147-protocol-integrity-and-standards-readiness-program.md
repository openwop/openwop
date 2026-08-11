# RFC 0147: Protocol Integrity and Standards-Readiness Program

| Field             | Value |
| ----------------- | ----- |
| **RFC**           | 0147 |
| **Title**         | Protocol Integrity and Standards-Readiness Program |
| **Status**        | `Draft` |
| **Author(s)**     | David Tufts (@davidscotttufts) |
| **Created**       | 2026-08-11 |
| **Updated**       | 2026-08-11 |
| **Affects**       | `conformance/`, `api/openapi.yaml`, `api/asyncapi.yaml`, `schemas/`, `spec/v1/{idempotency,replay,capabilities,profiles,core-standard-profile,version-negotiation,mcp-integration,a2a-integration,auth,auth-profiles,observability,multi-agent-execution}.md`, `COMPATIBILITY.md`, `GOVERNANCE.md`, `MAINTAINERS.md`, `SECURITY.md`, `INTEROP-MATRIX.md`, SDKs, reference hosts |
| **Compatibility** | Umbrella `safety-fix` program per `COMPATIBILITY.md` §3; each child RFC MUST classify its own surface as `safety-fix`, `additive`, or `breaking` |
| **Supersedes**    | — |
| **Superseded by** | — |

## Summary

This RFC creates a single accountable program to close the correctness, conformance, interoperability, security-assurance, profile, and governance gaps that currently prevent OpenWOP from credibly meeting an A-grade industry bar. It freezes non-essential optional wire growth while nine named workstreams repair certification validity, machine-contract coherence, effect safety, current A2A/MCP composition, identity and observability profiles, standards claims, and independent assurance. Each wire-affecting workstream lands through a child RFC with its own schema, conformance, security, and compatibility review; this umbrella RFC defines their common gates and sequencing. OpenWOP MUST NOT claim “industry standard,” “independently validated,” or unqualified “best-in-class” status until the exit criteria in this RFC are met.

## Motivation

OpenWOP has a broad and technically ambitious v1 corpus: 59 prose specifications, 77 JSON Schemas, 56 OpenAPI operations, AsyncAPI 3.1, 413 conformance scenario files, three SDKs, 146 RFCs, and an explicit security-invariant catalog. The protocol gate, security-invariant index, and SDK parity checks pass. Those strengths are real, but the current gates do not detect several defects that affect correctness and the credibility of conformance evidence.

The 2026-08-11 protocol assessment identified five release-blocking classes of gap:

1. **Assurance validity.** Behavioral scenarios can exit early and still count as passed, and certification aggregates at scenario-file granularity. A green bundle can therefore overstate behavior that never executed.
2. **Correctness.** Idempotency identity, replay cache-key composition, Unicode canonicalization, and multi-region winner semantics contain contradictions that can duplicate or replay the wrong external effect. The protocol has no general compensation contract for effects that cannot be rolled back by cancellation.
3. **Contract coherence and currency.** The canonical OpenAPI resolves some routes as `/v1/v1/*`; capability examples contradict the root-only discovery layout; version grammar is ambiguous; and A2A/MCP composition targets superseded protocol releases.
4. **Assurance and independence.** The external security audit has not begun, no Tier-3 independent host is recorded, and one steward remains the only maintainer despite a crossed waiver tripwire.
5. **Claim precision and implementability.** `openwop-core` can mean discovery-only compatibility, the extension surface has grown faster than independent implementation evidence, and accepted or draft documents retain stale status language.

These are protocol concerns, not reference-host implementation preferences. The spec defines the affected wire identities, certification semantics, interop profiles, compatibility claims, and governance evidence. Leaving them to individual hosts would preserve incompatible behavior and prevent independent verification.

The program uses current primary prior art as a benchmark: durable-history and versioning practices from Temporal and Azure Durable Functions; retry/catch and Saga guidance from AWS Step Functions; A2A 1.0; MCP 2026-07-28; CloudEvents and AsyncAPI; W3C Trace Context and OpenTelemetry; OAuth security BCPs, SPIFFE, and SLSA; and NIST/OWASP agentic-risk guidance.

## Proposal

### A. Program invariants

The following requirements apply to every workstream:

1. The project **MUST** freeze new non-essential optional wire capabilities until Workstreams 1–3 are Accepted and every Critical risk in the companion register is Closed or transferred to an embargoed advisory.
2. Every child RFC **MUST** complete Spec, Schema, Security, Conformance, and Compatibility reviews before `Draft → Active`.
3. Every normative behavioral requirement **MUST** have a non-vacuous execution witness, an explicit reporter-visible skip, or a failure. A plain early return **MUST NOT** satisfy a required behavior.
4. Every host compatibility or conformance claim **MUST** name the protocol version, profile, conformance-suite version, run date, configuration identity, executed assertion count, and skip/inapplicable count.
5. A child RFC **MUST NOT** reach `Accepted` using shape-only evidence for a behavioral requirement. At least one host **MUST** execute every normative behavioral path in strict mode.
6. A high-risk RFC affecting identity, authorization, isolation, idempotency, replay, external effects, or certification **MUST** complete the full public comment window. Bootstrap waiver language **MUST NOT** shorten that window.
7. A safety-fix child RFC **MUST** provide the `COMPATIBILITY.md` §3 migration package: detection, migration tooling where possible, a version-negotiation runbook, suite scenarios for old and corrected behavior, and a security/correctness CHANGELOG entry.
8. Machine-readable examples in normative prose **MUST** be extracted and validated by the corpus gate. A prose example that contradicts a canonical schema or endpoint **MUST** fail CI.
9. Each workstream **MUST** update `INTEROP-MATRIX.md`, `docs/KNOWN-LIMITS.md`, and `docs/PROTOCOL-STATUS.md` when its evidence or residual limitations change.
10. The project **MUST NOT** use this RFC's existence, Draft status, or partial implementation as evidence that the gaps are closed.

### B. Workstream 1 — Conformance and certification integrity

**Purpose:** make every published conformance result non-vacuous and reproducible.

The conformance child RFC **MUST**:

- replace boolean/early-return behavior gates with reporter-visible `executed`, `skipped`, `inapplicable`, and `failed` outcomes;
- require an assertion-level execution witness for every requirement included in a certification profile;
- make strict mode fail when an advertised capability lacks its required behavioral seam or returns a soft-skip response;
- reject certification bundles containing unclassified early returns, unavailable required seams, or a required assertion with no execution witness;
- sign or digest the scenario manifest, suite version, corpus provenance, target discovery document, configuration fingerprint, and result set;
- re-run and reissue every current public certification bundle after the corrected runner ships;
- add meta-tests proving that an advertised-but-unimplemented host fails rather than passes or disappears; and
- distinguish corpus-shape assertions from host-behavior assertions in both CLI output and machine-readable results.

This workstream amends RFC 0089 and the behavior-gate/CLI contract. It is a **safety-fix** because existing bundles may claim behavior the runner did not witness.

### C. Workstream 2 — Machine-contract and discovery coherence

**Purpose:** make prose, schemas, OpenAPI, AsyncAPI, SDK paths, examples, and discovery say the same thing.

The contract-correction child RFC **MUST**:

- change the canonical OpenAPI server base or versioned paths so every resolved operation uses exactly one `/v1` prefix;
- add a corpus test that resolves every OpenAPI server/path pair and compares the result with SDK operations and AsyncAPI channel bindings;
- migrate every normative discovery example to document-root capability families;
- fail CI on a top-level legacy `capabilities` wrapper in an OpenWOP discovery example;
- preserve v1 forward compatibility for server-emitted documents while defining a machine-enforceable extension namespace and rejecting canonical-name typos in authoring/certification tools;
- define one `protocolVersion` grammar and comparison algorithm, with positive, negative, and cross-version vectors;
- reconcile stale status, acceptance-blocker, and open-gap language in accepted specifications; and
- add status-sensitive linting so an `Accepted` RFC or `FINAL` spec cannot retain a contradictory lifecycle statement.

The OpenAPI and example corrections are defect repairs. Any stricter server-emitted schema closure that would invalidate a previously accepted extension **MUST** be deferred to v2 or implemented as authoring/certification lint rather than runtime rejection in v1.

### D. Workstream 3 — Effect identity, replay, and split-brain safety

**Purpose:** ensure retries and replay cannot duplicate or substitute semantically different effects.

The effect-safety child RFC **MUST**:

- replace retry-attempt-dependent activity identity with a stable logical invocation identity;
- specify a separate provider-attempt or transport-attempt field that may change across retries without changing the logical effect identity;
- require Layer-1 keys to be scoped by authenticated tenant, endpoint, and caller key;
- define leased pending-claim states, expiry, crash recovery, terminal response caching, and request-mismatch handling;
- replace the LLM cache-key recipe with a versioned semantic request digest containing every provider input capable of changing the outcome, including output bounds, stop conditions, seed, tool schema, response format, provider/model identity, and relevant provider options;
- use one byte-canonicalization algorithm with cross-language vectors and no fallback normalization divergence;
- replace conflicting multi-region winner language with one closed strategy vocabulary and exact convergence semantics;
- prohibit an ownership loser from issuing an unowned effect, or require effect-level idempotency that makes duplicate delivery safe; and
- emit auditable conflict, suppression, and recovery events without exposing request or credential content.

This workstream is a **safety-fix**. If compatibility analysis finds that a corrected digest or invocation identity cannot coexist with the v1 recipe, the child RFC **MUST** introduce a negotiated recipe version and a bounded dual-read migration rather than silently changing stored identities.

### E. Workstream 4 — Compensation and partial-failure semantics

**Purpose:** add the missing durable Saga capability without making it part of the bare core.

The compensation child RFC **MUST** define an additive, capability-gated profile with:

- a declarative compensation association for an effectful node or activity;
- deterministic reverse-order unwind, with an explicit override for dependency-aware compensation graphs;
- independent idempotency keys for forward and compensating effects;
- `compensation.requested`, `compensation.started`, `compensation.completed`, `compensation.failed`, and `compensation.manual_intervention_required` event semantics;
- retry, timeout, approval, cancellation, dead-letter, and operator-resume rules;
- terminal run states that distinguish compensated, partially compensated, and uncompensated failure;
- replay/fork behavior that never re-executes compensation unless the chosen mode explicitly permits live effects;
- tenant, principal, and delegated-actor attribution for every compensating action; and
- conformance fixtures for success, reverse unwind, failed compensation, repeated delivery, operator override, and crash recovery.

The profile **MUST NOT** promise atomic rollback of external systems. It provides durable orchestration and evidence for best-effort compensating actions.

### F. Workstream 5 — Current A2A and MCP composition

**Purpose:** restore current, explicitly versioned agent/tool interoperability.

The A2A child RFC **MUST** define an A2A 1.0 profile, including protocol-version negotiation, `A2A-Version` handling, current Agent Card/interface projection, task/event mapping, auth propagation, push safety, and cross-implementation tests. A2A 0.3 support **MAY** remain as a named legacy profile through a documented deprecation window, but a host **MUST NOT** advertise unqualified A2A support.

The MCP child RFC **MUST** define the MCP 2026-07-28 profile, including stateless self-describing requests, `server/discover`, required routing/version headers, MRTR replacement for long-lived callbacks, cacheable ordered lists, the extension framework, and the current authorization model. The legacy 2025-06-18 initialization/callback binding **MAY** remain behind an exact legacy profile, but generic `mcp.supported: true` **MUST NOT** hide the negotiated version.

Both child RFCs **MUST** use real upstream peers in addition to fake servers, publish the tested upstream version, and specify identity/tenant propagation across the protocol boundary.

### G. Workstream 6 — Identity, authorization, observability, and supply-chain assurance

**Purpose:** close the gap between strong bearer-token documentation and production machine-to-machine trust.

The assurance-profile child RFCs **MUST**:

- add an optional workload-identity profile capable of binding a principal to an authenticated workload identity, such as an mTLS/SPIFFE-compatible identifier;
- define delegated actor-chain provenance without treating provenance as authorization;
- define sender-constrained or equivalent proof-of-possession guidance for high-value machine credentials, aligned with current OAuth security BCPs;
- require authorization evaluation at every delegated boundary and fail closed when identity, tenant, audience, or policy provenance cannot be resolved;
- map `openwop.*` spans, metrics, events, and agent/effect identifiers to stable OpenTelemetry semantic conventions where available, while version-gating experimental GenAI attributes;
- add release, corpus, suite, SDK, and pack provenance guidance aligned with SLSA-style attestations and existing signature requirements; and
- add or update threat-model and invariant rows for confused deputy, delegated-authority escalation, cross-tenant effect identity, certification tampering, and provenance spoofing.

No credential, token, proof, SVID, authorization header, raw prompt, tool output, or compensation payload **MAY** appear in discovery, events, logs, traces, metrics, certification bundles, or debug artifacts except through an existing explicitly redacted contract.

### H. Workstream 7 — Profile names, stable core, and extension discipline

**Purpose:** make compatibility claims mean a useful and bounded thing.

The profile child RFC **MUST**:

- rename or alias the present discovery-only `openwop-core` as `openwop-discovery-core`;
- reserve unqualified “OpenWOP conformant” for the executable `openwop-core-standard` floor;
- publish a compact stable-core manifest containing the normative documents, schemas, operations, and scenarios required for that floor;
- place optional capabilities in a versioned extension registry with maturity, dependencies, security tier, suite version, and evidence tier;
- define an extension budget and require independent implementation evidence before an extension graduates to Stable;
- require claims and badges to state the exact profile set; and
- publish a v1-to-v2 plan for any existing profile name that cannot be safely corrected additively.

### I. Workstream 8 — Governance, audit, and independent interoperability

**Purpose:** make vendor-neutrality and industry assurance observable facts.

Before this program may reach `Accepted`:

- at least two maintainers unaffiliated with the original steward **MUST** be appointed under a public promotion record;
- the working-group charter **MUST** activate, and high-risk normative changes **MUST** require cross-organization approval;
- the bootstrap RFC-waiver mechanism **MUST** retire;
- high-risk RFC cohorts accepted under waived review **MUST** receive retrospective cross-organization review or be explicitly reclassified as provisional;
- an independent security audit **MUST** complete, a public summary **MUST** be published, all Critical/High findings **MUST** be remediated and retested, and Medium residuals **MUST** have owners and dates;
- at least one Tier-3 host **MUST** pass the corrected strict core-standard suite and at least one current A2A or MCP interop profile;
- the public interop matrix **MUST** distinguish steward, affiliated, and independent evidence; and
- security-response commitments in `SECURITY.md`, `GOVERNANCE.md`, and `MAINTAINERS.md` **MUST** be reconciled to one operationally supportable policy.

These are standards-readiness gates, not wire requirements imposed on hosts.

### J. Workstream 9 — Release and claims gate

A release **MUST NOT** carry an A-grade, industry-standard, independently validated, current-A2A, current-MCP, production-multi-region, or unqualified fully-conformant claim unless the corresponding evidence below is current:

| Claim | Minimum evidence |
| --- | --- |
| Fully conformant | Exact profile, protocol and suite versions, configuration, run date, executed/skip counts, corrected signed bundle |
| Current A2A compatible | A2A 1.0 profile and real-peer result |
| Current MCP compatible | MCP 2026-07-28 profile and real-peer result |
| Production multi-region | Live or production-equivalent partition/failover exercise with effect-safety evidence |
| Independently validated | Tier-3 result plus independent security audit |
| Vendor-neutral standard | Activated cross-org governance plus Tier-3 adoption |
| Best-in-class durable orchestration | Correct effect identity/replay plus accepted compensation profile and production evidence |

### Wire shape changes

This umbrella RFC adds no wire field by itself. Each wire-affecting workstream **MUST** land through a child RFC. Expected additive surfaces include versioned interop-profile identifiers, compensation events/capabilities, workload-identity metadata, and certification witness fields. Expected safety fixes include corrected idempotency/replay recipes and certification semantics.

Illustrative compensation discovery shape, **non-normative until its child RFC is Active**:

```diff
 {
   "protocolVersion": "1.0",
+  "compensation": {
+    "supported": true,
+    "profileVersion": "1",
+    "orderingModels": ["reverse-completion", "dependency-graph"],
+    "manualIntervention": true
+  }
 }
```

Illustrative certification evidence, **non-normative until the conformance child RFC is Active**:

```diff
 {
   "suiteVersion": "1.x.y",
   "profile": "openwop-core-standard",
+  "executedAssertions": 412,
+  "skippedAssertions": 9,
+  "inapplicableAssertions": 23,
+  "requirementWitnessesDigest": "sha256:…",
+  "targetConfigurationDigest": "sha256:…"
 }
```

Positive program example: a host claims core-standard conformance only after the corrected runner records an execution witness for every required behavior, names all inapplicable optional profiles, and publishes corpus/suite/configuration provenance.

Negative program example: a host advertises MCP support, returns from required MCP scenarios when the seam is absent, and publishes the scenario file as passed. Under Workstreams 1 and 5, the bundle is invalid: the missing advertised seam fails strict mode, and the host did not name an MCP protocol profile.

### Version axes

- **Spec corpus:** safety fixes and additive profiles target the next v1 minor where `COMPATIBILITY.md` §3 permits; any non-safety semantic break targets v2.
- **Conformance suite:** runner/certification corrections require a minor release and invalidation notice for affected prior bundles; implementation-only runner bugs may also receive a patch release where no assertion set changes.
- **SDKs:** additive profile types/methods require minor releases; migration helpers for safety fixes ship in the corresponding minor or patch as compatibility permits.
- **Per-run and per-event:** effect-identity and replay changes require explicit recipe/version stamps. Existing histories **MUST NOT** be silently reinterpreted under a new recipe.

### Audit and observability events

The child RFCs are expected to define or reuse content-free events/attributes for:

- conformance bundle creation and verification;
- idempotency conflict, ownership, suppression, and recovery;
- compensation lifecycle and manual intervention;
- protocol-profile negotiation and downgrade;
- delegated-actor authorization decisions; and
- provenance mismatch and verification failure.

All attributes **MUST** remain in the canonical `openwop.*` namespace, obey cardinality guidance, and exclude raw content and credentials.

## Compatibility

This umbrella program is classified as a **safety-fix** because it requires correction of observable certification, idempotency, replay, and multi-region behavior that cannot remain authoritative without leaving correctness defects in place. It does not authorize arbitrary v1 breaks.

Compatibility is evaluated per child RFC:

- **Safety-fix:** conformance accounting, retry identity, replay digest, and split-brain corrections where the old behavior is unsafe or internally contradictory. These require a 90-day public window unless an embargo applies.
- **Additive:** compensation, workload identity, new A2A/MCP profiles, evidence metadata, OTel mappings, and extension-registry metadata, all capability- or profile-gated.
- **Editorial/non-normative:** OpenAPI base correction if no normative endpoint changes, example repairs, stale status text, and claim-language qualification.
- **Breaking/v2:** removal of legacy interop profiles, runtime rejection of previously legal server-emitted extension properties, or removal/rename of an existing compatibility profile.

The migration package **MUST** include:

1. a `version-negotiation.md` detect-and-migrate section for every changed recipe/profile;
2. dual-read or version-pinned handling for stored histories and idempotency records where safe;
3. suite scenarios detecting both legacy and corrected behavior;
4. SDK helpers and warnings where a client can encounter changed behavior;
5. a public invalidation/reissue statement for affected conformance bundles; and
6. a `CHANGELOG.md` correctness or security entry, with an advisory identifier when the security process classifies the issue as CVE-class.

The workstreams create cross-implementation dependencies and are tracked as Track 14 in `docs/PROTOCOL-GAP-CLOSURE-PLAN.md`. Each child RFC MUST add its implementation repository and release dependency before becoming Active.

## Conformance

### Existing adjacent coverage

The current suite includes adjacent scenarios for core-standard profiles, idempotency, retry determinism, replay/fork, portable LLM cache keys, multi-region idempotency, A2A task round trips, MCP client/server round trips, capability shapes, profile derivation, authorization, tenant isolation, OTel emission, and contract provenance. These tests remain useful but are not sufficient until Workstream 1 closes the runner-level vacuity path.

### New program scenarios

Each child RFC **MUST** name and land its exact scenarios. The minimum program set is:

- `conformance-execution-witness.test.ts` — an advertised required seam cannot early-return into a pass;
- `certification-bundle-non-vacuous.test.ts` — a bundle with any unwitnessed required assertion is rejected;
- `openapi-resolved-paths.test.ts` — every canonical resolved operation has exactly one version prefix;
- `capability-example-root-layout.test.ts` — every extracted discovery example uses root families;
- `protocol-version-grammar.test.ts` — one canonical grammar and comparison matrix;
- `activity-id-retry-stability.test.ts` — logical identity is stable across retries and distinct across logical invocations;
- `idempotency-tenant-endpoint-scope.test.ts` — identical caller keys cannot collide across tenant or endpoint;
- `replay-semantic-request-digest.test.ts` — every outcome-changing input changes the digest, with cross-language vectors;
- `multi-region-effect-ownership.test.ts` — split-brain losers cannot duplicate a committed effect;
- `compensation-lifecycle.test.ts` and `compensation-crash-recovery.test.ts` — forward failure, reverse unwind, retry, partial failure, and operator recovery;
- `a2a-1.0-roundtrip.test.ts` — real-peer Agent Card/task/version negotiation;
- `mcp-2026-07-28-roundtrip.test.ts` — real-peer stateless discovery, headers, MRTR, caching, and auth;
- `delegated-workload-identity.test.ts` — identity provenance does not bypass authorization or tenant binding; and
- `claim-evidence-completeness.test.ts` — a public badge/result lacks no required scope field.

### Capability gating

Compensation, workload identity, A2A 1.0, MCP 2026-07-28, and optional OTel mappings are capability/profile-gated. Certification integrity, OpenAPI path resolution, canonical version grammar, root-layout example validation, and safety-corrected idempotency/replay vectors are not optional and **MUST NOT** soft-skip.

### Fixtures and reference hosts

New fixtures are required for semantic digest vectors, split-brain effect ownership, compensation graphs, partial compensation, delegated actor chains, and current A2A/MCP peers. Every fixture **MUST** be cataloged in `conformance/fixtures.md`.

At least one Tier-1 host **MUST** implement each new behavior before the relevant child RFC reaches Accepted. The umbrella program remains short of Accepted until a Tier-3 host passes the corrected core-standard floor and at least one current interop profile. Reference-host evidence files and `INTEROP-MATRIX.md` **MUST** record execution mode, suite version, and evidence tier.

## Alternatives considered

1. **Patch each defect independently without an umbrella program.** Rejected. Several fixes depend on the same claim, compatibility, governance, and evidence gates. Independent patches would allow a green status while certification, audit, or adoption remained unresolved.
2. **Declare v2 immediately and fix everything there.** Rejected as the sole approach. Some defects are safety corrections to current v1 behavior and cannot ethically remain authoritative until a future major. True non-safety breaks still belong in v2.
3. **Treat the findings as reference-app issues.** Rejected. Certification semantics, effect identity, interop versions, profile meaning, and standards claims are protocol-owned surfaces.
4. **Add more scenarios without changing the runner.** Rejected. More tests do not fix a framework that can record missing behavior as passed.
5. **Rely on documentation and self-attestation.** Rejected. The principal gaps concern discrepancies between claims and mechanically witnessed behavior.
6. **Do nothing because current gates are green.** Rejected. The defects were found outside those gates; a green validator cannot prove the semantic intent of a valid but contradictory contract.

## Unresolved questions

1. Which previous public conformance bundles contain unwitnessed required behavior and therefore require formal invalidation rather than simple supersession?
2. Should the corrected activity/replay recipe use a new v1 recipe identifier with dual-read migration, or does any deployed history require a v2-only interpretation?
3. Which compensation ordering model is the mandatory floor: reverse completion, reverse declaration, or a dependency graph with reverse completion as a default?
4. What exact legacy-support window should apply to A2A 0.3 and MCP 2025-06-18 profiles?
5. Which workload-identity binding is sufficiently technology-neutral while remaining directly mappable to SPIFFE/SVID and cloud-native identities?
6. Can discovery authoring be closed against canonical typos without violating the v1 requirement that server-emitted shapes remain open to future optional fields?
7. Which already-Accepted high-risk RFC cohorts require retrospective ratification, and who qualifies as an independent reviewer before new maintainers are appointed?
8. What budget and contracting authority fund the external audit and its retest?
9. Which organization is the first realistic Tier-3 host candidate, and what support can be offered without turning it into steward-affiliated evidence?
10. Should the public A-grade gate be maintained as a machine-readable release policy, a governance checklist, or both?

## Implementation notes (non-normative)

Recommended sequence:

1. **Immediate safety:** Workstreams 1–3; correct public claims; freeze optional growth.
2. **Durable semantics and current interop:** Workstreams 4–6.
3. **Implementability and independence:** Workstreams 7–8.
4. **Reassessment:** Workstream 9 runs only after every Critical/High acceptance gate has evidence.

Recommended child-RFC decomposition, using the next free number at the time each is authored:

| Child | Scope | Initial classification |
| --- | --- | --- |
| [RFC 0148](./0148-non-vacuous-conformance-certification.md) | Non-vacuous conformance and certification evidence | Safety-fix |
| [RFC 0149](./0149-machine-contract-and-version-reconciliation.md) | Machine-contract, example, and version-grammar reconciliation | Safety-fix/editorial split |
| [RFC 0150](./0150-effect-identity-replay-and-split-brain-safety.md) | Retry identity, replay semantic digest, and split-brain effect ownership | Safety-fix |
| [RFC 0151](./0151-compensation-and-partial-failure-profile.md) | Compensation and partial-failure profile | Additive |
| [RFC 0152](./0152-a2a-1-0-versioned-composition.md) | A2A 1.0 versioned composition | Additive with legacy deprecation |
| [RFC 0153](./0153-mcp-2026-07-28-versioned-composition.md) | MCP 2026-07-28 versioned composition | Additive with legacy deprecation |
| [RFC 0154](./0154-workload-identity-delegation-telemetry-and-provenance.md) | Workload identity, delegation, OTel, and provenance assurance | Additive |
| [RFC 0155](./0155-core-profile-and-extension-discipline.md) | Core profile naming and extension registry | Additive now; removals in v2 |
| [RFC 0156](./0156-governance-independent-assurance-and-claims.md) | Governance, independent evidence, and claims policy | Governance/normative process |

The external audit should review RFC 0148 and RFC 0150 designs before implementation freeze, then retest their implementations together with authentication, pack isolation, credential egress, and certification-bundle integrity.

## Acceptance criteria

- [ ] Workstreams 1–3 are implemented; affected prior conformance bundles are inventoried, invalidated where necessary, and reissued.
- [ ] OpenAPI resolves every operation correctly and normative discovery examples are mechanically validated.
- [ ] Idempotency, replay digest, canonicalization, and split-brain semantics are internally consistent and pass cross-language/adversarial vectors.
- [ ] A capability-gated compensation profile and non-vacuous reference implementation pass crash, retry, partial-failure, and operator-recovery scenarios.
- [ ] A2A 1.0 and MCP 2026-07-28 profiles pass against real upstream peers; legacy profiles are explicitly named and time-bounded.
- [ ] Workload identity/delegation, observability mapping, and provenance guidance land with threat-model and invariant coverage.
- [ ] Core/profile naming and the versioned extension registry make unqualified conformance claims unambiguous.
- [ ] The external security audit completes; all Critical/High findings are remediated and retested.
- [ ] At least two independent maintainers are appointed and the working-group charter activates.
- [ ] At least one Tier-3 host passes the corrected strict core-standard suite and one current interop profile.
- [ ] `INTEROP-MATRIX.md`, `SECURITY.md`, `GOVERNANCE.md`, `MAINTAINERS.md`, `COMPATIBILITY.md`, `ROADMAP.md`, `docs/KNOWN-LIMITS.md`, `docs/PROTOCOL-STATUS.md`, and `CHANGELOG.md` reflect the evidence accurately.
- [ ] Every child RFC's gap and risk registers receive an acceptance sweep.
- [ ] A new independent assessment finds no Critical open gap and scores every weighted protocol dimension at B or higher, with the overall result at A- or better.

## References

- 2026-08-11 OpenWOP protocol and reference-app industry assessment: `../../openwop-app/docs/steward/OPENWOP-PROTOCOL-APP-INDUSTRY-ASSESSMENT.md`
- `COMPATIBILITY.md` §3 — safety-fix exception
- `GOVERNANCE.md` — evidence tiers and working-group path
- `MAINTAINERS.md` — bootstrap waiver ledger and tripwire
- `SECURITY.md` and `SECURITY/external-audit-engagement.md`
- RFC 0036 — multi-region idempotency and cross-engine ordering
- RFC 0073 — root capability layout
- RFC 0085 — agent-platform profile
- RFC 0089 — conformance certification bundle
- RFC 0094 — wire-shape reconciliation and schema-closure policy
- RFC 0140 — replay side-effect suppression
- RFC 0146 — contract provenance
- [A2A Protocol 1.0](https://a2a-protocol.org/latest/specification/)
- [MCP 2026-07-28 release](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- [Temporal workflow execution](https://docs.temporal.io/workflow-execution)
- [Temporal Worker Versioning](https://docs.temporal.io/production-deployment/worker-deployments/worker-versioning)
- [AWS Saga patterns](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/saga-patterns.html)
- [Azure Durable Functions](https://learn.microsoft.com/en-us/azure/durable-task/durable-functions/durable-functions-overview)
- [CloudEvents](https://github.com/cloudevents/spec)
- [AsyncAPI 3.0](https://www.asyncapi.com/docs/reference/specification/v3.0.0)
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)
- [OpenTelemetry semantic conventions](https://opentelemetry.io/docs/specs/semconv/)
- [OAuth 2.0 Security Best Current Practice, RFC 9700](https://www.rfc-editor.org/info/rfc9700/)
- [SPIFFE overview](https://spiffe.io/docs/latest/spiffe-about/overview/)
- [SLSA 1.2](https://slsa.dev/spec/v1.2/)
- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework)
- [OWASP Agentic AI threats and mitigations](https://genai.owasp.org/resource/agentic-ai-threats-and-mitigations/)
