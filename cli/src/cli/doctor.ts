import type { Ctx } from '../context.js';
/** `openwop doctor` — check local prerequisites + demo reachability. */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { write, writeLine, writeJson } from '../io.js';
import { parseOptions } from '../options.js';
import { probeEndpoint, safeRequest } from '../api.js';
import { readDaemonRecord, processAlive } from '../daemon.js';
import { demoProjects } from '../repo.js';
import { ok, warn, fail, formatCheckTable, parseNodeVersion, npmCommand } from './shared.js';
import { loadRelayConfig, detectChannelAvailability } from './relayShared.js';

export const DOCTOR_HELP = `Usage: openwop doctor [--json]

Checks Node/npm, local demo app dependencies, repository layout, whether the demo
backend is reachable, the demo daemon status (via /v1/host/sample/daemon-status or
the ~/.openwop/ PID file), and reachability of each stored BYOK provider credential.
`;

export async function runDoctor(ctx: Ctx, argv) {
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
