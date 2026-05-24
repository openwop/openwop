# RFC 0045: Connector pack manifest & action model

| Field | Value |
|---|---|
| **RFC** | 0045 |
| **Title** | A manifest-first `connector` block that lets a pack declare itself a named integration exposing typed **actions** (reusing the existing trigger model), each bound to an RFC 0047 `auth` declaration + RFC 0046 `requiredCredentials`, with standardized idempotency / retry / rate-limit metadata — the n8n/Make "connector" abstraction, expressed the openwop way |
| **Status** | `Draft` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-24 |
| **Updated** | 2026-05-24 |
| **Affects** | `schemas/node-pack-manifest.schema.json` (additive optional `connector` block) · `spec/v1/node-packs.md` (new §"Connectors") · `registry/` index + `packs.openwop.dev` (connectors surface in discovery) · new conformance scenarios |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

Add an optional `connector` block to the node-pack manifest so a pack can declare itself a **named integration** — a Salesforce/Slack/Stripe-style bundle of typed **actions** (and the existing triggers), each binding to an RFC 0047 `auth` declaration and RFC 0046 `requiredCredentials`, with standardized `idempotent` / `rateLimit` / `paginated` metadata the host scheduler can honor. This is the "Connector SDK" gap from the gap analysis, done manifest-first rather than as a code SDK: a connector becomes an installable, registry-listable artifact any conformant host can run, not host-locked code.

## Motivation

openwop packs are strong on **triggers** (`core.openwop.triggers`, 16 of them) and AI/agent nodes, but there is **no standard connector abstraction** — the n8n/Make *trigger + action + auth + pagination* bundle. MyndHyve's outbound integrations (Slack post, email send, CRM upsert, commerce order, ads publish) are ad-hoc nodes inside `vendor.myndhyve.*` packs, each re-implementing auth wiring, retry, and rate-limit handling differently. There is no portable contract for "a Salesforce connector" another host could install. Without one, MyndHyve's 38 integration packs stay host-locked and absent from the registry — and the future connector marketplace (App-layer) has no data to render.

The leverage here is multiplicative: RFC 0046 + 0047 make credentials and tokens portable, but a *connector* is the unit operators actually install. This RFC is the manifest shape that ties them together.

## Proposal

### §A — `node-pack-manifest.schema.json`: optional `connector` block (additive)

```diff
   "type": "object",
   "properties": {
     "name": { ... },
     "nodes": { ... },
+    "connector": {
+      "type": "object",
+      "description": "RFC 0045. Declares this pack a named connector — a typed integration. Optional; packs without it remain plain node packs.",
+      "required": ["id", "displayName"],
+      "properties": {
+        "id": { "type": "string", "pattern": "^[a-z][a-z0-9.-]*$", "description": "Stable connector id, e.g. `salesforce`." },
+        "displayName": { "type": "string", "minLength": 1 },
+        "auth": { "$ref": "#/$defs/ConnectorAuth", "description": "RFC 0047 auth declaration shared by the connector's actions." },
+        "actions": {
+          "type": "array",
+          "items": {
+            "type": "object",
+            "required": ["typeId", "displayName"],
+            "properties": {
+              "typeId": { "type": "string", "description": "MUST resolve to a node typeId defined in this pack's `nodes`." },
+              "displayName": { "type": "string", "minLength": 1 },
+              "idempotent": { "type": "boolean", "description": "Action is safe to retry without duplicate side effects." },
+              "rateLimit": { "type": "object", "properties": { "requests": { "type": "integer", "minimum": 1 }, "perSeconds": { "type": "integer", "minimum": 1 } }, "additionalProperties": false },
+              "paginated": { "type": "boolean" }
+            },
+            "additionalProperties": false
+          }
+        },
+        "triggers": { "type": "array", "items": { "type": "string", "description": "typeIds of triggers (from the existing trigger model) this connector exposes." } }
+      },
+      "additionalProperties": false
+    }
   }
```

`ConnectorAuth` is the RFC 0047 `{ type: 'oauth2', provider, scopes[] }` shape (or `{ type: 'credential', key, scope? }` pointing at an RFC 0046 `requiredCredentials` entry for non-OAuth integrations like static API keys).

### §B — Action contract (normative)

- An **action** is a normal side-effectful node already defined in the pack's `nodes`; the connector block adds metadata, it does not introduce a new execution kind. Every `actions[].typeId` MUST resolve to a real node typeId in the same manifest (validation error `connector_action_unresolved` otherwise).
- `idempotent: true` is a hint the host scheduler MAY use to retry the action on transient failure without an idempotency key; `idempotent: false` (or absent) means the host MUST NOT auto-retry without one (composes with `spec/v1/idempotency.md`).
- `rateLimit` is advertised metadata the host scheduler SHOULD honor when dispatching the action; it does not change the node's wire shape.
- **Triggers** reuse the existing trigger model unchanged; the connector block only references their typeIds.

