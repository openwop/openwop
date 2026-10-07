# OpenWOP Known Limits

This page lists what the protocol does not yet prove: behaviour witnessed only at the frozen major 1, conformance legs too coarse to prove the rule they test, profiles certified only by steward-run hosts, and gates that need someone outside this repository.

The page is **deliberately disagreeable.** If a row understates what the protocol can prove, open a PR with the missing evidence. If a row overstates the issue, open a PR retiring it.

For generated counts, see [`docs/PROTOCOL-STATUS.md`](./PROTOCOL-STATUS.md). For the per-family witness table at major 2, see [`docs/V2-WITNESS-COVERAGE.md`](./V2-WITNESS-COVERAGE.md).

---

## Shape-only conformance coverage

v1 reached end of support on 2026-10-04 ([RFC 0234](../RFCS/0234-maintainer-set-v1-end-of-support.md)). Some v2 rules were witnessed behaviourally only by scenarios registered at **major 1** in `conformance/scenario-majors.json`. At major 2 these rules are stated but have no behavioural leg, or only a capability-gated one that soft-skips on most hosts.

| Rule (v2 home) | Coverage at major 2 | What would close it |
| --- | --- | --- |
| A resolved secret never reaches a span or OTLP export ([host-services.md](../spec/v2/core/host-services.md) §`secrets`) | `v2-secret-canary-absent` witnesses events, snapshots, logs, SSE, run lists, error envelopes and replay forks. The OTel span and export legs (`secret-leakage-otel-attribute`, `otel-collector-canary-inspection`) are major 1 only. | Register the collector-side canary inspection at major 2 and run it against a host that exports OTLP to the conformance collector. |
| A `subscription` credential binds at user scope; a tenant or workspace bind is refused with `credential_scope_forbidden` ([host-services.md](../spec/v2/core/host-services.md)) | No major-2 scenario names `credential_scope_forbidden`. `aiproviders-subscription-scope` is major 1 only. No host may advertise `subscription` while RFC 0121 is parked, so a leg would soft-skip everywhere. | RFC 0121's legal gate clears, a host advertises the mode, and a major-2 leg drives the refusal. |
| `idempotency.multiRegion` and the `crossEngineOrdering` facet ([idempotency.md](../spec/v2/core/idempotency.md), [replay.md](../spec/v2/core/replay.md) §"Cross-engine ordering") | The simulator-driven behaviour scenarios (`multi-region-idempotency-behavior`, `cross-engine-append-behavior`) are major 1 only. No major-2 scenario drives either facet. | A major-2 port of the two simulators, and a host that advertises the facets. |
| Durable execution rungs above `durable-single-instance` ([persistence.md](../spec/v2/core/persistence.md) §"Durable acceptance and recovery") | Every committed bundle that states a rung states `durable-single-instance`. No host claims `durable-multi-instance` or `multi-region-qualified`. `peer-resume` needs two live instances at the moment of the kill, which no unattended run provides. | A host that runs two instances under a restart supervisor and cuts a bundle stating the higher rung. |
| Per-item dispatch inputs (`nextWorkerInputs`, `schemas/v2/orchestrator-decision.schema.json`) | The schema ships at v2. The behavioural legs (`dispatch-per-item-input`) are major 1 only. | A major-2 leg and a host that serves the per-item dispatch seam. |
| Context budget and transcript summarization (RFC 0111) | `context-budget-transcript-bound` and `context-summarization-replay` run at both majors but soft-skip on any host that does not advertise `multiAgent.executionModel.contextBudget`. One host (MyndHyve, tier 2) witnesses it. A host MUST NOT advertise `contextBudget` unless its orchestrator runs real model turns. | A second host that runs real orchestrator-loop model turns. |

---

## Behavior tests too coarse to fully prove an invariant

Some rules are normative but witnessed at a level that admits non-compliant edge cases the scenario does not probe.

| Invariant | Test today | Gap |
| --- | --- | --- |
| `subscription-credential-user-scope-only` (RFC 0121 §B.8) | The black-box leg asserts that a binding attempt at `scope:"tenant"` or `"workspace"` is refused (clause a). It cannot observe where an accepted `scope:"user"` bind is stored. | Clause (b), "MUST NOT be resolvable at tenant/workspace scope", is a storage property. A host can pass the wire rail yet store the personal credential on a shared-workspace row. "User-scope-only" binds the storage and resolve tenant, not just the request `scope` field: enforce both, and cover clause (b) with a host test. |
| `secret-leakage-otel-attribute` and `secret-leakage-debug-bundle-otel` | Major 1 only (see above). The conformance collector inspects what a host's OTLP exporter actually ships, not only the host's scrape seam. | At major 2 the export path is unwitnessed. The debug-bundle export has no over-the-wire analogue and remains a host self-report surface. |
| `node-pack-sandbox-no-eval` | The other seven `node-pack-sandbox-*` invariants are driven by the `pack-isolation` legs ([security-defaults.md](../spec/v2/core/security-defaults.md) §"Sandbox isolation"). | `no-eval` is JavaScript-runtime-specific and stays reference-impl by design ([`spec/v2/ext/sandbox-runtime-notes`](../spec/v2/ext/sandbox-runtime-notes/README.md); `non_testability_rationale` in `SECURITY/invariants.yaml`). |

