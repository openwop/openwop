import type { Ctx } from '../context.js';
/** `openwop messaging ...` — operate the demo relay-gateway (sample-extension). */
import { CliError } from '../errors.js';
import { write, writeLine, writeJson, formatTable } from '../io.js';
import { parseOptions } from '../options.js';
import { requestJson } from '../api.js';
import { MESSAGING_BASE, RELAY_CHANNELS } from './relayShared.js';

export const MESSAGING_HELP = `Usage:
  openwop messaging connectors list|get|add|enable|disable|test [...]
  openwop messaging sessions   list|inspect|close [...]
  openwop messaging policy     get|set <connectorId> [...]
  openwop messaging routing    list|add|remove [...]
  openwop messaging identity   list|show|create|link|unlink|delete [...]
  openwop messaging logs       [--channel c] [--direction inbound|outbound] [--status s] [--limit n]
  openwop messaging pairing    list|approve [--connector id] [--code c]
  openwop messaging allowlist  list|add|remove --connector id --channel ch --peer-id p

Operate the demo host's messaging relay-gateway (/v1/host/sample/messaging) —
a host-extension surface, NOT part of the normative OpenWOP wire contract.

  connectors add --channel <signal|whatsapp|imessage> [--display-name n]
  connectors enable|disable|test <connectorId>
  sessions inspect|close <sessionKey>
  policy set <connectorId> --dm <pairing|allowlist|open|disabled>
                           --group <allowlist|open|disabled>
                           --require-mention <true|false>
  routing add --pattern "*" (--workflow <id> | --agent <agentId>) [--channel c] [--priority n]
  routing remove <ruleId>
  identity create --name N --peer <channel>:<peerId> [--peer ...]
  identity link <identityId> --peer <channel>:<peerId>
  identity unlink <identityId> --peer <channel>:<peerId>

Register a local channel relay with \`openwop relay setup\`. Send a one-off
email/SMS with \`openwop notify <email|sms>\`.
`;

export async function runMessaging(ctx: Ctx, argv: string[]) {
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
    case 'pairing':
      return await runMessagingPairing(ctx, args);
    case 'allowlist':
      return await runMessagingAllowlist(ctx, args);
    default:
      throw new CliError(`Unknown messaging command: ${sub}\nRun \`openwop messaging --help\` for usage.`);
  }
}

async function runMessagingPairing(ctx: Ctx, argv: string[]) {
  const sub = argv[0] ?? 'list';
  const args = argv.slice(['list', 'approve'].includes(sub) ? 1 : 0);
  switch (sub) {
    case 'list': {
      const { options } = parseOptions(args, { value: ['--connector'] });
      const qs = options.connector ? `?connectorId=${encodeURIComponent(options.connector)}` : '';
      const res = await requestJson(ctx, `${MESSAGING_BASE}/pairing${qs}`);
      if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
      const pairings = Array.isArray(res.body?.pairings) ? res.body.pairings : [];
      if (pairings.length === 0) { writeLine(ctx.io.stdout, 'No pending pairing requests.'); return 0; }
      writeLine(ctx.io.stdout, formatTable(
        pairings.map((p: any) => ({ connectorId: p.connectorId, channel: p.channel, peerId: p.peerId, code: p.code, expiresAt: p.expiresAt })),
        ['connectorId', 'channel', 'peerId', 'code', 'expiresAt'],
      ));
      return 0;
    }
    case 'approve': {
      const { options } = parseOptions(args, { value: ['--connector', '--code'] });
      if (!options.connector || !options.code) throw new CliError('--connector and --code are required.');
      const res = await requestJson(ctx, `${MESSAGING_BASE}/pairing/approve`, {
        method: 'POST',
        body: { connectorId: options.connector, code: options.code },
      });
      if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
      writeLine(ctx.io.stdout, `✓ Approved ${res.body.channel}:${res.body.peerId} on ${res.body.connectorId}`);
      return 0;
    }
    default:
      throw new CliError(`Unknown pairing command: ${sub}`);
  }
}

