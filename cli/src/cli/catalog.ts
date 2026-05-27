import type { Ctx } from '../context.js';
/** `openwop catalog ...` — list the host node catalog + installed packs. */
import { CliError } from '../errors.js';
import { write, writeLine, writeJson, formatTable } from '../io.js';
import { parseOptions } from '../options.js';
import { requestJson } from '../api.js';

export const CATALOG_HELP = `Usage:
  openwop catalog nodes [--search text] [--limit n] [--json]
  openwop catalog packs [--json]
`;

export async function runCatalog(ctx: Ctx, argv) {
  const sub = argv[0] ?? 'nodes';
  const args = argv.slice(sub === 'nodes' || sub === 'packs' ? 1 : 0);
  if (sub === '--help' || sub === '-h') {
    write(ctx.io.stdout, CATALOG_HELP);
    return 0;
  }
  switch (sub) {
    case 'nodes':
      return runCatalogNodes(ctx, args);
    case 'packs':
      return runCatalogPacks(ctx, args);
    default:
      throw new CliError(`Unknown catalog command: ${sub}`);
  }
}

async function runCatalogNodes(ctx: Ctx, argv) {
  const { options } = parseOptions(argv, {
    bool: ['--help'],
    value: ['--limit', '--search'],
  });
  if (options.help) {
    write(ctx.io.stdout, CATALOG_HELP);
    return 0;
  }
  const res = await requestJson(ctx, '/v1/host/sample/node-catalog');
  let nodes = Array.isArray(res.body.nodes) ? res.body.nodes : [];
  if (options.search) {
    const q = String(options.search).toLowerCase();
    nodes = nodes.filter((n) => String(n.typeId ?? '').toLowerCase().includes(q) || String(n.label ?? '').toLowerCase().includes(q));
  }
  const limit = Number(options.limit ?? 30);
  if (ctx.json) {
    writeJson(ctx.io.stdout, { nodes });
    return 0;
  }
  const rows = nodes.slice(0, limit).map((n) => ({
    typeId: n.typeId,
    source: n.source,
    category: n.category,
    runnable: Array.isArray(n.missingHostSurfaces) && n.missingHostSurfaces.length > 0 ? 'no' : 'yes',
  }));
  writeLine(ctx.io.stdout, formatTable(rows, ['typeId', 'source', 'category', 'runnable']));
  if (nodes.length > rows.length) writeLine(ctx.io.stdout, `... ${nodes.length - rows.length} more. Use --limit ${nodes.length} or --json.`);
  return 0;
}

async function runCatalogPacks(ctx: Ctx, argv = []) {
  const { options } = parseOptions(argv, { bool: ['--help'] });
  if (options.help) {
    write(ctx.io.stdout, CATALOG_HELP);
    return 0;
  }
  const res = await requestJson(ctx, '/v1/packs', { auth: false });
  if (ctx.json) {
    writeJson(ctx.io.stdout, res.body);
    return 0;
  }
  const rows = (res.body.packs ?? []).map((p) => ({ name: p.name, nodes: Array.isArray(p.nodes) ? p.nodes.length : 0 }));
  writeLine(ctx.io.stdout, formatTable(rows, ['name', 'nodes']));
  return 0;
}
