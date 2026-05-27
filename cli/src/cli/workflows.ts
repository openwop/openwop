import type { Ctx } from '../context.js';
/** `openwop workflows ...` — list/get/register/delete demo workflows. */
import { resolve as resolvePath } from 'node:path';
import { readFile } from 'node:fs/promises';
import { CliError } from '../errors.js';
import { write, writeLine, writeJson, formatTable } from '../io.js';
import { parseOptions } from '../options.js';
import { requestJson } from '../api.js';

export const WORKFLOWS_HELP = `Usage:
  openwop workflows list [--json]
  openwop workflows get <workflowId> [--json]
  openwop workflows register <workflow.json> [--json]
  openwop workflows delete <workflowId> [--json]
`;

export async function runWorkflows(ctx: Ctx, argv: string[]) {
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

async function runWorkflowsList(ctx: Ctx, argv: string[]) {
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
  const rows = workflows.map((w: any) => ({ workflowId: w.workflowId, nodes: Array.isArray(w.nodes) ? w.nodes.length : 0 }));
  writeLine(ctx.io.stdout, rows.length ? formatTable(rows, ['workflowId', 'nodes']) : 'No registered sample workflows.');
  return 0;
}

async function runWorkflowsGet(ctx: Ctx, argv: string[]) {
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

async function runWorkflowsRegister(ctx: Ctx, argv: string[]) {
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

async function runWorkflowsDelete(ctx: Ctx, argv: string[]) {
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
