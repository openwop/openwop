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

async function runCatalog(ctx: Ctx, argv) {
  const sub = argv[0] ?? 'nodes';
  const args = argv.slice(sub === 'nodes' || sub === 'packs' ? 1 : 0);
  if (sub === '--help' || sub === '-h') {
    write(ctx.io.stdout, CATALOG_HELP);
    return 0;
  }
  switch (sub) {
    case 'nodes':
      return runCatalogNodes(ctx, args);
    case 'packs':
      return runCatalogPacks(ctx, args);
    default:
      throw new CliError(`Unknown catalog command: ${sub}`);
  }
}

async function runCatalogNodes(ctx: Ctx, argv) {
  const { options } = parseOptions(argv, {
    bool: ['--help'],
    value: ['--limit', '--search'],
  });
  if (options.help) {
    write(ctx.io.stdout, CATALOG_HELP);
    return 0;
  }
  const res = await requestJson(ctx, '/v1/host/sample/node-catalog');
  let nodes = Array.isArray(res.body.nodes) ? res.body.nodes : [];
  if (options.search) {
    const q = String(options.search).toLowerCase();
    nodes = nodes.filter((n) => String(n.typeId ?? '').toLowerCase().includes(q) || String(n.label ?? '').toLowerCase().includes(q));
  }
  const limit = Number(options.limit ?? 30);
  if (ctx.json) {
    writeJson(ctx.io.stdout, { nodes });
    return 0;
  }
  const rows = nodes.slice(0, limit).map((n) => ({
    typeId: n.typeId,
    source: n.source,
    category: n.category,
    runnable: Array.isArray(n.missingHostSurfaces) && n.missingHostSurfaces.length > 0 ? 'no' : 'yes',
  }));
  writeLine(ctx.io.stdout, formatTable(rows, ['typeId', 'source', 'category', 'runnable']));
  if (nodes.length > rows.length) writeLine(ctx.io.stdout, `... ${nodes.length - rows.length} more. Use --limit ${nodes.length} or --json.`);
  return 0;
}

async function runCatalogPacks(ctx: Ctx, argv = []) {
  const { options } = parseOptions(argv, { bool: ['--help'] });
  if (options.help) {
    write(ctx.io.stdout, CATALOG_HELP);
    return 0;
  }
  const res = await requestJson(ctx, '/v1/packs', { auth: false });
  if (ctx.json) {
    writeJson(ctx.io.stdout, res.body);
    return 0;
  }
  const rows = (res.body.packs ?? []).map((p) => ({ name: p.name, nodes: Array.isArray(p.nodes) ? p.nodes.length : 0 }));
  writeLine(ctx.io.stdout, formatTable(rows, ['name', 'nodes']));
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

async function runWorkflows(ctx: Ctx, argv) {
  const sub = argv[0] ?? 'list';
  const args = argv.slice(['list', 'get', 'register', 'delete', 'rm'].includes(sub) ? 1 : 0);
  if (sub === '--help' || sub === '-h') {
    write(ctx.io.stdout, WORKFLOWS_HELP);
    return 0;
  }
  switch (sub) {
    case 'list':
      return runWorkflowsList(ctx, args);
    case 'get':
      return runWorkflowsGet(ctx, args);
    case 'register':
      return runWorkflowsRegister(ctx, args);
    case 'delete':
    case 'rm':
      return runWorkflowsDelete(ctx, args);
    default:
      throw new CliError(`Unknown workflows command: ${sub}`);
  }
}

async function runWorkflowsList(ctx: Ctx, argv) {
  const { options } = parseOptions(argv, { bool: ['--help'] });
  if (options.help) {
    write(ctx.io.stdout, WORKFLOWS_HELP);
    return 0;
  }
  const res = await requestJson(ctx, '/v1/host/sample/workflows');
  if (ctx.json) {
    writeJson(ctx.io.stdout, res.body);
    return 0;
  }
  const workflows = res.body.workflows ?? [];
  const rows = workflows.map((w) => ({ workflowId: w.workflowId, nodes: Array.isArray(w.nodes) ? w.nodes.length : 0 }));
  writeLine(ctx.io.stdout, rows.length ? formatTable(rows, ['workflowId', 'nodes']) : 'No registered sample workflows.');
  return 0;
}

async function runWorkflowsGet(ctx: Ctx, argv) {
  const { options, positionals } = parseOptions(argv, { bool: ['--help'] });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop workflows get <workflowId> [--json]\n');
    return options.help ? 0 : 2;
  }
  const workflowId = encodeURIComponent(positionals[0]);
  const res = await requestJson(ctx, `/v1/workflows/${workflowId}`);
  if (ctx.json) writeJson(ctx.io.stdout, res.body);
  else {
    writeLine(ctx.io.stdout, `workflowId: ${res.body.workflowId ?? positionals[0]}`);
    writeLine(ctx.io.stdout, `nodes: ${Array.isArray(res.body.nodes) ? res.body.nodes.length : 0}`);
    if (Array.isArray(res.body.edges)) writeLine(ctx.io.stdout, `edges: ${res.body.edges.length}`);
  }
  return 0;
}

async function runWorkflowsRegister(ctx: Ctx, argv) {
  const { options, positionals } = parseOptions(argv, { bool: ['--help'] });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop workflows register <workflow.json> [--json]\n');
    return options.help ? 0 : 2;
  }
  const file = resolvePath(ctx.cwd, positionals[0]);
  const body = JSON.parse(await readFile(file, 'utf8'));
  const res = await requestJson(ctx, '/v1/host/sample/workflows', { method: 'POST', body });
  if (ctx.json) writeJson(ctx.io.stdout, res.body);
  else writeLine(ctx.io.stdout, `Registered workflow ${res.body.workflowId} (${res.body.nodeCount} nodes)`);
  return 0;
}

async function runWorkflowsDelete(ctx: Ctx, argv) {
  const { options, positionals } = parseOptions(argv, { bool: ['--help'] });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop workflows delete <workflowId> [--json]\n');
    return options.help ? 0 : 2;
  }
  const workflowId = encodeURIComponent(positionals[0]);
  const res = await requestJson(ctx, `/v1/host/sample/workflows/${workflowId}`, { method: 'DELETE' });
  if (ctx.json) writeJson(ctx.io.stdout, res.body);
  else writeLine(ctx.io.stdout, `${res.body.removed ? 'Deleted' : 'No matching workflow'}: ${res.body.workflowId}`);
  return 0;
}

async function runRuns(ctx: Ctx, argv) {
  const sub = argv[0] ?? 'list';
  const args = argv.slice(['list', 'create', 'get', 'cancel', 'ancestry'].includes(sub) ? 1 : 0);
  if (sub === '--help' || sub === '-h') {
    write(ctx.io.stdout, RUNS_HELP);
    return 0;
  }
  switch (sub) {
    case 'list':
      return runRunsList(ctx, args);
    case 'create':
      return runRunsCreate(ctx, args);
    case 'get':
      return runRunsGet(ctx, args);
    case 'cancel':
      return runRunsCancel(ctx, args);
    case 'ancestry':
      return runRunsAncestry(ctx, args);
    default:
      throw new CliError(`Unknown runs command: ${sub}`);
  }
}

async function runRunsList(ctx: Ctx, argv) {
  const { options } = parseOptions(argv, {
    bool: ['--help'],
    value: ['--status', '--limit', '--tenant-id'],
  });
  if (options.help) {
    write(ctx.io.stdout, RUNS_HELP);
    return 0;
  }
  const query = new URLSearchParams();
  if (options.status) query.set('status', options.status);
  if (options.limit) query.set('limit', options.limit);
  if (options.tenantId) query.set('tenantId', options.tenantId);
  const path = `/v1/runs${query.size ? `?${query.toString()}` : ''}`;
  const res = await requestJson(ctx, path);
  if (ctx.json) {
    writeJson(ctx.io.stdout, res.body);
    return 0;
  }
  const rows = (res.body.runs ?? []).map((r) => ({
    runId: r.runId,
    workflowId: r.workflowId,
    status: r.status,
    createdAt: r.createdAt ?? '',
  }));
  writeLine(ctx.io.stdout, rows.length ? formatTable(rows, ['runId', 'workflowId', 'status', 'createdAt']) : 'No runs found.');
  return 0;
}

async function runRunsCreate(ctx: Ctx, argv) {
  const { options, positionals } = parseOptions(argv, {
    bool: ['--help', '--wait'],
    value: ['--tenant-id', '--scope-id', '--inputs-json', '--timeout-ms'],
    multi: ['--input'],
  });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop runs create <workflowId> [--input k=v] [--inputs-json JSON] [--tenant-id id] [--wait] [--json]\n');
    return options.help ? 0 : 2;
  }
  const body = {
    workflowId: positionals[0],
    ...(options.tenantId ? { tenantId: options.tenantId } : {}),
    ...(options.scopeId ? { scopeId: options.scopeId } : {}),
    inputs: buildInputs(options),
  };
  const res = await requestJson(ctx, '/v1/runs', { method: 'POST', body });
  if (options.wait) {
    const snap = await waitForRun(ctx, res.body.runId, Number(options.timeoutMs ?? 30000));
    if (ctx.json) writeJson(ctx.io.stdout, { created: res.body, final: snap });
    else {
      writeLine(ctx.io.stdout, `Created run ${res.body.runId}`);
      writeLine(ctx.io.stdout, `Final status: ${snap.status}`);
    }
    return snap.status === 'completed' ? 0 : 1;
  }
  if (ctx.json) writeJson(ctx.io.stdout, res.body);
  else writeLine(ctx.io.stdout, `Created run ${res.body.runId} (${res.body.status})`);
  return 0;
}

