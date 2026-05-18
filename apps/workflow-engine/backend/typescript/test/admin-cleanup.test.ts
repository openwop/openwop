/**
 * Coverage for the P0.5 admin cleanup endpoint:
 *   - Requires admin Bearer token; 401 otherwise.
 *   - Wipes ephemeral BYOK secrets for tenants outside the window.
 *   - Keeps secrets for tenants seen within the window.
 *   - GET status endpoint reports tracked tenant count without
 *     performing cleanup.
 */

import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import express from 'express';
import http from 'node:http';
import { registerAdminRoutes, noteTenantActivity, _resetTenantActivity } from '../src/routes/admin.js';
import {
  setSecret,
  resolveSecret,
  clearAllSecrets,
} from '../src/byok/secretResolver.js';

let server: http.Server;
let port: number;
const ADMIN_TOKEN = 'a'.repeat(32);

async function startApp(): Promise<void> {
  const app = express();
  app.use(express.json());
  registerAdminRoutes(app);
  return new Promise((resolve) => {
    server = app.listen(0, () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
}

describe('P0.5 admin cleanup', () => {
  beforeEach(async () => {
    process.env.OPENWOP_BYOK_EPHEMERAL = 'true';
    process.env.OPENWOP_ADMIN_TOKEN = ADMIN_TOKEN;
    await clearAllSecrets();
    _resetTenantActivity();
    if (server) await new Promise<void>((r) => server.close(() => r()));
    await startApp();
  });

  afterAll(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()));
    process.env.OPENWOP_BYOK_EPHEMERAL = '';
    process.env.OPENWOP_ADMIN_TOKEN = '';
  });

  it('rejects requests without admin token', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/v1/host/sample/admin/cleanup`, { method: 'POST' });
    expect(r.status).toBe(401);
  });

  it('rejects requests with wrong admin token', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/v1/host/sample/admin/cleanup`, {
      method: 'POST',
      headers: { authorization: 'Bearer wrong-token' },
    });
    expect(r.status).toBe(401);
  });

  it('503 when OPENWOP_ADMIN_TOKEN is unset', async () => {
    process.env.OPENWOP_ADMIN_TOKEN = '';
    const r = await fetch(`http://127.0.0.1:${port}/v1/host/sample/admin/cleanup`, {
      method: 'POST',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(r.status).toBe(503);
    process.env.OPENWOP_ADMIN_TOKEN = ADMIN_TOKEN;
  });

  it('wipes ephemeral secrets for tenants outside the activity window', async () => {
    // Three tenants with secrets; only two are active.
    await setSecret('a', '1', { tenantId: 'anon:active' });
    await setSecret('b', '2', { tenantId: 'anon:also-active' });
    await setSecret('c', '3', { tenantId: 'anon:expired' });

    // Mark two as recently active; the third is silently dropped.
    noteTenantActivity('anon:active');
    noteTenantActivity('anon:also-active');

    const r = await fetch(`http://127.0.0.1:${port}/v1/host/sample/admin/cleanup`, {
      method: 'POST',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { wipedSecrets: number; activeTenants: number };
    expect(body.activeTenants).toBe(2);
    expect(body.wipedSecrets).toBe(1);

    // Active tenants keep their secrets.
    expect(await resolveSecret('a', { tenantId: 'anon:active' })).toBe('1');
    expect(await resolveSecret('b', { tenantId: 'anon:also-active' })).toBe('2');
    // Expired tenant's bucket is gone.
    expect(await resolveSecret('c', { tenantId: 'anon:expired' })).toBeNull();
  });

  it('GET status reports tracked tenant count without cleanup', async () => {
    await setSecret('a', '1', { tenantId: 'anon:t1' });
    noteTenantActivity('anon:t1');
    const r = await fetch(`http://127.0.0.1:${port}/v1/host/sample/admin/cleanup/status`, {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { trackedTenants: number };
    expect(body.trackedTenants).toBe(1);
    // Secret still there — status doesn't perform cleanup.
    expect(await resolveSecret('a', { tenantId: 'anon:t1' })).toBe('1');
  });
});
