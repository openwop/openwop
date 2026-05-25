# OpenWOP Spec v1 — JSON Schemas

> **Status: FINAL v1 (2026-05-10).** Hand-authored from prose specs. JSON Schema 2020-12. Validate with Ajv2020 (`require('ajv/dist/2020')`), `python-jsonschema`, or any other 2020-12 implementation. Implementations MAY pin to these schemas; servers MUST accept any JSON document that validates against them.

| Schema | Source spec | Coverage |
|---|---|---|
| `agent-manifest.schema.json` | `node-packs.md` + agent-pack RFCs | Agent manifest entries distributed alongside node-pack manifests |
| `agent-ref.schema.json` | `agent-memory.md` + agent-identity RFC | Multi-Agent Shift Phase 1 — slim runtime AgentRef projection carried on `RunSnapshot.agent` / `runOrchestrator`, `WorkflowNode.agent?`, and `agent.*` event payloads |
| `ai-envelope.schema.json` | `ai-envelope.md` | FINAL v1.1 — inbound LLM-emission envelope. Top-level shape (`type` / `schemaVersion` / `envelopeId` / `correlationId` / `payload` / `meta` / `partial`). Per-kind payload schemas under `envelopes/`. Distinct from `RunEventDoc` (outbound) and `error-envelope.schema.json` (host HTTP errors). |
| `envelopes/clarification.request.schema.json` | `ai-envelope.md` §"Universal kinds" | FINAL v1.1 — payload for the universal `clarification.request` kind; engine lifts to `kind: "clarification"` `InterruptPayload`. |
| `envelopes/schema.request.schema.json` | `ai-envelope.md` §"Universal kinds" | FINAL v1.1 — LLM asks the engine for a kind's JSON Schema. Counts against `Capabilities.limits.schemaRounds`. |
| `envelopes/schema.response.schema.json` | `ai-envelope.md` §"Universal kinds" | FINAL v1.1 — side-channel ack for `schema.request`. Never surfaces to users. |
| `envelopes/error.schema.json` | `ai-envelope.md` §"Universal kinds" | FINAL v1.1 — LLM's deliberate error report. Distinct from `error-envelope.schema.json` (host HTTP errors). |
| `envelopes/media.image.schema.json` | `ai-envelope.md` §"Media reference payloads" | RFC 0055 §C — optional `media.image` payload; tenant-scoped URL ref or inline base64 below `maxInlineMediaBytes`. |
| `envelopes/media.audio.schema.json` | `ai-envelope.md` §"Media reference payloads" | RFC 0055 §C — optional `media.audio` payload; URL ref or inline base64 + optional `durationSeconds`. |
| `envelopes/media.file.schema.json` | `ai-envelope.md` §"Media reference payloads" | RFC 0055 §C — optional `media.file` payload; downloadable asset by URL ref or inline base64 + optional `name`. |
| `annotation.schema.json` | `RFCS/0056` + `observability.md` | RFC 0056 (`Draft`) — a non-blocking human/agent quality signal (rating / correction / label / flag) attached to a run, event, or node. A side-resource (not a replayable run-event-log entry); response of `POST/GET /v1/runs/{runId}/annotations` + payload of the `run.annotated` SSE notification. |
| `annotation-create.schema.json` | `RFCS/0056` | RFC 0056 (`Draft`) — request body for `POST /v1/runs/{runId}/annotations` (host assigns `annotationId`/`createdAt`/`actor`; binds `target.runId` to the path). |
| `workspace-file.schema.json` | `RFCS/0059` + `agent-workspace.md` | RFC 0059 (`Active`) — a versioned, tenant·workspace-scoped ground-truth file (`{path, content, contentType?, version, etag?, updatedAt}`). Response of `GET`/`PUT /v1/host/workspace/files/{path}`; `list` returns this shape minus `content`. Flat `path` namespace; SR-1-redacted content. |
| `workspace-file-create.schema.json` | `RFCS/0059` | RFC 0059 (`Active`) — request body for `PUT /v1/host/workspace/files/{path}` (`{content, contentType?}`; `path` is URL-bound, optimistic concurrency via the `If-Match` header). |
| `audit-verify-result.schema.json` | `auth-profiles.md` §`openwop-audit-log-integrity` | Response payload from `GET /v1/audit/verify` — chain-validity verdict + checkpoints + anomalies |
| `capabilities.schema.json` | `capabilities.md` | `/.well-known/openwop` response — protocolVersion + supportedEnvelopes + schemaVersions + limits + optional v1 discovery surface |
| `channel-written-payload.schema.json` | `channels-and-reducers.md` §Channel write event | Payload of the `channel.written` RunEvent — write input + reducer name |
| `conversation-event.schema.json` | `channels-and-reducers.md` + conversation RFC | Multi-turn conversation event shape for orchestrator-driven HITL flows |
| `conversation-turn.schema.json` | `channels-and-reducers.md` + conversation RFC | Conversation turn shape for user/agent/system messages |
| `core-conformance-mock-agent-config.schema.json` | `node-packs.md` + RFC 0023 | Config shape for the conformance-only `core.conformance.mock-agent` typeId — drives `agent.*` event emission on cue (`mockReasoning` / `mockToolCalls` / `mockHandoff` / `mockDecision` / `mockConfidence`). Hosts MUST refuse this typeId for production tenants unless `capabilities.conformance.mockAgent` is advertised. |
| `credential-reference.schema.json` | `host-capabilities.md` §host.credentials + RFC 0046 | Opaque `{ ref, scope }` handle to a host-stored credential — the only credential artifact on the wire; never carries key material |
| `debug-bundle.schema.json` | `debug-bundle.md` | Portable run diagnostic export from `GET /v1/runs/{runId}/debug-bundle` |
| `dispatch-config.schema.json` | `node-packs.md` + dispatch RFC | Configuration shape for `core.dispatch` / sub-workflow routing |
| `error-envelope.schema.json` | `rest-endpoints.md` + `auth.md` | Canonical `{error, message, details?}` shape returned on every non-2xx |
| `memory-entry.schema.json` | memory-layer RFC | Persisted agent memory entry shape |
| `memory-list-options.schema.json` | memory-layer RFC | Query options for listing agent memory entries |
| `node-pack-manifest.schema.json` | `node-packs.md` | Pack manifest (`pack.json`) — name, version, engines, nodes[], runtime, signing |
| `pack-lockfile.schema.json` | `node-packs.md` §"Dependency resolution + lockfile" | Reproducible-build lockfile pinning resolved pack versions + SHA-256 integrity + Ed25519 signature for the entire workspace dependency graph |
| `prompt-kind.schema.json` | `prompts.md` + RFC 0027 | Shared `string` enum (`system` / `user` / `few-shot` / `schema-hint`) `$ref`-ed by every schema that names a prompt kind. Single edit point when introducing a new kind. |
| `prompt-pack-manifest.schema.json` | `prompts.md` §"Discovery & distribution" + RFC 0028 | Manifest for `kind: "prompt"` registry packs. Peer to `node-pack-manifest.schema.json` (RFC 0003) and `workflow-chain-pack-manifest.schema.json` (RFC 0013); disjoint via the `kind` discriminator. Distributes curated PromptTemplate collections via the same signed-tarball + Ed25519 + SRI pipeline. |
| `prompt-ref.schema.json` | `prompts.md` + RFC 0027 | Reference to a PromptTemplate. `oneOf` accepts the stringy form (`prompt:templateId@version`) or a structured object with `libraryId` / `templateId` / `version` / `variableOverrides`. |
| `prompt-template.schema.json` | `prompts.md` + RFC 0027 | Named, versioned, variable-bound prompt body. Carries `templateId` + SemVer `version` + `kind` (via `prompt-kind.schema.json`) + Mustache `text` + typed `variables[]` + optional `modelHints` + `meta` provenance (incl. RFC 0028 `packName` + `packVersion` when pack-sourced). |
| `registry-version-manifest.schema.json` | `registry-operations.md` | Registry-augmented version manifest served at `GET /v1/packs/{name}/-/{version}.json`. Extends the bare pack-manifest contract with registry-side metadata (integrity hash, signing-block polymorphism, lifecycle flags). Enforced by the `Validate version manifests against registry-version-manifest schema` step in `.github/workflows/registry-publish.yml`. |
| `orchestrator-decision.schema.json` | `node-packs.md` + orchestrator RFC | Decision output shape for orchestrator routing nodes |
| `run-ancestry-response.schema.json` | `multi-agent-execution.md` + RFC 0040 | Response body for `GET /v1/runs/{runId}/ancestry` — names the run's immediate parent in the cross-host composition chain (or `parent: null` for top-level runs). Capability-gated on `capabilities.multiAgent.executionModel.crossHostCausation.ancestryEndpointSupported`. |
| `run-diff-response.schema.json` | `rest-endpoints.md` + RFC 0054 | Response body for `GET /v1/runs/{runId}:diff?against={otherRunId}` — deterministic, replay-aware structured diff of two runs (`divergedAtSeq` + `eventDiffs[]` + `stateDiff`). |
| `run-event-payloads.schema.json` | `run-event.schema.json` §RunEventType | Per-RunEventType payload contracts, indexed by `$defs.<typeId>` for opt-in strict validation |
| `run-event.schema.json` | `version-negotiation.md` + `RunEventDoc` | Event log envelope + event type enum |
| `run-options.schema.json` | `run-options.md` | Per-run input overlay (configurable + tags + metadata) on `POST /v1/runs` |
| `run-orchestrator-decided-event.schema.json` | orchestrator RFC + `observability.md` | Event payload for orchestrator decisions |
| `run-snapshot.schema.json` | `rest-endpoints.md` §RunSnapshot | Projected run state from `GET /v1/runs/{runId}` |
| `security-advisory.schema.json` | `registry-operations.md` + INCIDENT-RESPONSE runbook | Registry-owned CVE advisory record at `registry/security/advisories.json`. One entry per disclosed vulnerability — id, severity, affected pack-name + SemVer range, optional fixedIn/advisoryUrl/credits. Enforced by `check-advisories.mjs` in `.github/workflows/registry-publish.yml`. |
| `suspend-request.schema.json` | `interrupt.md` | `InterruptPayload` with 8 `kind` discriminators (approval, clarification, external-event, custom, conversation.start, conversation.exchange, conversation.close, low-confidence) |
| `workflow-chain-pack-manifest.schema.json` | `workflow-chain-packs.md` + RFC 0013 | Manifest for workflow-chain packs (`kind: "workflow-chain"`) — pre-configured DAG fragments expanded inline at workflow-author time. Peer to `node-pack-manifest.schema.json`; disjoint via the `kind` discriminator. |
| `workflow-definition.schema.json` | `channels-and-reducers.md` + `node-packs.md` | DAG of nodes + edges + triggers + variables + channels |