---

## Profiles certified only by steward-run hosts

The three v2 profiles are `openwop-discovery-core`, `openwop-core-standard` and `openwop-conformance-seams-v2` (`spec/v2/profiles.json`). Every committed certification bundle in `evidence/v2-host-bundles/` comes from a host the steward runs or is affiliated with:

| Host | Tier ([`GOVERNANCE.md`](../GOVERNANCE.md) §"Acceptance evidence tiers") | Profiles certified in its committed bundle |
| --- | --- | --- |
| `openwop-host-v2-reference` (openwop-examples) | 1 | all three |
| openwop-app (`app.openwop.dev`) | 1 | `openwop-discovery-core`, `openwop-core-standard` |
| MyndHyve (`api.myndhyve.ai`) | 2, steward-affiliated | `openwop-discovery-core`, `openwop-core-standard` |

No tier-3 (independent) host has certified any profile. Outreach is in [`docs/recruitment/external-host.md`](./recruitment/external-host.md). The first tier-3 row fires the vendor-neutral migration tripwire in [`ROADMAP.md`](../ROADMAP.md).

---

## Hosted infrastructure: what is live + what is not

| Surface | Status |
| --- | --- |
| `packs.openwop.dev` registry | Live. Operated from [openwop/openwop-registry](https://github.com/openwop/openwop-registry), which owns the pack catalog, signing and publish tooling. |
| `openwop.dev` site and conformance leaderboard | Built and deployed from [openwop/openwop-site](https://github.com/openwop/openwop-site), which renders this corpus at a pinned commit. This repository is the source of truth; it does not deploy the site. |
| External security audit | **Not engaged.** The steward cannot complete a third-party audit from inside the repository. Status is in [`SECURITY/outreach/external-audit/STATUS.md`](../SECURITY/outreach/external-audit/STATUS.md). `scripts/check-audit-findings.mjs` fails the gate on any open high or critical finding in `SECURITY/external-audit-findings.json`, so findings block releases once they are recorded. |
| High-stakes `core.openwop.{ai,http,mcp,triggers}` packs | Maintained in openwop-registry; public publication is audit-gated. See [`SECURITY/external-audit-engagement.md`](../SECURITY/external-audit-engagement.md) §2.1. |

---

## External-action gates (cannot be closed without outside engagement)

No amount of repository work moves these.

| ID | What's required |
| --- | --- |
| SEC-1 | Send external audit outreach to at least three vendors. |
| SEC-7 | Complete audit vendor selection, contract and kickoff. |
| SEC-8 | Remediate findings and publish a public summary. |
| GOV-1 | Send external host recruitment outreach. |
| GOV-2 | Send external pack-author outreach. |
| GOV-5 | Add at least one external reviewer before maintainer promotion. |
| GOV-6 | Land one non-steward (tier-3) host or adapter row in `INTEROP-MATRIX.md`. |
| GOV-7 | Promote a non-steward maintainer when the criteria are met. |
| GOV-8 | Open the vendor-neutral org migration RFC after the tripwire fires. |

### RFC 0147 program — what this repository cannot close

RFC 0147 is `Accepted`, but four of its exit gates are adoption and governance events, not work items:

| Gate | Closes when | Recorded in |
| --- | --- | --- |
| §A.5 host witness for RFCs 0151–0154 | a host implements the profiles and executes every normative path in strict mode | each RFC's acceptance criteria |
| External security audit | an engagement is scheduled and completed | `SECURITY/external-audit-findings.json` |
| Second maintainer (critical risk R14) | a person volunteers | `MAINTAINERS.md`, RFC 0147 risk register |
| Tier-3 host | a non-steward organization adopts | `ROADMAP.md` tripwire |

The program's self-audit records two of its own invariants as violated rather than carrying them quietly: §A.5 (RFCs 0151–0154 reached `Accepted` on shape-only evidence) and §A.6 (five high-risk RFCs had their comment windows waived). See [`RFC-0147-SELF-AUDIT.md`](./RFC-0147-SELF-AUDIT.md).

Several `Accepted` RFCs are provisional: their comment windows were waived and the RFC 0156 §B retrospective review is owed. The owed reviews are tracked in [`docs/WAIVER-RETROSPECTIVE-REGISTER.md`](./WAIVER-RETROSPECTIVE-REGISTER.md) and summarized in [`docs/SECTION-B-REVIEW-PACKET.md`](./SECTION-B-REVIEW-PACKET.md).

---

## RFCs not yet `Accepted`

> The authoritative per-RFC status list is the generated table in [`docs/PROTOCOL-STATUS.md`](./PROTOCOL-STATUS.md). This table says _why_ each open RFC is still open.

| RFC | Status | Why open |
| --- | --- | --- |
| 0038 (Working Group charter) | `Draft` (parked) | Ratifies when the `GOVERNANCE.md` tripwire fires (at least three organizations and two non-steward hosts). The charter is written; the gate is adoption, not text. |
| 0121 (Subscription provider auth) | `Active` (parked) | The remaining acceptance criteria hinge on Unresolved Question 1, a legal or terms-of-service citation for at least one named provider. Until that clears, no host advertises `subscription`. A standing decision, not an open action. |
| 0222 (v2 registry operations) | `Active` | Leg 1 needs an `executed-pass` without `partial-witness` on the live registry, which needs a yanked v2 version to exist. |
| 0228 (v1 host-service error codes, decided for v2) | `Active` | The rename rows G1–G3, G6 and G7 close on host cuts. |
| 0237 (Nondeterminism sources) | `Active` | A certified major-2 bundle records `0237.declared-source-replays` and `0237.no-false-advertisement` `executed-pass`. |
| 0238 (UI-plugin observation path) | `Active` | A host advertising `uiPlugins.served`, with the §D fixture installed, records the four `0238.*` ids `executed-pass` on a certified bundle. |
| 0239 (Council roster input) | `Active` | A host advertising `multiPartyConversation` and the fixture records the three `0239.*` ids `executed-pass`, or roster-exceeded `inapplicable` with its reason, on a certified bundle. |

---

## Surfaces deliberately NOT standardized

OpenWOP is intentionally narrow. These surfaces belong to hosts, vendors and adopters by design. Their absence is not a gap.

- **Model SDK shape.** How a host calls a model provider is the host's choice.
- **Internal runtime topology.** Workers, queues and schedulers are the host's. OpenWOP is the wire contract, not the runtime.
- **Tool protocol.** MCP is the wire surface ([interop.md](../spec/v2/core/interop.md)); how a tool server executes a tool is its own concern.
- **Cross-process agent messaging.** A2A is the wire surface; internal RPC is the host's choice.
- **Storage engine.** [persistence.md](../spec/v2/core/persistence.md) states what must persist and survive; Postgres, SQLite, Firestore or anything else is the host's choice.
- **Authentication backend.** OpenWOP defines the auth lanes ([security-defaults.md](../spec/v2/core/security-defaults.md) §"Auth lanes", [oauth.md](../spec/v2/core/oauth.md)); IdP integration is a deployment concern.
- **Pack execution sandbox.** OpenWOP states the isolation properties and the `sandbox.isolationModel` values ([security-defaults.md](../spec/v2/core/security-defaults.md) §"Sandbox isolation"); the sandbox implementation is per host.

---

## See also

- [`docs/PROTOCOL-STATUS.md`](./PROTOCOL-STATUS.md) — generated repository state.
- [`docs/V2-WITNESS-COVERAGE.md`](./V2-WITNESS-COVERAGE.md) — which v2 families are witnessed, and how.
- [`docs/IMPLEMENTER-PATH.md`](./IMPLEMENTER-PATH.md) — the adoption path.
- [`INTEROP-MATRIX.md`](../INTEROP-MATRIX.md) — public host roster and evidence claims.
- [`SECURITY/invariants.yaml`](../SECURITY/invariants.yaml) — protocol-tier and reference-impl-tier invariants with test references or non-testability rationales.

## Seat rotation under `subscription`-mode credentials (RFC 0121 G5)

**The limit.** A `subscription`-mode credential is resolved with `scope: "user"`, so the protocol binds it to one resolving user. Nothing on the wire prevents an operator from rotating which user occupies that seat over time, and the protocol cannot see that it happened.

**Why no MUST was written.** The obvious candidate — an audit-event obligation logging every `subscription`-mode credential resolution with the resolving user id — would be a requirement nothing can witness: RFC 0121 is parked, no host may advertise the mode, so no conformance scenario could exercise it and no bundle could carry a row. A rule that cannot be checked is worse than a recorded limit, because it reads as a protection that does not exist.

**What the protocol does do.** §B.8's user-scope MUST plus the storage-tenant binding is the whole of the wire's answer. Seat rotation is an operator and provider concern, and belongs to whoever holds the provider relationship.

Transferred here from `RFCS/registers/0121-subscription-provider-auth.gaps.md` G5.
