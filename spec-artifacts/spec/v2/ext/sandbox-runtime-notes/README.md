# Sandbox runtime notes

> **Status: Draft · non-normative note.** This is not a declared extension
> family and is outside this rule.

| Field | Value |
| --- | --- |
| **witness:** | `unwitnessable` |
| **technical:** | `experimental` |
| **adoption:** | `none` |
| **advertised as** | not advertisable (notes, not a surface) |
| **owning RFC** | RFC 0173 §D (RFC 0035 superseded by the `packs` obligation at the cut) |

RFC 0035's `node:vm` demonstrator is retained only as implementation history;
`node:vm` is not an isolation model. The v2 contract is in
[`security-defaults.md`](../../core/security-defaults.md):
`sandbox.isolationModel` is one of `wasm`, `process`, `container`, or `vm`, and
pack execution is bound to the advertised isolation mode.
