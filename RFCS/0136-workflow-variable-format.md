# RFC 0136: `WorkflowVariable.format` — a presentational hint for run inputs

| Field             | Value                                                                                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**           | 0136                                                                                                                                                                   |
| **Title**         | `WorkflowVariable.format` — a presentational hint for run inputs                                                                                                        |
| **Status**        | `Draft`                                                                                                                                                                |
| **Author(s)**     | openwop-app maintainers                                                                                                                                                |
| **Created**       | 2026-08-01                                                                                                                                                             |
| **Updated**       | 2026-08-01                                                                                                                                                             |
| **Affects**       | `schemas/workflow-definition.schema.json` (§WorkflowVariable), `schemas/workflow-chain-pack-manifest.schema.json` (chain `parameters`), conformance scenarios            |
| **Compatibility** | `additive` per `COMPATIBILITY.md`                                                                                                                                      |
| **Supersedes**    | —                                                                                                                                                                      |
| **Superseded by** | —                                                                                                                                                                      |

## Summary

`WorkflowVariable` carries `type` (`string` | `number` | `boolean` | `object` |
`array`) but nothing finer. A host rendering a workflow's declared run inputs
therefore cannot tell an email address from a URL from a free-text note — all three
are `type: "string"` — and must render every one as a plain text field. Because
`WorkflowVariable` is `additionalProperties: false`, a host **cannot** carry the
distinction out-of-band either; the information has nowhere to live on the wire.

This RFC adds an optional `format` string to `WorkflowVariable`, drawn from the
JSON-Schema `format` vocabulary. It is **advisory and presentational**: it MUST NOT
be used to reject a run.

## Motivation

**This is a real, currently-shipping gap, not a hypothetical.** In the openwop-app
reference host, 10+ workflow chains declare a `recipientEmail` parameter and every
chain that sends mail declares `senderEmail`. Both are unambiguously email
addresses. Every host renders them as `<input type="text">`, so:

- **mobile keyboards show no `@` key** — the single highest-friction moment in
  filling out a run form on a phone;
- **the browser's free email validation never runs**, so a typo becomes a failed
  send discovered only after the run;
- **assistive technology gets no semantic hint** beyond "text field";
- **hosts cannot compensate.** A host that guesses from the variable *name*
  (`/email$/i`) misfires on a name like `emailTemplateId`, and the guess is not
  portable — every other host has to invent the same heuristic independently.

The last point is what makes this a wire concern rather than a UI one. The
authoring side (a chain pack, an SDK, a workflow author) **knows** the field is an
email address. There is simply no slot to say so, so each host re-derives it badly
or not at all.

### Precedent

`sensitive` was added to this exact object by **RFC 0124** for the same structural
reason: hosts needed a per-variable property the wire did not carry, and
`additionalProperties: false` meant it could only arrive via an RFC. `format` is the
same shape of change — one optional, additive, per-variable property — with a
strictly smaller blast radius, because unlike `sensitive` it changes no persistence,
masking, or replay behaviour.

## Design

Add to `$defs.WorkflowVariable` in `schemas/workflow-definition.schema.json`:

