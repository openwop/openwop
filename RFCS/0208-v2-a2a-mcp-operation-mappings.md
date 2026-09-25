# RFC 0208: v2 homes the A2A and MCP operation mappings

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0208                                                            |
| **Title**         | v2 homes the A2A and MCP operation mappings                     |
| **Status**        | `Accepted`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-22                                                      |
| **Updated**       | 2026-09-22 — filed, and moved `Draft → Active` in the filing PR. **Comment window waived** by the steward on 2026-09-22 under `GOVERNANCE.md` §"Sole-steward operation" — an explicit **steward override of RFC 0147 §A.6** (precedent: RFC 0194). §A.6 forbids bootstrap waiver language from shortening the window for an RFC of this risk class. The override is outside the `MAINTAINERS.md` waiver grant, and is recorded there as an override, not as a routine waiver. This RFC affects **isolation** (§C: no enumeration of unreadable tasks, `ListTasks` scoping, hints that never select a tenant). Acceptance under this override is provisional, and the §B review is owed (RFC 0156 register, `docs/WAIVER-RETROSPECTIVE-REGISTER.md`). · 2026-09-25 (`Active → Accepted`). **Accepted provisionally**: this RFC was made Active under the steward's override of RFC 0147 §A.6, so its RFC 0156 §B retrospective cross-organization review is still owed (`docs/WAIVER-RETROSPECTIVE-REGISTER.md` row reads `not-reviewed`); acceptance stays provisional until that review is recorded. Evidence tier: tier-1 — the v2 reference host (openwop-examples), a reference example and not a production host; single witness, the certified public push-on v2-reference bundle on published suite 2.39.2 (`evidence/v2-host-bundles/openwop-host-v2-reference.json`, openwop#1558; witness `cb0486af6a39`, 390 executed-pass / 0 blocked, relaxations `[]`, all three profiles certified, RFC 0158 rung `durable-single-instance`). The one row an earlier bundle lacked, `0208.a2a-unreadable-not-found`, was masked by a suite defect (an `it()` citing two ids records only the last) fixed in openwop#1555. |
| **Affects**       | `spec/v2/core/interop.md` (new §"The operation mappings"; one sentence of §"The MCP round ceiling" replaced), `spec/v2/core/capabilities.md` §3.1 and §3.2 (one sentence each), new `spec/v2/interop-map.json` and `spec/v2/interop-map.schema.json`, `scripts/generate-from-declaration.mjs` (`implementation` metadata schema, which regenerates `schemas/v2/capabilities.schema.json`), new `scripts/check-interop-map.mjs`, `spec-artifacts/**` (regenerated), conformance (three new major-2 scenarios), `spec/v1/a2a-integration.md` and `spec/v1/mcp-integration.md` (one informative pointer each) |
| **Compatibility** | `additive` per `COMPATIBILITY.md` — §4 "new normative requirement on a previously-undefined behavior", plus one optional property on a closed metadata object (RFC 0183/0186/0188 precedent) |
| **Supersedes**    | — (amends RFC 0152 and RFC 0153 by giving their §C/§D and §B–§E mappings a v2 home; each gains an `Amended by` row) |
| **Superseded by** | —                                                               |

## Summary

v2 declares the `a2a` and `mcp` families, and their normative home is `spec/v2/core/interop.md`. That document covers facets, negotiation, the floor and the refresh SLA. It does not map a single A2A operation or MCP method onto the v2 wire. The mapping lives only in `spec/v1/a2a-integration.md` §C–§D and `spec/v1/mcp-integration.md` §B–§E, and it stops being operative at v1 end-of-support (not before 2026-12-04). This RFC moves the tables into a machine-checked registry, `spec/v2/interop-map.json`, which `interop.md` incorporates normatively. It re-pins the A2A rows to A2A 1.0.1. It adds the upstream rules v1 never stated: contextId/taskId mismatch is refused, contextId is inferred from the task, and a retained terminal task answers `UnsupportedOperationError` while a purged one answers `TaskNotFoundError`. It also adds a breaking-change rule for extension keys, and an informational `implementation.url` field with a non-reliance SHOULD.

## Motivation

