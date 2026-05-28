import type { Ctx } from './context.js';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync, createReadStream, existsSync, mkdirSync, openSync,
  readFileSync, readdirSync, rmSync, statSync, watch, writeFileSync,
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve as resolvePath } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign as ed25519Sign, verify as ed25519Verify } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { getChannelPlugin } from './channels/registry.js';
import type { ChannelPlugin, InboundMessage, RelayChannel } from './channels/types.js';
// Re-export the channel surface so the test suite (which imports the built
// dist/cli.js bundle) can reach the pure normalizers + the registry.
export { parseSignalEnvelope, parseImessageRow, parseWhatsappMessage, decodeAttributedBodyHex } from './channels/normalize.js';
export { getChannelPlugin } from './channels/registry.js';

// ── Foundational layer (extracted from the former monolith) ──
import { CliError, HttpError, errText } from './errors.js';
import {
  VERSION, DEFAULT_BASE_URL, DEFAULT_REGISTRY_URL, DEFAULT_API_KEY,
  TERMINAL_STATUSES, PROVIDER_CATALOG, HOST_PRESETS,
} from './constants.js';
import { write, writeLine, writeJson, formatTable, prefixChunk } from './io.js';
import { extractGlobalOptions, parseOptions, splitFlag, takeValue, toOptionName } from './options.js';
import {
  configPathFor, readConfigSafe, saveConfig, mergeConfig,
  getByPath, setByPath, unsetByPath, openwopHomeDir,
} from './config.js';
import { requestJson, safeRequest, probeEndpoint, parseJsonResponse } from './api.js';
import { sleep } from './util.js';
import {
  daemonPidPath, daemonLogPath, readDaemonRecord, writeDaemonRecord,
  clearDaemonRecord, processAlive, openLogStream, writeLog, buildServiceInstallPlan,
} from './daemon.js';
export { daemonPidPath, daemonLogPath, readDaemonRecord, processAlive, buildServiceInstallPlan };
import { promptChoice, promptText, promptYesNo, readSecret } from './prompt.js';
import { findRepoRoot, requireRepoRoot, demoProjects, project } from './repo.js';
export { findRepoRoot };
import { submitTurn, streamRunEvents, consumeSse, renderEvent, extractAssistantText, defaultReadTurn } from './sse.js';
// Command groups (src/cli/<group>.ts).
import { runNotifications, NOTIFICATIONS_HELP } from './cli/notifications.js';
import { runInterrupts, INTERRUPTS_HELP } from './cli/interrupts.js';
import { runPrompts, PROMPTS_HELP } from './cli/prompts.js';
import { runWebhooks, WEBHOOKS_HELP } from './cli/webhooks.js';
import { runCron, CRON_HELP } from './cli/cron.js';
import { runHealth, HEALTH_HELP } from './cli/health.js';
import { runCapabilities, CAPABILITIES_HELP, summarizeCapabilities } from './cli/capabilities.js';
import { runMemory, MEMORY_HELP } from './cli/memory.js';
import { runMedia, MEDIA_HELP } from './cli/media.js';
import {
  buildInputs, parseInputValue, parseNodeVersion, defaultApiKeyFor,
  normalizeBaseUrl, npmCommand, ok, warn, fail, formatCheckTable,
} from './cli/shared.js';
import { runConfig, CONFIG_HELP } from './cli/config.js';
import { runCatalog, CATALOG_HELP } from './cli/catalog.js';
import { runWorkflows, WORKFLOWS_HELP } from './cli/workflows.js';
import { runAgents, AGENTS_HELP } from './cli/agents.js';
import { runConformance, CONFORMANCE_HELP } from './cli/conformance.js';
import { runAccount, ACCOUNT_HELP } from './cli/account.js';
import { runAdmin, ADMIN_HELP } from './cli/admin.js';
import { runRuns, RUNS_HELP } from './cli/runs.js';
import { runChat, CHAT_HELP } from './cli/chat.js';
import { runMessaging, MESSAGING_HELP } from './cli/messaging.js';
import { runNotify, NOTIFY_HELP } from './cli/notify.js';
import { runRelay, RELAY_HELP, startInboundReceive } from './cli/relay.js';
import { loadRelayConfig, detectChannelAvailability } from './cli/relayShared.js';
export { startInboundReceive, detectChannelAvailability };
import { runOnboard, ONBOARD_HELP } from './cli/onboard.js';
import { runProviders, PROVIDERS_HELP } from './cli/providers.js';
import { runPacks, PACKS_HELP } from './cli/packs.js';
import { runDoctor, DOCTOR_HELP } from './cli/doctor.js';
import {
  runDemo, runDemoStatus, DEMO_HELP, DEMO_STATUS_HELP, DEMO_START_HELP, DEMO_STOP_HELP,
  DEMO_RESTART_HELP, DEMO_LOGS_HELP, DEMO_INSTALL_HELP, DEMO_URLS_HELP,
} from './cli/demo.js';
// Public surface re-exported for the test suite + bin (they import the bundle).
export { VERSION, DEFAULT_BASE_URL, DEFAULT_REGISTRY_URL, PROVIDER_CATALOG, HOST_PRESETS };
export { submitTurn, streamRunEvents, consumeSse, renderEvent, extractAssistantText };
export { summarizeCapabilities };
export { formatTable };
export { extractGlobalOptions };
export { configPathFor, readConfigSafe, saveConfig, openwopHomeDir };

