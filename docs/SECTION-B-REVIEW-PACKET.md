# RFC 0156 §B retrospective-review packet

> **GENERATED** by `scripts/generate-review-packet.mjs` from `docs/WAIVER-RETROSPECTIVE-REGISTER.md` and `RFCS/`. Do not edit by hand; `openwop:check` fails when it is stale.

## What this is, and who it is for

RFC 0156 §B: RFCs affecting auth, identity, tenant isolation, secrets, packs, execution sandboxing, idempotency, replay, external effects, conformance/certification, or governance **MUST** receive a retrospective **cross-organization** review. Every RFC below was accepted with its public comment window shortened, either under the bootstrap waiver or by explicit steward override of RFC 0147 §A.6. Each such acceptance is **provisional** until a reviewer from an organization other than the steward's records an outcome.

This packet is for that reviewer. **94 RFCs are listed; 94 have no discharging outcome.** The steward, the steward's sessions, and steward-affiliated hosts (MyndHyve is tier-2, not independent) cannot supply the review. Recording one of their reviews as `ratified` is the substitution §B's last clause forbids.

## How to review one RFC

1. Read the RFC (linked) — Summary, Proposal, and `### Falsifiability`. The evidence tier in its `Updated` field names what witnessed it.
2. Answer, for the §B area it sits under:
   - Does the normative text prevent the harm the area names, or only describe it?
   - Is each MUST observable, and does its falsifiability row name a test that can actually fail? (Every witness row names the sabotage that turns it red.)
   - Did shortening the comment window hide an objection a wider audience would have raised? Name it if so.
   - Is anything claimed as witnessed that the cited evidence does not show?
3. Record one outcome from §B's closed vocabulary (`ratified | corrective-rfc-required | provisional | withdrawn`) by a pull request that edits the RFC's row in `docs/WAIVER-RETROSPECTIVE-REGISTER.md`: your organization in **Reviewer org**, the date, the outcome. For anything but `ratified`, open an issue naming the defect or the pending work and link it from the PR. The PR must be authored by the reviewer (DCO sign-off), not by the steward on the reviewer's behalf.
4. You may also narrow the **§B scope** column (`out-of-scope` with a one-line rationale). That too is a reviewer judgement, never a mechanical one.

Grouping below is a reading aid only: it assigns each RFC to the risk class its waiver recorded, else to the first §B area its title names. It is not a scope assessment.

## Identity and authorization (13)

| RFC | Title | Status | Waiver | Evidence tier | Outcome |
| --- | --- | --- | --- | --- | --- |
| [0050](../RFCS/0050-saml-scim-enterprise-identity-profiles.md) | saml scim enterprise identity profiles | `Accepted` | bootstrap waiver | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0079](../RFCS/0079-credential-provenance-and-egress-policy.md) | credential provenance and egress policy | `Accepted` | bootstrap waiver | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0121](../RFCS/0121-subscription-provider-auth.md) | subscription provider auth | `Active` | bootstrap waiver | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0150](../RFCS/0150-effect-identity-replay-and-split-brain-safety.md) | effect identity replay and split brain safety | `Accepted` | bootstrap waiver | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0154](../RFCS/0154-workload-identity-delegation-telemetry-and-provenance.md) | workload identity delegation telemetry and provenance | `Accepted` | bootstrap waiver | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0170](../RFCS/0170-v2-identity.md) | v2 identity | `Accepted` | bootstrap waiver | tier-1 — steward-verified**, corroborated tier-2 | `not-reviewed` |
| [0199](../RFCS/0199-outbound-oauth-client-and-credential-interrupt.md) | the host as an OAuth client, and the `credential` interrupt | `Active` | steward override of RFC 0147 §A.6 | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0200](../RFCS/0200-host-as-oauth-protected-resource.md) | the host as an OAuth protected resource | `Accepted` | steward override of RFC 0147 §A.6 | tier-2 — MyndHyve's certified major-2 bundle on published suite 2 | `not-reviewed` |
| [0202](../RFCS/0202-per-agent-a2a-agent-cards.md) | each inventoried agent is published as an A2A Agent Card | `Accepted` | steward override of RFC 0147 §A.6 | tier-1 — the v2 reference host | `not-reviewed` |
| [0209](../RFCS/0209-v2-a2ui-surfaces-are-a2ui-v0-9.md) | v2 A2UI surfaces are A2UI v0.9 | `Accepted` | steward override of RFC 0147 §A.6 | tier-1 — the v2 reference host | `not-reviewed` |
| [0210](../RFCS/0210-lane-revocation-rule-is-measured.md) | a lane's revocation rule is measured, and a host that only honours `exp` says so | `Active` | steward override of RFC 0147 §A.6 | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0213](../RFCS/0213-three-unstated-v2-outcomes.md) | three outcomes the v2 core never stated — a resume cursor past the log, the loser of a same-key race, and a r… | `Accepted` | steward override of RFC 0147 §A.6 | tier-1 — the v2 reference host | `not-reviewed` |
| [0214](../RFCS/0214-a2a-push-credential-is-a-destination-credential.md) | an A2A push credential is a destination credential, and a push is an egress like any webhook | `Accepted` | steward override of RFC 0147 §A.6 | tier-1 — the v2 reference host | `not-reviewed` |

