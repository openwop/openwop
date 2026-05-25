# RFC 0050: SAML / SCIM (and optional LDAP) enterprise identity profiles

| Field | Value |
|---|---|
| **RFC** | 0050 |
| **Title** | Two new entries in the auth-profile family — a SAML assertion-validation profile and a SCIM provisioning profile (LDAP as an optional directory-bind variant) — that sync external IdP users/groups onto RFC 0048 principals + RFC 0049 roles, with `alg:none` rejection mirroring the OIDC work |
| **Status** | `Draft` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-24 |
| **Updated** | 2026-05-24 |
| **Affects** | `spec/v1/auth-profiles.md` (new `openwop-auth-saml` + `openwop-auth-scim` profiles; optional `openwop-auth-ldap`) · `schemas/capabilities.schema.json` (conditional `auth.profiles += ['saml','scim']`) · RFC 0010 (extends the auth-profile-conformance family) · new conformance scenarios |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

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
- [~] Conformance — `auth-saml-profile.test.ts` + `auth-scim-profile.test.ts` landed (profile-advertisement shape always; behavioral assertion-validation / provisioning opt-in via `OPENWOP_TEST_SAML_IDP_URL` / `OPENWOP_TEST_SCIM_URL` + the `auth/saml/validate` + `auth/scim/provision` seams, registered in `host-sample-test-seams.md` §"Open seams"). The full SAML 1-positive-+-6-negatives suite + a bundled synthetic-IdP XML-DSig harness are deferred (mirrors the `auth-mtls` / OIDC opt-in precedent — no synthetic IdP is bundled yet).
- [x] CHANGELOG entry under `[Unreleased]`.
- [ ] A non-steward host advertises `openwop-auth-saml` and/or `-scim` and passes the negative suite.

**Implementation note (2026-05-25):** Profile prose (`auth-profiles.md`) + the reserved `auth.profiles` ids + the two opt-in conformance scenarios + the two seams landed on `main`. Maps onto the RFC 0048 `principal` + RFC 0049 roles already on `main`; extends the RFC 0010 auth-profile family. Status stays `Draft`. The behavioral SAML negative suite is gated on a synthetic-IdP harness that is not yet bundled (the same gap RFC 0010's OIDC profile noted) — opt-in via env until it ships.

## References

- [`RFCS/0010-auth-profile-conformance.md`](./0010-auth-profile-conformance.md) — the auth-profile-conformance family this extends; the OIDC `alg:none` rejection mirrored in §A.
- [`spec/v1/auth-profiles.md`](../spec/v1/auth-profiles.md) — `openwop-auth-oidc-user-bearer` (the structural sibling).
- [`RFCS/0048-tenant-workspace-principal-identity-model.md`](./0048-tenant-workspace-principal-identity-model.md) — principal mapping target.
- [`RFCS/0049-rbac-scopes-and-authorization-decisions.md`](./0049-rbac-scopes-and-authorization-decisions.md) — role mapping target.
- SAML 2.0 (OASIS), SCIM 2.0 (RFC 7643/7644), XML-DSig signature-wrapping prior art.
