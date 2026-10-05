/**
 * v2 has no `supported` flag: a family or facet record's presence is the claim
 * (`spec/v2/core/capabilities.md` §2). v1 descriptions say
 * "`capabilities.X.supported: true`"; this rewrites each to "advertises `X`".
 * The derive seed rule for schemas still marked `x-openwop-seeded-from: v1`
 * (2.45.18); the hand-edited schemas carry the same wording, swept once.
 */
const TOK = '`(?:[Cc]apabilities\\.)?([A-Za-z][\\w.]*?)\\.supported(?::\\s*true)?`';
/** v1 paths whose v2 home is a nested facet. */
const FACET = { crossHostCausation: 'multiAgent.executionModel.crossHostCausation' };
const at = (p) => FACET[p] ?? p;
const RULES = [
  [`MUST NOT be emitted unless ${TOK}`, (_, p) => `MUST NOT be emitted unless the host advertises \`${at(p)}\``],
  [`\\(when ${TOK}\\)`, (_, p) => `(when the host advertises \`${at(p)}\`)`],
  [`Required when ${TOK}`, (_, p) => `Required when the host advertises \`${at(p)}\``],
  [`Emitted only when ${TOK}`, (_, p) => `Emitted only when the host advertises \`${at(p)}\``],
  [`Requires the host to advertise ${TOK}`, (_, p) => `Requires the host to advertise \`${at(p)}\``],
  [`Requires ${TOK}`, (_, p) => `Requires the host to advertise \`${at(p)}\``],
  [`Hosts that don't advertise ${TOK}`, (_, p) => `Hosts that don't advertise \`${at(p)}\``],
  [`(?:capability-)?[Gg]ated on ${TOK}`, (m, p) => `${m.split('`')[0]}the host advertising \`${at(p)}\``],
  [`(advertis(?:e|es|ing)) ${TOK}`, (_, v, p) => `${v} \`${at(p)}\``],
  [`when ${TOK}`, (_, p) => `when the host advertises \`${at(p)}\``],
  ["\\(peerDependency `credentials: 'supported'`\\)", () => '(a `credentials` peer dependency)'],
].map(([re, fn]) => [new RegExp(re, 'g'), fn]);

export function unsupportedWording(text) {
  let s = text;
  for (const [re, fn] of RULES) s = s.replace(re, fn);
  return s;
}
