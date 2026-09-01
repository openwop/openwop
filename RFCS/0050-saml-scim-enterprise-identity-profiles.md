# RFC 0050: SAML / SCIM (and optional LDAP) enterprise identity profiles

| Field | Value |
| --- | --- |
| **RFC** | 0050 |
| **Title** | Two new entries in the auth-profile family — a SAML assertion-validation profile and a SCIM provisioning profile (LDAP as an optional directory-bind variant) — that sync external IdP users/groups onto RFC 0048 principals + RFC 0049 roles, with `alg:none` rejection mirroring the OIDC work |
| **Status** | `Accepted` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-24 |
| **Updated** | 2026-06-01 (`Active → Accepted`) — graduated on the **non-steward host** MyndHyve, whose **real XML-DSig SAML ACS + SCIM provisioning** the steward **independently drove over the live wire** (rev `workflow-runtime-00453-hot @ 100%`, `https://api.myndhyve.ai`; steward-verified 2026-06-01). See [Amendment record](#amendment-record). |
| **Affects** | `spec/v1/auth-profiles.md` (new `openwop-auth-saml` + `openwop-auth-scim` profiles; optional `openwop-auth-ldap`) · `schemas/capabilities.schema.json` (conditional `auth.profiles += ['saml','scim']`) · RFC 0010 (extends the auth-profile-conformance family) · new conformance scenarios |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |
| **Amended by** | [RFC 0159](./0159-scim-saml-subject-linking.md) — adds the cross-profile **subject-linking** obligation (opt-in via `capabilities.auth.subjectLinking`): a host advertising both `openwop-auth-saml` and `openwop-auth-scim` must fail-close the linked SAML identity on SCIM deactivation, keyed on an opaque IdP-stable subject id (never email/PII). Closes the combined-deployment leaver-bypass left open by §`openwop-auth-scim` (deactivation was per-lane only). |

## Summary

Add two entries to openwop's auth-profile family (siblings to `openwop-auth-oauth2-client-credentials` / `openwop-auth-oidc-user-bearer` from RFC 0010): a **SAML assertion-validation profile** (signature validation, `alg:none` rejection mirroring the OIDC work, attribute→principal mapping) and a **SCIM provisioning profile** (`/scim/v2/Users` + `/Groups` sync → RFC 0048 principal / RFC 0049 role upserts). LDAP is included as an **optional** directory-bind variant (lower priority — most enterprise demand is SAML/SCIM). All conditional, like the existing OAuth2/OIDC advertisements.

## Motivation

MyndHyve's enterprise prospects expect **SSO via SAML** and **user provisioning via SCIM**. openwop has OAuth2-CC + OIDC (RFC 0010) but no SAML assertion-validation contract and no SCIM provisioning sync. Without these in the protocol, MyndHyve must build them as bespoke host code with no conformance backing — and, worse, the well-known SAML footguns (unsigned assertions, `alg:none`, XML signature-wrapping) get re-litigated per host instead of being pinned by one certified profile, exactly as RFC 0010 did for OIDC's `alg:none` rejection.

The spec is the right place because SSO/provisioning is an identity-interop concern that must map onto the portable identity triple (RFC 0048) and role model (RFC 0049): a SAML assertion becomes a `principal`, a SCIM group becomes a `role`. Pinning that mapping makes enterprise identity certifiable rather than claimed.

## Proposal

### §A — `openwop-auth-saml` profile (in `auth-profiles.md`)

A host advertising this profile MUST:

1. Validate the SAML assertion's XML signature against the IdP's configured certificate. Unsigned assertions MUST be rejected.
2. Reject `alg:none` / absent-algorithm assertions (mirroring the OIDC `alg:none` rejection RFC 0010 pins), and reject signature-wrapping (the signed element MUST be the asserted element).
3. Enforce assertion validity windows (`NotBefore` / `NotOnOrAfter`); expired assertions MUST be rejected.
4. Map asserted attributes onto an RFC 0048 `principal` (and, where present, group attributes onto RFC 0049 roles) via a documented attribute mapping.

### §B — `openwop-auth-scim` profile (in `auth-profiles.md`)

A host advertising this profile MUST expose SCIM 2.0 `/scim/v2/Users` and `/scim/v2/Groups` endpoints that, on provisioning operations, upsert RFC 0048 principals and RFC 0049 roles:

- `POST/PUT/PATCH /Users` → principal create/update; `DELETE` (or `active: false`) → deactivate (fail-closed: a deactivated principal's subsequent decisions deny per RFC 0049 §C).
- `POST/PUT/PATCH /Groups` → role membership sync (group → RFC 0049 role).

### §C — `openwop-auth-ldap` profile (optional)

An optional directory-bind variant for hosts with on-prem LDAP/AD: bind-and-search authentication mapping a DN onto a `principal` and LDAP groups onto roles. Marked **optional / lower-priority** — included for completeness; SAML/SCIM cover most demand.

### §D — Advertisement (conditional, additive)

```diff
   "auth": {
     "properties": {
       "profiles": { "type": "array", "items": { "type": "string" }, "uniqueItems": true }
     }
   }
```

`profiles` already accepts arbitrary profile strings; this RFC reserves the values `"saml"`, `"scim"`, and `"ldap"` and pins their semantics to §A–§C. Advertisement is conditional on the host implementing the profile (the same pattern as the existing OAuth2/OIDC conditional advertisement).

## Compatibility

**Additive (conditional profiles).** No required-field change; `auth.profiles` already accepts profile strings, so this RFC only pins three reserved values' meaning. Hosts that advertise none of them are unaffected. No existing v1 conformance pass is invalidated.

**Depends on RFC 0048** (principal mapping) **and RFC 0049** (role mapping). **Extends RFC 0010**'s auth-profile-conformance family.

## Conformance

- **`auth-saml-roundtrip.test.ts`** — against a synthetic IdP fixture: one positive (valid signed assertion → principal) + at least 6 negatives: bad signature, `alg:none`, absent signature, expired (`NotOnOrAfter`), not-yet-valid (`NotBefore`), signature-wrapping. Mirrors the OIDC negative suite from RFC 0010. (Gated on `auth.profiles` includes `saml`.)
- **`auth-scim-provisioning.test.ts`** — a SCIM user create + group assignment round-trips to a principal + role; a deactivate denies subsequent decisions (composes with RFC 0049 fail-closed). (Gated on `scim`.)
- **`auth-ldap-bind.test.ts`** — bind-and-search maps a DN + groups onto principal + roles. (Gated on `ldap`; optional.)

New fixture: a synthetic SAML IdP (deterministic signed assertions, including the negative variants) + a SCIM server fixture, catalogued in `fixtures.md`.

## Alternatives considered

1. **Defer SAML/SCIM to host-private code.** Rejected — the SAML attack surface (unsigned/`alg:none`/wrapping) is precisely what a certified profile should pin once; leaving it per-host guarantees inconsistent, re-litigated security. RFC 0010 already established this pattern for OIDC.
2. **Model SAML as just another OIDC-style bearer profile.** Rejected — SAML's assertion/signature model is structurally different (XML-DSig, assertion windows, wrapping attacks); folding it into the OIDC profile would under-specify the validation MUSTs.
3. **Standardize a generic "IdP sync" abstraction instead of named SAML+SCIM.** Rejected — enterprises ask for SAML and SCIM by name and bring conformance expectations from those standards; a bespoke abstraction has no external test corpus to anchor against.

## Unresolved questions

1. **SCIM filtering & pagination.** Full SCIM 2.0 includes `filter`, pagination, and bulk ops. Does the profile require the full surface or a provisioning-sufficient subset? Start with the upsert/deactivate subset; expand if an adopter pulls.
2. **IdP-initiated vs SP-initiated SAML.** Should the profile require both flows or just SP-initiated? Resolve before Active based on MyndHyve's enterprise requirements.
3. **Just-in-time (JIT) provisioning via SAML.** SAML assertions can carry enough to JIT-create a principal without SCIM. Should §A allow JIT, or require SCIM for provisioning? Likely allow JIT as optional; pin before Active.

## Implementation notes (non-normative)

- Profile prose (§A–§C) + the reserved advertisement values (§D) land on `Active` promotion with the conformance scenarios.
- Reference-adopter target: MyndHyve adds SAML/SCIM validators alongside its OIDC path (the reference host's `jwt-validator.ts` is the structural template), mapping provisioned users onto workspace memberships + roles (RFC 0049).

## Acceptance criteria

- [x] Spec text merged (this file).
- [x] `openwop-auth-saml` + `openwop-auth-scim` + optional `openwop-auth-ldap` profiles in `spec/v1/auth-profiles.md`.
- [x] Reserved `openwop-auth-saml`/`-scim`/`-ldap` profile ids pinned in the `capabilities.auth.profiles` schema description.
- [x] SAML (1 positive + ≥6 negatives) conformance via a bundled synthetic-IdP fixture — `conformance/src/lib/saml-idp.ts` mints valid + `alg-none`/`bad-signature`/`unsigned`/`expired`/`not-yet-valid`/`signature-wrapping`; `auth-saml-profile.test.ts` runs the negative reference suite **server-free** (its `verify()` implements the §A MUST list). SCIM scenario landed. Both seams (`auth/saml/validate`, `auth/scim/provision`) registered in `host-sample-test-seams.md`; the host-ACS path is opt-in via `OPENWOP_TEST_SAML_IDP_URL` / `OPENWOP_TEST_SCIM_URL`.
- [x] CHANGELOG entry under `[Unreleased]`.
- [ ] A non-steward host advertises `openwop-auth-saml` and/or `-scim` and passes the negative suite.

**Implementation note (2026-05-25):** Profile prose (`auth-profiles.md`) + reserved `auth.profiles` ids + the two conformance scenarios + the two seams landed on `main`. The **synthetic SAML IdP fixture is now bundled** (`conformance/src/lib/saml-idp.ts`, `node:crypto` RSA-SHA256, no deps) so the 1-positive + 6-negative reference suite runs server-free — this closes the "no synthetic IdP" gap MyndHyve flagged for RFC 0050 graduation. A non-MyndHyve enterprise-SSO host wiring its SAML ACS to the seam (or MyndHyve itself) is the remaining `Active → Accepted` gate. Maps onto RFC 0048 `principal` + RFC 0049 roles; extends RFC 0010. Status stays `Draft`.

## Amendment record

Change history relocated from the `Updated` metadata cell (newest first).

- MyndHyve advertises `auth.profiles: ["openwop-auth-saml","openwop-auth-scim"]` at the discovery doc root, self-hosts the bundled `createSyntheticSamlIdp()` behind the `GET {idpUrl}?variant=<v>` → `{certificatePem, assertion}` contract (assertions steward-defined, host serves transport only; SUT = its separate `samlAcs.ts`), and passes the gated `auth-saml-profile` + `auth-scim-profile` legs **non-vacuously** under `OPENWOP_REQUIRE_BEHAVIOR=true` vs `@openwop/openwop-conformance@1.18.1` (**19/19, no soft-skips** — the count rose 13→19 once the IdP URL engaged the behavioral legs).
- The steward then **drove the live `auth/saml/validate` seam directly for all 7 §A variants**: `valid` → `200 {authenticated:true}`; `alg-none`/`unsigned`/`bad-signature`/`expired`/`not-yet-valid`/**`signature-wrapping`** → `401 {reason}` each (the XSW defense — `<ds:Reference URI>` ≠ consumed assertion — fires live), plus the SCIM seam (`create-user` → resolvable principal; `deactivate-user` → `resolvable:false`, fail-closed).
- The steward prerequisite was conformance 1.18.1 (#467 `8886c713`), which expanded the gated SAML behavioral leg from a single `alg-none` negative to the full 7-variant set over the seam. No regression: `openwop-core-standard` + `openwop-agent-platform` still hold on the same host.
- 2026-06-01 (`Draft → Active` — the full wire surface already landed on `main` (the `auth-profiles.md` SAML/SCIM/LDAP profile prose; the reserved `openwop-auth-{saml,scim,ldap}` profile ids in `capabilities.schema.json`; the two conformance scenarios `auth-saml-profile.test.ts` + `auth-scim-profile.test.ts`; the two host-sample seams `POST /v1/host/sample/auth/saml/validate` + `.../scim/provision`); this promotion reflects that completion.
- Comment window waived per `GOVERNANCE.md` single-maintainer lazy consensus. **The load-bearing SAML attack-surface guarantee is proven server-free + non-vacuously today:** the bundled synthetic SAML IdP (`conformance/src/lib/saml-idp.ts`, `node:crypto` RSA-SHA256, no deps) runs the 1-positive + 6-negative reference suite — accepts a valid signed, in-window, non-wrapped assertion, and rejects `alg:none`, unsigned, bad-signature, expired (`NotOnOrAfter`), not-yet-valid (`NotBefore`), and **signature-wrapping** (8/8 passing on `main`), pinning the footguns RFC 0010 established the pattern for.
- Maps onto RFC 0048 `principal` + RFC 0049 roles; extends RFC 0010. `Active → Accepted` is gated on a host wiring its SAML ACS / SCIM endpoint to the seams (the synthetic-IdP suite proves the validation contract; a live enterprise-SSO host — MyndHyve flagged SAML/SCIM as an enterprise need — closes the cross-host adoption gate).
- The advertisement-shape + live-ACS/SCIM scenario legs gate on `auth.profiles` including `openwop-auth-{saml,scim}` + the operator-supplied IdP/SCIM env and soft-skip until a host advertises them.) — 2026-05-24.

## References

- [`RFCS/0010-auth-profile-conformance.md`](./0010-auth-profile-conformance.md) — the auth-profile-conformance family this extends; the OIDC `alg:none` rejection mirrored in §A.
- [`spec/v1/auth-profiles.md`](../spec/v1/auth-profiles.md) — `openwop-auth-oidc-user-bearer` (the structural sibling).
- [`RFCS/0048-tenant-workspace-principal-identity-model.md`](./0048-tenant-workspace-principal-identity-model.md) — principal mapping target.
- [`RFCS/0049-rbac-scopes-and-authorization-decisions.md`](./0049-rbac-scopes-and-authorization-decisions.md) — role mapping target.
- SAML 2.0 (OASIS), SCIM 2.0 (RFC 7643/7644), XML-DSig signature-wrapping prior art.
