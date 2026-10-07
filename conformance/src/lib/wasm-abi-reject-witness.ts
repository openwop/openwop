/**
 * The WASM ABI check (`spec/v2/core/node-pack-runtimes.md` §WASM: a host "MUST
 * reject at load a pack whose `openwop_abi_version()` is not listed"; RFC 0008
 * §H), observed through discovery and run creation against the
 * operator-installed `vendor.openwop.misbehaving-abi` fixture pack
 * (`conformance/fixtures/wasm-packs/misbehaving-abi/`), whose module reports
 * ABI version 999.
 *
 * Loading is not a protocol operation, so the refusal is read from what it
 * makes impossible. A host advertising `conformance-wasm-pack-abi-mismatch`
 * says its operator offered the pack to its loader. Rejected at load, the pack
 * is absent from `nodePackRuntimes.wasm.loadedPacks` (when advertised), and its
 * one node never runs: the fixture's run is refused at creation or ends
 * without that node completing.
 *
 * `abiRejectLeg` observes and returns findings or the reason it could not run;
 * `judgeAbiReject` is pure. The scenario and the self-test double run the same code.
 */

import { v2Discovery } from './v2.js';
import { majorProfile } from './major-profile.js';
import { completionsOf, observeRun, type ObservedRun } from './fixture-run-observer.js';

export const ABI_FIXTURE = 'conformance-wasm-pack-abi-mismatch';
export const ABI_PACK = 'vendor.openwop.misbehaving-abi';
export const ABI_NODE = 'abi';

export type Skip = { readonly kind: 'skip'; readonly skip: 'blocked' | 'inapplicable'; readonly reason: string };
export type LegOutcome = { readonly kind: 'observed'; readonly findings: string[] } | Skip;
const skip = (s: 'blocked' | 'inapplicable', reason: string): Skip => ({ kind: 'skip', skip: s, reason });
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

/** A create the host refused on its merits, not for want of access or by its own fault. */
const refusedAtCreate = (status: number): boolean => status >= 400 && status < 500 && status !== 401 && status !== 403 && status !== 429;

/** The pack is not loaded, and its node never completes. */
export function judgeAbiReject(loadedPacks: unknown, o: ObservedRun): string[] {
  const out: string[] = [];
  if (Array.isArray(loadedPacks) && loadedPacks.includes(ABI_PACK)) out.push(`nodePackRuntimes.wasm.loadedPacks MUST NOT list ${ABI_PACK}, whose openwop_abi_version() 999 no host lists; it does`);
  if (o.createStatus === 201 || o.createStatus === 202) {
    if (completionsOf(o.events, ABI_NODE).length > 0 || o.terminalStatus === 'completed') {
      out.push(`the ${ABI_PACK} node ran (node.completed, run ${String(o.terminalStatus)}): a pack whose ABI version is not listed MUST be rejected at load, so its node cannot execute`);
    } else if (o.terminalStatus === undefined || !TERMINAL.has(o.terminalStatus)) {
      out.push(`the ${ABI_FIXTURE} run MUST be refused at creation or end without the node completing; it is still ${String(o.terminalStatus)}`);
    }
  } else if (!refusedAtCreate(o.createStatus)) {
    out.push(`createRun of ${ABI_FIXTURE} answered ${o.createStatus}; a refusal of an unloaded node is a 4xx`);
  }
  return out;
}

/** node-pack-runtimes.md §WASM bullet 1 — `openwop.requirement.node-pack-runtimes.wasm-abi-reject`. */
export async function abiRejectLeg(): Promise<LegOutcome> {
  let doc: Record<string, unknown> | null = null;
  try { doc = await v2Discovery(); } catch { doc = null; }
  if (!doc) return skip('blocked', 'v2 discovery unreachable');
  const fam = doc['nodePackRuntimes'];
  const wasm = isRecord(fam) ? fam['wasm'] : undefined;
  if (!isRecord(wasm)) return skip('inapplicable', 'the host does not advertise nodePackRuntimes.wasm');
  const fixtures = Array.isArray(doc['fixtures']) ? (doc['fixtures'] as unknown[]) : [];
  if (!fixtures.includes(ABI_FIXTURE)) return skip('inapplicable', `the host does not advertise ${ABI_FIXTURE}; the operator offers conformance/fixtures/wasm-packs/misbehaving-abi/ to the loader to run it`);
  const o = await observeRun(majorProfile(2), ABI_FIXTURE, { timeoutMs: 30_000 });
  if (o.createStatus === 401 || o.createStatus === 403 || o.createStatus === 429 || o.createStatus >= 500) return skip('blocked', `createRun of ${ABI_FIXTURE} answered ${o.createStatus}`);
  return { kind: 'observed', findings: judgeAbiReject(wasm['loadedPacks'], o) };
}
