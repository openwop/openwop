/**
 * core.openwop.skills-bridge — node runtime
 *
 * Exports the `core.skills-bridge.convert` node handler. The pack also ships
 * the `core.openwop.skills-bridge.adapter` agent (manifest only — interpreted
 * by the host's BYOK aiProviders surface; no runtime artifact here).
 */

const PACK_TYPE_IDS = ['core.skills-bridge.convert'];

const MODEL_CLASS_ENUM = new Set([
  'reasoning', 'writing', 'coding', 'research', 'classification', 'general',
]);

const MEMORY_SHAPE_KEYS = ['scratchpad', 'conversation', 'longTerm'];

function parseFrontmatter(skillMd) {
  if (typeof skillMd !== 'string') return { frontmatter: {}, body: '' };
  const m = skillMd.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { frontmatter: {}, body: skillMd };
  const yaml = m[1];
  const body = m[2] ?? '';
  // Minimal YAML parser — supports top-level scalars + nested objects + arrays of strings.
  const frontmatter = {};
  const lines = yaml.split(/\r?\n/);
  let i = 0;
  const parseScalar = (s) => {
    const t = s.trim();
    if (t === 'true') return true;
    if (t === 'false') return false;
    if (t === 'null') return null;
    if (/^-?\d+$/.test(t)) return Number(t);
    if (/^-?\d+\.\d+$/.test(t)) return Number(t);
    return t.replace(/^['"]|['"]$/g, '');
  };
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) { i++; continue; }
    const topMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/);
    if (!topMatch) { i++; continue; }
    const key = topMatch[1];
    const rest = topMatch[2];
    if (rest.length > 0) {
      frontmatter[key] = parseScalar(rest);
      i++;
      continue;
    }
    const child = {};
    const arr = [];
    i++;
    while (i < lines.length) {
      const cl = lines[i];
      if (/^\S/.test(cl)) break;
      const itemMatch = cl.match(/^\s+-\s+(.+)$/);
      const subMatch = cl.match(/^\s+([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/);
      if (itemMatch) { arr.push(parseScalar(itemMatch[1])); i++; continue; }
      if (subMatch) { child[subMatch[1]] = parseScalar(subMatch[2]); i++; continue; }
      i++;
    }
    if (arr.length > 0) frontmatter[key] = arr;
    else frontmatter[key] = child;
  }
  return { frontmatter, body };
}

function deriveAgentId(packPrefix, name) {
  const slug = String(name || 'imported-skill')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${packPrefix}.${slug}`;
}

function mapToolAllowlist(tools) {
  if (!Array.isArray(tools)) return [];
  return tools.map((t) => {
    if (typeof t !== 'string') return null;
    if (t.includes(':')) return t;
    if (t.startsWith('mcp.') || t.startsWith('mcp_')) return `mcp:${t}`;
    if (t.startsWith('openwop.') || t.startsWith('core.')) return `openwop:${t}`;
    return `mcp:${t}`;
  }).filter((s) => s !== null);
}

function mapMemoryShape(mem) {
  const out = { scratchpad: false, conversation: false, longTerm: false };
  if (!mem || typeof mem !== 'object') return out;
  for (const k of MEMORY_SHAPE_KEYS) {
    if (typeof mem[k] === 'boolean') out[k] = mem[k];
  }
  return out;
}

function mapModelClass(cls) {
  if (typeof cls === 'string' && MODEL_CLASS_ENUM.has(cls)) return cls;
  return 'general';
}

export function convertSkillMd(skillMd, opts = {}) {
  const { frontmatter, body } = parseFrontmatter(skillMd);
  const packPrefix = opts.packPrefix || 'core.openwop.skills-bridge.imported';
  const warnings = [];
  if (Array.isArray(frontmatter.scripts) && frontmatter.scripts.length > 0) {
    warnings.push('skill ships executable scripts; bridge surfaces declared interface only — host must wire script execution');
  }
  if (typeof body === 'string' && /claude\.skills\.|openai\.skills\./.test(body)) {
    warnings.push('skill body references vendor-specific runtime APIs; behavior may not translate cleanly');
  }
  const manifest = {
    agentId: deriveAgentId(packPrefix, frontmatter.name),
    persona: String(frontmatter.name || 'Imported Skill'),
    description: String(frontmatter.description || ''),
    modelClass: mapModelClass(frontmatter.metadata?.modelClass),
    systemPrompt: typeof body === 'string' && body.trim().length > 0 ? body.trim() : '(no prompt body in source skill)',
    toolAllowlist: mapToolAllowlist(frontmatter.allowed_tools),
    memoryShape: mapMemoryShape(frontmatter.metadata?.memory),
    confidence: { defaultThreshold: 0.7 },
  };
  return { manifest, warnings };
}

// Minimal self-validation of converter output against agent-manifest.schema.json.
// Avoids a runtime Ajv dependency by inlining the structural invariants that
// agent-manifest.schema.json enforces. Matches the spec schema's `required` +
// `oneOf [systemPrompt XOR systemPromptRef]` + enum constraints. Keep this in
// sync with schemas/agent-manifest.schema.json — drift caught by precheck.
const MODEL_CLASS_VALUES = new Set(['reasoning', 'writing', 'coding', 'research', 'classification', 'general']);
const AGENT_ID_PATTERN = /^(core|vendor|community|private|local)\.[a-z][a-z0-9_-]*(\.[a-z][a-zA-Z0-9_-]*)+$/;

function validateAgainstManifestSchema(m) {
  const errs = [];
  if (!m || typeof m !== 'object') { errs.push('manifest must be an object'); return errs; }
  if (typeof m.agentId !== 'string' || !AGENT_ID_PATTERN.test(m.agentId)) {
    errs.push(`agentId "${m.agentId}" violates agent-manifest.schema.json pattern`);
  }
  if (typeof m.persona !== 'string' || m.persona.length === 0 || m.persona.length > 200) {
    errs.push('persona must be a non-empty string ≤200 chars');
  }
  if (!MODEL_CLASS_VALUES.has(m.modelClass)) {
    errs.push(`modelClass "${m.modelClass}" not in spec-canonical enum`);
  }
  const hasInline = typeof m.systemPrompt === 'string' && m.systemPrompt.length > 0;
  const hasRef = typeof m.systemPromptRef === 'string' && m.systemPromptRef.length > 0;
  if (hasInline === hasRef) {
    errs.push('exactly one of systemPrompt OR systemPromptRef is required (oneOf in agent-manifest.schema.json)');
  }
  if (m.toolAllowlist != null && !Array.isArray(m.toolAllowlist)) {
    errs.push('toolAllowlist must be an array when present');
  }
  return errs;
}

export const nodeHandlers = {
  'core.skills-bridge.convert': async (input, _ctx) => {
    const skillMd = input?.skillMd;
    const packPrefix = input?.packPrefix;
    if (typeof skillMd !== 'string' || skillMd.length === 0) {
      return { agentManifest: null, warnings: ['input.skillMd is required and must be a non-empty string'] };
    }
    const { manifest, warnings } = convertSkillMd(skillMd, { packPrefix });
    const schemaErrors = validateAgainstManifestSchema(manifest);
    if (schemaErrors.length > 0) {
      return {
        agentManifest: null,
        warnings: [
          ...warnings,
          ...schemaErrors.map((e) => `agent-manifest.schema.json violation: ${e}`),
          'converter output suppressed because it failed self-validation against agent-manifest.schema.json',
        ],
      };
    }
    return { agentManifest: manifest, warnings };
  },
};

export function getPackTypeIds() {
  return [...PACK_TYPE_IDS];
}

export default { nodeHandlers, convertSkillMd, getPackTypeIds };