export async function runCli(argv: string[], options: any = {}): Promise<number> {
  const io = options.io ?? {
    stdout: process.stdout,
    stderr: process.stderr,
  };
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  try {
    if (typeof fetchImpl !== 'function') {
      throw new CliError('This CLI requires a Node runtime with global fetch (Node 20+).');
    }

    const parsed = extractGlobalOptions(argv, env);
    const ctx = {
      cwd,
      env,
      io,
      fetchImpl,
      baseUrl: normalizeBaseUrl(parsed.globals.baseUrl ?? env.OPENWOP_BASE_URL ?? DEFAULT_BASE_URL),
      apiKey: parsed.globals.apiKey ?? env.OPENWOP_API_KEY,
      json: parsed.globals.json,
      quiet: parsed.globals.quiet,
      verbose: parsed.globals.verbose,
      repoRoot: options.repoRoot ?? findRepoRoot(cwd),
      // Test seam: an injected per-turn stdin reader for `openwop chat`.
      // Resolves with each line, or null on EOF. Defaults to a readline-
      // backed reader when absent.
      readTurn: options.readTurn,
    };
    ctx.apiKey = ctx.apiKey ?? defaultApiKeyFor(ctx.baseUrl);

    const args = parsed.args;
    if (parsed.globals.version) {
      writeLine(io.stdout, VERSION);
      return 0;
    }
    if (parsed.globals.help || args.length === 0) {
      write(io.stdout, ROOT_HELP);
      return 0;
    }

    const command = args[0];
    const commandArgs = args.slice(1);

    switch (command) {
      case 'help':
        return await showHelp(io, commandArgs[0]);
      case 'doctor':
        return await runDoctor(ctx, commandArgs);
      case 'demo':
        return await runDemo(ctx, commandArgs);
      case 'status':
        return await runDemoStatus(ctx, commandArgs);
      case 'health':
        return await runHealth(ctx, commandArgs);
      case 'capabilities':
      case 'caps':
        return await runCapabilities(ctx, commandArgs);
      case 'catalog':
        return await runCatalog(ctx, commandArgs);
      case 'packs':
      case 'pack':
        return await runPacks(ctx, commandArgs);
      case 'workflows':
      case 'workflow':
        return await runWorkflows(ctx, commandArgs);
      case 'runs':
      case 'run':
        return await runRuns(ctx, commandArgs);
      case 'chat':
        return await runChat(ctx, commandArgs);
      case 'memory':
        return await runMemory(ctx, commandArgs);
      case 'media':
        return await runMedia(ctx, commandArgs);
      case 'conformance':
        return await runConformance(ctx, commandArgs);
      case 'onboard':
        return await runOnboard(ctx, commandArgs);
      case 'providers':
      case 'provider':
        return await runProviders(ctx, commandArgs);
      case 'agents':
      case 'agent':
        return await runAgents(ctx, commandArgs);
      case 'config':
        return await runConfig(ctx, commandArgs);
      case 'webhooks':
      case 'webhook':
        return await runWebhooks(ctx, commandArgs);
      case 'cron':
        return await runCron(ctx, commandArgs);
      case 'messaging':
        return await runMessaging(ctx, commandArgs);
      case 'relay':
        return await runRelay(ctx, commandArgs);
      case 'notifications':
      case 'notification':
        return await runNotifications(ctx, commandArgs);
      case 'interrupts':
      case 'interrupt':
        return await runInterrupts(ctx, commandArgs);
      case 'prompts':
      case 'prompt':
        return await runPrompts(ctx, commandArgs);
      case 'notify':
        return await runNotify(ctx, commandArgs);
      case 'account':
        return await runAccount(ctx, commandArgs);
      case 'admin':
        return await runAdmin(ctx, commandArgs);
      default:
        throw new CliError(`Unknown command: ${command}\nRun \`openwop --help\` for usage.`);
    }
  } catch (err) {
    if (err instanceof CliError) {
      writeLine(io.stderr, `openwop: ${err.message}`);
      return err.code;
    }
    if (err instanceof HttpError) {
      const bodyMessage = err.body && typeof err.body === 'object' && typeof (err.body as { message?: string }).message === 'string'
        ? `: ${(err.body as { message?: string }).message}`
        : '';
      writeLine(io.stderr, `openwop: HTTP ${err.status}${bodyMessage}`);
      if (options.debugErrors) writeLine(io.stderr, String(err.stack ?? err));
      return err.status >= 500 ? 1 : 2;
    }
    writeLine(io.stderr, `openwop: ${err instanceof Error ? err.message : String(err)}`);
    if (options.debugErrors) writeLine(io.stderr, String(err instanceof Error ? err.stack : err));
    return 1;
  }
}

