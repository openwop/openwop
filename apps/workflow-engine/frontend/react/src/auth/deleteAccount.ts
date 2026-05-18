/**
 * Account hard-delete helper (P3.6.5 client side).
 *
 * Two-step flow:
 *   1. DELETE /v1/host/sample/account — wipes backend rows + KMS-
 *      wrapped DEKs for the signed-in tenant. Returns row counts.
 *   2. Firebase user.delete() — revokes the IdP record so the same
 *      user can't re-authenticate. Must be called while the bearer
 *      is still fresh (within ~5 min of last sign-in) — Firebase
 *      requires "recent login" for destructive operations.
 *
 * If (2) fails with `auth/requires-recent-login`, the caller can ask
 * the user to sign in again and re-trigger only the Firebase step
 * (backend data is already gone).
 */

import { config, authedHeaders, fetchOpts } from '../client/config.js';
import { getCurrentUser } from './firebase.js';
import { getAuth } from 'firebase/auth';

export interface DeleteAccountResult {
  deleted: true;
  runs: number;
  events: number;
  interrupts: number;
  workflows: number;
  secrets: number;
}

export class RequiresRecentLoginError extends Error {
  constructor() {
    super('Firebase requires a recent sign-in to delete the account. Please sign out and back in.');
    this.name = 'RequiresRecentLoginError';
  }
}

export async function deleteAccount(): Promise<DeleteAccountResult> {
  // Step 1: backend hard-delete.
  const res = await fetch(
    `${config.baseUrl}/v1/host/sample/account`,
    fetchOpts({
      method: 'DELETE',
      headers: authedHeaders({ accept: 'application/json' }),
    }),
  );
  if (!res.ok) {
    throw new Error(`account delete failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as DeleteAccountResult;

  // Step 2: Firebase user revocation.
  const user = getCurrentUser();
  if (user) {
    try {
      const fbUser = getAuth().currentUser;
      if (fbUser) await fbUser.delete();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('requires-recent-login')) {
        throw new RequiresRecentLoginError();
      }
      throw err;
    }
  }

  return body;
}
