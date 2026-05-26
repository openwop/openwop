# OpenWOP CLI Research, Gap Analysis, and Demo-App Plan

Date: 2026-05-26

## Goal

Build an OpenWOP CLI that supports and improves the `apps/workflow-engine` demo app while remaining useful against any OpenWOP-compatible host. UX is grounded in established developer-CLI conventions rather than borrowed from any one product.

## Reference CLI Patterns

Patterns drawn from established developer CLIs (install + lifecycle + introspection + recovery) informed the surface decisions below. None were copied; each was evaluated for fit against OpenWOP's spec-corpus + demo-app architecture.

| Area | Reference pattern | OpenWOP implication |
|---|---|---|
| Install | One-line installer detects OS, installs Node if needed, installs CLI, then launches onboarding. Alternate npm/pnpm/bun/source paths exist. | Start with repo-local CLI and `doctor`; later add installer scripts once CLI surface stabilizes. |
| Runtime shape | CLI is the entrypoint to a local gateway/service process. Package metadata exposes a `bin` mapping. | OpenWOP CLI should own demo backend/frontend launch and host probing. |
| Onboarding | An `onboard` command configures provider/channel/daemon setup. | OpenWOP should use `doctor`, `demo start`, and targeted setup checks first; provider onboarding can follow. |
| Gateway/service | Commands cover start/stop/restart/status, daemon/service install, logs, health. | Demo app needs `demo start`, `status`, `health`, and later service/log lifecycle. |
| Config | Global flags include config path, JSON output, quiet/verbose. | OpenWOP CLI has `--base-url`, `--api-key`, `--json`, `--quiet`, `--verbose`. |
| Introspection | CLIs expose health, status, sessions, plugins, models, channels, docs. | OpenWOP CLI should expose capabilities, node catalog, packs, workflows, runs, and conformance. |
| Recovery | Reset/uninstall, doctor-style plugin checks, sandbox explain/recreate. | OpenWOP should prioritize non-destructive diagnostics; destructive reset/uninstall are deferred. |
| Automation | Tasks/cron/flow commands manage background work. | OpenWOP run lifecycle commands are the right first analogue. Scheduling can follow when demo scheduling is deeper. |

## OpenClaw install + onboarding — deep-dive

Researched 2026-05-26 directly from openclaw.ai, docs.openclaw.ai, and openclawlab.com.

### Install entry points

OpenClaw exposes three install paths, ordered by reach:

1. **One-line bash installer** — `curl -fsSL https://openclaw.ai/install.sh | bash`. The script detects the host OS (macOS / Linux / Windows-WSL), installs Node.js 22+ if missing, then runs `npm install -g openclaw` and finally launches the onboarding wizard. The flag `--install-method git` swaps the npm install for a `git clone` + `pnpm install`.
2. **Direct npm** — `npm i -g openclaw`. Skips the OS / Node detection layer; assumes the user has Node 22+. Same wizard runs on first `openclaw` invocation, or explicitly via `openclaw onboard`.
3. **Headless / non-interactive** — `openclaw onboard --non-interactive` plus pre-supplied flags. Used by Dockerfiles, CI, and scripted deployments. Falls back on env vars when flags are absent.

### Wizard flow

The wizard runs through nine steps in a fixed order. Each step has a sensible default; the user can accept, modify, or skip. The wizard is **safe to re-run** — existing config is preserved unless the user explicitly picks `Reset`.