### §C — Discovery

Connectors surface in the `registry/` index and on `packs.openwop.dev` as a distinct artifact kind, so the (future App-layer) connector marketplace can render them. This is data-only — no new endpoint; the existing registry pack index gains a `connector` facet.

## Compatibility

**Additive.** New optional manifest block; packs without it are unchanged plain node packs. No new required fields; no wire-shape change to node execution. Existing conformance passes unaffected.

**Depends on RFC 0046 + RFC 0047** for the `requiredCredentials` / `auth` references the block points at. A connector declaring `auth: { type: 'oauth2' }` transitively requires `host.oauth.supported`; one declaring `auth: { type: 'credential' }` requires `host.credentials.supported`.

## Conformance

- **`connector-manifest-validity.test.ts`** — a manifest with a `connector` block parses; every `actions[].typeId` and `triggers[]` entry resolves to a real node/trigger typeId in the same pack; `connector_action_unresolved` is raised when one does not. (Always runs — pure schema/manifest validation.)
- **`connector-idempotency-hint.test.ts`** — an action declared `idempotent: true` is retried by the host on transient failure without producing a duplicate side effect; an `idempotent: false` action is not auto-retried. (Gated on a host that advertises connector support + the relevant credential/oauth capability.)
- **`connector-ratelimit-advertised.test.ts`** — the `rateLimit` metadata round-trips through discovery. (Always runs.)

New fixture: a minimal synthetic connector pack (`conformance.connector.echo`) with one idempotent action + one rate-limited action.

## Alternatives considered

1. **Ship a code-level "Connector SDK" (TypeScript base classes).** Rejected — openwop is a wire protocol; a code SDK is host-language-specific and not portable across the Python/Go SDKs. A manifest-first contract is the portable unit.
2. **Make "connector" a new top-level pack `kind` distinct from node packs.** Rejected — a connector *is* a node pack with extra metadata; a parallel kind would duplicate the manifest's signing, dependency, and registry machinery. An optional block reuses all of it.
3. **Bake retry/rate-limit into each action's node config.** Rejected — that buries scheduler hints inside per-node config where the host can't discover them uniformly. Advertising them at the connector level lets the scheduler reason across a connector's actions.

## Unresolved questions

1. **Connection-test action convention.** Many connectors expose a "test connection" probe. Should the connector block standardize a `testAction` typeId? Deferred until the marketplace UX (App-layer) needs it.
2. **Pagination contract depth.** `paginated: bool` is a hint only; a richer cursor/offset contract could standardize how actions page. Deferred — start with the advertised boolean and let an adopter pull the detail.
3. **Versioning of a connector vs its pack.** Today the connector inherits the pack version. A connector-scoped semver may be wanted later. Defer.

## Implementation notes (non-normative)

- Schema diff (§A) lands on `Active` promotion with the conformance scenarios.
- Reference-adopter target: MyndHyve re-emits its 38 `vendor.myndhyve.*` integration packs with `connector` blocks, deduplicating hand-rolled auth/retry into the shared contract; they become installable on any conformant host and listable in the registry.

## Acceptance criteria

- [ ] Spec text merged (this file).
- [ ] `connector` block in `node-pack-manifest.schema.json`.
- [ ] `spec/v1/node-packs.md` §"Connectors" section.
- [ ] Registry index + `packs.openwop.dev` render the connector facet.
- [ ] Three conformance scenarios + synthetic connector fixture.
- [ ] CHANGELOG entry under `[Unreleased]`.
- [ ] A non-steward host publishes at least one connector pack that installs + runs on a second host (directly advances the GOVERNANCE.md federation tripwire).

## References

- [`RFCS/0046-host-credentials-capability.md`](./0046-host-credentials-capability.md) — `requiredCredentials` referenced by `auth: { type: 'credential' }`.
- [`RFCS/0047-host-oauth-connector-flows.md`](./0047-host-oauth-connector-flows.md) — the `auth: { type: 'oauth2' }` declaration this block embeds.
- [`spec/v1/node-packs.md`](../spec/v1/node-packs.md) — the manifest this block extends.
- [`spec/v1/idempotency.md`](../spec/v1/idempotency.md) — the idempotency layer the `idempotent` action hint composes with.
- n8n nodes, Make modules, Zapier connectors (prior art for the trigger+action+auth bundle).
