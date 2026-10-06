/**
 * The WASM memory ceiling (`spec/v2/core/node-pack-runtimes.md` §WASM; RFC 0008
 * §K), observed through run creation and the event poll against the
 * operator-installed `vendor.openwop.misbehaving` fixture pack
 * (`conformance/fixtures/wasm-packs/misbehaving-memory/`), whose one node grows
 * linear memory until the host refuses.
 *
 * `memoryCapLeg` observes and returns findings or the reason it could not run;
 * `judgeMemoryCap` is pure. The scenario and the self-test double run the same code.
 */

import { v2Discovery } from './v2.js';
import { majorProfile } from './major-profile.js';
import { observeRun, type ObservedRun } from './fixture-run-observer.js';

export const MEMORY_CAP_FIXTURE = 'conformance-wasm-pack-memory-cap-breach';
export const BOMB_TYPE_ID = 'vendor.openwop.misbehaving.memory-bomb';

export type Skip = { readonly kind: 'skip'; readonly skip: 'blocked' | 'inapplicable'; readonly reason: string };
export type LegOutcome = { readonly kind: 'observed'; readonly findings: string[] } | Skip;
const skip = (s: 'blocked' | 'inapplicable', reason: string): Skip => ({ kind: 'skip', skip: s, reason });
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A breach emits `cap.breached` `kind: wasm-memory` and the run ends `failed`. */
export function judgeMemoryCap(o: ObservedRun): string[] {
  const out: string[] = [];
  if (o.createStatus !== 201 && o.createStatus !== 202) return [`createRun of ${MEMORY_CAP_FIXTURE} MUST be accepted (got ${o.createStatus})`];
  const breaches = o.events.filter((e) => e.type === 'cap.breached' && e.payload['kind'] === 'wasm-memory');
  if (breaches.length === 0) out.push(`a module exceeding maxMemoryBytes MUST produce cap.breached with kind wasm-memory; the log has ${o.events.filter((e) => e.type === 'cap.breached').map((e) => String(e.payload['kind'])).join(', ') || 'no cap.breached'}`);
  if (o.terminalStatus !== 'failed') out.push(`the run MUST end failed after the breach (got ${String(o.terminalStatus)})`);
  return out;
}

/** node-pack-runtimes.md §WASM bullet 2 — `openwop.requirement.node-pack-runtimes.wasm-memory-cap`. */
export async function memoryCapLeg(): Promise<LegOutcome> {
  let doc: Record<string, unknown> | null = null;
  try { doc = await v2Discovery(); } catch { doc = null; }
  if (!doc) return skip('blocked', 'v2 discovery unreachable');
  const fam = doc['nodePackRuntimes'];
  const wasm = isRecord(fam) ? fam['wasm'] : undefined;
  if (!isRecord(wasm)) return skip('inapplicable', 'the host does not advertise nodePackRuntimes.wasm');
  if (typeof wasm['maxMemoryBytes'] !== 'number') return skip('inapplicable', 'the host advertises no nodePackRuntimes.wasm.maxMemoryBytes; the enforcement MUST binds only when it does');
  const fixtures = Array.isArray(doc['fixtures']) ? (doc['fixtures'] as unknown[]) : [];
  if (!fixtures.includes(MEMORY_CAP_FIXTURE)) return skip('inapplicable', `the host does not advertise ${MEMORY_CAP_FIXTURE}; the operator installs conformance/fixtures/wasm-packs/misbehaving-memory/ to run it`);
  return { kind: 'observed', findings: judgeMemoryCap(await observeRun(majorProfile(2), MEMORY_CAP_FIXTURE, { timeoutMs: 30_000 })) };
}
