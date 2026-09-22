/**
 * RFC 0202 — each inventoried agent is published as an A2A 1.0 Agent Card,
 * reached by the opaque routing value `a2aTenant` (`R`) through
 * `GetExtendedAgentCard { tenant: R }`, without making the card an existence
 * oracle across tenants (`spec/v2/core/interop.md` §"Per-agent cards").
 * Target major 2.
 *
 * Gate: the v2 `a2a` record carries `agentCards` (else `inapplicable`), and the
 * caller's `GET /agents` returns at least one entry with `a2aTenant` (else
 * `inapplicable` — a tenant-scoped inventory MAY be empty). The suite speaks
 * A2A 1.0 JSON-RPC to the first `JSONRPC` interface at `1.0` of the host's own
 * public card (`a2a.agentCardUrl`); every request carries `A2A-Version: 1.0`.
 *
 * Cross-tenant legs (`identical-refusal`, `tenant-of-record`) need
 * `OPENWOP_TEST_TENANT_B_API_KEY`, a credential bound to a SECOND tenant
 * (not `OPENWOP_TEST_SECONDARY_API_KEY`, a same-principal rotation key), and an
 * agent tenant B has that the caller's inventory lacks. The suite finds it as
 * the set difference of the two inventories, or takes
 * `OPENWOP_TEST_TENANT_B_AGENT_ID` when the operator names one. Missing ⇒
 * `blocked`, never a pass.
 *
 * SR-1 leg: the canary strings are defined by `conformance/fixtures.md`
 * §"Agent Pack Install" for the `core.conformance.agent-pack` pack
 * (`conformance-agent-pack-install`'s `requiresInstalledPack`); the leg runs
 * only when the caller's inventory carries an agent of that pack.
 *
 * What `routing-value` does NOT witness (RFC 0202 G4): that `R` encodes no
 * identifier the host keeps private. It checks stability and that `R` contains
 * no identifier the host itself disclosed on a run snapshot (tenant, workspace,
 * subject); a host that encodes an undisclosed identifier is not caught.
 * Response latency is not compared (G7).
 *
 * @see spec/v2/core/interop.md §"Per-agent cards"
 * @see schemas/v2/agent-inventory-response.schema.json `a2aTenant`
 * @see RFCS/0202-per-agent-a2a-agent-cards.md
 */
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { driver } from '../lib/driver.js';
import { v2Discovery, familyAdvertised, v2Validator } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

export const HOST_CALLBACK_NOT_REQUIRED = 'the suite is the A2A client: every leg POSTs JSON-RPC to the interface the host\'s own public card lists; nothing harness-hosted is handed to the host';

const DOC = 'spec/v2/core/interop.md §"Per-agent cards" (RFC 0202)';
const PROFILE = 'a2a-1.0';
const R = (slug: string): string => `openwop.requirement.0202.${slug}`;
/** conformance/fixtures.md §"Agent Pack Install" — the pack and the two canaries it carries. */
const CANARY_PACK = 'core.conformance.agent-pack';
const CANARIES = ['OPENWOP-CONFORMANCE-CANARY-0202-PROMPT', 'OPENWOP-CONFORMANCE-CANARY-0202-HANDOFF'];

interface RpcError { code: number; message?: string; data?: unknown }
interface Rpc { status: number; body: Record<string, unknown>; result?: Record<string, unknown> | undefined; error?: RpcError | undefined }
interface Iface { url?: string; protocolBinding?: string; protocolVersion?: string; tenant?: string }
interface Card { name?: string; description?: string; version?: string; supportedInterfaces?: Iface[]; capabilities?: Record<string, unknown>; securitySchemes?: unknown; securityRequirements?: unknown; skills?: Array<{ id?: string; name?: string; description?: string; tags?: unknown }> }
interface Entry { agentId: string; persona?: string; label?: string; description?: string; packName?: string; packVersion?: string; hasHandoffSchemas?: boolean; a2aTenant?: string; roster?: Array<{ workflows?: string[] }> }

async function rpc(url: string, method: string, params: unknown, bearer: string | null = process.env.OPENWOP_API_KEY ?? null): Promise<Rpc> {
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json', 'A2A-Version': '1.0' };
  if (bearer) headers['authorization'] = `Bearer ${bearer}`;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: randomBytes(4).readUInt32BE(0), method, params }) });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try { const parsed = JSON.parse(text) as unknown; if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed as Record<string, unknown>; } catch { body = { nonJson: text }; }
  return { status: res.status, body, result: body['result'] as Record<string, unknown> | undefined, error: body['error'] as RpcError | undefined };
}

