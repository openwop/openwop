# `restTransport` extension

> **Status: Stable.**

`restTransport` names conditional GET and response compression on run reads. The run-snapshot rules are in [`runs.md`](../../core/runs.md) §"Caching and encoding". This page defines the claim and what advertising it adds to those rules.

| Field | Value |
| --- | --- |
| **witness:** | `witnessable-gated` |
| **technical:** | `stable` |
| **adoption:** | `single-witness` |
| **peer-dependency id** | `restTransport` |
| **advertised as** | `extensions.<org>.rest-transport` |
| **declared facets** | `conditionalRunGet`, `contentEncodings` |

## The claim

A host MAY advertise `restTransport` as `extensions["<org>.rest-transport"]`, where `<org>` is its registered organization ([capabilities.md §3.2](../../core/capabilities.md)). The record's two facets are:

| Facet | Type | Meaning |
| --- | --- | --- |
| `conditionalRunGet` | boolean | `true` claims a validator on every run-snapshot read |
| `contentEncodings` | array of `gzip`, `br`, `zstd` | the codings the host produces for a run-snapshot read |

Other members of the record are the organization's own.

## What the claim adds

A host whose record sets `conditionalRunGet: true` MUST carry, on every `200` of `GET /runs/{runId}`, the strong `ETag` that runs.md §"Caching and encoding" makes a SHOULD. The stability and `304` rules there then always apply.

For each coding listed in `contentEncodings`, a request that names only that coding in `Accept-Encoding` MUST receive it, subject to the rules in runs.md §"Caching and encoding".

A client MUST NOT infer anything else from the record.

The claim describes what a client receives at the host's advertised base URL, so a CDN or proxy in front of the host is part of it. A front that drops or rewrites a coding the origin produces makes the claim false. A host behind a front should list only the codings measured through that front.

## Conformance

`conformance/src/scenarios/v2-ext-rest-transport.test.ts` (major 2) records the witness under `openwop.family.restTransport`:

- **Conditional GET:** runs the `conformance-approval` fixture to `waiting-approval`. It checks for a strong `ETag`, a `304` with no body on a matching `If-None-Match`, and a changed `ETag` once the run completes.
- **Codings:** for each advertised coding, the decoded body is byte-identical to the identity body. The probe goes through the base URL it is given, so it measures any front in the path.

A host without the claim records `inapplicable`. A host that makes the claim but lacks the fixture records `blocked`.

*Sources: RFC 0115, RFC 0220.*
