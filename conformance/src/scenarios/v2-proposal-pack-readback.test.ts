/**
 * v2 — an applied `workflow-chain-pack` or `agent-pack` proposal is read back
 * through `getInstalledPack`, and is inert until applied (RFC 0253, completing
 * RFC 0249 §D for the two pack kinds; the rules are the `getInstalledPack`
 * operation in `api/v2/openapi.yaml`, the `agents.proposals.readback`
 * description in `spec/v2/facets/agents.schema.json` and
 * `activation.installedArtifact` in `proposal.schema.json`).
 *
 * Server-free (always on):
 *   1. `0253.shape` — an `installedArtifact` naming `getInstalledPack` with a
 *      `version` validates; the two fresh artifacts validate against their
 *      manifest schemas and satisfy §D; the §Examples negatives break §D.
 *
 * Host legs — gated per kind on `agents.proposals` with `clientDrafts: true`
 * and the kind in both `artifactKinds` and `readback`; legs that apply also
 * need `activation: direct-rbac`. One proposal per kind is driven once per
 * worker with a fresh `private.conformance.*` name: submit P → read → revise
 * to P' → apply → read back → a second proposal at the same name and version
 * → foreign reads. Judges in `lib/proposal-pack-readback-witness.ts`.
 *   2. `0253.chain-draft-inert` / `0253.agent-draft-inert` — the unapplied
 *      pack is `404`; for an agent pack its agent is `404` and unlisted
 *      (`proposal-inert-until-applied`).
 *   3. `0253.chain-apply-installs` / `0253.agent-apply-installs` — the apply
 *      names `getInstalledPack`, the artifact's `name` and `version`.
 *   4. `0253.chain-readback-byte-match` / `0253.agent-readback-byte-match` —
 *      the installed pack is JCS-equal to P' and not to P
 *      (`proposal-no-resynthesis`).
 *   5. `0253.agent-file-ref-refused` — an agent with `systemPromptRef`, then a
 *      pack with `nodes`, is refused `422` and installs nothing.
 *   6. `0253.namespace-refused` — a `vendor.*` name is refused `422`.
 *   7. `0253.signing-refused` — a pack carrying `signing` is refused `422`.
 *   8. `0253.install-conflict` — a second apply at the installed version is
 *      `409 proposal_install_conflict` `version-not-greater`.
 *   9. `0253.cross-tenant-not-found` — `OPENWOP_TEST_TENANT_B_API_KEY` reads
 *      the installed pack (and agent) exactly as unknown names.
 *
 * Legs 5–7 accept a refusal at submit (RFC 0249 §B lets a host validate there)
 * when nothing installs. A harness key that is unset records `blocked`. The
 * unadvertised case is in `v2-unadvertised-operation-not-found`.
 */

import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { driver, type OpenWOPRequestInit } from '../lib/driver.js';
import { v2Discovery, v2Validator, v2RefValidator } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { artifactDigest, judgeForeign, type Exchange, type ProposalFinding } from '../lib/proposal-lifecycle-witness.js';
import {
  agentIdOf, freshAgentPack, freshChainPack, judgeInstallConflict, judgePackApplied, judgePackInert, judgePackReadback,
  judgePackRefused, judgePackRefusedAtSubmit, packContentViolations, type PackKind,
} from '../lib/proposal-pack-readback-witness.js';

const DOC = 'api/v2 getInstalledPack, agents.schema.json §proposals.readback, proposal.schema.json installedArtifact (RFC 0253)';
const UNREADABLE = 'v2 discovery unreachable — /.well-known/openwop did not answer 200 with a JSON body under OpenWOP-Version: 2.0';
const ID_SHAPE = 'openwop.requirement.0253.shape';
const ID_CHAIN_DRAFT_INERT = 'openwop.requirement.0253.chain-draft-inert';
const ID_CHAIN_APPLY_INSTALLS = 'openwop.requirement.0253.chain-apply-installs';
const ID_CHAIN_READBACK_BYTE_MATCH = 'openwop.requirement.0253.chain-readback-byte-match';
const ID_AGENT_DRAFT_INERT = 'openwop.requirement.0253.agent-draft-inert';
const ID_AGENT_APPLY_INSTALLS = 'openwop.requirement.0253.agent-apply-installs';
const ID_AGENT_READBACK_BYTE_MATCH = 'openwop.requirement.0253.agent-readback-byte-match';
const ID_AGENT_FILE_REF_REFUSED = 'openwop.requirement.0253.agent-file-ref-refused';
const ID_NAMESPACE_REFUSED = 'openwop.requirement.0253.namespace-refused';
const ID_SIGNING_REFUSED = 'openwop.requirement.0253.signing-refused';
const ID_INSTALL_CONFLICT = 'openwop.requirement.0253.install-conflict';
const ID_CROSS_TENANT_NOT_FOUND = 'openwop.requirement.0253.cross-tenant-not-found';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

