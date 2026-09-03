# `a2uiSurface` — extension

| Field | Value |
| --- | --- |
| **witness:** | `claims-check` |
| **technical:** | `experimental` |
| **adoption:** | `none` |
| **peer-dependency id** | `a2uiSurface` |
| **advertised as** | `extensions.<org>.a2uiSurface` (RFC 0169 §A.4) — never a root key |
| **owning RFC** | RFC 0114 |

> **Status: Draft · v2.0.0-rc (2026-09-03).** Extension document (RFC 0169 §B.3; RFC 0167 Axiom 1: a family that cannot be witnessed unaided lives here and is not a core obligation).

## What it is

RFC 0169 §C.5 (deltaTransport claims-check; ext/ unless a behavioral witness lands) The v1 prose that defines the surface is `spec/v1/capabilities.md` (root key `a2uiSurface`, RFC 0114); it stands as the definition until this document carries its own normative text (P3-E and the Phase 4 host legs). A host that serves this surface advertises it under `extensions.<org>.a2uiSurface` with the RFC 0169 record shape; a pack that requires it names `a2uiSurface` in `peerDependencies` (RFC 0177 §B.1).

## Witness

`claims-check`: the suite can read the claim from discovery but has no behavioral probe; adoption is measured by the INTEROP-MATRIX bundle evidence.
