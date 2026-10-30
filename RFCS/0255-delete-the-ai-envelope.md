# RFC 0255: delete the AI Envelope from v2

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0255                                                            |
| **Title**         | Delete the AI Envelope from v2, and license steward deletions through `corrections.json` while no outside host exists |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-10-30                                                      |
| **Updated**       | 2026-10-30 — **filed and moved `Draft` → `Active` the same day, comment window waived by the maintainer** (user instruction 2026-10-30: "Waive the 7 day comment window"). STEWARD OVERRIDE of RFC 0147 §A.6, recorded in `MAINTAINERS.md`. This RFC is `breaking`, so the window waived is the 30-day one; the instruction named 7 days and the waiver is recorded as the maintainer's intent to run none. Rewritten after trial deletions of the corpus and of openwop-app; the tool-turn contract moved to RFC 0256. |
| **Affects**       | **Deleted:** families `aiEnvelope`, `supportedEnvelopes`, `schemaVersions`, `envelopeStrictness`, `envelopeContracts`, `envelopes`, `a2uiSurface`; `schemas/v2/ai-envelope.schema.json`, `schemas/v2/envelopes/`, `a2ui-surface-delta-frame`; `limits.envelopesPerTurn`, `limits.schemaRounds`. **Changed:** `spec/v2/core/events.md`, `host-services.md`, `runs.md`, `versioning.md`, `capabilities.md`, `replay.md`, `persistence.md`, `overview.md`, `interrupt.md`; `spec/v2/corrections.json` and schema; `COMPATIBILITY.md` §3a; `GOVERNANCE.md`; `scripts/check-v2-retirement.mjs`, `check-v2-surface-monotone.mjs`, `derive-v2-schemas.mjs`, `derive-v2-api.py`; `SECURITY/invariants.yaml`; conformance |
| **Compatibility** | `breaking` by `COMPATIBILITY.md` §2.2; lands in a 2.x minor through §D |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

The AI Envelope (RFC 0021) is structured text a model emits and an engine parses. Hosts now reach models through provider tool calls and structured output. This RFC deletes the AI Envelope from v2, with no deprecation period, by extending the existing `corrections.json` licence with a steward-deletion class that exists only while no outside host does. Reasoning and reliability semantics move to `aiProviders` unchanged. The run event envelope, the error envelope and the persisted `envelope.*` reliability events stay. RFC 0256 states the contract for tool turns and is not a prerequisite for this deletion.

## Motivation

Measured 2026-10-30. openwop-app production runs `d1421077a`; `origin/main` is `7407073d0`.

| Fact | Evidence |
| --- | --- |
| Real traffic is tool calls | 203 `registerFeatureAgentTool` call sites |
| Two production envelope paths remain, both unused | Fenced `schema.request` (`agentDispatch.ts:1391`), and fenced `clarification.request` behind the `agent-clarification` toggle, default OFF (ADR 1001, `agentDispatch.ts:1341`). The census below found no use of either |
| Production census, 2026-10-30, read-only | Of 23,768 runs and 164,113 events: `envelope_correlations` 0 rows; 0 runs stamped for the clarification lane; 0 of 228 `invocation_log` rows carry a fenced kind (control 28); 4 stored `ui.a2ui-surface` events; 112 stored `envelope.*` reliability events |
| Live hosts advertise no catalog | `app.openwop.dev` and `myndhyve.ai` carry no `supportedEnvelopes` or `aiEnvelope` |
| The acceptor has defects | A model-written trust value overrides the host's; a reused `correlationId` returns "accepted" for an invalid payload; `schemaRounds: 3` admits 2 |
| The adopter surface is negligible | 2 stars, 0 forks on `openwop/openwop`; 2 downloads on the latest install release; `GOVERNANCE.md` already records no users outside the steward's organizations |

A deprecation period protects users, and there are none. Keeping the surface costs real maintenance: 34 envelope and A2UI scenarios, 182 requirement ids, and a kind of model output no maintained code should keep parsing.

MCP and A2A cannot be the replacement. A model emits a provider tool call; only the host speaks MCP, and A2A addresses peers. This RFC removes a channel and does not move it onto either protocol.

## Proposal

### §A What is deleted

