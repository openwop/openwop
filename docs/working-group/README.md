# OpenWOP Working Group

**Status: not formed. Nothing in this directory is operative.**

OpenWOP is governed today by the maintainer-driven model in [`GOVERNANCE.md`](../../GOVERNANCE.md), with the lead maintainer as tiebreaker. A working group replaces that model — but only when the project has actually outgrown it, and not a moment earlier.

The charter that will govern the working group is already written and reviewed: [`RFCS/0038-working-group-charter.md`](../../RFCS/0038-working-group-charter.md), at `Status: Draft`.

## Why the charter exists before the working group does

Governance written under pressure is written by whoever holds power at the time. Drafting the charter now — while the answer to "who chairs it" is nobody, and the drafter cannot know which seat they will occupy — is the only moment it can be written disinterestedly.

So the charter is complete: composition (§A), elections (§B), RFC voting (§C), registry policy ownership (§D), the activation tripwire (§E), the vendor-neutral org migration (§F), and term limits and succession (§G). **When the tripwire fires, ratification is mechanical rather than a negotiation.**

The RFC stays `Draft` by its own §E, and that is deliberate. `Active` would suggest a governance model somebody is following. **Nobody is following this one, because there is nobody to follow it yet.**

## The tripwire

All three conditions must hold (§E, tracked against [`GOVERNANCE.md`](../../GOVERNANCE.md) §"Path to working group"):

| # | Condition | Status today |
|---|---|---|
| 1 | At least **three independent organizations** have a maintainer in good standing (`MAINTAINERS.md`) | **Not met — one.** A single maintainer, one organization. |
| 2 | At least **two host implementations**, one of which is **not** the steward's reference, pass `@openwop/openwop-conformance` v1 | **Not met.** Adopters exist; the non-steward *maintainer* bar is what is unmet. |
| 3 | The maintainer set agrees by **lazy consensus** that the project has outgrown maintainer-driven governance | **Not reachable.** Lazy consensus among one person is not consensus. |

Condition 1 is the binding one. The other two cannot be assessed independently of it.

## What happens when it fires

Per §E, the lead maintainer at that time:

1. Posts a public ratification PR amending `GOVERNANCE.md` to replace §"Decision making" with the charter's §C.
2. Calls a Steering Committee election per §B.
3. **Hands the lead-maintainer role to the Steering Committee.**

Step 3 is the one that matters, and it is written to be irreversible by the person performing it.

## What this directory is not

It is **not** evidence of a working group, a steering committee, or multi-organization governance. OpenWOP has one maintainer. Any document, badge, or claim suggesting otherwise would be false, and RFC 0147 §A bans exactly that class of claim.

This directory holds the charter's public home so the tripwire has somewhere to point. It fills with real material — meeting minutes, election records, committee decisions — only if condition 1 is ever met.

## References

- [`RFCS/0038-working-group-charter.md`](../../RFCS/0038-working-group-charter.md) — the charter itself
- [`GOVERNANCE.md`](../../GOVERNANCE.md) §"Path to working group" — the tripwire conditions, and §37's forward-pointer to this charter
- [`MAINTAINERS.md`](../../MAINTAINERS.md) — the roster the tripwire counts, and the outreach log tracking condition 1
- [`ROADMAP.md`](../../ROADMAP.md) — the second-independent-host gate that condition 2 tracks
- [`docs/KNOWN-LIMITS.md`](../KNOWN-LIMITS.md) — GOV-8, the vendor-neutral org migration the working group would own
