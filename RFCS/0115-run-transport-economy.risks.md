# RFC 0115 — Risk Register

Score = Likelihood × Impact (H/M/L).

| ID  | Risk                                                                                          | Likelihood | Impact | Score | Mitigation                                                                       | Owner                 | Status |
| --- | -------------------------------------------------------------------------------------------- | ---------- | ------ | ----- | -------------------------------------------------------------------------------- | --------------------- | ------ |
| R1  | Stale `ETag` → client sees `304` and misses a real state change (correctness, not just cost)  | L          | H      | Med   | Normative: ETag MUST change on any observable state change; conformance asserts stability + invalidation | Conformance Architect | Open   |
| R2  | Compression of a body containing redacted-but-sensitive structure enables a CRIME/BREACH-style side channel | L | M  | Low   | Run reads are authenticated per-tenant, not attacker-mixed; note in threat review; no secret plaintext in body (SR-1) | Security Architect    | Open   |
| R3  | Host advertises `contentEncodings` but a value round-trips lossily                            | L          | M      | Low   | Conformance asserts byte-identical decode for each advertised encoding           | Conformance Architect | Open   |