async function runRunsGet(ctx: Ctx, argv) {
  const { options, positionals } = parseOptions(argv, { bool: ['--help'] });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop runs get <runId> [--json]\n');
    return options.help ? 0 : 2;
  }
  const res = await requestJson(ctx, `/v1/runs/${encodeURIComponent(positionals[0])}`);
  if (ctx.json) writeJson(ctx.io.stdout, res.body);
  else {
    writeLine(ctx.io.stdout, `runId: ${res.body.runId}`);
    writeLine(ctx.io.stdout, `workflowId: ${res.body.workflowId}`);
    writeLine(ctx.io.stdout, `status: ${res.body.status}`);
  }
  return 0;
}

async function runRunsCancel(ctx: Ctx, argv) {
  const { options, positionals } = parseOptions(argv, {
    bool: ['--help'],
    value: ['--reason'],
  });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop runs cancel <runId> [--reason text] [--json]\n');
    return options.help ? 0 : 2;
  }
  const body = options.reason ? { reason: options.reason } : {};
  const res = await requestJson(ctx, `/v1/runs/${encodeURIComponent(positionals[0])}/cancel`, { method: 'POST', body });
  if (ctx.json) writeJson(ctx.io.stdout, res.body);
  else writeLine(ctx.io.stdout, `Cancelled ${positionals[0]}`);
  return 0;
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


async function runChat(ctx: Ctx, argv) {
  const { options, positionals } = parseOptions(argv, {
    bool: ['--help', '--no-stream', '--no-history'],
    value: ['--tenant-id', '--scope-id', '--inputs-json', '--timeout-ms', '--role'],
    multi: ['--input'],
  });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, CHAT_HELP);
    return options.help ? 0 : 2;
  }
  const workflowId = positionals[0];
  const timeoutMs = Number(options.timeoutMs ?? 120000);
  const useStream = !options.noStream;
  const keepHistory = !options.noHistory;
  const role = options.role ?? 'user';

  // Seed inputs that ride along on every turn (e.g. credentialRef, model).
  // `--input k=v` / `--inputs-json` carry over so the workflow gets the
  // same configurable shape `runs create` would have produced.
  const baseInputs = buildInputs(options);
  // Conversation history threaded as the `messages` array across turns.
  const messages = Array.isArray(baseInputs.messages) ? [...baseInputs.messages] : [];

  if (!ctx.json) {
    writeLine(ctx.io.stdout, `OpenWOP chat — workflow ${workflowId} @ ${ctx.baseUrl}`);
    writeLine(ctx.io.stdout, 'Type a message and press Enter. /exit or Ctrl-D to quit.');
    writeLine(ctx.io.stdout, '');
  }

  const readTurn = ctx.readTurn ?? defaultReadTurn(ctx);
  while (true) {
    const line = await readTurn('you> ');
    if (line === null) {
      // EOF (Ctrl-D) — graceful exit.
      if (!ctx.json) writeLine(ctx.io.stdout, '');
      break;
    }
    const text = line.trim();
    if (text === '') continue;
    if (text === '/exit' || text === '/quit') break;

    messages.push({ role, content: text });
    const inputs = { ...baseInputs, messages: keepHistory ? messages : [{ role, content: text }] };

    let runId;
    try {
      runId = await submitTurn(ctx, { workflowId, inputs, tenantId: options.tenantId, scopeId: options.scopeId });
    } catch (err) {
      writeLine(ctx.io.stderr, `openwop: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    const assistantParts: string[] = [];
    const onEvent = (ev) => {
      if (ctx.json) {
        writeJson(ctx.io.stdout, ev);
      } else {
        const rendered = renderEvent(ev);
        if (rendered) writeLine(ctx.io.stdout, rendered);
      }
      const reply = extractAssistantText(ev);
      if (reply) assistantParts.push(reply);
    };

    try {
      await streamRunEvents(ctx, runId, { onEvent, useStream, timeoutMs });
    } catch (err) {
      writeLine(ctx.io.stderr, `openwop: stream error: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Thread the assistant reply back into history so the next turn has context.
    if (keepHistory && assistantParts.length > 0) {
      messages.push({ role: 'assistant', content: assistantParts.join('') });
    }
    if (!ctx.json) writeLine(ctx.io.stdout, '');
  }
  return 0;
}

/**
 * Create a run for one chat turn. Mirrors the POST body that `runs create`
 * builds. Returns the new runId.
 */

async function runRunsAncestry(ctx: Ctx, argv) {
  const { options, positionals } = parseOptions(argv, { bool: ['--help'] });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop runs ancestry <runId> [--json]\n');
    return options.help ? 0 : 2;
  }
  // RFC 0040 §C — GET /v1/runs/{runId}/ancestry. Each run carries a single
  // cross-host parent link (`parent`), so the ancestry is a linear chain.
  // Walk it from the requested run up to the top-level root, following the
  // same-host `parent.runId` until `parent === null`. A depth cap guards
  // against a malformed cycle. The endpoint is opt-in (Phase 3) and returns
  // 404 when not advertised — surface that as a clear message.
  const chain: any[] = [];
  let current = encodeURIComponent(positionals[0]);
  const MAX_DEPTH = 64;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    let res;
    try {
      res = await requestJson(ctx, `/v1/runs/${current}/ancestry`);
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) {
        // Distinguish "endpoint not enabled" from "run not found" via the body.
        const detail = err.body && typeof err.body === 'object' && typeof (err.body as { message?: string }).message === 'string'
          ? (err.body as { message?: string }).message
          : 'not found';
        throw new CliError(`runs ancestry unavailable: ${detail} (the ancestry endpoint is opt-in; the host must advertise crossHostCausation.ancestryEndpointSupported).`, 2);
      }
      throw err;
    }
    chain.push(res.body);
    const parent = res.body.parent;
    if (!parent || typeof parent.runId !== 'string') break;
    // A cross-host parent (with wellKnownUrl) can't be walked over this host;
    // record the link and stop.
    if (parent.wellKnownUrl) break;
    current = encodeURIComponent(parent.runId);
  }

  if (ctx.json) {
    writeJson(ctx.io.stdout, { runId: positionals[0], chain });
    return 0;
  }

  // Render the chain root → requested run as a table, oldest ancestor first.
  const ordered = [...chain].reverse();
  const rows = ordered.map((node, i) => {
    const parent = node.parent;
    return {
      depth: ordered.length - 1 - i,
      runId: node.runId,
      hostId: node.hostId ?? '',
      parentRunId: parent && typeof parent.runId === 'string' ? parent.runId : '(root)',
      cause: parent && typeof parent.cause === 'string' ? parent.cause : '',
    };
  });
  writeLine(ctx.io.stdout, formatTable(rows, ['depth', 'runId', 'hostId', 'parentRunId', 'cause']));
  return 0;
}

// Gap D-2 — media helpers wired to the demo backend's sample media routes
// (POST /v1/host/sample/media/{generate-image,transcribe,synthesize}),
// which exercise the core.openwop.ai image-generate / audio-transcribe /
// audio-synthesize node family. The demo backend STUBS the actual provider
// calls (it honestly advertises aiProviders.imageGeneration: supported:false)
// so these produce deterministic fixture assets — real, downloadable, but
// not a live generation. Responses are tagged `stub: true`.

const CONFORMANCE_HELP = `Usage: openwop conformance [--offline] [--filter pattern]

Runs the in-repo @openwop/openwop-conformance CLI. Without --offline it targets the configured --base-url.
`;

async function runConformance(ctx: Ctx, argv) {
  const { options } = parseOptions(argv, {
    bool: ['--help', '--offline'],
    value: ['--filter'],
  });
  if (options.help) {
    write(ctx.io.stdout, CONFORMANCE_HELP);
    return 0;
  }
  const root = requireRepoRoot(ctx);
  const args = ['run', 'cli', '--'];
  if (options.offline) {
    args.push('--offline');
  } else {
    args.push('--base-url', ctx.baseUrl, '--api-key', ctx.apiKey ?? DEFAULT_API_KEY);
  }
  if (options.filter) args.push('--filter', options.filter);
  const result = spawnSync(npmCommand(), args, {
    cwd: join(root, 'conformance'),
    stdio: 'inherit',
    env: ctx.env,
  });
  return result.status ?? 1;
}

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

async function runAgents(ctx: Ctx, argv) {
  const sub = argv[0] ?? 'list';
  const args = argv.slice(['list', 'info', 'run'].includes(sub) ? 1 : 0);
  if (sub === '--help' || sub === '-h') {
    write(ctx.io.stdout, AGENTS_HELP);
    return 0;
  }
  switch (sub) {
    case 'list':
      return await runAgentsList(ctx, args);
    case 'info':
      return await runAgentsInfo(ctx, args);
    case 'run':
      return await runAgentsRun(ctx, args);
    default:
      throw new CliError(`Unknown agents command: ${sub}\nRun \`openwop agents --help\` for usage.`);
  }
}

