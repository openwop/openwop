import type { Ctx } from '../context.js';
/** `openwop conformance ...` — run the in-repo @openwop/openwop-conformance CLI. */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { write } from '../io.js';
import { parseOptions } from '../options.js';
import { requireRepoRoot } from '../repo.js';
import { DEFAULT_API_KEY } from '../constants.js';
import { npmCommand } from './shared.js';

export const CONFORMANCE_HELP = `Usage: openwop conformance [--offline] [--filter pattern]

Runs the in-repo @openwop/openwop-conformance CLI. Without --offline it targets the configured --base-url.
`;

export async function runConformance(ctx: Ctx, argv: string[]) {
  const { options } = parseOptions(argv, {
    bool: ['--help', '--offline'],
    value: ['--filter'],
  });
  if (options.help) {
    write(ctx.io.stdout, CONFORMANCE_HELP);
    return 0;
  }
  const root = requireRepoRoot(ctx);
  const args = ['run', 'cli', '--'];
  if (options.offline) {
    args.push('--offline');
  } else {
    args.push('--base-url', ctx.baseUrl, '--api-key', ctx.apiKey ?? DEFAULT_API_KEY);
  }
  if (options.filter) args.push('--filter', options.filter);
  const result = spawnSync(npmCommand(), args, {
    cwd: join(root, 'conformance'),
    stdio: 'inherit',
    env: ctx.env,
  });
  return result.status ?? 1;
}
