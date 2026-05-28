# `core.openwop.agents.doc-writer`

Technical documentation author. Produces README sections, API docs, architecture notes, changelogs, and runbooks from source material. RAG-grounded.

| Pack name | `core.openwop.agents.doc-writer` |
| Version | `1.0.0` |
| Engine | OpenWOP `>=1.1.0 <2.0.0` |
| Runtime | `language: remote` |
| Agents | 1 |
| Required host capabilities | `aiProviders`, `host.agentRuntime`, `host.fs` |
| License | Apache-2.0 |

## Supported document shapes

| Shape | Description |
|---|---|
| `readme-section` | Section of a README — title + intro + sub-sections |
| `api-reference` | API endpoint or function reference — signature + parameters + return + examples |
| `architecture-note` | Architecture or design note — context + decision + consequences (ADR-style) |
| `changelog` | Changelog entries — grouped by Added / Changed / Fixed / Deprecated / Removed / Security |
| `runbook` | Operational runbook — symptom + diagnosis + remediation + verification |

Choose via `task.shape`. Each shape has its own structural rules in the prompt.

## RAG grounding

Optional. When `task.knowledgeSourceIds` is non-empty, the agent retrieves from those sources via `openwop:core.rag.retrieve` and grounds claims in the retrieved content. Citations are returned in `sources`.

When unset, the agent writes from its training and the `task.sourceMaterial` content. No tool calls.

## Writing to disk

When `task.outputPath` is set, the agent writes the final document via `openwop:core.files.fs-write` and returns the path. When unset, the document is returned only in the response payload.

## Handoff schemas

- `schemas/doc-writer.task.schema.json` — `{ shape, sourceMaterial?, knowledgeSourceIds?, outputPath?, style?, length? }`
- `schemas/doc-writer.return.schema.json` — `{ document, outputPath?, sources, wordCount }`
