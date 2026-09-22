/**
 * RFC 0200 §B.3 — a challenge never becomes an existence oracle (suite 2.36.0, both
 * majors; invariant `auth-challenge-no-oracle`).
 *
 * This is the positive control for the §B challenge rules: the thing a host is TEMPTED to
 * do once it starts answering "you lack `tools:read`" is answer it everywhere, including
 * on the routes OpenWOP requires to be a non-disclosing `404` for an unknown **or
 * unauthorized** resource. RFC 6750 §3 and MCP's §"Runtime Insufficient Scope Errors" say
 * nothing about existence oracles; OpenWOP's rule is stronger and wins.
 *
 * The routes that carry the identical-404 rule:
 *   - `tool-catalog.md` §`GET /v1/tools/{toolId}` (v2: `spec/v2/core/tool-catalog.md`)
 *   - the RFC 0074 / 0072 / 0086 / 0087 agent inventory (`api/openapi.yaml` getAgent:
 *     "404s identically to 'not installed'")
 *   - `capabilities-change-detection.md` ("Hosts MUST NOT let scoped discovery become an
 *     authorization oracle")
 *
 * One requirement id, three legs that share it — every leg is an instance of the same
 * MUST, and a host that leaks on any of them has the oracle:
 *   1. `GET <tools>/<unknown>` → `404`, and no `WWW-Authenticate` carrying
 *      `insufficient_scope` or `scope`.
 *   2. `GET <agents>/<unknown>` → the same.
 *   3. with `OPENWOP_TEST_TENANT_B_API_KEY`, a cross-tenant run read → the refusal
 *      carries no `insufficient_scope`, because no scope would cure a resource-binding
 *      refusal.
 *
 * Each leg carries its own positive control: leg 1 and 2 assert the route is LIVE for the
 * same credential (the collection read answers 200), so a `404` from "this host serves no
 * catalog at all" cannot be mistaken for the silent non-disclosure under test. Leg 3
 * asserts the owner can read the run it then reads cross-tenant.
 *
 * How it FAILS (the sabotage run before citing the row):
 *   (a) the host 403s an unauthorized tool with a scope challenge → leg 1
 *   (b) the host attaches `insufficient_scope` to EVERY 403            → leg 3
 *   (c) the host turns the unknown-id 404 into a 401 challenge         → legs 1, 2
 *
 * @see spec/v2/core/identity.md §2.5; spec/v1/auth.md §Challenges
 * @see RFCS/0200-host-as-oauth-protected-resource.md §B.3
 * @see SECURITY/invariants.yaml id: auth-challenge-no-oracle
 */

import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { driver } from '../lib/driver.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { targetMajor } from '../lib/seams.js';
import { toolCatalogGate, toolsPath } from '../lib/toolCatalog.js';
import { parseChallenge } from '../lib/protected-resource.js';
import { projectBoundId } from '../lib/bound-id.js';

const DOC = 'spec/v1/auth.md §Challenges; spec/v2/core/identity.md §2.5 (RFC 0200 §B.3)';
const ID = 'openwop.requirement.0200.no-challenge-on-nondisclosure-404';

const agentsPath = (suffix = ''): string => `${targetMajor() === 2 ? '' : '/v1'}/agents${suffix}`;
const runsPath = (suffix = ''): string => `${targetMajor() === 2 ? '' : '/v1'}/runs${suffix}`;

/** The scope-disclosing part of a challenge, or null — this is the whole measurement. */
function scopeDisclosure(raw: string | null): string | null {
  const c = parseChallenge(raw);
  if (c === null) return null;
  if (c.params['error'] === 'insufficient_scope') return `error="insufficient_scope"`;
  if (typeof c.params['scope'] === 'string') return `scope="${c.params['scope']}"`;
  return null;
}

