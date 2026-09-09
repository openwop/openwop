/**
 * openwop.codemod.pack-manifest-v2 — RFC 0177 rows C10.1 (publicKeyRef → keyId),
 * C10.6 (peer-dependency identifiers → declaration-file keys via the alias
 * table), C10.7 (signing.method → signing.scheme: ed25519-canonical-json) and
 * C10.8 (kind required; absent ≡ node). Runs on a registry version manifest
 * or a pack manifest. It changes bytes under a detached signature, so the
 * output MUST be re-signed by the registry (registry/v2/), never copied.
 *
 * Refusals (the codemod never guesses):
 *   - keyId and publicKeyRef both present and different;
 *   - signing.method `ed25519` (a signature over tarball bytes, not pack.json)
 *     or `sigstore` — those need a re-sign, not a relabel;
 *   - engines.openwop with no v2-satisfiable range (no upper bound, or an
 *     upper bound ≤ 2.0.0): the author declares compatibility (RFC 0177 §A.1);
 *   - a peer-dependency key that is neither a declaration-file key nor an
 *     alias-table row (would be pack_peer_dependency_undefined on a v2 host).
 *
 * The alias table below is the seven rows the RFC 0177 inventory guarantees;
 * the generated spec/v2/peer-dependency-aliases.json replaces it in Phase 3.
 */
export const id = 'openwop.codemod.pack-manifest-v2';
export const inputSchema = 'schemas/registry-version-manifest.schema.json';

const ALIASES = {
  'host.fs': { family: 'fs' },
  'host.queueBus': { family: 'queueBus' },
  'openwop.agents.memoryBackends': { family: 'agents', facets: ['memoryBackends'] },
  'host.workspace': { family: 'workspace' },
  'host.aiEnvelope.await': { family: 'aiEnvelope', facets: ['await'] },
  'aiProviders.imageGeneration': { family: 'aiProviders', facets: ['imageGeneration'] },
  'aiProviders.videoGeneration': { family: 'aiProviders', facets: ['videoGeneration'] },
};
// A conservative declaration-key grammar for the dry run: one or two dotted
// segments where the first is not a reserved prefix. The real check is
// check-declaration.mjs against spec/v2/declaration.json (RFC 0169 §B.2).
const KEY = /^(?!host\.|openwop\.)[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)?$/;
const RANGE = /^>=\s*(\d+)(?:\.\d+){0,2}\s+<\s*(\d+)\.0\.0$/;

function refuse(msg) { throw new Error(`${id}: ${msg}; refusing`); }

export function transform(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new TypeError(`${id}: input must be a manifest object`);
  const out = { ...doc };

  // C10.8 kind required
  if (!('kind' in out)) out.kind = 'node';

  // C10.4 the ceiling: the author declares; the codemod only checks
  const range = out.engines?.openwop;
  if (typeof range !== 'string') refuse('`engines.openwop` is missing');
  const m = RANGE.exec(range.trim());
  if (!m) refuse(`\`engines.openwop\` "${range}" has no explicit upper bound or is not \`>=x[.y[.z]] <M.0.0\``);
  if (Number(m[2]) <= 2) refuse(`\`engines.openwop\` "${range}" does not admit protocol major 2 — the author must declare v2 compatibility`);

  // C10.1 + C10.7 signing
  if (out.signing && typeof out.signing === 'object') {
    const s = { ...out.signing };
    if ('publicKeyRef' in s) {
      if ('keyId' in s && s.keyId !== s.publicKeyRef) refuse('`signing.keyId` and `signing.publicKeyRef` disagree');
      s.keyId = s.publicKeyRef; delete s.publicKeyRef;
    }
    if ('method' in s) {
      if (s.method === 'ed25519') refuse('`signing.method: ed25519` signs tarball bytes — re-sign under `ed25519-canonical-json`');
      if (s.method === 'sigstore') refuse('`signing.method: sigstore` has no v2 scheme — re-sign');
      if (s.method !== 'manual') refuse(`unknown \`signing.method\` "${s.method}"`);
      delete s.method; s.scheme = 'ed25519-canonical-json';
    } else if (s.scheme !== 'ed25519-canonical-json') {
      refuse('`signing` names neither `method` nor the v2 `scheme`');
    }
    out.signing = s;
  }

  // C10.6 peer-dependency identifiers
  if (out.peerDependencies && typeof out.peerDependencies === 'object') {
    const peers = {}; const meta = { ...(out.peerDependenciesMeta ?? {}) };
    for (const [k, v] of Object.entries(out.peerDependencies)) {
      const a = ALIASES[k];
      if (a) {
        peers[a.family] = peers[a.family] ?? v;
        if (a.facets) meta[a.family] = { ...(meta[a.family] ?? {}), facets: [...new Set([...(meta[a.family]?.facets ?? []), ...a.facets])] };
        if (k in meta) { const { [k]: old, ...rest } = meta; Object.assign(meta, rest); meta[a.family] = { ...old, ...(meta[a.family] ?? {}) }; delete meta[k]; }
      } else if (KEY.test(k)) {
        peers[k] = v;
      } else {
        refuse(`peer dependency "${k}" is neither a declaration-file key nor an alias-table row`);
      }
    }
    out.peerDependencies = peers;
    if (Object.keys(meta).length) out.peerDependenciesMeta = meta;
  }
  return out;
}
