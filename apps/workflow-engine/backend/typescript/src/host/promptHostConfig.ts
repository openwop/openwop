/**
 * Single source of truth for the reference workflow-engine sample's
 * `capabilities.prompts.*` advertisement. Both `routes/discovery.ts`
 * (advertisement) and `bootstrap/nodes.ts` (dispatch-time compose +
 * resolve calls) MUST read from this module so a deployer who
 * tightens one side can't accidentally leave the other on the
 * looser default.
 *
 * Mirrors the shape of the `capabilities.prompts` block in
 * `schemas/capabilities.schema.json`. Production hosts override these
 * via env or a deployment-config layer.
 */

import type { PromptKind } from './promptResolve.js';

export interface PromptsHostConfig {
  readonly supported: boolean;
  readonly endpointsSupported: boolean;
  readonly mutableLibrary: boolean;
  readonly agentBindings: boolean;
  readonly templateKinds: readonly PromptKind[];
  readonly variableSources: readonly ('input' | 'variable' | 'secret' | 'context')[];
  readonly maxTemplateBytes: number;
  /** Observability posture for `prompt.composed` event emission.
   *  - `"full"`: composed body + variable hashes in payload.
   *  - `"hashed"`: composed-body sha256 only; no body or bindings.
   *  - `"off"`: no `prompt.composed` emission at all. */
  readonly observability: 'off' | 'hashed' | 'full';
}

const SAMPLE_CONFIG: PromptsHostConfig = {
  supported: true,
  endpointsSupported: true,
  mutableLibrary: true,
  agentBindings: true,
  templateKinds: ['system', 'user', 'few-shot', 'schema-hint'],
  variableSources: ['input', 'variable', 'secret', 'context'],
  maxTemplateBytes: 65536,
  observability: 'full',
};

export function getPromptsHostConfig(): PromptsHostConfig {
  return SAMPLE_CONFIG;
}
