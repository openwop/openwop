# `core.openwop.agents.frontend-designer`

Frontend / UI design agent. Produces design-system-aware component specs, page layouts, and skeleton code from briefs. Mirrors Anthropic's `frontend-design` skill (~277k installs in marketplace as of early 2026 — top-installed official skill).

| Pack name | `core.openwop.agents.frontend-designer` |
| Version | `1.0.0` |
| Engine | OpenWOP `>=1.1.0 <2.0.0` |
| Agents | 1 |
| Required host capabilities | `aiProviders`, `host.agentRuntime`, `host.fs` |
| License | Apache-2.0 |

## What it does

Given a UI brief + optional design-system source, produces:

- **Component contracts** — props (with types), variants, states, accessibility notes.
- **Layout JSON** — declarative layout (grid / stack / flow) with spacing tokens, breakpoint behavior.
- **Skeleton code** — React (TSX) or HTML scaffold matching the contracts.

When `task.designSystemPath` is supplied, reads it via `openwop:core.files.fs-read` and references its tokens. When `task.knowledgeSourceIds` is supplied, retrieves design-system docs via `openwop:core.rag.retrieve`.

## Why "designer", not just "frontend"

The output is design specs + skeleton — not production code. For production code generation, hand the specs to a coding agent or a workflow that targets the team's stack. Separation matters: design decisions and implementation decisions have different review cycles.

## Handoff schemas

- `schemas/frontend-designer.task.schema.json` — `{ brief, surfaceType, designSystemPath?, knowledgeSourceIds?, framework?, outputPath? }`
- `schemas/frontend-designer.return.schema.json` — `{ components, layout, skeletonCode, outputPath? }`
