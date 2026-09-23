# RFC 0210: a lane's revocation rule is measured, and a host that only honours `exp` says so

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0210                                                            |
| **Title**         | a lane's revocation rule is measured, and a host that only honours `exp` says so |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-22                                                      |
| **Updated**       | 2026-09-22 — filed `Draft`; **the public comment window runs in full, to 2026-09-29.** RFC 0147 §A.6 forbids bootstrap waiver language from shortening the window for an RFC of this risk class, and this one is squarely in it: it decides **which credentials a host accepts, for how long, and what it refuses them with** — identity and authorization. **No waiver is requested and none is granted.** In particular this RFC is **not** folded under RFC 0200's recorded steward override of §A.6: 0200's override was taken for 0200's own identity surface, its acceptance is already provisional with a §B review owed (RFC 0156 register), and stacking a second identity-vocabulary widening on the same override is exactly the compounding §A.6 exists to prevent. Precedent for running the window in full: RFC 0194, 0195 and 0196, each filed `Draft` on 2026-09-21 with a full window to 2026-09-28 (openwop#1463). **RFC 0200's first certifying cut waits for this window to close** — 0200's own header already requires a MyndHyve deploy of its §A/§B to precede that cut, and §F below explains why that deploy should carry this RFC's correction in the same push. · 2026-09-23 — **`Draft → Active`; comment window waived** by the steward on 2026-09-23 — an explicit **steward override of RFC 0147 §A.6**, which forbids bootstrap waiver language from shortening the window for an RFC of this risk class; it is outside the `MAINTAINERS.md` waiver grant and is recorded there as an override, not as a routine waiver (this RFC decides which credentials a host accepts and for how long — identity and authorization). The paragraph above recorded that no waiver was requested and none granted; that was true when it was written, and it is superseded here rather than deleted, because the override is the fact worth auditing. The two §A.6 concerns it was written against are answered, not dismissed: this is **not** folded under RFC 0200's override — it carries its own, its own ledger row and its own `not-reviewed` register row, so nothing compounds on 0200's — and the withheld half lands in the same change as the member it bounds, so the laundering hatch §Conformance names is never open. **Acceptance is provisional and the RFC 0156 §B retrospective review is owed** (the register row stays `not-reviewed`). `Active`, **not** `Accepted`: the §B host evidence is still owed in full — no host advertises `exp-only` yet, and the four §B rows have no `executed-pass` on any committed bundle (register **G4**). |
| **Affects**       | **Lands when `Active`:** `spec/v2/core/identity.md` §2.2 (two table cells, four paragraphs) · `spec/v2/facets/auth.schema.json` (one enum member; one `if`/`then` lane restriction) · `spec/v2/errors.json` (one row, `credential_lifetime_exceeded`) · `SECURITY/invariants.yaml` (+1, `lane-exp-only-lifetime-bounded`) · conformance (one new scenario `v2-lane-exp-only-bound.test.ts`). **Lands with this filing** (each enforces or discloses a rule that is already normative, and neither cites this RFC): `conformance/src/scenarios/v2-lane-issuer-advertised.test.ts` (one new leg binding a lane to §2.2's existing rule set, minting a leg of RFC 0170's requirement) · `scripts/check-lane-revocation-rules.mjs` (new corpus gate) · `INTEROP-MATRIX.md` (new per-lane revocation disclosure section) · `RFCS/0200-host-as-oauth-protected-resource.md` (§Examples caveat + a Dependencies line) |
| **Compatibility** | `additive` per `COMPATIBILITY.md` and `spec/v2/core/overview.md` §0 (a member added to an advertised enum is additive in v2.x); the conformance tightening is classified separately in §Compatibility |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

`identity.md` §2.2 makes every lane name a revocation rule and advertise it. The vocabulary has nine members and **not one of them describes the most common real deployment**: a host that verifies a JWT's signature, issuer, audience and `exp`, and never asks the trust root again. Two hosts hit the gap and resolved it in opposite directions. openwop-app **omitted its OIDC lane at major 2** rather than state a rule it does not perform — while still advertising the same front door at v1, which needs no rule. MyndHyve **advertises `short-lived` with a 3600-second window** while calling `verifyIdToken` without `checkRevoked`, so nothing on that host ever asks whether the subject was revoked.

This RFC adds one enum member, `exp-only`, and makes it the one member that is **not** cheap: a host advertising it MUST refuse a credential whose total lifetime (`exp − iat`) or remaining lifetime (`exp − now`) exceeds the window it advertised, with a new registered code `credential_lifetime_exceeded`. The window stops being decorative and becomes a number a sabotage can falsify.

It also closes the hatch that let `short-lived` onto an `oidc` lane unexamined: **nothing in the corpus binds a lane to the rule §2.2's row for it lists.** The schema accepts any of the nine on any of the ten lanes, and the suite checks only enum membership and window presence. That leg lands with this filing, because it enforces RFC 0170's table as already written.

There is no numeric ceiling. Upstream has none to borrow (§Motivation), so the corpus's job is that the advertised number be **true**, not that it be small. The honest substitute for a ceiling is disclosure: `INTEROP-MATRIX.md` gains a per-lane revocation section, and it lands with this filing so the record does not wait on the RFC.

