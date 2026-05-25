/**
 * Notification emitter — installs the singleton entry point used by
 * the suspend manager + executor to emit user-visible notifications
 * when action-needed events (HITL interrupt, run failure) happen.
 *
 * Pure storage wiring — mirrors `bootstrap/suspend.ts` and
 * `bootstrap/eventLog.ts`. Durable persistence is the `notifications`
 * table; this module sets the in-process emitter's backend pointer.
 */

import { setNotificationBackend } from '../notifications/emitter.js';
import type { Storage } from '../storage/storage.js';

export function ensureNotificationEmitterInstalled(storage: Storage): void {
  setNotificationBackend(storage);
}
