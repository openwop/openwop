# `core.openwop.agents.code-reviewer`

Code review agent. Reviews diffs or files for correctness, security, style, and design issues. Cites file:line for every finding. Severity-classifies findings.

| Pack name | `core.openwop.agents.code-reviewer` |
| Version | `1.0.0` |
| Engine | OpenWOP `>=1.1.0 <2.0.0` |
| Runtime | `language: remote` |
| Agents | 1 |
| Required host capabilities | `aiProviders`, `host.agentRuntime`, `host.fs` (for `openwop:core.files.fs-read`) |
| License | Apache-2.0 |

## What it does

Receives either a unified diff OR a list of files (with contents). Produces a list of structured findings, each with:

- `severity` — `blocking` / `important` / `nit`
- `category` — `correctness` / `security` / `style` / `design` / `performance` / `test`
- `location` — `{ file, line, endLine? }`
- `message` — one-line summary
- `suggestion` — optional concrete fix

May fetch related files via `openwop:core.files.fs-read` to reason about cross-file impact (e.g., follow an import to see what's being used).

## Severity rubric

- **blocking** — bug, security issue, broken test, contract violation. Should block merge.
- **important** — design concern, performance issue, missing test coverage. Author should respond before merge.
- **nit** — style preference, minor naming, documentation. Author may ignore.

Calibrate strictness via `task.strictness` (`gentle` / `standard` / `strict`).

## Handoff schemas

- `schemas/code-reviewer.task.schema.json` — `{ diff? OR files: [{path, content}], strictness?, focusAreas? }`
- `schemas/code-reviewer.return.schema.json` — `{ findings: Finding[], summary, blockingCount }`
