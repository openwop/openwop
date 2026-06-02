---
name: update-cli
description: Sync the OpenWOP CLI (cli/, @openwop/cli) to the demo app's latest protocol-enabled capabilities. Detects demo-app backend routes / advertised capabilities (/.well-known/openwop) that the CLI doesn't yet surface, then adds or extends command groups in cli/src/cli/<group>.ts, wires them into the cli.ts dispatcher, updates help + README + tests, and verifies (typecheck + build + node --test + a live smoke against a running demo app).
---

# Update OpenWOP CLI (openwop)

You are now in **CLI Update Mode** — a workflow for bringing the OpenWOP CLI (`cli/`, published as `@openwop/cli`) up to date with the latest capabilities the demo app (`apps/workflow-engine`) exposes, **as enabled by the protocol**.

## Task: $ARGUMENTS

The CLI is the local control plane for the demo app. Every protocol surface the demo app added — agent roster, org-chart, kanban boards, orgs/teams/roles RBAC, workspaces, BYOK, MCP, budgets, etc. — should be reachable from `openwop <group> ...`. This skill closes the gap between *what the demo app now serves* and *what the CLI can drive*.

Unlike a separate-repo CLI, **this CLI lives in the same monorepo** as the demo app it targets. There is no cross-repo sync — both move together — but the CLI still lags the backend whenever a new route lands without a matching command group. Your job is to find and close that lag.

---

## Reference

- **CLI package:** `cli/` — `@openwop/cli`, bin `openwop`, TypeScript, esbuild-bundled, **zero runtime deps**, ESM, Node 20 target (install requires Node 22+).
- **CLI entry → dispatcher:** `cli/src/openwop.ts` → `runCli()` in **`cli/src/cli.ts`** (the big `switch (command)` that routes each group).
- **CLI user guide:** `cli/README.md`
- **Demo app backend:** `apps/workflow-engine/backend/typescript/` — Express server, routes at `src/routes/<domain>.ts`, mounted in `src/index.ts`, host services in `src/host/*Service.ts`.
- **Demo app architecture:** `apps/workflow-engine/ARCHITECTURE.md`
- **Protocol source-of-truth for "what's enabled":** the capability advertisement at `/.well-known/openwop` (served by `apps/workflow-engine/backend/typescript/src/routes/discovery.ts`), the spec corpus (`spec/v1/`, `RFCS/`), and `api/openapi.yaml`.

---

## CLI Architecture Overview

### Command-group pattern (the unit of work)

Every command group is a single file `cli/src/cli/<group>.ts` that exports two symbols:

```ts
export const <GROUP>_HELP = `Usage:\n  openwop <group> <sub> [...]\n...`;   // printed on --help/-h
export async function run<Group>(ctx: Ctx, argv: string[]): Promise<number> { ... }  // returns exit code
```

`cli/src/cli/agents.ts` is the **canonical example** — read it before writing a new group. It shows the house style:
- a top-of-file docblock citing the RFC the surface comes from (`/** openwop agents ... — manifest-agent inventory + dispatch (RFC 0070). */`),
- a `<GROUP>_HELP` string with `Usage:`, a normative-grounded prose paragraph (which endpoint + which RFC §), per-flag docs, **meaningful exit codes** (agents: `0` completed / `3` escalated / `1` failed) so scripts can branch, and `Examples:`,
- a `run<Group>` that reads `argv[0]` as the subcommand, dispatches, and returns a number.

> **Option-key gotcha (this bites every new group).** `parseOptions` stores flags under the key returned by `toOptionName`, which **camelCases on hyphens**: `--agent-ref` → `options.agentRef`, `--no-validate` → `options.noValidate`, `--content-type` → `options.contentType`. Reading `options['agent-ref']` (hyphenated) silently returns `undefined` — the value is there under the camelCase key. (Existing code in `agents.ts` had this exact latent bug for `--task-json`/`--no-validate`.) Always read the camelCased key.

### Shared helpers (use these — do not hand-roll)

| Concern | Import from | Symbols |
|---|---|---|
| HTTP to the host | `../api.js` | `requestJson`, `safeRequest`, `probeEndpoint`, `parseJsonResponse` |
| Output | `../io.js` | `write`, `writeLine`, `writeJson`, `formatTable`, `prefixChunk` |
| Arg parsing | `../options.js` | `parseOptions`, `extractGlobalOptions`, `splitFlag`, `takeValue`, `toOptionName` |
| Run context | `../context.js` | `Ctx` (carries `io`, base URL, auth, config) |
| Errors | `../errors.js` | `CliError`, `HttpError`, `errText` |
| Streaming (SSE) | `../sse.js` | `submitTurn`, `streamRunEvents`, `consumeSse`, `renderEvent` |
| Interactive prompts | `../prompt.js` | `promptChoice`, `promptText`, `promptYesNo`, `readSecret` |
| Repo discovery | `../repo.js` | `findRepoRoot`, `requireRepoRoot`, `demoProjects`, `project` |

