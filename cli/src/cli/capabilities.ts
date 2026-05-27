import type { Ctx } from '../context.js';
/** `openwop capabilities` — read + summarize /.well-known/openwop. */
import { requestJson } from '../api.js';
import { write, writeJson } from '../io.js';
import { parseOptions } from '../options.js';

export const CAPABILITIES_HELP = `Usage: openwop capabilities [--base-url url] [--json]

Reads /.well-known/openwop and prints the implementation, protocol version, and advertised capability blocks. Use --json to inspect the raw discovery document.
`;


export async function runCapabilities(ctx: Ctx, argv) {
  const { options } = parseOptions(argv, { bool: ['--help'] });
  if (options.help) {
    write(ctx.io.stdout, CAPABILITIES_HELP);
    return 0;
  }
  const res = await requestJson(ctx, '/.well-known/openwop', { auth: false });
  if (ctx.json) {
    writeJson(ctx.io.stdout, res.body);
    return 0;
  }
  write(ctx.io.stdout, summarizeCapabilities(res.body));
  return 0;
}

export function summarizeCapabilities(caps) {
  const capabilities = caps.capabilities && typeof caps.capabilities === 'object' ? Object.keys(caps.capabilities) : [];
  const impl = caps.implementation ?? {};
  const lines = [
    `Implementation: ${impl.name ?? 'unknown'} ${impl.version ?? ''}`.trim(),
    `Protocol: ${caps.protocolVersion ?? 'unknown'}`,
    `Transports: ${(caps.supportedTransports ?? []).join(', ') || 'unknown'}`,
    `Stream modes: ${caps.stream?.modes?.join(', ') ?? 'unknown'}`,
    `Fixtures: ${Array.isArray(caps.fixtures) ? caps.fixtures.length : 0}`,
    `Capability blocks: ${capabilities.join(', ') || 'none'}`,
    '',
  ];
  return lines.join('\n');
}