| # | Step | What it asks | OpenWOP relevance |
|---|---|---|---|
| 1 | Existing config | If `~/.openclaw/config` exists: `Keep / Modify / Reset` | Direct port. We mirror with `~/.openwop/config.json`. |
| 2 | Model / Auth | Pick a provider (Anthropic recommended; OpenAI, Venice AI, Custom; ~20 supported including OpenRouter, LiteLLM, Bedrock, Ollama, vLLM); enter API key (env var like `ANTHROPIC_API_KEY` consumed if set, otherwise prompt) | Direct port. Our four backend dispatchers are anthropic / openai / google / minimax — that's the menu. |
| 3 | Workspace | Path for agent files (default `~/.openclaw/workspace`) | N/A — OpenWOP has no "workspace" concept; workflows live in the demo backend's `workflowsRegistry`. |
| 4 | Gateway config | Port, bind address, auth mode, optional Tailscale exposure | N/A — OpenWOP's demo backend listens on its configured port; the CLI is a client, not a gateway. |
| 5 | Channels | Adds messaging integrations (WhatsApp, Telegram, Discord, Slack, …) | N/A — OpenWOP has no inbound-channel layer. |
| 6 | Daemon | Installs LaunchAgent (macOS) or systemd unit (Linux) for autostart | Deferred. Demo backend on Cloud Run handles this in production; local dev uses `openwop demo start`. |
| 7 | Health check | Starts the gateway and probes its `/health` endpoint | Direct port. We round-trip `/health` + `/readiness` + the configured provider via BYOK. |
| 8 | Skills | Installs recommended skills + optional dependencies | Adapt. Closest OpenWOP analogue is node packs; this lands as a future `openwop packs install`. |
| 9 | Summary | Prints next-step commands | Direct port. |

### Key UX patterns worth porting

- **Env-var detection.** Before any prompt, the wizard scans for known env vars (e.g., `ANTHROPIC_API_KEY`) and auto-uses them with a single `Y/n` confirmation. Skipping unnecessary prompts is what makes the wizard feel "smart."
- **Recommended-default-first.** Every choice list highlights one option as the recommended default — typed `Enter` accepts it. Users who know what they want type the index; users who don't are guided.
- **Hidden input for secrets.** API keys are read via raw-mode stdin so they don't echo into terminal scrollback or shell history.
- **Safe re-run.** First step on every wizard invocation: detect existing config, ask whether to Keep / Modify / Reset. Idempotent by default.
- **Non-interactive parity.** Every prompt has a corresponding flag (`--provider`, `--api-key-env`, `--model`, `--base-url`, etc.). A scripted invocation runs the same code path with prompts short-circuited by flag values.
- **Test-the-connection step.** After credentials are saved, the wizard does a tiny round-trip (a "say OK" chat against the configured provider) and surfaces the result. Closes the loop on "did this work?" before the user leaves the wizard.
- **Profile isolation.** `--profile <name>` isolates state under `~/.openclaw-<name>` so a single machine can hold multiple separated configurations. `--dev` is a built-in profile for development work.

### Provider catalog (for context)

OpenClaw supports ~20 providers out of the box: Anthropic, OpenAI, Venice AI, OpenRouter, LiteLLM, Vercel AI Gateway, Together AI, Cloudflare AI Gateway, Moonshot AI, Amazon Bedrock, Qwen, Google Gemini, Ollama, vLLM, Hugging Face, Qianfan, NVIDIA, GLM, MiniMax, Xiaomi, Z.AI. Provider strings are `provider/model` (e.g., `anthropic/claude-opus-4-7`).

OpenWOP's demo backend currently dispatches to four — anthropic, openai, google, minimax — via `providers/dispatch.ts`. Onboarding wires through that limited set; expanding the provider list is a backend concern, not a CLI concern.

## OpenWOP Audit Summary

Current local surfaces:

- Root repo is a spec corpus with release/check scripts.
- TypeScript SDK exists under `sdk/typescript`.
- Conformance CLI exists under `conformance/src/cli.ts`.
- Demo app lives under `apps/workflow-engine`.
- Demo backend already supports health/readiness, discovery, OpenAPI stub, runs, streams, interrupts, packs, prompts, BYOK, workflows, node catalog, sample chat, memory, media, admin, and MCP routes.
- Demo frontend already supports builder, chat, run detail, streams, prompts, registry, notifications, BYOK, capability panels, and workflow dashboards.

## Gap Analysis