## Motivation

Findings verified read-only on 2026-09-22 against corpus tip `eaeffa42`, `openwop-app` `main`, and `myndhyve` `f2948023f` (`review/arch-lane-vocab.md`).

### 1. The same code shape produced an omission on one host and a false claim on the other

`OidcVerifier.verify()` in openwop-app (`backend/typescript/src/middleware/oidcVerifier.ts`) performs, in order and nothing else: three segments → `alg` in the allowlist (`none` rejected) → `kid` against the issuer JWKS (cached 10 min) → signature → `iss` exact → `aud` contains → `iat` present and numeric → `exp > now − 60` → `nbf ≤ now + 60` → `sub` non-empty. There is no introspection call, no userinfo call, no revocation list, no host-side epoch, and **no bound on credential lifetime** — a structurally valid token whose `exp` is a year out is accepted.

MyndHyve's posture is byte-for-byte the same: `services/workflow-runtime/src/middleware/auth.ts:192`, `:251`, `:345` each call `admin.auth().verifyIdToken(token)` with no second argument, and `checkRevoked` defaults to `false`. A repository-wide grep finds **zero** occurrences of `checkRevoked` and zero of `revokeRefreshTokens`.

The two hosts then diverge:

| Host | v2 `oidc` lane | Why |
| --- | --- | --- |
| **openwop-app** | **absent.** `routes/discovery.ts` `v2AuthFamily()` emits `api-key`, `session`, `anonymous` only, with a ~30-line ADR 0730 C.3 comment recording the vocabulary gap and that its `exp-and-recheck` attempt was caught by the suite | no member of the enum is true of it |
| **MyndHyve** | `{ lane: 'oidc', revocation: 'short-lived', revocationWindowSeconds: 3600 }` (`routes/discoveryV2.ts:168–175`) | the enum is closed, and this member reads closest |

**MyndHyve's two justifications both fail.** "Re-verified on every request" re-verifies *signature and `exp`*; that is not revocation, and the token survives revocation for its full remaining life — precisely what `short-lived` is supposed to bound. "Firebase ID tokens expire after one hour" is a property of **Google's issuer**, not of this host: §2.2 defines `short-lived` only in the `mtls` row, as "**issue** certificates whose lifetime is at most the advertised window". That is an *issuer's* obligation, and MyndHyve does not mint the credential.

Nothing measures the claim. MyndHyve's own test asserts the string (`src/__tests__/discoveryV2.test.ts:108–114`: `revocation === 'short-lived'`, window an integer ≥ 1). The corpus's own scenario asserts no more (finding 3).

**The variable is the vocabulary, not the honesty of the implementers.** One host under-claimed and one over-claimed, both trying to satisfy a closed enum with no member for what they do.

### 2. The gap also produces a discovery regression between majors

`routes/discovery.ts:436–442` pushes the v1 profile `openwop-auth-oidc-user-bearer` whenever `readOidcConfigFromEnv()` returns non-null. So openwop-app **advertises an OIDC front door at v1 and hides the same front door at v2**, for one reason: v2 requires a revocation rule and v1 does not. A truthful host loses a capability by moving to the newer major.

### 3. Nothing binds a lane to the rule §2.2's row lists

- **Schema.** `spec/v2/facets/auth.schema.json` has no `if`/`then` relating `revocation` to `lane`. Any of the nine values is schema-valid on any of the ten lanes.
- **Suite.** `conformance/src/scenarios/v2-lane-issuer-advertised.test.ts` asserts (a) `revocation ∈ REVOCATION` and (b) `revocationWindowSeconds` present and integer ≥ 1 when the rule is windowed. The §2.2 per-lane column is unenforced — which is why `short-lived` on `oidc` passes, and why openwop-app's `exp-and-recheck` attempt failed on the missing *window* rather than on the rule.

So the laundering hatch **already exists and is already in use.** `exp-only` does not open it; this is the first proposal that closes it.

### 4. The gap is recorded nowhere in the corpus

Zero hits across `RFCS/`, `spec/`, `docs/`, `SECURITY/`, `schemas/`. The nearest is `RFCS/0167-openwop-v2-umbrella.md:55`, "the lane vocabulary gap (RFC 0165 G6)" — that is the **lane** enum (which lanes exist), a different surface. RFC 0170 (the owner), 0173 and 0200 do not record it. openwop-app's ADR says the gap was "reported upstream"; the report never landed here. **This RFC is the first corpus record.**

Worse: **RFC 0200 §Examples ships the unsound pattern as its positive example** — an `oidc` lane with a Firebase issuer, `"revocation": "short-lived"`, `"revocationWindowSeconds": 3600`, copied from MyndHyve. Left alone it normalises the over-claim for every future host.

### 5. Upstream, checked rather than assumed

