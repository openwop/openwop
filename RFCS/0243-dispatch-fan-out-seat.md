# RFC 0243: parallel fan-out has a v2 seat, and a link key needs both linking lanes

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0243                                                            |
| **Title**         | parallel fan-out has a v2 seat, and a link key needs both linking lanes |
| **Status**        | `Accepted`                                                      |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-10-12                                                      |
| **Updated**       | 2026-10-14 — gap G2 closes: openwop-app's certified production cut on published suite 2.46.6 (`evidence/v2-host-bundles/openwop-workflow-engine-2.46.6-44960bca5.json`, build `commit:44960bca5`, signed `openwop-app-bundle-2`, 444 pass / 0 fail) records `openwop.requirement.0243.max-fan-out-waves`, `openwop.requirement.0243.per-item-input-gated` and `openwop.requirement.agents.dispatch-per-item-length-mismatch` `executed-pass`. Still owed: the RFC 0156 §B review. · 2026-10-13 — **`Active → Accepted`, provisional pending the RFC 0156 §B retrospective review** (STEWARD OVERRIDE of RFC 0147 §A.6, register row `not-reviewed`). Evidence tier: tier-1 on both halves. §A: openwop-app (steward production host) advertises `agents.fanOut` and refuses the race fixture at `createRun` (openwop-app #4749); its certified cut on published suite 2.46.4 (`evidence/v2-host-bundles/openwop-workflow-engine-2.46.4-8d2adcbe8.json`, build `commit:8d2adcbe8`, signed `openwop-app-bundle-2`, 440 pass / 0 fail) records `openwop.requirement.0243.fan-out-needs-dispatch` and `openwop.requirement.0243.unadmitted-fan-out-refused` `executed-pass`, and the refusal row fails with the host's guard removed. §B: the v2 reference host's certified public cut on 2.46.4 (`evidence/v2-host-bundles/openwop-host-v2-reference.json`, build `commit:89a8931f`, witness `389392fc5c93`, signed `v2-reference-4`, 536 pass / 0 fail, all three claimed profiles certified) records `openwop.requirement.0243.subject-link-key-needs-both-lanes` `executed-pass`. G1 closes; G2's gate is met and it moves to TODO. The 2.46.4 release note predicted the fan-out rows `inapplicable` everywhere; that was wrong for a host listing every packaged fixture (corrections log, 2026-10-13). · 2026-10-13 — gap G1's witness is a production host: the leg runs only where `agents.dispatch: true` is advertised, and the v2 reference host advertises no `dispatch` (openwop-app is the candidate; the register row is rewritten when G1 closes). · 2026-10-12 — `Draft` → `Active` in the filing PR, comment window waived by the maintainer (2026-10-12: "Waive the comment window"), recorded as a STEWARD OVERRIDE of RFC 0147 §A.6 in MAINTAINERS.md. §A and §B are merged with suite 2.46.4. Filed after the `/architect` review of 2026-10-12 found four v2 discovery gaps (openwop-app #4676, ADR 0858, ADR 0812). Suite 2.46.3 carried the two that needed no new rule; this RFC carries the two that do. |
| **Affects**       | `spec/v2/facets/agents.schema.json` (one optional facet, `fanOut`) · `spec/v2/declaration.json` (`agents.facets[]`) · `schemas/v2/capabilities.schema.json` (generated) · `schemas/v2/dispatch-config.schema.json` and `schemas/v2/orchestrator-decision.schema.json` (descriptions) · `spec/v2/core/execution.md` §agents (the facet table) · `spec/v2/core/identity.md` §3 · fixture `conformance-dispatch-fanout-race` · new `conformance/src/scenarios/v2-agents-fan-out.test.ts` · `v2-auth-subject-link-key.test.ts` (a second leg) |
| **Compatibility** | `additive` (COMPATIBILITY.md §2.4): one optional facet on the closed `agents` record. No field is renamed, removed or narrowed, and no MUST relaxes. §B adds a MUST NOT that no host's live advertisement breaks today (§Compatibility). |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

At v1, a host said which parallel fan-outs it could run: `capabilities.dispatch.fanOutPolicies`, `joinModes`, `onChildFailureModes`, `maxFanOut` and `perItemInput` (RFCs 0118, 0126). The closed v2 `agents` record kept only `dispatch`, a boolean, so a v2 host cannot advertise parallel fan-out at all, and the rule that refused a join mode the host does not implement lost its gate. This RFC gives the descriptor a v2 seat, `agents.fanOut`, and names where its refusal is observed: v2 has no registration endpoint, so the observable is `createRun`. It also closes the converse of the `identity.md` §3 rule suite 2.46.3 began to witness: a host MUST NOT advertise `auth.subjectLinkKey` without both the `saml` and `scim` lanes.

## Motivation

