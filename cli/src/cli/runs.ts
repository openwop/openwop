import type { Ctx } from '../context.js';
/** `openwop runs ...` — create/list/inspect/annotate/debug runs. */
import { writeFileSync } from 'node:fs';
import { CliError, HttpError } from '../errors.js';
import { write, writeLine, writeJson, formatTable } from '../io.js';
import { parseOptions } from '../options.js';
import { requestJson } from '../api.js';
import { sleep } from '../util.js';
import { TERMINAL_STATUSES } from '../constants.js';
import { buildInputs } from './shared.js';

export const RUNS_HELP = `Usage:
  openwop runs list [--status status] [--limit n] [--tenant-id id] [--json]
  openwop runs create <workflowId> [--input k=v] [--inputs-json JSON] [--tenant-id id] [--wait] [--json]
  openwop runs get <runId> [--json]
  openwop runs cancel <runId> [--reason text] [--json]
  openwop runs ancestry <runId> [--json]
  openwop runs events <runId> [--since <sequence>] [--limit n] [--json]
  openwop runs annotations <runId> [--json]
  openwop runs annotate <runId> (--rating 1-5 | --label t | --correction t | --flag) [--note t] [--event-id id] [--node-id id]
  openwop runs debug-bundle <runId> [--max-events n] [--out file] [--json]

\`runs events\` polls GET /v1/runs/{runId}/events/poll (JSON, not SSE); --since N
returns events with sequence > N. \`runs annotate\` posts a review signal
(rating/label/correction/flag) and \`runs annotations\` lists them. \`runs
debug-bundle\` exports a run's full event bundle — pass --out to save it to a file.

The \`runs ancestry\` command walks the RFC 0040 cross-host parent chain from the
requested run up to its top-level root (each run has one parent, so the ancestry
is linear). The endpoint is opt-in: the host must advertise
\`crossHostCausation.ancestryEndpointSupported\` or the command reports it as
unavailable.

Input parsing for \`runs create\`:
  --input k=v       Each value is JSON.parse'd first; on parse failure it falls back to a string.
                    So \`--input n=5\` yields the number 5, \`--input enabled=true\` yields the
                    boolean true, \`--input text=hello\` yields the string "hello", and
                    \`--input list=[1,2,3]\` yields an array. Quote shell-special characters.
  --inputs-json J   Pass the whole \`inputs\` object as one JSON literal. Merged BEFORE
                    --input k=v pairs (which override).
  --wait            Poll GET /v1/runs/{runId} every 250ms until terminal status or
                    --timeout-ms (default 30000) elapses. Exit 0 only on \`completed\`.
`;

export async function runRuns(ctx: Ctx, argv: string[]) {
  const sub = argv[0] ?? 'list';
  const args = argv.slice(['list', 'create', 'get', 'cancel', 'ancestry', 'events', 'annotations', 'annotate', 'debug-bundle'].includes(sub) ? 1 : 0);
  if (sub === '--help' || sub === '-h') {
    write(ctx.io.stdout, RUNS_HELP);
    return 0;
  }
  switch (sub) {
    case 'list':
      return runRunsList(ctx, args);
    case 'create':
      return runRunsCreate(ctx, args);
    case 'get':
      return runRunsGet(ctx, args);
    case 'cancel':
      return runRunsCancel(ctx, args);
    case 'ancestry':
      return runRunsAncestry(ctx, args);
    case 'events':
      return runRunsEvents(ctx, args);
    case 'annotations':
      return runRunsAnnotations(ctx, args);
    case 'annotate':
      return runRunsAnnotate(ctx, args);
    case 'debug-bundle':
      return runRunsDebugBundle(ctx, args);
    default:
      throw new CliError(`Unknown runs command: ${sub}`);
  }
}