| Surface | Disposition |
| --- | --- |
| Families `aiEnvelope`, `supportedEnvelopes`, `schemaVersions`, `envelopeStrictness`, `envelopeContracts`, `a2uiSurface` | Declaration rows become `anchor: "deleted"` tombstones, which `check-declaration` requires because v1 root keys remain |
| Family `envelopes` | Tombstoned. `reasoning`, `tierOneSubsetCompliance` and `reliability` move to `aiProviders` |
| `schemas/v2/ai-envelope.schema.json`, `schemas/v2/envelopes/`, `a2ui-surface-delta-frame` | Deleted, including derivation seeds in `derive-v2-schemas.mjs` and `derive-v2-api.py` |
| `limits.envelopesPerTurn`, `limits.schemaRounds` | Deleted. §C adds their replacements |
| All envelope kinds, `ctx.aiEnvelope`, `EnvelopeContract`, `envelopeType` in pack and workflow schemas, envelope-only error rows | Deleted |
| Invariants `prompt-injection-envelope-typecheck`, `media-asset-url-tenant-scoped` | Deleted with their surfaces |

**Stale text is deleted in the same change.** This covers at least `events.md:20,251,256`, `runs.md:104`, `versioning.md:116`, `capabilities.md:430`, `replay.md:65`, `persistence.md:104`, `overview.md:34,44,49`, `workflow-definition:244`, `node-pack-manifest:243`, `prompt-template:70` and `chat-card-pack-manifest:85`. The corpus gates do not catch these, so a tree-wide grep for each deleted name is an acceptance criterion.

**Not deleted.** The trigger `envelope`, the run event envelope, the error envelope, `limits.clarificationRounds`, and persisted payload enums such as `cap.breached.kind`. The event type `ui.a2ui-surface` stays readable, because 4 are stored, and is no longer emitted.

### §B Kept, and why

The six `envelope.*` reliability events stay under their names. They record provider truncation, refusal and retry on structured output, which remain real. Renaming them is possible through the codemap reader, but needs a new storage era for a cosmetic gain, so it is out of scope. `run-event-payloads` keeps them readable.

### §C Limits

`limits.maxToolRounds` and `limits.maxRepairRounds` are added as OPTIONAL facets. `maxToolRounds` is named for what hosts enforce: rounds, not calls. A required addition would be a restriction the §D licence does not cover, and is not needed.

### §D The steward-deletion class

`spec/v2/corrections.json` gains a row class `steward-deletion`. `check-v2-surface-monotone.mjs` already treats a corrections row as a removal licence.

> A row of class `steward-deletion` MAY remove a v2 surface, including a required one, in a 2.x minor. It MUST record the census of committed bundles carrying the surface, whatever that number is. It MUST NOT remove a reader for persisted data. A new row MUST be refused while `evidence/host-tiers.json` or the `INTEROP-MATRIX.md` v2 table names a tier-3 host, or a committed bundle comes from an origin neither lists. Existing rows are never re-judged.

Three gate changes are required. Each lands with a sabotage fixture.

1. `check-v2-retirement.mjs` rescans bundles through `bundlesCarrying` for every corrections row. Today a typed `bundles: 0` passes with 52 bundles carrying the surface, although the header claims the census is falsified there.
2. `check-v2-surface-monotone.mjs` refuses a same-release baseline change without a licence. Today deleting a surface and regenerating the baseline turns the gate green.
3. `requirements` gains a tombstone form, and `--write` refuses to drop an id silently. 182 ids are cited 149 times across 51 bundles.

Committed bundles are measurements at their own suite. They are not rewritten, and their validation against the newer schema is not a claim anyone relies on: 0 of 55 validate after this change, and no gate re-validates them.

`COMPATIBILITY.md` §3a and `overview.md` §0a gain this class. `GOVERNANCE.md` is amended: the "adopter-facing machinery is built even though no external adopter exists" rule does not apply to a steward deletion, and it resumes for all work when an outside host appears. "Evidence gates are never waived" is unchanged.

### §E Interrupt surfaces

`interrupt.md` gains a short section stating the rules for a declarative form on an interrupt: closed catalog, no code execution, actions resolve only that interrupt, no network egress, no secret input, and redaction. The `a2ui-*` invariants are renamed to `interrupt-form-*` and each gets a test against a fixture run. The invariants MUST NOT lose their only witness at any commit.

### Wire shape changes

```diff
- schemas/v2/ai-envelope.schema.json, schemas/v2/envelopes/*, a2ui-surface-delta-frame
  spec/v2/corrections.schema.json
+   class: steward-deletion, bundleCensus
  schemas/v2/capabilities.schema.json (generated)
-   aiEnvelope, supportedEnvelopes, schemaVersions, envelopeStrictness, envelopeContracts, envelopes, a2uiSurface
    aiProviders:
+     reasoning, tierOneSubsetCompliance, reliability
    limits:
-     envelopesPerTurn, schemaRounds
+     maxToolRounds?, maxRepairRounds?
```

### Examples

**Positive.** A `steward-deletion` row names `limits.schemaRounds`, records a census of 55, and removes the facet. Both gates pass.

