/**
 * Interrupt-resolution client. Wraps the OpenwopClient surface +
 * provides a token-inspect convenience used by deep-link UIs.
 */

import { getSdkClient } from './runsClient.js';
import { authedHeaders, config, fetchOpts } from './config.js';
import type { InterruptByTokenInspection } from '@openwop/openwop';

export async function resolveByRun(runId: string, nodeId: string, resumeValue: unknown): Promise<void> {
  await getSdkClient().interrupts.resolveByRun(runId, nodeId, { resumeValue });
}

export async function resolveByToken(token: string, resumeValue: unknown): Promise<void> {
  await getSdkClient().interrupts.resolveByToken(token, { resumeValue });
}

/** Re-exported from the SDK so call sites can import a single name from
 *  this module without also reaching into `@openwop/openwop` for the type. */
export type InterruptInspection = InterruptByTokenInspection;

export async function inspectByToken(token: string): Promise<InterruptInspection> {
  return getSdkClient().interrupts.inspectByToken(token);
}

export interface OpenInterrupt {
  interruptId: string;
  nodeId: string;
  kind: 'approval' | 'clarification' | 'refinement' | 'cancellation';
  token: string;
  data: unknown;
  resumeSchema?: Record<string, unknown>;
  createdAt: string;
}

/** Authenticated list of open interrupts for a run — needed because the
 *  public event log no longer carries the resume token. Vendor-
 *  prefixed under /v1/host/sample/* per host-extensions.md (strong
 *  candidate for future RFC promotion). */
export async function listOpenInterrupts(runId: string): Promise<readonly OpenInterrupt[]> {
  const res = await fetch(`${config.baseUrl}/v1/host/sample/runs/${encodeURIComponent(runId)}/interrupts`, fetchOpts({
    headers: authedHeaders(),
  }));
  if (!res.ok) throw new Error(`listOpenInterrupts returned ${res.status}`);
  const body = (await res.json()) as { interrupts: OpenInterrupt[] };
  return body.interrupts;
}
