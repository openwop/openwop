/**
 * Shared root-first reader for `/.well-known/openwop` capability families.
 *
 * Per `spec/v1/capabilities.md` §"Document-root layout" (RFC 0073), every
 * capability family (`agents`, `secrets`, `aiProviders`, `auth`, `memory`,
 * `multiAgent`, `authorization`, …) is a property of the discovery document
 * ROOT — `capabilities.schema.json` defines no `capabilities` wrapper property.
 * A top-level `capabilities` object is a deprecated legacy shape; the suite
 * reads the root first and falls back to a `capabilities.*` wrapper only
 * through the v1.x migration window. Standardizes the ad-hoc dual-read that
 * already existed (e.g. `aiEnvelope.capBreached.test.ts`,
 * `ai-envelope-shape.test.ts`) into one accessor so every helper reads the
 * same way.
 *
 * @see spec/v1/capabilities.md §"Document-root layout"
 * @see RFCS/0073-capability-document-root-layout.md
 */
import { driver } from './driver.js';

/**
 * Read one capability family from an already-fetched discovery doc: document
 * root first, deprecated `capabilities.*` wrapper as a fallback. Returns
 * `undefined` when the family is advertised in neither location.
 */
export function capabilityFamily<T = Record<string, unknown>>(
  doc: unknown,
  name: string,
): T | undefined {
  if (!doc || typeof doc !== 'object') return undefined;
  const root = (doc as Record<string, unknown>)[name];
  if (root !== undefined) return root as T;
  const wrapper = (doc as { capabilities?: unknown }).capabilities;
  if (wrapper && typeof wrapper === 'object') {
    return (wrapper as Record<string, unknown>)[name] as T | undefined;
  }
  return undefined;
}

/**
 * Fetch `/.well-known/openwop` and return one capability family (root-first,
 * wrapper-fallback). `undefined` when the host returns non-200 or doesn't
 * advertise the family.
 */
export async function readCapabilityFamily<T = Record<string, unknown>>(
  name: string,
): Promise<T | undefined> {
  const res = await driver.get('/.well-known/openwop');
  if (res.status !== 200) return undefined;
  return capabilityFamily<T>(res.json, name);
}