async function runAgentsList(ctx: Ctx, argv) {
  const { options } = parseOptions(argv, { bool: ['--help'] });
  if (options.help) {
    write(ctx.io.stdout, AGENTS_HELP);
    return 0;
  }
  const res = await requestJson(ctx, '/v1/host/sample/agents');
  if (ctx.json) {
    writeJson(ctx.io.stdout, res.body);
    return 0;
  }
  const agents = Array.isArray(res.body?.agents) ? res.body.agents : [];
  if (agents.length === 0) {
    writeLine(ctx.io.stdout, 'No manifest agents are installed on this host (no pack agents[] loaded into the AgentRegistry).');
    return 0;
  }
  const rows = agents.map((a) => ({
    agentId: a.agentId,
    persona: a.label ?? a.persona,
    modelClass: a.modelClass,
    pack: a.packName,
    tools: Array.isArray(a.toolAllowlist) ? String(a.toolAllowlist.length) : '0',
  }));
  writeLine(ctx.io.stdout, formatTable(rows, ['agentId', 'persona', 'modelClass', 'pack', 'tools']));
  return 0;
}

async function runAgentsInfo(ctx: Ctx, argv) {
  const { options, positionals } = parseOptions(argv, { bool: ['--help'] });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop agents info <agentId> [--json]\n');
    return options.help ? 0 : 2;
  }
  const agentId = encodeURIComponent(positionals[0]);
  const res = await requestJson(ctx, `/v1/host/sample/agents/${agentId}`);
  if (ctx.json) {
    writeJson(ctx.io.stdout, res.body);
    return 0;
  }
  const a = res.body ?? {};
  writeLine(ctx.io.stdout, `agentId: ${a.agentId ?? positionals[0]}`);
  writeLine(ctx.io.stdout, `persona: ${a.persona ?? ''}`);
  if (a.label && a.label !== a.persona) writeLine(ctx.io.stdout, `label: ${a.label}`);
  writeLine(ctx.io.stdout, `modelClass: ${a.modelClass ?? ''}`);
  writeLine(ctx.io.stdout, `pack: ${a.packName ?? ''}@${a.packVersion ?? ''}`);
  if (Array.isArray(a.toolAllowlist)) writeLine(ctx.io.stdout, `toolAllowlist: ${a.toolAllowlist.length ? a.toolAllowlist.join(', ') : '(none)'}`);
  writeLine(ctx.io.stdout, `handoffSchemas: ${a.hasHandoffSchemas ? 'yes' : 'no'}`);
  if (typeof a.confidenceThreshold === 'number') writeLine(ctx.io.stdout, `confidenceThreshold: ${a.confidenceThreshold}`);
  if (a.memoryShape) writeLine(ctx.io.stdout, `memoryShape: ${Object.entries(a.memoryShape).filter(([, v]) => v).map(([k]) => k).join(', ') || '(none)'}`);
  if (a.description) writeLine(ctx.io.stdout, `description: ${a.description}`);
  return 0;
}

