# Handoff → MyndHyve session: round-2 features the app now consumes (2026-05-25)

**To:** the Claude Code session working on the MyndHyve app (`api.myndhyve.ai`).
**From:** the openwop spec session (2026-05-25).
**Companion to:** `docs/myndhyve-rfc-adoption-handoff.md` (the 0045–0054 cohort handoff, already ✅ DONE 2026-05-25).
**Status of the openwop side:** the reference app (`apps/workflow-engine/`) now consumes a small set of additional protocol surfaces that the reference workflow-engine host does not yet emit. **No spec change is required** for any of these — the wire surfaces are already shipped (RFC 0005 `Accepted`; RFC 0066 `Draft`). This doc lists the features and what to advertise/implement so the openwop reference app can validate end-to-end against MyndHyve.

> **Why this exists.** The 0045–0054 cohort closure raised the obvious next question: _is there more low-friction surface area where MyndHyve advertising one more capability unlocks a reference-app feature that has no other host to verify it?_ The audit on 2026-05-25 found three. None of them require new RFCs; all of them slot cleanly into MyndHyve's existing host posture.

## Why MyndHyve specifically

The openwop project's stated bootstrap-phase posture (`MAINTAINERS.md` §"Vendor-neutral tripwire") flips on **non-steward** host adoption. MyndHyve is the only non-steward host currently advertising on `/.well-known/openwop` with conformance evidence (`workflow-runtime-00211-69w`, suite v1.6.0). Each item below already has the openwop-side work merged on `main` — the missing piece is exactly one host advertising the capability so the corresponding RFC can graduate (when applicable) and so the reference app's UI stops being aspirational.

## What you need to do

Per item, **three** things, mirroring the round-1 handoff pattern:

1. **Advertise** the capability on `GET /.well-known/openwop` — honestly (advertise only what you actually honor).
2. **Implement** the host-side behavior the spec normates.
3. **Wire any test seam** the corresponding conformance scenario expects so capability-gated tests stop soft-skipping.

Then run `npx @openwop/openwop-conformance@latest` against `api.myndhyve.ai` and report the pass + the advertisement evidence (revision id + commit SHA), so the openwop side can ✅ each item closed.

## Per-feature checklist

### 1. `capabilities.conversationPrimitive: true` — unblocks multi-turn conversation UI (RFC 0005 — already `Accepted`)

| Advertise                                                            | Implement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Wire seam                                                                                                                                                                                         |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `capabilities.conversationPrimitive: true` on `/.well-known/openwop` | Register `core.conversationGate` node; host the three lifecycle ops (`operation: 'start' \| 'exchange' \| 'close'`); emit `conversation.opened` + `conversation.exchanged` + `conversation.closed` events per `schemas/conversation-event.schema.json`; suspend on `kind: 'conversation.start' \| 'conversation.exchange' \| 'conversation.close'` per `spec/v1/interrupt.md` §"conversation.\*". Resume via `POST /v1/interrupts/{token}` with the `ConversationStartResume` / `ConversationExchangeResume` / `ConversationCloseResume` shapes per `interrupt.md` §215–259. | The conformance scenarios for the conversation lifecycle (`conformance/src/scenarios/conversation*.test.ts`) gate on the capability advertisement; no extra `/v1/host/sample/*` seam is required. |

