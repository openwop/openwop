# RFC 0225 — Gap register

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §Implementation notes | No host advertised `retryPolicy.maxElapsedMs`, so the row had no witness. | Conformance Architect | `closed` 2026-09-29 — the tripwire fired: MyndHyve advertises 600000, and its certified 2.44.3 cut (myndhyve#563, witness `58da9407e616`, VERIFIED) records `0173.webhook-durable-delivery.dead-letter` `executed-pass` on the advertised-bound path, with the last attempt after 224981 ms (past the old 210 s window) and the sink after 226481 ms. | — |
