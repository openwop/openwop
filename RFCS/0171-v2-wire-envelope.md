# RFC 0171: v2 wire envelope — one closed event envelope and payload registry, one error registry, one header scheme, a closed `configurable`, one poll cursor

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0171                                                            |
| **Title**         | v2 wire envelope: `oneOf` on a closed event `type` under one naming rule generated from `spec/v1/event-codemap.json` (the 18 review rows decided; four `core.*` types fold into their domains); every payload definition closed; vendor events under `<org>.*` with a positive pattern; one ordering field; the CloudEvents and webhook envelopes generated from the same definition; the closed-enum growth rule stated once; `errors.json` as the one error registry with typed `details` per code and `Retry-After` as the only retry timing; `OpenWOP-*` for every non-standard header; a closed, nested, versioned `configurable`; the four AsyncAPI channels that share one address become one channel with a typed parameter; the poll cursor becomes `afterSequence` with omission meaning "from the first event" and the poll response shape reconciled between prose and OpenAPI |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-03                                                      |
| **Updated**       | 2026-09-03 (`Draft → Active` in the filing PR. **Comment window waived** under `GOVERNANCE.md` §"Sole-steward operation" and logged in `MAINTAINERS.md`; RFC 0001 §5 cross-org rule not yet active; RFC 0147 §A.6 overridden and named in the parent, RFC 0167 (replay and external effects are in scope through the event log and the error registry). Adversarial review recorded below.) · 2026-09-03 (filed) |
| **Affects**       | **Part of: RFC 0167 — child C4.** v2 (Phase 3): `schemas/v2/run-event.schema.json` (`oneOf` on a closed `type`; `sequence`; `schemaVersion`), `schemas/v2/run-event-payloads.schema.json` (all definitions closed; `_typeIndex` normative), `schemas/v2/errors.json` (NEW, the error registry) + `error-envelope.schema.json` generated from it, `schemas/v2/run-options.schema.json` (`configurable` closed and nested), `api/v2/asyncapi.yaml` (one events channel with a typed `streamMode`; one heartbeat message), `api/v2/openapi.yaml` (`afterSequence`; one poll response shape; every non-standard header `OpenWOP-*`), `spec/v2/core/events.md`, `errors.md`, `headers.md`; `spec/v1/event-codemap.json` (18 `v2Override` decisions, this PR). v1.x (this PR, data only): `spec/v1/migrations.json` rows `openwop.migration.C4.1`–`C4.16`; codemods `openwop.codemod.event-type-codemap`, `openwop.codemod.debug-bundle-seq`, `openwop.codemod.configurable-v2`; deprecation rows `error-details-retry-after-spellings`, `configurable-dotted-keys` (`proposed`); register rows |
| **Compatibility** | `breaking` (v2). In v1.x this PR edits `spec/v1/event-codemap.json` hand fields (`v2Override`, `status`, `note`) — data no consumer reads in v1.x — and adds codemods and register rows; no wire artifact changes |
| **Supersedes**    | — (RFC 0021, 0030, 0094, 0140, 0151 §G6 remain the v1 authorities) |
| **Superseded by** | —                                                               |

## Summary

v1's event `type` is `anyOf: [enum, vendorRegex]` where the regex bans `vendor.*` and accepts a typo; 117 members across 41 first segments in four casing styles, 91 past-tense and 26 not; 63 of 120 payload definitions open, including `runStarted`, the one that carries the Subject; an error envelope whose code space has no enum and whose `details` is a bare object, 42 codes in a prose list, three live spellings of one retry-timing field plus the header; seven header naming schemes with a canonical table that lists 7 of about 20; a `configurable` that reserves 15 keys, types 6, and is open at its own root because the closure can only live at the OpenAPI composition; four AsyncAPI channels on one address plus a null-address channel; and a poll endpoint whose cursor cannot express "nothing seen", whose alias exists only in prose, and whose response shape has five fields in the spec and two in OpenAPI. v2 closes every one of those with one rule each and a codemod where data was persisted.

## Motivation