## Tenant isolation (5)

| RFC | Title | Status | Waiver | Evidence tier | Outcome |
| --- | --- | --- | --- | --- | --- |
| [0182](../RFCS/0182-run-list.md) | `listRuns` — portable, tenant-scoped, paginated run list | `Accepted` | bootstrap waiver | tier-1 — steward-verified** | `not-reviewed` |
| [0198](../RFCS/0198-mcp-server-mount-tasks.md) | the MCP server mount maps long runs to MCP Tasks, and a disconnect cancels only the run it owns | `Accepted` | steward override of RFC 0147 §A.6 | tier-1 — the v2 reference host | `not-reviewed` |
| [0208](../RFCS/0208-v2-a2a-mcp-operation-mappings.md) | v2 homes the A2A and MCP operation mappings | `Accepted` | steward override of RFC 0147 §A.6 | tier-1 — the v2 reference host | `not-reviewed` |
| [0211](../RFCS/0211-a2a-error-details-are-errorinfo.md) | an A2A error's details are an ErrorInfo, and an A2A interface never answers in the OpenWOP envelope | `Accepted` | steward override of RFC 0147 §A.6 | tier-1 — the v2 reference host | `not-reviewed` |
| [0215](../RFCS/0215-webhook-delivery-isolation.md) | a webhook delivery does not wait on another subscription's receiver, and an unregistered subscription gets no… | `Accepted` | steward override of RFC 0147 §A.6 | tier-2 — MyndHyve | `not-reviewed` |

## Packs and registry (8)

| RFC | Title | Status | Waiver | Evidence tier | Outcome |
| --- | --- | --- | --- | --- | --- |
| [0043](../RFCS/0043-registry-and-extension-policy.md) | registry and extension policy | `Accepted` | bootstrap waiver | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0066](../RFCS/0066-x-openwop-form-vendor-extension.md) | x openwop form vendor extension | `Accepted` | bootstrap waiver | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0076](../RFCS/0076-pack-runtime-requirements-and-host-safe-fetch.md) | pack runtime requirements and host safe fetch | `Accepted` | bootstrap waiver | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0077](../RFCS/0077-agent-run-lifecycle-and-live-manifest-dispatch.md) | agent run lifecycle and live manifest dispatch | `Accepted` | bootstrap waiver | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0155](../RFCS/0155-core-profile-and-extension-discipline.md) | core profile and extension discipline | `Accepted` | bootstrap waiver | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0177](../RFCS/0177-v2-registry-packs-and-extension-tail.md) | v2 registry, packs, and the extension tail | `Accepted` | bootstrap waiver | tier-1 AND tier-2 — both required | `not-reviewed` |
| [0180](../RFCS/0180-vendor-org-registration-procedure.md) | Vendor-org registration procedure | `Accepted` | bootstrap waiver | corpus gate — no host tier is claimed**: every obligation in this RFC is a property of th… | `not-reviewed` |
| [0203](../RFCS/0203-remote-runtime-mcp-registry-record.md) | a remote node-pack runtime may name its MCP server by its registry record | `Accepted` | bootstrap waiver | corpus gate — no host tier is claimed**: every rule here is a property of the signed mani… | `not-reviewed` |

## Idempotency (2)

| RFC | Title | Status | Waiver | Evidence tier | Outcome |
| --- | --- | --- | --- | --- | --- |
| [0093](../RFCS/0093-protocol-hardening-webhooks-tokens-idempotency.md) | protocol hardening webhooks tokens idempotency | `Accepted` | bootstrap waiver | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0201](../RFCS/0201-standard-webhooks-signature-scheme.md) | Standard Webhooks as an opt-in companion signature scheme, with a signed delivery id, multi-signature rotatio… | `Accepted` | steward override of RFC 0147 §A.6 | tier-1 — the v2 reference host | `not-reviewed` |