async function runRunsList(ctx: Ctx, argv: string[]) {
  const { options } = parseOptions(argv, {
    bool: ['--help'],
    value: ['--status', '--limit', '--tenant-id'],
  });
  if (options.help) {
    write(ctx.io.stdout, RUNS_HELP);
    return 0;
  }
  const query = new URLSearchParams();
  if (options.status) query.set('status', options.status);
  if (options.limit) query.set('limit', options.limit);
  if (options.tenantId) query.set('tenantId', options.tenantId);
  const path = `/v1/runs${query.size ? `?${query.toString()}` : ''}`;
  const res = await requestJson(ctx, path);
  if (ctx.json) {
    writeJson(ctx.io.stdout, res.body);
    return 0;
  }
  const rows = (res.body.runs ?? []).map((r: any) => ({
    runId: r.runId,
    workflowId: r.workflowId,
    status: r.status,
    createdAt: r.createdAt ?? '',
  }));
  writeLine(ctx.io.stdout, rows.length ? formatTable(rows, ['runId', 'workflowId', 'status', 'createdAt']) : 'No runs found.');
  return 0;
}

async function runRunsCreate(ctx: Ctx, argv: string[]) {
  const { options, positionals } = parseOptions(argv, {
    bool: ['--help', '--wait'],
    value: ['--tenant-id', '--scope-id', '--inputs-json', '--timeout-ms'],
    multi: ['--input'],
  });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop runs create <workflowId> [--input k=v] [--inputs-json JSON] [--tenant-id id] [--wait] [--json]\n');
    return options.help ? 0 : 2;
  }
  const body = {
    workflowId: positionals[0],
    ...(options.tenantId ? { tenantId: options.tenantId } : {}),
    ...(options.scopeId ? { scopeId: options.scopeId } : {}),
    inputs: buildInputs(options),
  };
  const res = await requestJson(ctx, '/v1/runs', { method: 'POST', body });
  if (options.wait) {
    const snap = await waitForRun(ctx, res.body.runId, Number(options.timeoutMs ?? 30000));
    if (ctx.json) writeJson(ctx.io.stdout, { created: res.body, final: snap });
    else {
      writeLine(ctx.io.stdout, `Created run ${res.body.runId}`);
      writeLine(ctx.io.stdout, `Final status: ${snap.status}`);
    }
    return snap.status === 'completed' ? 0 : 1;
  }
  if (ctx.json) writeJson(ctx.io.stdout, res.body);
  else writeLine(ctx.io.stdout, `Created run ${res.body.runId} (${res.body.status})`);
  return 0;
}

async function runRunsGet(ctx: Ctx, argv: string[]) {
  const { options, positionals } = parseOptions(argv, { bool: ['--help'] });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop runs get <runId> [--json]\n');
    return options.help ? 0 : 2;
  }
  const res = await requestJson(ctx, `/v1/runs/${encodeURIComponent(positionals[0])}`);
  if (ctx.json) writeJson(ctx.io.stdout, res.body);
  else {
    writeLine(ctx.io.stdout, `runId: ${res.body.runId}`);
    writeLine(ctx.io.stdout, `workflowId: ${res.body.workflowId}`);
    writeLine(ctx.io.stdout, `status: ${res.body.status}`);
  }
  return 0;
}

async function runRunsCancel(ctx: Ctx, argv: string[]) {
  const { options, positionals } = parseOptions(argv, {
    bool: ['--help'],
    value: ['--reason'],
  });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop runs cancel <runId> [--reason text] [--json]\n');
    return options.help ? 0 : 2;
  }
  const body = options.reason ? { reason: options.reason } : {};
  const res = await requestJson(ctx, `/v1/runs/${encodeURIComponent(positionals[0])}/cancel`, { method: 'POST', body });
  if (ctx.json) writeJson(ctx.io.stdout, res.body);
  else writeLine(ctx.io.stdout, `Cancelled ${positionals[0]}`);
  return 0;
}

