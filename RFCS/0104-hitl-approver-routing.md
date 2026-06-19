# RFC 0104: Portable HITL approver routing

| Field             | Value                                                                                |
| ----------------- | ------------------------------------------------------------------------------------ |
| **RFC**           | 0104                                                                                 |
| **Title**         | Portable HITL approver routing (group/role refs + audience)                          |
| **Status**        | `Accepted`                                                                           |
| **Author(s)**     | David Tufts (@davidtufts)                                                             |
| **Created**       | 2026-06-19                                                                           |
| **Updated**       | 2026-06-19 — promoted `Draft` → `Active` (7-day additive window waived by steward authority), then `Active` → `Accepted` the same day on **dual independent non-steward host behavioral evidence** vs `@openwop/openwop-conformance@1.28.0` (`interrupt-approver-routing.test.ts`, 8/0/0 non-vacuous each, capability-gated live leg executed): **openwop-app** (`feat/hitl-approver-routing` → merged its main; advertises `interrupt.approverRouting:{supported:true,refKinds:["group","role"],audience:true}`) and **MyndHyve** (separate repo `github.com/myndhyve/myndhyve`, branch `feat/rfc-0104-approver-routing`; advertises `{supported:true,refKinds:["role","group"],audience:false}` — honestly-divergent `audience`, validating the structured capability). |
| **Affects**       | `spec/v1/interrupt.md`, `schemas/suspend-request.schema.json`, `api/asyncapi.yaml`, conformance `interrupt-*` scenarios, SDK interrupt types |
| **Compatibility** | `additive` per `COMPATIBILITY.md`                                                    |
| **Supersedes**    | —                                                                                    |
| **Superseded by** | —                                                                                    |

## Summary

HITL approval gates today advertise an **advisory** `approversList` of opaque subject refs (`interrupt.md`); enforcement and routing are entirely host-private. This RFC makes approver *routing* portable across conformant hosts by adding optional, still-advisory fields to the approval `InterruptPayload`: `approverGroupRefs`, `approverRoleRefs`, and an `audience` hint. It does **not** change how `approversList` is enforced (that stays host-side) — it lets a workflow definition authored once express "anyone in the finance-approvers group" or "whoever holds the Controller role" and have any host route/notify the same way. Step-up authentication and credential-bound (on-behalf-of) approvals are explicitly **out of scope** and tracked in a separate RFC.

## Motivation

A workflow author writing an accounting or compliance workflow needs to say *who* verifies a step — a named user, a group/team, or a role — and have the host notify the right human and surface the approval in their inbox. Today:

- Only individual subject refs can be expressed (`approversList`); group/role binding is unspecified, so a host that implements it (see openwop-app ADR 0075) does so non-portably — the same definition routes differently, or not at all, on another host.
- There is no wire-level hint of *who the approval is addressed to*, so cross-host notification/inbox targeting cannot be standardized.

The reference host (openwop-app) is shipping group/role routing host-side under ADR 0075. This RFC promotes the **wire shape** so the capability is portable and conformance-testable, rather than a private extension. It is the spec the host work rides once accepted; until then the host keeps it non-normative.

## Proposal

Extend the `kind: "approval"` `InterruptPayload` (`interrupt.md` §per-kind payloads, `schemas/suspend-request.schema.json`) with three **optional** fields:

```ts
interface ApprovalData {
  // ... existing fields ...
  approversList?: string[];        // existing — advisory subject refs
  requiredApprovals?: number;      // existing
  rejectionPolicy?: 'single-veto' | 'majority';  // existing

  approverGroupRefs?: string[];    // NEW (optional) — opaque group refs
  approverRoleRefs?: string[];     // NEW (optional) — opaque role refs
  audience?: {                     // NEW (optional) — routing hint, advisory
    subjects?: string[];
    groups?: string[];
    roles?: string[];
  };
}
```

Normative rules (to be written as RFC 2119 prose in `interrupt.md`):

- All three fields are **OPTIONAL** and, like `approversList`, **advisory**: they describe intended routing; the host remains the authority for eligibility enforcement at resolve time. A host MAY ignore them.
- Refs are **opaque** to the engine (host-resolved against its own identity/RBAC). The spec does NOT define group/role membership resolution — that is host-side (and dynamic; see openwop-app ADR 0075 D3 on live resolution + decision-time snapshot for replay).
- A host that advertises support MUST surface these fields unchanged on the `InterruptPayload` and SHOULD route notifications to the union of resolved subjects.
- Capability-gated: support is advertised via `/.well-known/openwop` (`capabilities.md`) under a new flag (e.g. `interrupt.approverRouting`). Hosts that don't advertise it are conformant and simply ignore the fields.

