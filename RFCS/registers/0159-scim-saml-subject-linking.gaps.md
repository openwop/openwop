# RFC 0159 — Gap register

Open design gaps discovered while authoring RFC 0159 (SCIM ⟷ SAML subject linking). Keyed to the RFC; each row has an owner and a resolution path. Gaps with no path are promoted to the risk register.

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | Proposal §A / UQ1 | Opt-in-additive now vs mandatory-for-combined-hosts later — is a breaking v2 follow-up wanted, and on what window? | Compatibility Architect | Maintainer decision in the comment window; if yes, file the follow-up breaking RFC | `Active` (posture must be firm before merge) |
| G2 | Falsifiability / UQ2 | §A.2 & §A.4 are partly negative-existence (a suite can't prove no unsafe join for an unprobed pair). Add a discovery-declared `auth.subjectLinkKey` class to convert a claims-check into a witnessable advertisement? | Conformance Architect | Decide UQ2; if yes, extend `capabilities.schema.json` in this RFC before `Active` | Full witnessability of §A.2/§A.4 |
| G3 | Proposal §A.1 / UQ3 | Enumerate the acceptable stable linking-attribute set (beyond `externalId`↔persistent-`NameID`) or leave to operator config under the opaque+stable+non-PII constraint? | Spec Architect | Decision needed; enumeration tightens conformance, open set eases adoption | Conformance fixture scope |
| G4 | Proposal §A / UQ4 | Should §A require the SAML and SCIM lanes to share one IdP trust root before a link forms (prevent cross-IdP identifier collision)? | Security Architect | Decision needed; likely a MUST | Threat-model sign-off |
| G5 | Conformance | Does the bundled synthetic SAML IdP (`conformance/src/lib/saml-idp.ts`) already let a test mint an assertion whose persistent `NameID` equals an arbitrary SCIM `externalId`, or is a fixture extension needed for the positive case? | Conformance Architect | Read the IdP fixture API; extend + add a `subject-link` row to `fixtures.md` if needed | `auth-subject-link.test.ts` positive leg |
| G6 | Schema | Confirm `capabilities.schema.json`'s `auth` object is `additionalProperties:false` (so the new optional `subjectLinking` must be added explicitly) and that no OpenAPI/AsyncAPI `$ref` needs a parallel edit | Schema Architect | Inspect the schema + `redocly lint`; adjust the diff if the object shape differs | Schema diff finalization |
