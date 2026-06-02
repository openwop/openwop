import type { Ctx } from '../context.js';
/** `openwop agents ...` — manifest-agent inventory + dispatch (RFC 0070). */
import { CliError } from '../errors.js';
import { write, writeLine, writeJson, formatTable } from '../io.js';
import { parseOptions } from '../options.js';
import { requestJson } from '../api.js';

export const AGENTS_HELP = `Usage:
  openwop agents list [--json]
  openwop agents info <agentId> [--json]
  openwop agents run <agentId> [--task-json '{...}'] [--tool <id>]... [--threshold <n>] [--no-validate] [--json]
  openwop agents create --persona <name> [--label <t>] [--description <t>] [--model-class <c>] [--system-prompt <t>] [--tool <id>]... [--threshold <n>] [--json]
  openwop agents update <agentId> [--persona <n>] [--label <t>] [--description <t>] [--model-class <c>] [--system-prompt <t>] [--tool <id>]... [--threshold <n>] [--json]
  openwop agents delete <agentId> [--yes]

Manifest agents (RFC 0070). The host loads pack agents[] (RFC 0003) into an
AgentRegistry and advertises capabilities.agents.manifestRuntime. 'list'/'info'
render that registry-backed inventory; 'run' dispatches one agent turn via
POST /v1/host/sample/agents/{agentId}/dispatch — the tool surface is filtered to
the agent's toolAllowlist (RFC 0002 §A14), task/return payloads are validated
against the agent's handoff schemas (RFC 0003 §D, unless --no-validate), and a
sub-threshold decision escalates rather than proceeding (RFC 0002 §F).

'create'/'update'/'delete' manage tenant-scoped user-defined agents on the demo
host (POST/PATCH/DELETE /v1/host/sample/agents) — distinct from the pack-loaded
manifest agents that 'list'/'run' operate on.

  --task-json J        Inbound task payload (validated against handoff.taskSchemaRef).
  --tool <id>          (run) A tool the host offers this turn (repeatable); kept only if allowlisted.
                       (create/update) An entry in the agent's toolAllowlist (repeatable).
  --threshold <n>      Confidence threshold (run: per-run override; create/update: the agent's default).
  --no-validate        (run) Dispatch with opaque payloads (skip handoff schema validation).
  --persona <name>     (create/update) The agent's persona (required on create).
  --label / --description / --model-class / --system-prompt  (create/update) Agent metadata.

'run' exits 0 (completed), 3 (escalated), or 1 (failed) so scripts can branch.

Examples:
  openwop agents list
  openwop agents info core.openwop.agents.supervisor.default --json
  openwop agents run core.openwop.agents.code-reviewer.default --task-json '{"diff":"..."}' --tool openwop:fs.read
  openwop agents create --persona "Triage bot" --model-class fast --tool openwop:fs.read
  openwop agents delete agent_123 --yes
`;

export async function runAgents(ctx: Ctx, argv: string[]) {
  const sub = argv[0] ?? 'list';
  const args = argv.slice(['list', 'info', 'run', 'create', 'update', 'delete'].includes(sub) ? 1 : 0);
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
    case 'create':
      return await runAgentsCreate(ctx, args);
    case 'update':
      return await runAgentsUpdate(ctx, args);
    case 'delete':
      return await runAgentsDelete(ctx, args);
    default:
      throw new CliError(`Unknown agents command: ${sub}\nRun \`openwop agents --help\` for usage.`);
  }
}

// User-defined (tenant-scoped) agent CRUD — POST/PATCH/DELETE
// /v1/host/sample/agents. Distinct from the manifest agents 'list'/'run' read.
function userAgentBody(options: Record<string, any>): Record<string, any> {
  const body: Record<string, any> = {};
  if (options.persona) body.persona = options.persona;
  if (options.label) body.label = options.label;
  if (options.description) body.description = options.description;
  if (options.modelClass) body.modelClass = options.modelClass;
  if (options.systemPrompt) body.systemPrompt = options.systemPrompt;
  if (Array.isArray(options.tool) && options.tool.length) body.toolAllowlist = options.tool;
  if (options.threshold !== undefined) {
    const t = Number(options.threshold);
    if (!Number.isFinite(t) || t < 0 || t > 1) throw new CliError('--threshold must be a number between 0 and 1', 2);
    body.confidenceThreshold = t;
  }
  return body;
}

async function runAgentsCreate(ctx: Ctx, argv: string[]) {
  const { options } = parseOptions(argv, {
    bool: ['--help'],
    value: ['--persona', '--label', '--description', '--model-class', '--system-prompt', '--threshold'],
    multi: ['--tool'],
  });
  if (options.help || !options.persona) {
    write(ctx.io.stdout, 'Usage: openwop agents create --persona <name> [--label <t>] [--description <t>] [--model-class <c>] [--system-prompt <t>] [--tool <id>]... [--threshold <n>] [--json]\n');
    return options.help ? 0 : 2;
  }
  const res = await requestJson(ctx, '/v1/host/sample/agents', { method: 'POST', body: userAgentBody(options) });
  if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
  writeLine(ctx.io.stdout, `Created agent ${res.body?.agentId ?? ''} (${res.body?.persona ?? options.persona}).`);
  return 0;
}

async function runAgentsUpdate(ctx: Ctx, argv: string[]) {
  const { options, positionals } = parseOptions(argv, {
    bool: ['--help'],
    value: ['--persona', '--label', '--description', '--model-class', '--system-prompt', '--threshold'],
    multi: ['--tool'],
  });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop agents update <agentId> [--persona <n>] [--label <t>] [--description <t>] [--model-class <c>] [--system-prompt <t>] [--tool <id>]... [--threshold <n>] [--json]\n');
    return options.help ? 0 : 2;
  }
  const body = userAgentBody(options);
  if (Object.keys(body).length === 0) throw new CliError('Nothing to update — pass at least one field.', 2);
  const res = await requestJson(ctx, `/v1/host/sample/agents/${encodeURIComponent(positionals[0])}`, { method: 'PATCH', body });
  if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
  writeLine(ctx.io.stdout, `Updated agent ${positionals[0]}.`);
  return 0;
}

async function runAgentsDelete(ctx: Ctx, argv: string[]) {
  const { options, positionals } = parseOptions(argv, { bool: ['--help', '--yes'] });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop agents delete <agentId> [--yes]\n');
    return options.help ? 0 : 2;
  }
  if (!options.yes) {
    writeLine(ctx.io.stderr, `Refusing to delete agent ${positionals[0]} without --yes.`);
    return 2;
  }
  await requestJson(ctx, `/v1/host/sample/agents/${encodeURIComponent(positionals[0])}`, { method: 'DELETE' });
  writeLine(ctx.io.stdout, `Deleted agent ${positionals[0]}.`);
  return 0;
}

async function runAgentsList(ctx: Ctx, argv: string[]) {
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
  const rows = agents.map((a: any) => ({
    agentId: a.agentId,
    persona: a.label ?? a.persona,
    modelClass: a.modelClass,
    pack: a.packName,
    tools: Array.isArray(a.toolAllowlist) ? String(a.toolAllowlist.length) : '0',
  }));
  writeLine(ctx.io.stdout, formatTable(rows, ['agentId', 'persona', 'modelClass', 'pack', 'tools']));
  return 0;
}

async function runAgentsInfo(ctx: Ctx, argv: string[]) {
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
async function runAgentsRun(ctx: Ctx, argv: string[]) {
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
  if (options.taskJson !== undefined) {
    try {
      body.task = JSON.parse(options.taskJson);
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
  if (options.noValidate) body.validateHandoff = false;

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
