/**
 * `ctx.launchStudio` host surface (`host.launchStudio`,
 * `spec/v1/host-capabilities.md` §host.launchStudio) — the
 * `vendor.myndhyve.launch-studio` pack's multi-canvas studio backbone.
 *
 * A studio is a configuration record (steps + shared artifacts + brand/design/
 * PRD ids); the surface is a lookup + pure-computation context derivation. Task
 * dispatch (`dispatchStackItems`) delegates to `ctx.kanban` (already wired), so
 * launch-studio is fully real once both surfaces exist. The demo seeds one
 * studio so `getStudio` returns real data; unknown ids return null per spec.
 */

import { createLogger } from '../observability/logger.js';
import type { BundleScope } from './inMemorySurfaces.js';

const log = createLogger('host.launchStudio');

interface Studio {
  studioId: string;
  brandId?: string;
  designSystemId?: string;
  prdId?: string;
  sharedArtifactRefs: Array<{ artifactId: string; artifactTypeId: string }>;
  steps: Array<{ stepId: string; canvasTypeId: string; projectId?: string }>;
}

// Seeded demo studio so getStudio returns real data out of the box. Keyed per
// studioId; tenant-agnostic (studio config is shared reference data in the demo).
const STUDIOS = new Map<string, Studio>([
  ['demo-launch-studio', {
    studioId: 'demo-launch-studio',
    brandId: 'brand-acme',
    designSystemId: 'ds-acme-v2',
    prdId: 'prd-launch-q3',
    sharedArtifactRefs: [
      { artifactId: 'art-brand-kit', artifactTypeId: 'brand.kit' },
      { artifactId: 'art-prd', artifactTypeId: 'doc.prd' },
    ],
    steps: [
      { stepId: 'step-brief', canvasTypeId: 'canvas.brief' },
      { stepId: 'step-design', canvasTypeId: 'canvas.design' },
      { stepId: 'step-launch', canvasTypeId: 'canvas.launch' },
    ],
  }],
]);

export interface LaunchStudioSurface {
  getStudio(studioId: string): Promise<Studio | null>;
  buildProjectContext(args: { studio: Studio; userId?: string; canvasTypeId: string }): Promise<Record<string, unknown>>;
  resolveLinkedArtifacts(args: { studio: Studio; userId?: string; sourceCanvasTypeId: string }): Promise<Record<string, unknown>>;
}

export function createLaunchStudioSurface(_scope: BundleScope): LaunchStudioSurface {
  return {
    async getStudio(studioId) {
      return STUDIOS.get(studioId) ?? null;
    },

    async buildProjectContext({ studio, userId, canvasTypeId }) {
      const step = studio.steps.find((s) => s.canvasTypeId === canvasTypeId);
      log.info('launch-studio buildProjectContext', { studioId: studio.studioId, canvasTypeId });
      return {
        studioId: studio.studioId,
        canvasTypeId,
        ...(userId ? { userId } : {}),
        ...(step?.projectId ? { projectId: step.projectId } : {}),
        ...(studio.brandId ? { brandId: studio.brandId } : {}),
        ...(studio.designSystemId ? { designSystemId: studio.designSystemId } : {}),
        ...(studio.prdId ? { prdId: studio.prdId } : {}),
      };
    },

    async resolveLinkedArtifacts({ studio, sourceCanvasTypeId }) {
      // The linked artifacts inherited at this step are the studio's shared
      // refs plus any earlier-step canvases (descriptive — no run wiring).
      const priorSteps = studio.steps
        .slice(0, Math.max(0, studio.steps.findIndex((s) => s.canvasTypeId === sourceCanvasTypeId)))
        .map((s) => ({ stepId: s.stepId, canvasTypeId: s.canvasTypeId }));
      return {
        sourceCanvasTypeId,
        sharedArtifacts: studio.sharedArtifactRefs,
        inheritedSteps: priorSteps,
      };
    },
  };
}
