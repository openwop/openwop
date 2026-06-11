# OpenWOP Feature Gap Analysis

Date: 2026-05-26

## Brief

Self-contained source-of-truth for the gap analysis: the prompt that
produced this document, the input wish-list pointer, and the goal. Any
future session reading this file can pick up where this one left off.

### Prompt that produced this document

> Act as a senior protocol engineer + CLI designer working in the OpenWOP
> repository. Today's task is a gap analysis pass against an external
> feature wish-list, with the output structured so a follow-up session
> can pick up implementation against it.
>
> Inputs: the wish-list at `/Users/david/dev/deep-research-feature-list.md`
> (treat each line item as a candidate, not a commitment); the MyndHyve
> CLI source at `/Users/david/dev/myndhyve-cli/` (one data point for how a
> production OpenWOP-adjacent CLI solves similar problems; read for
> patterns, not as a source); and the existing OpenWOP state in priority
> order — `docs/OPENWOP-CLI-RESEARCH-AND-PLAN.md`, `cli/lib/cli.mjs`,
> `apps/workflow-engine/backend/typescript/src/routes/`, `spec/v1/` +
> `RFCS/`, `CONTRIBUTING.md §Bootstrap-phase notes`.
>
> For each feature on the wish-list, produce: classification
> (implementation-only / spec-additive / spec-breaking / out-of-scope),
> fit assessment against OpenWOP primitives, MyndHyve precedent if any,
> effort + risk (XS / S / M / L), and a one-sentence Implement / Adapt /
> Defer / Skip recommendation.
>
> Deliverable: this file at `docs/OPENWOP-FEATURE-GAP-ANALYSIS.md` with
> six sections — Brief, Inputs reviewed, Gap table, Per-category roll-up
> (Demo / CLI / RFCs), Top 5, Out-of-scope.
>
> Constraints: do not reference the source product by name in the output
> (it was scrubbed from a sibling doc earlier and that scrub should hold);
> do not reference MyndHyve customer names or proprietary branding; do
> not propose implementation in this pass; do not modify any code, spec,
> or schema.

### Pointer to the input wish-list

`/Users/david/dev/deep-research-feature-list.md` (112 lines, 35 KB) — an
external research document describing the feature surface of a
self-hosted AI-assistant gateway product. It catalogs eleven feature
families, ~22 communication channels, technical requirements, and
thirteen acceptance-criteria areas. Treated as a candidate list, not a
commitment.

## Inputs reviewed

- `/Users/david/dev/deep-research-feature-list.md` (112 lines, 35 KB)
- `/Users/david/dev/myndhyve-cli/src/` — TypeScript CLI, commander-based,
  ~30 command files under `src/cli/` plus auth, bridge, chat, and config
  subsystems. Key reference points: `cli/auth.ts` (OAuth login/logout/
  status/token), `cli/bridge.ts` (daemon-style background process with
  link/sync/start/stop/status/logs), `cli/messaging.ts` (connectors,
  policies, routing, logs, sessions), `cli/daemon.ts`, `cli/cron.ts`,
  `cli/canvas.ts`, `cli/agents.ts`. Engine peer: depends on
  `@myndhyve/wop` from npm (their fork-flavored copy of OpenWOP wire
  types).
- OpenWOP state:
  - `docs/OPENWOP-CLI-RESEARCH-AND-PLAN.md` — current CLI plan, gap
    table, what's already implemented (`onboard`, `providers {list,add,