The gap was found in architect review P1, finding 4 (`review/arch-P1.md`). In `spec/v2/declaration.json`, `a2a.normativeText` and `mcp.normativeText` are both `["spec/v2/core/interop.md"]`. `check-v2-normative-home.mjs` counts both families as resolved, but only because the file exists. Read, rather than grepped, `interop.md` defines no operation, no state projection, no field rule and no error mapping. This is what disappears at v1 end-of-support:

| v1 text | Content | v2 today |
| --- | --- | --- |
| `a2a-integration.md` §C | Agent Card projection, the JSON-RPC interface floor, the extended card | — |
| `a2a-integration.md` §D.1–D.7 | 11 operations, the Message/Part/Artifact/Task/StreamResponse field rules, the TaskState bijection, the 9-row error table | — |
| `a2a-integration.md` §E | no enumeration; `tenant` is a hint; `ListTasks` scoping | — (`interop.md` §Threat model names "cross-tenant lookup through a peer" and nothing more) |
| `mcp-integration.md` §A `features` | `server-discover`, `mrtr`, `cacheable-lists`, `extensions` and which the current profile requires | the facet is `items: string`, with no vocabulary |
| `mcp-integration.md` §B–§E | no session; header/body agreement; `server/discover`; the MRTR tables in both directions; `requestState` binding; `cacheScope`; extensions are opaque; authentication at the boundary | "The v1 `requestState` requirements carry over unchanged" — a pointer into v1 |

Three upstream facts make it worse than a copy job:

1. **A2A 1.0.1 (2026-05-28) re-mapped six HTTP+JSON and gRPC error rows.** The JSON-RPC codes did not change. A v2 table copied from v1 would be wrong on arrival (`review/verify-CD.md` C-F1).
2. **A2A §3.4.3 has two MUSTs that no OpenWOP text states:** "Agents MUST infer `contextId` from the task if only `taskId` is provided" and "Agents MUST reject messages containing mismatching `contextId` and `taskId`" (C-F13).
3. **v1 D.2 answers a message to a terminal task with `TaskNotFoundError`.** A2A §3.1.1 lists `UnsupportedOperationError` for exactly that case, and reserves `TaskNotFoundError` for a task that "does not exist or is not accessible". openwop-app already answers `UNSUPPORTED_OPERATION` (`backend/typescript/src/host/a2aServer10.ts:162-163`) (C-F12).

`ListTasks` has a v2 target that v1 lacked. RFC 0182 `listRuns` exists, and v1 cited a `GET /v1/runs` that no OpenAPI defines (C-F6). The capabilities `extensions.<org>.<name>` key has no rule for what happens when an extension's contract breaks (verify-AB B-F6). `implementation` carries no provider URL and no statement that clients must not key behaviour on it (B-F8).

## Proposal

### §A The registry

`spec/v2/interop-map.json` (schema `spec/v2/interop-map.schema.json`) holds the normative rows. Each row is keyed by an upstream element and names the v2 operation that serves it, or `null`. Groups:

| Group | Rows | From |
| --- | --- | --- |
| `pins` | the A2A release (`1.0.1`, negotiated as `1.0`) and the MCP revision (`2026-07-28`), each with its source URL | new |
| `a2a.operations` | 12 rows: SendMessage in its four `taskId` cases, SendStreamingMessage, GetTask, ListTasks → `listRuns`, CancelTask, SubscribeToTask, the push-config CRUD, GetExtendedAgentCard | v1 §D.1, D.2, D.6 |
| `a2a.card` | 7 rows: interfaces and the JSON-RPC floor, capabilities, skills, security schemes, provider, tenant, signatures | v1 §C |
| `a2a.taskState` / `taskStateReverse` | the forward projection (one default row per `RunSnapshot.status`; a row keyed by `interruptKind` may override a default, and RFC 0199 adds the only one), and the reverse projection | v1 §D.4 |
| `a2a.errors` | 9 A2A errors at **1.0.1** (JSON-RPC, gRPC, HTTP), each with the server condition and the client projection into `spec/v2/errors.json`, plus the invalid-parameters row §D uses | v1 §D.7, re-pinned |
| `a2a.fields` | Message, Part, Artifact, Task.history/metadata, StreamResponse, error-message rules | v1 §D.2, D.3, D.5, D.7 |
| `mcp.features` | the four feature ids, with `requiredFor: ["mcp-2026-07-28"]` on three | v1 §A |
| `mcp.methods`, `headers`, `meta`, `mrtr`, `cache`, `authorization` | the current-profile rules | v1 §B–§E |

