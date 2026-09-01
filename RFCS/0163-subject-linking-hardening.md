# RFC 0163: SCIM ⟷ SAML subject-linking hardening

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0163                                                            |
| **Title**         | Subject-linking hardening — a **declarable, witnessable** link-key class (`capabilities.auth.subjectLinkKey`, a closed enum of allowed classes only) plus a **same-IdP trust-root MUST** before a SAML⟷SCIM link may form. The additive follow-on to RFC 0159 that converts its §A.2/§A.4 negative-existence claims-check into a positive advertisement and closes its cross-IdP collision gap. |
| **Status**        | `Draft`                                                         |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-01                                                      |
| **Updated**       | 2026-09-01                                                      |
| **Affects**       | `spec/v1/auth-profiles.md` (§"Subject linking (SAML ⟷ SCIM)" gains the key-class declaration + the same-IdP MUST) · `schemas/capabilities.schema.json` (new optional `auth.subjectLinkKey` **closed enum**) · RFC 0159 (gains an **Amended by** forward pointer) · `SECURITY/threat-model-auth-profiles.md` §4.5 (the cross-IdP mitigation gains a normative MUST; the §A.2 negative-existence residual is strengthened by the declarable key class) · new conformance scenario `auth-subject-link-key-class.test.ts` (advertisement leg executable; the UQ4 two-trust-root behavioral leg declared + phased) |
| **Compatibility** | `additive` per `COMPATIBILITY.md` (a new **optional** discovery field + two MUSTs that bind only hosts already advertising `subjectLinking:true` — no host conforming to RFC 0159 or RFC 0050 today de-conforms) |
| **Supersedes**    | —                                                              |
| **Superseded by** | —                                                              |

## Summary

RFC 0159 made a SCIM-deactivated leaver fail-close on the linked SAML lane, keyed on an **opaque IdP-stable** id — but two of its safety obligations survive only as **negative-existence claims-checks** (§A.2 "MUST NOT key on a mutable/PII attribute", §A.4 "MUST NOT silently fall back") that a suite cannot fully witness (it can prove the correct deny on the pairs it probes, never that a host *never* joins on email for some pair it did not), and it left the SAML/SCIM lanes' trust-root relationship as an open question (UQ4: nothing forbids linking two principals that merely collide on an identifier across two different IdPs). This RFC hardens both, additively, gated on the same opt-in `subjectLinking:true` flag: (1) a new **optional** `capabilities.auth.subjectLinkKey` — a **closed enum of allowed key classes only** (`"opaque-idp"`, `"oid"`, `"immutable-id"`) — that a `subjectLinking:true` host MUST advertise and MUST honour, with `"email"`/`"userName"`/any mutable key made **inexpressible in the enum** (the enum's closedness *is* the witness: a conforming host can only name a safe class); and (2) a normative **same-IdP trust-root MUST** — the SAML assertion issuer MUST match the SCIM provisioning IdP before a link may form. Both bind only hosts that already opt into `subjectLinking`; nothing de-conforms.

## Motivation

RFC 0159 is the standard combined SAML-SSO + SCIM-provisioning leaver contract, and it is `Accepted` with a reference-host implementation. Its own Falsifiability table (RFC 0159 §Conformance) and gap/risk registers name two residuals it deliberately deferred to follow-ups (UQ2, UQ3, UQ4; R4, R5):

1. **The mutable-key prohibition is only half-witnessable (UQ2 / R4).** RFC 0159 §A.2 says the link key MUST NOT be email/`userName`/any mutable-or-PII attribute, and §A.4 says a host MUST NOT silently fall back to one. The conformance suite (`auth-subject-link.test.ts`, RFC 0159) can witness the *positive consequence* — that a mutable-key "link" the suite constructs yields no cross-lane pass — but it **cannot prove a host never joins on a mutable key for some pair it did not probe.** This is a negative-existence property: "no unsafe join happened anywhere." RFC 0159's own note (§Conformance, and `SECURITY/threat-model-auth-profiles.md` §6 residual bullet) records the gap and proposes the fix used here: have discovery **declare the key class**, so the suite asserts the *claimed* class against a closed set of safe classes and gates on it — converting a claims-check into a witnessable advertisement.

