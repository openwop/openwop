# RFC 0173 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | Binding suppression to `replay` makes a host drop `replay` rather than guard its seams | M | M | Medium | The manifest makes the unguarded paths visible and countable; a host that drops `replay` loses fork, which both matrix hosts advertise and depend on | Reference-host maintainer | `open` |
| R2 | A relaxation recorded in the bundle is treated as a certification with an asterisk | L | H | Medium | §A.2: a relaxed obligation's profile cannot certify; the verifier (C.1 bundle v3) refuses, not warns | Conformance Architect | `mitigated` |
| R3 | The eight sandbox invariants bind to pack execution and no host can execute third-party packs in v2 | M | M | Medium | RFC 0119's mechanism-neutral property admits WASM / process / container / VM; `node:vm` is excluded; a host may register and validate packs without executing them; MyndHyve's `no-untrusted-packs` posture is conforming | Steward | `accepted` |
| R4 | Business-identity keying for Layer 2 is under-specified for providers with no natural key | M | M | Medium | The activity recipe stays as the documented fallback; the provider registry (RFC 0150 G3, `ext/provider-idempotency`) records which providers have a key | Spec Architect | `open` |