The full draft is in the companion implementation plan (not committed with this RFC). `scripts/check-interop-map.mjs` validates the file against its schema and checks four things. Every `v2Operation` is an `operationId` in `api/v2/openapi.yaml`. Every `clientProjection` is a code in `spec/v2/errors.json`. `a2a.taskState` covers every `RunSnapshot.status` value exactly once as a default row, with at most one override per `(status, interruptKind)`. Every `requires` entry is a property of `spec/v2/facets/<family>.schema.json`.

**Rows another RFC owns.** Five sibling RFCs filed with this one extend or amend the registry. Each owns its rows, and each lands in its own spec PR after this RFC's:

| Rows | Owning RFC | What it does to the map |
| --- | --- | --- |
| `mcp.mrtr` InputRequiredResult (host as server): the credential and URL-mode clauses; `a2a.taskState` `(waiting-input, credential) → auth-required`; the `TASK_STATE_AUTH_REQUIRED` reverse note | RFC 0199 §D | This RFC ships form mode only for a flat, non-secret schema (an upstream MUST). Every credential and authorization-required row is RFC 0199's, and this RFC maps no credential interrupt |
| `pins.mcpTasks`, `mcp.tasks` | RFC 0198 | adds the group |
| `mcp.authorization`: the mount's Protected Resource Metadata | RFC 0200 §A.4 | adds a row |
| `mcp.meta` `traceparent \| tracestate \| baggage` | RFC 0207 | points the row at `interop.md` §Trace context |
| `a2a.card` `supportedInterfaces[].tenant`, for per-agent routing values | RFC 0202 | prose in `interop.md` §Per-agent cards; the row points to it |

### §B Incorporation

New `interop.md` §"The operation mappings":

> `spec/v2/interop-map.json` (schema `interop-map.schema.json`) maps each profile's upstream operations, states, fields and errors to the v2 wire, pinned to an upstream release. A host advertising a profile MUST serve every row it implements as the row states, under the caller's Subject with the authorization, tenant scoping and state of the v2 operation the row names; MUST refuse a row whose `requires` facet it does not advertise with the row's error; and MUST list every feature the map requires for that profile. What the map does not name is opaque: it MUST round-trip where upstream requires it and MUST NOT become authority, a prompt segment, a tool call or a workflow variable. A patch release that re-maps a row is a map edit; patch numbers are never negotiated.

"Patch numbers are never negotiated" restates A2A 1.0.1 §3.6: patch versions "MUST not be considered when clients and servers negotiate protocol versions". An upstream patch that re-maps a row, as 1.0.1 did, is a map edit shipped in a suite minor. It is not a new profile.

In §"The MCP round ceiling", the sentence "The v1 `requestState` requirements carry over unchanged." becomes "The `requestState` rules are the map's `mcp.mrtr` rows."

### §C Isolation

> **Isolation.** On either interface, a task the caller could not read through `getRun` MUST be answered exactly as a nonexistent one, including a tenant mismatch REST refuses `403`. `ListTasks` MUST return only runs `listRuns` would return to the same Subject, whether or not `runList` is advertised. `contextId`, `tenant` and `_meta` never select a tenant, workspace or principal.

On REST, a foreign tenant segment is `403 id_tenant_mismatch` (identity.md §5). On A2A, upstream requires that servers "MUST NOT reveal the existence of resources the client is not authorized to access" and "SHOULD NOT distinguish between 'does not exist' and 'not authorized'" (A2A 1.0.1 §3.3.2). The map therefore gives one answer for every unreadable task: `TaskNotFoundError` on A2A, and `-32602` on an MCP task surface (RFC 0198). `ListTasks` binds to `listRuns`'s *set* even on a host that does not advertise `runList`. The alternative is that a host without the facet has no scoping rule at all, and A2A §13.1 still requires one.

### §D A2A multi-turn and terminal tasks

> **A2A multi-turn (A2A §3.4.3).** A message carrying `taskId` without `contextId` MUST be answered with the task's `contextId`. A message whose `contextId` is not its task's MUST be refused with its binding's invalid-parameters error and MUST NOT change the run. A message to a retained terminal task MUST be refused `UnsupportedOperationError`; `TaskNotFoundError` is for unknown, purged and unreadable tasks.