```json
"format": {
  "type": "string",
  "description": "Advisory presentational hint for a `type: \"string\"` variable, drawn from the JSON-Schema format vocabulary. Hosts SHOULD use it to choose an input affordance (e.g. an email keyboard). It is NOT a validation contract: hosts MUST NOT reject a run because a value does not match, and MUST NOT assume a value matches when reading it."
}
```

Recognised values (the closed set for v1 — extending it is a further RFC):

| `format`    | Meaning                        | Typical affordance      |
| ----------- | ------------------------------ | ----------------------- |
| `email`     | a single email address         | `type="email"`          |
| `uri`       | an absolute URI                | `type="url"`            |
| `date`      | RFC 3339 full-date             | `type="date"`           |
| `date-time` | RFC 3339 date-time             | `type="datetime-local"` |
| `time`      | RFC 3339 full-time             | `type="time"`           |
| `duration`  | ISO 8601 duration              | text + hint             |

### Normative requirements

1. `format` MUST be ignored when `type` is not `"string"`.
2. A host that does not recognise a `format` value MUST fall back to plain text
   rendering. An unknown `format` MUST NOT be an error.
3. A host MUST NOT reject a run, refuse a variable write, or fail validation on the
   grounds that a value does not match its declared `format`. **`format` is a hint
   about intent, never a guarantee about data.**
4. A host MUST NOT infer `format` from a variable's `name`. Name-based inference is
   what this field exists to replace, and it produces wrong answers
   (`emailTemplateId` is not an email address).
5. `format` MUST survive `:fork` and replay verbatim, like every other
   `WorkflowVariable` property. It is authoring-time data and is never re-derived.

### Why advisory rather than validating

A validating `format` would be a breaking change in effect if not in shape: existing
runs carry values that were never checked against it, and a host that began enforcing
`email` would start refusing workflows that ran yesterday. It would also duplicate
validation that belongs to the node actually consuming the value, which is the only
component that knows what it can accept. Keeping `format` strictly presentational
means a host can adopt it incrementally with zero risk to existing runs.

## Alternatives considered

**1. Do nothing; let each host guess from the name.** Rejected — it is what happens
today. It misfires (`emailTemplateId`), it is unportable (every host reinvents it),
and it silently degrades for authors who name fields differently.

**2. Reuse `type` with finer values (`type: "email"`).** Rejected — `type` is a
JSON-Schema *type*, and overloading it breaks every consumer that switches on the
existing five values, including SDK type generation. Breaking, for no gain over an
additive sibling property.

**3. Put it in `description`.** Rejected — `description` is human-facing prose
rendered as field help. Encoding machine-readable intent in it means parsing English,
and it is already localised in some hosts.

**4. A separate `presentation` object.** Rejected as premature: one field is needed
now, and a container invites unbounded growth on a wire object without a driving
use case for the rest of it.

## Compatibility

`additive` per `COMPATIBILITY.md` §2.2:

- optional property, absent by default — every existing `WorkflowVariable` remains
  valid unchanged;
- no existing property changes meaning or type;
- no error code changes meaning;
- a host that ignores `format` entirely stays conformant — the only consequence is
  that it keeps rendering plain text fields, which is exactly today's behaviour.

No migration is required for stored definitions.

## Conformance

A scenario asserting:

- a definition carrying `format: "email"` round-trips through
  `POST /v1/workflows` → `GET /v1/workflows/{id}` **verbatim**;
- an **unrecognised** `format` value round-trips verbatim and does not error
  (requirement 2);
- a run whose variable value does **not** match its declared `format` is accepted
  and completes (requirement 3) — the assertion that keeps `format` advisory;
- `format` survives `:fork` (requirement 5).

## Open questions

1. Should the recognised-value table be closed (as proposed) or open to any
   JSON-Schema `format` token? Closed is proposed so hosts have a bounded set to
   implement and conformance can enumerate it. An open set makes requirement 2
   (unknown ⇒ plain text) carry all the weight.
2. Should chain-pack `parameters` — already a JSON Schema, where `format` is
   *already legal* and simply dropped during expansion — be normatively required to
   propagate `format` into the minted `WorkflowVariable`? The reference host intends
   to; whether that is a MUST for all hosts is worth settling before Accepted.
3. Does `sensitive: true` interact with `format`? A masked value arguably should not
   advertise its shape. Proposed answer: no interaction, because masking is about the
   VALUE and `format` describes the FIELD — but it deserves an explicit line in the
   spec text rather than silence.

## Implementation plan

| Step | Where | Gate |
| --- | --- | --- |
| 1 | `schemas/workflow-definition.schema.json` — add the property | `npm run openwop:check` |
| 2 | `schemas/workflow-chain-pack-manifest.schema.json` — allow it on chain `parameters` | schema check |
| 3 | Conformance scenario per §Conformance | scenario green, capability-gated |
| 4 | Reference host (openwop-app): propagate `format` chain-param → `WorkflowVariable`, honour it in the run-inputs form | `npm run ci` |
| 5 | Witness the scenario non-vacuously under `OPENWOP_REQUIRE_BEHAVIOR=true` | Draft → Active → Accepted |

Status advances to `Accepted` only after step 5, per the RFC 0134 precedent — the
reference host must implement and witness before the wire claim is honest.
