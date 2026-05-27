import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync, createReadStream, existsSync, mkdirSync, openSync,
  readFileSync, readdirSync, rmSync, statSync, watch, writeFileSync,
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve as resolvePath } from 'node:path';
import { createInterface } from 'node:readline';
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign as ed25519Sign, verify as ed25519Verify } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

export const VERSION = '0.1.0';
export const DEFAULT_BASE_URL = 'http://localhost:8080';
// Canonical signed node-pack registry. Distinct from the host --base-url
// (the workflow-engine demo): the demo only knows its in-process nodes and
// returns 404 for tarballs, whereas the file-backed registry at this URL
// serves the full catalog + signed .tgz + .sig + public keys. Overridable
// per `packs` command via --registry-url or OPENWOP_REGISTRY_URL.
export const DEFAULT_REGISTRY_URL = 'https://packs.openwop.dev';
const DEFAULT_API_KEY = 'sample-token';
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

// Provider catalog — mirrors the four backend dispatchers in
// `apps/workflow-engine/backend/typescript/src/providers/dispatch.ts`.
// Adding a provider here requires backend support; this is not a free-form
// list. `envVar` is the conventional env var the wizard auto-detects.
export const PROVIDER_CATALOG = {
  anthropic: {
    label: 'Anthropic (Claude)',
    envVar: 'ANTHROPIC_API_KEY',
    models: [
      { id: 'claude-opus-4-7', label: 'claude-opus-4-7 (most capable)' },
      { id: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6 (balanced)', recommended: true },
      { id: 'claude-haiku-4-5', label: 'claude-haiku-4-5 (fastest)' },
    ],
  },
  openai: {
    label: 'OpenAI',
    envVar: 'OPENAI_API_KEY',
    models: [
      { id: 'gpt-4o', label: 'gpt-4o (most capable)', recommended: true },
      { id: 'gpt-4-turbo', label: 'gpt-4-turbo' },
      { id: 'gpt-4o-mini', label: 'gpt-4o-mini (fastest)' },
    ],
  },
  google: {
    label: 'Google (Gemini)',
    envVar: 'GOOGLE_API_KEY',
    models: [
      { id: 'gemini-2.0-flash', label: 'gemini-2.0-flash (balanced)', recommended: true },
      { id: 'gemini-1.5-pro', label: 'gemini-1.5-pro' },
    ],
  },
  minimax: {
    label: 'MiniMax',
    envVar: 'MINIMAX_API_KEY',
    models: [
      { id: 'minimax-text-01', label: 'minimax-text-01', recommended: true },
    ],
  },
};

// Host presets surfaced as the first onboarding choice. `url` is what gets
// written to the config; `label` is what the user sees. The "custom" option
// is appended at prompt time.
export const HOST_PRESETS = [
  { key: 'shared', label: 'Shared demo at https://app.openwop.dev/api (recommended for trying things out)', url: 'https://app.openwop.dev/api' },
  { key: 'local', label: 'Local demo at http://localhost:8080 (run `openwop demo start` to launch)', url: 'http://localhost:8080' },
];

class CliError extends Error {
  constructor(message, code = 2) {
    super(message);
    this.name = 'CliError';
    this.code = code;
  }
}

class HttpError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }
}

export async function runCli(argv, options = {}) {
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
      default:
        throw new CliError(`Unknown command: ${command}\nRun \`openwop --help\` for usage.`);
    }
  } catch (err) {
    if (err instanceof CliError) {
      writeLine(io.stderr, `openwop: ${err.message}`);
      return err.code;
    }
    if (err instanceof HttpError) {
      const bodyMessage = err.body && typeof err.body === 'object' && typeof err.body.message === 'string'
        ? `: ${err.body.message}`
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

export function extractGlobalOptions(argv, env = process.env) {
  const globals = {
    baseUrl: undefined,
    apiKey: undefined,
    json: false,
    quiet: false,
    verbose: false,
    help: false,
    version: false,
  };
  const args = [];
  let seenCommand = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    const { flag, value } = splitFlag(arg);

    if (flag === '--base-url') {
      globals.baseUrl = value ?? takeValue(argv, ++i, '--base-url');
      continue;
    }
    if (flag === '--api-key') {
      globals.apiKey = value ?? takeValue(argv, ++i, '--api-key');
      continue;
    }
    if (arg === '--json') {
      globals.json = true;
      continue;
    }
    if (arg === '--quiet') {
      globals.quiet = true;
      continue;
    }
    if (arg === '--verbose') {
      globals.verbose = true;
      continue;
    }
    if ((arg === '--help' || arg === '-h') && !seenCommand) {
      globals.help = true;
      continue;
    }
    if (arg === '--version' && !seenCommand) {
      globals.version = true;
      continue;
    }

    args.push(arg);
    if (!arg.startsWith('-')) seenCommand = true;
  }

  return { globals, args };
}

function parseOptions(argv, spec = {}) {
  const bools = new Set(spec.bool ?? []);
  const values = new Set(spec.value ?? []);
  const multi = new Set(spec.multi ?? []);
  const options = {};
  const positionals = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (!arg.startsWith('-') || arg === '-') {
      positionals.push(arg);
      continue;
    }
    const { flag, value } = splitFlag(arg);
    if (bools.has(flag)) {
      options[toOptionName(flag)] = true;
      continue;
    }
    if (values.has(flag) || multi.has(flag)) {
      const resolved = value ?? takeValue(argv, ++i, flag);
      const name = toOptionName(flag);
      if (multi.has(flag)) {
        options[name] = [...(options[name] ?? []), resolved];
      } else {
        options[name] = resolved;
      }
      continue;
    }
    if (flag === '--help' || flag === '-h') {
      options.help = true;
      continue;
    }
    throw new CliError(`Unknown option: ${flag}`);
  }

  return { options, positionals };
}

function splitFlag(arg) {
  const eq = arg.indexOf('=');
  if (eq === -1) return { flag: arg, value: undefined };
  return { flag: arg.slice(0, eq), value: arg.slice(eq + 1) };
}

function takeValue(argv, index, flag) {
  const value = argv[index];
  if (value === undefined || value.startsWith('-')) {
    throw new CliError(`${flag} requires a value`);
  }
  return value;
}

function toOptionName(flag) {
  return flag.replace(/^--?/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
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
  };
  write(io.stdout, map[command] ?? ROOT_HELP);
  return 0;
}

async function runDoctor(ctx, argv) {
  const { options } = parseOptions(argv, { bool: ['--help'] });
  if (options.help) {
    write(ctx.io.stdout, DOCTOR_HELP);
    return 0;
  }

  const checks = [];
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

  if (ctx.json) {
    writeJson(ctx.io.stdout, { checks });
  } else {
    writeLine(ctx.io.stdout, 'OpenWOP doctor');
    writeLine(ctx.io.stdout, formatCheckTable(checks));
  }
  return checks.some((c) => c.status === 'fail') ? 1 : 0;
}