async function runMessagingAllowlist(ctx: Ctx, argv: string[]) {
  const sub = argv[0] ?? 'list';
  const args = argv.slice(['list', 'add', 'remove'].includes(sub) ? 1 : 0);
  switch (sub) {
    case 'list': {
      const { options } = parseOptions(args, { value: ['--connector'] });
      const qs = options.connector ? `?connectorId=${encodeURIComponent(options.connector)}` : '';
      const res = await requestJson(ctx, `${MESSAGING_BASE}/allowlist${qs}`);
      if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
      const entries = Array.isArray(res.body?.entries) ? res.body.entries : [];
      if (entries.length === 0) { writeLine(ctx.io.stdout, 'No allowlist entries.'); return 0; }
      writeLine(ctx.io.stdout, formatTable(
        entries.map((e: any) => ({ connectorId: e.connectorId, channel: e.channel, peerId: e.peerId, addedAt: e.addedAt })),
        ['connectorId', 'channel', 'peerId', 'addedAt'],
      ));
      return 0;
    }
    case 'add': {
      const { options } = parseOptions(args, { value: ['--connector', '--channel', '--peer-id'] });
      if (!options.connector || !options.channel || !options.peerId) {
        throw new CliError('--connector, --channel, and --peer-id are required.');
      }
      const res = await requestJson(ctx, `${MESSAGING_BASE}/allowlist`, {
        method: 'POST',
        body: { connectorId: options.connector, channel: options.channel, peerId: options.peerId },
      });
      if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
      writeLine(ctx.io.stdout, `✓ Allowlisted ${res.body.channel}:${res.body.peerId} on ${res.body.connectorId}`);
      return 0;
    }
    case 'remove': {
      const { options } = parseOptions(args, { value: ['--connector', '--channel', '--peer-id'] });
      if (!options.connector || !options.channel || !options.peerId) {
        throw new CliError('--connector, --channel, and --peer-id are required.');
      }
      const qs = new URLSearchParams({ connectorId: options.connector, channel: options.channel, peerId: options.peerId });
      const res = await requestJson(ctx, `${MESSAGING_BASE}/allowlist?${qs}`, { method: 'DELETE' });
      if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
      writeLine(ctx.io.stdout, res.body.removed ? `✓ Removed ${res.body.channel}:${res.body.peerId}` : `(no entry for ${res.body.channel}:${res.body.peerId})`);
      return res.body.removed ? 0 : 1;
    }
    default:
      throw new CliError(`Unknown allowlist command: ${sub}`);
  }
}

