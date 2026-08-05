/**
 * Shared helpers for the RFC 0137 `host.forms.contentPacks` conformance scenarios.
 * Lives in lib/ so scenarios import it via `../lib/formContentPacks.js`.
 *
 * Hosts wiring form-content packs expose a documented host-extension seam:
 *
 *   POST /v1/host/sample/formcontent/instantiate
 *     body: { templateId: string }
 *     → 2xx {
 *         formId?: string,
 *         fields?: Array<{
 *           id?: string,
 *           control?: string,      // the control kind the host chose for this field
 *           declaredType?: string, // the wire `fields[].type` the template declared
 *           editable?: boolean,    // the instantiating user may rename/remove it
 *           locked?: boolean,      // inverse spelling some hosts prefer
 *         }>,
 *         viaCreatePath?: boolean, // instantiation went through the host's NORMAL form-create path
 *         routing?: unknown,       // MUST be absent/empty — a template cannot bind a destination
 *         refused?: boolean,       // the host refused the template outright
 *       }
 *
 * A 404/405 means the host hasn't wired the seam → soft-skip. Every leg in the
 * scenario is additionally gated on the `host.forms.contentPacks` advertisement,
 * so a host that does not implement RFC 0137 skips cleanly and stays v1-compliant.
 *
 * @see spec/v1/form-content-packs.md §"Instantiation", §"No submission routing"
 * @see spec/v1/host-capabilities.md §host.forms
 */
import { driver } from './driver.js';

interface DiscoveryDoc {
  capabilities?: Record<string, unknown>;
  [k: string]: unknown;
}

/** A field as reported by the instantiation seam. */
export interface SeamField {
  id?: string;
  control?: string;
  declaredType?: string;
  editable?: boolean;
  locked?: boolean;
}

export interface InstantiateResult {
  status: number;
  json: Record<string, unknown>;
  fields: SeamField[];
}

/**
 * Reads `host.forms.contentPacks` from discovery; null when unadvertised.
 * Accepts either a discrete `host.forms.contentPacks` key or a `contentPacks`
 * facet under a `host.forms` block (mirrors how `host.chat.cardPacks` is read).
 */
export async function readFormContentCap(): Promise<unknown> {
  const res = await driver.get('/.well-known/openwop');
  const doc = res.json as DiscoveryDoc | undefined;
  const caps = doc?.capabilities && typeof doc.capabilities === 'object' ? (doc.capabilities as Record<string, unknown>) : undefined;
  const direct = caps?.['host.forms.contentPacks'] ?? doc?.['host.forms.contentPacks'];
  if (direct !== undefined) return direct;
  const forms = caps?.['host.forms'] ?? doc?.['host.forms'];
  return forms && typeof forms === 'object' ? (forms as Record<string, unknown>)['contentPacks'] : null;
}

/** True when the host advertises it resolves + instantiates form-content templates. */
export function formContentSupported(cap: unknown): boolean {
  if (cap === true) return true;
  return typeof cap === 'object' && cap !== null && (cap as Record<string, unknown>)['supported'] === true;
}

/** Instantiates a registered template via the host-sample seam, or null (soft-skip) when absent. */
export async function instantiateTemplate(templateId: string): Promise<InstantiateResult | null> {
  const res = await driver.post('/v1/host/sample/formcontent/instantiate', { templateId });
  if (res.status === 404 || res.status === 405) return null;
  const json = (res.json ?? {}) as Record<string, unknown>;
  const raw = Array.isArray(json['fields']) ? (json['fields'] as unknown[]) : [];
  const fields = raw.filter((f): f is SeamField => typeof f === 'object' && f !== null);
  return { status: res.status, json, fields };
}

/** Finds a seam field by its wire `id`. */
export function fieldById(fields: SeamField[], id: string): SeamField | undefined {
  return fields.find((f) => f.id === id);
}

/**
 * A field is editable unless the host explicitly says otherwise. Accepts both
 * spellings (`editable: false` / `locked: true`); absent ⇒ treated as editable,
 * because §Instantiation #3 makes editability the default expectation and a host
 * that does not report the facet is not asserting a lock.
 */
export function isEditable(field: SeamField | undefined): boolean {
  if (!field) return false;
  if (field.locked === true) return false;
  return field.editable !== false;
}

/**
 * The set of control kinds a host may legitimately choose for a degraded
 * (unrecognized `vendor.*` / `x-`) field type. §Instantiation #2 says "plain text
 * input"; hosts spell that control differently, so accept the obvious synonyms
 * rather than pinning one host's vocabulary onto the wire.
 */
export const PLAIN_TEXT_CONTROLS: ReadonlySet<string> = new Set(['text', 'string', 'plaintext', 'plain-text', 'input', 'textbox']);
