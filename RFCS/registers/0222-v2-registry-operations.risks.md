# RFC 0222 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | `yanked` and `versionDeprecated` sit outside the signature, so a mirror or a compromised CDN can strip a yank and a consumer cannot tell. | L | H | Med | Transport is HTTPS; a mirror re-derives the signer at ingest (`packs.md` §"The registry tree"); the advisory feed is a second, independent record of what must be yanked. Signing the version manifest is a certification-class change (Alternatives 2). | Security Architect | `accepted` — recorded, not mitigated at the protocol layer. |
| R2 | A non-`active` key keeps signing, because no registry gate reads `status` yet. | L | M | Low | §C forbids it; the acceptance box owes the registry-side check. Every key is `active` today, so no version is affected. | Conformance Architect | `accepted` — owed as acceptance work. |