| Source | What it actually says |
| --- | --- |
| **OAuth 2.1 §5.2** (draft-16) | a resource server "MUST check that the access token is not yet expired, is authorized to access the requested resource, was issued with the appropriate scope, and meets other policy requirements". Names two token families, including "self-encoded tokens". Introspection appears only as "a standardized method … is defined in [RFC7662]" — **not a floor**. |
| **RFC 9068** | a closed validation checklist ending at `exp`. Full-text: it contains **no revocation discussion whatsoever**. *Do not cite RFC 9068 for revocation; it has none.* |
| **MCP 2026-07-28** | servers "**MUST** validate access tokens as described in [OAuth 2.1 §5.2]"; audience check; "Invalid or expired tokens **MUST** receive a HTTP 401". **No mention of introspection, revocation or token lifetime for the resource server.** |
| **RFC 7662 §4** | the only upstream text naming a revocation window, and it is about *introspection caching*: "the token may be revoked while the protected resource is relying on the value of the cached response … This creates a window during which a revoked token could be used", and a response carrying `exp` "MUST NOT be cached beyond the time indicated therein". An RS caching introspection to `exp` is equivalent to exp-only validation, and 7662 permits it. |
| **Lifetime ceilings** | **no numeric maximum access-token lifetime exists anywhere upstream.** Only qualitative SHOULDs: OAuth 2.1 §7.1.3.5 "authorization servers SHOULD issue short-lived bearer tokens"; MCP security considerations "SHOULD issue short-lived access tokens". OAuth 2.1's one hard number, 10 minutes, is for *authorization codes*. |
| **Disclosure** | **RFC 9728 has zero occurrences of "revoc", "introspect", "latency" or "lifetime".** No upstream metadata document has a field for, or a duty to disclose, revocation propagation delay. |
| **Firebase** | "Firebase ID tokens are short lived and last for an hour"; "Because Firebase ID tokens are stateless JWTs, you can determine a token has been revoked only by requesting the token's status from the Firebase Authentication backend … an expensive operation, requiring an extra network round trip." Google documents skipping it as an accepted trade-off. |

Upstream *permits* exp-only implicitly and gives it **no name, no ceiling and no disclosure duty**. `revocation` + `revocationWindowSeconds` is an OpenWOP original with no upstream analogue — which is exactly why the vocabulary must be complete: a disclosure surface with no honest value for the most common deployment forces every host into either silence or a lie, and both happened. This paragraph is a statement about what the cited documents contain, not a claim of superiority or of any external validation (RFC 0147 §A).

**Consequence for any ceiling: a numeric maximum would be an OpenWOP invention and MUST NOT be attributed upstream.** §B.4 declines to invent one.

## Proposal

### §A The vocabulary gains `exp-only` (`identity.md` §2.2; `auth.schema.json`)

1. `revocation` gains one member, `exp-only`. The `oauth2` and `oidc` rows of §2.2's table read `exp-and-recheck | exp-only`. No other row changes.

2. **`exp-only` names a host that honours `exp` and performs no revocation re-check.** It consults no introspection endpoint, no userinfo endpoint, no revocation list and no host-side epoch or `validAfter` record, and a credential revoked at the trust root is accepted until its own `exp`.

3. `revocationWindowSeconds` (integer ≥ 1) MUST be advertised wherever the rule names a window — now `exp-and-recheck`, `exp-only`, `short-lived` and `rebind`. On every lane it is **an upper bound on the interval between a revocation at the trust root and the host's first refusal**, and a host MUST NOT advertise a window it does not enforce. (§2.2's closing sentence is replaced by this one; the existing three rules keep their meaning, and this sentence states the meaning they already carried.)

### §B The window is enforced, and the refusal has its own code

