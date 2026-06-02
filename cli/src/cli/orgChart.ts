import type { Ctx } from '../context.js';
/** `openwop org-chart ...` — descriptive department/role/reporting structure (RFC 0087). */
import { CliError } from '../errors.js';
import { readFile } from 'node:fs/promises';
import { write, writeLine, writeJson, formatTable } from '../io.js';
import { parseOptions } from '../options.js';
import { requestJson } from '../api.js';

export const ORG_CHART_HELP = `Usage:
  openwop org-chart get [--json]
  openwop org-chart dept <departmentId> [--no-recursive] [--json]
  openwop org-chart set --file <chart.json> [--json]
  openwop org-chart clear [--yes]

Org chart (RFC 0087). A purely DESCRIPTIVE map of departments, roles, and
reportsTo edges — it confers no authority (the org-position-no-authority-
escalation invariant: the schema carries no permissions/scopes/canDispatch
field). Drives the host-extension surface GET/PUT/DELETE
/v1/host/sample/org-chart. 'set' replaces the whole chart from a JSON file
with { "departments": [...], "members": [...] }.

  --no-recursive   (dept) Show only the named department, not its sub-tree.
  --file <path>    (set) JSON document with departments[] + members[] arrays.

Examples:
  openwop org-chart get
  openwop org-chart dept engineering
  openwop org-chart set --file ./org.json
  openwop org-chart clear --yes
`;

export async function runOrgChart(ctx: Ctx, argv: string[]) {
  const sub = argv[0] ?? 'get';
  if (sub === '--help' || sub === '-h') { write(ctx.io.stdout, ORG_CHART_HELP); return 0; }
  const args = argv.slice(['get', 'dept', 'set', 'clear'].includes(sub) ? 1 : 0);
  switch (sub) {
    case 'get':
      return await orgChartGet(ctx, args);
    case 'dept':
      return await orgChartDept(ctx, args);
    case 'set':
      return await orgChartSet(ctx, args);
    case 'clear':
      return await orgChartClear(ctx, args);
    default:
      throw new CliError(`Unknown org-chart command: ${sub}\nRun \`openwop org-chart --help\` for usage.`);
  }
}

async function orgChartGet(ctx: Ctx, argv: string[]) {
  const { options } = parseOptions(argv, { bool: ['--help'] });
  if (options.help) { write(ctx.io.stdout, ORG_CHART_HELP); return 0; }
  const res = await requestJson(ctx, '/v1/host/sample/org-chart');
  if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
  const chart = res.body ?? {};
  const departments = Array.isArray(chart.departments) ? chart.departments : [];
  const members = Array.isArray(chart.members) ? chart.members : [];
  if (departments.length === 0 && members.length === 0) {
    writeLine(ctx.io.stdout, 'Org chart is empty. Populate it with `openwop org-chart set --file <chart.json>`.');
    return 0;
  }
  writeLine(ctx.io.stdout, `Departments (${departments.length}):`);
  if (departments.length) {
    writeLine(ctx.io.stdout, formatTable(departments.map((d: any) => ({
      departmentId: d.departmentId ?? d.id,
      name: d.name ?? '',
      reportsTo: d.reportsTo ?? d.parentId ?? '',
    })), ['departmentId', 'name', 'reportsTo']));
  }
  writeLine(ctx.io.stdout, `\nMembers (${members.length}):`);
  if (members.length) {
    writeLine(ctx.io.stdout, formatTable(members.map((m: any) => ({
      memberId: m.memberId ?? m.id,
      name: m.name ?? m.displayName ?? '',
      role: m.role ?? '',
      department: m.departmentId ?? '',
    })), ['memberId', 'name', 'role', 'department']));
  }
  return 0;
}

async function orgChartDept(ctx: Ctx, argv: string[]) {
  const { options, positionals } = parseOptions(argv, { bool: ['--help', '--no-recursive'] });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop org-chart dept <departmentId> [--no-recursive] [--json]\n');
    return options.help ? 0 : 2;
  }
  const recursive = options.noRecursive ? 'false' : 'true';
  const res = await requestJson(ctx, `/v1/host/sample/org-chart/${encodeURIComponent(positionals[0])}?recursive=${recursive}`);
  if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
  writeJson(ctx.io.stdout, res.body);
  return 0;
}

async function orgChartSet(ctx: Ctx, argv: string[]) {
  const { options } = parseOptions(argv, { bool: ['--help'], value: ['--file'] });
  if (options.help || !options.file) {
    write(ctx.io.stdout, 'Usage: openwop org-chart set --file <chart.json> [--json]\n');
    return options.help ? 0 : 2;
  }
  let parsed: any;
  try {
    parsed = JSON.parse(await readFile(options.file, 'utf8'));
  } catch (err) {
    throw new CliError(`Could not read/parse ${options.file}: ${err instanceof Error ? err.message : String(err)}`, 2);
  }
  if (!Array.isArray(parsed?.departments) || !Array.isArray(parsed?.members)) {
    throw new CliError('The chart file MUST be a JSON object with `departments` and `members` arrays.', 2);
  }
  const res = await requestJson(ctx, '/v1/host/sample/org-chart', {
    method: 'PUT',
    body: { departments: parsed.departments, members: parsed.members },
  });
  if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
  const chart = res.body ?? {};
  writeLine(ctx.io.stdout, `Set org chart: ${Array.isArray(chart.departments) ? chart.departments.length : 0} departments, ${Array.isArray(chart.members) ? chart.members.length : 0} members.`);
  return 0;
}

async function orgChartClear(ctx: Ctx, argv: string[]) {
  const { options } = parseOptions(argv, { bool: ['--help', '--yes'] });
  if (options.help) { write(ctx.io.stdout, 'Usage: openwop org-chart clear [--yes]\n'); return 0; }
  if (!options.yes) {
    writeLine(ctx.io.stderr, 'Refusing to clear the org chart without --yes.');
    return 2;
  }
  await requestJson(ctx, '/v1/host/sample/org-chart', { method: 'DELETE' });
  writeLine(ctx.io.stdout, 'Cleared the org chart.');
  return 0;
}