function showHelp(io: any, command: any) {
  const map: Record<string, string> = {
    demo: DEMO_HELP,
    runs: RUNS_HELP,
    run: RUNS_HELP,
    chat: CHAT_HELP,
    workflows: WORKFLOWS_HELP,
    workflow: WORKFLOWS_HELP,
    catalog: CATALOG_HELP,
    packs: PACKS_HELP,
    pack: PACKS_HELP,
    onboard: ONBOARD_HELP,
    providers: PROVIDERS_HELP,
    provider: PROVIDERS_HELP,
    agents: AGENTS_HELP,
    agent: AGENTS_HELP,
    config: CONFIG_HELP,
    doctor: DOCTOR_HELP,
    health: HEALTH_HELP,
    capabilities: CAPABILITIES_HELP,
    caps: CAPABILITIES_HELP,
    media: MEDIA_HELP,
    conformance: CONFORMANCE_HELP,
    memory: MEMORY_HELP,
    webhooks: WEBHOOKS_HELP,
    webhook: WEBHOOKS_HELP,
    cron: CRON_HELP,
    messaging: MESSAGING_HELP,
    relay: RELAY_HELP,
    notifications: NOTIFICATIONS_HELP,
    notification: NOTIFICATIONS_HELP,
    interrupts: INTERRUPTS_HELP,
    interrupt: INTERRUPTS_HELP,
    prompts: PROMPTS_HELP,
    prompt: PROMPTS_HELP,
    notify: NOTIFY_HELP,
    account: ACCOUNT_HELP,
    admin: ADMIN_HELP,
  };
  write(io.stdout, map[command] ?? ROOT_HELP);
  return 0;
}










