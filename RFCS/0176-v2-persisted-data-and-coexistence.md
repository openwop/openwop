# RFC 0176: v2 persisted data and coexistence — the event-log translation contract as data, the v1-pinned-run disposition, one well-known resource for both majors, a per-store disposition for every table both hosts persist, and the corpus-tag pin

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0176                                                            |
| **Title**         | v2 persisted data and coexistence: the C.4 event rename is applied to persisted logs by a normative v1→v2 codemap shipped as data in the suite and a reader rule that keys on `eventLogSchemaVersion` (absent ⇒ `2`; v2 writes `3`) with sequence space preserved and unmapped types refused, never tolerated; a v1-pinned run a v2 host inherits continues under the adapter when its pin is still implemented and is otherwise cancelled with a named reason; `/.well-known/openwop` is one resource whose representation the RFC 0172 header selects, with the wrapper, the dotted mirror, `Capabilities-Etag` and MyndHyve's `/.well-known/wop` alias given removal triggers in `deprecations.json`; every table openwop-app persists and every collection MyndHyve persists gets a disposition here rather than during the migration; every consumer that vendors the corpus pins a tag |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-03                                                      |
| **Updated**       | 2026-09-03 (`Draft → Active` in the filing PR. **Comment window waived** under `GOVERNANCE.md` §"Sole-steward operation" and logged in `MAINTAINERS.md`; RFC 0001 §5 cross-org rule not yet active; RFC 0147 §A.6 overridden and named in the parent, RFC 0167 (replay and fork read persisted identity and effect records). Adversarial review recorded below.) · 2026-09-03 (filed) |
| **Affects**       | **Part of: RFC 0167 — child C9.** v2 (Phase 3): `spec/v2/core/persistence.md` (NEW: the reader rule, the era key, the pinned-run disposition, the per-store disposition template), `spec/v2/event-codemap.json` shipped in `@openwop/openwop-conformance@2.0.0` (the C.4 codemap promoted from `spec/v1/event-codemap.json` with every row `decided`), `schemas/v2/run-snapshot.schema.json` (`eventLogSchemaVersion` required, value `3`), `schemas/v2/run-event-payloads.schema.json` (`run.cancelled` reason `v1_pin_unsupported`, `cancelledBy: "v2-cutover"`), `spec/v2/core/discovery.md` (one resource, header-selected representation), `spec/v1/deprecations.schema.json` (`removalTrigger`, additive, this PR), suite scenarios `fork-a-v1-run`, `v1-events-translated`, `unmapped-type-refused`, `pinned-run-disposition`, `well-known-one-resource`, `v1-signed-webhook-accepted`; v1.x (this PR): `spec/v1/migrations.json` rows `openwop.migration.C9.1`–`C9.12`; deprecation row `well-known-wop-alias` (`proposed`); removal triggers on `capabilities-wrapper`, `host-dotted-mirror`, `capabilities-etag-header`; RFC 0170's persisted-data table corrected (openwop-app's owner stamp is `metadata.principalKind` + `metadata.anonPrincipal`, projected — there is no `metadata.owner`) |
| **Compatibility** | `breaking` (v2). In v1.x this PR changes no wire shape; `deprecations.schema.json` gains one optional field and one register row |
| **Supersedes**    | — (amends `version-negotiation.md` V1/V3/V4/V5 and §"Bumping protocol" item 3 for v2; corrects RFC 0170 §Persisted-data disposition row 1) |
| **Superseded by** | —                                                               |

## Summary

Axiom 6's surface. The C.4 cut renames 36 of 117 event types that are persisted, indexed and unique-keyed in three production stores, and fork and replay read those rows verbatim. v1 has a bump rule that says this rename *is* an `eventLogSchemaVersion` bump, a codemod registry that was never built (V1), a pinned-run path that is "drain" (V5), a reader on one host that is "tolerant of legacy docs", two disagreeing schema-version constants on that host, and no schema-version column at all on the other. This RFC makes the translation a protocol artifact (the codemap ships as data in the suite; every host backfills identically), keys the reader on the one axis v1 already defines with an absent-means-`2` rule so the tier-1 host needs no new column, refuses what the codemap does not name, states the terminal disposition of a v1-pinned run, makes the well-known document one resource under the RFC 0172 header, gives every alias openwop-app still emits a removal trigger, writes the disposition of every persisted store in both hosts, and turns the Phase 0 corpus-tag pin — done on one of three consumers — into a MUST.

