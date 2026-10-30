# RFC 0256: the tool-turn contract

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0256                                                            |
| **Title**         | How a host admits model output: three channels, one admission order, trust that restricts approvers, tool-turn recovery and replay, and declared provider-executed tools |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-10-30                                                      |
| **Updated**       | 2026-10-30 — **filed and moved `Draft` → `Active` the same day, comment window waived by the maintainer** (user instruction 2026-10-30: "Waive the 7 day comment window"). STEWARD OVERRIDE of RFC 0147 §A.6, recorded in `MAINTAINERS.md`. |
| **Affects**       | `spec/v2/core/host-services.md` §`toolHooks`, §`aiProviders`; `replay.md`; `interrupt.md`; `tool-catalog.md`; `SECURITY/invariants.yaml`; `SECURITY/threat-model-prompt-injection.md`; conformance |
| **Compatibility** | `additive`, except §C, a Class 3 correction candidate because the prior text cannot be satisfied |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

Hosts reach models through tool calls, but the spec says little about that path. This RFC states what a host must do with model output, using what hosts already have: `logicalInvocationId`, the invocation log, the tool descriptor, the firewall and approval lanes. It adds no capability family: facets extend `toolHooks` and `aiProviders`. It stands alone and does not depend on RFC 0255.

## Motivation

Measured on openwop-app `7407073d0` by reading code. Thirteen model paths were enumerated; two were not fully checked.

| Gap | Evidence |
| --- | --- |
| `untrusted_content_blocks_approval` has no production thrower | Its only caller is inert unless a test seam is on (`a2uiSurfaceAdmission.ts:194`) |
| Truncated tool arguments become `{}` | No `finishReason` read in the tool loop; `safeParseArgs` (`:375`) |
| Tool arguments are validated after gates | `agentDispatch.ts:1425` |
| Crash recovery re-runs earlier tools | The sweeper re-dispatches; ordinals rewind; the live path never reads the log (`replayToolResults.ts:19`) |
| Text can become an executed tool | `parseInlineToolCalls`, fuzzy name match (`dispatchProviderTools.ts:26`). Zero uses in 30 days of production logs on `openwop-app-backend`, with a working control |
| The native-search effect row overstates its coverage | Guarded only at `headlessAi.ts:496`; a replay miss on a tools round with `webSearch` dispatches live |

ADR 1002 already serves tool results on a replay fork in the agent runner, and ADR 1001 already derives a turn's taint bit and limits who may approve. This RFC makes those the rule.

## Proposal

### §A Channels

A host MUST classify every structured model emission as one of:

- **`tool`**: a provider-native tool call;
- **`structured`**: provider-enforced schema output;
- **`prompted`**: output the host requested as JSON in text, because no enforced mode is available for that provider and request.

`prompted` output MUST be validated against the requested schema and MUST NOT be dispatched as a tool. Text that a model produced unrequested MUST NOT be treated as an emission. Text MUST NOT become an executed tool.

### §B Admission order

For a tool emission, in order: **completion** (classify clean, truncated, refused; truncated arguments are never executed; a refusal is not retried), **name**, **arguments** (validated before any gate), **trust** (§C), **authorization**, **limits**, **redaction**, **dispatch and record**.

A host MUST return one of `executed`, `refused`, `held`, `suppressed-repeat`, `ended-turn` or `invalid`. The corrective text in a repair MUST be host-authored from validator output.

### §C Trust restricts who may approve

A host MUST derive a turn's `contentTrust` as the meet of its inputs. It MUST ignore any trust or provenance value in model output. The coarsest conforming bit is "this turn consumed untrusted content".

When the bit is untrusted, an approval gate MAY still be presented, but it MUST be resolved only by the acting authenticated person bound to the interrupt, MUST NOT resolve through an emailed or delegated link, and MUST NOT resolve from model or tool content. This replaces the blanket refusal, which would disable approval after any read, the case `read-then-egress` exists to send to a human.

### §D Tool-turn recovery and replay

Scope: run nodes that execute a tool loop. Chat and voice turns are out of scope and hosts MUST say so.

Tool identity is the RFC 0150 `logicalInvocationId` with its per-node ordinal.

- A host MUST record each tool result before the next model round. A record failure MUST fail the node for a tool whose `replayPolicy` is not read-only.
- On `replay`, a host MUST serve recorded results and MUST NOT execute the tool. A miss fails the node with `replay_source_missing`.
- On same-attempt recovery, a host MUST serve recorded model rounds and tool results. Because tools run sequentially, the first unrecorded call of a recorded round is the only call in doubt. A host MUST re-run it when `replayPolicy` permits, and otherwise fail the node with `tool_outcome_unknown`.
- A new attempt is new execution: records MUST NOT be served to it, so a retry is not handed a transient failure.
- A result over the record size limit MUST be recorded as a digest with a truncation marker. On replay or recovery it is a miss.

