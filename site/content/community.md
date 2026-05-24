# Community

OpenWOP is developed in the open on `github.com/openwop/openwop`. This page lists every place a question, design conversation, or bug report can land — and the cadence each channel runs on.

## Channels

| Channel | Use it for | Cadence |
|---|---|---|
| [GitHub Discussions](https://github.com/openwop/openwop/discussions) | Design questions, RFC comments, "is this the right way?" threads | Acknowledged within 5 business days per `MAINTAINERS.md` |
| [GitHub Issues](https://github.com/openwop/openwop/issues) | Bug reports, conformance failures, spec ambiguity | Acknowledged within 5 business days |
| [Security advisories](https://github.com/openwop/openwop/security/advisories/new) | Coordinated vulnerability disclosure | Acknowledged within 3 business days per `SECURITY.md` |
| Real-time chat | — | **Planned.** Subscribe to GitHub Discussions for now; the channel choice (Discord / Matrix / Zulip) is tracked in [ROADMAP.md](https://github.com/openwop/openwop/blob/main/ROADMAP.md). |

> **Why no chat yet?** A real-time channel announces "we're here" without proving "we're a standard." Until the working-group charter (RFC 0038) ratifies and at least one non-steward maintainer joins, GitHub Discussions is the canonical async channel — Discord would currently signal a product, not a protocol.

## Code of conduct

Every channel above runs under [`CODE_OF_CONDUCT.md`](https://github.com/openwop/openwop/blob/main/CODE_OF_CONDUCT.md). Enforcement and removal-for-cause processes live in [`MAINTAINERS.md`](/maintainers/) §"Removal for cause."

## RFC comment windows

When a new RFC opens (status `Draft`) it carries a comment window declared in the RFC body — 7, 14, or 30 calendar days depending on classification per [`GOVERNANCE.md`](/governance/) §"Spec change process." Subscribe to the [RFCs](/rfcs/) index to see windows open and close.

## Office hours

**Not yet scheduled.** The maintainer set is too small to run a recurring slot honestly. When the working-group charter ratifies, the first scheduled action is a public office-hours cadence — that change lands here and in `CHANGELOG.md` § Governance.

## Reporting

- **Spec ambiguity** → GitHub issue against `openwop/openwop`, label `spec`.
- **Conformance scenario failure** → GitHub issue, label `conformance`, attach the run log.
- **Schema break** → GitHub issue, label `schema`, attach the diff.
- **Security vulnerability** → private advisory only (never the public tracker). See `SECURITY.md`.

## Adopting OpenWOP

If you're shipping an OpenWOP-compatible host or workflow, open a PR adding a row to [`INTEROP-MATRIX.md`](/conformance/). The Independent-implementation tripwire under [ROADMAP.md](https://github.com/openwop/openwop/blob/main/ROADMAP.md) tracks third-party adoption explicitly.

## See also

- [Maintainers](/maintainers/) — who runs the project, what they gate, how recruitment works.
- [Governance](/governance/) — decision rules, role definitions, working-group path.
- [Contributing](/contributing/) — per-artifact change rules, the eight-step CI gate.
- [Code of Conduct](https://github.com/openwop/openwop/blob/main/CODE_OF_CONDUCT.md).
