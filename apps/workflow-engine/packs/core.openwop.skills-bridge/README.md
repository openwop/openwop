# `core.openwop.skills-bridge`

Bridges the Anthropic / OpenAI Agent Skills format (SKILL.md, open standard since Dec 2025) to openwop AgentManifests. Hybrid pack: one converter node + one adapter agent.

| Pack name | `core.openwop.skills-bridge` |
| Version | `1.0.0` |
| Engine | OpenWOP `>=1.1.0 <2.0.0` |
| Runtime | `language: javascript` (ESM, Node ≥20) |
| Nodes | 1 (`core.skills-bridge.convert`) |
| Agents | 1 (`core.openwop.skills-bridge.adapter`) |
| Required host capabilities | `aiProviders`, `host.agentRuntime` |
| License | Apache-2.0 |

## Why this exists

The Skills format converged across vendors in late 2025 — Anthropic shipped it, OpenAI adopted it for Codex CLI and ChatGPT. By Q1 2026 the Skills marketplace had ~66.5k third-party skills. **Positioning openwop above the Skills standard, not against it.**

This pack does two things:

1. **`core.skills-bridge.convert` (node)** — pure transform. Takes a SKILL.md folder contents (frontmatter YAML + body Markdown + optional scripts) and emits an openwop AgentManifest object. Workflows can dynamically register skills at run time.
2. **`core.openwop.skills-bridge.adapter` (agent)** — persona that interprets a skill descriptor at dispatch time and executes it. Useful for skill-format portability — workflows can run an existing skill without re-authoring as a native openwop agent pack.

## Mapping (SKILL.md → AgentManifest)

| SKILL.md field | AgentManifest field |
|---|---|
| `frontmatter.name` | `persona` |
| `frontmatter.description` | `description` |
| body (Markdown) | `systemPrompt` (inline) |
| `frontmatter.allowed_tools` | `toolAllowlist` (scoped: `mcp:` for MCP tools; `openwop:` when name is openwop-prefixed) |
| `frontmatter.metadata.modelClass` | `modelClass` (defaults to `general` when absent) |
| `frontmatter.metadata.memory` | `memoryShape` (defaults all false) |

The converter is deterministic and synchronous — no LLM calls.

## Limitations

- **Hand-rolled YAML subset.** The converter ships a zero-dep YAML frontmatter parser in `index.mjs`. It is **intentionally limited** — using a full YAML library would introduce a runtime dependency the pack currently avoids, and full YAML deserialization is an attack surface (cf. CVE-2017-18342 et al. on `yaml.load`). The parser supports:
  - top-level scalar keys (string, number, boolean, null);
  - one-level nested objects (`key:\n  child: value`);
  - arrays of scalars (`key:\n  - item`).
  It does **NOT** support: deeper nesting (>1 level), YAML anchors / aliases (`&`, `*`), multi-line strings (`|`, `>`), explicit tags (`!!str`), flow-style syntax (`{a: 1, b: 2}`), or comments inside flow values. Frontmatter that exceeds this subset will produce a partial conversion — missing fields land in `warnings[]`. Real-world SKILL.md files from the Anthropic marketplace mostly fit this subset; replace with a full YAML library only after auditing the threat surface (see `SECURITY/threat-model-node-packs.md`).
- **No script execution.** Skills with executable scripts (Anthropic skills can ship Python helpers) are NOT executed by the bridge. The conversion exposes their declared interface but the host must wire script execution separately if needed.
- **Vendor-specific API calls.** Skills with vendor-specific runtime calls embedded (e.g., `claude.skills.invoke()` in the body) won't translate cleanly; the bridge surfaces a warning.
- **Output is self-validated against `agent-manifest.schema.json`.** The converter compiles the spec-canonical AgentManifest schema and validates its output before returning; any schema violation lands as a `warnings[]` entry and the `agentManifest` field is suppressed to prevent malformed manifests reaching the host's agent registry.

## See also

- [Anthropic Agent Skills docs](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
- [SKILL.md format spec](https://github.com/anthropics/skills) (open standard)