## Motivation

- **Three stores, three schema-version truths.** openwop-app persists no schema version on runs or events (`backend/typescript/src/storage/postgres/schema.ts:38, 78` — `runs`, `events` with `type TEXT NOT NULL` free text and `UNIQUE (run_id, sequence)`); MyndHyve advertises `EVENT_LOG_SCHEMA_VERSION = 1` in discovery (`packages/workflow-engine/src/protocol/EventLog.ts:50`, `routes/discovery.ts:2440`) while its run documents stamp `PERSISTED_RUN_DOC_SCHEMA_VERSION = 2` (`workflowRunDocumentTypes.ts:227`, audit finding F5); the spec says the value is `2` (`version-negotiation.md:131`). The umbrella's axis row 4 says "the C.9 reader rule keys on it"; on the tier-1 host there is nothing to key on until a rule says what absence means.
- **The bump rule already fires.** `version-negotiation.md:146–151`: bump when "an event type is renamed or repurposed." C.4 renames 36 rows (`spec/v1/event-codemap.json`, `counts.overridden: 20`, all 117 `proposed`). Item 3 of §"Bumping protocol" (`:122`) requires a registered forward migration "on read OR on a background backfill" — the V1 codemod registry (`:494`, `future`) is that migration and was never built.
- **Tolerance is the forbidden path.** `serverEventLogIO.ts:65–87` passes `type` through unvalidated, drops `schemaVersion` when it is not a number, and defaults `sequence` to `0` on a malformed document — a silent sequence-space collision on the very field replay keys on (`replay.md:603`, `RunEventLogIO.read(sourceRunId, { fromSequence: 0, limit: fromSeq })`).
- **The adapter has one honest seat per host and it is not the obvious one.** openwop-app's `eventLog.list` (`executor/eventLog.ts:51–54`) is a pass-through that every route and executor call site bypasses (34 direct `storage.listEvents` calls: fork `executor.ts:1152, 1466, 2263`, poll `routes/runs.ts:1357`, SSE `routes/streams.ts:79, 175, 197`, bundle `routes/runs.ts:1374`); an adapter installed there covers none of them. MyndHyve's `fromFirestore` (`serverEventLogIO.ts:65`) is the seat every reader funnels through.
- **Pinned runs do not drain.** `version-negotiation.md:238` — "The runbook MUST instruct operators to drain or migrate runs holding deprecated pins"; V5 (`:498`) — the only path is drain; `channels-and-reducers.md:242` puts author-supplied migration code out of spec. Long-lived agent runs and suspended interrupts do not drain. MyndHyve already has the other arm as precedent: `cancelLegacyWorkflowRuns.ts:100–110` cancels a below-version non-terminal document with `cancelledBy: 'legacy-migration'` and a named error code.
- **The well-known aliases have conditions, not dates.** openwop-app emits root, wrapper and the last dotted mirror from one function (`routes/discovery.ts:1985–1991`, `:1864–1870` — the mirror's removal is "once `host-capabilities.md` shows the plain key", a prose edit in another repository); MyndHyve serves `/.well-known/wop` and `/.well-known/openwop` byte-identically (`routes/discovery.ts:3658–3659`) with no register row anywhere; the wrapper and mirror rows say `removeIn: "2.0"`, a version, and the charter asks for a date the schema cannot hold.
- **The pin is one of three.** openwop-app is pinned (`scripts/sync-schemas.sh:11–19`, `schemas/CORPUS_TAG = openwop-conformance/v1.152.0`, guard over 8 of 88 files after H34); openwop-sdks fetches `raw.githubusercontent.com/openwop/openwop/main` with no tag (`scripts/check-vendored-sync.mjs:17–18`); MyndHyve has no vendored corpus and a caret range `^1.159.0`. The moment `schemas/v2/` lands on `main`, the SDK guard fails or ships v2 into 1.x.

## Proposal

### §A. The event-log translation contract

**§A.1 Codemap as data.** `spec/v2/event-codemap.json` (the C.4 codemap with every row `decided`, RFC 0171 §A) ships inside `@openwop/openwop-conformance@2.0.0` and is the only authority for the v1→v2 type mapping. A host MUST NOT carry a private mapping; a host-specific v1 type (vendor-prefixed) that the codemap does not name is read under its own name unchanged (RFC 0171 §A.2 reserved-prefix rule).

**§A.2 The era key.** `eventLogSchemaVersion` is the era key. A run document without the field on a store that has ever been written by a v1 host reads as `2` (v1 era). A v2 host stamps `3` on every run it creates. The v1 rule for `< 2` (`version-negotiation.md:137–142`: snapshot fallback, no projection write-through) is unchanged. Discovery advertises the value the host writes for *new* runs and nothing else; MyndHyve's two constants are one axis and one value (RFC 0167 §F "constants unified before the codemap runs").

**§A.3 The reader rule.** A v2 host reading a run in era `2` MUST translate every event through the codemap at the storage boundary: `type` is mapped, the payload is projected per RFC 0171 §B, `sequence` is preserved verbatim including `0` (RFC 0165 G7), `eventId`, `timestamp`, `causationId` and vendor fields pass through. A type the codemap does not name and that carries no reserved vendor prefix MUST fail the read with `event_type_unmapped` — a run whose log the host cannot translate is not readable, not "tolerantly" readable. The rule applies to every reader: poll, SSE, fork, replay divergence, debug bundle, summary memory. A host MUST NOT rewrite era-`2` rows in place; the translation is a read projection (a background backfill that stamps `3` and rewrites `type` under the same `(run_id, sequence)` key is permitted only as an atomic per-run operation with the original preserved for the RFC 0041 §C byte-equivalence obligation).

**§A.4 The seat.** The adapter sits at the storage boundary that every reader passes through — openwop-app `storage.listEvents` (the interface method, not the `eventLog.list` wrapper), MyndHyve `fromFirestore`. A Phase 4 host leg names its seat in its ADR and the suite's `v1-events-translated` scenario reads through poll, SSE and a fork so a wrapper-only adapter is caught.

**§A.5 Fork a v1 run.** `fork-a-v1-run`: the suite seeds an era-`2` run (fixture log in v1 vocabulary through the C.1 seams profile, or a run the host created before the cut), forks it on the v2 host, and asserts the fork's prefix is byte-equivalent to the translated parent under RFC 0041 §C and that `run.started` on the fork carries the C.3 legacy Subject where the parent had none.

### §B. In-flight runs pinned to v1

**§B.1 Continue or cancel, never follow silently.** A non-terminal run a v2 host inherits whose `version.pinned` events (`version-negotiation.md:214–221`) name change ids the host still implements continues under the §A adapter; the pin is honored verbatim (the `version.pinned` event is never rewritten). Where any pinned change id is no longer implemented the host MUST cancel the run with `run.cancelled` reason `v1_pin_unsupported` and `cancelledBy: "v2-cutover"`, and the bundle v3 reports the count. Following nonexistent code is the failure `version-negotiation.md:238` names; "drain" is retired as the only path (V5 closed).

**§B.2 Suspended interrupts continue.** A run suspended on an interrupt at the cut continues under §B.1; its outstanding token is resolvable under `kid: legacy` until `expiresAt` (RFC 0170 §, row C3.8); the token's run reads through the adapter.

**§B.3 The other V rows.** V1 (codemod registry) is §A of this RFC — protocol data, not author code, so `channels-and-reducers.md:242` stands. V3 (`minClientVersion` MUST) is RFC 0172 row C5.8. V4 (multi-region skew) is bounded by RFC 0158's ladder: after the cut a v2 region MUST NOT accept an era-`2` write for a run it has already stamped `3`; skew is read-side only.

### §C. One well-known resource

**§C.1** `/.well-known/openwop` is one resource. Its representation is selected by `OpenWOP-Version` per RFC 0172 §A.3: no header ⇒ the v1 document (with `protocolVersions[]` additive, RFC 0165 §A) through the overlap; `OpenWOP-Version: 2` ⇒ the closed v2 root (RFC 0169 §A.4). A single fetch answers the major the client speaks and names the other. Through the overlap `preferredVersion` is a `1.x` member (RFC 0172 §A.3), so the header-less default and this rule select the same representation. The charter's "per-major sub-objects in one document" is not adopted: a v2 closed root cannot contain a v1 sub-object without reopening itself (adversarial review 3).

**§C.2 Removal triggers.** `deprecations.schema.json` gains an optional `removalTrigger` (`v2.0-cut` | `v1-end-of-support`). The wrapper (`capabilities-wrapper`), the dotted mirror (`host-dotted-mirror`), and `Capabilities-Etag` (`capabilities-etag-header`) are **absent from the v2 representation at the cut** and **removed from the v1 representation at v1 end-of-support** (the charter's Phase 0 rule: every INTEROP-MATRIX host has produced a non-vacuous v2 bundle, plus 90 days). openwop-app's prose-conditioned mirror removal (`discovery.ts:1863`) is retired by this trigger. **§C.3** MyndHyve's `/.well-known/wop` alias gets the row `well-known-wop-alias` with the same trigger; it was the C.5 precedent and has never been registered.

### §D. Everything else a v1 host persisted

**§D.1 Certification bundles** are never upgraded; a v1 bundle substantiates no new certification after 2026-11-10 (row `certification-bundle-v1`); every host produces a fresh v2-rc bundle before the cut (C.1). **§D.2 Webhooks.** Dual emission (RFC 0165 §C.1) is a MUST through the overlap for a host advertising both majors; a v2 receiver MUST accept a v1-signed delivery (`X-openwop-*` family, scheme `v1`) verifying the same bytes; per-subscription secrets are unchanged; deliveries queued before the cut (`webhook_deliveries` rows) are drained under their own retry policy with the payload they were serialized with. **§D.3 Resume tokens** are drained (row C3.8). **§D.4 Layer-1 and Layer-2 records** (`idempotency`, `idempotent_response`, `invocation_claim`, `invocation_log`, `effect_escape_ledger`, `dispatch_outbox`, `envelope_correlations`) are keyed on ids the cut does not rename and are `unchanged`; RFC 0173 §C's read projections are new reads over them. **§D.5 Owner stamps.** openwop-app's persisted stamp is `runs.metadata.principalKind` + `metadata.anonPrincipal`, projected to the wire `owner` triple (`routes/runs.ts:1485–1489`); RFC 0170's table row 1 named a `metadata.owner` key that does not exist and is corrected here. Pre-stamp rows are legacy-stamped at first v2 read (RFC 0170 §B).

### §E. The corpus-tag pin

**§E.1** A consumer that vendors any file from `schemas/`, `api/` or `spec/` MUST pin to a published `openwop-conformance/vX.Y.Z` tag, record it, and refuse a sync from any other ref; a v1.x consumer MUST NOT vendor `schemas/v2/`. Status at filing: openwop-app pinned; openwop-sdks unpinned (tracks `main`); MyndHyve no vendored corpus (caret range); openwop-registry unpinned and drifted (RFC 0177 §C). The Phase 0 item is reopened as G3 with the three remaining legs named.

## Migration table

| Row | Kind | v1 | v2 | Codemod | Persisted data |
| --- | --- | --- | --- | --- | --- |
| `openwop.migration.C9.1` | behavior | event logs in v1 vocabulary read verbatim | read through the codemap adapter at the storage boundary; sequence preserved | `openwop.codemod.event-type-codemap` (exported artifacts only; live stores use the reader rule) | translated |
| `openwop.migration.C9.2` | require | `eventLogSchemaVersion` "MUST carry" with value `2`; not persisted by openwop-app; two constants on MyndHyve | required on every run document; absent ⇒ `2`; v2 writes `3`; one constant per host | — | legacy-stamped |
| `openwop.migration.C9.3` | behavior | tolerant reader (unknown `type` passed through; malformed `sequence` ⇒ `0`) | `event_type_unmapped` fails the read; malformed rows fail the read | — | translated |
| `openwop.migration.C9.4` | behavior | pinned runs: "drain or migrate before raising `min`" (V5) | continue under the adapter when the pin is implemented; else `run.cancelled` `v1_pin_unsupported` / `cancelledBy: v2-cutover` | — | drained |
| `openwop.migration.C9.5` | add | none | `run.cancelled` reason `v1_pin_unsupported`; `cancelledBy: "v2-cutover"` | — | not-persisted |
| `openwop.migration.C9.6` | behavior | root + wrapper + dotted mirror emitted from one function, no end date | one resource, header-selected representation; wrapper/mirror/`Capabilities-Etag` absent from v2 at the cut, removed from v1 at end-of-support | `openwop.codemod.capabilities-wrapper-removal` (captured documents) | not-persisted |
| `openwop.migration.C9.7` | behavior | `/.well-known/wop` served byte-identically (MyndHyve) | removed at v1 end-of-support | — | not-persisted |
| `openwop.migration.C9.8` | behavior | v1 certification bundles | never upgraded; evidence for v1 only; fresh v2-rc bundle per host | — | never-upgraded |
| `openwop.migration.C9.9` | behavior | dual webhook emission SHOULD; receiver acceptance SHOULD | MUST through the overlap; v2 receiver MUST accept v1-signed; queued deliveries drained as serialized | — | drained |
| `openwop.migration.C9.10` | behavior | Layer-1/Layer-2/outbox/correlation tables | unchanged; new read projections (RFC 0173 §C) | — | unchanged |
| `openwop.migration.C9.11` | behavior | openwop-app owner stamp `metadata.principalKind` + `metadata.anonPrincipal` (RFC 0170 said `metadata.owner`) | projected to the Subject; pre-stamp rows legacy-stamped at first v2 read | — | legacy-stamped |
| `openwop.migration.C9.12` | require | vendored corpus synced from a sibling HEAD or `main` | pinned to a published tag; v1.x consumers never vendor `schemas/v2/` | — | not-persisted |

## Persisted-data disposition

| Store | v1 artifact | Disposition |
| --- | --- | --- |
| openwop-app `events` (pg:78 / sqlite:44; `type` free text; `UNIQUE (run_id, sequence)`) | v1 vocabulary | translated on read (§A.3); never rewritten in place except the atomic per-run backfill |
| openwop-app `runs` (`metadata` JSONB; no schema-version column) | runs without `eventLogSchemaVersion` | legacy-stamped: absent ⇒ era `2`; new runs `3`; `metadata.principalKind`/`anonPrincipal` projected (§D.5) |
| openwop-app `interrupts` (`token UNIQUE`) | two-segment HMAC tokens | drained under `kid: legacy` until `expiresAt` |
| openwop-app `webhooks`, `webhook_deliveries` (`event_type`, `payload` serialized) | subscriptions; queued deliveries | unchanged; drained as serialized (§D.2) |
| openwop-app `idempotency`, `idempotent_response`, `invocation_claim`, `invocation_log`, `effect_escape_ledger`, `dispatch_outbox`, `envelope_correlations` | keyed records | unchanged (§D.4) |
| openwop-app `audit_log` (`principal_id` bare) | audit facts | never-upgraded (RFC 0170) |
| openwop-app `annotations`, `workflows`, `host_ext_kv`, `byok_*`, `managed_provider_usage`, `workspace_files`, `agent_run_activity`, `run_budget`, chat/notification/messaging/relay/user-agent tables | host-internal | unchanged; outside the wire |
| openwop-app `__schema_version` / `__app_meta` (pg 40, sqlite 43 — three migrations apart) | adapter version rows | unchanged; the Phase 4 leg records the era migration as one numbered step on both adapters |
| MyndHyve `runs/{runId}/events` | v1 vocabulary; `schemaVersion` optional | translated on read through `fromFirestore` (§A.4); `schemaVersion` absent ⇒ era `2` |
| MyndHyve `runs/{runId}`, `test_runs/{runId}` (`RunDoc.subject` optional) | run documents stamped `2` | legacy-stamped; `PERSISTED_RUN_DOC_SCHEMA_VERSION` and `EVENT_LOG_SCHEMA_VERSION` unified to one value before the codemap runs |
| MyndHyve `workspaces/{ws}/canvases/{type}/runs` (the second, unwatched run store) | per-workspace run mirror | unchanged; not a wire surface; unification is a separate host change (`types.ts:270–273`) |
| MyndHyve `idempotency_claims`, `run_claims`, `workflow_invocations`, `suspensions` | keyed records | unchanged (`suspensions` drained with the tokens) |
| MyndHyve `webhook_subscriptions`, `audit`, `attempts`, `usage_*`, `endpoint_keys`, `rate_limits`, `canvas_endpoints`, `workflow_templates`, `agent_version_pins`, `extension_manifests`, `memories`, `shards` | host-internal | unchanged |
| Certification bundles (both hosts; baked into the image) | v1 bundles | never-upgraded (§D.1) |
| Vendored corpus copies (openwop-app 88 files; openwop-sdks 60; registry 13) | unpinned copies | pinned to a tag (§E.1); v1 images never carry `schemas/v2/` |

## Compatibility

`breaking` (v2). This PR changes no v1.x wire shape: `deprecations.schema.json` (a `spec/v1` data schema, not a wire schema) gains one optional field; one register row and three removal triggers are added; RFC 0170's table is corrected in prose.

## Conformance

v2 scenarios (suite 2.0.0): `v1-events-translated` (gated on the seams profile to seed an era-`2` log, read through poll, SSE and a fork; sequence `0` present), `unmapped-type-refused` (seams: an unnamed type fails with `event_type_unmapped`), `fork-a-v1-run` (§A.5), `pinned-run-disposition` (seams: a pin the host implements continues; one it does not is cancelled with the named reason), `well-known-one-resource` (unaided on a dual-advertising host: the two representations under one path; `protocolVersions[]` equal in both), `v1-signed-webhook-accepted` (gated on `webhooks`: the suite's receiver is sent an `X-openwop-*`-only delivery by the seams and the host's v2 receiver path accepts it), `corpus-tag-pinned` (a cross-repo evidence-manifest check, RFC 0165 §E: each consumer's recorded tag resolves).

### Falsifiability — one row per normative requirement

| Requirement | Observable | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.1 codemap is the only mapping | corpus gate + `v1-events-translated` — `openwop.requirement.0176.v1-events-translated` | the corpus gate; the suite via seams | witnessable — gated |
| §A.2 absent ⇒ `2`; v2 writes `3` | run snapshot — `openwop.requirement.0176.era-key` | the suite, unaided (`eventLogSchemaVersion` on a new run) | witnessable — unaided |
| §A.3 translated read with sequence preserved; unmapped refused | poll/SSE/fork; `event_type_unmapped` — `openwop.requirement.0176.v1-events-translated`, `openwop.requirement.0176.unmapped-type-refused` | the suite via the seams profile | seam-gated |
| §A.5 fork a v1 run byte-equivalent | fork prefix — `openwop.requirement.0176.fork-a-v1-run` | the suite via seams | seam-gated |
| §B.1 continue or cancel with the named reason | `run.cancelled` payload — `openwop.requirement.0176.pinned-run-disposition` | the suite via seams | seam-gated |
| §C.1 one resource, header-selected | two GETs — `openwop.requirement.0176.well-known-one-resource` | the suite, unaided on a dual host | witnessable — gated on two majors |
| §C.2 aliases absent from v2 | the v2 representation — `openwop.requirement.0176.well-known-one-resource.v2-representation` | the suite, unaided | witnessable — unaided |
| §D.2 v1-signed delivery accepted | receiver acceptance — `openwop.requirement.0176.v1-signed-webhook-accepted` | the suite, gated on `webhooks` | witnessable — gated |
| §E.1 tag pinned | evidence manifest | the corpus gate over the cross-repo manifest | witnessable — unaided (corpus) |
| §A.6 an append to an era-`2` run uses v1 vocabulary; the era key is fixed at run creation | `openwop.requirement.0176.era-2-append-vocabulary` — seed an open era-`2` run, drive one canonical mutation, read the whole log back | a host that upgrades with runs in flight | witnessable — gated on the seams profile |
| §A.7 every creation path stamps era `3` in one change; discovery advertises one collapsed constant; the snapshot era MAY be synthesized from absent-⇒-`2` | `openwop.requirement.0176.era-stamp-universal` — a run created after the cut carries `3` on every path, and the advertised value equals what every path writes | a host with more than one run-creation path | witnessable — unaided |

## Adversarial review

1. **Keying the era on a field the tier-1 host does not persist is keying on nothing.** Disposition: absence is the key — every run on a store that predates the cut reads as `2`, and the first v2 write stamps `3`; no column is added retroactively; MyndHyve's disagreement is closed by unifying to the run-document line, which is the value the spec names.
2. **"Fail on unmapped type" bricks every host that ever emitted a private event.** Disposition: RFC 0171 §A.2's reserved-prefix rule exempts vendor-prefixed types; an unprefixed, unmapped type is either a corpus bug (a codemap row is missing — the corpus gate over `event-type-codemap` catches it) or a host bug, and both are better surfaced than tolerated.
3. **The charter chose per-major sub-objects in one document; this RFC chooses header-selected representations.** Disposition: recorded deviation — the closed v2 root (RFC 0169 §A.4) cannot carry a v1 sub-object; RFC 0172 §A.3 already makes the header the selector; the property the charter wanted (one fetch answers both majors) holds because each representation carries `protocolVersions[]`.
4. **Cancelling an inherited run is data loss.** Disposition: the alternative is executing a pin the host no longer has code for; the run's log is preserved, the cancellation is an event with a named reason and a counted bundle field, and MyndHyve's `LEGACY_RUN_CANCELLED` is the working precedent.
5. **`removalTrigger` is a schema change to the register.** Disposition: `deprecations.schema.json` is `spec/v1` data, not a wire schema; the field is optional; `check-deprecations` validates it.
6. **RFC 0170's table said `metadata.owner`; this RFC says the key does not exist.** Disposition: corrected here with the file and line; RFC 0170's row is amended in the same PR to point at this RFC rather than restate the key.
7. **The Phase 0 pin was recorded as done.** Disposition: the charter's Phase 0 row is corrected to "1 of 3 (openwop-app)"; G3 names the two remaining consumers and the registry; §E.1 is the MUST that makes it a gate rather than a chore.

## Alternatives considered

1. Rewrite the stores in place at the cut. Rejected: RFC 0041 §C byte-equivalence for forks; a rewrite is permitted only as an atomic per-run backfill with the original preserved.
2. Let each host carry its own mapping. Rejected: Axiom 2 — two hosts would read one log two ways.
3. Drain pinned runs before the cut. Rejected: long-lived agent runs and suspended interrupts do not drain; V5 says so.
4. Two well-known documents. Rejected: RFC 0172 §A.3 already selects by header; two paths is the "both" C.5 forbids.

## Unresolved questions

1. Whether the atomic per-run backfill (§A.3) should be forbidden outright in v2.0 and allowed only by a later RFC. Recommended: allowed with the original preserved; decided at Phase 3 with the reference host's migration.

## Implementation notes (non-normative)

openwop-app installs the adapter at `storage.listEvents` in both adapters (pg 41 / sqlite 44 as the era migration step) and stamps `eventLogSchemaVersion` on `runs` at first v2 read; MyndHyve unifies the two constants, installs the adapter in `fromFirestore`, and retires the `/.well-known/wop` route at v1 end-of-support. openwop-sdks adopts `CORPUS_TAG` in `check-vendored-sync.mjs`; MyndHyve pins the conformance dependency to an exact version.

## Acceptance criteria

- [x] `Draft → Active`: RFC text; rows `C9.1`–`C9.12`; deprecation row `well-known-wop-alias`; `removalTrigger` on three rows; RFC 0170 table corrected; ledger row; adversarial review. (This PR.)
- [ ] `Active → Accepted` (Phase 3): `spec/v2/core/persistence.md`; `spec/v2/event-codemap.json` in the 2.0.0 tarball; the seven scenarios; openwop-app passes `v1-events-translated`, `fork-a-v1-run`, `well-known-one-resource`, `v1-signed-webhook-accepted`; the three consumers pinned.

## References

- `spec/v1/version-negotiation.md` §"Bumping protocol", §"Legacy run documents", V1/V3/V4/V5; `spec/v1/replay.md` §"Replay-from-event-log internals"; `spec/v1/channels-and-reducers.md:242`
- RFC 0041 §C; RFC 0158; RFC 0165 §A/§C.1/G7; RFC 0167 §B.5/§F; RFC 0169 §A.4; RFC 0170 §B; RFC 0171 §A/§B; RFC 0172 §A.3/C5.8; RFC 0173 §C
- openwop-app `backend/typescript/src/storage/{postgres,sqlite}/schema.ts`, `executor/eventLog.ts`, `routes/discovery.ts:1864–1870, 1985–1991`, `scripts/sync-schemas.sh`; MyndHyve `services/workflow-runtime/src/serverEventLogIO.ts`, `functions/src/migrations/cancelLegacyWorkflowRuns.ts`, `routes/discovery.ts:3658`
