# `chat` — extension

| Field | Value |
| --- | --- |
| **witness:** | `claims-check` |
| **technical:** | `experimental` |
| **adoption:** | `single-witness` |
| **peer-dependency id** | `chat` |
| **advertised as** | `extensions.<org>.chat` (RFC 0169 §A.4) — never a root key |
| **owning RFC** | RFC 0144 |

> **Status: Draft · v2.0.0-rc (2026-09-03).** Extension document (RFC 0169 §B.3; RFC 0167 Axiom 1: a family that cannot be witnessed unaided lives here and is not a core obligation).

## What it is

RFC 0169 §B.3 (RFC 0144 extension class; prose-only §host.* section in v1; served under extensions.openwop-app.* by the one host that has it) The v1 prose that defines the surface is `spec/v1/host-capabilities.md` §host.chat (RFC 0144 extension class); it stands as the definition until this document carries its own normative text (P3-E and the Phase 4 host legs). A host that serves this surface advertises it under `extensions.<org>.chat` with the RFC 0169 record shape; a pack that requires it names `chat` in `peerDependencies` (RFC 0177 §B.1).

## Witness

`claims-check`: the suite can read the claim from discovery but has no behavioral probe; adoption is measured by the INTEROP-MATRIX bundle evidence.
