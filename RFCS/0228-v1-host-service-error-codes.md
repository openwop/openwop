# RFC 0228: the error codes v1 named for host services, decided for v2

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0228                                                            |
| **Title**         | the error codes v1 named for host services, decided for v2      |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-28                                                      |
| **Updated**       | 2026-09-28 — **`Draft → Active`. Comment window waived** (7-day, 0 days elapsed, not run) by the steward under `GOVERNANCE.md` §"Sole-steward operation" (steward direction 2026-09-28: the maintainer waived the comment window), logged in `MAINTAINERS.md` §"Bootstrap-phase RFC waivers". RFC 0147 §A.6 does not apply: the RFC names codes for refusals whose rules already exist, and changes no identity, authorization, isolation, idempotency, replay, external-effect or certification decision. The SSRF guard, tenant isolation and the `deploy:*` scope check keep their text; a recorded failure code replays as recorded; and no bundle, witness or replay preimage covers an error code. The seven Unresolved questions are decided (§Decisions). The rows, the §E meaning, the §G schema and OpenAPI fixes, the §A and §H rules, the home sentences and one new scenario land with the flip. The evidence gate is not waived. · 2026-09-28 — filed `Draft`; the 7-day comment window for a normative addition opens with the pull request and closes no earlier than 2026-10-05. The window is **not** waived. Nothing in `spec/v2/` changes until the RFC is `Active`. |
| **Affects**       | `spec/v2/errors.json` (+9 rows, `since` 2.45; `token_budget_exceeded`'s `meaning` narrowed) · generated `schemas/v2/error-envelope.schema.json` and the `errors.md` table and count (111 → 120) · `spec/v2/core/errors.md` (§Host-service refusals and §Unadvertised operations, new) · `spec/v2/core/storage.md`, `host-services.md`, `execution.md`, `runs.md`, `replay.md` (the homes name the §D codes; `replay.md`'s `410` is `run_expired`) · `schemas/v2/capabilities.schema.json` (`envelopes.reliability.events[]` enum widened, with a `spec/v1/deprecations.json` row for the dotted aliases; the descriptions of `production.backpressure.retryAfterSeconds`, `aiProviders.input.modalities`, `agents.modelClasses`, `agents.deployment`, and the `501`s of `prompts.endpointsSupported`, `prompts.mutableLibrary`, `agents.roster` and `agents.orgChart`), via keyed tables in `scripts/generate-from-declaration.mjs` · the descriptions in `schemas/v2/prompt-template.schema.json`, `prompt-ref.schema.json`, `agent-ref.schema.json`, `agent-deployment-transition.schema.json` and `spec/v2/facets/aiProviders.schema.json` that name unregistered codes · `api/v2/openapi.yaml` via `scripts/derive-v2-api.py` and `derive-v2-api-prose.yaml` (the `501` responses of gated operations, and the `/prompts*` and agent-deployment descriptions that name unregistered codes) · conformance: `v2-unadvertised-operation-not-found.test.ts` · unblocks the `budget` and `production` v2 homes (RFC 0189) |
| **Compatibility** | `additive` — nine new registry members and one enum widening (`spec/v2/core/overview.md` §0: adding a member is additive in v2.x), one narrowed `meaning` string, and schema and OpenAPI descriptions corrected to agree with `errors.md`. No schema shape or existing code is removed. Two documented statuses change: the `501` of an unadvertised gated operation becomes the `404` `runs.md` already requires, and `eval_gate_unmet`'s `403` becomes `422`. The pack-facing rejection codes change for packs that branch on v1's per-service names (§Compatibility) |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

v1 named about seventy error codes for host services and the families that consume them. These include 27 for the storage families, five `secret_*`, three `queue_*`, `ssrf_blocked`, `fetch_failed`, `host_capability_missing`, `unknown_child_workflow`, `budget_exhausted`, `budget_model_denied` and a `503` capacity code. The `prompts`, `aiProviders` and `agents` families add more (`prompt_ref_ambiguous`, `unsupported_modality`, `provider_policy_denied`, `eval_gate_unmet`, …). None is in `spec/v2/errors.json`. The RFC 0189 homing PRs therefore restated each rule without its code ("left to `errors.md`"), and two families, `budget` and `production`, could not be homed at all. Worse, several v2 schemas and `api/v2/openapi.yaml` already require codes the registry does not hold.

This RFC decides every one of them. Nine are registered. About fifty consolidate onto codes the registry already has, with a `details.service` field for the host-service ones. A handful are result values a `ctx` call resolves with, which need no code, and one is a log field. A handful of `aiProviders` provider-failure codes are left to that family's homing, with a leaning recorded. A host may use a vendor code for anything finer.

It also rules on two capability-schema defects found while homing `production` and `envelopes`. Both are fixed additively here, because neither can be fixed as a Class-3 correction. Finally, it settles what an operation gated on an unadvertised family answers: `404 not_found`, as `runs.md` already says, and not v1's `501`.

## Motivation

### The homes set the codes aside

