import type { Ctx } from '../context.js';
/** `openwop memory ...` — demo MemoryAdapter list/search/get/delete. */
import { requestJson } from '../api.js';
import { CliError } from '../errors.js';
import { write, writeLine, writeJson, formatTable } from '../io.js';
import { parseOptions } from '../options.js';

export const MEMORY_HELP = `Usage:
  openwop memory list [--memory-ref ref] [--tag t] [--limit n] [--json]
  openwop memory search <text> [--query text] [--tag t] [--memory-ref ref] [--limit n] [--json]
  openwop memory get <memoryId> [--memory-ref ref] [--json]
  openwop memory delete <memoryId> [--memory-ref ref] [--json]

Reads the demo MemoryAdapter ledger (RFC 0004) via the host-extension routes
under /v1/host/sample/memory. Every read and delete is tenant-scoped to the
caller's API key on the host (CTI-1) — the CLI never sends a tenantId and cannot
cross tenant boundaries. Select the tenant with --api-key / OPENWOP_API_KEY.

  --memory-ref ref   The agent-derived memoryRef (default: the demo's tenant-memory).
  --tag t            Server-side tag filter (also matched by \`search\`).
  --query / <text>   Free-text filter applied client-side over content + tags.
  --limit n          Cap the number of entries the host returns.
`;

export async function runMemory(ctx: Ctx, argv) {
  const sub = argv[0] ?? 'list';
  const args = argv.slice(['list', 'search', 'get', 'delete', 'rm'].includes(sub) ? 1 : 0);
  if (sub === '--help' || sub === '-h') {
    write(ctx.io.stdout, MEMORY_HELP);
    return 0;
  }
  switch (sub) {
    case 'list':
      return runMemoryList(ctx, args);
    case 'search':
      return runMemorySearch(ctx, args);
    case 'get':
      return runMemoryGet(ctx, args);
    case 'delete':
    case 'rm':
      return runMemoryDelete(ctx, args);
    default:
      throw new CliError(`Unknown memory command: ${sub}\nRun \`openwop memory --help\` for usage.`);
  }
}

function memoryQuery(options) {
  const query = new URLSearchParams();
  if (options.memoryRef) query.set('memoryRef', options.memoryRef);
  if (options.tag) query.set('tag', options.tag);
  if (options.limit) query.set('limit', options.limit);
  return query;
}

function memoryRows(entries) {
  return entries.map((e) => ({
    id: e.id,
    createdAt: e.createdAt ?? '',
    tags: Array.isArray(e.tags) ? e.tags.join(',') : '',
    content: truncate(String(e.content ?? ''), 60),
  }));
}

function truncate(text, max) {
  const oneLine = text.replace(/\s+/g, ' ');
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

async function runMemoryList(ctx: Ctx, argv) {
  const { options } = parseOptions(argv, {
    bool: ['--help'],
    value: ['--memory-ref', '--tag', '--limit'],
  });
  if (options.help) {
    write(ctx.io.stdout, MEMORY_HELP);
    return 0;
  }
  const query = memoryQuery(options);
  const path = `/v1/host/sample/memory${query.size ? `?${query.toString()}` : ''}`;
  const res = await requestJson(ctx, path);
  if (ctx.json) {
    writeJson(ctx.io.stdout, res.body);
    return 0;
  }
  const entries = Array.isArray(res.body?.entries) ? res.body.entries : [];
  writeLine(ctx.io.stdout, `memoryRef: ${res.body?.memoryRef ?? '(default)'}`);
  writeLine(ctx.io.stdout, entries.length
    ? formatTable(memoryRows(entries), ['id', 'createdAt', 'tags', 'content'])
    : 'No memory entries.');
  return 0;
}

async function runMemorySearch(ctx: Ctx, argv) {
  const { options, positionals } = parseOptions(argv, {
    bool: ['--help'],
    value: ['--memory-ref', '--tag', '--limit', '--query'],
  });
  if (options.help) {
    write(ctx.io.stdout, MEMORY_HELP);
    return 0;
  }
  const term = String(options.query ?? positionals[0] ?? '').toLowerCase();
  if (!term && !options.tag) {
    write(ctx.io.stdout, 'Usage: openwop memory search <text> [--tag t] [--memory-ref ref] [--limit n] [--json]\n');
    return 2;
  }
  // The host route filters by tag server-side; free-text search is client-side
  // over the tenant-scoped result set (the route returns no full-text index).
  const query = memoryQuery(options);
  const path = `/v1/host/sample/memory${query.size ? `?${query.toString()}` : ''}`;
  const res = await requestJson(ctx, path);
  let entries = Array.isArray(res.body?.entries) ? res.body.entries : [];
  if (term) {
    entries = entries.filter((e) =>
      String(e.content ?? '').toLowerCase().includes(term)
      || (Array.isArray(e.tags) && e.tags.some((t) => String(t).toLowerCase().includes(term))));
  }
  if (ctx.json) {
    writeJson(ctx.io.stdout, { memoryRef: res.body?.memoryRef, entries });
    return 0;
  }
  writeLine(ctx.io.stdout, `memoryRef: ${res.body?.memoryRef ?? '(default)'}`);
  writeLine(ctx.io.stdout, entries.length
    ? formatTable(memoryRows(entries), ['id', 'createdAt', 'tags', 'content'])
    : 'No matching memory entries.');
  return 0;
}

async function runMemoryGet(ctx: Ctx, argv) {
  const { options, positionals } = parseOptions(argv, {
    bool: ['--help'],
    value: ['--memory-ref'],
  });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop memory get <memoryId> [--memory-ref ref] [--json]\n');
    return options.help ? 0 : 2;
  }
  const query = options.memoryRef ? `?memoryRef=${encodeURIComponent(options.memoryRef)}` : '';
  const res = await requestJson(ctx, `/v1/host/sample/memory/${encodeURIComponent(positionals[0])}${query}`);
  if (ctx.json) {
    writeJson(ctx.io.stdout, res.body);
    return 0;
  }
  const entry = res.body?.entry ?? {};
  writeLine(ctx.io.stdout, `memoryRef: ${res.body?.memoryRef ?? '(default)'}`);
  writeLine(ctx.io.stdout, `id: ${entry.id ?? positionals[0]}`);
  writeLine(ctx.io.stdout, `createdAt: ${entry.createdAt ?? ''}`);
  if (entry.expiresAt) writeLine(ctx.io.stdout, `expiresAt: ${entry.expiresAt}`);
  writeLine(ctx.io.stdout, `tags: ${Array.isArray(entry.tags) ? entry.tags.join(', ') : ''}`);
  writeLine(ctx.io.stdout, `content: ${entry.content ?? ''}`);
  return 0;
}

async function runMemoryDelete(ctx: Ctx, argv) {
  const { options, positionals } = parseOptions(argv, {
    bool: ['--help'],
    value: ['--memory-ref'],
  });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop memory delete <memoryId> [--memory-ref ref] [--json]\n');
    return options.help ? 0 : 2;
  }
  const query = options.memoryRef ? `?memoryRef=${encodeURIComponent(options.memoryRef)}` : '';
  const res = await requestJson(ctx, `/v1/host/sample/memory/${encodeURIComponent(positionals[0])}${query}`, { method: 'DELETE' });
  if (ctx.json) {
    writeJson(ctx.io.stdout, res.body);
    return 0;
  }
  writeLine(ctx.io.stdout, `${res.body?.removed ? 'Deleted' : 'No matching entry'}: ${res.body?.memoryId ?? positionals[0]}`);
  return 0;
}