| Gap | Decision | This pass |
|---|---|---|
| No `openwop` command | Implement directly | Added `cli/openwop.mjs` and root `bin.openwop`. |
| No install/onboarding flow | Adapt | Added `doctor` and `demo start --install`; full installer deferred. |
| No demo lifecycle command | Implement | Added `demo start`, `demo status`, `demo urls`. |
| No CLI-friendly app summary | Implement in demo app | Added `GET /v1/host/sample/demo-summary`. |
| No host introspection CLI | Implement | Added `health`, `capabilities`, `catalog nodes`, `catalog packs`. |
| No workflow/run CLI | Implement | Added workflow list/get/register/delete and run list/create/get/cancel. |
| No conformance bridge | Implement | Added `openwop conformance`. |
| Service install/daemon/log tail | Defer | Needs cross-platform service design and log path conventions. |
| Config file management | Defer | OpenWOP host config is not centralized the way a single-service gateway CLI typically assumes. |
| Reset/uninstall | Skip for now | Risky before state directories and service ownership are stable. |
| Plugin/skill marketplace analogue | Adapt later | OpenWOP has packs as its extension primitive, not third-party skills or plugins. First step is catalog/packs. |

## Implemented Command Structure

```bash
openwop doctor
openwop demo start
openwop demo status
openwop demo urls
openwop health
openwop capabilities
openwop catalog nodes
openwop catalog packs
openwop workflows list|get|register|delete
openwop runs list|create|get|cancel
openwop conformance
```

Global flags:

```bash
--base-url <url>
--api-key <key>
--json
--quiet
--verbose
--version
--help
```

## Demo App Upgrade

Added `GET /v1/host/sample/demo-summary`, returning:

- app name, service name/version, storage kind
- canonical demo route paths
- node catalog counts
- registered workflow and fixture counts
- host-surface support counts
- prompt-library support flags
- recommendations for common demo limitations

This lets the CLI render a single high-signal status view and gives future frontend diagnostics a stable endpoint.

## Verification

Focused verification commands:

```bash
node --test cli/test/*.test.mjs
cd apps/workflow-engine/backend/typescript && ./node_modules/.bin/vitest run test/demo-summary.test.ts
node cli/openwop.mjs --help
node cli/openwop.mjs demo start --dry-run
```

Full follow-up verification:

```bash
node cli/openwop.mjs demo start
node cli/openwop.mjs demo status
node cli/openwop.mjs catalog nodes
node cli/openwop.mjs runs create sample.demo.uppercase --input text=hello --wait
```

## Final Summary

### What was built

- **`cli/`** — A `@openwop/cli` package (`openwop` binary). Subcommands now span guided setup + operator surface: `onboard`, `providers {list,add,remove,test}`, `config {file,get,set,unset}`, `doctor`, `demo {status,start,urls}`, `health`, `capabilities`, `catalog {nodes,packs}`, `workflows {list,get,register,delete}`, `runs {list,create,get,cancel}`, and `conformance`. Pure Node stdlib — zero new runtime dependencies. Dispatcher returns are `await`ed so HTTP errors and validation errors surface as proper non-zero exit codes (4xx → 2, 5xx → 1, CliError → its declared code).
- **`openwop onboard`** — Guided first-run wizard that mirrors the OpenClaw flow scoped to OpenWOP. Walks the user through host URL (shared demo at `app.openwop.dev/api`, local at `localhost:8080`, or custom), AI provider (anthropic / openai / google / minimax — the four the demo backend dispatches to), API key (auto-detects `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_API_KEY` / `MINIMAX_API_KEY`, or hidden-input via raw-mode stdin), model (recommended + custom), and a reachability check. Safe to re-run (Keep / Modify / Reset). Full non-interactive surface (`--non-interactive --base-url-choice shared --provider anthropic --api-key-env ANTHROPIC_API_KEY`) for scripted / CI use.
- **`openwop providers {list,add,remove,test}`** — Scriptable provider management. `add` POSTs to `/v1/host/sample/byok/secrets`, `remove` DELETEs, `test` verifies the credential ref appears in the BYOK list. API keys are never written to local config — only credential refs.
- **`openwop config {file,get,set,unset}`** — Read and modify `~/.openwop/config.json` (or `$OPENWOP_CONFIG_HOME/.openwop/`). Dotted keys traverse nested objects.
- **`apps/workflow-engine/backend/typescript/src/routes/demoSummary.ts`** — `GET /v1/host/sample/demo-summary` in the `sample-extension` namespace. Returns app identity, canonical endpoint paths, node-catalog + workflow + fixture + host-surface counts, prompt-library flags, and a `recommendations` array surfacing common demo limitations. Registered with the existing discovery doc.
- **Tests.** 27 Node-test cases in `cli/test/cli.test.mjs` covering argument parsing, table rendering, capability summarization, `demo status`, `doctor`, `demo start --dry-run` + conflict-flag refusal, `runs create --wait` (both completion + failure paths), 4xx / 5xx / unknown-command exit codes, base-URL precedence (flag > env > default), the full `onboard --non-interactive` happy path + `--api-key-env` + non-interactive provider-required guard + unknown-provider rejection, `providers list / add / remove / test` (both reachable and missing-credential cases), and `config file / get / set / unset` round-trips. One vitest case in `apps/workflow-engine/backend/typescript/test/demo-summary.test.ts` covering the response shape.
- **Docs.** Root `README.md` and `apps/workflow-engine/README.md` updated with the CLI quickstart. `cli/README.md` carries the install + defaults summary.

