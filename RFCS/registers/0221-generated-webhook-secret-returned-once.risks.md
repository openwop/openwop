# RFC 0221 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | A host logs the `201` body and so writes the generated secret to its logs. | L | H | Med | `webhooks.md` already forbids logging the secret; the returned secret is that secret. Host operators redact response bodies of `registerWebhook`. | Security Architect | `accepted` — the existing MUST NOT log rule covers it. |
