import type { Ctx } from '../context.js';
/** `openwop account ...` — tenant self-service hard-delete. */
import { CliError } from '../errors.js';
import { write, writeLine, writeJson } from '../io.js';
import { parseOptions } from '../options.js';
import { requestJson } from '../api.js';
import { promptYesNo } from '../prompt.js';

export const ACCOUNT_HELP = `Usage:
  openwop account delete [--confirm] [--json]

Permanently delete ALL data for the signed-in account (DELETE
/v1/host/sample/account). Requires a signed-in user (OIDC Bearer) — the host
rejects non-user principals. This is irreversible: tenant rows are wiped and
the KMS-wrapped DEKs become unrecoverable. Without --confirm you'll be asked
to confirm interactively.
`;

export async function runAccount(ctx: Ctx, argv: string[]) {
  const sub = argv[0];
  if (!sub || sub === '--help' || sub === '-h') {
    write(ctx.io.stdout, ACCOUNT_HELP);
    return sub ? 0 : 2;
  }
  if (sub !== 'delete') throw new CliError(`Unknown account command: ${sub}\nRun \`openwop account --help\` for usage.`);

  const { options } = parseOptions(argv.slice(1), { bool: ['--confirm', '--yes'] });
  // Destructive + irreversible: wipes ALL data for the signed-in tenant and
  // orphans the KMS-wrapped DEKs. Require an explicit confirmation.
  if (!options.confirm && !options.yes) {
    const ok = await promptYesNo(ctx, 'Permanently delete ALL data for the signed-in account? This cannot be undone.', false);
    if (!ok) { writeLine(ctx.io.stdout, 'Aborted.'); return 1; }
  }
  const res = await requestJson(ctx, '/v1/host/sample/account', { method: 'DELETE' });
  if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
  const counts = Object.entries(res.body).filter(([k]) => k !== 'deleted').map(([k, v]) => `${k}=${v}`).join(' ');
  writeLine(ctx.io.stdout, `✓ Account deleted${counts ? ` (${counts})` : ''}`);
  return 0;
}
