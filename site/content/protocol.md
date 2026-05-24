# The OpenWOP protocol

Everything that makes OpenWOP a standard — the wire contract, the evolution process, the security posture, and the project that maintains them — lives in one of six surfaces below. This page exists so a reviewer can find the surface they need without digging through the index.

## Specification

The normative wire contract for v1.x.

- **[Spec corpus →](/spec/v1/)** — 35 prose specs, thematically grouped (foundation, runtime, agents, humans, transports, security, ecosystem, production, integration). The specs are independently citable; each carries a status banner from the legend on `auth.md`.
- **[REST API reference →](/api/rest/)** — every endpoint with request, response, and error envelope, rendered from `api/openapi.yaml`.
- **[Profiles →](/profiles/)** — the coherent capability slices a host can claim (`openwop-core`, `openwop-stream-sse`, `openwop-secrets`, `openwop-provider-policy`, `openwop-node-packs`, etc.).

## Conformance

How a host proves it implements the spec.

- **[Conformance leaderboard →](/conformance/)** — live record of which hosts pass which scenarios, sourced from `INTEROP-MATRIX.md`.
- **[Conformance suite →](https://github.com/openwop/openwop/tree/main/conformance)** — `@openwop/openwop-conformance`, the npm-published behavioural test suite that gates every leaderboard row.
- **[Error codes →](/errors/)** — the canonical error vocabulary every conforming host emits.

## RFCs

How the protocol evolves.

- **[RFC index →](/rfcs/)** — every RFC, status, and target version. v1.x stays additive-only per [`COMPATIBILITY.md`](https://github.com/openwop/openwop/blob/main/COMPATIBILITY.md).
- **[RFC process →](/rfcs/0001-rfc-process.html)** — what counts as Draft / Active / Accepted, the comment-window discipline, and the path to a v2 working group.

## Governance

Who decides what gets in, and how.

- **[Governance →](/governance/)** — decision rules, role definitions, the bootstrap-phase amendment, and the cross-vendor working-group charter for v2.
- **[Maintainers →](/maintainers/)** — current maintainer set, recruitment criteria, and the affiliation policy that drives the vendor-neutral-org migration tripwire.
- **[Contributing →](/contributing/)** — per-artifact change rules (editorial / additive / safety-fix / breaking), the eight-step CI gate, the DCO requirement.

## Security

What's promised, what's threat-modelled, and how to report a vulnerability.

- **[Security posture →](/security/)** — threat model, disclosure policy, public invariants (CTI-1, SR-1, MCP-1).
- **[GitHub Security Advisories →](https://github.com/openwop/openwop/security/advisories/new)** — coordinated disclosure channel for vulnerabilities.

## Versioning and roadmap

What's stable, what's planned, what's tracked but not committed.

- **[Versioning policy →](/versioning/)** — additive within v1.x, the 90-day safety-fix window, breaking changes only in major versions.
- **[Changelog →](/changelog/)** — every spec, schema, SDK, and reference-host change with its compatibility classification.
- **[Roadmap →](/roadmap/)** — gap-closure tracks the steward maintains in the open. No dates beyond what has a `CHANGELOG.md` entry.

## See also

- [Community](/community/) — channels, comment windows, and how to file an RFC.
- [Implementing OpenWOP](/implement/) — the four role-specific entry points.
