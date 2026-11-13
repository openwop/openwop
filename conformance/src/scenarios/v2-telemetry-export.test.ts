/**
 * v2 — the `telemetry` family: a host exports OTLP traces (RFC 0262; the rules
 * are `spec/v2/core/telemetry.md`, the facets `spec/v2/facets/telemetry.schema.json`).
 *
 * Server-free (always on):
 *   1. `0262.shape` — the generated `telemetry` record requires `otlp` with a
 *      non-empty `protocols` from the closed transport vocabulary; the optional
 *      `genAiSemconv` is a semver string.
 *
 * Host legs — gated on the `telemetry` family record AND on the suite's OTLP
 * collector (`OPENWOP_OTEL_COLLECTOR=true`, the host's exporter pointed at it
 * with `OTEL_EXPORTER_OTLP_ENDPOINT`). The host calls the suite, so a host in
 * another network namespace records `blocked`, not a failure.
 *   2. `0262.run-span` — a `conformance-noop` run exports an `openwop.run` span
 *      carrying its `openwop.run_id` and `openwop.workflow_id`.
 *   3. `0262.node-span` — the same run exports an `openwop.node.<typeId>` span
 *      carrying `openwop.node_id`, `openwop.node_type` and a non-negative
 *      `openwop.node_attempt`.
 *   4. `0262.traceparent-continued` — a run created with a suite-minted
 *      `traceparent` exports its spans under that `traceId`.
 *   5. `0262.no-secret-in-spans` — after an `openwop-smoke-byok-roundtrip` run,
 *      no captured span name, attribute or resource attribute carries the store
 *      canary (digest detector, plus the plaintext when the operator supplies
 *      `OPENWOP_CANARY_SECRET_VALUE`; `lib/secret-scan.ts`).
 *   6. `0262.gen-ai-attributes` — gated on `telemetry.genAiSemconv` and the
 *      `conformance-callai-attempt-accounting` fixture: the model-call span
 *      carries `gen_ai.operation.name`, a provider attribute, `gen_ai.request.model`
 *      and both usage-token attributes.
 *
 * A host leg whose run exported NO span records `blocked`: an empty export is
 * not a pass, so a host that advertises the family and exports nothing cannot
 * certify (RFC 0262 R2).
 *
 * @see RFCS/0262-telemetry-family.md
 * @see spec/v2/core/telemetry.md
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { familyAdvertised, v2Discovery, v2RefValidator } from '../lib/v2.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { getCollector, waitForRunSpans, type CapturedSpan } from '../lib/otel-collector.js';
import { digestDetector, findSecretDigest, leaks, valueDetector, type SecretDetector, type Surface } from '../lib/secret-scan.js';

/**
 * Callback-shaped: the host exports OTLP to the suite's collector.
 * Unwitnessable when the host is in a separate network namespace — see
 * `../lib/host-callback.ts`. Not host non-conformance.
 */
export const REQUIRES_HOST_CALLBACK = "the host exports OTLP traces to the suite's collector";

const DOC = 'spec/v2/core/telemetry.md (RFC 0262)';
const R = (slug: string): string => `openwop.requirement.0262.${slug}`;
const NOOP = 'conformance-noop';
const BYOK = 'openwop-smoke-byok-roundtrip';
const CALLAI = 'conformance-callai-attempt-accounting';

type Skip = { skip: ['inapplicable' | 'blocked', string] };
const skipped = (s: Skip): undefined => softSkip(s.skip[0], s.skip[1]);
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> { try { return await fn(); } catch { return null; } }

/** The family record, or why the host legs do not bind. */
async function gate(fixture: string): Promise<Skip | { record: Record<string, unknown> }> {
  if (!(await v2Discovery())) return { skip: ['blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 under OpenWOP-Version: 2.0'] };
  const record = await familyAdvertised('telemetry');
  if (record === null) return { skip: ['inapplicable', 'the telemetry family is not advertised — no export claim'] };
  if (!getCollector()) return { skip: ['blocked', 'the suite OTLP collector is not running (set OPENWOP_OTEL_COLLECTOR=true and point the host exporter at it)'] };
  if (!isFixtureAdvertised(fixture)) return { skip: ['inapplicable', `fixture ${fixture} is not advertised`] };
  return { record };
}

