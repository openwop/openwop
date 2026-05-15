/**
 * Event log — wires the executor's event-emit path to the storage's
 * atomic-sequence appendEvent. Single emit-point for every node-emitted
 * event in the run lifecycle.
 */

import { setEventLogBackend } from '../executor/eventLog.js';
import type { Storage } from '../storage/storage.js';

export function ensureEventLogInstalled(storage: Storage): void {
  setEventLogBackend(storage);
}
