# RFC NNNN: <Title>

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | NNNN                                                            |
| **Title**         | <Short descriptive title>                                       |
| **Status**        | `Draft`                                                         |
| **Author(s)**     | <name(s) + GitHub handle(s)>                                    |
| **Created**       | YYYY-MM-DD                                                      |
| **Updated**       | YYYY-MM-DD                                                      |
| **Affects**       | <spec docs / schemas / SDKs / conformance scenarios touched>    |
| **Compatibility** | <`additive` / `safety-fix` / `breaking`> per `COMPATIBILITY.md` |
| **Supersedes**    | <RFC number, if any>                                            |
| **Superseded by** | <RFC number, if any — filled when this RFC is replaced>         |

## Summary

One paragraph (≤ 5 sentences). What does this RFC propose, and why?

## Motivation

What problem does this solve? Who hits the problem today? Why is the spec the right place to solve it (vs. an implementation choice)?

If this is driven by a conformance gap, link the failing scenarios. If driven by an implementer pain point, link the issue or describe the use case.

## Proposal

The actual change. Be specific:

- **Wire shape changes.** Show the JSON Schema diff, OpenAPI/AsyncAPI diff, or prose-spec section diff. New fields list their type, optionality, and default.
- **Behavior changes.** Use RFC 2119 keywords (MUST, SHOULD, MAY) consistently.
- **Examples.** At least one positive example and one negative example (what fails validation).

For RFCs that affect the wire contract, include the schema diff inline:

```diff
   "type": "object",
+  "properties": {
+    "newField": {
+      "type": "string",
+      "description": "..."
+    }
+  },
   "required": ["existingField"]
```

## Compatibility

Classify per `COMPATIBILITY.md`:

- **Additive** — new optional field, new SHOULD recommendation, new event type that consumers can ignore. Lands in v1.x.
- **Safety-fix** — breaking but justified by security or correctness. 90-day public RFC window unless under embargoed disclosure. Ships with migration tooling.
- **Breaking** — anything else that invalidates an existing v1 conformance pass. Lands in v2.

State which category applies and why.

For additive changes, list the specific clauses that guarantee backward compatibility: e.g., "new field is optional with default `null`; existing clients ignore it; existing servers don't emit it."

For safety-fix and breaking changes, include a migration plan section describing what implementers must do.

## Conformance

- Which existing scenarios cover this surface?
- Which new scenarios are needed?
- For additive RFCs: do new scenarios run only when the relevant capability is advertised? (See `capabilities.md` and `RFCS/profiles.md` if applicable.)

A normative-addition RFC SHOULD ship with at least one new conformance scenario in the same release of `@openwop/openwop-conformance`.

### Falsifiability — one row per normative requirement

*(Required since 2026-08-19.)* For each MUST / MUST NOT this RFC introduces, name
**the observable** and **who can cause the condition**. Fill this in while
drafting, not after — the point is to discover an unwitnessable requirement
before it is written, rather than when someone tries to test it.

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.1 … | e.g. "no delivery arrives at a registered receiver" | the suite, unaided | witnessable |
| §B.4 … | e.g. "a different process id serves the resumed run" | operator (needs a process kill) | seam-gated |
| §C.2 … | — | — | **unwitnessable — say so here and why** |

Two failure modes this table exists to catch, both of which have cost real work
in this corpus:

- **Observable but not causable.** The property is visible; the *condition that
  produces it* cannot be produced from outside. Duplicate external effects are
  perfectly observable, but a suite cannot make a host's queue redeliver accepted
  work — so a same-key client retry witnesses a different mechanism wearing the
  same name. Ask both questions separately: *can I see it?* and *can I cause it?*
- **Witnessable only when advertised.** An unconditional obligation whose only
  probe is gated on an optional capability is unfalsifiable on every host that
  does not advertise — see `capabilities.md` §"What a capability may vary",
  class 1.

An RFC MAY introduce a requirement it cannot witness. What it MUST NOT do is
leave that undiscovered: record it in the table, and in §"Unresolved questions"
if a probe is wanted later.

## Alternatives considered

What other approaches were considered? Why were they rejected?

State at least two alternatives and their trade-offs. "Do nothing" is always a valid alternative — explain why doing nothing is worse than the proposal.

## Unresolved questions

Open questions the maintainers need to decide before this RFC moves to `Active`. Use a numbered list so reviewers can refer to questions by number.

1. ...
2. ...

## Implementation notes (non-normative)

Anything the reference implementation needs to know but that doesn't belong in normative spec text. Cross-cuts to other plans, expected effort, sequencing.

## Acceptance criteria

Checklist the maintainers will use to flip `Status` from `Active` to `Accepted`:

- [ ] Spec text merged.
- [ ] Schema / OpenAPI / AsyncAPI updated where applicable.
- [ ] At least one conformance scenario covering the new surface.
- [ ] CHANGELOG entry under the appropriate version.
- [ ] Reference host (per `ROADMAP.md`) implements and passes the new conformance scenarios, or the RFC explicitly defers reference-host implementation.

## References

- Linked issues, conformance reports, prior art (BPMN, Temporal, MCP, etc.).
- Related RFCs.
- Spec docs touched.