async function runRunsEvents(ctx: Ctx, argv: string[]) {
  const { options, positionals } = parseOptions(argv, { bool: ['--help'], value: ['--since', '--limit'] });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop runs events <runId> [--since <sequence>] [--limit <n>] [--json]\n');
    return options.help ? 0 : 2;
  }
  const query = new URLSearchParams();
  if (options.since !== undefined) query.set('lastSequence', String(options.since));
  if (options.limit !== undefined) query.set('limit', String(options.limit));
  const qs = query.toString();
  const res = await requestJson(ctx, `/v1/runs/${encodeURIComponent(positionals[0])}/events/poll${qs ? `?${qs}` : ''}`);
  if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
  const events = Array.isArray(res.body?.events) ? res.body.events : [];
  if (events.length === 0) { writeLine(ctx.io.stdout, 'No events.'); return 0; }
  writeLine(ctx.io.stdout, formatTable(
    events.map((e: any) => ({ seq: String(e.sequence), type: e.type, nodeId: e.nodeId ?? '', timestamp: e.timestamp ?? '' })),
    ['seq', 'type', 'nodeId', 'timestamp'],
  ));
  if (res.body?.isComplete) writeLine(ctx.io.stdout, '(run complete)');
  return 0;
}

async function runRunsAnnotations(ctx: Ctx, argv: string[]) {
  const { options, positionals } = parseOptions(argv, { bool: ['--help'] });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop runs annotations <runId> [--json]\n');
    return options.help ? 0 : 2;
  }
  const res = await requestJson(ctx, `/v1/runs/${encodeURIComponent(positionals[0])}/annotations`);
  if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
  const annotations = Array.isArray(res.body?.annotations) ? res.body.annotations : [];
  if (annotations.length === 0) { writeLine(ctx.io.stdout, 'No annotations. Add one with `openwop runs annotate <runId> --rating 5`.'); return 0; }
  writeLine(ctx.io.stdout, formatTable(
    annotations.map((a: any) => ({
      annotationId: a.annotationId,
      kind: a.signal?.kind ?? '',
      detail: a.signal?.rating ?? a.signal?.label ?? a.signal?.correction ?? '',
      note: a.note ?? '',
      createdAt: a.createdAt ?? '',
    })),
    ['annotationId', 'kind', 'detail', 'note', 'createdAt'],
  ));
  return 0;
}

async function runRunsAnnotate(ctx: Ctx, argv: string[]) {
  const { options, positionals } = parseOptions(argv, {
    bool: ['--help', '--flag'],
    value: ['--rating', '--label', '--correction', '--note', '--event-id', '--node-id'],
  });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop runs annotate <runId> (--rating 1-5 | --label <text> | --correction <text> | --flag) [--note text] [--event-id id] [--node-id id] [--json]\n');
    return options.help ? 0 : 2;
  }
  // Exactly one signal kind.
  const signal: Record<string, unknown> = {};
  if (options.rating !== undefined) { signal.kind = 'rating'; signal.rating = Number(options.rating); }
  else if (options.label !== undefined) { signal.kind = 'label'; signal.label = options.label; }
  else if (options.correction !== undefined) { signal.kind = 'correction'; signal.correction = options.correction; }
  else if (options.flag) { signal.kind = 'flag'; }
  else throw new CliError('one of --rating, --label, --correction, or --flag is required.');

  const target: Record<string, unknown> = {};
  if (options.eventId) target.eventId = options.eventId;
  if (options.nodeId) target.nodeId = options.nodeId;
  const body = {
    signal,
    ...(Object.keys(target).length ? { target } : {}),
    ...(options.note ? { note: options.note } : {}),
  };
  const res = await requestJson(ctx, `/v1/runs/${encodeURIComponent(positionals[0])}/annotations`, { method: 'POST', body });
  if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
  writeLine(ctx.io.stdout, `✓ Annotation ${res.body.annotationId} (${res.body.signal?.kind}) on ${positionals[0]}`);
  return 0;
}

