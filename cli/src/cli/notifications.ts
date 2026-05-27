/** `openwop notifications ...` — notification inbox (sample-extension). */

import { requestJson } from '../api.js';
import { CliError } from '../errors.js';
import { write, writeLine, writeJson, formatTable } from '../io.js';
import { parseOptions } from '../options.js';

export const NOTIFICATIONS_HELP = `Usage:
  openwop notifications list [--status <s>] [--archived] [--limit n] [--json]
  openwop notifications read|unread|archive <id> [--json]
  openwop notifications mark-all-read [--json]
  openwop notifications delete <id> [--json]

Operate the demo notification inbox (/v1/host/sample/notifications) — a
sample-extension surface, tenant-scoped, not part of the normative wire.
`;

export async function runNotifications(ctx: any, argv: string[]): Promise<number> {
  const sub = argv[0] ?? 'list';
  if (sub === '--help' || sub === '-h') { write(ctx.io.stdout, NOTIFICATIONS_HELP); return 0; }
  const base = '/v1/host/sample/notifications';
  const rest = argv.slice(1);
  switch (sub) {
    case 'list': {
      const { options } = parseOptions(rest, { bool: ['--archived'], value: ['--status', '--limit'] });
      const q = new URLSearchParams();
      if (options.status) q.set('status', options.status);
      if (options.archived) q.set('includeArchived', 'true');
      if (options.limit) q.set('limit', options.limit);
      const res = await requestJson(ctx, `${base}${q.toString() ? `?${q}` : ''}`);
      if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
      const items = Array.isArray(res.body?.notifications) ? res.body.notifications : [];
      if (items.length === 0) { writeLine(ctx.io.stdout, 'No notifications.'); return 0; }
      writeLine(ctx.io.stdout, formatTable(
        items.map((n: any) => ({ id: n.notificationId, status: n.status, priority: n.priority ?? '', title: n.title ?? '', createdAt: n.createdAt ?? '' })),
        ['id', 'status', 'priority', 'title', 'createdAt'],
      ));
      return 0;
    }
    case 'read': case 'unread': case 'archive': {
      if (rest.length !== 1) { write(ctx.io.stdout, `Usage: openwop notifications ${sub} <id> [--json]\n`); return 2; }
      const res = await requestJson(ctx, `${base}/${encodeURIComponent(rest[0])}/${sub}`, { method: 'POST', body: {} });
      if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
      writeLine(ctx.io.stdout, `✓ ${rest[0]} → ${res.body.status}`);
      return 0;
    }
    case 'mark-all-read': {
      const res = await requestJson(ctx, `${base}:mark-all-read`, { method: 'POST', body: {} });
      if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
      writeLine(ctx.io.stdout, `✓ Marked ${res.body.updated} notification(s) read.`);
      return 0;
    }
    case 'delete': case 'rm': {
      if (rest.length !== 1) { write(ctx.io.stdout, 'Usage: openwop notifications delete <id> [--json]\n'); return 2; }
      const res = await requestJson(ctx, `${base}/${encodeURIComponent(rest[0])}`, { method: 'DELETE' });
      if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
      writeLine(ctx.io.stdout, `✓ Deleted ${rest[0]}`);
      return 0;
    }
    default:
      throw new CliError(`Unknown notifications command: ${sub}\nRun \`openwop notifications --help\` for usage.`);
  }
}
