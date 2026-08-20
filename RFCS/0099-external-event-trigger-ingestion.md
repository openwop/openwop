# RFC 0099: External-Event Trigger Ingestion (webhook / email / form sources)

| Field | Value |
| --- | --- |
| **RFC** | 0099 |
| **Title** | External-Event Trigger Ingestion — extend the RFC 0083 durable-trigger bridge so `webhook` / `email` / `form` subscription sources can deliver an externally-originated event → start a run, with a normative inbound-event envelope, a subscription-registration contract, and SSRF/replay safety |
| **Status** | `Accepted` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-06-13 |
| **Updated** | 2026-06-14 — `Active → Accepted` on dual live evidence, steward-curl-verified vs `@openwop/openwop-conformance@1.25.0`. See [Amendment record](#amendment-record). |
| **Affects** | `spec/v1/trigger-bridge.md` (NEW §F external-event ingestion: the inbound-event envelope + the registration contract + the profile-source extension) · NEW `schemas/trigger-event.schema.json` (the normalized inbound-event envelope passed to the started run) · NEW `schemas/trigger-subscription-registration.schema.json` (the create/registration request) · `schemas/capabilities.schema.json` (additive `triggerBridge.ingestion` sub-block) · `spec/v1/profiles.md` (the `openwop-trigger-bridge` predicate gains `email`/`form` as durable sources alongside the existing OR) · `api/openapi.yaml` (additive `POST /v1/trigger-subscriptions` registration + the per-source inbound delivery endpoints) · `SECURITY/invariants.yaml` (`trigger-ingestion-ssrf` + `trigger-ingestion-content-redaction`) · `CHANGELOG.md` · `INTEROP-MATRIX.md` · new conformance scenario |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

RFC 0083 (`Accepted`) gave openwop a uniform durable inbound-work contract — a `TriggerSubscription` four-state machine, a delivery-attempt/dedup/retry model, and a trigger→run causation edge — and it already *lists* `webhook` / `email` / `form` in `capabilities.triggerBridge.sources[]`. But the only inbound source whose **ingestion** is normatively specified is the schedule tick (RFC 0052) and the queue message (RFC 0017); for an **externally-originated** event (an HTTP webhook POST, an inbound email, a public form submission) there is **no normative wire for what the event looks like once normalized, no contract for how an external source registers a subscription bound to a workflow, and no defined SSRF/replay posture for the ingestion path**. This RFC closes that gap **additively**: it defines a content-free-on-the-wire **`TriggerEvent`** envelope (the normalized external event handed to the started run via `ctx.triggerData`), a **`TriggerSubscriptionRegistration`** request (the create contract: source + workflow binding + dedup/verification config) served by an additive `POST /v1/trigger-subscriptions`, a `triggerBridge.ingestion` capability sub-block advertising which external sources the host actually ingests, and two new SECURITY invariants (SSRF on any host-side fetch the ingestion path performs; redaction of the inbound body out of the `trigger.*` events). Schedule + queue + in-app sources are unchanged; this is strictly the external-event leg the agent-platform hosts need.

## Motivation

The motivating host is the OpenWOP reference app's **work-twin agent suite** ([openwop-app ADR 0033 — "Work-twin connector reachability + day-1 capability-honesty matrix"](https://github.com/openwop/openwop-app/blob/main/docs/adr/0033-work-twin-connector-reachability.md)). That ADR defines "activated day 1" honestly against what the host can actually reach, and explicitly **defers external-event triggers**: _"Deferred items (external-event triggers, async A2A) would each need an upstream OpenWOP RFC — explicitly out of scope here."_ The ten standing twins want to **start a run when something happens in the outside world** — a Jira webhook fires, a support email lands, a public intake form is submitted — but today the host cannot advertise that honestly, because:

1. **No normalized inbound-event shape.** RFC 0083 §C carries `trigger.delivery.attempted{ subscriptionId, dedupKey, attempt, outcome, runId? }` on the wire (content-free, correctly), but it never defines **what the started run receives**. A webhook body, an email's parsed fields, and a form's field map are all different shapes; without a normalized `TriggerEvent` envelope, every host invents its own `ctx.triggerData` and cross-host workflow portability breaks. The `core.openwop.triggers` nodes "forward `ctx.triggerData` as today" (RFC 0083 §Implementation notes) — but "today" is host-private and unspecified.

2. **No registration contract for external sources.** A schedule registers as a trigger node; a webhook registers via `POST /v1/webhooks` (`webhooks.md`). But neither binds a subscription to **a workflow to start** with **a dedup config** and **a verification policy** in one portable request. RFC 0083 UQ1 deliberately kept per-source management paths and added only a unified *read* surface (`GET /v1/trigger-subscriptions`); there is no unified *create* surface for an external-event subscription, so "register an email-triggered run on host A, port it to host B" is not expressible.

3. **No defined SSRF/replay posture for ingestion.** An external-event ingestion path may itself fetch (verify a webhook by calling back the sender's well-known, resolve an email attachment URL, fetch a form's file upload). RFC 0083 is silent on this because it specifies the *bridge*, not the *ingestion*; the SSRF guard (RFC 0076 §B `httpClient.safeFetch`) and the trigger content-redaction MUSTs (RFC 0083 §C) exist but aren't bound to the external-event path. And an external event is the *canonical* replay-injection vector — a re-delivered webhook MUST be deduplicated, never re-fetched at replay (RFC 0006 §C cache).

The spec is the right place because **external-event ingestion is a cross-host interop + safety concern**: a portable workflow that starts on an inbound email must receive the same `TriggerEvent` shape on every conformant host, and the SSRF/replay invariants must hold uniformly or the wire claim is dishonest (`OPENWOP_REQUIRE_BEHAVIOR=true`). This is **not** a new primitive — it is the external-event leg of the existing RFC 0083 bridge, additive over the four-state machine, the delivery model, and the causation edge already Accepted.

## Proposal

### §F.1 — The `TriggerEvent` envelope (`trigger-event.schema.json`, NEW)

When an external event is delivered to an `active` subscription and starts a run, the host normalizes it into a **`TriggerEvent`** and hands it to the run as `ctx.triggerData`. This is the **in-run** payload (NOT a `run.*` event payload — it never appears on the durable event log; the `trigger.delivery.attempted` event stays content-free per RFC 0083 §C):

```jsonc
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://openwop.dev/spec/v1/trigger-event.schema.json",
  "title": "TriggerEvent",
  "type": "object",
  "additionalProperties": false,
  "required": ["source", "subscriptionId", "deliveryId", "receivedAt"],
  "properties": {
    "source":         { "type": "string", "enum": ["webhook", "email", "form"] },
    "subscriptionId": { "type": "string", "minLength": 1 },
    "deliveryId":     { "type": "string", "minLength": 1, "description": "Stable per-delivery id; equals the `causationId` stamped on `run.started` (RFC 0083 §C-3 / RFC 0040)." },
    "dedupKey":       { "type": "string", "description": "The host-opaque dedup key (RFC 0083 §C-1). Present iff `dedupEnabled`." },
    "receivedAt":     { "type": "string", "format": "date-time" },
    "verified":       { "type": "boolean", "description": "Whether the host verified the source's authenticity (webhook signature / email DMARC / form CSRF+origin) before delivery. A run MUST be able to gate on this; see §F.4." },
    "contentTrust":   { "type": "string", "enum": ["untrusted"], "description": "Always `untrusted`. Inbound external content fed to an LLM node MUST be wrapped per `threat-model-prompt-injection.md`." },
    "webhook":        { "$ref": "#/$defs/WebhookEvent" },
    "email":          { "$ref": "#/$defs/EmailEvent" },
    "form":           { "$ref": "#/$defs/FormEvent" }
  },
  "$defs": {
    "WebhookEvent": {
      "type": "object", "additionalProperties": false,
      "properties": {
        "method":  { "type": "string", "enum": ["POST", "PUT", "PATCH"] },
        "headers": { "type": "object", "additionalProperties": { "type": "string" }, "description": "Host-allowlisted headers only — a host MUST NOT pass through `Authorization`, `Cookie`, or any header carrying credential material (SR-1)." },
        "body":    { "description": "The parsed JSON body, or a string for non-JSON. Bounded by `triggerBridge.ingestion.maxBodyBytes`." }
      }
    },
    "EmailEvent": {
      "type": "object", "additionalProperties": false,
      "properties": {
        "from":         { "type": "string" },
        "to":           { "type": "array", "items": { "type": "string" } },
        "subject":      { "type": "string" },
        "text":         { "type": "string" },
        "html":         { "type": "string" },
        "attachments":  { "type": "array", "items": { "$ref": "#/$defs/AttachmentRef" } }
      }
    },
    "FormEvent": {
      "type": "object", "additionalProperties": false,
      "properties": {
        "fields":  { "type": "object", "additionalProperties": true, "description": "The submitted field map." },
        "files":   { "type": "array", "items": { "$ref": "#/$defs/AttachmentRef" } }
      }
    },
    "AttachmentRef": {
      "type": "object", "additionalProperties": false,
      "required": ["ref"],
      "properties": {
        "ref":      { "type": "string", "description": "A host-internal opaque handle (e.g. a `host.blobStorage` key). NEVER a raw external URL the run is expected to fetch — the host resolves and ingests attachments through its SSRF guard (§F.4), then hands the run an internal ref." },
        "filename": { "type": "string" },
        "mediaType":{ "type": "string" },
        "bytes":    { "type": "integer", "minimum": 0 }
      }
    }
  }
}
```

Normative shape rules:

- A `TriggerEvent` MUST carry exactly the per-source sub-object matching its `source` and MUST NOT carry the others.
- `contentTrust` MUST be `"untrusted"`. A host MUST treat all `TriggerEvent` content as untrusted input: content reaching an LLM node MUST be wrapped per `threat-model-prompt-injection.md` §"UNTRUSTED", and a `TriggerEvent` MUST NOT directly advance a HITL approval gate (the `prompt-injection-mcp-no-approval` invariant generalizes — an external sender cannot vote on the host's approvals).
- `webhook.headers` MUST be a host-curated allowlist; the host MUST NOT pass through `Authorization`, `Cookie`, `Proxy-Authorization`, or any header carrying credential material (SR-1).
- `AttachmentRef.ref` MUST be a host-internal opaque handle, never an external URL the run is expected to fetch itself — attachment/file resolution is the host's responsibility through its SSRF guard (§F.4).

### §F.2 — The subscription-registration contract (`trigger-subscription-registration.schema.json`, NEW)

An external-event subscription is created with a **`TriggerSubscriptionRegistration`** request, served by an additive `POST /v1/trigger-subscriptions`. This is the portable create surface RFC 0083 UQ1 left per-source; it returns a `TriggerSubscription` (RFC 0083 §B) plus the source-specific binding the caller needs (the webhook ingestion URL + signing secret fingerprint, the email ingestion address, or the form ingestion URL):

```jsonc
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://openwop.dev/spec/v1/trigger-subscription-registration.schema.json",
  "title": "TriggerSubscriptionRegistration",
  "type": "object",
  "additionalProperties": false,
  "required": ["source", "workflowId"],
  "properties": {
    "source":       { "type": "string", "enum": ["webhook", "email", "form"] },
    "workflowId":   { "type": "string", "minLength": 1, "description": "The Workflow a delivered event starts (the run's `workflowId`). MUST resolve under the caller's RFC 0048 owner triple — a registration MUST NOT bind a workflow the caller cannot start (RFC 0049 scope check)." },
    "dedupEnabled": { "type": "boolean", "default": true, "description": "Per RFC 0083 §C-1. Defaults true for external sources — at-least-once inbound delivery without dedup is a footgun." },
    "retryPolicy":  { "$ref": "https://openwop.dev/spec/v1/trigger-subscription.schema.json#/properties/retryPolicy" },
    "verification": {
      "type": "object", "additionalProperties": false,
      "description": "Source-authenticity policy. The host MUST verify per this policy BEFORE delivery and stamp `TriggerEvent.verified`; an event failing a `required` verification MUST NOT start a run (it transitions `trigger.delivery.attempted{outcome:'dead-lettered'}` with `state.changed.reason:'signature-invalid'`).",
      "properties": {
        "mode":  { "type": "string", "enum": ["required", "best-effort", "none"], "default": "required" }
      }
    },
    "inputMapping": { "type": "object", "additionalProperties": true, "description": "OPTIONAL host-extension hint mapping `TriggerEvent` fields onto the workflow's `inputs`. Non-normative shape (host-specific); absent ⇒ the run receives the whole `TriggerEvent` as `ctx.triggerData`." }
  }
}
```

The **response** carries the created `TriggerSubscription` plus a source-specific `binding` object: for `webhook`, `{ ingestUrl, secretFingerprint }` (reusing the `webhooks.md` register keys + RFC 0083's truncated-digest fingerprint rule); for `email`, `{ ingestAddress }`; for `form`, `{ ingestUrl }`. The binding's secret/URL is returned **once** at creation (it is not re-fetchable in cleartext — re-reading the subscription via `GET /v1/trigger-subscriptions/{id}` returns the fingerprint, never the secret).

### §F.3 — The `triggerBridge.ingestion` capability sub-block (additive)

```jsonc
"triggerBridge": {
  "supported": true,
  "subscriptionStates": ["active","paused","failed","dead-lettered"],
  "dedup": true,
  "retryPolicy": { "maxAttempts": 8, "backoff": "exponential" },
  "sources": ["webhook","schedule","queue","email","form"],
  "ingestion": {                                    // NEW — additive sub-block
    "externalSources": ["webhook","email","form"],  // which of `sources` are EXTERNALLY ingested per this RFC
    "maxBodyBytes": 1048576,                         // inbound body cap (webhook body / email / form), reuses RFC 0076 §B response-cap discipline
    "verification": ["webhook-signature","email-dmarc","form-origin"],  // which authenticity checks the host performs
    "registrationEndpoint": true                     // host serves POST /v1/trigger-subscriptions (§F.2)
  }
}
```

`ingestion.externalSources[]` is the honesty gate: a source listed here MUST actually accept an externally-originated event, normalize it to a `TriggerEvent` (§F.1), and start a run — over-claiming a source the host merely *lists* in `sources[]` (e.g. for a vendor channel that hasn't wired external ingestion) is a dishonest advertisement. A consumer MUST tolerate any subset; absent `ingestion` ⇒ the host does not externally-ingest (today's behavior — schedule/queue only).

### §F.4 — SSRF + replay safety (NEW SECURITY invariants)

The external-event ingestion path is a network ingress and a replay-injection vector. Two invariants:

- **`trigger-ingestion-ssrf`** — ANY host-side fetch the ingestion path performs (webhook verification callback, email-attachment resolution, form file-upload retrieval) MUST go through the RFC 0076 §B SSRF guard (`assertPublicUrl` / `httpClient.safeFetch`): no fetch to a private/link-local/loopback address, with the `maxResponseBodyBytes` cap. The host MUST NOT hand the run an external URL to fetch itself (`AttachmentRef.ref` is a host-internal handle, §F.1) — all external fetching is host-mediated and guarded.
- **`trigger-ingestion-content-redaction`** — the inbound body, headers, email content, and form fields MUST NOT appear on any `run.*` / `trigger.*` durable event payload (RFC 0083 §C content-freeness, generalized to the external sources). The content lives ONLY in `ctx.triggerData` (the in-run `TriggerEvent`, never event-logged) and the run's own variables (SR-1 redaction applies). `dedupKey` MUST be host-opaque and MUST NOT embed inbound body/header content in cleartext (RFC 0083 §C).

**Replay determinism.** A delivered `TriggerEvent` is cached in the run's start payload (the run's input snapshot), exactly as RFC 0006 §C requires for nondeterministic inputs. At replay the host MUST replay the cached `TriggerEvent`, MUST NOT re-accept or re-fetch the external event, and a re-delivery of the same `dedupKey` within the retention window is a no-op returning the prior `runId` (RFC 0083 §C-1, the at-least-once → effectively-once edge). This makes a replayed external-triggered run deterministic.

### Examples

**Positive.** A host advertises `triggerBridge.ingestion.externalSources: ["webhook","email","form"]`. A caller `POST /v1/trigger-subscriptions { source:"email", workflowId:"triage-support", verification:{mode:"required"} }` → `201` with `{ subscription:{subscriptionId:"sub_7", state:"active", source:"email"}, binding:{ingestAddress:"triage-support+sub_7@in.example.com"} }`. An inbound email to that address with passing DMARC → the host normalizes it to a `TriggerEvent{ source:"email", verified:true, contentTrust:"untrusted", email:{from,subject,text,attachments:[{ref:"blob_a1"}]} }`, starts `run_x` against `triage-support` with that as `ctx.triggerData`, stamps `run.started.causationId = deliveryId`, and emits the content-free `trigger.delivery.attempted{ outcome:"delivered", runId:"run_x" }`. A duplicate of the same message-id within retention → no-op returning `run_x`.

**Negative (verification).** An inbound webhook with an invalid signature on a `verification.mode:"required"` subscription → no run; `trigger.delivery.attempted{outcome:"dead-lettered"}` + `trigger.subscription.state.changed{reason:"signature-invalid"}` (RFC 0083 closed reason enum).

**Negative (SSRF).** An email attachment whose resolution would hit `http://169.254.169.254/...` → the host's `assertPublicUrl` rejects the fetch (`trigger-ingestion-ssrf`); the attachment is dropped (`AttachmentRef` omitted), the run still starts on the rest of the event.

**Negative (schema).** A `TriggerEvent` carrying `webhook.headers.Authorization` fails validation/redaction (`trigger-ingestion-content-redaction` + the §F.1 header-allowlist MUST). A `trigger.delivery.attempted` payload carrying the inbound body fails validation (`additionalProperties:false`, RFC 0083 §C — unchanged).

## Compatibility

**Additive** (`COMPATIBILITY.md` §2.1). Two NEW schemas (`trigger-event.schema.json`, `trigger-subscription-registration.schema.json`) — neither is referenced by any existing required field, so no existing document changes shape. One additive optional `triggerBridge.ingestion` sub-block (absent ⇒ the RFC 0083 behavior, schedule/queue ingestion only — unchanged). One additive `POST /v1/trigger-subscriptions` endpoint (RFC 0083 added only the `GET` read surface; this adds the create surface UQ1 deliberately left open — not a change to `POST /v1/webhooks`, which is preserved). The `openwop-trigger-bridge` profile predicate gains `email`/`form` as *additional* durable-source disjuncts in its existing OR (a host already in the profile via queue/durable-webhooks/scheduling stays in it; this only *widens* the satisfying set — a profile widening is additive per `profiles.md` §"Adding a profile", as it MUST NOT cause a previously-passing host to fail). The two `trigger.*` events and their content-free payloads are **unchanged** — this RFC adds no event type and does not touch `eventLogSchemaVersion`. Two NEW SECURITY invariants gate only hosts that advertise `triggerBridge.ingestion`; a host that doesn't externally-ingest is not measured against them. No conformance pass is invalidated.

## Conformance

- **New scenario `trigger-ingestion.test.ts`:**
  - **Shape (always-on, server-free):** `TriggerEvent` validates per source; the per-source one-of rule holds (a `source:"email"` event carrying a `webhook` sub-object fails); `webhook.headers` carrying `Authorization` fails the allowlist MUST; `AttachmentRef` requires `ref` and rejects a raw `url` field; `TriggerSubscriptionRegistration` validates; `contentTrust` is the const `"untrusted"`.
  - **Behavioral (gated on `triggerBridge.ingestion.registrationEndpoint` via `describe.runIf`):** `POST /v1/trigger-subscriptions` for each advertised `externalSources[]` member returns a subscription + binding; a simulated inbound external event starts a run whose `ctx.triggerData` matches the `TriggerEvent` shape, whose `run.started.causationId == deliveryId`, and whose `trigger.delivery.attempted` is content-free; a duplicate `dedupKey` is a no-op returning the prior `runId`; a `verification.mode:"required"` event with a bad signature dead-letters with `reason:"signature-invalid"` and starts no run. Soft-skips when the capability is unadvertised.
  - **SSRF (gated):** an ingestion-path fetch to a private address is refused (`trigger-ingestion-ssrf`), reusing the `http-client-ssrf-guard` fixture posture from RFC 0076.
- **Profile gating** per `profiles.md` + `coverage.md`. The widened predicate's `email`/`form` disjuncts land in `conformance/src/lib/profiles.ts` in the same PR.
- **Reference host.** Deferred to `Active → Accepted` (file lands at `Draft`). The openwop-app reference host (ADR 0033's deferred external-event-triggers item) is the intended evidence host — it gates that host wiring on this RFC reaching at least `Active`.

## Alternatives considered

1. **Carry the inbound body on the `trigger.delivery.attempted` event (no separate in-run `TriggerEvent`).** Rejected — it breaks RFC 0083 §C content-freeness (an inbound URL/header/body on the durable event log is an SR-1 leak and a prompt-injection surface) and bloats the event log with arbitrary external payloads. The `TriggerEvent` is deliberately an *in-run* payload (`ctx.triggerData`), cached for replay, never event-logged.
2. **Reuse `POST /v1/webhooks` for all three sources (no new registration schema).** Rejected — `POST /v1/webhooks` is webhook-specific (signing secret, URL) and has no workflow-binding or dedup/verification policy; email and form have no analog. A unified `TriggerSubscriptionRegistration` is the portable create surface RFC 0083 UQ1 explicitly left for a follow-up.
3. **Make external ingestion a new top-level capability (not a `triggerBridge` sub-block).** Rejected — external ingestion *is* a trigger-bridge source (RFC 0083 already lists `webhook`/`email`/`form` in `sources[]`); a parallel capability would fork the subscription state machine and the delivery model. The `ingestion` sub-block reuses the four-state machine, dedup, retry, and causation already Accepted.
4. **Let the run fetch external attachments itself (pass the URL through).** Rejected — that hands the SSRF surface to every workflow author and breaks replay (re-fetch at replay is nondeterministic and a re-injection vector). Host-mediated, guarded resolution to an internal `AttachmentRef.ref` keeps the SSRF guard in one place and the replay deterministic.
5. **Do nothing.** Rejected — the agent-platform hosts (openwop-app ADR 0033's ten twins) need to start runs from real-world events; without a normative `TriggerEvent` + registration contract, every host invents an incompatible one and "external-event triggers" can't be advertised honestly across hosts.

## Unresolved questions

1. **Form/email source authenticity vocabulary.** §F.3 names `webhook-signature` / `email-dmarc` / `form-origin` as the `verification[]` checks. Is DMARC the right normative email-authenticity floor (vs SPF-only / ARC), and is `form-origin` (Origin/Referer + CSRF token) sufficient for a public form? Proposed: keep the enum extensible (additive growth) and require only that an advertised check is actually performed; defer a stricter floor to implementation feedback.
2. **`inputMapping` normative shape.** §F.2 leaves `inputMapping` a non-normative host-extension hint. Should the spec normate a minimal JSONPath/JMESPath mapping so a ported workflow's input binding survives a host move? Proposed: keep it host-specific for `Draft`; promote to normative only if two hosts converge (the RFC 0083 §E channels-stay-extensions precedent).
3. **Per-source rate limiting on the ingestion endpoints.** An external-facing ingestion URL/address is a DoS surface. Should the RFC normate a per-subscription inbound rate limit, or leave it to the host (the openwop-app `OPENWOP_RATELIMIT_*` precedent)? Proposed: leave to the host as an operational concern; note the `backpressure` closed-reason (RFC 0083) as the dead-letter path on overload.
4. **Binding-secret rotation.** The webhook `binding.secretFingerprint` reuses `webhooks.md` keys — does rotation flow through the existing `webhooks.md` rotation, or does `PATCH /v1/trigger-subscriptions/{id}` rotate it? Proposed: reuse the `webhooks.md` rotation path (don't fork it); confirm against `webhooks.md`.

## Implementation notes (non-normative)

- **Sequencing.** Pure extension of RFC 0083 (`Accepted`) + RFC 0076 §B (`Accepted`, the SSRF guard) + RFC 0040 (causation) + RFC 0006 §C (replay cache). No existing primitive changes. Adds two schemas + one capability sub-block + one endpoint + two invariants + one scenario.
- **Reference host.** The openwop-app work-twin suite (ADR 0033) is the intended evidence host: it would wire `POST /v1/trigger-subscriptions`, a webhook/email/form ingestion path through `host.safeFetch`, the `TriggerEvent` normalizer feeding `ctx.triggerData`, and the dedup+causation stamp (most of which RFC 0083's reference implementation already lays down for schedule/queue). The host wiring is **gated on this RFC reaching at least `Active`** — that gate is the whole point of authoring it.
- **Expected effort:** S for the two schemas + capability sub-block + shape conformance; M for the ingestion path + SSRF guard wiring + behavioral conformance on the reference host.

## Acceptance criteria

Checklist for `Active → Accepted` (file lands at `Draft`):

- [x] `spec/v1/trigger-bridge.md` §F: the `TriggerEvent` envelope, the registration contract, the `ingestion` capability, the SSRF/replay posture.
- [x] `trigger-event.schema.json` + `trigger-subscription-registration.schema.json`; additive `triggerBridge.ingestion` on `capabilities.schema.json`.
- [x] `POST /v1/trigger-subscriptions` in `openapi.yaml` (request = `TriggerSubscriptionRegistration`, response = subscription + binding, ≥1 error response).
- [x] `openwop-trigger-bridge` predicate widened with `email`/`form` disjuncts in `profiles.md` + `conformance/src/lib/profiles.ts`.
- [x] `SECURITY/invariants.yaml`: `trigger-ingestion-ssrf` + `trigger-ingestion-content-redaction`, each with a conformance test.
- [x] Conformance: `trigger-ingestion.test.ts` (shape always-on + behavioral/SSRF gated) + fixture + `coverage.md`.
- [x] CHANGELOG entry + INTEROP-MATRIX note (the `ingestion` sub-block).
- [x] All four Unresolved questions resolved (recorded in `Updated:`).
- [x] Reference host wires external ingestion + passes the gated scenario, OR the RFC explicitly defers reference-host implementation.

## Amendment record

Change history relocated from the `Updated` metadata cell (newest first).

- Reference host **openwop-app** `openwop-app-backend-00177-75t`: `triggerBridge.ingestion` advertised at locked shape (`externalSources:[webhook,email,form]`, `registrationEndpoint:true`), `POST /v1/trigger-subscriptions` route wired (empty→400, authed create→201 with secret-fingerprint-only binding), ingest-path SSRF refused (private-addr attachment dropped, run still starts), `Authorization` stripped from the content-free `trigger.delivery.attempted`, `trigger-ingestion.test.ts` 9/9 non-vacuous.
- Non-steward witness **MyndHyve** `workflow-runtime-00271-cj5`: same caps + the two behavioral legs non-vacuous, honest `verification:[]`/`mode:none` opt-out, `trigger-bridge-delivery` §C causation green.
- **Unresolved questions 1–4 resolved per their Proposed dispositions:** (1) `verification[]` enum stays extensible — an advertised check MUST be performed, no stricter email-authenticity floor mandated yet; (2) `inputMapping` stays a host-extension hint (no two-host convergence yet); (3) per-source inbound rate-limit left to the host as operational, `backpressure` dead-letter on overload; (4).
- binding-secret rotation reuses the `webhooks.md` rotation path (no fork).

## References

- [`RFCS/0083-durable-trigger-and-channel-bridge-profile.md`](./0083-durable-trigger-and-channel-bridge-profile.md) — the durable-trigger bridge this RFC extends: the four-state machine (§B), the delivery/dedup/retry model (§C), the trigger→run causation edge (§C-3), the `triggerBridge` capability + `sources[]` enum (which already lists `webhook`/`email`/`form`), and the content-freeness MUSTs (§C) this RFC generalizes to external sources.
- [`RFCS/0076-pack-runtime-requirements-and-host-safe-fetch.md`](./0076-pack-runtime-requirements-and-host-safe-fetch.md) §B — `httpClient.safeFetch` / `assertPublicUrl` + the `http-client-ssrf-guard` invariant + `maxResponseBodyBytes`, reused for every host-side fetch the ingestion path performs (`trigger-ingestion-ssrf`).
- [`RFCS/0040-multi-agent-cross-host-causation.md`](./0040-multi-agent-cross-host-causation.md) — the `causationId` the delivery→run edge reuses (the `deliveryId` on `run.started`).
- [`spec/v1/webhooks.md`](../spec/v1/webhooks.md) — the best-effort delivery contract + the `(webhookId, secretFingerprint)` register keys + signature verification the webhook source reuses.
- [`spec/v1/idempotency.md`](../spec/v1/idempotency.md) — the Layer-1 dedup model the inbound `dedupKey` reuses (RFC 0083 §C-1).
- [`SECURITY/threat-model-prompt-injection.md`](../SECURITY/threat-model-prompt-injection.md) — the UNTRUSTED-content discipline `TriggerEvent.contentTrust:"untrusted"` invokes (the `prompt-injection-mcp-marker` / `prompt-injection-mcp-no-approval` invariants generalize to external-event content).
- [`spec/v1/profiles.md`](../spec/v1/profiles.md) §"Adding a profile" — the derived-profile machinery + the append-only / widening-is-additive rule.
- openwop-app **ADR 0033 — Work-twin connector reachability** — the motivating host; explicitly defers external-event triggers to "an upstream OpenWOP RFC" (this one). The host wiring is gated on this RFC reaching at least `Active`.
- [`COMPATIBILITY.md`](../COMPATIBILITY.md) §2.1 — additive-change discipline.
