/**
 * openwop.codemod.node-pack-ui-hints — RFC 0177 row C10.2: the `x-openwop-form`
 * ui-hint sub-field `credentialProvider` (legacy alias, node-packs.md
 * §"Optional sub-fields") becomes `provider`. Walks every `nodes[].configSchema`
 * (and nested properties) of a node-pack manifest. Refuses when both spellings
 * are present with different values. Idempotent; changes signed bytes.
 */
export const id = 'openwop.codemod.node-pack-ui-hints';
export const inputSchema = 'schemas/node-pack-manifest.schema.json';

function walk(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;
  const out = { ...schema };
  if (out['x-openwop-form'] && typeof out['x-openwop-form'] === 'object') {
    const f = { ...out['x-openwop-form'] };
    if ('credentialProvider' in f) {
      if ('provider' in f && f.provider !== f.credentialProvider) throw new Error(`${id}: \`provider\` and \`credentialProvider\` disagree; refusing to choose`);
      f.provider = f.credentialProvider; delete f.credentialProvider;
    }
    out['x-openwop-form'] = f;
  }
  for (const k of ['properties', '$defs', 'definitions']) {
    if (out[k] && typeof out[k] === 'object') out[k] = Object.fromEntries(Object.entries(out[k]).map(([n, s]) => [n, walk(s)]));
  }
  for (const k of ['items', 'additionalProperties']) if (out[k] && typeof out[k] === 'object') out[k] = walk(out[k]);
  for (const k of ['oneOf', 'anyOf', 'allOf']) if (Array.isArray(out[k])) out[k] = out[k].map(walk);
  return out;
}

export function transform(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new TypeError(`${id}: input must be a node-pack manifest object`);
  if (!Array.isArray(doc.nodes)) return doc;
  return { ...doc, nodes: doc.nodes.map((n) => (n && n.configSchema ? { ...n, configSchema: walk(n.configSchema) } : n)) };
}
