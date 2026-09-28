# RFC 0226: three run-failure codes the hosts share, registered

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0226                                                            |
| **Title**         | three run-failure codes the hosts share, registered             |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-28                                                      |
| **Updated**       | 2026-09-28 — **`Draft → Active`. Comment window waived** (7-day, 0 days elapsed, not run) by the steward under `GOVERNANCE.md` §"Sole-steward operation" (steward direction 2026-09-28: the maintainer waived the comment window), logged in `MAINTAINERS.md` §"Bootstrap-phase RFC waivers". RFC 0147 §A.6 does not apply: the RFC adds error-code vocabulary only. `sandbox_invocation_error` names a failure and changes no isolation guarantee, `mcp_error` classifies a peer's answer and changes no effect semantics, and no certification leg or verdict rule changes (the advisory `errors.event-code-registered` row is untouched). openwop-app's remap is ready (openwop-app #4202, `89d4d7f55`); its `invalid_config` → `node_config_invalid` switch follows this RFC. The evidence gate is not waived. · 2026-09-28 — filed `Draft`; the 7-day comment window for a normative addition opens with the pull request and closes 2026-10-05. The window is **not** waived. Merge also waits for openwop-app's remap to be measured (the v2 reference host's gap `openwop.gap.0171.8` closed on openwop-examples #126). |
| **Affects**       | `spec/v2/errors.json` (+3 rows, `since` 2.44; `capability_not_provided`'s `meaning` widened) · generated `schemas/v2/error-envelope.schema.json` and the `errors.md` table and count (108 → 111) · `spec/v2/core/errors.md` §Why this exists (one non-normative sentence removed for the RFC 0190 budget) · `RFCS/registers/0171-v2-wire-envelope.gaps.md` (G6/G7 rename lists; G8 closed on openwop-examples #126) |
| **Compatibility** | `additive` — three new registry members (`spec/v2/core/overview.md` §0: adding a member is additive in v2.x) and a widened `meaning` string. No shape, status or existing code changes |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

openwop #1698 made explicit that a run-failure code on `run.failed`, `node.failed` or the snapshot must be registered or a vendor code. Measuring the three v2 hosts against that rule found three failures they all produce, under different spellings: a node whose configuration is unusable, a sandboxed pack node that threw outside the sandbox catalog, and an MCP peer answering with a JSON-RPC error. This RFC registers the three as `node_config_invalid`, `sandbox_invocation_error` and `mcp_error`, and maps the hosts' other shared failures onto existing codes rather than minting new ones. It is a measured codification, in the manner of RFCs 0183 and 0186.

## Motivation

Measured at openwop-app `c4aad98c2`, MyndHyve `f73069edc` and openwop-examples `21e552e` (openwop #1698):

- **Unusable node configuration.** openwop-app emits `invalid_config` 13 times (for example `bootstrap/nodes.ts:2582`). MyndHyve emits `CONFIG_INVALID`, projected today as `myndhyve.config_invalid`. Both mean the same thing and neither is registered.
- **Sandbox fallback.** The corpus already names `sandbox_invocation_error` as the fallback for "thrown errors not in the canonical catalog" (`spec/v1/host-sample-test-seams.md:340`), and the suite's sandbox probe emits it. openwop-app emits it (`testSeam.ts:2160`). The v2 reference host renamed it to `example.sandbox_invocation_error` (openwop-examples #125) only because it was unregistered.
- **MCP peer error.** openwop-app (`mcpClient.ts:953`, `:1096`, `:1122`) and the v2 reference host (`mcp-client.ts:68`) both fail a node with `mcp_error` when the MCP server answers a JSON-RPC error.
- **Everything else maps to an existing code.** "This host cannot execute that node type" is `capability_not_provided`: MyndHyve's `NODE_TYPE_NOT_FOUND` and `MISSING_CAPABILITY`, and openwop-app's `host_capability_missing`, rename to it. Its `meaning` is widened to name that case.

## Proposal

### §A. Three rows in `spec/v2/errors.json` (`since` 2.44)

| Code | Status | Retriable | Meaning |
| --- | --- | --- | --- |
| `node_config_invalid` | 422 | false | A node's configuration is missing a required value or holds one the node cannot use, so the node failed. |
| `sandbox_invocation_error` | 422 | false | A pack node running in the sandbox threw an error outside the canonical sandbox catalog, so the node failed. |
| `mcp_error` | 502 | false | An MCP server the host called answered with a JSON-RPC error, so the node failed. |

- **Why 422 for the first two.** They end a node on a condition of the workflow or pack, not of the request. That is the registry's convention for run-ending codes (`run_timeout`, `approval_rejected`).
- **Why 502 for `mcp_error` (a v2 decision).** The host acted as a gateway to a peer it does not control, and the peer's answer was an error (RFC 9110 §15.6.3). A 422 would misattribute the failure to the workflow. The code is not retriable, because a JSON-RPC error is the peer's answer, not a transport fault. A transport fault reaching the peer stays a host-side condition. `mcp_unreachable` (a peer that could not be reached) is **not** registered: the v2 reference host emits it as the vendor code `example.mcp_unreachable` (openwop-examples #126), and a second host would have to emit it before a shared code is justified.
- **Why not register the renames.** A second code for "cannot execute this node type" would give clients two spellings of one state (`errors.md` §One code per state).

### §B. The core budget

The three generated table rows cost 9 words. The `errors.md` §Why this exists sentence "The registry is the single source for the envelope schema, the HTTP status and retriability." (15 words) is removed; §The registry already says the envelope is generated from the registry and that a host answers with the registered status. Net −6 (30,593 / 30,600).

## Compatibility

`additive` (overview.md §0: adding a member is additive in v2.x). A client that meets an unknown code already MUST accept it. A host that emits one of the three spellings above becomes conformant on that code, and a host still emitting its old spelling is as non-conformant as it was yesterday (gaps G6–G8).

## Conformance

No new leg. `openwop.requirement.errors.event-code-registered` (`v2-error-registry`, advisory) already reads every run-failure code against the registry, so a host emitting the three codes passes it once they are registered. The leg drives only `conformance-failure`. The MCP and sandbox paths are witnessed by their own families' scenarios, whose `node.failed` codes the leg does not see. That limitation is why G8's first closure was premature (openwop #1740, #1752).

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A the three codes are registered with their status and retriability | `spec/v2/errors.json`, the generated envelope, and the `errors.md` table | the corpus gates (`generate-error-envelope.mjs --check`, `v2-error-registry-prose-parity`) | claims-check (corpus) |

## Alternatives considered

1. **Leave them to vendor codes.** Three hosts would then carry three spellings of one failure (`openwop-app.config_invalid`, `myndhyve.config_invalid`, …), and a client routing on `error` would need a table per host. That is the problem the registry exists to prevent.
2. **Register the host spellings as-is** (`invalid_config`, `CONFIG_INVALID`). The registry's grammar is lower snake case, and the names should say what failed.
3. **Register `node_type_unsupported`.** Rejected in favour of `capability_not_provided` (§A).

## Unresolved questions

1. ~~Whether `mcp_unreachable` deserves its own code.~~ *Settled for this RFC (2026-09-28): no.* Only the v2 reference host emits it, as the vendor code `example.mcp_unreachable` (openwop-examples #126). A later RFC can register it if a second host measures the same failure.

## Implementation notes (non-normative)

The rename lists per host are in `RFCS/registers/0171-v2-wire-envelope.gaps.md` rows G6 (openwop-app) and G7 (MyndHyve). The v2 reference host's G8 closed on openwop-examples #126: `mcp_error` is `example.mcp_error` there until this RFC registers it, after which the host renames it back.

## Acceptance criteria

- [x] `Active` (2026-09-28): window waived by the steward (see Updated); openwop-app's remap is ready (openwop-app #4202); the rows land.
- [ ] `openwop.requirement.errors.event-code-registered` is a clean `executed-pass` (no partial-witness detail) on a certified bundle of each of the three hosts.

## References

- openwop #1698, #1721 (the rule these codes serve).
- `spec/v2/core/errors.md` §The registry; `spec/v2/core/overview.md` §0.
- `spec/v1/host-sample-test-seams.md:340`.
