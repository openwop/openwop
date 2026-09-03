# RFC 0168 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | The explicit-id migration reworded thousands of ids and 1.x bundles stop resolving | M | H | High | Ids are minted from the current derivation so every 1.x id is a v2 id or an alias row; the generator diff is the gate | Conformance Architect | `mitigated` |
| R2 | A host signs its own `independent` bundle | M | H | High | The verifier refuses a self-signed `independent` claim; the verifier key must be a registry `signingKeys[]` entry for a different org | Security Architect | `mitigated` |
| R3 | The package split lands and one consumer keeps the vendored copy | M | M | Medium | RFC 0176 §E.1 pin rule; the suite refuses to start on a digest mismatch | Steward | `open` |
| R4 | Evicting seams leaves openwop-app's seam-driven scenarios without a client | L | M | Low | `api/seams-v2.yaml` is generated into the suite's own driver | Reference-host maintainer | `mitigated` |