2. **The acceptable key-class set is unpinned (UQ3).** RFC 0159 §A.1 admits "the SCIM `externalId` matched to the SAML persistent-format `NameID`, **or a host-configured stable linking attribute asserted by the same IdP**" — an open set under an opaque+stable+non-PII constraint. Leaving it open eases adoption but means the conformance suite cannot name what a conforming host is allowed to say; enumerating the acceptable classes closes that.

3. **Nothing forbids a cross-IdP identifier collision (UQ4 / R5).** RFC 0159 §A.1 presumes both lanes are fed by the same IdP so the opaque id is comparable, but states no MUST to that effect. If SAML is fed by IdP-A and SCIM by IdP-B and the two happen to mint the same `externalId`/`NameID` string for two *different* humans, the host would join two different principals — a cross-IdP identifier collision. `SECURITY/threat-model-auth-profiles.md` §4.5 already lists this ("Spoofing (cross-tenant / -IdP)") but its mitigation cell defers the same-IdP scoping to "RFC 0159 UQ4". This RFC supplies the MUST.

The spec is the right place for the same reason RFC 0159 was: left to per-host code, each vendor re-litigates *which* key classes count and *whether* the two lanes must share a trust root, and some will reach for a wider set or skip the trust-root check — the exact footgun-per-host outcome RFC 0050/0159 exist to prevent. UQ2/UQ3/UQ4 are recorded in RFC 0159's registers as Security/Conformance/Spec-owned decisions "needed before a strengthening"; this is that strengthening.

**Explicitly out of scope: UQ1** (making cross-lane deactivation *mandatory* for any host advertising both profiles, retiring the opt-in flag). That is a `breaking` v2 change — it de-conforms every current combined host in one step — and is a separate later safety-fix. This RFC is deliberately additive-only. See §Unresolved questions 1.

## Proposal

All obligations below apply **only** to a host that advertises `openwop-auth-saml` **and** `openwop-auth-scim` **and** sets `capabilities.auth.subjectLinking: true` (the RFC 0159 opt-in). A host that does not opt into subject linking is entirely unaffected.

### §A — Declarable, witnessable link-key class (`capabilities.auth.subjectLinkKey`)

- **§A.1 — A `subjectLinking:true` host MUST declare its link-key class.** A host that advertises `capabilities.auth.subjectLinking: true` MUST also advertise `capabilities.auth.subjectLinkKey`, whose value MUST be one of the closed enum:
  - `"opaque-idp"` — the SCIM resource `externalId` matched to the SAML **persistent-format** `NameID` (the RFC 0159 §A.1 default pairing).
  - `"oid"` — an IdP-asserted **immutable object identifier** claim (e.g. the directory `oid`), matched across the two lanes.
  - `"immutable-id"` — a host-configured **immutable-id** attribute asserted by the same IdP (the RFC 0159 §A.1 "host-configured stable linking attribute" case, constrained to an immutable, non-reassignable identifier).

  All three name an **opaque, IdP-asserted, stable, non-PII** identifier, satisfying the RFC 0159 §A.1/§A.2 key constraint. `subjectLinkKey` is **optional at the schema level** (so the field is purely additive), but a host setting `subjectLinking:true` and omitting it, or setting it to any value outside the enum, is **non-conforming** — the "MUST also advertise" obligation is the normative bridge.

- **§A.2 — A host MUST NOT advertise a `subjectLinkKey` it does not honour.** The declared class MUST be the class the host actually joins on. This is the RFC 0011 / RFC 0048 §D authorization-oracle discipline (advertise only what you honour) applied to the key class: a host advertising `"opaque-idp"` MUST form links on `externalId`↔persistent-`NameID` and MUST NOT form them on any other attribute.

