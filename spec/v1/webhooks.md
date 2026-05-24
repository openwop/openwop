# openwop Spec v1 — Webhook Subscriptions

> **Status: Stable · v1.1 (2026-04-29).** Comprehensive coverage of subscription registration, payload signing, replay-attack protection, delivery semantics, and best-effort guarantees. Stable surface for external review. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). See `auth.md` for the status legend.

---

## Why this exists

Polling `GET /v1/runs/{runId}` to learn about run progress is inefficient — clients pay round-trip cost on every check, and the runtime serves identical state until the next event. The SSE event stream solves this for live consumers (browsers, CLIs) but can't reach systems that need server-to-server delivery: customer integrations, billing pipelines, downstream automation.

openwop defines a subscription-style webhook surface: clients register a URL + event filter once, the runtime POSTs matching events to that URL as they happen. The mechanism mirrors the established Stripe / GitHub / Slack pattern — chosen for ecosystem familiarity and toolchain compatibility (existing webhook receivers can re-use the same verification recipe).

---

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/webhooks` | Register a new subscription |
| `DELETE` | `/v1/webhooks/{webhookId}` | Unregister a subscription |

Authentication: same as the rest of the canonical surface (`auth.md`). The caller MUST be a member of the tenant the subscription will live under.

### Register

**Request body:**

```json
{
  "url": "https://example.com/webhooks/openwop",
  "events": ["run.completed", "run.failed", "approval.requested"],
  "tenantId": "workspace-123",
  "tags": ["production"]
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `url` | URI | yes | MUST be `https://`. The server SSRF-validates against private-IP / metadata-server ranges (see §Security below). |
| `events` | string[] | yes | One or more `RunEventType` values. Empty array → 400. |
| `tenantId` | string | yes | Workspace under which the subscription lives. Caller MUST be a member. |
| `tags` | string[] | no | When set, only runs whose `RunOptions.tags` overlap deliver to this subscription. |

**Response:**

```json
{
  "webhookId": "wh_a3b9c2",
  "secret": "f8a3...64-char-hex...",
  "secretFingerprint": "a1b2c3d4"
}
```

The `secret` is returned **once** at registration time — the subscriber MUST persist it locally to verify signatures. Subsequent reads of the subscription doc (admin-only via Firestore) include only the `secretFingerprint` for cross-referencing.

The fingerprint is the first 8 hex characters of `sha256(secret)`. Logs reference this rather than the full secret; subscribers can do the same to correlate received deliveries with their stored secret.

### Unregister

```
DELETE /v1/webhooks/{webhookId}?tenantId=workspace-123
```

`tenantId` query parameter is required (the route is not path-nested under workspaces). 204 on success; 404 if not found; 403 if the caller is not a member of the tenant.

---

## Delivery semantics

### Headers

Every delivery carries these request headers in addition to the body:

| Header | Value | Purpose |
|---|---|---|
| `Content-Type` | `application/json` | |
| `User-Agent` | `openwop-webhook-dispatcher/{version}` | Identifies the openwop server software |
| `X-openwop-Webhook-Id` | `{webhookId}` | The recipient subscription's id |
| `X-openwop-Event-Type` | `{eventType}` | One of `RunEventType` |
| `X-openwop-Timestamp` | Unix-seconds integer | When the dispatcher signed the body |
| `X-openwop-Signature` | `sha256={hex}` | HMAC over `{X-openwop-Timestamp}.{rawBody}` |
| `X-openwop-Signature-Algorithm` | `v1` (default) | Signature scheme version. Hosts adopting this surface MUST set the header; older hosts that omit it expect subscribers to treat absence as equivalent to `v1`. |

### Body

```json
{
  "runId": "run_abc",
  "workspaceId": "workspace-123",
  "event": { "type": "run.completed", "runId": "run_abc", "sequence": 47, "timestamp": "...", "payload": { /* event-specific */ } }
}
```

`event` is the verbatim `RunEventDoc` from the run's event log. The wrapper carries `runId` + `workspaceId` so subscribers don't need to parse them out of the event.

### Verification recipe

Subscribers MUST verify each delivery before acting on it:

1. Read `X-openwop-Timestamp` header. Reject if it's more than ±5 minutes from your clock (replay-attack protection).
2. Read `X-openwop-Signature` header. Strip the `sha256=` prefix.
3. Compute `HMAC-SHA256({timestamp}.{rawBody}, secret)` where `rawBody` is the exact bytes received.
4. Compare to the signature in step 2 using a constant-time compare.

```typescript
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(rawBody: Buffer, headers: Record<string,string>, secret: string): boolean {
  const ts = Number(headers['x-openwop-timestamp']);
  if (Math.abs(Date.now() / 1000 - ts) > 300) return false;
  const sig = headers['x-openwop-signature']?.replace('sha256=', '') ?? '';
  const expected = createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
  return expected.length === sig.length && timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sig, 'hex'));
}
```

### Signature algorithm versioning

The signature scheme described above is canonically labeled `v1` (HMAC-SHA256 over `{timestamp}.{rawBody}`). To enable future migration to stronger schemes (e.g., Ed25519 detached signatures, dual-sign during rotation) without breaking existing subscribers:

- Hosts adopting this surface MUST set `X-openwop-Signature-Algorithm: v1` on every delivery.
- Hosts that predate this addition MAY omit the header; subscribers MUST treat absence as equivalent to `v1` for backward compatibility.
- Future schemes will register additional values (`v2`, etc.) via RFC. Hosts that wish to deliver under a new scheme MUST advertise support and SHOULD dual-deliver (one delivery per scheme version) during a per-subscription migration window.
- Subscribers receiving an unrecognized algorithm value MUST reject the delivery with a `400`-equivalent log and verification failure. Hosts MUST honor the subscriber's advertised supported-algorithms list at registration time (registration response carries the algorithm the dispatcher will use).

This is additive: the absence-equals-`v1` rule preserves every existing subscriber implementation.

### Best-effort delivery

This v1 spec defines **best-effort** delivery semantics:

- Each event triggers at most ONE delivery attempt to each matching subscription.
- Per-attempt timeout: 5 seconds. Slower subscribers fail the attempt.
- Failed attempts are recorded but **not retried**. The next event triggers a fresh attempt unless the circuit is open.

The v1 baseline does not require durable retries. Durable retries (queue + scheduled redelivery) can land as a forward-compatible extension — receivers MAY observe the same event multiple times if retries arrive, so subscriber implementations SHOULD already be idempotent on `X-openwop-Webhook-Id` + event sequence.

### Circuit breaker

The dispatcher tracks consecutive-failure counts per subscription:

| Threshold | Action |
|---|---|
| 4 consecutive failures | Circuit opens; deliveries skipped for 1 hour |
| 1 hour cooldown elapses | Circuit transitions to half-open; next event probes |
| Probe succeeds | Circuit closes; normal delivery resumes |
| 100 total failures within 7-day rolling window | Subscription marked `failed`; manual re-activation required |

Operators can re-activate failed subscriptions by re-running `POST /v1/webhooks` with the same URL — registering creates a fresh subscription doc with a fresh secret.

---

## Security

### SSRF protection

The server MUST validate subscription URLs at registration time and reject:

- Non-`https://` protocols
- RFC 1918 private ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`)
- Loopback (`127.0.0.0/8`, `::1`)
- Link-local (`169.254.0.0/16`, `fe80::/10`)
- IPv6 ULA (`fc00::/7`)
- Cloud metadata servers (`metadata.google.internal`, `169.254.169.254`)
- `localhost` / `metadata`

Without this, attackers could register `https://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token` and the dispatcher would leak the GCP IAM token bound to the runtime's service account.

### Replay attack protection

Including `{timestamp}.{rawBody}` in the signed payload + the ±5min verification window prevents an attacker who captures one delivery from replaying it indefinitely. Subscribers SHOULD also track received `(X-openwop-Webhook-Id, runId, sequence)` tuples for at-least-once-deduplication; the timestamp check catches the bulk of replay attempts.

### Secret rotation

The current spec does not define a secret-rotation flow. To rotate, delete the subscription and create a new one with the same URL + events; the new secret is returned in the create response. The retired subscription stops receiving deliveries immediately.

### Logging discipline

Implementations MUST NOT log the `secret` field. Logs SHOULD reference subscriptions by `secretFingerprint` (first 8 hex of `sha256(secret)`) for cross-referencing. Subscribers SHOULD do the same on their side.

---

## Example flow

```bash
# 1. Register
curl -X POST https://api.example.com/v1/webhooks \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://my-app.example.com/openwop-webhook",
    "events": ["run.completed", "run.failed"],
    "tenantId": "workspace-prod"
  }'

# Response:
# {"webhookId": "wh_a3b9c2", "secret": "f8a3...", "secretFingerprint": "a1b2c3d4"}

# 2. Trigger a run that emits run.completed
# (your subscriber receives a POST with X-openwop-Signature + X-openwop-Timestamp)

# 3. Unregister when done
curl -X DELETE "https://api.example.com/v1/webhooks/wh_a3b9c2?tenantId=workspace-prod" \
  -H "Authorization: Bearer ${TOKEN}"
```

---

## Future work

- **Durable retries** via Cloud Tasks (or equivalent): defer-and-retry with exponential backoff. Forward-compatible — current subscriber-side verification recipe stays unchanged.
- **Custom secret generation**: allow callers to supply their own secret at registration (rejected today).
- **Additional event filters** beyond tags: per-canvas-type, per-project, regex on event type.
- **Subscription introspection endpoint** (`GET /v1/webhooks/{id}`): currently admin-only via Firestore.

---

## See also

- `auth.md` — API key + scope vocabulary
- `idempotency.md` — at-least-once-delivery deduplication
- `run-options.md` — `tags` field used by tag-filtered subscriptions
- `stream-modes.md` — SSE alternative for live consumers
