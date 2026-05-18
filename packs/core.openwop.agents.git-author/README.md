# `core.openwop.agents.git-author`

Drafts commit messages, PR titles + bodies, release notes, and changelog entries from a diff. Conventional-Commits-aware.

| Pack name | `core.openwop.agents.git-author` |
| Version | `1.0.0` |
| Engine | OpenWOP `>=1.1.0 <2.0.0` |
| Agents | 1 |
| Required host capabilities | `aiProviders`, `host.agentRuntime` |
| License | Apache-2.0 |

## Output shapes

| Shape | Notes |
|---|---|
| `commit-message` | Conventional Commits: `type(scope): subject` + optional body + optional footer (`BREAKING CHANGE:`, `Co-Authored-By:`, etc.). Subject under 72 chars. |
| `pr-title` | Short, scannable, no period. Under 70 chars. |
| `pr-body` | Markdown: `## Summary` (1-3 bullets) + `## Test plan` (checklist). |
| `release-notes` | Markdown grouped by Added / Changed / Fixed / Deprecated / Removed / Security. |
| `changelog-entry` | Single Keep-A-Changelog block for the [Unreleased] section. |

## Handoff schemas

- `schemas/git-author.task.schema.json` — `{ shape, diff, repoUrl?, recentMessagesCount? }`
- `schemas/git-author.return.schema.json` — `{ output, shape, conventionalCommitsType? }`