async function runDemo(ctx, argv) {
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

async function runDemoStatus(ctx, argv) {
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

async function runDemoUrls(ctx, argv) {
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

async function runDemoStart(ctx, argv) {
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

  const commands = [];
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

  const exitCode = await new Promise((resolve) => {
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

async function runDemoStop(ctx, argv) {
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
    if (err && err.code === 'EPERM') {
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

async function runDemoRestart(ctx, argv) {
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

async function runDemoLogs(ctx, argv) {
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
      stream.on('data', (chunk) => write(ctx.io.stdout, chunk));
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

async function runDemoInstall(ctx, argv) {
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

async function runHealth(ctx, argv) {
  const { options } = parseOptions(argv, { bool: ['--help'] });
  if (options.help) {
    write(ctx.io.stdout, HEALTH_HELP);
    return 0;
  }
  const health = await requestJson(ctx, '/health', { auth: false });
  const readiness = await requestJson(ctx, '/readiness', { auth: false });
  const payload = { health: health.body, readiness: readiness.body };
  if (ctx.json) writeJson(ctx.io.stdout, payload);
  else {
    writeLine(ctx.io.stdout, `health: ${health.body.status ?? 'unknown'}`);
    writeLine(ctx.io.stdout, `readiness: ${readiness.body.status ?? 'unknown'}`);
  }
  return 0;
}

async function runCapabilities(ctx, argv) {
  const { options } = parseOptions(argv, { bool: ['--help'] });
  if (options.help) {
    write(ctx.io.stdout, CAPABILITIES_HELP);
    return 0;
  }
  const res = await requestJson(ctx, '/.well-known/openwop', { auth: false });
  if (ctx.json) {
    writeJson(ctx.io.stdout, res.body);
    return 0;
  }
  write(ctx.io.stdout, summarizeCapabilities(res.body));
  return 0;
}

export function summarizeCapabilities(caps) {
  const capabilities = caps.capabilities && typeof caps.capabilities === 'object' ? Object.keys(caps.capabilities) : [];
  const impl = caps.implementation ?? {};
  const lines = [
    `Implementation: ${impl.name ?? 'unknown'} ${impl.version ?? ''}`.trim(),
    `Protocol: ${caps.protocolVersion ?? 'unknown'}`,
    `Transports: ${(caps.supportedTransports ?? []).join(', ') || 'unknown'}`,
    `Stream modes: ${caps.stream?.modes?.join(', ') ?? 'unknown'}`,
    `Fixtures: ${Array.isArray(caps.fixtures) ? caps.fixtures.length : 0}`,
    `Capability blocks: ${capabilities.join(', ') || 'none'}`,
    '',
  ];
  return lines.join('\n');
}

async function runCatalog(ctx, argv) {
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

async function runCatalogNodes(ctx, argv) {
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

async function runCatalogPacks(ctx, argv = []) {
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

async function runPacks(ctx, argv) {
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
async function registryJson(ctx, registryUrl, path) {
  const url = new URL(path, registryUrl + '/');
  const res = await ctx.fetchImpl(url, { method: 'GET', headers: { accept: 'application/json' } });
  const text = await res.text();
  const body = text.length > 0 ? parseJsonResponse(text) : null;
  if (!res.ok) throw new HttpError(`HTTP ${res.status}`, res.status, body);
  return body;
}

/** GET raw bytes (tarball / signature / public key) from the registry. */
async function registryBytes(ctx, registryUrl, path) {
  const url = new URL(path, registryUrl + '/');
  const res = await ctx.fetchImpl(url, { method: 'GET', headers: { accept: 'application/octet-stream' } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new HttpError(`HTTP ${res.status}`, res.status, text ? parseJsonResponse(text) : null);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function runPacksSearch(ctx, argv) {
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

async function runPacksInfo(ctx, argv) {
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

async function runPacksInstall(ctx, argv) {
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

async function runPacksPublish(ctx, argv) {
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
  let ephemeralPublicB64 = null;
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

async function runPacksYank(ctx, argv) {
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
  const entries = [];
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
  const chunks = [];
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

async function runWorkflows(ctx, argv) {
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

async function runWorkflowsList(ctx, argv) {
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

async function runWorkflowsGet(ctx, argv) {
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

async function runWorkflowsRegister(ctx, argv) {
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

async function runWorkflowsDelete(ctx, argv) {
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

async function runRuns(ctx, argv) {
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

async function runRunsList(ctx, argv) {
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

async function runRunsCreate(ctx, argv) {
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

async function runRunsGet(ctx, argv) {
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

async function runRunsCancel(ctx, argv) {
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

const CHAT_TERMINAL_EVENT_TYPES = new Set(['run.completed', 'run.failed', 'run.cancelled']);

async function runChat(ctx, argv) {
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

    const assistantParts = [];
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
export async function submitTurn(ctx, { workflowId, inputs, tenantId, scopeId }) {
  const body = {
    workflowId,
    ...(tenantId ? { tenantId } : {}),
    ...(scopeId ? { scopeId } : {}),
    inputs: inputs ?? {},
  };
  const res = await requestJson(ctx, '/v1/runs', { method: 'POST', body });
  if (!res.body || typeof res.body.runId !== 'string') {
    throw new CliError('Run create response did not include a runId');
  }
  return res.body.runId;
}

/**
 * Stream a run's events. Prefers SSE; on any SSE failure (non-streamable
 * body, non-2xx, or transport error) falls back to the JSON poll endpoint.
 * Calls `onEvent(eventRecord)` once per event in sequence order and resolves
 * when a terminal event is seen or the poll endpoint reports completion.
 */
export async function streamRunEvents(ctx, runId, { onEvent, useStream = true, timeoutMs = 120000 } = {}) {
  if (useStream) {
    try {
      const handled = await streamViaSse(ctx, runId, onEvent);
      if (handled) return;
    } catch {
      // Fall through to polling.
    }
  }
  await streamViaPoll(ctx, runId, onEvent, timeoutMs);
}

async function streamViaSse(ctx, runId, onEvent) {
  const url = new URL(`/v1/runs/${encodeURIComponent(runId)}/events`, ctx.baseUrl);
  const headers = { accept: 'text/event-stream' };
  if (ctx.apiKey) headers.authorization = `Bearer ${ctx.apiKey}`;
  const res = await ctx.fetchImpl(url, { method: 'GET', headers });
  if (!res.ok) throw new HttpError(`HTTP ${res.status}`, res.status, null);
  const ct = res.headers?.get?.('content-type') ?? '';
  if (!ct.includes('text/event-stream') || !res.body || typeof res.body.getReader !== 'function') {
    // Server answered with JSON (or a non-streamable body) — let the
    // caller fall back to polling rather than mis-parsing.
    return false;
  }
  await consumeSse(res.body, (frame) => {
    if (frame.data === undefined) return;
    const ev = safeParseJson(frame.data);
    if (frame.event === 'batch' && Array.isArray(ev)) {
      for (const one of ev) onEvent(one);
    } else if (ev && typeof ev === 'object') {
      onEvent(ev);
    }
  });
  return true;
}

/**
 * Decode a web ReadableStream of SSE bytes into frames. Exported for tests so
 * the line-buffering / multi-line `data:` accumulation can be exercised
 * without a live socket. `onFrame` receives `{ event, data, id }`.
 */
export async function consumeSse(stream, onFrame) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const flushFrame = (block) => {
    if (!block.trim()) return;
    const frame = {};
    const dataLines = [];
    for (const rawLine of block.split('\n')) {
      const line = rawLine.replace(/\r$/, '');
      if (line === '' || line.startsWith(':')) continue; // blank or comment/heartbeat
      const idx = line.indexOf(':');
      const field = idx === -1 ? line : line.slice(0, idx);
      const value = idx === -1 ? '' : line.slice(idx + 1).replace(/^ /, '');
      if (field === 'data') dataLines.push(value);
      else if (field === 'event') frame.event = value;
      else if (field === 'id') frame.id = value;
    }
    if (dataLines.length > 0) frame.data = dataLines.join('\n');
    if (frame.data !== undefined || frame.event !== undefined) onFrame(frame);
  };
  while (true) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      flushFrame(buffer.slice(0, sep));
      buffer = buffer.slice(sep + 2);
    }
    if (done) {
      flushFrame(buffer);
      break;
    }
  }
}

async function streamViaPoll(ctx, runId, onEvent, timeoutMs) {
  const started = Date.now();
  let lastSequence = -1;
  while (Date.now() - started < timeoutMs) {
    const query = lastSequence >= 0 ? `?lastSequence=${lastSequence}` : '';
    const res = await requestJson(ctx, `/v1/runs/${encodeURIComponent(runId)}/events/poll${query}`);
    const events = Array.isArray(res.body?.events) ? res.body.events : [];
    for (const ev of events) {
      onEvent(ev);
      if (typeof ev.sequence === 'number' && ev.sequence > lastSequence) lastSequence = ev.sequence;
    }
    const sawTerminal = events.some((ev) => CHAT_TERMINAL_EVENT_TYPES.has(ev.type));
    if (res.body?.isComplete === true || sawTerminal) return;
    await sleep(250);
  }
  throw new CliError(`Timed out streaming run ${runId} after ${timeoutMs}ms`, 1);
}

/**
 * Pretty-print one event record for the REPL. Returns null for events that
 * carry no useful surface (so the loop can skip them). Exported for tests.
 */
export function renderEvent(ev) {
  if (!ev || typeof ev !== 'object') return null;
  const type = String(ev.type ?? 'event');
  const node = ev.nodeId ? ` ${ev.nodeId}` : '';
  switch (type) {
    case 'run.started':
      return '· run started';
    case 'node.started':
      return `·${node} running`;
    case 'node.completed': {
      const reply = extractAssistantText(ev);
      return reply ? `assistant> ${reply}` : `·${node} done`;
    }
    case 'run.completed': {
      const reply = extractAssistantText(ev);
      return reply ? `assistant> ${reply}` : '· run completed';
    }
    case 'node.failed':
    case 'run.failed': {
      const msg = errorMessageOf(ev);
      return `! ${type}${node}${msg ? `: ${msg}` : ''}`;
    }
    case 'run.cancelled':
      return '· run cancelled';
    default:
      return `· ${type}`;
  }
}

/**
 * Pull assistant-visible text out of an event payload. Handles the common
 * shapes the sample chat node emits: a `messages` array, an `output`/`result`
 * string, or a nested `content` field. Exported for tests.
 */
export function extractAssistantText(ev) {
  const payload = ev && typeof ev === 'object' ? ev.payload : undefined;
  if (!payload || typeof payload !== 'object') return null;
  const candidates = [payload.output, payload.result, payload.text, payload.content, payload.message];
  for (const c of candidates) {
    const t = coerceText(c);
    if (t) return t;
  }
  // `outputs` keyed by port name (node.completed shape).
  if (payload.outputs && typeof payload.outputs === 'object') {
    for (const v of Object.values(payload.outputs)) {
      const t = coerceText(v);
      if (t) return t;
    }
  }
  // A chat `messages` array — return the last assistant turn.
  if (Array.isArray(payload.messages)) {
    for (let i = payload.messages.length - 1; i >= 0; i--) {
      const m = payload.messages[i];
      if (m && m.role === 'assistant') {
        const t = coerceText(m.content);
        if (t) return t;
      }
    }
  }
  return null;
}

function coerceText(value) {
  if (typeof value === 'string') return value.length > 0 ? value : null;
  if (value && typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (typeof value.content === 'string') return value.content;
    // Anthropic-style content blocks: [{type:'text', text:'...'}]
    if (Array.isArray(value)) {
      const joined = value.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('');
      return joined.length > 0 ? joined : null;
    }
  }
  return null;
}

function errorMessageOf(ev) {
  const payload = ev && typeof ev === 'object' ? ev.payload : undefined;
  if (payload && typeof payload === 'object') {
    if (payload.error && typeof payload.error === 'object' && typeof payload.error.message === 'string') {
      return payload.error.message;
    }
    if (typeof payload.message === 'string') return payload.message;
  }
  return '';
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Default stdin line reader for the REPL. Resolves with each line, or null on
 * EOF (Ctrl-D). Uses readline so piped input and TTY input both work; the
 * prompt is written to stdout first.
 */
function defaultReadTurn(ctx) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
  let closed = false;
  rl.on('close', () => { closed = true; });
  return (prompt) => new Promise((resolve) => {
    if (closed) { resolve(null); return; }
    if (!ctx.json) ctx.io.stdout.write(prompt);
    const onLine = (line) => { rl.removeListener('close', onClose); resolve(line); };
    const onClose = () => { rl.removeListener('line', onLine); resolve(null); };
    rl.once('line', onLine);
    rl.once('close', onClose);
  });
}

async function runRunsAncestry(ctx, argv) {
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
  const chain = [];
  let current = encodeURIComponent(positionals[0]);
  const MAX_DEPTH = 64;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    let res;
    try {
      res = await requestJson(ctx, `/v1/runs/${current}/ancestry`);
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) {
        // Distinguish "endpoint not enabled" from "run not found" via the body.
        const detail = err.body && typeof err.body === 'object' && typeof err.body.message === 'string'
          ? err.body.message
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
async function runMedia(ctx, argv) {
  const sub = argv[0];
  const args = argv.slice(1);
  if (!sub || sub === '--help' || sub === '-h') {
    write(ctx.io.stdout, MEDIA_HELP);
    return sub ? 0 : 2;
  }
  switch (sub) {
    case 'generate-image':
      return runMediaGenerateImage(ctx, args);
    case 'transcribe':
      return runMediaTranscribe(ctx, args);
    case 'synthesize':
      return runMediaSynthesize(ctx, args);
    default:
      throw new CliError(`Unknown media command: ${sub}\nRun \`openwop media --help\` for usage.`);
  }
}

async function runMediaGenerateImage(ctx, argv) {
  const { options, positionals } = parseOptions(argv, {
    bool: ['--help'],
    value: ['--prompt', '--output'],
  });
  const prompt = options.prompt ?? positionals.join(' ');
  if (options.help || !prompt) {
    write(ctx.io.stdout, 'Usage: openwop media generate-image <prompt> [--output path] [--json]\n');
    return options.help ? 0 : 2;
  }
  const res = await requestJson(ctx, '/v1/host/sample/media/generate-image', {
    method: 'POST',
    body: { prompt },
  });
  if (options.output) await downloadAsset(ctx, res.body.url, options.output);
  if (ctx.json) {
    writeJson(ctx.io.stdout, res.body);
    return 0;
  }
  writeLine(ctx.io.stdout, formatTable(
    [{ field: 'contentType', value: res.body.contentType ?? '' },
     { field: 'bytes', value: String(res.body.bytes ?? '') },
     { field: 'url', value: res.body.url ?? '' },
     { field: 'stub', value: String(res.body.stub ?? false) }],
    ['field', 'value'],
  ));
  if (options.output) writeLine(ctx.io.stdout, `Wrote asset to ${options.output}`);
  return 0;
}

async function runMediaTranscribe(ctx, argv) {
  const { options, positionals } = parseOptions(argv, {
    bool: ['--help'],
    value: ['--file', '--language'],
  });
  const filePath = options.file ?? positionals[0];
  if (options.help || !filePath) {
    write(ctx.io.stdout, 'Usage: openwop media transcribe <audio-file> [--language en] [--json]\n');
    return options.help ? 0 : 2;
  }
  let audioBase64;
  try {
    audioBase64 = readFileSync(resolvePath(ctx.cwd, filePath)).toString('base64');
  } catch (err) {
    throw new CliError(`Cannot read audio file ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const res = await requestJson(ctx, '/v1/host/sample/media/transcribe', {
    method: 'POST',
    body: { audioBase64, ...(options.language ? { language: options.language } : {}) },
  });
  if (ctx.json) {
    writeJson(ctx.io.stdout, res.body);
    return 0;
  }
  writeLine(ctx.io.stdout, formatTable(
    [{ field: 'language', value: res.body.language ?? '' },
     { field: 'bytes', value: String(res.body.bytes ?? '') },
     { field: 'stub', value: String(res.body.stub ?? false) }],
    ['field', 'value'],
  ));
  writeLine(ctx.io.stdout, '');
  writeLine(ctx.io.stdout, res.body.text ?? '');
  return 0;
}

async function runMediaSynthesize(ctx, argv) {
  const { options, positionals } = parseOptions(argv, {
    bool: ['--help'],
    value: ['--text', '--voice', '--output'],
  });
  const text = options.text ?? positionals.join(' ');
  if (options.help || !text) {
    write(ctx.io.stdout, 'Usage: openwop media synthesize <text> [--voice name] [--output path] [--json]\n');
    return options.help ? 0 : 2;
  }
  const res = await requestJson(ctx, '/v1/host/sample/media/synthesize', {
    method: 'POST',
    body: { text, ...(options.voice ? { voice: options.voice } : {}) },
  });
  if (options.output) await downloadAsset(ctx, res.body.url, options.output);
  if (ctx.json) {
    writeJson(ctx.io.stdout, res.body);
    return 0;
  }
  writeLine(ctx.io.stdout, formatTable(
    [{ field: 'contentType', value: res.body.contentType ?? '' },
     { field: 'bytes', value: String(res.body.bytes ?? '') },
     { field: 'voice', value: res.body.voice ?? '' },
     { field: 'url', value: res.body.url ?? '' },
     { field: 'stub', value: String(res.body.stub ?? false) }],
    ['field', 'value'],
  ));
  if (options.output) writeLine(ctx.io.stdout, `Wrote asset to ${options.output}`);
  return 0;
}

/** Fetch a media-asset URL (relative to the host base URL) and write the
 *  raw bytes to `outPath`. The asset serve route is token-authed (the URL
 *  IS the credential) so no Authorization header is required. */
async function downloadAsset(ctx, assetUrl, outPath) {
  if (typeof assetUrl !== 'string' || assetUrl.length === 0) {
    throw new CliError('media response did not include an asset URL to download');
  }
  const url = new URL(assetUrl, ctx.baseUrl);
  const res = await ctx.fetchImpl(url, { method: 'GET', headers: { accept: 'application/octet-stream' } });
  if (!res.ok) throw new HttpError(`HTTP ${res.status}`, res.status, null);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(resolvePath(ctx.cwd, outPath), buf);
}

async function runConformance(ctx, argv) {
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

async function runMemory(ctx, argv) {
  const sub = argv[0] ?? 'list';
  const args = argv.slice(['list', 'search', 'get', 'delete', 'rm'].includes(sub) ? 1 : 0);
  if (sub === '--help' || sub === '-h') {
    write(ctx.io.stdout, MEMORY_HELP);
    return 0;
  }
  switch (sub) {
    case 'list':
      return runMemoryList(ctx, args);
    case 'search':
      return runMemorySearch(ctx, args);
    case 'get':
      return runMemoryGet(ctx, args);
    case 'delete':
    case 'rm':
      return runMemoryDelete(ctx, args);
    default:
      throw new CliError(`Unknown memory command: ${sub}\nRun \`openwop memory --help\` for usage.`);
  }
}

function memoryQuery(options) {
  const query = new URLSearchParams();
  if (options.memoryRef) query.set('memoryRef', options.memoryRef);
  if (options.tag) query.set('tag', options.tag);
  if (options.limit) query.set('limit', options.limit);
  return query;
}

function memoryRows(entries) {
  return entries.map((e) => ({
    id: e.id,
    createdAt: e.createdAt ?? '',
    tags: Array.isArray(e.tags) ? e.tags.join(',') : '',
    content: truncate(String(e.content ?? ''), 60),
  }));
}

function truncate(text, max) {
  const oneLine = text.replace(/\s+/g, ' ');
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

async function runMemoryList(ctx, argv) {
  const { options } = parseOptions(argv, {
    bool: ['--help'],
    value: ['--memory-ref', '--tag', '--limit'],
  });
  if (options.help) {
    write(ctx.io.stdout, MEMORY_HELP);
    return 0;
  }
  const query = memoryQuery(options);
  const path = `/v1/host/sample/memory${query.size ? `?${query.toString()}` : ''}`;
  const res = await requestJson(ctx, path);
  if (ctx.json) {
    writeJson(ctx.io.stdout, res.body);
    return 0;
  }
  const entries = Array.isArray(res.body?.entries) ? res.body.entries : [];
  writeLine(ctx.io.stdout, `memoryRef: ${res.body?.memoryRef ?? '(default)'}`);
  writeLine(ctx.io.stdout, entries.length
    ? formatTable(memoryRows(entries), ['id', 'createdAt', 'tags', 'content'])
    : 'No memory entries.');
  return 0;
}

async function runMemorySearch(ctx, argv) {
  const { options, positionals } = parseOptions(argv, {
    bool: ['--help'],
    value: ['--memory-ref', '--tag', '--limit', '--query'],
  });
  if (options.help) {
    write(ctx.io.stdout, MEMORY_HELP);
    return 0;
  }
  const term = String(options.query ?? positionals[0] ?? '').toLowerCase();
  if (!term && !options.tag) {
    write(ctx.io.stdout, 'Usage: openwop memory search <text> [--tag t] [--memory-ref ref] [--limit n] [--json]\n');
    return 2;
  }
  // The host route filters by tag server-side; free-text search is client-side
  // over the tenant-scoped result set (the route returns no full-text index).
  const query = memoryQuery(options);
  const path = `/v1/host/sample/memory${query.size ? `?${query.toString()}` : ''}`;
  const res = await requestJson(ctx, path);
  let entries = Array.isArray(res.body?.entries) ? res.body.entries : [];
  if (term) {
    entries = entries.filter((e) =>
      String(e.content ?? '').toLowerCase().includes(term)
      || (Array.isArray(e.tags) && e.tags.some((t) => String(t).toLowerCase().includes(term))));
  }
  if (ctx.json) {
    writeJson(ctx.io.stdout, { memoryRef: res.body?.memoryRef, entries });
    return 0;
  }
  writeLine(ctx.io.stdout, `memoryRef: ${res.body?.memoryRef ?? '(default)'}`);
  writeLine(ctx.io.stdout, entries.length
    ? formatTable(memoryRows(entries), ['id', 'createdAt', 'tags', 'content'])
    : 'No matching memory entries.');
  return 0;
}

async function runMemoryGet(ctx, argv) {
  const { options, positionals } = parseOptions(argv, {
    bool: ['--help'],
    value: ['--memory-ref'],
  });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop memory get <memoryId> [--memory-ref ref] [--json]\n');
    return options.help ? 0 : 2;
  }
  const query = options.memoryRef ? `?memoryRef=${encodeURIComponent(options.memoryRef)}` : '';
  const res = await requestJson(ctx, `/v1/host/sample/memory/${encodeURIComponent(positionals[0])}${query}`);
  if (ctx.json) {
    writeJson(ctx.io.stdout, res.body);
    return 0;
  }
  const entry = res.body?.entry ?? {};
  writeLine(ctx.io.stdout, `memoryRef: ${res.body?.memoryRef ?? '(default)'}`);
  writeLine(ctx.io.stdout, `id: ${entry.id ?? positionals[0]}`);
  writeLine(ctx.io.stdout, `createdAt: ${entry.createdAt ?? ''}`);
  if (entry.expiresAt) writeLine(ctx.io.stdout, `expiresAt: ${entry.expiresAt}`);
  writeLine(ctx.io.stdout, `tags: ${Array.isArray(entry.tags) ? entry.tags.join(', ') : ''}`);
  writeLine(ctx.io.stdout, `content: ${entry.content ?? ''}`);
  return 0;
}

async function runMemoryDelete(ctx, argv) {
  const { options, positionals } = parseOptions(argv, {
    bool: ['--help'],
    value: ['--memory-ref'],
  });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop memory delete <memoryId> [--memory-ref ref] [--json]\n');
    return options.help ? 0 : 2;
  }
  const query = options.memoryRef ? `?memoryRef=${encodeURIComponent(options.memoryRef)}` : '';
  const res = await requestJson(ctx, `/v1/host/sample/memory/${encodeURIComponent(positionals[0])}${query}`, { method: 'DELETE' });
  if (ctx.json) {
    writeJson(ctx.io.stdout, res.body);
    return 0;
  }
  writeLine(ctx.io.stdout, `${res.body?.removed ? 'Deleted' : 'No matching entry'}: ${res.body?.memoryId ?? positionals[0]}`);
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Onboarding wizard — `openwop onboard`
// ─────────────────────────────────────────────────────────────────────────────

async function runOnboard(ctx, argv) {
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

async function resolveBaseUrl(ctx, options, existing, interactive) {
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
  return HOST_PRESETS.find((h) => h.key === choice).url;
}

async function resolveProvider(ctx, options, existing, interactive) {
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

async function resolveApiKey(ctx, options, provider, interactive) {
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

async function resolveModel(ctx, options, provider, existing, interactive) {
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

async function testProviderConnection(ctx, credentialRef) {
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

async function runProviders(ctx, argv) {
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

async function runProvidersList(ctx, argv) {
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

async function runProvidersAdd(ctx, argv) {
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

async function runProvidersRemove(ctx, argv) {
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

async function runProvidersTest(ctx, argv) {
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

async function runAgents(ctx, argv) {
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

async function runAgentsList(ctx, argv) {
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

async function runAgentsInfo(ctx, argv) {
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
async function runAgentsRun(ctx, argv) {
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
  const body = {};
  if (options['task-json'] !== undefined) {
    try {
      body.task = JSON.parse(options['task-json']);
    } catch {
      throw new CliError('--task-json must be valid JSON', 2);
    }
  }
  if (Array.isArray(options.tool) && options.tool.length) body.availableTools = options.tool;
  if (options.threshold !== undefined) body.confidenceThreshold = Number(options.threshold);
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

async function runConfig(ctx, argv) {
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

async function runWebhooks(ctx, argv) {
  const sub = argv[0] ?? 'list';
  const args = argv.slice(['list', 'add', 'remove', 'rm', 'test'].includes(sub) ? 1 : 0);
  if (sub === '--help' || sub === '-h') {
    write(ctx.io.stdout, WEBHOOKS_HELP);
    return 0;
  }
  switch (sub) {
    case 'list':
      return await runWebhooksList(ctx, args);
    case 'add':
      return await runWebhooksAdd(ctx, args);
    case 'remove':
    case 'rm':
      return await runWebhooksRemove(ctx, args);
    case 'test':
      return await runWebhooksTest(ctx, args);
    default:
      throw new CliError(`Unknown webhooks command: ${sub}\nRun \`openwop webhooks --help\` for usage.`);
  }
}

async function runWebhooksList(ctx, argv) {
  const { options } = parseOptions(argv, { bool: ['--help'] });
  if (options.help) {
    write(ctx.io.stdout, WEBHOOKS_HELP);
    return 0;
  }
  const res = await requestJson(ctx, '/v1/webhooks');
  if (ctx.json) {
    writeJson(ctx.io.stdout, res.body);
    return 0;
  }
  const subscriptions = Array.isArray(res.body?.subscriptions) ? res.body.subscriptions : [];
  if (subscriptions.length === 0) {
    writeLine(ctx.io.stdout, 'No webhook subscriptions. Add one with `openwop webhooks add <url> --event <type>`.');
    return 0;
  }
  const rows = subscriptions.map((s) => ({
    subscriptionId: s.subscriptionId,
    url: s.url,
    events: Array.isArray(s.events) ? s.events.join(',') : '',
    createdAt: s.createdAt ?? '',
  }));
  writeLine(ctx.io.stdout, formatTable(rows, ['subscriptionId', 'url', 'events', 'createdAt']));
  return 0;
}

async function runWebhooksAdd(ctx, argv) {
  const { options, positionals } = parseOptions(argv, {
    bool: ['--help'],
    value: ['--secret'],
    multi: ['--event', '--tag'],
  });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop webhooks add <url> --event <type> [--event <type> ...] [--tag t] [--secret s] [--json]\n');
    return options.help ? 0 : 2;
  }
  const events = options.event ?? [];
  if (events.length === 0) {
    throw new CliError('At least one --event <type> is required.');
  }
  const body = {
    url: positionals[0],
    events,
    ...(options.tag ? { tags: options.tag } : {}),
    ...(options.secret ? { secret: options.secret } : {}),
  };
  const res = await requestJson(ctx, '/v1/webhooks', { method: 'POST', body });
  if (ctx.json) {
    writeJson(ctx.io.stdout, res.body);
    return 0;
  }
  writeLine(ctx.io.stdout, `✓ Registered webhook ${res.body.subscriptionId} → ${res.body.url}`);
  if (res.body.secret) {
    writeLine(ctx.io.stdout, `  Signing secret (shown once): ${res.body.secret}`);
  }
  return 0;
}

async function runWebhooksRemove(ctx, argv) {
  const { options, positionals } = parseOptions(argv, { bool: ['--help'] });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop webhooks remove <subscriptionId> [--json]\n');
    return options.help ? 0 : 2;
  }
  await requestJson(ctx, `/v1/webhooks/${encodeURIComponent(positionals[0])}`, { method: 'DELETE' });
  if (ctx.json) writeJson(ctx.io.stdout, { removed: positionals[0] });
  else writeLine(ctx.io.stdout, `✓ Removed webhook ${positionals[0]}`);
  return 0;
}

async function runWebhooksTest(ctx, argv) {
  const { options, positionals } = parseOptions(argv, { bool: ['--help'] });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop webhooks test <subscriptionId> [--json]\n');
    return options.help ? 0 : 2;
  }
  const res = await requestJson(ctx, `/v1/webhooks/${encodeURIComponent(positionals[0])}/test`, { method: 'POST', body: {} });
  if (ctx.json) {
    writeJson(ctx.io.stdout, res.body);
    return 0;
  }
  writeLine(ctx.io.stdout, `✓ Test delivery dispatched to ${res.body.url} (event ${res.body.eventType}).`);
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// `openwop cron ...` — manage scheduled jobs (C-6, RFC 0052)
// ─────────────────────────────────────────────────────────────────────────────

async function runCron(ctx, argv) {
  const sub = argv[0] ?? 'list';
  const args = argv.slice(['list', 'add', 'remove', 'rm', 'trigger'].includes(sub) ? 1 : 0);
  if (sub === '--help' || sub === '-h') {
    write(ctx.io.stdout, CRON_HELP);
    return 0;
  }
  switch (sub) {
    case 'list':
      return await runCronList(ctx, args);
    case 'add':
      return await runCronAdd(ctx, args);
    case 'remove':
    case 'rm':
      return await runCronRemove(ctx, args);
    case 'trigger':
      return await runCronTrigger(ctx, args);
    default:
      throw new CliError(`Unknown cron command: ${sub}\nRun \`openwop cron --help\` for usage.`);
  }
}

async function runCronList(ctx, argv) {
  const { options } = parseOptions(argv, { bool: ['--help'] });
  if (options.help) {
    write(ctx.io.stdout, CRON_HELP);
    return 0;
  }
  const res = await requestJson(ctx, '/v1/host/sample/scheduler/jobs');
  if (ctx.json) {
    writeJson(ctx.io.stdout, res.body);
    return 0;
  }
  const jobs = Array.isArray(res.body?.jobs) ? res.body.jobs : [];
  if (jobs.length === 0) {
    writeLine(ctx.io.stdout, 'No scheduled jobs. Add one with `openwop cron add "<cronExpr>" --workflow <id>`.');
    return 0;
  }
  const rows = jobs.map((j) => ({
    jobId: j.jobId,
    cronExpr: j.cronExpr,
    workflowId: j.workflowId ?? '',
    lastFiredTick: j.lastFiredTick ?? '-',
  }));
  writeLine(ctx.io.stdout, formatTable(rows, ['jobId', 'cronExpr', 'workflowId', 'lastFiredTick']));
  return 0;
}

async function runCronAdd(ctx, argv) {
  const { options, positionals } = parseOptions(argv, {
    bool: ['--help'],
    value: ['--workflow', '--job-id', '--first-fire-at-ms'],
  });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop cron add "<cronExpr>" [--workflow <id>] [--job-id <id>] [--first-fire-at-ms <ms>] [--json]\n');
    return options.help ? 0 : 2;
  }
  const body = {
    cronExpr: positionals[0],
    ...(options.jobId ? { jobId: options.jobId } : {}),
    ...(options.workflow ? { workflowId: options.workflow } : {}),
    ...(options.firstFireAtMs !== undefined ? { firstFireAtMs: Number(options.firstFireAtMs) } : {}),
  };
  const res = await requestJson(ctx, '/v1/host/sample/scheduler/jobs', { method: 'POST', body });
  if (ctx.json) {
    writeJson(ctx.io.stdout, res.body);
    return 0;
  }
  writeLine(ctx.io.stdout, `✓ Scheduled job ${res.body.jobId} (${res.body.cronExpr})`);
  return 0;
}

async function runCronRemove(ctx, argv) {
  const { options, positionals } = parseOptions(argv, { bool: ['--help'] });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop cron remove <jobId> [--json]\n');
    return options.help ? 0 : 2;
  }
  const res = await requestJson(ctx, `/v1/host/sample/scheduler/jobs/${encodeURIComponent(positionals[0])}`, { method: 'DELETE' });
  if (ctx.json) writeJson(ctx.io.stdout, res.body);
  else writeLine(ctx.io.stdout, `✓ Removed scheduled job ${positionals[0]}`);
  return 0;
}

async function runCronTrigger(ctx, argv) {
  const { options, positionals } = parseOptions(argv, { bool: ['--help'] });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop cron trigger <jobId> [--json]\n');
    return options.help ? 0 : 2;
  }
  const res = await requestJson(ctx, `/v1/host/sample/scheduler/jobs/${encodeURIComponent(positionals[0])}/trigger`, { method: 'POST', body: {} });
  if (ctx.json) {
    writeJson(ctx.io.stdout, res.body);
    return 0;
  }
  writeLine(ctx.io.stdout, `✓ Fired ${positionals[0]} — ${res.body.runsFired} run(s) (tick ${res.body.lastFiredTick}).`);
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Config file + path utilities
// ─────────────────────────────────────────────────────────────────────────────

export function configPathFor(profile, env = process.env) {
  // OPENWOP_CONFIG_HOME overrides the parent dir (useful for tests).
  const home = env.OPENWOP_CONFIG_HOME ?? homedir();
  const dir = profile ? `.openwop-${profile}` : '.openwop';
  return join(home, dir, 'config.json');
}

export function readConfigSafe(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export function saveConfig(path, config) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  try { chmodSync(path, 0o600); } catch { /* best-effort on Windows */ }
}

function mergeConfig(existing, next) {
  const base = existing ?? {};
  return {
    ...base,
    ...next,
    host: { ...(base.host ?? {}), ...(next.host ?? {}) },
  };
}

function getByPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

function setByPath(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function unsetByPath(obj, path) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) return;
    cur = cur[parts[i]];
  }
  delete cur[parts[parts.length - 1]];
}

// ─────────────────────────────────────────────────────────────────────────────
// Demo daemon lifecycle — PID file + log file under ~/.openwop/
// (honors OPENWOP_CONFIG_HOME exactly like configPathFor).
// ─────────────────────────────────────────────────────────────────────────────

export function openwopHomeDir(env = process.env) {
  const home = env.OPENWOP_CONFIG_HOME ?? homedir();
  return join(home, '.openwop');
}

export function daemonPidPath(env = process.env) {
  return join(openwopHomeDir(env), 'demo-backend.pid.json');
}

export function daemonLogPath(env = process.env) {
  return join(openwopHomeDir(env), 'demo-backend.log');
}

export function readDaemonRecord(env = process.env) {
  try {
    const path = daemonPidPath(env);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function writeDaemonRecord(env, record) {
  const path = daemonPidPath(env);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  try { chmodSync(path, 0o600); } catch { /* best-effort on Windows */ }
}

function clearDaemonRecord(env) {
  try {
    const path = daemonPidPath(env);
    if (existsSync(path)) rmSync(path);
  } catch { /* best-effort */ }
}

export function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    // Signal 0 performs error checking without delivering a signal.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH: no such process. EPERM: exists but not ours → still alive.
    return err && err.code === 'EPERM';
  }
}

function openLogStream(path) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    return openSync(path, 'a');
  } catch {
    return null;
  }
}

function writeLog(fd, chunk) {
  try {
    writeFileSync(fd, chunk);
  } catch { /* best-effort; never crash the dev loop over a log write */ }
}

// Build a per-platform service-install plan. Pure (no fs side effects) so it
// can be unit-tested and dry-run printed. Returns either an `unsupported`
// plan with guidance text, or a writable plan with path/contents/activate.
export function buildServiceInstallPlan(input) {
  const { platform, root, backendPort, label, apiKey, env, uninstall } = input;
  const nodeBin = process.execPath;
  const backendDir = join(root, 'apps/workflow-engine/backend/typescript');
  const home = env.HOME ?? homedir();
  const npm = platform === 'win32' ? 'npm.cmd' : 'npm';

  if (platform === 'darwin') {
    const path = join(home, 'Library/LaunchAgents', `${label}.plist`);
    const contents = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0">',
      '<dict>',
      '  <key>Label</key>',
      `  <string>${label}</string>`,
      '  <key>ProgramArguments</key>',
      '  <array>',
      `    <string>${npm}</string>`,
      '    <string>run</string>',
      '    <string>dev</string>',
      '  </array>',
      '  <key>WorkingDirectory</key>',
      `  <string>${backendDir}</string>`,
      '  <key>EnvironmentVariables</key>',
      '  <dict>',
      '    <key>PORT</key>',
      `    <string>${backendPort}</string>`,
      '    <key>OPENWOP_API_KEY</key>',
      `    <string>${apiKey}</string>`,
      '  </dict>',
      '  <key>RunAtLoad</key>',
      '  <true/>',
      '  <key>KeepAlive</key>',
      '  <true/>',
      '  <key>StandardOutPath</key>',
      `  <string>${daemonLogPath(env)}</string>`,
      '  <key>StandardErrorPath</key>',
      `  <string>${daemonLogPath(env)}</string>`,
      '</dict>',
      '</plist>',
    ].join('\n');
    return {
      manager: 'launchd LaunchAgent',
      path,
      contents,
      uninstall: Boolean(uninstall),
      activate: `launchctl load -w ${path}`,
      deactivate: `launchctl unload -w ${path}`,
    };
  }

  if (platform === 'linux') {
    const path = join(home, '.config/systemd/user', `${label}.service`);
    const contents = [
      '[Unit]',
      'Description=OpenWOP workflow-engine demo backend',
      'After=network.target',
      '',
      '[Service]',
      'Type=simple',
      `WorkingDirectory=${backendDir}`,
      `Environment=PORT=${backendPort}`,
      `Environment=OPENWOP_API_KEY=${apiKey}`,
      `ExecStart=${npm} run dev`,
      'Restart=on-failure',
      '',
      '[Install]',
      'WantedBy=default.target',
    ].join('\n');
    return {
      manager: 'systemd user unit',
      path,
      contents,
      uninstall: Boolean(uninstall),
      activate: `systemctl --user daemon-reload && systemctl --user enable --now ${label}.service`,
      deactivate: `systemctl --user disable --now ${label}.service`,
    };
  }

  // Windows + anything else: no file is written. Give a concrete recipe.
  const guidance = platform === 'win32'
    ? [
        'Automatic service install is not wired for Windows yet.',
        'Create a Scheduled Task that runs the demo backend at logon:',
        '',
        `  schtasks /Create /TN "${label}" /SC ONLOGON /TR ^`,
        `    "cmd /c cd /d ${backendDir} && set PORT=${backendPort}&& set OPENWOP_API_KEY=${apiKey}&& ${npm} run dev"`,
        '',
        'Remove it later with:',
        `  schtasks /Delete /TN "${label}" /F`,
        '',
        `(Node runtime: ${nodeBin})`,
      ].join('\n')
    : [
        `Automatic service install is not supported on platform "${platform}".`,
        'Run the backend under your platform process manager with:',
        `  cd ${backendDir} && PORT=${backendPort} OPENWOP_API_KEY=${apiKey} ${npm} run dev`,
      ].join('\n');
  return { unsupported: true, guidance };
}

// ─────────────────────────────────────────────────────────────────────────────
// Interactive prompt helpers (Node stdlib only)
// ─────────────────────────────────────────────────────────────────────────────

async function promptChoice(ctx, label, choices) {
  writeLine(ctx.io.stdout, label);
  choices.forEach((c, i) => {
    const tag = c.recommended ? ' (recommended)' : '';
    writeLine(ctx.io.stdout, `  ${i + 1}) ${c.label}${tag}`);
  });
  const defaultIdx = Math.max(0, choices.findIndex((c) => c.recommended));
  const answer = await promptText(ctx, `Choice [${defaultIdx + 1}]: `, '');
  const idx = answer.trim() === '' ? defaultIdx : Number(answer.trim()) - 1;
  if (!Number.isInteger(idx) || idx < 0 || idx >= choices.length) {
    throw new CliError(`Invalid choice: ${answer}`);
  }
  return choices[idx].key;
}

async function promptText(ctx, prompt, defaultValue = '') {
  ctx.io.stdout.write(prompt);
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  return new Promise((resolve) => {
    rl.once('line', (line) => {
      rl.close();
      resolve(line.length > 0 ? line : defaultValue);
    });
  });
}

async function promptYesNo(ctx, label, defaultYes = true) {
  const hint = defaultYes ? '[Y/n]' : '[y/N]';
  const answer = (await promptText(ctx, `${label} ${hint} `, '')).trim().toLowerCase();
  if (answer === '') return defaultYes;
  return answer === 'y' || answer === 'yes';
}

async function readSecret(ctx, prompt) {
  ctx.io.stdout.write(prompt);
  const stdin = process.stdin;
  // Pipe / non-TTY: read one line normally so `echo KEY | openwop ...` works.
  if (!stdin.isTTY) {
    const rl = createInterface({ input: stdin, output: ctx.io.stdout, terminal: false });
    return new Promise((resolve) => {
      rl.once('line', (line) => {
        rl.close();
        resolve(line);
      });
    });
  }
  // TTY: raw-mode keypress loop with no echo + Ctrl-C support + backspace.
  return new Promise((resolve, reject) => {
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const cleanup = () => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      ctx.io.stdout.write('\n');
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        const code = ch.charCodeAt(0);
        if (code === 0x0d || code === 0x0a) { cleanup(); resolve(value); return; }
        if (code === 0x03) { cleanup(); reject(new CliError('Aborted')); return; }
        if (code === 0x7f || code === 0x08) { value = value.slice(0, -1); continue; }
        if (code >= 0x20) value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

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

async function waitForRun(ctx, runId, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await requestJson(ctx, `/v1/runs/${encodeURIComponent(runId)}`);
    if (TERMINAL_STATUSES.has(res.body.status)) return res.body;
    await sleep(250);
  }
  throw new CliError(`Timed out waiting for run ${runId} after ${timeoutMs}ms`, 1);
}

async function requestJson(ctx, path, options = {}) {
  const url = new URL(path, ctx.baseUrl);
  const headers = {
    accept: 'application/json',
    ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
    ...(options.headers ?? {}),
  };
  if (options.auth !== false && ctx.apiKey) {
    headers.authorization = `Bearer ${ctx.apiKey}`;
  }
  const res = await ctx.fetchImpl(url, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  const body = text.length > 0 ? parseJsonResponse(text) : null;
  if (!res.ok) {
    throw new HttpError(`HTTP ${res.status}`, res.status, body);
  }
  return { status: res.status, headers: res.headers, body };
}

async function safeRequest(ctx, path, options = {}) {
  try {
    const res = await requestJson(ctx, path, options);
    return { ok: true, path, status: res.status, body: res.body };
  } catch (err) {
    return { ok: false, path, error: err instanceof Error ? err.message : String(err) };
  }
}

async function probeEndpoint(ctx, path) {
  try {
    const res = await requestJson(ctx, path, { auth: false });
    return { ok: true, message: String(res.status) };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

function parseJsonResponse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export function findRepoRoot(startDir) {
  let dir = resolvePath(startDir);
  while (true) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        const parsed = JSON.parse(readFileSync(pkg, 'utf8'));
        if (
          parsed.name === 'openwop-spec-corpus' &&
          existsSync(join(dir, 'apps/workflow-engine')) &&
          existsSync(join(dir, 'conformance'))
        ) {
          return dir;
        }
      } catch {
        // Keep walking.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function requireRepoRoot(ctx) {
  if (ctx.repoRoot) return ctx.repoRoot;
  throw new CliError('This command needs to run from inside the OpenWOP repository checkout.');
}

function demoProjects(root) {
  if (!root) return [];
  return [
    project(root, 'backend', 'apps/workflow-engine/backend/typescript'),
    project(root, 'frontend', 'apps/workflow-engine/frontend/react'),
  ];
}

function project(root, name, relativeDir) {
  const dir = join(root, relativeDir);
  return {
    name,
    relativeDir,
    dir,
    packageJson: join(dir, 'package.json'),
    nodeModules: join(dir, 'node_modules'),
  };
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

export function formatTable(rows, columns) {
  if (rows.length === 0) return '';
  const widths = {};
  for (const column of columns) {
    widths[column] = Math.max(
      column.length,
      ...rows.map((row) => String(row[column] ?? '').length),
    );
  }
  const line = (row) => columns.map((column) => String(row[column] ?? '').padEnd(widths[column])).join('  ').trimEnd();
  return [
    line(Object.fromEntries(columns.map((column) => [column, column]))),
    columns.map((column) => '-'.repeat(widths[column])).join('  '),
    ...rows.map(line),
  ].join('\n');
}

function prefixChunk(stream, label, chunk) {
  const text = chunk.toString();
  for (const line of text.split(/\r?\n/)) {
    if (line.length > 0) writeLine(stream, `[${label}] ${line}`);
  }
}

function write(stream, text) {
  stream.write(text);
}

function writeLine(stream, text) {
  stream.write(`${text}\n`);
}

function writeJson(stream, value) {
  writeLine(stream, JSON.stringify(value, null, 2));
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

const HEALTH_HELP = `Usage: openwop health [--base-url url] [--json]

Probes /health and /readiness on the configured host. Exit 0 when both respond; otherwise 1.
`;

const CAPABILITIES_HELP = `Usage: openwop capabilities [--base-url url] [--json]

Reads /.well-known/openwop and prints the implementation, protocol version, and advertised capability blocks. Use --json to inspect the raw discovery document.
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

const MEMORY_HELP = `Usage:
  openwop memory list [--memory-ref ref] [--tag t] [--limit n] [--json]
  openwop memory search <text> [--query text] [--tag t] [--memory-ref ref] [--limit n] [--json]
  openwop memory get <memoryId> [--memory-ref ref] [--json]
  openwop memory delete <memoryId> [--memory-ref ref] [--json]

Reads the demo MemoryAdapter ledger (RFC 0004) via the host-extension routes
under /v1/host/sample/memory. Every read and delete is tenant-scoped to the
caller's API key on the host (CTI-1) — the CLI never sends a tenantId and cannot
cross tenant boundaries. Select the tenant with --api-key / OPENWOP_API_KEY.

  --memory-ref ref   The agent-derived memoryRef (default: the demo's tenant-memory).
  --tag t            Server-side tag filter (also matched by \`search\`).
  --query / <text>   Free-text filter applied client-side over content + tags.
  --limit n          Cap the number of entries the host returns.
`;

const CONFORMANCE_HELP = `Usage: openwop conformance [--offline] [--filter pattern]

Runs the in-repo @openwop/openwop-conformance CLI. Without --offline it targets the configured --base-url.
`;

const MEDIA_HELP = `Usage:
  openwop media generate-image <prompt> [--output path] [--json]
  openwop media transcribe <audio-file> [--language en] [--json]
  openwop media synthesize <text> [--voice name] [--output path] [--json]

Exercises the host's core.openwop.ai media node family (image-generate,
audio-transcribe, audio-synthesize) through the demo backend's sample media
routes. --output writes the returned binary asset (PNG / WAV) to a file.

Note: the demo backend STUBS the actual provider calls — it advertises
aiProviders.imageGeneration: supported:false and wires no live media
provider — so results are deterministic fixture assets tagged \`stub: true\`,
not live generations. A production host with a wired provider returns real
media at the same endpoints.

Examples:
  openwop media generate-image "a red bicycle" --output bike.png
  openwop media transcribe clip.wav --language en
  openwop media synthesize "hello world" --output hello.wav --json
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

const WEBHOOKS_HELP = `Usage:
  openwop webhooks list [--json]
  openwop webhooks add <url> --event <type> [--event <type> ...] [--tag t] [--secret s] [--json]
  openwop webhooks remove <subscriptionId> [--json]
  openwop webhooks test <subscriptionId> [--json]

Manage HMAC-signed webhook subscriptions on the configured host (POST/GET/DELETE
/v1/webhooks per spec/v1/webhooks.md).

  add     Registers a subscription. Supply --event one or more times. When you
          omit --secret, the host generates one and returns it ONCE in the add
          response — store it to verify delivery signatures.
  test    Fires a synthetic, signed \`webhook.test\` delivery to the
          subscription URL so you can confirm reachability + signature handling.
          A 202 means the delivery was dispatched, not that the endpoint acked.

Note: \`list\` never returns the signing secret.
`;

const CRON_HELP = `Usage:
  openwop cron list [--json]
  openwop cron add "<cronExpr>" [--workflow <id>] [--job-id <id>] [--first-fire-at-ms <ms>] [--json]
  openwop cron remove <jobId> [--json]
  openwop cron trigger <jobId> [--json]

Manage scheduled (cron) jobs on the configured host via the RFC 0052 sample
scheduler CRUD (/v1/host/sample/scheduler/jobs). This is a sample-extension
surface — not part of the normative OpenWOP wire contract.

  add      Registers a job. --job-id is optional (the host assigns a UUID when
           omitted). A --first-fire-at-ms beyond the host's maxFutureHorizon is
           rejected with schedule_horizon_exceeded (RFC 0052 §B.3).
  trigger  Fires the job once now. Honors RFC 0052 §B.2 fire-once-per-tick: a
           single trigger advances the scheduler clock one tick and produces
           exactly one run.
`;
