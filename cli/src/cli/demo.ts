import type { Ctx } from '../context.js';
/** `openwop demo ...` — run/inspect the workflow-engine demo app locally. */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, createReadStream, openSync, statSync, mkdirSync, rmSync, chmodSync, watch } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { CliError } from '../errors.js';
import { write, writeLine, writeJson, formatTable, prefixChunk } from '../io.js';
import { parseOptions } from '../options.js';
import { safeRequest } from '../api.js';
import { sleep } from '../util.js';
import { DEFAULT_API_KEY } from '../constants.js';
import {
  daemonLogPath, readDaemonRecord, writeDaemonRecord, clearDaemonRecord,
  processAlive, openLogStream, writeLog, buildServiceInstallPlan,
} from '../daemon.js';
import { project, demoProjects, requireRepoRoot } from '../repo.js';
import { npmCommand } from './shared.js';

export const DEMO_HELP = `Usage:
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

export const DEMO_STATUS_HELP = `Usage: openwop demo status [--base-url url] [--api-key key] [--json]

Probes /health, /readiness, /.well-known/openwop, and the demo summary endpoint.
`;

export const DEMO_START_HELP = `Usage: openwop demo start [options]

Options:
  --backend-only          Start only the backend
  --frontend-only         Start only the frontend
  --detach                Run the backend in the background (writes a PID file); returns immediately
  --install               Run npm install before starting selected services
  --backend-port <port>   Backend port (default: 8080)
  --frontend-port <port>  Frontend port (default: 5173)
  --dry-run               Print the commands without starting services
`;

export const DEMO_STOP_HELP = `Usage: openwop demo stop [--force] [--timeout-ms 5000] [--json]

Reads the PID file under ~/.openwop/ and signals the demo backend (SIGTERM, then
SIGKILL after --timeout-ms). --force sends SIGKILL immediately. Clears the PID file.
`;

export const DEMO_RESTART_HELP = `Usage: openwop demo restart [--backend-port 8080] [--json]

Stops the tracked demo backend, then starts a fresh one detached. Reuses the prior
backend port unless --backend-port is given.
`;

export const DEMO_LOGS_HELP = `Usage: openwop demo logs [--follow] [--lines 50]

Prints the tail of the demo backend log file (~/.openwop/demo-backend.log).
--follow streams new lines until interrupted. --lines sets how many trailing lines to show.
`;

export const DEMO_INSTALL_HELP = `Usage: openwop demo install [--dry-run] [--uninstall] [--backend-port 8080] [--label dev.openwop.demo]

Writes a managed-service definition for the demo backend, chosen by platform:
  macOS    LaunchAgent plist under ~/Library/LaunchAgents/
  Linux    systemd user unit under ~/.config/systemd/user/
  Windows  prints a Scheduled-Task recipe (no file is written)

--dry-run prints the target path and full file contents without writing.
--uninstall removes a previously written unit file.
`;

export const DEMO_URLS_HELP = `Usage: openwop demo urls [--frontend-port 5173] [--json]
`;


export async function runDemo(ctx: Ctx, argv: string[]): Promise<number> {
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

export async function runDemoStatus(ctx: Ctx, argv: string[]): Promise<number> {
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
