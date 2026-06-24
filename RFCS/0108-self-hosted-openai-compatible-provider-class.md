# RFC 0108: Self-hosted / OpenAI-compatible provider class (`aiProviders.selfHosted[]`)

| Field | Value |
|---|---|
| **RFC** | 0108 |
| **Title** | Self-hosted / OpenAI-compatible provider-class advertisement — `aiProviders.selfHosted[]`, the capability-non-inference rule, and the endpoint-non-disclosure invariant |
| **Status** | `Draft` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-06-23 |
| **Updated** | 2026-06-23 |
| **Affects** | `spec/v1/capabilities.md` (§`aiProviders` — adds the `selfHosted[]` field + the self-hosted advertisement rules) · `spec/v1/host-capabilities.md` (cross-reference) · `schemas/capabilities.schema.json` (adds optional `aiProviders.selfHosted`) · `SECURITY/invariants.yaml` (adds `self-hosted-endpoint-no-disclosure`) · `SECURITY/threat-model-secret-leakage.md` (cross-reference) · ≥1 new conformance scenario · `INTEROP-MATRIX.md` · CHANGELOG |
| **Compatibility** | `additive` per `COMPATIBILITY.md` §2.1 |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

Adds an optional `aiProviders.selfHosted: string[]` advertisement (a subset of `aiProviders.supported`, mirroring the existing `byok[]` shape) that marks which advertised provider ids are **operator- or tenant-configured OpenAI-compatible endpoints** (Ollama, vLLM, LM Studio, or any `/v1/chat/completions`-compatible server) rather than a host-managed connection to a known public vendor. It pins three normative rules a host MUST follow to advertise such a provider **honestly**: (1) advertise it only when a real configured + reachable endpoint backs it (the truthful-advertisement honesty rule, enforced by `OPENWOP_REQUIRE_BEHAVIOR`); (2) never disclose the endpoint's network location (base-URL / host / port) on any wire surface — operator-private infrastructure; (3) a client MUST NOT infer model capabilities from a self-hosted provider id — capability is governed solely by the host's existing RFC 0031 `modelCapabilities.advertised[]` and RFC 0091 modality advertisement. It is the wire-gate that unblocks openwop-app ADR 0121 (local / OpenAI-compatible model provider support).

## Motivation

OpenWOP hosts today advertise the AI providers their proxy can route to in `capabilities.aiProviders.supported[]` (an array of provider-id strings) and the subset that permits BYOK in `aiProviders.byok[]` (`schemas/capabilities.schema.json` §`aiProviders`, lines 749–868). The conventional provider vocabulary (RFC 0067 §C, **advisory, not a closed set**) already lists `ollama` and `vllm`, and `supported[]` tolerates arbitrary ids ("clients MUST tolerate unknown ids"). So a host *can* already put `ollama` in `supported[]`.

What the wire **cannot** express today is the distinction that makes such an advertisement honest and safe:

1. **Managed-cloud vs operator-configured endpoint is invisible.** A client reading `supported: ["anthropic", "ollama"]` cannot tell that `anthropic` is a host-managed connection to a known public vendor while `ollama` is an OpenAI-compatible endpoint someone stood up at a private base-URL. These are materially different trust, capability, and key-custody surfaces.
2. **No honesty rule binds the claim to a real endpoint.** A host could list `ollama` with no endpoint configured; a client (or `OPENWOP_REQUIRE_BEHAVIOR=true` conformance) has no normative hook that says "advertise this class only when a reachable endpoint actually backs it." This is the exact dishonest-capability failure mode RFC 0031 §C ("truthful advertisement") and `capabilities.md` ("advertise what you implement") guard against for other surfaces, but it has never been stated for endpoint-backed providers.
3. **Capability inference from a compat id is unsafe.** For a known vendor a client may reasonably assume a vendor capability set. For an opaque OpenAI-compatible endpoint it must not — the operator may run any model, of any capability, behind that id. There is no rule today forbidding that inference.
4. **The endpoint URL is operator-private infrastructure with no non-disclosure rule.** A tenant's internal endpoint (e.g. `https://vllm.internal:8000/v1`) leaks network topology and enables SSRF reconnaissance if it surfaces in the capabilities document, a `run.*` event, an error envelope, or a debug bundle. The corpus has **no** SSRF/egress invariant; the wire concern here is narrower and belongs on the wire: **non-disclosure** of the endpoint location.

