# openwop Spec v1 — Host Capability Surfaces

> **Status: FINAL v1 (2026-05-12).** Promoted DRAFT → FINAL after Phase B audit confirmed all 14 `host.*` capability sections are internally consistent + RFC 2119-clean + cross-linked to `capabilities.md` §"runtimeCapabilities" + `node-packs.md` §"Manifest format" `peerDependencies`. Normative contracts for the `host.*` capabilities that node-pack `peerDependencies` may declare. A pack that declares `peerDependencies: { "host.canvas": "supported" }` consumes the canvas surface defined here; the host that advertises `host.canvas: supported` in `/.well-known/openwop` MUST expose the contract specified in §host.canvas. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). See `auth.md` for the status legend.

---

## Why this exists

`node-packs.md` §"Manifest format" allows packs to declare `peerDependencies` against engine-supplied capabilities. `host-extensions.md` documents the namespace rule that `host.*` is reserved for host-extension capabilities. Neither document specifies the **contracts** those capabilities expose.

This document does. Each `§host.<name>` section below defines a normative ctx surface — the methods, signatures, return shapes, and failure modes that any host advertising the capability MUST implement.

External hosts implementing openwop use this document to know exactly what to wire up. Pack authors use it to know what's safe to call. The conformance suite tests against it (gated per-capability via the corresponding profile).

---

## The contract pattern

Every `host.*` capability follows the same wire pattern:

