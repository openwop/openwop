/**
 * v2 — `header-scheme` (suite 2.0.0; RFC 0171 §C.1; RFC 0172 §A.4;
 * `spec/v2/core/headers.md` §"Removed in v2"; `spec/v2/core/versioning.md` §1.4).
 *
 * Witness class: witnessable — unaided. Every non-standard header is
 * `OpenWOP-<Name>`; `Capabilities-Etag`, `X-Dedup` and the `X-openwop-*` family
 * are removed from the v2 representation. Every response on any path MUST
 * carry `OpenWOP-Version: <major>.<minor>`. The responses inspected are the
 * v2 discovery document, a deliberately bad `GET /runs/does-not-exist`, and
 * (when the fixture is seeded) a `POST /runs`.
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const DOC = 'spec/v2/core/headers.md §Removed in v2';
const NOOP_WORKFLOW_ID = 'conformance-noop';
const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}

async function responses(): Promise<Array<[string, OpenWOPResponse]> | { reason: string }> {
  if (!(await discovery())) return { reason: 'v2 discovery unreachable — /.well-known/openwop did not answer 200 with a JSON body under OpenWOP-Version: 2.0' };
  const out: Array<[string, OpenWOPResponse]> = [];
  const disco = await http(() => driver.get('/.well-known/openwop', { authenticated: false }));
  if (disco !== null) out.push(['GET /.well-known/openwop', disco]);
  const bad = await http(() => driver.get('/runs/does-not-exist'));
  if (bad !== null) out.push(['GET /runs/does-not-exist', bad]);
  const created = await http(() => driver.post('/runs', { workflowId: NOOP_WORKFLOW_ID }));
  if (created !== null) out.push(['POST /runs', created]);
  if (out.length === 0) return { reason: 'no response could be collected (fetch failed on every probe)' };
  return out;
}

function offending(name: string): boolean {
  const n = name.toLowerCase();
  return n.startsWith('x-openwop-') || n === 'capabilities-etag' || n === 'x-dedup' || n === 'x-force-engine-version' || n.startsWith('x-pack-');
}

describe('v2 header-scheme (RFC 0171 §C.1; RFC 0172 §A.4)', () => {
  it('no removed header family appears on any response', async () => {
    const rs = await responses();
    if (!Array.isArray(rs)) return softSkip('blocked', rs.reason);
    for (const [label, res] of rs) {
      const bad = [...res.headers.keys()].filter(offending);
      expect(bad, req('openwop.requirement.0171.header-scheme.no-legacy-headers', DOC, `${label}: Capabilities-Etag, X-Dedup, X-Force-Engine-Version, X-Pack-* and X-openwop-* are removed in v2 — every non-standard header is OpenWOP-<Name>`)).toEqual([]);
    }
  });

  it('OpenWOP-Version names the contract on every response', async () => {
    const rs = await responses();
    if (!Array.isArray(rs)) return softSkip('blocked', rs.reason);
    for (const [label, res] of rs) {
      const v = res.headers.get('openwop-version');
      expect(v !== null && VERSION.test(v.trim()), req('openwop.requirement.0171.header-scheme.version-on-every-response', 'spec/v2/core/versioning.md §1.4', `${label}: a response on any path MUST carry OpenWOP-Version: <major>.<minor> (got ${String(v)})`)).toBe(true);
      expect(v?.trim().split('.')[0], req('openwop.requirement.0171.header-scheme.version-on-every-response', 'spec/v2/core/versioning.md §1.4', `${label}: the request named major 2, so the response MUST report the 2.x contract it used (reporting another major is a silent downgrade)`)).toBe('2');
    }
  });
});
