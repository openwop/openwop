# Threat Model: Prompt Injection

> **Scope:** LLM-mediated workflows where untrusted content reaches the prompt context. Covers indirect injection via artifacts, exfiltration via tool outputs, refine-feedback path manipulation, and policy-bypass via crafted resolution payloads.
> **Last updated:** 2026-05-01
> **Companion artifacts:** `spec/v1/run-options.md` · `spec/v1/interrupt.md` · `SECURITY/invariants.yaml` (entries `prompt-injection-*`).

## 1. Why this model

OpenWOP workflows route untrusted content (user input, knowledge-base chunks, prior artifact bodies, refine feedback, MCP tool outputs) into LLM prompts. Prompt injection — content that overrides the system prompt's instructions — is the largest residual attack surface in any LLM-mediated workflow. The protocol's role is to define the boundaries where untrusted content enters and to specify what hosts MUST do at those boundaries.

The model assumes no LLM-level defense will be perfect. Instead, the invariants focus on:

1. **Containment.** Untrusted content MUST be marked as such at every boundary so the LLM-level prompting can isolate it.
2. **Authority gating.** Privileged actions (approval resolution, secret resolution, artifact replacement) MUST NOT be triggered by LLM-emitted content alone.
3. **Audit.** Every action triggered by LLM output MUST be traceable back to its envelope; no out-of-band side effects.

## 2. Trust boundaries

```text
[User] ── inputs ──> [Host: validate, persist as inputs.user_*]
                          │
                          │  variable substitution, NOT prompt construction
                          ▼
                       [Workflow node: assemble prompt context]
                          │
                          │  context := system + workflow + UNTRUSTED
                          ▼
                       [LLM]
                          │
                          │  envelope-typed response
                          ▼
                       [Host: parse + validate envelope schema]
                          │
                          ▼
                       [Action dispatch]
                          ├─> approve / reject (if envelope is approval)
                          ├─> create artifact (if envelope is artifact-create)
                          ├─> emit clarification (if envelope is clarification)
                          └─> execute tool call (if envelope is tool-call)
```

Trust transitions:

- **T1: User → Host.** User input lands in `inputs.user_*` fields. Treated as untrusted by every downstream stage.
- **T2: Knowledge-base / artifact retrieval → Prompt.** Retrieved content is marked `<UNTRUSTED>` in the prompt context (host responsibility).
- **T3: LLM → Envelope.** LLM output is parsed as a typed envelope; freeform text outside an envelope is discarded (engine layer).
- **T4: Envelope → Action.** Each envelope type triggers a specific action via the engine. No envelope can trigger an action outside its type.

## 2a. Trust is monotone through composition (normative — RFC 0143)

The surface-specific rules in §4–§5 are instances of one principle. Trust over content is a two-element meet-semilattice `untrusted ⊏ trusted` with meet `⊓` (`untrusted ⊓ anything = untrusted`).