Every surveyed reference app ships this class of provider — LibreChat (`api/app/clients/OllamaClient.js` + the custom-endpoint path), Jan (`RemoteOAIEngine`), AnythingLLM (`server/utils/AiProviders/{ollama,lmStudio,localai,...}`), Open WebUI (`routers/ollama.py` + OpenAI-compatible `routers/openai.py`) — and openwop-app ADR 0121 wants to. The host plumbing (a `compat` dispatch case, a Connection-stored base-URL, a BYOK key) is non-normative and rides Accepted RFCs (0046 credentials, 0007 dispatch, 0031 capabilities). The **advertisement** is the normative gate, and it is the right place to put rules (1)–(4) so every host expresses this class the same honest way.

The spec is the right place because the advertisement is read **cross-host** by clients and the conformance suite; an ad-hoc per-host convention would re-introduce exactly the silent-incompatibility and dishonest-claim problems the capability surface exists to prevent.

## Proposal

### §A — `aiProviders.selfHosted[]` (additive optional field)

Add one optional field to the `aiProviders` object in `schemas/capabilities.schema.json`:

```diff
     "aiProviders": {
       "type": "object",
       "description": "Optional v1 companion to `secrets`. Advertises which AI providers the host's AI-proxy can route to and which permit BYOK.",
       "properties": {
         "supported": { "type": "array", "items": { "type": "string", "minLength": 1 }, "uniqueItems": true, "description": "Provider ids the host's AI-proxy can route to. …" },
         "byok": { "type": "array", "items": { "type": "string", "minLength": 1 }, "uniqueItems": true, "description": "Subset of `supported` for which BYOK is permitted. …" },
+        "selfHosted": {
+          "type": "array",
+          "items": { "type": "string", "minLength": 1 },
+          "uniqueItems": true,
+          "description": "Subset of `supported` whose entries are operator- or tenant-configured OpenAI-compatible endpoints (e.g. an Ollama / vLLM / LM Studio / any `/v1/chat/completions`-compatible server), as opposed to a host-managed connection to a known public vendor. Each entry MUST also appear in `supported`. An entry MAY also appear in `byok` (the endpoint requires a client/tenant-supplied key) or be absent from it (the endpoint needs no key, e.g. a default Ollama). The provider id is an OPAQUE label chosen by the host; it MUST NOT encode the endpoint's network location (per RFC 0108 §A.2). A client MUST NOT infer model capabilities from a `selfHosted` id (per RFC 0108 §B)."
+        },
         "…": "… (authModes, policies, speechSynthesis, input, realtimeVoice, maxInlineMediaBytes unchanged)"
       },
       "additionalProperties": false
     }
```

Add to `spec/v1/capabilities.md` §`aiProviders`, after the `byok[]` paragraph:

