import type { Ctx } from '../context.js';
/** `openwop orgs ...` — orgs/teams/groups/roles/members RBAC (RFC 0049 authorization). */
import { CliError } from '../errors.js';
import { write, writeLine, writeJson, formatTable } from '../io.js';
import { parseOptions } from '../options.js';
import { requestJson } from '../api.js';

export const ORGS_HELP = `Usage:
  openwop orgs list [--json]
  openwop orgs get <orgId> [--json]
  openwop orgs create --name <name> [--description <text>] [--json]
  openwop orgs update <orgId> [--name <name>] [--description <text>] [--json]
  openwop orgs delete <orgId> [--yes]

  openwop orgs teams   <orgId> list|create|update|delete [...]
  openwop orgs groups  <orgId> list|create|update|delete [...]
  openwop orgs roles   <orgId> list|create|update|delete [...]
  openwop orgs members <orgId> list|create|update|delete [...]

  openwop orgs role-catalog [--json]          # the host's global role catalog (GET /roles)
  openwop orgs effective [--subject <id>] [--json]   # effective access for a subject (GET /access/effective)

Organizations + RBAC (RFC 0049, authorization fail-closed). Orgs own teams,
groups, roles, and members; an effective-access query resolves a subject's
granted scopes. Drives the host-extension surface under /v1/host/sample/orgs,
/v1/host/sample/roles, and /v1/host/sample/access/effective.

Nested-entity flags:
  teams   create/update  --name <n> [--description <t>] [--color <c>]
  groups  create/update  --name <n> [--description <t>] [--role <id>]... [--member <id>]...
  roles   create/update  --name <n> [--description <t>] [--scope <s>]...
  members create         --subject <id> --display-name <n> [--email <e>] [--role <id>]... [--team <id>]...
  members update         [--display-name <n>] [--email <e>] [--role <id>]... [--team <id>]...

Examples:
  openwop orgs create --name "Acme"
  openwop orgs teams o_1 create --name "Support" --color blue
  openwop orgs roles o_1 create --name "Reviewer" --scope runs:read --scope runs:annotate
  openwop orgs members o_1 create --subject user:jo --display-name "Jo" --role role_reviewer --team t_support
  openwop orgs effective --subject user:jo
`;

const ENTITIES = ['teams', 'groups', 'roles', 'members'] as const;
type Entity = (typeof ENTITIES)[number];

export async function runOrgs(ctx: Ctx, argv: string[]) {
  const sub = argv[0] ?? 'list';
  if (sub === '--help' || sub === '-h') { write(ctx.io.stdout, ORGS_HELP); return 0; }
  if ((ENTITIES as readonly string[]).includes(sub)) {
    return await runEntity(ctx, sub as Entity, argv.slice(1));
  }
  const args = ['list', 'get', 'create', 'update', 'delete', 'role-catalog', 'effective'].includes(sub) ? argv.slice(1) : argv;
  switch (sub) {
    case 'list': return await orgsList(ctx, args);
    case 'get': return await orgsGet(ctx, args);
    case 'create': return await orgsCreate(ctx, args);
    case 'update': return await orgsUpdate(ctx, args);
    case 'delete': return await orgsDelete(ctx, args);
    case 'role-catalog': return await roleCatalog(ctx, args);
    case 'effective': return await effectiveAccess(ctx, args);
    default:
      throw new CliError(`Unknown orgs command: ${sub}\nRun \`openwop orgs --help\` for usage.`);
  }
}

// ── org level ────────────────────────────────────────────────────────────
async function orgsList(ctx: Ctx, argv: string[]) {
  const { options } = parseOptions(argv, { bool: ['--help'] });
  if (options.help) { write(ctx.io.stdout, ORGS_HELP); return 0; }
  const res = await requestJson(ctx, '/v1/host/sample/orgs');
  if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
  const orgs = arrayOf(res.body, 'orgs');
  if (orgs.length === 0) { writeLine(ctx.io.stdout, 'No organizations. Create one with `openwop orgs create --name <name>`.'); return 0; }
  writeLine(ctx.io.stdout, formatTable(orgs.map((o: any) => ({
    orgId: o.orgId ?? o.id, name: o.name ?? '', description: o.description ?? '',
  })), ['orgId', 'name', 'description']));
  return 0;
}

async function orgsGet(ctx: Ctx, argv: string[]) {
  const { options, positionals } = parseOptions(argv, { bool: ['--help'] });
  if (options.help || positionals.length !== 1) { write(ctx.io.stdout, 'Usage: openwop orgs get <orgId> [--json]\n'); return options.help ? 0 : 2; }
  const res = await requestJson(ctx, `/v1/host/sample/orgs/${encodeURIComponent(positionals[0])}`);
  writeJson(ctx.io.stdout, res.body);
  return 0;
}

