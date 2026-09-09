# RFC 0177 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | The re-publish wave (282 versions) is not done before a host cuts and a v2 host has zero installable packs | M | H | High | `registry/v2/` is a Phase 3 deliverable and the registry's evidence for §G.2; the core wave is scripted on existing generators | Steward | `open` |
| R2 | A mirror or vendor registry installs a `<2.0.0` pack on a v2 host | M | H | High | §A.1 binds at install on every path; the MyndHyve leg is G3 | Reference-host maintainer | `open` |
| R3 | Relabeling a tarball-bytes signature as the canonical-JSON scheme makes a valid signature fail to verify | L | H | Medium | The codemod refuses `ed25519` and `sigstore`; the two packs are re-signed, never relabeled | Conformance Architect | `mitigated` |
| R4 | Fail-closed provider conflict breaks a host that ships a built-in and installs the community pack of the same id | M | M | Medium | The qualified form `<packName>#<id>`; built-ins are the host's own pack for the rule; `provider-conflict` proves the refusal is loud | Spec Architect | `mitigated` |
| R5 | The alias table becomes a permanent second grammar | L | M | Low | `removalTrigger: v1-end-of-support` on the row; a v2 host MUST NOT resolve aliases after it | Steward | `mitigated` |
