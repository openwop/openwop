# RFC 0116: Portable Prompt-Prefix Cache

| Field             | Value                                                                |
| ----------------- | -------------------------------------------------------------------- |
| **RFC**           | 0116                                                                 |
| **Title**         | Portable Prompt-Prefix Cache (`cachePrefixId`)                       |
| **Status**        | `Accepted`                                                           |
| **Author(s)**     | David Tufts (@davidscotttufts)                                       |
| **Created**       | 2026-06-26                                                           |
| **Updated**       | 2026-07-06 (`Active → Accepted` — **single-witness** bootstrap steward waiver + maintainer autonomy grant. tier-1 reference host openwop-app advertises `aiProviders.promptPrefixCache {supported:true, providers:["anthropic"]}` live + serves the prefix-cache probe seam. **Steward-curl-verified** on `app.openwop.dev/api` (`POST /v1/host/openwop-app/aiProviders/prefix-cache-probe`): tenant-A prefix `probe-prefix-1` first call → `{cacheWriteTokens:1000, cacheHit:false}` (write); tenant-A same prefix → `{cacheReadTokens:1000, cacheHit:true}` (hit); **tenant-B same prefix → `{cacheReadTokens:0, cacheHit:false}` (MISS)** — the `prompt-prefix-cache-cross-tenant-isolation` protocol-tier invariant, falsifiable: a `cachePrefixId` collision across tenants does NOT hit, proving `(tenant, cachePrefixId)` keying with no cross-tenant leak. Cost-hint contract (`cacheReadTokens`/`cacheWriteTokens`) observed on the wire. The Anthropic provider call is mocked → RFC 0108 production-dark tier: the cache-KEY isolation is real; the provider routing is dark. Invariant was already protocol-tier (no graduation). Tier-2 (second host advertising `promptPrefixCache`) witness carried forward.) · 2026-06-26 |
| **Affects**       | `spec/v1/ai-envelope.md`, `spec/v1/provider-policy.md`, `schemas/capabilities.schema.json`, `schemas/run-event-payloads.schema.json`, `SECURITY/invariants.yaml`, `SECURITY/threat-model-provider-policy.md`, conformance |
| **Compatibility** | `additive` per `COMPATIBILITY.md`                                    |
| **Supersedes**    | —                                                                    |
| **Superseded by** | —                                                                    |

> **Status: Active.** Merge candidate. The two High-severity risks are **resolved as normative MUSTs** (architect review 2026-06-26): **cross-tenant cache-key leakage** → a mandated `(tenant, cachePrefixId)` key construction + the new protocol-tier invariant `prompt-prefix-cache-cross-tenant-isolation`; **replay divergence** → `cachePrefixId` is a cost-hint-only MUST (recorded envelope + `provider.usage` input/output tokens identical hit-vs-miss). The advert is **provider-scoped** (per ADR 0148 A2), and the cache hit/non-share is **non-vacuously observable** via new cost-only `provider.usage.cacheReadTokens`/`cacheWriteTokens` — so this no longer needs a host-attested benchmark.

## Summary

Modern providers (e.g., Anthropic prompt caching, OpenAI/others) offer server-side context caching keyed by a stable prefix, turning a repeated system-prompt + tool-surface prefix from full-price input into a cheap cache read. OpenWOP has no portable way for a client to *declare* that a request's prefix is cacheable and stable. This RFC adds an optional `cachePrefixId` — a tenant-namespaced, secret-free label carried on the AI-envelope generate request — that a supporting host MAY use to route cacheable prefix content to its provider's cache. It is made safe + testable by three normative pillars: a mandated `(tenant, cachePrefixId)` cache key (cross-tenant isolation), a cost-hint-only contract (replay-invariant outcome), and a wire-observable witness via new cost-only cache-token fields on `provider.usage`.

## Motivation

The tool surface (RFC 0112) and a front-loaded system prompt are the same bytes turn after turn; providers already let you avoid re-billing them, but only if the host pins a stable cache key. Without a protocol field, that optimization is invisible to clients and non-portable across hosts. A declared `cachePrefixId` makes "this prefix is stable, cache it" a first-class, portable hint. The red-team rates this the highest-leverage Tier-B item *and* the riskiest — which is exactly why it warrants an RFC with an honest gap list rather than a silent host feature.

## Proposal

### Field

Add optional `cachePrefixId` to the AI-envelope generate request (`ai-envelope.md` §host.aiEnvelope `ctx.aiEnvelope.generate`):

```diff
  interface AiEnvelopeGenerateRequest {
    // ...existing fields...
+   cachePrefixId?: string;  // RFC 0116. Stable, tenant-namespaced, secret-free label for a cacheable prompt prefix.
  }
```

### Normative requirements

