# RFC 0222 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | `yanked` and `versionDeprecated` sit outside the signature, so a mirror or a compromised CDN can strip a yank and a consumer cannot tell. | L | H | Med | Transport is HTTPS; a mirror re-derives the signer at ingest (`packs.md` §"The registry tree"); the advisory feed is a second, independent record of what must be yanked. Signing the version manifest is a certification-class change (Alternatives 2). | Security Architect | `accepted` — recorded, not mitigated at the protocol layer. |
| R2 | A non-`active` key keeps signing, because no registry gate reads `status`. | L | M | Low | openwop-registry #79 (`check-published-immutable.mjs`) refuses a version a PR adds whose key is not `active`. | Conformance Architect | `closed` — the gate exists and is sabotage-proved. |
