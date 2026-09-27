# Sandbox runtime notes

> **Status: Note.**

A non-normative note, not a declared family.

| Field | Value |
| --- | --- |
| **witness:** | `unwitnessable` |
| **technical:** | `experimental` |
| **adoption:** | `none` |
| **advertised as** | not advertisable |

`node:vm` is not an isolation model; its demonstrator is implementation history only. The v2 contract is in [`security-defaults.md`](../../core/security-defaults.md): `sandbox.isolationModel` is one of `wasm`, `process`, `container`, or `vm`, and pack execution is bound to the advertised isolation mode.

*Sources: RFC 0035, RFC 0173.*