- **§A.3 — The enum is closed; unsafe key classes are inexpressible.** The set is **allowed classes only**. `"email"`, `"userName"`, `"displayName"`, and every mutable-or-PII attribute are **absent from the enum by construction** — a conforming discovery document cannot name one. This is the witness: RFC 0159 §A.2/§A.4 said a host MUST NOT *use* a mutable key (a property a suite cannot exhaustively falsify); §A.3 here says a host cannot *say* it uses one and stay schema-valid, and MUST honour what it says (§A.2), so the suite asserts the *positive* fact "the declared class is a member of the safe set" instead of the negative fact "no unsafe join ever happened." A host that keys links on email is now non-conforming in a **witnessable** way: it either declares a class it does not honour (violates §A.2, and its behavioral leg fails) or declares nothing / an out-of-enum value (violates §A.1, and its discovery shape fails). The negative-existence residual is not fully eliminated — a host could still lie (declare `"opaque-idp"` while secretly joining on email) — but the lie is now a §A.2 violation the behavioral leg can catch on any probed pair, not an unstated fallback, and the residual shrinks to "a host that both lies in discovery *and* is never probed on the lying pair." (See §Conformance Falsifiability note.)

### §B — Same-IdP trust-root MUST (closes UQ4 / R5)

- **§B.1 — The SAML and SCIM lanes MUST share an IdP trust root before a link may form.** The host MUST NOT form a subject link between a SAML-asserted principal and a SCIM-provisioned principal unless both lanes are fed by the **same IdP trust root**: the issuer of the SAML assertion (the assertion's `Issuer` / the trusted IdP entityID for the SAML connection) MUST correspond to the same IdP that provisioned the SCIM resource (the SCIM connection's configured IdP). An opaque identifier that collides across two *different* IdPs MUST NOT join two principals. Equivalently: the link key's comparability is scoped to one trust root; a match on the key across two trust roots is **not** a link.

- **§B.2 — Absent a shared trust root, fail closed (compose with RFC 0159 §A.4).** If the host cannot establish that the two lanes share an IdP trust root for a candidate pair, it MUST NOT form the link, exactly as RFC 0159 §A.4 requires when no opaque key is available: treat the two identities as independent subjects, and MUST NOT claim the combined leaver guarantee for that pair on the strength of a cross-IdP identifier match.

Non-normative: §B tightens RFC 0159 §A.1's *presumption* ("presumes both lanes are fed by the same IdP") into a MUST. It composes with the existing same-**tenant** MUST (RFC 0159 §A.1): a link now requires both same-tenant **and** same-IdP-trust-root. It does not change the link mechanism (still link-not-merge; no `userIdFor` rewrite; RFC 0048 §D owner-echo + `:fork` replay stay deterministic).

### §C — Discovery shape (`schemas/capabilities.schema.json`)

Add an **optional** `subjectLinkKey` under `auth.properties`, a **closed enum** (`auth` remains `additionalProperties: true`, so the addition is purely additive — an explicit property, not a shape tightening):

```diff
       "subjectLinking": {
         "type": "boolean",
         "description": "RFC 0159 … (unchanged)"
       },
+      "subjectLinkKey": {
+        "type": "string",
+        "enum": ["opaque-idp", "oid", "immutable-id"],
+        "description": "RFC 0163 (auth-profiles.md §Subject linking). The CLASS of opaque, IdP-stable, non-PII identifier this host joins the SAML and SCIM lanes on. A CLOSED enum of ALLOWED classes only: `opaque-idp` (SCIM externalId ↔ persistent-format SAML NameID), `oid` (an IdP-asserted immutable object identifier), `immutable-id` (a configured immutable-id attribute asserted by the same IdP). Mutable/PII keys (email, userName, displayName) are INEXPRESSIBLE by construction — a conforming host cannot name one. REQUIRED (its own MUST, not a schema `required` row) when subjectLinking is true: a host setting subjectLinking:true MUST advertise a subjectLinkKey in this enum and MUST honour it (advertise only what you honour). Optional at the schema level so the field is additive; absent-with-subjectLinking:true is a conformance violation, not a schema-validation error."
+      },
```

