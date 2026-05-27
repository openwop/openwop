import type { Ctx } from '../context.js';
/** `openwop relay ...` — local channel relay: register/activate + bridge loop. */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CliError, HttpError, errText } from '../errors.js';
import { write, writeLine, writeJson } from '../io.js';
import { parseOptions } from '../options.js';
import { requestJson } from '../api.js';
import { processAlive, openLogStream } from '../daemon.js';
import { getChannelPlugin } from '../channels/registry.js';
import type { ChannelPlugin, InboundMessage, RelayChannel } from '../channels/types.js';
import {
  MESSAGING_BASE, DEVICE_TOKEN_HEADER, RELAY_CHANNELS,
  loadRelayConfig, saveRelayConfig, assertRelayChannel,
  relayPidPath, relayLogPath, readRelayRecord, makeChannelDeliver,
} from './relayShared.js';

export const RELAY_HELP = `Usage:
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

export async function runRelay(ctx: Ctx, argv: string[]) {
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

async function runRelayRegister(ctx: Ctx, argv: string[]) {
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

async function runRelayActivate(ctx: Ctx, argv: string[]) {
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

async function runRelaySetup(ctx: Ctx, argv: string[]) {
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

async function runRelayRevoke(ctx: Ctx, argv: string[]) {
  const { options } = parseOptions(argv, { value: ['--relay-id'] });
  const relayId = options.relayId ?? loadRelayConfig(ctx).relayId;
  if (!relayId) throw new CliError('No relay to revoke. Pass --relay-id or run `openwop relay setup` first.');
  const res = await requestJson(ctx, `${MESSAGING_BASE}/relay/revoke`, { method: 'POST', body: { relayId } });
  if (!options.relayId) saveRelayConfig(ctx, {});
  if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
  writeLine(ctx.io.stdout, `✓ Revoked relay ${relayId}`);
  return 0;
}

async function runRelaySend(ctx: Ctx, argv: string[]) {
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

async function runRelayStatus(ctx: Ctx, argv: string[]) {
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

async function runRelayStart(ctx: Ctx, argv: string[]) {
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

async function runRelayStop(ctx: Ctx, argv: string[]) {
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

async function runRelayLogs(ctx: Ctx, argv: string[]) {
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