// ─────────────────────────────────────────────────────────────────────────────
// packs — operate the signed node-pack registry (gap 6 / item C-5).
//
// The registry is a separate surface from the host --base-url. It serves the
// FINAL v1 endpoints documented in registry/README.md + .well-known/openwop-
// registry.json:
//   GET /v1/index.json                       full catalog
//   GET /v1/packs/{name}/index.json          per-pack metadata + versions
//   GET /v1/packs/{name}/-/{version}.json    version manifest
//   GET /v1/packs/{name}/-/{version}.tgz     signed tarball
//   GET /v1/packs/{name}/-/{version}.sig     detached Ed25519 signature
//   GET /keys/{keyId}.pub                     publisher public key (PEM)
// ─────────────────────────────────────────────────────────────────────────────


/** Resolve the registry base URL: --registry-url > OPENWOP_REGISTRY_URL > default. */

/** GET + JSON-parse a registry path (no auth — the registry is public read-only). */

/** GET raw bytes (tarball / signature / public key) from the registry. */






// ─── packs helpers (shared with build-pack-tarball.mjs conventions) ──────────

/** RFC 8785-style key-sorted canonical JSON — matches build-pack-tarball.mjs. */

/** Config home (honors OPENWOP_CONFIG_HOME), used for the local pack cache. */

/** Extract raw pack.json bytes from a gzipped USTAR tarball — mirrors verify-signatures.mjs. */

/** Walk a pack source dir into deterministic USTAR entries — mirrors build-pack-tarball.mjs. */

/** Deterministic gzipped USTAR writer — mirrors build-pack-tarball.mjs. */










// ─────────────────────────────────────────────────────────────────────────────
// `openwop chat <workflowId>` — interactive streaming REPL (item C-7)
//
// Each user turn creates a fresh run for <workflowId> (reusing the same
// POST /v1/runs machinery as `runs create`) carrying the full conversation
// `messages` array, then streams that run's events to the terminal. SSE is
// preferred (GET /v1/runs/{runId}/events as text/event-stream); we fall back
// to the JSON poll endpoint (GET .../events/poll) when SSE is unavailable.
// ─────────────────────────────────────────────────────────────────────────────



/**
 * Create a run for one chat turn. Mirrors the POST body that `runs create`
 * builds. Returns the new runId.
 */


// Gap D-2 — media helpers wired to the demo backend's sample media routes
// (POST /v1/host/sample/media/{generate-image,transcribe,synthesize}),
// which exercise the core.openwop.ai image-generate / audio-transcribe /
// audio-synthesize node family. The demo backend STUBS the actual provider
// calls (it honestly advertises aiProviders.imageGeneration: supported:false)
// so these produce deterministic fixture assets — real, downloadable, but
// not a live generation. Responses are tagged `stub: true`.



// ─────────────────────────────────────────────────────────────────────────────
// `openwop memory ...` — read the demo MemoryAdapter ledger (RFC 0004)
//
// Backed by the host-extension routes:
//   GET    /v1/host/sample/memory[?memoryRef=&tag=&limit=]
//   GET    /v1/host/sample/memory/:memoryId[?memoryRef=]
//   DELETE /v1/host/sample/memory/:memoryId[?memoryRef=]
//
// CTI-1: the backend scopes every read/delete to the caller's principal
// (`req.tenantId`), NEVER a query value, so the CLI cannot cross a tenant
// boundary. We pass `--memory-ref` (the agent-derived ref) but never a
// tenantId — tenant selection is the API key's job (--api-key / OPENWOP_API_KEY).
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Onboarding wizard — `openwop onboard`
// ─────────────────────────────────────────────────────────────────────────────







// ─────────────────────────────────────────────────────────────────────────────
// `openwop providers ...`
// ─────────────────────────────────────────────────────────────────────────────






