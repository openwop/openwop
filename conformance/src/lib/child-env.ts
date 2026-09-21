/**
 * The environment handed to the vitest child the CLI spawns.
 *
 * `{ ...process.env }` handed the child EVERYTHING the operator exported,
 * including `OPENWOP_BUNDLE_SIGNING_KEY` — the PKCS8 PEM of the key that signs
 * the certification bundle. Nothing in the child reads it: the signer runs in
 * the PARENT, after the run (`cli.ts` `--certify`). It was there only because
 * nothing took it out.
 *
 * Why that is a leak and not a tidiness point. Measured by a host operator
 * during a production cut (2026-09-20): on macOS `npm exec` rewrites
 * `process.title`, and a process listing (`ps`, `pgrep -fl`) then spills into
 * the child's environ — so listing processes mid-cut printed the signing key,
 * in full, into the operator's terminal and transcript. Same-uid or root only,
 * but that is exactly who is looking at the terminal. A scenario, a reporter, a
 * vitest plugin or a crash dump in the child had the same access for no reason.
 *
 * The rule: material only the parent uses never enters the child. The key IDS
 * are not secret and stay (a scenario may legitimately name the key it expects).
 */
export const PARENT_ONLY_ENV: readonly string[] = [
  'OPENWOP_BUNDLE_SIGNING_KEY',
];

export function childEnv(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...parent };
  for (const name of PARENT_ONLY_ENV) delete env[name];
  return env;
}
