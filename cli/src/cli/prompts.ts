/** `openwop prompts ...` — prompt-library list/get/render (RFC 0029). */

import { requestJson } from '../api.js';
import { CliError } from '../errors.js';
import { write, writeLine, writeJson, formatTable } from '../io.js';
import { parseOptions } from '../options.js';

export const PROMPTS_HELP = `Usage:
  openwop prompts list [--kind k] [--tag t] [--limit n] [--json]
  openwop prompts get <templateId> [--json]
  openwop prompts render <ref> [--variables-json '{...}'] [--json]

Browse + render the host's prompt library (RFC 0029, /v1/prompts). \`render\`
resolves a PromptRef (templateId[@version]) against the supplied variables.
`;

export async function runPrompts(ctx: any, argv: string[]): Promise<number> {
  const sub = argv[0] ?? 'list';
  if (sub === '--help' || sub === '-h') { write(ctx.io.stdout, PROMPTS_HELP); return 0; }
  const rest = argv.slice(1);
  switch (sub) {
    case 'list': {
      const { options } = parseOptions(rest, { value: ['--kind', '--tag', '--limit'] });
      const q = new URLSearchParams();
      if (options.kind) q.set('kind', options.kind);
      if (options.tag) q.set('tag', options.tag);
      if (options.limit) q.set('limit', options.limit);
      const res = await requestJson(ctx, `/v1/prompts${q.toString() ? `?${q}` : ''}`);
      if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
      const items = Array.isArray(res.body?.items) ? res.body.items : [];
      if (items.length === 0) { writeLine(ctx.io.stdout, 'No prompt templates.'); return 0; }
      writeLine(ctx.io.stdout, formatTable(
        items.map((t: any) => ({ templateId: t.templateId, kind: t.kind ?? '', modelClass: t.modelClass ?? '', source: t.source ?? '' })),
        ['templateId', 'kind', 'modelClass', 'source'],
      ));
      return 0;
    }
    case 'get': {
      if (rest.length !== 1) { write(ctx.io.stdout, 'Usage: openwop prompts get <templateId> [--json]\n'); return 2; }
      const res = await requestJson(ctx, `/v1/prompts/${encodeURIComponent(rest[0])}`);
      writeJson(ctx.io.stdout, res.body);
      return 0;
    }
    case 'render': {
      const { options, positionals } = parseOptions(rest, { value: ['--variables-json'] });
      if (positionals.length !== 1) { write(ctx.io.stdout, "Usage: openwop prompts render <ref> [--variables-json '{...}'] [--json]\n"); return 2; }
      let variables = {};
      if (options.variablesJson) {
        try { variables = JSON.parse(options.variablesJson); } catch { throw new CliError('--variables-json must be valid JSON.'); }
      }
      const res = await requestJson(ctx, '/v1/prompts:render', { method: 'POST', body: { ref: positionals[0], variables } });
      writeJson(ctx.io.stdout, res.body);
      return 0;
    }
    default:
      throw new CliError(`Unknown prompts command: ${sub}\nRun \`openwop prompts --help\` for usage.`);
  }
}
