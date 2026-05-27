# OpenWOP CLI

The OpenWOP CLI is the local control plane for the `apps/workflow-engine` demo app and a lightweight client for OpenWOP-compatible hosts.

## Install

One-line install (detects the OS, ensures Node 22+, installs the package, then onboards):

```bash
curl -fsSL https://openwop.dev/install.sh | bash
```

Or directly: `npm i -g @openwop/cli` (needs Node 22+), then `openwop onboard`.

From a repo clone the CLI is a TypeScript package — build it once, then run the bundled entry (or `npm run cli -- <command>` from the repo root, which builds first):

```bash
npm --prefix cli install && npm --prefix cli run build   # → cli/dist/openwop.js
```

## Quick start

```bash
node cli/dist/openwop.js --help
node cli/dist/openwop.js doctor                 # check prerequisites
node cli/dist/openwop.js onboard                # guided setup (host + provider + key + model)
node cli/dist/openwop.js demo start             # boot local backend + frontend (optional)
node cli/dist/openwop.js demo status
node cli/dist/openwop.js catalog nodes --search ai
node cli/dist/openwop.js runs create sample.demo.uppercase --input text=hello --wait
node cli/dist/openwop.js packs search ads        # browse the signed pack registry
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

## Chat

`openwop chat <workflowId>` opens an interactive streaming REPL. Each message you type creates a run for the workflow carrying the running conversation as a `messages` array, then streams that run's events to the terminal as they arrive.

```bash
openwop chat sample.chat.turn
openwop chat sample.chat.turn --inputs-json '{"credentialRef":"anthropic-default"}'
openwop chat sample.chat.turn --no-stream --json
```

- **Streaming** — prefers Server-Sent Events (`GET /v1/runs/{runId}/events`). When the host does not stream (it answers with JSON or a non-streamable body), the CLI falls back to polling `GET /v1/runs/{runId}/events/poll`.
- **Turns** — type a line and press Enter. Conversation history is threaded across turns; the assistant's reply is fed back as context. Use `--no-history` to send only the latest turn.
- **Quitting** — `/exit`, `/quit`, or Ctrl-D (EOF).
- **`--json`** — emits raw event records (one JSON object per event) instead of the pretty `assistant>` rendering.
- Extra per-turn inputs (`--input k=v`, `--inputs-json`) ride along on every run, so you can pin a `credentialRef`, model, or other configurable input.
## Packs (signed node-pack registry)

```bash
openwop packs search ads                                   # filter the catalog
openwop packs info community.openwop-team.demo             # metadata + versions
openwop packs install community.openwop-team.demo@0.1.0    # download + verify
openwop packs publish ./my-pack --key ~/key.pem --key-id me-1
openwop packs yank community.openwop-team.demo@0.1.0       # local registry edit
```

These talk to the signed node-pack registry — a **separate surface** from the host `--base-url`. The default registry is `https://packs.openwop.dev`; override with `--registry-url` or `OPENWOP_REGISTRY_URL`.

- **search** reads `/v1/index.json` and filters the catalog client-side (the dynamic host `/v1/packs/-/search` only knows in-process nodes, not the published catalog).
- **info** reads `/v1/packs/{name}/index.json`; `--version v` also fetches that version's manifest.
- **install** downloads `/v1/packs/{name}/-/{version}.tgz`, checks its `sha256` against the manifest `integrity`, and verifies the detached Ed25519 `.sig` against the publisher key at `/keys/{keyId}.pub` (matching `signing.method` — `ed25519` signs the tarball, `manual` signs the in-tarball `pack.json`). Skip verification with `--no-verify`. Artifacts land under `~/.openwop/packs/{name}/{version}/` (override with `--dir`). Yanked versions are refused.
- **publish** — the reference registry has **no write API** (`writeApi.supported=false`; publish is a GitHub pull request). This command performs the local **packaging + Ed25519 signing** flow (mirrors `scripts/build-pack-tarball.mjs --signed`): it emits a deterministic signed `.tgz`, a 64-byte `.sig`, and a sidecar manifest into `dist/packs/` (override with `--out`), ready to commit and PR. The private key comes from `--key <pem>`, else `~/.openwop-keys/{keyId}.private.pem`; if neither exists an ephemeral key is generated and its public half printed for pre-registration.
- **yank** edits a **local registry checkout** — flips `"yanked": true` in the version manifest (`--undo` reverses), so the change is ready to commit, rerun `registry/scripts/build-index.mjs`, and PR. Run it from inside the repo.

## Messaging & relay

Connect chat channels (Signal / WhatsApp / iMessage) to the host so inbound messages drive workflow runs and replies are delivered back. Channels are a **host-extension** surface (`/v1/host/sample/messaging`), not part of the normative OpenWOP wire — the protocol stays channel-agnostic.

