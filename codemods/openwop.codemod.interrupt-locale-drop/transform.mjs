/**
 * openwop.codemod.interrupt-locale-drop — RFC 0171 row C4.17: v2 closes
 * interrupt data, so the optional v1 `data.locale` on an InterruptPayload has no
 * v2 place. Drops `data.locale` from an InterruptPayload (`{ kind, key, data }`,
 * schemas/suspend-request.schema.json). Refuses a value that is not a string,
 * since that is not a v1 `locale` and the codemod will not guess. A payload
 * without `data.locale` is unchanged. Idempotent. Pure.
 */
export const id = 'openwop.codemod.interrupt-locale-drop';
export const inputSchema = 'schemas/suspend-request.schema.json';
export function transform(doc) {
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) throw new TypeError(`${id}: input must be an InterruptPayload object`);
  const data = doc.data;
  if (!data || typeof data !== 'object' || Array.isArray(data) || !('locale' in data)) return doc;
  if (typeof data.locale !== 'string') throw new Error(`${id}: data.locale is ${JSON.stringify(data.locale)}, not a BCP 47 tag; refusing to guess`);
  const { locale, ...rest } = data;
  return { ...doc, data: rest };
}
