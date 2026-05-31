/**
 * Shared helpers for the RFC 0082 `agents.deployment` conformance scenario.
 * Lives in lib/ (not a `*.test.ts`) so scenarios import it via
 * `../lib/agentDeployment.js`.
 *
 * Two surfaces:
 *   - the NORMATIVE read (`GET /v1/agents/{agentId}/deployments`, RFC 0082
 *     §C/§E), exercised black-box; and
 *   - the host-sample deployment-transition seam
 *     (`POST /v1/host/sample/agents/deployment-transition`), used to drive the
 *     §E promotion contract (authorize → approvalGate → eval-verify →
 *     `deployment.promoted`), the fail-closed denial, the eval-gate-unmet
 *     denial, and the §B channel-resolution pin, so the `deployment.*` events +
 *     the `resolvedAgentVersion` recorded fact can be asserted against the test
 *     event-log seam. The seam is OPTIONAL — scenarios soft-skip on 404/405
 *     (the reference deployment store is deferred per RFC 0082 §Conformance).
 *
 * Gating uses the `agents.deployment.supported` capability flag from the live
 * discovery doc (root-first per RFC 0073).
 *
 * @see RFCS/0082-agent-deployment-lifecycle.md
 * @see spec/v1/agent-deployment.md
 */
import { driver } from './driver.js';
import { readCapabilityFamily } from './discovery-capabilities.js';

/** Reads `agents.deployment` from discovery (root-first per RFC 0073); null
 *  when unadvertised. */
export async function readDeploymentCap(): Promise<Record<string, unknown> | null> {
  const agents = await readCapabilityFamily<{ deployment?: unknown }>('agents');
  const dep = agents?.deployment;
  return dep && typeof dep === 'object' ? (dep as Record<string, unknown>) : null;
}

export interface DeploymentRecord {
  agentId?: string;
  version?: string;
  state?: string;
  canaryPercent?: number;
  channels?: string[];
  [k: string]: unknown;
}

/** GET the NORMATIVE deployment-record list (RFC 0082 §C/§E
 *  `GET /v1/agents/{agentId}/deployments`); null when the host doesn't serve it
 *  (404/405/501). */
export async function listDeployments(agentId: string): Promise<DeploymentRecord[] | null> {
  const res = await driver.get(`/v1/agents/${encodeURIComponent(agentId)}/deployments`);
  if (res.status === 404 || res.status === 405 || res.status === 501) return null;
  return (res.json as DeploymentRecord[] | undefined) ?? [];
}

export interface TransitionResult {
  runId?: string;
  record?: DeploymentRecord;
  /** Fail-closed signal: false when the principal lacks the `deploy:*` scope. */
  allowed?: boolean;
  /** A denial reason (e.g. `eval_gate_unmet`, `no_active_deployment`). */
  error?: string;
  /** §B — the channel→version pin recorded at first resolution. */
  resolvedAgentVersion?: string;
}

/**
 * Drive one deployment transition through the host-sample seam (RFC 0082 §E).
 * `scenario`:
 *   - `promote`         — authorize → gate → eval-verify (when `evalRunId` set)
 *                         → emit `deployment.promoted` (§E).
 *   - `unauthorized`    — a principal lacking `deploy:promote`; MUST fail closed
 *                         (`allowed:false`, no `deployment.promoted`) — the
 *                         `deployment-promotion-fail-closed` invariant.
 *   - `eval-gate-unmet` — promote with an `evalRunId` whose `EvalSummary.passed`
 *                         is false; MUST deny with `eval_gate_unmet` (§E-3).
 *   - `channel-pin`     — start a `@channel`-bound run; the resolved version is
 *                         recorded as `resolvedAgentVersion` on
 *                         `agent.invocation.started` (§B).
 * Returns null when the seam is unwired (404/405).
 */
export async function driveDeploymentTransition(
  body: {
    scenario: 'promote' | 'unauthorized' | 'eval-gate-unmet' | 'channel-pin';
    agentId?: string;
    version?: string;
    channel?: string;
    evalRunId?: string;
  },
): Promise<TransitionResult | null> {
  const res = await driver.post('/v1/host/sample/agents/deployment-transition', body);
  if (res.status === 404 || res.status === 405) return null;
  return (res.json as TransitionResult | undefined) ?? {};
}

/** The seven-state lifecycle vocabulary (RFC 0082 §C). */
export const DEPLOYMENT_STATES = [
  'draft',
  'test',
  'staged',
  'active',
  'paused',
  'deprecated',
  'rolled-back',
];

/** Content keys a `deployment.*` event / record MUST NEVER carry (SECURITY
 *  invariant `deployment-event-no-content-leak`, SR-1): manifest body, prompt,
 *  or credential material. */
export const DEPLOYMENT_CONTENT_FORBIDDEN = [
  'manifestBody',
  'manifest',
  'prompt',
  'systemPrompt',
  'body',
  'secret',
  'credentials',
  'token',
  'apiKey',
];