- `run-event.schema.json:34–47`: the vendor branch's negative lookahead bans `openwop|core|community|vendor|private|local` — so `vendor.acme.x` is invalid, `acme.x` is valid, and `run.startd` validates. The `type` description justifies it by "clients MUST ignore unknown event types," conflating reader tolerance with producer permissiveness.
- `spec/v1/event-codemap.json`: 117 rows, 18 `review: true`, 0 overridden; `core.workflowChain.confidence-escalated` is camel, kebab, three-segment, and reserved-prefixed at once; 21 three-segment types.
- `run-event-payloads.schema.json`: 63 open of 120 `$defs` (60 explicitly `true`), every core lifecycle payload among them; `_typeIndex` is labelled informative and is read as truth by the codemap generator and `spec-corpus-validity.test.ts:646`.
- `ai-envelope.md:833–835`: `meta.source` "required at v2", vendor namespacing "REQUIRED at v2"; `:834` `correlationId` has no v2 disposition; E3's example `vendor.myndhyve.prd.create` uses the namespace the event regex bans.
- `error-envelope.schema.json`: `error` is `minLength 1` with a SHOULD for snake_case and the list in another file; `details` is a bare object; `api/openapi.yaml:2615` and `:2641` re-declare the shape with one-member enums to type `details`; `retryAfter`/`retryAfterMs`/`retryAfterSeconds`/`Retry-After` are four live spellings with three consistency rules in three documents; `idempotency.md:93–104` records three spellings of one code.
- Headers: `openwop-Idempotent-Replay` (bare lowercase), `X-openwop-*` (mixed), `OpenWOP-*`, `X-Dedup`/`X-Pack-*`/`X-Force-Engine-Version`, `Capabilities-Etag`, the SDK-only `openwop-Webhook-Signature`, and `x-openwop-*` manifest annotation keys sharing the token shape; `rest-endpoints.md:311–320` enumerates 7; OpenAPI declares two header parameters.
- `run-options.md:96–122`: 15 reserved keys, 6 typed, four dotted (`ai.*`, `distillation.tokenBudget`), a reserved namespace expressed as a string prefix inside an open map; RFC 0094 §A put the closure at the OpenAPI composition, so every standalone validation of `run-options.schema.json` is open.
- `api/asyncapi.yaml:83–193`: four channels on `/runs/{runId}/events` selected by `streamMode`, each operation re-declaring an enum that "does not describe the accepted values"; `heartbeatEvents` has `address: null`.
- `version-negotiation.md:294`: `since` tolerated in prose, absent from OpenAPI; `:300–308` vs `openapi.yaml:427–435`: `{runId, events, lastEventSeq, runStatus, isTerminal}` vs `{events, isComplete}`; `:310` gives `lastEventSeq` two meanings. RFC 0165 G7: `lastSequence=0` skips a 0-numbered first event.
- `compensation.md:584` (G6): adding a member to a closed reason enum is additive for producers and breaking for strict consumers; no growth rule exists.

## Proposal

### §A. One event envelope

**§A.1** `type` is `oneOf: [ { $ref: RunEventType }, { pattern: <org>.<domain-or-name> } ]` where the vendor pattern is **positive**: `^(?!openwop\.)[a-z][a-z0-9]*(-[a-z0-9]+)*\.[a-z][a-z0-9]*(-[a-z0-9]+)*(\.[a-z][a-z0-9]*(-[a-z0-9]+)*)?$` with the first segment an org registered in the C.2 declaration file's `extensions` namespace; `openwop.` is the only reserved prefix; `core.`, `community.`, `vendor.`, `private.`, `local.` are gone (the v1 registry prefixes are pack namespaces, not event namespaces — C.10). A protocol event that is not in the enum fails; a vendor event whose org is not registered fails.

**§A.2** Naming rule: `domain.verb-ed` (kebab, exactly two segments) for a transition; `domain.noun` permitted where the event names an emitted artifact rather than a transition (`output.chunk`, `provider.usage`, `channel.presence`, `agent.handoff`, `envelope.refusal`, `agent.reasoning-delta`, `voice.synthesis-chunk`, `voice.endpoint-candidate`); state descriptors become transitions (`run.resuming` → `run.resume-started`). The 18 review rows are decided in `spec/v1/event-codemap.json` as `v2Override` in this PR (§Migration table lists them); the four `core.*` types fold into `dispatch.*` and `workflow-chain.*`; `runOrchestrator.decided` → `orchestrator.decided` (a distinct domain from `run`, confirmed); the 15 non-review three-segment folds are re-verified by the same pass and recorded.

