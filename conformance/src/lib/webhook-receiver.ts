/**
 * Reference webhook receiver for the conformance suite — implements
 * the verification contract per `spec/v1/webhooks.md` §"Signature
 * recipe" + §"Replay-attack resistance" so adversarial-input scenarios
 * can verify that a properly-implemented receiver rejects the
 * documented failure modes.
 *
 * Mirrors the SDK's verifyWebhookSignature helper (sdk/typescript/src/
 * webhook-helpers.ts) but inlined here so the conformance suite stays
 * dependency-free vs. the SDK. The two MUST produce identical
 * outcomes for the same inputs.
 *
 * @see spec/v1/webhooks.md §"Signature recipe"
 * @see sdk/typescript/src/webhook-helpers.ts (canonical SDK
 *      implementation; this file is a conformance-suite mirror)
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

/**
 * The `X-openwop-Signature` value prefix, per `webhooks.md` §"Delivery headers"
 * (`sha256={hex}`). Distinct from the ALGORITHM header's `v1`, which names the
 * signing scheme, not the encoding — see `verifyWebhookDelivery`.
 */
export const SIGNATURE_PREFIX = 'sha256=';

export const DEFAULT_FRESHNESS_WINDOW_SECONDS = 300;

export type WebhookRejectionReason =
  | 'signature_mismatch'
  | 'timestamp_expired'
  | 'timestamp_too_far_in_future'
  | 'malformed_signature_header'
  | 'malformed_timestamp_header'
  | 'wrong_algorithm'
  | 'duplicate_signature';

export type WebhookVerifyResult =
  | { accepted: true }
  | { accepted: false; reason: WebhookRejectionReason };

export interface WebhookReceiverState {
  /** Set of signature values the receiver has already accepted (anti-replay). */
  acceptedSignatures: Set<string>;
}

export function createReceiverState(): WebhookReceiverState {
  return { acceptedSignatures: new Set() };
}

export interface VerifyOptions {
  /** Default 5 minutes per spec. Set 0 to disable freshness check. */
  freshnessWindowSeconds?: number;
  /** Override `now` (unix seconds) for deterministic tests. */
  nowSeconds?: number;
}

/**
 * Verify a single webhook delivery against the canonical recipe.
 * Returns `{ accepted: true }` on success; `{ accepted: false, reason }`
 * otherwise. Updates `state.acceptedSignatures` on acceptance for
 * replay-attack detection on subsequent calls.
 *
 * Receivers MUST pass the **exact** request body bytes — parsed-and-
 * reserialized JSON will fail verification.
 */
export function verifyWebhookDelivery(
  secret: string,
  signatureHeader: string,
  algorithmHeader: string | undefined,
  timestampHeader: string,
  rawBody: string | Buffer,
  state: WebhookReceiverState,
  options: VerifyOptions = {},
): WebhookVerifyResult {
  // 1. Algorithm gating. Hosts MAY include an explicit
  //    X-openwop-Signature-Algorithm header; receivers MUST refuse
  //    anything other than `v1` per webhooks.md §"Signature algorithm
  //    versioning". Absence is treated as the v1 default.
  if (algorithmHeader !== undefined && algorithmHeader !== 'v1') {
    return { accepted: false, reason: 'wrong_algorithm' };
  }

  // 2. Signature header parse.
  //
  // `sha256=`, NOT `v1=` (corrected 2026-08-19). `webhooks.md` §"Delivery
  // headers" specifies `X-openwop-Signature: sha256={hex}` and its verification
  // recipe says "Strip the `sha256=` prefix". This verifier required `v1=` and
  // rejected the spec's own header as malformed — so the reference verifier a
  // subscriber implementer would copy refused every conforming delivery.
  //
  // The confusion is visible one comment above: `v1` is the value of the
  // ALGORITHM header (`X-openwop-Signature-Algorithm: v1`), a different field.
  // One value, two fields, conflated. It survived because
  // `webhook-receiver-adversarial.test.ts` signs with `signPayload` and verifies
  // with this function — a closed loop that is self-consistent and wrong, and
  // therefore green on every host. Reported by a tier-2 host that could not
  // adjudicate which of the suite's three signature shapes was canonical.
  if (!signatureHeader.startsWith(SIGNATURE_PREFIX)) {
    return { accepted: false, reason: 'malformed_signature_header' };
  }
  const providedHex = signatureHeader.slice(SIGNATURE_PREFIX.length);
  if (!/^[0-9a-f]+$/i.test(providedHex)) {
    return { accepted: false, reason: 'malformed_signature_header' };
  }

  // 3. Anti-replay: receivers MUST refuse a signature value seen
  //    before, even if the timestamp would otherwise be fresh
  //    (defense-in-depth against an attacker resending a captured
  //    delivery before the original's timestamp window expires).
  if (state.acceptedSignatures.has(signatureHeader)) {
    return { accepted: false, reason: 'duplicate_signature' };
  }

  // 4. Timestamp parse + freshness window.
  const timestamp = Number(timestampHeader);
  if (!Number.isInteger(timestamp) || timestamp <= 0) {
    return { accepted: false, reason: 'malformed_timestamp_header' };
  }
  const window = options.freshnessWindowSeconds ?? DEFAULT_FRESHNESS_WINDOW_SECONDS;
  if (window > 0) {
    const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
    const delta = now - timestamp;
    if (delta > window) return { accepted: false, reason: 'timestamp_expired' };
    if (delta < -window) return { accepted: false, reason: 'timestamp_too_far_in_future' };
  }

  // 5. HMAC recompute + constant-time compare.
  const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const expectedHex = createHmac('sha256', secret).update(`${timestamp}.${bodyStr}`, 'utf8').digest('hex');
  const providedBuf = Buffer.from(providedHex, 'hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
    return { accepted: false, reason: 'signature_mismatch' };
  }

  // 6. Accept + record for replay detection.
  state.acceptedSignatures.add(signatureHeader);
  return { accepted: true };
}

