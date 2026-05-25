/**
 * JSON-Schema 2020-12 → ConfigField[] mapping.
 *
 * Pure utility (no React, no fetch) extracted from `catalogRegistry.ts`
 * so it can be unit-tested without spinning up the catalog store.
 * `catalogRegistry.ts` re-exports it; existing call sites are
 * unchanged. The test surface lives in
 * `__tests__/configFieldsFromSchema.test.ts` (vitest-style;
 * runnable as soon as a frontend test runner is wired).
 *
 * Inference rules (one ConfigField per top-level property):
 *
 *   - boolean                                → checkbox
 *   - number / integer                       → number input (forwards
 *                                              `minimum` / `maximum` /
 *                                              `multipleOf` to HTML5 attrs)
 *   - `enum` (scalar)                        → select
 *   - `array` of `items: { type: 'string' }` → string-list (one-per-line
 *                                              textarea); forwards `maxItems`
 *                                              + `items.pattern`
 *   - object / other array                   → JSON textarea (carries the
 *                                              `default` through unchanged
 *                                              so the renderer can pretty-print)
 *   - everything else                        → text input (forwards
 *                                              `minLength` / `maxLength` /
 *                                              `pattern` to HTML5 attrs)
 *
 * Validation hints (`min` / `max` / `step` / `minLength` / `maxLength` /
 * `pattern` / `maxItems`) are advisory UX — the host MUST still validate
 * the persisted workflow against the authoritative pack manifest schema.
 * Required fields surface via `field.required` so the inspector can
 * decorate them (red asterisk + `required` attribute on the input).
 */

import type { ConfigField } from './nodeCatalog.js';

export function configFieldsFromSchema(schema: unknown): ConfigField[] {
  if (!schema || typeof schema !== 'object') return [];
  const s = schema as Record<string, unknown>;
  const props = s.properties as Record<string, unknown> | undefined;
  if (!props) return [];
  const required = new Set<string>(Array.isArray(s.required) ? (s.required as string[]) : []);
  const fields: ConfigField[] = [];
  for (const [key, raw] of Object.entries(props)) {
    if (!raw || typeof raw !== 'object') continue;
    const ps = raw as Record<string, unknown>;
    const type = Array.isArray(ps.type) ? (ps.type[0] as string) : (ps.type as string | undefined);
    const items = ps.items && typeof ps.items === 'object' ? (ps.items as Record<string, unknown>) : null;
    // A scalar `enum` becomes a dropdown; otherwise infer by type.
    const enumVals = Array.isArray(ps.enum)
      ? (ps.enum as unknown[]).filter((v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
      : null;
    let kind: ConfigField['kind'] = 'text';
    if (enumVals && enumVals.length > 0 && type !== 'object' && type !== 'array') kind = 'select';
    else if (type === 'boolean') kind = 'checkbox';
    else if (type === 'number' || type === 'integer') kind = 'number';
    else if (type === 'array' && items?.type === 'string') kind = 'string-list';
    else if (type === 'object' || type === 'array') kind = 'textarea';
    const labelBase = (ps.title as string | undefined) ?? key;
    const def = ps.default;
    const isScalarDefault =
      typeof def === 'string' || typeof def === 'number' || typeof def === 'boolean';
    const defaultValue: ConfigField['defaultValue'] | undefined =
      isScalarDefault
        ? (def as string | number | boolean)
        : kind === 'string-list' && Array.isArray(def) && def.every((d) => typeof d === 'string')
          ? (def as string[])
          : (kind === 'textarea' && def !== undefined)
            ? def
            : undefined;
    // Validation hints — JSON-Schema 2020-12 keyword names map to
    // HTML5 input attributes at render time in the Inspector. Only
    // carry the ones that match the chosen `kind`; an irrelevant hint
    // is omitted so the renderer doesn't have to filter.
    const numericMin = typeof ps.minimum === 'number' ? ps.minimum : undefined;
    const numericMax = typeof ps.maximum === 'number' ? ps.maximum : undefined;
    const step = typeof ps.multipleOf === 'number'
      ? ps.multipleOf
      : (type === 'integer' ? 1 : undefined);
    const minLength = typeof ps.minLength === 'number' ? ps.minLength : undefined;
    const maxLength = typeof ps.maxLength === 'number' ? ps.maxLength : undefined;
    const stringPattern = typeof ps.pattern === 'string' ? ps.pattern : undefined;
    const maxItems = typeof ps.maxItems === 'number' ? ps.maxItems : undefined;
    // For string-list, surface the items.pattern as part of the help
    // text since HTML5 doesn't have a per-line pattern attribute.
    const itemsPattern = kind === 'string-list' && items && typeof items.pattern === 'string'
      ? items.pattern
      : undefined;
    const baseDescription = typeof ps.description === 'string' ? ps.description : undefined;
    const help = itemsPattern
      ? `${baseDescription ?? ''}${baseDescription ? ' ' : ''}(each line MUST match: ${itemsPattern})`
      : baseDescription;
    fields.push({
      key,
      label: labelBase,
      kind,
      required: required.has(key),
      ...(defaultValue !== undefined ? { defaultValue } : {}),
      ...(help ? { help } : {}),
      ...(kind === 'select' && enumVals
        ? { options: enumVals.map((v) => ({ value: String(v), label: String(v) })) }
        : {}),
      ...(kind === 'number' && numericMin !== undefined ? { min: numericMin } : {}),
      ...(kind === 'number' && numericMax !== undefined ? { max: numericMax } : {}),
      ...(kind === 'number' && step !== undefined ? { step } : {}),
      ...((kind === 'text' || kind === 'textarea') && minLength !== undefined ? { minLength } : {}),
      ...((kind === 'text' || kind === 'textarea') && maxLength !== undefined ? { maxLength } : {}),
      ...(kind === 'text' && stringPattern !== undefined ? { pattern: stringPattern } : {}),
      ...(kind === 'string-list' && maxItems !== undefined ? { maxItems } : {}),
    });
  }
  return fields;
}