1. **Discovery.** The host advertises `host.<name>: { supported: true, ... }` in `/.well-known/openwop`'s `agents` block or top-level (per `capabilities.md` §"Network-handshake shape" extension rules).
2. **Registration.** The pack registry refuses to register a pack at `workflow-register` time if the host doesn't advertise the pack's declared `peerDependencies` capabilities.
3. **Dispatch.** At node execution, the executor reads from `ctx.<name>.<method>(...)`. The host has wired the named property to a method that satisfies this spec.
4. **Failure.** If `ctx.<name>` is absent (host advertised but didn't wire), or the named method is missing, executors MUST throw with `error.code = "host_capability_missing"` and `error.capability = "host.<name>"` (or `"host.<name>.<method>"` for granular misses).

Method signatures use TypeScript-flavor shapes; concrete hosts MAY return additional fields (additive). The required field set is what's listed below.

---

## §host.aiEnvelope

**Capability flag:** `host.aiEnvelope: supported`

**Used by:** `vendor.myndhyve.ai`, `vendor.myndhyve.brand`, `vendor.myndhyve.web-research`

Generates a typed envelope from an LLM call. Routes the call through the host's BYOK provider layer (see `host.aiEnvelope` vs the lower-level `aiProviders` capability — this surface is opinionated about envelope shape, that one returns raw model output).

```typescript
ctx.aiEnvelope.generate({
  systemPrompt: string,
  envelopeType: string,        // e.g., "prd.create", "theme.create"
  provider?: string,           // anthropic | openai | google | ...
  model?: string,
  temperature?: number,
  maxTokens?: number,
  userMessage?: string,
  variables?: Record<string, unknown>,
  context?: Record<string, unknown>,
  idempotencyKey: string,
}) → Promise<{
  envelopeType: string,
  payload: Record<string, unknown>,     // envelope-typed payload
  envelopeId: string,
  usage?: { inputTokens: number, outputTokens: number },
  model?: string,
}>

ctx.aiEnvelope.await({
  envelopeType: string,
  timeoutMs: number,
}) → Promise<{
  envelopeType: string,
  payload?: Record<string, unknown>,
  envelopeId?: string,
  timedOut?: boolean,
}>
```

**Required methods:** `generate`. `await` is required only when the host advertises `host.aiEnvelope.await: supported`.

**Failure modes:**
- `host_capability_missing` — `ctx.aiEnvelope` absent
- `provider_unavailable` — provider rejected or unreachable
- `provider_quota_exhausted` — BYOK quota / rate limit
- `envelope_validation_failed` — provider returned non-matching shape after retries

---

## §host.promptLibrary

**Capability flag:** `host.promptLibrary: supported`

**Used by:** `vendor.myndhyve.ai` (specifically `core.ai.callPrompt`)

Looks up a prompt by ID. Pin to a specific version for replay determinism.

```typescript
ctx.promptLibrary.get(promptId: string) → Promise<{
  promptId: string,
  systemPrompt: string,
  version: string,
  envelopeType?: string,        // when the prompt is bound to a specific envelope
}>
```

**Required methods:** `get`.

**Failure modes:**
- `host_capability_missing` — `ctx.promptLibrary` absent
- `prompt_not_found` — promptId doesn't resolve
- `prompt_version_pinned` — pin requested but not retrievable

---

## §host.canvas

**Capability flag:** `host.canvas: supported`

**Used by:** `vendor.myndhyve.canvas`

Reads + writes canvas state. Routes through host's canvas store (typically Firestore on MyndHyve; arbitrary on other hosts).

```typescript
ctx.canvas.read({
  canvasId: string,
  paths?: string[],             // optional jsonpath-like field selection
}) → Promise<{
  canvasId: string,
  canvasTypeId: string,
  state: Record<string, unknown>,
  version: string,
}>

ctx.canvas.write({
  canvasId: string,
  patch: Record<string, unknown>,
  patchType: 'merge' | 'replace',
  idempotencyKey: string,
}) → Promise<{
  canvasId: string,
  version: string,
  appliedAt: string,            // ISO 8601
}>

ctx.canvas.create({
  canvasTypeId: string,
  workspaceId: string,
  projectId?: string,
  initialState?: Record<string, unknown>,
  idempotencyKey: string,
}) → Promise<{
  canvasId: string,
  canvasTypeId: string,
  createdAt: string,
}>

ctx.canvas.crossInvoke({
  sourceCanvasId: string,
  targetCanvasTypeId: string,
  message: Record<string, unknown>,
  idempotencyKey: string,
}) → Promise<{
  invocationId: string,
  targetCanvasId?: string,       // when target is single-canvas
  acceptedAt: string,
}>
```

**Required methods:** `read`, `write`. `create` and `crossInvoke` are required only when the host advertises `host.canvas.create: supported` / `host.canvas.crossInvoke: supported`.

**Failure modes:**
- `host_capability_missing` — `ctx.canvas` absent
- `canvas_not_found` — canvasId doesn't resolve
- `canvas_permission_denied` — caller lacks read/write permission
- `canvas_version_conflict` — optimistic-concurrency conflict
- `cross_canvas_circuit_open` — target canvas type circuit-broken

---

## §host.chat

**Capability flag:** `host.chat: supported`

**Used by:** `vendor.myndhyve.chat`

Posts messages + cards into a chat session. The session is established by the host; the pack receives `ctx.chat.sessionId` (or scopes via config).

```typescript
ctx.chat.sendMessage({
  role: 'agent' | 'user' | 'system',
  content: string,
  citations?: Array<{ url: string, title?: string }>,
  sessionId?: string,
  idempotencyKey: string,
}) → Promise<{
  messageId: string,
  sentAt: string,
}>

ctx.chat.emitCard({
  cardId: string,
  cardType: string,             // e.g., 'progress' | 'approval' | 'clarification' | 'phase-input'
  payload: Record<string, unknown>,
  idempotencyKey: string,
}) → Promise<{
  cardId: string,
  emittedAt: string,
}>

ctx.chat.updateCard({
  cardId: string,
  patch: Record<string, unknown>,
  patchType: 'merge' | 'replace',
  idempotencyKey: string,
}) → Promise<{
  cardId: string,
  updatedAt: string,
  found: boolean,
}>
```

**Required methods:** `sendMessage`. `emitCard` + `updateCard` required when the host advertises `host.chat.cards: supported`.

**Failure modes:**
- `host_capability_missing` — `ctx.chat` absent
- `chat_session_not_found` — sessionId doesn't resolve
- `card_not_found` — updateCard targets a non-existent cardId (returns `found: false` instead of throwing)

---

## §host.brand

**Capability flag:** `host.brand: supported`

**Used by:** `vendor.myndhyve.brand`

State mutation + validation for brand artifacts (themes + personas).

```typescript
ctx.brand.implementTheme({
  brandId: string,
  payload: Record<string, unknown>,    // theme spec
  targetCanvasId?: string,
  force?: boolean,
  idempotencyKey: string,
}) → Promise<{
  artifactId: string,
  appliedAt?: string,
}>

ctx.brand.publishTheme({
  brandId: string,
  payload: Record<string, unknown>,
  idempotencyKey: string,
}) → Promise<{
  artifactId: string,
  appliedAt?: string,
}>

ctx.brand.publishPersona({
  brandId: string,
  payload: Record<string, unknown>,
  idempotencyKey: string,
}) → Promise<{
  artifactId: string,
  appliedAt?: string,
}>

ctx.brand.validateTheme({
  artifactId: string,
  ruleSet?: string,
  failOnWarning?: boolean,
}) → Promise<{
  rulesRun: number,
  violations: Array<{
    ruleId: string,
    severity: 'error' | 'warning' | 'info',
    message: string,
  }>,
}>

ctx.brand.validatePersona(/* same shape as validateTheme */)
  → Promise<{ rulesRun, violations }>
```

**Required methods:** all five.

**Failure modes:**
- `host_capability_missing` — `ctx.brand` absent
- `brand_not_found` — brandId doesn't resolve
- `theme_invalid_shape` — payload fails server-side schema validation

---

## §host.kanban

**Capability flag:** `host.kanban: supported`

**Used by:** `vendor.myndhyve.kanban`, `vendor.myndhyve.launch-studio` (shares `getReadyTasks` + `moveTask`)

Board + task + timeline + automation operations.

```typescript
ctx.kanban.boardCreate({
  name: string,
  columns: Array<{ id: string, label: string, ... }>,
  description?: string,
  projectId?: string,
  idempotencyKey: string,
}) → Promise<{ boardId: string, createdAt: string }>

ctx.kanban.boardReview({
  boardId: string,
  includeArchived?: boolean,
  atRiskThresholdDays?: number,
}) → Promise<{
  boardName?: string,
  totalTasks: number,
  columnCounts: Record<string, number>,
  atRiskTasks: Array<{ taskId: string, ... }>,
  reviewedAt?: string,
}>

ctx.kanban.taskAssign({
  taskId: string,
  assigneeId: string,
  notifyAssignee?: boolean,
  comment?: string,
  idempotencyKey: string,
}) → Promise<{
  previousAssigneeId?: string,
  assignedAt?: string,
}>

ctx.kanban.taskGet(taskId: string) → Promise<TaskDetail>         // optional

ctx.kanban.taskCreateBatch({
  parentTaskId: string,
  subtasks: Array<{ title: string, ... }>,
  idempotencyKey: string,
}) → Promise<{ subtaskIds: string[] }>                            // optional

ctx.kanban.timelinePlan({
  boardId: string,
  scheduler: 'critical-path' | 'earliest-start' | string,
  ...
}) → Promise<{
  schedule: Array<{ taskId: string, startAt: string, endAt: string }>,
  criticalPath: string[],
  projectEndDate?: string,
}>

ctx.kanban.automateRules({
  boardId: string,
  rules: Array<{
    trigger: 'column-transition' | 'due-date-approaching' | 'label-changed' | 'assignee-changed',
    action: 'assign' | 'move-column' | 'set-label' | 'send-notification' | 'invoke-workflow',
    config: Record<string, unknown>,
  }>,
  replaceExisting?: boolean,
  idempotencyKey: string,
}) → Promise<{
  activeRules: number,
  added: number,
  appliedAt?: string,
}>

ctx.kanban.resourceMonitor({
  boardId: string,
  maxConcurrentPerAssignee?: number,
  includeAgents?: boolean,
}) → Promise<{
  assigneeLoad: Record<string, number>,
  wipBreaches: Array<{ assigneeId: string, current: number, max: number }>,
  overdueTasks: Array<{ taskId: string, dueAt: string }>,
  monitoredAt?: string,
}>

// Shared with vendor.myndhyve.launch-studio:
ctx.kanban.getReadyTasks(boardId: string) → Promise<Array<{ id: string, ... }>>
ctx.kanban.moveTask(taskId: string, toColumn: string) → Promise<void>
```

**Required methods:** `boardCreate`, `boardReview`, `taskAssign`, `timelinePlan`, `automateRules`, `resourceMonitor`, `getReadyTasks`, `moveTask`. `taskGet`, `taskCreateBatch` are optional.

**Failure modes:**
- `host_capability_missing`
- `board_not_found`
- `task_not_found`
- `task_transition_invalid` — column not in the board's column set

---

## §host.webResearch

**Capability flag:** `host.webResearch: supported`

**Used by:** `vendor.myndhyve.web-research`

Search + fetch + research orchestration. Routes through host's search adapter (Google CSE, Bing, Brave, Perplexity, Kagi, etc.).

```typescript
ctx.webResearch.search({
  query: string,
  maxResults?: number,
  engine?: string,
  language?: string,
  region?: string,
  safeSearch?: boolean,
  siteFilter?: string,
}) → Promise<{
  results: Array<{ url: string, title: string, snippet?: string, rank?: number }>,
  engine: string,
  totalResults?: number,
}>

ctx.webResearch.fetchBatch({
  urls: string[],
  concurrency?: number,
  perRequestTimeoutMs?: number,
  respectRobotsTxt?: boolean,
  maxBodyBytes?: number,
  extractReadable?: boolean,
}) → Promise<{
  pages: Array<{
    url: string,
    status: number,
    contentType?: string,
    title?: string,
    extractedText?: string,
    rawBody?: string,
    truncated?: boolean,
    fetchedAt?: string,
    error?: string,
  }>,
}>

ctx.webResearch.research({
  query: string,
  maxResults: number,
  ...filters
}) → Promise<{
  citations: Array<{
    url: string,
    title: string,
    snippet?: string,
    content: string,
    rank?: number,
    fetchedAt?: string,
  }>,
  engine?: string,
  totalResults?: number,
}>
```

**Required methods:** `search`. `fetchBatch` and `research` required when host advertises `host.webResearch.scraping: supported`.

**Failure modes:**
- `host_capability_missing`
- `search_quota_exhausted`
- `fetch_blocked_by_robots`
- `fetch_timeout`

---

## §host.agentRuntime

**Capability flag:** `host.agentRuntime: supported`

**Used by:** `vendor.myndhyve.agent-orchestration` (the `agent.*` typeIds)

Operates on RFC 0007 / 0008 / 0011 protocol primitives — spawn, delegate, consensus, message-send, skill-invoke, swarm-execute.

```typescript
ctx.agentRuntime.spawn({
  manifestId?: string,           // RFC 0008 AgentManifest reference
  agentRef?: AgentRef,           // RFC 0007 inline definition
  config?: Record<string, unknown>,
  idempotencyKey: string,
}) → Promise<{ agentInstanceId: string, spawnedAt: string }>

ctx.agentRuntime.delegate({
  task: string,
  agents: AgentRef[],
  strategy?: 'best-match' | 'load-balanced',
  escalationThreshold?: number,  // RFC 0007 §F low-confidence threshold
  ...
}) → Promise<{
  selectedAgentId: string,
  delegationId: string,
  escalated?: boolean,
}>

ctx.agentRuntime.consensus({
  proposal: Record<string, unknown>,
  participants: AgentRef[],
  threshold?: number,
  maxRounds?: number,
  ...
}) → Promise<{ converged: boolean, rounds: number, agreement?: unknown }>

ctx.agentRuntime.messageSend({
  fromAgentId: string,
  toAgentId: string,
  channel: 'message' | string,
  content: unknown,
  idempotencyKey: string,
}) → Promise<{ messageId: string, sentAt: string }>

ctx.agentRuntime.skillInvoke({
  agentId: string,
  skillName: string,
  inputs: Record<string, unknown>,
  idempotencyKey: string,
}) → Promise<{ outputs: Record<string, unknown> }>

ctx.agentRuntime.swarmExecute({
  swarmId?: string,
  pattern: 'map' | 'map-reduce' | 'competitive',
  task: Record<string, unknown>,
  agentIds?: string[],
  ...
}) → Promise<{
  results?: Array<unknown>,
  reduced?: unknown,
  winner?: { agentId: string, result: unknown },
  succeeded: number,
  failed: number,
  durationMs: number,
}>
```

**Required methods:** all six.

**Failure modes:**
- `host_capability_missing`
- `agent_not_found`
- `agent_spawn_quota_exhausted`
- `agent_skill_not_found`

---

## §host.coordination

**Capability flag:** `host.coordination: supported`

**Used by:** `vendor.myndhyve.agent-orchestration` (the `coordination.*` typeIds)

Multi-participant coordination primitives. Distinct from `host.agentRuntime` — coordination operates on *roles* (voters, competitors), not individual agent identities. A host MAY implement both surfaces; typical hosts that do implement `agentRuntime` by delegating to `coordination` internally.

```typescript
ctx.coordination.vote({
  question: string,
  options: Array<{ id: string, label: string, value?: unknown } | string>,
  participantIds: string[],
  strategy: 'majority' | 'supermajority' | 'unanimous' | 'plurality' | 'ranked-choice' | 'weighted',
  quorum?: number,           // 0-1
  timeoutMs?: number,
}) → Promise<{
  winningOptionId: string,
  winningValue?: unknown,
  voteCounts: Record<string, number>,
  quorumMet: boolean,
  margin: number,
  voteCount: number,
  success: boolean,
  error?: string,
}>

ctx.coordination.consensus({...}) → Promise<{
  agreement?: unknown,
  converged: boolean,
  rounds: number,
  success: boolean,
}>

ctx.coordination.compete({...}) → Promise<{
  winnerId: string,
  winnerResult: unknown,
  durationMs: number,
  success: boolean,
}>

ctx.coordination.mapReduce({...}) → Promise<{
  results: unknown[],
  reduced?: unknown,
  success: boolean,
}>

ctx.coordination.delegate({...}) → Promise<{
  assigneeId: string,
  matchScore: number,
  success: boolean,
}>

ctx.coordination.roundRobin({
  cursor: number,
  ...
}) → Promise<{
  assigneeId: string,
  cursor: number,
  nextCursor: number,
  success: boolean,
}>
```

**Required methods:** `vote` is required when the capability is advertised. The others are required individually when the host advertises e.g. `host.coordination.consensus: supported`.

**Failure modes:**
- `host_capability_missing`
- `quorum_not_met` — when input requires quorum and vote returned `quorumMet: false`
- `consensus_max_rounds_exceeded`

---

## §host.dataIntegration

**Capability flag:** `host.dataIntegration: supported`

**Used by:** `vendor.myndhyve.data-integration`

Typed data-source operations. Fetches from configured external sources (REST, GraphQL, A2A peers, MCP), runs transforms, manages run-scoped variables.

```typescript
ctx.dataIntegration.fetchRest({
  sourceId: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
  path?: string,
  params?: Record<string, unknown>,
  body?: unknown,
  paginate?: boolean,
  idempotencyKey: string,
}) → Promise<{
  data: unknown,
  status: number,
  pageCount?: number,
}>

ctx.dataIntegration.fetchGraphql({
  sourceId: string,
  query: string,
  variables?: Record<string, unknown>,
  idempotencyKey: string,
}) → Promise<{
  data?: unknown,
  errors?: Array<{ message: string, path?: string[] }>,
}>

ctx.dataIntegration.fetchA2A({
  sourceId: string,
  task: Record<string, unknown>,
  idempotencyKey: string,
}) → Promise<{ result: unknown }>

ctx.dataIntegration.fetchMCP({
  sourceId: string,
  operation: {
    kind: 'tool' | 'resource',
    name: string,
    args?: Record<string, unknown>,
  },
  idempotencyKey: string,
}) → Promise<{ data: unknown, isError?: boolean, mimeType?: string }>

ctx.dataIntegration.transform({
  expression: string,
  language: 'jsonata' | 'jq' | string,
  data: unknown,
}) → Promise<{ result: unknown }>

ctx.dataIntegration.computeVariable({
  variableName: string,
  expression: string,
  language?: string,
  context?: Record<string, unknown>,
}) → Promise<{ value: unknown }>

ctx.dataIntegration.fetchVariable({
  variableName: string,
}) → Promise<{ value?: unknown, found: boolean }>

ctx.dataIntegration.applyBinding({
  targetType: string,
  targetPath: string,
  value: unknown,
  transform?: string,
  fallback?: unknown,
  canvasId?: string,
  updateMode: 'immediate' | 'batched',
  preserveUndo: boolean,
}) → Promise<{
  applied: boolean,
  previousValue?: unknown,
  resolvedValue?: unknown,
}>
```

**Required methods:** depends on which sub-capabilities the host advertises. The minimal surface for `host.dataIntegration: supported` is `transform` + `applyBinding`. REST/GraphQL/A2A/MCP fetch methods require the respective sub-capabilities (`host.dataIntegration.rest: supported`, etc.).

**Failure modes:**
- `host_capability_missing`
- `source_not_found` — sourceId doesn't resolve
- `transform_expression_invalid`
- `binding_target_not_found`

---

## §host.launchStudio

**Capability flag:** `host.launchStudio: supported`

**Used by:** `vendor.myndhyve.launch-studio`

Launch-studio specific operations. Backbone for the multi-canvas LS workflow.

```typescript
ctx.launchStudio.getStudio(studioId: string) → Promise<{
  studioId: string,
  brandId?: string,
  designSystemId?: string,
  prdId?: string,
  sharedArtifactRefs: Array<{ artifactId: string, artifactTypeId: string }>,
  steps: Array<{ stepId: string, canvasTypeId: string, projectId?: string }>,
} | null>

ctx.launchStudio.buildProjectContext({
  studio: Studio,
  userId: string,
  canvasTypeId: string,
}) → Promise<Record<string, unknown>>

ctx.launchStudio.resolveLinkedArtifacts({
  studio: Studio,
  userId: string,
  sourceCanvasTypeId: string,
}) → Promise<Record<string, unknown>>
```

**Required methods:** all three.

**Failure modes:**
- `host_capability_missing`
- `studio_not_found` — getStudio returns null on miss (NOT thrown — convention)
- `studio_permission_denied`

---

## §host.entities

**Capability flag:** `host.entities: supported`

**Used by:** `vendor.myndhyve.entities`

Generic entity CRUD operations. Projects + workspace assets (brand, persona, knowledge bases).

```typescript
ctx.entities.createProject({
  userId: string,
  name: string,
  canvasTypeId: string,
  type: string,
  status: string,
  settings: Record<string, unknown>,
  idempotencyKey: string,
}) → Promise<{ id: string }>

ctx.entities.listAssets({
  assetType: 'brand' | 'persona' | 'knowledgeBase',
  filterConfig?: Record<string, unknown>,
}) → Promise<Array<{
  id: string,
  name: string,
  description?: string,
  status?: string,
}>>

ctx.entities.getAsset({
  assetType: 'brand' | 'persona' | 'knowledgeBase',
  assetId: string,
}) → Promise<Record<string, unknown> | null>
```

**Required methods:** all three.

**Failure modes:**
- `host_capability_missing`
- `entity_permission_denied`
- `entity_quota_exceeded`

---

## §host.messaging

**Capability flag:** `host.messaging: supported`

**Used by:** `vendor.myndhyve.entities`

Outbound chat-egress dispatch. The host owns the connector layer (Slack, WhatsApp, SMS, email, etc.); the pack hands off envelopes for dispatch.

```typescript
ctx.messaging.dispatchEgressEnvelope({
  envelope: {
    type: 'chat.egress',
    version: string,
    channel: string,
    accountId: string,
    delivery: {
      conversationId: string,
      threadId?: string,
      inReplyTo?: string,
    },
    content: {
      text?: string,
      media?: Array<{ kind: string, ref: string }>,
    },
    idempotencyKey: string,
    mode: { typing: boolean, draftStreaming: boolean },
  },
  connectorInstanceId: string,
  nodeId: string,
}) → Promise<{
  success: boolean,
  deliveryId?: string,
  platformMessageId?: string,
  durationMs?: number,
  error?: string,
}>
```

**Required methods:** `dispatchEgressEnvelope`.

**Failure modes:**
- `host_capability_missing`
- `connector_not_found`
- `connector_disconnected`
- `channel_unsupported`

---

## §host.mcp

**Capability flag:** `host.mcp: supported`

**Used by:** `core.openwop.mcp`

Workflow-author MCP operations. Distinct from `host.dataIntegration.fetchMCP` — that's MCP-as-data-source; this is MCP-as-tool-runtime.

```typescript
ctx.mcp.invokeTool({
  serverId: string,
  toolName: string,
  args?: Record<string, unknown>,
  idempotencyKey: string,
}) → Promise<{ result: unknown, isError?: boolean }>

ctx.mcp.listTools({
  serverId: string,
}) → Promise<{
  tools: Array<{ name: string, description?: string, inputSchema: object }>,
}>

ctx.mcp.readResource({
  serverId: string,
  uri: string,
}) → Promise<{
  contents: Array<{ uri: string, mimeType?: string, text?: string, blob?: string }>,
}>

ctx.mcp.serverStatus({
  serverId: string,
}) → Promise<{
  serverId: string,
  status: 'connected' | 'disconnected' | 'error',
  protocolVersion?: string,
  serverInfo?: { name: string, version: string },
}>
```

**Required methods:** all four.

**Failure modes:**
- `host_capability_missing`
- `mcp_server_not_found`
- `mcp_server_disconnected`
- `mcp_tool_not_found`
- `mcp_tool_invocation_failed`

---

## §host.knowledge

**Capability flag:** `host.knowledge: supported`

**Used by:** market-intelligence packs, RAG-grounded copy packs, brief-enrichment packs.

Knowledge-base retrieval. Routes queries through the host's RAG pipeline (embedding → vector search → optional re-rank). The host owns the corpus, the embedding model, and the access-control boundary; the pack supplies the query.

```typescript
ctx.knowledge.retrieve({
  query: string,
  workspaceId?: string,       // omit to use the run's workspace
  collectionIds?: string[],   // scope to specific knowledge collections
  category?: string,          // optional category facet
  candidateLimit?: number,    // pre-rank candidate pool size; host caps the upper bound
  resultLimit?: number,       // post-rank returned chunks; host caps the upper bound
  scoreThreshold?: number,    // minimum relevanceScore (0..1) for inclusion
}) → Promise<{
  chunks: Array<{
    chunkId: string,
    content: string,                // prepared/cleaned chunk text suitable for prompt insertion
    rawContent?: string,            // optional verbatim source text (when distinct from content)
    headingPath: string[],          // section heading trail from the source document
    pageNumber: number | null,
    documentTitle: string,
    assetId: string,                // host-internal id for the source media asset
    collectionId: string,
    relevanceScore: number,         // 0..1 — host-normalized post-rank score
    vectorDistance?: number,        // pre-rank distance; informational only
  }>,
  sources: Array<{
    sourceId: string,               // stable id for citation (de-duplicated across chunks)
    assetId: string,
    title: string,
    headingPath: string[],
    pageNumber: number | null,
  }>,
  latencyMs?: number,
  hasResults: boolean,
}>
```

**Required methods:** `retrieve`.

**Optional methods (host MAY advertise `host.knowledge.embed: supported` to expose them):**

```typescript
ctx.knowledge.embed({
  texts: string[],
  model?: string,                   // host-allowed embedding model alias
}) → Promise<{
  vectors: number[][],              // one row per input; dimension is host-defined and stable per model
  model: string,
  dimension: number,
}>
```

**RBAC:**
- The host MUST enforce that `workspaceId` is one the calling run has read access to. Cross-workspace retrieval MUST return `403 knowledge_workspace_forbidden`.
- `collectionIds[]` MUST be filtered to those visible to the caller; chunks from collections the caller cannot read MUST be omitted, NOT errored on.

**Determinism:**
- `retrieve` is NOT pure — corpus and embeddings change over time. Packs SHOULD treat results as an input snapshot for the current run.
- Hosts SHOULD include enough metadata (chunkId, assetId, headingPath, pageNumber) for packs to render citations stably.

**Failure modes:**
- `host_capability_missing`
- `knowledge_workspace_forbidden` — caller cannot read the workspace
- `knowledge_query_too_long` — query exceeds host's embedding-model token limit
- `knowledge_quota_exhausted` — workspace-level retrieval quota tripped
- `knowledge_collection_not_found` — explicit `collectionIds[]` includes an id that does not exist for this workspace (vs. a no-access filter, which silently skips)

---

## Reserved-but-undocumented surfaces

The following `host.*` capability slots are reserved for future surfaces. Hosts MUST NOT advertise them until this spec defines the contract.

- `host.media` — media asset CRUD (drafted in plans, not yet specified)
- `host.collaboration` — multi-user presence + comments
- `host.workspace` — workspace metadata + RBAC primitives

A pack that requires a reserved-but-undocumented surface in `peerDependencies` MUST be rejected at workflow-register time with `pack_peer_dependency_undefined`.

---

## Capability negotiation

The pack registry's workflow-register handler MUST verify that the host advertises every capability in a pack's `peerDependencies` block. Specifically:

1. Pack manifest declares `peerDependencies: { "host.canvas": "supported", "host.aiEnvelope": "supported" }`.
2. Registry fetches the host's `/.well-known/openwop` (cached per `Cache-Control`).
3. For each declared `peerDependency`, the registry checks the capability declaration exists with the required value.
4. If any are missing, register returns `400 pack_peer_dependency_missing` with the missing capability list. The pack does NOT register.

Hosts that want to add a new capability surface after publishing a pack MAY:
- Re-publish the pack manifest with adjusted peerDependencies (creating a new pack version), OR
- Add the capability declaration to `/.well-known/openwop` and re-register the existing version.

The wire-shape is additive: removing a declared capability is a breaking change for already-registered packs and SHOULD trigger a major-version bump in the pack.

---

## See also

- `spec/v1/host-extensions.md` — namespace rules; this doc is the per-surface contract
- `spec/v1/capabilities.md` — `/.well-known/openwop` shape; the host advertises its supported capabilities there
- `spec/v1/node-packs.md` §"Manifest format" — `peerDependencies` syntax
- `spec/v1/agent-memory.md` — `host.agentRuntime` complements the `agents.memoryBackends` capability for stateful agents