- Optional at the schema level, default absent. Existing clients ignore it; existing hosts (including RFC 0159 hosts that predate this RFC) do not emit it. The **conformance** obligation (advertise-when-`subjectLinking`) rides §A.1, not a JSON-Schema `required` array — mirroring how RFC 0159 kept `subjectLinking`'s cross-profile obligation in prose rather than in schema `required`.
- `auth`'s `additionalProperties: true` is **preserved** (same rail `subjectLinking` rode).

### Examples

**Positive (conforming).** Host discovery:

```json
{ "auth": { "profiles": ["openwop-auth-saml", "openwop-auth-scim"], "subjectLinking": true, "subjectLinkKey": "opaque-idp" } }
```

A SCIM `POST /Users` provisions `{ "externalId": "idp-op-8f3a", "userName": "r.smith" }` from IdP-A; a SAML assertion **issued by IdP-A** with persistent `NameID` = `idp-op-8f3a` links on the `opaque-idp` class (§A.1) because the two lanes share IdP-A's trust root (§B.1). The declared `opaque-idp` is the class the host joins on (§A.2).

**Negative 1 — mutable key inexpressible (§A.3).** `{ "auth": { "profiles": ["openwop-auth-saml", "openwop-auth-scim"], "subjectLinking": true, "subjectLinkKey": "email" } }` **fails schema validation** — `"email"` is not in the enum. A host that joins on email cannot produce a conforming discovery document that says so.

**Negative 2 — missing declaration (§A.1).** `{ "auth": { "profiles": ["openwop-auth-saml", "openwop-auth-scim"], "subjectLinking": true } }` is **non-conforming**: `subjectLinking:true` without a `subjectLinkKey` violates the §A.1 "MUST also advertise" obligation (schema-valid, conformance-invalid — the advertisement scenario de-conforms it).

**Negative 3 — cross-IdP collision (§B.1).** SAML asserted by IdP-A with `NameID = idp-op-8f3a`; SCIM provisioned by IdP-B which independently minted `externalId = idp-op-8f3a` for a **different** human. The string matches, but the two lanes do **not** share an IdP trust root, so the host MUST NOT form the link (§B.1) and MUST NOT propagate a cross-lane deny/pass between the two unrelated principals (§B.2).

## Compatibility

**Classification: `additive`.** Per `COMPATIBILITY.md` §2.2: no required→optional or type change; `subjectLinkKey` is a new **optional** property (the `auth` object stays `additionalProperties: true`); no event-shape change; the SCIM/SAML endpoint contracts are unchanged; no existing `MUST` is relaxed (both new MUSTs *add* obligations); error-code meanings are unchanged (§B fail-closed reuses RFC 0159 §A.4 / RFC 0049 §C semantics and the existing `forbidden`/`unauthenticated` envelope). A host that conforms to RFC 0159 today does not emit `subjectLinkKey` and — because both §A and §B bind only `subjectLinking:true` hosts — a host that never opted in incurs no new obligation.

Backward-compatibility clauses:

- `auth.subjectLinkKey` is optional with default-absent; existing clients ignore it; existing hosts don't emit it.
- The §A and §B MUSTs are gated on `subjectLinking:true`. A host that never sets `subjectLinking` (SAML-only, SCIM-only, or neither) incurs no new obligation.
- A pre-existing RFC 0159 `subjectLinking:true` host that predates this RFC and has not yet added `subjectLinkKey` is not silently broken at the *schema* layer (the field is optional); it becomes non-conforming only against the **new suite version** that ships the §A.1 advertisement scenario — a suite-version requirement, not a spec-relaxation. This is the `COMPATIBILITY.md` §2.3 "suite stricter than a bare schema read" case, and it is the intended tightening: adopting RFC 0159 now carries a one-line discovery addition.

**Why not safety-fix?** As with RFC 0159, the *motivation* is a security gap (an unwitnessable prohibition + a cross-IdP collision), but the *mechanism* is opt-in and additive — nothing de-conforms without opting in, no migration/embargo is required. The stronger mandatory posture (UQ1) remains the deferred `breaking` follow-up.

## Conformance

