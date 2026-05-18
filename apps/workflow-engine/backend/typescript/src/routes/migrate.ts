/**
 * Anon → user migration route (P3.5).
 *
 *   POST /v1/host/sample/migrate-tenant
 *
 * Called by the SPA immediately after Firebase Auth sign-in to
 * reassign every artifact owned by the visitor's anonymous session to
 * their new permanent user tenant. This is the moment "register to
 * keep your work" actually delivers — without it, signed-in users
 * would have to recreate workflows they built while anonymous.
 *
 * Auth requirements (BOTH must be present):
 *   - Bearer OIDC ID token            → identifies destination user tenant
 *   - openwop.session cookie          → identifies source anon tenant
 *
 * The global auth middleware only honors one principal per request,
 * so this handler MUST run AFTER auth (req.tenantId = user) but ALSO
 * peek at the raw cookie to discover the source anon tenant. The
 * source must start with `anon:` and must not equal the destination.
 *
 * Storage migration (transactional in Postgres, txn in sqlite):
 *   - runs.tenant_id      anon:* → user:*
 *   - workflows.tenant_id anon:* → user:*
 *
 * BYOK migration (in-memory):
 *   - Anon ephemeral secrets get re-encrypted under the user's
 *     KMS-wrapped DEK and written to `byok_tenant_secrets`. Requires
 *     KMS to be configured; if unset, secret migration is skipped
 *     with a logged warning (runs + workflows still migrate).
 *
 * After migration the response includes a Set-Cookie that expires the
 * anon cookie, so the next request the client sends carries only the
 * OIDC bearer.
 */

import type { Express, Request } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { OpenwopError } from '../types.js';
import { createLogger } from '../observability/logger.js';
import type { Storage } from '../storage/storage.js';
import {
  migrateEphemeralSecretsToTenant,
} from '../byok/secretResolver.js';
import { isKmsConfigured } from '../byok/kmsEncryption.js';

const log = createLogger('routes.migrate');

const COOKIE_NAME = 'openwop.session';

interface SessionPayload {
  sid: string;
  tenantId: string;
  tier: 'anon' | 'user';
  iat: number;
  exp: number;
}

function base64urlDecode(s: string): Buffer {
  let pad = s.replace(/-/g, '+').replace(/_/g, '/');
  while (pad.length % 4 !== 0) pad += '=';
  return Buffer.from(pad, 'base64');
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    return part.slice(eq + 1).trim();
  }
  return undefined;
}

function sessionSecret(): string {
  const s = process.env.OPENWOP_SESSION_SECRET;
  if (s && s.length >= 32) return s;
  // The auth middleware caches a dev fallback under this env key.
  return process.env._OPENWOP_DEV_SESSION_SECRET ?? '';
}

function verifyAnonSessionCookie(req: Request): SessionPayload | null {
  const raw = readCookie(req.header('cookie'), COOKIE_NAME);
  if (!raw) return null;
  const dot = raw.indexOf('.');
  if (dot <= 0 || dot === raw.length - 1) return null;
  const payloadB64 = raw.slice(0, dot);
  const sigB64 = raw.slice(dot + 1);
  const secret = sessionSecret();
  if (!secret) return null;
  const expected = createHmac('sha256', secret).update(payloadB64).digest();
  let provided: Buffer;
  try { provided = base64urlDecode(sigB64); } catch { return null; }
  if (expected.length !== provided.length) return null;
  if (!timingSafeEqual(expected, provided)) return null;
  let payload: SessionPayload;
  try { payload = JSON.parse(base64urlDecode(payloadB64).toString('utf8')) as SessionPayload; }
  catch { return null; }
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now) return null;
  return payload;
}

export function registerMigrateRoute(app: Express, deps: { storage: Storage }): void {
  app.post('/v1/host/sample/migrate-tenant', async (req, res, next) => {
    try {
      const userTenantId = req.tenantId;
      if (!userTenantId || !userTenantId.startsWith('user:')) {
        throw new OpenwopError(
          'unauthenticated',
          'Migration requires a signed-in user (OIDC Bearer token).',
          401,
        );
      }

      const anonSession = verifyAnonSessionCookie(req);
      if (!anonSession || !anonSession.tenantId.startsWith('anon:')) {
        // No anon cookie → nothing to migrate. Idempotent success.
        res.json({ migrated: false, runs: 0, workflows: 0, secrets: 0 });
        return;
      }
      const anonTenantId = anonSession.tenantId;
      if (anonTenantId === userTenantId) {
        throw new OpenwopError(
          'invalid_request',
          'Anon tenant equals user tenant — nothing to migrate.',
          400,
        );
      }

      const { runs, workflows } = await deps.storage.reassignTenant(
        anonTenantId,
        userTenantId,
      );

      let secrets = 0;
      let secretsFailed = 0;
      if (isKmsConfigured()) {
        try {
          const result = await migrateEphemeralSecretsToTenant(anonTenantId, userTenantId);
          secrets = result.migrated;
          secretsFailed = result.failed;
        } catch (err) {
          log.warn('ephemeral secret migration failed; continuing', {
            anonTenantId, userTenantId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      await deps.storage.appendAudit({
        timestamp: new Date().toISOString(),
        principalId: req.principal?.principalId,
        action: 'tenant.migrate',
        resource: userTenantId,
        outcome: 'success',
        payload: { from: anonTenantId, to: userTenantId, runs, workflows, secrets, secretsFailed },
      });

      // Expire the anon cookie so the next request carries only the
      // bearer. The bearer-only path skips cookie minting.
      res.append('Set-Cookie', `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
      res.json({ migrated: true, runs, workflows, secrets, secretsFailed });
    } catch (err) {
      next(err);
    }
  });
}
