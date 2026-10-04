# OpenWOP Spec — Changelog

What changed in each release of the OpenWOP spec corpus: the spec prose, the JSON Schemas, the OpenAPI and AsyncAPI documents, and the conformance suite. One short entry per release, written for someone implementing the protocol.

Versions are corpus versions; `@openwop/openwop-conformance` and `@openwop/spec-artifacts` publish at the same version. Evidence (certified bundles, witnesses) lives in [`evidence/`](./evidence/), and the reasoning behind a change lives in its RFC under [`RFCS/`](./RFCS/). The suite's own notes are in [`conformance/CHANGELOG.md`](./conformance/CHANGELOG.md).

Entries before this file was condensed carried full development detail. That text is in git history: `git show v2.45.7:CHANGELOG.md`.

## [Unreleased]

## [2.45.16] — 2026-10-04 — Witness waves 2 and 3: every core family has a major-2 witness

- **Witness wave 2:** 20 v2 scenarios for the ten v1-only families only MyndHyve serves at v2. Fix: `orchestrator-decision.schema.json` (v2) rejected every decision (a root `additionalProperties: false` with no root `properties`).
- **Witness wave 3:** the 11 families no host serves at v2 gain major-2 witnesses: an advertisement scenario each, `dataResidency` admission (422 `residency_unavailable`, no run) and the `conversationTurnModelProvenance` emission legs.
- **Two conversation schema fixes.** v2 `conversationOpened` had no `participants` seat, so a `multiPartyConversation` host could not emit a valid `conversation.opened`; the `ConversationTurn` mirror lacked `agent.model`, so a stamped turn failed. Both are strict widenings.

## [2.45.15] — 2026-10-04 — Witness wave 1: six v1-only families gain major-2 witnesses

- **Witness wave 1:** 21 v2 scenarios port the v1-only witnesses of `i18n`, `prompts`, `limits`, `envelopes`, `modelCapabilities` and `aiProviders` to major 2, so they stay witnessed now that hosts retire v1.
- **ROADMAP adds two gated candidates:** structured handoff context on `agent.handoff`, and a shared intent record. Both are prototyped first in openwop-app. It also tracks certification by a non-steward host. No spec change.

## [2.45.14] — 2026-10-04 — v1 end-of-support is 2026-10-04 (RFC 0234)

- **v1 end-of-support is 2026-10-04** (RFC 0234, Accepted). An accepted RFC may set it before the computed 2026-12-04 once counted hosts are certified at v2 and see no third-party v1 traffic. Hosts MAY now retire v1; retention floors are unchanged.
## [2.45.13] — 2026-10-04 — RFC 0230, 0232 and 0233 Accepted

- **RFC 0230, 0232 and 0233 are Accepted** (provisional; §B review owed). openwop-app's certified, seam-free major-2 production cut on 2.45.12 (build `983976bbc`) passes every acceptance row; the bundle is the canonical openwop-app v2 evidence.
## [2.45.12] — 2026-10-03 — Connection-provider conflicts are observable; RFC 0230's stale and secret-once legs; RFC 0233 Active

- **`v2-advertised-path-space-served` no longer fails a host that retired `/v1`:** a `410 Gone` under `/v1` reads as not served, and the leg is `inapplicable` without a `1.x` member.
- **RFC 0230 and 0232 tables name their requirement ids,** so the `Accepted` check reads bundle rows. RFC 0230's `409` row is `unwitnessable`: no surface makes a subscription non-active. RFC 0232 G6/G7 and RFC 0228 G7 close.
- **RFC 0233 is Active** (comment window waived by steward override). Optional reads `GET /connection-providers` and `GET /connection-providers/{providerId}` behind `connections.providerRead`; `v2-provider-conflict` reads them instead of a seam.
- **Two RFC 0230 rules gain a test at both majors:** a `webhook-timestamp` more than 300 s off is refused without starting a run (`0230.stale-timestamp-refused`), and a re-read never returns the signing secret (`0230.signing-secret-once`).
- **RFC 0233 filed (Draft).** Optional v2 reads of a host's connection-provider registry and its refused registrations, behind `connections.providerRead`, so the provider-identity MUSTs get the normative observation path `conformance.md` §Witness class requires.

## [2.45.11] — 2026-10-03 — The trigger bridge is witnessed at major 2; a retired vendor twin may forward reads

- **The trigger bridge is witnessed at major 2.** New scenarios `v2-trigger-bridge-delivery` and `v2-trigger-dead-letter-read` port the delivery legs and RFC 0232's read rules to the v2 surface, so a v2 bundle can witness RFC 0230 and RFC 0232.
- **A retired vendor twin may forward reads.** After retirement a `GET`/`HEAD` to `/v1/host/<org>/…` MAY answer a bodiless `308` to the same `/host/<org>/…` path; no operation is served there. RFC 0181's row now reads "serves an operation", not "answers" (maintainer decision 2026-10-03).

## [2.45.10] — 2026-10-03 — A trigger's dead letters are readable; RFC 0232 Active

- **RFC 0232 is Active.** A trigger subscription's dead-lettered deliveries are readable behind the optional `triggerBridge.deadLetter` facet: new operation `listTriggerDeadLetters` and schema `trigger-dead-letter-page`, v1 and v2; records are content-free. The window was waived by steward override of RFC 0147 §A.6.
- **Run-less trigger transitions are recorded.** For a dead-lettered attempt or a state change, "emit" now means the host keeps a content-free record. The prose and schemas no longer route trigger dead letters to the RFC 0053 run sink.
- **Leg 4 of `trigger-bridge-delivery` is two requirements.** The attempt leg gains a seam-free path through the read; the state-change leg is `inapplicable` without a seam. New scenario `trigger-dead-letter-read` holds the paging, cursor and tenant rules.
- **RFC 0232 was filed as Draft first.** An optional read, `GET /v1/trigger-subscriptions/{id}/dead-letters`, behind `triggerBridge.deadLetter`, so a production host without test seams can witness that its dead-lettered trigger deliveries carry no inbound content. RFC 0230 needs it to be accepted on production.

## [2.45.9] — 2026-10-02 — A trigger leg that observed nothing is inapplicable, not blocked

- **Stream and change ingest fix.** `trigger-stream-cdc-sources` records `inapplicable`, not `blocked`, on a host that serves neither `stream` nor `change`. The `blocked` row denied a major-1 bundle.

## [2.45.8] — 2026-10-02 — RFC 0229 Accepted; RFC 0230's signed ingest witnessable on a certified run; v2 table schema witness

- **RFC 0229 is Accepted.** MyndHyve passes all four `secrets` run-witness requirements on a certified production bundle (suite 2.45.5); the RFC states the deployment's two conformance flags and the byok fixture it still advertises.
- **RFC 0228 G1 is half witnessed.** The same bundle passes MyndHyve's `egress_denied` rows; its `503` backpressure half is still unwitnessed.
- **RFC 0230's signed ingest runs on hosts with seams.** `trigger-bridge-delivery` now runs every witness path a host offers. A host that serves both the delivery seams and `inboundSigning` can witness RFC 0230 on a certified bundle.
- **New `v2-table-schema-enforcement`.** Through the new fixture `conformance-table-schema-probe`, a mistyped `tableStorage` insert or update MUST fail `validation_error` with `details.service: tableStorage`; a host without the fixture records `inapplicable`.

## [2.45.7] — 2026-10-02 — Strict mode no longer fails a host that does not serve `workspace`; RFC 0231 Accepted

