/**
 * Stable per-process instance id, used as the owner token for dispatch leases
 * (run dispatch + webhook delivery). Distinct across instances (hostname + pid)
 * so a claimed row/run can be traced to the instance holding the lease, and so
 * a crashed instance's leases are recognizably not the current owner's.
 */
import { hostname } from 'node:os';

let cached: string | undefined;

export function getInstanceId(): string {
  if (cached === undefined) cached = `${hostname()}-${process.pid}`;
  return cached;
}