Upstream names no error code for the mismatch. The refusal is a validation error, which A2A §3.3.2 illustrates as JSON-RPC `-32602`, HTTP `400` and gRPC `INVALID_ARGUMENT`. The map's `a2a.errors` carries that row. "Retained" means the run is still readable through `getRun`. After purge, `TaskNotFoundError` is correct, because upstream's own definition reads "…or already completed and purged" (§3.3.2).

### §E The error map at A2A 1.0.1

The `a2a.errors` rows use the A2A 1.0.1 §5.4 table:

| A2A error | JSON-RPC | gRPC | HTTP | v1 §D.7 said |
| --- | --- | --- | --- | --- |
| `TaskNotFoundError` | -32001 | NOT_FOUND | 404 | same |
| `TaskNotCancelableError` | -32002 | FAILED_PRECONDITION | **400** | 409 |
| `PushNotificationNotSupportedError` | -32003 | **FAILED_PRECONDITION** | 400 | UNIMPLEMENTED |
| `UnsupportedOperationError` | -32004 | **FAILED_PRECONDITION** | 400 | UNIMPLEMENTED |
| `ContentTypeNotSupportedError` | -32005 | INVALID_ARGUMENT | **400** | 415 |
| `InvalidAgentResponseError` | -32006 | INTERNAL | **500** | 502 |
| `ExtendedAgentCardNotConfiguredError` | -32007 | FAILED_PRECONDITION | 400 | same |
| `ExtensionSupportRequiredError` | -32008 | FAILED_PRECONDITION | 400 | same |
| `VersionNotSupportedError` | -32009 | **FAILED_PRECONDITION** | 400 | UNIMPLEMENTED |

The v1 table is corrected separately, as Phase 2 item P2-b. This RFC does not edit v1's table.

### §F Extension keys

New sentence in `capabilities.md` §3.2:

> A change to an extension that would break an existing reader MUST ship under a new key; a host MUST NOT read one key's record as another's (A2A §4.6.3).

Two upstreams already state this rule. A2A 1.0.1 §4.6.3 says "A new URI MUST be created for breaking changes to an extension … It MUST NOT fall back to a previous version of the extension automatically". The MCP extensions overview says "If a breaking change is unavoidable, use a new identifier". The version is not required inside the key: the v2 key grammar `<org>.<name>` stays as it is, and a new name serves (`vendor.thing` → `vendor.thing-2`).

### §G `implementation`

`implementation` gains an optional `url` (`format: uri`). This is the operator's site, the field A2A calls `AgentProvider.url` and MCP calls `Implementation.websiteUrl`. New sentence in `capabilities.md` §3.1:

> `implementation` (`name`, `version`, `vendor`, `url`) is self-reported: a client SHOULD NOT change behaviour because of it or authorize from it.

This follows MCP's `serverInfo` text, which says it is "intended for display, logging, and debugging. Clients SHOULD NOT use it to change their behavior, and SHOULD NOT rely on it for security decisions". The schema change is made in `metadataSchema()` of `scripts/generate-from-declaration.mjs`:

```diff
+    case 'implementation': return {
+      type: 'object', additionalProperties: false,
+      description: 'RFC 0208 §G — self-reported server identity; informational (capabilities.md §3.1).',
+      properties: {
+        name: { type: 'string' }, version: { type: 'string' }, vendor: { type: 'string' },
+        url: { type: 'string', format: 'uri', description: 'The operator\'s site (A2A AgentProvider.url, MCP Implementation.websiteUrl). Informational.' },
+      },
+    };
```

### Examples

**Positive.** A peer calls `SendMessage { message: { taskId: "acme~2Fr-9f3c…", role: ROLE_USER, parts: [{ text: "approve" }] } }` on a run in `waiting-approval`. The message carries no `contextId`. The interrupt resolves (`resolveInterruptByRun`), and the answered `Task.contextId` equals the one persisted in `A2ATaskState.contextId`.

