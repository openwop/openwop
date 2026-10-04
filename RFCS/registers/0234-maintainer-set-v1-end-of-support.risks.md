# RFC 0234 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | A third-party v1 consumer exists that no counted host's logs saw (e.g. one using header-less major-1 on an unversioned path). | L | M | Low | The date only permits retirement (§A.2); the retention floors keep 1.x installable to 2027-09-05; G1 records the measurement gap. | Compatibility Architect | `accepted` — measured evidence plus the floors. |
| R2 | The "third-party" traffic definition reads as chosen to fit the data. | M | M | Med | Alternative 3 records that it was settled after MyndHyve's numbers, and why: first-party clients are not put at risk because retirement is permitted, not forced. | Spec Architect | `accepted` — disclosed in the RFC. |
