/**
 * Shared document-root reader for `/.well-known/openwop` capability families.
 *
 * Per `spec/v1/capabilities.md` §"Document-root layout" (RFC 0073), every
 * capability family (`agents`, `secrets`, `aiProviders`, `auth`, `memory`,
 * `multiAgent`, `authorization`, …) is a property of the discovery document
 * ROOT — `capabilities.schema.json` defines no `capabilities` wrapper property.
 * Root is the normative MUST, so the suite reads the ROOT ONLY: a host that
 * serves families exclusively under a deprecated top-level `capabilities`
 * wrapper is already non-conformant, and the suite grades it as such rather
 * than tolerating the legacy shape. RFC 0073 Phase 4 dropped the
 * wrapper-fallback the accessor previously carried through the v1.x migration
 * window; the host-side mirror + the schema's `additionalProperties` tolerance
 * retire together at v2.0 (they serve laggard *clients* reading discovery, not
 * the host emission the suite grades). Standardizes the read so every helper
 * reads the same way.
 *
 * @see spec/v1/capabilities.md §"Document-root layout"
 * @see RFCS/0073-capability-document-root-layout.md
 */
import { driver } from './driver.js';

/**
 * Read one capability family from an already-fetched discovery doc at the
 * document root. Returns `undefined` when the family is not a root property —
 * a deprecated top-level `capabilities` wrapper is NOT consulted (root is the
 * RFC 0073 MUST).
 */
export function capabilityFamily<T = Record<string, unknown>>(
  doc: unknown,
  name: string,
): T | undefined {
  if (!doc || typeof doc !== 'object') return undefined;
  const root = (doc as Record<string, unknown>)[name];
  return root === undefined ? undefined : (root as T);
}

/**
 * Fetch `/.well-known/openwop` and return one capability family from the
 * document root. `undefined` when the host returns non-200 or doesn't
 * advertise the family at the root.
 */
export async function readCapabilityFamily<T = Record<string, unknown>>(
  name: string,
): Promise<T | undefined> {
  const res = await driver.get('/.well-known/openwop');
  if (res.status !== 200) return undefined;
  return capabilityFamily<T>(res.json, name);
}

/**
 * A root-first VIEW of the discovery document's capability families for
 * readers that were written against the deprecated top-level `capabilities`
 * wrapper (RFC 0073: root is the MUST; the wrapper is a v1.x-tolerated
 * mirror that retires at v2). Root families win; a family that exists only in
 * the wrapper is still visible so a legacy host does not lose coverage. Until
 * suite 1.135.0 forty-four readers consulted the wrapper ONLY, which meant a
 * root-only host — the shape RFC 0073 asks for — silently lost their legs
 * (S26, found by the second sibling host, which had to keep its wrapper as a
 * mirror because of it).
 */
export function discoveryFamilies(doc: unknown): Record<string, unknown> {
  if (!doc || typeof doc !== 'object') return {};
  const root = doc as Record<string, unknown>;
  const wrapper = root['capabilities'];
  const merged: Record<string, unknown> = {};
  if (wrapper && typeof wrapper === 'object' && !Array.isArray(wrapper)) Object.assign(merged, wrapper as Record<string, unknown>);
  for (const [k, v] of Object.entries(root)) if (k !== 'capabilities') merged[k] = v;
  return merged;
}