async function ask(method: string, path: string, body?: unknown, bearer?: string): Promise<Exchange> {
  const init: OpenWOPRequestInit = {
    ...(body === undefined ? {} : { body }),
    ...(bearer === undefined ? {} : { authenticated: false, headers: { Authorization: `Bearer ${bearer}` } }),
  };
  try {
    const r = await driver.request(method, path, init);
    return { status: r.status, json: r.json };
  } catch {
    return null;
  }
}
const packPath = (name: string): string => `/installed-packs/${encodeURIComponent(name)}`;
const agentPath = (agentId: string): string => `/agents/${encodeURIComponent(agentId)}`;

type Skip = { skip: [Parameters<typeof softSkip>[0], string] };
async function gate(kind: PackKind, needsApply: boolean): Promise<Skip | { facet: Rec }> {
  let doc: Rec | null;
  try { doc = await v2Discovery(); } catch { doc = null; }
  if (!doc) return { skip: ['blocked', UNREADABLE] };
  const agents = doc['agents'];
  const facet = isRec(agents) && isRec(agents['proposals']) ? agents['proposals'] : null;
  if (facet === null) return { skip: ['inapplicable', 'the host does not advertise agents.proposals'] };
  if (facet['clientDrafts'] !== true) return { skip: ['inapplicable', 'the host does not advertise agents.proposals.clientDrafts'] };
  const rb = Array.isArray(facet['readback']) ? facet['readback'] : [];
  const kinds = Array.isArray(facet['artifactKinds']) ? facet['artifactKinds'] : [];
  if (!rb.includes(kind) || !kinds.includes(kind)) return { skip: ['inapplicable', `the host does not advertise ${kind} in both agents.proposals.artifactKinds and readback`] };
  if (needsApply && facet['activation'] !== 'direct-rbac') return { skip: ['inapplicable', 'agents.proposals.activation is not direct-rbac — the apply is gated by an approval run'] };
  return { facet };
}

/** The first pack kind the host reads back, for the kind-neutral refusal legs. */
async function anyKind(): Promise<Skip | { kind: PackKind }> {
  let last: Skip | undefined;
  for (const kind of ['workflow-chain-pack', 'agent-pack'] as const) {
    const g = await gate(kind, true);
    if (!('skip' in g)) return { kind };
    last = g;
  }
  return last ?? { skip: ['inapplicable', 'the host reads back no pack kind'] };
}

interface Lifecycle {
  readonly blockedAt?: string;
  readonly p: Rec; readonly p2: Rec; readonly name: string; readonly agentId?: string;
  readonly inertPack?: Exchange; readonly inertAgent?: { get: Exchange; list: Exchange; agentId: string };
  readonly apply?: Exchange; readonly agentAfter?: Exchange;
  readonly readback?: Exchange;
  readonly conflict?: { apply: Exchange; after: Exchange } | string;
  readonly foreign?: Array<{ what: string; foreign: Exchange; unknown: Exchange }> | string;
}

const runs = new Map<PackKind, Promise<Lifecycle>>();
/** One lifecycle per kind per worker: every host leg judges a slice of the same records. */
function lifecycle(kind: PackKind): Promise<Lifecycle> {
  let r = runs.get(kind);
  if (r === undefined) { r = drive(kind); runs.set(kind, r); }
  return r;
}