/** Start a run, wait for it to settle, then wait for its exported spans. */
async function exportedRun(body: Record<string, unknown>, headers?: Record<string, string>): Promise<Skip | { runId: string; created: OpenWOPResponse; spans: readonly CapturedSpan[] }> {
  const created = await http(() => driver.post('/runs', body, headers ? { headers } : {}));
  const runId = isRec(created?.json) ? created.json['runId'] : undefined;
  if (created === null || created.status !== 201 || typeof runId !== 'string') return { skip: ['blocked', `POST /runs (${String(body['workflowId'])}) answered ${created?.status ?? 'nothing'} ${readErrorCode(created?.json) ?? ''}`.trim()] };
  try { await pollUntilTerminal(runId, { timeoutMs: 20_000 }); } catch { return { skip: ['blocked', `run ${runId} did not settle within 20 s`] }; }
  const spans = await waitForRunSpans(runId, { timeoutMs: 8_000, minCount: 2 });
  if (spans.length === 0) return { skip: ['blocked', `the collector captured no span carrying openwop.run_id ${runId} — the host advertised telemetry but nothing arrived (an empty export is not a pass)`] };
  return { runId, created, spans };
}

let noopRun: ReturnType<typeof exportedRun> | undefined;
const noop = (): ReturnType<typeof exportedRun> => {
  if (!noopRun) { getCollector()?.reset(); noopRun = exportedRun({ workflowId: NOOP }); }
  return noopRun;
};

function spanSurfaces(spans: readonly CapturedSpan[]): Surface[] {
  return spans.map((s) => ({
    name: `span ${s.name}`,
    text: JSON.stringify({ name: s.name, attributes: Object.fromEntries(s.attributes), resource: Object.fromEntries(s.resourceAttributes) }),
  }));
}

describe('v2 RFC 0262 — telemetry facet shape (server-free)', () => {
  it('the telemetry record requires otlp.protocols from the closed transports; genAiSemconv is semver', () => {
    const v = v2RefValidator('capabilities.schema.json#/properties/telemetry');
    const base = { status: 'experimental', since: '2.0', witness: 'witnessable-gated' };
    expect(v({ ...base, otlp: { protocols: ['http/protobuf'] } }).ok, req(R('shape'), DOC, 'a record with otlp.protocols MUST validate')).toBe(true);
    expect(v({ ...base, otlp: { protocols: ['grpc', 'http/json'] }, genAiSemconv: '1.37.0' }).ok, req(R('shape'), DOC, 'genAiSemconv as semver MUST validate')).toBe(true);
    expect(v({ ...base }).ok, req(R('shape'), DOC, 'otlp is REQUIRED')).toBe(false);
    expect(v({ ...base, otlp: { protocols: [] } }).ok, req(R('shape'), DOC, 'protocols MUST be non-empty')).toBe(false);
    expect(v({ ...base, otlp: { protocols: ['zipkin'] } }).ok, req(R('shape'), DOC, 'an unknown transport MUST fail')).toBe(false);
    expect(v({ ...base, otlp: { protocols: ['grpc'] }, genAiSemconv: 'latest' }).ok, req(R('shape'), DOC, 'a non-semver genAiSemconv MUST fail')).toBe(false);
  });
});

