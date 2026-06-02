import type { Ctx } from '../context.js';
/** `openwop roster ...` — named standing agents + their workflow portfolio (RFC 0086). */
import { CliError } from '../errors.js';
import { write, writeLine, writeJson, formatTable } from '../io.js';
import { parseOptions } from '../options.js';
import { requestJson } from '../api.js';

export const ROSTER_HELP = `Usage:
  openwop roster list [--json]
  openwop roster get <rosterId> [--json]
  openwop roster create --persona <name> --agent-ref <agentId> [--agent-version <v> | --agent-channel <c>] [--workflow <id>]... [--label <text>] [--description <text>] [--disabled] [--avatar-url <url>] [--json]
  openwop roster update <rosterId> [--persona <name>] [--workflow <id>]... [--label <text>] [--description <text>] [--enabled|--disabled] [--avatar-url <url>] [--json]
  openwop roster delete <rosterId> [--yes]

Agent roster (RFC 0086). A roster entry is a named, tenant-scoped standing
agent that owns a portfolio of workflows[]; its triggers compose RFC 0052
(schedules) + RFC 0083 (the durable trigger bridge), and a run it initiates
emits the content-free roster.run.initiated attribution event. Drives the
host-extension surface POST/GET/PATCH/DELETE /v1/host/sample/roster.

  --persona <name>   The agent's display persona (required on create).
  --agent-ref <id>   The agentId this entry binds to (RFC 0002 AgentRef; required on create).
  --agent-version <v> | --agent-channel <c>   Pin the AgentRef to a version XOR a channel.
  --workflow <id>    A workflow in the entry's portfolio (repeatable).
  --label <text>     Short human label.
  --description <t>  Longer description.
  --enabled          (update) Re-enable the entry's triggers + heartbeat.
  --disabled         Create/leave the entry paused (triggers inert).
  --avatar-url <url> Photo URL for the entry.

Examples:
  openwop roster list
  openwop roster create --persona "Sally" --workflow sample.demo.triage --label "Support lead"
  openwop roster update r_123 --disabled
  openwop roster delete r_123 --yes
`;

export async function runRoster(ctx: Ctx, argv: string[]) {
  const sub = argv[0] ?? 'list';
  if (sub === '--help' || sub === '-h') {
    write(ctx.io.stdout, ROSTER_HELP);
    return 0;
  }
  const args = argv.slice(['list', 'get', 'create', 'update', 'delete'].includes(sub) ? 1 : 0);
  switch (sub) {
    case 'list':
      return await rosterList(ctx, args);
    case 'get':
      return await rosterGet(ctx, args);
    case 'create':
      return await rosterCreate(ctx, args);
    case 'update':
      return await rosterUpdate(ctx, args);
    case 'delete':
      return await rosterDelete(ctx, args);
    default:
      throw new CliError(`Unknown roster command: ${sub}\nRun \`openwop roster --help\` for usage.`);
  }
}

async function rosterList(ctx: Ctx, argv: string[]) {
  const { options } = parseOptions(argv, { bool: ['--help'] });
  if (options.help) { write(ctx.io.stdout, ROSTER_HELP); return 0; }
  const res = await requestJson(ctx, '/v1/host/sample/roster');
  if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
  const roster = Array.isArray(res.body?.roster) ? res.body.roster : [];
  if (roster.length === 0) {
    writeLine(ctx.io.stdout, 'No roster entries on this host. Create one with `openwop roster create --persona <name>`.');
    return 0;
  }
  const rows = roster.map((e: any) => ({
    rosterId: e.rosterId,
    persona: e.persona,
    label: e.label ?? '',
    workflows: Array.isArray(e.workflows) ? String(e.workflows.length) : '0',
    enabled: e.enabled === false ? 'no' : 'yes',
  }));
  writeLine(ctx.io.stdout, formatTable(rows, ['rosterId', 'persona', 'label', 'workflows', 'enabled']));
  return 0;
}

