/**
 * Suspend manager — installs a storage-backed durable suspend record so
 * a process restart between node-suspend and resume doesn't lose state.
 *
 * The actual durable persistence is the `interrupts` table in storage;
 * this module just wires the singleton entry point used by the executor.
 */

import { setSuspendBackend } from '../executor/suspendManager.js';
import type { Storage } from '../storage/storage.js';

export function ensureSuspendManagerInstalled(storage: Storage): void {
  setSuspendBackend(storage);
}