### What remains

- **One-line bootstrap installer.** Today install is `npm i -g @openwop/cli` (once published) or `node cli/openwop.mjs ...` from a repo clone. A `curl https://openwop.dev/install.sh | bash` that detects + installs Node when missing is deferred — it's a small script, but it needs hosting on `openwop.dev` and a published npm package first.
- **Service lifecycle beyond `demo start`.** No `demo stop` / `demo restart` / `demo logs` / PID-file tracking. Plan defers to a follow-up that lands cross-platform service conventions.
- **`providers test` round-trip.** Today `test` verifies the credential ref appears in the BYOK list — a wire-reachability check, not an end-to-end provider call. A fuller test would round-trip a tiny chat ("reply OK") and confirm the upstream provider answered; that requires a workflow-id assumption (`sample.chat.turn`) that's stable across hosts. Deferred.
- **Per-command help-string parity.** `doctor` / `demo` / `runs` / `workflows` / `catalog` / `onboard` / `providers` / `config` now have descriptions; the remaining short-form helps (`health`, `capabilities`) were filled out in this pass. Future commands SHOULD use the same `Usage: ... \n\n description` shape.
- **CI integration.** The new tests are runnable via `node --test cli/test/*.test.mjs` and `vitest run` in the backend, but they are not yet wired into the top-level `npm run openwop:check` gate.

### How to try it

```bash
# 1. Check prerequisites + repo layout (no network needed)
node cli/openwop.mjs doctor

# 2. Onboard — pick host + provider + model, store BYOK key (interactive)
node cli/openwop.mjs onboard
#    or scripted:
node cli/openwop.mjs onboard --non-interactive \
  --base-url-choice shared \
  --provider anthropic \
  --api-key-env ANTHROPIC_API_KEY

# 3. Or boot a local demo (backend + frontend) and onboard against it
node cli/openwop.mjs demo start --install

# 4. Inspect from another terminal
node cli/openwop.mjs demo status
node cli/openwop.mjs capabilities
node cli/openwop.mjs catalog nodes --search ai --limit 10
node cli/openwop.mjs providers list

# 5. Drive a workflow
node cli/openwop.mjs runs create sample.demo.uppercase --input text=hello --wait

# 6. Run the in-repo conformance suite against your local demo
node cli/openwop.mjs conformance --filter discovery

# 7. Run the test suites
node --test cli/test/*.test.mjs
cd apps/workflow-engine/backend/typescript && ./node_modules/.bin/vitest run test/demo-summary.test.ts
```

Override targets via flags or env: `--base-url` / `OPENWOP_BASE_URL`, `--api-key` / `OPENWOP_API_KEY` (these are the OpenWOP host's bearer; the LLM provider's API key uses `--provider-key` or `--api-key-env VAR`), `--json` for machine-readable output everywhere.
