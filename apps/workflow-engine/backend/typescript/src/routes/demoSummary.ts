/**
 * CLI-friendly demo summary endpoint.
 *
 * Namespace: sample-extension under `/v1/host/sample/*`; this is not
 * part of the normative OpenWOP wire contract. It gives local tools a
 * stable, low-chatter way to understand the workflow-engine demo app
 * without scraping several unrelated endpoints.
 */

import type { Express } from 'express';
import type { AppConfig } from '../index.js';
import { listHostSurfaces } from '../bootstrap/hostSurfaceRegistry.js';
import { getNodeRegistry } from '../executor/nodeRegistry.js';
import { listLoadedConformanceFixtures } from '../host/index.js';
import { getPromptsHostConfig } from '../host/promptHostConfig.js';
import { listRegisteredWorkflows } from '../host/workflowsRegistry.js';

interface Deps {
  config: AppConfig;
}

export function registerDemoSummaryRoutes(app: Express, deps: Deps): void {
  app.get('/v1/host/sample/demo-summary', (_req, res) => {
    res.json(buildDemoSummary(deps.config));
  });
}

export function buildDemoSummary(config: AppConfig): Record<string, unknown> {
  const hostSurfaces = listHostSurfaces();
  const supportedSurfaces = hostSurfaces.filter((surface) => surface.supported);
  const nodes = getNodeRegistry().listTypeIds();
  const prompts = getPromptsHostConfig();
  const fixtures = listLoadedConformanceFixtures();
  const registeredWorkflows = listRegisteredWorkflows();

  return {
    app: {
      name: 'workflow-engine',
      serviceName: config.serviceName,
      serviceVersion: config.serviceVersion,
      storage: storageKind(config.storageDsn),
    },
    endpoints: {
      health: '/health',
      readiness: '/readiness',
      capabilities: '/.well-known/openwop',
      openapi: '/v1/openapi.json',
      nodeCatalog: '/v1/host/sample/node-catalog',
      demoSummary: '/v1/host/sample/demo-summary',
      workflows: '/v1/host/sample/workflows',
      runs: '/v1/runs',
      packs: '/v1/packs',
      prompts: '/v1/prompts',
    },
    demo: {
      nodeCatalog: {
        total: nodes.length,
        runnable: nodes.length,
      },
      workflows: {
        registered: registeredWorkflows.length,
        fixtures: fixtures.length,
      },
      hostSurfaces: {
        total: hostSurfaces.length,
        supported: supportedSurfaces.length,
        inMemory: supportedSurfaces.filter((surface) => surface.implementation === 'in-memory').length,
      },
      prompts: {
        supported: prompts.supported,
        endpointsSupported: prompts.endpointsSupported,
        mutableLibrary: prompts.mutableLibrary,
        observability: prompts.observability,
      },
    },
    recommendations: buildRecommendations({
      hostSurfaces,
      fixtures,
    }),
  };
}

function storageKind(dsn: string): string {
  const colon = dsn.indexOf(':');
  return colon === -1 ? 'unknown' : dsn.slice(0, colon);
}

function buildRecommendations(input: {
  hostSurfaces: ReturnType<typeof listHostSurfaces>;
  fixtures: readonly string[];
}): string[] {
  const recommendations: string[] = [];
  if (input.fixtures.length === 0) {
    recommendations.push('No conformance fixtures were loaded; verify the repo-relative fixture path.');
  }
  const unsupported = input.hostSurfaces.filter((surface) => !surface.supported);
  if (unsupported.length > 0) {
    recommendations.push(`${unsupported.length} host surfaces are advertised as unsupported; catalog entries that need them may be dimmed in the builder.`);
  }
  return recommendations;
}