async function orgsCreate(ctx: Ctx, argv: string[]) {
  const { options } = parseOptions(argv, { bool: ['--help'], value: ['--name', '--description'] });
  if (options.help || !options.name) { write(ctx.io.stdout, 'Usage: openwop orgs create --name <name> [--description <text>] [--json]\n'); return options.help ? 0 : 2; }
  const body: Record<string, any> = { name: options.name };
  if (options.description) body.description = options.description;
  const res = await requestJson(ctx, '/v1/host/sample/orgs', { method: 'POST', body });
  if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
  writeLine(ctx.io.stdout, `Created org ${res.body?.orgId ?? res.body?.id} (${res.body?.name}).`);
  return 0;
}

async function orgsUpdate(ctx: Ctx, argv: string[]) {
  const { options, positionals } = parseOptions(argv, { bool: ['--help'], value: ['--name', '--description'] });
  if (options.help || positionals.length !== 1) { write(ctx.io.stdout, 'Usage: openwop orgs update <orgId> [--name <name>] [--description <text>] [--json]\n'); return options.help ? 0 : 2; }
  const body: Record<string, any> = {};
  if (options.name) body.name = options.name;
  if (options.description) body.description = options.description;
  if (Object.keys(body).length === 0) throw new CliError('Nothing to update — pass --name and/or --description.', 2);
  const res = await requestJson(ctx, `/v1/host/sample/orgs/${encodeURIComponent(positionals[0])}`, { method: 'PATCH', body });
  if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
  writeLine(ctx.io.stdout, `Updated org ${positionals[0]}.`);
  return 0;
}

async function orgsDelete(ctx: Ctx, argv: string[]) {
  const { options, positionals } = parseOptions(argv, { bool: ['--help', '--yes'] });
  if (options.help || positionals.length !== 1) { write(ctx.io.stdout, 'Usage: openwop orgs delete <orgId> [--yes]\n'); return options.help ? 0 : 2; }
  if (!options.yes) { writeLine(ctx.io.stderr, `Refusing to delete org ${positionals[0]} without --yes (removes its teams, roles, and memberships).`); return 2; }
  await requestJson(ctx, `/v1/host/sample/orgs/${encodeURIComponent(positionals[0])}`, { method: 'DELETE' });
  writeLine(ctx.io.stdout, `Deleted org ${positionals[0]}.`);
  return 0;
}

// ── global role catalog + effective access ────────────────────────────────
async function roleCatalog(ctx: Ctx, argv: string[]) {
  const { options } = parseOptions(argv, { bool: ['--help'] });
  if (options.help) { write(ctx.io.stdout, 'Usage: openwop orgs role-catalog [--json]\n'); return 0; }
  const res = await requestJson(ctx, '/v1/host/sample/roles');
  if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
  const roles = arrayOf(res.body, 'roles');
  writeLine(ctx.io.stdout, formatTable(roles.map((r: any) => ({
    roleId: r.roleId ?? r.id, name: r.name ?? '', scopes: Array.isArray(r.scopes) ? r.scopes.join(',') : '',
  })), ['roleId', 'name', 'scopes']));
  return 0;
}

async function effectiveAccess(ctx: Ctx, argv: string[]) {
  const { options } = parseOptions(argv, { bool: ['--help'], value: ['--subject'] });
  if (options.help) { write(ctx.io.stdout, 'Usage: openwop orgs effective [--subject <id>] [--json]\n'); return 0; }
  const q = options.subject ? `?subject=${encodeURIComponent(options.subject)}` : '';
  const res = await requestJson(ctx, `/v1/host/sample/access/effective${q}`);
  writeJson(ctx.io.stdout, res.body);
  return 0;
}

