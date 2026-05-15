/**
 * Interrupt-resolution client. Wraps the OpenwopClient surface +
 * provides a token-inspect convenience used by deep-link UIs.
 */

import { getSdkClient } from './runsClient.js';
import { config } from './config.js';

export async function resolveByRun(runId: string, nodeId: string, resumeValue: unknown): Promise<void> {
  await getSdkClient().interrupts.resolveByRun(runId, nodeId, { resumeValue });
}

export async function resolveByToken(token: string, resumeValue: unknown): Promise<void> {
  await getSdkClient().interrupts.resolveByToken(token, { resumeValue });
}

export interface InterruptInspection {
  kind: 'approval' | 'clarification' | 'refinement' | 'cancellation' | 'external-event' | 'custom';
  key: string;
  resumeSchema?: Record<string, unknown>;
  data: unknown;
  resolved: boolean;
}

export async function inspectByToken(token: string): Promise<InterruptInspection> {
  const res = await fetch(`${config.baseUrl}/v1/interrupts/${encodeURIComponent(token)}`);
  if (!res.ok) throw new Error(`inspect returned ${res.status}`);
  return res.json();
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
 *  public event log no longer carries the resume token. */
export async function listOpenInterrupts(runId: string): Promise<readonly OpenInterrupt[]> {
  const res = await fetch(`${config.baseUrl}/v1/runs/${encodeURIComponent(runId)}/interrupts`, {
    headers: { authorization: `Bearer ${config.apiKey}` },
  });
  if (!res.ok) throw new Error(`listOpenInterrupts returned ${res.status}`);
  const body = (await res.json()) as { interrupts: OpenInterrupt[] };
  return body.interrupts;
}
