# OpenWOP CLI

The OpenWOP CLI is the local control plane for the `apps/workflow-engine` demo app and a lightweight client for OpenWOP-compatible hosts.

## Quick start

```bash
node cli/openwop.mjs --help
node cli/openwop.mjs doctor                 # check prerequisites
node cli/openwop.mjs onboard                # guided setup (host + provider + key + model)
node cli/openwop.mjs demo start             # boot local backend + frontend (optional)
node cli/openwop.mjs demo status
node cli/openwop.mjs catalog nodes --search ai
node cli/openwop.mjs runs create sample.demo.uppercase --input text=hello --wait
```

## Onboarding

The `onboard` wizard walks you through:

1. **Host URL** — `https://app.openwop.dev/api` (shared demo), `http://localhost:8080` (local), or a custom URL.
2. **AI provider** — `anthropic`, `openai`, `google`, or `minimax` (matches what the demo backend dispatches to).
3. **API key** — auto-detects `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_API_KEY` / `MINIMAX_API_KEY`, or hidden-input via raw-mode stdin. The key is POSTed to `/v1/host/sample/byok/secrets` on the configured host. **The key is never written to your local config file** — only a credential ref pointer is stored.
4. **Model** — provider-specific recommended defaults plus a custom option.
5. **Test the connection** — verifies the credential ref appears in the host's BYOK list.

Re-running `openwop onboard` is safe: it detects existing config and asks Keep / Modify / Reset.

For scripted use:

```bash
openwop onboard --non-interactive \
  --base-url-choice shared \
  --provider anthropic \
  --api-key-env ANTHROPIC_API_KEY \
  --model claude-sonnet-4-6
```

## Provider management

```bash
openwop providers list
openwop providers add openai --api-key-env OPENAI_API_KEY --model gpt-4o
openwop providers remove openai
openwop providers test anthropic
```

`providers add` POSTs to `/v1/host/sample/byok/secrets`; `remove` DELETEs; `list` and `test` read.

## Config

`~/.openwop/config.json` (or `$OPENWOP_CONFIG_HOME/.openwop/`) stores the host URL, default provider, default model, and credential ref. **API keys are never stored locally.**

```bash
openwop config file                      # print path
openwop config get                        # print full config
openwop config get host.baseUrl           # dotted-path lookup
openwop config set defaultModel gpt-4o
openwop config unset credentialRef
```

## Defaults

- Host URL: `OPENWOP_BASE_URL` or `http://localhost:8080`. Flag (`--base-url`) wins over env; env wins over default.
- OpenWOP host bearer (NOT the LLM provider key): `OPENWOP_API_KEY`, or `sample-token` for localhost demo URLs. Pass via global `--api-key` if you need to override.
- LLM provider key: `--provider-key <key>` or `--api-key-env <VAR>` on `onboard` / `providers add` (not stored locally).
- Frontend URL: `http://localhost:5173`.

Input parsing for `runs create`:

- `--input k=v` — each value is `JSON.parse`d first; on parse failure it falls back to a string. So `--input n=5` is the number `5`, `--input enabled=true` is the boolean `true`, `--input text=hello` is the string `"hello"`, and `--input list=[1,2,3]` is an array. Quote shell-special characters.
- `--inputs-json '{"a":1}'` passes the whole `inputs` object as one JSON literal. Merged BEFORE `--input` pairs (which override).
- `--wait` polls `GET /v1/runs/{runId}` every 250ms until terminal status or `--timeout-ms` (default 30000) elapses. Exit 0 only on `completed`.

Exit codes:

- `0` — success.
- `1` — server-side failure (5xx) or run terminated in `failed` / `cancelled` under `--wait`.
- `2` — user-fixable error (unknown command, missing argument, 4xx response).

The CLI is dependency-light by design. It uses Node built-ins so contributors can operate the demo app without installing another command framework.