Conventions that matter:
- **`--json` everywhere.** Every read subcommand supports `--json` for machine output (via `writeJson`); the default is a `formatTable` human view.
- **No new runtime deps.** The CLI bundles to a single file with `--packages=external` and ships zero deps. Use Node stdlib + the helpers above.
- **Auth + base URL come from `Ctx`**, resolved by `onboard`/`config`. Don't read env or prompt for the base URL inside a command — take it from `ctx`.
- **Host-extension vs normative paths.** Demo-app-only surfaces live under `/v1/host/sample/*`; protocol-normative surfaces under `/v1/*` (e.g. `/v1/agents`). Prefer the normative path when the host serves it; fall back to the sample path otherwise. State which one a command hits in its help text.

### Current command groups (dispatcher in `cli/src/cli.ts`)

`account · admin · agents/agent · capabilities/caps · catalog · chat · config · conformance · cron · demo · doctor · health · interrupts/interrupt · media · memory · messaging · notifications/notification · notify · packs/pack · prompts/prompt · providers/provider · relay · runs/run · webhooks/webhook · workflows/workflow`

### Tests + build

- **Tests:** `cli/test/*.test.mjs`, run by `npm --prefix cli test` (which **builds first**, then `node --test`). Existing files: `cli.test.mjs`, `channels.test.mjs`, `messaging.test.mjs`, `operator-apis.test.mjs`. New operator-style command groups belong in `operator-apis.test.mjs` or a new `<group>.test.mjs`.
- **Typecheck:** `npm --prefix cli run typecheck` (`tsc --noEmit`).
- **Build:** `npm --prefix cli run build` → `cli/dist/openwop.js`.

---

## Workflow

### Step 1: Enumerate what the demo app now exposes

Build the authoritative list of capabilities from three sources, in order:

1. **Live capability advertisement (the protocol truth).** If a demo app is running (locally or `app.openwop.dev`):
   ```bash
   npm --prefix cli run build
   node cli/dist/openwop.js capabilities --json   # or: caps
   ```
   This is exactly what `/.well-known/openwop` advertises — the set of optional surfaces the host *claims*. Anything advertised but not driveable from the CLI is a gap.

2. **Backend route table.** The ground truth of HTTP surfaces:
   ```bash
   ls apps/workflow-engine/backend/typescript/src/routes/
   grep -rnoE "'/v1(/host/sample)?/[A-Za-z0-9/_:{}.-]+'" apps/workflow-engine/backend/typescript/src/routes/ | grep -v '\.test\.'
   ```
   Map each route file to a CLI group (e.g. `routes/kanban.ts` → a `kanban` group). Files with **no matching group** are candidate work — common gaps historically: `accessControl` (orgs/teams/groups/roles/members RBAC), `kanban` (boards), `orgChart`, `roster`, `workspace`, `byok`.

3. **Recent demo-app changes since the CLI last moved.**
   ```bash
   git log --oneline -30 -- apps/workflow-engine/backend/typescript/src/routes/ apps/workflow-engine/backend/typescript/src/host/
   git log --oneline -10 -- cli/                     # when did the CLI last change?
   ```
   Anything in the route/host history newer than the last `cli/` change is a likely sync target.

Tie each gap back to its **RFC / spec doc** (the surface exists because the protocol enables it). Grep `RFCS/` and `spec/v1/` for the capability name so the new command's help text + docblock can cite it the way `agents.ts` cites RFC 0070.

### Step 2: Decide — new group or extend existing

- **New protocol surface** (roster, org-chart, kanban, RBAC, workspace…) → **new group** `cli/src/cli/<group>.ts`.
- **New subcommand / flag on an existing surface** (a new agent operation, a new run field) → **extend the existing group's** `run<Group>` + `<GROUP>_HELP`.

If unsure or the gap list is large, ask the user which surfaces to prioritize — don't silently scope down. Report the full gap inventory and let them choose.

### Step 3: Implement

**For a new group:**
1. Create `cli/src/cli/<group>.ts` following the `agents.ts` shape: docblock citing the RFC, `<GROUP>_HELP`, `run<Group>(ctx, argv)`. Use `requestJson`/`safeRequest` against the host route, `formatTable` for the human view, `--json` for machine output, and meaningful exit codes.
2. Wire it into **`cli/src/cli.ts`**:
   - add the `import { run<Group>, <GROUP>_HELP } from './cli/<group>.js';` near the other group imports,
   - add a `case '<group>':` (and any alias, e.g. singular) to the `switch (command)`,
   - if the CLI has a top-level help index, add the group there too.
3. Add the group to `cli/README.md` (command reference) and to any `--help` top-level listing.

