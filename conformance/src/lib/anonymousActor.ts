/**
 * Shared helpers for the RFC 0132 anonymous-actor conformance scenarios.
 *
 * Reads the `capabilities.anonymousActor` discovery family at the document
 * ROOT (RFC 0073) and drives the reference-host public-surface seam the
 * behavioral scenarios probe. Lives in lib/ (not a *.test.ts) so the
 * scenarios import it via `../lib/anonymousActor.js`.
 *
 * The seam is a HOST-EXTENSION sample surface (`/v1/host/sample/anon-surface/…`)
 * — NOT a normative protocol endpoint. RFC 0132 pins the wire-observable
 * contract (the capability advert, `owner.principalKind`, the default-deny
 * grant, the audit reuse of `authorization.decided`); the surface→tool
 * binding + the seam route are host-owned config. The behavioral scenarios
 * soft-skip when the seam is unwired (404), so a host that has not yet landed
 * tool-enabled public dispatch stays green.
 *
 * @see spec/v1/capabilities.md §"anonymousActor"
 * @see RFCS/0132-anonymous-actor-authorization.md
 */
import { driver } from './driver.js';
import { readCapabilityFamily } from './discovery-capabilities.js';

export interface AnonymousActorCap {
  supported?: boolean;
  tiers?: string[];
  writeEgressControls?: string[];
  failClosed?: boolean;
}

/** The reference-host sample public-surface seam (host-extension, not normative). */
export const ANON_SEAM = '/v1/host/sample/anon-surface';
/** A sample public surface id the seam resolves to a tenant + explicit grant. */
export const ANON_SURFACE = 'sample-public-widget';

/** Reads `capabilities.anonymousActor` from discovery root; null when unadvertised. */
export async function readAnonymousActorCap(): Promise<AnonymousActorCap | null> {
  const fam = await readCapabilityFamily<AnonymousActorCap>('anonymousActor');
  return fam && typeof fam === 'object' ? fam : null;
}

/** True when the host advertises the anonymous-actor family. */
export async function isAnonymousActorAdvertised(): Promise<boolean> {
  const cap = await readAnonymousActorCap();
  return cap?.supported === true;
}

/** The body the reference seam returns for a single anon tool dispatch. */
export interface AnonDispatchBody {
  authorizationDecided?: {
    event?: string;
    payload?: {
      principal?: string;
      action?: string;
      resource?: string;
      allowed?: boolean;
      reason?: string;
    };
  };
  owner?: { tenant?: string; principal?: string; principalKind?: string };
  egressDecided?: { decision?: string; reason?: string; credentialAttached?: boolean };
  interrupt?: { kind?: string };
  result?: unknown;
  raw?: string;
}

export interface AnonDispatchResult {
  status: number;
  json: AnonDispatchBody | undefined;
}

/**
 * Drive one anonymous-actor tool dispatch against the reference seam.
 * `surface` binds the tenant + explicit grant; `tool` is the tool the anon
 * session attempts. Returns the raw status so callers can soft-skip on 404
 * (seam unwired).
 */
export async function anonDispatch(body: {
  surface?: string;
  tool: string;
  args?: Record<string, unknown>;
  destination?: string;
}): Promise<AnonDispatchResult> {
  const res = await driver.post(`${ANON_SEAM}/dispatch`, {
    surface: body.surface ?? ANON_SURFACE,
    tool: body.tool,
    ...(body.args ? { args: body.args } : {}),
    ...(body.destination ? { destination: body.destination } : {}),
  });
  return { status: res.status, json: res.json as AnonDispatchBody | undefined };
}

/** Read the RFC 0078 tool catalog scoped to an anon session on `surface`. */
export async function anonToolCatalog(
  surface: string = ANON_SURFACE,
): Promise<{ status: number; tools: Array<{ name?: string }> }> {
  const res = await driver.get(`${ANON_SEAM}/tools?surface=${encodeURIComponent(surface)}`);
  const body = res.json as { tools?: Array<{ name?: string }> } | undefined;
  return { status: res.status, tools: Array.isArray(body?.tools) ? body!.tools! : [] };
}