/**
 * Sign a payload the way the host would — useful for building
 * adversarial-input fixtures in scenarios.
 */
export function signPayload(
  secret: string,
  timestamp: number,
  rawBody: string | Buffer,
): { signatureHeader: string; timestampHeader: string; algorithmHeader: 'v1' } {
  const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const hex = createHmac('sha256', secret).update(`${timestamp}.${bodyStr}`, 'utf8').digest('hex');
  return {
    signatureHeader: `${SIGNATURE_PREFIX}${hex}`,
    timestampHeader: String(timestamp),
    algorithmHeader: 'v1',
  };
}

/**
 * Discover a tenant the calling bearer provably OWNS, by creating a probe run
 * and reading `owner.tenant` off its snapshot (RFC 0048; `run-snapshot.schema.json`
 * §owner — the triple is `{ tenant, workspace, principal }`, and `tenantId` was
 * never the spec name: S29, 2026-08-17, found by the second sibling host, whose
 * schema-correct `owner.tenant` this helper silently ignored). A host that scopes
 * webhook subscriptions by tenant membership (RFC 0093) 403s a `tenantId` the
 * bearer is not a member of — so a hard-coded tenant is wrong; the only portable
 * owned tenant is the one on a run the bearer just created. Returns `undefined`
 * for a single-tenant host (which omits `owner`) or when no probe
 * fixture is available — callers then omit `tenantId`, which single-tenant hosts
 * accept. (RFC 0093 / webhooks.md §Register; suite defect fixed 2026-08-09.)
 *
 * **Prefers `owner.workspace`, and that is not a fallback ordering — it is which
 * field the route actually takes.** `webhooks.md` §Register documents the body's
 * `tenantId` as *"Workspace under which the subscription lives. Caller MUST be a
 * member."*, and every example in that document passes a workspace
 * (`workspace-123`, `workspace-prod`). RFC 0048 §A defines `owner.tenant` as
 * something else entirely — the **top-level isolation boundary** — with
 * `workspace` an optional sub-tenant beneath it. The two coincide only on hosts
 * where tenant ≡ workspace, which is why reading `owner.tenant` worked
 * everywhere it had been run.
 *
 * Reported 2026-09-02 by a tier-2 host with a real workspace layer: its
 * schema-correct `owner` is `{tenant: "<instance>", workspace: "<workspaceId>",
 * principal: …}`, so this helper derived the instance label — a value **nobody
 * is a member of** — and registration 403'd by design. Registering with
 * `owner.workspace` returns 201, verified by curl on that host. The host is
 * conformant and the suite was wrong; the docblock above already stated the
 * right intent ("a tenant the calling bearer provably OWNS") while reading the
 * field that does not carry it.
 *
 * The `tenant` read is retained beneath it for hosts that emit no `workspace`.
 */
