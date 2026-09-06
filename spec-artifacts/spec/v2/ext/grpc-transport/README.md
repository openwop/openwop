# `grpc-transport` — extension (demoted)

| Field | Value |
| --- | --- |
| **witness:** | `unwitnessable` |
| **technical:** | `experimental` |
| **adoption:** | `none` |
| **advertised as** | not advertisable — no `grpc` block exists at the v2 root (RFC 0175 §A.1; RFC 0169 §A.1) |
| **owning RFC** | RFC 0175 (demotion); RFC 0094 §H (v1 text) |

> **Status: Draft · v2.0.0-rc (2026-09-03).** RFC 0175 §A.1: `grpc-transport.md` leaves `core/`; the suite ships no gRPC client and no host advertises the block, so the transport is `unwitnessable`. Its six v1 MUSTs are SHOULDs of this extension. `openwop.proto` beside this file is a NON-NORMATIVE sketch (the v1 proto, unchanged; `package openwop.v1`). The door back into core is named: a v2.x additive RFC that generates the proto from `spec/v2/declaration.json` and lands a suite client.

The v1 definition stands at `spec/v1/grpc-transport.md` for v1.x hosts.