/** What two refusals must share: HTTP status and the body apart from the JSON-RPC `id`. */
const refusalOf = (r: Rpc): string => { const { id: _id, ...rest } = r.body; void _id; return JSON.stringify({ status: r.status, body: rest }); };

async function inventory(bearer?: string): Promise<{ status: number; body: unknown; agents: Entry[] }> {
  const res = bearer === undefined
    ? await driver.get('/agents')
    : await driver.get('/agents', { authenticated: false, headers: { Authorization: `Bearer ${bearer}` } });
  const agents = res.status === 200 && Array.isArray((res.json as { agents?: unknown[] } | undefined)?.agents) ? ((res.json as { agents: Entry[] }).agents) : [];
  return { status: res.status, body: res.json, agents };
}

async function publicCard(url: string, withVersion: boolean): Promise<{ status: number; text: string; card: Card }> {
  const res = await fetch(url, { headers: withVersion ? { accept: 'application/json', 'A2A-Version': '1.0' } : { accept: 'application/json' } });
  const text = await res.text();
  let card: Card = {};
  try { card = JSON.parse(text) as Card; } catch { /* non-JSON card */ }
  return { status: res.status, text, card };
}

type Target =
  | { ok: true; url: string; card: Card; cardUrl: string; entries: Entry[]; routed: Entry[] }
  | { ok: false; kind: 'inapplicable' | 'blocked'; reason: string }
  | { ok: false; kind: 'fail'; reason: string };

async function target(): Promise<Target> {
  if (!(await v2Discovery())) return { ok: false, kind: 'blocked', reason: 'v2 discovery unreachable' };
  const a2a = await familyAdvertised('a2a');
  if (!a2a) return { ok: false, kind: 'inapplicable', reason: 'a2a not advertised at major 2' };
  if (a2a['agentCards'] !== true) return { ok: false, kind: 'inapplicable', reason: 'a2a.agentCards not advertised — the host publishes no per-agent card' };
  const cardUrl = a2a['agentCardUrl'];
  if (typeof cardUrl !== 'string') return { ok: false, kind: 'fail', reason: 'a host advertising a2a.agentCards offers the a2a-1.0 profile and MUST advertise a2a.agentCardUrl' };
  const pub = await publicCard(cardUrl, true);
  if (pub.status !== 200) return { ok: false, kind: 'fail', reason: `the advertised agentCardUrl answered ${pub.status}` };
  const iface = (pub.card.supportedInterfaces ?? []).find((i) => i.protocolBinding === 'JSONRPC' && i.protocolVersion === '1.0');
  if (typeof iface?.url !== 'string') return { ok: false, kind: 'fail', reason: 'claiming a2a-1.0 requires a JSONRPC interface at 1.0 in the public card' };
  const inv = await inventory();
  if (inv.status !== 200) return { ok: false, kind: 'fail', reason: `a2a.agentCards requires agents.manifestRuntime, and GET /agents MUST be served (got ${inv.status})` };
  const routed = inv.agents.filter((e) => typeof e.a2aTenant === 'string' && e.a2aTenant.length > 0);
  if (routed.length === 0) return { ok: false, kind: 'inapplicable', reason: 'the caller\'s GET /agents carries no entry with a2aTenant (a tenant-scoped inventory MAY be empty, and an agent with no routed workflow has no card)' };
  return { ok: true, url: iface.url, card: pub.card, cardUrl, entries: inv.agents, routed };
}

function skip(t: Exclude<Target, { ok: true }>, id: string): undefined {
  if (t.kind === 'fail') { expect(t.reason, req(id, DOC, t.reason)).toBe(''); return undefined; }
  return softSkip(t.kind, t.reason);
}

const neverMinted = (): string => `ag-never-${randomBytes(9).toString('hex')}`;
const message = (): Record<string, unknown> => ({ messageId: `conf-0202-${randomBytes(8).toString('hex')}`, role: 'ROLE_USER', parts: [{ text: 'openwop conformance RFC 0202' }] });
const taskIdOf = (r: Rpc): string | undefined => {
  const t = (r.result?.['task'] ?? r.result) as { id?: unknown } | undefined;
  return typeof t?.id === 'string' ? t.id : undefined;
};
const ifaceKey = (i: Iface): string => JSON.stringify([i.url, i.protocolBinding, i.protocolVersion]);