**§A.3** `sequence` is the one ordering field (integer ≥ 0, first event 0 — unchanged, so no persisted log renumbers); `schemaVersion` per event stays first-class (RFC 0172 §B axis 5); `engineVersion` is an integer (RFC 0172 axis 3).

**§A.4** `run-event-payloads.schema.json`: every payload `$defs` entry is `additionalProperties: false`; `_typeIndex` is normative and generated; the CloudEvents mapping and the webhook delivery envelope are generated from the same definition (one source, three renderings); `ai-envelope.md`'s v2 promises are honored: `meta.source` required, envelope kinds namespaced under the same `<org>.` rule as events, `correlationId` required (its v1 "synthesize if absent" becomes "reject if absent"). E1–E5: E1 (partial reassembly) and E2 (multi-turn correlation) get a `sequence`/`correlationId` contract in `spec/v2/core/events.md`; E3 (vendor-kind registry) is the declaration file; E4 (sub-typing) is `$ref` composition, not duplication; E5 (refusal × retry) gets the worked example and a `maxRefusals` in `configurable`.

**§A.5 Closed-enum growth rule** (stated once in `spec/v2/core/§0`): a registry-backed enum (event types, error codes, envelope kinds, reason vocabularies, lanes) grows by adding a row to its registry and regenerating; **consumers MUST accept an unknown member of a registry-backed enum and MUST NOT act on it; producers MUST NOT emit an unregistered member.** Adding a member is therefore additive in v2.x; removing or renaming one is a major. `compensation.md` G6 (`approval-pending`, `parent-cancelled`) is resolved by the rule, independent of G7's endpoint family.

### §B. One error registry

**§B.1** `schemas/v2/errors.json`: one row per code `{ code, httpStatus, retriable, details: <schema or null>, since, deprecated? }`; `error-envelope.schema.json` is generated from it with `error` as the closed enum (vendor codes under `<org>.<code>` by the §A.1 pattern) and `details` as a `oneOf` discriminated on `error`. The flat shape `{error, message, details?}` stays. The two OpenAPI one-member-enum components (`RunClaimConflict`, `UnsupportedStreamMode`) become `$ref`s to the generated envelope.

