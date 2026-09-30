/**
 * `spec/v2/core/storage.md` §`fs` — pack file access never escapes the
 * sandbox root (target major 2; gated on `fs` + the `conformance-fs-probe`
 * fixture).
 *
 * The rules: "Every `path` MUST be normalized and resolved relative to
 * `fs.sandboxRoot`. A path that escapes the root, whether absolute, through
 * `..` segments or through a symlink, MUST be refused. The host MUST NOT follow
 * such a link partially." And, from §Shared rules (RFC 0228's decision): "A
 * sandbox escape is `forbidden` with `details.reason: path-outside-sandbox`."
 * `errors.md` §Host-service refusals adds that a generic code carries
 * `details.service`, the family key. Until this file the rule had a witness
 * only at major 1, through the v1 seam `POST /v1/host/sample/fs/read`.
 *
 * No seam: each leg runs the `conformance-fs-probe` fixture, whose node calls
 * the host's own `ctx.fs` with the path unchanged and fails with the
 * rejection's code and details (conformance/fixtures.md §"The storage probe
 * fixtures").
 *
 *   inside-root       write then read `conformance/probe-<nonce>.txt` — the
 *                     content round-trips (the positive control: a host whose
 *                     probe refuses everything cannot pass the escape legs by
 *                     accident, because this leg fails first);
 *   absolute-escape   read `/etc/hosts` (outside any root other than `/` or
 *                     `/etc`) — `forbidden`, `path-outside-sandbox`;
 *   dotdot-escape     read `conformance/../../../../../../../../etc/hosts` —
 *                     the same;
 *   symlink-escape    read `conformance/escape-link`, which the operator points
 *                     outside the root — the same. A host that normalises `..`
 *                     but follows links reads the file and fails here.
 *
 * Dispositions: `fs` absent from the v2 root ⇒ `inapplicable`. `fs` advertised
 * without the fixture, or a run that cannot be created ⇒ `blocked`. A root of
 * `/` or `/etc` (so `/etc/hosts` is inside it) ⇒ that escape leg is
 * `inapplicable`. The symlink leg answering `not_found` means the operator link
 * is missing ⇒ `blocked`, never a pass.
 *
 * Sabotage (a patched local copy of the v2 reference host): skip the prefix
 * check for absolute paths, resolve without normalising `..`, or normalise
 * `..` but follow symlinks — each turns exactly its own leg red.
 *
 * @see spec/v2/core/storage.md §fs
 * @see RFCS/0228-v1-host-service-error-codes.md §Decisions 1
 */

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const FIXTURE = 'conformance-fs-probe';
const NODE_ID = 'fs-probe';
const DOC = 'spec/v2/core/storage.md §fs';
const DOC_CODE = 'spec/v2/core/storage.md §Shared rules';
const ID_INSIDE = 'openwop.requirement.storage.fs-inside-root-read';
const ID_ABSOLUTE = 'openwop.requirement.storage.fs-absolute-escape-refused';
const ID_DOTDOT = 'openwop.requirement.storage.fs-dotdot-escape-refused';
const ID_SYMLINK = 'openwop.requirement.storage.fs-symlink-escape-refused';
const OUTSIDE = '/etc/hosts';
const DOTDOT = 'conformance/../../../../../../../../etc/hosts';
const SYMLINK = 'conformance/escape-link';
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> { try { return await fn(); } catch { return null; } }
const enc = (id: string): string => encodeURIComponent(id);

interface Outcome {
  readonly status: string;
  readonly result: Record<string, unknown> | null;
  readonly error: { code: string | null; details: Record<string, unknown> } | null;
}