**Existing coverage.** `conformance/src/scenarios/auth-subject-link.test.ts` (RFC 0159) covers the advertisement gate (`subjectLinking:true` ⟹ both profiles) plus the opt-in behavioral legs (cross-lane leaver deny; mutable-key link yields no pass). It does **not** assert the key-class declaration or the same-IdP trust root.

**New scenario — `auth-subject-link-key-class.test.ts`** (gated on `capabilities.auth.subjectLinking === true`; soft-skips otherwise, per `coverage.md` §"Capability-gated scenarios"):

- **Advertisement leg (§A — lands now, executable, server-free).** A pure discovery-shape check: when `subjectLinking:true`, assert `subjectLinkKey` is present **and** is a member of the closed enum `{opaque-idp, oid, immutable-id}`; assert that an absent `subjectLinkKey` (with `subjectLinking:true`) or a value outside the enum de-conforms. No host boot; reads `/.well-known/openwop`. This is the leg that converts RFC 0159's §A.2/§A.4 negative-existence residual into a positive advertisement assertion.
- **UQ4 behavioral leg (§B — declared + phased, follow-on fixture).** SAML from IdP-A + a SCIM `externalId` provisioned from IdP-B colliding on one id ⟹ the host MUST refuse to link (no cross-lane deny/pass propagates between the two unrelated principals). This needs a **two-trust-root fixture** (two synthetic IdPs, distinct entityIDs, colliding identifier). The scenario **declares** this leg and marks the fixture as **follow-on** — soft-skipping (`blocked`) until the two-trust-root fixture is engineered — so the RFC does not stall on fixture work. This mirrors how RFC 0159 phased its own cross-lane behavioral legs behind opt-in seams (`OPENWOP_TEST_SAML_IDP_URL`/`OPENWOP_TEST_SCIM_URL`).

**Fixtures.** The advertisement leg needs none (discovery read). The §B behavioral leg needs a new two-IdP fixture (`conformance/src/lib/saml-idp.ts` today mints one IdP; a second distinct-entityID instance + a SCIM payload provisioned "from" the second IdP is the follow-on). A `subject-link-key-class` / `two-trust-root` row is added to `conformance/fixtures.md` when that standing fixture is bundled — declared here as a gap (G-fixture).

**Capability gate:** `host.auth.subjectLinking` (the RFC 0159 discovery flag; this RFC adds the `subjectLinkKey` sub-shape under the same gate). **INTEROP-MATRIX:** host-per-row with advertised auth metadata inline per host cell (no structural column added); `subjectLinkKey` is noted in a host's cell when it first advertises it. No current reference host advertises `subjectLinking`, so none advertises `subjectLinkKey`.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.1 (`subjectLinking:true` ⟹ `subjectLinkKey ∈ enum`) | discovery with `subjectLinking:true` and an absent/out-of-enum `subjectLinkKey` de-conforms; a member value conforms | the suite, unaided (discovery read) | **witnessable, unaided** |
| §A.2 (advertise only the class you honour) | a host advertising `"opaque-idp"` forms links on `externalId`↔persistent-`NameID` and on no other attribute — probed via the RFC 0159 cross-lane seam | the suite, via the SCIM+SAML seams (capability-gated) | witnessable on probed pairs (residual: an unprobed lying pair — see note) |
| §A.3 (enum closed; unsafe classes inexpressible) | no conforming discovery document names `"email"`/`"userName"`/any mutable key | the suite, unaided (schema validation of discovery) | **witnessable, unaided** |
| §B.1 (same-IdP trust root before a link) | a SAML(IdP-A)+SCIM(IdP-B) identifier collision yields **no** cross-lane link (no deny/pass propagates between the two principals) | the suite, via a two-trust-root fixture (**follow-on** — phased) | witnessable — seam/fixture-gated (**phased**) |
| §B.2 (fail closed absent a shared trust root) | for a cross-IdP candidate pair, the host treats the two as independent subjects — never a silent cross-IdP join | the suite, by presenting a cross-IdP pair (follow-on fixture) | seam-gated (**phased**) |

