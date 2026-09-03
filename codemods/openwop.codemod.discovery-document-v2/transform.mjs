/**
 * openwop.codemod.discovery-document-v2 — rewrite a v1 /.well-known/openwop
 * document toward the v2 root (RFC 0169 §A, migration rows C2.2–C2.8).
 *
 * Pure: JSON in, JSON out. What it does, in order:
 *   - C2.2 drops every dotted `host.<family>` mirror key when it equals its
 *     plain root twin; promotes a dotted-only declared family to its plain key
 *     (RFC 0144: a host following the spec's own snippet emits dotted only);
 *     refuses when the two disagree;
 *   - C2.3 rewrites the `openwop-core` alias to `openwop-discovery-core` in
 *     any string array named `profiles` (v1 hosts that emit one);
 *   - C2.4 drops `contractProvenance`;
 *   - C2.5 drops `auth.subjectLinking` (derived from the profile pair);
 *   - C2.6 drops a bare `a2a.supported` / `mcp.supported` boolean when a
 *     `protocolVersions[]` sits beside it; drops the whole family on
 *     `supported: false` (absence is the v2 claim); REFUSES `supported: true`
 *     with no versions — a codemod cannot invent them;
 *   - C2.7 rewrites `replay.fork: true` to `replay.modes` (adds `"branch"` and
 *     `"replay"` only when `modes` is absent; refuses a `fork: true` that
 *     contradicts an explicit empty `modes`);
 *   - C8.1 strips `a2a-0.3-legacy` / `mcp-2025-06-18-legacy` and their versions
 *     (refuses when `preferredVersion` IS the legacy version); C8.2 drops
 *     `supportedTransports`; C8.3 drops the `grpc` block (RFC 0175);
 *   - C2.8 moves the eleven RFC 0144 extension-class `host.*` families under
 *     `extensions.<org>.<name>`, where `<org>` comes from `implementation.vendor`
 *     (refuses when absent — a namespace cannot be guessed).
 * Leaves the `capabilities` wrapper to its own codemod. Idempotent.
 */
export const id = 'openwop.codemod.discovery-document-v2';
export const inputSchema = 'schemas/capabilities.schema.json';

const EXTENSION_FAMILIES = ['brand', 'canvas', 'chat', 'coordination', 'dataIntegration', 'entities', 'kanban', 'knowledge', 'launchStudio', 'messaging', 'webResearch'];
const sort = (v) => (Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v);
const eq = (a, b) => JSON.stringify(sort(a)) === JSON.stringify(sort(b));
const refuse = (why) => { throw new Error(`${id}: ${why}; refusing to guess — fix the host, then re-run`); };

export function transform(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new TypeError(`${id}: input must be a discovery document object`);
  const out = { ...doc };
  // C2.2 dotted mirrors
  for (const k of Object.keys(out)) {
    if (!k.startsWith('host.')) continue;
    const plain = k.slice('host.'.length);
    if (plain in out && !eq(out[plain], out[k])) refuse(`\`${k}\` disagrees with root \`${plain}\``);
    if (plain in out) { delete out[k]; continue; }
    // RFC 0144: a host following host-capabilities.md's own dotted snippet emits
    // the dotted key ONLY — promote it to the plain root key rather than refuse.
    if (!EXTENSION_FAMILIES.includes(plain)) { out[plain] = out[k]; delete out[k]; }
  }
  // C2.3 alias
  if (Array.isArray(out.profiles)) out.profiles = out.profiles.map((p) => (p === 'openwop-core' ? 'openwop-discovery-core' : p));
  // C2.4
  delete out.contractProvenance;
  // C2.5
  if (out.auth && typeof out.auth === 'object' && 'subjectLinking' in out.auth) { const { subjectLinking: _x, ...auth } = out.auth; out.auth = auth; }
  // C2.6
  for (const fam of ['a2a', 'mcp']) {
    const f = out[fam];
    if (f && typeof f === 'object' && 'supported' in f && typeof f.supported === 'boolean') {
      if (f.supported === false) { delete out[fam]; continue; } // absence is the v2 claim
      if (!Array.isArray(f.protocolVersions) || f.protocolVersions.length === 0) refuse(`\`${fam}.supported: true\` is a bare boolean with no protocolVersions[]`);
      const { supported: _s, ...rest } = f; out[fam] = rest;
    }
  }
  // C2.7
  if (out.replay && typeof out.replay === 'object' && 'fork' in out.replay) {
    const r = { ...out.replay };
    if (r.fork === true && Array.isArray(r.modes) && r.modes.length === 0) refuse('`replay.fork: true` contradicts an explicit empty `replay.modes`');
    if (r.fork === true && !Array.isArray(r.modes)) r.modes = ['branch', 'replay'];
    delete r.fork; out.replay = r;
  }
  // C8.1 legacy embedded-protocol profiles (RFC 0175 §C.1)
  for (const [fam, legacyId, legacyVersion] of [['a2a', 'a2a-0.3-legacy', '0.3'], ['mcp', 'mcp-2025-06-18-legacy', '2025-06-18']]) {
    const f = out[fam];
    if (!f || typeof f !== 'object') continue;
    const g = { ...f };
    if (Array.isArray(g.profiles) && g.profiles.includes(legacyId)) {
      if (g.preferredVersion === legacyVersion) refuse(`\`${fam}.preferredVersion\` is the legacy version ${legacyVersion}; a host that prefers the legacy era cannot be rewritten as v2`);
      g.profiles = g.profiles.filter((p) => p !== legacyId);
      if (Array.isArray(g.protocolVersions)) g.protocolVersions = g.protocolVersions.filter((v) => v !== legacyVersion);
    }
    out[fam] = g;
  }
  // C8.2 / C8.3 (RFC 0175 §B.1, §A.1)
  delete out.supportedTransports;
  delete out.grpc;
  // C2.8
  const moving = Object.keys(out).filter((k) => k.startsWith('host.') && EXTENSION_FAMILIES.includes(k.slice(5)));
  if (moving.length > 0) {
    const org = out.implementation && typeof out.implementation.vendor === 'string' && out.implementation.vendor.trim() ? out.implementation.vendor.trim().toLowerCase() : null;
    if (!org) refuse('extension-class host.* families are present but `implementation.vendor` names no org');
    const ext = { ...(out.extensions && typeof out.extensions === 'object' ? out.extensions : {}) };
    for (const k of moving) { ext[`${org}.${k.slice(5)}`] = out[k]; delete out[k]; }
    out.extensions = ext;
  }
  return out;
}