**Negative.**
- The same message carrying `contextId: "ctx-other"` is refused `-32602` and appends no event.
- `SendMessage` with the `taskId` of a `completed`, retained run answering `-32001` violates §D, which requires `-32004`.
- A `GetTask` for another tenant's `taskId` answering anything other than the exact `TaskNotFoundError` a nonexistent id gets violates §C.
- An `interop-map.json` whose `a2a.taskState` omits `paused` fails `check-interop-map.mjs`.

## Compatibility

**Additive.** Clause by clause:

- **§A/§B.** New normative text for behaviour v2 left undefined. `interop.md` maps no operation today, so COMPATIBILITY §4's last row applies. No committed v2 bundle serves an A2A interface or an MCP server mount. v2-reference advertises `a2a` and `mcp` only for seam-driven negotiation: it has no `agentCardUrl`, no `profiles` and no `serverMount`. MyndHyve and openwop-app advertise neither family at major 2. "Serve every row it implements" binds no host today.
- **§C.** The same row of §4, for v2. Every clause restates a v1 §E MUST, or A2A §3.3.2/§13.1.
- **§D.** New in v2. Framed under §4's "previously-undefined" row, not "stricter validation", because v2 has no A2A message rule for the change to tighten. The mismatch rule restates upstream §3.4.3.
- **§E.** v2 has no error table today (P1 finding 2), so adopting 1.0.1 changes no v2 behaviour.
- **§F.** A new MUST on how an extension key evolves. It relaxes nothing, and a host that has never broken an extension is unaffected.
- **§G.** An optional property on the closed `implementation` object. Every document valid before is valid after (the 0183/0186/0188 precedent), and the SHOULD NOT is new.

**The dual-major hazard.** An A2A endpoint is not versioned by OpenWOP major. A host serving v1 and v2 from one A2A interface is bound by v1 §D.2 (`TaskNotFoundError` for a terminal task) and by v1 §D.7 at 1.0.0, and also by this RFC's §D and §E. The two cannot both be met. The Phase 2 correction P2-b (terminal → `UnsupportedOperationError`, table re-pinned to 1.0.1, with a dual-accept rule for clients and a COMPATIBILITY §3 entry) therefore **MUST merge before or with this RFC's spec PR**. This is gap G2.

**Release coupling.** `interop.md`, both new JSON files and the regenerated `schemas/v2/capabilities.schema.json` ship inside `@openwop/spec-artifacts`. The spec PR needs a spec-artifacts bump, the peer pin and a suite minor, and publishing is the steward's call (`review/arch-P1.md` HIGH 1).

**Core word budget.** The change adds +297 core words (interop.md +248, capabilities.md +49) and homes no family, so the net is **+297**. Neither `a2a` nor `mcp` is a v1-dependent family, and no adjacent v1-dependent family is small enough to home as an offset (see G5). The registry holds about **1,470 words** of normative row text in `.json`, which `check-core-budget.mjs` does not measure. `errors.json` and `event-codemap.json` set this precedent: row-shaped normative data lives in a registry and the prose incorporates it. The number is disclosed so reviewers can reject the choice (UQ1). **Cumulative budget.** The thirteen RFCs filed with this one (0197–0209) net about +1,960 core words together, against 1,716 words of headroom measured on 2026-09-22 (27,284 / 29,000). Their spec PRs are therefore budget-ordered: each re-runs `check-core-budget.mjs` on the merged tree, and the editorial trim of the low-risk tier (about 2,500 words, steward decisions log D2) lands before whichever spec PR would cross the cap. No cap raise is proposed.

## Conformance

A scenario may not cite a `Draft` RFC (`check-rfc-status-coherence.mjs` rule 7). All three scenarios target major 2 and stay out of every `floorScenarios` list.

