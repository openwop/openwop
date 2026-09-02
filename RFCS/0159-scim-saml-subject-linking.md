# RFC 0159: SCIM ⟷ SAML subject linking (the combined-deployment leaver contract)

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0159                                                            |
| **Title**         | A subject-linking obligation for hosts advertising **both** `openwop-auth-saml` and `openwop-auth-scim`: a SCIM deactivation MUST fail-close the linked SAML identity, keyed on an opaque IdP-stable subject id — so a provisioned leaver cannot still SSO in |
| **Status**        | `Accepted`                                                      |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-08-31                                                      |
| **Updated**       | 2026-09-01 (`Active → Accepted` — the reference host (openwop-app) implements the cross-lane leaver deny; witnessed behaviorally, see § Implementation record. `Draft → Active` on 2026-08-31 waived the 7-day comment window per `GOVERNANCE.md` single-maintainer lazy consensus, as RFC 0050 did; wire shape locked at `Active`.) |
| **Affects**       | `spec/v1/auth-profiles.md` (new cross-profile "Subject linking" subsection + discovery flag) · `schemas/capabilities.schema.json` (new optional `auth.subjectLinking` boolean) · RFC 0050 (gains an **Amended by** forward pointer) · extends RFC 0048 (principals) + RFC 0049 (roles, fail-closed §C) · new conformance scenario `auth-subject-link.test.ts` |
| **Compatibility** | `additive` per `COMPATIBILITY.md` (new **optional** discovery flag; its MUSTs bind only the hosts that opt in — no host conforming to RFC 0050 today de-conforms) |
| **Supersedes**    | —                                                              |
| **Superseded by** | —                                                              |
| **Amended by**    | [RFC 0164](./0164-mandatory-subject-linking.md) — the contract becomes **mandatory** for any host advertising both profiles; `subjectLinking` is derived (MUST be `true` when both are advertised) and deprecated toward v2; the §A.4 "do not set the flag" escape is removed (closes UQ1). · [RFC 0163](./0163-subject-linking-hardening.md) — additive hardening: a declarable, witnessable link-key class (`capabilities.auth.subjectLinkKey`, a closed enum of allowed classes only) that converts this RFC's §A.2/§A.4 negative-existence mutable-key prohibition into a positive advertisement (closes UQ2/UQ3), plus a same-IdP trust-root MUST before a link may form (closes UQ4 / register R5). Both gated on `subjectLinking:true` — additive, nothing de-conforms. |

## Summary

RFC 0050 defines the `openwop-auth-saml` and `openwop-auth-scim` profiles as independent lanes: SCIM `active:false`/`DELETE` deactivates *that* provisioned principal, and SAML maps an assertion onto *its* principal — but nothing ties the two to the same human. On a host that advertises **both** profiles, a leaver deactivated over SCIM can still authenticate over SAML, because the two lanes mint structurally different subjects. This RFC adds a **cross-profile subject-linking obligation**, discoverable via a new optional `capabilities.auth.subjectLinking` flag: a host that sets the flag MUST maintain a same-tenant link between the SAML and SCIM identities of one human — keyed on an **opaque, IdP-asserted, stable** identifier (never a mutable/PII attribute) — and MUST fail-close the linked SAML identity when SCIM deactivates it. The mechanism is **link, not merge**: the two durable subjects stay distinct (merging is replay/fork-unsafe), and deactivation propagates a deny across the link.

## Motivation

