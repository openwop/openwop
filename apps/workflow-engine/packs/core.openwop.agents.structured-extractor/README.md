# `core.openwop.agents.structured-extractor`

Production-grade structured-extraction agent. Caller supplies a JSON Schema; agent extracts conforming output with an auto-fix loop on validation failure. Mirrors LangGraph Trustcall.

| Pack name | `core.openwop.agents.structured-extractor` |
| Version | `1.0.0` |
| Engine | OpenWOP `>=1.1.0 <2.0.0` |
| Runtime | `language: remote` |
| Agents | 1 |
| Required host capabilities | `aiProviders`, `host.agentRuntime` |
| License | Apache-2.0 |

## Difference from `core.openwop.agent-examples.structured-fixture`

The fixture is a smoke-test for the handoff-schema wire surface — fixed schema, no auto-fix, conformance use only.

This pack is the production extractor: **caller-supplied schema** at dispatch time, **auto-fix loop** on validation failure (LLM is shown the validation errors and asked to retry), schema-aware confidence calibration.

## Auto-fix loop

When the LLM's output fails JSON Schema validation:

1. Validate via `openwop:core.data.json-schema-validate` — get the structured error list.
2. Re-prompt with the validation errors + the original input + the original schema.
3. Retry up to `maxFixAttempts` (default 3).
4. If still failing, return the `error` shape with `code: "schema_violation"` + the final error list.

## Handoff schemas

- `schemas/structured-extractor.task.schema.json` — `{ input: string, outputSchema: <inline JSON Schema>, maxFixAttempts?: number, language?: string }`
- `schemas/structured-extractor.return.schema.json` — `oneOf [{ extracted, confidence, fixAttempts }, { error }]`

Note that `task.outputSchema` is an **inline JSON Schema** (the caller passes the schema in the dispatch payload). This differs from agent-shipped handoff schemas which are file references; here the schema is per-dispatch.

## See also

- [`packs/core.openwop.agents/`](../core.openwop.agents/) — see `output-parser-structured` + `output-parser-auto-fix` sub-nodes for the in-workflow equivalent
- [`RFCS/0003-agent-packs.md`](../../RFCS/0003-agent-packs.md) §D — handoff schema resolution
