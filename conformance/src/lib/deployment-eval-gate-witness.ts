/**
 * RFC 0082 §E — eval-gated promotion at major 2. Pure judges over one
 * `transitionAgentDeployment` promote that cites a failed eval run, and the
 * deployment records read before and after it, for
 * `v2-deployment-eval-gate.test.ts`.
 *
 * The rule is the `agents.deployment` facet description: when the gate
 * carries `requiredEval`, the host MUST verify the eval run is terminal and
 * passed before `deployment.promoted`, else deny with `eval_gate_unmet`
 * (`422`, `spec/v2/errors.json`). A host opts in by listing
 * `conformance-eval-gate-failing`, which declares that its promote of the
 * scripted agent is so gated (`conformance/fixtures.md`).
 *
 * @see RFCS/0082-agent-deployment-lifecycle.md §E
 */

import { readErrorCode } from './error-envelope.js';

export interface GateFinding { readonly ok: boolean; readonly message: string }
export interface Answer { readonly status: number; readonly json: unknown }
type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The states a `promote` leaves: the record moves toward `active`. */
export const PROMOTABLE = ['draft', 'test', 'staged'] as const;

/** The first record a promote can advance, or undefined. */
export function pickPromotable(records: unknown): Rec | undefined {
  if (!Array.isArray(records)) return undefined;
  return records.find((r): r is Rec => isRec(r) && typeof r['version'] === 'string' && (PROMOTABLE as readonly string[]).includes(String(r['state'])));
}

/** The promote is refused `422 eval_gate_unmet`. */
export function judgeGateRefused(a: Answer): GateFinding[] {
  const code = readErrorCode(a.json);
  return [
    { ok: a.status === 422, message: `a promote citing a failed eval run MUST be refused 422 (got ${a.status} ${code ?? ''})`.trim() },
    { ok: code === 'eval_gate_unmet', message: `the refusal MUST carry the registered code eval_gate_unmet (got ${JSON.stringify(code)})` },
  ];
}

/** The refused promote left the version's record as it was. */
export function judgeRecordUnchanged(before: Rec, after: unknown): GateFinding[] {
  const version = before['version'];
  const now = Array.isArray(after) ? after.find((r): r is Rec => isRec(r) && r['version'] === version) : undefined;
  if (now === undefined) return [{ ok: false, message: `the deployment record for version ${String(version)} MUST still be listed after the refused promote` }];
  const same = (k: string): boolean => JSON.stringify(before[k]) === JSON.stringify(now[k]);
  return [
    { ok: same('state'), message: `a refused promote MUST NOT change state (was ${JSON.stringify(before['state'])}, now ${JSON.stringify(now['state'])})` },
    { ok: same('channels'), message: `a refused promote MUST NOT bind channels (was ${JSON.stringify(before['channels'])}, now ${JSON.stringify(now['channels'])})` },
    { ok: same('canaryPercent'), message: `a refused promote MUST NOT change canaryPercent (was ${JSON.stringify(before['canaryPercent'])}, now ${JSON.stringify(now['canaryPercent'])})` },
  ];
}