- **Untrusted by default.** Content entering model context carries `contentTrust: "untrusted"` unless the host has a **specific, named basis** for `"trusted"`. **A tool having executed and returned is NOT a basis.** For a built-in/registered tool the basis is a per-tool `contentTrust` decision recorded at registration; registry silence is `untrusted` (fail-closed).
- **Monotone composition (the meet rule).** The `contentTrust` of any prompt segment composed from one or more inputs MUST be the **meet** of its inputs' trust: if **any** contributing input is `untrusted`, the segment is `untrusted`. No transformation — summarization, formatting, extraction, translation, or a store-then-recall round trip — may raise a segment's trust above the meet of its inputs. `ai-envelope.md` §"Trust boundary" (MCP / A2A) and the `prompt-composed-trust-marker` invariant (compose boundary) are **named instances** of this rule.
- **No laundering through storage.** Persisting untrusted content and later recalling it does not launder it: a value written to durable state while `untrusted` MUST be `untrusted` on recall, unless the reader is structurally isolated (below). This closes the `FRMD-F1-1` laundering path — untrusted content → tool → "result" → prompt with the tag dropped in transit.
- **Two conforming strategies, neither privileged.** A host MAY satisfy the meet by **(a) dynamic coarse-grained propagation** (carry a trust bit at per-turn / per-summary / per-segment granularity, take the meet at each boundary — over-tagging is conformant, coarser is safer) OR **(b) conservative static reader classification** (a reader of a store writable outside the operator's trust boundary is untrusted). **Value-granular taint through arbitrary durable state is NOT required** — the floor is the coarse-grained meet.
- **Structurally-isolated readers (carve-out).** A host MAY omit the persisted trust tag for content whose **only** reader is structurally isolated — sandboxed, no network egress, no path to model context or a side-effecting tool (e.g. behind the RFC 0035 sandbox contract). Trust is then enforced by **reader posture**, not a tag. Narrow: structural isolation only, never conventional; a reader that can reach model context or egress is not isolated and the no-laundering rule applies.
- **The fail-open default is the violation.** A composition site that treats **missing** `contentTrust` as `"trusted"` violates untrusted-by-default: absence of a trust decision is `untrusted`, never `trusted`.

## 3. Adversaries

| ID  | Adversary                                        | Capability                                                                                    |
| --- | ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| A1  | External user supplying malicious workflow input | Submit `POST /v1/runs` with crafted `inputs`                                                  |
| A2  | Hostile content in the knowledge base            | Author of a KB document embeds prompt-injection sequences                                     |
| A3  | Hostile prior-artifact content                   | Workflow earlier created an artifact whose body contains injection content                    |
| A4  | Hostile refine feedback                          | User supplies `refineFeedback.text` that attempts to override approval behavior               |
| A5  | Hostile MCP tool response                        | A registered MCP tool returns content that attempts to escalate                               |
| A6  | Compromised LLM                                  | Returns envelopes that don't match user intent — e.g., approves a run that should be rejected |

## 4. STRIDE per surface

### 4.1 User input → prompt

`inputs` field of `POST /v1/runs`. Mounted as workflow variables.

| Threat                 | Vector                                                                   | Mitigation                                                                                                          | Invariant                       |
| ---------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Spoofing               | User input reaches prompt as if it were system instruction               | Workflow templates MUST mark untrusted inputs with `<UNTRUSTED>` markers in prompt construction                     | `prompt-injection-input-marker` |
| Information disclosure | User input includes prompt-injection that asks LLM to dump system prompt | LLM-level: redaction of system-prompt content from user-visible responses (host responsibility, not protocol-level) | (advisory)                      |

### 4.2 Knowledge-base / artifact retrieval → prompt

Retrieved content from `knowledge_chunks/` or earlier artifact bodies.

| Threat   | Vector                                                                                            | Mitigation                                                                                                   | Invariant                          |
| -------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| Spoofing | KB content overrides workflow instructions                                                        | Retrieved content MUST be wrapped in `<UNTRUSTED>` markers per `spec/v1/run-options.md` §"Knowledge context" | `prompt-injection-kb-marker`       |
| Spoofing | Prior artifact content (e.g., a PRD body created earlier) is interpolated raw into a later prompt | Same: artifacts inherit untrusted-marker treatment                                                           | `prompt-injection-artifact-marker` |

### 4.3 Refine feedback → resume payload

`approvalGate` resume with `action: 'refine'` carries a `refineFeedback` object. Object shape per `openwop/openwop@c0d63ae`.

| Threat           | Vector                                                                                 | Mitigation                                                                                                   | Invariant                              |
| ---------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| Tampering        | Hostile `refineFeedback.text` causes the LLM to skip the next approval gate            | Refine feedback is treated as untrusted content; the SAME approval gate runs after refine, with quorum reset | `prompt-injection-refine-quorum`       |
| Authority bypass | Hostile feedback claims to be from `decidedBy: 'admin'` and gets routed as an approval | `decidedBy` is host-populated only; client-supplied `decidedBy` is ignored                                   | `prompt-injection-decidedby-host-only` |

### 4.4 MCP tool response → prompt

MCP tool returns content; content is fed back as the next LLM turn.

| Threat           | Vector                                                           | Mitigation                                                            | Invariant                          |
| ---------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------- |
| Spoofing         | Tool response wraps content as if from system                    | Tool responses MUST be wrapped in `<UNTRUSTED tool="...">` markers    | `prompt-injection-mcp-marker`      |
| Authority bypass | Tool response includes envelope-shaped content claiming approval | Tool responses NEVER advance approval gates; only HITL resolutions do | `prompt-injection-mcp-no-approval` |

### 4.5 LLM envelope → action

| Threat           | Vector                                                                         | Mitigation                                                                                                                                              | Invariant                              |
| ---------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Authority bypass | LLM emits an envelope of a type the workflow didn't request                    | Envelope schema validation rejects unrecognized types per `capabilities.md` §"supportedEnvelopes"                                                       | `prompt-injection-envelope-typecheck`  |
| Authority bypass | LLM emits an approval-resolution envelope to skip a HITL gate                  | Approval resolutions ONLY accept input via the HITL resume path (`/v1/interrupts/{token}`); LLM-emitted envelopes that look like approvals are rejected | `prompt-injection-no-llm-approval`     |
| Authority bypass | LLM emits a tool-call envelope referencing a tool not declared in the workflow | Tool-call envelopes validated against the workflow's declared `tools` set                                                                               | `prompt-injection-tool-allowlist`      |
| Tampering        | LLM-emitted envelope sets `metadata.workspaceId` to spoof tenant               | Persistence layer ignores client-supplied tenant fields; tenant is derived from the auth principal                                                      | `prompt-injection-tenant-host-derived` |

### 4.6 Side effects from LLM output

| Threat                | Vector                                                                          | Mitigation                                                                                                                                                                                                                     | Invariant                            |
| --------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| Authority bypass      | LLM output includes a URL the host fetches                                      | Hosts MUST NOT auto-fetch URLs from envelope content; URL fetches happen only via declared `external-api` nodes with explicit allowlists                                                                                       | `prompt-injection-no-auto-fetch`     |
| Authority bypass      | LLM output triggers a webhook delivery                                          | Webhooks fire only on declared `webhook.deliver` events from the workflow definition, not from LLM-content-derived URLs                                                                                                        | `prompt-injection-webhook-host-only` |
| Remote code execution | LLM output or untrusted input is executed as a host command (`exec`-class tool) | The protocol defines NO `exec`-class tool; arbitrary command execution is host-extension-only (`x-host-<vendor>-exec`) with host-owned sandboxing/allowlist/approval per `host-extensions.md` §"`exec`-class tools" (RFC 0069) | `exec-must-not-be-protocol-tier`     |

### 4.7 `exec` tools (arbitrary command execution) — RFC 0069

`exec`-class execution — running a caller- or model-supplied command, shell string, script, or binary — is the highest-severity surface a workflow runtime can expose. A protocol-tier `exec` tool would turn a prompt-injection foothold (§4.1–§4.5) or an input-validation lapse into remote code execution on the host, and a shared exec surface is a cross-tenant blast radius (openwop is multi-tenant via `tenantId`/`scopeId`). It also directly contradicts the sandbox invariant set (`node-pack-sandbox-no-process`, RFC 0035 §A) that forbids sandboxed pack code from spawning host processes.

openwop's mitigation is **structural**: the protocol defines no `exec`-class tool under any protocol-owned namespace (`core.*`, `openwop.*`) and no `exec` capability flag. A host that needs exec exposes it only under a named host-extension scope (`x-host-<vendor>-exec`) and owns the safety controls end-to-end — sandboxing, command allowlisting (no shell interpolation of untrusted content), human approval gating (RFC 0051), and audit — per [`spec/v1/host-extensions.md`](../spec/v1/host-extensions.md) §"`exec`-class tools". The `exec-must-not-be-protocol-tier` invariant (§5) makes the exclusion enforceable: a conformance scenario asserts the protocol corpus itself defines no exec-class primitive, so silence cannot be read as permission to ship a `core.exec` RCE primitive other hosts would treat as canonical.

### 4.8 Agent-authored rendered surface (A2UI) — RFC 0102

`ui.a2ui-surface` (`ai-envelope.md` §"A2UI surfaces") is a **new agent→user output channel**: an LLM (possibly a *remote* A2A agent, or a third-party pack) emits a declarative UI surface that a consumer host **renders** and routes the user's input back from. Rendering model output as interactive UI across a trust boundary is materially new surface — a prompt-injected or malicious agent could try to (a) smuggle executable code/markup into the surface, (b) wire an action to an attacker-controlled endpoint or exfil beacon, (c) render a secret, or (d) drive an approval gate with an untrusted-authored surface.

The mitigation is **declarative-data, not code** (the property A2UI exists for) plus reuse of the existing envelope trust machinery:

| Threat                  | Vector                                                                  | Mitigation                                                                                                                                                              | Invariant                          |
| ----------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Remote code execution   | Agent embeds script/markup/expression in the surface                    | Consumer renders only host-catalog components from a **closed** `anyOf` schema (`additionalProperties:false`); never executes/evaluates agent-supplied code; out-of-catalog → fail-closed notice | `a2ui-surface-no-code-exec`        |
| Authority bypass        | A surface action targets an arbitrary host endpoint / RPC               | Action `target` is a closed enum `resume`/`exchange` — confined to interrupt-resume or conversation-exchange; schema rejects any other target                          | `a2ui-action-confinement`          |
| Exfiltration            | Action/component initiates a fetch/beacon to an attacker URL            | A rendered surface MUST NOT initiate any network egress; reference-app render probe                                                                                     | `a2ui-surface-no-network-egress`   |
| Information disclosure  | Surface field echoes secret material                                    | Payload walked by the SR-1 redaction harness like any envelope; closed shape carries only text/label/binding fields (no opaque blob channel)                            | `a2ui-surface-no-secret-rendering` |
| Authority bypass (HITL) | Untrusted-authored surface drives an `approval` interrupt               | Surface from an untrusted-content node carries `meta.contentTrust:'untrusted'`; the existing `untrusted_content_blocks_approval` rule blocks the gate                   | `a2ui-untrusted-blocks-approval`   |

### 4.9 Synthesized audio output (speech synthesis) — RFC 0105

`ctx.callSpeechSynthesizer` (`host-capabilities.md` §host.aiProviders) is a **generation adapter**: text in, provider-produced audio bytes back into the run. It introduces no *new* trust primitive — it reuses the existing generated-media boundary — but the boundary MUST be applied, so it is recorded here for completeness. No new protocol-tier invariant is minted; the mitigations are reuse of `egress-credential-audience-bound` / RFC 0076 SSRF and the RFC 0091 §C generated-media discipline.

| Threat                 | Vector                                                                              | Mitigation                                                                                                                                                          | Reuses                              |
| ---------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| SSRF / unguarded fetch | A `url`-referenced audio asset is fetched/served without the SSRF guard             | A `url` asset MUST be served/fetched through the host's SSRF-guarded path (`ctx.http.safeFetch`); never a raw fetch of a pack- or provider-supplied URL              | RFC 0076 `safeFetch` (SSRF guard)   |
| Round-trip injection   | `text` (model/user-derived) carries injected instructions that re-enter if re-perceived | Synthesized bytes are generated media → carry the `<UNTRUSTED>` marker like any generated asset; `text` MUST NOT be treated as trusted on a transcription/perception round-trip | RFC 0091 §C generated-media boundary |
| Secret in handle       | `voiceId` smuggles credential/tenant secret into event logs or replay payloads      | `voiceId` is an opaque host-resolved handle and MUST NOT encode secret material; audio bytes are not credentials (BYOK/SR-1 unaffected)                              | SR-1 redaction; `threat-model-secret-leakage.md` |

### 4.10 Live audio ingress (streaming transcription) — RFC 0106

A live mic stream (`ctx.callTranscriber` over a `streamRef`) is a **materially new** untrusted-ingress surface vs RFC 0091's discrete clip: it is always-open, continuous, unbounded, low-friction (anyone in acoustic range is an unauthenticated writer), and its text representation is **provisional and revisable** before it settles. The untrusted marker MUST be re-asserted on **every** interim and final emission, not once at ingest. Unlike §4.9 (synthesis, a generation adapter that reused the existing boundary), live ingress mints **four** invariants — three behavioral (reference-impl until a host proves them at `Active → Accepted`) plus the schema-enforced untrusted-marker.

| Threat                              | Vector                                                                                                          | Mitigation / invariant                                                                                                                                                  |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Append-after-speech / voice jailbreak | A continuous stream lets an attacker append instructions after legitimate speech (AudioJailbreak ~88% OTA; VoiceJailbreak); inaudible/ultrasonic injection (DolphinAttack); Whisper silence-hallucination an open mic ingests | Every `voice.transcript` emission carries `contentTrust: "untrusted"` (schema-required) and MUST NOT be promoted to system/developer authority — `voice-transcript-untrusted` |
| Interim → final poisoning           | Acting on a revisable interim hypothesis the ASR later overwrites (AWS `Stable:false`, Deepgram/Google `is_final:false`) | A `voice.transcript` with `isFinal:false` MUST NOT be persisted to durable memory / the replay log / RAG or drive a side-effecting tool call before it finalizes — `voice-interim-not-durable` |
| Barge-in guardrail skip             | A cancellation mid-turn short-circuits the end-of-turn redaction/guardrail pass, leaking a partial tool output or un-guardrailed completion | `voice.cancelled` MUST NOT emit partial tool/model output and MUST roll back or fully complete an in-flight side effect (all-or-nothing) — `voice-bargein-no-partial-leak` |
| Cross-tenant stream / TDoS          | One tenant reads another's buffered audio via a leaked `streamRef`; a never-finalizing stream exhausts session resources | A `streamRef` is bound to one tenant+session for its lifetime (no cross-handle read) and the session enforces a max-duration / max-uncommitted-audio budget — `voice-streamref-tenant-bound` |

BYOK/SR-1 is unaffected (audio bytes and `streamRef` handles are not credentials; a `streamRef`/`voiceId` MUST NOT encode secret material). The `secret-leakage-eventlog-payload` invariant already covers redaction of any credential the model echoes into a `voice.transcript`.

## 5. Invariants (MUST NOT)

| ID                                     | Statement                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prompt-injection-input-marker`        | User-supplied workflow inputs MUST be wrapped in `<UNTRUSTED>` markers before reaching the LLM prompt context.                                                                                                                                                                                                                                                                                  |
| `prompt-injection-kb-marker`           | Knowledge-base / RAG retrieved content MUST be wrapped in `<UNTRUSTED>` markers.                                                                                                                                                                                                                                                                                                                |
| `prompt-injection-artifact-marker`     | Prior-artifact content interpolated into a later prompt MUST be wrapped in `<UNTRUSTED>` markers.                                                                                                                                                                                                                                                                                               |
| `chat-card-input-trust-boundary`       | A chat card pack (`kind: "card"`, RFC 0071 Phase 2) prompt segment interpolated from a card input MUST carry `meta.contentTrust: "untrusted"` on the composed AI envelope unless the host can assert the input is host-trusted — card inputs commonly derive from untrusted run input / prior LLM output. Verified by `chat-card-pack-execution.test.ts` (host-pending; Phase 2 `Active` gate). |
| `form-content-pack-string-trust-boundary` | A form-content pack (`kind: "form-content"`, RFC 0137) ships **pack-authored** strings — `templates[].label` / `.title` / `.description` / `.category`, `fields[].label` / `.description` / `.options[]` — that the host renders into its own chrome and whose collected values commonly feed a prompt. A host MUST escape/neutralize them for the target surface (never interpreting them as markup, script, or a templating directive) and MUST propagate `meta.contentTrust: "untrusted"` when they or template-collected values are interpolated into a prompt. **A signature proves authorship, not content safety** — a host MUST NOT treat pack provenance as content trust, and length bounds are a render-bomb guard, NOT sanitization. Verified by `form-content-packs.test.ts` (corpus legs always-on; behavioral leg host-pending, the `Active → Accepted` gate). |
| `prompt-injection-refine-quorum`       | Refine resume MUST reset the upstream approval gate's quorum; the same gate MUST re-run with the new artifact.                                                                                                                                                                                                                                                                                  |
| `prompt-injection-decidedby-host-only` | The `decidedBy` field on approval/refine resume MUST be populated by the host's auth layer, NOT accepted from the client.                                                                                                                                                                                                                                                                       |
| `prompt-injection-mcp-marker`          | MCP tool responses MUST be wrapped in `<UNTRUSTED tool="...">` markers in the next LLM turn.                                                                                                                                                                                                                                                                                                    |
| `runner-output-untrusted-transport`    | (RFC 0122) A host MUST treat a self-hosted runner as untrusted transport: runner-returned `output` re-entering an agent loop MUST be fenced `<UNTRUSTED>` in the next LLM turn. A runner is a user-controlled process whose output is attacker-influenceable, carrying the same prompt-injection exposure as pack/tool output (`self-hosted-runner.md` §Behavior clause 3; composes with `node-pack-output-untrusted` / `prompt-injection-mcp-marker`). |
| `prompt-injection-mcp-no-approval`     | MCP tool responses MUST NOT advance HITL approval gates.                                                                                                                                                                                                                                                                                                                                        |
| `prompt-injection-envelope-typecheck`  | LLM-emitted envelope types MUST be validated against the host-advertised `capabilities.supportedEnvelopes` set.                                                                                                                                                                                                                                                                                 |
| `prompt-injection-no-llm-approval`     | LLM-emitted approval-resolution envelopes MUST be rejected; approvals MUST come only via `POST /v1/interrupts/{token}`.                                                                                                                                                                                                                                                                         |
| `prompt-injection-tool-allowlist`      | LLM-emitted tool-call envelopes MUST be validated against the workflow's declared tools allowlist.                                                                                                                                                                                                                                                                                              |
| `prompt-injection-tenant-host-derived` | `tenantId` / `workspaceId` on persisted records MUST be derived from the auth principal, NOT accepted from envelope or LLM-supplied fields.                                                                                                                                                                                                                                                     |
| `prompt-injection-no-auto-fetch`       | Hosts MUST NOT fetch URLs that appear in LLM envelope content; URL fetches are restricted to declared `external-api`-class nodes with explicit allowlists.                                                                                                                                                                                                                                      |
| `prompt-injection-webhook-host-only`   | Webhook deliveries MUST fire only from declared `webhook.deliver` workflow events; LLM-content-derived URLs MUST NOT trigger webhook fan-out.                                                                                                                                                                                                                                                   |
| `exec-must-not-be-protocol-tier`       | Arbitrary-command (`exec`-class) execution MUST NOT be exposed under any protocol-owned namespace (`core.*`, `openwop.*`) or `capabilities.*` flag; it lives only in named host-extension scopes (`x-host-<vendor>-exec`) whose safety controls the host owns end-to-end.                                                                                                                       |
| `a2ui-surface-no-code-exec`            | A consumer rendering a `ui.a2ui-surface` (RFC 0102) MUST render only advertised-catalog components and MUST NOT execute or evaluate any agent-supplied code, script, expression, or markup; an out-of-catalog/malformed surface renders fail-closed.                                                                                                                                            |
| `a2ui-action-confinement`              | A `ui.a2ui-surface` action MUST resolve to exactly one host-allowlisted target — interrupt-resume or conversation-exchange — and MUST NOT invoke any other host endpoint, side effect, or RPC.                                                                                                                                                                                                 |
| `a2ui-surface-no-network-egress`       | A rendered `ui.a2ui-surface` MUST NOT initiate any network egress (fetch / beacon / image-to-URL) — data-exfil via an injected action is the threat.                                                                                                                                                                                                                                          |
| `a2ui-surface-no-secret-rendering`     | A `ui.a2ui-surface` payload MUST be walked by the SR-1 redaction harness like any envelope; no secret material renders in a surface.                                                                                                                                                                                                                                                          |
| `a2ui-untrusted-blocks-approval`       | A `ui.a2ui-surface` emitted by an untrusted-content node MUST carry `meta.contentTrust:'untrusted'` and MUST NOT advance an `approval` interrupt (composition of `untrusted_content_blocks_approval`).                                                                                                                                                                                         |
| `voice-transcript-untrusted`           | Every live-transcript emission (`voice.transcript` interim AND final, `voice.turn_commit.finalText`) is untrusted ingress: it MUST carry `contentTrust: "untrusted"` (schema-required on the `voice.transcript` payload) and MUST NOT be promoted to system/developer authority (RFC 0106 §F INV-2).                                                                                            |
| `voice-interim-not-durable`            | A `voice.transcript` with `isFinal:false` MUST NOT be persisted to durable memory / the replay log / RAG, and MUST NOT drive a side-effecting tool call, before it finalizes (RFC 0106 §F INV-1; reference-impl → protocol at `Active → Accepted`).                                                                                                                                            |
| `voice-bargein-no-partial-leak`        | A barge-in / `voice.cancelled` MUST NOT emit partial tool outputs or partial un-guardrailed model output, and MUST roll back or fully complete (never half-apply) an in-flight tool side effect (RFC 0106 §F INV-3; reference-impl → protocol at `Active → Accepted`).                                                                                                                          |
| `voice-streamref-tenant-bound`         | A `streamRef` MUST be bound to one tenant+session for its lifetime (no cross-handle read of buffered audio/interim text), and the session MUST enforce a max-duration / max-uncommitted-audio budget so a never-finalizing stream is bounded (RFC 0106 §F INV-4; reference-impl → protocol at `Active → Accepted`).                                                                             |
| `anon-actor-no-default-baseline`       | (RFC 0132, reference-impl until Accepted) **Adversary A-ANON** — a public-surface visitor crafting input to a *tool-enabled* anonymous dispatch. An anonymous actor (`owner.principalKind:"anonymous"`) MUST be granted ONLY the tools in the resolved public-surface allowlist — never a default-on tool baseline, never a tool granted to authenticated agents by default. A non-granted call ⇒ `authorization.decided{allowed:false,reason:"anon-not-granted"}`, no dispatch. The over-grant guard for identity-less callers. |
| `anon-actor-write-egress-gated`        | (RFC 0132, reference-impl until Accepted) An anon bounded-write/egress tool MUST be behind a mandatory control — a per-action HITL/approval gate (RFC 0051) OR a hard rate-limit + per-session cap. An ungated anon write/egress MUST be denied (`reason:"anon-write-ungated"`). A crafted visitor turn MUST NOT drive an unbounded durable write on the operator's tenant.                        |

## 6. Residual risks

- **Subtle prompt-injection that emits valid envelopes the user wouldn't want.** No protocol-level invariant defends against this — the host's prompt construction and the LLM's instruction-following both have to be sound. Defense-in-depth: HITL approval gates on artifact-changing actions.
- **System-prompt extraction via legitimate clarification.** A clarification envelope that asks "what is your system prompt?" is structurally valid. The LLM's prompt itself decides whether to comply; protocol can't prevent this.
- **MCP tool implementations.** A registered MCP tool is trusted to behave per its manifest. A compromised tool implementation can leak data even with marker discipline. Out of scope; covered by `threat-model-node-packs.md`.

## 7. Verification

`SECURITY/invariants.yaml` maps each MUST-NOT to test globs. Many invariants here are reference-impl-tier (the marker discipline is host-internal); those are advisory at the public-repo CI gate. Conformance suite's `interrupt-approval.test.ts`, `approval-payload.test.ts`, and `redaction.test.ts` cover the protocol-tier invariants directly.

## 8. References

- `SECURITY.md` — disclosure policy.
- `SECURITY/invariants.yaml` — invariant → test mapping.
- `spec/v1/run-options.md` — credential and tool reference semantics.
- `spec/v1/interrupt.md` — HITL resume contract.
- `spec/v1/capabilities.md` §"supportedEnvelopes" — envelope-type allowlist.
- Host implementations MUST derive `decidedBy`, tenant, and workspace identity from authenticated host context rather than envelope content.
