# RFC 0230 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | An unauthenticated (signature-only) `ingestUrl` is abused to start runs. | M | H | High | A run starts only on a valid signature under `required`. The secret is returned once, and the 300 s skew bound plus `webhook-id` dedup blunt replay. `none` / `best-effort` are an operator's explicit choice. | openwop-app steward | `open` — reviewed at the RFC 0156 §B retrospective. |
| R2 | A `401` on a bad signature lets a caller probe signatures. | L | L | Low | Probing is bounded by the secret's entropy (HMAC-SHA256), not by hiding the status. | Conformance Architect | `accepted` (§Decisions 3). |
| R3 | An unauthenticated post to `ingestUrl` disables the subscription (a bad signature dead-letters it, so every legitimate delivery then answers `409`). | H | H | High | §C.1: a refused post MUST NOT change the subscription's state; only the delivery is dead-lettered, and leg 2 witnesses the subscription staying `active`. Found at implementation time, before the RFC merged. | Conformance Architect | `mitigated` — by §C.1. |
