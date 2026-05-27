# RFC 0067: Provider-catalog conventions — provider-name vocabulary + BYOK auth-mode advertisement

| Field | Value |
|---|---|
| **RFC** | 0067 |
| **Title** | Provider-catalog conventions — a stable provider-name vocabulary and a per-provider BYOK auth-mode enum (`apiKey` / `oauth-pkce` / `oauth-device` / `none`) so clients can pre-flight how a host expects a provider's credential to be supplied |
| **Status** | `Draft` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-26 |
| **Updated** | 2026-05-26 |
| **Affects** | `schemas/capabilities.schema.json` (`aiProviders` — additive optional `authModes` map + a non-normative convention list extending `supported`'s description) · `spec/v1/capabilities.md` (§`aiProviders` — auth-mode contract + provider-name vocabulary) · `CHANGELOG.md` · new conformance scenario `byok-auth-modes.test.ts` |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

openwop's `capabilities.aiProviders` advertises which AI providers a host can route to (`supported`) and which permit BYOK (`byok`), but it does not say *how* a client is expected to supply a provider's credential. As hosts expand their catalog beyond the original handful (OpenRouter, Bedrock, Ollama, vLLM, …) the supply mechanism diverges — an API-key header, an OAuth PKCE flow, an OAuth device flow, or no credential at all (a local or platform-managed provider). This RFC adds an **additive optional `aiProviders.authModes`** map — `{ <providerId>: ("apiKey" | "oauth-pkce" | "oauth-device" | "none")[] }` — so a client can pre-flight the credential UX without trial-and-error, and pins a **non-normative provider-name vocabulary** so independently-built hosts converge on the same ids. No existing required field changes; hosts that omit `authModes` keep today's "BYOK ⇒ `ai.credentialRef`" default.

## Motivation

The feature-gap analysis (`docs/OPENWOP-FEATURE-GAP-ANALYSIS.md` row 3) calls for expanding the provider catalog from ~4 to ~20+ providers (OpenRouter, LiteLLM, Vercel/Cloudflare AI Gateway, Together, Bedrock, Qwen, Ollama, vLLM, HuggingFace, …). The schema already tolerates arbitrary provider ids in `aiProviders.supported` (`string[]`, `minLength: 1`, vendor-prefixed extensions allowed), so the *catalog* is not blocked. Two cross-host gaps remain:

1. **Auth-mode opacity.** `capabilities.md §aiProviders` says BYOK providers accept an opaque `ai.credentialRef`. That is correct for an API-key provider, but it says nothing about a provider whose credential is acquired via an OAuth flow (the host owns the grant per RFC 0047 `host.oauth`) or a provider that needs no credential at all (a local Ollama / vLLM endpoint, or one the host serves from platform-managed keys). A client building a "connect provider X" UX today has to special-case each provider out-of-band. The host already *knows* the answer; it just can't advertise it.
2. **Provider-id drift.** Two hosts that both route to Google's Gemini might advertise `gemini` vs `google` vs `vertex`; OpenRouter as `openrouter` vs `open-router`. Without a recommended vocabulary, a portable client can't map a workflow's `RunOptions.configurable.ai.provider` across hosts.

The spec is the right place for the *advertisement shape* and the *recommended vocabulary* — these are interop concerns a client depends on. The per-provider OAuth flow mechanics stay host-owned (RFC 0047); this RFC only lets a host *declare which mode applies*, it does not normate a new wire flow.

## Proposal

### §A — `capabilities.schema.json`: additive optional `aiProviders.authModes`

```diff
   "aiProviders": {
     "type": "object",
     "properties": {
       "supported": { "...": "unchanged — string[] of provider ids" },
       "byok":      { "...": "unchanged — subset of supported permitting BYOK" },
+      "authModes": {
+        "type": "object",
+        "description": "RFC 0067. Optional per-provider advertisement of HOW the host expects a provider's credential to be supplied. Keys are provider ids appearing in `supported`; values are the auth modes the host honors for that provider. Absent ⇒ no advertisement: a provider in `byok` defaults to `apiKey` semantics (client passes `ai.credentialRef`); a provider in `supported` but not in `byok` defaults to `none` (platform-managed). This map only DESCRIBES the supply mechanism — the per-mode flow mechanics are owned elsewhere (`oauth-pkce`/`oauth-device` compose RFC 0047 `host.oauth`).",
+        "additionalProperties": {
+          "type": "array",
+          "minItems": 1,
+          "uniqueItems": true,
+          "items": {
+            "type": "string",
+            "enum": ["apiKey", "oauth-pkce", "oauth-device", "none"]
+          }
+        }
+      },
       "policies": { "...": "unchanged" },
       "maxInlineMediaBytes": { "...": "unchanged" }
     },
     "additionalProperties": false
   }
```

The four enum values:

| Mode | Meaning | Credential supply |
|---|---|---|
| `apiKey` | Host accepts a stored API-key credential for this provider. | Client passes `RunOptions.configurable.ai.credentialRef` (today's BYOK path). Provider MUST appear in `byok`. |
| `oauth-pkce` | Host acquires a token via an OAuth 2.0 authorization-code + PKCE flow it owns (RFC 0047 `host.oauth`, `grants: ["authorization_code"]`). | Client does NOT pass key material; it references the host-stored credential by `ref` per RFC 0046. The PKCE flow is host-driven. |
| `oauth-device` | Host acquires a token via an OAuth 2.0 device-authorization flow it owns. | Same as `oauth-pkce` — credential referenced, never wired. |
| `none` | Provider needs no caller-supplied credential. | A local provider (Ollama / vLLM at a host-configured endpoint) or one served entirely from platform-managed keys. Client supplies neither `credentialRef` nor key material. Provider MUST NOT appear in `byok`. |

### §B — auth-mode contract (normative)

When a host advertises `aiProviders.authModes`:

1. Every key in `authModes` MUST also appear in `aiProviders.supported`. A host MUST NOT advertise an auth mode for a provider it cannot route to.
2. A provider whose mode array includes `apiKey` MUST also appear in `aiProviders.byok` (the two advertisements MUST agree — `apiKey` *is* the BYOK path).
3. A provider whose mode array is exactly `["none"]` MUST NOT appear in `aiProviders.byok` (`none` means no caller credential; a `byok` listing would contradict it). A provider MAY advertise `["apiKey", "none"]` (BYOK permitted but a platform-managed fallback exists) — such a provider MUST appear in `byok`.
4. A provider advertising `oauth-pkce` or `oauth-device` SHOULD also advertise `capabilities.oauth` (RFC 0047) with a matching provider `id`; the OAuth flow itself is governed by RFC 0047, not this RFC. The credential is referenced by `ref` (RFC 0046 `credential-reference`), never passed as key material on `ai.credentialRef`.
5. Absent `authModes`, the **default contract is unchanged**: a provider in `byok` behaves as `apiKey`; a provider in `supported` but not in `byok` behaves as `none`. Clients MUST tolerate the field's absence and fall back to this default.
6. `authModes` is an advertisement of *capability*, not a per-run *requirement*. Per-provider policy enforcement (must-use-BYOK, model allowlists) remains `aiProviders.policies` (unchanged). A client MUST NOT infer a policy mode from an auth mode.

A client that wants to connect a provider reads `authModes[providerId]` to choose the UX: render an API-key field for `apiKey`, launch the host's OAuth flow for `oauth-pkce`/`oauth-device`, or show "ready to use" for `none`.

### §C — provider-name vocabulary (non-normative convention)

`aiProviders.supported` stays an open `string[]`. To reduce cross-host id drift, hosts SHOULD use the following recommended ids when routing to a known provider (this list extends, and does not replace, the existing description's conventional ids). The list is advisory — a host MAY advertise any vendor-prefixed extension id, and clients MUST tolerate unknown ids.

| Recommended id | Provider |
|---|---|
| `anthropic` | Anthropic |
| `openai` | OpenAI |
| `gemini` | Google Gemini (direct API) |
| `vertex` | Google Vertex AI |
| `bedrock` | AWS Bedrock |
| `mistral` | Mistral |
| `cohere` | Cohere |
| `openrouter` | OpenRouter (aggregator) |
| `litellm` | LiteLLM proxy |
| `together` | Together AI |
| `huggingface` | Hugging Face Inference |
| `qwen` | Alibaba Qwen |
| `ollama` | Ollama (local) |
| `vllm` | vLLM (local/self-hosted) |

Aggregators (`openrouter`, `litellm`) and gateways front many upstream models; the `RunOptions.configurable.ai.model` string disambiguates the upstream model and is host-interpreted. This RFC does not normate a model-id grammar.

### Examples

**Positive.** A host routing to a mix of API-key, OAuth, and local providers:

```json
"aiProviders": {
  "supported": ["anthropic", "openai", "vertex", "ollama"],
  "byok": ["anthropic", "openai"],
  "authModes": {
    "anthropic": ["apiKey"],
    "openai": ["apiKey"],
    "vertex": ["oauth-pkce"],
    "ollama": ["none"]
  }
}
```

A client sees `anthropic`/`openai` → API-key field; `vertex` → launch the host's OAuth PKCE flow (and finds `capabilities.oauth.providers[].id == "vertex"`); `ollama` → ready to use.

**Negative (fails validation / non-conformant).**

```json
"aiProviders": {
  "supported": ["anthropic"],
  "byok": [],
  "authModes": { "anthropic": ["apiKey"] }
}
```

Schema-valid in isolation, but **non-conformant** by §B rule 2: `apiKey` for `anthropic` requires `anthropic` to appear in `byok`. A schema-level negative example: `"authModes": { "anthropic": [] }` fails validation (`minItems: 1`), and `"authModes": { "anthropic": ["device"] }` fails validation (`device` not in the enum — the canonical value is `oauth-device`).

## Compatibility

**Additive.** `aiProviders.authModes` is a new optional field on an existing optional block; `aiProviders` keeps `additionalProperties: false` but gains the property in its `properties` map. No existing field's type, optionality, or meaning changes. The default contract for hosts that omit `authModes` is exactly today's behavior (§B rule 5). Existing clients ignore the field; existing hosts don't emit it. No conformance pass is invalidated. No new error code, event type, or endpoint. The provider-name vocabulary (§C) is non-normative — it imposes no MUST on any host.

Forward-compatibility clauses:
- New field optional with no default emitted by old hosts; consumers MUST tolerate absence and apply the §B rule-5 default.
- The enum is closed at four values; a future mode requires an additive RFC (the array's `items` enum can grow additively since unknown enum values would only ever be *emitted* by a newer host and a `uniqueItems` array tolerates a consumer that doesn't recognize a value — consumers MUST ignore an auth mode they don't recognize rather than reject the discovery doc).

## Conformance

- **Existing coverage.** `conformance/src/scenarios/byok-roundtrip.test.ts` (BYOK credential resolution + redaction) and `policies.test.ts` (per-provider policy modes) cover the adjacent surface. `discovery.test.ts` validates the capabilities document shape. None assert auth-mode advertisement.
- **New scenario — `byok-auth-modes.test.ts`** (always-on shape + capability-gated cross-checks):
  - **Shape (always-on):** when a host advertises `aiProviders.authModes`, the map validates against the schema — every value is a non-empty unique array of the four enum values.
  - **Cross-field consistency (gated on `aiProviders.authModes` present):** every `authModes` key appears in `supported` (§B rule 1); every provider with `apiKey` appears in `byok` (§B rule 2); every provider whose modes are exactly `["none"]` is absent from `byok` (§B rule 3).
  - **OAuth alignment (gated on `authModes` + `capabilities.oauth.supported`):** every provider advertising `oauth-pkce`/`oauth-device` has a matching `capabilities.oauth.providers[].id` (§B rule 4 SHOULD — asserted as a soft check that reports rather than fails when oauth block absent).
  - Hosts that omit `authModes` skip cleanly (the scenario is gated on the field's presence in the discovery doc).
- **Capability gating.** Gated on the presence of `capabilities.aiProviders.authModes` in the discovery response. No new top-level capability flag — the field's presence *is* the gate.
- **Reference host.** Deferred. The in-memory reference host MAY advertise `authModes` in a follow-up; this RFC ships the shape + always-on schema validation. Per the RFC 0027 §G staging precedent, the cross-field behavioral assertions soft-skip until a host advertises the field.

## Alternatives considered

1. **A new top-level `providers` capability block** with a rich per-provider object (`{ id, displayName, authModes, models, … }`). Rejected for `Draft` — it duplicates `aiProviders.supported` and `capabilities.oauth.providers`, creating three places that list providers. Extending `aiProviders` keeps the catalog in one block. (Revisitable if model-catalog advertisement is later demanded.)
2. **A generic `oauth` mode** (no pkce/device split). Rejected — a client building the connect UX needs to know whether to open a browser redirect (PKCE) or display a device code; collapsing them re-introduces the trial-and-error this RFC removes. The two map cleanly onto RFC 0047's grant vocabulary.
3. **Do nothing.** Rejected — the catalog can grow today (open `string[]`), but every new OAuth or local provider forces clients into per-provider out-of-band special-casing. The cost of doing nothing rises linearly with catalog size; the gap analysis explicitly targets a 5× catalog expansion.

## Unresolved questions

1. **Model-catalog advertisement.** Should a host be able to advertise which *models* a provider exposes (so a client can populate a model picker without a separate call)? Out of scope here; would compose with `aiProviders` if demanded. Decide before `Accepted`.
2. **Aggregator semantics.** For `openrouter`/`litellm`, the `ai.model` string addresses an upstream model whose *own* provider may have a different auth mode. This RFC treats the aggregator as one provider with one auth mode (its own gateway key). Is that sufficient, or do aggregators need a nested advertisement? Likely sufficient for v1.x; confirm with an implementer.
3. **`none` + local-endpoint addressing.** A `none` provider (Ollama/vLLM) needs an endpoint URL the host is configured with. Is endpoint addressing purely host-config, or should the discovery doc surface a non-secret base URL for observability? Proposed: host-config only (an endpoint URL is host-internal). Confirm before `Active`.

## Implementation notes (non-normative)

- The reference workflow-engine backend currently dispatches four providers (anthropic, openai, google, minimax). Advertising `authModes` is a one-line addition to its discovery handler once it decides each provider's supply mechanism. No dispatcher change is required to *advertise* — the field describes existing behavior.
- The CLI (`cli/`) can read `authModes` to drive `openwop providers add` UX (API-key prompt vs OAuth launch vs "no credential needed"), per the gap analysis CLI track. That is implementation-only and out of this RFC's scope.

## Acceptance criteria

- [ ] `capabilities.md §aiProviders` documents `authModes` + the auth-mode contract (§B) + the provider-name vocabulary (§C).
- [ ] `capabilities.schema.json` carries the additive optional `aiProviders.authModes` map.
- [ ] `byok-auth-modes.test.ts` covers the shape (always-on) + cross-field consistency (gated on the field's presence).
- [ ] CHANGELOG entry under `[1.1.5 — unreleased]`.
- [ ] Reference host implements + advertises `authModes`, OR this RFC explicitly defers reference-host advertisement (it does — shape + always-on validation ship; cross-field assertions soft-skip until a host advertises).

## References

- [`spec/v1/capabilities.md`](../spec/v1/capabilities.md) §`aiProviders` + §`aiProviders.policies` — the BYOK + policy surface this extends.
- [`RFCS/0046-host-credentials-capability.md`](./0046-host-credentials-capability.md) — credential-reference contract (`oauth-*` modes resolve credentials by `ref`).
- [`RFCS/0047-host-oauth-connector-flows.md`](./0047-host-oauth-connector-flows.md) — the OAuth grant mechanics `oauth-pkce`/`oauth-device` compose.
- [`schemas/capabilities.schema.json`](../schemas/capabilities.schema.json) §`aiProviders`.
- `docs/OPENWOP-FEATURE-GAP-ANALYSIS.md` row 3 (provider-catalog expansion).
- Prior art: OpenRouter / LiteLLM provider-routing conventions; OAuth 2.0 PKCE (RFC 7636) + device-authorization grant (RFC 8628).