/** Tenant B's entry that the caller's inventory lacks, or why the leg cannot run. */
async function foreignAgent(mine: Entry[]): Promise<{ ok: true; bearer: string; entry: Entry; theirs: Entry[] } | { ok: false; reason: string }> {
  const bearer = process.env.OPENWOP_TEST_TENANT_B_API_KEY;
  if (!bearer) return { ok: false, reason: 'OPENWOP_TEST_TENANT_B_API_KEY (a credential bound to a second tenant) is not set — the cross-tenant leg cannot run' };
  if (bearer === process.env.OPENWOP_API_KEY) return { ok: false, reason: 'OPENWOP_TEST_TENANT_B_API_KEY equals OPENWOP_API_KEY — the leg needs a second tenant' };
  const inv = await inventory(bearer);
  if (inv.status !== 200) return { ok: false, reason: `GET /agents as tenant B answered ${inv.status}` };
  const mineIds = new Set(mine.map((e) => e.agentId));
  const mineR = new Set(mine.map((e) => e.a2aTenant).filter((x): x is string => typeof x === 'string'));
  const named = process.env.OPENWOP_TEST_TENANT_B_AGENT_ID;
  const candidates = inv.agents.filter((e) => typeof e.a2aTenant === 'string' && !mineIds.has(e.agentId) && !mineR.has(e.a2aTenant) && (named === undefined || named === '' || e.agentId === named));
  const entry = candidates[0];
  if (entry === undefined) return { ok: false, reason: `tenant B's inventory has no entry with a2aTenant that the caller's lacks${named ? ` (OPENWOP_TEST_TENANT_B_AGENT_ID=${named})` : ''} — provision an agent in tenant B only` };
  return { ok: true, bearer, entry, theirs: inv.agents };
}

