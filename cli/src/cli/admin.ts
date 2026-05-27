import type { Ctx } from '../context.js';
/** `openwop admin ...` — operator maintenance (ephemeral-secret cleanup). */
import { CliError } from '../errors.js';
import { write, writeLine, writeJson } from '../io.js';
import { parseOptions } from '../options.js';
import { requestJson } from '../api.js';
import { promptYesNo } from '../prompt.js';

export const ADMIN_HELP = `Usage:
  openwop admin cleanup [--confirm] [--json]
  openwop admin cleanup --status [--json]

Operator maintenance for the demo host. \`cleanup\` POSTs to
/v1/host/sample/admin/cleanup, wiping ephemeral secrets for tenants idle past
the cleanup window; \`--status\` is a read-only liveness probe. Admin-token
gated — pass the host's OPENWOP_ADMIN_TOKEN via --api-key. Without --confirm
the destructive POST asks for confirmation.
`;

export async function runAdmin(ctx: Ctx, argv) {
  const sub = argv[0];
  if (!sub || sub === '--help' || sub === '-h') {
    write(ctx.io.stdout, ADMIN_HELP);
    return sub ? 0 : 2;
  }
  if (sub !== 'cleanup') throw new CliError(`Unknown admin command: ${sub}\nRun \`openwop admin --help\` for usage.`);

  const { options } = parseOptions(argv.slice(1), { bool: ['--status', '--confirm', '--yes'] });
  if (options.status) {
    const res = await requestJson(ctx, '/v1/host/sample/admin/cleanup/status');
    if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
    const oldest = res.body.oldestActivityMs == null ? 'n/a' : `${Math.round(res.body.oldestActivityMs / 1000)}s ago`;
    writeLine(ctx.io.stdout, `trackedTenants=${res.body.trackedTenants} oldestActivity=${oldest}`);
    return 0;
  }
  // The POST wipes expired ephemeral secrets for inactive tenants — confirm.
  if (!options.confirm && !options.yes) {
    const ok = await promptYesNo(ctx, 'Run cleanup now? This wipes ephemeral secrets for tenants idle past the window.', false);
    if (!ok) { writeLine(ctx.io.stdout, 'Aborted.'); return 1; }
  }
  const res = await requestJson(ctx, '/v1/host/sample/admin/cleanup', { method: 'POST', body: {} });
  if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
  writeLine(ctx.io.stdout, `✓ Cleanup ran — activeTenants=${res.body.activeTenants} wipedSecrets=${res.body.wipedSecrets} window=${Math.round((res.body.windowMs ?? 0) / 3_600_000)}h`);
  return 0;
}