- A host advertising `aiProviders.promptPrefixCache` for the routed provider that receives a request with `cachePrefixId` **MAY** route the stable prefix to that provider's context cache. A host that does not support it (or whose routed provider isn't in the advertised `providers`) **MUST** ignore the field — no error, no behavior change.
- **BYOK (F5).** `cachePrefixId` is a client-chosen opaque label that **MUST NOT** encode or be derived from secret/BYOK material: it is the provider cache key and appears in host logs/metrics. Per `SECURITY/threat-model-secret-leakage.md`, a host **MUST NOT** emit `cachePrefixId` in any payload that the SR-1 harness would otherwise have to redact, and **MUST NOT** persist prompt/response substrings keyed by it.
- **Cross-tenant isolation (F1, normative key construction — invariant `prompt-prefix-cache-cross-tenant-isolation`).** A host **MUST** key its provider context cache by the pair **(resolved tenant, `cachePrefixId`)** — `cachePrefixId` is **tenant-namespaced, never global**. Two distinct tenants supplying the **same** `cachePrefixId` **MUST NOT** share a provider cache entry; tenant B's first use of a `cachePrefixId` that tenant A primed **MUST** be a cache miss. (Cross-tenant cache sharing = context leakage — the central hazard; this mirrors the `kv`/`queue`/`workspace` cross-tenant isolation invariants.)
- **Replay invariance (F2, normative).** `cachePrefixId` is a **cost hint, never a semantic input.** The recorded run outcome — the accepted envelope and `provider.usage.inputTokens` + `outputTokens` — **MUST** be identical whether the prefix cache hit or missed, and **MUST** replay (RFC 0041) identically. A host whose output differs on a cache hit is non-conformant. Only the cost-side cache metrics (below) may differ between hit and miss, and those are explicitly replay-non-asserted.

### `provider.usage` extension — the observable witness (F3)

`provider.usage` (RFC 0026, `schemas/run-event-payloads.schema.json` §providerUsage) gains two **optional, cost-only** fields, denominated like the provider's usage block:

```diff
   "providerUsage": {
     "properties": {
       "inputTokens":  { "...": "MUST replay identically" },
       "outputTokens": { "...": "MUST replay identically" },
+      "cacheReadTokens":  { "type": "integer", "minimum": 0,
+        "description": "RFC 0116. Optional, cost-only. Provider-reported tokens served from the prefix cache this call (a cache HIT shows > 0). MAY be omitted on replay (NOT replay-asserted, like costEstimateUsd). MUST NOT carry prompt substrings (SR-1)." },
+      "cacheWriteTokens": { "type": "integer", "minimum": 0,
+        "description": "RFC 0116. Optional, cost-only. Provider-reported tokens written to the prefix cache this call (a cache PRIME). MAY be omitted on replay." }
     }
   }
```

