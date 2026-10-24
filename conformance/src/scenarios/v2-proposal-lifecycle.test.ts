/**
 * v2 — reviewable-learning proposals are inert until applied, and what is
 * installed is what was reviewed (RFC 0249, making RFC 0096 observable; the
 * rules are the `agents.proposals` facet description in
 * `spec/v2/facets/agents.schema.json`, `proposal.schema.json`, the proposal
 * operations in `api/v2/openapi.yaml` and `spec/v2/errors.json`).
 *
 * Server-free (always on):
 *   1. `0249.shape` — the submit / revise / apply bodies and the closed
 *      `installedArtifact` validate, and their negatives are refused.
 *
 * Host legs — gated on `agents.proposals` with `clientDrafts: true` and
 * `readback` ∋ `prompt-template`. One client-submitted `prompt-template`
 * proposal with a fresh `templateId` is driven once per worker:
 * submit T → revise to T' → stale apply → unscoped apply → foreign reads →
 * apply → read back → terminal refusals. Judges in
 * `lib/proposal-lifecycle-witness.ts`.
 *   2. `0249.submit-kind-refused` — a kind outside `artifactKinds` is `400`.
 *   3. `0249.draft-inert` — the draft's template is not served, listed or
 *      renderable (`proposal-inert-until-applied`).
 *   4. `0249.apply-stale-refused` — the revision's digest is served, and an
 *      apply bound to the pre-revision digest is `409 proposal_stale`.
 *   5. `0249.apply-unscoped-refused` — `OPENWOP_TEST_LOW_SCOPE_KEY` (read +
 *      write, no `proposals:apply`) is refused `403 insufficient_scope`.
 *   6. `0249.apply-installs` — the apply names `getPromptTemplate` and the
 *      artifact's own `templateId`.
 *   7. `0249.readback-byte-match` — the installed template minus `meta` is
 *      JCS-equal to T' and not to T (`proposal-no-resynthesis`).
 *   8. `0249.terminal-refused` — revise and apply on the applied proposal are
 *      `409 proposal_state_conflict`.
 *   9. `0249.cross-tenant-not-found` — `OPENWOP_TEST_TENANT_B_API_KEY` sees the
 *      proposal and the installed template exactly as unknown ids.
 *
 * A harness key that is unset records `blocked` (the `v2-auth-challenge`
 * precedent): the suite will not infer a credential. The unadvertised case is
 * in `v2-unadvertised-operation-not-found`.
 */

import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { driver, type OpenWOPRequestInit } from '../lib/driver.js';
import { v2Discovery, v2Validator, v2RefValidator } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import {
  artifactDigest, freshTemplate, judgeApplied, judgeApplyStale, judgeApplyUnscoped, judgeForeign, judgeInert,
  judgeReadback, judgeRevised, judgeSubmitKindRefused, judgeTerminal, type Exchange, type ProposalFinding,
} from '../lib/proposal-lifecycle-witness.js';

const DOC = 'agents.schema.json §proposals, proposal.schema.json, api/v2 proposals operations (RFC 0249)';
const UNREADABLE = 'v2 discovery unreachable — /.well-known/openwop did not answer 200 with a JSON body under OpenWOP-Version: 2.0';
const KINDS = ['agent-pack', 'workflow-chain-pack', 'prompt-template', 'automation'] as const;
const ID_SHAPE = 'openwop.requirement.0249.shape';
const ID_SUBMIT_KIND_REFUSED = 'openwop.requirement.0249.submit-kind-refused';
const ID_DRAFT_INERT = 'openwop.requirement.0249.draft-inert';
const ID_APPLY_STALE_REFUSED = 'openwop.requirement.0249.apply-stale-refused';
const ID_APPLY_UNSCOPED_REFUSED = 'openwop.requirement.0249.apply-unscoped-refused';
const ID_APPLY_INSTALLS = 'openwop.requirement.0249.apply-installs';
const ID_READBACK_BYTE_MATCH = 'openwop.requirement.0249.readback-byte-match';
const ID_TERMINAL_REFUSED = 'openwop.requirement.0249.terminal-refused';
const ID_CROSS_TENANT_NOT_FOUND = 'openwop.requirement.0249.cross-tenant-not-found';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

interface Answer { readonly x: Exchange; readonly wwwAuthenticate: string | null }
async function ask(method: string, path: string, body?: unknown, bearer?: string): Promise<Answer> {
  const init: OpenWOPRequestInit = {
    ...(body === undefined ? {} : { body }),
    ...(bearer === undefined ? {} : { authenticated: false, headers: { Authorization: `Bearer ${bearer}` } }),
  };
  try {
    const r = await driver.request(method, path, init);
    return { x: { status: r.status, json: r.json }, wwwAuthenticate: r.headers.get('www-authenticate') };
  } catch {
    return { x: null, wwwAuthenticate: null };
  }
}