async function drive(kind: PackKind): Promise<Lifecycle> {
  const nonce = randomBytes(6).toString('hex');
  const p = kind === 'agent-pack' ? freshAgentPack(nonce, 'You triage the input into one of three queues.') : freshChainPack(nonce, 'Passes its input through unchanged.');
  const p2 = kind === 'agent-pack'
    ? { ...p, agents: [{ ...(p['agents'] as Rec[])[0], systemPrompt: 'You triage the input into exactly one of three queues.' }] }
    : { ...p, description: 'A one-node chain that passes its input through.' };
  const name = p['name'] as string;
  const agentId = kind === 'agent-pack' ? agentIdOf(p) : undefined;
  const base = { p, p2, name, ...(agentId === undefined ? {} : { agentId }) };

  const submit = await ask('POST', '/proposals', { kind, artifact: p, title: 'conformance pack proposal' });
  const pid = isRec(submit?.json) && typeof submit.json['id'] === 'string' ? submit.json['id'] : undefined;
  if (submit?.status !== 201 || pid === undefined) return { ...base, blockedAt: `submitProposal answered ${submit?.status ?? 'nothing'}; no proposal to drive` };
  const path = `/proposals/${encodeURIComponent(pid)}`;

  const inertPack = await ask('GET', packPath(name));
  const inertAgent = agentId === undefined ? undefined : { get: await ask('GET', agentPath(agentId)), list: await ask('GET', '/agents'), agentId };
  const revise = await ask('PATCH', path, { artifact: p2 });
  if (revise?.status !== 200) return { ...base, inertPack, ...(inertAgent ? { inertAgent } : {}), blockedAt: `reviseProposal answered ${revise?.status ?? 'nothing'}` };

  const apply = await ask('POST', `${path}:apply`, { artifactDigest: artifactDigest(p2) });
  const readback = await ask('GET', packPath(name));
  const agentAfter = agentId === undefined ? undefined : await ask('GET', agentPath(agentId));

  let conflict: Lifecycle['conflict'];
  const again = await ask('POST', '/proposals', { kind, artifact: p2, title: 'conformance pack proposal (same version)' });
  const pid2 = isRec(again?.json) && typeof again.json['id'] === 'string' ? again.json['id'] : undefined;
  if (again?.status !== 201 || pid2 === undefined) conflict = `a second submitProposal at the same name answered ${again?.status ?? 'nothing'}`;
  else {
    const path2 = `/proposals/${encodeURIComponent(pid2)}`;
    conflict = { apply: await ask('POST', `${path2}:apply`, { artifactDigest: artifactDigest(p2) }), after: await ask('GET', path2) };
  }

  const tenantB = process.env['OPENWOP_TEST_TENANT_B_API_KEY']?.trim();
  let foreign: Lifecycle['foreign'];
  if (!tenantB) foreign = 'OPENWOP_TEST_TENANT_B_API_KEY (a credential bound to a second tenant) is not set';
  else if (tenantB === process.env['OPENWOP_API_KEY']) foreign = 'OPENWOP_TEST_TENANT_B_API_KEY equals OPENWOP_API_KEY — the leg needs a second tenant';
  else {
    foreign = [{ what: 'getInstalledPack for the installed pack', foreign: await ask('GET', packPath(name), undefined, tenantB),
      unknown: await ask('GET', packPath(`private.conformance.u${nonce}`), undefined, tenantB) }];
    if (agentId !== undefined) {
      foreign.push({ what: 'getAgent for the installed agent', foreign: await ask('GET', agentPath(agentId), undefined, tenantB),
        unknown: await ask('GET', agentPath(`private.conformance.u${nonce}.triage`), undefined, tenantB) });
    }
  }
  return { ...base, inertPack, ...(inertAgent ? { inertAgent } : {}), apply, readback, ...(agentAfter ? { agentAfter } : {}), conflict, foreign };
}

/** Submit a forbidden artifact and try to apply it; judge the refusal wherever it lands. */
async function refused(what: string, kind: PackKind, artifact: Rec): Promise<ProposalFinding[] | string> {
  const name = artifact['name'] as string;
  const agentId = kind === 'agent-pack' ? agentIdOf(artifact) : undefined;
  const submit = await ask('POST', '/proposals', { kind, artifact, title: `conformance ${what}` });
  if (submit?.status === 400 || submit?.status === 422) return judgePackRefusedAtSubmit(what, submit, await ask('GET', packPath(name)));
  const pid = isRec(submit?.json) && typeof submit.json['id'] === 'string' ? submit.json['id'] : undefined;
  if (submit?.status !== 201 || pid === undefined) return `submitProposal for ${what} answered ${submit?.status ?? 'nothing'}`;
  const path = `/proposals/${encodeURIComponent(pid)}`;
  const apply = await ask('POST', `${path}:apply`, { artifactDigest: artifactDigest(artifact) });
  return judgePackRefused(what, apply, await ask('GET', path), await ask('GET', packPath(name)),
    agentId === undefined ? undefined : await ask('GET', agentPath(agentId)));
}

function expectAll(id: string, findings: readonly ProposalFinding[]): void {
  for (const x of findings) expect(x.ok, req(id, DOC, x.message)).toBe(true);
}

type Leg = Skip | { l: Lifecycle };
/** Gate, then drive (or reuse) the kind's lifecycle; `blocked` when it stopped before `has`. */
async function legFor(kind: PackKind, needsApply: boolean, has: (l: Lifecycle) => boolean, stage: string): Promise<Leg> {
  const g = await gate(kind, needsApply);
  if ('skip' in g) return g;
  const l = await lifecycle(kind);
  if (!has(l)) return { skip: ['blocked', l.blockedAt ?? `the lifecycle did not reach ${stage}`] };
  return { l };
}