4. A host advertising `exp-only` on a lane MUST refuse a credential presented on that lane when **either**
   - `exp − iat > revocationWindowSeconds` (the credential's total lifetime), **or**
   - `exp − now > revocationWindowSeconds` (its remaining lifetime),

   with `401` and error code `credential_lifetime_exceeded`. A credential carrying no `iat` MUST be refused with the same code; the first bound cannot be evaluated without it, and `identity.md` §2.1's fail-closed rule applies.

   **Both bounds are load-bearing.** `exp − iat` alone lets a host accept a ten-year token minted ten years ago; `exp − now` alone lets it accept a freshly minted ten-year token in its ninth year.

5. A host that cannot enforce both bounds MUST NOT advertise `exp-only`.

6. **`credential_lifetime_exceeded` is a new row in `spec/v2/errors.json`**: `httpStatus` 401, `retriable` false, `details` null, `since` 2.36, `source` "RFC 0210 §B". A **distinct** code is load-bearing, not cosmetic: under a generic `unauthenticated` a conformance sabotage cannot distinguish "the bound was enforced" from "the host refused for some other reason", and the row would be unfalsifiable. (Precedent for registering a code with its RFC: RFC 0201 §D, `webhook_endpoint_unverified`.)

7. **No numeric MUST ceiling.** `exp-only` SHOULD be advertised with a window of one hour or less. The corpus sets no maximum, because no upstream specification does (§Motivation 5; OAuth 2.1 §7.1.3.5 states only that an *authorization server* SHOULD issue short-lived tokens). A hard ceiling, if ever wanted, belongs in a profile predicate carrying its own evidence, not in the vocabulary.

### §C Lane restriction

8. `exp-only` MUST NOT be advertised on `api-key` or `session`. On those two lanes the host itself issued the credential, so revocation is in its own hands and it has no excuse; both stay `next-request`. This restriction is expressed in `auth.schema.json` as an `if`/`then` over the **new** member only, so it cannot retroactively invalidate any document that validates today (§Compatibility).

### §D A lane's advertised rule MUST be one its row lists

9. A host MUST NOT advertise a `revocation` value that §2.2's row for its lane does not list. **This restates RFC 0170 §B.3 as already written; it mints no new requirement.** What is new is that it is now measured: `v2-lane-issuer-advertised.test.ts` gains a leg binding each lane to its row's rule set, minting `openwop.requirement.0170.lane-issuer-advertised.lane-rule`. That leg lands with this filing.

10. The `anonymous` row's revocation cell is `—`, and the facet schema nonetheless REQUIRES `revocation` on every lane member — so an `anonymous` lane must advertise something the table does not name. The §D.9 leg therefore leaves `anonymous` unconstrained and says so in its message. Resolving the `—` is out of scope here and is register row **G1**.

### §E The unknown-member rule

11. A consumer that meets an unrecognized `revocation` value MUST NOT act on it: it MUST treat the lane as **stating no revocation latency**, and MUST NOT read it as `next-request` or as any other member. This is `overview.md` §0's unknown-member tolerance applied to this enum; §0's category "reason vocabularies" (RFC 0197 §A.2 R4 writes it "registry-backed **or advertised** enum") covers `revocation`, which is advertised rather than registry-backed. The RFC states this explicitly because `revocation` has no registry file, so §0's "add a row to its registry and regenerate" has no literal referent here (register **G2**).

### §F Disclosure is the honest substitute for a ceiling

12. `INTEROP-MATRIX.md` gains a section stating, per host and per lane, the advertised `revocation`, the advertised window, and **what measures it**. A reader comparing `exp-only 3600` against `next-request` draws the right conclusion unaided; a reader comparing `short-lived 3600` against the note that nothing on that host re-checks draws a different one. This section lands with this filing rather than with the Active flip, so the record of MyndHyve's over-claim does not depend on this RFC landing.

13. **The correction MyndHyve owes.** Either implement the re-check (`verifyIdToken(token, true)`), after which `short-lived` is still the wrong member but `exp-and-recheck` is available and true; or advertise `exp-only` with a window it enforces under §B. Either way the committed bundle is re-cut. The handoff is `review/handoff-myndhyve-0210.md`. Sequencing: RFC 0200's header already requires a MyndHyve deploy of its §A/§B before 0200's first certifying cut — **one deploy, both changes.**

### §G A new corpus gate keeps the three surfaces in lockstep

14. `scripts/check-lane-revocation-rules.mjs` derives the lane → rule map from `identity.md` §2.2's table and checks that (a) the facet schema's `revocation` enum is exactly the union of the rules the table names, and (b) the suite's enforced map is byte-equal to the table's. It lands with this filing, green on today's tree. Had it existed, the divergence in §Motivation 3 could not have opened.

## Compatibility

**Classification: `additive`**, under `spec/v2/core/overview.md` §0 (RFC 0171 §A.5): "A registry-backed enum (event types, error codes, envelope kinds, **reason vocabularies**, lanes) grows by adding a row … **Adding a member is additive in v2.x**." `credential_lifetime_exceeded` is a row in `spec/v2/errors.json`, which *is* registry-backed; RFC 0201's `webhook_endpoint_unverified` is the precedent.

- **RFC 0197 §0a does not bind.** §0a governs retirement and reshape. Nothing is removed, renamed, retyped, moved, closed or made REQUIRED. `check-v2-surface-monotone.mjs` reports no removal; `check-v2-retirement.mjs` is not engaged.
- **Every document valid before stays valid.** A host on `exp-and-recheck`, `next-request` or any other member is untouched. `auth` is `experimental` / `adoption: none` in `spec/v2/declaration.json`.
- **§C's schema restriction cannot invalidate anything retroactively.** It is an `if`/`then` whose antecedent is `revocation === "exp-only"` — a value no committed document can carry, because the member does not exist until this RFC is `Active`. The **full** lane → rule binding is deliberately **not** put in the schema: `evidence/v2-host-bundles/myndhyve.json:488` carries `short-lived` on `oidc`, and a schema `if`/`then` over the whole table would make a bundle cut before the rule retroactively invalid — the P1 failure mode RFC 0197 §Motivation records. The binding belongs in the suite, where `COMPATIBILITY.md` §2.3 keeps a bundle "a valid measurement at its suite version".
- **Where the tightening actually lives: the suite.** The §D.9 leg fails a cut from a host advertising a rule its lane's row does not list. On today's committed bundles that is **exactly one**: MyndHyve. The reference host (`api-key`, `session`, `saml`, `scim`, `workload`) and openwop-app (`api-key`, `session`, `anonymous`) both pass. This is disclosed in `conformance/CHANGELOG.md` under `[2.36.0]` and in §F's matrix section. MyndHyve's committed 2.35.x bundle **stays a valid measurement at its suite version**; only cuts taken on the suite minor that ships the leg are affected — the same disposition RFC 0197 §C gave the 38-family maturity over-claim.
- **Error codes.** One code added; none changed or removed. A client that does not know `credential_lifetime_exceeded` still sees `401` and the canonical envelope.
- **Strict consumers.** A consumer validating an `exp-only` advertisement against the *old* facet schema rejects it — the "additive for producers, breaking for strict consumers" hazard RFC 0171 G6 records, with the corpus's usual mitigation (no `$id` bump; consumers pin `@openwop/spec-artifacts`).

## Conformance

### Lands with this filing

- **`v2-lane-issuer-advertised.test.ts` — one new leg** (major 2, unaided), minting `openwop.requirement.0170.lane-issuer-advertised.lane-rule`. It binds each advertised lane to the rule set §2.2's row for it lists, leaving `anonymous` unconstrained (§D.10) and naming that exemption in its message. It cites **RFC 0170**, which is `Accepted`; it does not cite this RFC, and it enforces nothing this RFC adds.
- **`scripts/check-lane-revocation-rules.mjs`** (§G), wired into `openwop:check` stage 10.

### Lands when this RFC is `Active`

`check-rfc-status-coherence.mjs` rule 7 refuses a shipped scenario that cites a `Draft` RFC, and the precedent is one day old: openwop#1463 filed RFC 0194/0195/0196 `Draft` and recorded "Specs and scenarios for 0194 and 0196 land when each is `Active` — a scenario may not cite a `Draft` RFC."

The **spec text, the schema member, the error row and the invariant are held back for a second reason that is this RFC's own argument**: shipping `exp-only` into the enum before its enforcing scenario exists would open, for the length of the comment window, precisely the laundering hatch this RFC was written to close. A member with no measured refusal is strictly cheaper than every alternative and every host would pick it. The member and its teeth land together or not at all.

- **New: `conformance/src/scenarios/v2-lane-exp-only-bound.test.ts`** (major 2). Gated on a lane advertising `exp-only` (`inapplicable`, with that reason, otherwise); harness-gated on `OPENWOP_TEST_OIDC_ISSUER_URL` for the minting legs.
  - **Control leg:** a correctly signed token with `exp − iat = window − 60`, correct `iss`/`aud`, not expired → the host MUST accept it. *Without the control leg the row passes on a host that refuses everything* — the vacuous-witness trap.
  - **Sabotage leg (total lifetime):** the same token with `exp − iat = window + 60`, still unexpired → `401`, `error.code === "credential_lifetime_exceeded"`.
  - **Sabotage leg (remaining lifetime):** a token whose `exp − iat` is inside the window but whose `exp − now` exceeds it (clock-skewed `iat`) → the same refusal.
  - **Code leg:** the refusal carries `credential_lifetime_exceeded`, not a generic `unauthenticated` — the distinction §B.6 exists for.
- **New: `conformance/src/coherence/v2-lane-exp-only-schema.test.ts`** (corpus gate only; never reaches a host bundle). Mints `openwop.requirement.0210.exp-only-lane-restricted` — `exp-only` validates on `oauth2` and `oidc`, is refused on `api-key` and `session`, and each refusal is re-run against a facet copy with only the §C.8 `if`/`then` removed, where it MUST pass — and `openwop.requirement.0210.lane-rule-surfaces-agree`, which drives `check-lane-revocation-rules.mjs` red once per surface rather than asserting exit 0 on a clean tree.
- **New invariant `lane-exp-only-lifetime-bounded`** (tier `protocol`, severity `high`, threat model `SECURITY/threat-model-auth-profiles.md`, test `v2-lane-exp-only-bound.test.ts`). It cannot land before its test: `check-security-invariants.sh` requires every protocol-tier invariant to name at least one public test.

No requirement id enters `floorScenarios` or a profile predicate.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.1–§A.3 `exp-only` is an advertisable member with a window (`openwop.requirement.0210.exp-only-advertised`) | a lane advertising `{ "lane": "oidc", "revocation": "exp-only", "revocationWindowSeconds": 3600 }` validates against `auth.schema.json` and passes `v2-lane-issuer-advertised` (planned suite leg) | the suite, unaided, on a host advertising it | witnessable — gated on a host advertising `exp-only`; `inapplicable` with that reason otherwise. Sabotage: remove the enum member and the advertisement fails validation |
| §B.4 total lifetime is bounded (`openwop.requirement.0210.exp-only-lifetime-bound`) | a correctly signed, unexpired token with `exp − iat = window + 60` **and `exp − now` inside the window** (an `iat` dated behind the host's clock) is answered `401`, and so is one carrying no `iat` (`v2-lane-exp-only-bound.test.ts`) | the suite, with a harness issuer (`OPENWOP_TEST_OIDC_ISSUER_URL`) | witnessable — gated on the harness issuer and an `exp-only` lane. Sabotage: delete the `exp − iat` comparison in the host verifier and the leg passes the oversized token. **The skew is load-bearing and was found by running that sabotage** (row S6 below): a token minted at `now` with `exp` past the window is outside BOTH bounds, so a host enforcing only `exp − now` refuses it and the row goes green over a broken host. §B.4's first example — the ten-year token minted ten years ago — is the only shape that isolates this bound |
| §B.4 remaining lifetime is bounded (`openwop.requirement.0210.exp-only-remaining-bound`) | a token with `exp − iat` inside the window but `exp − now` beyond it is answered `401` | as above | witnessable — gated as above. Sabotage: keep only the `exp − iat` comparison and the skewed token is accepted |
| §B.4 a control credential is accepted (`openwop.requirement.0210.exp-only-control-accepted`) | a token at `exp − iat = window − 60` is accepted on the same lane, in the same run | as above | witnessable — gated as above. Sabotage: refuse every token and this leg fails, which is what makes the two refusal legs non-vacuous. Run as row S10 |
| §B.6 the refusal names its own code (`openwop.requirement.0210.credential-lifetime-code`) | the `401` envelope carries `error.code === "credential_lifetime_exceeded"`, a code registered in `spec/v2/errors.json` | as above | witnessable — gated as above. Sabotage: refuse with `unauthenticated` and the leg fails |
| §C.8 `exp-only` is refused on `api-key` and `session` (`openwop.requirement.0210.exp-only-lane-restricted`) | `{ "lane": "api-key", "revocation": "exp-only" }` fails `auth.schema.json` validation | the suite, unaided (corpus) | witnessable — unaided (corpus), `v2-lane-exp-only-schema.test.ts`: each negative is validated a second time against a copy of the facet with ONLY the `if`/`then` removed and MUST pass there, so it cannot be failing for any other reason |
| §D.9 a lane advertises only a rule its row lists (`openwop.requirement.0170.lane-issuer-advertised.lane-rule`) | a host advertising `revocation: "short-lived"` on an `oidc` lane fails the leg; `anonymous` is exempt and the message says so (`v2-lane-issuer-advertised.test.ts`, **shipped with this filing**) | the suite, unaided, against any v2 host | witnessable — unaided: it fails MyndHyve's captured discovery document today and passes the reference host's and openwop-app's. Sabotage run: §Implementation notes |
| §E.11 an unknown member is read as "no stated latency" | a consumer meeting `revocation: "x-vendor-thing"` does not treat the lane as `next-request` | — | claims-check — a rule about consumer behaviour inside a client, not observable on the host's wire; stated so a client author has a rule to follow rather than a default to guess |
| §G.14 the table, the schema enum and the suite map agree (`openwop.requirement.0210.lane-rule-surfaces-agree`) | `scripts/check-lane-revocation-rules.mjs` exits 0 (**shipped with this filing**; minted as a row by `v2-lane-exp-only-schema.test.ts` when this RFC went `Active`) | the corpus gate, unaided | witnessable — unaided (corpus): the test drives the gate red one surface at a time in a throwaway corpus copy — an enum member with no §2.2 row, and a suite `LANE_RULES` entry the table does not license — and asserts the refusal names the surface that diverged |

## Alternatives considered

- **Mandate a real re-check on `oauth2`/`oidc`.** Upstream requires it nowhere (§Motivation 5); Google documents skipping it; it binds a protocol-generic lane to a per-request vendor round trip plus an IAM grant. And the corpus **already has the value for a host that does it** — `exp-and-recheck`, with its cache window. Making the re-check mandatory would delete the only truthful description of the majority deployment. Whether to pay for the round trip stays a product decision.
- **Leave the vocabulary alone.** The one option that leaves a false statement standing in a bundle certified `openwop-core-standard`, keeps `short-lived`-on-`oidc` as the pattern RFC 0200 §Examples teaches, and preserves the v1/v2 discovery regression on the honest host (§Motivation 2). It also does not buy what it appears to: MyndHyve advertises `oidc` today and is therefore *bound* by RFC 0200 §A/§B, so 0200 has a production witness either way — the problem is that 0200's only production witness reaches its lane gate through an unsound advert.
- **Add `exp-only` with no enforced bound.** This is the version of this proposal that would be **manufactured evidence**: openwop-app could advertise the lane with a one-line diff and nothing observable would change. §B is what makes the advertisement cost something.
- **A numeric MUST ceiling (say, 3600 s).** Inventing a maximum and implying upstream backing would be exactly the "industry standard" claim RFC 0147 §A bans. The corpus's job is that the number be true, not that it be small. Disclosure (§F) plus enforcement (§B) beat a number nobody upstream wrote down.
- **Ban `exp-only` from `openwop-core-standard`.** Tempting and wrong. It restores today's two failure modes — a truthful host omits the lane, or an eager host launders it as `short-lived` — with the added harm that omitting the lane now also costs the profile, so the ban would push hosts toward the *dishonest* option. **A vocabulary that punishes the honest answer will not be answered honestly.**
- **Fold this into RFC 0200.** 0200 is the tempting host: `Active`, already amending `identity.md`, already blocked by this gap, an override already recorded, one window instead of two. Declined on scope (§2.2 is RFC 0170's surface; 0200 is scoped to inbound protected-resource discovery and touches §2.1 and a new §2.5) and, decisively, on governance — see the `Updated` field.
- **Put the full lane → rule binding in the schema.** Retroactively invalidates MyndHyve's committed bundle (§Compatibility).

## Unresolved questions

1. The `anonymous` row's revocation cell is `—` while the schema requires the field. What should an `anonymous` lane advertise? Both production hosts that have one advertise `next-request`. Register **G1**.
2. `revocationWindowSeconds` is not conditionally required by the schema, only by prose and one scenario leg. Making it `if`/`then`-required on the windowed rules would hit the same retroactive-invalidation problem as the full lane → rule binding. Register **G3**.
3. Should `revocation` become a registry file (`spec/v2/revocation.json`) so §0's "add a row and regenerate" has a literal referent? Tidier; probably not worth the churn for a ten-member enum. Register **G2**.
4. Should `exp-only` on a lane whose `minimumAssurance` is `sender-constrained` get a longer SHOULD window, since a stolen token is not replayable? Not decided here; no host has asked.

## Implementation notes (non-normative)

- **Host work to witness §B.** openwop-app: add the two comparisons to `OidcVerifier.verify()` (≈3 lines) and then advertise the `oidc` lane in `v2AuthFamily()`, rewriting the ADR 0730 C.3 comment to record the resolution rather than the gap. Tier `self`/tier-1. MyndHyve: the same bound, `short-lived` → `exp-only`, re-cut; tier-2 (steward-affiliated sibling — sufficient to graduate under the single-witness waiver, and it does **not** fire the INTEROP non-steward tripwire). This is not manufactured evidence: openwop-app genuinely operates an OIDC front door and says so in its own v1 advert (`discovery.ts:442`); the lifetime bound is a real behaviour change that host does not perform today and that a sabotage can falsify.
- **Sabotage matrix for the §D.9 leg and the §G.14 gate, executed 2026-09-22** on the v2-reference host at loopback (throwaway worktree, reverted and removed; no host change was committed). Each row was run as its own boot, with the new process confirmed to own the port and the *served* discovery document confirmed to carry the sabotage before the row was believed.

  | # | Condition | Expected | Observed |
  | --- | --- | --- | --- |
  | C1 | control — host unchanged, `oidc` lane advertised with `exp-and-recheck` / 300 | pass, non-vacuously | 3/3 tests pass; `…lane-rule` `executed-pass`, no `partial-witness:` detail |
  | C2 | control — host unchanged, no `oidc` lane (5 lanes) | pass | 3/3 pass |
  | S1 | `oidc` advertises `short-lived` / 3600 — **MyndHyve's exact advertisement** | `lane-rule` fails | `executed-fail`: *lane oidc advertises revocation "short-lived", which §2.2's row for that lane does not list (it lists "exp-and-recheck")*. The two pre-existing legs (`members`, `window`) **still pass** — which is the gap. |
  | S2 | `saml` advertises `crl` (a rule §2.2 states only for `mtls`) | `lane-rule` fails | `executed-fail`, naming `saml` and `crl` — the leg is not `oidc`-specific |
  | S3 | an `anonymous` lane advertises `crl` | **pass** (the lane is exempt) | 3/3 pass — the exemption is a real hole, recorded as register **G1**, not papered over |
  | S4 | gate: `exp-only` added to the facet enum with no §2.2 table row | gate fails | exit 1: *the `revocation` enum is not the union of §2.2's rules — in the schema only: [exp-only]* |
  | S5 | gate: the suite's `LANE_RULES` widened for `oidc` without the table | gate fails | exit 1: *lane `oidc`: §2.2 says [exp-and-recheck]; conformance LANE_RULES says [exp-and-recheck, short-lived]* |
- **Sabotage matrix for §B, executed 2026-09-23** on the v2-reference host at loopback (throwaway `openwop-examples` worktree carrying an env-gated `exp-only` advertisement plus the two comparisons in `oidc-lane.ts`; reverted and the worktree removed — **no host change was committed, and no bundle was cut**, so the four §B rows remain owed on a committed bundle). Each row was its own boot: the previous pid was killed, `lsof -ti :3939` confirmed free, the sabotage confirmed present in the source `tsx` loads, and the NEW pid confirmed to own the port before any row was believed (the EADDRINUSE false-pass hazard).

  | # | Condition | Expected | Observed |
  | --- | --- | --- | --- |
  | C3 | control — `oidc` lane advertising `exp-only` / 300 s, both bounds enforced | pass, non-vacuously | 4/4 tests, **5 requirement ids `executed-pass`**, no `inapplicable`, no `partial-witness:` detail |
  | S6 | delete the `exp − iat` comparison, **scenario as first written** (token minted at `now`) | total-lifetime leg fails | **it passed.** The fixture was outside both bounds, so `exp − now` refused it and the row measured the wrong clause. The scenario was corrected to date `iat` behind the host's clock; this row is why |
  | S7 | delete the `exp − iat` comparison, corrected scenario | total-lifetime leg fails | `executed-fail` ×2 — the total-lifetime leg and the §B.6 code leg. Control and remaining-lifetime legs still pass, so the sabotage is isolated to the clause it broke |
  | S8 | keep only the `exp − iat` comparison | remaining-lifetime leg fails | `executed-fail`; the other three legs pass |
  | S9 | enforce both bounds, refuse with a generic `unauthenticated` | the §B.6 code leg fails | `executed-fail` ×3 (both refusal legs assert the code; the control still passes) — which is precisely why §B.6 registers a distinct code |
  | S10 | refuse every token on the lane | the control leg fails | `executed-fail`: the control goes red and the two refusal legs stop counting as evidence — the vacuous-witness trap, caught |
  | S11 | advertise `exp-only` on the **`api-key`** lane (§C.8) | the host cannot serve a valid discovery document | `500` from the host's own strict validation: *data/auth/lanes/0/lane must NOT be valid; data/auth/lanes/0 must match "then" schema* |
- **Core word delta: 0 for this filing** (no `spec/v2/core/` prose lands). When `Active`, §A–§E add roughly 190 words to `identity.md` §2.2 against a cap headroom of 2,661 (`check-core-budget`: 27,339 / 30,000), so no family needs homing to fund it. **Measured on the landing tree: +349 words** (27,339 → 27,688 / 30,000), not the ~190 estimated — the §2.2 paragraph states both bounds, the no-`iat` case and the two lanes the member is refused on, and the estimate counted the rule without the clauses that make it enforceable. Headroom after: 2,312. No family needed homing.
- **Regenerate order when `Active`:** `auth.schema.json` and `errors.json` by hand → `generate-error-envelope.mjs --write` → `generate-spec-artifacts.mjs --write` → `generate-requirement-registry.mjs --write` → `generate-scenario-majors.mjs --write` → `generate-protocol-status.mjs --write`.

## Acceptance criteria

- [ ] ~~The public comment window closes (2026-09-29) with no unresolved objection, and the RFC moves `Draft → Active` **without a waiver**.~~ **Not met as written, and recorded rather than rewritten.** The window did not run: the steward waived it on 2026-09-23 as an explicit override of RFC 0147 §A.6 (`Updated`; `MAINTAINERS.md` ledger row 0210). Acceptance is therefore provisional and the RFC 0156 §B retrospective review is owed — `docs/WAIVER-RETROSPECTIVE-REGISTER.md` row 0210, outcome `not-reviewed`.
- [x] `INTEROP-MATRIX.md` discloses, per host and per lane, the advertised revocation rule, its window, and what measures it — including MyndHyve's `short-lived` over-claim, recorded independently of this RFC's fate (§F.12).
- [x] `scripts/check-lane-revocation-rules.mjs` keeps §2.2's table, the facet enum and the suite's map in lockstep, and is green on the tree it landed on (§G.14).
- [x] `v2-lane-issuer-advertised.test.ts` binds each lane to its row's rule set, `anonymous` exempted and named (§D.9), with the sabotage run recorded in §Implementation notes.
- [x] `identity.md` §2.2, `auth.schema.json`, `spec/v2/errors.json` and `SECURITY/invariants.yaml` carry §A–§C, and `generate-error-envelope --check` / `generate-spec-artifacts --check` pass. The §2.2 table's `oauth2` and `oidc` rows read `exp-and-recheck | exp-only`; the facet gains the member and the §C.8 `if`/`then`; `credential_lifetime_exceeded` is a `since: "2.36"` row; the invariant is `lane-exp-only-lifetime-bounded`, traced in `threat-model-auth-profiles.md` §4.4.
- [x] **The member and its teeth landed in the same change** (§Conformance's second reason for holding §A back). `v2-lane-exp-only-bound.test.ts` ships with the enum member, carrying the control leg and both refusal legs; `v2-lane-exp-only-schema.test.ts` mints the §C.8 and §G.14 corpus rows. At no point does the corpus offer `exp-only` with nothing measuring it.
- [ ] `v2-lane-exp-only-bound.test.ts` records `executed-pass` for all four §B ids on a committed bundle from a host advertising `exp-only`, with the control leg passing **in the same run** as the two refusal legs.
- [ ] A second, independent witness (tier-2) records the same rows.
- [ ] MyndHyve's advertisement is corrected and its bundle re-cut (§F.13), so no committed bundle advertises a rule nothing measures.
- [x] CHANGELOG entry.

## References

- OAuth 2.1 draft-16 §1.4, §5.2, §7.1.3.5; <https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1>, fetched 2026-09-22.
- RFC 9068 §4, §5 (full-text checked for "revoc": no occurrence); <https://www.rfc-editor.org/rfc/rfc9068>, fetched 2026-09-22.
- RFC 7662 §4 (introspection caching and the revocation window); <https://www.rfc-editor.org/rfc/rfc7662>, fetched 2026-09-22.
- RFC 9728 (full-text checked for "revoc", "introspect", "latency", "lifetime": no occurrence); <https://www.rfc-editor.org/rfc/rfc9728>, fetched 2026-09-22.
- MCP 2026-07-28, Authorization §"Token Validation" and Security Considerations; <https://modelcontextprotocol.io/specification/2026-07-28>, fetched 2026-09-22.
- Firebase, "Verify ID Tokens" and "Manage session cookies / revoke refresh tokens"; <https://firebase.google.com/docs/auth/admin/verify-id-tokens>, fetched 2026-09-22.
- RFC 0170 §B.2–§B.3 (`spec/v2/core/identity.md` §2.2, the owning surface); RFC 0171 §A.5 / `spec/v2/core/overview.md` §0 (additive enum growth); RFC 0197 §0a and §C (retirement; a bundle is evidence at its suite version); RFC 0201 §D (error-code registration precedent); RFC 0200 §Examples and its `Updated` override; RFC 0147 §A and §A.6; openwop#1463 (the `Draft`-filing precedent).
- `review/arch-lane-vocab.md` — the architect ruling this RFC implements, with the read-only verification of both hosts.
