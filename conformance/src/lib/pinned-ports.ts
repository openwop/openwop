/**
 * A certification run with pinned fixture ports MUST be single-worker.
 *
 * Every suite fixture reached through an operator's public front listens on a
 * pinned port (`*_PORT`), and the fixture registry that routes a nonce-pathed
 * request to the exercise that minted it (`front-mux.ts`, `scoped-receiver.ts`)
 * lives in ONE vitest worker's memory. With two workers only one can own each
 * pinned port; an exercise in the other worker is unreachable, or its traffic is
 * answered by a registry nobody reads. `cut-bundle.sh` has always passed
 * `--max-workers 1`, and `effect-receiver.ts` assumes it — but nothing enforced
 * it. Measured 2026-09-25: an openwop-app production cut run with
 * `--max-workers 2` recorded `0173.webhook-durable-delivery` and
 * `0187.bound-id-kinds.webhook-emitted` as test timeouts while the host had in
 * fact delivered; the same host passed both single-worker. A certification that
 * silently loses the host's traffic convicts the host, so the CLI refuses it.
 */

/** Every pinned-port variable a suite fixture honours. The OAuth doubles derive
 *  theirs from `<FRONT>_URL` at runtime, so they are listed rather than grepped. */
export const PINNED_PORT_ENVS = [
  'OPENWOP_WEBHOOK_RECEIVER_PORT',
  'OPENWOP_A2A_FAKE_PEER_PORT',
  'OPENWOP_MCP_FAKE_SERVER_PORT',
  'OPENWOP_OAUTH_AS_PORT',
  'OPENWOP_OAUTH_AS2_PORT',
  'OPENWOP_OAUTH_RESOURCE_PORT',
  'OPENWOP_OTEL_COLLECTOR_PORT',
  'OPENWOP_OTEL_COLLECTOR_GRPC_PORT',
] as const;

/**
 * The refusal message when a `--certify` run pins fixture ports without being
 * single-worker, or `null` when the run is acceptable. `maxWorkers` undefined is
 * vitest's default — one worker per CPU — so it is refused too.
 */
export function pinnedPortWorkerConflict(
  env: Readonly<Record<string, string | undefined>>,
  maxWorkers: number | undefined,
  certifying: boolean,
): string | null {
  if (!certifying) return null;
  const pinned = PINNED_PORT_ENVS.filter((k) => (env[k] ?? '').trim() !== '');
  if (pinned.length === 0 || maxWorkers === 1) return null;
  return `--certify with pinned fixture ports (${pinned.join(', ')}) requires --max-workers 1 (got ${maxWorkers === undefined ? "vitest's default, one per CPU" : maxWorkers}): a pinned port is owned by one worker, so an exercise in another worker cannot receive the host's traffic and its rows would convict the host of a delivery it made`;
}