async function runRunsDebugBundle(ctx: Ctx, argv: string[]) {
  const { options, positionals } = parseOptions(argv, { bool: ['--help'], value: ['--max-events', '--out'] });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop runs debug-bundle <runId> [--max-events <n>] [--out <file>] [--json]\n');
    return options.help ? 0 : 2;
  }
  const query = new URLSearchParams();
  if (options.maxEvents !== undefined) query.set('maxEvents', String(options.maxEvents));
  const qs = query.toString();
  const res = await requestJson(ctx, `/v1/runs/${encodeURIComponent(positionals[0])}/debug-bundle${qs ? `?${qs}` : ''}`);
  if (options.out) {
    writeFileSync(options.out, JSON.stringify(res.body, null, 2) + '\n', 'utf8');
    if (!ctx.quiet) writeLine(ctx.io.stdout, `✓ Wrote debug bundle for ${res.body.runId} → ${options.out} (${(res.body.events ?? []).length} events${res.body.truncated ? ', truncated' : ''})`);
    return 0;
  }
  if (ctx.json) { writeJson(ctx.io.stdout, res.body); return 0; }
  writeLine(ctx.io.stdout, `runId: ${res.body.runId}`);
  writeLine(ctx.io.stdout, `workflowId: ${res.body.workflowId}`);
  writeLine(ctx.io.stdout, `status: ${res.body.status}`);
  writeLine(ctx.io.stdout, `events: ${(res.body.events ?? []).length}${res.body.truncated ? ' (truncated)' : ''}`);
  writeLine(ctx.io.stdout, 'Pass --out <file> to save the full bundle, or --json to print it.');
  return 0;
}

async function runRunsAncestry(ctx: Ctx, argv: string[]) {
  const { options, positionals } = parseOptions(argv, { bool: ['--help'] });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop runs ancestry <runId> [--json]\n');
    return options.help ? 0 : 2;
  }
  // RFC 0040 §C — GET /v1/runs/{runId}/ancestry. Each run carries a single
  // cross-host parent link (`parent`), so the ancestry is a linear chain.
  // Walk it from the requested run up to the top-level root, following the
  // same-host `parent.runId` until `parent === null`. A depth cap guards
  // against a malformed cycle. The endpoint is opt-in (Phase 3) and returns
  // 404 when not advertised — surface that as a clear message.
  const chain: any[] = [];
  let current = encodeURIComponent(positionals[0]);
  const MAX_DEPTH = 64;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    let res;
    try {
      res = await requestJson(ctx, `/v1/runs/${current}/ancestry`);
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) {
        // Distinguish "endpoint not enabled" from "run not found" via the body.
        const detail = err.body && typeof err.body === 'object' && typeof (err.body as { message?: string }).message === 'string'
          ? (err.body as { message?: string }).message
          : 'not found';
        throw new CliError(`runs ancestry unavailable: ${detail} (the ancestry endpoint is opt-in; the host must advertise crossHostCausation.ancestryEndpointSupported).`, 2);
      }
      throw err;
    }
    chain.push(res.body);
    const parent = res.body.parent;
    if (!parent || typeof parent.runId !== 'string') break;
    // A cross-host parent (with wellKnownUrl) can't be walked over this host;
    // record the link and stop.
    if (parent.wellKnownUrl) break;
    current = encodeURIComponent(parent.runId);
  }

  if (ctx.json) {
    writeJson(ctx.io.stdout, { runId: positionals[0], chain });
    return 0;
  }

  // Render the chain root → requested run as a table, oldest ancestor first.
  const ordered = [...chain].reverse();
  const rows = ordered.map((node, i) => {
    const parent = node.parent;
    return {
      depth: ordered.length - 1 - i,
      runId: node.runId,
      hostId: node.hostId ?? '',
      parentRunId: parent && typeof parent.runId === 'string' ? parent.runId : '(root)',
      cause: parent && typeof parent.cause === 'string' ? parent.cause : '',
    };
  });
  writeLine(ctx.io.stdout, formatTable(rows, ['depth', 'runId', 'hostId', 'parentRunId', 'cause']));
  return 0;
}

async function waitForRun(ctx: Ctx, runId: any, timeoutMs: any) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await requestJson(ctx, `/v1/runs/${encodeURIComponent(runId)}`);
    if (TERMINAL_STATUSES.has(res.body.status)) return res.body;
    await sleep(250);
  }
  throw new CliError(`Timed out waiting for run ${runId} after ${timeoutMs}ms`, 1);
}
