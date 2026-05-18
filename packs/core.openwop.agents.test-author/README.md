# `core.openwop.agents.test-author`

Generates unit / integration / e2e tests from source code or specs. Framework-aware. Reads existing tests to match house style.

| Pack name | `core.openwop.agents.test-author` |
| Version | `1.0.0` |
| Engine | OpenWOP `>=1.1.0 <2.0.0` |
| Agents | 1 |
| Required host capabilities | `aiProviders`, `host.agentRuntime`, `host.fs` |
| License | Apache-2.0 |

## Supported frameworks

| Language | Test types | Frameworks |
|---|---|---|
| TypeScript / JavaScript | unit / integration | Jest, Vitest, Node test runner |
| TypeScript / JavaScript | e2e | Playwright, Cypress |
| Python | unit / integration | pytest, unittest |
| Go | unit / integration | `testing` (stdlib), testify |

## Handoff schemas

- `schemas/test-author.task.schema.json` — `{ testType, source, framework?, neighborTestPath?, outputPath?, coverageTargets? }`
- `schemas/test-author.return.schema.json` — `{ testCode, framework, outputPath?, scenarios }`