## Compatibility

**Additive.** No existing field changes type or optionality; no existing `MUST` is relaxed; `approversList`'s advisory semantics are unchanged. Old clients/hosts ignore the new optional fields (forward-compat per `COMPATIBILITY.md` §2.1). Historical run checkpoints replay unchanged (the new fields are absent). New conformance scenarios are capability-gated, so existing passes are unaffected.

## Conformance

- New capability-gated scenarios under `conformance/src/scenarios/` (e.g. `interrupt-approver-routing.test.ts`), citing `interrupt.md §<approver routing>`, that run only when `host.interrupt.approverRouting.supported`.
- Assert: the fields round-trip on the `InterruptPayload`; an advertising host preserves them; a non-advertising host is not failed for ignoring them.
- New fixtures added to `conformance/fixtures.md`.

## Alternatives considered

- **Leave it host-private (status quo).** Works for a single host (openwop-app ADR 0075) but isn't portable or conformance-testable — a workflow definition isn't reusable across hosts. Rejected for the portability goal; accepted as the interim state until this RFC lands.
- **Make `approversList`/group refs enforced (normative) rather than advisory.** Would relax/replace the existing advisory contract → a breaking change to hosts that treat `approversList` as advisory. Rejected; keep enforcement host-side.
- **Resolve group membership in the engine.** Would require the engine to model identity/RBAC — out of scope and a layering violation. Membership stays host-side.

## Unresolved questions

- Exact capability flag name + shape (`interrupt.approverRouting`?).
- Should `audience` be merged into the approver fields or kept as a distinct routing hint? (Drafted as distinct.)
- Segregation-of-duties (initiator ≠ approver): a wire concern or purely host policy? (Leaning host policy.)
- **Out of scope, separate RFC:** step-up authentication (`acr`/`amr`) at a sensitive gate, and credential-bound / on-behalf-of approvals (the approver acting on HR/finance/security with their own credentials). These touch `auth.md` + the secret-leakage threat model and need a SECURITY invariant + public conformance test.

## Implementation notes (non-normative)

Reference host: openwop-app ADR 0075 implements the routing host-side ahead of this RFC (refs in host-extension records, live-resolved against `accessControl`, decision-time membership snapshot for replay). On acceptance, the host promotes the refs onto the `InterruptPayload` and advertises the capability.

## Acceptance criteria

- [x] `interrupt.md` updated with the optional fields + advisory RFC 2119 prose (§"Portable approver routing (RFC 0104)").
- [x] `schemas/suspend-request.schema.json` adds the fields to the `ApprovalData` `$def` (the branch is an open object — no `additionalProperties: false` to preserve; the new `audience` object declares its own `additionalProperties: false`). AsyncAPI needs no change: `interrupt.requested` carries the generic `RunEventDoc` payload, not an inline `ApprovalData`.
- [x] Capability flag specified in `capabilities.md` + `capabilities.schema.json` (new top-level `interrupt.approverRouting = { supported, refKinds[], audience }`).
- [x] Capability-gated conformance scenario `interrupt-approver-routing.test.ts` (conformance 1.27.1 → 1.28.0). No JSON fixture file needed — payloads are built inline.
- [ ] SDK interrupt types updated — **follow-up in the [`openwop-sdks`](https://github.com/openwop/openwop-sdks) sibling repo** (the monorepo split moved the SDKs out; the spec corpus no longer carries SDK source).
- [x] CHANGELOG `[Unreleased]` entry (root + `conformance/CHANGELOG.md`).
- [x] 7-day additive comment window — **waived by steward authority** on 2026-06-19 (additive-only surface; reference-host implementation in flight under openwop-app ADR 0075). Promoted `Draft` → `Active`.

## References

- `spec/v1/interrupt.md` — interrupt payloads, advisory `approversList`.
- openwop-app `docs/adr/0075-hitl-approver-routing.md` — the reference-host implementation this RFC promotes.
- openwop-app `docs/adr/0070-quorum-review-policies.md` — quorum/rejection policy (deferred `approverGroupRefs`).
- `COMPATIBILITY.md` §2.1 — additive forward-compat.
- `capabilities.md` — capability advertisement.