- **Workspace scenario fix.** `v2-workspace-scope-from-identity` records `inapplicable`, not `executed-fail`, on a strict-mode host that does not advertise `workspace` (#1854); on 2.45.3–2.45.6 opt out `family.workspace`.
- **RFC 0231 is Accepted.** The v2 reference host advertises `budget.onExhaustion: ["fail"]` and passes the refusal row on a certified bundle.
- **RFC 0228 certified row.** All five `httpClient.ssrf-*` requirements pass on the v2 reference host's certified bundle, with every refused target `egress_denied`; RFC 0228 stays Active.

## [2.45.6] — 2026-10-02 — RFC 0231: a host lists the budget exhaustion behaviours it serves

- **RFC 0231 is Active.** A host that advertises `budget` may list the `onExhaustion` values it serves in the optional facet `budget.onExhaustion`; the list contains `fail`, and absence means both are served.
- **Unlisted values are refused.** A create asking for an `onExhaustion` value the host does not list answers `422 capability_not_provided`; it is never applied as another behaviour or ignored.
- **New `v2-budget-exhaustion-facet`.** The major-2 scenario checks the advertised list and the refusal, and records `inapplicable` on a host that does not advertise the facet.
- **First host witness of the v2 ports.** The v2 reference host passes `v2-production-backpressure` and `v2-budget-enforcement` on a certified bundle; RFC 0228 gap G2 is closed.

## [2.45.5] — 2026-10-01 — An unclaimed prefix floor no longer blocks a major-1 bundle

- **Prefix floor fix.** The `openwop.floor.any.interrupt-` row is now written only for a host that claims `openwop-interrupts`, so an unclaimed profile no longer produces a `blocked` row (#1842).
- **Two v2 decisions recorded.** `memoryScopeIsolation` is not carried in v2, and a `core.subWorkflow` child's parent stays observable through `getRunAncestry` only.

## [2.45.4] — 2026-10-01 — Any-of floor fix; v2 backpressure and budget scenarios

- **Any-of floor fix.** The `openwop-secrets` any-of summary row is written only for a claimed profile; a major-1 host that cut a v3 bundle on 2.45.3 without claiming it should re-cut (#1839).
- **New `v2-production-backpressure`.** With an advertised `production.backpressure.inflightCap` saturated, the next request MUST answer `503 service_unavailable` with `Retry-After` and no `details.retryAfter*`.
- **New `v2-budget-enforcement`.** It runs the fixture `conformance-budget-tool-calls` under a two-call budget and reads the `budget.*` events and the hard stop; a host without the fixture records `inapplicable`.
- **Not ported from v1.** The `budget_model_denied` leg and the "discovery is exempt from the cap" leg have no v2 scenario.

## [2.45.3] — 2026-10-01 — RFC 0229 and RFC 0230 Active; v2 tenant-isolation witnesses

### RFCs and spec

- **RFC 0229 is Active.** A host advertising `secrets.runSecrets` takes `createRun.runSecrets` under the reserved `run:` ref and proves resolution through `core.secret.witness`, which outputs only `{ matched }`.
- **RFC 0230 is Active.** A host advertising `triggerBridge.ingestion.inboundSigning: ["standard-webhooks-1"]` accepts Standard-Webhooks-signed posts on `ingestUrl` and dedups on `webhook-id`.
- **Refused inbound events.** A refused inbound event dead-letters only its own delivery and no longer disables the subscription (`trigger-bridge.md` §F.2); RFC 0227 is Accepted.

### Conformance

- **Lost responses record `blocked`.** `driver.request` is bounded at 20 s, and a timeout or failed connection before the first assertion records `blocked` instead of `executed-fail` (#1829).
- **New scenarios.** Added `secrets-run-witness`, `v2-secrets-run-witness`, `trigger-refused-event-keeps-subscription`, `v2-eval-mode-unadvertised-refused` and eight v2 tenant-isolation and fail-closed witnesses for storage, fs, memory, workspace, queues, secrets, tools and safe fetch.

## [2.45.2] — 2026-09-30 — A run-failure code must be registered or a vendor code

- **`errors.event-code-registered` is required.** An unregistered code on `run.failed`, `node.failed` or the snapshot `error` now fails the row and is named; vendor codes still pass (#1698).
- **RFC 0226 is Accepted.** RFC 0171 gap G6 and RFC 0223 gap G9 are closed.

## [2.45.1] — 2026-09-29 — Run-list legs stop early; every scenario records a disposition

- **Run-list legs stop early.** They stop paging once they find the runs they created, instead of walking a host's whole run history (#1816).
- **Every test records a disposition.** No scenario file skips at `describe` level: an unadvertised capability records `inapplicable`, an unset operator opt-in `skipped`, and a withheld fixture `blocked` (#1818).

## [2.45.0] — 2026-09-29 — A host that grants an origin admits the contract's preflight headers

- **Cross-origin preflight rule.** A host that grants the requesting origin MUST admit the operation's method and every request header `api/v2/openapi.yaml` declares for it; `*` does not admit `Authorization` (`headers.md`).
- **Path manifest fields.** `spec/v2/path-manifest.json` now carries per-operation `requestHeaders`, `authenticated` and `requestBody`; the fields are additive.
- **New `v2-cors-preflight`.** It preflights every operation with `Origin: $OPENWOP_CORS_ORIGIN` and records `inapplicable` when the host grants that origin on no operation.

## [2.44.9] — 2026-09-29 — A floor gated on a withheld fixture records `blocked`

- **Withheld-fixture floors record `blocked`.** Nine v1 floor files that wrote no ledger row when their fixture was withheld now record `blocked`, so `--certify` no longer rejects the whole certification as unclassified (#1812).
- **Guard added.** `describe-level-skip.test.ts` fails when a v1 floor file can be skipped entirely at `describe` level.

## [2.44.8] — 2026-09-29 — Every subscribed event of a run is delivered

- **New leg `0173.webhook-delivery-complete`.** In `v2-webhook-durable-delivery`, every matching event must reach a healthy receiver at least once within the host's retry window; duplicates are permitted (#1810).

## [2.44.7] — 2026-09-29 — RFC 0223 G11 and RFC 0140 G10 closed

- **RFC 0223 gap G11 closed.** `0223.reject-loopback-reasks` is witnessed: a looped-back gate raises a new `interrupt.requested` under a new per-visit key.
- **RFC 0140 gap G10 closed.** `replay.suppression-execution-ordinal` is witnessed on a certified cut.
- **No scenario changes.** The release carries evidence and gap-register updates only, plus a v2 witness coverage report.

## [2.44.6] — 2026-09-29 — RFC 0228 and RFC 0227 Active; last core families homed in v2

- **RFC 0228 is Active.** Nine v1 host-service error codes are registered for v2, including `storage_limit_exceeded`, `egress_denied`, `upstream_unavailable`, `budget_exhausted` and `service_unavailable`.
- **RFC 0227 is Active.** The `errors.md` status table moves to the generated `spec/v2/generated/error-codes.md`, and `0171.error-registry-prose-parity` now reads that table.
- **Last families homed.** `agents`, `budget` and `production` get v2 normative homes under RFC 0189, with no rule added, dropped or changed in strength.
- **New `v2-unadvertised-operation-not-found`.** An unadvertised `/prompts` or `/content/settings` operation answers `404 not_found`, not v1's `501`.

## [2.44.5] — 2026-09-29 — A replay short-circuit raises no new interrupt request

- **Replay short-circuit clarified.** On replay, `ctx.interrupt(K)` MUST short-circuit to the persisted `interrupt.resolved` and raise no new `interrupt.requested` (`replay.md` §Determinism caveats rule 2).
- **Hold node outputs pinned.** The outputs of `core.conformance.hold` are exactly its resolved inputs, `delayMs` included, under the same keys.
- **Witness citation.** `0223.replay-derives-rejection` now cites `replay.md` rule 2 as its MUST.

## [2.44.4] — 2026-09-29 — More v2 homes, replay corrections and a pure hold node

- **More families homed.** `memory`, `prompts`, `aiProviders`, `limits` and `artifactTypes` get v2 normative homes under RFC 0189 with no change to any rule.
- **Interrupt type corrections.** Emitting the kind-specific `approval.*` / `clarification.*` types is a MAY, and an era-2 governance-shape `approval.granted` / `rejected` / `overridden` has no v2 projection.
- **Replay ordinal counts terminals.** The replay ordinal counts recorded terminals, not starts, because a pause or suspend re-emits `node.started` without a terminal (#1769).
- **New `0223.replay-derives-rejection`.** A `replay` fork of a rejected gate derives the recorded rejection and never re-decides it, for a reject and for a timeout.
- **Fixture fixes.** `core.conformance.hold` replaces `core.delay` in the replay fixtures, and `webhook-signed-delivery`'s tunnel control no longer fails conformant hosts.

## [2.44.3] — 2026-09-28 — Fifteen more families homed; webhook retry rows record their wait path

- **Fifteen families homed.** Fifteen more core families get v2 normative homes under RFC 0189 (#1784).
- **Retry rows record what they measured.** Each webhook retry row carries an informational `observed:` line naming the wait path, the window and the attempt timings (#1787).

## [2.44.2] — 2026-09-28 — `0215.no-head-of-line` no longer convicts a late fan-out

- **Late fan-out is unjudged.** `0215.no-head-of-line` records `blocked` when too few held attempts had arrived to judge, instead of failing; every real head-of-line case still fails (#1780).

## [2.44.1] — 2026-09-28 — Webhook retry legs outlast `maxElapsedMs`; four families homed

- **Retry leg timeouts fixed.** Test timeouts now cover the retry wait's ceiling, so a host advertising a long `retryPolicy.maxElapsedMs` no longer has its dead-letter rows killed (a 2.44.0 regression, #1774).
- **Four families homed.** `workspace`, `content`, `triggerBridge` and `uiPlugins` get v2 normative homes, and the new `spec/v2/core/storage.md` restates the v1 storage rules.

## [2.44.0] — 2026-09-28 — Three run-failure codes, an advertised webhook retry bound, RFC 0219 Accepted

- **RFC 0226 is Active.** `node_config_invalid` (422), `sandbox_invocation_error` (422) and `mcp_error` (502) are registered, and the meaning of `capability_not_provided` widens.
- **RFC 0225 is Active.** A webhook host may advertise `retryPolicy.maxElapsedMs` and MUST then dead-letter an exhausted delivery within that bound.
- **RFC 0219 is Accepted.** Clients announce their protocol version in `OpenWOP-Client-Version`, and a host serving browsers cross-origin must admit the header in its CORS preflight.
- **Retry window follows the bound.** The suite waits `maxElapsedMs` plus 30 s, and the dead-letter row convicts only past an advertised bound.

## [2.43.2] — 2026-09-28 — Three Class 3 corrections; failing hooks no longer hide tests

- **Failing hooks are reported.** A scenario whose own cleanup hook throws or times out now records `executed-fail` with the error, instead of a reasonless `blocked` row (#1753).
- **Replay outcome key.** The replay outcome key uses the execution ordinal, witnessed by the new `v2-replay-suppression-ordinal` and fixture `conformance-replay-ordinal-loop`.
- **Fork ancestry.** A fork has no ancestry parent and its lineage is `parentRunId`, witnessed by the new `v2-run-fork-ancestry`.
- **`approval.rejected` strength.** Emitting `approval.rejected` is a MAY, not a SHOULD.

## [2.43.1] — 2026-09-28 — Major-1 certification fixed; RFC 0223 rejects witnessed

- **Certification fix.** `--certify --bundle-version 3` now scrubs secrets before digesting and signing, so a bundle with a redacted secret verifies; the 2.43.0 verifier accepts the fixed bundles (#1739).
- **RFC 0223 witnesses.** Routed and timed-out approval rejects are witnessed, with new fixtures.
- **Class 3 corrections.** A timeout never grants an approval gate, an interrupt `key` is per visit, event error codes are registered or vendor codes, and pack isolation rows no longer gate on `packs`.
- **Schema validation.** The org-chart read pair's served bodies are validated against their schemas at both majors.

## [2.43.0] — 2026-09-28 — Approval reject, registry operations, audit anomaly shape, audit-log integrity

### Protocol

- **RFC 0223 is Active.** A rejected approval gate fails closed and the failure is routable, with the new error code `approval_rejected`.
- **RFC 0222 is Active.** A yanked registry version stays served but is never `latest` or matched by a range, and only an `active` key signs a new version.
- **Audit rules.** RFC 0224 adds the `auditLogIntegrity` family gating `/audit/verify`, and RFC 0218 §C requires each `anomalies[]` entry to carry a `kind`, with `chainValid` false exactly when anomalies exist.
- **RFC 0220 is Active.** Six extension families are `Stable`.

### Conformance

- **New scenarios.** Added `v2-approval-reject-disposition`, `v2-registry-lifecycle` and `audit-anomaly-shape`; `byok-roundtrip` records `blocked` without the BYOK fixture, costing a host only `openwop-secrets`.

## [2.42.9] — 2026-09-28 — A v2 delivery's `workspaceId` is checked

- **`workspaceId` on deliveries.** `v2-webhook-delivery-shape` checks that a v2 delivery carries `workspaceId` exactly when the run has a workspace, with no substituted value (#1682).
- **Mock-AI isolation.** Scenario files that share a mock-AI node now run one after another under a per-node lock.
- **Truncation budget legs.** The RFC 0033 §B truncation budget legs record the SHOULD instead of failing it.
- **CLI help.** The conformance CLI's `--help` states that `--bundle-version` defaults to 3.

## [2.42.8] — 2026-09-27 — RFC 0221, a closed audit schema, and a dispatch race fixed

- **RFC 0221.** A webhook secret the host generates is returned once, witnessed by the new `v2-webhook-generated-secret`.
- **RFC 0219 is Active.** A client announces its protocol version in `OpenWOP-Client-Version`; `v2-client-version-header` is new and `v2-min-client-version` is stricter.
- **Audit schema check.** `audit-log-integrity` checks the closed verify schema again, and RFC 0033 §C gains a per-attempt budget witness.
- **Race fixed.** `v2-id-grammar`'s events leg waits for an event instead of racing the host's dispatch (#1683).

## [2.42.7] — 2026-09-27 — Extension families can graduate on evidence

- **RFC 0220.** New `v2-ext-family-claims` and `v2-ext-rest-transport` record the `openwop.family.<key>` rows that the extension `Stable` predicate reads.
- **RFC 0218.** Audit checkpoints can be verified with `audit-checkpoint-vectors` and `audit-checkpoint-signature`.
- **Core-standard floor.** `v2-sse-last-event-id-cursor` joins the core-standard floor.

## [2.42.6] — 2026-09-27 — RFC 0176 §A's writer rule is witnessable again

- **New optional seam `appendEra2Event`.** `0176.era-2-append-vocabulary` appends a v2-named event to an era-2 run through the seam and fails a host that stores v2 names in an era-2 log (#1648).
- **Hosts without the seam.** A host that does not serve the seam keeps the 2.42.5 partial witness and is never `blocked`.

## [2.42.5] — 2026-09-27 — Hotfix: a host can certify again

- **Certification restored.** `0176.era-2-append-vocabulary` records a partial witness instead of `blocked`; suites 2.42.3 and 2.42.4 could not certify any host, so cut on 2.42.5.

## [2.42.4] — 2026-09-27 — Unfailable-leg audit, wave 2

- **Audit wave 2.** More legs that recorded a pass without observing their requirement now measure it or record `blocked`, so rows may move on a re-cut (#1645).
- **`Idempotency-Key` on the wire.** The RFC 0173 retry leg counts `Idempotency-Key` at a suite-owned receiver that fails the first attempt.
- **Spec over-claims corrected.** RFC 0006's CO-1 test file reference and an `auth-profiles.md` description of audit-log checks are corrected.

## [2.42.3] — 2026-09-27 — Unfailable-leg audit: 19 legs now measure their requirement

- **Unfailable-leg audit.** Nineteen legs that a non-conforming host could pass now measure their requirement or record `blocked`, so rows may move from pass to `blocked` or fail on a re-cut (#1641).
- **RFC 0217 gap G1 closed.** RFC 0173's §B replay-suppression row now cites `effect-seam-no-refire`.

## [2.42.2] — 2026-09-26 — Four conformance legs now measure what their spec says

- **Effect re-fire detected.** `0173.effect-seam-no-refire` now requires zero effect rows under the fork's run (#1636).
- **Retry keying.** The RFC 0173 retry leg accepts `activity-recipe` keying when the provider has no business key, with one keying and one provider key across attempts.
- **JSON value comparison.** RFC 0209 §C.11 compares JSON values, not JSON text, so a host storing surfaces as JSONB can pass.
- **New contract operation.** `DELETE /content/pages/{pageId}` joins the contract (#1634).

## [2.42.1] — 2026-09-26 — RFC 0111 live scenarios get scaled timeouts

- **Scaled timeouts.** `context-budget-transcript-bound` and `context-summarization-replay` get a per-test timeout that scales with `OPENWOP_POLL_TIMEOUT_SCALE` (#1625).
- **MCP run-transport leg.** `v2-mcp-mount-map`'s run-transport leg identifies its own run, so a concurrent `conformance-noop` run no longer fails it.

## [2.42.0] — 2026-09-26 — `replay_context_summary_unavailable` registered; RFC 0217 Active

- **New error code.** `replay_context_summary_unavailable` is registered, so the RFC 0111 fork refusal names its code (#1616).
- **RFC 0217 is Active.** After `unregisterWebhook` answers `204`, `GET /webhooks/{webhookId}/dead-letters` MUST answer `404 not_found`.
- **New requirement row.** `openwop.requirement.0217.dead-letter-read-after-unregister` is added to `v2-webhook-durable-delivery`, gated on `webhooks.deadLetter`.

## [2.41.1] — 2026-09-26 — SSE projection row reads a terminal run's stream

- **`v2-stream-sse-projection` fix.** The row reads a terminal run's stream, so a buffering public front no longer makes a conforming host record `blocked` (#1612).

## [2.41.0] — 2026-09-26 — RFC 0111's context-budget witness can fail; RFC 0121 un-parked

- **Context-budget witness.** The transcript-window seam serves `entries[] { eventId, rendered }` in test mode, and for `tokenCounter: "chars"` the suite recounts and requires the sum to equal `tokenCount` (#1606).
- **Live fixture.** The new live-model fixture `conformance-context-budget-live` gates both RFC 0111 scenarios, which now run at major 2.
- **RFC 0121 un-parked.** GitHub Copilot individual plans are the first cleared provider; the mechanism is the official-client subprocess shape, with no wire label.

## [2.40.3] — 2026-09-26 — Cookie-borne lanes can be revoke-witnessed; discovery digest fix

- **Cookie presentation.** `mintLaneCredential` may answer `presentation: { kind: "cookie", name }`, and `v2-revocation-honored` then sends the credential as a cookie; bearer stays the default (#1602).
- **Scrub fix.** A short `OPENWOP_*` setting whose name mentions a key or token is no longer scrubbed from the captured discovery document, which had corrupted `discovery.sha256`.
- **RFC status.** RFC 0215, 0197, 0205 and 0209 are Accepted.
- **Spec clarifications.** RFC 0199 §B.3(c) treats an `https` issuer's empty path as `/`, and RFC 0216 requires a companion to be signed with a dedicated published key.

## [2.40.2] — 2026-09-26 — Harness-issuer rows are `inapplicable`; colocated companions are marked

- **Harness OIDC issuer.** A lane whose `issuers[]` does not list the harness issuer records `0200.id-token-aud` and the four RFC 0210 exp-only rows as `inapplicable` instead of `blocked` (#1581).
- **RFC 0216 companions.** `--certify --as-colocated-companion` writes a signed `host.deployment: "colocated-companion"`, and a companion witnesses only the rows in `spec/v2/harness-trust-anchors.json`.
- **Bundle v3 member.** `host.deployment` is optional and enters the witness preimage only when present, so existing bundles digest unchanged.
- **RFC status.** RFC 0200 and RFC 0216 are Accepted, and `oauth.md` is aligned with RFC 0199.

## [2.40.1] — 2026-09-26 — Three declared-unwitnessable rows record why

- **Rows record their reason.** `0197.retired-not-emitted`, `0205.export-alias-equivalence` and `0209.render-needs-root` now have a leg that records why the requirement is not executable (#1582).

## [2.40.0] — 2026-09-26 — Webhook delivery isolation and unregister stops retries

- **RFC 0215 is Active.** An attempt to one subscription MUST NOT wait for an attempt to another, and after `unregisterWebhook` answers `204` no further attempt starts (`webhooks.md` §Durability).
- **New scenarios.** `v2-webhook-delivery-isolation` and `v2-webhook-unregister-stops-delivery` are added, gated on `webhooks`.
- **New invariants.** Protocol-tier invariants `webhook-delivery-isolation` and `webhook-unregister-stops-delivery` are added.

## [2.39.5] — 2026-09-26 — RFC 0213 §B has a deterministic witness

- **New leg `0213.in-flight-refused-under-hold`.** A seams-profile hold keeps a same-key create in flight, and the host's real create path must refuse the concurrent request `409 idempotency_in_flight` (#1572).
- **Public URL verification.** `OPENWOP_HOST_PUBLIC_URL` now verifies a host whose advertised URLs follow the request origin.
- **Seams contract.** The RFC 0170 credential mint and revoke seams are in the seams contract.

## [2.39.4] — 2026-09-25 — RFC 0199 can be witnessed behind a public front

- **`OPENWOP_HOST_PUBLIC_URL`.** The setting declares the host's own https front so RFC 0199's credential legs can run there; it is inert when unset (#1567).
- **Pinned ports under `--certify`.** `--certify` refuses pinned fixture ports unless `--max-workers 1`, and `v2-webhook-durable-delivery` is sized to the advertised `retryPolicy.maxAttempts`.
- **Listener fixes.** The shared pinned-port listener no longer races on startup, and the synthetic OIDC issuer binds the port the operator names.

## [2.39.3] — 2026-09-25 — A pinned receiver port is shared; tenant B is tenant B

- **Shared receiver port.** Receivers on a pinned `OPENWOP_WEBHOOK_RECEIVER_PORT` share one listener, which fixes hung `v2-a2a-push-delivery` legs on public cuts (#1559).
- **Credential selection.** The driver sends the credential a scenario chose, so tenant-B legs run as tenant B (#1557).

## [2.39.2] — 2026-09-25 — `0208.a2a-unreadable-not-found` records its own row

- **Row restored.** `0208.a2a-unreadable-not-found` now has its own `it()`, so its row appears in bundles (#1555).

## [2.39.1] — 2026-09-25 — RFC 0214 delivery legs survive a tunnel; anonymous lane fix

- **RFC 0214 delivery legs.** Timeouts in `v2-a2a-push-delivery` scale with a public front, and `0214.a2a-push-delivery-authenticated` records its own row (#1552).
- **Anonymous lane.** `v2-lane-issuer-advertised` no longer requires `revocation` on the anonymous lane (#1553).

## [2.39.0] — 2026-09-24 — A2A push is measured at a suite-owned receiver

- **New `v2-a2a-push-delivery`.** For a host advertising `a2a.pushNotifications`, it checks SSRF refusal, config isolation, secrets never returned, authenticated delivery with no `OpenWOP-Signature`, no redirects, discard on delete and no push from a fork.
- **Push-config legs.** `v2-a2a-operation-map` gains three push-config legs under RFC 0214.

## [2.38.0] — 2026-09-24 — RFC 0212 and RFC 0214; six rows a conforming host can now pass

- **RFC 0212.** Canonical JSON is RFC 8785 JCS over I-JSON, so the certification preimage no longer depends on the machine that computed it.
- **RFC 0214.** An A2A push credential is a destination credential, and a push is an egress like any webhook.
- **Anonymous lane schema.** The `anonymous` auth lane may omit `revocation`, as `identity.md` §2.2 required; no previously valid document changes (#1540).
- **Public front paths.** A public front that carries a path now reaches its fixtures, fixing four webhook rows that failed on public cuts (#1536).
- **Rows that can now execute.** `0206.delivery-extended-locale` and `v2-a2ui-v09-surface` can now execute.

## [2.37.1] — 2026-09-24 — Clearer failure records; per-run identities

- **RFC 0213 §B.** `v2-idempotency-in-flight` records a partial witness, not `blocked`, when every same-key create succeeds, which §B permits (#1525).
- **Failure detail.** An `executed-fail` row now names the failing cases and the first failure's message (#1526).
- **Per-run identities.** Webhook and trigger-bridge scenarios mint destinations and dedup keys per run, so a second run on one host no longer measures the first run's state.

## [2.37.0] — 2026-09-23 — RFC 0211 and RFC 0213 Active; rows that measured nothing now measure

### Added

- **RFC 0211 is Active.** An A2A error's details are an `ErrorInfo`, and an A2A interface never answers in the OpenWOP envelope; new scenario `v2-a2a-client-error-details`.
- **RFC 0213 is Active.** `Last-Event-ID` is an exclusive cursor, the loser of a same-key race gets `idempotency_in_flight`, and a resolve after the run ended has one outcome per state.
- **New RFC 0213 scenarios.** Added `v2-sse-last-event-id-cursor`, `v2-idempotency-in-flight` and `v2-interrupt-resolve-terminal`.

### Changed

- **Conformance legs fixed.** Scenario-owned fakes are reachable through a public front, `0158.duplicate-delivery` is deterministic, and the new `0208.mcp-mrtr-input-request-key` fails a host that keys `inputRequests` by node id.
- **v1 contract and status.** `POST /v1/webhooks/{webhookId}/rotate-secret` is in `api/openapi.yaml`, and RFC 0203 is Accepted.

## [2.36.0] — 2026-09-23 — MCP and A2A alignment, OAuth, and the v2 retirement rule

### Added

- **OAuth resource and client.** A host advertising an `oauth2`/`oidc` lane serves RFC 9728 Protected Resource Metadata and `WWW-Authenticate` challenges, and the new `oauth.md` homes `oauth` and `credentials` (RFC 0199, RFC 0200).
- **MCP and A2A surfaces.** RFCs 0198 and 0202–0208 add MCP Tasks mapping, the `mcp.client` facet, v2 homes for `toolCatalog` and `nodePackRuntimes`, `a2a.agentCards`, `part`/`artifact` schemas, `interop-map.json` and trace-context carriers.
- **Webhooks, UI and locales.** Standard Webhooks 1.0.0 is an opt-in scheme via `signatureAlgorithms` (RFC 0201), `ui.a2ui-surface` is A2UI v0.9 (RFC 0209), and locale keys accept `zh-Hans`, `es-419` and `fil` (RFC 0206).
- **`exp-only` revocation rule.** RFC 0210 is `Active`: a host advertising `exp-only` refuses a credential whose lifetime exceeds `revocationWindowSeconds` or that lacks `iat`, with `credential_lifetime_exceeded` (401).

### Changed

- **Retirement, not reshaping.** RFC 0197 forbids reshaping a v2 surface in a 2.x minor, admits removal only under six predicates, and caps a host's `status` at the corpus declaration.
- **A2A error table re-pinned.** The `a2a-1.0` table follows A2A 1.0.1: six gRPC/HTTP statuses move, and clients accept either table and never identify an error by status alone.
- **RFC status moves.** RFCs 0197–0209 are `Active` and implemented, and RFCs 0194, 0195 and 0196 are `Accepted` (provisional).
- **Suite 2.36.0.** The suite adds 39 scenarios covering these RFCs, and `@openwop/spec-artifacts` moves in lockstep at the same exact pin.

## [2.35.0] — 2026-09-21 — One terminal event, guarded callbacks, signed bundle declarations

- **RFCs 0194–0196 Active.** RFCs 0194, 0195 and 0196 are `Active` by steward override of the comment window.
- **One terminal event.** A run emits one terminal event with no forward execution after it, and a fork point after it is refused `422 fork_point_invalid` (scenario `v2-terminal-event-once`).
- **Callback delivery guarded.** A host advertising `interrupt.callbackDelivery` holds `callbackUrl` to the webhook egress guard at create and at delivery (scenario `v2-callback-url-guarded`).
- **IPv4-mapped IPv6.** An IPv4-mapped IPv6 address is judged by the IPv4 it embeds, and the webhook egress refusal row now tests the hex form.
- **Bundle v3 rules.** At major 2 an unobserved requirement records `blocked`, `witnessSha256` covers `host.relaxations[]`, and a verifier derives opt-outs from signed `skipped` rows.

## [2.34.0] — 2026-09-21 — Bundle fields for RFC 0158's rung and recovery bounds

- **Recovery evidence in the bundle.** A requirement row gains an optional `evidence` object and the bundle root an optional `durability { rung }`, which the verifier re-derives and rejects as `rung-not-derivable`.
- **v2 normative home.** RFC 0158 §A–§D is restated in `persistence.md` §"Durable acceptance and recovery" and `conformance.md` §"Recovery evidence", with no new obligation.
- **Compatibility.** The change is additive: existing bundles verify unchanged, and an older verifier fails closed on a bundle carrying the new fields.

## [2.33.0] — 2026-09-21 — Relaxations now deny certification; egress guard witnessed

- **Egress refusal witnessed.** New scenario `v2-webhook-egress-refusal` witnesses `webhooks.md` §SSRF at major 2 and denies every profile built on `webhooks` when the guard is open and undeclared.
- **Declared relaxations bind.** A declared relaxation now denies its owning profile, with ownership read from `predicate.families` in `spec/v2/profiles.json`.
- **Public fronts for fakes.** The `a2a` and `mcp` fakes take a validated public front, so a host advertising them can be cut without relaxing its egress guard.
- **Expected effect.** A loopback cut is expected to lose certification on this suite, and a host cut through public fronts is unaffected.

## [2.32.0] — 2026-09-20 — Pack manifest schemas fixed; durability rows corrected; signing-key leak closed

- **Pack `signing` block.** Seven v2 bare-manifest schemas now carry the closed `{ keyId, scheme }` block, and `signing` stays optional on a bare manifest (#1367).
- **`FragmentNode.config` reopened.** A v2 chain node can carry host-validated config again, matching `WorkflowNode.config`.
- **`v2-durability-recovery` corrected.** Kill rows observe until the host's declared recovery bound, `kill-during-execution` asserts resumption, and `duplicate-delivery` counts arrivals at a suite-owned receiver.
- **Event-log read path.** The scenario reads the run log from `/events/poll` at major 2, so `poison-exhaustion` no longer soft-skips its main clause.
- **Signing key leak.** `openwop-conformance --certify` no longer passes `OPENWOP_BUNDLE_SIGNING_KEY` to its child process; operators who listed processes during a certify on an earlier suite should rotate the key.

## [2.31.0] — 2026-09-19 — `poison-exhaustion` at major 2 and a shared projection helper

- **`poison-exhaustion` ported.** `durability/poison-exhaustion` now runs at major 2 as a black-box row needing no seam, completing the `durable-single-instance` rung.
- **Projection helper.** `src/lib/v2-projection.ts` centralises the v1→v2 capability projection, stripping the retired `supported` flag at every depth and reporting payloads it cannot splice.

## [2.30.0] — 2026-09-19 — Open-risk count is now a real ratchet

- **Risk baseline enforced.** `check-registers` now compares the open risk count against a recorded `openRisks` baseline, so the count cannot rise without a deliberate change.

## [2.29.0] — 2026-09-19 — Corrected document and family counts

- **Core document count.** README and `docs/IMPLEMENT-CORE.md` now state that `spec/v2/core/` holds twenty-two documents.
- **Core family count.** The `capabilities.md` §5 heading now matches the 72 core rows in `spec/v2/declaration.json`.
- **Counts gated.** New coherence test `v2-front-door-counts.test.ts` holds both counts against the tree.
- **QUICKSTART labels.** Two `apps/workflow-engine/` labels in `QUICKSTART.md` now name the `openwop-app` repo they link to.

## [2.28.0] — 2026-09-19 — Bundle ledger array named; `aiProviders` facets closed again

- **Bundle ledger named.** `certification-bundle.schema.json` states that `results.requirements[]` is the ledger and `detail.nonPass[]` is a derived view that may omit fields.
- **`aiProviders` facets closed.** `aiProviders.input` and `aiProviders.policies` are closed at major 2 again, restoring the `modalities` enum and `{modes, scopes, errorCode}`; no published document is rejected.

## [2.27.1] — 2026-09-19 — Two RFC 0121 register rows corrected

- **Tripwire target.** RFC 0121's G1 row now names the `Active (Parked) → Accepted` flip as its gating condition.
- **False defect struck.** RFC 0121's G6 row is struck, because `credential_scope_forbidden` is registered in `spec/v2/errors.json` at `403`.
- **RFC status unchanged.** RFC 0121 stays `Active (Parked)` and RFC 0111 stays parked.

## [2.27.0] — 2026-09-19 — Four RFC 0158 recovery scenarios

- **Recovery rows added.** `v2-durability-recovery.test.ts` adds `kill-after-accept`, `kill-during-execution`, `duplicate-delivery` and `bound-is-derived` for the `durable-single-instance` rung.
- **Disposition rule.** A host with no durability seam route records `inapplicable`, and a host with the seam but an unmet precondition records `blocked` with the precondition named.
- **`peer-resume` omitted.** No `peer-resume` scenario is written, because it belongs to `durable-multi-instance` and is bundle-witnessed.
- **Known gap.** `durability/poison-exhaustion` is registered at major 1 only, so the rung cannot yet be witnessed at major 2.

## [2.26.0] — 2026-09-19 — RFC 0188 Accepted

- **RFC 0188 Accepted.** RFC 0188 moves `Active → Accepted` on tier-1 evidence from the reference host, which advertises `webhooks.deadLetter` and serves the §A read.
- **Conforming read shape.** The reference host's `GET /webhooks/{webhookId}/dead-letters` now returns the closed `{deliveries, nextCursor}` page with tenant check before lookup and a subscription-bound cursor.
- **Content-free records.** A dead-letter record no longer carries the subscriber's response text in `lastError`, as §B.1 requires.
- **Dead-letter leg passes.** `0173.webhook-durable-delivery.dead-letter` records a full `executed-pass` for the first time.

## [2.25.0] — 2026-09-19 — Dead-letter content-free leg fixed

- **Leg now asserts.** `openwop.requirement.0188.dead-letter-content-free` exhausts a real delivery before reading the sink, where it previously read an empty sink and recorded `blocked`.
- **Empty sink reported.** An empty dead-letter sink now records `blocked` with a reason.
- **Attempt filtering.** The leg filters receiver attempts by subscription as well as run, so a shared tunnelled receiver does not mix scenarios.

## [2.24.0] — 2026-09-19 — Named seats for three envelope families (RFC 0193)

- **Payload seats restored.** `supportedEnvelopes`, `schemaVersions` and `envelopeStrictness` carry their value at major 2 in optional seats `kinds`, `kinds` and `mode`.
- **Catalog fails closed.** `events.md` §"The envelope-kind catalog" requires an engine to refuse every non-universal kind when `kinds` is absent.
- **Error codes registered.** `unknown_envelope_kind` and `unknown_schema_version` are registered in `spec/v2/errors.json` (422, `retriable: false`).
- **`schemaVersions` grammar.** `versioning.md` axis 6 now defines the grammar by `propertyNames` over the kind grammar, which admits namespaced vendor kinds.
- **RFC 0193 Accepted.** RFC 0193 is `Accepted`, and the generator refuses any family whose v1 payload it cannot splice.

## [2.23.0] — 2026-09-19 — Every core family has a declared normative home

- **No undeclared families.** All 72 core families carry a declared normative home, 26 resolved in v2 and 46 v1-dependent, satisfying the RFC 0189 §D terminal predicate.
- **`host-services.md` added.** New `spec/v2/core/host-services.md` states the v2 contract for `aiEnvelope`, `promptLibrary` and `agentRuntime`.
- **`conversation.md` added.** New `spec/v2/core/conversation.md` homes `multiPartyConversation`, `channelPresence` and `conversationTurnModelProvenance`.
- **Facet prose added.** `replay.md` gains §"Declared nondeterminism" for `nondeterminismPolicy`, and `events.md` gains prose for `envelopes.tierOneSubsetCompliance`, `feedback.targets` and `providerUsage.costEstimates`.
- **Compatibility.** The change is additive: the new prose states obligations that already bind an advertising host.

## [2.22.0] — 2026-09-19 — `envelopeContracts` re-homed in v2; home gate tightened

- **`envelopeContracts` resolved in v2.** `events.md` §"Envelope contracts" states the per-node permission-set refusal, which stacks with the capability-gated `typeId` refusal.
- **Gate tightened.** The normative-home gate no longer accepts an obligation from an adjacent bullet or a conformance-seam catalog as a family's home.
- **Compatibility.** No wire artifact, schema, endpoint contract or error meaning changes.

## [2.21.0] — 2026-09-19 — Nine more families declared v1-dependent

- **Nine families declared.** `secrets`, `modelCapabilities`, `envelopeContracts`, `artifactTypes`, `uiPlugins`, `memory`, `aiProviders`, `agents` and `production` declare v1 normative homes.
- **Gate tightened.** The normative-home gate no longer accepts a fenced code block as an obligation or a self-declared informative document as a home.
- **`envelopes` left undeclared.** `envelopes` stays undeclared, because its only prose site is the informative `structured-output-subset.md`.
- **Compatibility.** No wire artifact, schema, endpoint contract or error meaning changes.

## [2.20.0] — 2026-09-19 — RFCs 0189–0192 Accepted

- **Four RFCs Accepted.** RFCs 0189, 0190, 0191 and 0192 are `Accepted`.
- **Corpus witnesses added.** Eleven requirement ids named by those RFCs now exist as coherence tests in `v2-normative-home-gate.test.ts` and `v2-facet-advertisement.test.ts`.
- **`persisted`, not `permanent`.** `security-defaults.md` now says `persisted`, matching `certification-bundle.schema.json`; a host emitting `permanent` was rejected and produced no bundle.
- **Acceptance criteria added.** RFCs 0190, 0191 and 0192 each gain an `## Acceptance criteria` section.

## [2.19.0] — 2026-09-19 — Twelve host-service families declared v1-dependent

- **Twelve families declared.** `fs`, `kvStorage`, `tableStorage`, `nosql`, `vectorStore`, `searchIndex`, `blobStorage`, `cache`, `sql`, `deadLetter`, `queueBus` and `scheduling` declare v1 normative homes.
- **Section headings count.** The normative-home gate now counts an obligation inside a section titled for the family, such as `## §host.kvStorage`.
- **Compatibility.** No wire artifact, schema, endpoint contract or error meaning changes.

## [2.18.0] — 2026-09-19 — Fourteen families declared v1-dependent; burn-down aligned

- **Fourteen families declared.** `selfHostedRunner`, `purposePropagation`, `anonymousActor`, `credentials`, `subWorkflow`, `httpClient`, `triggerBridge`, `supportedEnvelopes`, `envelopeStrictness`, `content`, `budget`, `i18n`, `portability` and `workspace` declare v1 normative homes.
- **Burn-down aligned.** The normative-home burn-down now measures `undeclared + uncarried`, the expression RFC 0189 §D makes fatal at end-of-support.
- **Compatibility.** No wire artifact, schema, endpoint contract or error meaning changes.

## [2.17.0] — 2026-09-19 — `runs.md` field name fixed; two families homed

- **`aiProviders.providers`.** `runs.md` now requires `provider` to be in `aiProviders.providers`, replacing a reference to the nonexistent `aiProviders.supported`.
- **Two families homed.** `conversationPrimitive` and `dataResidency` declare homes in `runs.md`, carrying forward the `core.conversationGate` refusal contract and the honor-or-reject rule with `residency_unavailable`.
- **Clock workflow split.** The normative-home clock runs in its own CI workflow, separate from the unpublished-suite-tag alarm.
- **Compatibility.** No wire artifact, schema, endpoint contract or error meaning changes.

## [2.16.0] — 2026-09-19 — RFC 0192: a facet is advertised by its key

- **Facet presence rule.** RFC 0192 states that a facet is advertised by the presence of its key, except where the facet's schema defines a meaning for absence (e.g. `memory.writable`).
- **Facet descriptions rewritten.** The 26 facet descriptions that conditioned a MUST on the retired `supported: true` flag now state their obligation under presence semantics.
- **Two conditionals restored.** `memory.compaction` now requires `trigger` and `memory.injectionBudget` requires `tokenCounter`, as unconditional `required` fields.
- **Generator guard.** `generate-from-declaration.mjs` now fails when it would emit a description that gates on `supported`.

## [2.15.1] — 2026-09-19 — Restored schema guards the v2 generator had deleted

- **Write-egress guard restored.** `schemas/capabilities.schema.json` again requires a non-empty `writeEgressControls` when the `bounded-write-egress` tier is advertised, and refuses it otherwise (RFC 0132 §B.2).
- **Other conditionals restored.** Conditionals that do not gate on `supported` are kept, including `fs` requiring `sandboxRoot` and `aiProviders` `realtimeVoice.synthesis` requiring `speechSynthesis`.
- **Required fields restored.** `limits`, `envelopeContracts`, `connections`, `dataResidency`, `anonymousActor`, `nondeterminismPolicy` and `content` regain their own `required` lists.
- **Compatibility.** This is a safety-fix that tightens validation; no wire shape, endpoint contract or error meaning changes.

## [2.15.0] — 2026-09-19 — Three families recorded as v1-dependent; two gate fixes

- **Families recorded as v1-dependent.** `oauth`, `heartbeat` and `limits` now declare their normative text in `spec/v1/`, where their rules already exist.
- **End-of-support fallback.** The RFC 0189 §D check now compares each carried v1 document's `Status:` banner with the value recorded at declaration time.
- **Facet matching.** Facet coverage now recognises the `Capabilities.<family>.<facet>` spelling used in v1 prose.
- **Compatibility.** Editorial and gate only; no new RFC 2119 keyword and no wire change.

## [2.14.0] — 2026-09-19 — Three more families declare v2 homes

- **New normative homes.** `sandbox` and `compensation` are homed in `security-defaults.md`, and `authorization` in `identity.md`.
- **Family-key matching tightened.** A family key is no longer matched inside a longer token joined by `-`, `_`, `.` or `/`, such as `fs-gated` or `token_budget_exceeded`.
- **`a2a` home prose.** `interop.md` now names the `a2a` family in the paragraph that obligates it.
- **Compatibility.** Editorial and gate only; no wire artifact, schema shape or MUST strength changes.

## [2.13.0] — 2026-09-18 — Four families declare v2 homes

- **New normative homes.** `a2a` and `mcp` are homed in `interop.md`, `auth` in `identity.md`, and `runList` in `runs.md` §List.
- **Families recorded as v1-dependent.** `multiAgent` points at `spec/v1/multi-agent-execution.md` and `schemaVersions` at `spec/v1/capabilities.md`.
- **Table rows checked separately.** The normative-home gate now treats each markdown table row as its own unit when matching a family to an obligation.
- **RFC 0189 acceptance criterion.** The criterion now requires that `facetsUncovered` has not risen, replacing "strictly below its filing value".

## [2.12.0] — 2026-09-18 — RFC 0191: normative-home marker; pack peer-dependency rule corrected

- **Normative-home marker.** RFC 0191 requires a declared `spec/v2/**` home to carry a `> **Normative home:** \`key\`.` line under its Status banner; nine core documents carry it.
- **Peer-dependency rule corrected.** `packs.md` §"Peer-dependency identifiers" no longer states that a `peerDependencies` key is a root key of `spec/v2/declaration.json`, and restores the overlap-alias clause.
- **Engine range truth condition.** `packs.md` §"The engine range" now states what admitting a major asserts: schema validity for the manifest's `kind`, resolvable `peerDependencies` keys and a signature, each keeping its own refusal code.
- **Peer-dependency evidence.** `evidence/cross-repo-manifests.json` now inventories the v2 registry tree as well as v1, raising the key set from 28 to 44.
- **Compatibility.** Additive; no published manifest becomes inadmissible.

## [2.11.0] — 2026-09-18 — RFC 0190: core word budget re-based

- **Budget scope.** RFC 0190 supersedes RFC 0174 §E.2/§E.2a: the budget measures `spec/v2/core/**` recursively plus any `spec/v2/ext/**` document a core family cites.
- **Budget cap.** The cap is now `25,000 + 200 × (resolved homes − 9)` words.
- **Ext documents as co-pointers.** A `spec/v2/ext/` document can add facet coverage for a core family but cannot be its sole normative home.
- **End-of-support fallback applied.** After v1 end-of-support the gate fails for a carried v1 target only when it is deleted or its `Status:` banner changes.
- **Compatibility.** Editorial and gate only; no wire change.

## [2.10.0] — 2026-09-18 — `packs` capability text added; two test-seam facets deprecated

- **`packs` capability section.** `spec/v2/core/packs.md` gains §"The `packs` capability", the family's advertisement contract, and `packs` declares it as its home.
- **Facets deprecated.** `capabilities.packs.testMode` and `capabilities.observability.testSeams` are deprecated with `removeIn: "3.0"`; they stay valid in 2.x because hosts emit them.
- **Deprecation row narrowed.** `openwop.deprecation.seam-operations-in-canonical-api` now covers only the path operations; the two facets have their own rows.
- **OpenAPI tags cleaned.** `api/v2/openapi.yaml` drops the orphaned `packs-test` tag and other unused tags, and tag casing is aligned to lowercase.

## [2.9.2] — 2026-09-18 — `mcp-2026-07-28-discover` tool-list assertion fixed

- **Scenario fixed.** `mcp-2026-07-28-discover` now expects all three tools the suite's fake MCP server returns, including `needs_input_loop`, so a host that proxies it faithfully passes.

## [2.9.1] — 2026-09-18 — RFC 0189 gap register added

- **Gap register.** `RFCS/registers/0189-normative-home.gaps.md` records three carried gaps: loose family-key matching, the uncounted `spec/v2/ext/` budget, and the burn-down counting v1-carried families.

## [2.9.0] — 2026-09-18 — v2 text for `eventLog`, `idempotency` and `forms`

- **`eventLog` family.** `persistence.md` §"The `eventLog` family" states what the record advertises: the era stamp, the poll cursor and the closed event-type set.
- **Cross-engine ordering.** `replay.md` §"Cross-engine ordering" carries the `eventLog.crossEngineOrdering` facet, previously written only in v1 (RFC 0036).
- **Multi-region facets.** `idempotency.md` §"Multi-region" separates `crossRegion` (deployment posture) from `multiRegion` (behavioural claim); a client MUST NOT infer the second from the first.
- **Form pack string trust.** `form-content-packs.md` §"Instantiation" requires a pack-authored string to propagate `meta.contentTrust: "untrusted"` into an interpolated prompt segment.
- **Compatibility.** Additive; each section carries forward a contract that already bound a conforming host.

## [2.8.3] — 2026-09-18 — `credential_scope_forbidden` registered in the v2 error registry

- **Error code registered.** `credential_scope_forbidden` is added to `spec/v2/errors.json` at status 403, so a host obeying `capabilities.md` §B.8 emits a schema-valid envelope.
- **Error table generated.** The code counts and status table in `spec/v2/core/errors.md` are now derived from the registry by `scripts/generate-error-envelope.mjs` and checked for drift.

## [2.8.2] — 2026-09-18 — Two `workflowChainPacks` facets removed

- **`deferredParameters` removed.** `workflowChainPacks.deferredParameters` is removed from the declaration and the v2 capabilities schema, because v2.0 does not define per-run parameter deferral.
- **`hostExpansionSeam` removed.** `workflowChainPacks.hostExpansionSeam` is removed, because v2 forbids test-seam flags in the capability namespace.
- **Facet set pinned.** `spec/v2/facets/workflowChainPacks.schema.json` now fixes the family's v2 facet list.
- **Normative home.** `workflowChainPacks` declares `spec/v2/core/workflow-chain-packs.md` as its home.
- **Compatibility.** Safety-fix; no v2 host bundle advertises either removed facet.

## [2.8.1] — 2026-09-18 — Extension pages reformatted for reading

- **Extension index.** The status table in `spec/v2/ext/README.md` is now three subsections, `Draft`, `Stable` and `Retired`, with each rule written as prose.
- **Extension READMEs.** All seventeen extension pages are re-wrapped; no status, witness class or RFC 2119 word changed.

## [2.8.0] — 2026-09-18 — RFC 0189: the normative-home gate gets a contract

- **RFC 0189.** Each v2 capability family declares its normative home in `normativeText`; a home must name the family and carry an RFC 2119 obligation in a paragraph that names it.
- **Deadline enforced.** The allowed count of unhomed families now decays linearly to zero at v1 end-of-support and is checked daily on `main`.
- **v1 fallback.** At end-of-support, `spec/v1/**` documents that a v2 family still points at remain operative for the families listed in `v1Carried`.
- **Facet coverage tracked.** `facetsUncovered` counts facets written only in `spec/v1/`, and may only fall.
- **First homes declared.** `webhooks`, `replay`, `interrupt` and `connections` declare v2 homes.

## [2.7.1] — 2026-09-18 — All open gap rows closed

- **Gap rows disposed.** The last eleven `open` gap rows, on RFC 0111 and RFC 0121, are closed, ruled on, or re-labelled.
- **RFC 0121 dispositions.** G1 is `externally-gated:provider-tos-clearance`, and G5 is transferred to `docs/KNOWN-LIMITS.md`.
- **Open-gap baseline.** `docs/witness-baseline.json` records `openGaps: 0`, and `check-registers.mjs` fails on a new open row.
- **`webhooks` stub corrected.** `spec/v2/core/capabilities.md` §webhooks now names RFC 0188 as owner and lists the family's three facets.
- **Known gap.** `credential_scope_forbidden` is missing from `spec/v2/errors.json` (fixed in 2.8.3).

## [2.7.0] — 2026-09-18 — RFC 0188: the webhook dead-letter read

- **Dead-letter endpoint.** RFC 0188 adds `GET /webhooks/{webhookId}/dead-letters`, gated on the new `webhooks.deadLetter` facet and paginated like `listRuns`.
- **`deliveryId` on the wire.** The response carries the `deliveryId` kind, and `v2-bound-id-kinds` now asserts its bound grammar and tenant segment.
- **Two sinks separated.** `webhooks.deadLetter` is the delivery sink; the RFC 0053 `deadLetter` family remains the run sink, and RFC 0188 now owns the `webhooks` family.
- **No payload in records.** The new protocol-tier invariant `dead-letter-read-carries-no-payload` holds: the response schema is closed and carries no delivered body.
- **`expiresAt` field.** Each dead-letter record carries `expiresAt`, so a reader can compare it against the advertised `retentionDays`.

## [2.6.1] — 2026-09-18 — Remaining `deliveryId`/`causationId` claim removed

- **Second schema corrected.** `run-event-payloads.schema.json` `triggerDeliveryAttempted.runId` no longer claims that `run.started` carries the delivery's id as `causationId`.
- **Seat pointer corrected.** `trigger-event.schema.json` no longer points at `webhooks.md` for the causing-delivery pointer; the seat belongs on the durable event-log payload, in a trigger-ingestion document not yet written.

## [2.6.0] — 2026-09-18 — Relaxed bundles no longer certify; RFC 0167 bound to evidence

- **Relaxations deny certification.** The bundle emitter now folds recorded relaxations into `certified`, so a bundle that relaxes an obligation no longer certifies that profile (RFC 0173 §A.2).
- **Durability value corrected.** `security-defaults.md` now names the durability value `persisted`, matching the schema enum; the table previously said `permanent`.
- **RFC 0167 requirement ids.** RFC 0167's falsifiability table now cites five corpus requirement ids; RFC 0174 §B.1 admits cross-RFC requirement-id citations.
- **Version stamps removed.** The per-document version stamp is removed from all `spec/v2/core/*.md` banners; `spec/v2/release.json` is the single release identity.
- **New operator docs.** `docs/runbooks/KEY-ROTATION.md` is added, `OPENWOP_HOST_RELAXATIONS` and `OPENWOP_TARGET_MAJOR` are documented, and the quickstarts and README reading order are labelled as v1.

## [2.5.0] — 2026-09-18 — `--verify` audits a bundle offline

- **Bundle verification command.** `openwop-conformance --verify <bundle> [--host-key <pem>]` audits a certification bundle without a host or a corpus clone.
- **Exit codes.** `0` is verified, `1` rejected, `2` coherent but not independently verified, and `3` not a bundle.
- **Falsifiability ids.** RFCs 0179, 0181 and 0182 now cite requirement ids, and the acceptance gate reads the falsifiability section only from its real heading.
- **Supersession checks.** A `Superseded` RFC must carry a `Superseded by` pointer that names the RFC superseding it.
- **v2 banner rule.** A `Stable` `spec/v2/**` document must cite only `Accepted` RFCs in its `Status:` banner.

## [2.4.7] — 2026-09-18 — Unsatisfiable `deliveryId` equality removed; schema examples validated

- **Equality claim removed.** `trigger-event.schema.json` no longer states that `deliveryId` equals the `causationId` on `run.started`; the two id grammars cannot match.
- **Schema examples fixed.** Thirteen invalid `examples` across six v2 schemas are re-minted, and `scripts/check-v2-schemas.mjs` now validates every root-level example against its schema.

## [2.4.6] — 2026-09-18 — Third-party onboarding path fixes

- **Onboarding fixes.** Covers the npm front door, `INTEROP-MATRIX.md` §"Add A Host", the pre-registration gate, the signing-key recipe, dead v1 profile names and the RFC 0180 §A.2 pointer.

## [2.4.5] — 2026-09-18 — `--require-behavior` now takes effect

- **Strict-mode flag.** `--require-behavior` now enables strict mode; previously only `OPENWOP_REQUIRE_BEHAVIOR=true` did, and the flag was ignored.
- **Unknown flags rejected.** An unknown `--flag` passed to the CLI is now a hard error.
- **Partial witnesses marked.** A leg that asserts and then soft-skips is recorded as `partial-witness:` per `it`, and no longer counts as acceptance evidence for an RFC.
- **`v2-bound-id-kinds` receiver URL.** The scenario now honours `OPENWOP_WEBHOOK_RECEIVER_URL` when registering its webhook.
- **`v2-webhook-delivery-shape` port.** The scenario now honours `OPENWOP_WEBHOOK_RECEIVER_PORT`; the major-2 webhook lane needs `--max-workers 1`.

## [2.4.4] — 2026-09-18 — RFC 0173 Accepted; RFC 0035 Superseded

- **RFC status moves.** RFC 0173 is Accepted and RFC 0035 is Superseded by it, the first `Superseded` RFC in the corpus.
- **v1 citations retained.** The seven `node-pack-sandbox-*` invariants and four `sandbox_*` error codes keep RFC 0035 as their v1 citation through the overlap to 2026-12-04.

## [2.4.3] — 2026-09-18 — Corpus ledger no longer reports clean files as `blocked`

- **Ledger dispositions fixed.** Two `spec-corpus-validity` legs now assert unconditionally, so a clean file records `executed-pass` in the corpus ledger where it recorded `blocked`.
- **No host impact.** These rows are excluded from the published package and never appear in a host bundle.

## [2.4.2] — 2026-09-18 — Five holes closed in the `Active → Accepted` gate

- **Acceptance predicate tightened.** `check-accepted-predicate.mjs` now requires a declared `Evidence tier:`, a labelled `reason:` or `deferred:` for an unticked box, a witnessed or verdict-declared falsifiability row, and certified bundles only.
- **Parent flips last.** A program umbrella RFC can move to `Accepted` only after every child RFC is `Accepted`.
- **Pack-isolation seam witnessable.** `openwop.requirement.0173.pack-isolation.seam` now has its own `it` in `v2-pack-isolation`, so it appears in `requirements.json` and a bundle can carry its row.
- **RFC 0184 falsifiability section.** RFC 0184 gains a `### Falsifiability` section naming `openwop.requirement.0184.bound-id-path-projection`.

## [2.4.1] — 2026-09-18 — `v2-chain-pin-exact` now reads the host's rule

- **New third leg.** `v2-chain-pin-exact` publishes a chain whose external `subChainRef` carries `version: "^1.0.0"`, which no schema refuses, so the host's exact-pin enforcement is what the leg measures.
- **RFC 0177 evidence floor.** The `chain-pin-exact` row reads as host-enforced only for bundles cut on suite 2.4.1 or later.
- **Runbook rules.** The runbook now says to preflight every opt-in fixture by the field the scenario reads, and to wait on workers instead of the wrapper.

## [2.4.0] — 2026-09-18 — RFC 0187: four bindings hosts reported missing

- **RFC 0187 is Active.** `webhookId` is the `subscriptionId` kind, an unmapped `type` passes through on the v1 read of an era-`3` log, and approver eligibility binds every writer of the suspension record.
- **Unseatable properties marked.** A writer that emits a property a closed def cannot seat MUST mark the row, so the refusal names the writer.
- **New scenario `v2-bound-id-kinds`.** One leg per tenant-bound kind with a wire surface; the `deliveryId` leg records `inapplicable` because no dead-letter read is served.
- **Schema additions.** The `typeId` kind admits an exact `@<major>.<minor>.<patch>` pin on references, and `FormField.when` carries the `EdgeCondition` object; bare `webhookId` is deprecated in `spec/v1/deprecations.json`.
- **Suite fixes.** `v2-webhook-durable-delivery` filters attempts by `webhookId`, `McpFakeServer` gains `needs_input_loop`, and `v2-negotiation-authenticated` reads `details.runId` from the error envelope.

## [2.3.5] — 2026-09-17 — Editorial pass over the v1 and v2 spec prose

- **Edit history removed.** Status banners, errata narration and dated parentheticals are removed from `spec/v1/` and `spec/v2/`; no normative requirement changed.
- **Requirements restated in place.** Rules previously stated only inside narration are now direct normative prose, notably in `versioning.md` §1.2, §1.4, §5 and `security-defaults.md` §Threat models.
- **New entry points.** `spec/v1/README.md` is added and `spec/v2/README.md` is rewritten to the same shape; v2 ext documents gain a "Contract boundary" section.
- **Stale claims corrected.** v1 banners no longer cite outdated RFC statuses, `grpc-transport.md` keeps its "REST + SSE remains the REQUIRED wire surface" sentence, and README artifact versions match the registries.
- **Reference host evidence re-cut.** The reference host bundle is re-cut on suite `2.3.3` with all three claimed profiles certified and the RFC 0184 `~`-projection served.

## [2.3.4] — 2026-09-17 — Gap register rows dispositioned with evidence

- **36 gap rows dispositioned.** Each `closed` row names what resolved it; three are `externally-gated:non-steward-host` and two are `transferred:ROADMAP.md#implementation-ecosystem`.
- **Acceptance boxes ticked.** RFC 0180's seven acceptance boxes and RFC 0167's §G.1 box are ticked with the section or check that proves each.
- **Reason for the cut.** `spec/v1/gaps.json` ships inside `@openwop/spec-artifacts`, so regenerating it required a new version.

## [2.3.3] — 2026-09-17 — Path-projection leg fixed for single-major hosts

- **Double-projection leg.** `v2-bound-id-path-projection` now expects `404` on a dual-stack host and `400 validation_error` on a single-major host, read from `protocolVersions`.
- **Dead-letter rule in core.** `webhooks.md` §Durability now states that a `payload_unprojectable` delivery is dead-lettered on the first attempt and never retried.
- **Acceptance predicate roll-up.** A requirement is witnessed when it or any `<id>.<leg>` under it passes, a missing host-tier witness fails the gate, and a sibling requirement cannot satisfy it.
- **Governance rule restored.** `GOVERNANCE.md` §"Acceptance evidence tiers" regains its "Deployed, not merged" rule.

## [2.3.2] — 2026-09-17 — Webhook delivery-shape scenario reads the right field

- **Scenario corrected.** `v2-webhook-delivery-shape` now subscribes to `run.started`, validates against `webhook-delivery.schema.json` and the per-major `runStarted` definition, and reads `payload.owner`.
- **Inapplicable legs.** A host with no 1.x webhook surface, or one that does not fan out seeded history, records the matching leg `inapplicable`.
- **New error code.** `payload_unprojectable` (500, not retriable) is registered in `spec/v2/errors.json` for a row whose payload the host can neither carry nor seat.
- **`clarificationRequested` removed.** RFC 0185 §E records `clarificationRequested` as a deletion, since neither production host emits it.
- **Lockfile repaired.** `conformance/package-lock.json` no longer carries a mismatched `why-is-node-running` version.

## [2.3.1] — 2026-09-17 — Webhook body validation, ext status rule, deprecation triggers

- **New scenario `v2-webhook-delivery-shape`.** Three legs check that a major-2 subscriber receives the v2 payload, a major-1 subscriber still receives `principal`, and an era-2 seeded run delivers projected.
- **Ext status rule.** `spec/v2/ext/README.md` defines `Draft`, `Stable` and `Retired` as predicates over evidence; `Stable` requires an `executed-pass` family row in a certified bundle.
- **Deprecation triggers.** 37 rows in `spec/v1/deprecations.json` with `removeIn: 2.0` now carry `removalTrigger: v2.0-cut`, and four `proposed` rows move to `deprecated`.
- **`action: 'timeout'` is record-only.** A host MUST NOT accept `timeout` on a resume request; the host's own timer mints it (RFC 0183).

## [2.3.0] — 2026-09-17 — RFC 0186: three payload seats added

- **One `conversation.exchanged` def.** The bound def is now the union `{conversationId, turnIndex, turn?, outcome?}` and `ConversationExchangedPayload` is an alias of it.
- **`reason` field.** `interruptResolved` and `nodeSuspended` gain a string `reason` recording what triggered a resolution without a human, such as `timeout` or `condition`.
- **`ApprovalData.onTimeout`.** `ApprovalData` gains `onTimeout` with values `reject | approve | escalate`.
- **New scenario.** `v2-payload-seats-0186` is added and runs without a server.
- **RFC status.** RFC 0183 and RFC 0184 are Accepted on tier-1 evidence; RFC 0174 §E.2a records that rationale lives in schema descriptions outside the core word budget.

## [2.2.3] — 2026-09-16 — RFC 0185: vendor hatch on closed v2 payload defs

- **Vendor hatch added.** 53 run-event payload defs stay `additionalProperties: false` and now carry keys matching `^(openwop-|x-|vendor\.)` opaquely (RFC 0185 §B).
- **No silent drops.** `events.md` §Era-2 states that a projection MUST NOT silently drop a property; it carries the property or fails.
- **Known contradiction recorded.** RFC 0185 §D records that `conversation.exchanged` has two closed, contradictory defs; the binding is unchanged in this release.

## [2.2.2] — 2026-09-16 — RFC 0183 and 0184 Active; registry wording and id fixes

- **RFC 0184 is Active.** A tenant-bound id travels as one `~`-escaped path segment, applied exactly once; a host MUST accept and emit it and MUST still accept `tenant%2Fopaque`.
- **RFC 0183 is Active.** `interruptResolved` gains optional `action`, `refineFeedback` and `editedArtifactData`, `decision` becomes a closed enum, and `interrupt-approval` gains refine and `edit-accept` legs.
- **Id grammar fixes.** Five tenant-bound id patterns now admit the `anon:` tenant prefix, the `typeId` row in `identity.md` §5 matches its schema, and `interrupt.md` offers `'edit-accept'` instead of `'edit'`.
- **Prose and status.** `packs.md` says the v1 registry tree is frozen and deliberately behind, `events.md` §SSE names `ai.message.chunk` as a frame name, RFC 0182 is Accepted, and RFC 0180 §A.4a is withdrawn.
- **Suite and tooling.** Nine mock-AI fixtures have unique node ids (re-register them), the suite calls the host's mock reset seam per file, and family entries gain optional `normativeText`.

## [2.1.6] — 2026-09-13 — Compensation probe fixed for hosts with v1 retired

- **Unknown-run probe.** `v2-compensation-read-projection` now forms a tenant-bound unknown id from a run it creates, so it answers `404` on both overlap and v1-retired hosts.

## [2.1.5] — 2026-09-12 — `engineVersion` erratum in the v1 spec

- **Erratum.** `spec/v1/version-negotiation.md` now states `engineVersion` is `integer` at the discovery root, `number` on the run snapshot and `string` on the event log.
- **Deprecation row corrected.** The `engine-version-type-split` `surface` in `spec/v1/deprecations.json` carries the same correction, which is why `@openwop/spec-artifacts` was re-cut.

## [2.1.4] — 2026-09-12 — Replay scenarios report why a run failed

- **Self-describing failures.** `replay-observable-sequence-determinism` and `replay-divergence-at-refusal` now report `currentNodeId` and `error.{code,message,nodeId,retriable}` when a run does not reach `completed`.
- **Poll timeout scaling.** Both scenarios now honour `OPENWOP_POLL_TIMEOUT_SCALE` and print the bound and scale used on timeout.

## [2.1.3] — 2026-09-11 — What `since` means in a capability record

- **`since` is the host's version.** The generated `since` description in `schemas/v2/capabilities.schema.json` states it is the minor of the host's own contract at which it began serving the family.

## [2.1.2] — 2026-09-11 — Version-header leg fixed for single-major hosts

- **Leg branches on advertisement.** On a host with no `1.x` member, `v2-version-header-honored` now probes an unserved major and expects `406 protocol_version_unsupported` with `details.protocolVersions[]`.
- **Retirement runbook.** `docs/runbooks/V2-HOST-MIGRATION.md` gains "Phase 6 — Retirement, rehearsed", which names 2.1.2 as the pin floor for a retired cut.

## [2.1.1] — 2026-09-11 — `v2-run-list` is now selected under `--target-major 2`

- **Scenario registry regenerated.** `conformance/scenario-majors.json` now includes `v2-run-list`, which suite 2.1.0 shipped and never ran; RFC 0182 stays `Active`.
- **Gate added.** `openwop-check.sh` now fails when a scenario file has no row in the scenario registry.

## [2.1.0] — 2026-09-11 — RFC 0182: a portable run list

- **RFC 0182 is Active.** `GET /runs` returns `{ runs: RunSnapshot[], nextCursor? }`, tenant-scoped and newest first, gated on the new core family `runList` with facets `maxPageSize` and `filters`.
- **Refusals.** A cursor the host did not mint is `400 validation_error`, and the operation answers `404 not_found` when `runList` is unadvertised.
- **New scenario `v2-run-list`.** Three legs cover listing the caller's runs, the page-size limit, foreign-cursor refusal and the `workflowId` filter.
- **RFC 0181 is Accepted.** RFC 0181 moves to `Accepted` on tier-2 evidence, with no spec, schema or suite change.
- **Packaging.** 2.1.0 carries the untagged suite 2.0.13 off-process webhook-receiver fix (#1312).

## [2.0.12] — 2026-09-10 — RFC 0181: host-proprietary paths live at `/host/<org>/…`

- **RFC 0181 is Active.** A host MAY serve operations outside the manifest at `/host/<org>/…` for a registered org, advertised under `extensions.<org>.<name>`; `/v2/host/…` is rejected.
- **Orgs registered.** `spec/v2/declaration.json` registers `openwop-app` and `myndhyve`, and `reservedOrgs` gains the manifest segments under `/host/` (`effect-seams`, `events`).
- **`versioning.md` scoped.** §5 records the decision, and the §1.4 non-protocol-response constraints now apply only to manifest-named paths.

## [2.0.11] — 2026-09-10 — Certification emitter no longer redacts the published key id

- **Key id redaction fixed.** `--certify` on suites 2.0.8–2.0.10 redacted `keyId` from `discovery.document` when `OPENWOP_BUNDLE_SIGNING_KEY_ID` was set by environment, so the bundle failed self-verification; names ending in `_ID` are now excluded.
- **Rejected bundle is kept.** On a self-verification failure the emitter writes the rejected bundle to `<out>.rejected.json`, marked as not a certification artifact.
- **Conformance-only release.** No spec, schema or scenario-logic change; the pinned `@openwop/spec-artifacts` peer moves with the suite version.

## [2.0.10] — 2026-09-10 — Errata: bare ids through the overlap, cross-origin facets

- **Bare id admitted through the overlap.** `identity.md` §5 admits the bare (v1) id form on a major-2 path parameter, resolved under the caller's tenant and returned in bound form.
- **Bare id refused after the overlap.** A host advertising no `1.x` member MUST refuse the bare form with `400 validation_error`; the bound form `tenant%2Fopaque` MUST be accepted.
- **`prompts.renderEndpoint` default corrected.** `schemas/v2/capabilities.schema.json` now gives the major-2 default as `/prompts:render` in place of `/v1/prompts:render`.
- **Cross-origin facet URLs.** `capabilities.md` § a2a / § mcp state that a facet MAY name a URL on another origin, and that certification is per origin.
- **New `v2-id-grammar` leg.** A fourth leg sends a just-created run id with its tenant segment stripped and requires the overlap or post-overlap answer, chosen from live discovery.

## [2.0.9] — 2026-09-10 — Corpus states v2 as released; two versioning MUSTs narrowed

- **Corpus marked as v2.** The READMEs, `CHANGELOG.md`, `INTEROP-MATRIX.md` and the twenty `spec/v2/core/*.md` documents now state the released major; the core documents are `Status: Stable · v2.0.9`.
- **Path-space MUST narrowed.** `versioning.md` §1.2 now binds only operations named in the path manifest, so seam paths and host-proprietary paths are outside it.
- **`OpenWOP-Version` scope narrowed.** `versioning.md` §1.4 requires the header on every protocol response; a non-protocol response on a shared name MUST NOT carry it and MUST NOT be `application/json`.
- **Retirement rules recorded.** `versioning.md` §5 states that v1 retirement is atomic and records host-proprietary paths under major 2 as an open gap.
- **Client migration section.** `docs/migration/v1-to-v2.md` gains a client section, including that `OpenWOP-Version` is MAY on a request and MUST on a response.

## [2.0.8] — 2026-09-07 — Verifier derives major-2 profile claims from the v2 catalog

- **Major-2 bundles now verify.** The verifier answered profile claims from the v1 catalog and refused every correct major-2 bundle with `profile-not-derivable`; it now shares the emitter's predicate.
- **Suite-only fix.** No wire shape, field, error code, `MUST` or prose change, and no host change is needed.

## [2.0.7] — 2026-09-06 — RFC 0180 vendor-org registration; soft-skip reason rule

- **RFC 0180 added.** It defines how a vendor org is registered in `spec/v2/declaration.json` `extensions`: the corpus is the sole registrar and a shipped entry is append-only.
- **Registration timing.** A registration takes effect on the `@openwop/spec-artifacts` release that carries it.
- **Short org form chosen.** RFC 0169 §Unresolved-1 is closed in favour of the short org form, so a type's org is its first dot-separated segment.
- **Soft-skip reason rule.** `conformance.md` §"Whose fact is the reason?" requires a soft-skip reason to name a fact about the host; a suite-side precondition MUST record `blocked`.
- **False coverage claim removed.** `persistence.md` §"The seat" no longer says `v2-v1-events-translated` catches a wrapper-only adapter; both `MUST`s stand, and `vendorControlGate` records `blocked` for an unresolvable registry.

## [2.0.6] — 2026-09-06 — `v2-unmapped-type-refused` runs again on published installs

- **Corpus resolver fixed.** In a published install the vendor-org registry lookup returned nothing and the codemap fell back to 7 rows instead of 118; both now resolve from the `@openwop/spec-artifacts` peer.
- **Refusal leg ungated.** The refusal leg of `v2-unmapped-type-refused` no longer requires a resolvable registry, so a host that accepts an unregistered type now fails instead of recording `inapplicable`.
- **Install check reads the corpus.** `verify-installable` now reads the corpus through the installed resolver before reporting success.

## [2.0.5] — 2026-09-06 — Vendor-org registry added; several unverifiable rules made checkable

- **`extensions` registry added.** `spec/v2/declaration.json` gains a required `extensions` key holding the reserved org `example`; `persistence.md` now cites RFC 0171 §A.1 for the reserved-prefix rule.
- **Vendor pass-through control.** `openwop.requirement.0176.vendor-type-passthrough` requires a host to pass through a registered vendor type, alongside the refusal in `v2-unmapped-type-refused`.
- **Fork prefix comparison widened.** `v2-run-fork-prefix` now compares `type`, `nodeId` and `payload`, excluding `eventId`, `runId`, `timestamp` and `causationId`.
- **Bundle carries discovery.** A v3 bundle may include `discovery.document`, from which the verifier re-derives the digest and every certified profile; absence is reported as `derivabilityChecked: false`.
- **Packaging and ids.** `@openwop/spec-artifacts` now ships the `spec/v2/` prose, requirement ids declared through a constant resolve to their explicit id, and `memory-attribution-replay-stable` is `majors: [1, 2]`.

## [2.0.4] — 2026-09-06 — `v2-provider-conflict` uses a fictional provider fixture

- **New fixture.** `v2-provider-conflict` now drives `connection-pack-acme-widgets`, so its qualified-form leg is reachable on a host that ships a built-in `github`.
- **v1 scenario unchanged.** `connection-provider-resolution` keeps the `github` fixture, because v1 settles a built-in collision by version precedence.

## [2.0.3] — 2026-09-06 — Effect-seam target selection and webhook retry window corrected

- **Effect-seam selector fixed.** `v2-effect-seam-no-refire` now selects every `guarded: true` seam as a target, regardless of `branchReFires`.
- **At-least-once leg records `blocked`.** The at-least-once leg of `v2-webhook-durable-delivery` records `blocked`, because `retryPolicy` carries no base interval from which to derive the wait.
- **Detection lost.** A host that retries within its budget and never delivers is no longer caught; a host that never retries, or exceeds an advertised `maxAttempts`, still fails.

## [2.0.2] — 2026-09-06 — Webhook retry legs get a timeout that covers their wait

- **Test timeout raised.** Both legs of `v2-webhook-durable-delivery` now take their timeout from the retry-wait cap, so the 90 s wait introduced in 2.0.1 can elapse.
- **Dead-letter regression fixed.** The `dead-letter` leg, which timed out at 30 s on 2.0.1, can again reach its retry observation.

## [2.0.1] — 2026-09-05 — Webhook durability scenario reads the v2 carrier and widens its wait

- **Retry policy carrier.** `v2-webhook-durable-delivery` now reads `webhooks.retryPolicy` first and falls back to `triggerBridge.retryPolicy` through the overlap.
- **Retry wait derived.** The retry wait derives from the advertised policy: 20 s when nothing is advertised, up to a 90 s cap for `fixed` or `exponential` backoff.
- **Known asymmetry.** The `attempts.length <= maxAttempts` assertion is unchanged, so a host that advertises a larger budget than it honours still passes.

## [2.0.0] — 2026-09-05 — OpenWOP v2

OpenWOP v2 is the second major version of the protocol: closed wire shapes, header-based version negotiation, tenant-bound identity and a signed certification bundle, published as `@openwop/openwop-conformance@2.0.0` and `@openwop/spec-artifacts@2.0.0`.

### What changed for implementers

- **Version negotiation.** A host advertises `protocolVersions[]` and root `preferredVersion`, serves v2 on unversioned paths, and answers `OpenWOP-Version` by serving that major or refusing with `406 protocol_version_unsupported`.
- **Discovery document.** `/.well-known/openwop` is one header-selected resource with a closed root and one capability record type, carrying a standard `ETag` and the bundle-signing `signingKeys[]`.
- **Identity and owner.** `owner.subject` is the required owner record, and every id is tenant-bound as `<tenantId>/<opaque>` per `ids.schema.json`, with a foreign tenant segment refused as `403 id_tenant_mismatch`.
- **Event log.** Event `type` is a closed enum plus a vendor pattern, every payload is closed, 36 types are renamed through `spec/v2/event-codemap.json`, and `run.completed` MUST carry `outputs`.
- **Polling and streaming.** The poll cursor is `afterSequence` with omission meaning from the first event (sequence 0), and one events channel refuses an unsupported `streamMode` with `400 unsupported_stream_mode`.
- **Error envelope and registry.** Errors use the closed registry `spec/v2/errors.json` and the envelope `{ error: <code>, message, details? }` with `details` at the root, including `run_terminal`, `run_state_conflict`, `payload_too_large` and `unsupported_media_type`.
- **Headers and idempotency.** Every protocol header uses the `OpenWOP-*` family, and `Idempotency-Key` has a grammar with a 128-bit floor.
- **Interrupts and pause.** Interrupt tokens carry the `ow2.<alg>.<kid>` grammar, the legacy interrupt payloads unify into `interruptRequested`/`interruptResolved`, and pause uses `drainPolicy` values `immediate | drain-current-node`.
- **Replay and fork.** A fork inherits events with `sequence < fromSeq` and re-executes the rest, replay `modes` is `replay | branch`, and side-effect suppression is an obligation declared through `GET /host/effect-seams`.
- **Webhooks.** The delivery body is bound by `schemas/v2/webhook-delivery.schema.json` as `{ runId, workspaceId, event }` with a tenant-bound `runId`, and `workspaceId` is present exactly when `owner.workspace` is.
- **Profiles and certification.** `--certify` emits an Ed25519-signed bundle v3 for `openwop-discovery-core`, `openwop-core-standard` and `openwop-conformance-seams-v2`, and a profile certifies only with a witnessed floor pass and zero `blocked` rows.
- **Removed or retired.** v2 drops the `capabilities` wrapper, the `host.*` dotted mirror, `Capabilities-Etag`, `owner.principal`, `supportedTransports`, the legacy A2A/MCP profiles and bundle v1, and moves gRPC to `ext/`.

### Migrating from v1

- **Overlap period.** A host serves both majors through the overlap with `/v1/…` unchanged, v1 support runs to at least 2026-12-04, and the last 1.x packages stay installable for 12 months from the `v2.0.0` tag.
- **Existing runs.** A v2 host stamps `eventLogSchemaVersion` `3` on every new run, reads an older log through the event codemap, and names a v1-minted run by its tenant-bound id under major 2.
- **Migration register and codemods.** `spec/v1/migrations.json` and `spec/v1/deprecations.json` list each change with its replacement, and `codemods/` holds the codemods, including `openwop.codemod.discovery-document-v2` and `event-type-codemap`.
- **Migration guide.** `docs/migration/v1-to-v2.md` is the v1→v2 guide and `docs/runbooks/V2-HOST-MIGRATION.md` is the host runbook; run the suite with `--target-major 1|2` and install both packages at one explicit version.

## 1.x releases (2026-05-08 to 2026-08-25)

v1 is the previous major. One line per release, newest first.

- **1.10.0** (2026-08-25). No new RFCs; adds a published-suite identity check to `openwop:check`, a run-end summary of unwitnessed scenarios, split `a2a-push-egress-ssrf` legs, and a shared `:fork` availability rule.
- **1.9.0** (2026-08-23). No new RFCs; retires the RFC 0147 §A.1 capability freeze, gates the waiver ledger, adds `docs/IMPLEMENT-CORE.md` and `docs/EVIDENCE-DISCIPLINE.md`, and witnesses replay fan-out suppression (`replay-fanout-no-refire`).
- **1.8.0** (2026-08-18). No new RFCs; completes RFC 0151 compensation prose, makes host-initiated fan-out an external effect in `replay.md`, names `idempotency_key_mismatch` as canonical, and adds claim acquisition to `storage-adapters.md`.
- **1.7.0** (2026-08-16). RFCs 0146–0157 Accepted: requirement ledger and certification bundle v2, compensation profile, versioned A2A 1.0 and MCP 2026-07-28 composition, workload identity, and the `openwop-discovery-core` profile.
- **1.6.0** (2026-08-11). RFCs 0136, 0138 and 0142–0145 Accepted: `WorkflowVariable.format`, pack vendor-extension hatch, `store`-gated `artifact.created`, monotone tool-result trust, five declared capability families, and the `registrationSource` facet.
- **1.5.0** (2026-08-08). RFCs 0043, 0132–0135, 0137 and 0139–0141 Accepted: anonymous-actor authorization, sub-chains, `form-content` packs, extension opacity, `replay.sideEffectSuppression`, and legacy artifact-type identifiers; 0138 and 0142 Active.
- **1.4.0** (2026-07-07). RFC 0131 Accepted: optional `AgentManifest.role` (`"skill" | "assistant"`) and the schema-enforced Skill profile, with the `agent-skill-profile-stateless` invariant.
- **1.3.0** (2026-07-07). Eleven RFCs Accepted, including 0122–0129: stream and CDC triggers, `permittedPurposes`, `dataResidency` admission, deferred chain parameters, per-item dispatch, `selfHostedRunner`, and `provider.vendor` grouping; RFC 0121 Active.
- **1.2.0** (2026-06-30). RFCs 0109, 0110, 0112, 0113, 0115, 0118 and 0120 Accepted: turn model provenance, `channel.presence`, compact tool view, memory injection budget, run `ETag`, parallel fan-out, and `provider.apiHosts`.
- **1.1.9** (2026-06-24). RFCs 0100–0106 and 0108 Accepted: `ui.a2ui-surface`, localized content, approver routing, speech synthesis, real-time voice, durable A2A tasks, multi-party conversation, and self-hosted providers; RFC 0107 Active.
- **1.1.8** (2026-06-14). Repository split leaves `@openwop/openwop-conformance` as the only artifact published here; RFCs 0089–0099 Accepted, covering certification bundles, connection packs, trigger ingestion, and protocol hardening; RFC 0100 Active.
- **1.1.7** (2026-06-02). Agent-platform program (RFC 0085 and its component RFCs) and most of the Active backlog Accepted, including the Core Standard Profile (RFC 0088); Python and Go SDKs reach parity.
- **1.1.5** (2026-05-28). First `@openwop/cli` release; RFCs 0070, 0071 and 0074 Accepted (agent-manifest runtime, artifact-type and chat card packs, tenant-scoped inventory); RFC 0073 moves capability families to the discovery document root.
- **1.1.4** (2026-05-26). RFCs 0045–0049 and 0051–0053 Accepted on a non-steward host (connector packs, credentials, OAuth, identity, RBAC, approvals, scheduling, dead-letter), plus 0040 and 0041; autonomous-agent-runtime RFCs 0058–0064 filed.
- **1.1.3** (2026-05-23). First non-steward host adoption; RFCs 0027, 0034, 0037 Phase 1, 0039 Half A and 0044 Accepted; `replay.divergedAtRefusal` wiring and the Phase 4 behavioral harness added; RFCs 0042 and 0043 filed.
- **1.1.2** (2026-05-21). `ai-envelope.md` reaches FINAL v1.1; envelope-hardening RFCs 0030–0033 and RFCs 0013–0024 and 0026 Accepted; prompt-library RFCs 0027–0029 Active; multi-agent RFCs 0035–0041 filed.
- **1.1.1** (2026-05-15). RFCs 0001, 0008 and 0012 Accepted, adding the `capabilities.memory.compaction` profile and `memory.compacted` event; adds `OPENWOP_OPTED_OUT_PROFILES` strict-mode opt-out and a registry tarball signature-verify scenario.
- **1.1.0** (2026-05-12). Additive close-out of v1.0: RFCs 0002–0007 and 0009–0011 Accepted, new capability blocks for secrets, AI providers, MCP and HTTP clients, memory, agents, auth profiles and production, plus a gRPC transport profile.
- **1.0.0** (2026-05-11). First publication of the frozen v1 corpus: `@openwop/openwop` and `@openwop/openwop-conformance` on npm, `openwop-client` on PyPI, and the Go module.
- **1.0** (2026-05-08). v1 spec freeze: prose specs at `FINAL v1`, JSON Schemas, OpenAPI 3.1 and AsyncAPI 3.1, three reference SDKs, the conformance suite, and the multi-agent RFCs 0002–0007.