describe('v2 RFC 0262 — OTLP export (host, telemetry-gated)', () => {
  it('a run exports an openwop.run span with its run and workflow ids', async () => {
    const g = await gate(NOOP);
    if ('skip' in g) return skipped(g);
    const r = await noop();
    if ('skip' in r) return skipped(r);
    const run = r.spans.find((s) => s.name === 'openwop.run' || s.name.startsWith('openwop.run.'));
    expect(run, req(R('run-span'), DOC, 'every run MUST produce a span named openwop.run carrying openwop.run_id')).toBeDefined();
    expect(run?.attributes.get('openwop.workflow_id'), req(R('run-span'), DOC, 'the run span MUST carry openwop.workflow_id')).toBe(NOOP);
  });

  it('each node execution exports an openwop.node.<typeId> span with its node attributes', async () => {
    const g = await gate(NOOP);
    if ('skip' in g) return skipped(g);
    const r = await noop();
    if ('skip' in r) return skipped(r);
    const node = r.spans.find((s) => s.name.startsWith('openwop.node.'));
    expect(node, req(R('node-span'), DOC, 'every node execution MUST produce a span named openwop.node.<typeId>')).toBeDefined();
    expect(typeof node?.attributes.get('openwop.node_id'), req(R('node-span'), DOC, 'the node span MUST carry openwop.node_id')).toBe('string');
    const type = node?.attributes.get('openwop.node_type');
    expect(typeof type === 'string' && node?.name === `openwop.node.${type}`, req(R('node-span'), DOC, 'the node span MUST carry openwop.node_type, and its name MUST be openwop.node.<typeId>')).toBe(true);
    const attempt = node?.attributes.get('openwop.node_attempt');
    expect(typeof attempt === 'number' && Number.isInteger(attempt) && attempt >= 0, req(R('node-span'), DOC, 'openwop.node_attempt MUST be a non-negative integer')).toBe(true);
  });

  it('a run created with a traceparent exports its spans in that trace', async () => {
    const g = await gate(NOOP);
    if ('skip' in g) return skipped(g);
    const traceId = '0af7651916cd43dd8448eb211c80319c';
    const r = await exportedRun({ workflowId: NOOP }, { traceparent: `00-${traceId}-b7ad6b7169203331-01` });
    if ('skip' in r) return skipped(r);
    const inTrace = r.spans.filter((s) => s.traceId.toLowerCase() === traceId);
    expect(inTrace.length, req(R('traceparent-continued'), DOC, 'a run created with a valid W3C traceparent MUST emit its spans in that trace')).toBe(r.spans.length);
  });

  it('no exported span carries the resolved store secret', async () => {
    const g = await gate(BYOK);
    if ('skip' in g) return skipped(g);
    if (!(await familyAdvertised('secrets'))) return softSkip('inapplicable', 'the secrets family is not advertised, so the store-canary fixture binds nothing');
    const r = await exportedRun({ workflowId: BYOK });
    if ('skip' in r) return skipped(r);
    const snap = await http(() => driver.get(`/runs/${encodeURIComponent(r.runId)}`));
    const poll = await http(() => driver.get(`/runs/${encodeURIComponent(r.runId)}/events/poll?timeout=1&streamMode=debug`));
    const detectors: SecretDetector[] = [];
    const digest = findSecretDigest([r.created.json, snap?.json, poll?.json]);
    if (digest !== null) detectors.push(digestDetector(digest.sha256, digest.length));
    const operator = process.env['OPENWOP_CANARY_SECRET_VALUE'];
    if (operator && operator.length > 0) detectors.push(valueDetector(operator));
    if (detectors.length === 0) return softSkip('inapplicable', 'the run surfaced no {secretSha256, secretLength} and OPENWOP_CANARY_SECRET_VALUE is unset — nothing can be recognised as the canary');
    const found = leaks(spanSurfaces(r.spans), detectors);
    expect(found, req(R('no-secret-in-spans'), DOC, 'a span name, attribute, event or resource attribute MUST NOT carry a resolved secret')).toEqual([]);
  });

  it('a host advertising genAiSemconv puts the gen_ai attributes on the model-call span', async () => {
    const g = await gate(CALLAI);
    if ('skip' in g) return skipped(g);
    const version = g.record['genAiSemconv'];
    if (typeof version !== 'string') return softSkip('inapplicable', 'telemetry.genAiSemconv is not advertised — no GenAI mapping claim');
    const r = await exportedRun({ workflowId: CALLAI, inputs: { request: { prompt: 'conformance', maxTokens: 64 }, script: [{ kind: 'valid', outputTokens: 5 }] } });
    if ('skip' in r) return skipped(r);
    const call = r.spans.find((s) => s.attributes.has('gen_ai.operation.name'));
    expect(call, req(R('gen-ai-attributes'), DOC, `with genAiSemconv ${version}, each model-call span MUST carry gen_ai.operation.name`)).toBeDefined();
    const has = (k: string): boolean => call?.attributes.get(k) !== undefined && call?.attributes.get(k) !== null;
    expect(has('gen_ai.provider.name') || has('gen_ai.system'), req(R('gen-ai-attributes'), DOC, 'the model-call span MUST carry the provider attribute its version names')).toBe(true);
    expect(has('gen_ai.request.model'), req(R('gen-ai-attributes'), DOC, 'the model-call span MUST carry gen_ai.request.model')).toBe(true);
    expect(has('gen_ai.usage.input_tokens') && has('gen_ai.usage.output_tokens'), req(R('gen-ai-attributes'), DOC, 'the model-call span MUST carry input and output token usage')).toBe(true);
  });
});
