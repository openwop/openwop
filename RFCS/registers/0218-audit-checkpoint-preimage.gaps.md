# RFC 0218 — Gap register

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §A | `auth-profiles.md` §3's emitted checkpoint carries `ts`, but `audit-verify-result.schema.json`'s `Checkpoint` is closed over `{checkpoint, atSequence, merkleRoot, signature}`, so a verify result cannot echo it. | Spec Architect | `transferred:spec/v1` — v1 is frozen through the overlap (end of support 2026-12-04), and adding an optional member is a v1 schema change for a profile no deployed host advertises. Revisit if the profile gets a v2 home. | Nothing in this RFC. |
