# `core.openwop.agents.api-designer`

Authors OpenAPI 3.1, AsyncAPI 3.0, and JSON Schema 2020-12 documents from briefs. Self-validates output.

| Pack name | `core.openwop.agents.api-designer` |
| Version | `1.0.0` |
| Engine | OpenWOP `>=1.1.0 <2.0.0` |
| Agents | 1 |
| Required host capabilities | `aiProviders`, `host.agentRuntime`, `host.fs` |
| License | Apache-2.0 |

## Supported targets

| Target | Spec version | Notes |
|---|---|---|
| `openapi` | 3.1 | REST APIs. Includes path objects, components, security schemes. |
| `asyncapi` | 3.0 | Event-driven APIs. Includes channels, operations, messages. |
| `json-schema` | 2020-12 | Standalone schema documents. |

## Handoff schemas

- `schemas/api-designer.task.schema.json` — `{ target, brief, existingPath?, outputPath?, includeExamples? }`
- `schemas/api-designer.return.schema.json` — `{ document, target, outputPath?, validationStatus }`