describe('RFC 0202 — v2-a2a-agent-cards (per-agent A2A cards, gated on a2a.agentCards)', () => {
  it('a2a.agentCards implies the a2a-1.0 profile, agents.manifestRuntime and capabilities.extendedAgentCard on the public card', async () => {
    const t = await target();
    if (!t.ok) return skip(t, R('advertisement'));
    const a2a = (await familyAdvertised('a2a'))!;
    const profiles = Array.isArray(a2a['profiles']) ? (a2a['profiles'] as unknown[]) : [];
    expect(profiles, req(R('advertisement'), DOC, 'a host advertising a2a.agentCards MUST offer the a2a-1.0 profile')).toContain(PROFILE);
    const agents = await familyAdvertised('agents');
    const mr = agents?.['manifestRuntime'];
    expect(mr !== null && typeof mr === 'object' && !Array.isArray(mr), req(R('advertisement'), DOC, 'a host advertising a2a.agentCards MUST advertise agents.manifestRuntime')).toBe(true);
    expect(t.card.capabilities?.['extendedAgentCard'], req(R('advertisement'), `${DOC}; A2A v1.0.1 §3.1.11`, 'the public card (A2A-Version: 1.0) MUST declare capabilities.extendedAgentCard: true — GetExtendedAgentCard is served only when it is')).toBe(true);
  });

  it('a2aTenant is schema-valid, stable across reads, and contains no identifier the host disclosed', async () => {
    const t = await target();
    if (!t.ok) return skip(t, R('routing-value'));
    const again = await inventory();
    const validate = v2Validator('agent-inventory-response');
    const v = validate(again.body);
    expect(v.ok, req(R('routing-value'), 'schemas/v2/agent-inventory-response.schema.json', `GET /agents MUST validate (a2aTenant is path-segment-safe, 1-128 chars): ${v.errors}`)).toBe(true);
    const first = new Map(t.entries.map((e) => [e.agentId, e.a2aTenant]));
    const second = new Map(again.agents.map((e) => [e.agentId, e.a2aTenant]));
    for (const [agentId, r] of first) {
      expect(second.get(agentId), req(R('routing-value'), DOC, `a2aTenant MUST be stable for the agent and host version: ${agentId} read ${String(r)} then ${String(second.get(agentId))}`)).toBe(r);
    }
    const rs = t.routed.map((e) => e.a2aTenant!);
    expect(new Set(rs).size, req(R('routing-value'), DOC, 'each agent has its own routing value: two entries MUST NOT share an a2aTenant')).toBe(rs.length);
    // Identifiers the host itself discloses: a run's tenant segment and its owner triple.
    const entry = t.routed[0]!;
    const sent = await rpc(t.url, 'SendMessage', { tenant: entry.a2aTenant, message: message() });
    const taskId = taskIdOf(sent);
    expect(typeof taskId, req(R('routing-value'), DOC, `SendMessage through a minted R MUST start a task so the suite can read the identifiers the host discloses (got ${JSON.stringify(sent.error ?? sent.result)})`)).toBe('string');
    const snap = await driver.get(`/runs/${encodeURIComponent(taskId!)}`);
    const owner = (snap.json as { owner?: { tenant?: unknown; workspace?: unknown; subject?: { subjectId?: unknown; issuer?: unknown } } } | undefined)?.owner;
    const disclosed = [taskId!.includes('/') ? taskId!.slice(0, taskId!.indexOf('/')) : undefined, owner?.tenant, owner?.workspace, owner?.subject?.subjectId]
      .filter((x): x is string => typeof x === 'string' && x.length >= 3);
    expect(disclosed.length, req(R('routing-value'), 'identity.md §5', 'precondition: the run snapshot discloses at least the tenant of record')).toBeGreaterThan(0);
    for (const r of rs) {
      for (const id of disclosed) {
        expect(r.toLowerCase().includes(id.toLowerCase()), req(R('routing-value'), DOC, `a2aTenant ${r} MUST NOT encode a tenant, workspace or principal — it contains the disclosed identifier ${id}`)).toBe(false);
      }
    }
    await rpc(t.url, 'CancelTask', { tenant: entry.a2aTenant, id: taskId });
  });

  it('GetExtendedAgentCard with tenant R returns that agent\'s card, projected from the entry and the host card', async () => {
    const t = await target();
    if (!t.ok) return skip(t, R('card-projection'));
    const hostIfaces = new Set((t.card.supportedInterfaces ?? []).map(ifaceKey));
    for (const e of t.routed) {
      const r = await rpc(t.url, 'GetExtendedAgentCard', { tenant: e.a2aTenant });
      expect(r.error, req(R('card-projection'), DOC, `GetExtendedAgentCard {tenant: ${e.a2aTenant}} MUST return ${e.agentId}'s card (got ${JSON.stringify(r.error)})`)).toBeUndefined();
      const card = (r.result ?? {}) as Card;
      expect(card.name, req(R('card-projection'), DOC, `card.name MUST be the entry's persona (${e.agentId})`)).toBe(e.persona);
      expect(card.version, req(R('card-projection'), DOC, `card.version MUST be the entry's packVersion (${e.agentId})`)).toBe(e.packVersion);
      expect(card.description, req(R('card-projection'), DOC, `card.description MUST be the entry's description, else its label (${e.agentId})`)).toBe(e.description ?? e.label);
      const ifaces = card.supportedInterfaces ?? [];
      expect(new Set(ifaces.map(ifaceKey)), req(R('card-projection'), DOC, 'supportedInterfaces[] MUST be the host card\'s interfaces ({url, protocolBinding, protocolVersion})')).toEqual(hostIfaces);
      for (const i of ifaces) expect(i.tenant, req(R('card-projection'), `${DOC}; A2A v1.0.1 AgentInterface.tenant`, `every interface of ${e.agentId}'s card MUST carry tenant: R`)).toBe(e.a2aTenant);
      expect(card.capabilities, req(R('card-projection'), DOC, 'capabilities MUST equal the host card\'s')).toEqual(t.card.capabilities);
      expect(card.securitySchemes, req(R('card-projection'), DOC, 'securitySchemes MUST equal the host card\'s')).toEqual(t.card.securitySchemes);
      expect(card.securityRequirements, req(R('card-projection'), 'RFC 0202 §C.4', 'securityRequirements MUST equal the host card\'s')).toEqual(t.card.securityRequirements);
      const skills = card.skills ?? [];
      expect(skills.length, req(R('card-projection'), `${DOC}; A2A AgentCard.skills REQUIRED`, `an entry with a2aTenant has at least one routed workflow, so its card has ≥1 skill (${e.agentId})`)).toBeGreaterThanOrEqual(1);
      const ids = skills.map((s) => s.id);
      expect(new Set(ids).size, req(R('card-projection'), 'spec/v2/interop-map.json a2a.card skills[]', 'one skill per routed workflow: skills[].id is unique')).toBe(ids.length);
      for (const s of skills) {
        expect(typeof s.id === 'string' && typeof s.name === 'string' && typeof s.description === 'string' && Array.isArray(s.tags), req(R('card-projection'), 'A2A v1.0.1 AgentSkill (id, name, description, tags REQUIRED)', `skill ${JSON.stringify(s)} MUST carry id, name, description and tags`)).toBe(true);
      }
      const portfolio = (e.roster ?? []).flatMap((x) => x.workflows ?? []);
      if (portfolio.length > 0) {
        for (const id of ids) expect(portfolio, req(R('card-projection'), DOC, `the inventory names ${e.agentId}'s workflows (roster[].workflows); skill ${String(id)} MUST be one of them`)).toContain(id);
      }
    }
  });

  it('the per-agent card carries nothing the inventory entry may not (SR-1)', async () => {
    const t = await target();
    if (!t.ok) return skip(t, R('card-sr1'));
    const fixture = t.routed.find((e) => e.packName === CANARY_PACK);
    if (fixture === undefined) return softSkip('inapplicable', `the caller's inventory carries no routed agent of ${CANARY_PACK} (conformance/fixtures.md §"Agent Pack Install"), so no canary is installed to look for`);
    if (fixture.hasHandoffSchemas !== true) return softSkip('blocked', `${fixture.agentId} does not declare handoff schemas — the fixture pack's agent MUST, or the handoff canary is not installed`);
    const r = await rpc(t.url, 'GetExtendedAgentCard', { tenant: fixture.a2aTenant });
    expect(r.error, req(R('card-sr1'), DOC, `GetExtendedAgentCard MUST return ${fixture.agentId}'s card (got ${JSON.stringify(r.error)})`)).toBeUndefined();
    const text = JSON.stringify(r.result ?? {});
    for (const canary of CANARIES) {
      expect(text.includes(canary), req(R('card-sr1'), `${DOC}; SR-1`, `the card MUST NOT carry the system-prompt body or a resolved handoff schema — it contains the fixture canary ${canary}`)).toBe(false);
    }
  });

  it('an unauthenticated request carrying R is refused exactly as one carrying a never-minted value', async () => {
    const t = await target();
    if (!t.ok) return skip(t, R('auth-before-resolve'));
    const real = t.routed[0]!.a2aTenant!;
    const a = await rpc(t.url, 'GetExtendedAgentCard', { tenant: real }, null);
    const b = await rpc(t.url, 'GetExtendedAgentCard', { tenant: neverMinted() }, null);
    expect(a.result === undefined || (a.result as Card).name === undefined, req(R('auth-before-resolve'), `${DOC}; A2A v1.0.1 §13.1`, `an unauthenticated GetExtendedAgentCard MUST NOT return a card (got HTTP ${a.status} ${JSON.stringify(a.body).slice(0, 200)})`)).toBe(true);
    expect(a.status >= 400 || a.error !== undefined, req(R('auth-before-resolve'), `${DOC}; A2A v1.0.1 §13.1`, `an unauthenticated request carrying R MUST be refused (got HTTP ${a.status})`)).toBe(true);
    expect(refusalOf(a), req(R('auth-before-resolve'), `${DOC}; A2A v1.0.1 §13.1 ("Authorization checks MUST occur before any database queries…")`, 'authentication MUST precede resolving R: the refusal for a real R and for a never-minted value MUST be identical (status, code, body)')).toBe(refusalOf(b));
  });

  it('another tenant\'s R is answered exactly as a never-minted one on every A2A operation', async () => {
    const t = await target();
    if (!t.ok) return skip(t, R('identical-refusal'));
    const f = await foreignAgent(t.entries);
    if (!f.ok) return softSkip('blocked', f.reason);
    const theirR = f.entry.a2aTenant!;
    // Positive control: B's own card resolves for B, so the value is real, not a typo.
    const own = await rpc(t.url, 'GetExtendedAgentCard', { tenant: theirR }, f.bearer);
    expect((own.result as Card | undefined)?.name, req(R('identical-refusal'), DOC, `positive control: tenant B's R MUST resolve to B's card for B (got ${JSON.stringify(own.error ?? own.result)})`)).toBe(f.entry.persona);
    const started: string[] = [];
    for (const [method, params] of [
      ['GetExtendedAgentCard', (r: string) => ({ tenant: r })],
      ['SendMessage', (r: string) => ({ tenant: r, message: message() })],
      ['ListTasks', (r: string) => ({ tenant: r })],
    ] as const) {
      const foreign = await rpc(t.url, method, params(theirR));
      const unminted = await rpc(t.url, method, params(neverMinted()));
      for (const x of [foreign, unminted]) { const id = taskIdOf(x); if (method === 'SendMessage' && id !== undefined) started.push(id); }
      if (method === 'GetExtendedAgentCard') {
        expect((foreign.result as Card | undefined)?.name === f.entry.persona, req(R('identical-refusal'), DOC, 'tenant A MUST NOT receive tenant B\'s agent card')).toBe(false);
      }
      expect(refusalOf(foreign), req(R('identical-refusal'), DOC, `${method} carrying another tenant's R MUST return what it returns for an R the host never minted — same HTTP status, error code and body apart from the JSON-RPC id`)).toBe(refusalOf(unminted));
    }
    for (const id of started) await rpc(t.url, 'CancelTask', { id });
  });

  it('the public card lists no per-agent routing value', async () => {
    const t = await target();
    if (!t.ok) return skip(t, R('public-card-no-r'));
    const seen = new Set(t.routed.map((e) => e.a2aTenant!));
    const b = process.env.OPENWOP_TEST_TENANT_B_API_KEY;
    if (b) for (const e of (await inventory(b)).agents) if (typeof e.a2aTenant === 'string') seen.add(e.a2aTenant);
    for (const withVersion of [false, true]) {
      const pub = await publicCard(t.cardUrl, withVersion);
      expect(pub.status, req(R('public-card-no-r'), DOC, `the public card MUST be served ${withVersion ? 'with' : 'without'} A2A-Version`)).toBe(200);
      const tenants = (pub.card.supportedInterfaces ?? []).map((i) => i.tenant).filter((x): x is string => typeof x === 'string');
      for (const r of seen) {
        expect(tenants, req(R('public-card-no-r'), DOC, `the unauthenticated card at agentCardUrl (${withVersion ? 'A2A-Version: 1.0' : 'header-less'}) MUST NOT list any R as an interface tenant`)).not.toContain(r);
        expect(pub.text.includes(r), req(R('public-card-no-r'), DOC, `the unauthenticated card MUST NOT carry the routing value ${r} anywhere`)).toBe(false);
      }
    }
  });

  it('a task started through R is a run in the caller\'s tenant of record', async () => {
    const t = await target();
    if (!t.ok) return skip(t, R('tenant-of-record'));
    const b = process.env.OPENWOP_TEST_TENANT_B_API_KEY;
    if (!b || b === process.env.OPENWOP_API_KEY) return softSkip('blocked', 'OPENWOP_TEST_TENANT_B_API_KEY (a credential bound to a second tenant) is not set — the leg cannot show the run is invisible to another tenant');
    const e = t.routed[0]!;
    const sent = await rpc(t.url, 'SendMessage', { tenant: e.a2aTenant, message: message() });
    const id = taskIdOf(sent);
    expect(typeof id, req(R('tenant-of-record'), DOC, `SendMessage {tenant: R} MUST start a task (got ${JSON.stringify(sent.error ?? sent.result)})`)).toBe('string');
    const mine = await driver.get(`/runs/${encodeURIComponent(id!)}`);
    expect(mine.status, req(R('tenant-of-record'), 'interop.md §"The operation mappings" Isolation', 'Task.id MUST be a run the caller can read through getRun')).toBe(200);
    const control = await rpc(t.url, 'SendMessage', { message: message() });
    const controlId = taskIdOf(control);
    if (typeof controlId === 'string' && controlId.includes('/') && id!.includes('/')) {
      expect(id!.slice(0, id!.indexOf('/')), req(R('tenant-of-record'), `${DOC}; identity.md §5`, 'the run MUST carry the caller\'s tenant segment — the same one a run started on the host interface carries')).toBe(controlId.slice(0, controlId.indexOf('/')));
    }
    const theirs = await driver.get(`/runs/${encodeURIComponent(id!)}`, { authenticated: false, headers: { Authorization: `Bearer ${b}` } });
    expect(theirs.status >= 200 && theirs.status < 300, req(R('tenant-of-record'), `${DOC}; interop.md Isolation`, `R is resolved within the caller's tenant: another tenant MUST NOT read the run (got ${theirs.status})`)).toBe(false);
    await rpc(t.url, 'CancelTask', { id });
    if (typeof controlId === 'string') await rpc(t.url, 'CancelTask', { id: controlId });
  });
});
