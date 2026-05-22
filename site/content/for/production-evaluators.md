# For production evaluators

You're deciding whether OpenWOP fits your durability, security, interop, and operational requirements before you bet a production system on it. This page is the honest summary of what the protocol guarantees, what the reference hosts demonstrate, and what's explicitly out of scope.

## The shortest honest pitch

OpenWOP is an open wire-level protocol for multi-agent workflow orchestration. The spec is FINAL v1; the evolution policy is additive-only within v1.x; five host implementations exist in the public conformance leaderboard; the protocol is licensed Apache 2.0 with no patent or field-of-use restrictions.

If your evaluation criteria are "is this real, is it stable, can my team take it over if the steward disappears, and is it defensible against an audit" — this page is for you.

## Read these first

- [Production profile](/spec/v1/production-profile.html) — the canonical predicate set for hosts that claim production posture. Operational-readiness, NOT throughput.
- [Positioning &amp; non-goals](/spec/v1/positioning.html) — what OpenWOP is and explicitly isn't.
- [Versioning &amp; compatibility](/versioning/) — the four versioning axes and the rules they enforce.
- [Security posture](/security/) — threat model, disclosure policy, public invariants.
- [Governance](/governance/) — how decisions get made, the bootstrap-phase amendment, the path to a cross-vendor working group.

## What v1 guarantees

| Guarantee | Source | How it's verified |
|---|---|---|
| Additive-only evolution within v1.x | [`COMPATIBILITY.md`](/versioning/) §2 | RFC review window; CI gate `npm run openwop:check` |
| Safety-fix disclosure window | [`COMPATIBILITY.md`](/versioning/) §3, [`SECURITY.md`](/security/) | 90-day public window OR embargoed advisory per disclosure policy |
| Cross-host portability | [Profiles](/profiles/) + [Conformance](/conformance/) | Black-box scenario suite runs against every claimed host |
| BYOK secret non-leakage | [`SECURITY/invariants.yaml`](/security/) SR-1 | Public conformance test on every protocol-tier host |
| Cross-tenant memory isolation | [`agent-memory.md`](/spec/v1/agent-memory.html) + CTI-1 invariant | Public test; mechanically verified on the Postgres reference host |
| Replay determinism | [`replay.md`](/spec/v1/replay.html) | Fork-from-checkpoint scenarios in the conformance suite |
| Signed webhook delivery | [`webhooks.md`](/spec/v1/webhooks.html) | HMAC-SHA256({ts}.{body}); replay-attack-resistant verification recipe |

## What's explicitly out of scope

- **Runtime SLA.** OpenWOP defines the protocol, not the host's uptime. Your host vendor (or your own host) owns that.
- **Throughput claims.** The `openwop-production` profile is operational-readiness (backpressure, retention, claim acquisition) — NOT a throughput floor. A single-`pg.Client` Postgres host can pass production-profile while serializing writes.
- **A managed service from the OpenWOP project.** The protocol is open; the reference hosts are reference implementations. There is no hosted, paid offering from the steward at this time. See [Roadmap](/roadmap/).
- **Lock-in protection across major versions.** v1.x is additive; v2 is unscheduled and may break. If your evaluation requires guaranteed forward compatibility past v1, that's a custom commitment your vendor would need to make.

## The leaderboard

[/conformance/](/conformance/) is the public record of which hosts implement which profiles, with the pass/fail/skip counts against the conformance suite. Read it cynically. Specifically:

- **Postgres reference**: claims the production profile end-to-end with mechanical proof. Recent measurement: 781/850 (91.9% total, 96.4% applicable).
- **Python reference**: 700/788 = 100% of applicable scenarios pass. Honest about NOT claiming `openwop-audit-log-integrity` (stdlib lacks Ed25519).
- **SQLite reference**: 669/731, zero failures, claims interrupt + audit-log + auth-rotation profiles.
- **In-memory reference**: dev-tier; passes the core profile.
- **MyndHyve (third-party)**: passes the `ai-envelope-shape` scenario class (18/18). NOT the full suite — this is partial third-party coverage and the leaderboard reflects it honestly.

## Security posture in one paragraph

Every protocol-tier MUST-NOT in [`SECURITY/invariants.yaml`](/security/) has a corresponding public conformance test, enforced at merge time by [`scripts/check-security-invariants.sh`](https://github.com/openwop/openwop/blob/main/scripts/check-security-invariants.sh). 56 protocol-tier invariants tracked at the time of this writing. New invariants land alongside the RFC that introduces them. The threat models for secret leakage, prompt injection, node-pack supply chain, provider policy, and auth profiles are all public under [`SECURITY/`](https://github.com/openwop/openwop/tree/main/SECURITY) on GitHub.

## Governance posture

OpenWOP is a single-steward project today, with the bootstrap-phase amendment (`GOVERNANCE.md`) explicitly documenting one-approval review until a non-steward maintainer is named. The roadmap commits to a cross-vendor working group as v1 matures; that's an open governance question, not a closed one. If your evaluation requires multi-vendor governance today, that's worth raising as a deal-breaker now rather than later — see [Governance](/governance/) for the current state.

## Questions worth raising in your eval

These are the questions a careful evaluator should ask. They're easier to answer up front than after the contract is signed.

1. Which OpenWOP host will we run? Are we self-hosting, paying a vendor, or both?
2. Which profiles does that host claim, and does the leaderboard back the claim?
3. What's our migration path if the host vendor stops supporting OpenWOP?
4. How do we get notified about safety-fix advisories? (Answer: [GitHub releases on openwop/openwop](https://github.com/openwop/openwop/releases).)
5. What's our policy if a v2 lands and v1 is deprecated?

## Next steps

| Action | Where |
|---|---|
| Read the production profile | [/spec/v1/production-profile.html](/spec/v1/production-profile.html) |
| Audit the leaderboard | [/conformance/](/conformance/) |
| Review the security posture | [/security/](/security/) |
| Review the versioning policy | [/versioning/](/versioning/) |
| Open a question | [GitHub Issues](https://github.com/openwop/openwop/issues) |
