# RFC 0121: Subscription-reuse provider auth mode (`aiProviders.authModes: "subscription"`)

| Field             | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**           | 0121                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Title**         | Subscription-reuse provider auth mode — adds `"subscription"` to the `aiProviders.authModes` closed enum (RFC 0067), so a host can honestly advertise that a provider's credential may be supplied by reusing an existing personal consumer subscription (e.g. Claude Pro/Max, ChatGPT Plus) rather than a metered API key or a host-owned OAuth client                                                                                                                                                       |
| **Status**        | `Active`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Author(s)**     | David Tufts (@davidscotttufts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Created**       | 2026-07-01                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Updated**       | 2026-07-01 — Draft → Active (bootstrap-phase steward waiver; 7-day comment window waived; see [Status history](#status-history)). Unresolved question 1 (legal/ToS clearance) — originally the un-parking tripwire — is **re-scoped** as an Active → Accepted and implementation precondition: no host may advertise or implement `subscription` mode until it is documented as cleared for a named provider.                                                                                                                                                                                     |
| **Affects**       | `spec/v1/capabilities.md` (§`aiProviders.authModes` — extends the closed enum + auth-mode contract) · `schemas/capabilities.schema.json` (`aiProviders.authModes` enum) · `SECURITY/invariants.yaml` (adds `subscription-credential-user-scope-only`) · `SECURITY/threat-model-provider-policy.md` + `SECURITY/threat-model-auth-profiles.md` (cross-reference) · `conformance/src/scenarios/byok-auth-modes.test.ts` (existing hard-coded enum assertion needs a companion update) + ≥1 new scenario · `INTEROP-MATRIX.md` · `CHANGELOG.md`                                                                                                                                                                                                                                        |
| **Compatibility** | `additive` per `COMPATIBILITY.md` §2.1                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Supersedes**    | — (extends RFC 0067, does not replace it)                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Superseded by** | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

## Summary

Adds `"subscription"` as a fifth value to the `aiProviders.authModes` closed enum (today `["apiKey", "oauth-pkce", "oauth-device", "none"]`, RFC 0067), so a host can honestly advertise that a provider's credential may be supplied by **reusing an existing personal consumer AI subscription** (Claude Pro/Max, ChatGPT Plus, and similar) instead of a metered API key. This is modeled on prior art in other coding-agent orchestration tools whose credential-kind taxonomies include exactly this class alongside API key / gateway / workspace-profile modes. Because a subscription credential is bound to an individual's personal, non-metered plan — with materially different terms-of-service, custody, and sharing constraints than an API key or a host-owned OAuth client registration — this RFC pins a new MUST (`subscription`-mode credentials MUST be user-scoped, never tenant-shared) rather than silently overloading `oauth-pkce`/`oauth-device`. The RFC is **Active** (wire vocabulary locked under the bootstrap steward waiver): the vocabulary is sound and additive, but whether the *underlying acquisition mechanism* is compliant with any given provider's consumer terms of service is a legal question this RFC cannot resolve — it is **re-scoped** from the original un-parking tripwire to an Active → Accepted / implementation precondition (see [Status history](#status-history) and Unresolved question 1): no host may advertise or implement `subscription` mode until it is documented as cleared for a named provider.

## Motivation

Every OpenWOP host today gates non-platform-managed model access behind `aiProviders.byok` (RFC 0067 baseline) — the caller supplies an API key via `RunOptions.configurable.ai.credentialRef`, or (per RFC 0047) the host runs a standard OAuth 2.0 authorization-code/device flow against a provider it has its own OAuth client registration for. Both paths assume the resulting credential grants **metered, developer-tier API access** the host (or its user) explicitly provisioned for automated use.

A large and growing class of users already pay for **consumer AI subscriptions** (Claude Pro/Max, ChatGPT Plus/Pro) that are not metered per-call but are also not intended, by most providers' consumer terms, for driving arbitrary third-party API-shaped automation. Some coding-agent orchestration tools (surveyed in a competitive feature analysis of this app) ship a first-class **"Subscription" credential kind** that authenticates via the provider's own official CLI login flow, letting a user drive agent sessions against a model they already pay for. This measurably lowers the friction of trying a host that would otherwise require provisioning and paying for a *second*, metered credential just to evaluate it.

Who hits this today: any OpenWOP host operator or contributor wanting to reduce BYOK friction for individual users, and any client/conformance reader trying to detect whether a host's advertised provider list includes this class of credential. The wire currently has **no vocabulary for it** — `aiProviders.authModes`' closed enum (RFC 0067) only distinguishes `apiKey` / `oauth-pkce` / `oauth-device` / `none`, none of which honestly describe "a personal, non-shareable, consumer-plan credential with distinct custody rules." A host that wanted to advertise this today would have to either mislabel it as `oauth-pkce` (losing the tenant-sharing prohibition this RFC introduces) or invent an unspecified per-host convention (reproducing exactly the silent-incompatibility problem `authModes` was created to prevent — the same rationale RFC 0108 used to justify `aiProviders.selfHosted` as its own field rather than overloading `supported`).

The spec is the right place because `authModes` is read cross-host by clients pre-flighting credential UX (RFC 0067's stated purpose) and by the conformance suite; an ad-hoc per-host label would not compose with either.

**What this RFC explicitly does NOT resolve** (see Unresolved question 1): whether any major provider's consumer-subscription terms of service actually *permit* a third-party host to make API-shaped calls under a reused login, and if so, by what mechanism (see Unresolved question 2 — reusing a session token directly vs. shelling out to the provider's own official client as a subprocess, which is closer to what a subprocess-wrapping harness architecture actually does). This is a **legal and architectural question**, not a wire-shape question; the wire shape advances to `Active` now, but no host may advertise or implement `subscription` mode until this has a documented answer for at least one provider (re-scoped as an Active → Accepted / implementation precondition — see Unresolved question 1).

## Proposal

### §A — Extend the `authModes` closed enum (additive)

```diff
   "aiProviders": {
     "properties": {
       "authModes": {
         "additionalProperties": {
           "items": {
             "type": "string",
-            "enum": ["apiKey", "oauth-pkce", "oauth-device", "none"]
+            "enum": ["apiKey", "oauth-pkce", "oauth-device", "none", "subscription"]
           }
         }
       }
     }
   }
```

Add to `spec/v1/capabilities.md` §`aiProviders.authModes`, in the mode table:

| Mode           | Meaning                                                                                                        | Credential supply                                                                                                                                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `subscription` | Host accepts a credential derived from reusing the caller's existing **personal, non-metered consumer subscription** with the provider (e.g. Claude Pro/Max, ChatGPT Plus), rather than a metered API key. | Client references the host-stored credential by `ref` (RFC 0046), identically to `oauth-pkce`/`oauth-device`; key/session material is NEVER passed on `ai.credentialRef`. The acquisition mechanism (how the host obtains and refreshes the underlying session) is host-internal and out of scope — see §D. |

### §B — New auth-mode contract clauses (normative, extends RFC 0067's six)

Add to `spec/v1/capabilities.md` §`aiProviders.authModes` "Auth-mode contract":

> 7. A provider whose mode array includes `subscription` MUST also appear in `aiProviders.byok` (the same rule as `apiKey`, clause 2 — `subscription` is a BYOK path: the caller supplies *something*, even if it isn't an API key). A provider MAY advertise multiple modes together, e.g. `["apiKey", "subscription"]`, meaning either an API key or a personal-subscription credential may satisfy the same provider slot; the two resolve to **differently-scoped** credentials (see clause 8), not interchangeable ones.
> 8. **User-scope-only (normative, MUST).** A credential resolved under `subscription` mode MUST be bound to `host.credentials` (RFC 0046) `scope: "user"`. A host MUST NOT resolve, store, or permit reference to a `subscription`-mode credential at `tenant`/`workspace` scope, and MUST reject an attempt to bind one at that scope with a canonical `credential_scope_forbidden` error. This is the wire-level safety rail against silently sharing one individual's personal, single-seat subscription across a multi-user tenant — both a terms-of-service and a security concern (see §D and the `subscription-credential-user-scope-only` SECURITY invariant).
> 9. A host MUST NOT advertise `subscription` support for a provider without an operator-attested, provider-specific credential-acquisition mechanism actually configured and reachable — the same truthful-advertisement discipline RFC 0108 §A.2 established for `aiProviders.selfHosted`. This is host-attested (not machine-verifiable beyond capability shape), consistent with how `selfHosted`'s honesty rule is enforced only under `OPENWOP_REQUIRE_BEHAVIOR=true` behavioral scenarios, not statically.

### §C — Non-normative: acquisition mechanism is host-internal, but two shapes exist (informative)

`aiProviders.authModes` describes *that* a provider accepts a subscription-derived credential, not *how* the host obtains one — consistent with `oauth-pkce`/`oauth-device` leaving the OAuth dance to RFC 0047 and `selfHosted` leaving endpoint transport out of scope (RFC 0108 Unresolved question 3). Two materially different acquisition shapes exist in the wild and carry very different risk profiles (see Unresolved question 2, and Alternatives Considered):

1. **Borrowed-session API calls.** The host captures a session/bearer token from the user's subscription login and uses it to make ordinary API-shaped calls through its own `ctx.callAI` dispatch path — architecturally identical to `apiKey`/`oauth-pkce` handling, just with a different token source. This is the minimal-effort shape but is the one most likely to run afoul of a consumer subscription's terms of service, which commonly restrict use to the provider's own first-party client.
2. **Official-client subprocess harness.** The host launches the provider's own official CLI/desktop client as a subprocess (or drives it via IPC) under the user's login, so the provider's own first-party client is what actually makes the call — the pattern some subprocess-wrapping harness architectures use (wrapping `claude`, `codex`, etc. as external processes rather than calling their APIs directly). This is materially more defensible on ToS grounds but is architecturally a different primitive from an AI-envelope dispatch call — closer to a sandboxed external-process execution contract (RFC 0035) than to `ctx.callAI`.

This RFC does not normate which shape a host uses; both are consistent with the wire label as written. **A host adopting `subscription` mode is responsible for choosing a shape that is lawful under the specific provider's terms** — this is precisely the un-parking tripwire (Unresolved question 1).

### §D — SECURITY invariant: `subscription-credential-user-scope-only`

Add to `SECURITY/invariants.yaml`:

```yaml
  - id: subscription-credential-user-scope-only
    tier: protocol
    severity: high
    threat_model: SECURITY/threat-model-provider-policy.md
    tests:
      - conformance/src/scenarios/aiproviders-subscription-scope.test.ts
    note: |
      RFC 0121 §B clause 8: a credential resolved under `aiProviders.authModes`
      "subscription" mode MUST be bound to host.credentials (RFC 0046)
      scope:"user" and MUST NOT be resolvable at tenant/workspace scope. A
      host that permits tenant-scope binding of a personal-subscription
      credential both violates the credential owner's individual-seat
      subscription terms and creates an unaudited multi-user sharing surface.
      Distinct from credential-payload-redaction (RFC 0046): this invariant
      is about scope binding, not payload disclosure.
```

Severity is `high` (not `critical`): the failure mode is unauthorized multi-user reuse of a personal credential (a real ToS and security concern), not direct key-material disclosure, which remains governed by the existing `credential-payload-redaction` invariant unchanged.

## Compatibility

**Additive** per `COMPATIBILITY.md` §2.1, following the same reasoning as RFC 0108's `selfHosted` addition:

- **New enum value in an already-optional field.** `authModes` is itself optional (absent ⇒ default contract per RFC 0067 clause 5); adding one value to its per-provider mode array is additive.
- **Existing values unchanged.** `apiKey`, `oauth-pkce`, `oauth-device`, `none` keep their exact meaning and clauses.
- **Forward-compatible by construction.** RFC 0067 clause 6 already requires: *"A client MUST NOT infer a policy mode from an auth mode, and MUST ignore an auth mode it does not recognize rather than reject the discovery document."* A client written against RFC 0067 alone already tolerates an unrecognized `subscription` value without any change on its part — this is the same forward-compat property that let RFC 0067 add modes in the first place.
- **No event-type, endpoint, or existing error-code changes.** The new `credential_scope_forbidden` error is a **new** code (COMPATIBILITY.md permits new endpoints/fields; existing codes are unchanged in meaning), scoped narrowly to hosts that advertise `subscription`.
- **New MUSTs bind only hosts that advertise the new value.** Clauses 7–9 and the new SECURITY invariant apply only once a host lists `subscription` for some provider; a host that never does is entirely unaffected — identical to RFC 0108's binding-only-when-advertised pattern.

## Conformance

- **Existing coverage:** `conformance/src/scenarios/byok-auth-modes.test.ts` — schema-shape assertion (currently a hard-coded `toEqual(["apiKey", "oauth-pkce", "oauth-device", "none"])` against the enum) plus the §B auth-mode contract cross-field check. **This existing scenario's hard-coded enum list itself needs updating** in the companion `@openwop/openwop-conformance` PR that ships alongside this RFC's schema change — called out explicitly because it is a modification to an *existing* always-on scenario, not just a new one; flagged in Acceptance criteria below rather than left implicit.
- **New scenario:** `aiproviders-subscription-scope.test.ts` (capability-gated, soft-skips when no provider's `authModes` includes `subscription`) — asserts, for a host that advertises the mode: (1) the enum value is present in the four-mode-plus-one closed set (schema shape, server-free, <1s); (2) a host-attested behavioral check (Active→Accepted gate, mirroring RFC 0108's two-tier shape/honesty split) that an attempt to bind a `subscription`-mode credential at tenant scope is rejected with `credential_scope_forbidden`.
- **Capability gating:** soft-skip (SKIPPED, not FAILED) when no `authModes` entry includes `subscription`, per `coverage.md` §"Capability-gated scenarios" — identical gating discipline to RFC 0108's `selfHosted` scenarios.
- **Reference-host coverage:** explicitly **deferred** — see Acceptance criteria; this RFC does not commit any `openwop-examples` reference host or `openwop-app` to implement `subscription` mode while Parked.
- **INTEROP-MATRIX impact:** a new `aiProviders.authModes: subscription` column note, populated only once/if a host un-parks and advertises it.

## Alternatives considered

1. **Reuse `oauth-pkce`/`oauth-device` as-is; don't add a new mode.** Rejected for the same reason RFC 0108 rejected relying on the advisory provider vocabulary for self-hosted endpoints: it is technically possible today (a host could just say `oauth-pkce`) but loses the honest distinction — a client cannot tell "the host owns an OAuth client registered for API-tier access" from "the host is reusing your personal consumer login," and the critical user-scope-only constraint (§B clause 8) would have no place to attach normatively.
2. **Model this as an official-client subprocess-harness primitive instead of a BYOK auth mode** (§C shape 2 — closer to what a subprocess-wrapping harness actually does: wrap the vendor's own CLI as an external process). This is very plausibly the **more correct and more ToS-defensible design**, but it is architecturally a different and much larger proposal — a new sandboxed external-process execution contract in the shape of RFC 0035, not an `aiProviders.authModes` value. Deferred to Unresolved question 2 / a follow-up RFC if this proceeds; this RFC intentionally keeps the wire label **mechanism-agnostic** (as RFC 0108 did for self-hosted transport) so that whichever shape a host lawfully implements, the same wire vocabulary describes it.
3. **A richer `aiProviders.credentialClasses` map** analogous to RFC 0108's considered-and-deferred `providerClasses` map, distinguishing `metered-api` / `oauth-delegated` / `subscription-personal` etc. Deferred for the same reason RFC 0108 deferred its richer taxonomy: the minimal enum-value addition closes the honest-labeling gap now; a richer map is itself additive and can land later without breaking this value.
4. **Do nothing — leave subscription-reuse entirely unspecified and host-internal**, publishing no wire label at all. This is the **strongest** alternative here, unlike in RFC 0108's analogous case, precisely because of the unresolved ToS question (Unresolved question 1): a host that has not cleared the legal question has nothing to advertise anyway, and a premature wire label could be read as implicitly endorsing the practice. This is why, although the wire vocabulary advances to `Active`, the "do nothing until it is lawful" position is preserved at the implementation gate: no host may advertise or implement `subscription` mode until Unresolved question 1 is documented as cleared.

## Unresolved questions

1. **Legal/ToS clearance (the un-parking tripwire).** Does any major consumer-AI-subscription provider's terms of service permit a third-party host to make API-shaped calls under a reused personal login — or does the provider instead offer its own sanctioned third-party integration path for this pattern? **Not resolved by this RFC.** No implementation, ADR, or ID host advertisement should proceed until this has a documented answer for at least the specific provider(s) targeted. This is **re-scoped** from the original Draft → Active un-parking tripwire to an **Active → Accepted / implementation precondition**: the wire vocabulary is `Active`, but no host may advertise or implement `subscription` mode, and no reference host or ADR may proceed, until this has a documented answer.
2. **Acquisition mechanism (§C).** If UQ1 clears for a given provider, does the host make direct API calls under a borrowed session (§C shape 1, ToS-risky, architecturally cheap) or shell out to the provider's own official client as a subprocess/harness (§C shape 2, the subprocess-harness model, more defensible but architecturally distinct — closer to RFC 0035 sandbox-execution-contract than to `ctx.callAI`)? Recommendation: shape 2, if pursued at all; likely warrants its own follow-up RFC extending RFC 0035 rather than reusing the AI-envelope dispatch path. This RFC's wire label is deliberately agnostic to the answer.
3. **Rate-limit/seat-abuse semantics.** A personal subscription's usage limits are typically far below a metered API tier and are not designed for host-mediated automation, even at correct single-user scope. Should the wire advertise any hint of this (e.g., an expected-throughput signal), or is it purely an operator/user expectation-setting concern? Recommendation: out of scope for the wire — `aiProviders.policies` (RFC 0067) already covers per-provider host-side gating; no new field is proposed here.
4. **Credential lifecycle.** Does a `subscription` credential need session-refresh/expiry semantics distinct from `oauth-pkce`'s existing token-refresh surface (RFC 0046/0047)? Recommendation: reuse the existing `host.credentials` rotation/refresh surface unless implementation experience surfaces a concrete gap; no new lifecycle event proposed here.
5. **Companion `capabilities.oauth` advertisement.** RFC 0067 clause 4 says a provider advertising `oauth-pkce`/`oauth-device` SHOULD also advertise `capabilities.oauth` (RFC 0047) with a matching id. Should `subscription` carry the same SHOULD? Recommendation: only if the chosen acquisition mechanism (UQ2) happens to be OAuth-shaped under the hood — the existing clause-4 SHOULD already extends by its own terms in that case; no new clause needed.

## Implementation notes (non-normative)

- **No reference-host commitment.** This RFC does not propose or require any `openwop-examples` or `openwop-app` implementation at `Active` (wire-shape only, per the RFC 0108 Draft → Active precedent). In particular, **no openwop-app ADR should be authored for this surface until Unresolved question 1 has a documented resolution** — this inverts the usual RFC-then-ADR sequencing (cf. RFC 0108 → ADR 0121 in `openwop-app`) deliberately, because here the legal precondition sits *upstream* of any implementation decision, not downstream of it.
- **Effort estimate if/when un-parked, wire-only:** schema enum + spec prose ~0.25 day; the SECURITY invariant + shape conformance scenario ~0.5 day; the companion `byok-auth-modes.test.ts` enum-list update ~0.25 day; CHANGELOG + INTEROP-MATRIX ~30 min. Full host implementation (whichever §C shape is lawful) is materially larger and intentionally unscoped here.
- **Cross-cut:** none identified against `WORKFLOW-PROTOCOL-openwop-PLAN.md` — this is an additive-only wire vocabulary change (Active; wire-shape only) with no reference-host obligation yet.

## Acceptance criteria

Promotion `Draft → Active` (✅ **met 2026-07-01** — bootstrap-phase steward waiver; see [Status history](#status-history)):

- [x] Comment window: **waived** under the bootstrap-phase steward waiver (RFC 0031 / 0046 / 0095 / 0108 precedent) — single-steward repo, zero external reviewers.
- [x] Compatibility classification firm: **additive** (§Compatibility).
- [x] Wire-shape frozen: the `"subscription"` `authModes` value + the §A/§B/§C/§D normative rules are locked — no shape changes before Accepted.
- [x] Five architect passes complete; the gap (G1–G6) + risk (R1–R5) registers carry only Active/Accepted-stage items; no critical wire-shape gap.
- ↪ The `spec/v1/capabilities.md` §A/§B prose + `schemas/capabilities.schema.json` enum edit + the SECURITY invariant + conformance land at **Accepted** (below), per the RFC 0108 Draft → Active precedent (shape locked at Active; text + conformance + reference-host at Accepted).

Promotion `Active → Accepted` requires, in addition to the standard checklist:

- [ ] **Unresolved question 1 has a documented resolution** for at least one named provider (legal/ToS review citation, or the provider's own sanctioned integration-path documentation) — re-scoped from the original un-parking tripwire; **gates all implementation, not just Accepted**.
- [ ] Spec text merged (`capabilities.md` §A/§B).
- [ ] Schema updated (`capabilities.schema.json` `authModes` enum +1 value).
- [ ] `SECURITY/invariants.yaml` gains `subscription-credential-user-scope-only`.
- [ ] `conformance/src/scenarios/byok-auth-modes.test.ts`'s existing hard-coded enum assertion is updated in the same conformance-suite release that ships the new scenario (explicitly called out — this is a modification to an existing always-on scenario, not purely additive test authorship).
- [ ] At least one new conformance scenario (`aiproviders-subscription-scope.test.ts`) covering the new surface.
- [ ] CHANGELOG entry under the appropriate version.
- [ ] Reference host implements and passes the new scenarios (or dual-witness per the graduation bar), on a lawfully-cleared provider.

## References

- `RFCS/0067-provider-catalog-conventions.md` — the `aiProviders.authModes` closed enum and six-clause contract this RFC extends.
- `RFCS/0108-self-hosted-openai-compatible-provider-class.md` — structural precedent for adding a new, materially-distinct-trust-class marker to `aiProviders` via an additive field/enum value plus a truthful-advertisement MUST and a scoped SECURITY invariant; also precedent for keeping the wire label agnostic to the underlying transport/acquisition mechanism.
- `RFCS/0046-host-credentials-capability.md` — `host.credentials` scope model (`user`/`tenant`/`run`) this RFC's §B clause 8 binds `subscription` credentials to.
- `RFCS/0047-host-oauth-connector-flows.md` — the OAuth 2.0 authorization-flow capability referenced by Unresolved question 5 and by `oauth-pkce`/`oauth-device`'s existing clause 4.
- `RFCS/0035-sandbox-execution-contract.md` — the likely home for a follow-up RFC if Unresolved question 2 resolves toward the official-client subprocess-harness shape.
- `spec/v1/capabilities.md` §`aiProviders.authModes` — the surface extended.
- `SECURITY/threat-model-provider-policy.md`, `SECURITY/threat-model-auth-profiles.md` — the threat models this RFC's new invariant is filed against.
- openwop-app competitive feature-gap analysis (conversation-derived, 2026-07-01) — the originating motivation, comparing competing coding-agent tools' feature surface against openwop-app's current BYOK/API-key-only model.

## Status history

### Draft → Active (2026-07-01)

Promoted under the **bootstrap-phase steward waiver** per `CONTRIBUTING.md` §"Bootstrap-phase notes" + `MAINTAINERS.md` §"Bootstrap-phase RFC waivers" — the same path RFC 0031, RFC 0046, RFC 0095, and RFC 0108 used. **The 7-day comment window is waived** (single-steward bootstrap repo; zero external reviewers). The wire-shape is locked; the spec/schema text, the `subscription-credential-user-scope-only` SECURITY invariant, the `aiproviders-subscription-scope.test.ts` conformance scenario, the `byok-auth-modes.test.ts` enum update, and a reference-host advertisement remain the path to `Accepted`.

**Legal tripwire re-scoped (not resolved).** Unresolved question 1 — does any provider's consumer terms of service permit API-shaped third-party use of a reused personal subscription? — was authored as the *Draft → Active un-parking* tripwire. This promotion advances the **wire vocabulary only** and does **not** resolve that question. It is re-scoped as an **Active → Accepted and implementation precondition**: no host may advertise or implement `subscription` mode — and no `openwop-examples` / `openwop-app` reference host or ADR may proceed — until UQ1 has a documented, provider-specific resolution. The safety rail is preserved at the implementation gate, not at the status label.

Evidence at promotion:

- **Classification firm — `additive`** per `COMPATIBILITY.md` §2.1: one value added to an already-optional closed enum; no existing field / event / error changes; forward-compatible by RFC 0067's ignore-unknown-mode rule; new MUSTs bind only hosts that advertise `subscription`.
- **Wire-shape locked:** the `"subscription"` `authModes` value + §B clauses 7–9 (co-occurrence with `byok`, user-scope-only, truthful advertisement) + §C's two acquisition-mechanism shapes + the §D `subscription-credential-user-scope-only` invariant. No shape changes expected before Accepted.
- **Path to `Active → Accepted`:** resolve UQ1 for a named provider; land §A/§B prose in `spec/v1/capabilities.md`; add the `"subscription"` enum value to `schemas/capabilities.schema.json`; add the SECURITY invariant + the shape/scope conformance scenario + the `byok-auth-modes.test.ts` enum update; a reference host advertises `subscription` for a lawfully-cleared provider and passes.

Compatibility: this promotion is **non-normative** — a status change only; no wire, schema, or behavior change in this commit.

### Draft (Parked) (2026-07-01)

Authored via the five-architect pass (`/prd`). RFC + gap (G1–G6) + risk (R1–R5) registers landed (PR #807); third-party project references generalized (PR #808). Filed `Draft (Parked)` with Unresolved question 1 (legal/ToS clearance) as the named un-parking tripwire.
