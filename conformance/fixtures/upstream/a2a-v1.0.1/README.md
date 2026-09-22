# Vendored upstream: A2A v1.0.1 `a2a.proto` (RFC 0205)

`a2a.proto` is copied **byte for byte** from the A2A repository at tag `v1.0.1`.
It is the upstream half of RFC 0205 §D: A2A commits no JSON Schema of its own
(`specification/json/README.md` at v1.0.1: `a2a.json` is a non-normative build
artifact), so `schemas/v2/part.schema.json` and `schemas/v2/artifact.schema.json`
are transcribed from this file. The corpus gate
(`conformance/src/coherence/a2a-parts-schemas.test.ts`) checks the SHA-256 below
and compares each schema's member names with the camelCased fields of
`message Part` and `message Artifact` (A2A spec §5.5), so a transcription slip
fails the gate (RFC 0205 register G7). Do not edit it; a re-vendor to a later A2A
minor is an additive v2.x change that re-transcribes both schemas.

| File | Source URL | SHA-256 |
| --- | --- | --- |
| `a2a.proto` | `https://raw.githubusercontent.com/a2aproject/A2A/v1.0.1/specification/a2a.proto` | `e195bf96ab630c69797851970203e1b2b6b19528f2e9803b7d904b91a5104016` |

Fetched 2026-09-22.

## Licence

A2A is published by the A2A project authors under the Apache License, Version 2.0
(<https://www.apache.org/licenses/LICENSE-2.0>). The file is redistributed
unmodified under that licence; source: <https://github.com/a2aproject/A2A>.
