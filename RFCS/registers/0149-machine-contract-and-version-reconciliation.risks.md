# RFC 0149 — Risk Register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | A client depends on the erroneous doubled path. | M | M | Medium | Survey, warning, optional temporary redirect. | SDK Maintainer | Open |
| R2 | Typo lint rejects legitimate vendor fields. | M | M | Medium | Namespace exemption and reviewed reserved-name ledger. | Schema Architect | Open |
| R3 | Runtime closure accidentally breaks additive v1 clients. | L | H | High | Keep server-emitted schemas open; lint authoring only. | Compatibility Architect | Open |
| R4 | Example extraction changes Markdown semantics. | M | L | Low | Explicit fenced-block metadata and source-linked snapshots. | Spec Architect | Open |
| R5 | Version normalization hides a true incompatible host. | L | H | High | Warn only for exact patch-zero legacy form; never normalize different major. | Compatibility Architect | Open |