// `openwop agents run <agentId>` — dispatch one manifest-agent turn (RFC 0070).
async function runAgentsRun(ctx: Ctx, argv) {
  const { options, positionals } = parseOptions(argv, {
    bool: ['--help', '--no-validate'],
    value: ['--task-json', '--threshold'],
    multi: ['--tool'],
  });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop agents run <agentId> [--task-json \'{...}\'] [--tool <id>]... [--threshold <n>] [--no-validate] [--json]\n');
    return options.help ? 0 : 2;
  }
  const agentId = positionals[0];
  const body: Record<string, any> = {};
  if (options['task-json'] !== undefined) {
    try {
      body.task = JSON.parse(options['task-json']);
    } catch {
      throw new CliError('--task-json must be valid JSON', 2);
    }
  }
  if (Array.isArray(options.tool) && options.tool.length) body.availableTools = options.tool;
  if (options.threshold !== undefined) {
    const t = Number(options.threshold);
    if (!Number.isFinite(t) || t < 0 || t > 1) {
      throw new CliError('--threshold must be a number between 0 and 1', 2);
    }
    body.confidenceThreshold = t;
  }
  if (options['no-validate']) body.validateHandoff = false;

  const res = await requestJson(ctx, `/v1/host/sample/agents/${encodeURIComponent(agentId)}/dispatch`, {
    method: 'POST',
    body,
  });
  if (ctx.json) {
    writeJson(ctx.io.stdout, res.body);
    return 0;
  }
  const r = res.body ?? {};
  writeLine(ctx.io.stdout, `agent: ${r.agentId ?? agentId} (${r.persona ?? ''})`);
  writeLine(ctx.io.stdout, `status: ${r.status ?? 'unknown'}`);
  writeLine(ctx.io.stdout, `confidence: ${r.confidence} (threshold ${r.threshold})`);
  if (Array.isArray(r.toolSurface)) writeLine(ctx.io.stdout, `toolSurface: ${r.toolSurface.length ? r.toolSurface.join(', ') : '(none)'}`);
  if (Array.isArray(r.events)) {
    for (const e of r.events) {
      writeLine(ctx.io.stdout, `  · ${e.type}${e.decision ? ` [${e.decision}]` : ''}${e.summary ? `: ${e.summary}` : ''}`);
    }
  }
  if (r.error) writeLine(ctx.io.stdout, `error: ${r.error.code} — ${r.error.message}`);
  if (r.result !== undefined) writeLine(ctx.io.stdout, `result: ${JSON.stringify(r.result)}`);
  // Non-zero exit when the agent did not complete, so scripts can branch.
  return r.status === 'completed' ? 0 : (r.status === 'escalated' ? 3 : 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// `openwop config ...`
// ─────────────────────────────────────────────────────────────────────────────

async function runConfig(ctx: Ctx, argv) {
  const sub = argv[0] ?? 'file';
  const args = argv.slice(['file', 'get', 'set', 'unset'].includes(sub) ? 1 : 0);
  if (sub === '--help' || sub === '-h') {
    write(ctx.io.stdout, CONFIG_HELP);
    return 0;
  }
  switch (sub) {
    case 'file':
      writeLine(ctx.io.stdout, configPathFor(undefined, ctx.env));
      return 0;
    case 'get': {
      const configPath = configPathFor(undefined, ctx.env);
      const config = readConfigSafe(configPath) ?? {};
      if (args.length === 0) {
        if (ctx.json) writeJson(ctx.io.stdout, config);
        else writeLine(ctx.io.stdout, JSON.stringify(config, null, 2));
        return 0;
      }
      const value = getByPath(config, args[0]);
      if (value === undefined) {
        writeLine(ctx.io.stderr, `(unset: ${args[0]})`);
        return 1;
      }
      if (ctx.json) writeJson(ctx.io.stdout, value);
      else writeLine(ctx.io.stdout, typeof value === 'string' ? value : JSON.stringify(value));
      return 0;
    }
    case 'set': {
      if (args.length !== 2) throw new CliError('Usage: openwop config set <key> <value>');
      const configPath = configPathFor(undefined, ctx.env);
      const config = readConfigSafe(configPath) ?? {};
      setByPath(config, args[0], parseInputValue(args[1]));
      saveConfig(configPath, config);
      writeLine(ctx.io.stdout, `set ${args[0]} = ${args[1]}`);
      return 0;
    }
    case 'unset': {
      if (args.length !== 1) throw new CliError('Usage: openwop config unset <key>');
      const configPath = configPathFor(undefined, ctx.env);
      const config = readConfigSafe(configPath) ?? {};
      unsetByPath(config, args[0]);
      saveConfig(configPath, config);
      writeLine(ctx.io.stdout, `unset ${args[0]}`);
      return 0;
    }
    default:
      throw new CliError(`Unknown config command: ${sub}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// `openwop webhooks ...` — manage webhook subscriptions (C-9)
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Messaging relay-gateway (demo host-extension — /v1/host/sample/messaging).
// Operator endpoints use the host bearer; the device loop authenticates with
// the per-device token in the x-openwop-device-token header.
// ─────────────────────────────────────────────────────────────────────────────

const MESSAGING_BASE = '/v1/host/sample/messaging';
const DEVICE_TOKEN_HEADER = 'x-openwop-device-token';
const RELAY_CHANNELS = ['whatsapp', 'signal', 'imessage'];

// The relay record carries the device token — a bearer-equivalent host
// credential. It is kept OUT of config.json (which holds only non-secret
// settings + BYOK refs) and written to a dedicated 0600 file, preserving the
// CLI's "no secrets in config.json" posture (see cli/README §Config).
function relayCredsPath(env) {
  return join(openwopHomeDir(env), 'relay-credentials.json');
}

function loadRelayConfig(ctx: Ctx) {
  try {
    const p = relayCredsPath(ctx.env);
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'));
  } catch { /* unreadable/corrupt → treat as unconfigured */ }
  return {};
}

function saveRelayConfig(ctx: Ctx, relay) {
  const p = relayCredsPath(ctx.env);
  mkdirSync(dirname(p), { recursive: true });
  if (!relay || Object.keys(relay).length === 0) {
    try { if (existsSync(p)) rmSync(p); } catch { /* best-effort */ }
    return;
  }
  writeFileSync(p, `${JSON.stringify(relay, null, 2)}\n`, 'utf8');
  try { chmodSync(p, 0o600); } catch { /* best-effort on Windows */ }
}

async function runMessaging(ctx: Ctx, argv) {
  const sub = argv[0];
  if (!sub || sub === '--help' || sub === '-h') {
    write(ctx.io.stdout, MESSAGING_HELP);
    return sub ? 0 : 2;
  }
  const args = argv.slice(1);
  switch (sub) {
    case 'connectors':
      return await runMessagingConnectors(ctx, args);
    case 'sessions':
      return await runMessagingSessions(ctx, args);
    case 'policy':
    case 'policies':
      return await runMessagingPolicies(ctx, args);
    case 'routing':
      return await runMessagingRouting(ctx, args);
    case 'identity':
    case 'identities':
      return await runMessagingIdentity(ctx, args);
    case 'logs':
      return await runMessagingLogs(ctx, args);
    default:
      throw new CliError(`Unknown messaging command: ${sub}\nRun \`openwop messaging --help\` for usage.`);
  }
}

async function runMessagingConnectors(ctx: Ctx, argv) {
  const sub = argv[0] ?? 'list';
  const args = argv.slice(['list', 'get', 'add', 'enable', 'disable', 'test'].includes(sub) ? 1 : 0);
  switch (sub) {
    case 'list': {
      const res = await requestJson(ctx, `${MESSAGING_BASE}/connectors`);
      if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
      const connectors = Array.isArray(res.body?.connectors) ? res.body.connectors : [];
      if (connectors.length === 0) {
        writeLine(ctx.io.stdout, 'No connectors. Add one with `openwop messaging connectors add --channel signal`.');
        return 0;
      }
      writeLine(ctx.io.stdout, formatTable(
        connectors.map((c) => ({ connectorId: c.connectorId, channel: c.channel, enabled: String(c.enabled), displayName: c.displayName ?? '' })),
        ['connectorId', 'channel', 'enabled', 'displayName'],
      ));
      return 0;
    }
    case 'get': {
      if (args.length !== 1) { write(ctx.io.stdout, 'Usage: openwop messaging connectors get <connectorId> [--json]\n'); return 2; }
      const res = await requestJson(ctx, `${MESSAGING_BASE}/connectors/${encodeURIComponent(args[0])}`);
      writeJson(ctx.io.stdout, res.body);
      return 0;
    }
    case 'add': {
      const { options } = parseOptions(args, { value: ['--channel', '--display-name', '--connector-id'] });
      if (!options.channel) throw new CliError('--channel is required (one of: ' + RELAY_CHANNELS.join(', ') + ').');
      const body = {
        channel: options.channel,
        ...(options.displayName ? { displayName: options.displayName } : {}),
        ...(options.connectorId ? { connectorId: options.connectorId } : {}),
      };
      const res = await requestJson(ctx, `${MESSAGING_BASE}/connectors`, { method: 'POST', body });
      if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
      writeLine(ctx.io.stdout, `✓ Connector ${res.body.connectorId} (${res.body.channel}) — enabled=${res.body.enabled}`);
      return 0;
    }
    case 'enable':
    case 'disable': {
      if (args.length !== 1) { write(ctx.io.stdout, `Usage: openwop messaging connectors ${sub} <connectorId> [--json]\n`); return 2; }
      const res = await requestJson(ctx, `${MESSAGING_BASE}/connectors/${encodeURIComponent(args[0])}/${sub}`, { method: 'POST', body: {} });
      if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
      writeLine(ctx.io.stdout, `✓ Connector ${res.body.connectorId} enabled=${res.body.enabled}`);
      return 0;
    }
    case 'test': {
      if (args.length !== 1) { write(ctx.io.stdout, 'Usage: openwop messaging connectors test <connectorId> [--json]\n'); return 2; }
      const res = await requestJson(ctx, `${MESSAGING_BASE}/connectors/${encodeURIComponent(args[0])}/test`, { method: 'POST', body: {} });
      if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
      writeLine(ctx.io.stdout, `${res.body.ok ? '✓' : '✗'} ${res.body.connectorId}: ${res.body.detail}`);
      return res.body.ok ? 0 : 1;
    }
    default:
      throw new CliError(`Unknown connectors command: ${sub}`);
  }
}

async function runMessagingSessions(ctx: Ctx, argv) {
  const sub = argv[0] ?? 'list';
  const args = argv.slice(['list', 'inspect', 'close'].includes(sub) ? 1 : 0);
  switch (sub) {
    case 'list': {
      const res = await requestJson(ctx, `${MESSAGING_BASE}/sessions`);
      if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
      const sessions = Array.isArray(res.body?.sessions) ? res.body.sessions : [];
      if (sessions.length === 0) { writeLine(ctx.io.stdout, 'No messaging sessions yet.'); return 0; }
      writeLine(ctx.io.stdout, formatTable(
        sessions.map((s) => ({ sessionKey: s.sessionKey, channel: s.channel, peer: s.peerDisplay ?? s.peerId, messages: String(s.messageCount), lastInboundAt: s.lastInboundAt ?? '' })),
        ['sessionKey', 'channel', 'peer', 'messages', 'lastInboundAt'],
      ));
      return 0;
    }
    case 'inspect': {
      if (args.length !== 1) { write(ctx.io.stdout, 'Usage: openwop messaging sessions inspect <sessionKey> [--json]\n'); return 2; }
      const res = await requestJson(ctx, `${MESSAGING_BASE}/sessions/${encodeURIComponent(args[0])}`);
      writeJson(ctx.io.stdout, res.body);
      return 0;
    }
    case 'close': {
      if (args.length !== 1) { write(ctx.io.stdout, 'Usage: openwop messaging sessions close <sessionKey> [--json]\n'); return 2; }
      await requestJson(ctx, `${MESSAGING_BASE}/sessions/${encodeURIComponent(args[0])}`, { method: 'DELETE' });
      if (ctx.json) writeJson(ctx.io.stdout, { closed: args[0] });
      else writeLine(ctx.io.stdout, `✓ Closed session ${args[0]}`);
      return 0;
    }
    default:
      throw new CliError(`Unknown sessions command: ${sub}`);
  }
}

async function runMessagingPolicies(ctx: Ctx, argv) {
  const sub = argv[0] ?? 'get';
  const args = argv.slice(['get', 'set'].includes(sub) ? 1 : 0);
  switch (sub) {
    case 'get': {
      if (args.length !== 1) { write(ctx.io.stdout, 'Usage: openwop messaging policy get <connectorId> [--json]\n'); return 2; }
      const res = await requestJson(ctx, `${MESSAGING_BASE}/connectors/${encodeURIComponent(args[0])}/policy`);
      if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
      const p = res.body;
      writeLine(ctx.io.stdout, `${p.connectorId}: dm=${p.dmPolicy} group=${p.groupPolicy} requireMention=${p.requireMention}`);
      return 0;
    }
    case 'set': {
      const { options, positionals } = parseOptions(args, { value: ['--dm', '--group', '--require-mention'] });
      const connectorId = positionals[0];
      if (!connectorId) { write(ctx.io.stdout, 'Usage: openwop messaging policy set <connectorId> [--dm <pairing|allowlist|open|disabled>] [--group <allowlist|open|disabled>] [--require-mention <true|false>]\n'); return 2; }
      const body: Record<string, unknown> = {};
      if (options.dm) body.dmPolicy = options.dm;
      if (options.group) body.groupPolicy = options.group;
      if (options.requireMention !== undefined) body.requireMention = options.requireMention === 'true';
      const res = await requestJson(ctx, `${MESSAGING_BASE}/connectors/${encodeURIComponent(connectorId)}/policy`, { method: 'PUT', body });
      if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
      const p = res.body;
      writeLine(ctx.io.stdout, `✓ ${p.connectorId}: dm=${p.dmPolicy} group=${p.groupPolicy} requireMention=${p.requireMention}`);
      return 0;
    }
    default:
      throw new CliError(`Unknown policy command: ${sub}`);
  }
}

async function runMessagingRouting(ctx: Ctx, argv) {
  const sub = argv[0] ?? 'list';
  const args = argv.slice(['list', 'add', 'remove'].includes(sub) ? 1 : 0);
  switch (sub) {
    case 'list': {
      const res = await requestJson(ctx, `${MESSAGING_BASE}/routing`);
      if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
      const rules = Array.isArray(res.body?.rules) ? res.body.rules : [];
      if (rules.length === 0) { writeLine(ctx.io.stdout, 'No routing rules. Add one with `openwop messaging routing add --pattern "*" --workflow <id>`.'); return 0; }
      writeLine(ctx.io.stdout, formatTable(
        rules.map((r) => ({ ruleId: r.ruleId, channel: r.channel ?? '(any)', pattern: r.pattern, workflowId: r.workflowId, priority: String(r.priority) })),
        ['ruleId', 'channel', 'pattern', 'workflowId', 'priority'],
      ));
      return 0;
    }
    case 'add': {
      const { options } = parseOptions(args, { value: ['--channel', '--pattern', '--workflow', '--priority', '--rule-id'] });
      if (!options.pattern) throw new CliError('--pattern is required (use "*" to match any).');
      if (!options.workflow) throw new CliError('--workflow is required (the workflowId to bind).');
      const body = {
        ...(options.channel ? { channel: options.channel } : {}),
        pattern: options.pattern,
        workflowId: options.workflow,
        ...(options.priority !== undefined ? { priority: Number(options.priority) } : {}),
        ...(options.ruleId ? { ruleId: options.ruleId } : {}),
      };
      const res = await requestJson(ctx, `${MESSAGING_BASE}/routing`, { method: 'POST', body });
      if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
      writeLine(ctx.io.stdout, `✓ Rule ${res.body.ruleId} — ${res.body.channel ?? '(any)'}/${res.body.pattern} → ${res.body.workflowId} (priority ${res.body.priority})`);
      return 0;
    }
    case 'remove': {
      if (args.length !== 1) { write(ctx.io.stdout, 'Usage: openwop messaging routing remove <ruleId> [--json]\n'); return 2; }
      await requestJson(ctx, `${MESSAGING_BASE}/routing/${encodeURIComponent(args[0])}`, { method: 'DELETE' });
      if (ctx.json) writeJson(ctx.io.stdout, { removed: args[0] });
      else writeLine(ctx.io.stdout, `✓ Removed routing rule ${args[0]}`);
      return 0;
    }
    default:
      throw new CliError(`Unknown routing command: ${sub}`);
  }
}

async function runMessagingIdentity(ctx: Ctx, argv) {
  const sub = argv[0] ?? 'list';
  const args = argv.slice(['list', 'show', 'create', 'link', 'unlink', 'delete'].includes(sub) ? 1 : 0);
  switch (sub) {
    case 'list': {
      const res = await requestJson(ctx, `${MESSAGING_BASE}/identities`);
      if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
      const identities = Array.isArray(res.body?.identities) ? res.body.identities : [];
      if (identities.length === 0) { writeLine(ctx.io.stdout, 'No identities. Create one with `openwop messaging identity create --name Alice --peer signal:+1555…`.'); return 0; }
      writeLine(ctx.io.stdout, formatTable(
        identities.map((i) => ({ identityId: i.identityId, displayName: i.displayName ?? '', peers: (i.peers ?? []).map((p) => `${p.channel}:${p.peerId}`).join(', ') })),
        ['identityId', 'displayName', 'peers'],
      ));
      return 0;
    }
    case 'show': {
      if (args.length !== 1) { write(ctx.io.stdout, 'Usage: openwop messaging identity show <identityId> [--json]\n'); return 2; }
      const res = await requestJson(ctx, `${MESSAGING_BASE}/identities/${encodeURIComponent(args[0])}`);
      writeJson(ctx.io.stdout, res.body);
      return 0;
    }
    case 'create':
    case 'link': {
      // create: openwop messaging identity create --name N --peer ch:peerId [--peer ...]
      // link:   openwop messaging identity link <identityId> --peer ch:peerId [--peer ...]
      const { options, positionals } = parseOptions(args, { value: ['--name'], multi: ['--peer'] });
      const peers = parsePeerFlags(options.peer);
      if (sub === 'link') {
        const identityId = positionals[0];
        if (!identityId) { write(ctx.io.stdout, 'Usage: openwop messaging identity link <identityId> --peer <channel>:<peerId> [...]\n'); return 2; }
        if (peers.length === 0) throw new CliError('at least one --peer <channel>:<peerId> is required.');
        const body = { identityId, peers, ...(options.name ? { displayName: options.name } : {}) };
        const res = await requestJson(ctx, `${MESSAGING_BASE}/identities`, { method: 'POST', body });
        if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
        writeLine(ctx.io.stdout, `✓ ${res.body.identityId} now linked to ${res.body.peers.length} peer(s)`);
        return 0;
      }
      if (peers.length === 0) throw new CliError('at least one --peer <channel>:<peerId> is required.');
      const body = { peers, ...(options.name ? { displayName: options.name } : {}) };
      const res = await requestJson(ctx, `${MESSAGING_BASE}/identities`, { method: 'POST', body });
      if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
      writeLine(ctx.io.stdout, `✓ Identity ${res.body.identityId} (${res.body.displayName ?? 'unnamed'}) — ${res.body.peers.length} peer(s)`);
      return 0;
    }
    case 'unlink': {
      // openwop messaging identity unlink <identityId> --peer <channel>:<peerId>
      const { options, positionals } = parseOptions(args, { value: ['--peer'] });
      const identityId = positionals[0];
      if (!identityId || !options.peer) { write(ctx.io.stdout, 'Usage: openwop messaging identity unlink <identityId> --peer <channel>:<peerId>\n'); return 2; }
      const [channel, ...rest] = String(options.peer).split(':');
      const peerId = rest.join(':');
      if (!channel || !peerId) throw new CliError('--peer must be <channel>:<peerId>.');
      const res = await requestJson(ctx, `${MESSAGING_BASE}/identities/${encodeURIComponent(identityId)}?channel=${encodeURIComponent(channel)}&peerId=${encodeURIComponent(peerId)}`, { method: 'DELETE' });
      if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
      writeLine(ctx.io.stdout, `✓ Unlinked ${channel}:${peerId} from ${identityId}`);
      return 0;
    }
    case 'delete': {
      if (args.length !== 1) { write(ctx.io.stdout, 'Usage: openwop messaging identity delete <identityId> [--json]\n'); return 2; }
      await requestJson(ctx, `${MESSAGING_BASE}/identities/${encodeURIComponent(args[0])}`, { method: 'DELETE' });
      if (ctx.json) writeJson(ctx.io.stdout, { deleted: args[0] });
      else writeLine(ctx.io.stdout, `✓ Deleted identity ${args[0]}`);
      return 0;
    }
    default:
      throw new CliError(`Unknown identity command: ${sub}`);
  }
}

async function runMessagingLogs(ctx: Ctx, argv) {
  const { options } = parseOptions(argv, { value: ['--channel', '--direction', '--status', '--limit'] });
  const query = new URLSearchParams();
  if (options.channel) query.set('channel', options.channel);
  if (options.direction) query.set('direction', options.direction);
  if (options.status) query.set('status', options.status);
  if (options.limit !== undefined) query.set('limit', String(options.limit));
  const qs = query.toString();
  const res = await requestJson(ctx, `${MESSAGING_BASE}/logs${qs ? `?${qs}` : ''}`);
  if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
  const entries = Array.isArray(res.body?.entries) ? res.body.entries : [];
  if (entries.length === 0) { writeLine(ctx.io.stdout, 'No delivery-log entries.'); return 0; }
  writeLine(ctx.io.stdout, formatTable(
    entries.map((e) => ({ at: e.at, direction: e.direction, channel: e.channel, conversationId: e.conversationId, status: e.status, detail: e.detail ?? '' })),
    ['at', 'direction', 'channel', 'conversationId', 'status', 'detail'],
  ));
  return 0;
}

/** Parse repeated `--peer <channel>:<peerId>` flags into peer objects. */
function parsePeerFlags(raw: unknown): Array<{ channel: string; peerId: string }> {
  const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  return list.map((entry) => {
    const [channel, ...rest] = String(entry).split(':');
    const peerId = rest.join(':');
    if (!channel || !peerId) throw new CliError(`--peer must be <channel>:<peerId> (got "${entry}").`);
    return { channel, peerId };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// notify — one-off email/sms dispatch via the demo host (synthetic receipt).
// ─────────────────────────────────────────────────────────────────────────────

async function runNotify(ctx: Ctx, argv) {
  const kind = argv[0];
  if (!kind || kind === '--help' || kind === '-h') {
    write(ctx.io.stdout, NOTIFY_HELP);
    return kind ? 0 : 2;
  }
  if (kind !== 'email' && kind !== 'sms') {
    throw new CliError(`Unknown notify kind: ${kind}\nUsage: openwop notify <email|sms> --to <addr> --text <msg> [--subject s]`);
  }
  const { options } = parseOptions(argv.slice(1), { value: ['--to', '--text', '--subject'] });
  if (!options.to) throw new CliError('--to is required.');
  if (!options.text) throw new CliError('--text is required.');
  const body = {
    kind,
    to: options.to,
    text: options.text,
    ...(options.subject ? { subject: options.subject } : {}),
  };
  const res = await requestJson(ctx, `${MESSAGING_BASE}/notify`, { method: 'POST', body });
  if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
  writeLine(ctx.io.stdout, `✓ ${kind} ${res.body.notifyId} → ${res.body.to}: ${res.body.status} (${res.body.detail})`);
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Relay device — register/activate a local channel relay, run the bridge loop.
// ─────────────────────────────────────────────────────────────────────────────

async function runRelay(ctx: Ctx, argv) {
  const sub = argv[0];
  if (!sub || sub === '--help' || sub === '-h') {
    write(ctx.io.stdout, RELAY_HELP);
    return sub ? 0 : 2;
  }
  const args = argv.slice(1);
  switch (sub) {
    case 'register': return await runRelayRegister(ctx, args);
    case 'activate': return await runRelayActivate(ctx, args);
    case 'setup': return await runRelaySetup(ctx, args);
    case 'revoke': return await runRelayRevoke(ctx, args);
    case 'send': return await runRelaySend(ctx, args);
    case 'status': return await runRelayStatus(ctx, args);
    case 'start': return await runRelayStart(ctx, args);
    case 'stop': return await runRelayStop(ctx, args);
    case 'logs': return await runRelayLogs(ctx, args);
    default:
      throw new CliError(`Unknown relay command: ${sub}\nRun \`openwop relay --help\` for usage.`);
  }
}

function assertRelayChannel(channel) {
  if (!RELAY_CHANNELS.includes(channel)) {
    throw new CliError(`--channel must be one of: ${RELAY_CHANNELS.join(', ')}`);
  }
}

async function runRelayRegister(ctx: Ctx, argv) {
  const { options } = parseOptions(argv, { value: ['--channel', '--name'] });
  if (!options.channel) throw new CliError('--channel is required (one of: ' + RELAY_CHANNELS.join(', ') + ').');
  assertRelayChannel(options.channel);
  const body = { channel: options.channel, ...(options.name ? { deviceName: options.name } : {}) };
  const res = await requestJson(ctx, `${MESSAGING_BASE}/relay/register`, { method: 'POST', body });
  if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
  writeLine(ctx.io.stdout, `✓ Registered relay ${res.body.relayId} (${res.body.channel})`);
  writeLine(ctx.io.stdout, `  Activate with: openwop relay activate --relay-id ${res.body.relayId} --code ${res.body.activationCode}`);
  return 0;
}

async function runRelayActivate(ctx: Ctx, argv) {
  const { options } = parseOptions(argv, { value: ['--relay-id', '--code'] });
  if (!options.relayId || !options.code) throw new CliError('--relay-id and --code are required.');
  const res = await requestJson(ctx, `${MESSAGING_BASE}/relay/activate`, {
    method: 'POST',
    body: { relayId: options.relayId, activationCode: options.code },
  });
  saveRelayConfig(ctx, {
    relayId: res.body.relayId,
    channel: res.body.channel,
    deviceToken: res.body.deviceToken,
    tokenExpiresAt: res.body.tokenExpiresAt,
    baseUrl: ctx.baseUrl,
  });
  if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
  writeLine(ctx.io.stdout, `✓ Activated relay ${res.body.relayId} — device token stored in config.`);
  return 0;
}

async function runRelaySetup(ctx: Ctx, argv) {
  const { options } = parseOptions(argv, { value: ['--channel', '--name'] });
  if (!options.channel) throw new CliError('--channel is required (one of: ' + RELAY_CHANNELS.join(', ') + ').');
  assertRelayChannel(options.channel);
  const reg = await requestJson(ctx, `${MESSAGING_BASE}/relay/register`, {
    method: 'POST',
    body: { channel: options.channel, ...(options.name ? { deviceName: options.name } : {}) },
  });
  const act = await requestJson(ctx, `${MESSAGING_BASE}/relay/activate`, {
    method: 'POST',
    body: { relayId: reg.body.relayId, activationCode: reg.body.activationCode },
  });
  saveRelayConfig(ctx, {
    relayId: act.body.relayId,
    channel: act.body.channel,
    deviceToken: act.body.deviceToken,
    tokenExpiresAt: act.body.tokenExpiresAt,
    baseUrl: ctx.baseUrl,
  });
  if (ctx.json) { writeJson(ctx.io.stdout, act.body); return 0; }
  writeLine(ctx.io.stdout, `✓ Relay ${act.body.relayId} (${act.body.channel}) registered + activated.`);
  writeLine(ctx.io.stdout, `  Start the bridge with: openwop relay start`);
  return 0;
}

async function runRelayRevoke(ctx: Ctx, argv) {
  const { options } = parseOptions(argv, { value: ['--relay-id'] });
  const relayId = options.relayId ?? loadRelayConfig(ctx).relayId;
  if (!relayId) throw new CliError('No relay to revoke. Pass --relay-id or run `openwop relay setup` first.');
  const res = await requestJson(ctx, `${MESSAGING_BASE}/relay/revoke`, { method: 'POST', body: { relayId } });
  if (!options.relayId) saveRelayConfig(ctx, {});
  if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
  writeLine(ctx.io.stdout, `✓ Revoked relay ${relayId}`);
  return 0;
}

async function runRelaySend(ctx: Ctx, argv) {
  const { options } = parseOptions(argv, { value: ['--relay-id', '--conversation', '--text', '--reply-to'] });
  const relayId = options.relayId ?? loadRelayConfig(ctx).relayId;
  if (!relayId) throw new CliError('No relay configured. Pass --relay-id or run `openwop relay setup` first.');
  if (!options.conversation || !options.text) throw new CliError('--conversation and --text are required.');
  const body = {
    relayId,
    conversationId: options.conversation,
    text: options.text,
    ...(options.replyTo ? { replyToMessageId: options.replyTo } : {}),
  };
  const res = await requestJson(ctx, `${MESSAGING_BASE}/relay/enqueue`, { method: 'POST', body });
  if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
  writeLine(ctx.io.stdout, `✓ Queued egress ${res.body.egressId} → conversation ${res.body.conversationId}`);
  return 0;
}

async function runRelayStatus(ctx: Ctx, argv) {
  const { options } = parseOptions(argv, { bool: ['--help'] });
  if (options.help) { write(ctx.io.stdout, RELAY_HELP); return 0; }
  const relay = loadRelayConfig(ctx);
  if (!relay.relayId) {
    writeLine(ctx.io.stdout, 'No relay configured. Run `openwop relay setup --channel <signal|whatsapp|imessage>`.');
    return ctx.json ? (writeJson(ctx.io.stdout, { configured: false }), 0) : 1;
  }
  // A heartbeat doubles as a liveness probe against the host.
  let online = false;
  let detail = '';
  try {
    const res = await requestJson(ctx, `${MESSAGING_BASE}/device/heartbeat`, {
      method: 'POST',
      auth: false,
      headers: { [DEVICE_TOKEN_HEADER]: relay.deviceToken },
      body: { status: 'status-probe' },
    });
    online = res.body?.ok === true;
  } catch (err) {
    detail = err instanceof HttpError ? `HTTP ${err.status}` : errText(err);
  }
  if (ctx.json) {
    writeJson(ctx.io.stdout, { configured: true, relayId: relay.relayId, channel: relay.channel, online, ...(detail ? { detail } : {}) });
    return online ? 0 : 1;
  }
  writeLine(ctx.io.stdout, `relayId:  ${relay.relayId}`);
  writeLine(ctx.io.stdout, `channel:  ${relay.channel}`);
  writeLine(ctx.io.stdout, `host:     ${relay.baseUrl ?? ctx.baseUrl}`);
  writeLine(ctx.io.stdout, `status:   ${online ? 'online (host reachable, token valid)' : `offline${detail ? ` — ${detail}` : ''}`}`);
  return online ? 0 : 1;
}

/**
 * The relay bridge loop: heartbeat + poll outbound + deliver + ack. Channel
 * delivery is pluggable via `deliver` (Phase 3 injects signal/whatsapp/imessage
 * plugins); the default "console" delivery prints the egress, which makes the
 * transport loop observable and testable without platform credentials.
 */
function relayPidPath(env) { return join(openwopHomeDir(env), 'relay.pid.json'); }
function relayLogPath(env) { return join(openwopHomeDir(env), 'relay.log'); }
function readRelayRecord(env) {
  try {
    const p = relayPidPath(env);
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
  } catch { return null; }
}

/**
 * Start streaming inbound platform messages → POST /device/inbound (B4). The
 * channel plugin owns the platform connection (signal-cli / chat.db / Baileys);
 * `ctx.relayPlugin` lets tests inject a fake. Returns a stop function (or
 * undefined when the channel's tooling isn't available — fail-closed, logged).
 */
export async function startInboundReceive(
  ctx: any,
  relay: { channel: RelayChannel; deviceToken: string },
  deviceHeaders: Record<string, string>,
): Promise<(() => void) | undefined> {
  const plugin: ChannelPlugin = ctx.relayPlugin ?? getChannelPlugin(relay.channel);
  const avail = plugin.isAvailable(ctx.env);
  if (!avail.available) {
    writeLine(ctx.io.stderr, `inbound receive skipped: ${avail.detail}`);
    return undefined;
  }
  try {
    const stop = await plugin.startReceive(async (msg: InboundMessage) => {
      try {
        await requestJson(ctx, `${MESSAGING_BASE}/device/inbound`, {
          method: 'POST', auth: false, headers: deviceHeaders, body: msg,
        });
        writeLine(ctx.io.stdout, `← [${relay.channel}] ${msg.conversationId}: ${msg.text}`);
      } catch (err) {
        writeLine(ctx.io.stderr, `inbound forward failed: ${errText(err)}`);
      }
    }, { env: ctx.env });
    writeLine(ctx.io.stdout, `Inbound receive active for ${relay.channel}.`);
    return stop;
  } catch (err) {
    writeLine(ctx.io.stderr, `inbound receive unavailable: ${errText(err)}`);
    return undefined;
  }
}

async function runRelayStart(ctx: Ctx, argv) {
  const { options } = parseOptions(argv, { bool: ['--help', '--once', '--daemon', '--no-receive'], value: ['--interval'] });
  if (options.help) { write(ctx.io.stdout, RELAY_HELP); return 0; }
  const relay = loadRelayConfig(ctx);
  if (!relay.relayId || !relay.deviceToken) {
    throw new CliError('No relay configured. Run `openwop relay setup --channel <signal|whatsapp|imessage>` first.');
  }

  // Daemonize: re-spawn `relay start` (foreground) detached, log to a file,
  // and record the pid. Mirrors `demo start --detach`.
  if (options.daemon) {
    const existing = readRelayRecord(ctx.env);
    if (existing && processAlive(existing.pid)) {
      throw new CliError(`Relay already running (pid ${existing.pid}). Stop it with \`openwop relay stop\`.`);
    }
    const logPath = relayLogPath(ctx.env);
    const fd = openLogStream(logPath);
    const entry = fileURLToPath(new URL('../openwop.mjs', import.meta.url));
    const childArgs = [entry, '--base-url', relay.baseUrl ?? ctx.baseUrl, 'relay', 'start'];
    if (options.interval) childArgs.push('--interval', String(options.interval));
    const child = spawn(process.execPath, childArgs, {
      cwd: ctx.cwd ?? process.cwd(),
      env: ctx.env,
      stdio: ['ignore', fd ?? 'ignore', fd ?? 'ignore'],
      detached: true,
    });
    child.unref();
    const record = { pid: child.pid, relayId: relay.relayId, channel: relay.channel, baseUrl: relay.baseUrl ?? ctx.baseUrl, logPath, startedAt: new Date().toISOString() };
    mkdirSync(dirname(relayPidPath(ctx.env)), { recursive: true });
    writeFileSync(relayPidPath(ctx.env), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    if (ctx.json) writeJson(ctx.io.stdout, record);
    else {
      writeLine(ctx.io.stdout, `✓ Relay bridge started in background (pid ${child.pid}, ${relay.channel} ${relay.relayId}).`);
      writeLine(ctx.io.stdout, `  Logs: ${logPath} — follow with \`openwop relay logs -f\`, stop with \`openwop relay stop\`.`);
    }
    return 0;
  }
  const deviceHeaders = { [DEVICE_TOKEN_HEADER]: relay.deviceToken };
  const deliver = ctx.relayDeliver ?? makeChannelDeliver(relay.channel, ctx);

  async function cycle() {
    await requestJson(ctx, `${MESSAGING_BASE}/device/heartbeat`, {
      method: 'POST', auth: false, headers: deviceHeaders, body: { status: 'connected' },
    });
    const out = await requestJson(ctx, `${MESSAGING_BASE}/device/outbound`, { auth: false, headers: deviceHeaders });
    const messages = Array.isArray(out.body?.messages) ? out.body.messages : [];
    const delivered: string[] = [];
    for (const egress of messages) {
      try { await deliver(egress); delivered.push(egress.egressId); }
      catch (err) { writeLine(ctx.io.stderr, `delivery failed for ${egress.egressId}: ${errText(err)}`); }
    }
    if (delivered.length > 0) {
      await requestJson(ctx, `${MESSAGING_BASE}/device/ack`, {
        method: 'POST', auth: false, headers: deviceHeaders, body: { egressIds: delivered },
      });
    }
    return delivered.length;
  }

  if (options.once) {
    const n = await cycle();
    if (ctx.json) writeJson(ctx.io.stdout, { delivered: n });
    else writeLine(ctx.io.stdout, `Bridge cycle complete — delivered ${n} message(s).`);
    return 0;
  }

  // Inbound (B4): stream platform messages → POST /device/inbound.
  const stopReceive = options.noReceive ? undefined : await startInboundReceive(ctx, relay, deviceHeaders);

  const intervalMs = Math.max(1000, (Number(options.interval) || 5) * 1000);
  writeLine(ctx.io.stdout, `Relay bridge running for ${relay.relayId} (${relay.channel}). Poll every ${intervalMs / 1000}s. Ctrl+C to stop.`);
  process.once('SIGINT', () => { try { stopReceive?.(); } catch { /* ignore */ } process.exit(0); });
  for (;;) {
    try { await cycle(); }
    catch (err) { writeLine(ctx.io.stderr, `bridge cycle error: ${errText(err)}`); }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function runRelayStop(ctx: Ctx, argv) {
  const { options } = parseOptions(argv, { bool: ['--help'] });
  if (options.help) { write(ctx.io.stdout, RELAY_HELP); return 0; }
  const record = readRelayRecord(ctx.env);
  if (!record || !record.pid) {
    writeLine(ctx.io.stdout, 'No relay daemon recorded.');
    return ctx.json ? (writeJson(ctx.io.stdout, { stopped: false }), 0) : 0;
  }
  let stopped = false;
  if (processAlive(record.pid)) {
    try { process.kill(record.pid); stopped = true; } catch { /* already gone */ }
  }
  try { if (existsSync(relayPidPath(ctx.env))) rmSync(relayPidPath(ctx.env)); } catch { /* best-effort */ }
  if (ctx.json) writeJson(ctx.io.stdout, { stopped, pid: record.pid });
  else writeLine(ctx.io.stdout, stopped ? `✓ Stopped relay daemon (pid ${record.pid}).` : `Cleared stale relay record (pid ${record.pid} was not running).`);
  return 0;
}

async function runRelayLogs(ctx: Ctx, argv) {
  const { options } = parseOptions(argv, { bool: ['--help', '--follow', '-f'] });
  if (options.help) { write(ctx.io.stdout, RELAY_HELP); return 0; }
  const logPath = readRelayRecord(ctx.env)?.logPath ?? relayLogPath(ctx.env);
  if (!existsSync(logPath)) {
    writeLine(ctx.io.stdout, `No relay logs at ${logPath}. Start the daemon with \`openwop relay start --daemon\`.`);
    return 0;
  }
  if (options.follow || options.f) {
    // Defer to `tail -f` for follow mode (best-effort; falls back to a dump).
    const r = spawnSync('tail', ['-f', logPath], { stdio: 'inherit' });
    if (r.status === 0 || r.signal) return 0;
  }
  write(ctx.io.stdout, readFileSync(logPath, 'utf8'));
  return 0;
}

/**
 * Detect whether a messaging channel can run on this host. Pure-ish (only
 * probes the environment) so doctor + relay can report readiness and fail
 * closed rather than pretend a channel works. Phase 3 channel plugins reuse
 * this before attempting platform I/O.
 */
export function detectChannelAvailability(channel, env = process.env) {
  switch (channel) {
    case 'signal': {
      const probe = spawnSync('signal-cli', ['--version'], { encoding: 'utf8' });
      if (probe.status === 0) {
        return { channel, available: true, detail: (probe.stdout || '').trim() || 'signal-cli present' };
      }
      return { channel, available: false, detail: 'signal-cli not found on PATH — install signal-cli (https://github.com/AsamK/signal-cli)' };
    }
    case 'imessage': {
      if ((env.OPENWOP_FORCE_PLATFORM ?? process.platform) === 'darwin') {
        return { channel, available: true, detail: 'macOS detected — requires Messages signed in + Full Disk Access for chat.db' };
      }
      return { channel, available: false, detail: 'iMessage requires macOS (Messages.app + chat.db); not available on this platform' };
    }
    case 'whatsapp': {
      // Baileys is a heavy native-ish dep, not bundled in the stdlib CLI; the
      // WhatsApp plugin ships with the channel build (TS migration phase).
      return { channel, available: false, detail: 'WhatsApp requires the @openwop/cli channel build (@whiskeysockets/baileys); not bundled in the core CLI' };
    }
    default:
      return { channel, available: false, detail: `unknown channel: ${channel}` };
  }
}

/**
 * Build the outbound-delivery function for a channel. When the channel's
 * platform tooling is present, deliver natively (signal-cli / AppleScript);
 * otherwise fall back to console delivery so the bridge stays observable and
 * never silently drops a message. Tests inject ctx.relayDeliver to bypass this.
 */
function makeChannelDeliver(channel, ctx) {
  const avail = detectChannelAvailability(channel, ctx.env);
  if (!avail.available) {
    let warned = false;
    return (egress) => {
      if (!warned) { writeLine(ctx.io.stderr, `channel ${channel} unavailable (${avail.detail}); printing instead.`); warned = true; }
      writeLine(ctx.io.stdout, `→ [${channel}] ${egress.conversationId}: ${egress.text}`);
    };
  }
  if (channel === 'signal') {
    // signal-cli send -m <text> <recipient>. conversationId is the recipient
    // (phone number or group id) the inbound message arrived on.
    return (egress) => {
      const r = spawnSync('signal-cli', ['send', '-m', egress.text, egress.conversationId], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`signal-cli send failed: ${(r.stderr || '').trim() || r.status}`);
    };
  }
  if (channel === 'imessage') {
    // AppleScript send via Messages.app (basic text; iMessage service).
    return (egress) => {
      const script = `tell application "Messages" to send ${JSON.stringify(egress.text)} to buddy ${JSON.stringify(egress.conversationId)} of (service 1 whose service type is iMessage)`;
      const r = spawnSync('osascript', ['-e', script], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`osascript send failed: ${(r.stderr || '').trim() || r.status}`);
    };
  }
  // Should be unreachable (whatsapp reports unavailable above).
  return (egress) => writeLine(ctx.io.stdout, `→ [${channel}] ${egress.conversationId}: ${egress.text}`);
}


// ─────────────────────────────────────────────────────────────────────────────
// Config file + path utilities
// ─────────────────────────────────────────────────────────────────────────────


function buildInputs(options) {
  const fromJson = options.inputsJson ? JSON.parse(options.inputsJson) : {};
  if (fromJson === null || typeof fromJson !== 'object' || Array.isArray(fromJson)) {
    throw new CliError('--inputs-json must be a JSON object');
  }
  const inputs = { ...fromJson };
  for (const pair of options.input ?? []) {
    const eq = pair.indexOf('=');
    if (eq <= 0) throw new CliError(`--input must be key=value, got: ${pair}`);
    inputs[pair.slice(0, eq)] = parseInputValue(pair.slice(eq + 1));
  }
  return inputs;
}

function parseInputValue(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function waitForRun(ctx: Ctx, runId, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await requestJson(ctx, `/v1/runs/${encodeURIComponent(runId)}`);
    if (TERMINAL_STATUSES.has(res.body.status)) return res.body;
    await sleep(250);
  }
  throw new CliError(`Timed out waiting for run ${runId} after ${timeoutMs}ms`, 1);
}

function parseNodeVersion(version) {
  const [major, minor, patch] = version.split('.').map((v) => Number(v));
  return { major: major || 0, minor: minor || 0, patch: patch || 0 };
}

function defaultApiKeyFor(baseUrl) {
  try {
    const host = new URL(baseUrl).hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return DEFAULT_API_KEY;
  } catch {
    return undefined;
  }
  return undefined;
}

function normalizeBaseUrl(value) {
  if (!value) return DEFAULT_BASE_URL;
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}


function ok(name, message) {
  return { status: 'ok', name, message };
}

function warn(name, message) {
  return { status: 'warn', name, message };
}

function fail(name, message) {
  return { status: 'fail', name, message };
}

function formatCheckTable(checks) {
  return formatTable(
    checks.map((c) => ({ status: c.status.toUpperCase(), check: c.name, message: c.message })),
    ['status', 'check', 'message'],
  );
}

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

const CATALOG_HELP = `Usage:
  openwop catalog nodes [--search text] [--limit n] [--json]
  openwop catalog packs [--json]
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

const WORKFLOWS_HELP = `Usage:
  openwop workflows list [--json]
  openwop workflows get <workflowId> [--json]
  openwop workflows register <workflow.json> [--json]
  openwop workflows delete <workflowId> [--json]
`;

const RUNS_HELP = `Usage:
  openwop runs list [--status status] [--limit n] [--tenant-id id] [--json]
  openwop runs create <workflowId> [--input k=v] [--inputs-json JSON] [--tenant-id id] [--wait] [--json]
  openwop runs get <runId> [--json]
  openwop runs cancel <runId> [--reason text] [--json]
  openwop runs ancestry <runId> [--json]

The \`runs ancestry\` command walks the RFC 0040 cross-host parent chain from the
requested run up to its top-level root (each run has one parent, so the ancestry
is linear). The endpoint is opt-in: the host must advertise
\`crossHostCausation.ancestryEndpointSupported\` or the command reports it as
unavailable.

Input parsing for \`runs create\`:
  --input k=v       Each value is JSON.parse'd first; on parse failure it falls back to a string.
                    So \`--input n=5\` yields the number 5, \`--input enabled=true\` yields the
                    boolean true, \`--input text=hello\` yields the string "hello", and
                    \`--input list=[1,2,3]\` yields an array. Quote shell-special characters.
  --inputs-json J   Pass the whole \`inputs\` object as one JSON literal. Merged BEFORE
                    --input k=v pairs (which override).
  --wait            Poll GET /v1/runs/{runId} every 250ms until terminal status or
                    --timeout-ms (default 30000) elapses. Exit 0 only on \`completed\`.
`;

const CHAT_HELP = `Usage: openwop chat <workflowId> [options]

Interactive streaming chat REPL. Each message you type creates a run for
<workflowId> carrying the running conversation as a \`messages\` array, then
streams that run's events to the terminal as they arrive. Type /exit (or
/quit, or press Ctrl-D) to leave.

Streaming:
  Prefers Server-Sent Events (GET /v1/runs/{runId}/events). If the host does
  not stream, it falls back to polling GET /v1/runs/{runId}/events/poll.

Options:
  --input k=v        Extra input carried on every turn (JSON-parsed like runs create).
  --inputs-json J    Seed the whole \`inputs\` object (e.g. credentialRef, model, prior messages).
  --role <role>      Role to tag your turns with (default: user).
  --tenant-id <id>   Tenant id for each run.
  --scope-id <id>    Scope id for each run.
  --timeout-ms <ms>  Per-turn stream timeout (default: 120000).
  --no-stream        Skip SSE and poll for events instead.
  --no-history       Send only the latest turn instead of the full conversation.
  --json             Emit raw event records (one JSON object per event) instead of pretty text.

Examples:
  openwop chat sample.chat.turn
  openwop chat sample.chat.turn --inputs-json '{"credentialRef":"anthropic-default"}'
  openwop chat sample.chat.turn --no-stream --json
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

const AGENTS_HELP = `Usage:
  openwop agents list [--json]
  openwop agents info <agentId> [--json]
  openwop agents run <agentId> [--task-json '{...}'] [--tool <id>]... [--threshold <n>] [--no-validate] [--json]

Manifest agents (RFC 0070). The host loads pack agents[] (RFC 0003) into an
AgentRegistry and advertises capabilities.agents.manifestRuntime. 'list'/'info'
render that registry-backed inventory; 'run' dispatches one agent turn via
POST /v1/host/sample/agents/{agentId}/dispatch — the tool surface is filtered to
the agent's toolAllowlist (RFC 0002 §A14), task/return payloads are validated
against the agent's handoff schemas (RFC 0003 §D, unless --no-validate), and a
sub-threshold decision escalates rather than proceeding (RFC 0002 §F).

  --task-json J   Inbound task payload (validated against handoff.taskSchemaRef).
  --tool <id>     A tool the host offers this turn (repeatable); kept only if allowlisted.
  --threshold <n> Per-run confidence threshold override (default: the agent's).
  --no-validate   Dispatch with opaque payloads (skip handoff schema validation).

'run' exits 0 (completed), 3 (escalated), or 1 (failed) so scripts can branch.

Examples:
  openwop agents list
  openwop agents info core.openwop.agents.supervisor.default --json
  openwop agents run core.openwop.agents.code-reviewer.default --task-json '{"diff":"..."}' --tool openwop:fs.read
`;

const CONFIG_HELP = `Usage:
  openwop config file
  openwop config get [key]
  openwop config set <key> <value>
  openwop config unset <key>

Reads and writes ~/.openwop/config.json (or OPENWOP_CONFIG_HOME/.openwop/ when set).
Dotted keys traverse nested objects (e.g., \`openwop config get host.baseUrl\`).
`;

const MESSAGING_HELP = `Usage:
  openwop messaging connectors list|get|add|enable|disable|test [...]
  openwop messaging sessions   list|inspect|close [...]
  openwop messaging policy     get|set <connectorId> [...]
  openwop messaging routing    list|add|remove [...]
  openwop messaging identity   list|show|create|link|unlink|delete [...]
  openwop messaging logs       [--channel c] [--direction inbound|outbound] [--status s] [--limit n]

Operate the demo host's messaging relay-gateway (/v1/host/sample/messaging) —
a host-extension surface, NOT part of the normative OpenWOP wire contract.

  connectors add --channel <signal|whatsapp|imessage> [--display-name n]
  connectors enable|disable|test <connectorId>
  sessions inspect|close <sessionKey>
  policy set <connectorId> --dm <pairing|allowlist|open|disabled>
                           --group <allowlist|open|disabled>
                           --require-mention <true|false>
  routing add --pattern "*" --workflow <id> [--channel c] [--priority n]
  routing remove <ruleId>
  identity create --name N --peer <channel>:<peerId> [--peer ...]
  identity link <identityId> --peer <channel>:<peerId>
  identity unlink <identityId> --peer <channel>:<peerId>

Register a local channel relay with \`openwop relay setup\`. Send a one-off
email/SMS with \`openwop notify <email|sms>\`.
`;

const NOTIFY_HELP = `Usage:
  openwop notify email --to <addr> --text <msg> [--subject s]
  openwop notify sms   --to <number> --text <msg>

Dispatch a one-off notification through the demo host
(/v1/host/sample/messaging/notify). The reference app returns a synthetic
receipt; wiring a real provider (SES / Twilio) is a host concern.
`;

const RELAY_HELP = `Usage:
  openwop relay setup --channel <signal|whatsapp|imessage> [--name n]
  openwop relay register --channel <ch> [--name n]
  openwop relay activate --relay-id <id> --code <activationCode>
  openwop relay status
  openwop relay send --conversation <id> --text <msg> [--relay-id <id>]
  openwop relay start [--daemon] [--once] [--interval <seconds>]
  openwop relay stop
  openwop relay logs [-f]
  openwop relay revoke [--relay-id <id>]

The relay device owns the platform connection (signal-cli / WhatsApp / iMessage)
and bridges it to the OpenWOP host. \`setup\` registers + activates a device and
stores its token in ~/.openwop/config.json under \`relay\`.

  start   Runs the bridge loop: heartbeat + poll outbound + deliver + ack, AND
          streams inbound platform messages → the host (--no-receive disables
          inbound; --once runs one outbound cycle, no receive). --daemon
          backgrounds it (pid + logs under ~/.openwop/). Inbound + delivery use
          the channel plugin (signal-cli / chat.db / Baileys) when its tooling
          is present, else inbound is skipped and delivery prints to console.
  stop    Stops the background relay daemon and clears its pid record.
  logs    Print (or -f follow) the background relay daemon log.
  send    Operator-side: queue an outbound message for the relay to deliver.
  status  Probes the host with a heartbeat to confirm the token is live.
`;