**Note (per the template's two failure modes).** §A converts the RFC 0159 §A.2/§A.4 **negative-existence** residual into a **positive advertisement** the suite witnesses unaided (§A.1/§A.3), plus a behavioral honesty check on probed pairs (§A.2). The residual shrinks but is not zero: a host could declare a safe class in discovery yet secretly join on a mutable key for a pair the suite never probes. That surviving sliver — "lies in discovery **and** is never probed on the lying pair" — is strictly smaller than RFC 0159's residual ("uses a mutable key for any unprobed pair"), because the lie is now a §A.2 violation catchable on *any* probed pair rather than an unstated, unadvertised fallback. §B.1/§B.2 are **witnessable but fixture-gated**: the observable (no cross-IdP join) is clear and causable, but only once a two-trust-root fixture exists — hence the phased-fixture note and gap G-fixture, mirroring RFC 0159's phased behavioral legs.

## Alternatives considered

1. **Do nothing (leave RFC 0159 UQ2/UQ3/UQ4 open).** The mutable-key prohibition stays a negative-existence claims-check the suite can't fully witness, the acceptable key-class set stays unpinned, and a cross-IdP identifier collision can still join two principals. Rejected — RFC 0159's own registers name these as the strengthening path, and a spec that can't witness its own safety MUST invites "conforming" hosts that aren't.
2. **Make `subjectLinkKey` an OPEN string (advertise whatever you key on, including `"email"`).** Rejected — an open string lets a host advertise `"email"` *honestly*, which does not make an unsafe key safe; the point is that a mutable key must be **inexpressible**, so a conforming discovery document cannot name one. The closed enum is the witness; an open string discards it.
3. **Add `"email"`/mutable classes to the enum as explicitly-rejected values (a deny-list).** Rejected — enumerating forbidden values in a discovery field invites a host to advertise one, and a schema `enum` is an allow-list by nature. The safe design is allowed-classes-only; the forbidden ones live in the threat model, not the wire vocabulary.
4. **Make the same-IdP scoping a SHOULD, not a MUST (§B).** Rejected — a cross-IdP identifier collision joins two *different humans'* principals, which is an authorization-boundary violation (R5), not a quality-of-implementation nicety. RFC 0159 §A.1 already scopes the link to a single tenant as a MUST for the analogous cross-tenant collision; same-IdP is the same class of boundary and takes the same keyword.
5. **Fold this into RFC 0159 by amending it in place.** Rejected — RFC 0159 is `Accepted` with a merged reference-host implementation; the reasoning trail (and the register rows UQ2–UQ4/R4–R5 that motivate this) is better served by an additive follow-on that RFC 0159 forward-points to, exactly as RFC 0159 amended RFC 0050 rather than rewriting it.

## Unresolved questions

1. **Mandatory follow-up (UQ1, inherited).** Should a later (`breaking`, v2) RFC make cross-lane deactivation **mandatory** for any host advertising both `openwop-auth-saml` and `openwop-auth-scim` (retiring the opt-in `subjectLinking` flag)? This RFC, like RFC 0159, deliberately stays additive/opt-in. Out of scope here; recorded so the sequencing is explicit.
2. **Enum extensibility.** Are `{opaque-idp, oid, immutable-id}` the complete set of safe classes, or will a fourth (e.g. a directory-specific immutable GUID distinct from `oid`) be wanted? Because the field is an allow-list, adding a member later is itself `additive` (a new optional enum value existing validators reject only if a host emits it before they upgrade — the standard forward-compat cost of any enum growth). No blocker; flagged for the comment window.
3. **§B trust-root identity representation.** §B.1 says the SAML issuer MUST "correspond to" the SCIM provisioning IdP. Should the spec pin *how* correspondence is established (SAML `Issuer` entityID ↔ a SCIM-connection IdP entityID the host records) as normative, or leave the representation to host config under the "same trust root" constraint? Leaning: leave the representation to the host, keep the "must correspond" as the MUST — but this is the one §B detail a reviewer may want tightened.
4. **Two-trust-root fixture ownership.** The §B behavioral leg needs a second synthetic IdP in `conformance/src/lib/saml-idp.ts`. Who engineers it and in which suite version — bundled with this RFC's suite bump, or a follow-on conformance PR? This RFC phases it (declares the leg, ships the fixture as follow-on) so the advertisement leg is not blocked.

## Implementation notes (non-normative)

- **Reference host (openwop-app).** RFC 0159's reference implementation (openwop-app #3581, ADR 0613) already keys the link on the opaque `externalId` and consults a per-tenant link-scoped deny. This RFC adds two host tasks, both small: (a) emit `capabilities.auth.subjectLinkKey: "opaque-idp"` in discovery (the reference host's class is exactly `opaque-idp`); (b) add a same-IdP trust-root check to the link-formation path — compare the SAML assertion issuer to the SCIM connection's IdP before writing the link. Neither touches `userIdFor` (no durable key rewrite); RFC 0048 §D owner-echo + `:fork` replay stay deterministic. Host work lands after this RFC reaches `Active` (wire shape pinned first).
- **Sequencing.** Spec prose (`auth-profiles.md` §Subject linking additions) + the `capabilities.schema.json` enum + the RFC 0159 `Amended by` pointer + the `SECURITY/threat-model-auth-profiles.md` §4.5 MUST land on `Active`; the **advertisement** conformance leg lands with it (server-free, executable); the **§B two-trust-root behavioral** leg + its fixture + the reference-host same-IdP check gate `Active → Accepted`.
- **Cross-cut.** Auth-profile-family surface (RFC 0010/0050/0159 lineage); additive, so it can merge independently of the workflow-protocol plan — no `CC-N` coordination entry required.

