import type { Ctx } from '../context.js';
/** `openwop notify email|sms` — one-off dispatch via the demo host. */
import { CliError } from '../errors.js';
import { write, writeLine, writeJson } from '../io.js';
import { parseOptions } from '../options.js';
import { requestJson } from '../api.js';
import { MESSAGING_BASE } from './relayShared.js';

export const NOTIFY_HELP = `Usage:
  openwop notify email --to <addr> --text <msg> [--subject s]
  openwop notify sms   --to <number> --text <msg>

Dispatch a one-off notification through the demo host
(/v1/host/sample/messaging/notify). The reference app returns a synthetic
receipt; wiring a real provider (SES / Twilio) is a host concern.
`;

export async function runNotify(ctx: Ctx, argv) {
  const kind = argv[0];
  if (!kind || kind === '--help' || kind === '-h') {
    write(ctx.io.stdout, NOTIFY_HELP);
    return kind ? 0 : 2;
  }
  if (kind !== 'email' && kind !== 'sms') {
    throw new CliError(`Unknown notify kind: ${kind}\nUsage: openwop notify <email|sms> --to <addr> --text <msg> [--subject s]`);
  }
  const { options } = parseOptions(argv.slice(1), { value: ['--to', '--text', '--subject'] });
  if (!options.to) throw new CliError('--to is required.');
  if (!options.text) throw new CliError('--text is required.');
  const body = {
    kind,
    to: options.to,
    text: options.text,
    ...(options.subject ? { subject: options.subject } : {}),
  };
  const res = await requestJson(ctx, `${MESSAGING_BASE}/notify`, { method: 'POST', body });
  if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
  writeLine(ctx.io.stdout, `✓ ${kind} ${res.body.notifyId} → ${res.body.to}: ${res.body.status} (${res.body.detail})`);
  return 0;
}