export async function discoverOwnedTenant(
  driver: { post: (p: string, b: unknown) => Promise<{ status: number; json: unknown }>; get: (p: string) => Promise<{ status: number; json: unknown }> },
  probeWorkflowId = 'conformance-noop',
): Promise<string | undefined> {
  const create = await driver.post('/v1/runs', { workflowId: probeWorkflowId });
  if (create.status !== 201) return undefined;
  const runId = (create.json as { runId?: string } | null)?.runId;
  if (typeof runId !== 'string') return undefined;
  const snap = await driver.get(`/v1/runs/${encodeURIComponent(runId)}`);
  const owner = (snap.json as { owner?: { tenant?: unknown; workspace?: unknown; tenantId?: unknown } } | null)
    ?.owner;
  // `tenantId` on POST /v1/webhooks is the WORKSPACE (webhooks.md §Register), not
  // the RFC 0048 §A `tenant` isolation boundary. Where a host distinguishes them,
  // only the workspace is a scope the bearer is a member of.
  if (typeof owner?.workspace === 'string' && owner.workspace.length > 0) return owner.workspace;
  if (typeof owner?.tenant === 'string' && owner.tenant.length > 0) return owner.tenant;
  // Pre-S29 hosts that copied the suite's misnamed field: tolerated, never asserted.
  return typeof owner?.tenantId === 'string' && owner.tenantId.length > 0 ? owner.tenantId : undefined;
}

/**
 * The public `https:` front for the conformance webhook receiver, when the operator
 * has wired one (`OPENWOP_WEBHOOK_RECEIVER_URL`).
 *
 * This does NOT point the host at some third-party endpoint. The delivery must
 * still land on the local `startReceiver()` server, because every assertion in
 * the scenario reads `receiver.received` — an IN-PROCESS array. Registering an
 * arbitrary URL would send the delivery somewhere the suite cannot observe, and
 * the row would turn green while every header and HMAC assertion went vacuous.
 * That is the precise defect this suite exists to catch, so the variable is
 * specified as "a tunnel or TLS-terminating proxy in front of THIS receiver",
 * never "an endpoint of your choosing".
 *
 * The suite cannot verify that the tunnel actually fronts this process — that
 * is the operator's contract. What it CAN do is refuse to let a mis-wired
 * tunnel look like a pass: with the variable set, zero observed deliveries is a
 * hard assertion failure, never a soft-skip (see the delivery assertion below).
 *
 * Validation is deliberately strict and fails LOUDLY rather than skipping: a
 * malformed value is an operator error, and turning it into a `blocked` row
 * would hide the misconfiguration behind a disposition that reads as
 * "the host could not be exercised".
 */
export function resolveRegistrationUrl(localUrl: string): { url: string; tunnelled: boolean } {
  return resolvePublicFront('OPENWOP_WEBHOOK_RECEIVER_URL', localUrl);
}

/**
 * The same rule, for ANY suite fixture the host under test must reach — the
 * webhook receiver, the A2A fake peer, the MCP fake server. `envName` names the
 * operator's public front for that one fixture; unset means the local address.
 *
 * Generalised in 2.33.0. Until then only the webhook receiver had a front, so a
 * host that advertised `a2a` or `mcp` could be measured ONLY with its egress
 * guard relaxed — those fakes advertised `http://127.0.0.1:<port>` and nothing
 * else — and a relaxed guard is a relaxation the bundle must declare and cannot
 * certify under (`security-defaults.md` §Relaxations). The two production hosts
 * cut relaxation-free only because they advertise neither family. The rule made
 * a host that implements MORE of the protocol LESS able to certify; found when
 * the steward's own reference host turned out to be certifying under an
 * undeclared one.
 */
export function resolvePublicFront(envName: string, localUrl: string): { url: string; tunnelled: boolean } {
  const raw = process.env[envName]?.trim();
  if (!raw) return { url: localUrl, tunnelled: false };

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(
      `${envName} is not a valid URL: ${JSON.stringify(raw)}`,
    );
  }

  // Must clear gate 1 (scheme). An `http:` front cannot satisfy a host that
  // validates scheme before address, which is the ordering that made the
  // ALLOW_PRIVATE flag insufficient in the first place.
  if (parsed.protocol !== 'https:') {
    throw new Error(
      `${envName} MUST be https: (got ${parsed.protocol}). ` +
        'A plain-http front cannot clear the scheme gate, so it cannot witness this scenario.',
    );
  }

  // Must clear gate 2 (registration-time address check). A loopback or private
  // hostname here is just the local URL wearing a different scheme — it would
  // be rejected for the same reason, and the operator would read the resulting
  // failure as a host defect rather than as their own misconfiguration.
  const host = parsed.hostname.toLowerCase();
  const isLoopback =
    host === 'localhost' || host === '::1' || host.startsWith('127.');
  const isPrivate =
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^(fc|fd)/.test(host);
  if (isLoopback || isPrivate) {
    throw new Error(
      `${envName} MUST be a publicly-resolvable host (got ${parsed.hostname}). ` +
        'It is the PUBLIC front for the local receiver — a tunnel or TLS-terminating proxy — ' +
        'not the receiver address itself.',
    );
  }

  return { url: envName === 'OPENWOP_WEBHOOK_RECEIVER_URL' ? raw : raw.replace(/\/+$/, ''), tunnelled: true };
}

