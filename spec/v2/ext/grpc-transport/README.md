# gRPC transport notes

> **Status: Draft · non-normative note.** This is not a declared extension
> family and is outside this rule.

| Field | Value |
| --- | --- |
| **witness:** | `unwitnessable` |
| **technical:** | `experimental` |
| **adoption:** | `none` |
| **advertised as** | not advertisable; v2 has no `grpc` discovery record |
| **owning RFC** | RFC 0175 (demotion); RFC 0094 §H (v1 text) |

The [v1 `openwop.proto`](https://github.com/openwop/openwop/blob/main/spec/v2/ext/grpc-transport/openwop.proto)
is retained as a sketch and uses `package openwop.v1`; it is not a v2 contract.
v2 has no normative gRPC transport because the conformance suite has no gRPC
client or behavioral witness. The v1 contract remains in
[`spec/v1/grpc-transport.md`](https://github.com/openwop/openwop/blob/main/spec/v1/grpc-transport.md).