## Validating against the schemas

### TypeScript / Node

```typescript
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import schema from './run-event.schema.json';

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

if (!validate(myEvent)) {
  console.error(validate.errors);
}
```

### Python

```python
import json
import jsonschema

schema = json.load(open('run-event.schema.json'))
jsonschema.validate(my_event, schema)  # raises ValidationError on failure
```

## Cross-reference

- **Conformance test suite (P2-F4)** — black-box tests that fixture-validate against these schemas.
- **Reference SDKs (P2-F3)** — generate types via `quicktype` or `json-schema-to-typescript`.
- **OpenAPI 3.1 YAML** — references these schemas via `$ref` instead of inlining.

## Open gaps

| # | Gap | Owner |
|---|---|---|
| JS1 | Per-`RunEventType` payload schemas — done (2026-04-26: `run-event-payloads.schema.json` covers all 38 variants in ~15 shape families). Top-level `run-event.schema.json` `payload` stays permissive for forward-compat; consumers MAY pin strict validation via `$defs.<typeId>`. | ✅ |
| JS2 | `Capabilities` schema — done (2026-04-26: `capabilities.schema.json` lifted from `Capabilities.ts`) | ✅ |
| JS3 | `RunOptions` schema (configurable + tags + metadata) — done (2026-04-26: `run-options.schema.json` lifted from `run-options.md`) | ✅ |
| JS4 | Channel-write event payload schema — done (2026-04-26: `channel-written-payload.schema.json` lifted from channels-and-reducers.md §Channel write event) | ✅ |
| JS5 | Error-envelope schema — done (2026-04-26: `error-envelope.schema.json` hoisted from inline OpenAPI) | ✅ |
| JS6 | `RunSnapshot` schema — done (2026-04-26: `run-snapshot.schema.json` hoisted from inline OpenAPI) | ✅ |

## Versioning

Schemas are versioned via `$id` URL (`/spec/v1/`). Breaking changes go to `/spec/v2/`. Non-breaking additions stay on v1 with `$comment` notes documenting added fields.