describe('v2 RFC 0253 — pack read-back wire shape (server-free)', () => {
  it('installedArtifact names getInstalledPack with a version; the fresh artifacts are valid and admissible; the negatives break §D', () => {
    const S = 'proposal.schema.json installedArtifact, the two manifest schemas, agents.schema.json §proposals.readback (RFC 0253 §B–§D)';
    const installed = v2RefValidator('proposal.schema.json#/properties/activation/properties/installedArtifact');
    expect(installed({ kind: 'agent-pack', operationId: 'getInstalledPack', id: 'private.acme.triage-agents', version: '1.0.0' }).ok,
      req(ID_SHAPE, S, 'an installedArtifact naming getInstalledPack with a version MUST validate')).toBe(true);
    const chain = freshChainPack('s1', 'shape');
    const agent = freshAgentPack('s1', 'You triage.');
    expect(v2Validator('workflow-chain-pack-manifest')(chain).ok, req(ID_SHAPE, S, 'the fresh chain pack MUST validate against workflow-chain-pack-manifest')).toBe(true);
    expect(v2Validator('node-pack-manifest')(agent).ok, req(ID_SHAPE, S, 'the fresh agent pack MUST validate against node-pack-manifest')).toBe(true);
    expect(packContentViolations('workflow-chain-pack', chain), req(ID_SHAPE, S, 'the fresh chain pack MUST satisfy §D')).toEqual([]);
    expect(packContentViolations('agent-pack', agent), req(ID_SHAPE, S, 'the fresh agent pack MUST satisfy §D')).toEqual([]);
    const a0 = (agent['agents'] as Rec[])[0] as Rec;
    const { systemPrompt: _sp, ...noInline } = a0;
    const negatives: Array<[PackKind, Rec, string]> = [
      ['agent-pack', { ...agent, agents: [{ ...noInline, systemPromptRef: 'prompts/a.md' }] }, 'an agent carrying systemPromptRef'],
      ['agent-pack', { ...agent, nodes: [{ typeId: `${String(agent['name'])}.n`, version: '1.0.0', category: 'data', role: 'pure' }] }, 'an agent pack with nodes'],
      ['workflow-chain-pack', { ...chain, signing: { keyId: 'conformance-key', scheme: 'ed25519-canonical-json' } }, 'a chain pack carrying signing'],
      ['agent-pack', { ...agent, name: 'vendor.acme.triage' }, 'a vendor.* name'],
    ];
    for (const [kind, doc, what] of negatives) {
      expect(packContentViolations(kind, doc).length, req(ID_SHAPE, S, `${what} MUST break §D`)).toBeGreaterThan(0);
    }
  });
});

describe('v2 RFC 0253 — workflow-chain-pack read-back (host)', () => {
  it('an unapplied workflow-chain-pack is not served', async () => {
    const r = await legFor('workflow-chain-pack', false, (l) => l.inertPack !== undefined, 'the draft');
    if ('skip' in r) return softSkip(...r.skip);
    expectAll(ID_CHAIN_DRAFT_INERT, judgePackInert(r.l.inertPack ?? null));
  });

  it('an authorized apply of a workflow-chain-pack names getInstalledPack, the name and the version', async () => {
    const r = await legFor('workflow-chain-pack', true, (l) => l.apply !== undefined, 'the apply');
    if ('skip' in r) return softSkip(...r.skip);
    expectAll(ID_CHAIN_APPLY_INSTALLS, judgePackApplied(r.l.apply ?? null, 'workflow-chain-pack', r.l.p2));
  });

  it('the installed workflow-chain-pack is the reviewed revision, byte for byte', async () => {
    const r = await legFor('workflow-chain-pack', true, (l) => l.readback !== undefined, 'the read-back');
    if ('skip' in r) return softSkip(...r.skip);
    expectAll(ID_CHAIN_READBACK_BYTE_MATCH, judgePackReadback(r.l.readback ?? null, r.l.p2, r.l.p));
  });
});