interface Facet { readonly doc: Rec | null; readonly facet: Rec | null; readonly renderPath: string }
async function proposalsFacet(): Promise<Facet> {
  let doc: Rec | null;
  try { doc = await v2Discovery(); } catch { doc = null; }
  const agents = doc?.['agents'];
  const facet = isRec(agents) && isRec(agents['proposals']) ? agents['proposals'] : null;
  const prompts = doc?.['prompts'];
  const renderPath = isRec(prompts) && typeof prompts['renderEndpoint'] === 'string' ? prompts['renderEndpoint'] : '/prompts:render';
  return { doc, facet, renderPath };
}

type Skip = { skip: [Parameters<typeof softSkip>[0], string] };
async function gate(): Promise<Skip | { facet: Rec; renderPath: string }> {
  const { doc, facet, renderPath } = await proposalsFacet();
  if (!doc) return { skip: ['blocked', UNREADABLE] };
  if (facet === null) return { skip: ['inapplicable', 'the host does not advertise agents.proposals'] };
  if (facet['clientDrafts'] !== true) return { skip: ['inapplicable', 'the host does not advertise agents.proposals.clientDrafts'] };
  const rb = Array.isArray(facet['readback']) ? facet['readback'] : [];
  const kinds = Array.isArray(facet['artifactKinds']) ? facet['artifactKinds'] : [];
  if (!rb.includes('prompt-template') || !kinds.includes('prompt-template')) return { skip: ['inapplicable', 'the host does not advertise prompt-template in both agents.proposals.artifactKinds and readback'] };
  return { facet, renderPath };
}

interface Lifecycle {
  readonly blockedAt?: string;
  readonly t: Rec; readonly t2: Rec; readonly templateId: string;
  readonly inert?: { get: Exchange; list: Exchange; render: Exchange };
  readonly revise?: Exchange;
  readonly stale?: { apply: Exchange; after: Exchange; prompt: Exchange };
  readonly unscoped?: { apply: Exchange; after: Exchange; prompt: Exchange; www: string | null } | string;
  readonly foreignProposal?: Array<{ what: string; foreign: Exchange; unknown: Exchange }> | string;
  readonly apply?: Exchange;
  readonly readback?: Exchange;
  readonly foreignTemplate?: { what: string; foreign: Exchange; unknown: Exchange } | string;
  readonly terminal?: { revise: Exchange; apply: Exchange };
}

let run: Promise<Lifecycle> | undefined;
/** One lifecycle per worker: every host leg judges a slice of the same records. */
function lifecycle(renderPath: string): Promise<Lifecycle> {
  run ??= drive(renderPath);
  return run;
}

