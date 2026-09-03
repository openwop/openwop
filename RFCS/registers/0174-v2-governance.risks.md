# RFC 0174 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | The approval-count waiver removes the last human check on a decision-rule change | M | H | High | Named in the header, checked by `check-waiver-authority.mjs`, recorded in the retrospective register as `not-reviewed`; retires with the sole-steward paragraph | Steward | `mitigated` — the waiver is visible, not absent |
| R2 | Deriving banners from RFC status graduates a document whose content is still draft | L | M | Low | Only a banner whose stated predicate has fired is failed; a document keeps `Draft` under a different, unfired predicate | Spec Architect | `mitigated` |
| R3 | Re-tokening 45 self-carries to `closed` on the strength of the word CLOSED in prose closes a gap that was not | L | M | Low | The rows already asserted closure in their own text; the token now agrees with the prose rather than contradicting it; a wrong one is reopened by editing the token | Spec Architect | `accepted` |
| R4 | The self-carry ratchet is gamed by re-tokening rows `closed` without work | M | M | Medium | A `closed` row on a terminal RFC still needs its prose; RFC 0178 §B.3's contradiction check catches a closed row naming a missing artifact | Steward | `open` |
