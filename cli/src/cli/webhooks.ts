import type { Ctx } from '../context.js';
/** `openwop webhooks ...` — manage HMAC-signed webhook subscriptions. */
import { requestJson } from '../api.js';
import { CliError } from '../errors.js';
import { write, writeLine, writeJson, formatTable } from '../io.js';
import { parseOptions } from '../options.js';

export const WEBHOOKS_HELP = `Usage:
  openwop webhooks list [--json]
  openwop webhooks add <url> --event <type> [--event <type> ...] [--tag t] [--secret s] [--json]
  openwop webhooks remove <subscriptionId> [--json]
  openwop webhooks test <subscriptionId> [--json]

Manage HMAC-signed webhook subscriptions on the configured host (POST/GET/DELETE
/v1/webhooks per spec/v1/webhooks.md).

  add     Registers a subscription. Supply --event one or more times. When you
          omit --secret, the host generates one and returns it ONCE in the add
          response — store it to verify delivery signatures.
  test    Fires a synthetic, signed \`webhook.test\` delivery to the
          subscription URL so you can confirm reachability + signature handling.
          A 202 means the delivery was dispatched, not that the endpoint acked.

Note: \`list\` never returns the signing secret.
`;

export async function runWebhooks(ctx: Ctx, argv: string[]) {
  const sub = argv[0] ?? 'list';
  const args = argv.slice(['list', 'add', 'remove', 'rm', 'test'].includes(sub) ? 1 : 0);
  if (sub === '--help' || sub === '-h') {
    write(ctx.io.stdout, WEBHOOKS_HELP);
    return 0;
  }
  switch (sub) {
    case 'list':
      return await runWebhooksList(ctx, args);
    case 'add':
      return await runWebhooksAdd(ctx, args);
    case 'remove':
    case 'rm':
      return await runWebhooksRemove(ctx, args);
    case 'test':
      return await runWebhooksTest(ctx, args);
    default:
      throw new CliError(`Unknown webhooks command: ${sub}\nRun \`openwop webhooks --help\` for usage.`);
  }
}

async function runWebhooksList(ctx: Ctx, argv: string[]) {
  const { options } = parseOptions(argv, { bool: ['--help'] });
  if (options.help) {
    write(ctx.io.stdout, WEBHOOKS_HELP);
    return 0;
  }
  const res = await requestJson(ctx, '/v1/webhooks');
  if (ctx.json) {
    writeJson(ctx.io.stdout, res.body);
    return 0;
  }
  const subscriptions = Array.isArray(res.body?.subscriptions) ? res.body.subscriptions : [];
  if (subscriptions.length === 0) {
    writeLine(ctx.io.stdout, 'No webhook subscriptions. Add one with `openwop webhooks add <url> --event <type>`.');
    return 0;
  }
  const rows = subscriptions.map((s: any) => ({
    subscriptionId: s.subscriptionId,
    url: s.url,
    events: Array.isArray(s.events) ? s.events.join(',') : '',
    createdAt: s.createdAt ?? '',
  }));
  writeLine(ctx.io.stdout, formatTable(rows, ['subscriptionId', 'url', 'events', 'createdAt']));
  return 0;
}

async function runWebhooksAdd(ctx: Ctx, argv: string[]) {
  const { options, positionals } = parseOptions(argv, {
    bool: ['--help'],
    value: ['--secret'],
    multi: ['--event', '--tag'],
  });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop webhooks add <url> --event <type> [--event <type> ...] [--tag t] [--secret s] [--json]\n');
    return options.help ? 0 : 2;
  }
  const events = options.event ?? [];
  if (events.length === 0) {
    throw new CliError('At least one --event <type> is required.');
  }
  const body = {
    url: positionals[0],
    events,
    ...(options.tag ? { tags: options.tag } : {}),
    ...(options.secret ? { secret: options.secret } : {}),
  };
  const res = await requestJson(ctx, '/v1/webhooks', { method: 'POST', body });
  if (ctx.json) {
    writeJson(ctx.io.stdout, res.body);
    return 0;
  }
  writeLine(ctx.io.stdout, `✓ Registered webhook ${res.body.subscriptionId} → ${res.body.url}`);
  if (res.body.secret) {
    writeLine(ctx.io.stdout, `  Signing secret (shown once): ${res.body.secret}`);
  }
  return 0;
}

async function runWebhooksRemove(ctx: Ctx, argv: string[]) {
  const { options, positionals } = parseOptions(argv, { bool: ['--help'] });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop webhooks remove <subscriptionId> [--json]\n');
    return options.help ? 0 : 2;
  }
  await requestJson(ctx, `/v1/webhooks/${encodeURIComponent(positionals[0])}`, { method: 'DELETE' });
  if (ctx.json) writeJson(ctx.io.stdout, { removed: positionals[0] });
  else writeLine(ctx.io.stdout, `✓ Removed webhook ${positionals[0]}`);
  return 0;
}

async function runWebhooksTest(ctx: Ctx, argv: string[]) {
  const { options, positionals } = parseOptions(argv, { bool: ['--help'] });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop webhooks test <subscriptionId> [--json]\n');
    return options.help ? 0 : 2;
  }
  const res = await requestJson(ctx, `/v1/webhooks/${encodeURIComponent(positionals[0])}/test`, { method: 'POST', body: {} });
  if (ctx.json) {
    writeJson(ctx.io.stdout, res.body);
    return 0;
  }
  writeLine(ctx.io.stdout, `✓ Test delivery dispatched to ${res.body.url} (event ${res.body.eventType}).`);
  return 0;
}