**§B.2** Retry timing lives in `Retry-After` only; `details.retryAfter`, `retryAfterMs`, and `retryAfterSeconds` are removed (register row `error-details-retry-after-spellings`). The idempotency mismatch code is `idempotency_key_mismatch` only (its two retired spellings leave the suite's tolerance list at the cut). The C.3 and C.5 codes (`credential_revoked`, `identity_*`, `delegation_*`, `protocol_version_unsupported`, `protocol_version_mismatch`, `client_version_unsupported`, `idempotency_key_invalid`, `interrupt_token_invalid`) are rows.

### §C. One header scheme

**§C.1** Every non-standard header is `OpenWOP-<Name>` (Title-Case after the prefix): `OpenWOP-Idempotent-Replay`, `OpenWOP-Dedup`, `OpenWOP-Pack-Sha256`, `OpenWOP-Pack-Signing-Method`, `OpenWOP-Version` (RFC 0172), the five webhook headers (RFC 0165 §C.1). `Capabilities-Etag`, the `X-` family, `X-openwop-*`, and the SDK-only `openwop-Webhook-Signature` are removed on their register dates. Standard headers keep their standard names. Every header is declared in OpenAPI (as a parameter or a response header) — `spec/v2/core/headers.md` is generated from the same declaration, so the table that enumerates headers enumerates all of them.

**§C.2** The manifest annotation keys `x-openwop-*` are not headers; they are renamed `openwop-*` annotation keys in the v2 pack schemas (C.10) so the two namespaces stop sharing a token shape.

### §D. `configurable`

**§D.1** `configurable` is a closed, nested, versioned object: `{ version: 1, run: { recursionLimit, runTimeoutMs, maxLoopIterations, escalationThreshold }, ai: { provider, model, temperature, maxTokens, credentialRef, promptOverrides, mockProvider, reasoningVerbosity, maxRefusals }, distillation: { tokenBudget }, budget: <budget-policy>, extensions: { <org>: {…} } }`. Every reserved key is typed; a vendor key lives under `extensions.<org>`; the root is `additionalProperties: false` **in the standalone schema** — the RFC 0094 composition problem disappears because the request body `$ref`s the closed object instead of `allOf`-merging an open one.

### §E. One events channel, one poll cursor

**§E.1** AsyncAPI: one channel `runEvents` at `/runs/{runId}/events` with a typed `streamMode` parameter whose schema is the closed set and its comma-separated combinations (a `pattern`, not four enums), and one `heartbeat` message on a `hostEvents` channel with a real address the host declares in discovery (`heartbeat.deliveryChannel`) — `address: null` is gone. OpenAPI, AsyncAPI, and the proto resolve identical absolute paths (RFC 0172 §C.2).

**§E.2** Poll: the cursor is `afterSequence` (integer ≥ 0; the response carries events with `sequence > afterSequence`); **omission means "from the first event"**; `lastSequence` and `since` are removed. The response is `{ runId, events, lastSequence, status, isTerminal }` where `lastSequence` is the highest sequence in the log at the time of the response (one meaning), and the same shape is declared in `spec/v2/core/events.md` and generated into OpenAPI from one definition. The past-end rule (`200` + empty `events`) stands. The first event stays 0 (RFC 0165 G7's second option is rejected: it would renumber every persisted log).

## Migration table

| Row | Kind | v1 | v2 | Codemod | Persisted data |
| --- | --- | --- | --- | --- | --- |
| `openwop.migration.C4.1` | behavior | `X-openwop-*` webhook headers | `OpenWOP-*` (dual-emitted through the overlap, RFC 0165 §C.1) | — (headers are emitted, not persisted; subscribers read either) | not-persisted |
| `openwop.migration.C4.2` | behavior | `X-Dedup`, `X-Force-Engine-Version`, `X-Pack-Sha256`, `X-Pack-Signing-Method`, `openwop-Idempotent-Replay` | `OpenWOP-Dedup`, `OpenWOP-Force-Engine-Version` (seams profile), `OpenWOP-Pack-Sha256`, `OpenWOP-Pack-Signing-Method`, `OpenWOP-Idempotent-Replay` | — | not-persisted |
| `openwop.migration.C4.3` | rename | run event `type` vocabulary (117; four casings; `core.*`) | `domain.verb-ed` closed enum (`spec/v1/event-codemap.json` with 18 overrides) | `openwop.codemod.event-type-codemap` (generated from the codemap; the C.9 reader applies the same map) | translated |
| `openwop.migration.C4.4` | remove | `approvalRequested` / `clarificationRequested` payload defs; free-text `feedback` | `interrupt.requested {kind}`; `refineFeedback` | `openwop.codemod.event-type-codemap` (payload-def rename rides the same map) | translated |
| `openwop.migration.C4.5` | behavior | `lastSequence` cursor (cannot express the empty prefix); `since` alias in prose only | `afterSequence`; omission = from the first event; `since` removed | — (a query parameter; clients change, nothing persisted) | not-persisted |
| `openwop.migration.C4.6` | behavior | `409 interrupt_already_resolved` beside `410 interrupt_gone` | one code per state in `errors.json` | — | not-persisted |
| `openwop.migration.C4.7` | rename | debug-bundle event `seq` | `sequence` | `openwop.codemod.debug-bundle-seq` | never-upgraded (a published bundle stays valid v1 evidence; the codemod is for re-emission) |
| `openwop.migration.C4.8` | behavior | `openwop-Webhook-Signature` (SDK-only) | none | — | not-persisted |
| `openwop.migration.C4.9` | require | 63 of 120 payload defs open (`runStarted` among them) | every payload def closed; `_typeIndex` normative | — (schema closure; a v1 event with extra keys is read through the C.9 adapter) | translated |
| `openwop.migration.C4.10` | add | none (42 codes in prose; `details` a bare object) | `errors.json`; generated envelope with a closed enum and per-code `details` | — | not-persisted |
| `openwop.migration.C4.11` | behavior | `details.retryAfter` / `retryAfterMs` / `retryAfterSeconds` beside `Retry-After` | `Retry-After` only | — (error responses are not persisted) | not-persisted |
| `openwop.migration.C4.12` | retype | `configurable` open map with 15 reserved keys, 6 typed, 4 dotted | closed, nested, versioned object | `openwop.codemod.configurable-v2` (dotted keys → nested; unknown keys → `extensions.<org>`; refuses an unknown key with no org) | translated (persisted run rows carry `configurable` verbatim; read through the adapter) |
| `openwop.migration.C4.13` | behavior | four AsyncAPI channels on one address + `address: null` heartbeat | one `runEvents` channel with a typed `streamMode`; one `hostEvents` channel with a declared address | — | not-persisted |
| `openwop.migration.C4.14` | behavior | poll response `{runId, events, lastEventSeq, runStatus, isTerminal}` (prose) vs `{events, isComplete}` (OpenAPI) | `{ runId, events, lastSequence, status, isTerminal }` from one definition | — (a response shape; generated) | not-persisted |
| `openwop.migration.C4.15` | add | none | the closed-enum growth rule (§A.5) | — | not-persisted |
| `openwop.migration.C4.16` | require | `meta.source` SHOULD; vendor kinds RECOMMENDED; `correlationId` synthesized | `meta.source` required; `<org>.` kinds required; `correlationId` required | — (envelopes are transient; a persisted `envelope.*` event is read through the adapter) | translated |

The 18 codemap decisions (`spec/v1/event-codemap.json` `v2Override`, this PR): `run.resuming` → `run.resume-started`; `channel.presence`, `output.chunk`, `provider.usage`, `envelope.refusal`, `agent.handoff` keep their noun form (artifact events); `lease.handed-off`, `deployment.rolled-back` keep their form (already past-tense transitions); `replay.divergedAtRefusal` → `replay.diverged-at-refusal`; `agent.reasoning.delta` → `agent.reasoning-delta`; `runOrchestrator.decided` → `orchestrator.decided`; `core.dispatch.fanOut` → `dispatch.fanned-out`; `core.dispatch.join` → `dispatch.joined`; `core.workflowChain.event` → `workflow-chain.event`; `core.workflowChain.confidence-escalated` → `workflow-chain.confidence-escalated`; `voice.endpoint_candidate` → `voice.endpoint-candidate`; `voice.synthesis_chunk` → `voice.synthesis-chunk`; `voice.barge_in` → `voice.barge-in`.

## Persisted-data disposition

| Store | v1 artifact | Disposition |
| --- | --- | --- |
| Event logs (openwop-app SQLite/Postgres `events.type` free text; MyndHyve Firestore `runs/{id}/events`) | 117 v1 type names; open payloads | translated: the C.9 reader applies `event-codemap.json` on read with `sequence` space preserved; `openwop.codemod.event-type-codemap` backfills exports; fork-a-v1-run reads through the same map |
| Run rows (`configurable` column) | dotted / open map | translated by `openwop.codemod.configurable-v2` on read or backfill |
| Debug and certification bundles | `seq`, v1 type names | never-upgraded as evidence; re-emission uses the codemods |
| Webhook subscriptions | header family per subscriber | not-persisted (dual emission through the overlap; a v2 receiver accepts a v1-signed delivery — §F coexistence) |
| Error responses, envelopes | — | not-persisted |

## Compatibility

`breaking` (v2). In v1.x this PR edits only hand fields of `spec/v1/event-codemap.json` (no consumer reads it), adds three codemods, two `proposed` register rows, and migration rows; no schema, OpenAPI, AsyncAPI, or prose MUST changes. The v1 vendor regex, the open payloads, and the poll shapes stay as they are until the v1 tree is retired.

## Conformance

v2 scenarios (suite 2.0.0): `event-type-closed` (unaided: a typo'd protocol type fails; an unregistered org fails; `openwop.x` fails), `event-naming-rule` (corpus: every enum member matches the grammar and the tense rule with its recorded exceptions), `payload-registry-closed` (corpus + unaided: every def closed; an event with an extra key fails), `error-registry` (unaided: every `error` in every response is a registered code; `details` validates against the per-code schema; no body retry-timing field), `header-scheme` (unaided: every non-standard header on every response is `OpenWOP-*`; none of the removed names appears after its date), `configurable-closed` (unaided: an unknown root key is refused; `ai.provider` dotted is refused), `events-channel-parity` (corpus), `poll-cursor-v2` (unaided: omission returns from the first event; `afterSequence=N` returns `> N`; past-end `200` + empty; response shape), `enum-growth-rule` (unaided: a registered-but-unknown-to-the-client member is accepted by the suite's reader without action), `fork-a-v1-run` (C.9; gated on history — reads the codemap).

### Falsifiability — one row per normative requirement

| Requirement | Observable | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.1 closed `type`; positive vendor pattern | schema validation of injected types — `openwop.requirement.0171.event-type-closed`, `openwop.requirement.0171.enum-growth-rule` | the suite, unaided | witnessable — unaided |
| §A.2 naming rule and recorded exceptions | corpus gate over the enum | the corpus gate | witnessable — unaided (corpus) |
| §A.4 every payload closed; `_typeIndex` normative | corpus gate + an event with an extra key — `openwop.requirement.0171.payload-registry-closed` | the suite, unaided | witnessable — unaided |
| §A.5 growth rule: consumer accepts, producer never emits unregistered | the suite's reader on a registered-unknown member; a host emitting an unregistered member fails `event-type-closed` — `openwop.requirement.0171.enum-growth-rule`, `openwop.requirement.0171.event-type-closed` | the suite, unaided | witnessable — unaided |
| §B.1 every code registered; `details` typed | every error response — `openwop.requirement.0171.error-registry` | the suite, unaided | witnessable — unaided |
| §B.2 `Retry-After` only | a rate-limited response — `openwop.requirement.0171.error-registry` | the suite (gated on a host advertising limits) | witnessable — gated |
| §C.1 `OpenWOP-*` only; every header declared | every response; OpenAPI vs prose parity — `openwop.requirement.0171.header-scheme` | the suite, unaided; the corpus gate | witnessable — unaided |
| §D.1 `configurable` closed standalone | schema validation — `openwop.requirement.0171.configurable-closed` | the suite, unaided | witnessable — unaided |
| §E.1 one channel; path parity | corpus gate | the corpus gate | witnessable — unaided (corpus) |
| §E.2 `afterSequence` semantics; response shape | poll responses — `openwop.requirement.0171.poll-cursor-v2` | the suite, unaided | witnessable — unaided |

## Adversarial review

1. **`domain.verb-ed` forces `output.chunked` and `provider.used`.** Disposition: the rule is relaxed for artifact events (§A.2) with the exception list recorded in the codemap as `note`; the corpus gate checks the list, so an exception is a decision, not a drift.
2. **Dropping `core.*` puts four v1 types into a namespace the v1 regex bans.** Disposition: the v2 regex is positive and reserves only `openwop.`; the C.9 reader maps the four names; the codemod's refusal fixture proves a `core.` name never survives into a v2 log.
3. **`runOrchestrator` → `run`?** Disposition: no — the orchestrator is its own domain (`orchestrator.decided`); folding it into `run` would make `run.decided` mean two things. Recorded in the codemap note.
4. **The 15 non-review three-segment folds were done silently by the generator.** Disposition: re-verified in this PR; two are recorded exceptions (`envelope.nlToFormat.engaged` → `envelope.nl-to-format-engaged`; `trigger.subscription.state.changed` → `trigger.subscription-state-changed`), the rest fold cleanly; G1 records the list.
5. **Closing `runStarted` breaks any host that echoes extra owner keys.** Disposition: the v2 owner is C.3's closed shape; a v1 host's extra keys are stripped by the C.9 reader; C.3 §A.1's requirement and this closure land in the same PR C so neither is unwitnessable alone.
6. **`afterSequence` is a rename with no codemod (row C4.5 is `behavior`).** Disposition: a query parameter is not a persisted artifact; SDK 2 issues the new name; the v1 `lastSequence` stays on `/v1/` paths through the overlap (RFC 0172 §A.2).
7. **The poll response shape mismatch was in no register.** Disposition: filed as G2 and unified here (row C4.14); the OpenAPI shape was the one hosts implemented, so `isTerminal` replaces `isComplete` and the three missing fields are added.
8. **`Retry-After` only removes a MUST in `production-profile.md:51` and `scale-profiles.md:71`.** Disposition: those MUSTs required the body field to *equal* the header; with the body field gone the header is the single source; the two profiles are re-stated in `spec/v2/`.
9. **Charter corrections carried:** the payload registry is 63 open / 57 closed of 120, not 62/64; the prose error list has 42 codes in 40 bullets; the four-spelling case is retry timing, not `capability_*`; the two one-member enums are `components/schemas`, not inline responses.

## Alternatives considered

1. Keep `anyOf` and add a lint for typos. Rejected: a lint cannot distinguish a typo from a vendor event without the org registry, which is the closed root.
2. Number the first event 1 to make `lastSequence=0` meaningful. Rejected: renumbers every persisted log (Axiom 6); `afterSequence` with omission semantics is a pure rename.
3. Keep `details.retryAfter` for clients that cannot read headers. Rejected: every SDK reads headers; three body spellings is the measurement.
4. Do nothing. Rejected: `run.startd` validates today.

## Unresolved questions

1. Whether `hostEvents` (heartbeat) needs a normative delivery transport or stays a declared address the host serves by any transport. Decided in Phase 3 with C.8.

## Implementation notes (non-normative)

Phase 3 generates the v2 event schema, the envelope, the error envelope, the channel, and the header table from the declaration file and `errors.json`; the codemods here are the backfill tools Phase 4 runs on openwop-app's SQL and MyndHyve's Firestore (C.9's per-store rows name them). openwop-app's `eventLog` and MyndHyve's `serverEventLogIO` read through the codemap adapter; both hosts' poll routes drop the `+1`/`-1` cursor arithmetic (openwop-app's was a bug, MyndHyve's was correct) for a single `> afterSequence` read.

## Acceptance criteria

- [x] `Draft → Active`: RFC text; the 18 codemap decisions as `v2Override`; rows `C4.1`–`C4.16`; codemods `event-type-codemap`, `debug-bundle-seq`, `configurable-v2` green; two register rows; ledger row; adversarial review. (This PR.)
- [ ] `Active → Accepted` (Phase 3): `schemas/v2/run-event*.json`, `errors.json` + generated envelope, closed `configurable`, one channel, `afterSequence`; the ten scenarios in suite 2.0.0; openwop-app passes `event-type-closed`, `error-registry`, `header-scheme`, `configurable-closed`, `poll-cursor-v2` unaided.

## References

- RFC 0167 §A (Axioms 2, 3, 6), §B.4, §C, §E.2; RFC 0165 §C.1, G7; RFC 0169 (declaration file, `extensions` namespace); RFC 0172 §A–§C; RFC 0021 UQ1; RFC 0030; RFC 0094 §A; RFC 0150 §A (idempotency spellings); RFC 0151 G6/G7.
- `schemas/run-event.schema.json`, `run-event-payloads.schema.json`, `error-envelope.schema.json`, `run-options.schema.json`; `api/openapi.yaml` (`RunClaimConflict`, `UnsupportedStreamMode`, poll), `api/asyncapi.yaml` (channels); `spec/v1/event-codemap.json`; `spec/v1/ai-envelope.md` §v2 promises, E1–E5; `rest-endpoints.md` §Headers, §Common error codes; `run-options.md` §Reserved keys; `version-negotiation.md` §events/poll; `idempotency.md` §naming note; `compensation.md` G6; `production-profile.md:51`, `scale-profiles.md:71`.