```bash
openwop relay setup --channel signal        # register + activate a device, store its token
openwop relay start                          # bridge loop: heartbeat → poll outbound → deliver → ack
openwop relay send --conversation +15551234 --text "hi"   # operator-side: queue an outbound
openwop relay status                         # probe the device token against the host
openwop messaging connectors list|add|enable|disable|test
openwop messaging sessions list|inspect|close
openwop messaging policy   get|set <connectorId>          # DM/group access + require-mention
openwop messaging routing  list|add|remove                # inbound match → bound workflow
openwop messaging identity list|show|create|link|unlink|delete   # cross-channel peer linking
openwop messaging logs     [--channel c] [--direction inbound|outbound] [--status s] [--limit n]
openwop notify email --to a@b.dev --text "hi" [--subject S]      # one-off dispatch
openwop notify sms   --to +15551234 --text "pong"
```

The operator subcommands manage the gateway beyond device wiring:

- **policy** — per-connector access: `set <id> --dm <pairing|allowlist|open|disabled> --group <allowlist|open|disabled> --require-mention <true|false>`. `get` returns the host default (DM pairing, groups allowlist-only, mention required) when none is stored.
- **routing** — `add --pattern "*" --workflow <id> [--channel c] [--priority n]` binds matching inbound conversations to a workflow; higher priority wins. `remove <ruleId>` deletes one.
- **identity** — links platform peers across channels into one logical person: `create --name N --peer <channel>:<peerId>`, `link <id> --peer …` (merges, de-duped), `unlink <id> --peer …`, `delete <id>`.
- **logs** — queries the delivery log (inbound ingested / outbound queued), filterable by channel, direction, status; `--limit` is clamped to `[1, 1000]`.
- **notify** — a one-off email/SMS dispatch (`POST …/messaging/notify`). The reference app returns a **synthetic receipt**; wiring a real provider (SES / Twilio) is a host concern.

How it works: the relay device owns the platform connection and bridges it to the host. Inbound messages POST to the host, which runs the bound workflow (default `sample.demo.uppercase`; override with `OPENWOP_MESSAGING_WORKFLOW_ID`) and queues the reply; the device pulls + delivers it. `doctor` reports per-channel readiness:

- **Signal** needs [`signal-cli`](https://github.com/AsamK/signal-cli) on `PATH`.
- **iMessage** needs macOS (Messages signed in + Full Disk Access for `chat.db`).
- **WhatsApp** ships with the channel build (Baileys), not the core CLI.

`relay start` also **receives**: each channel plugin streams inbound platform messages and forwards them to the host's `/device/inbound` (which runs the bound workflow and queues a reply). Signal uses `signal-cli ... receive`, iMessage polls `chat.db` by ROWID, WhatsApp binds Baileys `messages.upsert`. Disable inbound with `--no-receive`. When a channel's tooling isn't present, inbound is skipped and outbound prints to the console instead of silently dropping it.

The relay **device token** is a host credential, so it is stored separately from `config.json` in `~/.openwop/relay-credentials.json` (mode `0600`), not in your main config. Revoke it any time with `openwop relay revoke`.

## Runs

Beyond `runs create` / `list` / `get` / `cancel`, the CLI surfaces a run's full inspection + review surface:

```bash
openwop runs events <runId> [--since <seq>] [--limit n]   # JSON event poll (GET .../events/poll)
openwop runs annotations <runId>                          # list review signals
openwop runs annotate <runId> --rating 5 [--note "great"] # attach a rating/label/correction/flag
openwop runs annotate <runId> --label triage --event-id <id>
openwop runs debug-bundle <runId> [--max-events n] [--out bundle.json]
openwop runs ancestry <runId>                             # RFC 0040 cross-host parent chain
```

`runs events --since N` maps to the spec-canonical `lastSequence` query param (events with `sequence > N`). `runs annotate` posts exactly one signal kind (`--rating 1-5` | `--label` | `--correction` | `--flag`), validated client-side. `runs debug-bundle --out <file>` saves the full event bundle to disk.

## Operator surfaces

Beyond runs/workflows/catalog, the CLI surfaces the host's operator endpoints: `agents`, `memory`, `media`, `webhooks`, `chat`, plus `notifications` (inbox), `interrupts` (list/resolve human-in-the-loop pauses), and `prompts` (RFC 0029 library list/get/render). Every command supports `--json`.

Two maintenance commands guard destructive operations behind a confirmation prompt (default *no*, bypass with `--confirm`):

```bash
openwop account delete                 # irreversibly wipe ALL data for the signed-in account
openwop admin cleanup                   # wipe expired ephemeral secrets for idle tenants
openwop admin cleanup --status          # read-only liveness probe
```

`account delete` requires a signed-in user (OIDC bearer). `admin` routes are gated by the host's `OPENWOP_ADMIN_TOKEN` — pass it via `--api-key`.

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
