# RFC 0166 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | A mechanically classified `witness` is read as a reviewed verdict and used to justify a claim | M | H | High | Every entry is stamped `witnessReview: initial-mechanical-2026-09-02`; the RFC says so in §C.2; the unreviewed count is a published ratchet | Security Architect | `open` |
| R2 | The token backfill mis-dispositions a row (e.g. a real open gap on an Accepted RFC becomes `carried`) and the gate stops complaining about it | M | M | Medium | `carried:<self>` keeps the row visible in `gaps.json` as an open-disposition gap; the gate reports counts; G3 tracks review | Spec Architect | `open` |
| R3 | The 100 backfilled empty registers are mistaken for real sweeps | L | L | Low | Each says in its header that it was opened by the backfill and why; its single row is `G0` | Spec Architect | `mitigated` |
