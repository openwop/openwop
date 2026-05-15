/**
 * Thin run-lifecycle client. Wraps `OpenwopClient` from
 * `@openwop/openwop` for the surfaces the sample UI needs.
 *
 * If these wrappers prove broadly useful, promote them to a published
 * `@openwop/openwop-browser` package per the analysis plan §6.1.
 */

import { OpenwopClient } from '@openwop/openwop';
import type {
  Capabilities,
  CreateRunRequest,
  CreateRunResponse,
  ForkRunRequest,
  ForkRunResponse,
  PollEventsResponse,
  RunSnapshot,
} from '@openwop/openwop';
import { config } from './config.js';

const client = new OpenwopClient({ baseUrl: config.baseUrl, apiKey: config.apiKey });

export interface RunListItem {
  runId: string;
  workflowId: string;
  status: string;
  startedAt?: string;
  completedAt?: string;
}

export async function getCapabilities(): Promise<Capabilities & Record<string, unknown>> {
  return (await client.discovery.capabilities()) as Capabilities & Record<string, unknown>;
}

export async function createRun(req: CreateRunRequest): Promise<CreateRunResponse> {
  return client.runs.create(req);
}

export async function getRun(runId: string): Promise<RunSnapshot> {
  return client.runs.get(runId);
}

export async function cancelRun(runId: string, reason?: string): Promise<void> {
  await client.runs.cancel(runId, reason ? { reason } : {});
}

export async function forkRun(runId: string, req: ForkRunRequest): Promise<ForkRunResponse> {
  return client.runs.fork(runId, req);
}

export async function pollEvents(runId: string, lastSequence = 0): Promise<PollEventsResponse> {
  return client.runs.pollEvents(runId, { lastSequence });
}

/** Returns the underlying SDK client for surfaces not yet wrapped here. */
export function getSdkClient(): OpenwopClient {
  return client;
}