## Replay (2)

| RFC | Title | Status | Waiver | Evidence tier | Outcome |
| --- | --- | --- | --- | --- | --- |
| [0194](../RFCS/0194-terminal-event-ends-forward-execution.md) | a run's terminal event is emitted once and ends its forward execution | `Accepted` | steward override of RFC 0147 §A.6 | tier-1 — the v2 reference host | `not-reviewed` |
| [0212](../RFCS/0212-canonical-json-is-jcs.md) | canonical JSON is RFC 8785 JCS, and a certification preimage does not depend on the machine that computed it | `Accepted` | steward override of RFC 0147 §A.6 | tier-1 — steward-verified: openwop-app `bundle-v3-verify | `not-reviewed` |

## External effects (10)

| RFC | Title | Status | Waiver | Evidence tier | Outcome |
| --- | --- | --- | --- | --- | --- |
| [0151](../RFCS/0151-compensation-and-partial-failure-profile.md) | compensation and partial failure profile | `Accepted` | bootstrap waiver | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0152](../RFCS/0152-a2a-1-0-versioned-composition.md) | a2a 1 0 versioned composition | `Accepted` | bootstrap waiver | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0153](../RFCS/0153-mcp-2026-07-28-versioned-composition.md) | mcp 2026 07 28 versioned composition | `Accepted` | bootstrap waiver | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0157](../RFCS/0157-chain-fragments-carry-compensation.md) | chain fragments carry compensation | `Accepted` | bootstrap waiver | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0187](../RFCS/0187-host-found-bindings.md) | Four bindings the hosts found | `Accepted` | bootstrap waiver | tier-1 — steward-verified | `not-reviewed` |
| [0188](../RFCS/0188-webhook-dead-letter-read.md) | The webhook delivery dead-letter read: the seat that makes `deliveryId` witnessable, the run/delivery sink sp… | `Accepted` | bootstrap waiver | tier-1 — steward-verified | `not-reviewed` |
| [0196](../RFCS/0196-callbackurl-and-embedded-ipv4-egress.md) | `callbackUrl` refused or delivered under the egress guard; embedded IPv4 judged as IPv4 | `Accepted` | steward override of RFC 0147 §A.6 | tier-2 — MyndHyve `workflow-runtime`, a production host | `not-reviewed` |
| [0204](../RFCS/0204-host-mcp-client-returns-mcp-results.md) | the v2 host MCP client returns MCP results | `Accepted` | bootstrap waiver | tier-1 — the v2 reference host | `not-reviewed` |
| [0205](../RFCS/0205-run-artifacts-and-turns-speak-a2a-parts.md) | run artifacts and conversation content speak A2A Parts | `Accepted` | bootstrap waiver | tier-1 — the v2 reference host | `not-reviewed` |
| [0207](../RFCS/0207-trace-context-across-mcp-and-a2a.md) | trace context across MCP and A2A, and debug-bundle spans that join the trace | `Accepted` | bootstrap waiver | tier-1 — the v2 reference host | `not-reviewed` |

## Conformance and certification (9)

| RFC | Title | Status | Waiver | Evidence tier | Outcome |
| --- | --- | --- | --- | --- | --- |
| [0083](../RFCS/0083-durable-trigger-and-channel-bridge-profile.md) | durable trigger and channel bridge profile | `Accepted` | bootstrap waiver | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0085](../RFCS/0085-agent-platform-meta-profile.md) | agent platform meta profile | `Accepted` | bootstrap waiver | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0106](../RFCS/0106-realtime-voice-session-profile.md) | realtime voice session profile | `Accepted` | bootstrap waiver | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0148](../RFCS/0148-non-vacuous-conformance-certification.md) | non vacuous conformance certification | `Accepted` | bootstrap waiver | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0166](../RFCS/0166-register-dispositions-terminal-states-witness-classes.md) | register dispositions terminal states witness classes | `Accepted` | bootstrap waiver | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0168](../RFCS/0168-v2-evidence-and-conformance.md) | v2 evidence and conformance | `Accepted` | bootstrap waiver | tier-1 — steward-verified**, corroborated tier-2 | `not-reviewed` |
| [0195](../RFCS/0195-certification-bundle-hardening.md) | a certification bundle's declarations are signed, and an unobserved requirement is `blocked` | `Accepted` | steward override of RFC 0147 §A.6 | tier-1 — the v2 reference host | `not-reviewed` |
| [0197](../RFCS/0197-v2-surfaces-retired-never-reshaped.md) | v2 surfaces are retired, never reshaped | `Accepted` | steward override of RFC 0147 §A.6 | tier-1 — the v2 reference host | `not-reviewed` |
| [0216](../RFCS/0216-colocated-witness-for-harness-trust-anchor-rows.md) | a colocated companion bundle is marked, and witnesses only the rows that need the suite's own issuer | `Accepted` | steward override of RFC 0147 §A.6 | corpus gate — no host tier | `not-reviewed` |

## Governance (5)

| RFC | Title | Status | Waiver | Evidence tier | Outcome |
| --- | --- | --- | --- | --- | --- |
| [0156](../RFCS/0156-governance-independent-assurance-and-claims.md) | governance independent assurance and claims | `Accepted` | bootstrap waiver | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0174](../RFCS/0174-v2-governance.md) | v2 governance | `Accepted` | bootstrap waiver | corpus gate — no host tier is claimed at the release candidate | `not-reviewed` |
| [0178](../RFCS/0178-v2-assurance-registers-and-deprecation-machinery.md) | v2 assurance registers and deprecation machinery | `Accepted` | bootstrap waiver | corpus gate — no host tier is claimed at the release candidate | `not-reviewed` |
| [0190](../RFCS/0190-kernel-budget-denominator.md) | The kernel budget measures what the home gate accepts, and its cap grows only as debt is retired | `Accepted` | bootstrap waiver | corpus gate — every requirement id in the falsifiability table carries a row in `evidence… | `not-reviewed` |
| [0192](../RFCS/0192-facet-advertisement.md) | A facet is advertised by the presence of its key; the 26 descriptions that gated on a retired field | `Accepted` | bootstrap waiver | corpus gate — every requirement id in the falsifiability table carries a row in `evidence… | `not-reviewed` |

## Other (assign during review) (40)

| RFC | Title | Status | Waiver | Evidence tier | Outcome |
| --- | --- | --- | --- | --- | --- |
| [0042](../RFCS/0042-experimental-capability-tier.md) | experimental capability tier | `Accepted` | bootstrap waiver | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0065](../RFCS/0065-workflow-node-primary-output-annotation.md) | workflow node primary output annotation | `Accepted` | bootstrap waiver | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0067](../RFCS/0067-provider-catalog-conventions.md) | provider catalog conventions | `Accepted` | bootstrap waiver | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0068](../RFCS/0068-memory-consolidation-and-standing-commitments.md) | memory consolidation and standing commitments | `Accepted` | bootstrap waiver | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0072](../RFCS/0072-agent-inventory-and-dispatch.md) | agent inventory and dispatch | `Accepted` | bootstrap waiver | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0078](../RFCS/0078-portable-tool-catalog-and-tool-session-contract.md) | portable tool catalog and tool session contract | `Accepted` | bootstrap waiver | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0080](../RFCS/0080-agent-memory-capability-reconciliation.md) | agent memory capability reconciliation | `Accepted` | bootstrap waiver | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0084](../RFCS/0084-budget-quota-and-cost-policy.md) | budget quota and cost policy | `Accepted` | bootstrap waiver | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0090](../RFCS/0090-agent-verifier-and-convergence.md) | agent verifier and convergence | `Accepted` | bootstrap waiver | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0091](../RFCS/0091-multimodal-perception-input.md) | multimodal perception input | `Accepted` | bootstrap waiver | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0092](../RFCS/0092-agent-capability-requirements.md) | agent capability requirements | `Accepted` | bootstrap waiver | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0094](../RFCS/0094-wire-shape-reconciliation.md) | wire shape reconciliation | `Accepted` | bootstrap waiver | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0101](../RFCS/0101-multi-party-group-conversation.md) | multi party group conversation | `Accepted` | bootstrap waiver | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0103](../RFCS/0103-localized-content-surface.md) | localized content surface | `Accepted` | bootstrap waiver | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0105](../RFCS/0105-speech-synthesis-adapter.md) | speech synthesis adapter | `Accepted` | bootstrap waiver | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0108](../RFCS/0108-self-hosted-openai-compatible-provider-class.md) | self hosted openai compatible provider class | `Accepted` | bootstrap waiver | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0109](../RFCS/0109-conversation-turn-model-provenance.md) | conversation turn model provenance | `Accepted` | bootstrap waiver | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0110](../RFCS/0110-channel-presence.md) | channel presence | `Accepted` | bootstrap waiver | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0124](../RFCS/0124-portable-per-run-parameter-deferral.md) | portable per run parameter deferral | `Accepted` | bootstrap waiver | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0147](../RFCS/0147-protocol-integrity-and-standards-readiness-program.md) | protocol integrity and standards readiness program | `Accepted` | bootstrap waiver | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0149](../RFCS/0149-machine-contract-and-version-reconciliation.md) | machine contract and version reconciliation | `Accepted` | bootstrap waiver | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0163](../RFCS/0163-subject-linking-hardening.md) | subject linking hardening | `Accepted` | bootstrap waiver | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0164](../RFCS/0164-mandatory-subject-linking.md) | mandatory subject linking | `Accepted` | bootstrap waiver | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0165](../RFCS/0165-v2-preparation-wire-shapes.md) | v2 preparation wire shapes | `Accepted` | bootstrap waiver | not declared (predates RFC 0174 §B.1, or not yet Accepted) | `not-reviewed` |
| [0167](../RFCS/0167-openwop-v2-umbrella.md) | OpenWOP v2 — the program RFC | `Accepted` | bootstrap waiver | tier-1 — steward-verified | `not-reviewed` |
| [0169](../RFCS/0169-v2-discovery-and-capabilities.md) | v2 discovery and capabilities | `Accepted` | bootstrap waiver | corpus gate — no host tier is claimed at the release candidate | `not-reviewed` |
| [0171](../RFCS/0171-v2-wire-envelope.md) | v2 wire envelope | `Accepted` | bootstrap waiver | tier-2 — steward-affiliated sibling host | `not-reviewed` |
| [0172](../RFCS/0172-v2-versioning-and-release.md) | v2 versioning and release | `Accepted` | bootstrap waiver | tier-2 — steward-affiliated sibling host | `not-reviewed` |
| [0173](../RFCS/0173-v2-security-defaults.md) | v2 security defaults | `Accepted` | bootstrap waiver | tier-1 — steward-verified**, partially corroborated tier-2 | `not-reviewed` |
| [0175](../RFCS/0175-v2-transports-and-embedded-protocols.md) | v2 transports and embedded protocols | `Accepted` | bootstrap waiver | tier-1 — steward-verified, single witness | `not-reviewed` |
| [0176](../RFCS/0176-v2-persisted-data-and-coexistence.md) | v2 persisted data and coexistence | `Accepted` | bootstrap waiver | tier-1 — steward-verified | `not-reviewed` |
| [0179](../RFCS/0179-root-preferred-version.md) | Root `preferredVersion` | `Accepted` | bootstrap waiver | tier-1 — steward-verified**, corroborated by a live tier-2 fetch | `not-reviewed` |
| [0181](../RFCS/0181-vendor-path-namespace.md) | Vendor path namespace | `Accepted` | bootstrap waiver | tier-2 — steward-affiliated sibling host** | `not-reviewed` |
| [0183](../RFCS/0183-interrupt-resolved-action-fidelity.md) | `interruptResolved` action fidelity | `Accepted` | bootstrap waiver | tier-1 — steward-verified** | `not-reviewed` |
| [0184](../RFCS/0184-bound-id-path-projection.md) | Bound-id path projection | `Accepted` | bootstrap waiver | tier-1 — steward-verified | `not-reviewed` |
| [0186](../RFCS/0186-payload-seats.md) | Three payload seats the hosts measured and the corpus lacked | `Accepted` | bootstrap waiver | tier-1 — steward-verified** | `not-reviewed` |
| [0189](../RFCS/0189-normative-home.md) | The normative-home gate given a contract: home classes, a content predicate, a non-punitive ratchet, and a de… | `Accepted` | bootstrap waiver | corpus gate — every requirement id in the falsifiability table carries a row in `evidence… | `not-reviewed` |
| [0191](../RFCS/0191-normative-home-marker.md) | The reciprocal normative-home marker, and why no regex over prose decides a semantic claim | `Accepted` | bootstrap waiver | corpus gate — every requirement id in the falsifiability table carries a row in `evidence… | `not-reviewed` |
| [0193](../RFCS/0193-envelope-catalog-seats.md) | A capability record is an object, so a v1 array needs a seat; the three envelope families whose payload the g… | `Accepted` | bootstrap waiver | corpus gate | `not-reviewed` |
| [0206](../RFCS/0206-locale-keys-accept-negotiated-bcp47.md) | locale keys accept the BCP 47 tags the host negotiates | `Accepted` | bootstrap waiver | corpus gate — no host tier is claimed | `not-reviewed` |

