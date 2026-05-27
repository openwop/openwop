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
export { parseSignalEnvelope, parseImessageRow, parseWhatsappMessage } from './channels/normalize.js';
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

function showHelp(io, command) {
  const map = {
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

async function runDoctor(ctx: Ctx, argv) {
  const { options } = parseOptions(argv, { bool: ['--help'] });
  if (options.help) {
    write(ctx.io.stdout, DOCTOR_HELP);
    return 0;
  }

  const checks: Array<{ status: string; name: string; message: string }> = [];
  const node = parseNodeVersion(process.versions.node);
  if (node.major >= 22) {
    checks.push(ok('node', `Node ${process.versions.node} is ready for the demo backend`));
  } else if (node.major >= 20) {
    checks.push(warn('node', `Node ${process.versions.node} can run the CLI, but the demo backend declares Node >=22`));
  } else {
    checks.push(fail('node', `Node ${process.versions.node} is too old; install Node 22+`));
  }

  const npm = spawnSync(npmCommand(), ['--version'], { encoding: 'utf8' });
  if (npm.status === 0) checks.push(ok('npm', `npm ${npm.stdout.trim()}`));
  else checks.push(fail('npm', 'npm was not found on PATH'));

  const root = ctx.repoRoot;
  if (root) {
    checks.push(ok('repo', root));
  } else {
    checks.push(fail('repo', 'Could not locate the OpenWOP repository root'));
  }

  for (const project of demoProjects(root)) {
    if (!existsSync(project.packageJson)) {
      checks.push(fail(project.name, `Missing ${project.packageJson}`));
    } else if (existsSync(project.nodeModules)) {
      checks.push(ok(project.name, 'dependencies installed'));
    } else {
      checks.push(warn(project.name, `dependencies not installed; run npm install in ${project.relativeDir}`));
    }
  }

  const health = await probeEndpoint(ctx, '/health');
  if (health.ok) checks.push(ok('demo health', `${ctx.baseUrl}/health responded`));
  else checks.push(warn('demo health', `demo is not reachable at ${ctx.baseUrl} (${health.message})`));

  // Daemon-status row — prefer the live D-1 route; fall back to the PID file.
  const daemon = await safeRequest(ctx, '/v1/host/sample/daemon-status');
  if (daemon.ok && daemon.body) {
    const b = daemon.body;
    checks.push(ok('daemon', `pid ${b.pid ?? '?'}, up ${b.uptimeSeconds ?? '?'}s (since ${b.startTime ?? '?'})`));
  } else {
    const record = readDaemonRecord(ctx.env);
    if (record && record.pid && processAlive(record.pid)) {
      checks.push(warn('daemon', `PID file says pid ${record.pid} is running but ${ctx.baseUrl}/v1/host/sample/daemon-status is unreachable`));
    } else if (record && record.pid) {
      checks.push(warn('daemon', `stale PID file (pid ${record.pid} not running); run \`openwop demo stop\` to clear it`));
    } else {
      checks.push(warn('daemon', 'no demo backend daemon detected; start one with `openwop demo start --detach`'));
    }
  }

  // Provider-reachability rows — one per stored BYOK credential ref.
  const byok = await safeRequest(ctx, '/v1/host/sample/byok/secrets');
  if (byok.ok) {
    const secrets = Array.isArray(byok.body?.secrets) ? byok.body.secrets : [];
    if (secrets.length === 0) {
      checks.push(warn('providers', 'no BYOK credentials stored; run `openwop onboard` or `openwop providers add <provider>`'));
    } else {
      for (const secret of secrets) {
        const ref = typeof secret === 'string' ? secret : secret.credentialRef;
        checks.push(ok(`provider ${ref}`, 'credential stored on the host'));
      }
    }
  } else {
    checks.push(warn('providers', `could not list BYOK credentials (${byok.error})`));
  }

  // Messaging relay readiness — only meaningful once a relay is configured.
  const relay = loadRelayConfig(ctx);
  if (relay.relayId && relay.channel) {
    checks.push(ok('relay', `${relay.channel} relay ${relay.relayId} configured (host ${relay.baseUrl ?? ctx.baseUrl})`));
    const avail = detectChannelAvailability(relay.channel, ctx.env);
    checks.push(avail.available
      ? ok(`channel ${relay.channel}`, avail.detail)
      : warn(`channel ${relay.channel}`, avail.detail));
  } else {
    checks.push(warn('relay', 'no messaging relay configured; run `openwop relay setup --channel <signal|whatsapp|imessage>`'));
  }

  if (ctx.json) {
    writeJson(ctx.io.stdout, { checks });
  } else {
    writeLine(ctx.io.stdout, 'OpenWOP doctor');
    writeLine(ctx.io.stdout, formatCheckTable(checks));
  }
  return checks.some((c) => c.status === 'fail') ? 1 : 0;
}

async function runDemo(ctx: Ctx, argv: string[]): Promise<number> {
  const sub = argv[0];
  const args = argv.slice(1);
  if (!sub || sub === '--help' || sub === '-h') {
    write(ctx.io.stdout, DEMO_HELP);
    return 0;
  }
  switch (sub) {
    case 'status':
      return runDemoStatus(ctx, args);
    case 'start':
      return runDemoStart(ctx, args);
    case 'stop':
      return runDemoStop(ctx, args);
    case 'restart':
      return runDemoRestart(ctx, args);
    case 'logs':
      return runDemoLogs(ctx, args);
    case 'install':
      return runDemoInstall(ctx, args);
    case 'urls':
      return runDemoUrls(ctx, args);
    default:
      throw new CliError(`Unknown demo command: ${sub}\nRun \`openwop help demo\` for usage.`);
  }
}

async function runDemoStatus(ctx: Ctx, argv: string[]): Promise<number> {
  const { options } = parseOptions(argv, { bool: ['--help'] });
  if (options.help) {
    write(ctx.io.stdout, DEMO_STATUS_HELP);
    return 0;
  }

  const [health, readiness, caps, summary] = await Promise.all([
    safeRequest(ctx, '/health', { auth: false }),
    safeRequest(ctx, '/readiness', { auth: false }),
    safeRequest(ctx, '/.well-known/openwop', { auth: false }),
    safeRequest(ctx, '/v1/host/sample/demo-summary'),
  ]);

  const payload = {
    baseUrl: ctx.baseUrl,
    health,
    readiness,
    capabilities: caps.ok ? caps.body : null,
    demoSummary: summary.ok ? summary.body : null,
    errors: [health, readiness, caps, summary].filter((r) => !r.ok).map((r) => ({ path: r.path, error: r.error })),
  };

  if (ctx.json) {
    writeJson(ctx.io.stdout, payload);
    return health.ok && readiness.ok ? 0 : 1;
  }

  writeLine(ctx.io.stdout, 'OpenWOP demo status');
  writeLine(ctx.io.stdout, `Base URL: ${ctx.baseUrl}`);
  writeLine(ctx.io.stdout, `Health: ${health.ok ? 'ok' : `unreachable (${health.error})`}`);
  writeLine(ctx.io.stdout, `Readiness: ${readiness.ok ? 'ready' : `unreachable (${readiness.error})`}`);
  if (caps.ok) {
    const impl = caps.body.implementation ?? {};
    writeLine(ctx.io.stdout, `Implementation: ${impl.name ?? 'unknown'} ${impl.version ?? ''}`.trim());
    writeLine(ctx.io.stdout, `Protocol: ${caps.body.protocolVersion ?? 'unknown'}`);
  }
  if (summary.ok) {
    const demo = summary.body.demo ?? {};
    const nodes = demo.nodeCatalog ?? {};
    const workflows = demo.workflows ?? {};
    const surfaces = demo.hostSurfaces ?? {};
    writeLine(ctx.io.stdout, `Nodes: ${nodes.total ?? 0} (${nodes.runnable ?? 0} runnable)`);
    writeLine(ctx.io.stdout, `Workflows: ${workflows.registered ?? 0} registered, ${workflows.fixtures ?? 0} fixtures`);
    writeLine(ctx.io.stdout, `Host surfaces: ${surfaces.supported ?? 0}/${surfaces.total ?? 0} supported`);
  } else {
    writeLine(ctx.io.stdout, `Demo summary: unavailable (${summary.error})`);
  }
  return health.ok && readiness.ok ? 0 : 1;
}

async function runDemoUrls(ctx: Ctx, argv) {
  const { options } = parseOptions(argv, {
    bool: ['--help'],
    value: ['--frontend-port'],
  });
  if (options.help) {
    write(ctx.io.stdout, DEMO_URLS_HELP);
    return 0;
  }
  const frontendPort = Number(options.frontendPort ?? ctx.env.OPENWOP_DEMO_FRONTEND_PORT ?? 5173);
  const payload = {
    backend: ctx.baseUrl,
    frontend: `http://localhost:${frontendPort}`,
    health: new URL('/health', ctx.baseUrl).toString(),
    capabilities: new URL('/.well-known/openwop', ctx.baseUrl).toString(),
  };
  if (ctx.json) writeJson(ctx.io.stdout, payload);
  else {
    writeLine(ctx.io.stdout, `Backend: ${payload.backend}`);
    writeLine(ctx.io.stdout, `Frontend: ${payload.frontend}`);
    writeLine(ctx.io.stdout, `Health: ${payload.health}`);
    writeLine(ctx.io.stdout, `Capabilities: ${payload.capabilities}`);
  }
  return 0;
}

async function runDemoStart(ctx: Ctx, argv: string[]): Promise<number> {
  const { options } = parseOptions(argv, {
    bool: ['--help', '--backend-only', '--frontend-only', '--install', '--dry-run', '--detach'],
    value: ['--backend-port', '--frontend-port'],
  });
  if (options.help) {
    write(ctx.io.stdout, DEMO_START_HELP);
    return 0;
  }
  const root = requireRepoRoot(ctx);
  const backend = join(root, 'apps/workflow-engine/backend/typescript');
  const frontend = join(root, 'apps/workflow-engine/frontend/react');
  const backendPort = Number(options.backendPort ?? ctx.env.PORT ?? 8080);
  const frontendPort = Number(options.frontendPort ?? ctx.env.OPENWOP_DEMO_FRONTEND_PORT ?? 5173);
  const apiKey = ctx.apiKey ?? DEFAULT_API_KEY;
  const startBackend = !options.frontendOnly;
  const startFrontend = !options.backendOnly;

  if (!startBackend && !startFrontend) {
    throw new CliError('Choose at least one service to start.');
  }

  const commands: any[] = [];
  if (startBackend) commands.push({ label: 'backend', cwd: backend, cmd: npmCommand(), args: ['run', 'dev'] });
  if (startFrontend) commands.push({
    label: 'frontend',
    cwd: frontend,
    cmd: npmCommand(),
    args: ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(frontendPort)],
  });

  if (options.dryRun) {
    for (const command of commands) {
      writeLine(ctx.io.stdout, `${command.label}: cd ${relative(root, command.cwd)} && ${command.cmd} ${command.args.join(' ')}`);
    }
    return 0;
  }

  if (options.install) {
    for (const project of commands) {
      const result = spawnSync(npmCommand(), ['install'], { cwd: project.cwd, stdio: 'inherit', env: ctx.env });
      if (result.status !== 0) return result.status ?? 1;
    }
  }

  // Refuse to start a second instance over a still-running one.
  const existing = readDaemonRecord(ctx.env);
  if (existing && processAlive(existing.pid)) {
    throw new CliError(`A demo backend is already running (pid ${existing.pid}). Run \`openwop demo stop\` first or \`openwop demo restart\`.`);
  }

  const logPath = daemonLogPath(ctx.env);

  // Detached mode: spawn the backend as a background process, write a PID
  // file + log file, and return immediately so `stop`/`restart`/`logs`
  // can manage it later. Only the backend is daemonized; the frontend is
  // a dev tool meant to run in the foreground.
  if (options.detach) {
    if (!startBackend) {
      throw new CliError('--detach manages the backend; combine it without --frontend-only.');
    }
    mkdirSync(dirname(logPath), { recursive: true });
    const out = openSync(logPath, 'a');
    const err = openSync(logPath, 'a');
    const child = spawn(npmCommand(), ['run', 'dev'], {
      cwd: backend,
      env: { ...ctx.env, PORT: String(backendPort), OPENWOP_API_KEY: apiKey },
      stdio: ['ignore', out, err],
      detached: true,
    });
    child.unref();
    writeDaemonRecord(ctx.env, {
      pid: child.pid,
      startedAt: new Date().toISOString(),
      backendPort,
      baseUrl: `http://localhost:${backendPort}`,
      logPath,
      cwd: backend,
    });
    if (ctx.json) {
      writeJson(ctx.io.stdout, { pid: child.pid, backendPort, logPath, detached: true });
    } else {
      writeLine(ctx.io.stdout, `Started OpenWOP demo backend (pid ${child.pid}) at http://localhost:${backendPort}`);
      writeLine(ctx.io.stdout, `Logs: ${logPath}`);
      writeLine(ctx.io.stdout, 'Manage it with `openwop demo status|logs|stop|restart`.');
    }
    return 0;
  }

  writeLine(ctx.io.stdout, `Starting OpenWOP demo backend at http://localhost:${backendPort}`);
  if (startFrontend) writeLine(ctx.io.stdout, `Starting OpenWOP demo frontend at http://localhost:${frontendPort}`);
  writeLine(ctx.io.stdout, 'Press Ctrl-C to stop.');

  const children = commands.map((command) => {
    const env = {
      ...ctx.env,
      ...(command.label === 'backend'
        ? { PORT: String(backendPort), OPENWOP_API_KEY: apiKey }
        : {
            VITE_OPENWOP_BASE_URL: `http://localhost:${backendPort}`,
            VITE_OPENWOP_SSE_BASE_URL: `http://localhost:${backendPort}`,
            VITE_OPENWOP_API_KEY: apiKey,
          }),
    };
    const child = spawn(command.cmd, command.args, { cwd: command.cwd, env, stdio: ['inherit', 'pipe', 'pipe'] });
    // Mirror the backend's stdout/stderr into the daemon log file so
    // `openwop demo logs` works even for a foreground start.
    const logStream = command.label === 'backend' ? openLogStream(logPath) : null;
    child.stdout.on('data', (chunk) => {
      prefixChunk(ctx.io.stdout, command.label, chunk);
      if (logStream !== null) writeLog(logStream, chunk);
    });
    child.stderr.on('data', (chunk) => {
      prefixChunk(ctx.io.stderr, command.label, chunk);
      if (logStream !== null) writeLog(logStream, chunk);
    });
    child.on('error', (err) => writeLine(ctx.io.stderr, `${command.label}: ${err.message}`));
    if (command.label === 'backend' && child.pid) {
      writeDaemonRecord(ctx.env, {
        pid: child.pid,
        startedAt: new Date().toISOString(),
        backendPort,
        baseUrl: `http://localhost:${backendPort}`,
        logPath,
        cwd: backend,
        foreground: true,
      });
    }
    return { ...command, child };
  });

  const stop = () => {
    for (const { child } of children) {
      if (!child.killed) child.kill('SIGTERM');
    }
    clearDaemonRecord(ctx.env);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  const exitCode = await new Promise<number>((resolve) => {
    let settled = false;
    for (const { label, child } of children) {
      child.on('exit', (code, signal) => {
        if (settled) return;
        settled = true;
        if (signal) writeLine(ctx.io.stderr, `${label} stopped by ${signal}`);
        else writeLine(ctx.io.stderr, `${label} exited with ${code ?? 1}`);
        stop();
        resolve(code ?? 1);
      });
    }
  });
  return exitCode;
}

async function runDemoStop(ctx: Ctx, argv: string[]): Promise<number> {
  const { options } = parseOptions(argv, {
    bool: ['--help', '--force'],
    value: ['--timeout-ms'],
  });
  if (options.help) {
    write(ctx.io.stdout, DEMO_STOP_HELP);
    return 0;
  }
  const record = readDaemonRecord(ctx.env);
  if (!record || !record.pid) {
    writeLine(ctx.io.stdout, 'No demo backend PID file found; nothing to stop.');
    return 0;
  }
  if (!processAlive(record.pid)) {
    clearDaemonRecord(ctx.env);
    writeLine(ctx.io.stdout, `Process ${record.pid} is not running; cleared stale PID file.`);
    return 0;
  }

  const signal = options.force ? 'SIGKILL' : 'SIGTERM';
  try {
    process.kill(record.pid, signal);
  } catch (err) {
    if (err && (err as NodeJS.ErrnoException).code === 'EPERM') {
      throw new CliError(`Not permitted to signal pid ${record.pid}. It may belong to another user.`);
    }
    throw new CliError(`Failed to signal pid ${record.pid}: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Wait for the process to actually exit (unless we already SIGKILLed).
  const timeoutMs = Number(options.timeoutMs ?? 5000);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && processAlive(record.pid)) {
    await sleep(150);
  }
  if (processAlive(record.pid) && !options.force) {
    process.kill(record.pid, 'SIGKILL');
    await sleep(150);
  }

  clearDaemonRecord(ctx.env);
  if (ctx.json) writeJson(ctx.io.stdout, { stopped: record.pid, signal });
  else writeLine(ctx.io.stdout, `Stopped demo backend (pid ${record.pid}) with ${signal}.`);
  return 0;
}

async function runDemoRestart(ctx: Ctx, argv: string[]): Promise<number> {
  const { options } = parseOptions(argv, {
    bool: ['--help'],
    value: ['--backend-port'],
  });
  if (options.help) {
    write(ctx.io.stdout, DEMO_RESTART_HELP);
    return 0;
  }
  // restart = stop + detached start. Preserve the prior backend port unless
  // the caller overrides it.
  const prior = readDaemonRecord(ctx.env);
  const stopCode = await runDemoStop(ctx, []);
  if (stopCode !== 0) return stopCode;
  const startArgs = ['--detach', '--backend-only'];
  const port = options.backendPort ?? (prior ? String(prior.backendPort) : undefined);
  if (port) startArgs.push('--backend-port', port);
  return runDemoStart(ctx, startArgs);
}

async function runDemoLogs(ctx: Ctx, argv: string[]): Promise<number> {
  const { options } = parseOptions(argv, {
    bool: ['--help', '--follow'],
    value: ['--lines'],
  });
  if (options.help) {
    write(ctx.io.stdout, DEMO_LOGS_HELP);
    return 0;
  }
  const logPath = (readDaemonRecord(ctx.env)?.logPath) ?? daemonLogPath(ctx.env);
  if (!existsSync(logPath)) {
    writeLine(ctx.io.stderr, `No log file at ${logPath}. Start the demo with \`openwop demo start --detach\`.`);
    return 2;
  }

  const lineCount = Number(options.lines ?? 50);
  const existing = readFileSync(logPath, 'utf8');
  const lines = existing.split('\n');
  const tail = lines.slice(Math.max(0, lines.length - lineCount - 1));
  write(ctx.io.stdout, tail.join('\n'));
  if (tail.length && !tail[tail.length - 1].endsWith('\n')) writeLine(ctx.io.stdout, '');

  if (!options.follow) return 0;

  // Follow mode: stream new bytes appended after the current end of file.
  let offset = Buffer.byteLength(existing, 'utf8');
  return await new Promise((resolve) => {
    const emit = () => {
      let size;
      try { size = statSync(logPath).size; } catch { return; }
      if (size < offset) offset = 0; // truncated / rotated
      if (size === offset) return;
      const stream = createReadStream(logPath, { start: offset, end: size - 1, encoding: 'utf8' });
      stream.on('data', (chunk) => write(ctx.io.stdout, String(chunk)));
      stream.on('end', () => { offset = size; });
    };
    const watcher = watch(logPath, { persistent: true }, emit);
    const finish = () => {
      watcher.close();
      resolve(0);
    };
    process.once('SIGINT', finish);
    process.once('SIGTERM', finish);
  });
}

async function runDemoInstall(ctx: Ctx, argv) {
  const { options } = parseOptions(argv, {
    bool: ['--help', '--dry-run', '--uninstall'],
    value: ['--backend-port', '--label'],
  });
  if (options.help) {
    write(ctx.io.stdout, DEMO_INSTALL_HELP);
    return 0;
  }
  const root = requireRepoRoot(ctx);
  const backendPort = Number(options.backendPort ?? ctx.env.PORT ?? 8080);
  const label = options.label ?? 'dev.openwop.demo';
  const plan = buildServiceInstallPlan({
    platform: process.platform,
    root,
    backendPort,
    label,
    apiKey: ctx.apiKey ?? DEFAULT_API_KEY,
    env: ctx.env,
    uninstall: Boolean(options.uninstall),
  });

  if (plan.unsupported) {
    // Windows + any other platform: print clear guidance, no file write.
    if (ctx.json) writeJson(ctx.io.stdout, { platform: process.platform, supported: false, guidance: plan.guidance });
    else { writeLine(ctx.io.stdout, plan.guidance); }
    return 0;
  }
  // Past the unsupported branch a writable plan always carries path + contents;
  // assert it so strictNullChecks narrows them to string for the writes below.
  if (!plan.path || plan.contents === undefined) {
    throw new CliError('Service-install plan is incomplete (no path/contents).');
  }

  if (options.dryRun || ctx.json) {
    if (ctx.json) {
      writeJson(ctx.io.stdout, {
        platform: process.platform,
        action: options.uninstall ? 'uninstall' : 'install',
        path: plan.path,
        manager: plan.manager,
        activate: plan.activate,
        contents: plan.uninstall ? undefined : plan.contents,
      });
    } else {
      writeLine(ctx.io.stdout, `Would write ${plan.manager} unit to:`);
      writeLine(ctx.io.stdout, `  ${plan.path}`);
      if (!plan.uninstall) {
        writeLine(ctx.io.stdout, '--- file contents ---');
        write(ctx.io.stdout, plan.contents.endsWith('\n') ? plan.contents : `${plan.contents}\n`);
        writeLine(ctx.io.stdout, '--- end ---');
      }
      writeLine(ctx.io.stdout, `Activate with: ${plan.activate}`);
    }
    return 0;
  }

  if (plan.uninstall) {
    if (existsSync(plan.path)) {
      rmSync(plan.path);
      writeLine(ctx.io.stdout, `Removed ${plan.path}`);
    } else {
      writeLine(ctx.io.stdout, `No unit file at ${plan.path}; nothing to remove.`);
    }
    writeLine(ctx.io.stdout, `Deactivate any running instance with: ${plan.deactivate}`);
    return 0;
  }

  mkdirSync(dirname(plan.path), { recursive: true });
  writeFileSync(plan.path, plan.contents.endsWith('\n') ? plan.contents : `${plan.contents}\n`, 'utf8');
  try { chmodSync(plan.path, 0o644); } catch { /* best-effort */ }
  writeLine(ctx.io.stdout, `Wrote ${plan.manager} unit to ${plan.path}`);
  writeLine(ctx.io.stdout, `Activate with: ${plan.activate}`);
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

async function runPacks(ctx: Ctx, argv) {
  const sub = argv[0];
  const args = argv.slice(1);
  if (!sub || sub === '--help' || sub === '-h') {
    write(ctx.io.stdout, PACKS_HELP);
    return 0;
  }
  switch (sub) {
    case 'search':
      return runPacksSearch(ctx, args);
    case 'info':
      return runPacksInfo(ctx, args);
    case 'install':
      return runPacksInstall(ctx, args);
    case 'publish':
      return runPacksPublish(ctx, args);
    case 'yank':
      return runPacksYank(ctx, args);
    default:
      throw new CliError(`Unknown packs command: ${sub}\nRun \`openwop packs --help\` for usage.`);
  }
}

/** Resolve the registry base URL: --registry-url > OPENWOP_REGISTRY_URL > default. */
function registryUrlFor(options, env) {
  return normalizeBaseUrl(options.registryUrl ?? env.OPENWOP_REGISTRY_URL ?? DEFAULT_REGISTRY_URL);
}

/** GET + JSON-parse a registry path (no auth — the registry is public read-only). */
async function registryJson(ctx: Ctx, registryUrl, path) {
  const url = new URL(path, registryUrl + '/');
  const res = await ctx.fetchImpl(url, { method: 'GET', headers: { accept: 'application/json' } });
  const text = await res.text();
  const body = text.length > 0 ? parseJsonResponse(text) : null;
  if (!res.ok) throw new HttpError(`HTTP ${res.status}`, res.status, body);
  return body;
}

/** GET raw bytes (tarball / signature / public key) from the registry. */
async function registryBytes(ctx: Ctx, registryUrl, path) {
  const url = new URL(path, registryUrl + '/');
  const res = await ctx.fetchImpl(url, { method: 'GET', headers: { accept: 'application/octet-stream' } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new HttpError(`HTTP ${res.status}`, res.status, text ? parseJsonResponse(text) : null);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function runPacksSearch(ctx: Ctx, argv) {
  const { options, positionals } = parseOptions(argv, {
    bool: ['--help'],
    value: ['--registry-url', '--limit'],
  });
  if (options.help) {
    write(ctx.io.stdout, PACKS_HELP);
    return 0;
  }
  const query = String(positionals[0] ?? '').toLowerCase();
  const registryUrl = registryUrlFor(options, ctx.env);
  // The canonical file-backed registry serves the full catalog at
  // /v1/index.json; we filter client-side. (The dynamic demo backend's
  // /v1/packs/-/search only knows in-process nodes — not the published
  // catalog — so the index is the authoritative search source.)
  const index = await registryJson(ctx, registryUrl, '/v1/index.json');
  const packs = Array.isArray(index?.packs) ? index.packs : [];
  const matched = packs.filter((p) => {
    if (!query) return true;
    const haystack = [p.name, p.description, ...(p.tags ?? []), ...(p.typeIds ?? [])]
      .filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(query);
  });
  const limit = Number(options.limit ?? 30);
  if (ctx.json) {
    writeJson(ctx.io.stdout, { query: positionals[0] ?? '', total: matched.length, packs: matched });
    return 0;
  }
  if (matched.length === 0) {
    writeLine(ctx.io.stdout, query ? `No packs match "${positionals[0]}".` : 'Registry is empty.');
    return 0;
  }
  const rows = matched.slice(0, limit).map((p) => ({
    name: p.name,
    version: p.latestVersion ?? '',
    kind: p.kind ?? 'node',
    license: p.license ?? '',
    flags: p.yanked ? 'yanked' : p.deprecated ? 'deprecated' : '',
  }));
  writeLine(ctx.io.stdout, formatTable(rows, ['name', 'version', 'kind', 'license', 'flags']));
  if (matched.length > rows.length) {
    writeLine(ctx.io.stdout, `... ${matched.length - rows.length} more. Use --limit ${matched.length} or --json.`);
  }
  return 0;
}

async function runPacksInfo(ctx: Ctx, argv) {
  const { options, positionals } = parseOptions(argv, {
    bool: ['--help'],
    value: ['--registry-url', '--version'],
  });
  if (options.help) {
    write(ctx.io.stdout, PACKS_HELP);
    return 0;
  }
  const name = positionals[0];
  if (!name) throw new CliError('packs info requires a pack name.\nUsage: openwop packs info <name> [--version v]');
  const registryUrl = registryUrlFor(options, ctx.env);
  const pack = await registryJson(ctx, registryUrl, `/v1/packs/${encodeURIComponent(name)}/index.json`);

  // When a specific --version is given, also fetch its version manifest so
  // callers see the per-version detail (signing key, integrity).
  let versionManifest = null;
  if (options.version) {
    versionManifest = await registryJson(
      ctx, registryUrl,
      `/v1/packs/${encodeURIComponent(name)}/-/${encodeURIComponent(options.version)}.json`,
    );
  }

  if (ctx.json) {
    writeJson(ctx.io.stdout, versionManifest ? { ...pack, requestedVersion: versionManifest } : pack);
    return 0;
  }
  const lines = [
    `Name:        ${pack.name}`,
    `Kind:        ${pack.kind ?? 'node'}`,
    `Latest:      ${pack.latest ?? '(none)'}`,
    `License:     ${pack.license || '—'}`,
    `Author:      ${pack.author || '—'}`,
    `Description: ${pack.description || '—'}`,
  ];
  if (pack.homepage) lines.push(`Homepage:    ${pack.homepage}`);
  lines.push('');
  const versions = Array.isArray(pack.versions) ? pack.versions : [];
  if (versions.length > 0) {
    writeLine(ctx.io.stdout, lines.join('\n'));
    const rows = versions.map((v) => ({
      version: v.version,
      keyId: v.signingKeyId ?? '',
      flags: v.yanked ? 'yanked' : v.deprecated ? 'deprecated' : '',
      integrity: typeof v.integrity === 'string' ? v.integrity.slice(0, 24) + '…' : '',
    }));
    writeLine(ctx.io.stdout, formatTable(rows, ['version', 'keyId', 'flags', 'integrity']));
  } else {
    writeLine(ctx.io.stdout, lines.join('\n'));
  }
  return 0;
}

async function runPacksInstall(ctx: Ctx, argv) {
  const { options, positionals } = parseOptions(argv, {
    bool: ['--help', '--no-verify'],
    value: ['--registry-url', '--version', '--dir'],
  });
  if (options.help) {
    write(ctx.io.stdout, PACKS_HELP);
    return 0;
  }
  // Accept either `name@version` or `name --version v`.
  let name = positionals[0];
  let version = options.version;
  if (name && name.includes('@')) {
    const at = name.lastIndexOf('@');
    version = version ?? name.slice(at + 1);
    name = name.slice(0, at);
  }
  if (!name) throw new CliError('packs install requires a pack name.\nUsage: openwop packs install <name>[@version] [--version v]');
  const registryUrl = registryUrlFor(options, ctx.env);

  // Resolve the version: explicit --version, or the pack's `latest`.
  if (!version) {
    const pack = await registryJson(ctx, registryUrl, `/v1/packs/${encodeURIComponent(name)}/index.json`);
    version = pack?.latest;
    if (!version) throw new CliError(`Could not resolve a version for ${name}; pass --version.`);
  }

  // Fetch the version manifest (carries the signing.keyId + integrity).
  const manifest = await registryJson(
    ctx, registryUrl,
    `/v1/packs/${encodeURIComponent(name)}/-/${encodeURIComponent(version)}.json`,
  );
  if (manifest?.yanked) {
    throw new CliError(`${name}@${version} has been yanked and cannot be installed.`, 1);
  }

  // Download the tarball.
  const tgz = await registryBytes(ctx, registryUrl, `/v1/packs/${encodeURIComponent(name)}/-/${encodeURIComponent(version)}.tgz`);

  // Integrity (SRI) check against the manifest's `integrity` field.
  const integrity = 'sha256-' + createHash('sha256').update(tgz).digest('base64');
  if (manifest?.integrity && manifest.integrity !== integrity) {
    throw new CliError(
      `Integrity mismatch for ${name}@${version}: manifest declares ${manifest.integrity} but tarball hashes to ${integrity}.`,
      1,
    );
  }

  // Signature verification (unless --no-verify). Mirrors verify-signatures.mjs:
  // method 'ed25519' signs the whole tarball; method 'manual' signs the
  // pack.json bytes inside the tarball. The publisher key is fetched from
  // /keys/{keyId}.pub.
  let verifyResult = 'skipped';
  if (!options.noVerify) {
    const keyId = manifest?.signing?.keyId ?? manifest?.signing?.publicKeyRef;
    if (!keyId) throw new CliError(`${name}@${version} manifest has no signing key reference; re-run with --no-verify to bypass.`, 1);
    const sig = await registryBytes(ctx, registryUrl, `/v1/packs/${encodeURIComponent(name)}/-/${encodeURIComponent(version)}.sig`);
    if (sig.length !== 64) throw new CliError(`Signature for ${name}@${version} is ${sig.length} bytes; expected 64 for Ed25519.`, 1);
    const pubPem = (await registryBytes(ctx, registryUrl, `/keys/${encodeURIComponent(keyId)}.pub`)).toString('utf8');
    const publicKey = createPublicKey(pubPem);
    const method = manifest?.signing?.method ?? 'ed25519';
    const signedBytes = method === 'manual' ? extractPackJsonBytes(tgz) : tgz;
    const valid = ed25519Verify(null, signedBytes, publicKey, sig);
    if (!valid) {
      throw new CliError(`Signature verification FAILED for ${name}@${version} (keyId=${keyId}, method=${method}).`, 1);
    }
    verifyResult = `verified (keyId=${keyId}, method=${method})`;
  }

  // Place under a local pack cache: <dir>/<name>/<version>/. Default dir is
  // ~/.openwop/packs (honors OPENWOP_CONFIG_HOME like the rest of the CLI).
  const baseDir = options.dir
    ? resolvePath(ctx.cwd, options.dir)
    : join(configHomeDir(ctx.env), 'packs');
  const destDir = join(baseDir, name, version);
  mkdirSync(destDir, { recursive: true });
  const tgzPath = join(destDir, `${version}.tgz`);
  const manifestPath = join(destDir, `${version}.json`);
  writeFileSync(tgzPath, tgz);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  if (ctx.json) {
    writeJson(ctx.io.stdout, {
      name, version, integrity, signature: verifyResult,
      tarball: tgzPath, manifest: manifestPath,
    });
    return 0;
  }
  writeLine(ctx.io.stdout, `Installed ${name}@${version}`);
  writeLine(ctx.io.stdout, `  signature: ${verifyResult}`);
  writeLine(ctx.io.stdout, `  integrity: ${integrity}`);
  writeLine(ctx.io.stdout, `  tarball:   ${tgzPath}`);
  return 0;
}

async function runPacksPublish(ctx: Ctx, argv) {
  const { options, positionals } = parseOptions(argv, {
    bool: ['--help'],
    value: ['--key', '--key-id', '--out'],
  });
  if (options.help) {
    write(ctx.io.stdout, PACKS_HELP);
    return 0;
  }
  // The reference registry has NO write API (.well-known declares
  // writeApi.supported=false, publishMethod=github-pull-request). So
  // `publish` performs the LOCAL packaging + signing flow — producing the
  // signed tarball + sidecar artifacts that the publisher then commits and
  // opens a PR with (per registry/README.md §Publishing). This mirrors
  // scripts/build-pack-tarball.mjs's --signed path.
  const packDir = positionals[0];
  if (!packDir) throw new CliError('packs publish requires a pack directory.\nUsage: openwop packs publish <dir> --key <ed25519.pem> --key-id <id>');
  const absPackDir = resolvePath(ctx.cwd, packDir);
  const manifestPath = join(absPackDir, 'pack.json');
  if (!existsSync(manifestPath)) {
    throw new CliError(`No pack.json found in ${absPackDir}.`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const name = manifest.name;
  const version = manifest.version;
  if (!name || !version) throw new CliError('pack.json must declare both "name" and "version".');

  const keyId = options.keyId ?? 'openwop-team-1';
  // Augment the manifest with the signing block (method 'manual'), then sign
  // the CANONICAL (key-sorted) JSON — exactly what the registry verifier
  // re-derives from the in-tarball pack.json.
  const signedManifest = {
    ...manifest,
    signing: { method: 'manual', publicKeyRef: keyId, signatureRef: 'keys/pack.json.sig' },
  };
  const canonical = canonicalJsonStringify(signedManifest);

  // Load (or, for dev, generate) the Ed25519 private key.
  let privateKey;
  let ephemeralPublicB64: string | null = null;
  if (options.key) {
    privateKey = createPrivateKey({ key: readFileSync(resolvePath(ctx.cwd, options.key), 'utf8'), format: 'pem' });
  } else {
    // Convention: ~/.openwop-keys/<keyId>.private.pem (per project layout).
    const conventional = join(homedir(), '.openwop-keys', `${keyId}.private.pem`);
    if (existsSync(conventional)) {
      privateKey = createPrivateKey({ key: readFileSync(conventional, 'utf8'), format: 'pem' });
    } else {
      const kp = generateKeyPairSync('ed25519');
      privateKey = kp.privateKey;
      ephemeralPublicB64 = kp.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    }
  }
  const sig = ed25519Sign(null, Buffer.from(canonical, 'utf8'), privateKey);

  // Build the deterministic tarball: replace pack.json with the canonical
  // bytes + embed keys/pack.json.sig.
  const entries = walkPackDir(absPackDir)
    .filter((e) => e.name !== 'keys/pack.json.sig')
    .map((e) => (e.name === 'pack.json' ? { name: 'pack.json', content: Buffer.from(canonical, 'utf8') } : e));
  entries.push({ name: 'keys/pack.json.sig', content: sig });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const tgz = buildUstarGzip(entries);
  const sha = createHash('sha256').update(tgz).digest('hex');

  const outDir = options.out ? resolvePath(ctx.cwd, options.out) : join(ctx.cwd, 'dist', 'packs');
  mkdirSync(outDir, { recursive: true });
  const base = `${name}-${version}`;
  const tgzPath = join(outDir, `${base}.tgz`);
  const sigPath = join(outDir, `${base}.sig`);
  const manifestOut = join(outDir, `${base}.manifest.json`);
  writeFileSync(tgzPath, tgz);
  writeFileSync(sigPath, sig);
  writeFileSync(manifestOut, JSON.stringify(signedManifest, null, 2) + '\n', 'utf8');

  if (ctx.json) {
    writeJson(ctx.io.stdout, {
      name, version, keyId, integrity: `sha256:${sha}`,
      tarball: tgzPath, signature: sigPath, manifest: manifestOut,
      writeApi: false, publishMethod: 'github-pull-request',
      ephemeralPublicKey: ephemeralPublicB64 ?? undefined,
    });
    return 0;
  }
  writeLine(ctx.io.stdout, `Packaged + signed ${name}@${version} (keyId=${keyId})`);
  writeLine(ctx.io.stdout, `  tarball:   ${tgzPath}`);
  writeLine(ctx.io.stdout, `  signature: ${sigPath}`);
  writeLine(ctx.io.stdout, `  manifest:  ${manifestOut}`);
  writeLine(ctx.io.stdout, `  integrity: sha256:${sha}`);
  if (ephemeralPublicB64) {
    writeLine(ctx.io.stdout, `  WARNING: no --key and no ~/.openwop-keys/${keyId}.private.pem — used an EPHEMERAL key.`);
    writeLine(ctx.io.stdout, `  Pre-register this public key (SPKI DER base64) with the registry before publishing:`);
    writeLine(ctx.io.stdout, `    ${ephemeralPublicB64}`);
  }
  writeLine(ctx.io.stdout, '');
  writeLine(ctx.io.stdout, 'The reference registry has no write API. To publish:');
  writeLine(ctx.io.stdout, `  1. Copy the artifacts into registry/v1/packs/${name}/-/`);
  writeLine(ctx.io.stdout, '  2. Run `node registry/scripts/build-index.mjs` to refresh the index.');
  writeLine(ctx.io.stdout, '  3. Open a pull request (publishMethod: github-pull-request).');
  return 0;
}

async function runPacksYank(ctx: Ctx, argv) {
  const { options, positionals } = parseOptions(argv, {
    bool: ['--help', '--undo'],
    value: ['--version'],
  });
  if (options.help) {
    write(ctx.io.stdout, PACKS_HELP);
    return 0;
  }
  // Yank is a registry-state change. The reference registry exposes no write
  // API (writeApi.supported=false), and lifecycle.yankSupported=true means it
  // is performed via PR: flip `"yanked": true` in the version manifest, then
  // rebuild the index. This subcommand applies that edit LOCALLY to a checked-
  // out registry tree so the change is ready to commit + PR.
  let name = positionals[0];
  let version = options.version;
  if (name && name.includes('@')) {
    const at = name.lastIndexOf('@');
    version = version ?? name.slice(at + 1);
    name = name.slice(0, at);
  }
  if (!name || !version) {
    throw new CliError('packs yank requires <name>@<version> (or <name> --version v).');
  }
  const root = requireRepoRoot(ctx);
  const manifestPath = join(root, 'registry', 'v1', 'packs', name, '-', `${version}.json`);
  if (!existsSync(manifestPath)) {
    throw new CliError(`Version manifest not found: ${manifestPath}\n(packs yank edits a local registry checkout; the published change lands via PR.)`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const newValue = !options.undo;
  if (Boolean(manifest.yanked) === newValue) {
    writeLine(ctx.io.stdout, `${name}@${version} is already ${newValue ? 'yanked' : 'un-yanked'}; no change.`);
    return 0;
  }
  manifest.yanked = newValue;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  if (ctx.json) {
    writeJson(ctx.io.stdout, { name, version, yanked: newValue, manifest: manifestPath, publishMethod: 'github-pull-request' });
    return 0;
  }
  writeLine(ctx.io.stdout, `${newValue ? 'Yanked' : 'Un-yanked'} ${name}@${version}`);
  writeLine(ctx.io.stdout, `  edited: ${manifestPath}`);
  writeLine(ctx.io.stdout, '  Next: run `node registry/scripts/build-index.mjs`, commit, and open a PR.');
  return 0;
}

// ─── packs helpers (shared with build-pack-tarball.mjs conventions) ──────────

/** RFC 8785-style key-sorted canonical JSON — matches build-pack-tarball.mjs. */
function canonicalJsonStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJsonStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJsonStringify(value[k])).join(',') + '}';
}

/** Config home (honors OPENWOP_CONFIG_HOME), used for the local pack cache. */
function configHomeDir(env = process.env) {
  const base = env.OPENWOP_CONFIG_HOME ? env.OPENWOP_CONFIG_HOME : homedir();
  return join(base, '.openwop');
}

/** Extract raw pack.json bytes from a gzipped USTAR tarball — mirrors verify-signatures.mjs. */
function extractPackJsonBytes(tarballBytes) {
  const decompressed = gunzipSync(tarballBytes);
  const BLOCK = 512;
  for (let off = 0; off + BLOCK <= decompressed.length; ) {
    const nameBuf = decompressed.subarray(off, off + 100);
    const nameEnd = nameBuf.indexOf(0);
    const name = nameBuf.subarray(0, nameEnd < 0 ? 100 : nameEnd).toString('utf8');
    if (!name) break;
    const sizeStr = decompressed.subarray(off + 124, off + 136).toString('ascii').replace(/\0/g, '').trim();
    const size = parseInt(sizeStr, 8) || 0;
    const typeflag = decompressed[off + 156];
    if (typeflag === 0x78 || typeflag === 0x4c) {
      throw new CliError('Tarball uses USTAR extended headers (entry names > 100 bytes); cannot verify pack.json signature.', 1);
    }
    if (name === 'pack.json' || name === './pack.json') {
      return decompressed.subarray(off + BLOCK, off + BLOCK + size);
    }
    off += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
  }
  throw new CliError('pack.json not found in tarball.', 1);
}

/** Walk a pack source dir into deterministic USTAR entries — mirrors build-pack-tarball.mjs. */
function walkPackDir(packDir) {
  const ALLOWED_TOPS = new Set(['pack.json', 'README.md', 'LICENSE', 'index.mjs']);
  const ALLOWED_DIRS = new Set(['schemas', 'keys']);
  const entries: any[] = [];
  for (const entry of readdirSync(packDir).sort()) {
    const full = join(packDir, entry);
    const st = statSync(full);
    if (st.isFile()) {
      if (!ALLOWED_TOPS.has(entry)) continue;
      entries.push({ name: entry, content: readFileSync(full) });
    } else if (st.isDirectory() && ALLOWED_DIRS.has(entry)) {
      for (const f of readdirSync(full).sort()) {
        if (!f.endsWith('.json') && !f.endsWith('.pem') && !f.endsWith('.sig')) continue;
        entries.push({ name: `${entry}/${f}`, content: readFileSync(join(full, f)) });
      }
    }
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return entries;
}

/** Deterministic gzipped USTAR writer — mirrors build-pack-tarball.mjs. */
function buildUstarGzip(entries) {
  const ustarHeader = (name, size) => {
    const buf = Buffer.alloc(512, 0);
    const writeOctal = (n, len, offset) => {
      const s = n.toString(8).padStart(len - 1, '0') + '\0';
      buf.write(s, offset, len, 'ascii');
    };
    if (name.length > 100) throw new CliError(`Pack entry path too long for USTAR (>100 bytes): ${name}`, 1);
    buf.write(name, 0, 100, 'ascii');
    writeOctal(0o644, 8, 100);
    writeOctal(0, 8, 108);
    writeOctal(0, 8, 116);
    writeOctal(size, 12, 124);
    writeOctal(0, 12, 136);
    for (let i = 148; i < 156; i++) buf[i] = 0x20;
    buf[156] = 0x30;
    buf.write('ustar\0', 257, 6, 'ascii');
    buf.write('00', 263, 2, 'ascii');
    let chksum = 0;
    for (let i = 0; i < 512; i++) chksum += buf[i];
    writeOctal(chksum, 8, 148);
    return buf;
  };
  const chunks: Uint8Array[] = [];
  for (const { name, content } of entries) {
    chunks.push(ustarHeader(name, content.length));
    chunks.push(content);
    const pad = 512 - (content.length % 512);
    if (pad !== 512) chunks.push(Buffer.alloc(pad, 0));
  }
  chunks.push(Buffer.alloc(1024, 0));
  const gz = gzipSync(Buffer.concat(chunks), { level: 9 });
  gz[4] = 0; gz[5] = 0; gz[6] = 0; gz[7] = 0;
  gz[9] = 0xff;
  return gz;
}










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

async function runOnboard(ctx: Ctx, argv) {
  const { options } = parseOptions(argv, {
    bool: ['--help', '--non-interactive', '--reset', '--skip-test', '--no-test'],
    value: [
      '--profile', '--base-url-choice', '--provider',
      '--provider-key', '--api-key-env', '--model', '--credential-ref',
    ],
  });
  if (options.help) {
    write(ctx.io.stdout, ONBOARD_HELP);
    return 0;
  }

  const interactive = !options.nonInteractive && Boolean(process.stdin.isTTY);
  const configPath = configPathFor(options.profile, ctx.env);
  const existing = readConfigSafe(configPath);

  writeLine(ctx.io.stdout, 'OpenWOP onboarding wizard');
  writeLine(ctx.io.stdout, '─────────────────────────');
  writeLine(ctx.io.stdout, '');

  // Step 1 — existing config
  if (existing && !options.reset) {
    if (interactive) {
      writeLine(ctx.io.stdout, `Found existing config at ${configPath}.`);
      const choice = await promptChoice(ctx, 'Keep, Modify, or Reset?', [
        { key: 'keep', label: 'Keep — exit without changes' },
        { key: 'modify', label: 'Modify — update fields, preserve the rest', recommended: true },
        { key: 'reset', label: 'Reset — wipe and re-run from scratch' },
      ]);
      if (choice === 'keep') {
        writeLine(ctx.io.stdout, 'Nothing changed.');
        return 0;
      }
      if (choice === 'reset') {
        // Fall through; we overwrite the file at save time.
      }
      // 'modify' keeps `existing` in scope as defaults below.
    }
  }

  // Step 2 — host URL
  const baseUrl = await resolveBaseUrl(ctx, options, existing, interactive);
  writeLine(ctx.io.stdout, `✓ Host: ${baseUrl}`);
  writeLine(ctx.io.stdout, '');

  // Step 3 — provider
  const provider = await resolveProvider(ctx, options, existing, interactive);
  if (provider === null) {
    // User explicitly chose to skip — save partial config and exit.
    saveConfig(configPath, mergeConfig(existing, { host: { baseUrl }, defaultProvider: null }));
    writeLine(ctx.io.stdout, `✓ Configuration saved to ${configPath}`);
    writeLine(ctx.io.stdout, '');
    writeLine(ctx.io.stdout, 'Next: add a provider when you have credentials:');
    writeLine(ctx.io.stdout, '  openwop providers add <anthropic|openai|google|minimax>');
    return 0;
  }
  writeLine(ctx.io.stdout, `✓ Provider: ${provider}`);
  writeLine(ctx.io.stdout, '');

  // Step 4 — API key
  const apiKey = await resolveApiKey(ctx, options, provider, interactive);

  // Step 5 — model
  const model = await resolveModel(ctx, options, provider, existing, interactive);
  writeLine(ctx.io.stdout, `✓ Model: ${model}`);
  writeLine(ctx.io.stdout, '');

  // Step 6 — POST credential to backend BYOK store
  const credentialRef = options.credentialRef ?? `${provider}-default`;
  const byokCtx = { ...ctx, baseUrl };
  writeLine(ctx.io.stdout, `Storing credential at ${baseUrl}/v1/host/sample/byok/secrets ...`);
  try {
    await requestJson(byokCtx, '/v1/host/sample/byok/secrets', {
      method: 'POST',
      body: { credentialRef, value: apiKey },
    });
    writeLine(ctx.io.stdout, `✓ Stored credential ref \`${credentialRef}\``);
  } catch (err) {
    const detail = err instanceof HttpError ? `HTTP ${err.status}` : String(err);
    throw new CliError(`Could not store credential at ${baseUrl}: ${detail}`);
  }
  writeLine(ctx.io.stdout, '');

  // Step 7 — save config (api key is NEVER written; backend holds it)
  const config = mergeConfig(existing, {
    version: 1,
    host: { baseUrl, apiKey: ctx.apiKey ?? defaultApiKeyFor(baseUrl) },
    defaultProvider: provider,
    defaultModel: model,
    credentialRef,
    updatedAt: new Date().toISOString(),
  });
  saveConfig(configPath, config);
  writeLine(ctx.io.stdout, `✓ Configuration saved to ${configPath}`);
  writeLine(ctx.io.stdout, '');

  // Step 8 — test the connection
  const shouldTest = !options.skipTest && !options.noTest
    && (interactive ? await promptYesNo(ctx, 'Test the connection now?', true) : false);
  if (shouldTest) {
    const testRes = await testProviderConnection(byokCtx, credentialRef);
    if (testRes.ok) {
      writeLine(ctx.io.stdout, `✓ Provider check passed — credentialRef \`${credentialRef}\` is reachable.`);
    } else {
      writeLine(ctx.io.stdout, `! Provider check warning: ${testRes.message}`);
    }
    writeLine(ctx.io.stdout, '');
  }

  // Step 9 — next steps
  writeLine(ctx.io.stdout, 'Next steps:');
  writeLine(ctx.io.stdout, '  openwop demo status');
  writeLine(ctx.io.stdout, '  openwop providers list');
  writeLine(ctx.io.stdout, '  openwop catalog nodes --search ai');
  writeLine(ctx.io.stdout, '  openwop runs create sample.chat.turn --input \'messages=[{"role":"user","content":"hello"}]\' --wait');
  return 0;
}

async function resolveBaseUrl(ctx: Ctx, options, existing, interactive) {
  if (options.baseUrlChoice) {
    const preset = HOST_PRESETS.find((h) => h.key === options.baseUrlChoice);
    if (!preset) throw new CliError(`--base-url-choice must be one of: ${HOST_PRESETS.map((h) => h.key).join(', ')}`);
    return preset.url;
  }
  if (ctx.baseUrl && ctx.baseUrl !== DEFAULT_BASE_URL) {
    // User passed --base-url at the top level
    return ctx.baseUrl;
  }
  if (existing?.host?.baseUrl && !interactive) return existing.host.baseUrl;
  if (!interactive) return ctx.baseUrl;

  const choices = [
    ...HOST_PRESETS.map((h, i) => ({ key: h.key, label: h.label, recommended: i === 0 })),
    { key: 'custom', label: 'Custom URL' },
  ];
  const choice = await promptChoice(ctx, 'Where should the CLI talk to?', choices);
  if (choice === 'custom') {
    const url = await promptText(ctx, 'Enter the host base URL: ', existing?.host?.baseUrl ?? '');
    if (!url) throw new CliError('Base URL is required');
    return normalizeBaseUrl(url);
  }
  const preset = HOST_PRESETS.find((h) => h.key === choice);
  if (!preset) throw new CliError(`Unknown host choice: ${choice}`);
  return preset.url;
}

async function resolveProvider(ctx: Ctx, options, existing, interactive) {
  if (options.provider) {
    if (!PROVIDER_CATALOG[options.provider]) {
      throw new CliError(`Unknown provider: ${options.provider}. Must be one of: ${Object.keys(PROVIDER_CATALOG).join(', ')}`);
    }
    return options.provider;
  }
  if (!interactive) {
    if (existing?.defaultProvider) return existing.defaultProvider;
    throw new CliError('--provider is required in non-interactive mode (choices: anthropic, openai, google, minimax)');
  }
  const choices = [
    ...Object.entries(PROVIDER_CATALOG).map(([key, spec], i) => ({
      key,
      label: spec.label,
      recommended: i === 0,
    })),
    { key: 'skip', label: 'Skip — I\'ll add providers later' },
  ];
  const choice = await promptChoice(ctx, 'Pick an AI provider:', choices);
  return choice === 'skip' ? null : choice;
}

async function resolveApiKey(ctx: Ctx, options, provider, interactive) {
  const spec = PROVIDER_CATALOG[provider];
  if (options.providerKey) return options.providerKey;
  if (options.apiKeyEnv) {
    const value = ctx.env[options.apiKeyEnv];
    if (!value) throw new CliError(`Env var ${options.apiKeyEnv} is not set`);
    return value;
  }
  const envValue = ctx.env[spec.envVar];
  if (envValue && interactive) {
    const useEnv = await promptYesNo(ctx, `Found ${spec.envVar} in env. Use it?`, true);
    if (useEnv) return envValue;
  } else if (envValue && !interactive) {
    return envValue;
  }
  if (!interactive) {
    throw new CliError(`Provide --provider-key, --api-key-env VAR, or set ${spec.envVar} in env`);
  }
  const key = await readSecret(ctx, `Paste your ${spec.label} API key (input hidden): `);
  if (!key) throw new CliError('API key is required');
  return key;
}

async function resolveModel(ctx: Ctx, options, provider, existing, interactive) {
  const spec = PROVIDER_CATALOG[provider];
  if (options.model) return options.model;
  const recommended = spec.models.find((m) => m.recommended) ?? spec.models[0];
  if (!interactive) {
    if (existing?.defaultModel) return existing.defaultModel;
    return recommended.id;
  }
  const choices = [
    ...spec.models.map((m) => ({ key: m.id, label: m.label, recommended: m.recommended })),
    { key: 'custom', label: 'Custom (type a model id)' },
  ];
  const choice = await promptChoice(ctx, 'Pick a model:', choices);
  if (choice === 'custom') {
    const id = await promptText(ctx, 'Model id: ', recommended.id);
    if (!id) throw new CliError('Model id is required');
    return id;
  }
  return choice;
}

async function testProviderConnection(ctx: Ctx, credentialRef) {
  try {
    const res = await requestJson(ctx, '/v1/host/sample/byok/secrets');
    const secrets = Array.isArray(res.body?.secrets) ? res.body.secrets : [];
    const found = secrets.some((s) => (typeof s === 'string' ? s === credentialRef : s.credentialRef === credentialRef));
    if (!found) return { ok: false, message: `BYOK list did not include \`${credentialRef}\`` };
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// `openwop providers ...`
// ─────────────────────────────────────────────────────────────────────────────

async function runProviders(ctx: Ctx, argv) {
  const sub = argv[0] ?? 'list';
  const args = argv.slice(['list', 'add', 'remove', 'rm', 'test'].includes(sub) ? 1 : 0);
  if (sub === '--help' || sub === '-h') {
    write(ctx.io.stdout, PROVIDERS_HELP);
    return 0;
  }
  switch (sub) {
    case 'list':
      return await runProvidersList(ctx, args);
    case 'add':
      return await runProvidersAdd(ctx, args);
    case 'remove':
    case 'rm':
      return await runProvidersRemove(ctx, args);
    case 'test':
      return await runProvidersTest(ctx, args);
    default:
      throw new CliError(`Unknown providers command: ${sub}\nRun \`openwop providers --help\` for usage.`);
  }
}

async function runProvidersList(ctx: Ctx, argv) {
  const { options } = parseOptions(argv, { bool: ['--help'] });
  if (options.help) {
    write(ctx.io.stdout, PROVIDERS_HELP);
    return 0;
  }
  const res = await requestJson(ctx, '/v1/host/sample/byok/secrets');
  if (ctx.json) {
    writeJson(ctx.io.stdout, res.body);
    return 0;
  }
  const secrets = Array.isArray(res.body?.secrets) ? res.body.secrets : [];
  if (secrets.length === 0) {
    writeLine(ctx.io.stdout, 'No credentials stored. Run `openwop onboard` or `openwop providers add <provider>`.');
    return 0;
  }
  const rows = secrets.map((s) => ({
    credentialRef: typeof s === 'string' ? s : s.credentialRef,
    createdAt: typeof s === 'object' ? (s.createdAt ?? '') : '',
  }));
  writeLine(ctx.io.stdout, formatTable(rows, ['credentialRef', 'createdAt']));
  return 0;
}

async function runProvidersAdd(ctx: Ctx, argv) {
  const { options, positionals } = parseOptions(argv, {
    bool: ['--help'],
    value: ['--provider-key', '--api-key-env', '--model', '--credential-ref'],
  });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop providers add <provider> [--provider-key KEY|--api-key-env VAR] [--model MODEL] [--credential-ref REF]\n');
    return options.help ? 0 : 2;
  }
  const provider = positionals[0];
  if (!PROVIDER_CATALOG[provider]) {
    throw new CliError(`Unknown provider: ${provider}. Must be one of: ${Object.keys(PROVIDER_CATALOG).join(', ')}`);
  }
  const interactive = Boolean(process.stdin.isTTY);
  const apiKey = await resolveApiKey(ctx, options, provider, interactive);
  const credentialRef = options.credentialRef ?? `${provider}-default`;
  await requestJson(ctx, '/v1/host/sample/byok/secrets', {
    method: 'POST',
    body: { credentialRef, value: apiKey },
  });
  // Update local config with the default provider/model if not yet set.
  const configPath = configPathFor(undefined, ctx.env);
  const existing = readConfigSafe(configPath);
  const recommended = PROVIDER_CATALOG[provider].models.find((m) => m.recommended) ?? PROVIDER_CATALOG[provider].models[0];
  saveConfig(configPath, mergeConfig(existing, {
    version: 1,
    host: existing?.host ?? { baseUrl: ctx.baseUrl, apiKey: ctx.apiKey },
    defaultProvider: existing?.defaultProvider ?? provider,
    defaultModel: existing?.defaultModel ?? (options.model ?? recommended.id),
    credentialRef,
    updatedAt: new Date().toISOString(),
  }));
  if (ctx.json) {
    writeJson(ctx.io.stdout, { credentialRef, provider, model: options.model ?? recommended.id });
  } else {
    writeLine(ctx.io.stdout, `✓ Stored credential \`${credentialRef}\` for ${provider}`);
  }
  return 0;
}

async function runProvidersRemove(ctx: Ctx, argv) {
  const { options, positionals } = parseOptions(argv, {
    bool: ['--help'],
    value: ['--credential-ref'],
  });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop providers remove <provider> [--credential-ref REF]\n');
    return options.help ? 0 : 2;
  }
  const provider = positionals[0];
  const credentialRef = options.credentialRef ?? `${provider}-default`;
  await requestJson(ctx, `/v1/host/sample/byok/secrets/${encodeURIComponent(credentialRef)}`, { method: 'DELETE' });
  if (ctx.json) writeJson(ctx.io.stdout, { removed: credentialRef });
  else writeLine(ctx.io.stdout, `✓ Removed credential \`${credentialRef}\``);
  return 0;
}

async function runProvidersTest(ctx: Ctx, argv) {
  const { options, positionals } = parseOptions(argv, {
    bool: ['--help'],
    value: ['--credential-ref'],
  });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop providers test <provider> [--credential-ref REF]\n');
    return options.help ? 0 : 2;
  }
  const provider = positionals[0];
  const credentialRef = options.credentialRef ?? `${provider}-default`;
  const res = await testProviderConnection(ctx, credentialRef);
  if (ctx.json) {
    writeJson(ctx.io.stdout, { provider, credentialRef, ok: res.ok, message: res.message });
    return res.ok ? 0 : 1;
  }
  if (res.ok) {
    writeLine(ctx.io.stdout, `✓ ${provider}: credential \`${credentialRef}\` is reachable.`);
    return 0;
  }
  writeLine(ctx.io.stdout, `✗ ${provider}: ${res.message}`);
  return 1;
}

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

const DOCTOR_HELP = `Usage: openwop doctor [--json]

Checks Node/npm, local demo app dependencies, repository layout, whether the demo
backend is reachable, the demo daemon status (via /v1/host/sample/daemon-status or
the ~/.openwop/ PID file), and reachability of each stored BYOK provider credential.
`;

const DEMO_HELP = `Usage:
  openwop demo status [--json]
  openwop demo start [--backend-only|--frontend-only] [--detach] [--install] [--backend-port 8080] [--frontend-port 5173]
  openwop demo stop [--force] [--timeout-ms 5000]
  openwop demo restart [--backend-port 8080]
  openwop demo logs [--follow] [--lines 50]
  openwop demo install [--dry-run] [--uninstall] [--backend-port 8080] [--label dev.openwop.demo]
  openwop demo urls [--frontend-port 5173]

The demo commands are tuned for apps/workflow-engine: a TypeScript backend on port 8080 and a Vite frontend on port 5173.

Lifecycle commands (stop/restart/logs) track the backend process via a PID file
under ~/.openwop/ (honors OPENWOP_CONFIG_HOME). Use \`demo start --detach\` to run
the backend in the background; a plain \`demo start\` runs in the foreground but
still writes the PID + log file so stop/logs work from another shell.
`;

const DEMO_STATUS_HELP = `Usage: openwop demo status [--base-url url] [--api-key key] [--json]

Probes /health, /readiness, /.well-known/openwop, and the demo summary endpoint.
`;

const DEMO_START_HELP = `Usage: openwop demo start [options]

Options:
  --backend-only          Start only the backend
  --frontend-only         Start only the frontend
  --detach                Run the backend in the background (writes a PID file); returns immediately
  --install               Run npm install before starting selected services
  --backend-port <port>   Backend port (default: 8080)
  --frontend-port <port>  Frontend port (default: 5173)
  --dry-run               Print the commands without starting services
`;

const DEMO_STOP_HELP = `Usage: openwop demo stop [--force] [--timeout-ms 5000] [--json]

Reads the PID file under ~/.openwop/ and signals the demo backend (SIGTERM, then
SIGKILL after --timeout-ms). --force sends SIGKILL immediately. Clears the PID file.
`;

const DEMO_RESTART_HELP = `Usage: openwop demo restart [--backend-port 8080] [--json]

Stops the tracked demo backend, then starts a fresh one detached. Reuses the prior
backend port unless --backend-port is given.
`;

const DEMO_LOGS_HELP = `Usage: openwop demo logs [--follow] [--lines 50]

Prints the tail of the demo backend log file (~/.openwop/demo-backend.log).
--follow streams new lines until interrupted. --lines sets how many trailing lines to show.
`;

const DEMO_INSTALL_HELP = `Usage: openwop demo install [--dry-run] [--uninstall] [--backend-port 8080] [--label dev.openwop.demo]

Writes a managed-service definition for the demo backend, chosen by platform:
  macOS    LaunchAgent plist under ~/Library/LaunchAgents/
  Linux    systemd user unit under ~/.config/systemd/user/
  Windows  prints a Scheduled-Task recipe (no file is written)

--dry-run prints the target path and full file contents without writing.
--uninstall removes a previously written unit file.
`;

const DEMO_URLS_HELP = `Usage: openwop demo urls [--frontend-port 5173] [--json]
`;


const PACKS_HELP = `Usage:
  openwop packs search [query] [--registry-url url] [--limit n] [--json]
  openwop packs info <name> [--version v] [--registry-url url] [--json]
  openwop packs install <name>[@version] [--version v] [--dir path] [--no-verify] [--registry-url url] [--json]
  openwop packs publish <dir> [--key ed25519.pem] [--key-id id] [--out dir] [--json]
  openwop packs yank <name>[@version] [--version v] [--undo] [--json]

Operates the signed node-pack registry (default: https://packs.openwop.dev,
override with --registry-url or OPENWOP_REGISTRY_URL). The registry is a
separate surface from the host --base-url.

  search    Reads /v1/index.json and filters the catalog client-side.
  info      Reads /v1/packs/{name}/index.json (+ the version manifest with --version).
  install   Downloads /v1/packs/{name}/-/{version}.tgz, checks sha256 integrity
            against the manifest, and verifies the detached Ed25519 .sig against
            the publisher key at /keys/{keyId}.pub (skip with --no-verify). Places
            the tarball + manifest under ~/.openwop/packs/{name}/{version}/
            (override with --dir).
  publish   The reference registry has NO write API (publish is PR-based). This
            packages + Ed25519-signs a local pack dir into a signed tarball +
            sidecars (mirrors scripts/build-pack-tarball.mjs --signed), ready to
            commit + open a PR. Private key: --key, else ~/.openwop-keys/{keyId}.private.pem.
  yank      Edits a local registry checkout — flips "yanked": true in the version
            manifest (--undo reverses). The published change lands via PR + a
            build-index.mjs rerun. Run from inside the repo.
`;




const ONBOARD_HELP = `Usage: openwop onboard [options]

Guided first-run setup. Walks through host URL, AI provider, API key, and model
selection, stores the credential against the demo's BYOK endpoint, and writes
~/.openwop/config.json. Re-running is safe — you'll be asked Keep/Modify/Reset.

Options:
  --base-url-choice <shared|local>   Skip the host prompt; pick a preset.
  --base-url <url>                   Skip the host prompt; use a custom URL (also honored from --base-url at global scope).
  --provider <name>                  anthropic | openai | google | minimax
  --provider-key <key>               Provider API key (avoid on shared shells — use env or stdin instead).
  --api-key-env <var>                Pull the API key from this env var.
  --model <id>                       Model id (e.g., claude-sonnet-4-6).
  --credential-ref <ref>             credentialRef to store on the backend (default: <provider>-default).
  --profile <name>                   Use ~/.openwop-<name>/ instead of ~/.openwop/.
  --non-interactive                  Fail instead of prompting; requires --provider + a key source.
  --reset                            Wipe existing config and start fresh.
  --skip-test, --no-test             Skip the post-save provider-reachability check.

If ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_API_KEY / MINIMAX_API_KEY is set
in env, the wizard auto-detects it and asks once before using.

Examples:
  openwop onboard
  openwop onboard --non-interactive --base-url-choice shared --provider anthropic --api-key-env ANTHROPIC_API_KEY
  openwop onboard --reset
`;

const PROVIDERS_HELP = `Usage:
  openwop providers list [--json]
  openwop providers add <provider> [--provider-key KEY|--api-key-env VAR] [--model MODEL] [--credential-ref REF]
  openwop providers remove <provider> [--credential-ref REF]
  openwop providers test <provider> [--credential-ref REF]

Provider must be one of: anthropic, openai, google, minimax.
`;








