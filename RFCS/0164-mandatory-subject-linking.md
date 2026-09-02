# RFC 0164: Mandatory SCIM ⟷ SAML subject linking for combined hosts

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0164                                                            |
| **Title**         | The SCIM ⟷ SAML leaver contract (RFC 0159 §A, hardened by RFC 0163) becomes **mandatory** for any host that advertises **both** `openwop-auth-saml` and `openwop-auth-scim`. `capabilities.auth.subjectLinking` stops being an opt-in gate and becomes a **derived** advertisement that MUST be `true` whenever both profiles are advertised; it is deprecated toward v2. |
| **Status**        | `Accepted`                                                      |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-02                                                      |
| **Updated**       | 2026-09-02 (`Active → Accepted` — **tier-1 evidence** per `GOVERNANCE.md` §"Acceptance evidence tiers": the reference host openwop-app implements the host leg in openwop-app #3620 (`873efc466`, ADR 0623) — advertises both profiles only when its SAML/SCIM realms are aligned AND a SCIM trust-root seat is configured, otherwise narrows to a single profile; both advertised ⇒ `subjectLinking: true` + `subjectLinkKey: "opaque-idp"` from one gate; an unbound record in a combined deployment fails closed on the SAML lane. Witness: `auth-subject-link-alignment.test.ts` (5 legs: misaligned realms + seat ⇒ `openwop-auth-scim` dropped; aligned + no seat ⇒ dropped; aligned + seat ⇒ both profiles + `subjectLinking: true` + `subjectLinkKey`; aligned + seat + unbound ⇒ SAML `401 subject_link_unbound`; single-profile + unbound ⇒ RFC 0159 deny-only survives) plus `saml_assertion_unbound_refused` in `auth-subject-link.test.ts`; two sabotage reverts confirmed load-bearing (revert the SCIM drop ⇒ alignment leg reds 1/4; revert the unbound refusal ⇒ fail-closed leg reds 1/14); `tsc --noEmit` clean, auth suites 25/25, `npm run ci` green (5034 tests, 0 failed); the witness was re-verified by the adopting session after the implementing agent stalled, not inherited. Single-witness under the bootstrap waiver, as RFC 0159/0163; no tier-2/3 host advertises both profiles. G1 sweep repeated at `Accepted`: still no combined host.) · 2026-09-02 (`Draft → Active`, same day as filing — comment window waived under the `GOVERNANCE.md` single-maintainer lazy-consensus bootstrap rule, exactly as RFC 0159 and RFC 0163 were; recorded in `MAINTAINERS.md` §Bootstrap-phase RFC waivers. The RFC 0147 §A.6 no-waiver clause for identity RFCs is noted, not hidden: this RFC is in the same class as its two predecessors, and the same rule was applied. Wire shape locked at `Active`: the obligation follows the profile pair; `subjectLinking` is derived; the schema carries a second conditional under `auth`.) |
| **Affects**       | `spec/v1/auth-profiles.md` (§"Subject linking (SAML ⟷ SCIM)" — gating sentence, §A.4 escape, discovery shape; new §"Mandatory when both profiles are advertised") · `schemas/capabilities.schema.json` (`auth` gains a second conditional: `profiles ⊇ {saml, scim}` ⇒ `subjectLinking` const `true` + `subjectLinkKey` required; `subjectLinking` description marked derived/deprecated) · `conformance/src/scenarios/auth-subject-link.test.ts` + `auth-subject-link-key-class.test.ts` (re-gated on the profile pair; new vulnerable-shape leg) · `conformance/src/lib/capabilities-auth-subject-link.test.ts` · `SECURITY/invariants.yaml` (three `subject-link-*` rows re-targeted; new `subject-link-mandatory-when-both-advertised`) · `SECURITY/threat-model-auth-profiles.md` §4.5 · `spec/v1/version-negotiation.md` (new migration section) · RFC 0159 + RFC 0163 (gain **Amended by** pointers; UQ1 closed in both) |
| **Compatibility** | `additive` per `COMPATIBILITY.md` — see §Compatibility for the §4 "default-on" row and why its harm predicate is empty today; would be `safety-fix` if any host advertised both profiles |
| **Supersedes**    | —                                                              |
| **Superseded by** | —                                                              |

## Summary

RFC 0159 landed the combined-deployment leaver contract **opt-in**: a host that advertises both `openwop-auth-saml` and `openwop-auth-scim` incurs the cross-lane deny obligation only if it also sets `capabilities.auth.subjectLinking: true`. RFC 0163 hardened what that obligation means (a declarable link-key class, a same-IdP trust root) but kept the gate. Both deferred the obvious question — should advertising both profiles *imply* the obligation? — as UQ1, on the grounds that it "de-conforms every current combined host". There are none. This RFC makes the obligation follow the **profile pair**: a host that advertises both profiles MUST honour the whole of `auth-profiles.md` §"Subject linking (SAML ⟷ SCIM)" (RFC 0159 §A as hardened by RFC 0163), and MUST advertise `subjectLinking: true` and a `subjectLinkKey` — the flag becomes a derived statement of fact rather than a choice. A host that cannot honour the contract for a subject MUST fail closed on the SAML lane for that subject; a host that cannot honour it at all MUST NOT advertise both profiles. `subjectLinking` is kept on the wire for v1 clients and deprecated toward v2.

## Motivation

Opt-in security is the pattern the corpus keeps regretting. `SECURITY/threat-model-auth-profiles.md` §4.5 records three STRIDE rows for subject linking — join-and-inherit, the leaver elevation, cross-tenant/-IdP spoofing — and every one of them is closed **only** for a host that volunteered a boolean. A host that advertises both profiles and omits the boolean ships the `USERS-2` leaver bypass under a conforming banner, and the conformance suite records `inapplicable` for it. That is the footgun-per-host outcome RFC 0050 and RFC 0159 exist to prevent, re-created one layer up.

RFC 0159 §Alternatives 3 and RFC 0163 §Motivation both call the mandatory posture "the stronger security posture" and defer it as `breaking` because it "de-conforms every current combined host in one step". The premise is empirically false at the time of filing:

- `INTEROP-MATRIX.md` lists no host advertising `openwop-auth-saml` or `openwop-auth-scim`.
- MyndHyve `workflow-runtime` (tier-2), on which RFC 0050 graduated, serves a live `/.well-known/openwop` with **no `auth` block at all**.
- The reference host (openwop-app, tier-1) advertises the two profiles only when its test seams are configured, and **already derives** `subjectLinking` from the profile pair plus a realm-alignment check (ADR 0613 § Tenant resolution, ADR 0620).

So the set of hosts whose conformance status changes is empty, and the cost of the mandatory rule is zero today and grows with every adopter that lands before it. The ruling that surfaced this (the RFC 0159 open-questions review, 2026-09-01) also showed why a tripwire ("promote once ≥2 independent hosts advertise the flag") would never fire: this corpus has no tier-3 host, and optional security flags in the auth family have not graduated to advertisement anywhere — `workloadIdentity` is the best-specified lane in the family and has zero advertisers.

## Proposal

### §A — The obligation follows the profile pair

- **§A.1.** A host that advertises **both** `openwop-auth-saml` and `openwop-auth-scim` in `capabilities.auth.profiles[]` MUST honour every requirement of `auth-profiles.md` §"Subject linking (SAML ⟷ SCIM)" — RFC 0159 §A.1–§A.3 (opaque IdP-stable link key, no mutable/PII key, cross-lane deactivation fail-closed) and RFC 0163 §A/§B (declared link-key class, same-IdP trust root) — **whether or not** `capabilities.auth.subjectLinking` is present. The flag no longer gates the obligation.
- **§A.2 — Unlinkable subjects.** RFC 0159 §A.4 allowed a host that cannot form an opaque-key link for a pair of identities to "treat them as independent subjects and not set `subjectLinking: true`". Under this RFC that escape is removed. For any subject the host cannot link (no persistent `NameID` / no `externalId`, no shared trust root per RFC 0163 §B.2, or lanes that serve different tenant realms), the host MUST fail closed on the SAML lane for that subject. A host that cannot honour the combined contract for its deployment as a whole MUST NOT advertise both profiles — advertising fewer profiles than the code implements is conforming; advertising both without the contract is not.
- **§A.3 — Derived advertisement.** A host that advertises both profiles MUST advertise `capabilities.auth.subjectLinking: true` and `capabilities.auth.subjectLinkKey` (a member of the RFC 0163 closed enum). The flag is now a **derived statement of fact** — "both lanes are advertised, therefore the contract holds" — that v1 clients pinned to it continue to read. A discovery document that advertises both profiles with `subjectLinking` absent or `false` is **non-conforming** and fails schema validation.
- **§A.4 — Deprecation toward v2.** `capabilities.auth.subjectLinking` is deprecated. Hosts MUST still emit it through v1.x (per `COMPATIBILITY.md` §1, a deprecation flag signals removal in v2 and never triggers a v1.x removal); clients SHOULD derive the guarantee from the profile pair and MUST tolerate the flag's presence. v2 removes the flag; the profile pair is the whole signal.

### §B — Discovery shape (`schemas/capabilities.schema.json`)

The `auth` object gains a second conditional, composed with the RFC 0163 one under `allOf` (`additionalProperties: true` preserved; nothing is closed):

```diff
-      "if":   { "properties": { "subjectLinking": { "const": true } }, "required": ["subjectLinking"] },
-      "then": { "required": ["subjectLinkKey"] },
+      "allOf": [
+        { "if":   { "properties": { "subjectLinking": { "const": true } }, "required": ["subjectLinking"] },
+          "then": { "required": ["subjectLinkKey"] } },
+        { "if":   { "properties": { "profiles": { "allOf": [ { "contains": { "const": "openwop-auth-saml" } },
+                                                            { "contains": { "const": "openwop-auth-scim" } } ] } },
+                    "required": ["profiles"] },
+          "then": { "properties": { "subjectLinking": { "const": true } },
+                    "required": ["subjectLinking", "subjectLinkKey"] } }
+      ],
```

`subjectLinking`'s description is updated to say it is derived and deprecated. No field is removed, renamed, or re-typed.

### Examples

**Conforming.** `{ "auth": { "profiles": ["openwop-auth-saml", "openwop-auth-scim"], "subjectLinking": true, "subjectLinkKey": "opaque-idp" } }` — both profiles, the derived flag, the class.

**Conforming (honest narrowing).** A host whose SAML SP and SCIM connection serve different tenant realms and therefore cannot form the same-tenant link advertises `{ "auth": { "profiles": ["openwop-auth-saml"] } }` — SAML only — even though its SCIM endpoints exist. It claims what it honours.

**Non-conforming (the vulnerable shape).** `{ "auth": { "profiles": ["openwop-auth-saml", "openwop-auth-scim"] } }` with no `subjectLinking` — the pre-RFC-0164 "opted out" shape. Fails schema validation (§B) and the advertisement scenario (`executed-fail`, citing this RFC), never `inapplicable`.

## Compatibility

**Classification: `additive`.** `COMPATIBILITY.md` §2.2 is untouched: no required field becomes optional, no field changes type, no event shape changes, no endpoint contract changes, no existing MUST is relaxed, no error code changes meaning. The new MUST binds only hosts that emit **both** profile strings.

The relevant §4 row is *"Existing optional capability becomes default-on (changes observed behavior on hosts that didn't advertise it): only via safety-fix process."* Its harm predicate is the parenthetical: a host that did not advertise the capability finds its observed behaviour changed. At filing that set is **empty** — no production host advertises both profiles (§Motivation cites the three facts) — so no host's observed behaviour or conformance status changes. The row is recorded here so the reasoning is auditable, together with the counterfactual: **had any host advertised both profiles without the flag, this RFC would be `safety-fix`** and would carry the 90-day window. The CHANGELOG entry is placed under `### Security` regardless, because the change closes a security gap; no advisory id exists and none is invented.

Backward-compatibility clauses:

- `subjectLinking` stays on the wire; clients pinned to it keep working; its removal is v2 work (`COMPATIBILITY.md` §5).
- SAML-only and SCIM-only hosts are unaffected.
- A host that later adopts both profiles adopts the contract with them; `spec/v1/version-negotiation.md` §"Combined SAML + SCIM hosts" gives the two migration paths (implement the link, or advertise one profile).

**Why the waiver is taken.** RFC 0147 §A.6 says the comment window MUST NOT be waived for RFCs touching identity. RFC 0159 and RFC 0163 — the two RFCs this one completes — were both waived under the `GOVERNANCE.md` single-maintainer bootstrap rule (`docs/WAIVER-AUDIT-2026-08-20.md` records the class). Applying a stricter rule to the third RFC of the same lineage than to the first two would not make the corpus more consistent; the honest thing is to apply the same rule and say so, which this header does.

## Conformance

**Existing coverage.** `auth-subject-link.test.ts` (RFC 0159) and `auth-subject-link-key-class.test.ts` (RFC 0163) gate every leg on `capabilities.auth.subjectLinking === true` and record `inapplicable` otherwise — including for a host that advertises both profiles and omits the flag, which is exactly the shape this RFC forbids.

**Changes (same suite minor):**

- Both scenarios re-gate on the **profile pair**: legs run whenever `profiles[]` contains both `openwop-auth-saml` and `openwop-auth-scim`; `inapplicable` only when it does not.
- **New vulnerable-shape leg** (`auth-subject-link.test.ts`, advertisement block): both profiles advertised ⇒ `subjectLinking === true` AND `subjectLinkKey ∈ {opaque-idp, configured-immutable}`, else `executed-fail` with a message citing RFC 0164 §A.3. This is the `COMPATIBILITY.md` §3-style leg that detects the old shape even though the RFC is classified additive.
- The schema conditional's cases are pinned server-free in `conformance/src/lib/capabilities-auth-subject-link.test.ts` (both profiles with no flag rejected; both with `false` rejected; both with `true` + class accepted; one profile with no flag accepted).
- `SECURITY/invariants.yaml`: `subject-link-leaver-deny`, `subject-link-key-class-declared`, `subject-link-same-trust-root` re-targeted from the flag to the profile pair; new `subject-link-mandatory-when-both-advertised`.

**Capability gate:** `profiles ⊇ {openwop-auth-saml, openwop-auth-scim}`. **INTEROP-MATRIX:** the subject-linking sub-table notes the gate change; no host row changes (none advertises both).

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.1 (obligation follows the pair) | a host advertising both profiles is exercised by the RFC 0159/0163 legs regardless of the flag; a leaver is denied cross-lane | the suite, via the SCIM+SAML seams, gated on the profile pair | witnessable — seam-gated |
| §A.2 (unlinkable ⇒ fail closed or narrow the advertisement) | an unlinkable subject's SAML assertion is refused; or the discovery document carries one profile, not both | the suite (unlinkable pair over the seams); the discovery read | witnessable — seam-gated (refusal) / unaided (narrowing) |
| §A.3 (derived flag + class required) | both profiles with `subjectLinking` absent/false, or no `subjectLinkKey`, fails schema validation and the advertisement leg | the suite, unaided (discovery read + schema) | **witnessable, unaided** |
| §A.4 (flag tolerated, deprecated) | a `subjectLinking: true` document stays schema-valid through v1.x | the suite, unaided | **witnessable, unaided** |
| §B (schema conditional) | the four schema cases above | the suite, unaided (`src/lib` schema pin) | **witnessable, unaided** |

**Note.** §A.1's behavioural rows inherit RFC 0163 UQ5's residual (a host that lies in discovery and is never probed on the lying pair). This RFC narrows the *population* the residual applies to — every combined host, not only the opted-in ones — without changing its shape.

## Alternatives considered

1. **Keep the opt-in and add a tripwire (RFC 0159 ruling §6).** Rejected — the tripwire ("≥2 independent hosts advertise the flag") cannot fire in an ecosystem with no tier-3 host and no auth-family opt-in flag that has ever graduated to advertisement. It is a way of never deciding.
2. **Defer to v2 as `breaking` (RFC 0159 §Alternatives 3, RFC 0163 UQ1).** Rejected — the breaking premise ("de-conforms every current combined host") is empty at filing, and every month of deferral lets the first combined host land opted-out. v2 still removes the flag (§A.4); the obligation does not need to wait for it.
3. **Classify `safety-fix` and run the 90-day window.** Considered seriously; the §4 row reads that way on its face. Rejected on the empty-set argument above, with the counterfactual recorded so a reviewer can disagree with the fact rather than the reasoning. The RFC still ships the §3 artifacts that matter — a vulnerable-shape detection leg, a migration section, a `### Security` changelog line.
4. **Delete `subjectLinking` now.** Rejected — `COMPATIBILITY.md` §2.2 forbids removing a field in v1.x; §1 says deprecation flags signal v2 removal. Derived-and-tolerated is the v1 shape.
5. **Forbid advertising both profiles without the contract but keep the flag as the gate.** Rejected — that is the same rule stated twice; making the pair the gate and the flag derived is simpler on the wire and in the suite.

## Unresolved questions

1. **v2 shape of the profile advertisement.** Should v2 remove only `subjectLinking`, or fold `openwop-auth-saml` + `openwop-auth-scim` into one `openwop-auth-enterprise-identity` profile whose predicate *is* the combined contract? The latter removes the pair-detection logic from every consumer. Recorded for the v2 charter; no v1 wire impact.
2. **Realm alignment as a wire fact.** The reference host's "lanes serve different tenant realms" case is host configuration today. Should v2's Subject record carry the tenant realm per lane so the suite can witness §A.2's narrowing rather than trust the host's discovery derivation?

## Implementation notes (non-normative)

- **Reference host (openwop-app).** ADR 0613/0620 already derive `subjectLinking` from the profile pair **and** `subjectLinkRealmAlignment()`. Under this RFC the misaligned case must stop advertising one of the two profiles instead of advertising both without the flag (§A.2). One branch in `routes/discovery.ts`; an in-process witness that discovery never carries both profiles without `subjectLinking: true` + `subjectLinkKey`. Lands after `Active`.
- **MyndHyve.** Implements both lanes (RFC 0050 graduated on it) and advertises neither; unaffected unless it re-advertises both, in which case the contract applies — the runbook names both paths.
- **Cross-cut.** Auth-profile family (RFC 0010/0050/0159/0163 lineage); additive; no `CC-N` entry.

## Acceptance criteria

- [x] Spec text merged — `auth-profiles.md` §"Subject linking (SAML ⟷ SCIM)" gating sentence, §A.4 escape and discovery shape amended; new §"Mandatory when both profiles are advertised — RFC 0164". (`Active` PR)
- [x] `schemas/capabilities.schema.json` — second conditional under `auth` composed via `allOf`; `subjectLinking` description marked derived/deprecated; `redocly lint api/openapi.yaml` clean. (`Active` PR)
- [x] RFC 0159 and RFC 0163 gain `**Amended by**` pointers; UQ1 closed in both; RFC 0159 register G1/R2 closed. (`Active` PR)
- [x] Conformance: both subject-link scenarios re-gated on the profile pair; vulnerable-shape leg added; schema cases pinned in `src/lib`; invariants re-targeted + `subject-link-mandatory-when-both-advertised` registered; threat model §4.5 re-scoped. (`Active` PR)
- [x] `spec/v1/version-negotiation.md` migration section; CHANGELOG `### Security` entry; suite bump. (`Active` PR)
- [x] Reference host (openwop-app) narrows its advertisement when realms are misaligned and witnesses that both profiles are never advertised without the derived flag. (openwop-app #3620, `873efc466`, ADR 0623 — see § Implementation record)

## Implementation record

| Item | Where | Status |
| --- | --- | --- |
| RFC text, prose, schema `allOf` conditional, scenario re-gate + vulnerable-shape leg, invariants, threat model, runbook, registers, pointers, `Draft → Active` | `../openwop` #1168 (`b1203c439`), suite 1.151.0 | merged |
| Reference-host leg — advertise both profiles only when realms are aligned and a SCIM trust-root seat is configured (else narrow to `openwop-auth-saml`); both advertised ⇒ derived flag + class from one gate; unbound record in a combined deployment ⇒ SAML refused, fail closed | openwop-app #3620 (`873efc466`), ADR 0623 | merged |

**Witness.** `auth-subject-link-alignment.test.ts` (5 legs: misaligned realms + seat ⇒ `openwop-auth-scim` dropped; aligned + no seat ⇒ dropped; aligned + seat ⇒ both profiles + `subjectLinking: true` + `subjectLinkKey`; aligned + seat + unbound ⇒ SAML `401 subject_link_unbound`; single-profile + unbound ⇒ RFC 0159 deny-only survives) plus `saml_assertion_unbound_refused` in `auth-subject-link.test.ts`; two sabotage reverts confirmed load-bearing (revert the SCIM drop ⇒ alignment leg reds 1/4; revert the unbound refusal ⇒ fail-closed leg reds 1/14); `tsc --noEmit` clean, auth suites 25/25, `npm run ci` green (5034 tests, 0 failed); the witness was re-verified by the adopting session after the implementing agent stalled, not inherited

## References

- RFC 0159 — SCIM ⟷ SAML subject linking (the opt-in contract this RFC makes mandatory; UQ1).
- RFC 0163 — Subject-linking hardening (link-key class, same-IdP trust root; UQ1 inherited).
- RFC 0050 — SAML / SCIM enterprise identity profiles.
- RFC 0147 §A.6 — the identity-RFC no-waiver clause, and `docs/WAIVER-AUDIT-2026-08-20.md` on how 0159/0163 were handled.
- `COMPATIBILITY.md` §2.2, §4 (the default-on row), §5 (v2 removal).
- `SECURITY/threat-model-auth-profiles.md` §4.5.
- The RFC 0159 open-questions ruling (2026-09-01) and the v2 charter — the empty-set finding and the tripwire critique.