async function rosterGet(ctx: Ctx, argv: string[]) {
  const { options, positionals } = parseOptions(argv, { bool: ['--help'] });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop roster get <rosterId> [--json]\n');
    return options.help ? 0 : 2;
  }
  const res = await requestJson(ctx, `/v1/host/sample/roster/${encodeURIComponent(positionals[0])}`);
  if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
  const e = res.body ?? {};
  writeLine(ctx.io.stdout, `rosterId: ${e.rosterId ?? positionals[0]}`);
  writeLine(ctx.io.stdout, `persona: ${e.persona ?? ''}`);
  if (e.label) writeLine(ctx.io.stdout, `label: ${e.label}`);
  if (e.agentRef) writeLine(ctx.io.stdout, `agentRef: ${typeof e.agentRef === 'string' ? e.agentRef : JSON.stringify(e.agentRef)}`);
  writeLine(ctx.io.stdout, `enabled: ${e.enabled === false ? 'no' : 'yes'}`);
  writeLine(ctx.io.stdout, `workflows: ${Array.isArray(e.workflows) && e.workflows.length ? e.workflows.join(', ') : '(none)'}`);
  if (e.description) writeLine(ctx.io.stdout, `description: ${e.description}`);
  return 0;
}

async function rosterCreate(ctx: Ctx, argv: string[]) {
  const { options } = parseOptions(argv, {
    bool: ['--help', '--disabled'],
    value: ['--persona', '--agent-ref', '--agent-version', '--agent-channel', '--label', '--description', '--avatar-url'],
    multi: ['--workflow'],
  });
  if (options.help || !options.persona || !options.agentRef) {
    write(ctx.io.stdout, 'Usage: openwop roster create --persona <name> --agent-ref <agentId> [--agent-version <v> | --agent-channel <c>] [--workflow <id>]... [--label <t>] [--description <t>] [--disabled] [--avatar-url <url>] [--json]\n');
    return options.help ? 0 : 2;
  }
  if (options.agentVersion && options.agentChannel) {
    throw new CliError('--agent-version and --agent-channel are mutually exclusive (RFC 0082 §A).', 2);
  }
  // AgentRef is a structured object (RFC 0002): { agentId, version? | channel? }.
  const agentRef: Record<string, string> = { agentId: options.agentRef };
  if (options.agentVersion) agentRef.version = options.agentVersion;
  if (options.agentChannel) agentRef.channel = options.agentChannel;
  const body: Record<string, any> = { persona: options.persona, agentRef };
  if (Array.isArray(options.workflow) && options.workflow.length) body.workflows = options.workflow;
  if (options.label) body.label = options.label;
  if (options.description) body.description = options.description;
  if (options.disabled) body.enabled = false;
  if (options.avatarUrl) body.avatarUrl = options.avatarUrl;
  const res = await requestJson(ctx, '/v1/host/sample/roster', { method: 'POST', body });
  if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
  writeLine(ctx.io.stdout, `Created roster entry ${res.body?.rosterId} (${res.body?.persona}).`);
  return 0;
}

async function rosterUpdate(ctx: Ctx, argv: string[]) {
  const { options, positionals } = parseOptions(argv, {
    bool: ['--help', '--enabled', '--disabled'],
    value: ['--persona', '--label', '--description', '--avatar-url'],
    multi: ['--workflow'],
  });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop roster update <rosterId> [--persona <n>] [--workflow <id>]... [--label <t>] [--description <t>] [--enabled|--disabled] [--avatar-url <url>] [--json]\n');
    return options.help ? 0 : 2;
  }
  if (options.enabled && options.disabled) throw new CliError('Pass only one of --enabled / --disabled', 2);
  const body: Record<string, any> = {};
  if (options.persona) body.persona = options.persona;
  if (Array.isArray(options.workflow) && options.workflow.length) body.workflows = options.workflow;
  if (options.label) body.label = options.label;
  if (options.description) body.description = options.description;
  if (options.enabled) body.enabled = true;
  if (options.disabled) body.enabled = false;
  if (options.avatarUrl) body.avatarUrl = options.avatarUrl;
  const res = await requestJson(ctx, `/v1/host/sample/roster/${encodeURIComponent(positionals[0])}`, { method: 'PATCH', body });
  if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
  writeLine(ctx.io.stdout, `Updated roster entry ${res.body?.rosterId ?? positionals[0]}.`);
  return 0;
}

async function rosterDelete(ctx: Ctx, argv: string[]) {
  const { options, positionals } = parseOptions(argv, { bool: ['--help', '--yes'] });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop roster delete <rosterId> [--yes]\n');
    return options.help ? 0 : 2;
  }
  if (!options.yes) {
    writeLine(ctx.io.stderr, `Refusing to delete ${positionals[0]} without --yes (this removes the roster entry and its triggers).`);
    return 2;
  }
  await requestJson(ctx, `/v1/host/sample/roster/${encodeURIComponent(positionals[0])}`, { method: 'DELETE' });
  writeLine(ctx.io.stdout, `Deleted roster entry ${positionals[0]}.`);
  return 0;
}