remove,test}`, `config {file,get,set,unset}`, `doctor`, `demo
{status,start,urls}`, `health`, `capabilities`, `catalog {nodes,
packs}`, `workflows`, `runs`, `conformance`).
  - `cli/lib/cli.mjs` (~1700 lines, stdlib-only)
  - `apps/workflow-engine/backend/typescript/src/routes/` — BYOK,
    demo-summary, discovery, runs, streams, interrupts, packs, prompts,
    workflows, node catalog, sample chat, memory, media, admin, MCP.
    Four dispatcher-backed AI providers: anthropic, openai, google,
    minimax.
  - `spec/v1/` (38 docs, 34 FINAL v1) and `RFCS/` (41 RFCs; recent
    activity on multi-agent track RFCs 0037 / 0039 / 0040 / 0041, plus
    0052 scheduler, 0058 wall-clock timeout, 0059 workspace, 0061
    stateful loop, 0064 tool hooks).

## Gap table

Severity-ordered. "Classification" uses the four-bucket scheme. "Effort"
is rough size (XS = hour, S = day, M = week, L = multi-week).
"MyndHyve precedent" cites a file when one exists; "none" otherwise. The
final column is the one-sentence recommendation. Wish-list items that
don't decompose individually (e.g., the 22 communication channels) are
grouped onto one row with a per-row note.

| #   | Wish-list feature family                                                                                                                                                                                                                                       | Classification                                                                      | Fit                                                                                                                                                                                                                                                                                                                                                 | MyndHyve precedent                                                                                               | Effort                                                             | Risk                                                              | Recommendation                                                                                                                                                                                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Gateway lifecycle (foreground + managed service install: LaunchAgent / systemd / Windows fallback)                                                                                                                                                             | Implementation-only                                                                 | Adapts to the existing `openwop demo start`; the demo backend is the gateway analogue. Service install is a CLI surface addition.                                                                                                                                                                                                                   | `cli/daemon.ts` (start/stop/status/logs)                                                                         | M                                                                  | LOW (no protocol surface)                                         | **Adapt** — extend the CLI with `openwop demo {stop, restart, logs}` and a `--install-daemon` flag that writes a LaunchAgent / systemd unit / Windows Scheduled Task. PID file under `~/.openwop/`.                                                               |
| 2   | `doctor` extended with provider-credential + service-health checks                                                                                                                                                                                             | Implementation-only                                                                 | Direct fit. Current `openwop doctor` checks Node/npm/repo/demo-health; adding provider + daemon checks is incremental.                                                                                                                                                                                                                              | `cli/cli/setup.ts` + status checks                                                                               | XS                                                                 | NONE                                                              | **Implement** — add provider-reachability + daemon-status rows to the existing `doctor` output.                                                                                                                                                                   |
| 3   | Provider catalog expanded from 4 to ~20+ (OpenRouter, LiteLLM, Vercel AI Gateway, Cloudflare AI Gateway, Together, Bedrock, Qwen, Ollama, vLLM, HuggingFace, etc.)                                                                                             | Implementation-only (backend dispatcher) + Spec-additive (capability advertisement) | OpenWOP's BYOK schema (`schemas/capabilities.json` `aiProviders.supported`) already allows arbitrary provider keys; new providers expand the backend dispatcher and the discovery doc. No wire-shape change unless a provider needs a new auth shape.                                                                                               | `cli/auth.ts` (OAuth + device flow)                                                                              | M per new provider                                                 | MEDIUM (BYOK + replay determinism for new providers)              | **Adapt — phased** — add a new RFC clarifying provider-catalog conventions, then implement OpenRouter + Ollama + Bedrock first as a representative set (open + local + enterprise). Defer the long tail.                                                          |
| 4   | Memory: search, get, active-memory plugin, dreaming, inferred commitments                                                                                                                                                                                      | Spec-additive                                                                       | Strong fit. RFC 0039 §B already normates cross-run memory inheritance + replay carry-forward; `MemoryAdapter` is the host-interface. "Dreaming" (background consolidation) is novel — not in any existing RFC. "Inferred commitments" map to RFC 0058 wall-clock arms + cron.                                                                       | none in `cli/` (MyndHyve uses gateway-side memory)                                                               | M for memory CLI surface; L for dreaming RFC                       | MEDIUM (memory cross-tenant invariant CTI-1 must hold)            | **Adapt** — implement `openwop memory {search,get,list,delete}` CLI against the existing MemoryAdapter today. File a new RFC for the dreaming / background-consolidation contract separately.                                                                     |
| 5   | Multi-agent orchestration (sub-agents, cross-session work, handoff)                                                                                                                                                                                            | Spec-additive (mostly already normated)                                             | Direct fit. RFC 0037 (Phase 1 execution loop) + RFC 0039 (Phase 2 confidence + memory) + RFC 0040 (Phase 3 cross-host causation) + RFC 0041 (Phase 4 replay determinism) cover the spec. CLI/demo gaps are the surfacing of these primitives.                                                                                                       | `cli/agents.ts` (create/list/info/enable/disable/update/delete)                                                  | M for CLI; spec-side largely covered                               | LOW                                                               | **Implement** — surface the existing primitives via `openwop agents {list,info}` and `openwop runs ancestry <runId>` (calls the RFC 0040 `getRunAncestry` endpoint).                                                                                              |
| 6   | Skills / plugins / public registry ("ClawHub" analogue)                                                                                                                                                                                                        | Implementation-only                                                                 | OpenWOP has node packs + agent packs + the registry at `packs.openwop.dev`. The CLI does not yet surface install / search / publish for packs.                                                                                                                                                                                                      | `cli/packs.ts`, `cli/marketplace.ts`                                                                             | M                                                                  | LOW (the wire surface for packs is FINAL)                         | **Implement** — add `openwop packs {search,install,publish,info,yank}` mapping to the existing `/v1/packs/*` endpoints + `registry/scripts/build-index.mjs`.                                                                                                      |
| 7   | Tools: `exec`, `browser`, `web_search`, `message`, media-creation, sandboxing posture                                                                                                                                                                          | Spec-additive (`exec` + sandbox); implementation-only (`browser`, `web_search`)     | Partial fit. RFC 0008 (WASM ABI) covers sandboxed-pack execution today. `exec` (arbitrary command) requires a new safety contract — exec is host-extension territory and must NOT be part of the protocol. `web_search` + `browser` fit as new core node packs.                                                                                     | `cli/dev.ts` (sandboxed dev exec)                                                                                | L for the exec safety RFC; M for the browser/web_search node packs | HIGH (`exec` is a known attack surface; sandbox escape is severe) | **Defer + scope** — file a new RFC defining a host-extension safety contract for `exec`-class tools (out-of-band, NOT in the protocol). Implement `core.openwop.web-search` + `core.openwop.browser` packs against the existing capability-advertisement pattern. |
| 8   | Automation: cron, heartbeat, hooks, standing instructions, webhook-triggered tasks                                                                                                                                                                             | Spec-additive (partial)                                                             | RFC 0052 scheduler-firing already covers fire-once-per-tick + missed-tick policy. Webhook subscription is FINAL v1 (`webhooks.md`). "Heartbeat" (recurring main-session turn) is novel — overlaps with cron but has different semantics. Hooks (pre-/post-event interceptors) overlap with RFC 0064 tool hooks.                                     | `cli/cron.ts`                                                                                                    | M for CLI; S for RFC clarification                                 | LOW (additive only)                                               | **Adapt** — add `openwop cron {list,add,remove,trigger}` CLI mapping to existing scheduler endpoints; file a one-page clarification RFC defining "heartbeat" as a host-extension naming convention for self-triggering cron jobs (no new wire).                   |
| 9   | Media + voice: image / audio / video understanding + generation; TTS / STT; talk-mode                                                                                                                                                                          | Implementation-only (mostly already in the backend)                                 | Demo backend's discovery doc shows `aiProviders.{imageGeneration, ttsGeneration?, ...}` — partial. STT / video-understanding / talk-mode flows would extend that. Strong overlap with existing `core.openwop.ai` pack (chat, image-generate, audio-transcribe, audio-synthesize, video-generate, rerank, classify, extract, guardrails, transform). | none (MyndHyve focuses on text channels)                                                                         | M                                                                  | LOW (existing capability flags + node-pack pattern hold)          | **Adapt** — surface existing image/audio nodes through the demo frontend's chat UI; add `openwop media generate-image / transcribe / synthesize` CLI helpers for the curious.                                                                                     |
| 10  | Browser + terminal control surfaces (Control UI, WebChat, TUI, terminal aliases like `chat` and `terminal`)                                                                                                                                                    | Implementation-only                                                                 | Demo frontend already has the React builder + chat. CLI `openwop chat <workflowId>` (interactive REPL using `runs create --wait`) is a natural addition. TUI / dashboard is bigger scope and probably skipped.                                                                                                                                      | `cli/chat.ts` (full chat REPL with history), `cli/dev.ts`                                                        | S for `openwop chat`; M for richer TUI                             | LOW                                                               | **Adapt** — implement `openwop chat <workflowId>` as a streaming REPL today. Defer TUI / dashboard until there's a user request.                                                                                                                                  |
| 11  | Communication channels family (22 channels: Discord, Slack, Telegram, WhatsApp, Signal, Teams, Google Chat, iMessage, IRC, Mattermost, Matrix, LINE, Feishu, QQ, Synology, Tlon, Twitch, WeChat, Yuanbao, Zalo, Zalo Personal, Nostr, Nextcloud Talk, WebChat) | Out-of-scope (protocol) + Implementation-only (host-extension)                      | OpenWOP is a workflow-orchestration protocol, not a messaging gateway. Channels belong in a host-extension layer (the MyndHyve runtime advertises them as `host.x-channels.*`). The protocol's role is to be channel-agnostic — runs receive inputs, emit outputs, and the host decides how to deliver.                                             | `cli/messaging.ts` (connectors / policies / routing / logs / sessions), `cli/notify.ts`, MyndHyve's relay daemon | L if any are added                                                 | HIGH if channels are treated as protocol surface (they aren't)    | **Skip in protocol scope. Adapt for the demo app on one channel only (WebChat)** — the demo backend already has a chat surface; expose it through the CLI's `openwop chat` REPL. All other channels are MyndHyve / vendor territory.                              |
| 12  | Desktop / mobile companions (macOS menu-bar app, iOS, Android)                                                                                                                                                                                                 | Out-of-scope                                                                        | Native-platform applications are not part of OpenWOP's charter. The demo app is web-only by design.                                                                                                                                                                                                                                                 | none (MyndHyve has separate native apps)                                                                         | XL                                                                 | OUT-OF-SCOPE                                                      | **Skip** — leave native clients to vendor implementations; the protocol gives them everything they need (WebSocket via SSE, REST, OpenAPI).                                                                                                                       |

### Wish-list items addressed inside the rows above (no separate row)

- `openwop chat` / `openwop terminal` (TUI) → row 10.
- Admin HTTP RPC + webhooks → already FINAL v1 in `spec/v1/webhooks.md`.
  No CLI surface yet; could fold into row 6 (CLI gaps).
- `openwop security audit` → folds into row 2 (extended `doctor`).
- `/new` and `/reset` (session lifecycle) → row 5 (run cancellation +
  fork already cover this).
- Session DM-isolation (`session.dmScope: per-channel-peer`) → row 11
  (host-extension territory).
- Provider OAuth vs API-key tradeoffs → row 3.
- Single-trusted-operator security model → philosophy difference;
  OpenWOP is explicitly multi-tenant via `tenantId` + `scopeId`. Out of
  scope for additive features.

## Per-category roll-up

### Demo app

Five concrete additions that don't touch normative spec surface:

| ID  | Feature                                                                                                                      | Backs which gap-row? | Notes                                                                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | `GET /v1/host/sample/daemon-status` — surface PID / start-time / uptime / last-heartbeat for the running backend             | 1                    | Lets the CLI's `demo {status,stop,restart}` work and gives `doctor` a real readiness signal. Sample-extension namespace; no spec change. |
| D-2 | `openwop media generate-image / transcribe / synthesize` CLI commands wired against the existing `core.openwop.ai` node pack | 9                    | Stands up an end-to-end media demo through the chat UI in addition to the CLI.                                                           |
| D-3 | Frontend chat-UI surface for the existing `agent.reasoned`, `agent.toolCalled`, `agent.toolReturned`, `agent.handoff` events | 5                    | Closes the cross-host-causation demo loop (RFC 0040) visually.                                                                           |
| D-4 | Sample workflow `sample.web.research` using a new `core.openwop.web-search` node pack                                        | 7                    | Demonstrates the browser/search tool family on the protocol layer (node pack), not as a host-side `exec`.                                |
| D-5 | Frontend memory inspector (`/v1/host/sample/memory/*` already exists)                                                        | 4                    | Visible MemoryAdapter surface for the dreaming / commitments RFC to point at.                                                            |

### CLI

Nine additions to `cli/lib/cli.mjs`. Each maps to existing backend
endpoints — no new spec surface required.

| ID  | Subcommand                                                                                   | Backs which gap-row? | Notes                                                                                               |
| --- | -------------------------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------- |
| C-1 | `openwop demo stop` / `demo restart` / `demo logs [--follow]`                                | 1                    | Needs D-1 (daemon-status route) + a PID file under `~/.openwop/`.                                   |
| C-2 | `openwop demo install` (LaunchAgent / systemd / Windows-Task)                                | 1                    | Cross-platform; mirrors MyndHyve `cli/daemon.ts` shape.                                             |
| C-3 | `openwop doctor` extended with `provider <name>` rows + `daemon` row                         | 2                    | Pure additive on the existing `doctor` command.                                                     |
| C-4 | `openwop agents {list,info}` + `openwop runs ancestry <runId>`                               | 5                    | Surfaces RFC 0037 + RFC 0040 endpoints that already exist.                                          |
| C-5 | `openwop packs {search,install,publish,info,yank}` against `/v1/packs/*`                     | 6                    | Maps to FINAL v1 registry endpoints.                                                                |
| C-6 | `openwop cron {list,add,remove,trigger}` against the RFC 0052 scheduler                      | 8                    | One subcommand for each verb; matches MyndHyve `cli/cron.ts` shape.                                 |
| C-7 | `openwop chat <workflowId>` — streaming REPL using SSE + the existing `--wait` polling       | 10                   | Reads from `/v1/runs/{runId}/events`, prints each event as it arrives, accepts new turns via stdin. |
| C-8 | `openwop memory {search,get,list,delete}` against existing `/v1/host/sample/memory/*` routes | 4                    | Aligns CLI with the existing MemoryAdapter wire surface.                                            |
| C-9 | `openwop webhooks {list,add,remove,test}` against existing `/v1/webhooks/*` routes           | (cross-cut)          | Closes a CLI gap against an already-FINAL surface.                                                  |

### RFCs

Three new RFCs proposed. Numbers chosen from the next available slots
above 0066 (per the recent activity through RFC 0064 in `git log`).
Status: all proposed as `Draft`. Each row names the specific schemas /
endpoints / capability flags that would change.

| RFC      | Title                                                 | Backs gap-row | Affects                                                                                                                                                                                                                                                                                                                                                                                                                 | Classification                                                                                                |
| -------- | ----------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| RFC 0067 | Provider-catalog conventions                          | 3             | `schemas/capabilities.schema.json` (extends `aiProviders.supported` with a formal provider-name vocabulary + auth-mode enum: `apiKey` / `oauth-pkce` / `oauth-device` / `none`), `spec/v1/byok.md` (auth-mode contract), CHANGELOG. New conformance scenario `byok-auth-modes.test.ts`.                                                                                                                                 | **Additive.** No existing required field changes; existing hosts continue to advertise their current set.     |
| RFC 0068 | Memory consolidation + standing commitments           | 4             | `spec/v1/agent-memory.md` (extends with §"Background consolidation" + §"Inferred commitments"), `schemas/run-event-payloads.schema.json` (adds optional `agent.memory.consolidated` event payload + `commitment.fired` payload), `schemas/capabilities.schema.json` (adds `agents.memoryConsolidation.{supported, schedule}` + `agents.commitments.supported`), CHANGELOG, INTEROP-MATRIX, 3 new conformance scenarios. | **Additive.** New optional capability + new optional event types.                                             |
| RFC 0069 | Host-extension safety contract for `exec`-class tools | 7             | `spec/v1/host-extensions.md` (new §"`exec`-class tools" with a normative MUST-NOT for protocol-tier `exec`; spec carves it OUT of the protocol and into named host-extension scopes with documented safety controls), `SECURITY/threat-model-prompt-injection.md` (extends with §"`exec` tools"), `SECURITY/invariants.yaml` (new invariant `exec-must-not-be-protocol-tier`).                                          | **Safety-fix-shaped but additive in practice.** Codifies an existing exclusion; no host's wire shape changes. |

## Top 5 highest-leverage features

Ranked by user-visible value × low risk. Each backed by a gap row.

1. **`openwop chat <workflowId>` — streaming REPL (gap 10, item C-7).**
   Value: turns "I have a CLI" into "I can talk to my agent right now"
   in three lines of usage. Risk: low — reuses existing
   `/v1/runs/{runId}/events` SSE surface; no new backend code.
2. **`openwop packs {search,install,publish,info,yank}` (gap 6, item
   C-5).** Value: connects the CLI to the registry at
   `packs.openwop.dev` — without this, the registry is a website nobody
   reaches from the terminal. Risk: low — `/v1/packs/*` is FINAL v1.
3. **`openwop demo {stop, restart, logs} + --install-daemon` (gap 1,
   items C-1 + C-2).** Value: closes the gateway-lifecycle gap so the
   CLI is a real local control plane, not just a launcher. Risk:
   medium — service-install across macOS / Linux / Windows is
   per-platform code that needs careful permission handling.
4. **`openwop doctor` extended with provider + daemon checks (gap 2,
   item C-3).** Value: one-command verdict on "is everything set up?".
   Risk: none — purely additive rows on an existing command.
5. **`openwop agents {list,info}` + `openwop runs ancestry <runId>`
   (gap 5, item C-4).** Value: surfaces the multi-agent execution-model
   primitives (RFC 0037 / 0039 / 0040) that already shipped in the
   spec but have no CLI today. Risk: low — read-only against existing
   endpoints.

Combined effort: ~2 weeks for an experienced contributor working
through items C-1 → C-5 plus the chat REPL.

## Out-of-scope or risky items

- **Native desktop / mobile companions (gap 12).** Out of OpenWOP's
  charter. Vendor implementations can build native apps on top of the
  REST + SSE + WebSocket surface; the protocol shouldn't normate any of
  it.
- **The 22 messaging channels (gap 11).** Out of OpenWOP's charter as
  protocol surface. They belong in vendor host-extension namespaces.
  Folding them into the protocol would invert the abstraction (the
  protocol exists to be channel-agnostic).
- **`exec`-class arbitrary command execution (gap 7).** Risky enough
  that the proposed RFC 0069 explicitly carves it OUT of the protocol
  rather than IN. Hosts that need it expose it under
  `x-host-<vendor>-exec` per `spec/v1/host-extensions.md` and own the
  safety story end-to-end.
- **"Dreaming" (background memory consolidation) on the protocol layer
  (gap 4 partial).** Bundled into the proposed RFC 0068, but the
  semantics are novel enough that the RFC explicitly carries an
  "Unresolved questions" section for whether replay determinism holds
  through a consolidation pass. Implement-and-see is risky; prose-and-
  see is the right pace.
- **Single-trusted-operator security model.** The wish-list product
  assumes one operator per gateway. OpenWOP is multi-tenant via
  `tenantId` + `scopeId`. This is a philosophy difference, not a
  feature gap — features should not be added that assume the
  single-operator model.
- **OAuth / device-flow provider auth (gap 3, partial).** Worth doing
  for provider parity, but every OAuth flow is per-provider
  bespoke — there's no generic OAuth shape on the wire. Recommend
  shipping API-key paths for new providers first and folding OAuth in
  per-provider as demand surfaces.
