/**
 * v2 — `mode: eval` on a host that does not advertise `agents.evalSuite` is
 * refused `422 capability_not_provided` (`spec/v2/core/runs.md` §Refusals).
 *
 * The v1 eval scenarios (`agent-eval-run`, `agent-eval-suite-shape`) run at
 * major 1 only and return early when the capability is absent, so nothing
 * measured this refusal at major 2. The leg is unaided: the suite reads
 * discovery and posts one create.
 *
 * The body is a complete eval create (`mode`, `evalSuiteRef`, `agentId`), so a
 * `400 validation_error` is not an honest answer to it: the only thing wrong
 * with the request is that the host does not run eval suites.
 *
 * A host that advertises `agents.evalSuite` records the leg `inapplicable`.
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { readErrorCode } from '../lib/error-envelope.js';

const ID = 'openwop.requirement.runs.eval-mode-unadvertised-refused';
const DOC = 'spec/v2/core/runs.md §Refusals';

async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}

describe('v2 eval mode is refused where agents.evalSuite is not advertised (runs.md §Refusals)', () => {
  it('POST /runs {mode: "eval"} answers 422 capability_not_provided and creates no run', async () => {
    let doc: Record<string, unknown> | null;
    try { doc = await v2Discovery(); } catch { doc = null; }
    if (!doc) return softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 with a JSON body under OpenWOP-Version: 2.0');
    const agents = doc['agents'];
    const evalSuite = agents !== null && typeof agents === 'object' && !Array.isArray(agents) ? (agents as Record<string, unknown>)['evalSuite'] : undefined;
    if (evalSuite !== undefined && evalSuite !== null) return softSkip('inapplicable', 'the host advertises agents.evalSuite — mode: eval is served');

    const res = await http(() => driver.post('/runs', {
      mode: 'eval',
      evalSuiteRef: 'https://conformance.openwop.dev/eval-suites/unadvertised-probe',
      agentId: 'conformance-eval-unadvertised-probe',
    }));
    if (res === null) return softSkip('blocked', 'POST /runs unreachable (fetch failed)');
    if (res.status === 429) return softSkip('blocked', 'POST /runs answered 429 — the run budget, not the wire');

    // A host that accepted the create started something. Stop it before asserting, so a failing row leaves no run behind.
    const runId = (res.json as { runId?: unknown } | undefined)?.runId;
    if (res.status === 201 && typeof runId === 'string') await http(() => driver.post(`/runs/${encodeURIComponent(runId)}/cancel`, {}));

    expect(res.status, req(ID, DOC, `a host that does not advertise agents.evalSuite MUST reject mode: eval with 422 (got ${res.status} ${readErrorCode(res.json) ?? ''})`.trim())).toBe(422);
    expect(readErrorCode(res.json), req(ID, DOC, 'the 422 for an unadvertised eval mode MUST carry the registered code capability_not_provided')).toBe('capability_not_provided');
  });
});