/**
 * Where a scenario's own webhook receiver should LISTEN, and what address the
 * host under test should be told to POST to.
 *
 * Default (variable unset) is `127.0.0.1` for both, which is what every receiver
 * in this suite hard-coded before this helper existed. That default is
 * deliberate and must stay: in the ordinary in-process posture the host is in
 * this very process, loopback is the correct and narrowest binding, and nothing
 * outside the process has any business reaching a test receiver. This helper
 * never widens that.
 *
 * `OPENWOP_CONFORMANCE_HARNESS_HOST` is the operator declaring the opposite —
 * that the host under test runs somewhere `127.0.0.1` does not name this
 * process (a container, a VM, another box) and that the given name is how it
 * reaches this machine. Only then does the receiver bind `0.0.0.0` and
 * advertise that name.
 *
 * MEASURED 2026-09-09, which is why this exists. A container lane ran the host
 * as a real image with `--add-host host.docker.internal:host-gateway` and its
 * compat/OIDC doubles reachable, and `webhook-signed-delivery` plus
 * `replay-fanout-suppression` still failed. From inside the container:
 *
 *     "msg":"webhook delivery failed","url":"http://127.0.0.1:55469/",
 *     "detail":"fetch failed (connect ECONNREFUSED 127.0.0.1:55469)"
 *
 * The address named the CONTAINER's loopback. Two independent blockers, both
 * this suite's: the receiver advertised `127.0.0.1`, and it bound loopback-only
 * so no external name could have reached it either. The lane was configured
 * correctly and the host signs webhooks correctly; the scenarios simply could
 * not be witnessed, and recorded a plain `fail` while doing it — a false
 * accusation, and the mirror of a gate that cannot fail.
 *
 * This does NOT relax any SSRF gate. `host.docker.internal` is still a private
 * address over plain `http`, so the three gates in `webhook-signed-delivery`'s
 * docblock apply unchanged and a host must still opt in (or use
 * `OPENWOP_WEBHOOK_RECEIVER_URL`, which waives nothing) to witness the row.
 * All this fixes is that the packet had nowhere to go.
 */
export function receiverBinding(): { bind: string; advertise: string } {
  const advertise = process.env['OPENWOP_CONFORMANCE_HARNESS_HOST']?.trim();
  if (!advertise) return { bind: '127.0.0.1', advertise: '127.0.0.1' };
  return { bind: '0.0.0.0', advertise };
}

// ─────────────────────────────────────────────────────────────────────────────
// RFC 0201 — the Standard Webhooks 1.0.0 companion scheme (`standard-webhooks-1`)
// ─────────────────────────────────────────────────────────────────────────────
//
// Implemented FROM THE SPEC RECIPE, not by importing the upstream library, so
// that a library defect cannot make a leg pass: Standard Webhooks 1.0.0
// §"Signature scheme" — "the message's: ID, timestamp and body are concatenated
// … `msg_id.timestamp.payload`", HMAC-SHA256, base64, prefixed `v1,`; the
// secret is `whsec_` + base64 of 24–64 random bytes, and the KEY is the
// decoded bytes; §"Webhook headers" — `webhook-signature` is a space-delimited
// list, and a verifier tries each entry. `webhook-receiver.test.ts` pins this
// against the upstream reference library's own `sign` test vector.

/** RFC 0201 §C.10 — `webhook-id` grammar (Standard Webhooks forbids `.` in the id). */
export const STANDARD_WEBHOOKS_ID = /^[A-Za-z0-9_-]{16,128}$/;
export const WHSEC_PREFIX = 'whsec_';