**For an extension:** edit the group's `run<Group>` to handle the new subcommand/flag and update `<GROUP>_HELP` to document it.

Principles:
- **Mirror the wire contract exactly.** Field names, required/optional, enum values must match the backend route's request/response and the schema in `api/openapi.yaml` / `schemas/`. The CLI is a reference client — getting a field name wrong teaches implementers wrong.
- **Capability-gate gracefully.** If the host doesn't advertise the surface, fail with a clear message (use `probeEndpoint`/`safeRequest`), not a stack trace — mirror how existing groups handle `HOST_CAPABILITY_MISSING`.
- **No user-facing jargon** in help/output: spell out "server"/"frontend"; BE/FE only in code comments. (Project rule.)

### Step 4: Verify

```bash
# Typecheck + build + tests (build is part of `test`)
npm --prefix cli run typecheck
npm --prefix cli test

# Smoke against a running demo app (local or app.openwop.dev).
# Bring one up locally if needed, then onboard the CLI at its base URL:
node cli/dist/openwop.js onboard
node cli/dist/openwop.js capabilities                 # confirms the surface is advertised
node cli/dist/openwop.js <group> list                 # human view
node cli/dist/openwop.js <group> list --json          # machine view round-trips
# Exercise a write path end-to-end where one exists (and clean up after).
```

> **Smoke-loop shell gotcha.** This environment's shell is **zsh**, which does NOT word-split unquoted `$var`. A loop like `for c in "roster list"; do openwop $c; done` passes `"roster list"` as a SINGLE argv token → "Unknown command". Use `${=c}` (zsh split) or call each command explicitly. The base URL for the deployed demo is `https://app.openwop.dev/api`; unauthenticated requests each get a throwaway `anon:<sid>` tenant, so a create on one invocation won't be visible to a list on the next (different tenant) — validate the write by asserting the `201` create response, not a follow-up list.

A new command is not "done" until it has driven the **live** demo-app route at least once — the host-extension stores are durable/read-through, so a `list`/`get` after a `create`/seed should round-trip (hold the `__session` cookie for the per-session `anon:<sid>` tenant if unauthenticated).

### Step 5: Report

Summarize:
- **Gap inventory** — which advertised capabilities / backend routes the CLI was missing.
- **What was added** — new groups + subcommands, each tied to its RFC and endpoint.
- **What was verified** — typecheck/build/test status + which live commands round-tripped against which host.
- **Docs touched** — `cli/README.md`, top-level help.
- **Version** — whether `cli/package.json` should bump (a CLI-only patch ships via the `openwop/v*`-style per-package tag path; see PUBLISHING.md — the CLI is independently versioned at 0.x and is NOT pinned to the corpus version).

---

## Common Update Scenarios

### A new demo-app surface landed (e.g. kanban, roster, org-chart, RBAC)
1. Confirm it's advertised: `openwop capabilities --json` shows the flag (or the route exists under `src/routes/`).
2. New group `cli/src/cli/<group>.ts` → `list`/`get`/`create`/… mapping 1:1 to the route's verbs.
3. Wire into `cli/src/cli.ts` (import + `case`), add to README + help.
4. Test file `cli/test/<group>.test.mjs` (or extend `operator-apis.test.mjs`).
5. Smoke against a live host; cite the RFC in help.

### An existing surface gained a field or subcommand
1. Find the group in `cli/src/cli/<group>.ts`.
2. Add the subcommand/flag; keep field names identical to the route + schema.
3. Update `<GROUP>_HELP`; add/extend a test; smoke it.

### A normative path superseded a host-sample path
The demo app may start serving `/v1/<thing>` where the CLI used `/v1/host/sample/<thing>`. Prefer the normative path; keep the sample path as a fallback only if older hosts still need it. Note the switch in help text and the CHANGELOG.

---

## Important Notes

- **In-repo, not a sub-repo.** Changes land in `cli/` in this monorepo. If `.claude/skills` is your only edit, no PR is needed; if you touch `cli/` source, follow the normal worktree → PR → `npm run openwop:check`-green → merge flow (CLI source is tracked).
- **Zero-dep, single-bundle.** Don't add npm dependencies; the esbuild bundle stays dependency-free. Use stdlib + the `cli/src/*.ts` helpers.
- **The capability advertisement is the contract.** Drive new commands off what `/.well-known/openwop` advertises and what `api/openapi.yaml` defines, not off backend internals — the CLI must work against *any* conformant host, not just this demo app.
- **`npx`/`tsc`/`vitest` exit 194 in this sandbox** — run `node node_modules/<pkg>/<entry>` directly if a wrapped binary silently fails (e.g. `node cli/dist/openwop.js ...` rather than `npx openwop`).
- **Rate limits on live hosts.** A command that fans out many reads on a shared host can trip the per-IP read budget (60/min) — batch reads; don't N+1 a per-row detail fetch.