// ─────────────────────────────────────────────────────────────────────────────
// `openwop agents ...`
// ─────────────────────────────────────────────────────────────────────────────
//
// RFC 0070 — manifest-agent runtime. The demo backend loads pack `agents[]`
// (RFC 0003) into an AgentRegistry and advertises `agents.manifestRuntime`.
// `list`/`info` render that registry-backed inventory at the sample-extension
// route `/v1/host/sample/agents`; `run` dispatches one agent turn via
// `POST /v1/host/sample/agents/{agentId}/dispatch` (toolAllowlist-filtered,
// handoff-validated, confidence-escalating per RFC 0002 §A14/§F).


// ─────────────────────────────────────────────────────────────────────────────
// `openwop config ...`
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Messaging relay-gateway (demo host-extension — /v1/host/sample/messaging).
// Operator endpoints use the host bearer; the device loop authenticates with
// the per-device token in the x-openwop-device-token header.
// ─────────────────────────────────────────────────────────────────────────────


// The relay record carries the device token — a bearer-equivalent host
// credential. It is kept OUT of config.json (which holds only non-secret
// settings + BYOK refs) and written to a dedicated 0600 file, preserving the
// CLI's "no secrets in config.json" posture (see cli/README §Config).










/** Parse repeated `--peer <channel>:<peerId>` flags into peer objects. */

// ─────────────────────────────────────────────────────────────────────────────
// notify — one-off email/sms dispatch via the demo host (synthetic receipt).
// ─────────────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────────
// account — tenant self-service (hard-delete all data for the signed-in user).
// ─────────────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────────
// admin — operator maintenance (ephemeral-secret cleanup). Admin-token gated:
// pass the host's OPENWOP_ADMIN_TOKEN via --api-key.
// ─────────────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────────
// Relay device — register/activate a local channel relay, run the bridge loop.
// ─────────────────────────────────────────────────────────────────────────────









/**
 * The relay bridge loop: heartbeat + poll outbound + deliver + ack. Channel
 * delivery is pluggable via `deliver` (Phase 3 injects signal/whatsapp/imessage
 * plugins); the default "console" delivery prints the egress, which makes the
 * transport loop observable and testable without platform credentials.
 */

/**
 * Start streaming inbound platform messages → POST /device/inbound (B4). The
 * channel plugin owns the platform connection (signal-cli / chat.db / Baileys);
 * `ctx.relayPlugin` lets tests inject a fake. Returns a stop function (or
 * undefined when the channel's tooling isn't available — fail-closed, logged).
 */




/**
 * Detect whether a messaging channel can run on this host. Pure-ish (only
 * probes the environment) so doctor + relay can report readiness and fail
 * closed rather than pretend a channel works. Phase 3 channel plugins reuse
 * this before attempting platform I/O.
 */

/**
 * Build the outbound-delivery function for a channel. When the channel's
 * platform tooling is present, deliver natively (signal-cli / AppleScript);
 * otherwise fall back to console delivery so the bridge stays observable and
 * never silently drops a message. Tests inject ctx.relayDeliver to bypass this.
 */


// ─────────────────────────────────────────────────────────────────────────────
// Config file + path utilities
// ─────────────────────────────────────────────────────────────────────────────