**Negative.**
- The same row with a typed census of 0 fails.
- A row filed after a tier-3 host enters the matrix fails. A row filed before does not.
- A surface removed with no row fails, even if the baseline is regenerated at the same release.
- A row removing a persisted-event reader fails.

## Compatibility

**Breaking, by steward decision.** No outside host or known consumer exists. Published packs that require `aiEnvelope` fail `pack_peer_dependency_undefined`, so new pack versions without that peer are published before the suite. Persisted data: the census found no stored fenced emission, so no compatibility reader is built. The 4 stored `ui.a2ui-surface` events stay readable under the reader rule.

## Conformance

- **Deleted:** every scenario for a deleted surface. All seven `aiEnvelope.*` are major 1 and are already frozen history; the deletion affects the major-2 scenarios `v2-ai-envelope-advertisement`, `v2-envelope-contracts-advertisement`, `v2-envelopes-advertisement`, `v2-limits-envelope-caps-advertisement`, `v2-a2ui-v09-surface`.
- **New:** `v2-envelope-surfaces-absent` (unaided), `v2-provider-output-reliability` (structured output through the mock provider: truncation, refusal, recovery, reasoning), `v2-interrupt-form-rules`, and `check-steward-deletions` as a corpus gate.

### Falsifiability

| Requirement | Observable | Who can cause it | Verdict |
| --- | --- | --- | --- |
| §A absent | `openwop.requirement.0255.surfaces-absent` | the suite, unaided | witnessable — unaided |
| §D census | a typed census differing from the scan fails `check-v2-retirement` | any contributor | witnessable — unaided (corpus) |
| §D licence | an unlicensed removal fails, baseline regenerated or not | any contributor | witnessable — unaided (corpus) |
| §D tier-3 | a new row with a tier-3 host fails; an old row does not | any contributor | witnessable — unaided (corpus) |
| §E rules | `openwop.requirement.0255.interrupt-form-rules` | the suite with a fixture | witnessable — gated |

## Alternatives considered

1. **Deprecate and remove at 3.0.** Rejected by the steward.
2. **Cut 3.0 for this.** Rejected. It needs a new tree, path space and suite line to remove one feature.
3. **A new `steward-deletions.json` file.** Rejected after the trial. `corrections.json` is already a licence the gate reads, and a new file adds surface.
4. **Delete before porting the run-lane clarification.** Rejected. It would remove a shipped feature and its round cap, though the census shows it has never run.
5. **Keep `a2uiSurface`.** Rejected. Zero bundles carry it, and no producer feeds it.
6. **Do nothing.** Rejected.

## Unresolved questions

None open. Decided 2026-10-30: `v2-provider-output-reliability` uses `configurable.ai.mockProvider`, and a seam is added only if that cannot force a truncation. Published packs are fixed by new versions, with no `declaration.aliases` entry for `aiEnvelope`.

## Implementation notes (non-normative)

Order is in the openwop-app plan: census, stand-alone security fixes, corpus lane, run-lane port, pack versions, spec deletion and suite publish, one host PR with the pin, certified cut, sibling sweep, then a later table drop. `check-core-budget` falls from a 38,000 cap to 37,000 with five fewer homed families; the trial measured 37,493, so about 500 words must go beyond the deleted sections, more with §E.

## Prerequisites

- [x] Census of production, 2026-10-30 (see Motivation). Chat transcripts were not scanned; chat has no replay path that would read them.
- [ ] Run-lane clarification no longer uses an envelope: one host tool, `openwop:ask-user`, with `clarificationRounds` enforced and its schema generated from `CLARIFICATION_LIMITS`.
- [ ] New versions of `vendor.myndhyve.ai`, `.brand` and `.web-research` published without the `aiEnvelope` peer.

## Acceptance criteria

- [ ] `corrections` class, gate changes and sabotage fixtures merged; `GOVERNANCE.md` and `COMPATIBILITY.md` amended; waivers logged.
- [ ] Deletions merged; every deleted name absent from `spec/v2`, `schemas/v2`, `api/v2` and non-frozen scripts; `openwop:check` green apart from version-bump and cross-repo steps.
- [ ] Suite published; one PR on openwop-app bumps the pin and deletes the host code.
- [ ] A certified bundle on a deployed host carries `0255.*` at `executed-pass`. This is not waived.
- [ ] SDKs, examples, registry, site and adopters carry no deleted name.

## References

RFC 0021, 0030–0033, 0055, 0102, 0114, 0144, 0171, 0193, 0197, 0205, 0209; `COMPATIBILITY.md` §2.2, §3a; `GOVERNANCE.md`; openwop-app ADR 0858, 1001, 1002.