- `spec/v2/core/storage.md` §Shared rules: "No error code specific to these families is registered; errors.md governs the code a refused call carries."
- openwop #1784 (the `secrets`, `queueBus`, `httpClient`, `subWorkflow` homes): "v1 named codes that are not in `spec/v2/errors.json`: `secret_*`, `queue_*`, `ssrf_blocked`, `fetch_failed`, `host_capability_missing` and `unknown_child_workflow`. The rules themselves are kept, but the codes are left to `errors.md`."
- The same PR: "`budget` and `production` depend on unregistered error codes." Both remain `v1Dependent` in `docs/normative-home-baseline.json` (8 families, measured 2026-09-28 with `check-v2-normative-home.mjs`).

`errors.md` §The registry says a host MUST emit a registered or vendor code wherever it emits an error code, so "left to `errors.md`" today means "a vendor code", and every host picks its own.

### A `ctx` rejection reaches the wire

It is tempting to say a `ctx.*` rejection is a value inside pack code and never an error response. The hosts show otherwise.

- **The v2 reference host passes a rejection through.** `examples/hosts/v2-reference/src/mcp-client.ts:22` (openwop-examples `b6302cd`): "The rejection code becomes the node's `node.failed` code, so the one the registry does not hold is a vendor code." It emits `example.mcp_unreachable` (`:67`, `:73`) and `example.http_fetch_failed` (`executor.ts:264`) for that reason.
- **A host cannot know at rejection time whether the pack will catch.** An uncaught rejection fails the node, and the code on `node.failed` is a wire code. `host-services.md` §`mcp` already reflects this: `ctx.mcp.*` rejects with `not_found` and `mcp_error`, both registered.
- **Packs branch on the codes.** openwop-app's `packs/vendor.myndhyve.ads-publish-google/index.mjs:236-242` (and the `-meta` and `-tiktok` packs) maps each of the five `secret_*` codes to its own outcome. A pack-facing code is contract, even when it is never an HTTP body.

### What the hosts emit

Measured at openwop-app `52b7715c9`, MyndHyve `3a7d56edc` and openwop-examples `b6302cd`, excluding tests:

| v1 code | openwop-app | MyndHyve | v2 reference |
| --- | --- | --- | --- |
| `service_unavailable` (503, with `details.retryAfter`) | — | `middleware/backpressureGate.ts:54-57` | — |
| `budget_exhausted`, `budget_model_denied` (on `run.failed`) | — | `host/budgetPolicy.ts:218`, `:287` | — |
| `ssrf_blocked`, `fetch_failed` (`ctx.http.safeFetch`) | — | `host/safeFetch.ts:68` | `example.http_fetch_failed` |
| `path_outside_sandbox`, `table_schema_violation` | `host/durable/durableFs.ts:20`, `durableTable.ts:69` | — | — |
| `secret_*` (pack-side branches) | the three `ads-publish-*` packs | `nodeBootstrap.ts` (`secret_not_found`) | — |
| MCP peer unreachable | — | — | `example.mcp_unreachable` |
| `host_capability_missing` | 73 sites in `backend/typescript/src` | 8 files | — (renamed by RFC 0226) |

The other storage codes, the `queue_*` codes and `unknown_child_workflow` are emitted by none of the three.

**No v2 scenario witnesses any of these codes.** `fs-path-traversal`, `table-schema-enforcement`, `budget-enforcement`, `budget-policy-shape`, `production-backpressure` and `policies` are all major-1 only in `conformance/scenario-majors.json`. `openwop.requirement.0171.error-registry.no-retry-details` passes on MyndHyve's certified bundle only because no v2 leg saturates its inflight cap.

### Two capability-schema defects

- **`production.backpressure.retryAfterSeconds`** (`schemas/v2/capabilities.schema.json`): its description says the value "MUST equal both the `Retry-After` header and the `details.retryAfter` body field per production-profile.md". `errors.md` §Retry timing says a host MUST NOT emit `details.retryAfter`. No v2 host can satisfy both. MyndHyve advertises `retryAfterSeconds: 5` in every committed v2 bundle and its gate emits `details.retryAfter`.
- **`envelopes.reliability.events[]`** enumerates the six v1 dotted names (`envelope.retry.exhausted`, `envelope.nlToFormat.engaged`, …). v2 renamed four of them (`spec/v2/event-codemap.json`: `envelope.retry-attempted`, `envelope.retry-exhausted`, `envelope.nl-to-format-engaged`, `envelope.recovery-applied`). `events.md` §envelopes says a host MUST list `envelope.retry-exhausted` in `reliability.events[]`, and the schema rejects that string. The rule is unsatisfiable as written.

### v2 artifacts already require unregistered codes

Each of these is a v2 artifact stating a MUST that `errors.md` §The registry makes impossible to meet with a registered code:

| Artifact | Code it requires | Emitted by (openwop-app / MyndHyve) |
| --- | --- | --- |
| `api/v2/openapi.yaml` `libraryId` parameter: "Hosts MUST return `prompt_ref_ambiguous`"; `getPromptTemplate` `400` | `prompt_ref_ambiguous` | `routes/prompts.ts:214`, `:330` (at `400`) / — |
| `schemas/v2/prompt-template.schema.json` (three descriptions); `api/v2/openapi.yaml` `/prompts:render` `400` | `prompt_variable_unresolved` | — / — |
| `schemas/v2/prompt-ref.schema.json` | `prompt_ref_ambiguous` | as above |
| `schemas/v2/capabilities.schema.json` and `spec/v2/facets/aiProviders.schema.json` (`input.modalities`) | `unsupported_modality` | 3 files / 4 files |
| `schemas/v2/capabilities.schema.json` and the facet (`policies[].errorCode`, "Defaults to `provider_policy_denied`") | `provider_policy_denied` | `aiProvidersHost.ts:1817` / `ProviderPolicyError.ts` |
| `schemas/v2/capabilities.schema.json` (`agents.modelClasses`) | `unsupported_model_class` | — / — |
| `schemas/v2/agent-ref.schema.json`; `capabilities.schema.json` (`agents.deployment`); `api/v2/openapi.yaml` transition `400` | `no_active_deployment` | — / `runExecutor.ts:2182` |
| `schemas/v2/agent-deployment-transition.schema.json`; `api/v2/openapi.yaml` transition `403` | `eval_gate_unmet` | — / `host/agentDeployment.ts:301`, answered at `422` (`routes/agents.ts:712`) |

The `aiProviders` modality codes that no v2 artifact names are emitted by both production hosts: `speech_synthesis_unsupported` (3 / 6 files), `transcription_unsupported` (5 / 5), `speech_synthesis_failed` (3 / 4), and `provider_not_supported` (4 / 0). `agent_binding_unresolvable` is not an error code: v1 puts it in a `log.appended` warning (`spec/v1/prompts.md:382`), and v2's `logAppended` payload carries it under `fields`.

### Unadvertised operations answer three different ways

- `spec/v2/core/runs.md` §Operations: "A gated operation the host does not advertise … answers `404`; for annotations it is `404 not_found`."
- `api/v2/openapi.yaml` documents `501` for the same unadvertised annotations operations, and for `/trigger-subscriptions`, `/content/pages`, `/content/settings` and all five `/prompts*` operations. It copies v1 (`spec/v1/prompts.md:262`: "return `501 capability_not_provided`").
- `capability_not_provided` is registered at `422`, and `errors.md` says a host MUST answer with the registered status. openwop-app answers `501 capability_not_provided` on every ungated `/prompts*` call (`routes/prompts.ts:147`, `:174`, `:178`, `:202`, `:242`), which matches neither.

## Proposal

### §A. A host-service rejection carries a wire-legal code

A `ctx.*` call that rejects MUST reject with a registered code or a vendor code. When a pack does not catch it, the host MAY carry it unchanged as the `node.failed` code. This makes that pass-through conformant by construction.

- A rejection that uses a code not specific to the service (`not_found`, `forbidden`, `validation_error`, `rate_limited`, `credential_not_found`, `credential_forbidden`) MUST set `details.service` to the family key (`fs`, `kvStorage`, `secrets`, `queueBus`, …).
- A rejection MAY add `details.reason`, a lower-kebab token naming the finer cause (for example `path-outside-sandbox`). A client MUST NOT route on `details.reason`; it routes on `error`.
- `host-services.md` §`toolHooks` already uses `forbidden` with `details.scope: "tool"`. `details.service` is the same idea for `ctx` services and does not replace `scope`.

### §B. Result values need no code

A `ctx` outcome that resolves instead of rejecting is a result value, not an error, and needs no registration:

- `kvStorage.compareAndSwap` with a stale `expectedValue` resolves `swapped: false` (already `storage.md`);
- `sql.transaction` after a rollback resolves `committed: false` (v1's `sql_transaction_aborted`);
- `ctx.mcp.callTool` resolves an `isError: true` `CallToolResult` unaltered, and `serverHealth` resolves `unreachable` (already `host-services.md`);
- `blobStorage` presigned-URL expiry is answered by the storage backend, not by an OpenWOP surface, so v1's `blob_presign_expired` has no v2 code at all. The rule that it MUST fail at the storage layer stays.

### §C. Nine new rows in `spec/v2/errors.json` (`since` 2.45)

| Code | Status | Retriable | `details` | Meaning |
| --- | --- | --- | --- | --- |
| `storage_limit_exceeded` | 422 | false | `{ service, limit }`, both required; `limit` is the advertised field that was exceeded (`maxValueBytes`, `maxTtlSeconds`, `maxRowsPerTable`, …) or `quota` | A storage call was refused because it would exceed an advertised limit or the tenant's quota. |
| `egress_denied` | 403 | false | `{ reason }`, required, from the `egress.decided` closed set minus `ok` | The host refused an outbound request a pack asked it to make: the address guard or the egress policy denied it. |
| `upstream_unavailable` | 502 | true | `{ service }`, required | A host service could not reach the upstream it depends on (a fetch target, an MCP server, a queue backend), so the call failed. |
| `budget_exhausted` | 422 | false | `{ dimension }`, required, one of `tokens`, `costUsd`, `toolCalls`, `retries` | A hard budget dimension was exhausted and the run failed. |
| `budget_model_denied` | 422 | false | `{ model }`, optional | The run's resolved model is outside its budget's `modelAllow`, or inside its `modelDeny`, so it was refused before the call. |
| `service_unavailable` | 503 | true | open; MUST NOT carry any retry-timing field (`errors.md` §Retry timing) | The host is at capacity. Retry after the `Retry-After` header when present. |
| `run_expired` | 410 | false | `{ runId }`, optional | The run, or the part of its event log the request needs, was purged under the host's documented retention. |
| `provider_policy_denied` | 422 | false | `{ provider, reason }`, `reason` optional (`provider-disabled`, `model-not-allowed`, …) | Host provider policy refused the model or provider before the call, so the node failed. |
| `eval_gate_unmet` | 422 | false | `{ evalRunId }`, optional | A deployment transition was refused because the eval run its gate requires is not terminal and passing. |

Why these nine, and not v1's seventy:

- **`storage_limit_exceeded`** replaces nine near-duplicates (`file_too_large`, `kv_key_too_large`, `kv_value_too_large`, `kv_ttl_exceeds_max`, `kv_quota_exhausted`, `table_row_limit_reached`, `blob_object_too_large`, `cache_value_too_large`, `cache_ttl_exceeds_max`). They are one state, "over an advertised limit", and `storage.md` §Size limits already lists the limits by their advertised field names. `payload_too_large` (413) is not reused: it names an HTTP request body refused before parsing, and a TTL or a row count is not a size.
- **`egress_denied`** covers v1's `ssrf_blocked` and the `egressPolicy` denial, which v1 left without a code. Its `reason` reuses the closed enum `egress.decided` already has, so the refusal and the audit event cannot disagree. `webhook_url_rejected` is not reused: it is a `400` for a URL a client registered, not a pack's outbound call.
- **`upstream_unavailable`** covers `fetch_failed` (transport arm), `queue_backend_unavailable`, `mcp_server_disconnected` and the reference host's `example.mcp_unreachable` and `example.http_fetch_failed`. RFC 0226 declined to register `mcp_unreachable` until a second host measured the same failure. MyndHyve's `fetch_failed` is that second measurement, under a wider name. It is `502` like `mcp_error`, but retriable, because nothing answered.
- **`budget_exhausted` and `budget_model_denied`** are v1's names, MyndHyve's spellings, and what `budget` needs to be homed. `token_budget_exceeded` is **not** reused: v1 defined it for memory distillation only (`spec/v1/rest-endpoints.md:387`, RFC 0062). Its v2 `meaning` ("The run could not stay within its token budget.") is wider than that and would name the same state as `budget_exhausted` with `dimension: tokens`. §E narrows it back.
- **`service_unavailable`** is v1 prose's name and MyndHyve's spelling. `runner_unavailable` is not reused: it names run execution, and backpressure applies to any gated request.
- **`provider_policy_denied`** is emitted by both production hosts. v2's `aiProviders` facet schema already names it as the default of `policies[].errorCode`, so it is registered here rather than left to the `aiProviders` homing. `budget_model_denied` stays separate: v1 kept a budget allowlist apart from provider policy on purpose, and MyndHyve emits the two distinctly. The status is `422`, the registry's convention for a run-ending refusal (RFC 0226). `policies[].errorCode` stays, but a value other than the default MUST be a vendor code.
- **`eval_gate_unmet`** is emitted by MyndHyve at `422`; `api/v2/openapi.yaml` documents it at `403`. It is not an authorization failure: the caller holds the scope, and what is missing is evidence. Folding it into `forbidden` would give "you lack a role" and "run the eval first" one code, so it gets its own row, at the status the measured host uses.
- **`run_expired`** has no measured host. It is registered because `replay.md` already requires a `410` for a fork past retention and names no code, and because `production` needs one. A host MAY still answer `404 not_found` when it cannot tell an expired run from an unknown one.

### §D. The disposition of every v1 code

Legend: **R** = new row (§C); **E** = an existing registered code, with `details.service` when it answers a `ctx` call (§A); **V** = a result value, no code (§B); **—** = already decided elsewhere.

| v1 code(s) | Family | Disposition |
| --- | --- | --- |
| `file_not_found`, `table_not_found`, `datasource_not_found`, `vector_collection_not_found`, `search_index_not_found`, `blob_bucket_not_found`, `blob_object_not_found` | storage | **E** `not_found` |
| `path_outside_sandbox`, `fs_permission_denied`, `datasource_access_denied` | `fs`, `sql`, `nosql` | **E** `forbidden` (`details.reason: path-outside-sandbox` for the first). A cross-tenant refusal MAY answer `not_found` instead, as `workspace` already allows. |
| `table_schema_violation`, `sql_non_parametric`, `sql_syntax_error`, `nosql_filter_rejected`, `search_query_syntax_error`, `vector_dimension_mismatch` | storage | **E** `validation_error` |
| `file_too_large`, `kv_key_too_large`, `kv_value_too_large`, `kv_ttl_exceeds_max`, `kv_quota_exhausted`, `table_row_limit_reached`, `blob_object_too_large`, `cache_value_too_large`, `cache_ttl_exceeds_max` | storage | **R** `storage_limit_exceeded` |
| `sql_transaction_aborted` | `sql` | **V** `committed: false` |
| `blob_presign_expired` | `blobStorage` | **V** outside the protocol surface |
| `secret_not_found` | `secrets` | **E** `credential_not_found` (its registered meaning is exactly this) |
| `secret_revoked`, `secret_expired` | `secrets` | **E** `credential_not_found`, `details.reason` `revoked` or `expired` OPTIONAL. v1 already allowed revocation to surface as not-found so lifecycle state does not leak. `credential_revoked` is not reused: it names a revoked API key or session. |
| `secret_access_denied` | `secrets` | **E** `credential_forbidden` |
| `secret_quota_exhausted` | `secrets` | **E** `rate_limited` |
| `queue_topic_not_found`, `queue_delivery_token_expired` | `queueBus` | **E** `not_found` (the delivery an expired token names no longer exists; the message is redelivered) |
| `queue_backend_unavailable` | `queueBus` | **R** `upstream_unavailable` |
| `ssrf_blocked` | `httpClient` | **R** `egress_denied`, `reason: ssrf-blocked` |
| `fetch_failed` | `httpClient` | **R** `upstream_unavailable` for a transport failure; **E** `validation_error` for a malformed URL |
| `mcp_server_not_found` | `mcp` | — `not_found` (`host-services.md`) |
| `mcp_tool_not_found`, `mcp_tool_invocation_failed` | `mcp` | — `mcp_error` when the peer answers an error, or **V** an `isError` result |
| `mcp_server_disconnected` | `mcp` | **R** `upstream_unavailable` |
| `host_capability_missing` | all | — `capability_not_provided` (RFC 0226) |
| `unknown_child_workflow` | `subWorkflow` | **E** `node_config_invalid` (RFC 0226): `workflowId` names a value the node cannot use |
| `budget_exhausted`, `budget_model_denied` | `budget` | **R** |
| the `503` capacity code (`service_unavailable`) | `production` | **R** |
| the `410` run-expiry answer (v1 named no code) | `production` | **R** `run_expired` |
| `prompt_variable_unresolved` | `prompts` | **E** `node_config_invalid` when a node's prompt composition fails (a required value is missing); **E** `validation_error` from `/prompts:render` |
| `prompt_ref_ambiguous` | `prompts` | **E** `validation_error` with `details.field: libraryId`: the client's fix is to add that field |
| `prompt_template_invalid` | `prompts` | **E** `pack_validation_failed` (a prompt-pack install) |
| `prompt_pack_dependency_unresolvable` | `prompts` | **E** `pack_version_not_found`, or `pack_dependency_conflict` when versions exist but none satisfies every range |
| `unsupported_modality`, `speech_synthesis_unsupported`, `transcription_unsupported`, `provider_not_supported`, `model_not_supported` | `aiProviders` | **E** `capability_not_provided`, with `details.requiredCapability` naming the facet (for example `aiProviders.speechSynthesis`), as `runs.md` already does for `capability_required` |
| `speech_synthesis_failed` (reason `streaming_unsupported`) | `aiProviders` | **E** `capability_not_provided` (`aiProviders.realtimeVoice.synthesis`) |
| `provider_unavailable` | `aiProviders` | **R** `upstream_unavailable` |
| `provider_quota_exhausted` | `aiProviders` | **E** `rate_limited` |
| `response_schema_invalid` | `aiProviders` | **E** `validation_error` |
| `provider_policy_denied` | `aiProviders` | **R** |
| `agent_binding_unresolvable` | `prompts` | **V** not an error code: a `log.appended` warning, carried in `fields.code`, outside the registry's scope |
| `unsupported_model_class` | `agents` | **E** `pack_runtime_requirement_unmet` (an agent pack declares a model class the host lacks) |
| `no_active_deployment` | `agents` | **E** `validation_error` at run creation, as v1 itself says (`spec/v1/agent-deployment.md:29`); **E** `not_found` with `details.service: agents` when a dynamic binding fails the run |
| `eval_gate_unmet` | `agents` | **R** |

**Not decided here:** the `aiProviders` codes for a provider that *answered* with a failure: `content_too_long`, `envelope_validation_failed`, `image_generation_failed`, `image_safety_filtered_all`, `video_generation_failed`, `video_generation_timeout` and the provider arm of `speech_synthesis_failed`. Both production hosts emit `content_too_long` (7 / 5 files). The leaning is one `provider_error` row (`502`, not retriable, the provider's reason in `details`), parallel to `mcp_error`. `video_safety_filtered` already resolves rather than rejects (**V**). The `aiProviders` homing decides these under §A–§C (Unresolved 3). The pack-registry publish codes in `spec/v1/node-packs.md` (`invalid_manifest`, `unpublish_window_expired`, …) belong to the registry protocol (RFC 0222), not to host services.

### §E. `token_budget_exceeded` is narrowed to what v1 defined

Its `meaning` becomes: "A memory distillation could not be completed within its effective token budget, so the run failed and wrote no partial archive." This is v1's meaning (RFC 0062). The v2 row widened it without an RFC, which is why it would otherwise collide with `budget_exhausted`.

### §F. Vendor codes

A host MAY use a vendor code (`errors.md` §The registry) for a refusal no registered code names. It SHOULD prefer the registered code plus `details.reason` when the state is one the registry names and only the cause is finer (a SQL driver's error class, for example). A host MUST NOT use a vendor code for a state this RFC gives a registered code.

### §G. The schema and OpenAPI defects

| Defect | Fixed by | Why not the other route |
| --- | --- | --- |
| `production.backpressure.retryAfterSeconds` requires `details.retryAfter` | **This RFC.** The description becomes: "When present, MUST equal the `Retry-After` header the host sends with `503 service_unavailable`." | No schema pointer moves, so it is not a Class-3 correction (`spec/v2/corrections.schema.json` rows are pointer moves). The corrected sentence names `service_unavailable`, which §C registers, so it cannot land first as an erratum without naming an unregistered code. |
| `envelopes.reliability.events[]` lists only the v1 dotted names | **This RFC**, additively: the enum gains the four v2 spellings (`envelope.retry-attempted`, `envelope.retry-exhausted`, `envelope.nl-to-format-engaged`, `envelope.recovery-applied`). The four dotted names stay valid and are described as deprecated aliases. A consumer MUST treat a dotted name as its hyphenated equivalent. | A Class-3 correction that replaced the enum fails RFC 0197 R3. Six committed bundles (`evidence/v2-host-bundles/myndhyve*.json`, measured 2026-09-28) carry the dotted names in their discovery document, and a replacement would make those documents invalid. Adding the members is additive (`overview.md` §0). Removing the dotted aliases is left to v3. |
| Eight v2 schema and OpenAPI descriptions require an unregistered code (§Motivation, "v2 artifacts already require unregistered codes") | **This RFC.** Each description names the §D code instead; `api/v2/openapi.yaml`'s `eval_gate_unmet` response moves from `403` to `422`. | They are descriptions, so no schema pointer moves and there is nothing for a Class-3 row to record. The replacement codes are the §C/§D decisions, so no erratum could make them first. The one status move changes documentation of a response, not a schema pointer, and the only host that emits the code already answers `422`. |

### §H. An unadvertised operation answers `404 not_found`

`runs.md` states this for its own operations. This RFC makes it the rule for every operation gated on a family, and moves the rule to `errors.md` §Unadvertised operations:

- A host MUST answer an operation gated on a family or facet it does not advertise with `404 not_found`. `/prompts*` under `prompts.endpointsSupported` and the mutating three under `prompts.mutableLibrary` are covered, as are `/trigger-subscriptions` and `/content/*`.
- `api/v2/openapi.yaml` replaces each such `501` with the shared `404` response.

Why not the others:

- **Not `501`.** The registry holds no code at `501` for this state; its only `501` is `credential_unavailable`. A bare `501` carries no registered code at all.
- **Not `422 capability_not_provided`.** That code answers a well-formed request that *needs* a capability, such as a workflow naming a node type. A request to a route the host does not serve names no capability. It is the route that is absent, and `runs.md` already chose `404` for that.
- **`404` does not disclose.** It is also what a host answers for any path it does not serve. A client that wants to know why reads discovery, which is the only authoritative source of what is advertised.

### §I. What the homes then say

On `Active`, the "left to `errors.md`" sentences in `storage.md`, `host-services.md` and `execution.md` name the §D codes. `budget` and `production` can then be homed by a follow-up RFC 0189 PR, which this RFC does not include. The estimated cost is about 90 core words for the home sentences and about 60 for §A and §H in `errors.md` (`check-core-budget.mjs`: 34,768 / 36,200 at filing). The nine generated table rows cost about 27 words more, unless RFC 0227 moves that table out of the budget first.

## Compatibility

`additive` under `overview.md` §0: nine new registry members, four new enum members, a narrowed `meaning` string, and descriptions brought into line with `Stable` core rules. Two documented statuses move (§G, §H); in both cases the new status is the one a `Stable` rule or the only emitting host already uses.

- **Clients.** A client that meets an unknown code already MUST accept it. Nothing a client routes on today is removed.
- **Hosts.** A host emitting one of v1's names today is as non-conformant as before; the RFC gives it a registered name to move to. MyndHyve renames `ssrf_blocked` and `fetch_failed`, and drops `details.retryAfter` and `details.inflightCap` from its 503 (the second is harmless under an open `details`, but it is capacity data). The v2 reference host renames `example.mcp_unreachable` and `example.http_fetch_failed` to `upstream_unavailable`. openwop-app's `path_outside_sandbox` and `table_schema_violation` become `forbidden` and `validation_error` with `details.service`. openwop-app answers `404 not_found` instead of `501` on ungated `/prompts*`, and `prompt_ref_ambiguous` becomes `validation_error`. MyndHyve moves `no_active_deployment` to `validation_error` / `not_found`, and puts its agent-deployment denial under the envelope's `details` (it answers a top-level `detail` today, `routes/agents.ts:719`, which `additionalProperties: false` forbids). Both hosts move the `aiProviders` modality codes to `capability_not_provided`. The rename lists go in the gap register (G1–G3, G6, G7).
- **Packs.** A pack that branches on a v1 per-service name must branch on `error` plus `details.service` instead. openwop-app's three `ads-publish-*` packs are the measured case: `secret_not_found`, `secret_revoked` and `secret_expired` all become `credential_not_found`, and the pack reads `details.reason` to tell them apart. A pack that must run on both majors checks both spellings. This is the one change a pack author feels. The comment window was waived at `Active` (see Updated), so risk R1 carries the exposure.

## Conformance

No new leg landed with the `Draft`. At `Active`, `v2-unadvertised-operation-not-found.test.ts` witnesses §H unaided: `openwop.requirement.0228.unadvertised-prompts-not-found` (`GET /prompts` when `prompts.endpointsSupported` is not advertised) and `openwop.requirement.0228.unadvertised-content-not-found` (`GET /content/settings` when `content` is not advertised). Each leg was sabotage-proved against a stub host answering v1's `501 capability_not_provided`, and a bare `404` with no envelope.

- `openwop.requirement.errors.event-code-registered` (advisory until suite 2.45.2, required since) already reads every run-failure code against the registry. It drives only `conformance-failure`, so it does not see `ctx` rejections. §A is witnessed only once the v1 host-service scenarios gain v2 ports (gap G4).
- `openwop.requirement.0171.error-registry.no-retry-details` already forbids `details.retryAfter`. On a 503 it only fires once `production-backpressure.test.ts` has a v2 port.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §C the nine codes are registered with their status, retriability and `details` schema | `spec/v2/errors.json`, the generated envelope, the `errors.md` table | the corpus gates (`generate-error-envelope.mjs --check`, `v2-error-registry-prose-parity`) | claims-check (corpus) |
| §A an uncaught `ctx` rejection's code on `node.failed` is registered or vendor | the `node.failed` `error.code` of a node that let a storage or `safeFetch` rejection escape | the suite, with a fixture node that calls an advertised family out of bounds (a planned v2 port of `fs-path-traversal.test.ts`) | witnessable — gated (on the family being advertised) |
| §A a generic code on a host-service rejection carries `details.service` | the same `node.failed` `error.details` | as above | witnessable — gated (on the family being advertised) |
| §C `storage_limit_exceeded` names the advertised limit | `details.limit` equals the advertised field the call exceeded | the suite, by writing one byte over an advertised `maxValueBytes` | witnessable — gated (on `kvStorage` or `cache` being advertised) |
| §C `503 service_unavailable` with `Retry-After` and no retry-timing field in `details` | the saturated response | the suite, only when `production.backpressure.inflightCap` is advertised (a planned v2 port of `production-backpressure.test.ts`) | witnessable — gated (on `inflightCap`, which a load-balanced host does not advertise) |
| §C `budget_exhausted` carries `details.dimension` on `run.failed` | the `run.failed` error of a run given a one-token budget | the suite, when `budget.enforce: hard` is advertised (a planned v2 port of `budget-enforcement.test.ts`) | witnessable — gated (on `budget`) |
| §C `run_expired` for a purged run | a `410` on a run older than retention | only time or an operator purge; retention is at least 7 days | seam-gated — no purge seam exists, and the suite cannot wait out retention |
| §C `egress_denied` with `reason: ssrf-blocked` | the `node.failed` code of a `safeFetch` to a loopback address | the suite, with a fixture node | witnessable — gated (on `httpClient.safeFetch`) |
| §C `upstream_unavailable` | the `node.failed` code when a bound MCP server or fetch target is down | the operator, who binds the upstream | seam-gated — the suite cannot take down an upstream the host chose |
| §G a hyphenated name in `reliability.events[]` validates | `schemas/v2/capabilities.schema.json` | the corpus gates | claims-check (schema) |
| §G no v2 schema or OpenAPI description names an unregistered code | the descriptions in `schemas/v2/**` and `api/v2/openapi.yaml` | a corpus gate that reads each backticked lower-snake token in a description against the registry (planned) | claims-check (corpus) |
| §H an unadvertised gated operation answers `404 not_found` | the response to `GET /prompts` on a host whose discovery omits `prompts.endpointsSupported` | the suite, unaided, on any host that does not advertise the facet | witnessable — unaided |

## Alternatives considered

1. **Treat every `ctx` rejection as a pack-internal value that needs no registration** (the option this RFC was asked to weigh as (b)). Rejected on measurement. An uncaught rejection becomes a `node.failed` code, the v2 reference host already passes it through, and `host-services.md` §`mcp` already draws `ctx` rejection codes from the registry. The variant, "the host wraps an uncaught rejection in one registered umbrella code", was also considered. It still needs a pack-facing vocabulary homed somewhere, and it costs every host a mapping layer. A client would then learn only "a host service failed", with the cause buried in `details`. §B keeps what is true in (b): an outcome that resolves is a value.
2. **Register v1's names as they are** (about fifty rows). Rejected. Nine of them are the same state with a different noun, and v2 already names five more (`credential_not_found`, `not_found`, …). "One code per state" (`errors.md`) would be broken on the first day.
3. **Vendor codes only** (the status quo). Rejected. It leaves `budget` and `production` unhomeable. It also gives three hosts three spellings of an SSRF refusal and a pack no portable way to handle a missing secret.
4. **Reuse `payload_too_large` for storage limits and `runner_unavailable` for backpressure.** Rejected because of their registered meanings (§C).
5. **Fold `budget_model_denied` into `provider_policy_denied`.** Rejected: v1 kept them apart on purpose (a per-run spend allowlist versus host provider policy), MyndHyve emits the two distinctly, and folding would rename a code both production hosts emit.
6. **Answer an unadvertised gated operation with `422 capability_not_provided`, or keep v1's `501`.** Rejected (§H): the first misuses a code for a request that needs a capability, and the second has no registered code. `runs.md` already chose `404`.

## Decisions

Decided by the maintainer on 2026-09-28, at the `Draft → Active` flip. Each was an Unresolved question in the `Draft`. Each takes the RFC's own recommendation or lean; where it gave none, the option with the least new surface.

1. **`path_outside_sandbox`** (was question 1). No own code. A sandbox escape is `forbidden` with `details.reason: path-outside-sandbox` (`storage.md` §Shared rules). This is the RFC's lean: v1's scenario accepted three spellings, so no one routed on the code.
2. **`queue_delivery_token_expired`** (was question 2). `not_found`, as §D maps it. No conflict code is registered: that is the least new surface, and a backend that does not redeliver has still lost the delivery the token names. `host-services.md` §`queueBus` names it.
3. **Provider-failure codes** (was question 3). Not registered here. They transfer to the `aiProviders` RFC 0189 homing (gap G5), with the RFC's lean as that homing's default: one `provider_error` row (`502`, not retriable, the provider's reason in `details`), parallel to `mcp_error`, and no separate `content_too_long` row.
4. **`sql.transaction` after a rollback** (was question 4). It resolves `committed: false` and does not reject, as §B assumed. `storage.md` §`sql` and `nosql` says so.
5. **`run_expired`'s reach** (was question 5). The RFC gave no lean, so the least new surface is taken. `run_expired` is the code of the `410` arm of `replay.md`'s fork-past-retention refusal, and `replay.md` now says `410 run_expired`. The `422` arm stays. `runs.md` §Dead letters keeps "fails as for an unknown run": a purged run a host cannot tell from an unknown one answers `404 not_found`, as §C allows.
6. **`no_active_deployment`** (was question 6). No own row. §D stands: `validation_error` at run creation, `not_found` with `details.service: agents` when a dynamic binding fails the run. The `agents` homing may revisit it with a measurement.
7. **`405` for `mutableLibrary: false`** (was question 7). No. The mutating three answer `404 not_found` like every unadvertised operation (§H). The registry holds no `405` code, so a `405` would carry no registered code, the defect §H removes for `501`.

## Unresolved questions

None open. See §Decisions.

## Implementation notes (non-normative)

- Order on `Active`: registry rows and the `token_budget_exceeded` meaning first, then the schema changes (§G), then the three home sentences. The `budget` and `production` homes follow as their own RFC 0189 PRs.
- `api/v2/openapi.yaml` is generated from the v1 document by `scripts/derive-v2-api.py`, so §G's OpenAPI descriptions and §H's `501` → `404` are derivation rules, not hand edits. A hand edit would be reverted by the next `--write` and fail `--check`.
- MyndHyve's backpressure gate is mounted at `/v1/runs` and `/v1/canvas-types` (`app.ts:322-323`). Whether it gates the unversioned v2 paths was not measured.
- openwop-app answers an expired share link with `not_found` at status `410` (`features/sharing/sharingService.ts:1024`). That is outside the protocol surface, but the pattern ("a registered code at another status") is what `errors.md`'s "answer with the registered status" forbids, and `run_expired` gives it a correct spelling.

## Acceptance criteria

- [x] `Active` (2026-09-28): the comment window was waived by the steward rather than run (see Updated); the unresolved questions are ruled (§Decisions); the rows, the §E meaning, the §G schema and OpenAPI changes, §A and §H in `errors.md`, and `v2-unadvertised-operation-not-found.test.ts` (sabotage-proved) land.
- [x] The three home sentences name codes, and `budget` and `production` are homed (`v1Dependent` falls by two). The first half landed at `Active` (`storage.md`, `host-services.md`, `execution.md`, plus `runs.md` and `replay.md`); the two homes are a follow-up RFC 0189 PR. *(2026-09-29: `budget` and `production` are homed, #1803; `check-v2-normative-home` reports 73 resolved, 0 v1-dependent.)*
- [x] v2 ports of `fs-path-traversal`, `production-backpressure` and `budget-enforcement` exist, and one host's certified bundle records `storage_limit_exceeded` or `egress_denied` `executed-pass`. *(2026-10-01: the ports exist — `v2-fs-sandbox-escape-refused`, `v2-production-backpressure`, `v2-budget-enforcement` — proven against a scratch host, since no host serves either family unaided at major 2. v1's `budget_model_denied` leg is not ported. The certified row is still owed, so the box stays open 2026-10-02: both ports are `executed-pass` on the v2 reference host's certified 2.45.5 cut; that host serves neither `httpClient` nor storage, so the `storage_limit_exceeded` / `egress_denied` row is still owed.)* *(2026-10-02: ticked. The v2 reference host's certified 2.45.6 cut records `egress_denied` `executed-pass` on all five `httpClient.ssrf-*` requirements of `v2-safefetch-ssrf-refused` (openwop-examples #148, #150). `storage_limit_exceeded` has no witness; the box asks for either. Gap G4 still owes a v2 port of `table-schema-enforcement`, which this box does not name.)*
- [ ] The rename rows G1–G3, G6 and G7 are closed by host cuts.

## References

- openwop #1784 (the homing PR that set the codes aside); RFC 0189; RFC 0226 (the model: measured codification, `capability_not_provided`, `node_config_invalid`, `mcp_error`).
- `spec/v2/core/errors.md` §The registry, §Retry timing, §One code per state; `spec/v2/core/overview.md` §0.
- `spec/v1/host-capabilities.md` §host.fs through §host.cache, §host.secrets, §host.queueBus, §host.http; `spec/v1/node-packs.md` (`core.subWorkflow`); `spec/v1/budget-policy.md` §D; `spec/v1/production-profile.md` §Backpressure, §Event retention; `spec/v1/rest-endpoints.md:387`.
- RFC 0197 (Class-3 corrections, R3); RFC 0227 (generated tables outside the budget).
