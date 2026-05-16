/**
 * Thin wrapper around the BE's /v1/byok/secrets routes.
 */

import { config } from '../../client/config.js';

const baseHeaders = (): HeadersInit => ({
  'content-type': 'application/json',
  authorization: `Bearer ${config.apiKey}`,
});

export async function listStoredRefs(): Promise<readonly string[]> {
  const res = await fetch(`${config.baseUrl}/v1/byok/secrets`, { headers: baseHeaders() });
  if (!res.ok) throw new Error(`listStoredRefs returned ${res.status}`);
  const body = (await res.json()) as { credentialRefs: string[] };
  return body.credentialRefs;
}

export async function storeKey(credentialRef: string, value: string): Promise<{ credentialRef: string; masked: string }> {
  const res = await fetch(`${config.baseUrl}/v1/byok/secrets`, {
    method: 'POST',
    headers: baseHeaders(),
    body: JSON.stringify({ credentialRef, value }),
  });
  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      detail = `${body.error}: ${body.message}`;
    } catch {
      detail = res.statusText;
    }
    throw new Error(`storeKey failed: ${detail}`);
  }
  return res.json();
}

export async function deleteKey(credentialRef: string): Promise<void> {
  const res = await fetch(`${config.baseUrl}/v1/byok/secrets/${encodeURIComponent(credentialRef)}`, {
    method: 'DELETE',
    headers: baseHeaders(),
  });
  if (!res.ok) throw new Error(`deleteKey returned ${res.status}`);
}
