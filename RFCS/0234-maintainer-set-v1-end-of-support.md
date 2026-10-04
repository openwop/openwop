# RFC 0234: an accepted RFC may set v1 end-of-support earlier than the computed date

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0234                                                            |
| **Title**         | an accepted RFC may set v1 end-of-support earlier than the computed date |
| **Status**        | `Accepted`                                                      |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-10-04                                                      |
| **Updated**       | 2026-10-04 — `Draft` → `Accepted` in the filing PR; **comment window waived** by STEWARD OVERRIDE of RFC 0147 §A.6 (MAINTAINERS.md) at the maintainer's direction. **Evidence tier: corpus gate — `v2-eos-clock.test.ts` proves §B in both directions; §A.1's traffic evidence is the host operators' own logs, recorded verbatim.** · 2026-10-04 — filed at the maintainer's direction (2026-10-04, in the steward session: "RFC, window waived, today"), relayed first from openwop-app's session. |
| **Affects**       | `spec/v2/core/overview.md` §v1 end-of-support (new leg (c); what a host may do after the date; the frozen old-major tree) · `spec/v2/core/versioning.md` §5 Retirement · `scripts/generate-v1-eos-clock.mjs` (reads `spec/v2/eos-override.json`) · `scripts/check-removal-dates.mjs` (RFC files are history; a frozen tree satisfies a passed date) · `spec/v1/end-of-support.json` (new marker) · `evidence/v1-end-of-support.json` (regenerated) |
| **Compatibility** | `breaking` for v1 consumers (COMPATIBILITY.md §2.2: it ends early the overlap MUST that a host serve both majors), with no v2 wire change: no field, endpoint, event or error code changes. The 12-month old-major retention floors (to 2027-09-05) are unchanged, so 1.x stays installable. |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

