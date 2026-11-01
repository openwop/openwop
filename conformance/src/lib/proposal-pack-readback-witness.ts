/**
 * RFC 0253 — pure judges for `v2-proposal-pack-readback.test.ts`. The scenario
 * drives a client-submitted `workflow-chain-pack` and `agent-pack` proposal
 * through submit → revise → apply and records every response; these functions
 * decide each leg from those records, so the self-tests can fail every wrong
 * host answer without a host.
 *
 * The rules are the `getInstalledPack` operation in `api/v2/openapi.yaml`, the
 * `agents.proposals.readback` description in `spec/v2/facets/agents.schema.json`
 * and `activation.installedArtifact` in `proposal.schema.json`. For the two pack
 * kinds no field is host-owned, so the byte-match is plain JCS equality.
 *
 * @see RFCS/0253-installed-pack-readback.md
 */

import { canonicalJSON } from './jcs.js';
import { readErrorCode } from './error-envelope.js';
import type { Exchange, ProposalFinding } from './proposal-lifecycle-witness.js';

export type PackKind = 'workflow-chain-pack' | 'agent-pack';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const f = (ok: boolean, message: string): ProposalFinding => ({ ok, message });
const code = (x: Exchange): string | undefined => readErrorCode(x?.json);
const details = (x: Exchange): Rec => {
  const body = isRec(x?.json) ? x.json : {};
  if (isRec(body['details'])) return body['details'];
  const nested = body['error'];
  return isRec(nested) && isRec(nested['details']) ? nested['details'] : {};
};
const shown = (x: Exchange): string => (x === null ? 'no answer' : `${x.status}${code(x) ? ` ${code(x)}` : ''}`);
const stateOf = (x: Exchange): unknown => (isRec(x?.json) ? x.json['state'] : undefined);

/** RFC 8785 (JCS) equality; the host-owned field set is empty for both pack kinds. */
export function packMatches(served: unknown, artifact: unknown): boolean {
  return canonicalJSON(served) === canonicalJSON(artifact);
}

const ENGINES = { openwop: '>=2.0 <3.0.0' };

/** A fresh one-chain `private.*` chain pack the host has never seen. */
export function freshChainPack(nonce: string, description: string): Rec {
  const name = `private.conformance.c${nonce}`;
  return {
    name, version: '1.0.0', kind: 'workflow-chain', engines: ENGINES,
    chains: [{
      chainId: `${name}.passthrough`, version: '1.0.0', label: 'Pass through', description,
      parameters: { type: 'object', properties: {} },
      dag: { nodes: [{ id: 'n1', typeId: 'core.noop' }] },
    }],
  };
}

/**
 * A fresh pure-agent `private.*` pack with one inline-prompt agent. The entry is
 * under `.invalid` (RFC 6761), so a host that wrongly dereferences it gains nothing.
 */
export function freshAgentPack(nonce: string, systemPrompt: string): Rec {
  const name = `private.conformance.a${nonce}`;
  return {
    name, version: '1.0.0', kind: 'node', engines: ENGINES,
    runtime: { language: 'remote', entry: 'https://conformance.invalid/agents' },
    agents: [{ agentId: `${name}.triage`, persona: 'Conformance triage', modelClass: 'general', systemPrompt }],
  };
}

/** The first agent's id in an agent pack. */
export function agentIdOf(pack: Rec): string {
  const agents = Array.isArray(pack['agents']) ? pack['agents'] : [];
  const first = agents[0];
  return isRec(first) && typeof first['agentId'] === 'string' ? first['agentId'] : '';
}

/**
 * The §D content rules, as violations (empty = admissible). Schema validity is
 * checked separately; these are the rules a valid manifest can still break.
 */
export function packContentViolations(kind: PackKind, pack: Rec): string[] {
  const out: string[] = [];
  if (typeof pack['name'] !== 'string' || !pack['name'].startsWith('private.')) out.push('name outside private.*');
  if ('signing' in pack) out.push('carries signing');
  if (kind === 'agent-pack') {
    if (Array.isArray(pack['nodes']) && pack['nodes'].length > 0) out.push('carries nodes');
    const rt = isRec(pack['runtime']) ? pack['runtime'] : {};
    if (rt['language'] !== 'remote') out.push('runtime.language is not remote');
    const agents = Array.isArray(pack['agents']) ? pack['agents'].filter(isRec) : [];
    if (agents.length === 0) out.push('no agents');
    for (const a of agents) {
      if (typeof a['systemPrompt'] !== 'string') out.push(`${String(a['agentId'])}: no inline systemPrompt`);
      for (const k of ['systemPromptRef', 'evalSuiteRef']) if (k in a) out.push(`${String(a['agentId'])}: carries ${k}`);
      const h = isRec(a['handoff']) ? a['handoff'] : {};
      for (const k of ['taskSchemaRef', 'returnSchemaRef']) if (k in h) out.push(`${String(a['agentId'])}: carries handoff.${k}`);
    }
  }
  return out;
}

const listed = (list: Exchange, agentId: string): boolean | null => {
  const items = isRec(list?.json) && Array.isArray(list.json['agents']) ? (list.json['agents'] as unknown[]).filter(isRec) : null;
  return items === null ? null : items.some((a) => a['agentId'] === agentId);
};