const ROOT_HELP = `openwop - operate OpenWOP hosts and the workflow-engine demo app

Usage:
  openwop [global options] <command> [options]

Global options:
  --base-url <url>    Host base URL (default: OPENWOP_BASE_URL or http://localhost:8080)
  --api-key <key>     Bearer API key (default: OPENWOP_API_KEY, or sample-token for localhost)
  --json              Print machine-readable JSON where supported
  --quiet             Suppress non-essential output
  --verbose           Print extra diagnostics
  --version           Print CLI version
  --help, -h          Show help

Commands:
  onboard             Guided first-run setup (host + provider + model + BYOK key)
  providers list      List stored BYOK credential refs (never values)
  providers add       Store a credential ref against the configured host
  providers remove    Remove a credential ref
  providers test      Verify the credential ref is reachable
  config file         Print the local config file path
  config get|set|unset  Read or modify ~/.openwop/config.json
  doctor              Check local prerequisites and demo reachability
  demo status         Inspect the workflow-engine demo app
  demo start          Start the demo backend and frontend (--detach to background)
  demo stop           Stop the tracked demo backend
  demo restart        Restart the demo backend
  demo logs           Tail the demo backend log (--follow to stream)
  demo install        Install a managed service (LaunchAgent / systemd / Scheduled Task)
  demo urls           Print local demo URLs
  health              Probe /health and /readiness
  capabilities        Summarize /.well-known/openwop
  catalog nodes       List demo node catalog entries
  catalog packs       List installed packs
  packs search        Search the signed pack registry
  packs info          Show pack metadata + versions
  packs install       Download + signature-verify a pack tarball
  packs publish       Package + Ed25519-sign a local pack (PR-based publish)
  packs yank          Mark a published version unavailable
  workflows list      List registered demo workflows
  workflows register  Register a workflow JSON file with the demo app
  runs create         Create a run
  runs list           List recent runs
  runs events         Poll a run's events (JSON)
  runs annotate       Attach a review signal (rating/label/correction/flag)
  runs annotations    List a run's annotations
  runs debug-bundle   Export a run's event bundle (--out to save)
  chat                Interactive streaming chat REPL over a workflow
  memory list         List demo MemoryAdapter entries (tenant-scoped)
  memory search       Search memory entries by text or tag
  memory get          Show one memory entry
  memory delete       Delete one memory entry
  runs ancestry       Show a run's cross-host parent chain (RFC 0040)
  agents list         List agent-attributed node roles on the host
  agents info         Show one agent role's details
  webhooks list       List webhook subscriptions
  webhooks add        Register a webhook subscription
  webhooks remove     Delete a webhook subscription
  webhooks test       Fire a signed test delivery
  cron list           List scheduled (cron) jobs
  cron add            Schedule a cron job
  cron remove         Delete a scheduled job
  cron trigger        Fire a scheduled job once now
  messaging connectors  Manage messaging relay connectors
  messaging sessions  List/inspect/close messaging sessions
  messaging policy    Get/set per-connector DM + group access policy
  messaging routing   List/add/remove inbound→workflow routing rules
  messaging identity  Link platform peers into one cross-channel identity
  messaging logs      Query the messaging delivery log
  notify email|sms    Dispatch a one-off email/SMS notification
  account delete      Permanently delete all data for the signed-in account
  admin cleanup       Wipe expired ephemeral secrets (--status for read-only)
  relay setup         Register + activate a local channel relay
  relay start         Run the relay bridge loop (--daemon to background)
  relay stop          Stop the background relay daemon
  relay logs          Print/follow the relay daemon log
  relay send          Queue an outbound message for a relay
  relay status        Probe the relay device token against the host
  notifications list  List notification inbox entries (tenant-scoped)
  notifications read  Mark a notification read/unread/archived
  interrupts list     List a run's open (HITL) interrupts
  interrupts resolve  Resolve an interrupt by token
  prompts list        Browse the host prompt library
  prompts render      Render a prompt template with variables
  media generate-image  Generate an image via the demo media route (stubbed)
  media transcribe    Transcribe an audio file (stubbed)
  media synthesize    Synthesize speech from text (stubbed)
  conformance         Run the OpenWOP conformance CLI from this repo

Examples:
  openwop onboard
  openwop providers add anthropic --api-key-env ANTHROPIC_API_KEY
  openwop doctor
  openwop demo start
  openwop demo status --json
  openwop capabilities --base-url http://localhost:8080
  openwop catalog nodes --search ai --limit 20
  openwop runs create sample.demo.uppercase --input text=hello --wait
  openwop packs search ads --json
  openwop packs install community.openwop-team.demo --version 0.1.0
`;
























