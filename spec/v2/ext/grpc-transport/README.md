# gRPC transport notes

> **Status: Note.**

A non-normative note, not a declared family. v2 has no normative gRPC transport, because the conformance suite has no gRPC client or behavioral witness.

| Field | Value |
| --- | --- |
| **witness:** | `unwitnessable` |
| **technical:** | `experimental` |
| **adoption:** | `none` |
| **advertised as** | not advertisable; v2 has no `grpc` discovery record |

v2 defines no gRPC operations and ships no `.proto` file. The proto that sat here was a byte-for-byte copy of the previous major's file, so it described that major's wire, not this one, and was removed. A v2 gRPC binding would need its own RFC, a proto generated from the v2 API, and a behavioral witness.

*Sources: RFC 0094, RFC 0175, RFC 0266.*
