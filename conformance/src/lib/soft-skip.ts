/**
 * RFC 0148 §A — say WHY a scenario returned early.
 *
 * A test that returns before its first `expect` reports to vitest as a pass
 * with zero assertions. Under the ledger that is an UNCLASSIFIED return: the
 * runner cannot tell "capability not advertised" from "seam not mounted" from
 * "operator opted out". `behaviorGate` records the first two cases for
 * profile-gated files; every other early return in the corpus was silent.
 *
 * `softSkip(kind, reason)` notes the reason for the CURRENT test file (from
 * vitest's `expect.getState().testPath`) and returns `undefined`, so an
 * early return becomes one expression:
 *
 *   if (!(await advertised())) return softSkip('inapplicable', 'host does not advertise X');
 *   if (res.status === 404) return softSkip('blocked', 'seam /v1/host/sample/... not mounted');
 *
 * `setup.ts` reads the notes when it records the file: a file whose passes are
 * all zero-assertion takes the noted disposition (`inapplicable` / `skipped` /
 * `blocked`, worst-first if mixed) with the joined reasons; a file with real
 * assertions is `executed-pass` regardless of notes. A zero-assertion file with
 * NO note at all is recorded `blocked` — "unclassified return; RFC 0148 §A
 * resolves it to blocked" — and stays UNCLASSIFIED for certification (a floor
 * row with that disposition still rejects), so the honest bundle row and the
 * pressure to say why both survive.
 */

import { expect } from 'vitest';
import { basename } from 'node:path';

export type SoftSkipKind = 'inapplicable' | 'skipped' | 'blocked';

/** Detail marker the runner writes for a zero-assertion file that noted nothing. */
export const UNCLASSIFIED_RETURN_DETAIL = 'every test returned early with zero assertions and no recorded reason — unclassified return; RFC 0148 §A resolves it to blocked (add softSkip(kind, reason) at the early return)';

const notes = new Map<string, Array<{ kind: SoftSkipKind; reason: string }>>();

function currentFile(): string | null {
  try {
    const p = (expect.getState() as { testPath?: string }).testPath;
    return typeof p === 'string' && p.length > 0 ? basename(p) : null;
  } catch {
    return null;
  }
}

/** Note an early return for the current file. Returns undefined so `return softSkip(...)` reads naturally. */
export function softSkip(kind: SoftSkipKind, reason: string): undefined {
  const file = currentFile();
  if (file === null) return undefined;
  const arr = notes.get(file) ?? [];
  if (!arr.some((n) => n.kind === kind && n.reason === reason)) arr.push({ kind, reason });
  notes.set(file, arr);
  return undefined;
}

/**
 * An advertised capability whose observation seam is absent or refused
 * (404 / 403 / `null` from a seam helper): the host made a claim the suite
 * cannot check. Default mode notes `blocked` with the reason (RFC 0148 §A);
 * under `OPENWOP_REQUIRE_BEHAVIOR=true` it FAILS (RFC 0148 §B / RFC 0139 G14
 * flip) — advertised behaviour MUST be present. Use as `return seamAbsent(...)`.
 */
export function seamAbsent(reason: string): undefined {
  if (process.env['OPENWOP_REQUIRE_BEHAVIOR'] === 'true') {
    throw new Error(`RFC 0148 §B: advertised behaviour is not observable — ${reason} (OPENWOP_REQUIRE_BEHAVIOR=true fails an advertised-missing seam)`);
  }
  return softSkip('blocked', reason);
}

const RANK: Record<SoftSkipKind, number> = { blocked: 0, skipped: 1, inapplicable: 2 };

/**
 * The noted disposition for a file, worst-first when mixed (`blocked` beats
 * `skipped` beats `inapplicable` — a file that could not check one thing is
 * not certifiable on the strength of another thing being inapplicable), with
 * the reasons joined. `null` when nothing was noted.
 */
export function softSkipDisposition(file: string): { kind: SoftSkipKind; reason: string } | null {
  const arr = notes.get(file);
  if (arr === undefined || arr.length === 0) return null;
  const kind = [...arr].sort((a, b) => RANK[a.kind] - RANK[b.kind])[0]!.kind;
  const reason = arr.map((n) => (arr.length > 1 ? `[${n.kind}] ${n.reason}` : n.reason)).join('; ');
  return { kind, reason };
}

/** Test hook. */
export function resetSoftSkips(): void {
  notes.clear();
}
