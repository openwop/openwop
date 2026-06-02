import type { Ctx } from '../context.js';
/** `openwop workspace ...` — per-tenant agent workspace files (RFC 0059 §C). */
import { CliError } from '../errors.js';
import { readFile } from 'node:fs/promises';
import { write, writeLine, writeJson, formatTable } from '../io.js';
import { parseOptions } from '../options.js';
import { requestJson } from '../api.js';

export const WORKSPACE_HELP = `Usage:
  openwop workspace list [--prefix <p>] [--json]
  openwop workspace get <path> [--json]
  openwop workspace put <path> (--content <text> | --file <localPath>) [--content-type <ct>] [--if-match <etag>] [--json]
  openwop workspace delete <path> [--yes]

Agent workspace (RFC 0059 §C). A tenant-scoped file area an agent reads and
writes during a run, with optimistic concurrency via ETag / If-Match (WCT-1
cross-owner isolation is enforced host-side). Drives the real CRUD surface
GET/PUT/DELETE /v1/host/workspace/files. (The /v1/host/sample/workspace/op
cross-owner seam is a conformance-only test seam and is intentionally not
exposed here.)

  --prefix <p>      (list) Only files whose path starts with this prefix.
  --content <text>  (put) Inline file content.
  --file <path>     (put) Read content from a local file instead of --content.
  --content-type    (put) MIME type to store.
  --if-match <etag> (put) Only write if the current ETag matches (optimistic lock).

Examples:
  openwop workspace list
  openwop workspace put notes/todo.md --content "- ship it"
  openwop workspace get notes/todo.md
  openwop workspace delete notes/todo.md --yes
`;

export async function runWorkspace(ctx: Ctx, argv: string[]) {
  const sub = argv[0] ?? 'list';
  if (sub === '--help' || sub === '-h') { write(ctx.io.stdout, WORKSPACE_HELP); return 0; }
  const args = argv.slice(['list', 'get', 'put', 'delete'].includes(sub) ? 1 : 0);
  switch (sub) {
    case 'list': return await wsList(ctx, args);
    case 'get': return await wsGet(ctx, args);
    case 'put': return await wsPut(ctx, args);
    case 'delete': return await wsDelete(ctx, args);
    default:
      throw new CliError(`Unknown workspace command: ${sub}\nRun \`openwop workspace --help\` for usage.`);
  }
}

async function wsList(ctx: Ctx, argv: string[]) {
  const { options } = parseOptions(argv, { bool: ['--help'], value: ['--prefix'] });
  if (options.help) { write(ctx.io.stdout, WORKSPACE_HELP); return 0; }
  const q = options.prefix ? `?prefix=${encodeURIComponent(options.prefix)}` : '';
  const res = await requestJson(ctx, `/v1/host/workspace/files${q}`);
  if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
  const files = Array.isArray(res.body?.files) ? res.body.files : [];
  if (files.length === 0) { writeLine(ctx.io.stdout, 'No files in the workspace.'); return 0; }
  writeLine(ctx.io.stdout, formatTable(files.map((f: any) => ({
    path: f.path ?? f.name ?? '',
    size: f.size ?? (typeof f.content === 'string' ? String(f.content.length) : ''),
    contentType: f.contentType ?? '',
    etag: f.etag ?? '',
  })), ['path', 'size', 'contentType', 'etag']));
  return 0;
}

async function wsGet(ctx: Ctx, argv: string[]) {
  const { options, positionals } = parseOptions(argv, { bool: ['--help'] });
  if (options.help || positionals.length !== 1) { write(ctx.io.stdout, 'Usage: openwop workspace get <path> [--json]\n'); return options.help ? 0 : 2; }
  const res = await requestJson(ctx, `/v1/host/workspace/files/${encodeURIComponent(positionals[0])}`);
  if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
  const f = res.body ?? {};
  if (f.etag) writeLine(ctx.io.stderr, `# etag: ${f.etag}${f.contentType ? `  contentType: ${f.contentType}` : ''}`);
  write(ctx.io.stdout, typeof f.content === 'string' ? f.content : JSON.stringify(f, null, 2));
  if (typeof f.content === 'string' && !f.content.endsWith('\n')) write(ctx.io.stdout, '\n');
  return 0;
}

async function wsPut(ctx: Ctx, argv: string[]) {
  const { options, positionals } = parseOptions(argv, { bool: ['--help'], value: ['--content', '--file', '--content-type', '--if-match'] });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop workspace put <path> (--content <text> | --file <localPath>) [--content-type <ct>] [--if-match <etag>] [--json]\n');
    return options.help ? 0 : 2;
  }
  let content: string;
  if (options.file !== undefined) {
    try { content = await readFile(options.file, 'utf8'); }
    catch (err) { throw new CliError(`Could not read ${options.file}: ${err instanceof Error ? err.message : String(err)}`, 2); }
  } else if (options.content !== undefined) {
    content = options.content;
  } else {
    throw new CliError('Pass either --content <text> or --file <localPath>.', 2);
  }
  const body: Record<string, any> = { content };
  if (options.contentType) body.contentType = options.contentType;
  const headers: Record<string, string> = {};
  if (options.ifMatch) headers['if-match'] = options.ifMatch;
  const res = await requestJson(ctx, `/v1/host/workspace/files/${encodeURIComponent(positionals[0])}`, { method: 'PUT', body, headers });
  if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
  writeLine(ctx.io.stdout, `Wrote ${positionals[0]}${res.body?.etag ? ` (etag ${res.body.etag})` : ''}.`);
  return 0;
}

async function wsDelete(ctx: Ctx, argv: string[]) {
  const { options, positionals } = parseOptions(argv, { bool: ['--help', '--yes'] });
  if (options.help || positionals.length !== 1) { write(ctx.io.stdout, 'Usage: openwop workspace delete <path> [--yes]\n'); return options.help ? 0 : 2; }
  if (!options.yes) { writeLine(ctx.io.stderr, `Refusing to delete ${positionals[0]} without --yes.`); return 2; }
  await requestJson(ctx, `/v1/host/workspace/files/${encodeURIComponent(positionals[0])}`, { method: 'DELETE' });
  writeLine(ctx.io.stdout, `Deleted ${positionals[0]}.`);
  return 0;
}