describe('RFC 0200 §B.3 — auth-challenge-no-oracle (a challenge never replaces a required 404)', () => {
  it('an unknown tool id stays a silent 404 — no scope challenge, no status change', async () => {
    if (!(await toolCatalogGate('openwop-tool-catalog'))) return;
    // Positive control: the catalog is LIVE for this credential, so the 404 below is the
    // non-disclosure rule and not "this host serves no catalog".
    const list = await driver.get(toolsPath());
    if (list.status !== 200) return softSkip('blocked', `the catalog collection answered ${list.status}, so an unknown-id 404 would prove nothing about non-disclosure`);
    const unknown = `conformance.absent-${randomBytes(8).toString('hex')}`;
    const res = await driver.get(toolsPath(`/${encodeURIComponent(unknown)}`));
    expect(
      res.status,
      req(ID, `${DOC}; spec/v1/tool-catalog.md §GET /v1/tools/{toolId}`, `an unknown or unauthorized tool id MUST answer 404 — a challenge attaches only to a response that is ALREADY 401/403 and MUST NOT change a status (got ${res.status})`),
    ).toBe(404);
    expect(
      scopeDisclosure(res.headers.get('www-authenticate')),
      req(ID, DOC, `the 404 MUST NOT carry error="insufficient_scope" or a scope parameter — that is what turns the catalog into an enumeration oracle (WWW-Authenticate: ${res.headers.get('www-authenticate') ?? 'absent'})`),
    ).toBeNull();
  }, 30_000);

  it('an unknown agent id stays a silent 404 — no scope challenge, no status change', async () => {
    const list = await driver.get(agentsPath());
    if (list.status !== 200) return softSkip('inapplicable', `the agent inventory answered ${list.status} — this host serves no RFC 0074 inventory, so its identical-404 rule does not bind it`);
    const unknown = `absent-agent-${randomBytes(8).toString('hex')}`;
    const res = await driver.get(agentsPath(`/${encodeURIComponent(unknown)}`));
    expect(
      res.status,
      req(ID, `${DOC}; api/openapi.yaml getAgent (RFC 0074)`, `an unknown or unauthorized agent id MUST answer 404 identically to "not installed" (got ${res.status})`),
    ).toBe(404);
    expect(
      scopeDisclosure(res.headers.get('www-authenticate')),
      req(ID, DOC, `the inventory 404 MUST NOT carry a scope challenge (WWW-Authenticate: ${res.headers.get('www-authenticate') ?? 'absent'})`),
    ).toBeNull();
  }, 30_000);

  it('a resource-binding refusal carries no insufficient_scope, because no scope would cure it', async () => {
    const other = process.env['OPENWOP_TEST_TENANT_B_API_KEY']?.trim();
    if (!other) return softSkip('blocked', 'OPENWOP_TEST_TENANT_B_API_KEY is not set — a resource-binding refusal needs a SECOND principal, and the suite will not fabricate one');
    const created = await driver.post(runsPath(), { workflowId: 'conformance-noop' });
    if (created.status !== 201) return softSkip('blocked', `could not create a run to read cross-tenant (POST ${runsPath()} answered ${created.status})`);
    const runId = String((created.json as { runId?: unknown } | null)?.runId ?? '');
    if (runId === '') return softSkip('blocked', 'the create response carried no runId');
    // Positive control: the OWNER can read it, so the refusal below is about the second
    // principal's binding and not about a run that does not exist.
    const owner = await driver.get(runsPath(`/${projectBoundId(runId)}`));
    if (owner.status !== 200) return softSkip('blocked', `the owner could not read its own run (${owner.status}) — the cross-tenant read would prove nothing`);
    const res = await driver.get(runsPath(`/${projectBoundId(runId)}`), { authenticated: false, headers: { Authorization: `Bearer ${other}` } });
    expect(
      res.status === 403 || res.status === 404,
      req(ID, DOC, `a second principal's read of another tenant's run MUST be refused 403 (run_forbidden / id_tenant_mismatch) or 404, never served (got ${res.status})`),
    ).toBe(true);
    expect(
      scopeDisclosure(res.headers.get('www-authenticate')),
      req(ID, DOC, `a refusal that failed RESOURCE binding MUST NOT carry error="insufficient_scope" or a scope parameter — no scope would cure it, and naming one tells the caller the resource exists (WWW-Authenticate: ${res.headers.get('www-authenticate') ?? 'absent'})`),
    ).toBeNull();
  }, 60_000);
});
