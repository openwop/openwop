/**
 * node-module-required-capabilities-shape — RFC 0031 §B authoring conformance.
 *
 * Capability-gated on `capabilities.modelCapabilities.supported: true`.
 *
 * SHOULD-tier scenario — verifies that every NodeModule in the host's pack
 * registry whose `typeId` is in the `core.ai.*` namespace declares
 * `requiredModelCapabilities`. Treated as a soft-fail; failures are surfaced
 * as findings rather than blocking the suite. Behavioral assertions defer to
 * `it.todo()` until the reference workflow-engine exposes a pack-registry
 * introspection endpoint that enumerates installed NodeModules.
 *
 * NodeModule authors of envelope-emitting nodes SHOULD declare the capabilities
 * the node depends on so hosts can route appropriately at dispatch time. The
 * convention is forward-looking — existing v1.x packs that omit the field
 * remain conformant (the field is optional).
 *
 * @see RFCS/0031-envelope-variants-and-model-capabilities.md §B
 * @see spec/v1/node-packs.md §"Model-capability declarations on NodeModules"
 * @see schemas/node-pack-manifest.schema.json §NodeModule
 */

import { describe, it } from 'vitest';

describe('node-module-required-capabilities-shape: authoring convention (RFC 0031 §B)', () => {
  it.todo(
    'every NodeModule with typeId matching `core.ai.*` declares non-empty `requiredModelCapabilities` (SHOULD-tier)',
  );
  it.todo(
    'every declared identifier MUST match the spec-reserved set OR the `x-host-<host>-<key>` extension pattern',
  );
  it.todo(
    'NodeModule.fallbackModel.provider (when declared) MUST be in `capabilities.aiProviders.supported[]`',
  );
  it.todo(
    'a NodeModule declaring `requiredModelCapabilities` without `fallbackModel` is conformant — refusal-only (no substitution) is the default posture',
  );
});