async function drive(renderPath: string): Promise<Lifecycle> {
  const nonce = randomBytes(6).toString('hex');
  const t = freshTemplate(nonce, 'You summarize the input in one sentence.');
  const t2 = { ...t, text: 'You summarize the input in exactly one short sentence.' };
  const templateId = t['templateId'] as string;
  const prompt = `/prompts/${encodeURIComponent(templateId)}`;
  const base = { t, t2, templateId };

  const submit = (await ask('POST', '/proposals', { kind: 'prompt-template', artifact: t, title: 'conformance proposal' })).x;
  const pid = isRec(submit?.json) && typeof submit.json['id'] === 'string' ? submit.json['id'] : undefined;
  if (submit?.status !== 201 || pid === undefined) return { ...base, blockedAt: `submitProposal answered ${submit?.status ?? 'nothing'}; no proposal to drive` };
  const path = `/proposals/${encodeURIComponent(pid)}`;
  const getP = async (bearer?: string): Promise<Exchange> => (await ask('GET', path, undefined, bearer)).x;

  const inert = {
    get: (await ask('GET', prompt)).x,
    list: (await ask('GET', '/prompts')).x,
    render: (await ask('POST', renderPath, { ref: `prompt:${templateId}@1.0.0`, variables: {} })).x,
  };
  const revise = (await ask('PATCH', path, { artifact: t2 })).x;
  if (revise?.status !== 200) return { ...base, inert, revise, blockedAt: `reviseProposal answered ${revise?.status ?? 'nothing'}` };

  const staleApply = (await ask('POST', `${path}:apply`, { artifactDigest: artifactDigest(t) })).x;
  const stale = { apply: staleApply, after: await getP(), prompt: (await ask('GET', prompt)).x };

  const low = process.env['OPENWOP_TEST_LOW_SCOPE_KEY']?.trim();
  let unscoped: Lifecycle['unscoped'];
  if (!low) unscoped = 'OPENWOP_TEST_LOW_SCOPE_KEY (a key with proposals:read and proposals:write but not proposals:apply) is not set';
  else {
    const a = await ask('POST', `${path}:apply`, { artifactDigest: artifactDigest(t2) }, low);
    unscoped = { apply: a.x, www: a.wwwAuthenticate, after: await getP(), prompt: (await ask('GET', prompt)).x };
  }

  const tenantB = process.env['OPENWOP_TEST_TENANT_B_API_KEY']?.trim();
  const unknownPid = `/proposals/conformance-unknown-${nonce}`;
  let foreignProposal: Lifecycle['foreignProposal'];
  if (!tenantB) foreignProposal = 'OPENWOP_TEST_TENANT_B_API_KEY (a credential bound to a second tenant) is not set';
  else if (tenantB === process.env['OPENWOP_API_KEY']) foreignProposal = 'OPENWOP_TEST_TENANT_B_API_KEY equals OPENWOP_API_KEY — the leg needs a second tenant';
  else {
    foreignProposal = [
      { what: 'getProposal', foreign: await getP(tenantB), unknown: (await ask('GET', unknownPid, undefined, tenantB)).x },
      { what: 'applyProposal', foreign: (await ask('POST', `${path}:apply`, { artifactDigest: artifactDigest(t2) }, tenantB)).x,
        unknown: (await ask('POST', `${unknownPid}:apply`, { artifactDigest: artifactDigest(t2) }, tenantB)).x },
    ];
  }

  const apply = (await ask('POST', `${path}:apply`, { artifactDigest: artifactDigest(t2) })).x;
  const readback = (await ask('GET', prompt)).x;
  const foreignTemplate = typeof foreignProposal === 'string' ? foreignProposal : {
    what: 'getPromptTemplate for the installed template',
    foreign: (await ask('GET', prompt, undefined, tenantB)).x,
    unknown: (await ask('GET', `/prompts/conformance.proposal.unknown-${nonce}`, undefined, tenantB)).x,
  };
  const terminal = { revise: (await ask('PATCH', path, { title: 'after apply' })).x, apply: (await ask('POST', `${path}:apply`, { artifactDigest: artifactDigest(t2) })).x };
  return { ...base, inert, revise, stale, unscoped, foreignProposal, apply, readback, foreignTemplate, terminal };
}

function expectAll(id: string, findings: readonly ProposalFinding[]): void {
  for (const x of findings) expect(x.ok, req(id, DOC, x.message)).toBe(true);
}

describe('v2 RFC 0249 — proposal wire shape (server-free)', () => {
  it('the submit, revise and apply bodies and installedArtifact validate, and the negatives are refused', () => {
    const submit = v2Validator('proposal-submit');
    const revise = v2Validator('proposal-revise');
    const apply = v2Validator('proposal-apply');
    const installed = v2RefValidator('proposal.schema.json#/properties/activation/properties/installedArtifact');
    const S = 'proposal-submit / proposal-revise / proposal-apply / proposal.schema.json (RFC 0249)';
    expect(submit({ kind: 'prompt-template', artifact: { templateId: 'x' } }).ok, req(ID_SHAPE, S, 'a minimal submit MUST validate')).toBe(true);
    expect(submit({ kind: 'skill', artifact: {} }).ok, req(ID_SHAPE, S, 'an unknown kind MUST be refused')).toBe(false);
    expect(submit({ kind: 'prompt-template', artifact: {}, state: 'applied' }).ok, req(ID_SHAPE, S, 'a submit carrying state MUST be refused (closed body)')).toBe(false);
    expect(revise({}).ok, req(ID_SHAPE, S, 'an empty revise MUST be refused')).toBe(false);
    expect(apply({ artifactDigest: `sha256:${'a'.repeat(64)}` }).ok, req(ID_SHAPE, S, 'a sha256 digest MUST validate')).toBe(true);
    expect(apply({ artifactDigest: 'abc123' }).ok, req(ID_SHAPE, S, 'a digest without the sha256: prefix and 64 hex MUST be refused')).toBe(false);
    expect(installed({ kind: 'prompt-template', operationId: 'getPromptTemplate', id: 't' }).ok, req(ID_SHAPE, S, 'a minimal installedArtifact MUST validate')).toBe(true);
    expect(installed({ kind: 'prompt-template', operationId: 'getPromptTemplate', id: 't', url: 'https://x' }).ok, req(ID_SHAPE, S, 'installedArtifact is closed')).toBe(false);
  });
});

