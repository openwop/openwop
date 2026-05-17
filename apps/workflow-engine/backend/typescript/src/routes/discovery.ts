/**
 * /.well-known/openwop + /v1/openapi.json + Capabilities-Etag.
 *
 * Honest advertisement: only what this sample actually supports. Real
 * deployers update the capabilities block whenever they swap a stub
 * for a real implementation.
 */

import { createHash } from 'node:crypto';
import type { Express } from 'express';
import type { AppConfig } from '../index.js';
import { listCapabilities } from '../executor/runtimeCapabilities.js';
import type { Storage } from '../storage/storage.js';
import { listHostSurfaces } from '../bootstrap/hostSurfaceRegistry.js';

interface Deps {
  storage: Storage;
  config: AppConfig;
}

export function registerDiscoveryRoutes(app: Express, _deps: Deps): void {
  app.get('/.well-known/openwop', (_req, res) => {
    const advertisement = buildAdvertisement(_deps.config);
    const etag = `"${createHash('sha256').update(JSON.stringify(advertisement)).digest('hex').slice(0, 16)}"`;
    res.set('Capabilities-Etag', etag);
    res.set('Cache-Control', 'public, max-age=60');
    res.json(advertisement);
  });

  app.get('/v1/openapi.json', (_req, res) => {
    // Sample serves the published spec verbatim — points consumers at
    // the canonical openapi if they want full surface. Production hosts
    // ship a copy with their actual route subset.
    res.json({
      openapi: '3.1.0',
      info: {
        title: 'openwop-workflow-engine-sample',
        version: _deps.config.serviceVersion,
        description:
          'Sample OpenWOP host. See https://openwop.dev for the canonical OpenAPI 3.1 spec.',
      },
      paths: {
        '/v1/runs': { post: { summary: 'Create a run' } },
        '/v1/runs/{runId}': { get: { summary: 'Fetch run snapshot' } },
        '/v1/runs/{runId}/cancel': { post: { summary: 'Cancel a run' } },
        '/v1/runs/{runId}:fork': { post: { summary: 'Fork a run from a sequence' } },
        '/v1/runs/{runId}/events': { get: { summary: 'SSE event stream' } },
        '/v1/runs/{runId}/events/poll': { get: { summary: 'Poll events (long-poll alternative to SSE)' } },
        '/v1/runs/{runId}/interrupts/{nodeId}': { post: { summary: 'Resolve a node-scoped interrupt' } },
        '/v1/interrupts/{token}': { post: { summary: 'Resolve an interrupt by signed token' } },
        '/v1/webhooks': { post: { summary: 'Register a webhook subscription' } },
        '/v1/webhooks/{subscriptionId}': { delete: { summary: 'Delete a webhook subscription' } },
        '/v1/packs': { get: { summary: 'List installed packs' } },

        // ── Sample-extension routes (NOT part of the OpenWOP wire
        //    contract — vendor-prefixed per host-extensions.md) ──
        '/v1/host/sample/byok/secrets': {
          get: { summary: 'List stored BYOK credentialRefs (refs only)', tags: ['sample-extension'] },
          post: { summary: 'Store a BYOK credentialRef + value', tags: ['sample-extension'] },
        },
        '/v1/host/sample/byok/secrets/{credentialRef}': {
          delete: { summary: 'Remove a stored BYOK secret', tags: ['sample-extension'] },
        },
        '/v1/host/sample/runs/{runId}/interrupts': {
          get: { summary: 'List open interrupts for a run (authed; returns tokens)', tags: ['sample-extension'] },
        },
      },
      tags: [
        { name: 'sample-extension', description: 'Sample-only routes outside the canonical OpenWOP v1 wire contract. Vendor-prefixed under /v1/host/sample/* per spec/v1/host-extensions.md.' },
      ],
    });
  });
}

function buildAdvertisement(config: AppConfig): Record<string, unknown> {
  return {
    protocolVersion: '1.1',
    implementation: {
      name: config.serviceName,
      version: config.serviceVersion,
      vendor: 'openwop-samples',
    },
    // Per spec/v1/capabilities.md §3 — REQUIRED top-level fields.
    supportedEnvelopes: ['rest', 'sse'],
    schemaVersions: { runEvent: 1, capabilities: 1 },
    limits: {
      // Per capabilities.md §3 (CapabilityLimiter shape) — non-negative integers.
      clarificationRounds: 5,
      schemaRounds: 3,
      envelopesPerTurn: 32,
      maxNodeExecutions: 1000,
    },
    supportedTransports: ['rest', 'sse'],
    stream: { modes: ['values', 'updates', 'messages', 'debug'] },
    capabilities: {
      auth: { profiles: [] },
      secrets: {
        supported: true,
        scopes: ['tenant', 'user', 'run'],
        resolution: 'host-managed',
      },
      // Spec-shaped per `spec/v1/capabilities.md:126-163` + `host-capabilities.md §host.aiProviders`.
      // Sample host wires three providers via raw fetch (see
      // `providers/dispatch.ts`); each requires BYOK. Tool-calling is
      // Anthropic-only for v1 (the only provider with a wired
      // tool_use loop in `providers/dispatchAnthropicTools.ts`).
      // Embeddings + image/video generation are NOT implemented — honestly
      // advertised so packs that depend on those sub-caps don't load.
      aiProviders: {
        supported: ['anthropic', 'openai', 'google'],
        byok: ['anthropic', 'openai', 'google'],
        policies: {
          modes: ['disabled', 'optional', 'required', 'restricted'],
          scopes: ['workspace', 'project', 'canvas-type'],
          errorCode: 'provider_policy_denied',
        },
        toolCalling: { supported: true, providers: ['anthropic'] },
        embeddings: { supported: false },
        imageGeneration: { supported: false },
        videoGeneration: { supported: false },
      },
      interrupts: {
        supported: true,
        kinds: ['approval', 'clarification', 'refinement', 'cancellation'],
      },
      // Sample stubs fork: the route accepts the request and copies
      // events 0..fromSeq, but doesn't reconstruct the executor's
      // resume position. Honest advertisement: not yet supported.
      replay: { supported: false, fork: false },
      agents: { supported: false },
      memory: { supported: false },
      webhooks: { supported: true, signed: true, durable: false },
      observability: { otel: { namespace: 'openwop' } },
      runtimeCapabilities: listCapabilities(),
      // Host surface registry — what `ctx.*` surfaces this host wires.
      // The catalog endpoint cross-references this to mark each node
      // as runnable-here or "needs host.X".
      hostSurfaces: listHostSurfaces(),
    },
    extensions: {
      // Sample-namespace extensions block. Clients tolerate absence.
      'sample.notes': 'This is the openwop reference application sample. Not production-hardened.',
    },
  };
}
