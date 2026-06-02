import type { Ctx } from '../context.js';
/** `openwop kanban ...` — agent task boards (host-extension; composes RFC 0086 roster triggers). */
import { CliError } from '../errors.js';
import { write, writeLine, writeJson, formatTable } from '../io.js';
import { parseOptions } from '../options.js';
import { requestJson } from '../api.js';
import { consumeSse } from '../sse.js';

export const KANBAN_HELP = `Usage:
  openwop kanban boards [--json]
  openwop kanban board <boardId> [--json]
  openwop kanban board-create --name <name> [--column <id:Label>]... [--trigger-workflow <id>] [--roster <rosterId>] [--json]
  openwop kanban board-delete <boardId> [--yes]
  openwop kanban card-add <boardId> --title <text> [--column <columnId>] [--description <text>] [--workflow <id>] [--priority <p>] [--json]
  openwop kanban card-move <cardId> --column <columnId> [--json]
  openwop kanban card-update <cardId> [--title <text>] [--description <text>] [--column <columnId>] [--workflow <id>] [--json]
  openwop kanban card-delete <cardId> [--yes]
  openwop kanban watch <boardId>

Kanban boards (host-extension under /v1/host/sample/kanban). A board is a lane
of cards an agent works; a board MAY bind to an RFC 0086 roster entry so its
To Do column fires the named agent's first portfolio workflow. 'watch' streams
the board's server-sent card events until interrupted.

  --column <id:Label>  (board-create) A column, repeatable; default lanes if omitted.
  --trigger-workflow   (board-create) Workflow the To Do column fires.
  --roster <rosterId>  (board-create) Bind the board to a roster entry (RFC 0086).
  --priority <p>       (card-add) low | normal | high | urgent.

Examples:
  openwop kanban boards
  openwop kanban board-create --name "Sally's work" --roster r_123
  openwop kanban card-add b_1 --title "Triage inbox" --column todo
  openwop kanban card-move c_9 --column working
  openwop kanban watch b_1
`;

export async function runKanban(ctx: Ctx, argv: string[]) {
  const sub = argv[0] ?? 'boards';
  if (sub === '--help' || sub === '-h') { write(ctx.io.stdout, KANBAN_HELP); return 0; }
  const known = ['boards', 'board', 'board-create', 'board-delete', 'card-add', 'card-move', 'card-update', 'card-delete', 'watch'];
  const args = argv.slice(known.includes(sub) ? 1 : 0);
  switch (sub) {
    case 'boards': return await boardsList(ctx, args);
    case 'board': return await boardGet(ctx, args);
    case 'board-create': return await boardCreate(ctx, args);
    case 'board-delete': return await boardDelete(ctx, args);
    case 'card-add': return await cardAdd(ctx, args);
    case 'card-move': return await cardPatch(ctx, args, true);
    case 'card-update': return await cardPatch(ctx, args, false);
    case 'card-delete': return await cardDelete(ctx, args);
    case 'watch': return await boardWatch(ctx, args);
    default:
      throw new CliError(`Unknown kanban command: ${sub}\nRun \`openwop kanban --help\` for usage.`);
  }
}

async function boardsList(ctx: Ctx, argv: string[]) {
  const { options } = parseOptions(argv, { bool: ['--help'] });
  if (options.help) { write(ctx.io.stdout, KANBAN_HELP); return 0; }
  const res = await requestJson(ctx, '/v1/host/sample/kanban/boards');
  if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
  const boards = Array.isArray(res.body?.boards) ? res.body.boards : (Array.isArray(res.body) ? res.body : []);
  if (boards.length === 0) {
    writeLine(ctx.io.stdout, 'No boards on this host. Create one with `openwop kanban board-create --name <name>`.');
    return 0;
  }
  writeLine(ctx.io.stdout, formatTable(boards.map((b: any) => ({
    boardId: b.id ?? b.boardId,
    name: b.name ?? '',
    columns: Array.isArray(b.columns) ? String(b.columns.length) : '0',
    roster: b.rosterId ?? '',
  })), ['boardId', 'name', 'columns', 'roster']));
  return 0;
}

async function boardGet(ctx: Ctx, argv: string[]) {
  const { options, positionals } = parseOptions(argv, { bool: ['--help'] });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop kanban board <boardId> [--json]\n');
    return options.help ? 0 : 2;
  }
  const res = await requestJson(ctx, `/v1/host/sample/kanban/boards/${encodeURIComponent(positionals[0])}`);
  if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
  const b = res.body ?? {};
  writeLine(ctx.io.stdout, `board: ${b.id ?? positionals[0]} — ${b.name ?? ''}`);
  if (b.rosterId) writeLine(ctx.io.stdout, `roster: ${b.rosterId}`);
  const columns = Array.isArray(b.columns) ? b.columns : [];
  const cards = Array.isArray(b.cards) ? b.cards : [];
  for (const col of columns) {
    const inCol = cards.filter((c: any) => c.columnId === col.id);
    writeLine(ctx.io.stdout, `\n[${col.name ?? col.id}] (${inCol.length})`);
    for (const c of inCol) writeLine(ctx.io.stdout, `  · ${c.id}  ${c.title}`);
  }
  return 0;
}

