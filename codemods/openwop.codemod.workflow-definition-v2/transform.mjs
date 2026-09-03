/**
 * openwop.codemod.workflow-definition-v2 — RFC 0177 row C10.3: the deprecated
 * `config.outputArtifactType` and `config.chatCard` bag entries on a workflow
 * definition node become the first-class `node.artifactType` and
 * `node.chatCard` (workflow-definition.schema.json already carries both typed
 * fields as the replacement). Refuses when the bag entry and the typed field
 * are both present and differ. Idempotent.
 */
export const id = 'openwop.codemod.workflow-definition-v2';
export const inputSchema = 'schemas/workflow-definition.schema.json';

const MOVES = [['outputArtifactType', 'artifactType'], ['chatCard', 'chatCard']];

export function transform(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new TypeError(`${id}: input must be a workflow definition object`);
  if (!Array.isArray(doc.nodes)) return doc;
  const nodes = doc.nodes.map((n) => {
    if (!n || typeof n !== 'object' || !n.config || typeof n.config !== 'object') return n;
    const node = { ...n }; const config = { ...n.config }; let touched = false;
    for (const [from, to] of MOVES) {
      if (!(from in config)) continue;
      if (to in node && JSON.stringify(node[to]) !== JSON.stringify(config[from])) throw new Error(`${id}: \`config.${from}\` and \`${to}\` disagree; refusing to choose`);
      node[to] = config[from]; delete config[from]; touched = true;
    }
    if (!touched) return n;
    node.config = config;
    return node;
  });
  return { ...doc, nodes };
}
