import type { Ctx } from '../context.js';
/** `openwop byok ...` — host-side BYOK secret store; the wire never returns values. */
import { CliError } from '../errors.js';
import { write, writeLine, writeJson, formatTable } from '../io.js';
import { parseOptions } from '../options.js';
import { requestJson } from '../api.js';
import { readSecret } from '../prompt.js';

export const BYOK_HELP = `Usage:
  openwop byok list [--json]
  openwop byok set --ref <credentialRef> [--value <secret>] [--json]
  openwop byok delete <credentialRef> [--yes]

Bring-your-own-key secret store (host-side). The host holds the secret; the
credential-payload-redaction invariant (RFC 0046) means a value is NEVER
returned over the wire — 'list' shows only refs, and 'set' echoes only a
masked preview. Drives /v1/host/sample/byok/secrets. If --value is omitted,
'set' prompts for it without echoing to the terminal.

  --ref <credentialRef>  Opaque ref a workflow/pack uses to fetch the secret
                         (matches [a-zA-Z0-9_.:-]{1,128}).
  --value <secret>       The secret material. Prefer the interactive prompt
                         (omit this flag) so the secret never lands in shell history.

Examples:
  openwop byok list
  openwop byok set --ref anthropic-prod          # prompts for the value
  openwop byok delete anthropic-prod --yes
`;

export async function runByok(ctx: Ctx, argv: string[]) {
  const sub = argv[0] ?? 'list';
  if (sub === '--help' || sub === '-h') { write(ctx.io.stdout, BYOK_HELP); return 0; }
  const args = argv.slice(['list', 'set', 'delete'].includes(sub) ? 1 : 0);
  switch (sub) {
    case 'list': return await byokList(ctx, args);
    case 'set': return await byokSet(ctx, args);
    case 'delete': return await byokDelete(ctx, args);
    default:
      throw new CliError(`Unknown byok command: ${sub}\nRun \`openwop byok --help\` for usage.`);
  }
}

async function byokList(ctx: Ctx, argv: string[]) {
  const { options } = parseOptions(argv, { bool: ['--help'] });
  if (options.help) { write(ctx.io.stdout, BYOK_HELP); return 0; }
  const res = await requestJson(ctx, '/v1/host/sample/byok/secrets');
  if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
  const refs = Array.isArray(res.body?.credentialRefs) ? res.body.credentialRefs : [];
  if (refs.length === 0) { writeLine(ctx.io.stdout, 'No BYOK secrets stored. Add one with `openwop byok set --ref <name>`.'); return 0; }
  // Refs may be plain strings or {credentialRef, masked, createdAt} objects.
  const rows = refs.map((r: any) => typeof r === 'string'
    ? { credentialRef: r, masked: '', createdAt: '' }
    : { credentialRef: r.credentialRef ?? '', masked: r.masked ?? '', createdAt: r.createdAt ?? '' });
  writeLine(ctx.io.stdout, formatTable(rows, ['credentialRef', 'masked', 'createdAt']));
  return 0;
}

async function byokSet(ctx: Ctx, argv: string[]) {
  const { options } = parseOptions(argv, { bool: ['--help'], value: ['--ref', '--value'] });
  if (options.help || !options.ref) {
    write(ctx.io.stdout, 'Usage: openwop byok set --ref <credentialRef> [--value <secret>] [--json]\n');
    return options.help ? 0 : 2;
  }
  let value: string | undefined = options.value;
  if (value === undefined) {
    const entered = await readSecret(ctx, `Secret value for "${options.ref}": `);
    value = typeof entered === 'string' ? entered : String(entered ?? '');
  }
  if (!value) throw new CliError('A non-empty --value (or prompted secret) is required.', 2);
  const res = await requestJson(ctx, '/v1/host/sample/byok/secrets', {
    method: 'POST',
    body: { credentialRef: options.ref, value },
  });
  if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
  writeLine(ctx.io.stdout, `Stored ${res.body?.credentialRef ?? options.ref} (${res.body?.masked ?? 'masked'}).`);
  return 0;
}

async function byokDelete(ctx: Ctx, argv: string[]) {
  const { options, positionals } = parseOptions(argv, { bool: ['--help', '--yes'] });
  if (options.help || positionals.length !== 1) { write(ctx.io.stdout, 'Usage: openwop byok delete <credentialRef> [--yes]\n'); return options.help ? 0 : 2; }
  if (!options.yes) { writeLine(ctx.io.stderr, `Refusing to delete secret ${positionals[0]} without --yes.`); return 2; }
  await requestJson(ctx, `/v1/host/sample/byok/secrets/${encodeURIComponent(positionals[0])}`, { method: 'DELETE' });
  writeLine(ctx.io.stdout, `Deleted secret ref ${positionals[0]}.`);
  return 0;
}
