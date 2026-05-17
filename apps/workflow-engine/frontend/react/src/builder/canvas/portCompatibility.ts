/**
 * Port-type compatibility, ported from myndhyve's PortCompatibility.ts.
 *
 *   - 'any' on either side ⇒ allowed
 *   - exact match ⇒ allowed
 *   - object accepts array (forward-compat; we don't model 'array' in v1
 *     but keep the rule for symmetry)
 *   - string accepts number | boolean (coercible)
 *   - otherwise refused
 */

import type { PortType } from '../schema/workflow.js';

export function isPortCompatible(source: PortType | undefined, target: PortType | undefined): boolean {
  const src = source ?? 'any';
  const tgt = target ?? 'any';
  if (src === 'any' || tgt === 'any') return true;
  if (src === tgt) return true;
  if (tgt === 'string' && (src === 'number' || src === 'boolean')) return true;
  return false;
}