/** The HMAC key of a `whsec_` secret: its base64 body, decoded. `null` when the secret is not that form or decodes outside 24–64 bytes. */
export function decodeWhsec(secret: string): Buffer | null {
  if (!secret.startsWith(WHSEC_PREFIX)) return null;
  const body = secret.slice(WHSEC_PREFIX.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return null;
  const key = Buffer.from(body, 'base64');
  return key.length >= 24 && key.length <= 64 ? key : null;
}

/** A fresh `whsec_` secret of `bytes` random bytes (default 32). */
export function mintWhsec(bytes = 32): string {
  return `${WHSEC_PREFIX}${randomBytes(bytes).toString('base64')}`;
}

/** One `webhook-signature` entry, `v1,<base64>`, over `{id}.{timestamp}.{rawBody}`. */
export function standardWebhooksSign(secret: string, id: string, timestamp: string | number, rawBody: string | Buffer): string {
  const key = decodeWhsec(secret);
  if (key === null) throw new Error('standardWebhooksSign: secret is not a whsec_ secret of 24–64 bytes');
  const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  return `v1,${createHmac('sha256', key).update(`${id}.${String(timestamp)}.${bodyStr}`, 'utf8').digest('base64')}`;
}

export type StandardWebhooksRejection =
  | 'missing_headers'
  | 'malformed_id'
  | 'malformed_timestamp'
  | 'timestamp_out_of_tolerance'
  | 'no_matching_signature';

export interface StandardWebhooksVerdict {
  readonly accepted: boolean;
  readonly reason?: StandardWebhooksRejection;
  /** Every space-separated entry of `webhook-signature`. */
  readonly entries: readonly string[];
  /** How many of `entries` verify under the given secret. */
  readonly matched: number;
}

type HeaderBag = Record<string, string | string[] | undefined>;

function header(headers: HeaderBag, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return Array.isArray(v) ? v.join(', ') : v;
  }
  return undefined;
}

/**
 * Verify a Standard Webhooks delivery the way an unmodified receiver would:
 * constant-time compare of every `v1,` entry, ±5 minutes tolerance (the
 * reference library's default, and the window v1/v2 §Verification set).
 * Non-`v1,` entries (`v1a,` — the asymmetric scheme) are listed but never match.
 */
export function verifyStandardWebhooks(
  rawBody: string | Buffer,
  headers: HeaderBag,
  secret: string,
  options: { toleranceSeconds?: number; nowSeconds?: number } = {},
): StandardWebhooksVerdict {
  const id = header(headers, 'webhook-id');
  const ts = header(headers, 'webhook-timestamp');
  const sig = header(headers, 'webhook-signature');
  if (id === undefined || ts === undefined || sig === undefined) return { accepted: false, reason: 'missing_headers', entries: [], matched: 0 };
  const entries = sig.split(' ').filter((e) => e.length > 0);
  if (id.includes('.') || id.length === 0) return { accepted: false, reason: 'malformed_id', entries, matched: 0 };
  if (!/^\d+$/.test(ts)) return { accepted: false, reason: 'malformed_timestamp', entries, matched: 0 };
  const tolerance = options.toleranceSeconds ?? DEFAULT_FRESHNESS_WINDOW_SECONDS;
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(ts)) > tolerance) return { accepted: false, reason: 'timestamp_out_of_tolerance', entries, matched: 0 };
  const expected = Buffer.from(standardWebhooksSign(secret, id, ts, rawBody).slice(3), 'base64');
  let matched = 0;
  for (const entry of entries) {
    const comma = entry.indexOf(',');
    if (comma < 0 || entry.slice(0, comma) !== 'v1') continue;
    const given = Buffer.from(entry.slice(comma + 1), 'base64');
    if (given.length === expected.length && timingSafeEqual(given, expected)) matched += 1;
  }
  return matched > 0 ? { accepted: true, entries, matched } : { accepted: false, reason: 'no_matching_signature', entries, matched };
}

/** One request the modal receiver saw. `mode` is the path segment it was routed by. */
export interface ModalHit {
  readonly mode: string;
  readonly path: string;
  readonly method: string;
  readonly headers: HeaderBag;
  readonly body: string;
  readonly status: number;
  readonly verification: boolean;
  readonly at: number;
}