describe('v2 RFC 0249 — proposal lifecycle (host)', () => {
  it('a kind outside artifactKinds is refused at submit', async () => {
    const g = await gate();
    if ('skip' in g) return softSkip(...g.skip);
    const kinds = Array.isArray(g.facet['artifactKinds']) ? g.facet['artifactKinds'] : [];
    const missing = KINDS.find((k) => !kinds.includes(k));
    if (missing === undefined) return softSkip('inapplicable', 'the host advertises every proposal kind, so no kind is outside artifactKinds');
    expectAll(ID_SUBMIT_KIND_REFUSED, judgeSubmitKindRefused((await ask('POST', '/proposals', { kind: missing, artifact: {} })).x));
  });

  it('a draft prompt-template is not served, listed or renderable', async () => {
    const g = await gate();
    if ('skip' in g) return softSkip(...g.skip);
    const l = await lifecycle(g.renderPath);
    if (l.inert === undefined) return softSkip('blocked', l.blockedAt ?? 'the lifecycle did not reach the draft');
    expectAll(ID_DRAFT_INERT, judgeInert(l.inert.get, l.inert.list, l.inert.render, l.templateId, 'draft'));
  });

  it('a revision re-digests, and an apply bound to the old bytes is stale', async () => {
    const g = await gate();
    if ('skip' in g) return softSkip(...g.skip);
    const l = await lifecycle(g.renderPath);
    if (l.stale === undefined || l.revise === undefined) return softSkip('blocked', l.blockedAt ?? 'the lifecycle did not reach the revision');
    expectAll(ID_APPLY_STALE_REFUSED, [...judgeRevised(l.revise, l.t2), ...judgeApplyStale(l.stale.apply, l.stale.after, l.stale.prompt)]);
  });

  it('an apply without proposals:apply is refused and installs nothing', async () => {
    const g = await gate();
    if ('skip' in g) return softSkip(...g.skip);
    if (g.facet['activation'] !== 'direct-rbac') return softSkip('inapplicable', 'agents.proposals.activation is not direct-rbac — the apply is gated by an approval run');
    const l = await lifecycle(g.renderPath);
    if (l.unscoped === undefined) return softSkip('blocked', l.blockedAt ?? 'the lifecycle did not reach the apply');
    if (typeof l.unscoped === 'string') return softSkip('blocked', l.unscoped);
    expectAll(ID_APPLY_UNSCOPED_REFUSED, judgeApplyUnscoped(l.unscoped.apply, l.unscoped.after, l.unscoped.prompt, l.unscoped.www));
  });

  it('an authorized, current apply names the read that serves the installed template', async () => {
    const g = await gate();
    if ('skip' in g) return softSkip(...g.skip);
    if (g.facet['activation'] !== 'direct-rbac') return softSkip('inapplicable', 'agents.proposals.activation is not direct-rbac — the apply is gated by an approval run');
    const l = await lifecycle(g.renderPath);
    if (l.apply === undefined) return softSkip('blocked', l.blockedAt ?? 'the lifecycle did not reach the apply');
    expectAll(ID_APPLY_INSTALLS, judgeApplied(l.apply, l.templateId));
  });

  it('the installed template is the reviewed revision, byte for byte', async () => {
    const g = await gate();
    if ('skip' in g) return softSkip(...g.skip);
    if (g.facet['activation'] !== 'direct-rbac') return softSkip('inapplicable', 'agents.proposals.activation is not direct-rbac — the apply is gated by an approval run');
    const l = await lifecycle(g.renderPath);
    if (l.readback === undefined) return softSkip('blocked', l.blockedAt ?? 'the lifecycle did not reach the read-back');
    expectAll(ID_READBACK_BYTE_MATCH, judgeReadback(l.readback, l.t2, l.t));
  });

  it('an applied proposal is terminal', async () => {
    const g = await gate();
    if ('skip' in g) return softSkip(...g.skip);
    if (g.facet['activation'] !== 'direct-rbac') return softSkip('inapplicable', 'agents.proposals.activation is not direct-rbac — the apply is gated by an approval run');
    const l = await lifecycle(g.renderPath);
    if (l.terminal === undefined) return softSkip('blocked', l.blockedAt ?? 'the lifecycle did not reach the applied state');
    expectAll(ID_TERMINAL_REFUSED, judgeTerminal(l.terminal.revise, l.terminal.apply));
  });

  it('another tenant sees the proposal and the installed template as unknown ids', async () => {
    const g = await gate();
    if ('skip' in g) return softSkip(...g.skip);
    const l = await lifecycle(g.renderPath);
    if (l.foreignProposal === undefined) return softSkip('blocked', l.blockedAt ?? 'the lifecycle did not reach the foreign reads');
    if (typeof l.foreignProposal === 'string') return softSkip('blocked', l.foreignProposal);
    const pairs = [...l.foreignProposal, ...(l.foreignTemplate !== undefined && typeof l.foreignTemplate !== 'string' ? [l.foreignTemplate] : [])];
    expectAll(ID_CROSS_TENANT_NOT_FOUND, judgeForeign(pairs));
  });
});