async function runProbe(inputs: Record<string, unknown>): Promise<Outcome | { reason: string }> {
  const created = await http(() => driver.post('/runs', { workflowId: FIXTURE, inputs }));
  if (created === null) return { reason: 'POST /runs unreachable (fetch failed)' };
  const runId = (created.json as { runId?: unknown } | null)?.runId;
  if (created.status !== 201 || typeof runId !== 'string') return { reason: `POST /runs {workflowId: ${FIXTURE}} answered ${created.status} ${readErrorCode(created.json) ?? ''} — the fixture run was refused`.trim() };
  const t0 = Date.now(); let status = '';
  while (Date.now() - t0 < 30_000) {
    const snap = await http(() => driver.get(`/runs/${enc(runId)}`));
    status = String((snap?.json as { status?: unknown } | null)?.status ?? '');
    if (TERMINAL.has(status)) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  if (!TERMINAL.has(status)) return { reason: `the ${FIXTURE} run did not reach a terminal status within 30 s (last: ${status || 'unreadable'})` };
  const ev = await http(() => driver.get(`/runs/${enc(runId)}/events/poll?timeout=1`));
  const events = (ev?.json as { events?: unknown } | null)?.events;
  if (ev?.status !== 200 || !Array.isArray(events)) return { reason: `GET /runs/{runId}/events/poll answered ${ev?.status ?? 'nothing'}` };
  const node = (type: string): Record<string, unknown> | undefined => (events as Array<{ type?: unknown; payload?: Record<string, unknown> }>).find((e) => e.type === type && e.payload?.['nodeId'] === NODE_ID)?.payload;
  const result = ((node('node.completed')?.['outputs'] ?? {}) as Record<string, unknown>)['result'];
  const err = (node('node.failed')?.['error'] ?? null) as { code?: unknown; details?: unknown } | null;
  return {
    status,
    result: result && typeof result === 'object' && !Array.isArray(result) ? (result as Record<string, unknown>) : null,
    error: err === null ? null : { code: typeof err.code === 'string' ? err.code : null, details: err.details && typeof err.details === 'object' ? (err.details as Record<string, unknown>) : {} },
  };
}

/** The gate, and the advertised `sandboxRoot`, or the recorded reason the leg cannot run. */
async function gate(): Promise<{ root: string } | { skip: ['inapplicable' | 'blocked', string] }> {
  if (!(await v2Discovery().catch(() => null))) return { skip: ['blocked', 'v2 discovery unreachable'] };
  const fs = await familyAdvertised('fs');
  if (!fs) return { skip: ['inapplicable', 'fs is not advertised in the v2 discovery root — the host exposes no ctx.fs to pack code'] };
  if (!isFixtureAdvertised(FIXTURE)) return { skip: ['blocked', `the host advertises fs but not the ${FIXTURE} fixture — the sandbox claim is made and cannot be observed without it`] };
  return { root: typeof fs['sandboxRoot'] === 'string' ? fs['sandboxRoot'] : '' };
}

/** `/etc/hosts` escapes every root except `/` and `/etc` (and their spellings). */
const rootContainsOutside = (root: string): boolean => { const r = root.replace(/\/+$/, ''); return r === '' || r === '/etc'; };

describe('v2 fs sandbox (storage.md §fs)', () => {
  it('a path inside the sandbox root is written and read back', async () => {
    const g = await gate(); if ('skip' in g) return softSkip(...g.skip);
    const nonce = randomUUID();
    const path = `conformance/probe-${nonce}.txt`;
    const w = await runProbe({ op: 'write', path, content: nonce });
    if ('reason' in w) return softSkip('blocked', `write: ${w.reason}`);
    const r = await runProbe({ op: 'read', path });
    if ('reason' in r) return softSkip('blocked', `read: ${r.reason}`);
    expect(w.status, req(ID_INSIDE, DOC, `a write inside the root MUST succeed (got ${w.status} ${w.error?.code ?? ''})`)).toBe('completed');
    expect(r.status, req(ID_INSIDE, DOC, `a read inside the root MUST succeed (got ${r.status} ${r.error?.code ?? ''})`)).toBe('completed');
    expect(r.result?.['content'], req(ID_INSIDE, 'conformance/fixtures.md §The storage probe fixtures', 'the read MUST return the bytes written')).toBe(nonce);
  }, 90_000);

  it('an absolute path outside the root is refused forbidden, path-outside-sandbox', async () => {
    const g = await gate(); if ('skip' in g) return softSkip(...g.skip);
    if (rootContainsOutside(g.root)) return softSkip('inapplicable', `sandboxRoot ${JSON.stringify(g.root)} contains ${OUTSIDE}, so that absolute path is not an escape`);
    const o = await runProbe({ op: 'read', path: OUTSIDE });
    if ('reason' in o) return softSkip('blocked', o.reason);
    expect(o.status, req(ID_ABSOLUTE, DOC, `an absolute path outside the root MUST be refused — the run ${o.status === 'completed' ? `read it (${String(o.result?.['content'] ?? '').length} chars)` : o.status}`)).toBe('failed');
    expect(o.error?.code, req(ID_ABSOLUTE, DOC_CODE, 'a sandbox escape is `forbidden`')).toBe('forbidden');
    expect(o.error?.details['reason'], req(ID_ABSOLUTE, DOC_CODE, 'a sandbox escape carries details.reason: path-outside-sandbox')).toBe('path-outside-sandbox');
    expect(o.error?.details['service'], req(ID_ABSOLUTE, 'spec/v2/core/errors.md §Host-service refusals', 'a generic code MUST carry details.service, the family key')).toBe('fs');
  }, 60_000);

  it('a dot-dot path that climbs out of the root is refused forbidden, path-outside-sandbox', async () => {
    const g = await gate(); if ('skip' in g) return softSkip(...g.skip);
    if (rootContainsOutside(g.root)) return softSkip('inapplicable', `sandboxRoot ${JSON.stringify(g.root)} contains ${OUTSIDE}, so no dot-dot path reaches outside it`);
    const o = await runProbe({ op: 'read', path: DOTDOT });
    if ('reason' in o) return softSkip('blocked', o.reason);
    expect(o.status, req(ID_DOTDOT, DOC, `a path escaping through .. segments MUST be refused — the run ${o.status === 'completed' ? 'read the file' : o.status}`)).toBe('failed');
    expect(o.error?.code, req(ID_DOTDOT, DOC_CODE, 'a sandbox escape is `forbidden`')).toBe('forbidden');
    expect(o.error?.details['reason'], req(ID_DOTDOT, DOC_CODE, 'a sandbox escape carries details.reason: path-outside-sandbox')).toBe('path-outside-sandbox');
    expect(o.error?.details['service'], req(ID_DOTDOT, 'spec/v2/core/errors.md §Host-service refusals', 'a generic code MUST carry details.service, the family key')).toBe('fs');
  }, 60_000);

  it('a symlink inside the root that points outside it is refused forbidden, path-outside-sandbox', async () => {
    const g = await gate(); if ('skip' in g) return softSkip(...g.skip);
    const o = await runProbe({ op: 'read', path: SYMLINK });
    if ('reason' in o) return softSkip('blocked', o.reason);
    if (o.status === 'failed' && o.error?.code === 'not_found') return softSkip('blocked', `${SYMLINK} answered not_found — the operator symlink the fixture contract requires is missing, so the leg observed nothing`);
    expect(o.status, req(ID_SYMLINK, DOC, `a path escaping through a symlink MUST be refused, never followed — the run ${o.status === 'completed' ? 'read the link target' : o.status}`)).toBe('failed');
    expect(o.error?.code, req(ID_SYMLINK, DOC_CODE, 'a sandbox escape is `forbidden`')).toBe('forbidden');
    expect(o.error?.details['reason'], req(ID_SYMLINK, DOC_CODE, 'a sandbox escape carries details.reason: path-outside-sandbox')).toBe('path-outside-sandbox');
    expect(o.error?.details['service'], req(ID_SYMLINK, 'spec/v2/core/errors.md §Host-service refusals', 'a generic code MUST carry details.service, the family key')).toBe('fs');
  }, 60_000);
});