openwop-app's v2 discovery review (#4676, ADR 0858) found that `dispatch-config.schema.json` still describes `fanOutPolicy: 'parallel'`, `joinPolicy` and `maxConcurrency`, and `orchestrator-decision.schema.json` still describes `nextWorkerInputs`, but nothing in a v2 capability record says whether a host runs them. Suite 2.46.3 corrected the descriptions to say what follows today: with no seat, a v2 host refuses `parallel` and `nextWorkerInputs`. That is honest, but it means no v2 host can offer the RFC 0118 surface, however well it implements it.

The same review (ADR 0812) found that `identity.md` §3 says both linking lanes imply the link contract, and that the key names its class, but says nothing about a key advertised with one lane. A key names a link contract; the link contract is the `saml` decision path consulting a link formed from `scim`. A key without both lanes promises a link the host cannot form. Twenty committed openwop-app bundles advertise `opaque-idp` without `saml`. Its live advertisement no longer does (lanes `api-key`, `session`, `anonymous`, `oidc`, no key; read 2026-10-12).

## Proposal

### §A. `agents.fanOut`

One optional facet on `agents`, in `spec/v2/facets/agents.schema.json`. Its description is the rule; this section summarizes it and does not restate it.

```json
"fanOut": {
  "type": "object", "additionalProperties": false,
  "required": ["joinModes", "onChildFailureModes"],
  "properties": {
    "joinModes":           { "type": "array", "minItems": 1, "uniqueItems": true, "items": { "enum": ["wait-all", "quorum", "first", "race"] } },
    "onChildFailureModes": { "type": "array", "minItems": 1, "uniqueItems": true, "items": { "enum": ["collect", "fail-fast", "absorb"] } },
    "maxFanOut":           { "type": "integer", "minimum": 1 },
    "perItemInput":        { "type": "boolean", "default": false }
  }
}
```

- **A.1** The facet's presence is the claim that the host runs `fanOutPolicy: 'parallel'`; there is no `fanOutSupported` and no `fanOutPolicies`. `sequential` and `reject` need no advertisement. A host MUST NOT advertise `fanOut` without `agents.dispatch: true`.
- **A.2** A host MUST refuse a workflow whose `core.dispatch` node pins what the facet does not admit (`parallel` with the facet absent, a `joinPolicy.mode` outside `joinModes`, a `joinPolicy.onChildFailure` outside `onChildFailureModes`) with `validation_error`, and `details.requiredCapability` names the seat it lacks. It MUST refuse when it loads the workflow, as the 2.46.3 descriptions already say. Where such a workflow is nonetheless readable through `getWorkflow`, `createRun` naming it MUST return `400 validation_error` with that `details.requiredCapability` and create no run.
- **A.3** `maxFanOut` keeps its v1 meaning: effective concurrency is `min(config.maxConcurrency ?? ∞, maxFanOut ?? ∞)`, dispatched in waves, never dropping a child.
- **A.4** Without `perItemInput: true`, a non-empty `nextWorkerInputs` fails the dispatch node with `validation_error` and dispatches no child (the 2.46.3 rule, now gated on a seat that exists).

Positive: `{ "dispatch": true, "fanOut": { "joinModes": ["wait-all"], "onChildFailureModes": ["collect"], "maxFanOut": 8 } }`. Negative: `{ "fanOut": { "joinModes": [] , "onChildFailureModes": ["collect"] } }` fails the schema (`minItems`), and `{ "dispatch": false, "fanOut": { … } }` fails A.1.

### §B. `auth.subjectLinkKey` needs both lanes

`identity.md` §3 now reads: "Advertising both `saml` and `scim` lanes implies the link contract: the host MUST then advertise `auth.subjectLinkKey` (`opaque-idp | configured-immutable`), and MUST NOT otherwise." The edit is word-neutral against the core budget (37,999 / 38,000).

## Compatibility

`additive`. §A adds an optional property to a closed object, which COMPATIBILITY.md §2.4 allows within a major. A host that does not advertise `fanOut` is in the position 2.46.3 already described. A.2's `createRun` clause gives the existing load-time MUST an observable fallback; it relaxes nothing.

§B is a new MUST NOT. It is not carried by the schema: forbidding a property unless two array members are present is a conditional the schema cannot add within a major (COMPATIBILITY.md §2.4), so the suite carries it, as RFC 0210 §C did. A committed bundle stays a valid measurement at the suite it was cut on (§2.3); the twenty openwop-app bundles are reported, not re-judged. No host's live advertisement breaks the rule today.

## Conformance

