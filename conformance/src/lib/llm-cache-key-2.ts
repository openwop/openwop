/**
 * RFC 0260 — LLM cache key recipe 2 (`openwop-llm-key-2`). A pure function: the
 * suite recomputes the key a host recorded and compares (§B, `0260.key-portable`).
 *
 *   key = hex(SHA-256(JCS({ recipe, model, provider, messages, tools, toolChoice,
 *                           responseSchema, params })))
 *
 * `params` names every sampling or output-shaping parameter; one the host did not
 * send is `null`, never omitted. `stop` is sorted (UTF-16 code-unit order, as JCS
 * orders keys) and de-duplicated. Any other parameter sits under `params.extra`.
 * A string message content is the one-part array `[{type: "text", text}]`. No
 * Unicode normalisation: the bytes are as sent.
 */
import { createHash } from 'node:crypto';
import { canonicalJSON, codeUnitCompare } from './jcs.js';

export const RECIPE_2 = 'openwop-llm-key-2';

/** The parameters recipe 2 names. A request that omits one puts `null` in the key. */
export const NAMED_PARAMS = ['temperature', 'maxTokens', 'stop', 'seed', 'topP', 'topK', 'frequencyPenalty', 'presencePenalty'] as const;
export type NamedParam = (typeof NAMED_PARAMS)[number];

export interface KeyInputs {
  readonly model: string;
  readonly provider: string;
  readonly messages: readonly { readonly role: string; readonly content: string | readonly Record<string, unknown>[] }[];
  readonly tools?: readonly unknown[];
  readonly toolChoice?: unknown;
  readonly responseSchema?: unknown;
  readonly params?: Partial<Record<NamedParam, unknown>> & { readonly extra?: Record<string, unknown> };
}

const nullIfAbsent = (v: unknown): unknown => (v === undefined ? null : v);

/** The object recipe 2 hashes, before canonicalization. Exported so a failure can show what was hashed. */
export function keyPreimage(i: KeyInputs): Record<string, unknown> {
  const p = i.params ?? {};
  const params: Record<string, unknown> = {};
  for (const name of NAMED_PARAMS) params[name] = nullIfAbsent(p[name]);
  if (Array.isArray(params['stop'])) params['stop'] = [...new Set((params['stop'] as unknown[]).map(String))].sort(codeUnitCompare);
  if (p.extra !== undefined && Object.keys(p.extra).length > 0) params['extra'] = p.extra;
  return {
    recipe: RECIPE_2,
    model: i.model,
    provider: i.provider,
    messages: i.messages.map((m) => ({ role: m.role, content: typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content })),
    tools: i.tools ?? [],
    toolChoice: nullIfAbsent(i.toolChoice),
    responseSchema: nullIfAbsent(i.responseSchema),
    params,
  };
}

export function cacheKey2(i: KeyInputs): string {
  return createHash('sha256').update(canonicalJSON(keyPreimage(i)), 'utf8').digest('hex');
}

/**
 * The inputs the `conformance-llm-cache-key` fixture pins (conformance/fixtures.md
 * §The LLM cache-key fixture): the host's conformance mock is provider
 * `conformance-mock`, model `conformance-mock-1`; the node sends one user message,
 * no tools, no toolChoice, no responseSchema, and exactly the parameters in the
 * run's `inputs.request.params`.
 */
export const FIXTURE = 'conformance-llm-cache-key';
export const NODE_ID = 'llm-call';
export const FIXTURE_PROVIDER = 'conformance-mock';
export const FIXTURE_MODEL = 'conformance-mock-1';
export function fixtureInputs(prompt: string, params: Partial<Record<NamedParam, unknown>>): KeyInputs {
  return { model: FIXTURE_MODEL, provider: FIXTURE_PROVIDER, messages: [{ role: 'user', content: prompt }], params };
}

// ── Judges. Each returns findings and asserts nothing; the scenario frames them with req(). ──

export interface Finding { readonly ok: boolean; readonly message: string }
const f = (ok: boolean, message: string): Finding => ({ ok, message });

/** The `cacheKey` member of the fixture node's provider-call record on GET /runs/{runId}/effects, or undefined. */
export interface LedgerKey { readonly recipe?: unknown; readonly digest?: unknown }

export function readLedgerKey(projection: unknown, nodeId: string): LedgerKey | undefined | 'no-record' {
  const effects = (projection as { effects?: unknown } | null)?.effects;
  if (!Array.isArray(effects)) return 'no-record';
  const mine = effects.filter((e) => (e as { nodeId?: unknown } | null)?.nodeId === nodeId);
  if (mine.length === 0) return 'no-record';
  const withKey = mine.find((e) => (e as { cacheKey?: unknown }).cacheKey !== undefined) as { cacheKey?: LedgerKey } | undefined;
  return withKey?.cacheKey;
}

const HEX64 = /^[0-9a-f]{64}$/;

export function judgeRecorded(key: LedgerKey | undefined): Finding[] {
  return [
    f(key !== undefined, 'the provider-call record MUST carry cacheKey when replay.llmCacheKeyRecipe is advertised'),
    f(key?.recipe === RECIPE_2, `cacheKey.recipe MUST be "${RECIPE_2}" (got ${JSON.stringify(key?.recipe)})`),
    f(typeof key?.digest === 'string' && HEX64.test(key.digest), `cacheKey.digest MUST be 64 lowercase hex characters (got ${JSON.stringify(key?.digest)})`),
  ];
}

/** Two invocations that differ only in one named parameter MUST NOT share a key. */
export function judgeParamsInKey(a: LedgerKey | undefined, b: LedgerKey | undefined): Finding[] {
  return [f(typeof a?.digest === 'string' && typeof b?.digest === 'string' && a.digest !== b.digest, `invocations differing only in maxTokens MUST have different keys (got ${String(a?.digest)} twice)`)];
}

/** The same inputs MUST give the same key. */
export function judgeStable(a: LedgerKey | undefined, b: LedgerKey | undefined): Finding[] {
  return [f(typeof a?.digest === 'string' && a.digest === b?.digest, `identical invocations MUST have the same key (got ${String(a?.digest)} and ${String(b?.digest)})`)];
}

/** The host's key MUST equal the recipe computed from the inputs the fixture pins. */
export function judgePortable(key: LedgerKey | undefined, expected: KeyInputs): Finding[] {
  const want = cacheKey2(expected);
  return [f(key?.digest === want, `cacheKey.digest MUST equal recipe 2 over the fixture's inputs: expected ${want}, got ${String(key?.digest)} (preimage ${canonicalJSON(keyPreimage(expected))})`)];
}