## Acceptance criteria

- [ ] Spec text merged — `spec/v1/auth-profiles.md` §"Subject linking (SAML ⟷ SCIM)" gains the §A key-class declaration + the §B same-IdP MUST.
- [ ] `schemas/capabilities.schema.json` gains the optional `auth.subjectLinkKey` closed enum (`additionalProperties: true` preserved); `redocly lint api/openapi.yaml` stays clean.
- [ ] RFC 0159 gains an `**Amended by**` row pointing to RFC 0163 with a one-line summary.
- [ ] `SECURITY/threat-model-auth-profiles.md` §4.5 — the cross-IdP mitigation cell gains the §B.1 normative MUST; the §6 residual bullet notes the §A declarable key class strengthens the §A.2 negative-existence residual.
- [ ] At least one conformance scenario (`auth-subject-link-key-class.test.ts`) covering the §A advertisement leg (executable), with the §B behavioral leg declared + phased (follow-on fixture), capability-gated on `auth.subjectLinking`.
- [ ] CHANGELOG entry under the suite version.
- [ ] Reference host (openwop-app) advertises `subjectLinkKey` and enforces the §B same-IdP check — deferred to reference-host implementation after `Active` (this RFC explicitly defers the host leg, per RFC 0159's precedent).

## References

- RFC 0159 — SCIM ⟷ SAML subject linking (the amended base; UQ2/UQ3/UQ4 + registers R4/R5 are the motivation).
- RFC 0050 — SAML / SCIM (and optional LDAP) enterprise identity profiles.
- RFC 0048 — Identity triple / principals; §D owner-echo determinism (why link-not-merge is preserved).
- RFC 0049 — Roles and authorization decisions; §C fail-closed (the deny §B composes with).
- RFC 0011 / RFC 0010 — auth-scoped discovery + auth-profile-conformance (advertise-only-what-you-honour).
- `spec/v1/auth-profiles.md` §"Subject linking (SAML ⟷ SCIM)".
- `SECURITY/threat-model-auth-profiles.md` §4.5 (join-and-inherit / leaver / cross-tenant-or-IdP) + §6 (unprobed-pair residual).
- Prior art: SCIM 2.0 (RFC 7644) `externalId`; SAML 2.0 persistent `NameID` format + assertion `Issuer` (OASIS); OIDC `oid`/immutable-id directory claims.