/** An unapplied pack is not served; for an agent pack, its agent is not resolvable or listed. */
export function judgePackInert(pack: Exchange, agent?: { get: Exchange; list: Exchange; agentId: string }): ProposalFinding[] {
  const out = [f(pack?.status === 404, `getInstalledPack MUST answer 404 for an unapplied proposal's name (got ${shown(pack)})`)];
  if (agent !== undefined) {
    const inList = listed(agent.list, agent.agentId);
    out.push(
      f(agent.get?.status === 404, `getAgent MUST answer 404 for an unapplied proposal's agent (got ${shown(agent.get)})`),
      f(agent.list?.status === 200 && inList !== null, `listAgents MUST answer 200 with agents (got ${shown(agent.list)})`),
      f(inList === false, 'listAgents MUST NOT list an unapplied proposal\'s agent'),
    );
  }
  return out;
}

/** A successful apply names `getInstalledPack`, the artifact's own name, and its version. */
export function judgePackApplied(apply: Exchange, kind: PackKind, artifact: Rec, agentGet?: Exchange): ProposalFinding[] {
  const p = isRec(apply?.json) ? apply.json : {};
  const act = isRec(p['activation']) ? p['activation'] : {};
  const ia = isRec(act['installedArtifact']) ? act['installedArtifact'] : {};
  const out = [
    f(apply?.status === 200 && p['state'] === 'applied', `an authorized apply MUST answer 200 with state applied (got ${shown(apply)}, state ${JSON.stringify(p['state'])})`),
    f(ia['kind'] === kind && ia['operationId'] === 'getInstalledPack', `activation.installedArtifact MUST name kind ${kind} and operationId getInstalledPack (got ${JSON.stringify(ia)})`),
    f(ia['id'] === artifact['name'], `installedArtifact.id MUST be the artifact's name, never a minted one (got ${JSON.stringify(ia['id'])})`),
    f(ia['version'] === artifact['version'], `installedArtifact.version MUST be the artifact's version (got ${JSON.stringify(ia['version'])})`),
  ];
  if (agentGet !== undefined) out.push(f(agentGet?.status === 200, `getAgent MUST resolve an applied agent pack's agent for the applying caller (got ${shown(agentGet)})`));
  return out;
}

/** The installed pack is the reviewed revision, byte for byte, with nothing removed. */
export function judgePackReadback(served: Exchange, revised: Rec, original: Rec): ProposalFinding[] {
  return [
    f(served?.status === 200, `getInstalledPack MUST serve the installed pack after apply (got ${shown(served)})`),
    f(served?.status === 200 && packMatches(served.json, revised), 'the read-back MUST be JCS-equal to the last-persisted (revised) artifact, with no field removed or added'),
    f(served?.status === 200 && !packMatches(served.json, original), 'the read-back MUST NOT be the pre-revision artifact: that is a silent re-synthesis'),
  ];
}

/** An apply of an artifact §D forbids is `422`, installs nothing and leaves `state` unchanged. */
export function judgePackRefused(what: string, apply: Exchange, after: Exchange, pack: Exchange, agentGet?: Exchange): ProposalFinding[] {
  const out = [
    f(apply?.status === 422, `${what}: the apply MUST be refused 422 (got ${shown(apply)})`),
    f(stateOf(after) === 'draft', `${what}: a refused apply MUST leave state unchanged (got ${JSON.stringify(stateOf(after))})`),
    f(pack?.status === 404, `${what}: a refused apply MUST install nothing (getInstalledPack ${shown(pack)})`),
  ];
  if (agentGet !== undefined) out.push(f(agentGet?.status === 404, `${what}: a refused apply MUST install no agent (getAgent ${shown(agentGet)})`));
  return out;
}

/**
 * RFC 0249 §B lets a host validate an artifact at submit. A §D violation refused
 * there (`400` or `422`) is as good as one refused at apply, if nothing installed.
 */
export function judgePackRefusedAtSubmit(what: string, submit: Exchange, pack: Exchange): ProposalFinding[] {
  return [
    f(submit?.status === 400 || submit?.status === 422, `${what}: a submit refused for its content MUST answer 400 or 422 (got ${shown(submit)})`),
    f(pack?.status === 404, `${what}: a refused submit MUST install nothing (getInstalledPack ${shown(pack)})`),
  ];
}

/** A second apply at the installed name and version is `409 proposal_install_conflict` `version-not-greater`. */
export function judgeInstallConflict(apply: Exchange, after: Exchange): ProposalFinding[] {
  return [
    f(apply?.status === 409 && code(apply) === 'proposal_install_conflict', `an apply at an equal installed version MUST be refused 409 proposal_install_conflict (got ${shown(apply)})`),
    f(details(apply)['reason'] === 'version-not-greater', `the refusal MUST name details.reason "version-not-greater" (got ${JSON.stringify(details(apply)['reason'])})`),
    f(stateOf(after) === 'draft', `a refused install MUST leave state unchanged (got ${JSON.stringify(stateOf(after))})`),
  ];
}
