# OpenWOP Quickstart

> **Status: v2.** This guide speaks the v2 wire ([`spec/v2/core/`](./spec/v2/core/overview.md), [`api/v2/openapi.yaml`](./api/v2/openapi.yaml)). It covers discovery, auth, the run lifecycle, live events (SSE, poll, webhooks), fork and replay, `configurable`, node packs, conformance, and SDKs, and links the normative text for each. Every response below was captured from the v2 reference host ([`examples/hosts/v2-reference`](https://github.com/openwop/openwop-examples/tree/main/examples/hosts/v2-reference), booted on port 3990) and abbreviated.
>
> Still talking to a host over `/v1/…`? The v1 walkthrough this guide replaced is in git history: `git show 1b33fe1a:QUICKSTART.md`. Moving a client across is [`docs/migration/v1-to-v2.md`](./docs/migration/v1-to-v2.md) §"If you are a client, not a host".

> **Audience:** developers calling an OpenWOP v2 host for the first time.
> **Prerequisites:** the host's base URL and an API key it issued you. No host yet? [`QUICKSTART-10MIN.md`](./QUICKSTART-10MIN.md) boots one on your laptop.
> **Time to first run:** about 5 minutes.

Implementing a host rather than calling one? Read [`docs/IMPLEMENT-CORE.md`](./docs/IMPLEMENT-CORE.md) and [`docs/IMPLEMENTER-PATH.md`](./docs/IMPLEMENTER-PATH.md) instead.

---

## 0. Two things that differ from v1

**Paths are unversioned.** A v2 operation lives at `/runs`, `/runs/{runId}`, `/webhooks`, and so on. There is no `/v2/` prefix ([`versioning.md`](./spec/v2/core/versioning.md) §1.2).

**Every request carries `OpenWOP-Version: 2`.** Until v1 end-of-support (not before 2026-12-04, per [`evidence/v1-end-of-support.json`](./evidence/v1-end-of-support.json)), a host serves both majors and its `preferredVersion` names the 1.x one. A request with no header gets `preferredVersion`'s major, which is v1 ([`versioning.md`](./spec/v2/core/versioning.md) §1.1, §1.3). The header is the only thing that selects v2. Every call below sends it, and every response names the contract that produced it in its own `OpenWOP-Version` header (§1.4).

The examples use two shell variables:

```bash
export OPENWOP_URL=http://127.0.0.1:3990   # your host's origin, no path
export TOKEN=openwop-v2-dev-key            # the reference host's default dev key
```

---

## 1. Discovery: what does this host support?

`/.well-known/openwop` is one resource with two representations. The request header picks one ([`capabilities.md`](./spec/v2/core/capabilities.md) §1).

```bash
curl -s -i -H 'OpenWOP-Version: 2' $OPENWOP_URL/.well-known/openwop
```

```text
HTTP/1.1 200 OK
OpenWOP-Version: 2.0
ETag: "76bc81a284ffd399571798b37285cc8a"
```

```json
{
  "protocolVersions": ["1.11", "2.0"],
  "preferredVersion": "1.11",
  "minClientVersion": "1.0",
  "implementation": { "name": "openwop-host-v2-reference", "version": "2.0.0-rc.1", "vendor": "openwop (reference example)" },
  "eventLogSchemaVersion": 3,
  "replay": {
    "status": "experimental", "since": "2.0", "until": "2.1", "witness": "witnessable-gated",
    "modes": ["replay", "branch"], "retention": { "days": 30 }, "effectSeamsManifest": "/host/effect-seams"
  },
  "webhooks": {
    "status": "experimental", "since": "2.0", "until": "2.1", "witness": "witnessable-gated",
    "signatureAlgorithms": ["v1", "standard-webhooks-1"],
    "retryPolicy": { "maxAttempts": 5, "backoff": "exponential" }
  },
  "limits": { "status": "stable", "since": "2.0", "witness": "witnessable-gated", "maxNodeExecutions": 1000, "maxRunDurationMs": 600000 }
}
```

How to read it:

- `protocolVersions[]` lists every major the host serves. If `2.x` is missing, this host doesn't speak v2. Asking for a major it doesn't list gets `406 protocol_version_unsupported`, and the error's `details.protocolVersions` repeats the list.
- The root is closed. Every family is a **capability record** `{ status, since, until?, witness, …facets }`, and a record that is present is the claim. v2 has no `supported: true` flags: a host that doesn't offer a family leaves its key out ([`capabilities.md`](./spec/v2/core/capabilities.md) §2).
- `preferredVersion: "1.11"` on a v2 document is normal during the overlap. It names the header-less default, not the major you are speaking.
- Resend the `ETag` in `If-None-Match` and you get `304` (§1.1).
- Profiles such as `openwop-core-standard` are not wire fields. They are predicates over this document, published in [`spec/v2/profiles.json`](./spec/v2/profiles.json) (§7).

The same request without the header returns the v1 document, `OpenWOP-Version: 1.11`.

📖 **Read:** [`capabilities.md`](./spec/v2/core/capabilities.md) for the record type, the closed root, and the family list. The machine-readable operation list is [`api/v2/openapi.yaml`](./api/v2/openapi.yaml); the path manifest also names a self-describing `GET /openapi.json` (`getOpenApiSpec`).

---

## 2. Auth: getting your first request through

Every protected call takes a bearer credential. v2 has several **lanes** (`api-key`, `session`, `oauth2`, `oidc`, `saml`, `scim`, `workload`), and the host advertises the ones it accepts under `auth.lanes[]` in discovery ([`identity.md`](./spec/v2/core/identity.md) §2). An API key uses the `api-key` lane:

```bash
curl -s -i -X POST $OPENWOP_URL/runs \
  -H 'OpenWOP-Version: 2' \
  -H 'Content-Type: application/json' \
  -d '{"workflowId": "conformance-noop"}'
```

```text
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer

{"error":"unauthenticated","message":"Authorization: Bearer <credential> is required"}
```

Add `-H "Authorization: Bearer $TOKEN"` and the request goes through. The host resolves your credential to a **Subject**, which becomes the run's `owner`. Your tenant always comes from the credential, never from the request body. A v1-style `"tenantId"` that doesn't match the credential's tenant gets `403`.

The scope vocabulary (`runs:create`, `runs:read`, `runs:cancel`, `webhooks:manage`, `artifacts:read`, `approvals:respond`, …) is listed under `components.securitySchemes` in [`api/v2/openapi.yaml`](./api/v2/openapi.yaml). The scope each operation needs is in the table in [`runs.md`](./spec/v2/core/runs.md) §Surface.

📖 **Read:** [`identity.md`](./spec/v2/core/identity.md) for lanes, Subjects, revocation, and the identity error codes.

---

## 3. Create a run and read its snapshot

```bash
curl -s -i -X POST $OPENWOP_URL/runs \
  -H 'OpenWOP-Version: 2' \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{
    "workflowId": "conformance-multi-node",
    "tags": ["quickstart"],
    "metadata": {"requestedBy": "quickstart"}
  }'
```

```text
HTTP/1.1 201 Created
OpenWOP-Version: 2.0
```

```json
{
  "runId": "openwop-reference-tenant/9fasFA1XO6OIVVrEDg6S_Msv",
  "status": "pending",
  "eventsUrl": "http://127.0.0.1:3990/runs/openwop-reference-tenant~2F9fasFA1XO6OIVVrEDg6S_Msv/events",
  "statusUrl": "http://127.0.0.1:3990/runs/openwop-reference-tenant~2F9fasFA1XO6OIVVrEDg6S_Msv"
}
```

Three things to notice:

- **Run ids are tenant-bound.** A `runId` is `<tenantId>/<opaque>`. In a URL it is one path segment, so the `/` is projected as `~2F`, as `eventsUrl` shows ([`identity.md`](./spec/v2/core/identity.md) §5). Hosts also accept `%2F`. Treat the id as opaque. The easiest approach is to follow `statusUrl` and `eventsUrl` rather than building paths yourself.
- **The body is closed.** An unknown key such as `"foo": 1` gets `400 validation_error` ([`runs.md`](./spec/v2/core/runs.md) §Create).
- **`Idempotency-Key` makes a retry safe.** It must match `^[A-Za-z0-9._~-]{22,128}$` and carry at least 128 bits of entropy. A UUID satisfies both. If you send the same key and body again, you get the same `runId` back with `OpenWOP-Idempotent-Replay: true` and no second run is created ([`idempotency.md`](./spec/v2/core/idempotency.md)).

Read the snapshot:

```bash
RUN=openwop-reference-tenant~2F9fasFA1XO6OIVVrEDg6S_Msv   # the last path segment of statusUrl
curl -s -i -H 'OpenWOP-Version: 2' -H "Authorization: Bearer $TOKEN" $OPENWOP_URL/runs/$RUN
```

```text
HTTP/1.1 200 OK
OpenWOP-Version: 2.0
ETag: "seq-7-completed"
```

```json
{
  "runId": "openwop-reference-tenant/9fasFA1XO6OIVVrEDg6S_Msv",
  "workflowId": "conformance-multi-node",
  "status": "completed",
  "owner": {
    "tenant": "openwop-reference-tenant",
    "subject": {
      "issuer": "urn:openwop-host-v2-reference:api-key",
      "subjectId": "default",
      "tenant": "openwop-reference-tenant",
      "lane": "api-key",
      "kind": "user"
    }
  },
  "eventLogSchemaVersion": 3,
  "engineVersion": 1,
  "compensationStatus": "none",
  "variables": {},
  "startedAt": "2026-09-27T05:39:33.362Z",
  "completedAt": "2026-09-27T05:39:33.372Z",
  "tags": ["quickstart"],
  "metadata": { "requestedBy": "quickstart" }
}
```

The snapshot is `schemas/v2/run-snapshot.schema.json`: a fold of the run's event log. `owner` replaces v1's `principal` / `principalKind`. If you send the `ETag` back as `If-None-Match`, you get `304` until the run changes.

Cancel a live run with `POST /runs/{runId}/cancel`, which answers `200 {"runId": …, "status": "cancelling"}`. Cancelling a run that is already terminal gets `409 run_terminal`:

```json
{"error":"run_terminal","message":"a cancelled run cannot be cancelled","details":{"runStatus":"cancelled"}}
```

Every error has this shape: `{ error, message, details? }`. Route on `error`, which is a code registered in [`spec/v2/errors.json`](./spec/v2/errors.json). Never route on `message` ([`errors.md`](./spec/v2/core/errors.md)).

📖 **Read:** [`runs.md`](./spec/v2/core/runs.md) for the full run surface: pause/resume, bulk cancel, list, diff, ancestry, annotations, and artifacts. The interrupt resolve paths (`POST /runs/{runId}/interrupts/{nodeId}`, `POST /interrupts/{token}`) are in [`interrupt.md`](./spec/v2/core/interrupt.md).

---

## 4. Receive live events

A run is its append-only event log. SSE, poll, and webhooks are three views of the same log ([`events.md`](./spec/v2/core/events.md)).

### SSE (browser, CLI, live UI)

```bash
curl -s -N -H 'OpenWOP-Version: 2' -H "Authorization: Bearer $TOKEN" \
  "$OPENWOP_URL/runs/$RUN/events"
```

```text
id: 0
event: run.started
data: {"eventId":"q-hpT54XxdWCrO949jQwYaIr","runId":"openwop-reference-tenant/9fasFA1XO6OIVVrEDg6S_Msv","type":"run.started","payload":{"workflowId":"conformance-multi-node","inputs":{},"transport":"rest","owner":{…}},"timestamp":"2026-09-27T05:39:33.362Z","sequence":0,"schemaVersion":1,"engineVersion":1}

id: 1
event: node.started
data: {…,"type":"node.started","payload":{"nodeId":"a","typeId":"core.noop","attempt":0},"sequence":1,…}

…

id: 7
event: run.completed
data: {…,"type":"run.completed","payload":{"outputs":{},"durationMs":10},"sequence":7,…}
```

`id:` is the event's `sequence`, which starts at 0. The host sends the backlog, then new events as they happen, and closes the stream after the terminal event.

**Resuming.** After a dropped connection, reconnect with `Last-Event-ID` set to the last `id:` you processed. The host streams only the events after it:

```bash
curl -s -N -H 'OpenWOP-Version: 2' -H "Authorization: Bearer $TOKEN" \
  -H 'Last-Event-ID: 5' "$OPENWOP_URL/runs/$RUN/events"
```

```text
id: 6
event: node.completed
…

id: 7
event: run.completed
…
```

**Modes.** `?streamMode=` controls which events you receive:

| Mode | You receive |
| --- | --- |
| `updates` (default) | run and node transitions, suspensions, and interrupt events |
| `values` | a `state.snapshot` frame (a full `RunSnapshot`) after each transition |
| `messages` | `ai.message.chunk` frames from streaming AI nodes |
| `debug` | every event, including vendor events |

You can combine modes with commas (`updates,messages`), but `values` can't be combined with anything. A value outside the grammar gets `400 unsupported_stream_mode`, and its `details.supported` lists the modes the host serves. `?bufferMs=100` (range 0 to 5000) batches events into `event: batch` frames whose `data:` is a JSON array.

### Poll (no SSE available)

```bash
curl -s -H 'OpenWOP-Version: 2' -H "Authorization: Bearer $TOKEN" \
  "$OPENWOP_URL/runs/$RUN/events/poll?afterSequence=4"
```

```json
{
  "runId": "openwop-reference-tenant/9fasFA1XO6OIVVrEDg6S_Msv",
  "events": [
    { "sequence": 5, "type": "node.started", … },
    { "sequence": 6, "type": "node.completed", … },
    { "sequence": 7, "type": "run.completed", "payload": { "outputs": {}, "durationMs": 10 }, … }
  ],
  "lastSequence": 7,
  "status": "completed",
  "isTerminal": true
}
```

On the next call, pass `lastSequence` back as `afterSequence`. Keep polling until `isTerminal` is true. v1's `lastSequence` / `since` query parameters don't exist in v2.

📖 **Read:** [`events.md`](./spec/v2/core/events.md) for the closed event envelope, the type registry, and every stream mode and SSE framing rule.

### Webhooks (server-to-server)

Register a subscription. The URL must be `https://`. The event names are v2 type names from the event registry, so a v1 name such as `run.complete` is refused.

```bash
WEBHOOK_SECRET=$(openssl rand -hex 32)
curl -s -i -X POST $OPENWOP_URL/webhooks \
  -H 'OpenWOP-Version: 2' \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{
    \"url\": \"https://my-app.example/openwop-webhook\",
    \"events\": [\"run.completed\", \"run.failed\", \"approval.requested\"],
    \"secret\": \"$WEBHOOK_SECRET\"
  }"
```

```text
HTTP/1.1 201 Created
OpenWOP-Version: 2.0

{"webhookId":"openwop-reference-tenant/a3Oy4QUc9UrGvna8EzOlwqIm"}
```

**Send your own `secret`.** The host never returns it in any response ([`api/v2/openapi.yaml`](./api/v2/openapi.yaml) `registerWebhook`). If you omit it, you can't verify the deliveries. The host also refuses a loopback, private, or non-https URL with `400 webhook_url_rejected`.

Each delivery is a `POST` whose body is `{ runId, workspaceId?, event }`, where `event` is the run event exactly as it appears on the stream. It carries five `OpenWOP-*` headers. Here is one real delivery:

```text
openwop-webhook-id: openwop-reference-tenant/tIL924-_nuVsDGWCJkiFm2-i
openwop-event-type: run.completed
openwop-timestamp: 1790487809
openwop-signature: sha256=0646da74498de78ee4354c970994cb423c66f065fbe2575456fc46ab4361a705
openwop-signature-algorithm: v1
x-openwop-webhook-id: …   (the same five values again, dual-emitted through the overlap)

{"runId":"openwop-reference-tenant/OFJLUFpBp-YkcTUc2Fs-a4rm","workspaceId":"default","event":{"eventId":"XOoCbot1DI2wY_esWklfztYk","type":"run.completed","payload":{"outputs":{},"durationMs":7},"sequence":3,…}}
```

Verify every delivery before you act on it ([`webhooks.md`](./spec/v2/core/webhooks.md) §Verification). This function accepted the delivery above, and it rejected the same delivery with a wrong secret or a one-byte change to the body:

```typescript
import { createHmac, timingSafeEqual } from 'node:crypto';

// rawBody: the exact bytes received, before any JSON parsing. headers: lower-cased names.
export function verifyOpenwopDelivery(rawBody: Buffer, headers: Record<string, string | undefined>, secret: string): boolean {
  if (headers['openwop-signature-algorithm'] !== 'v1') return false;           // reject unknown schemes
  const ts = headers['openwop-timestamp'] ?? '';
  if (!/^\d+$/.test(ts) || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false; // ±5 min
  const sig = Buffer.from((headers['openwop-signature'] ?? '').replace(/^sha256=/, ''), 'hex');
  const expected = createHmac('sha256', secret).update(`${ts}.`).update(rawBody).digest();
  return sig.length === expected.length && timingSafeEqual(sig, expected);
}
```

Delivery is at least once, so deduplicate on `(OpenWOP-Webhook-Id, runId, sequence)`. Failed attempts are retried under the advertised `webhooks.retryPolicy`, then dead-lettered rather than dropped. `DELETE /webhooks/{webhookId}` stops delivery, including retries that are already scheduled.

📖 **Read:** [`webhooks.md`](./spec/v2/core/webhooks.md) for durability, egress rules, the opt-in `standard-webhooks-1` scheme, and secret rotation.

---

## 5. Time-travel debugging: fork a run

A host that advertises `replay` serves `POST /runs/{runId}:fork`. Events before `fromSeq` are fixed history, and events from `fromSeq` onward run again.

```bash
# Replay: re-execute from sequence 3 against current code
curl -s -X POST "$OPENWOP_URL/runs/$RUN:fork" \
  -H 'OpenWOP-Version: 2' -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"mode": "replay", "fromSeq": 3}'

# Branch: an independent run from sequence 3 with changed options
curl -s -X POST "$OPENWOP_URL/runs/$RUN:fork" \
  -H 'OpenWOP-Version: 2' -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"mode": "branch", "fromSeq": 3, "runOptionsOverlay": {"tags": ["branch-b"]}}'
```

```json
{
  "runId": "openwop-reference-tenant/5jpULNEoIFPR_9J34GG9JNGa",
  "sourceRunId": "openwop-reference-tenant/9fasFA1XO6OIVVrEDg6S_Msv",
  "fromSeq": 3,
  "mode": "replay",
  "status": "running",
  "eventsUrl": "http://127.0.0.1:3990/runs/openwop-reference-tenant~2F5jpULNEoIFPR_9J34GG9JNGa/events"
}
```

- **`replay`** reproduces the recorded prefix and must not call external systems a second time. Suppressing side effects is an obligation of advertising `replay`, not an option. The host lists which effects it guards in `GET /host/effect-seams`. If a replayed node produces a different event, the host emits `replay.diverged`.
- **`branch`** is a new run and is not deterministic. `runOptionsOverlay` is allowed only on a branch. On a replay it gets `400 validation_error`.
- A `fromSeq` that isn't in the source log gets `422 fork_point_invalid`, and `details.lastSequence` tells you the range.

📖 **Read:** [`replay.md`](./spec/v2/core/replay.md) for byte-equivalence of the prefix, suppression, and the divergence codes.

---

## 6. Configure runs with `configurable`

In v2, `configurable` is closed, nested, and versioned. `version: 1` is required, and every key lives in a section: `run`, `ai`, `distillation`, `budget`, or `extensions` ([`runs.md`](./spec/v2/core/runs.md) §Run options).

```bash
curl -s -X POST $OPENWOP_URL/runs \
  -H 'OpenWOP-Version: 2' -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "workflowId": "conformance-noop",
    "configurable": {"version": 1, "run": {"recursionLimit": 500, "runTimeoutMs": 60000}},
    "tags": ["production", "q2-launch"],
    "metadata": {"requestedBy": "alice@acme.example"}
  }'
```

The v1 flat, dotted form is refused:

```json
{"error":"validation_error","message":"unknown configurable key ai.provider (closed schema)","details":{"path":"configurable.ai.provider"}}
```

To choose a model, use `"ai": {"provider": "anthropic", "model": "…", "credentialRef": "…"}`. `provider` must be listed in the host's `aiProviders.providers`, and `credentialRef` must name a provider in `aiProviders.byok`. The reference host advertises no AI providers, so it rejects any `ai.provider` with `400 validation_error`. `credentialRef` is an opaque, host-issued reference that never contains key material. A reference to the wrong provider gets `403 credential_forbidden`. The persisted options come back on the snapshot, and they can't change after the run is created.

---

## 7. Write a node pack

A node pack is a versioned, signed bundle of node types. The v2 manifest rules are in [`packs.md`](./spec/v2/core/packs.md):

- **`kind` is required** (`"node"` for a node pack). v1's "absent means node" reading is gone.
- **`engines.openwop` needs an explicit major ceiling** (`>=1.0.0 <3.0.0`). A v2 host treats a range with no upper bound as `<2.0.0` and refuses to install it with `pack_engine_unsupported`.
- **`peerDependencies` keys are capability family keys** from [`spec/v2/declaration.json`](./spec/v2/declaration.json), such as `aiProviders` or `secrets`. You name facets in `peerDependenciesMeta`, not in dotted keys.
- **There is one signing scheme.** It is `signing: { keyId, scheme: "ed25519-canonical-json" }`, an Ed25519 signature over the canonical (JCS) `pack.json` bytes. A signature over tarball bytes is not a v2 signature, and v1's `method` field fails validation.

```json
{
  "name": "vendor.acme.salesforce-tools",
  "version": "1.4.2",
  "kind": "node",
  "engines": { "openwop": ">=1.0.0 <3.0.0" },
  "peerDependencies": { "secrets": "required" },
  "peerDependenciesMeta": { "secrets": { "facets": ["resolveInPack"] } }
}
```

The node declarations, runtime block, and remaining fields are defined by [`schemas/v2/node-pack-manifest.schema.json`](./schemas/v2/node-pack-manifest.schema.json). Runtimes are covered in [`node-pack-runtimes.md`](./spec/v2/core/node-pack-runtimes.md).

📖 **Read:** [`docs/PACK-AUTHOR-QUICKSTART.md`](./docs/PACK-AUTHOR-QUICKSTART.md) for the build, sign, and publish path to the registry's v2 tree.

---

## 8. Certify your implementation

The suite is [`@openwop/openwop-conformance`](https://www.npmjs.com/package/@openwop/openwop-conformance) (2.42.x). Install it with its exact-pinned peer, the corpus artifacts, at the same version:

```bash
npm install --save-dev --legacy-peer-deps @openwop/openwop-conformance@2.42.6 @openwop/spec-artifacts@2.42.6
npx openwop-conformance --base-url $OPENWOP_URL --api-key $TOKEN --target-major 2
```

**Pass `--target-major 2`.** Without it, the suite picks the major from the host's `preferredVersion`, and during the overlap that is 1. Other useful flags:

- `--filter "<pattern>"` runs a subset.
- `--require-behavior` fails an advertised behavior the suite can't observe, instead of soft-skipping it.
- `--certify out.json` writes a certification bundle.

Every run ends with the RFC 0148 dispositions: `executed-pass`, `executed-fail`, `blocked`, `inapplicable`. A `blocked` row is not a pass. `npx openwop-conformance --help` lists the rest, including the bundle-v3 signing flags.

📖 **Read:** [`conformance.md`](./spec/v2/core/conformance.md) for requirement ids, witness classes, and the bundle. [`INTEROP-MATRIX.md`](./INTEROP-MATRIX.md) shows the v2 hosts measured so far.

---

## 9. SDKs

Each reference SDK has a v2 line that sends `OpenWOP-Version` on every request, calls only unversioned paths, and never calls `/v1/…`. The 1.x lines are unchanged for v1 hosts. The sources and READMEs are in [`openwop/openwop-sdks`](https://github.com/openwop/openwop-sdks).

| Language | v2 package | Install | Source |
| --- | --- | --- | --- |
| TypeScript | `@openwop/openwop` 2.x | `npm install @openwop/openwop@2` | `sdk/typescript-v2/` |
| Python | `openwop-client` 2.x | `pip install "openwop-client>=2,<3"` | `sdk/python-v2/` |
| Go | `github.com/openwop/openwop-sdks/go/v2` | `go get github.com/openwop/openwop-sdks/go/v2` | `go/v2/` |

The TypeScript client (2.3.0), run against the reference host:

```typescript
import { OpenwopClient } from '@openwop/openwop';

const client = new OpenwopClient({ baseUrl: process.env.OPENWOP_URL!, apiKey: process.env.TOKEN! });

const caps = await client.discovery.capabilities();      // the closed v2 root
const { runId } = await client.runs.create(
  { workflowId: 'conformance-multi-node' },
  { idempotencyKey: crypto.randomUUID() },
);
for await (const event of client.runs.events(runId)) {   // SSE, closes after the terminal event
  console.log(event.sequence, event.type);
}
console.log((await client.runs.get(runId)).status);      // "completed"
```

Import webhook verification from `@openwop/openwop/webhooks` (`verifyWebhookSignature`). The Python and Go READMEs show the same flow.

---

## 10. Storage and persistence (host authors)

v2 core has no storage-adapter interface. It specifies what a host must persist and how it reads older logs: the era key (`eventLogSchemaVersion`, `3` for v2-written runs), the reader rule for v1-written logs, and runs pinned to v1. All of this is in [`persistence.md`](./spec/v2/core/persistence.md). The non-normative v1 adapter interface (`RunEventLogIO`, `SuspendIO`) is still at [`spec/v1/storage-adapters.md`](./spec/v1/storage-adapters.md) if your engine uses it.

---

## 11. Reference hosts and the reference app

- **v2 reference host.** [`openwop-examples/examples/hosts/v2-reference`](https://github.com/openwop/openwop-examples/tree/main/examples/hosts/v2-reference) is a single-process SQLite host implemented from `spec/v2/core/`. It served every response in this guide. [`QUICKSTART-10MIN.md`](./QUICKSTART-10MIN.md) boots it.
- **Reference application.** [`openwop/openwop-app`](https://github.com/openwop/openwop-app) is a backend + React frontend template that serves both majors. It is the tier-1 host at `app.openwop.dev` in the INTEROP-MATRIX v2 table. See its README for how to run it.

The in-memory and SQLite example hosts stay on the 1.x line through the overlap and don't serve v2.

---

## See also

- [`spec/v2/core/overview.md`](./spec/v2/core/overview.md): reading order for the v2 core.
- [`docs/migration/v1-to-v2.md`](./docs/migration/v1-to-v2.md): moving a client or host from v1.
- [`README.md`](./README.md): the full document index with the status legend.
- [`CHANGELOG.md`](./CHANGELOG.md) and [`ROADMAP.md`](./ROADMAP.md): history and what's next.
- [`GOVERNANCE.md`](./GOVERNANCE.md): how the spec changes.

Have a question? Open an issue using the templates in `.github/ISSUE_TEMPLATE/`. Spec contributions go through [`CONTRIBUTING.md`](./CONTRIBUTING.md).
