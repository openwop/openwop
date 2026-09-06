# `sandbox-runtime-notes` — extension (non-normative)

| Field | Value |
| --- | --- |
| **witness:** | `unwitnessable` |
| **technical:** | `experimental` |
| **adoption:** | `none` |
| **advertised as** | not advertisable (notes, not a surface) |
| **owning RFC** | RFC 0173 §D (RFC 0035 superseded by the `packs` obligation at the cut) |

> **Status: Draft · v2.0.0-rc (2026-09-03).** RFC 0035's `node:vm` demonstrator and its runtime notes are kept here as implementation history. In v2 isolation binds with pack execution (`security-defaults.md`): `sandbox.isolationModel` names `wasm | process | container | vm`; `node:vm` is not a value (RFC 0035 §20, `:130`: escapable by design). A host MAY register and validate packs without executing them. RFC 0035 flips `Superseded` at the RC.