`toolHooks.turnReplay` (boolean) advertises this. The record is the host's log, and no tool result is added to `agent.toolReturned`.

### §E Human input

A tool loop in a run that needs human input MUST be able to raise a `clarification` interrupt through a tool, bounded by `limits.clarificationRounds`. This RFC requires the behaviour and reserves no tool name. The ask ends the turn: earlier calls in the round finish first, and any held approval escalates before the ask. A provider or model with no tool support MUST receive a typed failure, not a guess. A host MUST map the interrupt to MCP `input_required` under the existing `mcp.mrtr` rows.

### §F Provider-executed tools

A host MUST list every provider-executed tool in the effect-seam manifest, MUST enforce suppression at the provider dispatch point on `replay`, and MUST treat its output as untrusted. A host MUST NOT delegate an MCP or A2A call to provider execution inside a run.

### §G Tool shape

Host tools SHOULD use the MCP result shape internally: `isError` for model-correctable failure, and `structuredContent` for data. `tool-catalog.md` descriptors carry `replayPolicy`, and this RFC depends on hosts populating it.

### Examples

**Positive.** A turn reads an email and then calls a write tool. The bit is untrusted, the call is held, the acting person approves in the app, and the tool runs.

**Negative.** A truncated `tools/call` argument executed as `{}`. A `prompted` output dispatched as a tool. An emailed link resolving an untrusted approval. A retry served a recorded transient failure.

## Compatibility

Additive for §A, §B, §D–§G, which state behaviour v2 left undefined. §C replaces a sentence a host cannot satisfy without disabling approval, so it is proposed as a Class 3 correction.

## Conformance

`v2-tool-admission-order`, `v2-turn-trust-approver`, `v2-tool-turn-replay`, `v2-tool-turn-recovery`, `v2-tool-clarification`, `v2-provider-tool-suppressed`. Each drives a run through the mock provider. A seam may script the model and MUST NOT call admission directly.

### Falsifiability

| Requirement | Observable | Who can cause it | Verdict |
| --- | --- | --- | --- |
| §B | `openwop.requirement.0256.admission-order` | the suite, mock provider | witnessable — gated |
| §C | `openwop.requirement.0256.trust-approver` | the suite, mock provider + second principal | witnessable — gated |
| §D replay | `openwop.requirement.0256.turn-replay` | the suite | witnessable — gated on `toolHooks.turnReplay` |
| §D recovery | `openwop.requirement.0256.turn-recovery` | a seam-gated crash point | witnessable — seam-gated |
| §E | `openwop.requirement.0256.clarification` | the suite | witnessable — gated |
| §F | `openwop.requirement.0256.provider-tool-suppressed` | the suite with a provider-tool fixture | witnessable — gated |

## Alternatives considered

0. **Let an adapter normalize inline tool syntax.** Rejected. It was never exercised in 30 days of production, and it is a path from model text to execution.
1. **A new `modelEmissions` family.** Rejected. It would hold facets `toolHooks` and `aiProviders` already own.
2. **Forbid all text parsing.** Rejected. It cannot be met: managed and several provider modes have no enforced output.
3. **A reserved `openwop:clarify` name.** Rejected. Behaviour is what interoperates; tool names are sanitized per provider anyway.
4. **A new content-addressed emission key.** Rejected. It duplicates `logicalInvocationId`.
5. **Block approval when trust is unknown or untrusted.** Rejected. It disables approval.
6. **Do nothing.** Rejected. These are live defects.

## Unresolved questions

None open. Decided 2026-10-30: delete the inline parser (§A); chat turns stay out of §D unless a real duplicate write is measured; oversized results follow §D's digest rule.

## Implementation notes (non-normative)

ADR 1009 (§C), ADR 1010 (§A, deleting the parser), ADR 1011 (§B, §D) and ADR 1012 (§F); ADR 1006 implements §E implement this on openwop-app. The security fixes do not wait for this RFC's status.

## Acceptance criteria

- [ ] Spec text and invariants merged; `check-core-budget` green.
- [ ] Scenarios in a published suite.
- [ ] A host certifies every witnessable row on a production tool loop.

## References

RFC 0041, 0064, 0143, 0150, 0173, 0198, 0208, 0255; openwop-app ADR 0341, 0531, 0553, 0635, 1001, 1002; MCP 2026-07-28 Tools.