> **A.1 — Subset constraint.** Every entry of `aiProviders.selfHosted[]` MUST also appear in `aiProviders.supported[]`. A `selfHosted` entry MAY additionally appear in `aiProviders.byok[]` (the endpoint requires a tenant-supplied key) or not (the endpoint needs no key). `selfHosted` is OPTIONAL; an absent or empty array means the host advertises no self-hosted/compatible endpoints (its `supported[]` entries are all host-managed or BYOK-cloud connections — today's behavior).
>
> **A.2 — Truthful advertisement (normative).** A host MUST list a provider id in `aiProviders.selfHosted[]` only when the host can route to **at least one configured, reachable** OpenAI-compatible endpoint for that id within the advertising scope. Listing a self-hosted provider with no backing endpoint is a dishonest capability claim per `capabilities.md` §"Truthful advertisement" and is non-conformant; `OPENWOP_REQUIRE_BEHAVIOR=true` MUST fail it. (The capabilities document is host-scoped: a host MAY advertise the class when at least one tenant in the advertising scope has a configured endpoint; per-tenant existence is not separately advertised.)
>
> **A.3 — Endpoint non-disclosure (normative).** The provider id in `selfHosted[]` is an opaque host-chosen label. A host MUST NOT encode the endpoint's network location (scheme, host, port, path, or base-URL) in the provider id, and MUST NOT disclose that location on any wire surface (the capabilities document, any `run.*` event payload, error envelopes, the debug bundle, exports, or replay state). See the `self-hosted-endpoint-no-disclosure` SECURITY invariant (§D).

### §B — Capability non-inference for self-hosted providers (normative)

Add to `spec/v1/capabilities.md` §`aiProviders` (and cross-reference from `host-capabilities.md` §"Model-capability declarations"):

> For a provider id present in `aiProviders.selfHosted[]`, a client MUST NOT infer model capabilities (e.g. `structured-output`, `discriminator-enum`, `function-calling`, `long-context`, `reasoning` per RFC 0031 §C, or input modalities per RFC 0091) from the provider id or from any known-vendor capability mapping. The **only** authoritative source of a self-hosted provider's capabilities is what the host actually advertises and gates on: `capabilities.modelCapabilities.advertised[]` (RFC 0031 §E) and `aiProviders.input.modalities` (RFC 0091). A self-hosted endpoint whose capabilities the host does not advertise is treated as text-only; the host MUST refuse a request for an unadvertised capability or modality per the RFC 0031 §B model-capability gate (`capability_not_provided`), exactly as for any other provider. This rule prevents a client from assuming, e.g., that a `selfHosted` id named `ollama` supports vision merely because some public deployment of that engine does.

How a host *derives* a self-hosted endpoint's capabilities — a static declaration captured at configuration time, or a runtime probe of the endpoint — is host-internal and out of scope (see Unresolved question 2). The wire surface is the advertised result, identical to RFC 0031 §C ("the protocol does not normate how the host derives the mapping").

### §C — Key custody (carry-forward, non-normative restatement)

When a `selfHosted` endpoint requires a key, that key is a BYOK credential governed by **RFC 0046** (transmitted only as an opaque `CredentialReference`, resolved into the dispatch path, never in plaintext on the wire) and the `credential-payload-redaction` / SR-1 (`secret-leakage-eventlog-payload`) invariants. This RFC adds no new credential surface; it relies on RFC 0046 verbatim. The endpoint **base-URL is configuration, not a credential** — but it is operator-private infrastructure, which §A.3 + §D govern with their own non-disclosure rule.

### §D — SECURITY invariant: `self-hosted-endpoint-no-disclosure`

Add to `SECURITY/invariants.yaml`:

```yaml
  - id: self-hosted-endpoint-no-disclosure
    tier: protocol
    severity: medium
    threat_model: SECURITY/threat-model-secret-leakage.md
    tests:
      - conformance/src/scenarios/aiproviders-selfhosted-shape.test.ts
    note: |
      RFC 0108 §A.3: the network location (scheme, host, port, path, base-URL)
      of an `aiProviders.selfHosted[]` endpoint is operator-private
      infrastructure and MUST NOT appear on any wire surface — the capabilities
      document, any run.* event payload, error envelopes, the debug bundle,
      exports, or replay state. The provider id is an opaque host-chosen label
      and MUST NOT encode the endpoint URL. Disclosing the endpoint leaks
      internal network topology and enables SSRF reconnaissance against the
      operator's network. Distinct from credential-payload-redaction (RFC 0046):
      the endpoint URL is not a credential, but it is private infrastructure.
```

Severity is `medium` (not `critical`): the leaked datum is a network location, not key material; the operator chose to expose an OpenAI-compatible endpoint to their host; and the principal harm (SSRF reconnaissance / topology disclosure) is a step toward, not itself, compromise. It pairs with the §E shape scenario, which statically asserts that no `selfHosted[]` id is URL-shaped.

### §E — Conformance

One new scenario lands with this RFC; a second behavioral scenario is sketched for the Active→Accepted gate.

- **`aiproviders-selfhosted-shape.test.ts`** (server-free, **always-run** shape gate; soft-skips when `aiProviders.selfHosted` is absent per `coverage.md` §"Capability-gated scenarios"). Asserts, for the host's published capabilities document:
  1. `aiProviders.selfHosted` (when present) is a `string[]` with `uniqueItems`;
  2. every entry is a subset of `aiProviders.supported` (§A.1);
  3. **no entry is URL-shaped** — no entry contains `://`, a bare `host:port`, or a leading `/` path (a cheap static enforcement of the §A.3 / §D non-disclosure rule that the opaque id does not encode the endpoint).
  Uses `driver.describe('capabilities.md §aiProviders', 'selfHosted is a non-URL subset of supported')` so failures cite the requirement. <1s, no LLM.

- **`aiproviders-selfhosted-honesty.test.ts`** (Active→Accepted gate; gated on `aiProviders.selfHosted.length > 0` + the existing capabilities fetch). Host-attested behavioral check: drives one chat/dispatch against a `selfHosted` provider id and asserts (1) the dispatch succeeds or fails with a transport error from a **real** endpoint (not a "no provider configured" `capability_not_provided`, which would prove the §A.2 dishonest-advertisement violation), and (2) neither the resulting `run.*` events nor any error payload contains a URL-shaped string matching the host's (test-supplied, out-of-band) endpoint location (the §D disclosure check). Gated; soft-skips for hosts that don't advertise the class.

The `behaviorGate` helper gains a `requireSelfHostedProviders()` predicate, mirroring `requireModelCapabilities()` (RFC 0031).

## Compatibility

**Additive** per `COMPATIBILITY.md` §2.1:

- **New optional field** in a server-emitted shape (the capabilities document). `aiProviders` is `additionalProperties: false`, so `selfHosted` is added to its `properties` (the additive schema change); server-emitted shapes are open by convention, so v1.x hosts that don't emit it remain conformant, and clients that don't read it see today's behavior (a `selfHosted` provider simply appears as an opaque entry in `supported[]`, exactly as a host could already list `ollama`).
- **No existing field changes.** `supported[]`, `byok[]`, `authModes`, `policies` are untouched.
- **No event-type, endpoint, or error-code changes.** §B reuses RFC 0031's `capability_not_provided`; §C reuses RFC 0046 verbatim.
- **New `MUST`s apply only to hosts that advertise the new field.** §A.2/§A.3/§B/§D bind a host **once it lists a provider in `selfHosted[]`**. A host that never advertises the class is unaffected.
- **New SECURITY invariant** is additive (a new MUST-NOT scoped to the new field), gated by the §E scenario.

Forward-compatibility guarantees: a client on an older spix that ignores `selfHosted[]` treats every `supported[]` entry as it does today (managed or BYOK per `byok[]`); a host that omits `selfHosted[]` makes no new claim. There is no migration; nothing existing must change.

## Conformance

- **Existing coverage:** `aiproviders-input-shape.test.ts` (RFC 0091 modality shape), `aiproviders-speechsynth-shape.test.ts` (RFC 0105), `providerPolicyEnforcement.test.ts` (RFC 0067 policies), `provider-usage.test.ts` (RFC 0026) — all capability-gated on an `aiProviders.*` sub-field. This RFC follows the same server-free-shape-first pattern.
- **New scenarios:** §E above (`aiproviders-selfhosted-shape.test.ts` at Draft→Active; `aiproviders-selfhosted-honesty.test.ts` at Active→Accepted).
- **Capability gating:** both soft-skip (SKIPPED, not FAILED) when `aiProviders.selfHosted` is absent/empty, per `coverage.md`.

## Alternatives considered

1. **Do nothing — rely on the advisory vocabulary.** `supported[]` already tolerates `ollama`/`vllm`. Rejected: it leaves the four motivating gaps open — managed vs self-hosted is invisible, no honesty rule, no capability-inference ban, no endpoint-non-disclosure invariant. A host listing `ollama` today is making an ambiguous, ungoverned claim; that is exactly the dishonest-capability failure the surface exists to prevent.
2. **A richer `aiProviders.providerClasses` map** (`{ "<id>": { class: "managed-cloud" | "byok-cloud" | "byok-self-hosted", capabilitySource: "advertised" | "probe" } }`). Deferred (Unresolved question 1). A boolean-style `selfHosted[]` subset mirrors the existing `byok[]` minimalism and closes the gate; the richer taxonomy is itself additive and can land later without breaking `selfHosted[]` (a class map would make `selfHosted` derivable). Shipping the map now over-specifies a taxonomy before any host needs the `byok-cloud` vs `managed-cloud` distinction on the wire.
3. **A new top-level capability block** (`capabilities.selfHostedProviders`) separate from `aiProviders`. Rejected — this is intrinsically an `aiProviders` refinement (a subset-of-`supported` classifier); a sibling block fragments the provider surface and forces clients to reconcile two provider lists.
4. **Define a normative SSRF / egress requirement on the wire** (the host MUST SSRF-guard the configured base-URL). Rejected — egress enforcement is host-internal (`CONTRIBUTING.md` §"What's in scope" excludes internal data structures + implementation); the corpus has no egress invariant for good reason. The wire-observable concern is **non-disclosure** of the endpoint (§A.3/§D), not how the host fetches it. SSRF-guarding the configured endpoint remains the host's responsibility (openwop-app ADR 0121 §egress; the LibreChat #13919 lesson) and is called out as an implementation note, not normated here.
5. **"do nothing" / defer to per-host READMEs.** Rejected — cross-host clients and the conformance suite read the capabilities document, not host READMEs; an unspecified convention reproduces silent incompatibility.

## Unresolved questions

1. **Flag vs taxonomy.** Ship the minimal `selfHosted[]` subset (this RFC) or the richer `providerClasses` map (managed-cloud / byok-cloud / byok-self-hosted) now? Recommendation: flag now; promote to a map additively when a host needs the managed-vs-byok-cloud distinction on the wire. (Blocks nothing — the map is a future additive bump.)
2. **Declared vs probed capability source.** Should the wire advertise *how* a self-hosted provider's capabilities were derived (operator declaration vs runtime probe)? Recommendation: no — capability advertisement is RFC 0031's job and the source is host-internal (RFC 0031 §C precedent); a client cares about the advertised result, not its provenance. (openwop-app ADR 0121 OQ-2.)
3. **Native-protocol vs OpenAI-wire endpoints.** A few engines (e.g. Ollama's native `/api/*`) speak a non-OpenAI protocol. Does the wire need to distinguish "OpenAI-compatible" from "native"? Recommendation: no — the provider id + the host's `modelCapabilities`/modality advertisement fully describe what a client may send; the transport is host-internal. The field name says "OpenAI-compatible" as the common case but the rules are protocol-agnostic.
4. **Loopback vs internal-network self-hosted.** ADR 0121 OQ-3 distinguishes true-local (`http://localhost:11434`) from internal-network endpoints for the host's SSRF policy. Does the wire need to express that? Recommendation: no — that is an egress-policy detail (host-internal, see Alternative 4); the wire only requires that the location is not disclosed.
5. **Per-scope honesty semantics.** §A.2 makes the capabilities document host-scoped ("advertise the class when ≥1 tenant has a configured endpoint"). Confirm clients do not read `selfHosted[]` as "*you* have an endpoint" but as "*this host supports* configuring one." Recommendation: document the host-scope reading explicitly in `capabilities.md` (the same scope semantics `byok[]` already has).

## Implementation notes (non-normative)

- **Reference host:** openwop-app ADR 0121 (`docs/adr/0121-local-model-provider-support.md`). The host adds a `compat` dispatch case (reusing its existing OpenAI-compatible chat-completions path with a per-connection base-URL — the `minimax` precedent), stores `{baseUrl, apiKey?, capabilities?}` as an ADR 0024 Connection, and advertises the provider id in `aiProviders.supported[]` **and** `aiProviders.selfHosted[]` **only** when a reachable endpoint is configured for the advertising scope (the §A.2 honesty gate, enforced under `OPENWOP_REQUIRE_BEHAVIOR`). Its `routes/discovery.ts` populates `selfHosted[]` from the configured `compat` Connections; its `modelCapabilityProbe` contributes the endpoint's declared capabilities to `modelCapabilities.advertised[]` (§B).
- **Endpoint non-disclosure (§D)** is satisfied by choosing a stable opaque id (e.g. `compat` or `compat:<connectionLabel>` with no URL) and never serialising the base-URL into discovery, events, or errors. The §E shape scenario statically catches a URL-shaped id; the host is responsible for keeping the base-URL out of event/error payloads (the same redaction harness as RFC 0046).
- **Egress** (SSRF-guarding the operator-supplied base-URL: private-IP block, https-only except an explicitly-enabled loopback, redirect re-validation) is host-internal per Alternative 4 and lives in ADR 0121 §egress — not normated here.
- **Effort:** schema field + spec text ~0.5 day; the SECURITY invariant ~0.25 day; the shape conformance scenario ~0.5 day; reference-host advertisement + the honesty gate (mostly ADR 0121 work) ~1 day; CHANGELOG + INTEROP-MATRIX ~30 min.

## Acceptance criteria

Promotion `Draft → Active`:
- [ ] Comment window opens; Unresolved questions 1–5 have a recommended resolution recorded.
- [ ] `schemas/capabilities.schema.json` `aiProviders.selfHosted` field locked (shape frozen).
- [ ] `spec/v1/capabilities.md` §`aiProviders` extended with §A (selfHosted + A.1/A.2/A.3) and §B (capability non-inference).

Promotion `Active → Accepted`:
- [ ] `spec/v1/capabilities.md` + `host-capabilities.md` cross-reference text merged.
- [ ] `schemas/capabilities.schema.json` merged with `aiProviders.selfHosted`.
- [ ] `SECURITY/invariants.yaml` gains `self-hosted-endpoint-no-disclosure` (§D).
- [ ] `aiproviders-selfhosted-shape.test.ts` lands in `@openwop/openwop-conformance`; suite minor-version bumps.
- [ ] CHANGELOG entry under `[Unreleased]`.
- [ ] `INTEROP-MATRIX.md` gains the `aiProviders.selfHosted` advertisement column/note.
- [ ] Reference host (openwop-app, ADR 0121) advertises `aiProviders.selfHosted[]` for a configured compat endpoint, passes `aiproviders-selfhosted-shape.test.ts` + the honesty scenario, and keeps the endpoint URL off the wire (§D). MAY close the third-party gate under the bootstrap-phase steward waiver (the RFC 0031 / 0046 / 0095 precedent), or via dual-witness with a second host advertising the class.

## References

- `RFCS/0031-envelope-variants-and-model-capabilities.md` — the `capabilities.modelCapabilities.advertised[]` surface §B relies on for capability non-inference; the "truthful advertisement" normation §A.2 mirrors.
- `RFCS/0046-host-credentials-capability.md` — the BYOK `CredentialReference` + `credential-payload-redaction` invariant §C carries forward for the optional endpoint key.
- `RFCS/0067-*` (provider auth modes / advisory vocabulary) — `aiProviders.supported`/`byok`/`authModes`/`policies` shape and the advisory provider vocabulary that already lists `ollama`/`vllm`.
- `RFCS/0007-dispatch.md`, `RFCS/0026-provider-usage-event.md` — adjacent provider-dispatch + usage surfaces (no change here).
- `RFCS/0091-*` — `aiProviders.input.modalities`, the other authoritative capability source named in §B.
- `spec/v1/capabilities.md` §`aiProviders` — the surface extended.
- `SECURITY/threat-model-secret-leakage.md`, `SECURITY/threat-model-provider-policy.md` — the threat models §D/§B reference.
- `schemas/capabilities.schema.json` §`aiProviders` (lines 749–868) — the object the `selfHosted` field is added to.
- openwop-app `docs/adr/0121-local-model-provider-support.md` — the reference-host consumer this RFC unblocks; `docs/research/2026-06-23-ai-chat-competitive-analysis.md` §9 (B12), §11 — the cross-competitor motivation (LibreChat `OllamaClient.js`, Jan `RemoteOAIEngine`, AnythingLLM local providers, Open WebUI `routers/ollama.py`).
