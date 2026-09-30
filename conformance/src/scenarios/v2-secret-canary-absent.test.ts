/**
 * `spec/v2/core/host-services.md` §`secrets` — a secret the host resolves from
 * its OWN store never reaches a readable surface (target major 2; gated on the
 * `secrets` family and the `openwop-smoke-byok-roundtrip` fixture).
 *
 *   "Raw key material MUST NOT appear in any event, log, trace, prompt, error,
 *    export or screenshot" · "MUST keep the plaintext out of events, spans,
 *    logs, snapshots and replay state. A replay re-resolves it"
 *
 * Before this file the rule was witnessed at major 1 only, and only on the
 * envelope (`envelope-reasoning-secret-redaction`) and OTel
 * (`secret-leakage-otel-attribute`) paths. `byok-roundtrip` runs the same
 * fixture but searches for four key NAMES, never the value — any leak under
 * another key passes it.
 *
 * What this adds, over the fixture the host already advertises (its node
 * resolves the store canary `openwop-conformance-canary-secret` and outputs only
 * `{secretSha256, secretLength}`):
 *
 *   1. `resolved-secret-absent` — after a completed run, the canary is on none
 *      of: the createRun answer, the snapshot, the poll log (`streamMode=debug`),
 *      the SSE stream (`streamMode=debug`), the run's `listRuns` page (when
 *      `runList` is advertised), or the error envelope a cancel of the terminal
 *      run answers.
 *   2. `resolved-secret-absent-on-failure` — the same after a run that resolves
 *      the canary and then FAILS (`conformance-secret-resolve-then-fail`), where
 *      the snapshot `error`, `node.failed` and `run.failed` join the surfaces.
 *      A host that folds the node's resolved context into an error is caught here.
 *   3. `resolved-secret-absent-in-fork` — a replay fork taken before the resolve
 *      node re-resolves the canary (§`secrets`: "A replay re-resolves it"); the
 *      fork's answer, snapshot and log carry it nowhere either (gated on `replay`).
 *
 * How the suite recognises the canary without being told it: every window of
 * `secretLength` bytes on every surface (and inside every base64 / hex /
 * percent-decoded token) is hashed and compared with the surfaced
 * `secretSha256` (`lib/secret-scan.ts`). When the operator also supplies the
 * plaintext (`OPENWOP_CANARY_SECRET_VALUE`, as `secret-leakage-otel-attribute`
 * already reads) it is searched for directly in every common encoding.
 *
 * Not duplicated: RFC 0229 (`runSecrets`, `core.secret.witness`,
 * `secrets.run-witness-*`) witnesses a value the SUITE supplies with the run.
 * This file witnesses a secret the host resolves from its own store — the BYOK
 * path the §`secrets` rule exists for. Its digest is legitimately on the
 * surfaces (the byok fixture's contract emits it), so it is not a finding here.
 *
 * Dispositions: `secrets` not advertised, or the leg's fixture not advertised
 * ⇒ `inapplicable`, read with `familyAdvertised` rather than `gateFamily` so
 * strict mode does not demand a `family.secrets` opt-out from a host that never
 * claimed it (a production host is right to withhold the canary fixture —
 * RFC 0229 §Motivation). No detector (the digest not surfaced — a MAY — and no
 * operator value) ⇒ `inapplicable`: nothing on this host can be recognised as
 * the canary. An advertised fixture that cannot be run ⇒ `blocked`.
 *
 * @see spec/v2/core/host-services.md §`secrets`
 * @see conformance/fixtures.md §`openwop-smoke-byok-roundtrip`, §`conformance-secret-resolve-then-fail`
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { subscribe } from '../lib/sse.js';
import { familyAdvertised, v2Discovery } from '../lib/v2.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { digestDetector, findSecretDigest, leaks, valueDetector, type SecretDetector, type Surface } from '../lib/secret-scan.js';

const DOC = 'spec/v2/core/host-services.md §secrets';
const ID_ABSENT = 'openwop.requirement.secrets.resolved-secret-absent';
const ID_FAILURE = 'openwop.requirement.secrets.resolved-secret-absent-on-failure';
const ID_FORK = 'openwop.requirement.secrets.resolved-secret-absent-in-fork';
const BYOK = 'openwop-smoke-byok-roundtrip';
const THEN_FAIL = 'conformance-secret-resolve-then-fail';
const RESOLVE_NODE = 'resolve-secret';
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const V2 = { 'OpenWOP-Version': '2.0' };

const enc = (id: string): string => encodeURIComponent(id);
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> { try { return await fn(); } catch { return null; } }
function parse(text: string): unknown { try { return JSON.parse(text); } catch { return text; } }

async function gate(fixture: string): Promise<string | null> {
  if (!(await v2Discovery())) return 'blocked:v2 discovery unreachable — /.well-known/openwop did not answer 200 under OpenWOP-Version: 2.0';
  if (!(await familyAdvertised('secrets'))) return 'inapplicable:secrets family not advertised — no obligation';
  if (!isFixtureAdvertised(fixture)) return `inapplicable:fixture ${fixture} is not advertised — the host does not claim the store-canary fixture (a production host may withhold it; RFC 0229's run witness is that host's path)`;
  return null;
}
function skip(why: string): undefined {
  const i = why.indexOf(':');
  return softSkip(why.slice(0, i) as 'blocked' | 'inapplicable', why.slice(i + 1));
}

interface Settled { readonly runId: string; readonly status: string; readonly surfaces: Surface[]; readonly docs: unknown[]; readonly events: Array<{ sequence?: unknown; type?: unknown; nodeId?: unknown }> }

/** Settle a run and read every readable surface of it. */
async function readRun(runId: string, created: OpenWOPResponse, label: string): Promise<Settled | { reason: string }> {
  const deadline = Date.now() + 20_000;
  let snap: OpenWOPResponse | null = null;
  let status = '';
  while (Date.now() < deadline) {
    snap = await http(() => driver.get(`/runs/${enc(runId)}`));
    status = snap?.status === 200 ? String((snap.json as { status?: unknown } | undefined)?.status ?? '') : status;
    if (TERMINAL.has(status)) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (snap === null || snap.status !== 200 || !TERMINAL.has(status)) return { reason: `the ${label} run ${runId} did not settle within 20 s (last status: ${status || 'unreadable'})` };
  const poll = await http(() => driver.get(`/runs/${enc(runId)}/events/poll?timeout=1&streamMode=debug`));
  if (poll === null || poll.status !== 200) return { reason: `GET /runs/{runId}/events/poll answered ${poll?.status ?? 'no response'} for the ${label} run` };
  const events = ((poll.json as { events?: unknown } | undefined)?.events ?? []) as Settled['events'];
  const surfaces: Surface[] = [
    { name: `${label}: createRun answer`, text: created.text },
    { name: `${label}: GET /runs/{runId} snapshot`, text: snap.text },
    { name: `${label}: GET /runs/{runId}/events/poll?streamMode=debug`, text: poll.text },
  ];
  const docs: unknown[] = [created.json, snap.json, poll.json];
  const sse = await subscribe(`/runs/${enc(runId)}/events?streamMode=debug`, { timeoutMs: 8_000, extraHeaders: V2 }).catch(() => null);
  if (sse !== null && sse.status === 200) {
    const frames = sse.events.map((f) => parse(f.data));
    surfaces.push({ name: `${label}: GET /runs/{runId}/events (SSE, streamMode=debug)`, text: JSON.stringify(frames) });
    docs.push(frames);
  }
  // An error envelope the run can produce on demand: cancelling a terminal run.
  const cancel = await http(() => driver.post(`/runs/${enc(runId)}/cancel`, {}));
  if (cancel !== null) surfaces.push({ name: `${label}: POST /runs/{runId}/cancel on the terminal run (${cancel.status} ${readErrorCode(cancel.json) ?? ''})`.replace(' )', ')'), text: cancel.text });
  if (await familyAdvertised('runList')) {
    const list = await http(() => driver.get(`/runs?workflowId=${enc(String((snap!.json as { workflowId?: unknown }).workflowId ?? ''))}&limit=10`));
    if (list !== null && list.status === 200) surfaces.push({ name: `${label}: GET /runs (listRuns page)`, text: list.text });
  }
  return { runId, status, surfaces, docs, events };
}

/** The detectors this host lets the suite build: the operator's value, the surfaced digest, or both. */
function detectorsFor(docs: readonly unknown[]): SecretDetector[] {
  const out: SecretDetector[] = [];
  const operator = process.env['OPENWOP_CANARY_SECRET_VALUE'];
  const digest = findSecretDigest(docs);
  if (operator && operator.length > 0) {
    // An operator value that is not the canary this host resolved would make the value search vacuous.
    if (digest === null || createHash('sha256').update(operator, 'utf8').digest('hex') === digest.sha256.toLowerCase()) out.push(valueDetector(operator));
  }
  if (digest !== null) out.push(digestDetector(digest.sha256, digest.length));
  return out;
}

async function create(workflowId: string): Promise<{ runId: string; res: OpenWOPResponse } | { reason: string }> {
  const res = await http(() => driver.post('/runs', { workflowId }));
  if (res === null) return { reason: 'POST /runs unreachable (fetch failed)' };
  const runId = (res.json as { runId?: unknown } | undefined)?.runId;
  if (res.status !== 201 || typeof runId !== 'string') return { reason: `POST /runs {workflowId: ${workflowId}} answered ${res.status} ${readErrorCode(res.json) ?? ''} — the fixture is advertised but did not start (canary not provisioned?)`.trim() };
  return { runId, res };
}

const NO_DETECTOR = 'the run surfaced no {secretSha256, secretLength} (surfacing node outputs is a MAY) and OPENWOP_CANARY_SECRET_VALUE is unset — nothing on this host can be recognised as the canary';

/** Shared by the three legs: the source run of the byok fixture, read once. */
let source: Promise<Settled | { reason: string }> | null = null;
function byokRun(): Promise<Settled | { reason: string }> {
  source ??= (async () => {
    const c = await create(BYOK);
    if ('reason' in c) return c;
    return readRun(c.runId, c.res, 'byok');
  })();
  return source;
}

describe('v2 secret-canary-absent (host-services.md §secrets)', () => {
  it('a secret resolved from the host\'s store appears on no readable surface of the run', async () => {
    const why = await gate(BYOK); if (why) return skip(why);
    const run = await byokRun(); if ('reason' in run) return softSkip('blocked', run.reason);
    const detectors = detectorsFor(run.docs);
    if (detectors.length === 0) return softSkip('inapplicable', NO_DETECTOR);
    expect(run.status, req(ID_ABSENT, 'conformance/fixtures.md §openwop-smoke-byok-roundtrip', `the byok fixture run MUST complete when the host advertises it (got ${run.status})`)).toBe('completed');
    const found = leaks(run.surfaces, detectors);
    expect(found, req(ID_ABSENT, DOC, `raw key material MUST NOT appear in any event, snapshot or error — the canary was found on ${found.length} of ${run.surfaces.length} surface(s): ${found.join(' | ')}`)).toEqual([]);
  }, 60_000);

  it('a secret resolved by a run that then fails appears on no readable surface, the error included', async () => {
    const why = await gate(THEN_FAIL); if (why) return skip(why);
    const c = await create(THEN_FAIL); if ('reason' in c) return softSkip('blocked', c.reason);
    const run = await readRun(c.runId, c.res, 'resolve-then-fail'); if ('reason' in run) return softSkip('blocked', run.reason);
    // The failing run's own digest, else the completed byok run's (the same canary) when that fixture is advertised too.
    const extra = isFixtureAdvertised(BYOK) ? await byokRun() : null;
    const detectors = detectorsFor([...run.docs, ...(extra !== null && !('reason' in extra) ? extra.docs : [])]);
    if (detectors.length === 0) return softSkip('inapplicable', NO_DETECTOR);
    expect(run.status, req(ID_FAILURE, `conformance/fixtures.md §${THEN_FAIL}`, `the resolve-then-fail run MUST end failed (got ${run.status})`)).toBe('failed');
    const found = leaks(run.surfaces, detectors);
    expect(found, req(ID_FAILURE, DOC, `raw key material MUST NOT appear in any error or event of a run that resolved it and failed — the canary was found on: ${found.join(' | ')}`)).toEqual([]);
  }, 90_000);

  it('a replay fork re-resolves the secret and still carries it on no readable surface', async () => {
    const why = await gate(BYOK); if (why) return skip(why);
    const replay = await familyAdvertised('replay');
    if (!replay) return softSkip('inapplicable', 'replay family not advertised — no fork, no replay state');
    const modes = Array.isArray(replay['modes']) ? (replay['modes'] as unknown[]).map(String) : [];
    const mode = modes.includes('replay') ? 'replay' : modes.includes('branch') ? 'branch' : null;
    if (mode === null) return softSkip('inapplicable', `replay.modes names neither replay nor branch (${JSON.stringify(modes)})`);
    const run = await byokRun(); if ('reason' in run) return softSkip('blocked', run.reason);
    const started = run.events.find((e) => e.type === 'node.started' && e.nodeId === RESOLVE_NODE && typeof e.sequence === 'number');
    if (started === undefined) return softSkip('blocked', `the byok run's log has no node.started for ${RESOLVE_NODE} — no fork point before the resolve`);
    const fork = await http(() => driver.post(`/runs/${enc(run.runId)}:fork`, { mode, fromSeq: started.sequence }));
    if (fork === null) return softSkip('blocked', 'POST /runs/{runId}:fork unreachable (fetch failed)');
    const forkId = (fork.json as { runId?: unknown } | undefined)?.runId;
    if (fork.status !== 201 || typeof forkId !== 'string') return softSkip('blocked', `POST /runs/{runId}:fork {mode: ${mode}, fromSeq: ${String(started.sequence)}} answered ${fork.status} ${readErrorCode(fork.json) ?? ''} — v2-run-fork-refusals / v2-run-fork-prefix own the fork contract`.trim());
    const forked = await readRun(forkId, fork, `fork (${mode})`); if ('reason' in forked) return softSkip('blocked', forked.reason);
    const detectors = detectorsFor([...forked.docs, ...run.docs]);
    if (detectors.length === 0) return softSkip('inapplicable', NO_DETECTOR);
    const found = leaks(forked.surfaces, detectors);
    expect(found, req(ID_FORK, DOC, `the plaintext MUST stay out of replay state — a ${mode} fork that re-resolved the canary carried it on: ${found.join(' | ')}`)).toEqual([]);
  }, 90_000);
});
