# RFC 0239 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | A host refuses a non-member turn but consumes the interrupt anyway, so a valid member can no longer speak and replay sees a refused value. | M | M | Med | §B.3 requires the interrupt to stay open; §F leg 2 resumes with a member turn after the refusal (the control). | Conformance Architect | `accepted` — the control leg is the check. |
| R2 | The `422 conversation_speaker_not_participant` refusal discloses roster membership to a caller who could not otherwise see it. | L | L | Low | Only a caller able to resolve the interrupt can trigger the refusal, and that caller already reads the run's `conversation.opened.participants`. | Security Architect | `accepted` — no new disclosure. |