A combined SAML-SSO + SCIM-provisioning deployment is the standard enterprise identity shape, and its whole point is lifecycle automation — the joiner/mover/**leaver** flow. The leaver half is the security-load-bearing one: when HR deprovisions someone in the IdP, SCIM pushes an `active:false` and the person must lose access *everywhere*, including SSO.

Today the two OpenWOP profiles do not connect. The reference host (openwop-app) derives a durable subject key from the principal — `userIdFor = user:<sha256(tenant:principalId)>` — so a SAML login (`saml:<NameID>`) and a SCIM user (`scim:<userName>`) are two different durable subjects for the same person. RFC 0050's SCIM requirement (`spec/v1/auth-profiles.md §openwop-auth-scim`: "a deactivated principal's subsequent authorization decisions MUST deny") is honoured — but only for the `scim:` subject. The `saml:` subject is untouched. **Result: a SCIM-deactivated leaver still passes SAML authentication and continues to get authorized.** This was surfaced as `USERS-2` in the openwop-app steward audit ("Blocker for a combined SAML+SCIM deployment").

The spec is the right place, not host code, because (1) the join has no safe key today — `externalId` is *captured* by SCIM but is not the durable subject key, and the tempting fallback (email/`userName`) is **mutable and PII**, which makes an email-based join an account-takeover vector (an attacker who can set their IdP email to a victim's could link — and inherit — the victim's SAML subject); and (2) the fix is a new normative obligation on the auth-profile family that every combined host must implement the same way to be certifiable. Left to per-host code, each vendor re-litigates the join key and some will reach for email — exactly the footgun-per-host outcome RFC 0050 and RFC 0010 exist to prevent.

## Proposal

### §A — Cross-profile subject linking (new subsection in `spec/v1/auth-profiles.md`)

This obligation applies to a host that advertises **both** `openwop-auth-saml` **and** `openwop-auth-scim` **and** advertises `capabilities.auth.subjectLinking: true`.

- **§A.1 — Link, keyed on an opaque IdP-stable id.** The host MUST maintain a **subject link** between the RFC 0048 `principal` produced by SAML assertion validation and the RFC 0048 `principal` produced by SCIM provisioning when both denote the same human. The link key MUST be an **opaque, IdP-asserted, stable** identifier: the SCIM resource `externalId` matched to the SAML persistent-format `NameID` (or a host-configured stable linking attribute asserted by the same IdP). The link MUST be scoped to a **single tenant**; the host MUST NOT link identities across tenants.
- **§A.2 — The link key MUST NOT be mutable or PII.** The host MUST NOT use email, `userName`, display name, or any operator/user-mutable attribute as the link key. (Rationale: a mutable/PII key lets a caller who can influence that attribute join — and inherit — another subject; see `SECURITY/threat-model-auth-profiles.md`.)
- **§A.3 — Cross-lane deactivation (the leaver contract).** When SCIM deactivates a provisioned user (`DELETE /Users/{id}` or `PATCH` to `active:false`), the host MUST deny subsequent authorization decisions for the **linked** SAML identity as well, fail-closed, composing with RFC 0049 §C — not only for the SCIM-provisioned principal. Equivalently: after a SCIM deactivation, a SAML assertion for the linked subject MUST NOT yield an authorized decision.
- **§A.4 — Fail closed absent a link key.** If, for a given pair of identities, no opaque IdP-stable link key is available (the IdP asserts no persistent `NameID` / no `externalId`), the host MUST NOT claim the combined leaver guarantee for those identities: it MUST either refuse the link (treat the two as independent subjects and NOT set `subjectLinking:true`) or fail closed on the SAML lane for the unlinkable subject. A host MUST NOT silently fall back to a mutable/PII key, and MUST NOT advertise `subjectLinking:true` while any admitted identity pair is joined on a non-conforming key.

Non-normative: the link is a **reference, not a merge**. The two durable subjects (`saml:…` and `scim:…`) remain distinct records; nothing rewrites a subject key already stamped on a run (which would break replay / `:fork`, per RFC 0006 / the owner-echo determinism RFC 0048 §D depends on). Deactivation sets a link-scoped deny that the SAML decision path consults.

### §B — Discovery flag (`schemas/capabilities.schema.json`)

Add an **optional** boolean under `auth` (which is `additionalProperties: true`, so the addition is purely additive — an explicit property description, not a shape tightening):

```diff
   "auth": {
     "type": "object",
     "properties": {
       "profiles": { "type": "array", "items": { "type": "string", "minLength": 1 }, "uniqueItems": true },
+      "subjectLinking": {
+        "type": "boolean",
+        "description": "RFC 0159. When true, this host advertises BOTH openwop-auth-saml and openwop-auth-scim AND honours the cross-profile subject-linking obligation: a SCIM deactivation fail-closes the linked SAML identity, keyed on an opaque IdP-stable subject id (SCIM externalId ↔ persistent SAML NameID; never a mutable/PII attribute), same-tenant only. Optional; absent/false means the SAML and SCIM lanes are independent and the combined leaver guarantee is NOT claimed."
+      }
     },
     "additionalProperties": true
   }
```

- Optional, default absent (treated as `false`). Existing clients ignore it; existing hosts do not emit it.
- A host MUST NOT set `subjectLinking: true` unless it also advertises both `openwop-auth-saml` and `openwop-auth-scim` in `auth.profiles[]` and honours §A. (RFC 0164 adds the converse: a host advertising both MUST set it `true` — the flag is derived.) (This keeps the RFC 0011 / RFC 0048 §D authorization-oracle discipline: advertise only what you honour.)

### Examples

**Positive (conforming).** Host discovery:

```json
{ "auth": { "profiles": ["openwop-auth-saml", "openwop-auth-scim"], "subjectLinking": true } }
```

Sequence: SCIM `POST /Users` provisions `{ "externalId": "idp-op-8f3a", "userName": "r.smith", "active": true }` → principal `scim:r.smith`. A SAML assertion arrives with persistent `NameID` = `idp-op-8f3a` → principal `saml:idp-op-8f3a`; the host links the two on `idp-op-8f3a` (§A.1). Later, SCIM `PATCH /Users/{id}` sets `active:false`. A subsequent SAML assertion for `NameID = idp-op-8f3a` now yields a **denied** authorization decision (§A.3), not merely a deactivated `scim:` subject.

**Negative (MUST reject / MUST NOT claim).** Same host, but the IdP asserts no persistent `NameID` and the operator configures the link on **email**. The host MUST NOT form the link on email (§A.2); it MUST either fall back to independent subjects and not set `subjectLinking:true`, or fail closed on the SAML lane for the unlinkable subject (§A.4). A discovery doc advertising `subjectLinking:true` while joining on email is **non-conforming**.

## Compatibility

**Classification: `additive`.** The change is a new **optional** capability flag plus normative obligations that bind **only** the hosts that set it. Per `COMPATIBILITY.md` §2.2: no required→optional or type change; no event-shape change; the SCIM/SAML endpoint contracts are unchanged; no existing `MUST` is relaxed; error-code meanings are unchanged (the cross-lane deny reuses RFC 0049 §C fail-closed semantics and the existing `forbidden`/`unauthenticated` envelope from RFC 0050 §SAML). A host that conforms to RFC 0050 today does not advertise `subjectLinking` and remains fully conforming.

Backward-compatibility clauses:

- `auth.subjectLinking` is optional with default-absent (= `false`); existing clients ignore it; existing hosts don't emit it.
- The §A MUSTs are gated on `subjectLinking:true`; a host that never sets it incurs no new obligation.
- SAML-only and SCIM-only hosts are entirely unaffected (the obligation requires *both* profiles).

**Why not safety-fix?** The *motivation* is a security gap (a leaver bypass), but the *mechanism* is opt-in, so nothing de-conforms and no migration/embargo is required. The stronger posture — making cross-lane deactivation **mandatory** for any host advertising both profiles — is a `breaking` change (it de-conforms every current combined host) and is deliberately deferred to a follow-up (see Unresolved question 1). Landing the witnessable contract additively now, then tightening later, mirrors how RFC 0050 itself graduated.

## Conformance

**Existing coverage.** `conformance/src/scenarios/auth-scim-profile.test.ts` (SCIM deactivate ⇒ subsequent deny, for the SCIM subject) and `auth-saml-profile.test.ts` (assertion validation) cover the two lanes independently. Neither exercises the cross-lane link.

**New scenario — `auth-subject-link.test.ts`** (gated on `capabilities.auth.subjectLinking === true`; soft-skips otherwise, per `coverage.md` §"Capability-gated scenarios"):

- `category: subject-link/leaver` — **positive:** provision a SCIM user with an `externalId`; validate a SAML assertion whose persistent `NameID` equals that `externalId` (link forms); SCIM-deactivate; assert the subsequent SAML decision for that subject is **denied** (`expect(decision, driver.describe('auth-profiles.md §Subject linking', '§A.3 cross-lane deactivation fail-closes the linked SAML identity')).toBe('denied')`).
- `category: subject-link/key-hygiene` — **negative:** an operator link configured on `email` MUST NOT produce a cross-lane deny (the host either declines to advertise `subjectLinking` or denies the unlinkable SAML subject); assert that a mutable-key "link" never yields an authorized cross-lane pass (`§A.2` / `§A.4`).

**Fixtures.** Reuses the bundled synthetic SAML IdP (`conformance/src/lib/saml-idp.ts`, RFC 0050) plus a synthetic SCIM payload; the positive case needs the IdP fixture to mint an assertion whose persistent `NameID` matches the SCIM `externalId`. Add a `subject-link` fixture row to `conformance/fixtures.md` if a standing pair is bundled. Both legs are server-free where the seam is available; the live cross-lane path is opt-in via the existing `OPENWOP_TEST_SAML_IDP_URL` / `OPENWOP_TEST_SCIM_URL` seams.

**Capability gate:** `host.auth.subjectLinking` (the discovery flag). **INTEROP-MATRIX:** `INTEROP-MATRIX.md` is host-per-row with advertised profiles listed inline in each host's cell (not a column-per-profile grid), so no structural column is added; `subjectLinking` is noted in a host's cell when that host first advertises it. No current reference host advertises it.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.1 (link on opaque IdP-stable id) | after SCIM-deactivate of a subject linked by `externalId`↔`NameID`, the SAML decision for that subject flips to `denied` | the suite, via the SCIM + SAML seams (needs `subjectLinking` advertised) | witnessable — capability-gated |
| §A.2 (link key MUST NOT be mutable/PII) | a link configured on email does **not** produce a cross-lane deny/pass; a `subjectLinking:true` host never authorizes a SAML subject linked only by email | the suite, by configuring an email "link" and probing the SAML decision | witnessable — capability-gated (**negative-path**: absence of an unsafe join, see UQ2) |
| §A.3 (cross-lane deactivation) | a SAML assertion for the linked subject yields `denied` after SCIM `active:false` | the suite (SCIM deactivate) + operator/IdP (mint the linked assertion) | witnessable — seam-gated |
| §A.4 (fail closed absent link key) | for a subject with no persistent `NameID`/`externalId`, the host either omits `subjectLinking:true` or denies the SAML lane — never a silent mutable-key fallback | the suite, by presenting an unlinkable pair | seam-gated (partly a **claims** check — see UQ2) |
| §B (advertise-only-what-you-honour) | `subjectLinking:true` appears only when both profiles are advertised and §A holds | the suite, by reading discovery + running the §A legs | witnessable, unaided (discovery) |

Note (per the template's two failure modes): §A.2 and §A.4 are partly **negative-existence** properties — "no unsafe join happened." A suite can witness the *positive* consequence (the correct deny/no-pass on the probed pairs) but cannot prove a host never joins on a mutable key for *some* pair it did not probe. UQ2 records this residual and proposes a discovery-declared "link key class" as a future strengthening.

## Alternatives considered

1. **Do nothing.** Combined SAML+SCIM deployments keep the leaver bypass; every host re-invents the join and some pick email, shipping an account-takeover vector under a "conforming" banner. Rejected — this is the exact per-host footgun RFC 0050/0010 exist to prevent, and the leaver flow is the security point of SCIM.
2. **Merge the two subjects into one durable User.** Rejected — the durable subject key is stamped on runs and read verbatim on `:fork` (RFC 0006 / RFC 0048 §C owner echo + RFC 0006 fork determinism); rewriting or coalescing a key already on historical runs breaks replay and cross-workspace isolation reasoning. Link-not-merge keeps both records intact and only propagates a deny.
3. **Make cross-lane deactivation mandatory for any host advertising both profiles (no opt-in flag).** The stronger security posture, but it de-conforms every current combined host in one step → `breaking`, and would land in v2. Deferred to a follow-up (UQ1); this RFC lands the witnessable contract additively first so hosts can adopt and the suite can certify before the ecosystem is forced.
4. **Key the link on email / `userName`.** Rejected — mutable and PII; an attacker able to influence the attribute inherits the linked subject (§A.2 exists specifically to forbid this).

## Unresolved questions

1. **Mandatory follow-up — RESOLVED by RFC 0164 (2026-09-02, `additive`, not v2).** The premise that it "de-conforms every current combined host" was empty: no production host advertised both profiles. Original text: Should a later (breaking, v2) RFC make cross-lane deactivation **mandatory** for any host advertising both `openwop-auth-saml` and `openwop-auth-scim` (retiring the opt-in flag)? If so, on what deprecation window? This RFC deliberately lands opt-in-additive first.
2. **Link-key-class declaration — RESOLVED by RFC 0163 §A** (`capabilities.auth.subjectLinkKey`, closed enum `{opaque-idp, configured-immutable}` + schema conditional). Original text: §A.2/§A.4 are partly negative-existence (a suite cannot prove a host never joins on a mutable key for an unprobed pair). Should discovery declare the link key class (e.g. `auth.subjectLinkKey: "opaque-idp"` vs a rejected `"email"`) so the suite can assert the *claimed* key class and gate on it, converting a claims-check into a witnessable advertisement?
3. **Configured linking attribute — RESOLVED by RFC 0163 §A.1** (the enum names classes, not attributes; the configured attribute is host config under the conjunctive predicate). Original text: §A.1 allows "a host-configured stable linking attribute asserted by the same IdP" beyond `externalId`↔persistent-`NameID`. Should the profile enumerate the acceptable attribute set (e.g. an IdP `oid`/`immutableId`) or leave it to operator config with only the opaque+stable+non-PII constraint?
4. **Same-IdP requirement — RESOLVED by RFC 0163 §B** (MUST share a trust root; SAML `<saml:Issuer>` ↔ the entityID bound to the SCIM connection). Original text: The link presumes both lanes are fed by the same IdP (so the opaque subject id is comparable). Should §A state a MUST that the SAML and SCIM lanes share an IdP trust root before a link may form, to prevent linking a subject across two IdPs that happen to collide on an identifier?

## Implementation notes (non-normative)

- **Reference host (openwop-app).** The link is a per-tenant record keyed on the opaque IdP id, consulted on the SAML decision path; the SCIM deactivate handler sets the link-scoped deny. It does **not** touch `userIdFor` (`usersService.ts`) — no durable key is rewritten. This is host work that lands only after this RFC reaches `Active`; per the goal that surfaced USERS-2, no host code should be written against a guessed contract before the wire shape is pinned here.
- **Sequencing:** spec prose (`auth-profiles.md` §Subject linking) + the `capabilities.schema.json` flag + the RFC 0050 `Amended by` pointer land on `Active`; the conformance scenario + fixture land with it; the reference-host implementation + a live cross-lane pass under `OPENWOP_REQUIRE_BEHAVIOR=true` gate `Active → Accepted`.
- **Cross-cut:** this is auth-profile-family surface (RFC 0010/0050 lineage); additive, so it can merge independently of the workflow-protocol plan — no `CC-N` coordination entry required.

## Acceptance criteria

- [x] Spec text merged — `spec/v1/auth-profiles.md` gains the "Subject linking (SAML ⟷ SCIM)" subsection (§A) + the discovery flag note (§B). (#1153)
- [x] `schemas/capabilities.schema.json` gains the optional `auth.subjectLinking` boolean (added under `auth.properties`, `additionalProperties: true` preserved — no latent breaking change); `redocly lint api/openapi.yaml` stays clean. (#1153)
- [x] RFC 0050 gains an `**Amended by**` row pointing to RFC 0159 with a one-line summary. (#1153)
- [x] At least one conformance scenario (`auth-subject-link.test.ts`) covering §A.3 (positive) + §A.2 (negative), capability-gated on `auth.subjectLinking`. (#1153)
- [x] CHANGELOG entry under the suite version. (#1153)
- [x] Reference host (openwop-app) implements and passes the new scenarios — see § Implementation record. (openwop-app #3581)
- [x] Register sweep: `registers/0159-scim-saml-subject-linking.gaps.md` + `.risks.md` — the remaining open design items are carried forward as Unresolved questions UQ1–UQ4 (mandatory-follow-up RFC, link-key-class declaration, configured linking attribute, same-IdP trust-root MUST); the security-critical R1 (mutable/PII-key join-and-inherit) is closed by the §A.2 MUST-NOT + the `auth-subject-link` email-key negative case + the `SECURITY/threat-model-auth-profiles.md` §4.5 entry (#1154).

## Implementation record

| Item | Where | Status |
| --- | --- | --- |
| Spec + schema + conformance scenario + registers + RFC 0050 `Amended by` | `../openwop` #1153 (`d137f2ff`) | merged |
| `SECURITY/threat-model-auth-profiles.md` §4.5 (join-and-inherit / leaver / cross-tenant) | `../openwop` #1154 (`358ac06b`) | merged |
| Reference-host cross-lane leaver deny — link store on the opaque `externalId`, SCIM-deactivate writes the deny, SAML **validate seam + production ACS** consult it fail-closed, §A.2 mutable-key link rejected, `subjectLinking` discovery gated on both profiles, DSAR eraser (ADR 0464) | openwop-app #3581 (`99716f3c`), ADR 0613 | merged |

**Witness.** The host honours §A (link-not-merge — no `userIdFor` rewrite, so RFC 0048 §C owner-echo + `:fork` replay stay deterministic). The behavioral contract (§A.3 cross-lane leaver deny + §A.2 mutable-key rejection + §B advertisement gating) is executed green by the in-process route-level witness `backend/typescript/test/auth-subject-link.test.ts`, which boots the real host with the seams enabled and runs the exact vendored sequence: provision(externalId) → SAML authenticates → SCIM deactivate → **SAML denied** (`subject_linked_deactivated`), unrelated subject unaffected, email-key link rejected `400`. The vendored `auth-subject-link.test.ts` advertisement-shape leg rides `@openwop/openwop-conformance` ≥ 1.144.0 in openwop-app CI; its behavioral legs are opt-in (`OPENWOP_TEST_SAML_IDP_URL` + `OPENWOP_TEST_SCIM_URL` + a synthetic IdP), mirrored exactly by the in-process witness above.

## References

- RFC 0050 — SAML / SCIM (and optional LDAP) enterprise identity profiles (the amended base).
- RFC 0048 — Identity triple / principals (the durable subject this links); §D owner-echo determinism.
- RFC 0049 — Roles and authorization decisions; §C fail-closed (the deny this propagates).
- RFC 0010 — auth-profile-conformance family (`alg:none` footgun-pinning precedent).
- RFC 0006 — Run orchestrator (subject key stamped on runs; `:fork` replay determinism — why merge is unsafe).
- `spec/v1/auth-profiles.md` §`openwop-auth-saml`, §`openwop-auth-scim`.
- `SECURITY/threat-model-auth-profiles.md` — the mutable/PII-key account-takeover join vector.
- openwop-app steward audit `USERS-2` ("Blocker for a combined SAML+SCIM deployment"); the recorded `/architect` link-not-merge ruling (openwop-app `docs/steward/CODEBASE-ASSESSMENT.md`, 2026-08-30).
- Prior art: SCIM 2.0 (RFC 7644) `externalId`; SAML 2.0 persistent `NameID` format (OASIS); SCIM/IdP leaver-deprovisioning practice.
