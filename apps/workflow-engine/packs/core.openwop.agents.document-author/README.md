# `core.openwop.agents.document-author`

Authors PDF / Word / Excel / PowerPoint documents from natural-language briefs. Mirrors Anthropic's top-installed official Office-document skills.

| Pack name | `core.openwop.agents.document-author` |
| Version | `1.0.0` |
| Engine | OpenWOP `>=1.1.0 <2.0.0` |
| Runtime | `language: remote` |
| Agents | 1 |
| Required host capabilities | `aiProviders`, `host.agentRuntime`, `host.fs` |
| License | Apache-2.0 |

## Supported formats

| Format | Notes |
|---|---|
| `pdf` | Generated via `core.openwop.files` PDF primitives (merge/split). Caller may supply a template path. |
| `docx` | Generated as docx XML; caller supplies a template or uses default. |
| `xlsx` | Generated for tabular outputs; caller supplies column schema. |
| `pptx` | Generated for slide decks; caller supplies slide-count target + slide titles. |
| `md` | Markdown — also produced as the "intermediate" format for any of the above. |

## Handoff schemas

- `schemas/document-author.task.schema.json` — `{ format, brief, outputPath?, templatePath?, sourceData?, style? }`
- `schemas/document-author.return.schema.json` — `{ outputPath, format, pageCount?, wordCount, summary }`