/**
 * RFC 0201 — the suite receiver with a VERIFICATION MODE per path.
 *
 * One server, many behaviours, routed by the path segment after a per-scenario
 * nonce (`/<nonce>/<mode>`), because behind a public front every scenario shares
 * ONE tunnelled URL and ONE pinned port: the mode has to travel in the URL the
 * host is given, not in which local server happens to be listening.
 *
 *   echo        verification → 200 `{ challenge }`; delivery → 204
 *   no-echo     verification → 200 `{}`;            delivery → 204
 *   wrong-echo  verification → 200 `{ challenge: <another value> }`; delivery → 204
 *   redirect    anything → 307 to `redirect-target` (a host MUST NOT follow it)
 *   redirect-target  echo, but every hit is recorded so a followed redirect shows
 *   fail2       verification → echo; delivery → 500 for the first two attempts of
 *               each `(OpenWOP-Webhook-Id, runId, sequence)`, then 204
 *
 * A request is a VERIFICATION when its JSON body's `type` is
 * `openwop.webhook.verification`; every hit is recorded either way.
 */
export async function startModalReceiver(): Promise<{
  server: Server;
  nonce: string;
  hits: ModalHit[];
  /** The URL to register for `mode` — the public front when `OPENWOP_WEBHOOK_RECEIVER_URL` is set, else loopback. */
  urlFor: (mode: string) => { url: string; tunnelled: boolean };
  close: () => Promise<void>;
}> {
  const nonce = randomBytes(6).toString('hex');
  const hits: ModalHit[] = [];
  const failures = new Map<string, number>();
  const server = createServer((request: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    request.on('data', (c: Buffer) => chunks.push(c));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const path = request.url ?? '/';
      const segs = path.split('?')[0]!.split('/').filter((x) => x.length > 0);
      const at = segs.indexOf(nonce);
      const mode = at >= 0 && at + 1 < segs.length ? segs[at + 1]! : '';
      let parsed: Record<string, unknown> | null = null;
      try { const j = JSON.parse(body) as unknown; parsed = j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, unknown>) : null; } catch { /* not JSON */ }
      const verification = parsed?.['type'] === 'openwop.webhook.verification';
      const challenge = typeof parsed?.['challenge'] === 'string' ? (parsed['challenge'] as string) : undefined;
      const record = (status: number): void => { hits.push({ mode, path, method: request.method ?? '', headers: request.headers, body, status, verification, at: Date.now() }); };
      const json = (status: number, obj: unknown): void => { record(status); res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      const empty = (status: number, extra: Record<string, string> = {}): void => { record(status); res.writeHead(status, extra); res.end(); };
      switch (mode) {
        case 'echo':
        case 'redirect-target':
          return verification ? json(200, { challenge }) : empty(204);
        case 'no-echo':
          return verification ? json(200, {}) : empty(204);
        case 'wrong-echo':
          return verification ? json(200, { challenge: challenge === undefined ? 'not-the-challenge' : `${challenge}x` }) : empty(204);
        case 'redirect':
          return empty(307, { Location: path.replace(`/${nonce}/redirect`, `/${nonce}/redirect-target`) });
        case 'fail2': {
          if (verification) return json(200, { challenge });
          const ev = parsed?.['event'] as { sequence?: unknown } | undefined;
          const key = `${String(header(request.headers, 'openwop-webhook-id') ?? header(request.headers, 'x-openwop-webhook-id') ?? '')}|${String(parsed?.['runId'] ?? '')}|${String(ev?.sequence ?? '')}`;
          const n = (failures.get(key) ?? 0) + 1;
          failures.set(key, n);
          return empty(n <= 2 ? 500 : 204);
        }
        default:
          return empty(404);
      }
    });
  });
  const pinned = Number(process.env['OPENWOP_WEBHOOK_RECEIVER_PORT'] ?? '');
  const bindPort = Number.isInteger(pinned) && pinned > 0 && pinned < 65536 ? pinned : 0;
  const binding = receiverBinding();
  await new Promise<void>((resolve) => server.listen(bindPort, binding.bind, () => resolve()));
  const addr = server.address();
  if (typeof addr !== 'object' || addr === null) throw new Error('receiver address unavailable');
  const local = `http://${binding.advertise}:${addr.port}`;
  const urlFor = (mode: string): { url: string; tunnelled: boolean } => {
    const front = resolveRegistrationUrl(`${local}/`);
    return { url: `${front.url.replace(/\/+$/, '')}/${nonce}/${mode}`, tunnelled: front.tunnelled };
  };
  const close = (): Promise<void> => new Promise<void>((resolve) => server.close(() => resolve()));
  return { server, nonce, hits, urlFor, close };
}

/** Header lookup over a recorded hit, case-insensitive. */
export function hitHeader(hit: { headers: HeaderBag }, name: string): string | undefined {
  return header(hit.headers, name);
}