This is what makes 0116 **non-vacuously testable** without breaking replay: a cache hit is observable (`cacheReadTokens > 0`) while the recorded outcome stays invariant, and a cross-tenant non-share is observable (B's first use → `cacheReadTokens == 0`).

### Capability (provider-scoped, F4)

```diff
   "aiProviders": {
     "properties": {
+      "promptPrefixCache": { "type": "object", "additionalProperties": false,
+        "properties": {
+          "supported": { "type": "boolean" },
+          "providers": { "type": "array", "items": { "type": "string" },
+            "description": "RFC 0116. The providers for which the host honors cachePrefixId (prefix caching is provider-specific, e.g. Anthropic ephemeral). NOT a universal claim — per provider-policy.md routing." } },
+        "required": ["supported"],
+        "description": "RFC 0116. Host honors cachePrefixId as a provider-cache routing hint — tenant-namespaced (prompt-prefix-cache-cross-tenant-isolation), secret-free, replay-invariant." }
     }
   }
```

### Examples

**Positive** — two `generate`s in run R with `cachePrefixId:"std-base-v1"` → the second's `provider.usage` shows `cacheReadTokens > 0` (hit), while its `inputTokens`/`outputTokens` and accepted envelope equal a no-`cachePrefixId` control (outcome-invariant).

**Cross-tenant negative** — tenant A primes `cachePrefixId:"std-base-v1"` (`cacheWriteTokens > 0`); tenant B's **first** `generate` with the same id → `cacheReadTokens == 0` (no cross-tenant hit). A `cacheReadTokens > 0` here is a conformance + invariant failure.

## Compatibility

**Additive.** `cachePrefixId` is a new optional request field (absent ⇒ no behavior change); `aiProviders.promptPrefixCache` is a new optional, provider-scoped capability; the two `provider.usage` fields are new optional, server-emitted (open per RFC 0094), cost-only fields. No existing field changes; `inputTokens`/`outputTokens` replay semantics are untouched. The new `prompt-prefix-cache-cross-tenant-isolation` invariant is a normative requirement on previously-undefined behavior (additive per `COMPATIBILITY.md` §4).

## Conformance

Resolving the original Q4 — there **is** a non-vacuous wire witness via the `provider.usage` cache tokens:

- `prompt-prefix-cache.test.ts`, gated on `capabilityFamily(d,'aiProviders')?.promptPrefixCache?.supported`. Asserts (driven via the host-sample envelope seam): **(a) outcome-invariance** — a run with `cachePrefixId` and a control without produce the same accepted envelope + identical `inputTokens`/`outputTokens`; **(b) cache hit observable** — the repeat `generate` shows `cacheReadTokens > 0`; **(c) cross-tenant isolation** — tenant B's first use of tenant A's `cachePrefixId` shows `cacheReadTokens == 0` (the `prompt-prefix-cache-cross-tenant-isolation` invariant); **(d) secret-free** — a `cachePrefixId` is never emitted where SR-1 would redact. Soft-skips on hosts that don't advertise.
- New SECURITY invariant row `prompt-prefix-cache-cross-tenant-isolation` (protocol-tier) → the (c) scenario is its public test.

## Alternatives considered

1. **Leave provider caching entirely host-internal (do-nothing).** Rejected: a host can pin its own cache keys today, but only the protocol field gives **portability** (a client telling any host "this prefix is stable") *and* a cross-host-honest cross-tenant + replay contract. The architect review made the security/replay surface safe-by-MUST + testable, so do-nothing no longer wins.
2. **Trust host tenant-scoping without mandating the key construction.** Rejected: the `kv`/`queue`/`workspace`/memory CTI family all *mandate* the scope; this RFC follows suit with `(tenant, cachePrefixId)` + a protocol-tier invariant, rather than trusting each host.
3. **Graduate on a host-attested benchmark (no wire witness).** Rejected: the `provider.usage` cache-token extension is a genuine wire witness (cache hit + cross-tenant non-share both observable), so the project's no-benchmark-graduation norm is preserved.
4. **Tie caching to RFC 0112 compact-tool projection only.** Narrower, but misses the system-prompt prefix; the general field is safe with the mandated key + cost-hint contract, so no need to restrict.

## Unresolved questions

1. ~~Portability across providers?~~ **Resolved:** the advert is provider-scoped (`promptPrefixCache.providers[]`); `cachePrefixId` is a host-honored hint per routed provider, not a cross-provider semantic guarantee.
2. ~~Cross-tenant safety — trust scoping or mandate the key?~~ **Resolved:** mandated `(tenant, cachePrefixId)` key + invariant `prompt-prefix-cache-cross-tenant-isolation`.
3. ~~Replay enforceable?~~ **Resolved:** cost-hint-only MUST; recorded envelope + `provider.usage` input/output tokens identical hit-vs-miss; cache metrics are cost-only + replay-non-asserted.
4. ~~Observable conformance signal?~~ **Resolved:** `provider.usage.cacheReadTokens`/`cacheWriteTokens` (cost-only) make hit + cross-tenant-non-share observable.
5. Could a provider's cache subtly alter output (e.g. truncation) and violate the cost-hint MUST? If a provider is found to do so, the host MUST NOT advertise `promptPrefixCache` for it (honest provider-scoping). (Open monitoring item, not a blocker.)

## Implementation notes (non-normative)

- The cross-tenant key + cost-hint contract are the load-bearing safety properties — implement the `(tenant, cachePrefixId)` keying and the outcome-invariance assertion FIRST.
- Sequence after RFC 0112: a stable compact tool catalog is the natural first cacheable prefix.
- Reconcile with openwop-app ADR 0148 **A2** (Anthropic-`ephemeral` prefix): A2 is the provider-specific producer; this RFC's `cachePrefixId` + provider-scoped advert is its portable wire form.

## Acceptance criteria

- [ ] Spec text merged (`ai-envelope.md` cachePrefixId + `provider.usage` cache-token fields + `provider-policy.md` provider-scoping).
- [ ] `capabilities.schema.json` (`aiProviders.promptPrefixCache`) + `run-event-payloads.schema.json` (cache tokens) updated.
- [ ] `SECURITY/invariants.yaml` row `prompt-prefix-cache-cross-tenant-isolation` (protocol-tier) + its conformance test.
- [ ] `prompt-prefix-cache.test.ts` (outcome-invariance + cache-hit-observable + cross-tenant + secret-free).
- [ ] CHANGELOG entry.
- [ ] Reference host implements tenant-keyed, replay-invariant caching + the witness, or impl explicitly deferred (provider-gated — needs a provider that offers prefix caching).

## References

- `spec/v1/ai-envelope.md` (generate request; `provider.usage`/RFC 0026; replay/correlationId); `spec/v1/provider-policy.md` (per-provider routing).
- `SECURITY/threat-model-provider-policy.md`, `SECURITY/threat-model-secret-leakage.md`; the `kv`/`queue`/`workspace` cross-tenant isolation invariants in `SECURITY/invariants.yaml` (the pattern the new invariant follows).
- RFC 0041 (replay determinism), RFC 0026 (`provider.usage`), RFC 0112 (compact tool projection — first cacheable prefix).
- Prior art: Anthropic prompt caching; provider context-cache pricing models.
- Sibling RFCs: 0111, 0112, 0113, 0114, 0115.
