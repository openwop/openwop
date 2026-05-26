import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve as resolvePath } from 'node:path';
import { createInterface } from 'node:readline';

export const VERSION = '0.1.0';
export const DEFAULT_BASE_URL = 'http://localhost:8080';
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
      case 'workflows':
      case 'workflow':
        return await runWorkflows(ctx, commandArgs);
      case 'runs':
      case 'run':
        return await runRuns(ctx, commandArgs);
      case 'chat':
        return await runChat(ctx, commandArgs);
      case 'conformance':
        return await runConformance(ctx, commandArgs);
      case 'onboard':
        return await runOnboard(ctx, commandArgs);
      case 'providers':
      case 'provider':
        return await runProviders(ctx, commandArgs);
      case 'config':
        return await runConfig(ctx, commandArgs);
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
    onboard: ONBOARD_HELP,
    providers: PROVIDERS_HELP,
    provider: PROVIDERS_HELP,
    config: CONFIG_HELP,
    doctor: DOCTOR_HELP,
    health: HEALTH_HELP,
    capabilities: CAPABILITIES_HELP,
    caps: CAPABILITIES_HELP,
    conformance: CONFORMANCE_HELP,
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
    bool: ['--help', '--backend-only', '--frontend-only', '--install', '--dry-run'],
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
    child.stdout.on('data', (chunk) => prefixChunk(ctx.io.stdout, command.label, chunk));
    child.stderr.on('data', (chunk) => prefixChunk(ctx.io.stderr, command.label, chunk));
    child.on('error', (err) => writeLine(ctx.io.stderr, `${command.label}: ${err.message}`));
    return { ...command, child };
  });

  const stop = () => {
    for (const { child } of children) {
      if (!child.killed) child.kill('SIGTERM');
    }
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
  const args = argv.slice(['list', 'create', 'get', 'cancel'].includes(sub) ? 1 : 0);
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
  demo start          Start the demo backend and frontend
  demo urls           Print local demo URLs
  health              Probe /health and /readiness
  capabilities        Summarize /.well-known/openwop
  catalog nodes       List demo node catalog entries
  catalog packs       List installed packs
  workflows list      List registered demo workflows
  workflows register  Register a workflow JSON file with the demo app
  runs create         Create a run
  runs list           List recent runs
  chat                Interactive streaming chat REPL over a workflow
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
`;

const DOCTOR_HELP = `Usage: openwop doctor [--json]

Checks Node/npm, local demo app dependencies, repository layout, and whether the demo backend is reachable.
`;

const DEMO_HELP = `Usage:
  openwop demo status [--json]
  openwop demo start [--backend-only|--frontend-only] [--install] [--backend-port 8080] [--frontend-port 5173]
  openwop demo urls [--frontend-port 5173]

The demo commands are tuned for apps/workflow-engine: a TypeScript backend on port 8080 and a Vite frontend on port 5173.
`;

const DEMO_STATUS_HELP = `Usage: openwop demo status [--base-url url] [--api-key key] [--json]

Probes /health, /readiness, /.well-known/openwop, and the demo summary endpoint.
`;

const DEMO_START_HELP = `Usage: openwop demo start [options]

Options:
  --backend-only          Start only the backend
  --frontend-only         Start only the frontend
  --install               Run npm install before starting selected services
  --backend-port <port>   Backend port (default: 8080)
  --frontend-port <port>  Frontend port (default: 5173)
  --dry-run               Print the commands without starting services
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

const CONFORMANCE_HELP = `Usage: openwop conformance [--offline] [--filter pattern]

Runs the in-repo @openwop/openwop-conformance CLI. Without --offline it targets the configured --base-url.
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

const CONFIG_HELP = `Usage:
  openwop config file
  openwop config get [key]
  openwop config set <key> <value>
  openwop config unset <key>

Reads and writes ~/.openwop/config.json (or OPENWOP_CONFIG_HOME/.openwop/ when set).
Dotted keys traverse nested objects (e.g., \`openwop config get host.baseUrl\`).
`;