// ── nested entities (teams/groups/roles/members) ──────────────────────────
async function runEntity(ctx: Ctx, entity: Entity, argv: string[]) {
  const orgId = argv[0];
  const verb = argv[1] ?? 'list';
  if (!orgId || orgId === '--help' || orgId === '-h') {
    write(ctx.io.stdout, `Usage: openwop orgs ${entity} <orgId> list|create|update|delete [...]\n`);
    return orgId ? 0 : 2;
  }
  const rest = argv.slice(2);
  const base = `/v1/host/sample/orgs/${encodeURIComponent(orgId)}/${entity}`;
  switch (verb) {
    case 'list': {
      const res = await requestJson(ctx, base);
      if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
      const items = arrayOf(res.body, entity);
      if (items.length === 0) { writeLine(ctx.io.stdout, `No ${entity} in org ${orgId}.`); return 0; }
      writeJson(ctx.io.stdout, items);
      return 0;
    }
    case 'create': {
      const { body, ok } = entityBody(ctx, entity, rest, true);
      if (!ok) return 2;
      const res = await requestJson(ctx, base, { method: 'POST', body });
      if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
      writeLine(ctx.io.stdout, `Created ${singular(entity)} in org ${orgId}.`);
      return 0;
    }
    case 'update': {
      const { positionals } = parseOptions(rest, { bool: ['--help'], value: passThroughValues(entity), multi: passThroughMulti(entity) });
      if (positionals.length !== 1) { writeLine(ctx.io.stderr, `Usage: openwop orgs ${entity} <orgId> update <${singular(entity)}Id> [...]`); return 2; }
      const { body, ok } = entityBody(ctx, entity, rest, false);
      if (!ok) return 2;
      const res = await requestJson(ctx, `${base}/${encodeURIComponent(positionals[0])}`, { method: 'PATCH', body });
      if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
      writeLine(ctx.io.stdout, `Updated ${singular(entity)} ${positionals[0]}.`);
      return 0;
    }
    case 'delete': {
      const { options, positionals } = parseOptions(rest, { bool: ['--help', '--yes'] });
      if (options.help || positionals.length !== 1) { writeLine(ctx.io.stderr, `Usage: openwop orgs ${entity} <orgId> delete <${singular(entity)}Id> [--yes]`); return options.help ? 0 : 2; }
      if (!options.yes) { writeLine(ctx.io.stderr, `Refusing to delete ${singular(entity)} ${positionals[0]} without --yes.`); return 2; }
      await requestJson(ctx, `${base}/${encodeURIComponent(positionals[0])}`, { method: 'DELETE' });
      writeLine(ctx.io.stdout, `Deleted ${singular(entity)} ${positionals[0]}.`);
      return 0;
    }
    default:
      throw new CliError(`Unknown ${entity} verb: ${verb}`);
  }
}

function passThroughValues(entity: Entity): string[] {
  switch (entity) {
    case 'teams': return ['--name', '--description', '--color'];
    case 'groups': return ['--name', '--description'];
    case 'roles': return ['--name', '--description'];
    case 'members': return ['--subject', '--display-name', '--email'];
  }
}
function passThroughMulti(entity: Entity): string[] {
  switch (entity) {
    case 'groups': return ['--role', '--member'];
    case 'roles': return ['--scope'];
    case 'members': return ['--role', '--team'];
    default: return [];
  }
}

/** Build the request body for a nested-entity create/update from flags. */
function entityBody(ctx: Ctx, entity: Entity, argv: string[], requireName: boolean): { body: Record<string, any>; ok: boolean } {
  const { options } = parseOptions(argv, { bool: ['--help', '--yes'], value: passThroughValues(entity), multi: passThroughMulti(entity) });
  const body: Record<string, any> = {};
  const setIf = (k: string, v: any) => { if (v !== undefined) body[k] = v; };
  switch (entity) {
    case 'teams':
      setIf('name', options.name); setIf('description', options.description); setIf('color', options.color);
      break;
    case 'roles':
      setIf('name', options.name); setIf('description', options.description);
      if (Array.isArray(options.scope) && options.scope.length) body.scopes = options.scope;
      break;
    case 'groups':
      setIf('name', options.name); setIf('description', options.description);
      if (Array.isArray(options.role) && options.role.length) body.roles = options.role;
      if (Array.isArray(options.member) && options.member.length) body.memberIds = options.member;
      break;
    case 'members':
      setIf('subject', options.subject); setIf('displayName', options.displayName); setIf('email', options.email);
      if (Array.isArray(options.role) && options.role.length) body.roles = options.role;
      if (Array.isArray(options.team) && options.team.length) body.teamIds = options.team;
      break;
  }
  if (requireName) {
    if (entity === 'members') {
      if (!body.subject || !body.displayName) { writeLine(ctx.io.stderr, 'members create requires --subject and --display-name.'); return { body, ok: false }; }
    } else if (!body.name) {
      writeLine(ctx.io.stderr, `${entity} create requires --name.`); return { body, ok: false };
    }
  } else if (Object.keys(body).length === 0) {
    writeLine(ctx.io.stderr, `Nothing to update — pass at least one field for ${entity}.`); return { body, ok: false };
  }
  return { body, ok: true };
}

function singular(entity: Entity): string {
  return entity === 'teams' ? 'team' : entity === 'groups' ? 'group' : entity === 'roles' ? 'role' : 'member';
}

function arrayOf(body: any, key: string): any[] {
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body[key])) return body[key];
  return [];
}