async function runMessagingConnectors(ctx: Ctx, argv: string[]) {
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
        connectors.map((c: any) => ({ connectorId: c.connectorId, channel: c.channel, enabled: String(c.enabled), displayName: c.displayName ?? '' })),
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

async function runMessagingSessions(ctx: Ctx, argv: string[]) {
  const sub = argv[0] ?? 'list';
  const args = argv.slice(['list', 'inspect', 'close'].includes(sub) ? 1 : 0);
  switch (sub) {
    case 'list': {
      const res = await requestJson(ctx, `${MESSAGING_BASE}/sessions`);
      if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
      const sessions = Array.isArray(res.body?.sessions) ? res.body.sessions : [];
      if (sessions.length === 0) { writeLine(ctx.io.stdout, 'No messaging sessions yet.'); return 0; }
      writeLine(ctx.io.stdout, formatTable(
        sessions.map((s: any) => ({ sessionKey: s.sessionKey, channel: s.channel, peer: s.peerDisplay ?? s.peerId, messages: String(s.messageCount), lastInboundAt: s.lastInboundAt ?? '' })),
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

async function runMessagingPolicies(ctx: Ctx, argv: string[]) {
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

async function runMessagingRouting(ctx: Ctx, argv: string[]) {
  const sub = argv[0] ?? 'list';
  const args = argv.slice(['list', 'add', 'remove'].includes(sub) ? 1 : 0);
  switch (sub) {
    case 'list': {
      const res = await requestJson(ctx, `${MESSAGING_BASE}/routing`);
      if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
      const rules = Array.isArray(res.body?.rules) ? res.body.rules : [];
      if (rules.length === 0) { writeLine(ctx.io.stdout, 'No routing rules. Add one with `openwop messaging routing add --pattern "*" --workflow <id>`.'); return 0; }
      writeLine(ctx.io.stdout, formatTable(
        rules.map((r: any) => ({
          ruleId: r.ruleId, channel: r.channel ?? '(any)', pattern: r.pattern,
          target: r.workflowId ? `wf:${r.workflowId}` : `agent:${r.agentId}`,
          priority: String(r.priority),
        })),
        ['ruleId', 'channel', 'pattern', 'target', 'priority'],
      ));
      return 0;
    }
    case 'add': {
      const { options } = parseOptions(args, { value: ['--channel', '--pattern', '--workflow', '--agent', '--priority', '--rule-id'] });
      if (!options.pattern) throw new CliError('--pattern is required (use "*" to match any).');
      if (!options.workflow && !options.agent) throw new CliError('one of --workflow or --agent is required.');
      if (options.workflow && options.agent) throw new CliError('--workflow and --agent are mutually exclusive.');
      const body = {
        ...(options.channel ? { channel: options.channel } : {}),
        pattern: options.pattern,
        ...(options.workflow ? { workflowId: options.workflow } : {}),
        ...(options.agent ? { agentId: options.agent } : {}),
        ...(options.priority !== undefined ? { priority: Number(options.priority) } : {}),
        ...(options.ruleId ? { ruleId: options.ruleId } : {}),
      };
      const res = await requestJson(ctx, `${MESSAGING_BASE}/routing`, { method: 'POST', body });
      if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
      const target = res.body.workflowId ? `workflow ${res.body.workflowId}` : `agent ${res.body.agentId}`;
      writeLine(ctx.io.stdout, `✓ Rule ${res.body.ruleId} — ${res.body.channel ?? '(any)'}/${res.body.pattern} → ${target} (priority ${res.body.priority})`);
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

async function runMessagingIdentity(ctx: Ctx, argv: string[]) {
  const sub = argv[0] ?? 'list';
  const args = argv.slice(['list', 'show', 'create', 'link', 'unlink', 'delete'].includes(sub) ? 1 : 0);
  switch (sub) {
    case 'list': {
      const res = await requestJson(ctx, `${MESSAGING_BASE}/identities`);
      if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
      const identities = Array.isArray(res.body?.identities) ? res.body.identities : [];
      if (identities.length === 0) { writeLine(ctx.io.stdout, 'No identities. Create one with `openwop messaging identity create --name Alice --peer signal:+1555…`.'); return 0; }
      writeLine(ctx.io.stdout, formatTable(
        identities.map((i: any) => ({ identityId: i.identityId, displayName: i.displayName ?? '', peers: (i.peers ?? []).map((p: any) => `${p.channel}:${p.peerId}`).join(', ') })),
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

async function runMessagingLogs(ctx: Ctx, argv: string[]) {
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
    entries.map((e: any) => ({ at: e.at, direction: e.direction, channel: e.channel, conversationId: e.conversationId, status: e.status, detail: e.detail ?? '' })),
    ['at', 'direction', 'channel', 'conversationId', 'status', 'detail'],
  ));
  return 0;
}

function parsePeerFlags(raw: unknown): Array<{ channel: string; peerId: string }> {
  const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  return list.map((entry) => {
    const [channel, ...rest] = String(entry).split(':');
    const peerId = rest.join(':');
    if (!channel || !peerId) throw new CliError(`--peer must be <channel>:<peerId> (got "${entry}").`);
    return { channel, peerId };
  });
}