**Why this matters for the reference app.** The openwop reference app shipped `apps/workflow-engine/frontend/react/src/runs/RunConversationPanel.tsx` on 2026-05-25 (PR #217). It consumes the three `conversation.*` events and renders the turn history with an inline resume form. Today the panel returns `null` on every run because **no non-steward host emits these events** and the workflow-engine reference backend rejects `core.conversationGate` at registration time (it does not advertise `conversationPrimitive`). The first MyndHyve run that drives a `core.conversationGate` node will be the first end-to-end validation of the panel.

**RFC status side-effect.** RFC 0005 is already `Accepted` — non-steward adoption here does not promote anything further; it converts the reference-app panel from aspirational to validated.

### 2. `x-openwop-form` annotations on a published vendor pack — unblocks RFC 0066 path-to-`Active`/`Accepted`

| Advertise                                                                                                | Implement                                                                                                                                                                                                                                                                                                                      | Wire seam                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| (no capability flag — `x-openwop-form` is a per-property annotation on the pack-manifest `configSchema`) | Pick one already-published `vendor.myndhyve.*` pack whose `configSchema` has a string property that is naturally a picker (a prompt id, a credential ref, a provider, a model id, a free-form long-text field). Add `x-openwop-form: { kind: '<picker>'}` to that property per RFC 0066. Republish (or version-bump) the pack. | The reference renderer already consumes `x-openwop-form` (`apps/workflow-engine/frontend/react/src/builder/palette/configFieldsFromSchema.ts` + `builder/inspector/Inspector.tsx`, PR #204 + #205). The seven `kind` values are `text`, `textarea`, `string-list`, `prompt-picker`, `provider-picker`, `model-picker`, `credential-picker`. Unknown `kind` values are tolerated as `text` per RFC 0066's normative MUST. |

**Why this matters.** RFC 0066 is `Draft` today; path-to-`Active` is the 7-day comment window (closes ~2026-06-01). Path-to-`Accepted` is "a non-steward host advertising a pack with `x-openwop-form` annotations" — exactly the work above. One annotated pack from MyndHyve does both halves at once. See `docs/KNOWN-LIMITS.md` §"RFCs not yet `Accepted`" → row "0066".

**RFC status side-effect.** This is one of the cheapest non-steward adoption commitments on offer right now: a single PR to the pack's `manifest.json` graduates RFC 0066 `Draft → Active → Accepted` once the 7-day comment window closes.

### 3. A2A peer dispatch end-to-end (`vendor.myndhyve.*` peer with `core.a2a.*`) — converts the reference app's MCP-tool browser into a paired tool+peer browser

| Advertise                                                             | Implement                                                                                                                                                                                                                                                                                                          | Wire seam                                                                                                                                                                        |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (no new capability — A2A is per-RFC-0007 surface, already `Accepted`) | Stand up at least one A2A-Task endpoint MyndHyve hosts (you already have `vendor.myndhyve.agent-orchestration` and `vendor.myndhyve.ads-crew` packs that reference A2A peers — pick one and publish its endpoint). Verify roundtrip against `@a2a/sdk@0.3.13` (the openwop reference passes against this version). | No conformance-suite seam — verification is the existing `a2a-roundtrip.test.ts` scenario in `conformance/src/scenarios/` plus a curl roundtrip against your published endpoint. |

**Why this matters.** The reference app's `McpToolsPanel.tsx` (RFC 0020) shipped some time ago and is browser-style; an A2A peer browser is the natural pair (`apps/workflow-engine/frontend/react/src/builder/peers/A2APeerPanel.tsx` is on the openwop docket as plan Item #16). The work to render an A2A peer browser is straightforward once at least one non-steward A2A peer is published, because the reference app today has no peers to enumerate.

**RFC status side-effect.** RFC 0007 is already `Accepted` — this would not promote anything; it would close the A2A side of plan Item #16 ("MCP tool & A2A peer browser") and turn on a paired UI panel.

## Out of scope for this round

These are surfaces the reference app could consume but where the gating is on the openwop side, not on MyndHyve:

- **RFC 0050 (SAML/SCIM)** — you've opted out, and the openwop reference app does not yet have any UI surface that consumes it.
- **RFC 0054 (run diff)** — you've opted out; the reference app has a client-side two-run compare (`RunComparePage.tsx`, plan Item #24) that operates without it.
- **In-app pack publishing** (plan Item #20) — by `registry-operations.md`, pack submission is a PR-based flow to the `registry/` directory in this repo; not a host-side capability.

## Reference (on `openwop@main`)

- **RFC 0005 (conversation gate):** `RFCS/0005-multi-turn-conversation-gate.md` (now `Accepted` per the 8-RFC cohort on 2026-05-25; the underlying conversation primitive landed earlier in the Multi-Agent Shift Phase 4 work).
- **RFC 0066 (`x-openwop-form` vendor extension):** `RFCS/0066-x-openwop-form-vendor-extension.md` (`Draft`; comment window closes ~2026-06-01).
- **RFC 0007 (A2A task roundtrip):** `RFCS/0007-a2a-task-protocol.md` (`Accepted`).
- **Conversation lifecycle wire shape:** `schemas/conversation-event.schema.json`, `schemas/conversation-turn.schema.json`, `spec/v1/interrupt.md` §215–259.
- **`x-openwop-form` vocabulary:** `spec/v1/node-packs.md` §"`x-openwop-form` UX hints".
- **Reference-app consumers:**
  - Conversation panel: `apps/workflow-engine/frontend/react/src/runs/RunConversationPanel.tsx` (PR #217, 2026-05-25)
  - `x-openwop-form` renderer: `apps/workflow-engine/frontend/react/src/builder/palette/configFieldsFromSchema.ts` (PR #204, 2026-05-25)
  - MCP tool browser: `apps/workflow-engine/frontend/react/src/builder/peers/McpToolsPanel.tsx`
- **KNOWN-LIMITS:** `docs/KNOWN-LIMITS.md` §"RFCs not yet `Accepted`" → row "0066" tracks the path-to-`Active`/`Accepted` obligations for #2 above.
- **Test seams catalog:** `spec/v1/host-sample-test-seams.md`.
- **Promotion process:** `RFCS/0001-rfc-process.md` §"Promotion to Accepted".

## How to report back

Same shape as the round-1 closure: one comment / PR / Slack with

1. The capability block delta on `/.well-known/openwop` (curl-verified by us);
2. The revision id (`workflow-runtime-<rev>`) + commit SHA;
3. The `npx @openwop/openwop-conformance@latest` output;
4. For #2 above only: the URL of the republished annotated pack manifest.

Each item independently moves to ✅ DONE on the openwop side once that evidence lands.