`overview.md` computes the v1 end-of-support date from the matrix (90 days after every counted host's first non-vacuous v2 bundle; 18 months after v2.0.0 when an independent host is counted) and says nothing else may set it. Today that date is 2026-12-04. This RFC adds a third leg: an `Accepted` RFC may set an earlier date once every counted host is certified at v2 and reports no third-party old-major traffic for at least 7 days. It also says what the date means: from it a host *may* retire v1, without being required to that day, and the v1 tree in the corpus is frozen as history rather than edited. It applies the leg once, setting the date to 2026-10-04.

## Motivation

**The overlap has done its job for the counted hosts.** All three counted hosts carry certified, non-vacuous v2 bundles in `evidence/v2-host-bundles/`:
- the v2 reference host (anchored 2026-09-05);
- MyndHyve (anchored 2026-09-05; certified cuts through 2.45.10);
- openwop-app (anchored 2026-09-05; its 2.45.12 production cut certifies with 0 blocked).

v2 is published at 2.45.x, with v2-native SDKs (2.5.0) and CLI.

**The computed date has no lever for "earlier".** Leg (a) is a floor that protects third parties who need time to migrate. When the stewarded hosts measure no third-party v1 use at all, the floor protects nobody, and the corpus still cannot end support.

**Measured, not assumed** (7 days to 2026-10-03, each host's own logs):

| Host | Conformance / seam / operator | First-party clients | Third-party clients |
| --- | --- | --- | --- |
| v2 reference host | all (it is a reference example, not a public deployment) | none | none |
| openwop-app | 9,997 conformance-suite and seam requests | 1: its own Gmail OAuth return to the registered `/v1/host/openwop-app/...` redirect URI | 0 protocol clients and 0 SDK or CLI callers. 4 header-less reads of `/.well-known/openwop` (3 by Meta's AI crawler, 1 by a person in Chrome) are not protocol clients, and after the cut they receive the v2 document with `200` |
| MyndHyve | ~3,564 suite, seam and operator requests; ~31 scanner probes (404s, not OpenWOP clients) | 418 browser reads of its own node-pack catalog (`/packs/v1/...`); 57 calls from its own Cloud Function to `/v1/resume` | 0 (no SDK or CLI client identified) |

MyndHyve still has first-party production traffic on `/v1`: 10 roots have no major-2 twin. That is why the date only *permits* retirement (§A.2). MyndHyve keeps serving `/v1` to its own clients until it migrates them. Header-less major-1 requests on unversioned paths are not measurable from request logs, and the RFC says so rather than counting them as zero.

## Proposal

### §A. `overview.md` §v1 end-of-support

1. **Leg (c).** An `Accepted` RFC MAY set an earlier date once every counted host has a certified non-vacuous v2 bundle in `evidence/v2-host-bundles/` and reports no old-major traffic from third parties (anyone but the host's operator and the conformance suite) over at least the 7 days before the RFC. The date and that evidence are in `spec/v2/eos-override.json`. "Nothing else MAY set it" stays.
2. **After the date** a host MAY drop the old major from `protocolVersions[]`; it is not required to that day. `versioning.md` §5 Retirement says the same.
3. **The old-major tree** (`spec/v1/`, the flat `schemas/`) is read-only (`versioning.md` §3). At the date it is frozen as history by `spec/v1/end-of-support.json` naming the date, not edited token by token.

### §B. The gates

1. `generate-v1-eos-clock.mjs` honours `spec/v2/eos-override.json` only when it names an `Accepted` RFC, sets a date earlier than the computed one, carries traffic evidence, and every counted host is anchored. Anything else fails the generator. A silently ignored override would print a date nobody set.
2. `check-removal-dates.mjs`:
   - An `RFCS/` source is history, never a failing old-major source. An `Accepted` RFC's text is not edited.
   - On or after the date, an old-major source passes only when `spec/v1/end-of-support.json` names that date.

### §C. Applying (c)

`spec/v2/eos-override.json` sets **2026-10-04**, citing this RFC and the traffic table above. `evidence/v1-end-of-support.json` is regenerated; `spec/v1/end-of-support.json` freezes the v1 tree at that date.

### Falsifiability

| Requirement | Observable | Who can cause it | Verdict |
| --- | --- | --- | --- |
| §B.1 an override that does not meet (c) is refused | `generate-v1-eos-clock` exits non-zero with "not honourable" | the corpus gate (`v2-eos-clock.test.ts`, three refusal cases) | witnessable — corpus gate |
| §B.2 a frozen tree satisfies a passed date; a marker naming another date does not | `check-removal-dates` exit status and printed clock state | the corpus gate (`v2-eos-clock.test.ts`) | witnessable — corpus gate |
| §B.2 an RFC file is never a failing old-major source | no failure names an `RFCS/` file | the corpus gate (`v2-eos-clock.test.ts`) | witnessable — corpus gate |
| §A.1 the traffic evidence is true | each host's own request logs | the host operators | unwitnessable — operator logs are not on the wire; the evidence is the operators' signed-off report, recorded verbatim |

## Compatibility

- **No wire change.** No field, endpoint, event or error code changes.
- **What changes is the obligation's end date.** From 2026-10-04 no host is required to serve v1. A host that keeps serving it remains conformant for its v2 surface.
- **Unchanged:** the retention floors (`overview.md` §Old-major retention floors), so a consumer pinned to 1.x can still install and rebuild until 2027-09-05.

## Alternatives considered

1. **Keep the computed date (2026-12-04).** The safe default. The maintainer chose to end support now on the measured evidence.
2. **Let a host retire v1 on its own before the date.** `versioning.md` §5 forbids it ("through the overlap a host MUST advertise both majors"), and it would let one host decide for an ecosystem.
3. **Require nil traffic of every kind, first-party included.** MyndHyve's own pack catalog and approval-resume use `/v1`, so the date could never move while it migrates. And because the date only permits retirement (§A.2), those first-party clients are not put at risk. The steward judged third-party traffic the right test, and records here that the definition was settled after MyndHyve's numbers were seen.
4. **Edit the deprecated tokens out of the v1 tree.** That contradicts `versioning.md` §3 (read-only) and would rewrite `Accepted` RFC text.

## Decisions

The maintainer decided the route on 2026-10-04: an RFC, window waived, date today. An `/architect` review settled the mechanism:
- leg (c) as above, with its traffic criterion defined as third-party;
- the date permits retirement but does not force it;
- the old-major tree is frozen, not edited, and RFC files are history.

## Implementation notes (non-normative)

- **openwop-app:** migrating `@openwop/cli` (806 `/v1` calls) to v2 before it flips `OPENWOP_V1_RETIRED`.
- **MyndHyve:** keeps v1 for its own clients until its 10 v1-only roots have v2 homes; its maintainer decides its cut.
- **The reference host:** may drop v1 at its next cut.

## Acceptance criteria

- [x] `overview.md` §v1 end-of-support and `versioning.md` §5 amended; `spec/v2/eos-override.json` and `spec/v1/end-of-support.json` committed; `evidence/v1-end-of-support.json` regenerated reading 2026-10-04.
- [x] `v2-eos-clock.test.ts` proves the override refusal, the frozen tree and RFC history in both directions.
- [x] `CHANGELOG.md` records it.

## References

- `spec/v2/core/overview.md` §v1 end-of-support, §Old-major retention floors; `spec/v2/core/versioning.md` §3, §5.
- RFC 0174 §B.4 (the clock), RFC 0178 §A.2 (removal dates), RFC 0197 (in-major retirement).
- The hosts' 7-day traffic reports, 2026-10-03/04: openwop-app-5f; myndhyve-14.
- Registers: [`gaps`](./registers/0234-maintainer-set-v1-end-of-support.gaps.md), [`risks`](./registers/0234-maintainer-set-v1-end-of-support.risks.md).
