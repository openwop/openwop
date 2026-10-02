/**
 * `v2-workspace-scope-from-identity` (target major 2; gated on the `workspace`
 * family and the `openwop-conformance-seams-v2` profile).
 *
 * `spec/v2/core/host-services.md` §`workspace`: a host advertising `workspace`
 * "MUST derive the scope from the authenticated identity and MUST NOT return or
 * disclose another scope's file; `404` MAY stand for `403` (invariant
 * `workspace-cross-tenant-isolation`)". No protocol path serves workspace files,
 * so the only observation surface is the EXISTING v2 seam
 * `/conformance/seams/workspace/files[/{path}]` (`api/seams-v2.yaml`). This file
 * adds no seam; it drives that one with two credentials.
 *
 * Until this file the rule had major-1 witnesses only (`workspace-cross-tenant-
 * isolation`, `workspace-cross-tenant-isolation-blackbox`, both on `/v1/…`), so
 * no v2 host was ever measured on it (docs/V2-WITNESS-COVERAGE.md risk #3).
 *
 * Legs:
 *   1. tenant A writes a unique file; tenant B (OPENWOP_TEST_TENANT_B_API_KEY)
 *      reads it by path → 403/404 with no content, and B's list omits it.
 *      Positive control: A reads its own file back and lists it.
 *   2. the same read and list by B, NAMING A's scope in the request
 *      (`tenantId` / `workspaceId` query parameters, the values read from
 *      `owner` of a run A just created). A host that takes the scope from the
 *      request instead of the credential serves A's file here.
 *
 * Dispositions: family or seams profile not advertised ⇒ `inapplicable`
 * (lib/seams.ts: the host has not claimed the instrument). That holds in
 * strict mode too: the family is read with `familyAdvertised`, so no
 * `family.workspace` opt-out is needed from a host that does not serve it. Advertised, but the
 * seam answers 404/405/501, the second-tenant key is absent / identical /
 * refused, or (leg 2) A's scope cannot be read from a run ⇒ `blocked` — the host
 * took the obligation on and the suite could not measure it.
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { loadEnv } from '../lib/env.js';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { seamsProfileAdvertised, SEAMS_PREFIX } from '../lib/seams.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { softSkip, seamAbsent } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const DOC = 'spec/v2/core/host-services.md §workspace';
const FILES = `${SEAMS_PREFIX}/workspace/files`;
const NOOP = 'conformance-noop';
const ID_READ = 'openwop.requirement.0059.workspace-scope-from-identity';
const ID_NAMED = 'openwop.requirement.0059.workspace-scope-not-request-named';

type Gate = { ok: true; asB: { authenticated: false; headers: Record<string, string> } } | { ok: false; kind: 'inapplicable' | 'blocked'; reason: string; seam?: true };

async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}

/** Family, profile, seam and second credential — decided before any assertion. */
async function gate(): Promise<Gate> {
  const doc = await v2Discovery();
  if (!doc) return { ok: false, kind: 'blocked', reason: 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0' };
  // `familyAdvertised`, not `gateFamily`: `workspace` is optional, and a host that does not advertise it has
  // taken on no obligation here. Until 2.45.7 this was `gateFamily`, which in strict mode
  // (`--require-behavior`) FAILS an unadvertised family unless the operator opts it out — so this file
  // recorded `executed-fail` on a host its own header calls `inapplicable` (MyndHyve, 2.45.5), while
  // its sibling isolation scenarios recorded `inapplicable` in the same run.
  if (!(await familyAdvertised('workspace'))) return { ok: false, kind: 'inapplicable', reason: 'workspace family not advertised — no obligation' };
  if (!seamsProfileAdvertised(doc)) return { ok: false, kind: 'inapplicable', reason: 'workspace files have no protocol path; the only observation surface is the seams profile (conformance.seamsProfile = openwop-conformance-seams-v2), which is not advertised' };
  const probe = await http(() => driver.get(FILES));
  if (probe === null) return { ok: false, kind: 'blocked', reason: `GET ${FILES} unreachable (fetch failed)` };
  if ([404, 405, 501].includes(probe.status)) return { ok: false, kind: 'blocked', reason: `host advertises workspace and the seams profile but GET ${FILES} answered ${probe.status}`, seam: true };
  const b = process.env['OPENWOP_TEST_TENANT_B_API_KEY']?.trim();
  if (!b) return { ok: false, kind: 'blocked', reason: 'OPENWOP_TEST_TENANT_B_API_KEY (a credential bound to a second tenant) is not set — no second-scope read can be measured' };
  if (b === loadEnv().apiKey) return { ok: false, kind: 'blocked', reason: 'OPENWOP_TEST_TENANT_B_API_KEY equals OPENWOP_API_KEY — the leg needs a second tenant' };
  const asB = { authenticated: false as const, headers: { Authorization: `Bearer ${b}` } };
  const probeB = await http(() => driver.get(FILES, asB));
  if (probeB === null || probeB.status === 401) return { ok: false, kind: 'blocked', reason: `OPENWOP_TEST_TENANT_B_API_KEY does not authenticate on this host (GET ${FILES} answered ${probeB?.status ?? 'nothing'})` };
  return { ok: true, asB };
}

/** A's file, written through the seam; the caller deletes it. */
async function writeA(): Promise<{ path: string; secret: string } | { reason: string }> {
  const path = `v2-wsi-${randomUUID()}.md`;
  const secret = `V2-WSI-CANARY-${randomUUID()}`;
  const put = await http(() => driver.put(`${FILES}/${path}`, { content: secret }));
  if (put === null || put.status !== 200) return { reason: `tenant A could not write ${FILES}/${path} (answered ${put?.status ?? 'nothing'})` };
  return { path, secret };
}

function paths(res: OpenWOPResponse | null): string[] {
  const files = (res?.json as { files?: Array<{ path?: unknown }> } | undefined)?.files;
  return Array.isArray(files) ? files.map((f) => String(f?.path)) : [];
}

/** A's own `{tenant, workspace}` as the host records it, from `owner` of a run A creates. */
async function scopeOf(as: Record<string, unknown> = {}): Promise<{ tenant: string; workspace?: string } | { reason: string }> {
  if (!isFixtureAdvertised(NOOP)) return { reason: `${NOOP} is not advertised — the suite cannot learn a scope id to name` };
  const res = await http(() => driver.post('/runs', { workflowId: NOOP }, as));
  const runId = (res?.json as { runId?: unknown } | undefined)?.runId;
  if (res === null || res.status !== 201 || typeof runId !== 'string') return { reason: `POST /runs {${NOOP}} answered ${res?.status ?? 'nothing'}` };
  const snap = await http(() => driver.get(`/runs/${encodeURIComponent(runId)}`, as));
  const owner = (snap?.json as { owner?: { tenant?: unknown; workspace?: unknown } } | undefined)?.owner;
  const tenant = typeof owner?.tenant === 'string' ? owner.tenant : runId.includes('/') ? runId.slice(0, runId.indexOf('/')) : null;
  if (!tenant) return { reason: 'the run snapshot names no owner.tenant and the run id carries no tenant segment' };
  return typeof owner?.workspace === 'string' ? { tenant, workspace: owner.workspace } : { tenant };
}

describe('v2 workspace scope comes from the authenticated identity (host-services.md §workspace)', () => {
  it('a second tenant cannot read or list a file the first tenant wrote', async () => {
    const g = await gate();
    if (!g.ok && g.seam) return seamAbsent(g.reason);
    if (!g.ok) return softSkip(g.kind, g.reason);
    const a = await writeA();
    if ('reason' in a) return softSkip('blocked', a.reason);
    try {
      const own = await driver.get(`${FILES}/${a.path}`);
      expect(own.status, req(ID_READ, DOC, 'positive control: the owning scope MUST read its own file (200)')).toBe(200);
      expect((own.json as { content?: unknown } | undefined)?.content, req(ID_READ, DOC, 'positive control: the owner reads back the content it wrote')).toBe(a.secret);
      expect(paths(await http(() => driver.get(FILES))), req(ID_READ, DOC, 'positive control: the owner\'s list names its own file')).toContain(a.path);

      const cross = await driver.get(`${FILES}/${a.path}`, g.asB);
      expect([403, 404], req(ID_READ, DOC, `another scope's read MUST NOT return the file — 404 MAY stand for 403 (got ${cross.status})`)).toContain(cross.status);
      expect(cross.text.includes(a.secret), req(ID_READ, DOC, 'another scope\'s read MUST NOT disclose the file\'s content')).toBe(false);
      const list = await http(() => driver.get(FILES, g.asB));
      expect(list?.text.includes(a.secret) === true || paths(list).includes(a.path), req(ID_READ, DOC, 'another scope\'s list MUST NOT disclose the file')).toBe(false);
    } finally {
      await http(() => driver.delete(`${FILES}/${a.path}`));
    }
  });

  it('naming the first tenant\'s scope in the request does not widen the second tenant\'s scope', async () => {
    const g = await gate();
    if (!g.ok && g.seam) return seamAbsent(g.reason);
    if (!g.ok) return softSkip(g.kind, g.reason);
    const scopeA = await scopeOf();
    if ('reason' in scopeA) return softSkip('blocked', `A's scope id is needed to name it: ${scopeA.reason}`);
    const scopeB = await scopeOf(g.asB);
    if (!('reason' in scopeB) && scopeB.tenant === scopeA.tenant) return softSkip('blocked', 'OPENWOP_TEST_TENANT_B_API_KEY binds the same tenant as OPENWOP_API_KEY — the leg needs a second tenant');
    const a = await writeA();
    if ('reason' in a) return softSkip('blocked', a.reason);
    try {
      const q = new URLSearchParams({ tenantId: scopeA.tenant, tenant: scopeA.tenant, ...(scopeA.workspace ? { workspaceId: scopeA.workspace, workspace: scopeA.workspace } : {}) }).toString();
      const own = await driver.get(`${FILES}/${a.path}`);
      expect(own.status, req(ID_NAMED, DOC, 'positive control: the owning scope MUST read its own file (200)')).toBe(200);

      const cross = await driver.get(`${FILES}/${a.path}?${q}`, g.asB);
      expect([400, 403, 404], req(ID_NAMED, DOC, `the scope MUST come from the credential, not a request-named tenantId/workspaceId (got ${cross.status})`)).toContain(cross.status);
      expect(cross.text.includes(a.secret), req(ID_NAMED, DOC, 'a request naming another scope MUST NOT disclose that scope\'s file')).toBe(false);
      const list = await http(() => driver.get(`${FILES}?${q}`, g.asB));
      expect(list?.text.includes(a.secret) === true || paths(list).includes(a.path), req(ID_NAMED, DOC, 'a list naming another scope MUST NOT disclose that scope\'s file')).toBe(false);
    } finally {
      await http(() => driver.delete(`${FILES}/${a.path}`));
    }
  });
});