- **`v2-a2a-operation-map.test.ts`**. Gated on `a2a.profiles ∋ a2a-1.0` and `agentCardUrl` present, that is, a host serving an A2A interface. It drives the JSON-RPC binding against the advertised fixtures `conformance-approval` (skill id = workflowId) and `conformance-noop`. Legs: context inferred; mismatch refused with no state change; retained-terminal `-32004`; unknown and foreign-tenant `taskId` answered identically; the state projection read back through `getRun`; `CancelTask` on a terminal run (`-32002`); a cross-caller `ListTasks` leg (needs `OPENWOP_TEST_TENANT_B_API_KEY`, a second-tenant credential, else `blocked`).
- **`v2-mcp-mount-map.test.ts`**. Gated on `mcp.serverMount` and `mcp.profiles ∋ mcp-2026-07-28`. It checks four things. `server/discover` `supportedVersions` equals `mcp.revisions`. The required features are listed. `tools/call` on `conformance-failure` answers `CallToolResult { isError: true }`, not a JSON-RPC error. `run.started.transport` is `mcp`. The existing v1 legs (discover, stateless, MRTR, cache scope, extension opacity, auth boundary) are **ported** here as v2 twins. They cannot join `BOTH_MAJORS`, because they gate on `.supported` seats that do not exist at major 2 (`generate-scenario-majors.mjs:61`).
- **`v2-implementation-informational.test.ts`**. Server-free. It checks that `implementation.url` validates against the generated v2 capabilities schema, and that an unknown `implementation` key still fails.
- **Corpus gate** `scripts/check-interop-map.mjs`, wired into `openwop:check`.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A the map is coherent with the v2 wire | `openwop.requirement.0208.map-coherent`: the gate's exit status. Sabotage: delete the `paused` taskState row, or rename a `v2Operation` | the corpus, unaided | witnessable — unaided (corpus) |
| §B a row is served as stated | per row, below; `requires` refusal: `openwop.requirement.0208.row-requires-refused` (`SubscribeToTask` on a host with `streaming: false` → `-32004`) | the suite, unaided | witnessable — gated on the A2A interface |
| §B required features listed | `openwop.requirement.0208.mcp-features-required`: `mcp.features ⊇ {server-discover, mrtr, cacheable-lists}` when the profile is claimed | any host | witnessable — unaided (discovery) |
| §C unreadable task = nonexistent | `openwop.requirement.0208.a2a-unreadable-not-found`: a `GetTask` for a fabricated same-tenant id and one for a foreign-tenant id return the same `-32001` body, modulo id. Sabotage: a host answering `403`/`-32603` for the foreign id | the suite, unaided (it forges the tenant segment) | witnessable — gated on the A2A interface |
| §C `ListTasks` scoped as `listRuns` | `openwop.requirement.0208.a2a-list-scoped`: a task created under credential A is absent from B's `ListTasks`. Sabotage: an unscoped list | the suite, with a second credential | witnessable — gated on `OPENWOP_TEST_TENANT_B_API_KEY` (`blocked` without it) |
| §C hints never select | the same leg, with B sending `tenant: <A's tenant>` | the suite, with a second credential | witnessable — same gate |
| §D contextId inferred | `openwop.requirement.0208.a2a-context-inferred`: the answered `Task.contextId` equals the task's. Sabotage: a fresh contextId minted | the suite, unaided | witnessable — gated on the A2A interface + `conformance-approval` |
| §D mismatch refused, run unchanged | `openwop.requirement.0208.a2a-context-mismatch-refused`: `-32602`, then `getRun` status and event count unchanged. Sabotage: the interrupt resolves | the suite, unaided | witnessable — same gate |
| §D retained terminal → `UnsupportedOperationError` | `openwop.requirement.0208.a2a-terminal-unsupported`: `-32004` on a completed `conformance-noop` task. Sabotage: `-32001` (today's v1 text) | the suite, unaided | witnessable — gated on the A2A interface |
| §D purged → `TaskNotFoundError` | — (the suite cannot purge a run) | operator | **unwitnessable** — a black box cannot cause a purge; the negative (`-32001` for a *retained* task) is witnessed above |
| §E the 1.0.1 codes | `openwop.requirement.0208.a2a-error-codes`: the JSON-RPC codes the suite can cause (-32001, -32002, -32004, -32009, -32602); HTTP+JSON statuses when that interface is listed | the suite, unaided | witnessable — the gRPC column is unwitnessable (the suite ships no gRPC client; `interop.md` §gRPC) |
| §F new key on a breaking change | — (a black box cannot compare one key's semantics over time) | the extension's author | **unwitnessable** — a claim about authorship. Recorded as UQ3 |
| §G `url` shape | `openwop.requirement.0208.implementation-shape`: the schema accepts `url` and rejects an unknown key | the suite, unaided (server-free) | witnessable — unaided |
| §G clients SHOULD NOT key on it | — | clients | unwitnessable — a SHOULD NOT on consumers |

## Review record (RFC 0147 §A.2)

RFC 0152 and RFC 0153 are RFC 0147 children (SR-6), so this amendment carries the five-lens pass before `Active`:

| Lens | Outcome |
| --- | --- |
| Spec | v2 text limited to rules that are not row-shaped; the tables go to the registry; one normative home (`interop.md`) is kept; v1 is not edited beyond two informative pointers |
| Schema | New data schema, following the `event-codemap.schema.json` precedent; `implementation.url` optional on a closed object; generator-sourced, not hand-edited |
| Security | §C restates v1 §E and A2A §3.3.2/§13.1; no new invariant (the architect said none); the existing invariants `a2a-peer-no-authority-escalation`, `mcp-cache-tenant-scoped` and `mcp-extension-no-authority` gain major-2 tests |
| Conformance | Three major-2 scenarios, each row with a named sabotage; two unwitnessable rows stated |
| Compatibility | Additive under §4's last row; the dual-major hazard is sequenced behind P2-b (G2) |

## Alternatives considered

1. **Copy v1 §C–§E prose into `interop.md`.** This is the most direct home. The v1 source is 5,963 words, measured on 2026-09-22 (a2a §C–§E: 3,413; mcp §A–§E: 2,550). Even condensed by half, that is more than the 1,725 words of headroom every Phase 3 RFC shares, so it cannot land. It would also freeze the 1.0.0 error table into v2.
2. **List the v1 documents in `a2a.normativeText` and `mcp.normativeText`.** Zero words. It makes both families v1-dependent, which lowers the cap by 400 and grows the ratchet `check-v2-normative-home.mjs` forbids from growing. The text still dies at end-of-support.
3. **An `ext/` page that no core family cites.** Uncounted, but RFC 0190 closed exactly this route ("a family's entire contract could move to `ext/` and resolve at zero budget cost"). It would also demote isolation MUSTs to an extension that sits outside the core profile.
4. **Do nothing.** At v1 end-of-support, a host that advertises `a2a` or `mcp` has no operative mapping. Every A2A or MCP interop claim becomes unfalsifiable.

## Unresolved questions

1. **Should `check-core-budget.mjs` count registry `rule` strings?** About 1,470 words of normative text sit in `.json`. **Decided 2026-09-22 (steward decisions log D7): no.** `overview.md` principle 4 says registers are data, and `errors.json` and `event-codemap.json` are the precedent. The condition is that the registry has a schema and a gate (`interop-map.schema.json`, `check-interop-map.mjs`), and that core prose points to the rows and never duplicates their text. The RFC 0156 §B review may still reopen it (G1).
2. **Should `listRuns` gain a `contextId` filter facet**, so `ListTasks` maps onto a REST filter instead of host-internal state (C-F6)? Deferred: additive, and it can follow.
3. **Is §F worth a MUST it cannot witness?** The alternative is a SHOULD. Kept as a MUST, because both upstreams state it as one, and an unwitnessable MUST is permitted when recorded.
4. **Should `a2a.card` `provider.url` be required to equal `implementation.url`?** Left at SHOULD: an operator's A2A provider may legitimately be a parent organization.

## Implementation notes (non-normative)

- **Amended in place at `Active`, 2026-09-23 (RFC 0174 §A.4; RFCS/README §"When a correction needs a new number").** The `SubscribeToTask` row's `http` column reads `POST /tasks/{id}:subscribe`, matching the A2A v1.0.1 specification prose (§5.3, §11.3.2) and both reference SDK clients, but the proto that §1.4 makes normative binds `get: "/tasks/{id=*}:subscribe"`. The row now records the conflict and adds that a host listing an HTTP+JSON interface SHOULD accept both verbs; `scripts/check-interop-map.mjs` checks every A2A row's `http` value against the vendored proto and names this row as its one documented exception. No host could have relied on the old text: no host lists an HTTP+JSON interface, and the `a2a-1.0` profile requires only JSON-RPC.

- **Sequencing.** P1-A (the `:379` cite) and P2-b (openwop#1481: the v1 error re-pin and terminal correction) land first. This RFC's spec PR follows, riding the first spec-artifacts bump that follows. The spec PRs of RFC 0198 (`mcp.tasks`, `pins.mcpTasks`), RFC 0199 (the credential rows), RFC 0200 (the mount PRM row), RFC 0202 and RFC 0207 edit the same file, so each is ordered after this one.
- **Witness.** No v2 host serves an A2A interface or an MCP server mount. The shortest path is **openwop-app**: its v1 `a2aServer10.ts` and `routes/mcp.ts` already exist, and the terminal case already conforms. It needs to advertise `a2a` (with `agentCardUrl` and `profiles`) and `mcp.serverMount` at major 2. v2-reference is the alternative and has to build both. Details are in the implementation plan.
- The dual-major hazard (G2) is the one sequencing constraint that affects correctness rather than convenience.

## Acceptance criteria

- [x] `Active` — 2026-09-22, by steward override of RFC 0147 §A.6. The window was waived, not run (see `Updated`).
- [x] P2-b (openwop#1481, the v1 correction) merged first, or in the same PR (G2). — merged 2026-09-22 before the spec PR; G2 `closed`.
- [x] Spec text merged: `interop.md` §"The operation mappings", `capabilities.md` §3.1/§3.2, `interop-map.json` and its schema, the `implementation` generator case, with `check-interop-map.mjs` in `openwop:check`. — openwop#1492 (2026-09-22): `interop.md` §"The operation mappings", `capabilities.md` §3.1/§3.2, `spec/v2/interop-map.json` + `interop-map.schema.json`, the `implementation` case in `generate-from-declaration.mjs`, and `check-interop-map` wired into `scripts/openwop-check.sh`.
- [x] `@openwop/spec-artifacts` and a suite minor published carrying the three scenarios (after `Active`; never before). — Publication verified 2026-09-24 against the PUBLISHED tarball, not the checkout: `npm pack @openwop/openwop-conformance@2.37.0` carries `v2-a2a-operation-map.test.ts`, `v2-implementation-informational.test.ts` and `v2-mcp-mount-map.test.ts`; `@openwop/spec-artifacts@2.37.0` is published and exact-pinned by the suite. The RFC went `Active` 2026-09-22, before publication, so the ordering the box requires held.
- [x] A committed, certified v2 bundle from at least one host carries every witnessable row above at `executed-pass`, strict mode, with nothing relaxed (RFC 0147 §A.5). The `a2a-list-scoped` row needs the second credential. — the certified public push-on v2-reference bundle on published suite 2.39.2 (`evidence/v2-host-bundles/openwop-host-v2-reference.json`, openwop#1558; witness `cb0486af6a39`, 390 executed-pass / 0 blocked, relaxations `[]`, all three profiles certified, RFC 0158 rung `durable-single-instance`): all nineteen `0208.*` rows `executed-pass`, including `.a2a-list-scoped` with the second credential and `.a2a-unreadable-not-found`.
- [x] `Amended by` rows added to RFC 0152 and RFC 0153; CHANGELOG entry; the RFC 0156 §B register row added (`not-reviewed`). — the rows and the CHANGELOG entry land with the spec PR; the register row landed at filing (`docs/WAIVER-RETROSPECTIVE-REGISTER.md`, `not-reviewed`).

## References

- A2A 1.0.1: `docs/specification.md` §3.1.1, §3.1.4–3.1.6, §3.3.2, §3.4.1–3.4.3, §3.6, §4.6.3, §5.4, §13.1 — <https://github.com/a2aproject/A2A/blob/v1.0.1/docs/specification.md>; `a2a.proto` `AgentProvider`, `ListTasksRequest` — <https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto> (both fetched 2026-09-22).
- MCP 2026-07-28: `schema.ts` `Implementation` and the `serverInfo`/`clientInfo` notes — <https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts>; extensions overview §Evolution — <https://modelcontextprotocol.io/extensions/overview>; `basic/versioning` §Extension Negotiation (fetched 2026-09-22).
- RFC 0152, RFC 0153 (amended); RFC 0182 (`listRuns`); RFC 0189/0190 (normative home, budget); RFC 0147 §A.2/§A.5/§A.6; RFC 0156 §B; RFC 0194 (override precedent).
- `review/arch-P1.md` finding 4; `review/arch-P3.md` P3-M1 (η-b); `review/verify-AB.md` B-F6, B-F8; `review/verify-CD.md` C-F1, C-F6, C-F12, C-F13.