async function boardCreate(ctx: Ctx, argv: string[]) {
  const { options } = parseOptions(argv, {
    bool: ['--help'],
    value: ['--name', '--trigger-workflow', '--roster'],
    multi: ['--column'],
  });
  if (options.help || !options.name) {
    write(ctx.io.stdout, 'Usage: openwop kanban board-create --name <name> [--column <id:Label>]... [--trigger-workflow <id>] [--roster <rosterId>] [--json]\n');
    return options.help ? 0 : 2;
  }
  const body: Record<string, any> = { name: options.name };
  if (Array.isArray(options.column) && options.column.length) {
    body.columns = options.column.map((spec: string) => {
      const [id, ...rest] = spec.split(':');
      return { id, name: rest.length ? rest.join(':') : id };
    });
  }
  if (options.triggerWorkflow) body.triggerWorkflowId = options.triggerWorkflow;
  if (options.roster) body.rosterId = options.roster;
  const res = await requestJson(ctx, '/v1/host/sample/kanban/boards', { method: 'POST', body });
  if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
  writeLine(ctx.io.stdout, `Created board ${res.body?.id ?? res.body?.boardId} (${res.body?.name}).`);
  return 0;
}

async function boardDelete(ctx: Ctx, argv: string[]) {
  const { options, positionals } = parseOptions(argv, { bool: ['--help', '--yes'] });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop kanban board-delete <boardId> [--yes]\n');
    return options.help ? 0 : 2;
  }
  if (!options.yes) {
    writeLine(ctx.io.stderr, `Refusing to delete board ${positionals[0]} without --yes (this removes the board and its cards).`);
    return 2;
  }
  await requestJson(ctx, `/v1/host/sample/kanban/boards/${encodeURIComponent(positionals[0])}`, { method: 'DELETE' });
  writeLine(ctx.io.stdout, `Deleted board ${positionals[0]}.`);
  return 0;
}

async function cardAdd(ctx: Ctx, argv: string[]) {
  const { options, positionals } = parseOptions(argv, {
    bool: ['--help'],
    value: ['--title', '--column', '--description', '--workflow', '--priority'],
  });
  if (options.help || positionals.length !== 1 || !options.title) {
    write(ctx.io.stdout, 'Usage: openwop kanban card-add <boardId> --title <text> [--column <columnId>] [--description <text>] [--workflow <id>] [--priority <p>] [--json]\n');
    return options.help ? 0 : 2;
  }
  const body: Record<string, any> = { title: options.title };
  if (options.column) body.columnId = options.column;
  if (options.description) body.description = options.description;
  if (options.workflow) body.workflowId = options.workflow;
  if (options.priority) body.priority = options.priority;
  const res = await requestJson(ctx, `/v1/host/sample/kanban/boards/${encodeURIComponent(positionals[0])}/cards`, { method: 'POST', body });
  if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
  writeLine(ctx.io.stdout, `Added card ${res.body?.id ?? ''} to board ${positionals[0]}.`);
  return 0;
}

async function cardPatch(ctx: Ctx, argv: string[], moveOnly: boolean) {
  const { options, positionals } = parseOptions(argv, {
    bool: ['--help'],
    value: ['--title', '--description', '--column', '--workflow'],
  });
  const usage = moveOnly
    ? 'Usage: openwop kanban card-move <cardId> --column <columnId> [--json]\n'
    : 'Usage: openwop kanban card-update <cardId> [--title <t>] [--description <t>] [--column <columnId>] [--workflow <id>] [--json]\n';
  if (options.help || positionals.length !== 1 || (moveOnly && !options.column)) {
    write(ctx.io.stdout, usage);
    return options.help ? 0 : 2;
  }
  const body: Record<string, any> = {};
  if (options.column) body.columnId = options.column;
  if (!moveOnly) {
    if (options.title) body.title = options.title;
    if (options.description) body.description = options.description;
    if (options.workflow) body.workflowId = options.workflow;
  }
  if (Object.keys(body).length === 0) throw new CliError('Nothing to update — pass at least one field.', 2);
  const res = await requestJson(ctx, `/v1/host/sample/kanban/cards/${encodeURIComponent(positionals[0])}`, { method: 'PATCH', body });
  if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
  writeLine(ctx.io.stdout, `Updated card ${positionals[0]}.`);
  return 0;
}

async function cardDelete(ctx: Ctx, argv: string[]) {
  const { options, positionals } = parseOptions(argv, { bool: ['--help', '--yes'] });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop kanban card-delete <cardId> [--yes]\n');
    return options.help ? 0 : 2;
  }
  if (!options.yes) {
    writeLine(ctx.io.stderr, `Refusing to delete card ${positionals[0]} without --yes.`);
    return 2;
  }
  await requestJson(ctx, `/v1/host/sample/kanban/cards/${encodeURIComponent(positionals[0])}`, { method: 'DELETE' });
  writeLine(ctx.io.stdout, `Deleted card ${positionals[0]}.`);
  return 0;
}

async function boardWatch(ctx: Ctx, argv: string[]) {
  const { options, positionals } = parseOptions(argv, { bool: ['--help'] });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop kanban watch <boardId>\n');
    return options.help ? 0 : 2;
  }
  const url = new URL(`v1/host/sample/kanban/boards/${encodeURIComponent(positionals[0])}/events`, ctx.baseUrl.endsWith('/') ? ctx.baseUrl : `${ctx.baseUrl}/`);
  const headers: Record<string, string> = { accept: 'text/event-stream' };
  if (ctx.apiKey) headers.authorization = `Bearer ${ctx.apiKey}`;
  const res = await ctx.fetchImpl(url, { headers });
  if (!res.ok || !res.body) {
    throw new CliError(`Could not open the board event stream (HTTP ${res.status}).`, 1);
  }
  writeLine(ctx.io.stdout, `Watching board ${positionals[0]} (Ctrl-C to stop)…`);
  await consumeSse(res.body, (frame: { event?: string; data?: string }) => {
    if (ctx.json) { writeLine(ctx.io.stdout, JSON.stringify(frame)); return; }
    const type = frame.event ?? 'message';
    writeLine(ctx.io.stdout, `· ${type}${frame.data ? `: ${frame.data}` : ''}`);
  });
  return 0;
}
