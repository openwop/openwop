import type { Ctx } from '../context.js';
/** `openwop health` — probe /health + /readiness. */
import { requestJson } from '../api.js';
import { write, writeLine, writeJson } from '../io.js';
import { parseOptions } from '../options.js';

export const HEALTH_HELP = `Usage: openwop health [--base-url url] [--json]

Probes /health and /readiness on the configured host. Exit 0 when both respond; otherwise 1.
`;

export async function runHealth(ctx: Ctx, argv: string[]) {
  const { options } = parseOptions(argv, { bool: ['--help'] });
  if (options.help) {
    write(ctx.io.stdout, HEALTH_HELP);
    return 0;
  }
  const health = await requestJson(ctx, '/health', { auth: false });
  const readiness = await requestJson(ctx, '/readiness', { auth: false });
  const payload = { health: health.body, readiness: readiness.body };
  if (ctx.json) writeJson(ctx.io.stdout, payload);
  else {
    writeLine(ctx.io.stdout, `health: ${health.body.status ?? 'unknown'}`);
    writeLine(ctx.io.stdout, `readiness: ${readiness.body.status ?? 'unknown'}`);
  }
  return 0;
}
