# RFC 0222 — Gap register

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §A | The earlier major's registry write endpoints (`deprecate`, `yank`, `keychain`, `keychain/rotate`), their scopes, the `rotationProof` chain and the 72-hour unpublish window have no v2 home. | Spec Architect | `closed` — §A records them as not carried; a registry with a write API MAY still offer them. | Nothing. |
| G2 | §C | No corpus schema describes `.well-known/openwop-registry.json`, so the `signingKeys[]` members §C names are validated only by the conformance leg. | Schema Architect | `closed` — §C names the members every served entry carries; a registry-discovery schema is a separate additive change, not needed for these rules. | Nothing. |