describe('v2 RFC 0253 — agent-pack read-back (host)', () => {
  it('an unapplied agent-pack is not served, and its agent is not resolvable or listed', async () => {
    const r = await legFor('agent-pack', false, (l) => l.inertPack !== undefined, 'the draft');
    if ('skip' in r) return softSkip(...r.skip);
    expectAll(ID_AGENT_DRAFT_INERT, judgePackInert(r.l.inertPack ?? null, r.l.inertAgent));
  });

  it('an authorized apply of an agent-pack names getInstalledPack, the name and the version, and resolves the agent', async () => {
    const r = await legFor('agent-pack', true, (l) => l.apply !== undefined, 'the apply');
    if ('skip' in r) return softSkip(...r.skip);
    expectAll(ID_AGENT_APPLY_INSTALLS, judgePackApplied(r.l.apply ?? null, 'agent-pack', r.l.p2, r.l.agentAfter ?? null));
  });

  it('the installed agent-pack is the reviewed revision, byte for byte', async () => {
    const r = await legFor('agent-pack', true, (l) => l.readback !== undefined, 'the read-back');
    if ('skip' in r) return softSkip(...r.skip);
    expectAll(ID_AGENT_READBACK_BYTE_MATCH, judgePackReadback(r.l.readback ?? null, r.l.p2, r.l.p));
  });
});

describe('v2 RFC 0253 — refusals, conflicts and tenancy (host)', () => {
  it('an agent pack with a file reference, or with nodes, is refused and installs nothing', async () => {
    const g = await gate('agent-pack', true);
    if ('skip' in g) return softSkip(...g.skip);
    const nonce = randomBytes(6).toString('hex');
    const withRef = freshAgentPack(`r${nonce}`, 'unused');
    const { systemPrompt: _sp, ...a0 } = (withRef['agents'] as Rec[])[0] as Rec;
    const withNodes = freshAgentPack(`n${nonce}`, 'You triage.');
    const findings: ProposalFinding[] = [];
    for (const [what, artifact] of [
      ['an agent carrying systemPromptRef', { ...withRef, agents: [{ ...a0, systemPromptRef: 'prompts/a.md' }] }],
      ['an agent pack with nodes', { ...withNodes, nodes: [{ typeId: `${String(withNodes['name'])}.n`, version: '1.0.0', category: 'data', role: 'pure' }] }],
    ] as const) {
      const r = await refused(what, 'agent-pack', artifact);
      if (typeof r === 'string') return softSkip('blocked', r);
      findings.push(...r);
    }
    expectAll(ID_AGENT_FILE_REF_REFUSED, findings);
  });

  it('a pack named outside private.* is refused and installs nothing', async () => {
    const g = await anyKind();
    if ('skip' in g) return softSkip(...g.skip);
    const nonce = randomBytes(6).toString('hex');
    const base = g.kind === 'agent-pack' ? freshAgentPack(nonce, 'You triage.') : freshChainPack(nonce, 'namespace');
    const r = await refused('a vendor.* name', g.kind, { ...base, name: `vendor.conformance.v${nonce}` });
    if (typeof r === 'string') return softSkip('blocked', r);
    expectAll(ID_NAMESPACE_REFUSED, r);
  });

  it('a pack carrying signing is refused and installs nothing', async () => {
    const g = await anyKind();
    if ('skip' in g) return softSkip(...g.skip);
    const nonce = randomBytes(6).toString('hex');
    const base = g.kind === 'agent-pack' ? freshAgentPack(nonce, 'You triage.') : freshChainPack(nonce, 'signing');
    const r = await refused('a pack carrying signing', g.kind, { ...base, signing: { keyId: 'conformance-key', scheme: 'ed25519-canonical-json' } });
    if (typeof r === 'string') return softSkip('blocked', r);
    expectAll(ID_SIGNING_REFUSED, r);
  });

  it('a second apply at the installed name and version is an install conflict', async () => {
    const g = await anyKind();
    if ('skip' in g) return softSkip(...g.skip);
    const l = await lifecycle(g.kind);
    if (l.conflict === undefined) return softSkip('blocked', l.blockedAt ?? 'the lifecycle did not reach the second proposal');
    if (typeof l.conflict === 'string') return softSkip('blocked', l.conflict);
    expectAll(ID_INSTALL_CONFLICT, judgeInstallConflict(l.conflict.apply, l.conflict.after));
  });

  it('another tenant sees the installed pack and agent as unknown names', async () => {
    const g = await anyKind();
    if ('skip' in g) return softSkip(...g.skip);
    const pairs: Array<{ what: string; foreign: Exchange; unknown: Exchange }> = [];
    for (const kind of ['workflow-chain-pack', 'agent-pack'] as const) {
      if ('skip' in (await gate(kind, true))) continue;
      const l = await lifecycle(kind);
      if (l.foreign === undefined) return softSkip('blocked', l.blockedAt ?? 'the lifecycle did not reach the foreign reads');
      if (typeof l.foreign === 'string') return softSkip('blocked', l.foreign);
      pairs.push(...l.foreign);
    }
    expectAll(ID_CROSS_TENANT_NOT_FOUND, judgeForeign(pairs));
  });
});