- `v2-agents-fan-out` (new): A.1 from discovery (`agentsFanOutDispatchLeg`), and A.2 against the seeded fixture `conformance-dispatch-fanout-race` (a `parallel` dispatch with a `race` join and `collect`). The leg runs on a host advertising `agents.dispatch: true` that does not admit that dispatch and lists the fixture in discovery `fixtures`; a fixture `getWorkflow` answers `404` for is `inapplicable`.
- `v2-auth-subject-link-key`: a second leg for §B (`authSubjectLinkKeyLanesLeg`).
- Self-tests in `lib/family-advert-witness.test.ts` (wave 5).

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.1 no `fanOut` without `dispatch: true` | the discovery record | the host's own advertisement; the suite reads it (`openwop.requirement.0243.fan-out-needs-dispatch`) | witnessable (claims-check) |
| §A.2 refusal at load | nothing: v2 has no registration endpoint, and seeding is implementation-specific | the operator, by seeding | **unwitnessable from outside.** A fixture refused at load is indistinguishable from one never seeded, so the leg records `inapplicable`, not pass. |
| §A.2 refusal at `createRun` | `400 validation_error` with `details.requiredCapability`, and no run | the suite, given the seeded fixture (`openwop.requirement.0243.unadmitted-fan-out-refused`) | witnessable-gated (fixture) |
| §A.3 `maxFanOut` waves | the children's `node.dispatched` → terminal windows over a live fan-out never overlap more than the ceiling, and none is dropped | the suite, on a host advertising `fanOut` that lists `conformance-dispatch-fanout-waves` (`openwop.requirement.0243.max-fan-out-waves`) | witnessable-gated (fixture) |
| §A.4 `nextWorkerInputs` without `perItemInput` | the dispatch node fails `validation_error`, no child run; with it, each child's `run.inputs` carries its item | the suite, through fixtures whose supervisor emits a `mockDispatchPlan` (`openwop.requirement.0243.per-item-input-gated`) | witnessable-gated (fixture) |
| §B no key without both lanes | the discovery record | the host's own advertisement (`openwop.requirement.0243.subject-link-key-needs-both-lanes`) | witnessable (claims-check) |

## Alternatives considered

1. **Do nothing.** The 2.46.3 descriptions are honest, but they leave RFC 0118 unofferable at v2, and an implementer reading `dispatch-config` finds a surface no host may advertise.
2. **Restore v1's `dispatch.fanOutSupported` + `fanOutPolicies` verbatim.** A `supported` boolean is the shape v2 retired (RFC 0192 §B), and `fanOutPolicies` restates what presence already says.
3. **Put §B in the schema** (`if not both lanes then not required subjectLinkKey`). A conditional the schema did not have is a major change (§2.4); it waits for 3.0, with the other conditionals TODO.md books there.
4. **Observe A.2 through a new seam.** A seam would make the load-time refusal causable, but a seam-only witness does not close a requirement on a host without seams (`conformance.md` §Witness class), and `createRun` already gives an unaided observable.

## Unresolved questions

None outstanding at `Active`. G1 and G2 in the gap register record what `Accepted` needs.

## Implementation notes (non-normative)

A host that implements RFC 0118 at v2 advertises `fanOut` with the modes it runs. A host that does not need do nothing new unless it seeds `conformance-dispatch-fanout-race`: then its loader refuses the fixture, or its `createRun` does. The v1→v2 mapping (`capabilities.dispatch.*` → `agents.fanOut.*`) cannot be a migration row, because v1 rows live in the frozen `spec/v1/migrations.json`.

## Acceptance criteria

- [x] Spec text merged (the facet description, `identity.md` §3, the `execution.md` facet table).
- [x] Schema updated (`agents.schema.json`, generated `capabilities.schema.json`, the two description edits).
- [x] Conformance scenarios covering the new surface (`v2-agents-fan-out`, `v2-auth-subject-link-key`).
- [x] CHANGELOG entry under suite 2.46.4.
- [x] A certified major-2 bundle records `openwop.requirement.0243.unadmitted-fan-out-refused` `executed-pass` from a host advertising `agents.dispatch: true` that seeds the fixture (G1; the v2 reference host advertises no `dispatch`, so this is a production host), and `0243.subject-link-key-needs-both-lanes` `executed-pass` on a certified bundle from a host advertising `subjectLinkKey` (the v2 reference host; openwop-app advertises no key, so the row is `inapplicable` there). *(2026-10-13: openwop-app's certified 2.46.4 cut, build `8d2adcbe8`, records both §A ids `executed-pass`; the v2 reference host's certified 2.46.4 public cut, build `89a8931f`, records the §B id `executed-pass`.)*

## References

- RFC 0118 (parallel fan-out and join), RFC 0126 (per-item input), RFC 0022 (`dispatchMapping` refusal shape), RFC 0164 §A.3, RFC 0192 §B, RFC 0210 §C.
- `spec/v2/facets/agents.schema.json` §fanOut, `spec/v2/core/execution.md` §agents, `spec/v2/core/identity.md` §3.
- openwop-app #4676, ADR 0858, ADR 0812.
